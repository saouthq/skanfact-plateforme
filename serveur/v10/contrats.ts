// Les factures périodiques émises seules (brique 129 ; docs/api-situation.md, S7). Un contrat récurrent de la v10
// marqué `emettreSeul` (par le propriétaire ou un administrateur, 0065) voit sa facture fabriquée comme la v10 la
// fabrique (`buildRecurringInvoice`), puis émise par le serveur à sa date, au nom du propriétaire : le numéro de la
// série, les montants scellés, l'avis `facture.emise`. Une échéance manquée (le serveur arrêté) se rattrape, une facture
// par période, 12 au plus, comme « Générer les brouillons ». Une émission refusée (un client supprimé, une fiche
// incomplète pour la facture électronique…) n'émet rien : son motif est noté sur le contrat, et elle se retente le
// lendemain. La signature et l'envoi à la TTN restent à une personne.

import { motif as texteDe, rendre } from '../../textes/index.ts';
import { enTantQue, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { appliquer, emettreDepuisV10 } from './dossier.ts';
import type { Json } from './lecture.ts';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const moisDe = (iso: string) => `${MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
// Comme la v10 (`fillTemplate`) : {mois}, {annee} ; le reste tel quel.
const remplir = (texte: unknown, v: Record<string, string>) => String(texte ?? '').replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

// Comme la v10 (`addMonths`) : n mois plus tard, au jour voulu (le 31 devient le dernier jour du mois).
export function ajouterMois(iso: string, n: number, jour: unknown): string {
  const [a, m] = iso.split('-').map(Number) as [number, number];
  const total = a * 12 + (m - 1) + n;
  const na = Math.floor(total / 12), nm = total % 12;
  const dernier = new Date(Date.UTC(na, nm + 1, 0)).getUTCDate();
  const j = Math.min(Math.max(1, Number(jour) || Number(iso.slice(8, 10))), dernier);
  return `${na}-${String(nm + 1).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}
export const echeanceSuivante = (iso: string, every: unknown, jour: unknown) => ajouterMois(iso, every === 'year' ? 12 : every === 'quarter' ? 3 : 1, jour);

// La facture du contrat pour une date, comme la v10 la fabrique (`buildRecurringInvoice`, core.js).
export function factureDuContrat(rec: Json, date: string, societe: Json, client: Json | null): Json {
  const v = { mois: moisDe(date), annee: date.slice(0, 4) };
  const delai = societe.paymentTermsDays === '' || societe.paymentTermsDays == null ? 30
    : Number.isFinite(Number(societe.paymentTermsDays)) && Number(societe.paymentTermsDays) >= 0 ? Math.round(Number(societe.paymentTermsDays)) : 30;
  const echeance = new Date(`${date}T00:00:00Z`);
  echeance.setUTCDate(echeance.getUTCDate() + delai);
  return {
    type: 'facture', number: '', status: 'brouillon', date, dueDate: echeance.toISOString().slice(0, 10),
    clientId: rec.clientId, subject: remplir(rec.subject, v), reference: rec.reference ?? '',
    lines: (Array.isArray(rec.lines) ? rec.lines as Json[] : []).map((l) => ({ ...l, label: remplir(l.label, v), description: remplir(l.description ?? '', v) })),
    discountRate: rec.discountRate ?? 0, applyStamp: !(client && client.stampExempt), notes: remplir(rec.notes ?? '', v), payments: [],
    withholdingRate: rec.withholdingRate ?? 0, recurringId: rec.id, lang: rec.lang ?? societe.defaultLang ?? 'fr',
    currency: rec.currency ?? societe.currency, exchangeRate: rec.exchangeRate ?? '',
  };
}

const lire = async (tx: Transaction, entreprise: string, collection: string, cle: string) =>
  (await tx.query('select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = $2 and cle = $3', [entreprise, collection, cle])).rows[0] as
    { contenu: Json; revision: string; rang: number | null } | undefined;

// Les factures dues d'UN contrat, au jour dit, dans la transaction du propriétaire : chacune émise, puis le contrat
// avancé d'une période (12 périodes au plus par tour, comme la v10). Rend le nombre émis.
export async function emettreUnContrat(tx: Transaction, entreprise: string, cle: string, utilisateur: string, jour: string): Promise<number> {
  const ligne = (await tx.query(`select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' and cle = $2 for update`, [entreprise, cle])).rows[0] as
    { contenu: Json; revision: string; rang: number | null } | undefined;
  // Relu sous verrou : suspendu, ou plus émis seul, depuis la liste du tour, il attend.
  if (!ligne || ligne.contenu.emettreSeul !== true || ligne.contenu.active === false) return 0;
  const rec = { ...ligne.contenu };
  const societe = (await lire(tx, entreprise, '_racine', 'company'))?.contenu ?? {};
  let n = 0, periodes = 0;
  while (typeof rec.nextDate === 'string' && rec.nextDate <= jour && periodes < 12) {
    const date = rec.nextDate;
    const client = (await lire(tx, entreprise, 'clients', String(rec.clientId ?? '')))?.contenu ?? null;
    // L'identifiant de la facture dit son contrat et sa date : deux tours ne la font jamais deux fois.
    const id = `contrat-${cle}-${date}`;
    if (!(await lire(tx, entreprise, 'documents', id))) {
      const doc = { ...factureDuContrat(rec, date, societe, client), id, createdAt: Date.now() };
      await appliquer(tx, entreprise, utilisateur, [{ collection: 'documents', cle: id, rang: null, revision: null, contenu: doc }], { serveur: true });
      await emettreDepuisV10(tx, entreprise, utilisateur, { document: doc, client, revision: 1, rang: null, netAPayer: null });
      n++;
    }
    rec.lastIssued = date;
    rec.nextDate = echeanceSuivante(date, rec.every, rec.day);
    periodes++;
  }
  delete rec.refusServeur;
  await appliquer(tx, entreprise, utilisateur, [{ collection: 'recurring', cle, rang: ligne.rang, revision: Number(ligne.revision), contenu: rec }], { serveur: true });
  return n;
}

// Le tour du serveur : tous les contrats dus, chacun dans sa transaction (un refus n'arrête pas les autres).
export async function emettreLesContrats(ctx: Contexte, maintenant = new Date()): Promise<{ contrats: number; emises: number; refusees: number }> {
  const jour = aujourdhuiATunis(maintenant);
  const dus = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select ventes.contrats_dus($1) v', [jour])).rows[0]?.v as
    { entreprise: string; cle: string; proprietaire: string }[]);
  let emises = 0, refusees = 0;
  for (const d of dus) {
    try {
      emises += await enTantQue(ctx.pool, d.proprietaire, (tx) => emettreUnContrat(tx, d.entreprise, d.cle, d.proprietaire, jour));
    } catch (e) {
      refusees++;
      // Un refus se dit tel quel ; autre chose, sans détail (il se lit dans le journal du serveur).
      const motif = e instanceof Refus ? e.message : rendre(texteDe('commun.erreur_serveur'), 'fr');
      if (!(e instanceof Refus)) console.error(e);
      // Le motif se note sur le contrat (l'écran le montre) ; le contrat se retente demain.
      await enTantQue(ctx.pool, d.proprietaire, async (tx) => {
        const l = await lire(tx, d.entreprise, 'recurring', d.cle);
        if (!l) return;
        await appliquer(tx, d.entreprise, d.proprietaire, [{ collection: 'recurring', cle: d.cle, rang: l.rang, revision: Number(l.revision),
          contenu: { ...l.contenu, refusServeur: { le: jour, echeance: l.contenu.nextDate ?? null, motif } } }], { serveur: true });
      });
    }
  }
  return { contrats: dus.length, emises, refusees };
}
