// Créer son compte : l'adresse, le nom, le mot de passe (sa longueur minimale dite AVANT le geste).
import { useState, type FormEvent } from 'react';
import { LONGUEUR_MINIMALE } from '../../../commun/compte.ts';
import { appeler, ErreurReseau } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Page, Refus } from '../composants/Page.tsx';
import { phrase, titre } from '../langue.ts';

export function Inscription({ cree, connexion }: { cree: (email: string) => void; connexion: () => void }) {
  const [email, setEmail] = useState('');
  const [nom, setNom] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [refus, setRefus] = useState<{ texte: string; champ: string | null } | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setOccupe(true);
    try {
      const r = await appeler('POST', '/inscription', { email, nom, motDePasse });
      if (r.statut === 201) cree(email);
      else setRefus({ texte: r.corps.motif ?? '', champ: r.corps.champ ?? null });
    } catch (x) {
      setRefus({ texte: x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x), champ: null });
    } finally {
      setOccupe(false);
    }
  }
  const surChamp = (c: string) => (refus?.champ?.includes(c) ? refus.texte : null);

  return (
    <Page titre={titre('ecran.inscription.titre')}>
      <form onSubmit={envoyer} className="flex flex-col gap-3" noValidate>
        <Refus texte={refus && !refus.champ ? refus.texte : null} />
        <Champ libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="email" inputMode="email" refus={surChamp('email')} />
        <Champ libelle={titre('ecran.inscription.nom')} aide={phrase('ecran.inscription.nom_aide')} valeur={nom} changer={setNom} autoComplete="name" refus={surChamp('nom')} />
        <Champ libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.inscription.mot_de_passe_aide', { min: LONGUEUR_MINIMALE })} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="new-password" refus={surChamp('motDePasse')} />
        <Bouton principal type="submit" occupe={occupe}>{titre('ecran.inscription.bouton')}</Bouton>
      </form>
      <Bouton onClick={connexion}>{titre('ecran.inscription.deja')}</Bouton>
    </Page>
  );
}
