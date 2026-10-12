// Un WinSMS simulé, pour les tests (le code de connexion au choix, 0081 ; serveur/sms.ts). Il garde ce qu'il reçoit (le
// numéro, le texte, l'expéditeur, la clé), et répond comme on lui dit : un envoi accepté, ou un refus. La forme exacte
// de la réponse du vrai WinSMS n'est pas publiée : À VÉRIFIER avec le compte réel (exploitation/sms.sh la montre).

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type SmsRecu = { action: string; cle: string; a: string; texte: string; de: string | null; methode: string };

export async function winsmsSimule() {
  const recus: SmsRecu[] = [];
  let reponse: { statut: number; corps: string } = { statut: 200, corps: JSON.stringify({ code: 'ok', message: 'Successfully Send' }) };
  const serveur = http.createServer((req, res) => {
    let texte = '';
    req.on('data', (c: Buffer) => { texte += c.toString('utf8'); });
    req.on('end', () => {
      const f = new URLSearchParams(texte);
      recus.push({ action: f.get('action') ?? '', cle: f.get('api_key') ?? '', a: f.get('to') ?? '', texte: f.get('sms') ?? '', de: f.get('from'), methode: req.method ?? '' });
      res.writeHead(reponse.statut, { 'content-type': 'application/json' });
      res.end(reponse.corps);
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const adresse = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/sms/sms/api`;
  return {
    adresse, recus,
    repondre: (statut: number, corps: string) => { reponse = { statut, corps }; },
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}
