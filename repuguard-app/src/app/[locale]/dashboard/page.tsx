import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser, createSessionClient } from '@/lib/supabase-server';
import { computeReputationScore } from '@/lib/reputation-score';

export default async function DashboardPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/${params.locale}/login`);
  }

  const t = await getTranslations('dashboard');
  const db = createSessionClient();

  const { data: org } = await db
    .from('organizations')
    .select('id, name')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!org) {
    redirect(`/${params.locale}/onboarding`);
  }

  const { data: stats } = await db
    .from('reviews')
    .select('platform, rating, is_negative, needs_response')
    .eq('org_id', org.id);

  const reviewList = stats ?? [];
  const totalReviews = reviewList.length;
  const negativeReviews = reviewList.filter(r => r.is_negative).length;
  const pendingResponses = reviewList.filter(r => r.needs_response).length;

  const platformMap = new Map<string, { sum: number; count: number }>();
  for (const r of reviewList) {
    const p = platformMap.get(r.platform) ?? { sum: 0, count: 0 };
    p.sum += r.rating;
    p.count++;
    platformMap.set(r.platform, p);
  }
  const snapshots = Array.from(platformMap.entries()).map(([platform, { sum, count }]) => ({
    platform,
    avg_rating: count > 0 ? sum / count : null,
    total_reviews: count,
  }));

  const score = computeReputationScore(snapshots);

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">{t('title')} — {org.name}</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('reputationScore')} value={score.value > 0 ? score.value.toFixed(1) : '—'} />
        <StatCard label={t('totalReviews')} value={String(totalReviews)} />
        <StatCard label={t('negativeReviews')} value={String(negativeReviews)} />
        <StatCard label={t('pendingResponses')} value={String(pendingResponses)} />
      </div>

      {totalReviews === 0 && (
        <p className="text-muted-foreground text-sm">{t('noData')}</p>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
