import 'server-only';
import { OBSERVATORY_LICENCE, type ObservatoryReport } from './observatory';

/**
 * Deposit the study where datasets are actually looked for.
 *
 * Zenodo is run by CERN, it is free, it has a public API, and it mints a
 * DOI for every deposit. A DOI is permanent, citable, and indexed by
 * Google Scholar, OpenAIRE and DataCite — so a researcher or a journalist
 * who cites it creates exactly the kind of inbound link the sixty-day
 * test is measuring, without anybody having to be e-mailed.
 *
 * This is the automated half of distribution. The other half — ten
 * personal e-mails to people who write about this — cannot be automated
 * without building a scraped contact file, which is the thing we deleted
 * and will not rebuild.
 *
 * WE CREATE A DRAFT. WE DO NOT PUBLISH.
 *
 * Publishing is irreversible: a DOI is permanent by design, and a minted
 * record with a wrong number in it cannot be withdrawn, only superseded.
 * A cron that publishes the first time a crawl finishes would mean a
 * permanent public citation of whatever the pipeline happened to produce
 * that morning, and this codebase has spent weeks finding the mornings
 * where it produced something wrong — seven blank observations about
 * Airbnb, a sitemap of 321 undated children, a ministry newsroom read as
 * a data-protection feed.
 *
 * So the deposit is created and filled automatically, and the last click
 * is deliberate. That is one click per quarterly edition, not one per
 * contact, and it is the click that says "these numbers are right".
 */

const ZENODO_API = 'https://zenodo.org/api';
const TIMEOUT_MS = 60_000;

export interface DepositResult {
  /** Zenodo's id for the draft, stored so we never deposit twice. */
  depositionId: number | null;
  /** The reserved DOI, which exists before publication. */
  doi: string | null;
  /** Where to review and publish it. */
  editUrl: string | null;
  refused: string | null;
}

/**
 * Create the draft and attach the dataset.
 *
 * Returns a refusal rather than throwing, and names the missing variable
 * when there is one: a deposit that silently does not happen is
 * indistinguishable from one that nobody looked at.
 */
export async function depositObservatory(
  report: ObservatoryReport,
  csv: string
): Promise<DepositResult> {
  const token = process.env.ZENODO_TOKEN;
  const refuse = (refused: string): DepositResult => ({
    depositionId: null,
    doi: null,
    editUrl: null,
    refused
  });

  if (!token) {
    return refuse(
      'ZENODO_TOKEN is not set, so no deposit was attempted. Without it the study is published on our own domain only, and the citable half of the distribution does not exist.'
    );
  }

  // A deposit is a permanent public record. Making one of a third of a
  // study would put a citable DOI on numbers we have already said are
  // provisional.
  if (report.lookedAt < report.sampleSize) {
    return refuse(
      `the collection is at ${report.lookedAt} of ${report.sampleSize} domains — a DOI is permanent and this edition is not finished`
    );
  }

  try {
    const created = await zenodo(token, 'POST', '/deposit/depositions', {
      metadata: metadataFor(report)
    });
    if (!created.ok) return refuse(`Zenodo refused the deposit: HTTP ${created.status}`);

    const deposition = (await created.json()) as {
      id: number;
      links?: { bucket?: string; html?: string };
      metadata?: { prereserve_doi?: { doi?: string } };
    };

    const bucket = deposition.links?.bucket;
    if (!bucket) return refuse('Zenodo created the deposit but returned no upload location');

    // The bucket API takes the file as the request body, named by URL.
    const upload = await fetch(`${bucket}/lexyflow-observatory-fr.csv`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' },
      body: csv,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!upload.ok) {
      return refuse(`Zenodo accepted the deposit but refused the file: HTTP ${upload.status}`);
    }

    return {
      depositionId: deposition.id,
      doi: deposition.metadata?.prereserve_doi?.doi ?? null,
      editUrl: deposition.links?.html ?? `https://zenodo.org/deposit/${deposition.id}`,
      refused: null
    };
  } catch (err) {
    return refuse(`could not reach Zenodo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * What the record says about itself.
 *
 * Written to be found by somebody searching for the subject, and to be
 * checkable by somebody who doubts it: the sample's provenance is in the
 * description, not only in our own page, because a Zenodo record has to
 * stand on its own once it is detached from us.
 */
function metadataFor(report: ObservatoryReport): Record<string, unknown> {
  const quarter = `${new Date().getUTCFullYear()}-Q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;

  return {
    title: `Privacy policy disclosures across the most-visited .fr domains (${quarter})`,
    upload_type: 'dataset',
    description: [
      `<p>Counts of seven disclosures required by the GDPR across the most-visited <code>.fr</code> domains.</p>`,
      `<p>${report.documentsRead} privacy policies were read, from ${report.lookedAt} domains attempted, out of a sample of ${report.sampleSize}.</p>`,
      report.sourceId
        ? `<p><strong>Population:</strong> the <code>.fr</code> domains of Tranco list ${report.sourceId}, retrieved ${report.sourceDate}, ranks 1 to ${report.sampleSize}. The list is public and dated, so the sample can be rebuilt.</p>`
        : '',
      `<p><strong>Method:</strong> each domain was read once, by a crawler that fetches robots.txt first and obeys it, identifies itself, and reads only the document the site publishes. A disclosure is recorded only when the wording is present in the document; the supporting sentence is verified against the page character by character before it counts.</p>`,
      `<p><strong>Refusals are part of the result.</strong> Domains that could not be read — a 403, a dropped connection, a robots.txt disallow, a PDF, a page assembled in the browser — are counted and broken down by reason rather than dropped from the denominator.</p>`,
      `<p><strong>No organisation is named or assessed.</strong> These are aggregates. A policy that omits a retention period may still be lawful, and a finding is a statement about one reading of one document on one day.</p>`,
      `<p><strong>Limitation:</strong> the population is <code>.fr</code> registrations, so French organisations on other suffixes are absent.</p>`
    ]
      .filter(Boolean)
      .join(''),
    creators: [{ name: 'LexyFlow' }],
    license: 'cc-by-4.0',
    access_right: 'open',
    keywords: ['GDPR', 'privacy policy', 'data protection', 'France', 'web measurement'],
    related_identifiers: [
      {
        identifier: 'https://lexyflow.com/en/observatory',
        relation: 'isSupplementTo',
        scheme: 'url'
      }
    ],
    notes: `Licence: ${OBSERVATORY_LICENCE}`
  };
}

async function zenodo(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${ZENODO_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}
