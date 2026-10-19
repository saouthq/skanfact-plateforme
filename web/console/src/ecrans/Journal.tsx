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
import { deMois, heureDe, jourCourt, jourDe, jourLong, jourMois, joursEntre, moisEnMots } from '../temps.ts';
import { Alerte, Avatar, Bouton, Dialogue, Icone, Lien, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import type { Acces } from './AccesDossier.tsx';
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
    remise?: { code: 'groupe' | 'cabinet'; aPartirDu: string | null; avant: { taux: number; mois: number | null } | null; apres: { taux: number; mois: number | null } | null } | null;
    // Une nouveauté (0120) : son code, et son nom tant que la version en service la porte.
    nouveaute?: string | null; nomNouveaute?: string | null;
  };
};
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
  if (r.nouveaute) return <a href="#/reglages?onglet=nouveautes">{titre('console.ecran.journal.sur_nouveaute')} « <span data-donnee>{r.nomNouveaute ?? r.nouveaute}</span> »</a>;
  if (r.regleAbonnement) return <a href="#/reglages">{titre(`console.ecran.journal.sur_regle_abo.${r.regleAbonnement.code}`)}</a>;
  if (r.remise) return <a href="#/reglages">{titre(`console.ecran.journal.sur_remise.${r.remise.code}`)}</a>;
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
  // Une remise (0106) : comme un prix, celle d'avant barrée, la nouvelle à sa date ; retirée, celle qui est retirée (à
  // sa date) barrée, celle qui reste.
  if (r.remise) {
    const x = r.remise;
    const date = x.aPartirDu ? ` ${dire('console.ecran.journal.a_partir_du', { jour: jourCourt(x.aPartirDu) })}` : '';
    const retire = geste === 'reglages.remise_retiree';
    const dit = (v: { taux: number; mois: number | null } | null) => (v === null ? '—' : x.code === 'cabinet' && v.mois !== null
      ? dire('console.ecran.reglages.rm.taux_mois', { taux: v.taux, mois: selon(v.mois, 'console.ecran.reglages.rm.mois') }) : dire('console.ecran.reglages.rm.taux', { taux: v.taux }));
    return (
      <span className="c-changes"><span className="c-change">
        <del data-donnee>{dit(x.avant)}{retire ? date : ''}</del> → <ins data-donnee>{dit(x.apres)}{retire ? '' : date}</ins>
      </span></span>
    );
  }
  // Une nouveauté allumée ou éteinte : laquelle, puisque le « sur qui » est l'entreprise. Ouverte ou refermée : le « sur
  // quoi » la nomme déjà.
  if (r.nouveaute) {
    return geste === 'reglages.nouveaute_allumee' || geste === 'reglages.nouveaute_eteinte'
      ? <span className="c-changes"><span className="c-change" data-donnee>{r.nomNouveaute ?? r.nouveaute}</span></span> : null;
  }
  const t = r.regle && r.reluePar ? dire(`console.ecran.journal.relue_${r.avis === 'a_corriger' ? 'corriger' : 'juste'}`, { qui: r.reluePar })
    : r.du && r.au ? dire('console.ecran.journal.du_au', { du: jourCourt(r.du), au: jourCourt(r.au) }) : null;
  return t ? <span className="c-changes"><span className="c-change" data-donnee>{t}</span></span> : null;
}

// La famille d'un geste, lue dans son nom : l'abonnement d'un client, l'équipe, le service, les réglages, le support, nos
// factures, les groupes (0106), les paiements (0108).
const FAMILLES = ['abonnement', 'equipe', 'service', 'reglages', 'support', 'factures', 'groupes', 'paiements', 'clients'] as const;
// Un geste sur un groupe (0106) : la société y entre (le groupe créé avec elle, s'il est neuf) ou en sort.
function LeGroupe({ geste, avant, apres }: { geste: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }) {
  const nom = typeof apres?.nom === 'string' ? apres.nom : typeof avant?.nom === 'string' ? avant.nom : null;
  if (!nom) return null;
  const cle = geste === 'groupes.sortie' ? 'groupe_hors' : apres?.cree === true ? 'groupe_cree' : 'groupe_dans';
  return <span className="c-changes"><span className="c-change" data-donnee>{maj(dire(`console.ecran.journal.${cle}`, { nom }))}</span></span>;
}
// Un coût du mois saisi ou retiré (0108) : son nom, son montant, son mois ; retiré, barré. Il porte sur les coûts de son
// mois, que « Sur quoi » ouvre.
const moisDuCout = (c: Record<string, unknown> | null) => (c && typeof c.mois === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(c.mois) ? c.mois : null);
function SurLesCouts({ avant, apres }: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }) {
  const m = moisDuCout(apres ?? avant);
  return m ? <a href={`#/paiements?mois=${m}`}>{titre('console.ecran.journal.sur_couts', { de_mois: deMois(m) })}</a> : <>—</>;
}
function LeCout({ avant, apres }: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }) {
  const c = apres ?? avant;
  const m = moisDuCout(c);
  if (!c || !m || typeof c.libelle !== 'string' || typeof c.montant !== 'string') return null;
  const texte = `${c.libelle} · ${montant(c.montant)} · ${moisEnMots(m)}`;
  return <span className="c-changes"><span className="c-change">{apres ? <ins data-donnee>{texte}</ins> : <del data-donnee>{texte}</del>}</span></span>;
}
const familleDe = (geste: string) => FAMILLES.find((f) => geste.startsWith(`${f}.`)) ?? null;

// Un jour comme on le dit : « Aujourd'hui · mardi 13 octobre », « Hier · lundi 12 octobre », « samedi 10 octobre » ; l'année
// seulement quand ce n'est pas celle d'aujourd'hui.
function jourEnMots(jour: string, aujourdhui: string): string {
  const long = jourLong(jour);
  const sansAnnee = jour.slice(0, 4) === aujourdhui.slice(0, 4) ? long.replace(/\s\d{4}$/, '') : long;
  const n = joursEntre(jour, aujourdhui);
  return n === 0 ? `${maj(dire('console.ecran.temps.aujourdhui'))} · ${sansAnnee}` : n === 1 ? `${maj(dire('console.ecran.temps.hier'))} · ${sansAnnee}` : maj(sansAnnee);
}

// Les sortes de geste (la maquette Journal ; 0114, plateforme.sorte_du_geste) : le filtre et la couleur de chaque ligne.
const SORTES = ['abonnements', 'clients', 'paiements', 'factures', 'support', 'acces', 'donnees', 'service', 'reglages', 'equipe', 'journal', 'systeme'] as const;
type Sorte = typeof SORTES[number];
const PLAGES = ['1j', '7j', '30j', 'tout'] as const;
type Plage = typeof PLAGES[number];
type Chiffres = { gestes: number; reserves: number | null; systeme: number | null; accesOuverts: { entreprise: string; fin: string }[] };
type PageLue = { aujourdhui: string; role: Role; plage: Plage; chiffres: Chiffres; lignes: (Ligne & { sorte?: Sorte; systeme?: boolean; reserve?: boolean })[]; suite: string | null };
type Filtres = { qui: string; sorte: Sorte | ''; plage: Plage; q: string; reserves: boolean; systeme: boolean };
const SANS_FILTRE: Filtres = { qui: '', sorte: '', plage: '30j', q: '', reserves: false, systeme: false };
const J = 'console.ecran.journal';

// La ligne d'un geste du système (0114) : une relance partie, un paiement reconnu par le prestataire — sans personne ni motif.
function GesteDuSysteme({ l }: { l: Ligne }) {
  const r = l.apres ?? {};
  if (l.geste === 'systeme.relance') {
    const rang = typeof r.rang === 'string' ? r.rang : '';
    const quoi = rang === 'lecture_seule' ? dire(`${J}.sys.relance_lecture`) : /^j\d+$/.test(rang) ? dire(`${J}.sys.relance_j`, { n: rang.slice(1) }) : dire(`${J}.sys.relance`);
    return <span className="c-changes"><span className="c-change">{maj(quoi)}{typeof r.echeance === 'string' ? ` · ${dire(`${J}.sys.echeance`, { jour: jourCourt(r.echeance) })}` : ''}</span></span>;
  }
  // Un paiement reconnu par le prestataire : sa facture, et jusqu'à quand l'abonnement est payé.
  return (
    <span className="c-changes"><span className="c-change">
      {typeof r.facture === 'string' ? <span data-donnee>{r.facture}</span> : null}
      {typeof r.payeJusquAu === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.payeJusquAu) ? <>{typeof r.facture === 'string' ? ' · ' : ''}{dire(`${J}.sys.paye_jusqu_au`, { jour: jourCourt(r.payeJusquAu) })}</> : null}
    </span></span>
  );
}

export function Journal({ entreprise, qui: quiDemande }: { entreprise: string | null; qui: string | null }) {
  const api = useApi();
  const { moi } = useConsole();
  const direction = moi.role === 'direction';
  const [equipe] = useLecture<{ membres: Membre[] }>(direction ? '/console/equipe' : '/console/moi', direction ? 'equipe' : 'moi');
  const [onglet, setOnglet] = useState<'gestes' | 'acces'>('gestes');
  const [f, setF] = useState<Filtres>({ ...SANS_FILTRE, qui: quiDemande ?? '' });
  const [qTape, setQTape] = useState('');
  // Un membre demandé d'ailleurs (« ses gestes au journal », dans l'équipe) remplace celui-ci ; l'adresse suit le choix.
  useEffect(() => { setF((x) => ({ ...x, qui: quiDemande ?? '' })); }, [quiDemande]);
  // La recherche part quand on s'arrête de taper.
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === qTape.trim() ? x : { ...x, q: qTape.trim() })), 300); return () => clearTimeout(t); }, [qTape]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (entreprise) p.set('entreprise', entreprise);
    if (f.qui) p.set('qui', f.qui);
    const s = p.toString();
    history.replaceState(null, '', `#/journal${s ? `?${s}` : ''}`);
  }, [entreprise, f.qui]);
  const [lu, setLu] = useState<PageLue | null>(null);
  const [lignes, setLignes] = useState<PageLue['lignes'] | null>(null);
  const [suite, setSuite] = useState<string | null>(null);
  const [panne, setPanne] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [exporter, setExporter] = useState(false);

  const parametres = useCallback((avant: string | null) => {
    const p = new URLSearchParams({ limite: '50', plage: f.plage });
    if (f.qui) p.set('qui', f.qui);
    if (entreprise) p.set('entreprise', entreprise);
    if (f.sorte) p.set('sorte', f.sorte);
    if (f.q) p.set('q', f.q);
    if (f.reserves) p.set('reserves', '1');
    if (f.systeme) p.set('systeme', '1');
    if (avant) p.set('avant', avant);
    return p;
  }, [f, entreprise]);
  const lire = useCallback(async (avant: string | null) => {
    setOccupe(true);
    setPanne(null);
    try {
      const r = await api<PageLue>('GET', `/console/journal?${parametres(avant).toString()}`);
      if (!r) return;
      if (r.statut !== 200) { setPanne(refusDe(r)); return; }
      setLu(r.corps);
      setLignes((x) => (avant && x ? [...x, ...r.corps.lignes] : r.corps.lignes));
      setSuite(r.corps.suite);
    } catch (x) { setPanne(panneDe(x)); } finally { setOccupe(false); }
  }, [api, parametres]);
  useEffect(() => { setLignes(null); void lire(null); }, [lire]);

  const membres = direction && equipe.etat === 'lu' ? equipe.donnees.membres : [];
  const nomEntreprise = entreprise ? lignes?.find((l) => l.entreprise?.id === entreprise)?.entreprise?.raisonSociale ?? null : null;
  const filtre = f.qui !== '' || f.sorte !== '' || f.plage !== '30j' || f.q !== '' || f.reserves || f.systeme;
  const effacer = () => { setF({ ...SANS_FILTRE }); setQTape(''); };
  // Regroupés par jour (de Tunis), dans l'ordre où ils arrivent.
  const jours: { jour: string; lignes: PageLue['lignes'] }[] = [];
  for (const l of lignes ?? []) {
    const j = jourDe(l.le);
    const dernier = jours.at(-1);
    if (dernier?.jour === j) dernier.lignes.push(l); else jours.push({ jour: j, lignes: [l] });
  }
  const c = lu?.chiffres ?? null;
  const ouvert = c?.accesOuverts[0] ?? null;
  // Les quatre chiffres de la maquette : chacun ouvre la liste qu'il compte (C3) ; le support en lit deux.
  const cartes: { cle: string; valeur: number | null; sous: string; presse: boolean; ouvrir: () => void }[] = c ? [
    { cle: direction ? 'k.gestes' : 'k.tes_gestes', valeur: c.gestes, sous: phrase(`${J}.k.gestes_sous`), presse: onglet === 'gestes' && !f.reserves && !f.systeme && f.plage === '30j' && !f.sorte && !f.q && !f.qui,
      ouvrir: () => { setOnglet('gestes'); effacer(); } },
    ...(direction ? [{ cle: 'k.reserves', valeur: c.reserves, sous: phrase(`${J}.k.reserves_sous`), presse: onglet === 'gestes' && f.reserves,
      ouvrir: () => { setOnglet('gestes'); setQTape(''); setF({ ...SANS_FILTRE, reserves: true }); } }] : []),
    { cle: 'k.acces', valeur: c.accesOuverts.length, sous: ouvert ? dire(`${J}.k.acces_ouvert`, { client: ouvert.entreprise, fin: `${jourMois(jourDe(ouvert.fin))}, ${heureDe(ouvert.fin)}` }) : dire(`${J}.k.acces_aucun`),
      presse: onglet === 'acces', ouvrir: () => setOnglet('acces') },
    ...(direction ? [{ cle: 'k.systeme', valeur: c.systeme, sous: phrase(`${J}.k.systeme_sous`), presse: onglet === 'gestes' && f.systeme && f.sorte === 'systeme',
      ouvrir: () => { setOnglet('gestes'); setQTape(''); setF({ ...SANS_FILTRE, systeme: true, sorte: 'systeme' }); } }] : []),
  ] : [];

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${J}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(direction ? `${J}.sous` : `${J}.sous_support`)}</p>
        </div>
        {direction && onglet === 'gestes' && lignes && lignes.length ? (
          <div className="c-entete-actions"><Bouton icone="telecharger" onClick={() => setExporter(true)}>{titre(`${J}.ex.ouvrir`)}</Bouton></div>
        ) : null}
      </header>
      {cartes.length ? (
        <div className={`c-vues c-vues-${cartes.length}`} role="group" aria-label={titre(`${J}.k.groupe`)}>
          {cartes.map((k) => (
            <button key={k.cle} type="button" className="c-vue" aria-pressed={k.presse} onClick={k.ouvrir}>
              <span className="c-vue-titre"><span>{titre(`${J}.${k.cle}`)}</span></span>
              <span className="c-vue-n">{k.valeur ?? '—'}</span>
              <span className="c-vue-sous">{maj(k.sous)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <nav className="c-onglets c-jr-onglets" aria-label={titre(`${J}.onglets`)}>
        {(['gestes', 'acces'] as const).map((o) => (
          <button key={o} type="button" aria-current={onglet === o ? 'page' : undefined} onClick={() => setOnglet(o)}>{titre(`${J}.onglet.${o}`)}</button>
        ))}
      </nav>
      {onglet === 'acces' ? <AccesAuxDossiers /> : (
        <section className="c-carte c-liste-carte" aria-label={titre(`${J}.titre`)}>
          <div className="c-liste-outils c-jr-outils">
            <div className="c-cl-filtres" role="group" aria-label={titre(`${J}.filtres`)}>
              <label className="c-recherche">
                <span className="c-cache">{titre(`${J}.chercher_label`)}</span>
                <Icone nom="chercher" />
                <input type="search" value={qTape} onChange={(e) => setQTape(e.target.value)} placeholder={titre(`${J}.chercher`)} />
              </label>
              <label className="c-cl-filtre">
                <span className="c-cache">{titre(`${J}.sorte`)}</span>
                <select className="c-select" value={f.sorte} onChange={(e) => setF((x) => ({ ...x, sorte: SORTES.includes(e.target.value as Sorte) ? e.target.value as Sorte : '' }))}>
                  <option value="">{titre(`${J}.sortes_toutes`)}</option>
                  {SORTES.filter((s) => direction || (s !== 'systeme' && s !== 'journal')).map((s) => <option key={s} value={s}>{titre(`${J}.s.${s}`)}</option>)}
                </select>
              </label>
              <div className="c-pilules c-sv-periodes" role="group" aria-label={titre(`${J}.periode`)}>
                {PLAGES.map((p) => <button key={p} type="button" className="c-pilule" aria-pressed={f.plage === p} onClick={() => setF((x) => ({ ...x, plage: p }))}>{titre(`${J}.plage.${p}`)}</button>)}
              </div>
            </div>
            {direction ? (
              <div className="c-pilules c-jr-qui" role="group" aria-label={titre(`${J}.qui`)}>
                <button type="button" className="c-pilule" aria-pressed={f.qui === ''} onClick={() => setF((x) => ({ ...x, qui: '' }))}>{titre(`${J}.toute_l_equipe`)}</button>
                {membres.map((m) => (
                  <button key={m.utilisateur} type="button" className="c-pilule" aria-pressed={f.qui === m.utilisateur} onClick={() => setF((x) => ({ ...x, qui: m.utilisateur, systeme: false }))}>
                    <Avatar nom={m.nom} /><span data-donnee>{m.nom}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {direction ? (
              <div className="c-pilules c-jr-bascules" role="group" aria-label={titre(`${J}.bascules`)}>
                <button type="button" className="c-pilule" aria-pressed={f.reserves} onClick={() => setF((x) => ({ ...x, reserves: !x.reserves, systeme: false, sorte: x.sorte === 'systeme' ? '' : x.sorte }))}>
                  <Icone nom="cadenas" taille={15} />{titre(`${J}.seulement_reserves`)}
                </button>
                <button type="button" className="c-pilule" aria-pressed={f.systeme} onClick={() => setF((x) => ({ ...x, systeme: !x.systeme, reserves: false, qui: '', sorte: x.systeme && x.sorte === 'systeme' ? '' : x.sorte }))}>
                  <Icone nom="service" taille={15} />{titre(`${J}.montrer_systeme`)}
                </button>
                {filtre ? <Bouton petit ton="discret" onClick={effacer}>{titre(`${J}.effacer`)}</Bouton> : null}
              </div>
            ) : filtre ? <Bouton petit ton="discret" onClick={effacer}>{titre(`${J}.effacer`)}</Bouton> : null}
            {entreprise ? (
              <span className="c-titre-ligne">
                <Puce ton="semaine">{nomEntreprise ? dire(`${J}.seulement`, { nom: nomEntreprise }) : dire(`${J}.une_entreprise`)}</Puce>
                <a href="#/journal">{titre(`${J}.tout_voir`)}</a>
              </span>
            ) : null}
          </div>
          {panne ? <div className="c-liste-alerte"><Alerte ton="danger"><span>{panne}</span><span><Bouton petit onClick={() => void lire(null)}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte></div> : null}
          {lignes === null ? (panne ? null : <p className="c-vide">{titre('console.ecran.lecture')}</p>)
            : lignes.length === 0 ? (
              filtre ? <Vide icone="chercher"><span>{phrase(`${J}.rien_filtre`)}</span> <Bouton ton="discret" petit onClick={effacer}>{titre(`${J}.effacer`)}</Bouton></Vide>
                : <Vide icone="journal">{phrase(`${J}.vide`)}</Vide>
            ) : (
              <>
                <div className="c-liste-resume">
                  <p><b>{suite ? maj(dire(`${J}.au_moins`, { n: lignes.length })) : maj(selon(lignes.length, `${J}.gestes`))}</b>{' · '}{dire(`${J}.ordre`)}</p>
                </div>
                <div className="c-defile">
                  <table className="c-table c-table-journal">
                    <thead>
                      <tr>
                        <th scope="col">{titre(`${J}.colonne.heure`)}</th>
                        <th scope="col">{titre(`${J}.colonne.qui`)}</th>
                        <th scope="col">{titre(`${J}.colonne.geste`)}</th>
                        <th scope="col">{titre(`${J}.colonne.sur`)}</th>
                        <th scope="col">{titre(`${J}.colonne.motif`)}</th>
                        <th scope="col">{titre(`${J}.colonne.change`)}</th>
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
                              {entier ? <span>{' · '}{selon(j.lignes.length, `${J}.gestes`)}</span> : null}
                            </th>
                          </tr>
                          {j.lignes.map((l) => {
                            const famille = familleDe(l.geste);
                            const sorte = l.sorte ?? null;
                            return (
                              <tr key={l.id} className={l.systeme ? 'c-jr-systeme' : undefined}>
                                <td className="c-mono">{heureDe(l.le)}</td>
                                <td>
                                  {l.qui ? (
                                    <span className="c-jr-qui-cellule">
                                      <Avatar nom={l.qui.nom} nuit={l.role === 'direction'} />
                                      <span><b data-donnee>{l.qui.nom}</b>{l.role ? <span className="c-sous">{titre(`console.ecran.role.${l.role}`)}</span> : null}</span>
                                    </span>
                                  ) : <span className="c-attente">{titre(l.systeme ? `${J}.le_systeme` : `${J}.outil`)}</span>}
                                </td>
                                <td>
                                  <b>{titre(`${J}.g.${l.geste.replaceAll('-', '_')}`)}</b>
                                  <span className="c-sous c-sous-espace">
                                    {sorte ? <span className={`c-jr-famille c-jr-sorte-${sorte}`}>{titre(`${J}.s.${sorte}`)}</span> : null}
                                    {l.reserve ? <span className="c-jr-reserve"><Icone nom="cadenas" taille={12} />{dire(`${J}.reserve`)}</span> : null}
                                  </span>
                                </td>
                                <td className="c-jr-sur">
                                  {l.entreprise ? <a href={`#/clients/${l.entreprise.id}`} data-donnee>{l.entreprise.raisonSociale}</a>
                                    : l.membre ? <span data-donnee>{l.membre.nom}</span>
                                      : l.service ? <SurLeService s={l.service} /> : l.reglages ? <SurLesReglages r={l.reglages} />
                                        : famille === 'paiements' ? <SurLesCouts avant={l.avant} apres={l.apres} /> : '—'}
                                </td>
                                <td>{l.systeme || !l.motif ? <span className="c-attente">—</span> : <span className="c-jr-motif" data-donnee>{'« '}{l.motif}{' »'}</span>}</td>
                                <td>{l.systeme ? <GesteDuSysteme l={l} /> : l.service ? <ChangeDuService geste={l.geste} s={l.service} /> : l.reglages ? <ChangeDesReglages geste={l.geste} r={l.reglages} />
                                  : famille === 'support' ? <LaDemande avant={l.avant} apres={l.apres} />
                                    : famille === 'groupes' ? <LeGroupe geste={l.geste} avant={l.avant} apres={l.apres} />
                                      : famille === 'paiements' ? <LeCout avant={l.avant} apres={l.apres} /> : <Changements avant={l.avant} apres={l.apres} empile />}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              </>
            )}
          {suite ? (
            <div className="c-liste-pied">
              <span />
              <Bouton petit occupe={occupe} onClick={() => void lire(suite)}>{titre(`${J}.plus`)}</Bouton>
            </div>
          ) : null}
        </section>
      )}
      <p className="c-cl-notes"><span>{phrase(`${J}.garde`)} <b className="c-cl-verifier">{dire('console.ecran.clients.note_a_verifier')}</b> {dire(`${J}.garde_fin`)}</span></p>
      {exporter ? <ExportDuJournal filtres={Object.fromEntries([...parametres(null).entries()].filter(([k]) => k !== 'limite'))} n={lignes?.length ?? 0} plus={suite !== null} fermer={() => setExporter(false)} /> : null}
    </>
  );
}

// ── Les accès aux dossiers (le second onglet) ─────────────────────────────────────────────────────────────────────────
// Chaque accès demandé : son client, son état, qui l'a demandé et pourquoi, qui l'a accordé, jusqu'à quand, et chaque page
// lue (le client voit la même liste chez lui). Un accès ouvert se ferme d'ici (« Fermer maintenant »).
type AccesLu = Acces & { nom: string | null };
function AccesAuxDossiers() {
  const api = useApi();
  const [debut, setDebut] = useState(0);
  const [l, relire] = useLecture<{ aujourdhui: string; debut: number; total: number; parPage: number; lignes: AccesLu[] }>(`/console/journal/acces?debut=${debut}`, 'journal-acces');
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [fermer, setFermer] = useState<AccesLu | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const lu = l.etat === 'lu' ? l.donnees : null;
  const fermerMaintenant = (a: AccesLu) => {
    void (async () => {
      setOccupe(true); setRefus(null);
      try {
        const r = await api('POST', `/console/support/acces/${a.id}/clore`, {});
        if (!r) return;
        if (r.statut === 200) { toast(phrase(`${J}.a.ferme_fait`, { client: a.nom ?? '' })); setFermer(null); relire(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <section className="c-carte c-liste-carte c-jr-acces" aria-label={titre(`${J}.onglet.acces`)}>
      <div className="c-carte-tete c-jr-acces-tete">
        <h2>{titre(`${J}.a.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${J}.a.sous`)}</p>
      </div>
      {l.etat === 'panne' ? <div className="c-liste-alerte"><Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte></div> : null}
      {l.etat === 'lecture' ? <p className="c-vide">{titre('console.ecran.lecture')}</p> : null}
      {lu && lu.lignes.length === 0 ? <Vide icone="cadenas"><span>{phrase(`${J}.a.vide`)}</span> <Lien href="#/support" petit>{titre(`${J}.a.ouvrir_support`)}</Lien></Vide> : null}
      {lu && lu.lignes.length ? (
        <ul className="c-jr-acces-liste">
          {lu.lignes.map((a) => (
            <li key={a.id} className={`c-jr-un-acces c-jr-acces-${a.etat}`}>
              <div className="c-jr-acces-haut">
                <span className="c-texte">
                  <a href={`#/clients/${a.entreprise}`}><b data-donnee>{a.nom ?? '—'}</b></a>
                  <span className="c-sous">{dire(`${J}.a.demande_par`, { le: `${jourMois(jourDe(a.demandeLe))}, ${heureDe(a.demandeLe)}`, qui: a.demandeur ?? '—' })}</span>
                </span>
                <Puce ton={a.etat === 'actif' ? 'actif' : a.etat === 'demande' ? 'semaine' : a.etat === 'refuse' ? 'a_regarder' : 'hors'}>{dire(`${J}.a.etat.${a.etat}`)}</Puce>
              </div>
              <p className="c-jr-motif" data-donnee>{'« '}{a.motif}{' »'}</p>
              <p className="c-sous">
                {a.accordeLe ? dire(`${J}.a.accorde`, { qui: a.accordePar ?? '—', heures: a.heures ?? 0 }) : a.refuseLe ? dire(`${J}.a.refuse`, { qui: a.refusePar ?? '—' }) : dire(`${J}.a.pas_accorde`)}
                {a.fin ? ` · ${dire(a.etat === 'actif' ? `${J}.a.jusqua` : `${J}.a.fini_le`, { quand: `${jourMois(jourDe(a.closLe ?? a.retireLe ?? a.fin))}, ${heureDe(a.closLe ?? a.retireLe ?? a.fin)}` })}` : ''}
              </p>
              <div className="c-jr-acces-pied">
                {a.lectures.length ? (
                  <button type="button" className="c-lien-bouton" aria-expanded={ouvert === a.id} onClick={() => setOuvert(ouvert === a.id ? null : a.id)}>
                    {maj(selon(a.lectures.length, `${J}.a.pages`))}
                  </button>
                ) : <span className="c-attente">{dire(`${J}.a.aucune_page`)}</span>}
                {a.etat === 'actif' || a.etat === 'demande' ? <Bouton petit onClick={() => setFermer(a)}>{titre(`${J}.a.fermer`)}</Bouton> : null}
              </div>
              {ouvert === a.id ? (
                <ol className="c-jr-lectures">
                  {a.lectures.map((x, i) => <li key={`${x.le}${i}`}><span className="c-mono">{`${jourMois(jourDe(x.le))}, ${heureDe(x.le)}`}</span> <span data-donnee>{x.page}</span></li>)}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {lu && lu.total > lu.parPage ? (
        <nav className="c-liste-pied" aria-label={titre(`${J}.a.pages_liste`)}>
          <span>{dire(`${J}.a.de_a`, { debut: lu.debut + 1, fin: lu.debut + lu.lignes.length, total: lu.total })}</span>
          <span className="c-liste-pied-boutons">
            <Bouton petit desactive={lu.debut === 0} onClick={() => setDebut(Math.max(0, debut - lu.parPage))}>{titre('console.ecran.clients.precedente')}</Bouton>
            <Bouton petit desactive={lu.debut + lu.parPage >= lu.total} onClick={() => setDebut(debut + lu.parPage)}>{titre('console.ecran.clients.suivante')}</Bouton>
          </span>
        </nav>
      ) : null}
      <p className="c-jr-acces-note">{phrase(`${J}.a.note`)}</p>
      {fermer ? (
        <Dialogue titre={titre(`${J}.a.fermer_titre`)} sous={fermer.nom ?? ''} sousDonnee fermer={() => setFermer(null)} occupe={occupe}
          pied={<>
            <Bouton ferme onClick={() => setFermer(null)} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
            <Bouton ton="principal" occupe={occupe} onClick={() => fermerMaintenant(fermer)}>{titre(`${J}.a.fermer_bouton`)}</Bouton>
          </>}>
          <p>{phrase(`${J}.a.fermer_texte`)}</p>
          {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
        </Dialogue>
      ) : null}
    </section>
  );
}

// ── Exporter la sélection du journal ──────────────────────────────────────────────────────────────────────────────────
// La direction seule, avec son motif (le journal le garde à son tour, avec le nombre de lignes, jamais les lignes) ; le
// fichier est la sélection telle qu'elle est filtrée, toutes ses pages (cinq mille lignes au plus).
const COLONNES_J: [string, (l: LigneExportee) => string][] = [
  ['jour', (l) => jourCourt(jourDe(l.le))], ['heure', (l) => heureDe(l.le)], ['qui', (l) => l.qui ?? dire(`${J}.le_systeme`)],
  ['role', (l) => (l.role ? dire(`console.ecran.role.${l.role}`) : '')], ['geste', (l) => maj(dire(`${J}.g.${l.geste.replaceAll('-', '_')}`))],
  ['sorte', (l) => maj(dire(`${J}.s.${l.sorte}`))], ['sur', (l) => l.entreprise ?? l.membre ?? ''], ['motif', (l) => l.motif],
  ['reserve', (l) => (l.reserve ? dire(`${J}.ex.oui`) : '')],
];
type LigneExportee = { le: string; geste: string; sorte: string; qui: string | null; role: string | null; entreprise: string | null; membre: string | null; motif: string; reserve: boolean };
const cellule = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function telechargerJournal(lignes: LigneExportee[], jour: string) {
  const csv = [COLONNES_J.map(([c]) => cellule(maj(dire(`${J}.ex.col.${c}`)))).join(';'), ...lignes.map((l) => COLONNES_J.map(([, x]) => cellule(x(l))).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${dire(`${J}.ex.fichier`)}-${jour}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
function ExportDuJournal({ filtres, n, plus, fermer }: { filtres: Record<string, string>; n: number; plus: boolean; fermer: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/journal/export', { motif: motif.trim(), filtres });
        if (!r) return;
        if (r.statut === 201) {
          const c = r.corps as { aujourdhui: string; lignes: LigneExportee[]; coupe: boolean };
          telechargerJournal(c.lignes, c.aujourdhui);
          toast(phrase(c.coupe ? `${J}.ex.fait_coupe` : `${J}.ex.fait`, { n: c.lignes.length }));
          fermer();
          return;
        }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${J}.ex.titre`)} sous={plus ? dire(`${J}.au_moins`, { n }) : maj(selon(n, `${J}.gestes`))} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" icone="telecharger" occupe={occupe} onClick={envoyer}>{titre(`${J}.ex.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${J}.ex.${x}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${J}.ex.motif_aide`)} valeur={motif} changer={setMotif} premier faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}
