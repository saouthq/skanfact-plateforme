// La chaîne du poste de caisse (brique 120 ; docs/caisse.md, H2). Le poste la tient, même sans réseau ; le serveur la
// recalcule à l'arrivée de chaque ticket. Les deux côtés écrivent le ticket de la même façon (`ticketDuPoste`, ses clés
// dans l'ordre : `canonique`), à partir du document tel qu'il part au serveur (encodé par le point de contact).
// La même formule est écrite dans web/public/plateforme/pont.js (`chaineDuPoste`) : elles ne divergent pas
// (tests/v10/caisse-hors-ligne.test.ts le vérifie avec la page).
import { createHash } from 'node:crypto';

export const PREMIERE = '0'.repeat(64);

function trier(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(trier);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, trier((v as Record<string, unknown>)[k])]));
  return v;
}
export const canonique = (v: unknown) => JSON.stringify(trier(v));
const sha256 = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');

// Ce que la chaîne retient d'un ticket : son numéro imprimé, l'heure au comptoir, la date, le client, les lignes, le net
// et les paiements.
export function ticketDuPoste(doc: Record<string, unknown>, netAPayer: string, numero: string, encaisseLe: string) {
  const paiements = Array.isArray(doc.payments) ? doc.payments as Record<string, unknown>[] : [];
  return { numero, encaisseLe, date: doc.date ?? null, client: doc.clientId || '', lignes: doc.lines ?? [], netAPayer,
    paiements: paiements.map((p) => ({ mode: p.method ?? null, montant: p.amount ?? null })) };
}
export const empreinteDuPoste = (precedente: string, ticket: unknown) => sha256(precedente + sha256(canonique(ticket)));

// Le numéro tel que la série l'écrit (socle.formater_numero) : le poste le refait à l'identique, sans réseau.
export function formaterNumero(format: string, prefixe: string, annee: number, numero: number) {
  const largeur = Number(/\{N:([1-9])\}/.exec(format)?.[1] ?? 1);
  const chiffres = String(numero).padStart(largeur, '0');
  return format.replaceAll('{P}', prefixe).replaceAll('{AAAA}', String(annee)).replace(/\{N(:[1-9])?\}/, chiffres);
}
