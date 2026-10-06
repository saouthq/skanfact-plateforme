// Le mot de passe oublié (lot entrée, 06/10/2026 ; migration 0075, docs/entree.md). Deux écrans : la demande (l'adresse,
// et la même réponse qu'un compte existe ou non), puis le nouveau mot de passe, ouvert par le lien de l'e-mail
// (« /?reinitialiser=<jeton> ») : il demande aussi le code du téléphone si le compte en a un, et ramène à la connexion.
import { useEffect, useState } from 'react';
import { appeler, ErreurReseau } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin } from '../composants/Entree.tsx';
import { toast } from '../composants/Toast.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import { Jauge } from './Inscription.tsx';

const rien = () => undefined;
const retourConnexion = (retour: () => void) => <button type="button" className="ent-lien" onClick={retour}><Dessin id="retour" />{titre('ecran.code.retour')}</button>;
const panne = (x: unknown) => ({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null });

export function Oubli({ email: connu, retour }: { email: string; retour: () => void }) {
  const g = useGeste(rien);
  const [email, setEmail] = useState(connu);
  const [envoye, setEnvoye] = useState<string | null>(null);

  const envoyer = () => g.geste(async () => {
    let r;
    try { r = await appeler('POST', '/mot-de-passe/oubli', { email: email.trim() }); } catch (x) { g.refuser(panne(x)); return; }
    if (r.statut === 202) setEnvoye(email.trim()); else g.refuser({ ...refusDe(r), champ: r.corps.champ ?? null });
  });

  if (envoye !== null) {
    return (
      <Carte icone="enveloppe" droite={retourConnexion(retour)} titre={titre('ecran.oubli.envoye_titre')}
        pied={<Bouton principal onClick={retour}>{titre('ecran.code.retour')}</Bouton>}>
        <p className="ent-message" role="status">{phrase('ecran.oubli.envoye', { email: envoye })}</p>
      </Carte>
    );
  }
  return (
    <Carte icone="cle" droite={retourConnexion(retour)} titre={titre('ecran.oubli.titre')} sous={phrase('ecran.oubli.sous')} onSubmit={() => { void envoyer(); }}
      pied={<Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.oubli.bouton')}</Bouton>}>
      <Champ libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="username" inputMode="email" premier {...g.sur('email')} />
    </Carte>
  );
}

export function NouveauMotDePasse({ jeton, fait, redemander, retour }: { jeton: string; fait: () => void; redemander: () => void; retour: () => void }) {
  const g = useGeste(rien);
  const [lien, setLien] = useState<{ valable: boolean; code: boolean } | null>(null);
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    void appeler<{ valable: boolean; code: boolean }>('POST', '/mot-de-passe/lien', { jeton })
      .then((r) => setLien(r.statut === 200 ? r.corps : { valable: false, code: false }))
      .catch(() => { setLien({ valable: false, code: false }); toast(phrase('ecran.erreur_reseau'), true); });
  }, [jeton]);

  const changer = () => g.geste(async () => {
    let r;
    try { r = await appeler('POST', '/mot-de-passe/nouveau', { jeton, motDePasse, ...(lien?.code ? { code: code.replace(/\s/g, '') } : {}) }); } catch (x) { g.refuser(panne(x)); return; }
    if (r.statut === 200) { toast(phrase('ecran.nouveau.fait')); fait(); return; }
    // Le lien a servi ou a expiré pendant la frappe : l'écran le dit, et propose d'en demander un autre.
    if (r.corps.champ === 'jeton') { setLien({ valable: false, code: false }); return; }
    g.refuser(refusDe(r));
  });

  if (!lien) return null;
  if (!lien.valable) {
    return (
      <Carte icone="horloge" droite={retourConnexion(retour)} titre={titre('ecran.nouveau.perime_titre')} sous={phrase('ecran.nouveau.perime')}
        pied={<><Bouton principal onClick={redemander}>{titre('ecran.nouveau.redemander')}</Bouton><Bouton discret onClick={retour}>{titre('ecran.code.retour')}</Bouton></>} />
    );
  }
  return (
    <Carte icone="cle" droite={retourConnexion(retour)} titre={titre('ecran.nouveau.titre')} sous={phrase('ecran.nouveau.sous')} onSubmit={() => { void changer(); }}
      pied={<Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.nouveau.bouton')}</Bouton>}>
      <Champ obligatoire libelle={titre('ecran.connexion.mot_de_passe')} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="new-password" revelable premier
        dessous={<Jauge motDePasse={motDePasse} />} {...g.sur('motDePasse')} />
      {lien.code ? <Champ classe="ent-code secours" libelle={titre('ecran.nouveau.code')} aide={phrase('ecran.nouveau.code_aide')} valeur={code} changer={setCode} autoComplete="one-time-code" {...g.sur('code')} /> : null}
    </Carte>
  );
}
