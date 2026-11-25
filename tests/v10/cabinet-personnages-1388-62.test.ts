// Le rapport #24 (le Cabinet par personnage ; 1.388.62) : la Saisie, le collaborateur sans dossier, deux postes, et un
// portefeuille de 160 dossiers. Lu dans le code des écrans (ils ne s'exécutent qu'avec un navigateur) ; une preuve
// (tests/preuves.sh) retire chaque règle pour voir ce test tomber.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const lire = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '../..', f), 'utf8');
const app1 = lire('modules/socle/ecrans/cabinet/app-1.js');
const app2 = lire('modules/socle/ecrans/cabinet/app-2.js');
const bord = lire('web/public/plateforme/tableau-de-bord.css');

describe('le rapport #24', () => {
  // CAB2-4 : la Saisie n'a pas « Enregistrer et valider » ; sa touche enregistre au brouillard ; la fiche ne lui prête pas la révision.
  it('la grille ne propose de valider qu\'à qui valide', () => {
    expect(app2).toMatch(/\$\{peutValiderCl\(dossier\)\n\s+\? `<button type="button" class="btn" id="sa-ok">Enregistrer en brouillard<\/button>\n\s+<button type="button" class="btn btn-primary" id="sa-okvalider">/);
    expect(app2).toMatch(/: `<span class="fd-qui" id="sa-qui-valide">\$\{esc\(cap\(reviseurCl\(dossier\)\)\)\} valide le brouillard<\/span><button type="button" class="btn btn-primary" id="sa-ok">/);
    expect(app2).toMatch(/if \(touche === t\.valider\) \{ ev\.preventDefault\(\); enregistrer\(peutValiderCl\(dossier\)\); return; \}/);
    expect(app1).toMatch(/suitSaisie \? \(d\.manual \? 'la saisie, au brouillard : un autre la valide'/);
  });

  // CAB2-7 et CAB2-6 : un enregistrement refusé dit pourquoi, et rend la pièce tapée.
  it('un dossier retiré et une écriture validée entre-temps se disent, la pièce recopiée', () => {
    expect(app2).toMatch(/\} catch \(e\) \{ await refusEnregistrement\(e, p, dossier, root\); \}/);
    const f = /async function refusEnregistrement\(e, p, dossier, root\) \{[\s\S]{0,3500}?\n {2}\}/.exec(app2)?.[0] ?? '';
    expect(f).toContain('if (/^introuvable\\.?$/i.test(String(msg).trim())) {');
    expect(f).toMatch(/Ce dossier ne t\\'est plus ouvert/);
    expect(f).toMatch(/if \(p && p\.id && \/validée ne se modifie pas\/i\.test\(msg\)\) \{/);
    expect(f).toMatch(/await api\.livre\(dossier\.id, s\.annee\)/);
    expect(f).toMatch(/\$\{recopie\}/);
  });

  // CAB2-3 : un collaborateur sans dossier confié ne reçoit pas les étapes d'un cabinet neuf.
  it('le collaborateur sans dossier lit qui les lui confie, sans le code du cabinet', () => {
    expect(app1).toMatch(/const collabSansDossier = vide && !estAssocie\(\);/);
    expect(app1).toMatch(/const corps = collabSansDossier \? `<div class="panel tb-p"><div class="tb-vide" id="tb-collab-vide">/);
    const bloc = /const corps = collabSansDossier \? `([\s\S]{0,700}?)`\n/.exec(app1)?.[1] ?? '';
    expect(bloc).not.toMatch(/code|Importer/);
  });

  // CAB2-9 : le nom d'un dossier prend la place de sa cellule, et se lit entier au survol.
  it('le nom au tableau de bord n\'est plus coupé à 190 px', () => {
    expect(bord).not.toMatch(/td\.cl b \{[^}]*max-width: 190px/);
    expect((app1.match(/<b title="\$\{esc\(x\.d\.name\)\}">\$\{esc\(x\.d\.name\)\}<\/b>/g) || []).length).toBe(2);
  });

  // CAB2-10 : Ctrl K garde la ligne choisie à l'écran, et dit quand elle en cache.
  it('la palette suit la sélection au clavier et dit combien de dossiers correspondent', () => {
    expect(app2).toMatch(/const choisie = \$\('\.res\.sel', root\);\n\s+if \(choisie && choisie\.scrollIntoView\) choisie\.scrollIntoView\(\{ block: 'nearest' \}\);/);
    expect(app2).toMatch(/if \(tousLesDossiers\.length > rows\.length\)/);
  });
});
