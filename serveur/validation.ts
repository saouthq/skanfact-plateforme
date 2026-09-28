// Ce qu'un champ reçu a de travers, dit avec le catalogue des textes : jamais le message (anglais)
// de la bibliothèque qui vérifie. Nos propres vérifications donnent une CLÉ du catalogue comme
// message (« champ.jour »), avec ses valeurs si elle en a (« ventes.champ.decimal|{"dec":3} »).

import type { z } from 'zod';
import { t, texteConnu, type Texte, type Valeurs } from '../textes/index.ts';

type Probleme = z.core.$ZodIssue;

// Un message de vérification écrit comme une clé du catalogue, avec ses valeurs.
export const cleDeVerification = (cle: string, valeurs?: Valeurs) => (valeurs ? `${cle}|${JSON.stringify(valeurs)}` : cle);

function valeurA(corps: unknown, chemin: PropertyKey[]): unknown {
  let v: unknown = corps;
  for (const k of chemin) v = v && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k] : undefined;
  return v;
}

export function raison(p: Probleme, corps: unknown): Texte {
  const [cle, valeurs] = p.message.split(/\|(.*)/s);
  if (cle && texteConnu(cle)) return t(cle, valeurs ? (JSON.parse(valeurs) as Valeurs) : {});
  switch (p.code) {
    case 'invalid_type': return t(valeurA(corps, p.path) === undefined ? 'champ.manquant' : 'champ.type');
    case 'too_small':
      if (p.origin === 'string') return t('champ.trop_court', { min: String(p.minimum) });
      if (p.origin === 'array' || p.origin === 'set') return t('champ.pas_assez', { min: String(p.minimum) });
      return t('champ.trop_petit', { min: String(p.minimum) });
    case 'too_big':
      if (p.origin === 'string') return t('champ.trop_long', { max: String(p.maximum) });
      if (p.origin === 'array' || p.origin === 'set') return t('champ.trop_nombreux', { max: String(p.maximum) });
      return t('champ.trop_grand', { max: String(p.maximum) });
    case 'invalid_format':
      if (p.format === 'email') return t('champ.email');
      if (p.format === 'uuid' || p.format === 'guid') return t('champ.identifiant');
      return t('champ.format');
    case 'invalid_value': return t('champ.choix', { valeurs: p.values.map(String).join(', ') });
    case 'unrecognized_keys': return t('champ.inconnus', { cles: p.keys.join(', ') });
    default: return t('champ.valeur');
  }
}

export const nomDuChamp = (p: Probleme | undefined, parDefaut: string) => p?.path.map(String).join('.') || parDefaut;
