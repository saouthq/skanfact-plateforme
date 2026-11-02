#!/usr/bin/env python3
"""Reprend la feuille de style de la maquette de la paie (docs/maquettes/paie.html) pour l'application.

Demande de Skander (02/11/2026) : « reprends les écrans de la maquette et adapte-les : elle est soignée ». Tout est préfixé
`.pm` (la page Paie de l'application), pour que rien ne déborde sur le reste ; ce qui n'existe que pour présenter la maquette
(le cadre de l'ordinateur et du téléphone, les boutons « État » et « Ouvrir », la barre de navigation, la page « Rien de
perdu ») ne se reprend pas. Usage : python3 scripts/maquette/paie-css.py > web/public/plateforme/paie-maquette.css
"""
import re, sys

SRC = 'docs/maquettes/paie.html'
html = open(SRC, encoding='utf-8').read()
css = html[html.index('<style>') + 7: html.index('</style>')]
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

# Les classes de la présentation de la maquette, jamais reprises.
CADRE = {'page', 'tete', 'tete-txt', 'surtitre', 'reglages', 'reg-l', 'scene', 'ordi-boite', 'ordi', 'barre', 'marque',
         'marque-s', 'creer', 'lien', 'tel-boite', 'ecran', 'rdp', 'rdp-t', 'chemin', 'sec', 'tete-barre', 'cadre-tel',
         'barre-bas', 'tel-haut', 'tel-ecran'}

def regles(t):
    """Découpe un bloc CSS en (entête, corps) au premier niveau."""
    out, i, n = [], 0, len(t)
    while i < n:
        j = t.find('{', i)
        if j < 0: break
        tete = t[i:j].strip()
        d, k = 1, j + 1
        while k < n and d:
            if t[k] == '{': d += 1
            elif t[k] == '}': d -= 1
            k += 1
        out.append((tete, t[j + 1:k - 1]))
        i = k
    return out

def virgules(s):
    parts, d, cur = [], 0, ''
    for c in s:
        if c in '([': d += 1
        elif c in ')]': d -= 1
        if c == ',' and d == 0: parts.append(cur); cur = ''
        else: cur += c
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]

def premiere_classe(sel):
    m = re.match(r'^\.([a-zA-Z0-9_-]+)', sel)
    return m.group(1) if m else None

# Les couleurs de la maquette sont celles de la charte (`--sb-*`, barre.css) : on les relie, pour que le thème sombre de
# l'application (`body.dark`) suive sans rien recopier. Ce que la charte n'a pas garde la valeur de la maquette.
CHARTE = {'papier': 'sb-papier', 'papier-2': 'sb-papier-2', 'barre-fond': 'sb-barre', 'survol': 'sb-survol',
          'actif-fond': 'sb-actif', 'actif-ombre': 'sb-actif-ombre', 'encre': 'sb-encre', 'gris': 'sb-gris',
          'gris-2': 'sb-gris-2', 'trait': 'sb-trait', 'trait-fort': 'sb-trait-fort', 'sarcelle': 'sb-sarcelle',
          'sarcelle-f': 'sb-sarcelle-f', 'sarcelle-texte': 'sb-sarcelle-texte', 'doux': 'sb-doux', 'doux-texte': 'sb-doux-texte',
          'ambre-doux': 'sb-ambre-doux', 'ambre-texte': 'sb-ambre-texte', 'ambre': 'sb-ambre', 'rouge-doux': 'sb-rouge-doux',
          'rouge-texte': 'sb-rouge-texte', 'rouge': 'sb-rouge', 'orange': 'sb-orange', 'ombre': 'sb-ombre',
          'ombre-pop': 'sb-ombre-pop', 'voile': 'sb-voile', 'police': 'sb-police'}

def jetons(corps):
    """Les jetons de couleur d'un bloc :root, reliés à la charte quand elle les a."""
    out = []
    for decl in corps.split(';'):
        if ':' not in decl: continue
        k, v = decl.split(':', 1); k = k.strip(); v = ' '.join(v.split())
        if k.startswith('--') and k[2:] in CHARTE: v = f'var(--{CHARTE[k[2:]]})'
        out.append(f'{k}: {v}')
    return '; '.join(out) + ';'

def portee(sel):
    if sel.startswith(':root'):
        reste = sel[5:]
        if reste.startswith('[data-theme="dark"]'): return ':root[data-theme="dark"] .pm' + reste[len('[data-theme="dark"]'):]
        if reste.startswith(':not([data-theme="light"])'): return ':root:not([data-theme="light"]) .pm' + reste[len(':not([data-theme="light"])'):]
        return '.pm' + reste
    if sel in ('body', 'html'): return '.pm'
    if sel == 'h1': return None
    c = premiere_classe(sel)
    if c in CADRE: return None
    if sel.startswith('#'): return None   # les identifiants de la maquette (#etats, #montrer, #ordi…)
    return '.pm ' + sel

def traiter(t, dedans_media=False):
    out = []
    for tete, corps in regles(t):
        if tete.startswith('@keyframes'):
            out.append(f'{tete} {{{corps}}}'); continue
        if tete.startswith('@media') or tete.startswith('@supports'):
            inner = traiter(corps, True)
            # Le sombre de l'application est `body.dark`, pas le réglage du système : sa règle se pose sans la condition.
            if 'prefers-color-scheme' in tete: out.append(inner)
            elif inner.strip(): out.append(f'{tete} {{\n{inner}\n}}')
            continue
        brut = virgules(tete)
        if brut and brut[0].startswith(':root'):
            # Le thème sombre de la maquette : la charte le porte déjà (`body.dark`) ; seul ce qu'elle n'a pas se reprend.
            if '[data-theme' in brut[0] or dedans_media:
                reste = [d for d in corps.split(';') if ':' in d and d.split(':', 1)[0].strip()[2:] not in CHARTE and 'color-scheme' not in d]
                if reste: out.append(f'body.dark .pm {{ {"; ".join(" ".join(d.split()) for d in reste)}; }}')
                continue
            out.append(f'.pm {{ {jetons(corps)} }}'); continue
        if brut in (['body'], ['html'], ['html', 'body'], ['body', 'html']):
            # La page Paie vit dans la page de l'application : elle ne repeint pas son fond, ne touche pas ses marges.
            corps = ';'.join(d for d in corps.split(';') if d.split(':', 1)[0].strip() not in ('background', 'margin', 'min-height', 'height', 'overflow'))
        # Les champs et boutons de l'application gardent leur police et leur couleur (la maquette les remettait à celles
        # de la page : les onglets et la bande des mois grossissaient).
        if all(x in ('button', 'input', 'select', 'textarea') for x in brut): continue
        sels = [portee(s) for s in brut]
        sels = [s for s in sels if s]
        if not sels: continue
        out.append(f'{", ".join(sels)} {{ {" ".join(corps.split())} }}')
    return '\n'.join(out)

print('/* Repris de docs/maquettes/paie.html par scripts/maquette/paie-css.py (1.256.0). Ne pas retoucher à la main :\n'
      '   corriger la maquette ou le script, puis régénérer. */')
print('.pm { font-family: var(--police); color: var(--encre); }')
print(traiter(css))
# Ce que l'application ajoute à la maquette : ses propres boutons (btn-primary, btn-sm) prennent l'allure de ceux de la
# maquette (prem, mini), et le corps de la page range ses cartes comme `.corps-l` (une colonne, 14 px entre deux).
print(open('scripts/maquette/paie-adapte.css', encoding='utf-8').read())
