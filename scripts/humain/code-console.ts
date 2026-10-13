// Le code du téléphone d'un membre de l'équipe de l'essai de la console, à l'instant (scripts/humain/exemple-console.ts).
//   node scripts/humain/code-console.ts amira
import fs from 'node:fs';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const qui = process.argv[2] ?? 'amira';
console.log(codeTotp(depuisBase32(fs.readFileSync(`/tmp/skanfact-humain-plateforme/console-${qui}.secret`, 'utf8').trim()), Date.now()));
