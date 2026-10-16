// Les paiements de nos factures (serveur/console/routes.ts, GET /console/paiements ; serveur/console/paiements.ts ; 0108 ;
// maquette Paiements ; docs/console.md C30). Un mois à la fois : ce qui est encaissé (le même chiffre que la tuile de
// l'accueil), par moyen ; qui doit encore et qui a trop payé ; les règlements du mois ; à côté, les coûts du mois saisis
// à la main et ce qui reste quand on les retire. La console ne note aucun règlement : il se note dans l'application de
// SkanFact, sur sa facture (l'abonnement suit tout seul) ; chaque ligne y mène. L'écran ne recalcule rien.
import { useEffect, useState, type ReactNode } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import type { Etat } from '../abonnement.ts';
import { montant } from '../argent.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { dans, deMois, jourCourt, jourDe, jourMois, moisEnMots, quand } from '../temps.ts';
import { MoisNav, moisLu, moisVoisin } from '../mois.tsx';
import { Alerte, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import { aNoter, contestationEnMots, FenetreRegulariser, type Contestation } from './Contestations.tsx';

type Qui = { id: string; nom: string };
type Moyen = 'konnect' | 'virement' | 'cheque' | 'autre';
type Recu = {
  id: string; date: string; montant: string; devise: string; mode: string; moyen: Moyen; reference: string | null; numero: string | null;
  entreprise: Qui; noteLe: string; konnect: { prouveLe: string } | null; ecran: string;
};
type Doit = {
  entreprise: Qui; numero: string | null; piece: string; ecran: string; debut: string; fin: string; echeance: string | null;
  devise: string; reste: string; net: string; statut: 'a_payer' | 'en_retard' | 'partielle'; retard: number | null; abonnement: Etat | null;
  paye: string; credite: string;
};
type Trop = { entreprise: Qui; numero: string | null; piece: string; ecran: string; devise: string; trop: string; annulee: boolean };
type AEmettre = { piece: string; debut: string; fin: string; prepareLe: string; entreprise: Qui; ecran: string };
type Cout = { id: string; libelle: string; montant: string; dApres: string; saisiLe: string; saisiPar: string | null; retireLe: string | null; retirePar: string | null };
// Un paiement reçu hors de la plateforme (0113), noté sur une fiche d'après une facture faite ailleurs.
type Hors = { id: string; date: string; montant: string; moyen: 'virement' | 'cheque' | 'especes'; facture: string; entreprise: Qui; noteLe: string; par: string | null };
// Une de nos factures payée, puis défaite (son règlement retiré, un avoir qui l'annule) : l'abonnement a couru sur elle.
type Defaite = { piece: string; numero: string | null; payeeLe: string; debut: string; fin: string; entreprise: Qui; ecran: string; cause: 'avoir' | 'reglement' };
type Donnees = {
  aujourdhui: string; mois: string; courant: boolean;
  editeur: { entreprise: string; raisonSociale: string; devise: string } | null;
  encaisse: { devise: string; total: string; rembourse: string; reglements: number; parMoyen: Record<Moyen, string>; autresDevises: { devise: string; total: string }[] } | null;
  recus: { total: number; lignes: Recu[]; suite: number | null };
  doivent: Doit[]; trop: Trop[]; aEmettre: AEmettre[];
  // `provisoire` (0114) : le mois court encore, ou un coût du mois d'avant (`absents`, par son nom) n'a pas été saisi.
  couts: { lignes: Cout[]; total: string; reste: string | null; n: number; absents: string[]; provisoire: boolean };
  horsPlateforme: { total: number; lignes: Hors[]; suite: number | null };
  defaites: Defaite[];
  // 0129 : les contestations en cours, et celles régularisées depuis quatre-vingt-dix jours.
  contestations: Contestation[];
  // Ce qui doit rentrer (C55) : sans entreprise SkanFact, rien.
  previsions: Previsions | null;
};
type Previsions = {
  devise: string; mois: { mois: string; du: { montant: string; n: number }; prepare: { montantHt: string; n: number }; attendu: { montantHt: string; n: number } }[];
  retard: { montant: string; n: number }; plusTard: { montant: string; n: number }; sansPrix: number; partants: number;
};
const K = 'console.ecran.paiements';
const PAGE = 50;

// Un montant d'une autre devise que le dinar : son code, jamais « DT ».
const enDevise = (t: string, devise: string) => (devise === 'TND' ? montant(t) : `${montant(t).replace(/\u00a0DT$/, '')}\u00a0${devise}`);
const nul = (t: string) => /^-?0+(\.0+)?$/.test(t);

// ── Ce qui doit rentrer (C55) ───────────────────────────────────────────────────────────────────────────────────────
// Trois mois à partir d'aujourd'hui : ce qui reste dû sur nos factures émises (taxes comprises), nos factures préparées
// pas encore émises et les renouvellements qui n'ont pas encore leur facture (hors taxes) — trois lignes par mois, jamais
// une somme : préparer une facture la fait passer d'une ligne à la voisine (l'audit 1.42.0 A05). Ce qui est déjà en
// retard, au-dessus.
function CeQuiDoitRentrer({ p, courant }: { p: Previsions; courant: string }) {
  const P = `${K}.prev`;
  return (
    <section className="c-carte c-pa-prev" aria-labelledby="pa-prev">
      <h2 id="pa-prev">{titre(`${P}.titre`)}</h2>
      <p className="c-carte-sous">{phrase(`${P}.sous`)}</p>
      {p.retard.n ? (
        <p className="c-pa-prev-retard"><Icone nom="alerte" taille={16} /><span>{maj(selon(p.retard.n, `${P}.retard`, { montant: enDevise(p.retard.montant, p.devise) }))}</span></p>
      ) : null}
      {/* Un bloc par mois : trois lignes (émises TTC ; préparées et renouvellements HT), lisibles dans la colonne de côté
          comme au téléphone — jamais une somme des trois. */}
      <div className="c-pa-prev-mois-liste">
        {p.mois.map((m) => (
          <section key={m.mois} className="c-pa-prev-mois" aria-label={maj(dire(`${P}.mois`, { mois: moisEnMots(m.mois, false) }))}>
            <h3>{maj(dire(`${P}.mois`, { mois: moisEnMots(m.mois, false) }))}{m.mois === courant ? <span className="c-sous">{dire(`${P}.en_cours`)}</span> : null}</h3>
            <dl>
              {([
                ['du', enDevise(m.du.montant, p.devise), selon(m.du.n, `${P}.factures`)],
                ['prepare', montant(m.prepare.montantHt), selon(m.prepare.n, `${P}.preparees`)],
                ['attendu', montant(m.attendu.montantHt), selon(m.attendu.n, `${P}.renouvellements`)],
              ] as const).map(([k, v, n]) => (
                <div key={k} className="c-pa-prev-ligne" data-sorte={k}>
                  <dt>{titre(`${P}.col.${k}`)}<span className="c-sous">{n}</span></dt>
                  <dd><b className="c-mono" data-donnee>{v}</b></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {p.plusTard.n ? <p className="c-sous">{maj(selon(p.plusTard.n, `${P}.plus_tard`, { montant: enDevise(p.plusTard.montant, p.devise) }))}</p> : null}
      {p.sansPrix ? <p className="c-sous">{maj(selon(p.sansPrix, `${P}.sans_prix`))}</p> : null}
      {p.partants ? <p className="c-sous">{maj(selon(p.partants, `${P}.partants`))}</p> : null}
      <p className="c-note"><Icone nom="info" />{phrase(`${P}.pas_promesse`)}</p>
    </section>
  );
}

// ── Qui doit encore ─────────────────────────────────────────────────────────────────────────────────────────────────
// Son retard, et ce que devient son abonnement : la grâce et le jour de sa lecture seule disent qui appeler d'abord.
function abonnementEnMots(a: Etat | null, aujourdhui: string): string | null {
  if (!a) return null;
  if (a.etat === 'en_retard') return dire(`${K}.d.grace`, { le: jourCourt(a.lectureSeuleLe), dans: dans(a.lectureSeuleLe, aujourdhui) });
  if (a.etat === 'lecture_seule') return dire(`${K}.d.lecture_seule`, { le: jourCourt(a.depuis) });
  return null;
}
function LigneDoit({ d, aujourdhui, principal }: { d: Doit; aujourdhui: string; principal: boolean }) {
  // Le jour d'abord (en retard, ou à payer avant…), puis ce qui est déjà venu en déduction, puis l'abonnement.
  const enRetard = d.retard !== null && d.retard > 0;
  const etat = [
    enRetard ? selon(d.retard ?? 0, `${K}.d.retard`, { le: jourCourt(d.echeance) }) : d.echeance ? dire(`${K}.d.a_payer`, { le: jourCourt(d.echeance) }) : dire(`${K}.d.a_payer_sans`),
    !nul(d.paye) ? dire(`${K}.d.deja_paye`, { montant: enDevise(d.paye, d.devise), net: enDevise(d.net, d.devise) }) : null,
    !nul(d.credite) ? dire(`${K}.d.avoir`, { montant: enDevise(d.credite, d.devise), net: enDevise(d.net, d.devise) }) : null,
    abonnementEnMots(d.abonnement, aujourdhui),
  ].filter((x): x is string => !!x).join(' · ');
  return (
    <li className={`c-pa-ligne${enRetard ? ' c-pa-ligne-retard' : ''}`}>
      <div className="c-pa-quoi">
        <a href={`#/clients/${d.entreprise.id}`}><b data-donnee>{d.entreprise.nom}</b></a>
        <span className="c-sous">{[d.numero ?? '—', dire(`${K}.d.periode`, { du: jourCourt(d.debut), au: jourCourt(d.fin) })].join(' · ')}</span>
        <span className={`c-pa-etat${enRetard ? ' c-pa-etat-retard' : ''}`}>
          {enRetard ? <Icone nom="alerte" taille={15} /> : <Icone nom="sablier" taille={15} />}{maj(etat)}
        </span>
      </div>
      <div className="c-pa-montant">
        <b className="c-mono" data-donnee>{enDevise(d.reste, d.devise)}</b>
        <span>{dire(`${K}.d.reste`)}</span>
      </div>
      <div className="c-pa-action">
        <Lien href={d.ecran} ailleurs petit {...(principal ? { ton: 'principal' as const } : {})}
          etiquette={titre(`${K}.d.noter_de`, { numero: d.numero ?? '—', nom: d.entreprise.nom })}>{titre(`${K}.d.noter`)}</Lien>
      </div>
    </li>
  );
}

// ── Les règlements du mois ──────────────────────────────────────────────────────────────────────────────────────────
// Konnect se dit avec sa preuve (redemandée au prestataire, jamais une page de retour) ; un remboursement se dit tel.
function moyenEnMots(r: Recu): string {
  if (r.moyen === 'autre') return maj(dire(`${K}.mode.${['especes', 'traite', 'carte', 'en_ligne'].includes(r.mode) ? r.mode : 'autre'}`));
  return titre(`${K}.moyen.${r.moyen}`);
}
function LigneRecu({ r, aujourdhui }: { r: Recu; aujourdhui: string }) {
  const rembourse = r.montant.startsWith('-');
  return (
    <li className="c-pa-recu">
      <time className="c-mono" dateTime={r.date} title={jourCourt(r.date)}>{jourMois(r.date)}</time>
      <div className="c-pa-quoi">
        <a href={`#/clients/${r.entreprise.id}`}><b data-donnee>{r.entreprise.nom}</b></a>
        <span className="c-sous">{r.numero ?? '—'}{r.reference ? <> · <span data-donnee>{r.reference}</span></> : null}</span>
      </div>
      <b className="c-mono c-pa-recu-montant" data-donnee>{enDevise(r.montant, r.devise)}</b>
      <span className={`c-pa-moyen${r.konnect ? ' c-pa-moyen-ok' : ''}`}>
        {r.konnect ? <Icone nom="ok" taille={15} /> : null}
        {rembourse ? titre(`${K}.r.remboursement`) : moyenEnMots(r)}
        {r.konnect ? <span className="c-sous c-bloc">{dire(`${K}.r.konnect_confirme`, { quand: quand(r.konnect.prouveLe, aujourdhui) })}</span> : null}
      </span>
    </li>
  );
}

// ── Les coûts du mois ───────────────────────────────────────────────────────────────────────────────────────────────
function Couts({ d, ajouter, retirer, principal }: { d: Donnees; ajouter: () => void; retirer: (c: Cout) => void; principal: boolean }) {
  const gardes = d.couts.lignes.filter((c) => !c.retireLe);
  const retires = d.couts.lignes.filter((c) => c.retireLe);
  const nom = moisEnMots(d.mois, false);
  return (
    <section className="c-carte c-pa-couts" aria-labelledby="pa-couts">
      <h2 id="pa-couts">{titre(`${K}.c.titre`, { de_mois: deMois(d.mois, false) })}</h2>
      <p className="c-carte-sous">{phrase(`${K}.c.sous`)}</p>
      {gardes.length ? (
        <ul className="c-pa-couts-liste">
          {gardes.map((c) => (
            <li key={c.id}>
              <span className="c-pa-cout-nom" data-donnee>{c.libelle}</span>
              <b className="c-mono" data-donnee>{montant(c.montant)}</b>
              <span className="c-sous" data-donnee>{dire(`${K}.c.d_apres`, { piece: c.dApres })}</span>
              <Bouton petit ton="discret" etiquette={titre(`${K}.c.retirer_de`, { libelle: c.libelle })} onClick={() => retirer(c)}>{titre(`${K}.c.retirer`)}</Bouton>
            </li>
          ))}
        </ul>
      ) : <p className="c-pa-couts-vide">{phrase(`${K}.c.aucun`, { mois: nom })}</p>}
      <div className="c-pa-couts-total">
        <span>{titre(`${K}.c.total`)}</span><b className="c-mono" data-donnee>{montant(d.couts.total)}</b>
      </div>
      {d.encaisse && d.couts.reste === null && !gardes.length ? <p className="c-pa-couts-vide">{phrase(`${K}.c.reste_sans`, { mois: nom })}</p> : null}
      {d.encaisse && d.couts.reste !== null ? (
        <p className={`c-pa-reste${d.couts.reste.startsWith('-') ? ' c-pa-reste-moins' : ''}`}>
          <span>{titre(`${K}.c.reste`, { mois: nom })}{d.couts.provisoire ? <> <Puce ton="a_regarder">{dire(`${K}.c.provisoire`)}</Puce></> : null}</span>
          <b className="c-mono" data-donnee>{montant(d.couts.reste)}</b>
          <span className="c-sous c-bloc">{phrase(`${K}.c.reste_sous`, { encaisse: montant(d.encaisse.total), couts: montant(d.couts.total) })}</span>
          {d.couts.provisoire ? (
            <span className="c-sous c-bloc c-pa-provisoire">
              {[d.courant ? maj(selon(d.couts.n, `${K}.c.provisoire_mois`)) : null,
                d.couts.absents.length ? phrase(`${K}.c.provisoire_absents`, { liste: d.couts.absents.join(', ') }) : null].filter(Boolean).join(' ')}
            </span>
          ) : null}
        </p>
      ) : null}
      <Bouton large icone="plus" onClick={ajouter} {...(principal ? { ton: 'principal' as const } : {})}>{titre(`${K}.c.ajouter`)}</Bouton>
      {retires.length ? (
        <details className="c-pa-retires">
          <summary><Icone nom="droite" taille={14} />{maj(selon(retires.length, `${K}.c.retires`))}</summary>
          <ul>
            {retires.map((c) => (
              <li key={c.id}><del data-donnee>{c.libelle}</del> <span className="c-mono" data-donnee>{montant(c.montant)}</span>
                <span className="c-sous c-bloc">{dire(`${K}.c.retire_par`, { qui: c.retirePar ?? '—', le: c.retireLe ? jourCourt(jourDe(c.retireLe)) : '—' })}</span></li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// Saisir un coût : le mois (celui de l'écran par défaut), son nom, son montant toutes taxes comprises, et d'après quelle
// facture reçue (le motif du journal). Chaque case refusée se montre.
function FenetreCout({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [mois, setMois] = useState(d.mois);
  const [libelle, setLibelle] = useState('');
  const [tape, setTape] = useState('');
  const [dApres, setDApres] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const courant = d.aujourdhui.slice(0, 7);
  const choix = Array.from({ length: 12 }, (_, i) => moisVoisin(courant, -i));
  const refuser = (champ: string, cle: string) => { setRefus(phrase(cle)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (libelle.trim().length < 2 || libelle.trim().length > 80) { refuser('libelle', `${K}.g.libelle_illisible`); return; }
    if (!/^\s*\d[\d\s]*([.,]\d{1,3})?\s*$/.test(tape) || !/[1-9]/.test(tape)) { refuser('montant', `${K}.g.montant_illisible`); return; }
    if (dApres.trim().length < 3) { refuser('dApres', `${K}.g.d_apres_court`); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/paiements/couts', { mois, libelle: libelle.trim(), montant: tape, dApres: dApres.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.g.fait`, { mois: moisEnMots(mois) })); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setFaute((f) => ({ champ: r.corps.champ as string, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  return (
    <Dialogue titre={titre(`${K}.g.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${K}.g.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.${p}`, { de_mois: deMois(mois) })}</li>)}</ul>
      </div>
      <Champ libelle={titre(`${K}.g.libelle`)} aide={phrase(`${K}.g.libelle_aide`)} valeur={libelle} changer={setLibelle} premier autoComplete="off" {...fauteDe('libelle')} />
      <Champ libelle={titre(`${K}.g.montant`)} aide={phrase(`${K}.g.montant_aide`)} inputMode="decimal" autoComplete="off" valeur={tape} changer={setTape} {...fauteDe('montant')} />
      <Champ libelle={titre(`${K}.g.d_apres`)} aide={phrase(`${K}.g.d_apres_aide`)} valeur={dApres} changer={setDApres} autoComplete="off" {...fauteDe('dApres')} />
      <Choix libelle={titre(`${K}.g.mois`)} aide={phrase(`${K}.g.mois_aide`)} valeur={mois} changer={setMois} options={choix.map((m) => ({ valeur: m, texte: maj(moisEnMots(m)) }))} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRetirer({ c, mois, fermer, fait }: { c: Cout; mois: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', `/console/paiements/couts/${c.id}/retirer`, { motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200) { toast(phrase(`${K}.gr.fait`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.gr.titre`)} sous={`${c.libelle} · ${montant(c.montant)}`} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${K}.gr.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.gr.${p}`, { de_mois: deMois(mois) })}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.gr.motif_aide`)} valeur={motif} changer={setMotif} premier faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Paiements({ mois: moisDemande }: { mois: string | null }) {
  const { moi } = useConsole();
  const courant = moi.aujourdhui.slice(0, 7);
  const [mois, setMois] = useState(moisLu(moisDemande, courant));
  const [debut, setDebut] = useState(0);
  const [debutHors, setDebutHors] = useState(0);
  const [fenetre, setFenetre] = useState<{ sorte: 'cout' } | { sorte: 'retirer'; c: Cout } | { sorte: 'regulariser'; c: Contestation } | null>(null);
  useEffect(() => { setMois(moisLu(moisDemande, courant)); setDebut(0); setDebutHors(0); }, [moisDemande]);
  useEffect(() => { history.replaceState(null, '', `#/paiements${mois === courant ? '' : `?mois=${mois}`}`); }, [mois]);
  const [l, relire] = useLecture<Donnees>(`/console/paiements?mois=${mois}&limite=${PAGE}&debut=${debut}&debutHors=${debutHors}`, 'paiements');
  const d = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = d?.aujourdhui ?? moi.aujourdhui;
  const aller = (m: string) => { setMois(m); setDebut(0); setDebutHors(0); };
  const fait = () => { setFenetre(null); relire(); };
  // L'étape suivante, calculée : noter le règlement le plus en retard ; sinon, saisir les coûts d'un mois qui n'en a pas.
  const premierDoit = d?.doivent[0] ?? null;
  const coutsAFaire = !!d && !premierDoit && !d.couts.lignes.some((c) => !c.retireLe);
  const nomMois = moisEnMots(d?.mois ?? mois);
  const e = d?.encaisse ?? null;
  const tuiles: [Moyen, string][] = e ? (['konnect', 'virement', 'cheque', 'autre'] as const)
    .filter((m) => m !== 'autre' || !nul(e.parMoyen.autre)).map((m) => [m, e.parMoyen[m]]) : [];
  const section = (id: string, t: ReactNode, sous: ReactNode, corps: ReactNode, n?: number) => (
    <section className="c-carte c-liste-carte" aria-labelledby={id}>
      <div className="c-carte-tete c-liste-tete">
        <div>
          <h2 id={id}>{t}{n !== undefined ? <> <span className="c-compte-titre">{n}</span></> : null}</h2>
          <p className="c-carte-sous">{sous}</p>
        </div>
      </div>
      {corps}
    </section>
  );

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
        <MoisNav mois={mois} courant={courant} aller={aller} />
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          {!d.editeur ? (
            <Alerte ton="info"><span>{phrase(`${K}.sans_editeur`)}</span><span><Lien petit href="#/reglages?onglet=factures">{titre(`${K}.sans_editeur_lien`)}</Lien></span></Alerte>
          ) : null}
          {e ? (
            <section className="c-pa-bande" aria-labelledby="pa-encaisse">
              <div className="c-pa-bande-texte">
                <h2 id="pa-encaisse">{titre(d.courant ? `${K}.e.titre_courant` : `${K}.e.titre`, { mois: moisEnMots(d.mois, false), jour: Number(aujourdhui.slice(8, 10)) })}</h2>
                <p className="c-pa-bande-total c-mono" data-donnee>{montant(e.total)}</p>
                <p className="c-pa-bande-sous">
                  {e.reglements ? maj(selon(e.reglements, `${K}.e.reglements`)) : maj(dire(`${K}.e.aucun`, { mois: moisEnMots(d.mois, false) }))}
                  {!nul(e.rembourse) ? ` · ${dire(`${K}.e.rembourse`, { montant: montant(e.rembourse) })}` : ''}
                  {e.autresDevises.length ? ` · ${dire(`${K}.e.autres_devises`, { liste: e.autresDevises.map((a) => enDevise(a.total, a.devise)).join(', ') })}` : ''}
                  {'. '}{phrase(d.courant ? `${K}.e.sous` : `${K}.e.sous_passe`)}
                </p>
              </div>
              <ul className="c-pa-moyens" aria-label={titre(`${K}.e.par_moyen`)}>
                {tuiles.map(([m, v]) => (
                  <li key={m}><span>{titre(`${K}.e.par.${m}`)}</span><b className="c-mono" data-donnee>{montant(v)}</b></li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="c-ab-corps">
            <div className="c-pa-gauche">
              {section('pa-doivent', titre(`${K}.d.titre`), phrase(`${K}.d.sous`), (
                <>
                  {d.aEmettre.length ? (
                    <div className="c-pa-emettre">
                      <p><Icone nom="info" taille={16} />{maj(selon(d.aEmettre.length, `${K}.d.a_emettre`))}</p>
                      <ul>
                        {d.aEmettre.map((a) => (
                          <li key={a.piece}>
                            <a href={`#/clients/${a.entreprise.id}`} data-donnee>{a.entreprise.nom}</a>
                            <span className="c-sous">{dire(`${K}.d.periode`, { du: jourCourt(a.debut), au: jourCourt(a.fin) })}</span>
                            <Lien href={a.ecran} ailleurs petit etiquette={titre(`${K}.d.emettre_de`, { nom: a.entreprise.nom })}>{titre(`${K}.d.emettre`)}</Lien>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {d.doivent.length ? (
                    <ol className="c-pa-lignes">{d.doivent.map((x, i) => <LigneDoit key={x.piece} d={x} aujourdhui={aujourdhui} principal={i === 0} />)}</ol>
                  ) : <Vide icone="ok">{phrase(d.editeur ? `${K}.d.vide` : `${K}.d.vide_sans_editeur`)}</Vide>}
                </>
              ), d.doivent.length)}
              {/* Les contestations (0129) : en cours d'abord, avec le geste qui les régularise ; puis les régularisées, et comment. */}
              {d.contestations.length ? section('pa-contestations', titre(`${K}.ct.titre`), phrase(`${K}.ct.sous`), (
                <ol className="c-pa-lignes">
                  {d.contestations.map((c) => (
                    <li key={c.id} className="c-pa-ligne">
                      <div className="c-pa-quoi">
                        <a href={`#/clients/${c.entreprise.id}?onglet=factures`}><b data-donnee>{c.entreprise.nom}</b></a>
                        <span className="c-sous">{c.numero ?? '—'} · <span className={c.close && !aNoter(c) ? undefined : 'c-ct-en-cours'}>{contestationEnMots(c)}</span></span>
                        <span className="c-sous c-ct-dit-ligne" data-donnee>« {c.dit} »</span>
                      </div>
                      <div className="c-pa-action">
                        {c.close ? <Puce ton="hors">{titre(`console.ecran.contestation.issue.${c.close.issue}`)}</Puce>
                          : <Bouton petit onClick={() => setFenetre({ sorte: 'regulariser', c })}>{titre('console.ecran.contestation.regulariser')}</Bouton>}
                      </div>
                    </li>
                  ))}
                </ol>
              ), d.contestations.filter((c) => !c.close).length) : null}
              {d.trop.length ? section('pa-trop', titre(`${K}.t.titre`), phrase(`${K}.t.sous`), (
                <ol className="c-pa-lignes">
                  {d.trop.map((x) => (
                    <li key={x.piece} className="c-pa-ligne">
                      <div className="c-pa-quoi">
                        <a href={`#/clients/${x.entreprise.id}`}><b data-donnee>{x.entreprise.nom}</b></a>
                        <span className="c-sous">{x.numero ?? '—'} · {dire(x.annulee ? `${K}.t.annulee` : `${K}.t.trop`)}</span>
                      </div>
                      <div className="c-pa-montant"><b className="c-mono" data-donnee>{enDevise(x.trop, x.devise)}</b><span>{dire(`${K}.t.en_trop`)}</span></div>
                      <div className="c-pa-action">
                        <Lien href={x.ecran} ailleurs petit etiquette={titre(`${K}.t.ouvrir_de`, { numero: x.numero ?? '—', nom: x.entreprise.nom })}>{titre(`${K}.t.ouvrir`)}</Lien>
                      </div>
                    </li>
                  ))}
                </ol>
              ), d.trop.length) : null}
              {d.defaites.length ? section('pa-defaites', titre(`${K}.defaites.titre`), phrase(`${K}.defaites.sous`), (
                <ol className="c-pa-lignes">
                  {d.defaites.map((x) => (
                    <li key={x.piece} className="c-pa-ligne">
                      <div className="c-pa-quoi">
                        <a href={`#/clients/${x.entreprise.id}?onglet=factures`}><b data-donnee>{x.entreprise.nom}</b></a>
                        <span className="c-sous">{x.numero ?? '—'} · {dire(`${K}.defaites.ligne_${x.cause}`, { le: jourCourt(jourDe(x.payeeLe)), fin: jourCourt(x.fin) })}</span>
                      </div>
                      <div className="c-pa-action">
                        <Lien href={x.ecran} ailleurs petit etiquette={titre(`${K}.t.ouvrir_de`, { numero: x.numero ?? '—', nom: x.entreprise.nom })}>{titre(`${K}.t.ouvrir`)}</Lien>
                      </div>
                    </li>
                  ))}
                </ol>
              ), d.defaites.length) : null}
              {section('pa-recus', titre(`${K}.r.titre`, { mois: moisEnMots(d.mois, false) }), phrase(`${K}.r.sous`), (
                d.recus.total === 0 ? <Vide icone="calendrier">{phrase(`${K}.r.vide`, { mois: nomMois })}</Vide> : (
                  <>
                    <ol className="c-pa-recus">{d.recus.lignes.map((r) => <LigneRecu key={r.id} r={r} aujourdhui={aujourdhui} />)}</ol>
                    {d.recus.total > PAGE ? (
                      <div className="c-liste-pied">
                        <span>{phrase('console.ecran.clients.page', { debut: debut + 1, fin: debut + d.recus.lignes.length, total: d.recus.total })}</span>
                        <span className="c-liste-pied-boutons">
                          <Bouton petit desactive={debut === 0} onClick={() => setDebut(Math.max(0, debut - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                          <Bouton petit desactive={d.recus.suite === null} onClick={() => { if (d.recus.suite !== null) setDebut(d.recus.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                        </span>
                      </div>
                    ) : null}
                  </>
                )
              ), d.recus.total)}
              {d.horsPlateforme.total ? section('pa-hors', titre(`${K}.hors.titre`), phrase(`${K}.hors.sous`), (
                <>
                  <ol className="c-pa-recus">
                    {d.horsPlateforme.lignes.map((h) => (
                      <li key={h.id} className="c-pa-recu">
                        <time className="c-mono" dateTime={h.date} title={jourCourt(h.date)}>{jourMois(h.date)}</time>
                        <div className="c-pa-quoi">
                          <a href={`#/clients/${h.entreprise.id}`}><b data-donnee>{h.entreprise.nom}</b></a>
                          <span className="c-sous"><span data-donnee>{h.facture}</span>{h.par ? <> · {dire(`${K}.hors.par`, { qui: h.par })}</> : null}</span>
                        </div>
                        <b className="c-mono c-pa-recu-montant" data-donnee>{montant(h.montant)}</b>
                        <span className="c-pa-moyen">{titre(`console.ecran.geste.recu.moyen.${h.moyen}`)}</span>
                      </li>
                    ))}
                  </ol>
                  {d.horsPlateforme.total > PAGE ? (
                    <div className="c-liste-pied">
                      <span>{phrase('console.ecran.clients.page', { debut: debutHors + 1, fin: debutHors + d.horsPlateforme.lignes.length, total: d.horsPlateforme.total })}</span>
                      <span className="c-liste-pied-boutons">
                        <Bouton petit desactive={debutHors === 0} onClick={() => setDebutHors(Math.max(0, debutHors - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                        <Bouton petit desactive={d.horsPlateforme.suite === null} onClick={() => { if (d.horsPlateforme.suite !== null) setDebutHors(d.horsPlateforme.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                      </span>
                    </div>
                  ) : null}
                </>
              ), d.horsPlateforme.total) : null}
            </div>
            <aside className="c-ab-cote" aria-label={titre(`${K}.cote`)}>
              {d.previsions ? <CeQuiDoitRentrer p={d.previsions} courant={aujourdhui.slice(0, 7)} /> : null}
              <Couts d={d} principal={coutsAFaire} ajouter={() => setFenetre({ sorte: 'cout' })} retirer={(c) => setFenetre({ sorte: 'retirer', c })} />
              <p className="c-note"><Icone nom="info" />{phrase(`${K}.note`)}</p>
            </aside>
          </div>
          {fenetre?.sorte === 'cout' ? <FenetreCout d={d} fermer={() => setFenetre(null)} fait={fait} /> : null}
          {fenetre?.sorte === 'retirer' ? <FenetreRetirer c={fenetre.c} mois={d.mois} fermer={() => setFenetre(null)} fait={fait} /> : null}
          {fenetre?.sorte === 'regulariser' ? <FenetreRegulariser c={fenetre.c} fermer={() => setFenetre(null)} fait={fait} /> : null}
        </>
      ) : null}
    </>
  );
}
