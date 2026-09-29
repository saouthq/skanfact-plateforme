// Les routes du module Paie : les bulletins (page après page) et la lecture d'un bulletin, avec tout
// ce qui l'a calculé ; la déclaration CNSS d'un trimestre ; la masse salariale (un total, sans nom).
// Les nombres sortent en TEXTE exact (« 1191.000 ») : jamais en nombre à virgule (01 R3).
//
// Des données sensibles (03 D10) : chaque lecture d'un bulletin ou d'une déclaration se trace, et la
// base elle-même ne montre la paie qu'à ceux qui la font (0014).

import { sql } from 'kysely';
import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { cnssDuTrimestre, type Bulletin } from '../../moteur/paie.ts';
import type { Route } from '../app.ts';
import { requetes } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { appliquer, type Changement } from '../v10/dossier.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';

const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
const uuid = z.string().uuid();
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
// La page suivante se demande par un curseur opaque : la période du dernier bulletin vu (« 2026-09 »),
// puis son identifiant, qui départage deux bulletins du même mois.
const versCurseur = (periode: string, id: string) => Buffer.from(JSON.stringify([periode, id])).toString('base64url');
function depuisCurseur(texte: string | undefined): [string, string] | null {
  if (!texte) return null;
  try {
    const [p, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof p === 'string' && /^\d{4}-\d{2}$/.test(p) && typeof id === 'string' && uuid.safeParse(id).success) return [p, id];
  } catch { /* illisible : on repart du début */ }
  return null;
}
const periodeDe = (annee: number, mois: number) => `${annee}-${String(mois).padStart(2, '0')}`;
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const m = (v: bigint | number) => versTexte(BigInt(v), 3);
const pct = (v: unknown) => versTexte(BigInt(Number(v) || 0), 4);   // un taux en millionièmes, dit en pour cent

// Les deux collections du dossier que la paie tient (brique 43).
const COLLECTIONS_PAIE = ['employees', 'payslips'];
const contenuV10: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(contenuV10), z.record(z.string(), contenuV10)]));
const CHANGEMENTS_PAIE = z.object({
  changements: z.array(z.object({
    collection: z.enum(['employees', 'payslips'], { message: 'paie.champ.collection' }), cle: z.string().min(1).max(200),
    rang: z.number().int().min(0).nullable(), revision: z.number().int().min(1).nullable(), contenu: contenuV10,
  }).strict()).min(1).max(500),
}).strict();

export function routesPaie(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Les bulletins, le mois le plus récent d'abord ; `annee` (et `mois`) les restreignent.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paie/bulletins', geste: 'paie.bulletins.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = query.annee === undefined ? null : Number(query.annee);
      if (annee !== null && !(Number.isInteger(annee) && annee >= 2000 && annee <= 2200)) return champInvalide('annee', t('paie.champ.annee'));
      const mois = query.mois === undefined ? null : Number(query.mois);
      if (mois !== null && !(Number.isInteger(mois) && mois >= 1 && mois <= 12)) return champInvalide('mois', t('paie.champ.mois'));
      const entreprise = params.entreprise ?? '';
      const n = limite(query);
      const avant = depuisCurseur(query.avant);
      const lignes = await requetes(tx).selectFrom('paie.bulletin as b').innerJoin('paie.salarie as s', 's.id', 'b.salarie')
        .select(['b.id', 'b.annee', 'b.mois', 'b.brut', 'b.net', 'b.cout_employeur', 'b.paye_le', 's.id as salarie', 's.nom'])
        .where('b.entreprise', '=', entreprise)
        .$if(annee !== null, (q) => q.where('b.annee', '=', annee ?? 0))
        .$if(mois !== null, (q) => q.where('b.mois', '=', mois ?? 0))
        .$if(avant !== null, (q) => q.where(sql<boolean>`(to_char(make_date(b.annee, b.mois, 1), 'YYYY-MM'), b.id) < (${avant?.[0] ?? ''}, ${avant?.[1] ?? ''}::uuid)`))
        .orderBy('b.annee', 'desc').orderBy('b.mois', 'desc').orderBy('b.id', 'desc').limit(n).execute();
      const { total } = await requetes(tx).selectFrom('paie.bulletin').select((eb) => eb.fn.countAll<string>().as('total'))
        .where('entreprise', '=', entreprise)
        .$if(annee !== null, (q) => q.where('annee', '=', annee ?? 0)).$if(mois !== null, (q) => q.where('mois', '=', mois ?? 0))
        .executeTakeFirstOrThrow();
      const dernier = lignes.at(-1);
      return {
        corps: {
          lignes: lignes.map((l) => ({
            id: l.id, salarie: { id: l.salarie, nom: l.nom }, annee: l.annee, mois: l.mois,
            brut: m(l.brut), net: m(l.net), coutEmployeur: m(l.cout_employeur), payeLe: l.paye_le,
          })),
          suite: lignes.length === n && dernier ? versCurseur(periodeDe(dernier.annee, dernier.mois), dernier.id) : null,
          total: Number(total),
        },
      };
    },
  });

  // Un bulletin : la saisie du mois, la situation du salarié, le barème qui l'a calculé, chaque montant.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paie/bulletins/:bulletin', geste: 'paie.bulletins.voir',
    objetLu: { type: 'bulletin', param: 'bulletin' },
    traiter: async ({ params }, tx) => {
      const introuvable = { statut: 404, corps: { motif: motif('commun.introuvable') } };
      if (!tx || !uuid.safeParse(params.bulletin).success) return introuvable;
      const b = await requetes(tx).selectFrom('paie.bulletin as b').innerJoin('paie.salarie as s', 's.id', 'b.salarie')
        .selectAll('b').select(['s.nom', 's.numero_cnss', 's.poste'])
        .where('b.entreprise', '=', params.entreprise ?? '').where('b.id', '=', params.bulletin ?? '').executeTakeFirst();
      if (!b) return introuvable;
      const bareme = b.bareme as Record<string, unknown> & { tranches?: { jusqua: number | null; taux: number }[] };
      const elements = (l: unknown) => (Array.isArray(l) ? l as { libelle: string; montant: number; imposable?: boolean }[] : [])
        .map((x) => ({ libelle: x.libelle, montant: m(x.montant), ...(x.imposable === undefined ? {} : { imposable: x.imposable }) }));
      return {
        corps: {
          id: b.id, annee: b.annee, mois: b.mois,
          salarie: { id: b.salarie, nom: b.nom, numeroCnss: b.numero_cnss, poste: b.poste },
          saisie: {
            brutDeBase: m(b.brut_de_base), joursOuvrables: m(b.jours_ouvrables), joursAbsence: m(b.jours_absence),
            primes: elements(b.primes), retenues: elements(b.retenues),
          },
          situation: { contrat: b.contrat, chefDeFamille: b.chef_de_famille, enfants: b.enfants },
          // Les taux en pour cent (« 9.1800 »), les montants en dinars.
          bareme: {
            cnssSalarie: pct(bareme.cnssSalarie), cnssEmployeur: pct(bareme.cnssEmployeur), accidentTravail: pct(bareme.accidentTravail),
            tfp: pct(bareme.tfp), foprolos: pct(bareme.foprolos), solidarite: pct(bareme.solidarite), fraisPro: pct(bareme.fraisPro),
            plafondFraisPro: m(Number(bareme.plafondFraisPro) || 0), chefDeFamille: m(Number(bareme.chefDeFamille) || 0), parEnfant: m(Number(bareme.parEnfant) || 0),
            enfantsMax: Number(bareme.enfantsMax) || 0, sansIrpp: bareme.sansIrpp === true,
            tranches: (bareme.tranches ?? []).map((x) => ({ jusqua: x.jusqua === null ? null : m(x.jusqua), taux: pct(x.taux) })),
          },
          montants: {
            retenueAbsence: m(b.retenue_absence), primesImposables: m(b.primes_imposables), primesNonImposables: m(b.primes_non_imposables),
            brut: m(b.brut), assietteCnss: m(b.assiette_cnss), cnssSalarie: m(b.cnss_salarie), fraisPro: m(b.frais_pro),
            deductionsFamille: m(b.deductions_famille), imposableAnnuel: m(b.imposable_annuel), irppAnnuel: m(b.irpp_annuel), irpp: m(b.irpp),
            css: m(b.css), autresRetenues: m(b.autres_retenues), net: m(b.net),
            cnssEmployeur: m(b.cnss_employeur), accidentTravail: m(b.accident_travail), tfp: m(b.tfp), foprolos: m(b.foprolos),
            chargesPatronales: m(b.charges_patronales), coutEmployeur: m(b.cout_employeur),
          },
          paiement: { payeLe: b.paye_le, mode: b.mode, reference: b.reference },
          revision: Number(b.revision),
        },
      };
    },
  });

  // La déclaration CNSS d'un trimestre (`cnssDeclaration` de la v10) : par salarié, les mois déclarés,
  // les jours travaillés, l'assiette et les cotisations ; puis les totaux. Rangée par nom, comme l'écran.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paie/cnss', geste: 'paie.declarations.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = Number(query.annee), trimestre = Number(query.trimestre);
      if (!(Number.isInteger(annee) && annee >= 2000 && annee <= 2200)) return champInvalide('annee', t('paie.champ.annee'));
      if (!(Number.isInteger(trimestre) && trimestre >= 1 && trimestre <= 4)) return champInvalide('trimestre', t('champ.choix', { valeurs: '1, 2, 3, 4' }));
      const premier = (trimestre - 1) * 3 + 1;
      const lus = await requetes(tx).selectFrom('paie.bulletin as b').innerJoin('paie.salarie as s', 's.id', 'b.salarie')
        .select(['b.salarie', 's.nom', 's.numero_cnss', 'b.annee', 'b.mois', 'b.jours_ouvrables', 'b.jours_absence', 'b.assiette_cnss', 'b.cnss_salarie', 'b.cnss_employeur', 'b.accident_travail'])
        .where('b.entreprise', '=', params.entreprise ?? '').where('b.annee', '=', annee).where('b.mois', '>=', premier).where('b.mois', '<', premier + 3)
        .orderBy('b.mois').orderBy('b.cree_le').orderBy('b.id').execute();
      const d = cnssDuTrimestre(lus.map((l) => ({
        salarie: l.salarie, annee: l.annee, mois: l.mois, joursOuvrables: l.jours_ouvrables, joursAbsence: l.jours_absence,
        bulletin: { assietteCnss: l.assiette_cnss, cnssSalarie: l.cnss_salarie, cnssEmployeur: l.cnss_employeur, accidentTravail: l.accident_travail } as Bulletin,
      })), annee, trimestre);
      const fiches = new Map(lus.map((l) => [l.salarie, { nom: l.nom, numeroCnss: l.numero_cnss }]));
      return {
        corps: {
          annee, trimestre, bulletins: d.bulletins,
          lignes: d.lignes.map((l) => ({
            salarie: { id: l.salarie, ...fiches.get(l.salarie) }, mois: l.mois, jours: m(l.jours),
            assiette: m(l.assiette), partSalarie: m(l.partSalarie), partEmployeur: m(l.partEmployeur), accident: m(l.accident), total: m(l.total),
          })).sort((a, b) => String(a.salarie.nom ?? '').localeCompare(String(b.salarie.nom ?? ''), 'fr')),
          totaux: { assiette: m(d.assiette), partSalarie: m(d.partSalarie), partEmployeur: m(d.partEmployeur), accident: m(d.accident), total: m(d.total) },
        },
      };
    },
  });

  // La masse salariale d'une période : un total, sans un seul nom (la comptabilité interne la voit).
  // Un bulletin compte au dernier jour de son mois, comme dans la v10.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paie/masse', geste: 'paie.masse.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = (v: string | undefined) => (v !== undefined && JOUR.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null);
      const du = jour(query.du), au = jour(query.au);
      if (!du) return champInvalide('du', t('champ.jour'));
      if (!au) return champInvalide('au', t('champ.jour'));
      if (au < du) return champInvalide('au', t('paie.champ.fin_avant_debut'));
      const r = (await sql<{ bulletins: string; brut: string; net: string; charges_patronales: string; cout_employeur: string }>`
        select * from paie.masse_salariale(${params.entreprise ?? ''}::uuid, ${du}::date, ${au}::date)`.execute(requetes(tx))).rows[0];
      const x = (v: string | undefined) => m(BigInt(v ?? '0'));
      return { corps: { du, au, bulletins: Number(r?.bulletins ?? 0), brut: x(r?.brut), net: x(r?.net), chargesPatronales: x(r?.charges_patronales), coutEmployeur: x(r?.cout_employeur) } };
    },
  });

  // ── Les salariés et les bulletins du dossier (brique 43 ; docs/cabinet.md, C31) ──────────────────
  // Ce que le Cabinet lit et écrit de la paie d'un client : les deux collections du dossier que la
  // paie tient (`employees`, `payslips`), rien d'autre. L'enregistrement passe par le même chemin que
  // celui du client (serveur/v10/dossier.ts, `appliquer`) : chaque bulletin y est recalculé par le
  // moteur du serveur, au millime, et ses écritures du mois suivent.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paie/dossier', geste: 'paie.dossier.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const objets = (await tx.query(`select collection, cle, rang, revision, contenu from socle.dossier_v10
          where entreprise = $1 and collection = any($2::text[]) order by collection, rang, cle`, [params.entreprise ?? '', COLLECTIONS_PAIE])).rows;
      return { corps: { objets: objets.map((o) => ({ collection: o.collection, cle: o.cle, rang: o.rang, revision: Number(o.revision), contenu: o.contenu })) } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/paie/dossier', geste: 'paie.dossier.modifier', corps: CHANGEMENTS_PAIE,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      return { corps: { revisions: await appliquer(tx, params.entreprise ?? '', qui.utilisateur, corps.changements as Changement[]) } };
    },
  });

  return routes;
}
