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
  // Sans session ou sans entreprise, retour à la connexion. Sans session, l'adresse demandée (le lien d'une facture
  // venu d'une console partenaire, brique 127) se garde dans l'onglet : la connexion y ramène.
  if (!jeton || !ent || !/^[0-9a-f-]{36}$/.test(ent)) {
    if (!jeton && ent) try { sessionStorage.setItem('skanfact.destination', location.pathname + location.search + location.hash); } catch { /* sans stockage : l'accueil */ }
    location.replace('/'); return;
  }

  /** @param {string} methode @param {string} chemin @param {unknown} [corps] */
  async function appel(methode, chemin, corps) {
    /** @type {Record<string, string>} */
    const entetes = { authorization: `Bearer ${jeton}` };
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`/v1/entreprises/${ent}${chemin}`, { method: methode, headers: entetes, cache: 'no-store', ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    } catch (e) {
      // Le réseau manque (brique 72) : le bandeau le dit, et la copie du poste prend le relais.
      poste.horsLigne();
      const x = new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
      /** @type {any} */ (x).horsLigne = true;
      throw x;
    }
    poste.enLigne();
    const texte = await r.text();
    /** @type {any} */
    const lu = texte ? JSON.parse(texte) : {};
    // La session est finie : retour à la connexion, qui dit pourquoi (un appareil retiré remet d'abord ce
    // qui attendait le réseau, puis efface ce qu'il garde : briques 74 et 74 bis).
    if (r.status === 401) { await finDeSession(lu); throw new Error('Ta session est terminée : reconnecte-toi.'); }
    // Le rôle exige le code du téléphone, pas encore en place : l'entrée le fait poser d'abord.
    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) {
      const e = new Error(typeof lu.motif === 'string' ? lu.motif : 'Le serveur a rencontré une erreur : réessaie dans un instant.');
      /** @type {any} */ (e).statut = r.status;
      // Le bouton qui débloque, quand le serveur le nomme (brique 81 : « Désigner le signataire »…).
      /** @type {any} */ (e).bouton = typeof lu.bouton === 'string' ? lu.bouton : null;
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
  // Les parties du dossier que les rôles de la personne ne lui montrent pas, et celles qu'elle lit sans pouvoir les
  // écrire (brique 99). Aucune ne repart au serveur : l'écran les retouche à son ouverture (il complète une fiche
  // d'avant, il range un article), et ce n'est pas la personne qui les change. Quand elle essaie, l'écran le lui
  // refuse avant le geste (`droitsDossier`).
  /** @type {Set<string>} */ let cachees = new Set();
  /** @type {Set<string>} */ let lectureSeule = new Set();
  // La liste blanche de ce qui peut repartir (null : tout, pour qui voit toute l'entreprise).
  /** @type {Set<string> | null} */ let ecrivables = null;
  // Le propriétaire ou un administrateur : il règle les seuils et décide des accords (brique 100).
  let responsable = false;
  // Il tient une caisse (brique 121) : la page Caisse s'ouvre, même sans lire les pièces de vente.
  let tientCaisse = false;
  /** @param {string} champ */
  const repart = (champ) => !cachees.has(champ) && !lectureSeule.has(champ) && (!ecrivables || ecrivables.has(champ));
  /** @param {any} d */
  const poserDroits = (d) => {
    cachees = new Set((d && d.cachees) || []);
    lectureSeule = new Set((d && d.lectureSeule) || []);
    ecrivables = !d || d.tout !== false ? null : new Set(d.ecrivables || []);
    responsable = !!(d && d.responsable === true);
    tientCaisse = !!(d && d.caisse === true);
  };
  /** @param {Record<string, unknown>} data @returns {Map<string, Morceau>} */
  function decouper(data) {
    /** @type {Map<string, Morceau>} */
    const m = new Map();
    for (const [champ, brut] of Object.entries(data)) {
      if (brut === undefined || typeof brut === 'function') continue;
      if (!repart(champ)) continue;
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
    // La racine d'abord, quel que soit l'ordre reçu : une liste vide restée à la racine (`_racine/accounts` = [],
    // écrite quand la liste était vide) ne recouvre jamais les objets de la liste. Arrivée après eux (une base qui
    // range « _racine » après « accounts »), elle les effaçait de la page, qui les supprimait ensuite en enregistrant.
    for (const o of objets) if (o.collection === '_racine') data[o.cle] = decoder(o.contenu);
    for (const o of objets) {
      if (o.collection === '_racine') continue;
      if (!Array.isArray(data[o.collection])) data[o.collection] = [];
      data[o.collection].push(decoder(o.contenu));
    }
    return data;
  }

  // Ce que le serveur a de chaque objet : son contenu (tel qu'envoyé) et sa révision.
  /** @type {Map<string, { json: string, rang: number | null, revision: number }>} */
  let vu = new Map();
  // La révision de chaque objet telle que la PAGE l'a eue (brique 112). `vu` suit le serveur : après un conflit, le
  // point de contact le relit, avant que la page ait fusionné. Un enregistrement parti entre les deux (ses données
  // d'avant) se comparait à ce `vu` neuf : il supprimait ce qu'un autre poste venait de créer (la page ne l'avait
  // jamais eu), et écrasait ce qu'il venait de changer (avec la révision du serveur, sans conflit). Il part
  // maintenant de ce que la page a eu : un objet qu'elle n'a jamais eu ne se supprime pas, et un objet changé
  // ailleurs fait un conflit (le serveur le refuse), que la page fusionne.
  /** @type {Map<string, number>} */
  let base = new Map();
  // Les pièces qu'un autre a faites (brique 117) : « collection/clé » → le nom de son auteur ('' si inconnu).
  /** @type {Record<string, string>} */
  let autrui = {};
  // La page reçoit ces données-là (une ouverture, une copie) : elle a désormais chaque objet de `vu`.
  const adopter = () => { base = new Map([...vu].map(([k, v]) => [k, v.revision])); };

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
      // Un ticket encaissé sans réseau part par la file des tickets, jamais avec le dossier (brique 120).
      if (m.collection === 'documents' && m.json.includes('"caisseHorsLigne":true')) continue;
      const avant = vu.get(k);
      // La page a la version du serveur : elle l'a désormais (une fusion la lui a donnée).
      if (avant && avant.json === m.json) base.set(k, avant.revision);
      if (!avant || avant.json !== m.json || avant.rang !== m.rang) {
        changements.push({ collection: m.collection, cle: m.cle, rang: m.rang, revision: base.has(k) ? base.get(k) ?? null : null, contenu: JSON.parse(m.json) });
      }
    }
    for (const [k] of vu) {
      if (!maintenant.has(k)) {
        const [collection = '', cle = ''] = k.split('\u0000');
        // Une partie qui ne repart pas n'est pas supprimée pour autant : on ne l'a simplement pas renvoyée.
        if (!repart(collection === '_racine' ? cle : collection)) continue;
        // Un objet que la page n'a jamais eu (un autre poste vient de le créer) ne se supprime pas : elle ne l'a pas retiré.
        if (!base.has(k)) continue;
        changements.push({ collection, cle, rang: null, revision: base.get(k) ?? null, contenu: null });
      }
    }
    return changements;
  }
  // Envoyer le dossier : `true` quand le serveur a tout ; `{ conflict, disk }` quand un objet a changé
  // ailleurs ; `{ horsLigne }` quand le réseau manque et que ce poste a gardé l'enregistrement (brique 73).
  /** @param {Record<string, unknown>} data */
  async function envoyer(data) {
    try { await envoyerReponses(data); } catch (e) { if (gardableHorsLigne(e)) return await mettreEnAttente(data); throw refusHorsLigne(e); }
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
        throw refusHorsLigne(e);
      }
      for (const [j, c] of lot.entries()) {
        const k = `${c.collection}\u0000${c.cle}`;
        const rev = r.revisions[j] && r.revisions[j].revision;
        if (c.contenu === null) { vu.delete(k); base.delete(k); } else { vu.set(k, { json: JSON.stringify(c.contenu), rang: c.rang, revision: rev }); base.set(k, rev); }
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
  // Relire par différence (brique 119 ; docs/leger.md, S4) : sur « mon ordinateur », la copie du poste porte la marque de
  // sa dernière lecture ; le serveur ne renvoie que ce qui a changé depuis (et ce qui a été retiré), que la copie reçoit.
  // Sans copie, ou quand le serveur ne peut pas compléter cette copie-là (une autre base, d'autres rôles), tout repart.
  /** @type {string} */ let marqueLue = '';
  /** @type {string} */ let profilLu = '';
  async function relire() {
    const copie = poste.garde() ? (await poste.lireCopie(ent).catch(() => null))?.contenu : null;
    const depuis = copie && copie.marque && copie.profil ? `?depuis=${encodeURIComponent(copie.marque)}&profil=${encodeURIComponent(copie.profil)}` : '';
    const r = await appel('GET', `/dossier-v10${depuis}`);
    poserDroits(r.droits);
    autrui = r.autrui || {};
    /** @type {any[]} */
    let objets = r.objets;
    if (r.partiel && copie) {
      /** @type {Map<string, any>} */
      const tous = new Map(copie.objets.map((/** @type {any} */ o) => [`${o.collection}\u0000${o.cle}`, o]));
      for (const x of r.retires || []) tous.delete(`${x.collection}\u0000${x.cle}`);
      for (const o of r.objets) tous.set(`${o.collection}\u0000${o.cle}`, o);
      // Dans l'ordre que le serveur rendrait : la racine, puis chaque liste par rang.
      objets = [...tous.values()].sort((a, b) => (a.collection === '_racine' ? 0 : 1) - (b.collection === '_racine' ? 0 : 1)
        || (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0) || (a.rang ?? 0) - (b.rang ?? 0) || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
    }
    marqueLue = r.marque || ''; profilLu = r.profil || '';
    vu = new Map();
    for (const o of objets) vu.set(`${o.collection}\u0000${o.cle}`, { json: JSON.stringify(o.contenu), rang: o.rang, revision: o.revision });
    const data = assembler(objets);
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
  // La copie : les objets et leurs révisions, les questions, les droits, et la marque de la lecture qu'elle reflète.
  const contenuDeLaCopie = () => ({ objets: objetsVus(), questions: questionsLues, marque: marqueLue, profil: profilLu,
    droits: { cachees: [...cachees], lectureSeule: [...lectureSeule], ecrivables: ecrivables ? [...ecrivables] : [], tout: !ecrivables, responsable, caisse: tientCaisse } });
  function garderLaCopie() {
    if (!poste.garde()) return;
    if (copieAFaire) clearTimeout(copieAFaire);
    copieAFaire = setTimeout(() => {
      copieAFaire = null;
      poste.ecrireCopie(ent, contenuDeLaCopie()).catch(() => { /* sans copie, le hors-ligne attendra la prochaine */ });
    }, 300);
  }
  // Un ticket encaissé est un fait : la copie le garde AVANT que l'écran ne le dise (défaut trouvé le 01/10/2026 : une
  // page rouverte sans réseau dans les 300 ms oubliait le dernier ticket en ligne, jusqu'au retour du réseau).
  async function garderLaCopieMaintenant() {
    if (!poste.garde()) return;
    if (copieAFaire) { clearTimeout(copieAFaire); copieAFaire = null; }
    await poste.ecrireCopie(ent, contenuDeLaCopie()).catch(() => { /* sans copie, le hors-ligne attendra la prochaine */ });
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
  const gardableHorsLigne = (e) => !!(e && /** @type {any} */ (e).horsLigne) && poste.garde() && !poste.limite();
  // Sans réseau, sur un poste qui ne peut pas garder (brique 75 : pas de stockage persistant, ou plus
  // de 72 heures sans le serveur) : le refus dit pourquoi, et reste un refus « hors ligne ».
  /** @param {unknown} e */
  const refusHorsLigne = (e) => {
    const l = e && /** @type {any} */ (e).horsLigne && poste.garde() ? poste.limite() : null;
    return l ? Object.assign(new Error(l), { horsLigne: true }) : e;
  };
  /** @param {Record<string, unknown>} data */
  async function mettreEnAttente(data) {
    // La base d'abord : ce que le serveur a déjà reçu (un premier paquet parti avant la coupure).
    await poste.ecrireCopie(ent, contenuDeLaCopie());
    await poste.ecrireAttente(ent, { data });
    attenteGardee = true;
    attenteN = compter(changementsDe(data));
    annoncerAttente();
    return { horsLigne: true };
  }
  /** @param {number} conflits */
  async function finirAttente(conflits) {
    const n = attenteN;
    attenteGardee = false; attenteN = 0;
    await poste.effacerAttente(ent);
    poste.envoye(n, conflits);
  }
  // ── La caisse sans réseau (brique 120 ; docs/caisse.md, H1 à H4) ────────────────────────────────────────────
  // Le poste qui tient la caisse sait, depuis son dernier contact, la forme de la série, le prochain numéro et la fin de
  // sa chaîne (`numerotation`, gardée sur « mon ordinateur » seulement : des numéros et une empreinte, rien d'autre).
  // Sans réseau, il numérote et chaîne lui-même ; ses tickets attendent chiffrés, dans l'ordre (`fileTickets`).
  // La même formule que serveur/caisse/chaine.ts : elles ne divergent pas.
  const CLE_NUMEROTATION = `skanfact.caisse.${ent}`;
  /** @type {any} */ let numerotation = null;
  try { numerotation = poste.garde() ? JSON.parse(localStorage.getItem(CLE_NUMEROTATION) || 'null') : null; } catch { numerotation = null; }
  /** @param {any} n */
  function retenirNumerotation(n) {
    numerotation = n || null;
    try { if (numerotation && poste.garde()) localStorage.setItem(CLE_NUMEROTATION, JSON.stringify(numerotation)); else localStorage.removeItem(CLE_NUMEROTATION); } catch { /* sans mémoire : pas de caisse sans réseau */ }
  }
  /** @param {unknown} v @returns {unknown} */
  const trier = (v) => (Array.isArray(v) ? v.map(trier) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((c) => [c, trier(/** @type {any} */ (v)[c])])) : v);
  /** @param {string} t */
  const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((o) => o.toString(16).padStart(2, '0')).join('');
  /** @param {any} doc @param {string} net @param {string} numero @param {string} encaisseLe */
  const ticketDuPoste = (doc, net, numero, encaisseLe) => ({ numero, encaisseLe, date: doc.date ?? null, client: doc.clientId || '', lignes: doc.lines ?? [], netAPayer: net,
    paiements: (Array.isArray(doc.payments) ? doc.payments : []).map((/** @type {any} */ p) => ({ mode: p.method ?? null, montant: p.amount ?? null })) });
  /** @param {string} format @param {string} prefixe @param {number} annee @param {number} n */
  const formaterNumero = (format, prefixe, annee, n) => {
    const largeur = Number((/\{N:([1-9])\}/.exec(format) || [])[1] || 1);
    return format.replaceAll('{P}', prefixe).replaceAll('{AAAA}', String(annee)).replace(/\{N(:[1-9])?\}/, String(n).padStart(largeur, '0'));
  };
  // Le ticket que le poste fait : son numéro (une série remise à zéro chaque année repart à 1 au changement d'année), et
  // son maillon : empreinte = sha256(précédente || sha256(ticket)).
  /** @param {any} document @param {string} net */
  async function faireTicket(document, net) {
    const n = numerotation;
    const annee = Number(String(document.date || '').slice(0, 4)) || new Date().getFullYear();
    const numero = n.serie.remise === 'annuelle' && n.prochain.periode !== annee ? 1 : n.prochain.numero;
    const texte = formaterNumero(n.serie.format, n.serie.prefixe, annee, numero);
    const encaisseLe = new Date().toISOString();
    const empreinte = await sha256(n.chaine + await sha256(JSON.stringify(trier(ticketDuPoste(document, net, texte, encaisseLe)))));
    return { poste: { session: n.session, numero: texte, precedente: n.chaine, empreinte, encaisseLe, horsLigne: false },
      etat: { ...n, prochain: { numero: numero + 1, periode: n.serie.remise === 'annuelle' ? annee : n.prochain.periode } } };
  }
  /** @type {any[]} */ let fileTickets = [];
  const CLE_FILE = `${ent}#tickets`;
  const ecrireFileTickets = async () => { if (fileTickets.length) await poste.ecrireAttente(CLE_FILE, { tickets: fileTickets }); else await poste.effacerAttente(CLE_FILE); };
  const lireFileTickets = async () => { const f = await poste.lireAttente(CLE_FILE).catch(() => null); fileTickets = f && Array.isArray(f.contenu.tickets) ? f.contenu.tickets : []; };
  // Ce qui attend le réseau : les changements du dossier et les tickets.
  const annoncerAttente = () => poste.attente(attenteN + fileTickets.length);
  // Les tickets qui attendent se montrent à l'écran (la page s'ouvre sur la copie du serveur, qui ne les a pas encore).
  /** @param {any} data */
  function avecTicketsEnAttente(data) {
    if (!data || !Array.isArray(data.documents) || !fileTickets.length) return data;
    const ids = new Set(data.documents.map((/** @type {any} */ d) => d.id));
    for (const t of fileTickets) if (!ids.has(t.document.id)) data.documents.push(decoder({ ...t.document, number: t.poste.numero, numeroPoste: t.poste.numero, status: 'envoyée', caisseHorsLigne: true }));
    return data;
  }
  // Remettre les tickets, dans l'ordre, un par un ; chacun remplace à l'écran celui que le poste montrait. Un refus du
  // serveur (autre que le réseau) arrête la remise et se dit : le ticket reste gardé, rien n'est perdu.
  /** @type {Promise<number> | null} */ let remise = null;
  function remettreTickets() {
    if (remise) return remise;
    remise = (async () => {
      let n = 0;
      /** @type {any} */ let dernier = null;
      while (fileTickets.length) {
        const t = fileTickets[0];
        try { dernier = await appel('POST', '/dossier-v10/ticket', t); } catch (e) {
          if (!(/** @type {any} */ (e).horsLigne)) poste.annoncer(`Le ticket ${t.poste.numero}, encaissé sans réseau, n'a pas pu être remis : ${/** @type {any} */ (e).message || e}. Il reste gardé sur ce poste.`, 'Réessayer', () => { void remettreTickets(); });
          break;
        }
        const k = `documents\u0000${t.document.id}`;
        vu.set(k, { json: JSON.stringify(dernier.contenu), rang: t.rang, revision: dernier.revision });
        base.set(k, dernier.revision);
        const L = /** @type {any} */ (window).__data && /** @type {any} */ (window).__data.documents;
        if (Array.isArray(L)) { const i = L.findIndex((/** @type {any} */ d) => d.id === t.document.id); if (i >= 0) L[i] = decoder(dernier.contenu); }
        fileTickets.shift();
        await ecrireFileTickets();
        n++;
      }
      // Tout est remis : l'état du serveur fait foi pour la suite.
      if (!fileTickets.length && dernier) retenirNumerotation(dernier.caisse);
      if (n) {
        garderLaCopie();
        // Tout est parti (et rien d'autre n'attend) : le bandeau le dit ; sinon, il compte ce qui attend encore.
        if (!fileTickets.length && !attenteGardee) poste.envoye(n); else annoncerAttente();
        // La page Caisse redit son état (elle disait « Sans réseau »).
        window.dispatchEvent(new Event('skanfact-tickets-remis'));
      }
      return n;
    })().finally(() => { remise = null; });
    return remise;
  }
  // Au retour du réseau, et toutes les 30 secondes tant que quelque chose attend : les tickets d'abord, dans l'ordre,
  // puis l'écran réenregistre.
  const relancer = () => {
    const w = /** @type {any} */ (window);
    void (fileTickets.length ? remettreTickets() : Promise.resolve(0)).then(() => {
      if (!fileTickets.length && attenteGardee && !enCours && w.__data && typeof w.__enregistrerMaintenant === 'function') w.__enregistrerMaintenant();
    });
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
      // Ce qui attendait a été fait sur la copie : la page l'avait.
      adopter();
      questionsLues = c.contenu.questions || [];
      poserDroits(c.contenu.droits);
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

  // ── Un appareil retiré (briques 74 et 74 bis ; docs/hors-ligne.md, H9 et H10) ─────────────────
  // La session est finie (401). Si le serveur dit que cet appareil est retiré (`effacer`), ce qui
  // attendait le réseau lui est d'abord REMIS (en quarantaine : le propriétaire décidera), puis le poste
  // oublie tout ; l'entrée le dit. Si la remise ne passe pas (le réseau retombe, le serveur trébuche),
  // rien ne s'efface : la prochaine connexion réessaiera.
  /** @type {Promise<void> | null} */ let finEnCours = null;
  /** @param {any} lu */
  const finDeSession = (lu) => (finEnCours = finEnCours || (async () => {
    if (lu && lu.effacer) {
      if ((await remettre()) === null) {
        poste.sansCopie('Cet appareil a été retiré de ton compte. Ce qu\'il avait enregistré sans réseau n\'a pas encore pu être remis au serveur : rien n\'est effacé tant qu\'il ne l\'a pas reçu.');
        return;
      }
      await poste.effacer();
    }
    location.replace('/');
  })());
  // Remettre ce qui attend, par rapport à ce que le poste avait vu (`vu` : la copie, que la page ait
  // gardé l'attente ou l'ait relue à l'ouverture) : le nombre de changements que le serveur a reçus (0
  // s'il n'y avait rien à remettre), ou null quand la remise n'a pas pu passer.
  /** @returns {Promise<number | null>} */
  async function remettre() {
    const attente = await poste.lireAttente(ent).catch(() => null);
    if (!attente) return 0;
    const changements = changementsDe(attente.contenu.data);
    if (!changements.length) return 0;
    try {
      const r = await fetch('/v1/quarantaine', {
        method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
        body: JSON.stringify({ entreprise: ent, changements }),
      });
      if (r.status >= 500) return null;
      /** @type {any} */ const lu = await r.json().catch(() => ({}));
      return typeof lu.recus === 'number' ? lu.recus : 0;
    } catch { return null; }
  }
  // L'entreprise ne s'ouvre plus à cette personne (retirée de son équipe, brique 76 ; 03 D8) : ce qui
  // l'attendait est remis, puis ce que le poste en gardait s'efface — elle seule —, et le bandeau le dit.
  async function plusOuverte() {
    const recus = await remettre();
    if (recus === null) {
      poste.sansCopie('Cette entreprise ne t\'est plus ouverte. Ce que tu y avais enregistré sans réseau n\'a pas encore pu être remis au serveur : rien n\'est effacé tant qu\'il ne l\'a pas reçu.');
      return await new Promise(() => { /* rien ne s'ouvre */ });
    }
    await poste.effacerEntreprise(ent);
    const remis = recus > 1 ? `, et tes ${recus} changements faits hors ligne sont remis à son propriétaire, qui décidera`
      : recus === 1 ? ', et ton changement fait hors ligne est remis à son propriétaire, qui décidera' : '';
    poste.conclure(`Cette entreprise ne t'est plus ouverte (tu as été retiré de son équipe, ou elle n'existe plus) : ce que ce poste en gardait est effacé${remis}.`);
    return await new Promise(() => { /* rien ne s'ouvre */ });
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
    adopter();
    const data = assembler(c.contenu.objets);
    data.questionsCabinet = questionsLues = c.contenu.questions || [];
    poserDroits(c.contenu.droits);
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
  style.textContent = `${PANNEAUX_ABSENTS.map((id) => `#${id}`).join(', ')} { display: none !important; }
    .ttn-etat { display: block; min-height: 1.4em; }`;
  document.head.appendChild(style);

  // ── Ton cabinet comptable (brique 37 ; docs/cabinet.md) ─────────────────────────────────────
  // Plus d'appairage ni de paquets : le propriétaire confie son dossier à son cabinet en tapant le
  // code du cabinet (un MANDAT, que l'associé accepte). Le panneau de la v10 se dessine ici.
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  /** @param {string} iso */
  const jour = (iso) => { const [a, m, j] = String(iso).slice(0, 10).split('-'); return `${j}/${m}/${a}`; };
  // Le jour d'un instant, à Tunis (un instant n'est pas un jour : à 0 h 30 à Tunis, il est encore la veille en UTC).
  /** @param {string} iso */
  const jourATunis = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' });
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
    dessinerQuarantaine,
    dessinerPaiement,
    dessinerServices,
    // L'application de bureau (brique 138) : l'impression par l'agent local, seulement quand il est là.
    ...(/** @type {any} */ (window).skanfactBureau ? { dessinerImprimante, imprimerTicket: imprimerParAgent, ticketEncaisse } : {}),
    lienClient,
    ajouterLien,
    sansPieceJointe,
    lienBascule,
    teifDuServeur,
    dessinerSignataire,
    signerPiece,
    dessinerASigner,
    dessinerTtn,
    ttnDansLaFenetre,
    etatsTtn: remplirEtats,
    // Des remises attendent-elles une décision ? (le panneau ne paraît que dans ce cas)
    quarantaine: () => remises.length,
    loadData: async () => {
      // Le code QR de la TTN sur la pièce imprimée (brique 83) : le moteur est là, on le branche.
      const qr = /** @type {any} */ (window).SkanQr;
      if (qr) qr.brancher();
      const attente = await poste.lireAttente(ent).catch(() => null);
      await lireFileTickets();
      try {
        // Les tickets encaissés sans réseau partent d'abord, dans l'ordre ; ceux qui attendent encore se montrent.
        if (fileTickets.length) await remettreTickets();
        const data = avecTicketsEnAttente(attente ? await rejouer(attente.contenu.data) : await relire());
        if (fileTickets.length) annoncerAttente();
        // La page reçoit ce dossier : elle a chacun de ses objets (brique 112).
        adopter();
        await chargerRemises();
        return { data, corruptFile: null };
      } catch (e) {
        if (/** @type {any} */ (e).statut === 404) return await plusOuverte();
        if (!/** @type {any} */ (e).horsLigne) throw e;
        const copie = avecTicketsEnAttente(await lireLaCopie());
        if (fileTickets.length) annoncerAttente();
        if (!attente) return { data: copie, corruptFile: null };
        // Ce qui a été enregistré sans réseau se montre, et attend toujours.
        attenteGardee = true;
        attenteN = compter(changementsDe(attente.contenu.data));
        annoncerAttente();
        return { data: attente.contenu.data, corruptFile: null };
      }
    },
    saveData: (/** @type {Record<string, unknown>} */ data) => enregistrer(data),
    dataPath: async () => 'Serveur SkanFact',
    setTitle: (/** @type {string} */ t) => { document.title = t; },

    // L'émission d'une facture ou d'un avoir (adaptation de `issue()` dans app.js) : le serveur prend la pièce telle
    // que l'écran la montre, la numérote, la scelle, et vérifie qu'il trouve le même net à payer.
    // Ce que la personne peut écrire dans le dossier (brique 99) : l'écran refuse avant le geste ce qui ne repartirait pas.
    droitsDossier: () => ({ cachees: [...cachees], lectureSeule: [...lectureSeule], ecrivables: ecrivables ? [...ecrivables] : null, responsable, caisse: tientCaisse }),

    // L'accord d'un responsable au-delà de l'encours d'un client (brique 100 ; docs/accords.md) : le serveur
    // recalcule le dépassement, garde la demande, et seul un responsable la décide.
    demanderAccord: async (/** @type {any} */ doc) => appel('POST', '/dossier-v10/accord', { document: encoder(doc) }),
    // La commande fournisseur au-delà du montant permis sans accord (brique 114).
    demanderAccordCommande: async (/** @type {any} */ commande) => appel('POST', '/dossier-v10/accord-commande', { commande: encoder(commande) }),
    accords: async () => appel('GET', '/accords'),
    deciderAccord: async (/** @type {string} */ id, /** @type {'accorder' | 'refuser'} */ decision, /** @type {string} */ motif) =>
      appel('POST', `/accords/${encodeURIComponent(id)}/decider`, motif ? { decision, motif } : { decision }),

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
      base.set(k, r.revision);
      garderLaCopie();
      return decoder(r.contenu);
    },

    // Le ticket de caisse (brique 115 ; docs/caisse.md) : numéroté dans sa série (TIC) et scellé par le serveur, payé
    // dans le même geste. Sans réseau (brique 120, H1 à H4) : le poste qui tient la caisse le numérote et le chaîne
    // lui-même, le garde chiffré, et le remet dans l'ordre au retour du réseau.
    encaisser: async (/** @type {any} */ doc, /** @type {number} */ netAPayer, /** @type {any} */ options) => {
      // (brique 125) Une remise au-delà du plafond : le code d'un responsable, que seul le serveur vérifie (sans réseau, la
      // liste des responsables ne se lit pas : la page ne l'envoie jamais ; un ticket remisé sans code devient une alerte).
      const responsable = options && options.responsable ? options.responsable : null;
      if (enCours) await enCours;
      const decimales = !doc.currency || doc.currency === 'DT' || doc.currency === 'TND' ? 3 : 2;
      const net = Number(netAPayer).toFixed(decimales);
      const k = `documents\u0000${doc.id}`;
      const liste = /** @type {any} */ (window).__data && /** @type {any} */ (window).__data.documents;
      const rang = Array.isArray(liste) ? liste.length : null;
      // Le document tel qu'il part (et tel que le serveur le lira) : c'est lui que la chaîne retient.
      const document = JSON.parse(JSON.stringify(encoder(doc)));
      // Des tickets attendent encore le réseau : celui-ci part après eux, jamais avant.
      if (fileTickets.length) await remettreTickets();
      const fait = numerotation ? await faireTicket(document, net) : null;
      try {
        if (fileTickets.length) throw Object.assign(new Error('hors ligne'), { horsLigne: true });
        const r = await appel('POST', '/dossier-v10/ticket', { document, rang, netAPayer: net, ...(fait ? { poste: fait.poste } : {}), ...(responsable ? { responsable } : {}) });
        retenirNumerotation(r.caisse);
        vu.set(k, { json: JSON.stringify(r.contenu), rang, revision: r.revision });
        base.set(k, r.revision);
        await garderLaCopieMaintenant();
        return decoder(r.contenu);
      } catch (e) {
        if (!(/** @type {any} */ (e).horsLigne)) throw e;
        // Sans réseau : sur « mon ordinateur », sur le poste qui tient la caisse, et 7 jours au plus sans le serveur.
        const refus = !poste.garde() ? 'Sans réseau, la caisse n\'encaisse que sur « mon ordinateur » (la session gardée sur cet appareil) : rien n\'a été vendu. Réessaie au retour du réseau.'
          : !fait ? 'Sans réseau, la caisse n\'encaisse que sur l\'appareil qui la tient, ouverte avant la coupure : rien n\'a été vendu. Réessaie au retour du réseau.'
            : poste.limiteCaisse();
        if (refus || !fait) throw new Error(refus || String(e), { cause: e });
        const p = { ...fait.poste, horsLigne: true };
        fileTickets.push({ document, rang, netAPayer: net, poste: p });
        await ecrireFileTickets();
        retenirNumerotation({ ...fait.etat, chaine: p.empreinte });
        annoncerAttente();
        // L'écran montre le ticket, avec le numéro que le poste a imprimé ; il ne repart pas avec le dossier (il part
        // par la file des tickets).
        return decoder({ ...document, number: p.numero, numeroPoste: p.numero, status: 'envoyée', caisseHorsLigne: true });
      }
    },

    // La session de caisse (brique 116) : son état, l'ouvrir avec le fond de caisse, la fermer en comptant le tiroir.
    // L'auteur d'une pièce faite par un autre (brique 117), sinon null : l'écran refuse de la supprimer avant le geste.
    auteurAutre: (/** @type {string} */ collection, /** @type {string} */ id) => (`${collection}/${id}` in autrui ? autrui[`${collection}/${id}`] ?? '' : null),
    caisse: async () => { const r = await appel('GET', '/caisse'); retenirNumerotation(r.numerotation); return r; },
    // Sans réseau, ce poste tient-il la caisse ? Le prochain numéro qu'il donnera, ou null (brique 120).
    caisseSansReseau: () => {
      if (!numerotation || !poste.garde()) return null;
      const annee = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4));
      const n = numerotation.serie.remise === 'annuelle' && numerotation.prochain.periode !== annee ? 1 : numerotation.prochain.numero;
      return { prochain: formaterNumero(numerotation.serie.format, numerotation.serie.prefixe, annee, n) };
    },
    ouvrirCaisse: async (/** @type {string} */ fond) => { const r = await appel('POST', '/caisse/ouvrir', { fond }); retenirNumerotation(r.numerotation); return r; },
    fermerCaisse: async (/** @type {string} */ compte) => appel('POST', '/caisse/fermer', { compte }),
    // Les Z passés (brique 126), par pages : `avant`, la `suite` de la page précédente.
    listeZ: async (/** @type {string | undefined} */ avant) => appel('GET', `/caisse/z${avant ? `?avant=${encodeURIComponent(avant)}` : ''}`),
    // Le retour à la caisse (brique 124 ; docs/caisse.md, T1 à T5) : le serveur numérote l'avoir, rend l'argent sur le
    // ticket et le compte au Z ; un caissier y joint le code d'un responsable présent. Il faut le réseau.
    responsables: async () => (await appel('GET', '/caisse/responsables')).responsables,
    poserCodeResponsable: async (/** @type {string} */ code) => appel('PUT', '/caisse/code-responsable', { code }),
    rendreTicket: async (/** @type {any} */ ticket, /** @type {any} */ avoir, /** @type {any} */ paiement, /** @type {number} */ montant, /** @type {any} */ responsable) => {
      if (enCours) await enCours;
      const decimales = !avoir.currency || avoir.currency === 'DT' || avoir.currency === 'TND' ? 3 : 2;
      const liste = /** @type {any} */ (window).__data && /** @type {any} */ (window).__data.documents;
      const rang = Array.isArray(liste) ? liste.length : null;
      const r = await appel('POST', '/dossier-v10/rendre', { ticket: ticket.id, avoir: encoder(avoir), rang,
        netAPayer: Number(montant).toFixed(decimales), paiement: encoder(paiement), ...(responsable ? { responsable } : {}) });
      for (const [cle, x] of [[ticket.id, r.ticket], [avoir.id, r.avoir]]) {
        const k = `documents\u0000${cle}`;
        vu.set(k, { json: JSON.stringify(x.contenu), rang: cle === avoir.id ? rang : vu.get(k)?.rang ?? null, revision: x.revision });
        base.set(k, x.revision);
      }
      await garderLaCopieMaintenant();
      return { avoir: decoder(r.avoir.contenu), ticket: decoder(r.ticket.contenu), numero: r.numero };
    },
    // Changer de caissier (brique 123 ; docs/caisse.md, R1 à R5) : chacun pose son code à 4 chiffres ; sur le poste de la
    // caisse, le suivant le tape et prend la main. Ce qui attend le réseau part d'abord : sinon, il partirait sous son nom.
    caissiers: async () => (await appel('GET', '/caisse/caissiers')).caissiers,
    poserCodeCaisse: async (/** @type {string} */ code) => appel('PUT', '/caisse/mon-code', { code }),
    relayerCaisse: async (/** @type {string} */ utilisateur, /** @type {string} */ code) => {
      if (fileTickets.length) await remettreTickets();
      if (fileTickets.length || attenteGardee || enCours) {
        throw new Error('Ce poste a encore des ventes ou des changements à envoyer au serveur : ils partent sous le nom de qui les a faits. Change de caissier quand le bandeau dit qu\'ils sont enregistrés.');
      }
      const r = await appel('POST', '/caisse/relais', { utilisateur, code });
      // Le jeton du suivant remplace celui du poste, là où il était gardé : dans la session (lue en premier), et dans la
      // mémoire du navigateur si le poste l'y gardait (vu à la main le 01/10/2026 : remplacé là seulement, la page relisait
      // l'ancien jeton, fermé par le relais, et retombait sur la connexion). La page se relit ensuite avec lui. La copie du
      // précédent ne lui sert pas : elle porte sa personne (le « profil » de la relecture), et le serveur renvoie tout.
      try {
        sessionStorage.setItem('skanfact.jeton', r.jeton);
        if (localStorage.getItem('skanfact.jeton')) localStorage.setItem('skanfact.jeton', r.jeton);
      } catch { /* stockage refusé : la session ne tiendrait pas au rechargement */ }
      return r;
    },

    // ── Les entreprises (les « dossiers » de la v10) ──────────────────────────────────────────
    // Un dossier de la v10 était un fichier sur l'ordinateur ; ici, c'est une entreprise du compte.
    // Le tableau de bord du groupe (brique 113) : les sociétés de la personne, leurs chiffres lus dans leurs livres.
    groupe: async () => appelCompte('GET', '/moi/groupe'),
    listDossiers: async () => {
      let moi;
      try { moi = await appelCompte('GET', '/moi'); } catch (e) {
        // Une session ouverte par un code de caisse (brique 123) ne sert qu'à cette caisse : l'entreprise ouverte seulement.
        if (/** @type {any} */ (e).bouton === 'session_de_caisse') {
          const nom = String((((/** @type {any} */ (window).__data) || {}).company || {}).name || '');
          return { dossiers: [{ id: ent, name: nom, shared: false, dir: 'Session de caisse' }], current: ent, device: { name: '' }, retires: [] };
        }
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
      // Un tableur (CSV, ou classeur Excel décompressé dans le navigateur : plateforme/tableur.js, brique 85) ;
      // une facture électronique, telle quelle.
      const octets = new Uint8Array(await f.arrayBuffer());
      const lu = xml ? /** @type {any} */ (window).SkanCompta.lireFichierTexte(octets, f.name, {}) : await /** @type {any} */ (window).SkanTableur.lire(octets, f.name);
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
    // WhatsApp s'ouvre dans un nouvel onglet. La fenêtre ouverte pendant le geste (quand le lien de la pièce
    // a d'abord été créé, brique 79) reçoit l'adresse ; sinon elle s'ouvre ici. Jamais « noopener » dans
    // `window.open` : il rend toujours null, et l'on aurait dit « bloquée » d'une fenêtre ouverte.
    ouvrirWhatsApp: async (/** @type {{ numero: string, texte: string }} */ o) => {
      const adresse = `https://wa.me/${encodeURIComponent(o.numero)}?text=${encodeURIComponent(o.texte || '')}`;
      const deja = fenetreWhatsApp;
      fenetreWhatsApp = null;
      const w = deja && !deja.closed ? deja : window.open('', '_blank');
      if (!w) throw new Error('Ton navigateur a bloqué l\'ouverture de WhatsApp : autorise les fenêtres de ce site, puis réessaie.');
      w.opener = null;
      w.location.href = adresse;
      return { ok: true };
    },

    // ── Ce qui n'est pas encore sur le serveur : un refus qui le dit, jamais une panne ─────────
    addAttachments: pasEncore('Joindre un fichier'),
    attachPath: pasEncore('Joindre un fichier'),
    openAttachment: pasEncore('Ouvrir une pièce jointe'),
    revealAttachment: pasEncore('Montrer une pièce jointe'),
    removeAttachment: async () => undefined,
    // ── La lecture d'une facture d'achat (brique 84 ; docs/achats.md) : par le serveur de SkanFact ──────
    // Le serveur dit s'il sait lire (et si cette personne a le geste) ; le fichier choisi part tel quel, et
    // revient une PROPOSITION que la fenêtre de la v10 fait relire. Les pièces jointes, elles, ne sont pas
    // encore en ligne : la lecture ne tente pas d'y ranger le fichier.
    lectureSurLeServeur: true,
    piecesJointes: false,
    ocrStatus: async () => {
      etatLecture ??= appel('GET', '/achats/lecture').catch((/** @type {any} */ e) => { if (e.horsLigne) etatLecture = null; return { disponible: false }; });
      const st = await etatLecture;
      return { hasKey: !!(st && st.disponible) };
    },
    ocrSetKey: pasEncore('La clé d\'un service de lecture à l\'étranger'),
    ocrPick: async () => {
      const f = await choisirFichier('image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf');
      if (!f) return null;
      if (f.size > LECTURE_MAX) throw new Error(`Le fichier « ${f.name} » fait ${(f.size / 1048576).toFixed(1).replace('.', ',')} Mo : au-delà de 10 Mo, il ne se lit pas. Prends une photo moins lourde.`);
      const chemin = `lecture:${++lecturesChoisies}`;
      fichiersALire.set(chemin, f);
      return { path: chemin, name: f.name, size: f.size, type: f.type };
    },
    ocrRead: async (/** @type {string} */ chemin) => {
      const f = fichiersALire.get(chemin);
      if (!f) throw new Error('Le fichier choisi n\'est plus là : choisis-le de nouveau.');
      fichiersALire.delete(chemin);
      const contenu = await new Promise((ok, ko) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
        r.onerror = () => ko(new Error(`« ${f.name} » ne se lit pas sur cet appareil.`));
        r.readAsDataURL(f);
      });
      const r = await appel('POST', '/achats/lecture', { nom: f.name, contenu });
      return Object.assign({}, r.lecture, { remarques: r.remarques || [], ou: r.ou || {}, moteur: r.moteur });
    },
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
      r = await fetch(`/v1${chemin}`, { method: methode, headers: entetes, cache: 'no-store', ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    } catch (e) {
      poste.horsLigne();
      const x = new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
      /** @type {any} */ (x).horsLigne = true;
      throw x;
    }
    poste.enLigne();
    const texte = await r.text();
    /** @type {any} */
    const lu = texte ? JSON.parse(texte) : {};
    if (r.status === 401) { await finDeSession(lu); throw new Error('Ta session est terminée : reconnecte-toi.'); }
    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    // Le bouton qui débloque voyage avec le refus (brique 123 : « session_de_caisse »).
    if (!r.ok) throw Object.assign(new Error(typeof lu.motif === 'string' ? lu.motif : 'Le serveur a rencontré une erreur : réessaie dans un instant.'), { bouton: typeof lu.bouton === 'string' ? lu.bouton : null });
    return lu;
  }
  // ── Tes appareils (brique 74 ; docs/hors-ligne.md, H9) : les voir, en retirer un ────────────
  /** @param {HTMLElement} el */
  async function dessinerAppareils(el) {
    /** @type {any[]} */ let liste;
    try { liste = (await appelCompte('GET', '/moi/appareils')).appareils; } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    el.innerHTML = `<p class="small muted mb">Chaque navigateur ou téléphone où tu t'es connecté. Un appareil perdu, volé ou donné se retire ici : il ne peut plus rien ouvrir, et ce qu'il garde pour travailler sans réseau s'efface à sa prochaine connexion.</p>
      <table class="list compact" id="appareils-liste"><tbody>${liste.map((a) => `<tr><td><strong>${esc(a.nom)}</strong>${a.celuiCi ? ' <span class="badge">cet appareil</span>' : ''}
        <div class="small muted">${a.retireLe ? `Retiré le ${esc(jourATunis(a.retireLe))}` : a.derniereActivite ? `Dernière activité le ${esc(jourATunis(a.derniereActivite))}` : ''}</div></td>
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
  // ── Services connectés (brique 134 ; docs/boutique.md, B0) : les services qui agissent pour l'entreprise avec une
  // clé de l'API (une boutique SkanEcom reliée, un outil branché), ce qu'ils peuvent faire, et « Couper l'accès ».
  // Une clé coupée ou expirée ne se montre plus : elle ne peut plus rien.
  /** @param {HTMLElement} el */
  async function dessinerServices(el) {
    /** @type {any[]} */ let cles;
    try { cles = (await appel('GET', '/cles-api')).cles; } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    const actives = cles.filter((k) => !k.revoquee_le && Date.parse(k.expire_le) > Date.now());
    el.innerHTML = `<p class="small muted mb">Les services qui agissent pour ton entreprise : une boutique SkanEcom que tu as reliée, un outil que tu as branché. Couper l'accès l'arrête tout de suite : le service ne peut plus rien faire ici, et ce qu'il a déjà fait reste (factures, paiements).</p>
      ${actives.length ? `<table class="list compact" id="services-liste"><tbody>${actives.map((k) => `<tr><td><strong>${esc(k.nom)}</strong>
        <div class="small">Peut : ${esc(k.peut.join(' ; '))}.</div>
        <div class="small muted">Relié le ${esc(jourATunis(k.cree_le))}, jusqu'au ${esc(jourATunis(k.expire_le))}${k.derniere_utilisation ? ` ; dernière action le ${esc(quand(k.derniere_utilisation))}` : ' ; aucune action encore'}.</div></td>
        <td class="r"><button type="button" class="btn btn-sm" data-couper="${esc(k.id)}">Couper l'accès…</button></td></tr>`).join('')}</tbody></table>`
      : '<p id="services-aucun">Aucun service n\'agit pour ton entreprise.</p>'}
      <p class="small" role="alert"></p>`;
    /** @param {unknown} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    el.querySelectorAll('[data-couper]').forEach((b) => {
      const bouton = /** @type {HTMLElement} */ (b);
      bouton.onclick = async () => {
        const k = actives.find((x) => x.id === bouton.dataset.couper);
        // Couper se demande d'abord : le service s'arrête tout de suite.
        if (!bouton.dataset.confirme) {
          bouton.dataset.confirme = '1';
          bouton.textContent = 'Oui, couper l\'accès';
          dire(`« ${k ? k.nom : ''} » ne pourra plus rien faire pour ton entreprise. Pour le relier de nouveau, il faudra le reconnecter depuis le service.`);
          return;
        }
        bouton.setAttribute('disabled', '');
        try {
          await appel('DELETE', `/cles-api/${encodeURIComponent(String(bouton.dataset.couper))}`);
          await dessinerServices(el);
          dire(`« ${k ? k.nom : ''} » n'a plus accès à ton entreprise.`);
        } catch (x) { bouton.removeAttribute('disabled'); dire(x); }
      };
    });
  }
  // ── L'application de bureau (brique 138 ; docs/bureau.md, C) : avec l'agent local, le ticket part droit à
  // l'imprimante de tickets, sans fenêtre d'impression ; un ticket payé en espèces ouvre le tiroir. Dans un
  // navigateur (pas d'agent), rien ne change. Un échec se dit en clair, avec ce qu'il faut vérifier.
  const bureau = /** @type {any} */ (window).skanfactBureau;
  const VERS_REGLAGE = 'Paramètres → Documents → Imprimante de tickets';
  /** @type {Record<string, string>} */
  const RAISONS_IMPRIMANTE = {
    injoignable: `l'imprimante de tickets ne répond pas : vérifie qu'elle est allumée et branchée, et son adresse (${VERS_REGLAGE})`,
    trop_lente: 'l\'imprimante de tickets n\'a pas pris le ticket : vérifie le papier et le capot, puis réessaie',
    chemin_inconnu: `le port de l'imprimante de tickets n'existe pas sur ce poste : vérifie son câble et le port réglé (${VERS_REGLAGE})`,
    refusee: `ce poste ne peut pas écrire sur le port de l'imprimante de tickets : vérifie le port réglé (${VERS_REGLAGE})`,
    sans_imprimante: `aucune imprimante de tickets n'est réglée sur ce poste (${VERS_REGLAGE})`,
  };
  /** @param {string} r */
  const phraseImprimante = (r) => RAISONS_IMPRIMANTE[r] ?? 'l\'imprimante de tickets n\'a pas répondu comme prévu : réessaie';
  /** @param {unknown} l */
  const rouleau = (l) => (Number(l) === 58 ? 58 : 80);
  // La largeur du rouleau : le réglage « Caisse et tickets » de l'entreprise, lu au moment du geste.
  const largeurCaisse = () => rouleau((/** @type {any} */ (window).__societe?.() ?? {}).caisseLargeur);
  // « Imprimer » un ticket déjà encaissé : par l'agent ; sans imprimante réglée, la fenêtre d'impression, comme avant.
  /** @param {string} html @param {unknown} largeur */
  async function imprimerParAgent(html, largeur) {
    const r = await bureau.imprimerTicket(html, rouleau(largeur), { tiroir: false });
    if (r.ok) return { ok: true };
    if (r.raison !== 'sans_imprimante') return { ok: false, raison: phraseImprimante(r.raison) };
    const w = window.open('', '_blank');
    if (!w) return { ok: false, raison: phraseImprimante('sans_imprimante') };
    w.document.write(html); w.document.close(); w.print();
    return { ok: true };
  }
  // Un ticket vient d'être encaissé : il sort tout seul, et le tiroir s'ouvre pour des espèces. Sans imprimante
  // réglée sur ce poste, rien (le ticket reste à l'écran, avec « Imprimer »).
  /** @param {string} html @param {unknown} largeur @param {boolean} especes */
  async function ticketEncaisse(html, largeur, especes) {
    if (!(await bureau.imprimante())) return { ok: true };
    const r = await bureau.imprimerTicket(html, rouleau(largeur), { tiroir: especes === true });
    return r.ok ? { ok: true } : { ok: false, raison: `Ticket encaissé, mais pas imprimé : ${phraseImprimante(r.raison)}.` };
  }
  /** @param {number} l */
  const ticketDEssai = (l) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>@page { size: ${l}mm auto; margin: 0 }
    html, body { margin: 0; background: #fff; color: #000 } body { width: ${l}mm; padding: 4mm 3.5mm 6mm; box-sizing: border-box;
    font: 12px/1.45 Arial, sans-serif; text-align: center } b { font-size: 16px }</style></head><body>
    <b>SkanFact</b><br>Essai d'impression<br>le ${esc(quand(new Date().toISOString()))}
    <br><br>Rouleau de ${l} mm.<br>Si ce ticket se lit en entier, de bord à bord, l'imprimante est bien réglée.</body></html>`;
  // Le panneau « Imprimante de tickets » : le réglage de CE poste (il reste sur le poste, jamais sur le serveur).
  /** @param {HTMLElement} el */
  async function dessinerImprimante(el) {
    const reglee = await bureau.imprimante();
    const parPort = reglee && reglee.branchement === 'port';
    el.innerHTML = `<p class="small muted mb">L'imprimante de tickets de ce comptoir : le ticket encaissé sort tout seul, et le tiroir-caisse (branché sur l'imprimante) s'ouvre quand le client paie en espèces. Ce réglage reste sur ce poste.</p>
      <div class="grid-2">
        <label class="field">Branchement<select id="imp-branchement"><option value="reseau">Par le réseau (adresse IP de l'imprimante)</option><option value="port"${parPort ? ' selected' : ''}>Par un port de ce poste (câble USB)</option></select></label>
        <label class="field" id="imp-champ-hote"${parPort ? ' hidden' : ''}>Adresse de l'imprimante<input type="text" id="imp-hote" placeholder="192.168.1.50" value="${esc(reglee && reglee.hote ? reglee.hote : '')}"></label>
        <label class="field" id="imp-champ-port"${parPort ? ' hidden' : ''}>Port réseau<input type="text" inputmode="numeric" id="imp-port" value="${esc(String(reglee && reglee.port ? reglee.port : 9100))}"></label>
        <label class="field" id="imp-champ-chemin"${parPort ? '' : ' hidden'}>Port de ce poste<input type="text" id="imp-chemin" placeholder="/dev/usb/lp0" value="${esc(reglee && reglee.chemin ? reglee.chemin : '')}"></label>
      </div>
      <div class="row gap">
        <button type="button" class="btn btn-primary" id="imp-enregistrer">Enregistrer</button>
        <button type="button" class="btn" id="imp-essai">Imprimer un essai</button>
        <button type="button" class="btn" id="imp-tiroir">Ouvrir le tiroir</button>
        ${reglee ? '<button type="button" class="btn btn-sm" id="imp-oublier">Ne plus imprimer depuis ce poste</button>' : ''}
      </div>
      <p class="small" role="alert">${reglee ? '' : 'Aucune imprimante de tickets n\'est réglée sur ce poste : les tickets s\'impriment par la fenêtre d\'impression.'}</p>`;
    // Ce réglage est celui du poste, pas des Paramètres de l'entreprise : ses frappes ne remontent pas (elles ne
    // proposent pas « Enregistrer » les Paramètres, et n'empêchent pas d'en sortir).
    if (!el.dataset.horsReglages) {
      el.dataset.horsReglages = '1';
      for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    }
    /** @param {string} s */
    const champ = (s) => /** @type {HTMLInputElement} */ (el.querySelector(s));
    /** @param {string} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x; };
    const branchement = champ('#imp-branchement');
    branchement.onchange = () => {
      const port = branchement.value === 'port';
      for (const s of ['#imp-champ-hote', '#imp-champ-port']) /** @type {HTMLElement} */ (el.querySelector(s)).hidden = port;
      /** @type {HTMLElement} */ (el.querySelector('#imp-champ-chemin')).hidden = !port;
    };
    /** @param {string} s @param {() => Promise<void>} f */
    const geste = (s, f) => {
      const b = /** @type {HTMLButtonElement | null} */ (el.querySelector(s));
      if (b) b.onclick = async () => { b.disabled = true; try { await f(); } finally { b.disabled = false; } };
    };
    geste('#imp-enregistrer', async () => {
      const r = branchement.value === 'port'
        ? { branchement: 'port', chemin: champ('#imp-chemin').value.trim() }
        : { branchement: 'reseau', hote: champ('#imp-hote').value.trim(), port: Number(champ('#imp-port').value.trim() || 9100) };
      const res = await bureau.reglerImprimante(r);
      if (!res.ok) {
        champ(r.branchement === 'port' ? '#imp-chemin' : (r.hote ? '#imp-port' : '#imp-hote')).focus();
        dire(r.branchement === 'port' ? 'Le port de ce poste manque : écris le chemin de l\'imprimante (par exemple /dev/usb/lp0).'
          : 'L\'adresse de l\'imprimante manque, ou le port réseau n\'est pas un nombre de 1 à 65535.');
        return;
      }
      await dessinerImprimante(el);
      dire('Imprimante enregistrée sur ce poste. Imprime un essai pour vérifier qu\'elle répond.');
    });
    geste('#imp-essai', async () => {
      const l = largeurCaisse();
      const r = await bureau.imprimerTicket(ticketDEssai(l), l, { tiroir: false });
      dire(r.ok ? `L'essai est parti à l'imprimante (rouleau de ${l} mm) : s'il est sorti entier, de bord à bord, c'est réglé.` : `L'essai n'est pas parti : ${phraseImprimante(r.raison)}.`);
    });
    geste('#imp-tiroir', async () => {
      const r = await bureau.ouvrirTiroir();
      dire(r.ok ? 'L\'impulsion du tiroir est partie à l\'imprimante.' : `Le tiroir n'a pas reçu l'impulsion : ${phraseImprimante(r.raison)}.`);
    });
    geste('#imp-oublier', async () => {
      await bureau.reglerImprimante(null);
      await dessinerImprimante(el);
    });
  }
  // ── Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md) ────────────────────────────────
  // Brancher le compte Konnect de l'entreprise : son portefeuille, et la clé de son API (écrite ici,
  // scellée par le serveur, jamais relue : seules ses dernières lettres se montrent). Le dernier refus de
  // Konnect, et les derniers paiements demandés par les clients.
  /** @type {Record<string, string>} */
  const ETATS_PAIEMENT = { initie: 'En attente', encaisse: 'Reçu', echoue: 'Pas enregistré' };
  /** @param {string} texte @param {string} devise */
  const somme = (texte, devise) => /** @type {any} */ (window).SkanCore.money(Number(texte), devise === 'TND' ? 'DT' : devise);
  /** @param {HTMLElement} el */
  async function dessinerPaiement(el) {
    /** @type {any} */ let lu;
    try { lu = await appel('GET', '/paiement-en-ligne'); } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    const b = lu.branche;
    el.innerHTML = `<p class="small muted mb">Tes clients paient leurs factures en ligne, par carte ou par portefeuille, depuis le lien que tu leur donnes (« Lien pour le client… » sur une facture). L'argent va directement sur ton compte Konnect : SkanFact ne le touche jamais. Chaque paiement confirmé par Konnect s'ajoute tout seul à sa facture, sur le compte « Konnect — paiement en ligne ».</p>
      ${b ? `<p id="pl-etat"><strong>Branché</strong> le ${esc(quand(b.poseLe))}${b.posePar ? ` par ${esc(b.posePar)}` : ''} : portefeuille ${esc(b.portefeuille)}, clé qui finit par « ${esc(b.cleFin)} ».</p>
        ${b.dernierRefus ? `<p class="small" id="pl-refus">Dernier refus de Konnect, le ${esc(quand(b.dernierRefusLe))} : ${esc(b.dernierRefus)}. Vérifie ton portefeuille et ta clé.</p>` : ''}
        <p><button type="button" class="btn btn-sm" id="pl-changer">Changer la clé…</button> <button type="button" class="btn btn-sm" id="pl-arreter">Arrêter le paiement en ligne…</button></p>`
      : '<p id="pl-etat">Pas branché : tes clients ne voient pas « Payer en ligne ».</p>'}
      <div id="pl-form" ${b ? 'hidden' : ''}>
        <label class="field">Identifiant de ton portefeuille Konnect<input data-champ="portefeuille" autocomplete="off" value="${esc(b ? b.portefeuille : '')}"></label>
        <label class="field">Clé de l'API Konnect<input data-champ="cle" type="password" autocomplete="off"></label>
        <p class="small muted">Tu les trouves dans ton espace Konnect. La clé ne se relit plus ici, jamais : seules ses dernières lettres s'affichent.</p>
        <button type="button" class="btn btn-primary" id="pl-brancher">Brancher</button>
      </div>
      <p class="small" role="alert"></p>
      ${lu.demandes.length ? `<h4 class="small">Derniers paiements demandés</h4><table class="list compact" id="pl-demandes"><tbody>${lu.demandes.map((/** @type {any} */ d) => `<tr>
        <td>${esc(quand(d.demandeLe))}</td><td>${esc(d.numero)}</td><td class="r">${esc(somme(d.montant, d.devise))}</td>
        <td>${esc(ETATS_PAIEMENT[d.statut] || d.statut)}${d.encaisseLe ? ` le ${esc(quand(d.encaisseLe))}` : ''}${d.motif ? `<div class="small muted">${esc(d.motif)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`;
    /** @param {unknown} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    // Le panneau vit DANS le formulaire des Paramètres, qui ramasse chaque champ nommé dans la fiche de
    // l'entreprise (le dossier que toute l'équipe lit) : ces champs n'ont pas de nom, pas de <form>, et
    // leurs frappes ne remontent pas (elles ne proposent pas « Enregistrer » les Paramètres). La clé ne
    // part que vers le serveur, qui la scelle.
    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const form = /** @type {HTMLElement} */ (el.querySelector('#pl-form'));
    const champ = (/** @type {string} */ nom) => /** @type {HTMLInputElement} */ (form.querySelector(`[data-champ=${nom}]`));
    const bouton = /** @type {HTMLElement} */ (form.querySelector('#pl-brancher'));
    bouton.onclick = async () => {
      const v = { portefeuille: champ('portefeuille').value.trim(), cle: champ('cle').value.trim() };
      // Un refus dit ce qui manque, et montre le champ.
      const vide = !v.portefeuille ? 'portefeuille' : !v.cle ? 'cle' : '';
      if (vide) { dire(vide === 'cle' ? 'Colle la clé de l\'API Konnect.' : 'Donne l\'identifiant de ton portefeuille Konnect.'); champ(vide).focus(); return; }
      bouton.setAttribute('disabled', '');
      try { await appel('PUT', '/paiement-en-ligne', v); await dessinerPaiement(el); dire('Branché : tes clients voient « Payer en ligne » sur les factures qu\'ils doivent encore.'); } catch (x) { bouton.removeAttribute('disabled'); dire(x); }
    };
    const changer = el.querySelector('#pl-changer');
    if (changer) /** @type {HTMLElement} */ (changer).onclick = () => { form.hidden = false; champ('cle').focus(); };
    const arreter = /** @type {HTMLElement | null} */ (el.querySelector('#pl-arreter'));
    if (arreter) arreter.onclick = async () => {
      // Arrêter se demande d'abord : les clients ne pourront plus payer en ligne.
      if (!arreter.dataset.confirme) {
        arreter.dataset.confirme = '1';
        arreter.textContent = 'Oui, arrêter le paiement en ligne';
        dire('Tes clients ne verront plus « Payer en ligne ». Les paiements déjà reçus restent sur leurs factures.');
        return;
      }
      arreter.setAttribute('disabled', '');
      try { await appel('DELETE', '/paiement-en-ligne'); await dessinerPaiement(el); } catch (x) { arreter.removeAttribute('disabled'); dire(x); }
    };
  }

  // ── L'espace client (brique 77 ; docs/espace-client.md) ────────────────────────────────────────
  // « Lien pour le client… » sur une pièce émise : les liens déjà donnés (vus ? « Retirer ») ; en créer un
  // vers cette pièce (ou vers tout son compte), à copier dans un message. Le serveur ne garde que
  // l'empreinte d'un lien : il se montre une fois, à sa création.
  /** @param {any} doc @param {any} modal */
  function lienClient(doc, modal) {
    modal(`<h2>Lien pour le client</h2>
      <p class="small">Ton client ouvre ce lien sans rien installer : il voit la pièce telle que tu l'imprimes, et ce qu'il en doit. Il ne peut rien y changer. Garde-le pour lui : qui a le lien voit la pièce.</p>
      <div id="lc-lien"><button type="button" class="btn btn-primary" id="lc-piece">Créer le lien de cette pièce</button></div>
      <p><button type="button" class="btn btn-sm" id="lc-compte">Plutôt le lien de son compte (toutes ses pièces, et ce qu'il doit)</button></p>
      <h3 class="small">Liens déjà donnés</h3><div id="lc-liste" class="small"></div>
      <p class="small" role="alert"></p>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`, (/** @type {HTMLElement} */ root) => {
      const $r = (/** @type {string} */ q) => /** @type {HTMLElement} */ (root.querySelector(q));
      const dire = (/** @type {unknown} */ x) => { $r('[role=alert]').textContent = x instanceof Error ? x.message : String(x); };
      const liste = async () => {
        try {
          const r = await appel('GET', `/espace/liens?client=${encodeURIComponent(doc.clientId)}`);
          const miens = r.liens.filter((/** @type {any} */ l) => l.piece === doc.id || l.piece === null);
          $r('#lc-liste').innerHTML = miens.length ? `<table class="list compact"><tbody>${miens.map((/** @type {any} */ l) => `<tr><td>${l.piece ? 'Cette pièce' : 'Son compte'}, ${CANAUX[l.canal] || 'donné'} le ${esc(quand(l.creeLe))}${l.creePar ? ` par ${esc(l.creePar)}` : ''}
            <div class="muted">${l.retireLe ? `Retiré le ${esc(quand(l.retireLe))}` : l.vuLe ? `Vu le ${esc(quand(l.vuLe))}${l.vues > 1 ? ` (${l.vues} fois)` : ''}` : 'Pas encore ouvert'}</div></td>
            <td class="r">${l.retireLe ? '' : `<button type="button" class="btn btn-sm" data-retirer="${esc(l.id)}">Retirer</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun.</p>';
          root.querySelectorAll('[data-retirer]').forEach((b) => {
            /** @type {HTMLElement} */ (b).onclick = async () => {
              try { await appel('DELETE', `/espace/liens/${encodeURIComponent(String(/** @type {HTMLElement} */ (b).dataset.retirer))}`); await liste(); } catch (x) { dire(x); }
            };
          });
        } catch (x) { dire(x); }
      };
      /** @param {boolean} compte */
      const creer = async (compte) => {
        try {
          const r = await appel('POST', '/espace/liens', compte ? { client: doc.clientId } : { client: doc.clientId, piece: doc.id });
          const adresse = `${location.origin}${r.adresse}`;
          $r('#lc-lien').innerHTML = `<label class="field">${compte ? 'Le lien de son compte' : 'Le lien de cette pièce'}<input type="text" readonly id="lc-adresse" value="${esc(adresse)}"></label>
            <button type="button" class="btn btn-primary btn-sm" id="lc-copier">Copier le lien</button>`;
          $r('#lc-copier').onclick = async () => {
            try { await navigator.clipboard.writeText(adresse); dire('Copié : colle-le dans ton message au client.'); } catch { /** @type {HTMLInputElement} */ ($r('#lc-adresse')).select(); dire('Sélectionné : copie-le (Ctrl+C).'); }
          };
          await liste();
        } catch (x) { dire(x); }
      };
      // Un lien se crée d'un geste (jamais en ouvrant la fenêtre : on en sèmerait un à chaque fois).
      $r('#lc-piece').onclick = () => { void creer(false); };
      $r('#lc-compte').onclick = () => { void creer(true); };
      void liste();
    });
  }

  // ── Les envois (brique 79 ; docs/espace-client.md, E7) ─────────────────────────────────────────
  // Un navigateur ne joint pas de fichier à un e-mail ni à un WhatsApp : une facture ou un avoir émis part
  // avec son LIEN, créé à l'envoi (d'un geste : le bouton qui ouvre le message), qui note par où il part.
  // Sa phrase se place avant la formule de politesse, dans la langue du message, et ne propose de régler
  // en ligne que si le serveur dit que cette facture se règle en ligne.
  /** @type {Record<string, string>} */
  const CANAUX = { email: 'envoyé par e-mail', whatsapp: 'envoyé par WhatsApp' };
  /** @type {Window | null} */ let fenetreWhatsApp = null;
  // La lecture d'une facture d'achat (brique 84) : ce que le serveur dit de sa lecture (demandé une fois),
  // et les fichiers choisis, le temps de les envoyer.
  /** @type {Promise<any> | null} */ let etatLecture = null;
  /** @type {Map<string, File>} */ const fichiersALire = new Map();
  let lecturesChoisies = 0;
  const LECTURE_MAX = 10 * 1048576;
  // « Veuillez trouver ci-joint notre facture » : rien n'est joint. La phrase des modèles devient « Voici ».
  /** @param {string} texte */
  function sansPieceJointe(texte) {
    return String(texte || '').replace(/Veuillez trouver ci-joint /g, 'Voici ').replace(/Vous trouverez ci-joint /g, 'Voici ')
      .replace(/Please find attached /g, 'Here is ');
  }
  // Décocher le lien rend au message sa phrase d'origine (et le recocher la retire), tant qu'il n'a pas
  // été retouché : un texte que la personne a écrit ne se réécrit jamais.
  /** @param {HTMLElement} root @param {string} avec @param {string} sans */
  function lienBascule(root, avec, sans) {
    const c = /** @type {HTMLInputElement | null} */ (root.querySelector('input[name=lien]'));
    const ta = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('textarea[name=body]'));
    if (!c || !ta || avec === sans) return;
    c.addEventListener('change', () => {
      if (!c.checked && ta.value === avec) ta.value = sans;
      else if (c.checked && ta.value === sans) ta.value = avec;
    });
  }
  /** @param {any} doc @param {'email' | 'whatsapp'} canal @param {string} texte @param {boolean} en @param {boolean} liberal */
  async function ajouterLien(doc, canal, texte, en, liberal) {
    // WhatsApp s'ouvre dans un nouvel onglet : il s'ouvre ICI, encore dans le geste (après l'attente du
    // serveur, un navigateur bloquerait la fenêtre), et reçoit son adresse ensuite (`ouvrirWhatsApp`).
    if (canal === 'whatsapp') fenetreWhatsApp = window.open('', '_blank');
    try {
      const r = await appel('POST', '/espace/liens', { client: doc.clientId, piece: doc.id, canal });
      const adresse = `${location.origin}${r.adresse}`;
      const avoir = doc.type === 'avoir';
      const piece = en ? (avoir ? 'the credit note' : liberal ? 'the fee note' : 'the invoice')
        : (avoir ? 'l\'avoir' : liberal ? 'la note d\'honoraires' : 'la facture');
      const phrase = en ? `${r.payable ? `To view and pay ${piece} online` : `To view ${piece} online`}: ${adresse}`
        : `${r.payable ? `Pour voir ${piece} et la régler en ligne` : `Pour voir ${piece} en ligne`} : ${adresse}`;
      // Avant la formule de politesse (le dernier paragraphe : « Cordialement,\n<société> »).
      const t = String(texte || '').replace(/\s+$/, '');
      const i = t.lastIndexOf('\n\n');
      return i > 0 ? `${t.slice(0, i)}\n\n${phrase}${t.slice(i)}` : `${t}\n\n${phrase}`;
    } catch (x) {
      if (fenetreWhatsApp) { fenetreWhatsApp.close(); fenetreWhatsApp = null; }
      throw x;
    }
  }

  // ── La facture électronique (brique 80 ; docs/facture-electronique.md) ──────────────────────────
  // Le fichier TEIF qu'a écrit le serveur à l'émission (celui qui sera signé et envoyé) ; null si la pièce
  // n'en a pas (émise avant, ou d'une entreprise non soumise dont la fiche ne le permettait pas).
  /** @param {any} doc @returns {Promise<{ nom: string, xml: string, signe: boolean, titulaire: string | null, signeLe: string | null } | null>} */
  async function teifDuServeur(doc) {
    try { return await appel('GET', `/dossier-v10/${encodeURIComponent(doc.id)}/teif`); }
    catch (x) { if (/** @type {any} */ (x).statut === 404) return null; throw x; }
  }

  // ── La signature DigiGo (brique 81 ; docs/facture-electronique.md) ────────────────────────────────
  // Qui signe pour l'entreprise : l'identifiant DigiGo (TunTrust) de son signataire, posé par le
  // propriétaire ou un administrateur. Le panneau vit DANS le formulaire des Paramètres : champs sans nom,
  // frappes qui ne remontent pas (comme le paiement en ligne).
  // Venu du refus « Personne n'est désigné » : le curseur attend dans la case de l'identifiant.
  let amenerSignataire = false;
  /** @param {HTMLElement} el */
  async function dessinerSignataire(el) {
    /** @type {any} */ let lu;
    try { lu = await appel('GET', '/efacture/signataire'); } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    const s = lu.signataire;
    el.innerHTML = `<h4 class="small mt">Qui signe les pièces (DigiGo)</h4>
      <p id="sg-etat">${s ? `Le signataire est <strong>${esc(s.identifiant)}</strong>, désigné le ${esc(quand(s.poseLe))}${s.posePar ? ` par ${esc(s.posePar)}` : ''}.`
        : 'Personne n\'est désigné : les pièces ne peuvent pas encore être signées.'}</p>
      ${lu.branche ? '' : '<p class="small" id="sg-debranche">La signature DigiGo n\'est pas encore branchée sur ce serveur : tu peux déjà désigner le signataire.</p>'}
      <div id="sg-form" ${s ? 'hidden' : ''}>
        <label class="field">Identifiant DigiGo du signataire<input data-champ="identifiant" autocomplete="off" value="${esc(s ? s.identifiant : '')}"></label>
        <p class="small muted">Celui de son compte DigiGo, chez TunTrust. À chaque signature, un code part sur SON téléphone : c'est lui qui le donne, et rien ne se signe sans lui.</p>
        <button type="button" class="btn btn-primary" id="sg-poser">Enregistrer le signataire</button>
      </div>
      ${s ? '<p><button type="button" class="btn btn-sm" id="sg-changer">Changer le signataire…</button></p>' : ''}
      <p class="small" role="alert"></p>`;
    /** @param {unknown} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const champ = /** @type {HTMLInputElement} */ (el.querySelector('[data-champ=identifiant]'));
    const poser = /** @type {HTMLElement} */ (el.querySelector('#sg-poser'));
    poser.onclick = async () => {
      const identifiant = champ.value.trim();
      // Un refus dit ce qui manque, et montre le champ.
      if (identifiant.length < 4) { dire('Donne l\'identifiant DigiGo du signataire (celui de son compte chez TunTrust).'); champ.focus(); return; }
      poser.setAttribute('disabled', '');
      try { await appel('PUT', '/efacture/signataire', { identifiant }); await dessinerSignataire(el); dire('Enregistré : les pièces émises se signent avec « Signer (DigiGo)… », dans leur menu « Plus ».'); } catch (x) { poser.removeAttribute('disabled'); dire(x); }
    };
    const changer = /** @type {HTMLElement | null} */ (el.querySelector('#sg-changer'));
    if (changer) changer.onclick = () => { /** @type {HTMLElement} */ (el.querySelector('#sg-form')).hidden = false; champ.focus(); champ.select(); };
    if (amenerSignataire) { amenerSignataire = false; if (!s) champ.focus({ preventScroll: true }); }
  }

  // « Signer (DigiGo)… » sur une pièce émise : le fichier El Fatoora que le serveur a écrit à l'émission part
  // à DigiGo ; un code arrive sur le téléphone du signataire, et ce code tapé signe le fichier. Le code se
  // demande d'un geste (jamais en ouvrant la fenêtre : un SMS partirait à chaque fois).
  /** @param {any} doc @param {any} modal @param {() => void} telecharger */
  function signerPiece(doc, modal, telecharger) { signerPieces([doc], modal, telecharger, () => {}); }
  // Plusieurs pièces d'un coup (brique 140) : un seul code pour toutes.
  /** @param {{ id: string, number: string }[]} docs @param {any} modal @param {(() => void) | null} telecharger @param {() => void} apres */
  function signerPieces(docs, modal, telecharger, apres) {
    // (Jamais vide : une pièce, ou celles qui attendent.)
    const doc = /** @type {{ id: string, number: string }} */ (docs[0]);
    const une = docs.length === 1;
    modal(`<h2>${une ? `Signer ${esc(doc.number)} avec DigiGo` : `Signer ${docs.length} pièces avec DigiGo`}</h2>
      <p class="small">${une ? 'Le fichier El Fatoora de cette pièce, écrit par SkanFact à l\'émission, est signé' : `Les fichiers El Fatoora de ${esc(docs.map((d) => d.number).join(', '))}, écrits par SkanFact à l'émission, sont signés`} par DigiGo (TunTrust) avec le certificat de ton signataire. Un code arrive sur SON téléphone : c'est lui qui te le donne${une ? '' : ', et ce seul code les signe toutes'}.</p>
      <div id="sg-etape"></div>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`, (/** @type {HTMLElement} */ root, /** @type {() => void} */ close) => {
      const $r = (/** @type {string} */ q) => /** @type {HTMLElement} */ (root.querySelector(q));
      const etape = $r('#sg-etape');
      // Chaque étape a sa ligne de refus, là où il se lit : avant le bouton qui débloque, sous le champ du code.
      /** @param {unknown} x */
      const dire = (x) => { const a = root.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
      /** @param {string} texte */
      const demander = (texte) => {
        etape.innerHTML = `<p class="small" role="alert"></p><div class="inline"><button type="button" class="btn btn-primary" id="sg-demander">${texte}</button></div>`;
        const b = $r('#sg-demander');
        b.onclick = async () => {
          b.setAttribute('disabled', '');
          dire('');
          try {
            const d = await appel('POST', '/efacture/signatures', { pieces: docs.map((x) => x.id) });
            saisir(d.id, d.titulaire);
          } catch (x) {
            b.removeAttribute('disabled');
            // Personne n'est désigné : renvoyer le code n'y ferait rien ; le bouton principal mène au réglage.
            if (/** @type {any} */ (x).bouton === 'efacture.signataire') {
              etape.innerHTML = '<p class="small" role="alert"></p><div class="inline"><button type="button" class="btn btn-primary" id="sg-regler">Désigner le signataire</button></div>';
              $r('#sg-regler').onclick = () => {
                close();
                amenerSignataire = true;
                const w = /** @type {any} */ (window);
                if (typeof w.__allerParametres === 'function') w.__allerParametres('documents', 'p-efacture');
              };
            }
            dire(x);
          }
        };
      };
      /** @param {string} demande @param {string | null} titulaire */
      const saisir = (demande, titulaire) => {
        etape.innerHTML = `<p>Un code est parti sur le téléphone de ${titulaire ? `<strong>${esc(titulaire)}</strong>` : 'ton signataire'}. Tape-le ici :</p>
          <label class="field">Code reçu par le signataire<input id="sg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
          <p class="small" role="alert"></p>
          <div class="inline mt"><button type="button" class="btn btn-primary" id="sg-signer">Signer</button></div>`;
        const champ = /** @type {HTMLInputElement} */ ($r('#sg-code'));
        const b = $r('#sg-signer');
        champ.focus();
        champ.onkeydown = (ev) => { if (ev.key === 'Enter') b.click(); };
        b.onclick = async () => {
          const code = champ.value.replace(/\s+/g, '');
          if (!/^\d{4,8}$/.test(code)) { dire('Tape les chiffres du code reçu par le signataire.'); champ.focus(); return; }
          b.setAttribute('disabled', '');
          dire('');
          try {
            const r = await appel('POST', `/efacture/signatures/${encodeURIComponent(demande)}/code`, { code });
            fini(r);
          } catch (x) {
            b.removeAttribute('disabled');
            // Trois codes faux, ou DigiGo en panne en pleine signature : la demande est perdue, un nouveau
            // code se demande. Sinon, le même code se retape.
            if (/** @type {any} */ (x).bouton === 'efacture.recommencer') demander('Envoyer un nouveau code');
            else { champ.focus(); champ.select(); }
            dire(x);
          }
        };
      };
      /** @param {any} r @param {boolean} [deja] */
      const fini = (r, deja) => {
        for (const x of docs) etatsConnus.delete(x.id);
        const qui = `${r.titulaire ? ` par ${esc(r.titulaire)}` : ''}, le ${esc(quand(r.signeLe))}`;
        if (!telecharger) {
          etape.innerHTML = `<p id="sg-fait">${r.signees.length > 1 ? `Les pièces <strong>${esc(r.signees.join(', '))}</strong> sont signées${qui}. Elles partent d'elles-mêmes à la TTN : la liste dit où chacune en est.`
            : `La pièce <strong>${esc(r.signees.join(', '))}</strong> est signée${qui}. Elle part d'elle-même à la TTN : la liste dit où elle en est.`}</p>`;
          apres();
          return;
        }
        etape.innerHTML = `<p id="sg-fait">La pièce <strong>${esc(r.signees.join(', '))}</strong> est ${deja ? 'déjà ' : ''}signée${qui}. Elle part d'elle-même à la TTN : « Fichier pour El Fatoora » dit où elle en est.</p>
          <div class="inline"><button type="button" class="btn btn-primary" id="sg-telecharger">Télécharger le fichier signé</button></div>`;
        const t = telecharger;
        $r('#sg-telecharger').onclick = () => { close(); t(); };
      };
      // Plusieurs pièces : elles viennent de la liste de celles qui attendent ; le code se demande d'un geste.
      if (!une) { demander(`Envoyer le code au signataire (${docs.length} pièces)`); return; }
      // Déjà signée : la fenêtre le dit d'emblée (aucun code ne partirait pour rien).
      etape.innerHTML = '<p class="small muted">Un instant…</p>';
      teifDuServeur(doc).catch(() => null).then((f) => {
        if (f && f.signe) fini({ signees: [doc.number], titulaire: f.titulaire, signeLe: f.signeLe }, true);
        else demander('Envoyer le code au signataire');
      });
    });
  }

  // « Signer les N pièces en attente… », à côté du titre de la liste des factures (brique 140) : il paraît
  // quand des pièces émises attendent leur signature, et seulement pour qui a le droit de signer. Il se pose
  // dans une place gardée à côté du titre : rien d'autre ne bouge quand il paraît.
  /** @param {HTMLElement} el @param {any} modal @param {() => void} redessiner */
  async function dessinerASigner(el, modal, redessiner) {
    /** @type {any} */ let lu;
    try { lu = await appel('GET', '/efacture/a-signer'); } catch { return; }
    if (!lu.total || !el.isConnected) return;
    // Une demande de signature en prend 100 au plus : le bouton dit ce qu'il signera vraiment.
    const n = lu.pieces.length;
    el.innerHTML = `<button type="button" class="btn btn-sm" id="sg-lot">${lu.total > n ? `Signer les ${n} premières pièces en attente (sur ${lu.total})…`
      : lu.total > 1 ? `Signer les ${lu.total} pièces en attente…` : 'Signer la pièce en attente…'}</button>`;
    /** @type {HTMLElement} */ (el.querySelector('#sg-lot')).onclick = () =>
      signerPieces(lu.pieces.map((/** @type {any} */ p) => ({ id: p.cle, number: p.numero })), modal, null, redessiner);
  }

  // ── L'envoi à la TTN (brique 82 ; docs/facture-electronique.md) ──────────────────────────────────
  // Le compte El Fatoora de l'entreprise : son identifiant, et son mot de passe (écrit ici, scellé par le
  // serveur, jamais relu). Chaque pièce signée part d'elle-même ; les derniers envois, et ce que la TTN en a
  // fait. Le panneau vit dans le formulaire des Paramètres : champs sans nom, frappes qui ne remontent pas.
  /** @type {Record<string, string>} */
  const ETATS_TTN = { a_envoyer: 'En route', deposee: 'Déposée, en attente de la TTN', acceptee: 'Acceptée', refusee: 'Refusée' };
  // Une phrase du serveur (un fragment) dite seule : sa majuscule et son point.
  /** @param {string} x */
  const phrase = (x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}.`;
  // Venu de « Brancher le compte El Fatoora » : le curseur attend dans la case de l'identifiant.
  let amenerTtn = false;
  /** @param {HTMLElement} el */
  async function dessinerTtn(el) {
    /** @type {any} */ let lu;
    try { lu = await appel('GET', '/efacture/ttn'); } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    const c = lu.compte;
    el.innerHTML = `<h4 class="small mt">L'envoi à la TTN (El Fatoora)</h4>
      ${lu.essai ? '<p class="small">Entreprise d\'essai : ses pièces ne partent jamais à la TTN.</p>' : ''}
      <p id="ttn-etat">${c ? `Branché le ${esc(quand(c.poseLe))}${c.posePar ? ` par ${esc(c.posePar)}` : ''} : compte <strong>${esc(c.identifiant)}</strong>. Chaque pièce signée part d'elle-même à la TTN.`
        : 'Pas branché : les pièces signées attendent de partir à la TTN.'}</p>
      ${c && c.dernierRefus ? `<p class="small" id="ttn-refus">Dernier refus de la TTN, le ${esc(quand(c.dernierRefusLe))} : ${esc(c.dernierRefus)}.</p>` : ''}
      ${lu.branche ? '' : '<p class="small" id="ttn-debranche">L\'envoi à la TTN n\'est pas encore branché sur ce serveur : tu peux déjà poser ton compte, les pièces partiront dès qu\'il le sera.</p>'}
      <div id="ttn-form" ${c && !c.dernierRefus ? 'hidden' : ''}>
        <label class="field">Identifiant de ton compte El Fatoora<input data-champ="identifiant" autocomplete="off" value="${esc(c ? c.identifiant : '')}"></label>
        <label class="field">Mot de passe El Fatoora<input data-champ="motDePasse" type="password" autocomplete="off"></label>
        <p class="small muted">Ceux que la TTN t'a donnés à l'adhésion à El Fatoora. Le mot de passe est scellé par le serveur : il ne se relit plus ici, jamais.</p>
        <button type="button" class="btn btn-primary" id="ttn-brancher">Brancher</button>
      </div>
      ${c ? '<p><button type="button" class="btn btn-sm" id="ttn-changer">Changer le compte…</button></p>' : ''}
      <p class="small" role="alert"></p>
      ${lu.envois.length ? `<h4 class="small">Derniers envois</h4><table class="list compact" id="ttn-envois"><tbody>${lu.envois.map((/** @type {any} */ x) => `<tr>
        <td>${esc(x.numero)}</td><td>${esc(ETATS_TTN[x.statut] || x.statut)}${x.reference ? `, ${esc(x.reference)}` : ''}${x.motif ? `<div class="small muted">${esc(phrase(x.motif))}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`;
    /** @param {unknown} x */
    const dire = (x) => { const a = el.querySelector('[role=alert]'); if (a) a.textContent = x instanceof Error ? x.message : String(x); };
    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const form = /** @type {HTMLElement} */ (el.querySelector('#ttn-form'));
    const champ = (/** @type {string} */ nom) => /** @type {HTMLInputElement} */ (form.querySelector(`[data-champ=${nom}]`));
    const brancher = /** @type {HTMLElement} */ (form.querySelector('#ttn-brancher'));
    brancher.onclick = async () => {
      const v = { identifiant: champ('identifiant').value.trim(), motDePasse: champ('motDePasse').value };
      // Un refus dit ce qui manque, et montre le champ.
      const vide = !v.identifiant ? 'identifiant' : !v.motDePasse ? 'motDePasse' : '';
      if (vide) { dire(vide === 'identifiant' ? 'Donne l\'identifiant de ton compte El Fatoora.' : 'Tape le mot de passe de ton compte El Fatoora.'); champ(vide).focus(); return; }
      brancher.setAttribute('disabled', '');
      try { await appel('PUT', '/efacture/ttn', v); await dessinerTtn(el); dire('Branché : les pièces signées partent maintenant à la TTN, d\'elles-mêmes.'); } catch (x) { brancher.removeAttribute('disabled'); dire(x); }
    };
    const changer = /** @type {HTMLElement | null} */ (el.querySelector('#ttn-changer'));
    if (changer) changer.onclick = () => { form.hidden = false; champ('motDePasse').focus(); };
    if (amenerTtn) { amenerTtn = false; if (!form.hidden) champ(c ? 'motDePasse' : 'identifiant').focus({ preventScroll: true }); }
  }

  // La fenêtre « Le fichier El Fatoora est prêt » d'une pièce signée : où en est son envoi à la TTN, et le
  // bouton qui débloque (brancher le compte, renvoyer une pièce refusée).
  /** @param {HTMLElement} el @param {any} doc @param {any} f @param {() => void} close */
  function ttnDansLaFenetre(el, doc, f, close) {
    const x = f.envoi;
    const vers = () => {
      close();
      amenerTtn = true;
      const w = /** @type {any} */ (window);
      if (typeof w.__allerParametres === 'function') w.__allerParametres('documents', 'p-efacture');
    };
    if (f.essai) { el.innerHTML = '<p id="ttn-piece">Entreprise d\'essai : cette pièce ne part jamais à la TTN.</p>'; return; }
    if (!x) { el.innerHTML = '<p id="ttn-piece">Cette pièce n\'est pas en route vers la TTN (signée avant que l\'envoi n\'existe).</p>'; return; }
    if (x.statut === 'acceptee') {
      // Acceptée pendant que la page était ouverte : sa copie ne porte pas encore la référence (brique 83).
      el.innerHTML = `<p id="ttn-piece"><strong>Acceptée par la TTN</strong> le ${esc(quand(x.accepteLe))}, référence <strong>${esc(x.reference)}</strong>. Le fichier que tu viens de télécharger est la facture validée par la TTN : c'est elle qui fait foi, garde-la.</p>
        ${doc.ttn ? '' : '<p class="small" id="ttn-recharger">La pièce imprimée porte désormais sa référence et son code QR : recharge la page pour les voir. <button type="button" class="btn btn-sm" data-recharger>Recharger</button></p>'}`;
      const re = /** @type {HTMLElement | null} */ (el.querySelector('[data-recharger]'));
      if (re) re.onclick = () => location.reload();
      return;
    }
    if (x.statut === 'deposee') {
      el.innerHTML = `<p id="ttn-piece"><strong>Déposée à la TTN</strong> le ${esc(quand(x.deposeLe))} : SkanFact attend sa réponse, et la lira tout seul.</p>`;
      return;
    }
    if (x.statut === 'refusee') {
      el.innerHTML = `<p id="ttn-piece"><strong>Refusée par la TTN.</strong> ${esc(phrase(x.motif || ''))}</p>
        <p class="small muted">Corrige ce qu'elle reproche (ton compte, ta signature…), puis renvoie-la. Ce que devient une facture refusée : À VÉRIFIER avec ton comptable.</p>
        <div class="inline"><button type="button" class="btn btn-primary" id="ttn-renvoyer">Renvoyer à la TTN</button></div><p class="small" role="alert"></p>`;
      const b = /** @type {HTMLElement} */ (el.querySelector('#ttn-renvoyer'));
      b.onclick = async () => {
        b.setAttribute('disabled', '');
        try {
          await appel('POST', `/efacture/envois/${encodeURIComponent(doc.id)}/renvoyer`);
          etatsConnus.delete(doc.id);
          el.innerHTML = '<p id="ttn-piece"><strong>Elle repart à la TTN</strong> : SkanFact la dépose tout seul, et te dira ce qu\'elle en fait.</p>';
        } catch (e) {
          b.removeAttribute('disabled');
          const a = el.querySelector('[role=alert]');
          if (a) a.textContent = e instanceof Error ? e.message : String(e);
        }
      };
      return;
    }
    // En route : ce qui la retient, et le bouton qui débloque.
    const compte = ['ttn.sans_compte', 'ttn.compte_refuse', 'ttn.compte_illisible'].includes(x.motifCle);
    el.innerHTML = `<p id="ttn-piece"><strong>Elle part à la TTN</strong> : SkanFact la dépose tout seul.${!f.ttnBranche ? ' L\'envoi à la TTN n\'est pas encore branché sur ce serveur : elle partira dès qu\'il le sera.' : x.motif ? ` Pour l'instant, ${esc(x.motif)}.` : ''}</p>
      ${compte ? '<div class="inline"><button type="button" class="btn btn-primary" id="ttn-vers-compte">Brancher le compte El Fatoora</button></div>' : ''}`;
    const b = /** @type {HTMLElement | null} */ (el.querySelector('#ttn-vers-compte'));
    if (b) b.onclick = vers;
  }

  // ── L'état El Fatoora dans la liste (brique 139 ; docs/facture-electronique.md, L) ───────────────
  // Sous le statut de chaque facture ou avoir émis, la liste garde une place (`.ttn-etat`) ; on la remplit
  // ici, en un appel pour toutes les places de la page (jamais un par ligne). Une liste redessinée à chaque
  // frappe ne redemande rien de ce qu'on sait depuis moins de 20 secondes.
  /** @type {Record<string, [string, boolean]>} */
  const MOTS_TTN = {
    a_signer: ['à signer', false], signee: ['signée, pas envoyée', false], a_envoyer: ['en route', false], retenue: ['retenue', true],
    deposee: ['déposée, en attente', false], acceptee: ['acceptée', false], refusee: ['refusée', true],
  };
  /** @type {Map<string, { e: any, le: number }>} */
  const etatsConnus = new Map();
  /** @type {Set<string>} */
  const etatsDemandes = new Set();
  /** @param {HTMLElement} el @param {any} e */
  const poserEtat = (el, e) => {
    el.dataset.rempli = '1';
    const m = e && MOTS_TTN[e.etat];
    if (!m) return;
    const titre = e.reference ? `Référence de la TTN : ${e.reference}` : e.motif ? phrase(e.motif) : 'Le détail : « Fichier pour El Fatoora », dans le menu de la pièce.';
    el.innerHTML = `<span class="small ${m[1] ? 'warn-text' : 'muted'}" title="${esc(titre)}">El Fatoora : ${m[0]}</span>`;
  };
  let etatsPrevus = false;
  async function remplirEtats() {
    etatsPrevus = false;
    const places = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ttn-etat:not([data-rempli])')]);
    const manquent = new Set();
    for (const el of places) {
      const id = String(el.dataset.ttn);
      const c = etatsConnus.get(id);
      if (c && Date.now() - c.le < 20_000) poserEtat(el, c.e);
      else if (!etatsDemandes.has(id)) manquent.add(id);
    }
    const ids = [...manquent];
    for (let i = 0; i < ids.length; i += 100) {
      const lot = ids.slice(i, i + 100);
      lot.forEach((id) => etatsDemandes.add(id));
      try {
        const r = await appel('GET', `/efacture/etats?cles=${lot.map(encodeURIComponent).join(',')}`);
        for (const id of lot) etatsConnus.set(id, { e: r.etats[id] || null, le: Date.now() });
      } catch { /* sans réseau, la place reste vide : la liste se redessinera */ } finally { lot.forEach((id) => etatsDemandes.delete(id)); }
      for (const el of /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ttn-etat:not([data-rempli])')])) {
        const c = etatsConnus.get(String(el.dataset.ttn));
        if (c) poserEtat(el, c.e);
      }
    }
  }
  new MutationObserver(() => { if (!etatsPrevus && document.querySelector('.ttn-etat:not([data-rempli])')) { etatsPrevus = true; setTimeout(() => void remplirEtats(), 0); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  // ── Ce qu'un appareil retiré a remis (brique 74 bis ; docs/hors-ligne.md, H10) ────────────────
  // À l'ouverture, en ligne : s'il y a des remises à décider, le bandeau le dit, et « Voir » mène au
  // panneau des Paramètres qui les montre ; le propriétaire (ou un administrateur) accepte ou rejette.
  /** @type {any[]} */ let remises = [];
  async function chargerRemises() {
    try { remises = (await appel('GET', '/quarantaine')).remises || []; } catch { remises = []; }
    if (!remises.length) return;
    const n = remises.reduce((t, q) => t + compter(q.changements), 0);
    const qui = remises.length > 1 ? 'Des appareils retirés ont remis' : 'Un appareil retiré a remis';
    const quoi = n > 1 ? `${n} changements faits hors ligne : ils attendent` : n === 1 ? 'un changement fait hors ligne : il attend' : 'des réglages changés hors ligne : ils attendent';
    poste.annoncer(`${qui} ${quoi} ta décision.`, 'Voir', () => {
      const w = /** @type {any} */ (window);
      if (typeof w.__allerParametres === 'function') w.__allerParametres('donnees', 'p-quarantaine');
    });
  }
  // Ce qu'est un changement, en clair : « Client « Café des Arts » ajouté ».
  /** @type {Record<string, string>} */
  const NOMS = {
    clients: 'Client', suppliers: 'Fournisseur', catalog: 'Article', documents: 'Pièce', purchases: 'Achat', employees: 'Salarié',
    payslips: 'Bulletin', projects: 'Projet', assets: 'Immobilisation', movements: 'Mouvement de banque', ecrituresOD: 'Écriture', recurring: 'Facturation récurrente',
  };
  /** @param {any} c */
  const decrire = (c) => {
    const o = c.contenu || {};
    const nom = o.name || o.number || o.label || o.designation || o.ref || '';
    const fait = c.contenu === null ? 'supprimé' : c.revision === null ? 'ajouté' : 'modifié';
    return `${NOMS[c.collection] || 'Élément'}${nom ? ` « ${nom} »` : ''} ${fait}`;
  };
  // À l'heure de Tunis, comme le serveur compte les jours : un navigateur réglé ailleurs dirait la veille, et une action
  // « avant » le jour où le service a été relié (vu à l'écran, 02/10/2026).
  const HEURE_DE_TUNIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  /** @param {string} iso */
  const quand = (iso) => {
    /** @type {Record<string, string>} */ const p = {};
    for (const x of HEURE_DE_TUNIS.formatToParts(new Date(iso))) p[x.type] = x.value;
    return `${p.day}/${p.month}/${p.year} à ${Number(p.hour)} h ${p.minute}`;
  };
  /** @param {HTMLElement} el */
  function dessinerQuarantaine(el) {
    el.innerHTML = `<p class="small muted mb">Un appareil retiré de son compte remet, à sa reconnexion, ce qu'il avait enregistré sans réseau. Rien ne s'applique sans ta décision : accepté, chaque changement s'applique, sauf ce qui a changé depuis ici (la version du serveur est gardée, et on te le dit) ; rejeté, rien ne s'applique. La remise reste gardée au serveur dans les deux cas.</p>
      ${remises.map((q) => {
        const faits = q.changements.filter((/** @type {any} */ c) => c.collection !== '_racine');
        const reglages = q.changements.length - faits.length;
        return `<div class="remise" data-remise="${esc(q.id)}"><p><strong>Remis par ${esc(q.utilisateur || 'un membre')}, depuis « ${esc(q.appareil)} »</strong>, le ${esc(quand(q.recueLe))}.</p>
        <ul class="small">${faits.map((/** @type {any} */ c) => `<li>${esc(decrire(c))}</li>`).join('')}${reglages ? `<li>${reglages > 1 ? `${reglages} réglages du dossier` : 'Un réglage du dossier'}</li>` : ''}</ul>
        <div class="row"><button type="button" class="btn btn-primary btn-sm" data-accepter>Accepter</button> <button type="button" class="btn btn-sm" data-rejeter>Rejeter…</button></div>
        <p class="small" role="alert"></p></div>`;
      }).join('')}`;
    el.querySelectorAll('[data-remise]').forEach((bloc) => {
      const b = /** @type {HTMLElement} */ (bloc);
      const id = String(b.dataset.remise);
      const dire = (/** @type {string} */ x) => { const a = b.querySelector('[role=alert]'); if (a) a.textContent = x; };
      const boutons = /** @type {HTMLElement[]} */ ([...b.querySelectorAll('button')]);
      /** @param {boolean} accepter */
      const decider = async (accepter) => {
        boutons.forEach((x) => x.setAttribute('disabled', ''));
        try {
          const r = await appel('POST', `/quarantaine/${encodeURIComponent(id)}`, { accepter });
          const remise = remises.find((q) => q.id === id);
          remises = remises.filter((q) => q.id !== id);
          /** @param {any} m */
          const ecarte = (m) => {
            const c = remise && remise.changements.find((/** @type {any} */ x) => x.collection === m.collection && x.cle === m.cle);
            return `${c ? decrire(c) : NOMS[m.collection] || 'Élément'} — ${m.raison}`;
          };
          const appliques = r.appliques > 1 ? `${r.appliques} changements appliqués` : r.appliques === 1 ? 'Un changement appliqué' : 'Rien d\'appliqué';
          b.innerHTML = accepter
            ? `<p><strong>${appliques}.</strong></p>${r.misDeCote.length ? `<p>Mis de côté :</p><ul class="small">${r.misDeCote.map((/** @type {any} */ m) => `<li>${esc(ecarte(m))}</li>`).join('')}</ul>` : ''}
              <p class="small muted">Recharge pour voir ce qui a été appliqué.</p><button type="button" class="btn btn-primary btn-sm" data-recharger>Recharger</button>`
            : '<p><strong>Rejeté : rien ne s\'est appliqué.</strong> La remise reste gardée au serveur.</p>';
          const re = b.querySelector('[data-recharger]');
          if (re) /** @type {HTMLElement} */ (re).onclick = () => location.reload();
        } catch (x) { boutons.forEach((y) => y.removeAttribute('disabled')); dire(x instanceof Error ? x.message : String(x)); }
      };
      const acc = /** @type {HTMLElement} */ (b.querySelector('[data-accepter]'));
      const rej = /** @type {HTMLElement} */ (b.querySelector('[data-rejeter]'));
      acc.onclick = () => { void decider(true); };
      // Rejeter se demande d'abord : rien de la remise ne s'appliquera.
      rej.onclick = () => {
        if (!rej.dataset.confirme) {
          rej.dataset.confirme = '1';
          rej.textContent = 'Oui, rejeter';
          dire('Rien de cette remise ne s\'appliquera. Elle reste gardée au serveur.');
          return;
        }
        void decider(false);
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
