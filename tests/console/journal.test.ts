// Chaque geste que la base écrit au journal de la console (plateforme.geste_console, 0083) : sa forme, que la table
// exige, et son libellé dans l'écran du journal. Trouvé le 13/10/2026 en écrivant un message aux clients à la souris :
// « reglages.message.ecrire » (trois parties) ne passait pas la contrainte de la table — le geste échouait en entier,
// et l'écran disait « Le serveur a rencontré une erreur ». Aucun test de route ne l'avait encore appelé ; celui-ci lit
// toutes les migrations, sans base.
//
// Et le journal de la console, pur (serveur/console/journal.ts ; 0114) : chaque geste qu'il sait dire a le geste de la console
// qui le permet ; « réservé à la direction » se lit dans la liste des gestes (jamais recopié) ; les périodes partent de
// minuit à Tunis.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GESTES_CONSOLE, LISTE_GESTES_CONSOLE } from '../../serveur/console/gestes.ts';
import { depuisLa, gesteDeLaConsole, plageDe, reserveALaDirection, sorteDe, SORTES } from '../../serveur/console/journal.ts';
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
  // L'export (0114) se calcule (« clients.exporte », « journal.exporte ») : ses deux gestes se vérifient comme les autres.
  for (const g of ['clients.exporte', 'journal.exporte']) gestes.add(g);
  // L'attente de la technique (0115) se pose ou se lève : « support.technique » ou « support.technique_levee ».
  for (const g of ['support.technique', 'support.technique_levee']) gestes.add(g);

  it('la lecture des migrations trouve les gestes (un instrument qui ne lit rien ne prouve rien)', () => {
    expect(gestes.size).toBeGreaterThanOrEqual(20);
    for (const g of ['equipe.ajouter', 'service.incident_ouvert', 'versions.revenir', 'reglages.relire']) expect(gestes).toContain(g);
    // Le seul geste calculé : celui d'un abonnement (« abonnement. » suivi du geste choisi, 0083), redéfini en 0099 avec
    // les modules achetés seuls (14c), puis en 0111 avec le délai, le mois offert et l'offre suivante, puis en 0113 avec
    // la preuve d'un paiement reçu et le mois offert du support.
    expect(calcules).toEqual([expect.stringMatching(/^0083_console\.sql : 'abonnement\.' \|\| p_geste$/),
      expect.stringMatching(/^0099_offre_compte\.sql : 'abonnement\.' \|\| p_geste$/),
      expect.stringMatching(/^0111_gestes_abonnement\.sql : 'abonnement\.' \|\| p_geste$/),
      expect.stringMatching(/^0113_argent_juste\.sql : 'abonnement\.' \|\| p_geste$/),
      // Et l'export (0114) : « clients.exporte » ou « journal.exporte », selon ce qui s'exporte.
      expect.stringMatching(/^0114_chiffres_justes\.sql : p_quoi \|\| '\.exporte'$/),
      // Et l'attente de la technique (0115), posée ou levée.
      expect.stringMatching(/^0115_suivi\.sql : case when p_attend then 'support\.technique' else 'support\.technique_levee' end$/)]);
  });

  it('chacun a la forme que la table exige (deux parties) : sinon le geste entier échoue', () => {
    const contrainte = fs.readFileSync(path.join(MIGRATIONS, '0083_console.sql'), 'utf8');
    expect(contrainte).toContain('geste text not null check (geste ~ \'^[a-z_]+\\.[a-z_-]+$\')');
    const fautifs = [...gestes].filter((g) => !/^[a-z_]+\.[a-z_-]+$/.test(g));
    expect(fautifs).toEqual([]);
  });

  it('chacun a son libellé dans l\'écran du journal (la clé que Journal.tsx lit)', () => {
    const journal = fs.readFileSync(path.join(RACINE, 'web/console/src/ecrans/Journal.tsx'), 'utf8');
    expect(journal).toContain('const J = \'console.ecran.journal\';');
    expect(journal).toContain('titre(`${J}.g.${l.geste.replaceAll(\'-\', \'_\')}`)');
    const sansLibelle = [...gestes].filter((g) => !texteConnu(`console.ecran.journal.g.${g.replaceAll('-', '_')}`));
    expect(sansLibelle).toEqual([]);
  });
});

// Les droits de la console (serveur/console/gestes.ts) : l'écran Équipe en fait une ligne chacun, avec son libellé et sa
// phrase. Un droit ajouté sans eux cassait le tableau entier (trouvé le 13/10/2026 : « console.reglages.voir » ajouté
// avec l'écran Réglages, et l'écran Équipe ne montrait plus aucun droit).
describe('les droits de la console, dans l\'écran Équipe', () => {
  it('chaque droit que la route rend a son libellé et sa phrase (les clés que Equipe.tsx lit)', () => {
    const equipe = fs.readFileSync(path.join(RACINE, 'web/console/src/ecrans/Equipe.tsx'), 'utf8');
    expect(equipe).toContain('titre(`console.ecran.equipe.droit.${d.code}`)');
    expect(equipe).toContain('phrase(`console.ecran.equipe.droit.${d.code}_sous`)');
    const droits = LISTE_GESTES_CONSOLE.filter((g) => g.code !== 'console.session');
    expect(droits.length).toBeGreaterThanOrEqual(12);
    const sansTexte = droits.flatMap((g) => [`console.ecran.equipe.droit.${g.code}`, `console.ecran.equipe.droit.${g.code}_sous`]).filter((k) => !texteConnu(k));
    expect(sansTexte).toEqual([]);
  });
});

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
