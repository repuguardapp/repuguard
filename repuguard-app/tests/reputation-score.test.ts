import { describe, it, expect } from 'vitest';
import { computeReputationScore } from '@/lib/reputation-score';

describe('computeReputationScore', () => {
  it('returns 0 when no snapshots', () => {
    expect(computeReputationScore([]).value).toBe(0);
  });

  it('returns 0 when all ratings are null', () => {
    const r = computeReputationScore([{ platform: 'google', avg_rating: null, total_reviews: 100 }]);
    expect(r.value).toBe(0);
    expect(r.platformCount).toBe(0);
  });

  it('returns simple average when total_reviews is 0', () => {
    const r = computeReputationScore([
      { platform: 'google',      avg_rating: 4.0, total_reviews: 0 },
      { platform: 'trustpilot',  avg_rating: 3.0, total_reviews: 0 },
    ]);
    expect(r.value).toBe(3.5);
    expect(r.platformCount).toBe(2);
  });

  it('weights by review volume', () => {
    const r = computeReputationScore([
      { platform: 'google',     avg_rating: 4.0, total_reviews: 100 },
      { platform: 'trustpilot', avg_rating: 2.0, total_reviews: 10  },
    ]);
    expect(r.value).toBe(3.8);
    expect(r.totalReviews).toBe(110);
  });

  it('ignores platforms with rating 0', () => {
    const r = computeReputationScore([
      { platform: 'google',      avg_rating: 4.5, total_reviews: 50 },
      { platform: 'tripadvisor', avg_rating: 0,   total_reviews: 0  },
    ]);
    expect(r.platformCount).toBe(1);
    expect(r.value).toBe(4.5);
  });

  it('rounds to 1 decimal', () => {
    const r = computeReputationScore([
      { platform: 'google',      avg_rating: 4.1, total_reviews: 3 },
      { platform: 'trustpilot',  avg_rating: 3.7, total_reviews: 3 },
    ]);
    expect(r.value).toBe(3.9);
  });
});
