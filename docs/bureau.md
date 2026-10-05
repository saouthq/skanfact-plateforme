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
