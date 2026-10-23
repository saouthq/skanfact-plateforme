# Les pièces jointes, gardées dix ans

*21/10/2026, lot Fonctions 3 (1.89.0). Le cadrage fait foi : `docs/cadrage/01-modele-de-donnees.md` § 20 (`fichier`,
`piece_jointe`), `05-obligations-legales.md` § 3.8 (la conservation pendant dix ans). Ce document dit ce qui en est fait.*

## Ce qui change pour la personne

Dans la v10 d'un navigateur, « Joindre un fichier » répondait « pas encore dans la version en ligne ». Maintenant, sur
un devis, une facture, un bon, un achat ou un mouvement de banque :

- **Joindre** : une photo (JPEG, PNG, WebP) ou un PDF, 10 Mo au plus, plusieurs d'un coup. La photo d'une facture d'achat que le serveur vient de lire se joint d'elle-même à l'achat.
- **Ouvrir** (le nom du fichier) : un nouvel onglet. **Télécharger le fichier** (le menu de sa ligne) : une copie sur
  l'appareil (« Montrer dans l'Explorateur » n'a pas de sens dans un navigateur).
- **Retirer** : la question dit ce qui se passe avant le geste. Un fichier que tu as joint il y a moins de 24 heures
  est effacé (une erreur se corrige le jour même) ; plus ancien, ou joint par un autre, il quitte la pièce mais SkanFact
  en garde la copie jusqu'à sa date, et le message la donne.
- La visite guidée « Joindre un justificatif » revient, et la clôture d'un mois regarde de nouveau les achats sans
  justificatif.

## Comment

- **La base garde le fichier** (`socle.piece_jointe`, migration 0160) : nom, type, taille, contenu, empreinte SHA-256,
  qui l'a déposé et quand, **à garder jusqu'au** (dix ans après le dépôt, à Tunis). Aucune mise à jour possible (le
  compte de l'application n'en a pas le droit). Dans la base, il part avec les sauvegardes, la copie hors de la machine,
  et l'export puis la restauration d'UNE entreprise (`base/entreprise.ts`).
- **La pièce garde sa fiche** dans le dossier v10 (`attachments` : nom, identifiant, taille, date), comme avant.
- **Les routes** (`serveur/v10/pieces-jointes.ts`) : `POST /entreprises/:e/pieces-jointes` (le fichier en base 64,
  reconnu à ses premiers octets, jamais à son nom), `GET …/:fichier`, `DELETE …/:fichier` (qui répond `efface` ou la date
  de garde). Les gestes sont ceux du dossier (`socle.dossier.modifier`, `socle.dossier.voir`).
- **Qui voit quoi** : qui voit l'entreprise en entier. Un cabinet qui la tient ne voit pas ses pièces (0035) : il ne voit
  pas non plus leurs fichiers (la porte le refuse, la base le redit). La voisine, rien. (1.125.0) Il sait seulement, pour
  l'écriture née d'un achat, si cet achat porte un justificatif : oui ou non, sans le fichier, son nom ni leur nombre
  (`compta.achats_justifies`, 0173, pour qui lit les livres de l'entreprise) ; c'est ce qui lui permet de le réclamer
  depuis la ligne et d'en être prévenu en validant (`docs/revue-mois-client.md`, points 7, 8 et 13). (1.135.0, décidé
  par délégation le 23/10/2026) Il ouvre, en lecture, les justificatifs de l'achat ou de la vente d'où naît une écriture,
  et rien d'autre (`compta.justificatifs_ecriture` et `compta.justificatif_ecriture`, 0174 ; `GET
  /entreprises/:e/compta/ecritures/:ecriture/justificatifs[/:fichier]`, geste `compta.livres.voir`) : ni un devis, ni un
  bon, ni une pièce sans écriture. Le mandat le dit au client (le périmètre « La comptabilité »).

## Décisions (par délégation, 21/10/2026)

- **Dans PostgreSQL**, comme les fichiers de la messagerie (0078), pas dans un stockage objet : une seule chose à
  sauvegarder, à copier hors de la machine et à restaurer, et l'export d'une entreprise les emporte. À revoir si le
  volume le demande (le cadrage 06 prévoit un stockage objet possible chez l'hébergeur).
- **Photos et PDF seulement**, 10 Mo : la v10 acceptait tout fichier jusqu'à 25 Mo. Un fichier servi par le serveur
  doit être sûr à ouvrir ; un scan, un contrat ou une facture s'enregistrent en PDF. Le refus le dit.
- **Dix ans** pour chaque fichier joint, quelle que soit la pièce (**À VÉRIFIER** avec un juriste : la durée, et si un
  justificatif d'un brouillon jamais émis doit l'être autant). Retirer avant 24 heures, seulement par qui l'a déposé.

## Ce qui n'est pas couvert

- **Une pièce jointe venue de l'application de bureau** (une pièce reprise de la v10) : sa fiche est là, son fichier est
  resté sur l'ordinateur ; l'ouvrir le dit.
- **Le Cabinet** ne voit, de ses clients, que les justificatifs des pièces d'où naît une écriture (1.135.0) ; il ne
  joint rien chez eux (il réclame la pièce, le client la joint).
- **Hors ligne**, joindre demande le réseau (le refus le dit).
- La purge à la fin des dix ans n'est pas écrite (la première arrive en 2036).

## Tests

`tests/socle/pieces-jointes.test.ts` (octet pour octet, l'empreinte et les dix ans ; les refus ; la voisine et le
cabinet ; les 24 heures) et `tests/web/pieces-jointes.test.ts` (à la souris : deux fichiers joints, ouvert, téléchargé,
gardé après un rechargement, retiré ; le refus qui dit pourquoi). Preuves dans `tests/preuves.sh`.
