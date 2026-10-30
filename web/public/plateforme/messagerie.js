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
  // (1.179.0, maquette « Messages », lot 4) Les dernières lectures de la page (la boîte d'un cabinet, chaque conversation
  // ouverte) : hors ligne, elles se relisent telles qu'elles étaient, le temps de la page. En mémoire seulement : sur
  // « mon ordinateur », la copie chiffrée du poste les garde déjà (plateforme/poste.js, docs/hors-ligne.md) ; ailleurs,
  // rien ne s'écrit sur le poste.
  /** @type {Map<string, any>} */ const LUES = new Map();
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
  // (1.178.0) Un jour de calendrier « aaaa-mm-jj » : son nom (« vendredi »), dit long (« vendredi 30/10 ») ou court
  // (« ven. 30/10 ») ; le jour qui est dans `n` jours ; le mois d'avant (« septembre »).
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  /** @param {string} j */
  const nomDuJour = (j) => JOURS[new Date(`${j}T12:00:00Z`).getUTCDay()] || '';
  /** @param {string} j */
  const jourLong = (j) => `${nomDuJour(j)} ${j.slice(8, 10)}/${j.slice(5, 7)}`;
  /** @param {string} j */
  const jourCourt = (j) => `${nomDuJour(j).slice(0, 3)}. ${j.slice(8, 10)}/${j.slice(5, 7)}`;
  /** @param {number} n */
  const dansJours = (n) => jourCle(Date.parse(`${jourCle(Date.now())}T12:00:00Z`) + n * 86_400_000);
  // « de septembre », « d'octobre ».
  /** @param {string} mot */
  const deMot = (mot) => (/^[aeiouyéèêàâîôûh]/i.test(mot) ? `d'${mot}` : `de ${mot}`);
  const moisDavant = () => { const a = jourCle(Date.now()); const m = Number(a.slice(5, 7)) - 2; return MOIS[(m + 12) % 12] || ''; };
  // Une promesse du client dans son message (« je vous envoie tout vendredi, promis ») : le jour qu'il nomme (demain, un
  // jour de la semaine : le prochain), ou '' s'il promet sans jour. Pas de promesse : null.
  const PROMET = /\b(promis|promets|je (vous |te )?(les |l'|la |le )?(envoie|envoi|enverrai|envoyerai|transmets|transmettrai|d[ée]pose|d[ée]poserai|fais parvenir)|vous (les |l')?aurez|tu (les |l')?auras|d'ici)\b/i;
  /** @param {string} texte @returns {string | null} */
  function jourPromis(texte) {
    const s = String(texte || '').toLowerCase();
    if (!PROMET.test(s)) return null;
    if (/\bdemain\b/.test(s)) return dansJours(1);
    for (let n = 1; n <= 7; n++) { const j = dansJours(n); if (new RegExp(`\\b${nomDuJour(j)}\\b`).test(s)) return j; }
    return '';
  }
  const ATTENDUS = /** @type {Record<string, string>} */ ({ piece: 'une pièce justificative', explication: 'une explication', confirmation: 'une confirmation' });
  const DESSINS = {
    piece: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    trombone: '<path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4"/><path d="M12 17.5v.01"/>',
    croix: '<path d="M6 6l12 12M18 6 6 18"/>',
    modele: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    loupe: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    points: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    coche: '<path d="m5 12 5 5 9-10"/>',
    envoi: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    cloche: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    reveil: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M5 4 2 7M19 4l3 3"/>',
    equipe: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    telecharger: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    nuage: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"/><path d="m4 4 16 16"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    livre: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
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
  // (1.134.0) Sans réseau, la messagerie le dit avec les mots du bandeau « Hors ligne » et se rouvre seule quand il revient
  // (UX 2 : « Le serveur ne répond pas : vérifie la connexion » sous un bandeau qui le disait déjà, et la page sans titre).
  // Une page que ce poste n'a jamais lue garde son motif, plus précis (« ouvre-la une fois avec le réseau ») : `jamaisLue`.
  /** @param {unknown} [x] */
  const sansReseau = (x) => typeof navigator !== 'undefined' && navigator.onLine === false && !(x && /** @type {any} */ (x).jamaisLue);

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
    // (1.182.0) Deux colonnes : les modèles de l'équipe à gauche (vide : trois exemples, leur texte déjà rempli), et à
    // droite celui qu'on écrit, avec {client} et {mois} posés d'un clic et ce que le client lira, en direct.
    fond.innerHTML = `<div class="msg-fenetre msg-mo-fenetre" role="dialog" aria-modal="true" aria-labelledby="msg-mo-titre">
      <div class="msg-mo-tete"><span class="msg-mo-ic">${dessin('modele')}</span><span><h2 id="msg-mo-titre">Modèles de messages</h2>
        <p class="small muted">Les phrases que l'équipe envoie souvent, prises d'un clic. <b>{client}</b> devient le nom du client, <b>{mois}</b> le mois qui vient de finir (${esc(moisPasse())}).</p></span></div>
      <div class="msg-mo-corps">
        <div class="msg-mo-liste" data-mo-liste><p class="small muted">Lecture des modèles…</p></div>
        <form class="msg-mo-form" data-mo-form novalidate>
          <h3 data-mo-form-titre>Un nouveau modèle</h3>
          <label class="msg-ep-mot"><span>Titre</span><input type="text" maxlength="80" placeholder="Par exemple : Pièces du mois" data-mo-titre></label>
          <label class="msg-ep-mot"><span>Texte</span><textarea rows="4" maxlength="4000" placeholder="Bonjour {client}, …" data-mo-texte></textarea></label>
          <span class="msg-mo-poser-mots">Insérer : <button type="button" class="msg-mo-mot" data-mo-mot="{client}">{client}</button><button type="button" class="msg-mo-mot" data-mo-mot="{mois}">{mois}</button></span>
          <div class="msg-mo-apercu" data-mo-apercu hidden><small>Ce que lira ${esc(o.client || 'le client')}</small><span data-mo-apercu-txt></span></div>
          <div class="msg-fp-gestes msg-ep-gestes"><p class="msg-refus" role="alert" data-mo-refus></p>
            <button type="button" class="btn" data-mo-annuler hidden>Annuler la modification</button>
            <button type="submit" class="btn btn-primary" data-mo-poser>Ajouter le modèle</button></div>
        </form>
      </div>
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
    const apercu = /** @type {HTMLElement} */ (fond.querySelector('[data-mo-apercu]'));
    const majApercu = () => {
      apercu.hidden = !texte.value.trim();
      /** @type {HTMLElement} */ (apercu.querySelector('[data-mo-apercu-txt]')).textContent = remplir(texte.value, o.client || null);
    };
    const champs = () => { insiste = false; fermerBtn.textContent = 'Fermer'; refus.textContent = ''; majApercu(); };
    titre.addEventListener('input', champs);
    texte.addEventListener('input', champs);
    // {client} et {mois} se posent où est le curseur.
    fond.querySelectorAll('[data-mo-mot]').forEach((n) => {
      /** @type {HTMLElement} */ (n).onclick = () => {
        const mot = String(/** @type {HTMLElement} */ (n).dataset.moMot);
        const a = texte.selectionStart ?? texte.value.length, b = texte.selectionEnd ?? a;
        texte.value = texte.value.slice(0, a) + mot + texte.value.slice(b);
        texte.focus(); texte.setSelectionRange(a + mot.length, a + mot.length); champs();
      };
    });
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
        : `<div class="msg-vide msg-mo-vide"><b>Aucun modèle encore.</b><span>Pars d'un exemple, ou écris à droite la phrase que tu envoies le plus souvent : toute l'équipe l'aura.</span>
            <span class="msg-mo-exemples">${EXEMPLES.map((x, i) => `<button type="button" class="msg-mo-ex" data-mo-exemple="${i}" aria-label="${esc(x.titre)}"><b>${esc(x.titre)}</b><span>${esc(remplir(x.texte, o.client || null))}</span></button>`).join('')}</span></div>`;
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

  // (1.181.0) Une boîte de messagerie va jusqu'au bas de ce qu'on voit : l'écran, ou le haut des onglets du bas au
  // téléphone. La hauteur se mesure en points vus, puis se ramène à l'échelle de la page (le Cabinet peut être dessiné à
  // 90 %, charte.css) ; une hauteur devinée en CSS laissait une bande vide à l'ordinateur et cachait « Envoyer » sous les
  // onglets au téléphone.
  /** @param {HTMLElement} boite @param {number} plancher */
  function jusquEnBas(boite, plancher) {
    if (!boite.isConnected || !boite.offsetHeight) return;
    const r = boite.getBoundingClientRect();
    const echelle = r.height / boite.offsetHeight || 1;
    const onglets = /** @type {HTMLElement | null} */ (document.querySelector('.sb-onglets'));
    const bas = onglets && getComputedStyle(onglets).display !== 'none' && onglets.getBoundingClientRect().height ? onglets.getBoundingClientRect().top - 10 : window.innerHeight - 24;
    const h = Math.max(plancher, Math.round((bas - r.top) / echelle));
    boite.style.height = `${h}px`;
    // La page ne défile pas pour autant : ce qui dépasse (la marge du bas de la page) se reprend sur la boîte.
    const page = /** @type {HTMLElement} */ (boite.closest('main') || document.scrollingElement || document.body);
    const trop = page.scrollHeight - page.clientHeight;
    if (trop > 0) boite.style.height = `${Math.max(plancher, h - trop)}px`;
  }
  /** @type {WeakMap<HTMLElement, () => void>} */
  const CALAGES = new WeakMap();
  /** @param {HTMLElement} el @param {() => void} caler */
  function caler(el, caler) {
    if (!CALAGES.has(el)) window.addEventListener('resize', () => { const c = CALAGES.get(el); if (c && el.isConnected) c(); });
    CALAGES.set(el, caler);
    requestAnimationFrame(caler);
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
      img{max-width:100%;margin:16px auto;display:block}p{margin:40px auto;max-width:480px;text-align:center;color:#3d4743;line-height:1.5}</style></head>
      <body><header><b>${n}</b><a href="${adresse}" download="${n}">Enregistrer</a></header>${vue}</body></html>`);
    onglet.document.close();
    // (1.180.0) Une image que le navigateur ne sait pas dessiner laissait une page vide sous l'en-tête : elle le dit.
    const img = onglet.document.querySelector('img');
    if (img) img.onerror = () => {
      const p = onglet.document.createElement('p');
      p.textContent = 'Ce fichier ne s\'affiche pas ici : « Enregistrer » le garde sur ton ordinateur, pour l\'ouvrir avec une autre application.';
      img.replaceWith(p);
    };
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
   *   demandeTexte?: string,
   *   pieces?: () => { genre: string, id: string, libelle: string, date?: string }[],
   *   pieceDepart?: { genre: string, id: string, libelle: string } | null,
   *   ouvrirPiece?: (genre: string, id: string, libelle: string) => boolean,
   *   saisirPiece?: (message: { id: string, ecritLe: string, fichier: { id: string, nom: string, type: string } }) => void,
   *   pieceDuNumero?: (numero: string) => { genre: string, id: string } | null,
   *   repondre?: (question: string, texte: string) => Promise<void>,
   *   rangerAchat?: (message: { id: string, nom: string, type: string, contenu: string }) => void,
   *   achatCite?: (texte: string) => { id: string, libelle: string } | null,
   *   joindreAchat?: (message: { id: string, nom: string, type: string, contenu: string }, achat: string) => Promise<string>,
   *   range?: () => Promise<any[]>,
   *   ouvrirRange?: (x: any) => void,
   *   ceMois?: () => { titre: string, lignes: string[], action: { libelle: string, faire: () => void } | null, cabinet: Promise<string | null> | null } | null,
   *   voirMandat?: () => void,
   *   inviter?: () => void,
   *   sansCabinet?: ((el: HTMLElement) => void) | null,
   *   revision?: () => void,
   *   surAttente?: (a: { nonLus: number, questions: number, demandes: number, enRetard?: number }) => void,
   *   integre?: boolean,
   *   contact?: string | null, coteEl?: HTMLElement | null, traiter?: () => Promise<void>,
   *   menu?: { texte: string, sous?: string, dessin?: string, faire: () => void }[],
   *   saisirLot?: (messages: string[]) => void, couleur?: string[] | null,
   *   suggestions?: () => { titre: string, sous: string, texte: string }[], contactPrenom?: string,
   *   suivi?: { lire: () => Promise<any>, noter: (texte: string) => Promise<unknown>, promettre: (pour: string, quoi: string) => Promise<unknown>,
   *     retirerPromesse: () => Promise<unknown>, remontrer: (le: string) => Promise<unknown>, retirerRappel: () => Promise<unknown> },
   *   toastAnnuler?: (texte: string, annuler: () => void) => void,
   *   enGrand?: () => void,
   *   modeles?: { lire: () => Promise<any[]>, poser: (id: string | null, titre: string, texte: string) => Promise<any>, retirer: (id: string) => Promise<any> },
   *   cle?: string, nomCabinet?: string, exportPdf?: (html: string, nom: string) => Promise<string | null>,
   *   imputer?: (question: any, apres: () => Promise<void>) => void,
   * }} o
   */
  function conversation(el, o) {
    const entreprise = o.cote === 'entreprise';
    /** @type {any} */ let lu = null;              // la dernière lecture du serveur (première page)
    /** @type {any[]} */ let anciensMessages = [];  // les pages plus anciennes, demandées
    /** @type {any[]} */ let anciennesQuestions = [];
    /** @type {string | null} */ let suite = null;
    /** @type {string | null} */ let cabinetRelu = null; // un ancien cabinet relu (côté entreprise)
    /** @type {string | null} */ let texteCabinetDuMois = null; // la dernière phrase lue de ce que le cabinet a fait du mois
    // (1.155.13) Ouverte depuis une pièce (« Écrire au cabinet sur cette pièce ») : le message en parle déjà.
    /** @type {{ genre: string, id: string, libelle: string } | null} */ let piece = o.pieceDepart || null;
    /** @type {File | null} */ let fichier = null;
    let demande = !!o.demander && !entreprise;
    /** @type {Map<string, string>} */ const reponses = new Map();
    let signature = '';
    let enCours = false;
    let fini = false;
    let premier = true;
    // (1.177.0, maquette « Messages ») Les messages arrivés depuis ma dernière lecture, comptés à l'ouverture : le trait
    // « N nouveaux » et le point vert devant leur auteur restent le temps de la conversation ouverte.
    /** @type {Set<string>} */ let nouveaux = new Set();
    /** @type {Map<string, Promise<string>>} */ const vignettes = new Map();
    // (1.177.0, maquette « Messages ») Les notes pour l'équipe (0182), lues avec le fil au cabinet ; et l'onglet choisi de
    // la zone d'écriture (« Message à Sami » ou « Note pour l'équipe »).
    const avecNotes = !entreprise && !!o.suivi;
    /** @type {any[]} */ let notes = [];
    // (1.182.0) Toutes les notes de la conversation, d'un coup (posé par la recherche du fil, qui les montre à sa place).
    let voirNotes = () => {};
    // (1.178.0, lot 3) La promesse du client, mon rappel, les jalons du dossier (ses déclarations déposées) ; la promesse
    // proposée sous un message (son id, ou « menu ») et le jour choisi ; les propositions écartées.
    /** @type {any} */ let promesse = null;
    /** @type {string | null} */ let rappel = null;
    /** @type {any[]} */ let jalons = [];
    /** @type {string | null} */ let promessePop = null;
    let promesseJour = '';
    /** @type {Set<string>} */ const promessesEcartees = new Set();
    let modeNote = false;

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
      // (1.176.0, maquette « Messages ») L'en-tête de la boîte : le client, son contact, où en est la conversation
      // (« À traiter », « Attend le client »), « Marquer comme traité » (E), chercher, et le menu ⋯ (la question de la
      // révision, confier, le dossier, en grand).
      const tete = integre
        ? `<header class="msg-tete msg-tete-integre">
          <span class="msg-avatar petit${o.couleur ? ' carre' : ''}"${o.couleur ? ` style="background:linear-gradient(145deg, ${esc(o.couleur[0])}, ${esc(o.couleur[1])})"` : ''} aria-hidden="true">${esc(initiales(nomAutre))}</span>
          <span class="msg-tete-txt"><h2>${esc(nomAutre)}</h2><span class="msg-sous">${o.contact ? esc(o.contact) : sous}</span></span>
          <span class="msg-tete-etat" data-msg-tete-etat></span>
          <button type="button" class="msg-icone msg-chercher" data-msg-chercher aria-expanded="false" aria-label="Chercher dans cette conversation" title="Chercher dans cette conversation">${dessin('loupe')}</button>
          <span class="msg-menu-ancre"><button type="button" class="msg-icone" data-msg-menu aria-haspopup="menu" aria-expanded="false" aria-label="Les autres gestes de cette conversation" title="Les autres gestes">${dessin('points')}</button></span>
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
              ${/* (1.177.0, maquette « Messages ») « D'après le dossier » : les réponses que le livre du client appelle (des
                 questions qui attendent, des pièces reçues, une déclaration prête…) ; un clic pose le texte, on le relit. */''}
              <div class="msg-sugg" data-msg-sugg hidden></div>
              ${/* (1.181.0) Une seule boîte, comme une messagerie : le champ d'une ligne qui grandit avec le texte, et sous lui, dans
                 la boîte, à qui l'on écrit (message ou note), les gestes et « Envoyer ». La zone tenait 230 points sur 560. */''}
              <div class="msg-boite-ecrire">
              <textarea id="msg-texte${integre ? '-i' : ''}" rows="1" maxlength="4000" placeholder="Écrire à ${esc(o.contactPrenom || nomAutre)}…${window.matchMedia('(pointer: coarse)').matches ? '' : '   Entrée envoie, Maj+Entrée va à la ligne'}" data-msg-texte></textarea>
              <div class="msg-gestes">
                ${avecNotes ? `<div class="msg-onglets" role="tablist" aria-label="À qui tu écris">
                    <button type="button" role="tab" aria-selected="true" data-msg-onglet="message" aria-label="${o.contactPrenom ? `Message à ${esc(o.contactPrenom)}` : 'Message au client'}" title="${o.contactPrenom ? `Message à ${esc(o.contactPrenom)}` : 'Message au client'}">Message</button>
                    <button type="button" role="tab" aria-selected="false" data-msg-onglet="note" aria-label="Note pour l'équipe" title="Note pour l'équipe : ${o.contactPrenom ? esc(o.contactPrenom) : 'le client'} ne la lit pas">${dessin('cadenas')}Note</button></div>` : ''}
                <span class="msg-gestes-g">
                  ${/* (1.115.0) Au téléphone, un mot court : les trois gestes et « Envoyer » tiennent sur une ligne, sous le champ. */''}
                  <button type="button" class="btn msg-g" data-msg-joindre aria-label="Joindre une photo ou un PDF" title="Joindre une photo ou un PDF">${dessin('trombone')}<span class="msg-long">Joindre une photo ou un PDF</span><span class="msg-court" aria-hidden="true">Joindre</span></button>
                  ${entreprise && o.pieces ? `<button type="button" class="btn msg-g" data-msg-piece aria-label="Parler d'une pièce">${dessin('piece')}<span class="msg-long">Parler d'une pièce</span><span class="msg-court" aria-hidden="true">Une pièce</span></button>` : ''}
                  ${entreprise ? '' : `<button type="button" class="btn msg-g" data-msg-demander aria-pressed="false" aria-label="Demander une pièce" title="Demander une pièce">${dessin('piece')}<span class="msg-long">Demander une pièce</span><span class="msg-court" aria-hidden="true">Demander</span></button>`}
                  ${/* (1.117.0) Les modèles du cabinet : la phrase écrite cent fois, prise d'un geste (point 9). */''}
                  ${!entreprise && o.modeles ? `<button type="button" class="btn msg-g" data-msg-modeles aria-label="Modèles de messages" title="Modèles de messages">${dessin('modele')}<span class="msg-long">Modèles</span><span class="msg-court" aria-hidden="true">Modèles</span></button>` : ''}
                </span>
                <button type="submit" class="btn btn-primary msg-envoyer vide" data-msg-envoyer>${dessin('envoi')}<span data-msg-envoyer-mot>Envoyer</span></button>
              </div>
              </div>
              <p class="msg-refus" role="alert" data-msg-refus></p>
              ${avecNotes ? `<p class="msg-note-pied" data-msg-note-pied hidden>${dessin('cadenas')}<span>${o.contactPrenom ? esc(o.contactPrenom) : 'Le client'} ne lit jamais les notes ; elles restent dans le dossier, avec leur date.</span><button type="button" class="msg-lien" data-msg-voir-notes hidden></button></p>` : ''}
            </form>` : '';
      el.innerHTML = integre
        ? `<div class="msg-page msg-integre msg-cabinet">${tete}
          <div class="msg-cote-fil" data-msg-cote hidden></div>
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
      brancherMenu();
      if (!integre) {
        const zone = /** @type {HTMLElement | null} */ (el.querySelector('.msg-corps > .msg-zone'));
        if (zone) caler(el, () => jusquEnBas(zone, window.innerWidth < 760 ? 320 : 440));
      }
      const r = el.querySelector('[data-msg-retour]');
      if (r && o.retour) /** @type {HTMLElement} */ (r).onclick = o.retour.aller;
      brancherEcrire();
      brancherRecherche();
    }

    // ── (1.176.0) Le menu ⋯ de la conversation (dans la boîte) : la question de la révision, ce que l'écran ajoute (confier,
    // ouvrir le dossier), ouvrir en grand. Chaque entrée dit ce qu'elle fait ; Échap ou un clic ailleurs le ferme.
    function brancherMenu() {
      const btn = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-menu]'));
      if (!btn) return;
      // (1.178.0, lot 3) « Me le remontrer demain », la promesse, « Confier à… » (l'écran le donne) : le menu se compose à
      // l'ouverture, selon ce que dit le fil.
      const suivi = !entreprise && o.suivi ? o.suivi : null;
      const apres = async (/** @type {string} */ dit, /** @type {(() => Promise<unknown>) | null} */ defaire) => {
        await relire();
        if (o.surAttente) o.surAttente(lu && lu.attente);
        if (defaire && o.toastAnnuler) o.toastAnnuler(dit, async () => { await defaire(); await relire(); if (o.surAttente) o.surAttente(lu && lu.attente); });
        else if (o.toast) o.toast(dit);
      };
      const lesEntrees = () => {
        const actif = !!(lu && lu.fil && lu.fil.actif);
        const promise = promesse && !promesse.tenue && !promesse.echue;
        const demain = dansJours(1);
        return [
          ...(o.revision ? [{ texte: 'Question sur une pièce…', sous: 'depuis la révision : elle arrive ici avec sa pièce et son montant', dessin: 'question', faire: o.revision }] : []),
          ...(suivi && actif && lu.fil.aTraiter && !rappel ? [{ texte: 'Me le remontrer demain', sous: `la conversation revient dans « À traiter » ${jourLong(demain)}`, dessin: 'reveil',
            faire: async () => { await suivi.remontrer(demain); await apres(`Elle revient ${jourLong(demain)} : d'ici là, elle quitte ton « À traiter ».`, () => suivi.retirerRappel()); } }] : []),
          ...(suivi && rappel ? [{ texte: 'La remettre dans « À traiter »', sous: `tu avais demandé de la revoir ${jourLong(rappel)}`, dessin: 'reveil',
            faire: async () => { await suivi.retirerRappel(); await apres('Elle est de nouveau dans ton « À traiter ».', null); } }] : []),
          ...(suivi && actif && !promise ? [{ texte: 'Noter une promesse…', sous: '« je vous envoie tout vendredi » : la conversation attend le client', dessin: 'reveil',
            faire: () => { promessePop = 'menu'; promesseJour = ''; dessinerFil(); const f = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-fil]')); if (f) f.scrollTop = f.scrollHeight; } }] : []),
          // (1.182.0) Retrouver une note : toutes celles de la conversation, la plus récente d'abord ; une, et le fil y va.
          ...(avecNotes && notes.length ? [{ texte: `Les notes de l'équipe (${notes.length})`, sous: 'toutes, la plus récente d\'abord ; le client ne les voit pas', dessin: 'cadenas', faire: () => voirNotes() }] : []),
          ...((o.menu || []).map((/** @type {any} */ x) => ({ dessin: x.dessin || 'piece', ...x }))),
          ...(o.enGrand ? [{ texte: 'Ouvrir en grand', sous: 'la conversation seule, sur sa page', dessin: 'image', faire: o.enGrand }] : []),
          ...(o.exportPdf ? [{ texte: 'Exporter la conversation (PDF)', sous: 'les messages, les pièces citées et les questions, par date', dessin: 'telecharger', faire: exporter }] : []),
        ];
      };
      if (!lesEntrees().length && !suivi) { btn.hidden = true; return; }
      /** @type {any[]} */ let entrees = [];
      /** @type {HTMLElement | null} */ let menu = null;
      const fermerMenu = () => {
        if (!menu) return;
        menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', dehors, true); document.removeEventListener('keydown', echap, true);
      };
      const dehors = (/** @type {Event} */ e) => { if (menu && !menu.contains(/** @type {Node} */ (e.target)) && e.target !== btn && !btn.contains(/** @type {Node} */ (e.target))) fermerMenu(); };
      const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); fermerMenu(); btn.focus(); } };
      btn.onclick = () => {
        if (menu) { fermerMenu(); return; }
        entrees = lesEntrees();
        menu = document.createElement('div');
        menu.className = 'msg-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `<span class="msg-menu-titre">${esc(o.nom || '')}</span>${entrees.map((x, i) => `<button type="button" role="menuitem" class="msg-menu-e" data-msg-menu-i="${i}">${dessin(x.dessin in DESSINS ? x.dessin : 'piece')}<span><b>${esc(x.texte)}</b>${x.sous ? `<small>${esc(x.sous)}</small>` : ''}</span></button>`).join('')}`;
        /** @type {HTMLElement} */ (btn.parentElement).appendChild(menu);
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelectorAll('[data-msg-menu-i]').forEach((n) => {
          /** @type {HTMLElement} */ (n).onclick = async () => {
            const x = entrees[Number(/** @type {HTMLElement} */ (n).dataset.msgMenuI)]; fermerMenu();
            if (!x) return;
            try { await x.faire(); } catch (e) { if (o.toast) o.toast(motif(e), true); }
          };
        });
        const premier = /** @type {HTMLElement | null} */ (menu.querySelector('[data-msg-menu-i]'));
        if (premier) premier.focus();
        document.addEventListener('mousedown', dehors, true); document.addEventListener('keydown', echap, true);
      };
    }

    // ── (1.179.0, maquette « Messages », lot 4) Exporter la conversation en PDF, pour un dossier de contrôle : TOUT le fil
    // (les pages plus anciennes sont lues d'abord), par date — les messages, les pièces citées, les fichiers envoyés, les
    // pièces demandées et où elles en sont, les questions de la révision et leur réponse. Les notes pour l'équipe n'y sont
    // pas : elles ne sortent pas du cabinet. Le PDF est fait par le serveur (docs/pdf.md), qui ne garde rien.
    async function exporter() {
      if (!lu || !o.exportPdf) return;
      const msgs = [...(lu.messages || []), ...anciensMessages];
      const qs = [...(lu.questions || []), ...anciennesQuestions];
      for (let s = suite, tours = 0; s && tours < 200; tours++) {
        const r = await o.appel('GET', chemin(s));
        msgs.push(...r.messages); qs.push(...r.questions); s = r.suite;
      }
      const vus = new Set();
      /** @type {{ quand: string, de: string, quoi: string }[]} */
      const lignes = [];
      const qui = (/** @type {any} */ m) => (m.cote === 'cabinet' ? `${m.auteur || 'Le cabinet'} (cabinet)` : `${m.auteur || o.nom || 'Le client'} (client)`);
      for (const m of msgs) {
        if (vus.has(m.id)) continue;
        vus.add(m.id);
        const p = [];
        if (m.texte) p.push(esc(m.texte));
        if (m.piece) p.push(`<i>À propos de : ${esc(GENRES[m.piece.genre] || 'Pièce')} ${esc(m.piece.libelle)}</i>`);
        if (m.fichier) p.push(`<i>Pièce envoyée : ${esc(m.fichier.nom)} (${esc(poids(m.fichier.taille))})${m.achat ? `, rangée dans les achats (${esc(m.achat.libelle)})` : ''}</i>`);
        if (m.demande) {
          const d = m.demande;
          p.push(`<i>Pièce demandée : ${esc(d.texte)}${d.pour ? `, pour le ${esc(dateCourte(d.pour))}` : ''} — ${d.recueLe ? `reçue le ${esc(dateCourte(jourCle(d.recueLe)))}` : d.enRetard ? 'en retard' : 'attendue'}${d.relances ? ` ; relancée ${d.relances} fois par e-mail` : ''}</i>`);
        }
        lignes.push({ quand: m.ecritLe, de: qui(m), quoi: p.join('<br>') });
      }
      for (const q of qs) {
        if (vus.has(q.id)) continue;
        vus.add(q.id);
        const pose = q.poseePar === 'moi' ? 'Le cabinet' : q.poseePar || 'Le cabinet';
        lignes.push({ quand: q.envoyeeLe, de: `${pose} (cabinet)`, quoi: `<b>Question de la révision${q.piece ? ` sur ${esc(q.piece)}` : ''}</b> : ${esc(q.objet || q.texte)}${q.montant && !/^-?0(\.0+)?$/.test(q.montant) ? ` · ${esc(montant(q.montant))}` : ''}${q.objet ? `<br>${esc(q.texte)}` : ''}<br><i>Attendu : ${esc(ATTENDUS[q.attendu] || 'une réponse')}${q.statut === 'close' ? ' — close par le cabinet' : ''}</i>` });
        if (q.reponse && q.reponduLe) lignes.push({ quand: q.reponduLe, de: `${o.contactPrenom || o.nom || 'Le client'} (client)`, quoi: `<b>Réponse à la question</b> : ${esc(q.reponse)}` });
      }
      lignes.sort((a, b) => (a.quand < b.quand ? -1 : a.quand > b.quand ? 1 : 0));
      const quand = (/** @type {string} */ iso) => `${dateCourte(jourCle(iso))} ${heure(iso)}`;
      const maintenant = new Date().toISOString();
      const nom = o.nom || 'Ce client';
      const premiere = lignes[0], derniere = lignes[lignes.length - 1];
      const periode = premiere && derniere ? `du ${dateCourte(jourCle(premiere.quand))} au ${dateCourte(jourCle(derniere.quand))}` : 'aucun échange';
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(`Conversation ${nom}`)}</title><style>
        body { font: 10.5pt/1.45 Inter, system-ui, sans-serif; color: #17202a; margin: 18mm 16mm; }
        h1 { font-size: 16pt; margin: 0 0 4px; } .sous { color: #5b6773; margin: 0 0 14px; }
        table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 9pt; color: #5b6773; border-bottom: 1.5px solid #17202a; padding: 5px 6px; }
        td { vertical-align: top; padding: 6px; border-bottom: 1px solid #dde3e8; } td.q { white-space: nowrap; width: 27mm; color: #5b6773; } td.d { width: 42mm; font-weight: 600; }
        tr { page-break-inside: avoid; } i { color: #44515c; } .pied { margin-top: 14px; font-size: 9pt; color: #5b6773; }
      </style></head><body>
        <h1>Conversation avec ${esc(nom)}</h1>
        <p class="sous">${esc(o.nomCabinet || 'Le cabinet')} · ${esc(periode)} · ${esc(pl(lignes.length, 'échange'))} · exportée le ${esc(quand(maintenant))}</p>
        <table><thead><tr><th>Date</th><th>De</th><th>Échange</th></tr></thead><tbody>
        ${lignes.map((l) => `<tr><td class="q">${esc(quand(l.quand))}</td><td class="d">${esc(l.de)}</td><td>${l.quoi}</td></tr>`).join('')}
        </tbody></table>
        <p class="pied">Heures de Tunis. Les fichiers envoyés sont nommés ici ; ils restent dans la conversation, dans SkanFact. Les notes pour l'équipe du cabinet ne sont pas dans ce document : elles ne sortent pas du cabinet.</p>
      </body></html>`;
      const fichier = await o.exportPdf(html, `Conversation ${nom} ${jourCle(maintenant)}`);
      if (o.toast) o.toast(fichier ? `« ${fichier} » est dans tes téléchargements : ${pl(lignes.length, 'échange')}, par date.` : 'La fenêtre d\'impression s\'ouvre : choisis « Enregistrer en PDF ».');
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
      // (1.182.0) Les notes de l'équipe, toutes, à la place du fil ; une note choisie s'éclaire dans le fil.
      voirNotes = () => {
        const l = [...notes].sort((a, b) => (a.ecritLe < b.ecritLe ? 1 : -1));
        montrer(`<p class="msg-trouves-dit msg-notes-dit">${dessin('cadenas')}<span>${l.length ? `${pl(l.length, 'note')} pour l'équipe dans cette conversation : ${esc(o.contactPrenom || 'le client')} ne les voit pas. Choisis-en une pour la voir dans le fil.` : 'Aucune note pour l\'équipe dans cette conversation.'}</span>
          <button type="button" class="msg-lien" data-msg-notes-fermer>Revenir à la conversation</button></p>${l.map((n) => `<button type="button" class="msg-trouve msg-trouve-note" data-msg-trouve-note="${esc(n.id)}">
            <span class="msg-trouve-tete">${esc(dateCourte(jourCle(n.ecritLe)))} · ${esc(heure(n.ecritLe))} · ${esc(n.moi ? 'Toi' : prenomDe(n.auteur))}</span>
            <span class="msg-trouve-txt">${esc(n.texte)}</span></button>`).join('')}`);
        const f = /** @type {HTMLElement | null} */ (trouves.querySelector('[data-msg-notes-fermer]'));
        if (f) f.onclick = () => montrer(null);
        trouves.querySelectorAll('[data-msg-trouve-note]').forEach((b) => {
          /** @type {HTMLElement} */ (b).onclick = () => {
            montrer(null);
            const ligne = /** @type {HTMLElement | null} */ (el.querySelector(`[data-msg-note="${CSS.escape(String(/** @type {HTMLElement} */ (b).dataset.msgTrouveNote))}"]`));
            if (!ligne) return;
            ligne.scrollIntoView({ block: 'center' });
            ligne.classList.remove('msg-eclaire'); void ligne.offsetWidth; ligne.classList.add('msg-eclaire');
            setTimeout(() => ligne.classList.remove('msg-eclaire'), 2200);
          };
        });
      };
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
      for (const n of notes) ev.push({ quand: n.ecritLe, sorte: 'note', x: n });
      if (promesse) ev.push({ quand: promesse.noteeLe, sorte: 'promesse', x: promesse });
      // Un jalon n'a qu'un jour (le dépôt) : il se range à midi, heure de Tunis.
      for (const j of jalons) ev.push({ quand: `${j.le}T11:00:00.000Z`, sorte: 'jalon', x: j });
      return ev.sort((a, b) => (a.quand < b.quand ? -1 : a.quand > b.quand ? 1 : 0));
    }
    const demandes = () => new Map([...(lu.messages || []), ...anciensMessages].filter((m) => m.demande).map((m) => [m.id, m]));
    // (1.140.0) Un seul vert (UX 3) : chaque pièce demandée portait son « Envoyer la pièce… » en vert, deux ou trois à la
    // fois. Seule la plus ancienne qui attend l'est, comme le dit « En attente de toi » (« en commençant par la plus
    // ancienne ») ; les autres gardent leur bouton, sans couleur.
    const plusAncienneAttendue = () => {
      const x = [...demandes().values()].filter((m) => !m.demande.recueLe).sort((a, b) => (a.ecritLe < b.ecritLe ? -1 : a.ecritLe > b.ecritLe ? 1 : 0))[0];
      return x ? x.id : null;
    };

    /** @param {string} nom */
    const prenomDe = (nom) => (nom === 'Toi' ? 'Toi' : String(nom || '').trim().split(/\s+/)[0] || nom);
    /** @param {string} iso */
    const jjmm = (iso) => { const j = String(iso).length > 10 ? jourCle(iso) : String(iso); return `${j.slice(8, 10)}/${j.slice(5, 7)}`; };
    // L'en-tête d'un message : le prénom de l'auteur (« Toi » de mon côté) et l'heure ; un point vert s'il est nouveau.
    /** @param {string} qui @param {string} quand @param {boolean} neuf @param {string} [plus] */
    // (1.180.0) `entier` : un nom qui n'est pas celui d'une personne (« Le client ») ne se coupe pas à son premier mot.
    const teteDe = (qui, quand, neuf, plus, entier = false) => `${neuf ? '<i class="msg-point" aria-label="nouveau"></i>' : ''}<b>${esc(entier ? qui : prenomDe(qui))}</b> · ${esc(heure(quand))}${plus ? ` · ${esc(plus)}` : ''}`;
    // (1.177.0, maquette « Messages ») Plusieurs photos ou PDF envoyés d'un coup : une rangée de vignettes (chacune s'ouvre, et
    // son menu ⋯ dit le reste), et au cabinet « Saisir les N pièces ».
    /** @param {any[]} lot */
    function lotFichiers(lot) {
      const m0 = lot[0];
      const moi = m0.cote === o.cote;
      const neuf = lot.some((m) => nouveaux.has(m.id));
      const aSaisir = lot.filter((m) => !m.achat);
      const actif = lu.fil && lu.fil.actif;
      const vig = lot.map((m) => {
        const pdf = m.fichier.type === 'application/pdf';
        return `<div class="msg-vig" data-msg-id="${esc(m.id)}">
          <button type="button" class="msg-vig-img${pdf ? ' pdf' : ''}" data-msg-fichier="${esc(m.fichier.id)}" ${!pdf && m.fichier.taille <= 3 * 1_048_576 ? `data-msg-vignette="${esc(m.fichier.id)}"` : ''} aria-label="Ouvrir ${esc(m.fichier.nom)}"><em>${pdf ? 'PDF' : 'PHOTO'}</em><i></i><i></i><i></i></button>
          <span class="msg-vig-n"><b title="${esc(m.fichier.nom)}">${esc(m.fichier.nom)}</b><small>${esc(poids(m.fichier.taille))}${m.achat ? ' · rangée' : ''}</small></span>
          <span class="msg-vig-m"><button type="button" class="msg-vig-b" data-msg-vig-menu aria-expanded="false" aria-label="Les gestes de ${esc(m.fichier.nom)}">${dessin('points')}</button>
            <span class="msg-vig-pop" hidden><button type="button" class="msg-lien" data-msg-fichier="${esc(m.fichier.id)}">Ouvrir</button>
              <button type="button" class="msg-lien" data-msg-enregistrer="${esc(m.fichier.id)}" aria-label="Enregistrer ${esc(m.fichier.nom)}">Enregistrer</button>
              ${!entreprise && !moi && !m.achat && o.saisirPiece && actif ? `<button type="button" class="msg-lien" data-msg-saisir="${esc(m.id)}">Saisir cette pièce</button>` : ''}</span></span></div>`;
      }).join('');
      // (1.182.0) « Saisir les N pièces » en lien sur la ligne de tête du lot (l'explication au survol) : en bouton, avec sa
      // ligne grise dessous, il prenait la place d'un message de plus (Skander, 30/10/2026).
      const lotGeste = !entreprise && !moi && o.saisirLot && actif && aSaisir.length
        ? `<button type="button" class="msg-lien msg-lot-saisir" data-msg-saisir-lot="${esc(aSaisir.map((m) => m.id).join(','))}" title="Une par une, au brouillard du mois ; elles sont aussi dans « Pièces reçues »">${dessin('piece')}Saisir ${aSaisir.length > 1 ? `les ${aSaisir.length} pièces` : 'la pièce'}</button>` : '';
      return `<div class="msg-ligne msg-ligne-lot${moi ? ' moi' : ''}" data-msg-id="${esc(m0.id)}">
        <span class="msg-qui msg-qui-lot">${teteDe(m0.moi ? 'Toi' : m0.auteur, m0.ecritLe, neuf, pl(lot.length, 'pièce'))}${lotGeste}</span>
        <div class="msg-vigs">${vig}</div></div>`;
    }
    // Les vignettes des photos (3 Mo au plus) : le fichier lu une fois, gardé le temps de la conversation.
    /** @param {HTMLElement} fil */
    function poserVignettes(fil) {
      fil.querySelectorAll('[data-msg-vignette]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        const id = String(b.dataset.msgVignette);
        if (!vignettes.has(id)) {
          vignettes.set(id, o.appel('GET', `/messages/fichiers/${encodeURIComponent(id)}`).then((/** @type {any} */ f) => {
            const blob = new Blob([Uint8Array.from(atob(String(f.contenu)), (c) => c.charCodeAt(0))], { type: f.type });
            return URL.createObjectURL(blob);
          }));
        }
        /** @type {Promise<string>} */ (vignettes.get(id)).then((url) => { b.style.backgroundImage = `url("${url}")`; b.classList.add('vue'); }).catch(() => { vignettes.delete(id); });
      });
    }

    // (1.181.0) Comme une messagerie, les messages qui se suivent (le même auteur, le même jour, à moins de cinq minutes)
    // forment un groupe : le nom et l'heure une fois en tête, les bulles serrées, « Envoyé » ou « Lue » sous la dernière.
    /** @param {any} a @param {any} b */
    const memeGroupe = (a, b) => !!a && !!b && a.sorte === 'message' && b.sorte === 'message' && a.x.cote === b.x.cote
      && a.x.auteur === b.x.auteur && !!a.x.moi === !!b.x.moi && jourCle(a.quand) === jourCle(b.quand)
      && Math.abs(new Date(b.quand).getTime() - new Date(a.quand).getTime()) < 5 * 60_000;
    /** @param {any} m @param {{ suite?: boolean, suivi?: boolean }} [g] */
    function bulleMessage(m, g = {}) {
      // De mon côté du fil (à droite), écrit par moi (« Toi ») ou par un collègue (son nom).
      const moi = m.cote === o.cote;
      const tete = g.suite ? '' : teteDe(m.moi ? 'Toi' : m.auteur, m.ecritLe, nouveaux.has(m.id));
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
          : entreprise ? `<button type="button" class="btn btn-sm${m.id === plusAncienneAttendue() ? ' btn-primary' : ''}" data-msg-envoyer-piece="${esc(m.id)}">Envoyer la pièce…</button>`
            : `<button type="button" class="btn btn-sm" data-msg-recue="${esc(m.id)}">Reçue autrement</button>`;
        const pour = m.demande.pour && !recue ? `<span class="msg-pour">pour le ${esc(dateCourte(m.demande.pour))}</span>` : '';
        const relances = !entreprise && m.demande.relances && !recue
          ? `<span class="msg-carte-sous">${m.demande.relances > 1 ? `Relancée ${m.demande.relances} fois par e-mail, la dernière le` : 'Relancée par e-mail le'} ${esc(dateCourte(jourCle(m.demande.relanceLe)))}${m.demande.relances >= 3 ? ' : plus de relance automatique' : ''}</span>` : '';
        const parQui = !entreprise && m.cote === 'cabinet' ? (m.moi ? ' par toi' : m.auteur ? ` par ${prenomDe(m.auteur)}` : '') : '';
        const frise = [`<li class="fait"><b>Demandée</b><small>${esc(jjmm(m.ecritLe))}</small></li>`,
          ...(m.demande.relances && !recue ? [`<li class="fait"><b>Relancée</b><small>${esc(jjmm(m.demande.relanceLe))}</small></li>`] : []),
          recue ? `<li class="fait ok"><b>Reçue</b><small>${esc(jjmm(m.demande.recueLe))}</small></li>`
            : `<li class="${retard ? 'retard' : 'attend'}"><b>${retard ? 'En retard' : entreprise ? 'À envoyer' : 'Attendue'}</b><small>${m.demande.pour ? `pour le ${esc(jjmm(m.demande.pour))}` : 'sans date'}</small></li>`].join('');
        corps += `<div class="msg-carte msg-demande-carte${recue ? ' recue' : ''}${retard ? ' retard' : ''}">${dessin('piece')}<span class="msg-carte-txt"><b>Pièce demandée${esc(parQui)}</b><span>${esc(m.demande.texte)}${recue ? ' · reçue' : ''}</span>${pour}</span>
          <ol class="msg-frise-d" aria-label="Où en est la pièce">${frise}</ol>
          <span class="msg-etat">${recue ? 'Reçue' : retard ? 'En retard' : entreprise ? 'À envoyer' : 'Attendue'}</span>${geste}${relances}</div>`;
      }
      if (m.fichier) {
        corps += `<div class="msg-fichier">${dessin(m.fichier.type === 'application/pdf' ? 'piece' : 'image')}
          <span class="msg-carte-txt"><b>${esc(m.fichier.nom)}</b><span class="msg-poids">${esc(m.fichier.type === 'application/pdf' ? 'PDF' : 'Photo')} · ${esc(poids(m.fichier.taille))}</span></span>
          <button type="button" class="msg-lien" data-msg-fichier="${esc(m.fichier.id)}">Ouvrir</button>
          <button type="button" class="msg-lien" data-msg-enregistrer="${esc(m.fichier.id)}" aria-label="Enregistrer ${esc(m.fichier.nom)}">Enregistrer</button>
          ${!entreprise && m.cote === 'entreprise' && m.achat && o.ouvrirPiece && /\s·\s/.test(m.achat.libelle) ? `<button type="button" class="msg-lien" data-msg-ouvrir="achat:${esc(m.achat.id)}" data-msg-libelle="${esc(m.achat.libelle)}">Voir l'écriture</button>`
            : !entreprise && m.cote === 'entreprise' && !m.achat && o.saisirPiece && actif ? `<button type="button" class="msg-lien" data-msg-saisir="${esc(m.id)}">Saisir cette pièce</button>` : ''}</div>`;
      }
      if (m.repondA) {
        const d = demandes().get(m.repondA);
        if (d) corps = `<span class="msg-reponse-a">En réponse à : ${esc(d.demande.texte)}</span>${corps}`;
      }
      /** @type {string[]} */
      const pied = [];
      // (1.115.0) « Envoyé », puis « Lue » : rien ne disait qu'un message était parti avant que l'autre l'ait lu.
      if (moi && !g.suivi) pied.push(m.lu ? `${dessin('coche')}Lue` : 'Envoyé');
      if (m.achat) pied.push(`rangée dans ${entreprise ? 'tes' : 'ses'} achats (${esc(m.achat.libelle)})`);
      // (1.94.0) Le « · » reste avec le genre (une ligne qui passe à la suivante ne commence plus par lui), et un fichier
      // envoyé avec une facture, un avoir ou un devis n'est pas un achat : il ne se propose pas d'y être rangé.
      // (1.123.0) La photo répond à une demande qui cite le numéro d'un achat déjà saisi : elle s'y joint d'un geste
      // (« Ranger dans mes achats » ouvrait un achat neuf : un doublon ; revue du mois d'un client, 23/10/2026).
      const peutRanger = entreprise && actif && m.fichier && !m.achat && !(m.piece && m.piece.genre !== 'achat');
      const demandeLiee = peutRanger && m.repondA ? demandes().get(m.repondA) : null;
      const cite = demandeLiee && o.achatCite && o.joindreAchat ? o.achatCite(demandeLiee.demande.texte) : null;
      const ranger = !peutRanger ? ''
        : cite ? `<span class="msg-ranger-cite"><button type="button" class="btn btn-sm" data-msg-joindre-achat="${esc(m.id)}" data-msg-achat="${esc(cite.id)}">Joindre à l'achat ${esc(cite.libelle)}</button>${o.rangerAchat ? `<button type="button" class="msg-lien" data-msg-ranger="${esc(m.id)}">C'est un autre achat…</button>` : ''}</span>`
          : o.rangerAchat ? `<button type="button" class="btn btn-sm" data-msg-ranger="${esc(m.id)}">Ranger dans mes achats…</button>` : '';
      return `<div class="msg-ligne${moi ? ' moi' : ''}${g.suite ? ' suite' : ''}" data-msg-id="${esc(m.id)}">
        ${tete ? `<span class="msg-qui">${tete}</span>` : ''}${corps}
        ${pied.length ? `<span class="msg-pied">${pied.map((x, i) => (i ? x : x.charAt(0).toUpperCase() + x.slice(1))).join(' · ')}</span>` : ''}${ranger}</div>`;
    }

    /** @param {any} q */
    function carteQuestion(q) {
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
      // (1.177.0, maquette « Messages ») Une carte à part, pleine largeur : qui l'a posée et quand, l'objet et son montant,
      // ce qu'on attend, depuis combien de jours elle attend, et (au cabinet) « Voir dans la révision ».
      const jours = attend ? Math.max(0, Math.round((Date.now() - new Date(q.envoyeeLe).getTime()) / 86_400_000)) : 0;
      return `<div class="msg-ligne msg-ligne-q" data-msg-q="${esc(q.id)}">
        <div class="msg-question${attend ? ' attend' : ''}">
          <span class="msg-q-ic">${dessin('question')}</span>
          <div class="msg-q-txt"><span class="msg-q-qui">${q.piece ? `Question sur ${esc(q.piece)}` : 'Question de la révision'} · posée par ${esc(pose === 'Toi' ? 'toi' : prenomDe(pose))} · ${esc(heure(q.envoyeeLe))}</span>
            <b class="msg-q-objet">${esc(q.objet || q.texte)}${q.montant && !/^-?0(\.0+)?$/.test(q.montant) ? ` · <span class="msg-montant">${esc(montant(q.montant))}</span>` : ''}</b>
            <div class="msg-q-corps">${q.objet ? `<span>${esc(q.texte)}</span>` : ''}
              <span class="msg-q-attendu">${entreprise ? 'Ton cabinet attend' : 'Tu attends'} : ${esc(ATTENDUS[q.attendu] || 'une réponse')}.</span>
              ${attend && jours ? `<span class="msg-q-depuis">sans réponse depuis ${esc(pl(jours, 'jour'))}</span>` : ''}
              ${etat}${repondre}</div></div>
          ${!entreprise && o.revision ? '<button type="button" class="btn btn-sm msg-q-voir" data-msg-revision>Voir dans la révision</button>' : ''}
        </div></div>`;
    }
    // (1.178.0, maquette « Messages », lot 3) La promesse du client, à la date où elle est notée : ce qui est promis et pour
    // quand, qui l'a notée, ce qu'elle fait de la conversation ; tenue (il a écrit depuis) ou passée sans rien, elle le dit.
    /** @param {any} p */
    function cartePromesse(p) {
      const qui = o.contactPrenom || 'Le client';
      const sous = p.tenue ? `notée par ${p.moi ? 'toi' : esc(prenomDe(p.par))} · ${esc(qui)} a écrit depuis : elle ne compte plus`
        : p.echue ? `notée par ${p.moi ? 'toi' : esc(prenomDe(p.par))} · le jour est passé sans rien : la conversation est revenue dans « À traiter »`
          : `notée par ${p.moi ? 'toi' : esc(prenomDe(p.par))} · elle compte dans « Attend le client » ; ${esc(nomDuJour(p.pour))} soir sans rien, elle revient dans « À traiter »`;
      return `<div class="msg-ligne msg-ligne-jalon" data-msg-promesse><div class="msg-jalon promesse${p.tenue ? ' tenue' : p.echue ? ' echue' : ''}">${dessin('reveil')}
        <span><b>${esc(qui)} promet ${esc(p.quoi)} pour ${esc(jourLong(p.pour))}</b><small>${sous}</small></span>
        ${p.tenue || !(lu && lu.fil && lu.fil.actif) ? '' : '<button type="button" class="msg-lien" data-msg-promesse-retirer>Retirer</button>'}</div></div>`;
    }
    // Un jalon du dossier : la déclaration d'un mois, déposée (qui, quand, ce qu'il y a à payer).
    /** @param {any} j */
    function carteJalon(j) {
      const mois = MOIS[Number(String(j.periode).slice(5, 7)) - 1] || j.periode;
      const aPayer = j.aPayer && !/^-?0(\.0+)?$/.test(j.aPayer) ? j.aPayer : null;
      return `<div class="msg-ligne msg-ligne-jalon"><div class="msg-jalon">${dessin('coche')}
        <span><b>Déclaration ${esc(deMot(mois))} déposée</b><small>${j.par ? `par ${j.moi ? 'toi' : esc(prenomDe(j.par))}, ` : ''}le ${esc(jjmm(j.le))}</small></span>
        ${aPayer ? `<em class="msg-jalon-m">${esc(montant(aPayer))} à payer</em>` : ''}</div></div>`;
    }
    // « Noter la promesse de … » : sous le message qui promet (ou, depuis le menu, au bas du fil). Le jour qu'il nomme, le
    // lundi qui suit, ou un autre ; « Noter pour vendredi ».
    /** @param {any} m */
    function popPromesse(m) {
      const qui = o.contactPrenom || 'ce client';
      const nomme = m ? jourPromis(m.texte) : '';
      const lundi = (() => { for (let n = 1; n <= 7; n++) { const j = dansJours(n); if (nomDuJour(j) === 'lundi' && j !== nomme) return j; } return dansJours(7); })();
      const choix = [...new Set([nomme || dansJours(1), lundi].filter(Boolean))];
      if (!promesseJour) promesseJour = choix[0] || dansJours(1);
      const autre = !choix.includes(promesseJour);
      const cite = m && m.texte ? `« ${esc(m.texte.length > 90 ? `${m.texte.slice(0, 90)}…` : m.texte)} » : ` : '';
      return `<div class="msg-ligne msg-ligne-pop"><div class="msg-promesse-pop" role="group" aria-labelledby="msg-pp-t" data-msg-pp="${esc(m ? m.id : 'menu')}">
        <b id="msg-pp-t">Noter la promesse ${esc(deMot(qui))}</b>
        <p>${cite}la conversation passe dans « Attend le client » et revient seule si rien n'arrive.</p>
        <div class="msg-pp-jours" role="radiogroup" aria-label="Pour quel jour">${choix.map((j) => `<button type="button" role="radio" class="msg-pp-j" aria-checked="${j === promesseJour}" data-msg-pp-jour="${j}">${esc(jourCourt(j))}</button>`).join('')}
          <label class="msg-pp-j msg-pp-autre${autre ? ' choisi' : ''}"><span>${autre ? esc(jourCourt(promesseJour)) : 'Choisir…'}</span><input type="date" min="${dansJours(0)}" value="${esc(promesseJour)}" data-msg-pp-date aria-label="Un autre jour"></label></div>
        <label class="msg-pp-quoi"><span>Ce qu'il promet</span><input type="text" maxlength="200" value="ses pièces ${esc(deMot(moisDavant()))}" data-msg-pp-quoi></label>
        <p class="msg-refus" role="alert" data-msg-pp-refus></p>
        <span class="msg-pp-gestes"><button type="button" class="btn btn-sm" data-msg-pp-non>Annuler</button><button type="button" class="btn btn-sm btn-primary" data-msg-pp-oui>Noter pour ${esc(nomDuJour(promesseJour))}</button></span></div></div>`;
    }
    /** @param {HTMLElement} fil */
    function brancherPromesse(fil) {
      const pop = /** @type {HTMLElement | null} */ (fil.querySelector('[data-msg-pp]'));
      const retirer = fil.querySelector('[data-msg-promesse-retirer]');
      if (retirer && o.suivi) {
        const s = o.suivi;
        surClic(fil, '[data-msg-promesse-retirer]', async () => {
          await s.retirerPromesse();
          if (o.toast) o.toast('Promesse retirée : la conversation suit de nouveau ce qui arrive.');
          await relire();
          if (o.surAttente) o.surAttente(lu && lu.attente);
        });
      }
      if (!pop || !o.suivi) return;
      const suivi = o.suivi;
      const redessiner = () => { dessinerFil(); };
      pop.querySelectorAll('[data-msg-pp-jour]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { promesseJour = String(/** @type {HTMLElement} */ (b).dataset.msgPpJour); redessiner(); }; });
      const date = /** @type {HTMLInputElement} */ (pop.querySelector('[data-msg-pp-date]'));
      date.onchange = () => { if (date.value) { promesseJour = date.value; redessiner(); } };
      /** @type {HTMLElement} */ (pop.querySelector('[data-msg-pp-non]')).onclick = () => {
        if (promessePop && promessePop !== 'menu') promessesEcartees.add(promessePop);
        promessePop = null; promesseJour = ''; redessiner();
      };
      const refus = /** @type {HTMLElement} */ (pop.querySelector('[data-msg-pp-refus]'));
      surClic(pop, '[data-msg-pp-oui]', async () => {
        const quoi = /** @type {HTMLInputElement} */ (pop.querySelector('[data-msg-pp-quoi]')).value.trim();
        if (!quoi) { refus.textContent = 'Dis ce qui est promis (par exemple : ses pièces de septembre), puis « Noter ».'; return; }
        try { await suivi.promettre(promesseJour, quoi); } catch (x) { refus.textContent = motif(x); return; }
        const jour = promesseJour;
        if (promessePop && promessePop !== 'menu') promessesEcartees.add(promessePop);
        promessePop = null; promesseJour = '';
        await relire();
        if (o.surAttente) o.surAttente(lu && lu.attente);
        const dit = `Promesse notée : ${jourLong(jour)}`;
        if (o.toastAnnuler) o.toastAnnuler(dit, async () => { await suivi.retirerPromesse(); await relire(); if (o.surAttente) o.surAttente(lu && lu.attente); });
        else if (o.toast) o.toast(dit);
      });
    }
    // La promesse à proposer : le dernier message du client, s'il promet, n'est pas déjà suivi d'une promesse notée, et n'a
    // pas été écarté.
    function promesseAProposer() {
      if (entreprise || !o.suivi || !(lu && lu.fil && lu.fil.actif)) return null;
      const siens = [...(lu.messages || []), ...anciensMessages].filter((m) => m.cote !== o.cote && m.texte).sort((a, b) => (a.ecritLe < b.ecritLe ? -1 : 1));
      const m = siens[siens.length - 1];
      if (!m || promessesEcartees.has(m.id) || jourPromis(m.texte) === null) return null;
      if (promesse && promesse.noteeLe >= m.ecritLe) return null;
      return m.id;
    }

    // (1.177.0) Une note pour l'équipe : pleine largeur, jaune, au cadenas ; qui l'a écrite et quand. Le client ne la lit jamais.
    /** @param {any} n */
    function carteNote(n) {
      return `<div class="msg-ligne msg-ligne-note" data-msg-note="${esc(n.id)}"><div class="msg-note">${dessin('cadenas')}
        <span><small>Note pour l'équipe · ${esc(n.moi ? 'toi' : prenomDe(n.auteur))} · ${esc(heure(n.ecritLe))}</small>${esc(n.texte)}</span></div></div>`;
    }
    /** @param {any} q */
    function bulleReponse(q) {
      const moi = entreprise;
      const qui = q.repondueePar === 'moi' ? 'Toi' : q.repondueePar || (entreprise ? 'Ton entreprise' : 'Le client');
      return `<div class="msg-ligne${moi ? ' moi' : ''}">
        <span class="msg-qui">${teteDe(qui, q.reponduLe, nouveaux.has(`r:${q.id}`), '', !q.repondueePar)}</span>
        ${/* (1.97.0) Une réponse dit à quelle question : « Réponse à la question » seul ne dit rien d'une question sans pièce. */''}
        <span class="msg-reponse-a">Réponse à la question${q.objet ? ` « ${esc(q.objet)} »` : ''}${q.piece ? ` sur ${esc(q.piece)}` : ''}</span>
        <div class="msg-bulle">${esc(q.reponse)}</div>${carteImputer(q)}</div>`;
    }
    // (1.180.0, maquette « Messages » : « Imputer le virement ») La réponse dit ce qu'était la ligne restée au compte
    // d'attente : au cabinet, sous elle, le geste qui l'impute (le montant et son compte, lus dans le livre par le
    // serveur), et une fois fait, ce qu'il a fait. L'écriture va au brouillard : elle se relit et se valide comme toute
    // saisie.
    /** @param {any} q */
    function carteImputer(q) {
      const im = q.imputation;
      if (entreprise || !im || !o.imputer || !(lu.fil && lu.fil.actif)) return '';
      if (im.faite) {
        return `<span class="msg-imp fait">${dessin('coche')}<span>Imputée : ${esc(montant(im.montant))} sortis du compte ${esc(im.compte)}, au brouillard</span>${o.revision ? '<button type="button" class="msg-lien" data-msg-revision>Voir dans la révision</button>' : ''}</span>`;
      }
      return `<span class="msg-imp"><button type="button" class="btn btn-sm msg-imp-b" data-msg-imputer="${esc(q.id)}">${dessin('livre')}Imputer ${im.banque ? 'le virement' : 'le montant'}</button>${o.revision ? '<button type="button" class="msg-lien" data-msg-revision>Voir dans la révision</button>' : ''}
        <small>sort les ${esc(montant(im.montant))} du compte ${esc(im.compte)}, au compte que tu choisis</small></span>`;
    }

    function dessinerFil() {
      const fil = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-fil]'));
      if (!fil) return;
      // Le texte d'une réponse en cours se garde (la relecture redessine le fil), et le curseur y revient.
      const actif = /** @type {HTMLElement | null} */ (document.activeElement);
      const garde = actif && fil.contains(actif) && actif instanceof HTMLTextAreaElement ? { id: actif.id, debut: actif.selectionStart, fin: actif.selectionEnd } : null;
      const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 40;
      const ev = evenements();
      if (!promessePop) promessePop = promesseAProposer();
      let html = suite ? '<div class="msg-plus"><button type="button" class="btn btn-sm" data-msg-plus>Voir les messages plus anciens</button></div>' : '';
      let jour = '';
      let trait = false;
      // Un envoi de plusieurs fichiers seuls (sans texte), du même auteur, à quelques minutes : une rangée de vignettes.
      const seulFichier = (/** @type {any} */ e) => e.sorte === 'message' && e.x.fichier && !e.x.texte && !e.x.demande && !e.x.piece && !e.x.repondA;
      for (let i = 0; i < ev.length; i++) {
        const e = /** @type {{ quand: string, sorte: string, x: any }} */ (ev[i]);
        const j = jourCle(e.quand);
        if (j !== jour) { jour = j; html += `<span class="msg-jour">${esc(jourDit(e.quand))}</span>`; }
        const idNouveau = e.sorte === 'reponse' ? `r:${e.x.id}` : e.x.id;
        if (!trait && nouveaux.has(idNouveau)) { trait = true; html += `<div class="msg-nouveaux" role="separator"><span>${esc(pl(nouveaux.size, 'nouveau', 'nouveaux'))}</span></div>`; }
        if (seulFichier(e)) {
          const lot = [e.x];
          for (let s = ev[i + 1]; s && seulFichier(s) && s.x.cote === e.x.cote && s.x.auteur === e.x.auteur && jourCle(s.quand) === j
            && new Date(s.quand).getTime() - new Date(e.quand).getTime() < 15 * 60_000; s = ev[i + 1]) { i++; lot.push(s.x); }
          if (lot.length > 1) { html += lotFichiers(lot); continue; }
        }
        const neuf = (/** @type {any} */ x) => nouveaux.has(x.sorte === 'reponse' ? `r:${x.x.id}` : x.x.id);
        // Le groupe s'arrête au trait « nouveaux » et à la promesse proposée sous un message.
        const suite = memeGroupe(ev[i - 1], e) && !(neuf(e) && !neuf(/** @type {any} */ (ev[i - 1]))) && promessePop !== ev[i - 1]?.x.id;
        // « Envoyé » ou « Lue » ne se met en commun que si le suivant dit la même chose.
        const suivi = memeGroupe(e, ev[i + 1]) && !(neuf(/** @type {any} */ (ev[i + 1])) && !neuf(e)) && promessePop !== e.x.id && !!ev[i + 1]?.x.lu === !!e.x.lu;
        html += e.sorte === 'message' ? bulleMessage(e.x, { suite, suivi }) : e.sorte === 'question' ? carteQuestion(e.x) : e.sorte === 'note' ? carteNote(e.x)
          : e.sorte === 'promesse' ? cartePromesse(e.x) : e.sorte === 'jalon' ? carteJalon(e.x) : bulleReponse(e.x);
        // La promesse proposée, sous le message qui promet.
        if (e.sorte === 'message' && promessePop === e.x.id) html += popPromesse(e.x);
      }
      if (promessePop === 'menu') html += popPromesse(null);
      if (!ev.length) {
        html += `<div class="msg-vide"><b>${entreprise ? 'Aucun message encore.' : 'Aucun échange encore avec ce client.'}</b>
          <span>${entreprise ? 'Écris à ton cabinet ici, joins une photo de facture ou demande-lui ce qu\'il te faut : chaque message garde sa date et son auteur, dans ton dossier.'
            : 'Écris-lui ici, demande-lui une pièce, ou pose tes questions pendant la révision : elles arrivent dans ce fil, avec sa réponse.'}</span></div>`;
      }
      fil.innerHTML = html;
      brancherFil(fil);
      brancherPromesse(fil);
      poserVignettes(fil);
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
        const etat = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-tete-etat]'));
        if (etat) {
          const promise = !!(promesse && !promesse.tenue && !promesse.echue);
          etat.innerHTML = `${rappel ? `<span class="msg-etat-pastille tard" title="Tu as demandé de la revoir ${esc(jourLong(rappel))}">Plus tard · ${esc(jourCourt(rappel))}</span>`
            : f && f.aTraiter ? '<span class="msg-etat-pastille traiter">À traiter</span>' : !rien || promise ? '<span class="msg-etat-pastille client">Attend le client</span>' : ''}
            ${f && f.aTraiter ? `<button type="button" class="btn btn-sm msg-traite" data-msg-traite aria-label="Marquer comme traité" aria-keyshortcuts="E" title="Ce client t'a écrit depuis ta dernière réponse. Rien à lui répondre ? Il quitte « À traiter » jusqu'à son prochain message.">${dessin('coche')}Marquer comme traité<kbd>E</kbd></button>` : ''}`;
          surClic(etat, '[data-msg-traite]', async () => {
            if (o.traiter) { await o.traiter(); return; }
            await o.appel('POST', '/messages/traite');
            if (o.toast) o.toast('C\'est noté : ce client quitte « À traiter » jusqu\'à son prochain message.');
            await relire();
          });
        }
        // Ce qu'on attend de lui, dans la colonne du dossier (la boîte la tend, `coteEl`) : les questions et les pièces
        // demandées sans réponse, la plus ancienne d'abord ; et l'alerte par e-mail.
        const z = /** @type {HTMLElement} */ (o.coteEl || cote);
        if (o.coteEl) cote.hidden = true;
        const prenom = String(o.contact || o.nom || '').split(/[\s·]/)[0] || 'ce client';
        const qs = [...(lu.questions || []), ...anciennesQuestions].filter((q) => q.statut === 'envoyee' && !q.reponse);
        const ds = [...demandes().values()].filter((m) => !m.demande.recueLe);
        const jours = (/** @type {string} */ iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
        const items = [
          ...qs.map((q) => ({ quand: q.envoyeeLe, html: `<li>${dessin('question')}<span><b>${esc(q.objet || q.texte)}${q.montant && !/^-?0(\.0+)?$/.test(q.montant) ? ` · ${esc(montant(q.montant))}` : ''}</b><small>question de la révision · depuis ${esc(pl(jours(q.envoyeeLe), 'jour'))}</small></span></li>` })),
          ...ds.map((m) => ({ quand: m.ecritLe, html: `<li class="${m.demande.enRetard ? 'retard' : ''}">${dessin('piece')}<span><b>${esc(m.demande.texte)}</b><small>pièce demandée${m.demande.pour ? ` · pour le ${esc(dateCourte(m.demande.pour))}` : ''}${m.demande.enRetard ? ' · en retard' : ''}${m.demande.relances ? ` · relancée ${m.demande.relances > 1 ? `${m.demande.relances} fois` : 'une fois'}` : ''}</small></span></li>` })),
        ].sort((x, y) => (x.quand < y.quand ? -1 : 1));
        if (promesse && !promesse.tenue) items.push({ quand: promesse.noteeLe, html: `<li class="${promesse.echue ? 'retard' : 'promise'}">${dessin('reveil')}<span><b>${esc(promesse.quoi.charAt(0).toUpperCase() + promesse.quoi.slice(1))}</b><small>${promesse.echue ? `promis pour ${esc(jourLong(promesse.pour))} · le jour est passé` : `promis pour ${esc(jourLong(promesse.pour))}`}</small></span></li>` });
        z.innerHTML = `${items.length ? `<section class="msg-cote-carte attend" data-msg-attente><h3>On attend ${esc(deMot(prenom))}<span class="msg-filtre-n">${items.length}</span></h3><ul class="msg-attend-l">${items.map((x) => x.html).join('')}</ul></section>` : ''}
          ${f && f.actif ? `<label class="msg-cote-alerte" title="« Un nouveau message t'attend dans SkanFact », cinq minutes après s'il n'est pas lu. Le message lui-même reste dans SkanFact.">${dessin('cloche')}<span>Me prévenir par e-mail</span><input type="checkbox" role="switch" class="msg-bascule" data-msg-alerte ${f.alerte ? 'checked' : ''}></label>` : ''}`;
        brancherCote(z);
        return;
      }
      // (1.124.0) « Ce mois-ci » : les pièces du mois et ce que le cabinet en a fait, sous ce qui attend (revue du mois d'un
      // client, point 4 : après la validation d'octobre, rien ne le disait à la cliente). La phrase du cabinet garde sa place
      // pendant qu'elle se relit (la dernière lue, ou « … ») : rien ne bouge sous le curseur.
      const mois = entreprise && f && f.actif && !cabinetRelu && o.ceMois ? o.ceMois() : null;
      const carteMois = mois ? `<div class="msg-encart msg-mois" data-msg-mois><b>${esc(mois.titre)}</b>
          ${mois.lignes.map((x) => `<span>${esc(x)}</span>`).join('')}
          ${mois.cabinet ? `<span data-msg-mois-cabinet>${esc(texteCabinetDuMois || 'Ce que ton cabinet en a fait : …')}</span>` : ''}
          ${mois.action ? `<button type="button" class="msg-lien" data-msg-mois-aller>${esc(mois.action.libelle)}</button>` : ''}</div>` : '';
      cote.innerHTML = `${f ? `<div class="msg-encart${rien ? ' ok' : ' attend'}" data-msg-attente><b>${entreprise ? 'En attente de toi' : 'Ce qui attend le client'}</b><span>${esc(texte)}</span>${aller}</div>` : ''}
        ${carteMois}
        ${entreprise && o.range ? '<div class="msg-encart msg-range" data-msg-range hidden></div>' : ''}
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
      if (mois && mois.action) {
        const allerMois = cote.querySelector('[data-msg-mois-aller]');
        if (allerMois) /** @type {HTMLElement} */ (allerMois).onclick = () => { if (mois.action) mois.action.faire(); };
      }
      // (1.173.0) « Ce que ton cabinet a rangé » : les documents qu'il a déposés dans ton dossier, les pièces qu'il a jointes
      // à tes achats ; chacun s'ouvre. Rien ne se montre tant que rien n'est rangé.
      if (entreprise && o.range) {
        const z = /** @type {HTMLElement | null} */ (cote.querySelector('[data-msg-range]'));
        o.range().then((l) => {
          if (!z || !z.isConnected || !l.length) return;
          const jour = (/** @type {string} */ iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Africa/Tunis' });
          const vus = l.slice(0, 6);
          z.innerHTML = `<b>Ce que ton cabinet a rangé</b><span>${l.length > 1 ? `${l.length} pièces` : 'Une pièce'} dans ton dossier, par ${esc(l[0].cabinet)}.</span>
            <ul class="msg-range-l">${vus.map((x, i) => `<li><button type="button" class="msg-lien" data-msg-range-i="${i}">${esc(x.titre)}</button><small>${esc(x.sorte === 'message'
              ? `jointe à ton achat ${x.achat ? '' : ''}${x.ecriture || ''} le ${jour(x.jointeLe || x.deposeLe)}`
              : `${x.rubrique === 'permanent' ? 'dossier permanent' : x.rubrique === 'courrier' ? 'un courrier' : x.rubrique === 'accuse' ? 'accusé de dépôt' : 'une pièce'}${x.ecriture ? `, jointe à ${x.ecriture}` : ''} · le ${jour(x.deposeLe)}`)}</small></li>`).join('')}</ul>
            ${l.length > vus.length ? `<small>et ${l.length - vus.length} autre${l.length - vus.length > 1 ? 's' : ''}, dans le classeur de ton cabinet.</small>` : ''}`;
          z.hidden = false;
          z.querySelectorAll('[data-msg-range-i]').forEach((b) => {
            /** @type {HTMLElement} */ (b).onclick = () => { const x = vus[Number(/** @type {HTMLElement} */ (b).dataset.msgRangeI)]; if (x && o.ouvrirRange) o.ouvrirRange(x); };
          });
        }).catch(() => { /* sans réseau, l'encart se tait */ });
      }
      if (mois && mois.cabinet) {
        mois.cabinet.then((t) => {
          texteCabinetDuMois = t;
          const n = cote.querySelector('[data-msg-mois-cabinet]');
          if (!n) return;
          if (t) n.textContent = t; else n.remove();
        }).catch(() => { const n = cote.querySelector('[data-msg-mois-cabinet]'); if (n && !texteCabinetDuMois) n.remove(); });
      }
    }

    // ── Lire, relire ───────────────────────────────────────────────────────────────────────────
    async function lire() {
      if (enCours || fini) return;
      enCours = true;
      try {
        /** @type {any} */ let r;
        /** @type {any} */ let sv;
        try {
          [r, sv] = await Promise.all([o.appel('GET', chemin(null)),
            avecNotes ? /** @type {any} */ (o.suivi).lire().catch(() => null) : Promise.resolve(null)]);
          if (o.cle && !cabinetRelu) LUES.set(`${o.cote}:${o.cle}`, { r, sv });
        } catch (x) {
          // (1.179.0, lot 4) Hors ligne, une conversation déjà lue depuis l'ouverture de la page se relit telle qu'elle
          // était (gardée en mémoire seulement, rien sur le poste) ; écrire attend le réseau.
          const copie = !lu && sansReseau(x) && o.cle ? LUES.get(`${o.cote}:${o.cle}`) : null;
          if (!copie) throw x;
          ({ r, sv } = copie);
        }
        if (sv) {
          notes = sv.notes || []; promesse = sv.promesse || null; rappel = sv.rappel || null; jalons = sv.jalons || [];
          const voir = /** @type {HTMLButtonElement | null} */ (el.querySelector('[data-msg-voir-notes]'));
          if (voir) { voir.hidden = !notes.length; voir.textContent = `Voir les ${pl(notes.length, 'note')}`; }
        }
        // La page a changé (la racine n'est plus à l'écran) : la conversation s'arrête là.
        if (!el.isConnected) { arreter(); return; }
        if (fini) return;
        const nouvelle = JSON.stringify([r.messages.map((/** @type {any} */ m) => [m.id, m.lu, m.achat, m.demande && m.demande.recueLe]),
          r.questions.map((/** @type {any} */ q) => [q.id, q.statut, q.reponduLe]), r.attente, r.fil && [r.fil.alerte, r.fil.actif], notes.map((n) => n.id), promesse, rappel, jalons.length]);
        const premiereFois = !lu;
        if (premiereFois) {
          suite = r.suite;
          const n = Number((r.attente && r.attente.nonLus) || 0);
          if (n) {
            const venus = [...r.messages.filter((/** @type {any} */ m) => m.cote !== o.cote).map((/** @type {any} */ m) => ({ id: m.id, quand: m.ecritLe })),
              ...r.questions.filter((/** @type {any} */ q) => q.reponse && q.reponduLe && !entreprise).map((/** @type {any} */ q) => ({ id: `r:${q.id}`, quand: q.reponduLe }))]
              .sort((a, b) => (a.quand < b.quand ? -1 : 1));
            nouveaux = new Set(venus.slice(-n).map((x) => x.id));
          }
        }
        lu = r;
        // Aucun cabinet ne tient le dossier, et aucun ne l'a tenu : rien à relire, le geste qui ouvre la messagerie.
        if (premiereFois && !r.fil && !(r.anciens || []).length) {
          signature = 'vide';
          // (27/10/2026, maquette « Mon comptable ») Côté entreprise, la page dessinée : ce que le comptable fait ici, et
          // comment l'inviter (plateforme/pont.js, `dessinerSansCabinet`).
          if (entreprise && o.sansCabinet) { o.sansCabinet(el); return; }
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
        if (r.fil && r.attente && r.attente.aLire && document.visibilityState === 'visible' && navigator.onLine !== false) {
          await o.appel('POST', '/messages/lu', { cote: o.cote, cabinet: cabinetRelu });
          if (o.surAttente && !cabinetRelu) o.surAttente({ ...r.attente, nonLus: 0, aLire: false });
        }
      } catch (x) {
        if (!lu) el.innerHTML = `<div class="msg-page"><header class="msg-tete"><span class="msg-tete-txt"><h1>${entreprise ? 'Mon comptable' : esc(o.nom || 'Ce client')}</h1></span></header>
          <div class="msg-zone"><div class="msg-vide" data-msg-echec>${sansReseau(x)
            ? '<b>Pas de réseau : la messagerie attend la connexion.</b><span>Elle s\'ouvre toute seule dès que le réseau revient.</span>'
            : `<b>La messagerie ne s'est pas ouverte.</b><span>${esc(motif(x))}</span>`}
          <button type="button" class="btn" data-msg-relire>Réessayer</button></div></div></div>`;
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
      // (1.177.0) Le menu ⋯ d'une vignette : ses gestes sous elle ; un seul ouvert à la fois.
      fil.querySelectorAll('[data-msg-vig-menu]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.onclick = () => {
          const pop = /** @type {HTMLElement} */ (b.nextElementSibling);
          const ouvrir = pop.hidden;
          fil.querySelectorAll('.msg-vig-pop').forEach((x) => { /** @type {HTMLElement} */ (x).hidden = true; });
          fil.querySelectorAll('[data-msg-vig-menu]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
          pop.hidden = !ouvrir; b.setAttribute('aria-expanded', String(ouvrir));
        };
      });
      fil.querySelectorAll('[data-msg-saisir-lot]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => { if (o.saisirLot) o.saisirLot(String(/** @type {HTMLElement} */ (n).dataset.msgSaisirLot).split(',')); };
      });
      fil.querySelectorAll('[data-msg-revision]').forEach((n) => { if (o.revision) /** @type {HTMLElement} */ (n).onclick = o.revision; });
      // (1.180.0) Imputer : la fenêtre de l'écran (la contrepartie, le jour, le libellé) ; fait, le fil se relit.
      fil.querySelectorAll('[data-msg-imputer]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        const q = [...(lu.questions || []), ...anciennesQuestions].find((x) => x.id === b.dataset.msgImputer);
        if (q && o.imputer) { const imputer = o.imputer; b.onclick = () => { imputer(q, async () => { await relire(); if (o.surAttente) o.surAttente(lu && lu.attente); }); }; }
      });
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
      surClic(fil, '[data-msg-joindre-achat]', async (b) => {
        const m = [...(lu.messages || []), ...anciensMessages].find((x) => x.id === b.dataset.msgJoindreAchat);
        if (!m || !m.fichier || !o.joindreAchat) return;
        const f = await o.appel('GET', `/messages/fichiers/${encodeURIComponent(m.fichier.id)}`);
        const libelle = await o.joindreAchat({ id: m.id, nom: f.nom, type: f.type, contenu: f.contenu }, String(b.dataset.msgAchat));
        if (o.toast) o.toast(`« ${f.nom} » est jointe à l'achat ${libelle} ; ton cabinet la garde aussi dans ce fil.`);
        await relire();
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
      // « Envoyer » suit ce qui est joint (gris sans rien à envoyer).
      const f = z.closest('form');
      if (f) setTimeout(() => f.dispatchEvent(new Event('input')), 0);
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
      // (1.181.0) Le champ part d'une ligne et grandit avec ce qu'on écrit, jusqu'à six lignes ; au-delà, il défile.
      const grandir = () => { texte.style.height = 'auto'; texte.style.height = `${Math.min(texte.scrollHeight + 2, 150)}px`; };
      texte.addEventListener('input', grandir);
      form.addEventListener('reset', () => setTimeout(grandir, 0));
      demandeTxt.addEventListener('input', () => dire(''));
      const bEnvoyer = /** @type {HTMLElement} */ (form.querySelector('[data-msg-envoyer]'));
      const majEnvoyer = () => bEnvoyer.classList.toggle('vide', modeNote ? !texte.value.trim() : !texte.value.trim() && !fichier && !piece && !(demande && lesDemandes().length));
      form.addEventListener('input', majEnvoyer);
      majEnvoyer();
      const sugg = /** @type {HTMLElement} */ (form.querySelector('[data-msg-sugg]'));
      const propose = o.suggestions && !entreprise ? o.suggestions().slice(0, 3) : [];
      sugg.hidden = !propose.length;
      sugg.innerHTML = propose.length ? `<span class="msg-sugg-t">${dessin('modele')}D'après le dossier</span>${propose.map((x, i) => `<button type="button" class="msg-sugg-c" data-msg-sugg-i="${i}" title="${esc(x.sous)}"><b>${esc(x.titre)}</b><small>${esc(x.sous)}</small></button>`).join('')}` : '';
      sugg.querySelectorAll('[data-msg-sugg-i]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          const x = propose[Number(/** @type {HTMLElement} */ (n).dataset.msgSuggI)];
          if (!x) return;
          texte.value = x.texte; dire(''); majEnvoyer(); grandir(); texte.focus(); texte.setSelectionRange(texte.value.length, texte.value.length);
        };
      });
      const montrerDemande = () => {
        champDemande.hidden = !demande;
        const b = form.querySelector('[data-msg-demander]');
        if (b) b.setAttribute('aria-pressed', String(demande));
      };
      montrerDemande();
      // (1.125.0) Une demande préparée ailleurs (une ligne du livre du cabinet) arrive avec sa pièce déjà écrite.
      if (demande && o.demandeTexte && !demandeTxt.value) demandeTxt.value = o.demandeTexte;
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
      if (piece) dessinerJoints();
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
        texte.value = `${avant}${pose}${apres}`; grandir();
        texte.setSelectionRange(avant.length + pose.length, avant.length + pose.length);
        dire('');
        texte.focus();
      } });
      // Entrée envoie ; Maj+Entrée va à la ligne. Au téléphone (doigt), Entrée va à la ligne : on envoie du bouton.
      texte.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
      };
      const envoyer = /** @type {HTMLButtonElement} */ (form.querySelector('[data-msg-envoyer]'));
      // (1.177.0) « Note pour l'équipe » : le même champ, en jaune ; « Noter » la range dans le dossier, le client ne la
      // lit jamais. Le texte commencé passe d'un onglet à l'autre ; ce qui s'ajoute à un message (fichier, pièce,
      // demande) attend son retour.
      const placeMessage = texte.placeholder;
      const poserOnglet = (/** @type {boolean} */ note) => {
        modeNote = note;
        form.classList.toggle('note', note);
        form.querySelectorAll('[data-msg-onglet]').forEach((b) => b.setAttribute('aria-selected', String((/** @type {HTMLElement} */ (b).dataset.msgOnglet === 'note') === note)));
        form.querySelectorAll('.msg-gestes-g button').forEach((b) => { /** @type {HTMLButtonElement} */ (b).disabled = note; });
        const mot = form.querySelector('[data-msg-envoyer-mot]');
        if (mot) mot.textContent = note ? 'Noter' : 'Envoyer';
        const pied = /** @type {HTMLElement | null} */ (form.querySelector('[data-msg-note-pied]'));
        if (pied) pied.hidden = !note;
        const voir = /** @type {HTMLButtonElement | null} */ (form.querySelector('[data-msg-voir-notes]'));
        if (voir) { voir.hidden = !notes.length; voir.textContent = `Voir les ${pl(notes.length, 'note')}`; voir.onclick = () => voirNotes(); }
        texte.placeholder = note ? 'Une note que seule l\'équipe lit' : placeMessage;
        if (note) { demande = false; montrerDemande(); }
        const joints = /** @type {HTMLElement} */ (form.querySelector('[data-msg-joints]'));
        joints.hidden = note || (!fichier && !piece);
        majEnvoyer();
        sugg.hidden = note || !propose.length;
        dire('');
      };
      form.querySelectorAll('[data-msg-onglet]').forEach((b) => {
        /** @type {HTMLElement} */ (b).onclick = () => { poserOnglet(/** @type {HTMLElement} */ (b).dataset.msgOnglet === 'note'); texte.focus(); };
      });
      if (modeNote) poserOnglet(true);
      // (1.179.0, maquette « Messages », lot 4) Sans réseau, la conversation se lit, écrire attend : le champ le dit
      // (« Écrire revient avec le réseau »), ses gestes se grisent ; le réseau revenu, tout se rouvre tel quel (le
      // brouillon reste dans le champ).
      const majReseau = () => {
        if (!form.isConnected) { window.removeEventListener('offline', majReseau); window.removeEventListener('online', majReseau); return; }
        const off = navigator.onLine === false;
        if (off === form.classList.contains('off')) return;
        form.classList.toggle('off', off);
        texte.disabled = off;
        envoyer.disabled = off;
        form.querySelectorAll('[data-msg-onglet], .msg-gestes-g button, .msg-sugg button').forEach((b) => { /** @type {HTMLButtonElement} */ (b).disabled = off; });
        el.querySelectorAll('[data-msg-traite]').forEach((b) => { /** @type {HTMLButtonElement} */ (b).disabled = off; });
        if (off) texte.placeholder = 'Écrire revient avec le réseau';
        else poserOnglet(modeNote);
      };
      window.addEventListener('offline', majReseau);
      window.addEventListener('online', majReseau);
      majReseau();
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const t = texte.value.trim();
        if (modeNote && o.suivi) {
          if (!t) { dire('Une note vide n\'apprend rien à l\'équipe : écris ce qu\'il faut savoir, puis « Noter ».'); texte.focus(); return; }
          envoyer.disabled = true;
          dire('');
          try {
            await o.suivi.noter(t);
            texte.value = ''; texte.style.height = ''; majEnvoyer();
            await relire();
            const fil = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-fil]'));
            if (fil) fil.scrollTop = fil.scrollHeight;
            if (o.toast) o.toast('Noté pour l\'équipe : le client ne la lit pas.');
            texte.focus();
          } catch (x) { dire(motif(x)); texte.focus(); } finally { envoyer.disabled = false; }
          return;
        }
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
          texte.value = ''; texte.style.height = ''; demandeTxt.value = ''; piece = null; fichier = null; demande = false;
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
    window.addEventListener('online', auRetour);
    function arreter() { fini = true; clearInterval(minuterie); document.removeEventListener('visibilitychange', auRetour); window.removeEventListener('online', auRetour); }
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
   *   surCompteurs?: (c: { aTraiter: number, attendClient: number, tout: number }, vus: any[], tous: any[]) => void,
   *   portee?: () => string, changerPortee?: (v: string) => void, dansPortee?: (entreprise: string) => boolean, info?: string,
   *   ligne?: (entreprise: string) => { mois?: { texte: string, ton?: string }, puces?: { texte: string, ton?: string }[], suivi?: string, couleur?: string[] } | null,
   *   suggestions?: (entreprise: string) => { titre: string, sous: string, texte: string }[], saisirLot?: (entreprise: string, messages: string[]) => void, prenom?: (entreprise: string) => string,
   *   resume?: (ds: any[]) => { cle: string, texte: string, ton: string, ids: string[], dessin?: string }[],
   *   aCote?: (entreprise: string) => string, brancherCote?: (el: HTMLElement, entreprise: string) => void,
   *   contact?: (entreprise: string) => string | null, menu?: (entreprise: string) => { texte: string, sous?: string, faire: () => void }[],
   *   vide?: () => string,
   *   brancherVide?: (el: HTMLElement) => void, toastAnnuler?: (texte: string, annuler: () => void) => void,
   *   groupe?: () => ({ titre: string, geste: string, ids: string[], pieces?: string[] } | null), raison?: (entreprise: string) => string,
   *   prochaineDate?: () => string | null, tenus?: () => { id: string, nom: string, couleur?: [string, string] | null }[],
   *   panneauTenu?: (id: string) => string, brancherTenu?: (el: HTMLElement, id: string) => void, ouvrirTenu?: (id: string) => void,
   *   surEtat?: (etat: string) => void, enAttendant?: { texte: string, aller: () => void },
   *   imputer?: (entreprise: string, question: any, apres: () => Promise<void>) => void,
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
    const ETATS = /** @type {Record<string, [string, string]>} */ ({ a_traiter: ['À traiter', 'traiter'], attend_client: ['Attend le client', 'client'], plus_tard: ['Plus tard', 'tard'], rien: ['Rien à faire', 'rien'] });
    /** @param {string} etat */
    const etatDit = (etat) => (ETATS[etat] || ['', '']);
    /** @param {any} d */
    const extrait = (d) => {
      // (1.178.0) Une promesse qui compte se lit avant le dernier message : c'est ce qu'on attend.
      if (d.promesse && !d.promesse.echue && d.etat === 'attend_client') return `Promis pour ${jourLong(d.promesse.pour)}`;
      const x = d.dernier;
      if (!x) return 'Aucun échange encore.';
      const qui = x.cote === 'cabinet' ? (x.sorte === 'question' ? 'Question envoyée' : x.sorte === 'demande' ? 'Pièce demandée' : 'Toi') : (x.sorte === 'reponse' ? 'Réponse du client' : String(x.auteur || '').split(' ')[0] || 'Le client');
      const quoi = x.sorte === 'fichier' ? `a envoyé « ${x.extrait} »` : x.extrait;
      return x.sorte === 'fichier' ? `${qui} ${quoi}` : `${qui} : ${quoi}`;
    };
    // (1.176.0, maquette « Messages » de Mon cabinet) Trois colonnes, comme les outils des cabinets : la liste des clients
    // (ouverte sur ceux qui attendent ta réponse), la conversation du client choisi, et son dossier à côté (où en est son
    // mois, ce qu'on attend de lui, ce qu'il faut savoir avant de répondre). L'en-tête de la page (le titre, sa phrase,
    // « Écrire à plusieurs clients… ») est celui de l'écran qui pose la boîte ; il lit les compteurs par `surCompteurs`.
    // La portée (« Mes dossiers » ou « Tout le cabinet ») est celle de la barre (`o.portee`) : un seul réglage.
    /** @type {string | null} */ let resume = null; // le chiffre du résumé du cabinet qui filtre (« 2 pièces en retard »…)
    const portee = () => (o.portee ? o.portee() : 'mes');
    /** @param {string} id */
    const dansPortee = (id) => (o.dansPortee ? o.dansPortee(id) : true);
    function poser() {
      el.innerHTML = `<div class="msg-hors" data-msg-hors role="status" hidden></div><div class="msg-boite${aCote() ? ' msg-boite-a-cote' : ''}"><div class="msg-boite-corps" data-boite-corps></div></div>`;
      majHors();
      ajuster();
    }
    // (1.181.0) La boîte à trois colonnes va jusqu'au bas de l'écran (`jusquEnBas`) : une hauteur devinée laissait une
    // bande vide sous elle, et la conversation n'avait que 300 points.
    const ajuster = () => {
      const c = /** @type {HTMLElement | null} */ (el.querySelector('.msg-boite-a-cote .msg-boite-corps'));
      if (c) caler(el, () => jusquEnBas(c, 520));
    };
    // (1.179.0, maquette « Messages », lot 4) Les états de la page. Pendant la lecture, la page a déjà sa forme (la liste,
    // la conversation, le dossier à côté, en gris qui luit) ; la lecture refusée la fige et pose dessus ce qui s'est passé,
    // « Réessayer maintenant » (la boîte réessaie seule toutes les 30 secondes) et de quoi travailler en attendant.
    /** @param {boolean} fige */
    const squelette = (fige) => {
      const l = Array.from({ length: 6 }, (_, i) => `<span class="msg-sq-l"><i class="r"></i><span><i style="width:${60 + (i * 13) % 30}%"></i><i style="width:${40 + (i * 17) % 40}%"></i></span></span>`).join('');
      const b = [['g', 58], ['g', 42], ['d', 50], ['g', 64]].map(([c, w]) => `<span class="msg-sq-b ${c}" style="width:${w}%"></span>`).join('');
      return `<div class="msg-boite${aCote() ? ' msg-boite-a-cote' : ''} msg-sq${fige ? ' msg-fige' : ''}" aria-hidden="true"><div class="msg-boite-corps">
        <section class="msg-zone msg-liste"><span class="msg-sq-tete"><i class="msg-sq-c"></i></span>${l}</section>
        ${aCote() ? `<div class="msg-boite-conv"><span class="msg-sq-ft"><i class="r"></i><span><i style="width:180px"></i><i style="width:120px"></i></span></span><span class="msg-sq-fil">${b}</span><i class="msg-sq-c msg-sq-champ"></i></div>
        <aside class="msg-dossier-cote"><i class="msg-sq-c msg-sq-carte"></i><i class="msg-sq-c msg-sq-carte"></i></aside>` : ''}</div></div>`;
    };
    /** @type {string} */ let etatPage = '';
    /** @param {string} e */
    const direEtat = (e) => { if (e !== etatPage) { etatPage = e; if (o.surEtat) o.surEtat(e); } };
    // Hors ligne : la boîte telle qu'elle était à sa dernière lecture, une bande le dit ; écrire attend le réseau.
    /** @type {string | null} */ let luA = null;
    let hors = false;
    function majHors() {
      const b = /** @type {HTMLElement | null} */ (el.querySelector('[data-msg-hors]'));
      if (!b) return;
      b.hidden = !hors;
      b.innerHTML = hors ? `${dessin('nuage')}<span><b>Hors ligne</b> · tes conversations telles qu'elles étaient${luA ? ` à ${esc(heure(luA).replace(':', ' h '))}` : ''} ; écrire revient avec le réseau</span><span class="msg-hors-d"><i class="msg-pouls"></i>se reconnecte tout seul</span>` : '';
      direEtat(hors ? 'hors' : 'pret');
    }
    /** @param {any[]} ds */
    const compter = (ds) => ({ aTraiter: ds.filter((d) => d.etat === 'a_traiter').length, attendClient: ds.filter((d) => d.etat === 'attend_client').length, tout: ds.length });
    function dessiner() {
      if (!el.querySelector('[data-boite-corps]')) poser();
      // La hauteur se reprend à chaque dessin, l'en-tête de la page posé (sa phrase change la place qu'il prend).
      requestAnimationFrame(ajuster);
      const tous = /** @type {any[]} */ (lu.dossiers);
      const ds = tous.filter((d) => dansPortee(d.entreprise));
      const c = compter(ds);
      if (o.surCompteurs) o.surCompteurs(c, ds, tous);
      if (!filtre) filtre = c.aTraiter ? 'a_traiter' : c.attendClient ? 'attend_client' : 'tout';
      if (choisi && !choisi.startsWith('tenu:') && !ds.some((d) => d.entreprise === choisi)) choisi = null;
      // (1.115.0) Le client choisi reste dans la liste même s'il en sort (« Marquer comme traité », une réponse) : la
      // conversation qu'on lit ne disparaît pas sous le curseur. Un autre filtre, un autre client : il la quitte.
      const res = resume && o.resume ? o.resume(ds).find((x) => x.cle === resume) : null;
      if (resume && !res) resume = null;
      const vus = cherche
        ? ds.filter((d) => plier(d.nom).includes(plier(cherche)))
        : res ? ds.filter((d) => res.ids.includes(d.entreprise))
          : ds.filter((d) => filtre === 'tout' || d.etat === filtre || d.entreprise === choisi);
      if (!choisi && aCote() && vus[0]) choisi = vus[0].entreprise;
      if (choisi && choisi.startsWith('tenu:') && !(o.tenus ? o.tenus() : []).some((x) => `tenu:${x.id}` === choisi)) choisi = null;
      const corps = /** @type {HTMLElement} */ (el.querySelector('[data-boite-corps]'));
      if (!tous.length) {
        fermer();
        corps.innerHTML = o.vide ? o.vide() : '<div class="msg-vide"><b>Aucun client en ligne pour l\'instant.</b><span>La messagerie s\'ouvre avec chaque client qui t\'a confié son dossier dans SkanFact. Les dossiers que tu tiens seul au cabinet n\'en ont pas.</span></div>';
        // (1.178.0) Le cabinet neuf : la page dessinée par l'écran (le code, inviter, les modèles, un aperçu) a ses gestes.
        if (o.brancherVide) o.brancherVide(corps);
        return;
      }
      if (!corps.querySelector('[data-liste]')) {
        corps.innerHTML = `<section class="msg-zone msg-liste" aria-label="Les conversations">
            <div class="msg-liste-tete"><span class="msg-portee" data-portee></span><span class="msg-liste-n" data-liste-n></span></div>
            <div class="msg-liste-chercher"><span class="msg-liste-champ">${dessin('loupe')}<input type="search" maxlength="100" placeholder="Chercher un client" aria-label="Chercher un client" data-boite-q></span></div>
            <div class="msg-resume" data-resume hidden></div>
            <div class="msg-filtres" role="tablist" aria-label="Quels clients" data-filtres></div>
            <div class="msg-liste-l" data-liste></div>
            <p class="msg-clavier" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> d'un client à l'autre · <kbd>E</kbd> marquer traité</p></section>${aCote()
          ? '<div class="msg-boite-conv" data-conv></div><aside class="msg-dossier-cote" data-cote aria-label="Le dossier"></aside>' : ''}`;
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
      // La portée : « Mes dossiers » ou « Tout le cabinet » (la direction choisit ; un collaborateur ne voit que les siens).
      const po = /** @type {HTMLElement} */ (corps.querySelector('[data-portee]'));
      po.innerHTML = o.changerPortee
        ? `<label class="msg-portee-choix"><span class="msg-cache">Quels dossiers</span><select data-portee-choix><option value="mes"${portee() === 'mes' ? ' selected' : ''}>Mes dossiers</option><option value="tout"${portee() === 'tout' ? ' selected' : ''}>Tout le cabinet</option></select></label>${o.info ? o.info : ''}`
        : `<b>Mes dossiers</b>${o.info ? o.info : ''}`;
      const choix = /** @type {HTMLSelectElement | null} */ (po.querySelector('[data-portee-choix]'));
      if (choix && o.changerPortee) { const changer = o.changerPortee; choix.onchange = () => { resume = null; filtre = null; choisi = null; changer(choix.value); dessiner(); }; }
      /** @type {HTMLElement} */ (corps.querySelector('[data-liste-n]')).textContent = pl(ds.length, 'conversation');
      // Le cabinet en un coup d'œil (Tout le cabinet) : chaque chiffre filtre la liste.
      const rz = /** @type {HTMLElement} */ (corps.querySelector('[data-resume]'));
      const chiffres = portee() === 'tout' && o.resume ? o.resume(ds).filter((x) => x.ids.length) : [];
      rz.hidden = !chiffres.length;
      rz.innerHTML = chiffres.map((x) => `<button type="button" class="msg-resume-c ${esc(x.ton)}" data-resume-c="${esc(x.cle)}" aria-pressed="${resume === x.cle}">${x.dessin ? x.dessin : ''}${esc(x.texte)}</button>`).join('');
      rz.querySelectorAll('[data-resume-c]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => { const k = String(/** @type {HTMLElement} */ (n).dataset.resumeC); resume = resume === k ? null : k; choisi = null; dessiner(); };
      });
      const F = [['a_traiter', 'À traiter', c.aTraiter], ['attend_client', 'Attend le client', c.attendClient], ['tout', 'Tout', c.tout]];
      const filtres = /** @type {HTMLElement} */ (corps.querySelector('[data-filtres]'));
      filtres.innerHTML = F.map(([id, nom, n]) => `<button type="button" role="tab" class="msg-filtre" aria-selected="${!cherche && !resume && filtre === id}" data-filtre="${id}">${esc(nom)}<span class="msg-filtre-n${id === 'a_traiter' && n ? ' plein' : ''}">${n}</span></button>`).join('');
      filtres.querySelectorAll('[data-filtre]').forEach((n) => {
        /** @type {HTMLElement} */ (n).onclick = () => {
          filtre = String(/** @type {HTMLElement} */ (n).dataset.filtre); choisi = null; resume = null;
          cherche = '';
          const q = /** @type {HTMLInputElement | null} */ (el.querySelector('[data-boite-q]'));
          if (q) q.value = '';
          dessiner();
        };
      });
      const liste = /** @type {HTMLElement} */ (corps.querySelector('[data-liste]'));
      const avaitLeFocus = liste.contains(document.activeElement);
      // (1.178.0, maquette « Messages ») Rien n'attend ta réponse : la carte le dit, avec la prochaine date et le geste du
      // mois (demander les pièces du mois à ceux qui doivent l'envoyer).
      const calme = !cherche && !resume && !c.aTraiter && (filtre === 'tout' || filtre === 'a_traiter');
      const prochaine = calme && o.prochaineDate ? o.prochaineDate() : null;
      const geste = calme && o.groupe ? o.groupe() : null;
      const carteCalme = calme ? `<div class="msg-calme" data-msg-calme><span class="msg-calme-ic">${dessin('coche')}</span><b>Tout le monde a sa réponse</b>
          <span>${c.attendClient ? `Aucun client n'attend ta réponse ; ${esc(pl(c.attendClient, 'client doit', 'clients doivent'))} une pièce ou une réponse.` : 'Aucune pièce attendue, aucune question ouverte.'}${prochaine ? ` Prochaine date : ${esc(prochaine)}.` : ''}</span>
          ${geste && geste.ids.length ? `<button type="button" class="btn btn-sm" data-msg-calme-geste>${dessin('equipe')}${esc(geste.geste)}</button>` : ''}
          ${filtre === 'a_traiter' && c.attendClient ? '<button type="button" class="msg-lien" data-vers-filtre="attend_client">Voir ceux qui doivent une réponse</button>' : ''}</div>` : '';
      // Les dossiers tenus au cabinet, sans SkanFact : pas de conversation, l'invitation (dans « Tout »).
      const tenus = !cherche && !resume && filtre === 'tout' && o.tenus ? o.tenus() : [];
      const listeTenus = tenus.length ? `<p class="msg-tenus-t">Sans SkanFact · ${esc(pl(tenus.length, 'dossier tenu', 'dossiers tenus'))}</p>${tenus.map((x) => `<button type="button" class="msg-dossier msg-tenu${choisi === `tenu:${x.id}` ? ' choisi' : ''}" data-dossier="tenu:${esc(x.id)}" aria-current="${choisi === `tenu:${x.id}`}">
          <span class="msg-avatar petit${x.couleur ? ' carre' : ''}"${x.couleur ? ` style="background:linear-gradient(145deg, ${esc(x.couleur[0])}, ${esc(x.couleur[1])})"` : ''} aria-hidden="true">${esc(initiales(x.nom))}</span>
          <span class="msg-dossier-txt"><span class="msg-dossier-l1"><b>${esc(x.nom)}</b></span><span class="msg-extrait">pas de conversation : l'inviter sur SkanFact</span></span></button>`).join('')}` : '';
      liste.innerHTML = carteCalme + (vus.length ? vus.map((x) => {
        // La ligne parle du mois du client (« sept. prête », « 1 mois en retard ») et de qui suit le dossier.
        const L = o.ligne ? o.ligne(x.entreprise) : null;
        const puces = [L && L.mois ? `<span class="msg-mois ${esc(L.mois.ton || '')}">${esc(L.mois.texte)}</span>` : '',
          ...(L && L.puces ? L.puces.map((/** @type {any} */ p) => `<span class="msg-puce ${esc(p.ton || '')}">${esc(p.texte)}</span>`) : []),
          x.retards ? `<span class="msg-puce rouge" title="${esc(pl(x.retards, 'pièce demandée passée sa date', 'pièces demandées passées leur date'))}">${esc(pl(x.retards, 'pièce en retard', 'pièces en retard'))}</span>` : '',
          // (1.178.0) La promesse du client et mon rappel.
          x.promesse ? (x.promesse.echue ? `<span class="msg-puce rouge" title="${esc(`Promis pour ${jourLong(x.promesse.pour)} : rien n'est arrivé`)}">promesse passée</span>`
            : `<span class="msg-puce promis" title="${esc(`${x.promesse.quoi}, promis pour ${jourLong(x.promesse.pour)}`)}">${dessin('reveil')}promis ${esc(jourCourt(x.promesse.pour))}</span>`) : '',
          x.rappel ? `<span class="msg-puce tard" title="${esc(`Tu as demandé de la revoir ${jourLong(x.rappel)}`)}">${dessin('reveil')}revient ${esc(jourCourt(x.rappel))}</span>` : '',
          portee() === 'tout' && L && L.suivi ? `<span class="msg-suivi">${esc(L.suivi)}</span>` : ''].filter(Boolean).join('');
        // (1.179.0, maquette « Messages », lot 4) Traiter sans ouvrir : une conversation « À traiter » a ses deux gestes,
        // « Demain » (me la remontrer demain) et « Traité » ; à l'ordinateur ils paraissent au survol, au téléphone la ligne
        // glisse vers la gauche et les découvre. Au clavier : E sur la ligne, et le menu ⋯ de la conversation.
        const gestes = x.etat === 'a_traiter' && o.cabinet ? `<span class="msg-gl-a"><button type="button" class="msg-gl-d" tabindex="-1" data-gl-demain aria-label="Demain" title="${esc(`Me la remontrer ${jourLong(dansJours(1))}`)}">${dessin('reveil')}<span>Demain</span></button><button type="button" class="msg-gl-t" tabindex="-1" data-gl-traite aria-label="Traité" title="Marquer comme traité : elle quitte « À traiter »">${dessin('coche')}<span>Traité</span></button></span>` : '';
        return `${gestes ? `<div class="msg-gl" data-gl="${esc(x.entreprise)}">` : ''}<button type="button" class="msg-dossier${x.entreprise === choisi ? ' choisi' : ''}${x.nonLus ? ' non-lu' : ''}" data-dossier="${esc(x.entreprise)}" aria-current="${x.entreprise === choisi}">
          <span class="msg-avatar petit${L && L.couleur ? ' carre' : ''}"${L && L.couleur ? ` style="background:linear-gradient(145deg, ${esc(L.couleur[0])}, ${esc(L.couleur[1])})"` : ''} aria-hidden="true">${esc(initiales(x.nom))}</span>
          <span class="msg-dossier-txt"><span class="msg-dossier-l1"><b>${esc(x.nom)}</b>${x.dernier ? `<span class="msg-quand">${esc(quandCourt(x.dernier.quand))}</span>` : ''}</span>
            <span class="msg-extrait">${esc(extrait(x))}</span>${puces ? `<span class="msg-dossier-l3">${puces}</span>` : ''}</span>
          <span class="msg-dossier-pastilles">${x.nonLus ? `<span class="msg-non-lus" title="${esc(pl(x.nonLus, 'nouveau message', 'nouveaux messages'))}">${x.nonLus}<span class="msg-cache"> ${x.nonLus > 1 ? 'nouveaux messages' : 'nouveau message'}</span></span>` : ''}
          ${x.nonLus || x.etat !== 'attend_client' || (x.promesse && !x.promesse.echue) ? '' : `<span class="msg-etat-pastille ${etatDit(x.etat)[1]}">${esc(etatDit(x.etat)[0])}</span>`}</span></button>${gestes ? `${gestes}</div>` : ''}`;
      }).join('')
        : cherche ? `<div class="msg-vide"><b>Aucun client ne s'appelle « ${esc(cherche)} ».</b><span>La recherche lit le nom de chaque client en ligne, quel que soit le filtre.</span></div>`
        : filtre === 'a_traiter' ? ''
        // (1.182.0) Vide, la liste dit pourquoi c'est une bonne nouvelle, et où est le travail.
        : `<div class="msg-calme msg-calme-attend"><span class="msg-calme-ic">${dessin('coche')}</span><b>Aucun client ne doit de réponse.</b>
            <span>Toutes tes questions et les pièces demandées ont leur réponse.${c.aTraiter ? '' : ' Rien n\'attend la tienne non plus.'}</span>
            ${c.aTraiter ? `<button type="button" class="btn btn-sm" data-vers-filtre="a_traiter">Voir ${c.aTraiter > 1 ? `les ${c.aTraiter} conversations` : 'la conversation'} à traiter</button>` : ''}</div>`) + listeTenus;
      const gc = liste.querySelector('[data-msg-calme-geste]');
      if (gc && geste) /** @type {HTMLElement} */ (gc).onclick = () => ecrireAPlusieurs('pieces');
      const vers = liste.querySelector('[data-vers-filtre]');
      if (vers) /** @type {HTMLElement} */ (vers).onclick = () => { filtre = String(/** @type {HTMLElement} */ (vers).dataset.versFiltre); dessiner(); };
      const lignes = /** @type {HTMLElement[]} */ ([...liste.querySelectorAll('[data-dossier]')]);
      liste.querySelectorAll('[data-gl]').forEach((n) => {
        const g = /** @type {HTMLElement} */ (n);
        const id = String(g.dataset.gl);
        /** @type {HTMLElement} */ (g.querySelector('[data-gl-demain]')).onclick = (e) => { e.stopPropagation(); g.classList.remove('ouvert'); void remontrerDemain(id); };
        /** @type {HTMLElement} */ (g.querySelector('[data-gl-traite]')).onclick = (e) => { e.stopPropagation(); g.classList.remove('ouvert'); void marquerTraite(id); };
        glisser(g, /** @type {HTMLElement} */ (g.querySelector('[data-dossier]')));
      });
      lignes.forEach((b, i) => {
        b.onclick = () => {
          // Une ligne qu'on vient de faire glisser ne s'ouvre pas ; ouverte (ses gestes découverts), un toucher la referme.
          if (b.dataset.glBouge) return;
          const g = b.closest('.msg-gl');
          if (g && g.classList.contains('ouvert')) { g.classList.remove('ouvert'); return; }
          choisir(String(b.dataset.dossier));
        };
        // ↑ et ↓ passent d'un client à l'autre, comme dans toute messagerie ; E marque traité le client choisi.
        b.onkeydown = (e) => {
          if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void marquerTraite(String(b.dataset.dossier)); return; }
          const v = e.key === 'ArrowDown' ? lignes[i + 1] : e.key === 'ArrowUp' ? lignes[i - 1] : null;
          if (!v) return;
          e.preventDefault();
          v.focus();
          choisir(String(v.dataset.dossier));
        };
      });
      if (avaitLeFocus) {
        const b = lignes.find((x) => x.dataset.dossier === choisi);
        if (b) b.focus();
      }
      ouvrirAcote();
    }
    // « Marquer comme traité » (le bouton de la conversation, ou E sur une ligne) : le client quitte « À traiter » jusqu'à
    // son prochain message. Un client qui n'y est pas : rien ne part, la ligne le dit.
    /** @param {string} id */
    async function marquerTraite(id) {
      const d = lu && lu.dossiers.find((/** @type {any} */ x) => x.entreprise === id);
      if (!d || d.etat !== 'a_traiter') { if (o.toast) o.toast(`${d ? d.nom : 'Ce client'} n'attend pas de réponse : rien à marquer.`); return; }
      try {
        await o.appel('POST', `/entreprises/${encodeURIComponent(id)}/messages/traite`);
        if (o.toast) o.toast(`C'est noté : ${d.nom} quitte « À traiter » jusqu'à son prochain message.`);
        if (ouverte && ouverte.entreprise === id) await ouverte.c.relire();
        await lire();
      } catch (x) { if (o.toast) o.toast(motif(x), true); }
    }
    // (1.179.0) « Demain », depuis la ligne : la conversation quitte MON « À traiter » jusqu'à demain (le même rappel que
    // « Me le remontrer demain » du menu ⋯) ; « Annuler » la remet.
    /** @param {string} id */
    async function remontrerDemain(id) {
      const d = lu && lu.dossiers.find((/** @type {any} */ x) => x.entreprise === id);
      const le = dansJours(1);
      const chemin = `/cabinets/${encodeURIComponent(o.cabinet)}/rappels/${encodeURIComponent(id)}`;
      const relireTout = async () => { if (ouverte && ouverte.entreprise === id) await ouverte.c.relire(); await lire(); };
      try {
        await o.appel('PUT', chemin, { le });
        const dit = `La conversation de ${d ? d.nom : 'ce client'} revient ${jourLong(le)} : d'ici là, elle quitte ton « À traiter ».`;
        if (o.toastAnnuler) o.toastAnnuler(dit, () => { void o.appel('DELETE', chemin).then(relireTout).catch((/** @type {unknown} */ x) => { if (o.toast) o.toast(motif(x), true); }); });
        else if (o.toast) o.toast(dit);
        await relireTout();
      } catch (x) { if (o.toast) o.toast(motif(x), true); }
    }
    // Au téléphone, la ligne glisse vers la gauche (au doigt) et découvre ses deux gestes ; à moitié, elle revient.
    /** @param {HTMLElement} g @param {HTMLElement} ligne */
    function glisser(g, ligne) {
      const LARGEUR = 152;
      let x0 = 0, y0 = 0, dx = 0, actif = false, bouge = false, doigt = -1;
      ligne.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; actif = true; bouge = false; x0 = e.clientX; y0 = e.clientY; dx = g.classList.contains('ouvert') ? -LARGEUR : 0; doigt = e.pointerId; });
      ligne.addEventListener('pointermove', (e) => {
        if (!actif || e.pointerId !== doigt) return;
        const ddx = e.clientX - x0, ddy = e.clientY - y0;
        if (!bouge) {
          if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { actif = false; return; }
          if (Math.abs(ddx) < 10) return;
          bouge = true; g.classList.add('glisse');
        }
        dx = Math.max(-LARGEUR, Math.min(0, (g.classList.contains('ouvert') ? -LARGEUR : 0) + ddx));
        ligne.style.transform = `translateX(${dx}px)`;
      });
      const fin = () => {
        if (!actif) return;
        actif = false;
        if (!bouge) return;
        g.classList.remove('glisse');
        ligne.style.transform = '';
        const ouvrir = dx < -LARGEUR / 2;
        g.parentElement?.querySelectorAll('.msg-gl.ouvert').forEach((a) => { if (a !== g) a.classList.remove('ouvert'); });
        g.classList.toggle('ouvert', ouvrir);
        ligne.dataset.glBouge = '1';
        setTimeout(() => { delete ligne.dataset.glBouge; }, 0);
      };
      ligne.addEventListener('pointerup', fin);
      ligne.addEventListener('pointercancel', fin);
    }
    /** @param {string} id */
    function choisir(id) {
      if (id.startsWith('tenu:') && (!aCote() || !o.panneauTenu)) { if (o.ouvrirTenu) o.ouvrirTenu(id.slice(5)); return; }
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
    // La conversation du client choisi, au milieu ; son dossier à droite : la partie qui vient du livre (l'écran la donne,
    // `o.aCote`), puis ce qu'on attend de lui et l'alerte par e-mail (la conversation les remplit, `coteEl`).
    function ouvrirAcote() {
      const zone = /** @type {HTMLElement | null} */ (el.querySelector('[data-conv]'));
      const cote = /** @type {HTMLElement | null} */ (el.querySelector('[data-cote]'));
      if (!zone || !o.conversation) return;
      if (!choisi) {
        fermer();
        // (1.182.0) Rien de choisi : l'accueil de la boîte, avec la prochaine conversation à ouvrir et ce qu'elle contient.
        const tous = /** @type {any[]} */ ((lu && lu.dossiers) || []).filter((d) => dansPortee(d.entreprise));
        const aTraiter = tous.filter((d) => d.etat === 'a_traiter').sort((a, b) => ((a.dernier && a.dernier.quand) || '') < ((b.dernier && b.dernier.quand) || '') ? 1 : -1);
        const prochaine = aTraiter[0];
        zone.innerHTML = `<div class="msg-conv-accueil"><span class="msg-conv-accueil-ic">${dessin('message')}</span>
          <b>${prochaine ? `${aTraiter.length > 1 ? `${aTraiter.length} conversations attendent` : 'Une conversation attend'} ta réponse` : 'Tes clients t\'écrivent ici'}</b>
          <span>Choisis un client à gauche : sa conversation s'ouvre ici, entière — ses messages, tes questions de la révision, les pièces demandées, et les notes de l'équipe.</span>
          ${prochaine ? `<button type="button" class="btn btn-primary" data-conv-ouvrir="${esc(prochaine.entreprise)}">Ouvrir ${esc(prochaine.nom)}</button>
            <small>${esc(extrait(prochaine))}</small>` : ''}
          <span class="msg-conv-accueil-astuce"><kbd>↑</kbd><kbd>↓</kbd> d'un client à l'autre · <kbd>E</kbd> marquer traité</span></div>`;
        const ouvrir = /** @type {HTMLElement | null} */ (zone.querySelector('[data-conv-ouvrir]'));
        if (cote) cote.innerHTML = `<div class="msg-cote-accueil"><span>${dessin('piece')}</span><b>Le dossier du client</b><small>Son année mois par mois, ce qu'on attend de lui, ses pièces reçues : ici, dès que tu choisis sa conversation.</small></div>`;
        if (ouvrir) ouvrir.onclick = () => { const b = /** @type {HTMLElement | null} */ (el.querySelector(`[data-dossier="${CSS.escape(String(ouvrir.dataset.convOuvrir))}"]`)); if (b) b.click(); else { choisi = String(ouvrir.dataset.convOuvrir); filtre = 'tout'; dessiner(); } };
        return;
      }
      const corpsB = /** @type {HTMLElement | null} */ (el.querySelector('[data-boite-corps]'));
      if (choisi.startsWith('tenu:')) {
        fermer();
        const idT = choisi.slice(5);
        if (corpsB) corpsB.classList.add('tenu-ouvert');
        zone.innerHTML = `<div class="msg-tenu-panneau">${o.panneauTenu ? o.panneauTenu(idT) : ''}</div>`;
        if (cote) cote.innerHTML = '';
        if (o.brancherTenu) o.brancherTenu(zone, idT);
        return;
      }
      if (corpsB) corpsB.classList.remove('tenu-ouvert');
      if (ouverte && ouverte.entreprise === choisi) { if (cote && o.aCote) majCote(cote, choisi); return; }
      fermer();
      const id = choisi;
      const d = lu.dossiers.find((/** @type {any} */ x) => x.entreprise === id);
      zone.innerHTML = '<div data-conv-racine></div>';
      if (cote) cote.innerHTML = '<div data-cote-dossier></div><div data-cote-fil></div>';
      if (cote) majCote(cote, id);
      const revision = o.revision;
      ouverte = { entreprise: id, c: o.conversation(/** @type {HTMLElement} */ (zone.firstElementChild), id, {
        nom: d ? d.nom : 'Ce client',
        integre: true,
        contact: o.contact ? o.contact(id) : null,
        couleur: o.ligne ? ((o.ligne(id) || {}).couleur || null) : null,
        contactPrenom: o.prenom ? o.prenom(id) : undefined,
        suggestions: o.suggestions ? () => (o.suggestions ? o.suggestions(id) : []) : undefined,
        saisirLot: o.saisirLot ? (/** @type {string[]} */ ms) => { if (o.saisirLot) o.saisirLot(id, ms); } : undefined,
        coteEl: cote ? cote.querySelector('[data-cote-fil]') : null,
        menu: o.menu ? o.menu(id) : [],
        traiter: () => marquerTraite(id),
        enGrand: () => o.ouvrir(id),
        toast: o.toast,
        toastAnnuler: o.toastAnnuler,
        revision: revision ? () => revision(id) : undefined,
        imputer: o.imputer ? (/** @type {any} */ q, /** @type {() => Promise<void>} */ apres) => { if (o.imputer) o.imputer(id, q, apres); } : undefined,
        ouvrirPiece: o.ouvrirPiece ? (/** @type {string} */ g, /** @type {string} */ p, /** @type {string} */ l) => (o.ouvrirPiece ? o.ouvrirPiece(id, g, p, l) : false) : undefined,
        saisirPiece: o.saisirPiece ? (/** @type {any} */ m) => { if (o.saisirPiece) o.saisirPiece(id, m); } : undefined,
        // Ce que la conversation change (lu, traité, une réponse) se relit aussitôt dans la liste : elle se relit à chaque
        // lecture de la conversation (après un geste, et toutes les 30 secondes), une fois pour plusieurs appels rapprochés.
        surAttente: () => { clearTimeout(relecture); relecture = setTimeout(() => { void lire(); }, 250); },
      }) };
    }
    /** @param {HTMLElement} cote @param {string} id */
    function majCote(cote, id) {
      const z = /** @type {HTMLElement | null} */ (cote.querySelector('[data-cote-dossier]'));
      if (!z || !o.aCote) return;
      const html = o.aCote(id);
      if (z.dataset.html === html) return;
      z.dataset.html = html;
      z.innerHTML = html;
      if (o.brancherCote) o.brancherCote(z, id);
    }
    // (1.116.0) « Demander à plusieurs clients » (revue du 22/10/2026 : en fin de mois, la même demande à tous — les
    // relevés bancaires — se faisait client par client). (1.178.0, maquette « Messages ») « Écrire à plusieurs clients » :
    // un message, ou des pièces à envoyer (pour un jour, avec un mot facultatif) ; à gauche ce qui part, à droite à qui —
    // cochés d'avance ceux que le mois appelle (`o.groupe` : ceux qui n'ont pas envoyé septembre), sauf qui a promis ou a
    // déjà une demande en cours (décochés, la fenêtre dit pourquoi : à toi de voir). Chaque client le reçoit dans SON fil
    // (rien d'un client ne passe chez un autre) ; un client qui refuse n'arrête pas les autres : la fenêtre dit lesquels
    // l'ont reçu et lesquels non.
    /** @param {'message' | 'pieces'} [modeDepart] */
    function ecrireAPlusieurs(modeDepart) {
      const ds = /** @type {any[]} */ (lu.dossiers).filter((d) => dansPortee(d.entreprise));
      const groupe = o.groupe ? o.groupe() : null;
      let mode = modeDepart || (groupe && groupe.ids.length ? 'pieces' : 'message');
      // Les pièces proposées : celles du groupe (le mois qui manque), sinon une ligne vide.
      const proposees = groupe && groupe.pieces && groupe.pieces.length ? groupe.pieces : [];
      const dansGroupe = new Set(groupe ? groupe.ids : []);
      const ecarte = (/** @type {any} */ d) => (d.promesse && !d.promesse.echue ? `promis pour ${jourLong(d.promesse.pour)}` : d.attentes ? 'une demande déjà en cours' : '');
      const cochesDepart = new Set(ds.filter((d) => dansGroupe.has(d.entreprise) && !ecarte(d)).map((d) => d.entreprise));
      const ecartes = ds.filter((d) => dansGroupe.has(d.entreprise) && ecarte(d));
      let tous = !groupe || !groupe.ids.length;
      const vendredi = (() => { for (let n = 1; n <= 7; n++) { const j = dansJours(n); if (nomDuJour(j) === 'vendredi') return j; } return dansJours(2); })();
      const jours = [...new Set([vendredi, dansJours(7), dansJours(12)])].slice(0, 2);
      let pour = jours[0] || dansJours(7);
      const fond = document.createElement('div');
      fond.className = 'msg-fenetre-fond';
      fond.innerHTML = `<form class="msg-fenetre msg-plusieurs" role="dialog" aria-modal="true" aria-labelledby="msg-dg-titre" novalidate>
        <header class="msg-pl-tete"><span class="msg-pl-ic">${dessin('equipe')}</span><span><h2 id="msg-dg-titre">Écrire à plusieurs clients</h2>
          <small>Chacun reçoit le sien, dans sa conversation : aucun ne voit les autres.</small></span>
          <button type="button" class="msg-icone" data-fermer aria-label="Fermer">${dessin('croix')}</button></header>
        <div class="msg-pl-corps">
          <div class="msg-pl-quoi"><span class="msg-pl-t">Ce qui part</span>
            <div class="msg-pl-modes" role="radiogroup" aria-label="Ce qui part">
              <button type="button" role="radio" class="msg-pp-j" data-dg-mode="message">Un message</button>
              <button type="button" role="radio" class="msg-pp-j" data-dg-mode="pieces">Des pièces à envoyer</button></div>
            <div class="msg-pl-pieces" data-dg-pieces>
              <div class="msg-pl-liste" data-dg-liste>${(proposees.length ? proposees : ['']).map((x, i) => `<label class="msg-pl-piece"><input type="checkbox" ${x ? 'checked' : ''} data-dg-coche aria-label="Demander cette pièce"><input type="text" maxlength="300" value="${esc(x)}" placeholder="Par exemple : le relevé bancaire de septembre" data-dg-piece aria-label="Pièce demandée ${i + 1}"></label>`).join('')}</div>
              <button type="button" class="msg-lien" data-dg-plus>+ Une autre pièce</button>
              <span class="msg-pl-t">Pour le</span>
              <div class="msg-pp-jours" role="radiogroup" aria-label="Pour le" data-dg-jours></div>
              <p class="small muted">Sans réponse à cette date, chaque client reçoit un rappel par e-mail (une fois par semaine, trois au plus).</p></div>
            <span class="msg-dg-mot-tete"><label class="msg-pl-t" for="msg-dg-mot" data-dg-mot-titre>Le mot <span class="muted">(facultatif)</span></label>
              ${o.modeles ? '<button type="button" class="msg-lien" data-dg-modeles>Modèles</button>' : ''}</span>
            <textarea id="msg-dg-mot" rows="3" maxlength="4000" data-dg-mot></textarea>
            <span class="small muted">{client} devient le nom de chaque client.</span></div>
          <div class="msg-pl-qui"><span class="msg-pl-t">À qui${groupe && groupe.ids.length ? ` · ${esc(groupe.titre)}` : ''}</span>
            <div class="msg-pl-clients" data-dg-clients></div>
            <span class="msg-pl-qui-g"><button type="button" class="msg-lien" data-dg-autres></button></span>
            ${ecartes.length ? `<p class="msg-pl-note">${dessin('reveil')}<span>${esc(ecartes.map((d) => `${d.nom} ${d.promesse && !d.promesse.echue ? `a promis ses pièces pour ${nomDuJour(d.promesse.pour)}` : 'a déjà une demande en cours'}`).join(', et '))} : ${ecartes.length > 1 ? 'décochés' : 'décoché'}, à toi de voir.</span></p>` : ''}</div>
        </div>
        <footer class="msg-pl-pied"><span class="small muted" data-dg-resume></span><p class="msg-refus" role="alert" data-dg-refus></p>
          <span class="msg-pl-gestes"><button type="button" class="btn" data-fermer>Annuler</button><button type="submit" class="btn btn-primary" data-dg-envoyer>Envoyer</button></span></footer>
      </form>`;
      document.body.appendChild(fond);
      const form = /** @type {HTMLFormElement} */ (fond.querySelector('form'));
      const liste = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-liste]'));
      const refus = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-refus]'));
      const envoyer = /** @type {HTMLButtonElement} */ (fond.querySelector('[data-dg-envoyer]'));
      const mot = /** @type {HTMLTextAreaElement} */ (fond.querySelector('[data-dg-mot]'));
      const coches = new Set(cochesDepart);
      const raison = (/** @type {any} */ d) => ecarte(d) || (o.raison ? o.raison(d.entreprise) : '') || '';
      const lesPieces = () => [...liste.querySelectorAll('.msg-pl-piece')].filter((l) => /** @type {HTMLInputElement} */ (l.querySelector('[data-dg-coche]')).checked)
        .map((l) => /** @type {HTMLInputElement} */ (l.querySelector('[data-dg-piece]')).value.trim()).filter(Boolean);
      function dessinerQui() {
        const montres = tous ? ds : ds.filter((d) => dansGroupe.has(d.entreprise) || coches.has(d.entreprise));
        const z = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-clients]'));
        z.innerHTML = montres.map((d) => {
          const L = o.ligne ? o.ligne(d.entreprise) : null;
          return `<label class="msg-pl-client${coches.has(d.entreprise) ? ' coche' : ''}"><input type="checkbox" value="${esc(d.entreprise)}" ${coches.has(d.entreprise) ? 'checked' : ''} data-dg-client>
            <span class="msg-avatar petit${L && L.couleur ? ' carre' : ''}"${L && L.couleur ? ` style="background:linear-gradient(145deg, ${esc(L.couleur[0])}, ${esc(L.couleur[1])})"` : ''} aria-hidden="true">${esc(initiales(d.nom))}</span>
            <span><b>${esc(d.nom)}</b>${raison(d) ? `<small>${esc(raison(d))}</small>` : ''}</span></label>`;
        }).join('') || '<p class="small muted">Aucun client en ligne.</p>';
        z.querySelectorAll('[data-dg-client]').forEach((n) => {
          const c = /** @type {HTMLInputElement} */ (n);
          c.onchange = () => { if (c.checked) coches.add(c.value); else coches.delete(c.value); refus.textContent = ''; dessinerQui(); resumer(); };
        });
        const autres = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-autres]'));
        const reste = ds.length - montres.length;
        autres.textContent = tous ? (groupe && groupe.ids.length ? `Seulement ${groupe.titre}` : '') : reste ? `+ D'autres clients (${reste})` : '';
        autres.hidden = !autres.textContent;
      }
      function resumer() {
        const n = coches.size;
        const ps = lesPieces();
        /** @type {HTMLElement} */ (fond.querySelector('[data-dg-resume]')).textContent = !n ? 'Coche les clients à qui écrire.'
          : mode === 'pieces' ? `${pl(n, 'client')} · ${pl(ps.length, 'pièce')}${n > 1 ? ' chacun' : ''} · pour le ${jourLong(pour)}` : `${pl(n, 'client')} · un message chacun`;
        envoyer.textContent = n ? `Envoyer ${n > 1 ? `aux ${n} clients` : 'au client'}` : 'Envoyer';
      }
      function dessinerMode() {
        fond.querySelectorAll('[data-dg-mode]').forEach((b) => b.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (b).dataset.dgMode === mode)));
        /** @type {HTMLElement} */ (fond.querySelector('[data-dg-pieces]')).hidden = mode !== 'pieces';
        /** @type {HTMLElement} */ (fond.querySelector('[data-dg-mot-titre]')).innerHTML = mode === 'pieces' ? 'Le mot <span class="muted">(facultatif)</span>' : 'Le message';
        mot.placeholder = mode === 'pieces' ? `Bonjour {client}, pour déposer ${moisDavant()}, il me manque vos pièces. Merci de les envoyer ici.` : 'Bonjour {client}, …';
        const zj = /** @type {HTMLElement} */ (fond.querySelector('[data-dg-jours]'));
        const autre = !jours.includes(pour);
        zj.innerHTML = `${jours.map((j) => `<button type="button" role="radio" class="msg-pp-j" aria-checked="${j === pour}" data-dg-jour="${j}">${esc(jourCourt(j))}</button>`).join('')}
          <label class="msg-pp-j msg-pp-autre${autre ? ' choisi' : ''}"><span>${autre ? esc(jourCourt(pour)) : 'Choisir…'}</span><input type="date" min="${dansJours(0)}" value="${esc(pour)}" data-dg-pour aria-label="Un autre jour"></label>`;
        zj.querySelectorAll('[data-dg-jour]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { pour = String(/** @type {HTMLElement} */ (b).dataset.dgJour); dessinerMode(); }; });
        const d = /** @type {HTMLInputElement} */ (zj.querySelector('[data-dg-pour]'));
        d.onchange = () => { if (d.value) { pour = d.value; dessinerMode(); } };
        resumer();
      }
      fond.querySelectorAll('[data-dg-mode]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => { mode = /** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.dgMode); refus.textContent = ''; dessinerMode(); }; });
      /** @type {HTMLElement} */ (fond.querySelector('[data-dg-autres]')).onclick = () => { tous = !tous; dessinerQui(); };
      liste.addEventListener('input', resumer);
      liste.addEventListener('change', resumer);
      const fermer = () => { fond.remove(); document.removeEventListener('keydown', echap); };
      const echap = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') fermer(); };
      document.addEventListener('keydown', echap);
      fond.querySelectorAll('[data-fermer]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = fermer; });
      fond.onclick = (e) => { if (e.target === fond) fermer(); };
      const bModeles = /** @type {HTMLElement | null} */ (fond.querySelector('[data-dg-modeles]'));
      const modeles = o.modeles;
      if (bModeles && modeles) bModeles.onclick = () => fenetreModeles({ modeles, client: null, utiliser: (t) => {
        mot.value = mot.value.trim() ? `${mot.value.trimEnd()}\n${t}` : t;
        mot.focus();
      } });
      /** @type {HTMLElement} */ (fond.querySelector('[data-dg-plus]')).onclick = () => {
        const n = liste.querySelectorAll('[data-dg-piece]').length;
        if (n >= 10) { refus.textContent = 'Dix pièces au plus dans une demande.'; return; }
        const l = document.createElement('label');
        l.className = 'msg-pl-piece';
        l.innerHTML = `<input type="checkbox" checked data-dg-coche aria-label="Demander cette pièce"><input type="text" maxlength="300" data-dg-piece aria-label="Pièce demandée ${n + 1}">`;
        liste.appendChild(l); /** @type {HTMLElement} */ (l.querySelector('[data-dg-piece]')).focus();
        resumer();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const pieces = mode === 'pieces' ? lesPieces() : [];
        const clients = [...coches];
        const texteMot = mot.value.trim();
        if (mode === 'pieces' && !pieces.length) { refus.textContent = 'Nomme au moins une pièce (par exemple : le relevé bancaire de septembre).'; /** @type {HTMLElement} */ (liste.querySelector('[data-dg-piece]')).focus(); return; }
        if (mode === 'message' && !texteMot) { refus.textContent = 'Écris le message qui part à chacun, puis « Envoyer ».'; mot.focus(); return; }
        if (!clients.length) { refus.textContent = 'Coche au moins un client.'; return; }
        envoyer.disabled = true; refus.textContent = '';
        /** @type {string[]} */ const ratees = [];
        for (const c of clients) {
          try {
            // (1.117.0) {client} : le nom de chacun (un modèle pris pour tous).
            const texte = texteMot.replace(/\{client\}/g, (ds.find((d) => d.entreprise === c) || {}).nom || '');
            await o.appel('POST', `/entreprises/${encodeURIComponent(c)}/messages`, { cote: 'cabinet', texte,
              ...(mode === 'pieces' ? { pour, ...(pieces.length > 1 ? { demandes: pieces } : { demande: pieces[0] }) } : {}) });
            // Parti : la case se décoche (un second « Envoyer » ne le renverrait pas à ce client).
            coches.delete(c);
          } catch (x) { ratees.push(`${(ds.find((d) => d.entreprise === c) || {}).nom || 'un client'} (${motif(x)})`); }
        }
        envoyer.disabled = false;
        const parties = clients.length - ratees.length;
        if (ratees.length) {
          dessinerQui(); resumer();
          refus.textContent = `${parties ? `Envoyé à ${pl(parties, 'client')} (leur case est décochée). ` : ''}Pas envoyé à : ${ratees.join(' ; ')}.`;
          if (parties) { void lire(); if (ouverte) void ouverte.c.relire(); }
          return;
        }
        fermer();
        // La conversation ouverte à droite les montre aussitôt (elle ne se relisait qu'au tour suivant).
        if (ouverte) void ouverte.c.relire();
        if (o.toast) o.toast(`${mode === 'pieces' ? 'Demande envoyée' : 'Message envoyé'} à ${pl(parties, 'client')} : chacun le lit dans sa conversation.`);
        signature = '';
        void lire();
      };
      dessinerQui(); dessinerMode();
      const premier = /** @type {HTMLElement | null} */ (mode === 'pieces' ? fond.querySelector('[data-dg-piece]') : mot);
      if (premier) premier.focus();
    }
    async function lire() {
      if (fini) return;
      const cle = `boite:${o.cabinet}`;
      try {
        const r = await o.appel('GET', `/cabinets/${encodeURIComponent(o.cabinet)}/messages`);
        if (fini) return;
        if (!el.isConnected) { arreter(); return; }
        // Sans réseau, la lecture vient de la copie du poste (« mon ordinateur », plateforme/poste.js) : la bande reste, et
        // l'heure dite est celle de la dernière lecture en ligne.
        const sansLui = navigator.onLine === false;
        if (!sansLui) { luA = new Date().toISOString(); LUES.set(cle, { r, luA }); }
        const s = JSON.stringify(r);
        const etaitHors = hors;
        hors = sansLui;
        lu = r;
        if (s !== signature || !el.querySelector('[data-boite-corps]')) dessiner();
        signature = s;
        if (etaitHors !== hors || etatPage !== (hors ? 'hors' : 'pret')) majHors();
      } catch (x) {
        if (fini) return;
        const reseau = navigator.onLine === false;
        // Hors ligne : la dernière lecture de la page (celle-ci ou une boîte ouverte avant), telle qu'elle était.
        const copie = !lu && reseau ? LUES.get(cle) : null;
        if (copie) { lu = copie.r; luA = copie.luA; signature = JSON.stringify(lu); hors = true; dessiner(); majHors(); return; }
        if (lu) { if (reseau && !hors) { hors = true; majHors(); } return; }
        // Un refus du serveur qui dit pourquoi (un droit, un dossier) : réessayer n'y change rien, on le dit tel quel.
        const statut = Number((/** @type {any} */ (x) || {}).statut || 0);
        const dit = statut >= 400 && statut < 500;
        el.innerHTML = `<div class="msg-refus-w">${squelette(true)}<div class="msg-ref" role="alert" data-msg-echec>${dessin(reseau ? 'nuage' : 'message')}
          <b>${reseau ? 'Hors ligne : tes conversations attendent le réseau' : 'Tes conversations ne se sont pas lues'}</b>
          <span>${reseau ? `${/** @type {any} */ (x).jamaisLue ? 'Ce poste ne les a pas encore lues : ouvre-les une fois avec le réseau, elles se reliront ensuite sans lui.' : 'Ce poste n\'en garde pas de copie (ce n\'est pas « mon ordinateur »).'} Ce que tes clients ont écrit est sur le serveur : la boîte s'ouvre toute seule dès que le réseau revient.`
            : dit ? esc(motif(x)) : 'Le serveur ne les a pas rendues cette fois. Rien n\'est perdu : ce que tes clients ont écrit est gardé sur le serveur, et la boîte réessaie seule toutes les 30 secondes.'}</span>
          <span class="msg-ref-a"><button type="button" class="btn btn-primary" data-relire>Réessayer maintenant</button>${o.enAttendant ? `<button type="button" class="msg-lien" data-msg-en-attendant>${esc(o.enAttendant.texte)} →</button>` : ''}</span></div></div>`;
        direEtat(reseau ? 'hors' : 'refus');
        const b = /** @type {HTMLButtonElement | null} */ (el.querySelector('[data-relire]'));
        if (b) b.onclick = async () => { b.disabled = true; await lire(); if (b.isConnected) b.disabled = false; };
        const ea = el.querySelector('[data-msg-en-attendant]');
        if (ea && o.enAttendant) /** @type {HTMLElement} */ (ea).onclick = o.enAttendant.aller;
      }
    }
    // Passer du téléphone à l'ordinateur (ou l'inverse) repose la page : une colonne ou deux.
    const auChangement = () => { if (!lu || fini) return; fermer(); signature = ''; poser(); dessiner(); };
    TELEPHONE.addEventListener('change', auChangement);
    el.innerHTML = `<div class="msg-sq-w" role="status" aria-label="Lecture de tes conversations…">${squelette(false)}</div>`;
    direEtat('chargement');
    void lire();
    // Une conversation ouverte à côté relit la liste à chaque lecture : la boîte ne la relit seule que sans elle.
    const minuterie = setInterval(() => { if (!el.isConnected) arreter(); else if (document.visibilityState === 'visible' && !ouverte) void lire(); }, RELIRE_MS);
    // (1.134.0) Le réseau revenu, la boîte se relit tout de suite (l'échec hors ligne le promet).
    // (1.179.0) Le réseau revenu, la boîte se relit même une conversation ouverte (la bande « Hors ligne » s'en va) ; le
    // réseau perdu, la bande paraît tout de suite.
    const auReseau = () => { if (el.isConnected) void lire(); };
    const sansLeReseau = () => { if (el.isConnected && lu && !hors) { hors = true; majHors(); } };
    window.addEventListener('online', auReseau);
    window.addEventListener('offline', sansLeReseau);
    function arreter() { fini = true; clearInterval(minuterie); clearTimeout(relecture); TELEPHONE.removeEventListener('change', auChangement); window.removeEventListener('online', auReseau); window.removeEventListener('offline', sansLeReseau); fermer(); }
    // (1.176.0) « Écrire à plusieurs clients… » est dans l'en-tête de la page : l'écran l'ouvre d'ici.
    return { arreter, demandeGroupee: () => { if (lu && lu.dossiers.length) ecrireAPlusieurs(); } };
  }

  // (1.94.0) Un fichier qui part avec un mot (et la pièce qu'il concerne), hors du fil : la fenêtre « Répondre » d'une
  // question qui attend une pièce l'envoie ainsi. Trop lourd, il est refusé avant de partir, comme dans le fil.
  /** @param {(m: string, c: string, b?: unknown) => Promise<any>} appel @param {string} cote @param {File} f
   *  @param {string} texte @param {{ genre: string, id: string, libelle: string } | null} piece */
  async function envoyerFichier(appel, cote, f, texte, piece) {
    const lourd = tropLourd(f);
    if (lourd) throw new Error(lourd);
    const depot = await appel('POST', '/messages/fichiers', { cote, nom: f.name, contenu: await enBase64(f) });
    // (1.157.1) Le message parti (son identifiant) : la page « Photo envoyée au cabinet » le suit dans le fil.
    const message = await appel('POST', '/messages', { cote, texte, piece, demande: null, fichier: depot.id });
    return { message: message && message.id, fichier: depot };
  }
  // (1.152.0) Le Cabinet ouvre aussi un fichier depuis « Pièces reçues », et ses modèles depuis la barre.
  w.SkanMessagerie = { conversation, boite, envoyerFichier, montrerFichier, ouvrirFichier, fenetreModeles, dessin };
})();
