const GOOGLE_API_KEY  = process.env.GOOGLE_PLACES_API_KEY;
const TRUSTPILOT_KEY  = process.env.TRUSTPILOT_API_KEY;
const TRIPADVISOR_KEY = process.env.TRIPADVISOR_API_KEY;
const TA_BASE         = 'https://api.content.tripadvisor.com/api/v1/location';
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;

async function authenticate(req) {
  const auth = (req.headers['authorization'] || '');
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return { ok: true, userId: null };
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': 'Bearer ' + token }
    });
    const u = await r.json();
    if (u.id) return { ok: true, userId: u.id };
  }
  return { ok: false };
}

async function guardSubscription(clientId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=trial_ends,subscription_status`, {
    headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY }
  });
  const rows = await res.json();
  if (!rows.length) return true;
  const c = rows[0];
  const trialValid = c.trial_ends && new Date(c.trial_ends) > new Date();
  const subActive  = ['active', 'trialing'].includes(c.subscription_status);
  return trialValid || subActive;
}

async function fireAlerts(clientId, negativeReviews, mapReview) {
  if (!negativeReviews.length) return;
  const clientRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=email,first_name,business_name,lang,webhook_url,webhook_enabled`,
    { headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY } }
  );
  const clients = await clientRes.json();
  if (!clients.length) return;
  const client = clients[0];
  for (const review of negativeReviews) {
    const reviewPayload = mapReview(review);
    fetch('https://repuguard.app/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'alert', email: client.email, firstName: client.first_name,
        businessName: client.business_name, lang: client.lang || 'fr', review: reviewPayload,
      }),
    }).catch(e => console.error('Alert email error:', e.message));
    if (client.webhook_enabled && client.webhook_url) {
      fetch('https://repuguard.app/api/send-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
        body: JSON.stringify({ webhookUrl: client.webhook_url, businessName: client.business_name, review: reviewPayload }),
      }).catch(e => console.error('Webhook error:', e.message));
    }
  }
}

// ── Google ────────────────────────────────────────────────────
async function handleGoogle(body, res) {
  const { businessName, location, clientId, lang, autoRespond5star } = body;
  const reviewLang = lang || 'fr';

  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: `${businessName} ${location || ''}`, languageCode: reviewLang }),
    signal: AbortSignal.timeout(10000),
  });
  const searchData = await searchRes.json();
  if (!searchData.places?.length) {
    return res.status(404).json({ error: 'Établissement non trouvé sur Google', query: `${businessName} ${location || ''}` });
  }

  const place       = searchData.places[0];
  const placeId     = place.id;
  const placeName   = place.displayName?.text || businessName;
  const avgRating   = place.rating || 0;
  const totalReviews = place.userRatingCount || 0;

  const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
      'Accept-Language': reviewLang,
    },
    signal: AbortSignal.timeout(10000),
  });
  const detailsData = await detailsRes.json();
  const reviews     = detailsData.reviews || [];
  const negativeReviews = reviews.filter(r => r.rating <= 2);

  await Promise.all(reviews.map(review =>
    fetch(SUPABASE_URL + '/rest/v1/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        client_id:     clientId,
        platform:      'google',
        review_id:     `google_${placeId}_${review.publishTime}`,
        author:        review.authorAttribution?.displayName || 'Anonyme',
        rating:        review.rating || 0,
        text:          review.text?.text || '',
        date:          review.publishTime || new Date().toISOString(),
        is_negative:   (review.rating || 0) <= 2,
        needs_response:(review.rating || 0) <= 2 || (!!autoRespond5star && (review.rating || 0) === 5),
        place_id:      placeId,
      }),
    }).catch(e => console.error('Google review insert error:', e.message))
  ));

  await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY, 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ google_score: avgRating, total_reviews: totalReviews, google_place_id: placeId, last_sync: new Date().toISOString() }),
  });

  await fireAlerts(clientId, negativeReviews, r => ({
    platform: 'Google', author: r.authorAttribution?.displayName, rating: r.rating, text: r.text?.text,
  }));

  return res.status(200).json({
    success: true, placeName, placeId, avgRating, totalReviews,
    reviewsFetched: reviews.length, negativeCount: negativeReviews.length, reviews: reviews.slice(0, 5),
  });
}

// ── Trustpilot ────────────────────────────────────────────────
async function handleTrustpilot(body, res) {
  if (!TRUSTPILOT_KEY) return res.status(500).json({ error: 'TRUSTPILOT_API_KEY not configured' });

  const { businessName, location, clientId } = body;

  const searchUrl = `https://api.trustpilot.com/v1/business-units/search?query=${encodeURIComponent(businessName)}${location ? '&country=' + encodeURIComponent(location) : ''}&apikey=${TRUSTPILOT_KEY}`;
  const searchData = await (await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })).json();
  if (!searchData.businesses?.length) {
    return res.status(404).json({ error: 'Établissement non trouvé sur Trustpilot', query: businessName });
  }

  const business       = searchData.businesses[0];
  const businessUnitId = business.id;
  const avgRating      = business.stars || 0;
  const totalReviews   = business.numberOfReviews?.total || 0;

  const reviewsUrl  = `https://api.trustpilot.com/v1/business-units/${businessUnitId}/reviews?apikey=${TRUSTPILOT_KEY}&perPage=20&orderBy=createdat.desc`;
  const reviews     = (await (await fetch(reviewsUrl, { signal: AbortSignal.timeout(10000) })).json()).reviews || [];
  const negativeReviews = reviews.filter(r => (r.stars || 0) <= 2);

  await Promise.all(reviews.map(review =>
    fetch(SUPABASE_URL + '/rest/v1/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        client_id:     clientId, platform: 'trustpilot',
        review_id:     `trustpilot_${businessUnitId}_${review.id}`,
        author:        review.consumer?.displayName || 'Anonyme',
        rating:        review.stars || 0, text: review.text || '',
        date:          review.createdAt || new Date().toISOString(),
        is_negative:   (review.stars || 0) <= 2, needs_response: (review.stars || 0) <= 2,
        place_id:      businessUnitId,
      }),
    }).catch(e => console.error('Trustpilot review insert error:', e.message))
  ));

  await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY, 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ trustpilot_business_id: businessUnitId, trustpilot_score: avgRating, last_sync: new Date().toISOString() }),
  });

  await fireAlerts(clientId, negativeReviews, r => ({
    platform: 'Trustpilot', author: r.consumer?.displayName, rating: r.stars, text: r.text,
  }));

  return res.status(200).json({ success: true, businessUnitId, avgRating, totalReviews, reviewsFetched: reviews.length, negativeCount: negativeReviews.length });
}

// ── TripAdvisor ───────────────────────────────────────────────
async function handleTripAdvisor(body, res) {
  if (!TRIPADVISOR_KEY) return res.status(500).json({ error: 'TRIPADVISOR_API_KEY not configured' });

  const { businessName, location, clientId, lang } = body;
  const language = lang || 'fr';

  const searchData = await (await fetch(
    `${TA_BASE}/search?searchQuery=${encodeURIComponent(businessName + (location ? ' ' + location : ''))}&language=${language}&key=${TRIPADVISOR_KEY}`,
    { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' }, signal: AbortSignal.timeout(10000) }
  )).json();
  if (!searchData.data?.length) {
    return res.status(404).json({ error: 'Établissement non trouvé sur TripAdvisor', query: businessName });
  }

  const locationId   = searchData.data[0].location_id;
  const locationName = searchData.data[0].name || businessName;

  const details    = await (await fetch(`${TA_BASE}/${locationId}/details?language=${language}&key=${TRIPADVISOR_KEY}`,
    { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' }, signal: AbortSignal.timeout(10000) })).json();
  const avgRating  = parseFloat(details.rating || 0);
  const totalReviews = parseInt(details.num_reviews || 0, 10);

  const reviews    = (await (await fetch(`${TA_BASE}/${locationId}/reviews?language=${language}&key=${TRIPADVISOR_KEY}`,
    { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' }, signal: AbortSignal.timeout(10000) })).json()).data || [];
  const negativeReviews = reviews.filter(r => (r.rating || 0) <= 2);

  await Promise.all(reviews.map(review =>
    fetch(SUPABASE_URL + '/rest/v1/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        client_id:     clientId, platform: 'tripadvisor',
        review_id:     `tripadvisor_${locationId}_${review.id}`,
        author:        review.user?.username || 'Anonyme',
        rating:        review.rating || 0, text: review.text || review.title || '',
        date:          review.published_date || new Date().toISOString(),
        is_negative:   (review.rating || 0) <= 2, needs_response: (review.rating || 0) <= 2,
        place_id:      String(locationId),
      }),
    }).catch(e => console.error('TripAdvisor review insert error:', e.message))
  ));

  await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY, 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ tripadvisor_location_id: String(locationId), tripadvisor_score: avgRating, last_sync: new Date().toISOString() }),
  });

  await fireAlerts(clientId, negativeReviews, r => ({
    platform: 'TripAdvisor', author: r.user?.username || 'Anonyme', rating: r.rating, text: r.text || r.title || '',
  }));

  return res.status(200).json({ success: true, locationId, locationName, avgRating, totalReviews, reviewsFetched: reviews.length, negativeCount: negativeReviews.length });
}

// ── Router ────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

    const { platform = 'google', businessName, clientId, ...rest } = req.body;

    if (!businessName || !clientId) return res.status(400).json({ error: 'Paramètres manquants' });
    if (auth.userId && auth.userId !== clientId) return res.status(403).json({ error: 'Forbidden' });

    if (auth.userId) {
      const allowed = await guardSubscription(clientId);
      if (!allowed) return res.status(402).json({ error: 'Abonnement expiré.' });
    }

    const body = { businessName, clientId, ...rest };

    switch (platform) {
      case 'google':      return handleGoogle(body, res);
      case 'trustpilot':  return handleTrustpilot(body, res);
      case 'tripadvisor': return handleTripAdvisor(body, res);
      default: return res.status(400).json({ error: `Plateforme inconnue: ${platform}` });
    }

  } catch (error) {
    console.error('Fetch reviews error:', error);
    return res.status(500).json({ error: error.message });
  }
}
