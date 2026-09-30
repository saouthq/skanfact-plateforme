// Konnect, le prestataire de paiement du lancement (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2).
// Deux questions, avec la clé de l'API de l'ENTREPRISE (l'argent va sur son portefeuille) : « ouvre un
// paiement » et « où en est ce paiement ? ». La règle de la console (10.9.0) : rien de ce que le
// navigateur ou l'avis de Konnect racontent ne décide ; la preuve se redemande, avec la clé.

import { t, type Texte } from '../../textes/index.ts';

export const KONNECT_PAR_DEFAUT = 'https://api.konnect.network/api/v2';

export type Demande = {
  portefeuille: string; montant: bigint; devise: string; commande: string; description: string;
  avis: string; succes: string; echec: string;
};
export type Reponse<T> = ({ ok: true } & T) | { ok: false; motif: Texte };

const dixSecondes = () => AbortSignal.timeout(10_000);
const lireCorps = async (r: Response) => (await r.json().catch(() => null)) as Record<string, unknown> | null;
// Ce que Konnect dit de son refus, s'il le dit (« : … » ajouté à notre phrase).
const message = (j: Record<string, unknown> | null) => (j && typeof j.message === 'string' && j.message.trim() ? ` : ${j.message.trim().slice(0, 300)}` : '');

// « Ouvre un paiement » : l'adresse où le client paie, et la référence de Konnect. Le montant part en
// entiers (des millimes pour le dinar) : jamais un nombre à virgule.
export async function initier(base: string, cle: string, d: Demande): Promise<Reponse<{ adresse: string; ref: string }>> {
  const corps = {
    receiverWalletId: d.portefeuille, token: d.devise, amount: Number(d.montant), type: 'immediate', description: d.description,
    lifespan: 30, orderId: d.commande, webhook: d.avis, successUrl: d.succes, failUrl: d.echec, silentWebhook: true, checkoutForm: false,
  };
  try {
    const r = await fetch(`${base}/payments/init-payment`, {
      method: 'POST', headers: { 'x-api-key': cle, 'content-type': 'application/json' }, body: JSON.stringify(corps), signal: dixSecondes(),
    });
    const j = await lireCorps(r);
    if (!r.ok) return { ok: false, motif: t('paiement.konnect_refuse', { statut: String(r.status), message: message(j) }) };
    const adresse = String(j?.payUrl ?? ''), ref = String(j?.paymentRef ?? '');
    if (!/^https?:\/\//.test(adresse) || !ref) return { ok: false, motif: t('paiement.konnect_illisible') };
    return { ok: true, adresse, ref };
  } catch {
    return { ok: false, motif: t('paiement.konnect_injoignable') };
  }
}

// « Où en est ce paiement ? »
export async function lire(base: string, cle: string, ref: string): Promise<Reponse<{ paiement: Record<string, unknown> }>> {
  try {
    const r = await fetch(`${base}/payments/${encodeURIComponent(ref)}`, { headers: { 'x-api-key': cle, accept: 'application/json' }, signal: dixSecondes() });
    const j = await lireCorps(r);
    if (!r.ok) return { ok: false, motif: t('paiement.konnect_refuse', { statut: String(r.status), message: message(j) }) };
    // Konnect enveloppe sa réponse dans `payment` ; une enveloppe qui changerait de nom ne doit pas
    // devenir « introuvable » chez quelqu'un qui a payé.
    const p = (j && typeof j.payment === 'object' && j.payment !== null ? j.payment : j) as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return { ok: false, motif: t('paiement.konnect_illisible') };
    return { ok: true, paiement: p };
  } catch {
    return { ok: false, motif: t('paiement.konnect_injoignable') };
  }
}

// Ce que Konnect a répondu vaut-il encaissement de CETTE demande ? « completed », notre commande, notre
// montant exact. Tout autre état n'est pas encore un encaissement, et jamais un échec définitif : le
// client n'a peut-être pas fini, et un paiement fini plus tard doit encore pouvoir s'enregistrer. Seul
// un « completed » qui ne correspond pas à la demande (une autre commande, un autre montant) échoue.
export type Verdict = { etat: 'encaisse' } | { etat: 'attente'; statut: string } | { etat: 'echoue'; motif: Texte };
export function verdict(p: Record<string, unknown>, attendu: { commande: string; montant: bigint }): Verdict {
  const statut = String(p.status ?? '').toLowerCase().slice(0, 40);
  if (statut !== 'completed') return { etat: 'attente', statut };
  if (String(p.orderId ?? '') !== attendu.commande) return { etat: 'echoue', motif: t('paiement.konnect_autre_commande') };
  const recu = typeof p.amount === 'number' && Number.isSafeInteger(p.amount) ? BigInt(p.amount)
    : typeof p.amount === 'string' && /^\d+$/.test(p.amount) ? BigInt(p.amount) : null;
  if (recu !== attendu.montant) return { etat: 'echoue', motif: t('paiement.konnect_autre_montant', { recu: String(p.amount ?? ''), attendu: attendu.montant.toString() }) };
  return { etat: 'encaisse' };
}
