// L'équipe SkanFact (10 § 2.10 ; serveur/console/routes.ts, /console/equipe ; 0083) : qui entre dans la console, avec
// quel rôle, son code du téléphone (sans lui, la console ne s'ouvre pas), sa dernière connexion et où sa session est
// ouverte. La direction ajoute, change un rôle, retire : chaque geste demande un motif et reste au journal. Jamais sur
// soi-même, et l'équipe garde toujours quelqu'un à la direction (la base le tient). Recalé sur sa maquette : trois
// cartes (l'équipe, le code du téléphone, qui est en ligne), « À régler dans l'équipe » quand quelqu'un n'entre pas
// encore (avec de quoi le lui rappeler), les gestes d'une ligne dans son menu (le même que les règles des alertes,
// MenuLigne), et ce que chaque rôle ouvre — lu dans la liste des gestes du serveur, jamais recopié ici.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { heureDe, jourCourt, jourDe, quand } from '../temps.ts';
import { TonCompte } from './TonCompte.tsx';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, MenuLigne, Puce, toast, Zone, type ActionLigne } from '../ui.tsx';

// `secours` : ses codes de secours qui restent ; `reconnus` : ses appareils reconnus (trente jours) ; `gestes30` : ses gestes
// au journal, ces trente derniers jours (0114, la maquette Équipe).
type Membre = {
  utilisateur: string; nom: string; email: string; role: Role; actif: boolean; ajouteLe: string; retireLe: string | null;
  code: 'sms' | 'application' | null; moi: boolean; derniereConnexion: string | null; appareils: { nom: string; type: string }[];
  secours?: number; reconnus?: number; gestes30?: number;
};
const ROLES: readonly Role[] = ['direction', 'support', 'technique'];
type Droit = { code: string; roles: Role[] };
// Ce qu'un rôle ouvre seulement en partie : la nuance se dit à la place du « oui ».
export const NUANCES: Record<string, Partial<Record<Role, string>>> = {
  'console.accueil.voir': { support: 'console.ecran.equipe.droit.console.accueil.voir.support', technique: 'console.ecran.equipe.droit.console.accueil.voir.technique' },
  'console.abonnement.prolonger': { support: 'console.ecran.equipe.droit.console.abonnement.prolonger.support' },
  'console.abonnement.offrir_mois': { support: 'console.ecran.equipe.droit.console.abonnement.offrir_mois.support' },
  'console.journal.voir': { support: 'console.ecran.equipe.droit.console.journal.voir.support' },
};
type Geste = { sorte: 'ajouter' } | { sorte: 'role'; m: Membre } | { sorte: 'retirer'; m: Membre };

function FenetreEquipe({ g, fermer, fait }: { g: Geste; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(g.sorte === 'role' ? (ROLES.find((r) => r !== g.m.role) ?? 'support') : 'support');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string | null) => { setRefus(texte); setFaute(champ ? { champ, n: (faute?.n ?? 0) + 1 } : null); };

  const faire = () => {
    if (g.sorte === 'ajouter' && !email.trim()) { refuser(phrase('console.ecran.equipe.email_aide'), 'email'); return; }
    if (motif.trim().length < 3) { refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = g.sorte === 'ajouter' ? await api('POST', '/console/equipe', { email: email.trim(), role, motif: motif.trim() })
          : g.sorte === 'role' ? await api('PUT', `/console/equipe/${g.m.utilisateur}`, { role, motif: motif.trim() })
            : await api('POST', `/console/equipe/${g.m.utilisateur}/retirer`, { motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) {
          toast(phrase(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajoute' : g.sorte === 'role' ? 'console.ecran.equipe.role_change' : 'console.ecran.equipe.retire'));
          fait();
          return;
        }
        refuser(refusDe(r), r.corps.champ === 'email' || r.corps.champ === 'motif' ? r.corps.champ : null);
      } catch (x) { refuser(panneDe(x), null); } finally { setOccupe(false); }
    })();
  };

  const nom = g.sorte === 'ajouter' ? titre('console.ecran.equipe.ajouter')
    : g.sorte === 'role' ? titre('console.ecran.equipe.changer_role_de', { nom: g.m.nom }) : titre('console.ecran.equipe.retirer_de', { nom: g.m.nom });
  const sous = phrase(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajouter_sous' : g.sorte === 'role' ? 'console.ecran.equipe.changer_sous' : 'console.ecran.equipe.retirer_sous');
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });
  return (
    <Dialogue titre={nom} sous={sous} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton={g.sorte === 'retirer' ? 'danger' : 'principal'} occupe={occupe} onClick={faire}>
          {titre(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajouter' : g.sorte === 'role' ? 'console.ecran.equipe.changer_role' : 'console.ecran.equipe.retirer')}
        </Bouton>
      </>}>
      {g.sorte === 'ajouter' ? <Champ libelle={titre('console.ecran.equipe.email')} aide={phrase('console.ecran.equipe.email_aide')} type="email" inputMode="email" valeur={email} changer={setEmail} {...sur('email')} /> : null}
      {g.sorte !== 'retirer' ? (
        <Choix libelle={titre('console.ecran.equipe.role')} aide={phrase(`console.ecran.role_aide.${role}`)} valeur={role} changer={(v) => setRole(v as Role)}
          options={ROLES.filter((r) => g.sorte !== 'role' || r !== g.m.role).map((r) => ({ valeur: r, texte: titre(`console.ecran.role.${r}`) }))} />
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.equipe.motif_aide')} valeur={motif} changer={setMotif} {...sur('motif')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Ses appareils et ses sessions (0114, l'audit F09) ─────────────────────────────────────────────────────────────────
// Ce qui a ouvert la console pour cette personne : chaque appareil, jusqu'à quand il est reconnu, ses sessions ouvertes.
// Fermer une session, oublier un appareil : la direction pour chacun, chacun pour lui-même ; avec son motif, au journal.
// Jamais un mot de passe, un code ni une adresse : l'appareil et ses dates.
type SessionLue = { id: string; ouverteLe: string; derniereActivite: string; expireLe: string; celleCi: boolean };
type AppareilLu = { id: string; nom: string; type: string; premierVu: string; dernierVu: string | null; reconnuJusquAu: string | null; oublieLe: string | null; sessions: SessionLue[] };
type Appareils = { aujourdhui: string; membre: { utilisateur: string; nom: string; email: string; role: Role; actif: boolean; moi: boolean }; appareils: AppareilLu[] };
// Dans la page (Ton compte), les plus récents d'abord ; les autres s'ouvrent d'un clic (la fenêtre de l'équipe montre tout).
const APPAREILS_EN_PAGE = 3;
type GesteAppareil = { sorte: 'fermer'; s: SessionLue; a: AppareilLu } | { sorte: 'oublier'; a: AppareilLu };
// `enPage` : la liste se pose dans la page (Ton compte, la maquette « Tes appareils ») au lieu d'une fenêtre ; les gestes
// d'un appareil gardent la leur.
export function SesAppareils({ membre, fermer, enPage = false }: { membre: { utilisateur: string; nom: string }; fermer?: () => void; enPage?: boolean }) {
  const api = useApi();
  const { moi, sortir } = useConsole();
  const [l, relire] = useLecture<Appareils>(`/console/equipe/${membre.utilisateur}/appareils`);
  const [g, setG] = useState<GesteAppareil | null>(null);
  const [tous, setTous] = useState(false);
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const lu = l.etat === 'lu' ? l.donnees : null;
  const faire = () => {
    if (!g) return;
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = g.sorte === 'fermer' ? await api('POST', `/console/equipe/sessions/${g.s.id}/fermer`, { motif: motif.trim() })
          : await api('POST', `/console/equipe/appareils/${g.a.id}/oublier`, { motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200) {
          // Sa propre session fermée (ou son appareil oublié) : on sort, la phrase le dit.
          const soi = g.sorte === 'fermer' ? g.s.celleCi : g.a.sessions.some((s) => s.celleCi);
          if (soi) { sortir(phrase('console.ecran.equipe.ap.sorti')); return; }
          toast(phrase(g.sorte === 'fermer' ? 'console.ecran.equipe.ap.ferme_fait' : 'console.ecran.equipe.ap.oublie_fait', { appareil: g.a.nom }));
          setG(null); setMotif(''); setRefus(null); relire();
          return;
        }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const date = (x: string) => `${jourCourt(jourDe(x))}, ${heureDe(x)}`;
  const fenetreGeste = g ? (
    <Dialogue titre={titre(g.sorte === 'fermer' ? 'console.ecran.equipe.ap.fermer_titre' : 'console.ecran.equipe.ap.oublier_titre', { appareil: g.a.nom })} titreDonnee
      sous={lu?.membre.nom ?? membre.nom} sousDonnee fermer={() => { setG(null); setMotif(''); setRefus(null); }} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={() => { setG(null); setMotif(''); setRefus(null); }} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton={g.sorte === 'oublier' ? 'danger' : 'principal'} occupe={occupe} onClick={faire}>{titre(g.sorte === 'fermer' ? 'console.ecran.equipe.ap.fermer_bouton' : 'console.ecran.equipe.ap.oublier_bouton')}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{(g.sorte === 'fermer' ? ['f1', 'f2'] : ['o1', 'o2', 'o3']).map((x) => <li key={x}>{phrase(`console.ecran.equipe.ap.${x}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.equipe.motif_aide')} valeur={motif} changer={setMotif} premier faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  ) : null;
  const liste = (
    <>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {lu && lu.appareils.length === 0 ? <p className="c-attente">{phrase('console.ecran.equipe.ap.aucun')}</p> : null}
      {lu ? (
        <ul className="c-eq-appareils">
          {(enPage && !tous ? lu.appareils.slice(0, APPAREILS_EN_PAGE) : lu.appareils).map((a) => {
            const reconnu = !a.oublieLe && a.reconnuJusquAu && Date.parse(a.reconnuJusquAu) > Date.now();
            return (
              <li key={a.id} className={a.oublieLe ? 'c-eq-appareil-oublie' : undefined}>
                <div className="c-eq-appareil-tete">
                  <span className="c-texte">
                    <b data-donnee>{a.nom}</b>
                    <span className="c-sous">{titre(`console.ecran.equipe.ap.type.${a.type === 'telephone' || a.type === 'bureau' ? a.type : 'navigateur'}`)}{' · '}
                      {a.oublieLe ? dire('console.ecran.equipe.ap.oublie_le', { le: date(a.oublieLe) })
                        : reconnu && a.reconnuJusquAu ? dire('console.ecran.equipe.ap.reconnu', { le: jourCourt(jourDe(a.reconnuJusquAu)) }) : dire('console.ecran.equipe.ap.plus_reconnu')}</span>
                    <span className="c-sous">{dire('console.ecran.equipe.ap.vu', { premier: jourCourt(jourDe(a.premierVu)), dernier: a.dernierVu ? quand(a.dernierVu, lu.aujourdhui) : dire('console.ecran.temps.jamais') })}</span>
                  </span>
                  {a.oublieLe ? <Puce ton="hors">{dire('console.ecran.equipe.ap.oublie')}</Puce>
                    : <Bouton petit onClick={() => setG({ sorte: 'oublier', a })}>{titre('console.ecran.equipe.ap.oublier')}</Bouton>}
                </div>
                {a.sessions.length ? (
                  <ul className="c-eq-sessions">
                    {a.sessions.map((s) => (
                      <li key={s.id}>
                        <span className="c-texte">
                          <b>{s.celleCi ? titre('console.ecran.equipe.ap.celle_ci') : titre('console.ecran.equipe.ap.session')}</b>
                          <span className="c-sous">{dire('console.ecran.equipe.ap.session_dates', { ouverte: date(s.ouverteLe), activite: quand(s.derniereActivite, lu.aujourdhui) })}</span>
                        </span>
                        <Bouton petit onClick={() => setG({ sorte: 'fermer', s, a })}>{titre('console.ecran.equipe.ap.fermer')}</Bouton>
                      </li>
                    ))}
                  </ul>
                ) : !a.oublieLe ? <p className="c-sous c-eq-sessions-aucune">{dire('console.ecran.equipe.ap.aucune_session')}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {enPage && lu && lu.appareils.length > APPAREILS_EN_PAGE ? (
        <span><Bouton petit {...(tous ? {} : { icone: 'bas' as const })} onClick={() => setTous(!tous)}>
          {tous ? titre('console.ecran.compte.a.moins') : maj(selon(lu.appareils.length - APPAREILS_EN_PAGE, 'console.ecran.compte.a.autres'))}
        </Bouton></span>
      ) : null}
    </>
  );
  if (enPage) {
    return (
      <section className="c-carte c-cp-appareils" aria-labelledby="cp-appareils">
        <h2 id="cp-appareils">{titre('console.ecran.compte.a.titre')}</h2>
        <p className="c-sous">{phrase('console.ecran.compte.a.sous')}</p>
        {liste}
        {fenetreGeste}
      </section>
    );
  }
  if (fenetreGeste) return fenetreGeste;
  return (
    <Dialogue titre={titre(lu?.membre.moi ? 'console.ecran.equipe.mes_appareils' : 'console.ecran.equipe.ap.titre')} sous={lu?.membre.nom ?? membre.nom} sousDonnee fermer={() => fermer?.()}
      pied={<Bouton ferme onClick={() => fermer?.()}>{titre('console.ecran.fermer')}</Bouton>}>
      {liste}
      <p className="c-sous">{phrase('console.ecran.equipe.ap.note')}</p>
    </Dialogue>
  );
}

export function Equipe({ vue = null }: { vue?: string | null }) {
  const { moi } = useConsole();
  // Ton compte : la vue de chacun (le support et la technique n'ont qu'elle) ; la direction y vient par son en-tête.
  if (moi.role !== 'direction' || vue === 'moi') return <TonCompte direction={moi.role === 'direction'} />;
  return <LEquipe />;
}

function LEquipe() {
  const { moi } = useConsole();
  const [l, relire] = useLecture<{ membres: Membre[]; droits: Droit[] }>('/console/equipe');
  const [geste, setGeste] = useState<Geste | null>(null);
  const [appareils, setAppareils] = useState<Membre | null>(null);
  const membres = l.etat === 'lu' ? l.donnees.membres : [];
  const actifs = membres.filter((m) => m.actif);
  const retires = membres.filter((m) => !m.actif);
  const par = (r: Role) => actifs.filter((m) => m.role === r).length;
  const enLigne = actifs.filter((m) => m.appareils.length > 0).length;
  const sansCode = actifs.filter((m) => !m.code);
  // Les gestes d'une ligne : le journal de la personne ; et, sur un autre que soi, changer son rôle ou la retirer.
  const actions = (m: Membre): ActionLigne[] => [
    { icone: 'journal', titre: titre(m.moi ? 'console.ecran.equipe.mes_gestes' : 'console.ecran.equipe.ses_gestes'), sous: phrase('console.ecran.equipe.ses_gestes_sous'),
      faire: () => { location.hash = `#/journal?qui=${m.utilisateur}`; } },
    { icone: 'telephone', titre: titre(m.moi ? 'console.ecran.equipe.mes_appareils' : 'console.ecran.equipe.ses_appareils'), sous: phrase('console.ecran.equipe.ses_appareils_sous'),
      faire: () => setAppareils(m) },
    ...(m.moi ? [] : [
      { icone: 'echange', titre: titre('console.ecran.equipe.changer_role'), sous: phrase('console.ecran.equipe.changer_sous'), faire: () => setGeste({ sorte: 'role', m }) },
      { icone: 'sortir', titre: titre('console.ecran.equipe.retirer'), sous: phrase('console.ecran.equipe.retirer_sous'), faire: () => setGeste({ sorte: 'retirer', m }), danger: true },
    ] satisfies ActionLigne[]),
  ];

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.equipe.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.equipe.sous')}</p>
        </div>
        <div className="c-entete-actions">
          <Lien href="#/equipe?vue=moi" icone="personne">{titre('console.ecran.equipe.ton_compte')}</Lien>
          <Lien href="#/journal" icone="journal">{titre('console.ecran.equipe.journal')}</Lien>
          <Bouton ton="principal" icone="plus" onClick={() => setGeste({ sorte: 'ajouter' })}>{titre('console.ecran.equipe.ajouter')}</Bouton>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {l.etat === 'lu' ? (
        <>
          <div className="c-eq-cartes">
            <div className="c-carte c-eq-carte">
              <span className="c-eq-carte-titre">{titre('console.ecran.equipe.membres')}</span>
              <p className="c-eq-carte-n"><b>{actifs.length}</b> <small>{selon(actifs.length, 'console.ecran.equipe.personnes')}</small></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.membres_sous', { d: par('direction'), s: par('support'), t: par('technique') })}</span>
            </div>
            <div className={`c-carte c-eq-carte${sansCode.length ? ' c-eq-carte-attention' : ''}`}>
              <span className="c-eq-carte-titre">
                {titre('console.ecran.equipe.code_titre')}
                {sansCode.length ? <span className="c-eq-etat c-eq-etat-attention"><Icone nom="alerte" taille={14} />{selon(sansCode.length, 'console.ecran.equipe.code_a_mettre')}</span>
                  : actifs.length ? <span className="c-eq-etat"><Icone nom="ok" taille={14} />{dire('console.ecran.equipe.code_tous')}</span> : null}
              </span>
              <p className="c-eq-carte-n"><b>{dire('console.ecran.equipe.code_sur', { avec: actifs.length - sansCode.length, n: actifs.length })}</b></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.code_sous')}</span>
            </div>
            <div className="c-carte c-eq-carte">
              <span className="c-eq-carte-titre">{titre('console.ecran.equipe.en_ligne')}</span>
              <p className="c-eq-carte-n"><b>{enLigne}</b></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.en_ligne_sous')}</span>
            </div>
          </div>
          {sansCode.length ? (
            <section className="c-carte c-eq-regler" aria-labelledby="eq-regler">
              <div className="c-carte-tete">
                <h2 id="eq-regler">{titre('console.ecran.equipe.regler_titre')}</h2>
                <span className="c-eq-etat c-eq-etat-attention">{selon(sansCode.length, 'console.ecran.equipe.a_regler')}</span>
              </div>
              <ul className="c-eq-regler-liste">
                {sansCode.map((m) => (
                  <li key={m.utilisateur}>
                    <span className="c-eq-regler-icone" aria-hidden="true"><Icone nom="telephone" /></span>
                    <span className="c-eq-regler-texte"><b>{dire('console.ecran.equipe.regler_code', { nom: m.nom })}</b><span>{phrase('console.ecran.equipe.sans_code_sous')}</span></span>
                    <Lien href={`mailto:${m.email}?subject=${encodeURIComponent(maj(dire('console.ecran.equipe.rappeler_objet')))}`} petit>{titre('console.ecran.equipe.rappeler')}</Lien>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="c-carte c-liste-carte" aria-labelledby="eq-liste">
            <div className="c-carte-tete c-eq-liste-tete">
              <div>
                <h2 id="eq-liste">{titre('console.ecran.equipe.liste_titre')}</h2>
                <p className="c-carte-sous">{phrase('console.ecran.equipe.liste_sous')}</p>
              </div>
            </div>
            <div className="c-defile">
              <table className="c-table">
                <thead>
                  <tr>
                    <th scope="col">{titre('console.ecran.equipe.colonne.personne')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.role')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.code')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.appareils')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.connexion')}</th>
                    <th scope="col" className="c-droite">{titre('console.ecran.equipe.colonne.gestes')}</th>
                    <th scope="col"><span className="c-cache">{titre('console.ecran.fiche.gestes')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {actifs.map((m) => (
                    <tr key={m.utilisateur}>
                      <td>
                        <div className="c-cellule-nom">
                          <Avatar nom={m.nom} nuit={m.role === 'direction'} />
                          <div><span className="c-nom-ligne"><b data-donnee>{m.nom}</b>{m.moi ? <b className="c-eq-toi">({dire('console.ecran.equipe.toi')})</b> : null}</span><span className="c-sous" data-donnee>{m.email}</span></div>
                        </div>
                      </td>
                      <td><Puce ton={m.role}>{titre(`console.ecran.role.${m.role}`)}</Puce></td>
                      <td>
                        {m.code ? titre(`console.ecran.equipe.code.${m.code}`) : <Puce ton="en_retard">{dire('console.ecran.equipe.code.aucun')}</Puce>}
                        {m.code && m.secours !== undefined ? <span className={`c-sous${m.secours === 0 ? ' c-eq-secours-aucun' : ''}`}>{selon(m.secours, 'console.ecran.equipe.secours')}</span> : null}
                      </td>
                      <td>
                        <button type="button" className="c-lien-bouton" onClick={() => setAppareils(m)} aria-label={titre(m.moi ? 'console.ecran.equipe.mes_appareils' : 'console.ecran.equipe.ses_appareils_de', { nom: m.nom })}>
                          {maj(selon(m.reconnus ?? 0, 'console.ecran.equipe.reconnus'))}
                        </button>
                      </td>
                      <td>
                        {maj(m.derniereConnexion ? quand(m.derniereConnexion, moi.aujourdhui) : dire('console.ecran.temps.jamais'))}
                        {m.appareils.length ? <span className="c-sous">{titre('console.ecran.equipe.ouvert_sur', { appareils: m.appareils.map((a) => a.nom).join(', ') })}</span> : null}
                      </td>
                      <td className="c-droite c-mono">
                        {m.gestes30 ? <a href={`#/journal?qui=${m.utilisateur}`} aria-label={titre('console.ecran.equipe.gestes_de', { nom: m.nom, n: m.gestes30 })}>{m.gestes30}</a> : '—'}
                      </td>
                      <td className="c-droite"><MenuLigne etiquette={titre('console.ecran.equipe.menu', { nom: m.nom })} actions={actions(m)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="c-carte c-liste-carte" aria-labelledby="roles-titre">
            <div className="c-carte-tete c-eq-liste-tete">
              <div>
                <h2 id="roles-titre">{titre('console.ecran.equipe.roles_titre')}</h2>
                <p className="c-carte-sous">{phrase('console.ecran.equipe.roles_sous')}</p>
              </div>
            </div>
            <div className="c-defile">
              <table className="c-table c-eq-droits">
                <thead>
                  <tr>
                    <th scope="col">{titre('console.ecran.equipe.droit.colonne')}</th>
                    {ROLES.map((r) => <th key={r} scope="col" className="c-eq-droit-col">{titre(`console.ecran.role.${r}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {l.donnees.droits.map((d) => (
                    <tr key={d.code}>
                      <td className="c-eq-droit-quoi"><b>{titre(`console.ecran.equipe.droit.${d.code}`)}</b><span className="c-sous">{phrase(`console.ecran.equipe.droit.${d.code}_sous`)}</span></td>
                      {ROLES.map((r) => {
                        const nuance = NUANCES[d.code]?.[r];
                        return (
                          <td key={r}>
                            {!d.roles.includes(r) ? <span className="c-eq-droit-non" aria-label={titre('console.ecran.equipe.droit.non')}>—</span>
                              : nuance ? <span className="c-eq-droit c-eq-droit-nuance"><span aria-hidden="true">–</span>{dire(nuance)}</span>
                                : <span className="c-eq-droit"><Icone nom="ok" taille={15} />{titre('console.ecran.equipe.droit.oui')}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {retires.length ? (
            <section className="c-carte" aria-labelledby="retires-titre">
              <div className="c-carte-tete"><h2 id="retires-titre">{titre('console.ecran.equipe.retires')}</h2></div>
              <ul className="c-personnes">
                {retires.map((m) => (
                  <li key={m.utilisateur}>
                    <Avatar nom={m.nom} />
                    <div className="c-texte"><b data-donnee>{m.nom}</b><span data-donnee>{m.email}</span>
                      <span>{titre(`console.ecran.role.${m.role}`)} · {dire('console.ecran.equipe.retire_le', { le: m.retireLe ? jourCourt(jourDe(m.retireLe)) : '—' })}</span></div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {geste ? <FenetreEquipe g={geste} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
      {appareils ? <SesAppareils membre={appareils} fermer={() => { setAppareils(null); relire(); }} /> : null}
    </>
  );
}
