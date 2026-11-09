// @ts-check
// Le pont du module Ventes, côté entreprise (docs/cadrage/17-rangement.md § 3.3 : ce qu'un module demande de neuf au pont
// s'écrit dans son dossier, assemblé à la suite du pont ; posé à la 1.329.0, le 09/11/2026). Il parle au serveur par la
// porte que le pont pose au socle (`Socle.porte('pont').appel`) et ajoute ses gestes à `window.skanfact`.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  if (!w.skanfact || !w.Socle) return;
  /** @type {(methode: string, chemin: string, corps?: unknown) => Promise<any>} */
  const appel = w.Socle.porte('pont').appel;
  // (1.329.0) Le numéro que la prochaine facture ou le prochain avoir prendra, lu au serveur qui le donnera (« Je facturais
  // déjà » compris) : la fenêtre d'émission l'annonce. Il se lit, il ne se réserve pas ; en lecture pour le support, ou hors
  // ligne, l'appel échoue et l'écran prend sa propre règle.
  w.skanfact.prochainNumero = async (/** @type {string} */ type, /** @type {string} */ date) =>
    appel('GET', `/dossier-v10/prochain-numero?type=${encodeURIComponent(type)}&date=${encodeURIComponent(date)}`);
})();
