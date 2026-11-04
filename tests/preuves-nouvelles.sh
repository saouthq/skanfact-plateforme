#!/bin/bash
# Les preuves NOUVELLES ou CHANGÉES depuis BASE (par défaut origin/dev : ce que GitHub a déjà) — celles
# de la brique en cours —, et elles seules, en groupes côte à côte. Pendant le travail, on ne prouve
# qu'elles ; GitHub rejoue TOUTES les preuves à chaque envoi, et on lit son verdict avant l'envoi
# suivant (décision de Skander, 30/09/2026 : avancer plus vite, sans retirer une seule preuve).
# Une preuve est « changée » dès qu'un de ses cinq arguments change, variables comprises.
#
#   PG_ADMIN=postgres://… bash tests/preuves-nouvelles.sh           (BASE=origin/dev, GROUPES=2)
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN:?PG_ADMIN manque (adresse d'un compte d'administration PostgreSQL)}"
BASE="${BASE:-origin/dev}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$ICI" show "$BASE:tests/preuves.sh" > "$tmp/base.sh" 2>/dev/null \
  || { echo "BASE=$BASE introuvable (git fetch origin main ?)" >&2; exit 2; }
bash "$ICI/tests/lister-preuves.sh" "$tmp/base.sh" > "$tmp/base.lst" || exit 2
bash "$ICI/tests/lister-preuves.sh" "$ICI/tests/preuves.sh" > "$tmp/ici.lst" || exit 2
python3 - "$tmp/base.lst" "$tmp/ici.lst" > "$tmp/noms.txt" <<'EOF'
import sys
def lire(p):
    b = open(p, 'rb').read().split(b'\0')[:-1]
    return [tuple(b[i:i + 5]) for i in range(0, len(b), 5)]
base = set(lire(sys.argv[1]))
for p in lire(sys.argv[2]):
    if p not in base: print(p[0].decode('utf-8'))
EOF
# Et un fichier servi dont la liste de morceaux change (17 § 6, point 4 : un morceau nouveau, retiré ou déplacé) choisit
# toutes ses preuves, même celles qui n'ont pas changé (outils/rangement/preuves.ts).
git -C "$ICI" show "$BASE:modules/assemblage.json" > "$tmp/table-base.json" 2>/dev/null || : > "$tmp/table-base.json"
(cd "$ICI" && node outils/rangement/preuves.ts --choisir "$tmp/table-base.json" "$tmp/ici.lst") >> "$tmp/noms.txt" || exit 2
sort -u -o "$tmp/noms.txt" "$tmp/noms.txt"
n="$(grep -c . "$tmp/noms.txt")"
if [ "$n" -eq 0 ]; then echo "Aucune preuve nouvelle ou changée depuis $BASE."; exit 0; fi
echo "$n preuves nouvelles ou changées depuis $BASE."
groupes="${GROUPES:-2}"
[ "$n" -lt "$groupes" ] && groupes="$n"
NOMS="$tmp/noms.txt" GROUPES="$groupes" bash "$ICI/tests/preuves-paralleles.sh"
