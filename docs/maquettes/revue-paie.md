# Revue de la paie : le comptable, puis l'entreprise (01/11/2026)

Demandée par Skander le 01/11/2026 : « lis la paie de l'entreprise, fais une revue de la paie à la place d'un comptable et
d'une boîte avant de livrer les deux maquettes ». Lu : l'écran Paie de l'entreprise tel qu'il est dans la plateforme
(`web/public/v10/app.js` : `routes.paie`, ses 8 onglets, `payslipForm`, `payerSalairesFenetre`, `journalDePaieFenetre`,
`routes.salarie` ; `compta.js` : le plan de comptes et l'écriture de paie), et la maquette Paie du Cabinet
(`cabinet/comptabilite.html`). L'exemple est le même des deux côtés : Boulangerie El Amal, 5 salariés, octobre 2026.

Ce qui est fiscal ou social et pas sûr reste **À VÉRIFIER** avec un comptable.

## 1. À la place du comptable (Anis, Jlassi Conseil)

| # | Ce que je vois | Pourquoi ça gêne un comptable | Ce que les maquettes font |
|---|---|---|---|
| C1 | L'écriture de paie crédite le **425** du net **plus** l'avance retenue (4 176,400), alors que le virement des salaires est de 4 076,400. | Le 425 (rémunérations dues) ne se solde pas avec le virement « VIR SALAIRE » : il reste 100,000 qui appartiennent à l'avance d'Hamza. Une avance au personnel a son compte (**421 Personnel, avances et acomptes** dans le plan tunisien, À VÉRIFIER) : débité quand on la verse, crédité par chaque retenue. | Cabinet : une ligne **421** au crédit (100,000, la retenue d'Hamza) et le 425 au net seul (4 076,400) ; l'avance se passe au 421. Septembre suit la même règle. |
| C2 | Dans `compta.js`, **421 et 425 portent le même libellé** (« rémunérations dues »). | Deux comptes, un nom : la balance devient illisible, et l'avance peut atterrir au mauvais endroit. | À corriger dans l'application (421 = avances et acomptes, À VÉRIFIER). Noté pour le lot qui appliquera la maquette. |
| C3 | Côté entreprise, un bulletin **remis et payé reste modifiable et supprimable** (seule une période clôturée l'arrête). | Un bulletin remis à un salarié est un document : il ne change plus. Une erreur se corrige par un **bulletin rectificatif**, daté, et l'écriture suit. | Les deux maquettes : « préparés » (on corrige librement) → « validés » (figés, l'écriture passe) → rectificatif pour corriger. |
| C4 | Rien ne vérifie qu'un salaire ne passe **sous le minimum légal** (SMIG). | C'est le premier contrôle d'un comptable sur une entrée ou un prorata. | Le bulletin dit ce qui a été contrôlé : au-dessus du SMIG (montant 2026 : À VÉRIFIER), taux du dossier, pointage repris. |
| C5 | Les **congés acquis et pas pris** n'apparaissent nulle part en fin d'année. | À la clôture, c'est une dette envers les salariés (À VÉRIFIER : la pratique du cabinet pour la provision). | Cabinet, « L'année » : 38 jours restants au 31/10, chiffrés à la clôture. |
| C6 | Salma Ayari n'a pas de RIB : son salaire part « à part », sans trace. | Un salaire payé en espèces doit avoir son reçu signé, sinon la caisse ne se justifie pas. | Entreprise : « payée en espèces, contre reçu signé » (le reçu en PDF) ; Cabinet : la carte des salaires le dit. |
| C7 | Le mode « le client fait sa paie, le cabinet vérifie » disait « faits par Sarra le **30/10** » alors que la page se passe le **28/10**. | Une date dans le futur ruine la confiance dans tout le reste. | Corrigé : le 27/10. |
| C8 | La TFP est à 2 % pour tout le monde. | Le taux dépend de l'activité (À VÉRIFIER : taux réduit pour certaines industries). | Déjà réglable par dossier (P8) ; la maquette le dit sur le bulletin. |
| C9 | L'échéance de la déclaration mensuelle est le **28** pour une société, le **15** pour une personne physique (À VÉRIFIER). | Une mauvaise date fait une pénalité. | Déjà « la date de ce dossier » dans les deux maquettes. |

Ce qui est **bien** et qu'on garde : le calcul expliqué (« Pourquoi 172,908 d'IRPP ? »), le contrôle « deux chemins, un
chiffre » entre les bulletins et le livre, le fichier CNSS qui refuse de sortir avec une ligne fausse, l'ordre de
virement avec les RIB contrôlés, l'avance qui se retient toute seule mois après mois.

## 2. À la place de l'entreprise (Sarra, la gérante de la boulangerie)

| # | Ce que je vois aujourd'hui | Ce que ça me coûte | Ce que la maquette de l'entreprise fait |
|---|---|---|---|
| E1 | Huit onglets : Bulletins, Pointage, Salariés, Congés et absences, Avances, Déclarations, Registre, Barèmes. | Je ne sais pas par où commencer chaque mois. | Cinq vues, les mêmes que le Cabinet (Le mois, Salariés, Congés et avances, Déclarations, L'année) ; le registre et les réglages dans le menu ⋯. |
| E2 | Le mois est éparpillé : pointer dans un onglet, établir dans un autre, payer dans une fenêtre, déclarer ailleurs. | J'oublie une étape. | Une frise du mois : **Pointer → Bulletins → Payer → Remettre → Déclarer**, avec un seul bouton principal, l'étape suivante. |
| E3 | En haut, les chiffres de **l'année** ; en dessous, le tableau **du mois**. | Deux chiffres qui ne parlent pas de la même chose. | Les chiffres du mois, et ce qui a changé depuis septembre. |
| E4 | Rien ne me dit **combien la paie va sortir de mon compte, et quand**. | Je découvre la CNSS du trimestre le jour où il faut la payer. | « Ce que la paie sort de ta caisse » : les nets le 31/10, les retenues et taxes le 28/11, la CNSS du trimestre en janvier, chacun avec son montant. |
| E5 | Si le cabinet tient ma paie, l'écran me laisse quand même établir et modifier les bulletins. | Deux personnes sur le même bulletin. | Deux façons de faire, dites en haut : « tenue par ton cabinet » (je pointe, je paie, je remets ; il prépare et valide) ou « je la fais » (il vérifie et me signale ce qui ne va pas, avec le bouton pour corriger). |
| E6 | Les bulletins se sortent en PDF un par un. | Cinq clics, cinq fichiers, chaque mois. | « Remettre les bulletins » : les 5 d'un coup, à imprimer ou à envoyer par e-mail à chacun (À VÉRIFIER : la remise électronique). |
| E7 | Le CDD d'Hamza finit le 31/12 et rien ne le dit. | Je le découvre le 2 janvier. | Un bandeau deux mois avant : renouveler, ou préparer sa sortie (solde de tout compte, attestation). |
| E8 | Le pointage est une grande grille ; au téléphone, elle ne sert à rien. | Je pointe le soir, de mémoire. | Au téléphone : « Aujourd'hui, qui n'est pas là ? » ; la grille du mois reste à l'ordinateur. |
| E9 | Des mots de métier : « Établir », « Barèmes », « assiette ». | Je n'ose pas toucher. | « Préparer », « Réglages de la paie », et une bulle « i » sur chaque mot qu'on ne peut pas éviter. |

## 3. Ce que les deux maquettes doivent dire pareil

Le même exemple, les mêmes montants au millime (brut 5 027,405, net 4 076,400, coût 6 056,515), les mêmes étapes, et la
même règle : celui qui ne tient pas la paie ne la modifie pas, il la signale. La page de l'entreprise le vérifie elle-même,
en bas, comme celle du Cabinet.

## 4. Ce que font les logiciels de paie, et ce qu'on en prend (01/11/2026)

Skander : « les états de la paie manquent beaucoup de métier : regarde ce que font les autres ». Regardé : les outils
français pour cabinets et PME (Silae, PayFit), les modules tunisiens d'Odoo (paie, déclaration CNSS), des guides de paie
tunisienne. Ce sont des pages commerciales et des guides : la pratique, pas la loi.

Le cycle qu'ils suivent tous : **collecter les éléments du mois** (absences, primes, heures sup, avances) → **calculer** →
**contrôler** (les écarts sur le mois d'avant, les anomalies) → **faire valider par l'employeur** (le « bon à payer »)
→ **clôturer** (bulletins définitifs) → **payer** (fichier de virement) → **déclarer** → **écrire en comptabilité**. Une
erreur après clôture se corrige en rouvrant la paie, jamais en effaçant.

| # | Ce qui manquait | Ce que les deux maquettes font maintenant |
|---|---|---|
| M1 | Le **bon à payer** : l'entreprise approuve les bulletins préparés par le cabinet avant de payer. | Entreprise : étape « Bon à payer » (« J'approuve les 5 bulletins », ou « Demander une correction »). Cabinet : « Envoyer à Sarra pour accord », puis « Valider » une fois approuvés. |
| M2 | Les **contrôles avant validation**. | 12 contrôles écrits (SMIG, net, écarts de plus de 5 % expliqués, férié, pointage, avance, prorata, heures sup, taux 2026, contrats, n° CNSS, RIB), ceux qui demandent un geste en tête. |
| M3 | **Corriger avec l'accord du client** (décision de Skander, 01/11/2026). | Cabinet : « Proposer la correction à Sarra » (avant, après), puis « En attente de Sarra ». Entreprise : « Accepter la correction d'Anis » ou « Refuser, je m'en occupe » ; acceptée, la trace reste. |
| M4 | Les **jours fériés** : le 15/10 est férié en 2026 (Fête de l'Évacuation), et la maquette y mettait l'absence sans solde de Nadia. | Le 15/10 marqué « férié » dans les deux grilles ; l'absence de Nadia passe aux 16 et 17/10 (les montants ne changent pas). Chômé et payé : À VÉRIFIER. |
| M5 | **L'arrivée** d'un salarié. | Fiche de Salma, onglet « Son arrivée » : contrat, CIN, registre, n° CNSS, RIB, période d'essai, visite médicale ; le CIVP (l'ancien SIVP, À VÉRIFIER). |
| M6 | **Le départ** : dernier bulletin et solde de tout compte. | Hamza (CDD au 31/12) : salaire, 18 jours de congés pas pris (567,692, À VÉRIFIER : la règle), indemnité selon la convention, certificat, reçu, attestation, sortie CNSS. Mêmes chiffres des deux côtés. |
| M7 | Le **rappel de salaire** (une augmentation qui compte depuis un mois passé). | Exemple à + 5 % depuis le 01/05 : 1 237,500 de rappel, salarié par salarié, sur le bulletin de novembre. Taux et date : ceux de l'accord publié, jamais inventés. |
| M8 | **Combien coûte une embauche**. | Sur le bulletin réel d'Hamza : net 699,807, coût 987,854 par mois, 11 854,248 par an. |
| M9 | La **fin d'année**. | Prime de fin d'année (si la convention la prévoit), attestations de salaires, congés reportés, déclaration annuelle ; côté cabinet, le nombre de bulletins de l'année (41), que la lettre de mission facture. |

Restent pour plus tard : l'espace du salarié (ses bulletins, ses demandes de congé au téléphone), la paie de tous les
dossiers d'un cabinet sur une page, les arrêts maladie et la CNAM, les saisies sur salaire. Taux CNSS du salarié : les
sources disent 9,18 % ou 9,68 % selon l'année ; À VÉRIFIER avant d'écrire un chiffre.

Sources : [Silae, plaquette expert-comptable](https://www.silae.fr/wp-content/uploads/Plaquette_Silae_Paie-Expert-Comptable.pdf),
[PayFit, clôture de paie](https://payfit.com/fr/fiches-pratiques/cloture-de-paie/),
[Odoo, paie tunisienne](https://apps.odoo.com/apps/modules/18.0/l10n_tn_payroll),
[Odoo, déclaration CNSS](https://apps.odoo.com/apps/modules/18.0/cnss_declaration),
[Jours fériés 2025-2026](https://www.tuniscope.com/article/415154/actualites/tunisie/tunisie-calendrier-officiel-des-jours-feries-2025-2026-142010),
[Le SIVP devient CIVP](https://kapitalis.com/tunisie/?p=246024).

## 5. Décidé

- 01/11/2026 : quand le client fait sa paie, **le cabinet la corrige avec son accord** (Skander). Écrit au journal du
  cadrage (`docs/cadrage/README.md`).
