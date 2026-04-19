import { Resend } from 'resend';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

// Emails transactionnels toujours envoyés (paiement, sécurité)
const TRANSACTIONAL = ['welcome', 'alert', 'payment_failed', 'cancelled'];

function unsubLink(email) {
  const sig = crypto.createHmac('sha256', SUPABASE_KEY).update(email.toLowerCase()).digest('hex');
  return `https://repuguard.app/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, email, firstName, businessName, plan, review } = req.body;

    if (!email || !type) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // Vérification désabonnement pour les emails non-transactionnels
    if (!TRANSACTIONAL.includes(type) && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&select=email_unsubscribed`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
        });
        const rows = await checkRes.json();
        if (rows[0]?.email_unsubscribed) {
          return res.status(200).json({ success: true, skipped: 'unsubscribed' });
        }
      } catch (_) { /* non-bloquant */ }
    }

    let subject, html;

    // ══════════════════════════════════
    // EMAIL DE BIENVENUE
    // ══════════════════════════════════
    if (type === 'welcome') {
      subject = `Bienvenue sur RepuGuard, ${firstName} !`;
      html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        
        <tr>
          <td style="background:#0e1018;padding:40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-weight:900;font-size:28px;color:#f1f5f9;letter-spacing:-1px;">Repu<span style="color:#818cf8;">Guard</span></div>
            <div style="margin-top:8px;font-size:13px;color:#475569;">Surveillance de réputation en ligne</div>
          </td>
        </tr>

        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#f1f5f9;">Bienvenue, ${firstName} ! 🎉</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">Votre compte RepuGuard est activé. Votre réputation en ligne est maintenant surveillée 24h/24, 7j/7.</p>

            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:28px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#818cf8;margin-bottom:6px;">✦ Votre plan</div>
              <div style="font-size:18px;font-weight:800;color:#f1f5f9;">${plan || 'Pro'}</div>
              <div style="font-size:12px;color:#475569;margin-top:2px;">14 jours d'essai gratuit — aucun débit aujourd'hui</div>
            </div>

            ${businessName ? `
            <div style="background:#13151f;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
              <div style="font-size:11px;color:#475569;margin-bottom:4px;">Établissement surveillé</div>
              <div style="font-size:16px;font-weight:700;color:#f1f5f9;">${businessName}</div>
            </div>
            ` : ''}

            <div style="margin-bottom:28px;">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:16px;">Prochaines étapes</div>
              <div style="margin-bottom:12px;font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">1.</span> Accédez à votre dashboard et vérifiez vos profils</div>
              <div style="margin-bottom:12px;font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">2.</span> Configurez vos préférences d'alerte</div>
              <div style="font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">3.</span> Attendez votre première alerte — nous surveillons déjà</div>
            </div>

            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">Accéder à mon dashboard →</a>
            </div>

            <p style="margin:0;font-size:13px;color:#475569;text-align:center;">Des questions ? Répondez à cet email. Notre équipe vous répond sous 24h.</p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app · <a href="${unsubLink(email)}" style="color:#475569;">Se désabonner</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    }

    // ══════════════════════════════════
    // EMAIL D'ALERTE AVIS NÉGATIF
    // ══════════════════════════════════
    if (type === 'alert' && review) {
      const stars = '★'.repeat(review.rating || 0) + '☆'.repeat(5 - (review.rating || 0));
      const gravityScore = Math.round((5 - (review.rating || 0)) * 2);

      subject = `🚨 Avis négatif détecté — ${review.platform} — Action requise`;
      html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">

        <!-- HEADER ALERTE -->
        <tr>
          <td style="background:rgba(248,113,113,0.08);border-bottom:1px solid rgba(248,113,113,0.2);padding:28px 40px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="font-weight:900;font-size:22px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
            </div>
            <div style="margin-top:12px;">
              <span style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);color:#f87171;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;text-transform:uppercase;letter-spacing:0.06em;">🚨 Alerte critique</span>
            </div>
            <h1 style="margin:12px 0 0;font-size:20px;font-weight:800;color:#f1f5f9;">Avis négatif détecté</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">

            <!-- INFO ALERTE -->
            <div style="background:#13151f;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">Plateforme</span>
                <span style="font-size:12px;font-weight:700;color:#f1f5f9;">${review.platform}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">Auteur</span>
                <span style="font-size:12px;font-weight:700;color:#f1f5f9;">${review.author || 'Anonyme'}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">Note</span>
                <span style="font-size:14px;color:#f87171;font-weight:700;">${stars} ${review.rating}/5</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="font-size:12px;color:#475569;">Gravité</span>
                <span style="font-size:12px;font-weight:700;color:#f87171;">${gravityScore}/10</span>
              </div>
            </div>

            <!-- TEXTE DE L'AVIS -->
            <div style="margin-bottom:20px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px;">Avis</div>
              <div style="background:#13151f;border-left:3px solid #f87171;border-radius:0 8px 8px 0;padding:14px 16px;font-size:13px;color:#94a3b8;line-height:1.6;font-style:italic;">
                "${review.text || 'Aucun texte'}"
              </div>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:24px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">✦ Voir la réponse IA générée →</a>
            </div>

            <p style="margin:0;font-size:12px;color:#475569;text-align:center;line-height:1.6;">
              RepuGuard a automatiquement généré une réponse professionnelle.<br>
              Connectez-vous pour la valider et la publier en 1 clic.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    }

    // ══════════════════════════════════
    // EMAIL RAPPORT HEBDOMADAIRE
    // ══════════════════════════════════
    if (type === 'report' && req.body.reportData) {
      const { avgRating, totalReviews, newReviews, negativeCount, positiveCount, period } = req.body.reportData;
      const positiveRate = totalReviews > 0 ? Math.round((positiveCount / totalReviews) * 100) : 0;
      const negativeRate = totalReviews > 0 ? Math.round((negativeCount / totalReviews) * 100) : 0;
      const ratingStars = '★'.repeat(Math.round(avgRating || 0)) + '☆'.repeat(5 - Math.round(avgRating || 0));

      subject = `📊 Votre rapport hebdomadaire RepuGuard — ${period || 'Cette semaine'}`;
      html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">

        <tr>
          <td style="background:#0e1018;padding:40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-weight:900;font-size:28px;color:#f1f5f9;letter-spacing:-1px;">Repu<span style="color:#818cf8;">Guard</span></div>
            <div style="margin-top:8px;font-size:13px;color:#475569;">Rapport hebdomadaire · ${period || 'Cette semaine'}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9;">Bonjour ${firstName} 👋</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.6;">Voici le résumé de réputation de <strong style="color:#f1f5f9;">${businessName}</strong> pour cette semaine.</p>

            <!-- SCORE GLOBAL -->
            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#818cf8;margin-bottom:8px;">◈ Score global</div>
              <div style="font-size:42px;font-weight:900;color:#f1f5f9;font-family:Arial,sans-serif;line-height:1;">${avgRating ? avgRating.toFixed(1) : '—'}</div>
              <div style="font-size:16px;color:#818cf8;margin-top:4px;">${ratingStars}</div>
            </div>

            <!-- MÉTRIQUES -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td width="33%" style="padding:0 6px 0 0;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">Nouveaux avis</div>
                    <div style="font-size:26px;font-weight:800;color:#f1f5f9;">${newReviews || 0}</div>
                  </div>
                </td>
                <td width="33%" style="padding:0 3px;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">Avis positifs</div>
                    <div style="font-size:26px;font-weight:800;color:#34d399;">${positiveRate}%</div>
                  </div>
                </td>
                <td width="33%" style="padding:0 0 0 6px;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">Avis négatifs</div>
                    <div style="font-size:26px;font-weight:800;color:${negativeCount > 0 ? '#f87171' : '#34d399'};">${negativeRate}%</div>
                  </div>
                </td>
              </tr>
            </table>

            ${negativeCount > 0 ? `
            <!-- ALERTE AVIS NÉGATIFS -->
            <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:4px;">⚠ ${negativeCount} avis négatif${negativeCount > 1 ? 's' : ''} détecté${negativeCount > 1 ? 's' : ''} cette semaine</div>
              <div style="font-size:12px;color:#94a3b8;">Des réponses IA ont été générées — connectez-vous pour les valider.</div>
            </div>
            ` : `
            <!-- AUCUN AVIS NÉGATIF -->
            <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:12px;font-weight:700;color:#34d399;margin-bottom:4px;">✓ Aucun avis négatif cette semaine</div>
              <div style="font-size:12px;color:#94a3b8;">Excellente semaine pour votre réputation !</div>
            </div>
            `}

            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">Voir le dashboard complet →</a>
            </div>

            <p style="margin:0;font-size:12px;color:#475569;text-align:center;">Ce rapport est envoyé automatiquement chaque lundi à 08h00.</p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app · <a href="${unsubLink(email)}" style="color:#475569;">Se désabonner</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    }

    // ══════════════════════════════════
    // EMAIL ÉCHEC DE PAIEMENT
    // ══════════════════════════════════
    if (type === 'payment_failed') {
      subject = `⚠️ Problème de paiement — Votre abonnement RepuGuard`;
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <div style="background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.25);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:#fb923c;">⚠ Paiement échoué</div>
        </div>
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">Bonjour ${firstName},</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">Nous n'avons pas pu débiter votre carte pour votre abonnement RepuGuard. Votre surveillance continue pour l'instant, mais veuillez mettre à jour vos informations de paiement rapidement pour éviter toute interruption.</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard#abonnement" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">Mettre à jour le paiement →</a>
        </div>
        <p style="font-size:12px;color:#475569;text-align:center;">Des questions ? Répondez à cet email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    }

    // ══════════════════════════════════
    // EMAIL ANNULATION ABONNEMENT
    // ══════════════════════════════════
    if (type === 'cancelled') {
      subject = `Votre abonnement RepuGuard a été annulé`;
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">Bonjour ${firstName},</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">Votre abonnement RepuGuard a bien été annulé. Votre réputation ne sera plus surveillée. Vous pouvez vous réabonner à tout moment depuis votre dashboard.</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/signup" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">Se réabonner →</a>
        </div>
        <p style="font-size:12px;color:#475569;text-align:center;">Merci d'avoir utilisé RepuGuard.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    }

    // ══════════════════════════════════
    // EMAIL FIN D'ESSAI IMMINENTE
    // ══════════════════════════════════
    if (type === 'trial_ending') {
      const trialEnd = req.body.trialEnd || '';
      subject = `Votre essai gratuit RepuGuard se termine bientôt`;
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <div style="font-size:12px;color:#818cf8;font-weight:700;margin-bottom:4px;">⏳ Essai gratuit</div>
          <div style="font-size:18px;font-weight:800;color:#f1f5f9;">Se termine le ${trialEnd}</div>
        </div>
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">Bonjour ${firstName},</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">Votre essai gratuit de 14 jours se termine bientôt. Pour continuer à surveiller la réputation de <strong style="color:#f1f5f9;">${businessName}</strong> sans interruption, votre abonnement sera activé automatiquement.</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard#abonnement" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">Gérer mon abonnement →</a>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    }

    if (!subject || !html) {
      return res.status(400).json({ error: 'Type email non reconnu' });
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
