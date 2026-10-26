// @ts-check
// La coquille de l'application, telle que la dessine la maquette « Barre v3 » (docs/maquettes/barre-v3.html, appliquée le
// 26/10/2026 ; docs/maquettes-appliquees.md). La liste de la barre (« Au quotidien », « Tout le reste ») est dessinée par
// `drawNav` (v10/app.js), qui dit aussi ce que « Créer » propose (`__creer`), le métier et le rôle (`__barreInfos`) ; ce
// fichier fait tout ce qui s'ouvre et bouge autour :
//
// 1. « Créer » (touche N ; le caissier : « Vente au comptoir », touche V) : les pièces du métier, que le rôle peut faire.
//    En lecture seule (l'abonnement), le bouton porte un cadenas et le menu dit comment rouvrir, avant tout geste. Le rôle
//    « Lecture » n'a pas de « Créer » : une puce le dit.
// 2. Les volets de « Tout le reste » : une famille ouvre le sien à côté de la barre, posé sur la page, sans rien pousser.
//    Une page s'y épingle dans « Au quotidien », et « Au quotidien » se range en glissant.
// 3. La tête : les initiales et le métier de l'entreprise, la cloche des nouvelles, la puce « Hors ligne ». Le pied :
//    « Mise à jour prête », l'abonnement, le changement de caissier, la personne et son menu, Paramètres, Me guider, Aide.
// 4. La barre repliée (68 px, touche [) ; les raccourcis (?) ; la visite de la barre, en trois étapes.
// 5. La tablette (761 à 1100 px) : un rail d'icônes avec leur nom ; « Plus » y ouvre la barre entière.
// 6. Le téléphone : le haut (l'entreprise, la cloche), les pastilles, les onglets du bas (l'accueil, deux pages du métier
//    ou choisies, « + », « Plus »), la feuille « Créer », la page « Plus » et « Mes onglets ».
// Rien ici ne décide d'un chiffre : chaque compte est recopié de la barre (son lien, son nombre, son ton).
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const IC = {
    accueil: '<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/>',
    caisse: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9V5h10v4M7 14h4M15 14h2"/>',
    plus: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    croix: '<path d="M12 5v14M5 12h14"/>',
    fermer: '<path d="M6 6l12 12M18 6 6 18"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    nuage: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10a4 4 0 0 1 0 8z"/><path d="m4 4 16 16"/>',
    rafraichir: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    cloche: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
    equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.3 3.2-5 6.5-5s5.9 1.7 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .5 3.2 2.2 3.5 5"/>',
    carte: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/>',
    clavier: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    sortir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
    boussole: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    reglages: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    aide: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.6M12 17.2h.01"/>',
    recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    comptable: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12.5h5"/>',
    bulle: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
    factures: '<path d="M6 3h9l4 4v14l-2.5-1.5L14 21l-2.5-1.5L9 21l-2.5-1.5L4 21V5a2 2 0 0 1 2-2z"/><path d="M8 9h7M8 13h7"/>',
    achats: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.5h11l2-8H6.3"/>',
    changer: '<path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12"/>',
    retour: '<path d="m15 6-6 6 6 6"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    onglets: '<rect x="3" y="15" width="18" height="6" rx="2"/><path d="M7 18h.01M12 18h.01M17 18h.01M5 4h14M5 9h14"/>',
  };
  /** @param {keyof typeof IC} n @param {number} [t] @param {number} [ep] */
  const ic = (n, t = 19, ep = 1.8) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${ep}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
  /** @param {string} id */
  const $ = (id) => document.getElementById(id);
  /** @param {string} cle @param {any} defaut */
  const lire = (cle, defaut) => { try { const v = localStorage.getItem(`skanfact.${cle}`); return v == null ? defaut : JSON.parse(v); } catch { return defaut; } };
  /** @param {string} cle @param {any} v */
  const ecrire = (cle, v) => { try { localStorage.setItem(`skanfact.${cle}`, JSON.stringify(v)); } catch { /* sans mémoire : rien ne se garde */ } };
  const telephone = () => w.matchMedia('(max-width: 760px)').matches;
  const tablette = () => w.matchMedia('(min-width: 761px) and (max-width: 1100px)').matches;
  /** @param {EventTarget | null} el */
  const dansUnChamp = (el) => !!(el && /** @type {Element} */ (el).closest && /** @type {Element} */ (el).closest('input, textarea, select, [contenteditable="true"]'));
  const fenetreOuverte = () => {
    const m = $('modal-root');
    const p = $('palette-root');
    return !!((m && m.children.length) || (p && !p.hidden) || $('setup') || document.querySelector('.visite-bulle:not(.sb-visite)'));
  };
  const enCaisse = () => document.body.classList.contains('mode-caisse');
  const infos = () => (typeof w.__barreInfos === 'function' ? w.__barreInfos() : { metier: '', role: 'proprietaire', responsable: true, lectureSeule: false, cabinet: null, version: '' });
  const role = () => infos().role;
  /** @param {string} hash */
  const aller = (hash) => { if (typeof w.__naviguer === 'function') w.__naviguer(hash); else location.hash = hash; };
  // La route ouverte, telle que la barre la marque (`a.active`), sinon lue dans l'adresse.
  const routeOuverte = () => {
    const a = /** @type {HTMLElement | null} */ (document.querySelector('#nav a.active, #barre .pied-bas a.active'));
    return a ? a.dataset.route || '' : (location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard');
  };
  const PETITS_MOTS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'sarl', 'suarl', 'sa', 'sas']);
  /** @param {string} nom */
  const initiales = (nom) => (String(nom || '').normalize('NFC').split(/[\s'’\-.]+/).filter((m) => m && !PETITS_MOTS.has(m.toLowerCase()))
    .slice(0, 2).map((m) => m[0]).join('') || 'SF').toUpperCase();

  // ── Ce que la barre compte : recopié de ses liens ──
  /** Le compte d'une page, tel que la barre le montre. @param {Element | null} lien */
  function compteDuLien(lien) {
    if (!lien) return null;
    const ok = lien.querySelector('.pt-ok:not([hidden])');
    if (ok) return { n: '', ton: 'ok', tip: /** @type {HTMLElement} */ (lien).dataset.tip || '' };
    const c = lien.querySelector('.nav-count:not([hidden])');
    if (!c || !(c.textContent || '').trim()) return null;
    const ton = c.classList.contains('alerte') ? 'alerte' : c.classList.contains('info') || c.classList.contains('calme') ? 'info' : 'attire';
    return { n: (c.textContent || '').trim(), ton, tip: /** @type {HTMLElement} */ (lien).dataset.tip || c.getAttribute('title') || '' };
  }
  /** @param {string} id */
  const lienDe = (id) => document.querySelector(`#nav a[data-route="${CSS.escape(id)}"]:not(.pl-l), #nav .volet a.pl-l[data-route="${CSS.escape(id)}"]`);

  // ── Les fenêtres posées sur la page : une seule ouverte à la fois ──
  /** @type {HTMLElement | null} */ let ouverte = null;
  /** @type {HTMLElement | null} */ let ouvreur = null;
  /** @param {boolean} [rendre] */
  function fermer(rendre) {
    if (ouverte) { ouverte.remove(); ouverte = null; }
    document.querySelectorAll('#barre [aria-expanded="true"], .sb [aria-expanded="true"]').forEach((b) => { if (b.id !== 'brand-btn') b.setAttribute('aria-expanded', 'false'); });
    const voile = document.querySelector('.sb-feuille-voile'); if (voile) voile.remove();
    voletOuvert = '';
    if (rendre && ouvreur && ouvreur.isConnected) ouvreur.focus({ preventScroll: true });
    ouvreur = null;
    poserOnglets();
  }
  /** @param {string} classe @param {string} html @param {HTMLElement | null} bouton @param {string} [nom] @param {string} [roleAria] */
  function ouvrir(classe, html, bouton, nom, roleAria) {
    fermer();
    const el = document.createElement('div');
    el.className = `sb ${classe}`;
    el.setAttribute('role', roleAria || 'menu');
    if (nom) el.setAttribute('aria-label', nom);
    el.innerHTML = html;
    document.body.appendChild(el);
    ouverte = el;
    ouvreur = bouton;
    if (bouton) bouton.setAttribute('aria-expanded', 'true');
    return el;
  }
  const premierFocus = () => {
    const x = /** @type {HTMLElement | null} */ (ouverte && ouverte.querySelector('button:not([disabled]), a[href]'));
    if (x) x.focus({ preventScroll: true });
  };

  // ── 1. « Créer » ──
  function poserCreer() {
    const b = $('b-creer');
    const zone = $('zone-creer');
    if (!b || !zone) return;
    const i = infos();
    let puce = $('b-role-puce');
    if (i.role === 'lecture') {
      if (!puce) {
        puce = document.createElement('div');
        puce.id = 'b-role-puce';
        puce.className = 'role-puce';
        puce.dataset.tip = 'Lecture : tu vois tout, tu ne changes rien';
        puce.innerHTML = `<span class="ic">${ic('oeil', 16, 2)}</span><span class="lib"><b>Lecture</b> · rien ne se change</span>`;
        zone.insertBefore(puce, b);
      }
      b.hidden = true;
      return;
    }
    if (puce) puce.remove();
    b.hidden = false;
    const caissier = i.role === 'caissier';
    const ferme = !!i.lectureSeule;
    b.classList.toggle('ferme', ferme);
    const voulu = `${ferme ? ic('cadenas', 16, 2) : ic(caissier ? 'caisse' : 'croix', caissier ? 17 : 17, caissier ? 1.9 : 2.4)}<span class="lib">${caissier ? 'Vente au comptoir' : 'Créer'}</span><kbd>${caissier ? 'V' : 'N'}</kbd>`;
    if (b.dataset.etat !== voulu) { b.innerHTML = voulu; b.dataset.etat = voulu; }
    b.dataset.tip = ferme ? 'Créer : fermé en lecture seule' : caissier ? 'Vente au comptoir · V' : 'Créer · N';
    b.setAttribute('aria-haspopup', caissier && !ferme ? 'false' : 'menu');
  }
  /** Ce que « Créer » propose, ou pourquoi il est fermé (le texte de `__creer`, et la porte qui rouvre). */
  function contenuCreer() {
    const c = typeof w.__creer === 'function' ? w.__creer() : { actions: [], bloque: null };
    const refus = c.bloque ? `<div class="sb-refus"><b>Créer est fermé pour l'instant</b><span>${esc(c.bloque.texte)} Tout se lit et s'exporte ; régler la facture rouvre la création dans la minute.</span>`
      + (c.bloque.bouton ? `<button type="button" class="sb-geste prem" data-creer-abo>${esc(c.bloque.bouton)}</button>` : '<span>Seule la personne qui règle l\'abonnement peut le rouvrir.</span>') + '</div>' : '';
    return { c, refus };
  }
  /** @param {HTMLElement} bouton */
  function ouvrirCreer(bouton) {
    const i = infos();
    if (i.role === 'lecture') return;
    if (i.role === 'caissier' && !i.lectureSeule) { fermer(); aller('#/caisse'); return; }
    if (ouverte && ouvreur === bouton && ouverte.classList.contains('sb-creer')) { fermer(true); return; }
    if (telephone()) { ouvrirFeuille(); return; }
    const { c, refus } = contenuCreer();
    const lignes = c.actions.map((/** @type {any} */ a, /** @type {number} */ k) => `<button type="button" role="menuitem" data-action="${k}" data-touche="${esc(a.touche)}">`
      + `<span class="tuile-ic">${a.icone}</span><span class="lib"><b>${esc(a.titre)}</b><span class="d">${esc(a.sous)}</span></span><kbd>${esc(a.touche)}</kbd></button>`).join('');
    const el = ouvrir('sb-pop sb-creer', `<span class="menu-titre">Créer</span>${refus || lignes || '<p class="note">Ton rôle ne te donne rien à créer ici.</p>'}`, bouton, 'Créer', c.bloque ? 'dialog' : 'menu');
    const r = bouton.getBoundingClientRect();
    if (tablette()) { el.style.left = `${Math.round(r.right + 12)}px`; el.style.top = `${Math.round(r.top)}px`; }
    else { el.style.left = `${Math.round(document.body.classList.contains('barre-repliee') ? r.right + 10 : r.left)}px`; el.style.top = `${Math.round(document.body.classList.contains('barre-repliee') ? r.top : r.bottom + 6)}px`; }
    el.addEventListener('click', (e) => {
      const t = /** @type {Element} */ (e.target);
      const abo = t.closest('[data-creer-abo]');
      if (abo) { fermer(); c.bloque.aller(); return; }
      const l = /** @type {HTMLElement | null} */ (t.closest('[data-action]'));
      if (l) { fermer(); c.actions[Number(l.dataset.action)].faire(); }
    });
    premierFocus();
  }

  // ── 2. Les volets de « Tout le reste » ──
  let voletOuvert = '';
  /** @param {string} famille */
  const boutonDeFamille = (famille) => /** @type {HTMLElement | null} */ ([...document.querySelectorAll('#nav .nav-volet')].find((b) => /** @type {HTMLElement} */ (b).dataset.famille === famille) || null);
  /** @param {HTMLElement} bouton @param {boolean} [garderLeCurseur] */
  function ouvrirVolet(bouton, garderLeCurseur) {
    const famille = bouton.dataset.famille || '';
    const source = bouton.closest('.nav-fam')?.querySelector('.volet');
    if (!source) return;
    // Le volet est recopié sur la page (la liste de la barre défile et s'efface aux bords : il y serait coupé) ; ses
    // compteurs gardent leur nombre, pas leur identifiant (l'original reste dans la barre, où la v10 les tient à jour).
    const el = ouvrir('sb-panneau', source.innerHTML, bouton, famille, 'dialog');
    el.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    el.querySelectorAll('[hidden]').forEach((x) => { if (!x.classList.contains('nav-count')) x.removeAttribute('hidden'); });
    voletOuvert = famille;
    const barre = $('barre');
    if (barre && !telephone()) el.style.left = `${Math.round(barre.getBoundingClientRect().right + 22)}px`;
    el.addEventListener('click', (e) => {
      const t = /** @type {Element} */ (e.target);
      const epingle = /** @type {HTMLElement | null} */ (t.closest('[data-epingle]'));
      if (epingle) {
        e.preventDefault();
        const id = epingle.dataset.epingle || '';
        if (typeof w.__epinglerPage === 'function') w.__epinglerPage(id);
        // La barre est redessinée et le volet rouvert sur la même famille (`apresDessin`) : le curseur revient au même bouton.
        const meme = /** @type {HTMLElement | null} */ (ouverte && ouverte.querySelector(`[data-epingle="${CSS.escape(id)}"]`));
        if (meme) meme.focus({ preventScroll: true });
        return;
      }
      const vers = /** @type {HTMLElement | null} */ (t.closest('[data-aller]'));
      if (vers) { e.preventDefault(); fermer(); aller(`#/${vers.dataset.aller}`); return; }
      if (t.closest('a[href]')) fermer();
    });
    if (!garderLeCurseur) premierFocus();
  }

  // ── 3. La tête et le pied ──
  function suivreLEntreprise() {
    const nom = $('brand-company');
    const pastille = document.querySelector('#barre .brand-mark');
    if (!nom || !pastille) return;
    const poser = () => {
      const texte = (nom.textContent || '').trim();
      const voulu = texte && texte !== '—' ? initiales(texte) : 'SF';
      if (pastille.textContent !== voulu) pastille.textContent = voulu;
      poserRail();
    };
    poser();
    new MutationObserver(poser).observe(nom, { childList: true, characterData: true, subtree: true });
  }
  /** @type {{ nom: string, email: string, role: string } | null} */ let personne = null;
  async function lirePersonne() {
    const b = $('b-moi');
    const pont = w.skanfact;
    if (!b || !pont || typeof pont.profil !== 'function') return;
    /** @type {any} */ let p;
    try { p = await pont.profil(); } catch { return; }
    if (!p || !p.nom) return;
    const roles = (w.SkanEquipe && w.SkanEquipe.ROLES) || {};
    const r = (p.roles || []).map((/** @type {string} */ x) => (roles[x] || [x])[0]).join(', ');
    personne = { nom: p.nom, email: p.email || '', role: r };
    /** @type {HTMLElement} */ (b.querySelector('.avatar')).textContent = initiales(p.nom);
    /** @type {HTMLElement} */ (b.querySelector('.moi-nom b')).textContent = p.nom;
    /** @type {HTMLElement} */ (b.querySelector('.moi-nom span')).textContent = r;
    b.dataset.tip = `${p.nom} · mon compte`;
    b.setAttribute('aria-label', `${p.nom}${r ? `, ${r}` : ''} : mon compte`);
    poserRail();
  }
  /** @param {HTMLElement} bouton */
  function ouvrirMoi(bouton) {
    if (ouverte && ouvreur === bouton) { fermer(true); return; }
    const i = infos();
    const p = personne || { nom: '', email: '', role: '' };
    const abo = w.skanfact && typeof w.skanfact.pastilleAbonnement === 'function' ? w.skanfact.pastilleAbonnement() : null;
    const html = `<span class="menu-titre">${esc([p.email, p.role].filter(Boolean).join(' · ') || 'Mon compte')}</span>`
      + (typeof w.__allerParametres === 'function' ? `<button type="button" role="menuitem" data-moi="compte"><span class="ic">${ic('profil', 18)}</span><span class="lib">Mon profil et ma sécurité</span></button>` : '')
      + (i.responsable ? `<button type="button" role="menuitem" data-moi="equipe"><span class="ic">${ic('equipe', 18)}</span><span class="lib">Mon équipe<small>Inviter, les rôles, le support</small></span></button>`
        + `<button type="button" role="menuitem" data-moi="abonnement"><span class="ic">${ic('carte', 18)}</span><span class="lib">Ton abonnement<small>${esc(abo && abo.show ? abo.texte : 'Rien à régler pour l\'instant')}</small></span></button>` : '')
      + `<button type="button" role="menuitem" data-moi="raccourcis"><span class="ic">${ic('clavier', 18)}</span><span class="lib">Raccourcis clavier</span><kbd>?</kbd></button>`
      + `<button type="button" role="menuitem" data-moi="visite"><span class="ic">${ic('boussole', 18)}</span><span class="lib">Découvrir la barre<small>Trois étapes, une minute</small></span></button>`
      + `<div class="trait"></div><button type="button" role="menuitem" class="danger" data-moi="sortir"><span class="ic">${ic('sortir', 18)}</span><span class="lib">Se déconnecter</span></button>`
      + `<span class="menu-titre" style="font-weight:500">SkanFact ${esc(version() ? `v${version()}` : '')} · ${majPrete ? 'mise à jour prête' : 'à jour'}</span>`;
    const el = ouvrir('sb-pop sb-moi', html, bouton, 'Mon compte');
    const r = bouton.getBoundingClientRect();
    if (tablette() && !document.body.classList.contains('tiroir-ouvert')) { el.style.left = `${Math.round(r.right + 12)}px`; el.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`; }
    else { el.style.left = `${document.body.classList.contains('barre-repliee') ? 78 : 10}px`; el.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`; }
    el.addEventListener('click', (e) => {
      const x = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-moi]'));
      if (!x) return;
      const quoi = x.dataset.moi;
      fermer();
      fermerTiroir();
      if (quoi === 'compte') w.__allerParametres('compte');
      else if (quoi === 'equipe') w.__allerParametres('equipe');
      else if (quoi === 'abonnement') w.__allerAbonnement();
      else if (quoi === 'raccourcis') ouvrirRaccourcis();
      else if (quoi === 'visite') lancerVisite(1);
      else if (quoi === 'sortir' && w.skanfact && w.skanfact.deconnecter) w.skanfact.deconnecter();
    });
    premierFocus();
  }
  const version = () => { const v = $('app-version'); return ((v && v.textContent) || infos().version || '').replace(/^v/, '').trim(); };

  // La puce « Hors ligne · N en attente » : l'état du poste (plateforme/poste.js).
  /** @type {{ hors: boolean, attente: number }} */ let poste = { hors: false, attente: 0 };
  function poserHors() {
    const el = $('b-hors');
    if (!el) return;
    el.hidden = !poste.hors;
    const n = poste.attente;
    el.dataset.tip = n ? `Hors ligne · ${n} ${n > 1 ? 'changements attendent' : 'changement attend'}` : 'Hors ligne · ce que tu fais se garde sur ce poste';
    el.innerHTML = `<span class="ic">${ic('nuage', 16)}</span><span class="lib"><b>Hors ligne</b>${n ? ` · ${n} en attente` : ' · gardé ici'}</span>`;
    poserPastilles();
  }

  // « Mise à jour prête » : la page servie a changé depuis qu'elle est ouverte (sa marque, serveur/ecrans.ts). Regardé de
  // temps en temps, et quand on revient sur l'onglet ; jamais sans réseau.
  let majPrete = false;
  let derniereVerif = Date.now();
  async function verifierMaj() {
    const ici = document.querySelector('meta[name="skanfact-code"]');
    if (!ici || majPrete || !navigator.onLine) return;
    derniereVerif = Date.now();
    try {
      const r = await fetch(location.pathname, { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const m = /<meta name="skanfact-code" content="([^"]*)">/.exec(await r.text());
      if (m && m[1] && m[1] !== ici.getAttribute('content')) { majPrete = true; poserMaj(); }
    } catch { /* sans réseau : on regardera plus tard */ }
  }
  function poserMaj() {
    const b = $('b-maj');
    if (b) { b.hidden = !majPrete; b.dataset.tip = 'Mise à jour prête · recharger'; }
    poserPastilles();
    poserCloche();
  }

  // « Changer de caissier » (brique 123), au pied de la barre du caissier, là où la caisse est ouverte.
  function poserCaissier() {
    const pied = document.querySelector('#barre .pied-bas');
    const liens = document.querySelector('#barre .pied-liens');
    if (!pied || !liens) return;
    let b = $('b-caissier');
    const voulu = role() === 'caissier' && typeof w.__caissePoste === 'function' && w.__caissePoste();
    if (!voulu) { if (b) b.remove(); return; }
    if (!b) {
      const nouveau = document.createElement('button');
      nouveau.type = 'button';
      b = nouveau;
      b.id = 'b-caissier';
      b.className = 'changer-caissier';
      b.dataset.tip = 'Changer de caissier · code à 4 chiffres';
      b.innerHTML = `${ic('changer', 16, 2)}<span class="lib">Changer de caissier</span>`;
      b.addEventListener('click', () => w.__changerCaissier());
      pied.insertBefore(b, liens);
    }
  }

  // ── La cloche : tout ce qui attend, au même endroit (les pastilles de la barre restent) ──
  /** @returns {{ cle: string, ic: keyof typeof IC, ton: string, html: string, sous: string, faire: () => void }[]} */
  function nouvelles() {
    /** @type {{ cle: string, ic: keyof typeof IC, ton: string, html: string, sous: string, faire: () => void }[]} */ const l = [];
    const cab = infos().cabinet || {};
    const q = Number(cab.questions) || 0; const d = Number(cab.demandes) || 0; const nl = Number(cab.nonLus) || 0;
    const fc = $('foot-comptable');
    if (fc && !fc.hidden) {
      if (q) l.push({ cle: `cab-q-${q}`, ic: 'bulle', ton: 'attire', html: `<b>Ton cabinet</b> ${q > 1 ? `a ${q} questions` : 'a une question'} pour toi`, sous: 'Mon comptable', faire: () => aller('#/comptable') });
      if (d) l.push({ cle: `cab-d-${d}`, ic: 'comptable', ton: 'attire', html: `<b>Ton cabinet</b> demande ${d > 1 ? `${d} pièces` : 'une pièce'}`, sous: 'Mon comptable', faire: () => aller('#/comptable') });
      if (nl) l.push({ cle: `cab-m-${nl}`, ic: 'comptable', ton: '', html: `${nl > 1 ? `${nl} messages` : 'Un message'} de <b>ton cabinet</b> à lire`, sous: 'Mon comptable', faire: () => aller('#/comptable') });
    }
    const sup = $('nav-support');
    if (sup && !sup.hidden && (sup.textContent || '').trim()) l.push({ cle: `support-${sup.textContent}`, ic: 'aide', ton: '', html: esc(sup.getAttribute('title') || 'Le support t\'a répondu'), sous: 'Aide · tes demandes', faire: () => aller('#/aide') });
    const abo = $('lic-banner');
    if (abo && !abo.hidden && !abo.classList.contains('calme')) {
      const t = (abo.querySelector('.abo-t')?.textContent || '').trim();
      l.push({ cle: `abo-${t}`, ic: 'carte', ton: abo.classList.contains('alerte') ? 'alerte' : 'attire', html: `<b>${esc(t)}</b>`, sous: (abo.querySelector('small')?.textContent || 'Ton abonnement').trim(), faire: () => abo.click() });
    }
    for (const [id, nom] of /** @type {[string, string][]} */ ([['factures', 'Factures'], ['achats', 'Achats']])) {
      const c = compteDuLien(lienDe(id));
      if (c && c.ton === 'alerte') { const phrase = c.tip.split(' · ').slice(1).join(' · '); l.push({ cle: `${id}-${phrase}`, ic: id === 'factures' ? 'factures' : 'achats', ton: 'alerte', html: `<b>${esc(nom)}</b> : ${esc(phrase)}`, sous: 'Ce qui est en retard', faire: () => aller(`#/${id}`) }); }
    }
    if (poste.hors && poste.attente) l.push({ cle: `hors-${poste.attente}`, ic: 'nuage', ton: 'attire', html: `<b>Hors ligne</b> : ${poste.attente} ${poste.attente > 1 ? 'changements attendent' : 'changement attend'} le réseau`, sous: 'Ils partiront seuls à son retour', faire: () => {} });
    if (majPrete) l.push({ cle: 'maj', ic: 'rafraichir', ton: '', html: 'Une nouvelle version de <b>SkanFact</b> est prête', sous: 'Recharger la page l\'installe', faire: () => location.reload() });
    return l;
  }
  const lues = () => /** @type {string[]} */ (lire('nouvellesLues', []) || []);
  /** @param {string[]} cles */
  const marquerLues = (cles) => ecrire('nouvellesLues', [...new Set([...cles, ...lues()])].slice(0, 80));
  function poserCloche() {
    const b = $('b-cloche');
    if (!b) return;
    const l = nouvelles(); const vues = lues();
    const n = l.filter((x) => !vues.includes(x.cle)).length;
    const pt = /** @type {HTMLElement | null} */ (b.querySelector('.pt'));
    if (pt) { pt.hidden = !n; pt.textContent = telephone() && n ? String(n) : ''; }
    const nom = n ? `Nouvelles, ${n} non lue${n > 1 ? 's' : ''}` : 'Nouvelles';
    b.setAttribute('aria-label', nom);
    b.dataset.tip = n ? `Nouvelles · ${n} non lue${n > 1 ? 's' : ''}` : 'Nouvelles';
    const r = document.querySelector('.sb-rail [data-rail="cloche"]');
    if (r) { r.setAttribute('aria-label', nom); const nb = r.querySelector('.nb'); if (nb) { /** @type {HTMLElement} */ (nb).hidden = !n; nb.textContent = String(n); } }
  }
  /** @param {HTMLElement} bouton */
  function ouvrirNouvelles(bouton) {
    if (ouverte && ouvreur === bouton) { fermer(true); return; }
    const l = nouvelles(); const vues = lues();
    const nonLues = l.filter((x) => !vues.includes(x.cle));
    const html = `<div class="pop-tete"><b>Nouvelles</b><button type="button" data-tout-lu${nonLues.length ? '' : ' disabled'}>Tout marquer comme lu</button></div>`
      + (l.length ? l.map((x, k) => `<button type="button" class="notif" data-notif="${k}"><span class="ic ${x.ton}">${ic(x.ic, 16, 2)}</span><span class="lib">${x.html}<small>${esc(x.sous)}</small></span>${vues.includes(x.cle) ? '' : '<span class="pt-nl" aria-label="non lu"></span>'}</button>`).join('')
        : '<p class="rien">Rien de neuf : rien n\'attend de toi pour l\'instant.</p>')
      + '<div class="trait"></div><span class="note">Les pastilles de la barre restent : ici, tout est au même endroit.</span>';
    const el = ouvrir('sb-pop sb-notifs', html, bouton, 'Nouvelles', 'dialog');
    const r = bouton.getBoundingClientRect();
    el.style.left = `${Math.round(tablette() ? r.right + 12 : document.body.classList.contains('barre-repliee') ? 78 : Math.max(10, r.right - 56))}px`;
    el.style.top = `${Math.round(tablette() ? Math.max(10, r.bottom - 300) : r.bottom + 8)}px`;
    el.addEventListener('click', (e) => {
      const t = /** @type {Element} */ (e.target);
      if (t.closest('[data-tout-lu]')) { marquerLues(l.map((x) => x.cle)); poserCloche(); ouvrirNouvelles(bouton); return; }
      const x = /** @type {HTMLElement | null} */ (t.closest('[data-notif]'));
      const n = x ? l[Number(x.dataset.notif)] : undefined;
      if (n) { marquerLues([n.cle]); poserCloche(); fermer(); fermerTiroir(); n.faire(); }
    });
    premierFocus();
  }

  // ── 4. La barre repliée, les raccourcis, la visite ──
  function replier(oui = !document.body.classList.contains('barre-repliee')) {
    document.body.classList.toggle('barre-repliee', oui);
    ecrire('barreRepliee', oui);
    const b = $('b-replier');
    if (b) { const t = oui ? 'Déplier la barre ( [ )' : 'Replier la barre ( [ )'; b.title = t; b.setAttribute('aria-label', t.replace(' ( [ )', '')); b.setAttribute('aria-expanded', String(!oui)); }
    fermer();
  }
  function ouvrirRaccourcis() {
    fermer();
    const voile = document.createElement('div');
    voile.className = 'sb sb-voile';
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    voile.innerHTML = `<div class="sb-raccourcis" role="dialog" aria-modal="true" aria-label="Raccourcis clavier" tabindex="-1"><h3>Raccourcis clavier</h3><dl>
      <dt><kbd>N</kbd></dt><dd>Créer (la liste de ton métier)</dd>
      <dt><kbd>${mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></dt><dd>Rechercher une page, un client, une pièce</dd>
      <dt><kbd>G</kbd><kbd>A</kbd></dt><dd>Aller à l'accueil</dd>
      <dt><kbd>G</kbd><kbd>F</kbd></dt><dd>Aller aux factures</dd>
      <dt><kbd>[</kbd></dt><dd>Replier ou déplier la barre</dd>
      <dt><kbd>Tab</kbd></dt><dd>Passer d'un élément au suivant, dans l'ordre de lecture</dd>
      <dt><kbd>Échap</kbd></dt><dd>Fermer ce qui est ouvert ; en caisse, revenir à la barre</dd>
      <dt><kbd>?</kbd></dt><dd>Afficher cette aide</dd></dl>
      <p>Les raccourcis ne s'activent jamais pendant que tu tapes dans un champ.</p></div>`;
    voile.addEventListener('click', (e) => { if (e.target === voile) fermer(true); });
    document.body.appendChild(voile);
    ouverte = voile;
    /** @type {HTMLElement} */ (voile.querySelector('.sb-raccourcis')).focus();
  }
  // La visite de la barre : les cartes de visite de la v10 (style.css), en trois étapes. Elle part de « Découvrir la
  // barre » (le menu de la personne) : au premier lancement, l'assistant et les visites de la v10 ont déjà la parole.
  let etape = 0;
  /** @param {number} n */
  function lancerVisite(n) {
    document.querySelectorAll('.sb-cible-visite').forEach((x) => x.classList.remove('sb-cible-visite'));
    const vieille = document.querySelector('.sb-visite'); if (vieille) vieille.remove();
    etape = n;
    if (!n || telephone() || tablette()) { etape = 0; return; }
    const i = infos();
    const reste = !!document.getElementById('nav-reste');
    const titreJour = i.role === 'caissier' ? 'Ma caisse' : 'Au quotidien';
    const cibles = { 1: 'zone-creer', 2: 'nav-1', 3: reste ? 'nav-reste' : 'nav-1' };
    const etapes = {
      1: ['Tout commence ici', i.role === 'lecture' ? 'Ton rôle est en <b>lecture</b> : tu vois tout, tu ne changes rien. La recherche, juste dessous, trouve n\'importe quelle page <kbd>Ctrl</kbd> <kbd>K</kbd>.'
        : `<b>${i.role === 'caissier' ? 'Vente au comptoir' : 'Créer'}</b> propose les pièces de ton métier <kbd>${i.role === 'caissier' ? 'V' : 'N'}</kbd>. Juste dessous, la recherche trouve une page, un client ou une pièce <kbd>Ctrl</kbd> <kbd>K</kbd>.`, titreJour],
      2: [titreJour, 'Les pages de chaque jour, choisies selon ton métier. Le chiffre dit combien attend : <b>ambre</b> à voir, <b>rouge</b> en retard.', reste ? 'Ton menu se range' : 'C\'est tout'],
      3: [reste ? 'Ton menu se range' : 'C\'est tout', reste ? '<b>Tout le reste</b> s\'ouvre à côté, sans rien pousser. Glisse les entrées du quotidien pour les ranger, ou épingle une page. <b>Découvrir la barre</b>, dans ton menu en bas, relance cette visite.'
        : 'Ta barre ne montre que ce qui est à toi. <b>Découvrir la barre</b>, dans ton menu en bas, relance cette visite.', ''],
    };
    const cible = $(cibles[/** @type {1|2|3} */ (n)]);
    if (!cible) { etape = 0; return; }
    cible.classList.add('sb-cible-visite');
    const r = cible.getBoundingClientRect();
    const [titre, texte, prochain] = etapes[/** @type {1|2|3} */ (n)];
    const jauge = [1, 2, 3].map((k) => `<i class="${k === n ? 'ici' : ''}"><b style="--p:${k <= n ? 100 : 0}%"></b></i>`).join('');
    const el = document.createElement('div');
    el.className = 'sb visite-bulle sb-visite';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Découvrir la barre');
    el.style.top = `${Math.max(8, Math.round(r.top - 14))}px`;
    el.style.left = `${Math.round(r.right + 20)}px`;
    el.innerHTML = `<span class="vb-pointe" aria-hidden="true"></span>
      <div class="vb-haut"><div class="vb-tete"><span class="vb-ico">${ic('boussole', 19, 1.9)}</span><span class="vb-ou"><span class="vb-sur">Découvrir la barre · ${n} sur 3</span><span class="vb-lieu">Ta barre</span></span>
        <button type="button" class="vb-fermer" data-visite="fin" title="Fermer la visite (Échap)" aria-label="Fermer la visite">${ic('fermer', 15, 2.1)}</button></div>
        <div class="vb-progres" aria-hidden="true">${jauge}</div></div>
      <div class="vb-corps"><h3>${esc(titre)}</h3><p class="vb-texte">${texte}</p>${prochain ? `<div class="vb-prochain">Ensuite : <b>${esc(prochain)}</b></div>` : ''}</div>
      <div class="vb-pied">${n > 1 ? `<button type="button" class="vb-prec" data-visite="avant">${ic('retour', 16, 2.2)}Précédent</button>` : '<span class="vb-vide"></span>'}<span class="vb-compte">${n} / 3</span><button type="button" class="vb-suiv" data-visite="${n < 3 ? 'suite' : 'fin'}">${n < 3 ? 'Suivant' : 'Terminer'}${ic('chevron', 16, 2.2)}</button></div>`;
    el.addEventListener('click', (e) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-visite]'));
      if (!b) return;
      const v = b.dataset.visite;
      lancerVisite(v === 'fin' ? 0 : v === 'avant' ? Math.max(1, etape - 1) : etape + 1 > 3 ? 0 : etape + 1);
    });
    document.body.appendChild(el);
    /** @type {HTMLElement} */ (el.querySelector('.vb-suiv')).focus({ preventScroll: true });
  }

  // ── 5. La tablette : le rail ──
  /** @type {HTMLElement | null} */ let rail = null;
  function ouvrirTiroir() {
    document.body.classList.add('tiroir-ouvert');
    if (!document.querySelector('.sb-tiroir-voile')) {
      const v = document.createElement('div');
      v.className = 'sb sb-tiroir-voile';
      v.addEventListener('click', fermerTiroir);
      document.body.appendChild(v);
    }
    const b = /** @type {HTMLElement | null} */ (document.querySelector('#barre .lien.active, #barre .lien'));
    if (b) b.focus({ preventScroll: true });
  }
  function fermerTiroir() {
    if (!document.body.classList.contains('tiroir-ouvert')) return;
    document.body.classList.remove('tiroir-ouvert');
    const v = document.querySelector('.sb-tiroir-voile'); if (v) v.remove();
  }
  /** Les pages du jour, telles que la barre les montre (sans l'accueil). */
  const pagesDuJour = () => /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll('#nav .nav-quotidien > a.lien[data-route]:not([hidden])')])
    .filter((a) => a.dataset.route !== 'dashboard');
  /** @param {HTMLAnchorElement} a */
  const nomDuLien = (a) => [...a.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim();
  /** @param {{ n: string, ton: string } | null} c */
  const nb = (c) => (!c ? '' : c.ton === 'ok' ? '<span class="nb ok" aria-hidden="true"></span>' : `<span class="nb ${c.ton === 'alerte' ? 'alerte' : ''}">${esc(c.n)}</span>`);
  function poserRail() {
    if (!rail) return;
    const i = infos();
    const route = routeOuverte();
    const nomE = ($('brand-company')?.textContent || '').trim();
    const avatar = $('b-moi')?.querySelector('.avatar')?.textContent || '';
    const ferme = !!i.lectureSeule;
    const jour = pagesDuJour().slice(0, 5);
    const html = `<button type="button" class="marque-s" data-rail="marque" title="${esc(nomE)}" aria-label="${esc(`${nomE} : changer d'entreprise`)}">${esc(initiales(nomE))}</button>`
      + (i.role === 'lecture' ? '' : `<button type="button" class="fab${ferme ? ' ferme' : ''}" data-rail="creer" aria-haspopup="menu" aria-label="${ferme ? 'Créer : fermé en lecture seule' : i.role === 'caissier' ? 'Vente au comptoir' : 'Créer'}">${ferme ? ic('cadenas', 20, 2) : ic(i.role === 'caissier' ? 'caisse' : 'croix', 22, 2.4)}</button>`)
      + (i.role === 'caissier' ? '' : `<a class="rail-l" href="#/dashboard"${route === 'dashboard' ? ' aria-current="page"' : ''}><span class="ic-boite">${ic('accueil', 21)}</span>Accueil</a>`)
      + jour.map((a) => { const n = nomDuLien(a); const svg = a.querySelector('.ic')?.innerHTML || ''; return `<a class="rail-l" href="${esc(a.getAttribute('href'))}"${a.dataset.route === route ? ' aria-current="page"' : ''} title="${esc(a.dataset.tip || n)}"><span class="ic-boite">${svg}${nb(compteDuLien(a))}</span>${esc(n.length > 11 ? `${n.slice(0, 10)}…` : n)}</a>`; }).join('')
      + `<button type="button" class="rail-l" data-rail="plus" aria-label="Plus : toute la barre"><span class="ic-boite">${ic('plus', 21)}</span>Plus</button>`
      + `<div class="bas"><button type="button" class="rail-l" data-rail="cloche" style="width:auto" aria-label="Nouvelles"><span class="ic-boite">${ic('cloche', 21)}<span class="nb alerte" hidden></span></span></button><button type="button" class="avatar" data-rail="moi" aria-label="Mon compte">${esc(avatar)}</button></div>`;
    if (rail.dataset.html !== html) { rail.innerHTML = html; rail.dataset.html = html; }
    poserCloche();
  }

  // ── 6. Le téléphone ──
  /** @type {HTMLElement | null} */ let onglets = null;
  let ecranTel = '';   // '' (la page), 'plus', 'onglets'
  /** @param {string} id */
  const dessinDe = (id) => (typeof w.__pageBarre === 'function' ? w.__pageBarre(id) : { id, titre: id, icone: '' });
  function poserOnglets() {
    if (!onglets) return;
    const i = infos();
    const route = routeOuverte();
    const ids = typeof w.__ongletsTel === 'function' ? w.__ongletsTel() : [];
    const creerOuvert = !!document.querySelector('.sb-feuille');
    /** @param {string} id */
    const onglet = (id) => { const p = dessinDe(id); const c = compteDuLien(lienDe(id)); return `<a class="sb-onglet" href="#/${esc(id)}"${!ecranTel && route === id ? ' aria-current="page"' : ''}${c && c.n ? ` aria-label="${esc(`${p.titre} (${c.n})`)}"` : ''}><span class="ic-boite">${p.icone}${nb(c).replace('class="nb alerte"', 'class="nb"')}</span><span class="nom">${esc(p.titre)}</span></a>`; };
    const ferme = !!i.lectureSeule;
    const centre = i.role === 'lecture'
      ? `<button type="button" class="sb-plus-central ferme" aria-label="Lecture : rien à créer" title="Lecture : tu vois tout, tu ne changes rien">${ic('oeil', 22, 2)}</button>`
      : `<button type="button" class="sb-plus-central${ferme ? ' ferme' : ''}" data-tel="creer" aria-haspopup="dialog" aria-expanded="${creerOuvert}" aria-label="${ferme ? 'Créer : fermé en lecture seule' : i.role === 'caissier' ? 'Vente au comptoir' : 'Créer'}">${ferme && !creerOuvert ? ic('cadenas', 22, 2) : ic(i.role === 'caissier' ? 'caisse' : 'croix', i.role === 'caissier' ? 23 : 26, 2.4)}</button>`;
    const html = (i.role === 'caissier' ? onglet('caisse') : `<a class="sb-onglet" href="#/dashboard"${!ecranTel && route === 'dashboard' ? ' aria-current="page"' : ''}><span class="ic-boite">${ic('accueil', 23)}</span><span class="nom">Accueil</span></a>`)
      + (ids[0] && !(i.role === 'caissier' && ids[0] === 'caisse') ? onglet(ids[0]) : '<span></span>')
      + centre
      + (ids[1] ? onglet(ids[1]) : '<span></span>')
      + `<button type="button" class="sb-onglet" data-tel="plus"${ecranTel ? ' aria-current="page"' : ''} aria-expanded="${!!ecranTel}"><span class="ic-boite">${ic('plus', 23)}</span><span class="nom">Plus</span></button>`;
    if (onglets.dataset.html !== html) { onglets.innerHTML = html; onglets.dataset.html = html; }
  }
  // Les pastilles sous le haut : hors ligne, l'abonnement, la mise à jour (ce que le pied de la barre dit au bureau).
  function poserPastilles() {
    const zone = document.querySelector('#barre .sb-pastilles');
    if (!zone) return;
    const abo = $('lic-banner');
    const t = abo && !abo.hidden ? (abo.querySelector('.abo-t')?.textContent || '').trim() : '';
    const ton = abo ? (abo.classList.contains('alerte') ? 'alerte' : abo.classList.contains('attire') ? 'attire' : '') : '';
    /** @type {keyof typeof IC} */ const icAbo = /Lecture seule/.test(t) ? 'cadenas' : /^(Échéance|S'arrête)/.test(t) ? 'carte' : 'horloge';
    const html = (poste.hors ? `<span class="sb-puce hors-tel">${ic('nuage', 14, 2)}Hors ligne${poste.attente ? ` · ${poste.attente}` : ''}</span>` : '')
      + (t ? `<button type="button" class="sb-puce-l" data-puce="abo"><span class="sb-puce ${ton}">${ic(icAbo, 14, 2)}${esc(t)}</span></button>` : '')
      + (majPrete ? `<button type="button" class="sb-puce-l" data-puce="maj"><span class="sb-puce maj-tel">${ic('rafraichir', 14, 2)}Mise à jour</span></button>` : '');
    if (zone.innerHTML !== html) { zone.innerHTML = html; hautTel(); }
  }
  const hautTel = () => { const b = $('barre'); if (b) document.documentElement.style.setProperty('--sb-haut-tel', `${Math.round(b.getBoundingClientRect().bottom)}px`); };
  // La feuille « Créer », qui monte du bas : « Photo d'une pièce » d'abord, puis les pièces du métier.
  function ouvrirFeuille() {
    const bouton = /** @type {HTMLElement | null} */ (document.querySelector('.sb-onglets [data-tel="creer"]'));
    if (document.querySelector('.sb-feuille')) { fermer(true); return; }
    fermerPlus();
    const { c, refus } = contenuCreer();
    const actions = c.actions.slice();
    const photo = actions.findIndex((/** @type {any} */ a) => /^Photo/.test(a.titre));
    if (photo > 0) actions.unshift(actions.splice(photo, 1)[0]);
    const tuiles = actions.map((/** @type {any} */ a) => `<button type="button" data-action="${c.actions.indexOf(a)}"><span class="tuile-ic">${a.icone}</span><b>${esc(/^Photo/.test(a.titre) ? 'Photo d\'une pièce' : a.titre)}</b></button>`).join('');
    const el = ouvrir('sb-feuille', `<span class="poignee" aria-hidden="true"></span><h4>Créer</h4>${refus || `<div class="grille-creer">${tuiles}</div>`}`, bouton, 'Créer', 'dialog');
    const voile = document.createElement('div');
    voile.className = 'sb sb-feuille-voile';
    voile.addEventListener('click', () => fermer(true));
    document.body.insertBefore(voile, el);
    el.addEventListener('click', (e) => {
      const t = /** @type {Element} */ (e.target);
      if (t.closest('[data-creer-abo]')) { fermer(); c.bloque.aller(); return; }
      const l = /** @type {HTMLElement | null} */ (t.closest('[data-action]'));
      if (l) { fermer(); c.actions[Number(l.dataset.action)].faire(); }
    });
    poserOnglets();
    premierFocus();
  }
  // Les pages vues récemment (gardées sur l'appareil), pour « Plus ».
  function noterRecent() {
    const id = routeOuverte();
    if (!id || ['dashboard', 'parametres', 'aide', 'guide'].includes(id)) return;
    const l = /** @type {string[]} */ (lire('recents', []) || []).filter((x) => x !== id);
    l.unshift(id);
    ecrire('recents', l.slice(0, 6));
  }
  function fermerPlus() {
    const p = document.querySelector('.sb-plus');
    if (p) p.remove();
    ecranTel = '';
    poserOnglets();
  }
  /** @param {string} quoi */
  function ouvrirPlus(quoi = 'plus') {
    fermer();
    let p = /** @type {HTMLElement | null} */ (document.querySelector('.sb-plus'));
    if (!p) { p = document.createElement('div'); p.className = 'sb sb-plus'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Plus'); document.body.appendChild(p); p.addEventListener('click', clicPlus); }
    ecranTel = quoi;
    hautTel();
    p.innerHTML = quoi === 'onglets' ? pageOnglets() : pagePlus();
    p.scrollTop = 0;
    poserOnglets();
  }
  /** @param {string} d @param {{ n: string, ton: string } | null} c */
  const ligne = (d, c) => d + (c && c.n ? `<span class="d ${c.ton === 'alerte' ? 'alerte' : c.ton === 'info' ? '' : 'attire'}">${esc(c.n)}</span>` : '') + `<span class="chev">${ic('chevron', 15, 2.2)}</span>`;
  function pagePlus() {
    const i = infos();
    const recents = (/** @type {string[]} */ (lire('recents', []) || [])).filter((id) => lienDe(id)).slice(0, 4);
    const familles = [...document.querySelectorAll('#nav .nav-fam')].map((f) => {
      const nom = /** @type {HTMLElement} */ (f).dataset.famille || '';
      const lignes = [...f.querySelectorAll('.volet .ligne')].map((l) => {
        const a = /** @type {HTMLElement | null} */ (l.querySelector('.pl-l'));
        if (!a) return '';
        const id = a.dataset.route || a.dataset.aller || '';
        const titre = a.querySelector('b')?.textContent || id;
        const svg = a.querySelector('.tuile-ic')?.innerHTML || '';
        return `<a href="#/${esc(id)}">${ligne(`<span class="ic">${svg}</span><span class="lib">${esc(titre)}</span>`, compteDuLien(lienDe(id)))}</a>`;
      }).join('');
      return lignes ? `<div class="plus-section"><span class="plus-titre">${esc(nom)}</span><div class="liste-tel">${lignes}</div></div>` : '';
    }).join('');
    const fc = /** @type {HTMLAnchorElement | null} */ (document.querySelector('#nav #foot-comptable:not([hidden])'));
    const inviter = $('b-inviter-comptable');
    const abo = w.skanfact && typeof w.skanfact.pastilleAbonnement === 'function' ? w.skanfact.pastilleAbonnement() : null;
    const p = personne || { nom: '', role: '' };
    const sup = $('nav-support');
    return `<h4>Plus</h4><button type="button" class="champ-cherche" data-plus="chercher">${ic('recherche', 18)}Rechercher une page, un client…</button>`
      + (recents.length ? `<div class="plus-section"><span class="plus-titre">Récents</span><div class="recents">${recents.map((id) => { const d = dessinDe(id); return `<a href="#/${esc(id)}">${d.icone}${esc(d.titre)}</a>`; }).join('')}</div></div>` : '')
      + familles
      + `<div class="plus-section"><span class="plus-titre">Mon compte</span><div class="liste-tel">`
      + (fc ? `<a href="#/comptable">${ligne(`<span class="ic">${ic('comptable', 19)}</span><span class="lib">Mon comptable</span>`, compteDuLien(fc))}</a>` : '')
      + (inviter ? `<button type="button" data-plus="inviter">${ligne(`<span class="ic">${ic('equipe', 19)}</span><span class="lib">Inviter mon comptable</span>`, null)}</button>` : '')
      + (i.responsable ? `<button type="button" data-plus="abonnement">${ligne(`<span class="ic">${ic('carte', 19)}</span><span class="lib">Ton abonnement</span><span class="d">${esc(abo && abo.show ? abo.texte : 'À jour')}</span>`, null)}</button>`
        + `<button type="button" data-plus="equipe">${ligne(`<span class="ic">${ic('equipe', 19)}</span><span class="lib">Mon équipe</span>`, null)}</button>` : '')
      + (role() === 'caissier' && typeof w.__caissePoste === 'function' && w.__caissePoste() ? `<button type="button" data-plus="caissier">${ligne(`<span class="ic">${ic('changer', 19)}</span><span class="lib">Changer de caissier</span><span class="d">code à 4 chiffres</span>`, null)}</button>` : '')
      + `<button type="button" data-plus="onglets">${ligne(`<span class="ic">${ic('onglets', 19)}</span><span class="lib">Mes onglets</span>`, null)}</button>`
      + `<button type="button" data-plus="compte">${ligne(`<span class="ic">${ic('profil', 19)}</span><span class="lib">${esc(p.nom || 'Mon profil')}</span><span class="d">${esc(p.role)}</span>`, null)}</button>`
      + `<button type="button" class="danger" data-plus="sortir"><span class="ic">${ic('sortir', 19)}</span><span class="lib">Se déconnecter</span></button></div></div>`
      + `<div class="plus-pied">${i.responsable ? `<a href="#/parametres">${ic('reglages', 18)}Paramètres</a>` : ''}<a href="#/guide">${ic('boussole', 18)}Me guider</a><a href="#/aide">${ic('aide', 18)}Aide${sup && !sup.hidden ? '<span class="pt" aria-label="une réponse du support"></span>' : ''}</a></div>`
      + `<p class="version">SkanFact ${esc(version() ? `v${version()}` : '')}</p>`;
  }
  function pageOnglets() {
    const ids = typeof w.__ongletsTel === 'function' ? w.__ongletsTel() : [];
    const cands = typeof w.__candidatsOnglets === 'function' ? w.__candidatsOnglets() : [];
    const t = ids.map((/** @type {string} */ id) => dessinDe(id));
    return `<h4>Mes onglets</h4><p class="sous">Choisis les deux onglets à côté du « + ». Accueil, « + » et Plus restent à leur place.</p>
      <div class="cases-onglets"><span class="fixe">${ic('accueil', 18)}Accueil</span><span class="choisi">${t[0] ? `${t[0].icone}${esc(t[0].titre)}` : '—'}</span><span class="fixe">${ic('croix', 18)}Créer</span><span class="choisi">${t[1] ? `${t[1].icone}${esc(t[1].titre)}` : '—'}</span><span class="fixe">${ic('plus', 18)}Plus</span></div>
      <div class="liste-choix">${cands.map((/** @type {any} */ c) => `<button type="button" data-onglet="${esc(c.id)}" aria-pressed="${ids.includes(c.id)}">${c.icone}${esc(c.titre)}${ids.includes(c.id) ? `<small>${ids.indexOf(c.id) + 1}</small>` : ''}</button>`).join('')}</div>
      <p class="note-verif">${ic('aide', 14, 2)} Touche un onglet pour le mettre à la place du plus ancien. Il se garde sur ce téléphone.</p>`;
  }
  /** @param {MouseEvent} e */
  function clicPlus(e) {
    const t = /** @type {Element} */ (e.target);
    const o = /** @type {HTMLElement | null} */ (t.closest('[data-onglet]'));
    if (o) { if (typeof w.__choisirOngletTel === 'function') w.__choisirOngletTel(o.dataset.onglet); ouvrirPlus('onglets'); return; }
    const x = /** @type {HTMLElement | null} */ (t.closest('[data-plus]'));
    if (!x) { if (t.closest('a[href]')) fermerPlus(); return; }
    const quoi = x.dataset.plus;
    if (quoi === 'onglets') { ouvrirPlus('onglets'); return; }
    fermerPlus();
    if (quoi === 'chercher') $('nav-search')?.click();
    else if (quoi === 'inviter') w.__inviterComptable();
    else if (quoi === 'abonnement') w.__allerAbonnement();
    else if (quoi === 'equipe') w.__allerParametres('equipe');
    else if (quoi === 'compte') w.__allerParametres('compte');
    else if (quoi === 'caissier') w.__changerCaissier();
    else if (quoi === 'sortir' && w.skanfact && w.skanfact.deconnecter) w.skanfact.deconnecter();
  }

  // ── Après chaque dessin de la barre, et chaque compte ──
  /** Le point de la barre repliée suit le compte de son entrée. */
  function poserPoints() {
    document.querySelectorAll('#nav .lien').forEach((l) => {
      const pt = l.querySelector(':scope > .point');
      if (!pt) return;
      const c = l.classList.contains('nav-volet') ? (() => { const g = l.querySelector('.ng-count:not([hidden])'); return g ? { ton: g.classList.contains('info') ? 'info' : 'attire' } : null; })() : compteDuLien(l);
      const voulu = `point${c && c.ton !== 'info' ? ` allume${c.ton === 'alerte' ? ' alerte' : c.ton === 'ok' ? ' ok' : ''}` : ''}`;
      if (pt.className !== voulu) pt.className = voulu;
    });
  }
  function apresDessin() {
    const i = infos();
    const metier = $('brand-metier');
    if (metier && metier.textContent !== i.metier) metier.textContent = i.metier;
    poserCreer();
    poserCaissier();
    // « Au quotidien » se range en glissant.
    /** @type {string} */ let tire = '';
    const liens = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#nav .nav-quotidien [data-nom]')]);
    liens.forEach((a) => {
      a.addEventListener('dragstart', (e) => { tire = a.dataset.nom || ''; a.classList.add('glisse'); if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tire); } });
      a.addEventListener('dragend', () => a.classList.remove('glisse'));
      a.addEventListener('dragover', (e) => { if (!tire) return; e.preventDefault(); a.classList.add('cible'); });
      a.addEventListener('dragleave', () => a.classList.remove('cible'));
      a.addEventListener('drop', (e) => {
        e.preventDefault();
        a.classList.remove('cible');
        if (!tire || tire === a.dataset.nom) return;
        const noms = liens.map((x) => x.dataset.nom || '').filter((n) => n !== tire);
        noms.splice(noms.indexOf(a.dataset.nom || ''), 0, tire);
        tire = '';
        if (typeof w.__rangerQuotidien === 'function') w.__rangerQuotidien(noms);
      });
    });
    // Un volet ouvert se rouvre sur la barre redessinée (une épingle, un compte) : sa copie montrerait l'ancienne.
    if (voletOuvert && ouverte && ouverte.classList.contains('sb-panneau')) { const b = boutonDeFamille(voletOuvert); if (b) ouvrirVolet(b, true); else fermer(); }
    apresCompte();
  }
  let prevu = 0;
  function apresCompte() {
    if (prevu) return;
    prevu = requestAnimationFrame(() => {
      prevu = 0;
      poserPoints();
      poserCloche();
      poserPastilles();
      poserRail();
      poserOnglets();
      document.querySelectorAll('#nav a.lien, #barre .pied-bas a').forEach((a) => { if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    });
  }
  w.SkanBarre = { apresDessin, apresCompte, lancerVisite };

  // ── Les gestes communs ──
  document.addEventListener('click', (e) => {
    const t = /** @type {Element} */ (e.target);
    if (!t.closest) return;
    const volet = /** @type {HTMLElement | null} */ (t.closest('#nav .nav-volet'));
    if (volet) { e.preventDefault(); e.stopPropagation(); if (volet.getAttribute('aria-expanded') === 'true') fermer(true); else ouvrirVolet(volet); return; }
    const r = /** @type {HTMLElement | null} */ (t.closest('.sb-rail [data-rail]'));
    if (r) {
      const q = r.dataset.rail;
      if (q === 'plus' || q === 'marque') { fermer(); ouvrirTiroir(); if (q === 'marque') $('brand-btn')?.click(); }
      else if (q === 'creer') ouvrirCreer(r);
      else if (q === 'cloche') ouvrirNouvelles(r);
      else if (q === 'moi') ouvrirMoi(r);
      return;
    }
    const tel = /** @type {HTMLElement | null} */ (t.closest('.sb-onglets [data-tel]'));
    if (tel) { if (tel.dataset.tel === 'creer') ouvrirCreer(tel); else if (ecranTel) fermerPlus(); else ouvrirPlus(); return; }
    if (t.closest('.sb-onglets a')) { fermer(); fermerPlus(); return; }
    const puce = /** @type {HTMLElement | null} */ (t.closest('#barre [data-puce]'));
    if (puce) { if (puce.dataset.puce === 'maj') location.reload(); else $('lic-banner')?.click(); return; }
    if (ouverte && !t.closest('.sb') && !(ouvreur && ouvreur.contains(t))) fermer();
    if (t.closest('#barre a[href], #barre [data-route]') && !t.closest('.nav-volet')) fermerTiroir();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (etape) { e.stopPropagation(); lancerVisite(0); return; }
      if (ouverte) { e.stopPropagation(); fermer(true); return; }
      if (ecranTel) { e.stopPropagation(); fermerPlus(); return; }
      if (document.body.classList.contains('tiroir-ouvert')) { e.stopPropagation(); fermerTiroir(); return; }
      return;
    }
    if (ouverte && !ouverte.classList.contains('sb-voile')) {
      const xs = /** @type {HTMLElement[]} */ ([...ouverte.querySelectorAll('button:not([disabled]), a[href]')]);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && xs.length) {
        e.preventDefault();
        const k = xs.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? xs.length - 1 : (k + (e.key === 'ArrowDown' ? 1 : -1) + xs.length) % xs.length;
        const x = xs[j];
        if (x) x.focus();
        return;
      }
      // Dans « Créer », la lettre d'une ligne la choisit (F : une facture).
      if (ouverte.classList.contains('sb-creer') && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const l = /** @type {HTMLElement | null} */ (ouverte.querySelector(`[data-touche="${CSS.escape(e.key.toUpperCase())}"]`));
        if (l) { e.preventDefault(); e.stopPropagation(); l.click(); }
      }
      return;
    }
    // Les raccourcis de la barre : jamais dans un champ, ni par-dessus une fenêtre, ni à la caisse (la douchette tape
    // des lettres), ni avec une touche de commande.
    if (e.ctrlKey || e.metaKey || e.altKey || dansUnChamp(e.target) || fenetreOuverte() || enCaisse() || !$('barre')) { suite = ''; return; }
    const k = e.key;
    if (suite === 'g') {
      suite = '';
      if (k === 'a' || k === 'A') { e.preventDefault(); aller('#/dashboard'); return; }
      if (k === 'f' || k === 'F') { e.preventDefault(); aller('#/factures'); return; }
    }
    if (k === 'g' || k === 'G') { suite = 'g'; setTimeout(() => { suite = ''; }, 1200); return; }
    if (k === '?') { e.preventDefault(); ouvrirRaccourcis(); return; }
    if (k === '[' && !telephone() && !tablette()) { e.preventDefault(); replier(); return; }
    const b = $('b-creer');
    const caissier = role() === 'caissier';
    if (b && !b.hidden && ((!caissier && (k === 'n' || k === 'N')) || (caissier && (k === 'v' || k === 'V')))) { e.preventDefault(); e.stopPropagation(); ouvrirCreer(b); }
  }, true);
  let suite = '';
  window.addEventListener('hashchange', () => { fermer(); fermerPlus(); fermerTiroir(); lancerVisite(0); requestAnimationFrame(() => { noterRecent(); apresCompte(); }); });
  window.addEventListener('resize', () => { fermer(); if (!telephone()) fermerPlus(); if (!tablette()) fermerTiroir(); lancerVisite(0); hautTel(); poserCloche(); });
  // La bulle de la barre repliée : le nom de l'entrée (et ce qui y attend), au survol et au clavier.
  /** @type {HTMLElement | null} */ let bulle = null;
  /** @param {Event} e */
  function montrerBulle(e) {
    const t = /** @type {Element} */ (e.target);
    const x = /** @type {HTMLElement | null} */ (t.closest && t.closest('#barre [data-tip]'));
    if (!x || !document.body.classList.contains('barre-repliee') || telephone() || tablette()) { cacherBulle(); return; }
    if (!bulle) { bulle = document.createElement('div'); bulle.className = 'sb sb-bulle'; bulle.setAttribute('aria-hidden', 'true'); document.body.appendChild(bulle); }
    const r = x.getBoundingClientRect();
    bulle.textContent = x.dataset.tip || '';
    bulle.style.left = `${Math.round(r.right + 12)}px`;
    bulle.style.top = `${Math.round(r.top + r.height / 2)}px`;
    bulle.hidden = false;
  }
  const cacherBulle = () => { if (bulle) bulle.hidden = true; };
  document.addEventListener('mouseover', montrerBulle);
  document.addEventListener('focusin', montrerBulle);
  document.addEventListener('scroll', cacherBulle, true);
  window.addEventListener('skanposte', (e) => { poste = /** @type {CustomEvent} */ (e).detail || poste; poserHors(); poserCloche(); });

  function demarrer() {
    const barre = $('barre');
    if (!barre) return;
    document.body.classList.add('avec-barre');
    if (lire('barreRepliee', false)) replier(true);
    else replier(false);
    // La place des pastilles du téléphone, sous le haut de la barre.
    const pastilles = document.createElement('div');
    pastilles.className = 'sb-pastilles';
    barre.querySelector('.tete-barre')?.after(pastilles);
    // Le rail de la tablette, avant la barre ; les onglets du téléphone, au bout de la page.
    rail = document.createElement('nav');
    rail.className = 'sb sb-rail';
    rail.setAttribute('aria-label', 'Navigation');
    barre.before(rail);
    onglets = document.createElement('nav');
    onglets.className = 'sb sb-onglets';
    onglets.setAttribute('aria-label', 'Onglets');
    document.body.appendChild(onglets);
    $('b-replier')?.addEventListener('click', () => replier());
    $('b-creer')?.addEventListener('click', (e) => { e.stopPropagation(); ouvrirCreer(/** @type {HTMLElement} */ (e.currentTarget)); });
    $('b-cloche')?.addEventListener('click', (e) => { e.stopPropagation(); ouvrirNouvelles(/** @type {HTMLElement} */ (e.currentTarget)); });
    $('b-moi')?.addEventListener('click', (e) => { e.stopPropagation(); ouvrirMoi(/** @type {HTMLElement} */ (e.currentTarget)); });
    $('b-maj')?.addEventListener('click', () => location.reload());
    const regler = () => document.querySelector('#nav .regler');
    document.addEventListener('click', (e) => { if (regler() && /** @type {Element} */ (e.target).closest('#nav .regler')) { const a = /** @type {HTMLElement | null} */ (document.querySelector('#nav .nav-quotidien [data-nom]')); if (a) a.focus(); } });
    suivreLEntreprise();
    lirePersonne();
    if (w.SkanPoste && typeof w.SkanPoste.etat === 'function') poste = w.SkanPoste.etat();
    poserHors();
    setInterval(() => { if (Date.now() - derniereVerif > 9 * 60 * 1000) verifierMaj(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - derniereVerif > 2 * 60 * 1000) verifierMaj(); });
    new MutationObserver(() => apresCompte()).observe(barre, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    hautTel();
    apresCompte();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
