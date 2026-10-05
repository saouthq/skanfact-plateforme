#!/bin/bash
# Une commande au serveur d'essai, par l'accès de Claude (scripts/serveur.ts) ; la sortie passe par le relais https
# de la session (NODE_USE_ENV_PROXY).
exec env NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 node "$(dirname "$0")/serveur.ts" "$@"
