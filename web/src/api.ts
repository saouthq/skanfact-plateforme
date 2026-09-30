// L'accès à l'API de SkanFact, depuis l'écran : la même API que celle des partenaires (vision :
// l'API d'abord). Le jeton de session vit dans l'onglet (sessionStorage) et, sur « mon ordinateur »,
// aussi dans le navigateur (localStorage, brique 72) : l'application installée se rouvre, même sans
// réseau ; jamais sur l'ordinateur d'un autre. L'appareil reconnu vit dans le navigateur, pour ne
// pas redemander le code pendant 30 jours.
import { LANGUE } from './langue.ts';

export type Reponse<T = Record<string, unknown>> = { statut: number; corps: T & { motif?: string; champ?: string | null; raison?: string; bouton?: string | null; effacer?: boolean } };

const lire = (cle: string, ou: Storage) => { try { return ou.getItem(cle); } catch { return null; } };
const ecrire = (cle: string, v: string | null, ou: Storage) => { try { if (v === null) ou.removeItem(cle); else ou.setItem(cle, v); } catch { /* stockage refusé : la session vit en mémoire */ } };

let jeton: string | null = lire('skanfact.jeton', sessionStorage) ?? lire('skanfact.jeton', localStorage);
// Ce que le poste garde pour le hors-ligne (plateforme/poste.js) : les copies chiffrées, ce qui attend
// le réseau, et leur clé ; et à qui c'est.
function effacerLePoste() {
  ecrire('skanfact.hors_ligne', null, localStorage);
  ecrire('skanfact.poste_de', null, localStorage);
  try { indexedDB.deleteDatabase('skanfact-poste'); } catch { /* rien de gardé */ }
}
export const session = {
  jeton: () => jeton,
  ouvrir: (j: string, garder: boolean) => {
    jeton = j;
    ecrire('skanfact.jeton', j, sessionStorage); ecrire('skanfact.jeton', garder ? j : null, localStorage);
  },
  // Ce que le poste garde est à UNE personne (brique 73) : elle le retrouve à sa connexion suivante —
  // une session finie pendant une coupure ne perd pas ce qui attendait le réseau ; une autre personne
  // qui se connecte sur ce navigateur, avec « mon ordinateur », le trouve effacé.
  personne: (id: string) => {
    if (!lire('skanfact.jeton', localStorage)) return;
    const avant = lire('skanfact.poste_de', localStorage);
    if (avant && avant !== id) effacerLePoste();
    ecrire('skanfact.poste_de', id, localStorage);
  },
  fermer: () => { jeton = null; ecrire('skanfact.jeton', null, sessionStorage); ecrire('skanfact.jeton', null, localStorage); },
  // Se déconnecter : la session, et tout ce que le poste gardait.
  quitter: () => { session.fermer(); effacerLePoste(); },
  // L'entreprise dont le poste a une copie : sans réseau, l'entrée l'ouvre.
  horsLigne: () => (jeton ? lire('skanfact.hors_ligne', localStorage) : null),
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
  const lu = (texte ? JSON.parse(texte) : {}) as Reponse<T>['corps'];
  // Un appareil retiré (briques 74 et 74 bis ; docs/hors-ligne.md, H9 et H10), quel que soit l'écran
  // qui l'apprend : si le poste garde une entreprise, son écran passe d'abord — il remet au serveur ce
  // qui attendait le réseau, efface tout ce que le poste garde, et revient ici. Sans entreprise gardée,
  // le poste ne garde rien (la copie et ce qui attend s'écrivent avec elle).
  if (r.status === 401 && lu.effacer) {
    const gardee = lire('skanfact.hors_ligne', localStorage);
    if (gardee && jeton) {
      location.replace(`/v10/?e=${encodeURIComponent(gardee)}`);
      return await new Promise<never>(() => { /* la page s'en va */ });
    }
  }
  return { statut: r.status, corps: lu };
}
