// La liste des clients (serveur/console/routes.ts, GET /console/entreprises) : une ligne par entreprise, le plus urgent en
// haut. Les puces d'état portent chacune leur compte, calculé par la MÊME fonction que le filtre qu'elles ouvrent (C3) ;
// la recherche porte sur le nom, le matricule, l'organisation, le propriétaire et le cabinet, sans accents ni casse. La
// liste se pagine. Jamais le contenu d'un dossier : des comptes, un état, une date.
import { useEffect, useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { abonnementEnMots, CATEGORIES, expliquer, puceDe, type Categorie, type Etat, type Faits } from '../abonnement.ts';
import { useConsole, useLecture } from '../contexte.ts';
import { quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Icone, Lien, maj, Puce, Vide } from '../ui.tsx';

export type Entreprise = {
  id: string; raisonSociale: string; matricule: string | null; active: boolean; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null;
  proprietaire: { nom: string; email: string } | null; membres: number; derniereActivite: string | null; pieces: number;
  faits: Faits; etat: Etat;
};
type Liste = { aujourdhui: string; total: number; tous: number; comptes: Record<Categorie, number>; lignes: Entreprise[]; suite: number | null };
const PAGE = 50;

// L'organisation en quelques mots : « entreprise seule », « groupe Gharbi », « cabinet Ben Youssef ».
export const organisationEnMots = (o: Entreprise['organisation']) =>
  o.type === 'groupe' || o.type === 'cabinet' ? dire(`console.ecran.org.${o.type}`, { nom: o.nom }) : dire('console.ecran.org.independant');
const nombre = (n: number, un: string, plusieurs: string, aucun?: string) => (n === 0 && aucun ? dire(aucun) : n === 1 ? dire(un) : dire(plusieurs, { n }));

export function Clients({ etat: etatDemande, q: qDemande, nouvelles: nouvellesDemande }: { etat: string | null; q: string; nouvelles: boolean }) {
  const { moi } = useConsole();
  const [q, setQ] = useState(qDemande);
  const [qLue, setQLue] = useState(qDemande);
  const [etat, setEtat] = useState<Categorie | null>(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
  const [debut, setDebut] = useState(0);
  // Les seules inscrites de la semaine : la liste que compte la tuile « Inscriptions » du tableau du matin.
  const [nouvelles, setNouvelles] = useState(nouvellesDemande);

  // Une recherche lancée d'ailleurs (la barre du haut, un chiffre du tableau du matin) remplace celle-ci.
  useEffect(() => {
    setQ(qDemande); setQLue(qDemande); setDebut(0); setNouvelles(nouvellesDemande);
    setEtat(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
  }, [qDemande, etatDemande, nouvellesDemande]);
  // La frappe se lit après un temps de pause, et l'adresse suit (elle se recopie, elle se garde en favori).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== qLue) { setQLue(q.trim()); setDebut(0); } }, 300);
    return () => clearTimeout(t);
  }, [q, qLue]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (nouvelles) p.set('nouvelles', '1');
    if (etat) p.set('etat', etat);
    if (qLue) p.set('q', qLue);
    const s = p.toString();
    history.replaceState(null, '', `#/clients${s ? `?${s}` : ''}`);
  }, [etat, qLue, nouvelles]);

  const p = new URLSearchParams({ limite: String(PAGE), debut: String(debut) });
  if (nouvelles) p.set('nouvelles', '1');
  if (etat) p.set('etat', etat);
  if (qLue) p.set('q', qLue);
  const [l, relire] = useLecture<Liste>(`/console/entreprises?${p.toString()}`, 'clients');
  const lu = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const choisir = (c: Categorie | null) => { setEtat(c); setDebut(0); };

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.clients.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.clients.sous')}</p>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
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
            lu.tous === 0 && !qLue ? <Vide icone="clients">{phrase('console.ecran.clients.vide')}</Vide>
              : qLue ? <Vide icone="chercher"><span>{phrase('console.ecran.clients.rien_trouve')}</span> <Bouton ton="discret" petit onClick={() => setQ('')}>{titre('console.ecran.clients.effacer')}</Bouton></Vide>
                : <Vide icone="clients">{phrase(nouvelles && !etat ? 'console.ecran.clients.aucune_nouvelle' : 'console.ecran.clients.aucune_dans_etat')}</Vide>
          ) : (
            <>
              <div className="c-defile">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th scope="col">{titre('console.ecran.clients.colonne.entreprise')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.abonnement')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.etat')}</th>
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
                            <span className="c-sous c-sous-espace">{maj(expliquer(e.etat, aujourdhui))}</span>
                          </td>
                          <td>
                            <span>{maj(nombre(e.pieces, 'console.ecran.clients.piece', 'console.ecran.clients.pieces', 'console.ecran.clients.aucune_piece'))}</span>
                            <span className="c-sous">{maj(nombre(e.membres, 'console.ecran.clients.membre', 'console.ecran.clients.membres'))}</span>
                          </td>
                          <td>
                            {maj(e.derniereActivite ? quand(e.derniereActivite, aujourdhui) : dire('console.ecran.temps.jamais'))}
                          </td>
                          <td className="c-droite">
                            <Lien href={`#/clients/${e.id}`} petit etiquette={titre('console.ecran.clients.ouvrir_fiche', { nom: e.raisonSociale })}>{titre('console.ecran.clients.ouvrir')}</Lien>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="c-liste-pied">
                <span>{phrase('console.ecran.clients.page', { debut: debut + 1, fin: debut + lu.lignes.length, total: lu.total })}</span>
                {lu.total > PAGE ? (
                  <span className="c-liste-pied-boutons">
                    <Bouton petit desactive={debut === 0} onClick={() => setDebut(Math.max(0, debut - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                    <Bouton petit desactive={lu.suite === null} onClick={() => { if (lu.suite !== null) setDebut(lu.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                  </span>
                ) : null}
              </div>
            </>
          )}
      </section>
    </>
  );
}
