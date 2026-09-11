import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One audit, every language, one credit.
 *
 * Pass 1 audits in English and costs roughly ten times pass 2, which
 * only translates it. Pass 1 does not depend on the target language, so
 * re-running it to produce the same audit in a second language pays
 * twice for identical work — and charges the customer twice for it.
 *
 * Reusing the pivot is what lets a group operating across jurisdictions
 * read the same audit in Arabic and English for the price of one, which
 * no competitor running a single-pass architecture can match without
 * rebuilding their engine.
 *
 * The cache is also strictly optional: an audit must never fail because
 * a cache did.
 */

vi.mock('server-only', () => ({}));

const mockAnthropic = vi.fn();
const mockOpenAI = vi.fn();
const mockAlertOps = vi.fn();

vi.mock('@/lib/alert', () => ({ alertOps: mockAlertOps }));
vi.mock('../src/lib/alert', () => ({ alertOps: mockAlertOps }));

vi.mock('../src/lib/ai-clients', () => ({
  ANTHROPIC_MODEL: 'claude-test',
  OPENAI_MODEL: 'gpt-test',
  anthropic: () => ({ messages: { create: mockAnthropic } }),
  openai: () => ({ chat: { completions: { create: mockOpenAI } } })
}));

const PIVOT = {
  summary: 'Two gaps found.',
  riskScore: 52,
  findings: [
    {
      framework: 'gdpr',
      citation: 'GDPR Art. 13(2)(a)',
      severity: 'high' as const,
      title: 'Retention period not stated',
      body: 'The policy omits the storage period.',
      recommendation: 'State it explicitly.',
      evidence: 'We keep your data as long as necessary.'
    }
  ]
};

function anthropicReply() {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'submit_audit', input: PIVOT }]
  };
}

function openAiReply() {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            summary: 'Deux lacunes identifiées.',
            findings: [
              {
                title: 'Durée de conservation non précisée',
                body: 'La politique omet la durée.',
                recommendation: 'Indiquez-la.'
              }
            ]
          })
        }
      }
    ]
  };
}

async function audit(cache?: {
  read: () => Promise<unknown | null>;
  write: (p: unknown) => Promise<void>;
}) {
  const { runMultiPassAudit } = await import('../src/lib/multi-pass-engine');
  return runMultiPassAudit(
    { documentText: 'a privacy policy', frameworks: ['gdpr'] as never, targetLanguage: 'fr' },
    cache as never
  );
}

beforeEach(() => {
  mockAnthropic.mockReset().mockResolvedValue(anthropicReply());
  mockOpenAI.mockReset().mockResolvedValue(openAiReply());
  mockAlertOps.mockClear();
});

describe('Pass 1 pivot cache', () => {
  it('skips the expensive pass when the pivot is already known', async () => {
    const read = vi.fn(async () => PIVOT);
    const write = vi.fn(async () => undefined);

    const report = await audit({ read, write });

    // The costly call never happens; only the translation is billed.
    expect(mockAnthropic).not.toHaveBeenCalled();
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(report.findings[0]?.title).toBe('Durée de conservation non précisée');
    // Citations and evidence still come from the pivot, untranslated.
    expect(report.findings[0]?.citation).toBe('GDPR Art. 13(2)(a)');
  });

  it('stores the pivot on a miss so the next language is cheap', async () => {
    const write = vi.fn(async () => undefined);

    await audit({ read: async () => null, write });

    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({ riskScore: 52 });
  });

  it('audits normally when the cache read throws', async () => {
    const report = await audit({
      read: async () => {
        throw new Error('cache unreachable');
      },
      write: async () => undefined
    });

    expect(report.riskScore).toBe(52);
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.pivot_cache_read_failed',
      expect.anything()
    );
  });

  it('delivers the audit even when the pivot cannot be stored', async () => {
    const report = await audit({
      read: async () => null,
      write: async () => {
        throw new Error('disk full');
      }
    });

    // The customer paid for this audit — a cache write is not a reason
    // to lose it.
    expect(report.findings).toHaveLength(1);
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.pivot_cache_write_failed',
      expect.anything()
    );
  });

  it('ignores a corrupted pivot and re-audits rather than trusting it', async () => {
    const report = await audit({
      read: async () => ({ summary: 'nonsense', riskScore: 'not a number' }),
      write: async () => undefined
    });

    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(report.riskScore).toBe(52);
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.pivot_cache_unreadable',
      expect.anything()
    );
  });

  it('runs without a cache at all', async () => {
    const report = await audit();
    expect(report.riskScore).toBe(52);
    expect(mockAnthropic).toHaveBeenCalledTimes(1);
  });
});
