import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

function sign(email) {
  return crypto
    .createHmac('sha256', SUPABASE_KEY)
    .update(email.toLowerCase())
    .digest('hex');
}

function page(title, message, color) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — RepuGuard</title>
<style>
  body{margin:0;background:#07080f;color:#f1f5f9;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:40px;max-width:480px;width:90%;text-align:center;}
  .logo{font-weight:900;font-size:24px;margin-bottom:24px;}
  .logo span{color:#818cf8;}
  h1{font-size:20px;margin:0 0 12px;}
  p{font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;}
  a{color:#6366f1;text-decoration:none;}
</style>
</head>
<body>
  <div class="card">
    <div class="logo">Repu<span>Guard</span></div>
    <h1 style="color:${color};">${title}</h1>
    <p>${message}</p>
    <a href="https://repuguard.app">← Retour au site</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { email, sig } = req.query;

  if (!email || !sig) {
    return res.status(400).send(page('Lien invalide', 'Ce lien de désabonnement est incomplet.', '#f87171'));
  }

  const expected = sign(email);

  // Comparaison en temps constant pour prévenir les attaques par timing
  let valid = false;
  try {
    const sigBuf = Buffer.from(sig.padEnd(64, '0').slice(0, 64), 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    return res.status(403).send(page('Lien invalide', 'Ce lien de désabonnement est invalide ou a expiré.', '#f87171'));
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ email_unsubscribed: true }),
    });

    return res.status(200).send(page(
      'Désabonnement confirmé',
      `Vous ne recevrez plus d'emails marketing de RepuGuard pour <strong>${email}</strong>.<br><br>
       Vous continuerez à recevoir les emails importants liés à votre compte (paiements, sécurité).`,
      '#34d399'
    ));
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return res.status(500).send(page('Erreur', 'Une erreur est survenue. Réessayez ou contactez le support.', '#f87171'));
  }
};
