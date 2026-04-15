export const config = { runtime: ‘edge’ };

export default async function handler(req) {
const headers = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
‘Content-Type’: ‘application/json’,
};

if (req.method === ‘OPTIONS’) return new Response(null, { status: 204, headers });
if (req.method !== ‘POST’) return new Response(JSON.stringify({ error: ‘Method not allowed’ }), { status: 405, headers });

try {
const body = await req.json();
const { action, email, password, firstName, lastName, businessName, sector, country, plan } = body;

```
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (action === 'signup') {
  // 1. Create auth user in Supabase
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const authData = await authRes.json();
  if (authData.error) return new Response(JSON.stringify({ error: authData.error.message || authData.msg }), { status: 400, headers });

  const userId = authData.user?.id || authData.id;

  // 2. Create profile in clients table
  await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      business_name: businessName,
      sector,
      country,
      plan: plan || 'pro',
      trial_ends: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
    }),
  });

  return new Response(JSON.stringify({ success: true, userId }), { status: 200, headers });
}

if (action === 'login') {
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const loginData = await loginRes.json();
  if (loginData.error) return new Response(JSON.stringify({ error: 'Email ou mot de passe incorrect' }), { status: 401, headers });

  return new Response(JSON.stringify({
    success: true,
    token: loginData.access_token,
    user: loginData.user,
  }), { status: 200, headers });
}

if (action === 'me') {
  const token = body.token;
  const meRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${body.userId}&select=*`, {
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  const meData = await meRes.json();
  return new Response(JSON.stringify({ user: meData[0] }), { status: 200, headers });
}

return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
}
}
