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
    expect(DRAFT).toContain('headlinePercent === null');
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
    // 297 attempted, 106 read. A sentence that mentions only the second
    // invites the reader to assume the first.
    expect(code).toContain('figures.documentsRead');
  });
});
