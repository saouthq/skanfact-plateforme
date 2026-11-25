// 1.388.65 (#27) — l'interface : le contraste du bouton principal, Ctrl K qui met le geste en tête, Tab qui reste dans la
// fenêtre, le pluriel des devis, le compte des lignes, l'Aide sans l'écran à venir, et les visites guidées qui visent
// ce qui existe. (Les largeurs — tablette 768 et téléphone — sont mesurées dans tests/web/iface-1388-65.test.ts.)
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(racine, f), 'utf8');
// Le CODE seul : un commentaire qui cite la règle ne doit pas la satisfaire.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
const APP1 = code(lire('modules/socle/ecrans/entreprise/app-1.js'));
const APP2 = code(lire('modules/socle/ecrans/entreprise/app-2.js'));
const CHARTE = code(lire('web/public/plateforme/charte.css'));
const BARRE = lire('web/public/plateforme/barre.css');
const VISITES = code(lire('modules/socle/visites/visites.js'));

// La formule WCAG du rapport de contraste.
const lum = (hex: string) => {
  const [r = 0, g = 0, b = 0] = (hex.replace('#', '').match(/../g) ?? []).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
const jeton = (nom: string, sombre: boolean) => {
  const bloc = BARRE.split('\n').filter(l => l.includes(`--${nom}:`))[sombre ? 1 : 0] ?? '';
  return new RegExp(`--${nom}: (#[0-9a-f]{6})`).exec(bloc)?.[1] ?? '';
};
const regle = (css: string, sel: RegExp) => css.split('\n').find(l => sel.test(l)) ?? '';

describe('IFACE-5 : le bouton principal se lit (4,5 : 1 au moins)', () => {
  it('en clair : du blanc sur le fond du bouton', () => {
    const fond = /background: var\(--([a-z-]+)\)/.exec(regle(CHARTE, /^\.btn-primary \{/))?.[1] ?? '';
    expect(fond).not.toBe('');
    expect(contraste('#ffffff', jeton(fond, false))).toBeGreaterThanOrEqual(4.5);
  });
  it('en sombre : le texte du bouton sur son fond', () => {
    const l = regle(CHARTE, /^body\.dark \.btn-primary, body\.dark \.btn-primary:hover \{/);
    const fond = /background: var\(--([a-z-]+)\)/.exec(l)?.[1] ?? '';
    const texte = jeton(/color: var\(--([a-z-]+)\)/.exec(l)?.[1] ?? '', true);
    expect(fond).not.toBe('');
    expect(contraste(texte, jeton(fond, true))).toBeGreaterThanOrEqual(4.5);
  });
  it('« Créer » de la barre suit la même règle, dans les deux thèmes', () => {
    const clair = /background: var\(--([a-z-]+)\)/.exec(regle(BARRE, /^#barre \.btn-creer \{/))?.[1] ?? '';
    expect(contraste('#ffffff', jeton(clair, false))).toBeGreaterThanOrEqual(4.5);
    const l = regle(BARRE, /^body\.dark #barre \.btn-creer \{/);
    const fond = /background: var\(--([a-z-]+)\)/.exec(l)?.[1] ?? '';
    expect(contraste(jeton(/color: var\(--([a-z-]+)\)/.exec(l)?.[1] ?? '', true), jeton(fond, true))).toBeGreaterThanOrEqual(4.5);
  });
  it('le mois en retard du Cabinet a sa couleur de thème sombre', () => {
        expect(lire('web/public/plateforme/dossiers.css')).toContain('body.dark .cd-page .ms-mo.tard { color: var(--sb-rouge-texte); }');
    expect(contraste(jeton('sb-rouge-texte', true), '#0f1619')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('IFACE-6 : Ctrl K met le meilleur groupe en tête et ne répète pas un geste', () => {
  it('l\'ordre des groupes suit les résultats quand on cherche', () => {
    expect(APP1).toMatch(/const ordre = q \? \[\.\.\.new Set\(shown\.map\(groupeDe\)\)\] : GROUPES;/);
    expect(APP1).toMatch(/ordre\.indexOf\(groupeDe\(a\[0\]\)\) - ordre\.indexOf\(groupeDe\(b\[0\]\)\)/);
  });
  it('un geste au même libellé n\'apparaît qu\'une fois', () => {
    expect(APP1).toMatch(/if \(q\) \{ const vus = new Set\(\); shown = shown\.filter\(/);
  });
});

describe('IFACE-7 : au clavier, la fenêtre garde le curseur', () => {
  it('Tab tourne dans la fenêtre du dessus', () => {
    expect(APP1).toMatch(/layer\.addEventListener\('keydown', e => \{\s*if \(e\.key !== 'Tab' \|\| root\.lastElementChild !== layer\) return;/);
    expect(APP1).toMatch(/dernier\.focus\(\)/);
    expect(APP1).toMatch(/premier\.focus\(\)/);
  });
  it('« Abandonner cette saisie ? » pose le curseur sur le choix qui ne jette rien', () => {
    expect(APP1).toMatch(/confirmDialog\('Abandonner cette saisie \?\\n' \+ perte, 'Abandonner la saisie', true, \{ prudent: true \}\)/);
  });
  it('après une fenêtre ouverte par Ctrl K, le curseur revient sur la page (son titre)', () => {
    expect(APP1).toMatch(/document\.querySelector\('#view h1'\)/);
  });
});

describe('IFACE-8, 9, 10', () => {
  it('la barre de pages des devis écrit « devis » au pluriel', () => {
    expect(APP1).not.toMatch(/pagerBar\([^)]*noun: 'devis'(?![^)]*pluriel)/);
  });
  it('le compte des lignes suit la désignation tapée', () => {
    expect(APP1).toMatch(/if \(el\.dataset\.k === 'label'\) queueMicrotask\(/);
  });
  it('l\'Aide et Ctrl K laissent de côté l\'article d\'un écran à venir', () => {
    expect(APP1).toMatch(/const ouverts = G\.ARTICLES\.filter\(x => !aVenir\(x\.id\)\)/);
    expect(APP2).toMatch(/const arts = G\.ARTICLES\.filter\(x => !aVenir\(x\.id\)\)/);
  });
  it('la bulle des filtres nomme « Tout effacer », le bouton qui est à l\'écran', () => {
    const g = lire('modules/socle/aide/guide.js');
    const i = g.indexOf("'list.filters'");
    expect(i).toBeGreaterThan(0);
    const t = g.slice(i, i + 900);
    expect(t).toContain('Tout effacer');
    expect(t).not.toContain('Réinitialiser les filtres');
  });
});

describe('IFACE-11 : la grande visite vise ce qui existe', () => {
  const etape = (titre: string) => VISITES.split('\n').find(l => l.includes(`titre: '${titre}'`) || l.includes(`titre: "${titre}"`)) ?? '';
  it('les étapes du menu de l\'ordinateur se sautent au téléphone, sans « On s\'est perdus de vue »', () => {
    expect(etape('Le menu')).toContain('facultatif: true');
    expect(etape('Tout trouver')).toContain('facultatif: true');
  });
  it('les anciennes cibles ne sont plus seules', () => {
    expect(etape('Retrouver une facture')).toContain('#lf-barre');
    expect(etape('Où tu en es')).toContain('#tr-resume');
    expect(etape('Les bulletins')).toContain('.cf-carte');
    expect(etape('Le bouton vert')).toContain('.lf-tete .actions');
  });
});

describe('IFACE-1, 2, 4 : les règles de largeur sont posées', () => {
  const LISTE = lire('web/public/plateforme/liste.css');
  it('les achats passent en cartes jusqu\'à 1 023 px', () => {
    const i = LISTE.indexOf('@media (max-width: 1023px) {\n  .la table.la-table { display: none; }');
    expect(i).toBeGreaterThan(0);
  });
  it('« Me guider » : une carte de thème ne fait jamais la page plus large que l\'écran', () => {
    expect(lire('web/public/v10/style.css')).toMatch(/\.g-themes \{[^}]*minmax\(min\(460px, 100%\), 1fr\)/);
  });
  it('Échéances du Cabinet : la déclaration ouverte passe sous la liste à la tablette', () => {
    expect(lire('web/public/plateforme/echeances.css')).toMatch(/@media \(min-width: 761px\) and \(max-width: 1100px\) \{ \.ec-grille \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });
});
