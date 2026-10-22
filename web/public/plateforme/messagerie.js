// @ts-check
// La messagerie entre l'entreprise et son cabinet (lot messagerie ; maquettes « Mon comptable » et « Les messages de tes
// clients » validées par Skander le 09/10/2026 ; serveur/messagerie, docs/messagerie.md). Le même fil des deux côtés :
// la page « Mon comptable » de l'entreprise, et la conversation d'un client dans le Cabinet ; plus la boîte du cabinet,
// tous ses clients en une liste.
//
// Ce que le fil montre : les messages (texte, pièce dont on parle, pièce demandée, photo ou PDF joint, achat où il a été
// rangé) et les questions de la révision, à leur date (lues là où elles vivent, dans les livres). Pas de « en train
// d'écrire » : la page relit le fil toutes les 30 secondes tant qu'elle est visible, un message arrive dans la minute.
// Le serveur refait chaque contrôle ; ici, on montre ce qu'il dit, et un refus se lit sous ce qui l'a provoqué.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const TZ = 'Africa/Tunis';
  // La messagerie arrive dans la minute (décidé le 09/10/2026) : une relecture toutes les 30 secondes, page visible.
  const RELIRE_MS = 30_000;
  const LIMITE = 10 * 1_048_576;

  /** @param {string} iso */
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  /** @param {string | number | Date} d */
  const jourCle = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
  /** @param {string} jour aaaa-mm-jj */
  const dateCourte = (jour) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
  // Le jour d'un séparateur : « Aujourd'hui », « Hier », sinon « Lundi 5 octobre » (et l'année, si ce n'est pas celle-ci).
  /** @param {string} iso */
  function jourDit(iso) {
    const cle = jourCle(iso);
    const auj = jourCle(Date.now());
    if (cle === auj) return 'Aujourd\'hui';
    if (cle === jourCle(Date.parse(`${auj}T12:00:00Z`) - 86_400_000)) return 'Hier';
    const s = new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', ...(cle.slice(0, 4) === auj.slice(0, 4) ? {} : { year: 'numeric' }) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Quand, dans une liste : l'heure aujourd'hui, « Hier », sinon jj/mm.
  /** @param {string} iso */
  function quandCourt(iso) {
    const cle = jourCle(iso);
    const auj = jourCle(Date.now());
    if (cle === auj) return heure(iso);
    if (cle === jourCle(Date.parse(`${auj}T12:00:00Z`) - 86_400_000)) return 'Hier';
    return cle.slice(0, 4) === auj.slice(0, 4) ? `${cle.slice(8, 10)}/${cle.slice(5, 7)}` : dateCourte(cle);
  }
  /** @param {string} nom */
  const initiales = (nom) => String(nom || '').replace(/^(cabinet|société|societe|ste|sarl|suarl|sa)\s+/i, '').split(/[\s'’-]+/).filter(Boolean).slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase()).join('') || '·';
  // Un montant du serveur (« 1429.000 », en millimes écrits) : « 1 429,000 DT ».
  /** @param {string} texte */
  function montant(texte) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(texte || ''));
    if (!m) return '';
    return `${m[1] ? '−' : ''}${(m[2] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')}${m[3] ? `,${m[3]}` : ''}\u00a0DT`;
  }
  /** @param {number} octets */
  const poids = (octets) => (octets >= 1_048_576 ? `${(octets / 1_048_576).toFixed(1).replace('.', ',')}\u00a0Mo` : `${Math.max(1, Math.round(octets / 1024))}\u00a0Ko`);
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n}\u00a0${n > 1 ? (plusieurs || `${un}s`) : un}`;
  const GENRES = /** @type {Record<string, string>} */ ({ facture: 'Facture', avoir: 'Avoir', devis: 'Devis', achat: 'Achat' });
  const ATTENDUS = /** @type {Record<string, string>} */ ({ piece: 'une pièce justificative', explication: 'une explication', confirmation: 'une confirmation' });
  const DESSINS = {
    piece: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    trombone: '<path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4"/><path d="M12 17.5v.01"/>',
    croix: '<path d="M6 6l12 12M18 6 6 18"/>',
    modele: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    loupe: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  /** @param {keyof typeof DESSINS} id */
  const dessin = (id) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DESSINS[id]}</svg>`;

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
  const ACCEPTE = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';
  /** @param {File} f @returns {Promise<string>} */
  const enBase64 = (f) => new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => ko(new Error(`« ${f.name} » ne se lit pas sur cet appareil.`));
    r.readAsDataURL(f);
  });
  // Un fichier trop lourd se dit avant de partir (le serveur le refuserait de même).
  /** @param {File} f */
  const tropLourd = (f) => (f.size > LIMITE ? `« ${f.name} » pèse ${poids(f.size)} : un fichier joint pèse 10\u00a0Mo au plus. Prends une photo moins lourde.` : '');
  /** @param {unknown} x */
  const motif = (x) => (x instanceof Error ? x.message : String(x));

  // ── (1.117.0) Chercher, et les modèles de messages ───────────────────────────────────────────────────────────────
  // Plier un texte pour chercher : minuscules, lettres accentuées ramenées à leur lettre simple, caractère par caractère
  // (la règle de `messagerie.plier`, côté base) : les positions ne bougent pas, et le mot trouvé se surligne.
  const PLIS = /** @type {Record<string, string>} */ ({ à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', å: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i', ñ: 'n', ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ý: 'y', ÿ: 'y', œ: 'o', æ: 'a' });
  /** @param {unknown} t */
  const plier = (t) => {
    const x = String(t == null ? '' : t);
    let r = '';
    for (let i = 0; i < x.length; i++) {
      const c = x.charAt(i);
      const l = c.toLowerCase();
      const m = l.length === 1 ? l : c;
      r += PLIS[m] || m;
    }
    return r;
  };
  // Un extrait d'une soixantaine de caractères autour du mot trouvé, le mot surligné (le texte entier s'il est court).
  /** @param {string} texte @param {string} q */
  function surligner(texte, q) {
    const i = plier(texte).indexOf(plier(q));
    if (i < 0) return esc(texte.length > 120 ? `${texte.slice(0, 117)}…` : texte);
    const debut = Math.max(0, i - 40);
    const fin = Math.min(texte.length, i + q.length + 60);
    return `${debut ? '…' : ''}${esc(texte.slice(debut, i))}<mark>${esc(texte.slice(i, i + q.length))}</mark>${esc(texte.slice(i + q.length, fin))}${fin < texte.length ? '…' : ''}`;
  }
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // Le mois qui vient de finir (jour de Tunis) : en octobre, « septembre 2026 » ; en janvier, « décembre » de l'an passé.
  const moisPasse = () => {
    const [a, m] = jourCle(Date.now()).split('-').map(Number);
    return m === 1 ? `${MOIS[11]} ${(a || 0) - 1}` : `${MOIS[(m || 1) - 2]} ${a}`;
  };
  // Un modèle posé dans un message : {client} devient le nom du client (gardé tel quel s'il n'est pas encore connu : la
  // demande groupée le remplace pour chacun), {mois} le mois qui vient de finir.
  /** @param {string} texte @param {string | null} client */
  const remplir = (texte, client) => texte.replace(/\{mois\}/g, moisPasse()).replace(/\{client\}/g, client || '{client}');
  const EXEMPLES = [
    { titre: 'Pièces du mois', texte: 'Bonjour {client}, pour boucler {mois}, il me manque des pièces. Peux-tu me les envoyer ici, en photo ou en PDF ? Merci.' },
    { titre: 'Déclaration déposée', texte: 'Bonjour {client}, ta déclaration de {mois} est déposée.' },
    { titre: 'Bien reçu', texte: 'Bien reçu, merci {client}. Je m\'en occupe.' },
  ];

  // La fenêtre des modèles du cabinet : les lire, en prendre un (il se pose dans le champ, où il se relit et se change
  // avant de partir), en ajouter, les changer, les retirer. Toute l'équipe du cabinet partage les mêmes (0169).
  /** @param {{ modeles: { lire: () => Promise<any[]>, poser: (id: string | null, titre: string, texte: string) => Promise<any>, retirer: (id: string) => Promise<any> },
   *   utiliser?: (texte: string) => void, client?: string | null }} o */
  function fenetreModeles(o) {
    const fond = document.createElement('div');
    fond.className = 'msg-fenetre-fond';
    fond.innerHTML = `<div class="msg-fenetre msg-mo-fenetre" role="dialog" aria-modal="true" aria-labelledby="msg-mo-titre">
      <h2 id="msg-mo-titre">Modèles de messages</h2>
      <p class="small muted">Les phrases que ton cabinet écrit souvent, pour toute l'équipe. En les prenant, <b>{client}</b> devient le nom du client, et <b>{mois}</b> le mois qui vient de finir (${esc(moisPasse())}).</p>
      <div class="msg-mo-liste" data-mo-liste><p class="small muted">Lecture des modèles…</p></div>
      <form class="msg-mo-form" data-mo-form novalidate>
        <h3 data-mo-form-titre>Un nouveau modèle</h3>
        <label class="msg-ep-mot"><span>Titre</span><input type="text" maxlength="80" placeholder="Par exemple : Pièces du mois" data-mo-titre></label>
        <label class="msg-ep-mot"><span>Texte</span><textarea rows="3" maxlength="4000" placeholder="Bonjour {client}, …" data-mo-texte></textarea></label>
        <div class="msg-fp-gestes msg-ep-gestes"><p class="msg-refus" role="alert" data-mo-refus></p>
          <button type="button" class="btn" data-mo-annuler hidden>Annuler la modification</button>
          <button type="submit" class="btn" data-mo-poser>Ajouter le modèle</button></div>
      </form>
      <div class="msg-fp-gestes"><button type="button" class="btn" data-fermer>Fermer</button></div>
    </div>`;
    document.body.appendChild(fond);
    const liste = /** @type {HTMLElement} */ (fond.querySelector('[data-mo-liste]'));
    const form = /** @type {HTMLFormElement} */ (fond.querySelector('[data-mo-form]'));
    const titre = /** @type {HTMLInputElement} */ (fond.querySelector('[data-mo-titre]'));
    const texte = /** @type {HTMLTextAreaElement} */ (fond.querySelector('[data-mo-texte]'));
    const refus = /** @type {HTMLElement} */ (fond.querySelector('[data-mo-refus]'));
    const poser = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-mo-poser]'));
    const annuler = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-mo-annuler]'));
    const fermerBtn = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-fermer]'));
    /** @type {any[]} */ let modeles = [];
    /** @type {string | null} */ let enCours = null;   // le modèle qu'on change
    /** @type {string | null} */ let aRetirer = null;  // celui dont on confirme le retrait
    let insiste = false;
    // Une saisie commencée ne se jette pas sans le dire (une fenêtre remplie demande avant de fermer).
    const rempli = () => !!(titre.value.trim() || texte.value.trim());
    const fermer = (force = false) => {
      if (!force && rempli() && !insiste) {
        insiste = true;
        refus.textContent = 'Ce modèle n\'est pas enregistré : « Ajouter le modèle » le garde. « Fermer » encore une fois le laisse.';
        fermerBtn.textContent = 'Fermer sans l\'enregistrer';
        return;
      }
      fond.remove(); document.removeEventListener('keydown', echap, true);
    };
    // Échap ferme celle-ci seulement : ouverte depuis la demande groupée, elle ne ferme pas la fenêtre de dessous.
    const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); } };
    document.addEventListener('keydown', echap, true);
    fermerBtn.onclick = () => fermer();
    fond.onclick = (e) => { if (e.target === fond) fermer(); };
    const champs = () => { insiste = false; fermerBtn.textContent = 'Fermer'; refus.textContent = ''; };
    titre.addEventListener('input', champs);
    texte.addEventListener('input', champs);
    const vider = () => {
      enCours = null; titre.value = ''; texte.value = ''; champs();
      poser.textContent = 'Ajouter le modèle'; annuler.hidden = true;
      /** @type {HTMLElement} */ (fond.querySelector('[data-mo-form-titre]')).textContent = 'Un nouveau modèle';
    };
    annuler.onclick = vider;
    function dessiner() {
      liste.innerHTML = modeles.length
        ? modeles.map((m) => `<div class="msg-mo" data-mo="${esc(m.id)}">
            <span class="msg-mo-txt"><b>${esc(m.titre)}</b><span>${esc(m.texte)}</span></span>
            <span class="msg-mo-gestes">${aRetirer === m.id
              ? `<span class="small">Retirer « ${esc(m.titre)} » pour toute l'équipe ?</span><button type="button" class="btn btn-sm" data-mo-oui="${esc(m.id)}">Oui, le retirer</button><button type="button" class="msg-lien" data-mo-non>Non</button>`
              : `${o.utiliser ? `<button type="button" class="btn btn-sm btn-primary" data-mo-utiliser="${esc(m.id)}">Utiliser</button>` : ''}
                <button type="button" class="msg-lien" data-mo-modifier="${esc(m.id)}">Modifier</button>
                <button type="button" class="msg-lien" data-mo-retirer="${esc(m.id)}">Retirer</button>`}</span></div>`).join('')
        : `<div class="msg-vide msg-mo-vide"><b>Aucun modèle encore.</b><span>Écris en dessous la phrase que tu envoies le plus souvent, ou pars d'un exemple :</span>
            <span class="msg-mo-exemples">${EXEMPLES.map((x, i) => `<button type="button" class="btn btn-sm" data-mo-exemple="${i}">${esc(x.titre)}</button>`).join('')}</span></div>`;
      liste.querySelectorAll('[data-mo-utiliser]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          const m = modeles.find((x) => x.id === /** @type {HTMLElement} */ (n).dataset.moUtiliser);
          if (!m || !o.utiliser) return;
          o.utiliser(remplir(m.texte, o.client || null));
          fermer(true);
        };
      });
      liste.querySelectorAll('[data-mo-modifier]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          const m = modeles.find((x) => x.id === /** @type {HTMLElement} */ (n).dataset.moModifier);
          if (!m) return;
          enCours = m.id; titre.value = m.titre; texte.value = m.texte; champs();
          poser.textContent = 'Enregistrer le modèle'; annuler.hidden = false;
          /** @type {HTMLElement} */ (fond.querySelector('[data-mo-form-titre]')).textContent = `Modifier « ${m.titre} »`;
          texte.focus();
        };
      });
      liste.querySelectorAll('[data-mo-retirer]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => { aRetirer = String(/** @type {HTMLElement} */ (n).dataset.moRetirer); dessiner(); };
      });
      const non = liste.querySelector('[data-mo-non]');
      if (non) /** @type {HTMLElement} */ (non).onclick = () => { aRetirer = null; dessiner(); };
      const oui = /** @type {HTMLButtonElement | null} */ (liste.querySelector('[data-mo-oui]'));
      if (oui) oui.onclick = async () => {
        oui.disabled = true;
        try {
          await o.modeles.retirer(String(oui.dataset.moOui));
          if (enCours === oui.dataset.moOui) vider();
        } catch (x) { refus.textContent = motif(x); }
        aRetirer = null;
        await lire();
      };
      liste.querySelectorAll('[data-mo-exemple]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          const x = EXEMPLES[Number(/** @type {HTMLElement} */ (n).dataset.moExemple)];
          if (!x) return;
          titre.value = x.titre; texte.value = x.texte; champs(); texte.focus();
        };
      });
    }
    async function lire() {
      try { modeles = await o.modeles.lire(); } catch (x) { liste.innerHTML = `<p class="msg-refus">${esc(motif(x))}</p>`; return; }
      dessiner();
      if (premiere) {
        premiere = false;
        // Le premier geste : prendre un modèle s'il y en a, sinon en écrire un.
        const b = /** @type {HTMLElement} */ (fond.querySelector('[data-mo-utiliser]') || titre);
        b.focus();
      }
    }
    let premiere = true;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (poser.disabled) return;
      if (!titre.value.trim()) { refus.textContent = 'Donne un titre à ce modèle (par exemple : Pièces du mois).'; titre.focus(); return; }
      if (!texte.value.trim()) { refus.textContent = 'Écris le texte de ce modèle : la phrase que tu envoies souvent.'; texte.focus(); return; }
      poser.disabled = true;
      try {
        await o.modeles.poser(enCours, titre.value, texte.value);
        vider();
        await lire();
      } catch (x) { refus.textContent = motif(x); }
      poser.disabled = false;
    };
    void lire();
  }

  // Ouvrir un fichier du fil : le serveur le rend en base 64, la page l'ouvre dans un onglet.
  /** @param {(m: string, c: string, b?: unknown) => Promise<any>} appel @param {string} id */
  /** @param {(m: string, c: string, b?: unknown) => Promise<any>} appel @param {string} id @param {boolean} [enregistrer] */
  async function ouvrirFichier(appel, id, enregistrer = false) {
    const onglet = enregistrer ? null : window.open('', '_blank');
    const f = await appel('GET', `/messages/fichiers/${encodeURIComponent(id)}`);
    const octets = Uint8Array.from(atob(f.contenu), (c) => c.charCodeAt(0));
    const adresse = URL.createObjectURL(new Blob([octets], { type: f.type }));
    if (onglet) montrerFichier(onglet, adresse, f.nom, f.type);
    else {
      const a = document.createElement('a');
      a.href = adresse; a.download = f.nom;
      document.body.append(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
  }

  // (1.94.0) Une photo s'ouvre dans une page à son nom (le titre de l'onglet), avec « Enregistrer » qui le garde : ouverte
  // directement, l'onglet s'appelait « d1eebff2-… » et elle s'enregistrait sous ce nom. Un PDF s'ouvre en plein onglet,
  // dans la visionneuse du navigateur (la politique de la page interdit de l'encadrer, `object-src 'none'`) : c'est le
  // bouton « Enregistrer » du fil qui le garde sous son nom.
  /** @param {Window} onglet @param {string} adresse @param {string} nom @param {string} type */
  function montrerFichier(onglet, adresse, nom, type) {
    if (!String(type).startsWith('image/')) { onglet.location.href = adresse; return; }
    const n = esc(nom);
    const vue = `<img src="${adresse}" alt="${n}">`;
    onglet.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${n}</title>
      <style>body{margin:0;font:14px system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;background:#f3f5f4}
      header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid #dde3e0}
      b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}a{flex:none;padding:8px 14px;border-radius:8px;background:#0f8a74;color:#fff;text-decoration:none;font-weight:600}
      img{max-width:100%;margin:16px auto;display:block}</style></head>
      <body><header><b>${n}</b><a href="${adresse}" download="${n}">Enregistrer</a></header>${vue}</body></html>`);
    onglet.document.close();
  }

  /**
   * La conversation, d'un côté ou de l'autre.
   * @param {HTMLElement} el
   * @param {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   cote: 'entreprise' | 'cabinet',
   *   toast?: (texte: string, erreur?: boolean) => void,
   *   nom?: string,
   *   retour?: { texte: string, aller: () => void },
   *   demander?: boolean,
   *   pieces?: () => { genre: string, id: string, libelle: string, date?: string }[],
   *   ouvrirPiece?: (genre: string, id: string, libelle: string) => boolean,
   *   saisirPiece?: (message: { id: string, ecritLe: string, fichier: { id: string, nom: string, type: string } }) => void,
   *   pieceDuNumero?: (numero: string) => { genre: string, id: string } | null,
   *   repondre?: (question: string, texte: string) => Promise<void>,
   *   rangerAchat?: (message: { id: string, nom: string, type: string, contenu: string }) => void,
   *   voirMandat?: () => void,
   *   inviter?: () => void,
   *   revision?: () => void,
   *   surAttente?: (a: { nonLus: number, questions: number, demandes: number, enRetard?: number }) => void,
   *   integre?: boolean,
   *   enGrand?: () => void,
   *   modeles?: { lire: () => Promise<any[]>, poser: (id: string | null, titre: string, texte: string) => Promise<any>, retirer: (id: string) => Promise<any> },
   * }} o
   */
  function conversation(el, o) {
    const entreprise = o.cote === 'entreprise';
    /** @type {any} */ let lu = null;              // la dernière lecture du serveur (première page)
    /** @type {any[]} */ let anciensMessages = [];  // les pages plus anciennes, demandées
    /** @type {any[]} */ let anciennesQuestions = [];
    /** @type {string | null} */ let suite = null;
    /** @type {string | null} */ let cabinetRelu = null; // un ancien cabinet relu (côté entreprise)
    /** @type {{ genre: string, id: string, libelle: string } | null} */ let piece = null;
    /** @type {File | null} */ let fichier = null;
    let demande = !!o.demander && !entreprise;
    /** @type {Map<string, string>} */ const reponses = new Map();
    let signature = '';
    let enCours = false;
    let fini = false;
    let premier = true;

    /** @param {string | null} avant */
    const chemin = (avant) => {
      const q = new URLSearchParams({ cote: o.cote });
      if (cabinetRelu) q.set('cabinet', cabinetRelu);
      if (avant) q.set('avant', avant);
      return `/messages?${q}`;
    };

    // Le haut et les deux colonnes se posent une fois ; le fil et l'encart se redessinent seuls (le brouillon reste).
    function poserLaPage() {
      const f = lu.fil;
      const nomAutre = entreprise ? (f && f.cabinetNom) || 'Ton cabinet' : o.nom || 'Ce client';
      const sous = entreprise
        ? (f && f.actif ? `${esc(nomAutre)} tient ta comptabilité depuis le ${esc(dateCourte(f.depuis))}` : f ? `${esc(nomAutre)} ne tient plus ton dossier : ce fil se relit, il ne s'écrit plus.` : '')
        : (f && f.depuis ? `Ton client depuis le ${esc(dateCourte(f.depuis))}` : '');
      // (1.115.0) Dans la boîte du cabinet (`integre`), la conversation se range à droite de la liste : un en-tête court,
      // ce qui attend le client en bandeau, et le fil à pleine hauteur (revue du 22/10/2026 : il fallait un aperçu, puis
      // « Ouvrir la conversation », sur une autre page).
      const integre = !!o.integre;
      const tete = integre
        ? `<header class="msg-tete msg-tete-integre">
          <span class="msg-avatar petit" aria-hidden="true">${esc(initiales(nomAutre))}</span>
          <span class="msg-tete-txt"><h2>${esc(nomAutre)}</h2>${sous ? `<span class="msg-sous">${sous}</span>` : ''}</span>
          <button type="button" class="msg-lien msg-chercher" data-msg-chercher aria-expanded="false" aria-label="Chercher">${dessin('loupe')}<span class="msg-long">Chercher</span></button>
          ${o.enGrand ? '<button type="button" class="msg-lien msg-en-grand" data-msg-en-grand>Ouvrir en grand</button>' : ''}
        </header>`
        : `${o.retour ? `<button type="button" class="msg-retour" data-msg-retour>← ${esc(o.retour.texte)}</button>` : ''}
        <header class="msg-tete">
          <span class="msg-avatar" aria-hidden="true">${esc(initiales(nomAutre))}</span>
          <span class="msg-tete-txt"><h1 title="${entreprise ? 'Mon comptable' : esc(nomAutre)}">${entreprise ? 'Mon comptable' : esc(nomAutre)}</h1>${sous ? `<span class="msg-sous">${sous}</span>` : ''}</span>
          <button type="button" class="btn btn-sm msg-chercher" data-msg-chercher aria-expanded="false" aria-label="Chercher">${dessin('loupe')}<span class="msg-long">Chercher</span></button>
        </header>`;
      // (1.117.0) Chercher dans les messages de ce fil (revue du 22/10/2026, point 10 : « STEG ») : la barre au-dessus du
      // fil, les messages trouvés à la place du fil tant qu'on cherche ; un message choisi se montre dans le fil.
      const recherche = `<div class="msg-recherche" data-msg-recherche hidden>
          <input type="search" maxlength="100" placeholder="Chercher dans ces messages : STEG, relevé…" aria-label="Chercher dans ces messages" data-msg-q>
          <button type="button" class="msg-lien" data-msg-q-fermer>Fermer</button></div>
        <div class="msg-trouves" data-msg-trouves aria-live="polite" hidden></div>`;
      // (1.115.0, 1.116.0) Ce qui s'ajoute au message (la pièce demandée, une pièce, un fichier) se range AU-DESSUS du champ :
      // la zone d'écriture tient au bas de l'écran, ce qui s'ouvre sous les boutons les faisait remonter sous le curseur.
      const ecrire = f && f.actif ? `<form class="msg-ecrire" data-msg-ecrire novalidate>
              <label class="msg-cache" for="msg-texte${integre ? '-i' : ''}">${entreprise ? 'Ton message à ton cabinet' : 'Ton message à ce client'}</label>
              ${/* (1.116.0) Plusieurs pièces en une fois (dix au plus), et la date « pour le » : passée sans réponse, la demande
                 se relance seule par e-mail (une par semaine, trois au plus). Vide, elle ne se relance pas. */''}
              <div class="msg-demande" data-msg-demande hidden>
                <span class="msg-demande-titre" id="msg-dt${integre ? '-i' : ''}">Les pièces que tu demandes</span>
                <div class="msg-demande-liste" data-msg-demande-liste>
                  <input type="text" maxlength="300" placeholder="Par exemple : la facture STEG d'août" data-msg-demande-txt aria-labelledby="msg-dt${integre ? '-i' : ''}"></div>
                <span class="msg-demande-pied">
                  <button type="button" class="msg-lien" data-msg-demande-plus>+ Une autre pièce</button>
                  <label class="msg-demande-pour"><span>Pour le</span><input type="date" data-msg-demande-pour></label>
                  <span class="small muted">Sans réponse à cette date, ${esc(nomAutre)} reçoit un rappel par e-mail (une fois par semaine, trois au plus).</span>
                </span>
              </div>
              <div class="msg-joints" data-msg-joints hidden></div>
              <textarea id="msg-texte${integre ? '-i' : ''}" rows="2" maxlength="4000" placeholder="Écris à ${esc(nomAutre)}…" data-msg-texte></textarea>
              <p class="msg-refus" role="alert" data-msg-refus></p>
              <div class="msg-gestes">
                <span class="msg-gestes-g">
                  ${/* (1.115.0) Au téléphone, un mot court : les trois gestes et « Envoyer » tiennent sur une ligne, sous le champ. */''}
                  <button type="button" class="btn" data-msg-joindre aria-label="Joindre une photo ou un PDF">${dessin('trombone')}<span class="msg-long">Joindre une photo ou un PDF</span><span class="msg-court" aria-hidden="true">Joindre</span></button>
                  ${entreprise && o.pieces ? `<button type="button" class="btn" data-msg-piece aria-label="Parler d'une pièce">${dessin('piece')}<span class="msg-long">Parler d'une pièce</span><span class="msg-court" aria-hidden="true">Une pièce</span></button>` : ''}
                  ${entreprise ? '' : `<button type="button" class="btn" data-msg-demander aria-pressed="false" aria-label="Demander une pièce">${dessin('piece')}<span class="msg-long">Demander une pièce</span><span class="msg-court" aria-hidden="true">Demander</span></button>`}
                  ${/* (1.117.0) Les modèles du cabinet : la phrase écrite cent fois, prise d'un geste (point 9). */''}
                  ${!entreprise && o.modeles ? `<button type="button" class="btn" data-msg-modeles aria-label="Modèles de messages">${dessin('modele')}<span class="msg-long">Modèles</span><span class="msg-court" aria-hidden="true">Modèles</span></button>` : ''}
                </span>
                <button type="submit" class="btn btn-primary" data-msg-envoyer>Envoyer</button>
              </div>
            </form>` : '';
      el.innerHTML = integre
        ? `<div class="msg-page msg-integre msg-cabinet">${tete}
          <div class="msg-bandeau" data-msg-cote></div>
          <section class="msg-zone" aria-label="Les messages">${recherche}<div class="msg-fil" data-msg-fil></div>${ecrire}</section>
        </div>`
        : `<div class="msg-page${entreprise ? '' : ' msg-cabinet'}">${tete}
        <div class="msg-corps">
          <section class="msg-zone" aria-label="Les messages">
            ${recherche}
            <div class="msg-fil" data-msg-fil></div>
            ${ecrire}
          </section>
          <aside class="msg-a-cote" data-msg-cote></aside>
        </div>
      </div>`;
      const grand = el.querySelector('[data-msg-en-grand]');
      if (grand && o.enGrand) /** @type {HTMLElement} */ (grand).onclick = o.enGrand;
      const r = el.querySelector('[data-msg-retour]');
      if (r && o.retour) /** @type {HTMLElement} */ (r).onclick = o.retour.aller;
      brancherEcrire();
      brancherRecherche();
    }

    // ── (1.117.0) Chercher dans le fil ─────────────────────────────────────────────────────────────────────────────
    function brancherRecherche() {
      const btn = /** @type {HTMLElement} */ (el.querySelector('[data-msg-chercher]'));
      const barre = /** @type {HTMLElement} */ (el.querySelector('[data-msg-recherche]'));
      const champ = /** @type {HTMLInputElement} */ (el.querySelector('[data-msg-q]'));
      const trouves = /** @type {HTMLElement} */ (el.querySelector('[data-msg-trouves]'));
      /** @type {ReturnType<typeof setTimeout> | undefined} */ let minuterie;
      /** @param {string | null} html */
      const montrer = (html) => {
        const fil = /** @type {HTMLElement} */ (el.querySelector('[data-msg-fil]'));
        trouves.hidden = html === null;
        fil.hidden = html !== null;
        if (html !== null) trouves.innerHTML = html;
      };
      /** @param {boolean} oui */
      const ouvrir = (oui) => {
        barre.hidden = !oui;
        btn.setAttribute('aria-expanded', String(oui));
        if (oui) { champ.focus(); return; }
        clearTimeout(minuterie);
        champ.value = '';
        montrer(null);
      };
      btn.onclick = () => { const ouverte = !barre.hidden; ouvrir(!ouverte); if (ouverte) btn.focus(); };
      /** @type {HTMLElement} */ (el.querySelector('[data-msg-q-fermer]')).onclick = () => { ouvrir(false); btn.focus(); };
      champ.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ouvrir(false); btn.focus(); } };
      champ.oninput = () => { clearTimeout(minuterie); minuterie = setTimeout(() => { void chercher(); }, 250); };
      async function chercher() {
        const q = champ.value.trim();
        if (q.length < 2) { montrer(q ? '<p class="msg-trouves-dit">Encore une lettre : la recherche commence à deux.</p>' : null); return; }
        const p = new URLSearchParams({ cote: o.cote, q });
        if (cabinetRelu) p.set('cabinet', cabinetRelu);
        /** @type {any} */ let r;
        try { r = await o.appel('GET', `/messages/recherche?${p}`); } catch (x) { montrer(`<p class="msg-refus">${esc(motif(x))}</p>`); return; }
        // Une recherche plus récente est partie entre-temps : celle-ci ne s'affiche pas.
        if (champ.value.trim() !== q || barre.hidden !== false) return;
        const n = r.trouves.length;
        const dit = !n ? `Aucun message ne contient « ${esc(q)} ».`
          : r.plus ? `Plus de ${n} messages contiennent « ${esc(q)} » : voici les ${n} plus récents. Précise ta recherche pour les autres.`
            : `${pl(n, 'message')} ${n > 1 ? 'contiennent' : 'contient'} « ${esc(q)} ». Choisis-en un pour le voir dans la conversation.`;
        montrer(`<p class="msg-trouves-dit">${dit}</p>${r.trouves.map((/** @type {any} */ m) => {
          const champs = [m.texte, m.demande ? `Pièce demandée : ${m.demande}` : '', m.piece || '', m.fichier || ''].filter(Boolean);
          const montre = champs.find((x) => plier(x).includes(plier(q))) || champs[0] || '';
          return `<button type="button" class="msg-trouve" data-msg-trouve="${esc(m.id)}">
            <span class="msg-trouve-tete">${esc(dateCourte(jourCle(m.ecritLe)))} · ${esc(m.moi ? 'Toi' : m.auteur)}</span>
            <span class="msg-trouve-txt">${surligner(montre, q)}</span></button>`;
        }).join('')}`);
        trouves.querySelectorAll('[data-msg-trouve]').forEach((b) => {
          /** @type {HTMLElement} */ (b).onclick = () => { void allerAuMessage(String(/** @type {HTMLElement} */ (b).dataset.msgTrouve)); };
        });
      }
      // Le message choisi se montre dans le fil : les pages plus anciennes se lisent jusqu'à lui, puis il s'éclaire.
      /** @param {string} id */
      async function allerAuMessage(id) {
        ouvrir(false);
        const present = () => [...(lu.messages || []), ...anciensMessages].some((m) => m.id === id);
        for (let tours = 0; !present() && suite && tours < 40; tours++) {
          const r = await o.appel('GET', chemin(suite));
          anciensMessages = [...anciensMessages, ...r.messages];
          anciennesQuestions = [...anciennesQuestions, ...r.questions];
          suite = r.suite;
        }
        dessinerFil();
        const ligne = /** @type {HTMLElement | null} */ (el.querySelector(`[data-msg-id="${CSS.escape(id)}"]`));
        if (!ligne) return;
        ligne.scrollIntoView({ block: 'center' });
        ligne.classList.remove('msg-eclaire');
        void ligne.offsetWidth;
        ligne.classList.add('msg-eclaire');
        setTimeout(() => ligne.classList.remove('msg-eclaire'), 2200);
      }
    }

    // ── Le fil ───────────────────────────────────────────────────────────────────────────────
    // Les messages et les questions (et leurs réponses), dans l'ordre du temps, séparés par jour.
    function evenements() {
      const msgs = [...(lu.messages || []), ...anciensMessages];
      const qs = [...(lu.questions || []), ...anciennesQuestions];
      const vus = new Set();
      /** @type {{ quand: string, sorte: string, x: any }[]} */
      const ev = [];
      for (const m of msgs) { if (vus.has(m.id)) continue; vus.add(m.id); ev.push({ quand: m.ecritLe, sorte: 'message', x: m }); }
      for (const q of qs) {
        if (vus.has(q.id)) continue;
        vus.add(q.id);
        ev.push({ quand: q.envoyeeLe, sorte: 'question', x: q });
        if (q.reponse && q.reponduLe) ev.push({ quand: q.reponduLe, sorte: 'reponse', x: q });
      }
      return ev.sort((a, b) => (a.quand < b.quand ? -1 : a.quand > b.quand ? 1 : 0));
    }
    const demandes = () => new Map([...(lu.messages || []), ...anciensMessages].filter((m) => m.demande).map((m) => [m.id, m]));

    /** @param {any} m */
    function bulleMessage(m) {
      // De mon côté du fil (à droite), écrit par moi (« Toi ») ou par un collègue (son nom).
      const moi = m.cote === o.cote;
      const qui = m.moi ? 'Toi' : m.auteur;
      const tete = moi ? `${esc(heure(m.ecritLe))} · <b>${esc(qui)}</b>` : `<b>${esc(qui)}</b> · ${esc(heure(m.ecritLe))}`;
      const actif = lu.fil && lu.fil.actif;
      let corps = '';
      if (m.texte) corps += `<div class="msg-bulle">${esc(m.texte)}</div>`;
      if (m.piece) {
        // (1.116.0) « Ouvrir » des deux côtés : chez le cabinet, la pièce se cherche dans les livres du client, par son numéro.
        const ouvre = o.ouvrirPiece ? `<button type="button" class="msg-lien" data-msg-ouvrir="${esc(m.piece.genre)}:${esc(m.piece.id)}" data-msg-libelle="${esc(m.piece.libelle)}">Ouvrir</button>` : '';
        // (1.115.0) Le genre en titre, le libellé dessous : au téléphone, « Achat · » restait seul au bout de sa ligne.
        corps += `<div class="msg-carte">${dessin('piece')}<span class="msg-carte-txt"><b>${esc(GENRES[m.piece.genre] || 'Pièce')}</b><span>${esc(m.piece.libelle)}</span></span>${ouvre}</div>`;
      }
      if (m.demande) {
        const recue = !!m.demande.recueLe;
        // (1.116.0) Sa date « pour le », et passée sans réponse, « En retard », des deux côtés ; côté cabinet, les relances
        // parties (le client ne voit que la date : la relance est un e-mail, pas un reproche dans le fil).
        const retard = !recue && !!m.demande.enRetard;
        const geste = recue || !actif ? ''
          : entreprise ? `<button type="button" class="btn btn-sm btn-primary" data-msg-envoyer-piece="${esc(m.id)}">Envoyer la pièce…</button>`
            : `<button type="button" class="btn btn-sm" data-msg-recue="${esc(m.id)}">Reçue autrement</button>`;
        const pour = m.demande.pour && !recue ? `<span class="msg-pour">pour le ${esc(dateCourte(m.demande.pour))}</span>` : '';
        const relances = !entreprise && m.demande.relances && !recue
          ? `<span class="msg-carte-sous">${m.demande.relances > 1 ? `Relancée ${m.demande.relances} fois par e-mail, la dernière le` : 'Relancée par e-mail le'} ${esc(dateCourte(jourCle(m.demande.relanceLe)))}${m.demande.relances >= 3 ? ' : plus de relance automatique' : ''}</span>` : '';
        corps += `<div class="msg-carte msg-demande-carte${recue ? ' recue' : ''}${retard ? ' retard' : ''}">${dessin('piece')}<span class="msg-carte-txt"><b>Pièce demandée</b><span>${esc(m.demande.texte)}</span>${pour}</span>
          <span class="msg-etat">${recue ? 'Reçue' : retard ? 'En retard' : entreprise ? 'À envoyer' : 'Attendue'}</span>${geste}${relances}</div>`;
      }
      if (m.fichier) {
        corps += `<div class="msg-fichier">${dessin(m.fichier.type === 'application/pdf' ? 'piece' : 'image')}
          <span class="msg-carte-txt"><b>${esc(m.fichier.nom)}</b><span class="msg-poids">${esc(m.fichier.type === 'application/pdf' ? 'PDF' : 'Photo')} · ${esc(poids(m.fichier.taille))}</span></span>
          <button type="button" class="msg-lien" data-msg-fichier="${esc(m.fichier.id)}">Ouvrir</button>
          <button type="button" class="msg-lien" data-msg-enregistrer="${esc(m.fichier.id)}" aria-label="Enregistrer ${esc(m.fichier.nom)}">Enregistrer</button>
          ${!entreprise && m.cote === 'entreprise' && o.saisirPiece && actif ? `<button type="button" class="msg-lien" data-msg-saisir="${esc(m.id)}">Saisir cette pièce</button>` : ''}</div>`;
      }
      if (m.repondA) {
        const d = demandes().get(m.repondA);
        if (d) corps = `<span class="msg-reponse-a">En réponse à : ${esc(d.demande.texte)}</span>${corps}`;
      }
      /** @type {string[]} */
      const pied = [];
      // (1.115.0) « Envoyé », puis « Lue » : rien ne disait qu'un message était parti avant que l'autre l'ait lu.
      if (moi) pied.push(m.lu ? 'Lue' : 'Envoyé');
      if (m.achat) pied.push(`rangée dans ${entreprise ? 'tes' : 'ses'} achats (${esc(m.achat.libelle)})`);
      // (1.94.0) Le « · » reste avec le genre (une ligne qui passe à la suivante ne commence plus par lui), et un fichier
      // envoyé avec une facture, un avoir ou un devis n'est pas un achat : il ne se propose pas d'y être rangé.
      const ranger = entreprise && actif && m.fichier && !m.achat && o.rangerAchat && !(m.piece && m.piece.genre !== 'achat')
        ? `<button type="button" class="btn btn-sm" data-msg-ranger="${esc(m.id)}">Ranger dans mes achats…</button>` : '';
      return `<div class="msg-ligne${moi ? ' moi' : ''}" data-msg-id="${esc(m.id)}">
        <span class="msg-qui">${tete}</span>${corps}
        ${pied.length ? `<span class="msg-pied">${pied.map((x, i) => (i ? x : x.charAt(0).toUpperCase() + x.slice(1))).join(' · ')}</span>` : ''}${ranger}</div>`;
    }

    /** @param {any} q */
    function carteQuestion(q) {
      // La question vient du cabinet : chez lui, c'est la sienne.
      const moi = !entreprise;
      const attend = q.statut === 'envoyee' && !q.reponse;
      const cible = entreprise && q.piece && o.pieceDuNumero ? o.pieceDuNumero(q.piece) : null;
      const brouillon = reponses.get(q.id) || '';
      const repondre = entreprise && attend && o.repondre && lu.fil && lu.fil.actif ? `<div class="msg-q-repondre">
          <label class="msg-cache" for="msg-q-${esc(q.id)}">Ta réponse</label>
          <textarea id="msg-q-${esc(q.id)}" rows="2" maxlength="4000" placeholder="Ta réponse, en une phrase : c'est ce que ton cabinet lira." data-msg-q-texte="${esc(q.id)}">${esc(brouillon)}</textarea>
          <p class="msg-refus" role="alert" data-msg-q-refus="${esc(q.id)}"></p>
          <span class="msg-q-gestes"><button type="button" class="btn btn-sm btn-primary" data-msg-q-envoyer="${esc(q.id)}">Envoyer ma réponse</button>
          ${cible ? `<button type="button" class="msg-lien" data-msg-ouvrir="${esc(cible.genre)}:${esc(cible.id)}">Ouvrir la pièce</button>` : ''}</span></div>` : '';
      // (1.115.0) Répondue, elle le dit : l'étiquette « Attend ta réponse » disparaissait sans rien à sa place.
      const etat = q.statut === 'close' ? '<span class="msg-q-etat">Close par le cabinet</span>'
        : attend ? `<span class="msg-q-etat attend">${entreprise ? 'Attend ta réponse' : 'Attend le client'}</span>`
          : q.reponse ? '<span class="msg-q-etat ok">Répondue</span>' : '';
      // Qui l'a posée : « Toi », un collègue par son nom, sinon le cabinet.
      const pose = q.poseePar === 'moi' ? 'Toi' : q.poseePar || (entreprise ? 'Ton cabinet' : 'Le cabinet');
      return `<div class="msg-ligne${moi ? ' moi' : ''}" data-msg-q="${esc(q.id)}">
        <span class="msg-qui">${moi ? `${esc(heure(q.envoyeeLe))} · <b>${esc(pose)}</b>` : `<b>${esc(pose)}</b> · ${esc(heure(q.envoyeeLe))}`}</span>
        <div class="msg-question${attend ? ' attend' : ''}">
          <div class="msg-q-tete">${dessin('question')}<span><b>${q.piece ? `Question sur ${esc(q.piece)}` : 'Question de la révision'}</b>${q.objet ? ` · ${esc(q.objet)}` : ''}</span>
            ${q.montant && !/^-?0(\.0+)?$/.test(q.montant) ? `<span class="msg-montant">${esc(montant(q.montant))}</span>` : ''}</div>
          <div class="msg-q-corps"><span>${esc(q.texte)}</span>
            <span class="msg-q-attendu">${entreprise ? 'Ton cabinet attend' : 'Tu attends'} : ${esc(ATTENDUS[q.attendu] || 'une réponse')}.</span>
            ${etat}${repondre}</div>
        </div></div>`;
    }
    /** @param {any} q */
    function bulleReponse(q) {
      const moi = entreprise;
      const qui = q.repondueePar === 'moi' ? 'Toi' : q.repondueePar || (entreprise ? 'Ton entreprise' : 'Le client');
      return `<div class="msg-ligne${moi ? ' moi' : ''}">
        <span class="msg-qui">${moi ? `${esc(heure(q.reponduLe))} · <b>${esc(qui)}</b>` : `<b>${esc(qui)}</b> · ${esc(heure(q.reponduLe))}`}</span>
        ${/* (1.97.0) Une réponse dit à quelle question : « Réponse à la question » seul ne dit rien d'une question sans pièce. */''}
        <span class="msg-reponse-a">Réponse à la question${q.objet ? ` « ${esc(q.objet)} »` : ''}${q.piece ? ` sur ${esc(q.piece)}` : ''}</span>
        <div class="msg-bulle">${esc(q.reponse)}</div></div>`;
    }

    function dessinerFil() {
      const fil = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-fil]'));
      if (!fil) return;
      // Le texte d'une réponse en cours se garde (la relecture redessine le fil), et le curseur y revient.
      const actif = /** @type {HTMLElement | null} */ (document.activeElement);
      const garde = actif && fil.contains(actif) && actif instanceof HTMLTextAreaElement ? { id: actif.id, debut: actif.selectionStart, fin: actif.selectionEnd } : null;
      const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 40;
      const ev = evenements();
      let html = suite ? '<div class="msg-plus"><button type="button" class="btn btn-sm" data-msg-plus>Voir les messages plus anciens</button></div>' : '';
      let jour = '';
      for (const e of ev) {
        const j = jourCle(e.quand);
        if (j !== jour) { jour = j; html += `<span class="msg-jour">${esc(jourDit(e.quand))}</span>`; }
        html += e.sorte === 'message' ? bulleMessage(e.x) : e.sorte === 'question' ? carteQuestion(e.x) : bulleReponse(e.x);
      }
      if (!ev.length) {
        html += `<div class="msg-vide"><b>${entreprise ? 'Aucun message encore.' : 'Aucun échange encore avec ce client.'}</b>
          <span>${entreprise ? 'Écris à ton cabinet ici, joins une photo de facture ou demande-lui ce qu\'il te faut : chaque message garde sa date et son auteur, dans ton dossier.'
            : 'Écris-lui ici, demande-lui une pièce, ou pose tes questions pendant la révision : elles arrivent dans ce fil, avec sa réponse.'}</span></div>`;
      }
      fil.innerHTML = html;
      brancherFil(fil);
      if (garde) {
        const t = /** @type {HTMLTextAreaElement | null} */ (garde.id ? document.getElementById(garde.id) : null);
        if (t) { t.focus(); t.setSelectionRange(garde.debut, garde.fin); }
      }
      if (premier || enBas) fil.scrollTop = fil.scrollHeight;
      premier = false;
    }

    function dessinerCote() {
      const cote = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-cote]'));
      if (!cote) return;
      const a = lu.attente || { nonLus: 0, questions: 0, demandes: 0 };
      const f = lu.fil;
      /** @type {string[]} */ const attend = [];
      if (a.questions) attend.push(pl(a.questions, 'question sans réponse', 'questions sans réponse'));
      if (a.demandes) attend.push(pl(a.demandes, 'pièce demandée', 'pièces demandées') + (a.enRetard ? ` (${a.enRetard === a.demandes ? (a.demandes > 1 ? 'toutes en retard' : 'en retard') : `dont ${a.enRetard} en retard`})` : ''));
      const rien = !attend.length;
      const texte = entreprise
        ? (rien ? 'Rien : aucune question ni pièce demandée n\'attend ta réponse.' : `${attend.join(' et ')} de ton cabinet.`)
        // (1.102.0) Sans rien qui attend, la phrase ne dit que cela : « ce client a répondu à tes questions » s'affichait
        // aussi sur un fil où rien n'avait jamais été demandé (parcours du 21/10/2026).
        : (rien ? 'Rien : aucune question ni pièce demandée n\'attend sa réponse.' : `${attend.join(' et ')} : le client n'a pas encore répondu.`);
      const anciens = entreprise && (lu.anciens || []).length ? `<div class="msg-encart">
          <b>${cabinetRelu ? 'Ton cabinet d\'aujourd\'hui' : 'Tes cabinets d\'avant'}</b>
          ${cabinetRelu ? '<button type="button" class="msg-lien" data-msg-actuel>Revenir au fil de ton cabinet</button>'
            : (lu.anciens || []).map((/** @type {any} */ x) => `<button type="button" class="msg-lien" data-msg-ancien="${esc(x.cabinet)}">Relire vos échanges avec ${esc(x.nom || 'ce cabinet')}</button>`).join('')}
        </div>` : '';
      // (1.97.0) Ce qui attend la réponse du client se trouve plus haut dans le fil, hors de la vue quand la page s'ouvre
      // sur les derniers messages : l'encart y mène, le curseur dans la réponse de la plus ancienne.
      const aller = entreprise && !rien && f && f.actif && o.repondre
        ? `<button type="button" class="msg-lien" data-msg-aller>${a.questions + a.demandes > 1 ? 'Répondre, en commençant par la plus ancienne' : 'Répondre'}</button>` : '';
      // (1.115.0) Dans la boîte du cabinet, un bandeau d'une ligne au-dessus du fil : ce qui attend le client, « Marquer
      // comme traité », la question de la révision, l'alerte par e-mail ; le fil garde la hauteur.
      if (o.integre) {
        cote.innerHTML = `${f ? `<span class="msg-bandeau-etat${rien ? ' ok' : ' attend'}" data-msg-attente>${esc(texte)}</span>` : ''}
          <span class="msg-bandeau-gestes">
            ${f && f.aTraiter ? '<button type="button" class="btn btn-sm" data-msg-traite title="Ce client t\'a écrit depuis ta dernière réponse. Rien à lui répondre ? Il quitte « À traiter » jusqu\'à son prochain message.">Marquer comme traité</button>' : ''}
            ${o.revision ? '<button type="button" class="msg-lien" data-msg-revision>Question sur une pièce (révision)</button>' : ''}
            ${f && f.actif ? `<label class="msg-bandeau-alerte" title="« Un nouveau message t'attend dans SkanFact », cinq minutes après s'il n'est pas lu. Le message lui-même reste dans SkanFact."><input type="checkbox" data-msg-alerte ${f.alerte ? 'checked' : ''}>Me prévenir par e-mail</label>` : ''}
          </span>`;
        brancherCote(cote);
        return;
      }
      cote.innerHTML = `${f ? `<div class="msg-encart${rien ? ' ok' : ' attend'}" data-msg-attente><b>${entreprise ? 'En attente de toi' : 'Ce qui attend le client'}</b><span>${esc(texte)}</span>${aller}</div>` : ''}
        ${entreprise ? `<div class="msg-encart"><b>Ce que voit ton cabinet</b><span>Ce fil, et ce que ton mandat lui confie, pour cette entreprise seulement. Chaque message garde sa date et son auteur, dans ton dossier.</span>
          ${o.voirMandat ? '<button type="button" class="msg-lien" data-msg-mandat>Voir le mandat</button>' : ''}</div>`
          // (1.98.0) « C'est traité » seulement quand ce client est « À traiter » : après une réponse du cabinet, il ne
          // l'est plus, et le bouton promettait de l'en sortir.
          // (1.115.0) « Rien à faire ? » et un petit « C'est traité » ne disaient pas ce que fait le geste : le client a écrit
          // depuis ta dernière réponse ; « Marquer comme traité » le sort de « À traiter » sans lui répondre.
          : f && f.aTraiter || o.revision ? `<div class="msg-encart">${f && f.aTraiter ? `<b>À traiter</b><span>Ce client t'a écrit depuis ta dernière réponse. Rien à lui répondre ? Il quitte « À traiter » jusqu'à son prochain message.</span>
            <button type="button" class="btn btn-sm" data-msg-traite>Marquer comme traité</button>` : ''}
            ${o.revision ? '<button type="button" class="msg-lien" data-msg-revision>Poser une question sur une pièce (révision)</button>' : ''}</div>` : ''}
        ${f && f.actif ? `<label class="msg-encart msg-alerte"><input type="checkbox" data-msg-alerte ${f.alerte ? 'checked' : ''}>
          <span><b>Me prévenir par e-mail</b><span>« Un nouveau message t'attend dans SkanFact », cinq minutes après s'il n'est pas lu. Le message lui-même reste dans SkanFact.</span></span></label>` : ''}
        ${anciens}`;
      brancherCote(cote);
    }

    // ── Lire, relire ───────────────────────────────────────────────────────────────────────────
    async function lire() {
      if (enCours || fini) return;
      enCours = true;
      try {
        const r = await o.appel('GET', chemin(null));
        // La page a changé (la racine n'est plus à l'écran) : la conversation s'arrête là.
        if (!el.isConnected) { arreter(); return; }
        if (fini) return;
        const nouvelle = JSON.stringify([r.messages.map((/** @type {any} */ m) => [m.id, m.lu, m.achat, m.demande && m.demande.recueLe]),
          r.questions.map((/** @type {any} */ q) => [q.id, q.statut, q.reponduLe]), r.attente, r.fil && [r.fil.alerte, r.fil.actif]]);
        const premiereFois = !lu;
        if (premiereFois) suite = r.suite;
        lu = r;
        // Aucun cabinet ne tient le dossier, et aucun ne l'a tenu : rien à relire, le geste qui ouvre la messagerie.
        if (premiereFois && !r.fil && !(r.anciens || []).length) {
          el.innerHTML = `<div class="msg-page"><header class="msg-tete"><span class="msg-tete-txt"><h1>${entreprise ? 'Mon comptable' : esc(o.nom || 'Ce client')}</h1></span></header>
            <div class="msg-zone"><div class="msg-vide"><b>${entreprise ? 'Aucun cabinet ne tient ton dossier.' : 'Ce dossier n\'est plus tenu par ton cabinet.'}</b>
              <span>${entreprise ? 'La messagerie s\'ouvre quand ton comptable accepte de tenir ton dossier dans SkanFact : vous vous écrivez alors ici, en face de tes pièces.' : 'La messagerie se ferme avec le mandat.'}</span>
              ${entreprise && o.inviter ? '<button type="button" class="btn btn-primary" data-msg-inviter>Inviter mon comptable</button>' : ''}</div></div></div>`;
          const b = el.querySelector('[data-msg-inviter]');
          if (b && o.inviter) /** @type {HTMLElement} */ (b).onclick = o.inviter;
          signature = 'vide';
          return;
        }
        // Ce qui attend d'abord, le fil ensuite : posé au-dessus du fil (la boîte du cabinet), le bandeau le raccourcit, et
        // le fil se met en bas une fois sa hauteur connue.
        if (premiereFois) { poserLaPage(); dessinerCote(); dessinerFil(); }
        else if (nouvelle !== signature) { dessinerCote(); dessinerFil(); }
        signature = nouvelle;
        if (o.surAttente && !cabinetRelu) o.surAttente(r.attente);
        // Lu : ce que l'autre côté a écrit, vu ici, page visible.
        if (r.fil && r.attente && r.attente.aLire && document.visibilityState === 'visible') {
          await o.appel('POST', '/messages/lu', { cote: o.cote, cabinet: cabinetRelu });
          if (o.surAttente && !cabinetRelu) o.surAttente({ ...r.attente, nonLus: 0, aLire: false });
        }
      } catch (x) {
        if (!lu) el.innerHTML = `<div class="msg-page"><div class="msg-vide"><b>La messagerie ne s'est pas ouverte.</b><span>${esc(motif(x))}</span>
          <button type="button" class="btn" data-msg-relire>Réessayer</button></div></div>`;
        const b = el.querySelector('[data-msg-relire]');
        if (b) /** @type {HTMLElement} */ (b).onclick = () => { void lire(); };
      } finally { enCours = false; }
    }
    // Après un geste : la relecture tout de suite, et le fil redessiné même si rien d'autre n'a bougé.
    async function relire() { signature = ''; await lire(); }

    // ── Brancher ───────────────────────────────────────────────────────────────────────────────
    /** @param {HTMLElement} racine @param {string} sel @param {(b: HTMLButtonElement) => Promise<void>} f */
    function surClic(racine, sel, f) {
      racine.querySelectorAll(sel).forEach((n) => {
        const b = /** @type {HTMLButtonElement} */ (n);
        b.onclick = async (e) => {
          e.preventDefault();
          if (b.disabled) return;
          b.disabled = true;
          try { await f(b); } catch (x) { if (o.toast) o.toast(motif(x), true); } finally { if (b.isConnected) b.disabled = false; }
        };
      });
    }
    /** @param {HTMLElement} fil */
    function brancherFil(fil) {
      const plus = fil.querySelector('[data-msg-plus]');
      if (plus) surClic(fil, '[data-msg-plus]', async () => {
        if (!suite) return;
        const r = await o.appel('GET', chemin(suite));
        anciensMessages = [...anciensMessages, ...r.messages];
        anciennesQuestions = [...anciennesQuestions, ...r.questions];
        suite = r.suite;
        const avant = fil.scrollHeight;
        dessinerFil();
        fil.scrollTop = fil.scrollHeight - avant;
      });
      surClic(fil, '[data-msg-fichier]', async (b) => { await ouvrirFichier(o.appel, String(b.dataset.msgFichier)); });
      surClic(fil, '[data-msg-enregistrer]', async (b) => { await ouvrirFichier(o.appel, String(b.dataset.msgEnregistrer), true); });
      fil.querySelectorAll('[data-msg-ouvrir]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.onclick = () => {
          const [genre = '', id = ''] = String(b.dataset.msgOuvrir).split(':');
          if (o.ouvrirPiece && !o.ouvrirPiece(genre, id, String(b.dataset.msgLibelle || '')) && o.toast) o.toast('Cette pièce n\'est plus dans ton dossier : elle a été supprimée.', true);
        };
      });
      // (1.116.0) « Saisir cette pièce » : la photo s'ouvre à côté, la saisie du client au mois du message (le cabinet).
      surClic(fil, '[data-msg-saisir]', async (b) => {
        const m = [...(lu.messages || []), ...anciensMessages].find((x) => x.id === b.dataset.msgSaisir);
        if (!m || !m.fichier || !o.saisirPiece) return;
        await ouvrirFichier(o.appel, String(m.fichier.id));
        o.saisirPiece({ id: m.id, ecritLe: m.ecritLe, fichier: m.fichier });
      });
      surClic(fil, '[data-msg-recue]', async (b) => {
        await o.appel('POST', `/messages/${encodeURIComponent(String(b.dataset.msgRecue))}/recue`);
        await relire();
      });
      // (1.115.0) « Envoyer la pièce… » ouvre une fenêtre : une photo ou un PDF, vu avant de partir, ou la pièce déjà
      // dans le dossier (revue du 22/10/2026 : le fichier partait dès qu'il était choisi, sans « Annuler », et la facture
      // STEG déjà saisie dans les achats devait être renvoyée).
      surClic(fil, '[data-msg-envoyer-piece]', async (b) => {
        const m = demandes().get(String(b.dataset.msgEnvoyerPiece));
        if (m) envoyerPiece(m);
      });
      surClic(fil, '[data-msg-ranger]', async (b) => {
        const m = [...(lu.messages || []), ...anciensMessages].find((x) => x.id === b.dataset.msgRanger);
        if (!m || !m.fichier || !o.rangerAchat) return;
        const f = await o.appel('GET', `/messages/fichiers/${encodeURIComponent(m.fichier.id)}`);
        o.rangerAchat({ id: m.id, nom: f.nom, type: f.type, contenu: f.contenu });
      });
      fil.querySelectorAll('[data-msg-q-texte]').forEach((n) => {
        const t = /** @type {HTMLTextAreaElement} */ (n);
        t.oninput = () => { reponses.set(String(t.dataset.msgQTexte), t.value); };
      });
      surClic(fil, '[data-msg-q-envoyer]', async (b) => {
        const id = String(b.dataset.msgQEnvoyer);
        const t = /** @type {HTMLTextAreaElement | null} */ (fil.querySelector(`[data-msg-q-texte="${CSS.escape(id)}"]`));
        const refus = /** @type {HTMLElement | null} */ (fil.querySelector(`[data-msg-q-refus="${CSS.escape(id)}"]`));
        const texte = t ? t.value.trim() : '';
        if (!texte) {
          if (refus) refus.textContent = 'Une réponse vide n\'apprend rien à ton cabinet : écris ta réponse, puis « Envoyer ma réponse ».';
          if (t) t.focus();
          return;
        }
        try { if (o.repondre) await o.repondre(id, texte); } catch (x) { if (refus) refus.textContent = motif(x); if (t) t.focus(); return; }
        reponses.delete(id);
        if (o.toast) o.toast('Réponse envoyée : ton cabinet la lit dans ce fil.');
        await relire();
      });
    }
    /** @param {HTMLElement} cote */
    function brancherCote(cote) {
      const alerte = /** @type {HTMLInputElement | null} */ (cote.querySelector('[data-msg-alerte]'));
      if (alerte) alerte.onchange = async () => {
        const voulu = alerte.checked;
        alerte.disabled = true;
        try {
          await o.appel('PUT', '/messages/alerte', { cote: o.cote, active: voulu });
          if (lu.fil) lu.fil.alerte = voulu;
          if (o.toast) o.toast(voulu ? 'Tu seras prévenu par e-mail d\'un message non lu.' : 'Plus d\'e-mail pour les messages de ce fil.');
        } catch (x) { alerte.checked = !voulu; if (o.toast) o.toast(motif(x), true); } finally { alerte.disabled = false; }
      };
      surClic(cote, '[data-msg-traite]', async () => {
        await o.appel('POST', '/messages/traite');
        if (o.toast) o.toast('C\'est noté : ce client quitte « À traiter » jusqu\'à son prochain message.');
        await relire();
      });
      surClic(cote, '[data-msg-aller]', async () => {
        // La première dans l'ordre du fil, question ou pièce demandée : la plus ancienne.
        const carte = /** @type {HTMLElement | null} */ (el.querySelector('.msg-question.attend, .msg-demande-carte:not(.recue)'));
        if (!carte) return;
        carte.scrollIntoView({ block: 'center' });
        // (1.115.0) Le fil défilait jusqu'à elle sans la montrer : elle s'éclaire un instant.
        carte.classList.remove('msg-eclaire');
        void carte.offsetWidth;
        carte.classList.add('msg-eclaire');
        setTimeout(() => carte.classList.remove('msg-eclaire'), 2200);
        const champ = /** @type {HTMLElement | null} */ (carte.querySelector('textarea, input, button'));
        if (champ) champ.focus({ preventScroll: true });
      });
      const rev = cote.querySelector('[data-msg-revision]');
      if (rev && o.revision) /** @type {HTMLElement} */ (rev).onclick = o.revision;
      const mandat = cote.querySelector('[data-msg-mandat]');
      if (mandat && o.voirMandat) /** @type {HTMLElement} */ (mandat).onclick = o.voirMandat;
      cote.querySelectorAll('[data-msg-ancien]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => { cabinetRelu = String(/** @type {HTMLElement} */ (n).dataset.msgAncien); recommencer(); };
      });
      const actuel = cote.querySelector('[data-msg-actuel]');
      if (actuel) /** @type {HTMLElement} */ (actuel).onclick = () => { cabinetRelu = null; recommencer(); };
    }
    function recommencer() {
      lu = null; anciensMessages = []; anciennesQuestions = []; suite = null; signature = ''; premier = true;
      piece = null; fichier = null;
      void lire();
    }

    function dessinerJoints() {
      const z = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-joints]'));
      if (!z) return;
      /** @type {string[]} */ const x = [];
      if (piece) x.push(`<span class="msg-joint">${dessin('piece')}<span>${esc(GENRES[piece.genre] || 'Pièce')} · ${esc(piece.libelle)}</span><button type="button" aria-label="Ne plus parler de cette pièce" data-msg-sans-piece>${dessin('croix')}</button></span>`);
      if (fichier) x.push(`<span class="msg-joint">${dessin(fichier.type === 'application/pdf' ? 'piece' : 'image')}<span>${esc(fichier.name)} · ${esc(poids(fichier.size))}</span><button type="button" aria-label="Retirer ce fichier" data-msg-sans-fichier>${dessin('croix')}</button></span>`);
      z.innerHTML = x.join('');
      z.hidden = !x.length;
      const sp = z.querySelector('[data-msg-sans-piece]');
      if (sp) /** @type {HTMLElement} */ (sp).onclick = () => { piece = null; dessinerJoints(); };
      const sf = z.querySelector('[data-msg-sans-fichier]');
      if (sf) /** @type {HTMLElement} */ (sf).onclick = () => { fichier = null; dessinerJoints(); };
    }
    function brancherEcrire() {
      const form = /** @type {HTMLFormElement | null} */ (el.querySelector('[data-msg-ecrire]'));
      if (!form) return;
      const texte = /** @type {HTMLTextAreaElement} */ (form.querySelector('[data-msg-texte]'));
      const refus = /** @type {HTMLElement} */ (form.querySelector('[data-msg-refus]'));
      const champDemande = /** @type {HTMLElement} */ (form.querySelector('[data-msg-demande]'));
      const demandeTxt = /** @type {HTMLInputElement} */ (form.querySelector('[data-msg-demande-txt]'));
      const listeDemandes = /** @type {HTMLElement} */ (form.querySelector('[data-msg-demande-liste]'));
      const pourChamp = /** @type {HTMLInputElement} */ (form.querySelector('[data-msg-demande-pour]'));
      // La date proposée : dans sept jours (jour de Tunis) ; pas avant aujourd'hui.
      const dansSeptJours = () => jourCle(Date.now() + 7 * 86_400_000);
      pourChamp.min = jourCle(Date.now());
      pourChamp.value = dansSeptJours();
      const lesDemandes = () => [...listeDemandes.querySelectorAll('[data-msg-demande-txt]')].map((x) => /** @type {HTMLInputElement} */ (x).value.trim()).filter(Boolean);
      const plus = /** @type {HTMLButtonElement} */ (form.querySelector('[data-msg-demande-plus]'));
      plus.onclick = () => {
        const n = listeDemandes.querySelectorAll('[data-msg-demande-txt]').length;
        if (n >= 10) { dire('Dix pièces au plus dans une demande : envoie celle-ci, puis une autre.'); return; }
        const i = document.createElement('input');
        i.type = 'text'; i.maxLength = 300; i.dataset.msgDemandeTxt = ''; i.setAttribute('aria-label', `Pièce demandée ${n + 1}`);
        i.addEventListener('input', () => dire(''));
        listeDemandes.appendChild(i);
        i.focus();
      };
      const dire = (/** @type {string} */ t) => { refus.textContent = t; };
      // (1.102.0) Un refus se lève au premier mot du champ qu'il montre : « Un message vide… » restait affiché sous la
      // pièce qu'on était en train de nommer (parcours du 21/10/2026).
      texte.addEventListener('input', () => dire(''));
      demandeTxt.addEventListener('input', () => dire(''));
      const montrerDemande = () => {
        champDemande.hidden = !demande;
        const b = form.querySelector('[data-msg-demander]');
        if (b) b.setAttribute('aria-pressed', String(demande));
      };
      montrerDemande();
      if (demande) setTimeout(() => demandeTxt.focus(), 0);
      const joindre = /** @type {HTMLButtonElement} */ (form.querySelector('[data-msg-joindre]'));
      joindre.onclick = async () => {
        const f = await choisirFichier(ACCEPTE);
        if (!f) return;
        const lourd = tropLourd(f);
        if (lourd) { dire(lourd); return; }
        fichier = f; dire(''); dessinerJoints();
      };
      const bPiece = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-msg-piece]'));
      // Ce qui part au serveur : le genre, l'identifiant et le libellé de la pièce, rien d'autre.
      if (bPiece) bPiece.onclick = () => choisirPiece((p) => { piece = { genre: p.genre, id: p.id, libelle: p.libelle }; dire(''); dessinerJoints(); texte.focus(); });
      const bDemander = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-msg-demander]'));
      if (bDemander) bDemander.onclick = () => { demande = !demande; montrerDemande(); if (demande) demandeTxt.focus(); else texte.focus(); };
      // (1.117.0) Un modèle se pose dans le champ, là où est le curseur : il se relit et se change avant de partir.
      const bModeles = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-msg-modeles]'));
      const modeles = o.modeles;
      if (bModeles && modeles) bModeles.onclick = () => fenetreModeles({ modeles, client: o.nom || null, utiliser: (t) => {
        const debut = texte.selectionStart ?? texte.value.length;
        const avant = texte.value.slice(0, debut);
        const apres = texte.value.slice(texte.selectionEnd ?? debut);
        const pose = `${avant && !avant.endsWith('\n') ? '\n' : ''}${t}`;
        texte.value = `${avant}${pose}${apres}`;
        texte.setSelectionRange(avant.length + pose.length, avant.length + pose.length);
        dire('');
        texte.focus();
      } });
      // Entrée envoie ; Maj+Entrée va à la ligne. Au téléphone (doigt), Entrée va à la ligne : on envoie du bouton.
      texte.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
      };
      const envoyer = /** @type {HTMLButtonElement} */ (form.querySelector('[data-msg-envoyer]'));
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const t = texte.value.trim();
        const ds = demande ? lesDemandes() : [];
        const d = ds[0] || '';
        if (demande && !d) { dire('Nomme la pièce que tu demandes (par exemple : la facture STEG d\'août), puis « Envoyer ».'); demandeTxt.focus(); return; }
        if (!t && !fichier && !d && !piece) { dire(entreprise ? 'Un message vide n\'apprend rien à ton cabinet : écris quelque chose ou joins une photo.' : 'Un message vide n\'apprend rien à ton client : écris quelque chose, joins un fichier ou demande une pièce.'); texte.focus(); return; }
        envoyer.disabled = true;
        dire('');
        try {
          let depot = null;
          if (fichier) depot = await o.appel('POST', '/messages/fichiers', { cote: o.cote, nom: fichier.name, contenu: await enBase64(fichier) });
          const pour = demande && pourChamp.value ? pourChamp.value : null;
          await o.appel('POST', '/messages', { cote: o.cote, texte: t, piece, fichier: depot ? depot.id : null,
            ...(ds.length > 1 ? { demandes: ds, pour } : { demande: d || null, pour }) });
          texte.value = ''; demandeTxt.value = ''; piece = null; fichier = null; demande = false;
          listeDemandes.querySelectorAll('[data-msg-demande-txt]').forEach((x, i) => { if (i > 0) x.remove(); });
          pourChamp.value = dansSeptJours();
          montrerDemande(); dessinerJoints();
          await relire();
          const fil = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-fil]'));
          if (fil) fil.scrollTop = fil.scrollHeight;
          texte.focus();
        } catch (x) { dire(motif(x)); texte.focus(); } finally { envoyer.disabled = false; }
      };
    }

    // « Parler d'une pièce » : les pièces du dossier, les plus récentes d'abord, à chercher par leur nom.
    /** @param {(p: { genre: string, id: string, libelle: string }) => void} choisie */
    function choisirPiece(choisie) {
      const toutes = (o.pieces ? o.pieces() : []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const fond = document.createElement('div');
      fond.className = 'msg-fenetre-fond';
      fond.innerHTML = `<div class="msg-fenetre" role="dialog" aria-modal="true" aria-labelledby="msg-fp-titre">
        <h2 id="msg-fp-titre">Parler d'une pièce</h2>
        <p class="small muted">Ton cabinet la retrouve dans ton dossier : ta facture, ton avoir, ton devis ou ton achat.</p>
        <input type="search" class="msg-fp-chercher" placeholder="Chercher un numéro, un client, un fournisseur…" aria-label="Chercher une pièce">
        <div class="msg-fp-liste" role="listbox" aria-label="Tes pièces"></div>
        <div class="msg-fp-gestes"><button type="button" class="btn" data-fermer>Annuler</button></div></div>`;
      document.body.appendChild(fond);
      const chercher = /** @type {HTMLInputElement} */ (fond.querySelector('.msg-fp-chercher'));
      const liste = /** @type {HTMLElement} */ (fond.querySelector('.msg-fp-liste'));
      const fermer = () => { fond.remove(); document.removeEventListener('keydown', echap); };
      const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') fermer(); };
      document.addEventListener('keydown', echap);
      const montrer = () => {
        const mots = chercher.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
        const vues = toutes.filter((p) => { const l = `${GENRES[p.genre] || ''} ${p.libelle}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return mots.every((m) => l.includes(m)); });
        liste.innerHTML = vues.length ? vues.slice(0, 50).map((p, i) => `<button type="button" role="option" class="msg-fp-ligne" data-i="${toutes.indexOf(p)}"${i === 0 ? ' aria-selected="true"' : ''}>
            <b>${esc(GENRES[p.genre] || 'Pièce')}</b><span>${esc(p.libelle)}</span>${p.date ? `<span class="msg-fp-date">${esc(dateCourte(String(p.date).slice(0, 10)))}</span>` : ''}</button>`).join('')
          + (vues.length > 50 ? `<p class="small muted">${vues.length - 50} de plus : précise ta recherche.</p>` : '')
          : `<p class="small muted">${toutes.length ? 'Aucune pièce ne correspond : cherche un autre mot.' : 'Ton dossier n\'a encore ni facture, ni avoir, ni devis, ni achat.'}</p>`;
        liste.querySelectorAll('[data-i]').forEach((n) => {
          /** @type {HTMLElement} */ (n).onclick = () => { const p = toutes[Number(/** @type {HTMLElement} */ (n).dataset.i)]; fermer(); if (p) choisie(p); };
        });
      };
      chercher.oninput = montrer;
      chercher.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = /** @type {HTMLElement | null} */ (liste.querySelector('[data-i]')); if (b) b.click(); } };
      /** @type {HTMLElement} */ (fond.querySelector('[data-fermer]')).onclick = fermer;
      fond.onclick = (e) => { if (e.target === fond) fermer(); };
      montrer();
      chercher.focus();
    }

    // « Envoyer la pièce demandée » : une photo ou un PDF (vu avant de partir), ou une pièce déjà dans le dossier ; un mot
    // facultatif. Rien ne part avant « Envoyer à mon cabinet » ; « Annuler » ne laisse rien derrière lui.
    /** @param {any} m le message qui demande la pièce */
    function envoyerPiece(m) {
      const toutes = (o.pieces ? o.pieces() : []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      /** @type {File | null} */ let choisi = null;
      /** @type {{ genre: string, id: string, libelle: string } | null} */ let dejaLa = null;
      /** @type {string | null} */ let apercu = null;
      let facon = 'fichier';
      const fond = document.createElement('div');
      fond.className = 'msg-fenetre-fond';
      fond.innerHTML = `<form class="msg-fenetre" role="dialog" aria-modal="true" aria-labelledby="msg-ep-titre" novalidate>
        <h2 id="msg-ep-titre">Envoyer la pièce demandée</h2>
        <p class="small muted">Ton cabinet attend : <b>${esc(m.demande.texte)}</b>.</p>
        <div class="msg-ep-facons" role="radiogroup" aria-label="Comment l'envoyer">
          <label class="msg-ep-facon"><input type="radio" name="facon" value="fichier" checked><span><b>Une photo ou un PDF</b><span>Prends-la en photo, ou choisis le fichier.</span></span></label>
          ${toutes.length ? `<label class="msg-ep-facon"><input type="radio" name="facon" value="dossier"><span><b>Elle est déjà dans SkanFact</b><span>Une facture, un avoir ou un achat de ton dossier.</span></span></label>` : ''}
        </div>
        <div data-ep-fichier></div>
        <div data-ep-dossier hidden>
          <input type="search" class="msg-fp-chercher" placeholder="Chercher un numéro, un client, un fournisseur…" aria-label="Chercher une pièce">
          <div class="msg-fp-liste" role="listbox" aria-label="Tes pièces"></div>
        </div>
        <label class="msg-ep-mot"><span>Un mot pour ton cabinet <span class="muted">(facultatif)</span></span>
          <textarea rows="2" maxlength="4000" data-ep-mot></textarea></label>
        ${/* Le refus se lit à côté des boutons : posé au-dessus, il les faisait descendre sous le curseur. */''}
        <div class="msg-fp-gestes msg-ep-gestes"><p class="msg-refus" role="alert" data-ep-refus></p>
          <button type="button" class="btn" data-fermer>Annuler</button><button type="submit" class="btn btn-primary" data-ep-envoyer>Envoyer à mon cabinet</button></div>
      </form>`;
      document.body.appendChild(fond);
      const form = /** @type {HTMLFormElement} */ (fond.querySelector('form'));
      const zoneFichier = /** @type {HTMLElement} */ (fond.querySelector('[data-ep-fichier]'));
      const zoneDossier = /** @type {HTMLElement} */ (fond.querySelector('[data-ep-dossier]'));
      const chercher = /** @type {HTMLInputElement} */ (zoneDossier.querySelector('.msg-fp-chercher'));
      const liste = /** @type {HTMLElement} */ (zoneDossier.querySelector('.msg-fp-liste'));
      const mot = /** @type {HTMLTextAreaElement} */ (fond.querySelector('[data-ep-mot]'));
      const refus = /** @type {HTMLElement} */ (fond.querySelector('[data-ep-refus]'));
      const envoyer = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-ep-envoyer]'));
      const fermer = () => { if (apercu) URL.revokeObjectURL(apercu); fond.remove(); document.removeEventListener('keydown', echap); };
      const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') fermer(); };
      document.addEventListener('keydown', echap);
      const dessinerFichier = () => {
        if (!choisi) {
          zoneFichier.innerHTML = '<button type="button" class="btn msg-ep-choisir" data-ep-choisir>' + dessin('trombone') + 'Choisir la photo ou le PDF…</button>';
        } else {
          const image = String(choisi.type).startsWith('image/');
          zoneFichier.innerHTML = `<div class="msg-ep-choisi">${image && apercu ? `<img src="${apercu}" alt="">` : dessin(image ? 'image' : 'piece')}
            <span class="msg-carte-txt"><b>${esc(choisi.name)}</b><span class="msg-poids">${image ? 'Photo' : 'PDF'} · ${esc(poids(choisi.size))}</span></span>
            <button type="button" class="msg-lien" data-ep-choisir>Changer</button></div>`;
        }
        const b = /** @type {HTMLElement} */ (zoneFichier.querySelector('[data-ep-choisir]'));
        b.onclick = async () => {
          const f = await choisirFichier(ACCEPTE);
          if (!f) return;
          const lourd = tropLourd(f);
          if (lourd) { refus.textContent = lourd; return; }
          if (apercu) URL.revokeObjectURL(apercu);
          choisi = f; apercu = String(f.type).startsWith('image/') ? URL.createObjectURL(f) : null; refus.textContent = '';
          dessinerFichier();
        };
      };
      const montrerListe = () => {
        const mots = chercher.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
        const vues = toutes.filter((p) => { const l = `${GENRES[p.genre] || ''} ${p.libelle}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return mots.every((x) => l.includes(x)); });
        liste.innerHTML = vues.length ? vues.slice(0, 50).map((p) => `<button type="button" role="option" class="msg-fp-ligne" data-i="${toutes.indexOf(p)}" aria-selected="${!!dejaLa && dejaLa.id === p.id && dejaLa.genre === p.genre}">
            <b>${esc(GENRES[p.genre] || 'Pièce')}</b><span>${esc(p.libelle)}</span>${p.date ? `<span class="msg-fp-date">${esc(dateCourte(String(p.date).slice(0, 10)))}</span>` : ''}</button>`).join('')
          : '<p class="small muted">Aucune pièce ne correspond : cherche un autre mot.</p>';
        liste.querySelectorAll('[data-i]').forEach((n) => {
          /** @type {HTMLElement} */ (n).onclick = () => {
            const p = toutes[Number(/** @type {HTMLElement} */ (n).dataset.i)];
            if (p) { dejaLa = { genre: p.genre, id: p.id, libelle: p.libelle }; refus.textContent = ''; montrerListe(); }
          };
        });
      };
      fond.querySelectorAll('input[name=facon]').forEach((n) => {
        /** @type {HTMLInputElement} */ (n).onchange = () => {
          facon = /** @type {HTMLInputElement} */ (n).value;
          zoneFichier.hidden = facon !== 'fichier'; zoneDossier.hidden = facon !== 'dossier'; refus.textContent = '';
          if (facon === 'dossier') chercher.focus();
        };
      });
      chercher.oninput = montrerListe;
      /** @type {HTMLElement} */ (fond.querySelector('[data-fermer]')).onclick = fermer;
      fond.onclick = (e) => { if (e.target === fond) fermer(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        if (facon === 'fichier' && !choisi) { refus.textContent = 'Choisis d\'abord la photo ou le PDF de la pièce.'; return; }
        if (facon === 'dossier' && !dejaLa) { refus.textContent = 'Choisis la pièce de ton dossier qui répond à la demande.'; chercher.focus(); return; }
        envoyer.disabled = true;
        try {
          const texte = mot.value.trim();
          if (facon === 'fichier' && choisi) {
            const depot = await o.appel('POST', '/messages/fichiers', { cote: o.cote, nom: choisi.name, contenu: await enBase64(choisi) });
            await o.appel('POST', '/messages', { cote: o.cote, texte, fichier: depot.id, repondA: m.id });
          } else {
            await o.appel('POST', '/messages', { cote: o.cote, texte, piece: dejaLa, repondA: m.id });
          }
          const nom = facon === 'fichier' && choisi ? `« ${choisi.name} »` : 'La pièce';
          fermer();
          if (o.toast) o.toast(`${nom} est envoyée à ton cabinet.`);
          await relire();
        } catch (x) { refus.textContent = motif(x); } finally { if (envoyer.isConnected) envoyer.disabled = false; }
      };
      dessinerFichier();
      montrerListe();
      const premierBouton = /** @type {HTMLElement | null} */ (zoneFichier.querySelector('[data-ep-choisir]'));
      if (premierBouton) premierBouton.focus();
    }

    void lire();
    const minuterie = setInterval(() => { if (document.visibilityState === 'visible' && el.isConnected) void lire(); else if (!el.isConnected) arreter(); }, RELIRE_MS);
    const auRetour = () => { if (document.visibilityState === 'visible' && el.isConnected) void lire(); };
    document.addEventListener('visibilitychange', auRetour);
    function arreter() { fini = true; clearInterval(minuterie); document.removeEventListener('visibilitychange', auRetour); }
    return { arreter, relire };
  }

  /**
   * La boîte du cabinet : tous ses clients en ligne, chacun avec son état ; la conversation du client choisi à droite.
   * @param {HTMLElement} el
   * @param {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   cabinet: string,
   *   nomCabinet: string,
   *   ouvrir: (entreprise: string, demander?: boolean) => void,
   *   conversation?: (el: HTMLElement, entreprise: string, o: any) => { arreter: () => void, relire: () => Promise<void> },
   *   toast?: (texte: string, erreur?: boolean) => void,
   *   ouvrirPiece?: (entreprise: string, genre: string, id: string, libelle: string) => boolean,
   *   saisirPiece?: (entreprise: string, message: { id: string, ecritLe: string }) => void,
   *   revision?: (entreprise: string) => void,
   *   surCompteurs?: (c: { aTraiter: number, attendClient: number, tout: number }) => void,
   *   modeles?: { lire: () => Promise<any[]>, poser: (id: string | null, titre: string, texte: string) => Promise<any>, retirer: (id: string) => Promise<any> },
   * }} o
   */
  function boite(el, o) {
    /** @type {any} */ let lu = null;
    // Le filtre de départ : « À traiter » s'il y a quelque chose, sinon « Attend le client », sinon « Tout » (une boîte qui
    // s'ouvre sur « Rien à traiter » cachait les clients qu'on venait voir : vu à la souris le 09/10/2026).
    /** @type {string | null} */ let filtre = null;
    /** @type {string | null} */ let choisi = null;
    // (1.117.0) Chercher un client par son nom (point 10) : parmi tous les clients, quel que soit le filtre.
    let cherche = '';
    let fini = false;
    let signature = '';
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let relecture;
    /** @type {{ entreprise: string, c: { arreter: () => void, relire: () => Promise<void> } } | null} */ let ouverte = null;
    // (1.115.0) Au téléphone, une ligne ouvre la conversation sur sa page : la place manque pour deux colonnes.
    const TELEPHONE = window.matchMedia('(max-width: 760px)');
    const aCote = () => !!o.conversation && !TELEPHONE.matches;
    const ETATS = /** @type {Record<string, [string, string]>} */ ({ a_traiter: ['À traiter', 'traiter'], attend_client: ['Attend le client', 'client'], rien: ['Rien à faire', 'rien'] });
    /** @param {string} etat */
    const etatDit = (etat) => (ETATS[etat] || ['', '']);
    /** @param {any} d */
    const extrait = (d) => {
      const x = d.dernier;
      if (!x) return 'Aucun échange encore.';
      const qui = x.cote === 'cabinet' ? (x.sorte === 'question' ? 'Question envoyée' : x.sorte === 'demande' ? 'Pièce demandée' : 'Toi') : (x.sorte === 'reponse' ? 'Réponse du client' : x.auteur || 'Le client');
      const quoi = x.sorte === 'fichier' ? `a envoyé « ${x.extrait} »` : x.extrait;
      return x.sorte === 'fichier' ? `${qui} ${quoi}` : `${qui} : ${quoi}`;
    };
    // Le haut et les deux colonnes se posent une fois : la liste se redessine seule, la conversation ouverte reste (son
    // brouillon, sa position dans le fil).
    function poser() {
      el.innerHTML = `<div class="msg-page msg-boite${aCote() ? ' msg-boite-a-cote' : ''}">
        <div class="msg-boite-tete">
          <span class="msg-tete-txt"><span class="msg-surtitre">${esc(o.nomCabinet)}</span><h1>Les messages de tes clients</h1></span>
          <div class="msg-boite-actions">
            <div class="msg-filtres" role="tablist" aria-label="Quels clients" data-filtres></div>
            <button type="button" class="btn" data-demande-groupee>Demander à plusieurs clients…</button>
          </div>
        </div>
        <div class="msg-boite-corps" data-boite-corps></div>
      </div>`;
    }
    function dessiner() {
      if (!el.querySelector('[data-boite-corps]')) poser();
      const groupee = /** @type {HTMLButtonElement | null} */ (el.querySelector('[data-demande-groupee]'));
      if (groupee) { groupee.hidden = !lu.dossiers.length; groupee.onclick = () => demandeGroupee(); }
      const ds = /** @type {any[]} */ (lu.dossiers);
      const c = lu.compteurs;
      if (!filtre) filtre = c.aTraiter ? 'a_traiter' : c.attendClient ? 'attend_client' : 'tout';
      if (choisi && !ds.some((d) => d.entreprise === choisi)) choisi = null;
      // (1.115.0) Le client choisi reste dans la liste même s'il en sort (« Marquer comme traité », une réponse) : la
      // conversation qu'on lit ne disparaît pas sous le curseur. Un autre filtre, un autre client : il la quitte.
      const vus = cherche
        ? ds.filter((d) => plier(d.nom).includes(plier(cherche)))
        : ds.filter((d) => filtre === 'tout' || d.etat === filtre || d.entreprise === choisi);
      if (!choisi && aCote() && vus[0]) choisi = vus[0].entreprise;
      const F = [['a_traiter', `À traiter (${c.aTraiter})`], ['attend_client', `Attend le client (${c.attendClient})`], ['tout', `Tout (${c.tout})`]];
      const filtres = /** @type {HTMLElement} */ (el.querySelector('[data-filtres]'));
      filtres.innerHTML = F.map(([id, nom]) => `<button type="button" role="tab" class="msg-filtre" aria-selected="${!cherche && filtre === id}" data-filtre="${id}">${esc(nom)}</button>`).join('');
      filtres.querySelectorAll('[data-filtre]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          filtre = String(/** @type {HTMLElement} */ (n).dataset.filtre); choisi = null;
          cherche = '';
          const q = /** @type {HTMLInputElement | null} */ (el.querySelector('[data-boite-q]'));
          if (q) q.value = '';
          dessiner();
        };
      });
      const corps = /** @type {HTMLElement} */ (el.querySelector('[data-boite-corps]'));
      if (!ds.length) {
        fermer();
        corps.innerHTML = '<div class="msg-vide"><b>Aucun client en ligne pour l\'instant.</b><span>La messagerie s\'ouvre avec chaque client qui t\'a confié son dossier dans SkanFact. Les dossiers que tu tiens seul au cabinet n\'en ont pas.</span></div>';
        return;
      }
      if (!corps.querySelector('[data-liste]')) {
        corps.innerHTML = `<section class="msg-zone msg-liste" aria-label="Les dossiers">
            <div class="msg-liste-chercher"><input type="search" maxlength="100" placeholder="Chercher un client" aria-label="Chercher un client" data-boite-q></div>
            <div data-liste></div></section>${aCote() ? '<div class="msg-boite-conv" data-conv></div>' : ''}`;
        const q = /** @type {HTMLInputElement} */ (corps.querySelector('[data-boite-q]'));
        q.value = cherche;
        q.oninput = () => { cherche = q.value.trim(); dessiner(); };
        q.onkeydown = (e) => {
          if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; cherche = ''; dessiner(); }
          // ↓ passe du champ au premier client trouvé.
          if (e.key === 'ArrowDown') {
            const premier = /** @type {HTMLElement | null} */ (corps.querySelector('[data-dossier]'));
            if (premier) { e.preventDefault(); premier.focus(); choisir(String(premier.dataset.dossier)); }
          }
        };
      }
      const liste = /** @type {HTMLElement} */ (corps.querySelector('[data-liste]'));
      const avaitLeFocus = liste.contains(document.activeElement);
      // (1.115.0) La pastille des messages non lus dit déjà « À traiter » : l'étiquette ne la répète pas.
      liste.innerHTML = vus.length ? vus.map((x) => `<button type="button" class="msg-dossier${x.entreprise === choisi ? ' choisi' : ''}" data-dossier="${esc(x.entreprise)}" aria-current="${x.entreprise === choisi}">
          <span class="msg-avatar petit" aria-hidden="true">${esc(initiales(x.nom))}</span>
          <span class="msg-dossier-txt"><span class="msg-dossier-l1"><b>${esc(x.nom)}</b>${x.dernier ? `<span class="msg-quand">${esc(quandCourt(x.dernier.quand))}</span>` : ''}</span>
            <span class="msg-extrait">${esc(extrait(x))}</span></span>
          <span class="msg-dossier-pastilles">${x.nonLus ? `<span class="msg-non-lus" title="${esc(pl(x.nonLus, 'nouveau message', 'nouveaux messages'))}">${x.nonLus}<span class="msg-cache"> ${x.nonLus > 1 ? 'nouveaux messages' : 'nouveau message'}</span></span>` : ''}
          ${x.nonLus && x.etat === 'a_traiter' ? '' : `<span class="msg-etat-pastille ${etatDit(x.etat)[1]}">${esc(etatDit(x.etat)[0])}</span>`}
          ${x.retards ? `<span class="msg-etat-pastille retard" title="${esc(pl(x.retards, 'pièce demandée passée sa date', 'pièces demandées passées leur date'))}">${esc(pl(x.retards, 'en retard', 'en retard'))}</span>` : ''}</span></button>`).join('')
        : cherche ? `<div class="msg-vide"><b>Aucun client ne s'appelle « ${esc(cherche)} ».</b><span>La recherche lit le nom de chaque client en ligne, quel que soit le filtre.</span></div>`
        : `<div class="msg-vide"><b>${filtre === 'a_traiter' ? 'Rien à traiter.' : 'Aucun client n\'a de réponse en retard.'}</b><span>${filtre === 'a_traiter' ? 'Aucun client ne t\'a écrit depuis ta dernière réponse.' : 'Toutes tes questions et pièces demandées ont leur réponse.'}</span></div>`;
      const lignes = /** @type {HTMLElement[]} */ ([...liste.querySelectorAll('[data-dossier]')]);
      lignes.forEach((b, i) => {
        b.onclick = () => choisir(String(b.dataset.dossier));
        // ↑ et ↓ passent d'un client à l'autre, comme dans toute messagerie.
        b.onkeydown = (e) => {
          const vers = e.key === 'ArrowDown' ? lignes[i + 1] : e.key === 'ArrowUp' ? lignes[i - 1] : null;
          if (!vers) return;
          e.preventDefault();
          vers.focus();
          choisir(String(vers.dataset.dossier));
        };
      });
      if (avaitLeFocus) {
        const b = lignes.find((x) => x.dataset.dossier === choisi);
        if (b) b.focus();
      }
      ouvrirAcote();
    }
    /** @param {string} id */
    function choisir(id) {
      if (!aCote()) { o.ouvrir(id); return; }
      if (choisi === id) return;
      choisi = id;
      el.querySelectorAll('[data-dossier]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.classList.toggle('choisi', b.dataset.dossier === id);
        b.setAttribute('aria-current', String(b.dataset.dossier === id));
      });
      ouvrirAcote();
    }
    function fermer() { if (ouverte) { ouverte.c.arreter(); ouverte = null; } }
    // La conversation du client choisi, à droite de la liste : la même que sur sa page, en plus serré.
    function ouvrirAcote() {
      const zone = /** @type {HTMLElement | null} */ (el.querySelector('[data-conv]'));
      if (!zone || !o.conversation) return;
      if (!choisi) {
        fermer();
        zone.innerHTML = '<div class="msg-vide msg-conv-vide"><b>Choisis un client à gauche.</b><span>Sa conversation s\'ouvre ici, entière : ses messages, tes questions de la révision, les pièces demandées.</span></div>';
        return;
      }
      if (ouverte && ouverte.entreprise === choisi) return;
      fermer();
      const id = choisi;
      const d = lu.dossiers.find((/** @type {any} */ x) => x.entreprise === id);
      zone.innerHTML = '<div data-conv-racine></div>';
      const revision = o.revision;
      ouverte = { entreprise: id, c: o.conversation(/** @type {HTMLElement} */ (zone.firstElementChild), id, {
        nom: d ? d.nom : 'Ce client',
        integre: true,
        enGrand: () => o.ouvrir(id),
        toast: o.toast,
        revision: revision ? () => revision(id) : undefined,
        ouvrirPiece: o.ouvrirPiece ? (/** @type {string} */ g, /** @type {string} */ p, /** @type {string} */ l) => (o.ouvrirPiece ? o.ouvrirPiece(id, g, p, l) : false) : undefined,
        saisirPiece: o.saisirPiece ? (/** @type {any} */ m) => { if (o.saisirPiece) o.saisirPiece(id, m); } : undefined,
        // Ce que la conversation change (lu, traité, une réponse) se relit aussitôt dans la liste : elle se relit à chaque
        // lecture de la conversation (après un geste, et toutes les 30 secondes), une fois pour plusieurs appels rapprochés.
        surAttente: () => { clearTimeout(relecture); relecture = setTimeout(() => { void lire(); }, 250); },
      }) };
    }
    // (1.116.0) « Demander à plusieurs clients » (revue du 22/10/2026 : en fin de mois, la même demande à tous — les
    // relevés bancaires — se faisait client par client). Les mêmes pièces, la même date, un mot facultatif ; chaque client
    // la reçoit dans SON fil (rien d'un client ne passe chez un autre). Un client qui refuse n'arrête pas les autres : la
    // fenêtre dit lesquels l'ont reçue et lesquels non.
    function demandeGroupee() {
      const ds = /** @type {any[]} */ (lu.dossiers);
      const fond = document.createElement('div');
      fond.className = 'msg-fenetre-fond';
      fond.innerHTML = `<form class="msg-fenetre" role="dialog" aria-modal="true" aria-labelledby="msg-dg-titre" novalidate>
        <h2 id="msg-dg-titre">Demander des pièces à plusieurs clients</h2>
        <p class="small muted">Chaque client reçoit la demande dans son fil avec toi, comme si tu la lui écrivais : aucun ne voit les autres.</p>
        <div class="msg-demande"><span class="msg-demande-titre" id="msg-dg-p">Les pièces que tu demandes</span>
          <div class="msg-demande-liste" data-dg-liste><input type="text" maxlength="300" placeholder="Par exemple : le relevé bancaire de septembre" data-dg-piece aria-labelledby="msg-dg-p"></div>
          <span class="msg-demande-pied"><button type="button" class="msg-lien" data-dg-plus>+ Une autre pièce</button>
            <label class="msg-demande-pour"><span>Pour le</span><input type="date" data-dg-pour></label></span></div>
        <div class="msg-ep-mot"><span class="msg-dg-mot-tete"><label for="msg-dg-mot">Un mot <span class="muted">(facultatif)</span></label>
            ${o.modeles ? '<button type="button" class="msg-lien" data-dg-modeles>Prendre un modèle…</button>' : ''}</span>
          <textarea id="msg-dg-mot" rows="2" maxlength="4000" data-dg-mot></textarea>
          <span class="small muted">{client} devient le nom de chaque client.</span></div>
        <fieldset class="msg-dg-clients"><legend>À quels clients <button type="button" class="msg-lien" data-dg-tous>Tous</button> <button type="button" class="msg-lien" data-dg-aucun>Aucun</button></legend>
          ${ds.map((d) => `<label class="msg-dg-client"><input type="checkbox" value="${esc(d.entreprise)}" data-dg-client><span>${esc(d.nom)}</span></label>`).join('')}
        </fieldset>
        <div class="msg-fp-gestes msg-ep-gestes"><p class="msg-refus" role="alert" data-dg-refus></p>
          <button type="button" class="btn" data-fermer>Annuler</button><button type="submit" class="btn btn-primary" data-dg-envoyer>Envoyer la demande</button></div>
      </form>`;
      document.body.appendChild(fond);
      const form = /** @type {HTMLFormElement} */ (fond.querySelector('form'));
      const liste = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-liste]'));
      const pourChamp = /** @type {HTMLInputElement} */ (fond.querySelector('[data-dg-pour]'));
      const refus = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-refus]'));
      const envoyer = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-dg-envoyer]'));
      const cases = () => /** @type {HTMLInputElement[]} */ ([...fond.querySelectorAll('[data-dg-client]')]);
      pourChamp.min = jourCle(Date.now());
      pourChamp.value = jourCle(Date.now() + 7 * 86_400_000);
      const fermer = () => { fond.remove(); document.removeEventListener('keydown', echap); };
      const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') fermer(); };
      document.addEventListener('keydown', echap);
      /** @type {HTMLElement} */ (fond.querySelector('[data-fermer]')).onclick = fermer;
      fond.onclick = (e) => { if (e.target === fond) fermer(); };
      /** @type {HTMLElement} */ (fond.querySelector('[data-dg-tous]')).onclick = () => { cases().forEach((c) => { c.checked = true; }); refus.textContent = ''; };
      /** @type {HTMLElement} */ (fond.querySelector('[data-dg-aucun]')).onclick = () => { cases().forEach((c) => { c.checked = false; }); };
      const bModeles = /** @type {HTMLElement | null} */ (fond.querySelector('[data-dg-modeles]'));
      const modeles = o.modeles;
      if (bModeles && modeles) bModeles.onclick = () => fenetreModeles({ modeles, client: null, utiliser: (t) => {
        const mot = /** @type {HTMLTextAreaElement} */ (fond.querySelector('[data-dg-mot]'));
        mot.value = mot.value.trim() ? `${mot.value.trimEnd()}\n${t}` : t;
        mot.focus();
      } });
      /** @type {HTMLElement} */ (fond.querySelector('[data-dg-plus]')).onclick = () => {
        const n = liste.querySelectorAll('[data-dg-piece]').length;
        if (n >= 10) { refus.textContent = 'Dix pièces au plus dans une demande.'; return; }
        const i = document.createElement('input');
        i.type = 'text'; i.maxLength = 300; i.dataset.dgPiece = ''; i.setAttribute('aria-label', `Pièce demandée ${n + 1}`);
        liste.appendChild(i); i.focus();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const pieces = [...liste.querySelectorAll('[data-dg-piece]')].map((x) => /** @type {HTMLInputElement} */ (x).value.trim()).filter(Boolean);
        const clients = cases().filter((c) => c.checked).map((c) => c.value);
        if (!pieces.length) { refus.textContent = 'Nomme au moins une pièce (par exemple : le relevé bancaire de septembre).'; /** @type {HTMLElement} */ (liste.querySelector('input')).focus(); return; }
        if (!clients.length) { refus.textContent = 'Coche au moins un client.'; return; }
        envoyer.disabled = true; refus.textContent = '';
        const mot = /** @type {HTMLTextAreaElement} */ (fond.querySelector('[data-dg-mot]')).value.trim();
        /** @type {string[]} */ const ratees = [];
        for (const c of clients) {
          try {
            // (1.117.0) {client} : le nom de chacun (un modèle pris pour tous).
            const texte = mot.replace(/\{client\}/g, (ds.find((d) => d.entreprise === c) || {}).nom || '');
            await o.appel('POST', `/entreprises/${encodeURIComponent(c)}/messages`, { cote: 'cabinet', texte, pour: pourChamp.value || null,
              ...(pieces.length > 1 ? { demandes: pieces } : { demande: pieces[0] }) });
            // Partie : la case se décoche (un second « Envoyer » ne la redemanderait pas à ce client).
            const fait = cases().find((x) => x.value === c);
            if (fait) fait.checked = false;
          } catch (x) { ratees.push(`${(ds.find((d) => d.entreprise === c) || {}).nom || 'un client'} (${motif(x)})`); }
        }
        envoyer.disabled = false;
        const parties = clients.length - ratees.length;
        if (ratees.length) {
          refus.textContent = `${parties ? `Envoyée à ${pl(parties, 'client')} (leur case est décochée). ` : ''}Pas envoyée à : ${ratees.join(' ; ')}.`;
          if (parties) { void lire(); if (ouverte) void ouverte.c.relire(); }
          return;
        }
        fermer();
        // La conversation ouverte à droite les montre aussitôt (elle ne se relisait qu'au tour suivant).
        if (ouverte) void ouverte.c.relire();
        if (o.toast) o.toast(`Demande envoyée à ${pl(parties, 'client')} : chacun la lit dans son fil.`);
        signature = '';
        void lire();
      };
      /** @type {HTMLElement} */ (liste.querySelector('input')).focus();
    }
    async function lire() {
      if (fini) return;
      try {
        const r = await o.appel('GET', `/cabinets/${encodeURIComponent(o.cabinet)}/messages`);
        if (fini) return;
        if (!el.isConnected) { arreter(); return; }
        const s = JSON.stringify(r);
        lu = r;
        if (o.surCompteurs) o.surCompteurs(r.compteurs);
        if (s !== signature) dessiner();
        signature = s;
      } catch (x) {
        if (!lu) {
          el.innerHTML = `<div class="msg-page"><div class="msg-vide"><b>La boîte ne s'est pas ouverte.</b><span>${esc(motif(x))}</span><button type="button" class="btn" data-relire>Réessayer</button></div></div>`;
          const b = el.querySelector('[data-relire]');
          if (b) /** @type {HTMLElement} */ (b).onclick = () => { void lire(); };
        }
      }
    }
    // Passer du téléphone à l'ordinateur (ou l'inverse) repose la page : une colonne ou deux.
    const auChangement = () => { if (!lu || fini) return; fermer(); signature = ''; poser(); dessiner(); };
    TELEPHONE.addEventListener('change', auChangement);
    void lire();
    // Une conversation ouverte à côté relit la liste à chaque lecture : la boîte ne la relit seule que sans elle.
    const minuterie = setInterval(() => { if (!el.isConnected) arreter(); else if (document.visibilityState === 'visible' && !ouverte) void lire(); }, RELIRE_MS);
    function arreter() { fini = true; clearInterval(minuterie); clearTimeout(relecture); TELEPHONE.removeEventListener('change', auChangement); fermer(); }
    return { arreter };
  }

  // (1.94.0) Un fichier qui part avec un mot (et la pièce qu'il concerne), hors du fil : la fenêtre « Répondre » d'une
  // question qui attend une pièce l'envoie ainsi. Trop lourd, il est refusé avant de partir, comme dans le fil.
  /** @param {(m: string, c: string, b?: unknown) => Promise<any>} appel @param {string} cote @param {File} f
   *  @param {string} texte @param {{ genre: string, id: string, libelle: string } | null} piece */
  async function envoyerFichier(appel, cote, f, texte, piece) {
    const lourd = tropLourd(f);
    if (lourd) throw new Error(lourd);
    const depot = await appel('POST', '/messages/fichiers', { cote, nom: f.name, contenu: await enBase64(f) });
    await appel('POST', '/messages', { cote, texte, piece, demande: null, fichier: depot.id });
  }
  w.SkanMessagerie = { conversation, boite, envoyerFichier, montrerFichier };
})();
