// L'accès à l'API de SkanFact, depuis l'écran : la même API que celle des partenaires (vision :
// l'API d'abord). Le jeton de session vit dans l'onglet (sessionStorage) ; l'appareil reconnu,
// dans le navigateur (localStorage), pour ne pas redemander le code pendant 30 jours.
import { LANGUE } from './langue.ts';

export type Reponse<T = Record<string, unknown>> = { statut: number; corps: T & { motif?: string; champ?: string | null; raison?: string; bouton?: string | null } };

const lire = (cle: string, ou: Storage) => { try { return ou.getItem(cle); } catch { return null; } };
const ecrire = (cle: string, v: string | null, ou: Storage) => { try { if (v === null) ou.removeItem(cle); else ou.setItem(cle, v); } catch { /* stockage refusé : la session vit en mémoire */ } };

let jeton: string | null = lire('skanfact.jeton', sessionStorage);
export const session = {
  jeton: () => jeton,
  ouvrir: (j: string) => { jeton = j; ecrire('skanfact.jeton', j, sessionStorage); },
  fermer: () => { jeton = null; ecrire('skanfact.jeton', null, sessionStorage); },
  appareil: () => lire('skanfact.appareil', localStorage),
  retenirAppareil: (id: string | null) => ecrire('skanfact.appareil', id, localStorage),
};

export class ErreurReseau extends Error {}

export async function appeler<T = Record<string, unknown>>(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, corps?: unknown): Promise<Reponse<T>> {
  const entetes: Record<string, string> = { 'x-langue': LANGUE };
  if (corps !== undefined) entetes['content-type'] = 'application/json';
  if (jeton) entetes.authorization = `Bearer ${jeton}`;
  let r: Response;
  try {
    r = await fetch(`/v1${chemin}`, { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  } catch {
    throw new ErreurReseau();
  }
  const texte = await r.text();
  return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Reponse<T>['corps'] };
}
