// Les données personnelles (serveur/console/routes.ts, GET /console/donnees ; serveur/console/donnees.ts ; 0144 ;
// docs/console.md C68 ; docs/conservation.md). Deux choses :
//   - les demandes d'effacement que SkanFact reçoit : la direction ou le support la note (le jour où elle est arrivée,
//     par où, qui la fait, ce qu'elle vise : un compte ou une entreprise) ; elle prend son numéro et son échéance de
//     réponse ; la direction la décide, avec sa raison, puis efface le compte d'ici — les données d'une entreprise
//     s'effacent sur la machine. Chaque demande garde sa preuve : ce qui a été fait, compté ;
//   - ce que SkanFact garde, combien de temps, et comment chaque sorte de données part.
// Un seul bouton principal : la décision la plus pressée (la direction), sinon l'effacement à faire, sinon « Noter ».
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Choix, Dialogue, Icone, maj, Pilules, Puce, toast, Vide, Zone, type TonPuce } from '../ui.tsx';

type Sorte = 'personne' | 'entreprise';
type Etat = 'a_decider' | 'a_faire' | 'a_faire_machine' | 'refusee' | 'faite';
type Demande = {
  id: string; ref: string; recueLe: string; echeance: string; canal: string; demandeur: string; sorte: Sorte;
  compte: { nom: string; email: string; efface: boolean } | null; entreprise: { id: string; nom: string; numero: string | null } | null;
  noteePar: string; noteeLe: string; decision: 'accordee' | 'refusee' | null; raison: string | null; decideeLe: string | null; decideePar: string | null;
  faiteLe: string | null; faitePar: string | null; preuve: Record<string, number> | null;
};
type Conservation = { cle: string; efface: string; verifier: boolean };
type Donnees = { aujourdhui: string; demandes: Demande[]; conservation: Conservation[]; canaux: string[] };
const K = 'console.ecran.donnees';
// L'ordre dans lequel une preuve se lit (ce que la base compte : 0144, socle.effacer_personne).
const PREUVE = ['identite', 'sessions', 'sessionsConsole', 'appareils', 'codesDeSecours', 'defis', 'reinitialisations', 'changementsDAdresse', 'sms', 'tentatives', 'invitations', 'invitationsConsole', 'reprises'] as const;

// La même règle que le serveur (serveur/console/donnees.ts, etatEffacement).
function etatDe(d: Demande): Etat {
  if (!d.decision) return 'a_decider';
  if (d.decision === 'refusee') return 'refusee';
  if (d.faiteLe) return 'faite';
  return d.sorte === 'personne' ? 'a_faire' : 'a_faire_machine';
}
const ouverte = (d: Demande) => { const e = etatDe(d); return e === 'a_decider' || e === 'a_faire' || e === 'a_faire_machine'; };
const enRetard = (d: Demande, aujourdhui: string) => d.decision === null && d.echeance < aujourdhui;
const joursAvant = (jour: string, aujourdhui: string) => Math.round((Date.parse(`${jour}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000);

// Ce que la demande vise, en mots : le compte (son nom, son adresse) ou l'entreprise (son nom, son numéro).
function cible(d: Demande): string {
  if (d.sorte === 'personne') return d.compte ? (d.compte.efface ? maj(dire(`${K}.compte_efface`)) : `${d.compte.nom} · ${d.compte.email}`) : '—';
  return d.entreprise ? [d.entreprise.nom, d.entreprise.numero].filter(Boolean).join(' · ') : '—';
}
// La preuve en mots : « l'identité, 3 sessions, 2 appareils… » — ce qui a été compté, jamais ce qui a été effacé.
export function preuveEnMots(p: Record<string, number>): string {
  return PREUVE.filter((c) => (p[c] ?? 0) > 0).map((c) => selon(p[c] ?? 0, `${K}.preuve.${c}`)).join(', ');
}
function puce(d: Demande, aujourdhui: string): { ton: TonPuce; texte: string } {
  const e = etatDe(d);
  if (e === 'a_decider') {
    const j = joursAvant(d.echeance, aujourdhui);
    if (j < 0) return { ton: 'urgent', texte: selon(-j, `${K}.p.retard`) };
    return { ton: j <= 7 ? 'semaine' : 'a_regarder', texte: j === 0 ? dire(`${K}.p.aujourdhui`) : selon(j, `${K}.p.reste`) };
  }
  if (e === 'a_faire') return { ton: 'aujourdhui', texte: dire(`${K}.p.a_faire`) };
  if (e === 'a_faire_machine') return { ton: 'hors', texte: dire(`${K}.p.a_faire_machine`) };
  return { ton: 'hors', texte: dire(`${K}.p.${e}`) };
}

type Geste = { sorte: 'noter' } | { sorte: 'decider'; d: Demande } | { sorte: 'faire'; d: Demande };

export function Donnees({ demande: visee }: { demande: string | null }) {
  const { moi } = useConsole();
  const [l, relire] = useLecture<Donnees>('/console/donnees', 'donnees');
  const [geste, setGeste] = useState<Geste | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = d?.aujourdhui ?? moi.aujourdhui;
  const direction = moi.role === 'direction';
  const ouvertes = d ? d.demandes.filter(ouverte) : [];
  const traitees = d ? d.demandes.filter((x) => !ouverte(x)) : [];
  // L'étape suivante : la décision la plus pressée (la base les range ainsi), puis un compte à effacer, sinon noter.
  const principal = direction ? ouvertes.find((x) => etatDe(x) === 'a_decider') ?? ouvertes.find((x) => etatDe(x) === 'a_faire') ?? null : null;
  // Venue d'« À décider » (« ?demande=… ») : la demande se montre, puis l'adresse redevient celle de l'écran.
  useEffect(() => {
    if (!visee || !d) return;
    document.getElementById(`ef-${visee}`)?.scrollIntoView({ block: 'center' });
    history.replaceState(null, '', '#/donnees');
  }, [visee, d]);
  const fait = () => { setGeste(null); relire(); };

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
        <Bouton {...(principal ? {} : { ton: 'principal' as const })} icone="plus" onClick={() => setGeste({ sorte: 'noter' })}>{titre(`${K}.noter`)}</Bouton>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <section className="c-carte c-decider" aria-labelledby="ef-ouvertes">
            <div className="c-carte-tete">
              <h2 id="ef-ouvertes">{titre(`${K}.ouvertes`)} <span className="c-compte-titre">{ouvertes.length}</span></h2>
              <p className="c-carte-sous">{phrase(`${K}.ouvertes_sous`)}</p>
            </div>
            {ouvertes.length === 0 ? <Vide>{phrase(`${K}.ouvertes_vide`)}</Vide> : (
              <ul className="c-lignes">
                {ouvertes.map((x) => {
                  const e = etatDe(x), p = puce(x, aujourdhui);
                  return (
                    <li key={x.id} id={`ef-${x.id}`} className={`c-ligne-decision${visee === x.id ? ' c-ef-visee' : ''}`}>
                      <span className={`c-ligne-icone c-${p.ton === 'urgent' ? 'urgent' : p.ton === 'semaine' ? 'semaine' : 'a_regarder'}`}><Icone nom={x.sorte === 'personne' ? 'personne' : 'base'} /></span>
                      <div className="c-ligne-texte">
                        <span className="c-ligne-titre"><span className="c-mono" data-donnee>{x.ref}</span> <span data-donnee>{cible(x)}</span> <Puce ton={p.ton}>{maj(p.texte)}</Puce></span>
                        <span className="c-ligne-desc">
                          {maj(dire(`${K}.recue`, { le: jourCourt(x.recueLe), canal: dire(`${K}.canal.${x.canal}`) }))}{' · '}<span data-donnee>{x.demandeur}</span>
                          {e === 'a_decider' ? <>{' · '}{dire(enRetard(x, aujourdhui) ? `${K}.echeance_passee` : `${K}.echeance`, { le: jourCourt(x.echeance) })}</> : null}
                        </span>
                        {e === 'a_faire' || e === 'a_faire_machine' ? (
                          <span className="c-ligne-meta">{maj(dire(`${K}.accordee_par`, { par: x.decideePar ?? '—', le: jourCourt(jourDe(x.decideeLe ?? x.noteeLe)) }))} · <span data-donnee>« {x.raison} »</span></span>
                        ) : <span className="c-ligne-meta">{maj(dire(`${K}.notee_par`, { par: x.noteePar, quand: quand(x.noteeLe, aujourdhui) }))}</span>}
                        {e === 'a_faire_machine' ? <span className="c-ligne-meta">{phrase(`${K}.machine`)}</span> : null}
                      </div>
                      {direction && e === 'a_decider' ? (
                        <Bouton petit {...(principal?.id === x.id ? { ton: 'principal' as const } : {})} onClick={() => setGeste({ sorte: 'decider', d: x })}
                          etiquette={titre(`${K}.decider_aria`, { ref: x.ref })}>{titre(`${K}.decider`)}</Bouton>
                      ) : direction && e === 'a_faire' ? (
                        <Bouton petit {...(principal?.id === x.id ? { ton: 'principal' as const } : {})} onClick={() => setGeste({ sorte: 'faire', d: x })}
                          etiquette={titre(`${K}.effacer_aria`, { ref: x.ref })}>{titre(`${K}.effacer`)}</Bouton>
                      ) : !direction && e === 'a_decider' ? <span className="c-sous">{maj(dire(`${K}.la_direction_decide`))}</span> : <span />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {traitees.length ? (
            <section className="c-carte c-liste-carte" aria-labelledby="ef-traitees">
              <div className="c-carte-tete c-liste-tete">
                <h2 id="ef-traitees">{titre(`${K}.traitees`)} <span className="c-compte-titre">{traitees.length}</span></h2>
              </div>
              <div className="c-defile">
                <table className="c-table c-ef-table">
                  <thead><tr>
                    <th>{titre(`${K}.c.demande`)}</th><th>{titre(`${K}.c.cible`)}</th><th>{titre(`${K}.c.decision`)}</th><th>{titre(`${K}.c.fait`)}</th>
                  </tr></thead>
                  <tbody>
                    {traitees.map((x) => (
                      <tr key={x.id} id={`ef-${x.id}`}>
                        <td data-titre={titre(`${K}.c.demande`)}><span className="c-mono" data-donnee>{x.ref}</span><span className="c-sous c-ef-bloc">{maj(dire(`${K}.recue_court`, { le: jourCourt(x.recueLe) }))}</span></td>
                        <td data-titre={titre(`${K}.c.cible`)} data-donnee>{cible(x)}</td>
                        <td data-titre={titre(`${K}.c.decision`)}>
                          <span className={`c-ef-decision c-ef-${x.decision}`}><Icone nom={x.decision === 'accordee' ? 'ok' : 'croix'} taille={15} />{maj(dire(`${K}.d.${x.decision}`, { le: jourCourt(jourDe(x.decideeLe ?? x.noteeLe)) }))}</span>
                          <span className="c-sous c-ef-bloc" data-donnee>« {x.raison} »</span>
                        </td>
                        <td data-titre={titre(`${K}.c.fait`)}>{x.faiteLe && x.preuve ? (
                          <><span>{maj(dire(`${K}.faite_le`, { le: jourCourt(jourDe(x.faiteLe)), par: x.faitePar ?? '—' }))}</span><span className="c-sous c-ef-bloc">{maj(dire(`${K}.compte`, { preuve: preuveEnMots(x.preuve) }))}</span></>
                        ) : <span className="c-sous">{maj(dire(`${K}.rien_efface`))}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="c-carte c-liste-carte" aria-labelledby="ef-garde">
            <div className="c-carte-tete c-liste-tete c-ef-tete">
              <h2 id="ef-garde">{titre(`${K}.garde`)}</h2>
              <p className="c-carte-sous">{phrase(`${K}.garde_sous`)}</p>
            </div>
            <div className="c-defile">
              <table className="c-table c-ef-table">
                <thead><tr><th>{titre(`${K}.c.donnees`)}</th><th>{titre(`${K}.c.duree`)}</th><th>{titre(`${K}.c.depart`)}</th></tr></thead>
                <tbody>
                  {d.conservation.map((c) => (
                    <tr key={c.cle}>
                      <td data-titre={titre(`${K}.c.donnees`)}><b>{maj(dire(`${K}.g.${c.cle}.quoi`))}</b><span className="c-sous c-ef-bloc">{maj(dire(`${K}.g.${c.cle}.detail`))}</span></td>
                      <td data-titre={titre(`${K}.c.duree`)}>{maj(dire(`${K}.g.${c.cle}.duree`))}{c.verifier ? <span className="c-ef-verifier">{dire(`${K}.a_verifier`)}</span> : null}</td>
                      <td data-titre={titre(`${K}.c.depart`)}>{maj(dire(`${K}.e.${c.efface}`))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="c-liste-pied">{phrase(`${K}.garde_pied`)}</p>
          </section>
        </>
      ) : null}
      {geste?.sorte === 'noter' && d ? <FenetreNoter canaux={d.canaux} aujourdhui={aujourdhui} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'decider' ? <FenetreDecider d={geste.d} aujourdhui={aujourdhui} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'faire' ? <FenetreEffacer d={geste.d} fermer={() => setGeste(null)} fait={fait} /> : null}
    </>
  );
}

function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = (chemin: string, corps: unknown, dit: (r: Record<string, unknown>) => string, champRefus = 'motif') => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<Record<string, unknown>>('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit(r.corps)); fait(); return; }
        setRefus(refusDe(r));
        setFaute((f) => ({ champ: typeof r.corps.champ === 'string' ? r.corps.champ : champRefus, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return { envoyer, refuser, oublier: () => { setRefus(null); setFaute(null); }, refus, occupe, faute: (champ: string) => faute?.champ === champ, n: faute?.n ?? 0 };
}
function Qui() {
  const { moi } = useConsole();
  return <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>;
}
function Pied({ fermer, occupe, envoyer, bouton, danger = false }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string; danger?: boolean }) {
  return (
    <>
      <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
      <Bouton ton={danger ? 'danger' : 'principal'} occupe={occupe} onClick={envoyer}>{bouton}</Bouton>
    </>
  );
}

// Noter une demande reçue : ce qu'elle vise (un compte, par son adresse ; une entreprise, par son numéro de client), qui
// la fait, par où et quel jour elle est arrivée.
function FenetreNoter({ canaux, aujourdhui, fermer, fait }: { canaux: string[]; aujourdhui: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [sorte, setSorte] = useState<Sorte>('personne');
  const [cibleV, setCible] = useState('');
  const [demandeur, setDemandeur] = useState('');
  const [canal, setCanal] = useState(canaux[0] ?? 'courriel');
  const [recueLe, setRecueLe] = useState(aujourdhui);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (cibleV.trim().length < 3) { e.refuser(phrase(`${K}.n.cible_vide.${sorte}`), 'cible'); return; }
    if (demandeur.trim().length < 3) { e.refuser(phrase(`${K}.n.demandeur_vide`), 'demandeur'); return; }
    if (!recueLe || recueLe > aujourdhui) { e.refuser(phrase(`${K}.n.jour_futur`), 'recueLe'); return; }
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer('/console/donnees/effacements', { canal, demandeur: demandeur.trim(), recueLe, sorte, cible: cibleV.trim(), motif: motif.trim() },
      (r) => phrase(`${K}.n.fait`, { ref: String(r.ref ?? '') }), 'cible');
  };
  return (
    <Dialogue titre={titre(`${K}.n.titre`)} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.n.bouton`)} />}>
      <Pilules libelle={titre(`${K}.n.sorte`)} valeur={sorte} changer={(x) => { e.oublier(); setSorte(x); }}
        choix={(['personne', 'entreprise'] as const).map((x) => ({ valeur: x, texte: maj(dire(`${K}.n.sorte_${x}`)) }))} />
      <Champ libelle={titre(`${K}.n.cible.${sorte}`)} aide={phrase(`${K}.n.cible_aide.${sorte}`)} valeur={cibleV} changer={setCible}
        type={sorte === 'personne' ? 'email' : 'text'} autoComplete="off" placeholder={sorte === 'personne' ? 'nom@exemple.tn' : 'E-0012'} premier faute={e.faute('cible')} n={e.n} />
      <Champ libelle={titre(`${K}.n.demandeur`)} aide={phrase(`${K}.n.demandeur_aide`)} valeur={demandeur} changer={setDemandeur} autoComplete="off" faute={e.faute('demandeur')} n={e.n} />
      <div className="c-ef-deux">
        <Choix libelle={titre(`${K}.n.canal`)} valeur={canal} changer={setCanal} options={canaux.map((c) => ({ valeur: c, texte: maj(dire(`${K}.canal.${c}`)) }))} />
        <Champ libelle={titre(`${K}.n.recue`)} type="date" max={aujourdhui} valeur={recueLe} changer={setRecueLe} faute={e.faute('recueLe')} n={e.n} />
      </div>
      <Alerte ton="info"><span>{phrase(`${K}.n.echeance`)}</span></Alerte>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.n.motif_aide`)} valeur={motif} changer={setMotif} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

// Décider : accordée ou refusée, avec la raison qui se répond à la personne. Accorder n'efface encore rien.
function FenetreDecider({ d, aujourdhui, fermer, fait }: { d: Demande; aujourdhui: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [decision, setDecision] = useState<'accordee' | 'refusee' | null>(null);
  const [raison, setRaison] = useState('');
  const envoyer = () => {
    if (!decision) { e.refuser(phrase(`${K}.dc.choisir`), 'decision'); return; }
    if (raison.trim().length < 3) { e.refuser(phrase(`${K}.dc.raison_courte`), 'raison'); return; }
    e.envoyer(`/console/donnees/effacements/${d.id}/decider`, { decision, raison: raison.trim() }, () => phrase(`${K}.dc.fait.${decision}`, { ref: d.ref }), 'raison');
  };
  return (
    <Dialogue titre={titre(`${K}.dc.titre`, { ref: d.ref })} sous={cible(d)} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(decision ? `${K}.dc.bouton.${decision}` : `${K}.dc.bouton.aucune`)} />}>
      <p className="c-sous">
        {maj(dire(`${K}.recue`, { le: jourCourt(d.recueLe), canal: dire(`${K}.canal.${d.canal}`) }))}{' · '}<span data-donnee>{d.demandeur}</span>{' · '}
        {dire(enRetard(d, aujourdhui) ? `${K}.echeance_passee` : `${K}.echeance`, { le: jourCourt(d.echeance) })}
      </p>
      <Pilules libelle={titre(`${K}.dc.decision`)} valeur={decision} changer={(x) => { e.oublier(); setDecision(x); }} faute={e.faute('decision')}
        choix={(['accordee', 'refusee'] as const).map((x) => ({ valeur: x, texte: maj(dire(`${K}.dc.${x}`)) }))} />
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li>{phrase(decision === 'refusee' ? `${K}.dc.p_refusee` : d.sorte === 'personne' ? `${K}.dc.p_accordee` : `${K}.dc.p_accordee_entreprise`)}</li>
          <li>{phrase(`${K}.dc.p_journal`)}</li>
        </ul>
      </div>
      <Zone libelle={titre(`${K}.dc.raison`)} aide={phrase(decision === 'refusee' ? `${K}.dc.raison_aide_refus` : `${K}.dc.raison_aide`)} valeur={raison} changer={setRaison} max={1000}
        faute={e.faute('raison')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

// Effacer le compte : ce qui part, ce qui reste ; ce qui ne se défait pas se dit avant le geste.
function FenetreEffacer({ d, fermer, fait }: { d: Demande; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/donnees/effacements/${d.id}/faire`, { motif: motif.trim() },
      (r) => phrase(`${K}.f.fait`, { ref: d.ref, preuve: preuveEnMots((r.preuve ?? {}) as Record<string, number>) }));
  };
  return (
    <Dialogue titre={titre(`${K}.f.titre`, { ref: d.ref })} sous={cible(d)} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.f.bouton`)} danger />}>
      <Alerte ton="attention"><span>{phrase(`${K}.f.definitif`)}</span></Alerte>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.f.part`)}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${K}.f.${x}`)}</li>)}</ul>
        <span className="c-champ-libelle">{titre(`${K}.f.reste`)}</span>
        <ul>{['r1', 'r2'].map((x) => <li key={x}>{phrase(`${K}.f.${x}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.f.motif_aide`)} valeur={motif} changer={setMotif} premier faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

