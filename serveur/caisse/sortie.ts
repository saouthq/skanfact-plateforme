// La sortie de caisse de la paie (16 § 3.8 et § 10.1, urgence 5 ; docs/caisse.md) : la porte que la Caisse offre au
// Personnel (02 § 2 : le Personnel appelle la Caisse, jamais l'inverse). Un salaire ou une avance payés en espèces depuis le
// tiroir, la caisse ouverte, se notent dans sa session ; le Z les retire de ce que le tiroir devait contenir. L'argent est
// déjà dans les livres par la paie : la sortie n'écrit rien d'autre. Un fait n'est jamais refusé (04 § 5.1) : sans session
// ouverte, pour un jour hors de la session ou un autre compte, rien n'est noté, et le paiement passe.

import type { Transaction } from '../base.ts';
import { compteDeTresorerie, lirePlan, type PlanDuDossier } from '../compta/porte.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { aVraimentChange, estObjet, nombreEnTexte, type ChangementLu, type Json } from '../v10/lecture.ts';

// Le compte du tiroir : le premier compte de caisse du dossier, celui où le Z écrit son écart et où la caisse de la v10 met
// les espèces (`comptesDeCaisse`, core.js).
export async function compteDuTiroir(tx: Transaction, ent: string): Promise<string | undefined> {
  return (await tx.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'accounts'
    and contenu->>'kind' = 'caisse' and coalesce(contenu->>'archived', '') not in ('true') order by rang, cle limit 1`, [ent])).rows[0]?.cle as string | undefined;
}

// Ce que la paie a payé (montant nul : plus rien), le compte de trésorerie que ses livres créditent, et le jour.
export type PaiementDeLaPaie = { nature: 'salaire' | 'avance'; origine: string; montant: bigint; jour: string | null; compte: string | undefined };

// Noter la sortie d'un paiement de la paie, ou la retirer (le paiement annulé, changé de compte ou de jour) : seulement
// dans une session ouverte, pour un jour de la session (de son ouverture à aujourd'hui), depuis le compte du tiroir.
export async function noterSortieDeCaisse(tx: Transaction, ent: string, p: PaiementDeLaPaie): Promise<void> {
  // La session verrouillée : une fermeture en même temps attend, et son Z compte la sortie, ou elle est déjà fermée.
  const s = (await tx.query(`select id, (ouverte_le at time zone 'Africa/Tunis')::date::text jour from caisse.session
    where entreprise = $1 and fermee_le is null order by ouverte_le limit 1 for update`, [ent])).rows[0] as { id: string; jour: string } | undefined;
  if (!s) return;
  await tx.query('delete from caisse.sortie where session = $1 and origine = $2', [s.id, p.origine]);
  if (p.montant <= 0n || !p.jour || p.jour < s.jour || p.jour > aujourdhuiATunis() || !p.compte || p.compte !== await compteDuTiroir(tx, ent)) return;
  await tx.query(`insert into caisse.sortie (entreprise, session, nature, origine, montant, cree_par) values ($1, $2, $3, $4, $5, socle.moi())`,
    [ent, s.id, p.nature, p.origine, p.montant.toString()]);
}

// Ce que la paie a pris au tiroir pendant une session, pour son Z.
export async function sortiesDeLaSession(tx: Transaction, session: string): Promise<bigint> {
  return BigInt((await tx.query(`select coalesce(sum(montant), 0)::text s from caisse.sortie where session = $1 and nature in ('salaire', 'avance')`, [session])).rows[0].s);
}

// (1.357.6, 0209) Le reste de ce qui est sorti du tiroir, ou y est entré, ailleurs que sur un ticket et que dans la paie :
// les deux sens à part, pour que le Z les nomme.
export async function autresFluxDeLaSession(tx: Transaction, session: string): Promise<{ sorties: bigint; entrees: bigint }> {
  const r = (await tx.query(`select coalesce(sum(montant) filter (where montant > 0), 0)::text s, coalesce(-sum(montant) filter (where montant < 0), 0)::text e
    from caisse.sortie where session = $1 and nature in ('mouvement', 'achat', 'vente')`, [session])).rows[0] as { s: string; e: string };
  return { sorties: BigInt(r.s), entrees: BigInt(r.e) };
}

// (1.357.6, bout en bout 15 ; 0209) Ce qui entre et sort du tiroir ailleurs que sur un ticket, la caisse ouverte : un
// mouvement de la Trésorerie (les espèces versées à la BIAT, le fond complété par la banque), un règlement fournisseur payé
// « à la caisse », une facture qu'un client règle en espèces au comptoir. Les livres et la Trésorerie le savaient, le Z non :
// il annonçait le soir un manque (ou un excédent) qu'il sortait (ou entrait) une seconde fois contre le 658 (ou le 758). Une
// pièce changée remplace tout ce qu'elle avait noté (supprimée : plus rien). Restent hors de ce compte, parce que le Z les
// compte déjà ou qu'ils précèdent la session : les tickets et leurs retours, l'ajustement du fond noté à l'ouverture, l'écart
// d'un Z. Un fait n'est jamais refusé (04 § 5.1) : sans session ouverte, rien n'est noté.
type Flux = { nature: 'mouvement' | 'achat' | 'vente'; cle: string; montant: bigint; jour: string | null };
const COLLECTIONS_DU_TIROIR = ['movements', 'purchases', 'documents'];
const ENTREES = ['apport', 'pret', 'autre-entree'];
const texte = (v: unknown) => (typeof v === 'string' ? v : '');

export async function suivreLeTiroir(tx: Transaction, ent: string, changements: ChangementLu[]): Promise<void> {
  const touches = changements.filter((c) => COLLECTIONS_DU_TIROIR.includes(c.collection) && aVraimentChange(c));
  if (!touches.length) return;
  const s = (await tx.query(`select id, (ouverte_le at time zone 'Africa/Tunis')::date::text jour from caisse.session
    where entreprise = $1 and fermee_le is null order by ouverte_le limit 1 for update`, [ent])).rows[0] as { id: string; jour: string } | undefined;
  if (!s) return;
  const tiroir = await compteDuTiroir(tx, ent);
  if (!tiroir) return;
  const plan = await lirePlan(tx, ent);
  const dev = (await tx.query(`select e.devise_base devise, coalesce(d.decimales, 3) decimales from socle.entreprise e
    left join socle.devise d on d.code = e.devise_base where e.id = $1`, [ent])).rows[0] as { devise: string; decimales: number };
  const auj = aujourdhuiATunis();
  for (const c of touches) {
    const prefixe = `${c.collection}/${c.cle}#`;
    await tx.query('delete from caisse.sortie where session = $1 and left(origine, length($2)) = $2', [s.id, prefixe]);
    const flux = fluxDuTiroir(c, plan, tiroir, dev.devise, Number(dev.decimales));
    for (const f of flux) {
      if (f.montant === 0n || !f.jour || f.jour < s.jour || f.jour > auj) continue;
      await tx.query(`insert into caisse.sortie (entreprise, session, nature, origine, montant, cree_par) values ($1, $2, $3, $4, $5, socle.moi())`,
        [ent, s.id, f.nature, prefixe + f.cle, f.montant.toString()]);
    }
  }
}

// Un montant du dossier (en dinars, ou dans la devise de la pièce au taux du règlement) en entier de la devise de base.
function enEntier(v: unknown, taux: number, decimales: number): bigint {
  const n = Number(nombreEnTexte(v)) * (taux > 0 ? taux : 1);
  return Number.isFinite(n) ? BigInt(Math.round(Math.abs(n) * 10 ** decimales)) * (n < 0 ? -1n : 1n) : 0n;
}

function fluxDuTiroir(c: ChangementLu, plan: PlanDuDossier, tiroir: string, devise: string, decimales: number): Flux[] {
  const o = c.apres;
  if (!estObjet(o)) return [];
  const compte = (id: unknown, mode: unknown) => compteDeTresorerie(plan, texte(id) || null, texte(mode))?.id;
  const tauxDe = (piece: Json, p: Json) => {
    const cur = texte(piece.currency);
    if (!cur || cur === devise || (devise === 'TND' && cur === 'DT')) return 1;
    return Number(nombreEnTexte(p.exchangeRate)) || Number(nombreEnTexte(piece.exchangeRate)) || 1;
  };
  if (c.collection === 'movements') {
    if (o.ouverture === true || texte(o.reference) === 'Ouverture de la caisse' || c.cle.startsWith('ecart-z-')) return [];
    const montant = enEntier(o.amount, 1, decimales);
    const m = montant < 0n ? -montant : montant;
    if (o.kind === 'virement') {
      const vers = texte(o.versAccountId) && plan.tresorerie.some((a) => a.id === o.versAccountId) ? texte(o.versAccountId) : '';
      const depart = compte(o.accountId, o.method);
      if (depart === tiroir && vers !== tiroir) return [{ nature: 'mouvement', cle: 'depart', montant: m, jour: texte(o.date) || null }];
      if (vers === tiroir && depart !== tiroir) return [{ nature: 'mouvement', cle: 'vers', montant: -m, jour: texte(o.date) || null }];
      return [];
    }
    if (compte(o.accountId, o.method) !== tiroir) return [];
    return [{ nature: 'mouvement', cle: 'mvt', montant: ENTREES.includes(texte(o.kind)) ? -m : m, jour: texte(o.date) || null }];
  }
  const paiements = Array.isArray(o.payments) ? o.payments.filter(estObjet) as Json[] : [];
  if (c.collection === 'purchases') {
    // Ce que porte un AVOIR fournisseur est un remboursement : l'argent entre (`cashMovements`, core.js).
    const sens = o.kind === 'avoir' ? -1n : 1n;
    return paiements.filter((p) => compte(p.accountId, p.method) === tiroir)
      .map((p) => ({ nature: 'achat' as const, cle: texte(p.id) || 'p', montant: sens * enEntier(p.amount, tauxDe(o, p), decimales), jour: texte(p.date) || null }));
  }
  // Une facture (pas un ticket : ses espèces sont celles du Z) : un paiement reçu ENTRE dans le tiroir, un remboursement en sort.
  if (o.type !== 'facture' || o.ticket) return [];
  return paiements.filter((p) => compte(p.accountId, p.method) === tiroir && !texte(p.note).startsWith('Rendu sur le ticket'))
    .map((p) => ({ nature: 'vente' as const, cle: texte(p.id) || 'p', montant: -enEntier(p.amount, tauxDe(o, p), decimales), jour: texte(p.date) || null }));
}
