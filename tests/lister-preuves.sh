#!/bin/bash
# Les preuves d'un fichier comme tests/preuves.sh, LUES sans être lancées : pour chacune, ses cinq
# arguments (nom, fichier, avant, après, test qui doit tomber), chacun suivi d'un caractère nul. Sert
# au contrôle éclair (tests/verif-preuves.sh) et au choix des preuves nouvelles
# (tests/preuves-nouvelles.sh), qui lit aussi l'ancienne version du fichier.
#
#   bash tests/lister-preuves.sh [fichier]        (par défaut tests/preuves.sh)
set -u
source_="${1:-$(dirname "$0")/preuves.sh}"
# Avec LIGNES=1, un sixième champ : la ligne du fichier où commence l'appel (les preuves qui suivent le code,
# outils/rangement/preuves.ts, réécrivent le fichier visé à cette ligne).
if [ "${LIGNES:-}" = 1 ]; then
  prouver() { printf '%s\0' "$1" "$2" "$3" "$4" "$5" "$((PREMIERE + BASH_LINENO[0] - EVAL))"; }
else
  prouver() { printf '%s\0' "$1" "$2" "$3" "$4" "$5"; }
fi
# Les preuves commencent à la ligne « M=base/migrations/0001_socle.sql » ; le bilan final est retiré.
corps="$(sed -n '/^M=base\/migrations\/0001_socle\.sql$/,$p' "$source_" \
  | grep -v -e '^echo; echo "\$ok preuves faites' -e '^\[ "\$ko" -eq 0 \]$')"
[ -n "$corps" ] || { echo "aucune preuve lue dans $source_" >&2; exit 2; }
PREMIERE="$(grep -n '^M=base/migrations/0001_socle\.sql$' "$source_" | head -1 | cut -d: -f1)"
EVAL=$LINENO; eval "$corps"
