# La caisse

*01/10/2026, brique 115. Décidé par Skander le 01/10/2026 : la caisse commence maintenant (étape 4 avancée), parce que
son homologation est le jalon le plus incertain. Le cadrage fait foi : `docs/cadrage/01-modele-de-donnees.md` § 10,
`03-droits.md` § 2.1 (« Caisse »), `04-hors-ligne-et-synchro.md` § 3.1, `05-obligations-legales.md` § 3.7 du dépôt
`skanfact`.*

## Le cahier des charges de l'administration : À VÉRIFIER

Une caisse homologuée (plateforme NACEF du ministère des Finances, homologation.nacef.tn) comprend un **module de
saisie** et un **module de sécurisation des données fiscales** qui protège les données et les **transmet** au système
central ; elle produit un **rapport de clôture journalier** électronique et ne permet ni de modifier ni de supprimer
une vente enregistrée (presse, octobre 2025). Le **cahier des charges techniques et fonctionnelles** se télécharge sur
la plateforme, après l'inscription du fournisseur (démarche en cours, père de Skander) ; le site n'est pas joignable
depuis la session de travail. On construit donc d'abord **ce qui n'en dépend pas**. **À VÉRIFIER** avec le cahier :
le chaînage et la numérotation exigés, le délai de transmission, le hors ligne, le Z, les mentions et le QR code du
ticket, ce qui est homologué (logiciel, matériel, une caisse dans un navigateur ?). Tant que la caisse n'est pas
homologuée, rien ne la dit « certifiée ».

## Ce que fait la brique 115 : encaisser en ligne

**T1. Le geste** `caisse.ticket.encaisser` (module Caisse) : le propriétaire, l'administrateur, le **caissier** ; jamais
le commercial (il émet des factures, pas des tickets), jamais une clé de l'API (une personne au comptoir).

**T2. Le serveur numérote et scelle le ticket.** L'écran de la v10 fait le ticket comme avant (`ticketDeCaisse` : le
panier, le mode, le reçu, le rendu) ; il part **sans numéro** à `POST …/dossier-v10/ticket`. Le serveur le numérote
dans **sa série** (`TIC-AAAA-NNN`, créée au premier ticket : un ticket ne prend jamais un numéro de facture, sinon la
série légale des factures aurait des trous), le scelle comme une facture (montants en entiers, pièce émise, maillon du
journal), et enregistre son **paiement dans le même geste**. Un ticket est payé en entier : un paiement qui ne fait pas
le total ne vend rien, et **aucun numéro n'est pris** (tout s'annule).

**T3. Un passant achète « au comptoir »** : une fiche à part, la même pour tous les passants ; un ticket avec un client
prend la fiche du client **du dossier** (jamais celle de l'écran).

**T4. Les chemins ne se croisent pas** : un ticket ne passe pas par la route des factures (refusé), et une facture
émise par l'API ne prend jamais un numéro de la série des tickets. Un ticket n'a pas de fichier de facture électronique
(TEIF) ; un client qui veut une facture pour son ticket : une brique suivante.

**T5. L'écran** : « Encaisser » ne se refuse plus ; le toast dit le numéro donné par le serveur (« Ticket TIC-2026-001
encaissé — à rendre 1,610 DT ») ; le bilan du jour et la liste des tickets lisent les tickets du serveur. Sans réseau,
l'encaissement se refuse avec sa phrase (la caisse hors ligne vient ensuite).

## Ce que fait la brique 116 : la session, son appareil, le Z (01/10/2026)

**S1. Une caisse, un appareil.** La caisse s'**ouvre** (`POST …/caisse/ouvrir`, geste `caisse.session.ouvrir` : P, A,
caissier) sur l'appareil connecté, avec le **fond de caisse** (les espèces déjà dans le tiroir). Elle est alors tenue
par **cet appareil seul** jusqu'à sa fermeture : personne ne la rouvre, et aucun ticket ne s'encaisse d'un autre appareil
(« ouverte sur un autre appareil (Caisse du comptoir, par Sami) : ferme-la là-bas »). Changer d'appareil se fait après
la fermeture. La caisse (« Caisse 1 ») naît à la première ouverture. Le nom de l'appareil est gardé dans la session :
les autres membres ne lisent pas les appareils d'une personne.

**S2. Caisse fermée, rien ne s'encaisse** : le refus dit pourquoi et porte le geste qui débloque. À l'écran, un bandeau
en haut de la page Caisse dit l'état (fermée : le fond et « Ouvrir la caisse » ; ouverte ici : qui, depuis quand, le
fond, « Fermer la caisse (Z)… » ; ouverte ailleurs : lequel, par qui), et « Encaisser » s'éteint avec la même phrase
**avant** le geste.

**S3. Fermer, c'est compter** (`POST …/caisse/fermer`, geste `caisse.session.fermer`) : on tape les espèces comptées
**sans voir** ce que le tiroir devrait contenir ; le serveur calcule l'**attendu** (le fond, plus les espèces encaissées
pendant la session) et l'**écart**, et fige le **Z** sur ses propres tickets de la session : leur nombre, du premier au
dernier numéro, le total TTC, la TVA, les paiements par mode, le fond, l'attendu, le compté, l'écart, qui, où, quand.
Sur l'appareil qui tient la caisse, ou par le propriétaire ou un administrateur depuis ailleurs.

**S4. Un Z ne change plus** (0057, `caisse.session_figee`) : une session fermée est un fait, même en écrivant en base.

**S5. Les tables** (`caisse.caisse`, `caisse.session`, `caisse.ticket` : le ticket et sa session) partent avec
l'entreprise à l'export.

Tests : `tests/v10/caisse-session.test.ts` (fermée ; ouverte par Sami sur la caisse du comptoir ; ni seconde ouverture
ni ticket depuis le bureau de Nadia ; le montant illisible ; deux tickets, espèces et carte ; le Z au millime :
attendu 158,890, compté 157,500, écart −1,390 ; le Z figé en base ; la réouverture sur un autre appareil ; le caissier qui
ne ferme pas d'ailleurs ; le Z de la seconde session qui ne compte que ses tickets), `tests/web/caisse.test.ts` (fermée,
« Encaisser » éteint et sa phrase ; ouverte avec 100 DT ; deux tickets ; fermée avec 123 DT comptés : écart −0,265 ;
quatre écrans regardés). 13 preuves.

## Ce qui part au serveur

Le ticket tel que la caisse de la v10 le faisait déjà (lignes, totaux, mode, reçu, rendu, paiement, client facultatif)
: rien de plus.

## Les tests

- `tests/v10/ticket.test.ts` : le caissier encaisse (TIC-…-001, puis 002), le paiement incomplet qui ne vend rien et
  ne prend aucun numéro, le commercial refusé, le passant « au comptoir » et le client, les règlements au millime, aucun
  fichier TEIF, le ticket refusé par la route des factures, la facture de l'API qui ne prend pas la série des tickets,
  la première facture en FAC-…-001.
- `tests/web/caisse.test.ts` : Nadia encaisse trois laits (10 DT reçus, 1,610 DT à rendre) puis une huile ; le bilan
  du jour (23,265 DT, deux tickets), toujours là après rechargement. Deux écrans regardés.
- `tests/web/parcours.test.ts` : retourné vers la nouvelle règle (la caisse est en ligne, l'entreprise d'essai comprise).
- 12 preuves (`tests/preuves.sh`, brique 115).

## La suite (les briques suivantes)

- Plusieurs caisses dans une entreprise (chacune sa série) ; le Z imprimé sur l'imprimante de tickets ; l'écriture
  comptable par session (`01` § 10, **À VÉRIFIER** avec un comptable : par session ou par jour).
- **Hors ligne** (`04` § 3.1) : tickets numérotés **sur le poste**, chaînés (empreinte du précédent), remontés dans
  l'ordre ; un trou ou une chaîne cassée est une alerte, jamais une correction silencieuse ; 7 jours au plus.
- **Le caissier à l'écran** : sa page Caisse et ses tickets du jour (aujourd'hui il encaisse par le serveur, mais la
  page suit encore la règle des pièces de vente, qu'il ne voit pas) ; changer de caissier avec le code à 4 chiffres.
- **Le retour** avec le code d'un responsable (03 § 2.1), la facture demandée pour un ticket, l'écriture par session.
- **L'agent local** (étape 4) : imprimante de tickets, tiroir, douchette.
