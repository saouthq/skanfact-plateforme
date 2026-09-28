// L'entrée de l'application web : se connecter, créer son compte, le code du téléphone, la porte de
// la première fois. Elle porte l'habit de la v10 (sa feuille de style, chargée par index.html) ; une
// fois l'entreprise choisie, c'est l'application v10 elle-même qui s'ouvre (/v10/).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './plateforme.css';

// Le thème sombre de la v10 (`body.dark`) suit celui du système, tant qu'aucun réglage ne le fixe.
const sombre = window.matchMedia('(prefers-color-scheme: dark)');
const appliquerTheme = () => document.body.classList.toggle('dark', sombre.matches);
appliquerTheme();
sombre.addEventListener('change', appliquerTheme);

const racine = document.getElementById('racine');
if (racine) createRoot(racine).render(<StrictMode><App /></StrictMode>);
