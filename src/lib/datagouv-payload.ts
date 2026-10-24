import type { ObservatoryReport } from './observatory';
import { OBSERVATORY_LICENCE } from './observatory-licence';

/**
 * What the data.gouv.fr deposit will say, and whether it may run.
 *
 * Deliberately NOT `server-only`, and split out of `datagouv.ts` for
 * that reason. Everything here is a pure function of its arguments: the
 * description a public government platform will display, the edition
 * key that stops us creating a duplicate, and the configuration guard
 * that decides whether anything is sent at all.
 *
 * `server-only` makes a module unimportable from the test runner, which
 * is why `tests/zenodo.test.ts` asserts that strings occur in a .tsx
 * file rather than asserting what the code does. That pattern has
 * already cost this project a defect: `tests/crawl-graph.test.ts` was
 * green while the framework pages linked to 91 URLs that answered 404,
 * because the href it checked for was present and the value
 * interpolated into it was wrong. The network call stays behind
 * `server-only`; the judgement does not.
 */

/** The one link this whole exercise exists to place. */
export const CANONICAL_URL = 'https://lexyflow.com/en/observatory';

/**
 * Title for an edition. Also the idempotency key.
 *
 * Quarterly, matching the Zenodo series, so the two platforms describe
 * the same artefact by the same name rather than looking like two
 * unrelated studies.
 */
export function editionTitle(now = new Date()): string {
  const quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  return `Privacy policy disclosures across .fr domains (${quarter})`;
}

export interface DataGouvConfig {
  base: string;
  key: string;
}

/**
 * Read the two variables, or say precisely which one is missing.
 *
 * THERE IS NO DEFAULT BASE URL, AND THAT IS THE POINT.
 *
 * A fallback to production is one typo away from publishing a sandbox
 * run on a government platform. A fallback to the sandbox is a job that
 * never reaches production while reporting success every quarter.
 * Neither failure announces itself, so an absent variable is refused by
 * name instead.
 *
 * Takes the environment as an argument rather than reading
 * `process.env` directly, so the rule above is a property this can be
 * tested for rather than a sentence in a comment.
 */
export function resolveConfig(
  env: Record<string, string | undefined>
): { config: DataGouvConfig; refused: null } | { config: null; refused: string } {
  const base = env['DATAGOUV_BASE'];
  const key = env['DATAGOUV_API_KEY'];

  if (!base) {
    return {
      config: null,
      refused:
        'DATAGOUV_BASE is not set, so no deposit was attempted. It has no default: a default pointing at production is one typo away from publishing a sandbox run, and a default pointing at the sandbox is a job that never reaches production while reporting success. Set it to https://demo.data.gouv.fr or https://www.data.gouv.fr.'
    };
  }
  if (!key) {
    return {
      config: null,
      refused:
        'DATAGOUV_API_KEY is not set, so no deposit was attempted. Without it the study stays on our own domain and on a Zenodo record that currently carries noindex,nofollow.'
    };
  }

  return { config: { base: base.replace(/\/$/, ''), key }, refused: null };
}

/**
 * What the dataset page will say.
 *
 * Markdown, not HTML — data.gouv.fr renders descriptions as Markdown,
 * and the HTML the Zenodo record carries would print as literal tags.
 *
 * The substance is deliberately identical to the published Zenodo
 * record. That text has been through a human reading and is live under
 * a permanent DOI; a second description saying something slightly
 * different would make one edition look like two studies, and would
 * mean two places to get a correction wrong.
 */
/** Column documentation for the published CSV. */
const DATASET_FILE_DOC = [
  'Long format, four columns: `section`, `key`, `value`, `denominator`.',
  '',
  '`section` is one of `sample` (how the population was drawn), `progress` (how far the reading got), `observation` (the seven disclosures, each counted as present / not_found / unclear) and `refusal` (why a domain could not be read, by reason).',
  '',
  '`denominator` is the total each `value` should be read against, and it is not the same on every row: observations are out of the documents actually read, refusals are out of the domains attempted. A figure divided by the wrong one of those is wrong by a wide margin.'
].join('\n');

export function dataGouvPayload(
  report: ObservatoryReport,
  csvUrl: string,
  now = new Date()
): Record<string, unknown> {
  const description = [
    `Counts of seven disclosures required by the GDPR across \`.fr\` domains.`,
    ``,
    `${report.documentsRead} privacy policies were read, from ${report.lookedAt} domains attempted, out of a sample of ${report.sampleSize}.`,
    ``,
    // The ranking is named, never characterised. Which list answered is
    // decided at seeding time, and a description that tells the reader
    // what a ranking measures is a description that can be wrong about
    // it — the Zenodo record was corrected once for calling this sample
    // "most-visited" when the ranking counts referring subnets.
    report.sourceId
      ? `**Population:** the \`.fr\` domains at ranks 1 to ${report.sampleSize} of the published ranking \`${report.sourceId}\`, retrieved ${report.sourceDate ?? 'unknown date'}. Rankings differ in what they measure, so this one is identified by name and date rather than described; it is public and dated, so the sample can be rebuilt.`
      : '',
    report.sourceId ? `` : '',
    `**Method:** each domain was read once, by a crawler that fetches robots.txt first and obeys it, identifies itself, and reads only the document the site publishes. A disclosure is recorded only when the wording is present in the document; the supporting sentence is verified against the page character by character before it counts.`,
    ``,
    `**Refusals are part of the result.** Domains that could not be read — a 403, a dropped connection, a robots.txt disallow, a PDF, a page assembled in the browser — are counted and broken down by reason rather than dropped from the denominator.`,
    ``,
    `**No organisation is named or assessed.** These are aggregates. A policy that omits a retention period may still be lawful, and a finding is a statement about one reading of one document on one day.`,
    ``,
    `**Limitation:** the population is \`.fr\` registrations, so French organisations on other suffixes are absent, and the ranking the sample is drawn from is not a measure of traffic unless its own publisher says so.`,
    ``,
    // The link, in the description, where a link on this platform is
    // followable. Stated as a source rather than as an advertisement:
    // the method and the live figures are genuinely there, which is the
    // honest reason to point at it.
    `Method, live figures and the citable record: ${CANONICAL_URL}`,
    ``,
    `Licence: ${OBSERVATORY_LICENCE}`
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  /**
   * The window the readings were taken in.
   *
   * Both ends are dates we hold: the ranking was retrieved on
   * `sourceDate` and the last policy was read at `lastReadAt`. Omitted
   * entirely when either is missing — data.gouv.fr flags an absent
   * temporal coverage as a metadata gap, and a gap is the correct thing
   * to show when we cannot say truthfully what the window was.
   */
  const end = report.lastReadAt ? report.lastReadAt.slice(0, 10) : null;
  const temporal =
    report.sourceDate && end ? { temporal_coverage: { start: report.sourceDate, end } } : {};

  return {
    title: editionTitle(now),
    description,
    /**
     * France, with the caveat the description already carries.
     *
     * The population is `.fr` REGISTRATIONS, which is not the same set
     * as "organisations located in France" — a `.fr` domain can be held
     * from anywhere. The platform's field cannot express that
     * distinction, so the coarse answer goes here and the precise one
     * stays in the description, which says in as many words that French
     * organisations on other suffixes are absent.
     */
    spatial: { zones: ['country:fr'], granularity: 'country' },
    ...temporal,
    /**
     * `cc-by`, not `cc-by-4.0`.
     *
     * Measured against the platform's own /datasets/licenses/ list: it
     * publishes twelve ids and the Creative Commons Attribution one is
     * unversioned. Sending `cc-by-4.0` is not rejected — it is silently
     * stored as `notspecified`, which is how the first demo run came
     * back. That would have published the dataset with no licence at
     * all while the Zenodo record of the same artefact says CC-BY-4.0:
     * one study, two contradictory statements, and the loss of the
     * attribution obligation that is the whole mechanism by which reuse
     * points back here.
     *
     * The platform's field is coarser than the truth, so the exact
     * version is stated in the description, which carries the full
     * https://creativecommons.org/licenses/by/4.0/ URL.
     */
    license: 'cc-by',
    frequency: 'quarterly',
    tags: ['rgpd', 'donnees-personnelles', 'vie-privee', 'web', 'mesure'],
    // Not a convenience. The documentation is explicit that a dataset
    // created through this API is public unless this is present, and
    // that omitting it on a later edit flips it public again.
    private: true,
    resources: [
      {
        title: 'lexyflow-observatory-fr.csv',
        /**
         * What the columns mean.
         *
         * data.gouv.fr flags an undocumented file as a metadata gap and
         * it is right to: this CSV is long-format, and `denominator` is
         * the column that stops a reader turning 87 into a percentage
         * of the wrong total.
         */
        description: DATASET_FILE_DOC,
        url: csvUrl,
        type: 'main',
        format: 'csv',
        filetype: 'remote'
      }
    ]
  };
}

/**
 * Find this edition among datasets we already own.
 *
 * Matches on the exact title, which is the edition key. A looser match
 * would either miss an existing edition and create a duplicate, or
 * match last quarter's and never create this one.
 *
 * Written defensively because the shape is somebody else's JSON. The
 * dangerous direction is "I could not read this" becoming "there is
 * nothing there", because the caller's next move is to create a public
 * dataset — so an unreadable payload returns null and the caller is
 * required to have already refused on a failed listing.
 */
/**
 * Whether the listing we read was the whole listing.
 *
 * `/me/datasets/` is paginated: the real demo platform answers with
 * `{data, next_page, page, page_size, previous_page, total}`. Searching
 * page one for an existing edition and concluding "not there" would, on
 * the day the account holds more datasets than fit on a page, create a
 * SECOND public dataset for an edition that already exists — silently,
 * and on a government platform.
 *
 * So the caller asks for a large page and refuses when there is another
 * one, rather than paging through. Refusing is a loud failure somebody
 * fixes; a duplicate is a quiet one nobody notices.
 */
export function hasMorePages(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const next = (payload as { next_page?: unknown }).next_page;
  return typeof next === 'string' && next.length > 0;
}

export function findEdition(
  payload: unknown,
  title: string
): { id: string; page: string | null } | null {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown } | null)?.data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!list) return null;

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { title?: unknown; id?: unknown; page?: unknown; deleted?: unknown };
    if (typeof r.title !== 'string' || r.title !== title) continue;
    if (typeof r.id !== 'string') continue;
    /**
     * A deleted dataset is not an existing edition.
     *
     * data.gouv.fr deletes softly: after a DELETE the row stays in
     * `/me/datasets/` carrying a `deleted` timestamp. Measured on
     * 24 October — the dataset this client had just created came back
     * with `deleted: "2026-10-24T10:16:08..."` and the next run
     * reported `created: false` against it.
     *
     * Without this, deleting a bad draft would be irreversible in the
     * one direction that matters: the operator throws away a wrong
     * deposit, re-runs, and nothing is ever created again — while the
     * report cheerfully says the edition is already there and links to
     * something that no longer exists.
     */
    if (r.deleted !== null && r.deleted !== undefined && r.deleted !== false) continue;
    return { id: r.id, page: typeof r.page === 'string' ? r.page : null };
  }
  return null;
}
