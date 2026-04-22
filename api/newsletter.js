export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, lang } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Config manquante' });

  const isEn = lang === 'en';
  const subject = isEn
    ? '5 tips to manage your online reviews (free guide)'
    : '5 conseils pour gérer vos avis en ligne (guide offert)';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
        <div style="margin-top:6px;font-size:12px;color:#475569;">${isEn ? 'Your free guide is here' : 'Votre guide gratuit est arrivé'}</div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <h2 style="margin:0 0 20px;font-size:20px;color:#f1f5f9;">${isEn ? '5 tips to respond to negative reviews' : '5 conseils pour répondre aux avis négatifs'}</h2>
        ${isEn ? `
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">1. Respond within 24 hours</div>
          <div style="font-size:13px;color:#94a3b8;">Speed signals that you care. Customers who see a quick response are 3× more likely to return, even after a bad experience.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">2. Never argue publicly</div>
          <div style="font-size:13px;color:#94a3b8;">Acknowledge the issue, apologize sincerely, and take the conversation offline. Other readers are watching — your response is for them.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">3. Personalize every response</div>
          <div style="font-size:13px;color:#94a3b8;">Use the reviewer's name. Reference their specific complaint. Generic copy-paste responses hurt your reputation more than no response.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">4. Turn complaints into improvements</div>
          <div style="font-size:13px;color:#94a3b8;">Every negative review is free market research. Track recurring themes and fix the root cause — your score will recover naturally.</div>
        </div>
        <div style="margin-bottom:24px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">5. Ask happy customers for reviews</div>
          <div style="font-size:13px;color:#94a3b8;">For every 5-star review, you can absorb 4–5 negative ones without losing customers. Systematically ask satisfied clients to share their experience.</div>
        </div>
        ` : `
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">1. Répondez dans les 24h</div>
          <div style="font-size:13px;color:#94a3b8;">La rapidité montre que vous vous souciez de vos clients. Un client qui reçoit une réponse rapide est 3× plus susceptible de revenir, même après une mauvaise expérience.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">2. Ne débattez jamais publiquement</div>
          <div style="font-size:13px;color:#94a3b8;">Reconnaissez le problème, excusez-vous sincèrement, et invitez à continuer en privé. Les autres lecteurs observent — votre réponse leur est destinée aussi.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">3. Personnalisez chaque réponse</div>
          <div style="font-size:13px;color:#94a3b8;">Utilisez le prénom du client. Référencez sa plainte spécifique. Les réponses copy-paste génériques nuisent plus qu'une absence de réponse.</div>
        </div>
        <div style="margin-bottom:16px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">4. Transformez les plaintes en améliorations</div>
          <div style="font-size:13px;color:#94a3b8;">Chaque avis négatif est une étude de marché gratuite. Identifiez les thèmes récurrents et corrigez la cause profonde — votre note remontera naturellement.</div>
        </div>
        <div style="margin-bottom:24px;padding:16px;background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">5. Demandez des avis à vos clients satisfaits</div>
          <div style="font-size:13px;color:#94a3b8;">Pour chaque avis 5 étoiles, vous pouvez absorber 4 à 5 avis négatifs sans perdre de clients. Demandez systématiquement à vos clients contents de partager leur expérience.</div>
        </div>
        `}
        <div style="text-align:center;margin-top:24px;padding:20px;background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.06));border:1px solid rgba(99,102,241,.2);border-radius:12px;">
          <div style="font-size:14px;color:#94a3b8;margin-bottom:12px;">${isEn ? 'Let RepuGuard automate all of this — 7-day free trial, no credit card required.' : 'Laissez RepuGuard automatiser tout ça — essai 7 jours gratuit, sans CB.'}</div>
          <a href="https://repuguard.app/signup" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:13px;">${isEn ? 'Start free trial →' : 'Démarrer l\'essai gratuit →'}</a>
        </div>
        <div style="margin-top:24px;font-size:11px;color:#334155;text-align:center;">
          ${isEn ? 'You received this because you subscribed on repuguard.app.' : 'Vous recevez cet email car vous vous êtes inscrit sur repuguard.app.'}<br>
          <a href="https://repuguard.app/unsubscribe?email=${encodeURIComponent(email)}" style="color:#475569;">Se désinscrire</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    // Send tips email to subscriber
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'RepuGuard <bonjour@repuguard.app>',
        to: [email],
        subject,
        html,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.message || 'Erreur envoi email' });

    // Notify admin (non-blocking)
    if (ADMIN_EMAIL) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'RepuGuard <bonjour@repuguard.app>',
          to: [ADMIN_EMAIL],
          subject: `[Lead] Nouvel abonné newsletter : ${email}`,
          html: `<p style="font-family:Arial;color:#333;">Nouveau lead newsletter : <strong>${email}</strong> (lang: ${lang || 'fr'})</p>`,
        }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
