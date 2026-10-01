// Le code du téléphone de Nadia, à l'instant (l'application d'authentification de l'essai : scripts/humain/exemple-caisse.ts).
import fs from 'node:fs';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

console.log(codeTotp(depuisBase32(fs.readFileSync('/tmp/skanfact-humain-plateforme/totp.secret', 'utf8').trim()), Date.now()));
