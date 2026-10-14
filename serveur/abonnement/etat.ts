// L'état d'un abonnement (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md, 10-console.md § 2.4) :
// DÉDUIT des faits (base/migrations/0082_abonnement.sql) et du jour qu'il est à Tunis, à chaque lecture. Un état écrit
// se périmerait à minuit. Pur : la porte, l'écran, les relances et l'outil de l'exploitation le lisent tous ici.
//
//   essai          l'essai court (sa durée se fixe à la création de l'entreprise, tout ouvert, sans carte) ;
//   actif          une période payée court ;
//   en_retard      l'échéance est passée : les jours de grâce, pendant lesquels tout marche encore (07) ;
//   lecture_seule  ensuite : tout se lit, s'imprime et s'exporte, rien de nouveau ne se crée. Jamais de données en
//                  otage (6.4.0) ;
//   hors           pas d'échéance du tout : l'entreprise d'essai d'un développeur (le bac à sable), un dossier tenu par
//                  un cabinet (c'est le cabinet qui paie ce dossier, 07), un abonnement offert, une entreprise sans
//                  ligne (rien ne se ferme jamais sur ce qu'on ne connaît pas).
//
// Une résiliation va au bout de ce qui est payé, puis la lecture seule, sans grâce. Une suspension (la console) met en
// lecture seule tout de suite.
//
// La durée de l'essai, la grâce et les relances sont des règles datées que la direction pose dans la console (0104 ;
// docs/abonnement.md C15) : jamais un nombre écrit ici. La base fixe l'essai à la création de l'entreprise ; les faits
// portent l'histoire de la grâce et des relances, et l'état prend celle qui vaut : la grâce d'une échéance est celle de
// son lendemain (une grâce commencée ne change plus), les relances d'un jour celles de ce jour-là.

export type Offre = 'essentiel' | 'complet';
export type Periodicite = 'annuel' | 'mensuel';
// Les modules achetés seuls sur Essentiel (14c ; 0099) : la paie, la comptabilité complète.
export type ModuleAchete = 'paie' | 'compta';
export type Faits = {
  connu: boolean;
  essaiJusquAu: string | null;
  payeJusquAu: string | null;
  offre: Offre | null;
  periodicite: Periodicite | null;
  resilieLe: string | null;
  suspenduLe: string | null;
  offert: boolean;
  bacASable: boolean;
  tenuParCabinet: boolean;
  modules?: readonly ModuleAchete[];
  regles: Regles;
  // Ce que chaque offre contient des modules qui s'achètent seuls (0105), daté : 1 compris, 0 non. Absent : inconnu,
  // et rien ne se ferme sur ce qu'on ne connaît pas.
  contenu?: ContenuDesOffres;
};
export type ContenuDesOffres = Partial<Record<Offre, Partial<Record<ModuleAchete, RegleDatee[]>>>>;

// Une règle datée : les jours qu'elle dit, à partir de son jour. L'histoire d'une règle va de la plus ancienne à la plus
// récente ; celle d'un jour est la dernière qui vaut ce jour-là. Aucune : la règle est inconnue, et rien ne se ferme sur
// ce qu'on ne connaît pas.
export type RegleDatee = { aPartirDu: string; jours: number[] };
export type Regles = { grace: RegleDatee[]; relances: RegleDatee[] };
export function regleAu(histoire: readonly RegleDatee[], jour: string): number[] | null {
  let r: number[] | null = null;
  for (const x of histoire) if (x.aPartirDu <= jour) r = x.jours;
  return r;
}
// La grâce d'une échéance : la règle de son lendemain, son premier jour.
export const graceDe = (f: Faits, echeance: string): number | null => regleAu(f.regles.grace, plusJours(echeance, 1))?.[0] ?? null;
// Les relances d'un jour, en jours avant l'échéance, de la plus lointaine à la plus proche.
export const relancesDu = (f: Faits, jour: string): number[] => [...(regleAu(f.regles.relances, jour) ?? [])].sort((a, b) => b - a);

export type Etat =
  | { etat: 'hors'; raison: 'bac_a_sable' | 'tenu_par_cabinet' | 'offert' | 'inconnu' }
  | { etat: 'essai'; jusquAu: string; jours: number }
  | { etat: 'actif'; offre: Offre; periodicite: Periodicite; jusquAu: string; jours: number; resilie: boolean }
  | { etat: 'en_retard'; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { etat: 'lecture_seule'; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' };

// Une relance se nomme par ses jours avant l'échéance (« j15 », « j1 ») ; la dernière, par la lecture seule.
export type Rang = `j${number}` | 'lecture_seule';
export const joursDuRang = (r: string): number | null => (/^j[1-9]\d?$/.test(r) ? Number(r.slice(1)) : null);

// ── Les jours de calendrier, en UTC pur (une date est un jour, jamais un instant) ───────────────────────────────────────
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const versMs = (j: string) => Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10)));
const versJour = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const estJour = (v: unknown): v is string => typeof v === 'string' && JOUR.test(v) && versJour(versMs(v)) === v;
export const plusJours = (j: string, n: number) => versJour(versMs(j) + n * 86_400_000);
export const joursEntre = (de: string, a: string) => Math.round((versMs(a) - versMs(de)) / 86_400_000);
// Un mois de calendrier : le 31 janvier plus un mois est le 28 (ou 29) février.
export function plusMois(j: string, n: number): string {
  const a = Number(j.slice(0, 4)), m = Number(j.slice(5, 7)) - 1 + n, d = Number(j.slice(8, 10));
  const annee = a + Math.floor(m / 12), mois = ((m % 12) + 12) % 12;
  const dernier = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return versJour(Date.UTC(annee, mois, Math.min(d, dernier)));
}
const plusTard = (a: string, b: string | null) => (b !== null && b > a ? b : a);
// Un jour tel qu'une personne le lit : 19/11/2026.
export const jourEnFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;

// Les faits tels que la base les rend (en JSON) : un jour illisible vaut « pas de jour », jamais une date devinée.
export function lireFaits(f: Record<string, unknown>): Faits {
  const jour = (v: unknown) => (estJour(v) ? v : null);
  return {
    connu: f.connu === true, essaiJusquAu: jour(f.essaiJusquAu), payeJusquAu: jour(f.payeJusquAu),
    offre: f.offre === 'essentiel' || f.offre === 'complet' ? f.offre : null,
    periodicite: f.periodicite === 'annuel' || f.periodicite === 'mensuel' ? f.periodicite : null,
    resilieLe: jour(f.resilieLe), suspenduLe: jour(f.suspenduLe), offert: f.offert === true,
    bacASable: f.bacASable === true, tenuParCabinet: f.tenuParCabinet === true,
    modules: lireModules(f.modules), regles: lireRegles(f.regles), contenu: lireContenu(f.contenu),
  };
}

// L'histoire du contenu des offres telle que la base la rend (0105), lue comme celle des règles.
export function lireContenu(v: unknown): ContenuDesOffres {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown> | undefined>;
  const c: ContenuDesOffres = {};
  for (const offre of ['essentiel', 'complet'] as const) {
    const m = o[offre];
    if (m && typeof m === 'object') c[offre] = { paie: lireRegles({ grace: m.paie }).grace, compta: lireRegles({ grace: m.compta }).grace };
  }
  return c;
}

// Le premier jour de la période payée qui court (ou qui vient de finir) : le jour qui suit sa fin, moins sa durée. Une
// fin de février peut venir de plusieurs débuts (une période du 28, du 29, du 30 ou du 31 janvier finit le 27 février) :
// c'est le plus tôt qui est rendu ; seul un changement de contenu daté entre ces jours-là s'y lirait autrement, et la
// facture, elle, compte au vrai premier jour de sa période.
export function debutDeLaPeriode(f: Faits): string | null {
  if (!f.payeJusquAu || !f.periodicite) return null;
  return plusMois(plusJours(f.payeJusquAu, 1), f.periodicite === 'annuel' ? -12 : -1);
}

// L'histoire des règles telle que la base la rend (0104), lue prudemment : une ligne illisible ne compte pas.
export function lireRegles(v: unknown): Regles {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const histoire = (h: unknown): RegleDatee[] => (Array.isArray(h) ? h : []).flatMap((x: Record<string, unknown>) => {
    const jours = Array.isArray(x?.jours) ? x.jours.filter((n): n is number => Number.isInteger(n) && n >= 0) : [];
    return estJour(x?.aPartirDu) && jours.length && jours.length === (x.jours as unknown[]).length ? [{ aPartirDu: x.aPartirDu, jours }] : [];
  }).sort((a, b) => (a.aPartirDu < b.aPartirDu ? -1 : a.aPartirDu > b.aPartirDu ? 1 : 0));
  return { grace: histoire(o.grace), relances: histoire(o.relances) };
}

// Les modules achetés, lus prudemment : la paie, la comptabilité complète, rien d'autre.
export const lireModules = (v: unknown): ModuleAchete[] =>
  (Array.isArray(v) ? v : []).filter((m): m is ModuleAchete => m === 'paie' || m === 'compta');

// Le dernier jour couvert : l'essai, ou la période payée si elle va plus loin.
export function echeanceDe(f: Faits): string | null {
  if (!f.essaiJusquAu) return null;
  return plusTard(f.essaiJusquAu, f.payeJusquAu);
}

export function etatAbonnement(f: Faits, jour: string): Etat {
  if (f.bacASable) return { etat: 'hors', raison: 'bac_a_sable' };
  if (f.tenuParCabinet) return { etat: 'hors', raison: 'tenu_par_cabinet' };
  if (f.offert) return { etat: 'hors', raison: 'offert' };
  const echeance = echeanceDe(f);
  if (!f.connu || echeance === null) return { etat: 'hors', raison: 'inconnu' };
  if (f.suspenduLe && f.suspenduLe <= jour) return { etat: 'lecture_seule', depuis: f.suspenduLe, raison: 'suspendu' };
  if (jour <= echeance) {
    if (f.payeJusquAu && f.offre && f.periodicite && jour <= f.payeJusquAu) {
      return { etat: 'actif', offre: f.offre, periodicite: f.periodicite, jusquAu: f.payeJusquAu, jours: joursEntre(jour, f.payeJusquAu), resilie: !!f.resilieLe };
    }
    return { etat: 'essai', jusquAu: echeance, jours: joursEntre(jour, echeance) };
  }
  // Résilié : au bout de ce qui est payé, la lecture seule, sans grâce.
  if (f.resilieLe) return { etat: 'lecture_seule', depuis: plusJours(echeance, 1), raison: 'resilie' };
  // Une grâce qu'on ne connaît pas ne ferme rien.
  const grace = graceDe(f, echeance);
  if (grace === null) return { etat: 'hors', raison: 'inconnu' };
  const lectureSeuleLe = plusJours(echeance, grace + 1);
  const apresEssai = !f.payeJusquAu || f.payeJusquAu < (f.essaiJusquAu ?? echeance);
  if (jour < lectureSeuleLe) return { etat: 'en_retard', echeance, lectureSeuleLe, jours: joursEntre(jour, lectureSeuleLe), apresEssai };
  return { etat: 'lecture_seule', depuis: lectureSeuleLe, raison: apresEssai ? 'essai_termine' : 'non_renouvele' };
}

// La relance qui doit partir aujourd'hui, ou rien : la plus pressante de celles que le jour atteint, une fois par
// échéance (une relance plus pressante déjà partie couvre les moins pressantes). Ni pour qui a résilié (il l'a décidé),
// ni pour ce qui n'a pas d'échéance.
export function relanceDue(f: Faits, jour: string, parties: { echeance: string; rang: string }[]): { rang: Rang; echeance: string; jours: number } | null {
  const e = etatAbonnement(f, jour);
  const echeance = echeanceDe(f);
  if (echeance === null || f.resilieLe || e.etat === 'hors') return null;
  const deja = new Set(parties.filter((p) => p.echeance === echeance).map((p) => p.rang));
  if (e.etat === 'lecture_seule') {
    // Une suspension n'est pas une échéance manquée : elle se dit par la console, pas par une relance.
    if (e.raison === 'suspendu' || deja.has('lecture_seule')) return null;
    return { rang: 'lecture_seule', echeance, jours: joursEntre(jour, echeance) };
  }
  const reste = joursEntre(jour, echeance);
  if (reste < 0) return null;
  // Les jours des relances déjà parties pour cette échéance, quelle que soit la règle qui les a fait partir.
  const dejaJours = [...deja].map(joursDuRang).filter((n): n is number => n !== null);
  // De la plus pressante à la moins pressante : la veille, puis les autres, de la plus proche à la plus lointaine.
  for (const seuil of relancesDu(f, jour).reverse()) {
    if (reste > seuil) continue;
    // Une relance de ce rang, ou plus pressante, est déjà partie pour cette échéance : rien de plus.
    if (dejaJours.some((n) => n <= seuil)) return null;
    return { rang: `j${seuil}`, echeance, jours: reste };
  }
  return null;
}

// La période qu'un paiement couvre : elle commence le lendemain de l'échéance si on paie avant la fin de la grâce
// (rien ne s'interrompt, et les jours de grâce font partie de la période), sinon le jour du paiement.
// Une grâce inconnue n'en compte aucune : la période commence le jour du paiement, sans faire payer des jours passés.
export function prochainePeriode(f: Faits, periodicite: Periodicite, jour: string): { debut: string; fin: string } {
  const echeance = echeanceDe(f) ?? plusJours(jour, -1);
  const debut = jour <= plusJours(echeance, graceDe(f, echeance) ?? 0) ? plusJours(echeance, 1) : jour;
  return { debut, fin: plusJours(plusMois(debut, periodicite === 'annuel' ? 12 : 1), -1) };
}
