// @ts-check
// L'équipe de l'entreprise (lot équipe, 12/10/2026 ; migration 0079, docs/equipe.md) : l'onglet « L'équipe » des
// Paramètres, pour qui gère l'équipe (le propriétaire, un administrateur). Qui y travaille et avec quels rôles, les
// invitations qui attendent, et les gestes : inviter, donner un nouveau lien, annuler une invitation, changer les rôles
// de quelqu'un, le retirer.
//
// Les règles sont celles de la base (03 D4 à D7) ; l'écran ne propose que ce qu'elle accepte, et dit ses refus :
//   - un invité reçoit les rôles qu'on lui COCHE, aucun n'est coché d'avance (D5 : on élargit en le décidant) ;
//   - personne ne change ses propres rôles ni ceux du propriétaire, qui se transfèrent (D6, D4) : pas de menu sur ces
//     deux lignes ;
//   - plusieurs rôles se cumulent (D7).
// Le lien d'invitation n'est montré qu'une fois, juste après l'invitation : la base n'en garde que l'empreinte. Il part
// par les moyens de la personne qui invite (copier, WhatsApp, sa messagerie) : rien ne passe par le serveur d'envoi de
// SkanFact, qui ne reçoit donc aucune donnée de plus (règle du projet). Perdu, il se refait (« Donner un nouveau lien »),
// et l'ancien ne vaut plus.
//
// Le dessin reprend les aides de « Ton compte » (compte.js, chargé avant) : le refus dans la fenêtre, le geste qui se
// grise le temps de l'appel, la copie.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);

  // Les rôles d'une entreprise, en une phrase chacun (skanfact docs/cadrage/03-droits.md § 2).
  /** @type {Record<string, [string, string]>} */
  const ROLES = {
    proprietaire: ['Propriétaire', 'Tout, dont l\'abonnement, le comptable et la propriété'],
    administrateur: ['Administrateur', 'Tout, sauf l\'abonnement, le choix du comptable et la propriété. Il gère aussi l\'équipe'],
    commercial: ['Commercial', 'Vendre : devis, factures, clients, relances'],
    caissier: ['Caissier', 'La caisse'],
    serveur: ['Serveur', 'La salle : prendre les commandes, les envoyer en cuisine'],
    magasinier: ['Magasinier', 'Le stock : réceptions, livraisons, transferts, inventaires'],
    comptabilite_interne: ['Comptabilité interne', 'Achats, banque, déclarations, écritures. Pas la paie'],
    paie: ['Paie', 'Salariés, bulletins, déclarations sociales'],
    lecture: ['Lecture', 'Tout voir, rien changer (un associé, un banquier), sauf le détail de la paie'],
  };
  // L'ordre des cases : du plus étroit au plus large. « Serveur » attend la restauration (vague 1) : il ne se propose
  // pas encore, et se lit quand quelqu'un l'a.
  const PROPOSES = ['commercial', 'caissier', 'magasinier', 'comptabilite_interne', 'paie', 'lecture', 'administrateur'];
  /** @param {string} r */
  const nomRole = (r) => (ROLES[r] || [r])[0];

  /**
   * @typedef {{
   *   appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>,
   *   modal: (html: string, onMount?: (layer: HTMLElement, close: () => void) => void, onDismiss?: () => void, opts?: any) => () => void,
   *   toast: (texte: string, erreur?: boolean) => void,
   *   confirmDialog: (message: string, ok?: string, danger?: boolean, opts?: any) => Promise<boolean>,
   *   nom?: string,
   * }} Outils
   * @typedef {{ id: string, utilisateur: string, nom: string | null, email: string, roles: string[] }} Membre
   * @typedef {{ id: string, email: string, roles: string[], expire: string, courriel?: string | null }} Invitation
   */

  const aides = () => w.SkanCompte.aides;
  /** @param {Membre} m */
  const nomDe = (m) => (m.nom && m.nom.trim()) || m.email;
  /** @param {string[]} roles */
  const pastilles = (roles) => roles.map((r) => `<span class="eqp-role">${aides().esc(nomRole(r))}</span>`).join('');

  /** @param {HTMLElement} el @param {Outils} o */
  async function dessiner(el, o) {
    const { esc, jour, pl } = aides();
    /** @type {{ membres: Membre[], moi: string, donnables: string[], invitations: Invitation[] }} */
    let eq;
    try { eq = await o.appel('GET', '/equipe'); } catch (x) {
      el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p><button type="button" class="btn btn-sm" id="eqp-relire">Réessayer</button>`;
      /** @type {HTMLElement} */ (el.querySelector('#eqp-relire')).onclick = () => { void dessiner(el, o); };
      return;
    }
    const nomEntreprise = (o.nom || '').trim() || 'l\'entreprise';
    const redessiner = () => { void dessiner(el, o); };
    // Le propriétaire en tête, puis les administrateurs, puis les autres par leur nom : on lit d'abord qui décide.
    /** @param {Membre} m */
    const rang = (m) => (m.roles.includes('proprietaire') ? 0 : m.roles.includes('administrateur') ? 1 : 2);
    eq.membres.sort((a, b) => rang(a) - rang(b) || nomDe(a).localeCompare(nomDe(b), 'fr'));
    const seul = eq.membres.length <= 1;
    // Ce qu'on ne change pas ici : sa propre ligne (D6), et celle du propriétaire (la propriété se transfère).
    /** @param {Membre} m */
    const modifiable = (m) => m.utilisateur !== eq.moi && !m.roles.includes('proprietaire');

    const ligneMembre = (/** @type {Membre} */ m) => `<li class="eqp-ligne">
        <span class="eqp-avatar" aria-hidden="true">${esc(nomDe(m).slice(0, 1).toUpperCase())}</span>
        <div class="eqp-qui"><span class="eqp-nom"><b>${esc(nomDe(m))}</b>${m.utilisateur === eq.moi ? ' <span class="badge">toi</span>' : ''}</span>
          ${m.nom ? `<span class="small muted">${esc(m.email)}</span>` : ''}</div>
        <div class="eqp-roles">${pastilles(m.roles)}</div>
        ${modifiable(m) ? w.RowMenu.bouton(`M:${m.id}`, 'Actions') : '<span></span>'}
      </li>`;
    // Ce que son e-mail est devenu (0124 ; 0138, l'audit 1.42.0 A08) : sans réponse du relais ou refusé, la personne ne l'a
    // peut-être pas reçu — un nouveau lien (le menu) le refait, et l'ancien ne vaut plus.
    const courrielEnMots = (/** @type {string | null | undefined} */ c) => ({
      parti: ' · e-mail parti', a_envoyer: ' · e-mail en cours d\'envoi', en_attente: ' · e-mail en attente du relais',
      refuse: ' · e-mail refusé : donne-lui un nouveau lien, ou envoie-le toi-même',
      sans_reponse: ' · e-mail sans réponse du relais : donne-lui un nouveau lien, ou envoie-le toi-même',
    })[c ?? ''] ?? '';
    const ligneInvitation = (/** @type {Invitation} */ i) => `<li class="eqp-ligne eqp-attente">
        <span class="eqp-avatar" aria-hidden="true">@</span>
        <div class="eqp-qui"><span class="eqp-nom"><b>${esc(i.email)}</b></span>
          <span class="small muted">En attente : son lien vaut jusqu'au ${esc(jour(i.expire))}${courrielEnMots(i.courriel)}</span></div>
        <div class="eqp-roles">${pastilles(i.roles)}</div>
        ${w.RowMenu.bouton(`I:${i.id}`, 'Actions')}
      </li>`;

    el.innerHTML = `<div class="eqp">
      <div class="eqp-tete">
        <p class="small muted">${seul
          ? 'Pour l\'instant, il n\'y a que toi. Invite ton vendeur, ta caissière ou la personne qui tient tes achats : chacun entre avec son propre compte, et ne voit que ce que ses rôles lui ouvrent.'
          : 'Chacun entre avec son propre compte, et chaque geste porte le nom de qui l\'a fait. Ce que chacun voit et fait dépend de ses rôles ; avec plusieurs rôles, il a tout ce que chacun ouvre.'}</p>
        <button type="button" class="btn btn-primary" id="eqp-inviter">Inviter quelqu'un…</button>
      </div>
      <h3 class="eqp-titre">${pl(eq.membres.length, 'personne')} dans l'équipe</h3>
      <ul class="eqp-liste" id="eqp-membres">${eq.membres.map(ligneMembre).join('')}</ul>
      ${eq.invitations.length ? `<h3 class="eqp-titre">${eq.invitations.length > 1 ? 'Invitations qui attendent' : 'Une invitation qui attend'}</h3>
      <ul class="eqp-liste" id="eqp-invitations">${eq.invitations.map(ligneInvitation).join('')}</ul>` : ''}
    </div>`;

    /** @type {HTMLElement} */ (el.querySelector('#eqp-inviter')).onclick = () => inviter(o, eq.donnables, nomEntreprise, redessiner);
    w.RowMenu.brancherMenus(el, (/** @type {string} */ cle) => {
      const [genre, id] = [cle.slice(0, 1), cle.slice(2)];
      if (genre === 'M') {
        const m = eq.membres.find((x) => x.id === id);
        if (!m || !modifiable(m)) return [];
        return [
          { icon: 'modifier', label: 'Changer ses rôles…', hint: 'Ce qu\'il voit et fait dans l\'entreprise', run: () => changerRoles(o, m, eq.donnables, redessiner) },
          { sep: true },
          { icon: 'supprimer', label: 'Retirer de l\'équipe…', hint: 'Il n\'ouvre plus l\'entreprise ; ce qu\'il a fait garde son nom', danger: true, run: () => { void retirer(o, m, nomEntreprise, redessiner); } },
        ];
      }
      const i = eq.invitations.find((x) => x.id === id);
      if (!i) return [];
      return [
        { icon: 'copier', label: 'Donner un nouveau lien…', hint: 'Si le premier s\'est perdu : l\'ancien ne vaudra plus', run: () => { void envoyerInvitation(o, i.email, i.roles, nomEntreprise, redessiner); } },
        { sep: true },
        { icon: 'supprimer', label: 'Annuler l\'invitation', hint: 'Son lien ne vaudra plus', danger: true, run: () => { void annuler(o, i, redessiner); } },
      ];
    });
  }

  // Les cases des rôles : du plus étroit au plus large, chacune avec sa phrase. Un rôle que la personne a déjà et que
  // l'écran ne propose pas (« Serveur ») reste coché et se garde.
  /** @param {string[]} donnables @param {string[]} coches @param {string} legende */
  function casesRoles(donnables, coches, legende) {
    const { esc } = aides();
    const liste = [...PROPOSES.filter((r) => donnables.includes(r)), ...coches.filter((r) => !PROPOSES.includes(r) && donnables.includes(r))];
    return `<fieldset class="field eqp-choix" id="eqp-roles"><legend>${esc(legende)}</legend>
      ${liste.map((r) => `<label class="check eqp-case"><input type="checkbox" name="eqp-role" value="${esc(r)}"${coches.includes(r) ? ' checked' : ''}>
        <span><b>${esc(nomRole(r))}</b><span class="small muted"> — ${esc((ROLES[r] || ['', ''])[1])}</span></span></label>`).join('')}
    </fieldset>`;
  }
  /** @param {HTMLElement} racine */
  const rolesCoches = (racine) => [...racine.querySelectorAll('input[name="eqp-role"]:checked')].map((c) => /** @type {HTMLInputElement} */ (c).value);
  const AU_MOINS_UN = () => Object.assign(new Error('Coche au moins un rôle : c\'est lui qui dit ce que cette personne pourra faire.'), { champ: 'roles' });

  // ── Inviter : l'adresse et les rôles, puis le lien ──────────────────────────────────────────────────────────────
  /** @param {Outils} o @param {string[]} donnables @param {string} nomEntreprise @param {() => void} fini */
  function inviter(o, donnables, nomEntreprise, fini) {
    const { esc, refuser, effacerRefus, surClic } = aides();
    o.modal(`<h2>Inviter quelqu'un</h2>
      <p class="small muted">La personne reçoit un lien, par e-mail quand SkanFact peut l'envoyer. Elle l'ouvre, se connecte avec l'adresse que tu tapes ici — ou crée son compte avec elle — et rejoint ${esc(nomEntreprise)} avec les rôles que tu coches.</p>
      <form class="cpt-form" novalidate>
        <label class="field">Son adresse e-mail<input type="email" id="eqp-email" autocomplete="off" inputmode="email" spellcheck="false"></label>
        ${casesRoles(donnables, [], 'Ce qu\'il pourra faire')}
        <p class="small muted">Commence par le plus étroit : tu pourras lui en donner plus ensuite, d'un clic.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn btn-primary" id="eqp-ok">Inviter</button></div>
        <p class="small cpt-alerte" role="alert"></p>
      </form>`, (racine, fermer) => {
      const champ = /** @type {HTMLInputElement} */ (racine.querySelector('#eqp-email'));
      champ.focus();
      const cases = { email: '#eqp-email', roles: 'input[name="eqp-role"]' };
      surClic(racine, '#eqp-ok', async () => {
        effacerRefus(racine);
        // L'adresse telle que la base la range (en minuscules) : c'est elle que le message redit à la personne.
        const email = champ.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { refuser(racine, Object.assign(new Error('Ce n\'est pas une adresse e-mail : elle ressemble à nom@exemple.tn.'), { champ: 'email' }), cases); return; }
        const roles = rolesCoches(racine);
        if (!roles.length) { refuser(racine, AU_MOINS_UN(), cases); return; }
        /** @type {any} */ let r;
        try { r = await o.appel('POST', '/invitations', { email, roles }); } catch (x) { refuser(racine, x, cases); return; }
        fermer();
        fini();
        montrerLien(o, email, r, nomEntreprise);
      });
    });
  }

  // Un nouveau lien pour une invitation qui attend : la base remplace l'ancienne (0079), dont le lien ne vaut plus.
  /** @param {Outils} o @param {string} email @param {string[]} roles @param {string} nomEntreprise @param {() => void} fini */
  async function envoyerInvitation(o, email, roles, nomEntreprise, fini) {
    /** @type {any} */ let r;
    try { r = await o.appel('POST', '/invitations', { email, roles }); } catch (x) { o.toast(x instanceof Error ? x.message : String(x), true); return; }
    fini();
    montrerLien(o, email, r, nomEntreprise);
  }

  // Le lien, une seule fois. Quand le serveur a un relais d'e-mails, l'invitation est déjà partie par e-mail (0119) : le lien
  // reste ici en secours. Sinon, on le copie, ou on l'envoie par WhatsApp ou par sa messagerie (message déjà écrit).
  /** @param {Outils} o @param {string} email @param {{ jeton: string, expire: string, courriel?: boolean }} r @param {string} nomEntreprise */
  function montrerLien(o, email, r, nomEntreprise) {
    const { esc, jour, copier } = aides();
    const lien = `${location.origin}/?invitation=${encodeURIComponent(r.jeton)}`;
    const jusquau = jour(r.expire);
    const texte = `Bonjour,\n\nJe t'invite à rejoindre ${nomEntreprise} sur SkanFact. Ouvre ce lien, puis connecte-toi avec cette adresse (${email}) — ou crée ton compte avec elle :\n\n${lien}\n\nLe lien vaut jusqu'au ${jusquau}, une seule fois.`;
    const objet = `Invitation à rejoindre ${nomEntreprise} sur SkanFact`;
    const parti = r.courriel === true;
    o.modal(`<h2>${parti ? 'L\'invitation est partie' : 'L\'invitation est prête'}</h2>
      <p>${parti ? `Un e-mail est parti à <b>${esc(email)}</b> avec le lien.` : `Envoie ce lien à <b>${esc(email)}</b>.`} Il l'ouvre, se connecte avec cette adresse — ou crée son compte avec elle — et rejoint ${esc(nomEntreprise)}. Le lien vaut jusqu'au <b>${esc(jusquau)}</b>, une seule fois.${parti ? ' Le voici aussi, s\'il ne trouve pas l\'e-mail :' : ''}</p>
      <div class="eqp-lien"><input type="text" id="eqp-lien" readonly value="${esc(lien)}" aria-label="Le lien d'invitation"><button type="button" class="btn btn-primary" id="eqp-copier">Copier le lien</button></div>
      <div class="eqp-envois">
        <a class="btn" id="eqp-whatsapp" href="https://wa.me/?text=${encodeURIComponent(texte)}" target="_blank" rel="noopener">Envoyer par WhatsApp</a>
        <a class="btn" id="eqp-mail" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(texte)}">Envoyer par e-mail</a>
      </div>
      <p class="small muted">${parti ? 'L\'e-mail ne porte que son adresse, ton nom, l\'entreprise, son rôle et le lien. ' : 'Ce serveur n\'envoie pas d\'e-mails : le message part de ton téléphone ou de ta messagerie. '}SkanFact ne garde pas ce lien. S'il se perd, « Donner un nouveau lien » en refait un — l'ancien ne vaudra plus.</p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Fermer</button></div>`, (racine) => {
      const champ = /** @type {HTMLInputElement} */ (racine.querySelector('#eqp-lien'));
      /** @type {HTMLElement} */ (racine.querySelector('#eqp-copier')).onclick = async () => {
        o.toast(await copier(lien, champ) ? 'Lien copié : colle-le dans ton message.' : 'Lien sélectionné : copie-le (Ctrl+C).');
      };
    }, undefined, { garde: false });
  }

  // ── Changer les rôles de quelqu'un ───────────────────────────────────────────────────────────────────────────────
  /** @param {Outils} o @param {Membre} m @param {string[]} donnables @param {() => void} fini */
  function changerRoles(o, m, donnables, fini) {
    const { esc, refuser, effacerRefus, surClic } = aides();
    o.modal(`<h2>Les rôles de ${esc(nomDe(m))}</h2>
      <p class="small muted">Ce qu'il voit et fait dans l'entreprise. Le serveur applique ses nouveaux rôles dès maintenant ; son écran les prend la prochaine fois qu'il ouvre SkanFact.</p>
      <form class="cpt-form" novalidate>
        ${casesRoles(donnables, m.roles, 'Ce qu\'il peut faire')}
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn btn-primary" id="eqp-ok">Enregistrer ses rôles</button></div>
        <p class="small cpt-alerte" role="alert"></p>
      </form>`, (racine, fermer) => {
      const cases = { roles: 'input[name="eqp-role"]' };
      surClic(racine, '#eqp-ok', async () => {
        effacerRefus(racine);
        const roles = rolesCoches(racine);
        if (!roles.length) { refuser(racine, AU_MOINS_UN(), cases); return; }
        try { await o.appel('PUT', `/membres/${encodeURIComponent(m.id)}/roles`, { roles }); } catch (x) { refuser(racine, x, cases); return; }
        fermer();
        o.toast(`Rôles de ${nomDe(m)} enregistrés : ${roles.map(nomRole).join(', ')}.`);
        fini();
      });
    });
  }

  // ── Retirer quelqu'un : il n'ouvre plus l'entreprise ; ce qu'il a fait garde son nom ─────────────────────────────────
  /** @param {Outils} o @param {Membre} m @param {string} nomEntreprise @param {() => void} fini */
  async function retirer(o, m, nomEntreprise, fini) {
    const ok = await o.confirmDialog(`Retirer ${nomDe(m)} de l'équipe ?\n\nIl n'ouvrira plus ${nomEntreprise} : le serveur lui refuse tout dès maintenant. Ce qu'il a fait garde son nom, la trace ne s'efface pas, et son compte reste le sien. Pour le faire revenir, tu l'invites de nouveau.`, 'Retirer de l\'équipe', true);
    if (!ok) return;
    try { await o.appel('DELETE', `/membres/${encodeURIComponent(m.id)}`); } catch (x) { o.toast(x instanceof Error ? x.message : String(x), true); return; }
    o.toast(`${nomDe(m)} ne fait plus partie de l'équipe.`);
    fini();
  }

  // ── Annuler une invitation : elle se refait d'un clic, donc sans question ────────────────────────────────────────────
  /** @param {Outils} o @param {Invitation} i @param {() => void} fini */
  async function annuler(o, i, fini) {
    try { await o.appel('DELETE', `/invitations/${encodeURIComponent(i.id)}`); } catch (x) { o.toast(x instanceof Error ? x.message : String(x), true); return; }
    o.toast(`Invitation de ${i.email} annulée : son lien ne vaut plus.`);
    fini();
  }

  w.SkanEquipe = { dessiner, ROLES, PROPOSES };
})();
