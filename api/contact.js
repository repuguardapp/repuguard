function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, subject, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY manquant' });
  }
  if (!ADMIN_EMAIL) {
    return res.status(500).json({ error: 'ADMIN_EMAIL manquant' });
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
          <div style="margin-top:6px;font-size:12px;color:#475569;">Nouveau message de contact</div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="font-size:13px;color:#475569;margin:0 0 4px;">De</p>
          <p style="font-size:16px;color:#f1f5f9;font-weight:700;margin:0 0 16px;">${safeName} &lt;<a href="mailto:${safeEmail}" style="color:#818cf8;">${safeEmail}</a>&gt;</p>
          <p style="font-size:13px;color:#475569;margin:0 0 4px;">Sujet</p>
          <p style="font-size:15px;color:#f1f5f9;margin:0 0 24px;">${safeSubject || '—'}</p>
          <p style="font-size:13px;color:#475569;margin:0 0 8px;">Message</p>
          <div style="background:#13151f;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:16px;font-size:14px;color:#94a3b8;line-height:1.7;white-space:pre-wrap;">${safeMessage}</div>
          <div style="margin-top:24px;text-align:center;">
            <a href="mailto:${safeEmail}" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:13px;">R&eacute;pondre &agrave; ${safeName} &rarr;</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RepuGuard Contact <bonjour@repuguard.app>',
        to: [ADMIN_EMAIL],
        reply_to: email,
        subject: `[Contact RepuGuard] ${subject || 'Nouveau message'}`,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: data.message || JSON.stringify(data) });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
