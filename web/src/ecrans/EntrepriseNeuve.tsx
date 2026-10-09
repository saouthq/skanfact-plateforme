// « Ta vraie entreprise », depuis l'exemple (lot onboarding ; maquette validée par Skander le 09/10/2026 ; docs/entree.md).
// Vu sur le serveur d'essai le 09/10 : « Quitter l'exemple », sans vraie entreprise encore, ouvrait une petite fenêtre à
// un seul champ, par-dessus l'exemple. Ici, la même page que « Ton entreprise » de la porte : la raison sociale et le
// matricule, le haut de la facture qui se dessine pendant la frappe ; puis l'assistant (« Où te joindre ? », le métier,
// la TVA et le menu), et la visite demandée en quittant l'exemple. L'exemple reste à part, et on y revient d'un clic.
// Depuis le menu des entreprises (« Nouvelle entreprise… »), la même page crée une entreprise de plus.
import { useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageEtapes } from '../composants/Entree.tsx';
import { ApercuEntete, etatDuMatricule } from '../composants/Fiche.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

export type DepuisOu = 'exemple' | 'menu';

export function EntrepriseNeuve({ depuis, retour, visite, creee, deconnecte }: {
  depuis: DepuisOu; retour: string | null; visite: string; creee: (ent: string, visite: string) => void; deconnecte: () => void;
}) {
  const g = useGeste(deconnecte);
  const [raison, setRaison] = useState('');
  const [matricule, setMatricule] = useState('');
  const exemple = depuis === 'exemple';
  const creer = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises', { raisonSociale: raison.trim(), ...(matricule.trim() ? { matriculeFiscal: matricule.trim() } : {}) });
    if (!r) return;
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    creee(r.corps.id, visite);
  });
  const mf = etatDuMatricule(matricule);
  const sortir = <button type="button" className="ent-lien gris" onClick={deconnecte}>{titre('ecran.deconnexion')}</button>;
  return (
    <PageEtapes etape={2} droite={sortir}>
      <div className="ent-deux">
        <form noValidate onSubmit={(e) => { e.preventDefault(); void creer(); }}>
          {retour ? (
            <a className="ent-lien" href={`/v10/?e=${encodeURIComponent(retour)}`}><Dessin id="retour" />{titre(exemple ? 'ecran.vraie.revenir_exemple' : 'ecran.vraie.revenir')}</a>
          ) : null}
          {exemple ? <span className="ent-pastille"><Dessin id="boussole" />{phrase('ecran.vraie.exemple_reste')}</span> : null}
          <div className="ent-titre-page"><h1>{titre(exemple ? 'ecran.vraie.titre' : 'ecran.vraie.titre_nouvelle')}</h1><p>{phrase(exemple ? 'ecran.vraie.sous' : 'ecran.vraie.sous_nouvelle')}</p></div>
          <Champ obligatoire libelle={titre('ecran.porte.raison')} aide={phrase('ecran.porte.raison_aide')} valeur={raison} changer={setRaison} autoComplete="organization"
            dessous={<div className="ent-exemples"><span>{phrase('ecran.porte.raison_patente')}</span><span>{phrase('ecran.porte.raison_societe')}</span></div>} {...g.sur('raisonSociale')} />
          <Champ libelle={titre('ecran.porte.matricule')} aide={phrase('ecran.porte.matricule_aide')} valeur={matricule} changer={setMatricule} placeholder="1234567A/A/M/000"
            dessous={<span className={`ent-aide${mf.classe}`} aria-live="polite">{mf.texte}</span>} {...g.sur('matriculeFiscal')} />
          <Bouton principal type="submit" occupe={g.occupe}>{titre(exemple ? 'ecran.vraie.creer' : 'ecran.vraie.creer_nouvelle')}<Dessin id="fleche" /></Bouton>
        </form>
        <ApercuEntete raison={raison} matricule={matricule} note={phrase(exemple ? 'ecran.vraie.apercu_note' : 'ecran.porte.apercu_note')} />
      </div>
    </PageEtapes>
  );
}
