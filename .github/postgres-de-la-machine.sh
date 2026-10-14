#!/usr/bin/env bash
# PostgreSQL 16, celui qu'Ubuntu 24.04 installe sur chaque machine de GitHub (arrêté par défaut), démarré sur place : aucune
# image à télécharger avant les tests. Le 09/10/2026, Docker Hub refusait les machines de GitHub ; à partir du 14/10, le
# miroir d'AWS qui l'avait remplacé échouait à son tour, une tâche sur quelques-unes (« Docker pull failed »), et GitHub
# ne retente pas le téléchargement d'un service : la tâche tombait avant le moindre test. Démarré ici, rien ne passe par
# le réseau. Le même PostgreSQL 16 d'Ubuntu que celui des essais sur un poste (btree_gist compris).
set -euo pipefail
v=16
if [ ! -x "/usr/lib/postgresql/$v/bin/postgres" ]; then
  echo "PostgreSQL $v n'est pas installé sur cette machine : la vérification demande ubuntu-24.04." >&2
  exit 1
fi
sudo systemctl start postgresql.service
for _ in $(seq 1 30); do pg_isready -q -h localhost -p 5432 && break; sleep 1; done
pg_isready -h localhost -p 5432
# Une base jetable, qui n'existe que le temps de la vérification : ce mot de passe n'est pas un secret.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "alter user postgres password 'postgres'"
psql "postgres://postgres:postgres@localhost:5432/postgres" -Atc 'select version()'
