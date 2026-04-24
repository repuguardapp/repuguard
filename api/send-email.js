import { Resend } from 'resend';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

// Email translations (FR default, EN/ES/DE/PT/AR/IT/NL/RU supported)
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
    j1_subject: 'RepuGuard surveille {business} — Bienvenue à bord !',
    j1_title: 'Votre réputation est entre de bonnes mains',
    j1_body1: 'Depuis votre inscription, RepuGuard surveille {business} en temps réel sur Google, Trustpilot et TripAdvisor.',
    j1_body2: 'Dès qu\'un avis négatif est détecté, vous recevrez une alerte immédiate et une réponse professionnelle sera générée automatiquement.',
    j1_cta: 'Voir mon dashboard →',
    j2_subject: '{business} n\'est pas encore configuré — 3 minutes suffisent',
    j2_title: 'Activez la surveillance de {business}',
    j2_step1: 'Connectez-vous à votre dashboard',
    j2_step2: 'Vérifiez que votre établissement est bien trouvé',
    j2_step3: 'Activez les alertes — nous faisons le reste',
    j2_urgency: 'Il vous reste 5 jours d\'essai gratuit. Ne le laissez pas expirer sans avoir testé.',
    j2_cta: 'Configurer maintenant →',
    report_subject: '📊 Votre rapport hebdomadaire RepuGuard — {period}',
    report_period_label: 'Rapport hebdomadaire · {period}',
    report_greeting: 'Bonjour {name} 👋',
    report_intro: 'Voici le résumé de réputation de {business} pour cette semaine.',
    report_score_label: '◈ Score global',
    report_new_reviews: 'Nouveaux avis',
    report_positive: 'Avis positifs',
    report_negative: 'Avis négatifs',
    report_negative_alert: '⚠ {count} avis négatif(s) détecté(s) cette semaine',
    report_negative_alert_sub: 'Des réponses IA ont été générées — connectez-vous pour les valider.',
    report_all_positive: '✓ Aucun avis négatif cette semaine',
    report_all_positive_sub: 'Excellente semaine pour votre réputation !',
    report_cta: 'Voir le dashboard complet →',
    report_footer: 'Ce rapport est envoyé automatiquement chaque lundi à 08h00.',
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
    j1_subject: 'RepuGuard is monitoring {business} — Welcome aboard!',
    j1_title: 'Your reputation is in good hands',
    j1_body1: 'Since you signed up, RepuGuard has been monitoring {business} in real time on Google, Trustpilot and TripAdvisor.',
    j1_body2: 'As soon as a negative review is detected, you\'ll receive an instant alert and a professional AI response will be generated for you.',
    j1_cta: 'View my dashboard →',
    j2_subject: '{business} isn\'t set up yet — takes only 3 minutes',
    j2_title: 'Activate monitoring for {business}',
    j2_step1: 'Sign in to your dashboard',
    j2_step2: 'Make sure your business is found correctly',
    j2_step3: 'Enable alerts — we\'ll handle the rest',
    j2_urgency: 'You have 5 days left in your free trial. Don\'t let it expire without trying it out.',
    j2_cta: 'Set up now →',
    report_subject: '📊 Your weekly RepuGuard report — {period}',
    report_period_label: 'Weekly report · {period}',
    report_greeting: 'Hello {name} 👋',
    report_intro: 'Here is your reputation summary for {business} this week.',
    report_score_label: '◈ Global score',
    report_new_reviews: 'New reviews',
    report_positive: 'Positive reviews',
    report_negative: 'Negative reviews',
    report_negative_alert: '⚠ {count} negative review(s) detected this week',
    report_negative_alert_sub: 'AI responses have been generated — sign in to validate them.',
    report_all_positive: '✓ No negative reviews this week',
    report_all_positive_sub: 'Excellent week for your reputation!',
    report_cta: 'View full dashboard →',
    report_footer: 'This report is sent automatically every Monday at 8:00 AM.',
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
    j3_subject: 'Día 3 de tu prueba — tu reputación está siendo monitoreada 🔍',
    j3_title: 'RepuGuard monitorea {business} 24/7',
    j3_tip1_title: 'Responde en 24h',
    j3_tip1: 'Los clientes que reciben una respuesta vuelven 3× más a menudo. Tu respuesta IA ya está lista en el panel.',
    j3_tip2_title: 'Puntuación actualizada diariamente',
    j3_tip2: 'Tu puntuación global de reputación evoluciona en tiempo real — sigue tu progreso semana tras semana.',
    j3_tip3_title: 'Respuestas IA en espera',
    j3_tip3: 'Cada alerta genera automáticamente una respuesta profesional — 1 clic para validarla y publicarla.',
    j3_upgrade: 'Tu prueba termina en 4 días. Activa tu plan ahora para continuar el monitoreo sin interrupciones.',
    j3_cta: 'Ver mi panel →',
    j1_subject: 'RepuGuard monitorea {business} — ¡Bienvenido a bordo!',
    j1_title: 'Tu reputación está en buenas manos',
    j1_body1: 'Desde que te registraste, RepuGuard monitorea {business} en tiempo real en Google, Trustpilot y TripAdvisor.',
    j1_body2: 'En cuanto se detecte una reseña negativa, recibirás una alerta inmediata y se generará automáticamente una respuesta profesional.',
    j1_cta: 'Ver mi panel →',
    j2_subject: '{business} aún no está configurado — solo toma 3 minutos',
    j2_title: 'Activa el monitoreo de {business}',
    j2_step1: 'Inicia sesión en tu panel',
    j2_step2: 'Verifica que tu negocio aparezca correctamente',
    j2_step3: 'Activa las alertas — nosotros hacemos el resto',
    j2_urgency: 'Te quedan 5 días de prueba gratuita. No dejes que expire sin probarlo.',
    j2_cta: 'Configurar ahora →',
    report_subject: '📊 Tu informe semanal de RepuGuard — {period}',
    report_period_label: 'Informe semanal · {period}',
    report_greeting: 'Hola {name} 👋',
    report_intro: 'Aquí está el resumen de reputación de {business} para esta semana.',
    report_score_label: '◈ Puntuación global',
    report_new_reviews: 'Nuevas reseñas',
    report_positive: 'Reseñas positivas',
    report_negative: 'Reseñas negativas',
    report_negative_alert: '⚠ {count} reseña(s) negativa(s) detectada(s) esta semana',
    report_negative_alert_sub: 'Se han generado respuestas de IA — inicia sesión para validarlas.',
    report_all_positive: '✓ Sin reseñas negativas esta semana',
    report_all_positive_sub: '¡Excelente semana para tu reputación!',
    report_cta: 'Ver panel completo →',
    report_footer: 'Este informe se envía automáticamente cada lunes a las 08:00.',
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
    j3_subject: 'Tag 3 Ihrer Testphase — Ihre Reputation wird überwacht 🔍',
    j3_title: 'RepuGuard überwacht {business} rund um die Uhr',
    j3_tip1_title: 'Antworten Sie innerhalb von 24h',
    j3_tip1: 'Kunden, die eine Antwort erhalten, kommen 3× häufiger zurück. Ihre KI-Antwort steht bereits im Dashboard bereit.',
    j3_tip2_title: 'Täglich aktualisierter Score',
    j3_tip2: 'Ihr globaler Reputations-Score entwickelt sich in Echtzeit — verfolgen Sie Ihren Fortschritt Woche für Woche.',
    j3_tip3_title: 'KI-Antworten warten',
    j3_tip3: 'Jede Benachrichtigung generiert automatisch eine professionelle Antwort — 1 Klick zum Validieren und Veröffentlichen.',
    j3_upgrade: 'Ihre Testphase endet in 4 Tagen. Aktivieren Sie jetzt Ihren Plan, um die Überwachung ohne Unterbrechung fortzusetzen.',
    j3_cta: 'Zu meinem Dashboard →',
    j1_subject: 'RepuGuard überwacht {business} — Willkommen an Bord!',
    j1_title: 'Ihre Reputation ist in guten Händen',
    j1_body1: 'Seit Ihrer Anmeldung überwacht RepuGuard {business} in Echtzeit auf Google, Trustpilot und TripAdvisor.',
    j1_body2: 'Sobald eine negative Bewertung erkannt wird, erhalten Sie sofort eine Benachrichtigung und eine professionelle Antwort wird automatisch generiert.',
    j1_cta: 'Zu meinem Dashboard →',
    j2_subject: '{business} ist noch nicht eingerichtet — dauert nur 3 Minuten',
    j2_title: 'Aktivieren Sie die Überwachung für {business}',
    j2_step1: 'Melden Sie sich in Ihrem Dashboard an',
    j2_step2: 'Stellen Sie sicher, dass Ihr Unternehmen korrekt gefunden wird',
    j2_step3: 'Aktivieren Sie Benachrichtigungen — wir erledigen den Rest',
    j2_urgency: 'Sie haben noch 5 Tage kostenlose Testphase. Lassen Sie sie nicht ablaufen, ohne es ausprobiert zu haben.',
    j2_cta: 'Jetzt einrichten →',
    report_subject: '📊 Ihr wöchentlicher RepuGuard-Bericht — {period}',
    report_period_label: 'Wöchentlicher Bericht · {period}',
    report_greeting: 'Hallo {name} 👋',
    report_intro: 'Hier ist Ihre Reputationszusammenfassung für {business} dieser Woche.',
    report_score_label: '◈ Globale Bewertung',
    report_new_reviews: 'Neue Bewertungen',
    report_positive: 'Positive Bewertungen',
    report_negative: 'Negative Bewertungen',
    report_negative_alert: '⚠ {count} negative Bewertung(en) diese Woche erkannt',
    report_negative_alert_sub: 'KI-Antworten wurden generiert — melden Sie sich an, um sie zu validieren.',
    report_all_positive: '✓ Keine negativen Bewertungen diese Woche',
    report_all_positive_sub: 'Ausgezeichnete Woche für Ihre Reputation!',
    report_cta: 'Vollständiges Dashboard anzeigen →',
    report_footer: 'Dieser Bericht wird automatisch jeden Montag um 08:00 Uhr gesendet.',
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
    j3_subject: 'Dia 3 do seu período de teste — a sua reputação está a ser monitorizada 🔍',
    j3_title: 'RepuGuard monitoriza {business} 24/7',
    j3_tip1_title: 'Responda em 24h',
    j3_tip1: 'Os clientes que recebem uma resposta voltam 3× mais vezes. A sua resposta IA já está pronta no dashboard.',
    j3_tip2_title: 'Score atualizado diariamente',
    j3_tip2: 'O seu score global de reputação evolui em tempo real — acompanhe o seu progresso semana após semana.',
    j3_tip3_title: 'Respostas IA à espera',
    j3_tip3: 'Cada alerta gera automaticamente uma resposta profissional — 1 clique para validar e publicar.',
    j3_upgrade: 'O seu período de teste termina em 4 dias. Ative o seu plano agora para continuar a monitorização sem interrupções.',
    j3_cta: 'Ver o meu dashboard →',
    j1_subject: 'RepuGuard está a monitorizar {business} — Bem-vindo a bordo!',
    j1_title: 'A sua reputação está em boas mãos',
    j1_body1: 'Desde que se registou, o RepuGuard monitoriza {business} em tempo real no Google, Trustpilot e TripAdvisor.',
    j1_body2: 'Assim que uma avaliação negativa for detetada, receberá um alerta imediato e uma resposta profissional será gerada automaticamente.',
    j1_cta: 'Ver o meu dashboard →',
    j2_subject: '{business} ainda não está configurado — demora apenas 3 minutos',
    j2_title: 'Ative a monitorização de {business}',
    j2_step1: 'Inicie sessão no seu dashboard',
    j2_step2: 'Verifique que o seu estabelecimento é encontrado corretamente',
    j2_step3: 'Ative os alertas — tratamos do resto',
    j2_urgency: 'Restam-lhe 5 dias de período de teste gratuito. Não o deixe expirar sem experimentar.',
    j2_cta: 'Configurar agora →',
    report_subject: '📊 O seu relatório semanal RepuGuard — {period}',
    report_period_label: 'Relatório semanal · {period}',
    report_greeting: 'Olá {name} 👋',
    report_intro: 'Aqui está o resumo de reputação de {business} para esta semana.',
    report_score_label: '◈ Pontuação global',
    report_new_reviews: 'Novas avaliações',
    report_positive: 'Avaliações positivas',
    report_negative: 'Avaliações negativas',
    report_negative_alert: '⚠ {count} avaliação(ões) negativa(s) detetada(s) esta semana',
    report_negative_alert_sub: 'Respostas IA foram geradas — inicie sessão para as validar.',
    report_all_positive: '✓ Nenhuma avaliação negativa esta semana',
    report_all_positive_sub: 'Excelente semana para a sua reputação!',
    report_cta: 'Ver dashboard completo →',
    report_footer: 'Este relatório é enviado automaticamente todas as segundas-feiras às 08h00.',
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
    j3_subject: 'اليوم الثالث من تجربتك — سمعتك تُراقَب 🔍',
    j3_title: 'RepuGuard يراقب {business} على مدار الساعة',
    j3_tip1_title: 'أجب في غضون 24 ساعة',
    j3_tip1: 'العملاء الذين يتلقون ردًا يعودون 3 مرات أكثر. ردك بالذكاء الاصطناعي جاهز بالفعل في لوحة التحكم.',
    j3_tip2_title: 'نقاط محدّثة يوميًا',
    j3_tip2: 'تتطور نقاط سمعتك العالمية في الوقت الفعلي — تابع تقدمك أسبوعًا بعد أسبوع.',
    j3_tip3_title: 'ردود الذكاء الاصطناعي في الانتظار',
    j3_tip3: 'كل تنبيه يُنشئ تلقائيًا ردًا احترافيًا — نقرة واحدة للتحقق منه ونشره.',
    j3_upgrade: 'تجربتك تنتهي بعد 4 أيام. فعّل خطتك الآن لمواصلة المراقبة دون انقطاع.',
    j3_cta: 'الذهاب إلى لوحة التحكم →',
    j1_subject: 'RepuGuard يراقب {business} — مرحبًا بك!',
    j1_title: 'سمعتك في أيدٍ أمينة',
    j1_body1: 'منذ تسجيلك، يراقب RepuGuard {business} في الوقت الفعلي على Google وTrustpilot وTripAdvisor.',
    j1_body2: 'بمجرد اكتشاف تقييم سلبي، ستتلقى تنبيهًا فوريًا وسيتم إنشاء رد احترافي تلقائيًا.',
    j1_cta: 'الذهاب إلى لوحة التحكم →',
    j2_subject: '{business} لم يتم إعداده بعد — يستغرق 3 دقائق فقط',
    j2_title: 'فعّل مراقبة {business}',
    j2_step1: 'سجّل الدخول إلى لوحة التحكم',
    j2_step2: 'تحقق من أن نشاطك التجاري يظهر بشكل صحيح',
    j2_step3: 'فعّل التنبيهات — نحن نتولى الباقي',
    j2_urgency: 'لديك 5 أيام متبقية من التجربة المجانية. لا تدعها تنتهي دون تجربتها.',
    j2_cta: 'إعداد الآن →',
    report_subject: '📊 تقريرك الأسبوعي لـ RepuGuard — {period}',
    report_period_label: 'التقرير الأسبوعي · {period}',
    report_greeting: 'مرحبًا {name} 👋',
    report_intro: 'إليك ملخص سمعة {business} لهذا الأسبوع.',
    report_score_label: '◈ النقاط الإجمالية',
    report_new_reviews: 'آراء جديدة',
    report_positive: 'آراء إيجابية',
    report_negative: 'آراء سلبية',
    report_negative_alert: '⚠ تم اكتشاف {count} رأي سلبي هذا الأسبوع',
    report_negative_alert_sub: 'تم إنشاء ردود الذكاء الاصطناعي — سجّل دخولك للتحقق منها.',
    report_all_positive: '✓ لا آراء سلبية هذا الأسبوع',
    report_all_positive_sub: 'أسبوع رائع لسمعتك!',
    report_cta: '← عرض لوحة التحكم الكاملة',
    report_footer: 'يُرسل هذا التقرير تلقائيًا كل يوم اثنين الساعة 08:00.',
  },
  it: {
    welcome_subject: 'Benvenuto su RepuGuard, {name}!',
    welcome_title: 'Benvenuto, {name}! 🎉',
    welcome_body: 'Il tuo account RepuGuard è attivato. La tua reputazione online è ora monitorata 24/7.',
    welcome_plan_label: '✦ Il tuo piano',
    welcome_trial: 'Periodo di prova gratuito di 7 giorni — nessun addebito oggi',
    welcome_monitored: 'Attività monitorata',
    welcome_next_steps: 'Prossimi passi',
    welcome_step1: 'Accedi alla dashboard e verifica i tuoi profili',
    welcome_step2: 'Configura le preferenze di notifica',
    welcome_step3: 'Attendi il primo avviso — stiamo già monitorando',
    welcome_cta: 'Vai alla mia dashboard →',
    welcome_support: 'Domande? Rispondi a questa email. Il nostro team risponde entro 24h.',
    unsubscribe: 'Annulla iscrizione',
    alert_subject: '🚨 Recensione negativa rilevata — {platform} — Azione richiesta',
    alert_badge: '🚨 Avviso critico',
    alert_title: 'Recensione negativa rilevata',
    alert_platform: 'Piattaforma',
    alert_author: 'Autore',
    alert_rating: 'Valutazione',
    alert_severity: 'Gravità',
    alert_review_label: 'Recensione',
    alert_no_text: 'Nessun testo',
    alert_anonymous: 'Anonimo',
    alert_cta: '✦ Visualizza la risposta generata dall\'IA →',
    alert_footer1: 'RepuGuard ha generato automaticamente una risposta professionale.',
    alert_footer2: 'Accedi per convalidarla e pubblicarla in 1 clic.',
    monitoring: 'Monitoraggio della reputazione online',
    payment_failed_subject: '⚠️ Problema di pagamento — Il tuo abbonamento RepuGuard',
    payment_failed_badge: '⚠ Pagamento fallito',
    payment_failed_body: 'Non siamo riusciti ad addebitare la tua carta. Il monitoraggio continua, ma aggiorna le informazioni di pagamento.',
    payment_failed_cta: 'Aggiorna pagamento →',
    cancelled_subject: 'Il tuo abbonamento RepuGuard è stato cancellato',
    cancelled_body: 'Il tuo abbonamento RepuGuard è stato cancellato. La tua reputazione non sarà più monitorata.',
    cancelled_cta: 'Riabbonarsi →',
    cancelled_thanks: 'Grazie per aver usato RepuGuard.',
    trial_subject: 'Il tuo periodo di prova RepuGuard sta per scadere',
    trial_badge: '⏳ Periodo di prova',
    trial_ending: 'Scade il {date}',
    trial_body: 'Il tuo periodo di prova gratuito di 7 giorni sta per scadere. Per continuare a monitorare {business}, il tuo abbonamento verrà attivato automaticamente.',
    trial_cta: 'Gestisci il mio abbonamento →',
    hello: 'Ciao {name},',
    questions: 'Domande? Rispondi a questa email.',
    j3_subject: 'Giorno 3 del tuo periodo di prova — la tua reputazione è monitorata 🔍',
    j3_title: 'RepuGuard monitora {business} 24/7',
    j3_tip1_title: 'Rispondi entro 24h',
    j3_tip1: 'I clienti che ricevono una risposta tornano 3× più spesso. La tua risposta IA è già pronta nella dashboard.',
    j3_tip2_title: 'Punteggio aggiornato ogni giorno',
    j3_tip2: 'Il tuo punteggio di reputazione globale evolve in tempo reale — segui i tuoi progressi settimana dopo settimana.',
    j3_tip3_title: 'Risposte IA in attesa',
    j3_tip3: 'Ogni avviso genera automaticamente una risposta professionale — 1 clic per convalidarla e pubblicarla.',
    j3_upgrade: 'Il tuo periodo di prova scade tra 4 giorni. Attiva il tuo piano ora per continuare il monitoraggio senza interruzioni.',
    j3_cta: 'Vai alla mia dashboard →',
    j1_subject: 'RepuGuard monitora {business} — Benvenuto a bordo!',
    j1_title: 'La tua reputazione è in buone mani',
    j1_body1: 'Dal momento della tua iscrizione, RepuGuard monitora {business} in tempo reale su Google, Trustpilot e TripAdvisor.',
    j1_body2: 'Non appena viene rilevata una recensione negativa, riceverai un avviso immediato e verrà generata automaticamente una risposta professionale.',
    j1_cta: 'Vai alla mia dashboard →',
    j2_subject: '{business} non è ancora configurato — bastano 3 minuti',
    j2_title: 'Attiva il monitoraggio di {business}',
    j2_step1: 'Accedi alla tua dashboard',
    j2_step2: 'Verifica che la tua attività sia trovata correttamente',
    j2_step3: 'Attiva gli avvisi — pensiamo a tutto noi',
    j2_urgency: 'Hai ancora 5 giorni di prova gratuita. Non lasciarla scadere senza averla provata.',
    j2_cta: 'Configura adesso →',
    report_subject: '📊 Il tuo rapporto settimanale RepuGuard — {period}',
    report_period_label: 'Rapporto settimanale · {period}',
    report_greeting: 'Ciao {name} 👋',
    report_intro: 'Ecco il riepilogo della reputazione di {business} per questa settimana.',
    report_score_label: '◈ Punteggio globale',
    report_new_reviews: 'Nuove recensioni',
    report_positive: 'Recensioni positive',
    report_negative: 'Recensioni negative',
    report_negative_alert: '⚠ {count} recensione/i negativa/e rilevata/e questa settimana',
    report_negative_alert_sub: 'Risposte IA sono state generate — accedi per convalidarle.',
    report_all_positive: '✓ Nessuna recensione negativa questa settimana',
    report_all_positive_sub: 'Ottima settimana per la tua reputazione!',
    report_cta: 'Visualizza dashboard completa →',
    report_footer: 'Questo rapporto viene inviato automaticamente ogni lunedì alle 08:00.',
  },
  nl: {
    welcome_subject: 'Welkom bij RepuGuard, {name}!',
    welcome_title: 'Welkom, {name}! 🎉',
    welcome_body: 'Uw RepuGuard-account is geactiveerd. Uw online reputatie wordt nu 24/7 gemonitord.',
    welcome_plan_label: '✦ Uw plan',
    welcome_trial: '7 dagen gratis proefperiode — vandaag geen kosten',
    welcome_monitored: 'Gemonitord bedrijf',
    welcome_next_steps: 'Volgende stappen',
    welcome_step1: 'Ga naar uw dashboard en verifieer uw profielen',
    welcome_step2: 'Configureer uw meldingsvoorkeuren',
    welcome_step3: 'Wacht op uw eerste melding — we monitoren al',
    welcome_cta: 'Naar mijn dashboard →',
    welcome_support: 'Vragen? Beantwoord deze e-mail. Ons team reageert binnen 24u.',
    unsubscribe: 'Uitschrijven',
    alert_subject: '🚨 Negatieve recensie gedetecteerd — {platform} — Actie vereist',
    alert_badge: '🚨 Kritieke melding',
    alert_title: 'Negatieve recensie gedetecteerd',
    alert_platform: 'Platform',
    alert_author: 'Auteur',
    alert_rating: 'Beoordeling',
    alert_severity: 'Ernst',
    alert_review_label: 'Recensie',
    alert_no_text: 'Geen tekst',
    alert_anonymous: 'Anoniem',
    alert_cta: '✦ Bekijk het AI-gegenereerde antwoord →',
    alert_footer1: 'RepuGuard heeft automatisch een professioneel antwoord gegenereerd.',
    alert_footer2: 'Log in om het te valideren en te publiceren met 1 klik.',
    monitoring: 'Online reputatiebeheer',
    payment_failed_subject: '⚠️ Betalingsprobleem — Uw RepuGuard-abonnement',
    payment_failed_badge: '⚠ Betaling mislukt',
    payment_failed_body: 'We konden uw kaart niet belasten. Monitoring gaat door, maar werk uw betalingsgegevens bij.',
    payment_failed_cta: 'Betaling bijwerken →',
    cancelled_subject: 'Uw RepuGuard-abonnement is opgezegd',
    cancelled_body: 'Uw RepuGuard-abonnement is opgezegd. Uw reputatie wordt niet meer gemonitord.',
    cancelled_cta: 'Opnieuw abonneren →',
    cancelled_thanks: 'Bedankt voor het gebruik van RepuGuard.',
    trial_subject: 'Uw gratis proefperiode van RepuGuard loopt binnenkort af',
    trial_badge: '⏳ Gratis proefperiode',
    trial_ending: 'Verloopt op {date}',
    trial_body: 'Uw gratis proefperiode van 7 dagen loopt binnenkort af. Om {business} zonder onderbreking te blijven monitoren, wordt uw abonnement automatisch geactiveerd.',
    trial_cta: 'Mijn abonnement beheren →',
    hello: 'Hallo {name},',
    questions: 'Vragen? Beantwoord deze e-mail.',
    j3_subject: 'Dag 3 van uw proefperiode — uw reputatie wordt gemonitord 🔍',
    j3_title: 'RepuGuard monitort {business} 24/7',
    j3_tip1_title: 'Reageer binnen 24u',
    j3_tip1: 'Klanten die een antwoord ontvangen, komen 3× vaker terug. Uw AI-antwoord staat al klaar in het dashboard.',
    j3_tip2_title: 'Score dagelijks bijgewerkt',
    j3_tip2: 'Uw globale reputatiescore evolueert in real-time — volg uw vooruitgang week na week.',
    j3_tip3_title: 'AI-antwoorden in behandeling',
    j3_tip3: 'Elke melding genereert automatisch een professioneel antwoord — 1 klik om het te valideren en te publiceren.',
    j3_upgrade: 'Uw proefperiode eindigt over 4 dagen. Activeer uw plan nu om monitoring zonder onderbreking voort te zetten.',
    j3_cta: 'Naar mijn dashboard →',
    j1_subject: 'RepuGuard monitort {business} — Welkom aan boord!',
    j1_title: 'Uw reputatie is in goede handen',
    j1_body1: 'Sinds uw aanmelding monitort RepuGuard {business} in realtime op Google, Trustpilot en TripAdvisor.',
    j1_body2: 'Zodra een negatieve recensie wordt gedetecteerd, ontvangt u een direct bericht en wordt er automatisch een professioneel antwoord gegenereerd.',
    j1_cta: 'Naar mijn dashboard →',
    j2_subject: '{business} is nog niet ingesteld — duurt maar 3 minuten',
    j2_title: 'Activeer monitoring voor {business}',
    j2_step1: 'Log in op uw dashboard',
    j2_step2: 'Controleer of uw bedrijf correct wordt gevonden',
    j2_step3: 'Schakel meldingen in — wij doen de rest',
    j2_urgency: 'U heeft nog 5 dagen gratis proefperiode. Laat het niet verlopen zonder het te proberen.',
    j2_cta: 'Nu instellen →',
    report_subject: '📊 Uw wekelijks RepuGuard-rapport — {period}',
    report_period_label: 'Wekelijks rapport · {period}',
    report_greeting: 'Hallo {name} 👋',
    report_intro: 'Hier is uw reputatiesamenvatting voor {business} deze week.',
    report_score_label: '◈ Globale score',
    report_new_reviews: 'Nieuwe recensies',
    report_positive: 'Positieve recensies',
    report_negative: 'Negatieve recensies',
    report_negative_alert: '⚠ {count} negatieve recensie(s) gedetecteerd deze week',
    report_negative_alert_sub: 'AI-antwoorden zijn gegenereerd — log in om ze te valideren.',
    report_all_positive: '✓ Geen negatieve recensies deze week',
    report_all_positive_sub: 'Uitstekende week voor uw reputatie!',
    report_cta: 'Volledig dashboard bekijken →',
    report_footer: 'Dit rapport wordt automatisch elke maandag om 08:00 verstuurd.',
  },
  ru: {
    welcome_subject: 'Добро пожаловать в RepuGuard, {name}!',
    welcome_title: 'Добро пожаловать, {name}! 🎉',
    welcome_body: 'Ваш аккаунт RepuGuard активирован. Ваша онлайн-репутация теперь отслеживается 24/7.',
    welcome_plan_label: '✦ Ваш тариф',
    welcome_trial: '7-дневный бесплатный пробный период — сегодня без списаний',
    welcome_monitored: 'Отслеживаемый бизнес',
    welcome_next_steps: 'Следующие шаги',
    welcome_step1: 'Войдите в панель управления и проверьте свои профили',
    welcome_step2: 'Настройте предпочтения уведомлений',
    welcome_step3: 'Ожидайте первое уведомление — мы уже ведём мониторинг',
    welcome_cta: 'Перейти в мою панель →',
    welcome_support: 'Вопросы? Ответьте на это письмо. Наша команда отвечает в течение 24ч.',
    unsubscribe: 'Отписаться',
    alert_subject: '🚨 Обнаружен негативный отзыв — {platform} — Требуется действие',
    alert_badge: '🚨 Критическое уведомление',
    alert_title: 'Обнаружен негативный отзыв',
    alert_platform: 'Платформа',
    alert_author: 'Автор',
    alert_rating: 'Оценка',
    alert_severity: 'Серьёзность',
    alert_review_label: 'Отзыв',
    alert_no_text: 'Нет текста',
    alert_anonymous: 'Аноним',
    alert_cta: '✦ Посмотреть ответ от ИИ →',
    alert_footer1: 'RepuGuard автоматически сгенерировал профессиональный ответ.',
    alert_footer2: 'Войдите, чтобы подтвердить и опубликовать его в 1 клик.',
    monitoring: 'Мониторинг онлайн-репутации',
    payment_failed_subject: '⚠️ Проблема с оплатой — Ваша подписка RepuGuard',
    payment_failed_badge: '⚠ Оплата не прошла',
    payment_failed_body: 'Нам не удалось списать средства с вашей карты. Мониторинг продолжается, но обновите платёжные данные.',
    payment_failed_cta: 'Обновить оплату →',
    cancelled_subject: 'Ваша подписка RepuGuard отменена',
    cancelled_body: 'Ваша подписка RepuGuard была отменена. Ваша репутация больше не будет отслеживаться.',
    cancelled_cta: 'Переподписаться →',
    cancelled_thanks: 'Спасибо за использование RepuGuard.',
    trial_subject: 'Ваш бесплатный пробный период RepuGuard скоро закончится',
    trial_badge: '⏳ Бесплатный пробный период',
    trial_ending: 'Заканчивается {date}',
    trial_body: 'Ваш 7-дневный бесплатный пробный период скоро закончится. Чтобы продолжить мониторинг {business} без перерывов, ваша подписка будет активирована автоматически.',
    trial_cta: 'Управление подпиской →',
    hello: 'Здравствуйте, {name},',
    questions: 'Вопросы? Ответьте на это письмо.',
    j3_subject: 'День 3 вашего пробного периода — ваша репутация отслеживается 🔍',
    j3_title: 'RepuGuard отслеживает {business} 24/7',
    j3_tip1_title: 'Отвечайте в течение 24ч',
    j3_tip1: 'Клиенты, получившие ответ, возвращаются в 3× раза чаще. Ваш ответ от ИИ уже готов в панели управления.',
    j3_tip2_title: 'Оценка обновляется каждый день',
    j3_tip2: 'Ваш глобальный рейтинг репутации обновляется в реальном времени — отслеживайте прогресс неделю за неделей.',
    j3_tip3_title: 'Ответы ИИ ожидают',
    j3_tip3: 'Каждое уведомление автоматически генерирует профессиональный ответ — 1 клик для подтверждения и публикации.',
    j3_upgrade: 'Ваш пробный период заканчивается через 4 дня. Активируйте тариф сейчас, чтобы продолжить мониторинг без перерывов.',
    j3_cta: 'Перейти в мою панель →',
    j1_subject: 'RepuGuard отслеживает {business} — Добро пожаловать!',
    j1_title: 'Ваша репутация в надёжных руках',
    j1_body1: 'С момента регистрации RepuGuard отслеживает {business} в режиме реального времени на Google, Trustpilot и TripAdvisor.',
    j1_body2: 'Как только обнаружится негативный отзыв, вы получите мгновенное уведомление, и профессиональный ответ будет сгенерирован автоматически.',
    j1_cta: 'Перейти в мою панель →',
    j2_subject: '{business} ещё не настроен — займёт всего 3 минуты',
    j2_title: 'Активируйте мониторинг {business}',
    j2_step1: 'Войдите в панель управления',
    j2_step2: 'Убедитесь, что ваш бизнес найден корректно',
    j2_step3: 'Включите уведомления — остальное мы сделаем сами',
    j2_urgency: 'У вас осталось 5 дней бесплатного пробного периода. Не дайте ему истечь, не попробовав.',
    j2_cta: 'Настроить сейчас →',
    report_subject: '📊 Ваш еженедельный отчёт RepuGuard — {period}',
    report_period_label: 'Еженедельный отчёт · {period}',
    report_greeting: 'Привет, {name} 👋',
    report_intro: 'Вот сводка репутации {business} за эту неделю.',
    report_score_label: '◈ Глобальный рейтинг',
    report_new_reviews: 'Новые отзывы',
    report_positive: 'Положительные отзывы',
    report_negative: 'Отрицательные отзывы',
    report_negative_alert: '⚠ Обнаружено {count} негативных отзыв(а) за эту неделю',
    report_negative_alert_sub: 'Были сгенерированы ответы ИИ — войдите, чтобы их подтвердить.',
    report_all_positive: '✓ Негативных отзывов на этой неделе нет',
    report_all_positive_sub: 'Отличная неделя для вашей репутации!',
    report_cta: 'Открыть полную панель →',
    report_footer: 'Этот отчёт отправляется автоматически каждый понедельник в 08:00.',
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

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function unsubLink(email) {
  const sig = crypto.createHmac('sha256', SUPABASE_KEY).update(email.toLowerCase()).digest('hex');
  return `https://repuguard.app/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, email, firstName: _fn, businessName: _bn, plan, review: _rv, lang: reqLang } = req.body;
    const lang = reqLang || 'fr';
    const firstName = escapeHtml(_fn);
    const businessName = escapeHtml(_bn);
    const review = _rv ? { ..._rv, platform: escapeHtml(_rv.platform), author: escapeHtml(_rv.author), text: escapeHtml(_rv.text) } : null;

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
<html lang="${lang}">
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
<html lang="${lang}">
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
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px;">${eT(lang,'alert_review_label')}</div>
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

      subject = eT(lang, 'report_subject', {period: period || ''});
      html = `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">

        <tr>
          <td style="background:#0e1018;padding:40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-weight:900;font-size:28px;color:#f1f5f9;letter-spacing:-1px;">Repu<span style="color:#818cf8;">Guard</span></div>
            <div style="margin-top:8px;font-size:13px;color:#475569;">${eT(lang, 'report_period_label', {period: period || ''})}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9;">${eT(lang, 'report_greeting', {name: firstName})}</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.6;">${eT(lang, 'report_intro', {business: businessName})}</p>

            <!-- SCORE GLOBAL -->
            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#818cf8;margin-bottom:8px;">${eT(lang, 'report_score_label')}</div>
              <div style="font-size:42px;font-weight:900;color:#f1f5f9;font-family:Arial,sans-serif;line-height:1;">${avgRating ? avgRating.toFixed(1) : '—'}</div>
              <div style="font-size:16px;color:#818cf8;margin-top:4px;">${ratingStars}</div>
            </div>

            <!-- MÉTRIQUES -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td width="33%" style="padding:0 6px 0 0;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">${eT(lang, 'report_new_reviews')}</div>
                    <div style="font-size:26px;font-weight:800;color:#f1f5f9;">${newReviews || 0}</div>
                  </div>
                </td>
                <td width="33%" style="padding:0 3px;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">${eT(lang, 'report_positive')}</div>
                    <div style="font-size:26px;font-weight:800;color:#34d399;">${positiveRate}%</div>
                  </div>
                </td>
                <td width="33%" style="padding:0 0 0 6px;">
                  <div style="background:#13151f;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:11px;color:#475569;margin-bottom:6px;">${eT(lang, 'report_negative')}</div>
                    <div style="font-size:26px;font-weight:800;color:${negativeCount > 0 ? '#f87171' : '#34d399'};">${negativeRate}%</div>
                  </div>
                </td>
              </tr>
            </table>

            ${negativeCount > 0 ? `
            <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:4px;">${eT(lang, 'report_negative_alert', {count: negativeCount})}</div>
              <div style="font-size:12px;color:#94a3b8;">${eT(lang, 'report_negative_alert_sub')}</div>
            </div>
            ` : `
            <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:12px;font-weight:700;color:#34d399;margin-bottom:4px;">${eT(lang, 'report_all_positive')}</div>
              <div style="font-size:12px;color:#94a3b8;">${eT(lang, 'report_all_positive_sub')}</div>
            </div>
            `}

            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">${eT(lang, 'report_cta')}</a>
            </div>

            <p style="margin:0;font-size:12px;color:#475569;text-align:center;">${eT(lang, 'report_footer')}</p>
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
      subject = eT(lang, 'payment_failed_subject');
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <div style="background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.25);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:#fb923c;">${eT(lang, 'payment_failed_badge')}</div>
        </div>
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">${eT(lang, 'hello', {name: firstName})}</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">${eT(lang, 'payment_failed_body')}</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard#abonnement" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">${eT(lang, 'payment_failed_cta')}</a>
        </div>
        <p style="font-size:12px;color:#475569;text-align:center;">${eT(lang, 'questions')}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    }

    // ══════════════════════════════════
    // EMAIL ANNULATION ABONNEMENT
    // ══════════════════════════════════
    if (type === 'cancelled') {
      subject = eT(lang, 'cancelled_subject');
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">${eT(lang, 'hello', {name: firstName})}</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">${eT(lang, 'cancelled_body')}</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/signup" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">${eT(lang, 'cancelled_cta')}</a>
        </div>
        <p style="font-size:12px;color:#475569;text-align:center;">${eT(lang, 'cancelled_thanks')}</p>
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
      subject = eT(lang, 'trial_subject');
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <div style="font-size:12px;color:#818cf8;font-weight:700;margin-bottom:4px;">${eT(lang, 'trial_badge')}</div>
          <div style="font-size:18px;font-weight:800;color:#f1f5f9;">${eT(lang, 'trial_ending', {date: trialEnd})}</div>
        </div>
        <p style="font-size:15px;color:#f1f5f9;margin:0 0 16px;">${eT(lang, 'hello', {name: firstName})}</p>
        <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">${eT(lang, 'trial_body', {business: businessName})}</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard#abonnement" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">${eT(lang, 'trial_cta')}</a>
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
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
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

    // ══════════════════════════════════
    // EMAIL ONBOARDING J1 (24h après inscription)
    // ══════════════════════════════════
    if (type === 'onboarding_j1') {
      subject = eT(lang, 'j1_subject', {business: businessName || 'votre établissement'});
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;letter-spacing:-0.5px;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:40px;">
        <p style="margin:0 0 8px;font-size:15px;color:#f1f5f9;">${eT(lang,'hello',{name:firstName})}</p>
        <h1 style="margin:0 0 24px;font-size:22px;font-weight:800;color:#f1f5f9;">${eT(lang,'j1_title')}</h1>
        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:18px 20px;margin-bottom:20px;">
          <p style="margin:0 0 10px;font-size:14px;color:#94a3b8;line-height:1.6;">${eT(lang,'j1_body1',{business:businessName||'votre établissement'})}</p>
          <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">${eT(lang,'j1_body2')}</p>
        </div>
        <div style="background:#13151f;border-radius:10px;padding:14px 20px;margin-bottom:28px;">
          <div style="font-size:12px;color:#475569;margin-bottom:4px;">${eT(lang,'welcome_monitored')}</div>
          <div style="font-size:16px;font-weight:700;color:#f1f5f9;">${businessName || '—'}</div>
        </div>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">${eT(lang,'j1_cta')}</a>
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

    // ══════════════════════════════════
    // EMAIL ONBOARDING J2 (relance si pas encore configuré)
    // ══════════════════════════════════
    if (type === 'onboarding_j2') {
      subject = eT(lang, 'j2_subject', {business: businessName || 'votre établissement'});
      html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0e1018;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-weight:900;font-size:24px;color:#f1f5f9;letter-spacing:-0.5px;">Repu<span style="color:#818cf8;">Guard</span></div>
      </td></tr>
      <tr><td style="padding:40px;">
        <p style="margin:0 0 8px;font-size:15px;color:#f1f5f9;">${eT(lang,'hello',{name:firstName})}</p>
        <h1 style="margin:0 0 24px;font-size:22px;font-weight:800;color:#f1f5f9;">${eT(lang,'j2_title',{business:businessName||'votre établissement'})}</h1>
        <div style="margin-bottom:16px;background:#13151f;border-radius:10px;padding:16px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:4px;">① ${eT(lang,'j2_step1')}</div>
        </div>
        <div style="margin-bottom:16px;background:#13151f;border-radius:10px;padding:16px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:4px;">② ${eT(lang,'j2_step2')}</div>
        </div>
        <div style="margin-bottom:24px;background:#13151f;border-radius:10px;padding:16px 20px;">
          <div style="font-size:13px;font-weight:700;color:#818cf8;margin-bottom:4px;">③ ${eT(lang,'j2_step3')}</div>
        </div>
        <div style="background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:14px 20px;margin-bottom:28px;">
          <div style="font-size:13px;color:#fb923c;line-height:1.5;">⏳ ${eT(lang,'j2_urgency')}</div>
        </div>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="https://repuguard.app/dashboard" style="display:inline-block;background:#6366f1;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">${eT(lang,'j2_cta')}</a>
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
