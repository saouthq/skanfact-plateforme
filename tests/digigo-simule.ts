// Un DigiGo simulé, pour les tests (brique 81 ; docs/facture-electronique.md). DigiGo (TunTrust) est une
// signature À DISTANCE : le certificat du signataire reste dans le coffre de TunTrust, et chaque signature
// est autorisée par un code reçu sur SON téléphone. Ce que le serveur attend du vrai, d'après ce que TunTrust
// publie de son service (« tunsign-proxy » : une session ouverte pour le titulaire, le code à usage unique
// qui l'active (setOtpAuth), puis la signature d'un fichier en XAdES) ; les noms exacts, les champs et les
// erreurs sont À VÉRIFIER avec la documentation d'intégration (l'adhésion « entité d'intégration »).
//
// Le simulé signe « pour de faux » : il enveloppe le fichier d'un élément <ds:Signature> qui porte le nom du
// titulaire et une empreinte du fichier. Aucun certificat n'est en jeu : ce n'est pas une vraie signature.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type SessionSimulee = { session: string; titulaire: string; code: string; active: boolean; essais: number; signes: number };

const lireCorps = (req: http.IncomingMessage) => new Promise<string>((ok) => {
  let texte = '';
  req.on('data', (c: Buffer) => { texte += c.toString('utf8'); });
  req.on('end', () => ok(texte));
});

export async function digigoSimule(cleIntegrateur = 'cle-integrateur-essai') {
  // Les titulaires connus (identifiant DigiGo → nom sur le certificat).
  const titulaires = new Map<string, string>([['09876543', 'Nadia Ben Salah']]);
  const sessions = new Map<string, SessionSimulee>();
  // Un DigiGo qui rendrait un autre fichier que celui reçu (le serveur doit le voir) : à partir de la n-ième
  // signature d'une session (null : jamais).
  let falsifie: number | null = null;
  const repondre = (res: http.ServerResponse, statut: number, j: unknown) => {
    res.writeHead(statut, { 'content-type': 'application/json' });
    res.end(JSON.stringify(j));
  };
  const serveur = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://simule');
      const corps = await lireCorps(req);
      if (req.headers['x-cle-integrateur'] !== cleIntegrateur) return repondre(res, 401, { message: 'Integrateur inconnu' });
      const j = (corps ? JSON.parse(corps) : {}) as Record<string, string>;
      // Ouvrir une session pour le titulaire : un code part sur son téléphone.
      if (req.method === 'POST' && url.pathname === '/tunsign-proxy/session') {
        const titulaire = String(j.identifiant ?? '');
        if (!titulaires.has(titulaire)) return repondre(res, 404, { message: 'Titulaire inconnu' });
        const session = randomBytes(8).toString('hex');
        sessions.set(session, { session, titulaire, code: String(randomInt(0, 1_000_000)).padStart(6, '0'), active: false, essais: 0, signes: 0 });
        return repondre(res, 200, { session, nom: titulaires.get(titulaire) });
      }
      const s = sessions.get(String(j.session ?? ''));
      if (!s) return repondre(res, 404, { message: 'Session inconnue' });
      // Le code reçu : trois essais, puis la session est perdue.
      if (req.method === 'POST' && url.pathname === '/tunsign-proxy/setOtpAuth') {
        if (s.essais >= 3) return repondre(res, 423, { message: 'Session bloquee' });
        if (String(j.otp ?? '') !== s.code) { s.essais++; return repondre(res, 401, { message: 'OTP invalide' }); }
        s.active = true;
        return repondre(res, 200, { ok: true });
      }
      // Signer un fichier XML (XAdES, enveloppée) : seulement dans une session activée par le code.
      if (req.method === 'POST' && url.pathname === '/tunsign-proxy/sign') {
        if (!s.active) return repondre(res, 403, { message: 'Session non activee' });
        const xml = Buffer.from(String(j.fichier ?? ''), 'base64').toString('utf8');
        if (!xml.includes('</TEIF>')) return repondre(res, 400, { message: 'Fichier illisible' });
        s.signes++;
        const rendu = falsifie !== null && s.signes >= falsifie ? xml.replace(/<DocumentIdentifier>[^<]*</, '<DocumentIdentifier>FAUX-1<') : xml;
        const signature = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="SigFrs"><ds:SignatureValue>SIMULEE-${createHash('sha256').update(xml).digest('base64')}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509SubjectName>CN=${titulaires.get(s.titulaire)}</ds:X509SubjectName></ds:X509Data></ds:KeyInfo></ds:Signature>`;
        return repondre(res, 200, { fichier: Buffer.from(rendu.replace('</TEIF>', `${signature}</TEIF>`), 'utf8').toString('base64') });
      }
      repondre(res, 404, { message: 'Not found' });
    })();
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/tunsign-proxy`;
  return {
    base, cleIntegrateur, sessions, titulaires,
    // Le code que le titulaire a reçu sur son téléphone (le test le lit, comme la personne le lirait).
    codeDe: (titulaire: string) => [...sessions.values()].filter((x) => x.titulaire === titulaire).at(-1)?.code,
    falsifier: (des: number | null) => { falsifie = des; },
    // Les sessions ouvertes expirent (DigiGo ne les connaît plus).
    expirer: () => { sessions.clear(); },
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}
