import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit must run against every framework the customer selected.
 *
 * Regression cover for a silent scope-narrowing bug found on
 * 10 Sep 2026. The picker is a `<select multiple>`, which submits one
 * form entry per selected option, but the route read it with
 * FormData.get() — which returns only the FIRST entry. Selecting
 * GDPR + EU AI Act spent a credit and produced a GDPR-only audit,
 * stored and presented as complete. No error, nothing in the logs to
 * suggest anything had been dropped.
 *
 * Two halves are pinned here:
 *   1. every selected framework survives parsing (getAll, not get);
 *   2. an id outside the catalogue is refused loudly, rather than
 *      blind-cast to FrameworkId and later skipped when the prompt is
 *      built — which is what made half of this invisible.
 *
 * The assertion reads the route's own `input_parsed` log line: it is
 * the first point where we can observe what the server actually
 * understood, and it is exactly what the old code got wrong.
 */

vi.mock('server-only', () => ({}));

const stubDb = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
        limit: () => Promise.resolve({ data: [], count: 0, error: null })
      })
    })
  }),
  rpc: async () => ({ data: false, error: null })
};

vi.mock('@/lib/supabase', () => ({ supabaseService: () => stubDb }));
vi.mock('@/lib/analytics', () => ({ captureServerEvent: async () => undefined }));
vi.mock('@/lib/alert', () => ({ alertOps: () => undefined }));

/** Captures the route's structured `[audit]` log lines. */
function captureAuditLogs() {
  const entries: Record<string, unknown>[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args[0] === '[audit]' && typeof args[1] === 'string') {
      try {
        entries.push(JSON.parse(args[1]));
      } catch {
        /* not our line */
      }
    }
  });
  return entries;
}

/** Anonymous-org placeholder — keeps the test off the auth path. */
const ANON_ORG = '00000000-0000-0000-0000-000000000000';

async function postAudit(frameworkEntries: string[]) {
  const form = new FormData();
  form.set('document', new Blob([new TextEncoder().encode('hello')]), 'policy.txt');
  form.set('organizationId', ANON_ORG);
  // A real <select multiple> appends one entry per selection.
  for (const id of frameworkEntries) form.append('frameworks', id);
  form.set('targetLanguage', 'fr');

  const { POST } = await import('@/app/api/audit/route');
  return POST(new Request('https://lexyflow.com/api/audit', { method: 'POST', body: form }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/audit — requested framework scope', () => {
  it('keeps every selected framework, not just the first', async () => {
    const logs = captureAuditLogs();

    await postAudit(['gdpr', 'eu_ai_act']);

    const parsed = logs.find((l) => l.step === 'input_parsed');
    expect(parsed, 'route never reached input_parsed').toBeDefined();
    // The old FormData.get() implementation logged ["gdpr"] here.
    expect(parsed?.frameworks).toEqual(['gdpr', 'eu_ai_act']);
  });

  it('still accepts a single comma-joined value from non-browser clients', async () => {
    const logs = captureAuditLogs();

    await postAudit(['gdpr,eu_ai_act']);

    const parsed = logs.find((l) => l.step === 'input_parsed');
    expect(parsed?.frameworks).toEqual(['gdpr', 'eu_ai_act']);
  });

  it('rejects an id outside the catalogue instead of silently dropping it', async () => {
    // 'ai_act' is a plausible-looking near-miss: the real id is
    // 'eu_ai_act'. Under the old blind cast this sailed through
    // validation and then vanished when the prompt was assembled.
    const res = await postAudit(['gdpr', 'ai_act']);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_metadata');
  });
});
