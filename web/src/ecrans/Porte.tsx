// La porte (« Bienvenue dans SkanFact ») pour qui n'a encore aucune entreprise (lot entrée, 06/10/2026 ;
// docs/entree.md) : deux grandes cartes, la recommandée en avant et UN seul bouton plein. Découvrir : une entreprise
// d'essai, remplie de l'exemple de cinq ans de la v10, qui reste une entreprise d'essai pour toujours, et la visite de
// découverte sur elle. Commencer : « Ton entreprise », réduite à ce que le serveur prend aujourd'hui (la raison sociale
// et le matricule fiscal), avec le haut de la facture qui se dessine pendant la frappe et la forme du matricule dite
// avant le geste (vu au parcours débutant : rien ne disait où le trouver ni ce qui manquait). Un cabinet comptable : son
// nom, et le Cabinet v10 s'ouvre sur ses dossiers (brique 37 ; docs/cabinet.md).
import { useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageEtapes } from '../composants/Entree.tsx';
import { ApercuEntete, etatDuMatricule } from '../composants/Fiche.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { dire, phrase, titre } from '../langue.ts';

export function Porte({ creee, cabinetCree, decouvrir, deconnecte }: { creee: (ent: string) => void; cabinetCree: (cabinet: string) => void; decouvrir: () => void; deconnecte: () => void }) {
  const g = useGeste(deconnecte);
  const [etape, setEtape] = useState<'porte' | 'entreprise' | 'cabinet'>('porte');
  const [raison, setRaison] = useState('');
  const [nomCabinet, setNomCabinet] = useState('');
  const [matricule, setMatricule] = useState('');

  // Découvrir : l'écran « On prépare l'exemple » (lot onboarding ; ExemplePrepare.tsx) crée l'entreprise d'essai, la
  // remplit de l'exemple en disant où il en est, puis ouvre la découverte sur elle : plus de page blanche ni d'attente
  // posée par-dessus l'accueil d'une entreprise vide.
  // Créée, l'entreprise ouvre l'assistant de démarrage (lot onboarding : « Où te joindre ? », puis l'activité, la TVA et le
  // menu), qui voyage jusqu'à sa page comme la visite de la découverte (pont.js, `assistantDemande`).
  const creer = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises', { raisonSociale: raison.trim(), ...(matricule.trim() ? { matriculeFiscal: matricule.trim() } : {}) });
    if (!r) return;
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    try { sessionStorage.setItem('skanfact.assistant', r.corps.id); } catch { /* sans stockage : l'entreprise s'ouvre sur ses premiers pas */ }
    creee(r.corps.id);
  });
  const creerCabinet = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/cabinets', { nom: nomCabinet.trim() });
    if (!r) return;
    if (r.statut === 201) cabinetCree(r.corps.id); else g.refuser(refusDe(r));
  });
  const sortir = <button type="button" className="ent-lien gris" onClick={deconnecte}>{titre('ecran.deconnexion')}</button>;

  if (etape === 'cabinet') {
    return (
      <Carte icone="cabinet" droite={sortir} titre={titre('ecran.porte.cabinet_titre')} sous={phrase('ecran.porte.cabinet_sous')} onSubmit={() => { void creerCabinet(); }}
        pied={<>
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.cabinet_creer')}</Bouton>
          <Bouton discret onClick={() => setEtape('porte')}>{titre('ecran.porte.retour')}</Bouton>
        </>}>
        <Champ obligatoire libelle={titre('ecran.porte.cabinet_nom')} aide={phrase('ecran.porte.cabinet_nom_aide')} valeur={nomCabinet} changer={setNomCabinet} {...g.sur('nom')} />
      </Carte>
    );
  }
  if (etape === 'entreprise') {
    const mf = etatDuMatricule(matricule);
    return (
      <PageEtapes etape={2} droite={sortir}>
        <div className="ent-deux">
          <form noValidate onSubmit={(e) => { e.preventDefault(); void creer(); }}>
            <button type="button" className="ent-lien" onClick={() => setEtape('porte')}><Dessin id="retour" />{titre('ecran.porte.retour')}</button>
            <div className="ent-titre-page"><h1>{titre('ecran.porte.entreprise_titre')}</h1><p>{phrase('ecran.porte.entreprise_sous')}</p></div>
            <Champ obligatoire libelle={titre('ecran.porte.raison')} aide={phrase('ecran.porte.raison_aide')} valeur={raison} changer={setRaison} autoComplete="organization"
              dessous={<div className="ent-exemples"><span>{phrase('ecran.porte.raison_patente')}</span><span>{phrase('ecran.porte.raison_societe')}</span></div>} {...g.sur('raisonSociale')} />
            <Champ libelle={titre('ecran.porte.matricule')} aide={phrase('ecran.porte.matricule_aide')} valeur={matricule} changer={setMatricule} placeholder="1234567A/A/M/000"
              dessous={<span className={`ent-aide${mf.classe}`} aria-live="polite">{mf.texte}</span>} {...g.sur('matriculeFiscal')} />
            <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.creer')}<Dessin id="fleche" /></Bouton>
          </form>
          <ApercuEntete raison={raison} matricule={matricule} note={phrase('ecran.porte.apercu_note')} />
        </div>
      </PageEtapes>
    );
  }
  return (
    <PageEtapes etape={2} droite={sortir}>
      <div className="ent-titre-page centre"><h1>{titre('ecran.porte.titre')}</h1><p>{phrase('ecran.porte.deux_facons')}</p></div>
      <div className="ent-choix">
        <article className="reco">
          <div className="ent-choix-haut"><span className="ent-choix-ico"><Dessin id="boussole" /></span><span className="ent-choix-badge">{dire('ecran.porte.recommande')}</span></div>
          <h2>{titre('ecran.porte.essai_titre')}</h2>
          <p className="ent-choix-texte">{phrase('ecran.porte.essai_texte')}</p>
          <ul>
            <li><Dessin id="coche" />{titre('ecran.porte.essai_puce1')}</li>
            <li><Dessin id="coche" />{titre('ecran.porte.essai_puce2')}</li>
            <li><Dessin id="coche" />{titre('ecran.porte.essai_puce3')}</li>
          </ul>
          <Bouton principal onClick={decouvrir}>{titre('ecran.porte.essai_bouton')}</Bouton>
        </article>
        <article className="autre">
          <div className="ent-choix-haut"><span className="ent-choix-ico"><Dessin id="batiment" /></span><span className="ent-choix-meta">{titre('ecran.porte.demarrer_meta')}</span></div>
          <h2>{titre('ecran.porte.demarrer_titre')}</h2>
          <p className="ent-choix-texte">{phrase('ecran.porte.demarrer_texte')}</p>
          <ul>
            <li><Dessin id="coche" />{titre('ecran.porte.demarrer_puce1')}</li>
            <li><Dessin id="coche" />{phrase('ecran.porte.demarrer_puce2')}</li>
          </ul>
          <Bouton onClick={() => setEtape('entreprise')}>{titre('ecran.porte.demarrer_bouton')}</Bouton>
        </article>
      </div>
      <div className="ent-choix-pied">
        <button type="button" className="ent-pilule" onClick={() => setEtape('cabinet')}><Dessin id="cabinet" />{titre('ecran.porte.cabinet_lien')}<Dessin id="chevron" /></button>
      </div>
    </PageEtapes>
  );
}
