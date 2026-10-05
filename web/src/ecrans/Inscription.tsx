// Créer son compte, dans la carte d'accueil de la v10 : l'adresse, le nom, le mot de passe (sa
// longueur minimale dite AVANT le geste, dans sa bulle). Le compte créé, la personne est connectée tout de suite
// (vu le 05/10/2026 en essayant le vrai serveur : on revenait à la connexion, l'adresse à retaper) ; si la connexion
// ne se fait pas, l'écran de connexion s'ouvre avec l'adresse déjà remplie.
import { useState } from 'react';
import { LONGUEUR_MINIMALE } from '../../../commun/compte.ts';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { toast } from '../composants/Toast.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import { nomDeCetAppareil } from './Connexion.tsx';

const rien = () => undefined;

export function Inscription({ connecte, aConnecter, connexion, sous }: { connecte: () => void; aConnecter: (email: string) => void; connexion: () => void; sous?: string | null }) {
  const g = useGeste(rien);
  const [email, setEmail] = useState('');
  const [nom, setNom] = useState('');
  const [motDePasse, setMotDePasse] = useState('');

  const envoyer = () => g.geste(async () => {
    let r;
    try { r = await appeler('POST', '/inscription', { email, nom, motDePasse }); } catch (x) {
      g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null });
      return;
    }
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    // Le compte existe : on se connecte avec ce qu'on vient de taper (un compte neuf n'a encore aucun rôle qui exige le
    // code du téléphone).
    try {
      const c = await appeler<{ etat: string; jeton?: string; appareil?: string | null }>('POST', '/connexion', {
        email, motDePasse, posteDUnAutre: false, appareil: { nom: nomDeCetAppareil(), type: 'navigateur' },
      });
      if (c.corps.etat === 'connecte' && c.corps.jeton) {
        session.ouvrir(c.corps.jeton, true);
        session.retenirAppareil(c.corps.appareil ?? null);
        toast(phrase('ecran.inscription.faite_dedans'));
        connecte();
        return;
      }
    } catch { /* la connexion se fera à la main */ }
    toast(phrase('ecran.inscription.faite'));
    aConnecter(email);
  });

  return (
    <Carte titre={titre('ecran.inscription.titre')} sous={sous ?? phrase('ecran.accueil.sous')} onSubmit={() => { void envoyer(); }}
      pied={<>
        <Bouton discret onClick={connexion}>{titre('ecran.inscription.deja')}</Bouton>
        <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.inscription.bouton')}</Bouton>
      </>}>
      <div className="grid-2">
        <Champ classe="span-2" obligatoire libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="email" inputMode="email" {...g.sur('email')} />
        <Champ classe="span-2" obligatoire libelle={titre('ecran.inscription.nom')} aide={phrase('ecran.inscription.nom_aide')} valeur={nom} changer={setNom} autoComplete="name" {...g.sur('nom')} />
        <Champ classe="span-2" obligatoire libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.inscription.mot_de_passe_aide', { min: LONGUEUR_MINIMALE })} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="new-password" {...g.sur('motDePasse')} />
      </div>
    </Carte>
  );
}
