// @ts-check
// Ton compte (lot onboarding, décision de Skander du 09/10/2026 ; maquettes validées ; migration 0076, docs/entree.md) :
// le premier onglet des Paramètres de l'entreprise et des Réglages du Cabinet, le même dans les deux. Ton adresse e-mail
// (vérifiée ou non), ton mot de passe, le code du téléphone (l'activer, de nouveaux codes de secours, changer de
// téléphone, le désactiver), ce que demande un nouvel appareil, et tes appareils.
//
// Chaque geste qui affaiblit ou déplace le compte se prouve d'abord, et c'est le serveur qui le refuse sinon : le code
// du moment (ou un code de secours) pour le code, le mot de passe actuel pour le mot de passe et l'adresse. Le code
// s'active en deux temps (préparé, puis activé par le premier code juste) : une fenêtre fermée en route ne change rien.
// Les fenêtres sont celles de la v10 (`modal`), passées par le point de contact avec son `appel` (qui lève une erreur
// portant le motif et, s'il y en a un, le champ refusé) et son `toast`.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // Un instant du serveur, lu comme le jour qu'il était à Tunis (jj/mm/aaaa).
  /** @param {string} iso */
  const jour = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' });
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n}\u00a0${n > 1 ? (plusieurs || `${un}s`) : un}`;
  const DESSINS = {
    bouclier: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    bouclierBarre: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M4 4l16 16"/>',
    enveloppe: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    coche: '<path d="M20 6 9 17l-5-5"/>',
  };
  /** @param {keyof typeof DESSINS} id */
  const dessin = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DESSINS[id]}</svg>`;

  /**
   * @typedef {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   modal: (html: string, onMount?: (layer: HTMLElement, close: () => void) => void, onDismiss?: () => void, opts?: any) => () => void,
   *   toast: (texte: string, erreur?: boolean) => void,
   * }} Outils
   */

  // Dire un refus dans une fenêtre : le motif sous le formulaire, et la case qu'il nomme marquée, le curseur dedans.
  /** @param {HTMLElement} racine @param {unknown} x @param {Record<string, string>} [cases] */
  function refuser(racine, x, cases) {
    const alerte = racine.querySelector('[role=alert]');
    if (alerte) alerte.textContent = x instanceof Error ? x.message : String(x);
    racine.querySelectorAll('.cpt-faute').forEach((c) => c.classList.remove('cpt-faute'));
    const champ = x && typeof x === 'object' && 'champ' in x ? /** @type {any} */ (x).champ : null;
    const sel = champ && cases ? cases[champ] : null;
    const input = sel ? /** @type {HTMLInputElement | null} */ (racine.querySelector(sel)) : null;
    if (input) {
      input.closest('.field')?.classList.add('cpt-faute');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      input.select();
    }
    // Le refus se lit en entier, même au bas d'une fenêtre plus haute que l'écran (la fenêtre défile en elle-même) : vu
    // au parcours du 09/10/2026, la moitié du message passait sous le bord.
    if (alerte && alerte.textContent) alerte.scrollIntoView({ block: 'nearest' });
  }
  /** @param {HTMLElement} racine */
  const effacerRefus = (racine) => {
    const alerte = racine.querySelector('[role=alert]');
    if (alerte) alerte.textContent = '';
    racine.querySelectorAll('.cpt-faute').forEach((c) => c.classList.remove('cpt-faute'));
    racine.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
  };
  // Un geste à la fois : le bouton se grise le temps de l'appel.
  /** @param {HTMLElement} racine @param {string} sel @param {() => Promise<void>} f */
  function surClic(racine, sel, f) {
    const b = /** @type {HTMLButtonElement | null} */ (racine.querySelector(sel));
    if (!b) return;
    b.onclick = async (e) => {
      e.preventDefault();
      if (b.disabled) return;
      b.disabled = true;
      try { await f(); } finally { if (b.isConnected) b.disabled = false; }
    };
  }

  // La clé par groupes de quatre, comme les applications d'authentification l'affichent.
  /** @param {string} cle */
  const parQuatre = (cle) => cle.replace(/(.{4})(?=.)/g, '$1 ');
  /** @param {string} adresse */
  function qr(adresse) {
    if (typeof w.qrcode !== 'function') return '';
    const q = w.qrcode(0, 'M');
    q.addData(adresse);
    q.make();
    return String(q.createSvgTag({ cellSize: 4, margin: 4, scalable: true }));
  }
  /** @param {string} texte @param {HTMLInputElement | null} [repli] */
  async function copier(texte, repli) {
    try { await navigator.clipboard.writeText(texte); return true; } catch { if (repli) { repli.focus(); repli.select(); } return false; }
  }
  // Les codes de secours dans un fichier texte, que le navigateur enregistre.
  /** @param {string[]} codes */
  function telecharger(codes) {
    const contenu = `Tes codes de secours SkanFact, donnés le ${new Date().toLocaleDateString('fr-FR')}.\nChacun remplace une fois le code du téléphone. Garde ce fichier à part.\n\n${codes.join('\n')}\n`;
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
    lien.download = 'skanfact-codes-de-secours.txt';
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
  }
  // Les codes de secours, à mettre de côté : la liste, « Copier », « Télécharger ».
  /** @param {string[]} codes */
  const blocSecours = (codes) => `<ul class="cpt-secours">${codes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <textarea class="cpt-cache" readonly aria-hidden="true" tabindex="-1">${esc(codes.join('\n'))}</textarea>
    <div class="cpt-boutons"><button type="button" class="btn btn-sm" data-copier-secours>Copier</button><button type="button" class="btn btn-sm" data-telecharger>Télécharger</button></div>`;
  /** @param {HTMLElement} racine @param {string[]} codes @param {(t: string) => void} dire */
  function brancherSecours(racine, codes, dire) {
    const b = /** @type {HTMLElement | null} */ (racine.querySelector('[data-copier-secours]'));
    if (b) b.onclick = async () => { dire(await copier(codes.join('\n'), racine.querySelector('.cpt-cache')) ? 'Codes copiés : colle-les dans un endroit sûr.' : 'Sélectionnés : copie-les (Ctrl+C).'); };
    const t = /** @type {HTMLElement | null} */ (racine.querySelector('[data-telecharger]'));
    if (t) t.onclick = () => telecharger(codes);
  }

  /** @param {HTMLElement} el @param {Outils} outils */
  async function dessiner(el, outils) {
    /** @type {any} */ let moi;
    try { moi = await outils.appel('GET', '/moi'); } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
    const c = moi.compte || {};
    const actif = moi.code_methode === 'application' || moi.code_methode === 'sms';
    const relais = !!c.courriel;
    const redessiner = () => { void dessiner(el, outils); };

    const etatCode = actif ? (c.codeExige ? ['Exigé', 'cpt-ok'] : ['Activé', 'cpt-ok']) : ['Désactivé', 'cpt-eteint'];
    const explication = actif
      ? (c.codeExige ? 'Il est exigé de chaque comptable d\'un cabinet, qui voit les comptes et les salaires de ses clients : il ne se désactive pas.'
        : 'À chaque connexion depuis un nouvel appareil, SkanFact demande le code de ton application d\'authentification : personne n\'entre à ta place, même avec ton mot de passe.')
      : 'Recommandé : en plus du mot de passe, un code qui change toutes les 30 secondes sur ton téléphone. Personne n\'entre à ta place, même avec ton mot de passe.';
    const appareil = actif
      ? ['Un nouvel appareil demande le code du téléphone', 'C\'est lui qui prouve que c\'est toi sur un appareil que SkanFact ne connaît pas : il remplace l\'e-mail.']
      : relais
        ? ['Un nouvel appareil se vérifie par e-mail', 'Quand tu te connectes depuis un appareil que SkanFact ne connaît pas, un code part à ton adresse. L\'appareil est ensuite reconnu 30 jours.']
        : ['Un nouvel appareil entre avec le mot de passe', 'Ce serveur n\'envoie pas encore d\'e-mails : rien d\'autre n\'est demandé sur un nouvel appareil. Le code du téléphone le protège.'];
    const adresseNote = c.adresseVerifiee
      ? 'Une nouvelle adresse se vérifie elle aussi par un code, avant de remplacer celle-ci.'
      : relais ? 'Elle se vérifie à ta prochaine connexion, par un code reçu à cette adresse.'
        : 'Ce serveur n\'envoie pas encore d\'e-mails : elle se vérifiera dès qu\'il le pourra.';

    el.innerHTML = `<div class="cpt">
      <section class="cpt-carte"><div class="cpt-ligne">
        <div class="cpt-quoi"><span class="cpt-etiquette">Ton adresse e-mail</span>
          <div class="cpt-valeur"><strong id="cpt-email">${esc(moi.email)}</strong>${c.adresseVerifiee ? `<span class="badge cpt-ok">${dessin('coche')}Vérifiée</span>` : '<span class="badge cpt-attente">À vérifier</span>'}</div>
          <p class="small muted">${adresseNote}</p></div>
        <button type="button" class="btn" id="cpt-adresse">Changer d'adresse…</button>
      </div></section>
      <section class="cpt-carte"><div class="cpt-ligne">
        <div class="cpt-quoi"><span class="cpt-etiquette">Ton mot de passe</span>
          <p class="small muted">Il n'est gardé qu'en empreinte : personne ne peut le lire, pas même SkanFact.</p></div>
        <button type="button" class="btn" id="cpt-mdp">Changer le mot de passe…</button>
      </div></section>
      <section class="cpt-carte cpt-code${actif ? '' : ' cpt-recommande'}" id="cpt-code"><div class="cpt-ligne">
        <span class="cpt-ico">${dessin('bouclier')}</span>
        <div class="cpt-quoi"><h3>Le code du téléphone <span class="badge ${etatCode[1]}" id="cpt-etat">${etatCode[0]}</span></h3>
          <p class="small muted">${explication}</p></div>
        ${actif ? '' : '<button type="button" class="btn btn-primary" id="cpt-activer">Activer le code</button>'}
      </div>
      ${actif ? `<div class="cpt-pied"><span class="small">Avec une application d'authentification · <b id="cpt-restants">${pl(c.codesSecours || 0, 'code de secours', 'codes de secours')}</b> ${(c.codesSecours || 0) > 1 ? 'restants' : 'restant'}</span>
        <span class="cpt-boutons"><button type="button" class="btn btn-sm" id="cpt-secours">Nouveaux codes de secours…</button><button type="button" class="btn btn-sm" id="cpt-changer">Changer de téléphone…</button>${c.codeExige ? '' : '<button type="button" class="btn btn-sm btn-danger" id="cpt-desactiver">Désactiver…</button>'}</span></div>` : ''}
      </section>
      <section class="cpt-carte cpt-discret"><div class="cpt-ligne">
        <span class="cpt-ico">${dessin('enveloppe')}</span>
        <div class="cpt-quoi"><b>${appareil[0]}</b><p class="small muted">${appareil[1]}</p></div>
      </div></section>
    </div>`;

    const $ = (/** @type {string} */ q) => /** @type {HTMLElement} */ (el.querySelector(q));
    $('#cpt-adresse').onclick = () => changerAdresse(outils, relais, moi.email, redessiner);
    $('#cpt-mdp').onclick = () => changerMotDePasse(outils, c.motDePasseMin || 10, redessiner);
    if ($('#cpt-activer')) $('#cpt-activer').onclick = () => activer(outils, false, redessiner);
    if ($('#cpt-changer')) $('#cpt-changer').onclick = () => activer(outils, true, redessiner);
    if ($('#cpt-secours')) $('#cpt-secours').onclick = () => nouveauxSecours(outils, redessiner);
    if ($('#cpt-desactiver')) $('#cpt-desactiver').onclick = () => desactiver(outils, relais, moi.email, redessiner);
  }

  // ── Changer d'adresse : le mot de passe actuel, puis (avec un relais) le code reçu à la nouvelle ──────────────────
  /** @param {Outils} o @param {boolean} relais @param {string} actuelle @param {() => void} fini */
  function changerAdresse(o, relais, actuelle, fini) {
    o.modal(`<h2>Changer d'adresse e-mail</h2>
      <p class="small muted">${relais ? 'La nouvelle adresse reçoit un code : elle ne remplace celle-ci qu\'une fois ce code tapé. L\'ancienne est prévenue.' : 'Ce serveur n\'envoie pas encore d\'e-mails : l\'adresse change tout de suite, et se vérifiera dès qu\'il le pourra.'}</p>
      <form id="cpt-f" class="cpt-form" novalidate>
        <label class="field">Ta nouvelle adresse e-mail<input type="email" id="cpt-nouvelle" autocomplete="email" inputmode="email"></label>
        <label class="field">Ton mot de passe actuel<input type="password" id="cpt-mdp-actuel" autocomplete="current-password"></label>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn btn-primary" id="cpt-ok">${relais ? 'Envoyer le code' : 'Changer l\'adresse'}</button></div>
        <p class="small cpt-alerte" role="alert"></p>
      </form>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        const nouvelle = $('#cpt-nouvelle').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nouvelle)) { refuser(racine, Object.assign(new Error('Ce n\'est pas une adresse e-mail : elle ressemble à nom@exemple.tn.'), { champ: 'adresse' }), { adresse: '#cpt-nouvelle' }); return; }
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/adresse', { adresse: nouvelle, motDePasse: $('#cpt-mdp-actuel').value }); } catch (x) { refuser(racine, x, { adresse: '#cpt-nouvelle', motDePasse: '#cpt-mdp-actuel' }); return; }
        if (!r.demande) { fermer(); o.toast('Adresse changée.'); fini(); return; }
        const demande = r.demande;
        const form = /** @type {HTMLElement} */ (racine.querySelector('#cpt-f'));
        form.innerHTML = `<p>On vient d'envoyer un code à <b>${esc(nouvelle)}</b>. Il reste valable 15 minutes.</p>
          <label class="field">Le code reçu à cette adresse<input type="text" id="cpt-code-adresse" class="cpt-code-champ" autocomplete="one-time-code" inputmode="numeric" maxlength="7"></label>
          <p class="small muted">Rien reçu ? Regarde dans les courriers indésirables. L'adresse de ton compte ne change pas sans ce code.</p>
          <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="submit" class="btn btn-primary" id="cpt-confirmer">Confirmer la nouvelle adresse</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer();
        $('#cpt-code-adresse').focus();
        surClic(racine, '#cpt-confirmer', async () => {
          effacerRefus(racine);
          try { await o.appel('POST', '/moi/adresse/confirmer', { demande, code: $('#cpt-code-adresse').value }); } catch (x) { refuser(racine, x, { code: '#cpt-code-adresse' }); return; }
          fermer();
          o.toast(`Adresse changée : un e-mail a prévenu ${actuelle}.`);
          fini();
        });
      });
    });
  }

  // ── Changer le mot de passe : l'actuel, puis le nouveau ; les autres sessions se ferment ──────────────────────────
  /** @param {Outils} o @param {number} min @param {() => void} fini */
  function changerMotDePasse(o, min, fini) {
    o.modal(`<h2>Changer le mot de passe</h2>
      <p class="small muted">Tes sessions ouvertes sur tes autres appareils se fermeront : il faudra t'y reconnecter avec le nouveau. Celle-ci reste ouverte.</p>
      <form class="cpt-form" novalidate>
        <label class="field">Ton mot de passe actuel<input type="password" id="cpt-actuel" autocomplete="current-password"></label>
        <label class="field">Le nouveau<input type="password" id="cpt-nouveau" autocomplete="new-password"></label>
        <p class="small muted">Au moins ${min} caractères ; un mot de passe déjà volé ailleurs est refusé. Une phrase de quelques mots est encore plus sûre.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn btn-primary" id="cpt-ok">Changer le mot de passe</button></div>
        <p class="small cpt-alerte" role="alert"></p>
      </form>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        try { await o.appel('POST', '/moi/mot-de-passe', { actuel: $('#cpt-actuel').value, nouveau: $('#cpt-nouveau').value }); } catch (x) { refuser(racine, x, { actuel: '#cpt-actuel', nouveau: '#cpt-nouveau' }); return; }
        fermer();
        o.toast('Mot de passe changé : tes autres sessions sont fermées.');
        fini();
      });
    });
  }

  // ── Activer le code (ou changer de téléphone) : préparé, puis activé par le premier code juste ───────────────────
  /** @param {Outils} o @param {boolean} changer @param {() => void} fini */
  function activer(o, changer, fini) {
    o.modal(`<h2>${changer ? 'Changer de téléphone' : 'Activer le code du téléphone'}</h2><div id="cpt-corps" class="cpt-form"></div>`, (racine, fermer) => {
      const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      /** @param {string} [actuel] */
      const preparer = async (actuel) => {
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/code/preparer', actuel === undefined ? {} : { code: actuel }); } catch (x) { refuser(racine, x, { code: '#cpt-actuel-code' }); return; }
        montrer(r);
      };
      /** @param {any} r */
      const montrer = (r) => {
        corps.innerHTML = `<ol class="cpt-etapes">
          <li><b>Installe une application d'authentification</b><span class="small muted">Gratuite, sur ton téléphone : Google Authenticator, Microsoft Authenticator… Si tu en as déjà une, passe à l'étape 2.</span></li>
          <li><b>Ajoute SkanFact</b><div class="cpt-qr"><div class="cpt-qr-image" role="img" aria-label="Le code QR à scanner avec ton application d'authentification">${qr(r.adresseApplication)}</div>
            <div class="small"><p>Dans l'application, choisis « Ajouter un compte », puis scanne ce code QR. Ou tape à la main cette clé :</p>
            <p class="cpt-cle"><code>${esc(parQuatre(r.cle))}</code> <button type="button" class="btn btn-sm" id="cpt-copier-cle">Copier</button></p>
            <p><a href="${esc(r.adresseApplication)}">Déjà sur ton téléphone ? Ouvrir dans l'application</a></p></div></div></li>
          <li><b>Mets tes codes de secours de côté</b><span class="small muted">Si tu perds ou changes de téléphone, chacun remplace une fois le code. Ils ne se montreront plus.</span>
            ${blocSecours(r.codesDeSecours)}
            <label class="check" id="cpt-garde-zone"><input type="checkbox" id="cpt-garde"> Je les ai mis de côté</label></li>
          <li><b>Tape le code que montre l'application</b>
            <label class="field">Le code de SkanFact dans l'application<input type="text" id="cpt-premier" class="cpt-code-champ" autocomplete="one-time-code" inputmode="numeric" maxlength="7"></label>
            <span class="small muted">Six chiffres, qui changent toutes les 30 secondes : on vérifie que ton téléphone donne le bon avant d'activer quoi que ce soit.</span></li>
        </ol>
        <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="button" class="btn btn-primary" id="cpt-ok">Vérifier et activer</button></div>
        <p class="small cpt-alerte" role="alert"></p>`;
        const dire = (/** @type {string} */ t) => { const a = racine.querySelector('[role=alert]'); if (a) a.textContent = t; };
        brancherSecours(racine, r.codesDeSecours, dire);
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-copier-cle')).onclick = async () => { dire(await copier(r.cle) ? 'Clé copiée.' : 'Ton navigateur refuse la copie : tape-la à la main.'); };
        /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer();
        surClic(racine, '#cpt-ok', async () => {
          effacerRefus(racine);
          // Les codes de secours ne se montreront plus : on n'active pas sans les avoir mis de côté.
          if (!$('#cpt-garde').checked) {
            refuser(racine, 'Mets d\'abord tes codes de secours de côté (copie-les ou télécharge-les), puis coche « Je les ai mis de côté ».');
            racine.querySelector('#cpt-garde-zone')?.classList.add('cpt-faute');
            $('#cpt-garde').focus();
            return;
          }
          try { await o.appel('POST', '/moi/code/activer', { code: $('#cpt-premier').value }); } catch (x) { refuser(racine, x, { code: '#cpt-premier' }); return; }
          fermer();
          o.toast(changer ? 'C\'est fait : SkanFact demandera le code de ton nouveau téléphone.' : 'Le code du téléphone est activé : il sera demandé sur chaque nouvel appareil.');
          fini();
        });
        $('#cpt-premier').focus();
      };
      if (!changer) { corps.innerHTML = '<p class="small muted">Un instant…</p><p class="small cpt-alerte" role="alert"></p>'; void preparer(); return; }
      // Changer de téléphone : le code actuel d'abord (une session volée ne suffit pas à mettre le sien à la place).
      corps.innerHTML = `<p class="small muted">Le code de ton téléphone actuel reste valable tant que le nouveau n'a pas donné son premier code.</p>
        <label class="field">Le code de ton téléphone actuel, ou un code de secours<input type="text" id="cpt-actuel-code" class="cpt-code-champ" autocomplete="one-time-code"></label>
        <p class="small muted">C'est ce qui prouve que c'est bien toi qui le demandes.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="button" class="btn btn-primary" id="cpt-continuer">Continuer</button></div>
        <p class="small cpt-alerte" role="alert"></p>`;
      /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer();
      surClic(racine, '#cpt-continuer', async () => { effacerRefus(racine); await preparer($('#cpt-actuel-code').value); });
      $('#cpt-actuel-code').focus();
    }, undefined, { garde: false });
  }

  // ── De nouveaux codes de secours : le code du moment, puis les nouveaux (les anciens ne valent plus) ───────────────
  /** @param {Outils} o @param {() => void} fini */
  function nouveauxSecours(o, fini) {
    o.modal(`<h2>De nouveaux codes de secours</h2>
      <div id="cpt-corps" class="cpt-form"><p class="small muted">Les anciens ne vaudront plus : utile si tu les as perdus, ou s'il t'en reste peu.</p>
        <label class="field">Le code de ton application, ou un code de secours<input type="text" id="cpt-actuel-code" class="cpt-code-champ" autocomplete="one-time-code"></label>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="cpt-ok">Créer de nouveaux codes</button></div>
        <p class="small cpt-alerte" role="alert"></p></div>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/code/secours', { code: $('#cpt-actuel-code').value }); } catch (x) { refuser(racine, x, { code: '#cpt-actuel-code' }); return; }
        const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
        corps.innerHTML = `<p class="small">Voici tes nouveaux codes : les anciens ne valent plus. Chacun remplace une fois le code du téléphone ; ils ne se montreront plus.</p>
          ${blocSecours(r.codesDeSecours)}
          <div class="modal-actions"><button type="button" class="btn btn-primary" id="cpt-fini">Je les ai mis de côté</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        brancherSecours(racine, r.codesDeSecours, (t) => { const a = racine.querySelector('[role=alert]'); if (a) a.textContent = t; });
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-fini')).onclick = () => { fermer(); fini(); };
        fini();
      });
    }, undefined, { garde: false });
  }

  // ── Désactiver le code : le code du moment (ou un code de secours) ; un e-mail le confirme ─────────────────────────
  /** @param {Outils} o @param {boolean} relais @param {string} email @param {() => void} fini */
  function desactiver(o, relais, email, fini) {
    o.modal(`<div id="cpt-corps" class="cpt-form"><span class="cpt-ico cpt-ico-alerte">${dessin('bouclierBarre')}</span>
      <h2>Désactiver le code du téléphone ?</h2>
      <p class="small">Sans lui, ton mot de passe suffira pour entrer dans ton compte, et dans chacune de tes entreprises.${relais ? ' Un e-mail te le confirmera, pour que tu le saches si ce n\'est pas toi.' : ''}</p>
      <label class="field">Le code de ton application, ou un code de secours<input type="text" id="cpt-actuel-code" class="cpt-code-champ" autocomplete="one-time-code"></label>
      <p class="small muted">C'est ce qui prouve que c'est bien toi qui le demandes.</p>
      <div class="modal-actions"><button type="button" class="btn btn-danger" id="cpt-ok">Désactiver</button><button type="button" class="btn btn-primary" data-close>Garder le code</button></div>
      <p class="small cpt-alerte" role="alert"></p></div>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/code/retirer', { code: $('#cpt-actuel-code').value }); } catch (x) { refuser(racine, x, { code: '#cpt-actuel-code' }); return; }
        const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
        corps.innerHTML = `<span class="cpt-ico">${dessin('enveloppe')}</span>
          <h2>Le code du téléphone est désactivé</h2>
          <p class="small">${r.confirme ? `Un e-mail de confirmation est parti à ${esc(email)}. ` : ''}Tu peux le réactiver quand tu veux, ici même.</p>
          <div class="modal-actions"><button type="button" class="btn btn-primary" id="cpt-fini">Revenir aux paramètres</button></div>`;
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-fini')).onclick = () => fermer();
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-fini')).focus();
        fini();
      });
    }, undefined, { garde: false });
  }

  // ── Tes appareils (brique 74 ; docs/hors-ligne.md, H9) : les voir, en retirer un ─────────────────────────────────
  /** @param {HTMLElement} el @param {{ appel: Outils['appel'] }} outils */
  async function appareils(el, outils) {
    /** @type {any[]} */ let liste;
    try { liste = (await outils.appel('GET', '/moi/appareils')).appareils; } catch (x) { el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p>`; return; }
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
        try { await outils.appel('DELETE', `/moi/appareils/${encodeURIComponent(String(bouton.dataset.retirer))}`); await appareils(el, outils); } catch (x) { bouton.removeAttribute('disabled'); dire(x); }
      };
    });
  }

  w.SkanCompte = { dessiner, appareils };
})();
