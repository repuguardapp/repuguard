import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sweep that catches audits nobody could report as broken.
 *
 * Every failure the audit route knows about refunds and records itself.
 * The ones it cannot know about are the invocations that disappear —
 * the code that would clean up is the code that died. On 10 Sep an
 * audit went exactly that way: a credit spent, no row, no error.
 *
 * These tests pin the two properties that make the sweep safe to run
 * every five minutes: it only touches audits that are genuinely stale,
 * and it refunds exactly the ones that actually cost a credit.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alert', () => ({ alertOps: () => undefined }));

interface Journal {
  patch?: Record<string, unknown>;
  statusFilter?: string[];
  cutoff?: string;
  refunds: string[];
}

/** Minimal stub of the supabase query builder the route uses. */
function installDb(rows: Record<string, unknown>[], journal: Journal, updateError?: string) {
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'refund_audit_credit') {
          journal.refunds.push(String(args.p_org_id));
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          journal.patch = patch;
          const chain = {
            in: (_col: string, values: string[]) => {
              journal.statusFilter = values;
              return chain;
            },
            lt: (_col: string, value: string) => {
              journal.cutoff = value;
              return chain;
            },
            select: async () =>
              updateError
                ? { data: null, error: { message: updateError } }
                : { data: rows, error: null }
          };
          return chain;
        }
      })
    })
  }));
}

async function runSweep() {
  const { POST } = await import('@/app/api/cron/reap-audits/route');
  return POST(new Request('https://lexyflow.com/api/cron/reap-audits', { method: 'POST' }));
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('GET/POST /api/cron/reap-audits', () => {
  it('fails stale audits and refunds only those that spent a credit', async () => {
    const journal: Journal = { refunds: [] };
    installDb(
      [
        { id: 'a1', organization_id: 'org-paid', credit_consumed: true },
        { id: 'a2', organization_id: 'org-free', credit_consumed: false }
      ],
      journal
    );

    const res = await runSweep();
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, reaped: 2, refunded: 1 });
    // A free-trial audit spent nothing, so refunding it would mint a
    // credit out of thin air.
    expect(journal.refunds).toEqual(['org-paid']);
    expect(journal.patch).toMatchObject({ status: 'failed' });
    expect(String(journal.patch?.error_message)).toMatch(/reaped/);
  });

  it('only ever touches unfinished audits, and only old ones', async () => {
    const journal: Journal = { refunds: [] };
    installDb([], journal);

    await runSweep();

    // The status filter is what makes this safe against a live audit:
    // whichever writer moves the row out of `running` first wins, and
    // the other matches nothing — so a credit cannot be refunded twice.
    expect(journal.statusFilter).toEqual(['running', 'pending']);
    const cutoffAge = Date.now() - new Date(String(journal.cutoff)).getTime();
    // Comfortably beyond the audit function's own 800s ceiling.
    expect(cutoffAge).toBeGreaterThan(15 * 60_000);
  });

  it('reports a failed sweep instead of claiming success', async () => {
    const journal: Journal = { refunds: [] };
    installDb([], journal, 'connection reset');

    const res = await runSweep();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('sweep_failed');
    expect(journal.refunds).toEqual([]);
  });

  it('refuses an unauthenticated call in production', async () => {
    const journal: Journal = { refunds: [] };
    installDb([], journal);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'topsecret');

    const { POST } = await import('@/app/api/cron/reap-audits/route');
    const res = await POST(
      new Request('https://lexyflow.com/api/cron/reap-audits', { method: 'POST' })
    );

    expect(res.status).toBe(401);
    expect(journal.patch).toBeUndefined();
  });
});
