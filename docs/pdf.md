# Le PDF d'une pièce, fait par le serveur

*21/10/2026, lot Fonctions 3 (1.88.0). Le cadrage fait foi : `docs/cadrage/12-pile-technique.md` § 2 (« la page HTML de
la pièce, imprimée par un Chromium sans écran »). Ce document dit ce qui en est fait.*

## Ce qui change pour la personne

Dans un navigateur, « PDF » ouvrait la fenêtre d'impression : le fichier dépendait du navigateur, et un téléphone n'en
faisait souvent rien. Maintenant le PDF **se télécharge**, sous le nom de la pièce (`FAC-2026-001_Client.pdf`, le nom que
donnait déjà la v10), en une seconde environ, sur l'ordinateur comme au téléphone. Le message « PDF enregistré : … » de
la v10 le confirme.

Un serveur qui n'a pas encore son Chromium (tâche 0011 pas passée), une coupure ou une réponse illisible : la fenêtre
d'impression revient, comme avant. Rien ne se perd.

## Comment

- **L'écran dessine la page** (les gabarits de la v10, `documentHtml` et les autres, inchangés) et l'envoie
  (`exportPdf` du point de contact, `web/public/plateforme/pont.js`) à `POST /v1/pdf` avec son nom.
- **Le serveur l'imprime** comme l'application de bureau v10 (`serveur/pdf/imprimeur.ts`) : une fenêtre de 800 × 600,
  `fitToPage` puis `paginate` (pris dans `core.js`, à la même source que l'écran), A4 sans marge, fonds imprimés.
- **Enfermé** : JavaScript coupé (seules les deux fonctions de `core.js` tournent, envoyées par le serveur), hors ligne,
  chaque demande refusée (une image ou une police de la page doit y être intégrée), aucun fichier de la machine lu. Le
  serveur ne lit rien dans la base : il imprime ce que la personne voit déjà. Ce qui part vers le serveur : la page et
  son nom, rien d'autre (la personne est connectée, le serveur a déjà ces données).
- **La file** : deux impressions à la fois au plus (`SKANFACT_IMPRESSIONS`, 1 à 16), huit en attente pendant une minute
  au plus ; au-delà, « occupé » (503), et l'écran dit de réessayer. Une page de plus de 8 Mo se refuse (413) et dit sa
  taille. Une impression de plus de 20 secondes s'arrête (504).
- **Le geste** `compte.pdf.imprimer` est personnel : il faut être connecté, rien de plus (la page vient de l'écran de
  la personne).

## Au Cabinet (1.92.0)

Les documents de la paie d'un dossier (le bulletin, le journal du mois, l'état récapitulatif CNSS du trimestre, les
documents du personnel) passent par le même chemin : `exportPdf` du point de contact du Cabinet
(`web/public/plateforme/pont-cabinet.js`), le même `POST /v1/pdf`, le même repli. Chacun se télécharge sous le nom que
l'entreprise lui donne : `Bulletin_<salarié>_2026-09.pdf`, `Journal_de_paie_2026-09.pdf`,
`Etat_recapitulatif_CNSS_2026-T3.pdf`, `Certificat_de_travail_<salarié>.pdf` (adaptation `web/v10/pdf-cabinet.txt`).

## Tous les PDF de la période (1.93.0)

« Exporter tous les PDF de la période » (Comptabilité, onglet des ventes) annonçait « Génération de N PDF… » puis ne
faisait rien en ligne. Chaque facture et chaque avoir de la période se fait au serveur, deux à la fois (sa file), et tous
se réunissent dans UN fichier `SkanFact-<période>.zip` qui se télécharge (`exportPdfMany`, pont.js) : un navigateur
demande avant d'enregistrer dix fichiers d'un coup. Le .zip range les PDF sans les recompresser (ils le sont déjà), leurs
noms en UTF-8. Sans l'outil sur ce serveur, rien ne part et le refus le dit : pas cinquante fenêtres d'impression.

## Décisions (par délégation, 21/10/2026)

- **Tout de suite, pas dans la file de travaux.** Le cadrage (12 § 2) mettait le PDF dans la file de travaux
  (pg-boss). Pour un PDF qu'on attend devant l'écran, une seconde, la file ajoutait un aller-retour et un stockage du
  fichier sans rien gagner ; la file bornée en mémoire tient la charge. Les PDF faits sans personne devant (envoi par
  e-mail, archivage des pièces sur 10 ans) passeront par la file de travaux, avec le même imprimeur.
- **Le Chromium de Playwright**, pas celui d'Ubuntu (un « snap » qui ne tourne pas sous le service enfermé). Rangé dans
  `/opt/skanfact/navigateurs`, posé par la tâche 0011 avec ses bibliothèques et des polices (DejaVu, Liberation, Noto),
  et remis à la version du dépôt à chaque installation. `playwright-core` passe dans les dépendances du serveur.
- **La fenêtre d'impression reste le repli**, jamais une erreur sèche : un serveur sans Chromium répond
  « indisponible » (503, `indisponible: true`), que l'écran lit.

## Ce qui n'est pas couvert

- Rien de connu.

## Vérifié sur le serveur d'essai (21/10/2026)

La tâche 0011 a posé Chromium 1194 (celui de `playwright-core` 1.56.1) dans `/opt/skanfact/navigateurs`, et
`PLAYWRIGHT_BROWSERS_PATH` dans les réglages du service. Son journal montre des erreurs « ENOTFOUND
playwright.download.prss.microsoft.com » : c'est l'une des adresses de téléchargement de Playwright, qu'il essaie tour à
tour ; une autre a répondu, et la tâche a réussi. Une facture d'essai imprimée par l'imprimeur du serveur, dans
l'enfermement du service (`systemd-run` avec `User=skanfact`, `ProtectSystem=strict`, `NoNewPrivileges`,
`PrivateTmp`, les réglages du service) : un PDF d'une page, 15 840 octets, en 513 ms.

## Tests

`tests/socle/pdf.test.ts` (une facture de 3 × 416,667 à 19 % sur une page, relue par `pdftotext` ; la page enfermée ;
la file ; les refus) et `tests/web/pdf.test.ts` (le téléchargement sous le nom de la pièce, sans fenêtre ; le .zip de
la période, relu par `unzip` ; le repli sans Chromium) ; au Cabinet, `tests/web/cabinet-paie.test.ts` (le bulletin, le journal, l'état CNSS et le repli) et
`tests/web/cabinet-documents-personnel.test.ts` (le solde de tout compte, le certificat de travail). Preuves dans `tests/preuves.sh`.
