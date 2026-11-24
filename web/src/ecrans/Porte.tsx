// La porte (« Bienvenue dans SkanFact ») pour qui n'a encore aucune entreprise (lot entrée, 06/10/2026 ;
// docs/entree.md) : deux grandes cartes, la recommandée en avant et UN seul bouton plein. Découvrir : une entreprise
// d'essai, remplie de l'exemple de cinq ans de la v10, qui reste une entreprise d'essai pour toujours, et la visite de
// découverte sur elle. Commencer : « Ton entreprise », réduite à ce que le serveur prend aujourd'hui (la raison sociale
// et le matricule fiscal), avec le haut de la facture qui se dessine pendant la frappe et la forme du matricule dite
// avant le geste (vu au parcours débutant : rien ne disait où le trouver ni ce qui manquait). Un cabinet comptable : son
// nom, et le Cabinet v10 s'ouvre sur ses dossiers (brique 37 ; docs/cabinet.md).
import { useEffect, useRef, useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageEtapes } from '../composants/Entree.tsx';
import { ApercuEntete, AideMatricule } from '../composants/Fiche.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { dire, phrase, titre } from '../langue.ts';

// `pourUnClient` (1.77.0) : arrivé par le lien d'un client qui l'invite, le comptable sans cabinet commence par le sien ;
// la phrase dit le client qui l'attend.
// (issue 18, ENT2-8) Ce qui est tapé sur « Ton entreprise » ou « Ton cabinet » survit à un rechargement et à une
// déconnexion dans cet onglet, comme l'assistant qui suit : gardé pour la personne connectée seulement, effacé à la création.
const BROUILLON = 'skanfact.porte';
type Brouillon = { qui: string; etape: 'porte' | 'entreprise' | 'cabinet'; raison: string; matricule: string; ville: string; nomCabinet: string };
function lireBrouillon(qui: string | undefined): Brouillon | null {
  if (!qui) return null;
  try { const b = JSON.parse(sessionStorage.getItem(BROUILLON) ?? 'null') as Brouillon | null; return b && b.qui === qui ? b : null; } catch { return null; }
}
const oublierBrouillon = () => { try { sessionStorage.removeItem(BROUILLON); } catch { /* rien à oublier */ } };

export function Porte({ creee, cabinetCree, decouvrir, deconnecte, pourUnClient, profil, personne }: { creee: (ent: string) => void; cabinetCree: (cabinet: string) => void; decouvrir: () => void; deconnecte: () => void; pourUnClient?: string | null; profil?: 'cabinet' | 'entreprise' | null; personne?: string | undefined }) {
  const g = useGeste(deconnecte);
  type Etape = 'porte' | 'entreprise' | 'cabinet' | 'depart';
  const [lu] = useState(() => lireBrouillon(personne));
  const [etape, setEtapeBrute] = useState<Etape>(pourUnClient || profil === 'cabinet' ? 'cabinet' : lu && lu.etape !== 'porte' ? lu.etape : 'porte');
  // (ENTREE-12) Ouvrir une carte est une page de plus : « Précédent » ramène à la porte. « Ton départ » remplace sa page
  // et ne se quitte pas par l'historique : l'entreprise ou le cabinet y est déjà créé.
  const etapeVue = useRef<Etape>(etape);
  const setEtape = (e: Etape) => {
    if (e !== etapeVue.current) { try { if (e === 'depart') history.replaceState({ ...(history.state ?? {}), porte: e }, '', location.href); else history.pushState({ ...(history.state ?? {}), porte: e }, '', location.href); } catch { /* l'écran change quand même */ } }
    etapeVue.current = e;
    setEtapeBrute(e);
  };
  useEffect(() => {
    try { history.replaceState({ ...(history.state ?? {}), porte: etapeVue.current }, '', location.href); } catch { /* rien */ }
    const revenir = (ev: PopStateEvent) => {
      const e = (ev.state as { porte?: Etape } | null)?.porte;
      if (!e || e === 'depart' || etapeVue.current === 'depart') return;
      etapeVue.current = e;
      setEtapeBrute(e);
    };
    addEventListener('popstate', revenir);
    return () => removeEventListener('popstate', revenir);
  }, []);
  // (1.379.3) Venu pour son entreprise, la porte ne montre que les deux façons de commencer ; le cabinet reste à un lien.
  const sansCabinet = profil === 'entreprise';
  // (1.373.0) Le cabinet créé, on choisit par où commencer (son dossier d'exemple, ou ses clients) avant de l'ouvrir.
  const [cabinetNeuf, setCabinetNeuf] = useState<string | null>(null);
  const [raison, setRaison] = useState(lu?.raison ?? '');
  const [nomCabinet, setNomCabinet] = useState(lu?.nomCabinet ?? '');
  const [matricule, setMatricule] = useState(lu?.matricule ?? '');
  // Sa ville, facultative (0110) : l'équipe SkanFact la lit sur sa fiche pour le reconnaître au téléphone.
  const [ville, setVille] = useState(lu?.ville ?? '');
  useEffect(() => {
    if (!personne || etape === 'depart') return;
    try { sessionStorage.setItem(BROUILLON, JSON.stringify({ qui: personne, etape, raison, matricule, ville, nomCabinet } satisfies Brouillon)); } catch { /* sans stockage : la saisie vit en mémoire */ }
  }, [personne, etape, raison, matricule, ville, nomCabinet]);

  // Découvrir : l'écran « On prépare l'exemple » (lot onboarding ; ExemplePrepare.tsx) crée l'entreprise d'essai, la
  // remplit de l'exemple en disant où il en est, puis ouvre la découverte sur elle : plus de page blanche ni d'attente
  // posée par-dessus l'accueil d'une entreprise vide.
  // Créée, l'entreprise ouvre l'assistant de démarrage (lot onboarding : « Où te joindre ? », puis l'activité, la TVA et le
  // menu), qui voyage jusqu'à sa page comme la visite de la découverte (pont.js, `assistantDemande`).
  const creer = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises', { raisonSociale: raison.trim(), ...(matricule.trim() ? { matriculeFiscal: matricule.trim() } : {}), ...(ville.trim() ? { ville: ville.trim() } : {}) });
    if (!r) return;
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    try { sessionStorage.setItem('skanfact.assistant', r.corps.id); } catch { /* sans stockage : l'entreprise s'ouvre sur ses premiers pas */ }
    oublierBrouillon();
    creee(r.corps.id);
  });
  const creerCabinet = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/cabinets', { nom: nomCabinet.trim() });
    if (!r) return;
    if (r.statut !== 201) { g.refuser(refusDe(r)); return; }
    oublierBrouillon();
    // Invité par un client, son dossier l'attend : le cabinet s'ouvre dessus, sans détour.
    if (pourUnClient) { cabinetCree(r.corps.id); return; }
    setCabinetNeuf(r.corps.id); setEtape('depart');
  });
  // Le Cabinet lit ce mot à son ouverture, charge le dossier d'exemple en disant où il en est, et l'ouvre (app-2.js).
  const ouvrirCabinet = (avecExemple: boolean) => {
    if (!cabinetNeuf) return;
    try { if (avecExemple) sessionStorage.setItem('skanfact.cabinet.exemple', cabinetNeuf); } catch { /* sans stockage : l'exemple reste à un clic, dans « Par où commencer » */ }
    cabinetCree(cabinetNeuf);
  };
  const sortir = <button type="button" className="ent-lien gris" onClick={deconnecte}>{titre('ecran.deconnexion')}</button>;

  if (etape === 'depart') {
    return (
      <PageEtapes etape={3} cabinet droite={sortir}>
        <div className="ent-titre-page centre"><h1>{titre('ecran.porte.depart_titre', { nom: nomCabinet.trim() })}</h1><p>{phrase('ecran.porte.depart_sous')}</p></div>
        <div className="ent-choix">
          <article className="reco">
            <div className="ent-choix-haut"><span className="ent-choix-ico"><Dessin id="boussole" /></span><span className="ent-choix-badge">{dire('ecran.porte.recommande')}</span></div>
            <h2>{titre('ecran.porte.depart_exemple_titre')}</h2>
            <p className="ent-choix-texte">{phrase('ecran.porte.depart_exemple_texte')}</p>
            <ul>
              <li><Dessin id="coche" />{titre('ecran.porte.depart_exemple_puce1')}</li>
              <li><Dessin id="coche" />{titre('ecran.porte.depart_exemple_puce2')}</li>
              <li><Dessin id="coche" />{titre('ecran.porte.depart_exemple_puce3')}</li>
            </ul>
            <Bouton principal onClick={() => ouvrirCabinet(true)}>{titre('ecran.porte.depart_exemple_bouton')}</Bouton>
          </article>
          <article className="autre">
            <div className="ent-choix-haut"><span className="ent-choix-ico"><Dessin id="cabinet" /></span></div>
            <h2>{titre('ecran.porte.depart_clients_titre')}</h2>
            <p className="ent-choix-texte">{phrase('ecran.porte.depart_clients_texte')}</p>
            <ul>
              <li><Dessin id="coche" />{titre('ecran.porte.depart_clients_puce1')}</li>
              <li><Dessin id="coche" />{titre('ecran.porte.depart_clients_puce2')}</li>
            </ul>
            <Bouton onClick={() => ouvrirCabinet(false)}>{titre('ecran.porte.depart_clients_bouton')}</Bouton>
          </article>
        </div>
      </PageEtapes>
    );
  }
  if (etape === 'cabinet') {
    return (
      <Carte icone="cabinet" etape={2} cabinet droite={sortir} titre={titre('ecran.porte.cabinet_titre')} sous={pourUnClient ? phrase('ecran.porte.cabinet_pour_client', { ou: pourUnClient }) : phrase('ecran.porte.cabinet_sous')} onSubmit={() => { void creerCabinet(); }}
        pied={<>
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.cabinet_creer')}</Bouton>
          <Bouton discret onClick={() => setEtape('porte')}>{titre('ecran.porte.retour')}</Bouton>
        </>}>
        <Champ obligatoire libelle={titre('ecran.porte.cabinet_nom')} aide={phrase('ecran.porte.cabinet_nom_aide')} valeur={nomCabinet} changer={setNomCabinet} premier {...g.sur('nom')} />
      </Carte>
    );
  }
  if (etape === 'entreprise') {
    return (
      <PageEtapes etape={2} droite={sortir}>
        <div className="ent-deux">
          <form noValidate onSubmit={(e) => { e.preventDefault(); void creer(); }}>
            <button type="button" className="ent-lien" onClick={() => setEtape('porte')}><Dessin id="retour" />{titre('ecran.porte.retour')}</button>
            <div className="ent-titre-page"><h1>{titre('ecran.porte.entreprise_titre')}</h1><p>{phrase('ecran.porte.entreprise_sous')}</p></div>
            <Champ obligatoire libelle={titre('ecran.porte.raison')} aide={phrase('ecran.porte.raison_aide')} valeur={raison} changer={setRaison} autoComplete="organization" premier
              dessous={<div className="ent-exemples"><span>{phrase('ecran.porte.raison_patente')}</span><span>{phrase('ecran.porte.raison_societe')}</span></div>} {...g.sur('raisonSociale')} />
            <Champ libelle={titre('ecran.porte.matricule')} aide={phrase('ecran.porte.matricule_aide')} valeur={matricule} changer={setMatricule} placeholder="1234567A/A/M/000"
              dessous={<AideMatricule matricule={matricule} />} {...g.sur('matriculeFiscal')} />
            <Champ libelle={titre('ecran.porte.ville')} aide={phrase('ecran.porte.ville_aide')} valeur={ville} changer={setVille} autoComplete="address-level2" {...g.sur('ville')} />
            <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.porte.creer')}<Dessin id="fleche" /></Bouton>
          </form>
          <ApercuEntete raison={raison} matricule={matricule} note={phrase('ecran.porte.apercu_note')} />
        </div>
      </PageEtapes>
    );
  }
  return (
    <PageEtapes etape={2} droite={sortir}>
      <div className="ent-titre-page centre"><h1>{titre('ecran.porte.titre')}</h1><p>{phrase(sansCabinet ? 'ecran.porte.deux_facons' : 'ecran.porte.trois_facons')}</p></div>
      <div className={sansCabinet ? 'ent-choix' : 'ent-choix trois'}>
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
        {/* (1.373.0) Le comptable a sa carte, du même poids que les deux autres : une pilule grise sous deux grandes
            cartes d'entreprise ne lui disait pas que l'outil est aussi pour lui (revue du 16/11/2026). */}
        {sansCabinet ? null : <article className="autre">
          <div className="ent-choix-haut"><span className="ent-choix-ico"><Dessin id="cabinet" /></span><span className="ent-choix-meta">{titre('ecran.porte.cabinet_meta')}</span></div>
          <h2>{titre('ecran.porte.cabinet_carte_titre')}</h2>
          <p className="ent-choix-texte">{phrase('ecran.porte.cabinet_carte_texte')}</p>
          <ul>
            <li><Dessin id="coche" />{titre('ecran.porte.cabinet_puce1')}</li>
            <li><Dessin id="coche" />{titre('ecran.porte.cabinet_puce2')}</li>
          </ul>
          <Bouton onClick={() => setEtape('cabinet')}>{titre('ecran.porte.cabinet_lien')}</Bouton>
        </article>}
      </div>
      {sansCabinet ? <p className="ent-autre-profil centre">{phrase('ecran.inscription.es_comptable')}{' '}
        <button type="button" className="ent-lien" id="porte-vers-cabinet" onClick={() => setEtape('cabinet')}>{titre('ecran.inscription.vers_cabinet')}</button></p> : null}
    </PageEtapes>
  );
}
