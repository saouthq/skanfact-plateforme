// Ce que chaque écran fait de ses appels, comme la v10 : une session finie ramène à la connexion ; un
// refus du serveur se dit en bas de l'écran (en rouge) et, s'il tient à un champ, ce champ prend le
// focus et se marque (`refus()` de la v10) ; une panne se dit aussi, jamais en silence ; pendant un
// geste, le bouton est occupé (jamais deux envois d'un même geste).
import { useCallback, useRef, useState } from 'react';
import { appeler, ErreurReseau, session, type Reponse } from './api.ts';
import type { Faute } from './composants/Champ.tsx';
import { toast } from './composants/Toast.tsx';
import { phrase } from './langue.ts';

// `texte` : ce qui se dit (la raison seule quand un champ la porte : le champ montre déjà lequel).
export type RefusVu = { texte: string; champ: string | null };

// Une raison seule (« il manque ») devient une phrase (« Il manque. »).
const enPhrase = (s: string) => { const i = s.search(/\p{L}/u); const t = i < 0 ? s : s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); return /[.!?…]$/.test(t) ? t : `${t}.`; };

export function refusDe(r: Reponse): RefusVu {
  // Une panne du serveur n'a pas de motif pour la personne : elle se dit quand même.
  if (r.statut >= 500 || !r.corps.motif) return { texte: phrase('ecran.erreur_serveur'), champ: null };
  const champ = r.corps.champ ?? null;
  const raison = r.corps.raison;
  return { texte: champ && raison ? enPhrase(raison) : r.corps.motif, champ };
}

let numero = 0;

export function useGeste(deconnecte: () => void) {
  const [faute, setFaute] = useState<Faute>(null);
  const [occupe, setOccupe] = useState(false);
  // `deconnecte` change à chaque rendu du parent : on garde le dernier, sans rien recharger.
  const sortir = useRef(deconnecte);
  sortir.current = deconnecte;

  // Un appel à l'API ; `null` quand la session est finie (on est déjà reparti à la connexion).
  const api = useCallback(async <T = Record<string, unknown>>(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, corps?: unknown): Promise<Reponse<T> | null> => {
    const r = await appeler<T>(methode, chemin, corps);
    if (r.statut === 401) { session.fermer(); sortir.current(); return null; }
    return r;
  }, []);

  // Dire un refus : en bas de l'écran, et sur son champ s'il en a un (`renommer` traduit le chemin
  // du serveur, « brouillon.lignes.0.prixUnitaire », en celui de l'écran).
  const refuser = useCallback((v: RefusVu, renommer?: (champ: string) => string) => {
    toast(v.texte, true);
    setFaute(v.champ ? { champ: renommer ? renommer(v.champ) : v.champ, n: ++numero } : null);
  }, []);

  const geste = useCallback(async (f: () => Promise<void>) => {
    setOccupe(true);
    setFaute(null);
    try { await f(); } catch (x) {
      refuser({ texte: x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x), champ: null });
    } finally { setOccupe(false); }
  }, [refuser]);

  // Ce qu'un champ reçoit pour se montrer refusé : `faute` et le numéro du refus.
  const sur = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : undefined });
  return { faute, occupe, api, geste, refuser, sur };
}
