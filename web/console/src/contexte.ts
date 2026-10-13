// Ce que chaque écran de la console sait de la session : qui est connecté (son nom, son rôle, le jour de Tunis), comment
// en sortir, et comment lire l'API à son nom. Une session finie (une heure sans geste, une déconnexion ailleurs, un
// retrait de l'équipe) ramène à l'entrée, avec la phrase qui le dit : jamais un écran qui reste vide.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { phrase, typo } from './langue.ts';
import { appeler, ErreurReseau, session, type Reponse } from './api.ts';

export type Role = 'direction' | 'support' | 'technique';
export type Moi = { utilisateur: string; nom: string; email: string; role: Role; aujourdhui: string };
export type Ctx = { moi: Moi; sortir: (message?: string) => void; compterDecisions: (n: number) => void; relireDecisions: () => void };

export const ContexteConsole = createContext<Ctx | null>(null);
export function useConsole(): Ctx {
  const c = useContext(ContexteConsole);
  if (!c) throw new Error('écran de la console hors de la console');
  return c;
}

// Ce qu'un refus du serveur dit : son motif (déjà rendu dans la langue de l'écran) ; une panne se dit quand même.
export function refusDe(r: Reponse<unknown>): string {
  if (r.statut >= 500 || !r.corps.motif) return phrase('console.ecran.erreur_serveur');
  return typo(r.corps.motif);
}
export const panneDe = (x: unknown) => phrase(x instanceof ErreurReseau ? 'console.ecran.erreur_reseau' : 'console.ecran.erreur_serveur');

export type Methode = 'GET' | 'POST' | 'PUT';
export function useApi() {
  const { sortir } = useConsole();
  const sortirRef = useRef(sortir);
  sortirRef.current = sortir;
  return useCallback(async <T>(methode: Methode, chemin: string, corps?: unknown): Promise<Reponse<T> | null> => {
    const r = await appeler<T>(methode, chemin, corps);
    if (r.statut === 401) {
      session.fermer();
      sortirRef.current(phrase('console.ecran.session_finie'));
      return null;
    }
    return r;
  }, []);
}

// Lire ce qu'un écran montre : en lecture, lu, ou en panne (et « Réessayer »). Relire garde ce qui est à l'écran tant
// que la `cle` ne change pas (une recherche, un geste qui vient d'être fait) : rien ne clignote ; une autre clé (une
// autre fiche) repart de zéro, jamais les données d'un autre client sous un nouveau titre.
export type Lecture<T> = { etat: 'lecture' } | { etat: 'lu'; donnees: T; enCours: boolean } | { etat: 'panne'; texte: string };
export function useLecture<T>(chemin: string, cle: string = chemin): [Lecture<T>, () => void] {
  const api = useApi();
  const [n, setN] = useState(0);
  const [lu, setLu] = useState<{ cle: string; l: Lecture<T> }>({ cle, l: { etat: 'lecture' } });
  useEffect(() => {
    let actif = true;
    setLu((x) => (x.cle === cle && x.l.etat === 'lu' ? { cle, l: { ...x.l, enCours: true } } : { cle, l: { etat: 'lecture' } }));
    void (async () => {
      try {
        const r = await api<T>('GET', chemin);
        if (!actif || !r) return;
        setLu({ cle, l: r.statut === 200 ? { etat: 'lu', donnees: r.corps, enCours: false } : { etat: 'panne', texte: refusDe(r) } });
      } catch (x) {
        if (actif) setLu({ cle, l: { etat: 'panne', texte: panneDe(x) } });
      }
    })();
    return () => { actif = false; };
  }, [api, chemin, cle, n]);
  const relire = useCallback(() => setN((x) => x + 1), []);
  return [lu.cle === cle ? lu.l : { etat: 'lecture' }, relire];
}
