// Le déplacement à l'identique (docs/cadrage/17-rangement.md § 5 et § 6 ; outil du lot R0b, 03/11/2026, pour les lots A).
// Un plan coupe un fichier servi en morceaux, par lignes, chacun rangé sous modules/<module>/ ; l'outil, d'un seul geste :
//   1. exige un contrôle des frontières vert, et écrit sa liste (son empreinte : les écrans d'avant) ;
//   2. écrit les morceaux et la table (modules/assemblage.json), retire l'ancien fichier, et vérifie que chaque fichier
//      servi est, à l'octet, celui d'avant ;
//   3. fait suivre chaque preuve (outils/rangement/preuves.ts) : elle vise le morceau qui porte son motif, réécrite à la
//      ligne de son appel dans tests/preuves.sh ; chaque preuve suivie pose le même défaut qu'avant (l'équivalence) ;
//   4. inscrit les écarts que le déplacement révèle (le contrôle des frontières, --deplacement), sans aucune coupe au
//      milieu d'une instruction, aucun nom introuvable, en double ni lu trop tôt.
// Au moindre refus, rien n'est écrit : chaque fichier touché reprend son contenu d'avant.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblerOctets, lireTable, PUBLIC, RACINE_DU_DEPOT, type Table } from '../../commun/assemblage.ts';
import { comparer, CONNUS, ecrireConnus, lireConnus, mesurer } from './frontieres.ts';
import { equivalente, etatDuDepot, FAMILLES, lirePreuves, reecrire, suivre } from './preuves.ts';

// Pour chaque fichier servi, ses morceaux dans l'ordre : chacun prend les lignes jusqu'à `jusqua` (comprise, comptée
// dans le fichier servi d'avant) ; le dernier va jusqu'au bout.
export type Plan = Record<string, { morceau: string; jusqua?: number }[]>;
export type Bilan = { refus: string[]; morceaux: string[]; preuves: number; ecartsInscrits: number };

const TABLE = 'modules/assemblage.json';
const PREUVES = 'tests/preuves.sh';

export function deplacer(plan: Plan, racine = RACINE_DU_DEPOT): Bilan {
  const refus: string[] = [];
  const bilan = (r: string[], extra: Partial<Bilan> = {}): Bilan => ({ refus: r, morceaux: [], preuves: 0, ecartsInscrits: 0, ...extra });
  // Ce qui sera touché, gardé pour tout remettre au moindre refus.
  const gardes = new Map<string, string | null>();
  const garder = (f: string) => { if (!gardes.has(f)) { const p = path.join(racine, f); gardes.set(f, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null); } };
  const remettre = () => {
    for (const [f, t] of gardes) {
      const p = path.join(racine, f);
      if (t === null) fs.rmSync(p, { force: true }); else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); }
    }
  };
  const ecrire = (f: string, t: string) => { garder(f); fs.mkdirSync(path.dirname(path.join(racine, f)), { recursive: true }); fs.writeFileSync(path.join(racine, f), t); };

  // 1. Le contrôle des frontières, vert avant de commencer.
  const avantMesure = comparer(mesurer(racine), lireConnus(racine));
  if (avantMesure.length) return bilan([`Le contrôle des frontières doit être vert avant un déplacement :\n- ${avantMesure.join('\n- ')}`]);
  garder(CONNUS);
  const liste = ecrireConnus(racine);
  if (liste.refus.length) return bilan(liste.refus);

  // 2. Les morceaux. L'état d'avant est figé d'abord : les preuves, et chaque fichier qu'elles visent ou que leur
  // famille assemble, lus avant toute écriture.
  const preuves = lirePreuves(racine);
  const avant = etatDuDepot(racine);
  const tableAvant = lireTable(racine);
  for (const p of preuves) for (const r of p.retouches) avant.lire(r.fichier);
  for (const servi of Object.values(FAMILLES).flat()) for (const m of tableAvant[servi] ?? [`${PUBLIC}/${servi}`]) avant.lire(m);
  const table: Table = { ...tableAvant };
  const textesServis = new Map<string, string>();
  const nouveaux: string[] = [];
  for (const [servi, coupes] of Object.entries(plan)) {
    const texte = assemblerOctets(servi, racine).toString('utf8');
    textesServis.set(servi, texte);
    const lignes = texte.split('\n');
    const total = lignes.length - (texte.endsWith('\n') ? 1 : 0);
    let debut = 0;
    const morceauxDuServi: string[] = [];
    coupes.forEach((c, i) => {
      const dernier = i === coupes.length - 1;
      if (!c.morceau.startsWith('modules/') || !/\.(js|css)$/.test(c.morceau) || c.morceau.includes('..')) refus.push(`« ${c.morceau} » : un morceau se range sous modules/<module>/, en .js ou .css.`);
      if (dernier !== (c.jusqua === undefined)) refus.push(`« ${servi} » : seul le dernier morceau va jusqu'au bout (sans « jusqua ») ; « ${c.morceau} » ${dernier ? 'en a un' : 'n\'en a pas'}.`);
      const fin = dernier ? total : c.jusqua ?? 0;
      if (!Number.isInteger(fin) || fin <= debut || fin > total) { refus.push(`« ${servi} » : la coupe « jusqua ${c.jusqua} » de « ${c.morceau} » doit tomber après la ligne ${debut} et au plus à la ligne ${total}.`); return; }
      const partie = lignes.slice(debut, fin).join('\n') + (fin < total || texte.endsWith('\n') ? '\n' : '');
      if (nouveaux.includes(c.morceau) || Object.values(tableAvant).flat().includes(c.morceau)) refus.push(`« ${c.morceau} » est déjà un morceau.`);
      else if (fs.existsSync(path.join(racine, c.morceau))) refus.push(`« ${c.morceau} » existe déjà dans le dépôt.`);
      nouveaux.push(c.morceau);
      morceauxDuServi.push(c.morceau);
      if (!refus.length) ecrire(c.morceau, partie);
      debut = fin;
    });
    table[servi] = morceauxDuServi;
  }
  if (refus.length) { remettre(); return bilan(refus); }
  // La table, puis les anciens morceaux qui ne servent plus (l'ancien fichier sous web/public, une copie morte sinon).
  garder(TABLE);
  const brut = fs.existsSync(path.join(racine, TABLE)) ? JSON.parse(fs.readFileSync(path.join(racine, TABLE), 'utf8')) as Record<string, unknown> : {};
  ecrire(TABLE, enTable(brut, table));
  for (const servi of Object.keys(plan)) {
    for (const ancien of tableAvant[servi] ?? [`${PUBLIC}/${servi}`]) {
      if (Object.values(table).flat().includes(ancien)) continue;
      garder(ancien);
      fs.rmSync(path.join(racine, ancien), { force: true });
    }
  }
  for (const [servi, texte] of textesServis) {
    if (assemblerOctets(servi, racine).toString('utf8') !== texte) refus.push(`« ${servi} » n'est plus le même, à l'octet, une fois assemblé.`);
  }
  if (refus.length) { remettre(); return bilan(refus); }

  // 3. Les preuves suivent.
  const apres = etatDuDepot(racine);
  const { suivis, refus: perdues } = suivre(preuves, avant, apres, Object.keys(plan));
  refus.push(...perdues);
  for (const s of suivis) if (!equivalente(s, avant, apres)) refus.push(`Preuve « ${s.preuve.nom} » : suivie dans ${s.fichier}, elle ne poserait pas le même défaut qu'avant (l'équivalence).`);
  if (refus.length) { remettre(); return bilan(refus); }
  garder(PREUVES);
  const reecrit = reecrire(fs.readFileSync(path.join(racine, PREUVES), 'utf8'), suivis);
  if (reecrit.refus.length) { remettre(); return bilan(reecrit.refus); }
  ecrire(PREUVES, reecrit.texte);
  // Relues : chaque preuve suivie vise son morceau, les autres n'ont pas bougé.
  const relues = lirePreuves(racine);
  const attendu = new Map(suivis.map((s) => [`${s.preuve.ligne}\0${s.preuve.nom}`, s.fichier]));
  if (relues.length !== preuves.length) refus.push(`tests/preuves.sh relu : ${relues.length} preuves au lieu de ${preuves.length}.`);
  relues.forEach((p, i) => {
    const voulu = attendu.get(`${p.ligne}\0${p.nom}`) ?? preuves[i]?.fichier;
    if (p.fichier !== voulu) refus.push(`Preuve « ${p.nom} » relue : elle vise « ${p.fichier} » au lieu de « ${voulu} ».`);
  });
  if (refus.length) { remettre(); return bilan(refus); }

  // 4. Les écarts révélés, inscrits ; jamais une coupe au milieu d'une instruction ni un nom perdu.
  const inscrits = ecrireConnus(racine, { deplacement: true });
  if (inscrits.refus.length) { remettre(); return bilan(inscrits.refus); }
  const avantEcarts = Object.values(liste.connus.ecarts).reduce((s, n) => s + n, 0);
  return { refus: [], morceaux: nouveaux, preuves: suivis.length, ecartsInscrits: Object.values(inscrits.connus.ecarts).reduce((s, n) => s + n, 0) - avantEcarts };
}

// La table, écrite comme elle l'est à la main : une ligne par fichier servi (seules les lignes des fichiers déplacés
// changent ; une preuve qui vise une autre ligne garde son motif).
export function enTable(brut: Record<string, unknown>, table: Table): string {
  const autres = Object.entries(brut).filter(([k]) => k !== 'fichiers').map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const lignes = Object.entries(table).map(([servi, liste]) => `    ${JSON.stringify(servi)}: [${liste.map((m) => JSON.stringify(m)).join(', ')}]`);
  return `{\n${[...autres, `  "fichiers": {\n${lignes.join(',\n')}\n  }`].join(',\n')}\n}\n`;
}

// node outils/rangement/deplacer.ts PLAN.json
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fichier = process.argv[2];
  if (!fichier) { console.error('usage : node outils/rangement/deplacer.ts PLAN.json'); process.exit(2); }
  const b = deplacer(JSON.parse(fs.readFileSync(fichier, 'utf8')) as Plan);
  if (b.refus.length) { console.error(`Rien n'est déplacé :\n- ${b.refus.join('\n- ')}`); process.exit(1); }
  console.log(`Déplacé : ${b.morceaux.length} morceaux, ${b.preuves} preuves suivies, ${b.ecartsInscrits} écarts inscrits.`);
}
