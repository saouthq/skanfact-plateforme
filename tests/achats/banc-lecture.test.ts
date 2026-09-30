// Le banc de la lecture (brique 84 ; banc/lecture/mesurer.ts) : l'instrument qui dira, sur un lot de vraies
// factures prêtées avec accord, si le moteur atteint le seuil écrit d'avance (9 sur 10 : matricule, date et
// total justes). Ici, sur les pièces d'essai du dépôt (inventées) : il les lit toutes justes ; et il sait
// dire NON (un attendu faux, un lot vide) — un instrument qui ne sait pas dire non ne mesure rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mesurer } from '../../banc/lecture/mesurer.ts';

const DONNEES = path.join(import.meta.dirname, '../donnees/lecture');

describe('le banc de la lecture', () => {
  it('les six pièces d\'essai se lisent justes : matricule, date et total ; le seuil est atteint', async () => {
    const m = await mesurer(DONNEES, '7654321B/A/M/000');
    expect(m.lignes.map((l) => [l.fichier, l.matricule, l.date, l.total])).toEqual([
      ['quincaillerie.pdf', true, true, true], ['quincaillerie-photo.jpg', true, true, true], ['quincaillerie-scan.pdf', true, true, true],
      ['materiaux.png', true, true, true], ['bureau-etudes.png', true, true, true], ['fournisseur-eur.png', true, true, true],
    ]);
    expect(m).toMatchObject({ justes: 6, seuilAtteint: true });
  }, 60_000);

  it('il sait dire non : deux lectures fausses sur six font moins de 9 sur 10 ; un lot vide ne prouve rien', async () => {
    const lot = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-lecture-'));
    try {
      for (const f of ['quincaillerie.pdf', 'materiaux.png']) fs.copyFileSync(path.join(DONNEES, f), path.join(lot, f));
      fs.writeFileSync(path.join(lot, 'attendu.json'), JSON.stringify({
        'quincaillerie.pdf': { matricule: '1234567A/B/M/000', date: '2026-10-03', total: '332.223' },
        'materiaux.png': { matricule: '0876543K/A/M/000', date: '2026-09-13', total: '913.135' },
      }));
      const m = await mesurer(lot, '7654321B/A/M/000');
      expect(m.lignes.map((l) => [l.matricule, l.date, l.total])).toEqual([[true, true, false], [true, false, true]]);
      expect(m).toMatchObject({ justes: 0, seuilAtteint: false });
      fs.writeFileSync(path.join(lot, 'attendu.json'), '{}');
      expect(await mesurer(lot)).toEqual({ lignes: [], justes: 0, seuilAtteint: false });
    } finally { fs.rmSync(lot, { recursive: true, force: true }); }
  }, 60_000);
});
