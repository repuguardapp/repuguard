const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

async function authenticate(req) {
  const auth = (req.headers['authorization'] || '');
  // Appels internes (cron, signup) — secret partagé
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return { ok: true, userId: null };
  // Appels utilisateur — JWT Supabase
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

    const { businessName, location, clientId, lang, autoRespond5star } = req.body;

    if (!businessName || !clientId) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // Vérifier que l'utilisateur JWT ne peut sync que son propre clientId
    if (auth.userId && auth.userId !== clientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const reviewLang = lang || 'fr';

    // 1. Chercher l'établissement via Places API (New) - Text Search
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress',
      },
      body: JSON.stringify({
        textQuery: `${businessName} ${location || ''}`,
        languageCode: reviewLang,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const searchData = await searchRes.json();

    if (!searchData.places || searchData.places.length === 0) {
      return res.status(404).json({ error: 'Établissement non trouvé sur Google', query: `${businessName} ${location || ''}` });
    }

    const place = searchData.places[0];
    const placeId = place.id;
    const placeName = place.displayName?.text || businessName;
    const avgRating = place.rating || 0;
    const totalReviews = place.userRatingCount || 0;

    // 2. Récupérer les avis via Places API (New) - Place Details
    const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
        'Accept-Language': reviewLang,
      },
      signal: AbortSignal.timeout(10000),
    });

    const detailsData = await detailsRes.json();
    const reviews = detailsData.reviews || [];
    const negativeReviews = reviews.filter(r => r.rating <= 2);

    // 3. Sauvegarder dans Supabase
    for (const review of reviews) {
      await fetch(SUPABASE_URL + '/rest/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
          'Prefer': 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          client_id: clientId,
          platform: 'google',
          review_id: `google_${placeId}_${review.publishTime}`,
          author: review.authorAttribution?.displayName || 'Anonyme',
          rating: review.rating || 0,
          text: review.text?.text || '',
          date: review.publishTime || new Date().toISOString(),
          is_negative: (review.rating || 0) <= 2,
          needs_response: (review.rating || 0) <= 2 && !(autoRespond5star && (review.rating || 0) === 5),
          place_id: placeId,
        }),
      });
    }

    // 4. Mettre à jour le score client
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        google_score: avgRating,
        total_reviews: totalReviews,
        google_place_id: placeId,
        last_sync: new Date().toISOString(),
      }),
    });

    // 6. Alertes email pour avis négatifs
    if (negativeReviews.length > 0) {
      const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=email,first_name,business_name,lang,webhook_url,webhook_enabled`, {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        }
      });
      const clients = await clientRes.json();

      if (clients.length > 0) {
        const client = clients[0];
        for (const review of negativeReviews) {
          const reviewPayload = {
            platform: 'Google',
            author:   review.authorAttribution?.displayName,
            rating:   review.rating,
            text:     review.text?.text,
          };

          fetch('https://repuguard.app/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type:         'alert',
              email:        client.email,
              firstName:    client.first_name,
              businessName: client.business_name,
              lang:         client.lang || 'fr',
              review:       reviewPayload,
            }),
          }).catch(e => console.error('Alert email error:', e.message));

          if (client.webhook_enabled && client.webhook_url) {
            fetch('https://repuguard.app/api/send-webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
              body: JSON.stringify({
                webhookUrl:   client.webhook_url,
                businessName: client.business_name,
                review:       reviewPayload,
              }),
            }).catch(e => console.error('Webhook error:', e.message));
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      placeName,
      placeId,
      avgRating,
      totalReviews,
      reviewsFetched: reviews.length,
      negativeCount: negativeReviews.length,
      reviews: reviews.slice(0, 5)
    });

  } catch (error) {
    console.error('Fetch reviews error:', error);
    return res.status(500).json({ error: error.message });
  }
}
