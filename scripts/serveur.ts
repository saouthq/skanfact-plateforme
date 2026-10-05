// Une commande au serveur d'essai, par l'accès de Claude (exploitation/acces.ts ; docs/mise-en-ligne.md, F) : signée
// par la clé de cette session, qui ne vit que hors du dépôt (~/.skanfact-acces/cle.pem, et son nom dans
// ~/.skanfact-acces/id). La sortie et les erreurs de la commande s'affichent ; le code de sortie est le sien.
//
//   scripts/serveur.sh 'systemctl status skanfact --no-pager'
//   echo 'journalctl -u skanfact -n 50 --no-pager' | scripts/serveur.sh
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dossier = process.env.SKANFACT_ACCES_DOSSIER ?? path.join(os.homedir(), '.skanfact-acces');
const adresse = process.env.SKANFACT_SERVEUR ?? 'https://app.skanfact.tn';
const commande = process.argv.slice(2).join(' ') || fs.readFileSync(0, 'utf8');
const corps = JSON.stringify({
  cle: fs.readFileSync(path.join(dossier, 'id'), 'utf8').trim(),
  horodatage: new Date().toISOString(),
  nonce: randomBytes(16).toString('hex'),
  commande,
  delaiSecondes: Number(process.env.SKANFACT_ACCES_DELAI ?? 300),
});
const signature = sign(null, Buffer.from(corps), createPrivateKey(fs.readFileSync(path.join(dossier, 'cle.pem')))).toString('base64');
const r = await fetch(`${adresse}/acces/commande`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signature }, body: corps });
const reponse = await r.json().catch(() => ({ raison: `réponse illisible (${r.status})` })) as { code?: number | null; tempsDepasse?: boolean; sortie?: string; erreurs?: string; raison?: string };
if (!r.ok) { console.error(`Refusé (${r.status}) : ${reponse.raison ?? ''}`); process.exit(2); }
if (reponse.sortie) process.stdout.write(reponse.sortie);
if (reponse.erreurs) process.stderr.write(reponse.erreurs);
if (reponse.tempsDepasse) console.error('(temps dépassé : la commande a été arrêtée)');
process.exit(reponse.code ?? 1);
