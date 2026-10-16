import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The generator removes the fifteen rewrites. It does not remove the
 * human, and it must not quietly become the contact file we deleted.
 */

const DRAFT = readFileSync(
  join(__dirname, '..', 'src', 'components', 'OutreachDraft.tsx'),
  'utf8'
);

describe('it stores nothing', () => {
  it('never sends the name or the address anywhere', () => {
    // The moment we persisted a journalist's address we would become the
    // controller of personal data obtained from somewhere other than the
    // person, with the Article 14 notice nobody in this industry honours
    // — and we would have rebuilt the harvested file, one row at a time.
    expect(DRAFT).not.toContain('fetch(');
    expect(DRAFT).not.toContain('supabase');
    expect(DRAFT).not.toContain('console.log');
  });

  it('hands the message to the operator\'s own mail client', () => {
    // The send is a human act from a human mailbox, which is also the
    // only reason the message works.
    expect(DRAFT).toContain('mailto:');
  });

  it('says on the page that nothing is kept', () => {
    // JSX escapes the apostrophe, hence the literal form here.
    expect(DRAFT).toContain('Rien n&apos;est enregistré');
    expect(DRAFT).toContain('l&apos;article 14');
  });
});

describe('the figures in the draft are the figures on the page', () => {
  it('takes them as props rather than restating them', () => {
    // A number typed into an e-mail template is a number that will
    // eventually disagree with the study it points at.
    expect(DRAFT).toContain('figures.sampleSize');
    expect(DRAFT).toContain('figures.lookedAt');
    expect(DRAFT).toContain('figures.refused');
  });

  it('says "collection in progress" rather than inventing a headline', () => {
    expect(DRAFT).toContain('h === null');
    expect(DRAFT).toContain('en cours de collecte');
  });
});

/**
 * The one artefact written to be forwarded to a journalist.
 *
 * It said "les 300 sites .fr les plus visités" and "la liste Tranco",
 * both hardcoded, after the same claim had already been corrected on the
 * public page, in the Zenodo record and in the schema.org markup. The
 * sample came from the Majestic Million — which ranks by referring
 * subnets, not visits — and holds 297 domains after three registry
 * suffixes were excluded.
 *
 * A reporter who checks the provenance and finds it wrong does not write
 * the story, and is right not to.
 */
describe('the draft never characterises the ranking', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src/components/OutreachDraft.tsx'), 'utf8');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('names no ranking and claims no traffic', () => {
    expect(code).not.toContain('Tranco');
    expect(code).not.toContain('les plus visités');
  });

  it('prints the label the seeding recorded, whichever list answered', () => {
    expect(code).toContain('figures.sourceLabel');
  });

  it('takes the sample size from the report rather than a literal', () => {
    expect(code).not.toContain('300 ');
    expect(code).toContain('figures.sampleSize');
  });

  it('says attempted and read, not just read', () => {
    // 280 attempted, 106 read, out of a sample of 297. This comment
    // said "297 attempted", which is the same confusion the subject
    // line was making: the sample is not the attempts. Seventeen
    // domains were lost to our own failures and never tried.
    expect(code).toContain('figures.documentsRead');
  });
});

/**
 * The sentence that overstated the finding by a factor of nearly three.
 *
 * The subject line read: "13 % des politiques de confidentialité lues
 * sur 297 sites .fr traitent les transferts hors Union européenne."
 *
 * We did not read policies on 297 sites. We read 106, from 280 domains
 * attempted, out of a sample of 297. And 13% is 14 over 106 — printed
 * beside 297 it invites the reader to multiply, and 13% of 297 is 39
 * where the truth is 14.
 *
 * It arrived by a repair. An earlier version hardcoded "300", that was
 * corrected to the real sample size, and the correction dropped a
 * truthful constant next to a ratio computed over something else.
 * Removing a false number is not the same as making a sentence true.
 */
describe('a ratio never appears beside a denominator it was not computed over', () => {
  it('leads with a count over its own total, not a bare percentage', () => {
    // The public page has enforced this since it shipped: the count
    // beside the percentage, always. This component is where the figure
    // leaves the building, and it was the one place not obeying it.
    expect(DRAFT).toContain('${h.total} politiques de confidentialité .fr lues : ${h.present}');
  });

  it('computes no percentage at all, so none can be misplaced', () => {
    expect(DRAFT).not.toContain('headlinePercent');
    expect(DRAFT).not.toMatch(/\{[^}]*\}\s*%/);
    expect(DRAFT).not.toContain('Math.round');
  });

  it('never puts the sample size next to the headline figure', () => {
    // 297 is the population. The headline is counted over the documents
    // read. The two must not share a sentence.
    const subject = DRAFT.slice(DRAFT.indexOf('const subject'), DRAFT.indexOf('const body'));
    expect(subject).not.toContain('sampleSize');
    expect(subject).not.toContain('lookedAt');
  });

  it('publishes the undetermined column, which is 40% of this finding', () => {
    // 42 of 106. It is the first question a serious reader asks, and
    // saying it unprompted is what makes the other two worth anything.
    expect(DRAFT).toContain('h.unclear');
    expect(DRAFT).toContain("n'a pas tranché");
  });

  it('states attempted, read and refused in one reconciling sentence', () => {
    // The old body said "tenté de lire 297 domaines" and then used 280
    // as the denominator of the refusals two lines down. Internally
    // inconsistent, in a message whose only asset is being checkable.
    const refusals = DRAFT.slice(DRAFT.indexOf('Les refus font partie'));
    const sentence = refusals.slice(0, refusals.indexOf('`,'));
    for (const field of ['figures.lookedAt', 'figures.sampleSize', 'figures.documentsRead', 'figures.refused']) {
      expect(sentence).toContain(field);
    }
  });
});
