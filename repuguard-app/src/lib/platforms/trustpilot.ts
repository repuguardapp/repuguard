export interface TrustpilotReview {
  externalId: string;
  author: string;
  rating: number;
  body: string;
  publishedAt: string;
}

export interface TrustpilotSearchResult {
  businessUnitId: string;
  displayName: string;
  avgRating: number;
  totalReviews: number;
  reviews: TrustpilotReview[];
}

const API_KEY = () => process.env.TRUSTPILOT_API_KEY ?? '';

export async function searchAndFetchTrustpilotReviews(
  businessName: string,
  country?: string
): Promise<TrustpilotSearchResult> {
  const key = API_KEY();
  if (!key) throw new Error('TRUSTPILOT_API_KEY not configured');

  const searchUrl = new URL('https://api.trustpilot.com/v1/business-units/search');
  searchUrl.searchParams.set('query', businessName);
  searchUrl.searchParams.set('apikey', key);
  if (country) searchUrl.searchParams.set('country', country);

  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
  if (!searchRes.ok) throw new Error(`Trustpilot search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  if (!searchData.businesses?.length) {
    throw new Error(`Établissement non trouvé sur Trustpilot : ${businessName}`);
  }

  const business = searchData.businesses[0];
  const businessUnitId = business.id as string;
  const avgRating = (business.stars as number) ?? 0;
  const totalReviews = (business.numberOfReviews?.total as number) ?? 0;

  const reviewsUrl = new URL(`https://api.trustpilot.com/v1/business-units/${businessUnitId}/reviews`);
  reviewsUrl.searchParams.set('apikey', key);
  reviewsUrl.searchParams.set('perPage', '20');
  reviewsUrl.searchParams.set('orderBy', 'createdat.desc');

  const reviewsRes = await fetch(reviewsUrl, { signal: AbortSignal.timeout(10_000) });
  if (!reviewsRes.ok) throw new Error(`Trustpilot reviews failed: ${reviewsRes.status}`);

  const reviewsData = await reviewsRes.json();
  const rawReviews: Record<string, unknown>[] = reviewsData.reviews ?? [];

  const reviews: TrustpilotReview[] = rawReviews.map((r) => ({
    externalId: `trustpilot_${businessUnitId}_${r.id as string}`,
    author: (r.consumer as { displayName?: string })?.displayName ?? 'Anonyme',
    rating: (r.stars as number) ?? 0,
    body: (r.text as string) ?? '',
    publishedAt: (r.createdAt as string) ?? new Date().toISOString(),
  }));

  return { businessUnitId, displayName: businessName, avgRating, totalReviews, reviews };
}

export async function fetchTrustpilotReviewsByBusinessUnitId(
  businessUnitId: string
): Promise<TrustpilotReview[]> {
  const key = API_KEY();
  if (!key) throw new Error('TRUSTPILOT_API_KEY not configured');

  const reviewsUrl = new URL(`https://api.trustpilot.com/v1/business-units/${businessUnitId}/reviews`);
  reviewsUrl.searchParams.set('apikey', key);
  reviewsUrl.searchParams.set('perPage', '20');
  reviewsUrl.searchParams.set('orderBy', 'createdat.desc');

  const res = await fetch(reviewsUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Trustpilot reviews fetch failed: ${res.status}`);

  const data = await res.json();
  const rawReviews: Record<string, unknown>[] = data.reviews ?? [];

  return rawReviews.map((r) => ({
    externalId: `trustpilot_${businessUnitId}_${r.id as string}`,
    author: (r.consumer as { displayName?: string })?.displayName ?? 'Anonyme',
    rating: (r.stars as number) ?? 0,
    body: (r.text as string) ?? '',
    publishedAt: (r.createdAt as string) ?? new Date().toISOString(),
  }));
}
