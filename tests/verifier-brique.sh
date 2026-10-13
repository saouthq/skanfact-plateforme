#!/bin/bash
# La vérification d'une brique PENDANT le travail (décision de Skander, 30/09/2026 : avancer et livrer
# plus par jour). Ciblée : les types, le lint, le contrôle éclair des preuves, les tests des fichiers
# de test changés depuis BASE (et de ceux qui importent directement un fichier changé, s'ils sont
# peu nombreux), ceux qu'on donne en plus, puis les preuves nouvelles ou changées. Tout le reste —
# tous les tests, toutes les preuves — tourne sur GitHub à chaque envoi ; on lit son verdict
# (tests/verdict-github.sh) avant l'envoi suivant, et une construction rouge se répare d'abord.
#
#   PG_ADMIN=postgres://… npm run verifier:brique [-- tests/autre.test.ts …]
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN:?PG_ADMIN manque (adresse d'un compte d'administration PostgreSQL)}"
BASE="${BASE:-origin/main}"
cd "$ICI" || exit 2
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "BASE=$BASE introuvable (git fetch origin main ?)" >&2; exit 2; }
etape() { echo; echo "── $1"; }

etape "Types"; npm run -s types || exit 1
etape "Lint"; npm run -s lint || exit 1
etape "Contrôle éclair des preuves"; bash tests/verif-preuves.sh || exit 1

changes="$( { git diff --name-only "$BASE" --; git ls-files --others --exclude-standard; } | sort -u)"

# Le numéro de version (package.json, « 1.4.2 ») est celui que la console montre pour chaque version en service : un
# envoi qui change autre chose que la documentation le relève (correctif 1.0.x, fonction 1.x.0, rupture x.0.0). Sans
# lui, deux versions différentes porteraient le même nom (docs/mise-en-ligne.md B7).
etape "Numéro de version"
num() { node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version??""))}catch{}})'; }
avant="$(git show "$BASE:package.json" 2>/dev/null | num)"; apres="$(num <package.json)"
if [ -n "$changes" ] && grep -qvE '^docs/|\.md$' <<<"$changes" && [ "$avant" = "$apres" ]; then
  echo "le numéro de version n'a pas bougé depuis $BASE (package.json : ${apres:-aucun}) : relève-le (correctif x.y.Z, fonction x.Y.0)" >&2; exit 1
fi
echo "${avant:-aucun} → $apres"
etape "Tests ciblés (changés depuis $BASE)"
choisis="$(
  while read -r f; do
    [ -f "$f" ] || continue
    if [[ "$f" =~ ^(tests|moteur)/.*\.test\.ts$ ]]; then echo "$f"; continue; fi
    # Deux gardes qu'aucun import ne désigne. Une migration : l'export range CHAQUE table de la base (CLASSEMENT,
    # base/entreprise.ts), et son test n'importe aucune migration. Un écran de la console : l'instrument de rendu la
    # parcourt en entier, au doigt et à la souris. Les deux sont tombés sur GitHub pour la Console 3 (six tables du
    # service non rangées, des filtres de 32 points au téléphone) : ce tri ne les donnait pas.
    if [[ "$f" =~ ^base/migrations/.*\.sql$ ]]; then echo tests/socle/export-entreprise.test.ts; continue; fi
    if [[ "$f" =~ ^web/console/src/ ]]; then echo tests/web/console.test.ts; continue; fi
    # Les tests qui importent directement un fichier changé — sauf un fichier que plus de trois
    # fichiers de test importent (les routes, par exemple) : ceux-là, GitHub les rejoue.
    if [[ "$f" =~ ^(serveur|moteur|commun|textes|base)/.*\.ts$ ]]; then
      importeurs="$(grep -rlF --include='*.test.ts' -- "$f" tests moteur)"
      [ -n "$importeurs" ] && [ "$(grep -c . <<<"$importeurs")" -le 3 ] && echo "$importeurs"
    fi
  done <<<"$changes" | sort -u
)"
mapfile -t fichiers < <(grep . <<<"$choisis")
fichiers+=("$@")
if [ ${#fichiers[@]} -eq 0 ]; then echo "aucun test changé"
else printf '  %s\n' "${fichiers[@]}"; npx vitest run "${fichiers[@]}" || exit 1; fi

etape "Preuves nouvelles ou changées"; bash tests/preuves-nouvelles.sh || exit 1
echo; echo "Brique vérifiée ici. Le reste se vérifie sur GitHub : lire son verdict avant l'envoi suivant."
