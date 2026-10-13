// La fiche d'un client (serveur/console/routes.ts, GET /console/entreprises/:id ; 0083, console_entreprise) : qui il est,
// son abonnement et son histoire (chaque geste, son motif, son auteur), les gestes que ton rôle permet AUJOURD'HUI, ses
// membres, et des comptes. La liste fermée de la console (10 § 4) : jamais le contenu d'un dossier.
//
// Recalée sur sa maquette (docs/console.md C21) : « Ce qui attend, pour ce client » en tête (les lignes d'« À décider »
// qui le nomment, par la même fonction, avec le geste qui y répond), puis des onglets — l'aperçu (son entreprise, ses
// comptes, à qui parler, son cabinet), l'abonnement, les membres, le journal de son abonnement.
//
// Un geste (10 § 2.4) passe par sa fenêtre : ses paramètres, son motif, puis l'APERÇU de l'état d'après (le serveur le
// calcule par la même règle que le geste, sans rien écrire), et seulement alors le geste. La ligne d'abonnement lue
// part avec lui : changée entre-temps, le serveur refuse au lieu d'écraser (01 R15), et la fiche se relit.
import { useEffect, useRef, useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { abonnementEnMots, expliquer, offreEtPeriode, puceDe, type Etat, type Faits, type Offre, type Periodicite } from '../abonnement.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { dans, jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, Puce, toast, Vide, Zone, type NomIcone, type TonPuce } from '../ui.tsx';
import { organisationEnMots } from './Clients.tsx';
import type { Place } from './Cabinets.tsx';

type Geste = 'prolonger' | 'payer' | 'resilier' | 'annuler-resiliation' | 'suspendre' | 'reprendre' | 'offrir' | 'retirer-offert';
type LigneAbo = { essai_jusqu_au: string; paye_jusqu_au: string | null; offre: Offre | null; periodicite: Periodicite | null; resilie_le: string | null; suspendu_le: string | null; offert: boolean };
type Membre = { nom: string; email: string; roles: string[]; depuis: string; derniereConnexion: string | null };
type CabinetDe = { id: string; nom: string; place: Place; mandat: { statut: 'propose' | 'actif'; debut: string } | null };
type Evenement = { id: string; le: string; nature: string; par: 'systeme' | 'exploitation'; motif: string | null; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; qui: { nom: string; role: Role } | null };
type Donnees = {
  aujourdhui: string; id: string; raisonSociale: string; matricule: string | null; formeJuridique: string | null; active: boolean; devise: string; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null; faits: Faits; ligne: LigneAbo | null; etat: Etat; gestes: Geste[];
  membres: Membre[]; comptes: { etablissements: number; caisses: number; salaries: number; piecesCreees: number; piecesEmises: { mois: string; n: number }[] };
  prolongeDejaUneFois: boolean; evenements: Evenement[]; cabinets: CabinetDe[]; attend: Attente[];
};
// Les lignes d'« À décider » qui nomment ce client (serveur/console/decider.ts, aDecider) : celles d'un client seulement.
type Attente =
  | { sorte: 'en_retard'; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { sorte: 'lecture_seule'; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' }
  | { sorte: 'essai_sans_usage'; jusquAu: string; jours: number; proprietaire: { nom: string; email: string } | null };
export type OngletFiche = 'apercu' | 'abonnement' | 'membres' | 'journal';
export const ONGLETS_FICHE: readonly OngletFiche[] = ['apercu', 'abonnement', 'membres', 'journal'];

const cleGeste = (g: Geste) => g.replace('-', '_');

// Ce qu'un geste a changé, case par case (« essai jusqu'au : 12/10/2026 → 26/10/2026 ») : les cases d'une ligne
// d'abonnement, et ce que le geste retient (les jours ajoutés, la période payée).
const CASES = ['essai_jusqu_au', 'paye_jusqu_au', 'offre', 'periodicite', 'resilie_le', 'suspendu_le', 'offert', 'role', 'actif', 'jours', 'debut', 'fin'] as const;
function valeurLisible(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return dire(v ? 'console.ecran.fiche.oui' : 'console.ecran.fiche.non');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return jourCourt(v);
  if (cle === 'offre' && (v === 'essentiel' || v === 'complet')) return dire(`console.ecran.abo.offre.${v}`);
  if (cle === 'periodicite' && (v === 'annuel' || v === 'mensuel')) return dire(`console.ecran.abo.periodicite.${v}`);
  if (cle === 'role' && typeof v === 'string') return titre(`console.ecran.role.${v}`);
  return String(v);
}
// Les premiers événements (0082) écrivent leurs cases à la façon de l'API (« essaiJusquAu ») : on les lit comme celles
// d'une ligne (« essai_jusqu_au »).
const casesDe = (o: Record<string, unknown> | null) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`), v])) : null);
// `empile` (le journal, sa maquette) : chaque case sur ses lignes — son nom, la valeur d'avant barrée (s'il y en avait
// une), la nouvelle dessous ; jamais « — → … » pour une case qui était vide.
export function Changements({ avant: avantBrut, apres: apresBrut, empile }: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; empile?: boolean }) {
  const avant = casesDe(avantBrut), apres = casesDe(apresBrut);
  const a = avant ?? {}, b = apres ?? {};
  const lignes = CASES.filter((c) => c in b && (avant === null ? b[c] !== null && b[c] !== false : a[c] !== b[c]) && !(c === 'actif' && b.actif === true && avant === null));
  if (!lignes.length) return null;
  if (empile) {
    return (
      <span className="c-changes c-changes-empile">
        {lignes.map((c) => (
          <span key={c} className="c-change">
            <span className="c-change-champ">{titre(`console.ecran.champ.${c}`)}</span>
            {avant !== null && a[c] !== null && a[c] !== undefined ? <del data-donnee>{valeurLisible(c, a[c])}</del> : null}
            <ins data-donnee>{valeurLisible(c, b[c])}</ins>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="c-changes">
      {lignes.map((c) => (
        <span key={c} className="c-change">
          {titre(`console.ecran.champ.${c}`)} : {c in a && avant !== null ? <><del data-donnee>{valeurLisible(c, a[c])}</del> → </> : null}<ins data-donnee>{valeurLisible(c, b[c])}</ins>
        </span>
      ))}
    </span>
  );
}

// ── La fenêtre d'un geste ───────────────────────────────────────────────────────────────────────────────────────────
type Apercu = { avant: Etat; apres: Etat; details: Record<string, unknown> };
function FenetreGeste({ geste, fiche, role, fermer, fait }: { geste: Geste; fiche: Donnees; role: Role; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const support = role === 'support';
  const [jours, setJours] = useState(support ? '14' : '30');
  const [offre, setOffre] = useState<Offre>(fiche.faits.offre ?? 'essentiel');
  const [periodicite, setPeriodicite] = useState<Periodicite>(fiche.faits.periodicite ?? 'annuel');
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [perimee, setPerimee] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [faute, setFaute] = useState(0);
  const min = support ? 7 : 1, max = support ? 30 : 365;
  const n = Number(jours);
  const joursValides = geste !== 'prolonger' || (Number.isInteger(n) && n >= min && n <= max);
  const chemin = `/console/entreprises/${fiche.id}/abonnement/${geste}`;
  const corps = (apercuSeul: boolean) => ({
    motif, ligne: fiche.ligne, ...(apercuSeul ? { apercu: true } : {}),
    ...(geste === 'prolonger' ? { jours: n } : {}), ...(geste === 'payer' ? { offre, periodicite } : {}),
  });

  // L'aperçu se recalcule à chaque changement de paramètre : c'est le serveur qui le dit (la même règle que le geste).
  const tour = useRef(0);
  useEffect(() => {
    if (!joursValides) { setApercu(null); return; }
    const t = ++tour.current;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<Apercu & { apercu: boolean }>('POST', chemin, corps(true));
          if (!r || t !== tour.current) return;
          if (r.statut === 200) { setApercu(r.corps); setRefus(null); } else { setApercu(null); setRefus(refusDe(r)); setPerimee(r.statut === 409); }
        } catch (x) { if (t === tour.current) setRefus(panneDe(x)); }
      })();
    }, 250);
    return () => clearTimeout(minuteur);
  }, [jours, offre, periodicite, geste]);

  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ fait: boolean }>('POST', chemin, corps(false));
        if (!r) return;
        if (r.statut === 200) { toast(phrase('console.ecran.geste.fait', { geste: dire(`console.ecran.journal.g.abonnement.${cleGeste(geste)}`) })); fait(); return; }
        setRefus(refusDe(r));
        setPerimee(r.statut === 409);
        if (r.corps.champ === 'motif') setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };

  const nom = titre(`console.ecran.geste.${cleGeste(geste)}`);
  const sous = phrase(geste === 'prolonger' && support ? 'console.ecran.geste.sous.prolonger_support' : `console.ecran.geste.sous.${cleGeste(geste)}`);
  const cote = (etiquette: string, e: Etat) => {
    const p = puceDe(e);
    return (
      <div className="c-apercu-cote">
        <span>{etiquette}</span>
        <Puce ton={p.ton}>{p.texte}</Puce>
        <small>{expliquer(e, fiche.aujourdhui)}</small>
      </div>
    );
  };
  const details = apercu?.details ?? {};
  return (
    <Dialogue titre={nom} sous={sous} fermer={fermer} occupe={occupe}
      pied={perimee
        ? <><Bouton onClick={fermer}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" onClick={fait}>{titre('console.ecran.geste.relire')}</Bouton></>
        : <><Bouton onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" occupe={occupe} desactive={!apercu} onClick={faire}>{nom}</Bouton></>}>
      {geste === 'prolonger' ? (
        <Champ libelle={titre('console.ecran.geste.jours')} aide={dire('console.ecran.geste.jours_aide', { min, max })} type="number" inputMode="numeric" min={min} max={max} valeur={jours} changer={setJours} />
      ) : null}
      {geste === 'payer' ? (
        <div className="c-champs-2">
          <Choix libelle={titre('console.ecran.geste.offre')} valeur={offre} changer={(v) => setOffre(v as Offre)}
            options={(['essentiel', 'complet'] as const).map((o) => ({ valeur: o, texte: dire(`console.ecran.abo.offre.${o}`) }))} />
          <Choix libelle={titre('console.ecran.geste.periodicite')} valeur={periodicite} changer={(v) => setPeriodicite(v as Periodicite)}
            options={(['annuel', 'mensuel'] as const).map((p) => ({ valeur: p, texte: titre(`console.ecran.abo.periodicite.${p}`) }))} />
        </div>
      ) : null}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre('console.ecran.geste.apercu')}</span>
        {/* L'aperçu garde sa place quoi qu'il dise (le calcul, un refus, des jours hors des bornes) : le motif, dessous,
            ne bouge pas pendant qu'on tape le nombre de jours, et le clic suivant tombe là où on le vise. */}
        <div className="c-apercu-zone">
        {!joursValides ? (
          <p className="c-apercu-attente c-apercu-refus">{phrase(support ? 'console.ecran.geste.jours_hors_support' : 'console.ecran.geste.jours_hors', { min, max })}</p>
        ) : apercu ? (
          <div className="c-apercu">
            {cote(titre('console.ecran.geste.avant'), apercu.avant)}
            <span className="c-fleche"><Icone nom="fleche" /></span>
            {cote(titre('console.ecran.geste.apres'), apercu.apres)}
            {typeof details.debut === 'string' && typeof details.fin === 'string'
              ? <span className="c-apercu-details">{phrase('console.ecran.geste.periode', { debut: jourCourt(details.debut), fin: jourCourt(details.fin) })}</span> : null}
            {typeof details.jours === 'number' ? <span className="c-apercu-details">{phrase('console.ecran.geste.ajoute', { n: details.jours })}</span> : null}
          </div>
        ) : refus ? <p className="c-apercu-attente c-apercu-refus">{refus}</p>
          : <p className="c-apercu-attente">{phrase('console.ecran.geste.apercu_calcul')}</p>}
        </div>
      </div>
      {/* Un refus du geste (le motif trop court) se retire dès qu'on corrige le motif : il ne dit plus vrai. Celui de l'aperçu
          (sans aperçu) reste : il ne dépend pas du motif. */}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.geste.motif_aide')} valeur={motif} changer={(v) => { setMotif(v); if (apercu) setRefus(null); }} faute={faute > 0} n={faute} />
      {refus && apercu ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Le menu des gestes ──────────────────────────────────────────────────────────────────────────────────────────────
function MenuGestes({ gestes, choisir, raison }: { gestes: Geste[]; choisir: (g: Geste) => void; raison: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const ailleurs = (e: MouseEvent) => { if (!zone.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', ailleurs);
    document.addEventListener('keydown', echap);
    zone.current?.querySelector<HTMLElement>('.c-menu-liste button')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', ailleurs); document.removeEventListener('keydown', echap); };
  }, [ouvert]);
  return (
    <div className="c-menu" ref={zone}>
      {/* Jamais vert : le vert de la fiche est l'étape suivante, dans « Ce qui attend » (sa maquette). Sans geste permis, le
          menu ne fait que dire pourquoi. */}
      <button type="button" className="c-btn c-fiche-gestes" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
        {titre('console.ecran.fiche.gestes')}<Icone nom="bas" taille={17} />
      </button>
      {ouvert ? (
        <div className="c-menu-liste">
          <p className="c-menu-note">{gestes.length ? phrase('console.ecran.fiche.gestes_aide') : raison}</p>
          {gestes.map((g) => (
            <button key={g} type="button" onClick={() => { setOuvert(false); choisir(g); }}>{titre(`console.ecran.geste.${cleGeste(g)}`)}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── La fiche ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Fiche({ id, onglet: ongletDemande }: { id: string; onglet: string | null }) {
  const { moi, relireDecisions } = useConsole();
  const [l, relire] = useLecture<Donnees>(`/console/entreprises/${encodeURIComponent(id)}`, id);
  const [geste, setGeste] = useState<Geste | null>(null);
  if (l.etat === 'lecture') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  if (l.etat === 'panne') {
    return (
      <>
        <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}><a href="#/clients">{titre('console.ecran.fiche.retour')}</a></nav>
        {l.statut === 404 ? (
          <section className="c-carte c-liste-carte">
            <Vide icone="chercher"><span>{phrase('console.ecran.fiche.introuvable')}</span> <Lien href="#/clients" petit>{titre('console.ecran.fiche.vers_liste')}</Lien></Vide>
          </section>
        ) : <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>}
      </>
    );
  }
  const f = l.donnees;
  const onglet: OngletFiche = ONGLETS_FICHE.includes(ongletDemande as OngletFiche) ? ongletDemande as OngletFiche : 'apercu';
  const puce = puceDe(f.etat);
  const proprietaires = f.membres.filter((m) => m.roles.includes('proprietaire'));
  const premier = proprietaires[0] ?? null;
  const tient = f.cabinets.find((c) => c.place === 'tenu');
  const raisonSansGeste = f.faits.tenuParCabinet ? phrase('console.ecran.fiche.sans_geste.cabinet') : phrase('console.ecran.fiche.sans_geste.support');
  const emises = f.comptes.piecesEmises;
  const douzeMois = derniersMois(f.aujourdhui).map((mois) => ({ mois, n: emises.find((x) => x.mois === mois)?.n ?? 0 }));
  const totalEmises = douzeMois.reduce((s, x) => s + x.n, 0);
  const plusHaut = Math.max(1, ...douzeMois.map((x) => x.n));
  const faits: [string, string][] = f.ligne ? [
    [titre('console.ecran.fiche.f.essai'), jourCourt(f.ligne.essai_jusqu_au)],
    [titre('console.ecran.fiche.f.paye'), jourCourt(f.ligne.paye_jusqu_au)],
    [titre('console.ecran.fiche.f.offre'), f.ligne.offre && f.ligne.periodicite ? offreEtPeriode(f.ligne.offre, f.ligne.periodicite) : '—'],
    [titre('console.ecran.fiche.f.resilie'), jourCourt(f.ligne.resilie_le)],
    [titre('console.ecran.fiche.f.suspendu'), jourCourt(f.ligne.suspendu_le)],
    [titre('console.ecran.fiche.f.offert'), titre(f.ligne.offert ? 'console.ecran.fiche.oui' : 'console.ecran.fiche.non')],
  ] : [];
  const ecrire = (m: { email: string }) => `mailto:${m.email}`;
  // L'onglet vit dans l'adresse : « précédent » y revient, un lien d'ailleurs peut y mener.
  const versOnglet = (o: OngletFiche) => `#/clients/${f.id}${o === 'apercu' ? '' : `?onglet=${o}`}`;
  const onglets: { o: OngletFiche; n?: number }[] = [{ o: 'apercu' }, { o: 'abonnement' }, { o: 'membres', n: f.membres.length }, { o: 'journal', n: f.evenements.length }];
  // Le geste qui répond à une ligne de « Ce qui attend » : encaisser quand le rôle le permet, sinon prolonger ; écrire au
  // propriétaire d'un essai qui n'a pas servi. Le premier est vert : c'est l'étape suivante.
  const reponse = (a: Attente): { texte: string; geste?: Geste; href?: string } | null => {
    if (a.sorte === 'essai_sans_usage') return a.proprietaire ? { texte: titre('console.ecran.fiche.attend.ecrire', { nom: a.proprietaire.nom }), href: ecrire(a.proprietaire) } : null;
    const g = f.gestes.includes('payer') ? 'payer' : f.gestes.includes('prolonger') ? 'prolonger' : null;
    return g ? { texte: titre(`console.ecran.geste.${cleGeste(g)}`), geste: g } : null;
  };

  return (
    <>
      <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}>
        <a href="#/clients">{titre('console.ecran.fiche.retour')}</a><Icone nom="droite" taille={14} /><span data-donnee>{f.raisonSociale}</span>
      </nav>
      <header className="c-entete">
        <div className="c-entete-texte">
          <div className="c-titre-ligne"><h1 data-donnee>{f.raisonSociale}</h1><Puce ton={puce.ton}>{puce.texte}</Puce></div>
          <p className="c-entete-sous">{maj(organisationEnMots(f.organisation))} · {dire('console.ecran.fiche.inscrite', { le: jourCourt(f.creeLe) })}{premier ? <> · <span data-donnee>{premier.nom}</span></> : null}</p>
        </div>
        <div className="c-entete-actions">
          {premier ? <Lien href={ecrire(premier)}>{titre('console.ecran.fiche.ecrire_court')}</Lien> : null}
          <MenuGestes gestes={f.gestes} choisir={setGeste} raison={raisonSansGeste} />
        </div>
      </header>

      {f.attend.length ? (
        <section className="c-carte c-fiche-attend" aria-labelledby="fiche-attend">
          <div className="c-fiche-attend-tete">
            <h2 id="fiche-attend">{titre('console.ecran.fiche.attend.titre')}</h2>
            <span>{dire('console.ecran.fiche.attend.sous')}</span>
          </div>
          <ul>
            {f.attend.map((a, i) => {
              const v = attenteEnMots(a, f.aujourdhui);
              const r = reponse(a);
              return (
                <li key={a.sorte}>
                  <span className={`c-ligne-icone c-${v.urgence}`}><Icone nom={v.icone} /></span>
                  <span className="c-fiche-attend-texte"><b>{v.titre}</b><span>{v.desc}</span></span>
                  {r?.geste ? <Bouton {...(i === 0 ? { ton: 'principal' as const } : {})} onClick={() => setGeste(r.geste ?? null)}>{r.texte}</Bouton>
                    : r?.href ? <Lien href={r.href} {...(i === 0 ? { ton: 'principal' as const } : {})}>{r.texte}</Lien> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <nav className="c-onglets" aria-label={titre('console.ecran.fiche.onglets')}>
        {onglets.map(({ o, n }) => (
          <a key={o} href={versOnglet(o)} aria-current={onglet === o ? 'page' : undefined}>
            {titre(`console.ecran.fiche.onglet.${o}`)}{n ? <span className="c-onglet-n">{n}</span> : null}
          </a>
        ))}
      </nav>

      {onglet === 'apercu' ? (
        <div className="c-grille-2">
          <div className="c-colonne">
            <section className="c-carte" aria-labelledby="fiche-ent">
              <div className="c-carte-tete"><h2 id="fiche-ent">{titre('console.ecran.fiche.son_entreprise')}</h2></div>
              <div className={`c-fiche-ent c-fiche-ent-${f.etat.etat}`}>
                {/* Son nom et son état sont en tête de la fiche : la carte dit ce qu'elle a de plus (sa maquette les répète pour
                    un groupe de plusieurs entreprises, pas pour une seule). */}
                <b className="c-fiche-ent-offre">{maj(abonnementEnMots(f.etat, f.faits))}</b>
                <span className="c-fiche-ent-ids">
                  {f.matricule ? <span className="c-mono" data-donnee>MF {f.matricule}</span> : <span>{titre('console.ecran.fiche.sans_matricule')}</span>}
                  {f.formeJuridique ? <> · <span data-donnee>{f.formeJuridique}</span></> : null}
                  {' · '}{dire('console.ecran.fiche.en_devise', { devise: f.devise })}
                </span>
                <span className="c-fiche-ent-quand">{maj(expliquer(f.etat, f.aujourdhui))}</span>
                {f.tenuePar ? <span>{titre('console.ecran.fiche.i.cabinet')} <span data-donnee>{tient ? <a href={`#/cabinets/${tient.id}`}>{f.tenuePar}</a> : f.tenuePar}</span></span> : null}
                {!f.active ? <span className="c-fiche-ent-quand">{titre('console.ecran.fiche.inactive_long')}</span> : null}
              </div>
            </section>

            <section className="c-carte" aria-labelledby="fiche-comptes">
              <div className="c-carte-tete">
                <h2 id="fiche-comptes">{titre('console.ecran.fiche.comptes')}</h2>
                <span className="c-carte-coin">{dire('console.ecran.fiche.comptes_sous')}</span>
              </div>
              <div className="c-chiffres c-fiche-chiffres">
                {([
                  ['pieces', f.comptes.piecesCreees, totalEmises ? dire('console.ecran.fiche.emises_sous', { n: totalEmises }) : dire('console.ecran.fiche.emises_aucune_court')],
                  ['etablissements', f.comptes.etablissements, null], ['caisses', f.comptes.caisses, null], ['salaries', f.comptes.salaries, null],
                ] as const).map(([k, v, sous]) => (
                  <div key={k} className="c-chiffre"><span>{titre(`console.ecran.fiche.c.${k}`)}</span><b>{v}</b>{sous ? <small>{sous}</small> : null}</div>
                ))}
              </div>
              {totalEmises ? (
                <div className="c-barres">
                  <div className="c-barres-tete"><span>{titre('console.ecran.fiche.emises')}</span></div>
                  <div className="c-barres-graphe" role="img" aria-label={dire('console.ecran.fiche.emises_total', { n: totalEmises })}>
                    {douzeMois.map((x) => (
                      <div key={x.mois} className="c-barre" title={`${moisCourt(x.mois)} : ${x.n}`}>
                        <div className="c-barre-colonne"><span className={x.n ? '' : 'c-zero'} style={{ height: `${Math.max(2, Math.round((x.n / plusHaut) * 100))}%` }} /></div>
                        <span className="c-barre-mois" data-donnee>{moisCourt(x.mois)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <div className="c-colonne">
            <section className="c-carte" aria-labelledby="fiche-parler">
              <div className="c-carte-tete"><h2 id="fiche-parler">{titre('console.ecran.fiche.a_qui_parler')}</h2></div>
              {proprietaires.length ? (
                <ul className="c-personnes">
                  {proprietaires.map((m) => (
                    <li key={m.email} className="c-fiche-parler">
                      <div className="c-texte">
                        <b data-donnee>{m.nom}</b>
                        <span>{titre('console.ecran.fiche.proprietaire')}</span>
                        <a href={ecrire(m)} data-donnee>{m.email}</a>
                        <span>{titre(m.derniereConnexion ? 'console.ecran.fiche.connecte' : 'console.ecran.fiche.jamais_connecte', m.derniereConnexion ? { quand: quand(m.derniereConnexion, f.aujourdhui) } : {})}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="c-attente">{phrase('console.ecran.fiche.sans_proprietaire')}</p>}
            </section>

            {f.cabinets.length ? (
              <section className="c-carte" aria-labelledby="fiche-cabinets">
                <div className="c-carte-tete"><h2 id="fiche-cabinets">{titre(f.cabinets.length > 1 ? 'console.ecran.fiche.cabinets_plusieurs' : 'console.ecran.fiche.cabinets')}</h2></div>
                <ul className="c-personnes">
                  {f.cabinets.map((c) => (
                    <li key={c.id}>
                      <Avatar nom={c.nom} />
                      <div className="c-texte">
                        <b data-donnee>{c.nom}</b>
                        <span>{maj(c.mandat ? dire(`console.ecran.fiche.cabinet.${c.place}`, { le: jourCourt(c.mandat.debut) }) : dire(`console.ecran.fiche.cabinet.${c.place}_sans_date`))}</span>
                        <a href={`#/cabinets/${c.id}`} className="c-fiche-vers">{titre('console.ecran.fiche.ouvrir_cabinet')}</a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="c-note"><Icone nom="cache" />{phrase('console.ecran.fiche.contenu')}</p>
          </div>
        </div>
      ) : null}

      {onglet === 'abonnement' ? (
        <section className="c-carte" aria-labelledby="fiche-abo">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-abo">{titre('console.ecran.fiche.abonnement')}</h2>
              <p className="c-carte-sous">{maj(expliquer(f.etat, f.aujourdhui))}</p>
            </div>
          </div>
          {f.ligne ? (
            <dl className="c-faits">{faits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={/\d/.test(v) ? 'c-mono' : ''}>{v}</dd></div>)}</dl>
          ) : <Alerte ton="info">{phrase('console.ecran.fiche.aucune_ligne')}</Alerte>}
        </section>
      ) : null}

      {onglet === 'membres' ? (
        <section className="c-carte" aria-labelledby="fiche-membres">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-membres">{titre('console.ecran.fiche.membres')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.fiche.membres_sous')}</p>
            </div>
          </div>
          {f.membres.length === 0 ? <p className="c-attente">{phrase(tient ? 'console.ecran.fiche.membres_vide_tenue' : 'console.ecran.fiche.membres_vide')}</p> : null}
          <ul className="c-personnes">
            {f.membres.map((m) => (
              <li key={m.email}>
                <Avatar nom={m.nom} />
                <div className="c-texte">
                  <b data-donnee>{m.nom}</b>
                  <span data-donnee>{m.email}</span>
                  <span>{m.roles.map((r) => dire(`role.${r}`)).join(', ')} · {dire('console.ecran.fiche.depuis', { le: jourCourt(jourDe(m.depuis)) })}</span>
                  <span>{titre(m.derniereConnexion ? 'console.ecran.fiche.connecte' : 'console.ecran.fiche.jamais_connecte', m.derniereConnexion ? { quand: quand(m.derniereConnexion, f.aujourdhui) } : {})}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onglet === 'journal' ? (
        <section className="c-carte" aria-labelledby="fiche-histoire">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-histoire">{titre('console.ecran.fiche.histoire')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.fiche.histoire_sous')}</p>
            </div>
            {moi.role === 'direction' ? <Lien href={`#/journal?entreprise=${f.id}`} icone="journal" petit>{titre('console.ecran.fiche.voir_journal')}</Lien> : null}
          </div>
          {f.evenements.length ? (
            <ol className="c-histoire">
              {f.evenements.map((e) => (
                <li key={e.id}>
                  <span className="c-histoire-quand">{maj(quand(e.le, f.aujourdhui))}</span>
                  <div className="c-histoire-quoi">
                    <b>{titre(`console.ecran.nature.${e.nature}`)}</b>
                    <Changements avant={e.avant} apres={e.apres} />
                    {e.motif ? <span className="c-motif" data-donnee>{'« '}{e.motif}{' »'}</span> : null}
                    <span className="c-qui">
                      {e.par === 'systeme' ? titre('console.ecran.fiche.par_systeme')
                        : e.qui ? <><span data-donnee>{e.qui.nom}</span> · {dire(`console.ecran.role.${e.qui.role}`)}</> : titre('console.ecran.fiche.par_outil')}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Vide icone="journal">{phrase('console.ecran.fiche.histoire_vide')}</Vide>}
        </section>
      ) : null}
      {geste ? <FenetreGeste geste={geste} fiche={f} role={moi.role} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); relireDecisions(); }} /> : null}
    </>
  );
}

// Une ligne de « Ce qui attend » dite pour la fiche : sans le nom du client (c'est sa fiche), avec la phrase d'« À
// décider » et son urgence.
type UrgenceAttente = 'urgent' | 'aujourdhui' | 'semaine';
function attenteEnMots(a: Attente, aujourdhui: string): { icone: NomIcone; titre: string; desc: string; urgence: UrgenceAttente & TonPuce } {
  switch (a.sorte) {
    case 'en_retard':
      return { icone: 'calendrier', titre: titre('console.ecran.fiche.attend.en_retard'), urgence: a.jours <= 2 ? 'urgent' : 'semaine',
        desc: phrase(a.apresEssai ? 'console.ecran.decider.retard_essai' : 'console.ecran.decider.retard_abonnement', { echeance: jourCourt(a.echeance), le: jourCourt(a.lectureSeuleLe), dans: dans(a.lectureSeuleLe, aujourdhui) }) };
    case 'lecture_seule':
      return { icone: 'cadenas', titre: titre('console.ecran.fiche.attend.lecture_seule'), urgence: a.depuis === aujourdhui ? 'aujourdhui' : 'semaine',
        desc: phrase(`console.ecran.decider.lecture.${a.raison}`, { le: jourCourt(a.depuis) }) };
    default:
      return { icone: 'sablier', titre: titre('console.ecran.fiche.attend.essai_sans_usage'), urgence: a.jours <= 1 ? 'aujourdhui' : 'semaine',
        desc: phrase('console.ecran.decider.sans_usage', { le: jourCourt(a.jusquAu), dans: dans(a.jusquAu, aujourdhui) }) };
  }
}

// Les douze derniers mois, du plus ancien au mois en cours (« 2025-11 » … « 2026-10 »), en jours de calendrier.
function derniersMois(aujourdhui: string): string[] {
  const a = Number(aujourdhui.slice(0, 4)), m = Number(aujourdhui.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const k = a * 12 + (m - 1) - (11 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
  });
}
const moisCourt = (mois: string) => `${mois.slice(5, 7)}/${mois.slice(2, 4)}`;
