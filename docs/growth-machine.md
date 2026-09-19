# Machine de validation automatisée

> Zéro conversation. Le système pose la question, mesure la réponse, et
> affiche un verdict sur un seul écran : `/fr/admin/growth`.
>
> Ce qui est construit et déployé est marqué ✅. Ce qui demande une décision
> ou un compte externe est marqué ⬜.

---

## Le déplacement qui rend l'automatisation possible

Un entretien demande ce que quelqu'un **ferait**. Une séquence automatisée ne
peut pas poser six questions ouvertes — le taux de réponse à un courrier froid
tourne autour de 1 à 3 %, et chaque question supplémentaire le divise.

Donc on ne demande plus. **On mesure ce qu'ils font.**

```
message remis → clic → audit commencé → AUDIT TERMINÉ → réponse
```

Un inconnu qui reçoit un e-mail, vient sur le site, dépose son propre document
et attend le résultat a posé le geste d'un client. C'est le seul chiffre qui
répond à la question. Tout ce qui est au-dessus dit où la machine coince.

Ce déplacement est aussi ce qui rend la chose honnête : la préférence déclarée
ne vaut rien à ce stade, et le comportement se mesure sans parler à personne.

---

## Ce qui est déjà en place ✅

| Élément | Où |
|---|---|
| Schéma `outreach_contacts` / `_sends` / `_events` | migration 0032 |
| Redirection traçante première partie | `/api/r/[token]` |
| Désabonnement un clic (RFC 8058) | `/api/outreach/unsubscribe/[token]` |
| Page de fin de désabonnement | `/{locale}/unsubscribed` |
| Attribution audit commencé / terminé | `src/lib/outreach.ts` + route d'audit |
| Tableau de bord et seuils | `/{locale}/admin/growth` |

Quinze tests verrouillent les règles de mesure. Trois d'entre eux existent
parce qu'ils ont d'abord échoué en lisant mes propres commentaires.

**Aucune ouverture n'est mesurée.** Apple Mail Privacy Protection charge toutes
les images de tous les messages avant que l'humain les voie : un « taux
d'ouverture » mesure la proportion d'utilisateurs d'Apple Mail. C'est
exactement le mécanisme qui a brûlé nos liens de connexion pendant des mois.
Non mesuré vaut mieux que mal mesuré.

**Le compte se fait par personne distincte, pas par événement.** Un scanner
d'entreprise qui suit un lien quatre fois est une personne. Compter quatre,
c'est reproduire les 46 « confirmations » qui ont donné quatre organisations.

---

## Ce qu'il te reste à décider ⬜

### 1. L'infrastructure d'envoi — le point bloquant

**Resend ne peut pas porter ça.** Sa politique d'usage vise le transactionnel
et l'opt-in. Une campagne froide expose à la suspension du compte, et ce compte
envoie **les liens de connexion**. Vérifie leurs CGU, puis tranche.

Architecture à mettre en place :

```
lexyflow.com          → Resend, transactionnel uniquement (connexion, rapports)
go.lexyflow.com       → second fournisseur, prospection uniquement
   SPF, DKIM, DMARC propres au sous-domaine
   montée en charge : 20/j la semaine 1, 50/j la 2, 100/j ensuite
```

Deux réputations séparées. Si la prospection se fait blacklister, la connexion
survit. C'est la leçon de la semaine dernière appliquée avant l'incident.

Fournisseur : **Amazon SES** est le choix zéro-budget cohérent — 0,10 $ les
1 000 envois, pas de palier mensuel, et il tolère la prospection B2B conforme.
Brevo et Mailjet conviennent aussi.

### 2. La source des contacts — et c'est le vrai coût caché

« Zéro budget » et « prospection automatisée à grande échelle » ne tiennent pas
ensemble : Apollo, Lemlist et consorts sont payants, et récolter LinkedIn viole
leurs conditions et le RGPD.

**La source légitime et gratuite existe pourtant, et elle est faite pour nous.**

L'article 37(7) du RGPD **oblige** les organismes à publier les coordonnées de
leur DPO. Ces adresses sont publiques *par obligation légale*, et la fonction
de la personne est précisément la conformité — donc notre message porte sur son
métier, ce qui est la condition posée par la CNIL pour la prospection B2B sans
consentement préalable, avec droit d'opposition.

On a déjà tout le nécessaire pour les collecter : `fetchExternal` (protégé
contre le SSRF), `parseListing`, `parseSitemap`. Un collecteur qui lit les pages
« politique de confidentialité » d'un annuaire d'entreprises et en extrait les
`dpo@`, `privacy@`, `dpo-contact@` publiés.

`outreach_contacts.source` et `source_url` existent pour ça : l'article 14 nous
oblige à pouvoir dire d'où vient une adresse. Une ligne sans provenance est
indéfendable.

**Dis-moi si je construis ce collecteur.** C'est une journée de travail et c'est
le seul chemin gratuit que je voie.

### 3. La séquence — trois messages, pas six questions

**Message 1, jour 0.** Texte brut, aucun lien, une seule question.

> Objet : comment auditez-vous vos politiques de confidentialité ?
>
> Bonjour,
>
> Je construis un outil d'audit de conformité et j'essaie de comprendre comment
> ce travail se fait réellement avant d'en construire davantage.
>
> Combien de temps vous prend l'audit d'une politique de confidentialité
> aujourd'hui ?
>
> {signature, adresse postale, lien de désabonnement}

Sans lien : un lien transforme une question en argumentaire. Ce message ne
mesure rien d'autre que la délivrabilité et les réponses.

**Message 2, jour +3.** Le test comportemental — c'est celui qui compte.

> Je ne voulais pas vous déranger davantage, alors voici simplement le résultat
> que produit l'outil sur une politique réelle : {lien /api/r/<token>?to=sample}
>
> Si vous voulez l'essayer sur un de vos documents, c'est sans compte.

**Message 3, jour +7.** Clôture.

> Je referme le sujet de mon côté — si ce n'est pas un problème que vous avez,
> c'est une information utile pour moi. Merci de m'avoir lu.

Une séquence de trois. Au-delà, on n'apprend plus rien et on abîme le domaine.

### 4. Les obligations à respecter dans chaque message

Non négociables, et notre produit vend leur respect :

- identité complète et **adresse postale** de l'expéditeur
- lien de désabonnement visible, plus l'en-tête `List-Unsubscribe` avec
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- mention de l'origine de l'adresse (art. 14) — « publiée sur le site de votre
  organisation au titre de l'article 37(7) »
- aucun envoi à une adresse nominative grand public : uniquement fonction
  professionnelle
- opposition honorée immédiatement et définitivement — c'est déjà le cas côté
  code

---

## Où Make sert, et où il ne sert pas

**Il ne sert pas** à l'envoi ni à la planification : Vercel Cron, Postgres et
notre code font déjà ça, gratuitement, avec les tests qui vont avec. Ajouter
Make là serait une dépendance payante pour un `setInterval`.

**Il sert à une chose que nous n'avons pas : recevoir les réponses.**

```
Boîte go@lexyflow.com  (IMAP)
        │
        ▼
Make — déclencheur « Watch Emails »
        │
        ├─ extrait : expéditeur, sujet, corps
        │
        ▼
POST https://lexyflow.com/api/outreach/reply
        en-tête  x-outreach-secret: <secret partagé>
        corps    { from, subject, body }
```

L'endpoint `/api/outreach/reply` reste à écrire : il retrouve le contact par
l'adresse, enregistre un événement `replied`, et classe la réponse en
`intéressé` / `pas intéressé` / `désabonnement` avec un appel modèle court.

**Point que je dois signaler** : une réponse humaine sans réponse en retour est
pire que pas d'e-mail du tout. La classification automatique te dit *qu'il faut*
répondre ; quelqu'un devra le faire. C'est la seule part de la boucle qui ne
s'automatise pas sans coûter la réputation qu'elle construit.

---

## Le verdict, écrit avant les données

Affiché sur `/fr/admin/growth`, en dur dans la page, pour qu'un chiffre
décevant ne puisse pas être réinterprété après coup.

| Sur 200 contactés | Conclusion |
|---|---|
| **6 audits terminés ou plus** | marché réel — la question devient le prix |
| **2 à 5** | signal faible : changer de cible ou de message, pas le produit |
| **0 ou 1** | personne n'en veut sous cette forme |

En dessous de 200 contactés, la page refuse de conclure : un audit terminé sur
trente est du hasard.

Le troisième cas est un résultat. Il coûte deux semaines, là où l'apprendre par
le SEO en coûterait six mois.
