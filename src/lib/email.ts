import 'server-only';
import { Resend } from 'resend';
import { emailStringsFor, type AuditCompletedStrings } from './email-i18n';
import { supabaseService } from './supabase';

/**
 * Transactional email via Resend.
 *
 * Failure mode: every helper here returns void and swallows network
 * errors. Email is best-effort — a failed delivery must never break the
 * caller (the audit pipeline, the auth flow). Failures land in console
 * + Sentry breadcrumb where applicable.
 *
 * Branding: From = "LexyFlow <hello@lexyflow.com>". The sending domain
 * must be verified in Resend (DNS records — see DEPLOY.md).
 */

/**
 * The address every email is sent FROM. Configurable per environment
 * via RESEND_FROM so a deployment can change senders without a code
 * push — useful when the custom domain isn't verified in Resend yet.
 *
 *   - In Vercel: RESEND_FROM = "LexyFlow <hello@lexyflow.com>"
 *     once the lexyflow.com DNS records (SPF, DKIM) are propagated and
 *     Resend marks the domain as Verified.
 *   - Until then: leave RESEND_FROM unset. The fallback uses Resend's
 *     sandbox domain `onboarding@resend.dev`, which is always
 *     verified and never bounces — emails arrive with a slightly
 *     less branded From but they DO arrive.
 *
 * Either way the human-readable name ("LexyFlow") sits on the left and
 * the inbox shows "LexyFlow <hello@...>".
 */
const FROM = process.env.RESEND_FROM ?? 'LexyFlow <onboarding@resend.dev>';
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://lexyflow.com';

let client: Resend | null = null;
function resend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

/* ------------------------------------------------------------------ */
/* Audit completed                                                    */
/* ------------------------------------------------------------------ */

export interface AuditCompletedEmailArgs {
  organizationId: string;
  auditId: string;
  riskScore: number;
  findingsCount: number;
}

export async function sendAuditCompletedEmail(args: AuditCompletedEmailArgs): Promise<void> {
  // Wrap the entire body in a try/catch so this best-effort notification
  // can never produce an unhandled promise rejection — the audit
  // pipeline calls us with `void` and a stray rejection here used to
  // bubble up to the waitUntil runtime as a spurious error log even
  // though the audit itself had already completed successfully.
  try {
    const r = resend();
    if (!r) return; // Email disabled in this env — silently skip.

    const admin = supabaseService();

    // Look up the org owner's email + UI locale. Cheap, single query.
    const { data: org } = await admin
      .from('organizations')
      .select('id,name,ui_locale')
      .eq('id', args.organizationId)
      .maybeSingle();
    if (!org) return;

    // Find members of the org via auth.users + their app_metadata. For MVP
    // we send to all members; production should respect notification prefs.
    const { data: members } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });

    const recipients = (members?.users ?? [])
      .filter((u) => (u.app_metadata as { organization_id?: string } | null)?.organization_id === args.organizationId)
      .map((u) => u.email)
      .filter((e): e is string => Boolean(e));

    if (recipients.length === 0) return;

    const url = `${APP_URL()}/dashboard/${args.auditId}`;
    const severity = severityFor(args.riskScore);
    const strings = emailStringsFor(org.ui_locale);
    const subject = strings.subject(severity, args.riskScore);

    await r.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html: renderAuditCompletedHtml({ ...args, severity, url, orgName: org.name ?? 'your team', strings }),
      text: renderAuditCompletedText({ ...args, severity, url, strings })
    });
  } catch (err) {
    console.error('[email] sendAuditCompletedEmail failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* Magic link (Supabase Auth Email Hook)                              */
/* ------------------------------------------------------------------ */

export interface MagicLinkEmailArgs {
  to: string;
  link: string;
  /** Optional locale for the email copy. */
  locale?: string;
}

const MAGIC_SUBJECT: Record<string, string> = {
  en:    'Your LexyFlow sign-in link',
  fr:    'Votre lien de connexion LexyFlow',
  es:    'Tu enlace de acceso a LexyFlow',
  de:    'Ihr LexyFlow-Anmeldelink',
  'pt-br': 'Seu link de acesso ao LexyFlow',
  ja:    'LexyFlow へのログインリンク'
};

const MAGIC_BODY: Record<string, { lead: string; cta: string; safety: string }> = {
  en: {
    lead: 'Tap the button below to sign in. The link is valid for 60 minutes and works on one device.',
    cta:  'Sign in to LexyFlow',
    safety: "If you didn't request this, ignore this email — no account changes will happen."
  },
  fr: {
    lead: "Cliquez sur le bouton ci-dessous pour vous connecter. Lien valable 60 minutes, sur un seul appareil.",
    cta:  'Se connecter à LexyFlow',
    safety: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message — aucun compte ne sera modifié."
  },
  es: {
    lead: 'Toca el botón para iniciar sesión. El enlace es válido durante 60 minutos y funciona en un solo dispositivo.',
    cta:  'Iniciar sesión en LexyFlow',
    safety: 'Si no solicitaste esto, ignora este correo — no se harán cambios.'
  },
  de: {
    lead: 'Tippen Sie auf die Schaltfläche, um sich anzumelden. Der Link gilt 60 Minuten und funktioniert auf einem Gerät.',
    cta:  'Bei LexyFlow anmelden',
    safety: 'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — es werden keine Änderungen vorgenommen.'
  },
  'pt-br': {
    lead: 'Toque no botão abaixo para entrar. O link é válido por 60 minutos e funciona em um dispositivo.',
    cta:  'Entrar no LexyFlow',
    safety: 'Se você não pediu isso, ignore este e-mail — nada será alterado.'
  },
  ja: {
    lead: '下のボタンをタップしてサインインしてください。リンクは 60 分間、1 つの端末でのみ有効です。',
    cta:  'LexyFlow にサインイン',
    safety: '心当たりがない場合はこのメールを無視してください。アカウントは変更されません。'
  }
};

export async function sendMagicLinkEmail(args: MagicLinkEmailArgs): Promise<void> {
  // Structured logs around every code path so a missing magic-link
  // email always tells us WHY in Vercel Runtime Logs:
  //   - resend_disabled      → RESEND_API_KEY env var unset
  //   - resend_sent          → success, includes Resend message id
  //   - resend_send_failed   → Resend rejected the send (rate limit,
  //                             domain not verified, recipient bounced,
  //                             quota exceeded, etc.)
  //   - resend_threw         → network / SDK crash
  try {
    const r = resend();
    if (!r) {
      console.warn('[email] magic_link resend_disabled (RESEND_API_KEY unset)', { to: redact(args.to) });
      return;
    }

    const locale = (args.locale ?? 'en').toLowerCase();
    const subject = MAGIC_SUBJECT[locale] ?? MAGIC_SUBJECT.en!;
    const body = MAGIC_BODY[locale] ?? MAGIC_BODY.en!;

    const { data, error } = await r.emails.send({
      from: FROM,
      to: args.to,
      subject,
      html: renderMagicLinkHtml({ link: args.link, body }),
      text: `${body.lead}\n\n${args.link}\n\n${body.safety}`
    });

    if (error) {
      // Resend returned a 4xx — domain not verified, recipient blocked,
      // quota hit, etc. The Resend `name` field is the categorical
      // code (e.g. "validation_error", "rate_limit_exceeded").
      console.error('[email] magic_link resend_send_failed', {
        to: redact(args.to),
        locale,
        resendErrorName: error.name,
        resendErrorMessage: error.message
      });
      return;
    }

    console.log('[email] magic_link resend_sent', {
      to: redact(args.to),
      locale,
      resendMessageId: data?.id ?? null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] magic_link resend_threw', { to: redact(args.to), error: message });
  }
}

/** Mask everything between the first character and the @ so logs don't
 *  carry a user's full email. "alice@example.com" → "a***@example.com". */
function redact(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return `${email[0]}***${email.slice(at)}`;
}

/* ------------------------------------------------------------------ */
/* Templates                                                          */
/* ------------------------------------------------------------------ */

function severityFor(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function renderAuditCompletedHtml(args: {
  riskScore: number;
  findingsCount: number;
  severity: string;
  url: string;
  orgName: string;
  strings: AuditCompletedStrings;
}): string {
  const s = args.strings;
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0b0d;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:12px;">
    <tr><td style="padding:32px 32px 16px 32px;">
      <div style="font-size:14px;color:#6a737d;letter-spacing:.04em;text-transform:uppercase;">LexyFlow</div>
      <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0 0;">${escapeHtml(s.heading)}</h1>
    </td></tr>
    <tr><td style="padding:0 32px 8px 32px;">
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#3a3a3f;">
        ${escapeHtml(s.greeting(args.orgName))}
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e6e8eb;border-radius:8px;margin:8px 0 24px 0;">
        <tr>
          <td style="padding:16px;border-right:1px solid #e6e8eb;">
            <div style="font-size:12px;color:#6a737d;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(s.riskScoreLabel)}</div>
            <div style="font-size:28px;font-weight:600;margin-top:4px;">${args.riskScore}/100</div>
            <div style="font-size:13px;color:#6a737d;margin-top:2px;text-transform:capitalize;">${args.severity}</div>
          </td>
          <td style="padding:16px;">
            <div style="font-size:12px;color:#6a737d;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(s.findingsLabel)}</div>
            <div style="font-size:28px;font-weight:600;margin-top:4px;">${args.findingsCount}</div>
          </td>
        </tr>
      </table>
      <a href="${args.url}" style="display:inline-block;background:#0b0b0d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:500;">${escapeHtml(s.cta)}</a>
    </td></tr>
    <tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #e6e8eb;color:#6a737d;font-size:12px;line-height:1.5;">
      ${escapeHtml(s.zeroKnowledgeFooter)}
    </td></tr>
  </table>
</body></html>`;
}

function renderAuditCompletedText(args: {
  riskScore: number;
  findingsCount: number;
  severity: string;
  url: string;
  strings: AuditCompletedStrings;
}): string {
  const s = args.strings;
  return [
    s.textHeader,
    '',
    `${s.riskScoreLabel}: ${args.riskScore}/100 (${args.severity})`,
    `${s.findingsLabel}: ${args.findingsCount}`,
    '',
    `${s.cta.replace(/\s*→\s*$/, '')}: ${args.url}`,
    '',
    s.zeroKnowledgeFooter
  ].join('\n');
}

function renderMagicLinkHtml(args: { link: string; body: { lead: string; cta: string; safety: string } }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0b0d;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:12px;">
    <tr><td style="padding:32px;">
      <div style="font-size:14px;color:#6a737d;letter-spacing:.04em;text-transform:uppercase;">LexyFlow</div>
      <p style="margin:16px 0 24px 0;font-size:15px;line-height:1.55;">${escapeHtml(args.body.lead)}</p>
      <a href="${args.link}" style="display:inline-block;background:#0b0b0d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:500;">${escapeHtml(args.body.cta)}</a>
      <p style="margin:24px 0 0 0;font-size:12px;color:#6a737d;line-height:1.5;">${escapeHtml(args.body.safety)}</p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* Lifecycle emails — J+0 welcome, J+3 nudge, J+14 upgrade            */
/* ------------------------------------------------------------------ */

/**
 * The three touchpoints of the lifecycle sequence. Kept in English
 * only on purpose — matches the /trust /privacy /terms pattern
 * (industry standard for SaaS B2B onboarding, and every non-EN
 * translation would add 6× the templates for marginal deliverability
 * benefit). Failures are logged and swallowed — a broken lifecycle
 * email must never break signup or the cron.
 */
async function sendLifecycle(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  logTag: string;
}): Promise<boolean> {
  try {
    const r = resend();
    if (!r) {
      console.warn(`[email] ${args.logTag} resend_disabled`);
      return false;
    }
    const { data, error } = await r.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text
    });
    if (error) {
      console.error(`[email] ${args.logTag} resend_send_failed`, { to: redact(args.to), errorName: error.name, errorMessage: error.message });
      return false;
    }
    console.log(`[email] ${args.logTag} resend_sent`, { to: redact(args.to), resendMessageId: data?.id ?? null });
    return true;
  } catch (err) {
    console.error(`[email] ${args.logTag} resend_threw`, { to: redact(args.to), error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

const AUDIT_URL = () => `${APP_URL()}/en/audit`;
const SAMPLE_URL = () => `${APP_URL()}/ar/sample-report`;
const PRICING_URL = () => `${APP_URL()}/en/pricing`;

/** J+0 — sent from /api/onboarding right after the org is created. */
export async function sendLifecycleWelcome(to: string): Promise<boolean> {
  const subject = 'Welcome to LexyFlow — audit your first document in 60 seconds';
  const body = `Thanks for joining LexyFlow.

Your account is ready. To run your first audit, upload any document (privacy policy, vendor DPA, client contract) and pick a target framework — GDPR, EU AI Act, Qatar PDPPL, Saudi PDPL, and 9 more supported out of the box.

  ${AUDIT_URL()}

Want to see what a real report looks like before uploading yours? Here's a live audit LexyFlow ran on Wikimedia Foundation's Privacy Policy against Qatar PDPPL:

  ${SAMPLE_URL()}

Any question, just reply to this email — I read every one.

— The LexyFlow team
legal@lexyflow.com`;
  return sendLifecycle({
    to,
    subject,
    text: body,
    html: renderLifecycleHtml('Welcome to LexyFlow', body, 'Audit your first document', AUDIT_URL()),
    logTag: 'lifecycle_welcome'
  });
}

/** J+3 — nudge for orgs that signed up but haven't run any audit yet. */
export async function sendLifecycleNudge(to: string): Promise<boolean> {
  const subject = 'Three documents our users audit first';
  const body = `Your LexyFlow account has been active for a few days but we haven't seen your first audit yet. Totally normal — most people wonder where to start.

Here are the three documents 80% of our users audit first:

  1. A vendor DPA (Data Processing Agreement) from a SaaS you already use
  2. Your own public Privacy Policy
  3. A client contract that processes personal data

Each audit takes 60 seconds and returns a detailed report with article-level citations.

  ${AUDIT_URL()}

Stuck on which one to pick? Reply to this email and I'll answer within 24h.

— The LexyFlow team
legal@lexyflow.com`;
  return sendLifecycle({
    to,
    subject,
    text: body,
    html: renderLifecycleHtml('Three documents to audit first', body, 'Start my first audit', AUDIT_URL()),
    logTag: 'lifecycle_nudge'
  });
}

/** J+14 — upgrade nudge for orgs that ran an audit but never subscribed. */
export async function sendLifecycleUpgrade(to: string): Promise<boolean> {
  const subject = 'You used your free audit — here is what Pro unlocks';
  const body = `A few days back you ran your first audit on LexyFlow. Thanks for trying it out.

If you want to keep going, the Pro plan (185 EUR / month) unlocks:

  - Unlimited audits (vs 1 per month on the free tier)
  - AI editor — automatically rewrites non-compliant clauses while preserving your legal register
  - Cross-framework audits — one document against GDPR + Qatar PDPPL + Saudi PDPL in a single run

Launch promo code, -20% valid for 7 days: LAUNCH20

  ${PRICING_URL()}

Any question, or would you rather book a 15-minute demo? Just reply to this email.

— The LexyFlow team
legal@lexyflow.com`;
  return sendLifecycle({
    to,
    subject,
    text: body,
    html: renderLifecycleHtml('Unlock the Pro plan', body, 'See the pricing', PRICING_URL()),
    logTag: 'lifecycle_upgrade'
  });
}

/**
 * Shared HTML shell for the three lifecycle emails. Deliberately
 * plain: system font, single primary CTA, no dark-mode weirdness.
 * The Resend inbox preview looks the same on iOS Mail, Gmail web,
 * Outlook, and Apple Mail — tested across all four before shipping.
 */
function renderLifecycleHtml(heading: string, body: string, ctaLabel: string, ctaUrl: string): string {
  const paragraphs = body.split('\n\n').map((p) => `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#3a3a3f;white-space:pre-wrap;">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0b0d;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:12px;">
    <tr><td style="padding:32px;">
      <div style="font-size:14px;color:#6a737d;letter-spacing:.04em;text-transform:uppercase;">LexyFlow</div>
      <h1 style="font-size:22px;line-height:1.2;margin:8px 0 20px 0;">${escapeHtml(heading)}</h1>
      ${paragraphs}
      <a href="${ctaUrl}" style="display:inline-block;background:#0b0b0d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:500;margin-top:8px;">${escapeHtml(ctaLabel)}</a>
    </td></tr>
  </table>
</body></html>`;
}
