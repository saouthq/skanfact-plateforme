// La fiche d'un cabinet (serveur/console/routes.ts, GET /console/cabinets/:id ; 0084) : qui il est et ce qu'il paie,
// ses dossiers par place — trois cartes qui comptent chacune la liste qu'elles ouvrent (C3), la même règle que la liste
// des cabinets — et qui y travaille. Un dossier s'y dit comme dans la liste des clients (son nom, son abonnement, son
// état), jamais son contenu : la console voit l'équipe d'un cabinet et la liste de ses dossiers, pas leurs livres.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { abonnementEnMots, expliquer, puceDe, type Etat, type Faits } from '../abonnement.ts';
import { useLecture } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Icone, Lien, maj, Puce, Vide } from '../ui.tsx';
import { PLACES, type Place } from './Cabinets.tsx';

type Mandat = { statut: 'propose' | 'actif'; debut: string } | null;
type Dossier = {
  place: Place; mandat: Mandat;
  entreprise: { id: string; raisonSociale: string; matricule: string | null; creeLe: string; faits: Faits; etat: Etat; pieces: number; derniereActivite: string | null };
};
type Collaborateur = { nom: string; email: string; roles: string[]; depuis: string; derniereConnexion: string | null };
type Donnees = { aujourdhui: string; id: string; nom: string; creeLe: string; collaborateurs: Collaborateur[]; dossiers: Dossier[]; comptes: Record<Place, number> };

const K = 'console.ecran.cabinet';
// Le premier jour d'un dossier pour le cabinet : celui de son mandat (un dossier tenu porte celui que sa création a
// posé), sinon celui de sa création.
const premierJour = (d: Dossier) => d.mandat?.debut ?? d.entreprise.creeLe;

function Fil({ nom }: { nom?: string }) {
  return (
    <nav className="c-fil" aria-label={titre(`${K}.retour`)}>
      <a href="#/clients">{titre('console.ecran.fiche.retour')}</a><Icone nom="droite" taille={14} />
      <a href="#/cabinets">{titre(`${K}.retour`)}</a>
      {nom ? <><Icone nom="droite" taille={14} /><span data-donnee>{nom}</span></> : null}
    </nav>
  );
}

export function Cabinet({ id }: { id: string }) {
  const [l, relire] = useLecture<Donnees>(`/console/cabinets/${encodeURIComponent(id)}`, id);
  // Une carte allumée filtre la liste ; la rallumer, ou retirer le filtre, rend tous les dossiers.
  const [place, setPlace] = useState<Place | null>(null);
  if (l.etat === 'lecture') return <><Fil /><p className="c-attente">{titre('console.ecran.lecture')}</p></>;
  if (l.etat === 'panne') {
    return (
      <>
        <Fil />
        {l.statut === 404 ? (
          <section className="c-carte c-liste-carte">
            <Vide icone="chercher"><span>{phrase(`${K}.introuvable`)}</span> <Lien href="#/cabinets" petit>{titre(`${K}.vers_liste`)}</Lien></Vide>
          </section>
        ) : <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>}
      </>
    );
  }
  const c = l.donnees;
  const montres = place ? c.dossiers.filter((d) => d.place === place) : c.dossiers;
  const associes = c.collaborateurs.filter((x) => x.roles.includes('supervision'));

  return (
    <>
      <Fil nom={c.nom} />
      <header className="c-entete c-entete-chiffree">
        <div className="c-entete-texte c-entete-avatar">
          <Avatar nom={c.nom} nuit />
          <div className="c-entete-texte">
            <span className="c-surtitre">{selon(c.dossiers.length, `${K}.surtitre`)}</span>
            <h1 data-donnee>{c.nom}</h1>
            <p className="c-entete-sous">
              {associes.length ? <span data-donnee>{associes.map((a) => a.nom).join(', ')}</span> : maj(dire('console.ecran.cabinets.sans_associe'))}
              {' · '}{dire(`${K}.inscrit`, { le: jourCourt(c.creeLe) })}
            </p>
          </div>
        </div>
        <div className="c-entete-chiffre">
          <span className="c-entete-chiffre-titre">{titre(`${K}.paie_titre`)}</span>
          <span className="c-entete-chiffre-valeur"><b>{titre(`${K}.paie`)}</b></span>
          <span className="c-entete-chiffre-sous">{phrase(`${K}.paie_sous`)}</span>
        </div>
      </header>

      <div className="c-vues c-vues-3" role="group" aria-label={titre(`${K}.filtrer`)}>
        {PLACES.map((p) => (
          <button key={p} type="button" className="c-vue" aria-pressed={place === p} onClick={() => setPlace(place === p ? null : p)}>
            <span className="c-vue-titre"><span className={`c-pilule-point c-point-${p}`} aria-hidden="true" />{titre(`${K}.place.${p}`)}</span>
            <span className="c-vue-n">{c.comptes[p]}</span>
            <span className="c-vue-sous">{maj(dire(`${K}.place_sous.${p}`))}</span>
          </button>
        ))}
      </div>

      <section className="c-carte c-liste-carte" aria-labelledby="cab-dossiers">
        <div className="c-carte-tete c-liste-tete">
          <div>
            <h2 id="cab-dossiers">{titre(`${K}.dossiers`)} <span className="c-compte-titre">{montres.length}</span></h2>
            <p className="c-carte-sous">{phrase(`${K}.dossiers_sous`)}</p>
          </div>
          {place ? (
            <span className="c-filtre-actif">
              {titre(`${K}.place.${place}`)}
              <button type="button" aria-label={titre('console.ecran.clients.retirer_filtre')} title={titre('console.ecran.clients.retirer_filtre')}
                onClick={() => setPlace(null)}><Icone nom="croix" taille={15} /></button>
            </span>
          ) : null}
        </div>
        {montres.length === 0 ? (
          <Vide icone="clients">{phrase(c.dossiers.length === 0 ? `${K}.dossiers_vide` : `${K}.dossiers_vide_place`)}</Vide>
        ) : (
          <div className="c-defile">
            <table className="c-table">
              <thead>
                <tr>
                  <th scope="col">{titre(`${K}.colonne.dossier`)}</th>
                  <th scope="col">{titre(`${K}.colonne.place`)}</th>
                  <th scope="col">{titre(`${K}.colonne.abonnement`)}</th>
                  <th scope="col">{titre(`${K}.colonne.vu`)}</th>
                  <th scope="col"><span className="c-cache">{titre('console.ecran.clients.ouvrir')}</span></th>
                </tr>
              </thead>
              <tbody>
                {montres.map((d) => {
                  const e = d.entreprise;
                  const puce = puceDe(e.etat);
                  // Pour ce qui est hors abonnement, les mots et l'explication disent la même chose : une seule fois.
                  const mots = maj(abonnementEnMots(e.etat, e.faits)), expl = expliquer(e.etat, c.aujourdhui);
                  return (
                    <tr key={e.id}>
                      <td>
                        <div className="c-cellule-nom">
                          <Avatar nom={e.raisonSociale} />
                          <div>
                            <a href={`#/clients/${e.id}`}><b data-donnee>{e.raisonSociale}</b></a>
                            {e.matricule ? <span className="c-sous c-mono" data-donnee>{e.matricule}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <b>{maj(dire(`${K}.une_place.${d.place}`))}</b>
                        <span className="c-sous">{maj(dire(`${K}.depuis`, { le: jourCourt(premierJour(d)) }))}</span>
                      </td>
                      <td>
                        <Puce ton={puce.ton}>{puce.texte}</Puce>
                        <span className="c-sous c-sous-espace">{mots.toLowerCase() === expl.toLowerCase() ? mots : `${mots} · ${expl}`}</span>
                      </td>
                      <td>{maj(e.derniereActivite ? quand(e.derniereActivite, c.aujourdhui) : dire('console.ecran.temps.jamais'))}</td>
                      <td className="c-droite">
                        <Lien href={`#/clients/${e.id}`} petit etiquette={titre('console.ecran.clients.ouvrir_fiche', { nom: e.raisonSociale })}>{titre('console.ecran.clients.ouvrir')}</Lien>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="c-carte c-liste-carte" aria-labelledby="cab-equipe">
        <div className="c-carte-tete c-liste-tete">
          <div>
            <h2 id="cab-equipe">{titre(`${K}.collaborateurs`)} <span className="c-compte-titre">{c.collaborateurs.length}</span></h2>
            <p className="c-carte-sous">{phrase(`${K}.collaborateurs_sous`)}</p>
          </div>
        </div>
        {c.collaborateurs.length === 0 ? <Vide icone="equipe">{phrase(`${K}.collaborateurs_vide`)}</Vide> : (
          <div className="c-defile">
            <table className="c-table">
              <thead>
                <tr>
                  <th scope="col">{titre(`${K}.colonne.collaborateur`)}</th>
                  <th scope="col">{titre(`${K}.colonne.role`)}</th>
                  <th scope="col">{titre(`${K}.colonne.depuis`)}</th>
                  <th scope="col">{titre(`${K}.colonne.connexion`)}</th>
                </tr>
              </thead>
              <tbody>
                {c.collaborateurs.map((x) => (
                  <tr key={x.email}>
                    <td>
                      <div className="c-cellule-nom">
                        <Avatar nom={x.nom} />
                        <div>
                          <b data-donnee>{x.nom}</b>
                          <span className="c-sous"><a href={`mailto:${x.email}`} data-donnee>{x.email}</a></span>
                        </div>
                      </div>
                    </td>
                    <td>{maj(x.roles.map((r) => dire(`role.${r}`)).join(', '))}</td>
                    <td>{jourCourt(jourDe(x.depuis))}</td>
                    <td>{maj(x.derniereConnexion ? quand(x.derniereConnexion, c.aujourdhui) : dire(`${K}.aucune_connexion`))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="c-note"><Icone nom="cache" />{phrase(`${K}.contenu`)}</p>
    </>
  );
}
