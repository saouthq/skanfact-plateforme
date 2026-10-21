# « Signaler un problème », avec le journal de cet écran

*21/10/2026, lot Fonctions 3 (1.91.0). La v10 de bureau joignait au signalement le journal de l'ordinateur
(`docs/lecons-v10.md`, 6.6.0). La plateforme envoyait déjà la demande au support (Support S1, `docs/support.md`), mais
cachait « Aide et dépannage » et la visite « Signaler », faute de journal.*

## Ce qui change pour la personne

- **Paramètres › L'application › Aide et dépannage** revient : « Signaler un problème… », « Proposer une
  amélioration… », **« Voir le journal de cet écran »**, « Ouvrir l'aide ».
- L'écran **note ses erreurs** (celles qui le font tomber en panne sans qu'il le dise) le temps de l'onglet. « Voir le
  journal de cet écran » les montre ; « Aucune erreur notée » quand il n'y en a pas.
- En écrivant au support, s'il y a des erreurs notées, une case **cochée** propose de les joindre (« Et le journal de cet
  écran : N erreurs… », avec « Lire ce journal avant de l'envoyer ») ; décochée, rien n'en part.
- La visite « Signaler un problème ou proposer une idée » revient dans « Guide-moi ».

## Ce qui part, compté et décidé (par délégation, 21/10/2026)

La règle : jamais une donnée de plus vers un serveur sans que la liste soit comptée et décidée. Le journal de cet écran,
**seulement si la case est cochée**, pour chacune des **20 dernières** erreurs de l'onglet :

1. l'heure (à Tunis) ;
2. le message de l'erreur, tel que le navigateur l'a écrit, **300 signes au plus** ;
3. l'endroit du code de SkanFact (`fichier.js:ligne:colonne`), seulement pour un fichier de SkanFact (rien d'une autre
   adresse).

Rien d'autre : ni le contenu des champs, ni l'adresse de la page, ni le navigateur. Le journal part **sous le texte** de
la demande, dans les 4 000 signes d'un message (les lignes les plus anciennes partent d'abord) ; l'équipe le lit dans la
demande, la personne aussi. Il ne se garde **pas sur le poste** : il vit en mémoire, et disparaît avec l'onglet.

**À VÉRIFIER** : un message d'erreur peut, rarement, reprendre un mot saisi ; c'est pourquoi la case se décoche et le
journal se lit avant d'envoyer.

## Comment

- `web/public/plateforme/pont.js` : `journalDeLEcran` (les erreurs `error` et `unhandledrejection` de la fenêtre).
- `web/v10/signaler.txt` : la case dans « Écrire au support », « Voir le journal de cet écran », les textes du panneau et
  de la visite.
- Rien de neuf au serveur : la demande est celle du support (`plateforme.support_ecrire`).

## Tests

`tests/web/signaler.test.ts` : une erreur levée dans l'écran se lit dans le journal, part sous le texte de la demande
quand la case est cochée, et pas quand elle est décochée. Preuves dans `tests/preuves.sh`.
