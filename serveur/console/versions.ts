// Les versions du service (Console 3e ; skanfact docs/cadrage/10-console.md § 2.8 ; docs/console.md C27) : la version en
// service et celle d'avant, la prochaine et où elle en est (la vérification de l'envoi, toutes les preuves, le suiveur),
// les consignes données au suiveur (geler, retenir, revenir), l'historique des installations, les tâches d'entretien et
// la machine. Pur (testé : tests/console/versions.test.ts) : la route lit l'état du suiveur (etat.json, qu'il écrit à
// chaque tour), la base et la machine ; ces fonctions rangent. Rien n'est inventé : ce que le serveur ne sait pas (les
// versions des postes de nos clients, la pré-production, les deux exemplaires) n'est pas montré.

export type Verdict = 'vert' | 'rouge' | 'en_cours';
export type Verification = 'aucune' | 'github' | 'toutes';
export type Commit = { version: string; titre: string; le: string; verification: Verdict | null; preuves: Verdict | null; plusRecente: boolean };
export type Installation = { version: string; debut: string; fin: string; ok: boolean; etape: string | null; retour: boolean };
export type Tache = { nom: string; ok: boolean; le: string; sortie: string | null };
export type EtatSuiveur = {
  version: string | null; installeeLe: string | null; regardeLe: string | null; derniere: string | null;
  echec: { version: string; etape: string; message: string; le: string } | null;
  taches: Tache[]; verification: Verification | null; commits: Commit[]; installations: Installation[];
  consignes: { lues: string; gel: { jusquAu: string } | null; retenues: string[]; retour: { id: string; version: string } | null } | null;
  plan: string | null;
  // 1.29.0 (l'audit C04) : l'heure du dernier tour qui n'a pas pu lire les consignes ; il n'a rien installé.
  consignesIllisibles: string | null;
  // Le numéro que chaque version déclare (« 1.4.2 ») ; une version absente ou sans numéro se dit par son identifiant court.
  numeros: Record<string, string>;
};

const SHA = /^[0-9a-f]{40}$/;
// Le même motif que le suiveur (exploitation/suivre.ts, NUMERO) : ce qu'il n'écrirait pas ne se lit pas. Le pied du menu
// de l'application des clients le lit aussi (serveur/ecrans.ts).
export const NUMERO = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9a-z.]{1,20})?$/;
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const sha = (x: unknown) => (typeof x === 'string' && SHA.test(x) ? x : null);
const texte = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object' && !Array.isArray(y)) : []);
const verdict = (x: unknown): Verdict | null => (x === 'vert' || x === 'rouge' || x === 'en_cours' ? x : null);
// La première ligne non vide d'un message (une sortie de commande peut porter un chemin ou une pile : on n'en garde pas
// plus que ce qui dit la cause).
const premiereLigne = (x: unknown, max: number) => texte(typeof x === 'string' ? x.split('\n').map((l) => l.trim()).find(Boolean) : null, max);
const derniereLigne = (x: unknown, max: number) => texte(typeof x === 'string' ? x.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) : null, max);

// L'état écrit par le suiveur, relu prudemment : une ligne mal formée ne compte pas, ce qui manque vaut « on ne sait pas ».
export function lireEtatSuiveur(brut: unknown): EtatSuiveur {
  const b = objet(brut);
  const e = objet(b.echec);
  const c = b.consignes === null || b.consignes === undefined ? null : objet(b.consignes);
  const g = c ? objet(c.gel) : {};
  const r = c ? objet(c.retour) : {};
  const version = sha(b.version);
  const commits = tableau(b.commits).flatMap((x) => {
    const v = sha(x.version), le = date(x.le);
    return v && le && typeof x.titre === 'string' ? [{ version: v, titre: x.titre.slice(0, 200), le, verification: verdict(x.verification), preuves: verdict(x.preuves),
      plusRecente: 'verification' in x || 'preuves' in x }] : [];
  });
  return {
    version, installeeLe: date(b.installeeLe), regardeLe: date(b.regardeLe), derniere: sha(b.derniere),
    echec: sha(e.version) && date(e.le) ? { version: sha(e.version) as string, etape: texte(e.etape, 40) ?? 'installation', message: premiereLigne(e.message, 300) ?? '', le: date(e.le) as string } : null,
    taches: tableau(b.taches).flatMap((t) => (typeof t.nom === 'string' && /^\d{4}-[a-z0-9-]+\.sh$/.test(t.nom) && date(t.le)
      ? [{ nom: t.nom, ok: t.ok === true, le: date(t.le) as string, sortie: t.ok === true ? null : derniereLigne(t.sortie, 200) }] : [])),
    verification: b.verification === 'aucune' || b.verification === 'github' || b.verification === 'toutes' ? b.verification : null,
    commits,
    installations: tableau(b.installations).flatMap((i) => (sha(i.version) && date(i.debut) && date(i.fin)
      ? [{ version: sha(i.version) as string, debut: date(i.debut) as string, fin: date(i.fin) as string, ok: i.ok === true, etape: texte(i.etape, 40), retour: i.retour === true }] : [])),
    consignes: c && date(c.lues) ? {
      lues: date(c.lues) as string, gel: date(g.jusquAu) ? { jusquAu: date(g.jusquAu) as string } : null,
      retenues: Array.isArray(c.retenues) ? c.retenues.map(sha).filter((x): x is string => x !== null) : [],
      retour: typeof r.id === 'string' && sha(r.version) ? { id: r.id, version: sha(r.version) as string } : null,
    } : null,
    plan: texte(b.plan, 40),
    consignesIllisibles: date(b.consignesIllisibles),
    numeros: Object.fromEntries(Object.entries(objet(b.numeros)).filter((x): x is [string, string] => SHA.test(x[0]) && typeof x[1] === 'string' && NUMERO.test(x[1]))),
  };
}

// Ce que la base dit des versions : les migrations, chaque version vue tourner par la veille, les consignes.
export type Migration = { numero: number; nom: string; le: string };
export type VueParLaVeille = { version: string; debut: string; fin: string; sansReponse: number };
export type Consigne = {
  id: string; sorte: 'gel' | 'retenue' | 'retour'; version: string | null; quitte: string | null; jusquAu: string | null; motif: string;
  par: string; le: string; enVigueur: boolean; faiteLe: string | null; faiteOk: boolean | null; faiteRaison: string | null;
  leveeLe: string | null; leveePar: string | null; leveeMotif: string | null;
};
export type VersionsDeLaBase = { migrations: Migration[]; versions: VueParLaVeille[]; consignes: Consigne[]; postgres: string | null };
export function lireVersionsDeLaBase(brut: unknown): VersionsDeLaBase {
  const b = objet(brut);
  return {
    migrations: tableau(b.migrations).flatMap((m) => (Number.isInteger(m.numero) && typeof m.nom === 'string' && date(m.le)
      ? [{ numero: m.numero as number, nom: m.nom, le: date(m.le) as string }] : [])),
    versions: tableau(b.versions).flatMap((v) => (sha(v.version) && date(v.debut) && date(v.fin)
      ? [{ version: sha(v.version) as string, debut: date(v.debut) as string, fin: date(v.fin) as string, sansReponse: Number.isInteger(v.sansReponse) ? v.sansReponse as number : 0 }] : [])),
    consignes: tableau(b.consignes).flatMap((c) => (typeof c.id === 'string' && (c.sorte === 'gel' || c.sorte === 'retenue' || c.sorte === 'retour') && date(c.le)
      ? [{
        id: c.id, sorte: c.sorte, version: sha(c.version), quitte: sha(c.quitte), jusquAu: date(c.jusquAu), motif: typeof c.motif === 'string' ? c.motif : '',
        par: typeof c.par === 'string' ? c.par : '', le: date(c.le) as string, enVigueur: c.enVigueur === true, faiteLe: date(c.faiteLe),
        faiteOk: typeof c.faiteOk === 'boolean' ? c.faiteOk : null, faiteRaison: texte(c.faiteRaison, 40),
        leveeLe: date(c.leveeLe), leveePar: texte(c.leveePar, 200), leveeMotif: texte(c.leveeMotif, 500),
      }] : [])),
    // « 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) » : le numéro suffit.
    postgres: texte(typeof b.postgres === 'string' ? b.postgres.split(' ')[0] : null, 40),
  };
}

// Les migrations passées pendant une installation (de son début à une minute après sa fin : migrer tourne avant le
// redémarrage, mais une horloge peut avoir quelques secondes d'écart).
export const migrationsDe = (i: { debut: string; fin: string }, m: readonly Migration[]) =>
  m.filter((x) => Date.parse(x.le) >= Date.parse(i.debut) - 60_000 && Date.parse(x.le) <= Date.parse(i.fin) + 60_000).map((x) => x.numero).sort((a, b) => a - b);

// L'historique, de la plus récente à la plus ancienne. Le fil, ce sont les installations notées par le suiveur (avec
// leur durée, leur réussite, le retour demandé) ; une version que la veille a vue tourner sans que le suiveur l'ait notée
// (avant qu'il ne note, ou posée à la main) s'y ajoute, sans durée. Une installation réussie se rattache à la suite de
// relevés qui a commencé dans le quart d'heure après sa fin : les minutes sans réponse de son arrivée.
export type Ligne = {
  version: string; le: string; dureeS: number | null; ok: boolean; etape: string | null; retour: boolean; migrations: number[];
  sansReponse: number | null; statut: 'en_service' | 'remplacee' | 'echouee'; remplaceePar: string | null; source: 'suiveur' | 'veille';
};
export function historique(e: EtatSuiveur, b: VersionsDeLaBase): Ligne[] {
  const vues = [...b.versions].sort((x, y) => Date.parse(x.debut) - Date.parse(y.debut));
  const prises = new Set<VueParLaVeille>();
  const lignes: Omit<Ligne, 'statut' | 'remplaceePar'>[] = e.installations.map((i) => {
    const vue = i.ok ? vues.find((v) => !prises.has(v) && v.version === i.version && Date.parse(v.debut) >= Date.parse(i.debut) - 60_000
      && Date.parse(v.debut) <= Date.parse(i.fin) + 15 * 60_000) : undefined;
    if (vue) prises.add(vue);
    return { version: i.version, le: i.ok ? i.fin : i.debut, dureeS: Math.max(0, Math.round((Date.parse(i.fin) - Date.parse(i.debut)) / 1000)), ok: i.ok, etape: i.ok ? null : i.etape,
      retour: i.retour, migrations: migrationsDe(i, b.migrations), sansReponse: vue ? vue.sansReponse : null, source: 'suiveur' as const };
  });
  // La plus ancienne suite des relevés tournait déjà au premier relevé : on ne sait pas quand elle est arrivée.
  for (const v of vues.slice(1)) {
    if (!prises.has(v)) lignes.push({ version: v.version, le: v.debut, dureeS: null, ok: true, etape: null, retour: false, migrations: [], sansReponse: v.sansReponse, source: 'veille' });
  }
  lignes.sort((x, y) => Date.parse(y.le) - Date.parse(x.le));
  // La version en service est la plus récente installation réussie de la version que le suiveur dit en service ; chaque
  // autre réussie a été remplacée par la réussie qui la suit.
  let suivante: string | null = null;
  let enServiceVue = false;
  return lignes.map((l) => {
    if (!l.ok) return { ...l, statut: 'echouee' as const, remplaceePar: null };
    const enService = !enServiceVue && l.version === e.version;
    if (enService) enServiceVue = true;
    const ligne = { ...l, statut: enService ? 'en_service' as const : 'remplacee' as const, remplaceePar: enService ? null : suivante };
    suivante = l.version;
    return ligne;
  });
}

// La version d'avant : la dernière réussie avant celle en service. On peut y revenir si elle est parmi les trente
// dernières du dépôt (le suiveur n'installe que celles-là) — sinon l'écran le dit.
export function versionDAvant(h: readonly Ligne[], e: EtatSuiveur): { version: string; le: string; possible: boolean } | null {
  const i = h.findIndex((l) => l.statut === 'en_service');
  const avant = h.slice(i + 1).find((l) => l.ok && l.version !== e.version);
  if (i < 0 || !avant) return null;
  return { version: avant.version, le: avant.le, possible: e.commits.some((c) => c.version === avant.version) };
}

// La prochaine version : la plus récente du dépôt qui n'est pas encore en service. Où elle en est : retenue (par une
// consigne, ou parce qu'une version plus récente qu'elle l'est), gelée, échouée (le suiveur ne la retente pas), rouge à
// une vérification, en attente d'une vérification, ou prête (le suiveur la prend à son prochain tour).
export type Prochaine = Commit & { etat: 'retenue' | 'gelee' | 'bloquee' | 'echouee' | 'rouge' | 'attend_verification' | 'attend_preuves' | 'prete'; nombre: number };
export function prochaine(e: EtatSuiveur, consignes: readonly Consigne[], maintenant: Date): Prochaine | null {
  const recentes = e.commits.filter((c) => c.plusRecente);
  const p = recentes[0];
  if (!p || p.version === e.version) return null;
  const retenues = new Set(consignes.filter((c) => c.enVigueur && (c.sorte === 'retenue' || c.sorte === 'retour')).map((c) => (c.sorte === 'retour' ? c.quitte : c.version)));
  // (Une retenue retient aussi les versions d'avant elle ; la prochaine est la plus récente du dépôt : seule une retenue
  // posée sur elle la retient.)
  const retenue = retenues.has(p.version);
  const gel = consignes.find((c) => c.enVigueur && c.sorte === 'gel' && c.jusquAu && Date.parse(c.jusquAu) > maintenant.getTime());
  const etat: Prochaine['etat'] = retenue ? 'retenue' : e.echec?.version === p.version ? 'echouee'
    : p.verification === 'rouge' || p.preuves === 'rouge' ? 'rouge'
      : e.verification !== 'aucune' && p.verification !== 'vert' ? 'attend_verification'
        : e.verification === 'toutes' && p.preuves !== 'vert' ? 'attend_preuves'
          // 1.29.0 (l'audit C04) : consignes illisibles au dernier tour, le suiveur n'installe rien.
          : gel ? 'gelee' : e.consignesIllisibles ? 'bloquee' : 'prete';
  return { ...p, etat, nombre: recentes.length };
}

// Les tâches d'entretien : celles du dépôt (leur titre, la première phrase de leur en-tête) et ce que le suiveur en a
// noté. Une tâche du dépôt que le suiveur n'a pas notée n'a pas encore tourné ; une tâche notée échouée dit sa dernière
// ligne de sortie.
export const TITRE_TACHE_MAX = 120;
export function titreDeTache(source: string): string | null {
  const entete = source.split('\n').filter((l) => l.startsWith('#') && !l.startsWith('#!')).map((l) => l.replace(/^#\s?/, '')).join(' ');
  const m = /^Tâche d'entretien \d{4}(?: \([^)]*\))? : (.+)$/.exec(entete.trim());
  if (!m?.[1]) return null;
  // La première proposition, sans ce qui renvoie à un fichier ou à une section (« (docs/…, I) ») : ce n'est pas pour l'écran.
  const sansRenvoi = m[1].replace(/\s*\([^)]*(?:\/|\.(?:ts|md|json|sh)\b|§)[^)]*\)/g, '');
  const brute = (sansRenvoi.split(/ ; |\. /)[0] ?? '').trim().replace(/[.,:]$/, '');
  if (!brute) return null;
  if (brute.length <= TITRE_TACHE_MAX) return brute;
  // Trop long : coupé à un mot entier, et dit coupé.
  const coupe = brute.slice(0, TITRE_TACHE_MAX);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), 40)).replace(/[\s,;:]+$/, '')}…`;
}
export function taches(depot: readonly { nom: string; titre: string | null }[], e: EtatSuiveur) {
  const notees = new Map(e.taches.map((t) => [t.nom, t]));
  return [...depot].sort((a, b) => a.nom.localeCompare(b.nom)).map((t) => {
    const n = notees.get(t.nom);
    return { numero: t.nom.slice(0, 4), nom: t.nom, titre: t.titre, etat: n ? (n.ok ? 'passee' as const : 'echouee' as const) : 'pas_encore' as const, le: n?.le ?? null, sortie: n?.sortie ?? null };
  });
}

// La machine : le système, Node, PostgreSQL ; les correctifs du système (unattended-upgrades, posé par l'installation)
// et le redémarrage qu'ils demandent. Ce qui n'a pas été lu vaut null.
export function systemeDe(osRelease: string | null): string | null {
  const m = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(osRelease ?? '');
  return m?.[1]?.trim().slice(0, 80) ?? null;
}
