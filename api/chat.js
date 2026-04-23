export const config = { runtime: 'edge' };

const SYSTEM = `Tu es l'assistant RepuGuard, une plateforme SaaS de surveillance de réputation en ligne.

PRODUIT :
- Surveille actuellement : Google Reviews, Trustpilot et TripAdvisor. Facebook et Booking.com en cours d'intégration (disponibles bientôt)
- Alertes instantanées par email et SMS dès qu'un avis négatif est détecté
- Réponses professionnelles rédigées automatiquement par IA, dans la langue du client
- Score de réputation global mis à jour en temps réel
- Configuration en moins de 5 minutes, aucune compétence technique requise

PLANS (tous avec 7 jours d'essai gratuit, sans carte bancaire) :
- Starter 29€/mois : 1 établissement, Google + Trustpilot + TripAdvisor, alertes email, rapport mensuel, 5 réponses IA/mois
- Pro 69€/mois : 3 établissements, toutes plateformes disponibles, alertes email + SMS, rapport hebdomadaire, réponses IA illimitées, score réputation temps réel
- Business 149€/mois : 10 établissements, toutes plateformes, alertes prioritaires, rapports white-label, accès API, support prioritaire

RÈGLES STRICTES :
- Réponds uniquement aux questions sur RepuGuard et la gestion de réputation en ligne
- Ne jamais inventer de fonctionnalités ou de prix non listés ci-dessus
- Réponses concises : 2-3 phrases maximum
- Aucun formatage markdown : pas de **, *, #, listes à puces ou tirets
- Pas d'emoji dans les réponses
- Si la question sort du domaine produit, redirige poliment
- Propose toujours l'essai gratuit si c'est pertinent`;

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://repuguard.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  // Block requests not originating from repuguard.app (blocks bots, scrapers, direct API abuse)
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!origin.startsWith('https://repuguard.app')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });
  }

  try {
    const body = await req.json();
    const { message, history = [] } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message requis' }), { status: 400, headers });
    }

    const safeMessage = String(message).slice(0, 500).replace(/[<>]/g, '');

    // Keep last 8 messages max to control cost
    const safeHistory = Array.isArray(history)
      ? history.slice(-8).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 500),
        }))
      : [];

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [...safeHistory, { role: 'user', content: safeMessage }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!aiRes.ok) {
      return new Response(JSON.stringify({ error: 'Erreur IA, réessayez' }), { status: 502, headers });
    }

    const data = await aiRes.json();
    const reply = data.content?.[0]?.text?.trim();
    if (!reply) return new Response(JSON.stringify({ error: 'Réponse vide' }), { status: 502, headers });

    return new Response(JSON.stringify({ reply }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers });
  }
}
