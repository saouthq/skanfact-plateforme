// La console de l'équipe SkanFact (docs/console.md) : une page à part de l'application, servie sous /console/, avec ses
// écrans, sa feuille de style et ses textes. Ses trois polices viennent du serveur lui-même (la politique des écrans
// n'admet rien d'ailleurs). Le service des écrans de l'application ne la garde jamais pour le hors-ligne (sw.js).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/ibm-plex-mono/500.css';
import './console.css';
import './textes.ts';
import { Console, themeChoisi } from './Console.tsx';

// Le thème choisi se pose avant le premier dessin : jamais un éclair de clair avant le sombre.
const choix = themeChoisi();
if (choix) document.documentElement.dataset.theme = choix;

const racine = document.getElementById('console');
if (racine) createRoot(racine).render(<StrictMode><Console /></StrictMode>);
