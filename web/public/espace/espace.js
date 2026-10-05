// @ts-check
// L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1). Le client d'une entreprise ouvre le
// lien qu'elle lui a donné, et voit, sans rien installer, ses pièces émises — chacune exactement comme
// l'entreprise l'imprime (le gabarit de la v10, `SkanCore.documentHtml`) — et ce qu'il en doit (le
// chiffre du serveur). Rien ne change d'ici. Le lien secret vit dans le fragment « # » de l'adresse :
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
  /** @type {any} */ let vue = null;
  // La devise telle que la pièce l'écrit (le dinar s'écrit « DT » sur les pièces).
  const devise = (/** @type {string} */ d) => (d === 'TND' ? 'DT' : d);
  const montant = (/** @type {string | null} */ x, /** @type {string} */ d) => C.money(Number(x), devise(d));
  /** @param {any} p */
  const titre = (p) => `${C.titreDePiece(p.document, vue.entreprise)} ${p.numero}`;

  function entete() {
    const e = vue.entreprise;
    return `<header class="societe">${e.logo ? `<img src="${esc(e.logo)}" alt="">` : ''}<div><h1>${esc(e.name)}</h1>
      <p>Espace de ${esc(vue.client.name || 'ton compte')}</p></div></header>`;
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

  // Le relevé : ce que le client doit, puis chacune de ses pièces émises.
  function releve() {
    const du = vue.totaux.filter((/** @type {any} */ t) => Number(t.du) > 0);
    racine.innerHTML = `${entete()}
      <section class="carte du">${du.length ? `<span>Tu dois</span> ${du.map((/** @type {any} */ t) => `<strong>${esc(montant(t.du, t.devise))}</strong>`).join(' ')}` : '<strong>Rien à payer</strong><span>Merci !</span>'}
        ${vue.pieces.some((/** @type {any} */ p) => p.payable) ? '<p class="aide">Pour payer en ligne, ouvre la facture (« Voir »).</p>' : ''}</section>
      <section class="carte">${vue.pieces.length ? `<table class="pieces"><thead><tr><th>Pièce</th><th>Date</th><th>Échéance</th><th class="m">Montant</th><th class="m">Reste à payer</th><th></th></tr></thead><tbody>
        ${vue.pieces.map((/** @type {any} */ p, /** @type {number} */ i) => `<tr><td><strong>${esc(titre(p))}</strong>${p.statut ? `<div class="statut ${esc(p.statut)}">${esc(/** @type {any} */ (STATUTS)[p.statut] || '')}</div>` : ''}${recu(p) ? `<div class="recu">${recu(p)}</div>` : ''}</td>
          <td>${etiquette('Date')}${esc(C.fmtDate(p.date))}</td><td>${etiquette('Échéance')}${p.echeance ? esc(C.fmtDate(p.echeance)) : '—'}</td>
          <td class="m">${etiquette('Montant')}${esc(montant(p.net, p.devise))}</td><td class="m">${etiquette('Reste à payer')}${p.reste === null ? '—' : esc(montant(p.reste, p.devise))}</td>
          <td><button type="button" data-voir="${i}">Voir</button></td></tr>`).join('')}</tbody></table>` : '<p>Aucune pièce émise pour le moment.</p>'}</section>
      <footer>Cette page montre les pièces que ${esc(vue.entreprise.name)} t'a émises. Pour une question, écris-lui directement.</footer>`;
    racine.querySelectorAll('[data-voir]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => piece(vue.pieces[Number(/** @type {HTMLElement} */ (b).dataset.voir)], true);
    });
  }

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
    try { sessionStorage.setItem('skanfact.espace', jeton); } catch { /* la page de retour proposera de la fermer */ }
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

  // Une pièce, comme l'entreprise l'imprime ; « Payer en ligne » si elle doit encore et que l'entreprise
  // l'accepte (c'est alors l'étape suivante : le bouton principal), « Imprimer ou enregistrer en PDF ».
  /** @param {any} p @param {boolean} retour */
  function piece(p, retour) {
    const tampon = p.statut === 'payee' ? 'Payée' : p.statut === 'annulee' ? 'Annulée' : undefined;
    racine.innerHTML = `${entete()}
      <div class="barre">${retour ? '<button type="button" id="retour">← Toutes tes pièces</button>' : ''}
        <span class="reste">${p.reste === null ? '' : Number(p.reste) > 0 ? `Reste à payer : <strong>${esc(montant(p.reste, p.devise))}</strong>` : 'Rien à payer sur cette pièce'}</span>
        <span class="gestes">${p.payable ? `<button type="button" class="principal" id="payer">Payer ${esc(montant(p.reste, p.devise))} en ligne</button>` : ''}
          <button type="button" ${p.payable ? '' : 'class="principal" '}id="imprimer">Imprimer ou enregistrer en PDF</button>
          ${p.document.ttn ? '<button type="button" id="efacture" title="La facture validée par la TTN (El Fatoora) : c\'est elle qui fait foi.">Facture électronique (XML)</button>' : ''}</span></div>
      <p class="refus-paiement" role="alert" hidden></p>
      <iframe class="piece" sandbox="allow-same-origin" title="${esc(titre(p))}"></iframe>`;
    const bp = /** @type {HTMLButtonElement | null} */ (document.getElementById('payer'));
    if (bp) bp.onclick = () => { void payer(p, bp); };
    const be = /** @type {HTMLButtonElement | null} */ (document.getElementById('efacture'));
    if (be) be.onclick = () => { void telechargerEfacture(p, be); };
    const cadre = /** @type {HTMLIFrameElement} */ (racine.querySelector('iframe.piece'));
    const zoom = Math.max(0.3, Math.min(1, Math.floor((cadre.clientWidth - 2) / 794 * 100) / 100));
    cadre.srcdoc = C.documentHtml(p.document, vue.client, vue.entreprise, { preview: true, stampText: tampon, zoom });
    const r = document.getElementById('retour');
    if (r) r.onclick = releve;
    /** @type {HTMLElement} */ (document.getElementById('imprimer')).onclick = () => {
      // Une page à part, mise en page comme la v10 le fait pour son PDF (resserrée, puis en vraies pages).
      // La pièce n'exécute rien (« sandbox ») : elle s'affiche, et s'imprime (« allow-modals »).
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
      f.srcdoc = C.documentHtml(p.document, vue.client, vue.entreprise, { stampText: tampon });
      document.body.appendChild(f);
    };
  }

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
    vue = { ...lu, entreprise: decoder(lu.entreprise), client: decoder(lu.client), pieces: lu.pieces.map((/** @type {any} */ p) => ({ ...p, document: decoder(p.document) })) };
    document.title = `${vue.entreprise.name} — espace client`;
    if (vue.lien === 'piece' && vue.pieces[0]) piece(vue.pieces[0], false);
    else releve();
  }
  void ouvrir();
})();
