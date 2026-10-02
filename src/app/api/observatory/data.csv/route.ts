import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import {
  MIN_DOMAINS_FOR_DOWNLOAD,
  observatoryCsv,
  observatoryReport
} from '@/lib/observatory';
import { recordReferral } from '@/lib/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * The counts, as a file somebody can put in a spreadsheet.
 *
 * This is the part that earns a link. A page with a percentage on it
 * gets read; a dataset with a method gets cited, and a citation is the
 * only thing this domain actually lacks.
 *
 * WHAT IS IN IT AND WHAT IS NOT
 *
 * Aggregates, the sample definition and the refusal breakdown. Not the
 * per-domain results — those name organisations, and a row saying
 * "example.fr, retention_period_stated, not_found" is read as a verdict
 * however carefully the header is worded. The method is documented well
 * enough that anyone who wants the per-domain data can produce it
 * themselves, which is the correct place for that decision to sit.
 */
export async function GET(request: NextRequest) {
  // The download is the arrival most worth counting: a reader who takes
  // the data is a reader who might cite it.
  waitUntil(recordReferral(request.headers.get('referer'), '/api/observatory/data.csv'));

  const report = await observatoryReport();

  if (!report) {
    // 503 rather than an empty file. A CSV of zero rows would be
    // indistinguishable from a study that found nothing, and somebody
    // would eventually cite it.
    return new NextResponse('could not read the figures\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  /**
   * And the same refusal before there is a study to download.
   *
   * The page has always guarded this — below the first reading it shows
   * "nothing yet" and hides the download card. The file did not: it was
   * served to anyone who knew the path, and twice this week the crawl was
   * reset to a handful of domains, which would have produced a perfectly
   * well-formed CSV reading "4 documents read of 12 attempted" under a
   * CC BY licence that invites reuse.
   *
   * A file is worse than a page here. A page is read in its context,
   * where the collecting banner sits; a CSV is detached by design, which
   * is the whole reason it earns a citation, and a detached artefact
   * carries no banner. So the threshold is the one the page uses for its
   * own headline, and below it this answers 503 with the reason rather
   * than a document somebody can quote.
   */
  if (report.lookedAt < MIN_DOMAINS_FOR_DOWNLOAD) {
    return new NextResponse(
      `the study has looked at ${report.lookedAt} of ${report.sampleSize} domains — ` +
        `too few to publish as a dataset, so there is no file yet\n`,
      {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      }
    );
  }

  const csv = observatoryCsv(report);

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="lexyflow-observatory-fr.csv"',
      // A short cache rather than an hour: the file is now served by a
      // dynamic route so the referrer is seen, and a long public cache
      // would hide most arrivals behind the CDN.
      'cache-control': 'public, max-age=300'
    }
  });
}
