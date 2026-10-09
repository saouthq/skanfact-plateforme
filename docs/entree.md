# L'entrée de SkanFact (lot entrée, 06/10/2026)

Les écrans qu'on voit avant l'application : se connecter, créer son compte, le code du téléphone, la porte de la
première fois, ton entreprise, la sécurité, l'ouverture. Refaits d'après les maquettes validées par Skander le
06/10/2026 (« oui go fait tout je valide et les fonctions pas encore faites on les développe »), et d'après ce que le
parcours du débutant avait relevé (docs/debutant.md). Puis, le 09/10/2026, le lot onboarding : le code du téléphone
facultatif (sauf au cabinet), les codes par e-mail, et « Ton compte » dans l'application (plus bas).

## Le dessin

- **Une couleur**, la sarcelle de SkanFact (#0F9D8F), plus soutenue sur les boutons (#0B7A70, lisible en blanc), sur un
  vert presque noir (#0B2724) pour la vitrine, les cartes recommandées et les codes de secours. Thème sombre : il suit
  celui du système (`body.dark`), les boutons passent en menthe sur texte sombre.
- **Deux polices**, servies par le serveur lui-même (la politique des écrans n'admet rien d'ailleurs, et rien ne part
  chez Google) : Bricolage Grotesque pour les titres, Instrument Sans pour le texte ; IBM Plex Mono pour les codes, les
  clés et les matricules. Environ 86 Ko, chargés par l'entrée seulement (jamais par l'application elle-même).
- **La page en deux** (se connecter, créer son compte) : à gauche une vitrine — une vraie facture juste au millime
  (828,000 + 157,320 + 1,000 = 986,320 DT), ou les trois étapes de la première fois ; au téléphone, la marque seule.
- **La page des étapes** (la porte, ton entreprise, la sécurité) : un fond pointé, et en haut le fil
  « ton compte → ton entreprise → la sécurité ». Le code du téléphone et le mot de passe oublié : une carte au centre.
- Code : `web/src/entree.css`, `web/src/composants/Entree.tsx` (marque, vitrines, pages, fil, dessins),
  `web/src/composants/Carte.tsx`, `web/src/ecrans/*`. Les phrases : `web/src/textes.ts` (tout vient du catalogue ; la
  langue factice le vérifie, `tests/web/rendu.test.ts`).

## Ce qui change pour la personne

| Écran | Avant | Maintenant |
|---|---|---|
| Se connecter | « Je n'ai pas encore de compte » : un petit lien gris | « Créer mon compte » : un vrai bouton, sous « Première fois sur SkanFact ? » ; « Afficher » sur le mot de passe ; « Besoin d'aide ? » (la page contact du site) |
| Mot de passe oublié | n'existait pas | voir plus bas |
| Créer ton compte | la longueur minimale dans la bulle « i » seulement | les trois étapes à gauche ; une jauge qui dit pendant la frappe combien il manque |
| Le code du téléphone | une case, et le téléphone perdu dans une phrase | « Téléphone perdu ou changé ? → Utiliser un code de secours » : l'écran dit lequel il attend (le serveur prend l'un ou l'autre dans la même case) |
| Bienvenue | deux cartes serrées, « Je suis un cabinet » en petit bouton | deux grandes cartes, la recommandée en avant ; « Je suis un cabinet comptable » en pilule visible |
| Ton entreprise | « forme juridique comprise », sans exemple ; rien sur le matricule | des exemples (patente : son nom ; société : avec sa forme) ; le matricule dit où le trouver et ce qui manque pendant la frappe (la même règle que le serveur : `commun/matricule.ts`) ; le haut de la facture se dessine à côté |
| Protège ton compte | « ton rôle l'exige » ; l'entreprise créée ? rien ne le disait | « Ton entreprise « X » est créée » ; pourquoi le code, en clair ; ce qui va se passer en trois lignes. **Depuis le 09/10/2026 : pour le seul comptable d'un cabinet** (« Ton cabinet « X » t'attend » ; voir plus bas) |
| Ajoute SkanFact à ton application | les codes de secours en liste, sans rien pour les garder | « Copier » et « Télécharger » (un fichier texte) ; on ne part pas sans cocher « Je les ai mis de côté » (ils ne se montreront plus) |
| L'ouverture | une page blanche le temps du chargement | « On ouvre ton entreprise » : ce qui est fait se coche (le compte, sa protection, l'entreprise), la dernière ligne tourne pendant que les écrans se chargent. Rien n'est inventé ni retardé |

### Revu en ligne (06/10/2026)

Refait à la souris sur app.skanfact.tn, à l'ordinateur et au téléphone, avec un compte fictif neuf : compte, entreprise,
code, codes de secours téléchargés, ouverture, puis reconnexion par le code et par un code de secours. Corrigé ensuite :

- la page des étapes ne se centre plus en hauteur : elle remontait ou descendait quand l'aide du matricule changeait de
  taille pendant la frappe (et le lien « code de secours » fuyait sous le doigt) ;
- la clé à taper à la main ne se coupe plus au milieu d'un groupe de quatre ;
- « Vérifier et continuer » ne se déplace plus quand on coche « Je les ai mis de côté » ;
- rien ne dit « Parfait : le code sera demandé à chaque connexion » avant que le code soit vérifié (la phrase restait
  même après un code refusé) ;
- le refus sans la case cochée la montre (bordure orange), en plus d'y mettre le curseur ;
- « regarde-le se dessiner à côté » devient « pendant que tu tapes » : au téléphone, le haut de la facture est dessous.

Test : `tests/web/entree.test.ts` (« l'entrée ne bouge pas sous la frappe et dit vrai… »), six preuves.

## Le code du téléphone facultatif, les codes par e-mail, Ton compte (lot onboarding, 09/10/2026)

Décidé par Skander le 09/10/2026, sur les maquettes qu'il a validées (« les maquettes me vont, ça m'a l'air premium et
moderne ») :

- **Le code du téléphone n'est exigé que du comptable d'un cabinet**, qui voit les comptes et les salaires de ses
  clients. Pour tous les autres, il est **recommandé**, jamais imposé : la personne qui crée son entreprise y entre tout
  de suite, et l'active quand elle veut dans Ton compte.
- **Un code à six chiffres par e-mail**, si le serveur sait en envoyer : à l'inscription (l'adresse se vérifie), et sur
  un appareil que SkanFact ne connaît pas, pour qui n'a pas de code du téléphone (celui-ci le remplace).
- Le serveur d'essai envoie ses e-mails par Resend (`docs/mise-en-ligne.md`, H) ; la messagerie entre le cabinet et
  l'entreprise vient au lot suivant.

| Écran | Ce que la personne voit |
|---|---|
| Vérifie ton e-mail | Juste après « Créer mon compte » : l'étape 1 sur 3, l'adresse **en entier** (une faute de frappe s'y voit), la case du code, « Rien reçu ? Renvoyer le code » (après 30 secondes), « Pourquoi ce code ? ». En haut : « Ce n'est pas ton adresse ? La corriger » ; le code part alors à la bonne adresse, et l'ancien ne vaut plus. La page rechargée reste là (15 minutes) |
| C'est bien toi ? | À la connexion depuis un appareil inconnu, sans code du téléphone : l'adresse **à demi cachée** (a•••••@exemple.tn), le code reçu, puis l'appareil est reconnu 30 jours (jamais l'ordinateur d'un autre) |
| Ton entreprise créée | L'application s'ouvre aussitôt : plus d'écran « Protège ton compte » entre les deux |
| Ton cabinet créé | L'écran du code d'abord, qui le dit : « Ton cabinet « X » t'attend » |
| Paramètres → **Ton compte** (le premier onglet ; le même dans les Réglages du Cabinet) | Une carte par sujet. **L'adresse** (Vérifiée ou À vérifier) : la changer demande le mot de passe actuel, puis le code reçu à la nouvelle ; l'ancienne est prévenue ; « Vérifier mon adresse » tant qu'elle ne l'est pas (0077, plus bas). **Le mot de passe** : l'actuel, puis le nouveau ; les autres sessions se ferment, celle-ci reste. **Le code du téléphone** (Activé, Exigé ou Désactivé, mis en avant tant qu'il est recommandé) : l'activer en quatre étapes dans une fenêtre (l'application, le code QR ou la clé, les codes de secours à mettre de côté, le premier code) ; de nouveaux codes de secours, changer de téléphone, le désactiver — chaque fois par le code du moment ou un code de secours ; « Désactiver » n'existe pas pour un comptable de cabinet ; un e-mail confirme la désactivation. **Ce que demande un nouvel appareil**, dit selon le cas. **Tes appareils**, venus de « Données et sécurité » |

Les règles que tient le serveur (`base/migrations/0076_code_facultatif.sql`, `serveur/compte.ts`,
`serveur/connexion.ts`) :

- **Le code s'active en deux temps** : préparé (la clé et les codes de secours, montrés une fois), puis activé par le
  premier code juste. Rien ne change avant : une fenêtre fermée en route ne ferme pas la porte. Une page rechargée garde
  la même clé pendant une heure, avec de nouveaux codes de secours ; au-delà, on recommence.
- **Changer de téléphone demande le code actuel** (ou un code de secours) : une session volée ne met pas le sien à la
  place ; l'ancien téléphone vaut jusqu'au premier code juste du nouveau. Le code « posé d'un coup », gardé pour l'API
  (`POST /v1/moi/code`), est refusé quand un code est déjà actif.
- **Le comptable d'un cabinet sans code** (celui qui vient de créer son cabinet, même s'il a déjà son entreprise) : le
  serveur refuse tout sauf de le mettre en place, et les pages de l'entreprise comme du Cabinet le renvoient à l'écran
  du code (`pont.js`, `pont-cabinet.js`).
- **Les codes par e-mail** : six chiffres, 15 minutes, cinq erreurs au plus, cinq envois au plus, pas deux envois en
  moins de 30 secondes. L'adresse est prouvée quand le code est tapé. Elle ne se corrige que pendant la vérification de
  l'inscription, et jamais vers l'adresse d'un autre compte.
- **Ce qui part chez le relais d'e-mails**, compté et décidé (règle du projet) : l'adresse, l'objet, et un texte qui ne
  porte que le code (ou l'avis : adresse changée, code désactivé). Rien d'autre.

Revu à la souris sur un serveur local le 09/10/2026 (inscription, correction d'adresse, rechargement, appareil inconnu,
Ton compte de l'entreprise et du Cabinet), puis par les tests. Corrigé en route : la case du code trop petite, la barre
du haut qui changeait de hauteur, l'écran perdu au rechargement, un cadre doublé autour des cartes, des champs collés
dans les fenêtres ; le refus coupé au bas de la fenêtre d'activation (la fenêtre défile maintenant jusqu'à lui) ;
« Renvoyer le code » trop petit pour un doigt (36 px, remis à 44) ; un « : » seul en début de ligne au téléphone.

Code : `web/src/ecrans/CodeCourriel.tsx` (les deux écrans du code reçu), `web/src/App.tsx` (l'écran du code gardé dans
l'onglet), `web/src/ecrans/CodeRequis.tsx`, `web/public/plateforme/compte.js` et `compte.css` (Ton compte, partagé par
les deux applications), `web/v10/compte.txt` (l'onglet posé dans la v10). Tests : `tests/socle/compte.test.ts`,
`tests/socle/connexion.test.ts`, `tests/web/entree.test.ts`, `tests/web/compte.test.ts`, `tests/web/parcours.test.ts`
(le code activé dans Ton compte, son code QR relu, puis demandé sur un autre appareil).

## L'assistant de démarrage (lot onboarding, 09/10/2026)

Les maquettes validées par Skander le 09/10/2026, construites. Avant lui, l'assistant de la v10 ne s'ouvrait **jamais**
sur la plateforme : il attend une entreprise sans nom, et le serveur la crée avec le sien (vu sur app.skanfact.tn : « la
vraie entreprise s'ouvre sans aucune question »).

La porte (« Ton entreprise », 1 sur 2) demande la raison sociale et le matricule ; l'entreprise créée s'ouvre sur
l'assistant, dessiné comme l'entrée (le fond pointé, le fil des étapes, les mêmes couleurs et les mêmes polices), avec à
droite la facture qui se dessine pendant qu'on répond :

| Écran | Ce que la personne voit |
|---|---|
| Où te joindre ? (Ton entreprise, 2 sur 2) | L'adresse, le téléphone (« +216 » devant la case, enregistré avec le numéro ; un numéro qui commence par + ou 00 reste tel quel), l'adresse e-mail (« Utiliser *l'adresse du compte* » d'un clic), le registre de commerce et le capital. Rien d'obligatoire : « Je le ferai plus tard ». Une adresse e-mail mal formée se refuse sur sa case. L'aperçu est **la vraie facture** de la v10 : le haut (le nom, l'adresse, le matricule, les contacts), le numéro qu'elle prendra, et le pied (le registre, le capital) |
| Que fais-tu ? (Ton activité, 1 sur 3) | Les seize métiers de la v10 en tuiles, chacun avec son catalogue de départ et ses prix d'exemple, la note d'honoraires des professions qui l'emploient, et le régime que le métier propose (la santé : exonéré, À VÉRIFIER). « Continuer » demande un métier, en disant pourquoi ; « Plus tard » passe |
| Factures-tu la TVA ? (2 sur 3) | Les trois régimes, dits à la première personne, « Le plus courant » sur le réel ; l'avertissement « À vérifier avec ton comptable » ; le bas de la vraie facture (une ligne du métier, ses totaux, la mention qui remplace la colonne TVA) qui change avec le choix |
| De quoi as-tu besoin ? (3 sur 3) | « Toujours là » (les modules du cœur), les autres en interrupteurs, ceux du métier allumés et marqués « Proposé pour ton métier » ; le vrai menu se range à droite. « Ouvrir mon entreprise » |

Les règles de l'assistant de la v10, gardées (`web/public/plateforme/assistant.js`) :

- **Chaque écran s'écrit** dans le dossier (l'étape atteinte, ce qui est tapé) : la page fermée ou rechargée reprend là
  où elle s'était arrêtée, sur ce poste ou un autre. « Se déconnecter » en route n'y perd rien.
- **Ce qu'il écrit passe par la v10 elle-même** (`OB.applySetup`) ; ce qu'il montre est lu sur la vraie facture
  (`factureDApercu`, `C.documentHtml`) et le vrai menu (`C.navPages`), jamais recomposé.
- **Un régime ou un menu choisi à la main** ne se fait plus écraser par le métier ; un menu seulement vu ne s'écrit pas
  en route (une reprise le croirait choisi).
- **Revoir l'assistant** (Paramètres → L'application) : ses réponses y sont, rien ne s'écrit avant « Enregistrer mes
  réponses », et la sortie le dit avant le geste : « Fermer sans rien changer ».
- **Il est au propriétaire et aux administrateurs** : un membre de l'équipe ne le voit jamais. Une entreprise créée
  sans la porte (par l'API) s'ouvre sur son accueil.

Une règle change : **le catalogue de départ se verse à la fin**, celui du métier retenu. Versé au premier « Continuer »
(comme dans la v10), il restait celui du premier métier cliqué quand on revenait en choisir un autre. Et l'accueil de la
v10 (« Prends ta gestion en main ») ne repose plus la question de la porte de l'entrée, qui a déjà fait choisir entre
l'exemple et l'entreprise. L'entreprise créée en quittant l'exemple (« Passer à ma vraie entreprise ») ouvre l'assistant
aussi, puis la visite des premiers pas.

Revu à la souris sur un serveur local le 09/10/2026 (ordinateur, téléphone, thème sombre, reprise, rejeu). Corrigé en
route : un grand vide sous l'adresse, « Facture » qui passait sous le nom dans l'aperçu, le rembourrage et le défilement
de la page ouverte de la v10 sur l'assistant, les tuiles écrasées au téléphone (l'icône passe au-dessus du nom), une
coche seule sur sa ligne, une puce de 40 px (remise à 44).

Code : `web/public/plateforme/assistant.js` et `assistant.css` (avec les polices de l'entrée, copiées dans
`web/public/plateforme/polices`, servies comme des polices par le serveur), `web/v10/assistant.txt` (l'assistant de la v10
remplacé, son ouverture), `web/src/ecrans/Porte.tsx` et `web/public/plateforme/pont.js` (`assistantDemande`, l'adresse
du compte). Tests : `tests/web/assistant.test.ts` (le parcours, l'écran et le dossier, le rejeu, le rôle, le
téléphone, les polices et les couleurs), `tests/web/parcours.test.ts`, `tests/web/exemple.test.ts`,
`tests/v10/pont-exemple.test.ts`.

## Les premiers pas refaits, et l'adresse vérifiée dans Ton compte (lot onboarding, 09/10/2026)

La maquette « Tes premiers pas » validée par Skander le 09/10/2026, construite. Le panneau de l'accueil prend le haut
sombre de l'entrée, dit « N sur M faits » avec sa barre, et met la suite en avant : « À faire maintenant », son bouton
le seul en vert. Les étapes, dans l'ordre où elles servent :

| Étape | Faite quand | Son bouton |
|---|---|---|
| Ton compte (et ton adresse vérifiée) | Toujours : on est dedans. Quand le serveur sait envoyer un e-mail et que l'adresse n'est pas prouvée, elle devient « Vérifie ton adresse e-mail », en tête | « Vérifier mon adresse » → Ton compte |
| Ton entreprise et où te joindre | La raison sociale, un matricule fiscal bien formé, et une adresse, un téléphone ou un e-mail. Sinon, ce qui manque se nomme (sans matricule : « une facture sans matricule fiscal n'est pas conforme ») | « Compléter ma fiche » |
| Ton activité, ta TVA et ton menu | L'assistant terminé, avec un métier. Un métier laissé « Plus tard » se choisit ici, en revoyant l'assistant (rien ne s'écrit avant la fin) | « Choisir mon activité » |
| Ton RIB, pour être payé par virement | Seulement quand on attend un virement (un commerce encaisse sur place : pas de RIB réclamé). Un RIB faux ne compte pas, et dit pourquoi | « Ajouter mon RIB » → sa case |
| Protège ton compte — Recommandé | Le code du téléphone actif | « Activer le code » → Ton compte |
| Ton premier client | Un client | « + Créer un client » |
| Ton premier devis (ou ta première facture) | Un devis, ou une facture : qui facture sans devis a commencé aussi | « + Créer un devis » |
| Ta facture à ton image — Facultatif | Un logo ou une couleur | « Personnaliser ma facture » |
| Invite ton comptable — Facultatif | Le dossier proposé à un cabinet (« Ta proposition attend que ton cabinet l'accepte », dit sous l'étape cochée) ou confié | « Inviter mon comptable » → Comptabilité, l'onglet du cabinet |

Les règles (`web/public/plateforme/premiers-pas.js`) :

- **Le panneau quitte l'accueil quand le métier est fait** : ni le code recommandé ni les étapes facultatives ne le
  retiennent (un panneau qui ne partirait jamais serait celui qu'on apprend à ne plus lire). Il ne s'affiche jamais
  dans l'entreprise d'essai, qui a déjà tout ; il se retrouve dans l'Aide.
- **Ce qui vit sur le serveur se dit tel qu'il est** : l'adresse vérifiée, le code du téléphone et le cabinet arrivent
  par le point de contact (`etatDuDemarrage`), lus au chargement puis relus à chaque retour sur l'accueil (au plus
  toutes les cinq secondes) : un code activé dans Ton compte, ou un cabinet choisi, s'y coche au retour, sans recharger
  la page. Tant que rien n'est lu, rien ne se dit fait de travers (le compte compte, le code non).
- **Un compteur et la liste qu'il annonce sont la même fonction** : les étapes ont la forme de `C.firstSteps`, et
  l'accueil, la jauge de fin de visite et « Me guider » les lisent toutes de la même façon.
- **La bulle « Première fois sur cette page ? »** ne se pose plus sur l'accueil quand les premiers pas y sont : elle
  couvrait le tiers d'un téléphone (vu sur app.skanfact.tn le 09/10/2026).

**Vérifier son adresse sans en changer** (`base/migrations/0077_verifier_adresse.sql`). Qui a le code du téléphone ne
reçoit jamais de code par e-mail à la connexion : son adresse restait « À vérifier » pour toujours, et Ton compte disait
« elle se vérifie à ta prochaine connexion », ce qui était faux (trouvé en construisant la première ligne des premiers
pas). Ton compte propose maintenant **« Vérifier mon adresse »** quand le serveur sait envoyer un e-mail : un code part à
l'adresse du compte ; tapé, il la prouve. Mêmes limites qu'un changement d'adresse, dont la demande emprunte la table
(15 minutes, cinq erreurs, trois demandes par heure, comptées ensemble) ; une demande faite avant un changement
d'adresse ne prouve rien. Sans relais, la carte le dit : « tu pourras la vérifier dès qu'il le pourra ».

Revu à la souris sur un serveur local le 09/10/2026 (ordinateur et téléphone, avec le relais d'e-mails). Corrigé en
route : le badge « À faire maintenant » qui ne se lisait pas sur la ligne teintée ; au téléphone, le lien vers l'aide
collé au bord du panneau et les boutons poussés à droite sous leur texte ; la phrase « Ta proposition attend… » cachée
sous une étape faite (la v10 cache l'explication d'une étape cochée : l'attente a maintenant sa propre ligne). Vu sur
app.skanfact.tn avant ce lot, et corrigé : le survol qui restait collé sur une tuile de l'assistant après un toucher
(les survols ne valent plus qu'avec une souris).

Code : `web/public/plateforme/premiers-pas.js` et `premiers-pas.css`, `web/v10/premiers-pas.txt` (le calcul branché, le
panneau, les gestes, la bulle tue, la visite des premiers pas), `web/public/plateforme/pont.js` (`etatDuDemarrage`),
`web/public/plateforme/compte.js` (« Vérifier mon adresse »), `serveur/compte.ts` et `serveur/routes/socle.ts`
(`POST /v1/moi/adresse/verifier` et `…/verifier/confirmer`). Tests : `tests/v10/premiers-pas.test.ts` (le calcul),
`tests/web/premiers-pas.test.ts` (le panneau à la souris, le retour sur l'accueil, le téléphone),
`tests/socle/compte.test.ts`, `tests/web/compte.test.ts`.

## L'exemple, puis ta vraie entreprise (lot onboarding, 09/10/2026)

Maquettes « On prépare l'exemple » et « Ta vraie entreprise » validées par Skander le 09/10/2026. Vu sur le serveur
d'essai le même jour : choisir l'exemple ouvrait une page blanche, puis l'accueil d'une entreprise vide sous une fenêtre
d'attente d'une minute ; sans vraie entreprise, « Quitter l'exemple » ouvrait une petite fenêtre à un seul champ.

- **« On prépare l'exemple »** (`ExemplePrepare.tsx`, `/?exemple=<visite>`) : ton compte, puis les cinq ans d'activité,
  cochés quand le serveur les a vraiment faits ; puis « Commencer la visite ». Une coupure dit quoi faire
  (« Réessayer ») ; un exemple déjà là s'ouvre aussitôt ; une entreprise d'essai encore vide y repart d'elle-même.
- **« Ta vraie entreprise »** et **« Une nouvelle entreprise »** (`EntrepriseNeuve.tsx`,
  `/?entreprise=exemple|menu&retour=<entreprise>&visite=<visite>`) : la page « Ton entreprise » de la porte (la fiche
  et le haut de la facture vivent dans `composants/Fiche.tsx`, partagés), avec le lien qui revient ; créée, l'entreprise
  ouvre l'assistant, puis la visite demandée. Le bouton du bandeau de l'exemple (« Créer ma vraie entreprise » tant
  qu'il n'y en a pas, « Quitter l'exemple » ensuite) et « Nouvelle entreprise… » y mènent.
- Le détail, les refus et ce qui le prouve : `docs/exemple.md`.

## Le mot de passe oublié

1. « Mot de passe oublié ? », sous le mot de passe, **seulement si le serveur sait envoyer un e-mail**
   (`GET /v1/connexion/options`). Sinon l'écran ne propose rien qu'il ne saurait faire.
2. La personne donne son adresse. **La réponse est la même qu'un compte existe ou non** (on ne dit jamais si une
   adresse a un compte), et elle n'attend pas l'e-mail (le temps de réponse ne le dirait pas non plus).
3. Si un compte répond : un lien à usage unique part par e-mail, **valable 30 minutes**. Au plus trois demandes par
   heure pour un même compte (personne ne remplit la boîte d'un autre). Le jeton n'est gardé qu'en empreinte.
4. Le lien ouvre « Choisis un nouveau mot de passe » (le jeton quitte l'adresse aussitôt). **Pour un compte protégé
   par le code du téléphone, le lien seul ne suffit pas** : il faut aussi ce code, ou un code de secours (qui sert une
   fois) ; sinon, qui lirait la boîte de la personne prendrait son compte. Cinq codes faux, et le lien ne vaut plus rien.
5. Le nouveau mot de passe suit la même règle qu'à l'inscription ; **toutes les sessions ouvertes se ferment** ; la
   personne se reconnecte.

**Ce qui part chez le relais d'e-mails**, compté et décidé (règle du projet) : l'adresse de la personne, l'objet, et un
texte qui ne porte que le lien. Ni son nom, ni son entreprise, ni rien de ses données.

Code : `base/migrations/0075_mot_de_passe_oublie.sql`, `serveur/connexion.ts` (`demanderReinitialisation`,
`lireReinitialisation`, `reinitialiser`), `serveur/courriel.ts`, `serveur/routes/socle.ts`, `web/src/ecrans/Oubli.tsx`.
Tests : `tests/socle/mot-de-passe-oublie.test.ts`, `tests/web/entree.test.ts`.

### Le brancher sur un serveur

L'envoi passe par un relais SMTP, réglé dans l'environnement du serveur (jamais dans le dépôt) :

```
SKANFACT_SMTP=smtp://utilisateur:mot-de-passe@relais.exemple:587   (STARTTLS exigé ; ou smtps://…:465)
SKANFACT_COURRIEL_DE=ne-pas-repondre@send.skanfact.tn
```

Sans ces deux lignes, rien ne part : l'écran ne propose pas le mot de passe oublié, et aucun code par e-mail n'est
demandé (on ne demande jamais ce qu'on ne sait pas envoyer). **Décidé le 09/10/2026** : Resend pour le serveur d'essai,
branché d'une ligne par Skander (`exploitation/courriel.sh`, `docs/mise-en-ligne.md`, H). **À DÉCIDER** : le relais du
lancement, en Tunisie (où il garde les adresses : INPDP).

## Ce qui n'est pas fait, et pourquoi

- **Recevoir le code par SMS** : aucun fournisseur de SMS n'est encore choisi (03 § 6 ; `SKANFACT_SMS` n'admet que
  « aucun »). L'écran ne le propose donc pas. À DÉCIDER : le fournisseur.
- **Confidentialité, Conditions** : les pages du site décrivent l'application de bureau (les données sur l'ordinateur) ;
  les lier depuis la plateforme dirait faux. Elles viendront avec les textes de la plateforme (À VÉRIFIER avec un juriste
  et l'INPDP).
- **Le logo** : le « S » dans un carré est provisoire.
- **La suite du lot onboarding** : le parcours de l'exemple puis de la vraie entreprise (X2–X6), puis la messagerie
  entre le cabinet et l'entreprise.
