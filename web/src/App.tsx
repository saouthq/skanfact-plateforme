// L'entrée de SkanFact. Sans session : se connecter (ou créer son compte), puis le code du téléphone.
// Avec une session : le code à mettre en place si le rôle l'exige ; sinon ce qui a été ouvert la
// dernière fois sur ce navigateur (une entreprise : /v10/?e=<entreprise> ; un cabinet :
// /v10/cabinet/?c=<cabinet>), à défaut la première entreprise de la personne, puis son premier
// cabinet ; et la porte de la première fois si elle n'a ni l'une ni l'autre. Les entreprises qu'elle
// voit par un mandat de son cabinet ne s'ouvrent pas ici : elles sont des dossiers du Cabinet.
// Un lien d'invitation (`/?invitation=<jeton>`, brique 46) se garde le temps de se connecter (ou de créer
// son compte avec l'adresse invitée) ; il s'accepte alors, et ce qu'il fait rejoindre s'ouvre.
// Lot entrée (06/10/2026 ; docs/entree.md) : le lien du mot de passe oublié (`/?reinitialiser=<jeton>`) ouvre le choix
// d'un nouveau mot de passe ; et ce qui s'ouvre passe par l'écran d'ouverture, qui coche ce qui est fait.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { appeler, ErreurReseau, session } from './api.ts';
import { toast, Toast } from './composants/Toast.tsx';
import { Bouton } from './composants/Bouton.tsx';
import { Carte } from './composants/Carte.tsx';
import { Code } from './ecrans/Code.tsx';
import { CodeRequis } from './ecrans/CodeRequis.tsx';
import { Connecter, type DemandeConnexion, type EntrepriseDeMoi } from './ecrans/Connecter.tsx';
import { Connexion, type Defi } from './ecrans/Connexion.tsx';
import { EntrepriseNeuve, type DepuisOu } from './ecrans/EntrepriseNeuve.tsx';
import { ExemplePrepare } from './ecrans/ExemplePrepare.tsx';
import { Inscription } from './ecrans/Inscription.tsx';
import { NouveauMotDePasse, Oubli } from './ecrans/Oubli.tsx';
import { Ouverture, type Ouvrir } from './ecrans/Ouverture.tsx';
import { Porte } from './ecrans/Porte.tsx';
import { phrase, titre } from './langue.ts';

type Accueil = { ecran: 'connexion'; email?: string } | { ecran: 'inscription' } | { ecran: 'code'; defi: Defi } | { ecran: 'dedans' }
  | { ecran: 'oubli'; email: string } | { ecran: 'nouveau'; jeton: string };
type Moi = { id: string; code_methode: string | null; codeAConfigurer: boolean; entreprises: EntrepriseDeMoi[]; cabinets: { id: string; nom: string }[] };

const RETENUE = 'skanfact.entreprise';
const INVITATION = 'skanfact.invitation';
// Le défi en cours (le code à taper), gardé dans l'onglet le temps de sa validité : au téléphone, aller lire le code dans
// l'application d'e-mails puis revenir recharge parfois la page, et l'écran du code se perdait (une nouvelle connexion
// envoyait un autre code, et le premier, tapé, était refusé). Il ne donne rien sans le code.
const DEFI = 'skanfact.defi';
const DEFI_MS = 15 * 60_000;
const defiEnCours = {
  lire: (): Defi | null => {
    try {
      const t = sessionStorage.getItem(DEFI);
      const d = t ? JSON.parse(t) as { defi: Defi; le: number } : null;
      return d && Date.now() - d.le < DEFI_MS ? d.defi : null;
    } catch { return null; }
  },
  garder: (defi: Defi) => { try { sessionStorage.setItem(DEFI, JSON.stringify({ defi, le: Date.now() })); } catch { /* sans stockage : l'écran ne survit pas au rechargement */ } },
  oublier: () => { try { sessionStorage.removeItem(DEFI); } catch { /* rien à oublier */ } },
};
// Le jeton du mot de passe oublié, arrivé dans l'adresse : retiré de l'adresse aussitôt (il ne se garde nulle part).
const REINITIALISER = (() => {
  const q = new URLSearchParams(location.search);
  const j = q.get('reinitialiser');
  if (!j) return null;
  q.delete('reinitialiser');
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  return j;
})();
// Le jeton d'une invitation arrivé dans l'adresse : gardé dans l'onglet, retiré de l'adresse.
{
  const q = new URLSearchParams(location.search);
  const j = q.get('invitation');
  if (j) {
    try { sessionStorage.setItem(INVITATION, j); } catch { /* sans stockage : l'invitation ne survit pas à la connexion */ }
    q.delete('invitation');
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  }
}
// Une demande de connexion d'un partenaire (`/connecter?partenaire=…&retour=…&etat=…`, brique 133) : gardée dans l'onglet
// le temps de se connecter (ou de créer son compte, puis son entreprise), retirée de l'adresse.
const CONNEXION = 'skanfact.connecter';
if (location.pathname === '/connecter') {
  const q = new URLSearchParams(location.search);
  const d: DemandeConnexion = { partenaire: q.get('partenaire') ?? '', retour: q.get('retour') ?? '', etat: q.get('etat') ?? '' };
  try { sessionStorage.setItem(CONNEXION, JSON.stringify(d)); } catch { /* sans stockage : la demande ne survit pas à la connexion */ }
  history.replaceState(null, '', '/');
}
const connexionDemandee = {
  lire: (): DemandeConnexion | null => { try { const t = sessionStorage.getItem(CONNEXION); return t ? JSON.parse(t) as DemandeConnexion : null; } catch { return null; } },
  oublier: () => { try { sessionStorage.removeItem(CONNEXION); } catch { /* rien à oublier */ } },
};
// L'adresse demandée avant la connexion (brique 127) : seulement une entreprise de la personne, dans la v10.
const DESTINATION = 'skanfact.destination';
function destination(siennes: { id: string }[]): { adresse: string; entreprise: string } | null {
  let d: string | null = null;
  try { d = sessionStorage.getItem(DESTINATION); sessionStorage.removeItem(DESTINATION); } catch { /* sans stockage : l'accueil */ }
  const e = d ? /^\/v10\/\?e=([0-9a-f-]{36})(#\/.*)?$/.exec(d)?.[1] : undefined;
  return d && e && siennes.some((x) => x.id === e) ? { adresse: d, entreprise: e } : null;
}
const invitation = {
  lire: () => { try { return sessionStorage.getItem(INVITATION); } catch { return null; } },
  oublier: () => { try { sessionStorage.removeItem(INVITATION); } catch { /* rien à oublier */ } },
};
// Une demande venue d'une page de l'entreprise (lot onboarding ; web/public/plateforme/pont.js) : préparer l'exemple
// (`/?exemple=<visite>`), ou créer une entreprise (`/?entreprise=exemple|menu&retour=<entreprise>&visite=<visite>`). Elle
// reste dans l'adresse : un rechargement retrouve le même écran (la préparation reprend sans rien faire deux fois).
type Demande = { ecran: 'exemple'; visite: string } | { ecran: 'entreprise'; depuis: DepuisOu; retour: string | null; visite: string };
const VISITE_ID = /^[a-z0-9-]{1,60}$/;
const DEMANDE: Demande | null = (() => {
  const q = new URLSearchParams(location.search);
  const exemple = q.get('exemple');
  if (exemple !== null) return { ecran: 'exemple', visite: VISITE_ID.test(exemple) ? exemple : 'exemple' };
  const depuis = q.get('entreprise');
  if (depuis !== 'exemple' && depuis !== 'menu') return null;
  const retour = q.get('retour') ?? '';
  const visite = q.get('visite') ?? '';
  return { ecran: 'entreprise', depuis, retour: /^[0-9a-f-]{36}$/.test(retour) ? retour : null, visite: VISITE_ID.test(visite) ? visite : '' };
})();
// Ouvrir une entreprise avec la visite à y lancer (pont.js, `visiteDemandee`) ; « exemple » : l'exemple seul.
function ouvrirAvecVisite(id: string, visite: string) {
  if (visite && visite !== 'exemple') try { sessionStorage.setItem('skanfact.visite', visite); } catch { /* sans stockage : l'entreprise s'ouvre, sans la visite */ }
  ouvrirEntreprise(id);
}
// Une entreprise créée depuis l'exemple ou le menu : l'assistant de démarrage s'y ouvre, comme depuis la porte, puis la
// visite demandée (pont.js, `assistantDemande`).
function ouvrirLaCreee(id: string, visite: string) {
  try { sessionStorage.setItem('skanfact.assistant', id); } catch { /* sans stockage : l'entreprise s'ouvre sur ses premiers pas */ }
  ouvrirAvecVisite(id, visite);
}
// L'entreprise à ouvrir la prochaine fois (sur ce navigateur).
function retenir(id: string) {
  try { localStorage.setItem(RETENUE, id); } catch { /* sans stockage : la première entreprise la prochaine fois */ }
}
// Ouvrir l'application v10 d'une entreprise, et s'en souvenir.
export function ouvrirEntreprise(id: string) {
  retenir(id);
  location.assign(`/v10/?e=${encodeURIComponent(id)}`);
}
// Ouvrir le Cabinet v10, et s'en souvenir.
export function ouvrirCabinet(id: string) {
  retenir(id);
  location.assign(`/v10/cabinet/?c=${encodeURIComponent(id)}`);
}

export function App() {
  const [accueil, setAccueilBrut] = useState<Accueil>(() => {
    if (REINITIALISER) return { ecran: 'nouveau', jeton: REINITIALISER };
    if (session.jeton()) return { ecran: 'dedans' };
    const defi = defiEnCours.lire();
    return defi ? { ecran: 'code', defi } : { ecran: 'connexion' };
  });
  // L'écran du code se garde dans l'onglet ; tout autre écran l'oublie.
  const setAccueil = useCallback((a: Accueil) => {
    if (a.ecran === 'code') defiEnCours.garder(a.defi); else defiEnCours.oublier();
    setAccueilBrut(a);
  }, []);
  const [moi, setMoi] = useState<Moi | null>(null);
  // Ce qui s'ouvre (l'écran d'ouverture le montre le temps que l'application arrive).
  const [ouvrir, setOuvrir] = useState<Ouvrir | null>(null);
  const [demandeConnexion, setDemandeConnexion] = useState<DemandeConnexion | null>(connexionDemandee.lire);
  const [demande, setDemande] = useState<Demande | null>(DEMANDE);
  // Envoyée par un partenaire : la connexion (et la création du compte) disent qui attend, et pourquoi.
  const [attend, setAttend] = useState<string | null>(null);
  useEffect(() => {
    if (!demandeConnexion) return;
    void appeler<{ nom: string }>('GET', `/partenaires/${encodeURIComponent(demandeConnexion.partenaire)}?retour=${encodeURIComponent(demandeConnexion.retour)}`)
      .then((r) => { if (r.statut === 200) setAttend(phrase('ecran.connecter.connexion_sous', { partenaire: r.corps.nom })); }).catch(() => undefined);
  }, [demandeConnexion]);

  const sortir = useCallback(async () => {
    await appeler('POST', '/deconnexion').catch(() => undefined);
    session.quitter();
    setMoi(null);
    setAccueil({ ecran: 'connexion' });
  }, []);

  const charger = useCallback(async () => {
    try {
      const r = await appeler<Moi>('GET', '/moi');
      if (r.statut === 401) {
        // Un appareil retiré (brique 74) : ce que le poste gardait est effacé (api.ts), et l'écran le dit.
        if (r.corps.effacer) toast(r.corps.motif ?? '', true);
        session.fermer();
        setAccueil({ ecran: 'connexion' });
        return;
      }
      session.personne(r.corps.id);
      setMoi(r.corps);
    } catch (x) {
      // Sans réseau, l'entreprise dont ce poste garde une copie s'ouvre quand même (brique 72).
      const copie = x instanceof ErreurReseau ? session.horsLigne() : null;
      if (copie) { location.assign(`/v10/?e=${encodeURIComponent(copie)}`); return; }
      toast(phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), true);
    }
  }, []);
  useEffect(() => { if (accueil.ecran === 'dedans') void charger(); }, [accueil, charger]);

  // Une invitation en attente s'accepte d'abord : ce qu'elle fait rejoindre s'ouvre ; refusée, la
  // raison se lit, et « Continuer » reprend le chemin habituel.
  const [refusInvitation, setRefusInvitation] = useState<string | null>(null);
  useEffect(() => {
    if (!moi || moi.codeAConfigurer) return;
    const jeton = invitation.lire();
    if (!jeton) return;
    invitation.oublier();
    setRefusInvitation('');
    void (async () => {
      try {
        const r = await appeler<{ cabinet: string | null; entreprise: string | null }>('POST', '/invitations/accepter', { jeton });
        if (r.statut === 200 && r.corps.cabinet) { ouvrirCabinet(r.corps.cabinet); return; }
        if (r.statut === 200 && r.corps.entreprise) { ouvrirEntreprise(r.corps.entreprise); return; }
        setRefusInvitation(r.corps.motif ?? phrase('ecran.erreur_serveur'));
      } catch (x) {
        setRefusInvitation(phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'));
      }
    })();
  }, [moi]);

  // Une entreprise ou un cabinet existe et le code est en place : l'application v10 s'ouvre.
  const miennes = moi ? moi.entreprises.filter((x) => !x.parCabinet) : [];
  useEffect(() => {
    if (!moi || moi.codeAConfigurer || refusInvitation !== null || invitation.lire() || demandeConnexion || demande) return;
    let retenue: string | null = null;
    try { retenue = localStorage.getItem(RETENUE); } catch { /* pas de mémoire : la première */ }
    const siennes = moi.entreprises.filter((x) => !x.parCabinet);
    const demandee = destination(siennes);
    if (demandee) { retenir(demandee.entreprise); location.assign(demandee.adresse); return; }
    const cabinet = moi.cabinets.find((x) => x.id === retenue);
    const e = siennes.find((x) => x.id === retenue) ?? siennes[0];
    const protege = moi.code_methode === 'sms' || moi.code_methode === 'application';
    if (cabinet) { setOuvrir({ type: 'cabinet', nom: cabinet.nom, protege }); ouvrirCabinet(cabinet.id); }
    else if (e) { setOuvrir({ type: 'entreprise', nom: e.raison_sociale, protege }); ouvrirEntreprise(e.id); }
    else if (moi.cabinets[0]) { setOuvrir({ type: 'cabinet', nom: moi.cabinets[0].nom, protege }); ouvrirCabinet(moi.cabinets[0].id); }
  }, [moi, refusInvitation, demandeConnexion, demande]);

  const vers = (e: Accueil) => () => setAccueil(e);
  const finirConnexion = () => { connexionDemandee.oublier(); setDemandeConnexion(null); };
  let ecran: ReactNode;
  switch (accueil.ecran) {
    case 'inscription': ecran = <Inscription connecte={vers({ ecran: 'dedans' })} code={(defi) => setAccueil({ ecran: 'code', defi })}
      aConnecter={(email) => setAccueil({ ecran: 'connexion', email })} connexion={vers({ ecran: 'connexion' })} sous={attend} />; break;
    case 'code': {
      const defi = accueil.defi;
      ecran = <Code defi={defi} connecte={vers({ ecran: 'dedans' })} retour={vers({ ecran: 'connexion' })}
        corrige={(adresse) => { if (defi.methode === 'courriel') setAccueil({ ecran: 'code', defi: { ...defi, adresse } }); }} />;
      break;
    }
    case 'connexion': ecran = <Connexion connecte={vers({ ecran: 'dedans' })} code={(defi) => setAccueil({ ecran: 'code', defi })} oubli={(email) => setAccueil({ ecran: 'oubli', email })}
      inscription={vers({ ecran: 'inscription' })} sous={attend} {...(accueil.email ? { email: accueil.email } : {})} />; break;
    case 'oubli': ecran = <Oubli email={accueil.email} retour={vers({ ecran: 'connexion', email: accueil.email })} />; break;
    case 'nouveau': ecran = <NouveauMotDePasse jeton={accueil.jeton} fait={() => { session.quitter(); setMoi(null); setAccueil({ ecran: 'connexion' }); }}
      redemander={vers({ ecran: 'oubli', email: '' })} retour={vers({ ecran: 'connexion' })} />; break;
    default:
      if (refusInvitation) {
        ecran = <Carte titre={titre('ecran.invitation.titre')} pied={<Bouton principal onClick={() => setRefusInvitation(null)}>{titre('ecran.invitation.continuer')}</Bouton>}>
          <p role="alert">{refusInvitation}</p></Carte>;
      } else if (refusInvitation !== null) ecran = <Ouverture ouvrir={null} />;
      // Le code du téléphone, exigé des seuls comptables d'un cabinet (0076).
      else if (moi?.codeAConfigurer) ecran = <CodeRequis pose={() => { void charger(); }} deconnecte={() => { void sortir(); }} cabinet={moi.cabinets[0]?.nom} />;
      // Un partenaire attend l'accord : la page « Connecter » passe avant l'entreprise (ou la porte).
      else if (moi && demandeConnexion) {
        ecran = <Connecter demande={demandeConnexion} entreprises={moi.entreprises} creee={() => { void charger(); }} partir={(adresse) => { connexionDemandee.oublier(); location.assign(adresse); }} fini={finirConnexion} deconnecte={() => { void sortir(); }} />;
      }
      // « On prépare l'exemple », et « Ta vraie entreprise » (lot onboarding) : demandés par une page de l'entreprise, ou
      // par la porte.
      else if (moi && demande?.ecran === 'exemple') {
        ecran = <ExemplePrepare visite={demande.visite} ouvrir={ouvrirAvecVisite} deconnecte={() => { void sortir(); }} />;
      } else if (moi && demande?.ecran === 'entreprise') {
        ecran = <EntrepriseNeuve depuis={demande.depuis} retour={demande.retour} visite={demande.visite} creee={ouvrirLaCreee} deconnecte={() => { void sortir(); }} />;
      }
      // L'entreprise ou le cabinet créé, on relit le compte : un cabinet exige le code du téléphone d'abord.
      else if (moi && miennes.length === 0 && moi.cabinets.length === 0) {
        ecran = <Porte creee={(id) => { retenir(id); void charger(); }} cabinetCree={(id) => { retenir(id); void charger(); }} deconnecte={() => { void sortir(); }}
          decouvrir={() => { history.replaceState(null, '', '/?exemple=decouvrir'); setDemande({ ecran: 'exemple', visite: 'decouvrir' }); }} />;
      }
      // Le compte se lit, ou l'application s'ouvre : l'écran d'ouverture, jamais une page blanche.
      else ecran = <Ouverture ouvrir={ouvrir} />;
  }
  return <>{ecran}<Toast /></>;
}
