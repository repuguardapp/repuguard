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

/**
 * Once the pivot cache removed pass 1 from repeat audits, pass 2 became
 * the entire remaining wait: one sequential request generating six to
 * seven thousand tokens. Chunking translates the findings concurrently
 * for the same token count — so what these tests protect is that the
 * chunks are actually in flight together, and that reassembly keeps
 * every translation on its own finding.
 */
describe('Pass 2 localization — concurrent chunks', () => {
  const many = {
    summary: 'Nine gaps identified.',
    riskScore: 61,
    findings: Array.from({ length: 9 }, (_, i) => ({
      framework: 'gdpr',
      citation: `GDPR Art. ${i + 1}`,
      severity: 'medium' as const,
      title: `Gap ${i}`,
      body: `Body ${i}`,
      recommendation: `Fix ${i}`,
      evidence: `Evidence ${i}`
    }))
  };

  async function localizeMany(targetLanguage = 'fr') {
    const { localizeReport } = await import('../src/lib/multi-pass-engine');
    return localizeReport(many, targetLanguage);
  }

  /** Translate a chunk request into a plausible reply of the same size. */
  function replyFor(call: { messages: { role: string; content: string }[] }) {
    const payload = JSON.parse(call.messages[1]!.content) as {
      summary?: string;
      findings: { title: string }[];
    };
    return openAiReply({
      ...(payload.summary ? { summary: `FR:${payload.summary}` } : {}),
      findings: payload.findings.map((f) => ({
        title: `FR:${f.title}`,
        body: 'b',
        recommendation: 'r'
      }))
    });
  }

  it('issues every chunk before any of them resolves, and reassembles in order', async () => {
    // Hold each request open until all of them have been made. If the
    // implementation ever goes back to awaiting one chunk at a time
    // this deadlocks and the test times out rather than passing quietly.
    const release: (() => void)[] = [];
    mockCreate.mockImplementation(
      (call: { messages: { role: string; content: string }[] }) =>
        new Promise((resolve) => {
          release.push(() => resolve(replyFor(call)));
        })
    );

    const pending = localizeMany('fr');
    // Let the synchronous fan-out run.
    await vi.waitFor(() => expect(release).toHaveLength(3));
    release.forEach((fn) => fn());

    const { report, language } = await pending;
    expect(language).toBe('fr');
    // 9 findings at 4 per chunk.
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(report.summary).toBe('FR:Nine gaps identified.');
    // Order survived the fan-out: finding i still carries its own text.
    report.findings.forEach((f, i) => {
      expect(f.title).toBe(`FR:Gap ${i}`);
      expect(f.citation).toBe(`GDPR Art. ${i + 1}`);
      expect(f.evidence).toBe(`Evidence ${i}`);
    });
  });

  it('sends the summary once, with the first chunk only', async () => {
    mockCreate.mockImplementation((call: { messages: { role: string; content: string }[] }) =>
      Promise.resolve(replyFor(call))
    );

    await localizeMany('fr');
    const payloads = mockCreate.mock.calls.map(
      (c) => JSON.parse((c[0] as { messages: { content: string }[] }).messages[1]!.content) as { summary?: string }
    );
    expect(payloads.filter((p) => p.summary !== undefined)).toHaveLength(1);
    expect(payloads[0]?.summary).toBe('Nine gaps identified.');
  });

  it('degrades the whole report to English when one chunk fails', async () => {
    // A report half in French and half in English reads as broken, and
    // the reader cannot tell which half to trust.
    let call = 0;
    mockCreate.mockImplementation((c: { messages: { role: string; content: string }[] }) => {
      call += 1;
      if (call === 2) return Promise.resolve(openAiReply({ findings: [] }));
      return Promise.resolve(replyFor(c));
    });

    const { report, language } = await localizeMany('fr');
    expect(language).toBe('en');
    expect(report.findings).toHaveLength(9);
    report.findings.forEach((f, i) => expect(f.title).toBe(`Gap ${i}`));
    expect(report.summary).toBe('Nine gaps identified.');
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.localization_degraded',
      expect.objectContaining({ reason: 'findings_count_mismatch' })
    );
  });
});
