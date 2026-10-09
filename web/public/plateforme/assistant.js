// @ts-check
// L'assistant de démarrage au nouveau style (lot onboarding ; maquettes validées par Skander le 09/10/2026 ; docs/entree.md) :
// « Où te joindre ? » (Ton entreprise, 2 sur 2 : la porte a déjà demandé la raison sociale et le matricule), puis « Que
// fais-tu ? », « Factures-tu la TVA ? » et « De quoi as-tu besoin ? » (Ton activité, 1 à 3 sur 3). Il est dessiné comme
// l'entrée : le fond pointé, le fil des étapes, et à droite la facture qui se dessine pendant qu'on répond.
//
// Il remplace l'assistant de la v10 (`runSetup`, web/v10/assistant.txt) et en garde chaque règle :
//   - il écrit à chaque étape : fermer la page en route reprend là où l'on s'était arrêté, sur ce poste ou un autre. Quand
//     on le REVOIT (Paramètres → L'application), rien ne s'écrit avant la fin : des réglages ne sont pas un brouillon ;
//   - un régime ou un menu choisi à la main ne se fait plus écraser par le métier (`regimeTouche`, `modulesTouche`) ;
//   - « Plus tard » ne jette rien de ce qui est tapé ;
//   - ce qu'il ÉCRIT passe par la v10 elle-même (`OB.applySetup` : la fiche, le métier, le régime, le catalogue de départ,
//     les modules), et ce qu'il MONTRE est lu sur la vraie facture (`apercu`, le modèle de la v10) et le vrai menu
//     (`menu`) : le haut, le pied, les totaux et la mention d'une facture ne sont jamais recomposés ici.
// Une règle change : le catalogue de départ se verse à la fin. Versé au premier « Continuer » (comme dans la v10), il
// restait celui du premier métier cliqué quand on revenait en choisir un autre.
(function () {
  'use strict';

  /** @param {unknown} s */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

  /** @type {Record<string, string>} */
  const DESSINS = {
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    retour: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    coche: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    alerte: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  };
  /** @param {string} id */
  const dessin = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DESSINS[id] || ''}</svg>`;

  // Le dessin de chaque métier (ceux des maquettes) ; un métier ajouté plus tard à la v10 prend celui d'« Autre activité ».
  /** @type {Record<string, string>} */
  const METIERS = {
    informatique: 'M4 5h16v10H4z M2 19h20',
    batiment: 'M4 15a8 8 0 0 1 16 0 M2 15h20v3H2z M12 7v4',
    conseil: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z',
    commerce: 'M6 8h12l-1 12H7z M9 8V6a3 3 0 0 1 6 0v2',
    sante: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
    artisanat: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z',
    restauration: 'M5 8h12v5a6 6 0 0 1-12 0z M17 9h2a2 2 0 0 1 0 4h-2 M8 3v3 M12 3v3',
    transport: 'M2 6h11v10H2z M13 9h4l4 4v3h-8z M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    immobilier: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6',
    juridique: 'M12 3v18 M5 7h14 M5 7l-3 6a3 3 0 0 0 6 0z M19 7l-3 6a3 3 0 0 0 6 0z M8 21h8',
    comptabilite: 'M6 3h12v18H6z M9 7h6 M9 11h1 M14 11h1 M9 15h1 M14 15h1',
    architecture: 'M12 3l-7 18 M12 3l7 18 M8 14h8',
    communication: 'M3 8h4l2-3h6l2 3h4v11H3z M12 17a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7',
    beaute: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M18 6l-2.5 2.5 M8.5 15.5 6 18',
    automobile: 'M3 13l2-5h14l2 5v5H3z M3 13h18 M7 18v2 M17 18v2',
    autre: 'M5 12h.01 M12 12h.01 M19 12h.01',
  };
  /** @param {string} id */
  const dessinMetier = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${METIERS[id] || METIERS.autre}"/></svg>`;

  // L'unité d'un article, dite comme on la lit sur un prix (« 250,000 DT par mois ») ; une unité inconnue, telle quelle.
  /** @type {Record<string, string>} */
  const UNITES = { u: 'l’unité', h: 'l’heure', mois: 'par mois', forfait: 'au forfait', jour: 'la journée', séance: 'la séance', lot: 'le lot',
    km: 'le km', 'm²': 'le m²', couvert: 'le couvert', course: 'la course', bulletin: 'le bulletin' };

  // Les étapes : le fil du haut (ton compte → ton entreprise → ton activité) et ce que chacune demande.
  const COORDONNEES = { id: 'coordonnees', fil: 1, puce: 'Ton entreprise · 2 sur 2', titre: 'Où te joindre ?' };
  const ACTIVITE = { id: 'activite', fil: 2, puce: 'Ton activité · 1 sur 3', titre: 'Que fais-tu ?' };
  const TVA = { id: 'tva', fil: 2, puce: 'Ton activité · 2 sur 3', titre: 'Factures-tu la TVA ?' };
  const MENU = { id: 'menu', fil: 2, puce: 'Ton activité · 3 sur 3', titre: 'De quoi as-tu besoin ?' };
  const ETAPES = [COORDONNEES, ACTIVITE, TVA, MENU];
  // Les réglages de départ, ceux que posait l'assistant de la v10 : un timbre de 1 dinar, trente jours de validité et de
  // paiement, pas de retenue (À VÉRIFIER avec un comptable ; ils se changent dans Paramètres → Documents).
  const DEFAUTS = { currency: 'DT', stampFee: 1, quoteValidityDays: 30, paymentTermsDays: 30, defaultWithholdingRate: 0 };
  const INDICATIF = '+216';
  // Ce que dit chaque régime, à la première personne : la mention vient du régime lui-même (C.REGIMES).
  /** @type {Record<string, { titre: string, texte: (r: any) => string, courant?: boolean }>} */
  const REGIMES = {
    reel: { titre: 'Oui, je facture la TVA (régime réel)', courant: true,
      texte: () => 'Tu ajoutes la TVA à tes prix, tu la déclares chaque mois et tu récupères celle de tes achats.' },
    forfaitaire: { titre: 'Non, je suis au forfait',
      texte: (r) => `Pas de TVA sur tes factures : elles portent « ${r.mention} », sans colonne TVA.` },
    exonere: { titre: 'Non, mon activité est exonérée',
      texte: (r) => `La mention « ${r.mention} » remplace la colonne TVA sur tes documents.` },
  };

  /**
   * Ouvre l'assistant. Rend `true` quand il est allé au bout (« Ouvrir mon entreprise »), `false` quand on l'a fermé.
   * @param {{ rejoue: boolean, C: any, OB: any, donnees: () => any, enregistrer: () => void,
   *   apercu: (co: any, lignes?: any[]) => string, menu: (modules: string[]) => { id: string, titre: string, famille?: string }[],
   *   deconnecter: () => void, courriel: () => Promise<string> }} o
   * @returns {Promise<boolean>}
   */
  function ouvrir(o) {
    const { C, OB } = o;
    const rejoue = !!o.rejoue;
    const donnees = () => o.donnees() || {};
    const societe = () => donnees().company || {};
    /** Un texte de l'écran, à la française (C.typoFr : l'espace fine avant « ? », « : »…), puis échappé. @param {string} s */
    const dit = (s) => esc(C.typoFr(s));
    return new Promise((resolve) => {
      const c0 = { ...societe() };
      const reprise = !rejoue && !!c0.setupStarted;
      // Les réponses : celles déjà enregistrées (une reprise, un rejeu), sinon les réglages de départ.
      /** @type {any} */
      const a = rejoue ? { ...c0, activity: c0.activity || '', fillCatalog: false }
        : { ...DEFAUTS, ...c0, activity: c0.activity || '', fillCatalog: !(donnees().catalog || []).length };
      if (!Array.isArray(a.modules)) delete a.modules;
      a.modulesTouche = Array.isArray(a.modules);
      a.regimeTouche = !!String(c0.taxRegime || '').trim();
      let i = reprise ? Math.min(Math.max(Number(c0.setupStep) || 0, 0), ETAPES.length - 1) : 0;
      let courriel = '';

      const racine = document.createElement('div');
      racine.id = 'setup';
      racine.className = 'as';
      // Le reste de la page ne se touche plus tant que l'assistant est là, au clavier non plus.
      const endormis = [...document.body.children].filter((el) => el.tagName !== 'SCRIPT' && !el.hasAttribute('inert'));
      endormis.forEach((el) => el.setAttribute('inert', ''));
      document.body.appendChild(racine);
      /** @param {string} s @returns {any} */
      const $ = (s) => racine.querySelector(s);

      /** @param {boolean} fait */
      const fermer = (fait) => {
        clearTimeout(minuteur);
        racine.remove();
        endormis.forEach((el) => el.removeAttribute('inert'));
        resolve(fait);
      };

      // ── Ce qui s'enregistre ──────────────────────────────────────────────────────────────────────────────────────
      // Le menu tel qu'il s'enregistrera : le cœur (toujours là) et ce qui est choisi.
      const modulesChoisis = () => {
        const coeur = C.MODULES.filter((/** @type {any} */ m) => m.toujours).map((/** @type {any} */ m) => m.id);
        const liste = Array.isArray(a.modules) ? a.modules : C.modulesSuggeres(a.activity);
        return coeur.concat(liste.filter((/** @type {string} */ x) => C.moduleById(x) && !C.moduleById(x).toujours));
      };
      // Les réponses d'une étape intermédiaire : sans le catalogue (il se verse à la fin), et sans un menu qu'on n'a pas
      // encore choisi (sinon une reprise le croirait choisi, et ne le rangerait plus d'après le métier).
      const enCours = () => ({ ...a, fillCatalog: false, modules: a.modulesTouche ? a.modules : undefined });
      /** L'étape atteinte, écrite (jamais en rejeu). @param {number} n */
      const ecrire = (n) => {
        if (rejoue) return;
        try { OB.applySetup(donnees(), enCours(), { done: false, step: n }); o.enregistrer(); } catch { /* l'écran suivant s'ouvre quand même ; la fin réécrit tout */ }
      };
      // La fiche telle qu'elle s'enregistrerait maintenant : la règle de la v10 (`applySetup`) sur une copie.
      const societeApercue = () => {
        const d = { company: { ...societe() }, catalog: [], documents: [] };
        try { OB.applySetup(d, enCours(), { done: false, step: i }); } catch { /* l'aperçu montre la fiche telle quelle */ }
        return d.company;
      };
      // La vraie facture, lue : le modèle de la v10 l'écrit, on y prend ce qu'on montre.
      /** @param {any} co @param {any[]} [lignes] */
      const facture = (co, lignes) => {
        try { return new DOMParser().parseFromString(o.apercu(co, lignes), 'text/html'); } catch { return null; }
      };
      /** Les lignes d'un bloc de la facture (son texte, coupé à chaque saut de ligne). @param {Element | null} el */
      const lignesDe = (el) => el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.textContent || '').trim()).filter(Boolean) : [];
      /** @param {Document | null} d @param {string} s */
      const texteDe = (d, s) => ((d && d.querySelector(s)) || { textContent: '' }).textContent.trim();

      // ── Le téléphone : « +216 » se montre devant la case, et s'enregistre avec le numéro ─────────────────────────
      /** @param {unknown} v */
      const telPourLaCase = (v) => { const s = String(v || '').trim(); return s.startsWith(INDICATIF) ? s.slice(INDICATIF.length).trim() : s; };
      /** Un numéro qui porte déjà son indicatif (« +33… », « 0033… ») reste tel quel. @param {string} v */
      const telEnregistre = (v) => { const s = String(v || '').trim(); return !s ? '' : /^(\+|00)/.test(s) ? s : `${INDICATIF} ${s}`; };

      // ── Le haut de la page : la marque, le fil, la sortie ───────────────────────────────────────────────────────
      /** @param {{ fil: number }} e */
      const barre = (e) => {
        const noms = ['Ton compte', 'Ton entreprise', 'Ton activité'];
        const fil = noms.map((nom, k) => {
          const etat = k < e.fil ? 'fait' : k === e.fil ? 'actuelle' : '';
          return (k ? `<li class="trait${k <= e.fil ? ' fait' : ''}" aria-hidden="true"></li>` : '')
            + `<li class="${etat}"${etat === 'actuelle' ? ' aria-current="step"' : ''}><span class="rond">${etat === 'fait' ? dessin('coche') : k + 1}</span><span class="nom">${dit(nom)}</span></li>`;
        }).join('');
        // Revoir l'assistant n'écrit rien avant la fin : le bouton le dit avant le geste.
        const sortie = rejoue ? 'Fermer sans rien changer' : 'Se déconnecter';
        return `<header class="as-barre"><span class="as-marque"><span class="as-logo" aria-hidden="true">S</span><span>SkanFact</span></span>
          <ol class="as-fil" aria-label="Les étapes">${fil}</ol><button type="button" class="as-lien gris" id="as-sortir">${dit(sortie)}</button></header>`;
      };
      /** @param {{ puce: string, titre: string }} e @param {string} sous */
      const tete = (e, sous) => `<div class="as-tete"><span class="as-puce">${dit(e.puce)}</span><h1 tabindex="-1">${dit(e.titre)}</h1><p>${dit(sous)}</p></div>`;
      const retour = `<button type="button" class="as-lien" id="as-retour">${dessin('retour')}Retour</button>`;
      /** @param {string} libelle */
      const suite = (libelle) => `<button type="submit" class="as-principal" id="as-suite">${dit(libelle)}${dessin('fleche')}</button>`;

      // ── 1. Où te joindre ? ──────────────────────────────────────────────────────────────────────────────────────
      const devise = () => C.normCurrency ? C.normCurrency(societe().currency || 'DT') : (societe().currency || 'DT');
      const corpsCoordonnees = () => {
        const tel = telPourLaCase(a.phone);
        return `<div class="as-deux"><form class="as-col" id="as-form" novalidate>
          ${tete(COORDONNEES, 'Tes clients le liront sous ton nom, sur chaque devis et chaque facture. Rien n\'est obligatoire ici : ce qui reste vide ne s\'imprime pas.')}
          <label class="as-champ" id="ch-address"><span class="as-lib">Adresse</span>
            <textarea name="address" rows="2" autocomplete="street-address" placeholder="Rue et numéro, puis code postal et ville">${esc(a.address || '')}</textarea></label>
          <div class="as-rang">
            <div class="as-champ" id="ch-phone"><label class="as-lib" for="as-tel">Téléphone</label>
              <div class="as-groupe"><span class="avant" id="as-indicatif"${/^(\+|00)/.test(tel) ? ' hidden' : ''}>${INDICATIF}</span>
                <input id="as-tel" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" value="${esc(tel)}" placeholder="55 123 456"></div></div>
            <div class="as-champ" id="ch-email"><label class="as-lib" for="as-mail">Adresse e-mail de l'entreprise</label>
              <input id="as-mail" name="email" type="email" autocomplete="email" spellcheck="false" value="${esc(a.email || '')}" placeholder="contact@exemple.tn">
              <button type="button" class="as-geste" id="as-mail-compte" hidden></button></div>
          </div>
          <div class="as-rang">
            <div class="as-champ" id="ch-rc"><label class="as-lib" for="as-rc">Registre de commerce <small>Si tu en as un</small></label>
              <input id="as-rc" name="rc" class="mono" spellcheck="false" autocapitalize="characters" value="${esc(a.rc || '')}" placeholder="B123456789"></div>
            <div class="as-champ" id="ch-capital"><label class="as-lib" for="as-cap">Capital social <small>Pour une société</small></label>
              <div class="as-groupe"><input id="as-cap" name="capital" inputmode="numeric" value="${esc(a.capital || '')}" placeholder="10 000"><span class="apres">${esc(devise())}</span></div></div>
          </div>
          <div class="as-pied"><div class="as-pied-gauche"><button type="button" class="as-lien gris" id="as-plus-tard">${dit('Je le ferai plus tard')}</button></div>${suite('Continuer')}</div>
        </form><div class="as-apercu" id="as-apercu" aria-hidden="true">${apercuHaut()}</div></div>`;
      };
      // La facture, lue sur la vraie : le nom, le métier (sa devise), l'adresse, le matricule et les contacts en haut ; le
      // registre et le capital au pied, là où ils s'impriment.
      const apercuHaut = () => {
        const co = societeApercue();
        const d = facture(co);
        if (!d) return '';
        const coord = lignesDe(d.querySelector('.brand .addr'));
        const pied = lignesDe(d.querySelector('.footer .f-left'));
        const tag = texteDe(d, '.brand .tag');
        const logo = co.logo ? `<img class="as-logo-image" src="${esc(co.logo)}" alt="">` : '<span class="as-logo-vide">Ton<br>logo</span>';
        return `<span class="as-etiquette">Ta facture</span>
          <div class="as-feuille" id="as-feuille"><div class="as-feuille-haut">
            <div class="as-qui">${logo}<div class="as-coord" id="as-coord"><strong>${esc(texteDe(d, '.brand .name'))}</strong>${tag ? `<em>${esc(tag)}</em>` : ''}${coord.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>
            <div class="as-quoi"><span>${esc(texteDe(d, '.title .kind'))}</span><span data-chiffres>${esc(texteDe(d, '.title .number'))}</span></div></div>
            <div class="as-barres"><i style="width:62%"></i><i style="width:48%"></i><div class="ligne"><i style="width:40%"></i><i style="width:14%"></i></div></div>
            ${pied.length ? `<div class="as-pied-feuille" id="as-pied-feuille">${pied.map(esc).join('<br>')}</div>` : ''}</div>
          <span class="as-note">${dit('Le logo, la couleur et le RIB viennent après, dans « Tes premiers pas ».')}</span>`;
      };
      const lireCoordonnees = () => {
        const f = $('#as-form');
        if (!f) return;
        a.address = String(f.address.value || '').trim();
        a.phone = telEnregistre(f.phone.value);
        a.email = String(f.email.value || '').trim();
        a.rc = String(f.rc.value || '').trim();
        a.capital = String(f.capital.value || '').trim();
      };
      const brancherCoordonnees = () => {
        const f = $('#as-form');
        const mail = $('#as-mail'), puce = $('#as-mail-compte');
        // « Utiliser l'adresse de ton compte » : proposée tant que la case est vide.
        const proposer = () => {
          puce.hidden = !courriel || !!mail.value.trim();
          puce.textContent = courriel ? `Utiliser ${courriel}` : '';
        };
        proposer();
        if (!courriel) o.courriel().then((x) => { courriel = String(x || '').trim(); if ($('#as-mail-compte')) proposer(); }).catch(() => undefined);
        puce.onclick = () => { mail.value = courriel; oter(); proposer(); mail.focus(); f.dispatchEvent(new Event('input')); };
        f.addEventListener('input', (/** @type {Event} */ ev) => {
          const cible = /** @type {any} */ (ev.target);
          if (cible && cible.id === 'as-tel') $('#as-indicatif').hidden = /^(\+|00)/.test(cible.value.trim());
          if (cible && cible.id === 'as-mail') { oter(); proposer(); }
          lireCoordonnees();
          bientot(() => { const z = $('#as-apercu'); if (z) z.innerHTML = apercuHaut(); });
        });
        f.onsubmit = (/** @type {Event} */ ev) => {
          ev.preventDefault();
          lireCoordonnees();
          if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) {
            return refuser('#ch-email', mail, 'Cette adresse n\'a pas la forme d\'une adresse e-mail (nom@domaine.tn) : corrige-la, ou laisse la case vide.');
          }
          aller(1);
        };
        $('#as-plus-tard').onclick = () => { lireCoordonnees(); aller(1); };
      };

      // ── 2. Que fais-tu ? ────────────────────────────────────────────────────────────────────────────────────────
      /** @param {any} x */
      const detailMetier = (x) => !x.catalog.length ? 'catalogue vide'
        : `${x.catalog.length} ${x.catalog.length > 1 ? 'articles proposés' : 'article proposé'}${x.honoraires ? ' ·\u00a0honoraires' : ''}`;
      const corpsActivite = () => `${tete(ACTIVITE, 'On te prépare un catalogue de départ et le bon nom pour tes factures. Rien n\'est figé : tout se change ensuite dans Paramètres.')}
        <div class="as-refus" id="as-refus-metier" role="alert" hidden></div>
        <fieldset class="as-grille" id="as-metiers" aria-label="Ton métier">
          ${C.ACTIVITIES.map((/** @type {any} */ x) => `<label class="as-tuile"><input type="radio" name="metier" value="${esc(x.id)}"${a.activity === x.id ? ' checked' : ''}>
            <span class="ico">${dessinMetier(x.id)}</span><span class="txt"><b>${esc(x.label)}</b><small>${dit(detailMetier(x))}</small></span></label>`).join('')}
        </fieldset>
        <section class="as-bloc" id="as-catalogue" aria-labelledby="as-cat-titre">${blocCatalogue()}</section>
        <div class="as-pied"><div class="as-pied-gauche">${retour}<button type="button" class="as-lien gris" id="as-plus-tard">Plus tard</button></div>${suite('Continuer')}</div>`;
      // Le catalogue que le métier propose, ses prix d'exemple, et ce que le métier change d'autre (la note d'honoraires, le
      // régime proposé à l'écran suivant).
      const blocCatalogue = () => {
        const act = C.ACTIVITIES.find((/** @type {any} */ x) => x.id === a.activity);
        const deja = (donnees().catalog || []).length;
        const titre = '<h2 id="as-cat-titre">Ton catalogue de départ</h2>';
        if (!act) return `<div class="gauche">${titre}<p>${dit('Choisis ton métier : les articles qu\'il propose s\'affichent ici, avec un prix d\'exemple.')}</p></div>`;
        const notes = [];
        if (act.honoraires) notes.push('Tes factures s\'appelleront « notes d\'honoraires », comme le veut ta profession.');
        const propose = C.regimeSuggere(act.id);
        if (propose && !a.regimeTouche) {
          const r = C.regimeOf({ taxRegime: propose });
          notes.push(`À l'écran suivant, « ${r.court} » sera déjà choisi : c'est souvent le cas de ton métier (À VÉRIFIER avec ton comptable).`);
        }
        const infos = notes.map((n) => `<span class="as-info">${dessin('info')}<span>${dit(n)}</span></span>`).join('');
        if (deja) {
          return `<div class="gauche">${titre}<p>${dit(`Ton catalogue a déjà ${deja} ${deja > 1 ? 'articles' : 'article'} : il ne change pas.`)}</p>${infos}</div>`;
        }
        const n = act.catalog.length;
        const cur = devise();
        const articles = !n ? `<p class="as-vide">${dit('Ton catalogue restera vide : tu y ajouteras tes produits et tes prestations quand tu voudras.')}</p>`
          : act.catalog.map((/** @type {any[]} */ [label, , prix, unite]) => `<div class="as-article${a.fillCatalog ? '' : ' estompe'}"><span class="nom">${esc(label)}</span>
            <span class="prix"><span>${prix > 0 ? esc(C.money(prix, cur)) : 'prix à fixer'}</span><span>${esc(UNITES[unite] || unite || '')}</span></span></div>`).join('');
        return `<div class="gauche">${titre}
            <p>${dit('Ce que tu vends, prêt à glisser dans un devis en un clic, sans retaper le nom ni le prix. Les prix sont des exemples : ajuste-les ensuite.')}</p>
            ${n ? `<label class="as-case"><input type="checkbox" id="as-remplir"${a.fillCatalog ? ' checked' : ''}><span>${dit(`Ajouter ${n > 1 ? `ces ${n} articles` : 'cet article'} à mon catalogue`)}</span></label>` : ''}
            ${infos}</div>
          <div class="droite" id="as-articles">${articles}</div>`;
      };
      const brancherActivite = () => {
        const bloc = $('#as-catalogue');
        const brancherCase = () => {
          const c = $('#as-remplir');
          if (c) c.onchange = () => { a.fillCatalog = c.checked; racine.querySelectorAll('.as-article').forEach((/** @type {Element} */ el) => el.classList.toggle('estompe', !c.checked)); };
        };
        brancherCase();
        racine.querySelectorAll('input[name=metier]').forEach((/** @type {any} */ r) => {
          r.onchange = () => {
            a.activity = r.value;
            // Le métier PROPOSE son régime tant que personne n'a choisi le sien (la règle de la v10, 7.22.0).
            if (!a.regimeTouche) a.taxRegime = C.regimeSuggere(a.activity);
            $('#as-refus-metier').hidden = true;
            bloc.innerHTML = blocCatalogue();
            brancherCase();
          };
        });
        $('#as-suite').onclick = () => {
          // L'écran se traversait sans rien choisir dans la v10, et la case « préremplir » promettait un catalogue qui
          // n'arrivait jamais : « Continuer » demande un métier ; « Plus tard » est là pour qui ne veut pas choisir.
          if (!a.activity) {
            const refus = $('#as-refus-metier');
            refus.innerHTML = `${dessin('alerte')}<span>${dit('Choisis ton métier : il prépare ton catalogue et le nom de tes factures. Aucun ne correspond ? « Autre activité ». Pas encore décidé ? « Plus tard ».')}</span>`;
            refus.hidden = false;
            refus.scrollIntoView({ block: 'nearest' });
            /** @type {any} */ (racine.querySelector('input[name=metier]')).focus({ preventScroll: true });
            return;
          }
          aller(2);
        };
        $('#as-plus-tard').onclick = () => aller(2);
      };

      // ── 3. Factures-tu la TVA ? ─────────────────────────────────────────────────────────────────────────────────
      const regimeCoche = () => C.regimeOf({ taxRegime: a.taxRegime }).id;
      const corpsTva = () => `<div class="as-deux"><div class="as-col">
          ${tete(TVA, 'C\'est ce qui décide des colonnes de tes factures et de tes déclarations. Regarde le bas de ta facture changer selon ton choix.')}
          <fieldset class="as-choix" aria-label="Ton régime de TVA">
            ${C.REGIMES.map((/** @type {any} */ r) => {
              /** @type {{ titre: string, texte: (r: any) => string, courant?: boolean }} */
              const t = REGIMES[r.id] || { titre: r.label, texte: () => r.aide };
              return `<label class="as-option"><input type="radio" name="regime" value="${esc(r.id)}"${regimeCoche() === r.id ? ' checked' : ''}>
                <span class="txt"><span class="titre">${dit(t.titre)}${t.courant ? '<span class="badge">Le plus courant</span>' : ''}</span><span>${dit(t.texte(r))}</span></span></label>`;
            }).join('')}
          </fieldset>
          <p class="as-avertir">${dessin('alerte')}<span><b>${dit('À vérifier avec ton comptable.')}</b> ${dit('Le régime dépend de ton chiffre d\'affaires et de ta forme juridique. Pas sûr ? Garde « Oui » et pose-lui la question : ça se change dans Paramètres, et tes factures déjà émises ne bougent pas.')}</span></p>
          <div class="as-pied"><div class="as-pied-gauche">${retour}</div>${suite('Continuer')}</div>
        </div><div class="as-apercu" id="as-apercu" aria-hidden="true">${apercuBas()}</div></div>`;
      // Le bas de la vraie facture : une ligne du métier choisi (ou de ton catalogue), ses totaux, et la mention qui remplace
      // la colonne TVA quand le régime n'en facture pas.
      const apercuBas = () => {
        const co = societeApercue();
        const act = C.ACTIVITIES.find((/** @type {any} */ x) => x.id === a.activity);
        const modele = (act ? act.catalog.map((/** @type {any[]} */ [label, , unitPrice, unit]) => ({ label, unit, unitPrice })) : [])
          .concat((donnees().catalog || []).map((/** @type {any} */ x) => ({ label: x.label, unit: x.unit, unitPrice: Number(x.unitPrice) || 0 })))
          .find((/** @type {{ unitPrice: number }} */ x) => x.unitPrice > 0) || { label: 'Prestation de service', unit: 'u', unitPrice: 500 };
        const d = facture(co, [C.newLine(co, { label: modele.label, unit: modele.unit || 'u', qty: 1, unitPrice: modele.unitPrice })]);
        if (!d) return '';
        const entetes = [...d.querySelectorAll('table.lines thead th')].map((th) => (th.textContent || '').trim());
        const cellules = [...d.querySelectorAll('table.lines tbody tr:first-child td')].map((td) => ((td.childNodes[0] || {}).textContent || '').trim());
        const avecTva = entetes.length >= 5;
        const totaux = [...d.querySelectorAll('table.totals tr')].map((tr) => {
          const [libelle, valeur] = [...tr.querySelectorAll('td')];
          return !valeur ? `<div class="mention" id="as-mention">${esc(((libelle || {}).textContent || '').trim())}</div>`
            : `<div><span>${esc(lignesDe(libelle || null).join(' '))}</span><span>${esc((valeur.textContent || '').trim())}</span></div>`;
        }).join('');
        const gv = d.querySelector('.grand .gv');
        const net = gv ? `${(gv.childNodes[0] && gv.childNodes[0].textContent || '').trim()} ${texteDe(d, '.grand .gv small')}` : '';
        const timbre = Number(co.stampFee) || 0;
        return `<span class="as-etiquette">Le bas de ta facture</span>
          <div class="as-feuille" id="as-feuille"><div class="as-lignes">
            <div class="entete"><span>${esc(entetes[0] || '')}</span><span class="nombres">${avecTva ? `<span>${esc(entetes[3])}</span>` : ''}<span>${esc(entetes[entetes.length - 1] || '')}</span></span></div>
            <div class="ligne"><span>${esc(modele.label)}</span><span class="nombres">${avecTva ? `<span class="taux">${esc(cellules[3] || '')}</span>` : ''}<span>${esc(cellules[cellules.length - 1] || '')}</span></span></div></div>
            <div class="as-totaux" id="as-totaux">${totaux}<div class="net"><span>${esc(texteDe(d, '.grand .gl'))}</span><span>${esc(net)}</span></div></div></div>
          ${timbre ? `<span class="as-note">${dit(`Le timbre fiscal (${C.money(timbre, devise())}) s'ajoute à chaque facture, quel que soit le régime.`)}</span>` : ''}`;
      };
      const brancherTva = () => {
        racine.querySelectorAll('input[name=regime]').forEach((/** @type {any} */ r) => {
          r.onchange = () => {
            a.taxRegime = r.value;
            a.regimeTouche = true;            // un choix fait à la main ne se fait plus écraser par le métier
            const z = $('#as-apercu'); if (z) z.innerHTML = apercuBas();
          };
        });
        $('#as-suite').onclick = () => {
          // « Réel » coché sans y toucher s'enregistre comme tel : vide voulait déjà dire réel, et la v10 le lit pareil.
          if (!String(a.taxRegime || '').trim()) a.taxRegime = regimeCoche();
          aller(3);
        };
      };

      // ── 4. De quoi as-tu besoin ? ───────────────────────────────────────────────────────────────────────────────
      const corpsMenu = () => {
        if (!a.modulesTouche) a.modules = C.modulesSuggeres(a.activity);
        const proposes = C.modulesSuggeres(a.activity);
        const coeur = C.MODULES.filter((/** @type {any} */ m) => m.toujours).map((/** @type {any} */ m) => m.label);
        return `<div class="as-deux"><div class="as-col">
          ${tete(MENU, 'On range ton menu d\'après ton métier. Rien n\'est supprimé : ce qui n\'y est pas se retrouve par la recherche, et revient tout seul dès qu\'il sert.')}
          <div class="as-toujours">${dessin('coche')}<span><b>${dit('Toujours là :')}</b> ${esc(coeur.join(', '))}.</span></div>
          <div class="as-modules" role="group" aria-label="Les modules de ton menu">
            ${C.MODULES.filter((/** @type {any} */ m) => !m.toujours).map((/** @type {any} */ m) => `<label class="as-module"><input type="checkbox" role="switch" data-module="${esc(m.id)}"${a.modules.includes(m.id) ? ' checked' : ''}>
              <span class="piste" aria-hidden="true"></span><span class="txt"><b>${esc(m.label)}</b><span>${dit(m.quoi)}</span>${proposes.includes(m.id) ? '<span class="propose">Proposé pour ton métier</span>' : ''}</span></label>`).join('')}
          </div>
          <div class="as-pied"><div class="as-pied-gauche">${retour}</div>${suite(rejoue ? 'Enregistrer mes réponses' : 'Ouvrir mon entreprise')}</div>
        </div><aside class="as-apercu etroit" id="as-apercu" aria-label="Aperçu de ton menu">${apercuMenu()}</aside></div>`;
      };
      // Le vrai menu (celui que la barre de gauche dessinera), rangé par famille comme elle.
      const apercuMenu = () => {
        /** @type {{ nom: string, pages: { id: string, titre: string }[] }[]} */
        const familles = [];
        o.menu(modulesChoisis()).forEach((p) => {
          const nom = p.famille || '';
          const g = familles[familles.length - 1];
          if (g && g.nom === nom) g.pages.push(p); else familles.push({ nom, pages: [p] });
        });
        return `<span class="as-etiquette">Ton menu</span><ul class="as-menu" id="as-menu">
            <li class="qui"><span class="as-logo" aria-hidden="true">S</span><span><b>SkanFact</b>${esc(societe().name || '')}</span></li>
            ${familles.map((g) => (g.nom ? `<li class="famille">${esc(g.nom)}</li>` : '') + g.pages.map((p) => `<li class="page${p.id === 'dashboard' ? ' accueil' : ''}">${esc(p.titre)}</li>`).join('')).join('')}
          </ul><span class="as-note">${dit('Tout se change ensuite dans Paramètres → L\'application.')}</span>`;
      };
      const brancherMenu = () => {
        racine.querySelectorAll('input[data-module]').forEach((/** @type {any} */ c) => {
          c.onchange = () => {
            const liste = (Array.isArray(a.modules) ? a.modules : C.modulesSuggeres(a.activity)).filter((/** @type {string} */ x) => x !== c.dataset.module);
            if (c.checked) liste.push(c.dataset.module);
            a.modules = liste;
            a.modulesTouche = true;           // un choix fait à la main ne se fait plus écraser
            const z = $('#as-apercu'); if (z) z.innerHTML = apercuMenu();
          };
        });
        $('#as-suite').onclick = () => {
          if (!a.modulesTouche) a.modules = C.modulesSuggeres(a.activity);
          OB.applySetup(donnees(), { ...a, modules: modulesChoisis() });
          o.enregistrer();
          fermer(true);
        };
      };

      // ── Les refus, le dessin d'un écran, le passage de l'un à l'autre ─────────────────────────────────────────────
      // Un refus dit ce qui est refusé et pourquoi, sous la case, qu'il montre et où il pose le curseur.
      /** @param {string} champ @param {any} el @param {string} texte */
      const refuser = (champ, el, texte) => {
        oter();
        const c = $(champ);
        c.classList.add('faute');
        const r = document.createElement('div');
        r.className = 'as-refus';
        r.setAttribute('role', 'alert');
        r.innerHTML = `${dessin('alerte')}<span>${dit(texte)}</span>`;
        c.appendChild(r);
        el.setAttribute('aria-invalid', 'true');
        el.focus();
        r.scrollIntoView({ block: 'nearest' });
      };
      const oter = () => {
        racine.querySelectorAll('.as-champ.faute').forEach((/** @type {Element} */ c) => c.classList.remove('faute'));
        racine.querySelectorAll('.as-champ .as-refus').forEach((/** @type {Element} */ r) => r.remove());
        racine.querySelectorAll('[aria-invalid]').forEach((/** @type {Element} */ x) => x.removeAttribute('aria-invalid'));
      };
      /** @type {any} */ let minuteur = null;
      /** L'aperçu suit la frappe, sans la ralentir. @param {() => void} f */
      const bientot = (f) => { clearTimeout(minuteur); minuteur = setTimeout(f, 120); };

      const CORPS = { coordonnees: corpsCoordonnees, activite: corpsActivite, tva: corpsTva, menu: corpsMenu };
      const BRANCHER = { coordonnees: brancherCoordonnees, activite: brancherActivite, tva: brancherTva, menu: brancherMenu };
      const dessiner = () => {
        const e = ETAPES[i] || COORDONNEES;
        const id = /** @type {keyof typeof CORPS} */ (e.id);
        racine.innerHTML = `<div class="as-page">${barre(e)}<main class="as-scene" id="as-scene" data-etape="${id}">${CORPS[id]()}</main></div>`;
        BRANCHER[id]();
        $('#as-sortir').onclick = () => {
          if (rejoue) { fermer(false); return; }
          // Rien de ce qui est tapé ne se perd, même en partant : la reprise le retrouvera.
          if (e.id === 'coordonnees') lireCoordonnees();
          ecrire(i);
          o.deconnecter();
        };
        const r = $('#as-retour');
        if (r) r.onclick = () => aller(i - 1);
        racine.scrollTop = 0;
        const h1 = $('h1');
        if (h1) h1.focus({ preventScroll: true });
      };
      /** @param {number} n */
      const aller = (n) => {
        clearTimeout(minuteur);
        i = Math.min(Math.max(n, 0), ETAPES.length - 1);
        ecrire(i);
        dessiner();
      };

      // À l'ouverture, l'étape atteinte s'écrit tout de suite (sauf en rejeu) : fermer la page ici reprend ici.
      ecrire(i);
      dessiner();
    });
  }

  /** @type {any} */ (window).SkanAssistant = { ouvrir };
})();
