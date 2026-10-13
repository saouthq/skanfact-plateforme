// La collecte des mesures, pure (serveur/service/collecte.ts ; docs/console.md C12) : chaque réponse se range dans sa
// minute, son heure et son jour ; ce qui part se retire de la mémoire ; un envoi qui n'est pas parti (la base qui ne
// répond pas) revient, s'additionne à ce qui s'est noté entre-temps, et ne garde pas plus de deux heures de minutes ; le
// nom d'un exemplaire ne porte rien d'autre que sa machine et son port. Les comptes sont faits à la main.

import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { Collecte, envoyerMesures, GARDE_MINUTES, nomExemplaire } from '../../serveur/service/collecte.ts';

const a = (iso: string) => new Date(iso);

describe('la collecte des mesures', () => {
  it('chaque réponse se range dans sa minute, son heure et son jour ; ce qui part se retire de la mémoire', () => {
    const c = new Collecte();
    c.noter('GET', '/moi', 200, 40, a('2026-10-13T08:37:20Z'));
    c.noter('GET', '/moi', 503, 900, a('2026-10-13T08:37:50Z'));
    c.noter('POST', '/entreprises/:entreprise/ventes/factures', 201, 120, a('2026-10-13T08:38:05Z'));
    const e = c.prendre();
    expect(e.minutes.map((m) => [m.minute, m.sorte, m.n, m.pannes])).toEqual([
      ['2026-10-13T08:37:00.000Z', 'lecture', 2, 1], ['2026-10-13T08:38:00.000Z', 'ecriture', 1, 0]]);
    expect(e.heures.map((h) => [h.heure, h.sorte, h.n])).toEqual([['2026-10-13T08:00:00.000Z', 'lecture', 2], ['2026-10-13T08:00:00.000Z', 'ecriture', 1]]);
    expect(e.jours.map((j) => [j.jour, j.route, j.n])).toEqual([['2026-10-13', 'GET /moi', 2], ['2026-10-13', 'POST /entreprises/:entreprise/ventes/factures', 1]]);
    expect(c.vide).toBe(true);
    expect(c.prendre()).toEqual({ minutes: [], heures: [], jours: [] });
  });

  it('un envoi qui n\'est pas parti revient, s\'ajoute à ce qui s\'est noté depuis, et ne garde que deux heures de minutes', () => {
    const c = new Collecte();
    c.noter('GET', '/moi', 200, 40, a('2026-10-13T06:10:00Z'));
    c.noter('GET', '/moi', 200, 40, a('2026-10-13T08:30:00Z'));
    const e = c.prendre();
    c.noter('GET', '/moi', 200, 40, a('2026-10-13T08:30:30Z'));
    c.rendre(e, a('2026-10-13T08:31:00Z'));
    const r = c.prendre();
    // La minute de 06:10 a plus de deux heures : elle ne revient pas ; celle de 08:30 compte ses deux requêtes.
    expect(r.minutes.map((m) => [m.minute, m.n])).toEqual([['2026-10-13T08:30:00.000Z', 2]]);
    // Une heure ne se coupe pas : celle de 06:00 revient, elle couvre des minutes de moins de deux heures (06:31 à 06:59) ;
    // celle de 08:00 compte ses deux requêtes de 08:30. Celle de 05:00 ne reviendrait pas.
    expect(r.heures.map((h) => [h.heure, h.n])).toEqual([['2026-10-13T08:00:00.000Z', 2], ['2026-10-13T06:00:00.000Z', 1]]);
    const d = new Collecte();
    d.noter('GET', '/moi', 200, 40, a('2026-10-13T05:50:00Z'));
    const vieux = d.prendre();
    d.rendre(vieux, a('2026-10-13T08:31:00Z'));
    expect(d.vide).toBe(false);
    expect(d.prendre()).toMatchObject({ minutes: [], heures: [] });
    expect(r.jours.map((j) => [j.jour, j.n])).toEqual([['2026-10-13', 3]]);
    expect(GARDE_MINUTES).toBe(120);
  });

  it('une base qui ne répond pas : l\'envoi est gardé pour le tour suivant, jamais une exception', async () => {
    const c = new Collecte();
    c.noter('GET', '/moi', 200, 40, a('2026-10-13T08:37:20Z'));
    const injoignable = { connect: async () => { throw new Error('la base ne répond pas'); } } as unknown as pg.Pool;
    expect(await envoyerMesures(injoignable, 'machine-1:8080', c, a('2026-10-13T08:38:00Z'))).toBe(false);
    expect(c.vide).toBe(false);
    expect(c.prendre().minutes.map((m) => m.n)).toEqual([1]);
    // Rien à envoyer : aucune base n'est appelée.
    expect(await envoyerMesures(injoignable, 'machine-1:8080', c)).toBe(true);
  });

  it('le nom d\'un exemplaire : sa machine et son port, rien d\'autre ; ce que la base refuse se remplace', () => {
    expect(nomExemplaire('vps-1', 8080)).toBe('vps-1:8080');
    expect(nomExemplaire('serveur de Tunis/2', '8080')).toBe('serveur-de-Tunis-2:8080');
    expect(nomExemplaire('x'.repeat(100), 8080)).toHaveLength(80);
  });
});
