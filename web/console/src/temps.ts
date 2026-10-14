// Les dates de la console. Un jour d'abonnement est un jour de CALENDRIER (« 2026-10-13 ») : il s'écrit tel quel, sans
// fuseau ni heure. Un instant (une connexion, un geste) se lit à l'heure de Tunis. Les écarts se comptent en jours de
// calendrier, en UTC pur : jamais une heure d'été ne décale un jour.
import { dire } from './langue.ts';

const FUSEAU = 'Africa/Tunis';
const JOUR = /^(\d{4})-(\d{2})-(\d{2})/;

// « 13/10/2026 », depuis un jour de calendrier.
export function jourCourt(iso: string | null | undefined): string {
  const m = JOUR.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// « 13/10 », pour une colonne de dates proches (le jour entier se lit au survol, et « dans 3 jours » le situe).
export function jourMois(iso: string | null | undefined): string {
  const m = JOUR.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}` : '—';
}

const utc = (iso: string) => { const m = JOUR.exec(iso); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN; };
export const joursEntre = (de: string, a: string) => Math.round((utc(a) - utc(de)) / 86_400_000);

// « mardi 13 octobre 2026 », depuis un jour de calendrier (une donnée : la langue du navigateur l'écrit).
export function jourLong(iso: string): string {
  const t = utc(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
}

// Le jour de Tunis d'un instant (« 2026-10-13 ») et son heure (« 08:12 »).
export const jourDe = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
export const heureDe = (instant: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

// Un jour par rapport à aujourd'hui : « aujourd'hui », « demain », « dans 3 jours », « hier », « il y a 4 jours ».
export function dans(jour: string, aujourdhui: string): string {
  const n = joursEntre(aujourdhui, jour);
  if (n === 0) return dire('console.ecran.temps.aujourdhui');
  if (n === 1) return dire('console.ecran.temps.demain');
  if (n === -1) return dire('console.ecran.temps.hier');
  return n > 0 ? dire('console.ecran.temps.dans', { n }) : dire('console.ecran.temps.il_y_a', { n: -n });
}

// Un instant par rapport à aujourd'hui : « aujourd'hui, 08:12 », « hier, 19:40 », « le 03/10/2026, 14:02 ».
export function quand(instant: string | null | undefined, aujourdhui: string): string {
  if (!instant) return dire('console.ecran.temps.jamais');
  const j = jourDe(instant);
  const n = joursEntre(j, aujourdhui);
  const jour = n === 0 ? dire('console.ecran.temps.aujourdhui') : n === 1 ? dire('console.ecran.temps.hier') : dire('console.ecran.temps.le', { jour: jourCourt(j) });
  return `${jour}, ${heureDe(instant)}`;
}

// Il y a combien de temps, pour ce qui se compte en minutes (le dernier passage de la veille).
export function ilYA(instant: string, maintenant = Date.now()): string {
  const min = Math.floor((maintenant - new Date(instant).getTime()) / 60_000);
  if (min < 1) return dire('console.ecran.temps.a_l_instant');
  return dire('console.ecran.temps.minutes', { n: min });
}

// Un mois (« 2026-10 ») en mots : « octobre 2026 », ou « octobre » ; et précédé de « de », élidé devant une voyelle
// (« d’avril », « d’août », « d’octobre » ; « de septembre »).
export const moisEnMots = (m: string, annee = true) => new Intl.DateTimeFormat('fr-FR', { month: 'long', ...(annee ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  .format(new Date(`${m}-01T00:00:00Z`));
export const deMois = (m: string, annee = true) => { const t = moisEnMots(m, annee); return /^[aeiouâéè]/i.test(t) ? `d\u2019${t}` : `de ${t}`; };
