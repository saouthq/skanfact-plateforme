#!/usr/bin/env bash
# Un téléchargement (les paquets d'Ubuntu, le navigateur des tests) qui échoue une fois pour une raison de réseau se
# retente, trois fois au plus, à quinze secondes d'écart ; trois échecs de suite font tomber l'étape, comme avant.
# Usage : bash .github/reessayer.sh <commande> [arguments…]
set -uo pipefail
for essai in 1 2 3; do
  "$@" && exit 0
  echo "Essai $essai sur 3 tombé : « $* »." >&2
  [ "$essai" -lt 3 ] && sleep 15
done
exit 1
