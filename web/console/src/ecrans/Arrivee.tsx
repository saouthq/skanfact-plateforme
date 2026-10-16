// L'issue de l'arrivée d'un client (1.45.0 ; l'audit 1.42.0 A06 ; docs/console.md C50, C61) : passé ses trente jours,
// l'arrivée d'un client qui n'a jamais payé reste dans la vue « arrivées » jusqu'à son issue — il paie, ou un membre la
// clôt d'ici, avec son motif (il a dit non, il est suivi ailleurs). Une arrivée close se rouvre (il revient, une erreur).
// La direction et le support ; chaque geste au journal.

import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Dialogue, maj, Zone } from '../ui.tsx';
import { CeQuiVa, Pied, useEnvoi } from './Sortie.tsx';

export type ArriveeClose = { le: string; par: string | null; motif: string };
const K = 'console.ecran.fiche.ar';

// Une arrivée close, sur la fiche : quand, qui, pourquoi ; et le geste qui la rouvre.
export function CarteArriveeClose({ id, nom, close, relire }: { id: string; nom: string; close: ArriveeClose; relire: () => void }) {
  const [ouverte, setOuverte] = useState(false);
  return (
    <section className="c-carte" aria-labelledby="fiche-arrivee">
      <div className="c-carte-tete">
        <h2 id="fiche-arrivee">{titre(`${K}.titre`)}</h2>
        <span className="c-carte-coin">{dire(`${K}.close_coin`)}</span>
      </div>
      <p className="c-ar-resume">{maj(dire(close.par ? `${K}.close_par` : `${K}.close_le`, { le: jourCourt(jourDe(close.le)), par: close.par ?? '' }))}</p>
      <p className="c-sous">« {close.motif} »</p>
      <div className="c-boutons-ligne"><Bouton onClick={() => setOuverte(true)}>{titre(`${K}.rouvrir`)}</Bouton></div>
      {ouverte ? <FenetreArrivee id={id} nom={nom} sens="rouvrir" fermer={() => setOuverte(false)} fait={() => { setOuverte(false); relire(); }} /> : null}
    </section>
  );
}

// Clore ou rouvrir, avec le motif : ce qui va se passer se lit avant le geste.
export function FenetreArrivee({ id, nom, sens, fermer, fait }: { id: string; nom: string; sens: 'clore' | 'rouvrir'; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/entreprises/${id}/arrivee/${sens}`, { motif: motif.trim() }, phrase(`${K}.${sens}_toast`));
  };
  return (
    <Dialogue titre={titre(`${K}.${sens}_titre`)} pour={nom} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.${sens}_bouton`)} />}>
      <CeQuiVa lignes={[phrase(`${K}.${sens}_p1`), phrase(`${K}.${sens}_p2`)]} />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.${sens}_aide`)} valeur={motif} changer={setMotif} premier faute={e.faute('motif')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}
