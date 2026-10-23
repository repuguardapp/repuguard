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

  return {
    title: editionTitle(now),
    description,
    license: 'cc-by-4.0',
    frequency: 'quarterly',
    tags: ['rgpd', 'donnees-personnelles', 'vie-privee', 'web', 'mesure'],
    // Not a convenience. The documentation is explicit that a dataset
    // created through this API is public unless this is present, and
    // that omitting it on a later edit flips it public again.
    private: true,
    resources: [
      {
        title: 'lexyflow-observatory-fr.csv',
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
    const r = row as { title?: unknown; id?: unknown; page?: unknown };
    if (typeof r.title !== 'string' || r.title !== title) continue;
    if (typeof r.id !== 'string') continue;
    return { id: r.id, page: typeof r.page === 'string' ? r.page : null };
  }
  return null;
}
