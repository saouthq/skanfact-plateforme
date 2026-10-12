# L'équipe de l'entreprise

*12/10/2026, lot équipe (« a » de la liste du 11/10). Le cadrage fait foi : `docs/cadrage/03-droits.md` du dépôt
`skanfact` (§ 2, les rôles ; § 3, D3 à D7 ; § 4.1, qui compte comme utilisateur). Ce document dit ce qui en est fait ;
les décisions marquées « par délégation » sont prises le 12/10/2026.*

Le serveur savait inviter, changer un rôle et retirer quelqu'un depuis la brique 46 (`0003`) ; **aucun écran ne le
proposait**. Un commerçant ne pouvait pas donner un accès à son vendeur ou à sa caissière, et la fiche des testeurs
promettait l'invitation d'une équipe que rien ne permettait.

Le code : la base `base/migrations/0079_equipe_entreprise.sql` (`socle.inviter` refait, `socle.annuler_invitation`,
`socle.apercu_invitation`), les routes `serveur/routes/socle.ts` (`GET /equipe` complété, `DELETE …/invitations/:id`,
`POST /invitations/apercu`), l'écran `web/public/plateforme/equipe.js` et `equipe.css`, branché dans les Paramètres de
la v10 par `web/v10/equipe-entreprise.txt` et `pont.js` (`dessinerEquipe`), et l'entrée de l'invité dans
`web/src/App.tsx` et `web/src/ecrans/Inscription.tsx`. Les tests : `tests/socle/api.test.ts` (l'API) et
`tests/web/equipe-entreprise.test.ts` (à la souris, de l'invitation au retrait).

## Ce que fait le lot

**E1. Un onglet « L'équipe » dans les Paramètres, après « Mon entreprise », pour qui gère l'équipe** : le propriétaire et
un administrateur (03 D3 : ce qui n'est jamais à portée ne se montre pas). Un commercial, un caissier ou la comptabilité
interne n'ont ni l'onglet, ni son entrée dans la palette, ni le panneau dans la recherche des réglages. La base refuse de
toute façon leurs gestes.

**E2. Une ligne par personne** : son initiale, son nom et son adresse, ses rôles en pastilles, et un seul bouton
« Actions » (règle 7.29.0 de la v10). Le propriétaire d'abord, puis les administrateurs, puis par nom. Ni ma propre ligne
ni celle du propriétaire n'ont de menu : personne ne change ses propres rôles (D6), ceux du propriétaire ne se changent
pas, la propriété se transfère (D4). Les invitations qui attendent suivent, avec leur adresse, les rôles prévus et la
date où leur lien cesse de valoir.

**E3. Inviter : une adresse et des rôles cochés, aucun d'avance** (D5 : on élargit un droit en le décidant). Chaque rôle
porte sa phrase (03 § 2) ; les cases vont du plus étroit au plus large, « Administrateur » en dernier. Plusieurs rôles se
cumulent (D7). « Serveur » attend la restauration (vague 1) : il ne se propose pas encore, et se lit quand quelqu'un l'a.
Les refus se disent sur la case : une adresse mal formée, aucun rôle coché, la personne qui fait déjà partie de l'équipe
(« change ses rôles dans la liste » : accepter une invitation remplaçait ses rôles en silence), soi-même.
L'adresse est rangée en minuscules : c'est elle que la personne tapera pour entrer.

**E4. Une invitation par adresse.** Réinviter une adresse qui a déjà une invitation en attente la **remplace** : l'écran
montre une ligne par personne, et l'ancien lien ne vaut plus. C'est aussi le geste « Donner un nouveau lien » quand la
personne a perdu le premier. Une invitation qui attend s'annule (« Annuler l'invitation ») ; déjà acceptée, elle ne
s'annule plus : la personne est dans l'équipe, et c'est elle qu'on retire.

**E5. Le lien part par les moyens de la personne qui invite** (par délégation). Juste après l'invitation, l'écran montre
le lien **une seule fois** (la base n'en garde que l'empreinte) avec « Copier le lien », « Envoyer par WhatsApp » et
« Envoyer par e-mail » (sa messagerie, préremplie). **Le serveur n'envoie rien** : son relais d'e-mails ne reçoit ni
l'adresse de l'invité, ni le nom de l'entreprise, ni le lien — aucune donnée de plus (règle du projet). Le lien vaut
**7 jours, une seule fois, et seulement pour l'adresse tapée**.

**E6. Qui ouvre le lien sans être connecté sait où il va** (par délégation). Sans cela, la personne créait son compte avec
son adresse de tous les jours, et l'invitation lui était refusée au bout du chemin (« envoyée à une autre adresse »).
L'application demande au serveur ce que dit le lien (`POST /invitations/apercu`, public, limité par adresse IP comme les
autres portes publiques) : l'entreprise (ou le cabinet), qui invite, l'adresse réservée, la date de fin — rien de plus,
et rien du tout pour un lien qui ne vaut plus (déjà servi, annulé, remplacé, passé, inventé : la même réponse). Le lien
est le secret ; qui le tient n'apprend que ce que le message qui le portait disait déjà.
- L'écran d'arrivée est **« Créer un compte »**, l'adresse déjà remplie, avec la phrase « (qui) t'invite à rejoindre
  (l'entreprise) sur SkanFact. Crée ton compte avec l'adresse … : l'invitation lui est réservée » et, à côté, ce qui va
  se passer en deux étapes. Qui a déjà un compte passe par « Se connecter », où la même phrase l'attend.
- Un lien qui ne vaut plus mène à « Se connecter », avec la phrase qui dit pourquoi et à qui redemander.
- Une fois connecté, l'invitation s'accepte toute seule et ouvre l'entreprise (le chemin de la brique 46).

**E7. Changer les rôles, retirer.** « Changer ses rôles… » rouvre les cases, cochées comme aujourd'hui. « Retirer de
l'équipe… » demande d'abord, en disant ce qui reste : ce que la personne a fait garde son nom, la trace ne s'efface pas,
son compte reste le sien ; le serveur lui refuse l'entreprise dès sa requête suivante. Réinvitée plus tard, elle revient avec les rôles qu'on lui
coche.

**E8. Ce qui part vers le serveur, compté** (règle du projet). Inviter : l'adresse et les rôles. Changer : les rôles.
Retirer, annuler : rien d'autre que l'identifiant. L'aperçu : le lien. Rien ne part chez le relais d'e-mails.

## Ce qui n'est pas fait, et pourquoi

- **Le prix à la quatrième personne** (03 § 4.1 : « l'écran dit **avant** l'envoi ce que coûte l'utilisateur en plus,
  avec le bouton qui l'ajoute »). L'abonnement ne compte pas encore les utilisateurs : il n'y a rien à ajouter ni à
  annoncer. À faire avec la facturation des offres (`07`), le même jour que le compte des utilisateurs (un caissier qui ne
  travaille que sur les caisses ne compte pas).
- **Prévenir le propriétaire** d'un geste sensible fait par un administrateur (03 D7). Les gestes le déclarent
  (`prevenirProprietaire` dans `serveur/porte/gestes.ts`) ; **rien ne lit ce drapeau**, pour aucun geste. À brancher sur
  l'alerte par e-mail de la messagerie (brique 78), sans contenu.
- **L'e-mail d'invitation envoyé par SkanFact** : non (E5). Si un jour on le veut, c'est une donnée de plus vers le relais
  (l'adresse d'un tiers qui n'a rien accepté) : à décider et à compter avant.
- **Les collaborateurs d'un cabinet** : leur équipe a son propre écran dans le Cabinet ; ce lot ne touche que
  l'entreprise.

## Ce que le parcours à la souris a trouvé

- Les pastilles de rôles changeaient de place d'une ligne à l'autre selon qu'elle portait un menu : chaque ligne est sa
  propre grille, aux colonnes de largeur fixe (10.12.0).
- L'invité arrivait sur « Bon retour » sans savoir où il allait ni avec quelle adresse entrer : l'aperçu (E6).
- L'adresse s'affichait telle que tapée (majuscules) dans le message préparé, alors que la base la range en minuscules :
  le message dit maintenant celle que la personne devra taper.
- L'accueil d'un commercial défilait de côté (une rangée de boutons sans retour à la ligne, `ecrans.css`).
- Encore à régler (lot « b ») : un commercial voit dans les Paramètres « Il manque 2 informations » et « Revoir
  l'assistant », qui ne le concernent pas.
