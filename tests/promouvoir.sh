#!/bin/bash
# Faire passer une version de `dev` à `main` (1.106.0 ; docs/mise-en-ligne.md, L). Le travail arrive sur `dev` ; `main`
# ne reçoit qu'une version que GitHub a vérifiée EN ENTIER : la vérification de l'envoi (tous les tests) ET toutes les
# preuves (la nuit, ou lancées sur elle à la demande). `main` n'est jamais réécrite : elle avance jusqu'à cette version.
#
#   bash tests/promouvoir.sh            la dernière version de `dev` passée par toutes les preuves
#   bash tests/promouvoir.sh <commit>   cette version-là (de `dev`)
#   ESSAI=1 bash tests/promouvoir.sh    dit ce qui se ferait, sans rien envoyer
#
# Code de sortie : 0 passée (ou déjà sur main) ; 1 refusée (la raison est dite) ; 2 GitHub ou git injoignable.
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$ICI" fetch -q origin dev main || { echo "git fetch impossible" >&2; exit 2; }

sha="$(python3 - "${1:-}" <<'EOF'
import json, subprocess, sys
def api(chemin):
    r = subprocess.run(['curl', '-sS', '--fail', '-H', 'Accept: application/vnd.github+json',
                        f'https://api.github.com/repos/saouthq/skanfact-plateforme/{chemin}'], capture_output=True, text=True)
    if r.returncode: print(f'GitHub ne répond pas : {r.stderr.strip()}', file=sys.stderr); sys.exit(2)
    return json.loads(r.stdout)
if sys.argv[1]:
    print(sys.argv[1]); sys.exit(0)
# La plus récente version de `dev` dont toutes les preuves ont passé (un passage lancé à la demande : celui de la nuit
# ne fait que les relancer sur `dev`).
for r in api('actions/workflows/preuves-completes.yml/runs?event=workflow_dispatch&status=completed&per_page=30')['workflow_runs']:
    if r['head_branch'] == 'dev' and r['conclusion'] == 'success':
        print(r['head_sha']); sys.exit(0)
print('Aucune version de dev n\'a encore passé toutes les preuves.', file=sys.stderr); sys.exit(1)
EOF
)"
c=$?; [ $c -eq 0 ] || exit $c
sha="$(git -C "$ICI" rev-parse --verify -q "$sha^{commit}")" || { echo "Version inconnue : ${1:-}" >&2; exit 1; }
court="$(git -C "$ICI" log -1 --format='%h %s' "$sha")"

# Elle vient de `dev`, et `main` avance jusqu'à elle sans rien perdre.
git -C "$ICI" merge-base --is-ancestor "$sha" origin/dev || { echo "Refusée : $court n'est pas sur dev." >&2; exit 1; }
if git -C "$ICI" merge-base --is-ancestor "$sha" origin/main; then echo "Déjà sur main : $court."; exit 0; fi
git -C "$ICI" merge-base --is-ancestor origin/main "$sha" || { echo "Refusée : main a des versions que $court n'a pas (main ne se réécrit jamais)." >&2; exit 1; }

# GitHub l'a vérifiée en entier : chaque vérification de cette version est finie et verte, dont les quatre moitiés des
# tests et les quatorze groupes de toutes les preuves.
python3 - "$sha" <<'EOF' || exit $?
import json, subprocess, sys
sha = sys.argv[1]
r = subprocess.run(['curl', '-sS', '--fail', '-H', 'Accept: application/vnd.github+json',
                    f'https://api.github.com/repos/saouthq/skanfact-plateforme/commits/{sha}/check-runs?per_page=100'], capture_output=True, text=True)
if r.returncode: print(f'GitHub ne répond pas : {r.stderr.strip()}', file=sys.stderr); sys.exit(2)
runs = json.loads(r.stdout).get('check_runs', [])
pas_vertes = [x['name'] for x in runs if x['conclusion'] not in ('success', 'skipped', 'neutral')]
tests = [x for x in runs if x['name'].startswith('Tests (') and x['conclusion'] == 'success']
preuves = [x for x in runs if x['name'].startswith('Toutes les preuves (groupe ') and x['conclusion'] == 'success']
manque = []
if pas_vertes: manque.append('pas vertes : ' + ', '.join(sorted(pas_vertes)))
if len(tests) < 4: manque.append(f'tests verts : {len(tests)} sur 4')
if len(preuves) < 14: manque.append(f'groupes de toutes les preuves verts : {len(preuves)} sur 14')
if manque: print('Refusée : ' + ' ; '.join(manque) + '.', file=sys.stderr); sys.exit(1)
EOF

if [ -n "${ESSAI:-}" ]; then echo "Passerait sur main : $court."; exit 0; fi
git -C "$ICI" push -q origin "$sha:refs/heads/main" || { echo "L'envoi vers main a échoué." >&2; exit 2; }
echo "Passée sur main : $court."
