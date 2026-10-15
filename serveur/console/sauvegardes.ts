// Les sauvegardes du service (Console 3c ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 4 ; docs/console.md C14) : ce
// qu'on promet de pouvoir reprendre et ce que la mesure en dit, où sont les copies, nuit par nuit, la copie hors de la
// machine heure par heure, les exercices de restauration et les remises d'une entreprise. Pur (testé :
// tests/console/sauvegardes.test.ts) : la route lit la base et la veille, ces fonctions rangent. Trois règles :
//   - une promesse ne se dit tenue qu'avec une mesure ET une preuve faite sur ce serveur : sans exercice, elle est « à
//     prouver », jamais verte ;
//   - ce que la console ne peut pas voir (le verrou de la copie chez le fournisseur) se dit invérifiable d'ici ;
//   - la console ne touche jamais au serveur : un geste est une commande composée, à copier dans la console du serveur.

import { EXERCICE_TROP_VIEUX_J, HORS_MACHINE_EN_RETARD_MIN, HORS_MACHINE_GRAVE_MIN, SAUVEGARDE_TROP_VIEILLE_H } from '../../exploitation/veille.ts';
import { VEILLE_RECENTE_MIN } from './alertes.ts';

// ── Ce que 06 § 4.1 promet, écrit d'avance (en minutes) ──────────────────────────────────────────────────────────────
// « Un chiffre qui n'est pas tenu change le plan, pas le chiffre. »
export const PROMESSES = [
  { id: 'programme', perte: 0, retour: 1 },
  { id: 'base', perte: 1, retour: 60 },
  { id: 'site', perte: 5, retour: 240 },
  { id: 'entreprise', perte: 0, retour: 240 },
  { id: 'rancongiciel', perte: 1440, retour: 1440 },
] as const;
export type IdPromesse = typeof PROMESSES[number]['id'];

// Quand chaque copie se fait, en UTC (exploitation/taches/0001-sauvegardes.sh et 0008-archivage.sh : un test relit leurs
// lignes OnCalendar), et combien on en garde (sauvegarder.sh, copie-de-base.sh : un test relit leurs valeurs).
export const CALENDRIER = { sauvegarde: '02:30', copieDeBase: '02:45', exercice: { jourDuMois: 1, heure: '04:00' } } as const;
export const GARDE = { nuits: 14, jours: 35 } as const;
// Où vit le dépôt sur le serveur (docs/mise-en-ligne.md, A) : les commandes composées s'y réfèrent.
export const DEPOT = '/opt/skanfact/depot';

// ── Ce que la base rend (plateforme.console_service_sauvegardes), relu prudemment ──────────────────────────────────────
export type Resultat = { le: string; ok: boolean };
export type NuitLue = {
  jour: string;
  sauvegarde: (Resultat & { lignes: number | null; migrations: number | null }) | null;
  // `le` : la minute où la veille l'a vue arrivée (ok), ou celle où elle l'a vérifiée en dernier (pas encore).
  horsMachine: Resultat | null;
  copieDeBase: Resultat | null;
  restauration: (Resultat & { secondes: number | null; lignes: number | null; migrations: number | null }) | null;
};
export type CopiesLues = { minute: string; archiveLe: string | null; archivage: { enMarche: boolean } | null; horsMachine: { regle: boolean; attenteDepuis: string | null } | null };
// `preparee` : qui l'a préparée dans la console (le même client, le même motif, avant elle) ; null : faite sans la console.
// `secondes` : sa durée mesurée (0125 ; null : faite avant qu'elle se mesure, ou sans l'essai qui la mesure).
export type RemiseLue = { le: string; entreprise: string; nom: string; motif: string; minute: string | null; numerosRetires: number; secondes: number | null; preparee: { par: string; le: string } | null };
// La dernière remise qui a mesuré sa durée (0125, l'audit C11) : la seule qui peut prouver la promesse.
export type RemiseMesuree = { le: string; secondes: number; minute: string | null };
export type SauvegardesLues = {
  nuits: NuitLue[]; dernier: CopiesLues | null; retards: { heure: string; plusLong: number; lues: number }[];
  exemplaires: number; remisesFaites: { n: number; derniere: string | null; mesuree: RemiseMesuree | null }; remises: RemiseLue[] | null;
};

const texte = (x: unknown) => (typeof x === 'string' ? x : null);
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const entierOuNull = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const resultat = (x: unknown): Resultat | null => {
  const r = x as Record<string, unknown> | null;
  const le = date(r?.le);
  return r && le ? { le, ok: r.ok === true } : null;
};
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
// La minute d'une remise (« 2026-10-12 14:03 », heure de Tunis), ou rien.
const minuteLue = (x: unknown) => (texte(x) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(x)) ? String(x) : null);

export function lireSauvegardes(brut: unknown): SauvegardesLues {
  const b = (brut ?? {}) as Record<string, unknown>;
  const d = b.dernier as Record<string, unknown> | null;
  const c = d?.copies as Record<string, unknown> | null | undefined;
  const a = c?.archivage as Record<string, unknown> | null | undefined;
  const h = c?.horsMachine as Record<string, unknown> | null | undefined;
  const f = b.remisesFaites as Record<string, unknown> | null;
  return {
    nuits: tableau(b.nuits).flatMap((n) => {
      if (typeof n.jour !== 'string' || !JOUR.test(n.jour)) return [];
      const s = n.sauvegarde as Record<string, unknown> | null;
      const sr = resultat(s), r = resultat(n.restauration);
      const rr = n.restauration as Record<string, unknown> | null;
      return [{
        jour: n.jour,
        sauvegarde: sr ? { ...sr, lignes: entierOuNull(s?.lignes), migrations: entierOuNull(s?.migrations) } : null,
        horsMachine: sr ? resultat(s?.horsMachine) : null,
        copieDeBase: resultat(n.copieDeBase),
        restauration: r ? { ...r, secondes: entierOuNull(rr?.secondes), lignes: entierOuNull(rr?.lignes), migrations: entierOuNull(rr?.migrations) } : null,
      }];
    }).sort((x, y) => y.jour.localeCompare(x.jour)),
    dernier: d && date(d.minute) ? {
      minute: String(d.minute), archiveLe: date(d.archiveLe),
      archivage: a && typeof a.enMarche === 'boolean' ? { enMarche: a.enMarche } : null,
      horsMachine: h && typeof h.regle === 'boolean' ? { regle: h.regle, attenteDepuis: date(h.attenteDepuis) } : null,
    } : null,
    retards: (Array.isArray(b.retards) ? b.retards : []).flatMap((l: unknown) => {
      if (!Array.isArray(l) || !date(l[0])) return [];
      const p = entierOuNull(l[1]), n = entierOuNull(l[2]);
      return p === null || n === null ? [] : [{ heure: String(l[0]), plusLong: p, lues: n }];
    }),
    exemplaires: entierOuNull(b.exemplaires) ?? 0,
    remisesFaites: { n: entierOuNull(f?.n) ?? 0, derniere: date(f?.derniere), mesuree: ((m) => {
      const le = date(m?.le), secondes = entierOuNull(m?.secondes);
      return le && secondes !== null ? { le, secondes, minute: minuteLue(m?.minute) } : null;
    })(f?.mesuree as Record<string, unknown> | null) },
    remises: Array.isArray(b.remises) ? tableau(b.remises).flatMap((x) => (date(x.le) && typeof x.entreprise === 'string' ? [{
      le: String(x.le), entreprise: x.entreprise, nom: String(x.nom ?? ''), motif: String(x.motif ?? ''),
      minute: minuteLue(x.minute), numerosRetires: entierOuNull(x.numerosRetires) ?? 0, secondes: entierOuNull(x.secondes),
      preparee: ((p) => (p && typeof p.par === 'string' && date(p.le) ? { par: p.par, le: String(p.le) } : null))(x.preparee as Record<string, unknown> | null),
    }] : [])) : null,
  };
}

// ── Les instants ─────────────────────────────────────────────────────────────────────────────────────────────────────
const MIN = 60_000;
const minutesEntre = (de: string, a: Date) => Math.max(0, Math.round((a.getTime() - Date.parse(de)) / MIN));
// La copie hors de la machine, à un relevé : rien n'attend (0), ou depuis combien de minutes la plus vieille attend.
export function retardHorsMachine(c: CopiesLues | null): number | null {
  const h = c?.horsMachine;
  if (!c || !h?.regle) return null;
  return h.attenteDepuis ? minutesEntre(h.attenteDepuis, new Date(c.minute)) : 0;
}
// Le prochain exercice du mois (le 1er, à l'heure du minuteur), après maintenant.
export function prochainExercice(maintenant: Date): string {
  const [hh, mm] = CALENDRIER.exercice.heure.split(':').map(Number);
  const ce = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), CALENDRIER.exercice.jourDuMois, hh, mm));
  return (ce.getTime() > maintenant.getTime() ? ce : new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, CALENDRIER.exercice.jourDuMois, hh, mm))).toISOString();
}

// ── Les quatre chiffres ──────────────────────────────────────────────────────────────────────────────────────────────
export type Etat = 'bon' | 'attention' | 'grave' | 'nonmesure';
const derniereNuitAvec = <K extends 'sauvegarde' | 'copieDeBase' | 'restauration'>(l: SauvegardesLues, k: K) => l.nuits.find((n) => n[k]) ?? null;

// La dernière sauvegarde : faite et relue, ou ratée, ou trop vieille (la veille dit la même chose à 26 heures).
export function laSauvegarde(l: SauvegardesLues, maintenant: Date) {
  const n = derniereNuitAvec(l, 'sauvegarde');
  const s = n?.sauvegarde ?? null;
  if (!s) return { etat: 'nonmesure' as Etat, nuit: null };
  const vieille = maintenant.getTime() - Date.parse(s.le) > SAUVEGARDE_TROP_VIEILLE_H * 3_600_000;
  return { etat: (!s.ok || vieille ? 'grave' : 'bon') as Etat, nuit: n, vieille, le: s.le, ok: s.ok, lignes: s.lignes, migrations: s.migrations };
}

// Le dernier relevé de la veille, et s'il dit encore « maintenant » (l'audit C10) : plus vieux que cinq minutes (la veille
// relève chaque minute, comme pour les alertes), ce qu'il a lu de l'archivage et de la copie hors de la machine n'est plus
// l'état d'aujourd'hui — il se dit non mesuré, avec l'heure du relevé, et rien qui en dépend ne reste vert. L'heure du
// relevé n'est pas celle du dernier journal archivé : un serveur calme archive peu, et ce n'est pas une panne.
export function leReleve(l: SauvegardesLues, maintenant: Date) {
  const le = l.dernier?.minute ?? null;
  return { le, perime: le !== null && maintenant.getTime() - Date.parse(le) > VEILLE_RECENTE_MIN * MIN };
}

// L'archivage à la minute : en marche, et son dernier journal. Pas lu (la base ne répondait pas), ou lu par un relevé
// périmé : non mesuré.
export function lArchivage(l: SauvegardesLues, maintenant: Date) {
  const r = leReleve(l, maintenant);
  const a = r.perime ? null : l.dernier?.archivage ?? null;
  return { etat: (!a ? 'nonmesure' : a.enMarche ? 'bon' : 'grave') as Etat, enMarche: a?.enMarche ?? null, dernier: l.dernier?.archiveLe ?? null, releveLe: r.le, perime: r.perime };
}

// La copie hors de la machine : à jour, en retard (au quart d'heure, grave à l'heure : les seuils de la veille), ou pas
// réglée — rien ne sort, et c'est ce qu'on perdrait avec le site. Lue par un relevé périmé : non mesurée.
export function horsDeLaMachine(l: SauvegardesLues, maintenant: Date) {
  const r = leReleve(l, maintenant);
  const h = l.dernier?.horsMachine ?? null;
  if (!l.dernier || !h || r.perime) return { etat: 'nonmesure' as Etat, regle: null, retard: null, attenteDepuis: null, releveLe: r.le, perime: r.perime };
  if (!h.regle) return { etat: 'attention' as Etat, regle: false, retard: null, attenteDepuis: null, releveLe: r.le, perime: false };
  const x = retardHorsMachine(l.dernier) ?? 0;
  return { etat: (x > HORS_MACHINE_GRAVE_MIN ? 'grave' : x > HORS_MACHINE_EN_RETARD_MIN ? 'attention' : 'bon') as Etat, regle: true, retard: x, attenteDepuis: h.attenteDepuis, releveLe: r.le, perime: false };
}

// Les exercices de restauration, le plus récent d'abord, et le dernier : réussi et récent (35 jours, comme la veille),
// raté, ou trop vieux.
export function exercices(l: SauvegardesLues) {
  return l.nuits.flatMap((n) => (n.restauration ? [{ jour: n.jour, ...n.restauration }] : []));
}
export function leDernierExercice(l: SauvegardesLues, maintenant: Date) {
  const e = exercices(l)[0] ?? null;
  if (!e) return { etat: 'nonmesure' as Etat, exercice: null, prochain: prochainExercice(maintenant) };
  const vieux = maintenant.getTime() - Date.parse(e.le) > EXERCICE_TROP_VIEUX_J * 86_400_000;
  return { etat: (!e.ok ? 'grave' : vieux ? 'attention' : 'bon') as Etat, exercice: e, vieux, prochain: prochainExercice(maintenant) };
}

// ── Les promesses (06 § 4.1) ─────────────────────────────────────────────────────────────────────────────────────────
// tenue : la mesure d'aujourd'hui est dans la promesse, et un geste fait sur ce serveur l'a prouvée ; a_prouver : la
// mesure tient, rien ne l'a encore prouvée ; pas_tenue : la mesure dépasse, ou le moyen manque ; pas_encore : le moyen
// n'existe pas encore (un seul exemplaire, aucun site de secours) ; inverifiable : la console ne peut pas le voir.
export type EtatPromesse = 'tenue' | 'a_prouver' | 'pas_tenue' | 'pas_encore' | 'inverifiable';
// Le plus long retard de la copie hors de la machine sur les vingt-quatre dernières heures (null : rien de lu).
export function plusLongRetard(l: SauvegardesLues): number | null {
  const lus = l.retards.filter((r) => r.lues > 0);
  return lus.length ? Math.ceil(Math.max(...lus.map((r) => r.plusLong)) / 60) : null;
}
// Une entreprise revient en 4 h, sans rien perdre (l'audit C11) : « on l'a déjà fait » ne suffit pas. Tenue seulement par
// une remise faite sur ce serveur, récente (trois mois), dont la durée a été mesurée — de la base de la minute restaurée
// à côté jusqu'à la remise faite — sous la promesse, et revenue à une minute nommée (PostgreSQL ne s'ouvre pas avant de
// l'avoir atteinte : rien après elle n'est perdu). Trop lente : pas tenue. Sans durée, sans minute, ou trop vieille : à
// prouver, et la preuve dit pourquoi.
export const REMISE_PREUVE_J = 92;
export type PreuveRemise = { n: number; derniere: string | null; mesuree: RemiseMesuree | null; minutes: number | null; vieille: boolean };
export function laRemise(l: SauvegardesLues, maintenant: Date, retour: number): { etat: EtatPromesse; preuve: PreuveRemise } {
  const { n, derniere, mesuree: m } = l.remisesFaites;
  const minutes = m ? Math.ceil(m.secondes / 60) : null;
  const vieille = m !== null && maintenant.getTime() - Date.parse(m.le) > REMISE_PREUVE_J * 86_400_000;
  const preuve = { n, derniere, mesuree: m, minutes, vieille };
  if (!m || minutes === null || vieille) return { etat: 'a_prouver', preuve };
  if (minutes > retour) return { etat: 'pas_tenue', preuve };
  return { etat: m.minute ? 'tenue' : 'a_prouver', preuve };
}
export function promesses(l: SauvegardesLues, maintenant: Date) {
  const arch = lArchivage(l, maintenant), hors = horsDeLaMachine(l, maintenant), ex = leDernierExercice(l, maintenant);
  const objectif = (id: IdPromesse) => PROMESSES.find((p) => p.id === id) as typeof PROMESSES[number];
  const retard24 = plusLongRetard(l);
  const exerciceMinutes = ex.exercice?.secondes != null ? Math.ceil(ex.exercice.secondes / 60) : null;
  const base: EtatPromesse = arch.etat === 'grave' ? 'pas_tenue'
    : ex.etat === 'bon' && exerciceMinutes !== null && exerciceMinutes > objectif('base').retour ? 'pas_tenue'
      : arch.etat === 'bon' && ex.etat === 'bon' && exerciceMinutes !== null ? 'tenue' : 'a_prouver';
  const site: EtatPromesse = hors.regle === false ? 'pas_tenue'
    : retard24 !== null && retard24 > objectif('site').perte ? 'pas_tenue' : 'a_prouver';
  return [
    { ...objectif('programme'), id: 'programme' as const, etat: (l.exemplaires >= 2 ? 'a_prouver' : 'pas_encore') as EtatPromesse, mesure: { exemplaires: l.exemplaires } },
    { ...objectif('base'), id: 'base' as const, etat: base, mesure: { enMarche: arch.enMarche, dernier: arch.dernier, releveLe: arch.perime ? arch.releveLe : null }, preuve: ex.exercice ? { le: ex.exercice.le, ok: ex.exercice.ok, minutes: exerciceMinutes, vieux: ex.vieux ?? false } : null },
    { ...objectif('site'), id: 'site' as const, etat: site, mesure: { regle: hors.regle, retard: hors.retard, plusLong24h: retard24 } },
    { ...objectif('entreprise'), id: 'entreprise' as const, ...laRemise(l, maintenant, objectif('entreprise').retour) },
    { ...objectif('rancongiciel'), id: 'rancongiciel' as const, etat: (hors.regle === false ? 'pas_tenue' : 'inverifiable') as EtatPromesse, mesure: { regle: hors.regle } },
  ];
}

// ── Où sont les copies (06 § 4.2, la règle 3-2-1-1) ──────────────────────────────────────────────────────────────────
// Sur le serveur (la sauvegarde de la nuit, les copies de base et les journaux) ; hors de la machine ; au site de
// secours (il n'existe pas encore) ; l'intouchable (le verrou du stockage, réglé chez le fournisseur : invérifiable d'ici).
export type EtatCopie = 'en_place' | 'en_retard' | 'manque' | 'pas_encore' | 'inverifiable' | 'nonmesure';
export function copies(l: SauvegardesLues, maintenant: Date) {
  const s = laSauvegarde(l, maintenant), a = lArchivage(l, maintenant), h = horsDeLaMachine(l, maintenant);
  // « En place » dit la nuit faite ET l'archivage qui tourne : les deux mesurés maintenant, jamais l'un sans l'autre.
  const serveur: EtatCopie = s.etat === 'grave' || a.etat === 'grave' ? 'manque' : s.etat === 'bon' && a.etat === 'bon' ? 'en_place' : 'nonmesure';
  const hors: EtatCopie = h.etat === 'nonmesure' ? 'nonmesure' : h.regle === false ? 'manque' : h.etat === 'bon' ? 'en_place' : 'en_retard';
  // Le relevé périmé se dit sur les deux copies qu'il mesure (l'heure où la veille les a lues pour la dernière fois).
  const releve = a.perime ? a.releveLe : null;
  const liste = [
    { id: 'serveur' as const, etat: serveur, releveLe: serveur === 'nonmesure' ? releve : null },
    { id: 'hors_machine' as const, etat: hors, retard: h.retard, releveLe: hors === 'nonmesure' ? releve : null },
    { id: 'secours' as const, etat: 'pas_encore' as EtatCopie },
    { id: 'intouchable' as const, etat: (h.regle === false ? 'pas_encore' : 'inverifiable') as EtatCopie },
  ];
  return { liste, enPlace: liste.filter((c) => c.etat === 'en_place').length };
}

// ── Nuit par nuit ────────────────────────────────────────────────────────────────────────────────────────────────────
// La copie hors de la machine d'une nuit : arrivée (à la minute où la veille l'a vue), en attente, sans objet (la
// sauvegarde a échoué : rien n'est parti), ou pas réglée (la veille n'en a rien dit).
export type HorsDeLaNuit = 'arrivee' | 'en_attente' | 'sans_objet' | 'pas_reglee';
export function nuits(l: SauvegardesLues, combien: number) {
  return l.nuits.slice(0, combien).map((n) => ({
    ...n,
    hors: (n.sauvegarde?.ok === false ? 'sans_objet' : !n.horsMachine ? 'pas_reglee' : n.horsMachine.ok ? 'arrivee' : 'en_attente') as HorsDeLaNuit,
  }));
}
// Le pied du tableau : sur les nuits montrées, ce qui a été fait.
export function piedDesNuits(l: SauvegardesLues, combien: number) {
  const ns = nuits(l, combien);
  return {
    nuits: ns.length,
    sauvegardes: ns.filter((n) => n.sauvegarde?.ok).length,
    copiesDeBase: ns.filter((n) => n.copieDeBase?.ok).length,
    arrivees: ns.filter((n) => n.hors === 'arrivee').length,
    attendues: ns.filter((n) => n.hors === 'arrivee' || n.hors === 'en_attente').length,
  };
}
// La base, nuit par nuit : les lignes que la vérification de chaque sauvegarde a comptées (la plus ancienne d'abord).
export function lignesParNuit(l: SauvegardesLues, combien: number) {
  return l.nuits.slice(0, combien).filter((n) => n.sauvegarde?.ok && n.sauvegarde.lignes !== null)
    .map((n) => ({ jour: n.jour, lignes: n.sauvegarde?.lignes as number })).reverse();
}

// ── La copie hors de la machine, heure par heure ──────────────────────────────────────────────────────────────────────
// Les vingt-quatre dernières heures, chacune avec son plus long retard en minutes (null : rien de lu cette heure-là).
export function retardsParHeure(l: SauvegardesLues, maintenant: Date) {
  const fin = Math.floor(maintenant.getTime() / 3_600_000) * 3_600_000;
  const parHeure = new Map(l.retards.map((r) => [Date.parse(r.heure), r]));
  return Array.from({ length: 24 }, (_, i) => {
    const t = fin - (23 - i) * 3_600_000;
    const r = parHeure.get(t);
    return { heure: new Date(t).toISOString(), plusLong: r && r.lues > 0 ? Math.ceil(r.plusLong / 60) : null };
  });
}
// Le plus ancien point où l'on peut revenir : le début de la plus ancienne copie de base réussie que la veille a vue
// dans les trente-cinq jours (les plus anciennes s'effacent). Une copie que la veille n'a pas vue (avant elle) ne se
// promet pas : on dit moins que vrai plutôt que plus.
export function pointLePlusAncien(l: SauvegardesLues, maintenant: Date): string | null {
  const limite = maintenant.getTime() - GARDE.jours * 86_400_000;
  const ok = l.nuits.filter((n) => n.copieDeBase?.ok && Date.parse(n.copieDeBase.le) >= limite);
  // La plus vieille par son instant, jamais par le rang de sa nuit.
  return ok.reduce<string | null>((plus, n) => (plus === null || Date.parse(n.copieDeBase?.le ?? '') < Date.parse(plus) ? n.copieDeBase?.le ?? plus : plus), null);
}

// ── Les commandes à copier ───────────────────────────────────────────────────────────────────────────────────────────
// La console compose ce qu'on tape dans la console du serveur ; elle ne l'exécute jamais.
export const COMMANDES = {
  exercice: ['sudo systemctl start skanfact-restauration', 'sudo systemctl status skanfact-restauration'],
  copie: ['sudo systemctl start skanfact-hors-machine', 'sudo systemctl status skanfact-hors-machine'],
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
// Une chaîne entre apostrophes, pour le shell : rien ne s'y interprète, et une apostrophe se ferme, s'échappe, se rouvre.
export const entreApostrophes = (s: string) => `'${s.replaceAll('\'', '\'\\\'\'')}'`;
// La minute d'une remise, à l'heure de Tunis (UTC+1, sans heure d'été), en instant ; une date qui n'existe pas (le 31/02,
// 25:00) se refuse au lieu de glisser au jour suivant.
export function minuteDeTunis(m: string): Date | null {
  const x = MINUTE.exec(m);
  if (!x) return null;
  const [a, mo, j, h, mi] = x.slice(1).map(Number) as [number, number, number, number, number];
  const jour = new Date(Date.UTC(a, mo - 1, j));
  if (jour.getUTCFullYear() !== a || jour.getUTCMonth() !== mo - 1 || jour.getUTCDate() !== j || h > 23 || mi > 59) return null;
  return new Date(Date.UTC(a, mo - 1, j, h, mi) - 3_600_000);
}
// L'essai puis la remise d'UNE entreprise à une minute (exploitation/remettre-entreprise.sh) : l'entreprise par son
// identifiant, la minute (la dernière AVANT le dégât, dans ce qu'on peut reprendre, jamais dans le futur), le motif
// entre apostrophes (une ligne, pas de caractère de contrôle). Un refus nomme la case.
export function commandesRemise(x: { entreprise: string; minute: string; motif: string }, borne: { depuis: string | null; maintenant: Date }):
  { ok: true; essai: string; remise: string } | { ok: false; champ: 'entreprise' | 'minute' | 'motif'; raison: string } {
  if (!UUID.test(x.entreprise)) return { ok: false, champ: 'entreprise', raison: 'introuvable' };
  const t = minuteDeTunis(x.minute);
  if (!t) return { ok: false, champ: 'minute', raison: 'illisible' };
  if (t.getTime() >= borne.maintenant.getTime()) return { ok: false, champ: 'minute', raison: 'futur' };
  if (!borne.depuis || t.getTime() < Date.parse(borne.depuis)) return { ok: false, champ: 'minute', raison: 'trop_vieille' };
  const motif = x.motif.trim();
  // eslint-disable-next-line no-control-regex
  if (motif.length < 3 || motif.length > 300 || /[\u0000-\u001f\u007f]/.test(motif)) return { ok: false, champ: 'motif', raison: motif.length < 3 ? 'court' : 'illisible' };
  const essai = `sudo bash ${DEPOT}/exploitation/remettre-entreprise.sh ${x.entreprise} "${x.minute}" ${entreApostrophes(motif)}`;
  return { ok: true, essai, remise: `${essai} --remettre` };
}
