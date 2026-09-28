// Se connecter, dans la carte d'accueil de la v10 : l'adresse, le mot de passe, et si le rôle
// l'exige, le code du téléphone ensuite. Un refus se dit en bas de l'écran et montre son champ.
import { useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Case, Champ } from '../composants/Champ.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

export type Defi = { defi: string; methode: 'sms' | 'application'; posteDUnAutre: boolean };
type Props = { connecte: () => void; code: (d: Defi) => void; inscription: () => void };
const rien = () => undefined;

export function Connexion({ connecte, code, inscription }: Props) {
  const g = useGeste(rien);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [posteDUnAutre, setPosteDUnAutre] = useState(false);

  const envoyer = () => g.geste(async () => {
    const appareil = session.appareil();
    let r;
    try {
      r = await appeler<{ etat: string; jeton?: string; defi?: string; methode?: 'sms' | 'application'; appareil?: string | null }>('POST', '/connexion', {
        email, motDePasse, posteDUnAutre, appareil: { nom: navigator.userAgent.slice(0, 80) || 'Navigateur', type: 'navigateur', ...(appareil ? { id: appareil } : {}) },
      });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) {
      session.ouvrir(r.corps.jeton);
      if (!posteDUnAutre) session.retenirAppareil(r.corps.appareil ?? null);
      connecte();
    } else if (r.corps.etat === 'code' && r.corps.defi && r.corps.methode) {
      if (!posteDUnAutre && r.corps.appareil) session.retenirAppareil(r.corps.appareil);
      code({ defi: r.corps.defi, methode: r.corps.methode, posteDUnAutre });
    } else {
      g.refuser(refusDe(r));
    }
  });

  return (
    <Carte titre={titre('ecran.connexion.titre')} sous={phrase('ecran.accueil.sous')} onSubmit={() => { void envoyer(); }}
      pied={<>
        <Bouton discret onClick={inscription}>{titre('ecran.connexion.creer_compte')}</Bouton>
        <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.connexion.bouton')}</Bouton>
      </>}>
      <div className="grid-2">
        <Champ classe="span-2" libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="username" inputMode="email" {...g.sur('email')} />
        <Champ classe="span-2" libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.connexion.mot_de_passe_aide')} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="current-password" {...g.sur('motDePasse')} />
        {/* Ce que la case change se lit dans son « i », avant le geste : rien n'apparaît sous le curseur. */}
        <div className="span-2"><Case libelle={titre('ecran.connexion.poste_autre')} aide={phrase('ecran.connexion.poste_autre_aide')} coche={posteDUnAutre} changer={setPosteDUnAutre} /></div>
      </div>
    </Carte>
  );
}
