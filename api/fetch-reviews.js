const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { businessName, location, clientId } = req.body;

    if (!businessName || !clientId) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // 1. Chercher l'établissement via Google Places Text Search
    const searchQuery = encodeURIComponent(`${businessName} ${location || ''}`);
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}&key=${GOOGLE_API_KEY}&language=fr`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(404).json({ error: 'Établissement non trouvé sur Google' });
    }

    const place = searchData.results[0];
    const placeId = place.place_id;
    const placeName = place.name;
    const placeRating = place.rating || 0;
    const placeReviewCount = place.user_ratings_total || 0;

    // 2. Récupérer les détails et avis via Google Places Details
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,reviews&key=${GOOGLE_API_KEY}&language=fr&reviews_sort=newest`;

    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();

    if (detailsData.status !== 'OK') {
      return res.status(400).json({
        error: 'Erreur Google Places Details',
        status: detailsData.status
      });
    }

    const reviews = detailsData.result.reviews || [];
    const avgRating = detailsData.result.rating || placeRating;
    const totalReviews = detailsData.result.user_ratings_total || placeReviewCount;

    // 3. Détecter les avis négatifs (≤2 étoiles)
    const negativeReviews = reviews.filter(r => r.rating <= 2);

    // 4. Sauvegarder les avis dans Supabase
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
          review_id: `google_${placeId}_${review.time}`,
          author: review.author_name || 'Anonyme',
          rating: review.rating || 0,
          text: review.text || '',
          date: new Date(review.time * 1000).toISOString(),
          is_negative: review.rating <= 2,
          needs_response: review.rating <= 2,
          place_id: placeId,
        }),
      });
    }

    // 5. Mettre à jour le score du client dans Supabase
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

    // 6. Envoyer alertes email pour avis négatifs
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
                author: review.author_name,
                rating: review.rating,
                text: review.text,
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
