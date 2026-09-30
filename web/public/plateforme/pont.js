// @ts-check
// Le point de contact de l'interface v10 avec le serveur de la plateforme (décision de Skander,
// 28/09/2026 : la plateforme reprend le CODE de la v10 et n'adapte que ce branchement, les gestes
// officiels et le téléphone). Chargé AVANT le code de la v10 (adaptation de index.html), il pose
// `window.skanfact`, que la v10 lit comme son pont avec l'ordinateur : ici, le dossier vient du
// serveur et y repart.
//
//   - Le dossier est découpé en objets : chaque élément d'une liste à identifiant (un client, une
//     pièce…) en est un ; toute autre valeur (la fiche société, les compteurs…) aussi, sous « _racine ».
//   - À chaque enregistrement de la v10, seuls les objets qui ont CHANGÉ partent, avec la révision
//     qu'on leur connaissait : le serveur refuse ce qui a changé ailleurs, et vérifie le reste.
//   - Un nombre non entier part en texte exact ({ "~n": "450.5" }) : jamais de nombre à virgule en base.
//   - Une facture s'émet par le serveur (`emettre`) : c'est lui qui la numérote et la scelle.
(function () {
  'use strict';
  /** @type {string | null} */
  let jeton = null;
  // La session de l'onglet, ou celle gardée sur « mon ordinateur » (brique 72) : l'application se rouvre.
  try { jeton = sessionStorage.getItem('skanfact.jeton') || localStorage.getItem('skanfact.jeton'); } catch { /* stockage refusé : pas de session */ }
  /** @type {any} */ const poste = /** @type {any} */ (window).SkanPoste;
  const ent = new URLSearchParams(location.search).get('e');
  // Sans session ou sans entreprise, retour à la connexion.
  if (!jeton || !ent || !/^[0-9a-f-]{36}$/.test(ent)) { location.replace('/'); return; }

  /** @param {string} methode @param {string} chemin @param {unknown} [corps] */
  async function appel(methode, chemin, corps) {
    /** @type {Record<string, string>} */
    const entetes = { authorization: `Bearer ${jeton}` };
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`/v1/entreprises/${ent}${chemin}`, { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    } catch (e) {
      // Le réseau manque (brique 72) : le bandeau le dit, et la copie du poste prend le relais.
      poste.horsLigne();
      const x = new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
      /** @type {any} */ (x).horsLigne = true;
      throw x;
    }
    poste.enLigne();
    // La session est finie : retour à la connexion, qui dit pourquoi (un appareil retiré y efface ce
    // qu'il garde : brique 74).
    if (r.status === 401) { location.replace('/'); throw new Error('Ta session est terminée : reconnecte-toi.'); }
    const texte = await r.text();
    /** @type {any} */
    const lu = texte ? JSON.parse(texte) : {};
    // Le rôle exige le code du téléphone, pas encore en place : l'entrée le fait poser d'abord.
    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) {
      const e = new Error(typeof lu.motif === 'string' ? lu.motif : 'Le serveur a rencontré une erreur : réessaie dans un instant.');
      /** @type {any} */ (e).statut = r.status;
      throw e;
    }
    return lu;
  }

  // ── Les nombres : texte exact à l'aller, nombre au retour ───────────────────────────────────
  /** @param {unknown} v @returns {unknown} */
  function encoder(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : (Number.isFinite(v) ? { '~n': String(v) } : null);
    if (Array.isArray(v)) return v.map(encoder);
    if (v && typeof v === 'object') {
      /** @type {Record<string, unknown>} */
      const o = {};
      for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') o[k] = encoder(x);
      return o;
    }
    return v;
  }
  /** @param {unknown} v @returns {unknown} */
  function decoder(v) {
    if (Array.isArray(v)) return v.map(decoder);
    if (v && typeof v === 'object') {
      const cles = Object.keys(v);
      if (cles.length === 1 && cles[0] === '~n') return Number(/** @type {any} */ (v)['~n']);
      /** @type {Record<string, unknown>} */
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = decoder(x);
      return o;
    }
    return v;
  }

  // ── Le découpage du dossier en objets ───────────────────────────────────────────────────────
  const COLLECTION = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
  /** @param {unknown} v */
  const listeAIdentifiants = (v) => Array.isArray(v) && v.length > 0
    && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 200)
    && new Set(v.map((x) => x.id)).size === v.length;

  /** @typedef {{ collection: string, cle: string, rang: number | null, json: string }} Morceau */
  /** @param {Record<string, unknown>} data @returns {Map<string, Morceau>} */
  function decouper(data) {
    /** @type {Map<string, Morceau>} */
    const m = new Map();
    for (const [champ, brut] of Object.entries(data)) {
      if (brut === undefined || typeof brut === 'function') continue;
      // Les questions du cabinet vivent dans les livres, au serveur (brique 44 bis) : jamais dans le dossier.
      const v = champ === 'questionsCabinet' ? [] : brut;
      if (COLLECTION.test(champ) && listeAIdentifiants(v)) {
        /** @type {any[]} */ (v).forEach((x, i) => m.set(`${champ}\u0000${x.id}`, { collection: champ, cle: x.id, rang: i, json: JSON.stringify(encoder(x)) }));
      } else {
        m.set(`_racine\u0000${champ}`, { collection: '_racine', cle: champ, rang: null, json: JSON.stringify(encoder(v)) });
      }
    }
    return m;
  }
  /** @param {{ collection: string, cle: string, contenu: unknown }[]} objets */
  function assembler(objets) {
    /** @type {Record<string, any>} */
    const data = {};
    for (const o of objets) {
      if (o.collection === '_racine') data[o.cle] = decoder(o.contenu);
      else (data[o.collection] = data[o.collection] || []).push(decoder(o.contenu));
    }
    return data;
  }

  // Ce que le serveur a de chaque objet : son contenu (tel qu'envoyé) et sa révision.
  /** @type {Map<string, { json: string, rang: number | null, revision: number }>} */
  let vu = new Map();

  // ── Enregistrer : un seul envoi à la fois ; le suivant part avec le dernier état du dossier ──
  /** @type {Promise<unknown> | null} */
  let enCours = null;
  /** @type {Record<string, unknown> | null} */
  let enAttente = null;
  // Ce qui a changé dans le dossier par rapport à ce que le serveur a (`vu`) : chaque objet changé,
  // ajouté ou retiré, avec la révision qu'on lui connaissait.
  /** @param {Record<string, unknown>} data */
  function changementsDe(data) {
    const maintenant = decouper(data);
    const changements = [];
    for (const [k, m] of maintenant) {
      const avant = vu.get(k);
      if (!avant || avant.json !== m.json || avant.rang !== m.rang) {
        changements.push({ collection: m.collection, cle: m.cle, rang: m.rang, revision: avant ? avant.revision : null, contenu: JSON.parse(m.json) });
      }
    }
    for (const [k, avant] of vu) {
      if (!maintenant.has(k)) {
        const [collection = '', cle = ''] = k.split('\u0000');
        changements.push({ collection, cle, rang: null, revision: avant.revision, contenu: null });
      }
    }
    return changements;
  }
  // Envoyer le dossier : `true` quand le serveur a tout ; `{ conflict, disk }` quand un objet a changé
  // ailleurs ; `{ horsLigne }` quand le réseau manque et que ce poste a gardé l'enregistrement (brique 73).
  /** @param {Record<string, unknown>} data */
  async function envoyer(data) {
    try { await envoyerReponses(data); } catch (e) { if (gardableHorsLigne(e)) return await mettreEnAttente(data); throw e; }
    const changements = changementsDe(data);
    if (!changements.length) return true;
    // Par paquets : un premier enregistrement peut porter tout un dossier.
    for (let i = 0; i < changements.length; i += 500) {
      const lot = changements.slice(i, i + 500);
      let r;
      try {
        r = await appel('POST', '/dossier-v10', { changements: lot });
      } catch (e) {
        // Un objet a changé ailleurs (un autre membre de l'équipe, un autre onglet) : le serveur n'a
        // RIEN écrit de ce lot. On relit le dossier et on le rend à la v10 comme elle l'attend
        // (`conflict`, `disk`) : elle fusionne pièce par pièce (`mergeData`), le dit, puis réenregistre.
        // Comme dans la v10, la version enregistrée gagne (`syncWrittenAt` plus récent) : ce qui se
        // contredit est mis de côté (`conflictArchive`) et dit, jamais écrit par-dessus le serveur.
        if (/** @type {any} */ (e).statut === 409) return { conflict: true, disk: Object.assign(await relire(), { syncWrittenAt: Date.now() }) };
        // Le réseau manque : sur « mon ordinateur », l'enregistrement se garde et partira seul.
        if (gardableHorsLigne(e)) return await mettreEnAttente(data);
        throw e;
      }
      for (const [j, c] of lot.entries()) {
        const k = `${c.collection}\u0000${c.cle}`;
        const rev = r.revisions[j] && r.revisions[j].revision;
        if (c.contenu === null) vu.delete(k); else vu.set(k, { json: JSON.stringify(c.contenu), rang: c.rang, revision: rev });
      }
    }
    garderLaCopie();
    return true;
  }
  /** @param {Record<string, unknown>} data */
  function enregistrer(data) {
    enAttente = data;
    if (enCours) return enCours;
    enCours = (async () => {
      try {
        /** @type {unknown} */
        let r = true;
        // Après un conflit, la v10 fusionne et renvoie tout : ce qui attendait part avec elle.
        while (enAttente) { const d = enAttente; enAttente = null; r = await envoyer(d); if (r !== true) { enAttente = null; break; } }
        // Ce qui attendait le réseau est parti avec cet envoi.
        if (r === true && attenteGardee) await finirAttente(0);
        return r;
      } finally { enCours = null; }
    })();
    return enCours;
  }

  // Le dossier tel que le serveur l'a, et ce qu'on en sait désormais (révisions).
  async function relire() {
    const r = await appel('GET', '/dossier-v10');
    vu = new Map();
    for (const o of r.objets) vu.set(`${o.collection}\u0000${o.cle}`, { json: JSON.stringify(o.contenu), rang: o.rang, revision: o.revision });
    const data = assembler(r.objets);
    data.questionsCabinet = await questionsDuCabinet();
    questionsLues = data.questionsCabinet;
    garderLaCopie();
    return data;
  }

  // ── La copie du poste (brique 72 ; docs/hors-ligne.md, H3) ─────────────────────────────────
  // Sur « mon ordinateur », ce que le serveur a (les objets et leurs révisions, tels que `vu` les
  // connaît) se garde chiffré après chaque lecture et chaque enregistrement ; sans réseau, l'écran
  // s'ouvre dessus.
  /** @type {any[]} */ let questionsLues = [];
  /** @type {ReturnType<typeof setTimeout> | null} */ let copieAFaire = null;
  const objetsVus = () => [...vu].map(([k, v]) => {
    const [collection = '', cle = ''] = k.split('\u0000');
    return { collection, cle, rang: v.rang, revision: v.revision, contenu: JSON.parse(v.json) };
  }).sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : (a.rang ?? 0) - (b.rang ?? 0)));
  function garderLaCopie() {
    if (!poste.garde()) return;
    if (copieAFaire) clearTimeout(copieAFaire);
    copieAFaire = setTimeout(() => {
      copieAFaire = null;
      poste.ecrireCopie(ent, { objets: objetsVus(), questions: questionsLues }).catch(() => { /* sans copie, le hors-ligne attendra la prochaine */ });
    }, 300);
  }
  // ── Enregistrer sans réseau (brique 73 ; docs/hors-ligne.md, H5) ─────────────────────────────
  // Sur « mon ordinateur », un enregistrement qui ne trouve pas le serveur se GARDE (chiffré) : l'état
  // du dossier que l'écran a enregistré, qui partira par rapport à la copie (ses révisions disent au
  // serveur ce que le poste avait vu). Il part seul au retour du réseau, par le chemin ordinaire : ce
  // qui a changé ailleurs entre-temps revient en conflit, et la v10 fusionne comme toujours (la version
  // du serveur gardée, l'autre mise de côté et dite). Rien ne se double : un objet enregistré ne
  // diffère plus de ce que le serveur a.
  let attenteGardee = false;
  let attenteN = 0;
  // Ce que la personne a fait : les pièces et les fiches (les réglages du dossier ne se comptent pas).
  /** @param {{ collection: string }[]} changements */
  const compter = (changements) => changements.filter((c) => c.collection !== '_racine').length;
  /** @param {unknown} e */
  const gardableHorsLigne = (e) => !!(e && /** @type {any} */ (e).horsLigne) && poste.garde();
  /** @param {Record<string, unknown>} data */
  async function mettreEnAttente(data) {
    // La base d'abord : ce que le serveur a déjà reçu (un premier paquet parti avant la coupure).
    await poste.ecrireCopie(ent, { objets: objetsVus(), questions: questionsLues });
    await poste.ecrireAttente(ent, { data });
    attenteGardee = true;
    attenteN = compter(changementsDe(data));
    poste.attente(attenteN);
    return { horsLigne: true };
  }
  /** @param {number} conflits */
  async function finirAttente(conflits) {
    const n = attenteN;
    attenteGardee = false; attenteN = 0;
    await poste.effacerAttente(ent);
    poste.envoye(n, conflits);
  }
  // Au retour du réseau, et toutes les 30 secondes tant que quelque chose attend : l'écran réenregistre.
  const relancer = () => {
    const w = /** @type {any} */ (window);
    if (attenteGardee && !enCours && w.__data && typeof w.__enregistrerMaintenant === 'function') w.__enregistrerMaintenant();
  };
  poste.auRetour(relancer);
  setInterval(() => { if (navigator.onLine) relancer(); }, 30_000);
  // À l'ouverture, avec le réseau : ce qui attendait part d'abord, par rapport à la copie ; ce qui
  // avait changé ailleurs se fusionne comme la v10 le fait (version du serveur gardée, l'autre mise de
  // côté), puis le dossier se relit.
  /** @param {Record<string, unknown>} data */
  async function rejouer(data) {
    const c = await poste.lireCopie(ent);
    if (c) {
      vu = new Map();
      for (const o of c.contenu.objets) vu.set(`${o.collection}\u0000${o.cle}`, { json: JSON.stringify(o.contenu), rang: o.rang, revision: o.revision });
      questionsLues = c.contenu.questions || [];
      attenteGardee = true;
      attenteN = compter(changementsDe(data));
      /** @type {any} */ let r = await envoyer(data);
      if (r && r.horsLigne) { const x = new Error('hors ligne'); /** @type {any} */ (x).horsLigne = true; throw x; }
      let conflits = 0;
      if (r !== true) {
        const m = /** @type {any} */ (window).SkanCore.mergeData(data, r.disk);
        conflits = m.counts.conflicts || 0;
        r = await envoyer(m.data);
      }
      if (r === true) await finirAttente(conflits);
    } else await poste.effacerAttente(ent);
    return await relire();
  }

  // Sans réseau : la copie du poste, ce qu'on en sait (révisions), et le bandeau qui dit de quand elle est.
  async function lireLaCopie() {
    const c = await poste.lireCopie(ent);
    if (!c) {
      // Rien à montrer : le bandeau dit pourquoi, et l'écran attend le réseau (« Réessayer »).
      poste.sansCopie(poste.garde()
        ? 'Hors ligne, et ce poste n\'a pas encore de copie de cette entreprise : ouvre-la une fois avec le réseau pour pouvoir la consulter ensuite sans lui.'
        : 'Hors ligne : sur l\'ordinateur d\'un autre, rien n\'est gardé sur le poste. Reviens quand le réseau sera là.');
      return await new Promise(() => { /* rien ne s'ouvre sans données */ });
    }
    vu = new Map();
    for (const o of c.contenu.objets) vu.set(`${o.collection}\u0000${o.cle}`, { json: JSON.stringify(o.contenu), rang: o.rang, revision: o.revision });
    const data = assembler(c.contenu.objets);
    data.questionsCabinet = questionsLues = c.contenu.questions || [];
    poste.horsLigne({ copieLe: c.le });
    return data;
  }

  // ── Les questions du cabinet (brique 44 bis ; docs/cabinet.md, C34) ─────────────────────────
  // Elles sont dans les livres de l'entreprise : celles que le cabinet a envoyées et n'a pas
  // fermées, dans la forme de la v10 (compta.js, fusionnerQuestionsRecues) — chaque envoi compte une
  // réception. Qui ne lit pas les livres ne les voit pas. La réponse part au serveur dès qu'elle est
  // enregistrée, et elle seule : rien d'autre de la question ne se change ici.
  /** @type {Map<string, string>} */
  let reponsesConnues = new Map();
  async function questionsDuCabinet() {
    /** @type {any[]} */ let lues = [];
    try { lues = (await appel('GET', '/compta/questions')).questions || []; } catch (e) { if (/** @type {any} */ (e).statut !== 403) throw e; }
    const qs = lues.filter((q) => q.statut !== 'close').map((q) => ({
      id: q.id, periode: q.periode, piece: q.piece, compte: q.compte, libelleCompte: '', montant: Number(q.montant) || 0,
      objet: q.objet, texte: q.texte, attendu: q.attendu, cabinet: '', exercice: Number(String(q.periode).slice(0, 4)),
      recueLe: Date.parse(q.envois[q.envois.length - 1]) || 0, recues: q.envois.length,
      reponse: q.reponse ? { texte: q.reponse, le: Date.parse(q.reponduLe) || 0, piece: null } : null,
    }));
    reponsesConnues = new Map(qs.map((q) => [q.id, q.reponse ? q.reponse.texte : '']));
    return qs;
  }
  /** @param {Record<string, unknown>} data */
  async function envoyerReponses(data) {
    for (const q of /** @type {any[]} */ (Array.isArray(data.questionsCabinet) ? data.questionsCabinet : [])) {
      const texte = String((q && q.reponse && q.reponse.texte) || '').trim();
      if (!texte || !reponsesConnues.has(q.id) || reponsesConnues.get(q.id) === texte) continue;
      await appel('POST', `/compta/questions/${encodeURIComponent(q.id)}/repondre`, { texte });
      reponsesConnues.set(q.id, texte);
    }
  }

  // Les panneaux des Paramètres sans objet sur la plateforme (voir `panneauxAbsents`).
  // `p-pj` (les pièces jointes d'une pièce) reviendra quand le serveur gardera les fichiers ;
  // `p-depannage` (le journal de l'ordinateur, le signalement) quand le serveur tiendra le sien.
  const PANNEAUX_ABSENTS = ['p-dossiers', 'p-sauvegardes', 'p-externe', 'p-motdepasse', 'p-ocr', 'p-danger', 'p-maj', 'p-licence', 'p-editeur', 'p-pj', 'p-depannage'];
  const style = document.createElement('style');
  style.textContent = `${PANNEAUX_ABSENTS.map((id) => `#${id}`).join(', ')} { display: none !important; }`;
  document.head.appendChild(style);

  // ── Ton cabinet comptable (brique 37 ; docs/cabinet.md) ─────────────────────────────────────
  // Plus d'appairage ni de paquets : le propriétaire confie son dossier à son cabinet en tapant le
  // code du cabinet (un MANDAT, que l'associé accepte). Le panneau de la v10 se dessine ici.
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  /** @param {string} iso */
  const jour = (iso) => { const [a, m, j] = String(iso).slice(0, 10).split('-'); return `${j}/${m}/${a}`; };
  /** @type {[string, string, string][]} */
  const PERIMETRES = [['comptabilite', 'La comptabilité', 'ses écritures, la validation des mois, la balance'],
    ['declarations', 'Les déclarations', 'TVA, retenues à la source'],
    ['saisie_achats', 'La saisie des achats', 'tes factures d\'achat, s\'il les saisit pour toi'],
    ['paie', 'La paie', 'le salaire de chacun : décochée tant que tu ne la confies pas']];
  /** @param {string[]} p */
  const lesPerimetres = (p) => PERIMETRES.filter(([k]) => p.includes(k)).map(([, l]) => l.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' et $1');
  /** @param {HTMLElement} el */
  async function dessinerMandat(el) {
    /** @param {string} html */
    const poser = (html) => { el.innerHTML = html; };
    /** @param {unknown} x */
    const refus = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    /** @param {() => Promise<unknown>} geste @param {HTMLElement} b */
    const agir = async (geste, b) => { b.setAttribute('disabled', ''); try { await geste(); await dessinerMandat(el); } catch (x) { b.removeAttribute('disabled'); refus(x); } };
    let m;
    try { m = (await appel('GET', '/mandat')).mandat; } catch (x) { poser(`<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`); return; }
    if (!m) {
      poser(`<p>Ton cabinet comptable tient tes livres ici même : il lit tes écritures à jour, et valide tes mois. Rien ne lui est envoyé : il n'y a plus de paquet ni de fichier.</p>
        <label class="field mt">Le code de ton cabinet<input type="text" id="mandat-code" maxlength="10" autocomplete="off" spellcheck="false" style="max-width:220px"></label>
        <p class="small muted">Ton comptable le lit dans SkanFact Cabinet (Réglages → Mon cabinet). Ce que tu lui confies :</p>
        ${PERIMETRES.map(([k, l, d]) => `<label class="check"><input type="checkbox" data-perimetre="${k}"${k === 'paie' ? '' : ' checked'}> ${esc(l)} <span class="muted small">— ${esc(d)}</span></label>`).join('')}
        <p class="small" role="alert"></p>
        <button type="button" class="btn btn-primary mt" id="mandat-confier">Confier mon dossier</button>`);
      const b = /** @type {HTMLElement} */ (el.querySelector('#mandat-confier'));
      b.onclick = () => agir(async () => {
        const codeCabinet = String(/** @type {HTMLInputElement} */ (el.querySelector('#mandat-code')).value).trim();
        if (!codeCabinet) { /** @type {HTMLInputElement} */ (el.querySelector('#mandat-code')).focus(); throw new Error('Tape d\'abord le code de ton cabinet : rien n\'a été envoyé.'); }
        const perimetre = [...el.querySelectorAll('[data-perimetre]')].filter((x) => /** @type {HTMLInputElement} */ (x).checked).map((x) => String(/** @type {HTMLElement} */ (x).dataset.perimetre));
        if (!perimetre.length) throw new Error('Coche au moins ce que tu lui confies : rien n\'a été envoyé.');
        await appel('POST', '/mandat', { codeCabinet, perimetre });
      }, b);
      return;
    }
    const nom = `<strong>${esc(m.cabinet.nom)}</strong>`;
    poser(`${m.statut === 'propose'
      ? `<p>Tu as confié ton dossier à ${nom} : il ne le voit qu'une fois qu'il a accepté.</p>`
      : `<p>${nom} tient tes livres depuis le ${esc(jour(m.debut))} : ${esc(lesPerimetres(m.perimetre))}.</p>
         <p class="small muted">Il lit tes écritures à jour et valide tes mois ; il ne touche jamais à tes factures, à ta caisse ni à ton équipe.</p>`}
      <p class="small" role="alert"></p>
      <div class="inline mt"><button type="button" class="btn btn-danger" id="mandat-arreter">${m.statut === 'propose' ? 'Retirer ma proposition' : 'Arrêter le mandat…'}</button></div>`);
    const b = /** @type {HTMLElement} */ (el.querySelector('#mandat-arreter'));
    b.onclick = () => {
      // Arrêter un mandat se demande : le cabinet ne verra plus tes livres.
      if (m.statut === 'actif' && !b.dataset.confirme) {
        b.dataset.confirme = '1';
        b.textContent = 'Oui, arrêter : il ne verra plus mes livres';
        refus(`${m.cabinet.nom} ne verra plus tes livres à partir d'aujourd'hui. Ce qu'il a déjà validé reste validé.`);
        return;
      }
      void agir(() => appel('DELETE', '/mandat'), b);
    };
  }

  /** @type {any} */ (window).skanfact = {
    dessinerMandat,
    dessinerAppareils,
    loadData: async () => {
      const attente = await poste.lireAttente(ent).catch(() => null);
      try { return { data: attente ? await rejouer(attente.contenu.data) : await relire(), corruptFile: null }; } catch (e) {
        if (!/** @type {any} */ (e).horsLigne) throw e;
        const copie = await lireLaCopie();
        if (!attente) return { data: copie, corruptFile: null };
        // Ce qui a été enregistré sans réseau se montre, et attend toujours.
        attenteGardee = true;
        attenteN = compter(changementsDe(attente.contenu.data));
        poste.attente(attenteN);
        return { data: attente.contenu.data, corruptFile: null };
      }
    },
    saveData: (/** @type {Record<string, unknown>} */ data) => enregistrer(data),
    dataPath: async () => 'Serveur SkanFact',
    setTitle: (/** @type {string} */ t) => { document.title = t; },

    // L'émission d'une facture ou d'un avoir (adaptation de `issue()` dans app.js) : le serveur prend la pièce telle
    // que l'écran la montre, la numérote, la scelle, et vérifie qu'il trouve le même net à payer.
    emettre: async (/** @type {any} */ doc, /** @type {any} */ client, /** @type {number} */ netAPayer) => {
      if (enCours) await enCours;
      // Une facture ne s'émet jamais sans réseau (04 § 3.3) : son numéro et son sceau viennent du serveur.
      if (attenteGardee || !navigator.onLine) {
        throw new Error('Hors ligne : une facture ou un avoir s\'émet par le serveur, qui lui donne son numéro et le scelle. Enregistre-la en brouillon : elle se garde sur ce poste, et tu l\'émettras au retour du réseau.');
      }
      const decimales = !doc.currency || doc.currency === 'DT' || doc.currency === 'TND' ? 3 : 2;
      const k = `documents\u0000${doc.id}`;
      const avant = vu.get(k);
      const liste = /** @type {any} */ (window).__data && /** @type {any} */ (window).__data.documents;
      const place = Array.isArray(liste) ? liste.findIndex((/** @type {any} */ d) => d.id === doc.id) : -1;
      // Une pièce neuve prendra la dernière place de la liste, comme la v10 l'y ajoute.
      const rang = Array.isArray(liste) ? (place >= 0 ? place : liste.length) : null;
      // Un avoir a sa route (et son geste : le commercial émet une facture, pas un avoir).
      const r = await appel('POST', doc.type === 'avoir' ? '/dossier-v10/emettre-avoir' : '/dossier-v10/emettre', {
        document: encoder(doc), client: client ? encoder(client) : null, revision: avant ? avant.revision : null,
        rang: avant ? avant.rang : rang, netAPayer: Number(netAPayer).toFixed(decimales),
      });
      vu.set(k, { json: JSON.stringify(r.contenu), rang: avant ? avant.rang : rang, revision: r.revision });
      garderLaCopie();
      return decoder(r.contenu);
    },

    // ── Les entreprises (les « dossiers » de la v10) ──────────────────────────────────────────
    // Un dossier de la v10 était un fichier sur l'ordinateur ; ici, c'est une entreprise du compte.
    listDossiers: async () => {
      let moi;
      try { moi = await appelCompte('GET', '/moi'); } catch (e) {
        if (!/** @type {any} */ (e).horsLigne) throw e;
        // Sans réseau : l'entreprise ouverte seulement (les autres se listent en ligne) ; le menu garde
        // « Se déconnecter », qui efface la copie du poste même sans réseau.
        const nom = String((((/** @type {any} */ (window).__data) || {}).company || {}).name || '');
        return { dossiers: [{ id: ent, name: nom, shared: false, dir: 'Copie de ce poste' }], current: ent, device: { name: '' }, retires: [] };
      }
      return {
        // Celles que la personne voit par son cabinet s'ouvrent dans le Cabinet, pas ici.
        dossiers: moi.entreprises.filter((/** @type {any} */ e) => !e.parCabinet)
          .map((/** @type {any} */ e) => ({ id: e.id, name: e.raison_sociale, shared: false, dir: 'Serveur SkanFact' })),
        current: ent, device: { name: '' }, retires: [],
      };
    },
    switchDossier: async (/** @type {string} */ id) => { ouvrirEntreprise(id); return { ok: true }; },
    addDossier: async (/** @type {{ name?: string }} */ o) => {
      const nom = String((o && o.name) || '').trim();
      if (!nom) return { ok: false, error: 'Donne un nom à cette entreprise.' };
      const r = await appelCompte('POST', '/entreprises', { raisonSociale: nom });
      ouvrirEntreprise(r.id);
      return { ok: true };
    },
    // Le nom d'une entreprise est sa raison sociale : il se change dans Paramètres → Société.
    renameDossier: async () => ({ ok: true }),
    forgetDossier: pasEncore('Retirer une entreprise de la liste'),
    restoreDossier: pasEncore('Remettre une entreprise dans la liste'),
    shareDossier: async () => ({ ok: false, error: PARTAGE }),
    joinDossier: async () => ({ ok: false, error: PARTAGE }),
    renameDevice: pasEncore('Nommer cet appareil'),
    // Se déconnecter efface aussi ce que le poste garde (la copie chiffrée et sa clé).
    deconnecter: async () => {
      // Ce qui attend le réseau serait perdu : on le demande d'abord.
      if (attenteGardee && !(await poste.demander('Des changements faits hors ligne ne sont pas encore partis : te déconnecter maintenant les efface de ce poste.',
        'Me déconnecter quand même', 'Attendre le réseau'))) return;
      try { await appelCompte('POST', '/deconnexion'); } catch { /* la session se ferme de toute façon ici */ }
      try { sessionStorage.removeItem('skanfact.jeton'); localStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
      await poste.effacer();
      location.replace('/');
    },

    // ── Les fichiers : ce que le navigateur sait faire ────────────────────────────────────────
    // Enregistrer = télécharger : le fichier arrive dans « Téléchargements », sous son nom.
    saveText: async (/** @type {string} */ nom, /** @type {string} */ contenu) => telecharger(nom, contenu),
    // « Jamais de données en otage » : tout le dossier se télécharge, comme l'export de la v10.
    exportData: async (/** @type {unknown} */ data) => telecharger(`skanfact-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2)),
    importData: pasEncore('Remplacer toutes les données par un fichier'),
    // Une saisie pas encore enregistrée : le navigateur demande avant de fermer l'onglet, comme la
    // fenêtre de la v10 demandait avant de se fermer.
    setDirty: (/** @type {boolean} */ sale) => { window.onbeforeunload = sale ? (e) => { e.preventDefault(); return ''; } : null; },
    saveTextSilent: async (/** @type {string} */ nom, /** @type {string} */ contenu) => telecharger(nom, contenu),
    openText: async (/** @type {{ filtre?: string }} */ o) => {
      const xml = !!(o && o.filtre === 'xml');
      const f = await choisirFichier(xml ? '.xml,text/xml,application/xml' : '.csv,.tsv,.txt,.xlsx,text/csv,text/plain');
      if (!f) return { canceled: true };
      if (f.size > 5 * 1024 * 1024) {
        return { ok: false, nom: f.name, motif: `« ${f.name} » fait ${Math.round(f.size / 1048576)} Mo : ${xml ? 'une facture électronique' : 'une liste de clients ou de prix'} en fait quelques dizaines de Ko. Ce n'est probablement pas le bon fichier.` };
      }
      const lu = /** @type {any} */ (window).SkanCompta.lireFichierTexte(new Uint8Array(await f.arrayBuffer()), f.name, {});
      return Object.assign({ nom: f.name }, xml ? { chemin: null } : {}, lu);
    },
    pickLogo: async () => {
      const f = await choisirFichier('.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml');
      if (!f) return null;
      if (f.size > 1024 * 1024) throw new Error('Image trop lourde (1 Mo maximum). Réduis-la avant de l\'utiliser.');
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error(`« ${f.name} » ne se lit pas.`));
        r.readAsDataURL(f);
      });
    },
    // Le message s'ouvre dans la messagerie de l'appareil (un lien « mailto ») ; un navigateur ne sait
    // pas y joindre un fichier.
    composeMail: async (/** @type {{ to?: string, subject?: string, body?: string }} */ o) => {
      const a = document.createElement('a');
      a.href = `mailto:${encodeURIComponent((o && o.to) || '')}?subject=${encodeURIComponent((o && o.subject) || '')}&body=${encodeURIComponent((o && o.body) || '')}`;
      a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      return { state: 'mailto' };
    },
    ouvrirWhatsApp: async (/** @type {{ numero: string, texte: string }} */ o) => {
      const w = window.open(`https://wa.me/${encodeURIComponent(o.numero)}?text=${encodeURIComponent(o.texte || '')}`, '_blank', 'noopener');
      if (!w) throw new Error('Ton navigateur a bloqué l\'ouverture de WhatsApp : autorise les fenêtres de ce site, puis réessaie.');
      return { ok: true };
    },

    // ── Ce qui n'est pas encore sur le serveur : un refus qui le dit, jamais une panne ─────────
    addAttachments: pasEncore('Joindre un fichier'),
    attachPath: pasEncore('Joindre un fichier'),
    openAttachment: pasEncore('Ouvrir une pièce jointe'),
    revealAttachment: pasEncore('Montrer une pièce jointe'),
    removeAttachment: async () => undefined,
    ocrStatus: async () => ({ hasKey: false }),
    ocrSetKey: pasEncore('La lecture des factures par photo'),
    ocrPick: pasEncore('La lecture des factures par photo'),
    ocrRead: pasEncore('La lecture des factures par photo'),
    buildPack: pasEncore('Le paquet pour le comptable'),
    onPackProgress: () => () => undefined,
    importCabinet: pasEncore('La réponse du cabinet'),
    lireCloture: pasEncore('La clôture envoyée par le cabinet'),
    lireQuestions: pasEncore('Les questions du cabinet'),
    ouvrirEtatsCloture: pasEncore('Les états de clôture du cabinet'),
    achatTarifs: async () => ({ ouvert: false, raison: 'L\'abonnement se prendra ici quand la plateforme sera ouverte au public.' }),
    achatVerifier: pasEncore('L\'abonnement'),
    achatCommander: pasEncore('L\'abonnement'),
    achatReprendre: async () => null,
    achatOublier: pasEncore('L\'abonnement'),
    pontExporterBase: pasEncore('L\'export de la base de l\'éditeur'),
    updateCanaux: async () => null,
    // Les données vivent sur le serveur, plus sur l'ordinateur : l'étape « Mettre tes données à l'abri »
    // de la v10 (une copie vers iCloud ou une clé) est faite d'elle-même.
    externalBackupInfo: async () => ({ dir: 'Serveur SkanFact', partage: false }),
    // Les panneaux des Paramètres qui parlent de l'ordinateur (fichiers, copies, mot de passe du
    // fichier, licence, mises à jour) : ils n'ont pas d'objet ici. La palette (Ctrl K) les tait aussi.
    panneauxAbsents: PANNEAUX_ABSENTS,

    // L'exemple rempli de la v10 remplaçait les données du dossier par des pièces inventées. Sur la
    // plateforme, l'exemple est l'entreprise d'essai, à part : jamais une pièce inventée dans une
    // vraie entreprise (adaptation de `loadDemo`).
    exemple: async () => {
      const moi = await appelCompte('GET', '/moi');
      const essai = moi.entreprises.find((/** @type {any} */ e) => e.essai && !e.parCabinet);
      if (essai && essai.id === ent) return { motif: 'Tu es dans ton entreprise d\'essai : c\'est elle, l\'exemple. Tout ce que tu y fais reste ici, et ne touche jamais une vraie entreprise.' };
      ouvrirEntreprise(essai ? essai.id : (await appelCompte('POST', '/entreprises-essai')).id);
      return {};
    },
  };

  // Les appels du compte (hors entreprise) : la liste des entreprises, en créer une, se déconnecter.
  /** @param {string} methode @param {string} chemin @param {unknown} [corps] */
  async function appelCompte(methode, chemin, corps) {
    /** @type {Record<string, string>} */
    const entetes = { authorization: `Bearer ${jeton}` };
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`/v1${chemin}`, { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    } catch (e) {
      poste.horsLigne();
      const x = new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
      /** @type {any} */ (x).horsLigne = true;
      throw x;
    }
    poste.enLigne();
    if (r.status === 401) { location.replace('/'); throw new Error('Ta session est terminée : reconnecte-toi.'); }
    const texte = await r.text();
    /** @type {any} */
    const lu = texte ? JSON.parse(texte) : {};
    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) throw new Error(typeof lu.motif === 'string' ? lu.motif : 'Le serveur a rencontré une erreur : réessaie dans un instant.');
    return lu;
  }
  // ── Tes appareils (brique 74 ; docs/hors-ligne.md, H9) : les voir, en retirer un ────────────
  /** @param {HTMLElement} el */
  async function dessinerAppareils(el) {
    /** @type {any[]} */ let liste;
    try { liste = (await appelCompte('GET', '/moi/appareils')).appareils; } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    el.innerHTML = `<p class="small muted mb">Chaque navigateur ou téléphone où tu t'es connecté. Un appareil perdu, volé ou donné se retire ici : il ne peut plus rien ouvrir, et ce qu'il garde pour travailler sans réseau s'efface à sa prochaine connexion.</p>
      <table class="list compact" id="appareils-liste"><tbody>${liste.map((a) => `<tr><td><strong>${esc(a.nom)}</strong>${a.celuiCi ? ' <span class="badge">cet appareil</span>' : ''}
        <div class="small muted">${a.retireLe ? `Retiré le ${esc(jour(a.retireLe))}` : a.derniereActivite ? `Dernière activité le ${esc(jour(a.derniereActivite))}` : ''}</div></td>
        <td class="r">${a.celuiCi || a.retireLe ? '' : `<button type="button" class="btn btn-sm" data-retirer="${esc(a.id)}">Retirer…</button>`}</td></tr>`).join('')}</tbody></table>
      <p class="small" role="alert"></p>`;
    /** @param {unknown} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    el.querySelectorAll('[data-retirer]').forEach((b) => {
      const bouton = /** @type {HTMLElement} */ (b);
      bouton.onclick = async () => {
        const a = liste.find((x) => x.id === bouton.dataset.retirer);
        // Retirer se demande d'abord : l'appareil ne pourra plus rien ouvrir.
        if (!bouton.dataset.confirme) {
          bouton.dataset.confirme = '1';
          bouton.textContent = 'Oui, le retirer';
          dire(`« ${a ? a.nom : ''} » ne pourra plus rien ouvrir, et ce qu'il garde s'effacera à sa prochaine connexion.`);
          return;
        }
        bouton.setAttribute('disabled', '');
        try { await appelCompte('DELETE', `/moi/appareils/${encodeURIComponent(String(bouton.dataset.retirer))}`); await dessinerAppareils(el); } catch (x) { bouton.removeAttribute('disabled'); dire(x); }
      };
    });
  }
  // Ouvrir une entreprise, et s'en souvenir pour la prochaine fois (la même clé que l'entrée).
  /** @param {string} id */
  function ouvrirEntreprise(id) {
    try { localStorage.setItem('skanfact.entreprise', id); } catch { /* sans stockage : la première la prochaine fois */ }
    location.assign(`/v10/?e=${encodeURIComponent(id)}`);
  }
  const PARTAGE = 'Sur la plateforme, une entreprise n\'est plus un fichier à poser dans un dossier partagé : elle vit sur le serveur, et chacun l\'ouvre avec son propre compte. L\'invitation d\'un collaborateur arrive dans une prochaine étape.';
  // Ce qui n'existe pas encore en ligne se refuse avec sa phrase : ce qui est refusé, et que rien n'a changé.
  /** @param {string} quoi */
  function pasEncore(quoi) {
    return async () => { throw new Error(`${quoi} n'est pas encore dans la version en ligne de SkanFact : rien n'a été fait.`); };
  }
  /** @param {string} nom @param {string} contenu */
  function telecharger(nom, contenu) {
    const propre = String(nom || 'export.txt').replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(new Blob([contenu], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = propre; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return `Téléchargements/${propre}`;
  }
  // Le sélecteur de fichier du navigateur ; `null` si la personne l'a fermé sans choisir.
  /** @param {string} accepte @returns {Promise<File | null>} */
  function choisirFichier(accepte) {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = accepte; i.hidden = true;
      i.addEventListener('change', () => { resolve(i.files && i.files[0] ? i.files[0] : null); i.remove(); });
      i.addEventListener('cancel', () => { resolve(null); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  }
})();
