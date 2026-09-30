#!/bin/bash
# Les preuves d'un fichier comme tests/preuves.sh, LUES sans être lancées : pour chacune, ses cinq
# arguments (nom, fichier, avant, après, test qui doit tomber), chacun suivi d'un caractère nul. Sert
# au contrôle éclair (tests/verif-preuves.sh) et au choix des preuves nouvelles
# (tests/preuves-nouvelles.sh), qui lit aussi l'ancienne version du fichier.
#
#   bash tests/lister-preuves.sh [fichier]        (par défaut tests/preuves.sh)
set -u
source_="${1:-$(dirname "$0")/preuves.sh}"
prouver() { printf '%s\0' "$1" "$2" "$3" "$4" "$5"; }
# Les preuves commencent à la ligne « M=base/migrations/0001_socle.sql » ; le bilan final est retiré.
corps="$(sed -n '/^M=base\/migrations\/0001_socle\.sql$/,$p' "$source_" \
  | grep -v -e '^echo; echo "\$ok preuves faites' -e '^\[ "\$ko" -eq 0 \]$')"
[ -n "$corps" ] || { echo "aucune preuve lue dans $source_" >&2; exit 2; }
eval "$corps"
