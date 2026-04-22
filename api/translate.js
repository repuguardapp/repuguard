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

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const SUPPORTED_LANGS = new Set(['fr','en','es','de','pt','ar','it','nl','ru','zh','ja','ko','hi','tr','pl','sv','da','fi','nb','cs','ro','hu']);
  const LANG_NAMES = {fr:'French',en:'English',es:'Spanish',de:'German',pt:'Portuguese',ar:'Arabic',it:'Italian',nl:'Dutch',ru:'Russian',zh:'Chinese',ja:'Japanese',ko:'Korean',hi:'Hindi',tr:'Turkish',pl:'Polish',sv:'Swedish',da:'Danish',fi:'Finnish',nb:'Norwegian',cs:'Czech',ro:'Romanian',hu:'Hungarian'};

  try {
    const body = await req.json();
    // Accepte 'lang' ou 'targetLang' (landing page envoie targetLang)
    const lang = body.lang || body.targetLang;
    const texts = body.texts;

    if (!lang || !SUPPORTED_LANGS.has(lang)) {
      return new Response(JSON.stringify({ error: 'Langue non supportée' }), { status: 400, headers });
    }

    if (!texts || typeof texts !== 'object' || Array.isArray(texts) || Object.keys(texts).length > 150) {
      return new Response(JSON.stringify({ error: 'Paramètres invalides' }), { status: 400, headers });
    }

    const safeLangName = LANG_NAMES[lang];
    const prompt = `Translate these JSON values from French to ${safeLangName} (language code: ${lang}). Keep all keys unchanged. Return ONLY valid JSON with no markdown:\n${JSON.stringify(texts)}`;

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
