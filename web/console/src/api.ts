// L'accès à l'API de la console (docs/console.md) : ses routes vivent sous /v1/console/, avec SA session. Le jeton de la
// console ne vit que dans l'onglet (sessionStorage) : fermer l'onglet ferme la console, jamais gardé dans le navigateur,
// et il n'ouvre rien dans l'application (pas plus que le jeton de l'application n'ouvre la console). L'appareil, lui, se
// retient dans le navigateur : la console le reconnaît (le code du téléphone est demandé quand même, à chaque fois).
import { LANGUE } from './langue.ts';
export { nomDeCetAppareil } from '../../src/appareil.ts';

export type Corps = { motif?: string; champ?: string | null; raison?: string; bouton?: string | null };
export type Reponse<T> = { statut: number; corps: T & Corps };

const CLE_JETON = 'skanfact.console.jeton';
const CLE_APPAREIL = 'skanfact.console.appareil';
const lire = (cle: string, ou: Storage) => { try { return ou.getItem(cle); } catch { return null; } };
const ecrire = (cle: string, v: string | null, ou: Storage) => {
  try { if (v === null) ou.removeItem(cle); else ou.setItem(cle, v); } catch { /* stockage refusé : la session vit en mémoire */ }
};

let jeton: string | null = lire(CLE_JETON, sessionStorage);

export const session = {
  jeton: () => jeton,
  ouvrir: (j: string) => { jeton = j; ecrire(CLE_JETON, j, sessionStorage); },
  fermer: () => { jeton = null; ecrire(CLE_JETON, null, sessionStorage); },
  appareil: () => lire(CLE_APPAREIL, localStorage),
  retenirAppareil: (id: string) => ecrire(CLE_APPAREIL, id, localStorage),
};

// Le dernier geste humain sur la page (un clic, une touche, la molette, un doigt, le retour sur l'onglet) : une requête
// qui part plus de dix secondes après lui est une relecture automatique, et le dit au serveur (`x-console-auto`), qui ne
// repousse pas l'inaction de la session pour elle (0114). L'ouverture de la page compte comme un geste.
export const GESTE_HUMAIN_MS = 10_000;
let dernierGeste = Date.now();
if (typeof window !== 'undefined') {
  const vu = () => { dernierGeste = Date.now(); };
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(e, vu, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vu(); });
}
export const relectureAutomatique = (maintenant = Date.now()) => maintenant - dernierGeste > GESTE_HUMAIN_MS;

// Le serveur ne répond pas (réseau coupé, relais qui coupe) : l'écran le dit, jamais par un texte brut.
export class ErreurReseau extends Error {}

export async function appeler<T = Record<string, unknown>>(methode: 'GET' | 'POST' | 'PUT', chemin: string, corps?: unknown): Promise<Reponse<T>> {
  const entetes: Record<string, string> = { 'x-langue': LANGUE };
  if (corps !== undefined) entetes['content-type'] = 'application/json';
  if (jeton) entetes.authorization = `Bearer ${jeton}`;
  if (relectureAutomatique()) entetes['x-console-auto'] = '1';
  let r: Response;
  try {
    r = await fetch(`/v1${chemin}`, { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  } catch {
    throw new ErreurReseau();
  }
  const texte = await r.text();
  try {
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as T & Corps };
  } catch {
    throw new ErreurReseau();
  }
}
