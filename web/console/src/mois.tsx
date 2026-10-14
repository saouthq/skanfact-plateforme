// Un mois à la fois (les paiements, nos factures) : « ‹ Septembre », « Octobre 2026 », « Novembre › », jamais un mois à
// venir. Les deux boutons gardent leur largeur d'un mois à l'autre (« ‹ Août », « ‹ Septembre ») : un second clic tombe
// au même endroit. Les noms des mois sont des dates (des données), pas des textes du catalogue.
import { titre } from './langue.ts';
import { moisEnMots } from './temps.ts';
import { Bouton, maj } from './ui.tsx';

// Le mois d'avant, le mois d'après (« 2026-10 »).
export function moisVoisin(m: string, pas: number): string {
  const [a = 2026, n = 1] = m.split('-').map(Number);
  const d = new Date(Date.UTC(a, n - 1 + pas, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Un mois lu dans l'adresse : réel, et jamais après celui d'aujourd'hui ; sinon, celui d'aujourd'hui.
export const moisLu = (m: string | null, courant: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= courant ? m : courant);

export function MoisNav({ mois, courant, aller }: { mois: string; courant: string; aller: (m: string) => void }) {
  const avant = moisVoisin(mois, -1), apres = moisVoisin(mois, 1);
  return (
    <nav className="c-mois" aria-label={titre('console.ecran.mois.choisir')}>
      <Bouton petit etiquette={titre('console.ecran.mois.voir', { mois: moisEnMots(avant) })} onClick={() => aller(avant)}>
        ‹ <span data-donnee>{maj(moisEnMots(avant, false))}</span>
      </Bouton>
      <b aria-live="polite" data-donnee>{maj(moisEnMots(mois))}</b>
      <Bouton petit desactive={mois >= courant} etiquette={titre('console.ecran.mois.voir', { mois: moisEnMots(apres) })} onClick={() => aller(apres)}>
        <span data-donnee>{maj(moisEnMots(apres, false))}</span> ›
      </Bouton>
    </nav>
  );
}
