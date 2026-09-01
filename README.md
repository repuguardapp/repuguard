<div align="center">

# RepuGuard

**Votre réputation, protégée en permanence.**

Surveillance 24h/24 de Google Reviews, Trustpilot et TripAdvisor. Alerte
instantanée sur tout avis négatif, avec une réponse professionnelle
rédigée par IA — prête à publier en un clic sur le vrai compte de
l'entreprise.

🌐 **[repuguard.app](https://repuguard.app)**

</div>

---

## Ce qu'est RepuGuard

RepuGuard est un copilote de réputation pour les commerces locaux —
avocats, dentistes, hôtels, restaurants, médecins, agences. Il surveille
les avis publiés sur Google, Trustpilot et TripAdvisor, génère une
réponse dans le ton du propriétaire, et la publie via l'API officielle
de chaque plateforme une fois validée.

Verticales couvertes : `agences.html`, `avocats.html`, `dentistes.html`,
`hotels.html`, `medecins.html`, `restaurants.html`.

## Pourquoi c'est sûr

- **Aucun scraping.** Uniquement les APIs officielles : Google Places +
  Google Business Profile (OAuth), Trustpilot API, TripAdvisor Content
  API.
- **Le propriétaire reste maître.** Chaque réponse est publiée via le
  jeton OAuth de l'entreprise elle-même — RepuGuard ne se fait jamais
  passer pour un client et ne fabrique aucun avis.
- **Publication automatique limitée aux avis positifs.**
  `auto_respond_5star` est la seule voie de publication non supervisée ;
  tout avis négatif ou neutre reste soumis à validation humaine.
- **Jetons chiffrés.** Le refresh token Google Business Profile est
  chiffré AES-256-GCM en base (`TOKEN_ENCRYPTION_KEY`).

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend | HTML statique + `i18n.js` (9 langues) | Zéro build, déploiement instantané, latence minimale. |
| API | Fonctions serverless Vercel (`api/*.js`, Node ESM) | Un fichier = un endpoint, pas de framework à maintenir. |
| IA — réponses | Claude Haiku 4.5 (appel direct à l'API Anthropic) | Rapide et économique pour des réponses de 2-4 phrases. |
| Données | Supabase (Postgres + RLS) | Accès applicatif via `service_role`, RLS bloque tout accès direct anon. |
| Facturation | Stripe Billing | Essai 7 jours, 3 plans : Starter 29€, Pro 69€, Business 149€. |
| Avis | Google Places/Business Profile, Trustpilot, TripAdvisor — APIs officielles | Voir *Pourquoi c'est sûr*. |
| Email | Resend | Confirmations, alertes, contact. |
| Hébergement | Vercel | Fonctions + cron (`/api/cron-sync` toutes les 6h). |

## Démarrer

Aucune étape terminal n'est requise pour la mise en production — voir
[`DEPLOY.md`](./DEPLOY.md), un parcours 100% tableau de bord (Vercel,
Supabase, Stripe, Google Cloud Console).

Pour tester en local :

```bash
cp .env.example .env.local   # renseigner Supabase, Anthropic, Stripe, Google, Resend
npm install
npx vercel dev                # http://localhost:3000
```

## Feuille de route

- [x] Surveillance Google Reviews, Trustpilot, TripAdvisor
- [x] Génération de réponses IA + publication OAuth Google Business Profile
- [x] Facturation Stripe (essai 7 jours, 3 plans)
- [x] Programme de parrainage (`referral.html`)
- [x] 9 langues (`i18n.js`)
- [ ] Instrumentation PostHog du funnel (signup → connexion GBP → premier avis → première réponse publiée → conversion payante)
- [ ] Programme d'affiliation Tolt sur le parrainage existant
- [ ] CI (lint + vérification de syntaxe des fonctions `api/`)
- [ ] Facebook, Booking.com, Instagram (annoncés en FAQ, pas encore implémentés)

## Licence

Proprietary — © RepuGuard. All rights reserved.
