export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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

    const body = await req.json();
    const allowed = ['business_name', 'email', 'country', 'webhook_url', 'webhook_enabled', 'auto_respond_5star', 'trustpilot_business_id'];
    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (key === 'webhook_url') {
          const url = String(body[key]).trim();
          if (url === '') { patch[key] = null; continue; }
          try { const u = new URL(url); if (u.protocol !== 'https:') continue; } catch { continue; }
          patch[key] = url;
        } else if (key === 'trustpilot_business_id') {
          // Only allow disconnecting (null); connecting goes through fetch-reviews-trustpilot
          if (body[key] === null) patch[key] = null;
        } else if (key === 'webhook_enabled' || key === 'auto_respond_5star') {
          patch[key] = Boolean(body[key]);
        } else if (body[key] !== '') {
          patch[key] = body[key];
        }
      }
    }
    if (!Object.keys(patch).length) return new Response(JSON.stringify({ error: 'Nothing to update' }), { status: 400, headers });

    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${user.id}`, {
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
