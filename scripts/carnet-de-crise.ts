// Écrit le carnet de crise (1.109.0 ; web/console/src/carnet.ts) hors de la console : le même fichier que son bouton
// « Télécharger le carnet de crise », pour l'imprimer ou le garder sur un téléphone sans passer par le serveur.
//   node scripts/carnet-de-crise.ts [fichier]     (par défaut : carnet-de-crise-AAAA-MM-JJ.html, dans le dossier courant)
import fs from 'node:fs';
import { FICHES } from '../serveur/console/incidents.ts';

// Les textes de la console lisent la langue dans l'adresse de la page ; ici, il n'y en a pas : le français.
Object.assign(globalThis, { location: { search: '' } });
await import('../web/console/src/textes.ts');
const { carnetDeCrise } = await import('../web/console/src/carnet.ts');

const jour = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Tunis' }).format(new Date());
const fichier = process.argv[2] ?? `carnet-de-crise-${jour}.html`;
fs.writeFileSync(fichier, carnetDeCrise({ fiches: FICHES, jour }));
console.log(`Le carnet de crise : ${fichier}`);
