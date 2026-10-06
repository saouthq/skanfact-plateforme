# L'entrée de SkanFact (lot entrée, 06/10/2026)

Les écrans qu'on voit avant l'application : se connecter, créer son compte, le code du téléphone, la porte de la
première fois, ton entreprise, la sécurité, l'ouverture. Refaits d'après les maquettes validées par Skander le
06/10/2026 (« oui go fait tout je valide et les fonctions pas encore faites on les développe »), et d'après ce que le
parcours du débutant avait relevé (docs/debutant.md).

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
| Protège ton compte | « ton rôle l'exige » ; l'entreprise créée ? rien ne le disait | « Ton entreprise « X » est créée » ; pourquoi le code, en clair ; ce qui va se passer en trois lignes |
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
SKANFACT_COURRIEL_DE=ne-pas-repondre@skanfact.tn
```

Sans ces deux lignes, rien ne part et l'écran ne propose pas le mot de passe oublié (c'est le cas du serveur d'essai
aujourd'hui). **À DÉCIDER** avec Skander : le fournisseur du relais (son prix, où il garde les adresses : INPDP),
et l'adresse d'expédition (qui demande un enregistrement SPF/DKIM dans la zone skanfact.tn, chez Cloudflare).

## Ce qui n'est pas fait, et pourquoi

- **Recevoir le code par SMS** : aucun fournisseur de SMS n'est encore choisi (03 § 6 ; `SKANFACT_SMS` n'admet que
  « aucun »). L'écran ne le propose donc pas. À DÉCIDER : le fournisseur.
- **Confidentialité, Conditions** : les pages du site décrivent l'application de bureau (les données sur l'ordinateur) ;
  les lier depuis la plateforme dirait faux. Elles viendront avec les textes de la plateforme (À VÉRIFIER avec un juriste
  et l'INPDP).
- **Le logo** : le « S » dans un carré est provisoire.
