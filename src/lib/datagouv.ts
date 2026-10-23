import 'server-only';
import type { ObservatoryReport } from './observatory';
import {
  dataGouvPayload,
  editionTitle,
  findEdition,
  hasMorePages,
  resolveConfig,
  type DataGouvConfig
} from './datagouv-payload';

/**
 * Deposit the study on the French public open-data platform.
 *
 * WHY THIS PLATFORM, AND WHY IT IS NOT A LINK FARM
 *
 * The observatory measures GDPR disclosure across `.fr` domains. That
 * is the subject matter of data.gouv.fr, the dataset is already
 * CC-BY-4.0, and it is already deposited with a DOI. Nothing is
 * manufactured to justify being there.
 *
 * Measured on a real dataset page, 23 October: 274,850 bytes of
 * server-rendered HTML, no `meta robots`, and description links
 * rendered as plain `<a href="…">` with no `rel`. The twenty
 * `rel="ugc nofollow noopener"` on that page are all in the discussion
 * thread. So a link in the DESCRIPTION is followable and a link in a
 * COMMENT is not — which is why the canonical URL goes in the
 * description and nowhere else.
 *
 * None of that promises Google will follow it. Dofollow and indexable
 * are the two properties we can verify; what a crawler does with them
 * afterwards is not ours to claim.
 *
 * WE CREATE A PRIVATE DRAFT. WE DO NOT PUBLISH.
 *
 * The same rule as the Zenodo client, and here it needs stating twice:
 * a dataset created through this API is PUBLIC by default, and the
 * documentation is explicit that `private: true` must be sent or a
 * later edit flips it public. A cron that published whatever the
 * pipeline produced that morning would put our name on a government
 * platform attached to numbers nobody had read. The last click stays
 * deliberate.
 *
 * The payload, the edition key and the configuration guard live in
 * `datagouv-payload.ts`, which is not `server-only` and is therefore
 * testable for what it does rather than for which strings it contains.
 */

const USER_AGENT = 'LexyFlowObservatory/1.0 (+https://lexyflow.com)';
const TIMEOUT_MS = 60_000;

export interface DataGouvResult {
  /** data.gouv.fr's id for the dataset, so a second run can find it. */
  datasetId: string | null;
  /** Where to review it and press publish. */
  page: string | null;
  /** True when this run created it; false when it was already there. */
  created: boolean;
  /** Which base it talked to, so a report can never be ambiguous about it. */
  base: string | null;
  refused: string | null;
}

const refuse = (refused: string, base: string | null = null): DataGouvResult => ({
  datasetId: null,
  page: null,
  created: false,
  base,
  refused
});

/**
 * Create the draft, or report that it is already there.
 *
 * Idempotency is asked of data.gouv.fr, not of our own database.
 *
 * We could mirror the dataset id in a table and check that instead. We
 * have been here before: the digest read "Active subscriptions 4" every
 * morning from a mirror Stripe had contradicted four months earlier. A
 * mirror only receives the writes that succeeded, so it fails in the
 * direction that flatters us — and the failure here would be a second
 * public dataset on a government platform every time the cron fires.
 * The platform holding the artefact is the system of record.
 */
export async function depositToDataGouv(
  report: ObservatoryReport,
  csvUrl: string,
  now = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<DataGouvResult> {
  const resolved = resolveConfig(env);
  if (resolved.refused !== null) return refuse(resolved.refused);
  const config = resolved.config;

  // A deposit is a public artefact about a finished measurement. The
  // same guard as the DOI client, for the same reason: a third of a
  // study published under our name is worse than no study.
  if (report.pending > 0) {
    return refuse(
      `${report.pending} of ${report.sampleSize} domains have not been read yet — this edition is not finished`,
      config.base
    );
  }

  const title = editionTitle(now);

  try {
    // A large page, because the listing is paginated and the next
    // section refuses rather than paging through.
    const mine = await api(config, 'GET', '/me/datasets/?page_size=200');
    if (!mine.ok) {
      // We cannot establish what is already there. Creating anyway is
      // exactly how duplicates happen, so this stops instead.
      return refuse(
        `could not list our existing datasets, so nothing was created: ${await describe(mine)}`,
        config.base
      );
    }

    const listing = await mine.json();

    // Measured against the real platform: the listing answers with
    // `next_page`. Reading page one and concluding "this edition does
    // not exist" would create a second PUBLIC dataset for an edition
    // that already has one. A loud refusal gets fixed; a duplicate on a
    // government platform does not get noticed.
    if (hasMorePages(listing)) {
      return refuse(
        'the account holds more datasets than one page, so this run could not prove the edition is absent and refused to risk a duplicate',
        config.base
      );
    }

    const already = findEdition(listing, title);
    if (already) {
      return { datasetId: already.id, page: already.page, created: false, base: config.base, refused: null };
    }

    const created = await api(config, 'POST', '/datasets/', dataGouvPayload(report, csvUrl, now));
    if (!created.ok) {
      return refuse(`data.gouv.fr refused the dataset: ${await describe(created)}`, config.base);
    }

    const dataset = (await created.json()) as { id?: string; page?: string; slug?: string };
    if (!dataset.id) {
      return refuse(
        'data.gouv.fr accepted the dataset but returned no id, so it cannot be found again',
        config.base
      );
    }

    return {
      datasetId: dataset.id,
      page: dataset.page ?? `${config.base}/datasets/${dataset.slug ?? dataset.id}`,
      created: true,
      base: config.base,
      refused: null
    };
  } catch (err) {
    return refuse(
      `could not reach data.gouv.fr: ${err instanceof Error ? err.message : String(err)}`,
      config.base
    );
  }
}

function api(
  config: DataGouvConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${config.base}/api/1${path}`, {
    method,
    headers: {
      'X-API-KEY': config.key,
      'content-type': 'application/json',
      'user-agent': USER_AGENT
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

/**
 * An error body is not a log file.
 *
 * Bounded, and a failure to read the failure must not replace the
 * failure — the two rules the Zenodo client learned.
 */
async function describe(res: Response): Promise<string> {
  let body: string;
  try {
    body = (await res.text()).slice(0, 600);
  } catch {
    body = 'the response body could not be read';
  }
  return `HTTP ${res.status} ${res.statusText} — ${body}`;
}
