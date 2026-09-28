// Les mots de passe (03 § 6) : 10 caractères au moins, refusé s'il figure dans une liste de mots de
// passe déjà volés, gardé en empreinte Argon2id seulement. La liste est gardée CHEZ NOUS : le mot de
// passe, ni même un début de son empreinte, ne part jamais ailleurs.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { hash, verify } from '@node-rs/argon2';
import { LONGUEUR_MINIMALE } from '../commun/compte.ts';
import { motif, type Texte } from '../textes/index.ts';

export { LONGUEUR_MINIMALE };

// Une liste de mots de passe volés : on demande seulement « celui-ci y est-il ? ».
export type ListeVolee = { contient: (motDePasse: string) => boolean };

const sha1 = (texte: string) => createHash('sha1').update(texte, 'utf8').digest('hex').toUpperCase();

// Le format des listes publiques : une empreinte SHA-1 par ligne, suivie ou non de « :nombre ».
export function listeDepuisFichier(chemin: string): ListeVolee {
  const ensemble = new Set<string>();
  for (const ligne of fs.readFileSync(chemin, 'utf8').split('\n')) {
    const e = ligne.split(':')[0]?.trim().toUpperCase();
    if (e && /^[0-9A-F]{40}$/.test(e)) ensemble.add(e);
  }
  return { contient: (mdp) => ensemble.has(sha1(mdp)) };
}

export type RefusMotDePasse = { ok: false; motif: Texte } | { ok: true };

export function verifierPolitique(motDePasse: string, liste: ListeVolee): RefusMotDePasse {
  if ([...motDePasse].length < LONGUEUR_MINIMALE) {
    return { ok: false, motif: motif('mot_de_passe.trop_court', { min: LONGUEUR_MINIMALE }) };
  }
  if (liste.contient(motDePasse)) {
    return { ok: false, motif: motif('mot_de_passe.vole') };
  }
  return { ok: true };
}

export const empreinte = (motDePasse: string): Promise<string> => hash(motDePasse);
export const correspond = (empreinteGardee: string, motDePasse: string): Promise<boolean> =>
  verify(empreinteGardee, motDePasse).catch(() => false);

// Une empreinte faite une fois, pour vérifier « pour rien » quand l'adresse n'existe pas : le
// temps de réponse ne dit pas si un compte existe.
let empreinteLeurre: Promise<string> | null = null;
export function verifierPourRien(motDePasse: string): Promise<boolean> {
  empreinteLeurre ??= hash('leurre-qui-ne-correspond-a-rien');
  return empreinteLeurre.then((e) => correspond(e, motDePasse)).then(() => false);
}
