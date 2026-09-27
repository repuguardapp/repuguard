import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { observatoryCsv, observatoryReport } from '@/lib/observatory';
import { getCurrentAdminUser } from '@/lib/supabase-server';
import { depositObservatory } from '@/lib/zenodo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Create the Zenodo draft for the current edition.
 *
 * Deliberately behind the admin session rather than on a cron. Creating
 * the deposit is harmless and reversible — a draft can be deleted — but
 * the click that follows it in Zenodo is not: a DOI is permanent, and a
 * minted record with a wrong number cannot be withdrawn, only superseded.
 *
 * This codebase has spent weeks finding the mornings where the pipeline
 * produced something confidently wrong: seven blank observations about
 * Airbnb, a sitemap of 321 undated children read as an empty regulator, a
 * ministry newsroom ingested as a data-protection feed. Putting a
 * permanent citable record on whatever the crawl happened to produce that
 * morning is the one mistake in this plan that could not be corrected
 * afterwards.
 *
 * So: one deliberate action per quarterly edition, by somebody who has
 * looked at the numbers. That is one click a quarter, not one per
 * contact, which is the distinction the automation argument actually
 * turns on.
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

  const result = await depositObservatory(report, observatoryCsv(report));

  if (result.refused) {
    // 200 with the reason, not an error status. "The collection is not
    // finished" is the system working, and a red error would teach the
    // reader to ignore the one case that is a real failure.
    return NextResponse.json({ ok: false, reason: result.refused });
  }

  console.log('[observatory] zenodo_draft_created', {
    depositionId: result.depositionId,
    doi: result.doi
  });

  return NextResponse.json({
    ok: true,
    depositionId: result.depositionId,
    doi: result.doi,
    editUrl: result.editUrl
  });
}
