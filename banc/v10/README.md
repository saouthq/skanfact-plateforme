# Le moteur de l'application actuelle (v10), figé pour le banc

Copie **à l'identique** de `src/renderer/core.js`, `compta.js` et `demo.js` du dépôt
[`saouthq/skanfact`](https://github.com/saouthq/skanfact), au commit `8ebca4a` (27/09/2026, v10.15.0-beta.1).
On ne la modifie jamais : elle sert de référence au banc qui compare l'ancien moteur et le nouveau
**au millime** (cadrage `08` § 1.2). Quand la v10 reçoit une correction de calcul, la copie est
remplacée par la nouvelle version (même commande), et le banc dit ce qui change.

`package.json` ne sert qu'à dire à Node que ces fichiers sont d'anciens modules CommonJS.
