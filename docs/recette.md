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


## 1.81.0 — la recette alpha, suite : pas de pièce négative, et les chemins courts (20/10/2026)

### Ce que le lot corrige

- **Un avoir négatif s'émettait.** L'avoir d'une facture de solde reprend la ligne « Acompte déjà facturé » (−24,000) ;
  la ligne corrigée baissée à 10,000, « Émettre l'avoir AVO-2026-003 ? Montant de l'avoir − 16,660 DT » se proposait —
  un avoir qui AUGMENTE la dette du client. L'écran refuse avant la fenêtre d'émission, lignes sous les yeux ; le
  serveur refuse aussi (`ventes.avoir_negatif`, `ventes.facture_negative`), hors timbre (le dinar du timbre masquait une
  petite facture négative), avant le numéro : rien n'est pris. Un avoir nul ne s'émet pas non plus.
- **Un refus long** disparaissait en 2,6 s, avant la fin de sa lecture : un message reste le temps de se lire (60 ms par
  caractère, entre 4 et 8 s ; un message court reste 4 s au lieu de 2,6 s).
- **Au Cabinet, « 1 à valider »** sur une échéance ne disait ni qui ni où aller : le client est nommé sous la carte, et
  « Valider ses écritures » ouvre sa saisie sur l'année du mois (plusieurs clients : la Production).
- **« Partir d'une pièce existante »** (bon de livraison) proposait en tête un ticket de caisse sans client (« TIC-2026-003
  — Facture — — — ») : les tickets n'y sont plus. Sa liste ouverte, coupée par la petite fenêtre (une seule ligne
  visible), déborde de la fenêtre comme il faut — pour tous les choix d'une fenêtre basse.
- **Un test du coffre** (paiement en ligne) échouait une fois sur 256 environ : il « abîmait » le chiffré en remplaçant
  ses deux derniers caractères par « AA », qui pouvaient déjà valoir ça. Un octet basculé, toujours.

### Ce qui le prouve

- `tests/v10/dossier.test.ts` : une facture négative et un avoir négatif ou nul refusés par le serveur, aucun numéro
  d'avoir pris, puis un vrai avoir qui prend AVO-2026-001.
- `tests/web/recette-alpha.test.ts` : l'avoir à −23,800 DT refusé avant toute fenêtre, le refus encore lisible après
  5,5 s ; « Partir d'une pièce existante » sans le ticket, son dernier article visible et cliquable.
- `tests/web/cabinet-livre-a-jour.test.ts` : le client à valider nommé sous l'échéance, et sa saisie ouverte.
- Huit preuves (`tests/preuves.sh`, « 1.81.0 »).

## 1.82.0 — la recette alpha, suite : le Cabinet nomme les clients, et l'en-tête suit (20/10/2026)

### Ce que le lot corrige

- **La balance auxiliaire du Cabinet rangeait tous les clients sous « (sans tiers) ».** Les écritures nées d'une
  facture, d'un ticket ou d'un achat gardaient l'identifiant de leur tiers, jamais son nom : la colonne « Tiers » du
  livre-journal était vide, la balance auxiliaire disait deux fois « (sans tiers) » pour Hotel Les Oliviers (8 492,746
  DT dus) et la vente au comptoir, et « Ce qui reste dû, par ancienneté » ne disait pas qui doit. Le serveur rend le nom
  du tiers de chaque écriture (`tiersNom`), et le Cabinet le porte sur chaque ligne, comme la v10.
- **« Ce qui reste dû, par ancienneté »** listait un client soldé (« Vente au comptoir … 0,000 DT ») et comptait
  « 2 tiers » pour un seul qui doit : un tiers soldé n'y prend plus de ligne (son détail reste dans le lettrage).
- **L'en-tête d'un dossier disait « 1 mois à valider »** après « Valider les 20 pièces d'octobre 2026 », jusqu'au
  rechargement de la page : chaque validation (en lot, d'une écriture, à la saisie) et chaque brouillard enregistré
  relisent l'état, et la phrase se montre, change ou se cache.
- **La TFP et le FOPROLOS d'octobre** disaient « aucun compte du plan de ce dossier ne la porte » d'un dossier dont
  septembre les donnait au millime : ce qui manquait, c'était la paie d'octobre. La case dit « Pas encore de paie sur
  ce mois » et mène à la paie du mois.
- **L'écart d'un Z** (un excédent ou un manque du tiroir) s'écrivait au dossier, mais l'écran qui venait de fermer la
  caisse ne le voyait pas : la Trésorerie gardait l'ancien solde de la caisse (352,032 DT au lieu des 369,880 comptés)
  jusqu'au rechargement de la page. Le serveur rend le mouvement posé avec le Z, et l'écran l'ajoute aussitôt.
- **Console, Réglages › Nos factures** : « crée l'entreprise SkanFact dans l'application » n'avait pas de lien ;
  « Ouvrir l'application » y mène.

### Vu juste, à la souris (sans correction)

- Un ticket remisé de 7,5 % en prix TTC : 130,900 − 9,818 = 121,082 DT, TVA extraite du TTC (19,332 DT) ; l'écran, le
  serveur et le Z disent le même chiffre. L'extraction de la TVA d'un prix TTC reste À VÉRIFIER avec un comptable.
- Le Z d'une session qui porte un retour : le tiroir devait contenir fond + espèces − remboursement (352,032 DT).
- Une facture en euros (1 190,29 EUR à 3,4) : 4 046,986 DT au 411, l'écart de 0,014 DT du timbre converti en perte de
  change. L'écart de 15,550 DT entre « Reste à payer » (entreprise) et le 411 (Cabinet) est la retenue à la source pas
  encore subie : elle naît au règlement.

### Ce qui le prouve

- `tests/compta/livres.test.ts` : chaque écriture née d'une pièce dit le nom de son tiers.
- `tests/web/cabinet-balance-tiers.test.ts` (nouveau) : le livre-journal et la balance auxiliaire nomment les clients ;
  « Ce qui reste dû » ne garde pas le client soldé par son avoir.
- `tests/web/cabinet-livre-a-jour.test.ts` : l'en-tête dit « 1 mois à valider », puis l'efface une fois tout validé.
- `tests/moteur/declaration-paie-a-venir.test.ts` (nouveau) : la TFP d'un mois sans paie attend la paie.
- `tests/web/console.test.ts` : la carte « Nos factures » mène à l'application.
- `tests/web/caisse-z.test.ts` : l'excédent du Z rejoint la caisse de la Trésorerie sans recharger la page.
- Sept preuves (`tests/preuves.sh`, « 1.82.0 »).

## 1.83.0 — l'abonnement de bout en bout : activé, renouvelé, en groupe (20/10/2026)

Le parcours à la souris, sur les trois espaces : Trabelsi Distribution SARL, venue par Cabinet Mansour Expertise, en
essai. La console prépare sa facture (Complet à l'année, 690,000 − 138,000 de remise du cabinet = 552,000 HT, TVA
104,880, timbre 1,000, net 657,880 DT, période du 05/12/2026 au 04/12/2027, juste après l'essai) ; émise dans le
dossier de SkanFact SARL, elle arrive dans « Ton abonnement › Tes factures » ; Sami la paie en ligne (Konnect simulé,
657 880 millimes sur le portefeuille de SkanFact) ; « Payé jusqu'au 04/12/2027 », l'histoire nomme la facture, la
console dit « Actif », « Payée », reste 0,000, et « Encaissé ce mois » 657,880 DT. Le renouvellement prépare la période
du 05/12/2027 au 04/12/2028 sans remise (la remise du cabinet ne vaut que la première année) : 690,000 + 131,100 + 1,000
= 822,100 DT. Puis un groupe : Sami crée Trabelsi Logistique SARL dans l'application, la console crée « Groupe
Trabelsi » depuis la fiche (la société de la même propriétaire cochée d'avance, l'aperçu « Prix normal / −20 % ») ;
la seconde société est facturée 657,880 DT avec la remise de groupe, et la lit dans « Ton abonnement ».

### Ce que le lot corrige

- **La seconde société d'un groupe payait le prix normal** (l'argent) : la première avait payé une période qui
  commençait le 05/12/2026 (après son essai), la seconde, jamais payée, était facturée pour une période qui commençait
  le 20/11/2026 — et la règle comparait les premiers jours, si bien que les deux payaient 690,000 DT, alors que la fiche
  et l'aperçu du groupe promettaient « −20 % ». Désormais une société qui a payé passe toujours avant celle qui n'a
  jamais payé ; tant qu'aucune n'a payé, celle qu'on facture paie le prix normal (base `0157`). La fiche, l'aperçu et
  la facture disent la même chose.
- **« À facturer »** (nouveau dans « À décider » et « Ce qui attend » de la fiche, la direction seule) : un abonnement
  payé qui finit dans trente jours (dix pour un mois) sans facture pour la période suivante — rien ne le signalait
  avant l'échéance passée, alors que le rappel des quinze jours part au client sans facture à payer. « Préparer sa
  facture… » l'ouvre avec la même offre ; préparée ou émise, la ligne s'éteint.
- **Le compteur de « À décider »** ne bougeait pas après « Préparer la facture » ou une contestation, jusqu'à changer
  d'écran : il se relit.
- **« Aucun cabinet ne l'a amenée avant son premier paiement »**, d'une société venue par son cabinet dont la remise
  avait couru sa première année : la phrase dit désormais ce qui est vrai dans les deux cas.
- **La fiche d'un groupe comptait deux membres** pour la même personne, propriétaire des deux sociétés : chaque
  personne compte une fois. « Par an » dit ce qu'il compte : les abonnements payés, au prix de leur prochaine facture.

### Vu juste, à la souris (sans correction)

- La facture préparée pendant l'essai commence le lendemain de l'essai : rien de l'essai n'est facturé.
- Sans portefeuille Konnect branché dans SkanFact SARL, « Tes factures » dit « par virement ou par chèque » au lieu
  d'un bouton qui échouerait ; branché, « Payer 657,880 DT en ligne ».
- La facture payée passe sous les offres ; l'histoire de l'abonnement la nomme.
- Créer un groupe sans motif est refusé, le champ montré, avec la raison.

### Ce qui le prouve

- `tests/abonnement/remises.test.ts` : celle qui a payé est la première, même si sa période payée commence après celle
  qu'on facture à l'autre ; tant qu'aucune n'a payé, celle qu'on facture paie le prix normal.
- `tests/console/decider.test.ts` : « à facturer » à trente jours pour une année, dix pour un mois ; éteint par une
  facture de la période suivante, jamais pour un client qui part, jamais pour le support.
- `tests/console/factures.test.ts` : par l'API, la ligne naît, se lit sur la fiche, s'éteint préparée, reste éteinte
  émise et pas payée.
- `tests/console/echanges.test.ts` : la fiche d'un groupe compte une personne pour la même propriétaire.
- `tests/web/console-reglages.test.ts` : la phrase sans remise.
- Quinze preuves (`tests/preuves.sh`) : les quatre nouvelles d'« à facturer », trois du lot (la première abonnée, les
  personnes, la phrase), et les huit preuves de `remise_de` reportées sur sa définition en vigueur (`0157`).

## 1.84.0 — choisir son offre dans l'application (21/10/2026)

Décidé par délégation (Skander : « prends la décision à ma place ») : le processus change, pas les prix ni les offres,
et les rappels par e-mail promettaient déjà « choisis ton offre dans SkanFact : Paramètres, puis Ton abonnement », que
rien ne tenait. Se défait sans perte : le choix ne paie rien et ne change pas l'abonnement (docs/abonnement.md C19).

### Ce que le lot apporte et corrige

- **« T'abonner » / « Renouveler ou changer d'offre »** : au lieu de « Écris-nous à contact@skanfact.tn », les quatre
  choix avec leur prix du jour, et « Je choisis cette offre » (éteint tant que rien n'est coché). Ensuite : « Tu as
  choisi Essentiel, à l'année », le jour, qui, et que la facture arrive ici ; « Changer de choix ». Pendant un abonnement
  payé, choisir n'est pas l'étape suivante : les choix se replient derrière « Choisir mon offre suivante… », sans bouton
  principal.
- **La console** : « Trabelsi Distribution SARL a choisi Essentiel, à l'année » dans « À décider » (et « Ce qui attend »
  de la fiche), qui tient lieu de « à facturer » ; « Préparer sa facture… » s'ouvre sur cette offre (vu : 390,000 +
  74,100 + 1,000 = 465,100 DT, pour la période du 05/12/2027 au 04/12/2028).
- **Refusé, avec la raison** : une facture qui attend son paiement passe d'abord ; une entreprise offerte n'a rien à
  choisir.
- **Les jours de « Ton abonnement »** (l'histoire de l'abonnement, le jour d'un choix) se lisaient en UTC : un geste
  fait entre minuit et une heure à Tunis se datait de la veille (vu à 0 h 20 : « Le 20/10/2026 » pour un choix du 21).
  Ils se lisent au jour de Tunis.

- **Le rouge de GitHub sur 1.83.0** : « l'excédent du Z rejoint la caisse » tombait entre 23 h et minuit UTC — le
  navigateur du test vivait en UTC (le jour d'avant), le serveur datait l'écart du jour de Tunis. Reproduit à 23 h 15
  UTC, réparé comme les autres tests de la caisse : le navigateur vit à l'heure de Tunis (`timezoneId`), dans les quatre
  fichiers de la caisse qui ne le disaient pas.

### Ce qui le prouve

- `tests/console/factures.test.ts` : par l'API, la propriétaire choisit (la commerciale non, une offre inconnue non),
  le dernier choix compte, il ne se réécrit pas ; la console le voit, pas le support ; la facture préparée l'éteint ;
  refusé pendant qu'une facture attend son paiement, et pour une entreprise offerte.
- `tests/console/decider.test.ts` : l'offre choisie tient lieu de « à facturer ».
- `tests/web/abonnement-choix.test.ts` (nouveau) : à la souris, les quatre choix et leur prix, le bouton éteint puis
  allumé, le choix lu, « Changer de choix », le jour de Tunis d'un choix fait à 23 h 30 UTC ; la console a la ligne.
- Huit preuves (`tests/preuves.sh`).
- **Refusé par la vérification complète avant l'envoi** : l'export d'une entreprise exige que chaque table soit classée,
  et `plateforme.offre_choisie` ne l'était pas (classée « hors », comme l'abonnement ; `base/types.ts` régénéré).

## 1.85.0 — la page de retour d'un paiement, dans la DA (21/10/2026)

Skander : « refaire les pages de confirmation de paiement, le UI est à 0/10, avec la DA ». La page où revient le client
d'une entreprise (et l'abonné de SkanFact) après Konnect était un paragraphe sur fond gris.

### Ce que le lot apporte et corrige

- **Une carte dans la DA** : le haut vert nuit quadrillé avec l'icône de l'état (menthe, ambre, corail), le titre en
  Bricolage Grotesque ; dessous, le reçu — le montant en grand, la facture, « Paiement en ligne », l'état en pastille —
  et un seul bouton, « Revenir à ton espace → » (ou « à ton abonnement »). Clair et sombre, vu au téléphone (390 px) et
  au bureau ; un refus barre le montant.
- **Une phrase que rien ne tenait** : le pied « Paiement vérifié auprès du prestataire » se lisait aussi sur un lien
  coupé, où rien n'a été vérifié. Il ne vient plus qu'avec un reçu (« État lu auprès du prestataire de paiement »).
- **La même phrase deux fois** (lien incomplet, paiement introuvable : « Reviens par le lien que l'entreprise t'a
  donné » en haut et en bas) : le haut dit ce qui manque, le bas ce qu'on peut faire.
- Le numéro de la facture ne se coupe plus en fin de ligne (« FAC- » puis « 2026-002 »).

### Ce qui le prouve

- `tests/web/paiement-en-ligne.test.ts`, `jalon-j2.test.ts`, `abonnement-factures.test.ts` : le texte entier de la
  carte, dans l'ordre (le titre, le merci, le montant, le reçu, le bouton) ; le pied lu après un paiement, absent d'un
  lien coupé.
- Deux preuves nouvelles (le pied sur un lien que rien n'a lu, le montant absent du reçu), et « « Paiement reçu »
  jamais dit » reportée sur le nouveau code.
- Vus à l'écran : les cinq états (reçu, en cours, refusé, non abouti, lien incomplet), au téléphone et en sombre.

## 1.86.0 — l'espace du client, dans la DA (21/10/2026)

La suite de 1.85.0 : la page d'où le client paie, et où il revient, était restée dans un gris générique (police du
système, « Rien à payer Merci ! » sur une ligne). Elle prend la DA de la page de retour (docs/espace-client.md E10) :
la bande sombre de ce qui est dû, le montant en grand, « Rien à payer » en menthe, les boutons de l'application, le
sombre ; « Payer … en ligne » sur toute la largeur au téléphone. Seule la feuille de style change.

- `tests/web/espace-client.test.ts` : au téléphone, le montant dû est le plus grand texte de la page.
- Une preuve (le montant dû ramené à la taille du texte).
- Vu à l'écran : le relevé dû et soldé, au bureau, au téléphone et en sombre ; la pièce et son bouton « Payer ».

### Le rouge de GitHub sur 1.85.0 (21/10/2026)

Deux garde-fous de la base tombaient sur GitHub, pas ici : la table `plateforme.offre_choisie` (0158) avait sa
sécurité par ligne activée mais pas **forcée** (`0159`, comme `plateforme.contestation` : aucune politique, la table ne
se lit et ne s'écrit que par ses fonctions), et ses trois phrases n'étaient pas au catalogue des textes
(`textes/base.ts`). La vérification d'avant l'envoi ne joue que les tests que la brique touche : une table nouvelle
doit faire jouer aussi `tests/socle/cloisonnement.test.ts`, `tests/socle/textes.test.ts` et
`tests/socle/export-entreprise.test.ts` (trois rouges de 1.84 et 1.85 venaient de là). Deux preuves.

## 1.86.1 — « Ton abonnement » au téléphone (21/10/2026)

Vu à la souris, au format d'un téléphone (390 px), sur l'abonnement payé de Trabelsi Logistique :

- **Deux cartes de même titre** : « Choisir mon offre suivante… » ouvrait les choix SOUS l'annonce, qui restait avec
  son bouton éteint et répétait « aucun jour ne se perd ». Les choix prennent maintenant la place de l'annonce ; « Tu as
  choisi… » reste, il dit le choix qu'on change.
- **Le texte dans un tiers de l'écran** : l'icône de la carte gardait sa colonne. Au téléphone, elle passe au-dessus.
- **Le rouge de GitHub sur 12d21ed** : `tests/web/cabinet-revision.test.ts` lisait « Révision arrêtée. » avant qu'il
  paraisse (le délai d'`expect.poll` est d'une seconde ; le geste passe par le serveur). Le test attend le message
  quinze secondes ; l'application n'avait rien de faux (le message dure près de trois secondes).

- `tests/web/abonnement-factures.test.ts` : un seul « Renouveler ou changer d'offre » à l'écran, plus de bouton pour
  l'ouvrir, les quatre choix ; une preuve.

## 1.87.0 — la console au téléphone (21/10/2026)

Vue à 390 px, compte de direction, sur la base de recette (accueil, Clients, Abonnements, Paiements) :

- **Clients en tableau** : la liste gardait ses huit colonnes ; l'état passait derrière le bord droit (« pa… se… »). Au
  téléphone, un client par carte : son nom et le bouton de sa fiche en tête, puis chaque case nommée (Abonnement, État,
  Échéance, Par an, l'usage du mois, Vu). Le fond de survol, qui colorait chaque case à part et restait après un toucher,
  ne s'y applique plus.
- **« 4 abonnements actifs dans la sélection »**, quand l'écran Abonnements en compte 5 : le chiffre par an ne retient
  que ce qui se renouvelle (une résiliation n'y est pas, l'Imprimerie Zitouna dans la recette). La phrase le dit
  maintenant : « 4 abonnements qui se renouvellent dans la sélection ».
- **« Ctrl K »** au bout du champ de recherche, sans clavier, coupait le texte du champ : caché au téléphone et sur un
  écran tactile.

- `tests/web/console-recette.test.ts` : au téléphone, l'état de chaque client dans l'écran, les cases nommées, « Ctrl K »
  caché ; `tests/web/console.test.ts` : la phrase. Trois preuves.

### 1.87.1 — le journal au téléphone

Le journal gardait ses six colonnes ; le geste passait derrière le bord. Un geste par carte : l'heure et qui en tête,
puis le geste, sur quoi, le motif et ce qui a changé, chacun nommé. Vu à 390 px ; l'écran Service, d'abord resté sur
« Lecture… », n'était que lent à lire (la veille de la recette ne tourne pas). Une preuve (le bloc du téléphone éteint).

### 1.87.2 — le Cabinet au téléphone

Vu à 390 px avec une comptable du Cabinet Ben Youssef (dossiers, production, échéances, écritures, messages, relances) :
rien ne déborde. « Menu » flottait au milieu de la barre du haut, juste après le nom du cabinet : il passe au bout,
comme à l'entreprise. La page de connexion, commune aux entreprises et aux cabinets, disait « retrouver tes devis, tes
factures et ta gestion » à un comptable : « retrouver ta gestion, ou les dossiers de ton cabinet ». Le Cabinet exige le
code du téléphone de chaque comptable, et sa page de mise en place se lit bien au téléphone. Une preuve.

### 1.87.3 — l'éditeur de facture et la console au téléphone

L'éditeur d'une nouvelle facture, à 390 px : « Émettre la facture » en tête, les totaux justes, rien ne déborde ; mais
l'invitation « Première fois sur cette page ? » restait sur le bas de l'écran (230 points) pendant tout le défilement. Au
téléphone c'est la page entière qui défile, pas sa zone centrale : le défilement de la fenêtre la ferme maintenant. Tous
les écrans de la console relevés au téléphone : la grille des prix des Réglages, les membres de l'Équipe et les règles et
alertes passées de la veille étaient des tableaux qui défilaient de côté (600 à 1 000 points) ; ils passent en cartes,
chaque case nommée. « À régler dans l'équipe » réduisait son texte à un mot par ligne à côté d'un bouton coupé : le
bouton passe dessous. Restent des tableaux, par choix, la matrice des droits et les routes du serveur (triées par leurs
titres, on les lit en croisant). Cinq preuves.

### 1.87.4 — une pièce neuve en lecture seule

Le Café El Medina, en lecture seule depuis le 07/10/2026, ouvre une nouvelle facture : le bandeau dit d'avance qu'elle ne
pourra pas être enregistrée, et le clic sur « Émettre » ouvre le refus qui mène à l'abonnement. Mais « Émettre la
facture » restait le bouton vert, l'étape suivante d'un écran où elle est impossible. Le bouton principal passe au
bandeau (« Voir l'abonnement ») sur une facture, un devis ou un achat neuf. La facture remplie au doigt (Trabelsi
Logistique, nouveau client depuis le choix du client, 3 × 123,457 DT) : 370,371 DT HT, 70,370 DT de TVA, 1,000 DT de
timbre, 441,741 DT à payer, et la fenêtre d'émission dit ce qui manque (matricule, RIB) avant le geste. Au clavier,
l'éditeur se parcourt dans l'ordre de l'écran. Le Cabinet aussi, chaque élément avec son anneau ; mais ses premiers
pas montraient trois « Me guider » du même nom : chacun porte maintenant le nom de son étape. Quatre preuves.

### 1.87.5 — une comptable qui ajoute un client

Rim, comptable du Cabinet Ben Youssef (pas associée), clique « Ajouter un client… » : la fiche s'ouvre, elle la remplit
en entier (nom, matricule, honoraires), et « Créer le dossier » ne fait qu'afficher « Seul un associé du cabinet crée un
dossier » dans un message qui passe, la fiche restant ouverte. Le refus vient maintenant à l'ouverture, avant la saisie,
avec qui peut le faire (« … peut ajouter ce client »). La règle est celle de la base (seul un associé crée un dossier),
lue par le pont comme pour l'équipe. Une preuve.

### 1.87.6 — une coupure du réseau au téléphone

Le téléphone de Sami (Trabelsi Logistique), un navigateur qui ne garde rien : le réseau coupé, le bandeau le dit avant
tout geste (« Enregistrer demande le réseau »), et un nouveau client est refusé par « Rien n'a été enregistré », qui
promet que rien n'est perdu tant que l'application reste ouverte. « Réessayer », le réseau revenu, l'enregistre. Mais
« Fermer » laissait le client à l'écran, compté dans la liste, sans qu'il soit sur le serveur, et rien ne repartait au
retour du réseau : un rechargement l'effaçait. Il repart maintenant seul au retour du réseau (comme ce que garde « mon
ordinateur »), le bandeau dit qu'il est enregistré, et une fenêtre restée ouverte se referme. Au Cabinet, la saisie d'une
vente au clavier seul (Tab, Entrée, Tab pour solder, Ctrl+Entrée) se valide sous le n° 1 et la balance tombe juste.
Deux preuves (et une ancienne, réécrite pour rester lisible par le navigateur).

### 1.87.7 — la saisie du Cabinet au clavier, l'invitation au téléphone

La saisie s'ouvrait sans curseur : la saisie au clavier commençait par un clic. Elle s'ouvre maintenant le curseur dans
« Pièce », comme après chaque enregistrement (à la souris et au clavier seulement : au doigt, le clavier de l'écran
s'ouvrirait). « Plus tard » sur l'invitation à la visite emportait ce curseur avec le bouton qui disparaît : il le rend.
Et l'invitation du Cabinet restait posée sur le téléphone pendant le défilement, comme celle de l'entreprise avant la
1.87.3 : elle se ferme. Trois preuves.

### 1.87.8 — les retouches des écrans repris passent par leurs adaptations

Les retouches de la 1.87.3 à la 1.87.7 avaient été faites à la main dans `web/public/v10` : le test de provenance les a
refusées sur GitHub (chaque fichier repris doit avoir l'empreinte notée à la reprise), et la vérification locale ne le
jouait pas. Elles sont maintenant écrites comme toutes les autres (`web/v10/recette-21-10.txt`), et `npm run
reprendre-v10` redonne les fichiers à l'octet près. Rien ne change à l'écran.

### 1.87.9 — la lecture seule se voit au téléphone

Le Café El Medina, en lecture seule depuis le 07/10/2026, ouvert au téléphone : l'accueil offrait « + Nouvelle facture »
et la découverte, et rien ne disait la lecture seule. La pastille « Lecture seule — voir l'abonnement » vivait dans le
pied du menu, replié au téléphone : on ne l'apprenait qu'au refus. Elle se voit maintenant sous la barre du haut, menu
fermé, quand elle alerte (lecture seule, fin d'essai proche). Et la vérification locale joue désormais le test de
provenance dès qu'un écran repris bouge (la cause du rouge réparé par la 1.87.8). Une preuve.

### 1.87.10 — la console au clavier

La console se parcourt au clavier dans l'ordre de l'écran, chaque élément avec son anneau, et `Ctrl K` mène à la
recherche. Mais une recherche qui ne trouvait qu'une organisation laissait sa fiche à quinze tabulations (tous les
filtres d'abord). « Entrée » l'ouvre maintenant ; deux trouvées ou plus, la liste reste. Une preuve.

### 1.87.11 — la recherche de l'accueil de la console

La recherche en tête de l'accueil (où mène `Ctrl K` depuis l'accueil) ouvrait la liste des clients même pour un seul nom
trouvé. Elle ouvre maintenant sa fiche, comme celle de Clients ; deux ou plus, la liste. Une preuve.

### 1.87.12 — émettre, encaisser et voir une facture au téléphone

La facture de Trabelsi Logistique émise au doigt (FAC-2026-001, 441,741 DT), puis son paiement : la fenêtre propose le
reste à payer, « Enregistrer » la dit « payée intégralement ». Mais « Aperçu » masquait l'aperçu, déjà posé tout en bas
sous le formulaire : rien ne bougeait à l'écran, et le bouton devenait « Afficher l'aperçu ». Au téléphone, il ouvre
maintenant la pièce en grand (comme « Agrandir » ; Échap la referme). Le montant du paiement s'écrit avec un point dans
un navigateur réglé en anglais : c'est l'affichage d'un champ de nombre selon la langue du navigateur ; une virgule
tapée y reste la décimale (virgule.js). Une preuve.

### 1.87.13 — un matricule fiscal mal formé dans la fiche société

« 1234567X » tapé dans les Paramètres (la suite oubliée : code TVA, catégorie, établissement) s'enregistrait sans un mot
(« Paramètres enregistrés ») ; le serveur ne le portait pas à l'entreprise, et seule l'émission d'une facture le disait.
La fiche le refuse maintenant avant d'écrire quoi que ce soit, avec la phrase de « Compléter ma fiche », et montre la
case. Écrit comme adaptation des écrans repris (`web/v10/recette-21-10.txt`). Une preuve.

### 1.87.14 — une caisse tenue sur un téléphone perdu

La caisse ouverte sur un appareil ne se fermait que de cet appareil : perdu, déchargé ou resté chez le caissier, plus
rien ne s'encaissait, et l'écran disait seulement « Ferme-la là-bas ». Le serveur acceptait pourtant que le
propriétaire ou un administrateur la ferme d'ailleurs (`caisse.fermer_ailleurs`). L'écran « ouverte sur un autre
appareil » porte maintenant, pour eux, « Fermer la caisse d'ici » (et le menu de la caisse aussi) : le même comptage
du tiroir, et un Z qui dit sur quel appareil elle était ouverte et qui l'a fermée. Un caissier lit à qui le demander.
Un ticket encaissé là-bas sans réseau arrive quand même au serveur (il est accepté, avec l'alerte « après la
fermeture »). Vu au téléphone : fond de 150,250 DT, 150,250 comptés, écart nul. Un test (fond 12,345, compté 12,300,
écart − 0,045), une preuve ; l'ancienne preuve « la caisse fermée qui laisse encaisser » suit le nouveau texte.

Vu juste au téléphone dans la même passe, sans correction : le Cabinet de Nour (dossiers, dossier, saisie, balance,
échéances, production) et dix écrans de l'entreprise (achats, caisse, stock, paie, trésorerie, comptabilité,
immobilisations, relances, statistiques, marges), sans débordement ni erreur ; les statistiques tombent sur la
facture (370,371 HT + 70,370 de TVA + 1 de timbre = 441,741).

### 1.87.15 — la monnaie à rendre, au téléphone

Une vente au doigt (deux courses urbaines et une manutention, 83,300 DT, payées d'un billet de 100) : le ticket, la TVA
(13,300), la monnaie et le Z du soir (50 de fond + 83,300 = 133,300 comptés, écart nul) tombent juste. Mais la case
« À rendre », côte à côte avec « Reçu du client », coupait le montant en « 16,70… » : c'est le chiffre que le caissier
lit pour rendre l'argent. Sous 560 px de large, les deux cases se posent l'une sous l'autre. Le test « au téléphone »
de la caisse touche le plus gros billet et exige la monnaie entière dans sa case ; une preuve.

### 1.87.16 — la tablette debout

À 820 px (une tablette tenue debout), le menu de gauche reste, et une liste plus large que la place restante faisait
défiler toute la zone de la page de côté, titre et boutons compris : l'Accueil, les Factures, les Clients (dès un seul
client), la Trésorerie ; la rangée d'export de la Comptabilité poussait « Envoyer au comptable… » hors de l'écran.
Entre 761 et 1 023 px, la liste défile maintenant dans son cadre (comme au téléphone), et une rangée de boutons passe à
la ligne. Quatorze écrans de l'entreprise et six du Cabinet remesurés à 820 px : plus rien ne déborde ; le menu
« Actions » d'une ligne s'ouvre en entier. À 1 024 px, rien ne débordait. Un test (`tests/web/tablette.test.ts`),
deux preuves.

### 1.87.17 — une facture d'achat au téléphone

Saisie au doigt : un fournisseur créé depuis la facture, une ligne de 3 × 416,667 DT à 19 %, une retenue de 1,5 % :
1 250,001 HT, 237,500 de TVA, 1 487,501 TTC, 22,313 retenus, 1 465,188 à payer — juste. Mais l'en-tête des lignes,
calqué sur leur grille, posait chaque titre loin de sa case (« Qté » trois rangs au-dessus du 3, « Déduct. » seul) :
au téléphone, il se cache, et chaque case porte son titre juste au-dessus (« TVA déductible » en entier), comme les
cartes des listes ; de même pour les lignes d'une photo relue. Le test des lignes d'achat au téléphone l'exige ; deux
preuves.

### 1.87.18 — le rouge de GitHub sur 1.87.13

Une preuve n'y était pas faite : « Enregistrer » d'un achat neuf remis en vert en lecture seule, le test restait vert.
Le test passait de la facture à l'achat et attendait le bandeau de lecture seule… que la facture d'avant portait déjà :
selon la vitesse de la machine, il lisait les boutons de la facture. Il attend maintenant la page d'achat elle-même (ses
lignes). La preuve, rejouée deux fois ici, tombe chaque fois.

### 1.87.19 — une facture au clavier seul

Une nouvelle facture parcourue à la touche Tab : chaque case et chaque bouton montre son anneau, dans l'ordre de
l'écran. Mais la quantité, le prix, l'unité et la TVA d'une ligne n'avaient d'autre nom que le titre de leur colonne,
que rien ne relie à la case : un lecteur d'écran disait « zone d'édition ». Chaque case d'un tableau de lignes sans nom
reçoit maintenant « le titre de sa colonne, ligne N » (« Qté, ligne 2 »), et le suit quand les lignes changent ; à
toutes les largeurs, pour l'entreprise comme pour le Cabinet (`plateforme/telephone.js`, cinquième partie). Les
boutons ⧉ et ✕ portaient déjà leur nom. Un test, une preuve ; l'ancienne preuve de l'aperçu au téléphone suit le texte.

### 1.87.20 — les listes de filtre au clavier

La même passe, sur treize écrans de l'entreprise et sept du Cabinet : toutes les cases ont un nom, sauf sept listes de
filtre (l'année et le mois de la Comptabilité, l'année de la Paie et des Statistiques, le statut et le type des
Factures et des Achats, le filtre des Clients et des Fournisseurs). Chacune garde le même identifiant d'une page à
l'autre : elle reçoit le nom de ce qu'elle choisit (« Année », « Mois », « Statut », « Type de pièce », « Filtrer la
liste »). Le test de la 1.87.19, qui réutilisait l'entreprise du test d'avant (son matricule déjà pris, la vérification
complète l'a vu), a la sienne. Une preuve.

### 1.87.21 — les lignes d'un devis au téléphone

Un devis au doigt (le client choisi dans sa liste, une course urbaine du catalogue : 25,000 HT, 4,750 de TVA,
29,750 TTC — juste) : l'en-tête des lignes, rangé sur la grille du bureau, posait « Qté », « Unité » et « P.U. HT »
loin de leurs cases, comme aux achats (1.87.17). Au téléphone, il se cache, et chaque case porte son titre juste
au-dessus. Ce que cela coûte, et qui reste ouvert : les bulles « i » de ces titres de colonne (Unité, TVA ; aux
achats, Destination et TVA déductible) ne se voient plus au téléphone ; elles restent au bureau. Un test, une preuve.

### 1.87.22 — le relevé des cases sans nom, clos

Dix-neuf autres écrans de l'entreprise (accueil, devis, commandes fournisseurs, listes de prix, immobilisations,
marges, garanties, contrats, accords, groupe, modules, aide, support, caisse, stock, paie, trésorerie…) et six
fenêtres de saisie (client, salarié, prestation, article, fournisseur, dépense) : toutes les cases ont un nom, sauf
l'unité d'une prestation ou d'un article, dont le titre (`span.fl`) est posé à côté de la liste sans la nommer. Une case
sans nom qui suit un tel titre prend maintenant son texte, sans la bulle. Le test de la 1.87.19 l'exige ; une preuve.

### 1.88.0 — le PDF d'une pièce, fait par le serveur

« PDF » sur une facture, à l'ordinateur puis au téléphone : le fichier `FAC-2026-001_Société_des_Transports_du_Sahel.pdf`
se télécharge en une seconde environ, une page A4, 441,741 DT comme à l'écran, et « PDF enregistré : … » le dit. Aucune
fenêtre d'impression. Un serveur sans Chromium rouvre la fenêtre d'impression, comme avant. Trouvé en route : sans langue
réglée en UTF-8, Chromium renomme « download » un fichier au nom accentué (les tests règlent la leur ; un vrai
navigateur l'a toujours). Détail : `docs/pdf.md`.

### 1.89.0 — les pièces jointes, gardées par le serveur

« + Joindre un fichier… » sur un devis disait « pas encore dans la version en ligne » ; le panneau était même caché.
Maintenant : deux fichiers joints d'un coup (un PDF et une photo), la photo ouverte dans un onglet, le PDF téléchargé à
l'identique, toujours là après un rechargement, puis retiré (la question dit, avant, ce que le serveur efface et ce
qu'il garde). Un document Word renommé en `.pdf` se refuse et dit pourquoi. Détail : `docs/pieces-jointes.md`.

### 1.90.0 — les sauvegardes, vues de l'entreprise

Paramètres › Données et sécurité : le panneau « Tes sauvegardes » dit, sur une nuit qui a échoué, « La copie de la nuit du
… a échoué. La dernière réussie : le … à 3 h 30. », une copie hors de la machine pas encore en place, l'essai de
restauration réussi. « Demander de revenir en arrière… » dit d'abord ce qui disparaîtrait, refuse sans motif en montrant
la case, puis envoie la demande au support ; rien ne change. Un commercial ne voit pas le panneau. Détail :
`docs/sauvegardes-ecran.md`.

### 1.91.0 — « Signaler un problème », avec le journal de cet écran

Paramètres › L'application : « Aide et dépannage » est de retour. Une erreur levée dans l'écran se lit dans « Voir le
journal de cet écran » ; « Signaler un problème… » propose, case cochée, de la joindre (« Le lire » avant) : elle part
sous le texte de la demande ; décochée, rien n'en part. Détail : `docs/signaler.md`.

### 1.91.1 — le rouge de GitHub sur 1.91.0

Trois tests : « demander de revenir en arrière » n'avait pas sa décision de lecture seule (ouverte, comme écrire au
support) ; le test des pièces jointes lisait le dossier au serveur avant que la pièce y soit enregistrée (il attend
maintenant qu'elle y soit) ; la photo du panneau de la liasse close se prenait pendant que la liasse se redessinait (elle se
reprend).

### 1.92.0 — le PDF du Cabinet, fait par le serveur ; « d'octobre », pas « de octobre »

Au Cabinet, à la souris et au clavier, sur un dossier tenu : un salarié déclaré (1 287,350 DT brut, embauché le
01/03/2026), son bulletin d'octobre établi, puis « Imprimer le bulletin » : le PDF se télécharge en une seconde environ,
une page A4, net à payer 1 041,721 DT comme à l'écran, et « PDF enregistré : Bulletin_Salarié_Recette_Un_2026-10.pdf » le
dit. Le journal de paie suit (`Journal_de_paie_2026-10.pdf`). Plus aucune fenêtre d'impression, sauf sur un serveur qui
n'a pas l'outil. Trouvé en relisant le PDF : son pied disait « Bulletin de octobre 2026 » ; il dit « Bulletin d'octobre
2026 », comme l'ordre de virement (« salaires d'avril ») et la fenêtre « Payer les salaires d'août ». Détail :
`docs/pdf.md`.

### 1.93.0 — au téléphone, les bulles « i » des colonnes d'une ligne

Au téléphone, sur une facture neuve puis sur une facture d'achat : au-dessus des lignes, « Les colonnes : Unité ⓘ TVA ⓘ »
(à l'achat : « Destination de la ligne ⓘ TVA déductible ⓘ »). Au doigt, la bulle de l'unité s'ouvre et se lit en entier,
rien ne déborde de côté. À l'ordinateur, rien ne s'ajoute : l'en-tête du tableau porte ses bulles, comme avant.

Et deux trouvailles. « Exporter tous les PDF de la période » annonçait « Génération de N PDF… » et rien ne venait : les PDF
se font au serveur et arrivent dans un seul .zip (« 2 PDF exportés dans SkanFact-….zip »). Sur le serveur d'essai, le
Chromium de la tâche 0011 imprime dans l'enfermement du service (une page en 513 ms) : `docs/pdf.md`.

### Le grand parcours du 21/10/2026 (1.93.0) — une personne neuve, de l'inscription au cabinet

Leïla s'inscrit au clavier (Tab d'une case à l'autre, Entrée valide), crée Mansouri Informatique SARL (le matricule tapé
« 1234567l a m 000 » se range en 1234567L/A/M/000), son activité, sa TVA, son menu ; ajoute son RIB, un client à
retenue de 1,5 %, un devis à deux lignes (2,5 j × 180,350 = 450,875), Ctrl+S l'enregistre ; le devis devient une
facture, émise : 1 650,875 HT, TVA 313,666, timbre 1,000, retenue 29,468, net 1 936,073 DT, juste au millime. Puis elle
choisit Complet à l'année ; la console le voit dans « À décider », la fiche prépare la facture (822,100 DT).

Trouvé et corrigé en chemin :
- au clavier, dans une ligne, Tab passait de la désignation au bouton « + description » : la quantité tapée tombait
  dessus, la ligne restait à 1 × 0,000. Le bouton sort de l'ordre du Tab (comme les bulles « i ») ;
- le refus « Cette entreprise ne t'est pas ouverte » nomme maintenant le compte connecté : un lien de la console ouvert
  dans le navigateur d'un autre compte le dit sans qu'on ait à deviner lequel.

### 1.94.0 — le grand parcours, suite : le comptable invité, ses questions, au clavier

Leïla, son SkanFact ouvert sur Comptabilité › Cabinet ; Hatem, dans son cabinet, lui pose une question et l'envoie. Sans
rien recharger, la question arrive sur l'écran de Leïla (70 s plus tard : le point de contact relit les questions toutes
les deux minutes, et dès que l'onglet revient au premier plan) ; jamais pendant une saisie (une fenêtre ouverte, une case
où l'on écrit).

Trouvé et corrigé en chemin :
- Hatem envoyait une question neuve, et celle partie le matin même repartait avec : « 2 fois », et chez Leïla « envoyée
  deux fois sans réponse : ton comptable ne peut pas arrêter ton mois », le jour où elle l'avait reçue. Une relance se
  fait maintenant **un autre jour** (base 0162) ; la fenêtre d'envoi dit avant le geste « 1 question neuve ; 2 questions
  parties aujourd'hui ne repartent pas » ; rien de neuf, le refus le dit sans fenêtre ;
- inviter son comptable au clavier : Entrée dans son adresse envoie l'invitation (elle ne faisait rien), le curseur va
  ensuite à « Copier le lien », et la copie se dit en une phrase (« Lien copié : colle-le dans ton message… ») ; le
  premier pas « Inviter mon comptable » de l'Accueil pose le curseur dans son adresse ;
- un devis neuf s'ouvrait le curseur nulle part : il se pose sur le choix du client (Entrée ouvre la liste), ou, le
  client déjà choisi, sur la désignation de la première ligne (jamais au doigt, où le clavier couvrirait l'écran) ;
- les menus « Facturer ▾ », « Transformer ▾ », « Plus ▾ » : le bouton dit s'il est ouvert, la liste ouverte reçoit le
  curseur, les flèches (Début, Fin) passent d'une entrée à l'autre, Échap rend le curseur au bouton.

Et le rouge de GitHub sur 1.93.0 : le test du .zip lisait ses noms avec « unzip », qui les décode selon la machine
(« Soci├йt├й » sur celle de GitHub) ; il lit maintenant le zip lui-même, et vérifie le drapeau qui dit « UTF-8 ». Quatre
preuves qui gardaient l'écran sans pièces jointes ne pouvaient plus tomber depuis la 1.89.0 : retirées, avec leur raison.

Vérifié, pas un défaut : « + Comptabilité complète » dans la Comptabilité d'une entreprise en Complet mène à Modules, où
le grand livre, la balance et les états s'allument (le sous-module n'est pas allumé d'office).

### 1.95.0 — le parcours à l'écran, geste par geste : Leïla répond, Hatem lit

Fait à la souris et au clavier sur l'écran (de vrais clics, une capture après chaque geste), pas par un script. Leïla
répond au comptable depuis Comptabilité › Cabinet, envoie le bon de commande signé par « Mon comptable » (le sélecteur de
fichiers du système, « Parler d'une pièce », Entrée envoie) ; Hatem, dans une fenêtre privée (mot de passe, code de son
application), le lit dans ses Messages et l'ouvre.

Trouvé et corrigé en chemin, chaque fois revu à l'écran :
- la fenêtre « Répondre » d'une question qui attend une pièce ne prenait que du texte (« dis-lui où la trouver ») : elle
  prend maintenant le fichier ; il part dans la messagerie, rattaché à la pièce visée, sous un mot qui nomme la question ;
- dans le fil, la carte d'une pièce commençait sa deuxième ligne par un « · » orphelin ; « Ranger dans mes achats… » se
  proposait sous un document de vente envoyé avec une facture ;
- « Envoyer au comptable… » restait le bouton vert alors que le cabinet lit déjà les livres en direct : il redevient
  secondaire, une phrase dit qu'il n'y a rien à lui envoyer ; sa fenêtre disait « Le journal des ventes est joint en
  CSV » (un navigateur ne joint rien : il se télécharge, à joindre soi-même) et « 1 documents » ;
- un fichier ouvert depuis le fil s'appelait « d1eebff2-… » et s'enregistrait sous ce nom : une photo s'ouvre dans une
  page à son nom, et chaque fichier du fil a « Enregistrer », qui le garde sous son nom.

### 1.96.0 — Hatem ouvre la déclaration d'un mois en cours

Le 21 octobre, Hatem ouvre Déclarer et clôturer › Déclaration du dossier de Leïla, commencé en octobre. L'écran
proposait en vert « Déclarer septembre 2026 » (un mois d'avant le livre, rien à y déclarer) et affichait en orange « Le
compte 4367 porte encore 313,666 DT à la fin du mois » pour un mois qui n'est pas fini. Désormais : « Rien avant dans ce
livre : ce sera sa première déclaration », et une ligne neutre à la place de l'alerte. Les cases, elles, étaient justes
(TVA due 313,666, timbre 1,000, à payer 313,666).

### 1.97.0 — Hatem révise, Leïla répond, Hatem ferme

Hatem signe les quatre comptes du dossier de Leïla (411, 706, 4367, 4368), au clavier puis à la souris ; Leïla répond
aux deux questions qui restaient ; Hatem les lit et les ferme. Ce que l'écran faisait mal :
- signer le 411 écrivait « revu Hatem Ben Salah · 21/10/2026 » dans la cellule : la colonne s'élargissait de 175 px,
  l'intitulé voisin tombait à « Prestatio… » et le tableau prenait une barre de défilement. La cellule dit « revu » ;
  qui et quand se lisent dans l'infobulle et dans le menu de la ligne ;
- au dernier compte signé d'un cycle, la ligne d'avancement passait de la phrase au bouton « Revoir Fiscal » et toute
  la feuille descendait de 5 px : elle garde la hauteur du bouton ;
- chez Leïla, « En attente de toi : 2 questions sans réponse » ne menait nulle part, et les questions étaient plus haut
  dans le fil, hors de la vue à l'ouverture : « Répondre » y mène, le curseur dans la réponse de la plus ancienne (ou
  sur « Envoyer la pièce… » d'une pièce demandée) ;
- sa réponse disait « Réponse à la question » sans dire laquelle : elle porte l'objet (« « Fond de caisse » ») ;
- à la dernière réponse, la page devenue courte perdait sa barre de défilement et tout glissait de 15 px sous le
  curseur : la zone principale garde la place de sa barre ;
- une question fermée restait « répondue » au Cabinet (le client lisait « Close par le cabinet ») : elle dit « close ».

### 1.98.0 — Hatem parcourt Production et répond dans le fil

- Production, le 21 octobre, avec un seul dossier commencé en octobre : « Sur 12 mois » et « Aucun mois n'attend de
  saisie » au-dessus d'une grille sans colonne de mois, avec la légende de cinq signes absents (le mois en cours n'entre
  jamais dans la grille). La phrase dit qu'un mois entre dans la grille une fois terminé, que le mois en cours se suit
  dans la comptabilité du client, et la légende ne se montre pas ;
- dans le fil, après la réponse de Hatem, « Rien à faire ? C'est traité » se proposait encore pour un client sorti de
  « À traiter » : le fil reçoit l'état de la boîte (la même requête, `etatsDesDossiers`) et le bouton ne se montre que
  pour un client à traiter.

### 1.99.0 — Sami s'inscrit, crée son entreprise et choisit son offre

- « Créer ton compte » et « Ton entreprise » s'ouvraient sans curseur : il faut cliquer dans le premier champ. Le
  curseur est dans le nom, puis dans la raison sociale ;
- un matricule déjà pris : le champ passait au rouge, et la raison n'apparaissait que dans un message de 2,6 s en bas
  de l'écran, coupé avant la fin. La raison se lit sous le champ, et un message d'erreur reste le temps de le lire
  (60 ms par caractère, entre 2,6 et 8 s) ;
- dans la fiche du client à la console, « elle a choisi Complet, à l'année », à côté du nom de Sami, se lisait comme
  une personne : « l'entreprise a choisi ».

### 1.99.1 — la preuve de la saisie du Cabinet qui ne bouge pas, tenue

- GitHub était rouge depuis 1.97.0 : la preuve « la saisie du Cabinet redessinée sous la main » restait verte. La
  saisie s'ouvre le curseur dans « Pièce » (1.87.7), et un champ tenu bloque déjà toute relecture : le défaut était
  masqué. Le test quitte le champ avant le mouvement qui arrive ; c'est la saisie elle-même qui ne doit pas bouger.

### 1.100.0 — Amira émet la facture de Sami, Sami la paie, puis fait son premier devis

- GitHub rouge sur 1.99.0 : un refus sous le champ (1.99.0) rebâtit le champ, et le curseur, posé avant, tombait sur la
  saisie remplacée. Le curseur vient après le rendu qui montre le refus ;
- « L'émettre dans SkanFact » (console), ouvert dans le navigateur d'un autre compte (celui du comptable) : « Cette
  entreprise ne t'est pas ouverte », avec « Continuer » seulement, qui ouvrait l'entreprise de ce compte-là. Le bandeau
  propose « Me connecter avec un autre compte » : la session est fermée au serveur, la connexion attend, et le bon
  compte rouvre la même adresse ;
- vu et juste : FAC-2026-004 (690,000 HT, TVA 131,100, timbre 1,000, 822,100), payée en ligne ; « Payé jusqu'au
  20/11/2027, encore 395 jours » ; la console dit « Payée », reste 0,000, « Actif » ; la facture payée reste dans
  « Tes factures » ;
- le premier devis de Sami pour « Entreprise Générale de Bâtiment Chaabane » : la colonne du client s'élargissait au nom
  entier, et les deux dates coupaient l'année (« 21/10/202 »). Les colonnes d'une grille restent égales ; le nom finit
  par « … » (il est entier dans l'aperçu). Devis 4 842,000 HT, TVA 919,980, 5 761,980 ; facture FAC-2026-001,
  5 762,980 avec le timbre ;
- Sami invite Hatem par e-mail en confiant aussi la paie : l'invitation part avec la paie, mais le panneau, redessiné,
  remettait les cases à leur départ et « La paie » se montrait décochée (l'écran disait le contraire de ce qui était
  confié). Les cases disent ce que l'invitation confie, et la phrase le nomme (« pour la comptabilité, les
  déclarations, la saisie des achats et la paie »).

### 1.101.0 — Hatem accepte le dossier de Sami et valide sa première facture

- vu et juste : le lien d'invitation, ouvert par Hatem déjà connecté, met la proposition en tête de ses Dossiers
  (« la comptabilité, les déclarations, la saisie des achats et la paie ») ; acceptée, le dossier compte octobre à
  4 842,000 DT, 6 492,875 DT pour le cabinet ;
- le brouillard de FAC-2026-001 ne disait que son total et « équilibrée », et son menu ne proposait que « Valider » ou
  « Joindre un justificatif… » : une pièce venue de SkanFact ne se « reprend » pas dans la grille, et rien ne montrait
  ses comptes avant de la valider à jamais. « Voir ses lignes », en tête du menu, ouvre le livre-journal, le brouillard
  compté, cherché sur sa pièce (411 D 5 762,980 ; 706 C 4 842,000 ; 4367 C 919,980 ; 4368 C 1,000) ;
- « Voir le brouillard » du livre-journal vide arrivait en haut de la saisie, le brouillard sous la grille, hors de
  l'écran ; il y arrive, et le curseur posé dans « Pièce » (1.87.7) ne fait plus remonter la page.

### 1.102.0 — Sami paie Mourad, Hatem lit la paie et attend son jour

- vu et juste : Sami déclare Mourad Gharbi (brut 1 250,000), établit le bulletin d'octobre (net 1 015,727 ; coût
  employeur 1 505,875) et le marque payé le 21/10. Au Cabinet, l'écriture de paie tombe juste : 640 D 1 250,000 ;
  645 D 218,375 ; 661 D 37,500 (TFP et FOPROLOS) ; 4531 C 339,375 (121,000 + 218,375) ; 4321 C 113,273 ; 4335 C
  37,500 ; 425 C 1 015,727 ; et le versement BQ 425 D / 532 C 1 015,727 ;
- la Paie du Cabinet, ouverte avant que Sami déclare Mourad, disait « il faut d'abord un salarié » jusqu'à F5 : en
  revenant sur la fenêtre, elle se relit maintenant comme « Consulter » et « Déclarer » (salariés, bulletins, pointage,
  congés, avances), avec les mêmes gardes (jamais sous un champ tenu, une fenêtre ou un menu ouverts) ;
- l'écriture de paie est datée du 31/10 et la base refuse de la valider avant ce jour (un numéro suit l'ordre des
  jours) ; mais la Paie offrait « La valider dans la saisie » en bouton principal, le brouillard « Valider la seule
  pièce de PAIE » et le menu « Valider cette écriture » : trois gestes vers un refus. La Paie nomme le jour (« datée du
  31/10/2026 : elle se valide à partir de ce jour-là ») sans bouton ; le menu grise le geste avec sa date et l'explique
  au clic ; les lots du brouillard ne comptent et n'envoient que les pièces du jour, et nomment celle qui attend ;
- « La valider dans la saisie », le jour venu, arrivait en haut de la grille, le brouillard sous le bord de l'écran : il
  arrive au brouillard, comme « Voir le brouillard » (1.101.0).

### 1.103.0 — Hatem demande une pièce, Sami l'envoie

- vu et juste : Hatem demande « Le relevé BIAT d'octobre 2026 » depuis Messages ; chez Sami, le fil le montre « À
  envoyer », il choisit le PDF au clavier, la demande passe « Reçue » des deux côtés, et le fichier arrive chez Hatem
  sans recharger, marqué « Lue » ;
- chez Sami, la demande ne se voyait qu'à la pastille « 1 » de « Mon comptable », au bas d'un menu à faire défiler :
  « À faire » de l'Accueil porte désormais « Ton cabinet attend 1 pièce » (ou des réponses), du même compte que la
  pastille, avec « Répondre » qui mène au fil ; l'Accueil ouvert se relit quand ce compte change ;
- au Cabinet, « Ce qui attend le client » affirmait « ce client a répondu à tes questions et envoyé les pièces
  demandées » sur un fil où rien n'avait jamais été demandé : il dit « aucune question ni pièce demandée n'attend sa
  réponse », vrai dans tous les cas ;
- le refus « Un message vide… » restait affiché sous la pièce qu'on était en train de nommer : un refus se lève au
  premier mot du champ qu'il montre (message ou pièce demandée).

### 1.104.0 — le Cabinet sans réseau

Hatem ouvre son Cabinet, puis le serveur de recette est arrêté pour de vrai :

- vu et juste : le dossier de Sami s'ouvre sans réseau, le bandeau dit « Hors ligne depuis 0 h 41. Tu consultes la
  copie de ce poste, du 22/10/2026 à 0 h 41. Enregistrer demande le réseau. », le journal montre 6 778,707 comme en
  ligne ; la page se recharge sans réseau ; le réseau revenu, « Recharger » remet en ligne ;
- avant, le Cabinet ne gardait rien : sans réseau, plus rien ne s'ouvrait ; il emporte maintenant ses dossiers
  (l'exercice en cours), chiffrés ;
- « Verrouiller maintenant » était caché dans Réglages › Données et sécurité : « Se déconnecter » est au pied de la
  barre, et dit ce qu'il efface avant de le faire ;
- le bandeau hors ligne recouvrait le nom du cabinet, puis la page débordait d'autant (barre de défilement) : la
  page se range dessous et tient dans la fenêtre.

### 1.105.0 — le Cabinet saisit sans réseau

Hatem, le serveur de recette arrêté pour de vrai, saisit une OD de 35,500 DT dans le dossier de Sami :

- vu et juste : « Enregistrer en brouillard » la garde sur le poste ; le bandeau dit « Une écriture attend le réseau »,
  la ligne du brouillard « attend le réseau », « Valider cette écriture » est grisé avec sa raison ; « Se déconnecter »
  dit qu'elle serait perdue ; au premier geste après le retour du serveur, elle part, et la base n'en a qu'une ;
- « Enregistrer et valider » (le bouton vert) refusait sans offrir la suite : la fenêtre propose maintenant
  « Enregistrer en brouillard » ;
- « Joindre un justificatif… » restait proposé sur une pièce que le serveur n'a pas encore : il se grise, comme valider ;
- la marque « attend le réseau » était pâle, en italique, presque illisible : elle prend la teinte d'un avertissement ;
- le bouton de la déconnexion disait « les perdre » pour une seule écriture : « la perdre » ;
- le serveur revenu, rien ne partait tant qu'on ne touchait à rien (seul le serveur était tombé, le navigateur ne dit
  rien) : le poste réessaie seul toutes les 30 secondes tant qu'une écriture attend ;
- noté, gardé : le bandeau qui apparaît pousse la page de sa hauteur ; le curseur reste dans son champ (la frappe
  continue), seul un clic au même instant peut viser une ligne trop haut. Le recouvrement, avant, cachait le nom du
  cabinet : on garde la page poussée.

## Ce qui reste (les lots suivants)

1. Rien d'ouvert sur l'abonnement après la recette du 20/10/2026 : activé, renouvelé, en groupe, choisi dans
   l'application.
2. Au téléphone, plus aucun écran ne défile de côté (console, entreprise et Cabinet relevés le 21/10/2026) ; restent
   voulus la matrice des droits, les routes du serveur et la rangée des tris en pastilles.
3. Rien d'ouvert sur la saisie du Cabinet au clavier (1.87.7).
4. Le vrai hors-ligne des devis et brouillons (vision § 4.5) ne vaut que sur « mon ordinateur » ; ailleurs, l'écran le
   dit avant le geste.
5. À la tablette debout (761 à 1 023 px), plus rien ne défile de côté (1.87.16) ; à 1 024 px, rien ne débordait.
6. Au clavier, chaque case des trente-deux écrans de l'entreprise, des sept du Cabinet et des six fenêtres de saisie
   relevés porte un nom (1.87.19, 1.87.20, 1.87.22).
7. La caisse : vendue, rendue et fermée au téléphone, juste au millime ; tenue sur un appareil perdu, elle se ferme
   d'ici (1.87.14).
8. Au téléphone, les bulles « i » des titres de colonne d'une ligne se rangent au-dessus des lignes (1.93.0).
9. Le PDF du Cabinet se fait au serveur, comme celui de l'entreprise (1.92.0).
10. Les questions du comptable arrivent sans recharger ; une relance se fait un autre jour (1.94.0) ; on y répond avec
    le fichier attendu (1.95.0).
11. À VÉRIFIER avec les comptables pilotes (vu le 21/10/2026) : les ventes d'une quincaillerie (« Commerce et vente de
    produits ») tombent en 706 (prestations de services), le compte de ventes par défaut du moteur ; des marchandises
    iraient en 707. Le compte se règle par dossier ; la question est le défaut : 707 pour une activité de commerce, ou
    une ventilation par article (produit ou service).
12. **À faire (demandé par Skander le 22/10/2026)** : la revue UI et UX de la messagerie entre l'entreprise et son
    cabinet (`docs/messagerie.md`), en développeur designer : comment les deux se parlent (messages, questions du
    comptable, pièces demandées, relances, réponses avec fichier), si c'est pratique et ergonomique des deux côtés, à
    la souris, au clavier et au téléphone, et comparé à ce que font les autres (Hesabi, Pennylane, Tiime, Dext,
    Karbon, les messageries des cabinets). Le but : que ce soit parfait. Un rapport d'abord, avec captures, puis les
    corrections. *Fait : `docs/revue-messagerie.md`, trois lots (1.115.0 à 1.117.0).*
13. **À faire (demandé par Skander le 23/10/2026 : « note tout dans le backlog car ça doit être fait »)** : rendre
    l'expérience meilleure dans les parcours, et une interface qui donne envie de travailler dessus. Dans cet ordre :
    - **UX 1 — le mois d'un client vu des deux côtés** : `docs/revue-mois-client.md` (18 points, trois lots). Lot 1 :
      la pièce reçue qui retrouve l'achat déjà saisi, la demande du comptable dans l'« À faire », le bandeau « tout est à
      jour » honnête, la carte « Ce mois-ci » de « Mon comptable », un seul vert (*fait en 1.123.0, sauf la carte, qui suit*). Lot 2 : les achats confiés, réclamer le
      justificatif depuis le brouillard, la validation qui prévient, le « Suivi » du mois, l'invitation, l'appel de paie
      refusé. Lot 3 : la facture émise en page de lecture, la création rapide d'un client, les visites proposées, les
      noms de boutons, la fin de la validation.
    - **UX 2 — les états de chaque écran** (vide, chargement, erreur, lecture seule, hors ligne), dans les trois
      applications ; d'abord la lecture seule des autres listes (achats, clients, stock…), comme les factures et les devis
      en 1.122.0.
    - **UX 3 — une interface qui donne envie** : une seule façon de dire un état (calme, attire, alerte) dans
      l'entreprise, le Cabinet et la console, un catalogue des pièces de l'écran tenu par des tests, puis une passe
      visuelle sur les écrans du quotidien (accueil, listes, pièces, téléphone), dans la DA.
    - **Ensuite** : la recherche Ctrl K aussi au Cabinet et à la console ; la barre du bas au téléphone pour les écrans du
      quotidien ; la photo d'un ticket qui file dans les achats et chez le comptable d'un geste ; les rappels par e-mail du
      cabinet au rythme choisi par le client ; ce que le cabinet a le droit de faire, dit en clair, avec une seule liste
      « à accepter » ; la demande qui revient chaque mois (attend l'avis des pilotes).
    - **À décider par Skander** : compter quelques gestes sur notre serveur pour savoir où les gens bloquent (une donnée
      de plus : la liste se fait d'abord) ; et regarder travailler les comptables pilotes, le levier le plus fort.
