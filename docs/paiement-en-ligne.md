# Le paiement en ligne

*30/09/2026, brique 78. Le cadrage fait foi : `docs/cadrage/14-fonctions-et-integrations.md` § 2.2 du
dépôt `skanfact` (Konnect au lancement ; l'argent va chez l'entreprise ; la preuve auprès de Konnect ; le
règlement qui se crée tout seul). Ce document dit ce qui en est fait ; toutes les décisions sont prises
par délégation, le 30/09/2026. Il complète `docs/espace-client.md` (brique 77).*

## Ce que fait la brique 78

**P1. L'entreprise branche SON compte Konnect** (Paramètres → Documents → « Paiement en ligne » ; le
propriétaire ou un administrateur, geste `ventes.paiement.regler`, jamais une clé de l'API). Elle donne
l'identifiant de son portefeuille et la clé de son API : l'argent de ses clients va sur SON portefeuille,
SkanFact ne le touche jamais. Le panneau dit ensuite « Branché le … par … : portefeuille …, clé qui
finit par « …» », le dernier refus de Konnect s'il y en a un, et les derniers paiements demandés
(« En attente », « Reçu le … », « Pas enregistré » et pourquoi). « Arrêter le paiement en ligne… » se
demande d'abord ; les paiements déjà reçus restent sur leurs factures.

**P2. La clé ne se garde pas en clair, et ne se relit jamais.** Le serveur la scelle (AES-256-GCM) avec la
clé de SON coffre (`SKANFACT_COFFRE`, dans l'environnement du serveur, jamais dans la base ni dans le
dépôt) ; le scellé est lié à son entreprise (recopié sur une autre, il ne s'ouvre pas). Le compte du
serveur ne peut même pas lire la colonne : seules les fonctions du paiement la reçoivent. Aucun écran ne
la montre : ses quatre derniers caractères seulement. **Défaut trouvé et corrigé avant tout envoi** : le
panneau vit dans le formulaire des Paramètres de la v10, qui ramasse chaque champ nommé dans la fiche de
l'entreprise (le dossier que toute l'équipe et le cabinet lisent) ; les champs du panneau n'ont donc pas
de nom, et leurs frappes ne proposent pas d'enregistrer les Paramètres (un test le vérifie : la fiche
enregistrée ensuite n'emporte pas la clé).

**P3. Le compte de trésorerie « Konnect — paiement en ligne »** naît dans le dossier au premier
branchement (un compte « autre », jamais le compte par défaut), une seule fois. **À VÉRIFIER** avec un
comptable : le compte comptable d'un portefeuille électronique (`01` § 11) ; aujourd'hui il suit la règle
de la v10 pour un compte « autre » (le journal de banque).

**P4. Le client paie le reste d'une facture** : dans son espace, sur une facture qui doit encore, en
dinars, chez une entreprise qui a branché Konnect, « Payer 873,190 DT en ligne » (le bouton principal de
la page). Le montant est le RESTE (le chiffre du serveur, la même fonction que partout) : le navigateur
ne décide d'aucun montant. La demande est notée avant d'aller chez Konnect (sa commande porte notre
identifiant), puis Konnect l'ouvre sur le portefeuille de l'entreprise. Deux clics ne font pas deux
paiements : une demande identique encore ouverte (même facture, même montant, moins de 25 minutes, Konnect
garde son adresse 30 minutes) se redonne, sauf si elle est déjà payée (on le demande à Konnect, et elle
s'enregistre au passage) ou refusée (une nouvelle s'ouvre). **Le dinar seulement** : une facture en euros
le dit, et se règle autrement (**À VÉRIFIER** : les autres devises de Konnect).

**P5. La preuve se redemande à Konnect, avec la clé de l'entreprise** (la règle de la console, 10.9.0).
L'avis de Konnect (`/v1/paiements/konnect?payment_ref=…`) n'est pas signé : il ne décide de rien, il
déclenche la question. La page de retour (`/espace/retour.html`) pose la même question : si l'avis se
perd, c'est elle qui enregistre. Et un filet du serveur redemande, chaque minute, les demandes ouvertes
depuis plus de deux minutes et moins d'un jour : un avis perdu et un client qui ferme la page ne laissent
pas un paiement reçu hors de sa facture. Ne vaut encaissement que « completed », NOTRE commande, NOTRE
montant exact ; un « completed » qui ne correspond pas n'est jamais enregistré, et on dit pourquoi ; tout
autre état attend (jamais un échec définitif : un paiement fini plus tard doit pouvoir s'enregistrer). Le
secret de l'adresse de retour vit dans le fragment « # » (le navigateur ne l'envoie à personne).

**P6. Prouvé, le règlement s'ajoute tout seul à la facture**, une fois : au nom du propriétaire de
l'entreprise (le client n'est pas un utilisateur), mode « Paiement en ligne », référence « Konnect … »,
sur le compte « Konnect », par le même chemin qu'un règlement saisi (ses écritures comprises). La trace
dit `ventes.paiement_en_ligne.encaisser`. Une pièce changée entre-temps : on relit ; un refus du dossier :
la raison se note sur la demande, l'entreprise la voit, et le prochain passage réessaie. Deux vérifications qui se
croisent (l'avis et la page de retour, en même temps) : la demande est verrouillée, celle qui arrive seconde
trouve le paiement enregistré et le dit (« Paiement reçu », jamais « en cours ») ; et un second règlement du
même paiement, s'il était tenté, serait refusé par le dossier (il porte l'identifiant de la demande).

## Ce qui part vers Konnect, compté et décidé

Le portefeuille de l'entreprise, le montant (en millimes), la devise (TND), notre identifiant de demande,
« Facture <numéro> », et nos adresses d'avis et de retour. **Rien du client** (ni son nom, ni son
e-mail, ni son téléphone) : Konnect demande au payeur ce dont il a besoin sur sa propre page.

## À VÉRIFIER avec le bac à sable de Konnect (avant la première entreprise réelle)

- Les champs exacts de `init-payment` et de la réponse de `payments/:ref` (repris de la console, qui
  les emploie depuis la 10.9.0) ; le nom exact des états autres que « completed ».
- Qu'une adresse de retour peut porter un fragment « # », et comment Konnect y ajoute sa référence.
- Que l'avis arrive bien en GET avec `payment_ref`, et s'il est réessayé.
- La commission de Konnect : le portefeuille reçoit-il le montant entier ? (le règlement est du montant
  payé par le client ; la commission se passe en charge au relevé du portefeuille).
- Un client qui fait une retenue à la source paie le net : le reste est déjà net de retenue (le net à
  payer de la v10) ; l'attestation se réclame (`05` § 3.3).

Depuis la brique 79, l'e-mail et le WhatsApp d'une facture portent son lien, et disent « la régler en
ligne » quand elle se règle en ligne (`docs/espace-client.md`, E7).

## Reste à faire

- Une limite d'appels par adresse sur les routes publiques (l'avis, le retour, l'espace) : avec le
  frontal, avant la mise en ligne.
- Flouci (vague 2), ClicToPay et e-Dinar (vague 4) : le même point de branchement.
- La rotation de la clé du coffre (resceller les clés des entreprises).
