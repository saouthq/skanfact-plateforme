// Le service tel que la console le montre (Console 3 ; docs/console.md C12 ; skanfact docs/cadrage/10-console.md § 2.8,
// 06 § 7, VISION-ARCHITECTURE.md § 6). Ce que la base a reçu du serveur (ses requêtes, serveur/service/collecte.ts) et de
// la veille (ses relevés, ses alertes, ses nuits, exploitation/veiller.ts), lu en une fois et rangé ici, pur
// (tests/console/service.test.ts). Rien n'est vert sans mesure (C2) : une minute sans relevé n'est ni bonne ni mauvaise,
// elle est « non mesurée » ; une période sans requête n'a pas de temps de réponse, et le dit.

import { BRIQUES, briqueDe, CERTIFICAT_ALERTE_J, CERTIFICAT_GRAVE_J, DISQUE_ALERTE, DISQUE_GRAVE, type Brique } from '../../exploitation/veille.ts';
import { BUDGETS, fusionner, histogrammeVide, partSous, quantile, SEUIL_PANNES, type Histogramme } from '../service/mesures.ts';

// Un centile se lit sur assez de requêtes : sous vingt, le « 95 % » serait la plus lente d'entre elles, et une seule
// lecture lente la nuit dessinerait un pic au-dessus du budget. Le pas le dit (`lectures`), sans courbe.
export const LECTURES_POUR_UN_CENTILE = 20;

// Les seuils que l'écran trace, tels qu'ils sont écrits une fois, là où la veille et le serveur les lisent (06 § 7) : la
// console ne les recopie pas, elle les reçoit.
export const SEUILS_DU_SERVICE = {
  pannes: SEUIL_PANNES,
  disque: { alerte: DISQUE_ALERTE, grave: DISQUE_GRAVE },
  certificat: { alerte: CERTIFICAT_ALERTE_J, grave: CERTIFICAT_GRAVE_J },
  lectures: LECTURES_POUR_UN_CENTILE,
} as const;

// ── Les périodes du grand graphique ──────────────────────────────────────────────────────────────────────────────────
// Chacune avec son pas (un point par pas) et la table où elle se lit (les minutes gardées trois jours, les heures 35).
export const PERIODES = {
  '1h': { duree: 3_600_000, pas: 60_000, grain: 'minute' },
  '24h': { duree: 86_400_000, pas: 600_000, grain: 'minute' },
  '7j': { duree: 7 * 86_400_000, pas: 3_600_000, grain: 'heure' },
  '30j': { duree: 30 * 86_400_000, pas: 6 * 3_600_000, grain: 'heure' },
} as const;
export type Periode = keyof typeof PERIODES;
export const estPeriode = (x: unknown): x is Periode => typeof x === 'string' && Object.hasOwn(PERIODES, x);
// Les tuiles du haut : les dernières 24 heures, heure par heure, quelle que soit la période du grand graphique.
export const TUILES = { duree: 86_400_000, pas: 3_600_000, grain: 'minute' } as const;
type Pas = { duree: number; pas: number; grain: 'minute' | 'heure' };

// Les bornes d'une période : son dernier point est le pas en cours (commencé, pas fini), et elle remonte de sa durée.
export function bornes(p: Pas, maintenant: Date): { depuis: Date; pas: number; points: number; grain: 'minute' | 'heure' } {
  const fin = Math.floor(maintenant.getTime() / p.pas) * p.pas + p.pas;
  return { depuis: new Date(fin - p.duree), pas: p.pas, points: p.duree / p.pas, grain: p.grain };
}

// La sorte dont le temps de réponse se juge sur le grand graphique : les listes et les fiches (« < 300 ms, 95 % »).
export const SORTE_DU_GRAPHIQUE = 'lecture' as const;
export const BUDGET_DU_GRAPHIQUE = BUDGETS[SORTE_DU_GRAPHIQUE] ?? 300;

export type Point = {
  debut: string;
  // Toutes les requêtes du pas, et celles qui ont fini en panne ; par minute, sur ce que le pas a déjà duré.
  n: number; pannes: number; parMinute: number;
  // Le temps de réponse des listes et des fiches : la borne du seau de la médiane et du 95e centile (« moins de… »),
  // et la part sous le budget ; null quand il y en a eu moins de LECTURES_POUR_UN_CENTILE.
  p50: number | null; p95: number | null; sousBudget: number | null; lectures: number;
};

// Le temps de réponse d'un histogramme, s'il y a assez de lectures pour le dire.
function tempsDe(h: Histogramme) {
  const lectures = h.reduce((s, v) => s + v, 0);
  const assez = lectures >= LECTURES_POUR_UN_CENTILE;
  return {
    lectures, p50: assez ? quantile(h, 0.5) : null, p95: assez ? quantile(h, 0.95) : null,
    sousBudget: assez ? partSous(h, BUDGET_DU_GRAPHIQUE) : null,
  };
}

const nombre = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);
const seaux = (x: unknown): Histogramme => fusionner(histogrammeVide(), Array.isArray(x) ? (x as number[]) : []);

// Une série telle que la base la rend (plateforme.console_service_serie : [instant, n, pannes, seaux]) posée sur tous les
// pas de la période, ceux où rien n'est arrivé compris.
export function serie(brut: unknown, p: Pas, maintenant: Date): Point[] {
  const b = bornes(p, maintenant);
  const parInstant = new Map<number, { n: number; pannes: number; h: Histogramme }>();
  for (const l of Array.isArray(brut) ? brut : []) {
    if (!Array.isArray(l)) continue;
    const t = Date.parse(String(l[0]));
    if (!Number.isFinite(t)) continue;
    const deja = parInstant.get(t);
    const h = seaux(l[3]);
    if (deja) { deja.n += nombre(l[1]); deja.pannes += nombre(l[2]); fusionner(deja.h, h); } else parInstant.set(t, { n: nombre(l[1]), pannes: nombre(l[2]), h });
  }
  const points: Point[] = [];
  for (let i = 0; i < b.points; i++) {
    const t = b.depuis.getTime() + i * b.pas;
    const x = parInstant.get(t) ?? { n: 0, pannes: 0, h: histogrammeVide() };
    const duree = Math.max(1, Math.min(b.pas, maintenant.getTime() - t) / 60_000);
    points.push({
      debut: new Date(t).toISOString(), n: x.n, pannes: x.pannes, parMinute: t > maintenant.getTime() ? 0 : Math.round((x.n / duree) * 10) / 10,
      ...tempsDe(x.h),
    });
  }
  return points;
}

// Le trafic d'en ce moment : les minutes FINIES de la dernière heure (la minute en cours n'est pas encore dans la base), en
// moyenne par minute. Un chiffre glissant, jamais celui de l'heure de l'horloge : à 7 h 01, cette heure-là n'a qu'une
// minute, et son chiffre dirait que le service s'est arrêté.
export function traficRecent(points: readonly Point[], maintenant: Date): { parMinute: number; minutes: number } {
  const enCours = Math.floor(maintenant.getTime() / 60_000) * 60_000;
  const finies = points.filter((p) => Date.parse(p.debut) < enCours);
  const n = finies.reduce((s, p) => s + p.n, 0);
  return { parMinute: finies.length ? Math.round((n / finies.length) * 10) / 10 : 0, minutes: finies.length };
}

// Une série entière en un seul chiffre (les tuiles des dernières 24 heures, le pied du grand graphique) : ses seaux
// fusionnés, jamais la moyenne des centiles de chaque pas — un centile ne se moyenne pas.
export function ensemble(brut: unknown) {
  let n = 0, pannes = 0;
  const h = histogrammeVide();
  for (const l of Array.isArray(brut) ? brut : []) {
    if (!Array.isArray(l) || !Number.isFinite(Date.parse(String(l[0])))) continue;
    n += nombre(l[1]); pannes += nombre(l[2]); fusionner(h, seaux(l[3]));
  }
  return { n, pannes, partPannes: n ? pannes / n : null, ...tempsDe(h) };
}

// Ce qu'une série dit en une ligne : combien, combien en panne, le plus lent, combien de pas au-dessus du budget.
export function resume(points: Point[]) {
  const n = points.reduce((s, p) => s + p.n, 0);
  const pannes = points.reduce((s, p) => s + p.pannes, 0);
  const lents = points.filter((p) => p.p95 !== null && p.p95 > BUDGET_DU_GRAPHIQUE).length;
  const p95s = points.map((p) => p.p95).filter((v): v is number => v !== null);
  return { n, pannes, partPannes: n ? pannes / n : null, lePlusLent: p95s.length ? Math.max(...p95s) : null, auDessusDuBudget: lents };
}

// ── Ce que la veille a vu ────────────────────────────────────────────────────────────────────────────────────────────
export type Alerte = { id: string; cle: string; titre: string; grave: boolean; aEteGrave: boolean; faire: string; debut: string; fin: string | null; brique: Brique | null };
export type Nuit = { jour: string; sauvegarde: Resultat | null; horsMachine: Resultat | null; copieDeBase: Resultat | null; restauration: Resultat | null };
type Resultat = { le: string; ok: boolean };
export type Machine = { minute: string; repond: boolean; charge: number | null; memoire: number | null; processeurs: number | null; disques: { point: string; pourcent: number }[] };
export type VeilleLue = {
  jours: { jour: string; mesurees: number; bas: number }[];
  coupures: { debut: string; fin: string; minutes: number }[];
  machine: Machine[];
  dernier: { minute: string; version: string | null; certificat: string | null; archiveLe: string | null } | null;
  versions: { version: string; debut: string; fin: string }[];
  alertes: Alerte[];
  nuits: Nuit[];
  exercice: { jour: string; restauration: Resultat } | null;
};

const texte = (x: unknown) => (typeof x === 'string' ? x : null);
const resultatLu = (x: unknown): Resultat | null => {
  const r = x as { le?: unknown; ok?: unknown } | null;
  return r && typeof r.le === 'string' && Number.isFinite(Date.parse(r.le)) ? { le: r.le, ok: r.ok === true } : null;
};

// Ce que la base rend (plateforme.console_service_veille), relu prudemment : une ligne illisible ne compte pas.
export function lireVeilleDeLaBase(brut: unknown): VeilleLue {
  const b = (brut ?? {}) as Record<string, unknown>;
  const tableau = (x: unknown) => (Array.isArray(x) ? x : []);
  const d = b.dernier as Record<string, unknown> | null;
  const e = b.exercice as Record<string, unknown> | null;
  return {
    jours: tableau(b.jours).filter(Array.isArray).map((l) => ({ jour: String(l[0]), mesurees: nombre(l[1]), bas: nombre(l[2]) })),
    coupures: tableau(b.coupures).filter(Array.isArray).map((l) => ({ debut: String(l[0]), fin: String(l[1]), minutes: nombre(l[2]) })),
    machine: tableau(b.machine).filter(Array.isArray).map((l) => ({
      minute: String(l[0]), repond: l[1] === true, charge: l[2] === null ? null : nombre(l[2]), memoire: l[3] === null ? null : nombre(l[3]),
      processeurs: l[4] === null ? null : nombre(l[4]),
      disques: tableau(l[5]).map((x: { point?: unknown; pourcent?: unknown }) => ({ point: String(x?.point ?? ''), pourcent: nombre(x?.pourcent) })),
    })),
    dernier: d ? { minute: String(d.minute), version: texte(d.version), certificat: texte(d.certificat), archiveLe: texte(d.archiveLe) } : null,
    versions: tableau(b.versions).filter(Array.isArray).map((l) => ({ version: String(l[0]), debut: String(l[1]), fin: String(l[2]) })),
    alertes: tableau(b.alertes).map((a: Record<string, unknown>) => ({
      id: String(a.id), cle: String(a.cle), titre: String(a.titre ?? ''), grave: a.grave === true, aEteGrave: a.aEteGrave === true,
      faire: String(a.faire ?? ''), debut: String(a.debut), fin: texte(a.fin), brique: briqueDe(String(a.cle)),
    })),
    nuits: tableau(b.nuits).map((n: Record<string, unknown>) => {
      const s = (n.sauvegarde ?? null) as Record<string, unknown> | null;
      return {
        jour: String(n.jour), sauvegarde: resultatLu(s), horsMachine: resultatLu(s?.horsMachine ?? null),
        copieDeBase: resultatLu(n.copieDeBase), restauration: resultatLu(n.restauration),
      };
    }),
    exercice: e && resultatLu(e.restauration) ? { jour: String(e.jour), restauration: resultatLu(e.restauration) as Resultat } : null,
  };
}

// ── Les jours ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Le jour de Tunis d'un instant, et les trente jours qui finissent aujourd'hui.
const jourDeTunis = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
export function trenteJours(aujourdhui: string): string[] {
  const t = Date.parse(`${aujourdhui}T12:00:00Z`);
  return Array.from({ length: 30 }, (_, i) => new Date(t - (29 - i) * 86_400_000).toISOString().slice(0, 10));
}

// Une alerte touche un jour de Tunis si elle était ouverte à un moment de ce jour (une alerte encore ouverte, jusqu'à
// maintenant).
function alertesDuJour(alertes: Alerte[], jour: string, maintenant: Date) {
  return alertes.filter((a) => jourDeTunis(new Date(a.debut)) <= jour && jourDeTunis(a.fin ? new Date(a.fin) : maintenant) >= jour);
}

export type EtatJour = 'bon' | 'perturbe' | 'coupure' | 'nonmesure';
// Le jour du service : une coupure (au moins une minute relevée sans réponse), perturbé (une alerte grave, le service
// répondant), bon (relevé, rien de grave), non mesuré (aucun relevé ce jour-là : la veille n'existait pas, ou se taisait).
export function joursDuService(v: VeilleLue, aujourdhui: string, maintenant: Date) {
  const parJour = new Map(v.jours.map((j) => [j.jour, j]));
  return trenteJours(aujourdhui).map((jour) => {
    const j = parJour.get(jour);
    const graves = alertesDuJour(v.alertes, jour, maintenant).filter((a) => a.aEteGrave && a.brique !== 'programme');
    const etat: EtatJour = !j || j.mesurees === 0 ? 'nonmesure' : j.bas > 0 ? 'coupure' : graves.length ? 'perturbe' : 'bon';
    return { jour, etat, mesurees: j?.mesurees ?? 0, bas: j?.bas ?? 0, graves: graves.map((a) => a.titre) };
  });
}

// La disponibilité vue du serveur : les minutes où il répondait, sur celles qui ont été relevées (une minute sans relevé
// ne compte ni pour ni contre) ; null sans aucun relevé.
export function disponibilite(v: VeilleLue) {
  const mesurees = v.jours.reduce((s, j) => s + j.mesurees, 0);
  const bas = v.jours.reduce((s, j) => s + j.bas, 0);
  return { mesurees, bas, taux: mesurees ? (mesurees - bas) / mesurees : null, coupures: v.coupures.length };
}

// ── Les versions ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Chaque version a tourné d'une minute à une autre : une version qui revient après une autre est une seconde mise en
// ligne. La plus ancienne des trente jours tournait déjà au premier relevé : on ne sait pas quand elle est arrivée, ce
// n'est pas une mise en ligne.
const parDebut = (v: VeilleLue) => [...v.versions].sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));
// Chaque mise en ligne vue arriver, dans l'ordre du temps ; un RETOUR est une version qui avait déjà tourné (on revient
// à la précédente après une mise en ligne qui casse) : il compte comme une mise en ligne, et se dit comme un retour.
export function misesEnLigne(v: VeilleLue) {
  const triees = parDebut(v);
  return triees.slice(1).map((x, k) => ({ version: x.version, le: x.debut, retour: triees.slice(0, k + 1).some((y) => y.version === x.version) }));
}
// La version en ligne au dernier relevé, et depuis quand : la minute où on l'a vue arriver ; sinon la plus ancienne
// minute où on l'a vue tourner (`vueArriver` faux : « au moins depuis »). null : la veille ne l'a jamais lue.
export function enLigne(v: VeilleLue) {
  if (!v.dernier?.version) return null;
  const triees = parDebut(v);
  const derniere = triees.at(-1);
  if (!derniere || derniere.version !== v.dernier.version) return { version: v.dernier.version, depuis: null, vueArriver: false };
  return { version: derniere.version, depuis: derniere.debut, vueArriver: triees.length > 1 };
}

export type EtatBrique = 'bon' | 'attention' | 'grave' | 'nonmesure';
// Chaque brique, jour par jour : grave ou à regarder si une de ses alertes était ouverte ce jour-là, bonne si la veille a
// relevé ce jour-là sans rien lui reprocher, non mesurée sinon. Son état d'aujourd'hui suit les alertes ouvertes.
export function briques(v: VeilleLue, aujourdhui: string, maintenant: Date, veilleEnMarche: boolean) {
  const mesure = new Set(v.jours.filter((j) => j.mesurees > 0).map((j) => j.jour));
  return BRIQUES.map((b) => {
    const siennes = v.alertes.filter((a) => a.brique === b.id);
    const ouvertes = siennes.filter((a) => a.fin === null);
    const jours = trenteJours(aujourdhui).map((jour) => {
      const ce = alertesDuJour(siennes, jour, maintenant);
      const etat: EtatBrique = ce.some((a) => a.aEteGrave) ? 'grave' : ce.length ? 'attention' : mesure.has(jour) ? 'bon' : 'nonmesure';
      return { jour, etat, alertes: ce.map((a) => a.titre) };
    });
    const etat: EtatBrique = !veilleEnMarche ? 'nonmesure' : ouvertes.some((a) => a.grave) ? 'grave' : ouvertes.length ? 'attention' : 'bon';
    return { id: b.id, etat, jours, ouvertes: ouvertes.map((a) => ({ titre: a.titre, grave: a.grave, faire: a.faire, debut: a.debut })) };
  });
}

// Ce qui vient de se passer, sur les trente jours : les alertes (quand elles s'ouvrent, quand elles se règlent), chaque
// mise en ligne (un retour se dit), et chaque nuit en une ligne — sa copie de base, sa sauvegarde, sa copie hors de la
// machine, son exercice de restauration s'il y en a eu un. Le plus récent d'abord ; l'écran filtre et montre les premiers.
export type Etape = 'copieDeBase' | 'sauvegarde' | 'horsMachine' | 'restauration';
export type Evenement =
  | { le: string; type: 'alerte'; sorte: 'ouverte' | 'reglee'; titre: string; grave: boolean; brique: Brique | null }
  | { le: string; type: 'version'; version: string; retour: boolean }
  | { le: string; type: 'nuit'; jour: string; etapes: { quoi: Etape; ok: boolean }[] };
const ETAPES: readonly Etape[] = ['copieDeBase', 'sauvegarde', 'horsMachine', 'restauration'];
export function journal(v: VeilleLue): Evenement[] {
  const e: Evenement[] = [];
  for (const a of v.alertes) {
    e.push({ le: a.debut, type: 'alerte', sorte: 'ouverte', titre: a.titre, grave: a.aEteGrave, brique: a.brique });
    if (a.fin) e.push({ le: a.fin, type: 'alerte', sorte: 'reglee', titre: a.titre, grave: a.aEteGrave, brique: a.brique });
  }
  for (const m of misesEnLigne(v)) e.push({ le: m.le, type: 'version', version: m.version, retour: m.retour });
  for (const n of v.nuits) {
    // Une sauvegarde en échec n'a rien envoyé : sa copie hors de la machine est sans objet (la carte des nuits le dit aussi),
    // et la veille, qui n'y voit rien en attente, la dirait « arrivée ».
    const sansObjet = n.sauvegarde?.ok === false;
    const faites = ETAPES.flatMap((quoi) => { const r = n[quoi]; return r && !(quoi === 'horsMachine' && sansObjet) ? [{ quoi, ok: r.ok, le: r.le }] : []; })
      .sort((x, y) => Date.parse(x.le) - Date.parse(y.le));
    // L'heure de la nuit est celle de sa dernière étape FAITE : la copie hors de la machine porte l'heure où la veille l'a
    // vérifiée (chaque minute), pas celle de son arrivée — elle ne compte que si rien d'autre n'a d'heure.
    const datees = faites.filter((x) => x.quoi !== 'horsMachine');
    const derniere = (datees.length ? datees : faites).at(-1);
    if (derniere) e.push({ le: derniere.le, type: 'nuit', jour: n.jour, etapes: faites.map(({ quoi, ok }) => ({ quoi, ok })) });
  }
  return e.sort((x, y) => Date.parse(y.le) - Date.parse(x.le));
}
