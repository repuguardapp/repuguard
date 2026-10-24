import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getLimitsForOrg } from '@/lib/tier';
import { fetchGoogleReviewsByPlaceId }          from '@/lib/platforms/google';
import { fetchTrustpilotReviewsByBusinessUnitId } from '@/lib/platforms/trustpilot';
import { fetchTripAdvisorReviewsByLocationId }   from '@/lib/platforms/tripadvisor';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();

  const { data: connections, error } = await db
    .from('platform_connections')
    .select('id, org_id, platform, external_id, language, last_synced_at')
    .eq('active', true);

  if (error) {
    await db.from('error_logs').insert({ source: 'cron/sync', message: error.message, payload: null });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const results = { synced: 0, skipped: 0, errors: 0 };

  for (const conn of (connections ?? [])) {
    const orgId = conn.org_id as string;
    const limits = await getLimitsForOrg(db, orgId);
    const intervalMs = limits.sync_interval_h * 60 * 60 * 1000;
    const lastSync = conn.last_synced_at ? new Date(conn.last_synced_at as string).getTime() : 0;

    if (now - lastSync < intervalMs) {
      results.skipped++;
      continue;
    }

    const platform   = conn.platform as string;
    const externalId = conn.external_id as string;
    const lang       = (conn.language as string) ?? 'en';

    try {
      let reviews: Array<{ externalId: string; author: string; rating: number; body: string; publishedAt: string }> = [];

      if (platform === 'google') {
        reviews = await fetchGoogleReviewsByPlaceId(externalId, lang);
      } else if (platform === 'trustpilot') {
        reviews = await fetchTrustpilotReviewsByBusinessUnitId(externalId);
      } else if (platform === 'tripadvisor') {
        reviews = await fetchTripAdvisorReviewsByLocationId(externalId, lang);
      }

      const toUpsert = reviews.slice(0, limits.reviews_per_sync).map(r => ({
        org_id:      orgId,
        platform,
        external_id: r.externalId,
        author:      r.author,
        rating:      r.rating,
        body:        r.body,
        published_at: r.publishedAt,
      }));

      if (toUpsert.length > 0) {
        await db.from('reviews').upsert(toUpsert, {
          onConflict: 'org_id,platform,external_id',
          ignoreDuplicates: false,
        });
      }

      await db
        .from('platform_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', conn.id as string);

      results.synced++;
    } catch (err) {
      results.errors++;
      const message = err instanceof Error ? err.message : 'unknown';
      await db.from('error_logs').insert({
        source: 'cron/sync',
        message,
        payload: { conn_id: conn.id, platform: conn.platform },
      });
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
