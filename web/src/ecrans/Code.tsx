// Le code du téléphone, après le mot de passe, dans la carte d'accueil de la v10.
import { useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import type { Defi } from './Connexion.tsx';

const rien = () => undefined;

export function Code({ defi, connecte, retour }: { defi: Defi; connecte: () => void; retour: () => void }) {
  const g = useGeste(rien);
  const [code, setCode] = useState('');

  const envoyer = () => g.geste(async () => {
    let r;
    try {
      r = await appeler<{ etat: string; jeton?: string }>('POST', '/connexion/code', { defi: defi.defi, code: code.replace(/\s/g, ''), posteDUnAutre: defi.posteDUnAutre });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) { session.ouvrir(r.corps.jeton, !defi.posteDUnAutre); connecte(); }
    // Un code faux tient au champ du code, même quand le serveur ne le nomme pas.
    else g.refuser({ ...refusDe(r), champ: 'code' });
  });

  return (
    <Carte titre={titre('ecran.code.titre')} sous={phrase(defi.methode === 'sms' ? 'ecran.code.sms' : 'ecran.code.application')} onSubmit={() => { void envoyer(); }}
      pied={<>
        <Bouton discret onClick={retour}>{titre('ecran.code.retour')}</Bouton>
        <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.code.bouton')}</Bouton>
      </>}>
      <div className="grid-2">
        <Champ classe="span-2" libelle={titre('ecran.code.champ')} aide={phrase('ecran.code.champ_aide')} valeur={code} changer={setCode} autoComplete="one-time-code" inputMode="numeric" premier {...g.sur('code')} />
        {/* Le téléphone perdu se dit à l'écran, pas seulement dans la bulle « i » (parcours débutant, 06/10/2026). */}
        <p className="small muted span-2" id="code-perdu">{phrase('ecran.code.perdu')}</p>
      </div>
    </Carte>
  );
}
