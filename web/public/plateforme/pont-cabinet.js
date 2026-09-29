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
    if (methode !== 'GET') gestesFaits++;
    return lu;
  }
  // Les gestes enregistrés depuis l'ouverture : la piste d'audit du livre en porte autant (brique 45).
  // Les écrans du Cabinet se relisent quand elle s'allonge (la déclaration, la révision, la liasse,
  // l'exercice : `revDuLivre`) ; vide, ils gardaient leurs contrôles d'avant une validation.
  let gestesFaits = 0;

  // ── L'état du cabinet : le cabinet, son portefeuille, la personne qui travaille ────────────
  /** @type {Map<string, { id: string, name: string, matricule: string, manual: boolean }>} */
  const dossiers = new Map();
  // Les réglages du cabinet (0023) : les banques et les mots retenus, et leur révision.
  /** @type {{ contenu: Record<string, any>, revision: number | null }} */
  let reglages = { contenu: {}, revision: null };
  // Les réglages de la v10 que le serveur garde (serveur/cabinet/routes.ts, REGLAGES ; briques 41 et 47).
  const REGLAGES_V10 = ['formatCopie', 'relanceDay', 'deadlines', 'saisie', 'theme', 'depots', 'regimes'];
  // La fiche de chaque dossier au cabinet (0020) : son contenu et sa révision.
  /** @type {Map<string, { contenu: Record<string, unknown>, revision: number | null }>} */
  const fiches = new Map();
  // Les champs de la fiche : ceux que le serveur garde (serveur/cabinet/routes.ts, FICHE).
  const TEXTES_FICHE = ['email', 'phone', 'contact', 'note', 'regime', 'tvaPeriod', 'from', 'cnssEmployeur', 'cnssCode'];
  /** @param {Record<string, unknown>} c */
  const depuisFiche = (c) => ({ ...c, fees: Number(c.fees || 0) / 1000 });
  // Les mois des cinq dernières années (le plafond du Cabinet v10, MAX_MOIS_ATTENDUS).
  const debutDesMois = () => `${new Date().getUTCFullYear() - 5}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`;
  async function construireEtat() {
    /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
    const depuis = debutDesMois();
    const [moi, mes, porte, lues, mois, regles, eq] = await Promise.all([appel('GET', '/moi'), appel('GET', '/cabinets'), appel('GET', `/cabinets/${cabinetId}/portefeuille`),
      appel('GET', `/cabinets/${cabinetId}/fiches`), appel('GET', `/cabinets/${cabinetId}/mois?depuis=${depuis}`), appel('GET', `/cabinets/${cabinetId}/reglages`),
      appel('GET', `/cabinets/${cabinetId}/equipe`)]);
    equipeLue = { membres: eq.membres || [], invitations: eq.invitations || [], affectations: eq.affectations || [] };
    mandats.clear();
    for (const d of porte.dossiers || []) mandats.set(d.entreprise, d.mandat);
    reglages = { contenu: regles.contenu || {}, revision: regles.revision ?? null };
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
      dossiers.set(d.entreprise, { id: d.entreprise, name: d.raisonSociale, matricule: d.matriculeFiscal || '', manual: !!d.tenu });
      // Un dossier tenu est le « dossier créé à la main » de la v10 : un client hors SkanFact.
      const fiche = fiches.get(d.entreprise);
      return K.migrateDossier({ ...(fiche ? depuisFiche(fiche.contenu) : {}), id: d.entreprise, name: d.raisonSociale, matricule: d.matriculeFiscal || '', manual: !!d.tenu,
        packs: moisVersPaquets(K, (mois.mois || []).filter((/** @type {any} */ x) => x.entreprise === d.entreprise)) });
    });
    // L'équipe (brique 46) : chaque membre du cabinet est un collaborateur de la v10 (son rôle, son
    // adresse à la place du poste) ; les dossiers confiés sont les droits posés sur chaque dossier.
    const utilisateurDuMembre = new Map(equipeLue.membres.map((/** @type {any} */ m) => [m.membre, m.utilisateur]));
    for (const d of liste) {
      d.droits = Object.fromEntries(equipeLue.affectations.filter((/** @type {any} */ a) => a.entreprise === d.id && utilisateurDuMembre.has(a.membre))
        .map((/** @type {any} */ a) => [utilisateurDuMembre.get(a.membre), VERS_V10[a.role] || 'saisie']));
    }
    // La fiche et les réglages du cabinet (brique 47) : ceux que le serveur garde, remis à la v10 qui
    // les complète de ses valeurs par défaut (`migrate`).
    const c = reglages.contenu;
    /** @type {Record<string, unknown>} */ const settings = {};
    for (const k of REGLAGES_V10) if (c[k] !== undefined && c[k] !== null) settings[k] = c[k];
    const etat = K.migrate({ cabinet: { name: cab.nom, email: String(c.email || ''), phone: String(c.phone || '') }, dossiers: liste, settings });
    etat.collaborateurs = equipeLue.membres.map((/** @type {any} */ m) => ({ id: m.utilisateur, nom: m.nom, role: VERS_V10[m.roles[0]] || 'saisie', actif: true, poste: m.email, creeLe: null }));
    // Ce que la banque apprend pour tous les clients du cabinet (0023) : la v10 le gardait dans son état.
    etat.banques = reglages.contenu.banques || {};
    etat.libelles = reglages.contenu.libelles || [];
    // Le modèle de liasse du cabinet (brique 41 ter) ; vide : celui que la v10 propose.
    etat.liasse = reglages.contenu.liasse || [];
    // La méthode de révision du cabinet (brique 44) : son questionnaire et ses cycles ; vides, ceux de la v10.
    etat.questionnaire = reglages.contenu.questionnaire || [];
    etat.cycles = reglages.contenu.cycles || [];
    nomDuCabinet = String(cab.nom || '');
    moiNom = String(moi.nom || '');
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

  // L'index des livres de chaque dossier (brique 48 ; docs/cabinet.md, C38), dans la forme que la v10
  // rangeait à côté de chaque livre (cabstore.js, productionDuLivre) : ce que le serveur compte pour
  // tout le portefeuille, en une fois. Un mois qui a une écriture, une déclaration ou une révision
  // existe ; « révisé » et « déclaré » y valent non tant que rien ne les pose. Chaque année a son
  // exercice — ouvert au serveur, sinon celui du calendrier — : c'est lui qui donne ses mois à un
  // dossier tenu au cabinet.
  async function indexDesLivres() {
    const p = await appel('GET', `/cabinets/${cabinetId}/production?depuis=${debutDesMois()}`);
    /** @type {Map<string, Record<string, any>>} */ const parDossier = new Map();
    /** @param {string} ent @param {string} m */
    const mois = (ent, m) => {
      if (!parDossier.has(ent)) parDossier.set(ent, {});
      const x = /** @type {Record<string, any>} */ (parDossier.get(ent));
      return (x[m] = x[m] || { ecritures: 0, validees: 0, brouillards: 0, revise: false, declare: false, qui: '', depuis: null });
    };
    for (const m of p.mois || []) Object.assign(mois(m.entreprise, m.mois), { ecritures: m.ecritures, validees: m.validees, brouillards: m.brouillards, qui: m.qui, depuis: Date.parse(m.depuis) || null });
    for (const d of p.declarations || []) mois(d.entreprise, d.periode).declare = !!d.deposee;
    for (const r of p.revisions || []) mois(r.entreprise, r.periode).revise = !!r.faite;
    /** @type {Map<string, Map<number, any>>} */ const exercices = new Map();
    /** @param {string} ent @param {number} a */
    const exercice = (ent, a) => {
      if (!exercices.has(ent)) exercices.set(ent, new Map());
      const x = /** @type {Map<number, any>} */ (exercices.get(ent));
      if (!x.has(a)) x.set(a, { annee: a, du: `${a}-01-01`, au: `${a}-12-31`, clos: false, production: {} });
      return x.get(a);
    };
    for (const x of p.exercices || []) Object.assign(exercice(x.entreprise, Number(x.annee)), { du: x.du, au: x.au, clos: !!x.clos });
    for (const [ent, prod] of parDossier) for (const [m, x] of Object.entries(prod)) exercice(ent, Number(m.slice(0, 4))).production[m] = x;
    /** @type {Record<string, { exercices: any[] }>} */ const index = {};
    for (const [ent, x] of exercices) index[ent] = { exercices: [...x.values()].sort((a, b) => a.annee - b.annee) };
    return index;
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
  /** @type {Map<string, { annee: number, du: string, au: string, ouverture: string | null, closLe: string | null, closPar: string | null, reouvertures: any[] }[]>} */
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
          ligneId: l.id, compte: l.compte, tiersId: e.tiers, tiers: l.tiers || '', libelle: l.libelle, debit: nombre(l.debit), credit: nombre(l.credit), lettre: l.lettre || '',
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
    const [ecritures, releves, declarations, biens, inventaire, revisionsLues, questions] = await Promise.all([lues || ecrituresDe(ent, `${annee}-01-01`, `${annee}-12-31`), relevesDe(ent, annee),
      declarationsDe(ent, annee), immobilisationsDe(ent), inventaireDe(ent, annee), revisionsDe(ent, annee), questionsDe(ent, annee)]);
    const livre = versLeLivre(ent, Number(annee), ecritures);
    const ex = exerciceDe(ent, annee);
    if (ex) {
      livre.exercice.du = ex.du; livre.exercice.au = ex.au;
      // La clôture (brique 45) : qui, quand, et chaque réouverture avec son motif.
      livre.exercice.clos = !!ex.closLe;
      livre.exercice.closLe = ex.closLe ? Date.parse(ex.closLe) : null;
      livre.exercice.closPar = ex.closPar || '';
      livre.exercice.reouvertures = (ex.reouvertures || []).map((/** @type {any} */ x) => ({ le: Date.parse(x.le) || 0, par: x.par || '', motif: x.motif, closLe: Date.parse(x.closLe) || 0 }));
    }
    livre.releves = releves;
    livre.declarations = declarations;
    livre.immobilisations = biens;
    livre.inventaires = inventaire ? [inventaire] : [];
    livre.revisions = revisionsLues;
    livre.questions = questions;
    livre.audit = new Array(gestesFaits);
    return livre;
  };
  // Les révisions d'une année (brique 44), celles du cabinet : l'exercice et ses mois, dans la forme de
  // la v10 (compta.js, revisionVide), et la révision de chacune pour la réécrire sans rien écraser.
  /** @type {Map<string, number>} */
  const revisionsRevision = new Map();
  /** @param {string} ent @param {string|number} annee */
  async function revisionsDe(ent, annee) {
    const r = await appel('GET', `/cabinets/${cabinetId}/revisions/${ent}?annee=${Number(annee)}`);
    return (r.revisions || []).map((/** @type {any} */ x) => {
      revisionsRevision.set(`${ent}/${x.periode}`, x.revision);
      return { periode: x.periode, ...x.contenu };
    });
  }
  // Les questions au client d'une année (brique 44), dans la forme de la v10 (compta.js, ajouterQuestion) :
  // les statuts sont les siens ; chaque envoi, son instant ; la réponse, celle que le client a écrite.
  /** @param {string} ent @param {string|number} annee */
  async function questionsDe(ent, annee) {
    const r = await appel('GET', `/entreprises/${ent}/compta/questions?annee=${Number(annee)}`);
    return (r.questions || []).map((/** @type {any} */ q) => ({
      id: q.id, creeLe: Date.parse(q.poseeLe) || 0, creePar: '', periode: q.periode, cycle: q.cycle, compte: q.compte,
      ecritureId: q.ecriture || '', piece: q.piece, numero: null, montant: nombre(q.montant), objet: q.objet, texte: q.texte, attendu: q.attendu,
      statut: q.statut, envois: (q.envois || []).map((/** @type {string} */ d) => Date.parse(d) || 0),
      reponse: q.reponse ? { texte: q.reponse, le: Date.parse(q.reponduLe) || 0, piece: null } : null,
      closeLe: q.closeLe ? Date.parse(q.closeLe) || 0 : null, closePar: '',
    }));
  }
  // Les cycles du cabinet ; aucun : les sept de la v10 (jamais un mélange des deux).
  const cyclesDuCabinet = () => {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    return (reglages.contenu.cycles || []).length ? reglages.contenu.cycles : KC.CYCLES_REVISION;
  };
  // Un geste de révision : la fonction de la v10 sur le livre du serveur (ses refus, mot pour mot),
  // puis la révision de la période, entière, au serveur.
  /** @param {any} o @param {(KC: any, livre: any, periode: string) => any} faire */
  async function reviser(o, faire) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const livre = await livreDe(o.dossierId, o.annee);
    const periode = String(o.periode || o.annee);
    const r = faire(KC, livre, periode);
    if (!r.ok) throw new Error(r.motif || (r.motifs || []).join(' '));
    const x = KC.revisionDe(livre, periode);
    const contenu = {
      faite: !!x.faite, faiteLe: x.faiteLe || null, faitePar: String(x.faitePar || ''),
      comptes: x.comptes.map((/** @type {any} */ c) => ({ compte: String(c.compte), revuLe: Number(c.revuLe) || 0, revuPar: String(c.revuPar || ''), note: String(c.note || '') })),
      notes: x.notes.map((/** @type {any} */ n) => ({ id: String(n.id), texte: String(n.texte), cycle: String(n.cycle || ''), compte: String(n.compte || ''), par: String(n.par || ''),
        le: Number(n.le) || 0, levee: !!n.levee, leveeLe: n.leveeLe || null, leveePar: String(n.leveePar || '') })),
      questionnaire: x.questionnaire.map((/** @type {any} */ q) => ({ id: String(q.id), question: String(q.question), reponse: String(q.reponse || ''), par: String(q.par || ''), le: q.le || null })),
    };
    const cle = `${o.dossierId}/${periode}`;
    await appel('PUT', `/cabinets/${cabinetId}/revisions/${o.dossierId}/${periode}`, { contenu, revision: revisionsRevision.get(cle) ?? null });
    return { ...r, livre: await livreDe(o.dossierId, o.annee) };
  }
  // Le livre de l'année d'après, s'il existe (des écritures, ou un exercice ouvert) ; sinon rien.
  /** @param {string} ent @param {number} annee */
  async function livreSiIlExiste(ent, annee) {
    const [ecritures] = await Promise.all([ecrituresDe(ent, `${annee}-01-01`, `${annee}-12-31`), exercicesDe(ent)]);
    return ecritures.length || exerciceDe(ent, annee) ? livreDe(ent, annee, ecritures) : null;
  }
  // L'inventaire d'une année (brique 42 bis), dans la forme de la v10 : son total est celui que le
  // serveur a calculé ; l'écriture de variation, tant qu'elle vaut encore.
  /** @param {string} ent @param {string|number} annee */
  async function inventaireDe(ent, annee) {
    const r = await appel('GET', `/entreprises/${ent}/compta/inventaires/${Number(annee)}`);
    const x = r.inventaire;
    if (!x) return null;
    return {
      id: `inv_${x.annee}`, date: x.date, compte: x.compte, total: nombre(x.total), saisiLe: 0, par: '', ecritureId: x.ecriture || '',
      lignes: x.lignes.map((/** @type {any} */ l) => {
        const quantite = nombre(l.quantite), cout = nombre(l.cout);
        return { ref: l.ref, libelle: l.libelle, quantite, cout, valeur: Math.round(quantite * cout * 1000) / 1000 };
      }),
    };
  }
  // Les biens de l'entreprise (brique 42), dans la forme de la v10 : une fiche par bien pour toute la
  // vie de l'entreprise, son plan recalculé par la v10, chaque année écrite retenant l'écriture qui
  // porte sa dotation ou sa sortie (le serveur ne rend que celles qui valent encore).
  /** @type {Map<string, number>} */
  const revisionsImmo = new Map();
  /** @param {string} ent */
  async function immobilisationsDe(ent) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const r = await appel('GET', `/entreprises/${ent}/compta/immobilisations`);
    return (r.immobilisations || []).map((/** @type {any} */ x) => {
      revisionsImmo.set(x.id, x.revision);
      const f = x.fiche;
      const fiche = {
        id: x.id, libelle: f.libelle, compte: f.compte, compteAmort: f.compteAmort, compteDotation: f.compteDotation,
        dateAcquisition: f.dateAcquisition, dateMiseEnService: f.dateMiseEnService,
        valeur: nombre(f.valeur), residuelle: nombre(f.residuelle), tva: nombre(f.tva), methode: f.methode, duree: nombre(f.duree),
        tauxDegressif: f.tauxDegressif === null ? null : nombre(f.tauxDegressif), bascule: !!f.bascule, prorata: 'jours360',
        subvention: f.subvention ? { ...f.subvention, montant: nombre(f.subvention.montant) } : null,
        cession: f.cession ? { ...f.cession, prix: nombre(f.cession.prix) } : null,
        origine: f.origine, creeLe: 0, par: '',
        plan: (x.ecritures || []).map((/** @type {any} */ l) => ({ annee: l.annee, ecritureId: l.ecriture })),
      };
      fiche.plan = KC.planDuBien(fiche);
      return fiche;
    });
  }
  // Une fiche de la v10, pour le serveur : les champs de la liste (serveur/compta/immobilisations.ts),
  // les montants en texte exact.
  /** @param {any} f */
  const ficheVersLeServeur = (f) => ({
    libelle: String(f.libelle || ''), compte: String(f.compte || ''), compteAmort: String(f.compteAmort || ''), compteDotation: String(f.compteDotation || ''),
    dateAcquisition: String(f.dateAcquisition || f.dateMiseEnService || ''), dateMiseEnService: String(f.dateMiseEnService || f.dateAcquisition || ''),
    valeur: signe(f.valeur), residuelle: signe(f.residuelle), tva: signe(f.tva), methode: String(f.methode || 'lineaire'), duree: String(Number(f.duree) || 0),
    tauxDegressif: f.tauxDegressif == null || f.tauxDegressif === '' ? null : String(Number(f.tauxDegressif)), bascule: !!f.bascule,
    subvention: f.subvention && Number(f.subvention.montant)
      ? { montant: signe(f.subvention.montant), compte: String(f.subvention.compte || ''), compteReprise: String(f.subvention.compteReprise || '') } : null,
    cession: f.cession && f.cession.date ? { date: String(f.cession.date), prix: signe(f.cession.prix), motif: f.cession.motif === 'rebut' ? 'rebut' : 'cession' } : null,
    origine: { source: String((f.origine || {}).source || 'saisie').slice(0, 20), docId: String((f.origine || {}).docId || '').slice(0, 100), mois: String((f.origine || {}).mois || '').slice(0, 7) },
  });
  // Les déclarations préparées d'une année (brique 41), dans la forme de la v10 : chaque case porte son
  // montant (ou null : elle ne se savait pas) ; l'écriture liée, tant qu'elle existe et n'est pas
  // contre-passée.
  /** @param {string} ent @param {string|number} annee */
  async function declarationsDe(ent, annee) {
    const r = await appel('GET', `/entreprises/${ent}/compta/declarations?annee=${Number(annee)}`);
    return (r.declarations || []).map((/** @type {any} */ d) => ({
      id: d.id, type: d.type, periode: d.periode, prepareeLe: Date.parse(d.prepareeLe) || 0, par: d.par || '',
      cases: Object.fromEntries(Object.entries(d.cases || {}).map(([k, v]) => [k, { montant: v === null ? null : nombre(/** @type {string} */ (v)) }])),
      controles: [], deposee: d.deposee, payee: d.payee, ecritureId: d.ecriture || '',
    }));
  }
  // Les retraitements et le taux d'impôt d'une année (brique 41 ter), dans la forme de la v10 : les
  // montants en dinars, le taux en pourcentage (null : pas saisi).
  /** @param {string} ent @param {string|number} annee */
  async function annuelDe(ent, annee) {
    const r = await appel('GET', `/entreprises/${ent}/compta/annuel/${Number(annee)}`);
    return {
      retraitements: (r.retraitements || []).map((/** @type {any} */ x) => ({ id: x.id, nature: x.nature, libelle: x.libelle, montant: nombre(x.montant) })),
      tauxImpot: r.tauxImpot == null ? null : Number(r.tauxImpot), revision: r.revision ?? null,
    };
  }
  // ── La paie d'un client (brique 43) : ses salariés et ses bulletins sont ceux de SON dossier ───────
  // (`employees`, `payslips`), les mêmes que son SkanFact écrit ; le serveur recalcule chaque bulletin
  // et tient l'écriture de paie du mois. Un nombre non entier part en texte exact, comme le point de
  // contact de l'entreprise l'écrit (pont.js).
  /** @param {unknown} v @returns {unknown} */
  function encoder(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : (Number.isFinite(v) ? { '~n': String(v) } : null);
    if (Array.isArray(v)) return v.map(encoder);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && typeof x !== 'function').map(([k, x]) => [k, encoder(x)]));
    return v;
  }
  /** @param {unknown} v @returns {unknown} */
  function decoder(v) {
    if (Array.isArray(v)) return v.map(decoder);
    if (v && typeof v === 'object') {
      const cles = Object.keys(v);
      if (cles.length === 1 && cles[0] === '~n') return Number(/** @type {any} */ (v)['~n']);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]));
    }
    return v;
  }
  // Les objets de paie lus, par dossier : leur révision et leur rang, pour les réécrire sans rien écraser.
  /** @type {Map<string, Map<string, { collection: string, cle: string, rang: number | null, revision: number, contenu: any }>>} */
  const paieLue = new Map();
  /** @param {string} ent */
  async function paieDe(ent) {
    const r = await appel('GET', `/entreprises/${ent}/paie/dossier`);
    const objets = (r.objets || []).map((/** @type {any} */ o) => ({ ...o, contenu: decoder(o.contenu) }));
    paieLue.set(ent, new Map(objets.map((/** @type {any} */ o) => [`${o.collection}/${o.cle}`, o])));
    return objets;
  }
  // Un salarié du dossier (la forme de l'entreprise) → celui du Cabinet v10, et retour.
  /** @param {any} e */
  const salarieDe = (e) => ({
    id: e.id, nom: e.name || '', cin: e.cin || '', cnss: e.cnss || '', identiteCnss: e.identiteCnss || '', poste: e.position || '',
    contrat: e.contract || 'cdi', embauche: e.hireDate || '', sortie: e.endDate || '', brut: Number(e.grossSalary) || 0,
    chefDeFamille: !!e.headOfFamily, enfants: Number(e.children) || 0, actif: e.active !== false, note: e.notes || '',
  });
  /** @param {any} s @param {any} avant */
  const employeDe = (s, avant) => ({
    method: 'virement', iban: '', ...(avant || {}), id: s.id, name: s.nom, cin: s.cin, cnss: s.cnss, identiteCnss: s.identiteCnss, position: s.poste,
    contract: s.contrat, hireDate: s.embauche, endDate: s.sortie, grossSalary: s.brut, headOfFamily: s.chefDeFamille, children: s.enfants,
    active: s.actif !== false, notes: s.note,
  });
  /** @param {any} p @param {string | null} ecritureId */
  const bulletinDe = (p, ecritureId) => {
    const c = p.computed || {};
    return {
      id: p.id, salarieId: p.employeeId, annee: Number(p.year), mois: Number(p.month),
      brut: Number(p.gross ?? c.baseGross) || 0, joursTravailles: Number(p.workedDays ?? c.workedDays) || 26, joursAbsence: Number(p.absentDays ?? c.absentDays) || 0,
      primes: p.bonuses || c.bonuses || [], retenues: p.deductions || c.deductions || [], calcul: c, payeLe: p.paidDate || '',
      ecritureId, creeLe: 0, auteur: '',
    };
  };
  /** @param {any} b @param {any} avant */
  const fichePayeDe = (b, avant) => ({
    accountId: '', method: 'virement', reference: '', ...(avant || {}), id: b.id, employeeId: b.salarieId, year: b.annee, month: b.mois,
    gross: b.brut, workedDays: b.joursTravailles, absentDays: b.joursAbsence, bonuses: b.primes, deductions: b.retenues, computed: b.calcul,
    paidDate: b.payeLe || '', issuedAt: (avant && avant.issuedAt) || new Date().toISOString().slice(0, 10),
  });
  // Le livre d'une année et sa paie : les salariés, les bulletins de l'année, et pour chacun l'écriture
  // de paie de son mois, que le serveur tient (journal PAIE, au dernier jour du mois).
  /** @param {string} ent @param {string|number} annee */
  async function livreEtPaie(ent, annee) {
    const [livre, objets] = await Promise.all([livreDe(ent, annee), paieDe(ent)]);
    /** @param {string} mois */
    const ecritureDuMois = (mois) => ((livre.ecritures || []).find((/** @type {any} */ e) => e.journal === 'PAIE' && String(e.date).slice(0, 7) === mois && e.statut !== 'contrepassee') || {}).id || null;
    livre.salaries = objets.filter((/** @type {any} */ o) => o.collection === 'employees').map((/** @type {any} */ o) => salarieDe(o.contenu));
    livre.bulletins = objets.filter((/** @type {any} */ o) => o.collection === 'payslips' && Number(o.contenu.year) === Number(annee))
      .map((/** @type {any} */ o) => bulletinDe(o.contenu, ecritureDuMois(`${o.contenu.year}-${String(o.contenu.month).padStart(2, '0')}`)));
    return livre;
  }
  // Écrire un objet de paie dans le dossier du client, dans la révision qu'on a lue.
  /** @param {string} ent @param {string} collection @param {string} cle @param {any} contenu */
  async function ecrirePaieDuDossier(ent, collection, cle, contenu) {
    const avant = (paieLue.get(ent) || new Map()).get(`${collection}/${cle}`);
    await appel('POST', `/entreprises/${ent}/paie/dossier`, { changements: [{
      collection, cle, rang: avant ? avant.rang : null, revision: avant ? avant.revision : null, contenu: contenu === null ? null : encoder(contenu),
    }] });
  }
  // L'objet de paie tel que le dossier le garde (pour ne rien perdre de ce que l'entreprise y met).
  /** @param {string} ent @param {string} collection @param {string} cle */
  const paieAvant = (ent, collection, cle) => ((paieLue.get(ent) || new Map()).get(`${collection}/${cle}`) || {}).contenu || null;
  // Sur la plateforme, l'écriture de paie SUIT les bulletins (le serveur la réécrit) : modifier ou
  // supprimer un bulletin d'un mois déjà écrit n'est plus refusé, comme la v10 le refusait.
  /** @param {any} livre */
  const sansEcritures = (livre) => ({ ...livre, bulletins: (livre.bulletins || []).map((/** @type {any} */ b) => ({ ...b, ecritureId: null })) });
  // Les cases d'une déclaration que le serveur garde (compta.cases_declaration, 0024).
  const CASES_DECLARATION = ['tvaCollectee', 'tvaDeductible', 'creditReporte', 'netAPayer', 'creditAReporter', 'timbre', 'retenuesOperees',
    'retenuesSubies', 'irpp', 'aDecaisser', 'tfp', 'foprolos', 'tcl', 'acomptes'];
  // La déclaration d'un mois, DÉDUITE du livre du serveur par le moteur de la v10 (compta.js), comme le
  // processus principal de la v10 la déduisait : jamais un chiffre saisi à côté du livre.
  /** @param {string} ent @param {string|number} annee @param {string} periode */
  async function declarationDuLivre(ent, annee, periode) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    const livre = await livreDe(ent, annee);
    const d = KC.declarationMensuelle(livre, periode);
    if (!d.ok) throw new Error(d.motif);
    return { KC, livre, d };
  }
  // Les relevés bancaires rangés dans le livre d'une année (brique 40), dans la forme de la v10 : ce qui
  // répond à une ligne est une écriture et le RANG de sa ligne ; un jugement de l'automatique qui n'a
  // pas tranché se garde sur la ligne (« probable », « à confirmer »).
  /** @param {string} ent @param {string|number} annee */
  async function relevesDe(ent, annee) {
    const r = await appel('GET', `/entreprises/${ent}/compta/releves?annee=${Number(annee)}`);
    return (r.releves || []).map((/** @type {any} */ x) => ({
      id: x.id, compte: x.compte, banque: x.banque, du: x.du, au: x.au, soldeDebut: nombre(x.soldeDebut), soldeFin: nombre(x.soldeFin),
      fichier: x.fichier, empreinte: x.empreinte, importeLe: x.importeLe, par: '',
      lignes: x.lignes.map((/** @type {any} */ l) => ({
        id: l.id, date: l.date, libelle: l.libelle, reference: l.reference, montant: nombre(l.montant), ecritureId: '',
        rapprochement: l.rapprochement
          ? { niveau: l.rapprochement.niveau, ecritureId: l.rapprochement.ecriture, ligne: l.rapprochement.rang - 1, le: l.rapprochement.le || '', par: l.rapprochement.auto ? 'auto' : '' }
          : { niveau: l.niveau, ecritureId: '', ligne: -1, le: '', par: l.niveau === 'aucun' ? '' : 'auto' },
      })),
    }));
  }
  // La ligne d'écriture (son identifiant au serveur) que désignent une écriture et le rang d'une de ses lignes.
  /** @param {any} livre @param {string} ecritureId @param {number} i */
  const ligneDuLivre = (livre, ecritureId, i) => {
    const e = (livre.ecritures || []).find((/** @type {any} */ x) => x.id === ecritureId);
    const l = e && e.lignes[Number(i)];
    if (!l || !l.ligneId) throw new Error('Cette écriture n\'existe pas.');
    return String(l.ligneId);
  };
  // Un montant signé en texte exact (les soldes et les mouvements d'un relevé, au sens de la banque).
  /** @param {unknown} n */
  const signe = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);
  // Les fichiers de relevé lus, gardés le temps de la fenêtre (« Relire avec cette association »).
  /** @type {Map<string, { texte: string, empreinte: string }>} */
  const lecturesReleve = new Map();

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
    const bq = /** @type {any} */ (f.banque);
    if (bq && typeof bq === 'object') {
      contenu.banque = { ...(bq.compte ? { compte: String(bq.compte) } : {}), ...(bq.banque ? { banque: String(bq.banque) } : {}),
        ...(bq.jours != null && bq.jours !== '' ? { jours: Number(bq.jours) } : {}) };
    }
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
    'equipe', // la personne invitée rejoint le cabinet chez elle, en ouvrant le lien : la visite se réécrira pour l'invitation
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
  let nomDuCabinet = '';
  // L'équipe du cabinet lue au serveur (brique 46), et le mandat de chaque dossier.
  /** @type {{ membres: any[], invitations: any[], affectations: any[] }} */
  let equipeLue = { membres: [], invitations: [], affectations: [] };
  /** @type {Map<string, string>} */
  const mandats = new Map();
  // Les rôles de la v10 et ceux du serveur : « Saisie et validation » est le collaborateur (03 § 3).
  /** @type {Record<string, string>} */
  const VERS_V10 = { supervision: 'supervision', revision: 'validation', saisie: 'saisie', paie: 'saisie' };
  /** @type {Record<string, string>} */
  const VERS_SERVEUR = { supervision: 'supervision', validation: 'revision', saisie: 'saisie' };
  /** @param {string} utilisateur */
  const membreDe = (utilisateur) => (equipeLue.membres.find((m) => m.utilisateur === utilisateur) || {}).membre;
  // Le nom de qui travaille : la v10 signe les comptes, les notes et le questionnaire de ce nom.
  let moiNom = '';
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
    // Les écritures de TOUS les clients d'une période, en un fichier (brique 41 bis) : le plan de la v10
    // (cabcore.js, ecrituresPlan : les mois où chaque client a des écritures), les livres lus au
    // serveur, les colonnes du livre-journal de SkanFact, et le regroupement de la v10 (mergeEcritures :
    // Client, Matricule, Mois devant chaque ligne). Rien ne part au serveur.
    exportEcritures: async (/** @type {any} */ o = {}) => {
      /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
      const plan = K.ecrituresPlan(await construireEtat(), o);
      if (!plan.packs.length) throw new Error('Aucune écriture sur cette période.');
      const du = `${plan.mois[0]}-01`;
      const fin = String(plan.mois.at(-1));
      const au = new Date(Date.UTC(Number(fin.slice(0, 4)), Number(fin.slice(5, 7)), 0)).toISOString().slice(0, 10);
      /** @type {Map<string, any[]>} */ const livres = new Map();
      for (const id of new Set(plan.packs.map((/** @type {any} */ p) => p.id))) livres.set(id, await ecrituresDe(id, du, au));
      const tete = ['N°', 'Date', 'Journal', 'Pièce', 'Compte', 'Tiers', 'Libellé', 'Débit', 'Crédit', 'Lettrage', 'État'];
      const etatDe = (/** @type {any} */ e) => (e.statut !== 'validee' ? 'brouillard' : e.contrepassee ? 'contre-passée' : 'validée');
      const sources = plan.packs.map((/** @type {any} */ p) => {
        const lignes = (livres.get(p.id) || []).filter((e) => String(e.date).startsWith(p.month)).flatMap((e) => e.lignes.map((/** @type {any} */ l) => K.toCsvLine([
          e.chaine ?? '', K.csvDate(e.date), e.journal, e.piece || '', l.compte, l.tiers || '', l.libelle || e.libelle,
          K.csvMontant(nombre(l.debit)), K.csvMontant(nombre(l.credit)), l.lettre || '', etatDe(e)])));
        return { name: p.name, matricule: p.matricule, month: p.month, csv: [K.toCsvLine(tete), ...lignes].join('\r\n') };
      });
      const out = K.mergeEcritures(sources);
      const periode = plan.mois.length > 1 ? `${plan.mois[0]}_${fin}` : plan.mois[0];
      const f = telecharger(`ecritures-${slug(nomDuCabinet || 'cabinet')}-${periode}.csv`, out.csv);
      return { path: f.path, lignes: out.lignes, dossiers: out.dossiers, vides: out.vides, illisibles: [], mois: plan.mois };
    },
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

    // ── La banque (brique 40, C19 à C21) : le relevé se lit dans le navigateur (le lecteur de la v10),
    // son empreinte est celle de ses octets ; l'import, les rapprochements et les réglages vont au
    // serveur, qui refait chaque contrôle. L'automatique juge comme la v10, puis pose au serveur.
    lireReleve: async (/** @type {any} */ o = {}) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      let cle = String((o && o.chemin) || '');
      let lu = lecturesReleve.get(cle);
      if (!lu) {
        const f = await choisirFichier('.xlsx,.csv,.txt');
        if (!f) return { annule: true };
        const octets = new Uint8Array(await f.arrayBuffer());
        const empreinte = [...new Uint8Array(await crypto.subtle.digest('SHA-256', octets))].map((b) => b.toString(16).padStart(2, '0')).join('');
        lu = { texte: await lireTableur(f), empreinte };
        cle = `${++lectureSuivante}/${f.name}`;
        lecturesReleve.set(cle, lu);
      }
      return { ...KC.releveDepuisCsv(KC.rangeesDeTexte(lu.texte), (o && o.assoc) || null), fichier: cle, empreinte: lu.empreinte };
    },
    ajouterReleve: async (/** @type {any} */ o) => {
      const r = o.releve || {};
      const cree = await appel('POST', `/entreprises/${o.dossierId}/compta/releves`, {
        annee: Number(o.annee), compte: String(r.compte || '').trim(), banque: String(r.banque || '').slice(0, 60),
        fichier: String(r.fichier || '').split('/').pop()?.slice(0, 200) || '', empreinte: String(r.empreinte || ''),
        soldeDebut: signe(r.soldeDebut), soldeFin: signe(r.soldeFin),
        lignes: (r.lignes || []).map((/** @type {any} */ l) => ({ date: String(l.date), libelle: String(l.libelle || '').slice(0, 500), reference: String(l.reference || '').slice(0, 100), montant: signe(l.montant) })),
      });
      const livre = await livreDe(o.dossierId, o.annee);
      return { ok: true, releve: (livre.releves || []).find((/** @type {any} */ x) => x.id === cree.id), livre };
    },
    supprimerReleve: async (/** @type {any} */ o) => {
      await appel('DELETE', `/entreprises/${o.dossierId}/compta/releves/${o.id}`);
      return { ok: true, ecrituresGardees: 0, livre: await livreDe(o.dossierId, o.annee) };
    },
    rapprocher: async (/** @type {any} */ o) => {
      const c = o.choix || {};
      const pose = c.ecritureId
        ? { ligne: o.ligneId, ecritureLigne: ligneDuLivre(await livreDe(o.dossierId, o.annee), c.ecritureId, c.ligne), niveau: c.niveau || 'certain', auto: false }
        : { ligne: o.ligneId, ecritureLigne: null, niveau: 'aucun', auto: false };
      await appel('POST', `/entreprises/${o.dossierId}/compta/releves/${o.releveId}/rapprochements`, { poses: [pose] });
      return { ok: true, niveau: pose.niveau, livre: await livreDe(o.dossierId, o.annee) };
    },
    rapprocherAuto: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
      const livre = await livreDe(o.dossierId, o.annee);
      const R = (livre.releves || []).find((/** @type {any} */ x) => x.id === o.releveId);
      const poses0 = new Set(R ? R.lignes.filter((/** @type {any} */ l) => l.rapprochement.ecritureId).map((/** @type {any} */ l) => l.id) : []);
      const r = KC.rapprocherAuto(livre, o.releveId, { jours: o.jours, date: K.today() });
      if (!r.ok) throw new Error(r.motif);
      // Ce que l'automatique a jugé des lignes qu'il pouvait juger : posé (certain), ou gardé (le reste).
      const poses = R.lignes.filter((/** @type {any} */ l) => !poses0.has(l.id)).map((/** @type {any} */ l) => (l.rapprochement.ecritureId
        ? { ligne: l.id, ecritureLigne: ligneDuLivre(livre, l.rapprochement.ecritureId, l.rapprochement.ligne), niveau: 'certain', auto: true }
        : { ligne: l.id, ecritureLigne: null, niveau: l.rapprochement.niveau, auto: true }));
      for (let i = 0; i < poses.length; i += 5000) {
        await appel('POST', `/entreprises/${o.dossierId}/compta/releves/${o.releveId}/rapprochements`, { poses: poses.slice(i, i + 5000) });
      }
      return { ...r, livre: await livreDe(o.dossierId, o.annee) };
    },
    derapprocher: async (/** @type {any} */ o) => {
      const r = await appel('POST', `/entreprises/${o.dossierId}/compta/releves/${o.releveId}/derapprocher`, {});
      return { ok: true, defaits: r.defaits, livre: await livreDe(o.dossierId, o.annee) };
    },
    // Les banques (l'association des colonnes) et les mots retenus : les réglages du cabinet ; le compte
    // bancaire d'un dossier : sa fiche.
    saveBanque: async (/** @type {any} */ o = {}) => {
      if ((o.banques && typeof o.banques === 'object') || Array.isArray(o.libelles)) {
        const contenu = { ...reglages.contenu };
        if (o.banques && typeof o.banques === 'object') contenu.banques = o.banques;
        if (Array.isArray(o.libelles)) contenu.libelles = o.libelles;
        const r = await appel('PUT', `/cabinets/${cabinetId}/reglages`, { contenu, revision: reglages.revision });
        reglages = { contenu, revision: r.revision };
      }
      if (o.dossierId && dossiers.has(o.dossierId)) {
        const f = fiches.get(o.dossierId);
        await poserFiche(o.dossierId, { ...(f ? depuisFiche(f.contenu) : {}), banque: o.banque || {} }, f ? f.revision : null);
      }
      return construireEtat();
    },

    // La fiche du cabinet (brique 47) : son nom (un associé le change), son adresse et son téléphone, et
    // les réglages de la v10 (la forme d'un montant copié, le jour des relances, les échéances, la
    // saisie, le thème, les régimes, les échéances pointées), gardés dans les réglages du cabinet.
    // Les règles de fusion sont celles du processus principal de la v10 (cab:saveCabinet) : l'identité
    // ne change que FOURNIE ; un jour de relance hors bornes garde l'ancien ; les échéances, la saisie
    // (touche par touche), le thème et la forme d'un montant se fusionnent ; les régimes et les
    // échéances pointées se REMPLACENT (retirer, dépointer sont des gestes) ; puis `migrate` normalise.
    saveCabinet: async (/** @type {any} */ c = {}) => {
      const nom = c.name === undefined ? nomDuCabinet : String(c.name || '').trim();
      // Vérifié avant d'écrire quoi que ce soit : rien ne part si le nom est vide.
      if (!nom) throw new Error('Donne un nom à ton cabinet : il signe tes relances.');
      const p = c.settings || {};
      if (Object.keys(p).some((k) => !REGLAGES_V10.includes(k))) throw new Error(PAS_EN_LIGNE);
      /** @type {Record<string, any>} */ const s = {};
      for (const k of REGLAGES_V10) if (reglages.contenu[k] !== undefined && reglages.contenu[k] !== null) s[k] = reglages.contenu[k];
      if (c.settings) {
        const jour = Number(p.relanceDay);
        if (jour >= 1 && jour <= 28) s.relanceDay = Math.round(jour);
        if (p.deadlines) s.deadlines = { ...(s.deadlines || {}), ...p.deadlines };
        if (Array.isArray(p.regimes)) s.regimes = p.regimes;
        if (p.saisie) s.saisie = { ...(s.saisie || {}), ...p.saisie, touches: { ...((s.saisie || {}).touches || {}), ...(p.saisie.touches || {}) } };
        if (p.theme) s.theme = String(p.theme);
        if (p.formatCopie) s.formatCopie = String(p.formatCopie);
        if (Array.isArray(p.depots)) s.depots = p.depots;
      }
      const normal = /** @type {any} */ (window).CabCore.migrate({ cabinet: {}, dossiers: [], settings: s }).settings;
      /** @type {Record<string, unknown>} */ const contenu = { ...reglages.contenu };
      if (c.email !== undefined) contenu.email = String(c.email || '').trim();
      if (c.phone !== undefined) contenu.phone = String(c.phone || '').trim();
      for (const k of Object.keys(s)) contenu[k] = normal[k];
      if (JSON.stringify(contenu) !== JSON.stringify(reglages.contenu)) {
        const r = await appel('PUT', `/cabinets/${cabinetId}/reglages`, { contenu, revision: reglages.revision });
        reglages = { contenu, revision: r.revision };
      }
      // Le nom en dernier : seul un associé le change, le reste est à toute l'équipe.
      if (nom !== nomDuCabinet) await appel('PUT', `/cabinets/${cabinetId}/nom`, { nom });
      return construireEtat();
    },

    // ── La déclaration du mois (brique 41) : calculée par la v10 sur le livre du serveur ; préparée,
    // pointée et écrite au serveur, qui refait ses contrôles (0024) ──
    declaration: async (/** @type {any} */ o) => {
      const { KC, livre, d } = await declarationDuLivre(o.dossierId, o.annee, o.periode);
      const posee = (livre.declarations || []).find((/** @type {any} */ x) => x.periode === d.periode) || null;
      return { ...d, posee, formulaire: KC.formulaireMensuel(livre, d) };
    },
    poserDeclaration: async (/** @type {any} */ o) => {
      const { KC, livre, d } = await declarationDuLivre(o.dossierId, o.annee, o.periode);
      // Le refus de la v10 d'abord (une déclaration déposée ne se refait pas), mot pour mot ; le serveur le refait.
      const essai = KC.poserDeclaration(livre, d, '', Date.now());
      if (!essai.ok) throw new Error(essai.motif);
      /** @type {Record<string, string | null>} */ const cases = {};
      for (const k of CASES_DECLARATION) {
        const c = d.cases[k];
        if (c) cases[k] = c.montant == null ? null : signe(c.montant);
      }
      await appel('PUT', `/entreprises/${o.dossierId}/compta/declarations/${d.periode}`, { cases });
      const apres = await livreDe(o.dossierId, o.annee);
      return { ok: true, declaration: apres.declarations.find((/** @type {any} */ x) => x.periode === d.periode), livre: apres };
    },
    pointerDeclaration: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      // Les refus de la v10, dont l'écart : on ne pointe pas un dépôt sur des chiffres qui ont changé.
      const essai = KC.pointerDeclaration(livre, o.periode, o.quoi, o.valeur, '', Date.now());
      if (!essai.ok) throw new Error(essai.motif);
      const v = o.valeur || null;
      const r = await appel('POST', `/entreprises/${o.dossierId}/compta/declarations/${o.periode}/pointer`,
        { quoi: o.quoi, le: v ? String(v.le || '') : null, ...(v && v.reference ? { reference: String(v.reference) } : {}) });
      const apres = await livreDe(o.dossierId, o.annee);
      return { ok: true, declaration: apres.declarations.find((/** @type {any} */ x) => x.periode === o.periode), aussiPayee: !!r.aussiPayee, livre: apres };
    },
    // L'écriture du mois entre au BROUILLARD ; déjà passée, seul ce qui lui MANQUE se pose (le
    // complément de la v10), jamais une seconde écriture entière.
    ecrireDeclaration: async (/** @type {any} */ o) => {
      const { KC, livre, d } = await declarationDuLivre(o.dossierId, o.annee, o.periode);
      if (!(livre.declarations || []).some((/** @type {any} */ x) => x.periode === d.periode)) throw new Error('Prépare la déclaration avant d\'en écrire l\'écriture.');
      const url = `/entreprises/${o.dossierId}/compta/declarations/${d.periode}/ecriture`;
      if (d.ecritureExistante) {
        const complement = KC.ecritureComplementDeclaration(livre, d);
        if (!complement) throw new Error('L\'écriture de cette déclaration existe déjà dans le livre : la repasser compterait la TVA du mois deux fois.');
        const r = await appel('POST', url, { ecriture: versLeServeur(complement), complement: true });
        return { ok: true, id: r.id, complement: true, livre: await livreDe(o.dossierId, o.annee) };
      }
      if (d.rienAEcrire) throw new Error(KC.MOTIF_RIEN_A_ECRIRE);
      const r = await appel('POST', url, { ecriture: versLeServeur(KC.ecritureDeclaration(livre, d)) });
      return { ok: true, id: r.id, livre: await livreDe(o.dossierId, o.annee) };
    },

    // ── La liasse et l'annuel (brique 41 ter) : déduits par la v10 du livre du serveur ; les
    // retraitements et le taux d'impôt de l'année au serveur (0025) ; le modèle de liasse, un réglage
    // du cabinet ──
    liasse: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const [livre, annuel] = await Promise.all([livreDe(o.dossierId, o.annee), annuelDe(o.dossierId, o.annee)]);
      const lignes = KC.lignesDuLivre(livre, { du: livre.exercice.du, au: livre.exercice.au });
      const libelle = (/** @type {string} */ c) => ((livre.plan || []).find((/** @type {any} */ p) => p.compte === c) || {}).libelle || KC.libelleDuPlan(c) || '';
      const modele = (reglages.contenu.liasse || []).length ? KC.migrerModeleLiasse(reglages.contenu.liasse) : KC.MODELE_LIASSE;
      const liasse = KC.liasseDepuisLignes(lignes, KC.soldesDepuisOuverture(livre), { libelle, modele });
      return {
        ok: true, liasse,
        fiscal: KC.resultatFiscal(liasse.resultat, annuel.retraitements, { taux: annuel.tauxImpot }),
        employeur: KC.employeurAnnuel(livre, {}),
        retraitements: annuel.retraitements, tauxImpot: annuel.tauxImpot,
        natures: KC.RETRAITEMENTS, modele, etats: KC.LIASSE_ETATS, clos: false,
      };
    },
    fiscalAnnuel: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const annuel = await annuelDe(o.dossierId, o.annee);
      /** @type {Record<string, unknown>} */ const corps = { revision: annuel.revision };
      if (Array.isArray(o.retraitements)) {
        // Les refus de la v10, mot pour mot, avant d'écrire ; le serveur les refait.
        const mauvais = o.retraitements.map((/** @type {any} */ r) => KC.retraitementValide(r)).filter((/** @type {any} */ v) => !v.ok);
        if (mauvais.length) throw new Error(mauvais[0].motifs.join(' '));
        corps.retraitements = o.retraitements.map((/** @type {any} */ r) => ({
          id: String(r.id || ''), nature: String(r.nature || ''), libelle: String(r.libelle || '').slice(0, 200), montant: signe(r.montant),
        }));
      }
      if (o.tauxImpot !== undefined) {
        const t = String(o.tauxImpot == null ? '' : o.tauxImpot).trim();
        const n = Number(t.replace(',', '.'));
        if (t && (!isFinite(n) || n < 0 || n > 100)) throw new Error('Le taux d\'impôt se donne en pourcentage, entre 0 et 100.');
        corps.tauxImpot = t || null;
      }
      await appel('PUT', `/entreprises/${o.dossierId}/compta/annuel/${Number(o.annee)}`, corps);
      return { ok: true, livre: await livreDe(o.dossierId, o.annee) };
    },
    // Le modèle de liasse vit au niveau du cabinet (on l'ajuste une fois pour tous ses clients) : les
    // rubriques que la v10 garde, rien d'autre.
    saveLiasse: async (/** @type {any} */ o = {}) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      if (Array.isArray(o.modele)) {
        const liasse = o.modele.map((/** @type {any} */ r) => ({
          id: String(r.id || '').trim(), etat: String(r.etat || '').trim(), label: String(r.label || '').trim(),
          comptes: (Array.isArray(r.comptes) ? r.comptes : []).map((/** @type {unknown} */ c) => String(c).trim()).filter(Boolean),
          signe: Number(r.signe) === -1 ? -1 : 1, deduit: !!r.deduit, charge: !!r.charge, resultat: !!r.resultat, deuxSens: !!r.deuxSens,
        })).filter((/** @type {any} */ r) => r.id && r.label && KC.LIASSE_ETATS.some((/** @type {any} */ e) => e.id === r.etat));
        const contenu = { ...reglages.contenu, liasse };
        const r = await appel('PUT', `/cabinets/${cabinetId}/reglages`, { contenu, revision: reglages.revision });
        reglages = { contenu, revision: r.revision };
      }
      return construireEtat();
    },

    // ── Les immobilisations (brique 42) : le plan de la v10, les fiches et les dotations au serveur (0026) ──
    immobilisations: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      return { etat: KC.etatImmobilisations(livre, o.annee), aCreer: KC.immobilisationsACreer(livre, o.annee), aEcrire: KC.ecrituresImmobilisations(livre, o.annee), fiches: livre.immobilisations };
    },
    saveImmobilisation: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const existe = !!(o.fiche && o.fiche.id && livre.immobilisations.some((/** @type {any} */ x) => x.id === o.fiche.id));
      // Les refus de la v10 d'abord, mot pour mot (une dotation écrite que le changement rendrait fausse) ; le serveur les refait.
      const r = existe ? KC.modifierImmobilisation(livre, o.fiche.id, o.fiche, '', Date.now()) : KC.ajouterImmobilisation(livre, { ...o.fiche, id: '' }, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      const corps = { fiche: ficheVersLeServeur(r.fiche) };
      const dit = existe
        ? await appel('PUT', `/entreprises/${o.dossierId}/compta/immobilisations/${r.fiche.id}`, { ...corps, revision: revisionsImmo.get(r.fiche.id) })
        : await appel('POST', `/entreprises/${o.dossierId}/compta/immobilisations`, corps);
      const apres = await livreDe(o.dossierId, o.annee);
      return { ok: true, fiche: apres.immobilisations.find((/** @type {any} */ x) => x.id === dit.id), livre: apres };
    },
    supprimerImmobilisation: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const r = KC.supprimerImmobilisation(livre, o.id, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      await appel('DELETE', `/entreprises/${o.dossierId}/compta/immobilisations/${o.id}?revision=${revisionsImmo.get(o.id)}`);
      return { ok: true, livre: await livreDe(o.dossierId, o.annee) };
    },
    // Les dotations, reprises de subvention et sorties de l'année, au BROUILLARD, chacune liée à son bien.
    ecrireDotations: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const props = KC.ecrituresImmobilisations(livre, o.annee);
      if (!props.length) throw new Error('Rien à passer : aucune dotation ni sortie en attente sur cet exercice.');
      const r = await appel('POST', `/entreprises/${o.dossierId}/compta/immobilisations/ecrire`, {
        annee: Number(o.annee), pieces: props.map((/** @type {any} */ p) => ({ immobilisation: p.immoId, genre: p.genre, ecriture: versLeServeur(p) })),
      });
      return { ok: true, ids: r.ids, livre: await livreDe(o.dossierId, o.annee) };
    },

    // ── L'inventaire de stock (brique 42 bis) : la variation de la v10, l'inventaire au serveur (0027) ──
    inventaire: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      return { inventaire: livre.inventaires[0] || null, variation: KC.variationDeStock(livre, o.annee) };
    },
    saveInventaire: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      // Les refus de la v10 d'abord, mot pour mot (un inventaire dont la variation est passée) ; le serveur les refait.
      const r = KC.poserInventaire(livre, o.inventaire, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      /** @param {unknown} n */
      const quantite = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);
      await appel('PUT', `/entreprises/${o.dossierId}/compta/inventaires/${Number(o.annee)}`, {
        date: r.inventaire.date, compte: r.inventaire.compte,
        lignes: r.inventaire.lignes.map((/** @type {any} */ l) => ({ ref: String(l.ref || '').slice(0, 60), libelle: String(l.libelle || ''), quantite: quantite(l.quantite), cout: signe(l.cout) })),
      });
      const apres = await livreDe(o.dossierId, o.annee);
      return { ok: true, inventaire: apres.inventaires[0] || null, livre: apres };
    },
    // La variation de stock de l'année, au BROUILLARD, liée à l'inventaire.
    ecrireVariationStock: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const v = KC.variationDeStock(livre, o.annee);
      if (!v.ok) throw new Error(v.motif);
      if (!v.ecriture) throw new Error(v.motif || 'Le stock compté est celui des comptes : aucune écriture à passer.');
      const inv = livre.inventaires[0];
      if (inv && inv.ecritureId) throw new Error('La variation de stock de cet exercice est déjà passée : la repasser compterait le stock deux fois.');
      const r = await appel('POST', `/entreprises/${o.dossierId}/compta/inventaires/${Number(o.annee)}/variation`, { ecriture: versLeServeur(v.ecriture) });
      return { ok: true, id: r.id, livre: await livreDe(o.dossierId, o.annee) };
    },

    // ── La paie (brique 43) : les salariés et les bulletins du dossier du client ──
    paie: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreEtPaie(o.dossierId, o.annee);
      const m = Number(o.mois) || 1;
      const bulletins = KC.bulletinsDuMois(livre, o.annee, m);
      return {
        salaries: livre.salaries, bulletins, masse: KC.masseSalariale(bulletins),
        annee: KC.masseSalariale(livre.bulletins.filter((/** @type {any} */ b) => Number(b.annee) === Number(o.annee))),
        controles: KC.controlesPaie(livre, o.annee, m), aEcrire: bulletins.some((/** @type {any} */ b) => !b.ecritureId), baremes: KC.baremesPaie({}),
      };
    },
    saveSalarie: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreEtPaie(o.dossierId, o.annee);
      const r = KC.ajouterSalarie(livre, o.salarie, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      await ecrirePaieDuDossier(o.dossierId, 'employees', r.salarie.id, employeDe(r.salarie, paieAvant(o.dossierId, 'employees', r.salarie.id)));
      return { ok: true, salarie: r.salarie, livre: await livreEtPaie(o.dossierId, o.annee) };
    },
    retirerSalarie: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreEtPaie(o.dossierId, o.annee);
      const r = KC.retirerSalarie(livre, o.id, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      const s = livre.salaries.find((/** @type {any} */ x) => x.id === o.id);
      await ecrirePaieDuDossier(o.dossierId, 'employees', o.id, employeDe(s, paieAvant(o.dossierId, 'employees', o.id)));
      return { ok: true, livre: await livreEtPaie(o.dossierId, o.annee) };
    },
    saveBulletin: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = sansEcritures(await livreEtPaie(o.dossierId, o.annee));
      const r = KC.ajouterBulletin(livre, o.bulletin, {}, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      await ecrirePaieDuDossier(o.dossierId, 'payslips', r.bulletin.id, fichePayeDe(r.bulletin, paieAvant(o.dossierId, 'payslips', r.bulletin.id)));
      return { ok: true, bulletin: r.bulletin, livre: await livreEtPaie(o.dossierId, o.annee) };
    },
    supprimerBulletin: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = sansEcritures(await livreEtPaie(o.dossierId, o.annee));
      const r = KC.supprimerBulletin(livre, o.id, '', Date.now());
      if (!r.ok) throw new Error(r.motif);
      await ecrirePaieDuDossier(o.dossierId, 'payslips', o.id, null);
      return { ok: true, livre: await livreEtPaie(o.dossierId, o.annee) };
    },
    // L'écriture de paie du mois : le serveur la tient au fil des bulletins (en totaux du mois).
    ecrirePaie: async (/** @type {any} */ o) => {
      const livre = await livreEtPaie(o.dossierId, o.annee);
      const mois = `${o.annee}-${String(o.mois).padStart(2, '0')}`;
      const b = livre.bulletins.find((/** @type {any} */ x) => `${x.annee}-${String(x.mois).padStart(2, '0')}` === mois && x.ecritureId);
      if (!b) throw new Error('Ce mois n\'a pas de bulletin : il n\'y a pas d\'écriture de paie à passer.');
      return { ok: true, id: b.ecritureId, livre };
    },
    cnss: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      return KC.cnssDuTrimestre(await livreEtPaie(o.dossierId, o.annee), o.annee, o.trimestre);
    },
    // Le fichier de télédéclaration des salaires du trimestre (brique 49 ; docs/cabinet.md, C39) : le
    // moteur de la v10 (compta.js, fichierCnssDuLivre) sur le livre et la paie du dossier, avec le
    // matricule employeur et le code d'exploitation de sa fiche ; refusé, il dit chaque case à corriger.
    // Il se télécharge sous le nom que le format exige ; rien ne part au serveur.
    fichierCnss: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreEtPaie(o.dossierId, o.annee);
      const fiche = /** @type {Record<string, any>} */ ((fiches.get(o.dossierId) || { contenu: {} }).contenu);
      const f = KC.fichierCnssDuLivre(livre, { matricule: fiche.cnssEmployeur, code: fiche.cnssCode }, Number(o.annee), Number(o.trimestre));
      if (!f.ok) return { ok: false, refus: f.refus };
      telecharger(f.nom, f.contenu);
      return { ok: true, path: f.nom, nom: f.nom, lignes: f.lignes, total: f.total, avertissements: f.avertissements, renomme: false };
    },

    // ── La révision et les questions au client (brique 44) : le dossier de travail de la v10, gardé
    // par le cabinet au serveur (0028) ; les questions, dans les livres du client, qu'il voit à l'envoi ──
    revision: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const opts = { periode: String(o.periode || o.annee), cycles: cyclesDuCabinet() };
      return {
        ok: true, dossier: KC.dossierDeRevision(livre, opts), controles: KC.controlesRevision(livre, opts.periode, opts),
        questions: livre.questions, modeles: (reglages.contenu.questionnaire || []).slice(), cycles: opts.cycles,
      };
    },
    signerCompte: async (/** @type {any} */ o) => reviser(o, (KC, livre, p) => KC.signerCompte(livre, p, o.compte, moiNom, Date.now(), { revu: o.revu, note: o.note })),
    noteRevue: async (/** @type {any} */ o) => reviser(o, (KC, livre, p) => (o.id
      ? KC.leverNoteRevue(livre, p, o.id, moiNom, Date.now(), o.levee) : KC.ajouterNoteRevue(livre, p, o.note, moiNom, Date.now()))),
    questionnaire: async (/** @type {any} */ o) => {
      const r = await reviser(o, (KC, livre, p) => (o.poser
        ? KC.poserQuestionnaire(livre, p, reglages.contenu.questionnaire || [], moiNom, Date.now())
        : KC.repondreQuestionnaire(livre, p, o.id, o.reponse, moiNom, Date.now())));
      return { ...r, poses: r.poses || 0 };
    },
    arreterRevision: async (/** @type {any} */ o) => reviser(o, (KC, livre, p) => KC.arreterRevision(livre, p, moiNom, Date.now(), { faite: o.faite, cycles: cyclesDuCabinet() })),
    question: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const livre = await livreDe(o.dossierId, o.annee);
      const url = `/entreprises/${o.dossierId}/compta/questions`;
      /** @param {any} r */
      const refuse = (r) => { if (!r.ok) throw new Error((r.motifs || []).join(' ')); };
      // Les refus de la v10 d'abord, mot pour mot ; le serveur les refait.
      if (o.geste === 'modifier') {
        refuse(KC.modifierQuestion(livre, o.id, o.champs, moiNom, Date.now()));
        /** @type {Record<string, string>} */ const champs = {};
        for (const k of ['objet', 'texte', 'attendu', 'cycle', 'compte']) if (o.champs && o.champs[k] != null) champs[k] = String(o.champs[k]).trim();
        await appel('PUT', `${url}/${o.id}`, champs);
      } else if (o.geste === 'supprimer') {
        refuse(KC.supprimerQuestion(livre, o.id, moiNom, Date.now()));
        await appel('DELETE', `${url}/${o.id}`);
      } else if (o.geste === 'fermer' || o.geste === 'rouvrir') {
        refuse(KC.fermerQuestion(livre, o.id, moiNom, Date.now(), o.geste === 'rouvrir'));
        await appel('POST', `${url}/${o.id}/fermer`, { rouvrir: o.geste === 'rouvrir' });
      } else {
        const r = KC.ajouterQuestion(livre, { ...(o.question || {}), cycles: cyclesDuCabinet() }, moiNom, Date.now());
        refuse(r);
        const q = r.question;
        await appel('POST', url, {
          periode: String(q.periode || o.annee), cycle: String(q.cycle || ''), compte: String(q.compte || ''), ecriture: q.ecritureId || null,
          piece: String(q.piece || ''), montant: signe(q.montant), objet: String(q.objet || ''), texte: String(q.texte), attendu: String(q.attendu || 'explication'),
        });
      }
      return { ok: true, livre: await livreDe(o.dossierId, o.annee) };
    },
    // Envoyer les questions : plus de fichier, le client les voit dans son SkanFact ; chaque envoi se compte.
    ecrireQuestions: async (/** @type {any} */ o) => {
      const r = await appel('POST', `/entreprises/${o.dossierId}/compta/questions/envoyer`, { annee: Number(o.annee) });
      return { ok: true, envoyees: r.envoyees, livre: await livreDe(o.dossierId, o.annee) };
    },
    // La méthode du cabinet : son questionnaire et ses cycles, un réglage du cabinet, comme la v10 les normalisait.
    saveQuestionnaire: async (/** @type {any} */ o = {}) => {
      const contenu = { ...reglages.contenu };
      if (Array.isArray(o.modeles)) {
        contenu.questionnaire = o.modeles.map((/** @type {any} */ m) => String(m && m.question != null ? m.question : m).trim())
          .filter(Boolean).slice(0, 60).map((/** @type {string} */ question) => ({ question }));
      }
      if (Array.isArray(o.cycles)) {
        contenu.cycles = o.cycles.map((/** @type {any} */ c) => ({
          id: String(c.id || '').trim(), label: String(c.label || '').trim(),
          prefixes: (Array.isArray(c.prefixes) ? c.prefixes : []).map((/** @type {unknown} */ x) => String(x).trim()).filter(Boolean),
        })).filter((/** @type {any} */ c) => c.id && c.label);
      }
      const r = await appel('PUT', `/cabinets/${cabinetId}/reglages`, { contenu, revision: reglages.revision });
      reglages = { contenu, revision: r.revision };
      return construireEtat();
    },
    // Ce que le cabinet attend de ses clients, dossier par dossier (« À faire ») : les questions.
    // ── La production (brique 48) : le tableau de la v10 (cabcore.js, production) sur l'index des livres
    // que le serveur compte pour tout le portefeuille (indexDesLivres) ──
    production: async (/** @type {any} */ o = {}) => {
      /** @type {any} */ const K = /** @type {any} */ (window).CabCore;
      const [etat, index] = await Promise.all([construireEtat(), indexDesLivres()]);
      return { lignes: K.production(etat, index, o), etapes: K.ETAPES_PRODUCTION, collaborateurs: K.collaborateurs(etat) };
    },

    // Le résumé des index de la v10 (cab:questionsEnAttente) : les questions de chaque dossier ; pour un
    // dossier tenu au cabinet, ses exercices et leur production (c'est ce qui le fait entrer dans le
    // calendrier des Échéances) ; les mois dont la déclaration est déposée (brique 48). Ce que le livre
    // sait des salariés n'est pas encore lu : la CNSS reste comptée par prudence, et la carte le dit.
    questionsEnAttente: async () => {
      const [r, index] = await Promise.all([appel('GET', `/cabinets/${cabinetId}/questions`), indexDesLivres()]);
      const questions = new Map((r.dossiers || []).map((/** @type {any} */ x) => [x.entreprise, x]));
      return [...dossiers.values()].map((d) => {
        const q = questions.get(d.id) || { ouvertes: 0, aRelancer: 0, repondues: 0 };
        /** @type {any[]} */ const exercices = (index[d.id] || { exercices: [] }).exercices;
        const declares = exercices.flatMap((e) => Object.keys(e.production).filter((m) => e.production[m].declare)).sort();
        return { dossierId: d.id, name: d.name, ouvertes: q.ouvertes, aRelancer: q.aRelancer, repondues: q.repondues, tenu: d.manual ? { exercices } : null, declares };
      }).filter((x) => x.ouvertes || x.repondues || (x.tenu && x.tenu.exercices.length) || x.declares.length);
    },

    // ── L'exercice (brique 45) : ses contrôles, ses états et ses à-nouveaux calculés par la v10 sur le
    // livre du serveur ; la clôture et la réouverture au serveur (0029), qui valide la période jusqu'au
    // dernier jour ; l'année d'après reçoit les à-nouveaux que la v10 pose, en brouillard ──
    cloture: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const [livre, suivant] = await Promise.all([livreDe(o.dossierId, o.annee), livreSiIlExiste(o.dossierId, Number(o.annee) + 1)]);
      const lignes = KC.lignesDuLivre(livre, { du: livre.exercice.du, au: livre.exercice.au });
      const ouv = KC.soldesDepuisOuverture(livre);
      const libelle = (/** @type {string} */ c) => ((livre.plan || []).find((/** @type {any} */ p) => p.compte === c) || {}).libelle || KC.libelleDuPlan(c) || '';
      return {
        exercice: livre.exercice, controles: KC.controlesCloture(livre), etats: KC.etatsDepuisLignes(lignes, ouv, { libelle }),
        sig: KC.sigDepuisLignes(lignes, ouv, { libelle }), anouveaux: KC.anouveauxDe(livre), extournes: KC.extournesDe(livre, Number(o.annee) + 1),
        guides: KC.GUIDES_INVENTAIRE, suivant: KC.etatExerciceSuivant(livre, suivant),
      };
    },
    cloturer: async (/** @type {any} */ o) => {
      await appel('POST', `/entreprises/${o.dossierId}/compta/exercices/${Number(o.annee)}/cloturer`, {});
      await exercicesDe(o.dossierId);
      return { ok: true, brouillards: 0, livre: await livreDe(o.dossierId, o.annee) };
    },
    rouvrir: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      // Le refus de la v10 d'abord (le motif), mot pour mot ; le serveur le refait.
      const essai = KC.rouvrirExercice(JSON.parse(JSON.stringify(await livreDe(o.dossierId, o.annee))), o.motif, moiNom, Date.now());
      if (!essai.ok) throw new Error(essai.motif);
      await appel('POST', `/entreprises/${o.dossierId}/compta/exercices/${Number(o.annee)}/rouvrir`, { motif: String(o.motif || '').trim() });
      await exercicesDe(o.dossierId);
      return { ok: true, livre: await livreDe(o.dossierId, o.annee) };
    },
    // Les à-nouveaux de l'année d'après : le geste de la v10 (compta.js, ouvrirExerciceSuivant) joué sur le
    // livre de l'année d'après, puis ce qu'il y change écrit au serveur — ses pièces en brouillard, celles
    // qu'il remplace retirées ; l'exercice d'après s'ouvre s'il ne l'est pas.
    ouvrirSuivant: async (/** @type {any} */ o) => {
      /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
      const annee = Number(o.annee) + 1;
      const [livre, cible] = await Promise.all([livreDe(o.dossierId, o.annee), livreSiIlExiste(o.dossierId, annee)]);
      const essai = cible ? JSON.parse(JSON.stringify(cible)) : KC.livreSuivantVide(livre, o.dossierId);
      const r = KC.ouvrirExerciceSuivant(livre, essai, moiNom, Date.now());
      if (!r.ok) throw new Error(r.motif);
      const avant = new Map(((cible && cible.ecritures) || []).map((/** @type {any} */ e) => [e.id, e]));
      const apres = new Set(essai.ecritures.map((/** @type {any} */ e) => e.id));
      if (!exerciceDe(o.dossierId, annee)) await appel('POST', `/entreprises/${o.dossierId}/compta/exercices`, { annee, ouverture: [] });
      for (const [id, e] of avant) {
        if (!apres.has(id)) await appel('DELETE', `/entreprises/${o.dossierId}/compta/ecritures/${id}?revision=${revisions.get(e.id) ?? 1}`);
      }
      let id = null;
      for (const e of essai.ecritures) if (!avant.has(e.id)) id = (await appel('POST', `/entreprises/${o.dossierId}/compta/ecritures`, versLeServeur(e))).id;
      await exercicesDe(o.dossierId);
      return {
        ok: true, id, annee, refaits: r.refaits, anDejaValides: r.anDejaValides, biens: r.biens.total, salaries: r.salaries.total, extournes: r.extournes,
        registreBouge: r.biens.repris + r.biens.retires + r.salaries.repris + r.salaries.retires,
        complement: r.complement || 0, complementRetire: r.complementRetire || 0, piece: r.ecriture ? r.ecriture.piece : '',
      };
    },

    // ── L'équipe du cabinet (brique 46) : ses membres, les invitations qui attendent, le rôle de chacun,
    // les dossiers confiés ; chacun entre avec son propre compte (plus d'identité déclarée par poste) ──
    collaborateurs: async () => {
      const etat = await construireEtat();
      const associes = equipeLue.membres.filter((m) => (m.roles || []).includes('supervision'));
      const suis = associes.some((m) => m.utilisateur === etat.moi);
      return {
        liste: etat.collaborateurs, moi: etat.moi, invitations: equipeLue.invitations.map((i) => ({ ...i, role: VERS_V10[i.role] || 'saisie' })),
        gestion: suis ? { ok: true } : { ok: false, motif: 'Seul un associé du cabinet invite, change un rôle ou retire quelqu\'un.',
          geste: `${associes.map((m) => m.nom).join(', ')} ${associes.length > 1 ? 'peuvent' : 'peut'} le faire.` },
      };
    },
    // Inviter : le lien, à transmettre à la personne ; elle l'ouvre et se connecte avec cette adresse.
    inviterCollaborateur: async (/** @type {any} */ o) => {
      const r = await appel('POST', `/cabinets/${cabinetId}/invitations`, { email: String(o.email || '').trim(), role: VERS_SERVEUR[o.role] || 'saisie' });
      return { lien: `${location.origin}/?invitation=${encodeURIComponent(r.jeton)}`, expire: r.expire };
    },
    annulerInvitation: async (/** @type {string} */ id) => { await appel('DELETE', `/cabinets/${cabinetId}/invitations/${id}`); return true; },
    // Changer le rôle d'un membre (son nom est celui de son compte : il ne se change pas ici).
    saveCollaborateur: async (/** @type {any} */ o = {}) => {
      const membre = membreDe(String(o.id || ''));
      if (!membre) throw new Error('Une personne rejoint le cabinet par une invitation : « Inviter un collaborateur… ».');
      await appel('PUT', `/cabinets/${cabinetId}/membres/${membre}`, { role: VERS_SERVEUR[o.role] || 'saisie' });
      return construireEtat();
    },
    retirerCollaborateur: async (/** @type {string} */ id) => {
      const membre = membreDe(String(id || ''));
      if (!membre) throw new Error('Cette personne ne fait plus partie du cabinet.');
      await appel('DELETE', `/cabinets/${cabinetId}/membres/${membre}`);
      return construireEtat();
    },
    // Les dossiers confiés : un rôle posé sur un dossier le confie à la personne ; vide, il ne l'est plus.
    saveDroits: async (/** @type {string} */ dossierId, /** @type {Record<string, string>} */ droits) => {
      const mandat = mandats.get(dossierId);
      if (!mandat) throw new Error('Dossier introuvable.');
      for (const m of equipeLue.membres) {
        const choisi = droits ? droits[m.utilisateur] : undefined;
        const voulu = choisi ? VERS_SERVEUR[choisi] || '' : '';
        const pose = (equipeLue.affectations.find((a) => a.entreprise === dossierId && a.membre === m.membre) || {}).role || '';
        if (voulu && voulu !== pose) await appel('PUT', `/cabinets/${cabinetId}/mandats/${mandat}/affectations/${m.membre}`, { role: voulu });
        else if (!voulu && pose) await appel('DELETE', `/cabinets/${cabinetId}/mandats/${mandat}/affectations/${m.membre}`);
      }
      return construireEtat();
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
