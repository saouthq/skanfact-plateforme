// La sécurité du service (Console 3e ; skanfact docs/cadrage/10-console.md § 2.8, 03 § 6 ; docs/console.md C26) : ce
// que les règles de connexion ont fait sur vingt-quatre heures, ce qui demande un regard, l'équipe et ses appareils, les
// règles qui freinent, et qui peut commander le serveur. Pur (testé : tests/console/securite.test.ts) : la route lit la
// base et le fichier des clés ; ces fonctions rangent. Rien n'est inventé : une règle dont le serveur ne garde pas le
// compte (ses seaux vivent en mémoire) dit « — », jamais zéro.

import { LIMITES_PAR_ADRESSE, LIMITES_PAR_DEFAUT } from '../limites.ts';

// L'attente qui s'allonge après des mots de passe faux (base 0002, socle.noter_erreur) : 1, 5, 15 puis 60 minutes, à
// partir de la cinquième erreur. Recopiée ici pour être DITE ; un test la confronte à la fonction de la base.
export const ERREURS_AVANT_ATTENTE = 5;
export const ATTENTES_MIN = [1, 5, 15, 60] as const;
// Les codes par SMS (base 0081, socle.sms_permis) : par personne, cinq par heure et vingt par jour.
export const SMS_PAR_HEURE = 5;
export const SMS_PAR_JOUR = 20;
// Un appareil reconnu, une session (base 0002) : trente jours ; douze heures sans geste, trente minutes sur le poste d'un autre.
export const APPAREIL_JOURS = 30;
export const SESSION_HEURES = 12;
export const POSTE_D_UN_AUTRE_MIN = 30;

// Les règles, dans l'ordre de l'écran, avec leurs chiffres tirés du code. `compte` : ce que la base sait de leurs
// déclenchements sur vingt-quatre heures (null : le serveur ne le garde pas).
export type Regle = { nom: 'mot_de_passe' | 'sans_session' | 'sms' | 'api' | 'appareil' | 'session'; valeurs: Record<string, number> };
export const REGLES: readonly Regle[] = [
  { nom: 'mot_de_passe', valeurs: { apres: ERREURS_AVANT_ATTENTE, a: ATTENTES_MIN[0], b: ATTENTES_MIN[1], c: ATTENTES_MIN[2], d: ATTENTES_MIN[3] } },
  { nom: 'sans_session', valeurs: { rafale: LIMITES_PAR_ADRESSE.capacite, parSeconde: LIMITES_PAR_ADRESSE.parSeconde } },
  { nom: 'sms', valeurs: { heure: SMS_PAR_HEURE, jour: SMS_PAR_JOUR } },
  { nom: 'api', valeurs: { minute: LIMITES_PAR_DEFAUT.parSeconde * 60, rafale: LIMITES_PAR_DEFAUT.capacite } },
  { nom: 'appareil', valeurs: { jours: APPAREIL_JOURS } },
  { nom: 'session', valeurs: { heures: SESSION_HEURES, autre: POSTE_D_UN_AUTRE_MIN } },
];

export type Heure = { heure: string; reussies: number; codesFaux: number };
export type ARegarder = {
  sorte: 'code' | 'attente'; id: string; le: string; erreurs: number; qui: string | null; adresse: string | null; role: string | null;
  resolu: boolean | null; console: boolean; jusquAu: string | null; connu: boolean | null; appareil: { type: string; nouveau: boolean } | null;
};
export type Membre = {
  id: string; nom: string; role: string; methode: 'sms' | 'application' | null; appareils: { nom: string; type: string }[];
  sessions: number; derniere: string | null; secours: number; codesFaux: number;
};
export type SecuriteLue = { heures: Heure[]; motsDePasseFaux: number; freines: number; aRegarder: ARegarder[]; equipe: Membre[] };

const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const entier = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
const texte = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});

export function lireSecurite(brut: unknown): SecuriteLue {
  const b = objet(brut);
  return {
    heures: tableau(b.heures).flatMap((h) => {
      const heure = date(h.heure);
      return heure ? [{ heure, reussies: entier(h.reussies) ?? 0, codesFaux: entier(h.codesFaux) ?? 0 }] : [];
    }),
    motsDePasseFaux: entier(b.motsDePasseFaux) ?? 0,
    freines: entier(b.freines) ?? 0,
    aRegarder: tableau(b.aRegarder).flatMap((r) => {
      const le = date(r.le), a = objet(r.appareil);
      if ((r.sorte !== 'code' && r.sorte !== 'attente') || !le || typeof r.id !== 'string') return [];
      return [{
        sorte: r.sorte, id: r.id, le, erreurs: entier(r.erreurs) ?? 0, qui: texte(r.qui), adresse: texte(r.adresse), role: texte(r.role),
        resolu: typeof r.resolu === 'boolean' ? r.resolu : null, console: r.console === true, jusquAu: date(r.jusquAu),
        connu: typeof r.connu === 'boolean' ? r.connu : null,
        appareil: typeof a.type === 'string' ? { type: a.type, nouveau: a.nouveau === true } : null,
      }];
    }),
    equipe: tableau(b.equipe).flatMap((m) => {
      if (typeof m.id !== 'string' || typeof m.nom !== 'string' || typeof m.role !== 'string') return [];
      return [{
        id: m.id, nom: m.nom, role: m.role, methode: m.methode === 'sms' || m.methode === 'application' ? m.methode : null,
        appareils: tableau(m.appareils).flatMap((x) => (typeof x.nom === 'string' && typeof x.type === 'string' ? [{ nom: x.nom, type: x.type }] : [])),
        sessions: entier(m.sessions) ?? 0, derniere: date(m.derniere), secours: entier(m.secours) ?? 0, codesFaux: entier(m.codesFaux) ?? 0,
      }];
    }),
  };
}

// Ce qui demande un regard, par ordre d'urgence : un mot de passe connu de quelqu'un (des codes faux après lui, défi non
// abouti) d'abord ; la même chose qui a fini par aboutir ensuite ; un compte freiné en dernier (la règle a fait son
// travail). L'équipe passe devant à urgence égale : un accès à la console vaut tous les dossiers.
export function rangDeRegard(r: ARegarder): number {
  return (r.sorte === 'code' ? (r.resolu ? 1 : 0) : 2) * 2 + (r.role ? 0 : 1);
}
export const rangerARegarder = (l: readonly ARegarder[]): ARegarder[] =>
  [...l].sort((a, b) => rangDeRegard(a) - rangDeRegard(b) || b.le.localeCompare(a.le));

// Les clés qui peuvent commander le serveur (exploitation/acces-cles.json) : leur nom et si elles sont retirées. La clé
// elle-même n'est jamais rendue — même publique, elle n'a rien à faire sur un écran.
export type CleDeCommande = { id: string; retiree: boolean };
export function lireClesDeCommande(brut: unknown): CleDeCommande[] {
  return tableau(brut).flatMap((c) => (typeof c.id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(c.id) ? [{ id: c.id, retiree: c.retiree === true }] : []))
    .sort((a, b) => Number(a.retiree) - Number(b.retiree) || a.id.localeCompare(b.id));
}

// Le certificat : les jours qui restent, lus sur le dernier relevé de la veille (jour de Tunis) ; null sans relevé.
export function joursDuCertificat(expire: string | null, aujourdhui: string): number | null {
  if (!expire || !/^\d{4}-\d{2}-\d{2}$/.test(expire)) return null;
  return Math.round((Date.parse(`${expire}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000);
}
