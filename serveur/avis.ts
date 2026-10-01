// Les avis d'événement (14 § 2.5) : l'émission, dans la transaction du fait annoncé, et la
// livraison, signée, hors de toute transaction (base/migrations/0008_avis.sql).
//
// La signature : l'en-tête `skanfact-signature: t=<secondes>,v1=<hex>` où v1 est le HMAC-SHA256,
// avec le secret de l'abonnement, de « <t>.<corps> ». Le destinataire recalcule, compare, et refuse
// un avis trop vieux (t) : un avis rejoué des heures plus tard ne passe pas.

import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Pool } from 'pg';
import type { Transaction } from './base.ts';

// (Brique 128) Les règlements d'une facture : chacun, et la facture qui ne doit plus rien (docs/api-situation.md, S6).
export const EVENEMENTS = ['facture.emise', 'reglement.enregistre', 'facture.reglee'] as const;
export type Evenement = (typeof EVENEMENTS)[number];

export function nouveauSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function signer(secret: string, horodatage: number, corps: string): string {
  return `t=${horodatage},v1=${createHmac('sha256', secret).update(`${horodatage}.${corps}`).digest('hex')}`;
}

// Un fait est arrivé : un avis par abonnement qui le demande, dans la transaction du fait.
export async function emettreAvis(tx: Transaction, entreprise: string, evenement: Evenement, corps: Record<string, unknown>): Promise<number> {
  return (await tx.query('select socle.emettre_avis($1, $2, $3) n', [entreprise, evenement, JSON.stringify(corps)])).rows[0].n as number;
}

export type Envoi = { url: string; entetes: Record<string, string>; corps: string };
export type Envoyeur = (e: Envoi) => Promise<{ statut: number }>;

// Une adresse privée, locale ou réservée : un abonnement ne sert jamais à atteindre notre propre
// réseau (ni la machine, ni ses voisines).
export function adressePrivee(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return adressePrivee(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
  }
  return true;
}

// L'envoi réel : https seulement, vers une adresse publique (vérifiée au moment d'envoyer, pas
// seulement à l'abonnement), dix secondes au plus, sans suivre de redirection.
export const envoyerHttps: Envoyeur = async ({ url, entetes, corps }) => {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('https_requis');
  const adresses = isIP(u.hostname.replace(/^\[|\]$/g, '')) ? [{ address: u.hostname.replace(/^\[|\]$/g, '') }] : await lookup(u.hostname, { all: true });
  if (!adresses.length || adresses.some((a) => adressePrivee(a.address))) throw new Error('adresse_privee');
  const r = await fetch(url, { method: 'POST', headers: entetes, body: corps, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  return { statut: r.status };
};

// Le livreur : prend les avis dus, les envoie un à un, note chaque résultat. Rend ce qu'il a fait.
// L'erreur notée est un CODE (https_requis, adresse_privee, reponse_<statut>, ou le message du
// réseau) : l'écran la dit avec le catalogue.
export async function livrerAvis(pool: Pool, envoyer: Envoyeur, maintenant: Date = new Date(), limite = 20): Promise<{ livres: number; echecs: number }> {
  const dus = (await pool.query('select * from socle.avis_a_livrer($1, $2)', [maintenant, limite])).rows as
    { id: string; entreprise: string; url: string; secret: string; evenement: string; corps: unknown; essais: number }[];
  let livres = 0, echecs = 0;
  for (const a of dus) {
    const corps = JSON.stringify({ id: a.id, evenement: a.evenement, entreprise: a.entreprise, donnees: a.corps });
    const horodatage = Math.floor(maintenant.getTime() / 1000);
    let statut = 0, erreur: string | null = null;
    try {
      statut = (await envoyer({
        url: a.url, corps,
        entetes: {
          'content-type': 'application/json', 'user-agent': 'SkanFact-Avis/1',
          'skanfact-evenement': a.evenement, 'skanfact-avis': a.id, 'skanfact-signature': signer(a.secret, horodatage, corps),
        },
      })).statut;
      if (statut < 200 || statut > 299) erreur = `reponse_${statut}`;
    } catch (e) {
      erreur = e instanceof Error ? e.message : String(e);
    }
    await pool.query('select socle.avis_resultat($1, $2, $3, $4)', [a.id, maintenant, statut || null, erreur]);
    if (erreur === null) livres++; else echecs++;
  }
  return { livres, echecs };
}
