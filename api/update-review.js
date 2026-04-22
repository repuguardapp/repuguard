export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://repuguard.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  const token = auth.slice(7);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const user = await userRes.json();
    if (!user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    const { reviewId, action } = await req.json();
    if (!reviewId || !action) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400, headers });
    if (!['validate', 'dismiss'].includes(action)) return new Response(JSON.stringify({ error: 'Action invalide' }), { status: 400, headers });

    // validate: responded to the review, keep it as negative for stats
    // dismiss: user ignores it, remove from alert queue entirely
    const patch = action === 'validate'
      ? { needs_response: false }
      : { needs_response: false, is_negative: false };

    await fetch(`${SUPABASE_URL}/rest/v1/reviews?id=eq.${reviewId}&client_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(patch),
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
