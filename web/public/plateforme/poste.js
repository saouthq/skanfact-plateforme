// @ts-check
// Le poste (briques 72 et 73 ; docs/hors-ligne.md) : ce que l'appareil garde pour qu'on travaille sans
// réseau (04 § 1, § 2 et § 4). Chargé avant le point de contact, il pose `window.SkanPoste` :
//   - le service des écrans (/sw.js) : l'application s'installe, et ses écrans s'ouvrent sans réseau ;
//   - sur « mon ordinateur » (la session gardée sur l'appareil, 03 § 6), une COPIE de chaque
//     entreprise ouverte, chiffrée par une clé que le navigateur ne laisse jamais sortir (AES-GCM, non
//     exportable). Jamais sur l'ordinateur d'un autre ; effacée à la déconnexion, quand une autre
//     personne se connecte, et quand l'appareil est retiré (brique 74, après avoir remis ce qui
//     attendait). Limite honnête (04 § 2) : elle protège un disque volé, pas un poste allumé et ouvert ;
//   - ce qu'on enregistre sans réseau : gardé, chiffré de même, jusqu'à ce qu'il parte ;
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
    const r = indexedDB.open(BASE, 2);
    r.onupgradeneeded = () => {
      for (const m of ['cles', 'copies', 'attentes']) if (!r.result.objectStoreNames.contains(m)) r.result.createObjectStore(m);
    };
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

  // Chiffrer et garder ; relire et déchiffrer (la copie, ou ce qui attend le réseau).
  /** @param {string} magasin @param {string} id @param {unknown} contenu */
  async function garder(magasin, id, contenu) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(), new TextEncoder().encode(JSON.stringify(contenu)));
    await faire(magasin, 'readwrite', (s) => s.put({ iv, chiffre, le: Date.now() }, id));
  }
  /** @param {string} magasin @param {string} id @returns {Promise<{ contenu: any, le: number } | null>} */
  async function relire(magasin, id) {
    const c = await faire(magasin, 'readonly', (s) => s.get(id));
    if (!c) return null;
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, await cle(), c.chiffre);
    return { contenu: JSON.parse(new TextDecoder().decode(clair)), le: c.le };
  }
  /** @param {string} id @param {unknown} contenu */
  async function ecrireCopie(id, contenu) {
    if (!garde()) return;
    await garder('copies', id, contenu);
    try { localStorage.setItem(DERNIERE, id); } catch { /* sans mémoire : l'entrée ne saura pas quoi ouvrir hors ligne */ }
  }
  /** @param {string} id */
  const lireCopie = async (id) => (garde() ? relire('copies', id) : null);
  // Ce qui a été enregistré sans réseau (brique 73) : l'état du dossier que l'écran a enregistré, qui
  // part par rapport à la copie (ses révisions disent au serveur ce que le poste avait vu).
  /** @param {string} id @param {unknown} contenu */
  const ecrireAttente = async (id, contenu) => { if (garde()) await garder('attentes', id, contenu); };
  /** @param {string} id */
  const lireAttente = async (id) => (garde() ? relire('attentes', id) : null);
  /** @param {string} id */
  const effacerAttente = async (id) => { await faire('attentes', 'readwrite', (s) => s.delete(id)); };
  // Tout ce que le poste garde : les copies, ce qui attend, la clé, et le souvenir de la dernière entreprise.
  async function effacer() {
    try { localStorage.removeItem(DERNIERE); localStorage.removeItem('skanfact.poste_de'); } catch { /* rien à retirer */ }
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
  const esc = (/** @type {string} */ x) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
  const cacher = () => { if (bandeau) bandeau.hidden = true; };
  // Un bouton du bandeau qui recharge la page (ce que le serveur a).
  const recharger = () => { const b = document.getElementById('poste-recharger'); if (b) b.onclick = () => location.reload(); };

  /** @type {number | null} */ let horsLigneDepuis = null;
  /** @type {number | null} */ let copieLue = null;
  // Ce qui attend le réseau (brique 73) : s'il y en a, et combien de pièces ou de fiches (les réglages
  // du dossier qui changent avec elles ne se comptent pas : on dit ce que la personne a fait).
  let attend = false;
  let enAttente = 0;
  const attendent = (/** @type {number} */ n) => (n > 1 ? `${n} changements attendent le réseau : gardés sur ce poste, ils partiront seuls à son retour.`
    : n === 1 ? 'Un changement attend le réseau : gardé sur ce poste, il partira seul à son retour.'
      : 'Tes changements attendent le réseau : gardés sur ce poste, ils partiront seuls à son retour.');
  // Le réseau manque : on le dit, avec ce qu'on voit (la copie de ce poste, et de quand) et ce qui attend.
  /** @param {{ copieLe?: number }} [o] */
  function horsLigne(o = {}) {
    if (o.copieLe) copieLue = o.copieLe;
    if (horsLigneDepuis === null) horsLigneDepuis = Date.now();
    const vu = copieLue ? `Tu consultes la copie de ce poste, du ${jour(copieLue)} à ${heure(copieLue)}.` : 'Ce que tu vois reste à l\'écran.';
    const suite = !garde() ? 'Enregistrer demande le réseau : sur l\'ordinateur d\'un autre, rien n\'est gardé sur le poste.'
      : attend ? attendent(enAttente)
        : 'Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau.';
    poser(`<span><strong>Hors ligne depuis ${heure(horsLigneDepuis)}.</strong> ${vu} ${suite}</span>`);
  }
  // Le nombre de changements gardés sur le poste, que le bandeau dit tant que le réseau manque.
  /** @param {number} n */
  function attente(n) { attend = true; enAttente = n; if (horsLigneDepuis !== null) horsLigne(); }
  // Le réseau est revenu : ce qui attendait part (le point de contact s'en charge, `auRetour`). Si
  // l'écran montre la copie du poste, un bouton recharge ce que le serveur a.
  /** @type {(() => void) | null} */ let quandRevenu = null;
  function enLigne() {
    if (horsLigneDepuis === null) return;
    horsLigneDepuis = null;
    if (quandRevenu) quandRevenu();
    if (attend) { poser(`<span>Le réseau est revenu : ${enAttente === 1 ? 'ton changement part' : 'tes changements partent'}…</span>`, true); return; }
    if (!copieLue) { cacher(); return; }
    poser('<span>Le réseau est revenu. Recharge pour voir ce que les autres ont fait depuis ta copie.</span><button type="button" id="poste-recharger">Recharger</button>', true);
    recharger();
  }
  // Ce qui attendait est parti : on le dit (et, si une pièce avait changé ailleurs, ce qui en a été fait).
  /** @param {number} n @param {number} [conflits] */
  function envoye(n, conflits = 0) {
    attend = false; enAttente = 0;
    const pieces = conflits > 1 ? `${conflits} pièces avaient changé ailleurs` : 'Une pièce avait changé ailleurs';
    const faits = n > 1 ? `tes ${n} changements faits hors ligne sont enregistrés` : n === 1 ? 'ton changement fait hors ligne est enregistré' : 'tes changements faits hors ligne sont enregistrés';
    poser(`<span>Le réseau est revenu : ${faits}.${conflits
      ? ` ${pieces} : la version du serveur est gardée, la tienne est mise de côté, rien n'est perdu.` : ''}</span>${copieLue ? '<button type="button" id="poste-recharger">Recharger</button>' : ''}`, true);
    recharger();
  }
  // Une question posée dans le bandeau, avant un geste qui perdrait quelque chose (ce qui détruit demande).
  /** @param {string} question @param {string} oui @param {string} non @returns {Promise<boolean>} */
  function demander(question, oui, non) {
    return new Promise((ok) => {
      poser(`<span><strong>${esc(question)}</strong></span><button type="button" id="poste-non">${esc(non)}</button><button type="button" id="poste-oui">${esc(oui)}</button>`);
      const fin = (/** @type {boolean} */ r) => { if (horsLigneDepuis !== null) horsLigne(); else cacher(); ok(r); };
      const n = document.getElementById('poste-non'); if (n) n.onclick = () => fin(false);
      const o = document.getElementById('poste-oui'); if (o) o.onclick = () => fin(true);
    });
  }
  // Hors ligne, sans rien à montrer : la raison, et le bouton qui réessaie.
  /** @param {string} motif */
  function sansCopie(motif) {
    poser(`<span><strong>${motif.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</strong></span><button type="button" id="poste-reessayer">Réessayer</button>`);
    const b = document.getElementById('poste-reessayer');
    if (b) b.onclick = () => location.reload();
  }
  // Une annonce (brique 74 bis) : ce qui attend une décision, et le bouton qui y mène. Elle ne couvre
  // jamais ce que le bandeau dit déjà (le réseau, ce qui attend).
  /** @param {string} texte @param {string} bouton @param {() => void} geste */
  function annoncer(texte, bouton, geste) {
    if (bandeau && !bandeau.hidden) return;
    poser(`<span>${esc(texte)}</span><button type="button" id="poste-annonce">${esc(bouton)}</button>`, true);
    const b = document.getElementById('poste-annonce');
    if (b) b.onclick = () => { cacher(); geste(); };
  }
  window.addEventListener('offline', () => horsLigne());
  window.addEventListener('online', () => enLigne());

  /** @type {any} */ (window).SkanPoste = {
    garde, ecrireCopie, lireCopie, ecrireAttente, lireAttente, effacerAttente, effacer,
    horsLigne, enLigne, sansCopie, attente, envoye, demander, annoncer,
    /** @param {() => void} f */ auRetour: (f) => { quandRevenu = f; },
  };
})();
