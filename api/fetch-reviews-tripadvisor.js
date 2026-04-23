const TRIPADVISOR_KEY = process.env.TRIPADVISOR_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;

const TA_BASE = 'https://api.content.tripadvisor.com/api/v1/location';

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
  if (!TRIPADVISOR_KEY) return res.status(500).json({ error: 'TRIPADVISOR_API_KEY not configured' });

  try {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

    const { businessName, location, clientId, lang } = req.body;
    if (!businessName || !clientId) return res.status(400).json({ error: 'Paramètres manquants' });
    if (auth.userId && auth.userId !== clientId) return res.status(403).json({ error: 'Forbidden' });

    // Block expired trial + inactive subscription (skip check for cron calls)
    if (auth.userId) {
      const accessRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=trial_ends,subscription_status`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
      });
      const accessData = await accessRes.json();
      if (accessData.length > 0) {
        const c = accessData[0];
        const trialValid = c.trial_ends && new Date(c.trial_ends) > new Date();
        const subActive = ['active', 'trialing'].includes(c.subscription_status);
        if (!trialValid && !subActive) {
          return res.status(402).json({ error: 'Abonnement expiré.' });
        }
      }
    }

    const language = lang || 'fr';

    // 1. Search for the location on TripAdvisor
    const searchRes = await fetch(
      `${TA_BASE}/search?searchQuery=${encodeURIComponent(businessName + (location ? ' ' + location : ''))}&language=${language}&key=${TRIPADVISOR_KEY}`,
      { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' } }
    );
    const searchData = await searchRes.json();

    if (!searchData.data?.length) {
      return res.status(404).json({ error: 'Établissement non trouvé sur TripAdvisor', query: businessName });
    }

    const locationId = searchData.data[0].location_id;
    const locationName = searchData.data[0].name || businessName;

    // 2. Fetch location details (rating, review count)
    const detailsRes = await fetch(
      `${TA_BASE}/${locationId}/details?language=${language}&key=${TRIPADVISOR_KEY}`,
      { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' } }
    );
    const details = await detailsRes.json();
    const avgRating = parseFloat(details.rating || 0);
    const totalReviews = parseInt(details.num_reviews || 0, 10);

    // 3. Fetch latest reviews
    const reviewsRes = await fetch(
      `${TA_BASE}/${locationId}/reviews?language=${language}&key=${TRIPADVISOR_KEY}`,
      { headers: { 'Accept': 'application/json', 'Origin': 'https://repuguard.app' } }
    );
    const reviewsData = await reviewsRes.json();
    const reviews = reviewsData.data || [];
    const negativeReviews = reviews.filter(r => (r.rating || 0) <= 2);

    // 4. Save to Supabase (parallel inserts, skip duplicates)
    await Promise.all(reviews.map(review =>
      fetch(SUPABASE_URL + '/rest/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          client_id:     clientId,
          platform:      'tripadvisor',
          review_id:     `tripadvisor_${locationId}_${review.id}`,
          author:        review.user?.username || 'Anonyme',
          rating:        review.rating || 0,
          text:          review.text || review.title || '',
          date:          review.published_date || new Date().toISOString(),
          is_negative:   (review.rating || 0) <= 2,
          needs_response:(review.rating || 0) <= 2,
          place_id:      String(locationId),
        }),
      }).catch(e => console.error('TripAdvisor review insert error:', e.message))
    ));

    // 5. Update client record with TripAdvisor info
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        tripadvisor_location_id: String(locationId),
        tripadvisor_score:       avgRating,
        last_sync:               new Date().toISOString(),
      }),
    });

    // 6. Alert emails + webhook for negative reviews
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
            platform: 'TripAdvisor',
            author:   review.user?.username || 'Anonyme',
            rating:   review.rating,
            text:     review.text || review.title || '',
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
          }).catch(e => console.error('TA alert email error:', e.message));

          if (client.webhook_enabled && client.webhook_url) {
            fetch('https://repuguard.app/api/send-webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
              body: JSON.stringify({
                webhookUrl:   client.webhook_url,
                businessName: client.business_name,
                review:       reviewPayload,
              }),
            }).catch(e => console.error('TA webhook error:', e.message));
          }
        }
      }
    }

    return res.status(200).json({
      success:        true,
      locationId,
      locationName,
      avgRating,
      totalReviews,
      reviewsFetched: reviews.length,
      negativeCount:  negativeReviews.length,
    });

  } catch (error) {
    console.error('TripAdvisor fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
}
