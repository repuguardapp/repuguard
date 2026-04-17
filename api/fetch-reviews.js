const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
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

    // 1. Authentification DataForSEO en Base64
    const credentials = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

    // 2. Récupérer les avis Google via DataForSEO
    const searchResponse = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/live', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keyword: businessName,
        location_name: location || 'France',
        language_name: 'French',
        depth: 20,
        sort_by: 'newest'
      }])
    });

    const searchData = await searchResponse.json();

    if (!searchData.tasks || searchData.tasks[0].status_code !== 20000) {
      return res.status(400).json({ 
        error: 'Erreur DataForSEO',
        details: searchData.tasks?.[0]?.status_message 
      });
    }

    const reviews = searchData.tasks[0].result?.[0]?.items || [];

    if (reviews.length === 0) {
      return res.status(200).json({ success: true, reviews: [], count: 0 });
    }

    // 3. Calculer le score moyen
    const ratings = reviews.filter(r => r.rating?.value).map(r => r.rating.value);
    const avgScore = ratings.length > 0 
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 
      : 0;

    // 4. Détecter les avis négatifs (≤2 étoiles)
    const negativeReviews = reviews.filter(r => r.rating?.value <= 2);

    // 5. Sauvegarder les avis dans Supabase
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
          review_id: review.review_id || review.url,
          author: review.author_title || 'Anonyme',
          rating: review.rating?.value || 0,
          text: review.review_text || '',
          date: review.time_ago || new Date().toISOString(),
          is_negative: (review.rating?.value || 0) <= 2,
          needs_response: (review.rating?.value || 0) <= 2,
        }),
      });
    }

    // 6. Mettre à jour le score du client dans Supabase
    await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + clientId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        google_score: avgScore,
        total_reviews: reviews.length,
        last_sync: new Date().toISOString(),
      }),
    });

    // 7. Envoyer des alertes pour les avis négatifs
    if (negativeReviews.length > 0) {
      // Récupérer l'email du client
      const clientRes = await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + clientId + '&select=email,first_name,business_name', {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        }
      });
      const clients = await clientRes.json();
      
      if (clients.length > 0) {
        const client = clients[0];
        for (const review of negativeReviews) {
          // Envoyer email d'alerte
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
                author: review.author_title,
                rating: review.rating?.value,
                text: review.review_text,
              }
            }),
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      count: reviews.length,
      avgScore,
      negativeCount: negativeReviews.length,
      reviews: reviews.slice(0, 5) // Retourner les 5 premiers pour preview
    });

  } catch (error) {
    console.error('Fetch reviews error:', error);
    return res.status(500).json({ error: error.message });
  }
};
