#!/bin/bash
# Ouvre la plateforme sur un ÉCRAN VIRTUEL, comme un humain l'ouvrirait dans son navigateur, pour la tester à la souris
# et au clavier avec scripts/humain/ecran.sh (les actions de Computer Use : vrais clics, vraies frappes, vraies captures).
#
#   scripts/humain/lancer.sh            # base neuve, serveur, navigateur ouvert sur la page de connexion
#   scripts/humain/lancer.sh --garder   # garde la base et le profil du navigateur de la fois précédente
#
# Pourquoi (01/10/2026, demandé par Skander : « comme un vrai humain, et voir l'écran comme un vrai humain ») : les tests
# d'écran (tests/web) cliquent sur des SÉLECTEURS ; un humain clique sur des PIXELS. Un bouton recouvert, collé à un
# autre, ou un texte illisible ne se voit qu'à l'écran.
set -euo pipefail
RACINE=$(cd "$(dirname "$0")/../.." && pwd)
TRAVAIL=/tmp/skanfact-humain-plateforme
PORT=${SKANFACT_HUMAIN_PORT:-8090}
# La langue du navigateur : le français d'un commerçant tunisien, ou une autre pour voir ce qu'elle change (en-US : les
# nombres et les dates des champs du navigateur s'y écrivent à l'américaine).
LANGUE=${SKANFACT_LANGUE:-fr-FR}
export DISPLAY=${SKANFACT_ECRAN:-:99}
[ -n "${PG_ADMIN:-}" ] || { echo "PG_ADMIN manque : l adresse d un compte d administration PostgreSQL" >&2; exit 2; }
mkdir -p "$TRAVAIL"
GARDER=${1:-}

# L'écran virtuel : 1440×900 et un gestionnaire de fenêtres (sans lui, le clavier tombe dans le vide).
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp >"$TRAVAIL/xvfb.log" 2>&1 &
  for _ in $(seq 1 50); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done
  (openbox >"$TRAVAIL/openbox.log" 2>&1 &) || true
fi

# Ce qui tournait la fois d'avant s'arrête.
for f in serveur navigateur; do
  if [ -f "$TRAVAIL/$f.pid" ] && kill -0 "$(cat "$TRAVAIL/$f.pid")" 2>/dev/null; then kill "$(cat "$TRAVAIL/$f.pid")" 2>/dev/null || true; fi
done
sleep 1

# La base, et les écrans construits comme en production.
if [ "$GARDER" != "--garder" ] || [ ! -f "$TRAVAIL/base.url" ]; then
  node "$RACINE/scripts/humain/base.ts" "$TRAVAIL/base.url"
  rm -rf "$TRAVAIL/profil"
fi
(cd "$RACINE" && npx vite build --config web/vite.config.ts --outDir "$TRAVAIL/web" --emptyOutDir --logLevel error)

SKANFACT_BASE=$(cat "$TRAVAIL/base.url") SKANFACT_ENVIRONNEMENT=test SKANFACT_PORT=$PORT SKANFACT_WEB="$TRAVAIL/web" \
  nohup node "$RACINE/serveur/principal.ts" >"$TRAVAIL/serveur.log" 2>&1 &
echo $! > "$TRAVAIL/serveur.pid"
for _ in $(seq 1 100); do curl -s "http://127.0.0.1:$PORT/v1/documentation" >/dev/null 2>&1 && break; sleep 0.2; done
curl -s "http://127.0.0.1:$PORT/v1/documentation" >/dev/null || { echo "Le serveur ne répond pas. Journal : $TRAVAIL/serveur.log" >&2; exit 1; }

# Le navigateur, en vraie fenêtre sur l'écran virtuel, plein écran comme sur un portable.
NAV=${SKANFACT_NAVIGATEUR:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}
nohup "$NAV" --no-sandbox --no-first-run --no-default-browser-check --disable-features=Translate --lang="$LANGUE" \
  --user-data-dir="$TRAVAIL/profil" --window-position=0,0 --window-size=1440,900 --remote-debugging-port=9224 \
  "http://127.0.0.1:$PORT/" >"$TRAVAIL/navigateur.log" 2>&1 &
echo $! > "$TRAVAIL/navigateur.pid"
sleep 3
cat <<INFO
SkanFact (plateforme) ouverte sur l'écran $DISPLAY (1440×900) : http://127.0.0.1:$PORT/
  regarder / agir : scripts/humain/ecran.sh capture | clic X Y | taper "texte" | touche Return …
  un exemple      : node scripts/humain/exemple-caisse.ts http://127.0.0.1:$PORT   (les comptes : $TRAVAIL/comptes.txt)
INFO
