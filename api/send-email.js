import { Resend } from 'resend';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

// Email translations (FR default, EN/ES/DE/PT/AR supported)
const EMAIL_STRINGS = {
  fr: {
    welcome_subject: 'Bienvenue sur RepuGuard, {name} !',
    welcome_title: 'Bienvenue, {name} ! 🎉',
    welcome_body: 'Votre compte RepuGuard est activé. Votre réputation en ligne est surveillée 24h/24.',
    welcome_plan_label: '✦ Votre plan',
    welcome_trial: "Période d'essai de 7 jours — aucune facturation aujourd'hui",
    welcome_monitored: 'Établissement surveillé',
    welcome_next_steps: 'Prochaines étapes',
    welcome_step1: 'Accédez à votre dashboard et vérifiez vos profils',
    welcome_step2: "Configurez vos préférences d'alerte",
    welcome_step3: "Attendez votre première alerte — nous surveillons déjà",
    welcome_cta: 'Accéder à mon dashboard →',
    welcome_support: "Des questions ? Répondez à cet email. Notre équipe répond sous 24h.",
    unsubscribe: 'Se désabonner',
    alert_subject: '🚨 Avis négatif détecté — {platform} — Action requise',
    alert_badge: '🚨 Alerte critique',
    alert_title: 'Avis négatif détecté',
    alert_platform: 'Plateforme',
    alert_author: 'Auteur',
    alert_rating: 'Note',
    alert_severity: 'Gravité',
    alert_review_label: 'Avis',
    alert_no_text: 'Aucun texte',
    alert_anonymous: 'Anonyme',
    alert_cta: '✦ Voir la réponse IA générée →',
    alert_footer1: 'RepuGuard a automatiquement généré une réponse professionnelle.',
    alert_footer2: 'Connectez-vous pour la valider et la publier en 1 clic.',
    monitoring: 'Surveillance de réputation en ligne',
    payment_failed_subject: '⚠️ Problème de paiement — Votre abonnement RepuGuard',
    payment_failed_badge: '⚠ Paiement échoué',
    payment_failed_body: "Nous n'avons pas pu débiter votre carte pour votre abonnement RepuGuard. Votre surveillance continue pour l'instant, mais veuillez mettre à jour vos informations de paiement rapidement.",
    payment_failed_cta: 'Mettre à jour le paiement →',
    cancelled_subject: 'Votre abonnement RepuGuard a été annulé',
    cancelled_body: "Votre abonnement RepuGuard a bien été annulé. Votre réputation ne sera plus surveillée. Vous pouvez vous réabonner à tout moment.",
    cancelled_cta: 'Se réabonner →',
    cancelled_thanks: "Merci d'avoir utilisé RepuGuard.",
    trial_subject: 'Votre essai gratuit RepuGuard se termine bientôt',
    trial_badge: '⏳ Essai gratuit',
    trial_ending: 'Se termine le {date}',
    trial_body: "Votre essai gratuit de 7 jours se termine bientôt. Pour continuer à surveiller la réputation de {business} sans interruption, votre abonnement sera activé automatiquement.",
    trial_cta: 'Gérer mon abonnement →',
    hello: 'Bonjour {name},',
    questions: 'Des questions ? Répondez à cet email.',
    j3_subject: 'Jour 3 de votre essai — votre réputation est surveillée 🔍',
    j3_title: 'RepuGuard surveille {business} 24h/24',
    j3_tip1_title: 'Répondez en 24h',
    j3_tip1: 'Les clients qui reçoivent une réponse reviennent 3× plus souvent. Votre réponse IA est déjà prête dans le dashboard.',
    j3_tip2_title: 'Score mis à jour chaque jour',
    j3_tip2: 'Votre score de réputation global évolue en temps réel — suivez votre progression semaine après semaine.',
    j3_tip3_title: 'Réponses IA en attente',
    j3_tip3: 'Chaque alerte génère automatiquement une réponse professionnelle — 1 clic pour la valider et la publier.',
    j3_upgrade: 'Votre essai se termine dans 4 jours. Activez votre plan maintenant pour continuer la surveillance sans interruption.',
    j3_cta: 'Voir mon dashboard →',
  },
  en: {
    welcome_subject: 'Welcome to RepuGuard, {name}!',
    welcome_title: 'Welcome, {name}! 🎉',
    welcome_body: 'Your RepuGuard account is activated. Your online reputation is now monitored 24/7.',
    welcome_plan_label: '✦ Your plan',
    welcome_trial: '7-day free trial — no charge today',
    welcome_monitored: 'Monitored business',
    welcome_next_steps: 'Next steps',
    welcome_step1: 'Access your dashboard and verify your profiles',
    welcome_step2: 'Configure your alert preferences',
    welcome_step3: "Wait for your first alert — we're already monitoring",
    welcome_cta: 'Go to my dashboard →',
    welcome_support: 'Questions? Reply to this email. Our team replies within 24h.',
    unsubscribe: 'Unsubscribe',
    alert_subject: '🚨 Negative review detected — {platform} — Action required',
    alert_badge: '🚨 Critical alert',
    alert_title: 'Negative review detected',
    alert_platform: 'Platform',
    alert_author: 'Author',
    alert_rating: 'Rating',
    alert_severity: 'Severity',
    alert_review_label: 'Review',
    alert_no_text: 'No text',
    alert_anonymous: 'Anonymous',
    alert_cta: '✦ View AI-generated response →',
    alert_footer1: 'RepuGuard automatically generated a professional response.',
    alert_footer2: 'Sign in to validate and publish it in 1 click.',
    monitoring: 'Online reputation monitoring',
    payment_failed_subject: '⚠️ Payment issue — Your RepuGuard subscription',
    payment_failed_badge: '⚠ Payment failed',
    payment_failed_body: "We couldn't charge your card for your RepuGuard subscription. Monitoring continues for now, but please update your payment information to avoid interruption.",
    payment_failed_cta: 'Update payment →',
    cancelled_subject: 'Your RepuGuard subscription has been cancelled',
    cancelled_body: 'Your RepuGuard subscription has been cancelled. Your reputation will no longer be monitored. You can resubscribe at any time.',
    cancelled_cta: 'Resubscribe →',
    cancelled_thanks: 'Thank you for using RepuGuard.',
    trial_subject: 'Your RepuGuard free trial is ending soon',
    trial_badge: '⏳ Free trial',
    trial_ending: 'Ends on {date}',
    trial_body: 'Your 7-day free trial is ending soon. To continue monitoring the reputation of {business} without interruption, your subscription will be activated automatically.',
    trial_cta: 'Manage my subscription →',
    hello: 'Hello {name},',
    questions: 'Questions? Reply to this email.',
    j3_subject: 'Day 3 of your trial — your reputation is being monitored 🔍',
    j3_title: 'RepuGuard is monitoring {business} 24/7',
    j3_tip1_title: 'Respond within 24h',
    j3_tip1: 'Customers who receive a reply come back 3× more often. Your AI response is already ready in the dashboard.',
    j3_tip2_title: 'Score updated daily',
    j3_tip2: 'Your global reputation score evolves in real time — track your progress week after week.',
    j3_tip3_title: 'AI responses waiting',
    j3_tip3: 'Each alert automatically generates a professional response — 1 click to validate and publish.',
    j3_upgrade: 'Your trial ends in 4 days. Activate your plan now to keep monitoring without interruption.',
    j3_cta: 'View my dashboard →',
  },
  es: {
    welcome_subject: '¡Bienvenido a RepuGuard, {name}!',
    welcome_title: '¡Bienvenido, {name}! 🎉',
    welcome_body: 'Tu cuenta de RepuGuard está activada. Tu reputación en línea está siendo monitoreada 24/7.',
    welcome_plan_label: '✦ Tu plan',
    welcome_trial: 'Prueba gratuita de 7 días — sin cargo hoy',
    welcome_monitored: 'Negocio vigilado',
    welcome_next_steps: 'Próximos pasos',
    welcome_step1: 'Accede a tu panel y verifica tus perfiles',
    welcome_step2: 'Configura tus preferencias de alerta',
    welcome_step3: 'Espera tu primera alerta — ya estamos monitoreando',
    welcome_cta: 'Ir a mi panel →',
    welcome_support: '¿Preguntas? Responde este email. Nuestro equipo responde en 24h.',
    unsubscribe: 'Cancelar suscripción',
    alert_subject: '🚨 Reseña negativa detectada — {platform} — Acción requerida',
    alert_badge: '🚨 Alerta crítica',
    alert_title: 'Reseña negativa detectada',
    alert_platform: 'Plataforma',
    alert_author: 'Autor',
    alert_rating: 'Puntuación',
    alert_severity: 'Gravedad',
    alert_review_label: 'Reseña',
    alert_no_text: 'Sin texto',
    alert_anonymous: 'Anónimo',
    alert_cta: '✦ Ver respuesta IA generada →',
    alert_footer1: 'RepuGuard generó automáticamente una respuesta profesional.',
    alert_footer2: 'Inicia sesión para validarla y publicarla en 1 clic.',
    monitoring: 'Monitoreo de reputación en línea',
    payment_failed_subject: '⚠️ Problema de pago — Tu suscripción RepuGuard',
    payment_failed_badge: '⚠ Pago fallido',
    payment_failed_body: 'No pudimos cobrar tu tarjeta. El monitoreo continúa por ahora, pero actualiza tu información de pago.',
    payment_failed_cta: 'Actualizar pago →',
    cancelled_subject: 'Tu suscripción RepuGuard ha sido cancelada',
    cancelled_body: 'Tu suscripción RepuGuard ha sido cancelada. Tu reputación ya no será monitorizada.',
    cancelled_cta: 'Reuscribirse →',
    cancelled_thanks: 'Gracias por usar RepuGuard.',
    trial_subject: 'Tu prueba gratuita de RepuGuard termina pronto',
    trial_badge: '⏳ Prueba gratuita',
    trial_ending: 'Termina el {date}',
    trial_body: 'Tu prueba gratuita de 7 días termina pronto. Para continuar monitoreando {business}, tu suscripción se activará automáticamente.',
    trial_cta: 'Gestionar mi suscripción →',
    hello: 'Hola {name},',
    questions: '¿Preguntas? Responde este email.',
  },
  de: {
    welcome_subject: 'Willkommen bei RepuGuard, {name}!',
    welcome_title: 'Willkommen, {name}! 🎉',
    welcome_body: 'Ihr RepuGuard-Konto ist aktiviert. Ihr Online-Ruf wird jetzt rund um die Uhr überwacht.',
    welcome_plan_label: '✦ Ihr Plan',
    welcome_trial: '7-tägige kostenlose Testversion — keine Belastung heute',
    welcome_monitored: 'Überwachtes Unternehmen',
    welcome_next_steps: 'Nächste Schritte',
    welcome_step1: 'Greifen Sie auf Ihr Dashboard zu und überprüfen Sie Ihre Profile',
    welcome_step2: 'Konfigurieren Sie Ihre Benachrichtigungseinstellungen',
    welcome_step3: 'Warten Sie auf Ihre erste Benachrichtigung — wir überwachen bereits',
    welcome_cta: 'Zu meinem Dashboard →',
    welcome_support: 'Fragen? Antworten Sie auf diese E-Mail. Unser Team antwortet innerhalb von 24h.',
    unsubscribe: 'Abbestellen',
    alert_subject: '🚨 Negative Bewertung erkannt — {platform} — Aktion erforderlich',
    alert_badge: '🚨 Kritischer Alarm',
    alert_title: 'Negative Bewertung erkannt',
    alert_platform: 'Plattform',
    alert_author: 'Autor',
    alert_rating: 'Bewertung',
    alert_severity: 'Schweregrad',
    alert_review_label: 'Bewertung',
    alert_no_text: 'Kein Text',
    alert_anonymous: 'Anonym',
    alert_cta: '✦ KI-generierte Antwort ansehen →',
    alert_footer1: 'RepuGuard hat automatisch eine professionelle Antwort generiert.',
    alert_footer2: 'Melden Sie sich an, um sie zu validieren und in 1 Klick zu veröffentlichen.',
    monitoring: 'Online-Reputationsüberwachung',
    payment_failed_subject: '⚠️ Zahlungsproblem — Ihr RepuGuard-Abonnement',
    payment_failed_badge: '⚠ Zahlung fehlgeschlagen',
    payment_failed_body: 'Wir konnten Ihre Karte nicht belasten. Die Überwachung läuft weiter, aber bitte aktualisieren Sie Ihre Zahlungsdaten.',
    payment_failed_cta: 'Zahlung aktualisieren →',
    cancelled_subject: 'Ihr RepuGuard-Abonnement wurde gekündigt',
    cancelled_body: 'Ihr RepuGuard-Abonnement wurde gekündigt. Ihr Ruf wird nicht mehr überwacht.',
    cancelled_cta: 'Erneut abonnieren →',
    cancelled_thanks: 'Danke, dass Sie RepuGuard genutzt haben.',
    trial_subject: 'Ihre kostenlose RepuGuard-Testversion endet bald',
    trial_badge: '⏳ Kostenlose Testversion',
    trial_ending: 'Endet am {date}',
    trial_body: 'Ihre 7-tägige Testversion endet bald. Um {business} weiterhin zu überwachen, wird Ihr Abonnement automatisch aktiviert.',
    trial_cta: 'Mein Abonnement verwalten →',
    hello: 'Hallo {name},',
    questions: 'Fragen? Antworten Sie auf diese E-Mail.',
  },
  pt: {
    welcome_subject: 'Bem-vindo ao RepuGuard, {name}!',
    welcome_title: 'Bem-vindo, {name}! 🎉',
    welcome_body: 'A sua conta RepuGuard está ativada. A sua reputação online está a ser monitorizada 24/7.',
    welcome_plan_label: '✦ O seu plano',
    welcome_trial: 'Período de teste gratuito de 7 dias — sem cobrança hoje',
    welcome_monitored: 'Negócio monitorizado',
    welcome_next_steps: 'Próximos passos',
    welcome_step1: 'Aceda ao seu dashboard e verifique os seus perfis',
    welcome_step2: 'Configure as suas preferências de alerta',
    welcome_step3: 'Aguarde o primeiro alerta — já estamos a monitorizar',
    welcome_cta: 'Ir para o meu dashboard →',
    welcome_support: 'Dúvidas? Responda a este email. A nossa equipa responde em 24h.',
    unsubscribe: 'Cancelar subscrição',
    alert_subject: '🚨 Avaliação negativa detetada — {platform} — Ação necessária',
    alert_badge: '🚨 Alerta crítico',
    alert_title: 'Avaliação negativa detetada',
    alert_platform: 'Plataforma',
    alert_author: 'Autor',
    alert_rating: 'Classificação',
    alert_severity: 'Gravidade',
    alert_review_label: 'Avaliação',
    alert_no_text: 'Sem texto',
    alert_anonymous: 'Anónimo',
    alert_cta: '✦ Ver resposta IA gerada →',
    alert_footer1: 'RepuGuard gerou automaticamente uma resposta profissional.',
    alert_footer2: 'Inicie sessão para validar e publicar em 1 clique.',
    monitoring: 'Monitorização de reputação online',
    payment_failed_subject: '⚠️ Problema de pagamento — A sua subscrição RepuGuard',
    payment_failed_badge: '⚠ Pagamento falhado',
    payment_failed_body: 'Não conseguimos cobrar o seu cartão. A monitorização continua, mas atualize as suas informações de pagamento.',
    payment_failed_cta: 'Atualizar pagamento →',
    cancelled_subject: 'A sua subscrição RepuGuard foi cancelada',
    cancelled_body: 'A sua subscrição RepuGuard foi cancelada. A sua reputação deixará de ser monitorizada.',
    cancelled_cta: 'Resubscrever →',
    cancelled_thanks: 'Obrigado por usar o RepuGuard.',
    trial_subject: 'O seu período de teste RepuGuard termina em breve',
    trial_badge: '⏳ Período de teste gratuito',
    trial_ending: 'Termina em {date}',
    trial_body: 'O seu período de teste gratuito de 7 dias termina em breve. Para continuar a monitorizar {business}, a sua subscrição será ativada automaticamente.',
    trial_cta: 'Gerir a minha subscrição →',
    hello: 'Olá {name},',
    questions: 'Dúvidas? Responda a este email.',
  },
  ar: {
    welcome_subject: 'مرحبًا بك في RepuGuard، {name}!',
    welcome_title: 'مرحبًا، {name}! 🎉',
    welcome_body: 'تم تفعيل حسابك في RepuGuard. يتم الآن مراقبة سمعتك على الإنترنت على مدار الساعة.',
    welcome_plan_label: '✦ خطتك',
    welcome_trial: 'تجربة مجانية لمدة 7 أيام — لا رسوم اليوم',
    welcome_monitored: 'النشاط التجاري المراقب',
    welcome_next_steps: 'الخطوات التالية',
    welcome_step1: 'قم بالوصول إلى لوحة التحكم والتحقق من ملفاتك',
    welcome_step2: 'قم بتكوين تفضيلات التنبيه',
    welcome_step3: 'انتظر تنبيهك الأول — نحن نراقب بالفعل',
    welcome_cta: 'الذهاب إلى لوحة التحكم →',
    welcome_support: 'أسئلة؟ أجب على هذا البريد الإلكتروني.',
    unsubscribe: 'إلغاء الاشتراك',
    alert_subject: '🚨 تم اكتشاف تقييم سلبي — {platform} — إجراء مطلوب',
    alert_badge: '🚨 تنبيه حرج',
    alert_title: 'تم اكتشاف تقييم سلبي',
    alert_platform: 'المنصة',
    alert_author: 'المؤلف',
    alert_rating: 'التقييم',
    alert_severity: 'الخطورة',
    alert_review_label: 'التقييم',
    alert_no_text: 'لا نص',
    alert_anonymous: 'مجهول',
    alert_cta: '✦ عرض الرد المُنشأ بالذكاء الاصطناعي →',
    alert_footer1: 'قام RepuGuard تلقائيًا بإنشاء رد احترافي.',
    alert_footer2: 'سجّل الدخول للتحقق منه ونشره بنقرة واحدة.',
    monitoring: 'مراقبة السمعة عبر الإنترنت',
    payment_failed_subject: '⚠️ مشكلة في الدفع — اشتراكك في RepuGuard',
    payment_failed_badge: '⚠ فشل الدفع',
    payment_failed_body: 'لم نتمكن من تحصيل رسوم بطاقتك. المراقبة مستمرة، لكن يرجى تحديث معلومات الدفع.',
    payment_failed_cta: 'تحديث الدفع →',
    cancelled_subject: 'تم إلغاء اشتراكك في RepuGuard',
    cancelled_body: 'تم إلغاء اشتراكك في RepuGuard. لن يتم مراقبة سمعتك بعد الآن.',
    cancelled_cta: 'إعادة الاشتراك →',
    cancelled_thanks: 'شكرًا لاستخدامك RepuGuard.',
    trial_subject: 'تجربتك المجانية في RepuGuard تنتهي قريبًا',
    trial_badge: '⏳ تجربة مجانية',
    trial_ending: 'تنتهي في {date}',
    trial_body: 'تجربتك المجانية لمدة 7 أيام تنتهي قريبًا. للاستمرار في مراقبة {business}، سيتم تفعيل اشتراكك تلقائيًا.',
    trial_cta: 'إدارة اشتراكي →',
    hello: 'مرحبًا {name}،',
    questions: 'أسئلة؟ أجب على هذا البريد الإلكتروني.',
  },
};

const FR_LANGS = ['fr'];
function eT(lang, key, vars = {}) {
  const s = EMAIL_STRINGS[FR_LANGS.includes(lang) ? 'fr' : (EMAIL_STRINGS[lang] ? lang : 'en')];
  let str = (s && s[key]) || (EMAIL_STRINGS['en'] && EMAIL_STRINGS['en'][key]) || key;
  Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v); });
  return str;
}

// Emails transactionnels toujours envoyés (paiement, sécurité)
const TRANSACTIONAL = ['welcome', 'alert', 'payment_failed', 'cancelled', 'trial_ending'];

function unsubLink(email) {
  const sig = crypto.createHmac('sha256', SUPABASE_KEY).update(email.toLowerCase()).digest('hex');
  return `https://repuguard.app/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, email, firstName, businessName, plan, review, lang: reqLang } = req.body;
    const lang = reqLang || 'fr';

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
      subject = eT(lang, 'welcome_subject', {name: firstName});
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
            <div style="margin-top:8px;font-size:13px;color:#475569;">${eT(lang,'monitoring')}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#f1f5f9;">${eT(lang,'welcome_title',{name:firstName})}</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">${eT(lang,'welcome_body')}</p>

            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:28px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#818cf8;margin-bottom:6px;">${eT(lang,'welcome_plan_label')}</div>
              <div style="font-size:18px;font-weight:800;color:#f1f5f9;">${plan || 'Pro'}</div>
              <div style="font-size:12px;color:#475569;margin-top:2px;">${eT(lang,'welcome_trial')}</div>
            </div>

            ${businessName ? `
            <div style="background:#13151f;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
              <div style="font-size:11px;color:#475569;margin-bottom:4px;">${eT(lang,'welcome_monitored')}</div>
              <div style="font-size:16px;font-weight:700;color:#f1f5f9;">${businessName}</div>
            </div>
            ` : ''}

            <div style="margin-bottom:28px;">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:16px;">${eT(lang,'welcome_next_steps')}</div>
              <div style="margin-bottom:12px;font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">1.</span> ${eT(lang,'welcome_step1')}</div>
              <div style="margin-bottom:12px;font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">2.</span> ${eT(lang,'welcome_step2')}</div>
              <div style="font-size:13px;color:#94a3b8;"><span style="color:#818cf8;font-weight:700;">3.</span> ${eT(lang,'welcome_step3')}</div>
            </div>

            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">${eT(lang,'welcome_cta')}</a>
            </div>

            <p style="margin:0;font-size:13px;color:#475569;text-align:center;">${eT(lang,'welcome_support')}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app · <a href="${unsubLink(email)}" style="color:#475569;">${eT(lang,'unsubscribe')}</a></p>
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

      subject = eT(lang, 'alert_subject', {platform: review.platform});
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
              <span style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);color:#f87171;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;text-transform:uppercase;letter-spacing:0.06em;">${eT(lang,'alert_badge')}</span>
            </div>
            <h1 style="margin:12px 0 0;font-size:20px;font-weight:800;color:#f1f5f9;">${eT(lang,'alert_title')}</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">

            <!-- INFO ALERTE -->
            <div style="background:#13151f;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">${eT(lang,'alert_platform')}</span>
                <span style="font-size:12px;font-weight:700;color:#f1f5f9;">${review.platform}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">${eT(lang,'alert_author')}</span>
                <span style="font-size:12px;font-weight:700;color:#f1f5f9;">${review.author || eT(lang,'alert_anonymous')}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:#475569;">${eT(lang,'alert_rating')}</span>
                <span style="font-size:14px;color:#f87171;font-weight:700;">${stars} ${review.rating}/5</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="font-size:12px;color:#475569;">${eT(lang,'alert_severity')}</span>
                <span style="font-size:12px;font-weight:700;color:#f87171;">${gravityScore}/10</span>
              </div>
            </div>

            <!-- TEXTE DE L'AVIS -->
            <div style="margin-bottom:20px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px;">Avis</div>
              <div style="background:#13151f;border-left:3px solid #f87171;border-radius:0 8px 8px 0;padding:14px 16px;font-size:13px;color:#94a3b8;line-height:1.6;font-style:italic;">
                "${review.text || eT(lang,'alert_no_text')}"
              </div>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:24px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">${eT(lang,'alert_cta')}</a>
            </div>

            <p style="margin:0;font-size:12px;color:#475569;text-align:center;line-height:1.6;">
              ${eT(lang,'alert_footer1')}<br>
              ${eT(lang,'alert_footer2')}
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
            <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app · <a href="${unsubLink(email)}" style="color:#475569;">${eT(lang,'unsubscribe')}</a></p>
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
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">Votre essai gratuit de 7 jours se termine bientôt. Pour continuer à surveiller la réputation de <strong style="color:#f1f5f9;">${businessName}</strong> sans interruption, votre abonnement sera activé automatiquement.</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard#abonnement" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">Gérer mon abonnement →</a>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    }

    // ══════════════════════════════════
    // EMAIL ONBOARDING J3
    // ══════════════════════════════════
    if (type === 'onboarding_j3') {
      subject = eT(lang, 'j3_subject');
      html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;letter-spacing:-0.5px;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:40px;">
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9;">${eT(lang,'j3_title',{business:businessName||'votre établissement'})}</h1>
        <p style="margin:0 0 32px;font-size:14px;color:#475569;">${eT(lang,'hello',{name:firstName})}</p>

        <div style="margin-bottom:16px;background:#13151f;border-radius:10px;padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">💬 ${eT(lang,'j3_tip1_title')}</div>
          <div style="font-size:13px;color:#94a3b8;line-height:1.5;">${eT(lang,'j3_tip1')}</div>
        </div>
        <div style="margin-bottom:16px;background:#13151f;border-radius:10px;padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">📊 ${eT(lang,'j3_tip2_title')}</div>
          <div style="font-size:13px;color:#94a3b8;line-height:1.5;">${eT(lang,'j3_tip2')}</div>
        </div>
        <div style="margin-bottom:32px;background:#13151f;border-radius:10px;padding:18px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:6px;">✅ ${eT(lang,'j3_tip3_title')}</div>
          <div style="font-size:13px;color:#94a3b8;line-height:1.5;">${eT(lang,'j3_tip3')}</div>
        </div>

        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:28px;">
          <div style="font-size:13px;color:#a5b4fc;line-height:1.5;">⏳ ${eT(lang,'j3_upgrade')}</div>
        </div>

        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">${eT(lang,'j3_cta')}</a>
        </div>
        <p style="margin:0;font-size:12px;color:#475569;text-align:center;">${eT(lang,'questions')}</p>
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
        <p style="margin:0;font-size:11px;color:#334155;">RepuGuard · repuguard.app · <a href="${unsubLink(email)}" style="color:#475569;">${eT(lang,'unsubscribe')}</a></p>
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
