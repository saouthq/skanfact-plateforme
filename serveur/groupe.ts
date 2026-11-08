// Le tableau de bord du groupe (brique 113 ; 14 § 3.6 : « les chiffres de toutes les sociétés d'un groupe, dans la
// devise de base » ; 13, cible n° 6). Qui tient plusieurs sociétés voit leurs chiffres côte à côte, lus dans leurs
// livres : le chiffre d'affaires du mois et de l'exercice, ce qui reste à encaisser et à payer, la trésorerie. Une
// société dont le rôle de la personne ne montre pas les livres est nommée, sans ses chiffres (et sans deviner pourquoi
// au-delà de ce que la porte dit). Le total se fait par devise : on n'additionne jamais deux devises (7.0.1).
//
// Les chiffres sont ceux des livres (les écritures du serveur, brouillard compris, comme la balance) : la même source
// que la balance et la déclaration du mois, donc le même chiffre (« deux chemins, un chiffre »). Les entreprises
// d'essai (ce ne sont pas des données) et celles vues seulement par le mandat d'un cabinet n'y sont pas.
//
// (1.324.0, revue des modules : « Le groupe ») Une huilerie de Sfax vend son huile à sa société sœur de distribution,
// qui la revend aux épiceries : additionner leurs livres comptait deux fois l'huile (vendue par l'une, puis par l'autre),
// et ce que la distribution doit à l'huilerie était à la fois « à encaisser » et « à payer » du groupe. Ce que les
// sociétés se vendent et se doivent entre elles se dit à part (`entreSocietes`) et se retire du total : le groupe, sans
// compter deux fois. Les deux livres d'une même dette se comparent : ce que l'huilerie dit que la distribution lui doit,
// ce que la distribution dit lui devoir, l'écart et les pièces qui l'expliquent (une facture d'un côté et pas de l'autre,
// un montant différent). Le comptable lit la même chose au Cabinet (`groupeDuDossier`, onglet Inventaire).

import { sql } from 'kysely';
import { versTexte } from '../moteur/argent.ts';
import type { Route } from './app.ts';
import { requetes, type Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';
import { peut, type QuiAgit } from './porte/porte.ts';
import { aujourdhuiATunis } from './reglements.ts';
import { motif } from '../textes/index.ts';

type Chiffres = { caMois: string; caExercice: string; aEncaisser: string; aPayer: string; tresorerie: string };
type Brut = Record<keyof Chiffres, bigint>;
const ZERO = (): Brut => ({ caMois: 0n, caExercice: 0n, aEncaisser: 0n, aPayer: 0n, tresorerie: 0n });
const enTexte = (b: Brut, dec: number) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, versTexte(v, dec)])) as Chiffres;

// Une société du groupe, telle que les autres la reconnaissent parmi leurs clients et leurs fournisseurs.
export type SocieteDuGroupe = { id: string; raisonSociale: string; matricule: string | null; devise: string; decimales: number; debutExerciceMois: number };

// L'exercice en cours d'une société au jour dit : il commence le 1er de son mois de début, cette année ou la précédente.
function debutExercice(jour: string, moisDebut: number) {
  const an = Number(jour.slice(0, 4));
  const debutAn = Number(jour.slice(5, 7)) >= moisDebut ? an : an - 1;
  return `${debutAn}-${String(moisDebut).padStart(2, '0')}-01`;
}

// Le matricule d'une société se reconnaît à ses sept chiffres et sa lettre-clé, quelle que soit l'écriture (barres,
// espaces) : un autre établissement (le code qui suit) est la même société. Une fiche sans matricule se reconnaît à son
// nom exact, accents, casse et ponctuation mis à part.
const cleMatricule = (m: unknown) => { const c = String(m ?? '').toUpperCase().replace(/[\s/.\-_]/g, ''); return /^[0-9]{7}[A-Z]/.test(c) ? c.slice(0, 8) : null; };
const cleNom = (n: unknown) => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cleNumero = (n: unknown) => String(n ?? '').toUpperCase().replace(/\s+/g, '');
const sansMatricule = (identifiant: string | null) => (identifiant ?? '').trim() === '';
// L'ordre des lignes : par les noms des deux sociétés (la lecture des livres n'en donne aucun).
const parNoms = (a1: string, a2: string, b1: string, b2: string) => a1.localeCompare(b1, 'fr') || a2.localeCompare(b2, 'fr');

// Les fiches (clients et fournisseurs) de chaque société qui sont une autre société de la liste : soeur.get(A).get(B),
// les fiches de A qui sont B.
async function fichesSoeurs(tx: Transaction, societes: SocieteDuGroupe[]) {
  const parMatricule = new Map<string, string>(), parNom = new Map<string, string>();
  for (const s of societes) {
    const m = cleMatricule(s.matricule);
    if (m) parMatricule.set(m, s.id);
    parNom.set(cleNom(s.raisonSociale), s.id);
  }
  const fiches = (await tx.query(`select id, entreprise, identifiant, raison_sociale from socle.tiers where entreprise = any($1::uuid[])`,
    [societes.map((s) => s.id)])).rows as { id: string; entreprise: string; identifiant: string | null; raison_sociale: string }[];
  const soeur = new Map<string, Map<string, string[]>>();
  for (const f of fiches) {
    const m = cleMatricule(f.identifiant);
    const b = m ? parMatricule.get(m) : sansMatricule(f.identifiant) ? parNom.get(cleNom(f.raison_sociale)) : undefined;
    if (!b || b === f.entreprise) continue;
    const de = soeur.get(f.entreprise) ?? new Map<string, string[]>();
    de.set(b, [...(de.get(b) ?? []), f.id]);
    soeur.set(f.entreprise, de);
  }
  return soeur;
}

type PieceLue = { numero: string | null; date: string; type: 'facture' | 'avoir'; montant: string };
export type PieceEntreSocietes = { numero: string; date: string; type: 'facture' | 'avoir'; vendeur: string; acheteur: string;
  chezVendeur: string | null; chezAcheteur: string | null; manque: 'achats' | 'ventes' | null };

// Ce que les sociétés de la liste se vendent et se doivent entre elles, au jour dit, lu dans leurs livres : pour chaque
// société A et chaque société sœur B qui est client ou fournisseur de A, les ventes de A à B (comptes 70) du mois et de
// l'exercice de A, ce que B doit encore à A (411) et ce que A doit encore à B (401), par les écritures rattachées aux
// fiches de B chez A. Puis, pour chaque paire, la dette nette dite par les deux livres, l'écart et les pièces qui
// l'expliquent. Deux sociétés de devises différentes ne se comparent pas (7.0.1).
export async function entreSocietes(tx: Transaction, societes: SocieteDuGroupe[], jour: string) {
  const soeur = await fichesSoeurs(tx, societes);
  const parId = new Map(societes.map((s) => [s.id, s]));
  const mois = `${jour.slice(0, 7)}-01`;
  const liens: { de: string; vers: string; brut: Brut }[] = [];
  const interne = new Map<string, Brut>();
  for (const [a, vers] of soeur) {
    const sa = parId.get(a);
    if (!sa) continue;
    const exercice = debutExercice(jour, sa.debutExerciceMois);
    for (const [b, fiches] of vers) {
      const r = (await sql<{ ca_mois: string; ca_exercice: string; a_encaisser: string; a_payer: string }>`
        select coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${mois}::date then l.credit - l.debit end), 0)::text ca_mois,
               coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${exercice}::date then l.credit - l.debit end), 0)::text ca_exercice,
               coalesce(sum(case when l.compte like '411%' then l.debit - l.credit end), 0)::text a_encaisser,
               coalesce(sum(case when l.compte like '401%' then l.credit - l.debit end), 0)::text a_payer
          from compta.ligne l join compta.ecriture e on e.id = l.ecriture
         where l.entreprise = ${a} and e.date_ecriture <= ${jour}::date and e.tiers = any(${fiches}::uuid[])`.execute(requetes(tx))).rows[0];
      const brut: Brut = { caMois: BigInt(r?.ca_mois ?? 0), caExercice: BigInt(r?.ca_exercice ?? 0), aEncaisser: BigInt(r?.a_encaisser ?? 0), aPayer: BigInt(r?.a_payer ?? 0), tresorerie: 0n };
      liens.push({ de: a, vers: b, brut });
      const t = interne.get(a) ?? ZERO();
      for (const k of Object.keys(brut) as (keyof Brut)[]) t[k] += brut[k];
      interne.set(a, t);
    }
  }

  // Les pièces : les factures et avoirs émis par le vendeur à l'acheteur, les achats de l'acheteur notés comme venant du
  // vendeur, au jour dit ; leur montant est ce qui pèse sur le compte du tiers (le net à payer et la retenue).
  const ventes = async (a: string, fiches: string[]) => (await tx.query(`select numero_texte numero, to_char(date_piece, 'YYYY-MM-DD') date, type,
      (coalesce(net_a_payer, 0) + coalesce(retenue, 0))::text montant from ventes.piece
     where entreprise = $1 and tiers = any($2::uuid[]) and statut = 'emise' and type in ('facture', 'avoir') and date_piece <= $3::date`,
  [a, fiches, jour])).rows as PieceLue[];
  const achats = async (b: string, fiches: string[]) => (await tx.query(`select numero_fournisseur numero, to_char(date_piece, 'YYYY-MM-DD') date,
      case when nature = 'avoir' then 'avoir' else 'facture' end type, (net_a_payer + retenue)::text montant from achats.piece
     where entreprise = $1 and fournisseur = any($2::uuid[]) and nature in ('facture', 'avoir') and date_piece <= $3::date`,
  [b, fiches, jour])).rows as PieceLue[];

  const paires: { creancier: string; debiteur: string; devise: string; selonCreancier: string; selonDebiteur: string; ecart: string; reste: string;
    pieces: PieceEntreSocietes[]; autres: number }[] = [];
  const vus = new Set<string>();
  const lien = (de: string, vers: string) => liens.find((k) => k.de === de && k.vers === vers)?.brut ?? ZERO();
  for (const l of liens) {
    const cle = [l.de, l.vers].sort().join('|');
    if (vus.has(cle)) continue;
    vus.add(cle);
    const [x, y] = [l.de, l.vers];
    const sx = parId.get(x), sy = parId.get(y);
    if (!sx || !sy || sx.devise !== sy.devise) continue;
    // Ce que y doit à x : selon x (son 411 sur y moins son 401 envers y), selon y (son 401 envers x moins son 411 sur x).
    const selonX = lien(x, y).aEncaisser - lien(x, y).aPayer;
    const selonY = lien(y, x).aPayer - lien(y, x).aEncaisser;
    // Le créancier est celui à qui l'on doit (selon ses livres, sinon selon ceux de l'autre) : les montants se disent positifs.
    const yDoit = selonX !== 0n ? selonX > 0n : selonY >= 0n;
    const [c, d] = yDoit ? [x, y] : [y, x];
    const selonC = yDoit ? selonX : -selonY, selonD = yDoit ? selonY : -selonX;
    // Chaque pièce pèse sur « ce que D doit à C » : une vente de C à D l'augmente, une vente de D à C la diminue ; un avoir
    // fait l'inverse de sa facture. Une pièce d'un seul côté explique l'écart de son poids ; un montant différent, de la
    // différence.
    const pieces: (PieceEntreSocietes & { poids: bigint })[] = [];
    for (const [vendeur, acheteur, signe] of [[c, d, 1n], [d, c, -1n]] as const) {
      const fv = soeur.get(vendeur)?.get(acheteur) ?? [], fa = soeur.get(acheteur)?.get(vendeur) ?? [];
      const v = fv.length ? await ventes(vendeur, fv) : [], a = fa.length ? await achats(acheteur, fa) : [];
      const parNumero = new Map(a.filter((p) => cleNumero(p.numero)).map((p) => [cleNumero(p.numero), p]));
      const appariees = new Set<string>();
      for (const p of v) {
        const n = cleNumero(p.numero);
        const sens = (p.type === 'avoir' ? -1n : 1n) * signe;
        const autre = n ? parNumero.get(n) : undefined;
        if (!autre) { pieces.push({ numero: p.numero ?? '', date: p.date, type: p.type, vendeur, acheteur, chezVendeur: p.montant, chezAcheteur: null, manque: 'achats', poids: sens * BigInt(p.montant) }); continue; }
        appariees.add(n);
        const difference = BigInt(p.montant) - BigInt(autre.montant);
        if (difference !== 0n) pieces.push({ numero: p.numero ?? '', date: p.date, type: p.type, vendeur, acheteur, chezVendeur: p.montant, chezAcheteur: autre.montant, manque: null, poids: sens * difference });
      }
      for (const p of a) {
        const n = cleNumero(p.numero);
        if (n && appariees.has(n)) continue;
        const sens = (p.type === 'avoir' ? -1n : 1n) * signe;
        pieces.push({ numero: p.numero ?? '', date: p.date, type: p.type, vendeur, acheteur, chezVendeur: null, chezAcheteur: p.montant, manque: 'ventes', poids: -sens * BigInt(p.montant) });
      }
    }
    const ecart = selonC - selonD;
    const explique = pieces.reduce((t, p) => t + p.poids, 0n);
    const dec = sx.decimales;
    pieces.sort((p, q) => (p.date < q.date ? 1 : p.date > q.date ? -1 : p.numero.localeCompare(q.numero)));
    const montrees = pieces.slice(0, 20).map((p) => ({ numero: p.numero, date: p.date, type: p.type, vendeur: p.vendeur, acheteur: p.acheteur, manque: p.manque,
      chezVendeur: p.chezVendeur === null ? null : versTexte(BigInt(p.chezVendeur), dec), chezAcheteur: p.chezAcheteur === null ? null : versTexte(BigInt(p.chezAcheteur), dec) }));
    paires.push({ creancier: c, debiteur: d, devise: sx.devise, selonCreancier: versTexte(selonC, dec), selonDebiteur: versTexte(selonD, dec),
      ecart: versTexte(ecart, dec), reste: versTexte(ecart - explique, dec), pieces: montrees, autres: Math.max(0, pieces.length - 20) });
  }
  return { liens, interne, paires };
}

type LigneEntreprise = { id: string; raison_sociale: string; matricule_fiscal: string | null; devise_base: string; debut_exercice_mois: number; decimales: number };
const enSociete = (e: LigneEntreprise): SocieteDuGroupe => ({ id: e.id, raisonSociale: e.raison_sociale, matricule: e.matricule_fiscal, devise: e.devise_base,
  decimales: Number(e.decimales), debutExerciceMois: Number(e.debut_exercice_mois) });
const ENTREPRISES = `select e.id, e.raison_sociale, e.matricule_fiscal, e.devise_base, e.debut_exercice_mois, coalesce(d.decimales, 3) decimales
  from socle.entreprise e left join socle.devise d on d.code = e.devise_base where not e.essai`;

// Le dossier d'un client et les autres sociétés que l'on voit et qui sont du même groupe (l'une est client ou
// fournisseur de l'autre, reconnue à son matricule ou à son nom) : ce qu'elles se vendent et se doivent, au jour dit.
// Pour le Cabinet (l'onglet Inventaire d'un dossier) : une société dont les livres ne se montrent pas n'y est pas.
export async function groupeDuDossier(tx: Transaction, qui: QuiAgit, entreprise: string, jour: string) {
  const vide = { jour, societes: [] as { id: string; raisonSociale: string }[], ventes: [] as { de: string; vers: string; deNom: string; versNom: string; caExercice: string }[],
    paires: [] as (Awaited<ReturnType<typeof entreSocietes>>['paires'][number] & { creancierNom: string; debiteurNom: string })[] };
  const ici = ((await tx.query(`${ENTREPRISES} and e.id = $1`, [entreprise])).rows as LigneEntreprise[]).map(enSociete)[0];
  if (!ici) return vide;
  // Les candidates : les autres sociétés visibles qui sont une fiche du dossier, ou dont une fiche est le dossier.
  const fiches = (await tx.query(`select identifiant, raison_sociale from socle.tiers where entreprise = $1`, [entreprise])).rows as { identifiant: string | null; raison_sociale: string }[];
  const matricules = new Set(fiches.map((f) => cleMatricule(f.identifiant)).filter((m): m is string => !!m));
  const noms = new Set(fiches.filter((f) => sansMatricule(f.identifiant)).map((f) => cleNom(f.raison_sociale)));
  const autres = ((await tx.query(`${ENTREPRISES} and e.id <> $1`, [entreprise])).rows as LigneEntreprise[]).map(enSociete);
  const moi = cleMatricule(ici.matricule);
  const fichesDeMoi = (await tx.query(`select entreprise, identifiant, raison_sociale from socle.tiers where entreprise = any($1::uuid[])`, [autres.map((s) => s.id)])).rows as
    { entreprise: string; identifiant: string | null; raison_sociale: string }[];
  const meConnaissent = new Set(fichesDeMoi.filter((f) => (moi && cleMatricule(f.identifiant) === moi) || (sansMatricule(f.identifiant) && cleNom(f.raison_sociale) === cleNom(ici.raisonSociale)))
    .map((f) => f.entreprise));
  const soeurs: SocieteDuGroupe[] = [];
  for (const s of autres) {
    const m = cleMatricule(s.matricule);
    if (!((m && matricules.has(m)) || noms.has(cleNom(s.raisonSociale)) || meConnaissent.has(s.id))) continue;
    if ((await peut(tx, qui, s.id, 'compta.livres.voir', false)).ok) soeurs.push(s);
  }
  if (!soeurs.length) return vide;
  const r = await entreSocietes(tx, [ici, ...soeurs], jour);
  const decimalesDe = (id: string) => (soeurs.find((s) => s.id === id) ?? ici).decimales;
  const nom = (id: string) => (soeurs.find((s) => s.id === id) ?? ici).raisonSociale;
  const autre = (a: string, b: string) => nom(a === entreprise ? b : a);
  return {
    jour,
    societes: soeurs.map((s) => ({ id: s.id, raisonSociale: s.raisonSociale })).sort((u, v) => u.raisonSociale.localeCompare(v.raisonSociale, 'fr')),
    // Ce que ce dossier a vendu à chacune sur son exercice, et ce que chacune lui a vendu sur le sien.
    ventes: r.liens.filter((l) => (l.de === entreprise || l.vers === entreprise) && l.brut.caExercice !== 0n)
      .map((l) => ({ de: l.de, vers: l.vers, deNom: nom(l.de), versNom: nom(l.vers), caExercice: versTexte(l.brut.caExercice, decimalesDe(l.de)) }))
      .sort((u, v) => parNoms(autre(u.de, u.vers), u.deNom, autre(v.de, v.vers), v.deNom)),
    paires: r.paires.filter((p) => p.creancier === entreprise || p.debiteur === entreprise)
      .map((p) => ({ ...p, creancierNom: nom(p.creancier), debiteurNom: nom(p.debiteur) }))
      .sort((u, v) => autre(u.creancier, u.debiteur).localeCompare(autre(v.creancier, v.debiteur), 'fr')),
  };
}

export function routesGroupe(_ctx: Contexte, maintenant: () => Date = () => new Date()): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/moi/groupe', geste: 'compte.voir',
    traiter: async ({ qui }, tx) => {
      if (!qui || !tx) throw new Error('session attendue');
      const jour = aujourdhuiATunis(maintenant());
      const mois = `${jour.slice(0, 7)}-01`;
      const entreprises = ((await tx.query(`select e.id, e.raison_sociale, e.matricule_fiscal, e.devise_base, e.debut_exercice_mois, coalesce(d.decimales, 3) decimales
          from socle.entreprise e left join socle.devise d on d.code = e.devise_base
         where not e.essai and socle.perimetre_cabinet(e.id) is null order by e.raison_sociale, e.id`)).rows as LigneEntreprise[]).map(enSociete);
      const societes: { id: string; raisonSociale: string; devise: string; exerciceDepuis: string; chiffres: Chiffres | null; entreSocietes?: Chiffres; motif?: ReturnType<typeof motif> }[] = [];
      const lisibles: SocieteDuGroupe[] = [];
      const bruts = new Map<string, Brut>();
      for (const e of entreprises) {
        const exercice = debutExercice(jour, e.debutExerciceMois);
        const d = await peut(tx, qui, e.id, 'compta.livres.voir', false);
        if (!d.ok) { societes.push({ id: e.id, raisonSociale: e.raisonSociale, devise: e.devise, exerciceDepuis: exercice, chiffres: null, motif: motif('groupe.sans_chiffres') }); continue; }
        const r = (await sql<{ ca_mois: string; ca_exercice: string; a_encaisser: string; a_payer: string; tresorerie: string }>`
          select coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${mois}::date then l.credit - l.debit end), 0)::text ca_mois,
                 coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${exercice}::date then l.credit - l.debit end), 0)::text ca_exercice,
                 coalesce(sum(case when l.compte like '411%' then l.debit - l.credit end), 0)::text a_encaisser,
                 coalesce(sum(case when l.compte like '401%' then l.credit - l.debit end), 0)::text a_payer,
                 coalesce(sum(case when l.compte like '5%' then l.debit - l.credit end), 0)::text tresorerie
            from compta.ligne l join compta.ecriture e on e.id = l.ecriture
           where l.entreprise = ${e.id} and e.date_ecriture <= ${jour}::date`.execute(requetes(tx))).rows[0];
        const brut: Brut = { caMois: BigInt(r?.ca_mois ?? 0), caExercice: BigInt(r?.ca_exercice ?? 0),
          aEncaisser: BigInt(r?.a_encaisser ?? 0), aPayer: BigInt(r?.a_payer ?? 0), tresorerie: BigInt(r?.tresorerie ?? 0) };
        bruts.set(e.id, brut);
        societes.push({ id: e.id, raisonSociale: e.raisonSociale, devise: e.devise, exerciceDepuis: exercice, chiffres: enTexte(brut, e.decimales) });
        lisibles.push(e);
      }
      // (1.324.0) Ce que les sociétés se vendent et se doivent entre elles, dit pour chacune et retiré du total du groupe.
      const entre = await entreSocietes(tx, lisibles, jour);
      const totaux = new Map<string, { decimales: number; somme: Brut; interne: Brut }>();
      for (const s of lisibles) {
        const brut = bruts.get(s.id) ?? ZERO(), interne = entre.interne.get(s.id) ?? ZERO();
        const ligne = societes.find((x) => x.id === s.id);
        if (ligne && entre.interne.has(s.id)) ligne.entreSocietes = enTexte(interne, s.decimales);
        const t = totaux.get(s.devise) ?? { decimales: s.decimales, somme: ZERO(), interne: ZERO() };
        for (const k of Object.keys(brut) as (keyof Brut)[]) { t.somme[k] += brut[k]; t.interne[k] += interne[k]; }
        totaux.set(s.devise, t);
      }
      const nom = new Map(lisibles.map((s) => [s.id, s.raisonSociale]));
      const decimalesDe = (id: string) => lisibles.find((s) => s.id === id)?.decimales ?? 3;
      return { corps: { jour, societes,
        totaux: [...totaux].map(([devise, t]) => {
          const groupe = ZERO();
          for (const k of Object.keys(groupe) as (keyof Brut)[]) groupe[k] = t.somme[k] - t.interne[k];
          return { devise, chiffres: enTexte(t.somme, t.decimales), entreSocietes: enTexte(t.interne, t.decimales), groupe: enTexte(groupe, t.decimales) };
        }),
        // Les ventes de l'exercice d'une société à une autre, et les dettes des unes envers les autres, comparées.
        ventes: entre.liens.filter((l) => l.brut.caExercice !== 0n).map((l) => ({ de: l.de, vers: l.vers, deNom: nom.get(l.de) ?? '', versNom: nom.get(l.vers) ?? '',
          caExercice: versTexte(l.brut.caExercice, decimalesDe(l.de)) })).sort((u, v) => parNoms(u.deNom, u.versNom, v.deNom, v.versNom)),
        paires: entre.paires.map((p) => ({ ...p, creancierNom: nom.get(p.creancier) ?? '', debiteurNom: nom.get(p.debiteur) ?? '' }))
          .sort((u, v) => parNoms(u.creancierNom, u.debiteurNom, v.creancierNom, v.debiteurNom)),
      } };
    },
  });
  return routes;
}
