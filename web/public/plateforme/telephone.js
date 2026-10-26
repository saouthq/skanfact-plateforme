// @ts-check
// Le téléphone, pour l'interface v10 (voir telephone.css). Ce fichier AJOUTE ; il ne touche à rien de ce que fait la v10.
//
// 1. (Retiré en 1.152.0.) Le bouton « Menu » et, en 7, le raccourci des messages : la barre de la maquette « Barre v3 »
//    (plateforme/barre.js) porte la navigation du téléphone à l'entreprise et au Cabinet (ses onglets du bas, « Plus »).
// 2. Les listes en cartes (lot téléphone, 06/10/2026). Une liste de la v10 est un tableau de six à huit colonnes : au
//    téléphone, le statut, le montant et le reste dû étaient coupés à droite, et il fallait deviner qu'on fait glisser
//    le tableau (vu sur le serveur d'essai, dans la liste des factures). Chaque ligne y devient une carte
//    (telephone.css), où chaque case porte le titre de sa colonne. Ce fichier n'écrit que des attributs : `data-cartes`
//    sur un tableau d'au moins quatre colonnes, `data-label` (le titre de la colonne) sur chaque case, `data-tel`
//    « titre » sur la première case qui nomme la ligne et « vide » sur une case sans rien. Les mêmes cases, dans le même
//    ordre, avec les mêmes gestes : une ligne se touche, « Actions » s'ouvre, un titre de colonne trie.
// 3. Les chiffres des cartes (13/10/2026). Au téléphone, deux cartes par rangée : un montant de huit chiffres
//    (« 12 500,000 DT », le prix de vente d'un stock) dépassait de sa carte, qui le coupait. Un montant se lit d'un
//    bloc, il ne passe pas à la ligne : trop long pour sa carte, il se resserre d'un cran, puis d'un second
//    (`data-tel-serre`, telephone.css). Ce qui tient garde la taille de la v10.
// 4. « Aperçu » d'une pièce (1.87.12). Au téléphone, l'aperçu est déjà là, tout en bas sous le formulaire ; le bouton le
//    MASQUAIT, sans que rien ne bouge à l'écran, puis disait « Afficher l'aperçu » (vu en recette le 21/10/2026). Au
//    téléphone, il ouvre l'aperçu en grand, comme « Agrandir » : c'est ce qu'on attend en le touchant.
// 5. Le nom des cases d'une ligne (1.87.19), à toutes les largeurs. La quantité, le prix, la TVA d'une ligne de pièce
//    n'avaient d'autre nom que le titre de leur colonne, que rien ne relie à la case : au clavier, un lecteur d'écran
//    disait « zone d'édition » (vu en recette le 21/10/2026). Chaque case d'un tableau de lignes qui n'a pas de nom
//    reçoit « le titre de sa colonne, ligne N » (`aria-label`, marqué `data-nom-ligne` pour suivre l'ordre des lignes).
//    Les listes de filtre d'une page (l'année, le mois, le statut…) n'avaient pas de nom non plus : chacune garde le
//    même identifiant d'une page à l'autre, qui dit ce qu'elle choisit. Et un titre de champ posé À CÔTÉ de sa case
//    (`<span class="fl">`, l'unité d'une prestation) ne nommait pas la case qui le suit : elle prend son texte, sans la
//    bulle.
// 6. Les bulles des titres de colonne d'une ligne (1.93.0). Au téléphone, l'en-tête d'un tableau de lignes se cache, et
//    chaque case porte son titre juste au-dessus d'elle (1.87.17, 1.87.21) : les bulles « i » de l'en-tête (l'unité, la
//    TVA, la destination, la TVA déductible) partaient avec lui (vu en recette le 21/10/2026). Elles se rangent au-dessus
//    des lignes, une seule fois et non sur chaque ligne, chacune avec ce qu'elle explique : les mêmes bulles, qui
//    s'ouvrent au doigt (`.aide-colonnes`, telephone.css). À l'ordinateur, l'en-tête les porte : rien ne s'ajoute.
(function () {
  'use strict';
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
  // (1.143.0) Une date seule ne nomme pas la ligne non plus : la carte d'un achat se titrait « 23/10/2026 », la pièce et
  // le fournisseur venaient dessous (UX 3). La ligne prend le nom de la case suivante, la date reste une case.
  /** @param {HTMLTableCellElement} td */
  const dateSeule = (td) => /^\d{2}\/\d{2}\/\d{4}$/.test((td.textContent || '').trim()) && !td.querySelector('input, select, button, a');
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
          const nomme = !vide && !nommee && !choix(td) && !dateSeule(td) && !td.classList.contains('row-actions');
          if (nomme) nommee = true;
          poser(td, 'data-tel', vide ? 'vide' : nomme ? 'titre' : '');
          poser(td, 'data-label', nomme ? '' : titre);
          // (1.143.0) Le client ou le fournisseur se lit juste sous les montants : « Type : Facture » passait avant lui (UX 3).
          poser(td, 'data-tel-tiers', !nomme && !vide && /^(client|fournisseur|tiers)( et objet)?$/i.test(titre) ? 'oui' : '');
        }
      }
    }
  }
  // ── Les chiffres des cartes ──
  // Le plus petit cran qui fait tenir le chiffre dans sa carte : rien, puis 1, puis 2 (au-delà, le dernier). C'est la
  // CARTE qui se mesure : le chiffre, case de sa grille, s'élargit avec lui et ne déborde jamais de lui-même. Chaque
  // essai se mesure avant l'affichage : on ne voit jamais le chiffre changer de taille.
  /** @param {Element} carte */
  function serrer(carte) {
    const val = carte.querySelector(':scope > .val');
    if (!val) return;
    for (const cran of ['', '1', '2']) {
      poser(val, 'data-tel-serre', cran);
      if (carte.scrollWidth <= carte.clientWidth + 1) return;
    }
  }

  let prevu = 0;
  function passer() {
    prevu = 0;
    if (!TELEPHONE.matches) return;
    for (const t of document.querySelectorAll('table.list')) enCartes(/** @type {HTMLTableElement} */ (t));
    for (const c of document.querySelectorAll('.stats:not(.rangee) > .stat')) serrer(c);
  }
  // Une liste se redessine souvent (un filtre, une page, une ligne réglée) : on repasse avant le prochain affichage,
  // une fois par image, et seulement au téléphone.
  function suivre() {
    new MutationObserver(() => { if (!prevu && TELEPHONE.matches) prevu = requestAnimationFrame(passer); }).observe(document.body, { childList: true, subtree: true });
    TELEPHONE.addEventListener('change', passer);
    passer();
  }

  function apercuEnGrand() {
    document.addEventListener('click', (e) => {
      const t = /** @type {Element | null} */ (e.target);
      if (!TELEPHONE.matches || !t || !t.closest('#pv-toggle')) return;
      const grand = /** @type {HTMLButtonElement | null} */ (document.getElementById('pv-big'));
      if (!grand) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      grand.click();
    }, true);
  }

  // ── Le nom des cases d'une ligne ──
  /** @param {HTMLTableElement} table */
  function nommerLignes(table) {
    const tete = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!tete) return;
    /** @type {string[]} */ const titres = [];
    for (const th of tete.cells) { titres.push(titreDe(th)); for (let k = 1; k < th.colSpan; k++) titres.push(''); }
    for (const corps of table.tBodies) {
      [...corps.rows].forEach((tr, n) => {
        let col = 0;
        for (const td of tr.cells) {
          const titre = td.colSpan === 1 ? titres[col] || '' : '';
          col += td.colSpan;
          for (const champ of td.querySelectorAll('input:not([type=hidden]), select, textarea')) {
            // Une case qui a déjà un nom (le sien, ou une étiquette) le garde ; seul ce que ce fichier a posé se refait.
            if (champ.hasAttribute('aria-label') && !champ.hasAttribute('data-nom-ligne')) continue;
            if (/** @type {HTMLInputElement} */ (champ).labels?.length) continue;
            const nom = titre ? `${titre}, ligne ${n + 1}` : '';
            poser(champ, 'aria-label', nom);
            poser(champ, 'data-nom-ligne', nom ? 'oui' : '');
          }
        }
      });
    }
  }
  /** @type {Record<string, string>} */
  const FILTRES = { f: 'Filtrer la liste', kind: 'Type de pièce', st: 'Statut', 'c-year': 'Année', 'c-month': 'Mois', 'p-year': 'Année', 's-year': 'Année' };
  function nommerFiltres() {
    for (const [id, nom] of Object.entries(FILTRES)) {
      const el = document.getElementById(id);
      if (el && el.tagName === 'SELECT' && !el.hasAttribute('aria-label') && !/** @type {HTMLSelectElement} */ (el).labels?.length) el.setAttribute('aria-label', nom);
    }
  }
  function lierVoisins() {
    for (const titre of document.querySelectorAll('.field > span.fl')) {
      const champ = titre.nextElementSibling;
      if (!champ || !champ.matches('select, textarea, input:not([type=hidden])')) continue;
      if (champ.hasAttribute('aria-label') && !champ.hasAttribute('data-nom-titre')) continue;
      if (/** @type {HTMLInputElement} */ (champ).labels?.length) continue;
      poser(champ, 'aria-label', titreDe(titre));
      poser(champ, 'data-nom-titre', 'oui');
    }
  }
  // ── Les bulles des titres de colonne d'une ligne ──
  // Les tableaux de lignes dont l'en-tête se cache au téléphone (telephone.css) : ceux d'une pièce, d'un achat, d'une
  // photo relue.
  /** @param {HTMLTableElement} t */
  const sansEnTete = (t) => t.classList.contains('lignes-doc') || (t.classList.contains('buy-lines') && !!t.querySelector(':scope > #b-lines, :scope > #orf-lines'));
  function bullesDesColonnes() {
    for (const t of document.querySelectorAll('table.lines-edit')) {
      const table = /** @type {HTMLTableElement} */ (t);
      const tete = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
      const bulles = tete && TELEPHONE.matches && sansEnTete(table) ? [...tete.querySelectorAll('th .i[data-info]')] : [];
      const avant = table.previousElementSibling;
      let aide = avant && avant.classList.contains('aide-colonnes') ? /** @type {HTMLElement} */ (avant) : null;
      if (!bulles.length) { if (aide) aide.remove(); continue; }
      const cles = bulles.map((x) => /** @type {HTMLElement} */ (x).dataset.info).join(' ');
      if (aide && aide.dataset.cles === cles) continue;
      if (!aide) { aide = document.createElement('p'); aide.className = 'aide-colonnes small muted'; table.before(aide); }
      aide.dataset.cles = cles;
      // Ce qu'explique la bulle : le titre qu'elle porte (« Explication : TVA déductible »), plus clair que l'en-tête
      // abrégé du bureau (« Déduct. »).
      aide.replaceChildren('Les colonnes :', ...bulles.map((x) => {
        const s = document.createElement('span');
        s.append(`${(x.getAttribute('aria-label') || '').replace(/^Explication : /, '') || titreDe(/** @type {Element} */ (x.closest('th')))} `, x.cloneNode(true));
        return s;
      }));
    }
  }
  let nomsPrevus = 0;
  function nommer() { nomsPrevus = 0; for (const t of document.querySelectorAll('table.lines-edit')) nommerLignes(/** @type {HTMLTableElement} */ (t)); nommerFiltres(); lierVoisins(); bullesDesColonnes(); }
  function suivreLesLignes() {
    new MutationObserver(() => { if (!nomsPrevus) nomsPrevus = requestAnimationFrame(nommer); }).observe(document.body, { childList: true, subtree: true });
    TELEPHONE.addEventListener('change', bullesDesColonnes);
    nommer();
  }

  function demarrer() { suivre(); apercuEnGrand(); suivreLesLignes(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
