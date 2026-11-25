// Les textes de la console limitée à des adresses (serveur/adresses-console.ts ; base 0234).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'adresses_console.refusee': 'La console ne s\'ouvre pas depuis cette adresse ({adresse}) : son titulaire l\'a limitée à ses connexions. Ouvre-la depuis l\'une d\'elles ; si elles ont toutes changé, la commande du serveur la rouvre (node base/equipe.ts adresses-ouvrir).',
});
