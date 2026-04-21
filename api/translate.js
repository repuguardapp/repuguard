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

  try {
    const body = await req.json();
    // Accepte 'lang' ou 'targetLang' (landing page envoie targetLang)
    const lang = body.lang || body.targetLang;
    const langName = body.langName || lang;
    const texts = body.texts;

    if (!lang || !texts || typeof texts !== 'object' || Array.isArray(texts) || Object.keys(texts).length > 150) {
      return new Response(JSON.stringify({ error: 'Paramètres invalides' }), { status: 400, headers });
    }

    const prompt = `Translate these JSON values from French to ${langName} (language code: ${lang}). Keep all keys unchanged. Return ONLY valid JSON with no markdown:\n${JSON.stringify(texts)}`;

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
