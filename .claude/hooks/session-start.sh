#!/bin/bash
# Le démarrage d'une session de Claude sur le web (1.106.0 ; CLAUDE.md, « Commandes ») : à l'ouverture, ce dépôt est
# prêt à tester dès la première commande. Le 22/10/2026, la machine de la session a redémarré en plein travail :
# PostgreSQL arrêté, chaque test tombait sur « connexion refusée ». Ce script pose ce qui manque, et seulement cela
# (relancé, il ne refait rien) :
#   - les outils du système des tests (PostgreSQL 16, l'écran virtuel, Poppler, xmllint, age) ;
#   - les dépendances (npm), et la coque de bureau (Electron) ;
#   - PostgreSQL 16 sur 127.0.0.1:5433, sans mot de passe sur la machine (une base de développement, jetable) ;
#   - PG_ADMIN pour toute la session.
# Ailleurs que sur le web (l'ordinateur de quelqu'un), il ne fait rien.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Les outils du système : un paquet par fichier qu'il pose.
manque=()
for p in postgresql-16:/usr/lib/postgresql/16/bin/postgres xvfb:/usr/bin/xvfb-run poppler-utils:/usr/bin/pdftotext \
  libxml2-utils:/usr/bin/xmllint age:/usr/bin/age; do
  [ -e "${p#*:}" ] || manque+=("${p%%:*}")
done
if [ ${#manque[@]} -gt 0 ]; then
  echo "Outils à poser : ${manque[*]}"
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${manque[@]}"
fi

# Les dépendances (gardées par la machine d'une session à l'autre : `install`, pas `ci`).
npm install --no-audit --no-fund --loglevel=error
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js

# PostgreSQL 16 sur le port 5433.
DONNEES=/var/lib/pgproto/data
PG=/usr/lib/postgresql/16/bin
if [ ! -s "$DONNEES/PG_VERSION" ]; then
  mkdir -p "$DONNEES" && chown -R postgres "$(dirname "$DONNEES")"
  su postgres -c "$PG/initdb -D $DONNEES -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
if ! su postgres -c "$PG/pg_ctl -D $DONNEES status" >/dev/null 2>&1; then
  su postgres -c "$PG/pg_ctl -D $DONNEES -o '-p 5433' -l /var/lib/pgproto/pg.log -w start" >/dev/null
fi
"$PG/pg_isready" -q -h 127.0.0.1 -p 5433

echo 'export PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres' >> "${CLAUDE_ENV_FILE:-/dev/null}"
echo "Prêt : dépendances, PostgreSQL 16 sur 127.0.0.1:5433 (PG_ADMIN posé)."
