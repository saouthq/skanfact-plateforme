// La collecte des mesures du service (serveur/service/mesures.ts ; docs/console.md C12). Chaque réponse de l'API se note
// à l'instant où elle finit, en trois comptes : par minute et par sorte (le trafic, les pannes, le temps de réponse de la
// dernière heure et du dernier jour), par heure et par sorte (la semaine, le mois), par jour et par route (quelle route
// est lente). Chaque minute, ce qui s'est ajouté depuis le dernier envoi part dans la base, qui l'ADDITIONNE à ce qu'elle
// a : rien ne se perd entre deux envois, rien ne se compte deux fois. Une base qui ne répond pas : on garde, et on renvoie
// au tour suivant (deux heures au plus) ; une mesure perdue se dit « non mesuré » à l'écran, jamais zéro.

import type pg from 'pg';
import { enTantQue } from '../base.ts';
import { ajouter, estPanne, fusionner, histogrammeVide, sorteDe, type Histogramme, type Sorte } from './mesures.ts';

type Compte = { sorte: Sorte; n: number; pannes: number; h: Histogramme };
export type LigneMinute = { minute: string; sorte: Sorte; n: number; pannes: number; h: Histogramme };
export type LigneHeure = { heure: string; sorte: Sorte; n: number; pannes: number; h: Histogramme };
export type LigneJour = { jour: string; route: string; sorte: Sorte; n: number; pannes: number; h: Histogramme };
export type Envoi = { minutes: LigneMinute[]; heures: LigneHeure[]; jours: LigneJour[] };

// Le début de la minute, de l'heure, du jour d'un instant, en temps universel (une mesure ne dépend pas d'un fuseau ;
// l'écran dira l'heure de Tunis).
export const debutMinute = (t: Date) => new Date(Math.floor(t.getTime() / 60_000) * 60_000).toISOString();
export const debutHeure = (t: Date) => new Date(Math.floor(t.getTime() / 3_600_000) * 3_600_000).toISOString();
export const jourUtc = (t: Date) => t.toISOString().slice(0, 10);
// Ce qu'on garde au plus quand la base ne répond pas : deux heures de minutes, et ce qui va avec.
export const GARDE_MINUTES = 120;

const cle = (a: string, b: string) => `${a}\u0000${b}`;
function noterDans(carte: Map<string, Compte>, k: string, sorte: Sorte, panne: boolean, ms: number) {
  let c = carte.get(k);
  if (!c) carte.set(k, (c = { sorte, n: 0, pannes: 0, h: histogrammeVide() }));
  c.n++;
  if (panne) c.pannes++;
  ajouter(c.h, ms);
}
function ajouterDans(carte: Map<string, Compte>, k: string, x: Compte) {
  const c = carte.get(k);
  if (!c) { carte.set(k, { sorte: x.sorte, n: x.n, pannes: x.pannes, h: fusionner(histogrammeVide(), x.h) }); return; }
  c.n += x.n; c.pannes += x.pannes; fusionner(c.h, x.h);
}
const partie = (k: string) => k.split('\u0000') as [string, string];

export class Collecte {
  private minutes = new Map<string, Compte>();
  private heures = new Map<string, Compte>();
  private jours = new Map<string, Compte>();

  // Une réponse : sa méthode et son modèle de chemin (sans la version de l'API), son statut, sa durée, l'instant de sa fin.
  noter(methode: string, chemin: string, statut: number, ms: number, fin: Date): void {
    const sorte = sorteDe(methode, chemin);
    const panne = estPanne(statut);
    noterDans(this.minutes, cle(debutMinute(fin), sorte), sorte, panne, ms);
    noterDans(this.heures, cle(debutHeure(fin), sorte), sorte, panne, ms);
    noterDans(this.jours, cle(jourUtc(fin), `${methode} ${chemin}`), sorte, panne, ms);
  }

  // Tout ce qui s'est ajouté depuis le dernier envoi, retiré de la mémoire. `rendre` le remet si l'envoi échoue.
  prendre(): Envoi {
    const envoi: Envoi = {
      minutes: [...this.minutes].map(([k, c]) => ({ minute: partie(k)[0], sorte: c.sorte, n: c.n, pannes: c.pannes, h: c.h })),
      heures: [...this.heures].map(([k, c]) => ({ heure: partie(k)[0], sorte: c.sorte, n: c.n, pannes: c.pannes, h: c.h })),
      jours: [...this.jours].map(([k, c]) => ({ jour: partie(k)[0], route: partie(k)[1], sorte: c.sorte, n: c.n, pannes: c.pannes, h: c.h })),
    };
    this.minutes = new Map(); this.heures = new Map(); this.jours = new Map();
    return envoi;
  }

  // Remettre un envoi qui n'est pas parti (il s'additionne à ce qui s'est noté entre-temps), en gardant au plus deux
  // heures de minutes : au-delà, la base est en panne depuis longtemps, et la mémoire du programme passe avant.
  rendre(e: Envoi, maintenant: Date): void {
    const limite = new Date(maintenant.getTime() - GARDE_MINUTES * 60_000);
    for (const l of e.minutes) if (new Date(l.minute) >= limite) ajouterDans(this.minutes, cle(l.minute, l.sorte), l);
    for (const l of e.heures) if (new Date(l.heure).getTime() >= Math.floor(limite.getTime() / 3_600_000) * 3_600_000) ajouterDans(this.heures, cle(l.heure, l.sorte), l);
    for (const l of e.jours) if (l.jour >= jourUtc(limite)) ajouterDans(this.jours, cle(l.jour, l.route), l);
  }

  get vide(): boolean { return this.minutes.size === 0 && this.heures.size === 0 && this.jours.size === 0; }
}

// Le nom d'un exemplaire du programme : sa machine et son port (« vps-1:8080 »), rien d'autre ; ce que la base n'accepte
// pas dans un nom se remplace.
export function nomExemplaire(machine: string, port: string | number): string {
  const nom = `${machine}:${port}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
  return nom || 'serveur';
}

// Envoyer ce qui s'est ajouté. Un échec (la base qui ne répond pas) garde l'envoi pour le tour suivant : rendu `false`,
// jamais une exception, le serveur continue de servir.
export async function envoyerMesures(pool: pg.Pool, exemplaire: string, collecte: Collecte, maintenant = new Date()): Promise<boolean> {
  if (collecte.vide) return true;
  const envoi = collecte.prendre();
  try {
    await enTantQue(pool, null, async (tx) => { await tx.query('select plateforme.noter_requetes($1, $2::jsonb)', [exemplaire, JSON.stringify(envoi)]); });
    return true;
  } catch {
    collecte.rendre(envoi, maintenant);
    return false;
  }
}
