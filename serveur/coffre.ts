// Le coffre du serveur (brique 78 ; docs/paiement-en-ligne.md ; 06 § 5) : un secret qu'une entreprise
// confie à la plateforme (la clé de l'API de son prestataire de paiement) se garde CHIFFRÉ, par une clé
// que seul le programme serveur connaît (SKANFACT_COFFRE), jamais dans la base ni dans le dépôt. Une
// copie de la base ne donne donc aucune clé. Le secret chiffré est LIÉ à son entreprise (données
// associées) : recopié sur une autre entreprise, il ne s'ouvre pas. Aucun écran ne le relit jamais.
//
// AES-256-GCM, un vecteur tiré au hasard à chaque scellé : « v1.<vecteur>.<étiquette>.<chiffré> ».

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Son message est un code (jamais montré : celui qui l'attrape dit la phrase).
export class CoffreFaux extends Error {}

export function cleDuCoffre(texte: string | undefined): Buffer {
  const cle = Buffer.from(String(texte ?? ''), 'base64');
  if (cle.length !== 32) throw new CoffreFaux('coffre.cle_32_octets');
  return cle;
}
// Hors production seulement : une clé fixe, connue de tous (les tests, un poste de travail).
export const CLE_DU_COFFRE_D_ESSAI = createHash('sha256').update('skanfact.coffre-d-essai.jamais-en-production').digest();

const b64 = (b: Buffer) => b.toString('base64url');
export function sceller(cle: Buffer, lie: string, secret: string): string {
  const vecteur = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle, vecteur);
  c.setAAD(Buffer.from(lie, 'utf8'));
  const chiffre = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1.${b64(vecteur)}.${b64(c.getAuthTag())}.${b64(chiffre)}`;
}

export function ouvrir(cle: Buffer, lie: string, scelle: string): string {
  const [v, vecteur, etiquette, chiffre] = scelle.split('.');
  if (v !== 'v1' || !vecteur || !etiquette || chiffre === undefined) throw new CoffreFaux('coffre.scelle_illisible');
  try {
    // L'étiquette entière (16 octets) : sans cette longueur, une étiquette tronquée à 4 octets passerait.
    const d = createDecipheriv('aes-256-gcm', cle, Buffer.from(vecteur, 'base64url'), { authTagLength: 16 });
    d.setAAD(Buffer.from(lie, 'utf8'));
    d.setAuthTag(Buffer.from(etiquette, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(chiffre, 'base64url')), d.final()]).toString('utf8');
  } catch {
    // Faux, d'une autre entreprise ou d'une autre clé du coffre.
    throw new CoffreFaux('coffre.scelle_faux');
  }
}
