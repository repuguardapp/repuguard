export default async function handler(req) {
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
const body = await req.json();
const texts = body.texts;
const targetLang = body.targetLang;
const langName = body.langName;

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

const textsJson = JSON.stringify(texts);
const prompt = 'Translate the following JSON object values from French to ' + langName + ' (' + targetLang + ').\n\nSTRICT RULES:\n- Translate ONLY the values, never the keys\n- Keep HTML tags like <br>, <em>, <strong> exactly as they are\n- Keep special characters and emojis exactly as they are\n- Keep brand name RepuGuard unchanged\n- Keep platform names (Google, TripAdvisor, Facebook, X, Reddit) unchanged\n- Keep numbers and symbols unchanged\n- Return ONLY valid JSON, no explanation, no markdown\n\nJSON to translate:\n' + textsJson;

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
const text = data.content[0].text;
const clean = text.replace(/```json\n?|\n?```/g, '').trim();
const translations = JSON.parse(clean);

return new Response(JSON.stringify({ translations: translations }), {
  status: 200, headers: corsHeaders
});
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message }), {
status: 500, headers: corsHeaders
});
}
}

export const config = { runtime: ‘edge’ };
