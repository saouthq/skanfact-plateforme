#!/bin/bash
# Les preuves (tests/preuves.sh) en GROUPES qui tournent côte à côte : chacun a sa propre base de test,
# et le lot entier dure environ le temps d'un groupe. Mêmes restrictions possibles (SEULES, FICHIERS).
#
#   PG_ADMIN=postgres://… bash tests/preuves-paralleles.sh        (4 groupes)
#   GROUPES=3 PG_ADMIN=postgres://… bash tests/preuves-paralleles.sh
#
# Le résultat : chaque preuve non prouvée, et le total ; un seul groupe qui échoue fait échouer le lot.
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN:?PG_ADMIN manque (adresse d'un compte d'administration PostgreSQL)}"
GROUPES="${GROUPES:-4}"
journaux="$(mktemp -d)"
for k in $(seq 1 "$GROUPES"); do
  PARTIE="$k/$GROUPES" bash "$ICI/tests/preuves.sh" > "$journaux/$k.txt" 2>&1 &
done
wait
ok=0; ko=0
for k in $(seq 1 "$GROUPES"); do
  grep -E '^(PROUVÉE|NON PROUVÉE)' "$journaux/$k.txt" | sed "s/^/[groupe $k] /"
  grep -q 'motif introuvable' "$journaux/$k.txt" && grep -B1 -A1 'motif introuvable' "$journaux/$k.txt" | sed "s/^/[groupe $k] /"
  # Un groupe qui s'arrête avant sa fin n'a pas tout prouvé : il échoue.
  grep -q 'preuves faites' "$journaux/$k.txt" || { echo "[groupe $k] arrêté avant la fin :"; tail -5 "$journaux/$k.txt"; ko=$((ko+1)); }
  ok=$((ok + $(grep -c '^PROUVÉE' "$journaux/$k.txt")))
  ko=$((ko + $(grep -c '^NON PROUVÉE' "$journaux/$k.txt")))
done
rm -rf "$journaux"
echo; echo "$ok preuves faites, $ko non prouvées ($GROUPES groupes côte à côte)."
[ "$ko" -eq 0 ]
