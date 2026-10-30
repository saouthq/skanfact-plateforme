#!/bin/bash
# Remplit dev.skanfact.tn avec l'exemple du Cabinet (données inventées), par une copie du programme de dev
# lancée à part, sans relais d'e-mails ni IA : le remplissage n'envoie rien. Les comptes perdent ensuite le code de
# l'application posé par l'exemple : sur dev.skanfact.tn, la connexion envoie un code par e-mail à l'alias Gmail.
# Usage (en root, sur le serveur, par scripts/serveur.sh) : DEMO_COURRIEL=boite@gmail.com bash scripts/humain/demo-dev.sh
# (1.183.0) DEMO_VIDER=1 : recharger (Skander, 30/10/2026 : « recharge l'exemple sur dev ») ; la base de dev (données
# inventées seulement) est d'abord refaite à neuf, comme le suiveur l'installe : la base, les migrations, les règles
# communes, les droits du compte du serveur. Jamais la base de la copie de main.
set -euo pipefail
[ -n "${DEMO_COURRIEL:-}" ] || { echo "DEMO_COURRIEL manque"; exit 1; }
if [ "${DEMO_VIDER:-}" = 1 ]; then
  BASE_DEV=skanfact_dev
  grep -q "/$BASE_DEV" /etc/skanfact/dev.env || { echo "la base de dev n'est pas $BASE_DEV : rien n'est vidé"; exit 1; }
  systemctl stop skanfact-dev
  runuser -u postgres -- psql -q -c "drop database if exists $BASE_DEV with (force)"
  runuser -u postgres -- psql -q -c "create database $BASE_DEV template template0 locale_provider icu icu_locale 'en-US-u-ka-shifted'"
  ( cd /opt/skanfact-dev/depot
    runuser -u postgres -- env PG_ADMIN="postgresql:///$BASE_DEV?host=/var/run/postgresql" node base/migrer.ts > /dev/null
    runuser -u postgres -- env PG_ADMIN="postgresql:///$BASE_DEV?host=/var/run/postgresql" node base/regles-communes.ts > /dev/null
    runuser -u postgres -- psql -q -d "$BASE_DEV" -c "grant skanfact_app to skanfact_dev_serveur" )
  systemctl start skanfact-dev
  echo "base de dev refaite à neuf"
fi
T=/root/demo-skanfact; rm -rf "$T"; mkdir -m 700 "$T"
cd /opt/skanfact-dev/depot
(
  set -a; . /etc/skanfact/dev.env; set +a
  unset SKANFACT_SMTP ANTHROPIC_API_KEY
  export SKANFACT_PORT=8096 SKANFACT_HOTE=127.0.0.1 SKANFACT_ETAT="$T/etat.json"
  exec node serveur/principal.ts
) > "$T/serveur.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:8096/v1/documentation && break; sleep 1; done
curl -sf -o /dev/null http://127.0.0.1:8096/v1/documentation || { echo "la copie ne démarre pas"; tail -20 "$T/serveur.log"; exit 1; }
DEMO_TRAVAIL="$T" DEMO_NAVIGATEURS=/opt/skanfact-dev/navigateurs node scripts/humain/exemple-cabinet.ts http://127.0.0.1:8096 > "$T/exemple.log" 2>&1 || { echo "l'exemple a échoué"; tail -20 "$T/exemple.log"; exit 1; }
kill $PID; wait $PID 2>/dev/null || true
BASE=$(grep '^SKANFACT_BASE=' /etc/skanfact/dev.env | sed 's|.*/||; s|?.*||')
LOCAL="${DEMO_COURRIEL%@*}"
sudo -u postgres psql -q -d "$BASE" -v ON_ERROR_STOP=1 <<SQL
delete from socle.code_secours where utilisateur in (select id from socle.utilisateur where email like '${LOCAL}+%@gmail.com');
update socle.utilisateur set code_methode = null, code_secret = null where email like '${LOCAL}+%@gmail.com';
SQL
grep -v '^cabinet :' "$T/comptes-cabinet.txt"
echo "cabinet : https://dev.skanfact.tn/v10/cabinet/?c=$(grep '^cabinet :' "$T/comptes-cabinet.txt" | sed 's|.*?c=||')"
rm -rf "$T"
echo FINI
