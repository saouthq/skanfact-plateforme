// Les performances du service (Console 3e ; skanfact docs/cadrage/10-console.md § 2.8, VISION-ARCHITECTURE.md § 6 ;
// docs/console.md C15) : les budgets que la vision promet aux clients en face de la mesure, le temps de réponse sorte par
// sorte, les routes du serveur, la base PostgreSQL et les exemplaires du programme. Pur (testé :
// tests/console/performances.test.ts) : la route lit la base, ces fonctions rangent. Deux règles :
//   - rien n'est vert sans une mesure, et un centile ne se lit que sur assez de requêtes (LECTURES_POUR_UN_CENTILE) ;
//   - ce qui ne se mesure pas encore le DIT, avec sa raison : jamais un chiffre inventé pour remplir une case.
import { BUDGETS, fusionner, histogrammeVide, LECTURES_POUR_UN_CENTILE, quantile, SEAUX_MS, total, type Histogramme, type Sorte } from '../service/mesures.ts';

// ── Les budgets de VISION § 6, écrits avant la mesure ─────────────────────────────────────────────────────────────────
// Ceux que le serveur mesure (une sorte de requête) ; ceux qui se mesurent sur le poste du client (pas encore branché) ;
// ceux du serveur qu'aucune sorte ne sépare encore. Une mesure qui dépasse change le plan, pas le budget.
export type IdBudget = 'liste' | 'caisse' | 'comptes' | 'cabinet' | 'rattrapage' | 'application' | 'saisie';
export type PasMesure = 'poste' | 'pas_a_part' | 'pas_branche';
export const BUDGETS_VISION: readonly { id: IdBudget; budget: number; ou: 'serveur' | 'poste'; sorte: Sorte | null; raison: PasMesure | null }[] = [
  { id: 'liste', budget: BUDGETS.lecture ?? 300, ou: 'serveur', sorte: 'lecture', raison: null },
  { id: 'caisse', budget: BUDGETS.caisse ?? 200, ou: 'serveur', sorte: 'caisse', raison: null },
  { id: 'comptes', budget: BUDGETS.comptes ?? 1000, ou: 'serveur', sorte: 'comptes', raison: null },
  // La balance consolidée d'un cabinet de soixante dossiers : ses requêtes comptent parmi les lectures, sans sorte à elles.
  { id: 'cabinet', budget: 5000, ou: 'serveur', sorte: null, raison: 'pas_a_part' },
  // Le rattrapage d'un magasin après une journée de coupure : aucune mesure ne le suit encore de bout en bout.
  { id: 'rattrapage', budget: 60_000, ou: 'serveur', sorte: null, raison: 'pas_branche' },
  { id: 'application', budget: 2000, ou: 'poste', sorte: null, raison: 'poste' },
  { id: 'saisie', budget: 100, ou: 'poste', sorte: null, raison: 'poste' },
];
// Les sortes dont le temps de réponse se dessine, chacune sur son échelle : celles qui ont un budget écrit.
export const SORTES_DESSINEES = ['lecture', 'caisse', 'comptes'] as const satisfies readonly Sorte[];

export type EtatPart = 'bon' | 'attention' | 'grave' | 'nonmesure';
// La part du budget prise par le 95e centile : moins de 80 %, bon ; jusqu'au budget, à regarder ; au-delà, grave.
export const etatDePart = (part: number): EtatPart => (part < 0.8 ? 'bon' : part <= 1 ? 'attention' : 'grave');

export type TempsLu = { lectures: number; p95: number | null };
export function budgets(temps: Partial<Record<Sorte, TempsLu>>) {
  return BUDGETS_VISION.map((b) => {
    if (!b.sorte) return { ...b, etat: 'nonmesure' as EtatPart, p95: null, part: null, lectures: 0, trop: false };
    const t = temps[b.sorte] ?? { lectures: 0, p95: null };
    // Trop peu de requêtes pour un centile : la mesure existe, elle ne se juge pas.
    if (t.p95 === null || t.lectures < LECTURES_POUR_UN_CENTILE) return { ...b, etat: 'nonmesure' as EtatPart, p95: null, part: null, lectures: t.lectures, trop: t.lectures > 0 };
    const part = Number.isFinite(t.p95) ? t.p95 / b.budget : Infinity;
    return { ...b, etat: etatDePart(part), p95: t.p95, part, lectures: t.lectures, trop: false };
  });
}

// ── Lire ce que la base rend (plateforme.console_service_performances) ────────────────────────────────────────────────
const nombre = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);
const seaux = (x: unknown): Histogramme => fusionner(histogrammeVide(), Array.isArray(x) ? (x as number[]) : []);
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
// Une requête lente : plus d'une seconde, c'est-à-dire au-delà du seau dont la borne est 1 000 ms.
export const LENTE_MS = 1000;
export function lentes(h: readonly number[]): number {
  const i = SEAUX_MS.indexOf(LENTE_MS);
  return h.slice(i + 1).reduce((s, n) => s + (Number(n) || 0), 0);
}

// Les routes du serveur sur la période : chacune avec ses centiles (s'il y a assez de requêtes), ses lentes et ses pannes.
export type Route = { route: string; methode: string; chemin: string; sorte: Sorte; n: number; pannes: number; partPannes: number | null;
  p50: number | null; p95: number | null; p99: number | null; lentes: number };
const ROUTE = /^(GET|POST|PUT|DELETE) (\/\S*)$/;
const SORTES_CONNUES = new Set<string>(['lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console']);
export function routes(brut: unknown): Route[] {
  return (Array.isArray(brut) ? brut : []).flatMap((l: unknown) => {
    if (!Array.isArray(l) || typeof l[0] !== 'string') return [];
    const m = ROUTE.exec(l[0]);
    if (!m || !SORTES_CONNUES.has(String(l[1]))) return [];
    const h = seaux(l[4]);
    const n = nombre(l[2]), pannes = nombre(l[3]);
    const assez = total(h) >= LECTURES_POUR_UN_CENTILE;
    return [{ route: l[0], methode: m[1] ?? '', chemin: m[2] ?? '', sorte: l[1] as Sorte, n, pannes, partPannes: n ? pannes / n : null,
      p50: assez ? quantile(h, 0.5) : null, p95: assez ? quantile(h, 0.95) : null, p99: assez ? quantile(h, 0.99) : null, lentes: lentes(h) }];
  });
}

// Les exemplaires du programme qui ont répondu dans l'heure : vu dans les cinq dernières minutes, il sert ; plus loin, il
// s'est tu (ou ne reçoit plus rien, ce que la console ne sait pas distinguer d'ici, et le dit).
export const SILENCE_MIN = 5;
export function exemplaires(brut: unknown, maintenant: Date) {
  return (Array.isArray(brut) ? brut : []).flatMap((l: unknown) => {
    if (!Array.isArray(l) || typeof l[0] !== 'string') return [];
    const derniere = date(l[4]);
    const n = nombre(l[1]);
    const silence = derniere ? Math.max(0, Math.round((maintenant.getTime() - Date.parse(derniere)) / 60_000)) : null;
    return [{ nom: l[0], n, pannes: nombre(l[2]), parMinute: Math.round((n / 60) * 10) / 10, derniere, silence,
      etat: (silence !== null && silence <= SILENCE_MIN ? 'bon' : 'attention') as EtatPart }];
  });
}

// La base PostgreSQL, telle qu'elle se compte depuis sa dernière remise à zéro : des nombres, rien d'autre.
export function laBase(brut: unknown) {
  const b = (brut && typeof brut === 'object' ? brut : null) as Record<string, unknown> | null;
  if (!b) return null;
  const memoire = nombre(b.lusEnMemoire), disque = nombre(b.lusSurDisque);
  const commits = nombre(b.commits), annulations = nombre(b.annulations);
  return {
    connexions: nombre(b.connexions), maxConnexions: nombre(b.maxConnexions) || null,
    // La part des lectures servies par la mémoire : sans lecture, rien à dire.
    enMemoire: memoire + disque > 0 ? memoire / (memoire + disque) : null,
    annulations: commits + annulations > 0 ? annulations / (commits + annulations) : null,
    blocages: nombre(b.blocages), fichiersTemporaires: nombre(b.fichiersTemporaires), octetsTemporaires: nombre(b.octetsTemporaires),
    taille: nombre(b.taille), depuis: date(b.depuis),
  };
}

// ── La comparaison avec la période d'avant ────────────────────────────────────────────────────────────────────────────
// Elle se lit dans la même table que la période : les minutes sont gardées trois jours, les heures trente-cinq. Une
// période dont celle d'avant n'est plus gardée n'a pas de comparaison — jamais une courbe à zéro qui ferait croire à un
// service vide.
export const GARDE_MS = { minute: 3 * 86_400_000, heure: 35 * 86_400_000 } as const;
export const comparable = (p: { duree: number; grain: 'minute' | 'heure' }) => 2 * p.duree <= GARDE_MS[p.grain];

// La période d'avant, telle que l'écran la pose derrière celle du moment. Deux pièges, et la raison de cette fonction :
//   - la base lit une série depuis son début, sans fin : ses totaux compteraient aussi la période du moment ;
//   - son dernier pas est fini (il est dans le passé) : son débit se compte sur le pas entier, jamais sur ce qu'il en
//     restait au même instant de la veille, qui le gonflerait.
// On ne garde donc que ses pas, et on refait son débit et ses totaux sur eux.
export function periodeDAvant(points: readonly { n: number; pannes: number }[], pas: number) {
  const minutes = pas / 60_000;
  const lus = points.map((p) => ({ n: p.n, pannes: p.pannes, parMinute: Math.round((p.n / minutes) * 10) / 10 }));
  const n = lus.reduce((s, p) => s + p.n, 0), pannes = lus.reduce((s, p) => s + p.pannes, 0);
  return { points: lus, total: { n, pannes, partPannes: n ? pannes / n : null } };
}
