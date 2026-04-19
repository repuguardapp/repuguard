const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { businessName, location, clientId } = req.body;

    if (!businessName || !clientId) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // 1. Chercher l'établissement via Places API (New) - Text Search
    const textSearchUrl = 'https://places.googleapis.com/v1/places:searchText';
    
    const searchRes = await fetch(textSearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress',
      },
      body: JSON.stringify({
        textQuery: `${businessName} ${location || ''}`,
        languageCode: 'fr',
      })
    });

    const searchData = await searchRes.json();

    if (!searchData.places || searchData.places.length === 0) {
      return res.status(404).json({ 
        error: 'Établissement non trouvé sur Google',
        query: `${businessName} ${location || ''}`
      });
    }

    const place = searchData.places[0];
    const placeId = place.id;
    const placeName = place.displayName?.text || businessName;
    const avgRating = place.rating || 0;
    const totalReviews = place.userRatingCount || 0;

    // 2. Récupérer les avis via Places API (New) - Place Details
    const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}`;
    
    const detailsRes = await fetch(detailsUrl, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
        'Accept-Language': 'fr',
      }
    });

    const detailsData = await detailsRes.json();
    const reviews = detailsData.reviews || [];

    // 3. Détecter les avis négatifs
    const negativeReviews = reviews.filter(r => r.rating <= 2);

    // 4. Sauvegarder dans Supabase
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
          needs_response: (review.rating || 0) <= 2,
          place_id: placeId,
        }),
      });
    }

    // 5. Mettre à jour le score client dans Supabase
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
      const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=email,first_name,business_name`, {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        }
      });
      const clients = await clientRes.json();

      if (clients.length > 0) {
        const client = clients[0];
        for (const review of negativeReviews) {
          await fetch('https://repuguard.app/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'alert',
              email: client.email,
              firstName: client.first_name,
              businessName: client.business_name,
              review: {
                platform: 'Google',
                author: review.authorAttribution?.displayName,
                rating: review.rating,
                text: review.text?.text,
              }
            }),
          });
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
};
