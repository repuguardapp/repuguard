import 'server-only';
import { createHash } from 'node:crypto';

/**
 * What the running deployment can actually see.
 *
 * WHY THIS EXISTS
 *
 * DOMAIN_VERIFICATION_SECRET was added in Vercel and the feature stayed
 * dead, because a variable added after a deployment never reaches that
 * deployment — it applies to the next build. There was no way to tell that
 * apart from a bug in the code, and the only available answer was "try it
 * and see whether it 503s", which is not an instrument.
 *
 * So this reads each variable the same way the code that needs it reads it,
 * inside the deployment that is answering the request, and prints presence
 * next to the consequence of its absence. `ADMIN_SELFTEST_SECRET` absent is
 * a note; `CRON_SECRET` absent means nothing is polled. A list of names
 * with green and red dots would not have told anyone that.
 *
 * NO VALUE IS EVER RETURNED
 *
 * Not the value, not a prefix, not the length. What comes back is presence
 * and — only for values long enough that it gives nothing away — the first
 * eight hex of a SHA-256. That exists for exactly one question: whether
 * Production and Preview hold the SAME DOMAIN_VERIFICATION_SECRET. They
 * must, because the verification token is derived from it and every TXT
 * record a customer has already published becomes wrong the day it
 * changes. Comparing two fingerprints answers that without either value
 * being read by anyone, including the operator, who in Vercel cannot read
 * them back anyway.
 *
 * Below FINGERPRINT_MIN_CHARS there is no fingerprint. A short or
 * structured value (a model name, a price id, a comma-separated list of
 * e-mail addresses) can be guessed and checked against a digest offline, so
 * for those, presence is all that is safe to publish.
 */

const FINGERPRINT_MIN_CHARS = 20;

export type Requirement = 'required' | 'optional';

export interface ConfigEntry {
  name: string;
  requirement: Requirement;
  /**
   * What stops working when it is absent, in French: the administration
   * interface has one reader and he reads French.
   *
   * Written as an observed consequence of the code, not as advice. Each one
   * is checkable against the file that reads the variable.
   */
  consequence: string;
}

export interface ConfigStatus extends ConfigEntry {
  present: boolean;
  fingerprint: string | null;
}

/**
 * Read statically, one property access per variable.
 *
 * Deliberately not `process.env[entry.name]` in a loop. Next replaces
 * `process.env.NEXT_PUBLIC_*` at build time by literal substitution, which
 * a computed lookup defeats — and a dynamic read that came back undefined
 * would paint a variable red that is present and working. A console that
 * raises a false alarm about configuration is worse than no console: it
 * sends somebody to rotate a secret that was fine.
 *
 * The verbosity is the guarantee. Adding a variable here means writing its
 * name where the compiler can see it.
 */
function readEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_AUTH_HOOK_SECRET: process.env.SUPABASE_AUTH_HOOK_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    CRON_SECRET: process.env.CRON_SECRET,
    DOMAIN_VERIFICATION_SECRET: process.env.DOMAIN_VERIFICATION_SECRET,
    INBOUND_WEBHOOK_SECRET: process.env.INBOUND_WEBHOOK_SECRET,
    MARKETING_OPTOUT_SECRET: process.env.MARKETING_OPTOUT_SECRET,
    DOCUMENT_ENCRYPTION_KEY: process.env.DOCUMENT_ENCRYPTION_KEY,
    DOCUMENT_ENCRYPTION_KEYS: process.env.DOCUMENT_ENCRYPTION_KEYS,
    DOCUMENT_ENCRYPTION_ACTIVE: process.env.DOCUMENT_ENCRYPTION_ACTIVE,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    POSTHOG_PERSONAL_API_KEY: process.env.POSTHOG_PERSONAL_API_KEY,
    ADMIN_SELFTEST_SECRET: process.env.ADMIN_SELFTEST_SECRET
  };
}

/**
 * Grouped by what breaks, not alphabetically. The operator arrives here
 * with a symptom.
 */
export const CONFIG_GROUPS: { title: string; entries: ConfigEntry[] }[] = [
  {
    title: 'Base de données et accès',
    entries: [
      {
        name: 'NEXT_PUBLIC_SUPABASE_URL',
        requirement: 'required',
        consequence: 'Absente, aucune page ne rend : plus aucun accès à la base.'
      },
      {
        name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        requirement: 'required',
        consequence: 'Absente, personne ne peut se connecter ni ouvrir de session.'
      },
      {
        name: 'SUPABASE_SERVICE_ROLE_KEY',
        requirement: 'required',
        consequence: 'Absente, les lectures serveur échouent : audits, veille et scans.'
      },
      {
        name: 'SUPABASE_AUTH_HOOK_SECRET',
        requirement: 'required',
        consequence:
          "Absent, le hook d'authentification de Supabase est rejeté et aucun lien de connexion ne part."
      },
      {
        name: 'ADMIN_EMAILS',
        requirement: 'required',
        consequence: "Absente, plus aucune adresse n'est administratrice : cette page devient 404."
      }
    ]
  },
  {
    title: 'Scan public',
    entries: [
      {
        name: 'DOMAIN_VERIFICATION_SECRET',
        requirement: 'required',
        consequence:
          "Absent, /api/scan/verify répond 503 et le bloc de vérification n'apparaît pas : aucune page de scan ne devient indexable. Sa valeur ne doit jamais changer — tout enregistrement TXT déjà publié par un client deviendrait faux."
      }
      // The site's own origin is deliberately not listed here, and trying
      // to list it is what settled the question. A guard test in
      // tests/app-url.test.ts holds that its variable appears in exactly
      // one module — not even in a comment, which is how this note came to
      // be written without the name — because it once had nine fallbacks
      // and two of them would have published a sitemap on a placeholder
      // domain. And the consequence drafted for it, that canonical URLs
      // would point elsewhere, was false: lib/app-url.ts falls back to the
      // real domain, so its absence changes nothing a crawler can see. A
      // row on this card for a variable whose absence has no consequence is
      // noise pretending to be a check.
    ]
  },
  {
    title: 'Travaux planifiés et webhooks',
    entries: [
      {
        name: 'CRON_SECRET',
        requirement: 'required',
        consequence: 'Absent, les travaux planifiés refusent de tourner : rien n\'est relevé.'
      },
      {
        name: 'INBOUND_WEBHOOK_SECRET',
        requirement: 'required',
        consequence: "Absent, le webhook entrant refuse tout (échec fermé) et nomme la variable."
      },
      {
        name: 'RESEND_WEBHOOK_SECRET',
        requirement: 'optional',
        consequence:
          "Non arbitré. Absent, les événements de remise de Resend ne sont pas vérifiés donc pas acceptés."
      },
      {
        name: 'STRIPE_WEBHOOK_SECRET',
        requirement: 'required',
        consequence: "Absent, aucun paiement n'est enregistré : Stripe encaisse, nous ne le voyons pas."
      }
    ]
  },
  {
    title: 'Modèles et e-mail',
    entries: [
      {
        name: 'ANTHROPIC_API_KEY',
        requirement: 'required',
        consequence: "Absente, aucun audit ne peut être produit."
      },
      {
        name: 'OPENAI_API_KEY',
        requirement: 'required',
        consequence: 'Absente, la localisation des développements juridiques ne tourne plus.'
      },
      {
        name: 'RESEND_API_KEY',
        requirement: 'required',
        consequence: "Absente, aucun e-mail ne part et l'envoi échoue silencieusement côté appelant."
      },
      {
        name: 'MARKETING_OPTOUT_SECRET',
        requirement: 'required',
        consequence:
          "Absent, AUCUN e-mail de cycle de vie ne part — c'est volontaire : sans lui le lien de désabonnement et l'en-tête List-Unsubscribe ne peuvent pas être calculés, et un e-mail commercial dont on ne peut pas sortir ne doit pas être envoyé. Sa valeur ne doit jamais changer : tout lien déjà reçu cesserait de fonctionner."
      },
      {
        name: 'RESEND_FROM',
        requirement: 'required',
        consequence:
          'Absente, les e-mails partent de onboarding@resend.dev — une adresse qui n\'est pas la nôtre.'
      }
    ]
  },
  {
    title: 'Paiement',
    entries: [
      {
        name: 'STRIPE_SECRET_KEY',
        requirement: 'required',
        consequence: 'Absente, aucune session de paiement ne peut être ouverte.'
      },
      {
        name: 'STRIPE_PRICE_STARTER',
        requirement: 'required',
        consequence: "Absent, l'offre correspondante ne peut pas être achetée."
      },
      {
        name: 'STRIPE_PRICE_BUSINESS',
        requirement: 'required',
        consequence: "Absent, l'offre correspondante ne peut pas être achetée."
      },
      {
        name: 'STRIPE_PRICE_PRO',
        requirement: 'required',
        consequence: "Absent, l'offre correspondante ne peut pas être achetée."
      },
      {
        name: 'STRIPE_PRICE_ENTERPRISE',
        requirement: 'required',
        consequence: "Absent, l'offre correspondante ne peut pas être achetée."
      }
    ]
  },
  {
    title: 'Chiffrement des documents',
    entries: [
      {
        name: 'DOCUMENT_ENCRYPTION_KEY',
        requirement: 'required',
        consequence:
          'Absente, les documents déjà chiffrés ne peuvent plus être déchiffrés (échec fermé, jamais de contenu en clair).'
      },
      {
        name: 'DOCUMENT_ENCRYPTION_KEYS',
        requirement: 'optional',
        consequence:
          'Rotation de clés, format v1:<base64>,v2:<base64>. Absente, la clé unique ci-dessus est utilisée.'
      },
      {
        name: 'DOCUMENT_ENCRYPTION_ACTIVE',
        requirement: 'optional',
        consequence: "Identifiant de la clé utilisée pour chiffrer. N'a de sens qu'avec la précédente."
      }
    ]
  },
  {
    title: 'Anti-robot',
    entries: [
      {
        name: 'TURNSTILE_SECRET_KEY',
        requirement: 'required',
        consequence:
          "Absente, en production le formulaire refuse tout envoi. C'est volontaire : ce portillon a renvoyé « validé » pendant des mois alors qu'il n'était pas configuré."
      },
      {
        name: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
        requirement: 'required',
        consequence: "Absente, le widget ne s'affiche pas et aucun jeton n'est produit."
      }
    ]
  },
  {
    title: 'Instrumentation',
    entries: [
      {
        name: 'SENTRY_DSN',
        requirement: 'required',
        consequence: "Absent, les erreurs serveur ne sont rapportées nulle part."
      },
      {
        name: 'NEXT_PUBLIC_SENTRY_DSN',
        requirement: 'required',
        consequence: "Absent, les erreurs côté navigateur ne sont rapportées nulle part."
      },
      {
        name: 'NEXT_PUBLIC_POSTHOG_KEY',
        requirement: 'optional',
        consequence: "Absente, aucune mesure de parcours. Aucun cookie non plus."
      },
      {
        name: 'POSTHOG_PERSONAL_API_KEY',
        requirement: 'optional',
        consequence: 'Lecture serveur des mesures. Absente, les tableaux de bord internes sont vides.'
      },
      {
        name: 'ADMIN_SELFTEST_SECRET',
        requirement: 'optional',
        consequence: "Absent, les routes d'auto-test refusent — elles ne servent qu'au diagnostic."
      }
    ]
  }
];

/**
 * Presence, and a fingerprint only where one is safe.
 *
 * An empty or whitespace-only value counts as absent: `FOO=` in Vercel is
 * a variable that exists and configures nothing, and reporting it present
 * would send the operator looking for the fault somewhere else.
 */
export function configStatus(): { title: string; entries: ConfigStatus[] }[] {
  const env = readEnv();

  return CONFIG_GROUPS.map((group) => ({
    title: group.title,
    entries: group.entries.map((entry) => {
      const value = env[entry.name]?.trim() ?? '';
      return {
        ...entry,
        present: value.length > 0,
        fingerprint:
          value.length >= FINGERPRINT_MIN_CHARS
            ? createHash('sha256').update(value).digest('hex').slice(0, 8)
            : null
      };
    })
  }));
}

/**
 * Which deployment answered.
 *
 * The whole point of the card. "The variable is in Vercel" and "the
 * variable is in the code that just ran" are different statements, and the
 * commit is how you tell them apart: if the sha predates the moment you
 * added the variable, nothing is wrong except that nobody has redeployed.
 */
export function deploymentIdentity(): { env: string; commit: string | null } {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    commit: sha ? sha.slice(0, 7) : null
  };
}

/** Count of required variables this deployment cannot see. */
export function missingRequired(groups: { entries: ConfigStatus[] }[]): string[] {
  return groups.flatMap((group) =>
    group.entries.filter((e) => e.requirement === 'required' && !e.present).map((e) => e.name)
  );
}
