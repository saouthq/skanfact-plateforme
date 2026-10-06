# L'espace client

*30/09/2026, brique 77. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 2.1 du
dépôt `skanfact` (le client d'une entreprise ouvre un lien et voit, sans rien installer, ses pièces et ce
qu'il doit). Ce document dit ce qui en est fait, décision par décision ; toutes sont prises par
délégation, le 30/09/2026.*

## Ce que fait la brique 77

**E1. Deux sortes de liens, secrets, révocables et tracés.** Sur une facture ou un avoir émis, « Plus »
→ « Lien pour le client… » : le lien **de cette pièce** (elle seule), ou le lien **de son compte**
(toutes ses factures et tous ses avoirs émis, et ce qu'il doit). Un lien se crée d'un geste, jamais en
ouvrant la fenêtre (sinon chaque ouverture en sèmerait un). La fenêtre montre les liens déjà donnés pour
la pièce et pour le compte : « donné le … par … », puis « Vu le … (n fois) », « Pas encore ouvert » ou
« Retiré le … », et « Retirer ». Qui peut donner ou retirer un lien : le propriétaire, un
administrateur, un commercial (le geste `ventes.lien.partager`) ; jamais une clé de l'API, parce que
c'est une personne qui ouvre un accès à un tiers. Donner et retirer s'inscrivent dans l'historique de
l'entreprise (`ventes.lien.partager`, `ventes.lien.retirer`).

**E2. Le lien ne se garde pas en clair.** Il porte 24 octets tirés au hasard (192 bits : le deviner est
hors de portée) ; il ne se montre qu'une fois, à sa création, et la base n'en garde que l'empreinte
(SHA-256) : une copie de la base ne donne aucun lien. Il vit dans le fragment « # » de l'adresse, que le
navigateur n'envoie jamais (ni au serveur dans l'adresse, ni dans les journaux, ni à un autre site) ; la
page le transmet dans le corps d'une requête (`POST /v1/espace`), et ne donne aucune adresse de
provenance (`no-referrer`). **Pas d'expiration** : un lien vit jusqu'à ce qu'on le retire, parce que le
relevé d'un client régulier ne doit pas mourir en silence. **À VÉRIFIER** avec l'INPDP : une durée de
vie maximale.

**E3. Jamais un brouillon, jamais le client d'à côté, jamais un ticket de caisse.** C'est la base qui
choisit (0046, `ventes.espace`) : le visiteur n'est pas un utilisateur, il ne lit aucune table ; la
fonction, qui ne s'appelle que par l'empreinte d'un lien, rend les factures et avoirs **émis** du client
du lien, ou la seule pièce du lien d'une pièce. Le serveur refuse de donner le lien d'une pièce qui
n'est pas émise ou pas à ce client. Un ticket de caisse se remet au comptoir : il n'est pas de l'espace
client (**à revoir** quand la caisse passera par le serveur, étape 4). Un lien retiré ne s'ouvre plus, et
la page le dit : « Ce lien n'est plus valable : demande un nouveau lien à l'entreprise qui te l'a
envoyé. »

**E4. La pièce exactement comme l'entreprise l'imprime.** La page du client (`web/public/espace/`)
dessine la pièce avec le gabarit d'impression de la v10 (`SkanCore.documentHtml`), le même que
l'entreprise ; « Imprimer ou enregistrer en PDF » la met en page comme la v10 le fait pour son PDF. La
pièce s'affiche dans un cadre qui n'exécute rien (`sandbox`), sous une politique de sécurité qui
n'admet que les fichiers de la plateforme.

**E5. Ce qu'il doit : le chiffre du serveur.** Le reste d'une facture se calcule au serveur, avec la
même fonction que la liste des ventes de l'entreprise (`soldeFacture`) : net à payer − avoirs émis −
règlements. Deux écrans, un chiffre. Le relevé dit « Tu dois … » (par devise, additionné en entiers),
puis chaque pièce, la plus récente d'abord : date, échéance, montant, reste à payer, état (« À payer »,
« En retard », « Payée en partie », « Payée », « Annulée ») et ce que la facture a déjà reçu (« Payé : …
· Avoirs : … »). Sur un téléphone, la liste passe en cartes, et chaque chiffre dit ce qu'il est.

**E6. Rien ne change par l'espace client**, sauf le paiement en ligne (brique 78,
`docs/paiement-en-ligne.md`), qui passe par le prestataire de l'entreprise.

**E7. Le lien part dans l'e-mail et le WhatsApp de la pièce** (brique 79, 30/09/2026, par délégation). Un
navigateur ne joint pas de fichier : sur la plateforme, « Envoyer par email… » et « Envoyer par WhatsApp… »
d'une facture ou d'un avoir émis proposent « Ajouter le lien de la pièce » (cochée) à la place de
« Joindre le PDF ». Le lien se crée au clic qui ouvre le message (un geste, jamais à l'ouverture de la
fenêtre), il note par où il part (« envoyé par e-mail le … », « envoyé par WhatsApp le … » dans « Lien pour
le client… », et dans la trace), et sa phrase se place avant la formule de politesse, dans la langue du
message : « Pour voir la facture en ligne : … », ou « Pour voir la facture et la régler en ligne : … » quand
le serveur dit qu'elle se règle en ligne (la même définition que l'espace : une facture qui doit encore, en
dinars, chez une entreprise qui a branché son prestataire). La phrase « Veuillez trouver ci-joint » des
modèles devient « Voici » (rien n'est joint) ; décocher le lien la rend, tant que le message n'a pas été
retouché. Chaque envoi crée son propre lien : la base ne garde que l'empreinte d'un lien, elle ne peut pas
redonner le précédent ; un message ouvert puis abandonné laisse donc un lien jamais vu, que l'on retire
d'un clic. Un bon ou un brouillon partent sans rien de joint (un devis, avec son lien depuis le 06/10/2026 : E9), et la fenêtre le dit (« le bouton
« PDF » l'enregistre ; joins-le ensuite au message » ; « joins-le », un geste du téléphone comme de l'ordinateur, depuis le lot téléphone du 06/10/2026). Paramètres → Envois ne propose plus « Mail
(Apple) avec le PDF joint » : un navigateur n'ouvre que la messagerie de l'appareil. **À VÉRIFIER** sur
Safari (iPhone, Mac) : le message s'ouvre après la création du lien (une attente du serveur) ; Safari peut
demander d'autoriser l'ouverture de la messagerie.

**E8. La facture électronique validée par la TTN** (brique 141, 05/10/2026, par délégation). Sur une facture ou
un avoir que la TTN a acceptés, la page du client propose « Facture électronique (XML) » à côté de « Imprimer » :
le fichier que la TTN a rendu (le fichier signé, avec sa référence et sa signature), **celui qui fait foi**, tel que
le serveur le garde, octet pour octet, sous son nom (`…_ttn.xml`). C'est la base qui choisit (0069,
`ventes.espace_efacture`) : une pièce de ce lien seulement (la même règle que le reste de l'espace), et seulement
acceptée par la TTN ; une pièce signée mais pas encore acceptée n'a pas de fichier à donner (le fichier signé n'est
pas encore la facture). Un lien retiré entre-temps le dit (« Ce lien n'est plus valable… ») ; une coupure du réseau
aussi, et le bouton se reclique. Vérifié par `tests/v10/ttn.test.ts` (la pièce acceptée, une signée pas acceptée,
une autre sorte de pièce, une pièce hors du lien, un lien retiré) et `tests/web/ttn.test.ts` (le fichier téléchargé
est celui du serveur ; la coupure ; le lien retiré).

**E9. Le devis par son lien** (lot du 06/10/2026, par délégation ; vu au téléphone : un devis envoyé par WhatsApp
disait « Veuillez trouver ci-joint notre devis » sans rien de joint, et au téléphone il n'y a pas de PDF à glisser). Un
devis part maintenant avec son lien, par e-mail et par WhatsApp, comme une facture : « Voici notre devis… », puis « Pour
voir le devis en ligne : … » (jamais « et le régler » : un devis ne se paie pas). « Lien pour le client… » se propose sur un
devis envoyé. Un devis n'est pas une pièce légale (ni numéro du serveur, ni sceau) : il ne vit que dans le dossier, et le
client le voit **tel qu'il est aujourd'hui**. C'est la base qui choisit (0073, `ventes.devis_du_lien`) : un devis de CE
client, jamais en brouillon, jamais supprimé ; le lien d'un devis montre lui seul, le lien du compte tous ses devis
envoyés. Le serveur donne le lien d'un devis envoyé ; d'un devis encore en brouillon, seulement par un envoi (l'e-mail ou
le WhatsApp qui le fait passer à « envoyé » juste après) ; s'il est resté en brouillon, la page le dit (« Cette pièce
n'est pas encore envoyée ») sans rien montrer. La page du client range les devis **à part des factures** (« Tes
devis ») : ils ne comptent jamais dans « Tu dois ». Chacun dit son état, avec la règle de la v10 : « En attente de ta
réponse » (et sa validité), « Accepté », « Refusé », « Expiré » (envoyé, et sa validité passée) ; son montant est le total
TTC que la v10 imprime (la même fonction). Pour l'accepter, le devis dit comment (ses conditions) : rien ne change par
l'espace (E6). Et la fiche société que lit la page du client est complétée de ses valeurs par défaut par la même fonction
que la v10 (`migrateData`) : sans elle, une entreprise qui n'a jamais retouché ses conditions (de devis, de paiement)
les imprime, et son client ne les lisait pas. **Reste** : « Accepter ce devis » en ligne (un geste qui change quelque
chose depuis l'espace : à décider) ; un devis sans date de validité (créé par l'API ou repris) imprime « valable
jusqu'au . » (la v10 ne laisse pas vider ce champ à l'écran).

## Ce qui part vers le client, compté et décidé

Des **listes fermées** (`serveur/ventes/espace.ts`), tirées de ce que lit le gabarit d'impression pour
une facture ou un avoir : un champ ajouté demain à une pièce, une fiche société ou une fiche client
reste dans l'entreprise tant qu'il n'est pas ajouté ici. Un test imprime des pièces qui portent chaque
champ imprimé, avec une valeur qui se voit, deux fois : entières (ce que l'entreprise imprime) et
réduites (ce que le client reçoit) ; les deux documents doivent être identiques. Retirer un seul champ
des listes le fait échouer (vérifié champ par champ le 30/09/2026).

| De | Ce qui part |
|---|---|
| La pièce | type, numéro, date, échéance, état, langue, devise et cours, objet, référence, notes, acompte (pourcentage ou montant, numéro du devis), solde d'un devis (son numéro), devis d'origine (son numéro), facture corrigée et motif (avoir), régime de TVA et exonération de retenue figés à l'émission, remise, timbre, retenue, lignes ; la référence de la TTN et le contenu de son code QR d'une facture électronique acceptée (brique 83, décidé le 30/09/2026 par délégation : ils s'impriment sur la pièce) |
| Une ligne | désignation, description, quantité, unité, prix unitaire, taux de TVA, « hors remise » |
| La fiche société | nom, matricule, RC, capital, adresse, téléphone, e-mail, site, RIB, banque, logo, pied de page, slogan, cachet, timbre, couleurs, devise, langue, conditions de paiement (français, anglais), métier (qui fait dire « note d'honoraires »), régime de TVA ; les conditions d'un devis (français, anglais : « Pour accepter ce devis… », décidé le 06/10/2026 par délégation, E9) |
| La fiche client | nom, matricule, adresse, e-mail, téléphone, contact |
| Le serveur | pour chaque facture : montant, payé, avoirs, reste, état ; le total dû par devise ; pour chaque devis : son numéro, sa date, sa validité et son état (E9) |
| Un devis (E9) | les mêmes champs qu'une pièce (la liste ci-dessus) : un devis envoyé, de ce client |
| La facture électronique (E8) | sur demande, pour une pièce acceptée par la TTN : la facture validée par la TTN, entière (ce qu'elle contient est la pièce elle-même : l'entreprise, le client, les lignes, les montants, la signature du signataire et celle de la TTN), et son nom ; décidé le 05/10/2026 par délégation : c'est la facture officielle, adressée à ce client |

**Restent dans l'entreprise**, entre autres : le prix de revient et l'article d'une ligne ; **les
paiements eux-mêmes** (dates, modes, comptes, notes : seul leur total part) ; les e-mails envoyés, les
relances, les pièces jointes, l'affaire, la caisse, l'abonnement ; l'adresse du comptable, l'objectif de
chiffre d'affaires, les compteurs, les attestations d'exonération ; les notes,
le plafond de crédit, la langue et la devise d'un client ; l'identifiant interne d'un client ; un devis en brouillon.

## Reste à faire (§ 2.1)

- ~~« Payer en ligne »~~ : fait à la brique 78 (`docs/paiement-en-ligne.md`).
- **Les bons de livraison** émis.
- ~~Le fichier XML signé~~ : la facture validée par la TTN, à la brique 141 (E8).
- ~~Le lien dans l'e-mail et le WhatsApp~~ : fait à la brique 79 (E7).
- ~~Le devis par son lien~~ : fait le 06/10/2026 (E9).
- **Le relevé de compte envoyé par e-mail** : il part sans le relevé (le message le dit) ; le lien du compte
  y aurait sa place, mais il montre le compte d'aujourd'hui, pas celui de la date du relevé.
- ~~Une limite d'appels par adresse sur les routes publiques~~ : faite à la brique 142
  (`docs/mise-en-ligne.md`, A).
