import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The engine is `server-only`; the score function is pure arithmetic.
vi.mock('server-only', () => ({}));

const { deriveRiskScore } = await import('@/lib/multi-pass-engine');

/**
 * The first audit this company ever ran, and the sentence it printed.
 *
 * A taxi operator's licence letter to a préfecture, uploaded on
 * 19 October 2026. The report came back: "Le document est évalué comme
 * étant pleinement conforme à la fois au règlement sur l'IA de l'UE
 * (Règlement 2024/1689) et au RGPD", "Aucune constatation — votre
 * document est en règle", and "Score de risque : 2 / 100".
 *
 * Three claims, none of which we can stand behind, about a letter
 * asking to keep driving a car.
 *
 * Finding nothing is not the same as there being nothing. Pass 1 reads
 * ONE document against the frameworks the customer ticked. It does not
 * see the processing the document describes, the systems behind it, the
 * contracts, the registers, or anything the document omits — and a
 * privacy policy can be immaculately drafted while describing unlawful
 * processing.
 *
 * The artefact outlives the conversation. A customer who is later
 * investigated holds a PDF from a compliance vendor saying they were
 * compliant. That is the worst sentence this company could print, and
 * the engine was printing it by instruction.
 */

const ENGINE = readFileSync(join(__dirname, '..', 'src/lib/multi-pass-engine.ts'), 'utf8');
const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;
const report = (l: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', `messages/${l}.json`), 'utf8')).report as Record<
    string,
    string
  >;

describe('the engine never certifies compliance', () => {
  it('no longer tells the model that an empty result means compliant', () => {
    expect(ENGINE).not.toContain('only valid when the document is fully');
    expect(ENGINE).toContain('You NEVER state or imply that the document is compliant');
  });

  it('says what an empty result IS, so the model has something to write', () => {
    // Forbidding a sentence without supplying the replacement is how a
    // model invents a third option.
    expect(ENGINE).toContain('which');
    expect(ENGINE).toContain('surfaced nothing against them');
  });
});

describe('no findings is reported as no findings, in every language', () => {
  it('no longer carries the claim it used to', () => {
    // Banning a lemma is the wrong instrument: the replacement sentences
    // say "not a statement that your organisation complies", so the word
    // appears inside its own negation. What must be gone is the CLAIM,
    // and these are the exact strings that made it.
    const gone = ['votre document est en règle', 'your document is in good shape'];
    for (const locale of LOCALES) {
      const text = report(locale)['noFindings'] ?? '';
      for (const claim of gone) expect(text).not.toContain(claim);
    }
  });

  it('negates the verdict explicitly, in each language', () => {
    // The sentence has to do more than omit the claim — a reader
    // supplies it themselves otherwise. Each locale names what this is
    // NOT, in its own words.
    const negation: Record<string, string> = {
      en: 'not a statement',
      fr: 'pas une déclaration',
      es: 'no una declaración',
      de: 'keine Aussage darüber',
      'pt-br': 'não uma declaração',
      ja: 'ではありません',
      ar: 'وليست'
    };
    for (const locale of LOCALES) {
      expect(report(locale)['noFindings']).toContain(negation[locale]);
    }
  });

  it('states the limit of the reading rather than only the result', () => {
    // The sentence has to carry what the pass could not see, or "no
    // findings" is read as "nothing to worry about".
    for (const locale of LOCALES) {
      expect(report(locale)['noFindings']!.length).toBeGreaterThan(120);
    }
  });
});

describe('the published risk score is derived from what the reader can see', () => {
  it('is zero when there is nothing to measure', () => {
    // The taxi letter scored 2/100. Nothing measured 2: the prompt said
    // "≤ 10" and the model picked a number inside the band.
    expect(deriveRiskScore([])).toBe(0);
  });

  it('lets the worst finding set the floor', () => {
    expect(deriveRiskScore([{ severity: 'critical' }])).toBe(70);
    expect(deriveRiskScore([{ severity: 'high' }])).toBe(40);
    expect(deriveRiskScore([{ severity: 'medium' }])).toBe(20);
    expect(deriveRiskScore([{ severity: 'low' }])).toBe(8);
    expect(deriveRiskScore([{ severity: 'info' }])).toBe(2);
  });

  it('counts the rest, because ten failures are worse than one', () => {
    expect(deriveRiskScore([{ severity: 'medium' }, { severity: 'medium' }])).toBe(25);
    expect(deriveRiskScore([{ severity: 'critical' }, { severity: 'low' }])).toBe(75);
  });

  it('is reproducible by hand from the findings list', () => {
    // The only property that makes a score worth printing: somebody who
    // disagrees can recount the findings and check it.
    // high sets the floor at 40; `low` adds 5; `info` adds nothing,
    // because an informational finding informs and does not score.
    const findings = [{ severity: 'high' }, { severity: 'low' }, { severity: 'info' }];
    expect(deriveRiskScore(findings)).toBe(40 + 5 * 1);
  });

  it('stays inside the scale it prints', () => {
    const many = Array.from({ length: 50 }, () => ({ severity: 'critical' }));
    expect(deriveRiskScore(many)).toBe(100);
  });

  it('keeps the model score as a cross-check, not as the published number', () => {
    // It is the tell that catches a summary describing violations while
    // findings[] is empty. Throwing it away would trade a real guard
    // for a cosmetic fix.
    expect(ENGINE).toContain('r.findings.length === 0 && r.riskScore > 25');
    expect(ENGINE).toContain('riskScore: score');
  });
});

/**
 * The title asserted what the body only conditioned.
 *
 * From the first real audit, on LexyFlow's own privacy policy:
 *
 *   title  "Aucun représentant UE/EEE identifié"      — severity: high
 *   body   "LORSQUE le responsable de traitement n'est pas établi dans
 *           l'UE/EEE mais cible des personnes concernées de l'UE,
 *           l'article 27 impose en outre…"
 *
 * The body states the condition and is right. The title asserts the
 * breach. LexyFlow is established in France, so Article 27 does not
 * reach it and there is no finding — but the title is what the
 * dashboard lists, what the reader skims, and what headlines the
 * exported PDF, and it was scored `high` and drove the risk number.
 *
 * The same shape appeared under EU AI Act Art. 13, which binds
 * high-risk systems only.
 */
describe('a finding proves that its article reaches the reader', () => {
  it('requires the applicability half, like evidence requires the factual half', () => {
    expect(ENGINE).toContain('applies_because: z.string()');
    expect(ENGINE).toContain('applicability_certain: z.boolean()');
    expect(ENGINE).toContain("'applies_because',");
    expect(ENGINE).toContain("'applicability_certain'");
  });

  it('caps the severity in code, not in the prompt', () => {
    // The prompt is where the previous version of this rule lived, and
    // the model wrote the condition into the body and still chose
    // `high`. An obligation nobody has established the reader is under
    // must not be able to drive the score.
    expect(ENGINE).toContain(
      "f.applicability_certain ? f : { ...f, severity: 'info' as const }"
    );
    expect(ENGINE).toContain('deriveRiskScore(graded)');
  });

  it('keeps the finding rather than discarding it', () => {
    // "We could not tell whether Art. 27 reaches you, and the document
    // says nothing about it" is worth reading. It just is not a gap.
    const rule = ENGINE.slice(ENGINE.indexOf('const graded ='), ENGINE.indexOf('const score ='));
    expect(rule).not.toContain('filter');
  });

  it('tells the model what the title may not do, with the case that broke it', () => {
    expect(ENGINE).toContain('never that an obligation is breached');
    expect(ENGINE).toContain('Art. 27');
  });

  it('names the provisions whose reach depends on facts a document omits', () => {
    // Without examples the flag is never set and the field is theatre.
    for (const clue of ['Art. 27', 'Annex III', 'large-scale']) {
      expect(ENGINE).toContain(clue);
    }
  });
});

describe('the reader can judge the applicability instead of trusting it', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', 'src/app/[locale]/dashboard/[auditId]/page.tsx'),
    'utf8'
  );

  it('shows the reasoning on the finding', () => {
    expect(PAGE).toContain('applies_because');
    expect(PAGE).toContain("t('appliesBecause')");
  });

  it('marks an uncertain provision beside its citation, not in a footnote', () => {
    expect(PAGE).toContain('f.applicability_certain ? null : (');
    expect(PAGE).toContain("t('applicabilityUncertain')");
  });

  it('reads the two columns out of the database', () => {
    expect(PAGE).toContain('applies_because,applicability_certain');
  });

  it('has both strings in all seven languages', () => {
    for (const locale of LOCALES) {
      const m = report(locale);
      expect(m['appliesBecause']).toBeTruthy();
      expect(m['applicabilityUncertain']).toBeTruthy();
    }
  });
});

describe('an uncertain finding changes the number, or the flag is theatre', () => {
  it('does not let informational findings inflate the count', () => {
    // The first version counted every finding at +5. Downgrading two
    // findings from high to info then left the score unchanged at 90,
    // because three other highs still set the floor and the count had
    // not moved.
    const high = { severity: 'high' };
    const info = { severity: 'info' };
    expect(deriveRiskScore([high, high, high, info, info])).toBe(50);
    expect(deriveRiskScore([high, high, high])).toBe(50);
  });

  it('reproduces the real run, before and after the downgrade', () => {
    // 19 October, LexyFlow's own privacy policy: 5 high, 5 medium,
    // 1 low. Two of the five highs cite provisions whose reach the
    // document does not settle — GDPR Art. 27 and EU AI Act Art. 13.
    const before = [
      ...Array(5).fill({ severity: 'high' }),
      ...Array(5).fill({ severity: 'medium' }),
      { severity: 'low' }
    ];
    expect(deriveRiskScore(before)).toBe(90);

    const after = [
      ...Array(3).fill({ severity: 'high' }),
      ...Array(5).fill({ severity: 'medium' }),
      { severity: 'low' },
      ...Array(2).fill({ severity: 'info' })
    ];
    expect(deriveRiskScore(after)).toBe(80);
  });

  it('still scores a document whose only findings are informational', () => {
    // Not zero: an info finding is a finding. Just not a gap.
    expect(deriveRiskScore([{ severity: 'info' }])).toBe(2);
    expect(deriveRiskScore([{ severity: 'info' }, { severity: 'info' }])).toBe(2);
  });
});
