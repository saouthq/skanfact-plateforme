// Le journal de la console (C1 ; serveur/console/routes.ts, GET /console/journal ; 0083, plateforme.geste_console) :
// chaque geste de la console et de l'outil de l'exploitation, avec son auteur, son rôle, son motif, et ce qu'il a changé.
// Rien ne s'y modifie ni ne s'y efface (la base le refuse). Le plus récent en haut, regroupé par jour ; les plus anciens
// se demandent (la suite se lit à partir du dernier lu, jamais par numéro de page : une ligne neuve ne décale rien).
import { useCallback, useEffect, useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useLecture, type Role } from '../contexte.ts';
import { heureDe, jourDe, jourLong, jourMois } from '../temps.ts';
import { Alerte, Bouton, Choix, Puce, Vide } from '../ui.tsx';
import { Changements } from './Fiche.tsx';

type Ligne = {
  id: string; le: string; role: Role | null; geste: string; motif: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null;
  qui: { id: string; nom: string } | null; entreprise: { id: string; raisonSociale: string } | null; membre: { id: string; nom: string } | null;
  // Un geste du service (serveur/console/alertes.ts, `sujetDuService`) : la règle visée, l'alerte d'essai, la fin prévue.
  service?: { regle: string | null; essai: boolean; fin: string | null };
};
type Page = { lignes: Ligne[]; suite: string | null };
type Membre = { utilisateur: string; nom: string; actif: boolean };

// Un geste du service porte sur une règle de la veille (la sourdine, la prise en charge d'une de ses alertes) ou sur
// l'alerte d'essai ; une sourdine dit jusqu'à quand elle devait courir.
function SurLeService({ s }: { s: NonNullable<Ligne['service']> }) {
  if (s.regle) return <a href="#/service/alertes">{titre('console.ecran.journal.sur_regle', { nom: dire(`console.ecran.service.regle.${s.regle}.nom`) })}</a>;
  return s.essai ? <a href="#/service/alertes">{titre('console.ecran.journal.sur_essai')}</a> : <>—</>;
}
function ChangeDuService({ geste, s }: { geste: string; s: NonNullable<Ligne['service']> }) {
  if (!s.fin || (geste !== 'service.sourdine' && geste !== 'service.sourdine_levee')) return null;
  const quand = dire('console.ecran.journal.le_a', { jour: jourMois(jourDe(s.fin)), heure: heureDe(s.fin) });
  return <span className="c-changes"><span className="c-change">{dire(`console.ecran.journal.${geste === 'service.sourdine' ? 'jusqua' : 'devait_courir'}`, { quand })}</span></span>;
}

export function Journal({ entreprise }: { entreprise: string | null }) {
  const api = useApi();
  const [equipe] = useLecture<{ membres: Membre[] }>('/console/equipe');
  const [qui, setQui] = useState('');
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [suite, setSuite] = useState<string | null>(null);
  const [panne, setPanne] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lire = useCallback(async (avant: string | null) => {
    setOccupe(true);
    setPanne(null);
    try {
      const p = new URLSearchParams({ limite: '50' });
      if (qui) p.set('qui', qui);
      if (entreprise) p.set('entreprise', entreprise);
      if (avant) p.set('avant', avant);
      const r = await api<Page>('GET', `/console/journal?${p.toString()}`);
      if (!r) return;
      if (r.statut !== 200) { setPanne(refusDe(r)); return; }
      setLignes((x) => (avant && x ? [...x, ...r.corps.lignes] : r.corps.lignes));
      setSuite(r.corps.suite);
    } catch (x) { setPanne(panneDe(x)); } finally { setOccupe(false); }
  }, [api, qui, entreprise]);
  useEffect(() => { setLignes(null); void lire(null); }, [lire]);

  const membres = equipe.etat === 'lu' ? equipe.donnees.membres : [];
  const nomEntreprise = entreprise ? lignes?.find((l) => l.entreprise?.id === entreprise)?.entreprise?.raisonSociale ?? null : null;
  // Regroupés par jour (de Tunis), dans l'ordre où ils arrivent.
  const jours: { jour: string; lignes: Ligne[] }[] = [];
  for (const l of lignes ?? []) {
    const j = jourDe(l.le);
    const dernier = jours.at(-1);
    if (dernier?.jour === j) dernier.lignes.push(l); else jours.push({ jour: j, lignes: [l] });
  }

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.journal.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.journal.sous')}</p>
        </div>
      </header>
      <section className="c-carte c-liste-carte" aria-label={titre('console.ecran.journal.titre')}>
        <div className="c-liste-outils">
          <div className="c-filtre-qui">
            <Choix libelle={titre('console.ecran.journal.qui')} valeur={qui} changer={setQui}
              options={[{ valeur: '', texte: titre('console.ecran.journal.toute_l_equipe') }, ...membres.map((m) => ({ valeur: m.utilisateur, texte: m.nom, donnee: true }))]} />
          </div>
          {entreprise ? (
            <span className="c-titre-ligne">
              <Puce ton="semaine">{nomEntreprise ? dire('console.ecran.journal.seulement', { nom: nomEntreprise }) : dire('console.ecran.journal.une_entreprise')}</Puce>
              <a href="#/journal">{titre('console.ecran.journal.tout_voir')}</a>
            </span>
          ) : null}
        </div>
        {panne ? <div className="c-liste-alerte"><Alerte ton="danger"><span>{panne}</span><span><Bouton petit onClick={() => void lire(null)}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte></div> : null}
        {lignes === null ? (panne ? null : <p className="c-vide">{titre('console.ecran.lecture')}</p>)
          : lignes.length === 0 ? <Vide icone="journal">{phrase('console.ecran.journal.vide')}</Vide>
            : (
              <div className="c-defile">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th scope="col">{titre('console.ecran.journal.colonne.heure')}</th>
                      <th scope="col">{titre('console.ecran.journal.colonne.qui')}</th>
                      <th scope="col">{titre('console.ecran.journal.colonne.geste')}</th>
                      <th scope="col">{titre('console.ecran.journal.colonne.sur')}</th>
                      <th scope="col">{titre('console.ecran.journal.colonne.motif')}</th>
                      <th scope="col">{titre('console.ecran.journal.colonne.change')}</th>
                    </tr>
                  </thead>
                  {jours.map((j) => (
                    <tbody key={j.jour}>
                      <tr className="c-table-jour"><th scope="rowgroup" colSpan={6} data-donnee>{jourLong(j.jour)}</th></tr>
                      {j.lignes.map((l) => (
                        <tr key={l.id}>
                          <td className="c-mono">{heureDe(l.le)}</td>
                          <td>
                            {l.qui ? <><b data-donnee>{l.qui.nom}</b>{l.role ? <span className="c-sous c-sous-espace"><Puce ton={l.role}>{dire(`console.ecran.role.${l.role}`)}</Puce></span> : null}</>
                              : <span className="c-attente">{titre('console.ecran.journal.outil')}</span>}
                          </td>
                          <td><b>{titre(`console.ecran.journal.g.${l.geste.replaceAll('-', '_')}`)}</b></td>
                          <td>
                            {l.entreprise ? <a href={`#/clients/${l.entreprise.id}`} data-donnee>{l.entreprise.raisonSociale}</a>
                              : l.membre ? <span data-donnee>{l.membre.nom}</span>
                                : l.service ? <SurLeService s={l.service} /> : '—'}
                          </td>
                          <td><span className="c-motif" data-donnee>{'«\u202f'}{l.motif}{'\u202f»'}</span></td>
                          <td>{l.service ? <ChangeDuService geste={l.geste} s={l.service} /> : <Changements avant={l.avant} apres={l.apres} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
        {suite ? (
          <div className="c-liste-pied">
            <span />
            <Bouton petit occupe={occupe} onClick={() => void lire(suite)}>{titre('console.ecran.journal.plus')}</Bouton>
          </div>
        ) : null}
      </section>
    </>
  );
}
