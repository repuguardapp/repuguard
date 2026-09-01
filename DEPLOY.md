# Déployer RepuGuard sur repuguard.app

Parcours de bout en bout, 100% tableau de bord — aucune commande
terminal, aucun code à écrire. Durée estimée : 35 minutes.

Cette branche (`deploy/repuguard`, dans le dépôt `repuguardapp/repuguard`)
est la base propre : uniquement les pages statiques, les 21 fonctions
`api/`, et les fichiers de configuration ci-dessous — rien du chantier
LexyFlow qui vit sur la branche `main`/`lexy/genesis` du même dépôt.

---

## 0. Prérequis

- Propriétaire de `repuguardapp/repuguard` sur GitHub
- Compte Vercel (Hobby suffit pour démarrer)
- Compte Supabase
- Compte Stripe (Stripe Tax activable plus tard, optionnel pour le lancement)
- Clé API Anthropic (accès Claude Haiku 4.5)
- Compte Resend
- Compte Google Cloud (OAuth + Places API)
- Compte développeur Trustpilot et TripAdvisor Content API
- Domaine `repuguard.app` chez votre registrar

---

## 1. Projet Vercel — 5 min

1. `vercel.com/new` → **Import Git Repository** → `repuguardapp/repuguard`.
2. Dans les réglages du nouveau projet, **avant le premier déploiement** :
   `Settings → Git → Production Branch` → remplacer `main` par
   `deploy/repuguard`.
3. `Settings → General → Root Directory` → laisser vide (racine du dépôt).
4. Framework Preset : **Other** (déjà déclaré dans `vercel.json`).
5. Ne pas déployer tout de suite — les variables d'environnement de
   l'étape 6 doivent être en place avant le premier build.

Ce projet Vercel est indépendant de celui de LexyFlow : autre Production
Branch, autres variables d'environnement, aucun partage d'état.

---

## 2. Projet Supabase — 5 min

1. `supabase.com/dashboard/projects` → **New project**
   - Nom : `repuguard`
   - Région : proche de vos utilisateurs (EU = `eu-west-3`)
   - Mot de passe base de données : générer, stocker dans 1Password
2. Une fois provisionné, **SQL Editor** → coller et exécuter
   `supabase/migrations/0001_init.sql` (fichier unique, crée `clients`,
   `reviews`, `processed_webhook_events`, `error_logs`, active la RLS).
3. **Project Settings → API** → copier :
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret key → `SUPABASE_SECRET_KEY` *(jamais côté client — le frontend ne parle jamais directement à Supabase)*

---

## 3. Stripe Billing — 8 min

1. Dashboard Stripe → **Products** → créer trois produits avec prix
   récurrent mensuel EUR, mêmes montants qu'affichés sur le site :

   | Produit  | Prix   | Réponses IA / jour |
   |----------|--------|---------------------|
   | Starter  | 29 €   | 50                  |
   | Pro      | 69 €   | 200                 |
   | Business | 149 €  | illimité            |

2. Copier chaque Price ID → `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_BUSINESS`.
3. **Developers → API keys** → `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks** → **Add endpoint** →
   `https://repuguard.app/api/stripe-webhook` (accessible seulement
   après le premier déploiement — revenir à cette étape ensuite) →
   événements : `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted` →
   copier le **Signing secret** → `STRIPE_WEBHOOK_SECRET`.

---

## 4. Google Cloud — OAuth + Places — 8 min

1. `console.cloud.google.com` → nouveau projet (ou existant) → **APIs &
   Services → Library** → activer **Places API (New)** et **Google
   Business Profile API**.
2. **Credentials → Create Credentials → OAuth client ID** (type Web) :
   - Authorized redirect URI : `https://repuguard.app/api/google-oauth-callback`
   - Copier **Client ID** / **Client secret** → `GOOGLE_CLIENT_ID` /
     `GOOGLE_CLIENT_SECRET`
3. **Credentials → Create Credentials → API key** (restreinte à Places
   API) → `GOOGLE_PLACES_API_KEY`.
4. **OAuth consent screen** : ajouter le scope Business Profile en mode
   test tant que l'app n'est pas vérifiée par Google (limite le nombre
   de comptes connectables — suffisant pour lancer).

---

## 5. Trustpilot & TripAdvisor — 5 min

1. Trustpilot Business → **API** → créer une clé développeur →
   `TRUSTPILOT_API_KEY`.
2. TripAdvisor Content API → `tripadvisor.com/developers` → demander un
   accès → `TRIPADVISOR_API_KEY`.

Ces deux intégrations sont optionnelles au lancement : sans clé, seul le
suivi Google fonctionne, le reste du produit tourne normalement.

---

## 6. Resend — 2 min

1. `resend.com` → **API Keys** → créer → `RESEND_API_KEY`.
2. Vérifier le domaine `repuguard.app` (DNS) pour l'envoi depuis
   `@repuguard.app`.
3. `ADMIN_EMAIL` → boîte qui reçoit le formulaire de contact et les
   notifications d'inscription à la newsletter.

---

## 7. Secrets opérationnels — 1 min

Deux valeurs à coller telles quelles, générées pour vous à la mise en
place de ce dépôt (demandez-les à votre agent si vous ne les avez pas
sous la main — elles ne sont jamais committées dans le dépôt) :

- `TOKEN_ENCRYPTION_KEY` — 64 caractères hexadécimaux, chiffre le
  refresh token Google Business Profile en base.
- `CRON_SECRET` — protège `/api/cron-sync` et les appels internes vers
  `/api/fetch-reviews`.

---

## 8. Variables d'environnement Vercel — 5 min

`Settings → Environment Variables` sur le projet créé à l'étape 1 —
coller toutes les valeurs des étapes 2 à 7, en suivant `.env.example`.

| Variable | Requis |
|---|---|
| `SUPABASE_URL` | ✅ |
| `SUPABASE_SECRET_KEY` | ✅ |
| `ANTHROPIC_API_KEY` | ✅ |
| `STRIPE_SECRET_KEY` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | ✅ |
| `STRIPE_PRICE_STARTER` / `_PRO` / `_BUSINESS` | ✅ |
| `RESEND_API_KEY` | ✅ |
| `ADMIN_EMAIL` | ✅ |
| `GOOGLE_CLIENT_ID` / `_SECRET` | ✅ |
| `GOOGLE_PLACES_API_KEY` | ✅ |
| `TOKEN_ENCRYPTION_KEY` | ✅ |
| `CRON_SECRET` | ✅ |
| `TRUSTPILOT_API_KEY` | optionnel |
| `TRIPADVISOR_API_KEY` | optionnel |

---

## 9. Déployer + domaine — 3 min

1. Retour au projet Vercel → **Deploy**.
2. `Settings → Domains` → ajouter `repuguard.app` → suivre les
   instructions DNS chez votre registrar.
3. Revenir à l'étape 3.4 (webhook Stripe) et à l'étape 4.1 (redirect URI
   Google) pour confirmer qu'elles pointent bien vers le domaine final.

---

## 10. Vérification du parcours complet

Avant d'envoyer du trafic :

1. Créer un compte test sur `/signup` → confirmer l'essai 7 jours actif
   dans `/dashboard`.
2. Connecter une fiche Google Business Profile réelle (la vôtre ou une
   fiche de test) via `/dashboard` → **Connecter Google**.
3. Déclencher `/api/fetch-reviews` (bouton "Synchroniser" du dashboard)
   → confirmer que de vrais avis apparaissent.
4. Générer une réponse IA sur un avis, la publier → confirmer qu'elle
   apparaît sur la fiche Google réelle.
5. Passer au plan payant via Stripe Checkout → confirmer le webhook
   `invoice.paid` et le passage `subscription_status: active` en base.

Ce sont les cinq vérifications listées en Phase 1 du brief de
relance — une fois validées, RepuGuard est en état de recevoir du
trafic.
