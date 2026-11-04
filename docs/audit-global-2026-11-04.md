# Audit global de SkanFact — rapport pour le développement

Date : **4 novembre 2026**. Dépôt : **saouthq/skanfact-plateforme**. Branche : **dev**. Référence examinée : **95d67eb64d1256dd4bc1fcf65a6a07856752f826**, commit du 4 novembre à 09:00 UTC, paquet **1.266.14**.

## 1. Décision proposée

**Ne pas ouvrir cette version à des données réelles sans corriger les défauts graves de ce rapport.** Les contrôles de types, le lint et la construction réussissent, mais des requêtes valides contournent encore des règles métier et de confidentialité.

Les trois premiers problèmes à traiter sont :

1. Une facture émise peut être transformée en devis puis supprimée du dossier visible, alors que sa pièce juridique reste émise au serveur.
2. Un commercial peut recevoir le salaire et des informations de saisie sur salaire dans les archives de conflits, même si les fiches de paie lui sont interdites.
3. L’espace client retire des champs nécessaires au calcul d’une facture et peut afficher une édition différente de la facture originale.

Le registre comprend **20 constats priorisés**, de niveaux de preuve différents. L’audit constate également des problèmes de répartition des remises, de verrouillage et de doublons en paie, de régularisation négative, de rappel de salaire, de temps partiel et de congés. Côté exploitation : occupation du pool PostgreSQL pendant des appels externes, partage des ressources lourdes, procédure de reprise du coffre, sélection d’une sauvegarde PITR et installation dans le répertoire actif.

**Ce rapport couvre les aspects du projet, mais ne constitue pas une lecture exhaustive de chacune des 1 537 entrées du dépôt.** Les parcours critiques ont été suivis dans le code et soumis à des sondes. Les limites et les domaines restant à contrôler sont détaillés en fin de document. Une absence de constat dans un domaine ne signifie pas qu’il est certifié sans défaut.

## 2. Conditions de la revue

- Dernière tête de `dev` récupérée au début de cette session. `main`, récupérée également, est plus ancienne : `e596a5fd94fed690e8d4bb3a01a94d3b052a62ea`. La revue porte sur `dev`, pas sur la version effectivement déployée en production.
- Copie isolée du commit dans `/tmp/skanfact-review-20261104`. Le checkout original est resté intact.
- PostgreSQL 16 de test, accessible seulement en local, sans données réelles ; navigateur Chromium pour les parcours web.
- Aucun changement applicatif, aucune migration de production et aucun accès aux infrastructures déployées.
- Les sondes ont été créées dans la copie temporaire. Le présent document est le livrable à transmettre à Claude.
- Les fichiers sous `modules/` sont désormais les sources de plusieurs écrans et moteurs. `commun/assemblage.ts` et `modules/assemblage.json` produisent les fichiers servis. **Ne pas corriger des archives `web/v10/*.txt` ni des fichiers assemblés générés.**

### Niveaux de preuve

- **Reproduit** : comportement exécuté dans une sonde locale, avec résultat observé.
- **Code** : chemin établi par lecture ; son scénario complet n’a pas été joué en conditions réelles.
- **Lacune de procédure** : le dépôt ne traite pas une dépendance opérationnelle ; une mesure externe peut exister, mais n’a pas été vérifiée.
- **À valider** : décision légale, conventionnelle, contractuelle ou résultat dépendant du déploiement.

Les gravités désignent l’impact métier : **grave**, **moyen**, **mineur**. Elles ne remplacent pas un score CVSS. Les correctifs proposés sont des critères de résultat ; Claude doit choisir une implémentation compatible avec les règles du dépôt.

## 3. Registre des constats

| ID | Gravité | Domaine | Constat | Preuve |
|---|---|---|---|---|
| G01 | Grave | Ventes, intégrité | Contournement de l’immutabilité d’une facture par changement de type | Reproduit, API et base |
| G02 | Grave | Confidentialité | Salaire et saisies accessibles au commercial via les conflits | Reproduit, API |
| G03 | Grave | Espace client | Facture partagée recalculée sans remise de ligne ni FODEC | Reproduit, moteur et filtre de sortie |
| G04 | Moyen | Argent | Bases de TVA après remise ne conservant pas le HT total | Reproduit, moteur entier |
| G05 | Grave | Paie | Bulletin payé et marqué validé encore modifiable | Reproduit, API |
| G06 | Grave | Paie | Deux bulletins ordinaires pour un salarié et un mois | Reproduit, API |
| G07 | Grave | Paie | Régularisation négative refusée à l’enregistrement | Reproduit, API |
| G08 | Grave | Paie | Rappel incorrect après augmentation sur un mois proratisé | Reproduit sur les arguments du chemin de calcul |
| G09 | Grave | Personnel | Base horaire individuelle ignorée dans les heures supplémentaires | Reproduit, moteur ; règle contractuelle à préciser |
| G10 | Moyen | Congés | Congé décompté deux fois au changement d’année | Reproduit, moteur |
| G11 | Grave | Disponibilité | Connexion SQL retenue pendant les longues lectures IA | Code ; charge non exécutée |
| G12 | Moyen | Disponibilité | Ressources PDF et routes authentifiées sans quota utilisateur | Code ; attaque non exécutée |
| G13 | Grave | Reprise d’activité | Restauration des clés du coffre absente du parcours documenté | Lacune de procédure, conditionnelle à la perte de la clé |
| G14 | Moyen | PITR | Sélection de la copie par son début plutôt que sa fin | Code ; restauration de ce cas non exécutée |
| G15 | Moyen | Déploiement | Code et dépendances remplacés sous le serveur actif | Code ; déploiement réel non exécuté |
| G16 | Moyen | Dépendances | Alertes de sécurité de dépendances de production | Résultat npm audit ; exploitabilité non établie |
| G17 | Mineur | Documentation et CI | Le test des références documentaires échoue sur trois chemins | Échec observé et vérifié par lecture |
| G18 | Mineur | Ergonomie mobile | Cible tactile de tri sous le seuil de 44 px du projet | Mesure du test navigateur |
| G19 | Moyen | Performance | Première ouverture au-dessus du budget de transfert | Mesure de 1 389 Kio contre 1 300 Kio |
| G20 | Mineur | Tests | Assertion de recette cassée par une majuscule de libellé | Trace navigateur explicite |

## 4. Défauts détaillés et recettes de correction

### G01 — Une facture émise peut devenir un devis puis disparaître

**Gravité : grave. Reproduit.**

**Emplacement :** [serveur/v10/dossier.ts:68](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/dossier.ts#L68), fonction `verifierPiece`, et [serveur/v10/dossier.ts:208](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/dossier.ts#L208), fonction `appliquer`.

Le contrôle choisit le type dans le contenu **après** modification. Si ce nouveau type n’est ni `facture` ni `avoir`, il retourne avant d’examiner le statut émis et les champs scellés du document précédent. La suppression ultérieure est alors traitée comme celle d’un document non légal.

**Scénario exécuté :**

1. Créer et émettre une facture `f1` au net de 1 073,190 DT par la route officielle d’émission.
2. Relire sa révision.
3. Envoyer sur la route de sauvegarde du dossier le même identifiant avec `type: 'devis'`, `status: 'brouillon'`, `number: ''` et `lines: []`.
4. Supprimer ce document en utilisant sa nouvelle révision.

**Résultat :** modification HTTP **200**, suppression HTTP **200**. La table `ventes.piece` contient toujours une pièce `emise`, numéro `1`, tandis que son document a disparu du dossier.

**Impact :** perte de cohérence entre interface, document légal et comptabilité ; possibilité de faire disparaître une facture du parcours normal sans avoir correctif. Le test ne démontre pas la suppression de la pièce juridique ni la modification en place d’une écriture validée.

**Correction attendue :** juger d’abord la nature et l’état **antérieurs** ; une pièce émise ne change pas de nature et ne disparaît pas. Vérifier aussi les autres routes d’écriture et les contenus non objets. Maintenir les références du dossier et des tables juridiques dans la même transaction.

**Recette :** facture et avoir émis → chaque autre type, type absent, contenu non objet, suppression, modification de numéro et import. Tous les contournements doivent être refusés sans écriture partielle. Une correction autorisée passe par le parcours prévu et reste reliée à l’original.

### G02 — Les archives de conflits divulguent la paie au commercial

**Gravité : grave. Reproduit.**

**Emplacements :** [serveur/v10/droits.ts:61](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/droits.ts#L61), règles `TECHNIQUE` et `conflictArchive` ; [serveur/paie/identite.ts:30](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/paie/identite.ts#L30), `sansIdentite` ; [serveur/v10/dossier.ts:228](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/dossier.ts#L228), filtrage à l’écriture.

`conflictArchive` est une partie technique lisible plus largement que `employees`. Le nettoyage récent retire la CIN et le RIB du `record` d’un salarié, mais conserve notamment son nom, son salaire et ses saisies. Une restriction sur la collection principale ne protège donc pas les copies de cette collection.

**Scénario exécuté :** le propriétaire enregistre une archive au format `kind: 'employees'`, `record: { name, grossSalary: 7345, saisies: [...] }`. Un membre uniquement `commercial` charge ensuite le dossier.

**Résultat :** HTTP **200** ; sa réponse contient le nom `SALARIE_CONFIDENTIEL`, le salaire **7 345 DT**, ainsi que le créancier et le montant d’une saisie. La CIN et le RIB ont été retirés, ce qui confirme un filtrage seulement partiel.

**Impact :** violation des droits de paie au sein d’une entreprise. **Cette sonde ne démontre pas une fuite d’une entreprise vers une autre.**

**Correction attendue :** appliquer à chaque archive les droits de la donnée d’origine, ou séparer les archives par périmètre. Nettoyer aussi les anciennes archives à la lecture et les caches locaux. Éviter une simple liste de deux champs confidentiels : santé, famille, notes et rémunérations peuvent également être sensibles.

**Recette :** archives de salariés, bulletins, absences médicales et documents commerciaux ; collection et variante racine ; lecture initiale, différentielle, export, cache hors ligne et changement de rôle. Un rôle privé de la source doit aussi être privé de toutes ses copies.

### G03 — La facture de l’espace client peut porter un autre montant

**Gravité : grave. Reproduit sur le filtre de sortie et le moteur utilisés par l’espace.**

**Emplacements :** [serveur/ventes/espace.ts:28](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/ventes/espace.ts#L28), `CHAMPS_PIECE` et `CHAMPS_LIGNE`, puis [serveur/ventes/espace.ts:47](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/ventes/espace.ts#L47), `nettoyerPiece` ; [web/public/espace/espace.js:170](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/web/public/espace/espace.js#L170), génération du document.

La liste fermée de champs protège utilement les données internes, mais n’a pas suivi tous les nouveaux paramètres de calcul. Elle retire notamment `lines[].discount`, `lines[].fodec` et `fodecRate`. Le document partagé est ensuite recalculé par le gabarit à partir de ce contenu incomplet. `prixTtc` est également absent de la liste et nécessite une recette spécifique.

**Exemple exécuté :** une ligne de 100 DT HT, TVA 19 %, remise de ligne 10 %, FODEC paramétrée à 1 %, sans timbre. Le moteur sur la pièce complète calcule **108,171 DT**. Après `nettoyerPiece`, il calcule **119 DT** et la FODEC a disparu.

**Impact :** l’édition/PDF consultée par le client peut contredire la facture d’origine et le reste à payer calculé sur les données serveur. Le paiement peut donc être présenté à côté d’une pièce portant un autre total.

**Correction attendue :** compléter le contrat de sortie avec tous les champs publics nécessaires au calcul et au rendu, tout en conservant l’exclusion des coûts et notes internes. Mieux : formaliser un contrat de document émis, versionné et validé sur les montants scellés.

**Recette :** comparer les totaux et le contenu de la pièce originale et de son espace client : remise de ligne/globale, FODEC, TTC, acompte, exonération, devise, avoir et titres de section. Un champ ajouté au calcul doit déclencher la revue de ce contrat de sortie.

### G04 — La répartition de remise ne conserve pas les bases de TVA

**Gravité : moyen. Reproduit.**

**Emplacements :** [moteur/piece.ts:134](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/moteur/piece.ts#L134), répartition proportionnelle arrondie par ligne ; calcul parallèle dans [modules/socle/moteur/core-1.js:1563](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/socle/moteur/core-1.js#L1563).

La remise totale est calculée une fois, mais sa répartition est arrondie indépendamment sur chaque ligne. Le reliquat d’arrondi n’est pas redistribué. La somme des bases remisées peut donc différer du HT net de la pièce, hors FODEC.

**Exemple exécuté en entiers :** 100 lignes à 0,101 DT HT, remise globale de 50 %, TVA 19 %. Résultats du moteur :

- HT net : **5 050 millimes** ;
- somme des bases de TVA : **5 100 millimes** ;
- TVA : **1 000 millimes**, soit le cumul des arrondis du chemin actuel.

Les deux premiers montants devraient se rapprocher selon une règle d’allocation définie. Une parité navigateur/serveur ne suffit pas : ils peuvent partager le même défaut.

**Correction attendue :** définir la règle d’allocation et d’arrondi avec le métier, puis répartir exactement le montant de remise, y compris son reliquat, par ligne ou par taux selon cette règle. Conserver le calcul en entiers.

**Recette :** invariants de conservation, plusieurs taux, nombreuses petites lignes, lignes exclues de remise, TTC, FODEC et avoir. Ne pas accepter un simple écart toléré sur le total sans expliquer le rapprochement des assiettes.

### G05 — Un bulletin payé et marqué validé reste réinscriptible

**Gravité : grave. Reproduit.**

**Emplacements :** [serveur/v10/paie.ts:184](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/paie.ts#L184), `tenirBulletin`, en particulier la mise à jour du bulletin existant ; [serveur/paie/gestes.ts:24](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/paie/gestes.ts#L24), autorisation générale d’écriture du dossier.

Le serveur recalcule l’arithmétique mais n’impose pas, dans ce chemin, l’immutabilité d’un bulletin payé ou marqué validé. Une égalité des calculs ne vérifie ni l’autorisation de cette transition ni l’accord portant sur le contenu précédent.

**Scénario exécuté :** enregistrer un bulletin d’octobre portant `paidDate: '2026-10-30'` et `valideLe: '2026-10-29'`. Envoyer le même bulletin avec un brut modifié à 2 000 DT et un nouveau calcul cohérent. **HTTP 200**.

La sonde agit en propriétaire autorisé à la paie ; elle démontre une protection métier manquante, pas un accès extérieur. Les marques de validation ont été transmises par la sonde ; une validation réelle par le Cabinet reste à rejouer dans la recette complète.

**Correction attendue :** états, transitions et auteurs imposés au serveur ; contenu approuvé lié à une version ou une empreinte ; correction explicite et conservation de l’original. Étendre la recette à la suppression et à toutes les routes Cabinet.

**Recette :** changement après accord, validation, paiement, remise et clôture ; ne pas se limiter aux boutons masqués. Préserver la correction des écritures validées par contre-passation, déjà prévue par la comptabilité.

### G06 — Deux bulletins ordinaires pour le même salarié et mois

**Gravité : grave. Reproduit.**

**Emplacements :** [base/migrations/0014_paie.sql:102](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/base/migrations/0014_paie.sql#L102), index sur la référence technique ; [serveur/v10/paie.ts:209](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/paie.ts#L209), création d’un bulletin.

Deux identifiants différents peuvent représenter la même paie mensuelle. Le filtre des bulletins manquants dans l’écran n’impose pas une unicité transactionnelle.

**Scénario exécuté :** après création d’un bulletin pour le salarié `x`, octobre 2026, créer une seconde référence `b2` pour ce même salarié et cette même période. **HTTP 200** pour le deuxième bulletin.

**Impact :** doublage des salaires et cotisations dans les agrégats, puis risque de double paiement. Deux postes générant le même mois constituent un déclencheur plausible ; la concurrence simultanée n’a pas été jouée dans cette sonde.

**Correction attendue :** définir et imposer l’unicité du bulletin principal. Si plusieurs bulletins sont permis, qualifier et relier les compléments/rectificatifs, avec des règles de cumul explicites.

**Recette :** deux créations concurrentes, import, reprise réseau et nouvelle tentative ; un seul salaire principal doit subsister.

### G07 — La régularisation négative reste refusée au serveur

**Gravité : grave. Reproduit.**

**Emplacements :** [serveur/v10/paie.ts:135](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/v10/paie.ts#L135), lecture des éléments ; parcours de régularisation dans [modules/personnel/ecrans/entreprise/paie.js:49](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/personnel/ecrans/entreprise/paie.js#L49).

Le parcours du trop-perçu crée une prime négative, comprise par le moteur client. Le serveur refuse les primes négatives lors de la validation du bulletin.

**Scénario exécuté :** prime de régularisation de **−12,500 DT**, net final positif. **HTTP 403** : « une prime ou une retenue illisible […] rien n’a été enregistré ».

**Correction attendue :** une rubrique de régularisation signée avec période d’origine et effets sociaux/fiscaux définis, cohérente dans l’écran, le moteur, l’API et les livres. Ne pas remplacer automatiquement une correction de brut par une retenue nette.

**Recette :** régularisations positives et négatives, bulletin à créer ou existant, rechargement après sauvegarde, net insuffisant, période déjà déclarée et annulation.

### G08 — Rappel de salaire trop élevé sur un mois proratisé avec absence

**Gravité : grave. Reproduit sur les paramètres transmis au moteur par ce chemin.**

**Emplacement :** [modules/personnel/ecrans/entreprise/paie.js:113](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/personnel/ecrans/entreprise/paie.js#L113), `calculRappel`, notamment la construction de `c1` ; prorata dans [modules/personnel/moteur/compta-paie.js:175](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/personnel/moteur/compta-paie.js#L175).

Le nouveau brut proratisé est calculé, mais l’ancien objet `prorata` est conservé pour les bulletins tenus/payés. Le moteur n’identifie plus un prorata cohérent et retire l’absence sur une mauvaise base. Cette fonction sert aussi aux augmentations en lot.

**Exemple :** salaire 1 300 DT, 14 jours contractuels sur 26, brut proratisé 700 DT, deux jours d’absence : brut initial 600 DT. Après augmentation rétroactive à 1 400 DT, la construction actuelle donne **695,858 DT**, contre **646,154 DT** avec un prorata actualisé. Rappel : **95,858 DT** au lieu de **46,154 DT**, soit **49,704 DT de trop en brut**.

**Correction attendue :** reconstruire une situation historique cohérente avant chaque calcul différentiel. Vérifier aussi les rappels déjà portés afin qu’une deuxième augmentation ne les double pas ; ce dernier cas n’a pas été reproduit ici.

**Recette :** entrée, sortie, absence, prime au jour, augmentation individuelle et en lot, deuxième rappel et changement de barème.

### G09 — Le temps partiel n’alimente pas le taux horaire des heures supplémentaires

**Gravité : grave pour les entreprises mélangeant des durées contractuelles. Reproduit ; qualification légale à valider.**

**Emplacement :** [modules/personnel/moteur/compta-paie.js:727](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/personnel/moteur/compta-paie.js#L727), `heuresSupDuMois`.

La fiche dispose d’heures hebdomadaires individuelles, mais le calcul divise le brut individuel par `payrollSettings.heuresMois`, commun à l’entreprise. `weeklyHours` ne participe pas à cette fonction.

**Exemple exécuté :** salaire de 650 DT pour 24 h/semaine, réglage collectif 208 h/mois, une heure majorée de 25 %. Résultat : **3,906 DT**. Si la base mensuelle du contrat est **104 h**, la même formule donne **7,813 DT**.

Cette comparaison suppose une base contractuelle de 104 h ; elle ne fixe pas le droit tunisien des heures complémentaires/supplémentaires.

**Correction attendue :** base horaire individuelle datée et règles de catégories d’heures par contrat. La simple modification du réglage collectif ne résout pas les contrats mixtes.

**Recette :** salarié à temps plein et salarié à temps partiel dans le même mois, changement d’horaire, retards et absences valorisés en heures, majorations validées par le métier.

### G10 — Un congé au changement d’année consomme deux fois ses jours

**Gravité : moyen. Reproduit.**

**Emplacement :** [modules/personnel/moteur/compta-paie.js:367](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/modules/personnel/moteur/compta-paie.js#L367), `leavesOf` et calcul du solde annuel.

La sélection annuelle conserve le congé dont le début ou la fin tombe dans l’année, puis compte l’intégralité de sa période sans intersection avec l’année concernée.

**Scénario exécuté :** congé accepté du 30 décembre 2026 au 2 janvier 2027. Quatre jours ouvrables dans le calendrier de la sonde : le compteur 2026 prend **4 jours**, celui de 2027 **4 jours** supplémentaires, au lieu de deux jours chacun.

**Impact :** solde, reports et indemnités de congés potentiellement erronés.

**Correction attendue :** calculer l’intersection des dates avec la période d’acquisition/consommation retenue par l’entreprise.

**Recette :** année civile ou conventionnelle, repos, congé couvrant plusieurs années, annulation et demande non acceptée.

### G11 — Une lecture IA conserve une connexion SQL pendant l’attente externe

**Gravité : grave pour la disponibilité du serveur mutualisé. Preuve : code ; saturation non exécutée.**

**Emplacements :** [serveur/app.ts:307](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/app.ts#L307), enveloppe transactionnelle des routes ; [serveur/base.ts:33](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/base.ts#L33), pool de dix connexions par défaut ; [serveur/achats/routes.ts:151](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/achats/routes.ts#L151), traitement de lecture ; [serveur/achats/lecture-ia.ts:107](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/achats/lecture-ia.ts#L107), délai et nouvelles tentatives.

Le traitement attend `ctx.lecteurIA.lire(...)` à l’intérieur de la transaction ouverte par l’application. Une connexion PostgreSQL demeure occupée pendant l’appel Anthropic, dont le délai configuré est de 120 secondes avec jusqu’à deux nouvelles tentatives du SDK selon l’erreur. Le mécanisme normal des sessions authentifiées n’impose pas de quota par utilisateur à ce niveau.

**Déclencheur :** un utilisateur autorisé lance dix lectures simultanées alors que le prestataire répond lentement. Le pool partagé peut être entièrement retenu et les autres entreprises attendent, y compris pour des opérations sans rapport avec l’IA. La durée exacte dépend des erreurs et du SDK ; elle n’a pas été mesurée en charge ici.

**Correction attendue :** vérifications d’accès et préparation courtes, appel réseau hors transaction, puis nouvelle transaction vérifiant les droits pertinents avant persistance. Ajouter limites par entreprise/utilisateur, file de travail, délai total, annulation et suivi de consommation.

**Recette :** prestataire simulé lent ou en échec ; les opérations d’une deuxième entreprise doivent rester disponibles et les transactions ne doivent pas rester ouvertes pendant l’attente.

### G12 — Les ressources lourdes authentifiées ne sont pas réparties entre utilisateurs

**Gravité : moyen. Preuve : code.**

**Emplacements :** [serveur/limites.ts:1](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/limites.ts#L1), limites publiques et clés API ; [serveur/pdf/imprimeur.ts:95](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/pdf/imprimeur.ts#L95), file globale ; [serveur/pdf/routes.ts:14](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/pdf/routes.ts#L14), page jusqu’à 8 Mio.

Les limites existantes couvrent les clés API et les routes publiques. Elles ne constituent pas une limite par utilisateur connecté. Le PDF possède une file globale bornée, ce qui est utile, mais sans équité par utilisateur/entreprise. Un compte peut continuellement occuper les deux impressions et la file de huit demandes ; les autres reçoivent « occupé ».

**Déclencheur :** session autorisée envoyant en boucle des pages lourdes au service PDF. Aucun essai d’épuisement n’a été lancé.

**Correction attendue :** quotas et concurrence par utilisateur/entreprise, limite de complexité ou de temps total du rendu, équité de file et métriques. Étendre aux imports, exports et opérations lourdes selon leur coût réel.

**Recette :** un utilisateur monopolise le service simulé ; une demande ordinaire d’un autre utilisateur doit encore obtenir un créneau dans un délai borné. Vérifier les 429/503 et leurs indications de reprise.

### G13 — Le parcours de reprise ne restaure pas la clé du coffre applicatif

**Gravité : grave si aucune conservation externe de cette clé n’existe. Lacune de procédure, pas constat de perte réelle.**

**Emplacements :** [serveur/coffre.ts:1](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/serveur/coffre.ts#L1), chiffrement lié à `SKANFACT_COFFRE` ; [exploitation/installer.sh:115](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/exploitation/installer.sh#L115), création des réglages ; [exploitation/hors-machine.sh:43](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/exploitation/hors-machine.sh#L43), liste des fichiers envoyés ; [docs/mise-en-ligne.md:208](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/docs/mise-en-ligne.md#L208), procédure de machine perdue.

La copie hors machine emporte les sauvegardes SQL, bases physiques et WAL. La procédure documentée conserve la clé privée **age** permettant de déchiffrer ces copies. Cette clé est différente de `SKANFACT_COFFRE`, qui ouvre les secrets applicatifs stockés en base. L’installation d’une machine neuve génère un nouveau coffre et le parcours documenté de reprise ne restaure pas explicitement l’ancien.

**Déclencheur :** perdre le serveur et ses fichiers `/etc/skanfact`, puis suivre seulement la procédure du dépôt. La base est restaurée, mais des secrets Konnect ou d’autres intégrations chiffrés par l’ancien coffre peuvent rester illisibles. Une sauvegarde extérieure du coffre peut exister ; elle n’a pas été vérifiée et doit être produite comme preuve opérationnelle.

**Correction attendue :** procédure de conservation et récupération séparée des secrets de reprise, avec responsables, accès, versions et rotation. Ne pas placer toutes les clés en clair à côté des sauvegardes.

**Recette :** sur une machine vierge, restaurer la base et les éléments de reprise, puis ouvrir un secret synthétique scellé avant la panne et vérifier un connecteur simulé. La présence des seules lignes SQL ne constitue pas le succès de la reprise applicative.

### G14 — Le choix d’une base PITR peut prendre une copie non utilisable à la date demandée

**Gravité : moyen. Preuve : code et règle de récupération PostgreSQL ; cas non restauré ici.**

**Emplacements :** [exploitation/copie-de-base.sh:19](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/exploitation/copie-de-base.sh#L19), horodatage avant `pg_basebackup` ; [exploitation/restaurer.sh:71](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/exploitation/restaurer.sh#L71), choix par nom de copie.

Une copie est nommée avec l’instant de début du script. La restauration choisit la plus récente dont ce nom est antérieur à la cible. Ce critère ne garantit pas que la sauvegarde avait atteint son point de cohérence avant la cible.

**Déclencheur :** copie commençant à 01:00 et se terminant à 01:20 ; cible à 01:10. La sélection peut prendre cette copie plutôt que celle de la veille. Une sauvegarde physique nécessite le rejeu des WAL jusqu’à son point de cohérence, qui peut être postérieur à la cible.

**Impact :** échec d’une restauration pourtant possible avec une copie plus ancienne. Le script ne démontre pas une restauration réussie à une fausse date : il peut simplement échouer.

**Correction attendue :** conserver et utiliser les métadonnées de début/fin et le point de cohérence nécessaires, choisir une copie compatible et prévoir un repli contrôlé sur une plus ancienne.

**Recette :** faire une sauvegarde longue sous écritures ; demander une cible au milieu de sa durée et vérifier que la bonne copie est choisie.

### G15 — Installation dans le répertoire utilisé par le serveur actif

**Gravité : moyen. Preuve : code.**

**Emplacement :** [exploitation/suivre.ts:261](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/exploitation/suivre.ts#L261), `installerLaVersion`.

Le déploiement commence par `git checkout` puis `npm ci` dans le dépôt du service actif. Le redémarrage intervient après la construction, les migrations et le remplacement du lien des écrans. Pendant ce temps, un processus de l’ancienne version tourne avec des fichiers et dépendances remplacés sous ses pieds. Certains chargements et lectures sont différés, notamment les moteurs assemblés.

**Déclencheur :** une demande arrive pendant `npm ci`, une lecture tardive charge des sources de la nouvelle version ou la construction échoue avant le redémarrage. Le code en mémoire, le code lu sur disque, les dépendances et éventuellement le schéma peuvent représenter plusieurs versions.

**Correction attendue :** préparer chaque version dans un répertoire immuable séparé, construire et vérifier avant bascule ; migrations compatibles avec les processus encore actifs ou fenêtre explicite de maintenance ; santé et retour arrière avec une doctrine de compatibilité de schéma.

**Recette :** trafic continu synthétique pendant installation et échec à chaque étape. Aucune combinaison incohérente ne doit être servie ; la reprise ne doit pas prétendre annuler une migration irréversible.

### G16 — Alertes de sécurité sur des dépendances de production

**Gravité : moyen tant que l’exploitabilité applicative n’est pas établie. Preuve : `npm audit --omit=dev --json`, registre interrogé pendant la revue.**

**Emplacements :** [package.json:45](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/package.json#L45) et [package-lock.json:1](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/package-lock.json#L1) ; CI dans [.github/workflows/verifier.yml:1](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/.github/workflows/verifier.yml#L1).

Le registre retourne **10 entrées de paquets affectés : 2 high et 8 moderate**. Ce n’est pas dix failles indépendantes : plusieurs entrées sont la propagation d’une même dépendance vulnérable.

Principales alertes reçues :

- **Zod** : `GHSA-mrhx-c7xc-m3w5`, épuisement mémoire lors de validation de grandes collections contraintes ; plage affectée `<4.6.6`, version déclarée `4.6.5`. Le SDK Anthropic apparaît aussi `high` par sa chaîne de dépendances.
- **Fastify** : `GHSA-389g-gv7q-r4x8`, contournement de validation d’en-tête ; plage reçue `>=5.12.2 <5.12.6`, version déclarée `5.12.5`.
- **Nodemailer** : `GHSA-8c8m-p3m8-cjg8`, `GHSA-m943-m63m-w62w`, `GHSA-85x2-q946-cp5h`, interprétation des destinataires ; plage reçue `<10.1.4` à partir de 3.0.0, version déclarée `10.0.15`.
- **fast-uri** : plusieurs avis de normalisation/confusion d’URI dans l’arbre de validation.

**Exemple de risque à vérifier :** déterminer si une entrée publique atteint la validation Zod concernée dans les limites de taille HTTP ; vérifier aussi si les adresses acceptées par l’application peuvent atteindre les cas d’analyse Nodemailer. **Aucune exploitation de ces avis n’a été démontrée ici.**

**Correction attendue :** consulter chaque avis, cartographier les usages exposés, choisir une version corrigée disponible et compatible, mettre à jour le verrou puis rejouer les recettes. Le retour `fixAvailable: false` n’autorise ni l’inaction ni une mise à jour majeure automatique.

**Recette :** conserver le résultat d’audit horodaté, justifier les alertes non atteignables, et ajouter un contrôle de vulnérabilités avec traitement documenté dans la CI. Le contrôle de secrets existant ne remplace pas cette démarche.

### G17 — Trois références font échouer le contrôle documentaire

**Gravité : mineur pour le contenu ; contrôle CI réellement rouge dans la session.**

**Emplacements :** [docs/carte.md:163](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/docs/carte.md#L163), [docs/carte.md:290](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/docs/carte.md#L290), [tests/socle/consignes.test.ts:23](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/tests/socle/consignes.test.ts#L23).

Le test attend des chemins existant depuis la racine. Il retourne trois éléments : `moteur/core-paie.js`, `moteur/compta-paie.js` et `web/public/plateforme/paie.css`. Les deux premiers sont présentés dans un contexte de module, mais le validateur les traite comme absolus depuis la racine ; le troisième correspond à une ancienne localisation.

**Exemple :** exécuter `tests/socle/consignes.test.ts` sur le commit audité : l’assertion attend `[]` et reçoit ces trois chemins. Ce défaut n’est pas dû à PostgreSQL ou à un outil système absent.

**Correction attendue :** utiliser les chemins actuels complets dans la carte et, si les références relatives sont voulues, définir leur résolution dans le contrôle. Ne pas retirer le test ni ignorer tout le dossier `moteur` pour rendre la CI verte.

**Recette :** le contrôle passe sur les références correctes et échoue encore lorsqu’une référence est réellement rompue.

### G18 — Une cible tactile de tri est trop étroite selon la règle du projet

**Gravité : mineur. Mesuré dans le navigateur, sans relance isolée de la mesure.**

**Emplacements :** [web/console/src/console.css:1569](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/web/console/src/console.css#L1569), règle mobile de `.c-pf-tri` ; [web/console/src/ecrans/Performances.tsx:414](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/web/console/src/ecrans/Performances.tsx#L414) ; [tests/web/console.test.ts:839](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/tests/web/console.test.ts#L839).

Sur un écran de 390 px, le bouton de tri de la colonne « 99 % » de la Console Performances mesure **41,2 × 44 px**, en clair comme en sombre. La règle mobile impose la hauteur mais pas une largeur minimale suffisante pour ce contenu. L’instrument de rendu du projet attend une cible d’au moins 44 px.

**Exemple :** ouvrir Performances à 390 px et utiliser le tri « 99 % ». Le test remonte la même cible trop étroite dans les deux thèmes.

**Correction attendue :** donner une largeur ou une zone d’activation suffisante au bouton, sans faire déborder le tableau. Ce constat porte sur le seuil du projet ; il ne signifie pas à lui seul une non-conformité à toutes les exigences WCAG.

**Recette :** 390 px, clair/sombre et autres intitulés courts ; contrôler largeur, hauteur, focus clavier et absence de chevauchement des cibles.

### G19 — La première ouverture dépasse le budget de transfert défini

**Gravité : moyen. Mesure locale observée, pas un benchmark de production.**

**Emplacements :** [tests/web/leger.test.ts:291](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/tests/web/leger.test.ts#L291), budgets ; [web/vite.config.ts:1](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/web/vite.config.ts#L1), construction ; [commun/assemblage.ts:74](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/commun/assemblage.ts#L74), assemblage. Diagnostic détaillé dans `dist/mesures/leger.txt` de la copie de revue.

Le test définit `KO = 1024`. Il mesure **1 389 Kio** avant le premier dessin, contre **1 300 Kio** autorisés, soit environ **6,8 % de dépassement**. Avec la copie conservée par le service worker : **1 390 Kio**. La seconde ouverture ne transfère que **6 Kio**, ce qui respecte son budget de 30 Kio.

**Scénario exécuté :** première ouverture de l’entreprise sur la connexion lente simulée par le test. Le test échoue sur le poids. Le relevé indique aussi 15 096 ms pour la première ouverture et 1 684 ms pour la suivante ; ces durées ont été mesurées pendant une campagne concurrente et doivent être confirmées isolément avant toute conclusion de temps de réponse en production.

**Correction attendue :** attribuer le poids aux ressources téléchargées, puis retirer le chargement inutile au premier écran, dédupliquer ou charger à la demande les parties appropriées. Ne pas simplement relever le plafond sans décision sur l’expérience attendue. L’assemblage en modules sources ne constitue pas, à lui seul, un chargement séparé dans le navigateur.

**Recette :** poids initial, poids complet avec copie hors ligne et seconde visite, à froid et à chaud ; vérifier que l’allègement ne change ni les règles métier ni la capacité hors ligne.

### G20 — Une recette échoue sur la casse du mot « Facturé »

**Gravité : mineur. Cause de cette assertion identifiée.**

**Emplacement :** [tests/web/recette-alpha.test.ts:287](https://github.com/saouthq/skanfact-plateforme/blob/95d67eb64d1256dd4bc1fcf65a6a07856752f826/tests/web/recette-alpha.test.ts#L287).

L’assertion attend `/accepté facturé/`, alors que la ligne retournée contient `accepté Facturé FAC-2026-001`. Le document lié apparaît bien dans la trace. Cet échec précis ne démontre donc pas que la facturation du devis a échoué.

**Exemple exécuté :** recette Ctrl+S et transformation du devis `DEV-2026-041` ; l’attente expire malgré la présence du statut et de la référence attendus, à une majuscule près.

**Correction attendue :** tester les éléments de statut et le lien vers la facture de façon sémantique, et vérifier la relation persistée. Si la casse fait partie d’une règle éditoriale voulue, la vérifier dans un contrôle distinct, sans confondre cette règle avec le succès de la facturation.

**Recette :** le test doit réussir quand la facture est réellement liée et échouer quand le lien manque ; changer seulement une majuscule ne doit pas masquer ou inventer une régression de facturation.

## 5. Mise à jour de l’audit de paie du 2 novembre

Il faut travailler sur cette version, pas recopier la liste antérieure sans contrôle.

- **Paiements sociaux et reversements de saisies : correction présente.** La migration `0188_paie_payee_dans_les_livres.sql` et les chemins serveur correspondants ajoutent les origines comptables. L’ancien P01 n’est donc pas présenté comme défaut actuel.
- **Clôture de période : protection supplémentaire présente.** `garderLaCloture` est maintenant appelée dans la sauvegarde. Cela ne remplace pas l’immutabilité métier des bulletins payés/validés : G05.
- **CIN/RIB dans les archives : protection partielle ajoutée.** Elle ne couvre pas toute la paie : G02.
- **Salaires datés, nouveaux écrans du Personnel, augmentations en lot et variables : des développements existent.** Ne pas les redemander comme totalement absents. Vérifier leurs résultats, notamment G08.
- Les corrections nécessaires confirmées dans cette revue sont G05 à G10. Les autres constats historiques, par exemple la remise des PDF et la réimpression historique, nécessitent une nouvelle recette ciblée avant d’être déclarés corrigés ou toujours ouverts.

## 6. Revue par aspect et contrôles métier encore nécessaires

Cette section sert de plan de recette. Les éléments non reproduits ne doivent pas devenir des tickets affirmant une faute légale ou un bug sans vérification.

| Aspect | Ce qui a été examiné | Conclusion et suite |
|---|---|---|
| Architecture | Inventaire, assemblage, modules, frontières et lecture des moteurs | Assemblage central utile ; contrôle passe avec dette reconnue. Poursuivre la séparation des services et du code métier dans `modules/` |
| Ventes | Scellement, dossier, calcul, règlements, espace client | G01, G03, G04 ; priorité élevée avant données réelles |
| Achats | Persistance, lecture IA, consentement et calculs communs | G11 ; recette supplémentaire des doublons fournisseur, avoirs, cours et pièces sans facture |
| Caisse | Chaîne, sorties de paie, scripts et tests lancés | Raccordement récent présent ; valider fermetures concurrentes, salaire annulé après Z et reprise hors ligne |
| Stock | Collections et droits, raccordements ventes/achats, tests lancés | Pas d’audit exhaustif des réservations, multi-dépôts, séries, coûts et retours ; ne pas certifier ce domaine |
| Comptabilité | Écritures et corrections, paie, familles, migrations de validation | Ne pas confondre modification du document source et réécriture d’une écriture validée ; recettes de rapprochement nécessaires |
| Trésorerie | Règlements, paiements en ligne et événements de paie | Vérifier banque/caisse/écritures après chaque annulation, rejet et remboursement ; G11/G12 sur la disponibilité |
| Personnel/paie | Moteur, transitions, barèmes, congés et évolutions récentes | G05 à G10 ; conformité fiscale et conventionnelle non certifiée |
| Fiscalité | Paramètres de calcul et déclarations raccordées | Exemples de référence indépendants indispensables ; pas de validation des textes officiels dans cette revue |
| Cabinet | Routes de paie, mandat et filtrage des identités | Vérifier toutes les copies et exports, les mandats révoqués et les collaborateurs retirés ; G02 montre le risque transversal |
| Authentification | Enveloppe des routes, transactions, rôles et limites | Protections existantes ; matrice complète sessions/clé API/support/console à compléter |
| Isolation PostgreSQL | RLS, contexte transactionnel et contrôle structurel en base | Les 123 tables ordinaires avec colonne `entreprise` de la base migrée contrôlée ont RLS activée et forcée. Cela ne prouve pas la justesse de chaque politique ou fonction `SECURITY DEFINER` |
| Fichiers et PDF | Types, tailles, routes de pièces jointes, navigateur serveur | PDF hors ligne et scripts désactivés ; G12 ; audit complet des certificats médicaux et données sensibles restant à faire |
| Intégrations | Konnect, TTN, DigiGo et IA par lecture ciblée | Certains secrets protégés par coffre et appels bornés ; tests prestataires réels non effectués ; G13 |
| Hors ligne | Pont, conflits, file et idempotence par lecture ciblée | G02 ; rejouer déconnexion, changement de rôle et purge de toutes les copies locales |
| UI/UX | Tests navigateur lancés, espace client et Personnel ciblés | Incohérences de contenu confirmées ; pas de revue visuelle exhaustive de chaque écran et de chaque appareil |
| Accessibilité | Structure de composants et tests disponibles repérés | Aucun audit WCAG/RGAA complet ; navigation clavier, focus, lecteurs d’écran et contraste à vérifier sur les parcours critiques |
| Performance | Pool, appels externes, PDF, construction et frontières | G11/G12 ; pas de mesure de capacité avec volumes de production |
| Confidentialité | Droits et copies dérivées, chiffrement et procédure de reprise | G02/G13 ; durées, données médicales et obligations applicables à valider |
| Abonnement | Routes, factures, limites d’offre et paiement par lecture ciblée | Rejouer période d’essai, lecture seule, renouvellement, remboursement et opérations automatiques |
| Console/support | Architecture d’accès et exploitation ciblées | Pas de certification de tous les gestes privilégiés ; aucun accès réel à la console effectué |
| Déploiement/reprise | Installation, suiveur, sauvegardes, PITR, hors machine, reprise | G13 à G15 ; état réel des hôtes et verrou S3 non observés |
| Bureau/impression | Configuration Electron et raccordements repérés | Isolation du renderer configurée ; binaire Electron et périphériques non testés dans cette revue |
| SEO et internationalisation | Inventaire des pages, textes et langues | À traiter selon les pages publiques visées ; ne pas appliquer une exigence d’indexation aux écrans privés |

### Décisions métier à formaliser avec des références indépendantes

1. **Fiscalité et paie** : barèmes datés, assiettes par rubrique, régimes particuliers, CSS, conventions, minima, congés, maladie, heures et départ. Un paramètre modifiable ne prouve pas son applicabilité.
2. **Documents émis** : ce qui est figé, ce qui peut changer administrativement, correction et preuve d’accord. Appliquer ces règles à toutes les routes, pas seulement à l’écran.
3. **Argent reçu ou versé** : distinguer demande, ordre, exécution, rejet, remboursement et rapprochement. Le retour du navigateur ne constitue pas une preuve de paiement.
4. **Comptabilité** : chaque événement métier doit se rapprocher des montants persistés, par date, devise, compte et contrepartie ; ne pas comparer uniquement deux calculs client.
5. **Reprise** : définir RPO/RTO, clés, responsabilités et critères de succès applicatifs, puis mesurer un exercice sur une machine neuve.
6. **Confidentialité** : le droit suit la donnée dans ses historiques, conflits, exports, caches, messages et documents, même lorsque la donnée change de collection.

### Contrôles transversaux à conserver

Les protections déjà présentes doivent rester vérifiées pendant les corrections : transactions communes, entiers monétaires, RLS forcée, identité remise à zéro après transaction, clé de coffre liée à l’entreprise, listes de sortie publiques, PDF sans accès réseau et limites de taille. Le projet possède une base de contrôles substantielle ; les défauts trouvés sont surtout des contournements entre représentations et des invariants métier incomplets.

Aucune mutation de données existantes ne doit être lancée en masse sur la seule base de ce rapport. Pour G01, G02, G03 et les doublons de paie, produire d’abord un **diagnostic en lecture seule** donnant les identifiants affectés, puis une stratégie de réparation examinable. Ne pas modifier les documents légaux historiques en silence.

## 7. Tests et qualité de la preuve

### Contrôles terminés

- `npm ci --ignore-scripts` : installation réussie dans la copie isolée. Les scripts d’installation natifs particuliers ne sont pas tous couverts par cette commande.
- `npm run types` : réussi.
- `npm run lint` : réussi, zéro avertissement demandé par le projet.
- `npm run web` : réussi.
- `npm run frontieres` : réussi, avec dette connue affichée : **F4 210, F7 4, F13 51** ; pont entreprise **3 144 lignes**, pont Cabinet **2 788 lignes**. Ces compteurs ne sont pas des défauts tous de même gravité ; leur signification relève de l’outil du dépôt.
- Requête structurelle PostgreSQL : sur **123 tables** concernées, aucune table ordinaire ayant une colonne `entreprise` n’a été trouvée sans RLS à la fois activée et forcée dans la base de test migrée.
- **8 sondes indépendantes réussies** : leur réussite signifie que les défauts ont été reproduits. Elles couvrent G01 à G10, certains tests réunissant plusieurs résultats.
- `npm audit --omit=dev --json` : alertes détaillées en G16, pas un contrôle vert.

### Résultats des suites existantes

| Campagne | Fichiers | Tests | Résultat |
|---|---|---|---|
| Hors navigateur et hors Electron, première exécution | 257 réussis, 6 en échec | 1 581 réussis, 15 en échec, 18 non exécutés après échec de préparation | Rouge ; causes distinguées ci-dessous |
| Relance des deux fichiers de sauvegarde après ajout des clients PostgreSQL | 2 réussis | 7 réussis | Vert |
| Navigateur, groupe de 64 fichiers `console-*` et `cabinet-*` | 64 réussis | 182 réussis | Vert |
| Navigateur, autres fichiers | 135 réussis, 5 en échec, 1 ignoré | 354 réussis, 6 en échec, 2 ignorés | Rouge ; détails ci-dessous |
| Relance ciblée de la caisse, puis de son fichier entier | 1 fichier réussi à chaque relance | 1 test ciblé, puis 4 tests réussis | Le défaut de la campagne globale ne se reproduit pas dans ces relances |

**Interprétation de la première campagne hors navigateur :**

- Sept échecs de sauvegarde étaient liés à l’absence de `pg_dump` et des outils clients. Après ajout de ces outils dans `/tmp`, les sept tests concernés passent. Aucun correctif applicatif n’a été apporté pour ce résultat.
- La préparation de `tests/exploitation/archivage.test.ts` échoue faute d’installation locale du serveur PostgreSQL 16 à l’emplacement attendu ; ses 18 tests ne sont donc pas une preuve de réussite de l’archivage. Le PostgreSQL de cette revue tourne dans un conteneur distinct.
- Un test de facture électronique reste bloqué par l’absence de `xmllint`. L’acceptation du TEIF par le schéma n’a pas été certifiée pendant cette session.
- Six échecs concernent `tests/exploitation/veiller.test.ts` : délais dépassés et assertions d’alertes. Un diagnostic sur une copie de test ne les a pas tous éliminés. La cause complète n’est pas établie ; ne pas attribuer ces six échecs à six défauts de production sans diagnostic.
- Le contrôle documentaire échoue pour les trois références de G17 : cause identifiée dans le dépôt.

**Exécution :** les groupes utilisent des bases distinctes (`SKANFACT_TEST_GROUPE`) sur le PostgreSQL isolé, avec `PG_ADMIN` pointant vers `127.0.0.1:55440` et `PLAYWRIGHT_BROWSERS_PATH=/tmp/skanfact-review-browsers`. Le premier lancement emploie `vitest run --exclude 'tests/web/**' --exclude 'tests/bureau/**'`. Les deux campagnes web réunissent tous les fichiers `tests/web/*.test.ts` de l’inventaire. Les sondes supplémentaires sont comptées séparément des tests existants.

**Bilan des 205 fichiers navigateur :** 199 fichiers réussis, 5 en échec et 1 ignoré ; **536 tests réussis, 6 en échec et 2 ignorés**. Les deux campagnes sont disjointes ; la sélection de la première a été vérifiée par `vitest list --filesOnly`.

Les six échecs correspondent à :

1. `tests/web/console.test.ts:839` : cible de 41,2 × 44 px ; G18.
2. `tests/web/leger.test.ts:291` : poids de 1 389 Kio ; G19.
3. `tests/web/recette-alpha.test.ts:287` : « Facturé » au lieu de « facturé » dans une expression sensible à la casse ; G20.
4. `tests/web/caisse-z.test.ts:274` : le tableau d’erreurs JavaScript contient `Cannot read properties of null (reading 'company')`. Les vérifications monétaires précédentes du scénario sont franchies. Le scénario ciblé puis les quatre tests du fichier passent lors des relances : erreur intermittente à diagnostiquer, pas preuve d’un calcul de caisse faux.
5. `tests/web/classeur-cabinet.test.ts:186` : la ligne attendue « en double ? » n’est pas trouvée, compte 0 au lieu de 1.
6. `tests/web/classeur-cabinet.test.ts:239` : la ligne attendue liant une pièce lue à l’achat `FA-0919`, sans justificatif, n’est pas observée avant expiration du délai.

Les **huit tests du fichier classeur passent en relance isolée**, sans changement applicatif. Ses deux échecs globaux sont donc consignés comme intermittents, avec une cause non établie ; ils ne sont pas ajoutés au registre des bugs métier confirmés. Voir `/tmp/skanfact-review-classeur-diag.log`.

Ces résultats doivent rester visibles dans le suivi de développement. Ne pas corriger les échecs de données en supprimant les assertions ou en augmentant systématiquement les délais.

La campagne ne permet donc pas de conclure « tous les tests passent ». Les preuves par réintroduction complètes et Electron n’ont pas été exécutés. Les avertissements de requêtes PostgreSQL concurrentes émis par le pilote sont à examiner pour les mises à jour futures ; ils ne sont pas comptés comme autant de bugs métier.

### Pourquoi des tests verts laissent passer ces erreurs

Les tests existants comportent de vraies assertions : montants, droits, refus, transactions et contenu des documents. Le projet possède aussi un mécanisme de preuves par réintroduction. Il serait inexact de dire qu’ils ne testent rien.

Les angles morts observés sont néanmoins importants :

- Vérifier que modifier une facture émise est refusé **sans changer son type** ne couvre pas le retour anticipé de G01.
- Vérifier que CIN et RIB disparaissent des conflits ne protège pas salaire, famille, santé et saisies : G02.
- Tester le filtre de partage pour exclure les champs internes ne prouve pas qu’il conserve tous les champs de calcul : G03.
- Confronter deux moteurs héritant de la même méthode ne démontre pas une règle d’allocation correcte : G04.
- Tester un bouton masqué ne remplace pas une requête directe à la sauvegarde : G05.
- Créer des bulletins avec des identifiants tous distincts ne teste pas l’unicité de la période : G06.
- Un test de moteur qui accepte une prime négative ne démontre pas que le serveur la sauvegarde : G07.
- Les exercices de restauration locaux ne suffisent pas à prouver le retour du service sur une machine neuve avec ses clés : G13.

Les tests qui cherchent du texte dans un script ou une propriété dans une configuration peuvent protéger une consigne, mais doivent être complétés par un test de comportement pour les règles critiques. Ne pas supprimer ces assertions sans comprendre leur rôle ; ne pas les présenter seules comme preuve de fonctionnement.

## 8. Plan d’action pour Claude

### Lot A — Confidentialité et intégrité documentaire

**G01, G02, G03.** Écrire d’abord les recettes reproduisant les contournements, corriger au serveur et dans les contrats de sortie, puis examiner les données existantes : documents légaux orphelins, anciennes archives et documents déjà partagés. Ne pas supprimer ou recalculer automatiquement des pièces émises pour « nettoyer ».

Critère de sortie : aucune transformation d’une pièce émise, aucun accès indirect à la paie, édition client identique aux montants scellés.

### Lot B — Calculs et invariants métier

**G04 à G10.** Définir les règles de conservation des montants, l’unicité du bulletin, ses transitions et la correction signée. Corriger rappel et temps partiel avant d’étendre les opérations en lot. Obtenir des exemples chiffrés indépendants.

Critère de sortie : cas limites sauvegardés puis relus sans divergence et sans double paiement ; pas seulement des tests de fonctions isolées.

### Lot C — Disponibilité et exploitation

**G11 à G15.** Sortir les appels externes longs des transactions, borner et répartir les travaux lourds, préparer les versions dans des répertoires distincts, formaliser la récupération des clés et corriger la sélection PITR.

Critère de sortie : exercice de charge avec prestataire lent, déploiement sous trafic synthétique et reprise sur machine vierge avec secret applicatif synthétique récupéré.

### Lot D — Dépendances et campagne de recette

**G16 à G20**, puis campagne par domaine du tableau de couverture. Corriger les dépendances après analyse d’atteignabilité et compatibilité ; réexécuter CI et preuves. Renseigner chaque contrôle « vérifié / défaut reproduit / non vérifié / non applicable » avec la commande ou la preuve correspondante.

### Consigne prête à transmettre à Claude

> Lis ce rapport, vérifie les constats sur la tête actuelle de dev et conserve leurs identifiants G01 à G20. Ne pars pas du principe qu’un ancien défaut est encore présent ou qu’un test vert démontre son absence. Pour chaque correction : ajoute une recette de comportement indépendante, corrige dans les vraies sources actuelles, vérifie le serveur et la persistance, puis documente le résultat et les limites. Traite d’abord G01/G02/G03, puis les calculs et transitions de paie, puis les ressources et la reprise. Préserve les pièces émises et les écritures validées ; toute réparation de données doit avoir un aperçu, une sauvegarde et une trace. Ne déploie pas une règle fiscale ou conventionnelle inventée : formule la décision manquante et applique le référentiel validé. Remets un tableau par ID avec preuve avant, changement, tests après et état final.

## 9. Périmètre non lu ou non vérifié intégralement

**Je n’ai pas lu toutes les lignes de tout le dépôt.** Le projet comprend 1 537 entrées suivies par Git et 535 fichiers sous `tests` au moment de l’inventaire. La revue combine inventaire, recherche ciblée, lectures de chemins, contrôles automatiques et sondes. Elle ne doit pas être présentée comme une certification exhaustive du produit.

Restent notamment à examiner intégralement :

- toutes les routes Console, abonnement, Cabinet, messagerie et support ;
- toutes les politiques RLS et toutes les fonctions SQL `SECURITY DEFINER`, en tenant compte de leurs remplacements successifs par migration ;
- tous les parcours de stock, séries, multi-dépôts, valorisation, retours et comptabilité d’inventaire ;
- toutes les fonctionnalités des tableaux de pilotage, déclarations annuelles, immobilisations et révision ;
- tous les composants, modales, états vides/erreur, variantes mobiles, langues et parcours d’accessibilité ;
- tous les historiques de documentation, maquettes, archives `web/v10` et fichiers du banc ;
- les périphériques de caisse, le binaire Electron et les imprimantes réelles ;
- les preuves par réintroduction complètes (non exécutées pendant cette revue), les prestataires réels et l’acceptation des fichiers par TTN, DigiGo, CNSS et banques ;
- les textes légaux officiels, conventions collectives et obligations de conservation ;
- les hôtes et comptes réellement déployés, pare-feu, TLS public, stockage, chiffrement disque, IAM S3, verrouillage des objets, alertes et récupération physique des clés ;
- la charge avec données réelles représentatives et la reprise complète sur une machine neuve.

**Aucune fuite entre entreprises n’a été reproduite.** Cela ne certifie pas l’ensemble de l’isolation : la preuve positive de G02 concerne un rôle de la même entreprise, et le contrôle structurel RLS ne vérifie pas chaque prédicat.

## 10. Traces et reproductibilité

Les liens de source ci-dessus sont figés sur le commit audité. Les résultats synthétiques sont inclus dans le rapport pour qu’il puisse être transmis seul.

Traces locales de cette session :

- `/tmp/skanfact-review-types.log`, `/tmp/skanfact-review-lint.log`, `/tmp/skanfact-review-web.log`, `/tmp/skanfact-review-frontieres.log` ;
- `/tmp/skanfact-review-tests.log`, `/tmp/skanfact-review-webtests.log` et `/tmp/skanfact-review-web-complement.log` : suites existantes ;
- `/tmp/skanfact-review-backup-retest.log`, `/tmp/skanfact-review-caisse-complete.log`, `/tmp/skanfact-review-classeur-diag.log` : relances ciblées ;
- `/tmp/skanfact-review-probes-final.log` : 8 sondes réussies ;
- `/tmp/skanfact-review-probes.jsonl` : résultats chiffrés, avec répétitions de relance ;
- `/tmp/skanfact-review-npm-audit.json` : avis du registre reçus pendant la revue ;
- copie temporaire : `tests/v10/audit-global.test.ts` et `tests/v10/audit-paie-actualisee.test.ts`.

Ces fichiers temporaires ne constituent pas un archivage permanent. L’ancien rapport du 2 novembre reste un historique ; les résultats du présent rapport priment pour le commit du 4 novembre.
