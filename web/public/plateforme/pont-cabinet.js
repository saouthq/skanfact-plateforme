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
    // Les mois des cinq dernières années (le plafond du Cabinet v10, MAX_MOIS_ATTENDUS).
    const depuis = `${new Date().getUTCFullYear() - 5}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`;
    const [moi, mes, porte, lues, mois] = await Promise.all([appel('GET', '/moi'), appel('GET', '/cabinets'), appel('GET', `/cabinets/${cabinetId}/portefeuille`),
      appel('GET', `/cabinets/${cabinetId}/fiches`), appel('GET', `/cabinets/${cabinetId}/mois?depuis=${depuis}`)]);
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
      return K.migrateDossier({ ...(fiche ? depuisFiche(fiche.contenu) : {}), id: d.entreprise, name: d.raisonSociale, matricule: d.matriculeFiscal || '', manual: !!d.tenu,
        packs: moisVersPaquets(K, (mois.mois || []).filter((/** @type {any} */ x) => x.entreprise === d.entreprise)) });
    });
    const etat = K.migrate({ cabinet: { name: cab.nom, email: '', phone: '' }, dossiers: liste });
    etat.moi = moi.id;
    etat.moiNom = moi.nom;
    return etat;
  }

  // Les mois des livres d'un dossier, dans la forme des « paquets » que le tableau du portefeuille
  // compte (cabcore.js, packSummary) : un mois qui a des écritures est « reçu » ; il est DÉFINITIF
  // quand aucune n'est plus au brouillard ; son chiffre d'affaires est celui des comptes 70, et son
  // jour celui du dernier mouvement. Rien n'est inventé : un mois sans écriture n'a pas de paquet.
  /** @param {any} K @param {any[]} mois */
  function moisVersPaquets(K, mois) {
    return mois.map((m) => ({
      month: m.mois, label: K.monthLabel(m.mois), definitive: m.brouillards === 0,
      receivedAt: Date.parse(m.dernier) || null, generatedAt: m.dernier || null,
      files: 0, missing: [], absent: 0, digest: '', bytes: 0, path: '', sealed: false, appVersion: '',
      figures: { ca: Number(m.ca), devise: 'DT' }, integrity: null,
    })).sort((a, b) => (a.month < b.month ? 1 : -1));
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
  // Les exercices OUVERTS sur le serveur (brique 39) : leur année, leurs bornes, leur balance
  // d'ouverture. Gardés par dossier, pour l'écran qui demande sans attendre si un exercice est ouvert.
  /** @type {Map<string, { annee: number, du: string, au: string, ouverture: string | null }[]>} */
  const exercicesConnus = new Map();
  /** @param {string} ent */
  async function exercicesDe(ent) {
    const r = await appel('GET', `/entreprises/${ent}/compta/exercices`);
    exercicesConnus.set(ent, r.exercices || []);
    return exercicesConnus.get(ent) || [];
  }
  /** @param {string} ent @param {string|number} annee */
  const exerciceDe = (ent, annee) => (exercicesConnus.get(ent) || []).find((x) => String(x.annee) === String(annee)) || null;
  // Les mois où le dossier a des écritures, et ses exercices : les années qui ont des écritures, et
  // celles qui sont ouvertes sur le serveur (un exercice ouvert sans balance n'a encore rien d'écrit).
  /** @param {string} ent */
  async function moisEtExercices(ent) {
    const [toutes, ouverts] = await Promise.all([ecrituresDe(ent, '', ''), exercicesDe(ent)]);
    const presents = [...new Set([...toutes.map((e) => String(e.date).slice(0, 7)), ...ouverts.map((x) => String(x.du).slice(0, 7))])].sort();
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
  // La révision de chaque brouillard lu : on la renvoie pour le modifier ou le supprimer, et un
  // brouillard changé ailleurs entre-temps n'est jamais écrasé (01 R15).
  /** @type {Map<string, number>} */
  const revisions = new Map();
  // Une écriture du serveur, dans la forme du livre de la v10 (compta.js, `ajouterEcriture`) : son
  // numéro est son rang dans la chaîne des livres (validée), comme le numéro unique du livre v10.
  // Sa source : « saisie » quand le comptable l'a saisie (elle se modifie, se contre-passe,
  // s'extourne) ; « skanfact » quand elle est née d'une pièce de l'entreprise (elle suit sa pièce) ;
  // « an » pour des à-nouveaux.
  /** @param {string} ent @param {number} annee @param {any[]} ecritures */
  function versLeLivre(ent, annee, ecritures) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const livre = KC.livreVide(ent, annee);
    const parId = new Map(ecritures.map((e) => [e.id, e]));
    /** @param {any} e @returns {string} */
    const source = (e) => {
      if (e.journal === 'AN') return 'an';
      if (e.origine.type === 'saisie' || e.origine.type === 'extourne') return 'saisie';
      if (e.origine.type === 'contre_passation' && parId.has(e.origine.id)) return source(parId.get(e.origine.id));
      return 'skanfact';
    };
    /** @type {Map<string, { lettre: string, compte: string, ecritures: string[], le: string, par: string }>} */
    const lettrages = new Map();
    for (const e of ecritures) {
      revisions.set(e.id, e.revision);
      livre.ecritures.push({
        id: e.id, numero: e.chaine ?? null, date: e.date, journal: e.journal, piece: e.piece || '', libelle: e.libelle,
        source: source(e), mois: String(e.date).slice(0, 7), docId: e.origine.id, pieceJointe: null,
        statut: e.statut === 'validee' ? (e.contrepassee ? 'contrepassee' : 'validee') : 'brouillard',
        auteur: '', creeLe: 0, valideeLe: e.valideeLe ? Date.parse(e.valideeLe) : null,
        contrepasseDe: e.origine.type === 'contre_passation' ? e.origine.id : null,
        extourneDe: e.origine.type === 'extourne' ? e.origine.id : null, extourne: false, extourneeLe: null,
        lignes: e.lignes.map((/** @type {any} */ l) => ({
          compte: l.compte, tiersId: e.tiers, tiers: l.tiers || '', libelle: l.libelle, debit: nombre(l.debit), credit: nombre(l.credit), lettre: l.lettre || '',
        })),
      });
      for (const l of e.lignes) {
        KC.assurerCompte(livre, l.compte, l.libelle);
        if (!l.lettre) continue;
        const g = lettrages.get(l.lettre) || { lettre: String(l.lettre), compte: String(l.compte), ecritures: /** @type {string[]} */ ([]), le: '', par: '' };
        if (!g.ecritures.includes(e.id)) g.ecritures.push(e.id);
        lettrages.set(l.lettre, g);
      }
    }
    livre.lettrages = [...lettrages.values()];
    return livre;
  }
  // Le livre d'une année ; ses bornes sont celles de l'exercice ouvert sur le serveur, s'il l'est (un
  // premier exercice commence en cours d'année).
  /** @param {string} ent @param {string|number} annee @param {any[]} [lues] */
  const livreDe = async (ent, annee, lues) => {
    const livre = versLeLivre(ent, Number(annee), lues || await ecrituresDe(ent, `${annee}-01-01`, `${annee}-12-31`));
    const ex = exerciceDe(ent, annee);
    if (ex) { livre.exercice.du = ex.du; livre.exercice.au = ex.au; }
    return livre;
  };

  // Une écriture de la grille de saisie, pour le serveur : ses lignes remplies (la grille en garde
  // une vide au bout), ses montants en texte exact.
  /** @param {unknown} n */
  const montant = (n) => (Number(n) ? (Math.round(Number(n) * 1000) / 1000).toFixed(3) : '');
  /** @param {any} ec */
  function versLeServeur(ec) {
    return {
      date: String(ec.date || ''), journal: String(ec.journal || ''), piece: String(ec.piece || ''), libelle: String(ec.libelle || ''),
      lignes: (ec.lignes || []).filter((/** @type {any} */ l) => l && (String(l.compte || '').trim() || Number(l.debit) || Number(l.credit)))
        .map((/** @type {any} */ l) => ({ compte: String(l.compte || '').trim(), libelle: String(l.libelle || ''), tiers: String(l.tiers || ''), debit: montant(l.debit), credit: montant(l.credit) })),
    };
  }

  // La fiche : les champs de la liste, rien d'autre ; les honoraires en millimes.
  /** @param {string} ent @param {Record<string, unknown>} f @param {number | null} revision */
  async function poserFiche(ent, f, revision) {
    /** @type {Record<string, unknown>} */ const contenu = {};
    for (const k of TEXTES_FICHE) if (f[k] != null) contenu[k] = String(f[k]);
    if (f.archived != null) contenu.archived = !!f.archived;
    if (f.fees != null) contenu.fees = Math.round((Number(f.fees) || 0) * 1000);
    if (Array.isArray(f.relances)) contenu.relances = f.relances;
    await appel('PUT', `/cabinets/${cabinetId}/fiches/${ent}`, { contenu, revision });
  }

  // Un fichier choisi sur l'ordinateur (le navigateur ouvre sa fenêtre), ou null si on l'a fermée.
  /** @param {string} accepte @returns {Promise<File | null>} */
  const choisirFichier = (accepte) => new Promise((resoudre) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accepte;
    i.style.display = 'none';
    i.addEventListener('change', () => { resoudre((i.files && i.files[0]) || null); i.remove(); });
    i.addEventListener('cancel', () => { resoudre(null); i.remove(); });
    document.body.appendChild(i);
    i.click();
  });
  // Un classeur Excel (.xlsx) est une archive ZIP : ses fichiers XML se décompressent ici, dans le
  // navigateur, puis la v10 lit sa première feuille (compta.js, texteDeClasseur). Plus de 20 Mo pour
  // une entrée, ou de 60 Mo pour le classeur, se refuse : un petit fichier peut annoncer des gigaoctets.
  const MAX_ENTREE = 20 * 1024 * 1024;
  const MAX_CLASSEUR = 60 * 1024 * 1024;
  const TROP_GROS = 'Ce classeur est anormalement gros : refusé.';
  /** @param {Uint8Array} corps @param {number} permis ce que l'entrée peut encore occuper */
  async function inflater(corps, permis) {
    const lecteur = new Blob([new Uint8Array(corps)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    /** @type {Uint8Array[]} */ const morceaux = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.length;
      if (total > Math.min(MAX_ENTREE, permis)) { await lecteur.cancel(); throw new Error(TROP_GROS); }
      morceaux.push(value);
    }
    const tout = new Uint8Array(total);
    let o = 0;
    for (const m of morceaux) { tout.set(m, o); o += m.length; }
    return tout;
  }
  /** @param {Uint8Array} u8 */
  async function dezipper(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let fin = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65535; i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    if (fin < 0) return null;
    const n = dv.getUint16(fin + 10, true);
    if (n > 5000) return null;
    /** @type {{ name: string, data: () => Uint8Array }[]} */ const entrees = [];
    let p = dv.getUint32(fin + 16, true);
    let lu = 0;
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null;
      const methode = dv.getUint16(p + 10, true), taille = dv.getUint32(p + 20, true);
      const lnom = dv.getUint16(p + 28, true), lextra = dv.getUint16(p + 30, true), lcom = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nom = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + lnom));
      const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const corps = u8.subarray(debut, debut + taille);
      // Seuls les fichiers XML servent à lire une feuille : les images et le reste restent fermés.
      const data = /\.(xml|rels)$/.test(nom) ? (methode === 8 ? await inflater(corps, MAX_CLASSEUR - lu) : corps.slice()) : null;
      lu += data ? data.length : 0;
      entrees.push({ name: nom, data: () => { if (!data) throw new Error('entrée non lue'); return data; } });
      p += 46 + lnom + lextra + lcom;
    }
    return entrees;
  }
  // Le texte d'un tableur (Excel ou CSV), lu par la v10 ; son refus, avec le geste qui marche.
  /** @param {File} f */
  async function lireTableur(f) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const octets = new Uint8Array(await f.arrayBuffer());
    let entrees = null;
    // Une archive abîmée se lit comme la v10 le dit (« enregistre-le de nouveau ») ; un classeur trop
    // gros se refuse avec sa raison.
    if (octets[0] === 0x50 && octets[1] === 0x4b) {
      try { entrees = await dezipper(octets); } catch (e) { if (e instanceof Error && e.message === TROP_GROS) throw e; entrees = null; }
    }
    const r = KC.lireFichierTexte(octets, f.name, entrees ? { dezipper: () => entrees } : {});
    if (!r.ok) throw new Error(r.motif);
    return String(r.texte);
  }

  // Un fichier que le navigateur télécharge : la v10 l'enregistrait par sa fenêtre « Enregistrer ».
  /** @param {string} nom @param {string} contenu */
  function telecharger(nom, contenu) {
    const propre = String(nom || 'export.txt').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(new Blob([contenu], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = propre; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { path: propre };
  }
  // Le nom d'un fichier, formé comme la v10 le formait (cabstore.js, slug).
  /** @param {unknown} s */
  const slug = (s) => String(s || '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sans-nom';

  // ── Les écritures par tableur (brique 39 bis, C18) ─────────────────────────────────────────
  // Le texte d'un fichier lu, gardé le temps de la fenêtre : l'import le relit contre le livre du
  // serveur tel qu'il est au clic, comme la v10 relisait le fichier au second geste.
  /** @type {Map<string, string>} */
  const lectures = new Map();
  let lectureSuivante = 0;
  /** @param {number} n */
  const chiffre = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  // L'analyse de la v10 (compta.js, analyserImportEcritures), dite pour la plateforme : un brouillard
  // tombe juste sur le serveur (brique 38), donc une pièce qui ne tombe pas juste se refuse, nommée,
  // AVANT le clic (la v10 la faisait entrer au brouillard). Les comptes qui « entreront au plan » (le
  // plan du livre : les comptes que ses écritures portent) se recomptent sans elle : une pièce refusée
  // n'ajoute rien.
  /** @param {any} livre @param {string} texte */
  function analyser(livre, texte) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const a = KC.analyserImportEcritures(livre, texte);
    if (!a.ok) throw new Error(a.motif);
    const compteur = /** @type {Record<string, string>} */ ({ nouvelle: 'nouvelles', brouillard: 'brouillards', validee: 'validees' });
    for (const p of a.pieces) {
      const cle = compteur[p.action];
      if (!cle || KC.round3(p.ecart) === 0) continue;
      a.compte[cle]--;
      a.compte.refusees++;
      p.action = 'refusee';
      p.motif = `débit ${chiffre(p.debit)} ≠ crédit ${chiffre(p.credit)} : elle ne tombe pas juste — corrige-la dans ton tableur, puis réimporte-le`;
    }
    a.compte.desequilibrees = 0;
    const planAvant = new Set((livre.plan || []).map((/** @type {any} */ c) => String(c.compte)));
    a.comptesNouveaux = [...new Set(a.pieces.filter((/** @type {any} */ p) => ['nouvelle', 'brouillard', 'validee'].includes(p.action))
      .flatMap((/** @type {any} */ p) => p.lignes.map((/** @type {any} */ l) => String(l.compte))).filter((/** @type {string} */ c) => !planAvant.has(c)))].sort();
    return a;
  }
  // Une pièce du tableur, pour le serveur (ses montants en texte exact).
  /** @param {any} p */
  const pieceVersLeServeur = (p) => ({
    date: String(p.date), journal: String(p.journal), piece: String(p.piece || ''), libelle: String(p.libelle || ''),
    lignes: p.lignes.map((/** @type {any} */ l) => ({ compte: String(l.compte), libelle: String(l.libelle || ''), tiers: String(l.tiers || ''), debit: montant(l.debit), credit: montant(l.credit) })),
  });
  /** @param {any} p */
  const nomDePiece = (p) => `${p.journal || '?'} ${p.piece || '(sans pièce)'} du ${String(p.date || '').split('-').reverse().join('/')}`;

  // Ouvrir un lien que le navigateur confie à un autre logiciel (la messagerie, le téléphone) : un
  // lien cliqué, jamais une navigation qui quitterait l'écran.
  /** @param {string} url */
  const ouvrirLien = (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  // Les moyens d'une relance, ceux que le serveur garde (serveur/cabinet/routes.ts, RELANCE).
  const MOYENS = ['email', 'tel', 'whatsapp', 'autre'];

  // C4 (docs/cabinet.md) : ce qui n'a plus d'objet sans paquets ni fichier sur l'ordinateur. Les
  // panneaux des Réglages se cachent, leur pastille et leur résultat de recherche aussi ; la
  // palette ne les propose plus (adaptation). Du panneau Sécurité ne reste que « Verrouiller ».
  // L'exemple à six clients fictifs n'est pas en ligne ; la correspondance des comptes traduisait
  // les comptes d'un paquet importé : il n'y a plus d'import, et le client et son cabinet tiennent
  // les mêmes livres.
  const PANNEAUX_ABSENTS = ['pan-licence', 'pan-inbox', 'pan-backup', 'pan-maj', 'pan-exemple', 'pan-comptes'];
  // Les étapes de « Tes premiers pas » sans objet : la découverte sur l'exemple, l'appairage, la clé
  // de secours, la copie sur un disque. « Tenir un premier livre » revient avec la saisie (38 bis).
  const ETAPES_ABSENTES = ['decouverte', 'appairage', 'cle', 'copie'];
  // Les visites guidées que « Me guider » ne propose pas (adaptation de `visites`) : celles dont le
  // sujet a disparu avec les paquets (C4), et celles d'un geste pas encore en ligne, qui reviennent
  // avec leur brique.
  const VISITES_SANS_OBJET = ['decouvrir', 'appairage', 'cle-secours', 'copie-externe', 'recevoir-paquet', 'lire-paquet',
    'boite-reception', 'sauvegardes', 'changer-ordinateur', 'mises-a-jour', 'licence', 'mot-de-passe', 'envoyer-cloture',
    'correspondance', 'page-dossier-paquets'];
  const VISITES_PAS_ENCORE = [
    'nommer-cabinet', // la fiche du cabinet ne s'enregistre pas encore en ligne
    'exporter-ecritures', // l'export des écritures de tous les clients : brique 41
    'suivre-production', // le tableau de production
  ];
  // Les articles de l'Aide sans objet en ligne : les sauvegardes, changer d'ordinateur, la licence,
  // les mises à jour (le serveur garde les livres ; rien à installer).
  const ARTICLES_ABSENTS = ['filets', 'demenager', 'licence', 'maj'];
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
    visitesAbsentes: [...VISITES_SANS_OBJET, ...VISITES_PAS_ENCORE],
    articlesAbsents: ARTICLES_ABSENTS,
    // Pas de clé de secours en ligne (C4) : le Cabinet ne la réclame jamais (adaptation de chargerRecovery).
    sansCleDeSecours: true,
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
    // Une année sans écriture et sans exercice ouvert n'a pas encore de livre : l'écran propose de le
    // commencer (son exercice, sa balance d'ouverture).
    livre: async (/** @type {string} */ id, /** @type {string} */ annee) => {
      const d = dossiers.get(id) || { id, name: '', matricule: '' };
      const [ecritures] = await Promise.all([ecrituresDe(id, `${annee}-01-01`, `${annee}-12-31`), exercicesDe(id)]);
      if (!ecritures.length && !exerciceDe(id, annee)) return { dossier: d, livre: null };
      return { dossier: d, livre: await livreDe(id, annee, ecritures) };
    },
    // L'exercice est-il ouvert sur le serveur ? (L'écran propose sinon d'en reprendre les soldes.)
    exerciceOuvert: (/** @type {string} */ id, /** @type {string} */ annee) => !!exerciceDe(id, annee),

    // ── La reprise (brique 39) : l'exercice s'ouvre sur le serveur, avec sa balance d'ouverture ──
    reprendre: async (/** @type {any} */ o) => {
      const ouverture = (o.ouverture || []).map((/** @type {any} */ l) => ({
        compte: String(l.compte || '').trim(), libelle: String(l.libelle || ''), debit: montant(l.debit), credit: montant(l.credit),
      }));
      await appel('POST', `/entreprises/${o.dossierId}/compta/exercices`, { annee: Number(o.annee), ...(o.du ? { du: String(o.du) } : {}), ouverture });
      await exercicesDe(o.dossierId);
      return { livre: await livreDe(o.dossierId, o.annee) };
    },
    // Une balance d'ouverture lue dans un classeur Excel ou un CSV, choisi sur l'ordinateur : la
    // lecture est celle de la v10 (compta.js) ; rien ne part au serveur avant que la fenêtre l'envoie
    // (« Créer le livre », « Ouvrir l'exercice »), et seulement ses lignes.
    importerBalance: async () => {
      const f = await choisirFichier('.xlsx,.csv,.txt');
      if (!f) return { annule: true };
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const r = KC.balanceDepuisCsv(KC.rangeesDeTexte(await lireTableur(f)));
      if (r.motif) throw new Error(r.motif);
      return { lignes: r.lignes, ignorees: r.ignorees, fichier: f.name };
    },

    // ── Les fichiers du livre (brique 39 bis) : le tableau CSV (le BOM que la v10 posait, pour Excel
    // en français) et le fichier des écritures (FEC), téléchargés par le navigateur ; rien ne part au
    // serveur.
    exportCsv: async (/** @type {string} */ texte, /** @type {string} */ nom) => telecharger(`${slug(nom || 'dossiers')}.csv`, `\uFEFF${String(texte || '')}`),
    exportFec: async (/** @type {string} */ texte, /** @type {string} */ nom) => telecharger(String(nom || 'FEC.txt').split(/[\\/]/).pop() || 'FEC.txt', String(texte || '')),
    // Réimporter depuis un tableur : le fichier choisi est lu dans le navigateur et comparé au livre
    // du serveur (l'analyse de la v10) ; la fenêtre dit ce que l'import fera avant d'écrire quoi que ce soit.
    lireEcrituresTableur: async (/** @type {string} */ id, /** @type {string} */ annee) => {
      const f = await choisirFichier('.xlsx,.csv,.txt');
      if (!f) return { annule: true };
      const texte = await lireTableur(f);
      const analyse = analyser(await livreDe(id, annee), texte);
      const cle = String(++lectureSuivante);
      lectures.set(cle, texte);
      return { fichier: cle, nom: f.name, analyse };
    },
    // Puis l'import : les pièces nouvelles et les brouillards corrigés partent en lots (chacune entre,
    // ou est nommée avec sa raison) ; une validée que le fichier change se corrige à part, si on l'a
    // demandé : sa contre-passation et sa version corrigée, d'un geste. Ce que le serveur refuse se dit.
    importerEcrituresTableur: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ cle, /** @type {boolean} */ corriger) => {
      const texte = lectures.get(String(cle));
      if (texte === undefined) throw new Error('Ce fichier n\'est plus ouvert : choisis-le de nouveau.');
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
      const livre = await livreDe(id, annee);
      const a = analyser(livre, texte);
      /** @type {{ ajoutees: number, remplacees: number, corrigees: number, identiques: number, refusees: any[], validees: any[], desequilibrees: any[], comptesNouveaux: string[] }} */
      const out = { ajoutees: 0, remplacees: 0, corrigees: 0, identiques: 0, refusees: [], validees: [], desequilibrees: [], comptesNouveaux: [] };
      /** @type {{ p: any, piece: any }[]} */ const envois = [];
      for (const p of a.pieces) {
        if (p.action === 'identique') out.identiques++;
        else if (p.action === 'refusee') out.refusees.push({ nom: nomDePiece(p), lignes: p.lignes_csv, motif: p.motif });
        else if (p.action === 'nouvelle') envois.push({ p, piece: { ecriture: pieceVersLeServeur(p) } });
        else if (p.action === 'brouillard') envois.push({ p, piece: { ecriture: pieceVersLeServeur(p), remplace: { id: p.cibleId, revision: revisions.get(p.cibleId) ?? 1 } } });
        else if (p.action === 'validee' && !corriger) out.validees.push({ nom: nomDePiece(p), numero: p.cibleNumero, lignes: p.lignes_csv });
      }
      for (let i = 0; i < envois.length; i += 500) {
        const tranche = envois.slice(i, i + 500);
        const r = await appel('POST', `/entreprises/${id}/compta/ecritures/lot`, { pieces: tranche.map((x) => x.piece) });
        (r.resultats || []).forEach((/** @type {any} */ x, /** @type {number} */ k) => {
          const p = tranche[k]?.p;
          if (x.statut === 'ajoutee') out.ajoutees++;
          else if (x.statut === 'remplacee') out.remplacees++;
          else out.refusees.push({ nom: nomDePiece(p), lignes: p?.lignes_csv, motif: x.motif });
        });
      }
      if (corriger) {
        for (const p of a.pieces.filter((/** @type {any} */ x) => x.action === 'validee')) {
          const cible = (livre.ecritures || []).find((/** @type {any} */ e) => e.id === p.cibleId) || {};
          try {
            await appel('POST', `/entreprises/${id}/compta/ecritures/${p.cibleId}/corriger`, { date: KC.dateDuMiroir(livre, cible, K.today()), ecriture: pieceVersLeServeur(p) });
            out.corrigees++;
          } catch (e) { out.refusees.push({ nom: nomDePiece(p), lignes: p.lignes_csv, motif: e instanceof Error ? e.message : String(e) }); }
        }
      }
      lectures.delete(String(cle));
      return { ...out, livre: await livreDe(id, annee) };
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

    // ── Les relances (brique 38 bis) : le message s'ouvre dans la messagerie (ou WhatsApp), et la
    // relance se note dans la fiche du dossier, sur le serveur (C15) ─────────────────────────────
    mail: async (/** @type {any} */ m) => {
      /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
      const u = K.mailtoUrl({ to: m.to, bcc: Array.isArray(m.bcc) ? m.bcc : [], subject: m.subject, body: m.body });
      ouvrirLien(u.url);
      return { state: 'mailto', bccInclus: u.bccInclus, montre: false };
    },
    tel: async (/** @type {any} */ o) => {
      const n = String((o && o.number) || '').replace(/[^\d+]/g, '');
      if (!n) throw new Error('Ce dossier n\'a pas de numéro de téléphone.');
      if (o.whatsapp) window.open(`https://wa.me/${n.replace(/^\+/, '')}${o.text ? `?text=${encodeURIComponent(o.text)}` : ''}`, '_blank', 'noopener');
      else ouvrirLien(`tel:${n}`);
      return true;
    },
    noteRelance: async (/** @type {string} */ id, /** @type {string[]} */ months, /** @type {string} */ via, /** @type {string} */ note) => {
      if (!dossiers.has(id)) throw new Error('Dossier introuvable.');
      const f = fiches.get(id);
      /** @type {Record<string, unknown>} */ const avant = f ? depuisFiche(f.contenu) : {};
      const deja = Array.isArray(avant.relances) ? avant.relances : [];
      const relance = {
        at: Date.now(), via: MOYENS.includes(via) ? via : 'autre', note: String(note || '').slice(0, 500),
        months: (months || []).filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m))).slice(0, 120),
      };
      await poserFiche(id, { ...avant, relances: [...deja, relance].slice(-50) }, f ? f.revision : null);
      return construireEtat();
    },

    // ── La saisie (brique 38) : chaque geste va au serveur, puis le livre se relit ─────────────
    saisir: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {any} */ ec) => {
      const r = await appel('POST', `/entreprises/${id}/compta/ecritures`, versLeServeur(ec));
      return { ok: true, id: r.id, livre: await livreDe(id, annee) };
    },
    modifierEcriture: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ ecriture, /** @type {any} */ patch) => {
      await appel('PUT', `/entreprises/${id}/compta/ecritures/${ecriture}`, { ...versLeServeur(patch), revision: revisions.get(ecriture) ?? 1 });
      return { ok: true, id: ecriture, livre: await livreDe(id, annee) };
    },
    supprimerEcriture: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ ecriture) => {
      await appel('DELETE', `/entreprises/${id}/compta/ecritures/${ecriture}?revision=${revisions.get(ecriture) ?? 1}`);
      return { ok: true, livre: await livreDe(id, annee) };
    },
    valider: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ ecriture) => {
      const r = await appel('POST', `/entreprises/${id}/compta/ecritures/valider`, { ids: [ecriture] });
      if (!r.validees.length) throw new Error((r.refusees[0] && r.refusees[0].motif) || 'Cette écriture n\'a pas été validée.');
      return { ok: true, numero: r.validees[0].chaine, livre: await livreDe(id, annee) };
    },
    // Un lot : les brouillards du journal, du mois ou de la sélection, lus dans le livre du serveur ;
    // chacun validé ou nommé avec la raison de son refus (compta.js, validerLot).
    validerLot: async (/** @type {any} */ o) => {
      const avant = await livreDe(o.dossierId, o.annee);
      const ids = o.ids ? new Set(o.ids) : null;
      const cibles = avant.ecritures.filter((/** @type {any} */ e) => e.statut === 'brouillard' && (!o.journal || e.journal === o.journal)
        && (!o.mois || String(e.date).slice(0, 7) === o.mois) && (!ids || ids.has(e.id)));
      /** @type {any[]} */ const validees = [];
      /** @type {any[]} */ const refusees = [];
      for (let i = 0; i < cibles.length; i += 500) {
        const r = await appel('POST', `/entreprises/${o.dossierId}/compta/ecritures/valider`, { ids: cibles.slice(i, i + 500).map((/** @type {any} */ e) => e.id) });
        validees.push(...r.validees);
        refusees.push(...r.refusees);
      }
      const de = (/** @type {string} */ x) => cibles.find((/** @type {any} */ e) => e.id === x) || {};
      return {
        ok: true, candidates: cibles.length, livre: await livreDe(o.dossierId, o.annee),
        validees: validees.map((v) => ({ id: v.id, numero: v.chaine, piece: de(v.id).piece, journal: de(v.id).journal, date: de(v.id).date })),
        refusees: refusees.map((v) => ({ id: v.id, piece: de(v.id).piece, journal: de(v.id).journal, date: de(v.id).date, motif: v.motif, motifs: [v.motif] })),
      };
    },
    // Le jour du miroir : celui que l'écran a annoncé (compta.js, dateDuMiroir : jamais hors de
    // l'exercice affiché ni avant l'écriture) ; le serveur le repousse au premier jour ouvert si la
    // période est close, et le dit.
    contrepasser: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ ecriture, /** @type {string} */ date) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(id, annee);
      const e = livre.ecritures.find((/** @type {any} */ x) => x.id === ecriture);
      const jour = e ? KC.dateDuMiroir(livre, e, date) : date;
      const r = await appel('POST', `/entreprises/${id}/compta/ecritures/${ecriture}/contrepasser`, jour ? { date: jour } : {});
      return { ok: true, numero: r.chaine, date: r.date, livre: await livreDe(id, annee) };
    },
    extourner: async (/** @type {string} */ id, /** @type {string} */ annee, /** @type {string} */ ecriture) => {
      const r = await appel('POST', `/entreprises/${id}/compta/ecritures/${ecriture}/extourner`, {});
      return { ok: true, numero: r.chaine, date: r.date, livre: await livreDe(id, annee) };
    },
    // Le lettrage automatique : la règle de la v10 (compta.js, lettrageAuto : une paire qui se solde
    // sans ambiguïté, entre écritures validées), calculée sur le livre du serveur ; chaque paire est
    // posée par le serveur, qui refait le contrôle et choisit la lettre.
    lettrageAuto: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const r = KC.lettrageAuto(livre, o.compte, { jours: o.jours, par: 'auto', date: new Date().toISOString().slice(0, 10) });
      /** @type {any[]} */ const poses = [];
      for (const p of r.poses) {
        const l = await appel('POST', `/entreprises/${o.dossierId}/compta/lettrages`, { compte: String(o.compte), ecritures: p.ecritures });
        poses.push({ ...p, lettre: l.lettre });
      }
      return { ok: true, poses, restent: r.restent, livre: await livreDe(o.dossierId, o.annee) };
    },
    lettrer: async (/** @type {any} */ o) => {
      if (o.delettrer) {
        await appel('DELETE', `/entreprises/${o.dossierId}/compta/lettrages/${encodeURIComponent(String(o.lettre || ''))}`);
        return { ok: true, livre: await livreDe(o.dossierId, o.annee) };
      }
      const l = await appel('POST', `/entreprises/${o.dossierId}/compta/lettrages`, { compte: String(o.compte), ecritures: o.ids || [], ...(o.lettre ? { lettre: String(o.lettre) } : {}) });
      return { ok: true, lettre: l.lettre, livre: await livreDe(o.dossierId, o.annee) };
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
