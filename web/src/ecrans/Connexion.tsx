// Se connecter (lot entrée, 06/10/2026 ; docs/entree.md) : la vitrine de SkanFact à gauche, et à droite l'adresse, le
// mot de passe (qu'on peut afficher) et, si le rôle l'exige, le code du téléphone ensuite. « Mot de passe oublié ? » ne
// se propose que si le serveur sait envoyer l'e-mail ; « Créer mon compte » est un vrai bouton (c'était un petit lien
// gris que le débutant ne voyait pas). Un refus se dit en bas de l'écran et montre son champ.
import { useEffect, useState } from 'react';
import { nomDeCetAppareil } from '../appareil.ts';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Case, Champ } from '../composants/Champ.tsx';
import { Dessin, LienAide, PageDouble, VitrineConnexion } from '../composants/Entree.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

// Un défi par e-mail (0076) dit aussi à quelle adresse le code est parti, et pourquoi : l'adresse à vérifier juste après
// l'inscription, ou un appareil que SkanFact ne connaît pas.
// Un défi par SMS (0081) dit le numéro masqué, et si le SMS est parti (« rate » : le fournisseur n'a pas pu ; « limite » :
// trop de SMS envoyés à ce compte).
export type EnvoiSms = 'parti' | 'rate' | 'limite';
export type Defi = { defi: string; methode: 'application'; posteDUnAutre: boolean }
  | { defi: string; methode: 'sms'; posteDUnAutre: boolean; telephone: string; envoi: EnvoiSms }
  | { defi: string; methode: 'courriel'; posteDUnAutre: boolean; adresse: string; raison: 'inscription' | 'appareil' };
type ReponseConnexion = { etat: string; jeton?: string; defi?: string; methode?: 'sms' | 'application' | 'courriel'; appareil?: string | null; adresse?: string; jusqua?: string;
  raison?: 'inscription' | 'appareil'; telephone?: string; envoi?: EnvoiSms };
// Le défi que décrit une réponse de connexion, ou rien.
export function defiDe(r: ReponseConnexion, posteDUnAutre: boolean): Defi | null {
  if (r.etat !== 'code' || !r.defi || !r.methode) return null;
  if (r.methode === 'courriel') return r.adresse && r.raison ? { defi: r.defi, methode: 'courriel', posteDUnAutre, adresse: r.adresse, raison: r.raison } : null;
  if (r.methode === 'sms') return { defi: r.defi, methode: 'sms', posteDUnAutre, telephone: r.telephone ?? '', envoi: r.envoi ?? 'parti' };
  return { defi: r.defi, methode: r.methode, posteDUnAutre };
}
// `sous` : la phrase sous le titre, quand un partenaire a envoyé la personne ici (brique 133).
// `email` : l'adresse déjà connue (un compte qu'on vient de créer), pour ne pas la retaper.
type Props = { connecte: () => void; code: (d: Defi) => void; inscription: (profil: 'cabinet' | 'entreprise') => void; oubli: (email: string) => void; sous?: string | null; email?: string; note?: string | null };
const rien = () => undefined;


// (1.390.0) Les clés d'accès : ce navigateur sait-il en utiliser une, et les octets qu'il échange, en base64url.
export const cleSurCeNavigateur = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
export const versOctets = (t: string) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
export const versTexte = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Ce que ce serveur sait faire à l'entrée, seulement avec un relais d'e-mails : le mot de passe oublié, et l'adresse
// vérifiée par un code (0076).
export function useOptions() {
  const [options, setOptions] = useState({ oubli: false, courriel: false, cle: false });
  useEffect(() => {
    void appeler<{ motDePasseOublie: boolean; codeParCourriel?: boolean; cleAcces?: boolean }>('GET', '/connexion/options')
      .then((r) => { if (r.statut === 200) setOptions({ oubli: r.corps.motDePasseOublie, courriel: !!r.corps.codeParCourriel, cle: !!r.corps.cleAcces && cleSurCeNavigateur() }); }).catch(() => undefined);
  }, []);
  return options;
}

export function Connexion({ connecte, code, inscription, oubli, sous, note, email: connu }: Props) {
  const g = useGeste(rien);
  const options = useOptions();
  const [email, setEmail] = useState(connu ?? '');
  const [motDePasse, setMotDePasse] = useState('');
  // Le curseur se pose UNE fois, à l'ouverture, dans le premier champ qui reste à remplir : l'adresse, ou le mot de passe
  // quand l'adresse vient d'ailleurs (après « Créer mon compte », un lien). Vu le 19/10/2026 : il n'était nulle part, et
  // la première lettre tapée se perdait (la console avait la même règle depuis 1.58.0).
  const [adresseDonnee] = useState(() => email !== '');
  const [posteDUnAutre, setPosteDUnAutre] = useState(false);
  // (1.379.0, issue 4, ENTREE-2) Une session fermée ailleurs (ou finie) ramenait ici sans un mot : la phrase reste
  // au-dessus du formulaire tant qu'on ne s'est pas reconnecté.
  const [sortie] = useState(() => { try { return sessionStorage.getItem('skanfact.sortie') ?? ''; } catch { return ''; } });
  // (issue 18, ENT2-2) L'appareil retiré : la phrase du serveur (ce qui est mis de côté), qui reste, à la place de l'autre.
  const [motifRetire] = useState(() => { try { return sessionStorage.getItem('skanfact.sortie_motif') ?? ''; } catch { return ''; } });

  // (issue 4, ENTREE-10) Trop d'essais : le bouton attend l'heure donnée par le serveur et dit combien il reste.
  const [jusqua, setJusqua] = useState(0);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (jusqua <= Date.now()) return undefined;
    const t = setInterval(() => { const n = Date.now(); setMaintenant(n); if (n >= jusqua) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [jusqua]);
  const reste = Math.max(0, Math.ceil((jusqua - maintenant) / 1000));
  const temps = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, '0')}`;

  // L'appareil qui se présente, et la session qu'on ouvre : les mêmes pour le mot de passe et pour la clé d'accès (1.390.0).
  const cetAppareil = () => { const id = session.appareil(); return { nom: nomDeCetAppareil(), type: 'navigateur' as const, ...(id ? { id } : {}) }; };
  const oublierSortie = () => { try { sessionStorage.removeItem('skanfact.sortie'); sessionStorage.removeItem('skanfact.sortie_motif'); } catch { /* rien à oublier */ } };
  const ouvrir = (jeton: string, appareil: string | null | undefined) => {
    session.ouvrir(jeton, !posteDUnAutre);
    if (!posteDUnAutre) session.retenirAppareil(appareil ?? null);
    connecte();
  };

  const envoyer = () => g.geste(async () => {
    // (ENTREE-11) Ce qui manque se dit avant l'envoi, sur chaque case, avec son nom.
    const manque = [
      ...(email.trim() ? [] : [{ champ: 'email', texte: phrase('ecran.connexion.email_manque') }]),
      ...(motDePasse ? [] : [{ champ: 'motDePasse', texte: phrase('ecran.connexion.mot_de_passe_manque') }]),
    ];
    if (manque.length) { g.refuserTous(manque); return; }
    let r;
    try {
      r = await appeler<ReponseConnexion>('POST', '/connexion', {
        email, motDePasse, posteDUnAutre, appareil: cetAppareil(),
      });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    const defi = defiDe(r.corps, posteDUnAutre);
    if (r.statut < 400) oublierSortie();
    if (r.corps.etat === 'connecte' && r.corps.jeton) {
      ouvrir(r.corps.jeton, r.corps.appareil);
    } else if (defi) {
      if (!posteDUnAutre && r.corps.appareil) session.retenirAppareil(r.corps.appareil);
      code(defi);
    } else {
      if (r.corps.etat === 'attendre' && r.corps.jusqua) { const fin = Date.parse(r.corps.jusqua); if (Number.isFinite(fin)) { setMaintenant(Date.now()); setJusqua(fin); } }
      // Un refus de connexion tient au mot de passe : il se vide, et sa case dit pourquoi.
      if (r.corps.etat === 'refuse') { setMotDePasse(''); g.refuser({ ...refusDe(r), champ: 'motDePasse' }); }
      else g.refuser(refusDe(r));
    }
  });

  // (1.390.0) Entrer avec une clé d'accès : le serveur tire un défi, l'appareil le signe après l'empreinte, le visage ou son
  // code ; ni adresse ni mot de passe. La personne qui renonce (ou dont l'appareil n'a pas de clé) le lit, et l'entrée
  // par le mot de passe reste là.
  const entrerParCle = () => g.geste(async () => {
    let r;
    try {
      const p = await appeler<{ defi: string; challenge: string; rpId: string }>('POST', '/connexion/cle/preparer');
      if (p.statut !== 200) { g.refuser(refusDe(p)); return; }
      let cle: PublicKeyCredential | null = null;
      try {
        cle = await navigator.credentials.get({ publicKey: { challenge: versOctets(p.corps.challenge), rpId: p.corps.rpId, userVerification: 'required', timeout: 120_000 } }) as PublicKeyCredential | null;
      } catch { cle = null; }
      const rep = cle?.response as AuthenticatorAssertionResponse | undefined;
      if (!cle || !rep?.signature) { g.refuser({ texte: phrase('ecran.connexion.cle_annulee'), champ: null }); return; }
      r = await appeler<ReponseConnexion>('POST', '/connexion/cle', {
        defi: p.corps.defi, identifiant: versTexte(cle.rawId), donnees: versTexte(rep.authenticatorData), demande: versTexte(rep.clientDataJSON),
        signature: versTexte(rep.signature), posteDUnAutre, appareil: cetAppareil(),
      });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) { oublierSortie(); ouvrir(r.corps.jeton, r.corps.appareil); } else g.refuser(refusDe(r));
  });

  return (
    <PageDouble vitrine={<VitrineConnexion />}
      haut={<><span className="vide" /><LienAide /></>}
      bas={<span className="sur"><Dessin id="cadenas" />{phrase('ecran.connexion.chiffree')}</span>}>
      <form noValidate className="ent-formulaire" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
        <div className="ent-entete"><h1>{titre('ecran.connexion.titre')}</h1><p>{sous ?? phrase('ecran.connexion.sous')}</p></div>
        {note ? <p id="entree-note" className="ent-note" role="status">{note}</p> : null}
        {sortie ? <p id="session-finie" className="ent-note" role="status">{sortie === 'retire' ? (motifRetire || phrase('ecran.connexion.appareil_retire')) : phrase('ecran.connexion.session_finie')}{sortie === 'perdu' ? <> {phrase('ecran.connexion.session_perdu')}</> : null}</p> : null}
        <Champ libelle={titre('ecran.connexion.email')} aide={phrase('ecran.connexion.email_aide')} valeur={email} changer={setEmail} type="email" autoComplete="username" inputMode="email" premier={!adresseDonnee} {...g.sur('email')} />
        <Champ libelle={titre('ecran.connexion.mot_de_passe')} aide={phrase('ecran.connexion.mot_de_passe_aide')} valeur={motDePasse} changer={setMotDePasse} type="password" autoComplete="current-password" revelable premier={adresseDonnee} {...g.sur('motDePasse')} />
        {options.oubli ? <div className="ent-sous-champ"><button type="button" className="ent-lien" onClick={() => oubli(email)}>{titre('ecran.connexion.oublie')}</button></div> : null}
        {/* Ce que la case change se lit dans son « i », avant le geste : rien n'apparaît sous le curseur. */}
        <Case libelle={titre('ecran.connexion.poste_autre')} aide={phrase('ecran.connexion.poste_autre_aide')} coche={posteDUnAutre} changer={setPosteDUnAutre} />
        <Bouton principal type="submit" occupe={g.occupe} eteint={reste > 0}>{reste > 0 ? titre('ecran.connexion.attendre', { temps }) : <>{titre('ecran.connexion.bouton')}<Dessin id="fleche" /></>}</Bouton>
        {options.cle ? <Bouton onClick={() => void entrerParCle()} occupe={g.occupe}><span id="connexion-cle">{titre('ecran.connexion.cle')}</span></Bouton> : null}
        <div className="ent-separe">{titre('ecran.connexion.premiere_fois')}</div>
        {/* (1.379.3) Deux portes, dès ici : chacun tombe sur son écran (une seule porte menait à un choix, plus loin). */}
        <div className="ent-deux-portes">
          <Bouton onClick={() => inscription('entreprise')}><span id="creer-entreprise">{titre('ecran.connexion.creer_entreprise')}</span></Bouton>
          <Bouton onClick={() => inscription('cabinet')}><span id="creer-cabinet">{titre('ecran.connexion.creer_cabinet')}</span></Bouton>
        </div>
      </form>
    </PageDouble>
  );
}
