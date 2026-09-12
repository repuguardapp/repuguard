import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A finished audit must never be discarded in favour of a failed one.
 *
 * On 11 Sep 2026 a GDPR + EU AI Act audit ran for 182 seconds, produced
 * 12 findings at risk score 52, collided with a failed row for the same
 * document from two hours earlier, and the customer was shown that
 * failure — "Audit non abouti" — while the audit they had just paid for
 * was thrown away. The dedup index treated an ATTEMPT as if it were a
 * REPORT.
 *
 * Two things changed since. Migration 0016 restricted the index to
 * completed rows, so a failed attempt no longer occupies the slot of a
 * report. And the replay check moved to the front of the request: an
 * identical report is now recognised BEFORE the pipeline runs, which
 * turns a wasted $0.20 and three minutes into a redirect.
 *
 * So the invariants under test are no longer about recovering from the
 * collision. They are about it never happening:
 *   • an identical completed report is handed back without re-running
 *     anything, and the credit is refunded;
 *   • an earlier FAILED attempt is invisible to that check, so a retry
 *     runs a real audit instead of inheriting a corpse.
 */

vi.mock('server-only', () => ({}));

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXISTING_AUDIT_ID = '40d03281-8778-4db7-8465-d60f8d6de0d7';
const NEW_AUDIT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface Journal {
  /** Rows the route opened in `audits`, in order. */
  opened: Record<string, unknown>[];
  /** Patches applied to `audits`, in order. */
  updates: Record<string, unknown>[];
  insertedFindings: number;
  refunds: string[];
  multipassCalls: number;
  /** Filters seen by the replay lookup, so we can assert what it asked. */
  replayFilters: [string, unknown][];
}

/** Thenable query builder: any chain of filters resolves to `result`. */
function chain(result: unknown, onEq?: (col: string, val: unknown) => void): Record<string, unknown> {
  const self: Record<string, unknown> = {
    select: () => chain(result, onEq),
    eq: (col: string, val: unknown) => {
      onEq?.(col, val);
      return chain(result, onEq);
    },
    in: () => chain(result, onEq),
    lt: () => chain(result, onEq),
    order: () => chain(result, onEq),
    limit: () => chain(result, onEq),
    maybeSingle: async () => result,
    single: async () => result,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
  };
  return self;
}

function installMocks(priorAudits: Record<string, unknown>[], journal: Journal) {
  vi.doMock('@/lib/supabase-server', () => ({
    getCurrentUser: async () => ({ id: 'u1', app_metadata: { organization_id: ORG } }),
    organizationIdFromUser: (u: { app_metadata?: { organization_id?: string } } | null) =>
      u?.app_metadata?.organization_id ?? null
  }));
  vi.doMock('@/lib/tier', () => ({
    FREE_TIER_MAX_BYTES: 2 * 1024 * 1024,
    getTierForOrg: async () => 'paid'
  }));
  vi.doMock('@/lib/analytics', () => ({ captureServerEvent: async () => undefined }));
  vi.doMock('@/lib/alert', () => ({ alertOps: () => undefined }));
  vi.doMock('@/lib/access-log', () => ({ logAccess: async () => undefined }));
  vi.doMock('@/lib/document-extractor', () => ({
    extractText: async () => ({
      type: 'txt',
      text: 'a privacy policy',
      charCount: 16,
      redactionCount: 0
    })
  }));
  vi.doMock('@/lib/zero-knowledge', () => ({
    hashDocument: () => 'hash-of-the-same-document',
    wipeBuffer: () => undefined
  }));
  vi.doMock('@/lib/multi-pass-engine', () => ({
    runMultiPassAudit: async () => {
      journal.multipassCalls += 1;
      return {
        documentHash: 'hash-of-the-same-document',
        frameworks: ['eu_ai_act', 'gdpr'],
        language: 'fr',
        generatedAt: new Date().toISOString(),
        summary: 'Twelve gaps found.',
        riskScore: 52,
        findings: Array.from({ length: 12 }, (_, i) => ({
          framework: 'gdpr',
          citation: 'GDPR Art. 13',
          severity: 'high',
          title: `Finding ${i}`,
          body: 'body',
          recommendation: 'fix it',
          evidence: 'quote'
        }))
      };
    }
  }));

  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'try_consume_audit_credit') return { data: true, error: null };
        if (fn === 'refund_audit_credit') {
          journal.refunds.push(String(args?.p_org_id ?? ''));
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      from: (table: string) => {
        if (table === 'audits') {
          return {
            // The replay lookup and the first-audit probe both land
            // here; the probe reads `count`, the lookup reads `data`.
            ...chain(
              { data: priorAudits, count: priorAudits.length, error: null },
              (col, val) => journal.replayFilters.push([col, val])
            ),
            insert: (row: Record<string, unknown>) => {
              journal.opened.push(row);
              return chain({ data: { id: NEW_AUDIT_ID }, error: null });
            },
            update: (patch: Record<string, unknown>) => {
              journal.updates.push(patch);
              return chain({ data: null, error: null });
            }
          };
        }
        if (table === 'audit_findings') {
          return {
            ...chain({ data: [], count: 0, error: null }),
            insert: async (rows: unknown[]) => {
              journal.insertedFindings += Array.isArray(rows) ? rows.length : 0;
              return { error: null };
            },
            delete: () => chain({ error: null })
          };
        }
        if (table === 'organizations') {
          return chain({ data: { retain_documents: false }, error: null });
        }
        return {
          ...chain({ data: null, count: 0, error: null }),
          insert: async () => ({ error: null }),
          upsert: async () => ({ error: null }),
          update: () => chain({ error: null })
        };
      }
    })
  }));
}

/** Background work handed to the platform, so a test can await it. */
let deferred: Promise<unknown>[] = [];

async function runAudit() {
  const form = new FormData();
  form.set('document', new Blob([new TextEncoder().encode('policy')]), 'policy.txt');
  form.set('organizationId', ORG);
  form.append('frameworks', 'gdpr');
  form.append('frameworks', 'eu_ai_act');
  form.set('targetLanguage', 'fr');

  const { POST } = await import('@/app/api/audit/route');
  const res = await POST(
    new Request('https://lexyflow.com/api/audit', { method: 'POST', body: form })
  );
  const text = await res.text();
  // The audit continues after the response — that is the whole design.
  // Awaiting it here lets one test assert on both halves.
  await Promise.all(deferred);
  return { status: res.status, text };
}

beforeEach(() => {
  vi.resetModules();
  deferred = [];
  vi.doMock('@vercel/functions', () => ({
    waitUntil: (p: Promise<unknown>) => {
      deferred.push(p);
    }
  }));
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/audit — an identical report is never produced twice', () => {
  it('hands back a completed report without re-running the pipeline, and refunds', async () => {
    const journal: Journal = {
      opened: [],
      updates: [],
      insertedFindings: 0,
      refunds: [],
      multipassCalls: 0,
      replayFilters: []
    };
    installMocks(
      [{ id: EXISTING_AUDIT_ID, risk_score: 72, frameworks: ['eu_ai_act', 'gdpr'] }],
      journal
    );

    const { status, text } = await runAudit();

    expect(status).toBe(200);
    expect(text).toContain('"replay":true');
    expect(text).toContain(EXISTING_AUDIT_ID);
    // The point of moving this check to the front: the expensive part
    // never ran. It used to cost a full pipeline to discover we already
    // had the answer.
    expect(journal.multipassCalls).toBe(0);
    expect(journal.opened).toHaveLength(0);
    expect(journal.insertedFindings).toBe(0);
    expect(journal.refunds).toEqual([ORG]);
  });

  it('only ever replays a COMPLETED audit', async () => {
    const journal: Journal = {
      opened: [],
      updates: [],
      insertedFindings: 0,
      refunds: [],
      multipassCalls: 0,
      replayFilters: []
    };
    installMocks([], journal);

    await runAudit();

    // The status filter is what stops an attempt being mistaken for a
    // report. Without it we are back to 11 Sep.
    expect(journal.replayFilters).toContainEqual(['status', 'completed']);
  });
});

describe('POST /api/audit — a failed attempt never blocks its own retry', () => {
  it('runs a real audit when the only prior row is a failure', async () => {
    // The route's lookup filters on status='completed', so a failed row
    // is simply not returned — the mock reflects the database, which
    // since migration 0016 does not even index it.
    const journal: Journal = {
      opened: [],
      updates: [],
      insertedFindings: 0,
      refunds: [],
      multipassCalls: 0,
      replayFilters: []
    };
    installMocks([], journal);

    const { status, text } = await runAudit();

    // Accepted, with a brand new audit to follow — not the old failure.
    expect(status).toBe(202);
    expect(text).toContain(NEW_AUDIT_ID);
    expect(text).not.toContain(EXISTING_AUDIT_ID);
    expect(text).toContain('"status":"running"');

    // The row is opened before the answer, so the audit survives the
    // customer closing the tab.
    expect(journal.opened).toHaveLength(1);
    expect(journal.opened[0]).toMatchObject({
      organization_id: ORG,
      status: 'running',
      language: 'fr',
      credit_consumed: true
    });

    // And the real work happened afterwards, exactly once.
    expect(journal.multipassCalls).toBe(1);
    expect(journal.insertedFindings).toBe(12);
    expect(journal.refunds).toEqual([]);

    // Findings are written BEFORE the row is marked completed: a
    // completed row with no findings renders as "no findings, your
    // document is compliant" next to a risk score of 52.
    const closing = journal.updates.at(-1);
    expect(closing).toMatchObject({ status: 'completed', risk_score: 52, language: 'fr' });
  });
});
