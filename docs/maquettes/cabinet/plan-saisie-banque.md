# Plan d'implémentation : Saisie et Banque du Cabinet (31/10/2026)

Ce plan porte la maquette `comptabilite.html` (états « Saisie… » et « Banque… ») dans l'application, sur `dev`. Il
s'appuie sur la revue `revue-saisie-banque.md` et sur ce que la plateforme a déjà.

## Ce qui existe déjà et qu'on garde

- **Relevés** : `compta.releve`, `compta.releve_ligne`, `compta.rapprochement` (0023). L'import Excel et CSV, l'empreinte
  du fichier (le même fichier ne s'importe pas deux fois), les colonnes nommées par banque (`cabinet.reglages.banques`),
  les « mots retenus ». Routes `serveur/compta/banque.ts` : lister, importer, retirer un relevé, rapprocher, défaire.
- **Le moteur** `web/public/v10/compta.js` : `rapprocherAuto`, `rapprocherLigne`.
- **Les écritures** : le brouillard, la validation, la contre-passation (0018), le lettrage.
- **Les pièces reçues** : le classement « vérifiée » (0179), « en double », « déjà saisie ».
- **La conversation** : demander au client depuis la Banque et la Saisie (1.189). Les PDF du serveur (1.92).

Une ligne de relevé qui paie plusieurs factures (une remise de chèques) ne demande **pas** de changer la base. Le
rapprochement relie la ligne du relevé à la ligne 532 de l'écriture, et c'est cette écriture qui lettre les trois
factures.

## Les lots, dans l'ordre

Chaque lot suit le même chemin : il porte sa version, ses tests (chacun prouvé en réintroduisant son défaut), ses
preuves et ses photos. Il est essayé à la souris, au bureau et au téléphone, puis documenté et envoyé sur `dev`.

### Banque

| Lot | Ce qu'il fait | Serveur | Écran |
|---|---|---|---|
| **B1** | L'écran en deux colonnes, comme la maquette | rien de neuf | Groupes (proposées, à traiter, en attente du client, rapprochées), icônes de nature, montant signé, pastilles et jauge, le livre à droite (pièces cochables, écart, écriture, un bouton principal), ↑ ↓ Espace Entrée /, menu ⋯ avec les gestes qui existent, le message « rapproché » avec Annuler, l'écran vide en aperçu, les cartes au téléphone |
| **B2** | Proposer avec le « pourquoi », confirmer en masse | Chaque proposition rend son niveau (sûre, d'après une règle, en attente) et sa raison (« même montant · STEG », « net de sa retenue »). Un geste « confirmer ces N », qui refuse ligne par ligne en nommant la ligne. Le net de retenue à la source et une ligne pour plusieurs factures (somme au millime) | Le point de confiance, « Valider les 3 », la remise ventilée et lettrée |
| **B3** | Le pied de l'écart et l'état de rapprochement | L'équation calculée au serveur : relevé, lignes sans écriture, chèques émis pas encore payés (lignes 532 du livre sans ligne de relevé), attendu au livre. Les pistes d'un écart non expliqué (une écriture du même montant sans ligne au relevé, relevé complet ou non). L'état en PDF, provisoire ou définitif | Le pied, l'écart rouge et ses pistes, « Chercher 12,000 », l'aperçu de l'état, « Joindre au dossier de révision » (le classeur) |
| **B4** | Importer sans surprise | Les contrôles avant l'import : la période, le solde de début égal à la fin du relevé d'avant (sinon refus, « importer d'abord celui d'octobre »), les lignes déjà importées, une à une, chaque ligne qui refait le solde. Un essai de rapprochement à blanc (« ≈ 31 se rapprocheront seules »). Un fichier gardé pour plus tard | L'aperçu des colonnes reconnues, la liste des contrôles, le refus qui débloque, la banque nouvelle (nommer ses colonnes une fois, retenu pour tout le cabinet) |
| **B5** | Des règles plus fines qu'un mot | Nouvelle table des règles : libellé contient, sens, fourchette de montant, compte, TVA, journal, active, compteur, dernière fois. Les « mots retenus » y passent. « Aurait servi à N lignes depuis janvier », deux règles sur les mêmes lignes (la plus précise passe d'abord). Une règle propose, elle n'écrit jamais | L'écran des règles, la nouvelle règle d'après une ligne (menu ⋯ « Retenir une règle ») |
| **B6** | Les rapprochées, ouvertes | Qui a rapproché et comment : SkanFact à l'import, une règle, une personne (`pose_par`, `auto`) | La liste ouverte avec son origine, « Défaire » sur une ligne, « Défaire tous les rapprochements du mois » |

### Saisie

| Lot | Ce qu'il fait | Serveur | Écran |
|---|---|---|---|
| **S1** | Vérifier une pièce saisie par le client | Les contrôles d'une pièce : compte du fournisseur, charge habituelle, TVA lue = TVA écrite, numéro unique chez ce fournisseur, payée et rapprochée, certificat de retenue à remettre. « Marquer vérifiée » (le classement 0179). « Ne plus me faire vérifier » ce fournisseur (un réglage par dossier) | La liste des contrôles, le geste, la confiance |
| **S2** | La pièce au mauvais mois | Repérer une date de pièce dans un autre mois que son écriture. Déplacer, c'est contre-passer à l'ancienne date et réécrire à la bonne. Si le mois est déclaré, une régularisation à la date de la pièce, jamais un mois réécrit | L'effet sur la TVA des deux mois, avant le geste |
| **S3** | Face à la pièce, au Cabinet | La fiche proposée d'après les habitudes du fournisseur. La pièce déjà au livre se joint au lieu d'être saisie deux fois. « Payée par carte » se rapproche en même temps | La pièce en grand, la fiche, d'où vient chaque champ, les pastilles des pièces du mois |
| **S4** | Au kilomètre, complet | Le doublon (même fournisseur, même numéro) refusé avant le geste. Le timbre et la FODEC quand la pièce les porte | Les colonnes, les touches, l'avertissement |
| **S5** | Une facture en devises | La devise et le taux sur la pièce. La contre-valeur en millimes, calculée en entiers. L'écart de change au règlement | Le taux, la contre-valeur, l'écriture, « Demander » la déclaration en douane |
| **S6** | La saisie vide en aperçu | rien de neuf | L'aperçu grisé, « Demander les pièces d'octobre » (la conversation) |

Ordre proposé : **B1, B2, B3**, puis **S1, S2, S3**, puis **B4, B5, B6**, puis **S4, S5, S6**. On commence par ce que le
comptable voit chaque jour : la banque qui se rapproche presque seule et l'écart toujours expliqué.

## Où on en est

- **B1 fait (1.206.0)** : l'écran en deux colonnes, tel que la maquette (`docs/maquettes-appliquees.md`, « Lot Banque B1 »).
  Déjà fait au navigateur avec lui : le « pourquoi » d'une proposition et « Valider les N » (B2, sans la retenue à la source
  ni la remise de plusieurs factures) ; l'équation du relevé, ses pistes et l'état de rapprochement en PDF (B3, calculés au
  navigateur sur le livre du serveur, sans « Joindre au dossier de révision »).
- **B2 fait (1.208.0)** : une ligne du relevé paie des factures encore ouvertes. La facture du même montant (« la seule
  non réglée »), la facture payée au net de sa retenue à la source (au millime, à un taux réglé par le cabinet dans « Les
  règles de la banque », aucun par défaut), la remise de chèques (plusieurs factures dont la somme fait la ligne) se
  proposent ; on coche, on voit l'écriture qui sera passée, et « Rapprocher et lettrer » quand les factures sont validées
  (l'écriture est validée pour être lettrée, ce que l'écran dit avant le geste), « Écrire et rapprocher » au brouillard
  sinon (« Annuler » la retire). Moteur : `piecesOuvertes`, `reponsesDeLigne`, `retenueDeReglement`,
  `ecritureDeReglement` (`compta.js`).
- Suivant : **B3** (« Joindre au dossier de révision »), **B4** (l'import en page), **B5** (les règles en page), **B6**
  (les origines des rapprochées).

## Ce qui attend une décision de Skander

1. **La lecture des pièces au Cabinet** : les pièces du client partent au service de lecture, donc c'est une donnée de
   plus vers un serveur. Sans elle, la fiche se remplit d'après les habitudes du fournisseur (S3 marche quand même).
2. **Le taux de change** : d'où il vient. Soit il est tapé à la main, le dernier retenu étant proposé, et rien ne sort.
   Soit il est lu chez la BCT, et c'est un appel vers un service extérieur. Sans décision, S5 prend le taux tapé.
3. **Le relevé en PDF** : il demande la même lecture que les pièces. Il reste « bientôt » tant que le point 1 n'est pas
   décidé.

## Ce qui est À VÉRIFIER avec un comptable

- La TVA des commissions bancaires et sa déductibilité (6278 + 4366).
- Le taux et le seuil de la retenue à la source (1,5 % dans la maquette), le délai du certificat.
- Les versements d'espèces : 581 Virements internes, ou directement la caisse 54.
- La TVA déductible le mois de la date de la facture.
- Les comptes de perte et de gain de change (656, 756), et la source officielle du taux.
- Le petit matériel (6063) ou une immobilisation, et le seuil.
- Le gasoil d'un véhicule de livraison (TVA récupérable ou non).
