// Les migrations : dans l'ordre, une seule fois, et jamais réécrites après coup (12 § 3).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { lireMigrations, migrer } from '../../base/migrer.ts';

// Les dossiers d'essai s'effacent à la fin : un test ne laisse rien derrière lui.
const dossiers: string[] = [];
const dossierTemporaire = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-')); dossiers.push(d); return d; };
afterAll(() => { for (const d of dossiers) fs.rmSync(d, { recursive: true, force: true }); });

describe('les migrations', () => {
  it('relancer sur une base à jour ne fait rien', async () => {
    expect(await migrer(inject('pgAdmin'))).toEqual([]);
  });

  it('une migration déjà appliquée puis modifiée est refusée', async () => {
    const dossier = dossierTemporaire();
    for (const m of lireMigrations()) {
      fs.writeFileSync(path.join(dossier, `${String(m.numero).padStart(4, '0')}_${m.nom}.sql`), m.sql + '\n-- une ligne ajoutée après coup\n');
    }
    await expect(migrer(inject('pgAdmin'), dossier)).rejects.toThrow(/a été modifiée après avoir été appliquée/);
  });

  it('les noms de fichiers se vérifient : numéro sur quatre chiffres, jamais deux fois le même', () => {
    const dossier = dossierTemporaire();
    fs.writeFileSync(path.join(dossier, '0001_a.sql'), 'select 1');
    fs.writeFileSync(path.join(dossier, '0001_b.sql'), 'select 1');
    expect(() => lireMigrations(dossier)).toThrow(/deux migrations portent le numéro 1/);
    const autre = dossierTemporaire();
    fs.writeFileSync(path.join(autre, '2_c.sql'), 'select 1');
    expect(() => lireMigrations(autre)).toThrow(/nom de migration invalide/);
  });
});
