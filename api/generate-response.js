export const config = { runtime: 'edge' };

const DAILY_LIMITS = { starter: 50, pro: 200, business: 99999 };

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const base = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };

  try {
    // Verify JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': auth }
    });
    const user = await userRes.json();
    if (!user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    // Fetch client to check plan, subscription status, and daily usage
    const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${user.id}&select=plan,responses_today,responses_date,trial_ends,subscription_status`, { headers: base });
    const clients = await clientRes.json();
    if (!clients.length) return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers });
    const client = clients[0];

    // Block expired trial + inactive subscription
    const trialValid = client.trial_ends && new Date(client.trial_ends) > new Date();
    const subActive = ['active', 'trialing'].includes(client.subscription_status);
    if (!trialValid && !subActive) {
      return new Response(JSON.stringify({ error: 'Abonnement expiré. Veuillez activer un plan pour continuer.' }), { status: 402, headers });
    }

    const plan = client.plan || 'starter';
    const limit = DAILY_LIMITS[plan] || DAILY_LIMITS.starter;
    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = client.responses_date !== today;
    const usedToday = isNewDay ? 0 : (client.responses_today || 0);

    if (usedToday >= limit) {
      return new Response(JSON.stringify({
        error: `Limite journalière atteinte (${limit} réponses/${plan}). Revenez demain ou passez au plan supérieur.`
      }), { status: 429, headers });
    }

    const body = await req.json();
    const { reviewText, rating, author, platform, businessName } = body;

    if (!reviewText) return new Response(JSON.stringify({ error: 'reviewText requis' }), { status: 400, headers });

    // Sanitize inputs to prevent prompt injection
    const safeText = String(reviewText).slice(0, 1000).replace(/[`<>]/g, '');
    const safeAuthor = String(author || '').slice(0, 100).replace(/[`<>]/g, '');
    const safeBusiness = String(businessName || '').slice(0, 200).replace(/[`<>]/g, '');
    const safePlatform = String(platform || 'Google').slice(0, 50).replace(/[`<>]/g, '');

    const prompt = `Tu es responsable de la relation client pour "${safeBusiness}". Rédige une réponse professionnelle en français à cet avis ${safePlatform} (${rating || 1}★/5) de ${safeAuthor || 'un client'}.

Avis : "${safeText}"

Consignes strictes :
- 2 à 4 phrases maximum
- Ton professionnel et humain, jamais défensif
- Reconnaître le retour, proposer une suite concrète
- Signer au nom de l'équipe
- Répondre UNIQUEMENT avec le texte de la réponse, sans guillemets`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': process.env.ANTHROPIC_API_VERSION || '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: errData.error?.message || 'Erreur API IA' }), { status: 502, headers });
    }

    const data = await aiRes.json();
    const response = data.content?.[0]?.text?.trim();
    if (!response) return new Response(JSON.stringify({ error: 'Réponse IA vide' }), { status: 502, headers });

    // Increment daily counter
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...base, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        responses_today: isNewDay ? 1 : usedToday + 1,
        responses_date: today,
      }),
    });

    return new Response(JSON.stringify({ response, remaining: limit - usedToday - 1 }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
