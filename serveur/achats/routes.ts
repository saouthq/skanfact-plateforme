// Les routes du module Achats : la liste des achats (page après page) et la lecture d'un achat, avec
// ses lignes, ses montants, ce qu'il doit encore, son statut et la retenue de chaque règlement ; et la
// lecture d'une facture d'achat en photo ou en PDF (brique 84).
// Les nombres sortent en TEXTE exact (« 1191.000 ») : jamais en nombre à virgule (01 R3).

import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { versLaBase } from '../../moteur/ecritures.ts';
import type { Route } from '../app.ts';
import { requetes } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { objetDuDossier } from '../v10/lecture.ts';
import { etatsDAchats } from './etat.ts';
import { lireFacture } from './lecture-facture.ts';
import { LecteurOccupe, LectureImpossible, LectureTropLongue, sorteDe } from './lecteur.ts';
import './textes.ts';

const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
const uuid = z.string().uuid();
const NATURES = ['facture', 'depense', 'avoir', 'acompte'] as const;
// La page suivante se demande par un curseur opaque : la date de la dernière pièce vue, puis son
// identifiant, qui départage deux pièces du même jour (jamais une pièce sautée ni vue deux fois).
const versCurseur = (cle: string, id: string) => Buffer.from(JSON.stringify([cle, id])).toString('base64url');
function depuisCurseur(texte: string | undefined): [string, string] | null {
  if (!texte) return null;
  try {
    const [c, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c) && typeof id === 'string' && uuid.safeParse(id).success) return [c, id];
  } catch { /* illisible : on repart du début */ }
  return null;
}
const TND = { code: 'TND', decimales: 3 };
// Une photo de téléphone pèse quelques Mo ; au-delà de 10 Mo, ce n'est plus une facture (la v10 avait la
// même limite). Le corps porte le fichier en base 64 (un tiers de plus) : il est accepté jusqu'à 16 Mo,
// pour qu'un fichier un peu trop lourd reçoive sa phrase (« il fait 11 Mo ») plutôt qu'un refus muet.
const LIMITE_FICHIER = 10 * 1_048_576;
const LIMITE_CORPS = 16 * 1_048_576;

export function routesAchats(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // La liste, la plus récente d'abord ; `nature` la restreint à une sorte de pièce.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/achats', geste: 'achats.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const nature = query.nature === undefined ? null : z.enum(NATURES).safeParse(query.nature);
      if (nature && !nature.success) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'nature', raison: t('champ.choix', { valeurs: NATURES.join(', ') }) }), champ: 'nature' } };
      const entreprise = params.entreprise ?? '';
      const n = limite(query);
      const avant = depuisCurseur(query.avant);
      const filtre = nature ? nature.data : null;
      const lignes = await requetes(tx).selectFrom('achats.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
        .leftJoin('socle.tiers as f', 'f.id', 'p.fournisseur')
        .select(['p.id', 'p.nature', 'p.numero_fournisseur', 'p.date_piece', 'p.echeance', 'p.objet', 'p.devise', 'd.symbole', 'd.decimales', 'p.net_a_payer', 'f.raison_sociale as fournisseur'])
        .where('p.entreprise', '=', entreprise)
        .$if(filtre !== null, (q) => q.where('p.nature', '=', filtre ?? 'facture'))
        .$if(avant !== null, (q) => q.where((eb) => eb.or([eb('p.date_piece', '<', avant?.[0] ?? ''), eb.and([eb('p.date_piece', '=', avant?.[0] ?? ''), eb('p.id', '<', avant?.[1] ?? '')])])))
        .orderBy('p.date_piece', 'desc').orderBy('p.id', 'desc').limit(n).execute();
      const { total } = await requetes(tx).selectFrom('achats.piece').select((eb) => eb.fn.countAll<string>().as('total'))
        .where('entreprise', '=', entreprise).$if(filtre !== null, (q) => q.where('nature', '=', filtre ?? 'facture')).executeTakeFirstOrThrow();
      // Ce qui reste à payer et le statut : la même fonction que la lecture d'un achat.
      const etats = await etatsDAchats(tx, entreprise, lignes.map((l) => l.id));
      const dernier = lignes.at(-1);
      return {
        corps: {
          lignes: lignes.map((l) => ({
            id: l.id, nature: l.nature, numero: l.numero_fournisseur, date: l.date_piece, echeance: l.echeance, fournisseur: l.fournisseur, objet: l.objet,
            devise: l.devise, symbole: l.symbole, netAPayer: versTexte(l.net_a_payer, l.decimales),
            reste: etats.get(l.id)?.reste ?? null, statut: etats.get(l.id)?.statut ?? null,
          })),
          suite: lignes.length === n && dernier ? versCurseur(dernier.date_piece, dernier.id) : null,
          total: Number(total),
        },
      };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/achats/:piece', geste: 'achats.pieces.voir',
    traiter: async ({ params }, tx) => {
      const introuvable = { statut: 404, corps: { motif: motif('commun.introuvable') } };
      if (!tx || !uuid.safeParse(params.piece).success) return introuvable;
      const entreprise = params.entreprise ?? '';
      const db = requetes(tx);
      const p = await db.selectFrom('achats.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
        .leftJoin('socle.tiers as f', 'f.id', 'p.fournisseur').leftJoin('achats.piece as l', 'l.id', 'p.lie')
        .selectAll('p').select(['d.decimales', 'f.raison_sociale as nom_fournisseur', 'l.numero_fournisseur as numero_lie'])
        .where('p.entreprise', '=', entreprise).where('p.id', '=', params.piece ?? '').executeTakeFirst();
      if (!p) return introuvable;
      const lignes = await db.selectFrom('achats.ligne').selectAll().where('piece', '=', p.id).orderBy('rang').execute();
      const etat = (await etatsDAchats(tx, entreprise, [p.id])).get(p.id) ?? null;
      const m = (v: bigint) => versTexte(v, p.decimales);
      const devise = { code: p.devise, decimales: p.decimales };
      // Les mêmes montants en dinars, SIGNÉS (un avoir fournisseur retire), pour ce qui additionne
      // plusieurs pièces (au cours de la pièce, que toute pièce en devise porte : 0013).
      const sens = p.nature === 'avoir' ? -1n : 1n;
      const d = (v: bigint) => versTexte(sens * versLaBase(v, devise, p.cours ?? undefined, TND), 3);
      const enDinars = { totalHT: d(p.total_ht), totalTVA: d(p.total_tva), tvaDeductible: d(p.tva_deductible), totalTTC: d(p.total_ttc), retenue: d(p.retenue), netAPayer: d(p.net_a_payer) };
      return {
        corps: {
          id: p.id, nature: p.nature, numero: p.numero_fournisseur, date: p.date_piece, echeance: p.echeance,
          fournisseur: p.fournisseur === null ? null : { id: p.fournisseur, raisonSociale: p.nom_fournisseur },
          devise: p.devise, cours: p.cours === null ? null : versTexte(p.cours, 6),
          tauxRetenue: versTexte(p.taux_retenue, 4), tvaRecuperable: p.tva_recuperable, objet: p.objet, categorie: p.categorie,
          rattacheA: p.lie === null ? null : { id: p.lie, numero: p.numero_lie },
          lignes: lignes.map((l) => ({
            designation: l.designation, quantite: versTexte(l.quantite, 3), prixUnitaire: versTexte(l.prix_unitaire, 6), tauxTva: versTexte(l.taux_tva, 4),
            destination: l.destination, nonDeductible: l.non_deductible, ht: m(l.ht), tva: m(l.tva), ttc: m(l.ttc),
          })),
          totaux: {
            totalHT: m(p.total_ht), totalTVA: m(p.total_tva), tvaDeductible: m(p.tva_deductible), frais: m(p.frais),
            totalTTC: m(p.total_ttc), retenue: m(p.retenue), netAPayer: m(p.net_a_payer),
          },
          enDinars,
          suivi: etat,
          revision: Number(p.revision),
        },
      };
    },
  });

  // Ce serveur sait-il lire ? Le bouton « Lire une photo… » ne paraît que s'il sait, et pour qui a le geste.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/achats/lecture', geste: 'achats.facture.lire',
    traiter: async () => ({ corps: { disponible: !!ctx.lecteur?.disponible, limite: String(LIMITE_FICHIER) } }),
  });

  // Lire une facture d'achat en photo ou en PDF (brique 84 ; 14 § 2.3) : le fichier est lu sur ce
  // serveur, jamais gardé ; la réponse est une PROPOSITION (rien ne s'enregistre), avec l'endroit où
  // chaque champ a été lu et ce que le recomptage en dit.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/achats/lecture', geste: 'achats.facture.lire', limiteCorps: LIMITE_CORPS,
    corps: z.object({ nom: z.string().trim().min(1).max(200), contenu: z.string().min(1).max(LIMITE_CORPS) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const lecteur = ctx.lecteur;
      if (!lecteur?.disponible) return { statut: 503, corps: { motif: motif('achats.lecture.indisponible'), bouton: null } };
      const nom = corps.nom;
      const fichier = /^[A-Za-z0-9+/]+={0,2}$/.test(corps.contenu) ? Buffer.from(corps.contenu, 'base64') : Buffer.alloc(0);
      if (fichier.length > LIMITE_FICHIER) {
        return { statut: 413, corps: { motif: motif('achats.lecture.trop_lourd', { nom, taille: (fichier.length / 1_048_576).toFixed(1).replace('.', ','), limite: LIMITE_FICHIER / 1_048_576 }), bouton: null } };
      }
      const sorte = sorteDe(fichier);
      if (!sorte) return { statut: 415, corps: { motif: motif('achats.lecture.format', { nom }), bouton: null } };
      // L'acheteur, c'est nous : notre matricule n'est jamais pris pour celui du fournisseur.
      const societe = await objetDuDossier(tx, params.entreprise ?? '', '_racine', 'company');
      const entreprise = await requetes(tx).selectFrom('socle.entreprise').select('matricule_fiscal').where('id', '=', params.entreprise ?? '').executeTakeFirst();
      const notreMatricule = (typeof societe?.matricule === 'string' && societe.matricule) || entreprise?.matricule_fiscal || null;
      let lu;
      try { lu = await lecteur.lire(fichier, sorte); } catch (e) {
        if (e instanceof LecteurOccupe) return { statut: 503, corps: { motif: motif('achats.lecture.occupe'), bouton: null } };
        if (e instanceof LectureTropLongue) return { statut: 504, corps: { motif: motif('achats.lecture.trop_long', { nom }), bouton: null } };
        if (e instanceof LectureImpossible) return { statut: 422, corps: { motif: motif('achats.lecture.echec', { nom }), bouton: null } };
        throw e;
      }
      if (!/\p{L}{2,}/u.test(lu.texte)) return { statut: 422, corps: { motif: motif('achats.lecture.vide', { nom }), bouton: null } };
      const p = lireFacture(lu.texte, { notreMatricule });
      return { corps: { lecture: p.lecture, ou: p.ou, remarques: p.remarques, moteur: lu.moteur, pages: lu.pages } };
    },
  });

  return routes;
}

