import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getTierForOrg, getLimitsForOrg } from '@/lib/tier';
import { searchAndFetchGoogleReviews }      from '@/lib/platforms/google';
import { searchAndFetchTrustpilotReviews }  from '@/lib/platforms/trustpilot';
import { searchAndFetchTripAdvisorReviews } from '@/lib/platforms/tripadvisor';

type Platform = 'google' | 'trustpilot' | 'tripadvisor';

export async function POST(req: NextRequest) {
  const db = createServiceClient();

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  let orgId: string | null = null;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: org } = await db
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    orgId = org.id as string;
  }

  const body = await req.json() as {
    orgId?: string;
    platform?: Platform;
    businessName: string;
    location?: string;
    lang?: string;
  };

  const targetOrgId = isCron ? (body.orgId ?? orgId) : orgId;
  if (!targetOrgId) {
    return NextResponse.json({ error: 'orgId requis' }, { status: 400 });
  }

  const { platform = 'google', businessName, location, lang = 'fr' } = body;
  if (!businessName) {
    return NextResponse.json({ error: 'businessName requis' }, { status: 400 });
  }

  if (!isCron) {
    const tier = await getTierForOrg(db, targetOrgId);
    if (tier === 'free') {
      return NextResponse.json({ error: 'Abonnement requis.' }, { status: 402 });
    }
  }

  const limits = await getLimitsForOrg(db, targetOrgId);
  const { count: connCount } = await db
    .from('platform_connections')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', targetOrgId);

  const existingConn = await db
    .from('platform_connections')
    .select('id')
    .eq('org_id', targetOrgId)
    .eq('platform', platform)
    .maybeSingle();

  if (!existingConn.data && (connCount ?? 0) >= limits.max_platform_connections) {
    return NextResponse.json({
      error: `Votre plan permet ${limits.max_platform_connections} plateforme(s) connectée(s).`,
    }, { status: 402 });
  }

  try {
    let result: { externalId: string; displayName: string; avgRating: number; totalReviews: number; reviews: { externalId: string; author: string; rating: number; body: string; publishedAt: string }[] };

    if (platform === 'google') {
      const r = await searchAndFetchGoogleReviews(businessName, location ?? '', lang);
      result = { externalId: r.placeId, displayName: r.displayName, avgRating: r.avgRating, totalReviews: r.totalReviews, reviews: r.reviews };
    } else if (platform === 'trustpilot') {
      const r = await searchAndFetchTrustpilotReviews(businessName, location);
      result = { externalId: r.businessUnitId, displayName: r.displayName, avgRating: r.avgRating, totalReviews: r.totalReviews, reviews: r.reviews };
    } else if (platform === 'tripadvisor') {
      const r = await searchAndFetchTripAdvisorReviews(businessName, location, lang);
      result = { externalId: r.locationId, displayName: r.displayName, avgRating: r.avgRating, totalReviews: r.totalReviews, reviews: r.reviews };
    } else {
      return NextResponse.json({ error: `Plateforme inconnue : ${platform}` }, { status: 400 });
    }

    await db.from('platform_connections').upsert({
      org_id: targetOrgId,
      platform,
      external_id: result.externalId,
      display_name: result.displayName,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'org_id,platform,external_id' });

    const reviewsToSave = result.reviews.slice(0, limits.reviews_per_sync);
    if (reviewsToSave.length > 0) {
      await db.from('reviews').upsert(
        reviewsToSave.map((r) => ({
          org_id:       targetOrgId,
          platform,
          external_id:  r.externalId,
          author:       r.author,
          rating:       r.rating,
          body:         r.body,
          published_at: r.publishedAt,
          needs_response: r.rating <= 3,
        })),
        { onConflict: 'org_id,platform,external_id', ignoreDuplicates: false }
      );
    }

    return NextResponse.json({
      success: true,
      platform,
      displayName: result.displayName,
      avgRating: result.avgRating,
      totalReviews: result.totalReviews,
      reviewsSaved: reviewsToSave.length,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
