// Créer son compte (lot entrée, 06/10/2026 ; docs/entree.md) : à gauche, les trois étapes qui attendent (ton compte, ton
// entreprise, la sécurité) ; à droite le nom, l'adresse et le mot de passe, sa jauge qui dit pendant la frappe combien il
// manque (la longueur minimale dite AVANT le geste). Le compte créé, la personne est connectée tout de suite (vu le
// 05/10/2026 en essayant le vrai serveur : on revenait à la connexion, l'adresse à retaper) ; si la connexion ne se
// fait pas, l'écran de connexion s'ouvre avec l'adresse déjà remplie.
import { useState } from 'react';
import { LONGUEUR_MINIMALE } from '../../../commun/compte.ts';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageDouble, VitrineCompte } from '../composants/Entree.tsx';
import { toast } from '../composants/Toast.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import { nomDeCetAppareil } from './Connexion.tsx';

const rien = () => undefined;

// La jauge d'un mot de passe : la longueur seule, celle que le serveur exige (le serveur refuse en plus les mots de
// passe déjà volés ailleurs : cela, il le dit au refus).
export function Jauge({ motDePasse }: { motDePasse: string }) {
  const n = [...motDePasse].length;
  const manque = LONGUEUR_MINIMALE - n;
  const niveau = n === 0 ? 0 : manque > 0 ? 1 : n < LONGUEUR_MINIMALE + 4 ? 3 : 4;
  const texte = n === 0 ? phrase('ecran.inscription.mot_de_passe_aide', { min: LONGUEUR_MINIMALE })
    : manque > 0 ? phrase(manque === 1 ? 'ecran.inscription.encore_un' : 'ecran.inscription.encore', { n: manque }) : phrase('ecran.inscription.assez');
  return (
    <>
      <div className={`ent-jauge${manque > 0 ? ' court' : ''}`} aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <span key={i} className={i <= niveau ? 'plein' : ''} />)}
      </div>
      <span className={`ent-aide${n > 0 && manque <= 0 ? ' ok' : ''}`} aria-live="polite">{texte}</span>
    </>
  );
}

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
    <PageDouble vitrine={<VitrineCompte />}
      haut={<>
        <span className="etape">{titre('ecran.inscription.etape')}</span>
        <span>{titre('ecran.inscription.deja')} <button type="button" className="ent-lien" onClick={connexion}>{titre('ecran.inscription.se_connecter')}</button></span>
      </>}>
      <form noValidate className="ent-formulaire" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
        <div className="ent-entete"><h1>{titre('ecran.inscription.titre')}</h1><p>{sous ?? phrase('ecran.inscription.sous')}</p></div>
        <Champ obligatoire libelle={titre('ecran.inscription.nom')} aide={phrase('ecran.inscription.nom_aide')} valeur={nom} changer={setNom} autoComplete="name" {...g.sur('nom')} />
        <Champ obligatoire libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="email" inputMode="email" {...g.sur('email')} />
        <Champ obligatoire libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.inscription.mot_de_passe_aide', { min: LONGUEUR_MINIMALE })} valeur={motDePasse} changer={setMotDePasse}
          type="password" autoComplete="new-password" revelable dessous={<Jauge motDePasse={motDePasse} />} {...g.sur('motDePasse')} />
        <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.inscription.bouton')}<Dessin id="fleche" /></Bouton>
      </form>
    </PageDouble>
  );
}
