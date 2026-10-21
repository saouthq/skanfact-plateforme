// Les textes des pièces jointes du dossier (lot Fonctions 3 ; docs/pieces-jointes.md).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'pieces_jointes.trop_lourd': 'Le fichier « {nom} » pèse {taille} Mo : une pièce jointe pèse {limite} Mo au plus. Une photo moins lourde, ou un PDF compressé, passera',
  'pieces_jointes.format': 'Le fichier « {nom} » n\'est ni une photo (JPEG, PNG, WebP) ni un PDF : il ne se joint pas. Enregistre-le en PDF, puis joins le PDF',
});
