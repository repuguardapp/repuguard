import { describe, expect, it } from 'vitest';
import { verifySpan } from '@/lib/policy-observations';

/**
 * A quotation a model produced and nobody checked is not evidence. It is a
 * second assertion from the same source that produced the first, and it
 * reads as corroboration.
 *
 * So the span the extractor proposes is found in the fetched page before
 * it is stored, and what is stored is THE PAGE's characters. These are the
 * properties the review queue leans on when it shows the regulator's own
 * sentence beside the field we took from it.
 */

const CNIL = `Délibération de la formation restreinte n°SAN-2026-009 du 21 juillet 2026
concernant la société EXTIA. La formation restreinte de la CNIL a prononcé à
l'encontre de la société EXTIA une amende de 50 000 euros.`;

describe('what the reviewer is shown is the source, not the model', () => {
  it('returns the page wording, not the proposal', () => {
    // Proposed with collapsed whitespace, as a model reflowing a paragraph
    // naturally would. The stored quotation keeps the line break the page
    // actually has.
    const proposed = "La formation restreinte de la CNIL a prononcé à l'encontre de la société EXTIA une amende de 50 000 euros.";
    const found = verifySpan(CNIL, proposed);

    expect(found).not.toBeNull();
    expect(CNIL).toContain(found!);
    expect(found).toContain('EXTIA');
    // The source has a newline inside that sentence; the proposal did not.
    expect(found).toMatch(/\n/);
  });

  it('discards a span that is not in the page, however plausible', () => {
    // The failure mode this whole mechanism exists for: a fluent,
    // confident sentence in the right register that the regulator never
    // wrote. It must produce nothing rather than something convincing.
    const invented = "La CNIL a prononcé à l'encontre de la société EXTIA une amende de 500 000 euros.";
    expect(verifySpan(CNIL, invented)).toBeNull();
  });

  it('discards a paraphrase', () => {
    expect(verifySpan(CNIL, 'EXTIA was fined 50,000 euros by the CNIL.')).toBeNull();
  });

  it('refuses a span too short to prove anything', () => {
    // "EXTIA" appears in the page and proves nothing about the amount or
    // the date. A twelve-character floor keeps a stray word from being
    // displayed as corroboration.
    expect(verifySpan(CNIL, 'EXTIA')).toBeNull();
  });

  it('matches across the accents and casing the source actually uses', () => {
    const found = verifySpan(CNIL, 'DÉLIBÉRATION DE LA FORMATION RESTREINTE N°SAN-2026-009 DU 21 JUILLET 2026');
    expect(found).toBe('Délibération de la formation restreinte n°SAN-2026-009 du 21 juillet 2026');
  });
});
