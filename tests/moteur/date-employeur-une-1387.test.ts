// (1.387.32, issue 16, constat 14) La déclaration annuelle d'employeur avait quatre dates sur les écrans de la paie (« début
// 2027 (À VÉRIFIER) », « février 2027 », « 30/04/2027 », et celle du calendrier fiscal). Il n'y en a qu'une : celle que le
// calendrier fiscal règle, lue par la même fonction (`dateLimiteSociale`) partout.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
const core = ecranDeLaPlateforme('core.js') as { dateLimiteSociale: (d: Objet, kind: string, y: number, q?: number) => string };

describe('la déclaration annuelle d\'employeur n\'a qu\'une date (issue 16, constat 14)', () => {
  it('la date suit la règle du calendrier fiscal, et un réglage déplacé la déplace', () => {
    expect(core.dateLimiteSociale({}, 'employeur', 2026)).toBe('2027-04-30');
    expect(core.dateLimiteSociale({ fiscalDeadlines: [{ id: 'employeur', month: 2, day: 28 }] }, 'employeur', 2026)).toBe('2027-02-28');
  });
  it('les écrans de la paie la lisent tous par cette fonction, sans date écrite à côté', () => {
    const code = fs.readFileSync('modules/personnel/ecrans/entreprise/paie.js', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/`février \$\{y \+ 1\}`/);
    expect(code).not.toMatch(/début \$\{ty \+ 1\} \(À VÉRIFIER\)/);
    const lignes = code.split('\n').filter((l) => /Déclaration annuelle d\\?'employeur/.test(l) && /'un salarié par ligne/.test(l));
    expect(lignes.length).toBe(2);
    for (const l of lignes) expect(l).toMatch(/C\.dateLimiteSociale\(data, 'employeur', t?y\)/);
  });
  it('la déclaration du mois ne parle d\'employeur qu\'à un employeur (issue 4, ENTREE-9)', () => {
    const fd = (core as unknown as { fiscalDeadlines: (d: Objet) => { id: string; label: string; day?: number }[] }).fiscalDeadlines;
    expect(fd({}).find((r) => r.id === 'tva')?.label).toBe('Déclaration mensuelle de TVA');
    expect(fd({ employees: [{ id: 's1' }] }).find((r) => r.id === 'tva')?.label).toBe('Déclaration mensuelle d\'employeur et de TVA');
    const regle = fd({ fiscalDeadlines: [{ id: 'tva', day: 20 }] }).find((r) => r.id === 'tva');
    expect(regle?.label).toBe('Déclaration mensuelle de TVA');
    expect(regle?.day).toBe(20);
  });
});
