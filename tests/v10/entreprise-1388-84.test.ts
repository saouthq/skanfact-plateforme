// (1.388.84) Le lot Entreprise de la vérification complète : CE2-01, 02, 04 à 09 de l'audit du code, chacun tenu par sa
// règle. Ce qui décide se JOUE (vm) ; le reste se lit dans le code, commentaires retirés.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const pont = lireEcran('plateforme/pont.js'); // un fichier assemblé se lit par lireEcran (tests/commun/assemblage.test.ts)
const app1 = lire('modules/socle/ecrans/entreprise/app-1.js');
const paie = lire('modules/personnel/ecrans/entreprise/paie.js');
const ligneDe = (src: string, motif: string) => { const i = src.indexOf(motif); return i < 0 ? '' : src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i)); };

describe('le lot Entreprise de la vérification complète (1.388.84)', () => {
  it('CE2-01 : l\'écriture d\'une pièce est la vente VIVANTE, pas la validée contre-passée', () => {
    const l = ligneDe(pont, 'const tous = (r.ecritures || [])').replace(/\/\*\* @type \{any\} \*\/ /g, '').replace(/ \/\/ \(1\.388\.84.*$/, '');
    expect(l).not.toBe('');
    const jouer = (ecritures: object[]) => { const ctx: { x?: { id: string } } = {}; vm.runInNewContext(`const r = ${JSON.stringify({ ecritures })}; ${l}; this.x = x;`, ctx); return ctx.x?.id; };
    // La famille réécrite : l'originale validée, sa contre-passation, la nouvelle en brouillard.
    expect(jouer([
      { id: 'a', statut: 'validee', origine: { type: 'vente' } },
      { id: 'b', statut: 'validee', origine: { type: 'contre_passation', id: 'a' } },
      { id: 'c', statut: 'brouillard', origine: { type: 'vente' } },
    ])).toBe('c');
    // Le drapeau rendu par le serveur suffit aussi.
    expect(jouer([{ id: 'a', contrepassee: true, origine: { type: 'vente' } }, { id: 'c', origine: { type: 'vente' } }])).toBe('c');
    // Une seule vente : c'est elle.
    expect(jouer([{ id: 'a', origine: { type: 'vente' } }])).toBe('a');
  });

  it('CE2-02 : un refus au milieu d\'un gros envoi dit ce qui est déjà enregistré', () => {
    expect(sansCommentaires(pont)).toMatch(/throw Object\.assign\([^;]*refusHorsLigne\(e\)\), i \? \{ dejaEnregistres: i \} : \{\}\);/);
    const i = app1.indexOf('function echecEnregistrement(');
    const f = sansCommentaires(app1.slice(i, app1.indexOf('\n  }', i)));
    expect(f).toMatch(/const deja = Number\(e && e\.dejaEnregistres\) \|\| 0;/);
    expect(f).toMatch(/deja \? 'Une partie seulement a été enregistrée' : 'Rien n\\'a été enregistré'/);
    expect(f).toMatch(/Les \$\{deja\} premiers changements sont enregistrés/);
  });

  it('CE2-04 : « vue le » et « envoyée le » disent le jour de Tunis', () => {
    const code = sansCommentaires(app1);
    expect(code).not.toMatch(/vuLe\.slice\(0, 10\)/);
    expect(code).not.toMatch(/String\(m\.ecritLe\)\.slice\(0, 10\)/);
    expect((code.match(/new Date\(v\.vuLe\)\.toLocaleDateString\('sv-SE', \{ timeZone: 'Africa\/Tunis' \}\)/g) || []).length).toBe(2);
    expect(code).toMatch(/new Date\(m\.ecritLe\)\.toLocaleDateString\('sv-SE', \{ timeZone: 'Africa\/Tunis' \}\)/);
  });

  it('CE2-05 : une absence à cheval sur deux mois ne retire que SES jours du premier bulletin', () => {
    const code = sansCommentaires(paie);
    expect(code).toMatch(/const ici = v\.to \? C\.leaveDaysInMonth\(\{ from: v\.from, to: v\.to \}, y, m, C\.payrollSettings\(data\)\.offDays\) : jours, reste = Math\.max\(0, jours - ici\);/);
    expect(code).toMatch(/brut \/ \(Number\(C\.payrollSettings\(data\)\.workedDays\) \|\| 26\) \* ici\)/);
    // Le reste se dit dans la ligne du tableau, pas dans une phrase qui pousserait le bouton.
    expect(code).toMatch(/non payé\$\{sPl\(ici\)\}\$\{reste \? ` · \$\{j\(reste\)\} le mois suivant` : ''\}/);
    expect(code).not.toMatch(/du bulletin du mois suivant/);
  });

  it('CE2-06 : la phrase des jours ouvrables nomme les jours de repos réglés', () => {
    const i = paie.indexOf('  const NOMS_JOURS');
    const j = paie.indexOf('\n  }', paie.indexOf('function joursDeRepos(')) + 4;
    const jouer = (off: unknown) => { const ctx: { f?: () => string } = {}; vm.runInNewContext(`const data = {}; const C = { payrollSettings: () => ({ offDays: ${JSON.stringify(off)} }) }; ${paie.slice(i, j)}; this.f = joursDeRepos;`, ctx); return ctx.f?.(); };
    expect(jouer([0])).toBe('dimanches');
    expect(jouer([0, 6])).toBe('samedis et dimanches');
    expect(jouer([5, 6, 0])).toBe('vendredis, samedis et dimanches');
    expect(jouer([])).toBe('');
    expect(sansCommentaires(paie)).not.toMatch(/ouvrable\$\{sPl\(days\)\}<\/b>, dimanches exclus/);
    expect(paie).toMatch(/joursDeRepos\(\) \? `, \$\{joursDeRepos\(\)\} exclus` : ', tous les jours de la semaine comptés'/);
  });

  it('CE2-07 : le timbre d\'une commande en ligne est celui que la facture a scellé', () => {
    const code = sansCommentaires(lire('serveur/v10/boutique.ts'));
    expect(code).not.toMatch(/corps\.timbre \? 1000n : 0n/);
    expect(code).toMatch(/selectFrom\('ventes\.piece'\)\.select\('timbre'\)[^;]*where\('ref_v10', '=', cle\)[^;]*where\('statut', '=', 'emise'\)/);
    expect(code).toMatch(/const timbre = scelle\?\.timbre \?\? 0n;/);
  });

  it('CE2-08 : la date d\'un achat dans un refus s\'écrit JJ/MM/AAAA', () => {
    const src = lire('serveur/v10/achats.ts');
    const l = ligneDe(src, 'const jjmmaaaa = ').replace('(d: unknown)', '(d)');
    const ctx: { f?: (d: unknown) => string } = {};
    vm.runInNewContext(`${l}; this.f = jjmmaaaa;`, ctx);
    expect(ctx.f?.('2026-03-04')).toBe('04/03/2026');
    expect(ctx.f?.(undefined)).toBe('?');
    const code = sansCommentaires(src);
    expect(code).toMatch(/`du \$\{jjmmaaaa\(p\.date\)\}`/);
    expect(code).toMatch(/`du \$\{jjmmaaaa\(faux\.date_piece\)\}`/);
    expect(code).not.toMatch(/`du \$\{faux\.date_piece\}`/);
  });

  it('CE2-09 : un ticket de caisse ne coche pas « Ta première facture »', () => {
    expect(sansCommentaires(lire('web/public/plateforme/premiers-pas.js'))).toMatch(/const uneFacture = docs\.some\([^;]*x\.type === 'facture' && !C\.estTicket\(x\)\);/);
  });
});
