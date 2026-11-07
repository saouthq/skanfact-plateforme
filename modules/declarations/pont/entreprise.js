// @ts-check
// Le pont du module Déclarations, côté entreprise (docs/cadrage/17-rangement.md § 3.3 : ce qu'un module demande de neuf
// au pont s'écrit dans son dossier, assemblé à la suite du pont ; posé au lot 1.301.0, le 07/11/2026). Il parle au
// serveur par la porte que le pont pose au socle (`Socle.porte('pont').appel`) et ajoute ses gestes à `window.skanfact`.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  if (!w.skanfact || !w.Socle) return;
  /** @type {(methode: string, chemin: string, corps?: unknown) => Promise<any>} */
  const appel = w.Socle.porte('pont').appel;
  // (1.301.0) Ce que le cabinet a fait des livres : ses déclarations de l'année (déposée le…, sa référence, ses cases) et la
  // période qu'il a validée. La Comptabilité de l'entreprise le dit à côté de ses propres chiffres ; sans le droit de lire
  // les livres, ou hors ligne, `null` : la page dit ce qu'elle sait, sans inventer.
  w.skanfact.livresDuCabinet = async (/** @type {number} */ annee) => {
    try {
      const [d, c] = await Promise.all([appel('GET', `/compta/declarations?annee=${Number(annee)}`), appel('GET', '/compta/cloture')]);
      return { annee: Number(annee), declarations: Array.isArray(d.declarations) ? d.declarations : [], valideJusqua: typeof c.jusqua === 'string' ? c.jusqua.slice(0, 10) : '' };
    } catch { return null; }
  };
})();
