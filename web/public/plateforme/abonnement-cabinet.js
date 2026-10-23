// @ts-check
// L'abonnement du cabinet (lot 3 de l'abonnement, 23/10/2026 ; migration 0172, docs/abonnement.md C22 ; décision de
// Skander : docs/cadrage/07-offres-et-prix.md « Comment l'abonnement du cabinet s'applique »). Le serveur DÉDUIT tout
// (l'état, les dossiers gratuits et payants, la prochaine facture, par la même fonction que la facture) ; cette page ne
// fait que le dire, dans le panneau « Ton abonnement » des Réglages du Cabinet (celui de la licence de la v10), avec :
//   - la pastille du haut (`#lic-banner` de la v10) : la facture qui attend, la lecture seule ;
//   - l'avertissement avant le dossier qui se paie, dans « Ajouter un client » (le pont, `creationDossier`).
// Seul un associé lit et règle l'abonnement (la base refuse tout autre rôle) : aux autres, le panneau dit qui s'en occupe.
// Les montants arrivent en dinars, en texte exact (« 60.000 ») : rien ne se calcule ici.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);

  /** @param {unknown} v */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] || c);
  /** @param {string | null | undefined} j */
  const jour = (j) => (j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}` : '');
  // Le jour et le mois d'un anniversaire (« le 23/10 de chaque année »).
  /** @param {string | null | undefined} j */
  const jourMois = (j) => (j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? `${j.slice(8, 10)}/${j.slice(5, 7)}` : '');
  /** @param {string} j @param {number} n */
  function plusJours(j, n) {
    const d = new Date(Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10)) + n));
    return d.toISOString().slice(0, 10);
  }
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n}\u00a0${n > 1 ? (plusieurs || `${un}s`) : un}`;
  // Un montant du serveur (« 1990.000 ») : 1 990 DT ; 16,438 DT s'il a des millimes.
  /** @param {string | null | undefined} t */
  function montant(t) {
    const [e = '0', d = ''] = String(t ?? '0').split('.');
    return `${e.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}${/^0*$/.test(d) ? '' : `,${d.padEnd(3, '0')}`}\u00a0DT`;
  }
  const ETATS_FACTURE = /** @type {Record<string, string>} */ ({ a_payer: 'À payer', en_retard: 'En retard', partielle: 'Payée en partie', payee: 'Payée', annulee: 'Annulée' });
  const DOIT = ['a_payer', 'en_retard', 'partielle'];
  // Combien de dossiers la liste montre avant « Voir les autres » (une liste qu'on nomme se pagine).
  const PAGE = 12;

  /** @typedef {{ etat: 'gratuit' | 'a_facturer' | 'a_payer' | 'actif' | 'lecture_seule', echeance?: string, lectureSeuleLe?: string | null, jusquAu?: string, depuis?: string }} Etat */
  /** @typedef {{ debut: string, fin: string, echeance: string, prixHt: string | null, plafondHt: string | null, gratuits: number | null, dossiers: number, dossiersHt: string | null,
   *   rattrapages: { du: string, au: string, jours: number, sur: number, montantHt: string | null }[], brutHt: string | null, totalHt: string | null, plafonne: boolean }} Calcul */
  /** @typedef {{ aujourdhui: string, etat: Etat, depuis: string | null, payeJusquAu: string | null,
   *   regles: { prixHt: string | null, gratuits: number | null, plafondHt: string | null, delai: number | null, grace: number | null },
   *   dossiers: { id: string, nom: string, payant: boolean }[], abonnes: number, prochaine: Calcul | null,
   *   prochainDossier: { rang: number, payant: boolean, prixHt: string | null, abonne: boolean },
   *   factures: { entreprise: any, client: any, pieces: any[] } | null, enLigne: boolean }} Lu */
  /** @typedef {{ appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>, cabinet: string }} Outils */

  // La pastille du haut du Cabinet (`#lic-banner`) : elle ne parle que quand il y a quelque chose à faire.
  /** @param {Etat | null | undefined} e @returns {{ show: boolean, ton: string, texte: string }} */
  function pastille(e) {
    if (!e) return { show: false, ton: '', texte: '' };
    if (e.etat === 'lecture_seule') return { show: true, ton: 'alerte', texte: `Dossiers payants en lecture seule depuis le ${jour(e.depuis)} — voir l'abonnement` };
    if (e.etat === 'a_payer') return { show: true, ton: 'attire', texte: `Facture de l'abonnement à régler avant le ${jour(e.echeance)}` };
    return { show: false, ton: '', texte: '' };
  }

  // La pastille du haut suit le panneau à chaque lecture : la facture qui part pendant qu'il est ouvert (il se relit
  // seul), ou le paiement, la changent sans recharger la page. Les mêmes classes que la v10 (`majBandeauLicence`).
  /** @param {Etat} e */
  function bandeau(e) {
    const el = document.getElementById('lic-banner');
    if (!el) return;
    const p = pastille(e);
    el.hidden = !p.show;
    el.classList.toggle('warn', p.ton === 'alerte' || p.ton === 'attire');
    el.classList.toggle('calme', p.ton === 'calme');
    if (p.show) el.textContent = p.texte;
  }

  // L'état en tête du panneau : une pastille, un titre, ce qu'il veut dire.
  /** @param {Lu} a @returns {{ ton: string, pastille: string, titre: string, texte: string }} */
  function etatEnClair(a) {
    const e = a.etat, r = a.regles;
    const payants = a.dossiers.filter((d) => d.payant).length;
    const gratuits = typeof r.gratuits === 'number' ? r.gratuits : null;
    if (e.etat === 'lecture_seule') {
      return { ton: 'alerte', pastille: 'Lecture seule', titre: `Tes dossiers payants sont en lecture seule depuis le ${jour(e.depuis)}`,
        texte: `La facture de l'abonnement n'est pas réglée : son échéance était le ${jour(e.echeance)}. ${payants > 1 ? `Tes ${payants} dossiers payants se lisent, s'impriment et s'exportent` : 'Ton dossier payant se lit, s\'imprime et s\'exporte'}, et tu parles toujours à tes clients ; ${gratuits && gratuits > 1 ? `tes ${gratuits} dossiers gratuits restent ouverts` : gratuits === 1 ? 'ton dossier gratuit reste ouvert' : 'les dossiers gratuits restent ouverts'}. Règle la facture : tout se rouvre aussitôt.` };
    }
    if (e.etat === 'a_payer') {
      return { ton: 'attire', pastille: 'Facture à régler', titre: `Ta facture est à régler avant le ${jour(e.echeance)}`,
        texte: `Elle est juste en dessous, dans « Tes factures ».${e.lectureSeuleLe ? ` Sans paiement, tes dossiers payants passeront en lecture seule le ${jour(e.lectureSeuleLe)} ; tes dossiers gratuits, eux, restent ouverts.` : ''}` };
    }
    if (e.etat === 'actif') {
      return { ton: 'calme', pastille: 'Abonnement payé', titre: `Ton abonnement est payé jusqu'au ${jour(e.jusquAu)}`,
        texte: `${pl(a.dossiers.length, 'dossier tenu', 'dossiers tenus')}, dont ${pl(payants, 'payant', 'payants')}. La facture suivante arrive ici le ${jour(plusJours(String(e.jusquAu), 1))}, et un e-mail te prévient.` };
    }
    if (e.etat === 'a_facturer') {
      return { ton: 'calme', pastille: 'Facture en préparation', titre: 'Ta facture se prépare',
        texte: 'Elle arrive ici, dans « Tes factures », dans un instant, et un e-mail te prévient.' };
    }
    const n = a.dossiers.length;
    return { ton: 'calme', pastille: 'Gratuit', titre: gratuits === null ? 'Rien à payer aujourd\'hui' : `${pl(n, 'dossier tenu', 'dossiers tenus')} sur ${gratuits} gratuits`,
      texte: gratuits === null ? 'Tes dossiers tenus ne se paient pas.'
        : n < gratuits ? `Encore ${pl(gratuits - n, 'dossier gratuit')} avant le premier qui se paie. Tes clients abonnés à SkanFact, eux, ne comptent jamais.`
          : 'Le prochain dossier tenu se paie : l\'abonnement du cabinet commencera ce jour-là. Tes clients abonnés à SkanFact, eux, ne comptent jamais.' };
  }

  // Comment ça marche : les règles du jour, en phrases (rien d'inventé : une règle inconnue ne se dit pas).
  /** @param {Lu} a */
  function regles(a) {
    const r = a.regles;
    const lignes = [];
    lignes.push(`<li><b>${typeof r.gratuits === 'number' ? esc(pl(r.gratuits, 'dossier tenu gratuit', 'dossiers tenus gratuits')) : 'Tes clients abonnés : gratuits'}</b><span>${typeof r.gratuits === 'number' ? 'Les premiers que tu as créés, pour toujours ; un dossier archivé ne compte pas. ' : ''}Un client qui paie son propre abonnement SkanFact ne compte jamais, sans limite ; un dossier que son client rejoint ne compte plus à partir de ce jour.</span></li>`);
    if (r.prixHt) lignes.push(`<li><b>${esc(montant(r.prixHt))} HT par dossier et par an</b><span>Pour chaque dossier tenu au-delà${r.plafondHt ? `, jamais plus de ${esc(montant(r.plafondHt))} HT par an en tout, quel que soit leur nombre` : ''}. La TVA s'ajoute.</span></li>`);
    lignes.push(`<li><b>Une facture par an</b><span>${a.depuis ? `Le ${esc(jourMois(a.depuis))} de chaque année, le jour où ton premier dossier payant est arrivé.` : 'Le jour où ton premier dossier payant arrive, puis chaque année à la même date.'} Un dossier ajouté en cours d'année se paie au prorata de ses jours, sur la facture suivante.${typeof r.delai === 'number' ? ` Tu as ${esc(pl(r.delai, 'jour'))} pour la régler.` : ''}</span></li>`);
    lignes.push(`<li><b>Sans paiement</b><span>${typeof r.grace === 'number' && r.grace > 0 ? `${esc(pl(r.grace, 'jour'))} après l'échéance, ` : 'Après l\'échéance, '}seuls tes dossiers payants passent en lecture seule : tout s'y lit, s'imprime et s'exporte, et tu parles toujours au client. Tes dossiers gratuits restent ouverts ; un dossier tenu de plus attend le paiement.</span></li>`);
    return `<div class="abo-section" id="abc-regles"><div class="abo-section-tete"><h3>Comment ça marche</h3></div><ol class="abo-etapes">${lignes.join('')}</ol></div>`;
  }

  // Tes dossiers tenus, dans l'ordre de leur création : les premiers gratuits, les suivants payants.
  /** @param {Lu} a @param {boolean} tout */
  function dossiers(a, tout) {
    if (!a.dossiers.length) {
      return `<div class="abo-section" id="abc-dossiers"><div class="abo-section-tete"><h3>Tes dossiers tenus</h3>
        <p>Aucun pour l'instant.${a.abonnes ? ` ${esc(pl(a.abonnes, 'client abonné', 'clients abonnés'))} à SkanFact, gratuits.` : ''}</p></div></div>`;
    }
    const payants = a.dossiers.filter((d) => d.payant).length;
    const montres = tout ? a.dossiers : a.dossiers.slice(0, PAGE);
    return `<div class="abo-section" id="abc-dossiers">
      <div class="abo-section-tete"><h3>Tes dossiers tenus</h3>
        <p>${esc(pl(a.dossiers.length, 'dossier tenu', 'dossiers tenus'))} : ${esc(pl(a.dossiers.length - payants, 'gratuit'))}, ${esc(pl(payants, 'payant'))}, dans l'ordre de leur création.${a.abonnes ? ` Et ${esc(pl(a.abonnes, 'client abonné', 'clients abonnés'))} à SkanFact, gratuits.` : ''}</p></div>
      <ul class="abc-dossiers">${montres.map((d, i) => `<li><span class="abc-rang">${i + 1}</span><span class="abc-nom">${esc(d.nom)}</span>
        <span class="abc-pastille${d.payant ? ' payant' : ''}">${d.payant ? 'Payant' : 'Gratuit'}</span></li>`).join('')}</ul>
      ${!tout && a.dossiers.length > PAGE ? `<p><button type="button" class="btn btn-sm" id="abc-tout">Voir les ${a.dossiers.length - PAGE} autres</button></p>` : ''}
    </div>`;
  }

  // La prochaine facture : son jour, ce qu'elle comptera (la même fonction que la facture), son total.
  /** @param {Lu} a */
  function prochaine(a) {
    const p = a.prochaine;
    if (!p || a.etat.etat === 'a_payer' || a.etat.etat === 'lecture_seule' || a.etat.etat === 'a_facturer') return '';
    const lignes = [];
    if (p.dossiers) lignes.push(`<li><span>${esc(pl(p.dossiers, 'dossier payant', 'dossiers payants'))} × ${esc(montant(p.prixHt))}</span><b>${esc(montant(p.dossiersHt))}</b></li>`);
    for (const r of p.rattrapages) lignes.push(`<li><span>Rattrapage d'un dossier ajouté le ${esc(jour(r.du))} : ${esc(pl(r.jours, 'jour'))} sur ${r.sur}</span><b>${esc(montant(r.montantHt))}</b></li>`);
    const total = Number(p.totalHt || 0) > 0;
    return `<div class="abo-section" id="abc-prochaine">
      <div class="abo-section-tete"><h3>La prochaine facture</h3>
        <p>${total ? `Le ${esc(jour(p.debut))}, pour l'année jusqu'au ${esc(jour(p.fin))}. Comptée ce jour-là : un dossier archivé d'ici là, ou que son client rejoint, n'y sera pas.` : `Le ${esc(jour(p.debut))} : rien à facturer si rien ne change, aucun dossier payant aujourd'hui.`}</p></div>
      ${total ? `<ul class="abc-calcul">${lignes.join('')}
        ${p.plafonne ? `<li class="abc-plafond"><span>Plafond annuel : jamais plus de ${esc(montant(p.plafondHt))} HT</span><b>${esc(montant(p.totalHt))}</b></li>` : ''}
        <li class="abc-total"><span>Total hors taxes</span><b>${esc(montant(p.totalHt))}</b></li></ul>
        <p class="abo-note">La TVA et le timbre s'ajoutent sur la facture.</p>` : ''}
    </div>`;
  }

  // « Tes factures » : celles que l'entreprise SkanFact a émises pour l'abonnement du cabinet, la plus récente d'abord.
  // (1.121.0) Quand l'état porte « Régler ma facture », c'est lui le bouton vert de l'écran : celui de la ligne se fait
  // discret (deux verts côte à côte, recette du 23/10/2026).
  /** @param {Lu} a @param {boolean} [enTete] */
  function factures(a, enTete = false) {
    if (!a.factures || !a.factures.pieces.length) return '';
    const pieces = a.factures.pieces;
    const verte = enTete ? undefined : pieces.filter((p) => p.payable).pop();
    const lignes = pieces.map((p, i) => {
      const doit = !!p.statut && DOIT.includes(p.statut);
      const periode = p.periode ? `du ${jour(p.periode.debut)} au ${jour(p.periode.fin)} · ${pl(Number(p.periode.dossiers), 'dossier payant', 'dossiers payants')}${Number(p.periode.rattrapes) ? `, ${pl(Number(p.periode.rattrapes), 'rattrapage')}` : ''}` : '';
      const ou = p.type === 'avoir' ? '' : p.statut === 'a_payer' && p.echeance ? `à régler au plus tard le ${jour(p.echeance)}`
        : p.statut === 'en_retard' ? `échue le ${jour(p.echeance)} · reste ${montant(p.reste)}` : p.statut === 'partielle' ? `reste ${montant(p.reste)}` : '';
      return `<li class="abo-facture${doit ? ' doit' : ''}" data-numero="${esc(p.numero)}">
        <div class="abo-fa-quoi"><b>${p.type === 'avoir' ? 'Avoir' : 'Facture'} <span class="abo-num">${esc(p.numero)}</span></b><span>${esc(periode)}</span></div>
        <div class="abo-fa-montant"><b>${esc(montant(p.net))}</b>${ou ? `<span>${esc(ou)}</span>` : ''}</div>
        ${p.statut ? `<span class="abo-fa-etat ${esc(p.statut)}">${esc(ETATS_FACTURE[p.statut] || '')}</span>` : '<span class="abo-fa-etat avoir">Avoir</span>'}
        <div class="abo-fa-gestes">
          ${p.payable ? `<button type="button" class="btn btn-sm${p === verte ? ' btn-primary' : ''}" data-payer="${i}">Payer ${esc(montant(p.reste))} en ligne</button>` : ''}
          <button type="button" class="btn btn-sm" data-voir="${i}">Voir</button>
        </div>
        ${doit && !p.payable ? '<p class="abo-fa-aide">Règle-la par virement ou par chèque : les coordonnées de SkanFact sont sur la facture.</p>' : ''}
      </li>`;
    }).join('');
    return `<div class="abo-section" id="abo-factures">
      <div class="abo-section-tete"><h3>Tes factures</h3><p>Les factures de SkanFact pour l'abonnement du cabinet, telles qu'elles s'impriment. Elles comptent tes dossiers, sans les nommer.</p></div>
      <ul class="abo-factures">${lignes}</ul>
      <p class="small abo-refus" role="alert" hidden></p>
    </div>`;
  }

  // « Payer en ligne » : le serveur ouvre le paiement chez le prestataire de l'entreprise SkanFact, pour le RESTE ; la page
  // de retour dit ce qu'il a confirmé, et ramène ici (le Cabinet de CE cabinet, sur « Ton abonnement »).
  /** @param {Outils} o @param {any} p @param {HTMLButtonElement} b @param {HTMLElement} refus */
  async function payer(o, p, b, refus) {
    /** @param {string} texte */
    const dire = (texte) => { refus.textContent = texte; refus.hidden = false; b.disabled = false; };
    b.disabled = true;
    refus.hidden = true;
    /** @type {any} */
    let r;
    try { r = await o.appel('POST', `/cabinets/${o.cabinet}/abonnement/payer`, { numero: p.numero }); } catch (x) { dire(x instanceof Error ? x.message : String(x)); return; }
    if (!r || typeof r.adresse !== 'string') { dire('Le paiement en ligne ne répond pas : réessaie dans un instant.'); return; }
    try {
      sessionStorage.setItem('skanfact.abonnement.retour', `c:${o.cabinet}`);
      sessionStorage.removeItem('skanfact.espace');
    } catch { /* sans stockage, la page de retour propose de la fermer */ }
    location.assign(r.adresse);
  }

  // Le gabarit des pièces (`SkanCore`) n'est pas chargé dans le Cabinet : il se charge la première fois qu'on ouvre une
  // facture (le même que la facture imprimée par l'entreprise SkanFact).
  /** @type {Promise<any> | null} */
  let gabarit = null;
  function chargerGabarit() {
    if (w.SkanCore) return Promise.resolve(w.SkanCore);
    if (!gabarit) {
      gabarit = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = '../core.js';
        s.onload = () => (w.SkanCore ? ok(w.SkanCore) : ko(new Error('Le gabarit des factures ne s\'est pas chargé : recharge la page.')));
        s.onerror = () => { gabarit = null; ko(new Error('Le gabarit des factures ne s\'est pas chargé : vérifie ta connexion, puis réessaie.')); };
        document.head.appendChild(s);
      });
    }
    return gabarit;
  }
  // Les nombres non entiers d'une pièce arrivent en texte exact ({ "~n": "39.5" }), comme le dossier les garde.
  /** @param {unknown} v @returns {any} */
  function decoder(v) {
    if (Array.isArray(v)) return v.map(decoder);
    if (v && typeof v === 'object') {
      const cles = Object.keys(v);
      if (cles.length === 1 && cles[0] === '~n') return Number(/** @type {any} */ (v)['~n']);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]));
    }
    return v;
  }

  // Une facture, telle que SkanFact l'imprime, à la place du panneau ; « ← Ton abonnement » y ramène (relu au serveur).
  /** @param {HTMLElement} el @param {Outils} o @param {Lu} a @param {any} p */
  async function voir(el, o, a, p) {
    const refus = /** @type {HTMLElement | null} */ (el.querySelector('#abo-factures .abo-refus'));
    /** @type {any} */
    let core;
    try { core = await chargerGabarit(); } catch (x) {
      if (refus) { refus.textContent = x instanceof Error ? x.message : String(x); refus.hidden = false; }
      return;
    }
    const fa = a.factures;
    if (!fa) return;
    const entreprise = core.migrateData({ company: decoder(fa.entreprise) }).company;
    const client = decoder(fa.client), document_ = decoder(p.document);
    const tampon = p.statut === 'payee' ? 'Payée' : p.statut === 'annulee' ? 'Annulée' : undefined;
    const reste = p.reste === null ? '' : Number(p.reste) > 0 ? `Reste à payer : <b>${esc(montant(p.reste))}</b>` : 'Rien à payer sur cette facture';
    el.innerHTML = `<div class="abo abo-vue-piece">
      <div class="abo-piece-barre">
        <button type="button" class="btn btn-sm" id="abo-retour">← Ton abonnement</button>
        <span class="abo-piece-reste">${reste}</span>
        <span class="abo-piece-gestes">${p.payable ? `<button type="button" class="btn btn-primary" id="abo-payer-piece">Payer ${esc(montant(p.reste))} en ligne</button>` : ''}<button type="button" class="btn${p.payable ? '' : ' btn-primary'}" id="abo-imprimer">Imprimer ou enregistrer en PDF</button></span>
      </div>
      <p class="small abo-refus" role="alert" hidden></p>
      <iframe class="abo-piece" sandbox="allow-same-origin" title="Facture ${esc(p.numero)}"></iframe>
    </div>`;
    const cadre = /** @type {HTMLIFrameElement} */ (el.querySelector('iframe.abo-piece'));
    const zoom = Math.max(0.3, Math.min(1, Math.floor((cadre.clientWidth - 2) / 794 * 100) / 100));
    cadre.srcdoc = core.documentHtml(document_, client, entreprise, { preview: true, stampText: tampon, zoom });
    /** @type {HTMLElement} */ (el.querySelector('#abo-retour')).onclick = () => { void dessiner(el, o); };
    /** @type {HTMLElement} */ (el.querySelector('#abo-imprimer')).onclick = () => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin allow-modals');
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
      f.onload = () => {
        const d = f.contentDocument;
        if (d) { try { core.fitToPage(d); core.paginate(d); } catch { /* la page s'imprime telle quelle */ } }
        if (f.contentWindow) f.contentWindow.print();
        setTimeout(() => f.remove(), 60_000);
      };
      f.srcdoc = core.documentHtml(document_, client, entreprise, { stampText: tampon });
      document.body.appendChild(f);
    };
    const bp = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abo-payer-piece'));
    if (bp) bp.onclick = () => { void payer(o, p, bp, /** @type {HTMLElement} */ (el.querySelector('.abo-refus'))); };
    /** @type {HTMLElement} */ (el.querySelector('.abo-vue-piece')).scrollIntoView({ block: 'start' });
  }

  /** @param {HTMLElement} el @param {Outils} o @param {{ tout?: boolean }} [options] */
  async function dessiner(el, o, options = {}) {
    /** @type {Lu} */
    let a;
    try { a = await o.appel('GET', `/cabinets/${o.cabinet}/abonnement`); } catch (x) {
      const statut = /** @type {any} */ (x).statut;
      el.innerHTML = statut === 403
        ? '<p class="small">L\'abonnement du cabinet se lit et se règle par un associé du cabinet : c\'est à lui qu\'arrivent ses factures.</p>'
        : `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p><button type="button" class="btn btn-sm" id="abo-relire">Réessayer</button>`;
      const b = /** @type {HTMLElement | null} */ (el.querySelector('#abo-relire'));
      if (b) b.onclick = () => { void dessiner(el, o); };
      return;
    }
    const c = etatEnClair(a);
    bandeau(a.etat);
    const aFaire = a.etat.etat === 'a_payer' || a.etat.etat === 'lecture_seule';
    const enTete = !!(aFaire && a.factures && a.factures.pieces.some((p) => p.payable));
    const fa = factures(a, enTete);
    el.innerHTML = `<div class="abo abc">
      <section class="abo-tete ${c.ton}" id="abo-etat">
        <div class="abo-tete-txt">
          <span class="abo-pastille">${esc(c.pastille)}</span>
          <h3>${esc(c.titre)}</h3>
          <p>${esc(c.texte)}</p>
          ${enTete ? '<button type="button" class="btn btn-primary abo-tete-btn" id="abc-regler">Régler ma facture</button>' : ''}
        </div>
      </section>
      ${aFaire ? fa : ''}
      ${prochaine(a)}
      ${dossiers(a, !!options.tout)}
      ${regles(a)}
      ${aFaire ? '' : fa}
    </div>`;
    const tout = /** @type {HTMLElement | null} */ (el.querySelector('#abc-tout'));
    if (tout) tout.onclick = () => { void dessiner(el, o, { tout: true }); };
    const refus = /** @type {HTMLElement | null} */ (el.querySelector('#abo-factures .abo-refus'));
    const pieces = a.factures ? a.factures.pieces : [];
    el.querySelectorAll('#abo-factures [data-voir]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => { const p = pieces[Number(/** @type {HTMLElement} */ (b).dataset.voir)]; if (p) void voir(el, o, a, p); };
    });
    el.querySelectorAll('#abo-factures [data-payer]').forEach((b) => {
      const bouton = /** @type {HTMLButtonElement} */ (b);
      bouton.onclick = () => { const p = pieces[Number(bouton.dataset.payer)]; if (p && refus) void payer(o, p, bouton, refus); };
    });
    const regler = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abc-regler'));
    if (regler) {
      regler.onclick = () => {
        const p = pieces.filter((x) => x.payable).pop();
        if (p && refus) void payer(o, p, regler, refus);
      };
    }
    // La facture se prépare seule : le panneau se relit jusqu'à ce qu'elle soit là (une minute au plus).
    if (a.etat.etat === 'a_facturer') {
      const essais = Number(el.dataset.attenteFacture || 0);
      if (essais < 20) {
        el.dataset.attenteFacture = String(essais + 1);
        setTimeout(() => { if (el.isConnected && el.querySelector('#abo-etat')) void dessiner(el, o, options); }, 3000);
      }
    } else delete el.dataset.attenteFacture;
  }

  // Avant d'ajouter un client : ce que ce dossier coûtera, s'il dépasse les gratuits (dit AVANT la saisie, pas après la
  // facture). Rien quand il est gratuit, ou quand on ne connaît pas le prix.
  /** @param {Lu['prochainDossier'] | null | undefined} d @param {Lu['regles'] | null | undefined} r */
  function avertissement(d, r) {
    if (!d || !d.payant || !d.prixHt) return '';
    const plafond = r && r.plafondHt ? ` (jamais plus de ${montant(r.plafondHt)} HT par an en tout)` : '';
    return d.abonne
      ? `Ce sera ton ${d.rang}e dossier tenu : il se paie ${montant(d.prixHt)} HT par an${plafond}, au prorata de ses jours sur ta prochaine facture. Un client qui s'abonne lui-même à SkanFact, lui, ne compte pas.`
      : `Ce sera ton ${d.rang}e dossier tenu : au-delà de tes ${r && typeof r.gratuits === 'number' ? r.gratuits : 'premiers'} gratuits, il se paie ${montant(d.prixHt)} HT par an${plafond}. Ton abonnement commence le jour où tu le crées : sa facture arrive aussitôt dans Réglages, « Ton abonnement ». Un client qui s'abonne lui-même à SkanFact, lui, ne compte pas.`;
  }

  w.SkanAbonnementCabinet = { dessiner, pastille, avertissement, etatEnClair };
})();
