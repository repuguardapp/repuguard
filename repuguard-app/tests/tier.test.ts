import { describe, it, expect, vi } from 'vitest';
import { getTierForOrg } from '@/lib/tier';

function mockDb(row: { plan: string | null; status: string | null } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof getTierForOrg>[0];
}

describe('getTierForOrg', () => {
  it('returns free when no subscription row', async () => {
    expect(await getTierForOrg(mockDb(null), 'org-1')).toBe('free');
  });

  it('returns free when plan is null', async () => {
    expect(await getTierForOrg(mockDb({ plan: null, status: 'active' }), 'org-1')).toBe('free');
  });

  it('returns free when status is canceled', async () => {
    expect(await getTierForOrg(mockDb({ plan: 'pro', status: 'canceled' }), 'org-1')).toBe('free');
  });

  it('returns free for unknown plan', async () => {
    expect(await getTierForOrg(mockDb({ plan: 'enterprise', status: 'active' }), 'org-1')).toBe('free');
  });

  it('returns paid for active starter', async () => {
    expect(await getTierForOrg(mockDb({ plan: 'starter', status: 'active' }), 'org-1')).toBe('paid');
  });

  it('returns paid for trialing pro', async () => {
    expect(await getTierForOrg(mockDb({ plan: 'pro', status: 'trialing' }), 'org-1')).toBe('paid');
  });

  it('returns paid for past_due business (1 cycle de grâce)', async () => {
    expect(await getTierForOrg(mockDb({ plan: 'business', status: 'past_due' }), 'org-1')).toBe('paid');
  });
});
