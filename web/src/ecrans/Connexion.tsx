// Se connecter (lot entrée, 06/10/2026 ; docs/entree.md) : la vitrine de SkanFact à gauche, et à droite l'adresse, le
// mot de passe (qu'on peut afficher) et, si le rôle l'exige, le code du téléphone ensuite. « Mot de passe oublié ? » ne
// se propose que si le serveur sait envoyer l'e-mail ; « Créer mon compte » est un vrai bouton (c'était un petit lien
// gris que le débutant ne voyait pas). Un refus se dit en bas de l'écran et montre son champ.
import { useEffect, useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Case, Champ } from '../composants/Champ.tsx';
import { Dessin, PageDouble, VitrineConnexion } from '../composants/Entree.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

export type Defi = { defi: string; methode: 'sms' | 'application'; posteDUnAutre: boolean };
// `sous` : la phrase sous le titre, quand un partenaire a envoyé la personne ici (brique 133).
// `email` : l'adresse déjà connue (un compte qu'on vient de créer), pour ne pas la retaper.
type Props = { connecte: () => void; code: (d: Defi) => void; inscription: () => void; oubli: (email: string) => void; sous?: string | null; email?: string };
const rien = () => undefined;
// Le contact de SkanFact, sur son site.
export const AIDE = 'https://skanfact.tn/contact.html';

// Le nom de cet appareil, lisible dans « Tes appareils » (brique 74) : « Chrome sur Windows ».
export function nomDeCetAppareil() {
  const n = navigator.userAgent;
  const nav = /Edg\//.test(n) ? 'Edge' : /Firefox\//.test(n) ? 'Firefox' : /Chrome\//.test(n) ? 'Chrome' : /Safari\//.test(n) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(n) ? 'Android' : /iPhone|iPad/.test(n) ? 'iPhone' : /Windows/.test(n) ? 'Windows' : /Mac OS X|Macintosh/.test(n) ? 'Mac' : /Linux/.test(n) ? 'Linux' : '';
  return os ? `${nav} sur ${os}` : nav;
}

// Ce que ce serveur sait faire à l'entrée (le mot de passe oublié : seulement avec un relais d'e-mails).
export function useOptions() {
  const [oubli, setOubli] = useState(false);
  useEffect(() => {
    void appeler<{ motDePasseOublie: boolean }>('GET', '/connexion/options').then((r) => { if (r.statut === 200) setOubli(r.corps.motDePasseOublie); }).catch(() => undefined);
  }, []);
  return { oubli };
}

export function Connexion({ connecte, code, inscription, oubli, sous, email: connu }: Props) {
  const g = useGeste(rien);
  const options = useOptions();
  const [email, setEmail] = useState(connu ?? '');
  const [motDePasse, setMotDePasse] = useState('');
  const [posteDUnAutre, setPosteDUnAutre] = useState(false);

  const envoyer = () => g.geste(async () => {
    const appareil = session.appareil();
    let r;
    try {
      r = await appeler<{ etat: string; jeton?: string; defi?: string; methode?: 'sms' | 'application'; appareil?: string | null }>('POST', '/connexion', {
        email, motDePasse, posteDUnAutre, appareil: { nom: nomDeCetAppareil(), type: 'navigateur', ...(appareil ? { id: appareil } : {}) },
      });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) {
      session.ouvrir(r.corps.jeton, !posteDUnAutre);
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
    <PageDouble vitrine={<VitrineConnexion />}
      haut={<><span className="vide" /><a className="ent-lien" href={AIDE} target="_blank" rel="noopener noreferrer">{titre('ecran.connexion.aide')}</a></>}
      bas={<span className="sur"><Dessin id="cadenas" />{phrase('ecran.connexion.chiffree')}</span>}>
      <form noValidate className="ent-formulaire" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
        <div className="ent-entete"><h1>{titre('ecran.connexion.titre')}</h1><p>{sous ?? phrase('ecran.connexion.sous')}</p></div>
        <Champ libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="username" inputMode="email" {...g.sur('email')} />
        <Champ libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.connexion.mot_de_passe_aide')} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="current-password" revelable {...g.sur('motDePasse')} />
        {options.oubli ? <div className="ent-sous-champ"><button type="button" className="ent-lien" onClick={() => oubli(email)}>{titre('ecran.connexion.oublie')}</button></div> : null}
        {/* Ce que la case change se lit dans son « i », avant le geste : rien n'apparaît sous le curseur. */}
        <Case libelle={titre('ecran.connexion.poste_autre')} aide={phrase('ecran.connexion.poste_autre_aide')} coche={posteDUnAutre} changer={setPosteDUnAutre} />
        <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.connexion.bouton')}<Dessin id="fleche" /></Bouton>
        <div className="ent-separe">{titre('ecran.connexion.premiere_fois')}</div>
        <Bouton onClick={inscription}>{titre('ecran.connexion.creer_compte')}</Bouton>
      </form>
    </PageDouble>
  );
}
