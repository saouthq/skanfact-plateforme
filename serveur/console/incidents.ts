// Les incidents du service et la page d'état (Console 3d ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 9 ;
// docs/console.md C24) : l'incident ouvert et ses points, les suites que les comptes rendus ont promises, ce que la page
// d'état publique dit en ce moment, les maintenances (annoncées, et les mises en ligne vues par la veille), les incidents
// passés et ce qu'ils ont coûté, et les fiches réflexes (quand chacune a servi). Pur (testé : tests/console/incidents.test.ts) :
// la route lit la base, la veille et la page d'état ; ces fonctions rangent.

export type Gravite = 'mineur' | 'majeur' | 'critique';
export const GRAVITES: readonly Gravite[] = ['mineur', 'majeur', 'critique'];
export const rangGravite = (g: Gravite) => GRAVITES.indexOf(g);

// Les fiches réflexes, dans l'ordre de la page (leur texte vit dans la console : web/console/src/textes.ts). Un incident
// suit une fiche ou aucune ; la base n'en accepte qu'un nom bien formé, la route n'accepte que celles-ci.
// « empreinte » (0142, C66) : une chaîne d'empreintes cassée — l'écran Sécurité ouvre l'incident sur elle.
export const FICHES = ['service', 'site', 'base', 'sauvegarde', 'partenaire', 'chiffre', 'acces', 'fuite', 'rancon', 'empreinte'] as const;
export type Fiche = typeof FICHES[number];
export const estFiche = (x: unknown): x is Fiche => typeof x === 'string' && (FICHES as readonly string[]).includes(x);

// ── Ce que la base rend (plateforme.console_service_incidents), relu prudemment ──────────────────────────────────────
export type PointLu = { le: string; par: string; texte: string; public: boolean; gravite: Gravite | null };
export type SuiteLue = { id: string; titre: string; responsable: string; due: string; faiteLe: string | null; repoussee: number };
export type IncidentLu = {
  id: string; ref: string; titre: string; gravite: Gravite; fiche: Fiche | null; ouvertLe: string; ouvertPar: string;
  public: string | null; publicLe: string | null; fin: string | null; closLe: string | null; closPar: string | null;
  effet: string | null; cause: string | null; change: string | null; points: PointLu[]; suites: SuiteLue[];
  // 0126 : les demandes de clients liées, comptées — jamais nommées (la technique lit cet écran).
  demandes: { n: number; ouvertes: number };
};
export type MaintenanceLue = { id: string; titre: string; texte: string; debut: string; fin: string; par: string; annuleeLe: string | null };
export type IncidentsLus = { incidents: IncidentLu[]; maintenances: MaintenanceLue[]; equipe: { id: string; nom: string }[] };

const texte = (x: unknown) => (typeof x === 'string' && x.length ? x : null);
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const jour = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const compte = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);
const gravite = (x: unknown): Gravite | null => (GRAVITES as readonly unknown[]).includes(x) ? x as Gravite : null;
// Le numéro d'un incident se lit comme on le cite : INC-2026-006.
export const refIncident = (annee: number, numero: number) => `INC-${annee}-${String(numero).padStart(3, '0')}`;

export function lireIncidents(brut: unknown): IncidentsLus {
  const b = (brut ?? {}) as Record<string, unknown>;
  return {
    incidents: tableau(b.incidents).flatMap((i) => {
      const ouvertLe = date(i.ouvertLe), g = gravite(i.gravite);
      if (!ouvertLe || !g || typeof i.annee !== 'number' || typeof i.numero !== 'number') return [];
      return [{
        id: String(i.id), ref: refIncident(i.annee, i.numero), titre: String(i.titre ?? ''), gravite: g, fiche: estFiche(i.fiche) ? i.fiche : null,
        ouvertLe, ouvertPar: String(i.ouvertPar ?? ''), public: texte(i.public), publicLe: date(i.publicLe), fin: date(i.fin),
        closLe: date(i.closLe), closPar: texte(i.closPar), effet: texte(i.effet), cause: texte(i.cause), change: texte(i.change),
        points: tableau(i.points).flatMap((p) => (date(p.le) && typeof p.texte === 'string'
          ? [{ le: String(p.le), par: String(p.par ?? ''), texte: p.texte, public: p.public === true, gravite: gravite(p.gravite) }] : [])),
        suites: tableau(i.suites).flatMap((s) => (jour(s.due) && typeof s.titre === 'string'
          ? [{ id: String(s.id), titre: s.titre, responsable: String(s.responsable ?? ''), due: String(s.due), faiteLe: date(s.faiteLe), repoussee: typeof s.repoussee === 'number' ? s.repoussee : 0 }] : [])),
        demandes: ((x) => ({ n: compte(x.n), ouvertes: compte(x.ouvertes) }))((i.demandes ?? {}) as Record<string, unknown>),
      }];
    }),
    maintenances: tableau(b.maintenances).flatMap((m) => {
      const debut = date(m.debut), fin = date(m.fin);
      return debut && fin ? [{ id: String(m.id), titre: String(m.titre ?? ''), texte: String(m.texte ?? ''), debut, fin, par: String(m.par ?? ''), annuleeLe: date(m.annuleeLe) }] : [];
    }),
    equipe: tableau(b.equipe).flatMap((e) => (typeof e.id === 'string' && typeof e.nom === 'string' ? [{ id: e.id, nom: e.nom }] : [])),
  };
}

// ── Les incidents ouverts ───────────────────────────────────────────────────────────────────────────────────────────
// Le plus grave d'abord, puis le plus ancien : c'est celui qu'on traite.
export function ouverts(lu: IncidentsLus): IncidentLu[] {
  return lu.incidents.filter((i) => i.closLe === null)
    .sort((a, b) => rangGravite(b.gravite) - rangGravite(a.gravite) || Date.parse(a.ouvertLe) - Date.parse(b.ouvertLe));
}

// ── Les suites à tenir ──────────────────────────────────────────────────────────────────────────────────────────────
// Celles qui ne sont pas faites : en retard (leur date est passée) d'abord, puis par date. Une suite due aujourd'hui
// n'est pas en retard. Les faites se comptent (elles restent lisibles dans leur compte rendu).
export type SuiteATenir = SuiteLue & { incident: { id: string; ref: string; titre: string }; retard: number };
const joursEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export function suites(lu: IncidentsLus, aujourdhui: string): { aTenir: SuiteATenir[]; enRetard: number; faites: number } {
  const aTenir: SuiteATenir[] = [];
  let faites = 0;
  for (const i of lu.incidents) {
    for (const s of i.suites) {
      if (s.faiteLe) { faites++; continue; }
      aTenir.push({ ...s, incident: { id: i.id, ref: i.ref, titre: i.titre }, retard: Math.max(0, joursEntre(s.due, aujourdhui)) });
    }
  }
  // La plus ancienne date d'abord : une suite en retard a toujours une date passée, elle vient donc en tête d'elle-même.
  aTenir.sort((a, b) => a.due.localeCompare(b.due) || a.titre.localeCompare(b.titre, 'fr'));
  return { aTenir, enRetard: aTenir.filter((s) => s.retard > 0).length, faites };
}

// ── Les incidents passés ────────────────────────────────────────────────────────────────────────────────────────────
// Ceux clos dont le problème a commencé dans la période : leur durée (de l'ouverture à la fin du problème, jamais
// négative), leur gravité, l'effet sur les clients, et où en sont leurs suites. Avec eux, ce que la veille a mesuré sur
// la même période : les minutes où SkanFact ne répondait à personne (l'arrêt complet) et la disponibilité. Un incident
// sans mesure ne fait pas un chiffre : l'arrêt et la disponibilité viennent de la veille seule.
export type Passe = {
  id: string; ref: string; titre: string; gravite: Gravite; ouvertLe: string; minutes: number; effet: string; cause: string; change: string;
  suites: { faites: number; total: number }; points: PointLu[]; fiche: Fiche | null; closPar: string | null;
  demandes: { n: number; ouvertes: number };
};
export type Mesure = { mesurees: number; bas: number };
export function passes(lu: IncidentsLus, depuis: string, mesure: Mesure) {
  const lignes: Passe[] = lu.incidents
    .filter((i) => i.closLe !== null && i.fin !== null && Date.parse(i.ouvertLe) >= Date.parse(depuis))
    .sort((a, b) => Date.parse(b.ouvertLe) - Date.parse(a.ouvertLe))
    .map((i) => ({
      id: i.id, ref: i.ref, titre: i.titre, gravite: i.gravite, ouvertLe: i.ouvertLe,
      minutes: Math.max(0, Math.round((Date.parse(i.fin as string) - Date.parse(i.ouvertLe)) / 60_000)),
      effet: i.effet ?? '', cause: i.cause ?? '', change: i.change ?? '', points: i.points, fiche: i.fiche, closPar: i.closPar,
      suites: { faites: i.suites.filter((s) => s.faiteLe).length, total: i.suites.length }, demandes: i.demandes,
    }));
  return {
    lignes,
    n: lignes.length,
    graves: lignes.filter((l) => l.gravite !== 'mineur').length,
    arret: mesure.mesurees ? mesure.bas : null,
    disponibilite: mesure.mesurees ? (mesure.mesurees - mesure.bas) / mesure.mesurees : null,
  };
}

// ── Les maintenances ────────────────────────────────────────────────────────────────────────────────────────────────
// Celles qu'on a annoncées (à venir, en cours, faites, annulées) et les mises en ligne que la veille a vues arriver :
// une nouvelle version n'a pas d'annonce (les deux exemplaires passent l'un après l'autre) ; on dit si elle a coûté une
// coupure, lue dans les minutes que la veille a relevées sans réponse autour d'elle (dix minutes de part et d'autre).
export type EtatMaintenance = 'a_venir' | 'en_cours' | 'faite' | 'annulee';
export type LigneMaintenance =
  | { sorte: 'annoncee'; le: string; id: string; titre: string; texte: string; debut: string; fin: string; par: string; etat: EtatMaintenance }
  | { sorte: 'version'; le: string; version: string; retour: boolean; coupure: number };
export const AUTOUR_VERSION_MIN = 10;
export function maintenances(
  lu: IncidentsLus,
  versions: readonly { version: string; le: string; retour: boolean }[],
  coupures: readonly { debut: string; fin: string; minutes: number }[],
  maintenant: Date,
): LigneMaintenance[] {
  const t = maintenant.getTime();
  const annoncees: LigneMaintenance[] = lu.maintenances.map((m) => ({
    sorte: 'annoncee', le: m.debut, id: m.id, titre: m.titre, texte: m.texte, debut: m.debut, fin: m.fin, par: m.par,
    etat: m.annuleeLe ? 'annulee' : Date.parse(m.debut) > t ? 'a_venir' : Date.parse(m.fin) > t ? 'en_cours' : 'faite',
  }));
  const autour = AUTOUR_VERSION_MIN * 60_000;
  const vues: LigneMaintenance[] = versions.map((v) => {
    const le = Date.parse(v.le);
    const coupure = coupures
      .filter((c) => Date.parse(c.debut) <= le + autour && Date.parse(c.fin) >= le - autour)
      .reduce((s, c) => s + c.minutes, 0);
    return { sorte: 'version', le: v.le, version: v.version, retour: v.retour, coupure };
  });
  // Les à venir d'abord (la plus proche en tête), puis le reste du plus récent au plus ancien.
  const aVenir = annoncees.filter((m) => m.sorte === 'annoncee' && m.etat === 'a_venir').sort((a, b) => Date.parse(a.le) - Date.parse(b.le));
  const reste = [...annoncees.filter((m) => !(m.sorte === 'annoncee' && m.etat === 'a_venir')), ...vues].sort((a, b) => Date.parse(b.le) - Date.parse(a.le));
  return [...aVenir, ...reste];
}

// ── Les fiches réflexes : quand chacune a servi ─────────────────────────────────────────────────────────────────────
// Le dernier incident ouvert qui la suivait (sa date et son numéro), ou rien : « jamais servie ».
export function fichesServies(lu: IncidentsLus): Record<Fiche, { le: string; ref: string } | null> {
  const r = Object.fromEntries(FICHES.map((f) => [f, null])) as Record<Fiche, { le: string; ref: string } | null>;
  for (const i of lu.incidents) {
    if (!i.fiche) continue;
    const d = r[i.fiche];
    if (!d || Date.parse(i.ouvertLe) > Date.parse(d.le)) r[i.fiche] = { le: i.ouvertLe, ref: i.ref };
  }
  return r;
}

// ── La page d'état publique ─────────────────────────────────────────────────────────────────────────────────────────
// Ce que la veille a écrit à côté de la page (page-etat.json, exploitation/veille.ts : ecranEtat), relu prudemment : la
// console montre ce que la page dit, ligne pour ligne, et l'heure à laquelle la veille l'a écrite. Rien : la veille n'a
// pas encore écrit de page (un serveur sans veille, un poste de développement).
export type CouleurEtat = 'vert' | 'orange' | 'rouge' | 'gris';
export type LigneEtat = { nom: string; couleur: CouleurEtat; dit: string };
export type PageEtat = {
  le: string; tout: { couleur: CouleurEtat; dit: string }; lignes: LigneEtat[];
  annonce: { incident: { gravite: Gravite; texte: string; le: string } | null; maintenance: { titre: string; texte: string; debut: string; fin: string } | null };
};
const COULEURS: readonly CouleurEtat[] = ['vert', 'orange', 'rouge', 'gris'];
const couleur = (x: unknown): CouleurEtat | null => (COULEURS as readonly unknown[]).includes(x) ? x as CouleurEtat : null;
export function lirePageEtat(brut: unknown): PageEtat | null {
  const b = (brut ?? null) as Record<string, unknown> | null;
  if (!b || !date(b.le)) return null;
  const tout = b.tout as Record<string, unknown> | null;
  if (!tout || !couleur(tout.couleur) || typeof tout.dit !== 'string') return null;
  const a = (b.annonce ?? {}) as Record<string, unknown>;
  const i = a.incident as Record<string, unknown> | null;
  const m = a.maintenance as Record<string, unknown> | null;
  return {
    le: String(b.le), tout: { couleur: couleur(tout.couleur) as CouleurEtat, dit: tout.dit },
    lignes: tableau(b.lignes).flatMap((l) => (typeof l.nom === 'string' && couleur(l.couleur) && typeof l.dit === 'string' ? [{ nom: l.nom, couleur: couleur(l.couleur) as CouleurEtat, dit: l.dit }] : [])),
    annonce: {
      incident: i && gravite(i.gravite) && typeof i.texte === 'string' && date(i.le) ? { gravite: gravite(i.gravite) as Gravite, texte: i.texte, le: String(i.le) } : null,
      maintenance: m && typeof m.titre === 'string' && typeof m.texte === 'string' && date(m.debut) && date(m.fin)
        ? { titre: m.titre, texte: m.texte, debut: String(m.debut), fin: String(m.fin) } : null,
    },
  };
}
