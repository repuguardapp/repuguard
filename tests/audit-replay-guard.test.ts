import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A finished audit must never be discarded in favour of a failed one.
 *
 * audits_dedup_idx makes a second audit of the same document, language
 * and framework scope a unique violation, which the route treats as an
 * idempotent replay: hand back the existing row, refund the credit.
 * That is right when the existing row is a report. It is badly wrong
 * when it is a failure.
 *
 * On 11 Sep 2026 a GDPR + EU AI Act audit ran for 182 seconds, produced
 * 12 findings at risk score 52, collided with a failed row for the same
 * document from two hours earlier, and the customer was shown that
 * failure — "Audit non abouti" — while the audit they had just paid for
 * was thrown away.
 *
 * The unusable row is now overwritten with the new result instead.
 */

vi.mock('server-only', () => ({}));

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STALE_AUDIT_ID = '40d03281-8778-4db7-8465-d60f8d6de0d7';

/** Records what the route did to the database. */
interface Journal {
  updatedAudit?: Record<string, unknown>;
  deletedFindingsFor?: string;
  insertedFindings: number;
  refunds: string[];
}

function installMocks(existingStatus: string, journal: Journal) {
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
  vi.doMock('@/lib/document-extractor', () => ({
    extractText: async () => ({ type: 'txt', text: 'a privacy policy', charCount: 16, redactionCount: 0 })
  }));
  vi.doMock('@/lib/zero-knowledge', () => ({
    hashDocument: () => 'hash-of-the-same-document',
    wipeBuffer: () => undefined
  }));
  // Pass 1 + 2 succeed with a real result — this is the audit that
  // must not be thrown away.
  vi.doMock('@/lib/multi-pass-engine', () => ({
    runMultiPassAudit: async () => ({
      documentHash: 'hash-of-the-same-document',
      frameworks: ['eu_ai_act', 'gdpr'],
      language: 'fr',
      generatedAt: new Date().toISOString(),
      summary: 'Twelve gaps found.',
      riskScore: 52,
      findings: Array.from({ length: 12 }, (_, i) => ({
        id: `f${i}`,
        framework: 'gdpr',
        citation: 'GDPR Art. 13',
        severity: 'high',
        title: `Finding ${i}`,
        body: 'body',
        recommendation: 'fix it',
        evidence: 'quote'
      }))
    })
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
            // The insert always collides — that is the scenario.
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' }
                })
              })
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [
                      {
                        id: STALE_AUDIT_ID,
                        risk_score: 72,
                        frameworks: ['eu_ai_act', 'gdpr'],
                        status: existingStatus
                      }
                    ],
                    error: null
                  })
                }),
                maybeSingle: async () => ({ data: { retain_documents: false }, error: null }),
                limit: async () => ({ data: [], count: 0, error: null })
              })
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                journal.updatedAudit = patch;
                return { error: null };
              }
            })
          };
        }
        if (table === 'audit_findings') {
          return {
            insert: async (rows: unknown[]) => {
              journal.insertedFindings = Array.isArray(rows) ? rows.length : 0;
              return { error: null };
            },
            delete: () => ({
              eq: async (_col: string, id: string) => {
                journal.deletedFindingsFor = id;
                return { error: null };
              }
            }),
            select: () => ({ eq: async () => ({ count: 0, error: null }) })
          };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) })
        };
      }
    })
  }));
}

async function runAudit() {
  const form = new FormData();
  form.set('document', new Blob([new TextEncoder().encode('policy')]), 'policy.txt');
  form.set('organizationId', ORG);
  form.append('frameworks', 'gdpr');
  form.append('frameworks', 'eu_ai_act');
  form.set('targetLanguage', 'fr');

  const { POST } = await import('@/app/api/audit/route');
  const res = await POST(new Request('https://lexyflow.com/api/audit', { method: 'POST', body: form }));
  return res.text();
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('POST /api/audit — replaying an existing audit', () => {
  it('overwrites a failed row with the audit that just succeeded', async () => {
    const journal: Journal = { insertedFindings: 0, refunds: [] };
    installMocks('failed', journal);

    const body = await runAudit();

    // The stale row is rewritten as a completed report, not replayed.
    expect(journal.updatedAudit).toMatchObject({ status: 'completed', risk_score: 52 });
    expect(journal.updatedAudit?.error_message).toBeNull();
    // Its previous findings are cleared so two runs cannot mix.
    expect(journal.deletedFindingsFor).toBe(STALE_AUDIT_ID);
    // And the 12 findings we just produced are written.
    expect(journal.insertedFindings).toBe(12);
    // The customer is sent to a report, not to the old failure.
    expect(body).toContain(STALE_AUDIT_ID);
    expect(body).not.toContain('"replay":true');
  });

  it('still replays a completed row untouched, and refunds', async () => {
    const journal: Journal = { insertedFindings: 0, refunds: [] };
    installMocks('completed', journal);

    const body = await runAudit();

    // Genuine idempotency: nothing rewritten, nothing re-inserted.
    expect(journal.updatedAudit).toBeUndefined();
    expect(journal.insertedFindings).toBe(0);
    expect(body).toContain('"replay":true');
    expect(journal.refunds).toHaveLength(1);
  });
});
