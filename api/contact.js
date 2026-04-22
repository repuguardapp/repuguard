import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'bonjour@repuguard.app';

export default async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://repuguard.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return res.status(204).set(headers).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, subject, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  try {
    await resend.emails.send({
      from: 'RepuGuard Contact <bonjour@repuguard.app>',
      to: ADMIN_EMAIL,
      replyTo: email,
      subject: `[Contact RepuGuard] ${subject || 'Nouveau message'}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
          <div style="margin-top:6px;font-size:12px;color:#475569;">Nouveau message de contact</div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:12px;color:#475569;display:block;margin-bottom:3px;">Nom</span>
                <span style="font-size:15px;color:#f1f5f9;font-weight:600;">${name}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:12px;color:#475569;display:block;margin-bottom:3px;">Email</span>
                <a href="mailto:${email}" style="font-size:15px;color:#818cf8;text-decoration:none;">${email}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:12px;color:#475569;display:block;margin-bottom:3px;">Sujet</span>
                <span style="font-size:15px;color:#f1f5f9;">${subject || '—'}</span>
              </td>
            </tr>
          </table>
          <div>
            <div style="font-size:12px;color:#475569;margin-bottom:8px;">Message</div>
            <div style="background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:16px;font-size:14px;color:#94a3b8;line-height:1.7;white-space:pre-wrap;">${message}</div>
          </div>
          <div style="margin-top:24px;text-align:center;">
            <a href="mailto:${email}" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:13px;">Répondre à ${name} →</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact email error:', err);
    return res.status(500).json({ error: 'Erreur envoi' });
  }
}
