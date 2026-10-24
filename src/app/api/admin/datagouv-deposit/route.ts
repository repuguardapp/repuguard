import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { appUrl } from '@/lib/app-url';
import { depositToDataGouv } from '@/lib/datagouv';
import { observatoryReport } from '@/lib/observatory';
import { getCurrentAdminUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Create the data.gouv.fr draft for the current edition.
 *
 * Behind the admin session rather than on a cron, for the same reason as
 * the Zenodo route next door: creating a private draft is reversible,
 * and the click that publishes it is not. A dataset on a government
 * platform carrying our name and whatever the crawl produced that
 * morning is the kind of mistake this codebase has spent weeks learning
 * to avoid — seven blank observations about Airbnb, a sitemap of 321
 * undated children read as an empty regulator.
 *
 * WHY IT DOES NOT TAKE A DATABASE LOCK
 *
 * The Zenodo route takes one, because that account has two writers — a
 * cron and a button — and two drafts of one study, each with its own
 * reserved DOI, are indistinguishable downstream. This has one writer.
 * Its idempotency comes from asking data.gouv.fr what it already holds,
 * which is the system of record for the artefact rather than a mirror
 * that only ever receives the writes that succeeded.
 *
 * THE RESPONSE ALWAYS NAMES THE BASE IT TALKED TO
 *
 * `DATAGOUV_BASE` decides whether this touched the sandbox or the live
 * platform. An operator reading "ok: true" without knowing which one it
 * reached cannot tell a rehearsal from a publication, so the base comes
 * back on every answer including the refusals.
 */
export async function POST() {
  const user = await getCurrentAdminUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const report = await observatoryReport();
  if (!report) {
    return NextResponse.json(
      { error: 'figures_unreadable', detail: 'We could not read our own figures.' },
      { status: 503 }
    );
  }

  // A remote resource rather than an upload: the CSV stays at our URL,
  // so the dataset is never a stale copy of a study that has moved on.
  const csvUrl = `${appUrl()}/api/observatory/data.csv`;

  const result = await depositToDataGouv(report, csvUrl);

  if (result.refused) {
    // 200 with the reason, not an error status. "The collection is not
    // finished" and "the key is missing" are the system working as
    // written, and a red error would teach the reader to skip past the
    // one case that is a real failure.
    return NextResponse.json({ ok: false, base: result.base, reason: result.refused });
  }

  if (!result.created) {
    return NextResponse.json({
      ok: true,
      base: result.base,
      created: false,
      datasetId: result.datasetId,
      page: result.page,
      reason:
        'this edition is already on data.gouv.fr — nothing was created, and the existing draft is linked here rather than duplicated'
    });
  }

  console.log('[observatory] datagouv_draft_created', {
    base: result.base,
    datasetId: result.datasetId,
    page: result.page
  });

  return NextResponse.json({
    ok: true,
    base: result.base,
    created: true,
    datasetId: result.datasetId,
    page: result.page,
    reminder:
      'the dataset is PRIVATE. Review it, then publish it by hand — and keep private:true on any later edit or the platform flips it public.'
  });
}
