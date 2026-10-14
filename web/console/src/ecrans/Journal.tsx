// Le journal de la console (C1 ; serveur/console/routes.ts, GET /console/journal ; 0083, plateforme.geste_console) :
// chaque geste de la console et de l'outil de l'exploitation, avec son auteur, son rôle, son motif, et ce qu'il a changé.
// Rien ne s'y modifie ni ne s'y efface (la base le refuse). Le plus récent en haut, regroupé par jour ; les plus anciens
// se demandent (la suite se lit à partir du dernier lu, jamais par numéro de page : une ligne neuve ne décale rien).
// Recalé sur sa maquette : qui se choisit d'un clic (une pilule par membre), chaque geste porte sa famille, la valeur
// d'avant se lit barrée au-dessus de la nouvelle, et un jour se nomme comme on le dit (« Aujourd'hui · mardi 13 octobre »).
import { useCallback, useEffect, useState } from 'react';
import { montant } from '../argent.ts';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { heureDe, jourCourt, jourDe, jourLong, jourMois, joursEntre } from '../temps.ts';
import { Alerte, Avatar, Bouton, maj, Puce, Vide } from '../ui.tsx';
import { Changements } from './Fiche.tsx';
import { refDemande } from './Support.tsx';

type Ligne = {
  id: string; le: string; role: Role | null; geste: string; motif: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null;
  qui: { id: string; nom: string } | null; entreprise: { id: string; raisonSociale: string } | null; membre: { id: string; nom: string } | null;
  // Un geste du service (serveur/console/alertes.ts, `sujetDuService`) : la règle visée, l'alerte d'essai, la fin prévue.
  service?: { regle: string | null; essai: boolean; fin: string | null };
  // Un geste des réglages (serveur/console/reglages.ts, `sujetDesReglages`) : la règle relue et l'avis, les deux jours du
  // message, le prix préparé ou retiré, le préavis, une règle de l'abonnement, ou ce qu'une offre comprend.
  reglages?: {
    regle: string | null; reluePar: string | null; avis: 'juste' | 'a_corriger' | null; du: string | null; au: string | null;
    prix: { quoi: string; periodicite: 'annuel' | 'mensuel'; aPartirDu: string | null; avant: string | null; apres: string | null } | null;
    preavis: { avant: number | null; apres: number | null } | null;
    regleAbonnement?: { code: 'essai' | 'grace' | 'relances'; avant: number[] | null; apres: number[] | null } | null;
    contenu?: { offre: 'essentiel' | 'complet'; quoi: 'caisses' | 'etablissements' | 'salaries' | 'paie' | 'compta'; aPartirDu: string | null; avant: number | null; apres: number | null } | null;
  };
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

// Un geste des réglages porte sur une règle du registre (l'avis de qui l'a relue) ou sur le message aux clients (ses jours).
// Un geste du support porte sur une demande (0095) : son numéro, qui l'ouvre dans l'écran Support.
function LaDemande({ avant, apres }: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }) {
  const id = typeof apres?.demande === 'string' ? apres.demande : typeof avant?.demande === 'string' ? avant.demande : null;
  const numero = typeof apres?.numero === 'number' ? apres.numero : typeof avant?.numero === 'number' ? avant.numero : null;
  if (!id || numero === null) return null;
  return <span className="c-changes"><a className="c-change" href={`#/support?demande=${id}`}>{titre('console.ecran.journal.sur_demande', { ref: refDemande(numero) })}</a></span>;
}
// Ce qui a un prix (0103) : une offre (« Essentiel »), ou ce qui s'ajoute (« une caisse de plus »).
const nomDuPrix = (q: string) => (q === 'essentiel' || q === 'complet' ? dire(`console.ecran.reglages.p.offre.${q}`) : dire(`console.ecran.reglages.a.nom.${q}`));
function SurLesReglages({ r }: { r: NonNullable<Ligne['reglages']> }) {
  if (r.prix) return <a href="#/reglages">{titre('console.ecran.journal.sur_prix', { quoi: nomDuPrix(r.prix.quoi), periode: dire(`console.ecran.reglages.p.periode.${r.prix.periodicite}`) })}</a>;
  if (r.preavis) return <a href="#/reglages">{titre('console.ecran.journal.sur_preavis')}</a>;
  if (r.regleAbonnement) return <a href="#/reglages">{titre(`console.ecran.journal.sur_regle_abo.${r.regleAbonnement.code}`)}</a>;
  if (r.contenu) return <a href="#/reglages">{titre('console.ecran.journal.sur_contenu', { offre: dire(`console.ecran.reglages.p.offre.${r.contenu.offre}`), quoi: dire(`console.ecran.reglages.c.quoi.${r.contenu.quoi}`) })}</a>;
  return r.regle ? <a href="#/reglages?onglet=regles">{titre('console.ecran.journal.sur_regle_commune', { code: r.regle })}</a>
    : <a href="#/reglages?onglet=messages">{titre('console.ecran.journal.sur_message')}</a>;
}
function ChangeDesReglages({ geste, r }: { geste: string; r: NonNullable<Ligne['reglages']> }) {
  // Un prix préparé : celui d'avant barré, le nouveau à sa date. Retiré : le prix retiré (à sa date) barré, celui qui reste.
  if (r.prix) {
    const date = r.prix.aPartirDu ? ` ${dire('console.ecran.journal.a_partir_du', { jour: jourCourt(r.prix.aPartirDu) })}` : '';
    const retire = geste === 'reglages.prix_retire';
    return (
      <span className="c-changes"><span className="c-change">
        {r.prix.avant ? <><del data-donnee>{montant(r.prix.avant)}{retire ? date : ''}</del> → </> : null}
        {r.prix.apres ? <ins data-donnee>{montant(r.prix.apres)}{retire ? '' : date}</ins> : '—'}
      </span></span>
    );
  }
  if (r.preavis) {
    const jours = (n: number | null) => (n === null ? '—' : selon(n, 'console.ecran.journal.jours'));
    return <span className="c-changes"><span className="c-change"><del data-donnee>{jours(r.preavis.avant)}</del> → <ins data-donnee>{jours(r.preavis.apres)}</ins></span></span>;
  }
  // Une règle de l'abonnement (0104) : ses jours d'avant barrés, les nouveaux (« 15, 7, 1 j » → « 10, 3 j »).
  if (r.regleAbonnement) {
    const jours = (j: number[] | null) => (j === null ? '—' : j.length === 1 ? selon(j[0] ?? 0, 'console.ecran.journal.jours') : dire('console.ecran.journal.jours_liste', { liste: j.join(', ') }));
    return <span className="c-changes"><span className="c-change"><del data-donnee>{jours(r.regleAbonnement.avant)}</del> → <ins data-donnee>{jours(r.regleAbonnement.apres)}</ins></span></span>;
  }
  // Ce qu'une offre comprend (0105) : comme un prix, ce qu'elle comprenait barré, le nouveau à sa date ; retiré, le
  // changement retiré (à sa date) barré, ce qui reste.
  if (r.contenu) {
    const c = r.contenu;
    const date = c.aPartirDu ? ` ${dire('console.ecran.journal.a_partir_du', { jour: jourCourt(c.aPartirDu) })}` : '';
    const retire = geste === 'reglages.contenu_retire';
    const dit = (n: number | null) => (n === null ? '—' : selon(n, `console.ecran.reglages.c.dit.${c.quoi}`));
    return (
      <span className="c-changes"><span className="c-change">
        <del data-donnee>{dit(c.avant)}{retire ? date : ''}</del> → <ins data-donnee>{dit(c.apres)}{retire ? '' : date}</ins>
      </span></span>
    );
  }
  const t = r.regle && r.reluePar ? dire(`console.ecran.journal.relue_${r.avis === 'a_corriger' ? 'corriger' : 'juste'}`, { qui: r.reluePar })
    : r.du && r.au ? dire('console.ecran.journal.du_au', { du: jourCourt(r.du), au: jourCourt(r.au) }) : null;
  return t ? <span className="c-changes"><span className="c-change" data-donnee>{t}</span></span> : null;
}

// La famille d'un geste, lue dans son nom : l'abonnement d'un client, l'équipe, le service, les réglages, le support, nos
// factures.
const FAMILLES = ['abonnement', 'equipe', 'service', 'reglages', 'support', 'factures'] as const;
const familleDe = (geste: string) => FAMILLES.find((f) => geste.startsWith(`${f}.`)) ?? null;

// Un jour comme on le dit : « Aujourd'hui · mardi 13 octobre », « Hier · lundi 12 octobre », « samedi 10 octobre » ; l'année
// seulement quand ce n'est pas celle d'aujourd'hui.
function jourEnMots(jour: string, aujourdhui: string): string {
  const long = jourLong(jour);
  const sansAnnee = jour.slice(0, 4) === aujourdhui.slice(0, 4) ? long.replace(/\s\d{4}$/, '') : long;
  const n = joursEntre(jour, aujourdhui);
  return n === 0 ? `${maj(dire('console.ecran.temps.aujourdhui'))} · ${sansAnnee}` : n === 1 ? `${maj(dire('console.ecran.temps.hier'))} · ${sansAnnee}` : maj(sansAnnee);
}

export function Journal({ entreprise, qui: quiDemande }: { entreprise: string | null; qui: string | null }) {
  const api = useApi();
  const { moi } = useConsole();
  const [equipe] = useLecture<{ membres: Membre[] }>('/console/equipe');
  const [qui, setQui] = useState(quiDemande ?? '');
  // Un membre demandé d'ailleurs (« ses gestes au journal », dans l'équipe) remplace celui-ci ; l'adresse suit le choix.
  useEffect(() => { setQui(quiDemande ?? ''); }, [quiDemande]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (entreprise) p.set('entreprise', entreprise);
    if (qui) p.set('qui', qui);
    const s = p.toString();
    history.replaceState(null, '', `#/journal${s ? `?${s}` : ''}`);
  }, [entreprise, qui]);
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
          <div className="c-pilules c-jr-qui" role="group" aria-label={titre('console.ecran.journal.qui')}>
            <button type="button" className="c-pilule" aria-pressed={qui === ''} onClick={() => setQui('')}>{titre('console.ecran.journal.toute_l_equipe')}</button>
            {membres.map((m) => (
              <button key={m.utilisateur} type="button" className="c-pilule" aria-pressed={qui === m.utilisateur} onClick={() => setQui(m.utilisateur)}>
                <Avatar nom={m.nom} /><span data-donnee>{m.nom}</span>
              </button>
            ))}
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
                <table className="c-table c-table-journal">
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
                  {jours.map((j, i) => {
                    // Le compte d'un jour ne se dit que s'il est entier : le dernier jour lu peut continuer dans la suite.
                    const entier = i < jours.length - 1 || suite === null;
                    return (
                      <tbody key={j.jour}>
                        <tr className="c-table-jour">
                          <th scope="rowgroup" colSpan={6}>
                            <b data-donnee>{jourEnMots(j.jour, moi.aujourdhui)}</b>
                            {entier ? <span>{' · '}{selon(j.lignes.length, 'console.ecran.journal.gestes')}</span> : null}
                          </th>
                        </tr>
                        {j.lignes.map((l) => {
                          const famille = familleDe(l.geste);
                          return (
                            <tr key={l.id}>
                              <td className="c-mono">{heureDe(l.le)}</td>
                              <td>
                                {l.qui ? (
                                  <span className="c-jr-qui-cellule">
                                    <Avatar nom={l.qui.nom} nuit={l.role === 'direction'} />
                                    <span><b data-donnee>{l.qui.nom}</b>{l.role ? <span className="c-sous">{titre(`console.ecran.role.${l.role}`)}</span> : null}</span>
                                  </span>
                                ) : <span className="c-attente">{titre('console.ecran.journal.outil')}</span>}
                              </td>
                              <td>
                                <b>{titre(`console.ecran.journal.g.${l.geste.replaceAll('-', '_')}`)}</b>
                                {famille ? <span className="c-sous c-sous-espace"><span className={`c-jr-famille c-jr-famille-${famille}`}>{titre(`console.ecran.journal.famille.${famille}`)}</span></span> : null}
                              </td>
                              <td className="c-jr-sur">
                                {l.entreprise ? <a href={`#/clients/${l.entreprise.id}`} data-donnee>{l.entreprise.raisonSociale}</a>
                                  : l.membre ? <span data-donnee>{l.membre.nom}</span>
                                    : l.service ? <SurLeService s={l.service} /> : l.reglages ? <SurLesReglages r={l.reglages} /> : '—'}
                              </td>
                              <td><span className="c-jr-motif" data-donnee>{'«\u202f'}{l.motif}{'\u202f»'}</span></td>
                              <td>{l.service ? <ChangeDuService geste={l.geste} s={l.service} /> : l.reglages ? <ChangeDesReglages geste={l.geste} r={l.reglages} />
                                : famille === 'support' ? <LaDemande avant={l.avant} apres={l.apres} /> : <Changements avant={l.avant} apres={l.apres} empile />}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
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
