// @ts-check
// Le poste (briques 72 et 73 ; docs/hors-ligne.md) : ce que l'appareil garde pour qu'on travaille sans
// réseau (04 § 1, § 2 et § 4). Chargé avant le point de contact, il pose `window.SkanPoste` :
//   - le service des écrans (/sw.js) : l'application s'installe, et ses écrans s'ouvrent sans réseau ;
//   - sur « mon ordinateur » (la session gardée sur l'appareil, 03 § 6), une COPIE de chaque
//     entreprise ouverte, chiffrée par une clé que le navigateur ne laisse jamais sortir (AES-GCM, non
//     exportable). Jamais sur l'ordinateur d'un autre ; effacée à la déconnexion, quand une autre
//     personne se connecte, et quand l'appareil est retiré (brique 74, après avoir remis ce qui
//     attendait). Limite honnête (04 § 2) : elle protège un disque volé, pas un poste allumé et ouvert ;
//   - ce qu'on enregistre sans réseau : gardé, chiffré de même, jusqu'à ce qu'il parte — si le
//     navigateur promet de garder (stockage persistant) et depuis moins de 72 heures (brique 75) ;
//   - le bandeau « Hors ligne » : ce qu'on voit, depuis quand, et ce qui attend le réseau.
(function () {
  'use strict';
  const BASE = 'skanfact-poste';
  // L'entreprise dont ce poste a une copie : l'entrée l'ouvre quand le réseau manque.
  const DERNIERE = 'skanfact.hors_ligne';

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* sans lui, rien ne se garde : en ligne, tout marche */ });

  // Le poste a été effacé (un appareil retiré, une déconnexion) : la page s'en va, et plus rien ne s'y lit ni ne s'y
  // écrit. Une lecture ou une écriture partie juste avant (la copie qu'on rafraîchit, ce qui attend le réseau) ROUVRAIT
  // la base juste après sa suppression, et la recréait : l'entrée disait « ce qu'il gardait […] est effacé » d'une base
  // encore là (vu par tests/web/appareils.test.ts : supprimée, puis recréée à la milliseconde suivante).
  let efface = false;
  // La lecture pour le support (Support S2 ; docs/support.md) : la page lit le dossier d'un client par la console. Rien de
  // ce client ne se garde sur ce poste, et rien de ce que ce poste garde (la copie de l'entreprise de celui qui lit, s'il
  // en a une) ne s'efface ni ne se mélange : le poste fait comme s'il n'existait pas.
  const enLecture = /[?&]support=[0-9a-f-]{36}(&|$)/.test(location.search);
  /** @returns {boolean} La session est gardée sur l'appareil : c'est « mon ordinateur ». */
  const garde = () => { if (efface || enLecture) return false; try { return !!localStorage.getItem('skanfact.jeton'); } catch { return false; } };

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
    if (efface) return undefined;
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
  // La clé de l'appareil : créée une fois, jamais exportable (le navigateur refuse de la donner). (1.104.0) Une seule
  // demande à la fois : le Cabinet garde plusieurs lectures en même temps à son ouverture, et chacune créait sa clé (la
  // dernière écrite gagnait) ; les copies chiffrées par les autres ne se relisaient plus sans réseau.
  /** @type {Promise<CryptoKey> | null} */ let cleEnCours = null;
  /** @returns {Promise<CryptoKey>} */
  function cle() {
    if (!cleEnCours) {
      cleEnCours = (async () => {
        const deja = await faire('cles', 'readonly', (s) => s.get('appareil'));
        if (deja) return deja;
        const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await faire('cles', 'readwrite', (s) => s.put(k, 'appareil'));
        return k;
      })();
      cleEnCours.catch(() => { cleEnCours = null; });
    }
    return cleEnCours;
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
    // Effacé pendant qu'on écrivait : l'entrée ne doit pas croire qu'il reste une entreprise à rouvrir.
    if (!garde()) return;
    try { localStorage.setItem(DERNIERE, id); } catch { /* sans mémoire : l'entrée ne saura pas quoi ouvrir hors ligne */ }
  }
  /** @param {string} id */
  const lireCopie = async (id) => (garde() ? relire('copies', id) : null);
  // (1.104.0) Le Cabinet (04 § 2 : les dossiers qu'on emporte) : ce qu'il a lu du serveur, chemin par chemin, gardé
  // chiffré comme la copie d'une entreprise ; sans réseau, il se relit. « c:<cabinet> » est ce que l'entrée rouvre.
  /** @param {string} cabinet @param {string} chemin @param {unknown} contenu */
  async function garderLecture(cabinet, chemin, contenu) {
    if (!garde()) return;
    await garder('copies', `c:${cabinet}:${chemin}`, contenu);
    if (!garde()) return;
    try { localStorage.setItem(DERNIERE, `c:${cabinet}`); } catch { /* sans mémoire : l'entrée ne saura pas quoi ouvrir hors ligne */ }
  }
  /** @param {string} cabinet @param {string} chemin */
  const relireLecture = async (cabinet, chemin) => (garde() ? relire('copies', `c:${cabinet}:${chemin}`) : null);
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
    if (enLecture) return;
    efface = true;
    cleEnCours = null;
    try { localStorage.removeItem(DERNIERE); localStorage.removeItem('skanfact.poste_de'); } catch { /* rien à retirer */ }
    // Bloquée, la suppression attend que la lecture en cours se referme (quelques millisecondes) : on l'attend un
    // instant, plutôt que de partir en la laissant derrière soi. Bornée : un autre onglet figé ne retient pas la page.
    await new Promise((ok) => {
      const r = indexedDB.deleteDatabase(BASE);
      r.onsuccess = r.onerror = () => ok(undefined);
      r.onblocked = () => setTimeout(() => ok(undefined), 2000);
    });
  }
  // Ce que le poste garde d'UNE entreprise (brique 76 : la personne n'en fait plus partie) : sa copie,
  // ce qui l'attendait, et le souvenir de l'avoir ouverte en dernier. Les autres entreprises restent.
  /** @param {string} id */
  async function effacerEntreprise(id) {
    if (enLecture) return;
    await faire('copies', 'readwrite', (s) => s.delete(id));
    await faire('attentes', 'readwrite', (s) => s.delete(id));
    try { if (localStorage.getItem(DERNIERE) === id) localStorage.removeItem(DERNIERE); } catch { /* rien à retirer */ }
  }

  // ── Les limites du hors-ligne (brique 75 ; docs/hors-ligne.md, H11 et H12) ────────────────────
  // Le stockage persistant (04 § 4) : sans lui, le navigateur peut vider ce que le poste garde
  // (Safari après sept jours sans visite, Chromium quand le disque se remplit). Demandé sur « mon
  // ordinateur » ; refusé, le poste garde sa copie pour qu'on consulte, mais n'enregistre rien sans
  // réseau : on ne promet pas de garder ce qui peut disparaître.
  /** @type {boolean | null} */ let persistant = null;
  if (garde() && navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => p || navigator.storage.persist()).then((p) => { persistant = p; }, () => { persistant = false; });
  }
  // Les droits gardés hors ligne (04 § 7, 03 D8) : 72 heures depuis le dernier contact avec le
  // serveur. Au-delà, on consulte, et ce qui attend partira ; rien de neuf ne s'enregistre.
  const CONTACT = 'skanfact.dernier_contact';
  const DROITS_MS = 72 * 3600 * 1000;
  const PERSISTANT = 'Ce navigateur peut vider ce que ce poste garde : sans réseau, tu consultes, mais rien ne s\'enregistre. Pour enregistrer sans réseau, installe l\'application (menu du navigateur, « Installer SkanFact »).';
  const DROITS = 'Plus de 72 heures sans contact avec le serveur : rien de neuf ne s\'enregistre sur ce poste tant qu\'il n\'a pas revu tes droits ; tu consultes.';
  // Ce qui empêche d'enregistrer sans réseau sur « mon ordinateur », ou null (l'ordinateur d'un
  // autre, lui, ne garde jamais rien : c'est dit ailleurs).
  /** @returns {string | null} */
  function limite() {
    if (!garde()) return null;
    if (persistant !== true) return PERSISTANT;
    let c = 0;
    try { c = Number(localStorage.getItem(CONTACT)) || 0; } catch { /* sans mémoire : pas de limite de durée */ }
    return c && Date.now() - c > DROITS_MS ? DROITS : null;
  }
  // Le poste qui tient la caisse (brique 120 ; 04 § 7) : 7 jours sans le serveur au plus pour encaisser sans réseau
  // (À VÉRIFIER avec le cahier NACEF). Au-delà, la caisse s'arrête d'encaisser, et le dit.
  const CAISSE_MS = 7 * 24 * 3600 * 1000;
  const CAISSE = 'Plus de 7 jours sans contact avec le serveur : la caisse n\'encaisse plus sans réseau. Une connexion, même courte, la débloque. Rien n\'a été vendu.';
  /** @returns {string | null} */
  function limiteCaisse() {
    if (!garde()) return null;
    if (persistant !== true) return PERSISTANT;
    let c = 0;
    try { c = Number(localStorage.getItem(CONTACT)) || 0; } catch { /* sans mémoire : pas de limite de durée */ }
    return c && Date.now() - c > CAISSE_MS ? CAISSE : null;
  }

  // ── Le bandeau ────────────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `#poste-bandeau { position: fixed; top: 0; left: 0; right: 0; z-index: 9999; display: flex; gap: 12px; align-items: center;
    justify-content: center; flex-wrap: wrap; padding: 6px 16px; font: 13px/1.4 system-ui, sans-serif; background: #fff4e0; color: #5b3a00;
    border-bottom: 1px solid #f0c77a; } #poste-bandeau[hidden] { display: none; } #poste-bandeau.revenu { background: #e6f5f3; color: #0b5f57; border-color: #9fd9d1; }
    #poste-bandeau button { font: inherit; padding: 2px 10px; border-radius: 6px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }`;
  document.head.appendChild(style);
  /** @type {HTMLElement | null} */ let bandeau = null;
  // Sa hauteur, pour les pages qui tiennent tout l'écran (la caisse tactile, caisse.css) : elles se poussent dessous, et
  // leur barre du haut reste à portée du doigt (vu au test de la caisse sans réseau, 05/10/2026).
  const hauteur = () => document.documentElement.style.setProperty('--poste-bandeau-h', `${bandeau && !bandeau.hidden ? bandeau.offsetHeight : 0}px`);
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
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(hauteur).observe(bandeau);
    }
    bandeau.className = revenu ? 'revenu' : '';
    bandeau.innerHTML = html;
    bandeau.hidden = false;
    hauteur();
  }
  const cacher = () => { if (bandeau) { bandeau.hidden = true; hauteur(); } };
  // Un bouton du bandeau qui recharge la page (ce que le serveur a).
  const recharger = () => { const b = document.getElementById('poste-recharger'); if (b) b.onclick = () => location.reload(); };

  /** @type {number | null} */ let horsLigneDepuis = null;
  /** @type {number | null} */ let copieLue = null;
  // La page close par un message qui l'explique (rien à montrer : `sansCopie` ; la fin : `conclure`) : plus rien ne le
  // recouvre. Une lecture partie EN MÊME TEMPS que le dossier (docs/leger.md, S2) échoue parfois après lui, sans réseau :
  // son « Hors ligne depuis… » disait « ce que tu vois reste à l'écran » sur un écran vide, à la place de la raison (vu
  // le 13/10/2026 : « sur l'ordinateur d'un autre, rien n'est gardé » remplacé, tests/web/hors-ligne.test.ts).
  let close = false;
  // Ce qui attend le réseau (brique 73) : s'il y en a, et combien de pièces ou de fiches (les réglages
  // du dossier qui changent avec elles ne se comptent pas : on dit ce que la personne a fait).
  let attend = false;
  let enAttente = 0;
  // (1.104.0) Le Cabinet se consulte sans réseau ; (1.105.0) il n'y enregistre que sa saisie au brouillard (H15) : le
  // bandeau dit ce qui se garde, et compte des écritures.
  let cabinet = false;
  const attendent = (/** @type {number} */ n) => (cabinet ? (n > 1 ? `${n} écritures attendent le réseau : gardées sur ce poste, elles partiront seules à son retour.`
    : 'Une écriture attend le réseau : gardée sur ce poste, elle partira seule à son retour.')
    : n > 1 ? `${n} changements attendent le réseau : gardés sur ce poste, ils partiront seuls à son retour.`
      : n === 1 ? 'Un changement attend le réseau : gardé sur ce poste, il partira seul à son retour.'
        : 'Tes changements attendent le réseau : gardés sur ce poste, ils partiront seuls à son retour.');
  // Le réseau manque : on le dit, avec ce qu'on voit (la copie de ce poste, et de quand) et ce qui attend.
  /** @param {{ copieLe?: number }} [o] */
  function horsLigne(o = {}) {
    if (close) return;
    if (o.copieLe) copieLue = o.copieLe;
    if (horsLigneDepuis === null) horsLigneDepuis = Date.now();
    const vu = copieLue ? `Tu consultes la copie de ce poste, du ${jour(copieLue)} à ${heure(copieLue)}.` : 'Ce que tu vois reste à l\'écran.';
    const l = limite();
    const suite = !garde() ? 'Enregistrer demande le réseau : sur l\'ordinateur d\'un autre, rien n\'est gardé sur le poste.'
      : attend ? `${attendent(enAttente)}${l ? ` ${l}` : ''}`
      : cabinet ? l || 'Ta saisie au brouillard se garde sur ce poste et partira seule au retour du réseau ; le reste demande le réseau.'
        : l || 'Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau.';
    poser(`<span><strong>Hors ligne depuis ${heure(horsLigneDepuis)}.</strong> ${vu} ${suite}</span>`);
  }
  // Le nombre de changements gardés sur le poste, que le bandeau dit tant que le réseau manque.
  /** @param {number} n */
  function attente(n) { attend = n > 0 || !cabinet; enAttente = n; if (horsLigneDepuis !== null) horsLigne(); }
  // Le réseau est revenu : ce qui attendait part (le point de contact s'en charge, `auRetour`). Si
  // l'écran montre la copie du poste, un bouton recharge ce que le serveur a.
  /** @type {(() => void) | null} */ let quandRevenu = null;
  // `serveur` : le serveur a répondu (le point de contact l'appelle ainsi) ; sinon, le navigateur dit
  // seulement que le réseau revient — un portail d'hôtel, un serveur en panne : ce n'est pas un contact.
  /** @param {boolean} [serveur] */
  function enLigne(serveur = true) {
    // Le serveur a répondu : les droits gardés hors ligne repartent pour 72 heures (04 § 7).
    if (serveur) try { localStorage.setItem(CONTACT, String(Date.now())); } catch { /* sans mémoire : pas de limite de durée */ }
    if (horsLigneDepuis === null || close) return;
    horsLigneDepuis = null;
    if (quandRevenu) quandRevenu();
    if (attend) { poser(`<span>Le réseau est revenu : ${cabinet ? (enAttente === 1 ? 'ton écriture part' : 'tes écritures partent') : enAttente === 1 ? 'ton changement part' : 'tes changements partent'}…</span>`, true); return; }
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
  // (1.105.0) Les écritures du Cabinet faites hors ligne sont parties (H15) : on le dit, et ce que le serveur a refusé
  // reste au brouillard de ce poste, avec sa raison.
  /** @param {number} n @param {number} refusees */
  function envoyeEcritures(n, refusees) {
    attend = false; enAttente = 0;
    const faites = n > 1 ? `tes ${n} écritures faites hors ligne sont au brouillard` : n === 1 ? 'ton écriture faite hors ligne est au brouillard' : '';
    const refus = refusees > 1 ? `${refusees} écritures ne sont pas entrées : elles restent au brouillard de ce poste, avec la raison du refus ; reprends-les dans la grille, ou supprime-les.`
      : refusees === 1 ? 'Une écriture n\'est pas entrée : elle reste au brouillard de ce poste, avec la raison du refus ; reprends-la dans la grille, ou supprime-la.' : '';
    poser(`<span>Le réseau est revenu${faites ? ` : ${faites}.` : '.'}${refus ? ` ${refus}` : ''}</span><button type="button" id="poste-recharger">Recharger</button>`, true);
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
  // Ce qui clôt la page (brique 76), et le bouton qui continue, vers l'entrée. (1.100.0) `autre` : un second geste, avant
  // « Continuer » (« Me connecter avec un autre compte », quand la page est ouverte dans le navigateur d'un autre compte).
  /** @param {string} texte @param {{ libelle: string, geste: () => void }} [autre] */
  function conclure(texte, autre) {
    close = true;
    poser(`<span><strong>${esc(texte)}</strong></span>${autre ? `<button type="button" id="poste-autre">${esc(autre.libelle)}</button>` : ''}<button type="button" id="poste-continuer">Continuer</button>`);
    const b = document.getElementById('poste-continuer');
    if (b) b.onclick = () => location.replace('/');
    const a = document.getElementById('poste-autre');
    if (a && autre) a.onclick = () => autre.geste();
  }
  // Hors ligne, sans rien à montrer : la raison, et le bouton qui réessaie.
  /** @param {string} motif */
  function sansCopie(motif) {
    close = true;
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
  window.addEventListener('online', () => enLigne(false));

  /** @type {any} */ (window).SkanPoste = {
    garde, ecrireCopie, lireCopie, garderLecture, relireLecture, ecrireAttente, lireAttente, effacerAttente, effacer, effacerEntreprise, conclure,
    horsLigne, enLigne, sansCopie, attente, envoye, envoyeEcritures, demander, annoncer, limite, limiteCaisse,
    /** @param {() => void} f */ auRetour: (f) => { quandRevenu = f; },
    pourLeCabinet: () => { cabinet = true; },
  };
})();
