// Le Cabinet sans paquets, dans les mots (brique 38 bis ; docs/cabinet.md, C4 et C14). Sur la
// plateforme, il n'y a plus de paquets : les livres de chaque client sont tenus en direct par le
// serveur. Ces adaptations réécrivent ce que le Cabinet v10 en disait — le tableau du portefeuille,
// les relances, la fiche d'un dossier, les bulles, l'Aide et les visites.
//
// Elles sont nombreuses et faites de texte : elles s'écrivent TELLES QUELLES dans sans-paquets.txt,
// sans rien à échapper, et se lisent ici. Même règle que les autres (adaptations.mjs) : chaque
// « avant » doit se trouver une fois exactement dans son fichier, sinon la reprise s'arrête.
//
// Le format de sans-paquets.txt : une adaptation par bloc, ses lignes en début de ligne —
//   == fichier | pourquoi
//   -- avant
//   (le texte exact de la v10)
//   -- après
//   (ce qu'il devient)
//   -- fin
// Tout ce qui est hors d'un bloc est un commentaire. Un bloc qui finit par une ligne vide finit par
// un saut de ligne.

import fs from 'node:fs';

/** @param {string} texte le contenu de sans-paquets.txt */
export function lireAdaptations(texte) {
  const lignes = texte.split('\n');
  /** @type {{ fichier: string, pourquoi: string, avant: string, apres: string }[]} */
  const out = [];
  /** @param {number} i @param {string} fin */
  const jusqua = (i, fin) => {
    const pris = [];
    for (; i < lignes.length && lignes[i] !== fin; i++) pris.push(lignes[i]);
    if (i >= lignes.length) throw new Error(`sans-paquets.txt : « ${fin} » manque après la ligne ${i}`);
    return { pris, i };
  };
  for (let i = 0; i < lignes.length; i++) {
    if (!lignes[i].startsWith('== ')) continue;
    const [fichier, ...raison] = lignes[i].slice(3).split(' | ');
    const pourquoi = raison.join(' | ').trim();
    if (!fichier || !pourquoi || lignes[i + 1] !== '-- avant') throw new Error(`sans-paquets.txt, ligne ${i + 1} : « == fichier | pourquoi » puis « -- avant » attendus`);
    const avant = jusqua(i + 2, '-- après');
    const apres = jusqua(avant.i + 1, '-- fin');
    if (!avant.pris.join('\n')) throw new Error(`sans-paquets.txt, ligne ${i + 1} : un « avant » vide ne désigne rien`);
    out.push({ fichier: fichier.trim(), pourquoi, avant: avant.pris.join('\n'), apres: apres.pris.join('\n') });
    i = apres.i;
  }
  return out;
}

export const SANS_PAQUETS = lireAdaptations(fs.readFileSync(new URL('./sans-paquets.txt', import.meta.url), 'utf8'));
