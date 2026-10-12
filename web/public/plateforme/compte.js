// @ts-check
// Ton compte (lot onboarding, décision de Skander du 09/10/2026 ; maquettes validées ; migration 0076, docs/entree.md) :
// le premier onglet des Paramètres de l'entreprise et des Réglages du Cabinet, le même dans les deux. Ton adresse e-mail
// (vérifiée ou non), ton mot de passe, ton code de connexion — au choix (décision de Skander du 12/10/2026, 0081) :
// par e-mail (par défaut), par SMS ou par une application, avec ses codes de secours —, ce que demande un nouvel
// appareil, et tes appareils.
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
    sms: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9.5 8h5M9.5 11.5h3"/><path d="M11 18h2"/>',
    appli: '<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M12 9.5V11l1 .8"/><path d="M11 18h2"/>',
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
    // Le code de connexion (0081) : « sms », « application », ou rien (l'e-mail par défaut, quand ce serveur en envoie ;
    // le mot de passe seul sinon).
    /** @type {'sms' | 'application' | null} */
    const methode = moi.code_methode === 'application' || moi.code_methode === 'sms' ? moi.code_methode : null;
    const actif = methode !== null;
    const relais = !!c.courriel;
    const redessiner = () => { void dessiner(el, outils); };

    const etatCode = methode === 'sms' ? 'Par SMS' : methode === 'application' ? 'Par application' : relais ? 'Par e-mail' : 'Mot de passe seul';
    const explication = c.codeExige && !actif
      ? 'Il est exigé de chaque comptable d\'un cabinet, qui voit les comptes et les salaires de ses clients : choisis le SMS ou une application.'
      : actif || relais
        ? 'Sur un appareil que SkanFact ne connaît pas, il faut ton mot de passe et ce code : personne n\'entre à ta place avec ton seul mot de passe.'
        : 'Ce serveur n\'envoie pas encore d\'e-mails : ton mot de passe suffit. Recommandé : un code par SMS ou dans une application, en plus.';
    // Les trois choix ; celui du compte est marqué, les autres disent le geste qui y mène.
    /** @param {string} cle @param {keyof typeof DESSINS} ico @param {string} nom @param {string} texte @param {boolean} choisi @param {string} geste */
    const option = (cle, ico, nom, texte, choisi, geste) => `<li class="cpt-option${choisi ? ' cpt-choisi' : ''}" data-methode="${cle}">
        <span class="cpt-ico">${dessin(ico)}</span>
        <div class="cpt-quoi"><b>${nom}${choisi ? ` <span class="badge cpt-ok">${dessin('coche')}Choisi</span>` : ''}</b><p class="small muted">${texte}</p></div>${geste}</li>`;
    const courriel = option('courriel', 'enveloppe', relais ? 'Par e-mail' : 'Le mot de passe seul',
      relais ? `Un code part à <b>${esc(moi.email)}</b> quand tu te connectes depuis un nouvel appareil. Rien à installer.` : 'Ce serveur n\'envoie pas encore d\'e-mails : sans SMS ni application, rien d\'autre n\'est demandé.',
      !actif, !actif ? '' : c.codeExige ? '<span class="small muted cpt-geste">Exigé : SMS ou application</span>'
        : `<button type="button" class="btn btn-sm" id="cpt-desactiver">${relais ? 'Revenir à l\'e-mail…' : 'Désactiver le code…'}</button>`);
    const sms = option('sms', 'sms', 'Par SMS',
      methode === 'sms' ? `Au <b id="cpt-telephone" class="cpt-masque">${esc(c.telephone || '')}</b>. Le code arrive en quelques secondes ; il faut du réseau mobile.`
        : c.sms ? 'Un code arrive par SMS sur ton mobile tunisien quand tu te connectes depuis un nouvel appareil.' : 'Ce serveur n\'envoie pas de SMS pour l\'instant.',
      methode === 'sms', methode === 'sms' ? '<button type="button" class="btn btn-sm" id="cpt-sms">Changer de numéro…</button>'
        : c.sms ? '<button type="button" class="btn btn-sm" id="cpt-sms">Recevoir par SMS…</button>' : '');
    const appli = option('application', 'appli', 'Par une application',
      'Un code qui change toutes les 30 secondes, dans Google Authenticator ou Microsoft Authenticator. Le plus sûr, et il marche sans réseau.',
      methode === 'application', methode === 'application' ? '<button type="button" class="btn btn-sm" id="cpt-changer">Changer de téléphone…</button>'
        : '<button type="button" class="btn btn-sm" id="cpt-activer">Utiliser une application…</button>');
    const recommande = !actif && (!relais || c.codeExige);
    const appareil = actif
      ? [`Un nouvel appareil demande ${methode === 'sms' ? 'le code reçu par SMS' : 'le code de ton application'}`, 'C\'est lui qui prouve que c\'est toi sur un appareil que SkanFact ne connaît pas : il remplace l\'e-mail.']
      : relais
        ? ['Un nouvel appareil se vérifie par e-mail', 'Quand tu te connectes depuis un appareil que SkanFact ne connaît pas, un code part à ton adresse. L\'appareil est ensuite reconnu 30 jours.']
        : ['Un nouvel appareil entre avec le mot de passe', 'Ce serveur n\'envoie pas encore d\'e-mails : rien d\'autre n\'est demandé sur un nouvel appareil. Un code par SMS ou dans une application le protège.'];
    // Vérifier l'adresse sans en changer (0077) : qui a le code du téléphone ne reçoit jamais de code par e-mail à la
    // connexion. La phrase disait « elle se vérifie à ta prochaine connexion », ce qui était faux pour lui.
    const adresseNote = c.adresseVerifiee
      ? 'Une nouvelle adresse se vérifie elle aussi par un code, avant de remplacer celle-ci.'
      : relais ? 'Un code part à cette adresse ; tapé ici, il prouve qu\'elle est bien à toi. C\'est elle qui te rend ton compte si tu oublies ton mot de passe.'
        : 'Ce serveur n\'envoie pas encore d\'e-mails : tu pourras la vérifier dès qu\'il le pourra.';

    el.innerHTML = `<div class="cpt">
      <section class="cpt-carte"><div class="cpt-ligne">
        <div class="cpt-quoi"><span class="cpt-etiquette">Ton adresse e-mail</span>
          <div class="cpt-valeur"><strong id="cpt-email">${esc(moi.email)}</strong>${c.adresseVerifiee ? `<span class="badge cpt-ok">${dessin('coche')}Vérifiée</span>` : '<span class="badge cpt-attente">À vérifier</span>'}</div>
          <p class="small muted">${adresseNote}</p></div>
        ${!c.adresseVerifiee && relais ? '<button type="button" class="btn btn-primary" id="cpt-verifier">Vérifier mon adresse</button>' : ''}
        <button type="button" class="btn" id="cpt-adresse">Changer d'adresse…</button>
      </div></section>
      <section class="cpt-carte"><div class="cpt-ligne">
        <div class="cpt-quoi"><span class="cpt-etiquette">Ton mot de passe</span>
          <p class="small muted">Il n'est gardé qu'en empreinte : personne ne peut le lire, pas même SkanFact.</p></div>
        <button type="button" class="btn" id="cpt-mdp">Changer le mot de passe…</button>
      </div></section>
      <section class="cpt-carte cpt-code${recommande ? ' cpt-recommande' : ''}" id="cpt-code"><div class="cpt-ligne">
        <span class="cpt-ico">${dessin('bouclier')}</span>
        <div class="cpt-quoi"><h3>Ton code de connexion <span class="badge ${actif || relais ? 'cpt-ok' : 'cpt-eteint'}" id="cpt-etat">${etatCode}</span></h3>
          <p class="small muted">${explication}</p></div>
      </div>
      <ul class="cpt-options" aria-label="Où recevoir ton code de connexion">${courriel}${sms}${appli}</ul>
      ${actif ? `<div class="cpt-pied"><span class="small">Si ${methode === 'sms' ? 'ton mobile n\'est pas là' : 'tu perds ton téléphone'} : <b id="cpt-restants">${pl(c.codesSecours || 0, 'code de secours', 'codes de secours')}</b> ${(c.codesSecours || 0) > 1 ? 'restants' : 'restant'}</span>
        <span class="cpt-boutons"><button type="button" class="btn btn-sm" id="cpt-secours">Nouveaux codes de secours…</button></span></div>` : ''}
      </section>
      <section class="cpt-carte cpt-discret"><div class="cpt-ligne">
        <span class="cpt-ico">${dessin('enveloppe')}</span>
        <div class="cpt-quoi"><b>${appareil[0]}</b><p class="small muted">${appareil[1]}</p></div>
      </div></section>
    </div>`;

    const $ = (/** @type {string} */ q) => /** @type {HTMLElement} */ (el.querySelector(q));
    $('#cpt-adresse').onclick = () => changerAdresse(outils, relais, moi.email, redessiner);
    if ($('#cpt-verifier')) $('#cpt-verifier').onclick = () => verifierAdresse(outils, moi.email, redessiner);
    $('#cpt-mdp').onclick = () => changerMotDePasse(outils, c.motDePasseMin || 10, redessiner);
    if ($('#cpt-activer')) $('#cpt-activer').onclick = () => activer(outils, methode, redessiner);
    if ($('#cpt-changer')) $('#cpt-changer').onclick = () => activer(outils, methode, redessiner);
    if ($('#cpt-sms')) $('#cpt-sms').onclick = () => activerSms(outils, methode, redessiner);
    if ($('#cpt-secours')) $('#cpt-secours').onclick = () => nouveauxSecours(outils, methode, redessiner);
    if ($('#cpt-desactiver')) $('#cpt-desactiver').onclick = () => desactiver(outils, methode, relais, moi.email, redessiner);
  }

  // ── Vérifier son adresse (0077) : un code y part ; tapé, il la prouve ──────────────────────────────────────────────
  /** @param {Outils} o @param {string} adresse @param {() => void} fini */
  function verifierAdresse(o, adresse, fini) {
    o.modal(`<h2>Vérifier ton adresse e-mail</h2>
      <p class="small muted">Un code va partir à <b>${esc(adresse)}</b>. Le taper ici prouve que cette adresse est bien à toi : c'est elle qui te rend ton compte si tu oublies ton mot de passe.</p>
      <form id="cpt-f" class="cpt-form" novalidate>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn btn-primary" id="cpt-ok">Envoyer le code</button></div>
        <p class="small cpt-alerte" role="alert"></p>
      </form>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/adresse/verifier'); } catch (x) { refuser(racine, x); return; }
        const demande = r.demande;
        const form = /** @type {HTMLElement} */ (racine.querySelector('#cpt-f'));
        form.innerHTML = `<p>On vient d'envoyer un code à <b>${esc(adresse)}</b>. Il reste valable 15 minutes.</p>
          <label class="field">Le code reçu à cette adresse<input type="text" id="cpt-code-adresse" class="cpt-code-champ" autocomplete="one-time-code" inputmode="numeric" maxlength="7"></label>
          <p class="small muted">Rien reçu ? Regarde dans les courriers indésirables.</p>
          <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="submit" class="btn btn-primary" id="cpt-confirmer">Vérifier mon adresse</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer();
        $('#cpt-code-adresse').focus();
        surClic(racine, '#cpt-confirmer', async () => {
          effacerRefus(racine);
          try { await o.appel('POST', '/moi/adresse/verifier/confirmer', { demande, code: $('#cpt-code-adresse').value }); } catch (x) { refuser(racine, x, { code: '#cpt-code-adresse' }); return; }
          fermer();
          o.toast('Adresse vérifiée.');
          fini();
        });
      });
    });
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

  // ── Prouver le code actuel (0081) : celui de l'application, ou celui reçu par SMS (demandé ici), ou un code de secours ─
  /** @param {'sms' | 'application' | null} methode @param {string} [libelle] */
  const champActuel = (methode, libelle) => `<label class="field">${libelle || (methode === 'sms' ? 'Le code reçu par SMS, ou un code de secours' : 'Le code de ton application, ou un code de secours')}<input type="text" id="cpt-actuel-code" class="cpt-code-champ" autocomplete="one-time-code"></label>
    ${methode === 'sms' ? '<p class="cpt-preuve"><button type="button" class="btn btn-sm" id="cpt-preuve">M\'envoyer un code par SMS</button><span class="small muted" id="cpt-preuve-dit" aria-live="polite"></span></p>' : ''}`;
  /** @param {HTMLElement} racine @param {Outils} o */
  function brancherPreuve(racine, o) {
    surClic(racine, '#cpt-preuve', async () => {
      effacerRefus(racine);
      /** @type {any} */ let r;
      try { r = await o.appel('POST', '/moi/code/sms/preuve', {}); } catch (x) { refuser(racine, x); return; }
      const dit = racine.querySelector('#cpt-preuve-dit');
      if (dit) dit.textContent = `Code envoyé au ${r.telephone} : il vaut 10 minutes, une fois.`;
      const b = racine.querySelector('#cpt-preuve');
      if (b) b.textContent = 'Renvoyer le SMS';
      /** @type {HTMLInputElement | null} */ (racine.querySelector('#cpt-actuel-code'))?.focus();
    });
  }

  // ── Utiliser une application (ou changer de téléphone) : préparé, puis activé par le premier code juste ───────────
  /** @param {Outils} o @param {'sms' | 'application' | null} methode @param {() => void} fini */
  function activer(o, methode, fini) {
    const changer = methode === 'application';
    o.modal(`<h2>${changer ? 'Changer de téléphone' : 'Utiliser une application d\'authentification'}</h2><div id="cpt-corps" class="cpt-form"></div>`, (racine, fermer) => {
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
          o.toast(changer ? 'C\'est fait : SkanFact demandera le code de ton nouveau téléphone.' : 'C\'est fait : SkanFact demandera le code de ton application sur chaque nouvel appareil.');
          fini();
        });
        $('#cpt-premier').focus();
      };
      if (!methode) { corps.innerHTML = '<p class="small muted">Un instant…</p><p class="small cpt-alerte" role="alert"></p>'; void preparer(); return; }
      // Un code déjà en place (changer de téléphone, ou passer du SMS à l'application) : l'actuel d'abord (une session
      // volée ne suffit pas à mettre son téléphone à la place du sien).
      corps.innerHTML = `<p class="small muted">${changer ? 'Le code de ton téléphone actuel reste valable tant que le nouveau n\'a pas donné son premier code.' : 'Le SMS reste ton code tant que l\'application n\'a pas donné son premier code.'}</p>
        ${champActuel(methode, changer ? 'Le code de ton téléphone actuel, ou un code de secours' : undefined)}
        <p class="small muted">C'est ce qui prouve que c'est bien toi qui le demandes.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="button" class="btn btn-primary" id="cpt-continuer">Continuer</button></div>
        <p class="small cpt-alerte" role="alert"></p>`;
      /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer();
      brancherPreuve(racine, o);
      surClic(racine, '#cpt-continuer', async () => { effacerRefus(racine); await preparer($('#cpt-actuel-code').value); });
      $('#cpt-actuel-code').focus();
    }, undefined, { garde: false });
  }

  // ── Recevoir le code par SMS (ou changer de numéro) : un code part au numéro, puis le code reçu l'active (0081) ──────
  /** @param {Outils} o @param {'sms' | 'application' | null} methode @param {() => void} fini */
  function activerSms(o, methode, fini) {
    const changer = methode === 'sms';
    o.modal(`<h2>${changer ? 'Changer de numéro' : 'Recevoir ton code par SMS'}</h2><div id="cpt-corps" class="cpt-form"></div>`, (racine, fermer) => {
      const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      const annuler = () => { /** @type {HTMLElement} */ (racine.querySelector('[data-close-code]')).onclick = () => fermer(); };
      let numero = '';
      const etapeNumero = () => {
        const avant = methode === 'sms' ? 'Ton numéro actuel reste celui du compte tant que le nouveau n\'a pas reçu et donné son code.'
          : methode === 'application' ? 'Ton application reste ton code tant que le SMS n\'a pas donné son premier code.'
            : 'Quand tu te connecteras depuis un appareil que SkanFact ne connaît pas, un code à six chiffres arrivera par SMS sur ce numéro.';
        corps.innerHTML = `<p class="small muted">${avant}</p>
          ${methode ? champActuel(methode) : ''}
          <label class="field">Ton numéro de mobile<input type="tel" id="cpt-numero" autocomplete="tel-national" inputmode="tel" placeholder="22 123 456" value="${esc(numero)}"></label>
          <p class="small muted">Un mobile tunisien, huit chiffres. Seuls ce numéro et le code partent chez le fournisseur de SMS.</p>
          <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="button" class="btn btn-primary" id="cpt-envoyer">Envoyer le code</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        annuler();
        brancherPreuve(racine, o);
        surClic(racine, '#cpt-envoyer', async () => {
          effacerRefus(racine);
          numero = $('#cpt-numero').value;
          /** @type {any} */ let r;
          try { r = await o.appel('POST', '/moi/code/sms/preparer', { telephone: numero, ...(methode ? { code: $('#cpt-actuel-code').value } : {}) }); } catch (x) { refuser(racine, x, { telephone: '#cpt-numero', code: '#cpt-actuel-code' }); return; }
          etapeCode(String(r.telephone));
        });
        (methode ? $('#cpt-actuel-code') : $('#cpt-numero')).focus();
      };
      /** @param {string} masque */
      const etapeCode = (masque) => {
        corps.innerHTML = `<p>On vient d'envoyer un code par SMS au <b class="cpt-masque">${esc(masque)}</b>. Il reste valable 15 minutes.</p>
          <label class="field">Le code reçu par SMS<input type="text" id="cpt-code-sms" class="cpt-code-champ" autocomplete="one-time-code" inputmode="numeric" maxlength="7"></label>
          <p class="small muted cpt-preuve">Rien reçu ? <button type="button" class="btn btn-sm" id="cpt-autre">Corriger le numéro ou renvoyer</button></p>
          <div class="modal-actions"><button type="button" class="btn" data-close-code>Annuler</button><button type="button" class="btn btn-primary" id="cpt-ok">Vérifier et activer</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        annuler();
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-autre')).onclick = () => etapeNumero();
        surClic(racine, '#cpt-ok', async () => {
          effacerRefus(racine);
          /** @type {any} */ let r;
          try { r = await o.appel('POST', '/moi/code/sms/activer', { code: $('#cpt-code-sms').value }); } catch (x) { refuser(racine, x, { code: '#cpt-code-sms' }); return; }
          etapeSecours(masque, r.codesDeSecours);
          // La carte, derrière la fenêtre, dit déjà le SMS.
          fini();
        });
        $('#cpt-code-sms').focus();
      };
      // Le SMS est activé : ses codes de secours, montrés une fois.
      /** @param {string} masque @param {string[]} codes */
      const etapeSecours = (masque, codes) => {
        corps.innerHTML = `<p class="small"><b>C'est fait :</b> ton code arrivera désormais par SMS au <span class="cpt-masque">${esc(masque)}</span>. Voici tes codes de secours : si ton mobile n'est pas là, chacun remplace une fois le code. Ils ne se montreront plus.</p>
          ${blocSecours(codes)}
          <div class="modal-actions"><button type="button" class="btn btn-primary" id="cpt-fini">Je les ai mis de côté</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        brancherSecours(racine, codes, (t) => { const a = racine.querySelector('[role=alert]'); if (a) a.textContent = t; });
        const b = /** @type {HTMLElement} */ (racine.querySelector('#cpt-fini'));
        b.onclick = () => { fermer(); o.toast(changer ? 'C\'est fait : ton code arrivera à ton nouveau numéro.' : 'C\'est fait : ton code arrivera par SMS sur chaque nouvel appareil.'); };
        b.focus();
      };
      etapeNumero();
    }, undefined, { garde: false });
  }

  // ── De nouveaux codes de secours : le code du moment, puis les nouveaux (les anciens ne valent plus) ───────────────
  /** @param {Outils} o @param {'sms' | 'application' | null} methode @param {() => void} fini */
  function nouveauxSecours(o, methode, fini) {
    o.modal(`<h2>De nouveaux codes de secours</h2>
      <div id="cpt-corps" class="cpt-form"><p class="small muted">Les anciens ne vaudront plus : utile si tu les as perdus, ou s'il t'en reste peu.</p>
        ${champActuel(methode)}
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="cpt-ok">Créer de nouveaux codes</button></div>
        <p class="small cpt-alerte" role="alert"></p></div>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      brancherPreuve(racine, o);
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/code/secours', { code: $('#cpt-actuel-code').value }); } catch (x) { refuser(racine, x, { code: '#cpt-actuel-code' }); return; }
        const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
        corps.innerHTML = `<p class="small">Voici tes nouveaux codes : les anciens ne valent plus. Chacun remplace une fois ton code ; ils ne se montreront plus.</p>
          ${blocSecours(r.codesDeSecours)}
          <div class="modal-actions"><button type="button" class="btn btn-primary" id="cpt-fini">Je les ai mis de côté</button></div>
          <p class="small cpt-alerte" role="alert"></p>`;
        brancherSecours(racine, r.codesDeSecours, (t) => { const a = racine.querySelector('[role=alert]'); if (a) a.textContent = t; });
        /** @type {HTMLElement} */ (racine.querySelector('#cpt-fini')).onclick = () => { fermer(); fini(); };
        fini();
      });
    }, undefined, { garde: false });
  }

  // ── Revenir à l'e-mail (ou, sans relais, désactiver le code) : le code du moment ; un e-mail le confirme ───────────
  /** @param {Outils} o @param {'sms' | 'application' | null} methode @param {boolean} relais @param {string} email @param {() => void} fini */
  function desactiver(o, methode, relais, email, fini) {
    const quoi = methode === 'sms' ? 'le SMS' : 'l\'application';
    o.modal(`<div id="cpt-corps" class="cpt-form"><span class="cpt-ico cpt-ico-alerte">${dessin('bouclierBarre')}</span>
      <h2>${relais ? 'Revenir au code par e-mail ?' : 'Désactiver le code ?'}</h2>
      <p class="small">${relais ? `Sur un nouvel appareil, ton code arrivera à ${esc(email)} au lieu de ${quoi} : celui qui lit tes e-mails pourrait alors entrer avec ton mot de passe. Un e-mail te le confirmera, pour que tu le saches si ce n'est pas toi.`
        : 'Sans lui, ton mot de passe suffira pour entrer dans ton compte, et dans chacune de tes entreprises.'}</p>
      ${champActuel(methode)}
      <p class="small muted">C'est ce qui prouve que c'est bien toi qui le demandes.</p>
      <div class="modal-actions"><button type="button" class="btn btn-danger" id="cpt-ok">${relais ? 'Revenir à l\'e-mail' : 'Désactiver'}</button><button type="button" class="btn btn-primary" data-close>Garder ${quoi}</button></div>
      <p class="small cpt-alerte" role="alert"></p></div>`, (racine, fermer) => {
      const $ = (/** @type {string} */ q) => /** @type {HTMLInputElement} */ (racine.querySelector(q));
      brancherPreuve(racine, o);
      surClic(racine, '#cpt-ok', async () => {
        effacerRefus(racine);
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/moi/code/retirer', { code: $('#cpt-actuel-code').value }); } catch (x) { refuser(racine, x, { code: '#cpt-actuel-code' }); return; }
        const corps = /** @type {HTMLElement} */ (racine.querySelector('#cpt-corps'));
        corps.innerHTML = `<span class="cpt-ico">${dessin('enveloppe')}</span>
          <h2>${relais ? 'Ton code arrive désormais par e-mail' : 'Le code est désactivé'}</h2>
          <p class="small">${r.confirme ? `Un e-mail de confirmation est parti à ${esc(email)}. ` : ''}Tu peux choisir le SMS ou une application quand tu veux, ici même.</p>
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

  // `aides` : ce que les autres panneaux des Paramètres reprennent tel quel (l'équipe, equipe.js) — un refus dit de la
  // même façon partout, et une seule copie de chaque geste.
  w.SkanCompte = { dessiner, appareils, aides: { esc, jour, pl, refuser, effacerRefus, surClic, copier } };
})();
