const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'] || '';
  const isInternal = CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;

  // JWT auth for dashboard test button
  let userId = null;
  if (!isInternal) {
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = auth.slice(7);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const u = await r.json();
    if (!u.id) return res.status(401).json({ error: 'Unauthorized' });
    userId = u.id;
  }

  try {
    const { webhookUrl, businessName, review, isTest } = req.body;

    if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl requis' });

    // Validate URL: must be https and not a private/internal IP (SSRF protection)
    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
      if (parsedUrl.protocol !== 'https:') throw new Error('HTTPS requis');
      const h = parsedUrl.hostname.toLowerCase();
      // Block IPv6 literals (e.g. [::1]), localhost, and private IP ranges
      if (h.startsWith('[') || /^(localhost|127\.|0\.0\.0\.0|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
        throw new Error('URL invalide');
      }
    } catch {
      return res.status(400).json({ error: 'URL webhook invalide (HTTPS requis)' });
    }

    // If JWT call, verify webhook belongs to this user
    if (userId) {
      const clientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${userId}&select=webhook_url,business_name`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      const clients = await clientRes.json();
      if (!clients.length || clients[0].webhook_url !== webhookUrl) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const stars = review?.rating ? '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) : '';
    const severity = review?.rating ? Math.round((5 - review.rating) * 2) : 0;

    // Slack Block Kit format (also compatible with Teams via Office 365 Connector and Discord)
    const payload = isTest ? {
      text: '✅ Test RepuGuard — votre webhook est correctement configuré.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*✅ Webhook RepuGuard opérationnel*\nLes alertes de réputation seront envoyées ici en temps réel.',
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Configuré pour *${businessName || 'votre établissement'}* · repuguard.app` }],
        },
      ],
    } : {
      text: `🚨 Avis ${review?.rating || 0}★ sur ${review?.platform || 'Google'} — ${businessName || ''}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🚨 Avis critique — ${review?.platform || 'Google'}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Établissement:*\n${businessName || '—'}` },
            { type: 'mrkdwn', text: `*Note:*\n${stars} ${review?.rating || 0}/5` },
            { type: 'mrkdwn', text: `*Auteur:*\n${review?.author || 'Anonyme'}` },
            { type: 'mrkdwn', text: `*Sévérité:*\n${severity}/10 ${severity >= 7 ? '🔴 Critique' : '🟠 Modéré'}` },
          ],
        },
        ...(review?.text ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Avis:*\n_"${review.text.substring(0, 300)}"_` },
        }] : []),
        {
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'Voir la réponse IA →' },
            url: 'https://repuguard.app/dashboard',
            style: 'primary',
          }],
        },
      ],
    };

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!webhookRes.ok) {
      const text = await webhookRes.text().catch(() => '');
      return res.status(502).json({ error: `Webhook refusé: ${webhookRes.status} ${text.slice(0, 100)}` });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
