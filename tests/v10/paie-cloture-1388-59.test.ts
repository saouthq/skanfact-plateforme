// Le rapport #20 (paie, clôture, liasse ; 1.388.59) : ce que les écrans disent d'un mois déjà payé, d'un départ, d'un
// exercice clos et de la liasse. Lu dans le code des écrans (ils ne s'exécutent qu'avec un navigateur) : chaque règle est
// cherchée là où elle décide, et une preuve (tests/preuves.sh) la retire pour voir ce test tomber.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const lire = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '../..', f), 'utf8');
const entreprise = lire('modules/personnel/ecrans/entreprise/paie.js');
const cabinet = lire('modules/personnel/ecrans/cabinet/paie.js');
const socle = lire('modules/socle/ecrans/cabinet/app-1.js');

describe('le rapport #20', () => {
  // SOCIAL-6 : une absence non payée sur un mois dont le bulletin est payé (ou validé, ou clôturé) ne se dit plus « retirée ».
  it('une absence sur un mois déjà payé se dit « à régulariser », avant de la poser et dans les deux listes', () => {
    const tenu = /function bulletinTenuDe\(empId, from\) \{[\s\S]{0,500}?b\.paidDate \|\| b\.valideLe \|\| C\.isClosedDate/.exec(entreprise);
    expect(tenu).not.toBeNull();
    expect(entreprise).toMatch(/const effetNonPayee = l => \(bulletinTenuDe\(l\.employeeId, l\.from\) \? '<span class="warn-text" data-lv-regul>pas retenue : à régulariser<\/span>'/);
    // Les deux listes d'absences passent par elle : aucune n'écrit plus « retirée du salaire » sans regarder le mois.
    expect((entreprise.match(/l\.paid \? '<span class="ok-text">payée<\/span>' : effetNonPayee\(l\)/g) || []).length).toBe(2);
    expect(entreprise).not.toMatch(/l\.paid \? '<span class="ok-text">payée<\/span>' : '<span class="warn-text">retirée du salaire<\/span>'/);
    // La fenêtre le dit avant d'enregistrer.
    expect(entreprise).toMatch(/: il ne change pas\. La retenue est à régulariser sur un prochain bulletin/);
  });

  // SOCIAL-9 : un salarié dont la sortie est passée n'est plus compté « en poste ».
  it('la liste des salariés ne compte pas deux fois un salarié sorti resté actif', () => {
    expect(cabinet).toMatch(/const sorti = x => !x\.actif \|\| \(x\.sortie && x\.sortie < aujourdhuiPaie\(\)\), enPoste = \(L\.salaries \|\| \[\]\)\.filter\(x => !sorti\(x\)\)/);
  });

  // SOCIAL-8 : un CDI ne « se renouvelle » pas ; les documents d'un salarié parti se datent de son dernier jour.
  it('le départ d\'un CDI ne propose pas de le renouveler, et son solde se date de sa sortie', () => {
    expect(cabinet).toMatch(/x\.contrat === 'cdi' \|\| !x\.contrat \? `fin de son CDI/);
    expect(cabinet).toMatch(/const jour = x\.sortie && x\.sortie < K\.today\(\) \? x\.sortie : K\.today\(\);/);
  });

  // SOCIAL-2 : le prorata d'une entrée ou d'une sortie porte, au Cabinet comme dans l'entreprise, sa réserve.
  it('le brut proratisé du Cabinet dit que sa méthode est à vérifier', () => {
    expect(cabinet).toMatch(/pour un mois plein\)\. À VÉRIFIER avec le dossier : la méthode du prorata/);
  });

  // SOCIAL-4 : la case « imposable » dit ce qu'elle retire.
  it('la case « imposable » d\'une prime dit les quatre bases qu\'elle retire, des deux côtés', () => {
    for (const s of [cabinet, entreprise]) {
      const cases = s.match(/<label class="check small"[^>]*><input type="checkbox" data-[a-z]+="taxable"/g) || [];
      expect(cases.length).toBe(2);
      cases.forEach((c) => expect(c).toContain('sort de la CNSS, de l’impôt, de la TFP et du FOPROLOS'));
    }
  });

  // SOCIAL-7 : la frise d'un exercice ne réclame ni les mois d'avant son premier jour, ni un exercice clos.
  it('la frise dit « hors exercice » et « clos » au lieu de « à saisir »', () => {
    const f = /function moisDeLaFrise\(dossier\) \{[\s\S]{0,1600}?\n {2}\}/.exec(socle)?.[0] ?? '';
    expect(f).toMatch(/m < String\(ex\.du\)\.slice\(0, 7\)\) \|\| \(ex\.au && m > String\(ex\.au\)\.slice\(0, 7\)\)\) return \{ m, nom, ton: 'vide', dit: 'hors exercice' \}/);
    expect(f).toMatch(/if \(ex\.clos && cl !== 'fait' && cl !== 'pret'\) return \{ m, nom, ton: 'vide', dit: 'clos' \}/);
  });

  // SOCIAL-5 : la liasse dit ce qu'elle ne produit pas pour le dépôt.
  it('la liasse dit qu\'il manque les flux de trésorerie, les notes et les fichiers XML', () => {
    expect(socle).toMatch(/id="li-manque">Pour le dépôt sur TEJ, il manque encore ici : <b>l'état des flux de trésorerie<\/b>/);
  });
});
