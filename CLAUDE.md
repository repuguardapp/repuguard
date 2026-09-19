# LexyFlow — règles du projet

## Règle d'or : rien de faux ne sort d'ici

**Le mensonge et la triche sont bannis, sans exception et sans cas limite.**

Nous vendons de la conformité légale. Une seule donnée inventée — dans une
balise, dans un rapport, dans un tableau de bord, dans une ligne de base —
détruit la seule chose que nous vendons. Ce n'est pas une préférence de style :
c'est la condition de survie de l'entreprise.

Concrètement, dans chaque ligne de code :

**Ne jamais inventer une donnée pour satisfaire un format.** Google a demandé
des champs `review` et `aggregateRating` sur notre balisage produit. Les
fournir aurait voulu dire fabriquer des avis. Nous avons retiré le balisage.
Quand un outil réclame une donnée que nous n'avons pas, la réponse est de
retirer l'affirmation, jamais de la remplir.

**Ne jamais affirmer un fait sans sa source et sa date.** Toute chose publiée
sur le site porte l'URL primaire d'où elle vient. Un montant, une date, un
article cité : si nous ne pouvons pas montrer d'où ça sort, ça ne se publie
pas. Le bac à sable de développement n'atteint aucun domaine de régulateur,
donc rien qui n'a pas été vérifié ne doit être présenté comme vérifié — une
source est une « candidate » tant que la machine ne l'a pas confirmée.

**Ne jamais porter de jugement sur un tiers nommé.** Nous publions ce qu'une
autorité a décidé, pas ce que nous en pensons. « L'entité X a été sanctionnée
de N euros le D, source : URL » est un fait. « X est non conforme » est une
accusation, et elle est diffamatoire si elle est fausse. Les faits ne sont pas
protégeables par le droit d'auteur ; les paragraphes d'un régulateur le sont.
Nous prenons les premiers, jamais les seconds.

**Ne jamais mesurer de travers plutôt que de ne pas mesurer.** Un pixel
d'ouverture d'e-mail mesure la proportion d'utilisateurs d'Apple Mail, pas
l'intérêt. Un `ok` qui signifie « au moins un élément » a laissé le Royaume-Uni
vert pendant des mois sur un lien d'accessibilité. Un chiffre faux est pire que
pas de chiffre : il produit des décisions confiantes et fausses. En cas de
doute, ne rien afficher.

**Ne jamais laisser une absence passer pour un succès.** Un travail qui échoue
doit le dire, nommément, une fois. Un instrument qui ne rapporte que les
réussites est un instrument pour les pannes qu'on avait déjà comprises.

**Se corriger à voix haute.** Quand une donnée contredit ce que j'ai affirmé,
je retire mon affirmation explicitement, y compris si je l'ai répétée. La
recommandation de relancer « 123 prospects » est morte le jour où la base a
montré que la liste contenait la boîte d'assignations juridiques de Valve.

## Conséquences techniques permanentes

- Toute donnée publiée est traçable à une URL primaire et à un horodatage.
- Toute extraction automatique passe par une relecture humaine avant publication.
- Un champ que nous ne pouvons pas remplir honnêtement reste vide ou disparaît.
- Un test qui vérifie une règle d'intégrité ne se contourne pas : il se discute.
- Le RGPD s'applique à nous d'abord. Pas de cookie de mesure pour notre propre
  marketing, pas de tiers dans le chemin des données de nos prospects, pas
  d'adresse dans une URL, opposition honorée immédiatement et définitivement.

## Conventions du dépôt

- Français dans l'interface d'administration (un seul opérateur, il lit le
  français). Anglais dans le code, les commentaires et les messages de commit.
- Sept langues côté public : en, fr, es, de, pt-br, ja, ar. L'arabe est en RTL.
- Les migrations vivent dans `supabase/migrations/` et sont numérotées. Une
  migration appliquée à la production doit exister dans le dépôt, sinon la base
  n'est plus reconstructible depuis la source.
- `npx tsc --noEmit` et `npx vitest run` doivent passer avant tout commit.
