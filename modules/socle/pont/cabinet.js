// @ts-check
// Le pont du socle, côté Cabinet (1.332.0 ; docs/cadrage/17-rangement.md § 3.3 : ce qu'un module demande de neuf au pont
// s'écrit dans son dossier, assemblé à la suite du pont). Le support de SkanFact : le cabinet écrit à l'équipe, relit SES
// demandes et leurs réponses (serveur/support/routes.ts, base 0206). Il parle au serveur par la porte que le pont pose au
// socle (`Socle.porte('pont').appel`) et ajoute `supportEnLigne` à `window.cabinet` : l'écran sait par lui qu'il est en
// ligne (sur le bureau, la même clé n'existe pas, et « Signaler un problème » garde son rapport).
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  if (!w.cabinet || !w.Socle) return;
  /** @type {(methode: string, chemin: string, corps?: unknown) => Promise<any>} */
  const appel = w.Socle.porte('pont').appel;
  const cabinet = new URLSearchParams(location.search).get('c') || '';
  if (!/^[0-9a-f-]{36}$/.test(cabinet)) return;
  const base = `/cabinets/${cabinet}`;
  w.cabinet.supportEnLigne = Object.freeze({
    // La page « Tes demandes au support » (plateforme/support.js) appelle des chemins `/support…` : ceux du cabinet.
    appel: (/** @type {string} */ methode, /** @type {string} */ chemin, /** @type {unknown} */ corps) => appel(methode, `${base}${chemin}`, corps),
    ecrire: (/** @type {{ sujet: string, texte: string, version?: string | null, page?: string | null }} */ d) => appel('POST', `${base}/support`, d),
    attente: () => appel('GET', `${base}/support/attente`),
  });
})();
