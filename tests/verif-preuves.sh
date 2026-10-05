#!/bin/bash
# Le contrôle éclair des preuves : quelques secondes, sans base ni navigateur, rien n'est lancé.
# Pour chaque preuve de tests/preuves.sh :
#   - l'endroit où elle remet son défaut existe, et UNE fois (sinon elle ne pose rien, ou au hasard) ;
#   - dans une migration, ce qui le contient (fonction, vue, règle, déclencheur, contrainte, index)
#     n'est pas remplacé par une migration plus récente : la preuve viserait du code mort et le test
#     resterait vert (mes_entreprises le 28/09/2026, la liste des origines le 29/09/2026) ;
#   - le test qui doit tomber vit dans un fichier de tests/ (sinon toute la suite tourne pour elle) ;
#   - son nom est unique (tests/preuves-nouvelles.sh choisit les preuves par leur nom) ;
#   - posé dans un script des écrans (web/public), le défaut n'en casse pas la syntaxe : un écran
#     illisible fait tomber la page entière, et le test avec, quoi qu'il regarde ; depuis que la
#     construction lit chaque écran (web/alleger.ts), elle refuse le fichier et le test ne tourne même
#     plus (deux preuves le 05/10/2026). Ailleurs (serveur), un fichier illisible empêche le test de
#     tourner : sa preuve reste verte, ce qui se voit déjà.
# Et le bilan reste les deux dernières lignes du fichier : une preuve écrite après lui tourne, mais
# son échec ne fait pas échouer le lot (défaut trouvé le 30/09/2026, briques 66 à 70).
#
#   bash tests/verif-preuves.sh
#   DETAIL=1 bash tests/verif-preuves.sh     (et les défauts posés dans une migration hors définition)
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
liste="$(mktemp)"; syntaxe="$(mktemp)"
trap 'rm -f "$liste" "$syntaxe"' EXIT
(cd "$ICI" && bash tests/lister-preuves.sh tests/preuves.sh) > "$liste" || exit 2
# La syntaxe des écrans, lue comme le navigateur la lit (V8, sans rien exécuter) : une ligne JSON [nom, détail]
# par défaut qui la casse. Pour aller vite, seule la plus petite fonction qui contient le défaut est relue (une
# déclaration telle quelle, une expression entre parenthèses), si elle se lit seule avant lui ; sinon une plus
# grande, et au pire le fichier entier.
(cd "$ICI" && node --input-type=module - "$liste" > "$syntaxe" <<'EOF'
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSync } from 'rolldown/utils';
const brut = fs.readFileSync(process.argv[2], 'utf8').split('\0').slice(0, -1);
const lus = new Map();
const lire = (f) => { if (!lus.has(f)) lus.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null); return lus.get(f); };
const illisible = (code) => { try { new vm.Script(code); return null; } catch (e) { return e instanceof SyntaxError ? e.message : null; } };
const morceaux = new Map();
function morceauxDe(f) {
  if (!morceaux.has(f)) {
    const code = lire(f), liste = [];
    const visiter = (n) => {
      if (Array.isArray(n)) { for (const x of n) if (x) visiter(x); return; }
      if (n.type === 'FunctionDeclaration') liste.push([n.start, n.end, false]);
      else if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') liste.push([n.start, n.end, true]);
      for (const k in n) if (n[k] && typeof n[k] === 'object') visiter(n[k]);
    };
    const lu = parseSync(f, code);
    if (!lu.errors.length) visiter(lu.program);
    liste.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
    morceaux.set(f, [...liste, [0, code.length, false]]);
  }
  return morceaux.get(f);
}
const propres = new Map();
// Le message si le défaut (avant → après, posé une fois dans f) casse la syntaxe de f, sinon null.
function casse(f, avant, apres) {
  const code = lire(f), debut = code.indexOf(avant), fin = debut + avant.length;
  for (const [a, b, parentheses] of morceauxDe(f)) {
    if (a > debut || b < fin) continue;
    const juger = (t) => illisible(parentheses ? `(${t}\n)` : t);
    const cle = `${f} ${a} ${b}`;
    if (!propres.has(cle)) propres.set(cle, juger(code.slice(a, b)) === null);
    if (propres.get(cle)) return juger(code.slice(a, debut) + apres + code.slice(fin, b));
  }
  return null;   // un écran qui ne se lit pas déjà (un module, par exemple) n'est pas jugé ici
}
for (let i = 0; i + 5 <= brut.length; i += 5) {
  const [nom, fichier, avant, apres] = brut.slice(i, i + 4);
  const avants = avant.split('|||'), apress = apres.split('|||');
  const fichiers = fichier.split('|||').length === 1 ? avants.map(() => fichier) : fichier.split('|||');
  // Un motif absent ou en double, une retouche dépareillée : dits plus bas, la preuve n'est pas lue ici.
  if (fichiers.length !== avants.length || avants.length !== apress.length) continue;
  const copies = new Map();
  const posees = avants.every((a, k) => {
    const s = copies.has(fichiers[k]) ? copies.get(fichiers[k]) : lire(fichiers[k]);
    if (s == null || !a || s.split(a).length !== 2) return false;
    copies.set(fichiers[k], s.replace(a, () => apress[k]));
    return true;
  });
  if (!posees) continue;
  for (const [f, copie] of copies) {
    if (!/^web\/public\/.*\.js$/.test(f)) continue;
    const k = fichiers.indexOf(f);
    // Retouché plusieurs fois par la même preuve : le fichier entier.
    const e = fichiers.lastIndexOf(f) === k ? casse(f, avants[k], apress[k]) : illisible(lire(f)) === null && illisible(copie);
    if (e) console.log(JSON.stringify([nom, `${f} : ${e}`]));
  }
}
EOF
) || exit 2
python3 - "$ICI" "$liste" "$syntaxe" ${DETAIL:+detail} <<'EOF'
import json, pathlib, re, sys
from collections import Counter

racine = pathlib.Path(sys.argv[1])
brut = open(sys.argv[2], 'rb').read().split(b'\0')[:-1]
preuves = [tuple(x.decode('utf-8') for x in brut[i:i + 5]) for i in range(0, len(brut), 5)]
fautes = []
def faute(genre, nom, detail): fautes.append(f'{genre:<22} {nom} → {detail}')
def court(t): t = ' '.join(t.split()); return t if len(t) <= 90 else t[:87] + '…'

for ligne in open(sys.argv[3], encoding='utf-8').read().splitlines():
    nom, detail = json.loads(ligne)
    faute('SYNTAXE CASSÉE', nom, f'{detail} (le défaut ne prouverait rien : la page entière tombe)')

# Le bilan, à la fin.
lignes = [l for l in (racine / 'tests/preuves.sh').read_text(encoding='utf-8').splitlines() if l.strip()]
if lignes[-2:] != ['echo; echo "$ok preuves faites, $ko non prouvées${PARTIE:+ (groupe $PARTIE)}."', '[ "$ko" -eq 0 ]']:
    fautes.append('BILAN PAS À LA FIN     tests/preuves.sh : ses deux dernières lignes doivent être le bilan')

for nom, n in Counter(p[0] for p in preuves).items():
    if n > 1: faute('NOM EN DOUBLE', nom, f'{n} preuves')

# Le test qui doit tomber : cherché comme preuves.sh le cherche (sous tests/, apostrophes échappées ou non).
tests = '\n'.join(f.read_text(encoding='utf-8') for f in sorted((racine / 'tests').rglob('*.test.ts')))
trouve = {}
for nom, _, _, _, attendu in preuves:
    if attendu not in trouve: trouve[attendu] = attendu in tests or attendu.replace("'", "\\'") in tests
    if not trouve[attendu]: faute('TEST INTROUVABLE', nom, f'« {court(attendu)} »')

# ── Les migrations : leurs instructions, et ce que chacune définit ──
MIGRATIONS = sorted((racine / 'base/migrations').glob('*.sql'))
DOLLAR = re.compile(r'\$(?:[A-Za-z_]\w*)?\$')

def instructions(sql):
    """(début, fin) de chaque instruction : un « ; » hors chaîne, commentaire et corps entre dollars."""
    spans, i, debut, n = [], 0, 0, len(sql)
    while i < n:
        if sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j < 0 else j + 1; continue
        if sql.startswith('/*', i):
            j = sql.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        c = sql[i]
        if c == "'":
            j = i + 1
            while True:
                j = sql.find("'", j)
                if j < 0 or not sql.startswith("''", j): break
                j += 2
            i = n if j < 0 else j + 1; continue
        if c == '$':
            m = DOLLAR.match(sql, i)
            if m:
                j = sql.find(m.group(0), m.end()); i = n if j < 0 else j + len(m.group(0)); continue
        if c == ';':
            spans.append((debut, i + 1)); debut = i + 1
        i += 1
    if sql[debut:].strip(): spans.append((debut, n))
    return spans

def sans_commentaires(sql):
    return re.sub(r'--[^\n]*', '', re.sub(r'/\*.*?\*/', '', sql, flags=re.S))

def debut_utile(t):
    """Le décalage du premier mot de l'instruction (après blancs et commentaires)."""
    k = 0
    while True:
        m = re.match(r'\s+|--[^\n]*|/\*.*?\*/', t[k:], re.S)
        if not m or not m.group(0): return k
        k += m.end()

def morceaux(t, i):
    """Les éléments séparés par des virgules au premier niveau de la parenthèse ouverte en t[i]."""
    out, prof, debut, j = [], 0, i + 1, i
    while j < len(t):
        c = t[j]
        if t.startswith('--', j):
            j = t.find('\n', j)
            if j < 0: break
        elif c == "'":
            j = t.find("'", j + 1)
            if j < 0: break
        elif c == '(': prof += 1
        elif c == ')':
            prof -= 1
            if prof == 0: out.append((debut, j)); return out
        elif c == ',' and prof == 1: out.append((debut, j)); debut = j + 1
        j += 1
    return out

def types_de(params):
    """La liste des types d'une liste de paramètres (les noms et valeurs par défaut retirés)."""
    out = []
    for d, f in morceaux('(' + params + ')', 0):
        p = re.split(r'\s+default\s|\s*=', ('(' + params + ')')[d:f].strip(), maxsplit=1, flags=re.I)[0].split()
        if p and p[0].lower() in ('in', 'out', 'inout', 'variadic'): p = p[1:]
        if len(p) >= 2 and p[0].lower() not in ('double', 'timestamp', 'time', 'character', 'bit', 'interval'): p = p[1:]
        out.append(' '.join(p).lower())
    return tuple(out)

def parametres(t, i):
    """Le texte entre la parenthèse ouverte en t[i] et celle qui la ferme."""
    m = morceaux(t, i)
    return t[i + 1:m[-1][1]] if m else ''

def objets(sql, pos, fin):
    """Ce que définit l'instruction où commence le défaut (de pos à fin) : [(genre, nom, table ou signature)]."""
    for d, f in instructions(sql):
        if d <= pos < f: break
    else:
        return []
    t = sql[d:f]
    k = debut_utile(t)
    x = re.compile
    m = x(r'create\s+(?:or\s+replace\s+)?(function|procedure)\s+([\w.]+)\s*\(', re.I).match(t, k)
    if m: return [('fonction', m.group(2).lower(), types_de(parametres(t, m.end() - 1)))]
    m = x(r'create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+([\w.]+)', re.I).match(t, k)
    if m: return [('vue', m.group(1).lower(), None)]
    m = x(r'create\s+policy\s+(\w+)\s+on\s+([\w.]+)', re.I).match(t, k)
    if m: return [('règle', m.group(1).lower(), m.group(2).lower())]
    m = x(r'create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(\w+)[\s\S]*?\son\s+([\w.]+)', re.I).match(t, k)
    if m: return [('déclencheur', m.group(1).lower(), m.group(2).lower())]
    m = x(r'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(\w+)', re.I).match(t, k)
    if m: return [('index', m.group(1).lower(), None)]
    m = x(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.]+)', re.I).match(t, k)
    if m:
        table, avant = m.group(1).lower(), [c for c in re.finditer(r'add\s+constraint\s+(\w+)', t, re.I) if c.start() < fin - d]
        return [('contrainte', avant[-1].group(1).lower(), table)] if avant else []
    m = x(r'create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)\s*\(', re.I).match(t, k)
    if m:
        table = m.group(1).lower(); court_ = table.split('.')[-1]
        for a, b in morceaux(t, m.end() - 1):
            if a <= pos - d < b:
                e = t[a:b]; e = e[debut_utile(e):]
                c = re.match(r'constraint\s+(\w+)', e, re.I)
                if c: return [('contrainte', c.group(1).lower(), table)]
                c = re.match(r'(\w+)\s', e)
                if c and c.group(1).lower() not in ('primary', 'unique', 'check', 'foreign', 'exclude'):
                    col = c.group(1).lower()
                    return [('contrainte', f'{court_}_{col}_{s}', table) for s in ('check', 'key', 'fkey')]
                return [('contrainte', n, table) for n in (f'{court_}_check', f'{court_}_pkey')]
    return []

def remplacee(genre, nom, extra, apres):
    """La première migration plus récente qui remplace ou retire cet objet, sinon None."""
    e = re.escape(nom)
    for f in apres:
        s = sans_commentaires(f.read_text(encoding='utf-8'))
        if genre == 'fonction':
            if re.search(rf'drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?{e}\b', s, re.I): return f
            for m in re.finditer(rf'create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+{e}\s*\(', s, re.I):
                if types_de(parametres(s, m.end() - 1)) == extra: return f
        elif genre == 'vue':
            if re.search(rf'(?:create\s+or\s+replace\s+|drop\s+)(?:materialized\s+)?view\s+(?:if\s+exists\s+)?{e}\b', s, re.I): return f
        elif genre == 'règle':
            if re.search(rf'(?:drop|alter)\s+policy\s+(?:if\s+exists\s+)?{e}\s+on\s+{re.escape(extra)}\b', s, re.I): return f
        elif genre == 'déclencheur':
            if re.search(rf'(?:drop\s+trigger\s+(?:if\s+exists\s+)?|create\s+or\s+replace\s+(?:constraint\s+)?trigger\s+){e}\b', s, re.I): return f
        elif genre == 'index':
            if re.search(rf'drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:\w+\.)?{e}\b', s, re.I): return f
        elif genre == 'contrainte':
            for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.]+)([^;]*)', s, re.I):
                if m.group(1).lower() == extra and re.search(rf'drop\s+constraint\s+(?:if\s+exists\s+)?{e}\b', m.group(2), re.I): return f
    return None

contenus = {}
def lire(f):
    if f not in contenus:
        p = racine / f
        contenus[f] = p.read_text(encoding='utf-8') if p.is_file() else None
    return contenus[f]

deja = {}
en_migration = situes = 0
for nom, fichier, avant, apres_, attendu in preuves:
    fs, avs, aps = fichier.split('|||'), avant.split('|||'), apres_.split('|||')
    if len(fs) == 1: fs = fs * len(avs)
    if not (len(fs) == len(avs) == len(aps)):
        faute('RETOUCHES DÉPAREILLÉES', nom, f'{len(fs)} fichiers, {len(avs)} avants, {len(aps)} après'); continue
    copies = {}
    for f, a, b in zip(fs, avs, aps):
        s = copies.get(f, lire(f))
        if s is None: faute('FICHIER INTROUVABLE', nom, f); break
        n = s.count(a) if a else 0
        if n != 1:
            faute('MOTIF INTROUVABLE' if n == 0 else 'MOTIF EN DOUBLE', nom, f'{f} : « {court(a)} »' + (f' ({n} fois)' if n > 1 else '')); break
        copies[f] = s.replace(a, b)
        origine = lire(f)
        if re.fullmatch(r'base/migrations/\d{4}_[\w-]+\.sql', f) and origine.count(a) == 1:
            # Le premier mot du défaut (sans les blancs, virgules et commentaires qui le précèdent).
            pos = origine.index(a) + re.match(r'(?:[\s,]+|--[^\n]*)*', a).end()
            apres = [m for m in MIGRATIONS if m.name > pathlib.Path(f).name]
            trouves = objets(origine, pos, origine.index(a) + len(a))
            en_migration += 1; situes += bool(trouves)
            if not trouves and len(sys.argv) > 4: print(f'hors définition       {nom} → {f} : « {court(a)} »')
            for genre, objet, extra in trouves:
                cle = (f, genre, objet, extra)
                if cle not in deja: deja[cle] = remplacee(genre, objet, extra, apres)
                if deja[cle]:
                    faute('DÉFINITION REMPLACÉE', nom, f'{genre} {objet} de {pathlib.Path(f).name}, remplacée par {deja[cle].name} : viser la définition en vigueur')
                    break

for l in fautes: print(l)
# Mesuré, pas supposé : combien de défauts posés dans une migration ont été situés dans une définition.
print(f'\n{len(preuves)} preuves lues ; {situes} de leurs {en_migration} défauts posés dans une migration situés dans ce qui les '
      'définit (le reste : hors fonction, règle, contrainte…) ; ' + (f'{len(fautes)} à reprendre.' if fautes else 'rien à reprendre.'))
sys.exit(1 if fautes else 0)
EOF
