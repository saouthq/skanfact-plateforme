// « On prépare l'exemple » (lot onboarding ; maquette validée par Skander le 09/10/2026 ; docs/entree.md). Vu sur le
// serveur d'essai le 09/10 : choisir l'exemple ouvrait une page blanche, puis l'accueil d'une entreprise vide sous une
// fenêtre « L'exemple se prépare » qui durait une minute. Ici, l'écran dit ce qui se fait, une ligne après l'autre, et
// coche ce qui est VRAIMENT fait : le compte, l'entreprise d'essai remplie de l'exemple par le serveur (créée s'il le
// faut, une fois ; jamais une pièce inventée dans une vraie entreprise), puis la visite, qui part d'un bouton.
//
// `visite` : celle à lancer une fois l'exemple ouvert (la découverte depuis la porte), ou « exemple » (l'exemple seul).
// Un exemple déjà là ne fait pas attendre : l'entreprise d'essai s'ouvre aussitôt. Le versement prend une minute, et un
// relais peut couper la réponse avant : la même demande, refaite, attend la fin du versement puis le trouve fait.
import { useEffect, useRef, useState } from 'react';
import { appeler, ErreurReseau } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Dessin } from '../composants/Entree.tsx';
import { phrase, titre } from '../langue.ts';

type Moi = { compte?: { adresseVerifiee?: boolean }; entreprises: { id: string; essai?: boolean; parCabinet?: boolean }[] };
// `reessayable` : le serveur a trébuché (une erreur de son côté) ; une seconde demande peut aboutir, l'écran l'offre.
type Etat = { pas: 'compte' | 'exemple' | 'pret' | 'refus' | 'coupe'; motif?: string; essai?: string; vraie?: boolean; verifiee?: boolean; reessayable?: boolean };

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function ExemplePrepare({ visite, ouvrir, deconnecte }: { visite: string; ouvrir: (ent: string, visite: string) => void; deconnecte: () => void }) {
  const [etat, setEtat] = useState<Etat>({ pas: 'compte' });
  const [tentative, setTentative] = useState(0);
  const parti = useRef(false);
  // Les gestes du parent changent à chaque rendu : on garde les derniers, sans relancer la préparation.
  const gestes = useRef({ ouvrir, deconnecte });
  gestes.current = { ouvrir, deconnecte };

  useEffect(() => {
    // Une préparation abandonnée (l'écran quitté, ou « Réessayer » qui en relance une) s'arrête à sa prochaine étape :
    // jamais deux préparations qui demandent le versement en même temps.
    let fini = false;
    const sortir = () => { fini = true; gestes.current.deconnecte(); };
    void (async () => {
      try {
        const lu = await appeler<Moi>('GET', '/moi');
        if (fini) return;
        if (lu.statut === 401) { sortir(); return; }
        const moi = lu.corps;
        const vraie = moi.entreprises.some((e) => !e.essai && !e.parCabinet);
        const verifiee = !!moi.compte?.adresseVerifiee;
        let id = moi.entreprises.find((e) => e.essai && !e.parCabinet)?.id;
        setEtat({ pas: 'exemple', vraie, verifiee });
        if (!id) {
          const r = await appeler<{ id: string }>('POST', '/entreprises-essai');
          if (fini) return;
          if (r.statut === 401) { sortir(); return; }
          if (r.statut !== 201) { setEtat({ pas: 'refus', motif: r.corps.motif ?? phrase('ecran.erreur_serveur'), vraie, verifiee, reessayable: r.statut >= 500 }); return; }
          id = r.corps.id;
        }
        const t0 = Date.now();
        let deja = false;
        // Le versement : refait si la réponse a été coupée (quatre fois), ou si un enregistrement l'a croisé (deux fois).
        for (let coupes = 0, conflits = 0; !fini;) {
          let r;
          try { r = await appeler<{ deja: boolean }>('POST', `/entreprises/${encodeURIComponent(id)}/exemple`); } catch (x) {
            if (x instanceof ErreurReseau && ++coupes <= 4) { await attendre(1500); continue; }
            throw x;
          }
          if (fini) return;
          if (r.statut === 200) { deja = r.corps.deja; break; }
          if (r.statut === 401) { sortir(); return; }
          if (r.statut === 409 && ++conflits <= 2) { await attendre(800); continue; }
          // Un relais qui coupe sans un mot (un 502, 503 ou 504 vide) : une réponse coupée, pas un refus.
          if ([502, 503, 504].includes(r.statut) && !r.corps.motif) {
            if (++coupes <= 4) { await attendre(1500); continue; }
            throw new ErreurReseau();
          }
          setEtat({ pas: 'refus', motif: r.corps.motif ?? phrase('ecran.erreur_serveur'), essai: id, vraie, verifiee, reessayable: r.statut >= 500 });
          return;
        }
        if (fini) return;
        // Déjà là (et sans attente) : l'exemple s'ouvre aussitôt, sa visite avec lui.
        if (deja && Date.now() - t0 < 3000) { parti.current = true; gestes.current.ouvrir(id, visite); return; }
        setEtat({ pas: 'pret', essai: id, vraie, verifiee });
      } catch {
        if (!fini) setEtat((e) => ({ ...e, pas: 'coupe' }));
      }
    })();
    return () => { fini = true; };
  }, [tentative, visite]);

  const avecVisite = visite !== 'exemple';
  const pret = etat.pas === 'pret';
  // Une ligne : faite, en cours, ou à venir.
  const ligne = (cle: string, texte: string, detail: string, statut: 'fait' | 'cours' | 'avenir') => (
    <li key={cle} className={statut === 'fait' ? '' : statut === 'cours' ? 'attend' : 'avenir'}>
      <span className="rond">{statut === 'fait' ? <Dessin id="coche" /> : null}</span>
      <span className="txt"><b>{texte}</b><span className="detail">{detail}</span></span>
    </li>
  );
  const exempleFait = pret;
  const exempleEnCours = etat.pas === 'exemple';
  return (
    <div className="ent ent-ouverture ent-exemple" aria-busy={!pret && etat.pas !== 'refus' && etat.pas !== 'coupe'}>
      <div className="ent-ouverture-centre">
        <span className="ent-logo ent-boussole" aria-hidden="true"><Dessin id="boussole" /></span>
        <div className="ent-exemple-titre">
          <h1>{titre(pret ? 'ecran.exemple.pret' : 'ecran.exemple.prepare')}</h1>
          <p>{phrase('ecran.exemple.sous')}</p>
        </div>
        <ul>
          {ligne('compte', titre('ecran.exemple.compte'), phrase(etat.verifiee ? 'ecran.exemple.compte_verifie' : 'ecran.exemple.compte_connecte'), etat.pas === 'compte' ? 'cours' : 'fait')}
          {ligne('exemple', titre('ecran.exemple.donnees'), phrase('ecran.exemple.donnees_detail'), exempleFait ? 'fait' : exempleEnCours ? 'cours' : 'avenir')}
          {avecVisite ? ligne('visite', titre('ecran.exemple.visite'), phrase('ecran.exemple.visite_detail'), pret ? 'fait' : 'avenir') : null}
        </ul>
        {exempleEnCours ? <p className="ent-exemple-attente" role="status">{phrase('ecran.exemple.attente')}</p> : null}
        {etat.pas === 'refus' || etat.pas === 'coupe' ? (
          <div className="ent-exemple-refus">
            <p role="alert">{etat.pas === 'coupe' ? phrase('ecran.exemple.coupe') : etat.motif}</p>
            <div className="ent-exemple-gestes">
              {etat.pas === 'coupe' || etat.reessayable ? <Bouton principal onClick={() => setTentative((n) => n + 1)}>{titre('ecran.exemple.reessayer')}</Bouton> : null}
              {etat.pas === 'refus' && etat.essai ? (
                <Bouton onClick={() => {
                  // L'entreprise d'essai que le serveur ne remplit pas (elle a déjà ses pièces) s'ouvre telle quelle, sans
                  // repasser par ici, même vide (pont.js, `regarderLEssai`) : jamais un aller-retour sans fin.
                  if (!etat.essai) return;
                  try { sessionStorage.setItem('skanfact.essai_tel_quel', etat.essai); } catch { /* sans stockage : elle repasserait par ici */ }
                  ouvrir(etat.essai, '');
                }}>{titre('ecran.exemple.tel_quel')}</Bouton>
              ) : null}
              <Bouton discret onClick={() => { location.assign('/'); }}>{titre('ecran.porte.retour')}</Bouton>
            </div>
          </div>
        ) : null}
        {pret && etat.essai ? (
          <button type="button" className="ent-exemple-cta" onClick={() => { if (parti.current || !etat.essai) return; parti.current = true; ouvrir(etat.essai, visite); }}>
            {titre(avecVisite ? 'ecran.exemple.commencer' : 'ecran.exemple.ouvrir')}<Dessin id="fleche" />
          </button>
        ) : null}
        <p className="ent-exemple-pied">{phrase(etat.vraie ? 'ecran.exemple.pied_quitter' : 'ecran.exemple.pied_creer')}</p>
      </div>
    </div>
  );
}
