import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A DOI is permanent by design. A minted record with a wrong number in it
 * cannot be withdrawn, only superseded — so this is the one step in the
 * distribution plan whose mistake would be uncorrectable.
 *
 * This codebase has spent weeks finding the mornings where the pipeline
 * produced something confidently wrong: seven blank observations about
 * Airbnb, a sitemap of 321 undated children read as an empty regulator, a
 * ministry newsroom ingested as a data-protection feed. Any of those,
 * deposited automatically, would now be a permanent public citation.
 */

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const LIB = read('src', 'lib', 'zenodo.ts');
const ROUTE = read('src', 'app', 'api', 'admin', 'observatory-deposit', 'route.ts');
const OBSERVATORY = read('src', 'lib', 'observatory.ts');

describe('nothing permanent happens on its own', () => {
  it('creates a draft and never calls publish', () => {
    expect(LIB).toContain('/deposit/depositions');
    expect(LIB).not.toContain('/actions/publish');
  });

  it('refuses to deposit a partial edition', () => {
    // A citable DOI on numbers the page itself calls provisional.
    expect(LIB).toContain('report.lookedAt < report.sampleSize');
    expect(LIB).toContain('a DOI is permanent and this edition is not finished');
  });

  it('is behind the admin session rather than a cron', () => {
    expect(ROUTE).toContain('getCurrentAdminUser');
    expect(ROUTE).toContain('isAdminEmail');
  });

  it('reports a refusal as a sentence, not as an error status', () => {
    // "The collection is not finished" is the system working. A red error
    // there teaches the reader to click past the one that is real.
    expect(ROUTE).toContain('{ ok: false, reason: result.refused }');
  });
});

describe('the deposited file is the published file', () => {
  it('uses the one CSV builder', () => {
    // Two builders would drift, and the drift would be invisible: a
    // citation pointing at numbers that no longer match the page they
    // came from.
    expect(ROUTE).toContain('observatoryCsv(report)');
    expect(OBSERVATORY).toContain('export function observatoryCsv');
  });
});

describe('the record stands on its own once detached from us', () => {
  it('carries the sample provenance in its own description', () => {
    // A Zenodo record is read by people who never see our page.
    expect(LIB).toContain('Tranco list ${report.sourceId}');
    expect(LIB).toContain('the sample can be rebuilt');
  });

  it('states the refusals and the absence of any verdict', () => {
    expect(LIB).toContain('Refusals are part of the result');
    expect(LIB).toContain('No organisation is named or assessed');
  });

  it('states the limitation rather than leaving it to be discovered', () => {
    expect(LIB).toContain('French organisations on other suffixes are absent');
  });

  it('is licensed so that reuse obliges attribution', () => {
    // CC BY rather than CC0: the point of publishing is to be cited, and
    // a licence that obliges a reuser to name the source turns every
    // reuse into the thing we are trying to earn.
    expect(LIB).toContain("license: 'cc-by-4.0'");
    expect(OBSERVATORY).toContain('creativecommons.org/licenses/by/4.0');
  });
});

describe('the absence of a token is named, not silent', () => {
  it('says which variable is missing and what it costs', () => {
    expect(LIB).toContain('ZENODO_TOKEN is not set');
    expect(LIB).toContain('the citable half of the distribution does not exist');
  });
});
