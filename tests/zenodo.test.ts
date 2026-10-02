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

/**
 * The same file with its comments removed.
 *
 * Used by the guards that assert what the RECORD says, as opposed to
 * what the code says about itself. A comment explaining why the word
 * "Tranco" must not appear in a deposit would otherwise fail the guard
 * that forbids it — and the fix for that is not to stop writing the
 * comment.
 */
const LIB_CODE = LIB.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const ROUTE = read('src', 'app', 'api', 'admin', 'observatory-deposit', 'route.ts');
const OBSERVATORY = read('src', 'lib', 'observatory.ts');
const SURVEY_CRON = read('src', 'app', 'api', 'cron', 'policy-survey', 'route.ts');
const SURVEY_CRON_CODE = SURVEY_CRON.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(
  /(^|[^:])\/\/.*$/gm,
  '$1'
);

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

  it('keeps the admin route behind a session', () => {
    expect(ROUTE).toContain('getCurrentAdminUser');
    expect(ROUTE).toContain('isAdminEmail');
  });

  it('lets a cron create the draft, and still nothing publish it', () => {
    // This guard used to read "is behind the admin session rather than a
    // cron", and the rule it was protecting was never "a machine must not
    // deposit". It was "a machine must not mint a permanent DOI". The
    // difference matters because the manual version did not work: it
    // required a human to notice, on the right day, that the sample had
    // completed, while the sixty-day test counts regardless.
    //
    // So the draft is automatic — deletable, reversible, no public record
    // — and /actions/publish is called by nothing, anywhere.
    expect(SURVEY_CRON).toContain('depositEditionOnce');
    expect(SURVEY_CRON).toContain('report.lookedAt < report.sampleSize');
    expect(LIB).not.toContain('/actions/publish');
    expect(SURVEY_CRON_CODE).not.toContain('publish');
  });

  it('cannot deposit the same edition twice', () => {
    // The cron runs eight times a day. Without a lock it would create a
    // draft on every run once the sample finished, each with its own
    // reserved DOI, any of which could be published by mistake.
    expect(LIB).toContain("from('observatory_deposits').insert");
    // Claimed BEFORE the deposit: a row written afterwards lets two
    // concurrent runs both see nothing, both deposit, and the loser of
    // the constraint has already created a draft nobody tracks.
    expect(LIB.indexOf("insert({")).toBeLessThan(LIB.indexOf('await depositObservatory(report, csv)'));
    // And the button takes the same lock, or the two writers race.
    expect(ROUTE).toContain('depositEditionOnce');
  });

  it('never lets a Zenodo outage cost the crawl its run', () => {
    // The crawl is the thing with a schedule. The deposit can wait three
    // hours for the next run; the twelve domains cannot be re-read.
    expect(SURVEY_CRON).toContain('deposit_threw');
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
    expect(LIB).toContain('escapeHtml(report.sourceId)');
    expect(LIB).toContain('the sample can be rebuilt');
  });

  it('names the ranking and never says what it measures', () => {
    // This guard used to read `toContain('Tranco list ${report.sourceId}')`
    // and it encoded the defect. Tranco answered 404 eight times and the
    // sample came from the Majestic Million, which ranks by referring
    // subnets — who links to a site, not who visits it. The visible page
    // was corrected that day; this record was not, and it is the one that
    // receives a permanent DOI.
    //
    // The rule that replaced it: the ranking is identified, never
    // characterised. A description that tells a reader what the list
    // measures is a description that can be wrong about it, and a wrong
    // one in a minted record cannot be withdrawn, only superseded.
    expect(LIB_CODE).not.toContain('Tranco');
    expect(LIB_CODE).not.toContain('most-visited');
    expect(LIB_CODE).toContain('Rankings differ in what they measure');
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
