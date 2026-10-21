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

- Le **Cabinet** imprime encore par la fenêtre d'impression du navigateur (`window.print`).
- « Exporter plusieurs PDF » d'un coup (`exportPdfMany`) ne fait toujours rien dans le navigateur.
- **À VÉRIFIER** sur le serveur d'essai : Chromium sous le service systemd enfermé (`ProtectSystem=strict`,
  `NoNewPrivileges`) ; s'il refuse de se lancer, le repli joue, et l'état de la tâche 0011 le dit.

## Tests

`tests/socle/pdf.test.ts` (une facture de 3 × 416,667 à 19 % sur une page, relue par `pdftotext` ; la page enfermée ;
la file ; les refus) et `tests/web/pdf.test.ts` (le téléchargement sous le nom de la pièce, sans fenêtre ; le repli
sans Chromium). Preuves dans `tests/preuves.sh`.
