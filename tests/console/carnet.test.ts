// Le carnet de crise (1.109.0 ; web/console/src/carnet.ts ; docs/console.md C24 ter) : il se lit quand plus rien d'autre
// ne marche. Ce que le test tient :
//   - chaque fiche que le serveur connaît y est, une par page, avec ses quatre temps et ses messages prêts ;
//   - rien à charger (ni script, ni police, ni image, ni adresse) : il s'ouvre sans réseau ;
//   - ce qu'il cite est échappé ;
//   - un message prêt dit ce qui reste à remplir (ses crochets), et le script écrit le même carnet hors de la console.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { echapper } from '../../commun/page-a-part.ts';
import { FICHES } from '../../serveur/console/incidents.ts';

// Les textes de la console lisent la langue dans l'adresse de la page.
Object.assign(globalThis, { location: { search: '' } });
await import('../../web/console/src/textes.ts');
const { carnetDeCrise, messagesDe, passageARemplir } = await import('../../web/console/src/carnet.ts');

const RACINE = path.join(import.meta.dirname, '../..');
const carnet = carnetDeCrise({ fiches: FICHES, jour: '2026-10-22' });

describe('le carnet de crise', () => {
  it('chaque fiche du serveur, une par page, ses quatre temps et ses messages prêts, échappés', () => {
    expect([...carnet.matchAll(/<article class="fiche" id="fiche-([a-z]+)">/g)].map((m) => m[1])).toEqual([...FICHES]);
    expect([...carnet.matchAll(/<ol class="temps">/g)]).toHaveLength(FICHES.length);
    // Les fiches qui préviennent par la page d'état, et celles qui écrivent aux entreprises touchées.
    expect(FICHES.filter((f) => messagesDe(f).public)).toEqual(['service', 'site', 'base', 'partenaire', 'chiffre', 'fuite', 'rancon']);
    expect(FICHES.filter((f) => messagesDe(f).courriel)).toEqual(FICHES.filter((f) => f !== 'sauvegarde'));
    for (const f of FICHES) {
      const m = messagesDe(f);
      if (m.public) expect(carnet, f).toContain(`<blockquote class="pret">${echapper(m.public)}</blockquote>`);
      if (m.courriel) expect(carnet, f).toContain(`<pre>${echapper(m.courriel.corps)}</pre>`);
    }
    // Une apostrophe des messages est échappée ; aucune ne passe telle quelle.
    expect(carnet).toContain('L&#39;équipe SkanFact');
    expect(carnet).not.toContain('L\'équipe SkanFact');
    expect(carnet).toMatch(/Écrit le 22\/10\/2026\s+depuis la console\./);
  });

  it('rien à charger : ni script, ni police, ni image, ni adresse au dehors', () => {
    expect(carnet).not.toMatch(/<script|<img|<link|src=|url\(|https?:/i);
  });

  it('un message prêt dit ce qui reste à remplir ; le script écrit le même carnet hors de la console', () => {
    expect(passageARemplir('SkanFact ne répond plus depuis [heure] ; prochain point à [heure].')).toBe('[heure]');
    expect(passageARemplir('SkanFact ne répond plus depuis 10 h 12.')).toBeNull();
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carnet-')), 'carnet.html');
    execFileSync(process.execPath, [path.join(RACINE, 'scripts/carnet-de-crise.ts'), f], { cwd: RACINE });
    const ecrit = fs.readFileSync(f, 'utf8');
    const jour = /Écrit le (\d\d)\/(\d\d)\/(\d{4})/.exec(ecrit);
    expect(jour).not.toBeNull();
    expect(ecrit).toBe(carnetDeCrise({ fiches: FICHES, jour: `${jour?.[3]}-${jour?.[2]}-${jour?.[1]}` }));
  });
});
