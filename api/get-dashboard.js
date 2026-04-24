export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://repuguard.app',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  const token = auth.slice(7);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
  const base = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };

  try {
    // Verify JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const user = await userRes.json();
    if (!user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    const uid = user.id;

    // Fetch client + reviews in parallel
    const [clientRes, reviewsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${uid}&select=*`, { headers: base }),
      fetch(`${SUPABASE_URL}/rest/v1/reviews?client_id=eq.${uid}&order=date.desc&limit=100&select=*`, { headers: base }),
    ]);
    const [clients, reviews] = await Promise.all([clientRes.json(), reviewsRes.json()]);

    if (!clients.length) return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers });
    const client = clients[0];
    const allReviews = Array.isArray(reviews) ? reviews : [];

    // Compute stats
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const negatives = allReviews.filter(r => r.is_negative);
    const pending = allReviews.filter(r => r.is_negative && r.needs_response);
    const positives = allReviews.filter(r => (r.rating || 0) >= 4);
    const newThisWeek = allReviews.filter(r => r.date && new Date(r.date) > weekAgo);

    // Cross-platform reputation score
    const platformScores = [
      client.google_score,
      client.trustpilot_score,
      client.tripadvisor_score,
    ].filter(s => s && s > 0);
    const avgRating = platformScores.length > 0
      ? Math.round((platformScores.reduce((a, b) => a + b, 0) / platformScores.length) * 10) / 10
      : 0;

    const platforms = {
      google:      { score: client.google_score || 0, connected: !!client.google_place_id },
      trustpilot:  { score: client.trustpilot_score || 0, connected: !!client.trustpilot_business_id },
      tripadvisor: { score: client.tripadvisor_score || 0, connected: !!client.tripadvisor_location_id },
    };

    return new Response(JSON.stringify({
      client,
      platforms,
      stats: {
        avgRating,
        totalReviews: client.total_reviews || allReviews.length,
        pendingResponses: pending.length,
        negativeCount: negatives.length,
        newThisWeek: newThisWeek.length,
        positiveCount: positives.length,
      },
      recentAlerts: negatives.slice(0, 3),
      allAlerts: negatives.slice(0, 20),
      pendingResponses: pending.slice(0, 10),
      reviews: allReviews.slice(0, 20),
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
