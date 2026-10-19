// La liste des clients, une ligne par organisation (la maquette Clients ; docs/console.md C32), pur : une entreprise
// seule, un groupe (ses sociétés ensemble), un dossier qu'un cabinet tient sans abonnement, un cabinet. Ce qu'une ligne
// dit vient de ses entreprises, lues par les fonctions de la liste (serveur/console/clients.ts) : une carte, une puce,
// un filtre comptent des lignes, par la fonction qui les filtre (C3).
//   - un groupe : un groupe que la console a déclaré (0106 : ses sociétés ce jour-là), ou une organisation « groupe » de
//     plusieurs entreprises ; il prend l'état le plus urgent de ses sociétés ;
//   - un dossier tenu : une entreprise qu'un cabinet tient, sans abonnement à elle ;
//   - un cabinet : son nom, ses collaborateurs, ses dossiers ; pas d'échéance.

import { cabinetDe, dansLaVue, deLOffre, parAn, VUES_CLIENTS, type Filtres, type OffreClient, type VueClients } from './clients.ts';
import { urgence, type Entreprise } from './decider.ts';
import type { Renouvellements } from './renouvellements.ts';
import type { LigneCabinet } from './cabinets.ts';
import { versTexte } from '../../moteur/argent.ts';

export type Sorte = 'entreprise' | 'groupe' | 'tenu' | 'cabinet';
export type Identite = { numero: string | null; ville: string | null };
export type GroupeConsole = { numero: string | null; nom: string; membres: string[] };
export type Organisation = {
  // L'identifiant de la ligne : l'entreprise (seule, tenue), le groupe, l'organisation du cabinet.
  id: string; sorte: Sorte; numero: string | null; nom: string; ville: string | null;
  // Ses entreprises, la plus urgente d'abord (aucune pour un cabinet).
  societes: Entreprise[];
  cabinet: LigneCabinet | null;
};

// Ce qu'une ligne dit d'elle-même, calculé une fois et gardé avec elle (l'audit 1.42.0 A09 ; C65) : une ligne naît du
// calcul de la liste que l'équipe partage, et ne change plus jamais ; chaque page, chaque recherche, chaque carte relit ce
// qu'elle a déjà dit au lieu de le recalculer pour les 5 000 lignes. Ce qui dépend du jour, d'une table de la demande (les
// renouvellements, les identités) se garde avec elle, et se refait si on la lui change.
function garde<A, V>(f: (o: Organisation, a: A) => V): (o: Organisation, a: A) => V {
  const m = new WeakMap<Organisation, { a: A; v: V }>();
  return (o, a) => {
    const x = m.get(o);
    if (x && x.a === a) return x.v;
    const v = f(o, a);
    m.set(o, { a, v });
    return v;
  };
}

// Les sociétés d'une ligne, la plus urgente d'abord, par l'urgence de la liste (serveur/console/decider.ts) : une grâce qui
// finit demain passe devant une lecture seule tombée il y a un mois. La ligne d'un groupe prend l'état de la première.
export function rangerSocietes(liste: readonly Entreprise[], jour: string): Entreprise[] {
  return [...liste].sort((a, b) => {
    const [ua, ja] = urgence(a, jour), [ub, jb] = urgence(b, jour);
    return ua - ub || ja - jb || a.raisonSociale.localeCompare(b.raisonSociale, 'fr', { sensitivity: 'base' });
  });
}
const tenue = (e: Entreprise) => e.etat.etat === 'hors' && e.etat.raison === 'tenu_par_cabinet';

// Les lignes : les groupes de la console d'abord (une société n'est que dans un groupe à la fois), puis les
// organisations « groupe » de plusieurs entreprises, puis chaque entreprise restante, puis les cabinets.
export function organisations(entreprises: readonly Entreprise[], jour: string, identites: ReadonlyMap<string, Identite>,
  groupes: ReadonlyMap<string, GroupeConsole>, cabinets: readonly LigneCabinet[], numerosCabinets: ReadonlyMap<string, string>): Organisation[] {
  const parId = new Map(entreprises.map((e) => [e.id, e]));
  const prises = new Set<string>();
  const out: Organisation[] = [];
  for (const [id, g] of groupes) {
    const societes = g.membres.map((m) => parId.get(m)).filter((e): e is Entreprise => !!e && !prises.has(e.id));
    if (!societes.length) continue;
    societes.forEach((e) => prises.add(e.id));
    const villes = [...new Set(societes.map((e) => identites.get(e.id)?.ville).filter((v): v is string => !!v))];
    out.push({ id, sorte: 'groupe', numero: g.numero, nom: g.nom, ville: villes.length === 1 ? villes[0] ?? null : null, societes: rangerSocietes(societes, jour), cabinet: null });
  }
  const parOrganisation = new Map<string, Entreprise[]>();
  for (const e of entreprises) {
    if (prises.has(e.id) || e.organisation.type !== 'groupe') continue;
    parOrganisation.set(e.organisation.id, [...(parOrganisation.get(e.organisation.id) ?? []), e]);
  }
  for (const [id, societes] of parOrganisation) {
    if (societes.length < 2) continue;
    societes.forEach((e) => prises.add(e.id));
    out.push({ id, sorte: 'groupe', numero: null, nom: societes[0]?.organisation.nom ?? '', ville: null, societes: rangerSocietes(societes, jour), cabinet: null });
  }
  for (const e of entreprises) {
    if (prises.has(e.id)) continue;
    const i = identites.get(e.id);
    out.push({ id: e.id, sorte: tenue(e) ? 'tenu' : 'entreprise', numero: i?.numero ?? null, nom: e.raisonSociale, ville: i?.ville ?? null, societes: [e], cabinet: null });
  }
  for (const c of cabinets) out.push({ id: c.id, sorte: 'cabinet', numero: numerosCabinets.get(c.id) ?? null, nom: c.nom, ville: null, societes: [], cabinet: c });
  return out;
}

// L'état d'une ligne : celui de sa société la plus urgente ; un cabinet n'a pas d'échéance.
export const principale = (o: Organisation): Entreprise | null => o.societes[0] ?? null;
export const categorieOrg = (o: Organisation) => principale(o)?.etat.etat ?? 'hors';

// Une vue du métier garde une ligne quand UNE de ses sociétés y est (un groupe dont une société attend son paiement est
// de « l'argent attendu ») ; les tenus à convertir sont les lignes de dossiers tenus ; un cabinet n'est que dans « tout ».
const vuesDeLaLigne = garde((o: Organisation, jour: string): ReadonlySet<VueClients> => new Set(VUES_CLIENTS.filter((v) => {
  if (v === 'tout') return true;
  if (o.sorte === 'cabinet') return false;
  if (v === 'tenus') return o.sorte === 'tenu';
  return o.societes.some((e) => dansLaVue(e, v, jour));
})));
export const orgDansLaVue = (o: Organisation, v: VueClients, jour: string): boolean => vuesDeLaLigne(o, jour).has(v);

// Les filtres de la ligne d'outils, sur des lignes : le type de ligne, l'offre d'une de ses sociétés, le cabinet qui
// suit une de ses sociétés (ou le cabinet lui-même) ; « aucun cabinet » : ni l'un ni l'autre.
export type TypeOrg = 'seules' | 'groupes' | 'tenues' | 'cabinets';
export const TYPES_ORG: readonly TypeOrg[] = ['seules', 'groupes', 'tenues', 'cabinets'];
const SORTE_DU_TYPE: Record<TypeOrg, Sorte> = { seules: 'entreprise', groupes: 'groupe', tenues: 'tenu', cabinets: 'cabinet' };
export const SANS_CABINET = '__aucun';
export type FiltresOrg = Omit<Filtres, 'type'> & { type: TypeOrg | null };
export function lireFiltresOrg(q: Record<string, unknown>): FiltresOrg {
  const type = TYPES_ORG.includes(q.type as TypeOrg) ? q.type as TypeOrg : null;
  const offre = (['essentiel', 'complet', 'aucune'] as const).includes(q.offre as OffreClient) ? q.offre as OffreClient : null;
  const cabinet = typeof q.cabinet === 'string' && q.cabinet.trim() !== '' ? q.cabinet.trim().slice(0, 200) : null;
  return { type, offre, cabinet };
}
export const orgDuType = (o: Organisation, t: TypeOrg) => o.sorte === SORTE_DU_TYPE[t];
export const orgDeLOffre = (o: Organisation, f: OffreClient) => o.sorte !== 'cabinet' && o.societes.some((e) => deLOffre(e, f));
const lesCabinets = garde((o: Organisation): string[] =>
  o.sorte === 'cabinet' ? [o.nom] : [...new Set(o.societes.map(cabinetDe).filter((c): c is string => c !== null))]);
export const cabinetsDeLaLigne = (o: Organisation): string[] => lesCabinets(o, null);
const duCabinet = (o: Organisation, c: string) => (c === SANS_CABINET ? cabinetsDeLaLigne(o).length === 0 : cabinetsDeLaLigne(o).includes(c));
export const orgDansLesFiltres = (o: Organisation, f: FiltresOrg) =>
  (!f.type || orgDuType(o, f.type)) && (!f.offre || orgDeLOffre(o, f.offre)) && (!f.cabinet || duCabinet(o, f.cabinet));

const NOMS = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export function optionsDesFiltresOrg(liste: readonly Organisation[], f: FiltresOrg) {
  const sans = (k: keyof FiltresOrg) => liste.filter((o) => orgDansLesFiltres(o, { ...f, [k]: null }));
  const lt = sans('type'), lo = sans('offre'), lc = sans('cabinet');
  // Chaque cabinet compté en un passage : une ligne compte pour chacun des siens (duCabinet), « aucun » pour celles qui
  // n'en ont pas — le même compte que la liste filtrée qu'il ouvre, sans la refiltrer pour chaque cabinet.
  const parCabinet = new Map<string, number>();
  let sansCabinet = 0;
  for (const o of lc) {
    const cs = cabinetsDeLaLigne(o);
    if (!cs.length) sansCabinet++;
    for (const c of cs) parCabinet.set(c, (parCabinet.get(c) ?? 0) + 1);
  }
  const noms = [...parCabinet.keys()].sort(NOMS.compare);
  return {
    type: Object.fromEntries(TYPES_ORG.map((t) => [t, lt.filter((o) => orgDuType(o, t)).length])) as Record<TypeOrg, number>,
    offre: Object.fromEntries((['essentiel', 'complet', 'aucune'] as const).map((x) => [x, lo.filter((o) => orgDeLOffre(o, x)).length])) as Record<OffreClient, number>,
    cabinet: noms.map((nom) => ({ nom, n: parCabinet.get(nom) ?? 0 })),
    sansCabinet,
  };
}

// Chercher : le nom, le numéro et la ville de la ligne, et de chacune de ses sociétés le nom, le matricule, le numéro,
// la propriétaire (nom, adresse), le cabinet ; d'un cabinet, ses associés. Sans accents ni casse.
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const champDeLaLigne = garde((o: Organisation, identites: ReadonlyMap<string, Identite>) => plier([o.nom, o.numero ?? '', o.ville ?? '',
  ...o.societes.flatMap((e) => [e.raisonSociale, e.matricule ?? '', identites.get(e.id)?.numero ?? '', identites.get(e.id)?.ville ?? '',
    e.organisation.nom, e.proprietaire?.nom ?? '', e.proprietaire?.email ?? '', e.tenuePar ?? '']),
  ...(o.cabinet?.associes.flatMap((a) => [a.nom, a.email]) ?? [])].join(' ')));
export function chercherOrg(liste: readonly Organisation[], texte: string, identites: ReadonlyMap<string, Identite>): Organisation[] {
  const mots = plier(texte).split(/\s+/).filter(Boolean);
  if (!mots.length) return [...liste];
  return liste.filter((o) => {
    const champ = champDeLaLigne(o, identites);
    return mots.every((m) => champ.includes(m));
  });
}

// L'ordre : le plus urgent d'abord (la société la plus urgente de chaque ligne ; les cabinets, sans échéance, en bas) ;
// les autres ordres sur ce que la ligne dit, ce qui n'a pas de valeur toujours en bas, l'urgence pour départager.
export type TriOrg = 'urgence' | 'echeance' | 'par_an' | 'usage' | 'nom' | 'vu';
const echeanceDeLigne = (o: Organisation): string | null => {
  const e = principale(o);
  if (!e || e.etat.etat === 'lecture_seule') return null;
  const s = e.etat;
  return s.etat === 'essai' || s.etat === 'actif' ? s.jusquAu : s.etat === 'en_retard' ? s.lectureSeuleLe : null;
};
// Ce que la ligne rapporte par an : ses abonnements actifs (et leur nombre), ce qui est attendu.
const parAnGarde = garde((o: Organisation, r: Renouvellements) => {
  let actif = 0n, attendu = 0n, abonnements = 0;
  for (const e of o.societes) {
    const p = parAn(e, r);
    if (!p) continue;
    const m = BigInt(p.montantHt.replace('.', ''));
    if (p.attendu) attendu += m; else { actif += m; abonnements++; }
  }
  return { actif, attendu, abonnements };
});
export function parAnDeLaLigne(o: Organisation, r: Renouvellements): { actif: bigint; attendu: bigint } {
  const { actif, attendu } = parAnGarde(o, r);
  return { actif, attendu };
}
export const usageDeLaLigne = (o: Organisation) => o.societes.reduce((n, e) => n + (e.enPlus?.piecesMois ?? 0), 0);
export const vuDeLaLigne = (o: Organisation): string | null => {
  const v = [...o.societes.map((e) => e.derniereActivite), o.cabinet?.derniereActivite ?? null].filter((x): x is string => !!x).map((x) => new Date(x).toISOString());
  return v.length ? v.sort().at(-1) ?? null : null;
};
const urgenceDeLaLigne = garde((o: Organisation, jour: string): [number, number] => { const e = principale(o); return e ? urgence(e, jour) : [9, 0]; });
const parUrgence = (liste: readonly Organisation[], jour: string) => [...liste].sort((a, b) => {
  const [ra, ja] = urgenceDeLaLigne(a, jour), [rb, jb] = urgenceDeLaLigne(b, jour);
  return ra - rb || ja - jb || NOMS.compare(a.nom, b.nom);
});
// Le rang d'urgence de chaque ligne de TOUTE la liste, fait une fois par calcul partagé (C65) : une sélection (une
// recherche, un filtre, une vue) garde l'ordre de l'ensemble — le tri est stable, et départage par le nom puis par la place
// dans la liste —, elle se range donc par ces rangs sans refaire les comparaisons.
const rangsDeLaListe = new WeakMap<readonly Organisation[], { jour: string; rangs: ReadonlyMap<Organisation, number> }>();
export function rangsDUrgence(toutes: readonly Organisation[], jour: string): ReadonlyMap<Organisation, number> {
  const x = rangsDeLaListe.get(toutes);
  if (x && x.jour === jour) return x.rangs;
  const rangs = new Map(parUrgence(toutes, jour).map((o, i) => [o, i]));
  rangsDeLaListe.set(toutes, { jour, rangs });
  return rangs;
}
export function trierOrg(liste: readonly Organisation[], tri: TriOrg, r: Renouvellements, jour: string, rangs: ReadonlyMap<Organisation, number> | null = null): Organisation[] {
  const rangees = rangs && liste.every((o) => rangs.has(o))
    ? [...liste].sort((a, b) => (rangs.get(a) ?? 0) - (rangs.get(b) ?? 0)) : parUrgence(liste, jour);
  if (tri === 'urgence') return rangees;
  const cle = (o: Organisation): string | bigint | null => {
    switch (tri) {
      case 'echeance': return echeanceDeLigne(o);
      case 'par_an': { const p = parAnDeLaLigne(o, r); return p.actif + p.attendu || null; }
      case 'usage': return BigInt(usageDeLaLigne(o));
      case 'nom': return o.nom;
      case 'vu': return vuDeLaLigne(o);
    }
  };
  const sens = tri === 'echeance' || tri === 'nom' ? 1 : -1;
  return rangees.map((o, i) => ({ o, i, k: cle(o) })).sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
    const c = typeof a.k === 'bigint' && typeof b.k === 'bigint' ? (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)
      : tri === 'nom' ? NOMS.compare(String(a.k), String(b.k)) : String(a.k) < String(b.k) ? -1 : String(a.k) > String(b.k) ? 1 : 0;
    return c * sens || a.i - b.i;
  }).map((x) => x.o);
}
// Ce que rapportent par an les abonnements actifs de la sélection (sur toutes ses pages).
export function parAnDesLignes(liste: readonly Organisation[], r: Renouvellements): { montantHt: string; abonnements: number } {
  let total = 0n, abonnements = 0;
  for (const o of liste) {
    const p = parAnGarde(o, r);
    total += p.actif;
    abonnements += p.abonnements;
  }
  return { montantHt: versTexte(total, 3), abonnements };
}
