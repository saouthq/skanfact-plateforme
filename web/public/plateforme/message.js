// @ts-check
// Le message de SkanFact à tous ses clients (docs/console.md C28 ; base 0093) : la direction l'écrit dans la console
// (Réglages, « Messages aux clients ») ; il s'affiche en haut de chaque page de l'application, daté, jamais plus d'un à la
// fois. Le pont le relit avec l'abonnement (au chargement, chaque heure, au retour au premier plan) et le repose à chaque
// page (le routeur réécrit la page). « Plus tard » le cache sur cet appareil, pour CE message seulement : un message neuf
// reparaît. Le bandeau garde sa place jusqu'à la page suivante, avec une phrase qui dit ce qui s'est passé : s'il
// disparaissait sous le clic, la page remonterait et le second clic d'un double clic tomberait sur le bouton d'en
// dessous (« + Nouvelle facture »).
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

  /** @param {HTMLElement} view @param {{ id: string, sorte: string, texte: string } | null} m */
  function poser(view, m) {
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
      el.style.minHeight = `${el.getBoundingClientRect().height}px`;
      el.classList.add('sk-message-cache');
      el.innerHTML = '<span class="sk-message-texte">Message caché sur cet appareil : un nouveau message reparaîtra.</span>';
    };
    view.insertBefore(el, view.firstChild);
  }

  /** @type {any} */ (window).SkanMessage = { poser };
})();
