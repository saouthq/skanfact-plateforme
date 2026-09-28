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
  try { jeton = sessionStorage.getItem('skanfact.jeton'); } catch { /* stockage refusé : pas de session */ }
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
      throw new Error('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.', { cause: e });
    }
    // La session est finie : retour à la connexion (ce qui n'est pas enregistré le dit à l'écran d'avant).
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
    for (const [champ, v] of Object.entries(data)) {
      if (v === undefined || typeof v === 'function') continue;
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
  /** @param {Record<string, unknown>} data */
  async function envoyer(data) {
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
        const [collection, cle] = k.split('\u0000');
        changements.push({ collection, cle, rang: null, revision: avant.revision, contenu: null });
      }
    }
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
        throw e;
      }
      for (const [j, c] of lot.entries()) {
        const k = `${c.collection}\u0000${c.cle}`;
        const rev = r.revisions[j] && r.revisions[j].revision;
        if (c.contenu === null) vu.delete(k); else vu.set(k, { json: JSON.stringify(c.contenu), rang: c.rang, revision: rev });
      }
    }
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
    return assembler(r.objets);
  }

  // Les panneaux des Paramètres sans objet sur la plateforme (voir `panneauxAbsents`).
  // `p-pj` (les pièces jointes d'une pièce) reviendra quand le serveur gardera les fichiers ;
  // `p-depannage` (le journal de l'ordinateur, le signalement) quand le serveur tiendra le sien.
  const PANNEAUX_ABSENTS = ['p-dossiers', 'p-sauvegardes', 'p-externe', 'p-motdepasse', 'p-ocr', 'p-danger', 'p-cabinet', 'p-maj', 'p-licence', 'p-editeur', 'p-pj', 'p-depannage'];
  const style = document.createElement('style');
  style.textContent = `${PANNEAUX_ABSENTS.map((id) => `#${id}`).join(', ')} { display: none !important; }`;
  document.head.appendChild(style);

  /** @type {any} */ (window).skanfact = {
    loadData: async () => ({ data: await relire(), corruptFile: null }),
    saveData: (/** @type {Record<string, unknown>} */ data) => enregistrer(data),
    dataPath: async () => 'Serveur SkanFact',
    setTitle: (/** @type {string} */ t) => { document.title = t; },

    // L'émission d'une facture ou d'un avoir (adaptation de `issue()` dans app.js) : le serveur prend la pièce telle
    // que l'écran la montre, la numérote, la scelle, et vérifie qu'il trouve le même net à payer.
    emettre: async (/** @type {any} */ doc, /** @type {any} */ client, /** @type {number} */ netAPayer) => {
      if (enCours) await enCours;
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
      return decoder(r.contenu);
    },

    // ── Les entreprises (les « dossiers » de la v10) ──────────────────────────────────────────
    // Un dossier de la v10 était un fichier sur l'ordinateur ; ici, c'est une entreprise du compte.
    listDossiers: async () => {
      const moi = await appelCompte('GET', '/moi');
      return {
        dossiers: moi.entreprises.map((/** @type {any} */ e) => ({ id: e.id, name: e.raison_sociale, shared: false, dir: 'Serveur SkanFact' })),
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
    deconnecter: async () => {
      try { await appelCompte('POST', '/deconnexion'); } catch { /* la session se ferme de toute façon ici */ }
      try { sessionStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
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
      const essai = moi.entreprises.find((/** @type {any} */ e) => e.essai);
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
