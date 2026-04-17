const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, email, firstName, businessName, plan } = req.body;

    if (!email || !type) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    let subject, html;

    if (type === 'welcome') {
      subject = `Bienvenue sur RepuGuard, ${firstName} !`;
      html = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bienvenue sur RepuGuard</title>
</head>
<body style="margin:0;padding:0;background:#07080f;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
          
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#0e1018,#13151f);padding:40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="font-family:Arial,sans-serif;font-weight:900;font-size:28px;color:#f1f5f9;letter-spacing:-1px;">
                Repu<span style="color:#818cf8;">Guard</span>
              </div>
              <div style="margin-top:8px;font-size:13px;color:#475569;">Surveillance de réputation en ligne</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#f1f5f9;line-height:1.3;">
                Bienvenue, ${firstName} ! 🎉
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
                Votre compte RepuGuard est activé. Votre réputation en ligne est maintenant surveillée 24h/24, 7j/7.
              </p>

              <!-- PLAN BADGE -->
              <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:28px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#818cf8;margin-bottom:6px;">✦ Votre plan</div>
                <div style="font-size:18px;font-weight:800;color:#f1f5f9;">${plan || 'Pro'}</div>
                <div style="font-size:12px;color:#475569;margin-top:2px;">14 jours d'essai gratuit — aucun débit aujourd'hui</div>
              </div>

              <!-- BUSINESS -->
              ${businessName ? `
              <div style="background:#13151f;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
                <div style="font-size:11px;color:#475569;margin-bottom:4px;">Établissement surveillé</div>
                <div style="font-size:16px;font-weight:700;color:#f1f5f9;">${businessName}</div>
              </div>
              ` : ''}

              <!-- NEXT STEPS -->
              <div style="margin-bottom:28px;">
                <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:16px;">Prochaines étapes</div>
                
                <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
                  <div style="width:24px;height:24px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#818cf8;margin-right:12px;flex-shrink:0;text-align:center;line-height:24px;">1</div>
                  <div style="font-size:13px;color:#94a3b8;line-height:1.5;padding-top:3px;">Accédez à votre dashboard et vérifiez que vos profils ont bien été détectés</div>
                </div>
                
                <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
                  <div style="width:24px;height:24px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#818cf8;margin-right:12px;flex-shrink:0;text-align:center;line-height:24px;">2</div>
                  <div style="font-size:13px;color:#94a3b8;line-height:1.5;padding-top:3px;">Configurez vos préférences d'alerte (email, fréquence)</div>
                </div>

                <div style="display:flex;align-items:flex-start;">
                  <div style="width:24px;height:24px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#818cf8;margin-right:12px;flex-shrink:0;text-align:center;line-height:24px;">3</div>
                  <div style="font-size:13px;color:#94a3b8;line-height:1.5;padding-top:3px;">Attendez votre première alerte — nous surveillons déjà</div>
                </div>
              </div>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:-0.01em;">
                  Accéder à mon dashboard →
                </a>
              </div>

              <p style="margin:0;font-size:13px;color:#475569;line-height:1.6;text-align:center;">
                Des questions ? Répondez directement à cet email.<br>
                Notre équipe vous répond sous 24h.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:11px;color:#334155;line-height:1.6;">
                RepuGuard · repuguard.app<br>
                Vous recevez cet email car vous venez de créer un compte.<br>
                <a href="https://repuguard.app" style="color:#475569;">Se désabonner</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;
    }

    const { data, error } = await resend.emails.send({
      from: 'RepuGuard <bonjour@repuguard.app>',
      to: email,
      subject,
      html,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (error) {
    console.error('Email error:', error);
    return res.status(500).json({ error: error.message || 'Erreur envoi email' });
  }
};
