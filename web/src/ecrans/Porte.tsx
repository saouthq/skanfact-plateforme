// La porte de la v10 (« Bienvenue dans SkanFact », 10.14.0) pour qui n'a encore aucune entreprise :
// deux façons de commencer, la recommandée en avant et UN seul bouton vert. Découvrir : une
// entreprise d'essai, déjà garnie de clients d'exemple, qui reste une entreprise d'essai pour
// toujours. Commencer : la question de la v10 « Ton entreprise », réduite à ce que le serveur prend
// aujourd'hui (la raison sociale et le matricule fiscal). Un cabinet comptable : son nom, et le
// Cabinet v10 s'ouvre sur ses dossiers (brique 37 ; docs/cabinet.md).
import { useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Icone } from '../icones.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { dire, phrase, titre } from '../langue.ts';

export function Porte({ creee, cabinetCree, deconnecte }: { creee: (ent: string) => void; cabinetCree: (cabinet: string) => void; deconnecte: () => void }) {
  const g = useGeste(deconnecte);
  const [etape, setEtape] = useState<'porte' | 'entreprise' | 'cabinet'>('porte');
  const [raison, setRaison] = useState('');
  const [nomCabinet, setNomCabinet] = useState('');
  const [matricule, setMatricule] = useState('');

  const essai = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises-essai');
    if (!r) return;
    if (r.statut === 201) creee(r.corps.id); else g.refuser(refusDe(r));
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

  if (etape === 'cabinet') {
    return (
      <Carte titre={titre('ecran.porte.cabinet_titre')} sous={phrase('ecran.porte.cabinet_sous')} onSubmit={() => { void creerCabinet(); }}
        pied={<>
          <Bouton onClick={() => setEtape('porte')}>{titre('ecran.porte.retour')}</Bouton>
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.cabinet_creer')}</Bouton>
        </>}>
        <div className="grid-2">
          <Champ classe="span-2" obligatoire libelle={titre('ecran.porte.cabinet_nom')} aide={phrase('ecran.porte.cabinet_nom_aide')} valeur={nomCabinet} changer={setNomCabinet} {...g.sur('nom')} />
        </div>
      </Carte>
    );
  }
  if (etape === 'entreprise') {
    return (
      <Carte titre={titre('ecran.porte.entreprise_titre')} sous={phrase('ecran.porte.entreprise_sous')} onSubmit={() => { void creer(); }}
        pied={<>
          <Bouton onClick={() => setEtape('porte')}>{titre('ecran.porte.retour')}</Bouton>
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.creer')}</Bouton>
        </>}>
        <div className="grid-2">
          <Champ classe="span-2" obligatoire libelle={titre('ecran.porte.raison')} aide={phrase('ecran.porte.raison_aide')} valeur={raison} changer={setRaison} {...g.sur('raisonSociale')} />
          <Champ classe="span-2" libelle={titre('ecran.porte.matricule')} aide={phrase('ecran.porte.matricule_aide')} valeur={matricule} changer={setMatricule} {...g.sur('matriculeFiscal')} />
        </div>
      </Carte>
    );
  }
  return (
    <Carte porte titre={titre('ecran.porte.titre')} sous={phrase('ecran.accueil.sous')}>
      <div className="setup-porte">
        <p className="sp-lead">{phrase('ecran.porte.deux_facons')}</p>
        <div className="sp-choix">
          <article className="pp-choix reco"><span className="pp-choix-badge">{dire('ecran.porte.recommande')}</span>
            <span className="pp-choix-ico"><Icone id="decouvrir" /></span>
            <h3>{titre('ecran.porte.essai_titre')}</h3>
            <p>{phrase('ecran.porte.essai_texte')}</p>
            <ul className="pp-choix-meta"><li>{dire('ecran.porte.essai_meta')}</li></ul>
            <Bouton principal occupe={g.occupe} onClick={() => { void essai(); }}>{titre('ecran.porte.essai_bouton')}</Bouton>
          </article>
          <article className="pp-choix"><span className="pp-choix-ico"><Icone id="demarrer" /></span>
            <h3>{titre('ecran.porte.demarrer_titre')}</h3>
            <p>{phrase('ecran.porte.demarrer_texte')}</p>
            <ul className="pp-choix-meta"><li>{dire('ecran.porte.demarrer_meta')}</li></ul>
            <Bouton onClick={() => setEtape('entreprise')}>{titre('ecran.porte.demarrer_titre')}</Bouton>
          </article>
        </div>
        <div className="sp-autres">
          <Bouton petit onClick={() => setEtape('cabinet')}>{titre('ecran.porte.cabinet_lien')}</Bouton>
          <Bouton petit onClick={deconnecte}>{titre('ecran.deconnexion')}</Bouton>
        </div>
      </div>
    </Carte>
  );
}
