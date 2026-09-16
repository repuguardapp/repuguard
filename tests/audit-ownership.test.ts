import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The polling route reads with the service role, which bypasses RLS.
 *
 * It returned the status, the RISK SCORE and the findings count for any
 * audit id, to anyone who asked. The id is a UUID so it is not
 * guessable — and it is not secret either: it sits in a dashboard URL,
 * in a completion email, in browser history, and in the Referer of
 * anything that page links out to. "Hard to guess" is the security
 * model of a share link, and a customer's compliance score is not one.
 */

vi.mock('server-only', () => ({}));

const ANON = '00000000-0000-0000-0000-000000000000';
const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';

let audit: Record<string, unknown> | null;
let viewerOrg: string | null;

function install() {
  vi.doMock('@/lib/access-log', () => ({ logAccess: async () => undefined }));
  vi.doMock('@/lib/rate-limit', () => ({ clientIpFrom: () => '1.2.3.4' }));
  vi.doMock('@/lib/deletion-receipt', () => ({
    hashAuditId: () => 'h', signDeletionReceipt: () => 's'
  }));
  vi.doMock('@/lib/supabase-server', () => ({
    getCurrentUser: async () => (viewerOrg ? { id: 'u', email: 'a@b.c' } : null),
    organizationIdFromUser: () => viewerOrg
  }));
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: audit, error: null }),
            // findings count
            then: (r: (v: unknown) => unknown) => Promise.resolve({ count: 3 }).then(r)
          })
        })
      })
    })
  }));
}

async function get(id: string) {
  const { GET } = await import('@/app/api/audit/[id]/route');
  return GET(new Request(`https://lexyflow.com/api/audit/${id}`), { params: { id } });
}

const BASE = {
  id: '33333333-3333-3333-3333-333333333333',
  status: 'completed',
  risk_score: 31,
  language: 'fr',
  created_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  error_message: null
};

beforeEach(() => {
  vi.resetModules();
  audit = { ...BASE, organization_id: OWNER };
  viewerOrg = null;
  install();
});

describe('a stranger cannot read an audit by its id', () => {
  it('refuses an anonymous caller', async () => {
    const res = await get(BASE.id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('31');
  });

  it('refuses a signed-in member of another organisation', async () => {
    viewerOrg = STRANGER;
    const res = await get(BASE.id);
    expect(res.status).toBe(404);
  });

  it('answers 404, not 403 — whether an id exists is information', async () => {
    viewerOrg = STRANGER;
    const stranger = await get(BASE.id);
    audit = null;
    const missing = await get(BASE.id);
    expect(stranger.status).toBe(missing.status);
  });

  it('never leaks the risk score on a refusal', async () => {
    viewerOrg = STRANGER;
    const body = JSON.stringify(await (await get(BASE.id)).json());
    for (const leak of ['31', 'completed', 'riskScore', 'findingsCount']) {
      expect(body, leak).not.toContain(leak);
    }
  });
});

describe('the people who should read it, still can', () => {
  it('serves the owner', async () => {
    viewerOrg = OWNER;
    const res = await get(BASE.id);
    expect(res.status).toBe(200);
    expect((await res.json()).riskScore).toBe(31);
  });

  it('serves an anonymous-org audit with no session at all', async () => {
    // The marketing funnel: no account, the browser polls this while
    // the upload runs, and the unguessable id IS the credential. Same
    // contract /api/audit/[id]/document applies in the other direction.
    audit = { ...BASE, organization_id: ANON };
    viewerOrg = null;
    const res = await get(BASE.id);
    expect(res.status).toBe(200);
  });
});
