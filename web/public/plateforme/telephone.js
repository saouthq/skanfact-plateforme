// @ts-check
// Le téléphone, pour l'interface v10 (voir telephone.css). Ce fichier AJOUTE ; il ne touche à rien de ce que fait la v10.
//
// 1. Le bouton « Menu ». La v10, application de bureau, n'en avait pas besoin : sa barre latérale est toujours là. Sur
//    un téléphone, la barre devient une barre du haut ; ce bouton ouvre et ferme le menu, qui se referme dès qu'on
//    choisit une page.
// 2. Les listes en cartes (lot téléphone, 06/10/2026). Une liste de la v10 est un tableau de six à huit colonnes : au
//    téléphone, le statut, le montant et le reste dû étaient coupés à droite, et il fallait deviner qu'on fait glisser
//    le tableau (vu sur le serveur d'essai, dans la liste des factures). Chaque ligne y devient une carte
//    (telephone.css), où chaque case porte le titre de sa colonne. Ce fichier n'écrit que des attributs : `data-cartes`
//    sur un tableau d'au moins quatre colonnes, `data-label` (le titre de la colonne) sur chaque case, `data-tel`
//    « titre » sur la première case qui nomme la ligne et « vide » sur une case sans rien. Les mêmes cases, dans le même
//    ordre, avec les mêmes gestes : une ligne se touche, « Actions » s'ouvre, un titre de colonne trie.
(function () {
  'use strict';
  function poserMenu() {
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

  // ── Les listes en cartes ──
  const TELEPHONE = window.matchMedia('(max-width: 760px)');
  /** @param {Element} el @param {string} nom @param {string} valeur */
  function poser(el, nom, valeur) {
    if (!valeur) { if (el.hasAttribute(nom)) el.removeAttribute(nom); } else if (el.getAttribute(nom) !== valeur) el.setAttribute(nom, valeur);
  }
  // Le titre d'une colonne : son texte, sans la bulle « i », la flèche du tri ni une case à cocher.
  /** @param {Element} th */
  function titreDe(th) {
    const c = /** @type {Element} */ (th.cloneNode(true));
    c.querySelectorAll('button, input, .sort-ar').forEach((x) => x.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  // Une case qui ne porte qu'une case à cocher (choisir la ligne) ne nomme pas la ligne.
  /** @param {HTMLTableCellElement} td */
  const choix = (td) => !(td.textContent || '').trim() && td.querySelectorAll('input[type=checkbox]').length === 1 && td.querySelectorAll('input, select, button, a').length === 1;
  /** @param {HTMLTableElement} table */
  function enCartes(table) {
    const tete = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!tete || tete.cells.length < 4) { poser(table, 'data-cartes', ''); return; }
    poser(table, 'data-cartes', 'oui');
    /** @type {string[]} */ const titres = [];
    for (const th of tete.cells) { titres.push(titreDe(th)); for (let k = 1; k < th.colSpan; k++) titres.push(''); }
    for (const groupe of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
      for (const tr of groupe.rows) {
        let col = 0;
        let nommee = false;
        for (const td of tr.cells) {
          const titre = td.colSpan === 1 ? titres[col] || '' : '';
          col += td.colSpan;
          const vide = !(td.textContent || '').trim() && !td.querySelector('input, select, button, a, img, svg, canvas');
          const nomme = !vide && !nommee && !choix(td) && !td.classList.contains('row-actions');
          if (nomme) nommee = true;
          poser(td, 'data-tel', vide ? 'vide' : nomme ? 'titre' : '');
          poser(td, 'data-label', nomme ? '' : titre);
        }
      }
    }
  }
  let prevu = 0;
  function passer() {
    prevu = 0;
    if (!TELEPHONE.matches) return;
    for (const t of document.querySelectorAll('table.list')) enCartes(/** @type {HTMLTableElement} */ (t));
  }
  // Une liste se redessine souvent (un filtre, une page, une ligne réglée) : on repasse avant le prochain affichage,
  // une fois par image, et seulement au téléphone.
  function suivre() {
    new MutationObserver(() => { if (!prevu && TELEPHONE.matches) prevu = requestAnimationFrame(passer); }).observe(document.body, { childList: true, subtree: true });
    TELEPHONE.addEventListener('change', passer);
    passer();
  }

  function demarrer() { poserMenu(); suivre(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
