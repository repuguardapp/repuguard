import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pass 2 (localization) must never destroy pass 1 (the audit itself).
 *
 * Regression cover for a production failure reproduced on 10 Sep 2026:
 * auditing our own privacy policy against GDPR alone succeeded, while
 * GDPR + EU AI Act failed outright with `multipass_failed`. Two
 * frameworks means roughly twice the findings, and pass 2 threw on any
 * imperfection in the translated payload — so the failure probability
 * scaled with the size of the report. A finished, paid-for audit was
 * discarded because a translator returned an imperfect array.
 */

vi.mock('server-only', () => ({}));

const mockCreate = vi.fn();
const mockAlertOps = vi.fn();

vi.mock('@/lib/alert', () => ({ alertOps: mockAlertOps }));
vi.mock('../src/lib/alert', () => ({ alertOps: mockAlertOps }));

vi.mock('../src/lib/ai-clients', () => ({
  ANTHROPIC_MODEL: 'claude-test',
  OPENAI_MODEL: 'gpt-test',
  anthropic: () => ({ messages: { create: vi.fn() } }),
  openai: () => ({ chat: { completions: { create: mockCreate } } })
}));

const pass1 = {
  summary: 'Two material gaps identified.',
  riskScore: 47,
  findings: [
    {
      framework: 'gdpr',
      citation: 'GDPR Art. 13(2)(a)',
      severity: 'high' as const,
      title: 'Retention period not stated',
      body: 'The policy omits the storage period.',
      recommendation: 'State the retention period explicitly.',
      evidence: 'We keep your data as long as necessary.'
    },
    {
      framework: 'eu_ai_act',
      citation: 'EU AI Act Art. 50(1)',
      severity: 'medium' as const,
      title: 'No AI interaction disclosure',
      body: 'Users are not told they interact with an AI system.',
      recommendation: 'Disclose AI involvement at first contact.',
      evidence: 'Our engine analyses your document automatically.'
    }
  ]
};

/** Shape of a well-formed pass-2 response for N findings. */
function openAiReply(content: unknown, finishReason = 'stop') {
  return {
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }]
  };
}

async function localize(targetLanguage = 'fr') {
  const { localizeReport } = await import('../src/lib/multi-pass-engine');
  return localizeReport(pass1, targetLanguage);
}

beforeEach(() => {
  mockCreate.mockReset();
  mockAlertOps.mockClear();
});

describe('Pass 2 localization — degradation instead of total loss', () => {
  it('translates and reports the target language on the happy path', async () => {
    mockCreate.mockResolvedValue(
      openAiReply({
        summary: 'Deux lacunes matérielles identifiées.',
        findings: [
          { title: 'Durée de conservation non précisée', body: 'La politique omet la durée.', recommendation: 'Indiquez la durée.' },
          { title: "Absence d'information sur l'IA", body: 'Les utilisateurs ne sont pas informés.', recommendation: "Divulguez l'usage de l'IA." }
        ]
      })
    );

    const { report, language } = await localize('fr');
    expect(language).toBe('fr');
    expect(report.findings[0]?.title).toBe('Durée de conservation non précisée');
    // Citations and evidence are never translated.
    expect(report.findings[0]?.citation).toBe('GDPR Art. 13(2)(a)');
    expect(report.findings[1]?.evidence).toBe('Our engine analyses your document automatically.');
    expect(mockAlertOps).not.toHaveBeenCalled();
  });

  it('falls back to English — never a positional remap — when the findings count drifts', async () => {
    // The translator dropped one entry. Remapping by index would put
    // the AI Act translation onto the GDPR citation and evidence.
    mockCreate.mockResolvedValue(
      openAiReply({
        summary: 'Une lacune identifiée.',
        findings: [{ title: "Absence d'information sur l'IA", body: 'x', recommendation: 'y' }]
      })
    );

    const { report, language } = await localize('fr');
    expect(language).toBe('en');
    expect(report.findings).toHaveLength(2);
    // Each finding kept its own original text — no cross-contamination.
    expect(report.findings[0]?.title).toBe('Retention period not stated');
    expect(report.findings[0]?.citation).toBe('GDPR Art. 13(2)(a)');
    expect(report.findings[1]?.title).toBe('No AI interaction disclosure');
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.localization_degraded',
      expect.objectContaining({ reason: 'findings_count_mismatch', expected: 2, received: 1 })
    );
  });

  it('falls back to English when the response is truncated', async () => {
    mockCreate.mockResolvedValue(openAiReply({ summary: 'partial', findings: [] }, 'length'));

    const { report, language } = await localize('fr');
    expect(language).toBe('en');
    expect(report.summary).toBe('Two material gaps identified.');
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.localization_degraded',
      expect.objectContaining({ reason: 'truncated' })
    );
  });

  it('falls back to English when the provider call throws outright', async () => {
    mockCreate.mockRejectedValue(new Error('socket hang up'));

    const { report, language } = await localize('fr');
    expect(language).toBe('en');
    expect(report.riskScore).toBe(47);
    expect(report.findings).toHaveLength(2);
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.localization_degraded',
      expect.objectContaining({ reason: 'pass2_threw' })
    );
  });

  it('skips pass 2 entirely for an English target', async () => {
    const { language } = await localize('en-GB');
    expect(language).toBe('en-GB');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockAlertOps).not.toHaveBeenCalled();
  });
});
