// (1.388.83) La fin du lot Cabinet de la vérification complète : les écrans CE-15 à CE-36 de l'audit, chacun tenu par
// sa règle. Les fonctions qui décident se JOUENT (vm) ; les gabarits se lisent dans le code.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const app1 = lire('modules/socle/ecrans/cabinet/app-1.js');
const app2 = lire('modules/socle/ecrans/cabinet/app-2.js');
const barre = lire('web/public/plateforme/barre.js');
const css = lire('web/public/v10/cabinet/cabinet.css');
const ligneDe = (src: string, motif: string) => { const i = src.indexOf(motif); return i < 0 ? '' : src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i)); };

describe('les écrans du Cabinet (1.388.83)', () => {
  it('CE-15 : le bouton du classeur nomme l\'écran qui existe', () => {
    expect(app1).toMatch(/>La saisir dans Saisie</);
    expect(app1 + app2).not.toMatch(/>La saisir dans Écritures</);
  });

  it('CE-16 : un refus du matricule se dit sur sa case, dans la fenêtre', () => {
    const n = (app2.match(/!e\.champ && \/matricule\/i\.test\(plainError\(e\)\)\)\)\) return refus\(\$\('#f-mat', layer\)/g) || []).length;
    expect(n).toBe(2);
  });

  it('CE-17 : un montant garde son dernier chiffre', () => {
    expect(css).toMatch(/\.field > input\.montant \{[^}]*padding-inline-end: 12px;[^}]*min-width: 10ch;/);
  });

  it('CE-19, CE-20 : le menu « Plus » du téléphone ne montre pas d\'identifiant et mène là où il dit', () => {
    expect(barre).toMatch(/filter\(\(id\) => lienDe\(id\) && dessinDe\(id\)\.titre !== id\)/);
    expect(barre).toMatch(/if \(href\) return `<a href=/);
    expect(barre).toMatch(/if \(route\) return `<a href="#\/\$\{esc\(route\)\}">/);
    expect(barre).toMatch(/data-plus="relai" data-i=/);
    expect(barre).toMatch(/if \(quoi === 'relai'\) \{ const r = relais\[Number\(x\.dataset\.i\)\]; if \(r\) r\.click\(\); return; \}/);
    // Les pages du quotidien que la barre du bas ne porte pas (Pièces reçues) ; les tuiles de la comptabilité du dossier.
    expect(barre).toMatch(/#nav \.nav-quotidien > a\.lien\[data-route\]/);
    expect(barre).toMatch(/\.volet \.ligne \.pl-l, \.volet \.pl-c/);
    // « Mon équipe » n'est pas dit deux fois.
    expect(barre).toMatch(/\(equipeAuVolet \? '' : `<button type="button" data-plus="equipe">/);
  });

  it('CE-24 : un rôle porte le nom que les Réglages lui donnent', () => {
    expect(app1).toMatch(/const nomRoleCd = r => K\.LIBELLE_ROLE\[r\] \|\| r \|\| '';/);
    expect(app1).not.toMatch(/'direction du cabinet'|validation: 'tenue des dossiers'|supervision: 'direction'/);
    expect(app1).toMatch(/\$\{esc\(nomRoleCd\(r\.c\.role\)\)\}/);
    expect(app1).toMatch(/\$\{esc\(nomRoleCd\(c\.role\)\)\}/);
  });

  it('CE-25 : la marque de l\'exemple ne fait pas d\'initiales', () => {
    const i = app1.indexOf('  const PETITS_MOTS');
    const j = app1.indexOf('\n', app1.indexOf(".toUpperCase();", app1.indexOf('  const initialesDe')));
    expect(i).toBeGreaterThan(0);
    const ctx: { f?: (n: string) => string } = {};
    vm.runInNewContext(`${app1.slice(i, j)}; this.f = initialesDe;`, ctx);
    expect(ctx.f?.('Exemple · Pâtisserie El Amal')).toBe(ctx.f?.('Pâtisserie El Amal'));
    expect(ctx.f?.('Exemple · Pâtisserie El Amal')).not.toMatch(/·/);
  });

  it('CE-27, CE-28 : l\'Aide nomme l\'écran, et les compteurs s\'accordent sur leur total', () => {
    expect(app2).toMatch(/`L'écran « \$\{ONGLETS_COMPTA\[g\.ecran\]\} »` : 'Cet écran'\)\} vit dans chaque dossier/);
    expect(app2).toMatch(/gestes\.length > 1 \? 'gestes guidés réussis' : 'geste guidé réussi'/);
    expect(app2).toMatch(/pages\.length > 1 \? 'écrans découverts' : 'écran découvert'/);
  });

  it('CE-31 : « Noter une relance faite ailleurs… » ne se dit qu\'une fois sur la fiche', () => {
    const debut = app1.indexOf('${sec(\'L\\\'historique\'');
    expect(debut).toBeGreaterThan(0);
    expect(ligneDe(app1, '${sec(\'L\\\'historique\'')).not.toMatch(/Noter une relance/);
    expect(app1).toMatch(/id="note-rel"/);
  });

  it('CE-32 : le groupe dit « Urgent » ; seule une déclaration en retard porte une étiquette', () => {
    const i = app1.indexOf('  function lignePriorite(');
    const j = app1.indexOf('\n  }', i) + 4;
    const ctx: { f?: (x: object, i: number, g: string) => string } = {};
    vm.runInNewContext(`const esc = s => String(s); const marqueD = () => ''; const marqueCab = () => '';
      ${app1.slice(i, j)}; this.f = lignePriorite;`, ctx);
    const urgent = ctx.f?.({ dossier: null, quoi: '1 mois sans écriture', sous: 'octobre', ton: 'alerte', geste: 'Demander…' }, 0, 'u') || '';
    expect(urgent).not.toMatch(/urgent|à voir|class="etat/);
    const tard = ctx.f?.({ dossier: null, quoi: 'TVA', sous: 'hier', ton: 'alerte', retard: true, geste: 'Voir' }, 1, 'u') || '';
    expect(tard).toMatch(/<span class="etat alerte">en retard<\/span>/);
    expect((app1.match(/ton: 'alerte', retard: true,/g) || []).length).toBe(2);
  });

  it('CE-33 : une infobulle ne se pose pas sur un chiffre pour ne rien dire', () => {
    expect(app1).not.toMatch(/'aucun dossier'\)\}">/);
    expect(app1).toMatch(/data-tb-etape="\$\{e\}"\$\{l\.length \? ` title=/);
    // Le trait du seuil passe SOUS « aucune pièce depuis 6 mois », plus par-dessus.
    expect(fs.readFileSync(path.join(RACINE, 'web/public/plateforme/tableau-de-bord.css'), 'utf8')).toMatch(/\.tb-ar-rien \{[^}]*z-index: 1;/);
    // La balance : l'infobulle vit sur le numéro de compte, pas sur la ligne de montants.
    expect(app1).not.toMatch(/data-gl-compte="\$\{esc\(r\.account\)\}" title=/);
  });

  it('CE-34 : les miniatures du thème montrent l\'application, et la sombre se voit sur un fond sombre', () => {
    expect(css).not.toMatch(/linear-gradient\(135deg, #ffffff 50%, #1a2029 50%\)/);
    expect(css).toMatch(/\.theme-ap\[data-ap="auto"\] i \{ inline-size: 50%;/);
    expect(css).toMatch(/body\.dark \.theme-ap \{ border-color: #3c4654; \}/);
    expect(css).toMatch(/\.theme-ap b::before \{/);
  });

  it('CE-36 : une date limite un dimanche se dit, sans être reportée', () => {
    const l = ligneDe(app2, 'const jourChome = iso =>');
    const ctx: { f?: (s: string) => string } = {};
    vm.runInNewContext(`${l}; this.f = jourChome;`, ctx);
    expect(ctx.f?.('2026-11-15')).toBe('dimanche');
    expect(ctx.f?.('2026-11-14')).toBe('samedi');
    expect(ctx.f?.('2026-11-16')).toBe('');
    expect(app2).toMatch(/jourChome\(e\.date\) && x\.groupe !== 'depose' \? `<span class="ec-chome">un \$\{jourChome\(e\.date\)\} : le report au premier jour ouvrable n'est pas compté — À VÉRIFIER<\/span>`/);
  });
});
