// Le journal de la console, pur (serveur/console/journal.ts ; 0114) : chaque geste qu'il sait dire a le geste de la console
// qui le permet ; « réservé à la direction » se lit dans la liste des gestes (jamais recopié) ; les périodes partent de
// minuit à Tunis.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GESTES_CONSOLE } from '../../serveur/console/gestes.ts';
import { depuisLa, gesteDeLaConsole, plageDe, reserveALaDirection, sorteDe, SORTES } from '../../serveur/console/journal.ts';

const textes = fs.readFileSync(path.join(import.meta.dirname, '../../web/console/src/textes.ts'), 'utf8');
// Les gestes que l'écran sait dire : chaque clé « console.ecran.journal.g.<geste> » (le tiret écrit en souligné).
const gestesDits = [...textes.matchAll(/'console\.ecran\.journal\.g\.([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1] ?? '');

describe('les gestes du journal', () => {
  it('chacun a le geste de la console qui le permet, et ce geste existe', () => {
    expect(gestesDits.length).toBeGreaterThan(60);
    const sans = gestesDits.filter((g) => !g.startsWith('systeme.') && (gesteDeLaConsole(g) === null || !GESTES_CONSOLE.has(gesteDeLaConsole(g) ?? '')));
    expect(sans).toEqual([]);
  });

  it('réservé à la direction : quand le geste de la console n\'est ouvert qu\'à elle', () => {
    expect(reserveALaDirection('reglages.prix_prepare')).toBe(true);
    expect(reserveALaDirection('equipe.retirer')).toBe(true);
    expect(reserveALaDirection('clients.reprise_ouverte')).toBe(true);
    expect(reserveALaDirection('abonnement.suspendre')).toBe(true);
    expect(reserveALaDirection('journal.exporte')).toBe(true);
    // Le support peut le faire : pas réservé.
    expect(reserveALaDirection('abonnement.prolonger')).toBe(false);
    expect(reserveALaDirection('abonnement.offrir-mois')).toBe(false);
    expect(reserveALaDirection('support.repondre')).toBe(false);
    expect(reserveALaDirection('support.acces_demander')).toBe(false);
    // La technique aussi : pas réservé.
    expect(reserveALaDirection('service.sourdine')).toBe(false);
    expect(reserveALaDirection('versions.geler')).toBe(false);
    // Chacun ferme ses sessions : pas réservé ; ce que le système fait seul ne l'est pas non plus.
    expect(reserveALaDirection('equipe.session_fermee')).toBe(false);
    expect(reserveALaDirection('systeme.relance')).toBe(false);
    // La règle suit la liste des gestes : un geste ouvert au support n'est jamais dit réservé.
    for (const g of gestesDits) {
      const c = GESTES_CONSOLE.get(gesteDeLaConsole(g) ?? '');
      if (c && c.roles.includes('support')) expect(reserveALaDirection(g)).toBe(false);
    }
  });
});

describe('les filtres', () => {
  it('la période part de minuit à Tunis ; « tout » n\'a pas de début ; une valeur inconnue vaut trente jours', () => {
    expect(depuisLa('1j', '2026-10-15')?.toISOString()).toBe('2026-10-14T23:00:00.000Z');
    expect(depuisLa('7j', '2026-10-15')?.toISOString()).toBe('2026-10-08T23:00:00.000Z');
    expect(depuisLa('30j', '2026-10-15')?.toISOString()).toBe('2026-09-15T23:00:00.000Z');
    expect(depuisLa('tout', '2026-10-15')).toBeNull();
    expect(plageDe('n\'importe')).toBe('30j');
    expect(plageDe('7j')).toBe('7j');
  });
  it('les sortes de l\'écran sont celles du serveur', () => {
    const ecran = /const SORTES = \[([^\]]+)\] as const/.exec(fs.readFileSync(path.join(import.meta.dirname, '../../web/console/src/ecrans/Journal.tsx'), 'utf8'))?.[1] ?? '';
    expect(ecran.split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...SORTES]);
    expect(sorteDe('equipe')).toBe('equipe');
    expect(sorteDe('autre')).toBeNull();
  });
});
