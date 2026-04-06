export const config = { runtime: ‘edge’ };

export default async function handler(req) {
// CORS headers
const corsHeaders = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
‘Content-Type’: ‘application/json’,
};

if (req.method === ‘OPTIONS’) {
return new Response(null, { status: 204, headers: corsHeaders });
}

if (req.method !== ‘POST’) {
return new Response(JSON.stringify({ error: ‘Method not allowed’ }), {
status: 405, headers: corsHeaders
});
}

try {
const { texts, targetLang, langName } = await req.json();

```
if (!texts || !targetLang || targetLang === 'fr') {
  return new Response(JSON.stringify({ translations: texts }), {
    status: 200, headers: corsHeaders
  });
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  return new Response(JSON.stringify({ error: 'API key not configured' }), {
    status: 500, headers: corsHeaders
  });
}

// Build the translation prompt
const textsJson = JSON.stringify(texts);
const prompt = `Translate the following JSON object values from French to ${langName} (${targetLang}).
```

STRICT RULES:

- Translate ONLY the values, never the keys
- Keep HTML tags like <br>, <em>, <strong> exactly as they are
- Keep special characters → ✓ ⚠ ★ 🔔 📡 ✍️ 📊 📬 🌍 exactly as they are
- Keep brand name “RepuGuard” unchanged
- Keep platform names (Google, TripAdvisor, Facebook, X, Reddit, etc.) unchanged
- Keep numbers, percentages, € symbols unchanged
- For RTL languages (Arabic, Hebrew, Persian), translate naturally
- Return ONLY valid JSON, no explanation, no markdown backticks

JSON to translate:
${textsJson}`;

```
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  }),
});

const data = await response.json();
const text = data.content?.[0]?.text || '{}';
const clean = text.replace(/```json\n?|\n?```/g, '').trim();
const translations = JSON.parse(clean);

return new Response(JSON.stringify({ translations }), {
  status: 200, headers: corsHeaders
});
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message }), {
status: 500, headers: corsHeaders
});
}
}
