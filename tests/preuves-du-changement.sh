#!/bin/bash
# Les preuves qu'un envoi concerne (décidé par Skander le 05/10/2026 : en développement, la version arrive sur le
# serveur d'essai en une dizaine de minutes ; TOUTES les preuves tournent chaque nuit et avant la production) :
#   - les preuves nouvelles ou changées depuis BASE ;
#   - les preuves dont le fichier visé (celui où le défaut est remis) a changé depuis BASE.
# Écrit leurs noms, un par ligne, dans le fichier donné (vide s'il n'y en a aucune).
#
#   BASE=<version d'avant> bash tests/preuves-du-changement.sh noms.txt
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
SORTIE="${1:?le fichier où écrire les noms}"
BASE="${BASE:-origin/main}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$ICI" show "$BASE:tests/preuves.sh" > "$tmp/base.sh" 2>/dev/null \
  || { echo "BASE=$BASE introuvable" >&2; exit 2; }
git -C "$ICI" diff --name-only "$BASE" HEAD > "$tmp/changes.txt" || exit 2
bash "$ICI/tests/lister-preuves.sh" "$tmp/base.sh" > "$tmp/base.lst" || exit 2
bash "$ICI/tests/lister-preuves.sh" "$ICI/tests/preuves.sh" > "$tmp/ici.lst" || exit 2
python3 - "$tmp/base.lst" "$tmp/ici.lst" "$tmp/changes.txt" > "$SORTIE" <<'PY'
import sys
def lire(p):
    b = open(p, 'rb').read().split(b'\0')[:-1]
    return [tuple(b[i:i + 5]) for i in range(0, len(b), 5)]
base = set(lire(sys.argv[1]))
changes = {l.strip() for l in open(sys.argv[3], encoding='utf-8') if l.strip()}
for p in lire(sys.argv[2]):
    fichiers = set(p[1].decode('utf-8').split('|||'))
    if p not in base or fichiers & changes: print(p[0].decode('utf-8'))
PY
echo "$(grep -c . "$SORTIE") preuves concernées par le changement depuis $BASE."
