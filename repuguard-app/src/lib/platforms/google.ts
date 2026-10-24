export interface GoogleReview {
  externalId: string;
  author: string;
  rating: number;
  body: string;
  publishedAt: string;
}

export interface GoogleSearchResult {
  placeId: string;
  displayName: string;
  avgRating: number;
  totalReviews: number;
  reviews: GoogleReview[];
}

const API_KEY = () => process.env.GOOGLE_PLACES_API_KEY ?? '';

export async function searchAndFetchGoogleReviews(
  businessName: string,
  location: string,
  lang: string
): Promise<GoogleSearchResult> {
  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY(),
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      textQuery: `${businessName}${location ? ' ' + location : ''}`,
      languageCode: lang,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!searchRes.ok) {
    throw new Error(`Google Places search failed: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  if (!searchData.places?.length) {
    throw new Error(`Établissement non trouvé sur Google : ${businessName}`);
  }

  const place = searchData.places[0];
  const placeId = place.id as string;

  const detailRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY(),
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
      'Accept-Language': lang,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!detailRes.ok) {
    throw new Error(`Google Places details failed: ${detailRes.status}`);
  }

  const detail = await detailRes.json();
  const rawReviews: Record<string, unknown>[] = detail.reviews ?? [];

  const reviews: GoogleReview[] = rawReviews.map((r) => ({
    externalId: `google_${placeId}_${r.publishTime as string}`,
    author: (r.authorAttribution as { displayName?: string })?.displayName ?? 'Anonyme',
    rating: (r.rating as number) ?? 0,
    body: ((r.text as { text?: string })?.text) ?? '',
    publishedAt: (r.publishTime as string) ?? new Date().toISOString(),
  }));

  return {
    placeId,
    displayName: (place.displayName?.text as string) ?? businessName,
    avgRating: (place.rating as number) ?? 0,
    totalReviews: (place.userRatingCount as number) ?? 0,
    reviews,
  };
}

export async function fetchGoogleReviewsByPlaceId(
  placeId: string,
  lang = 'en'
): Promise<GoogleReview[]> {
  const detailRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY(),
      'X-Goog-FieldMask': 'id,reviews',
      'Accept-Language': lang,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!detailRes.ok) throw new Error(`Google Places fetch failed: ${detailRes.status}`);

  const detail = await detailRes.json();
  const rawReviews: Record<string, unknown>[] = detail.reviews ?? [];

  return rawReviews.map((r) => ({
    externalId: `google_${placeId}_${r.publishTime as string}`,
    author: (r.authorAttribution as { displayName?: string })?.displayName ?? 'Anonyme',
    rating: (r.rating as number) ?? 0,
    body: ((r.text as { text?: string })?.text) ?? '',
    publishedAt: (r.publishTime as string) ?? new Date().toISOString(),
  }));
}
