// Le dossier de révision d'une période (brique 44, 0028), dans la forme de la v10 (compta.js,
// revisionVide) : cette liste, et rien d'autre. Lu par la route qui le pose et par la reprise d'un livre
// de la v10 (brique 68), qui le contrôle avant de rien écrire.

import { z } from 'zod';

const texte = (max: number) => z.string().max(max);
// Les instants en millisecondes ; les noms, ceux de qui a signé.
const INSTANT = z.number().int().min(0).max(8_640_000_000_000_000);
export const REVISION = z.object({
  faite: z.boolean(), faiteLe: INSTANT.nullable(), faitePar: texte(200),
  comptes: z.array(z.object({ compte: z.string().regex(/^\d{1,12}$/), revuLe: INSTANT, revuPar: texte(200), note: texte(2000) }).strict()).max(5000),
  notes: z.array(z.object({
    id: z.string().min(1).max(40), texte: z.string().trim().min(1).max(2000), cycle: texte(40), compte: z.string().regex(/^(\d{1,12})?$/),
    par: texte(200), le: INSTANT, levee: z.boolean(), leveeLe: INSTANT.nullable(), leveePar: texte(200),
  }).strict()).max(500),
  questionnaire: z.array(z.object({ id: z.string().min(1).max(40), question: z.string().trim().min(1).max(500), reponse: texte(4000), par: texte(200), le: INSTANT.nullable() }).strict()).max(60),
}).strict();
export const PERIODE_REVISION = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
