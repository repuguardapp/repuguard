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

    // 2. Chercher l'établissement sur Google Maps
    const searchResponse = await fetch('https://api.dataforseo.com/v3/business_data/google/my_business_info/live', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keyword: businessName + ' ' + (location || 'France'),
        language_name: 'French',
        location_name: location || 'France',
      }])
    });

    const searchData = await searchResponse.json();

    // Log pour debug
    console.log('DataForSEO response:', JSON.stringify(searchData?.tasks?.[0]?.status_message));

    if (!searchData.tasks || searchData.tasks[0].status_code !== 20000) {
      // Essayer l'endpoint alternatif pour les avis
      const reviewsResponse = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/live', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keyword: businessName,
          location_code: 2250, // France
          language_code: 'fr',
          depth: 10,
        }])
      });

      const reviewsData = await reviewsResponse.json();
      console.log('Reviews response:', JSON.stringify(reviewsData?.tasks?.[0]?.status_message));

      if (!reviewsData.tasks || reviewsData.tasks[0].status_code !== 20000) {
        return res.status(400).json({
          error: 'DataForSEO API error',
          status: reviewsData.tasks?.[0]?.status_code,
          message: reviewsData.tasks?.[0]?.status_message
        });
      }

      const reviews = reviewsData.tasks[0].result?.[0]?.items || [];
      return res.status(200).json({ success: true, count: reviews.length, reviews });
    }

    const result = searchData.tasks[0].result?.[0] || {};
    const reviews = result.reviews || [];

    return res.status(200).json({
      success: true,
      count: reviews.length,
      businessInfo: {
        name: result.title,
        rating: result.rating,
        reviews_count: result.reviews_count,
      },
      reviews: reviews.slice(0, 10)
    });

  } catch (error) {
    console.error('Fetch reviews error:', error);
    return res.status(500).json({ error: error.message });
  }
};
