import 'server-only';
import { OBSERVATORY_LICENCE, type ObservatoryReport } from './observatory';
import type { supabaseService } from './supabase';

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

/**
 * Who is calling, and where to complain about it.
 *
 * Every other fetch in this codebase says this — LexyFlowScan,
 * LexyFlowLegalWatch, LexyFlowObservatory — and the Zenodo client was
 * the one that did not, sending whatever Node's fetch defaults to. That
 * is not how we ask anyone else for anything.
 *
 * It is NOT a workaround for the 403. Zenodo's edge answered "access to
 * this resource has been restricted due to unusual traffic from your
 * network", which is about the address the request came from — a shared
 * Vercel serverless range — and not about who we said we were. Changing
 * our shape to get past a block is the one thing this codebase does not
 * do; identifying ourselves properly is what it does everywhere else,
 * and this line only brings the deposit in line with the crawlers.
 */
const USER_AGENT = 'LexyFlowObservatory/1.0 (+https://lexyflow.com)';
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
  // Pending, not `lookedAt < sampleSize`. The latter subtracts the scans
  // that failed on our side, so one `getaddrinfo EBUSY` left the study
  // permanently short of its own sample and this guard would have
  // refused a finished edition for ever.
  if (report.pending > 0) {
    return refuse(
      `${report.pending} of ${report.sampleSize} domains have not been read yet — a DOI is permanent and this edition is not finished`
    );
  }

  try {
    const created = await zenodo(token, 'POST', '/deposit/depositions', {
      metadata: metadataFor(report)
    });
    if (!created.ok) return refuse(`Zenodo refused the deposit: ${await describe(created)}`);

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
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'text/csv',
        'user-agent': USER_AGENT
      },
      body: csv,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!upload.ok) {
      return refuse(`Zenodo accepted the deposit but refused the file: ${await describe(upload)}`);
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
    // NOT "most-visited".
    //
    // The sample came from the Majestic Million, which ranks by referring
    // subnets — a measure of who links to a site, not of who visits it.
    // The page was corrected the day that ranking answered; this record
    // was not, and it is the one that gets a permanent DOI. A citable
    // artefact asserting a population it does not have is the worst place
    // in this system for that sentence to survive.
    title: `Privacy policy disclosures across .fr domains (${quarter})`,
    upload_type: 'dataset',
    description: [
      `<p>Counts of seven disclosures required by the GDPR across <code>.fr</code> domains.</p>`,
      `<p>${report.documentsRead} privacy policies were read, from ${report.lookedAt} domains attempted, out of a sample of ${report.sampleSize}.</p>`,
      // The ranking is named, never characterised. Which list answered is
      // decided at seeding time — it was Tranco until that URL started
      // returning 404 — and a description that tells a reader what the
      // ranking measures is a description that can be wrong about it.
      report.sourceId
        ? `<p><strong>Population:</strong> the <code>.fr</code> domains at ranks 1 to ${report.sampleSize} of the published ranking <code>${escapeHtml(report.sourceId)}</code>, retrieved ${escapeHtml(report.sourceDate ?? 'unknown date')}. Rankings differ in what they measure, so this one is identified by name and date rather than described; it is public and dated, so the sample can be rebuilt.</p>`
        : '',
      `<p><strong>Method:</strong> each domain was read once, by a crawler that fetches robots.txt first and obeys it, identifies itself, and reads only the document the site publishes. A disclosure is recorded only when the wording is present in the document; the supporting sentence is verified against the page character by character before it counts.</p>`,
      `<p><strong>Refusals are part of the result.</strong> Domains that could not be read — a 403, a dropped connection, a robots.txt disallow, a PDF, a page assembled in the browser — are counted and broken down by reason rather than dropped from the denominator.</p>`,
      `<p><strong>No organisation is named or assessed.</strong> These are aggregates. A policy that omits a retention period may still be lawful, and a finding is a statement about one reading of one document on one day.</p>`,
      `<p><strong>Limitation:</strong> the population is <code>.fr</code> registrations, so French organisations on other suffixes are absent, and the ranking the sample is drawn from is not a measure of traffic unless its own publisher says so.</p>`
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

/**
 * A source id goes into HTML we did not write by hand.
 *
 * It comes from a URL we fetched from a third party. It has never
 * contained anything but letters and digits, and that is not a reason to
 * interpolate it raw into a description field on a permanent record.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * What Zenodo actually said, not just which number it said it with.
 *
 * The first deposit answered HTTP 403 and that was the whole record. The
 * obvious reading — the token is missing `deposit:write` — turned out to
 * be wrong: both scopes were set. So a status code bought one guess,
 * the guess was wrong, and the next guess would have been worth no more
 * than the first.
 *
 * Zenodo returns a JSON body on every error with a `message` and often a
 * per-field `errors` array, and we were discarding it. It is the
 * difference between "403" and "please verify your email address before
 * depositing". Capped, because an error body is not a log file, and
 * wrapped, because a failure to read the failure must not replace it.
 */
async function describe(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.text()).slice(0, 600).trim();
    if (body) detail = ` — ${body}`;
  } catch {
    detail = ' — (the response body could not be read)';
  }
  return `HTTP ${res.status}${detail}`;
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
      'content-type': 'application/json',
      'user-agent': USER_AGENT
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

/**
 * Deposit the edition once, and never twice.
 *
 * The caller is a cron that runs eight times a day. Without the lock it
 * would create a draft on every run from the moment the sample finished:
 * Zenodo accepts each one, reserves a DOI for each one, and we would be
 * left with a pile of drafts of the same study, any of which could be
 * published by mistake.
 *
 * The lock is a unique constraint on the edition id, taken BEFORE the
 * deposit rather than after it. That ordering is the whole mechanism. If
 * the row is written after a successful deposit, two concurrent runs both
 * see no row, both deposit, and both then write — and the one that loses
 * the constraint has already created a draft nobody is tracking. Claiming
 * the edition first means the loser of the race never calls Zenodo at all.
 *
 * A refusal is recorded on the claimed row rather than releasing it. That
 * is deliberate: a Zenodo outage should not produce eight more attempts
 * the same day. The row says what happened and a human can clear it.
 */
export async function depositEditionOnce(
  db: ReturnType<typeof supabaseService>,
  report: ObservatoryReport,
  csv: string
): Promise<DepositResult & { skipped: boolean }> {
  const edition = report.sourceId;
  if (!edition) {
    return {
      depositionId: null,
      doi: null,
      editUrl: null,
      refused: 'the edition has no ranking id, so it cannot be identified or deposited',
      skipped: true
    };
  }

  // Claim first. A duplicate key here means another run already owns this
  // edition, and the correct behaviour is to do nothing at all.
  const { error: claimError } = await db.from('observatory_deposits').insert({
    edition,
    looked_at: report.lookedAt,
    sample_size: report.sampleSize,
    documents_read: report.documentsRead
  });

  if (claimError) {
    return {
      depositionId: null,
      doi: null,
      editUrl: null,
      refused: null,
      skipped: true
    };
  }

  const result = await depositObservatory(report, csv);

  await db
    .from('observatory_deposits')
    .update({
      deposition_id: result.depositionId,
      doi: result.doi,
      edit_url: result.editUrl,
      refused: result.refused
    })
    .eq('edition', edition);

  return { ...result, skipped: false };
}
