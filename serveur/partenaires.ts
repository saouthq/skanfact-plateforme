// « Connecter ma boutique » (brique 133 ; docs/boutique.md, B0). Un partenaire DÉCLARÉ (SkanEcom) obtient une clé de
// l'API d'un commerçant sans que celui-ci la copie :
//   1. le partenaire envoie le commerçant sur /connecter?partenaire=…&retour=…&etat=… (la page de SkanFact) ;
//   2. le commerçant (propriétaire ou administrateur) choisit son entreprise et clique « Autoriser » : une clé est créée
//      à son nom, avec les gestes du partenaire, valable dix minutes ; il revient chez le partenaire avec un CODE ;
//   3. le serveur du partenaire échange ce code (une seule fois, avec son propre secret) contre la clé, portée à un an.
// Le code ne voyage que par le navigateur ; la clé, jamais : elle se DÉRIVE du code par une clé que seul le serveur
// connaît (celle du coffre), et la base ne garde que les empreintes. Celui qui lit le code dans un historique n'en fait
// rien sans le secret du partenaire. Une adresse de retour qui n'est pas déclarée n'est jamais suivie.
//
// Ce qui part chez le partenaire, compté (décidé le 01/10/2026) : la clé, l'identifiant et le nom de l'entreprise, les
// gestes de la clé et sa date de fin. Rien d'autre.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { motif, rendre, t } from '../textes/index.ts';
import type { Route } from './app.ts';
import { enTantQue } from './base.ts';
import { creerCle, PREFIXE_CLE } from './cles.ts';
import type { Contexte } from './connexion.ts';

export type Partenaire = { code: string; nom: string; retours: string[]; empreinteSecret: string; gestes: string[] };
const declare = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  nom: z.string().trim().min(1).max(100),
  // Les adresses où le commerçant revient : https, sans paramètres (le partenaire ajoute les siens à l'appel).
  retours: z.array(z.string().regex(/^https:\/\/[^\s?#]+$/)).min(1).max(10),
  // L'empreinte (SHA-256) du secret du partenaire : le secret lui-même n'est jamais dans la configuration.
  empreinteSecret: z.string().regex(/^[0-9a-f]{64}$/),
  gestes: z.array(z.string().min(3).max(100)).min(1).max(30),
});
// SKANFACT_PARTENAIRES : la liste en JSON (vide sans elle).
export function lirePartenaires(texte: string | undefined): Partenaire[] {
  return texte ? z.array(declare).parse(JSON.parse(texte)) : [];
}

const CODE_MS = 10 * 60_000;
const CLE_JOURS = 365;
const sha256 = (x: string) => createHash('sha256').update(x, 'utf8').digest('hex');
// La clé que le code donne : seul ce serveur sait la calculer.
const cleDuCode = (cle: Buffer, code: string) => PREFIXE_CLE + createHmac('sha256', cle).update(`skanfact.partenaire:${code}`, 'utf8').digest('base64url');
// Une adresse de retour déclarée (ses paramètres à part ; jamais d'ancre).
const retourPermis = (p: Partenaire, retour: string) => !retour.includes('#') && p.retours.includes(retour.split('?')[0] ?? '');
const memeEmpreinte = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function routesPartenaires(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const trouver = (code: string | undefined) => ctx.partenaires?.liste.find((p) => p.code === code);
  const inconnu = { statut: 404, corps: { motif: motif('partenaire.inconnu') } };
  const maintenant = () => ctx.maintenant?.() ?? new Date();

  // Ce que la page « Connecter » montre avant le clic : qui demande, et pour faire quoi.
  ajouter({
    methode: 'GET', chemin: '/partenaires/:partenaire', geste: 'public',
    traiter: async ({ params, query }) => {
      const p = trouver(params.partenaire);
      if (!p) return inconnu;
      if (!retourPermis(p, String(query.retour ?? ''))) return { statut: 400, corps: { motif: motif('partenaire.retour_refuse', { partenaire: p.nom }) } };
      return { corps: { code: p.code, nom: p.nom, gestes: p.gestes.map((g) => ({ code: g, libelle: t(`geste.${g}`) })) } };
    },
  });

  // « Autoriser » : la clé de dix minutes, et l'adresse où revenir avec le code.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/partenaires/:partenaire/autoriser', geste: 'socle.cles_api.gerer',
    corps: z.object({ retour: z.string().max(2000), etat: z.string().max(200) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const p = trouver(params.partenaire);
      if (!p || !ctx.partenaires) return inconnu;
      if (!retourPermis(p, corps.retour)) return { statut: 400, corps: { motif: motif('partenaire.retour_refuse', { partenaire: p.nom }) } };
      const ent = params.entreprise ?? '';
      const code = randomBytes(32).toString('base64url');
      const expire = new Date(maintenant().getTime() + CODE_MS);
      const cle = await creerCle(tx, qui, ent, { nom: rendre(t('partenaire.nom_cle', { partenaire: p.nom }), 'fr'), gestes: p.gestes, expireLe: expire,
        secret: cleDuCode(ctx.partenaires.cle, code) }, maintenant());
      await tx.query('select socle.autoriser_partenaire($1, $2, $3, $4, $5)', [ent, p.code, cle.id, sha256(code), expire]);
      const suite = new URLSearchParams({ code, etat: corps.etat });
      return { statut: 201, corps: { adresse: `${corps.retour}${corps.retour.includes('?') ? '&' : '?'}${suite}` } };
    },
  });

  // L'échange, par le serveur du partenaire : son secret (en-tête Authorization: Bearer …) et le code, une seule fois.
  ajouter({
    methode: 'POST', chemin: '/partenaires/:partenaire/echanger', geste: 'public',
    corps: z.object({ code: z.string().min(20).max(200) }),
    traiter: async ({ params, corps, requete }) => {
      const p = trouver(params.partenaire);
      if (!p || !ctx.partenaires) return inconnu;
      const secret = /^Bearer (.+)$/.exec(requete.headers.authorization ?? '')?.[1] ?? '';
      if (!memeEmpreinte(sha256(secret), p.empreinteSecret)) return { statut: 401, corps: { motif: motif('partenaire.secret_refuse') } };
      const expireLe = new Date(maintenant().getTime() + CLE_JOURS * 86_400_000);
      const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.echanger_autorisation($1, $2, $3)',
        [p.code, sha256(corps.code), expireLe])).rows[0] as { cle_api: string; entreprise: string; nom: string; gestes: string[] } | undefined);
      if (!r) return { statut: 400, corps: { motif: motif('partenaire.code_refuse') } };
      return { corps: { cle: cleDuCode(ctx.partenaires.cle, corps.code), entreprise: r.entreprise, nom: r.nom, gestes: r.gestes, expireLe: expireLe.toISOString() } };
    },
  });
  return routes;
}
