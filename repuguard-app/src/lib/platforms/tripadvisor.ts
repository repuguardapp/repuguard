export interface TripAdvisorReview {
  externalId: string;
  author: string;
  rating: number;
  body: string;
  publishedAt: string;
}

export interface TripAdvisorSearchResult {
  locationId: string;
  displayName: string;
  avgRating: number;
  totalReviews: number;
  reviews: TripAdvisorReview[];
}

const API_KEY = () => process.env.TRIPADVISOR_API_KEY ?? '';
const BASE = 'https://api.content.tripadvisor.com/api/v1/location';

export async function searchAndFetchTripAdvisorReviews(
  businessName: string,
  location: string | undefined,
  lang: string
): Promise<TripAdvisorSearchResult> {
  const key = API_KEY();
  if (!key) throw new Error('TRIPADVISOR_API_KEY not configured');

  const query = [businessName, location].filter(Boolean).join(' ');
  const searchUrl = `${BASE}/search?searchQuery=${encodeURIComponent(query)}&language=${lang}&key=${key}`;

  const searchRes = await fetch(searchUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!searchRes.ok) throw new Error(`TripAdvisor search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  if (!searchData.data?.length) {
    throw new Error(`Établissement non trouvé sur TripAdvisor : ${businessName}`);
  }

  const locationId = String(searchData.data[0].location_id);
  const displayName = (searchData.data[0].name as string) ?? businessName;

  const [detailRes, reviewsRes] = await Promise.all([
    fetch(`${BASE}/${locationId}/details?language=${lang}&key=${key}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${BASE}/${locationId}/reviews?language=${lang}&key=${key}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    }),
  ]);

  const detail = detailRes.ok ? await detailRes.json() : {};
  const reviewsData = reviewsRes.ok ? await reviewsRes.json() : {};

  const avgRating = parseFloat(String(detail.rating ?? 0));
  const totalReviews = parseInt(String(detail.num_reviews ?? 0), 10);
  const rawReviews: Record<string, unknown>[] = reviewsData.data ?? [];

  const reviews: TripAdvisorReview[] = rawReviews.map((r) => ({
    externalId: `tripadvisor_${locationId}_${r.id as string}`,
    author: (r.user as { username?: string })?.username ?? 'Anonyme',
    rating: (r.rating as number) ?? 0,
    body: ((r.text as string) || (r.title as string)) ?? '',
    publishedAt: (r.published_date as string) ?? new Date().toISOString(),
  }));

  return { locationId, displayName, avgRating, totalReviews, reviews };
}

export async function fetchTripAdvisorReviewsByLocationId(
  locationId: string,
  lang = 'en'
): Promise<TripAdvisorReview[]> {
  const key = API_KEY();
  if (!key) throw new Error('TRIPADVISOR_API_KEY not configured');

  const res = await fetch(`${BASE}/${locationId}/reviews?language=${lang}&key=${key}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`TripAdvisor reviews fetch failed: ${res.status}`);

  const data = await res.json();
  const rawReviews: Record<string, unknown>[] = data.data ?? [];

  return rawReviews.map((r) => ({
    externalId: `tripadvisor_${locationId}_${r.id as string}`,
    author: (r.user as { username?: string })?.username ?? 'Anonyme',
    rating: (r.rating as number) ?? 0,
    body: ((r.text as string) || (r.title as string)) ?? '',
    publishedAt: (r.published_date as string) ?? new Date().toISOString(),
  }));
}
