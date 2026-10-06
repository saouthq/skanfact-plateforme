// L'entrée de l'application web : se connecter, créer son compte, le code du téléphone, la porte de
// la première fois. Elle porte l'habit de la v10 (sa feuille de style, chargée par index.html) ; une
// fois l'entreprise choisie, c'est l'application v10 elle-même qui s'ouvre (/v10/).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './plateforme.css';
// L'habit de l'entrée (lot entrée, 06/10/2026) et ses deux polices, servies par le serveur lui-même.
import '@fontsource-variable/bricolage-grotesque/wght.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/ibm-plex-mono/500.css';
import './entree.css';

// Le thème sombre de la v10 (`body.dark`) suit celui du système, tant qu'aucun réglage ne le fixe.
const sombre = window.matchMedia('(prefers-color-scheme: dark)');
const appliquerTheme = () => document.body.classList.toggle('dark', sombre.matches);
appliquerTheme();
sombre.addEventListener('change', appliquerTheme);

// Le service des écrans (brique 72) : l'application s'installe, et s'ouvre sans réseau.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* en ligne, tout marche sans lui */ });

const racine = document.getElementById('racine');
if (racine) createRoot(racine).render(<StrictMode><App /></StrictMode>);
