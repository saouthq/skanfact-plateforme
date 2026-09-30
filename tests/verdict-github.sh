#!/bin/bash
# Le verdict de GitHub sur un envoi (par défaut : origin/main, le dernier envoyé) : chaque vérification
# et, pour celles qui échouent, ce qu'elles disent (le test qui tombe, la preuve non prouvée). Le dépôt
# est public : aucune clé n'est nécessaire.
#
#   bash tests/verdict-github.sh [commit]
# Code de sortie : 0 tout est vert ; 1 quelque chose est rouge ; 3 pas encore fini.
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
sha="$(git -C "$ICI" rev-parse "${1:-origin/main}")" || exit 2
python3 - "$sha" <<'EOF'
import json, subprocess, sys
sha = sys.argv[1]
def api(chemin):
    r = subprocess.run(['curl', '-sS', '--fail', '-H', 'Accept: application/vnd.github+json',
                        f'https://api.github.com/repos/saouthq/skanfact-plateforme/{chemin}'], capture_output=True, text=True)
    if r.returncode: sys.exit(f'GitHub ne répond pas : {r.stderr.strip()}')
    return json.loads(r.stdout)
runs = sorted(api(f'commits/{sha}/check-runs?per_page=50').get('check_runs', []), key=lambda r: r['name'])
print(f'Commit {sha[:7]} :')
MOTS = {'success': 'vert', 'failure': 'ROUGE', 'cancelled': 'annulé', 'timed_out': 'trop long',
        'in_progress': 'en cours', 'queued': 'en attente', 'skipped': 'sauté', 'neutral': 'neutre'}
rouge = attente = False
for r in runs:
    etat = r['conclusion'] or r['status']
    print(f"  {MOTS.get(etat, etat):<10} {r['name']}")
    if r['conclusion'] is None: attente = True
    elif r['conclusion'] not in ('success', 'skipped', 'neutral'):
        rouge = True
        for a in api(f"check-runs/{r['id']}/annotations?per_page=50"):
            if a.get('annotation_level') == 'failure':
                print('    ·', ' '.join(((a.get('title') or '') + ' — ' + (a.get('message') or '')).split())[:500])
if rouge: print('ROUGE : à réparer avant tout nouvel envoi.'); sys.exit(1)
if attente or not runs: print('Pas encore fini.' if runs else 'Pas encore commencé.'); sys.exit(3)
print('Tout est vert.')
EOF
