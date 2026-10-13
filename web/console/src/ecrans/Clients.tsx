// La liste des clients (serveur/console/routes.ts, GET /console/entreprises) : une ligne par entreprise, le plus urgent en
// haut. Au-dessus, les vues du métier (serveur/console/clients.ts : à appeler, l'argent attendu, les silencieux, les
// dossiers tenus à convertir) ; dessous, les puces d'état. Chaque carte et chaque puce porte son compte, calculé par la
// MÊME fonction que le filtre qu'elle ouvre (C3) ; la recherche porte sur le nom, le matricule, l'organisation, le
// propriétaire et le cabinet, sans accents ni casse. Chaque ligne dit son échéance et ce qu'elle rapporte par an ; la
// liste se trie et se pagine. Jamais le contenu d'un dossier : des comptes, un état, une date, un montant.
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { abonnementEnMots, CATEGORIES, expliquer, puceDe, type Categorie, type Etat, type Faits } from '../abonnement.ts';
import { useConsole, useLecture } from '../contexte.ts';
import { montant } from '../argent.ts';
import { dans, jourCourt, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Icone, Lien, maj, Puce, Vide } from '../ui.tsx';
import { EnteteClients } from './Cabinets.tsx';

export type Entreprise = {
  id: string; raisonSociale: string; matricule: string | null; active: boolean; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null;
  proprietaire: { nom: string; email: string } | null; membres: number; derniereActivite: string | null; pieces: number;
  faits: Faits; etat: Etat;
};
// Ce que la liste ajoute à chaque ligne : son échéance (le prochain jour où quelque chose change) et ce qu'elle rapporte
// par an, hors taxes — `attendu` quand c'est une offre choisie qui n'est pas encore payée.
type Ligne = Entreprise & { echeance: string | null; parAn: { montantHt: string; attendu: boolean } | null };
export const VUES = ['tout', 'a_appeler', 'argent', 'silencieux', 'tenus'] as const;
export type VueClients = typeof VUES[number];
export const TRIS = ['urgence', 'echeance', 'par_an', 'nom', 'vu'] as const;
type Tri = typeof TRIS[number];
type Liste = {
  aujourdhui: string; total: number; tous: number; vue: VueClients; tri: Tri; vues: Record<VueClients, number>; comptes: Record<Categorie, number>;
  parAn: { montantHt: string; abonnements: number }; lignes: Ligne[]; suite: number | null;
};
const PAGE = 50;

// L'organisation en quelques mots : « entreprise seule », « groupe Gharbi », « cabinet Ben Youssef ».
export const organisationEnMots = (o: Entreprise['organisation']) =>
  o.type === 'groupe' || o.type === 'cabinet' ? dire(`console.ecran.org.${o.type}`, { nom: o.nom }) : dire('console.ecran.org.independant');
const nombre = (n: number, un: string, plusieurs: string, aucun?: string) => (n === 0 && aucun ? dire(aucun) : n === 1 ? dire(un) : dire(plusieurs, { n }));

// Quand arrive l'échéance — et ce qu'elle change quand la puce d'état ne le dit pas : une grâce finit en lecture seule,
// une résiliation sans renouvellement. La fin d'un essai, le renouvellement d'un abonné vont sans dire.
function ceQuiChange(e: Entreprise, jour: string, aujourdhui: string): string {
  const s = e.etat;
  const quand = dans(jour, aujourdhui);
  if (s.etat === 'en_retard') return dire('console.ecran.clients.change.en_retard', { dans: quand });
  if (s.etat === 'actif' && s.resilie) return dire('console.ecran.clients.change.resilie', { dans: quand });
  return quand;
}
const vueDe = (v: string | null): VueClients => (VUES.includes(v as VueClients) ? v as VueClients : 'tout');
const triDe = (t: string | null): Tri => (TRIS.includes(t as Tri) ? t as Tri : 'urgence');

export function Clients({ etat: etatDemande, q: qDemande, nouvelles: nouvellesDemande, vue: vueDemandee, tri: triDemande }:
  { etat: string | null; q: string; nouvelles: boolean; vue: string | null; tri: string | null }) {
  const { moi } = useConsole();
  const [q, setQ] = useState(qDemande);
  const [qLue, setQLue] = useState(qDemande);
  const [vue, setVue] = useState<VueClients>(vueDe(vueDemandee));
  const [tri, setTri] = useState<Tri>(triDe(triDemande));
  const [etat, setEtat] = useState<Categorie | null>(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
  const [debut, setDebut] = useState(0);
  // Les seules inscrites de la semaine : la liste que compte la tuile « Inscriptions » du tableau du matin.
  const [nouvelles, setNouvelles] = useState(nouvellesDemande);

  // Une recherche lancée d'ailleurs (la barre du haut, un chiffre du tableau du matin) remplace celle-ci.
  useEffect(() => {
    setQ(qDemande); setQLue(qDemande); setDebut(0); setNouvelles(nouvellesDemande);
    setEtat(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
    setVue(vueDe(vueDemandee)); setTri(triDe(triDemande));
  }, [qDemande, etatDemande, nouvellesDemande, vueDemandee, triDemande]);
  // La frappe se lit après un temps de pause, et l'adresse suit (elle se recopie, elle se garde en favori).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== qLue) { setQLue(q.trim()); setDebut(0); } }, 300);
    return () => clearTimeout(t);
  }, [q, qLue]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (nouvelles) p.set('nouvelles', '1');
    if (vue !== 'tout') p.set('vue', vue);
    if (etat) p.set('etat', etat);
    if (qLue) p.set('q', qLue);
    if (tri !== 'urgence') p.set('tri', tri);
    const s = p.toString();
    history.replaceState(null, '', `#/clients${s ? `?${s}` : ''}`);
  }, [etat, qLue, nouvelles, vue, tri]);

  const p = new URLSearchParams({ limite: String(PAGE), debut: String(debut) });
  if (nouvelles) p.set('nouvelles', '1');
  if (vue !== 'tout') p.set('vue', vue);
  if (etat) p.set('etat', etat);
  if (qLue) p.set('q', qLue);
  if (tri !== 'urgence') p.set('tri', tri);
  const [l, relire] = useLecture<Liste>(`/console/entreprises?${p.toString()}`, 'clients');
  const lu = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const choisir = (c: Categorie | null) => { setEtat(c); setDebut(0); };
  // Une vue du métier est un raccourci : elle ouvre toute sa liste, quelle que soit la puce d'état choisie avant.
  const choisirVue = (v: VueClients) => { setVue(v); setEtat(null); setDebut(0); };

  return (
    <>
      <EnteteClients actif="entreprises" />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      <div className="c-vues c-vues-5" role="group" aria-label={titre('console.ecran.clients.vues')}>
        {VUES.map((v) => (
          <button key={v} type="button" className="c-vue" aria-pressed={vue === v} onClick={() => choisirVue(v)}>
            <span className="c-vue-titre"><span className={`c-pilule-point c-point-v-${v}`} aria-hidden="true" />{titre(`console.ecran.clients.vue.${v}`)}</span>
            <span className="c-vue-n">{lu ? lu.vues[v] : '·'}</span>
            <span className="c-vue-sous">{maj(dire(`console.ecran.clients.vue.${v}_sous`))}</span>
          </button>
        ))}
      </div>
      <section className="c-carte c-liste-carte" aria-label={titre('console.ecran.clients.titre')}>
        <div className="c-liste-outils">
          {nouvelles ? (
            <span className="c-filtre-actif">
              {titre('console.ecran.clients.nouvelles')}
              <button type="button" aria-label={titre('console.ecran.clients.retirer_filtre')} title={titre('console.ecran.clients.retirer_filtre')}
                onClick={() => { setNouvelles(false); setDebut(0); }}><Icone nom="croix" taille={15} /></button>
            </span>
          ) : null}
          <div className="c-pilules" role="group" aria-label={titre('console.ecran.clients.etats')}>
            <button type="button" className="c-pilule" aria-pressed={etat === null} onClick={() => choisir(null)}>
              {titre('console.ecran.clients.tous')} <span className="c-pilule-n">{lu ? lu.tous : '·'}</span>
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="c-pilule" aria-pressed={etat === c} onClick={() => choisir(c)}>
                <span className={`c-pilule-point c-point-${c}`} aria-hidden="true" />
                {titre(`console.ecran.etat.${c}`)} <span className="c-pilule-n">{lu ? lu.comptes[c] : '·'}</span>
              </button>
            ))}
          </div>
          <label className="c-recherche">
            <span className="c-cache">{titre('console.ecran.chercher_label')}</span>
            <Icone nom="chercher" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={titre('console.ecran.clients.chercher')} />
          </label>
        </div>
        {!lu ? (l.etat === 'lecture' ? <p className="c-vide">{titre('console.ecran.lecture')}</p> : null)
          : lu.total === 0 ? (
            // Rien du tout, rien qui réponde à la recherche ou aux inscrites de la semaine ; sinon c'est la vue ou la puce
            // choisie qui est vide, et elle le dit avec le geste qui rend tout le portefeuille.
            lu.vues.tout === 0 ? (
              !qLue && !nouvelles ? <Vide icone="clients">{phrase('console.ecran.clients.vide')}</Vide>
                : qLue ? <Vide icone="chercher"><span>{phrase('console.ecran.clients.rien_trouve')}</span> <Bouton ton="discret" petit onClick={() => setQ('')}>{titre('console.ecran.clients.effacer')}</Bouton></Vide>
                  : <Vide icone="clients">{phrase('console.ecran.clients.aucune_nouvelle')}</Vide>
            ) : vue !== 'tout' && !etat ? (
              <Vide icone="clients"><span>{phrase(`console.ecran.clients.vue_vide.${vue}`)}</span> <Bouton ton="discret" petit onClick={() => choisirVue('tout')}>{titre('console.ecran.clients.voir_tout')}</Bouton></Vide>
            ) : <Vide icone="clients">{phrase('console.ecran.clients.aucune_dans_etat')}</Vide>
          ) : (
            <>
              <div className="c-liste-resume">
                <p>
                  <b>{lu.total > lu.lignes.length
                    ? dire('console.ecran.clients.resume', { debut: debut + 1, fin: debut + lu.lignes.length, total: lu.total })
                    : maj(selon(lu.total, 'console.ecran.clients.resume_tout'))}</b>
                  {' · '}
                  {lu.parAn.abonnements === 0 ? dire('console.ecran.clients.par_an_0')
                    : <>{selon(lu.parAn.abonnements, 'console.ecran.clients.par_an')} <b className="c-mono" data-donnee>{montant(lu.parAn.montantHt)}</b> {dire('console.ecran.clients.par_an_fin')}</>}
                </p>
                <label className="c-tri">
                  <span>{titre('console.ecran.clients.trier')}</span>
                  <select className="c-select" value={tri} onChange={(e) => { setTri(triDe(e.target.value)); setDebut(0); }}>
                    {TRIS.map((t) => <option key={t} value={t}>{titre(`console.ecran.clients.tri.${t}`)}</option>)}
                  </select>
                </label>
              </div>
              <div className="c-defile">
                <table className="c-table c-table-clients">
                  <thead>
                    <tr>
                      <th scope="col">{titre('console.ecran.clients.colonne.entreprise')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.abonnement')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.etat')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.echeance')}</th>
                      <th scope="col" className="c-droite">{titre('console.ecran.clients.colonne.par_an')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.usage')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.vu')}</th>
                      <th scope="col"><span className="c-cache">{titre('console.ecran.clients.ouvrir')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lu.lignes.map((e) => {
                      const puce = puceDe(e.etat);
                      return (
                        <tr key={e.id}>
                          <td>
                            <div className="c-cellule-nom">
                              <Avatar nom={e.raisonSociale} nuit={e.organisation.type === 'groupe'} />
                              <div>
                                <a href={`#/clients/${e.id}`}><b data-donnee>{e.raisonSociale}</b></a>
                                <span className="c-sous">
                                  {maj(organisationEnMots(e.organisation))}{e.matricule ? <> · <span className="c-mono" data-donnee>{e.matricule}</span></> : null}
                                </span>
                                {e.tenuePar ? <span className="c-sous">{titre('console.ecran.clients.tenue_par', { nom: e.tenuePar })}</span> : null}
                              </div>
                            </div>
                          </td>
                          <td><b>{maj(abonnementEnMots(e.etat, e.faits))}</b>{e.proprietaire ? <span className="c-sous" data-donnee>{e.proprietaire.nom}</span> : null}</td>
                          <td>
                            <Puce ton={puce.ton}>{puce.texte}</Puce>
                            {/* Le jour d'une échéance se lit dans sa colonne, la raison d'un « hors abonnement » dans la colonne
                                Abonnement : ici, seulement depuis quand une lecture seule dure. */}
                            {e.etat.etat === 'lecture_seule' ? <span className="c-sous c-sous-espace">{maj(expliquer(e.etat, aujourdhui))}</span> : null}
                          </td>
                          <td className="c-cl-echeance">
                            {e.echeance ? <><b className="c-mono">{jourCourt(e.echeance)}</b><span className={`c-sous ${e.etat.etat === 'en_retard' ? 'c-cl-proche' : ''}`}>{ceQuiChange(e, e.echeance, aujourdhui)}</span></>
                              : <span className="c-cl-rien">—</span>}
                          </td>
                          <td className="c-droite c-cl-par-an">
                            {e.parAn ? <><b className={`c-mono ${e.parAn.attendu ? 'c-cl-attendu' : ''}`} data-donnee>{montant(e.parAn.montantHt)}</b>
                              {e.parAn.attendu ? <span className="c-sous">{dire('console.ecran.clients.quand_paye')}</span> : null}</>
                              : <span className="c-cl-rien">—</span>}
                          </td>
                          <td className="c-cl-usage">
                            <span>{maj(nombre(e.pieces, 'console.ecran.clients.piece', 'console.ecran.clients.pieces', 'console.ecran.clients.aucune_piece'))}</span>
                            <span className="c-sous">{maj(nombre(e.membres, 'console.ecran.clients.membre', 'console.ecran.clients.membres'))}</span>
                          </td>
                          <td className="c-cl-vu">
                            {maj(e.derniereActivite ? quand(e.derniereActivite, aujourdhui) : dire('console.ecran.temps.jamais'))}
                          </td>
                          <td className="c-droite c-cl-ouvrir">
                            <Lien href={`#/clients/${e.id}`} petit fleche etiquette={titre('console.ecran.clients.ouvrir_fiche', { nom: e.raisonSociale })}><span className="c-cl-ouvrir-mot">{titre('console.ecran.clients.ouvrir')}</span></Lien>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Le compte des lignes se lit au-dessus du tableau : en bas, seulement de quoi tourner les pages. */}
              {lu.total > PAGE ? (
                <div className="c-liste-pied c-liste-pied-fin">
                  <span className="c-liste-pied-boutons">
                    <Bouton petit desactive={debut === 0} onClick={() => setDebut(Math.max(0, debut - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                    <Bouton petit desactive={lu.suite === null} onClick={() => { if (lu.suite !== null) setDebut(lu.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                  </span>
                </div>
              ) : null}
            </>
          )}
      </section>
    </>
  );
}
