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

  // Ouvrir un fichier du fil : le serveur le rend en base 64, la page l'ouvre dans un onglet.
  /** @param {(m: string, c: string, b?: unknown) => Promise<any>} appel @param {string} id */
  async function ouvrirFichier(appel, id) {
    const onglet = window.open('', '_blank');
    const f = await appel('GET', `/messages/fichiers/${encodeURIComponent(id)}`);
    const octets = Uint8Array.from(atob(f.contenu), (c) => c.charCodeAt(0));
    const adresse = URL.createObjectURL(new Blob([octets], { type: f.type }));
    if (onglet) onglet.location.href = adresse;
    else {
      const a = document.createElement('a');
      a.href = adresse; a.download = f.nom;
      document.body.append(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
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
   *   ouvrirPiece?: (genre: string, id: string) => boolean,
   *   pieceDuNumero?: (numero: string) => { genre: string, id: string } | null,
   *   repondre?: (question: string, texte: string) => Promise<void>,
   *   rangerAchat?: (message: { id: string, nom: string, type: string, contenu: string }) => void,
   *   voirMandat?: () => void,
   *   inviter?: () => void,
   *   revision?: () => void,
   *   surAttente?: (a: { nonLus: number, questions: number, demandes: number }) => void,
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
      el.innerHTML = `<div class="msg-page${entreprise ? '' : ' msg-cabinet'}">
        ${o.retour ? `<button type="button" class="msg-retour" data-msg-retour>← ${esc(o.retour.texte)}</button>` : ''}
        <header class="msg-tete">
          <span class="msg-avatar" aria-hidden="true">${esc(initiales(nomAutre))}</span>
          <span class="msg-tete-txt"><h1>${entreprise ? 'Mon comptable' : esc(nomAutre)}</h1>${sous ? `<span class="msg-sous">${sous}</span>` : ''}</span>
        </header>
        <div class="msg-corps">
          <section class="msg-zone" aria-label="Les messages">
            <div class="msg-fil" data-msg-fil></div>
            ${f && f.actif ? `<form class="msg-ecrire" data-msg-ecrire novalidate>
              <div class="msg-joints" data-msg-joints hidden></div>
              <label class="msg-demande" data-msg-demande hidden><span>La pièce que tu demandes</span>
                <input type="text" maxlength="300" placeholder="Par exemple : la facture STEG d'août" data-msg-demande-txt></label>
              <label class="msg-cache" for="msg-texte">${entreprise ? 'Ton message à ton cabinet' : 'Ton message à ce client'}</label>
              <textarea id="msg-texte" rows="2" maxlength="4000" placeholder="Écris à ${esc(nomAutre)}…" data-msg-texte></textarea>
              <p class="msg-refus" role="alert" data-msg-refus></p>
              <div class="msg-gestes">
                <span class="msg-gestes-g">
                  <button type="button" class="btn" data-msg-joindre>${dessin('trombone')}Joindre une photo ou un PDF</button>
                  ${entreprise && o.pieces ? `<button type="button" class="btn" data-msg-piece>${dessin('piece')}Parler d'une pièce</button>` : ''}
                  ${entreprise ? '' : `<button type="button" class="btn" data-msg-demander aria-pressed="false">${dessin('piece')}Demander une pièce</button>`}
                </span>
                <button type="submit" class="btn btn-primary" data-msg-envoyer>Envoyer</button>
              </div>
            </form>` : ''}
          </section>
          <aside class="msg-a-cote" data-msg-cote></aside>
        </div>
      </div>`;
      const r = el.querySelector('[data-msg-retour]');
      if (r && o.retour) /** @type {HTMLElement} */ (r).onclick = o.retour.aller;
      brancherEcrire();
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
        const ouvre = entreprise && o.ouvrirPiece ? `<button type="button" class="msg-lien" data-msg-ouvrir="${esc(m.piece.genre)}:${esc(m.piece.id)}">Ouvrir</button>` : '';
        corps += `<div class="msg-carte">${dessin('piece')}<span class="msg-carte-txt"><b>${esc(GENRES[m.piece.genre] || 'Pièce')}</b> · ${esc(m.piece.libelle)}</span>${ouvre}</div>`;
      }
      if (m.demande) {
        const recue = !!m.demande.recueLe;
        const geste = recue || !actif ? ''
          : entreprise ? `<button type="button" class="btn btn-sm btn-primary" data-msg-envoyer-piece="${esc(m.id)}">Envoyer la pièce…</button>`
            : `<button type="button" class="btn btn-sm" data-msg-recue="${esc(m.id)}">Reçue autrement</button>`;
        corps += `<div class="msg-carte msg-demande-carte${recue ? ' recue' : ''}">${dessin('piece')}<span class="msg-carte-txt"><b>Pièce demandée</b> · ${esc(m.demande.texte)}</span>
          <span class="msg-etat">${recue ? 'Reçue' : entreprise ? 'À envoyer' : 'Attendue'}</span>${geste}</div>`;
      }
      if (m.fichier) {
        corps += `<div class="msg-fichier">${dessin(m.fichier.type === 'application/pdf' ? 'piece' : 'image')}
          <span class="msg-carte-txt"><b>${esc(m.fichier.nom)}</b><span class="msg-poids">${esc(m.fichier.type === 'application/pdf' ? 'PDF' : 'Photo')} · ${esc(poids(m.fichier.taille))}</span></span>
          <button type="button" class="msg-lien" data-msg-fichier="${esc(m.fichier.id)}">Ouvrir</button></div>`;
      }
      if (m.repondA) {
        const d = demandes().get(m.repondA);
        if (d) corps = `<span class="msg-reponse-a">En réponse à : ${esc(d.demande.texte)}</span>${corps}`;
      }
      /** @type {string[]} */
      const pied = [];
      if (moi && m.lu) pied.push('Lue');
      if (m.achat) pied.push(`rangée dans ${entreprise ? 'tes' : 'ses'} achats (${esc(m.achat.libelle)})`);
      const ranger = entreprise && actif && m.fichier && !m.achat && o.rangerAchat
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
      const etat = q.statut === 'close' ? '<span class="msg-q-etat">Close par le cabinet</span>'
        : attend ? `<span class="msg-q-etat attend">${entreprise ? 'Attend ta réponse' : 'Attend le client'}</span>` : '';
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
        <span class="msg-reponse-a">Réponse à la question${q.piece ? ` sur ${esc(q.piece)}` : ''}</span>
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
      if (a.demandes) attend.push(pl(a.demandes, 'pièce demandée', 'pièces demandées'));
      const rien = !attend.length;
      const texte = entreprise
        ? (rien ? 'Rien : aucune question ni pièce demandée n\'attend ta réponse.' : `${attend.join(' et ')} de ton cabinet.`)
        : (rien ? 'Rien : ce client a répondu à tes questions et envoyé les pièces demandées.' : `${attend.join(' et ')} : le client n'a pas encore répondu.`);
      const anciens = entreprise && (lu.anciens || []).length ? `<div class="msg-encart">
          <b>${cabinetRelu ? 'Ton cabinet d\'aujourd\'hui' : 'Tes cabinets d\'avant'}</b>
          ${cabinetRelu ? '<button type="button" class="msg-lien" data-msg-actuel>Revenir au fil de ton cabinet</button>'
            : (lu.anciens || []).map((/** @type {any} */ x) => `<button type="button" class="msg-lien" data-msg-ancien="${esc(x.cabinet)}">Relire vos échanges avec ${esc(x.nom || 'ce cabinet')}</button>`).join('')}
        </div>` : '';
      cote.innerHTML = `${f ? `<div class="msg-encart${rien ? ' ok' : ' attend'}" data-msg-attente><b>${entreprise ? 'En attente de toi' : 'Ce qui attend le client'}</b><span>${esc(texte)}</span></div>` : ''}
        ${entreprise ? `<div class="msg-encart"><b>Ce que voit ton cabinet</b><span>Ce fil, et ce que ton mandat lui confie, pour cette entreprise seulement. Chaque message garde sa date et son auteur, dans ton dossier.</span>
          ${o.voirMandat ? '<button type="button" class="msg-lien" data-msg-mandat>Voir le mandat</button>' : ''}</div>`
          : `<div class="msg-encart"><b>Rien à faire ?</b><span>Le client quitte « À traiter » jusqu'à son prochain message.</span>
            <button type="button" class="btn btn-sm" data-msg-traite>C'est traité</button>
            ${o.revision ? '<button type="button" class="msg-lien" data-msg-revision>Poser une question sur une pièce (révision)</button>' : ''}</div>`}
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
        if (premiereFois) { poserLaPage(); dessinerFil(); dessinerCote(); }
        else if (nouvelle !== signature) { dessinerFil(); dessinerCote(); }
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
      fil.querySelectorAll('[data-msg-ouvrir]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.onclick = () => {
          const [genre = '', id = ''] = String(b.dataset.msgOuvrir).split(':');
          if (o.ouvrirPiece && !o.ouvrirPiece(genre, id) && o.toast) o.toast('Cette pièce n\'est plus dans ton dossier : elle a été supprimée.', true);
        };
      });
      surClic(fil, '[data-msg-recue]', async (b) => {
        await o.appel('POST', `/messages/${encodeURIComponent(String(b.dataset.msgRecue))}/recue`);
        await relire();
      });
      surClic(fil, '[data-msg-envoyer-piece]', async (b) => {
        const f = await choisirFichier(ACCEPTE);
        if (!f) return;
        const lourd = tropLourd(f);
        if (lourd) throw new Error(lourd);
        const depot = await o.appel('POST', '/messages/fichiers', { cote: o.cote, nom: f.name, contenu: await enBase64(f) });
        await o.appel('POST', '/messages', { cote: o.cote, texte: '', fichier: depot.id, repondA: String(b.dataset.msgEnvoyerPiece) });
        if (o.toast) o.toast(`« ${f.name} » est envoyée à ton cabinet.`);
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
      const dire = (/** @type {string} */ t) => { refus.textContent = t; };
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
      // Entrée envoie ; Maj+Entrée va à la ligne. Au téléphone (doigt), Entrée va à la ligne : on envoie du bouton.
      texte.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
      };
      const envoyer = /** @type {HTMLButtonElement} */ (form.querySelector('[data-msg-envoyer]'));
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const t = texte.value.trim();
        const d = demande ? demandeTxt.value.trim() : '';
        if (demande && !d) { dire('Nomme la pièce que tu demandes (par exemple : la facture STEG d\'août), puis « Envoyer ».'); demandeTxt.focus(); return; }
        if (!t && !fichier && !d) { dire(entreprise ? 'Un message vide n\'apprend rien à ton cabinet : écris quelque chose ou joins une photo.' : 'Un message vide n\'apprend rien à ton client : écris quelque chose, joins un fichier ou demande une pièce.'); texte.focus(); return; }
        envoyer.disabled = true;
        dire('');
        try {
          let depot = null;
          if (fichier) depot = await o.appel('POST', '/messages/fichiers', { cote: o.cote, nom: fichier.name, contenu: await enBase64(fichier) });
          await o.appel('POST', '/messages', { cote: o.cote, texte: t, piece, demande: d || null, fichier: depot ? depot.id : null });
          texte.value = ''; demandeTxt.value = ''; piece = null; fichier = null; demande = false;
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
            <b>${esc(GENRES[p.genre] || 'Pièce')}</b><span>${esc(p.libelle)}</span></button>`).join('')
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

    void lire();
    const minuterie = setInterval(() => { if (document.visibilityState === 'visible' && el.isConnected) void lire(); else if (!el.isConnected) arreter(); }, RELIRE_MS);
    const auRetour = () => { if (document.visibilityState === 'visible' && el.isConnected) void lire(); };
    document.addEventListener('visibilitychange', auRetour);
    function arreter() { fini = true; clearInterval(minuterie); document.removeEventListener('visibilitychange', auRetour); }
    return { arreter, relire };
  }

  /**
   * La boîte du cabinet : tous ses clients en ligne, chacun avec son état.
   * @param {HTMLElement} el
   * @param {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   cabinet: string,
   *   nomCabinet: string,
   *   ouvrir: (entreprise: string, demander?: boolean) => void,
   *   revision?: (entreprise: string) => void,
   *   surCompteurs?: (c: { aTraiter: number, attendClient: number, tout: number }) => void,
   * }} o
   */
  function boite(el, o) {
    /** @type {any} */ let lu = null;
    // Le filtre de départ : « À traiter » s'il y a quelque chose, sinon « Attend le client », sinon « Tout » (une boîte qui
    // s'ouvre sur « Rien à traiter » cachait les clients qu'on venait voir : vu à la souris le 09/10/2026).
    /** @type {string | null} */ let filtre = null;
    /** @type {string | null} */ let choisi = null;
    let fini = false;
    let signature = '';
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
    function dessiner() {
      const ds = /** @type {any[]} */ (lu.dossiers);
      const c = lu.compteurs;
      if (!filtre) filtre = c.aTraiter ? 'a_traiter' : c.attendClient ? 'attend_client' : 'tout';
      const vus = ds.filter((d) => filtre === 'tout' || d.etat === filtre);
      if (choisi && !ds.some((d) => d.entreprise === choisi)) choisi = null;
      if (!choisi || !vus.some((d) => d.entreprise === choisi)) choisi = vus[0] ? vus[0].entreprise : null;
      const d = ds.find((x) => x.entreprise === choisi);
      const F = [['a_traiter', `À traiter (${c.aTraiter})`], ['attend_client', `Attend le client (${c.attendClient})`], ['tout', `Tout (${c.tout})`]];
      el.innerHTML = `<div class="msg-page msg-boite">
        <div class="msg-boite-tete">
          <span class="msg-tete-txt"><span class="msg-surtitre">${esc(o.nomCabinet)}</span><h1>Les messages de tes clients</h1></span>
          <div class="msg-filtres" role="tablist" aria-label="Quels clients">${F.map(([id, nom]) => `<button type="button" role="tab" class="msg-filtre" aria-selected="${filtre === id}" data-filtre="${id}">${esc(nom)}</button>`).join('')}</div>
        </div>
        ${ds.length ? `<div class="msg-corps">
          <section class="msg-zone msg-liste" aria-label="Les dossiers">
            ${vus.length ? vus.map((x) => `<button type="button" class="msg-dossier${x.entreprise === choisi ? ' choisi' : ''}" data-dossier="${esc(x.entreprise)}" aria-current="${x.entreprise === choisi}">
                <span class="msg-avatar petit" aria-hidden="true">${esc(initiales(x.nom))}</span>
                <span class="msg-dossier-txt"><span class="msg-dossier-l1"><b>${esc(x.nom)}</b>${x.dernier ? `<span class="msg-quand">${esc(quandCourt(x.dernier.quand))}</span>` : ''}</span>
                  <span class="msg-extrait">${esc(extrait(x))}</span></span>
                ${x.nonLus ? `<span class="msg-non-lus" title="${esc(pl(x.nonLus, 'nouveau message', 'nouveaux messages'))}">${x.nonLus}</span>` : ''}
                <span class="msg-etat-pastille ${etatDit(x.etat)[1]}">${esc(etatDit(x.etat)[0])}</span></button>`).join('')
              : `<div class="msg-vide"><b>${filtre === 'a_traiter' ? 'Rien à traiter.' : 'Aucun client n\'a de réponse en retard.'}</b><span>${filtre === 'a_traiter' ? 'Aucun client ne t\'a écrit depuis ta dernière réponse.' : 'Toutes tes questions et pièces demandées ont leur réponse.'}</span></div>`}
          </section>
          ${d ? `<aside class="msg-a-cote msg-choisi">
            <span class="msg-tete-txt"><b class="msg-choisi-nom">${esc(d.nom)}</b><span class="msg-sous">${esc(etatDit(d.etat)[0])}${d.attentes ? ` · ${esc(pl(d.attentes, 'réponse attendue', 'réponses attendues'))}` : ''}</span></span>
            <div class="msg-dernier">${d.dernier ? `<span><b>${esc(d.dernier.cote === 'cabinet' ? 'Toi' : d.dernier.auteur || 'Le client')}</b> · ${esc(quandCourt(d.dernier.quand))}</span><span>${esc(d.dernier.extrait || '')}</span>` : '<span>Aucun échange encore avec ce client.</span>'}</div>
            <button type="button" class="btn btn-primary" data-ouvrir>Ouvrir la conversation</button>
            <span class="msg-boite-gestes"><button type="button" class="btn" data-demander>Demander une pièce</button>
              ${o.revision ? '<button type="button" class="btn" data-question>Question sur une pièce</button>' : ''}</span>
            <span class="small muted">Les questions posées pendant la révision arrivent ici aussi, avec la réponse du client.</span>
          </aside>` : ''}
        </div>` : `<div class="msg-vide"><b>Aucun client en ligne pour l'instant.</b><span>La messagerie s'ouvre avec chaque client qui t'a confié son dossier dans SkanFact. Les dossiers que tu tiens seul au cabinet n'en ont pas.</span></div>`}
      </div>`;
      el.querySelectorAll('[data-filtre]').forEach((n) => { /** @type {HTMLElement} */ (n).onclick = () => { filtre = String(/** @type {HTMLElement} */ (n).dataset.filtre); choisi = null; dessiner(); }; });
      el.querySelectorAll('[data-dossier]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.onclick = () => { choisi = String(b.dataset.dossier); dessiner(); };
        b.ondblclick = () => o.ouvrir(String(b.dataset.dossier));
      });
      const ouvrir = el.querySelector('[data-ouvrir]');
      if (ouvrir && choisi) /** @type {HTMLElement} */ (ouvrir).onclick = () => o.ouvrir(String(choisi));
      const demander = el.querySelector('[data-demander]');
      if (demander && choisi) /** @type {HTMLElement} */ (demander).onclick = () => o.ouvrir(String(choisi), true);
      const question = el.querySelector('[data-question]');
      if (question && choisi && o.revision) { const r = o.revision; /** @type {HTMLElement} */ (question).onclick = () => r(String(choisi)); }
    }
    async function lire() {
      if (fini) return;
      try {
        const r = await o.appel('GET', `/cabinets/${encodeURIComponent(o.cabinet)}/messages`);
        if (fini) return;
        const s = JSON.stringify(r);
        lu = r;
        if (o.surCompteurs) o.surCompteurs(r.compteurs);
        if (s !== signature && el.isConnected) dessiner();
        signature = s;
      } catch (x) {
        if (!lu) {
          el.innerHTML = `<div class="msg-page"><div class="msg-vide"><b>La boîte ne s'est pas ouverte.</b><span>${esc(motif(x))}</span><button type="button" class="btn" data-relire>Réessayer</button></div></div>`;
          const b = el.querySelector('[data-relire]');
          if (b) /** @type {HTMLElement} */ (b).onclick = () => { void lire(); };
        }
      }
    }
    void lire();
    const minuterie = setInterval(() => { if (!el.isConnected) arreter(); else if (document.visibilityState === 'visible') void lire(); }, RELIRE_MS);
    function arreter() { fini = true; clearInterval(minuterie); }
    return { arreter };
  }

  w.SkanMessagerie = { conversation, boite };
})();
