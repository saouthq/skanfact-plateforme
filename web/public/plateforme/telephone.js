// @ts-check
// Le bouton « Menu » du téléphone, pour l'interface v10 (voir telephone.css). La v10, application de
// bureau, n'en avait pas besoin : sa barre latérale est toujours là. Sur un téléphone, la barre
// devient une barre du haut ; ce bouton ouvre et ferme le menu, qui se referme dès qu'on choisit une
// page. Ce fichier AJOUTE un bouton ; il ne touche à rien de la v10.
(function () {
  'use strict';
  function poser() {
    const barre = document.querySelector('.sidebar');
    // L'en-tête de la barre : celui de l'entreprise (`.brand-wrap`), ou la marque du Cabinet (brique 110).
    const tete = document.querySelector('.sidebar .brand-wrap') || document.querySelector('.sidebar > .brand');
    if (!barre || !tete || tete.querySelector('.menu-tel')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm menu-tel';
    b.textContent = 'Menu';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'nav');
    const basculer = (/** @type {boolean} */ ouvert) => { barre.classList.toggle('menu-ouvert', ouvert); b.setAttribute('aria-expanded', String(ouvert)); };
    b.addEventListener('click', () => basculer(!barre.classList.contains('menu-ouvert')));
    // Une page choisie ferme le menu (le lien change l'adresse).
    window.addEventListener('hashchange', () => basculer(false));
    tete.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poser); else poser();
})();
