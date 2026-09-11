import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Findings must be attributed to a framework that exists.
 *
 * `audit_findings.framework_id` is a foreign key, and the insert is a
 * single batch: one unrecognised value discards every finding in the
 * audit. On 11 Sep 2026 a GDPR + EU AI Act audit produced risk score 72
 * and then failed outright on that constraint, because the model was
 * asked for a "framework id" it had never been shown — the prompt
 * listed display names only. It guessed `gdpr`, `qatar_pdppl` and
 * `saudi_pdpl` right, and the EU AI Act wrong.
 *
 * The tool schema now constrains the field to an enum of the ids in
 * scope. These tests cover the belt-and-braces resolver behind it, and
 * in particular that it never silently attributes a finding to the
 * wrong regulation: a citation and a verbatim quote filed under a
 * statute they have nothing to do with is worse than no report.
 */

vi.mock('server-only', () => ({}));

const mockCreate = vi.fn();
const mockAlertOps = vi.fn();

vi.mock('@/lib/alert', () => ({ alertOps: mockAlertOps }));
vi.mock('../src/lib/alert', () => ({ alertOps: mockAlertOps }));

vi.mock('../src/lib/ai-clients', () => ({
  ANTHROPIC_MODEL: 'claude-test',
  OPENAI_MODEL: 'gpt-test',
  anthropic: () => ({ messages: { create: mockCreate } }),
  openai: () => ({ chat: { completions: { create: vi.fn() } } })
}));

function finding(framework: string) {
  return {
    framework,
    citation: 'Art. 13(2)(a)',
    severity: 'high' as const,
    title: 'Retention period not stated',
    body: 'The policy omits the storage period.',
    recommendation: 'State it explicitly.',
    evidence: 'We keep your data as long as necessary.'
  };
}

/** Anthropic returns the audit through a tool_use block. */
function anthropicReply(
  findings: ReturnType<typeof finding>[] | string,
  stopReason = 'tool_use'
) {
  return {
    stop_reason: stopReason,
    content: [
      {
        type: 'tool_use',
        name: 'submit_audit',
        input: { summary: 'Gaps found.', riskScore: 72, findings }
      }
    ]
  };
}

async function audit(frameworks: string[], findings: ReturnType<typeof finding>[]) {
  mockCreate.mockResolvedValue(anthropicReply(findings));
  const { legalAudit } = await import('../src/lib/multi-pass-engine');
  return legalAudit({
    documentText: 'a privacy policy',
    frameworks: frameworks as never,
    targetLanguage: 'en'
  });
}

beforeEach(() => {
  mockCreate.mockReset();
  mockAlertOps.mockClear();
});

describe('Framework attribution of findings', () => {
  it('passes ids through untouched when the model uses them correctly', async () => {
    const result = await audit(['gdpr', 'eu_ai_act'], [finding('gdpr'), finding('eu_ai_act')]);

    expect(result.findings.map((f) => f.framework)).toEqual(['gdpr', 'eu_ai_act']);
    expect(mockAlertOps).not.toHaveBeenCalled();
  });

  it('offers the in-scope ids to the model rather than making it guess', async () => {
    await audit(['gdpr', 'eu_ai_act'], [finding('gdpr')]);

    const call = mockCreate.mock.calls[0]?.[0];
    // The ids must appear in the prompt...
    expect(call.system).toContain('id: eu_ai_act');
    expect(call.system).toContain('id: gdpr');
    // ...and the schema must constrain the field to them.
    const schema = call.tools[0].input_schema.properties.findings.items.properties.framework;
    expect(schema.enum).toEqual(['gdpr', 'eu_ai_act']);
  });

  it('recovers a near-miss id and flags it, instead of failing the batch', async () => {
    // "EU AI Act" — the display name rather than the id.
    const result = await audit(['gdpr', 'eu_ai_act'], [finding('EU AI Act')]);

    expect(result.findings[0]?.framework).toBe('eu_ai_act');
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.framework_id_normalised',
      expect.objectContaining({ returned: 'EU AI Act', resolved: 'eu_ai_act' })
    );
  });

  it('attributes to the only framework in scope on a single-framework audit', async () => {
    const result = await audit(['qatar_pdppl'], [finding('qatar-pdppl-2016')]);
    expect(result.findings[0]?.framework).toBe('qatar_pdppl');
  });

  it('names truncation instead of letting it surface as a schema error', async () => {
    // What a GDPR + EU AI Act audit actually did on 11 Sep: 113 seconds
    // of generation, then `findings: expected array, received string`
    // — a cut-off tool input, not a schema problem.
    mockCreate.mockResolvedValue(anthropicReply('[{"framework":"gdpr","cita', 'max_tokens'));
    const { legalAudit } = await import('../src/lib/multi-pass-engine');

    await expect(
      legalAudit({
        documentText: 'a privacy policy',
        frameworks: ['gdpr', 'eu_ai_act'] as never,
        targetLanguage: 'en'
      })
    ).rejects.toThrow(/output ceiling/);
  });

  it('recovers a findings array that arrives serialised rather than losing the run', async () => {
    mockCreate.mockResolvedValue(anthropicReply(JSON.stringify([finding('gdpr')])));
    const { legalAudit } = await import('../src/lib/multi-pass-engine');

    const result = await legalAudit({
      documentText: 'a privacy policy',
      frameworks: ['gdpr'] as never,
      targetLanguage: 'en'
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.framework).toBe('gdpr');
    expect(mockAlertOps).toHaveBeenCalledWith(
      'audit.findings_arrived_as_string',
      expect.anything()
    );
  });

  it('grows the output budget with the number of frameworks', async () => {
    mockCreate.mockResolvedValue(anthropicReply([finding('gdpr')]));
    const { legalAudit } = await import('../src/lib/multi-pass-engine');
    await legalAudit({
      documentText: 'x',
      frameworks: ['gdpr'] as never,
      targetLanguage: 'en'
    });
    const single = mockCreate.mock.calls[0]?.[0].max_tokens;

    mockCreate.mockClear();
    mockCreate.mockResolvedValue(anthropicReply([finding('gdpr'), finding('eu_ai_act')]));
    await legalAudit({
      documentText: 'x',
      frameworks: ['gdpr', 'eu_ai_act'] as never,
      targetLanguage: 'en'
    });
    const pair = mockCreate.mock.calls[0]?.[0].max_tokens;

    expect(pair).toBeGreaterThan(single);
  });

  it('refuses to guess when the value matches nothing in a multi-framework scope', async () => {
    // Attributing this to either one would file a verbatim quote under
    // a statute it has nothing to do with.
    await expect(audit(['gdpr', 'eu_ai_act'], [finding('ccpa')])).rejects.toThrow(
      /outside the audit scope/
    );
  });
});
