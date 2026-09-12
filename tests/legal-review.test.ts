import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The review queue is the editorial gate of the acquisition engine —
 * the single point where responsibility for a public statement
 * transfers from a model to us.
 *
 * Two properties hold it up. Nobody who is not on the allowlist can
 * reach it, including when the allowlist is simply not configured. And
 * a decision is taken exactly once, whatever a stale tab or a
 * double-click does.
 */

vi.mock('server-only', () => ({}));

interface Journal {
  patches: Record<string, unknown>[];
  filters: [string, unknown][];
}

let journal: Journal;
let currentUser: { id: string; email: string | null } | null;
/** Rows the guarded UPDATE reports as changed. Empty = already reviewed. */
let updated: { id: string }[];

function install() {
  vi.doMock('@/lib/supabase-server', () => ({
    getCurrentUser: async () => currentUser
  }));
  vi.doMock('@/lib/alert', () => ({ alertOps: () => undefined }));
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          journal.patches.push(patch);
          const chain = {
            eq: (col: string, val: unknown) => {
              journal.filters.push([col, val]);
              return chain;
            },
            select: async () => ({ data: updated, error: null })
          };
          return chain;
        }
      })
    })
  }));
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/admin/legal-review/route');
  const res = await POST(
    new Request('https://lexyflow.com/api/admin/legal-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const ID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.resetModules();
  journal = { patches: [], filters: [] };
  updated = [{ id: ID }];
  currentUser = { id: 'u1', email: 'owner@lexyflow.com' };
  process.env['ADMIN_EMAILS'] = 'owner@lexyflow.com';
  install();
});

describe('the gate is closed by default', () => {
  it('refuses when no allowlist is configured at all', async () => {
    // A missing env var must close the gate, not open it. This is the
    // difference between a forgotten variable and a public admin.
    delete process.env['ADMIN_EMAILS'];
    const { status } = await post({ developmentId: ID, action: 'approve' });

    expect(status).toBe(403);
    expect(journal.patches).toHaveLength(0);
  });

  it('refuses a signed-in user who is not on the allowlist', async () => {
    currentUser = { id: 'u2', email: 'stranger@example.com' };
    const { status, body } = await post({ developmentId: ID, action: 'approve' });

    expect(status).toBe(403);
    // Same answer as for a signed-out visitor: the existence of the
    // queue is not something a logged-in stranger needs confirmed.
    expect(body).toEqual({ error: 'forbidden' });
  });

  it('refuses an anonymous visitor', async () => {
    currentUser = null;
    expect((await post({ developmentId: ID, action: 'approve' })).status).toBe(403);
  });

  it('matches the allowlist case-insensitively', async () => {
    currentUser = { id: 'u1', email: 'Owner@LexyFlow.com' };
    expect((await post({ developmentId: ID, action: 'approve' })).status).toBe(200);
  });
});

describe('a decision is taken exactly once', () => {
  it('only ever writes to an item still awaiting review', async () => {
    await post({ developmentId: ID, action: 'approve' });

    // The status guard is what makes a double-click harmless and stops
    // a stale tab re-deciding something already handled.
    expect(journal.filters).toContainEqual(['status', 'extracted']);
    expect(journal.filters).toContainEqual(['id', ID]);
  });

  it('reports a conflict instead of overwriting an existing decision', async () => {
    updated = [];
    const { status, body } = await post({ developmentId: ID, action: 'approve' });

    expect(status).toBe(409);
    expect(body['reason']).toBe('already_reviewed');
  });
});

describe('what approval and rejection actually record', () => {
  it('approval clears the item for publication without publishing it', async () => {
    const { status } = await post({ developmentId: ID, action: 'approve' });
    expect(status).toBe(200);

    const patch = journal.patches[0]!;
    // `approved`, never `published`: the approver is agreeing the facts
    // match the source, not proofreading six translations that do not
    // exist yet.
    expect(patch['status']).toBe('approved');
    expect(patch['reviewed_at']).toBeTruthy();
    // A previous rejection reason must not survive an approval.
    expect(patch['rejected_reason']).toBeNull();
  });

  it('rejection always records a reason, even when none was typed', async () => {
    await post({ developmentId: ID, action: 'reject' });
    const patch = journal.patches[0]!;

    expect(patch['status']).toBe('rejected');
    expect(patch['rejected_reason']).toBe('rejected in review');
  });

  it('keeps the reason the reviewer gave', async () => {
    await post({ developmentId: ID, action: 'reject', reason: 'summary misstates the fine' });
    expect(journal.patches[0]!['rejected_reason']).toBe('summary misstates the fine');
  });

  it('rejects an action it does not recognise rather than guessing', async () => {
    const { status } = await post({ developmentId: ID, action: 'publish' });
    expect(status).toBe(400);
    expect(journal.patches).toHaveLength(0);
  });
});
