# L'application de bureau et l'agent local

*Étape 4 de la feuille de route (`09` : « l'application de bureau, signée, et l'agent local : clé USB de signature,
imprimante de tickets, tiroir, douchette »). Cadrage : `VISION-ARCHITECTURE.md` § 4.1, `12` § 5, `06` § 10. Décisions
prises par délégation de Skander, le 05/10/2026.*

L'application de bureau est **la même** application web, dans une coque Electron, avec un **agent local** pour ce
qu'un navigateur ne sait pas faire. L'agent tourne dans la coque elle-même : il n'écoute aucun port, ni sur le
réseau ni sur le poste ; seule la page de SkanFact chargée dans la coque lui parle, et il ne fait que ce qu'il déclare
(imprimer un ticket, ouvrir le tiroir, plus tard signer avec la clé USB).

## A. L'imprimante de tickets et le tiroir (brique 136)

**A1. On imprime l'image du ticket, pas une seconde mise en page.** L'écran de la v10 dessine déjà le ticket, le Z et
le bilan du jour (`ticketHtml`, `zHtml`, `bilanCaisseHtml`) ; c'est ce dessin qui part sur le papier. Une seule mise
en page : les mêmes chiffres à l'écran, en PDF et sur le papier, accents compris, sans table de caractères à deviner
selon le modèle. L'image part en **raster ESC/POS** (`GS v 0`), par bandes de 128 lignes (les petites imprimantes ont
une mémoire courte), à la largeur imprimable du rouleau : 576 points sur 80 mm, 384 sur 58 mm (203 points par pouce).
Un point plus sombre que le seuil s'imprime ; le transparent est du papier. Puis la **coupe** avec attache
(`GS V 66`).

**A2. Le tiroir** est branché sur l'imprimante : il s'ouvre par l'impulsion ESC/POS standard (`ESC p 0`, 50 ms),
envoyée **seulement** quand on la demande (un ticket payé en espèces, ou « Ouvrir le tiroir »).

**A3. Deux branchements**, ceux du matériel vendu en Tunisie : par le **réseau** (l'agent se connecte au port brut de
l'imprimante, 9100 par défaut, envoie, ferme) ou par un **port de la machine** (un chemin où l'on écrit les octets
tels quels : `/dev/usb/lp0` sous Linux ; sous Windows, une imprimante partagée en mode brut, `\\localhost\Partage`).
Un échec dit lequel : l'imprimante ne répond pas (`injoignable`), ne prend pas le ticket dans les 5 secondes
(`trop_lente`), le chemin n'existe pas (`chemin_inconnu`) ou refuse l'écriture (`refusee`). Jamais un ticket annoncé
imprimé qui ne l'a pas été.

**À VÉRIFIER** sur le matériel réel, avant J4 : que les modèles vendus en Tunisie (Xprinter, Epson TM-T20, Sewoo…)
impriment le raster `GS v 0` et la coupe `GS V 66` ; le tiroir sur la broche 2 ; l'impression brute par un partage
Windows avec leurs pilotes. Un modèle qui ne suit pas aura son réglage, pas une seconde mise en page.

Code : `bureau/agent/escpos.ts`, `bureau/agent/imprimante.ts`. Tests : `tests/bureau/agent.test.ts` (sans matériel :
une fausse imprimante réseau reçoit les octets, une éteinte et une qui ne lit rien disent leur échec).

## B. La coque de bureau (brique 137)

**B1. La même application.** La coque est une fenêtre Electron (la version de la v10) qui charge SkanFact à son
adresse (`SKANFACT_ADRESSE` sur un poste d'essai ; sinon l'adresse du service, **À VÉRIFIER** : le nom de domaine
n'est pas encore pris). Rien n'est recopié : le bureau n'est jamais en retard sur le web. Lancer :
`npm run bureau` (avec `SKANFACT_ADRESSE=http://127.0.0.1:8090` pour le serveur d'essai).

**B2. L'agent ne parle qu'à SkanFact.** La page reçoit `window.skanfactBureau` avec quatre gestes, et rien d'autre :
`imprimerTicket(html, largeur, { tiroir })`, `ouvrirTiroir()`, `imprimante()`, `reglerImprimante(r)`. Le processus
principal **refuse** chaque geste qui ne vient pas de l'origine exacte de SkanFact (une page d'ailleurs chargée dans
la fenêtre n'obtient rien, et l'imprimante ne reçoit rien). La réponse dit toujours ce qui s'est passé :
`{ ok: true }`, ou `{ ok: false, raison }` (`sans_imprimante`, `injoignable`, `trop_lente`, `chemin_inconnu`,
`refusee`, `reglage_faux`).

**B3. La fenêtre reste chez SkanFact.** Un lien vers ailleurs s'ouvre dans le navigateur du poste, pas dans la coque ;
une fenêtre vers ailleurs ne s'ouvre pas (la fenêtre vierge que la v10 ouvre pour imprimer reste permise). Aucune
permission (caméra, micro, position, notifications) n'est accordée sans qu'une brique le décide.

**B4. La photo du ticket.** Une fenêtre cachée, à la largeur du rouleau en points, dessine le HTML du ticket agrandi
pour que sa largeur en millimètres fasse la largeur imprimable ; elle prend la hauteur du ticket entier (un long
ticket n'est jamais coupé à la hauteur de l'écran) et ne charge **rien d'autre** que ce dessin. Sans écran, Electron
ne dessine pas : le test démarre son propre écran virtuel (Xvfb), la CI l'installe.

**B5. Les réglages du poste** (l'imprimante) vivent dans le dossier de l'application (`bureau.json`), jamais sur le
serveur : une imprimante est celle de ce comptoir.

Code : `bureau/coque/principal.ts`, `bureau/coque/preload.cjs`. Test : `tests/bureau/coque.test.ts` (la vraie coque,
une page « SkanFact » et une page étrangère, une fausse imprimante réseau).

**À faire ensuite** : brancher la caisse de la v10 sur l'agent (le ticket part sans fenêtre d'impression, le tiroir
s'ouvre sur un paiement en espèces, le réglage de l'imprimante dans les Paramètres) ; l'application **signée**
(certificats Apple et Microsoft, `06` § 10) et ses mises à jour ; la clé USB de signature (PKCS#11).
