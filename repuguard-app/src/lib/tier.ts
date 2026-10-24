import type { SupabaseClient } from '@supabase/supabase-js';

export type Tier = 'free' | 'paid';

const PAID_PLANS    = new Set(['starter', 'pro', 'business']);
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

interface SubscriptionRow {
  plan: string | null;
  status: string | null;
}

export async function getTierForOrg(db: SupabaseClient, orgId: string): Promise<Tier> {
  const { data } = await db
    .from('subscriptions')
    .select('plan,status')
    .eq('org_id', orgId)
    .maybeSingle();
  const row = data as SubscriptionRow | null;
  if (!row?.plan || !row?.status) return 'free';
  if (!PAID_PLANS.has(row.plan) || !PAID_STATUSES.has(row.status)) return 'free';
  return 'paid';
}

export interface PlanLimits {
  max_platform_connections: number;
  reviews_per_sync: number;
  sync_interval_h: number;
  ai_responses_per_day: number;
  ai_responses_enabled: boolean;
  webhook_enabled: boolean;
  auto_respond_enabled: boolean;
}

const FALLBACK_LIMITS: Record<string, PlanLimits> = {
  starter:  { max_platform_connections: 1, reviews_per_sync: 10,  sync_interval_h: 24, ai_responses_per_day: 0,   ai_responses_enabled: false, webhook_enabled: false, auto_respond_enabled: false },
  pro:      { max_platform_connections: 3, reviews_per_sync: 50,  sync_interval_h: 6,  ai_responses_per_day: 50,  ai_responses_enabled: true,  webhook_enabled: true,  auto_respond_enabled: true  },
  business: { max_platform_connections: 5, reviews_per_sync: 200, sync_interval_h: 2,  ai_responses_per_day: 200, ai_responses_enabled: true,  webhook_enabled: true,  auto_respond_enabled: true  },
};

export async function getLimitsForOrg(db: SupabaseClient, orgId: string): Promise<PlanLimits> {
  const { data: sub } = await db
    .from('subscriptions')
    .select('plan,status')
    .eq('org_id', orgId)
    .maybeSingle();

  const plan = sub?.plan as string | null;
  if (!plan || !PAID_PLANS.has(plan) || !PAID_STATUSES.has(sub?.status ?? '')) {
    return FALLBACK_LIMITS['starter'];
  }

  const { data: limits } = await db
    .from('plans')
    .select('max_platform_connections,reviews_per_sync,sync_interval_h,ai_responses_per_day,ai_responses_enabled,webhook_enabled,auto_respond_enabled')
    .eq('id', plan)
    .maybeSingle();

  return (limits as PlanLimits | null) ?? FALLBACK_LIMITS[plan] ?? FALLBACK_LIMITS['starter'];
}
