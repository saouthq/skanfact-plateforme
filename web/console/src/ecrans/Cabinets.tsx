// La liste des cabinets (serveur/console/routes.ts, GET /console/cabinets) : une ligne par cabinet, ses associés, ses
// dossiers comptés par place (clients abonnés, dossiers tenus, en attente : la MÊME règle que sa fiche, C3), son équipe
// et sa dernière connexion. La recherche porte sur son nom et sur ses associés ; la liste se pagine. Jamais le contenu
// d'un dossier. Elle vit à côté des entreprises, sous « Clients » : les deux onglets sont deux adresses.
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { useConsole, useLecture } from '../contexte.ts';
import { jourCourt, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Icone, Lien, maj, Vide } from '../ui.tsx';

export type Place = 'client' | 'tenu' | 'en_attente';
export const PLACES: readonly Place[] = ['client', 'tenu', 'en_attente'];
type LigneCabinet = {
  id: string; nom: string; creeLe: string; associes: { nom: string; email: string }[]; collaborateurs: number;
  comptes: Record<Place, number>; derniereActivite: string | null;
};
type Liste = { aujourdhui: string; total: number; tous: number; lignes: LigneCabinet[]; suite: number | null };
const PAGE = 50;

// Les deux sortes de clients de SkanFact, sous un MÊME en-tête : deux adresses, un onglet allumé. Une phrase propre à
// chaque onglet changeait la hauteur de l'en-tête, et les onglets descendaient sous le curseur au moment du clic.
export function EnteteClients({ actif }: { actif: 'entreprises' | 'cabinets' }) {
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.clients.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.clients.sous')}</p>
        </div>
      </header>
      <nav className="c-onglets" aria-label={titre('console.ecran.onglets')}>
        {(['entreprises', 'cabinets'] as const).map((o) => (
          <a key={o} href={o === 'entreprises' ? '#/clients' : '#/cabinets'} aria-current={actif === o ? 'page' : undefined}>
            {titre(`console.ecran.onglets.${o}`)}
          </a>
        ))}
      </nav>
    </>
  );
}

export function Cabinets({ q: qDemande }: { q: string }) {
  const { moi } = useConsole();
  const [q, setQ] = useState(qDemande);
  const [qLue, setQLue] = useState(qDemande);
  const [debut, setDebut] = useState(0);

  useEffect(() => { setQ(qDemande); setQLue(qDemande); setDebut(0); }, [qDemande]);
  // La frappe se lit après un temps de pause, et l'adresse suit (elle se recopie, elle se garde en favori).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== qLue) { setQLue(q.trim()); setDebut(0); } }, 300);
    return () => clearTimeout(t);
  }, [q, qLue]);
  useEffect(() => { history.replaceState(null, '', `#/cabinets${qLue ? `?q=${encodeURIComponent(qLue)}` : ''}`); }, [qLue]);

  const p = new URLSearchParams({ limite: String(PAGE), debut: String(debut) });
  if (qLue) p.set('q', qLue);
  const [l, relire] = useLecture<Liste>(`/console/cabinets?${p.toString()}`, 'cabinets');
  const lu = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const nombre = (n: number) => <span className={`c-mono${n === 0 ? ' c-zero-texte' : ''}`}>{n}</span>;

  return (
    <>
      <EnteteClients actif="cabinets" />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      <section className="c-carte c-liste-carte" aria-label={titre('console.ecran.cabinets.titre')}>
        <div className="c-liste-outils">
          <label className="c-recherche">
            <span className="c-cache">{titre('console.ecran.chercher_label')}</span>
            <Icone nom="chercher" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={titre('console.ecran.cabinets.chercher')} />
          </label>
        </div>
        {!lu ? (l.etat === 'lecture' ? <p className="c-vide">{titre('console.ecran.lecture')}</p> : null)
          : lu.total === 0 ? (
            lu.tous === 0 && !qLue ? <Vide icone="clients">{phrase('console.ecran.cabinets.vide')}</Vide>
              : <Vide icone="chercher"><span>{phrase('console.ecran.cabinets.rien_trouve')}</span> <Bouton ton="discret" petit onClick={() => setQ('')}>{titre('console.ecran.clients.effacer')}</Bouton></Vide>
          ) : (
            <>
              <div className="c-defile">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th scope="col">{titre('console.ecran.cabinets.colonne.cabinet')}</th>
                      <th scope="col" className="c-droite">{titre('console.ecran.cabinets.colonne.clients')}</th>
                      <th scope="col" className="c-droite">{titre('console.ecran.cabinets.colonne.tenus')}</th>
                      <th scope="col" className="c-droite">{titre('console.ecran.cabinets.colonne.attente')}</th>
                      <th scope="col">{titre('console.ecran.cabinets.colonne.equipe')}</th>
                      <th scope="col">{titre('console.ecran.cabinets.colonne.vu')}</th>
                      <th scope="col"><span className="c-cache">{titre('console.ecran.clients.ouvrir')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lu.lignes.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="c-cellule-nom">
                            <Avatar nom={c.nom} nuit />
                            <div>
                              <a href={`#/cabinets/${c.id}`}><b data-donnee>{c.nom}</b></a>
                              <span className="c-sous">
                                {c.associes.length ? <span data-donnee>{c.associes.map((a) => a.nom).join(', ')}</span> : maj(dire('console.ecran.cabinets.sans_associe'))}
                              </span>
                              <span className="c-sous">{maj(dire('console.ecran.cabinets.inscrit', { le: jourCourt(c.creeLe) }))}</span>
                            </div>
                          </div>
                        </td>
                        <td className="c-droite">{nombre(c.comptes.client)}</td>
                        <td className="c-droite">{nombre(c.comptes.tenu)}</td>
                        <td className="c-droite">{nombre(c.comptes.en_attente)}</td>
                        <td>{maj(selon(c.collaborateurs, 'console.ecran.cabinets.personne'))}</td>
                        <td>{maj(c.derniereActivite ? quand(c.derniereActivite, aujourdhui) : dire('console.ecran.temps.jamais'))}</td>
                        <td className="c-droite">
                          <Lien href={`#/cabinets/${c.id}`} petit etiquette={titre('console.ecran.cabinets.ouvrir_fiche', { nom: c.nom })}>{titre('console.ecran.clients.ouvrir')}</Lien>
                        </td>
                      </tr>
                    ))}
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
