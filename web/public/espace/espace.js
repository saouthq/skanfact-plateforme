// @ts-check
// L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1). Le client d'une entreprise ouvre le
// lien qu'elle lui a donné, et voit, sans rien installer, ses pièces émises — chacune exactement comme
// l'entreprise l'imprime (le gabarit de la v10, `SkanCore.documentHtml`) — et ce qu'il en doit (le
// chiffre du serveur), puis ses devis envoyés (le devis par son lien, 06/10/2026), qui ne comptent pas dans ce qu'il doit. Rien ne change d'ici. Le lien secret vit dans le fragment « # » de l'adresse :
// le navigateur ne l'envoie jamais, et il part au serveur dans le corps d'une requête.
(function () {
  'use strict';
  /** @type {any} */ const C = /** @type {any} */ (window).SkanCore;
  const racine = /** @type {HTMLElement} */ (document.getElementById('espace'));
  const jeton = decodeURIComponent(location.hash.replace(/^#/, ''));
  const esc = (/** @type {unknown} */ x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // Les nombres non entiers arrivent en texte exact ({ "~n": "450.5" }), comme le dossier les garde.
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

  /** @param {string} titre @param {string} texte @param {boolean} [reessayer] */
  function refus(titre, texte, reessayer = false) {
    racine.innerHTML = `<div class="refus" role="alert"><strong>${esc(titre)}</strong>${esc(texte)}${reessayer ? '<p><button type="button" id="reessayer">Réessayer</button></p>' : ''}</div>`;
    const b = document.getElementById('reessayer');
    if (b) b.onclick = () => location.reload();
  }

  const STATUTS = { a_payer: 'À payer', en_retard: 'En retard', partielle: 'Payée en partie', payee: 'Payée', annulee: 'Annulée' };
  // L'état d'un devis (le serveur le dit, avec la règle de la v10 : envoyé et sa validité passée, il est expiré).
  const ETATS_DEVIS = { en_attente: 'En attente de ta réponse', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré' };
  /** @type {any} */ let vue = null;
  // La devise telle que la pièce l'écrit (le dinar s'écrit « DT » sur les pièces).
  const devise = (/** @type {string} */ d) => (d === 'TND' ? 'DT' : d);
  const montant = (/** @type {string | null} */ x, /** @type {string} */ d) => C.money(Number(x), devise(d));
  /** @param {any} p */
  const titre = (p) => `${C.titreDePiece(p.document, vue.entreprise)} ${p.numero}`;

  // (1.155.0, maquette « ce que voit le client » de docs/maquettes/facture.html) Une seule page : en haut, qui écrit et
  // ce qu'est ce lien ; à gauche, ce que le client doit, ses pièces des douze derniers mois et la pièce ouverte, telle
  // que l'entreprise l'imprime ; à droite, le reste à payer et LE geste (payer en ligne), puis le PDF et le fichier
  // El Fatoora.
  const initiales = (/** @type {string} */ n) => String(n || '').trim().split(/\s+/).filter((m) => !/^(de|du|des|la|le|les|et|d'|l')$/i.test(m)).slice(0, 2).map((m) => m[0]).join('').toUpperCase() || '·';
  function entete() {
    const e = vue.entreprise;
    return `<header class="societe">${e.logo ? `<img src="${esc(e.logo)}" alt="">` : `<span class="pastille" aria-hidden="true">${esc(initiales(e.name))}</span>`}<div><h1>${esc(e.name)}</h1>
      <p>Espace de ${esc(vue.client.name || 'ton compte')}</p></div><span class="lien-dit">Lien personnel · aucun mot de passe · tout est en lecture</span></header>`;
  }

  // Sur un téléphone, la liste passe en cartes : chaque chiffre y dit ce qu'il est (sur un écran large,
  // le titre de la colonne le dit, et l'étiquette se cache).
  const etiquette = (/** @type {string} */ nom) => `<span class="etiquette">${esc(nom)}&nbsp;: </span>`;

  // Ce qu'une facture a déjà reçu : ses paiements, et ses avoirs (qui ont leur ligne dans la liste).
  /** @param {any} p */
  const recu = (p) => [
    Number(p.paye) > 0 ? `Payé : ${esc(montant(p.paye, p.devise))}` : '',
    Number(p.credite) > 0 ? `Avoirs : ${esc(montant(p.credite, p.devise))}` : '',
  ].filter(Boolean).join(' · ');

  // La pièce ouverte : { genre: 'piece' | 'devis', i }. Par défaut, la plus ancienne qui doit encore (celle à régler
  // d'abord), sinon la plus récente.
  /** @type {{ genre: 'piece' | 'devis', i: number } | null} */ let ouverte = null;
  let toutVoir = false;
  const ilYaUnAn = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const recente = (/** @type {any} */ p) => !p.date || p.date >= ilYaUnAn;
  function parDefaut() {
    const dues = vue.pieces.map((/** @type {any} */ p, /** @type {number} */ i) => [p, i]).filter((/** @type {any[]} */ [p]) => Number(p.reste) > 0);
    if (dues.length) return { genre: /** @type {'piece'} */ ('piece'), i: dues[dues.length - 1][1] };
    if (vue.pieces.length) return { genre: /** @type {'piece'} */ ('piece'), i: 0 };
    if (vue.devis.length) return { genre: /** @type {'devis'} */ ('devis'), i: 0 };
    return null;
  }
  const PASTILLES = { a_payer: 'a-payer', en_retard: 'retard', partielle: 'partielle', payee: 'payee', annulee: 'annulee' };

  function releve() { dessiner(); }
  /** @param {any} _p */
  function piece(_p) { ouverte = { genre: 'piece', i: vue.pieces.indexOf(_p) }; dessiner(); }
  /** @param {any} _d */
  function devis(_d) { ouverte = { genre: 'devis', i: vue.devis.indexOf(_d) }; dessiner(); }

  function dessiner() {
    if (!ouverte) ouverte = parDefaut();
    const du = vue.totaux.filter((/** @type {any} */ t) => Number(t.du) > 0);
    const dues = vue.pieces.filter((/** @type {any} */ p) => Number(p.reste) > 0);
    const prochaine = dues.map((/** @type {any} */ p) => p.echeance).filter(Boolean).sort()[0];
    const seule = vue.lien === 'piece';
    const montrees = vue.pieces.map((/** @type {any} */ p, /** @type {number} */ i) => [p, i]).filter((/** @type {any[]} */ [p, i]) => seule || toutVoir || recente(p) || Number(p.reste) > 0 || (ouverte && ouverte.genre === 'piece' && ouverte.i === i));
    const cachees = vue.pieces.length - montrees.length;
    const sel = ouverte && ouverte.genre === 'piece' ? vue.pieces[ouverte.i] : null;
    const selDevis = ouverte && ouverte.genre === 'devis' ? vue.devis[ouverte.i] : null;
    const ligne = (/** @type {any} */ p, /** @type {number} */ i) => {
      const ouv = sel === p;
      return `<tr class="${ouv ? 'ouverte' : ''}"><td><strong>${p.type === 'avoir' ? 'Avoir ' : ''}${esc(p.numero)}</strong>${recu(p) ? `<div class="recu">${recu(p)}</div>` : ''}</td>
        <td>${etiquette('Date')}${esc(C.fmtDate(p.date))}</td><td>${etiquette('Échéance')}${p.echeance ? `<span class="court">éch. </span>${esc(C.fmtDate(p.echeance))}` : '—'}</td>
        <td class="m">${etiquette('Montant')}${esc(montant(p.net, p.devise))}</td>
        <td class="s">${p.statut ? `<span class="statut ${esc(/** @type {any} */ (PASTILLES)[p.statut] || p.statut)}">${esc(/** @type {any} */ (STATUTS)[p.statut] || '')}</span>` : ''}</td>
        <td class="g"><button type="button" data-voir="${i}"${ouv ? ' aria-current="true"' : ''}>${ouv ? 'Ouverte' : 'Voir'}</button></td></tr>`;
    };
    const tuile = du.length
      ? `<section class="carte du"><span>Tu dois</span> ${du.map((/** @type {any} */ t) => `<strong>${esc(montant(t.du, t.devise))}</strong>`).join(' ')}
          <p class="aide">${dues.length ? `${dues.length > 1 ? `${dues.length} factures` : '1 facture'} à payer${prochaine ? ` · échéance le ${esc(C.fmtDate(prochaine))}` : ''}` : ''}</p></section>`
      : '<section class="carte du rien"><strong>Rien à payer</strong><span>Merci !</span></section>';
    const liste = `<section class="carte liste"><div class="carte-t"><h2>${seule ? 'Ta pièce' : 'Tes pièces'}</h2>${seule ? '' : `<small>${toutVoir ? 'toutes' : 'les 12 derniers mois'}</small>`}</div>
        ${vue.pieces.length ? `<table class="pieces"><tbody>${montrees.map((/** @type {any[]} */ [p, i]) => ligne(p, i)).join('')}</tbody></table>` : '<p>Aucune pièce émise pour le moment.</p>'}
        ${cachees > 0 ? `<button type="button" class="plus-anciennes" id="plus-anciennes">Voir ${cachees > 1 ? `les ${cachees} plus anciennes` : 'la plus ancienne'}</button>` : ''}</section>`;
    const devisVus = vue.devis.filter((/** @type {any} */ d) => toutVoir || recente(d) || d === selDevis || d.statut === 'en_attente').length;
    const tesDevis = vue.devis.length ? `<section class="carte liste devis-l"><div class="carte-t"><h2>Tes devis</h2>${devisVus < vue.devis.length ? `<small>les 12 derniers mois · <button type="button" class="lien" id="devis-tous">voir les ${vue.devis.length - devisVus} autres</button></small>` : ''}</div><table class="pieces devis"><tbody>
        ${vue.devis.map((/** @type {any} */ d, /** @type {number} */ i) => [d, i]).filter((/** @type {any[]} */ [d]) => toutVoir || recente(d) || d === selDevis || d.statut === 'en_attente').map((/** @type {any[]} */ [d, i]) => `<tr class="${selDevis === d ? 'ouverte' : ''}"><td><strong>${esc(d.numero)}</strong></td>
          <td>${etiquette('Date')}${d.date ? esc(C.fmtDate(d.date)) : '—'}</td><td>${etiquette('Valable jusqu\'au')}${d.validite ? `<span class="court">jusqu'au </span>${esc(C.fmtDate(d.validite))}` : '—'}</td>
          <td class="m">${etiquette('Montant')}${esc(montantDevis(d))}</td>
          <td class="s"><span class="statut devis-${esc(d.statut)}">${esc(/** @type {any} */ (ETATS_DEVIS)[d.statut] || '')}</span></td>
          <td class="g"><button type="button" data-devis="${i}">${selDevis === d ? 'Ouvert' : 'Voir'}</button></td></tr>`).join('')}</tbody></table></section>` : '';
    // La colonne de droite : ce qui reste à payer sur la pièce ouverte, et le geste.
    let droite = '';
    if (sel) {
      const doc = sel.document, t = C.computeTotals(doc, vue.entreprise);
      const doit = Number(sel.reste) > 0;
      droite = `<section class="carte reste-carte"><span class="k">${sel.reste === null ? (sel.type === 'avoir' ? 'Avoir' : 'Montant') : 'Reste à payer'}</span>
          <strong class="reste-mt">${esc(sel.reste === null ? montant(sel.net, sel.devise) : montant(sel.reste, sel.devise))}</strong>
          ${sel.payable ? `<button type="button" class="principal" id="payer">${carte}Payer ${esc(montant(sel.reste, sel.devise))} en ligne</button>
            <p class="aide">Par carte bancaire, chez le prestataire de paiement de ${esc(vue.entreprise.name)}. Tu reviens ici une fois payé.</p>`
          : `<p class="aide">${doit ? `Pour la régler, ${esc(vue.entreprise.name)} t'indique comment sur la facture (virement, chèque…).` : sel.type === 'avoir' ? 'Il diminue ce que tu dois.' : 'Rien à payer sur cette pièce.'}</p>`}
          ${recu(sel) ? `<p class="recu">${recu(sel)}</p>` : ''}</section>
        <section class="carte gestes-carte">${Number(t.withholding) > 0 && doit ? `<p class="note">La retenue à la source (${esc(C.money(t.withholding, devise(sel.devise)))}) est déjà déduite : tu paies le net. Ton attestation de retenue se remet à ${esc(vue.entreprise.name)}.</p>` : ''}
          <button type="button" id="imprimer">${fleche}Enregistrer en PDF</button>
          ${doc.ttn ? `<button type="button" id="efacture" title="La facture validée par la TTN (El Fatoora) : c'est elle qui fait foi.">${fleche}Fichier El Fatoora (XML)</button>` : sel.type === 'facture' ? `<button type="button" disabled title="Le fichier vient quand la facture est signée et acceptée par El Fatoora.">${fleche}Fichier El Fatoora (après signature)</button>` : ''}
          <p class="refus-paiement" role="alert" hidden></p></section>`;
    } else if (selDevis) {
      const d = selDevis;
      const etat = d.statut === 'en_attente' ? `${ETATS_DEVIS.en_attente}${d.validite ? ` · valable jusqu'au ${esc(C.fmtDate(d.validite))}` : ''}`
        : d.statut === 'expire' && d.validite ? `Expiré le ${esc(C.fmtDate(d.validite))}` : esc(/** @type {any} */ (ETATS_DEVIS)[d.statut] || '');
      droite = `<section class="carte reste-carte"><span class="k">Devis ${esc(d.numero)}</span><strong class="reste-mt">${esc(montantDevis(d))}</strong><p class="aide">${etat}. Pour l'accepter, le devis dit comment (ses conditions) : rien ne change d'ici.</p></section>
        <section class="carte gestes-carte"><button type="button" id="imprimer">${fleche}Enregistrer en PDF</button></section>`;
    }
    const titreOuverte = sel ? titre(sel) : selDevis ? titre(selDevis) : '';
    racine.innerHTML = `${entete()}
      <div class="grille">
        <div class="gauche">${seule ? '' : tuile}${liste}
          ${sel || selDevis ? `<div class="papier"><iframe class="piece" sandbox="allow-same-origin" title="${esc(titreOuverte)}"></iframe></div>` : ''}${tesDevis}</div>
        ${droite ? `<aside class="droite">${droite}</aside>` : ''}
      </div>
      <footer>Cette page montre les pièces que ${esc(vue.entreprise.name)} t'a émises${vue.devis.length ? ', et ses devis' : ''}. Pour une question, écris-lui directement.</footer>`;
    racine.querySelectorAll('[data-voir]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => { ouverte = { genre: 'piece', i: Number(/** @type {HTMLElement} */ (b).dataset.voir) }; dessiner(); voirLaPiece(); };
    });
    racine.querySelectorAll('[data-devis]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => { ouverte = { genre: 'devis', i: Number(/** @type {HTMLElement} */ (b).dataset.devis) }; dessiner(); voirLaPiece(); };
    });
    const dt = document.getElementById('devis-tous');
    if (dt) dt.onclick = () => { toutVoir = true; dessiner(); };
    const pa = document.getElementById('plus-anciennes');
    if (pa) pa.onclick = () => { toutVoir = true; dessiner(); };
    const bp = /** @type {HTMLButtonElement | null} */ (document.getElementById('payer'));
    if (bp && sel) bp.onclick = () => { void payer(sel, bp); };
    const be = /** @type {HTMLButtonElement | null} */ (document.getElementById('efacture'));
    if (be && sel) be.onclick = () => { void telechargerEfacture(sel, be); };
    const ouvert = sel || selDevis;
    const tampon = sel ? (sel.statut === 'payee' ? 'Payée' : sel.statut === 'annulee' ? 'Annulée' : undefined) : undefined;
    const bi = document.getElementById('imprimer');
    if (bi && ouvert) bi.onclick = () => imprimer(ouvert.document, tampon);
    const cadre = /** @type {HTMLIFrameElement | null} */ (racine.querySelector('iframe.piece'));
    if (cadre && ouvert) {
      const zoom = Math.max(0.3, Math.min(1, Math.floor((cadre.clientWidth - 2) / 794 * 100) / 100));
      cadre.onload = () => { try { const h = cadre.contentDocument?.documentElement.scrollHeight; if (h) cadre.style.height = `${h + 4}px`; } catch { /* la hauteur par défaut reste */ } };
      cadre.srcdoc = C.documentHtml(ouvert.document, vue.client, vue.entreprise, { preview: true, stampText: tampon, zoom });
    }
  }
  // Sur un téléphone, la pièce choisie est plus bas : on y descend.
  function voirLaPiece() {
    if (window.matchMedia('(max-width: 900px)').matches) racine.querySelector('.papier')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const carte = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>';
  const fleche = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>';

  // « Payer en ligne » (brique 78 ; docs/paiement-en-ligne.md) : le serveur ouvre le paiement chez le
  // prestataire de l'entreprise, pour le reste à payer ; le client y paie, puis revient sur la page de
  // retour (retour.html), qui le ramène ici. Le lien se garde dans l'onglet pour ce retour seulement.
  /** @param {any} p @param {HTMLButtonElement} b */
  async function payer(p, b) {
    const dire = (/** @type {string} */ texte) => {
      const a = /** @type {HTMLElement} */ (racine.querySelector('.refus-paiement'));
      a.textContent = texte;
      a.hidden = false;
      b.disabled = false;
    };
    b.disabled = true;
    let r;
    try {
      r = await fetch('/v1/espace/payer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton, numero: p.numero }) });
    } catch {
      dire('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
      return;
    }
    const lu = await r.json().catch(() => ({}));
    if (!r.ok || typeof lu.adresse !== 'string') { dire(typeof lu.motif === 'string' ? lu.motif : 'Le paiement en ligne ne répond pas : réessaie dans un instant.'); return; }
    // Le retour ramène à CET espace, jamais à un abonnement payé avant dans l'onglet (14b).
    try { sessionStorage.setItem('skanfact.espace', jeton); sessionStorage.removeItem('skanfact.abonnement.retour'); } catch { /* la page de retour proposera de la fermer */ }
    location.assign(lu.adresse);
  }

  // La facture électronique que la TTN a validée (brique 141 ; docs/espace-client.md, E8) : c'est elle qui fait
  // foi. Le fichier vient du serveur, tel qu'il le garde, et s'enregistre sur l'appareil du client.
  /** @param {any} p @param {HTMLButtonElement} b */
  async function telechargerEfacture(p, b) {
    const dire = (/** @type {string} */ texte) => {
      const a = /** @type {HTMLElement} */ (racine.querySelector('.refus-paiement'));
      a.textContent = texte;
      a.hidden = false;
      b.disabled = false;
    };
    b.disabled = true;
    let r;
    try {
      r = await fetch('/v1/espace/efacture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton, type: p.type, numero: p.numero }) });
    } catch {
      dire('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
      return;
    }
    const lu = await r.json().catch(() => ({}));
    if (!r.ok) { dire(typeof lu.motif === 'string' ? lu.motif : 'Le fichier ne vient pas : réessaie dans un instant.'); return; }
    b.disabled = false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lu.xml], { type: 'application/xml' }));
    a.download = lu.nom;
    a.click();
  }

  // « Imprimer ou enregistrer en PDF » : une page à part, mise en page comme la v10 le fait pour son PDF
  // (resserrée, puis en vraies pages). La pièce n'exécute rien (« sandbox ») : elle s'affiche, et s'imprime
  // (« allow-modals »).
  /** @param {any} documentV10 @param {string | undefined} tampon */
  function imprimer(documentV10, tampon) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin allow-modals');
    f.className = 'impression';
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
    f.onload = () => {
      const d = f.contentDocument;
      if (d) { try { C.fitToPage(d); C.paginate(d); } catch { /* la page s'imprime telle quelle */ } }
      f.contentWindow?.print();
      setTimeout(() => f.remove(), 60_000);
    };
    f.srcdoc = C.documentHtml(documentV10, vue.client, vue.entreprise, { stampText: tampon });
    document.body.appendChild(f);
  }

  // Le montant d'un devis : son total TTC, calculé comme la v10 l'imprime (le même gabarit, la même fonction).
  /** @param {any} d */
  const montantDevis = (d) => C.money(C.computeTotals(d.document, vue.entreprise).totalTTC, d.document.currency || vue.entreprise.currency);

  async function ouvrir() {
    if (!jeton) { refus('Ce lien est incomplet.', ' Ouvre-le tel qu\'il t\'a été envoyé, en entier.'); return; }
    let r;
    try {
      r = await fetch('/v1/espace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton }) });
    } catch {
      refus('Le serveur ne répond pas.', ' Vérifie ta connexion, puis réessaie.', true);
      return;
    }
    const lu = await r.json().catch(() => ({}));
    if (!r.ok) { refus('Ce lien ne s\'ouvre pas.', ` ${typeof lu.motif === 'string' ? lu.motif : 'Réessaie dans un instant.'}`, r.status >= 500); return; }
    // La fiche société telle que l'entreprise l'imprime : complétée de ses valeurs par défaut (les conditions d'un
    // devis, de paiement…) par la même fonction que la v10 (`migrateData`), sinon le client lirait une pièce sans elles.
    vue = { ...lu, entreprise: C.migrateData({ company: decoder(lu.entreprise) }).company, client: decoder(lu.client),
      pieces: lu.pieces.map((/** @type {any} */ p) => ({ ...p, document: decoder(p.document) })),
      devis: (lu.devis || []).map((/** @type {any} */ d) => ({ ...d, document: decoder(d.document) })) };
    document.title = `${vue.entreprise.name} — espace client`;
    if (vue.lien === 'piece' && vue.pieces[0]) piece(vue.pieces[0]);
    else if (vue.lien === 'piece' && vue.devis[0]) devis(vue.devis[0]);
    // Le lien d'un devis encore en brouillon (l'envoi n'est pas allé jusqu'au bout) : il le dit, sans rien montrer.
    else if (vue.lien === 'piece') refus('Cette pièce n\'est pas encore envoyée.', ` Demande-la à ${vue.entreprise.name || 'l\'entreprise qui t\'a envoyé ce lien'}.`);
    else releve();
  }
  void ouvrir();
})();
