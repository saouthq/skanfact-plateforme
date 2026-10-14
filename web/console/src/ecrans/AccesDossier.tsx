// L'accès au dossier d'un client (Support S2 ; docs/support.md ; serveur/support/acces.ts ; 0096) : le support ne voit
// rien du dossier d'un client tant que celui-ci ne l'a pas accordé. D'ici, on le DEMANDE, avec un motif que le client lit
// tel quel ; il l'accorde dans son application (quelques heures, en lecture), et l'encart le dit : le temps qui reste,
// « Ouvrir le dossier (lecture) », « J'ai fini ». Une demande qui attend se retire ; un refus, un retrait, une fin se
// disent, et l'on redemande. Le même encart dans la carte d'une demande (Support) et dans l'onglet de la fiche du client.
import { useState, type ReactNode } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { heureDe, jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Dialogue, Icone, maj, Puce, toast, Zone } from '../ui.tsx';

type EtatAcces = 'demande' | 'actif' | 'echu' | 'refuse' | 'retire' | 'fini';
export type Acces = {
  id: string; entreprise: string; etat: EtatAcces; demandeur: string | null; aMoi: boolean;
  demande: { id: string; numero: number; sujet: string } | null; motif: string; demandeLe: string; heures: number | null;
  accordeLe: string | null; fin: string | null; accordePar: string | null; refuseLe: string | null; refusePar: string | null;
  retireLe: string | null; retirePar: string | null; closLe: string | null; lectures: { page: string; le: string }[];
};
type Lu = { maintenant: string; acces: Acces[] };

// Mon accès à ce client : celui qui court, sinon ma demande, sinon le plus récent (la base n'en laisse qu'un en cours).
export function monAcces(acces: Acces[]): Acces | null {
  const siens = acces.filter((a) => a.aMoi);
  return siens.find((a) => a.etat === 'actif') ?? siens.find((a) => a.etat === 'demande') ?? siens[0] ?? null;
}
// Ce qui reste, en minutes entières, jamais négatif.
export const minutesRestantes = (fin: string, maintenant: number) => Math.max(0, Math.floor((Date.parse(fin) - maintenant) / 60_000));
function resteEnMots(min: number): string {
  if (min < 1) return dire('console.ecran.support.acces.reste_moins_minute');
  if (min < 60) return dire('console.ecran.support.acces.reste_min', { n: min });
  const h = Math.floor(min / 60), m = min % 60;
  return m ? dire('console.ecran.support.acces.reste_h_min', { h, m: String(m).padStart(2, '0') }) : dire('console.ecran.support.acces.reste_h', { h });
}
// L'adresse de la lecture : la même application que le client, sur l'adresse de la console (la session de cet onglet
// passe à celui qu'on ouvre ; jamais dans l'adresse).
export const adresseDeLecture = (a: Pick<Acces, 'id' | 'entreprise'>) => `/v10/?e=${encodeURIComponent(a.entreprise)}&support=${encodeURIComponent(a.id)}#/dashboard`;

export function Demander({ client, demande, fermer, fait }: { client: { id: string; nom: string }; demande: { id: string; numero: number } | null; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.support.acces.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/support/acces', { entreprise: client.id, demande: demande ? demande.id : null, motif: motif.trim() });
        if (!r) return;
        if (r.statut !== 201) { setRefus(refusDe(r)); return; }
        toast(phrase('console.ecran.support.acces.demande_faite', { client: client.nom }));
        fait();
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre('console.ecran.support.acces.demander_titre')} pour={client.nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre('console.ecran.support.acces.envoyer')}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`console.ecran.support.acces.${p}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.support.acces.motif')} aide={phrase('console.ecran.support.acces.motif_aide')} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier max={300} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// `bande` : sous l'en-tête d'une conversation (l'écran Support), sur une ligne ; `carte` : sous les demandes de la fiche.
// `invite` : la phrase d'avant toute demande, propre à l'endroit (la fiche nomme à qui on demande ; le Support rappelle
// qu'on ne voit que ce que le client a écrit).
export function AccesDossier({ client, demande = null, aujourdhui, forme = 'carte', invite }: { client: { id: string; nom: string }; demande?: { id: string; numero: number } | null; aujourdhui: string; forme?: 'bande' | 'carte'; invite?: string }) {
  const api = useApi();
  const [lu, relire] = useLecture<Lu>(`/console/support/acces?client=${encodeURIComponent(client.id)}`);
  const [fenetre, setFenetre] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const rendre = (a: Acces) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', `/console/support/acces/${a.id}/clore`);
        if (!r) return;
        if (r.statut !== 200) { toast(refusDe(r)); return; }
        toast(phrase(a.etat === 'actif' ? 'console.ecran.support.acces.rendu' : 'console.ecran.support.acces.retiree'));
        relire();
      } catch (x) { toast(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const classe = `c-sp-acces c-sp-acces-${forme}`;
  // Dans la bande, une seule rangée (vu le 14/10/2026 : à 1280×800, deux rangées poussaient « Envoyer » sous le bord) :
  // le titre se cache, et l'état dit lui-même qu'il s'agit du dossier.
  const bande = forme === 'bande';
  const tete = <h3 id={`acces-${client.id}-${forme}`} className={bande ? 'c-cache' : 'c-surtitre'}>{titre('console.ecran.support.acces.titre')}</h3>;
  if (lu.etat === 'lecture') return <section className={classe} aria-busy="true">{tete}</section>;
  if (lu.etat === 'panne') return <section className={classe}>{tete}<Alerte ton="danger">{lu.texte}</Alerte></section>;
  const a = monAcces(lu.donnees.acces);
  const maintenant = Date.parse(lu.donnees.maintenant) || Date.now();
  const actif = a && a.etat === 'actif' && a.fin ? a : null;
  const enAttente = a && a.etat === 'demande' ? a : null;
  const ferme = a && !actif && !enAttente ? a : null;
  let quoi: ReactNode;
  let gestes: ReactNode;
  if (actif && actif.fin && bande) {
    const reste = resteEnMots(minutesRestantes(actif.fin, maintenant));
    quoi = <>
      <span className="c-sp-acces-etat"><Puce ton="actif">{dire('console.ecran.support.acces.en_cours_dossier')}</Puce>
        <span>{maj(jourDe(actif.fin) === aujourdhui ? dire('console.ecran.support.acces.jusqua_court', { heure: heureDe(actif.fin) })
          : dire('console.ecran.support.acces.jusquau_court', { jour: jourCourt(jourDe(actif.fin)), heure: heureDe(actif.fin) }))}</span></span>
      <span className="c-sp-acces-sous">{maj(dire('console.ecran.support.acces.encore', { reste }))} · {selon(actif.lectures.length, 'console.ecran.support.acces.pages')}{actif.accordePar ? ` · ${dire('console.ecran.support.acces.accorde_par', { qui: actif.accordePar })}` : ''}</span>
    </>;
    gestes = <>
      {/* « Envoyer » reste le geste principal de l'écran. */}
      <Bouton icone="oeil" petit onClick={() => { window.open(adresseDeLecture(actif), '_blank'); }}>{titre('console.ecran.support.acces.ouvrir_court')}</Bouton>
      <Bouton petit occupe={occupe} onClick={() => rendre(actif)}>{titre('console.ecran.support.acces.fini')}</Bouton>
    </>;
  } else if (actif && actif.fin) {
    const reste = resteEnMots(minutesRestantes(actif.fin, maintenant));
    quoi = <>
      <span className="c-sp-acces-etat"><Puce ton="actif">{dire('console.ecran.support.acces.en_cours')}</Puce>
        <span>{maj(jourDe(actif.fin) === aujourdhui ? dire('console.ecran.support.acces.jusqua', { heure: heureDe(actif.fin), reste })
          : dire('console.ecran.support.acces.jusquau', { jour: jourCourt(jourDe(actif.fin)), heure: heureDe(actif.fin), reste }))}</span></span>
      <span className="c-sp-acces-sous">{maj(selon(actif.lectures.length, 'console.ecran.support.acces.pages'))}{actif.accordePar ? ` · ${dire('console.ecran.support.acces.accorde_par', { qui: actif.accordePar })}` : ''}</span>
    </>;
    gestes = <>
      {/* Dans la fiche, c'est le geste principal. */}
      <Bouton ton="principal" icone="oeil" onClick={() => { window.open(adresseDeLecture(actif), '_blank'); }}>{titre('console.ecran.support.acces.ouvrir')}</Bouton>
      <Bouton occupe={occupe} onClick={() => rendre(actif)}>{titre('console.ecran.support.acces.fini')}</Bouton>
    </>;
  } else if (enAttente) {
    quoi = <>
      <span className="c-sp-acces-etat"><Puce ton="a_regarder">{dire('console.ecran.support.acces.attend')}</Puce>
        <span>{maj(dire(bande ? 'console.ecran.support.acces.attend_dossier' : 'console.ecran.support.acces.demandee', { quand: quand(enAttente.demandeLe, aujourdhui) }))}</span></span>
      <span className="c-sp-acces-sous">{phrase(bande ? 'console.ecran.support.acces.attend_sous_court' : 'console.ecran.support.acces.attend_sous', { client: client.nom })}</span>
    </>;
    gestes = <Bouton petit occupe={occupe} onClick={() => rendre(enAttente)}>{titre('console.ecran.support.acces.retirer_demande')}</Bouton>;
  } else {
    // Après un premier accès, ce qui s'est passé dit déjà que le dossier est fermé : une ligne, pas deux.
    quoi = ferme ? <span className="c-sp-acces-sous c-sp-acces-dernier"><Icone nom="cache" taille={15} /><span>{dernierEnMots(ferme, aujourdhui)}</span></span>
      : <span className="c-sp-acces-sous"><Icone nom="cache" taille={15} /><span>{invite ?? phrase('console.ecran.support.contenu')}</span></span>;
    gestes = <Bouton petit onClick={() => setFenetre(true)}>{titre(ferme ? 'console.ecran.support.acces.redemander' : 'console.ecran.support.acces.demander')}</Bouton>;
  }
  return (
    <section className={classe} aria-labelledby={`acces-${client.id}-${forme}`}>
      {tete}
      <div className="c-sp-acces-quoi">{quoi}</div>
      <div className="c-sp-acces-gestes">{gestes}</div>
      {fenetre ? <Demander client={client} demande={demande} fermer={() => setFenetre(false)} fait={() => { setFenetre(false); relire(); }} /> : null}
    </section>
  );
}

// Le dernier accès, fermé : qui l'a fermé, et quand.
function dernierEnMots(a: Acces, aujourdhui: string): string {
  switch (a.etat) {
    case 'refuse': return phrase('console.ecran.support.acces.dernier_refuse', { quand: quand(a.refuseLe, aujourdhui), qui: a.refusePar ?? '' });
    case 'retire': return phrase('console.ecran.support.acces.dernier_retire', { quand: quand(a.retireLe, aujourdhui), qui: a.retirePar ?? '' });
    case 'echu': return phrase('console.ecran.support.acces.dernier_echu', { quand: quand(a.fin, aujourdhui) });
    default: return phrase('console.ecran.support.acces.dernier_fini', { quand: quand(a.closLe, aujourdhui) });
  }
}
