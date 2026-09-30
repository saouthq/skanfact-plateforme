// Un Konnect simulé, pour les tests (brique 78 ; docs/paiement-en-ligne.md). Il fait ce que le serveur
// attend du vrai, tel que la console l'emploie depuis la 10.9.0 (plateforme/skanfact-api.mjs du dépôt
// skanfact) : ouvrir un paiement (sa référence, l'adresse où l'on paie), dire où il en est à qui
// présente LA clé qui l'a ouvert, et, quand le client paie sur sa page, appeler l'avis puis renvoyer
// le navigateur à l'adresse de retour. Ce qui reste À VÉRIFIER sur le bac à sable de Konnect est écrit
// dans docs/paiement-en-ligne.md.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type PaiementSimule = {
  ref: string; cle: string; portefeuille: string; montant: number; devise: string; commande: string;
  statut: string; avis: string; succes: string; echec: string;
};

const lireCorps = (req: http.IncomingMessage) => new Promise<string>((ok) => {
  let texte = '';
  req.on('data', (c: Buffer) => { texte += c.toString('utf8'); });
  req.on('end', () => ok(texte));
});

export async function konnectSimule() {
  const paiements = new Map<string, PaiementSimule>();
  let refus: { statut: number; message: string } | null = null;
  // Le temps que Konnect met à dire où en est un paiement (deux vérifications qui se croisent).
  let lenteur = 0;
  let racine = '';
  const repondre = (res: http.ServerResponse, statut: number, j: unknown) => {
    res.writeHead(statut, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
  };
  // Le client paie : l'avis part (sauf si le test le retient), puis le navigateur revient.
  const payer = async (ref: string, options: { avis?: boolean } = {}) => {
    const p = paiements.get(ref);
    if (!p) throw new Error(`paiement simulé inconnu : ${ref}`);
    p.statut = 'completed';
    if (options.avis !== false) await fetch(`${p.avis}?payment_ref=${encodeURIComponent(ref)}`).catch(() => undefined);
    const retour = new URL(p.succes);
    retour.searchParams.set('payment_ref', ref);
    return retour.toString();
  };
  const serveur = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://simule');
      const corps = await lireCorps(req);
      if (req.method === 'POST' && url.pathname === '/api/v2/payments/init-payment') {
        if (refus) return repondre(res, refus.statut, { message: refus.message });
        const j = JSON.parse(corps) as Record<string, unknown>;
        const ref = randomBytes(8).toString('hex');
        paiements.set(ref, {
          ref, cle: String(req.headers['x-api-key'] ?? ''), portefeuille: String(j.receiverWalletId), montant: Number(j.amount), devise: String(j.token),
          commande: String(j.orderId), statut: 'pending', avis: String(j.webhook), succes: String(j.successUrl), echec: String(j.failUrl),
        });
        return repondre(res, 200, { payUrl: `${racine}/payer/${ref}`, paymentRef: ref });
      }
      const lu = /^\/api\/v2\/payments\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && lu) {
        const p = paiements.get(decodeURIComponent(lu[1] ?? ''));
        if (!p) return repondre(res, 404, { message: 'Payment not found' });
        if (req.headers['x-api-key'] !== p.cle) return repondre(res, 401, { message: 'Unauthorized' });
        if (lenteur) await new Promise((ok) => setTimeout(ok, lenteur));
        return repondre(res, 200, { payment: { id: p.ref, status: p.statut, amount: p.montant, token: p.devise, orderId: p.commande } });
      }
      // La page où le client paie (la vraie demande sa carte ; celle-ci, un clic).
      const page = /^\/payer\/([^/]+)$/.exec(url.pathname);
      const p = page ? paiements.get(page[1] ?? '') : undefined;
      if (p && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Konnect (simulé)</title><h1>Konnect (simulé)</h1>
          <p id="montant">${p.montant} millimes pour le portefeuille ${p.portefeuille}</p>
          <form method="post"><button>Payer (simulation)</button></form>`);
      }
      if (p && req.method === 'POST') {
        res.writeHead(302, { location: await payer(p.ref) });
        return res.end();
      }
      repondre(res, 404, { message: 'Not found' });
    })();
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  racine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  return {
    base: `${racine}/api/v2`, paiements, payer,
    // Le prochain « ouvre un paiement » est refusé (une clé fausse, un portefeuille inconnu).
    refuser: (statut: number, message: string) => { refus = { statut, message }; },
    accepter: () => { refus = null; },
    ralentir: (ms: number) => { lenteur = ms; },
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}
