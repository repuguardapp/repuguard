const TRUSTPILOT_KEY  = process.env.TRUSTPILOT_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;

async function authenticate(req) {
  const auth = (req.headers['authorization'] || '');
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return { ok: true, userId: null };
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const u = await r.json();
    if (u.id) return { ok: true, userId: u.id };
  }
  return { ok: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!TRUSTPILOT_KEY) return res.status(500).json({ error: 'TRUSTPILOT_API_KEY not configured' });

  try {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

    const { businessName, location, clientId } = req.body;
    if (!businessName || !clientId) return res.status(400).json({ error: 'Paramètres manquants' });
    if (auth.userId && auth.userId !== clientId) return res.status(403).json({ error: 'Forbidden' });

    // 1. Search business unit on Trustpilot
    const searchUrl = `https://api.trustpilot.com/v1/business-units/search?query=${encodeURIComponent(businessName)}${location ? '&country=' + encodeURIComponent(location) : ''}&apikey=${TRUSTPILOT_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.businesses?.length) {
      return res.status(404).json({ error: 'Établissement non trouvé sur Trustpilot', query: businessName });
    }

    const business = searchData.businesses[0];
    const businessUnitId = business.id;
    const avgRating = business.stars || 0;
    const totalReviews = business.numberOfReviews?.total || 0;

    // 2. Fetch reviews (latest 20)
    const reviewsUrl = `https://api.trustpilot.com/v1/business-units/${businessUnitId}/reviews?apikey=${TRUSTPILOT_KEY}&perPage=20&orderBy=createdat.desc`;
    const reviewsRes = await fetch(reviewsUrl);
    const reviewsData = await reviewsRes.json();
    const reviews = reviewsData.reviews || [];
    const negativeReviews = reviews.filter(r => (r.stars || 0) <= 2);

    // 3. Save to Supabase (skip duplicates)
    for (const review of reviews) {
      await fetch(SUPABASE_URL + '/rest/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          client_id:     clientId,
          platform:      'trustpilot',
          review_id:     `trustpilot_${businessUnitId}_${review.id}`,
          author:        review.consumer?.displayName || 'Anonyme',
          rating:        review.stars || 0,
          text:          review.text || '',
          date:          review.createdAt || new Date().toISOString(),
          is_negative:   (review.stars || 0) <= 2,
          needs_response:(review.stars || 0) <= 2,
          place_id:      businessUnitId,
        }),
      });
    }

    // 4. Update client score + business unit ID
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        trustpilot_business_id: businessUnitId,
        trustpilot_score:       avgRating,
        last_sync:              new Date().toISOString(),
      }),
    });

    // 5. Alert emails + webhook for negative reviews
    if (negativeReviews.length > 0) {
      const clientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=email,first_name,business_name,lang,webhook_url,webhook_enabled`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      const clients = await clientRes.json();

      if (clients.length > 0) {
        const client = clients[0];
        for (const review of negativeReviews) {
          const reviewPayload = {
            platform: 'Trustpilot',
            author:   review.consumer?.displayName,
            rating:   review.stars,
            text:     review.text,
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
      success:        true,
      businessUnitId,
      avgRating,
      totalReviews,
      reviewsFetched: reviews.length,
      negativeCount:  negativeReviews.length,
    });

  } catch (error) {
    console.error('Trustpilot fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
}
