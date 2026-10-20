# La recette : une entreprise neuve, son cabinet et la console

*Refaite à la souris et au clavier le 20/10/2026, sur le serveur local (données inventées), version 1.74.0 : deux
navigateurs séparés (l'entreprise, le cabinet) et la console SkanFact dans un troisième onglet. Une personne crée sa
boîte sans comptable ; une autre crée son cabinet sans client ; on les relie ; chaque étape se regarde aussi depuis la
console. Ce document dit ce qu'elle a trouvé et ce qui en est corrigé, lot par lot.*

## Ce qui marchait déjà, vu à l'écran

- **Entreprise neuve** : compte, entreprise, coordonnées, métier, TVA, menu, « Tes premiers pas » ; premier client ;
  devis (calculs justes au millime) ; devis → facture → émise (confirmation avant le numéro) ; paiement partiel avec la
  création du compte en banque depuis la fenêtre ; tableau de bord.
- **Console** : la nouvelle entreprise (ville, essai de 30 jours, propriétaire) ; « Prolonger l'essai » → chez le client,
  la pastille et l'histoire le disent, sans le motif.
- **Cabinet neuf** : compte, cabinet, code du téléphone exigé, page Dossiers qui explique comment un client arrive (le
  code du cabinet) ; un dossier tenu pour un client hors SkanFact ; la console voit le cabinet et le dossier tenu.
- **Le lien** : le code du cabinet tapé chez le client → proposition chez le cabinet → acceptée → les pièces du client au
  brouillard, validées → « Mon comptable » chez le client ; les messages dans les deux sens.

## 1.75.0 — côté entreprise (20/10/2026)

### Ce que le lot corrige

- **La touche Tab ne s'arrête plus sur les « i » d'aide** (`Info.tsx` des écrans d'entrée, `info()` de l'application et
  du Cabinet : `tabindex="-1"`). Au clavier, à la création du compte, chaque « i » prenait un Tab : l'adresse se perdait
  et le mot de passe tombait **en clair** dans la case de l'e-mail. La bulle s'ouvre toujours à la souris, au doigt, et le
  lecteur d'écran la lit.
- **« Ton compte est créé » se lit en haut des écrans d'entrée** (`entree.css`) : en bas, il recouvrait « Je suis un
  cabinet comptable », précisément le bouton d'un comptable qui vient de créer son compte.
- **La ville donnée à « Ton entreprise » ouvre l'adresse** de « Où te joindre ? » (`serveur/v10/dossier.ts`, la fiche de
  départ) : on la retapait. Elle est la dernière ligne de l'adresse, là où la v10 lit la ville.
- **Une pièce neuve prend le client quand il n'y en a qu'un**, avec ce qui se copie de sa fiche : « Ton premier devis »
  s'ouvrait vide juste après la création du seul client. Avec deux, elle attend qu'on choisisse.
- **Un montant refusé dit ce qui est attendu** : « Écris le montant en chiffres, plus grand que zéro : par exemple
  250,500. » (le paiement d'une facture, le règlement d'un fournisseur, un mouvement de trésorerie), au lieu de
  « Montant invalide. ».
- **Les champs de nombre** (`virgule.js`) : un champ qui ne descend pas sous zéro refuse le signe moins à la frappe ;
  aucun ne propose plus les valeurs déjà tapées ailleurs (la liste du navigateur se posait sur la case suivante).
- **« Tes premiers pas » ne part plus avec ce qui reste** : les étapes du métier faites, une carte plus petite dit
  « Tes premiers pas sont faits » et ce qui reste (protéger son compte, sa facture à son image, inviter son comptable),
  chacun avec son bouton, sans bouton vert (l'en-tête de l'accueil reprend le sien). « Ne plus afficher » la masque pour
  la personne. Jamais dans l'exemple ni dans l'entreprise d'essai.
- **Paramètres › Envois** : l'adresse du comptable s'appelle « Envoyer tes écritures par e-mail » et renvoie à « Ton
  cabinet comptable », plus bas, pour un comptable qui a SkanFact Cabinet ; la recherche ne propose plus deux fois
  « Ton comptable ».
- **« Ton abonnement »** : deux prix lus côte à côte s'écrivent de la même façon, avec leurs millimes dès que l'un en a :
  « 12,000 DT HT par an ou 1,200 DT HT par mois ». « 12 DT … ou 1,200 DT » se lisait « mille deux cents ».

### Décidé par délégation (20/10/2026)

- « Où te joindre ? », « Que fais-tu ? » : l'espace avant « ? » est là, c'est l'espace fine insécable de la typographie
  française (`typoFr`, comme toute l'application) ; dans ces polices elle est étroite. Rien n'est changé.
- La bulle « i » n'est plus dans l'ordre de la touche Tab, plutôt qu'un raccourci clavier de plus : la saisie au clavier
  passe avant l'aide, que la souris et le lecteur d'écran atteignent toujours.
- La ville seule ouvre l'adresse (la rue s'écrit devant elle) : un client qui saute l'étape a déjà sa ville imprimée.

### Ce qui le prouve

- `tests/web/recette-entreprise.test.ts` : au clavier, le compte se crée case après case (le mot de passe masqué dans sa
  case) ; le message au-dessus de « Je suis un cabinet comptable » ; « Nabeul » dans l'adresse de « Où te joindre ? » ; le
  seul client pris par la pièce neuve, aucun parmi deux (un second poste) ; Tab dans une fiche client ; un paiement : le
  signe moins refusé, aucune proposition du navigateur, le refus qui dit ce qui est attendu sur sa case, rien au
  serveur ; ce qui reste des premiers pas (deux gestes, aucun bouton vert, le comptable mène à l'onglet du cabinet,
  « Ne plus afficher » tenu après rechargement) ; Paramètres › Envois.
- `tests/v10/dossier.test.ts` : la ville donnée à la création ouvre l'adresse de la fiche ; sans ville, pas d'adresse.
- `tests/web/cabinet.test.ts` : au Cabinet aussi, aucun « i » dans l'ordre de la touche Tab.
- `tests/web/offre-compte.test.ts` : « 12,000 DT HT par an ou 1,200 DT HT par mois ».
- Dix-sept preuves (`tests/preuves.sh`, « 1.75.0 »), et deux des briques des règlements et des achats reprises sur leur
  texte d'aujourd'hui (un paiement trop précis, un règlement fournisseur trop précis).

### Refait à la souris (20/10/2026)

Un navigateur neuf, une personne inventée : le compte créé au clavier seul (nom, Tab, e-mail, Tab, mot de passe : chaque
morceau dans sa case, le mot de passe masqué) ; « Ton compte est créé : bienvenue dans SkanFact » en haut, « Je suis un
cabinet comptable » visible dessous ; « Gharbi Electricite SARL » à Nabeul : « Où te joindre ? » s'ouvre avec « Nabeul »
dans l'adresse, et l'aperçu de la facture l'imprime. Le matricule et le RIB renseignés depuis les premiers pas, le
premier client créé au clavier (Tab d'une case à la suivante) : « + Créer un devis » s'ouvre sur lui. Le devis
enregistré, l'accueil dit « Tes premiers pas sont faits » et les trois gestes qui restent ; « + Nouvelle facture »
reprend le vert ; « Ne plus afficher » la masque. La facture émise, un paiement : « -50 » tapé donne « 50 » ; vide, le
refus dit ce qui est attendu sur sa case. La recherche « comptable » distingue « Ton cabinet comptable » et « Envoyer tes
écritures par e-mail » ; « Ton abonnement » écrit « 12,000 DT HT par an ou 1,200 DT HT par mois ».

Vu et corrigé : « Ne plus afficher » ne se voyait pas sur le haut sombre de la carte (le bouton fantôme de la page, sombre
sur sombre) ; il a son style clair.

## 1.76.0 — le Cabinet et la console (20/10/2026)

### Ce que le lot corrige

- **La page Dossiers se relit quand on y revient** (`web/v10/recette-cabinet.txt`) : lue au démarrage seulement, elle
  ne montrait la proposition d'un client qu'après rechargement, et gardait « à valider » sur un mois qu'on venait de
  valider. Une lecture à la fois ; la page se redessine si on y est encore.
- **« Tout est à jour »** se dit du client : « ton client sur SkanFact n'a aucun mois passé vide ni à valider » (au lieu
  de « chez ton dossier »).
- **Un client qui n'a écrit que le mois en cours** : « Ses écritures commencent en octobre 2026 : un mois n'est attendu
  qu'une fois fini », au lieu de « l'attente démarre à la première écriture » sous « 1 mois écrit ».
- **Une période sans écriture validée** dit ce qui attend au brouillard (« 1 écriture de l'exercice attend au
  brouillard. Elle se valide dans la saisie. ») et son bouton « Voir le brouillard » y mène.
- **L'e-mail et le téléphone d'un client sur SkanFact** viennent de sa fiche société : le dossier les montrait « à
  renseigner ». Ce que le cabinet a écrit dans sa propre fiche l'emporte.
- **Les mots** : « Adresse du client » (pas « de l'employeur ») ; « Écritures qui reviennent » partout où la saisie
  disait « abonnement » (le titre, la liste, le menu, la fenêtre, les aides et la visite guidée) : le mot se lisait
  comme l'abonnement à SkanFact. La porte : « … depuis leur SkanFact. Ceux qui n'y sont pas encore… » (plus de « ; »
  en début de ligne). Le code du téléphone tapé, la phrase dit « tout est prêt » au lieu de « il reste à taper ».
- **Plus de restes de la v10** : la version au pied du Cabinet est celle du serveur (« v1.76.0 »), plus « v10 · en
  ligne ».
- **La reprise du Cabinet v10 est retirée** (décision de Skander, 20/10/2026 : « la v10 n'est installée chez
  personne… supprime même la fonction ») : le bouton « Reprendre mon portefeuille de SkanFact Cabinet v10… », la
  reprise d'un livre, ses routes, ses lecteurs et ses cinq fonctions en base (migration 0152). Ce qu'une reprise a
  déjà écrit reste tel quel ; la reprise d'un FEC reste (C61).
- **Console** : « Pièces émises » d'une entreprise née ce mois-ci dit « ce mois-ci, depuis son inscription le … » au
  lieu de « aucune en septembre ».

### Compté, ce qui sort vers le cabinet

Deux champs de plus, et seulement eux : l'**e-mail** et le **téléphone** de la fiche société d'un client, pour un
cabinet dont la personne est membre active et qui a un **mandat actif** sur ce client (`socle.coordonnees_de_mes_clients`,
migration 0153). La fiche société entière reste fermée au cabinet (la règle « visible » de la base n'a pas changé) ;
un mandat proposé ou arrêté n'en donne rien, un autre cabinet non plus.

### Ce qui le prouve

- `tests/web/recette-cabinet.test.ts` : un cabinet neuf et une entreprise neuve qui n'a écrit que le mois en cours ;
  la version du dépôt au pied, aucun reste de la v10 ; la proposition qui s'annonce en revenant sur Dossiers, sans
  recharger, acceptée ; « Tout est à jour » ; l'e-mail et le téléphone de la fiche du client dans le dossier et dans
  « Modifier la fiche », « Adresse du client » ; « Ses écritures commencent en… » ; le journal qui dit le brouillard
  et y mène ; « Écritures qui reviennent ».
- `tests/cabinet/mandats.test.ts` : les coordonnées sous mandat actif seulement, deux champs, la fiche fermée.
- `tests/web/console-clients.test.ts` : « Pièces émises » née ce mois-ci, puis née trois mois plus tôt.
- `tests/web/cabinet.test.ts` : la phrase du code du téléphone, avant et après les six chiffres.
- Treize preuves (`tests/preuves.sh`, « 1.76.0 ») ; les 155 preuves de la reprise v10 partent avec elle.

### Refait à la souris (20/10/2026)

Le cabinet Mansour et l'entreprise Trabelsi (et Gharbi, créée le jour même sur un navigateur neuf) : la proposition
apparaît en revenant sur Dossiers ; « Tout est à jour : tes 2 clients… » ; le dossier Trabelsi montre son e-mail et
son téléphone ; « Ses écritures commencent en octobre 2026… » ; le brouillard annoncé et « Voir le brouillard » ;
« à valider » qui part après la validation, au retour ; « Écritures qui reviennent » dans la saisie. À la console,
la fiche de Gharbi : « ce mois-ci, depuis son inscription le 20/10/2026 », et son cabinet Mansour.

Vu et corrigé en refaisant : l'e-mail restait « à renseigner » — la base, à raison, ne laisse pas un cabinet lire la
fiche société de son client ; d'où la fonction étroite qui ne rend que ces deux champs. Et la phrase sous « Écritures
qui reviennent » disait encore « Un abonnement s'appuie… » : tout le vocabulaire de la saisie est passé.

## 1.77.0 — inviter son comptable par e-mail (20/10/2026)

### Ce que le lot ajoute

- **« Ton cabinet comptable »** (Paramètres › Envois) se lit en deux chemins côte à côte, après ce qu'on confie :
  « Il a SkanFact Cabinet » (son code, « Confier mon dossier ») et **« Il n'est pas encore sur SkanFact »** (son adresse,
  « Inviter mon comptable »). SkanFact lui écrit (le relais de l'équipe, `invitation.comptable`) ; sans relais, ou si
  le relais refuse, l'écran le dit et montre le lien une fois, avec « Copier le lien ». L'invitation qui attend se dit
  (l'adresse, la date de fin, ce que l'e-mail est devenu), avec « Envoyer un nouveau lien » et « Annuler l'invitation ».
- **Le comptable ouvre le lien** (`/?comptable=…`) : la création du compte, son adresse remplie, une vitrine à lui
  (« Les livres de … » : son compte, son cabinet et le code du téléphone, le dossier) ; puis directement « Ton
  cabinet », dont la phrase annonce le dossier ; le code du téléphone ; le Cabinet s'ouvre, le dossier y est
  **proposé**, avec ce que le client a coché ; l'associé l'accepte comme un code tapé. Déjà un cabinet : il se connecte,
  et le dossier arrive dans le sien. Un lien qui a servi, été remplacé, annulé ou périmé (30 jours) le dit.
- **Base 0154** : `socle.invitation_comptable` (l'empreinte du lien seulement), `inviter_comptable` (le propriétaire
  seul, sans cabinet en cours ; la nouvelle remplace l'ancienne), `annuler_invitation_comptable`,
  `apercu_invitation_comptable`, `rejoindre_par_invitation_comptable` (un associé ; une fois ; refusé si le dossier a
  trouvé un cabinet, ou si celui qui invitait n'en est plus le propriétaire) ; l'état de l'e-mail s'y note comme pour
  l'équipe. La trace « cabinet.mandat.inviter » chez le client.

### Ce que le lot corrige en passant (vu à la souris)

- **La proposition d'un client se lit en tête de la page Dossiers** (`web/v10/inviter-comptable.txt`) : elle était sous
  « Tes premiers pas » et « Ce que tu verras ici », en bas d'un cabinet neuf.
- **Le navigateur retenait le nom comme identifiant** à la création du compte (l'adresse portait `autocomplete="email"`) :
  il le remettait ensuite dans la case de l'e-mail à la connexion. L'adresse est l'identifiant (`username`).
- La visite « Confier mon dossier » suit l'ordre du panneau, avec l'étape de l'invitation ; « Comment un client arrive
  jusqu'ici » dit aussi l'invitation par e-mail.

### Compté, ce qui part au relais d'e-mails

L'adresse du comptable, le nom de qui invite, la raison sociale de l'entreprise, le lien et le jour où il cesse de
valoir — comme l'invitation d'une équipe (C42). Rien d'autre : ni ce que le client confie, ni ses chiffres.

### Ce qui le prouve

- `tests/cabinet/mandats.test.ts` : seul le propriétaire invite ; la seconde invitation éteint la première ; l'aperçu ;
  un collaborateur ne reçoit pas le dossier, l'associé si (proposé, au périmètre choisi) ; une fois ; « déjà un
  cabinet » ; annulé, périmé ; la base n'a que l'empreinte ; la trace.
- `tests/web/inviter-comptable.test.ts` : à la souris, du client (deux chemins, refus d'une adresse, lien de secours,
  qui ne se remontre pas) au comptable (adresse remplie, vitrine, `username`, cabinet, code, proposition en tête,
  acceptée), puis le client qui voit son cabinet ; le lien rouvert ne vaut plus.
- `tests/web/exemple-puis-vraie.test.ts` : la visite dans l'ordre du panneau.
- Quatorze preuves (`tests/preuves.sh`, « 1.77.0 »), et cinq reprises sur le code d'aujourd'hui.

### Refait à la souris (20/10/2026)

Hela arrête le mandat de Gharbi Electricite (deux clics, la confirmation), invite karim.cabinet@exemple.tn : « Ce
serveur n'envoie pas d'e-mails : envoie-lui le lien ci-dessous toi-même », le lien. Un navigateur neuf l'ouvre :
« Hela Gharbi t'invite à tenir les livres de Gharbi Electricite SARL », l'adresse remplie ; le compte au clavier ;
« Crée ton cabinet : le dossier de Gharbi Electricite SARL y arrive aussitôt » ; le code du téléphone ; le Cabinet
s'ouvre, la proposition en tête ; acceptée, « Tout est à jour : ton client sur SkanFact… ». Chez Hela : « Cabinet Jlassi
Conseil tient tes livres depuis le 20/10/2026 ».

Vu et corrigé en refaisant : l'invitation collée sous « Confier mon dossier » et les cases au milieu du premier chemin
(les deux chemins côte à côte) ; la vitrine « ta première facture » pour un comptable (la sienne) ; la proposition en
bas du cabinet neuf (en tête) ; le nom retenu comme identifiant par le navigateur (l'adresse).

## 1.78.0 — le client tenu rejoint son dossier (20/10/2026)

### Ce que le lot ajoute (03 § 3.5)

- **Au Cabinet, sur un dossier tenu**, le panneau **« Ton client sur SkanFact »**, juste sous « Les mois de ce client » :
  l'adresse de la fiche déjà remplie, « Inviter mon client ». SkanFact lui écrit (`invitation.dossier`) ; sans relais,
  l'écran le dit et montre le lien une fois, avec « Copier le lien ». L'invitation qui attend se dit, avec « Envoyer un
  nouveau lien » et « Annuler l'invitation ». Seul un associé invite.
- **Le client ouvre le lien** (`/?dossier=…`) : une vitrine à lui (« Ton dossier … », son cabinet), son adresse remplie ;
  il crée son compte (ou se connecte) **avec cette adresse**, et son dossier s'ouvre : il en est le **propriétaire**, ses
  livres sont ceux que le cabinet a tenus, le mandat continue avec le même périmètre (la paie comprise si le cabinet la
  faisait : il peut la décocher). Au Cabinet, le dossier n'est plus « tenu » : « sur SkanFact : ses livres sont à jour
  en direct », et le panneau disparaît.
- **Base 0155** : `socle.invitation_client_tenu` (l'empreinte du lien seulement), `inviter_client_tenu`,
  `annuler_invitation_client_tenu`, `apercu_invitation_client_tenu`, `rejoindre_dossier_tenu` (l'adresse invitée
  seulement ; une fois ; le dossier encore tenu par ce cabinet). La trace « socle.dossier.rejoindre » chez le client.

### Décidé par délégation (20/10/2026), à confirmer par Skander

**L'essai du client part du jour où il rejoint**, comme pour toute entreprise qui arrive : celui du dossier tenu courait
depuis sa création (souvent passé). S'il a déjà payé, rien ne change. Le cadrage dit déjà qu'un dossier tenu qui
devient abonné devient gratuit pour le cabinet (07) ; aucun prix ne change.

### Compté, ce qui part au relais d'e-mails

L'adresse du client, le nom de qui invite, le cabinet, la raison sociale du dossier, le lien et sa date de fin.

### Ce qui le prouve

- `tests/cabinet/mandats.test.ts` : un collaborateur n'invite pas ; la seconde invitation éteint la première ; l'aperçu ;
  une autre adresse refusée ; le client propriétaire, ses livres, le dossier plus tenu, le mandat actif au même
  périmètre ; l'essai qui repart ; les traces ; une fois ; un dossier plus tenu ne s'invite plus ; l'empreinte seule.
- `tests/web/rejoindre-dossier.test.ts` : à la souris, du Cabinet (le panneau sous les mois, le refus d'une adresse, le
  lien de secours) au client (vitrine, adresse remplie, compte créé, son dossier ouvert, l'essai), puis le Cabinet qui
  le voit sur SkanFact.
- Quatorze preuves (`tests/preuves.sh`, « 1.78.0 »), et cinq reprises sur le code d'aujourd'hui.

### Refait à la souris (20/10/2026)

Leila, au Cabinet Mansour Expertise, ouvre la Boulangerie El Amen (tenue) : le panneau, l'adresse elamen@exemple.tn
remplie, « Inviter mon client », le lien. Un navigateur neuf l'ouvre : « Ton dossier Boulangerie El Amen », l'adresse
remplie, le compte au clavier ; la Boulangerie s'ouvre, « Essai — 30 jours », « Mon comptable ». Au Cabinet : « sur
SkanFact : ses livres sont à jour en direct », plus de panneau.

Vu et corrigé en refaisant : le panneau était tout en bas, sous l'équipe (sous « Les mois de ce client », qui dit déjà
que le client n'est pas sur SkanFact) ; « tient tes livres sur SkanFact : rejoins-les » (« tient tes livres à jour sur
SkanFact : rejoins ton dossier »).

## 1.79.0 — la recette alpha, à la souris (20/10/2026)

Refaite comme un premier utilisateur (relances comprises : une facture échue, sa relance notée, un règlement partiel
depuis la relance, juste au millime dans les livres du serveur) : la Société Trabelsi (Sami) émet, encaisse, achète, tient sa caisse ; le Cabinet
Mansour (Leila) valide et lit ses livres. L'argent est juste au millime partout où on l'a refait à la main (une facture à
deux taux avec remise, retenue et timbre ; un règlement partiel et sa retenue au prorata ; un avoir ; un achat avec
retenue ; des tickets avec remise et leur Z ; un devis, son acompte de 30 % et son solde), et la balance du Cabinet le
suit.

### Ce que le lot corrige

- **Les mouvements libres de la trésorerie** (un salaire payé sans la Paie, un impôt, des frais bancaires, un apport,
  un retrait, un virement entre deux comptes) **n'arrivaient pas dans les livres tenus par le serveur** : le Cabinet
  voyait une banque et une caisse fausses de ces montants. Ils s'écrivent désormais comme la v10 les écrit, compte,
  journal, pièce et libellé compris (`serveur/compta/mouvements.ts` ; base 0156 ; `docs/ecritures.md`).
- **L'écart du Z de caisse** (un manque ou un excédent dans le tiroir) ne s'écrivait nulle part : la fermeture l'ajoute
  aux mouvements de la caisse (658 pour un manque, 758 pour un excédent), et il arrive au Cabinet.
- **Une facture d'achat réglée se supprimait d'un clic** (« Les règlements enregistrés seront perdus ») : l'argent sorti
  et la retenue déjà opérée disparaissaient avec elle. Le refus dit pourquoi et où retirer le règlement ; une période
  close se dit avant la question, plus après.
- **L'invitation « Première fois sur cet écran ? » revenait à chaque redessin** (au Cabinet, par-dessus la case qu'on
  venait de cocher) et comptait une ouverture à chaque fois : elle ne se pose plus qu'en entrant sur un écran.
- **Une fenêtre plus haute que l'écran cachait « Enregistrer »** (la fiche d'un nouveau fournisseur, sur un portable) :
  le pied d'une fenêtre reste à l'écran.
- **À la caisse, la rangée « Favoris · Tout » apparaissait à la première vente** et poussait toutes les tuiles sous les
  doigts du caissier : elle est là dès le premier ticket.
- **Une date tapée après un clic dans sa case s'ajoutait à celle qui y était** (« 20/10/202601092026 » : « Date
  incomprise », et la case revenait à aujourd'hui) : en entrant dans une case de date, sa date se sélectionne ; la
  frappe la remplace.
- **Au Cabinet, le livre d'un client sur SkanFact ne se relisait pas** pendant que le client vendait : la déclaration
  disait « 11 pièces encore en brouillard sur ce mois » sous un en-tête qui en comptait 9 sur l'exercice. La
  déclaration relit le livre avec elle ; en revenant sur la fenêtre, « Consulter » et « Déclarer » se relisent si le
  livre a bougé (jamais la saisie, ni sous une fenêtre ou un menu ouverts).
- L'entrée : le pied « il reste à taper le code » se vérifie aussi quand la case du code est vide.

### Ce qui reste ouvert (à décider avec un comptable, À VÉRIFIER)

- Les **soldes de départ** des comptes et le **fond de caisse** ne s'écrivent pas côté serveur : les écrire risque de
  doubler la reprise que le Cabinet fait de son côté.
- L'écriture d'un ticket dit « Facture TIC-… ».

### Ce qui le prouve

- `tests/compta/mouvements.test.ts` : deux chemins, un chiffre, sur les mouvements de l'exemple de cinq ans et seize
  pièges (chaque nature, la contrepartie choisie, le virement vers la caisse, le départ disparu, le virement vers
  soi-même, un salaire avec et sans bulletin, trois décimales, un négatif) ; corrigé, il se réécrit ; supprimé, il part.
- `tests/v10/caisse-session.test.ts` : l'écart du Z, mouvement et écriture.
- `tests/web/recette-alpha.test.ts` : à la souris, l'invitation qui ne revient pas, l'achat réglé refusé, le pied de la
  fenêtre sur un écran de 700 px, la rangée de la caisse qui ne bouge pas, la date qui se remplace.
- `tests/web/cabinet-livre-a-jour.test.ts` : au Cabinet, « Consulter » qui se relit en revenant sur la fenêtre,
  « Déclarer » qui dit le chiffre de l'en-tête, la saisie qui ne se redessine pas.
- Seize preuves (`tests/preuves.sh`, « La recette alpha du 20/10/2026 »).

## 1.80.0 — la recette alpha, suite : les gestes au bon endroit (20/10/2026)

### Ce que le lot corrige

- **Au Stock, « Choisir dans le Catalogue »** ouvrait le Catalogue et s'arrêtait là : rien n'y disait quelle case
  cocher. On choisit l'article ici ; sa fiche s'ouvre « Suivi en stock » coché, le curseur dans « Stock de départ ».
- **Aux Relances, le geste de la page** était au fond d'un menu (« Actions », puis « Relancer par email ») : chaque
  ligne porte « Relancer », au ton du retard ; le menu garde le reste. Le numéro de la facture ne se coupe plus en deux.
- **Au Cabinet, « Marquer déposée »** pointait une TVA « 0 prêt · 1 à valider » d'un clic, sans un mot : ce qui n'est pas
  prêt se lit avant, et le pointage ne se pose que confirmé (« Marquer déposée quand même »).
- **Sur un achat neuf, l'article pris au catalogue** s'ajoutait sous la ligne vide du départ, qui s'enregistrait avec
  la pièce : il la remplace, comme dans la facture de vente. Vérifié en passant : 10 « Produit » à 5,000 DT portent le
  stock de 24 à 34 au coût moyen de 1,471 DT, et le serveur écrit 607 / 4366 / 401 au millime.
- **Le calendrier vide du Cabinet** disait « n'a encore aucune écriture » à un client qui en avait quatre ce mois-ci :
  il dit la vraie règle (une échéance naît à la fin d'un mois qui a des écritures).
- **Une facture échue payée en partie** sortait du compte des retards : l'accueil disait « 1 facture, 0 en retard » et
  la fiche du client se taisait, pendant que les Relances la listaient. L'accueil et la fiche lisent la liste des
  Relances (`overdueInvoices`) : un acompte ne fait pas sortir une facture du retard.
- **Ctrl+S, Ctrl+P, Ctrl+[, Ctrl+virgule et Ctrl+?** passaient par le menu d'Electron dans la v10 de bureau : dans le
  navigateur, Ctrl+S ouvrait « Enregistrer la page » et l'Aide les promettait. Le pont de la plateforme les reprend
  (Ctrl+P sur une pièce seulement) ; l'Aide ne promet plus Ctrl+N ni Ctrl+1 à 9, que le navigateur garde (« Ctrl+K,
  puis son nom » les remplace).
- **Un devis facturé** restait « accepté » dans la liste, comme un devis qui attend sa facture : il dit « facturé »
  (ou « acompte facturé » quand seul l'acompte l'est).
- **Une commande fournisseur** laissait « Aucun résultat » sous un fournisseur introuvable, et rien d'autre : elle offre
  « + Nouveau fournisseur « ce qu'on a tapé » », comme la facture d'achat, et prend la fiche créée.
- **« Payer les salaires »** disait « L'ordre ne portera pas Karim (RIB à renseigner) », puis « Le compte n'a pas de
  RIB », sous un seul bouton « Renseigner son RIB… » qui ouvrait la fiche du COMPTE. Le salarié a son bouton nommé sous
  sa phrase (« Renseigner le RIB de Karim… », qui rouvre la fenêtre comme on l'a laissée) ; celui du compte dit « du
  compte ».
- **Console, « Désigner l'entreprise SkanFact »** (Paiements, Nos factures) menait en haut des Réglages, sur « Offres
  et prix », sans le geste : la page descend sur la carte « Nos factures », qui dit quoi faire.

### Vu bon en passant (20/10/2026)

Le parcours du support croisé : Sami écrit depuis le Stock (« joint : la version et la page »), la console le voit
avec son contexte et une réponse type du Stock, Amira répond au Ctrl+Entrée, Sami lit la réponse dans l'application.
La console compte les pièces émises de Trabelsi comme la base (7 : trois factures, un avoir, trois tickets). L'accueil,
la trésorerie et les relances disent les mêmes restes à encaisser, au millime. Un remboursement de ticket à la caisse
(avoir, 411 au débit, 54 au crédit) et une facture en euros (timbre en dinars au 4368, l'écart de change au 655 à
l'encaissement) s'écrivent justes au livre du serveur. Un devis à 7,5 % de remise (95 − 7,125 = 87,875 HT, 104,571 TTC),
puis un acompte de 30 % (29,560 timbre compris) et sa facture de solde (67,640) : le livre écrit 24 + 56 = 80 au 706 et
4,560 + 10,640 = 15,200 de TVA, le montant du devis au millime. Une commande de 3 climatiseurs, reçue à 2 (« reçue en
partie »), puis la facture du fournisseur saisie depuis la réception : 2 × 845,500 repris, 606 / 4366 / 401 au millime,
et le refus honnête du stock (une ligne libre n'est pas un article suivi). Un salarié à 1 250,750 de brut, son bulletin
de septembre (1 250,750 − 121,073 − 102,802 = 1 026,875) : l'écriture de paie s'équilibre à 1 506,779, et « Marquer
payés » solde le 425 au millime par la banque.

### Ce qui le prouve

- `tests/web/recette-alpha.test.ts` : le choix du Stock et sa fiche ; « Relancer » sur la ligne d'une facture émise
  à la souris, son numéro sur une ligne (sur un écran de 1100 px) ; un acompte depuis la ligne, et l'accueil comme la
  fiche du client la disent toujours en retard ; Ctrl+S enregistre un devis neuf, le devis converti et émis se dit
  « facturé » dans la liste, l'Aide ne promet plus les raccourcis du navigateur.
- `tests/web/cabinet-livre-a-jour.test.ts` : le calendrier vide qui dit sa règle, l'échéance pas prête qui le dit avant
  d'être pointée.
- `tests/web/console-paiements.test.ts` : « onglet=factures » descend sur la carte « Nos factures ».
- Dix-sept preuves (`tests/preuves.sh`, « 1.80.0 »).

## Ce qui reste (les lots suivants)

1. **1.79** : choisir son offre dans l'application (« Je choisis cette offre », que la console voit dans « À décider »),
   au lieu d'un e-mail. Le processus change, pas les prix : montré à Skander avant l'envoi.
