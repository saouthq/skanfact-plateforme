// @ts-check
// Le support de SkanFact, dans l'application de l'entreprise (Support S1 ; docs/support.md ; serveur/support ; base
// 0095). La page « Tes demandes au support » (#/support) : chaque demande de la personne, la conversation avec l'équipe,
// y répondre, dire que c'est réglé ; et ce qui attend, partout ailleurs : la pastille de l'Aide et le bandeau en haut de
// chaque page. La fenêtre « Écrire au support » est celle de la v10 (web/v10/support.txt) : ce module lit, écrit et
// dessine, la page lui fournit le reste.
//
// La réponse de l'équipe se lit ICI. L'e-mail qui prévient (serveur/support/postier.ts) ne porte ni la réponse, ni son
// auteur, ni l'entreprise : la personne revient dans SkanFact pour la lire. Chacun ne voit que SES demandes : celles d'un
// collègue restent les siennes (la base le tient, 0095).
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const TZ = 'Africa/Tunis';
  // Une réponse arrive dans la minute : la page ouverte se relit toutes les 30 secondes tant qu'elle est visible.
  const RELIRE_MS = 30_000;

  /** @param {string} iso */
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  /** @param {string | number | Date} d */
  const jourCle = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
  /** @param {string} iso */
  const date = (iso) => { const j = jourCle(iso); return `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`; };
  const hier = () => jourCle(Date.parse(`${jourCle(Date.now())}T12:00:00Z`) - 86_400_000);
  // Le jour d'un séparateur : « Aujourd'hui », « Hier », sinon « Lundi 12 octobre » (et l'année, si ce n'est pas celle-ci).
  /** @param {string} iso */
  function jourDit(iso) {
    const cle = jourCle(iso);
    if (cle === jourCle(Date.now())) return 'Aujourd\'hui';
    if (cle === hier()) return 'Hier';
    const s = new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
      ...(cle.slice(0, 4) === jourCle(Date.now()).slice(0, 4) ? {} : { year: 'numeric' }) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Quand, dans la liste : l'heure aujourd'hui, « Hier », sinon la date.
  /** @param {string} iso */
  const quandCourt = (iso) => (jourCle(iso) === jourCle(Date.now()) ? heure(iso) : jourCle(iso) === hier() ? 'Hier' : date(iso));
  // Le numéro qu'on se dit au téléphone, le même que dans la console (« S-0214 »).
  /** @param {number} n */
  const ref = (n) => `S-${String(n).padStart(4, '0')}`;
  const CANAUX = /** @type {Record<string, string>} */ ({ email: 'par e-mail', whatsapp: 'par WhatsApp', telephone: 'au téléphone' });
  /** @param {unknown} x */
  const motif = (x) => (x instanceof Error ? x.message : String(x));

  // Où en est une demande, vue par la personne qui l'a posée : une réponse à lire passe avant tout.
  /** @param {any} d @returns {{ cle: 'lire' | 'repondue' | 'envoyee' | 'reglee', texte: string }} */
  function etat(d) {
    if (d.closeLe) return { cle: 'reglee', texte: d.closeCote === 'equipe' ? 'Close par l\'équipe' : 'Réglée' };
    if (d.nonLu) return { cle: 'lire', texte: 'Réponse à lire' };
    if (d.dernierCote === 'equipe') return { cle: 'repondue', texte: 'Répondue' };
    return { cle: 'envoyee', texte: 'Envoyée' };
  }

  // Un article de l'Aide cité par l'équipe : son titre, lu dans l'Aide que la personne a sous les yeux (une seule source).
  /** @param {string} id */
  function article(id) {
    const g = w.SkanGuide;
    const a = g && Array.isArray(g.ARTICLES) ? g.ARTICLES.find((/** @type {any} */ x) => x && x.id === id) : null;
    return a ? { id: String(a.id), titre: String(a.title || ''), sous: String(a.sub || '') } : null;
  }
  const LIVRE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5a2.5 2.5 0 0 0-2.5 2.5zM8 7h7M8 11h5"/></svg>';

  // ── Ce qui attend : la pastille de l'Aide et le bandeau ───────────────────────────────────────────────────────────
  // La dernière lecture de `/support/attente` : les demandes dont la réponse n'est pas lue (`aLire`).
  /** @type {{ demandes: number, aLire: { id: string, numero: number, sujet: string }[] } | null} */
  let attente = null;
  const surLaPage = () => /^#\/support(\/|$)/.test(location.hash);

  /** @param {HTMLElement | null} view */
  function poser(view) {
    if (!view) return;
    const deja = /** @type {HTMLElement | null} */ (view.querySelector(':scope > .sup-bandeau'));
    const lire = attente && Array.isArray(attente.aLire) ? attente.aLire : [];
    const premier = lire[0];
    // Sur la page des demandes, c'est la page qui le dit : pas de bandeau au-dessus d'elle.
    if (!premier || surLaPage()) { if (deja) deja.remove(); return; }
    const cle = lire.map((x) => x.id).join(',');
    if (deja && deja.dataset.cle === cle) return;
    if (deja) deja.remove();
    const el = document.createElement('div');
    el.className = 'banner info sup-bandeau';
    el.setAttribute('role', 'status');
    el.dataset.cle = cle;
    el.innerHTML = `<span class="sup-bandeau-texte">${lire.length === 1
      ? `L'équipe SkanFact a répondu à ta demande ${esc(ref(premier.numero))}, « ${esc(premier.sujet)} ».`
      : `L'équipe SkanFact a répondu à ${lire.length} de tes demandes.`}</span>
      <a class="btn btn-sm" href="#/support/${encodeURIComponent(premier.id)}">${lire.length === 1 ? 'Lire la réponse' : 'Lire les réponses'}</a>`;
    view.insertBefore(el, view.firstChild);
  }

  // Ce que le serveur dit qui attend : la pastille de l'Aide (le nombre de réponses à lire) et le bandeau de la page.
  /** @param {any} a */
  function noter(a) {
    attente = a && typeof a === 'object' ? { demandes: Number(a.demandes) || 0, aLire: Array.isArray(a.aLire) ? a.aLire : [] } : null;
    const p = document.getElementById('nav-support');
    const n = attente ? attente.aLire.length : 0;
    if (p) { p.hidden = !n; p.textContent = n ? String(n) : ''; p.title = n ? `${n > 1 ? `${n} réponses` : 'Une réponse'} du support t'attend${n > 1 ? 'ent' : ''}` : ''; }
    poser(document.getElementById('view'));
  }

  /**
   * La page « Tes demandes au support ».
   * @param {HTMLElement} el
   * @param {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   ecrire: () => void,
   *   choisie?: string | null,
   *   toast?: (texte: string, erreur?: boolean) => void,
   *   ouvrirArticle?: (id: string) => void,
   * }} o
   */
  function page(el, o) {
    /** @type {any[] | null} */ let demandes = null;
    /** @type {string | null} */ let choisie = o.choisie || null;
    let signature = '';
    let enCours = false;
    let fini = false;
    // Le texte d'une réponse en cours se garde quand la page se relit, par demande.
    /** @type {Map<string, string>} */ const brouillons = new Map();
    /** @type {Set<string>} */ const luesIci = new Set();

    function poserLaPage() {
      el.innerHTML = `<div class="sup-page">
        <div class="page-head"><h1>Tes demandes au support</h1>
          <div class="actions"><button type="button" class="btn" data-sup-ecrire>Écrire au support…</button></div></div>
        <p class="sup-intro">L'équipe SkanFact te répond ici, en général dans la journée. Tu ne vois que tes demandes : celles de tes collègues restent les leurs.</p>
        <div class="sup-corps">
          <div class="sup-liste" data-sup-liste aria-label="Tes demandes"></div>
          <section class="sup-fil" data-sup-fil aria-label="La conversation"></section>
        </div>
      </div>`;
      brancherEcrire(el);
    }
    function poserLeVide() {
      el.innerHTML = `<div class="sup-page">
        <div class="page-head"><h1>Tes demandes au support</h1></div>
        <div class="panel sup-vide">
          <b>Aucune demande pour l'instant.</b>
          <p>Une question qui te bloque, quelque chose qui ne marche pas comme prévu : écris à l'équipe SkanFact. Elle te répond ici, en général dans la journée, et un e-mail te prévient que la réponse t'attend.</p>
          <p class="small muted">Ta demande emporte la version de SkanFact et le nom de la page où tu étais ; rien de ton dossier : ni client, ni montant, ni document.</p>
          <div><button type="button" class="btn btn-primary" data-sup-ecrire>Écrire au support…</button></div>
        </div>
      </div>`;
      brancherEcrire(el);
    }
    /** @param {HTMLElement} racine */
    function brancherEcrire(racine) {
      racine.querySelectorAll('[data-sup-ecrire]').forEach((b) => { /** @type {HTMLElement} */ (b).onclick = () => o.ecrire(); });
    }

    // ── La liste ─────────────────────────────────────────────────────────────────────────────────────────────────
    function dessinerListe() {
      const liste = /** @type {HTMLElement | null} */ (el.querySelector('[data-sup-liste]'));
      if (!liste || !demandes) return;
      const ouvertes = demandes.filter((d) => !d.closeLe);
      const closes = demandes.filter((d) => d.closeLe);
      /** @param {any} d */
      const ligne = (d) => {
        const e = etat(d);
        const dernier = d.messages && d.messages.length ? d.messages[d.messages.length - 1].le : d.ouverteLe;
        return `<button type="button" class="sup-ticket" aria-pressed="${d.id === choisie}" data-sup-id="${esc(d.id)}">
          <span class="sup-t-haut"><span class="sup-ref">${esc(ref(d.numero))}</span><span class="sup-etat sup-etat-${e.cle}">${esc(e.texte)}</span></span>
          <b class="sup-t-sujet">${esc(d.sujet)}</b>
          <span class="sup-t-bas">${esc(quandCourt(dernier))}</span>
        </button>`;
      };
      liste.innerHTML = `${ouvertes.length ? `<h2 class="sup-l-titre">En cours</h2>${ouvertes.map(ligne).join('')}` : ''}
        ${closes.length ? `<h2 class="sup-l-titre">Réglées</h2>${closes.map(ligne).join('')}` : ''}`;
      liste.querySelectorAll('[data-sup-id]').forEach((n) => {
        const b = /** @type {HTMLElement} */ (n);
        b.onclick = () => {
          garderBrouillon();
          choisie = String(b.dataset.supId);
          dessinerListe();
          dessinerFil(true);
          // Au téléphone, la conversation est sous la liste : on y descend.
          const fil = el.querySelector('[data-sup-fil]');
          if (fil && window.matchMedia('(max-width: 860px)').matches) fil.scrollIntoView({ block: 'start', behavior: 'smooth' });
          void marquerLue();
        };
      });
    }

    // ── La conversation ──────────────────────────────────────────────────────────────────────────────────────────
    function garderBrouillon() {
      const t = /** @type {HTMLTextAreaElement | null} */ (el.querySelector('[data-sup-texte]'));
      if (t && t.dataset.supPour) brouillons.set(t.dataset.supPour, t.value);
    }
    /** @param {any} m */
    function bulle(m) {
      const moi = m.cote === 'client';
      const qui = moi ? `<b>Toi</b>${m.note ? ', noté par l\'équipe' : ''}` : `<b>${esc(m.nom || 'L\'équipe')}</b>, de l'équipe SkanFact`;
      const a = m.article ? article(m.article) : null;
      const lien = a ? `<a class="sup-article" href="#/aide/${encodeURIComponent(a.id)}" data-sup-article="${esc(a.id)}">${LIVRE}
          <span><span class="sup-article-eti">Dans l'Aide</span><b>${esc(a.titre)}</b>${a.sous ? `<span class="sup-article-sous">${esc(a.sous)}</span>` : ''}</span></a>` : '';
      return `<li class="sup-m${moi ? ' moi' : ''}"><span class="sup-qui">${moi ? `${esc(heure(m.le))} · ${qui}` : `${qui} · ${esc(heure(m.le))}`}</span>
        <div class="sup-bulle">${esc(m.texte)}</div>${lien}</li>`;
    }
    /** @param {boolean} [nouvelle] la demande vient d'être choisie : le champ repart de son brouillon */
    function dessinerFil(nouvelle) {
      const fil = /** @type {HTMLElement | null} */ (el.querySelector('[data-sup-fil]'));
      if (!fil || !demandes) return;
      const d = demandes.find((x) => x.id === choisie);
      if (!d) {
        fil.innerHTML = `<div class="sup-fil-vide"><b>Choisis une demande</b><span>Sa conversation avec l'équipe s'ouvre ici.</span></div>`;
        return;
      }
      const close = !!d.closeLe;
      const recue = d.canal !== 'application' ? `Reçue ${esc(CANAUX[d.canal] || '')} le ${esc(date(d.ouverteLe))}, notée par l'équipe SkanFact`
        : `Ouverte le ${esc(date(d.ouverteLe))} à ${esc(heure(d.ouverteLe))}`;
      const suite = close ? (d.closeCote === 'equipe' ? `Close par l'équipe le ${esc(date(d.closeLe))}` : `Réglée le ${esc(date(d.closeLe))}`)
        : d.dernierCote === 'equipe' ? 'L\'équipe t\'a répondu : à toi de lui dire si c\'est réglé.' : 'L\'équipe te répond ici, en général dans la journée.';
      // Le fil : les messages dans l'ordre du temps, séparés par jour.
      let html = '';
      let jour = '';
      for (const m of d.messages || []) {
        const j = jourCle(m.le);
        if (j !== jour) { jour = j; html += `<li class="sup-jour">${esc(jourDit(m.le))}</li>`; }
        html += bulle(m);
      }
      // Le champ de réponse garde ce qui était tapé, quand la page se relit (seul le fil se redessine alors).
      const champ = /** @type {HTMLTextAreaElement | null} */ (fil.querySelector('[data-sup-texte]'));
      const garde = !nouvelle && champ && champ.dataset.supPour === d.id
        ? { valeur: champ.value, focus: document.activeElement === champ, debut: champ.selectionStart, fin: champ.selectionEnd } : null;
      fil.innerHTML = `<header class="sup-f-tete">
          <div class="sup-f-txt"><span class="sup-ref">${esc(ref(d.numero))}</span><h2>${esc(d.sujet)}</h2>
            <p class="sup-f-sous">${recue} · ${suite}</p></div>
          ${close ? '' : '<button type="button" class="btn" data-sup-reglee>C\'est réglé</button>'}
        </header>
        <ol class="sup-messages" data-sup-messages>${html}</ol>
        <form class="sup-repondre" data-sup-repondre novalidate>
          <label class="sup-cache" for="sup-texte">${close ? 'Réécrire au support' : 'Ta réponse à l\'équipe SkanFact'}</label>
          <textarea id="sup-texte" rows="3" maxlength="4000" data-sup-texte data-sup-pour="${esc(d.id)}"
            placeholder="${close ? 'Ça recommence, ou il te manque quelque chose ? Réécrire rouvre ta demande.' : 'Ta réponse à l\'équipe SkanFact…'}"></textarea>
          <p class="sup-refus" role="alert" data-sup-refus></p>
          <div class="sup-gestes"><span class="sup-note">${close ? 'Ta demande est close : y réécrire la rouvre, avec tout ce qui s\'est déjà dit.' : 'Ctrl + Entrée envoie aussi.'}</span>
            <button type="submit" class="btn${close ? '' : ' btn-primary'}" data-sup-envoyer>${close ? 'Réécrire' : 'Envoyer'}</button></div>
        </form>`;
      const t = /** @type {HTMLTextAreaElement} */ (fil.querySelector('[data-sup-texte]'));
      t.value = garde ? garde.valeur : (brouillons.get(d.id) || '');
      if (garde && garde.focus) { t.focus(); t.setSelectionRange(garde.debut, garde.fin); }
      const liste = /** @type {HTMLElement} */ (fil.querySelector('[data-sup-messages]'));
      liste.scrollTop = liste.scrollHeight;
      brancherFil(fil, d);
    }
    /** @param {HTMLElement} fil @param {any} d */
    function brancherFil(fil, d) {
      fil.querySelectorAll('[data-sup-article]').forEach((n) => {
        const a = /** @type {HTMLAnchorElement} */ (n);
        if (o.ouvrirArticle) a.onclick = (e) => { e.preventDefault(); /** @type {any} */ (o.ouvrirArticle)(String(a.dataset.supArticle)); };
      });
      const reglee = /** @type {HTMLButtonElement | null} */ (fil.querySelector('[data-sup-reglee]'));
      if (reglee) reglee.onclick = async () => {
        reglee.disabled = true;
        try {
          await o.appel('POST', `/support/${encodeURIComponent(d.id)}/reglee`);
          if (o.toast) o.toast(`C'est noté : ta demande ${ref(d.numero)} est réglée. Si ça recommence, réécris-y : elle se rouvre.`);
          await relire();
        } catch (x) { if (o.toast) o.toast(motif(x), true); if (reglee.isConnected) reglee.disabled = false; }
      };
      const form = /** @type {HTMLFormElement} */ (fil.querySelector('[data-sup-repondre]'));
      const t = /** @type {HTMLTextAreaElement} */ (form.querySelector('[data-sup-texte]'));
      const refus = /** @type {HTMLElement} */ (form.querySelector('[data-sup-refus]'));
      const envoyer = /** @type {HTMLButtonElement} */ (form.querySelector('[data-sup-envoyer]'));
      t.oninput = () => { brouillons.set(d.id, t.value); if (refus.textContent) { refus.textContent = ''; t.removeAttribute('aria-invalid'); } };
      t.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (envoyer.disabled) return;
        const texte = t.value.trim();
        if (!texte) {
          refus.textContent = 'Un message vide n\'apprend rien à l\'équipe : écris ta réponse, puis « Envoyer ».';
          t.setAttribute('aria-invalid', 'true');
          t.focus();
          return;
        }
        envoyer.disabled = true;
        try {
          await o.appel('POST', `/support/${encodeURIComponent(d.id)}/messages`, { texte });
          brouillons.delete(d.id);
          t.value = '';
          if (o.toast) o.toast(d.closeLe ? `Ta demande ${ref(d.numero)} est rouverte : l'équipe te répond ici.` : 'Envoyé : l\'équipe te répond ici.');
          await relire(true);
        } catch (x) { refus.textContent = motif(x); t.focus(); } finally { if (envoyer.isConnected) envoyer.disabled = false; }
      };
    }

    // ── Lire, relire ─────────────────────────────────────────────────────────────────────────────────────────────
    // Lue : la réponse de l'équipe, vue ici, page visible. La pastille et le bandeau s'éteignent tout de suite.
    async function marquerLue() {
      const d = demandes && demandes.find((x) => x.id === choisie);
      // Une lecture vaut pour les messages qu'on a eus sous les yeux : une seconde réponse sur la même demande se marque
      // lue à son tour (marquée une fois par demande, la pastille restait allumée sur une réponse ouverte à l'écran).
      if (!d || !d.nonLu || document.visibilityState !== 'visible') return;
      const cle = `${d.id}#${(d.messages || []).length}`;
      if (luesIci.has(cle)) return;
      luesIci.add(cle);
      try {
        await o.appel('POST', `/support/${encodeURIComponent(d.id)}/lu`);
        d.nonLu = false;
        dessinerListe();
        if (attente) noter({ ...attente, aLire: attente.aLire.filter((x) => x.id !== d.id) });
      } catch { luesIci.delete(cle); }
    }
    async function lire() {
      if (enCours || fini) return;
      enCours = true;
      try {
        const r = await o.appel('GET', '/support');
        if (!el.isConnected) { arreter(); return; }
        if (fini) return;
        const lues = Array.isArray(r.demandes) ? r.demandes : [];
        const nouvelle = JSON.stringify(lues.map((/** @type {any} */ d) => [d.id, d.closeLe, d.nonLu, (d.messages || []).length]));
        const premiere = demandes === null;
        demandes = lues;
        if (!lues.length) { if (premiere || nouvelle !== signature) poserLeVide(); signature = nouvelle; return; }
        // La demande choisie : celle de l'adresse, sinon une réponse à lire, sinon la plus récente des ouvertes.
        if (!choisie || !lues.some((/** @type {any} */ d) => d.id === choisie)) {
          const aLire = lues.find((/** @type {any} */ d) => d.nonLu && !d.closeLe);
          choisie = (aLire || lues[0]).id;
        }
        if (premiere || !el.querySelector('[data-sup-liste]')) { poserLaPage(); dessinerListe(); dessinerFil(true); }
        else if (nouvelle !== signature) { dessinerListe(); dessinerFil(); }
        signature = nouvelle;
        void marquerLue();
      } catch (x) {
        if (demandes === null) {
          el.innerHTML = `<div class="sup-page"><div class="page-head"><h1>Tes demandes au support</h1></div>
            <div class="panel sup-vide"><b>Tes demandes ne se sont pas ouvertes.</b><p>${esc(motif(x))}</p>
            <div><button type="button" class="btn" data-sup-relire>Réessayer</button></div></div></div>`;
          const b = el.querySelector('[data-sup-relire]');
          if (b) /** @type {HTMLElement} */ (b).onclick = () => { void lire(); };
        }
      } finally { enCours = false; }
    }
    // Après un geste : la relecture tout de suite (et le fil redessiné même si rien d'autre n'a bougé).
    /** @param {boolean} [enBas] */
    async function relire(enBas) {
      signature = '';
      await lire();
      if (enBas) { const m = el.querySelector('[data-sup-messages]'); if (m) m.scrollTop = m.scrollHeight; }
    }

    void lire();
    const minuterie = setInterval(() => { if (!el.isConnected) arreter(); else if (document.visibilityState === 'visible') void lire(); }, RELIRE_MS);
    const auRetour = () => { if (document.visibilityState === 'visible' && el.isConnected) { void lire(); void marquerLue(); } };
    document.addEventListener('visibilitychange', auRetour);
    function arreter() { fini = true; clearInterval(minuterie); document.removeEventListener('visibilitychange', auRetour); }
    return { arreter };
  }

  w.SkanSupport = { page, noter, poser, ref };
})();
