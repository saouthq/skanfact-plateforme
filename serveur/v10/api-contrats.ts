// Les contrats d'abonnement par l'API (brique 130 ; docs/api-situation.md, S8) : une console partenaire (SkanEcom, pour
// l'abonnement de chaque boutique) crée, lit, modifie, suspend et reprend un contrat de « Facturation récurrente »
// sans passer par l'écran. Le contrat est celui de la v10, dans le dossier : l'écran le montre, le modifie, et le
// serveur émet ses factures s'il est « émis seul » (brique 129 ; ce choix reste au propriétaire ou à l'administrateur,
// que la clé représente ou non, 0065). Les montants arrivent en texte décimal, jamais en nombre à virgule.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { motif } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import { requetes, type Transaction } from '../base.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { appliquer, clientDuDossier, dossierPret } from './dossier.ts';
import { echeanceSuivante } from './contrats.ts';
import { enNombreV10, nombreEnTexte, type Json } from './lecture.ts';

const decimal = (decimales: number) => z.string().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${decimales}})?$`));
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PERIODES = { mois: 'month', trimestre: 'quarter', annee: 'year' } as const;
const corpsContrat = z.object({
  client: z.uuid(),
  objet: z.string().trim().min(1).max(300),
  periode: z.enum(['mois', 'trimestre', 'annee']),
  jour: z.number().int().min(1).max(31).optional(),
  prochaine: jour,
  lignes: z.array(z.object({
    designation: z.string().trim().min(1).max(300), description: z.string().max(2000).optional(), unite: z.string().max(20).optional(),
    quantite: decimal(3), prixUnitaire: decimal(6), tauxTva: decimal(4),
  })).min(1).max(100),
  remise: decimal(4).optional(),
  retenue: decimal(4).optional(),
  notes: z.string().max(4000).optional(),
  emettreSeul: z.boolean().optional(),
});
type CorpsContrat = z.infer<typeof corpsContrat>;

const lireContrat = async (tx: Transaction, entreprise: string, cle: string) =>
  (await tx.query(`select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' and cle = $2 for update`, [entreprise, cle])).rows[0] as
    { contenu: Json; revision: string; rang: number | null } | undefined;

// Le contrat tel que la v10 l'écrit (le formulaire « Nouveau contrat récurrent »).
const enV10 = (c: CorpsContrat, clientId: string) => ({
  clientId, subject: c.objet, every: PERIODES[c.periode], day: c.jour ?? Number(c.prochaine.slice(8, 10)), nextDate: c.prochaine,
  lines: c.lignes.map((l) => ({ label: l.designation, description: l.description ?? '', unit: l.unite ?? '', qty: enNombreV10(l.quantite),
    unitPrice: enNombreV10(l.prixUnitaire), vatRate: enNombreV10(l.tauxTva) })),
  discountRate: enNombreV10(c.remise ?? '0'), withholdingRate: enNombreV10(c.retenue ?? '0'), notes: c.notes ?? '', emettreSeul: c.emettreSeul === true,
});

// Ce que l'API rend d'un contrat.
async function versApi(tx: Transaction, entreprise: string, cle: string, r: Json) {
  const tiers = await requetes(tx).selectFrom('socle.tiers').select('id').where('entreprise', '=', entreprise).where('ref_v10', '=', String(r.clientId ?? '')).executeTakeFirst();
  const periode = (Object.entries(PERIODES).find(([, v]) => v === r.every) ?? ['mois'])[0];
  const refus = r.refusServeur as Json | undefined;
  return {
    id: cle, client: tiers?.id ?? null, objet: r.subject, periode, jour: r.day, prochaine: r.nextDate, derniere: r.lastIssued ?? null,
    actif: r.active !== false, emettreSeul: r.emettreSeul === true, refus: refus ? { le: refus.le, echeance: refus.echeance, motif: refus.motif } : null,
    lignes: (Array.isArray(r.lines) ? r.lines as Json[] : []).map((l) => ({ designation: l.label, quantite: nombreEnTexte(l.qty), prixUnitaire: nombreEnTexte(l.unitPrice), tauxTva: nombreEnTexte(l.vatRate) })),
    ecran: `/v10/?e=${entreprise}#/contrat/${cle}`,
  };
}

const introuvable = { statut: 404, corps: { motif: motif('commun.introuvable') } };

export function routesContrats(): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Créer : le client est une fiche du serveur (GET …/clients) ; il entre dans le dossier s'il n'y est pas.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/contrats', geste: 'ventes.contrat.modifier', corps: corpsContrat,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      await dossierPret(tx, ent, qui.utilisateur);
      const clientId = await clientDuDossier(tx, ent, qui.utilisateur, corps.client);
      if (!clientId) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'client', raison: motif('contrat.client_inconnu') }), champ: 'client' } };
      const cle = randomUUID();
      const { n } = await requetes(tx).selectFrom('socle.dossier_v10').select((eb) => eb.fn.countAll<string>().as('n'))
        .where('entreprise', '=', ent).where('collection', '=', 'recurring').executeTakeFirstOrThrow();
      const contenu = { id: cle, ...enV10(corps, clientId), active: true, reference: '', currency: 'DT', exchangeRate: '', createdAt: Date.now() };
      await appliquer(tx, ent, qui.utilisateur, [{ collection: 'recurring', cle, rang: Number(n), revision: null, contenu }], { serveur: true });
      return { statut: 201, corps: await versApi(tx, ent, cle, contenu) };
    },
  });

  // Lire : tous les contrats, ou ceux d'un client.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/contrats', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const client = query.client ? (await requetes(tx).selectFrom('socle.tiers').select('ref_v10').where('entreprise', '=', ent)
        .where('id', '=', z.uuid().safeParse(query.client).success ? query.client : '00000000-0000-0000-0000-000000000000').executeTakeFirst())?.ref_v10 ?? '' : null;
      const lignes = (await tx.query(`select cle, contenu from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' order by rang, cle`, [ent])).rows as { cle: string; contenu: Json }[];
      const contrats = [];
      for (const l of lignes) if (client === null || l.contenu.clientId === client) contrats.push(await versApi(tx, ent, l.cle, l.contenu));
      return { corps: { contrats } };
    },
  });

  // Modifier : tout ce que le formulaire modifie ; ce qui a déjà été facturé (la dernière date) reste.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/contrats/:contrat', geste: 'ventes.contrat.modifier', corps: corpsContrat,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const l = await lireContrat(tx, ent, params.contrat ?? '');
      if (!l) return introuvable;
      const clientId = await clientDuDossier(tx, ent, qui.utilisateur, corps.client);
      if (!clientId) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'client', raison: motif('contrat.client_inconnu') }), champ: 'client' } };
      const contenu: Json = { ...l.contenu, ...enV10(corps, clientId) };
      // Corrigé, un contrat refusé par le serveur se retente au tour suivant (comme à l'écran).
      delete contenu.refusServeur;
      await appliquer(tx, ent, qui.utilisateur, [{ collection: 'recurring', cle: params.contrat ?? '', rang: l.rang, revision: Number(l.revision), contenu }], { serveur: true });
      return { corps: await versApi(tx, ent, params.contrat ?? '', contenu) };
    },
  });

  // Suspendre, reprendre : comme le bouton de l'écran. Repris, un contrat ne facture pas les échéances passées pendant la
  // suspension : sa prochaine date est la première qui n'est pas passée (`catchUpRecurrence` de la v10).
  for (const geste of ['suspendre', 'reprendre'] as const) {
    ajouter({
      methode: 'POST', chemin: `/entreprises/:entreprise/contrats/:contrat/${geste}`, geste: 'ventes.contrat.modifier',
      traiter: async ({ params, qui }, tx) => {
        if (!tx || !qui) throw new Error('transaction attendue');
        const ent = params.entreprise ?? '';
        const l = await lireContrat(tx, ent, params.contrat ?? '');
        if (!l) return introuvable;
        const contenu: Json = { ...l.contenu, active: geste === 'reprendre' };
        if (geste === 'reprendre') {
          const auj = aujourdhuiATunis();
          let d = String(contenu.nextDate ?? auj);
          for (let i = 0; d < auj && i < 240; i++) d = echeanceSuivante(d, contenu.every, contenu.day);
          contenu.nextDate = d;
        }
        await appliquer(tx, ent, qui.utilisateur, [{ collection: 'recurring', cle: params.contrat ?? '', rang: l.rang, revision: Number(l.revision), contenu }], { serveur: true });
        return { corps: await versApi(tx, ent, params.contrat ?? '', contenu) };
      },
    });
  }
  return routes;
}
