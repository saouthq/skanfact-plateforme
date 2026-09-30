// @ts-check
// Le poste (brique 72 ; docs/hors-ligne.md) : ce que l'appareil garde pour qu'on travaille sans
// réseau (04 § 1 et § 2). Chargé avant le point de contact, il pose `window.SkanPoste` :
//   - le service des écrans (/sw.js) : l'application s'installe, et ses écrans s'ouvrent sans réseau ;
//   - sur « mon ordinateur » (la session gardée sur l'appareil, 03 § 6), une COPIE de chaque
//     entreprise ouverte, chiffrée par une clé que le navigateur ne laisse jamais sortir (AES-GCM, non
//     exportable). Jamais sur l'ordinateur d'un autre ; effacée à la déconnexion et à chaque nouvelle
//     connexion. Limite honnête (04 § 2) : elle protège un disque volé, pas un poste allumé et ouvert ;
//   - le bandeau « Hors ligne » : ce qu'on voit, depuis quand, et ce qui attend le réseau.
(function () {
  'use strict';
  const BASE = 'skanfact-poste';
  // L'entreprise dont ce poste a une copie : l'entrée l'ouvre quand le réseau manque.
  const DERNIERE = 'skanfact.hors_ligne';

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* sans lui, rien ne se garde : en ligne, tout marche */ });

  /** @returns {boolean} La session est gardée sur l'appareil : c'est « mon ordinateur ». */
  const garde = () => { try { return !!localStorage.getItem('skanfact.jeton'); } catch { return false; } };

  /** @returns {Promise<IDBDatabase>} */
  const ouvrir = () => new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('cles'); r.result.createObjectStore('copies'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  /** @param {string} magasin @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} geste @returns {Promise<any>} */
  async function faire(magasin, mode, geste) {
    const db = await ouvrir();
    try {
      return await new Promise((ok, ko) => {
        const t = db.transaction(magasin, mode);
        const r = geste(t.objectStore(magasin));
        t.oncomplete = () => ok(r.result);
        t.onerror = () => ko(t.error);
        t.onabort = () => ko(t.error);
      });
    } finally { db.close(); }
  }
  // La clé de l'appareil : créée une fois, jamais exportable (le navigateur refuse de la donner).
  /** @returns {Promise<CryptoKey>} */
  async function cle() {
    const deja = await faire('cles', 'readonly', (s) => s.get('appareil'));
    if (deja) return deja;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await faire('cles', 'readwrite', (s) => s.put(k, 'appareil'));
    return k;
  }

  /** @param {string} id @param {unknown} contenu */
  async function ecrireCopie(id, contenu) {
    if (!garde()) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(), new TextEncoder().encode(JSON.stringify(contenu)));
    await faire('copies', 'readwrite', (s) => s.put({ iv, chiffre, le: Date.now() }, id));
    try { localStorage.setItem(DERNIERE, id); } catch { /* sans mémoire : l'entrée ne saura pas quoi ouvrir hors ligne */ }
  }
  /** @param {string} id @returns {Promise<{ contenu: any, le: number } | null>} */
  async function lireCopie(id) {
    if (!garde()) return null;
    const c = await faire('copies', 'readonly', (s) => s.get(id));
    if (!c) return null;
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, await cle(), c.chiffre);
    return { contenu: JSON.parse(new TextDecoder().decode(clair)), le: c.le };
  }
  // Tout ce que le poste garde : les copies, la clé, et le souvenir de la dernière entreprise.
  async function effacer() {
    try { localStorage.removeItem(DERNIERE); } catch { /* rien à retirer */ }
    await new Promise((ok) => { const r = indexedDB.deleteDatabase(BASE); r.onsuccess = r.onerror = r.onblocked = () => ok(undefined); });
  }

  // ── Le bandeau ────────────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `#poste-bandeau { position: fixed; top: 0; left: 0; right: 0; z-index: 9999; display: flex; gap: 12px; align-items: center;
    justify-content: center; flex-wrap: wrap; padding: 6px 16px; font: 13px/1.4 system-ui, sans-serif; background: #fff4e0; color: #5b3a00;
    border-bottom: 1px solid #f0c77a; } #poste-bandeau[hidden] { display: none; } #poste-bandeau.revenu { background: #e6f5f3; color: #0b5f57; border-color: #9fd9d1; }
    #poste-bandeau button { font: inherit; padding: 2px 10px; border-radius: 6px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }`;
  document.head.appendChild(style);
  /** @type {HTMLElement | null} */ let bandeau = null;
  const heure = (/** @type {number} */ t) => { const d = new Date(t); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`; };
  const jour = (/** @type {number} */ t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  /** @param {string} html @param {boolean} [revenu] */
  function poser(html, revenu = false) {
    if (!bandeau) {
      bandeau = document.createElement('div');
      bandeau.id = 'poste-bandeau';
      bandeau.setAttribute('role', 'status');
      (document.body || document.documentElement).appendChild(bandeau);
    }
    bandeau.className = revenu ? 'revenu' : '';
    bandeau.innerHTML = html;
    bandeau.hidden = false;
  }

  /** @type {number | null} */ let horsLigneDepuis = null;
  /** @type {number | null} */ let copieLue = null;
  // Le réseau manque : on le dit, avec ce qu'on voit (la copie de ce poste, et de quand) et ce qui attend.
  /** @param {{ copieLe?: number }} [o] */
  function horsLigne(o = {}) {
    if (o.copieLe) copieLue = o.copieLe;
    if (horsLigneDepuis === null) horsLigneDepuis = Date.now();
    const vu = copieLue ? `Tu consultes la copie de ce poste, du ${jour(copieLue)} à ${heure(copieLue)}.` : 'Ce que tu vois reste à l\'écran.';
    poser(`<span><strong>Hors ligne depuis ${heure(horsLigneDepuis)}.</strong> ${vu} Enregistrer demande le réseau : ce que tu changes maintenant ne part pas.</span>`);
  }
  // Le réseau est revenu. Si l'écran montre la copie du poste, un bouton recharge ce que le serveur a.
  function enLigne() {
    if (horsLigneDepuis === null) return;
    horsLigneDepuis = null;
    if (!copieLue) { if (bandeau) bandeau.hidden = true; return; }
    poser('<span>Le réseau est revenu. Recharge pour voir ce que les autres ont fait depuis ta copie.</span><button type="button" id="poste-recharger">Recharger</button>', true);
    const b = document.getElementById('poste-recharger');
    if (b) b.onclick = () => location.reload();
  }
  // Hors ligne, sans rien à montrer : la raison, et le bouton qui réessaie.
  /** @param {string} motif */
  function sansCopie(motif) {
    poser(`<span><strong>${motif.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</strong></span><button type="button" id="poste-reessayer">Réessayer</button>`);
    const b = document.getElementById('poste-reessayer');
    if (b) b.onclick = () => location.reload();
  }
  window.addEventListener('offline', () => horsLigne());
  window.addEventListener('online', () => enLigne());

  /** @type {any} */ (window).SkanPoste = { garde, ecrireCopie, lireCopie, effacer, horsLigne, enLigne, sansCopie };
})();
