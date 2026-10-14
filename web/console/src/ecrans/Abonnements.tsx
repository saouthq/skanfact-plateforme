// Les abonnements (serveur/console/routes.ts, GET /console/abonnements ; serveur/console/echeances.ts) : ce qui vient,
// ce qui presse, ce qui est fermé. Six cartes, chacune compte la liste qu'elle ouvre (C3) ; par défaut, les échéances
// des trente prochains jours. Une ligne par entreprise, sur deux rangées (maquette Abonnements) : son jour, ce qui se
// passe, ce qu'un paiement coûterait (hors taxes, au prix du jour) ; dessous, les relances de son échéance telles que le
// serveur les juge, et sa fiche, où sont les gestes. À côté de la liste : ce qui revient chaque année, ce que dit chaque
// relance, et ce que le serveur fait seul. L'écran ne recalcule rien : états, montants et relances viennent du serveur.
import { useEffect, useState, type ReactNode } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { CATEGORIES, offreEtPeriode, type Categorie, type Etat, type Faits } from '../abonnement.ts';
import { montant } from '../argent.ts';
import { useConsole, useLecture, type Role } from '../contexte.ts';
import { dans, jourCourt, jourDe, jourMois, quand } from '../temps.ts';
import { Alerte, Bouton, Icone, Lien, maj, Vide, type NomIcone } from '../ui.tsx';

export type Vue = 'avenir' | Categorie;
export const VUES: readonly Vue[] = ['avenir', ...CATEGORIES];
type Evenement = { le: string; motif: string | null; jours: number | null; qui: { nom: string; role: Role } | null };
type Rang = 'j15' | 'j7' | 'j1' | 'lecture_seule';
type EtatRelance = 'partie' | 'prevue' | 'a_partir' | 'sautee' | 'manquee';
type Relance = { rang: Rang; prevueLe: string; partieLe: string | null; etat: EtatRelance };
type Ligne = {
  entreprise: { id: string; nom: string }; tenuePar: string | null; etat: Etat; faits: Faits; date: string | null;
  pieces: number; derniereActivite: string | null; montantHt: string | null; relances: Relance[];
  prolongation: Evenement | null; offert: Evenement | null; suspension: Evenement | null;
};
type Cartes = {
  avenir: { n: number; essais: number }; essai: { n: number; semaine: number };
  actif: { n: number; essentiel: number; complet: number; resilies: number };
  en_retard: { n: number; du: string | null; au: string | null }; lecture_seule: { n: number; semaine: number };
  hors: { n: number; offert: number; tenu_par_cabinet: number; inconnu: number };
};
type Annuel = { montantHt: string; abonnements: number; mensuels: number; resilies: number; sansPrix: number };
type Donnees = {
  aujourdhui: string; vue: Vue; cartes: Cartes; annuel: Annuel; total: number; lignes: Ligne[]; suite: number | null;
  regles: { relances: number[]; grace: number | null; avenir: number };
};
const PAGE = 50;
const K = 'console.ecran.abonnements';

// Des comptes nommés, sans ceux qui valent zéro (« Essentiel : 4 · Complet : 2 ») ; rien à compter : `vide`.
const comptes = (paires: [string, number][], vide: string) => {
  const gardes = paires.filter(([, n]) => n > 0).map(([cle, n]) => dire(cle, { n }));
  return gardes.length ? gardes.join(' · ') : dire(vide);
};

// ── Les cartes ──────────────────────────────────────────────────────────────────────────────────────────────────────
function sousCarte(v: Vue, c: Cartes, jours: number): string {
  switch (v) {
    case 'avenir': return selon(c.avenir.essais, `${K}.carte.avenir`, { jours });
    case 'essai': return selon(c.essai.semaine, `${K}.carte.essai`);
    case 'actif': return comptes([[`${K}.carte.actif.essentiel`, c.actif.essentiel], [`${K}.carte.actif.complet`, c.actif.complet], [`${K}.carte.actif.resilies`, c.actif.resilies]], `${K}.carte.aucun`);
    case 'en_retard':
      if (!c.en_retard.du || !c.en_retard.au) return dire(`${K}.carte.en_retard_0`);
      return c.en_retard.du === c.en_retard.au ? dire(`${K}.carte.en_retard_jour`, { le: jourMois(c.en_retard.du) })
        : dire(`${K}.carte.en_retard_du_au`, { du: jourMois(c.en_retard.du), au: jourMois(c.en_retard.au) });
    case 'lecture_seule': return selon(c.lecture_seule.semaine, `${K}.carte.lecture_seule`);
    default: return comptes([[`${K}.carte.hors.offert`, c.hors.offert], [`${K}.carte.hors.cabinet`, c.hors.tenu_par_cabinet], [`${K}.carte.hors.inconnu`, c.hors.inconnu]], `${K}.carte.aucune`);
  }
}

// ── Une ligne : son jour, ce qui se passe, le montant, les relances ─────────────────────────────────────────────────
function Jour({ l, aujourdhui }: { l: Ligne; aujourdhui: string }) {
  if (!l.date) return <div className="c-ech-jour"><b className="c-mono">—</b><span>{dire(`${K}.d.sans`)}</span></div>;
  return (
    <div className={`c-ech-jour c-ech-jour-${l.etat.etat}`}>
      <time className="c-mono" dateTime={l.date} title={jourCourt(l.date)}>{jourMois(l.date)}</time>
      <span>{dans(l.date, aujourdhui)}</span>
    </div>
  );
}

// Qui a fait un geste, et quand (le jour de Tunis de l'instant) ; son motif, une donnée, entre guillemets.
const par = (v: Evenement) => (v.qui ? dire(`${K}.q.par`, { qui: v.qui.nom, le: jourCourt(jourDe(v.le)) }) : dire(`${K}.q.par_outil`, { le: jourCourt(jourDe(v.le)) }));
const motifDe = (v: Evenement): ReactNode => (v.motif ? <span className="c-motif" data-donnee>{'«\u202f'}{v.motif}{'\u202f»'}</span> : null);

function ceQuiSePasse(l: Ligne, aujourdhui: string): ReactNode[] {
  const e = l.etat, f = l.faits;
  const offre = f.offre && f.periodicite ? offreEtPeriode(f.offre, f.periodicite) : null;
  const connexion = l.derniereActivite ? dire(`${K}.q.connexion`, { quand: dans(jourDe(l.derniereActivite), aujourdhui) }) : dire(`${K}.q.jamais`);
  const pieces = l.pieces === 0 ? dire(`${K}.q.aucune_piece`) : l.pieces === 1 ? dire(`${K}.q.une_piece`) : dire(`${K}.q.pieces`, { n: l.pieces });
  switch (e.etat) {
    case 'essai': {
      const p = l.prolongation;
      const prolonge = p && p.jours !== null ? dire(p.qui ? `${K}.q.prolonge` : `${K}.q.prolonge_outil`, { n: p.jours, qui: p.qui?.nom ?? '', le: jourCourt(jourDe(p.le)) }) : null;
      return [dire(`${K}.q.essai`), prolonge, p ? motifDe(p) : null, pieces, connexion];
    }
    case 'actif': return [offreEtPeriode(e.offre, e.periodicite), dire(e.resilie ? `${K}.q.resilie` : `${K}.q.renouvellement`)];
    case 'en_retard':
      return e.apresEssai || !offre ? [dire(`${K}.q.essai_fini`, { le: jourCourt(e.echeance) }), pieces, connexion]
        : [offre, dire(`${K}.q.echu`, { le: jourCourt(e.echeance) }), connexion];
    case 'lecture_seule':
      if (e.raison === 'suspendu') return [dire(`${K}.q.suspendu`), l.suspension ? motifDe(l.suspension) : null, l.suspension ? par(l.suspension) : null];
      if (e.raison === 'resilie') return [offre, dire(`${K}.q.ls_resilie`), connexion];
      return e.raison === 'essai_termine' || !offre ? [dire(`${K}.q.ls_essai`, { le: jourCourt(f.essaiJusquAu) }), pieces, connexion]
        : [offre, dire(`${K}.q.ls_non_renouvele`, { le: jourCourt(f.payeJusquAu) }), connexion];
    default:
      if (e.raison === 'offert') return [dire(`${K}.q.offert`), l.offert ? motifDe(l.offert) : null, l.offert ? par(l.offert) : null];
      if (e.raison === 'tenu_par_cabinet') return [l.tenuePar ? dire(`${K}.q.tenu`, { cabinet: l.tenuePar }) : dire('console.ecran.abo.hors.tenu_par_cabinet'), pieces];
      return [dire(`${K}.q.inconnu`)];
  }
}

// Sans montant, la raison : aucune offre choisie, une résiliation, une suspension, pas de prix du jour…
function sansMontant(e: Etat): string {
  switch (e.etat) {
    case 'essai': return `${K}.m.essai`;
    case 'actif': return e.resilie ? `${K}.m.resilie` : `${K}.m.sans_prix`;
    case 'en_retard': return e.apresEssai ? `${K}.m.essai` : `${K}.m.sans_prix`;
    case 'lecture_seule':
      return e.raison === 'suspendu' ? `${K}.m.suspendu` : e.raison === 'resilie' ? `${K}.m.resilie` : e.raison === 'essai_termine' ? `${K}.m.essai` : `${K}.m.sans_prix`;
    default: return e.raison === 'offert' ? `${K}.m.offert` : e.raison === 'tenu_par_cabinet' ? `${K}.m.cabinet` : `${K}.m.inconnu`;
  }
}

const rangCourt = (r: Rang) => (r === 'j1' || r === 'lecture_seule' ? dire(`${K}.rang.${r}`) : dire(`${K}.rang.jours`, { n: Number(r.slice(1)) }));
const rangLong = (r: Rang) => (r === 'j1' || r === 'lecture_seule' ? dire(`${K}.rang_long.${r}`) : dire(`${K}.rang_long.jours`, { n: Number(r.slice(1)) }));
const ICONE_RELANCE: Partial<Record<EtatRelance, NomIcone>> = { partie: 'ok', a_partir: 'sablier', manquee: 'alerte' };
function relanceEnMots(r: Relance, aujourdhui: string): string {
  const rang = rangLong(r.rang);
  if (r.etat === 'partie' && r.partieLe) return maj(dire(`${K}.relance.partie`, { rang, quand: quand(r.partieLe, aujourdhui) }));
  if (r.etat === 'prevue') return maj(dire(`${K}.relance.prevue`, { rang, le: jourCourt(r.prevueLe) }));
  return maj(dire(`${K}.relance.${r.etat}`, { rang }));
}

// Une relance : son rang en deux mots, son état par une couleur ET une icône (jamais la couleur seule), sa phrase au
// survol et pour les lecteurs d'écran.
function PuceRelance({ etat, children, mots }: { etat: EtatRelance; children: string; mots?: string }) {
  const icone = ICONE_RELANCE[etat];
  return (
    <span className={`c-relance c-relance-${etat}`} {...(mots ? { title: mots } : {})}>
      {icone ? <Icone nom={icone} taille={13} /> : null}
      <span aria-hidden={mots ? true : undefined}>{children}</span>
      {mots ? <span className="c-cache">{mots}</span> : null}
    </span>
  );
}

function LigneEcheance({ l, aujourdhui }: { l: Ligne; aujourdhui: string }) {
  const morceaux = ceQuiSePasse(l, aujourdhui).filter((x) => x !== null && x !== '');
  return (
    <li className="c-ech">
      <Jour l={l} aujourdhui={aujourdhui} />
      <div className="c-ech-quoi">
        <a href={`#/clients/${l.entreprise.id}`}><b data-donnee>{l.entreprise.nom}</b></a>
        <span className="c-ech-texte">{morceaux.map((m, i) => <span key={i}>{i ? ' · ' : null}{typeof m === 'string' && i === 0 ? maj(m) : m}</span>)}</span>
      </div>
      <div className="c-ech-montant">
        {l.montantHt ? <b className="c-mono" data-donnee>{montant(l.montantHt)}</b> : <b className="c-mono c-ech-rien">—</b>}
        <span>{dire(l.montantHt ? `${K}.m.ht` : sansMontant(l.etat))}</span>
      </div>
      <div className="c-ech-bas">
        <div className="c-ech-relances">
          {l.relances.length ? (
            <ul aria-label={titre(`${K}.relances`)}>
              {l.relances.map((r) => <li key={r.rang}><PuceRelance etat={r.etat} mots={relanceEnMots(r, aujourdhui)}>{rangCourt(r.rang)}</PuceRelance></li>)}
            </ul>
          ) : <span className="c-ech-aucune">{dire(`${K}.relance.aucune`)}</span>}
        </div>
        <div className="c-ech-action">
          <Lien href={`#/clients/${l.entreprise.id}`} petit etiquette={titre('console.ecran.clients.ouvrir_fiche', { nom: l.entreprise.nom })}>{titre('console.ecran.clients.ouvrir')}</Lien>
        </div>
      </div>
    </li>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Abonnements({ vue: vueDemandee }: { vue: string | null }) {
  const { moi } = useConsole();
  const lue = (v: string | null): Vue => (VUES.includes(v as Vue) ? v as Vue : 'avenir');
  const [vue, setVue] = useState<Vue>(lue(vueDemandee));
  const [debut, setDebut] = useState(0);
  // Une vue demandée d'ailleurs (une adresse recopiée, « Précédent ») remplace celle-ci ; l'adresse suit le choix.
  useEffect(() => { setVue(lue(vueDemandee)); setDebut(0); }, [vueDemandee]);
  useEffect(() => { history.replaceState(null, '', `#/abonnements${vue === 'avenir' ? '' : `?vue=${vue}`}`); }, [vue]);
  const [l, relire] = useLecture<Donnees>(`/console/abonnements?vue=${vue}&limite=${PAGE}&debut=${debut}`, 'abonnements');
  const lu = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const choisir = (v: Vue) => { setVue(v); setDebut(0); };
  // La liste montrée est celle que le serveur a rendue (sa vue), jamais celle qu'on vient de demander : pendant la
  // lecture, le titre et les lignes restent ensemble.
  const montree = lu?.vue ?? vue;
  const jours = lu?.regles.avenir ?? 30;
  const portefeuille = lu ? CATEGORIES.reduce((s, c) => s + lu.cartes[c].n, 0) : 0;
  const a = lu?.annuel;
  const annuelSous = a ? [selon(a.abonnements, `${K}.annuel`), a.mensuels ? dire(`${K}.annuel_mensuels`) : '', a.sansPrix ? selon(a.sansPrix, `${K}.annuel_sans_prix`) : ''].filter(Boolean).join(' · ') : '';
  const liste = (r: number[]) => (r.length > 1 ? `${r.slice(0, -1).join(', ')} ${dire('console.ecran.et')} ${r.at(-1)}` : String(r[0] ?? ''));

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {lu ? (
        <>
          <div className="c-vues" role="group" aria-label={titre(`${K}.vues`)}>
            {VUES.map((v) => (
              <button key={v} type="button" className="c-vue" aria-pressed={vue === v} onClick={() => choisir(v)}>
                <span className="c-vue-titre"><span className={`c-pilule-point c-point-${v}`} aria-hidden="true" />{titre(v === 'avenir' ? `${K}.carte.avenir` : `console.ecran.etat.${v}`)}</span>
                <span className="c-vue-n">{lu.cartes[v].n}</span>
                <span className="c-vue-sous">{maj(sousCarte(v, lu.cartes, jours))}</span>
              </button>
            ))}
          </div>
          <div className="c-ab-corps">
          <section className="c-carte c-liste-carte" aria-labelledby="ab-liste">
            <div className="c-carte-tete c-liste-tete">
              <div>
                <h2 id="ab-liste">{titre(`${K}.liste.${montree}`, { jours })} <span className="c-compte-titre">{lu.total}</span></h2>
                <p className="c-carte-sous">{phrase(`${K}.liste.${montree}_sous`)}</p>
              </div>
            </div>
            {lu.total === 0 ? (
              <Vide icone="calendrier">{phrase(portefeuille === 0 ? `${K}.vide_tout` : montree === 'avenir' ? `${K}.vide.avenir` : `${K}.vide.liste`, { jours })}</Vide>
            ) : (
              <>
                <ol className="c-echeances">{lu.lignes.map((x) => <LigneEcheance key={x.entreprise.id} l={x} aujourdhui={aujourdhui} />)}</ol>
                {/* Le compte est dans le titre : le pied ne se montre que pour tourner les pages, et dit lesquelles. */}
                {lu.total > PAGE ? (
                  <div className="c-liste-pied">
                    <span>{phrase('console.ecran.clients.page', { debut: debut + 1, fin: debut + lu.lignes.length, total: lu.total })}</span>
                    <span className="c-liste-pied-boutons">
                      <Bouton petit desactive={debut === 0} onClick={() => setDebut(Math.max(0, debut - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                      <Bouton petit desactive={lu.suite === null} onClick={() => { if (lu.suite !== null) setDebut(lu.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </section>
          {/* À côté de la liste : ce qui revient chaque année ; ce que dit chaque puce de relance ; ce que le serveur fait seul. */}
          <aside className="c-ab-cote" aria-label={titre(`${K}.cote`)}>
            {a ? (
              <section className="c-carte c-ab-annuel" aria-labelledby="ab-annuel">
                <h2 id="ab-annuel">{titre(`${K}.annuel_titre`)}</h2>
                <p className="c-ab-annuel-valeur"><b className="c-mono" data-donnee>{montant(a.montantHt)}</b> <small>{dire(`${K}.annuel_ht`)}</small></p>
                <p className="c-carte-sous">{maj(annuelSous)}.</p>
              </section>
            ) : null}
            <section className="c-carte c-ab-legende" aria-labelledby="ab-legende">
              <h2 id="ab-legende">{titre(`${K}.legende`)}</h2>
              <ul>
                {(['partie', 'a_partir', 'prevue', 'sautee', 'manquee'] as const).map((e) => (
                  <li key={e}><PuceRelance etat={e}>{dire(`${K}.legende.${e}`)}</PuceRelance><span>{dire(`${K}.legende.${e}_sous`)}</span></li>
                ))}
              </ul>
            </section>
            <p className="c-note"><Icone nom="info" />{phrase(`${K}.regles`, {
              relances: lu.regles.relances.length ? dire(`${K}.regles_relances`, { liste: liste(lu.regles.relances) }) : dire(`${K}.regles_sans_relance`),
              apres: lu.regles.grace === null ? dire(`${K}.regles_apres_inconnu`) : selon(lu.regles.grace, `${K}.regles_apres`) })}</p>
          </aside>
          </div>
        </>
      ) : null}
    </>
  );
}
