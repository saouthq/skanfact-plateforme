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

## Ce qui part vers le client, compté et décidé

Des **listes fermées** (`serveur/ventes/espace.ts`), tirées de ce que lit le gabarit d'impression pour
une facture ou un avoir : un champ ajouté demain à une pièce, une fiche société ou une fiche client
reste dans l'entreprise tant qu'il n'est pas ajouté ici. Un test imprime des pièces qui portent chaque
champ imprimé, avec une valeur qui se voit, deux fois : entières (ce que l'entreprise imprime) et
réduites (ce que le client reçoit) ; les deux documents doivent être identiques. Retirer un seul champ
des listes le fait échouer (vérifié champ par champ le 30/09/2026).

| De | Ce qui part |
|---|---|
| La pièce | type, numéro, date, échéance, état, langue, devise et cours, objet, référence, notes, acompte (pourcentage ou montant, numéro du devis), solde d'un devis (son numéro), devis d'origine (son numéro), facture corrigée et motif (avoir), régime de TVA et exonération de retenue figés à l'émission, remise, timbre, retenue, lignes |
| Une ligne | désignation, description, quantité, unité, prix unitaire, taux de TVA, « hors remise » |
| La fiche société | nom, matricule, RC, capital, adresse, téléphone, e-mail, site, RIB, banque, logo, pied de page, slogan, cachet, timbre, couleurs, devise, langue, conditions de paiement (français, anglais), métier (qui fait dire « note d'honoraires »), régime de TVA |
| La fiche client | nom, matricule, adresse, e-mail, téléphone, contact |
| Le serveur | pour chaque facture : montant, payé, avoirs, reste, état ; le total dû par devise |

**Restent dans l'entreprise**, entre autres : le prix de revient et l'article d'une ligne ; **les
paiements eux-mêmes** (dates, modes, comptes, notes : seul leur total part) ; les e-mails envoyés, les
relances, les pièces jointes, l'affaire, la caisse, l'abonnement ; l'adresse du comptable, l'objectif de
chiffre d'affaires, les compteurs, les attestations d'exonération, les conditions des devis ; les notes,
le plafond de crédit, la langue et la devise d'un client ; l'identifiant interne d'un client.

## Reste à faire (§ 2.1)

- ~~« Payer en ligne »~~ : fait à la brique 78 (`docs/paiement-en-ligne.md`).
- **Les bons de livraison** émis.
- **Le fichier XML signé** : avec la signature (DigiGo, puis la signature serveur).
- **Le lien dans l'e-mail et le WhatsApp** qui envoient la pièce ; aujourd'hui, on copie le lien.
- **Une limite d'appels par adresse** sur les routes publiques (celle-ci comme l'entrée) : à poser avec
  le frontal, avant la mise en ligne.
