// L'ouverture (lot entrée, 06/10/2026 ; docs/entree.md) : le temps que l'application arrive, l'écran coche ce qui est
// fait — vraiment fait : le compte est là, protégé s'il a son code, l'entreprise (ou le cabinet) existe — et la dernière
// ligne tourne pendant que les écrans se chargent. Rien n'y est inventé ni retardé : l'application part aussitôt.
// Sans rien à ouvrir encore (le compte se lit), « Un instant ».
import { Dessin } from '../composants/Entree.tsx';
import { titre } from '../langue.ts';

export type Ouvrir = { type: 'entreprise' | 'cabinet'; nom: string; protege: boolean };

export function Ouverture({ ouvrir }: { ouvrir: Ouvrir | null }) {
  const faits = ouvrir ? ['ecran.ouverture.compte', ...(ouvrir.protege ? ['ecran.ouverture.protege'] : []), `ecran.ouverture.${ouvrir.type}`] : [];
  return (
    <div className="ent ent-ouverture" aria-busy="true">
      <div className="ent-ouverture-centre">
        <span className="ent-logo" aria-hidden="true" data-donnee>S</span>
        <div>
          <h1>{titre(ouvrir ? `ecran.ouverture.${ouvrir.type}_titre` : 'ecran.ouverture.un_instant')}</h1>
          {ouvrir ? <p className="ent-ouverture-nom" data-donnee>{ouvrir.nom}</p> : null}
        </div>
        {ouvrir ? (
          <ul>
            {faits.map((cle) => <li key={cle}><span className="rond"><Dessin id="coche" /></span>{titre(cle)}</li>)}
            <li className="attend"><span className="rond" />{titre('ecran.ouverture.charge')}</li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}
