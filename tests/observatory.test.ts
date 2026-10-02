import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The study is the one page on this site written to be cited rather than
 * crawled, and the single thing that would destroy it is a number a
 * reader cannot check — or a row that reads as a verdict about a company.
 *
 * Asserted against the source because the figures come from the database
 * and the properties worth protecting are structural: what the study
 * refuses to publish, and what it refuses to imply.
 */

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const LIB = read('src', 'lib', 'observatory.ts');
// The CSV is built in the lib and served by the route: one builder, so
// that the file which receives a permanent DOI is byte for byte the file
// the page offers. The shape assertions therefore read the builder.
const CSV = read('src', 'lib', 'observatory.ts');
const CSV_ROUTE = read('src', 'app', 'api', 'observatory', 'data.csv', 'route.ts');
const PAGE = read('src', 'app', '[locale]', 'observatory', 'page.tsx');
const CRON = read('src', 'app', 'api', 'cron', 'policy-survey', 'route.ts');
const SAMPLE = read('src', 'lib', 'survey-sample.ts');

describe('it never publishes a verdict about a named organisation', () => {
  it('reads the sample as a count, never as a list of names', () => {
    // An aggregate is a fact about a population. "example.fr,
    // retention_period_stated, not_found" is read as an accusation
    // however carefully the header is worded — and it would be
    // defamatory if our reader were wrong.
    //
    // The one place the study touches the domain column is a head-count
    // of the sample size, which returns a number and no rows.
    const domainSelects = LIB.match(/\.select\('domain'[^)]*\)/g) ?? [];
    expect(domainSelects).toHaveLength(1);
    expect(domainSelects[0]).toContain('head: true');
  });

  it('emits only aggregate sections in the published dataset', () => {
    // Whatever rows are added later, they belong to one of these four.
    // A fifth section is how a per-domain table arrives by accident.
    const sections = [...CSV.matchAll(/rows\.push\(\['([a-z_]+)'/g)].map((m) => m[1]!);
    const inline = [...CSV.matchAll(/\['([a-z_]+)', '/g)].map((m) => m[1]!);
    const found = new Set([...sections, ...inline]);
    // 'section' is the header row's first column name, not a section.
    found.delete('section');

    expect(found).toEqual(new Set(['sample', 'progress', 'observation', 'refusal']));
  });

  it('counts findings without ever joining them back to a site', () => {
    expect(LIB).toContain("select('observation, finding')");
  });
});

describe('the denominator is published, not chosen', () => {
  it('counts refusals instead of dropping them', () => {
    // A study that silently removes what it could not read reports a
    // denominator it invented, and the refusal rate is one of the more
    // interesting numbers here anyway.
    expect(LIB).toContain('classifyScanFailure');
    expect(LIB).toContain('refusals');
    expect(CSV).toContain("rows.push(['refusal', r.code");
  });

  it('carries the count beside every percentage on the page', () => {
    // A percentage with no denominator is the shape of a number nobody
    // can check.
    expect(PAGE).toContain('{row.present}/{total}');
  });

  it('states the two denominators separately', () => {
    // Domains looked at, and documents actually read. They are different
    // numbers and the second is the one the seven observations sit on.
    expect(LIB).toContain('lookedAt');
    expect(LIB).toContain('documentsRead');
    expect(CSV).toContain("['progress', 'documents_read'");
  });
});

describe('the sample is reproducible or it is nothing', () => {
  it('records the ranking identifier and date', () => {
    // "The most visited French sites" is a claim. "The .fr domains in
    // Tranco list <id> of <date>" is a statement anybody can rebuild.
    expect(SAMPLE).toContain('sourceId');
    expect(CSV).toContain("['sample', 'source_id'");
    expect(CSV).toContain("['sample', 'source_date'");
  });

  it('always carries an identifier and a date, and says which kind', () => {
    // A DELIBERATE WEAKENING, recorded here rather than slipped in.
    //
    // The first version refused any list that did not redirect to a
    // permanent /download/<id>/ URL. That rule was right and it also
    // meant no study at all once the Tranco URL started answering 404.
    // A ranking served from a fixed address now identifies itself by the
    // day we fetched it — weaker, checkable only against the publisher's
    // own archive, and visible as such: the methodology prints
    // "majestic-2026-10-01", which nobody will mistake for a permanent
    // list id.
    expect(SAMPLE).toContain('fromUrl ?? `${source.id}-${today}`');
    expect(SAMPLE).toContain("/\\/download\\/([A-Za-z0-9]+)\\//");
  });

  it('tries several rankings instead of guessing one more time', () => {
    // The source was a constant pointing at a URL that answers 404, and
    // the first fix I shipped — streaming instead of buffering 25MB —
    // was a real improvement to a thing that was not the bug. A second
    // guess from a sandbox that cannot reach any of these hosts would
    // have been worth exactly as much as the first.
    expect(SAMPLE).toContain('const SOURCES: RankingSource[]');
    expect(SAMPLE).toContain('for (const source of SOURCES)');
    expect(SAMPLE).toContain('no ranking could be used');
  });

  it('carries the ranking basis, because the rankings measure different things', () => {
    // Tranco aggregates traffic rankings; Majestic ranks by referring
    // subnets. A study whose population came from the second must not
    // say "most visited".
    expect(SAMPLE).toContain('agrégat de classements de trafic');
    expect(SAMPLE).toContain('classement par sous-réseaux référents');
  });

  it('does not re-seed on every run', () => {
    // Re-seeding would move the population under a published figure:
    // somebody citing "300 .fr domains, list X" would find the number had
    // been computed over a different set.
    expect(CRON).toContain('seedSampleIfEmpty');
    expect(CRON).toContain('if ((count ?? 0) > 0) return');
  });
});

describe('it shows nothing before it has something', () => {
  it('tells an unreadable database apart from an empty study', () => {
    // "We could not read our own figures" and "there are no figures" are
    // different sentences, and only one of them is about the population.
    expect(LIB).toContain('): Promise<ObservatoryReport | null>');
    expect(PAGE).toContain("t('unavailable')");
    expect(PAGE).toContain("t('empty')");
  });

  it('answers 503 rather than an empty CSV', () => {
    // A CSV of zero rows is indistinguishable from a study that found
    // nothing, and somebody would eventually cite it.
    expect(CSV_ROUTE).toContain('status: 503');
  });

  it('marks the figures provisional while the crawl is running', () => {
    expect(PAGE).toContain('report.lookedAt < report.sampleSize');
    expect(PAGE).toContain("t('collecting'");
  });
});

describe('the crawl is the product, not a copy of it', () => {
  it('runs the same pipeline the public scan uses', () => {
    // A separate code path would drift, and a study computed from a
    // drifted copy of the product is a study about something we do not
    // sell.
    expect(CRON).toContain('discoverPolicy');
    expect(CRON).toContain('capturePolicy');
    expect(CRON).toContain('observePolicy');
  });

  it('keeps the seven-blank guard, so no fabricated data point is counted', () => {
    expect(CRON).toContain("!observations.some((o) => o.finding === 'present')");
  });

  it('is deliberately slow against other people\'s servers', () => {
    expect(CRON).toMatch(/DOMAINS_PER_RUN = \d+/);
    expect(CRON).toMatch(/RESCAN_AFTER_DAYS = 90/);
  });
});

describe('a cron that produces nothing has to say so', () => {
  const SURVEY = read('src', 'app', 'api', 'cron', 'policy-survey', 'route.ts');

  it('logs and alerts when it cannot build a sample', () => {
    // This ran eight times a day for two days and produced nothing,
    // because the reason travelled in the HTTP response body and a cron's
    // response goes nowhere. The observatory sat at zero domains while
    // every instrument reported a healthy run.
    expect(SURVEY).toContain("console.error('[cron/policy-survey] no_sample'");
    expect(SURVEY).toContain("alertOps('cron.policy_survey_no_sample'");
  });

  it('records a run that reached no domain', () => {
    // Either the sample is exhausted — the study finishing, worth knowing
    // — or the queue is returning nothing when it should not.
    expect(SURVEY).toContain('nothing_pending');
  });
});

describe('the sample is taken without pulling the whole file', () => {
  const SAMPLE_LIB = read('src', 'lib', 'survey-sample.ts');

  it('streams and stops rather than buffering the ranking', () => {
    // A million lines and roughly 25MB, to find three hundred domains:
    // most of a minute of somebody else's bandwidth, inside one timeout.
    expect(SAMPLE_LIB).toContain('response.body?.getReader()');
    expect(SAMPLE_LIB).not.toContain('await response.text()');
    expect(SAMPLE_LIB).toContain('reader.cancel()');
  });

  it('refuses a short sample instead of publishing a smaller population', () => {
    // The study claims ranks 1 to N of a named list. Two hundred domains
    // under a heading that says three hundred is a different study.
    expect(SAMPLE_LIB).toContain('fewer than the ${limit} required');
  });
});

describe('a run that failed is answerable without leaving the database', () => {
  const SURVEY = read('src', 'app', 'api', 'cron', 'policy-survey', 'route.ts');
  const RUNS_SQL = read('supabase', 'migrations', '0043_survey_runs.sql');

  it('records every outcome, including the ones that did nothing', () => {
    // legal_sources has carried last_status and last_error since the
    // poller was written. The survey had nothing, so two days of
    // producing no domains were discoverable only by reading Vercel logs.
    const records = SURVEY.match(/await record\(/g) ?? [];
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(SURVEY).toContain('ok: false, reason: seeded.refused');
  });

  it('stores the sentence rather than a code', () => {
    // The point is that somebody reads it without a lookup table.
    expect(RUNS_SQL).toContain('reason      text');
    expect(RUNS_SQL).not.toContain('reason_code');
  });

  it('never lets the bookkeeping fail the run', () => {
    expect(SURVEY).toContain('run_not_recorded');
  });

  it('alerts on an unreadable queue instead of only returning 500', () => {
    // A 500 from a cron goes to the same place its 200 does: nowhere.
    expect(SURVEY).toContain("alertOps('cron.policy_survey_queue_unreadable'");
  });
});

/**
 * The file is the thing that gets cited, so it is the thing that must
 * not exist before there is a study.
 *
 * The page has always guarded this: below the first reading it says
 * "nothing yet" and hides the download card. The CSV route did not — it
 * answered to anyone who knew the path. Twice this week the crawl was
 * reset to a handful of domains, and either time the route would have
 * served a perfectly well-formed file reading "4 documents read of 12
 * attempted", under a CC BY licence that invites reuse.
 *
 * A file is worse than a page here. A page is read beside its collecting
 * banner; a CSV is detached by design — that is why it earns a citation
 * — and a detached artefact carries no banner.
 */
describe('no dataset before there is a study', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  const ROUTE = read('src/app/api/observatory/data.csv/route.ts');
  const PAGE = read('src/app/[locale]/observatory/page.tsx');
  const LIB = read('src/lib/observatory.ts');

  it('refuses the download below the threshold', () => {
    expect(ROUTE).toContain('MIN_DOMAINS_FOR_DOWNLOAD');
    expect(ROUTE).toContain('report.lookedAt < MIN_DOMAINS_FOR_DOWNLOAD');
    expect(ROUTE).toContain('status: 503');
  });

  it('says how far along it is instead of answering a bare error', () => {
    // A 503 with no number sends the reader to us to ask. The count is
    // the answer to the question they would have asked.
    expect(ROUTE).toContain('report.lookedAt} of ${report.sampleSize} domains');
  });

  it('uses one threshold, not a page rule and a route rule', () => {
    // Two numbers would drift, and the drift is a page offering a link
    // that answers 503 — or worse, hiding a file that is already being
    // served.
    expect(LIB).toContain('export const MIN_DOMAINS_FOR_DOWNLOAD');
    expect(PAGE).toContain('report.lookedAt >= MIN_DOMAINS_FOR_DOWNLOAD');
  });

  it('never characterises the ranking in the markup Google reads', () => {
    // schema.org/Dataset is what Google Dataset Search indexes. It
    // claimed "the most-visited .fr domains" while the sample came from
    // the Majestic Million, which ranks by referring subnets. The page
    // was corrected the day that ranking answered; this was not.
    const code = LIB.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('most-visited');
    expect(code).toContain('the published ranking ${report.sourceId}');
  });
});

/**
 * A name under which other people register is not a site.
 *
 * The first seeded sample put `gouv.fr` at rank 181, `asso.fr` at 905 and
 * `blogspot.fr` at 1654, because a link graph counts a registry suffix as
 * a domain. `asso.fr` serves no website at all — it cannot have a privacy
 * policy, and its refusal says nothing about anybody.
 *
 * One percent of three hundred, and one percent of a published refusal
 * rate that would have been our sampling error presented as a finding
 * about French sites.
 */
describe('the sample contains only things that can publish a policy', () => {
  const SAMPLE = readFileSync(join(__dirname, '..', 'src/lib/survey-sample.ts'), 'utf8');

  it('excludes registry suffixes at seeding, not afterwards', () => {
    expect(SAMPLE).toContain('isRegistrySuffix(domain)');
    expect(SAMPLE).toContain("'gouv.fr'");
    expect(SAMPLE).toContain("'asso.fr'");
    expect(SAMPLE).toContain("'blogspot.fr'");
    // At seeding: an exclusion applied later, after the refusals are
    // known, is a denominator adjusted to taste.
    expect(SAMPLE.indexOf('isRegistrySuffix(domain)')).toBeLessThan(SAMPLE.indexOf('entries.push'));
  });

  it('does not depend on the Public Suffix List to define the population', () => {
    // 15,000 lines that change weekly. A sample whose membership depends
    // on which day it was built cannot be reproduced by a reader, which
    // is the one property the methodology claims.
    expect(SAMPLE).not.toContain('psl');
    expect(SAMPLE).toContain('REGISTRY_SUFFIXES');
  });
});
