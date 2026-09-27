import { NextResponse } from 'next/server';
import { observatoryReport } from '@/lib/observatory';

export const runtime = 'nodejs';
export const revalidate = 3600;

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
export async function GET() {
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

  const rows: string[][] = [
    ['section', 'key', 'value', 'denominator'],
    ['sample', 'source', 'tranco', ''],
    ['sample', 'source_id', report.sourceId ?? '', ''],
    ['sample', 'source_date', report.sourceDate ?? '', ''],
    ['sample', 'suffix', '.fr', ''],
    ['sample', 'size', String(report.sampleSize), ''],
    ['progress', 'domains_looked_at', String(report.lookedAt), String(report.sampleSize)],
    ['progress', 'documents_read', String(report.documentsRead), String(report.lookedAt)],
    ['progress', 'last_read_at', report.lastReadAt ?? '', '']
  ];

  for (const observation of report.observations) {
    const total = observation.present + observation.notFound + observation.unclear;
    rows.push(['observation', `${observation.id}.present`, String(observation.present), String(total)]);
    rows.push(['observation', `${observation.id}.not_found`, String(observation.notFound), String(total)]);
    rows.push(['observation', `${observation.id}.unclear`, String(observation.unclear), String(total)]);
  }

  for (const refusal of report.refusals) {
    rows.push(['refusal', refusal.code, String(refusal.count), String(report.lookedAt)]);
  }

  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n') + '\n';

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="lexyflow-observatory-fr.csv"',
      // Same hour as the page, so a reader who downloads the file after
      // reading the page gets the numbers they just read.
      'cache-control': 'public, max-age=3600'
    }
  });
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
