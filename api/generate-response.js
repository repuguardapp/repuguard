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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    // Verify JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': auth }
    });
    const user = await userRes.json();
    if (!user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    const { reviewText, rating, author, platform, businessName } = await req.json();

    const prompt = `Tu es le responsable de "${businessName || 'notre établissement'}". Rédige une réponse professionnelle, chaleureuse et constructive à cet avis ${platform || 'Google'} en français.

Avis de ${author || 'un client'} (${rating || 1}★/5) :
"${reviewText || ''}"

Règles :
- 2-4 phrases maximum
- Ton professionnel mais humain
- Reconnaître le problème soulevé
- Proposer une solution ou inviter à recontacter
- Signer au nom de l'établissement
- Ne pas mentionner de remboursement ou compensation directement
- Répondre UNIQUEMENT avec le texte de la réponse, sans guillemets ni introduction`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const response = data.content?.[0]?.text?.trim() || '';

    return new Response(JSON.stringify({ response }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
