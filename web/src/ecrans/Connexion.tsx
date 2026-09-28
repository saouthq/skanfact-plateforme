// Se connecter : l'adresse, le mot de passe, et si le rôle l'exige, le code du téléphone ensuite.
import { useState, type FormEvent } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Aide } from '../composants/Aide.tsx';
import { Bouton } from '../composants/Bouton.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Page, Refus } from '../composants/Page.tsx';
import { phrase, titre } from '../langue.ts';

export type Defi = { defi: string; methode: 'sms' | 'application'; posteDUnAutre: boolean };
type Props = { connecte: () => void; code: (d: Defi) => void; inscription: () => void };

export function Connexion({ connecte, code, inscription }: Props) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [posteDUnAutre, setPosteDUnAutre] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setOccupe(true);
    try {
      const appareil = session.appareil();
      const r = await appeler<{ etat: string; jeton?: string; defi?: string; methode?: 'sms' | 'application'; appareil?: string | null }>('POST', '/connexion', {
        email, motDePasse, posteDUnAutre, appareil: { nom: navigator.userAgent.slice(0, 80) || 'Navigateur', type: 'navigateur', ...(appareil ? { id: appareil } : {}) },
      });
      if (r.corps.etat === 'connecte' && r.corps.jeton) {
        session.ouvrir(r.corps.jeton);
        if (!posteDUnAutre) session.retenirAppareil(r.corps.appareil ?? null);
        connecte();
      } else if (r.corps.etat === 'code' && r.corps.defi && r.corps.methode) {
        if (!posteDUnAutre && r.corps.appareil) session.retenirAppareil(r.corps.appareil);
        code({ defi: r.corps.defi, methode: r.corps.methode, posteDUnAutre });
      } else {
        setRefus(r.corps.motif ?? null);
      }
    } catch (x) {
      setRefus(x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <Page titre={titre('ecran.connexion.titre')}>
      <form onSubmit={envoyer} className="flex flex-col gap-3" noValidate>
        <Refus texte={refus} />
        <Champ libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="username" inputMode="email" />
        <Champ libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.connexion.mot_de_passe_aide')} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="current-password" />
        {/* Ce que la case change se lit dans son « i », avant le geste : rien n'apparaît sous le curseur. */}
        <div className="flex items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={posteDUnAutre} onChange={(e) => setPosteDUnAutre(e.target.checked)} className="h-5 w-5 accent-accent" />
            <span>{titre('ecran.connexion.poste_autre')}</span>
          </label>
          <Aide texte={phrase('ecran.connexion.poste_autre_aide')} />
        </div>
        <Bouton principal type="submit" occupe={occupe}>{titre('ecran.connexion.bouton')}</Bouton>
      </form>
      <Bouton onClick={inscription}>{titre('ecran.connexion.creer_compte')}</Bouton>
    </Page>
  );
}
