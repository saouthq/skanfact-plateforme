// @ts-check
// Le message de SkanFact à tous ses clients (docs/console.md C28 ; base 0093) : la direction l'écrit dans la console
// (Réglages, « Messages aux clients ») ; il s'affiche en haut de chaque page de l'application, daté, jamais plus d'un à la
// fois. Le pont le relit avec l'abonnement (au chargement, chaque heure, au retour au premier plan) et le repose à chaque
// page (le routeur réécrit la page). « Plus tard » le cache sur cet appareil, pour CE message seulement : un message neuf
// reparaît. Le bandeau garde sa place jusqu'à la page suivante, avec une phrase qui dit ce qui s'est passé : s'il
// disparaissait sous le clic, la page remonterait et le second clic d'un double clic tomberait sur le bouton d'en
// dessous (« + Nouvelle facture »).
// Depuis 0139 (docs/console.md C63) : le serveur ne rend que le message qui vise l'entreprise de la page, et `suivi` (donné
// par le pont) dit qu'il a été montré, puis caché — le message et l'entreprise seuls, jamais la personne ni l'appareil.
(function () {
  'use strict';
  const CLE = 'skanfact.message.cache';
  /** @param {unknown} v */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] || c);
  const SORTES = /** @type {Record<string, string>} */ ({ nouveaute: 'Nouveauté', maintenance: 'Maintenance prévue' });
  // Cachés pendant cette visite, même quand le navigateur refuse de garder le choix (navigation privée).
  /** @type {Set<string>} */ const cachesIci = new Set();
  function cache() { try { return localStorage.getItem(CLE); } catch { return null; } }
  /** @param {string} id */
  function cacher(id) {
    cachesIci.add(id);
    try { localStorage.setItem(CLE, id); } catch { /* le choix vaut pour cette visite */ }
  }

  /** @param {HTMLElement} view @param {{ id: string, sorte: string, texte: string } | null} m
   *  @param {{ vu: (id: string) => void, cache: (id: string) => void } | null} [suivi] */
  function poser(view, m, suivi) {
    const deja = /** @type {HTMLElement | null} */ (view.querySelector(':scope > .sk-message'));
    if (!m || cachesIci.has(m.id) || cache() === m.id) { if (deja) deja.remove(); return; }
    if (deja && deja.dataset.message === m.id) return;
    if (deja) deja.remove();
    const el = document.createElement('div');
    el.className = `banner info sk-message sk-message-${m.sorte === 'maintenance' ? 'maintenance' : 'nouveaute'}`;
    el.setAttribute('role', 'status');
    el.dataset.message = m.id;
    el.innerHTML = `<span class="sk-message-sorte">${esc(SORTES[m.sorte] || SORTES.nouveaute)}</span>
      <span class="sk-message-texte">${esc(m.texte)}</span>
      <button type="button" class="btn btn-sm sk-message-plus-tard" title="Le cacher sur cet appareil ; un nouveau message reparaîtra">Plus tard</button>`;
    /** @type {HTMLElement} */ (el.querySelector('.sk-message-plus-tard')).onclick = () => {
      cacher(m.id);
      suivi?.cache(m.id);
      // La hauteur de mise en page (le style calculé, au centième), pas celle de l'écran : dans l'affichage compact (zoom de la page), la
      // hauteur mesurée à l'écran, reposée en style, rétrécissait encore la place et la page remontait sous le curseur.
      el.style.minHeight = getComputedStyle(el).height;
      el.classList.add('sk-message-cache');
      el.innerHTML = '<span class="sk-message-texte">Message caché sur cet appareil : un nouveau message reparaîtra.</span>';
    };
    view.insertBefore(el, view.firstChild);
    suivi?.vu(m.id);
  }

  /** @type {any} */ (window).SkanMessage = { poser };
})();
