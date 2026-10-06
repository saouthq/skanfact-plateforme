// La porte (« Bienvenue dans SkanFact ») pour qui n'a encore aucune entreprise (lot entrée, 06/10/2026 ;
// docs/entree.md) : deux grandes cartes, la recommandée en avant et UN seul bouton plein. Découvrir : une entreprise
// d'essai, remplie de l'exemple de cinq ans de la v10, qui reste une entreprise d'essai pour toujours, et la visite de
// découverte sur elle. Commencer : « Ton entreprise », réduite à ce que le serveur prend aujourd'hui (la raison sociale
// et le matricule fiscal), avec le haut de la facture qui se dessine pendant la frappe et la forme du matricule dite
// avant le geste (vu au parcours débutant : rien ne disait où le trouver ni ce qui manquait). Un cabinet comptable : son
// nom, et le Cabinet v10 s'ouvre sur ses dossiers (brique 37 ; docs/cabinet.md).
import { useState } from 'react';
import { matriculeCanonique, matriculeSansSuite } from '../../../commun/matricule.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageEtapes } from '../composants/Entree.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { dire, phrase, titre } from '../langue.ts';

// Ce que l'écran dit du matricule pendant la frappe : la même règle que le serveur (commun/matricule.ts).
function etatDuMatricule(m: string): { texte: string; classe: string } {
  if (!m.trim()) return { texte: phrase('ecran.porte.mf_ou'), classe: '' };
  if (matriculeCanonique(m)) return { texte: phrase('ecran.porte.mf_ok'), classe: ' ok' };
  if (matriculeSansSuite(m)) return { texte: phrase('ecran.porte.mf_debut'), classe: ' alerte' };
  return { texte: phrase('ecran.porte.mf_faux'), classe: ' alerte' };
}

export function Porte({ creee, cabinetCree, deconnecte }: { creee: (ent: string) => void; cabinetCree: (cabinet: string) => void; deconnecte: () => void }) {
  const g = useGeste(deconnecte);
  const [etape, setEtape] = useState<'porte' | 'entreprise' | 'cabinet'>('porte');
  const [raison, setRaison] = useState('');
  const [nomCabinet, setNomCabinet] = useState('');
  const [matricule, setMatricule] = useState('');

  // Découvrir : l'entreprise d'essai, puis la découverte de la v10 sur elle — le serveur la remplit de l'exemple d'abord
  // (retour de Skander, 05/10/2026 : elle n'avait que trois clients, et la visite n'avait rien à montrer). La visite
  // voyage jusqu'à la page de l'entreprise (web/public/plateforme/pont.js, `visiteDemandee`).
  const essai = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises-essai');
    if (!r) return;
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    try { sessionStorage.setItem('skanfact.visite', 'decouvrir'); } catch { /* sans stockage : l'entreprise d'essai s'ouvre, sans la découverte */ }
    creee(r.corps.id);
  });
  const creer = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises', { raisonSociale: raison.trim(), ...(matricule.trim() ? { matriculeFiscal: matricule.trim() } : {}) });
    if (!r) return;
    if (r.statut === 201) creee(r.corps.id); else g.refuser(refusDe(r));
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
    const lisible = matriculeCanonique(matricule) ?? matricule.trim().toUpperCase();
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
          <div className="ent-apercu" aria-hidden="true">
            <span className="ent-apercu-etiquette">{dire('ecran.porte.apercu')}</span>
            <div className="ent-apercu-page">
              <div className="ent-apercu-haut">
                <div className="ent-apercu-qui">
                  <span className="ent-apercu-logo">{titre('ecran.porte.apercu_logo')}</span>
                  <div className="ent-apercu-nom">
                    {raison.trim() ? <strong data-donnee>{raison.trim()}</strong> : <strong className="vide">{titre('ecran.porte.apercu_raison')}</strong>}
                    <span>{dire('ecran.porte.apercu_mf')} : {lisible ? <span data-donnee>{lisible}</span> : '—'}</span>
                  </div>
                </div>
                <span className="ent-apercu-type">{dire('ecran.porte.apercu_type')}</span>
              </div>
              <div className="ent-apercu-lignes">
                <i style={{ width: '62%' }} /><i style={{ width: '48%' }} />
                <div className="ligne"><i style={{ width: '40%' }} /><i style={{ width: '14%' }} /></div>
                <div className="ligne"><i style={{ width: '34%' }} /><i style={{ width: '12%' }} /></div>
              </div>
            </div>
            <span className="ent-aide">{phrase('ecran.porte.apercu_note')}</span>
          </div>
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
          <Bouton principal occupe={g.occupe} onClick={() => { void essai(); }}>{titre('ecran.porte.essai_bouton')}</Bouton>
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
