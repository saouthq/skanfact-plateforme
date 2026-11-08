// L'inventaire de stock (brique 42 bis ; docs/cabinet.md, C30). La variation se calcule dans le
// navigateur, par la v10, sur le livre du serveur ; le serveur garde l'inventaire d'une année (ses
// lignes, et son total qu'il calcule lui-même) et le lien vers l'écriture de variation. La base refait
// chaque contrôle (compta.poser_inventaire, compta.ecrire_variation_stock, migration 0027).

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { groupeDuDossier } from '../groupe.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { motif, t } from '../../textes/index.ts';
import { ECRITURE, estJour, versLaBase } from './saisie.ts';
import './textes.ts';

const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const anneeDe = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1900 && n <= 2999 ? n : null; };
const INVENTAIRE = z.object({
  date: z.string().refine(estJour, { message: 'champ.jour' }),
  compte: z.string().max(12),
  lignes: z.array(z.object({ ref: z.string().max(60).default(''), libelle: z.string().max(200), quantite: z.string().max(30), cout: z.string().max(30),
    valeur: z.string().max(30).optional() }).strict()).max(10000),
}).strict();

// (1.319.0) L'état du stock que le client a envoyé (`etatsStock` de son dossier, 0200) → ce que son cabinet en lit : la date,
// quand et par qui il est parti, et ses lignes. Un nombre non entier y est rangé en texte exact (`{ "~n": "61.667" }`,
// pont.js) : il ressort tel quel. Rien d'autre de l'article (ni son prix de vente, ni son fournisseur) ne sort ; ce qui est
// reçu sans facture (1.320.0) dit le fournisseur de chaque réception, que le comptable connaît déjà par ses achats.
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texteDe = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const nombreV10 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v)
  : estObjet(v) && typeof v['~n'] === 'string' ? v['~n'] : '0');
// (1.321.0) L'état des impayés que le client a envoyé (0201) : chaque facture en retard, son reste (TTC et HT), son retard,
// ses relances et le litige noté. Rien d'autre de la facture (ni ses lignes, ni ses prix) ne sort.
function impayesDuClient(e: Record<string, unknown>) {
  const lignes = (Array.isArray(e.lignes) ? e.lignes : []).filter(estObjet).slice(0, 5000).map((l) => ({
    numero: texteDe(l.numero).slice(0, 60), date: texteDe(l.date).slice(0, 10), echeance: texteDe(l.echeance).slice(0, 10),
    client: texteDe(l.client).slice(0, 200), retard: nombreV10(l.retard), resteTTC: nombreV10(l.resteTTC), resteHT: nombreV10(l.resteHT),
    relances: nombreV10(l.relances), derniereRelance: texteDe(l.derniereRelance).slice(0, 10),
    litige: texteDe(l.litige).slice(0, 500), litigeDepuis: texteDe(l.litigeDepuis).slice(0, 10),
  }));
  return { date: texteDe(e.date).slice(0, 10), envoyeLe: texteDe(e.envoyeLe).slice(0, 40), total: nombreV10(e.total), contestees: nombreV10(e.contestees), lignes };
}
// (1.322.0) Le parc sous garantie envoyé par le client, champ par champ : par article, combien d'appareils, leur valeur de
// vente hors taxes, la garantie la plus longue ; les ventes garanties de l'année. Ni client ni numéro de série.
function garantiesDuClient(e: Record<string, unknown>) {
  const articles = (Array.isArray(e.articles) ? e.articles : []).filter(estObjet).slice(0, 2000).map((a) => ({
    libelle: texteDe(a.libelle).slice(0, 200), nombre: nombreV10(a.nombre), ht: nombreV10(a.ht), fin: texteDe(a.fin).slice(0, 10),
  }));
  const an = estObjet(e.annee) ? e.annee : {};
  return { date: texteDe(e.date).slice(0, 10), envoyeLe: texteDe(e.envoyeLe).slice(0, 40), nombre: nombreV10(e.nombre), clients: nombreV10(e.clients),
    ht: nombreV10(e.ht), articles, annee: { nombre: nombreV10(an.nombre), ht: nombreV10(an.ht) } };
}
function etatDuClient(e: Record<string, unknown>) {
  const lignes = (Array.isArray(e.lignes) ? e.lignes : []).filter(estObjet).slice(0, 10000).map((l) => ({
    ref: texteDe(l.ref).slice(0, 60), libelle: texteDe(l.libelle).slice(0, 200), unite: texteDe(l.unite).slice(0, 20),
    quantite: nombreV10(l.quantite), cout: nombreV10(l.cout), valeur: nombreV10(l.valeur),
  }));
  // (1.320.0) Ce qui était reçu sans facture à cette date : chaque réception, son fournisseur et sa valeur hors taxes.
  const sf = estObjet(e.sansFacture) ? e.sansFacture : {};
  const receptions = (Array.isArray(sf.receptions) ? sf.receptions : []).filter(estObjet).slice(0, 2000).map((r) => ({
    numero: texteDe(r.numero).slice(0, 60), date: texteDe(r.date).slice(0, 10), fournisseur: texteDe(r.fournisseur).slice(0, 200),
    commande: texteDe(r.commande).slice(0, 60), ht: nombreV10(r.ht),
  }));
  return { date: texteDe(e.date).slice(0, 10), envoyeLe: texteDe(e.envoyeLe).slice(0, 40), par: texteDe(e.par).slice(0, 120), total: nombreV10(e.total), lignes,
    sansFacture: { total: nombreV10(sf.total), receptions } };
}

export function routesInventaire(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/inventaires/:annee', geste: 'compta.livres.voir',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const x = (await tx.query(`select to_char(date_inventaire, 'YYYY-MM-DD') date, compte, lignes, total,
          case when compta.ecriture_vivante(ecriture) then ecriture end ecriture from compta.inventaire where entreprise = $1 and annee = $2`,
      [params.entreprise ?? '', annee])).rows[0];
      // (1.319.0) Les états du stock que le client a envoyés pour cette année (0200), le plus récent d'abord.
      const etats = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'etatsStock'
          and contenu->>'date' like $2 order by contenu->>'date' desc, cle collate "C"`, [params.entreprise ?? '', `${annee}-%`])).rows
        .filter((e) => estObjet(e.contenu)).map((e) => etatDuClient(e.contenu as Record<string, unknown>));
      // (1.321.0) L'état des impayés que le client a envoyé (0201), le dernier.
      const impayes = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'etatsImpayes'
          order by contenu->>'envoyeLe' desc limit 1`, [params.entreprise ?? ''])).rows
        .filter((e) => estObjet(e.contenu)).map((e) => impayesDuClient(e.contenu as Record<string, unknown>))[0] ?? null;
      // (1.322.0) Le parc sous garantie que le client a envoyé pour cette année (0202), à la date la plus tardive.
      const garanties = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'etatsGaranties'
          and contenu->>'date' like $2 order by contenu->>'date' desc limit 1`, [params.entreprise ?? '', `${annee}-%`])).rows
        .filter((e) => estObjet(e.contenu)).map((e) => garantiesDuClient(e.contenu as Record<string, unknown>))[0] ?? null;
      return {
        corps: {
          inventaire: x ? {
            annee, date: x.date, compte: x.compte, total: versTexte(BigInt(x.total), 3), ecriture: x.ecriture ?? null,
            lignes: (x.lignes as { ref: string; libelle: string; quantite: number; cout: number; valeur?: number }[]).map((l) => ({
              ref: l.ref, libelle: l.libelle, quantite: versTexte(BigInt(l.quantite), 3), cout: versTexte(BigInt(l.cout), 3),
              ...(typeof l.valeur === 'number' ? { valeur: versTexte(BigInt(l.valeur), 3) } : {}),
            })),
          } : null,
          duClient: etats, impayes, garanties,
          // (1.324.0) Les sociétés du même groupe que ce dossier, que le cabinet tient aussi : ce qu'elles se sont vendu sur
          // l'exercice et ce qu'elles se doivent au dernier jour de l'année (ou aujourd'hui, l'année en cours), lu des deux côtés.
          groupe: await groupeDuDossier(tx, qui, params.entreprise ?? '', [`${annee}-12-31`, aujourdhuiATunis(new Date())].sort()[0] ?? `${annee}-12-31`),
        },
      };
    },
  });

  // Saisir (ou refaire) l'inventaire d'une année : ses lignes, la quantité et le coût en texte exact.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/inventaires/:annee', geste: 'compta.ecritures.saisir', corps: INVENTAIRE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const lignes = [];
      for (const [i, l] of corps.lignes.entries()) {
        let quantite: bigint, cout: bigint, valeur: bigint | null = null;
        try { quantite = depuisTexte(l.quantite, 3); } catch { return champInvalide(`lignes.${i}.quantite`, t('compta.champ.quantite')); }
        try { cout = depuisTexte(l.cout, 3); } catch { return champInvalide(`lignes.${i}.cout`, t('compta.champ.montant')); }
        if (l.valeur !== undefined) { try { valeur = depuisTexte(l.valeur, 3); } catch { return champInvalide(`lignes.${i}.valeur`, t('compta.champ.montant')); } }
        lignes.push({ ref: l.ref, libelle: l.libelle.trim(), quantite: Number(quantite), cout: Number(cout), ...(valeur === null ? {} : { valeur: Number(valeur) }) });
      }
      const total = (await tx.query('select compta.poser_inventaire($1, $2, $3::jsonb) total', [params.entreprise ?? '', annee,
        JSON.stringify({ date: corps.date, compte: corps.compte.trim(), lignes })])).rows[0].total;
      return { corps: { total: versTexte(BigInt(total), 3) } };
    },
  });

  // La variation de stock de l'année, au brouillard, liée à l'inventaire.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/inventaires/:annee/variation', geste: 'compta.ecritures.valider',
    corps: z.object({ ecriture: ECRITURE }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = anneeDe(params.annee);
      if (annee === null) return champInvalide('annee', t('compta.champ.annee'));
      const e = versLaBase(corps.ecriture);
      if ('statut' in e) return e;
      const id = (await tx.query('select compta.ecrire_variation_stock($1, $2, $3::jsonb) id', [params.entreprise ?? '', annee, e.json])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  return routes;
}
