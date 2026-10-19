// Les adresses internet qui frappent à l'entrée (0143 ; docs/console.md C67) : ce que le serveur compte, et ce qu'il
// ferme. Compter ne coûte rien à la requête : un compteur en mémoire, envoyé à la base chaque demi-minute (l'adresse,
// combien de refus — un mot de passe ou un code faux —, combien de freins — trop d'appels ; jamais le compte visé ni ce
// qui a été tapé). Fermer : la liste des adresses bloquées, relue au même rythme et tout de suite après un geste de la
// console ; une adresse bloquée ne passe plus l'entrée (les routes publiques), une session ouverte continue.

import type pg from 'pg';
import { enTantQue } from './base.ts';

export const ADRESSES_PAS_MS = 30_000;
// Au-delà, les adresses comptées attendent le passage suivant (une attaque venue de partout n'emplit pas la mémoire) :
// les dix mille premières passent, le reste se perd et se dit (`perdues`).
export const ADRESSES_AU_PLUS = 10_000;

export class Adresses {
  private comptes = new Map<string, [number, number]>();
  private bloquees = new Map<string, number>();
  perdues = 0;

  // Une réponse de l'entrée : refusée (401) ou freinée (429).
  noter(adresse: string, sorte: 'echec' | 'frein'): void {
    let c = this.comptes.get(adresse);
    if (!c) {
      if (this.comptes.size >= ADRESSES_AU_PLUS) { this.perdues += 1; return; }
      c = [0, 0];
      this.comptes.set(adresse, c);
    }
    c[sorte === 'echec' ? 0 : 1] += 1;
  }

  // Bloquée en ce moment : jusqu'à quand ; sinon null. Une adresse IPv4 vue en IPv6 (« ::ffff:1.2.3.4 ») est la même.
  bloquee(adresse: string, maintenant: number = Date.now()): Date | null {
    const fin = this.bloquees.get(adresse) ?? this.bloquees.get(adresse.replace(/^::ffff:/, ''));
    return fin !== undefined && fin > maintenant ? new Date(fin) : null;
  }

  // Le passage : ce qui a été compté part à la base, la liste des blocages en revient. Un envoi qui échoue remet ses
  // comptes pour le passage suivant (une base qui ne répond pas ne perd rien de ce qu'on a vu).
  async passer(pool: pg.Pool, maintenant: Date = new Date()): Promise<{ adresses: number; bloquees: number }> {
    const envoi = this.comptes;
    this.comptes = new Map();
    let n = 0;
    if (envoi.size) {
      try {
        n = await enTantQue(pool, null, async (tx) => Number((await tx.query('select plateforme.noter_adresses($1::jsonb, $2) v',
          [JSON.stringify(Object.fromEntries(envoi)), maintenant])).rows[0].v));
      } catch (e) {
        for (const [a, [x, y]] of envoi) {
          const c = this.comptes.get(a) ?? [0, 0];
          this.comptes.set(a, [c[0] + x, c[1] + y]);
        }
        throw e;
      }
    }
    await this.relire(pool, maintenant);
    return { adresses: n, bloquees: this.bloquees.size };
  }

  async relire(pool: pg.Pool, maintenant: Date = new Date()): Promise<void> {
    const lignes = await enTantQue(pool, null, async (tx) => (await tx.query('select adresse, jusqu_au from plateforme.adresses_bloquees($1)', [maintenant])).rows as { adresse: string; jusqu_au: Date }[]);
    this.bloquees = new Map(lignes.map((l) => [l.adresse, new Date(l.jusqu_au).getTime()]));
  }
}
