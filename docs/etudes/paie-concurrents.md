# La paie de SkanFact face aux concurrents et au métier (02/11/2026)

Demande de Skander (02/11) : « compare-le à ce que font les concurrents, il faut que ça colle au métier et aux actions
du métier de la paie (RH) ». Sources lues : la fiche du module Odoo de paie tunisienne (`l10n_tn_payroll`, v18), les
modules Odoo de déclaration CNSS et de pointage, une description du métier RH en Tunisie (Tanitjobs, 2026), et ce que
`docs/etudes/ETUDE-MARCHE.md` disait déjà de Hesabi, Swiver et Finco (paie « oui » chez Hesabi et Swiver Pro, sans
détail public). Sage (STAR Paie, Sage 100 Paie & RH), CICS Paie et SDP sont les logiciels de paie cités en Tunisie ; leur
documentation tunisienne n'est pas publique. **Tout chiffre légal ci-dessous est À VÉRIFIER avec un comptable.**

## Les gestes du métier, et où SkanFact en est

| Geste du métier (gestionnaire de paie, petite entreprise) | Les concurrents | SkanFact (1.254.0) |
|---|---|---|
| **Chaque mois** : récupérer le pointage et les absences, établir les bulletins en lot, contrôler, payer (virement, espèces), remettre | Odoo : bulletins en lot, variables importées, rapport de paiement par mode | ✅ tout le cycle (frise, contrôles, ordre de virement, espèces contre reçu, remise) |
| Saisir les **variables du mois** (primes, heures sup, avances) | Odoo : saisie **ou import** de variables à tout moment | ✅ saisie ; ❌ **import d'un tableau de variables** |
| **Négocier en net** : « il veut 1 000 DT net, quel brut ? » | Odoo : **calcul inverse net → brut** | ❌ seulement brut → net (simulation d'embauche) |
| **Augmentation annuelle** (négociation, convention) pour toute l'équipe | Sage/Odoo : mise à jour en masse des salaires | ✅ un par un, avec rappel des mois passés ; ❌ **en lot** (+ x % ou + x DT dès un mois) |
| **Convention collective** : prime d'ancienneté, minimum par catégorie | Odoo : convention prise en compte dans le calcul | ❌ « non réglé » dans les Réglages ; ❌ **prime d'ancienneté** |
| **Entrée** : contrat, période d'essai, affiliation CNSS, CIVP/Karama | Odoo : contrat, type, catégorie | ✅ contrat, régimes CIVP/Karama/stage, fin d'essai sur la fiche ; ❌ **la fin de période d'essai n'est pas dans « À traiter »** |
| **Sortie** : préavis, solde de tout compte, attestation/certificat de travail, indemnité | Sage : dernier bulletin, certificat, solde | ✅ solde de tout compte (congés non pris), certificat ; ❌ **préavis** et ❌ **indemnité de licenciement** (À VÉRIFIER : barème du Code du travail et de la convention) |
| **Congés** : droits acquis, demandes, solde | Odoo : congés intégrés au bulletin | ✅ (18 j ouvrables par défaut — À VÉRIFIER : le Code du travail parle d'un jour par mois, la convention souvent plus) |
| **CNSS** : cotisations, déclaration trimestrielle nominative, fichier à déposer | Odoo : déclaration nominative, tableau de télédéclaration | ✅ état CNSS, fichier du trimestre, contrôles case par case ; date d'échéance réglable (une source dit « avant le 25 », nos réglages « 15 » — À VÉRIFIER) |
| **IRPP, CSS, TFP, FOPROLOS** : déclaration mensuelle | Odoo : barème IRPP 2025 | ✅ déclaration du mois, barème réglable |
| **Déclaration annuelle d'employeur**, certificats de retenue | — | ✅ |
| **Écritures comptables de la paie** | Odoo : pièce comptable du lot de bulletins | ✅ (`ecritureDePaie`, comptes 42x, CNSS, État) |
| **Pénalités de retard** CNSS | — | ✅ notées à part en trésorerie |
| Avances, prêts, saisies sur salaire | Odoo : prêts | ✅ |
| Documents RH (attestations, contrats, avenants) | Sage : éditions | ✅ 13 documents en aperçu A4 |
| **Espace salarié** (demande de congé, bulletin en ligne) | Odoo/BambooHR : libre-service | ❌ (la demande se saisit par l'employeur ; prévu plus tard) |
| Entretiens annuels, intégration, recrutement | Odoo HR, BambooHR | ➖ hors du périmètre de la paie (pas au lancement) |

## Ce qu'on en retient pour le prochain gros lot de la paie

Dans l'ordre de ce que le métier demande le plus souvent :

1. **Net → brut** : dans la simulation d'embauche et sur la fiche (« Il touchera … net » ⇄ « Salaire de base »).
2. **Augmentation en lot** : choisir les salariés, + x % ou + x DT, dès un mois ; les rappels des mois déjà établis comme
   pour une augmentation seule.
3. **Fin de période d'essai** dans « À traiter » (dans les 15 jours) : confirmer, ou préparer la sortie.
4. **Sortie** : le préavis (date de fin proposée) et l'indemnité de licenciement en réglage daté — la valeur par défaut
   est celle qui ne fait rien (0), jamais un barème inventé.
5. **Prime d'ancienneté** en réglage (taux par tranche d'années, vide = rien) : une ligne du bulletin calculée.
6. **Import des variables du mois** (primes, heures sup, absences) depuis un tableur, contrôlé avant d'entrer.
7. La fin de la revue d'écran (téléphone, sous-vues du pointage, fenêtres restantes) et les **4 onglets** décidés.

Tout ce qui touche à un taux ou à une règle de droit reste un réglage daté, « À VÉRIFIER », vide par défaut.

Sources : [Odoo — Tunisia Payroll (l10n_tn_payroll)](https://apps.odoo.com/apps/modules/18.0/l10n_tn_payroll),
[Odoo — hr_payroll_tunisia](https://apps.odoo.com/apps/modules/18.0/hr_payroll_tunisia),
[Odoo — cnss_declaration](https://apps.odoo.com/apps/modules/18.0/cnss_declaration),
[Tanitjobs — le métier RH en Tunisie, 2026](https://www.tanitjobs.com/blog/1040/metier-rh-sirh-code-travail-cnss-ugtt-tunisie-2026/),
[Kolonell — intégration paie, SIRH, compta](https://kolonell.com/fr/blog/integration-paie-sirh-comptabilite-pme-tunis-2026).
