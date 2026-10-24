export interface PlatformSnapshot {
  platform: string;
  avg_rating: number | null;
  total_reviews: number;
}

export interface ReputationScore {
  value: number;
  platformCount: number;
  totalReviews: number;
}

export function computeReputationScore(snapshots: PlatformSnapshot[]): ReputationScore {
  const active = snapshots.filter(s => s.avg_rating !== null && s.avg_rating > 0);

  if (active.length === 0) {
    return { value: 0, platformCount: 0, totalReviews: 0 };
  }

  const totalReviews = active.reduce((acc, s) => acc + s.total_reviews, 0);

  let weightedSum: number;
  if (totalReviews === 0) {
    // Simple average when no review counts
    weightedSum = active.reduce((acc, s) => acc + (s.avg_rating ?? 0), 0) / active.length;
    return {
      value: Math.round(weightedSum * 10) / 10,
      platformCount: active.length,
      totalReviews: 0,
    };
  }

  weightedSum = active.reduce((acc, s) => acc + (s.avg_rating ?? 0) * s.total_reviews, 0);
  const value = Math.round((weightedSum / totalReviews) * 10) / 10;

  return { value, platformCount: active.length, totalReviews };
}
