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
