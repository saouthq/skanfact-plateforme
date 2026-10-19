// Les travaux et les envois du service (Console 3e ; skanfact docs/cadrage/10-console.md § 2.8 ; docs/console.md C25) :
// ce que le serveur fait seul (ses tours) et ce qu'il envoie aux partenaires (la TTN, la signature, les SMS, les paiements,
// les relances d'abonnement, les e-mails depuis 0115), quatorze jours par partenaire, et ce qui reste à regarder. Pur
// (testé : tests/console/travaux.test.ts) : la route lit la base ; ces fonctions rangent. Rien n'est inventé : un
// partenaire sans trace (la TEJ, la CNSS) est dit « pas encore branché », jamais à zéro.

// Les tours du serveur (serveur/principal.ts), dans l'ordre de la page, avec le rythme qu'on attend d'eux : un tour qui
// n'est pas passé depuis trois de ses pas s'est arrêté.
// `branche` : ce dont le tour a besoin pour tourner (sans relais d'e-mails, le postier et les relances ne partent pas).
export const TOURS = [
  { nom: 'facteur', pasMs: 60_000, branche: 'ttn' },
  { nom: 'paiements', pasMs: 60_000, branche: null },
  { nom: 'livreur', pasMs: 60_000, branche: null },
  { nom: 'postier', pasMs: 60_000, branche: 'courriel' },
  { nom: 'contrats', pasMs: 3_600_000, branche: null },
  { nom: 'relances', pasMs: 3_600_000, branche: 'courriel' },
  { nom: 'mesureur', pasMs: 60_000, branche: null },
  // La relecture des chaînes d'empreintes (0115) : chaque heure.
  { nom: 'chaines', pasMs: 3_600_000, branche: null },
  // Les périodes payées d'avance qui commencent (0121) : chaque heure, ce qu'elles changent s'applique à leur jour.
  { nom: 'echeances', pasMs: 3_600_000, branche: null },
] as const;
export type NomTour = typeof TOURS[number]['nom'];
export const ARRETE_APRES_PAS = 3;

export const PARTENAIRES = ['ttn', 'signature', 'sms', 'paiements', 'relances', 'courriel'] as const;
export type Partenaire = typeof PARTENAIRES[number];
// Sans trace qu'on puisse compter : l'écran les nomme, sans carte vide. (Les e-mails en laissent une depuis 0115 : l'instant,
// et s'ils sont partis.) La TEJ et la CNSS : le fichier se prépare dans l'application, rien ne part encore du serveur.
export const SANS_TRACE = ['tej', 'cnss'] as const;

export type TourLu = { nom: string; le: string; dureeMs: number; ok: boolean; compte: Record<string, number>; echecLe: string | null; echec: string | null };
export type JourLu = { jour: string; n: number; bons: number; refus: number };
// `entreprise` : pour la direction seulement ; la technique ne reçoit aucun identifiant de client (03 § 5 ; 0114).
export type ARegarder = {
  sorte: 'ttn' | 'signature' | 'paiement'; cle: string; entreprise: { id: string; nom: string } | null;
  statut: string; essais: number | null; prochain: string | null; deposeLe: string | null; depuis: string;
  motif: { cle: string; valeurs: Record<string, unknown> } | null; pieces: number | null;
};
export type TravauxLus = {
  jour: string; tours: TourLu[];
  partenaires: Record<Partenaire, JourLu[]>;
  ttn: { enFile: number; medianeS: number | null };
  aRegarder: ARegarder[];
};

const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const jour = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const entier = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});

// Chaque partenaire dit ses « bons » et ses « refus » avec ses mots ; on les range sous deux noms.
const CHAMPS: Record<Partenaire, { bons: string | null; refus: string | null }> = {
  ttn: { bons: 'acceptes', refus: 'refuses' },
  signature: { bons: 'reussies', refus: 'echouees' },
  sms: { bons: null, refus: null },
  paiements: { bons: 'encaisses', refus: 'echoues' },
  relances: { bons: null, refus: null },
  courriel: { bons: 'envoyes', refus: 'echoues' },
};

export function lireTravaux(brut: unknown): TravauxLus {
  const b = objet(brut);
  const partenaires = Object.fromEntries(PARTENAIRES.map((p) => {
    const c = CHAMPS[p];
    return [p, tableau(objet(b[p]).jours).flatMap((j) => {
      const d = jour(j.jour), n = entier(j.n);
      if (!d || n === null) return [];
      return [{ jour: d, n, bons: c.bons ? entier(j[c.bons]) ?? 0 : n, refus: c.refus ? entier(j[c.refus]) ?? 0 : 0 }];
    })];
  })) as Record<Partenaire, JourLu[]>;
  const ttn = objet(b.ttn);
  return {
    jour: jour(b.jour) ?? '',
    tours: tableau(b.tours).flatMap((t) => {
      const le = date(t.le);
      if (typeof t.nom !== 'string' || !le || typeof t.ok !== 'boolean') return [];
      const compte = Object.fromEntries(Object.entries(objet(t.compte)).filter(([, v]) => entier(v) !== null)) as Record<string, number>;
      return [{ nom: t.nom, le, dureeMs: entier(t.dureeMs) ?? 0, ok: t.ok, compte, echecLe: date(t.echecLe), echec: typeof t.echec === 'string' ? t.echec : null }];
    }),
    partenaires,
    ttn: { enFile: entier(ttn.enFile) ?? 0, medianeS: entier(ttn.medianeS) },
    aRegarder: tableau(b.aRegarder).flatMap((r) => {
      const depuis = date(r.depuis), e = objet(r.entreprise), m = objet(r.motif);
      if (!['ttn', 'signature', 'paiement'].includes(r.sorte as string) || !depuis || typeof r.cle !== 'string' || typeof r.statut !== 'string') return [];
      return [{
        sorte: r.sorte as ARegarder['sorte'], cle: r.cle, entreprise: typeof e.id === 'string' && typeof e.nom === 'string' ? { id: e.id, nom: e.nom } : null,
        statut: r.statut, essais: entier(r.essais), prochain: date(r.prochain), deposeLe: date(r.deposeLe), depuis,
        motif: typeof m.cle === 'string' ? { cle: m.cle, valeurs: objet(m.valeurs) } : null, pieces: entier(r.pieces),
      }];
    }),
  };
}

// Les quatorze jours d'un partenaire, aujourd'hui compris ; un jour sans envoi vaut zéro (la trace existe : rien n'est parti).
export function quatorzeJours(jours: readonly JourLu[], aujourdhui: string): JourLu[] {
  const t = Date.parse(`${aujourdhui}T00:00:00Z`);
  return Array.from({ length: 14 }, (_, k) => {
    const d = new Date(t - (13 - k) * 86_400_000).toISOString().slice(0, 10);
    return jours.find((j) => j.jour === d) ?? { jour: d, n: 0, bons: 0, refus: 0 };
  });
}

// Qui attend quoi : une panne se réessaie seule ; un refus ou un compte retenu attend l'entreprise.
export type Attente = 'seul' | 'entreprise';
export function attenteDe(r: ARegarder): Attente {
  if (r.sorte === 'ttn' && (r.statut === 'a_envoyer' || r.statut === 'deposee') && !(r.motif?.cle ?? '').includes('compte')) return 'seul';
  return 'entreprise';
}

// L'état d'un tour : passé à son rythme, en échec à son dernier passage, ou arrêté (plus vu depuis trois pas). Un tour
// jamais vu n'est ni bon ni arrêté : il n'a pas encore laissé de trace (un serveur d'avant cette version).
export type EtatTour = 'bon' | 'echec' | 'arrete' | 'jamais';
export function etatTour(nom: NomTour, tours: readonly TourLu[], maintenant: Date): { etat: EtatTour; tour: TourLu | null } {
  const t = tours.find((x) => x.nom === nom) ?? null;
  if (!t) return { etat: 'jamais', tour: null };
  const pas = TOURS.find((x) => x.nom === nom)?.pasMs ?? 60_000;
  if (maintenant.getTime() - Date.parse(t.le) > ARRETE_APRES_PAS * pas) return { etat: 'arrete', tour: t };
  return { etat: t.ok ? 'bon' : 'echec', tour: t };
}

// ── La suite (0145 ; docs/console.md C69) : les pauses, le débit heure par heure, ce qui ne part plus ─────────────────
// Ce qui se met en pause : ce que le serveur envoie seul. Une heure, quatre heures ou un jour, jamais plus.
export const PAUSABLES = ['ttn', 'relances'] as const;
export type Pausable = typeof PAUSABLES[number];
export const DUREES_PAUSE = [1, 4, 24] as const;
// Un envoi à la TTN en panne (ou sans réponse) depuis plus de quatre heures se dit en tête d'« À décider » du service :
// la TTN ne cesse jamais d'essayer, mais quelqu'un doit savoir qu'elle n'y arrive pas.
export const EN_PANNE_HEURES = 4;

export type Pause = { id: string; partenaire: Pausable; le: string; jusquAu: string; motif: string; par: string; leveeLe: string | null; enCours: boolean };
export type HeureLue = { heure: string; n: number; bons: number; refus: number };
export type SuiteLue = { pauses: Pause[]; heures: Record<Partenaire, HeureLue[]>; enPanne: { n: number; depuis: string | null } };

export function lireSuite(brut: unknown): SuiteLue {
  const b = objet(brut), h = objet(b.heures), p = objet(b.enPanne);
  return {
    pauses: tableau(b.pauses).flatMap((x) => {
      const [le, jusquAu] = [date(x.le), date(x.jusquAu)];
      if (typeof x.id !== 'string' || !PAUSABLES.includes(x.partenaire as Pausable) || !le || !jusquAu) return [];
      return [{ id: x.id, partenaire: x.partenaire as Pausable, le, jusquAu, motif: typeof x.motif === 'string' ? x.motif : '', par: typeof x.par === 'string' ? x.par : '',
        leveeLe: date(x.leveeLe), enCours: x.enCours === true }];
    }),
    heures: Object.fromEntries(PARTENAIRES.map((nom) => [nom, tableau(h[nom]).flatMap((x) => {
      const heure = date(x.heure), n = entier(x.n);
      return heure && n !== null ? [{ heure: new Date(heure).toISOString(), n, bons: entier(x.bons) ?? 0, refus: entier(x.refus) ?? 0 }] : [];
    })])) as Record<Partenaire, HeureLue[]>,
    enPanne: { n: entier(p.n) ?? 0, depuis: date(p.depuis) },
  };
}

// Les vingt-quatre dernières heures d'un partenaire, l'heure en cours comprise : une heure sans envoi vaut zéro.
export function vingtQuatreHeures(heures: readonly HeureLue[], maintenant: Date): HeureLue[] {
  const fin = Math.floor(maintenant.getTime() / 3_600_000) * 3_600_000;
  return Array.from({ length: 24 }, (_, k) => {
    const heure = new Date(fin - (23 - k) * 3_600_000).toISOString();
    return heures.find((x) => x.heure === heure) ?? { heure, n: 0, bons: 0, refus: 0 };
  });
}
// La pause en cours d'un partenaire, s'il en a une.
export const pauseEnCours = (pauses: readonly Pause[], partenaire: Pausable, maintenant: Date): Pause | null =>
  pauses.find((x) => x.partenaire === partenaire && x.enCours && Date.parse(x.jusquAu) > maintenant.getTime()) ?? null;
