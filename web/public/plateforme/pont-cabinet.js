// @ts-check
// Le point de contact des écrans du Cabinet v10 avec le serveur de la plateforme (brique 37 ;
// docs/cabinet.md). Chargé AVANT le code du Cabinet (adaptation de cabinet/index.html), il pose
// `window.cabinet`, que le Cabinet lit comme son pont avec l'ordinateur. Ici :
//   - la session de la plateforme ouvre le cabinet (plus de mot de passe du cabinet) ;
//   - les dossiers sont le portefeuille du serveur (les mandats acceptés, les dossiers tenus) ;
//   - le livre d'un dossier est celui que le serveur tient pour l'entreprise : UNE comptabilité, que
//     le client et son cabinet lisent pareil (C2) ; il n'y a plus de paquets (C4) ;
//   - tout le reste répond honnêtement « pas encore dans la version en ligne : rien n'a été fait ».
(function () {
  'use strict';
  /** @type {string | null} */
  let jeton = null;
  try { jeton = sessionStorage.getItem('skanfact.jeton'); } catch { /* stockage refusé : pas de session */ }
  const cabinetId = new URLSearchParams(location.search).get('c');
  if (!jeton || !cabinetId || !/^[0-9a-f-]{36}$/.test(cabinetId)) { location.replace('/'); return; }

  // L'écran écrit « v » devant : « v10 · en ligne ».
  const VERSION = '10 · en ligne';
  const PAS_EN_LIGNE = 'Pas encore dans la version en ligne de SkanFact Cabinet : rien n\'a été fait.';

  /** @param {string} methode @param {string} chemin @param {unknown} [corps] */
  async function appel(methode, chemin, corps) {
    /** @type {Record<string, string>} */
    const entetes = { authorization: `Bearer ${jeton}` };
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`/v1${chemin}`, { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    } catch (e) {
      throw new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
    }
    if (r.status === 401) { location.replace('/'); throw new Error('Ta session est terminée : reconnecte-toi.'); }
    const texte = await r.text();
    /** @type {any} */
    const lu = texte ? JSON.parse(texte) : {};
    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) throw new Error(typeof lu.motif === 'string' ? lu.motif : 'Le serveur a rencontré une erreur : réessaie dans un instant.');
    return lu;
  }

  // ── L'état du cabinet : le cabinet, son portefeuille, la personne qui travaille ────────────
  /** @type {Map<string, { id: string, name: string, matricule: string }>} */
  const dossiers = new Map();
  // La fiche de chaque dossier au cabinet (0020) : son contenu et sa révision.
  /** @type {Map<string, { contenu: Record<string, unknown>, revision: number | null }>} */
  const fiches = new Map();
  // Les champs de la fiche : ceux que le serveur garde (serveur/cabinet/routes.ts, FICHE).
  const TEXTES_FICHE = ['email', 'phone', 'contact', 'note', 'regime', 'tvaPeriod', 'from', 'cnssEmployeur', 'cnssCode'];
  /** @param {Record<string, unknown>} c */
  const depuisFiche = (c) => ({ ...c, fees: Number(c.fees || 0) / 1000 });
  async function construireEtat() {
    /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
    const [moi, mes, porte, lues] = await Promise.all([appel('GET', '/moi'), appel('GET', '/cabinets'), appel('GET', `/cabinets/${cabinetId}/portefeuille`), appel('GET', `/cabinets/${cabinetId}/fiches`)]);
    fiches.clear();
    for (const f of lues.fiches || []) fiches.set(f.entreprise, { contenu: f.contenu, revision: f.revision });
    const cab = (mes.cabinets || []).find((/** @type {any} */ c) => c.id === cabinetId);
    if (!cab) { location.replace('/'); throw new Error('Ce cabinet n\'est pas le tien.'); }
    // L'entrée rouvrira ce cabinet la prochaine fois (la même clé que pour une entreprise).
    try { localStorage.setItem('skanfact.entreprise', String(cabinetId)); } catch { /* sans stockage : l'entrée choisit */ }
    code = String(cab.code || '');
    proposes = (porte.dossiers || []).filter((/** @type {any} */ d) => d.statut === 'propose');
    dossiers.clear();
    const liste = (porte.dossiers || []).filter((/** @type {any} */ d) => d.statut === 'actif').map((/** @type {any} */ d) => {
      dossiers.set(d.entreprise, { id: d.entreprise, name: d.raisonSociale, matricule: d.matriculeFiscal || '' });
      // Un dossier tenu est le « dossier créé à la main » de la v10 : un client hors SkanFact.
      const fiche = fiches.get(d.entreprise);
      return K.migrateDossier({ ...(fiche ? depuisFiche(fiche.contenu) : {}), id: d.entreprise, name: d.raisonSociale, matricule: d.matriculeFiscal || '', manual: !!d.tenu, packs: [] });
    });
    const etat = K.migrate({ cabinet: { name: cab.nom, email: '', phone: '' }, dossiers: liste });
    etat.moi = moi.id;
    etat.moiNom = moi.nom;
    return etat;
  }

  // ── Le livre d'un dossier : les écritures que le serveur tient pour l'entreprise ────────────
  /** @param {string} ent @param {string} du @param {string} au */
  async function ecrituresDe(ent, du, au) {
    /** @type {any[]} */ const toutes = [];
    let suite = null;
    do {
      const q = new URLSearchParams({ limite: '500' });
      if (du) q.set('du', du);
      if (au) q.set('au', au);
      if (suite) q.set('apres', suite);
      const page = await appel('GET', `/entreprises/${ent}/compta/ecritures?${q}`);
      toutes.push(...(page.ecritures || []));
      suite = page.suite;
    } while (suite);
    return toutes;
  }
  // Les mois où le dossier a des écritures, et ses exercices (les années).
  /** @param {string} ent */
  async function moisEtExercices(ent) {
    const toutes = await ecrituresDe(ent, '', '');
    const presents = [...new Set(toutes.map((e) => String(e.date).slice(0, 7)))].sort();
    // Plus de paquets, donc plus de mois « manquants » : les livres du client sont à jour en direct.
    // Tous les mois, de janvier de la première année jusqu'au mois en cours (ou au dernier mois écrit).
    const courant = new Date().toISOString().slice(0, 7);
    const plusTard = presents.at(-1) ?? courant;
    const dernier = plusTard > courant ? plusTard : courant;
    /** @type {string[]} */ const mois = [];
    for (let m = `${(presents[0] ?? courant).slice(0, 4)}-01`; m <= dernier; ) {
      mois.push(m);
      const a = Number(m.slice(0, 4)), n = Number(m.slice(5, 7));
      m = n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}`;
    }
    const annees = [...new Set(mois.map((m) => m.slice(0, 4)))].sort();
    return {
      mois,
      exercices: annees.map((a) => ({ annee: a, clos: false, ecritures: toutes.filter((e) => String(e.date).startsWith(a)).length })),
    };
  }
  const nombre = (/** @type {string} */ v) => Number(v) || 0;
  // Une écriture du serveur, dans la forme du livre de la v10 (compta.js, `ajouterEcriture`) : son
  // numéro est son rang dans la chaîne des livres (validée), comme le numéro unique du livre v10.
  /** @param {string} ent @param {number} annee @param {any[]} ecritures */
  function versLeLivre(ent, annee, ecritures) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const livre = KC.livreVide(ent, annee);
    const contrePassees = new Set(ecritures.filter((e) => e.origine.type === 'contre_passation' && e.statut === 'validee').map((e) => e.origine.id));
    for (const e of ecritures) {
      livre.ecritures.push({
        id: e.id, numero: e.chaine ?? null, date: e.date, journal: e.journal, piece: e.piece || '', libelle: e.libelle,
        source: 'skanfact', mois: String(e.date).slice(0, 7), docId: e.origine.id, pieceJointe: null,
        statut: e.statut === 'validee' ? (contrePassees.has(e.id) ? 'contrepassee' : 'validee') : 'brouillard',
        auteur: '', creeLe: 0, valideeLe: null,
        contrepasseDe: e.origine.type === 'contre_passation' ? e.origine.id : null, extourneDe: null, extourne: false, extourneeLe: null,
        lignes: e.lignes.map((/** @type {any} */ l) => ({
          compte: l.compte, tiersId: e.tiers, tiers: '', libelle: l.libelle, debit: nombre(l.debit), credit: nombre(l.credit), lettre: '',
        })),
      });
      for (const l of e.lignes) KC.assurerCompte(livre, l.compte, l.libelle);
    }
    return livre;
  }

  // La fiche : les champs de la liste, rien d'autre ; les honoraires en millimes.
  /** @param {string} ent @param {Record<string, unknown>} f @param {number | null} revision */
  async function poserFiche(ent, f, revision) {
    /** @type {Record<string, unknown>} */ const contenu = {};
    for (const k of TEXTES_FICHE) if (f[k] != null) contenu[k] = String(f[k]);
    if (f.archived != null) contenu.archived = !!f.archived;
    if (f.fees != null) contenu.fees = Math.round((Number(f.fees) || 0) * 1000);
    await appel('PUT', `/cabinets/${cabinetId}/fiches/${ent}`, { contenu, revision });
  }

  // C4 (docs/cabinet.md) : ce qui n'a plus d'objet sans paquets ni fichier sur l'ordinateur. Les
  // panneaux des Réglages se cachent, leur pastille et leur résultat de recherche aussi ; la
  // palette ne les propose plus (adaptation). Du panneau Sécurité ne reste que « Verrouiller ».
  const PANNEAUX_ABSENTS = ['pan-licence', 'pan-inbox', 'pan-backup', 'pan-maj'];
  // Les étapes de « Tes premiers pas » sans objet : l'appairage, la clé de secours, la copie sur un
  // disque ; et « recevoir un premier paquet », qui reviendra en « tenir un premier livre » avec la
  // saisie du cabinet (brique 38).
  const ETAPES_ABSENTES = ['appairage', 'cle', 'copie', 'travail'];
  const style = document.createElement('style');
  style.textContent = `${PANNEAUX_ABSENTS.flatMap((id) => [`#${id}`, `[data-somm="${id}"]`, `[data-go="${id}"]`]).join(', ')},
    #pan-secu > :not(h2):not(.modal-actions), #pan-secu .modal-actions > :not(#s-lock), #rec-banniere { display: none !important; }`;
  document.head.appendChild(style);

  // ── Comment un client arrive : le code du cabinet, et les dossiers qu'on lui confie ────────
  // Un client sur SkanFact propose le mandat en tapant ce code ; l'associé l'accepte ou le refuse.
  let code = '';
  /** @type {any[]} */
  let proposes = [];
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const PERIMETRES = /** @type {Record<string, string>} */ ({ comptabilite: 'la comptabilité', declarations: 'les déclarations', saisie_achats: 'la saisie des achats', paie: 'la paie' });
  /** @param {boolean} [reglages] */
  function commentUnClientArrive(reglages) {
    const corps = `<p class="small">Un client sur SkanFact te confie son dossier lui-même : dans <strong>Paramètres → Envois → Ton cabinet comptable</strong>,
      il tape le code de ton cabinet. Tu acceptes ici, sur la page Dossiers ; ses livres sont alors ceux du serveur, à jour en direct.
      Un client qui n'est pas sur SkanFact : « Nouveau client… », et tu tiens ses livres toi-même.</p>
      <div class="mt"><div class="muted small">Le code de ton cabinet</div>
        <div class="empreinte-ligne"><span class="fingerprint" id="code-cabinet">${esc(code)}</span>
        <button type="button" class="btn btn-sm" data-copier-code>Copier</button></div></div>`;
    return reglages ? corps : `<div class="panel"><h2>Comment un client arrive jusqu'ici</h2>${corps}</div>`;
  }
  function bandeauMandats() {
    return proposes.map((d) => {
      const p = (d.perimetre || []).map((/** @type {string} */ x) => PERIMETRES[x] || x);
      return `<div class="banner"><span><strong>${esc(d.raisonSociale)}</strong> te confie son dossier :
        ${esc(p.join(', ').replace(/, ([^,]*)$/, ' et $1'))}.</span>
        <button class="btn btn-ghost btn-sm nw" data-mandat-refuser="${esc(d.mandat)}">Refuser</button>
        <button class="btn btn-primary btn-sm nw" data-mandat-accepter="${esc(d.mandat)}">Accepter</button></div>`;
    }).join('');
  }
  // Les boutons de ces panneaux, par délégation : l'écran les redessine à chaque rendu.
  document.addEventListener('click', async (e) => {
    const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-copier-code], [data-mandat-accepter], [data-mandat-refuser]') : null);
    if (!b) return;
    if (b.hasAttribute('data-copier-code')) {
      try { await navigator.clipboard.writeText(code); b.textContent = 'Copié'; } catch { /* le code reste lisible à l'écran */ }
      return;
    }
    const accepter = b.getAttribute('data-mandat-accepter');
    const mandat = accepter || b.getAttribute('data-mandat-refuser');
    b.setAttribute('disabled', '');
    try {
      await appel('POST', `/cabinets/${cabinetId}/mandats/${mandat}/${accepter ? 'accepter' : 'arreter'}`);
      location.reload();
    } catch (x) {
      b.removeAttribute('disabled');
      const ligne = b.closest('.banner');
      if (ligne) ligne.insertAdjacentHTML('beforeend', `<span class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</span>`);
    }
  });

  /** @type {Record<string, any>} */
  const pont = {
    commentUnClientArrive,
    bandeauMandats,
    panneauxAbsents: PANNEAUX_ABSENTS,
    etapesAbsentes: ETAPES_ABSENTES,
    // L'ouverture : la session de la plateforme ouvre le cabinet (adaptation de boot()).
    status: async () => ({ exists: true, session: true, version: VERSION, backups: 0, corruptFile: false }),
    unlock: async () => ({ state: await construireEtat(), created: false, reorganized: null, exemple: null }),
    state: construireEtat,
    // Verrouiller ferme la session : on rouvre avec son mot de passe, comme la v10 le promet.
    lock: async () => {
      try { await fetch('/v1/deconnexion', { method: 'POST', headers: { authorization: `Bearer ${jeton}` } }); } catch { /* la session se ferme de toute façon ici */ }
      try { sessionStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
      location.replace('/');
      return true;
    },

    // Le livre d'un dossier.
    livreIndex: async (/** @type {string} */ id) => ({ format: 1, exercices: (await moisEtExercices(id)).exercices }),
    livres: async (/** @type {string} */ id) => {
      const d = dossiers.get(id);
      const m = await moisEtExercices(id);
      return { dossier: d, paquets: [], tousLesMois: m.mois, aucunPaquet: true, exercices: m.exercices };
    },
    livre: async (/** @type {string} */ id, /** @type {string} */ annee) => {
      const d = dossiers.get(id) || { id, name: '', matricule: '' };
      const ecritures = await ecrituresDe(id, `${annee}-01-01`, `${annee}-12-31`);
      return { dossier: d, livre: versLeLivre(id, Number(annee), ecritures) };
    },

    // Un dossier créé à la main est un dossier TENU (0019) ; ses notes vont dans sa fiche (0020).
    newDossier: async (/** @type {Record<string, unknown>} */ f) => {
      const nom = String(f.name || '').trim();
      if (!nom) throw new Error('Donne au moins un nom à ce client.');
      const matricule = String(f.matricule || '').replace(/\s+/g, '').toUpperCase();
      const cree = await appel('POST', `/cabinets/${cabinetId}/dossiers`, { raisonSociale: nom, ...(matricule ? { matriculeFiscal: matricule } : {}) });
      await poserFiche(cree.entreprise, f, null);
      return { state: await construireEtat(), id: cree.entreprise };
    },
    saveDossier: async (/** @type {string} */ id, /** @type {Record<string, unknown>} */ patch) => {
      const d = dossiers.get(id);
      if (!d) throw new Error('Dossier introuvable.');
      // Le nom et le matricule sont ceux de l'entreprise : ils ne se changent pas depuis la fiche.
      if ((patch.name != null && String(patch.name).trim() !== d.name) || (patch.matricule != null && String(patch.matricule).trim() !== d.matricule)) {
        throw new Error('Le nom et le matricule d\'un dossier sont ceux de l\'entreprise : ils ne se changent pas encore depuis la version en ligne. Rien n\'a été enregistré.');
      }
      const f = fiches.get(id);
      await poserFiche(id, { ...(f ? depuisFiche(f.contenu) : {}), ...patch }, f ? f.revision : null);
      return { state: await construireEtat(), moved: 0, id };
    },

    // Ce qui n'a pas d'objet en ligne, et que l'ouverture demande : sans réponse, sans erreur.
    updVersion: async () => ({ version: VERSION }),
    takePending: async () => [],
    backups: async () => ({ entries: [] }),
    inbox: async () => ({ nouveaux: [] }),
    questionsEnAttente: async () => [],
    // Ce que le Cabinet envoie sans attendre de réponse (le signalement d'une erreur, « une saisie
    // est en cours ») : ils ne doivent jamais échouer, sinon l'échec se signale à son tour, sans fin.
    supportErreur: async () => undefined,
    saisieEnCours: async () => undefined,
  };

  // Tout le reste : les écouteurs ne font rien ; chaque geste se refuse avec sa phrase.
  /** @type {any} */ (window).cabinet = new Proxy(pont, {
    get(cible, nom) {
      if (typeof nom !== 'string') return undefined;
      if (nom in cible) return cible[nom];
      if (/^on[A-Z]/.test(nom)) return () => {};
      return async () => { throw new Error(PAS_EN_LIGNE); };
    },
  });
})();
