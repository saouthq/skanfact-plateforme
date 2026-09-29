// Les écritures de la paie, tenues par le serveur (brique 34 ; docs/ecritures.md), EN TOTAUX DU MOIS
// (03 § 2.1, « Livres, balance » : la comptabilité interne lit les livres, jamais un salaire nommé).
// La v10 écrit une écriture par bulletin, au nom du salarié ; le serveur écrit, pour chaque mois :
//   - une écriture de paie (journal PAIE, au dernier jour du mois) : la somme des bulletins du mois,
//     compte par compte (`ecritureDeBulletin` du moteur, sur les totaux) ;
//   - les salaires versés, un total par jour et par compte de trésorerie (`ecritureDePaiementSalaire`) ;
//   - les avances sur salaire versées ce mois-là, un total par jour et par compte de trésorerie.
// Aucun nom, aucune pièce qui désigne un salarié. Le mois est la FAMILLE (D2) : chaque enregistrement
// qui touche un bulletin ou une avance réécrit le mois d'avant et le mois d'après.

import { createHash } from 'node:crypto';
import { ecritureDeBulletin, ecritureDePaiementSalaire } from '../../moteur/paie.ts';
import { requetes, type Transaction } from '../base.ts';
import { exact, estJour, estObjet } from '../v10/lecture.ts';
import { ecrireFamille, libelle, type EcritureAEcrire } from './ecrire.ts';
import { journalDeCompte, lirePlan, type PlanDuDossier } from './plan.ts';

export type Mois = { annee: number; mois: number };
const deuxChiffres = (n: number) => String(n).padStart(2, '0');
export const cleDuMois = (m: Mois) => `${m.annee}-${deuxChiffres(m.mois)}`;
const dernierJour = (m: Mois) => `${cleDuMois(m)}-${deuxChiffres(new Date(Date.UTC(m.annee, m.mois, 0)).getUTCDate())}`;
// Un identifiant stable, tiré de ce qu'il nomme : le même mois donne toujours la même famille.
function identifiant(...parties: string[]): string {
  const h = createHash('sha256').update(parties.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export const familleDuMois = (entreprise: string, m: Mois) => identifiant(entreprise, 'paie', cleDuMois(m));

// « 09/2026 » : le mois se dit en chiffres, dans toutes les langues.
const periode = (m: Mois) => `${deuxChiffres(m.mois)}/${m.annee}`;

// Une avance sur salaire du dossier (`advances` de la v10) : sa date, son montant, d'où l'argent part.
// Illisible (pas une date, un montant négatif ou à plus de trois décimales) : 'illisible', que
// l'enregistrement refuse ; nulle : rien à écrire (comme la v10).
export type AvanceLue = { date: string; montant: bigint; compte: string | null; mode: string };
export function lireAvance(a: unknown): AvanceLue | 'illisible' | null {
  if (!estObjet(a) || !estJour(a.date)) return 'illisible';
  const montant = exact(a.amount ?? 0, 3);
  if (montant === null || montant < 0n) return 'illisible';
  if (montant === 0n) return null;
  return { date: a.date as string, montant, compte: typeof a.accountId === 'string' && a.accountId !== '' ? a.accountId : null, mode: typeof a.method === 'string' ? a.method : '' };
}
const lisible = (a: AvanceLue | 'illisible' | null): a is AvanceLue => a !== null && a !== 'illisible';
export const moisDe = (jour: string): Mois => ({ annee: Number(jour.slice(0, 4)), mois: Number(jour.slice(5, 7)) });

// Les écritures d'un mois, sans rien écrire (ce que le test confronte à la v10).
export async function ecrituresDuMois(tx: Transaction, entreprise: string, m: Mois, plan: PlanDuDossier): Promise<EcritureAEcrire[]> {
  const P = plan.plan;
  const famille = familleDuMois(entreprise, m);
  const piece = `PAIE-${cleDuMois(m)}`;
  const ecritures: { date: string; ordre: number; e: EcritureAEcrire }[] = [];
  let ordre = 0;

  // 1. La paie du mois : la somme de ses bulletins (le moteur refuse un total nul ou négatif, que la
  //    base refuse déjà bulletin par bulletin).
  const t = (await tx.query(`select count(*)::int n, coalesce(sum(brut), 0)::text brut, coalesce(sum(net), 0)::text net,
      coalesce(sum(cnss_salarie), 0)::text cnss_salarie, coalesce(sum(cnss_employeur), 0)::text cnss_employeur,
      coalesce(sum(accident_travail), 0)::text accident_travail, coalesce(sum(tfp), 0)::text tfp, coalesce(sum(foprolos), 0)::text foprolos,
      coalesce(sum(irpp), 0)::text irpp, coalesce(sum(css), 0)::text css, coalesce(sum(autres_retenues), 0)::text autres_retenues
    from paie.bulletin where entreprise = $1 and annee = $2 and mois = $3`, [entreprise, m.annee, m.mois])).rows[0] as Record<string, string | undefined> & { n: number };
  if (t.n > 0) {
    const v = (k: string) => BigInt(t[k] ?? '0');
    const b = {
      brut: v('brut'), net: v('net'), cnssSalarie: v('cnss_salarie'), cnssEmployeur: v('cnss_employeur'), accidentTravail: v('accident_travail'),
      tfp: v('tfp'), foprolos: v('foprolos'), irpp: v('irpp'), css: v('css'), autresRetenues: v('autres_retenues'),
    };
    const e = ecritureDeBulletin(b, {
      salairesBruts: P.salairesBruts, chargesPatronales: P.chargesPatronales, taxesSalaires: P.taxesSalaires, tfpFoprolos: P.tfpFoprolos,
      cnss: P.cnss, irpp: P.irpp, personnel: P.personnel,
    });
    const entree = libelle('compta.libelle.paie', { periode: periode(m) });
    ecritures.push({ date: dernierJour(m), ordre: ordre++, e: {
      journal: 'PAIE', date: dernierJour(m), origineType: 'paie', origine: famille, piece, tiers: null, libelle: entree,
      lignes: e.lignes.map((l) => ({ ...l, libelle: entree, tauxTva: null })),
    } });
  }

  // 2. Les salaires versés : un total par jour et par compte de trésorerie.
  const verses = new Map<string, { date: string; journal: 'BQ' | 'CA'; compte: string; montant: bigint }>();
  const payes = await requetes(tx).selectFrom('paie.bulletin').select(['paye_le', 'mode', 'compte', 'net'])
    .where('entreprise', '=', entreprise).where('annee', '=', m.annee).where('mois', '=', m.mois).where((eb) => eb.not(eb('paye_le', 'is', null)))
    .orderBy('paye_le').orderBy('id').execute();
  for (const p of payes) {
    if (p.net <= 0n || !p.paye_le) continue;
    const j = journalDeCompte(plan, p.compte, p.mode ?? '');
    const cle = `${p.paye_le}/${j.journal}/${j.compte}`;
    const v = verses.get(cle) ?? { date: p.paye_le, ...j, montant: 0n };
    v.montant += p.net;
    verses.set(cle, v);
  }
  for (const [cle, v] of verses) {
    const entree = libelle('compta.libelle.salaires_verses', { periode: periode(m) });
    ecritures.push({ date: v.date, ordre: ordre++, e: {
      journal: v.journal, date: v.date, origineType: 'salaires', origine: identifiant(famille, 'salaires', cle), piece, tiers: null, libelle: entree,
      lignes: ecritureDePaiementSalaire(v.montant, { personnel: P.personnel, tresorerie: v.compte }).lignes.map((l) => ({ ...l, libelle: entree, tauxTva: null })),
    } });
  }

  // 3. Les avances sur salaire versées ce mois-là : un total par jour et par compte de trésorerie.
  const avances = new Map<string, { date: string; journal: 'BQ' | 'CA'; compte: string; montant: bigint }>();
  const du = `${cleDuMois(m)}-01`, au = dernierJour(m);
  const objets = await requetes(tx).selectFrom('socle.dossier_v10').select('contenu').where('entreprise', '=', entreprise).where('collection', '=', 'advances')
    .orderBy('rang').orderBy('cle').execute();
  for (const o of objets) {
    const a = lireAvance(o.contenu);
    if (!lisible(a) || a.date < du || a.date > au) continue;
    const j = journalDeCompte(plan, a.compte, a.mode);
    const cle = `${a.date}/${j.journal}/${j.compte}`;
    const v = avances.get(cle) ?? { date: a.date, ...j, montant: 0n };
    v.montant += a.montant;
    avances.set(cle, v);
  }
  for (const [cle, v] of avances) {
    const entree = libelle('compta.libelle.avances', { periode: periode(m) });
    ecritures.push({ date: v.date, ordre: ordre++, e: {
      journal: v.journal, date: v.date, origineType: 'avance', origine: identifiant(famille, 'avances', cle), piece: `AVANCE-${v.date}`, tiers: null, libelle: entree,
      lignes: ecritureDePaiementSalaire(v.montant, { personnel: P.personnel, tresorerie: v.compte }).lignes.map((l) => ({ ...l, libelle: entree, tauxTva: null })),
    } });
  }
  return ecritures.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.ordre - y.ordre)).map((x) => x.e);
}

// Réécrit le brouillard des mois nommés. Qui enregistre la paie la voit (le dossier ne s'ouvre qu'au
// propriétaire et à l'administrateur) : si ce n'était pas le cas, les totaux lus seraient vides et le
// brouillard s'effacerait. Le serveur refuse plutôt que d'écrire un mois faux.
export async function reecrireLesMois(tx: Transaction, entreprise: string, mois: Iterable<Mois>, plan?: PlanDuDossier): Promise<void> {
  const liste = [...new Map([...mois].map((m) => [cleDuMois(m), m])).values()];
  if (!liste.length) return;
  const voit = (await tx.query('select $1::uuid in (select paie.mes_entreprises()) voit', [entreprise])).rows[0]?.voit === true;
  if (!voit) throw new Error('les écritures de la paie se réécrivent par qui voit la paie');
  const p = plan ?? await lirePlan(tx, entreprise);
  for (const m of liste) await ecrireFamille(tx, entreprise, familleDuMois(entreprise, m), await ecrituresDuMois(tx, entreprise, m, p));
}

// Tous les mois de la paie (le plan a changé : D3) : ceux qui ont un bulletin ou une avance.
export async function reecrireLaPaie(tx: Transaction, entreprise: string): Promise<number> {
  const mois: Mois[] = (await requetes(tx).selectFrom('paie.bulletin').select(['annee', 'mois']).distinct().where('entreprise', '=', entreprise).execute())
    .map((b) => ({ annee: b.annee, mois: b.mois }));
  for (const o of await requetes(tx).selectFrom('socle.dossier_v10').select('contenu').where('entreprise', '=', entreprise).where('collection', '=', 'advances').execute()) {
    const a = lireAvance(o.contenu);
    if (lisible(a)) mois.push(moisDe(a.date));
  }
  if (!mois.length) return 0;
  await reecrireLesMois(tx, entreprise, mois);
  return new Set(mois.map(cleDuMois)).size;
}
