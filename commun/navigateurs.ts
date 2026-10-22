// Le plancher des navigateurs (1.112.0 ; VISION § 4.1) : ce que SkanFact envoie au navigateur se lit sur Chrome et Edge 111,
// Firefox 121, Safari et iOS 16.4, soit tout navigateur à jour depuis le début de 2024 (décidé par délégation le
// 22/10/2026 ; À VÉRIFIER contre les parts réelles des navigateurs en Tunisie avant le lancement). Firefox est à 121, et non
// 114 comme le défaut de Vite : nos feuilles de style lisent « :has() », que Firefox ne lit que depuis la 121 ; avant, la
// règle entière tombe, sans erreur.
//
// Un seul endroit : la construction de l'entrée et de la console (web/vite.config.ts) l'emploie, et le test des
// navigateurs (tests/web/navigateurs.test.ts) le relit contre tout ce qui est servi, la v10 comprise, qui part sans
// transformation.
export const PLANCHER = ['chrome111', 'edge111', 'firefox121', 'safari16.4', 'ios16.4'];

// La syntaxe que tout le plancher lit : ES2022 (Safari 16.4 en est le dernier venu).
export const SYNTAXE_DU_PLANCHER = 2022;
