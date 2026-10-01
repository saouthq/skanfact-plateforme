# Les droits geste par geste dans le dossier

*30/09/2026, brique 99. Le cadrage fait foi : `docs/cadrage/03-droits.md` § 2.1 (les gestes, module par module)
du dépôt `skanfact`. Décisions prises par délégation, le 30/09/2026.*

## Ce qui ne marchait pas

Le dossier que l'interface de la v10 tient se lisait et s'écrivait **en entier**, par le propriétaire et
l'administrateur seulement. Un commercial, une comptable interne, une personne de la paie ne pouvaient pas
utiliser l'application. Et la première facture d'une entreprise (qui crée sa série de numéros) ne s'émettait que
par le propriétaire.

## Ce que fait la brique 99

**D1. Le dossier se découpe en parties** (`serveur/v10/droits.ts`) : chaque liste (les pièces, les clients, le
catalogue, les salariés…) et chaque champ de la racine (la fiche société, les compteurs…) a un geste pour la lire
et un pour l'écrire, pris dans les gestes des modules (03 § 2.1). Une partie sans règle n'est lue et écrite que
par le propriétaire et l'administrateur (la valeur qui ne donne rien de plus). Une liste vide, que l'écran écrit
comme un champ de la racine, garde la règle de sa liste.

| Partie | Qui la lit | Qui l'écrit |
|---|---|---|
| Pièces de vente, contrats récurrents, modèles, textes, affaires | ventes (P, A, C ; I et L voient) | P, A, C |
| Clients | ventes | P, A, C |
| Catalogue, listes de prix | P, A, M ; C, K, I, L voient | P, A (les prix) |
| Fournisseurs, achats, commandes fournisseurs, réceptions | P, A, I ; L voit | P, A, I |
| Comptes de trésorerie / leurs mouvements | P, A, I ; L voit | P, A / P, A, I |
| Mouvements de stock, numéros de série, dépôts | stock | P, A, M |
| Salariés, bulletins, congés, avances, déclarations sociales, barèmes | P, A, Pa | P, A, Pa |
| Immobilisations, opérations diverses, échéances fiscales, clôtures | comptabilité | P, A, I |
| Fiche de la société | tous | P, A |
| Compteurs, pièces supprimées, versions écartées | tous | quiconque écrit |
| Clôture des périodes | tous | qui clôture |

**D2. Chacun ne lit que sa part.** Le serveur ne renvoie que les parties visibles, et dit à l'écran ce qu'il ne
doit ni montrer ni renvoyer (`cachees`), ce qu'il lit sans pouvoir l'écrire (`lectureSeule`), et la liste blanche
de ce qui peut repartir (`ecrivables` ; `tout` pour le propriétaire et l'administrateur).

**D3. Chacun n'écrit que sa part.** Un envoi qui touche une partie interdite n'écrit **rien**, et le refus la nomme
en français (« Ton rôle ne permet pas d'enregistrer le catalogue dans le dossier de l'entreprise… »).

**D4. L'écran ne renvoie jamais ce que la personne ne peut pas écrire** (`pont.js`) : il retouche à son ouverture
la fiche société ou le catalogue (il complète une fiche d'avant) — ce n'est pas la personne qui les change, et
rien ne part (ni une modification, ni une suppression). Quand elle essaie vraiment (le prix d'un article, les
Paramètres), l'écran le lui refuse **avant le geste**, en disant qui peut le faire (`web/v10/droits.txt`).

**D5. La série de numéros naît avec la première facture**, même émise par un commercial (`ventes.serie_v10`, 0053) ;
créer une autre série reste au propriétaire et à l'administrateur.

## Les tests

- `tests/v10/droits-dossier.test.ts` : ce que lisent le commercial, la paie, la comptabilité interne ; ce qu'ils
  écrivent ; le refus qui nomme la partie et n'écrit rien ; la première facture du commercial.
- `tests/web/droits-dossier.test.ts` : Karim, commercial, facture son client (la première facture de
  l'entreprise), ne voit pas la paie ; le prix d'un article et les Paramètres lui sont refusés avant le geste, et
  rien ne part. Deux écrans regardés.
- `tests/v10/dossier.test.ts` et `tests/socle/porte.test.ts` retournés vers la nouvelle règle.
- 13 preuves (`tests/preuves.sh`, brique 99).

## Le menu selon le rôle (brique 101, 30/09/2026)

Une page qui lit une partie cachée à la personne (la Paie pour un commercial, les Factures pour la personne chargée
de la paie) se lisait comme une page vide : « aucun salarié », une phrase rassurante sur un univers qu'on ne voit
pas. Désormais (`web/v10/menu-role.txt`, par délégation) :

- chaque page déclare les parties du dossier qu'elle lit (`PARTIES_DES_PAGES` : Marges lit les ventes **et** les
  achats) ; le menu ne propose que celles dont aucune partie n'est cachée ;
- l'adresse d'une page cachée, ouverte quand même (un lien, la recherche), dit « Ton rôle ne te montre pas cette
  page », pourquoi, et « Revenir à l'accueil » ; elle ne propose pas sa visite guidée.

Test : `tests/web/menu-role.test.ts` (Karim, commercial ; Leila, la paie). 5 preuves.

## Les pages en lecture seule (brique 102, 01/10/2026)

Une personne qui lit une partie sans pouvoir l'écrire (la comptabilité interne lit les factures et les clients ; la
lecture lit tout) voyait « Brouillon enregistré », « Paiement enregistré » : le point de contact ne renvoyait rien,
et rien n'arrivait au serveur. Désormais (`web/v10/lecture-seule.txt`, par délégation) :

- la page dont la partie principale se lit seulement le dit avant le premier geste (bandeau « Lecture seule ») ;
- les gestes qui modifieraient refusent en le disant, rien n'étant enregistré : enregistrer ou émettre une pièce de
  vente, un paiement sur une facture, une fiche client, fournisseur ou salarié, un mouvement de stock.

Test : `tests/web/lecture-seule.test.ts` (Samia, comptabilité interne ; Omar, lecture). 5 preuves.

## L'accueil selon le rôle (brique 111, 01/10/2026)

L'accueil de la v10 s'adresse à qui tient l'entreprise. Leila (paie) y voyait « + Nouveau devis », « + Nouvelle
facture », la bienvenue et « Tes premiers pas » (compléter la fiche société, créer un client) : des boutons que rien
ne tient pour elle. Maintenant (`web/v10/accueil-role.txt`) :
- les deux boutons de pièce ne paraissent qu'à qui peut écrire les pièces de vente ;
- la bienvenue et les premiers pas (mettre l'entreprise en place) sont pour le propriétaire et les administrateurs ;
- les autres membres trouvent « Ton accès à … » : les pages de leur menu, chacune d'un clic (la première en vert
  quand l'en-tête n'a pas de bouton principal) ;
- une ligne « À faire » qui mènerait à une page que le rôle ne montre pas reste dite, sans bouton (l'échéance de
  la CNSS, dont le calendrier vit dans la Comptabilité, pour la paie).
Test : `tests/web/menu-role.test.ts` (Karim, commercial ; Leila, paie), 4 preuves.

## Reste connu

- Faits ensuite (brique 102 bis) : supprimer une pièce de vente, une fiche client, fournisseur ou salarié, un achat ;
  enregistrer un achat. Restent les gestes plus rares (un contrat récurrent, un modèle, une affaire…) : même garde à
  poser (`enLecture`, `refusLecture`).
- **TEJ** (attestations de retenue, `05` § 3.3) : le cahier des charges officiel (TEJ-CCT-RS-V2.0) est publié sur
  jibaya.tn, inaccessible depuis la session de travail : le format reste **À VÉRIFIER** avant d'écrire le fichier.
- **Une page neuve de la v10** doit déclarer ses parties dans `PARTIES_DES_PAGES`, sinon elle s'ouvre pour tous.
- L'accueil d'une personne qui ne voit pas les ventes (la paie) montre encore les « premiers pas » du propriétaire.
- **Les autres éditeurs** : l'écran refuse avant le geste pour le catalogue et les Paramètres ; pour les autres
  parties en lecture seule (une personne de la comptabilité interne qui ouvre une facture en brouillon), le serveur
  n'en reçoit rien, mais l'éditeur ne le dit pas encore : à faire avec le menu par rôle.
- **Au champ près** : le magasinier devrait écrire un article sans ses prix, la comptabilité interne encaisser un
  règlement sur une facture, le commercial ne supprimer que ses brouillons (03 § 2.1).
- Le caissier et le magasinier : leurs gestes viendront avec la caisse et le stock complet (étape 4).
- Les écrans de l'accord d'un responsable : faits (brique 100, `docs/accords.md`).
