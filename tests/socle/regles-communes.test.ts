// Le registre des règles communes (base/regles-communes.ts ; trouvé le 05/10/2026 sur le serveur d'essai, où aucune
// facture ne s'émettait faute de timbre) : chaque règle que le serveur lit est au registre, en vigueur aujourd'hui,
// avec sa source ; la pose ajoute ce qui manque, ne réécrit jamais une règle, ferme une date de fin une fois, et un lot
// refusé n'écrit rien. Sur une base neuve : la base commune porte les règles d'essai des autres tests.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireRegistre, poserReglesCommunes, type RegleCommune } from '../../base/regles-communes.ts';
import { baseNeuve } from '../base-neuve.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const fichiers = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? fichiers(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);

describe('le registre des règles communes', () => {
  let base: Awaited<ReturnType<typeof baseNeuve>>;
  let admin: pg.Client;
  beforeAll(async () => {
    base = await baseNeuve('skanfact_regles');
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
  }, 120_000);
  afterAll(async () => { await admin?.end(); await base?.jeter(); });

  it('chaque règle que le serveur lit est au registre, en vigueur aujourd\'hui et avec sa source', async () => {
    const lues = new Set<string>();
    for (const f of fichiers(path.join(RACINE, 'serveur'))) {
      for (const m of sansCommentaires(fs.readFileSync(f, 'utf8')).matchAll(/\bregle\(\s*tx\s*,[^,]+,\s*'([a-z_][a-z0-9_.]*)'/g)) lues.add(m[1] as string);
    }
    expect([...lues]).toContain('timbre.facture');
    const registre = lireRegistre();
    for (const r of registre) expect(r.source.trim().length, `la source de ${r.code}`).toBeGreaterThan(20);
    expect(await poserReglesCommunes(base.admin, registre)).toMatchObject({ fermees: [] });
    const aujourdhui = new Date().toISOString().slice(0, 10);
    for (const code of lues) {
      const r = (await admin.query('select valeur from socle.regle_fiscale where code = $1 and debut <= $2::date and (fin is null or fin >= $2::date)', [code, aujourdhui])).rows;
      expect(r, `la règle ${code} au ${aujourdhui}`).toHaveLength(1);
    }
    expect((await admin.query(`select valeur from socle.regle_fiscale where code = 'timbre.facture'`)).rows).toEqual([{ valeur: 1000 }]);
    // Posé une seconde fois (chaque installation le fait) : rien ne change.
    expect(await poserReglesCommunes(base.admin, registre)).toEqual({ posees: [], fermees: [] });
  });

  it('une règle déjà posée ne se réécrit pas ; une loi nouvelle ferme l\'ancienne et pose la suivante ; un lot refusé n\'écrit rien', async () => {
    const taux: RegleCommune = { code: 'essai_registre.taux', valeur: 70000, debut: '2026-01-01', source: 'Loi d\'essai pour 2026' };
    expect(await poserReglesCommunes(base.admin, [taux])).toEqual({ posees: ['essai_registre.taux au 2026-01-01'], fermees: [] });
    await expect(poserReglesCommunes(base.admin, [{ ...taux, valeur: 90000 }])).rejects.toThrow('déjà posée autrement');
    await expect(poserReglesCommunes(base.admin, [{ ...taux, source: 'Une autre loi' }])).rejects.toThrow('déjà posée autrement');
    // Un lot refusé n'écrit rien : ni la règle nouvelle qu'il porte, ni la date de fin qu'il fermait avant le refus.
    const autre: RegleCommune = { code: 'essai_registre.autre', valeur: 1, debut: '2026-01-01', source: 'Loi d\'essai' };
    const nouvelle: RegleCommune = { code: 'essai_registre.nouvelle', valeur: 2, debut: '2026-01-01', source: 'Loi d\'essai' };
    await poserReglesCommunes(base.admin, [autre]);
    await expect(poserReglesCommunes(base.admin, [nouvelle, { ...taux, fin: '2026-12-31' }, { ...autre, valeur: 3 }])).rejects.toThrow('déjà posée autrement');
    expect((await admin.query(`select code, fin::text from socle.regle_fiscale where code like 'essai_registre.%' order by code`)).rows)
      .toEqual([{ code: 'essai_registre.autre', fin: null }, { code: 'essai_registre.taux', fin: null }]);
    // La loi pour 2027 : l'ancienne règle se ferme au 31/12/2026, la nouvelle commence le lendemain.
    const suivante: RegleCommune = { code: 'essai_registre.taux', valeur: 90000, debut: '2027-01-01', source: 'Loi d\'essai pour 2027' };
    expect(await poserReglesCommunes(base.admin, [{ ...taux, fin: '2026-12-31' }, suivante]))
      .toEqual({ posees: ['essai_registre.taux au 2027-01-01'], fermees: ['essai_registre.taux au 2026-01-01'] });
    expect((await admin.query(`select valeur, debut::text, fin::text from socle.regle_fiscale where code = 'essai_registre.taux' order by debut`)).rows)
      .toEqual([{ valeur: 70000, debut: '2026-01-01', fin: '2026-12-31' }, { valeur: 90000, debut: '2027-01-01', fin: null }]);
    // Une date de fin posée ne change plus.
    await expect(poserReglesCommunes(base.admin, [{ ...taux, fin: '2026-11-30' }, suivante])).rejects.toThrow('a déjà sa date de fin');
  });
});
