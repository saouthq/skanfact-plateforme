// Les mesures du service (Console 3, docs/console.md C12 ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 7, et
// VISION-ARCHITECTURE.md § 6 pour les budgets). Ce que le serveur mesure de lui-même, requête par requête : combien de
// requêtes, combien de pannes, et la durée de chacune, rangée dans un seau. Chaque exemplaire du programme range ses
// mesures minute par minute ; la console les additionne.
//
// Jamais une donnée de client (06 S4) : une route se dit par son MODÈLE de chemin (« /entreprises/:entreprise/factures »),
// jamais par l'adresse appelée ; ni l'entreprise, ni la personne, ni le corps, ni le statut exact.
//
// Ce fichier est pur (tests/service/mesures.test.ts) ; la collecte vit dans serveur/service/collecte.ts.

// ── Les seaux ────────────────────────────────────────────────────────────────────────────────────────────────────────
// La borne haute de chaque seau, en millisecondes : à partir de 10 ms, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80 par
// décade (un pas de 25 % au plus ; en dessous, à la milliseconde). Chaque budget écrit (§ 6 : 200 ms, 300 ms, 1 s, 5 s) est une borne : « 95 % sous le budget » se lit exactement,
// et une durée se dit par la borne de son seau (« moins de 250 ms »), jamais par un chiffre qu'on n'a pas mesuré.
export const SEAUX_MS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800,
  1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000,
];
// Un seau de plus pour ce qui dépasse la dernière borne (une minute).
export const NB_SEAUX = SEAUX_MS.length + 1;

export type Histogramme = number[];
export const histogrammeVide = (): Histogramme => new Array<number>(NB_SEAUX).fill(0);

// Le seau d'une durée : le premier dont la borne la contient (une durée égale à une borne y entre).
export function seauDe(ms: number): number {
  if (!Number.isFinite(ms) || ms <= (SEAUX_MS[0] ?? 1)) return 0;
  let bas = 0, haut = SEAUX_MS.length;
  while (bas < haut) {
    const m = (bas + haut) >> 1;
    if ((SEAUX_MS[m] ?? Infinity) < ms) bas = m + 1; else haut = m;
  }
  return bas;
}

export function ajouter(h: Histogramme, ms: number): void { const i = seauDe(ms); h[i] = (h[i] ?? 0) + 1; }

// Deux histogrammes en un (deux minutes, deux exemplaires) : jamais deux moyennes qu'on additionnerait.
export function fusionner(a: Histogramme, b: readonly number[]): Histogramme {
  for (let i = 0; i < NB_SEAUX; i++) a[i] = (a[i] ?? 0) + (Number(b[i]) || 0);
  return a;
}

export const total = (h: readonly number[]) => h.reduce((s, n) => s + n, 0);

// Le temps sous lequel passe la part `q` des requêtes (0,95 : « 95 % des requêtes en moins de… ») : la borne du seau qui
// contient la requête de ce rang. `null` sans requête ; `Infinity` au-delà de la dernière borne.
export function quantile(h: readonly number[], q: number): number | null {
  const n = total(h);
  if (n === 0) return null;
  const rang = Math.max(1, Math.ceil(q * n));
  let vus = 0;
  for (let i = 0; i < NB_SEAUX; i++) {
    vus += h[i] ?? 0;
    if (vus >= rang) return SEAUX_MS[i] ?? Infinity;
  }
  return Infinity;
}

// La part des requêtes qui passent sous un budget (une borne de seau : c'est exact). `null` sans requête.
export function partSous(h: readonly number[], budgetMs: number): number | null {
  const n = total(h);
  if (n === 0) return null;
  const i = SEAUX_MS.indexOf(budgetMs);
  if (i < 0) throw new Error(`un budget est une borne de seau : ${budgetMs} ms n'en est pas une`);
  let sous = 0;
  for (let k = 0; k <= i; k++) sous += h[k] ?? 0;
  return sous / n;
}

// ── Les sortes et leurs budgets ──────────────────────────────────────────────────────────────────────────────────────
// Chaque requête de l'API est d'une sorte, et chaque sorte a le budget que VISION § 6 a écrit avant la mesure (un seuil
// s'écrit d'abord ; une mesure qui dépasse change le plan, pas le seuil). Une sorte sans budget écrit le dit (`null`) :
// on n'en invente pas un pour colorer un chiffre.
export const SORTES = ['lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console'] as const;
export type Sorte = typeof SORTES[number];
export const BUDGETS: Readonly<Record<Sorte, number | null>> = {
  // « Afficher une liste, une fiche : < 300 ms côté serveur (95 % des requêtes) ».
  lecture: 300,
  // « Encaisser un ticket à la caisse : < 200 ms ».
  caisse: 200,
  // « Balance, grand livre, TVA du mois d'une PME (10 ans d'historique) : < 1 s ».
  comptes: 1000,
  // Le dossier entier qu'ouvre l'application de bureau : le budget écrit (« ouvrir l'application : < 2 s ») est celui du
  // poste, réseau compris ; le serveur n'en mesure qu'une part.
  dossier: null,
  // Enregistrer, émettre : aucun budget écrit.
  ecriture: null,
  // La console elle-même.
  console: null,
};

// Les routes dont la sorte n'est pas celle que dit leur méthode. Écrites ici, une fois ; un test exige que chacune existe
// parmi les routes déclarées (une route renommée retomberait sinon dans « lecture » sans un mot).
export const SORTE_PAR_ROUTE: Readonly<Record<string, Sorte>> = {
  'POST /entreprises/:entreprise/dossier-v10/ticket': 'caisse',
  'GET /entreprises/:entreprise/compta/balance': 'comptes',
  'GET /entreprises/:entreprise/compta/grand-livre': 'comptes',
  'GET /entreprises/:entreprise/compta/declarations': 'comptes',
  'GET /entreprises/:entreprise/compta/annuel/:annee': 'comptes',
  'GET /entreprises/:entreprise/dossier-v10': 'dossier',
};

// La sorte d'une route déclarée (`chemin` sans la version de l'API).
export function sorteDe(methode: string, chemin: string): Sorte {
  const exprès = SORTE_PAR_ROUTE[`${methode} ${chemin}`];
  if (exprès) return exprès;
  if (chemin.startsWith('/console/')) return 'console';
  return methode === 'GET' ? 'lecture' : 'ecriture';
}

// Une panne est une réponse 5xx : le serveur n'a pas su répondre. Un refus écrit (un droit qui manque, une période close,
// un mauvais mot de passe : 4xx) n'en est pas une.
export const estPanne = (statut: number) => statut >= 500;
// La part de pannes au-delà de laquelle le service ne va pas (06 § 7 : « taux d'erreurs au-dessus de 1 % pendant 5
// minutes »). Écrite ici, une fois : la console la trace sur ses graphiques.
export const SEUIL_PANNES = 0.01;
// Un centile se lit sur assez de requêtes : sous vingt, le « 95 % » serait la plus lente d'entre elles, et une seule
// lecture lente la nuit dessinerait un pic au-dessus du budget. La console le dit (« trop peu »), sans courbe ; la veille
// ne juge pas le temps de réponse d'une minute qui en a moins.
export const LECTURES_POUR_UN_CENTILE = 20;
