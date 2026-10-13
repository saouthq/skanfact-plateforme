// Chaque geste que la base écrit au journal de la console (plateforme.geste_console, 0083) : sa forme, que la table
// exige, et son libellé dans l'écran du journal. Trouvé le 13/10/2026 en écrivant un message aux clients à la souris :
// « reglages.message.ecrire » (trois parties) ne passait pas la contrainte de la table — le geste échouait en entier,
// et l'écran disait « Le serveur a rencontré une erreur ». Aucun test de route ne l'avait encore appelé ; celui-ci lit
// toutes les migrations, sans base.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { texteConnu } from '../../textes/index.ts';
import '../../web/console/src/textes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MIGRATIONS = path.join(RACINE, 'base/migrations');

// Les arguments d'un `values (…)` : séparés par les virgules du premier niveau, chaînes SQL comprises ('' compris).
function argumentsDe(sql: string, debut: number): string[] {
  const args: string[] = [];
  let profondeur = 1, courant = '', chaine = false;
  for (let k = debut; k < sql.length && profondeur > 0; k++) {
    const c = sql[k] as string;
    if (chaine) {
      courant += c;
      if (c === '\'') { if (sql[k + 1] === '\'') courant += sql[++k]; else chaine = false; }
      continue;
    }
    if (c === '\'') { chaine = true; courant += c; continue; }
    if (c === '(') profondeur++;
    if (c === ')' && --profondeur === 0) break;
    if (c === ',' && profondeur === 1) { args.push(courant.trim()); courant = ''; continue; }
    courant += c;
  }
  args.push(courant.trim());
  return args;
}

// Les gestes écrits en clair dans les migrations : la colonne `geste` de chaque `insert into plateforme.geste_console`.
function gestesDesMigrations(): { gestes: Set<string>; calcules: string[] } {
  const gestes = new Set<string>();
  const calcules: string[] = [];
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    const re = /insert into plateforme\.geste_console\s*\(([^)]*)\)\s*values\s*\(/g;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const colonne = (m[1] ?? '').split(',').map((c) => c.trim()).indexOf('geste');
      const valeur = argumentsDe(sql, re.lastIndex)[colonne] ?? '';
      if (/^'[^']*'$/.test(valeur)) gestes.add(valeur.slice(1, -1));
      else calcules.push(`${f} : ${valeur}`);
    }
  }
  return { gestes, calcules };
}

describe('les gestes du journal de la console', () => {
  const { gestes, calcules } = gestesDesMigrations();

  it('la lecture des migrations trouve les gestes (un instrument qui ne lit rien ne prouve rien)', () => {
    expect(gestes.size).toBeGreaterThanOrEqual(20);
    for (const g of ['equipe.ajouter', 'service.incident_ouvert', 'versions.revenir', 'reglages.relire']) expect(gestes).toContain(g);
    // Le seul geste calculé : celui d'un abonnement (« abonnement. » suivi du geste choisi, 0083).
    expect(calcules).toEqual([expect.stringMatching(/^0083_console\.sql : 'abonnement\.' \|\| p_geste$/)]);
  });

  it('chacun a la forme que la table exige (deux parties) : sinon le geste entier échoue', () => {
    const contrainte = fs.readFileSync(path.join(MIGRATIONS, '0083_console.sql'), 'utf8');
    expect(contrainte).toContain('geste text not null check (geste ~ \'^[a-z_]+\\.[a-z_-]+$\')');
    const fautifs = [...gestes].filter((g) => !/^[a-z_]+\.[a-z_-]+$/.test(g));
    expect(fautifs).toEqual([]);
  });

  it('chacun a son libellé dans l\'écran du journal (la clé que Journal.tsx lit)', () => {
    const journal = fs.readFileSync(path.join(RACINE, 'web/console/src/ecrans/Journal.tsx'), 'utf8');
    expect(journal).toContain('titre(`console.ecran.journal.g.${l.geste.replaceAll(\'-\', \'_\')}`)');
    const sansLibelle = [...gestes].filter((g) => !texteConnu(`console.ecran.journal.g.${g.replaceAll('-', '_')}`));
    expect(sansLibelle).toEqual([]);
  });
});
