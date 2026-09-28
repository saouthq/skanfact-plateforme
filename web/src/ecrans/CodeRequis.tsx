// Le code du téléphone à mettre en place (le rôle l'exige, 03 § 6), puis l'adresse à ajouter dans
// l'application d'authentification et les codes de secours, montrés une seule fois. Dans la carte
// d'accueil de la v10 : c'est l'étape suivante, et la seule.
import { useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

export function CodeRequis({ pose, deconnecte }: { pose: () => void; deconnecte: () => void }) {
  const g = useGeste(deconnecte);
  const [codes, setCodes] = useState<{ adresse: string | null; secours: string[] } | null>(null);

  const poser = () => g.geste(async () => {
    const r = await g.api<{ codesDeSecours: string[]; adresseApplication: string | null }>('POST', '/moi/code', { methode: 'application' });
    if (!r) return;
    if (r.statut === 200) setCodes({ adresse: r.corps.adresseApplication, secours: r.corps.codesDeSecours }); else g.refuser(refusDe(r));
  });

  if (codes) {
    return (
      <Carte titre={titre('ecran.code_pose.titre')} sous={phrase('ecran.code_pose.application')}
        pied={<Bouton principal onClick={pose}>{titre('ecran.code_pose.bouton')}</Bouton>}>
        {codes.adresse ? <p><code className="adresse-code" data-donnee>{codes.adresse}</code></p> : null}
        <p>{phrase('ecran.code_pose.secours')}</p>
        <ul className="codes-secours" data-donnee>{codes.secours.map((c) => <li key={c}>{c}</li>)}</ul>
      </Carte>
    );
  }
  return (
    <Carte titre={titre('ecran.code_requis.titre')} sous={phrase('ecran.accueil.sous')}
      pied={<>
        <Bouton discret onClick={deconnecte}>{titre('ecran.deconnexion')}</Bouton>
        <Bouton principal occupe={g.occupe} onClick={() => { void poser(); }}>{titre('ecran.code_requis.bouton')}</Bouton>
      </>}>
      <p>{phrase('ecran.code_requis.aide')}</p>
    </Carte>
  );
}
