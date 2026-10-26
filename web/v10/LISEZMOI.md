# Archive : les fiches de retouche de la v10

Jusqu'au 26/10/2026, les écrans de l'application (`web/public/v10`) étaient la copie de la v10 (`source/`), à laquelle
`reprendre.mjs` appliquait les fiches de retouche de ce dossier (`*.txt`, `adaptations.mjs`), chacune avec sa raison.

**Depuis le 26/10/2026 (Skander : « la vraie version à jour est dans skanfact-plateforme »), `web/public/v10` est notre
code et se modifie directement.** Ce dossier ne sert plus : il garde l'histoire (le « pourquoi » de chaque retouche, que
`docs/carte.md` cite encore). Ne plus lancer `reprendre.mjs` : il écraserait le code d'aujourd'hui.
