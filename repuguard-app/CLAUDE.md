# RepuGuard V2 — règles du projet

Reprend intégralement les règles de LexyFlow (CLAUDE.md de repuguardapp/repuguard),
qui s'appliquent sans exception à ce dépôt également.

## Règle d'or : rien de faux ne sort d'ici

Nous affichons des avis réels de vraies plateformes. Pas de note inventée,
pas de score calculé sur des données absentes, pas de « succès » affiché sur
une plateforme non connectée.

## Conventions du dépôt

- Français dans l'interface d'administration. Anglais dans le code et les commits.
- Cinq langues côté public : fr, en, es, de, pt-br.
- Les migrations vivent dans `supabase/migrations/` et sont numérotées.
  Une migration appliquée en production doit exister dans le dépôt.
- `npx tsc --noEmit` et `npx vitest run` doivent passer avant tout commit.

## Décisions d'architecture (immuables sauf PR discutée)

- Auth : Supabase SSR cookies uniquement. Jamais localStorage.
- service_role : uniquement dans les routes API serveur et les crons. Jamais côté client.
- Billing : la table `subscriptions` est la seule source de vérité. Jamais `organizations`.
- `is_negative` : `rating <= 3` (colonne générée en DB, pas calculée en JS).
- Plans : Starter / Pro / Business. Limites lues depuis la table `plans`.
