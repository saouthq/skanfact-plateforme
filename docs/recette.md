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

## Ce qui reste (les lots suivants)

1. **1.76** : le Cabinet et la console. La page Dossiers qui ne se relit pas quand on y revient (la proposition d'un
   client n'apparaît qu'après rechargement, « à valider » reste affiché après la validation) ; « Aucun mois attendu »
   alors qu'un mois est écrit ; « Aucune écriture sur cette période » alors que des écritures du client attendent au
   brouillard ; « email à renseigner » alors que la fiche du client les porte ; les restes de la v10 (« Reprendre mon
   portefeuille de SkanFact Cabinet v10… », « v10 · en ligne ») ; des mots (« Adresse de l'employeur », « chez ton
   dossier », « Abonnements » pour les écritures qui reviennent, un « ; » en début de ligne, « il reste à taper ») ; à
   la console, « aucune en septembre » pour une entreprise née en octobre.
2. **1.77** : inviter son comptable par e-mail, depuis l'entreprise, quand il n'est pas encore sur SkanFact.
3. **1.78** : inviter son client tenu à rejoindre son dossier, depuis le Cabinet (prévu au cadrage).
4. **1.79** : choisir son offre dans l'application (« Je choisis cette offre », que la console voit dans « À décider »),
   au lieu d'un e-mail. Le processus change, pas les prix : montré à Skander avant l'envoi.
