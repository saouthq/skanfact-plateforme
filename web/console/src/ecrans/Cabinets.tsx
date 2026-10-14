// L'en-tête de la liste des clients, et les places d'une entreprise auprès d'un cabinet (son client abonné, un dossier
// qu'il tient, un mandat en attente). Les cabinets sont des lignes de la liste des clients (la maquette Clients) : leur
// liste à part n'existe plus, son adresse (« #/cabinets ») ouvre la liste des clients filtrée sur eux.
import type { ReactNode } from 'react';
import { phrase, titre } from '../langue.ts';

export type Place = 'client' | 'tenu' | 'en_attente';
export const PLACES: readonly Place[] = ['client', 'tenu', 'en_attente'];

// `action` : le geste de la page, en haut à droite (la maquette Clients : « Exporter la sélection »).
export function EnteteClients({ action }: { action?: ReactNode }) {
  return (
    <header className="c-entete">
      <div className="c-entete-texte">
        <h1>{titre('console.ecran.clients.titre')}</h1>
        <p className="c-entete-sous">{phrase('console.ecran.clients.sous')}</p>
      </div>
      {action ? <div className="c-entete-actions">{action}</div> : null}
    </header>
  );
}
