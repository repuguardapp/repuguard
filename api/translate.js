export const config = { runtime: 'edge' };

const SUPPORTED_LANGS = ['en', 'es', 'de', 'pt', 'ar'];
const LANG_NAMES = { en: 'English', es: 'Spanish', de: 'German', pt: 'Portuguese', ar: 'Arabic' };

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
    // Vérification JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': auth }
    });
    const user = await userRes.json();
    if (!user.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    const body = await req.json();
    const { lang, texts } = body;

    // Validation stricte
    if (!lang || !SUPPORTED_LANGS.includes(lang)) {
      return new Response(JSON.stringify({ error: 'Langue non supportée' }), { status: 400, headers });
    }
    if (!texts || typeof texts !== 'object' || Array.isArray(texts) || Object.keys(texts).length > 100) {
      return new Response(JSON.stringify({ error: 'Paramètre texts invalide' }), { status: 400, headers });
    }

    const langName = LANG_NAMES[lang];
    const prompt = `Translate these JSON values from French to ${langName}. Keep all keys unchanged. Return ONLY valid JSON with no markdown:\n${JSON.stringify(texts)}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await aiRes.json();
    const raw = data.content?.[0]?.text?.replace(/```json\n?|\n?```/g, '').trim() || '{}';

    let translations;
    try { translations = JSON.parse(raw); }
    catch { return new Response(JSON.stringify({ error: 'Erreur parsing traduction' }), { status: 500, headers }); }

    return new Response(JSON.stringify({ translations }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
