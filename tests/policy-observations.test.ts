import { describe, expect, it } from 'vitest';
import {
  observePolicy,
  verifySpan,
  type Observation,
  type ObservationId
} from '@/lib/policy-observations';

/**
 * The only layer of this product that writes public sentences about a named
 * third party who did not ask us for anything.
 *
 * Every test here defends the same line: an observable property of a text is
 * publishable, a legal qualification of the company that wrote it is not —
 * and a false factual claim is the worst of the three.
 */

const find = (obs: Observation[], id: ObservationId) => obs.find((o) => o.id === id)!;

describe('the two-part test', () => {
  it('does not call "as long as necessary" a stated retention period', () => {
    // The error this whole design exists to make impossible. The document
    // discusses retention and states no period; matching the topic alone
    // would publish "states a retention period" about a document that does
    // not.
    const obs = observePolicy(
      'Data retention. We retain your personal data for as long as necessary to provide the service.'
    );
    expect(find(obs, 'retention_period_stated').finding).toBe('unclear');
  });

  it('calls it present when a period is actually given', () => {
    const o = find(
      observePolicy('Conservation des données : nous conservons les journaux pendant 12 mois.'),
      'retention_period_stated'
    );
    expect(o.finding).toBe('present');
    expect(o.evidence).toContain('12 mois');
  });

  it('requires the confirmation to be near the topic, not anywhere in the file', () => {
    // A retention section and an unrelated "30 days" in the cookie table are
    // not the same sentence.
    const text =
      'Retention. We keep your data for as long as your account exists.' +
      ' '.repeat(50) +
      'x'.repeat(4000) +
      ' Our session cookie expires after 30 days.';
    expect(find(observePolicy(text), 'retention_period_stated').finding).toBe('unclear');
  });

  it('reports not_found when the subject is never raised', () => {
    const o = find(observePolicy('We are a company that makes software.'), 'retention_period_stated');
    expect(o.finding).toBe('not_found');
    expect(o.evidence).toBeUndefined();
  });
});

describe('never the word "absent"', () => {
  it('only ever produces present, not_found or unclear', () => {
    // "Absent" asserts the thing is not in the document. What we know is
    // that we looked and did not find it — and a DPO contact published as an
    // image, or on a sub-page we did not fetch, is published and invisible
    // to us. The weaker word is the true one.
    const findings = new Set(observePolicy('nothing in particular').map((o) => o.finding));
    for (const f of findings) {
      expect(['present', 'not_found', 'unclear']).toContain(f);
    }
  });

  it('never attaches evidence to a finding that is not present', () => {
    // Evidence for an absence would be evidence of nothing.
    for (const o of observePolicy('We are a company that makes software.')) {
      if (o.finding !== 'present') expect(o.evidence).toBeUndefined();
    }
  });
});

describe('a present finding always carries its quotation', () => {
  it('quotes the document so a reader can refute us in thirty seconds', () => {
    // The property we want: our own output must be cheap to destroy if it
    // is wrong.
    const obs = observePolicy(
      'Our Data Protection Officer can be reached at dpo@example.com for any question.'
    );
    const o = find(obs, 'dpo_contact_published');
    expect(o.finding).toBe('present');
    expect(o.evidence).toContain('dpo@example.com');
  });

  it('does not start the quotation mid-word', () => {
    const long = `${'mot '.repeat(200)}Durée de conservation : 24 mois. ${'mot '.repeat(200)}`;
    const o = find(observePolicy(long), 'retention_period_stated');
    expect(o.evidence).toMatch(/^…?\S/);
    expect(o.evidence?.replace(/^…/, '')).not.toMatch(/^ot\b/);
  });
});

describe('rights are a list, not a mention', () => {
  it('needs three rights before it says they are listed', () => {
    const one = observePolicy('You have a right to access your data.');
    expect(find(one, 'data_subject_rights_listed').finding).toBe('unclear');

    const three = observePolicy(
      'You have the right to access, the right to rectification and the right to erasure of your data.'
    );
    expect(find(three, 'data_subject_rights_listed').finding).toBe('present');
  });
});

describe('the seven languages we serve', () => {
  const cases: [string, string, ObservationId][] = [
    ['fr', 'Vous pouvez introduire une réclamation auprès de la CNIL, autorité de contrôle.', 'supervisory_authority_named'],
    ['de', 'Sie können eine Beschwerde bei der zuständigen Aufsichtsbehörde einreichen.', 'supervisory_authority_named'],
    ['es', 'Puede presentar una reclamación ante la AEPD, autoridad de control.', 'supervisory_authority_named'],
    ['pt-br', 'Você pode apresentar uma reclamação à ANPD, autoridade nacional.', 'supervisory_authority_named'],
    ['en', 'Transfers outside the EEA rely on standard contractual clauses.', 'international_transfers_addressed'],
    ['fr', 'Les transferts hors UE reposent sur des clauses contractuelles types.', 'international_transfers_addressed']
  ];

  for (const [locale, text, id] of cases) {
    it(`reads ${id} in ${locale}`, () => {
      expect(find(observePolicy(text), id).finding).toBe('present');
    });
  }
});

describe('verifySpan — the gate a model must pass', () => {
  const DOC = 'We retain\n   your personal  data\nfor twelve months after closure.';

  it('accepts a quotation the document really contains', () => {
    expect(verifySpan(DOC, 'your personal data')).toBe('your personal  data');
  });

  it('returns the source’s own wording, not the proposed one', () => {
    // What we publish is always the document's spacing and casing, never a
    // model's tidied-up version of it.
    expect(verifySpan(DOC, 'for twelve months')).toBe('for twelve months');
    expect(verifySpan(DOC, 'We retain your personal data')).toContain('\n');
  });

  it('rejects a fluent invention', () => {
    // The mechanism. A hallucinated quotation is not in the document, so it
    // fails the substring check and the observation degrades rather than
    // being published.
    expect(verifySpan(DOC, 'we retain your data for twenty-four months')).toBeNull();
  });

  it('rejects a quotation with one word changed', () => {
    // Whitespace is not a difference in what the document says. A word is.
    expect(verifySpan(DOC, 'for thirteen months after closure')).toBeNull();
  });

  it('rejects a span too short to mean anything', () => {
    expect(verifySpan(DOC, 'data')).toBeNull();
  });
});

describe('what this pass misses, written down rather than hidden', () => {
  /**
   * The deterministic pass errs towards recall loss, never towards a false
   * claim, and this test records the cost of that choice so nobody
   * "discovers" it later as a bug.
   */

  it('misses a transfer described without transfer vocabulary', () => {
    // "Certaines données sont hébergées aux États-Unis" describes a transfer
    // and uses none of the words that name one. We report not_found, which
    // means "we looked and did not find it" — true of this document — and
    // is exactly why the value is not called `absent`.
    //
    // Closing this gap is the job of a model pass, whose every quotation
    // must survive verifySpan. Widening the regex to catch "hosted in
    // <country>" would buy recall with false positives, and a false
    // `present` is the one direction that cannot be spent.
    const obs = observePolicy(
      'Transferts. Certaines données sont hébergées aux États-Unis par notre prestataire.'
    );
    expect(obs.find((o) => o.id === 'international_transfers_addressed')?.finding).toBe('not_found');
  });

  it('claims nothing at all about a document that says nothing', () => {
    // The safe failure. A vague page produces seven not_founds and no
    // assertion that could be wrong about the company that published it.
    const obs = observePolicy('Nous respectons votre vie privée et prenons la sécurité au sérieux.');
    expect(obs.every((o) => o.finding === 'not_found')).toBe(true);
    expect(obs.every((o) => o.evidence === undefined)).toBe(true);
  });
});

describe('what the first real scan corrected', () => {
  /**
   * These are not invented examples. They are the two sentences our own
   * published policy uses, and the first scan ever run got both of them
   * wrong — in the safe direction, but wrong.
   */

  const REAL = [
    'Effective January 1, 2026 · LexyFlow',
    '',
    '7. Retention',
    'Audit reports — kept for the lifetime of your subscription, then 30 days.',
    '',
    '8. Your rights',
    'You have the right to access, rectify, erase, restrict and port your personal',
    'data, to object to processing, and to lodge a complaint with a supervisory',
    'authority (e.g. CNIL, ANPD, PPC, ICO).',
    '',
    '11. Changes',
    'We announce changes 30 days before taking effect. The effective date above is',
    'authoritative.'
  ].join('\n');

  const of = (id: string) => observePolicy(REAL).find((o) => o.id === id)!;

  it('counts six rights written as one sentence', () => {
    // The old rule wanted three separate "right to X" phrases. Most
    // policies, including ours, write one anchor and a list of verbs —
    // "the right to access, rectify, erase, restrict and port … to object"
    // — which it read as a single right and reported unclear.
    expect(of('data_subject_rights_listed').finding).toBe('present');
  });

  it('finds a date stated at the top even though a later sentence mentions it', () => {
    // The deeper defect, and it affected all seven rules: only the FIRST
    // occurrence of a topic was tested. Here the first hit is "the
    // effective date above" in section 11, with no date beside it, so a
    // document that states its date plainly was reported as unclear.
    expect(of('last_updated_stated').finding).toBe('present');
    expect(of('last_updated_stated').evidence).toContain('January 1, 2026');
  });

  it('still refuses to invent a DPO that is not named', () => {
    // The finding the first scan got right, and it stays right: our policy
    // gives privacy@ but names no data protection officer.
    expect(of('dpo_contact_published').finding).toBe('not_found');
  });

  it('quotes the section the claim came from, not the one before it', () => {
    // The excerpt used to be centred on the match, so a finding about
    // section 7 opened with the tail of section 6 and a reader met the
    // wrong heading first. The claim was always inside the quotation; it
    // simply was not the first thing you read.
    const evidence = of('retention_period_stated').evidence ?? '';
    expect(evidence).toContain('Retention');
    expect(evidence.indexOf('Retention')).toBeLessThan(120);
  });
});
