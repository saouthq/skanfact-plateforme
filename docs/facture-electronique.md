# La facture électronique (El Fatoora)

*30/09/2026, briques 80 et 81. Le cadrage fait foi : `docs/cadrage/05-obligations-legales.md` § 3.1 et 3.8, et
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

## Ce que fait la brique 81 : la signature DigiGo

*Décisions prises par délégation le 30/09/2026 ; la vision (§ 5) avait fait de DigiGo le chemin principal.*

**S1. Qui signe.** Paramètres → Documents → « Facture électronique (El Fatoora) » → « Qui signe les pièces
(DigiGo) » : l'identifiant DigiGo du signataire de l'entreprise (celui de son compte chez TunTrust), posé par
le propriétaire ou un administrateur (geste `ventes.efacture.regler`), gardé par le serveur (table
`ventes.signataire`), jamais dans la fiche que toute l'équipe lit. **À VÉRIFIER** avec la documentation
d'intégration DigiGo : ce que DigiGo attend pour ouvrir une session (numéro de téléphone, identifiant, pièce
d'identité).

**S2. Signer, c'est l'acte d'une personne.** Sur une facture ou un avoir émis, « Plus » → « Signer
(DigiGo)… ». Le code se demande d'un geste (« Envoyer le code au signataire » ; jamais en ouvrant la fenêtre,
un SMS partirait à chaque fois) : le serveur ouvre une session DigiGo pour le signataire, et DigiGo envoie
un code sur **son** téléphone. Le code tapé active la session, et le serveur fait signer le fichier TEIF
qu'il a écrit à l'émission (F2), jamais un fichier venu de l'écran. Signer est réservé au propriétaire et à
l'administrateur (geste `ventes.facture.signer`) et **jamais à une clé de l'API** (`horsCle`) : le code
arrive sur le téléphone d'une personne.

**S3. Ce que DigiGo rend est vérifié** (deux chemins, un fichier) : une seule signature `<ds:Signature>`,
et le fichier sans elle est le fichier envoyé, **au caractère près**. Un fichier rendu sans signature, ou
changé, n'est pas gardé. Une demande de plusieurs pièces est **tout ou rien** : si un seul fichier manque ou
ne va pas, aucun n'est gardé, la demande est perdue et dit pourquoi (`motif`), et « Envoyer un nouveau
code » la recommence.

**S4. Le fichier signé se garde** (table `ventes.efacture_signee`, avec son empreinte, le titulaire du
certificat, la demande, qui et quand) : le compte du serveur peut l'ajouter, **jamais le changer ni
l'effacer**, comme le fichier qu'il enveloppe. Une pièce ne se signe qu'une fois. Chaque signature laisse sa
trace (`ventes.facture.signer`, par pièce). « Fichier pour El Fatoora » télécharge désormais le fichier
**signé** (`…_signe.xml`), et sa fenêtre ne demande plus de le signer : il reste un geste, le déposer.
Rouvrir « Signer (DigiGo)… » sur une pièce signée le dit d'emblée (par qui, quand), sans envoyer de code.

**S5. Les refus disent quoi, pourquoi, et le bouton qui débloque.** Personne n'est désigné : « Désigner le
signataire » mène au réglage, le curseur dans la case. Un code faux : « il te reste 2 essais », le même code
se retape. Trois codes faux, ou une session que DigiGo ne connaît plus (expirée) : la demande est perdue,
rien n'est signé, « Envoyer un nouveau code ». DigiGo qui ne répond pas : le même code se retape. Une pièce
sans fichier du serveur (émise avant la brique 80) ne part pas. Un serveur où DigiGo n'est pas branché le
dit.

**S6. Ce qui part vers DigiGo** (liste comptée) : l'identifiant du signataire, le code tapé, et le fichier
TEIF de la pièce (qui porte ce que la facture porte déjà : l'entreprise, le client, les lignes, les
montants). Rien d'autre. La clé de SkanFact comme « entité d'intégration » vient de l'environnement du
serveur (`SKANFACT_DIGIGO`, `SKANFACT_DIGIGO_CLE`), jamais du dépôt.

**S7. Contre un DigiGo simulé.** Tant que l'adhésion DigiGo (démarche du père de Skander, `05`) n'est pas
là, le serveur parle à `tests/digigo-simule.ts`, écrit d'après ce que TunTrust publie de son service
(« tunsign-proxy » : une session pour le titulaire, le code à usage unique qui l'active, la signature d'un
fichier en XAdES). Les noms exacts, les champs et les erreurs sont **À VÉRIFIER** avec la documentation
d'intégration ; `serveur/v10/digigo.ts` est le seul fichier à reprendre. Le simulé signe « pour de faux » :
aucun certificat n'est en jeu.

## Comment c'est vérifié

- `tests/v10/efacture.test.ts` : le fichier passe le schéma officiel (`xmllint`, sur la forme XSD 1.0 du
  schéma 1.8.8 : `tests/donnees/teif/`) et ses deux assertions XSD 1.1 (le matricule, relues par le test) ;
  ses montants sont ceux du serveur, et un fichier qui en dirait un autre se voit ; il ne se réécrit ni ne
  s'efface ; soumise et incomplète, rien n'est émis et le premier numéro reste libre ; non soumise, la
  pièce s'émet.
- `tests/web/efacture.test.ts` : le parcours de Nadia, à la souris, et ses trois écrans.
- `tests/v10/signature.test.ts` : le signataire, le code, le fichier signé gardé tel quel (ni réécrit ni
  effacé), la trace ; un fichier rendu sans signature ou changé n'est pas signé ; une demande de deux pièces
  dont la seconde revient fausse ne garde rien ; trois codes faux perdent la demande ; une pièce sans fichier
  ne part pas ; sans DigiGo branché, rien ne se signe.
- `tests/web/signature.test.ts` : le parcours de Nadia, à la souris : le refus et son bouton, le réglage
  amené à l'écran (le curseur dans la case, sans proposer d'enregistrer les Paramètres), un code faux puis le
  bon, le fichier signé téléchargé tel que le serveur le garde, et la fenêtre qui ne demande plus de le
  signer. Six écrans.

## Reste à faire (`05` § 3.1 et 3.2 ; vision § 5)

- **La signature**, suite : signer plusieurs pièces d'un coup depuis la liste (le serveur le sait déjà), la
  clé USB par l'agent local, puis la signature par le serveur après homologation ANCE. Brancher le vrai
  DigiGo quand l'adhésion est là (S7).
- **L'envoi à la TTN** par la file de travaux, sans jamais envoyer deux fois ; l'état de chaque facture
  (préparée, signée, envoyée, acceptée, refusée) ; la référence et le QR code imprimés sur la pièce et
  montrés dans l'espace client. Contre un simulateur écrit d'après la documentation, tant que l'accès de
  test El Fatoora n'est pas là (`09`, risques).
- « Tes premiers pas » : l'adhésion à El Fatoora expliquée pas à pas, avec le lien.
- **À VÉRIFIER** avec la TTN (`05` § 3.1) : la version du schéma en vigueur, les tickets de caisse,
  l'acompte, la note d'honoraires (I-13), ce que devient une facture refusée.
