// La file d'opérations (04 § 4 à § 6). Un poste envoie ses gestes, dans l'ordre ; le serveur :
//   - reconnaît un geste déjà reçu (même identifiant) et rend la même réponse, sans le refaire ;
//   - rejoue les gestes d'un appareil un par un, dans l'ordre, et s'arrête au premier trou ;
//   - fait passer chaque geste par la porte (03 D2), comme un geste fait à l'écran ;
//   - ne jette jamais rien : un geste refusé ou mis de côté va dans « À reprendre » ; un FAIT (un
//     ticket encaissé, un règlement reçu) n'est jamais refusé, il attend la décision du propriétaire.
// Chaque geste est traité dans sa propre transaction : son travail et sa trace dans la file
// réussissent ou échouent ensemble.

import { z, type ZodType } from 'zod';
import { motif, rendre, Texte, type Valeurs } from '../textes/index.ts';
import { enTantQue, type Transaction } from './base.ts';
import { texteDuRefus } from './erreurs.ts';
import type { Contexte, Qui } from './connexion.ts';
import { peut } from './porte/porte.ts';
import { nomDuChamp, raison } from './validation.ts';

export type Operation = {
  id: string; ordre: number; geste: string; entreprise: string; format: number;
  instantPoste: string; revisionVue?: number | undefined; charge: unknown;
};

export const schemaOperation = z.object({
  id: z.string().uuid(), ordre: z.number().int().min(1), geste: z.string().min(3).max(100), entreprise: z.string().uuid(),
  format: z.number().int().min(1), instantPoste: z.string().datetime({ offset: true }),
  revisionVue: z.number().int().min(0).optional(), charge: z.unknown(),
});

// Un traitement : ce qu'un module fait d'un geste reçu. `fait` : l'argent a bougé, le geste n'est
// jamais refusé (04 § 5.1). `formats` : les versions du format qu'il sait lire (une mise à jour de
// l'application ne rend jamais illisible une file déjà écrite, 04 § 8).
export type Traitement<C = unknown> = {
  geste: string;
  fait?: boolean;
  formats: number[];
  charge: ZodType<C>;
  traiter: (tx: Transaction, op: Operation & { charge: C }, qui: Qui) => Promise<unknown>;
};

// Un traitement qui voit que l'objet a changé depuis que le poste l'a lu (01 R15) le dit ainsi :
// le geste est mis de côté, jamais écrasé ni jeté (04 § 5).
export class MiseDeCote extends Error {
  readonly texte: Texte;
  constructor(cle: string, valeurs?: Valeurs) { const texte = motif(cle, valeurs); super(rendre(texte, 'fr')); this.texte = texte; }
}

export type Reponse =
  | { id: string; statut: 'acceptee' | 'deja_recue'; resultat: unknown }
  | { id: string; statut: 'refusee' | 'mise_de_cote' | 'en_attente_decision'; motif: Texte | string }
  | { id: string; statut: 'manquante'; manque: number; motif: Texte }
  | { id: string; statut: 'erreur'; motif: Texte };

// Déclarer un traitement (le type de sa charge est vérifié ici, puis effacé pour le registre).
export const traitement = <C>(t: Traitement<C>): Traitement<never> => t as unknown as Traitement<never>;

export function registreDesTraitements(...liste: Traitement<never>[]): Map<string, Traitement<never>> {
  const r = new Map<string, Traitement<never>>();
  for (const t of liste) {
    if (r.has(t.geste)) throw new Error(`le traitement du geste ${t.geste} est déclaré deux fois`);
    r.set(t.geste, t);
  }
  return r;
}


async function unGeste(ctx: Contexte, qui: Qui, appareil: string, op: Operation, traitements: Map<string, Traitement<never>>): Promise<Reponse> {
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    const dernier = Number((await tx.query('select socle.file_prendre($1) d', [appareil])).rows[0].d);

    // Déjà reçue : la même réponse, rien de refait.
    const deja = (await tx.query('select * from socle.operation_recue($1)', [op.id])).rows[0];
    if (deja) {
      if (deja.appareil !== appareil) return { id: op.id, statut: 'refusee', motif: motif('file.autre_appareil') };
      return deja.statut === 'acceptee'
        ? { id: op.id, statut: 'deja_recue', resultat: deja.resultat }
        : { id: op.id, statut: deja.statut, motif: deja.motif };
    }
    if (op.ordre <= dernier) return { id: op.id, statut: 'refusee', motif: motif('file.ordre_servi', { ordre: op.ordre }) };
    if (op.ordre > dernier + 1) return { id: op.id, statut: 'manquante', manque: dernier + 1, motif: motif('file.manque', { numero: dernier + 1 }) };

    const noter = async (statut: string, motif: string | null, resultat: unknown) => {
      await tx.query('select socle.noter_operation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
        op.id, appareil, op.entreprise, op.ordre, op.geste, op.format, op.revisionVue ?? null, op.instantPoste,
        JSON.stringify(op.charge ?? null), statut, motif, resultat === undefined ? null : JSON.stringify(resultat)]);
    };
    const t = traitements.get(op.geste);
    // Un refus ou une mise de côté : noté, jamais jeté. Un fait attend la décision du propriétaire.
    // Le motif est gardé dans la file en français (celui qui reprendra le geste le lira plus tard) et
    // rendu au poste dans sa langue.
    const nonAccepte = async (m: Texte | string, miseDeCote = false): Promise<Reponse> => {
      const texte = typeof m === 'string' ? m : rendre(m, 'fr');
      const statut = miseDeCote ? 'mise_de_cote' : t?.fait ? 'en_attente_decision' : 'refusee';
      await noter(statut, texte, null);
      return { id: op.id, statut, motif: m };
    };

    if (!t) return nonAccepte(motif('file.geste_inconnu', { geste: op.geste }));
    if (!t.formats.includes(op.format)) return nonAccepte(motif('file.format_inconnu', { format: op.format }));
    const charge = t.charge.safeParse(op.charge);
    if (!charge.success) {
      const p = charge.error.issues[0];
      return nonAccepte(motif('file.illisible', { champ: nomDuChamp(p, 'charge'), raison: p ? raison(p, op.charge) : motif('champ.valeur') }));
    }

    // La même porte que pour un geste fait à l'écran (03 D2).
    const d = await peut(tx, qui, op.entreprise, op.geste, true);
    if (!d.ok) return nonAccepte(d.raison === 'invisible' ? motif('file.plus_membre') : d.motif);

    await tx.query('savepoint geste');
    try {
      const resultat = await t.traiter(tx, { ...op, charge: charge.data as never }, qui);
      await noter('acceptee', null, resultat ?? null);
      return { id: op.id, statut: 'acceptee', resultat: resultat ?? null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (e instanceof MiseDeCote || err.code === '42501') {
        // Rien de ce que le geste avait commencé ne reste.
        await tx.query('rollback to savepoint geste');
        return nonAccepte(texteDuRefus(e as { message?: string; texte?: unknown }), e instanceof MiseDeCote);
      }
      throw e;
    }
  });
}

// Recevoir des gestes d'un appareil. On s'arrête au premier trou et à la première erreur du
// serveur : les suivants attendent, le poste les renverra (l'ordre est gardé).
export async function recevoir(ctx: Contexte, qui: Qui, operations: Operation[], traitements: Map<string, Traitement<never>>): Promise<Reponse[]> {
  if (!qui.appareil) throw new Error('une file se rattache à un appareil');
  const reponses: Reponse[] = [];
  for (const op of [...operations].sort((a, b) => a.ordre - b.ordre)) {
    let r: Reponse;
    try {
      r = await unGeste(ctx, qui, qui.appareil, op, traitements);
    } catch {
      r = { id: op.id, statut: 'erreur', motif: motif('file.erreur') };
    }
    reponses.push(r);
    if (r.statut === 'manquante' || r.statut === 'erreur') break;
  }
  return reponses;
}
