# La facture électronique (El Fatoora)

*30/09/2026, brique 80. Le cadrage fait foi : `docs/cadrage/05-obligations-legales.md` § 3.1 et 3.8, et
`VISION-ARCHITECTURE.md` § 5, du dépôt `skanfact`. Ce document dit ce qui en est fait ; les décisions sont
prises par délégation, le 30/09/2026.*

## Ce que fait la brique 80

**F1. Le réglage.** Paramètres → Documents → « Facture électronique (El Fatoora) » : « Mon entreprise est
soumise à la facture électronique » (un champ de la fiche de l'entreprise, `efacture`). Une entreprise non
soumise n'est pas forcée (règle produit, `05` § 3.1). Qui est soumis, et depuis quand : **À VÉRIFIER** avec
un comptable (loi de finances 2026, art. 53).

**F2. Le fichier est écrit par le serveur, à l'émission.** Pour chaque facture et chaque avoir émis, le
serveur écrit le fichier TEIF 1.8.8 avec le code de la v10 (`web/public/v10/teif.js`, validé contre le
schéma de la TTN sur les 278 pièces de l'exemple), sur la pièce du dossier : **un seul calcul pour
l'impression et pour le fichier**. Puis il compare le TTC (I-180), la TVA (I-181) et le hors taxes net
(I-176) du fichier aux montants qu'il vient de sceller en entiers : un écart, et rien n'est émis (deux
chemins, un chiffre). Le fichier se garde avec son empreinte (SHA-256) ; le compte du serveur peut
l'ajouter, **jamais le changer ni l'effacer**. C'est lui qui sera signé et envoyé à la TTN (les briques
suivantes), et gardé dix ans (`05` § 3.8). Un ticket de caisse n'a pas de fichier (**À VÉRIFIER** avec la
TTN : les tickets sont-ils concernés ?).

**F3. Soumise, le contrôle passe avant le numéro** (`01` § 6). Une pièce dont le fichier serait refusé
(le matricule de l'entreprise ou l'identifiant du client incomplet, une devise sans code ISO, une pièce
sans ligne) ne s'émet pas. L'écran le dit **avant la confirmation**, dans la fenêtre de la v10 (« Avant
d'émettre : la facture électronique »), avec le bouton qui ouvre la fiche à corriger ; le serveur le
refuse de toute façon, et aucun numéro n'est pris. Non soumise, l'entreprise émet comme avant ; le fichier
s'écrit quand sa fiche et celle du client le permettent.

**F4. « Fichier pour El Fatoora »** (dans « Plus », sur une facture ou un avoir émis) télécharge le fichier
du serveur, tel quel : celui de l'émission, même si la fiche du client a changé depuis. Une pièce qui n'en
a pas (émise avant la brique 80, ou d'une entreprise non soumise dont la fiche ne le permettait pas) :
celui de l'écran, comme dans la v10. La fenêtre dit où il est (« dans tes Téléchargements ») ; le bouton
« Montrer le fichier », qu'un navigateur ne sait pas faire, n'y est plus.

## Comment c'est vérifié

- `tests/v10/efacture.test.ts` : le fichier passe le schéma officiel (`xmllint`, sur la forme XSD 1.0 du
  schéma 1.8.8 : `tests/donnees/teif/`) et ses deux assertions XSD 1.1 (le matricule, relues par le test) ;
  ses montants sont ceux du serveur, et un fichier qui en dirait un autre se voit ; il ne se réécrit ni ne
  s'efface ; soumise et incomplète, rien n'est émis et le premier numéro reste libre ; non soumise, la
  pièce s'émet.
- `tests/web/efacture.test.ts` : le parcours de Nadia, à la souris, et ses trois écrans.

## Reste à faire (`05` § 3.1 et 3.2 ; vision § 5)

- **La signature** : DigiGo d'abord (le code reçu sur le téléphone), puis la clé USB par l'agent local, puis
  la signature par le serveur après homologation ANCE.
- **L'envoi à la TTN** par la file de travaux, sans jamais envoyer deux fois ; l'état de chaque facture
  (préparée, signée, envoyée, acceptée, refusée) ; la référence et le QR code imprimés sur la pièce et
  montrés dans l'espace client. Contre un simulateur écrit d'après la documentation, tant que l'accès de
  test El Fatoora n'est pas là (`09`, risques).
- « Tes premiers pas » : l'adhésion à El Fatoora expliquée pas à pas, avec le lien.
- **À VÉRIFIER** avec la TTN (`05` § 3.1) : la version du schéma en vigueur, les tickets de caisse,
  l'acompte, la note d'honoraires (I-13), ce que devient une facture refusée.
