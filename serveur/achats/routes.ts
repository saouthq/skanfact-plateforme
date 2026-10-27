// Les routes du module Achats : la liste des achats (page après page) et la lecture d'un achat, avec
// ses lignes, ses montants, ce qu'il doit encore, son statut et la retenue de chaque règlement ; et la
// lecture d'une facture d'achat en photo ou en PDF (brique 84).
// Les nombres sortent en TEXTE exact (« 1191.000 ») : jamais en nombre à virgule (01 R3).

import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import { versLaBase } from '../../moteur/ecritures.ts';
import type { Route } from '../app.ts';
import { requetes, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { objetDuDossier } from '../v10/lecture.ts';
import { etatsDAchats } from './etat.ts';
import { sorteDe } from './sorte.ts';
import { IARefuse, propositionDeLIA, type ReponseIA } from './lecture-ia.ts';
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

  // L'IA de Claude (24/10/2026) se propose si ce serveur a sa clé et que l'entreprise ne l'a pas coupée dans ses réglages
  // (« Lire les photos avec l'IA », company.lectureIA de la v10) ; l'écran la demande encore avant chaque envoi.
  const iaPossible = async (tx: Transaction | null | undefined, entreprise: string) => {
    if (!ctx.lecteurIA?.disponible || !tx) return false;
    const societe = await objetDuDossier(tx, entreprise, '_racine', 'company');
    return societe?.lectureIA !== false;
  };

  // Ce serveur sait-il lire ? « Lire avec l'IA » ne paraît que s'il a sa clé, et pour qui a le geste ; coupée par
  // l'entreprise, la carte le dit (iaServeur sans ia). (27/10/2026) Seule l'IA lit : sans elle, rien ne se lit.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/achats/lecture', geste: 'achats.facture.lire',
    traiter: async ({ params }, tx) => {
      const ia = await iaPossible(tx, params.entreprise ?? '');
      return { corps: { disponible: ia, ia, iaServeur: !!ctx.lecteurIA?.disponible, limite: String(LIMITE_FICHIER) } };
    },
  });

  // Lire une facture d'achat en photo ou en PDF (brique 84 ; 14 § 2.3) : le fichier part chez l'IA, avec l'accord de la
  // personne pour CE fichier (corps.ia), et n'est gardé nulle part ; la réponse est une PROPOSITION (rien ne s'enregistre),
  // avec l'endroit où chaque champ a été lu, ses doutes et ce que le recomptage en dit.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/achats/lecture', geste: 'achats.facture.lire', limiteCorps: LIMITE_CORPS,
    // `ia` : la personne a dit oui à la lecture par l'IA, pour CE fichier (la question est posée avant chaque envoi).
    corps: z.object({ nom: z.string().trim().min(1).max(200), contenu: z.string().min(1).max(LIMITE_CORPS), ia: z.boolean().optional() }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // (27/10/2026, Skander) Seule l'IA lit : la lecture de nos serveurs se trompait trop. Sans son accord pour ce fichier,
      // sans clé, ou coupée par l'entreprise, rien ne se lit, et la phrase dit pourquoi.
      if (!ctx.lecteurIA?.disponible) return { statut: 503, corps: { motif: motif('achats.lecture.indisponible'), bouton: null } };
      if (!await iaPossible(tx, params.entreprise ?? '')) return { statut: 409, corps: { motif: motif('achats.lecture.ia_coupee'), bouton: null } };
      if (corps.ia !== true) return { statut: 409, corps: { motif: motif('achats.lecture.ia_accord'), bouton: null } };
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
      // La pièce part chez Anthropic, rien d'autre (lecture-ia.ts) ; notre matricule se reconnaît ici, au retour. Si l'IA ne
      // répond pas (panne, refus, réponse hors forme), rien n'est lu : la phrase le dit, la pièce se joint et se saisit.
      let r: ReponseIA;
      try { r = await ctx.lecteurIA.lire(fichier, sorte); } catch (e) {
        // Pour l'exploitant (journalctl) : la raison et le message de l'API, jamais la pièce ni la clé.
        const cause = e instanceof Error && e.cause instanceof Error ? ` : ${e.cause.message.slice(0, 300)}` : '';
        console.error(`la lecture par l'IA n'a pas abouti (${e instanceof Error ? e.message : String(e)})${cause}`);
        return { statut: e instanceof IARefuse ? 422 : 503, corps: { motif: motif(e instanceof IARefuse ? 'achats.lecture.ia_refus' : 'achats.lecture.ia_echec', { nom }), bouton: null } };
      }
      if (!r.estUneFacture) return { statut: 422, corps: { motif: motif('achats.lecture.ia_pas_facture', { nom }), bouton: null } };
      const p = propositionDeLIA(r, { notreMatricule });
      return { corps: { lecture: p.lecture, ou: p.ou, remarques: p.remarques, doutes: p.doutes, moteur: 'ia', pages: 1 } };
    },
  });

  return routes;
}

