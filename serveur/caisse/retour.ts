// Le retour à la caisse (brique 124 ; 03 § 2.1 « Caisse » ; docs/caisse.md, T1 à T5). Un client rapporte un article :
// le caissier établit un avoir sur le ticket (un ticket encaissé ne s'annule jamais, 01 R6), l'argent rendu sort du
// tiroir de la session ouverte sur CE poste, et le Z de la session le compte. Le caissier fait le geste ; un
// propriétaire ou un administrateur présent l'approuve avec SON code de responsable ; l'avoir porte les deux noms.
//
// Le serveur ne croit pas l'écran : chaque ligne rendue est une ligne du ticket (même article, même prix, même TVA), sa
// quantité ne dépasse pas ce qui reste à rendre (le vendu moins les avoirs déjà faits), et l'argent rendu est le net de
// l'avoir qu'il scelle lui-même.

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import { attenteLisible } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { correspond } from '../mot-de-passe.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { DECIMALES } from '../ventes/pieces.ts';
import { appliquer, emettreDepuisV10 } from '../v10/dossier.ts';
import { mesRoles } from '../v10/droits.ts';
import { nombreEnTexte } from '../v10/lecture.ts';
import { motif } from '../../textes/index.ts';
import './textes.ts';

type Json = Record<string, unknown>;
const contenu: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(contenu), z.record(z.string(), contenu)]));
const quantite = (v: unknown) => { try { return depuisTexte(nombreEnTexte(v), DECIMALES.quantite); } catch { return -1n; } };
const meme = (a: unknown, b: unknown) => nombreEnTexte(a) === nombreEnTexte(b);

async function piece(tx: Transaction, entreprise: string, cle: string) {
  return (await tx.query(`select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2`, [entreprise, cle])).rows[0] as
    { contenu: Json; revision: string; rang: number | null } | undefined;
}

// Les mots d'un refus du code de responsable, selon le geste (un retour, une remise).
export type MotsDuCode = { sans: string; inconnu: string; faux: string; valeurs?: Record<string, string> };
const RETOUR: MotsDuCode = { sans: 'caisse.retour_sans_responsable', inconnu: 'caisse.retour_responsable_inconnu', faux: 'caisse.retour_code_faux' };

// Le code d'un responsable présent, tapé sur l'appareil de la caisse (brique 124) : il approuve un geste, il n'ouvre rien.
// Un code faux compte (5, puis une attente) : la réponse n'est alors pas une exception, pour que l'erreur s'écrive.
export async function codeDuResponsable(tx: Transaction, entreprise: string, rsp: { utilisateur: string; code: string } | undefined, appareil: string | null, mots: MotsDuCode):
  Promise<{ approuvePar: { id: string; nom: string } } | { reponse: { statut: number; corps: unknown } }> {
  if (!rsp) throw new Refus(mots.sans, { bouton: 'caisse.responsable', ...(mots.valeurs ? { valeurs: mots.valeurs } : {}) });
  const maintenant = new Date();
  const cle = `responsable:${entreprise}:${rsp.utilisateur}`;
  const attente = (await tx.query('select socle.attente_connexion($1, $2) a', [cle, maintenant])).rows[0].a as Date | null;
  if (attente) return { reponse: { statut: 403, corps: { motif: attenteLisible(attente, maintenant), qui: [], bouton: null } } };
  const e = (await tx.query('select caisse.code_responsable_pour($1, $2, $3) e', [entreprise, rsp.utilisateur, appareil])).rows[0].e as string | null;
  if (!e) throw new Refus(mots.inconnu);
  if (!/^[0-9]{4}$/.test(rsp.code) || !await correspond(e, rsp.code)) {
    const a = (await tx.query('select socle.noter_erreur($1, $2) a', [cle, maintenant])).rows[0].a as Date | null;
    return { reponse: { statut: 403, corps: { motif: a ? attenteLisible(a, maintenant) : motif(mots.faux), qui: [], bouton: null } } };
  }
  await tx.query('select socle.effacer_erreurs($1)', [cle]);
  return { approuvePar: { id: rsp.utilisateur, nom: String((await tx.query('select nom from socle.utilisateur where id = $1', [rsp.utilisateur])).rows[0]?.nom ?? '') } };
}

export function routeRetour(sessionOuverte: (tx: Transaction, entreprise: string) => Promise<{ id: string; appareil: string; appareil_nom: string; qui: string } | undefined>): Route<never> {
  const route: Route<{ ticket: string; avoir: Record<string, unknown>; rang: number | null; netAPayer: string; paiement: Record<string, unknown>; responsable?: { utilisateur: string; code: string } | undefined }> = {
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10/rendre', geste: 'caisse.ticket.rendre',
    corps: z.object({
      ticket: z.string().min(1).max(200), avoir: z.record(z.string(), contenu), rang: z.number().int().min(0).nullable(),
      netAPayer: z.string().regex(/^\d+(\.\d+)?$/), paiement: z.record(z.string(), contenu),
      responsable: z.object({ utilisateur: z.uuid(), code: z.string().trim().max(20) }).optional(),
    }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      // L'argent rendu sort du tiroir : la caisse ouverte sur CET appareil, comme pour encaisser.
      const s = await sessionOuverte(tx, ent);
      if (!s) throw new Refus('caisse.fermee_retour', { bouton: 'caisse.session.ouvrir' });
      if (s.appareil !== qui.appareil) throw new Refus('caisse.ouverte_ailleurs_retour', { valeurs: { appareil: s.appareil_nom, qui: s.qui } });

      // Le ticket, émis ; l'avoir, sur lui, ligne à ligne.
      const tk = await piece(tx, ent, corps.ticket);
      if (!tk || tk.contenu.ticket !== true || typeof tk.contenu.number !== 'string' || !tk.contenu.number) throw new Refus('caisse.retour_pas_un_ticket');
      const numero = tk.contenu.number;
      const av = corps.avoir;
      const lignesTicket = Array.isArray(tk.contenu.lines) ? tk.contenu.lines as Json[] : [];
      const lignes = Array.isArray(av.lines) ? av.lines as Json[] : [];
      if (av.type !== 'avoir' || av.creditOf !== corps.ticket || !lignes.length) throw new Refus('caisse.retour_pas_un_ticket');
      // Ce qui a déjà été rendu sur ce ticket, ligne par ligne.
      const deja = new Map<number, bigint>();
      for (const r of (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents'
          and contenu->>'type' = 'avoir' and contenu->>'creditOf' = $2 and coalesce(contenu->>'number', '') <> ''`, [ent, corps.ticket])).rows as { contenu: Json }[]) {
        for (const l of Array.isArray(r.contenu.lines) ? r.contenu.lines as Json[] : []) {
          const i = Number(l.ligneTicket);
          deja.set(i, (deja.get(i) ?? 0n) + quantite(l.qty));
        }
      }
      const dansCetAvoir = new Map<number, bigint>();
      for (const l of lignes) {
        const i = Number(l.ligneTicket);
        const t = Number.isInteger(i) ? lignesTicket[i] : undefined;
        const q = quantite(l.qty);
        if (!t || q <= 0n || String(l.label ?? '') !== String(t.label ?? '') || !meme(l.unitPrice, t.unitPrice) || !meme(l.vatRate, t.vatRate)) {
          throw new Refus('caisse.retour_ligne', { valeurs: { numero } });
        }
        dansCetAvoir.set(i, (dansCetAvoir.get(i) ?? 0n) + q);
        if ((deja.get(i) ?? 0n) + (dansCetAvoir.get(i) ?? 0n) > quantite(t.qty)) {
          throw new Refus('caisse.retour_trop', { valeurs: { article: String(t.label ?? ''), numero } });
        }
      }

      // L'argent rendu : le net de l'avoir, sorti du compte du mode choisi, ce jour.
      const p = corps.paiement;
      const mode = String(p.method ?? '');
      if (!['especes', 'carte', 'cheque'].includes(mode)) throw new Refus('caisse.retour_mode');
      const dec = (corps.netAPayer.split('.')[1] ?? '').length;
      const net = depuisTexte(corps.netAPayer, dec);
      let rendu: bigint;
      try { rendu = -depuisTexte(nombreEnTexte(p.amount), dec); } catch { rendu = -1n; }
      if (rendu !== net || p.date !== aujourdhuiATunis() || typeof p.id !== 'string' || !p.id) throw new Refus('caisse.retour_paiement', { valeurs: { net: corps.netAPayer } });
      const compte = (await tx.query(`select 1 from socle.dossier_v10 where entreprise = $1 and collection = 'accounts' and cle = $2`, [ent, String(p.accountId ?? '')])).rowCount;
      if (!compte) throw new Refus('caisse.retour_compte');

      // Le code d'un responsable, quand celui qui rend n'en est pas un (03 § 2.1).
      const roles = await mesRoles(tx, ent);
      let approuvePar: { id: string; nom: string } | null = null;
      if (!roles.some((r) => r === 'proprietaire' || r === 'administrateur')) {
        const v = await codeDuResponsable(tx, ent, corps.responsable, qui.appareil, RETOUR);
        if ('reponse' in v) return v.reponse;
        approuvePar = v.approuvePar;
      }
      const faitPar = String((await tx.query('select nom from socle.utilisateur where id = socle.moi()')).rows[0]?.nom ?? '');

      // L'avoir, numéroté et scellé par le serveur ; il porte les deux noms.
      const clientId = typeof tk.contenu.clientId === 'string' ? tk.contenu.clientId : '';
      const client = clientId ? ((await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and cle = $2`, [ent, clientId])).rows[0]?.contenu ?? null) : null;
      const document = { ...av, clientId, payments: [], retourCaisse: { faitPar, ...(approuvePar ? { approuvePar: approuvePar.nom } : {}) } };
      const r = await emettreDepuisV10(tx, ent, qui.utilisateur, { document, client, revision: null, rang: corps.rang, netAPayer: corps.netAPayer }, 'avoir', { retour: true });

      // Le retour dans sa session : le Z le compte.
      await tx.query(`insert into caisse.retour (piece, entreprise, session, ticket, montant, mode, fait_par, approuve_par)
        select a.id, a.entreprise, $3, t.id, $4, $5, socle.moi(), $6 from ventes.piece a, ventes.piece t
         where a.entreprise = $1 and a.ref_v10 = $2 and t.entreprise = $1 and t.ref_v10 = $7`,
      [ent, String(av.id), s.id, net.toString(), mode, approuvePar?.id ?? null, corps.ticket]);

      // L'argent rendu, sur le ticket (comme la v10) : son règlement négatif, tenu par le serveur.
      const paiements = Array.isArray(tk.contenu.payments) ? tk.contenu.payments as unknown[] : [];
      const ticket = { ...tk.contenu, payments: [...paiements, { ...p, reference: r.numero }] };
      const [ecrit] = await appliquer(tx, ent, qui.utilisateur, [{ collection: 'documents', cle: corps.ticket, rang: tk.rang, revision: Number(tk.revision), contenu: ticket }], { serveur: true });
      await tracer(tx, ent, 'caisse.ticket.rendre', { type: 'piece_v10', id: null }, null,
        { ticket: numero, avoir: r.numero, rendu: versTexte(net, dec), mode, ...(approuvePar ? { approuvePar: approuvePar.nom } : {}) });
      return { corps: { avoir: { contenu: r.contenu, revision: r.revision }, ticket: { contenu: ticket, revision: ecrit?.revision ?? Number(tk.revision) + 1 }, numero: r.numero } };
    },
  };
  return route as unknown as Route<never>;
}
