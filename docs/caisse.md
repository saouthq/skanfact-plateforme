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

**S1 bis. Le fond proposé** (05/10/2026, vu sur le serveur d'essai : la caisse créée avec 50 DT s'ouvrait à 0, et le Z
du soir aurait annoncé 50 DT de trop). Le champ du fond de caisse propose ce que le tiroir contient déjà : le solde du
compte de caisse ce jour-là, par la même fonction que la Trésorerie et le bilan du jour (fond de départ, jours
précédents, dépôts en banque compris). La caissière recompte et corrige si le tiroir dit autre chose.

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

## Ce que fait la brique 120 : la caisse sans réseau (01/10/2026, par délégation ; `04` § 3.1)

**H1. Le poste numérote.** La caisse est tenue par un seul appareil (S1) : lui seul prend les numéros de sa série. À
chaque contact, le serveur lui donne le prochain numéro et la forme de la série (« {P}-{AAAA}-{N:3} ») ; sans réseau, le
poste continue la série lui-même (au changement d'année, une série remise à zéro chaque année repart à 1).

**H2. Le poste chaîne.** Chaque ticket encaissé sans réseau porte l'empreinte du précédent :
`empreinte = sha256(précédente || sha256(ticket))`, le ticket écrit sous une forme unique (ses clés dans l'ordre). La
première « précédente » d'une session est celle que le serveur a donnée à son ouverture.

**H3. Ce qui se garde.** Le ticket encaissé sans réseau se garde **chiffré** sur le poste (comme un enregistrement sans
réseau, H5 de `docs/hors-ligne.md`), dans l'ordre ; l'écran dit son numéro et « sans réseau » ; il part seul, **dans
l'ordre**, au retour du réseau. Seulement sur « mon ordinateur » (sur l'ordinateur d'un autre, rien ne se garde : la
caisse refuse sans réseau, en le disant). **7 jours au plus** sans le serveur (**À VÉRIFIER** avec le cahier NACEF) :
au-delà, la caisse refuse d'encaisser sans réseau, en le disant.

**H4. Le serveur vérifie, il ne corrige pas.** Au retour, chaque ticket est émis par le serveur comme en ligne (série,
montants en entiers, maillon du journal du serveur, paiement). Le serveur compare ce que le poste a fait : le numéro
imprimé et celui de la série, la précédente et la dernière empreinte connue de la session, l'empreinte recalculée. Un
écart n'est **jamais corrigé en silence** : le ticket est enregistré, et une **alerte** de caisse le dit (numéro
imprimé, numéro de la série, ce qui ne va pas), visible du propriétaire et de l'administrateur. Un ticket arrivé après
la fermeture de sa session (fermée d'ailleurs par un responsable) est enregistré dans sa session et dit en alerte.
**À VÉRIFIER** avec le cahier NACEF : ce que la loi exige quand le numéro imprimé et celui de la série diffèrent.

**H5. Une fois seulement.** Un ticket renvoyé (la réponse perdue en route) rend ce qu'il a déjà rendu : le même ticket
du même poste ne s'émet pas deux fois. Seul l'appareil qui tenait la caisse remet ses tickets.

**H6. L'écran.** « Encaisser » sans réseau dit le numéro imprimé et « sans réseau (il partira au serveur au retour du
réseau) » ; la page Caisse dit « Sans réseau » et le prochain numéro ; rechargée sans réseau, elle montre les tickets
qui attendent ; le bandeau compte ce qui attend (les changements du dossier et les tickets). Au retour, les tickets
partent seuls, dans l'ordre, avant le dossier ; la page redit l'état de la caisse. Les **alertes de caisse** se lisent
en haut de la page Caisse, pour le propriétaire et l'administrateur, chacune en une phrase (« Le ticket imprimé
TIC-2026-009 est enregistré sous le numéro TIC-2026-005 : les deux numéros diffèrent. »).

Tests : `tests/v10/caisse-hors-ligne.test.ts` (la numérotation apprise à l'ouverture ; un ticket en ligne, deux sans
réseau remis dans l'ordre ; le même renvoyé ; un autre appareil refusé ; chaîne cassée, numéro sauté, empreinte qui ne
se recalcule pas, ticket après le Z : chacun son alerte ; le caissier ne voit pas les alertes),
`tests/web/caisse-hors-ligne.test.ts` (Nadia encaisse en ligne, puis deux tickets sans réseau ; la page rechargée sans
réseau les montre ; un enregistrement du dossier pendant la coupure ne les emporte pas ; plus de 7 jours sans le
serveur, la caisse refuse ; au retour, 002 et 003 partent sous les mêmes numéros, sans alerte ; une chaîne cassée se lit
dans les alertes). 27 preuves (dont 7 reciblées).

## Ce que fait la brique 121 : le caissier à l'écran (01/10/2026, par délégation ; `03` § 2.1 « Caisse »)

**K1. Sa page.** Le caissier ne lit pas les pièces de vente (factures, devis) ; son menu propose quand même la page
**Caisse** (la lecture des droits dit qu'il tient une caisse : `droits.caisse`), sans le bandeau « Lecture seule » :
il vend par la route des tickets.
**K2. Ses tickets** (« voir les sessions : la sienne ») : la lecture du dossier lui rend les tickets qu'il a encaissés,
jamais ceux d'un autre ni les factures ; « Tickets et bilan du jour » les compte.
**K3. La liste des comptes** : il la lit (`tresorerie.comptes.voir`), pour que les espèces aillent au compte de caisse et
la carte à la banque ; ni les mouvements ni la page Trésorerie.

Test : `tests/web/caissier.test.ts` (Sami, caissier : la Caisse dans son menu, pas les Factures ; il ouvre, vend une
huile, voit son ticket et pas celui de Nadia, même après rechargement ; il ferme, écart nul). 7 preuves (et 2 reciblées).

## Ce que fait la brique 122 : un seul tiroir, compté à l'aveugle (01/10/2026, par délégation)

**Constaté** : le bilan du jour (de la v10) disait « le tiroir doit contenir » avec le solde du compte de caisse (son
solde d'ouverture compris), le Z avec le fond de la session : deux chiffres pour la même chose ; et il le disait
pendant la session, alors que le Z se compte **sans voir** ce que le tiroir devrait contenir (S3).
**Décidé** : tant que la session du jour est ouverte, ni la page ni le bilan imprimé ne disent ce que le tiroir devrait
contenir (« Le tiroir se compte à la fermeture (Z), sans voir ce qu'il devrait contenir. ») ; après le Z du jour, la page
redit **les chiffres du Z** (attendu, compté) ; un autre jour, ou sans point de contact : comme la v10. Sur une connexion
lente, le bilan dessiné avant l'état de la caisse se redit à son arrivée.
Test : `tests/web/caissier.test.ts` (pendant la session, à l'écran et sur la bande ; après le Z ; la réponse ralentie).
4 preuves.

## Ce que fait la brique 123 : changer de caissier (01/10/2026, par délégation ; `03` § 6)

À la relève, le caissier suivant prend la caisse **sans mot de passe**, avec son code à 4 chiffres, sur le poste qui la
tient : la session de caisse continue (même tiroir, même Z), et ses tickets portent son nom.

- **R1. Chacun pose son code.** « Mon code de caisse… » (page Caisse), connecté avec son mot de passe, d'où il veut :
  4 chiffres, tapés deux fois ; ni répétés (0000), ni qui se suivent (1234, 9876). Gardé en empreinte (Argon2id), comme
  un mot de passe ; personne ne le lit. Il ne part pas avec l'export d'une entreprise : chacun le repose.
- **R2. Seulement un caissier.** Un membre qui a le rôle Caissier et **aucun** rôle de l'entreprise qui exige le code du
  téléphone (propriétaire, administrateur, paie) : quatre chiffres n'ouvrent jamais ces droits. Un administrateur, même
  caissier, se connecte avec son mot de passe et son code.
- **R3. Seulement sur le poste de la caisse.** L'appareil qui tient (ou a tenu) une caisse de l'entreprise, pas retiré,
  dans une session de « mon ordinateur ». « Changer de caissier… » n'apparaît que là ; la liste ne montre que ceux qui ont
  posé leur code. **Décidé** : le poste n'a pas à être « reconnu 30 jours » (un caissier sans code de téléphone n'a jamais
  d'appareil reconnu) ; c'est l'appareil de la caisse qui compte.
- **R4. Une session fermée à la caisse.** Le relais ferme la session du poste et en ouvre une pour le suivant, sur le
  **même appareil**, qui ne sert qu'à **cette** entreprise : ni le compte (sauf se déconnecter), ni ses autres entreprises.
  Le poste relit tout le dossier (la copie du précédent porte sa personne : il ne voit pas ses tickets). Ce qui attend le
  réseau sur le poste part **avant** : sinon il partirait sous le nom du suivant (le relais est refusé tant qu'il attend).
- **R5. Un code faux le dit** (« la caisse reste à Sami ») ; après 5 erreurs pour la même personne, une attente qui
  s'allonge (1, 5, 15, 60 minutes), que même le bon code respecte ; jamais un blocage. La trace dit qui a passé la caisse
  à qui. **À VÉRIFIER** : prévenir le titulaire après 5 erreurs (03 § 6) ; le SMS n'est pas encore branché.

Tests : `tests/v10/caisse-relais.test.ts` (les codes refusés, l'administrateur sans code, le poste qui n'est pas la
caisse, le code faux, le relais, les tickets à leur auteur, la session qui n'ouvre ni le compte ni l'autre entreprise,
le retour à Sami, l'attente, la trace) ; `tests/web/caisse-relais.test.ts` (Leila pose son code sur son téléphone, prend
la caisse de Sami au comptoir ; trois écrans regardés) ; `tests/web/caisse-hors-ligne.test.ts` (le relais refusé tant
que des tickets attendent). 12 preuves (et 4 reciblées).

**Défaut trouvé le même jour** (le rouge intermittent de GitHub sur `tests/web/caisse-hors-ligne.test.ts`) : après un
ticket en ligne, la copie du poste ne s'écrivait que 300 ms plus tard ; une page rouverte sans réseau dans ce délai
oubliait ce ticket jusqu'au retour du réseau. Un ticket est un fait : la copie le garde maintenant **avant** que l'écran
ne le dise (le test le vérifie aussitôt le ticket encaissé). 1 preuve.

## Ce que fait la brique 124 : le retour, avec le code d'un responsable (01/10/2026, par délégation ; `03` § 2.1)

Une cliente rapporte un article : sur l'aperçu du ticket, « Rendre un article… » ; un avoir s'établit sur le ticket (un
ticket encaissé ne s'annule jamais, `01` R6), et l'argent rendu sort du tiroir.

- **T1. Le code de responsable.** Le propriétaire et l'administrateur posent **leur** code (« Mon code de responsable… »,
  page Caisse) : 4 chiffres, les mêmes règles que le code de caisse, gardé en empreinte. **Décidé** : c'est un code à
  part du code de caisse (brique 123) : il **n'ouvre aucune session**, il approuve un geste, sur l'appareil de la caisse.
  Un caissier n'en a jamais. Qui perd son rôle de responsable n'approuve plus, même avec son code.
- **T2. Le caissier rend avec un responsable présent.** Il choisit le responsable dans la liste (ceux qui ont posé leur
  code) ; le responsable tape son code sur le même poste. Un code faux ne rend rien ; après 5, une attente, jamais un
  blocage. Le propriétaire et l'administrateur rendent eux-mêmes, sans code. L'avoir porte les deux noms (`retourCaisse`).
- **T3. Le serveur ne croit pas l'écran.** Chaque ligne rendue est une ligne du ticket (même article, même prix, même
  TVA) ; jamais plus que ce qui reste à rendre (le vendu moins les retours déjà faits) ; l'argent rendu est le net de
  l'avoir qu'il scelle lui-même, ce jour, vers un compte du dossier.
- **T4. L'avoir est numéroté par le serveur** dans la série des avoirs (AVO). **Décidé** : le caissier prend cette série
  pour ce geste seulement (`caisse.serie_retour`) ; la route des avoirs garde son geste (il n'émet pas d'autre avoir).
  Le retour d'un ticket « au comptoir » (sans client) se fait sur la même fiche « Vente au comptoir ». Pas de fichier
  TEIF pour un avoir de caisse, comme pour le ticket (**À VÉRIFIER** avec la loi de la facture électronique).
- **T5. Le tiroir.** Le retour se fait sur l'appareil qui tient la caisse ouverte (l'argent sort de **son** tiroir) ; il
  est rangé dans la session (`caisse.retour`). Le Z dit l'argent rendu par mode, et le tiroir attendu le retire. Un
  caissier voit les retours faits sur ses tickets (sinon sa page lui proposerait de rendre deux fois).
  **À VÉRIFIER** : rendre un ticket d'un autre caissier (la recherche d'un ticket par son numéro) ; la remise au-delà
  du plafond et le tiroir ouvert sans vente, avec le même code (`03` § 2.1).

Tests : `tests/v10/caisse-retour.test.ts` (les codes, le caissier sans responsable, le code faux, plus que vendu, un
autre prix, un autre montant, un autre appareil, AVO-…-001 aux deux noms, AVO-…-002, plus rien à rendre, l'attente, le
responsable qui ne l'est plus, le Z, ce que voit le caissier) ; `tests/web/caisse-retour.test.ts` (Nadia pose son code
à son bureau ; Sami rend un pain au comptoir avec elle, un code faux d'abord ; le bilan, la page rouverte, le Z ; trois
écrans regardés). 16 preuves (et 4 reciblées). Défaut trouvé en chemin : « Mon code de caisse… » recevait l'événement du clic, pris
pour « responsable » : le caissier posait un code de responsable (refusé). 1 preuve.

## Ce que fait la brique 125 : la remise à la caisse (01/10/2026, par délégation ; `03` § 2.1)

La caisse de la v10 n'avait pas de remise : le ticket en cours a maintenant un champ « Remise (%) », sur tout le ticket,
compté par le moteur comme la remise d'une facture. Elle se lit **en TTC, comme les lignes du ticket** (les lignes, moins
elle, font le total avant timbre), avec la même fonction à l'écran et sur le ticket imprimé (`remiseTtc`).

- **M1. Le plafond de la caisse.** « Remise permise sans code à la caisse (%) », dans Paramètres → Caisse, réglé par le
  propriétaire ou un administrateur, jusque dans la base (0064). **Décidé** (`03` § 2.1) : **vide, il vaut 0 %** —
  toute remise d'un caissier demande alors un responsable. Le propriétaire et l'administrateur remisent sans code.
- **M2. Au-delà, le code d'un responsable présent, demandé AVANT le geste** : « Encaisser » ouvre la fenêtre « Remise de
  10 % » (le responsable, son code) ; le serveur vérifie (le même code de responsable que le retour, brique 124 ; 5
  erreurs, une attente) ; un code faux ne vend rien, le panier attend. Le ticket porte le taux et le nom du responsable
  (`remiseCaisse`).
- **M3. Le serveur lit la remise sur le ticket**, jamais ce que l'écran en dit ; une remise illisible compte comme la
  plus forte. Une remise hors de 0 à 100 % ne s'encaisse pas, et le motif le dit avant le geste.
- **M4. Sans réseau**, le code ne se vérifie pas (la liste des responsables ne se lit même pas) : un ticket remisé au-delà
  qui arrive sans code s'enregistre (c'est un fait), et l'écart devient une **alerte de caisse** pour le propriétaire.
  **À VÉRIFIER** : une remise par ligne (aujourd'hui sur tout le ticket) ; les listes de prix et les prix du client à la
  caisse (`remiseEffective` des factures, brique 104).

Tests : `tests/v10/caisse-remise.test.ts` (sans remise, 10 % sans code, code faux, code d'un caissier, le bon code ; Nadia
règle 15 %, pas Sami, ni par l'écran ni en base ; 10 % sans code, 20 % non ; sans réseau, l'alerte) ;
`tests/web/caisse-remise.test.ts` (120 % refusé avant le geste ; 10 % lu dans les totaux sans que « Encaisser » bouge ;
aucun responsable : la fenêtre le dit, « Approuver » gris ; Nadia, seule, déjà choisie, le curseur dans son code ; un
code faux, le bon ; le ticket imprimé dit sa remise ; Nadia règle 15 % dans les Paramètres ; 10 % sans code). 21
preuves (et 3 reciblées).

**Vu à l'écran, à la main (01/10/2026)** — le premier passage « comme un humain » (`scripts/humain/`, ci-dessous), que
les tests verts n'avaient pas vu : (1) le ticket **imprimé** n'avait pas de ligne de remise (lignes 3,852, total 3,467 :
le client ne pouvait pas refaire le compte) ; (2) le panier disait la remise en HT (− 0,240) quand le ticket la disait en
TTC (− 0,257) : deux chiffres pour la même chose ; (3) sans responsable, la fenêtre de la remise parlait d'« un retour »,
tassée dans une colonne, et « Approuver » restait cliquable ; (4) un seul responsable restait à « Choisis… » ; (5) la
ligne de remise, en apparaissant, poussait « Encaisser » de 20 px ; (6) le champ de la remise collait à celui du reçu ;
(7) le texte de « Mon code de responsable » ne parlait que du retour. Tous corrigés, chacun avec sa preuve. Noté, sans
défaut : un poste qui ne tient pas la caisse montre le panier, mais « Encaisser » y est gris et dit pourquoi.

**Deuxième passage à la main (01/10/2026), sur les briques 123 et 124** — deux défauts sérieux, que les tests verts ne
voyaient pas : (8) **le retour d'un article d'un ticket remisé rendait le prix plein** (1,284 DT rendus pour 1,156
payés) : l'avoir du retour ne gardait pas la remise du ticket, et le serveur ne le vérifiait pas. Corrigé des deux
côtés : l'écran (l'annonce « À rendre au client » et l'avoir) garde la remise du ticket, et le serveur refuse un avoir de
retour qui ne la garde pas, ou qui rendrait le timbre (`caisse.retour_remise`). (9) **« Prendre la caisse » renvoyait la
caisse à la page de connexion** sur un vrai poste : la connexion garde le jeton à deux endroits du navigateur (la session,
lue en premier, et la mémoire du poste) ; le relais ne remplaçait que le second, la page relisait l'ancien jeton (fermé
par le relais). Corrigé : remplacé aux deux endroits ; le test d'écran garde maintenant le jeton comme une vraie
connexion, et rouvre la caisse dans un nouvel onglet. Vu aussi, à reprendre : la bulle « Première fois sur cette page ? »
recouvre la fin du bandeau orange de la caisse. **À VÉRIFIER** (avec un comptable) : un ticket rendu en plusieurs fois
peut s'écarter d'un millime de ce qui a été payé, par l'arrondi de la TVA de chaque avoir (comme la v10).

## Ce que fait la brique 126 : le Z imprimé et relu (01/10/2026, par délégation)

Vu à la main : le Z se lisait une fois, à la fermeture, puis disparaissait ; il ne disait ni qui avait fermé la caisse ni
quand, et ne s'imprimait pas.

- **Z1. Le Z dit qui a fermé la caisse, et quand** (`fermePar`, `fermeeLe`, figés avec lui).
- **Z2. « Imprimer le Z »** : la même bande que le ticket et le bilan du jour (80 ou 58 mm, `zHtml`), avec les seuls
  chiffres que le serveur a figés à la fermeture (rien ne se recompte sur le poste).
- **Z3. Les Z passés**, dans « Tickets et bilan du jour », les plus récents d'abord, 20 par page (« Plus de Z… ») ; chacun
  se rouvre et se réimprime. **Décidé** : le propriétaire et l'administrateur lisent tous les Z ; un autre membre, ceux
  des sessions qu'il a ouvertes.

Vu aussi à la main, et corrigé : une caissière qui a pris la caisse avec son code (brique 123) puis la rouvre sur le même
poste l'ouvrait sous le nom « — » (elle ne lit pas les appareils d'une autre personne) ; le poste garde maintenant le nom
que la caisse lui connaît. **À VÉRIFIER** (avec un comptable, et le cahier des charges des caisses) : les mentions
obligatoires d'un Z imprimé, et combien de temps il se garde.

Tests : `tests/v10/caisse-z.test.ts` (21 sessions : qui ferme, l'ordre, les pages, un curseur illisible, qui lit quoi),
`tests/web/caisse-z.test.ts` (la fermeture, la bande imprimée lue, la liste, « Plus de Z… », un Z rouvert) ;
`tests/v10/caisse-relais.test.ts` (le nom du poste rouvert). 15 preuves.

## Le comptoir, après le parcours sur le serveur d'essai (05/10/2026)

Le parcours complet de la caisse, à la main, sur `app.skanfact.tn` (méthode par lot) a relevé vingt défauts. Ceux qui ne
dépendent pas du dessin de l'écran sont corrigés ici (`web/v10/comptoir.txt`, `web/public/plateforme/dates.js`) ; les
autres viennent avec la nouvelle caisse tactile (maquette validée par Skander le 05/10/2026, lot suivant).

- **S1 ter. Le prix de l'étiquette.** Un commerçant connaît le prix TTC de son étiquette : 4,200 HT tapé arrivait à
  4,998 DT en caisse, jamais aux 5,000 voulus. La fiche d'un article a maintenant un champ « Prix TTC » à côté du HT :
  tapé, il donne le HT qui y retombe exactement (le calculateur de la v10, « Prix TTC visé », en millimes entiers) ; le
  HT tapé, le TTC se calcule comme la tuile de la caisse (`ligneDePanier`, `computeTotals`). Quand la TVA change, le
  prix tapé en dernier tient. Un TTC qu'aucun HT n'atteint (5,001 à 19 %) donne le plus proche, et la fiche le dit. Le
  TTC ne s'enregistre pas sur l'article : son HT et sa TVA le disent déjà (rien de plus ne part au serveur). La phrase
  de marge ne parle plus de « prestation ».
- **B1. Le bilan du jour dit le net.** Un retour (un avoir sur un ticket) compte au jour du retour ; la carte devient
  « Ventes du jour, retours déduits », avec les ventes, les retours et leurs avoirs ; le bilan imprimé aussi.
- **Z4. Le Z cite ses retours.** Le serveur fige avec le Z les avoirs de la session (numéro, ticket repris, argent
  rendu), leur total, le net des ventes et sa TVA ; l'écran et la bande imprimée les disent. Un Z figé avant n'a pas ces
  chiffres : il se lit comme avant.
- **Les dates** des champs du navigateur s'écrivent JJ/MM/AAAA quelle que soit sa langue (`docs/pont-v10.md`,
  § 4 quinquies).

Tests : `tests/web/caisse-premier-article.test.ts` (le prix TTC, dans un navigateur en anglais),
`tests/web/caisse-retour.test.ts` (le bilan, le bilan imprimé, le Z et sa bande), `tests/v10/caisse-retour.test.ts` (le
Z figé : ses avoirs, son net), `tests/web/dates.test.ts`, `tests/web/cabinet-abonnements.test.ts`. 25 preuves.

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
- Hors ligne : fait (brique 120, plus haut).
- Le caissier à l'écran : fait (brique 121). Changer de caissier avec le code à 4 chiffres : fait (brique 123).
- Le tiroir du bilan du jour : fait (brique 122, plus haut).
- Le retour avec le code d'un responsable : fait (brique 124). La facture demandée pour un ticket, l'écriture par session.
- **L'agent local** (étape 4) : imprimante de tickets, tiroir, douchette.
