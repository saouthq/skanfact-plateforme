  const bonDesArticles = (rows, supplierId) => ({ id: C.uid(), type: 'commandeFournisseur', number: '', status: 'brouillon', date: C.today(), dueDate: '',
    supplierId: supplierId || '', reference: '', currency: company().currency, exchangeRate: '', discountRate: 0, notes: '', createdAt: Date.now(),
    lines: rows.map(r => {
      const it = data.catalog.find(c => c.id === r.itemId) || {};
      const f = C.fournisseurDeLArticle(data, r.itemId);
      return { label: it.label || r.label, description: '', qty: r.aCommander, unit: it.unit || '',
        unitPrice: f && f.supplierId === supplierId ? f.unitCost : (Number(it.unitCost) || 0), vatRate: C.tauxAchatArticle(it, company()), itemId: r.itemId };
    }) });
  const ouvrirBon = o => { cfReprise = { hash: '#/commandef/new', o }; navigate('#/commandef/new'); };
  // Un article : son bon, chez le fournisseur de son dernier achat (s'il existe encore), pour ce qui manque.
  const ouvrirBonArticle = itemId => {
    const r = C.stockAlerts(data).find(x => x.itemId === itemId && x.kind !== 'negatif');
    if (!r || !(r.aCommander > 0)) return;
    const f = C.fournisseurDeLArticle(data, itemId);
    ouvrirBon(bonDesArticles([r], f && supplierById(f.supplierId) ? f.supplierId : ''));
  };

  // ---------- Stock (4.0.0) ----------
  const stockState = { tab: 'etat', q: '', only: '', counts: {}, countDate: C.today(), year: C.today().slice(0, 4), moves: { page: 1 }, etat: { page: 1 }, inv: { page: 1 }, alertes: { page: 1 },
    ser: { q: '', status: '', page: 1 } };
  const STOCK_TABS = [['etat', 'État du stock'], ['mouvements', 'Mouvements'], ['series', 'Numéros de série'], ['inventaire', 'Inventaire'], ['alertes', 'Alertes']];

  function adjustForm(itemId, done) {
    const items = C.trackedItems(data);
    if (!items.length) return toast('Aucun article n\'est suivi en stock. Coche « Suivi en stock » sur une prestation du catalogue.', true);
    const a = { id: C.uid(), date: C.today(), itemId: itemId || items[0].id, qty: 0, unitCost: '', source: 'casse', reference: '', note: '', createdAt: Date.now() };
    const cur = company().currency;
    modal(`<h2>Mouvement de stock</h2>
      <p class="small muted">Ce qui n'a ni facture ni achat : la matière utilisée sur un chantier, la casse, la perte, un cadeau, une correction d'inventaire. Les entrées d'achat et les sorties de vente remontent toutes seules — ne les saisis pas ici.</p>
      <form id="adf" class="grid-2">
        ${dateFieldHtml(lbl('Date', 'stk.adjustDate'), 'date', a.date, { obligatoire: true })}
        <div class="field obligatoire">${lbl('Article', 'stk.adjustItem')}
          ${combo({ name: 'itemId', value: a.itemId, items: items.map(c => ({ v: c.id, label: c.label, sub: c.unit || '', text: c.label })), placeholder: '— Choisir un article —', search: 'Rechercher un article…' })}
        </div>
        <label class="field">${lbl('Nature', 'stk.moveKind')}<select name="source">${C.MOVE_SOURCES.filter(([k]) => ['casse', 'consommation', 'inventaire', 'ajustement'].includes(k)).map(([v, l]) => `<option value="${v}" ${a.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field(`<span class="fl"><span id="adj-qlbl">Quantité sortie</span> ${info('stk.adjustQty')}</span>`, 'qty', '', 'number', 'step="0.01" class="num" placeholder="ex. 10"')}
        ${field(lbl(`Coût unitaire (${h(C.normCurrency(company().currency))}, optionnel)`, 'stk.adjustCost'), 'unitCost', '', 'number', 'step="0.001" min="0" class="num" placeholder="laisse vide : coût moyen"')}
        ${field(lbl('Référence', 'stk.adjustRef'), 'reference', '', 'text', '')}
        ${/* (1.263.0) La matière utilisée sur un chantier compte dans sa marge : on dit pour quelle affaire. */''}
        <label class="field span-2" id="adj-aff">${lbl('Pour l\'affaire (matière utilisée)', 'stk.adjustProject')}<small class="mu" id="adj-aff-dit"></small><select name="projectId"><option value="">Aucune affaire</option>${(data.projects || []).filter(x => x.status === 'en cours').map(x => `<option value="${h(x.id)}">${h(x.name)}</option>`).join('')}</select></label>
        <label class="field span-2">${lbl('Note', 'stk.adjustNote')}<input type="text" name="note" placeholder="Ce qui s'est passé, en une phrase"></label>
        <div class="span-2 annonce-stable" id="adj-hint"></div>
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=itemId]', root), { items: items.map(c => ({ v: c.id, label: c.label, text: c.label })), placeholder: '— Choisir un article —' });
        // Le libellé et l'invite suivent la nature : une casse ou de la matière utilisée se saisit en
        // quantité SORTIE, positive, et `C.qteMouvement` la signe ; seuls l'inventaire et l'ajustement
        // restent signés. Le libellé change EN PLACE (même ligne, même largeur) : rien ne descend.
        const avecUnite = (n, u) => pct(n) + (u ? ' ' + h(C.uniteAccordee(n, u)) : '');
        const hint = () => {
          const v = formValues($('#adf', root));
          const sortie = C.SOURCES_SORTIE.includes(v.source);
          $('#adj-qlbl', root).textContent = sortie ? 'Quantité sortie' : 'Quantité (+ entre, − sort)';
          $('[name=projectId]', root).disabled = v.source !== 'consommation';
          $('#adj-aff-dit', root).textContent = v.source === 'consommation' ? 'Sa valeur, au coût moyen, compte dans la marge de l\'affaire.' : 'Seule la « Matière utilisée » va à une affaire : une casse ou un inventaire ne se consomme pas sur un chantier.';
          $('[name=qty]', root).placeholder = sortie ? 'ex. 10' : 'ex. -2 ou 3';
          const s = C.stockOf(data, v.itemId);
          const q = C.qteMouvement(v.source, v.qty);
          const after = C.round3(s.qty + q);
          $('#adj-hint', root).innerHTML = `<span class="small ${after < 0 ? 'warn-text' : 'muted'}">`
            + `Stock actuel : <b>${avecUnite(s.qty, s.unit)}</b> au coût moyen de ${C.money(s.cmp, cur)}. `
            + (q ? `${q < 0 ? (Math.abs(q) < 2 ? 'Sort' : 'Sortent') : (Math.abs(q) < 2 ? 'Entre' : 'Entrent')} ${avecUnite(Math.abs(q), s.unit)} : il en restera <b>${avecUnite(after, s.unit)}</b>.`
              : (sortie ? 'Tape la quantité qui quitte le stock : elle sera retirée.' : 'Une quantité négative sort de la marchandise, une positive en fait rentrer.'))
            + (after < 0 ? ' Un stock négatif veut dire qu\'une entrée manque quelque part.' : '') + '</span>';
        };
        $('#adf', root).oninput = $('#adf', root).onchange = hint; hint();
        $('#ok', root).onclick = () => {
          if (enLecture('stockAdjustments')) return refus($('[name=itemId]', root), refusLecture('stockAdjustments'));
          const v = formValues($('#adf', root));
          if (!v.itemId) return refus($('[name=itemId]', root), 'Choisis un article.');
          const qte = C.qteMouvement(v.source, v.qty);
          if (!qte) { refus($('[name=qty]', root), 'La quantité ne peut pas être zéro.'); return; }
          if (!v.date) return refus($('[name=date]', root), 'Date invalide.');
          if (closedBlock(v.date, 'Ce mouvement de stock')) return;
          if (licenceBlock('Créer un mouvement de stock', 'stock')) return;
          const mv = { ...a, ...v, qty: qte, unitCost: v.unitCost === '' ? '' : Number(v.unitCost) };
          // Seule la matière utilisée va à une affaire : une casse ou un inventaire ne se consomme pas sur un chantier.
          if (v.source !== 'consommation' || !v.projectId) delete mv.projectId;
          data.stockAdjustments.push(mv);
          save(true); close(); if (done) done();
        };
      });
  }

  // ---------- la caisse (10.15.0, H5 de l'étude Hesabi) ----------
  //
  // Vendre au comptoir en trois gestes : l'article (scanné par une douchette, cherché ou cliqué), le
  // paiement, le ticket. La douchette USB se comporte comme un clavier — elle tape le code puis
  // Entrée —, donc le champ du haut garde le curseur après chaque article : on scanne à la suite
  // sans toucher la souris. Le panier survit à un changement de page (on va vérifier un prix, on
  // revient), et il ne vit qu'en mémoire : un ticket n'existe qu'une fois encaissé.
  const caisseState = { tab: 'vendre', panier: [], mode: 'especes', recu: '', clientId: '', q: '', jour: '', dernierId: null };
  const CAISSE_TABS = [['vendre', 'Vendre'], ['tickets', 'Tickets et bilan du jour']];
  function imprimerTicketDe(doc) {
    const html = C.ticketHtml(doc, company(), { clientName: doc.clientId ? clientName(doc.clientId) : '', exemple: C.estDemo(data) });
    return Promise.resolve(bridge.imprimerTicket(html, company().caisseLargeur)).then(r => {
      if (r && !r.ok && !r.annule && r.raison) toast('L\'impression n\'a pas pu partir : ' + r.raison, true);
    }).catch(e => toast(plainError(e), true));
  }
  function ticketEnPdf(doc) {
    const html = C.ticketHtml(doc, company(), { clientName: doc.clientId ? clientName(doc.clientId) : '', exemple: C.estDemo(data) });
    return Promise.resolve(bridge.ticketPdf(html, company().caisseLargeur, `${doc.number}.pdf`))
      .then(p => { if (p) toast('Ticket enregistré : ' + p); }).catch(e => toast(plainError(e), true));
  }
  // La caisse, créée d'ici : la page qui en a besoin est celle où on la crée (7.14.0). Le fond de
  // caisse est l'argent déjà dans le tiroir au premier jour — c'est de lui que partira le compte.
  function creerCaisse(done) {
    modal(`<h2>Créer la caisse</h2>
      <p class="small">Les espèces encaissées au comptoir vont dans ce compte, pas à la banque : c'est ce qui permet à SkanFact de dire, le soir, combien le tiroir doit contenir.</p>
      <form id="ccf" class="grid-2">
        <label class="field span-2 obligatoire">${lbl('Nom', 'cs.nomCaisse')}<input type="text" name="name" value="Caisse"></label>
        ${field(lbl(`Fond de caisse au départ (${h(C.normCurrency(company().currency))})`, 'cs.fond'), 'opening', 0, 'number', 'step="0.001" min="0" class="num"')}
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Créer la caisse</button></div>`,
    (root, close) => {
      $('#ok', root).onclick = () => {
        const v = formValues($('#ccf', root));
        if (!String(v.name || '').trim()) return refus($('[name=name]', root), 'Donne un nom à ce compte.');
        const a = { id: C.uid(), name: v.name.trim(), kind: 'caisse', bank: '', rib: '', opening: Number(v.opening) || 0, openingDate: C.today(),
          isDefault: !data.accounts.length, statementBalance: '', notes: '' };
        data.accounts.push(a);
        save(true); close(); toast('Caisse créée : les espèces y arrivent désormais.'); if (done) done(a);
      };
    });
  }
  function ticketApercu(doc) {
    const reste = C.resteARendre(data, doc);
    const peutRendre = reste.some(r => r.reste > 0);
    modal(`<h2>Ticket ${h(doc.number)}</h2>
      <iframe class="cs-apercu" title="Aperçu du ticket ${h(doc.number)}" sandbox></iframe>
      <div class="modal-actions">
        ${peutRendre ? '<button class="btn" id="tk-rendre" style="margin-inline-end:auto">Rendre un article…</button>' : ''}
        <button class="btn" data-close>Fermer</button>
        <button class="btn" id="tk-pdf">Enregistrer en PDF</button>
        <button class="btn btn-primary" id="tk-print">Imprimer le ticket</button></div>`,
    (root, close) => {
      $('iframe', root).srcdoc = C.ticketHtml(doc, company(), { clientName: doc.clientId ? clientName(doc.clientId) : '', exemple: C.estDemo(data) });
      $('#tk-print', root).onclick = () => imprimerTicketDe(doc);
      $('#tk-pdf', root).onclick = () => ticketEnPdf(doc);
      if ($('#tk-rendre', root)) $('#tk-rendre', root).onclick = () => { close(); rendreForm(doc); };
    }, null, { garde: false });
  }
  // Rendre un article : on choisit quoi (jamais plus que ce qui reste à rendre), comment on rend
  // l'argent, et le montant se lit AVANT de valider (9.4.2).
  // (plateforme, brique 124) Qui approuve le retour : les responsables qui ont posé leur code de responsable.
  // `quoi` nomme le geste dans la phrase qui dit qu'aucun responsable n'a de code ; rend le nombre de responsables.
  // Un seul responsable : il est déjà choisi, on tape son code.
  async function dessinerResponsable(el, quoi = 'Un retour') {
    let liste;
    try { liste = await bridge.responsables(); } catch (e) { el.innerHTML = `<p class="small warn-text" style="grid-column:1/-1">${h(plainError(e))}</p>`; return 0; }
    el.innerHTML = liste.length
      ? `<label class="field">${lbl('Responsable présent', 'cs.responsable')}<select id="rd-resp">${liste.length > 1 ? '<option value="">Choisis…</option>' : ''}${liste.map(x => `<option value="${h(x.id)}">${h(x.nom)}</option>`).join('')}</select></label>
        <label class="field">Son code de responsable<input type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="num" id="rd-code"></label>`
      : `<p class="small warn-text" id="rd-sans-responsable" style="grid-column:1/-1">${h(quoi)} se fait avec le code d'un responsable présent, et aucun n'a encore posé le sien : le propriétaire ou un administrateur le pose depuis la page Caisse, avec « Mon code de responsable… ».</p>`;
    return liste.length;
  }
  // (plateforme, brique 125) Demander le code d'un responsable présent avant un geste ; `ok` reçoit { utilisateur, code }.
  function demanderResponsable(titre, texte, ok) {
    modal(`<h2>${h(titre)}</h2><p>${h(texte)}</p><div class="grid-2 mt" id="rd-responsable"></div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="rs-ok" disabled>Approuver</button></div>`,
      (root, close) => {
        // « Approuver » attend la liste ; sans responsable qui a posé son code, il reste gris et la phrase dit pourquoi.
        // Sinon le curseur attend dans la case du code : le responsable n'a qu'à taper.
        void dessinerResponsable($('#rd-responsable', root), 'Une remise au-delà de celle permise sans code').then(n => {
          $('#rs-ok', root).disabled = !n;
          if (n) $('#rd-code', root).focus();
        });
        $('[data-close]', root).onclick = close;
        $('#rs-ok', root).onclick = () => {
          const qui = $('#rd-resp', root), code = $('#rd-code', root);
          if (!qui.value) return refus(qui, 'Choisis le responsable présent : c\'est lui qui tape son code.');
          if (!/^[0-9]{4}$/.test(code.value)) return refus(code, 'Le code de responsable a 4 chiffres.');
          close();
          ok({ utilisateur: qui.value, code: code.value });
        };
      });
  }
  async function rendreParLeServeur(doc, r, root, close) {
    const b = $('#ok', root);
    let responsable;
    if ($('#rd-responsable', root)) {
      const qui = $('#rd-resp', root), code = $('#rd-code', root);
      if (!qui) return refus($('[data-rd]', root), 'Un retour se fait avec le code d\'un responsable présent : aucun n\'a encore posé le sien.');
      if (!qui.value) return refus(qui, 'Choisis le responsable présent : c\'est lui qui tape son code.');
      if (!/^[0-9]{4}$/.test(code.value)) return refus(code, 'Le code de responsable a 4 chiffres.');
      responsable = { utilisateur: qui.value, code: code.value };
    }
    b.disabled = true;
    try {
      const x = await bridge.rendreTicket(doc, Object.assign({}, r.avoir, { number: '' }), r.paiement, r.montant, responsable);
      data.documents.push(x.avoir);
      const i = data.documents.findIndex(d => d.id === doc.id);
      if (i >= 0) data.documents[i] = x.ticket;
      close();
      toast(`Avoir ${x.numero} : ${C.money(r.montant, company().currency)} rendus.`);
      vers('#/caisse')();
    } catch (e) {
      b.disabled = false;
      if ($('#rd-code', root)) $('#rd-code', root).value = '';
      refus($('#rd-code', root) || $('[data-rd]', root), plainError(e));
    }
  }
  function rendreForm(doc) {
    const reste = C.resteARendre(data, doc).filter(r => r.reste > 0);
    const cur = company().currency;
    const modeOrig = (doc.caisse || {}).mode || 'especes';
    modal(`<h2>Rendre sur le ticket ${h(doc.number)}</h2>
      <p class="small muted">Un avoir est établi sur le ticket, l'article revient au stock, et l'argent rendu sort du compte du mode choisi.</p>
      <table class="list compact" id="rd-t"><thead><tr><th>Article</th><th class="r">Vendu</th><th class="r">Déjà rendu</th><th class="r" style="width:110px">À rendre</th></tr></thead><tbody>
        ${reste.map(r => `<tr><td>${h(r.label)}</td><td class="r">${pct(r.vendu)}</td><td class="r">${pct(r.rendu)}</td>
          <td class="r"><input type="number" class="num" data-rd="${r.i}" min="0" max="${r.reste}" step="1" value="0" aria-label="Quantité rendue : ${h(r.label)}"></td></tr>`).join('')}
      </tbody></table>
      <form id="rdf" class="grid-2 mt">
        <label class="field">${lbl('Rendu en', 'cs.modeRendu')}<select name="mode">${C.MODES_CAISSE.map(([k, l]) => `<option value="${k}" ${k === modeOrig ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">${lbl('Motif', 'cs.motif')}<input type="text" name="motif" placeholder="Article défectueux, échange…"></label>
      </form>
      ${bridge.rendreTicket && !(bridge.droitsDossier ? bridge.droitsDossier() : {}).responsable ? '<div class="grid-2 mt" id="rd-responsable"></div>' : ''}
      <p class="annonce-stable" id="rd-annonce"></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok" disabled style="min-width:14em;justify-content:center">Rembourser</button></div>`,
    (root, close) => {
      const qtes = () => { const o = {}; $$('[data-rd]', root).forEach(i => { o[i.dataset.rd] = Math.min(Number(i.max) || 0, Math.max(0, Number(i.value) || 0)); }); return o; };
      const annonce = () => {
        const q = qtes();
        const lignes = reste.filter(r => q[r.i] > 0).map(r => ({ ...doc.lines[r.i], qty: q[r.i] }));
        const t = C.computeTotals({ type: 'avoir', lines: lignes, discountRate: Number(doc.discountRate) || 0, applyStamp: false, currency: doc.currency }, company());
        $('#rd-annonce', root).innerHTML = lignes.length
          ? `À rendre au client : <b>${C.money(t.netToPay, cur)}</b>.`
          : '<span class="muted">Indique la quantité rendue sur la ligne de l\'article.</span>';
        // Rien de choisi : le bouton s'éteint (9.4.5) et l'annonce dit pourquoi ; sa largeur est
        // réservée, sinon le montant qui s'y écrit pousse « Annuler » sous le curseur (H-E1).
        $('#ok', root).textContent = lignes.length ? `Rembourser ${C.money(t.netToPay, cur)}` : 'Rembourser';
        $('#ok', root).disabled = !lignes.length;
      };
      root.addEventListener('input', annonce); annonce();
      if ($('#rd-responsable', root)) dessinerResponsable($('#rd-responsable', root));
      $('#ok', root).onclick = () => {
        const v = formValues($('#rdf', root));
        if (closedBlock(C.today(), 'Ce remboursement')) return;
        if (licenceBlock('Émettre un avoir sur un ticket', 'caisse')) return;
        const r = C.remboursementDeTicket(data, company(), doc, qtes(), { mode: v.mode, motif: v.motif });
        // Le refus montre la case qui le règle : le mode quand c'est le compte qui manque, sinon la quantité.
        if (!r.ok) return refus(C.compteDuMode(data, v.mode) ? $('[data-rd]', root) : $('[name=mode]', root), r.motif);
        // (plateforme, brique 124) Le serveur numérote l'avoir et rend l'argent : le numéro pris sur ce poste ne sert pas.
        if (bridge.rendreTicket) { void rendreParLeServeur(doc, r, root, close); return; }
        data.documents.push(r.avoir);
        doc.payments = (doc.payments || []).concat([r.paiement]);
        save(true); close();
        toast(`Avoir ${r.avoir.number} : ${C.money(r.montant, cur)} rendus.`);
        vers('#/caisse')();
      };
    });
  }

  // (plateforme, brique 116) La session de caisse, telle que le serveur l'a dite la dernière fois.
  let caisseEtat = null;
  // (05/10/2026) La caisse tactile : l'écran de vente, redessiné quand la session lue au serveur change ce qu'il montre.
  let caisseRedessiner = null;
  // L'écran tourné vers le client (plateforme/ecran-client.html) : une seconde fenêtre du poste, sur l'écran du client,
  // qui montre le ticket en cours, ce qu'il paie et sa monnaie. Elle ne lit rien au serveur : la caisse lui dit ce qu'elle
  // montre par un canal du navigateur, sur ce poste seulement.
  let canalClient = null, pourLeClient = null;
  function ecranClient(etat, extra) {
    if (typeof BroadcastChannel === 'undefined') return;
    const s = caisseState, cur = company().currency;
    const t = C.totauxDuPanier(s.panier, company(), { recu: '', remise: s.remise });
    pourLeClient = Object.assign({ etat, societe: company().name || '', pied: company().caissePied || '',
      lignes: s.panier.map((l, i) => ({ nom: l.label, qte: pct(l.qty), total: C.money((t.lines[i] || {}).ttc || 0, cur) })),
      remise: t.discount ? `− ${C.money(t.remiseTtc, cur)}` : '', total: C.money(t.netToPay, cur) }, extra || {});
    try {
      if (!canalClient) {
        canalClient = new BroadcastChannel(`skanfact-ecran-client:${new URLSearchParams(location.search).get('e') || ''}`);
        // L'écran du client qui s'ouvre demande ce que la caisse montre.
        canalClient.onmessage = m => { if (m.data && m.data.demande && pourLeClient) canalClient.postMessage(pourLeClient); };
      }
      canalClient.postMessage(pourLeClient);
    } catch (_) { /* sans canal, pas d'écran du client */ }
  }
  function ouvrirEcranClient() {
    const w = window.open(`../plateforme/ecran-client.html?e=${encodeURIComponent(new URLSearchParams(location.search).get('e') || '')}`, 'skanfact-ecran-client', 'popup,width=1024,height=600');
    if (!w) toast('Le navigateur a bloqué la fenêtre de l\'écran du client : autorise les fenêtres de SkanFact, puis réessaie.', true);
    else toast('L\'écran du client est ouvert : glisse sa fenêtre sur l\'écran tourné vers le client, et mets-la en plein écran (F11).');
  }
  // La douchette tape comme un clavier : à la caisse, une frappe qui n'arrive dans aucun champ (le doigt vient de toucher
  // une tuile, ou l'écran montre encore la monnaie de la vente d'avant) va au champ du haut — on scanne sans viser.
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('mode-caisse') || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .modal-bg')) return;
    if ($('#modal-root') && $('#modal-root').children.length) return;
    if ($('#cs-rendu-ecran') && $('#cs-nouvelle')) $('#cs-nouvelle').click();
    if ($('#cs-scan')) $('#cs-scan').focus();
  }, true);
  const argentCaisse = v => C.money(Number(v), caisseEtat && caisseEtat.devise !== 'TND' ? caisseEtat.devise : 'DT');
  const heureCaisse = x => new Date(x).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // Ce qui empêche d'encaisser du côté de la session (la même règle que le serveur) ; vide si rien.
  function motifSession() {
    if (!bridge.caisse || !caisseEtat) return '';
    if (!caisseEtat.session) return 'La caisse est fermée : ouvre-la avec ton fond de caisse.';
    if (!caisseEtat.session.ici) return `La caisse est ouverte sur un autre appareil (« ${caisseEtat.session.appareil} ») : une caisse n'est tenue que par un appareil à la fois.`;
    return '';
  }
  async function dessinerSession() {
    try { caisseEtat = await bridge.caisse(); } catch (e) {
      // (brique 120) Sans réseau, le poste qui tient la caisse encaisse quand même : il le dit, avec le prochain numéro.
      const hl = e && e.horsLigne && bridge.caisseSansReseau ? bridge.caisseSansReseau() : null;
      if ($('#cs-session')) $('#cs-session').innerHTML = hl
        ? `<div class="banner info lock-banner" id="cs-hors-ligne"><span><b>Sans réseau.</b> Cette caisse encaisse quand même : ses tickets se numérotent sur ce poste (le prochain : ${h(hl.prochain)}), se gardent chiffrés, et partiront au serveur, dans l'ordre, au retour du réseau. ${info('cs.horsLigne')}</span></div>`
        : `<div class="banner warn"><span>${h(plainError(e))}</span></div>`;
      if ($('#cs-etat')) $('#cs-etat').innerHTML = hl ? '<span class="ct-puce hors-ligne">Sans réseau : la caisse encaisse sur ce poste</span>' : '';
      return;
    }
    const el = $('#cs-session');
    if (!el) return;
    const ss = caisseEtat.session;
    // (05/10/2026) L'état de la caisse se lit dans la barre du haut ; fermée ou tenue ailleurs, l'écran de vente le dit en
    // grand, et l'ouvre.
    $('#cs-etat').innerHTML = !ss ? '<span class="ct-puce fermee" id="cs-puce">Caisse fermée</span>'
      : !ss.ici ? `<span class="ct-puce ailleurs" id="cs-puce">Ouverte sur « ${h(ss.appareil)} »</span>`
      : `<span class="ct-puce ouverte" id="cs-ouverte" title="Ouverte par ${h(ss.qui)} le ${h(heureCaisse(ss.ouverteLe))}. Fond de caisse : les espèces du tiroir à l'ouverture"><span class="ct-puce-texte">Ouverte<span class="ct-puce-qui"> par ${h(ss.qui)} le ${h(heureCaisse(ss.ouverteLe))}</span> · fond ${h(argentCaisse(ss.fond))}</span></span>`;
    el.innerHTML = '';
    // (brique 123) Qui est au poste, et les gestes de la session (fermer, son code…).
    gestesCaisse();
    // (brique 120) Les alertes de caisse, pour le propriétaire et l'administrateur : ce que le serveur a constaté sur les
    // tickets d'un poste, sans rien corriger.
    if ((caisseEtat.alertes || []).length) el.insertAdjacentHTML('beforeend', alertesCaisse(caisseEtat.alertes));
    // (brique 122) Le bilan dessiné avant la réponse redit le tiroir selon la session lue.
    if ($('#cs-tiroir') && dernierBilan) $('#cs-tiroir').innerHTML = sousTiroir(dernierBilan.b, dernierBilan.cur);
    // L'écran de vente suit l'état lu (la page a pu se dessiner avant la réponse).
    if (caisseRedessiner) caisseRedessiner();
  }
  // (brique 122) Le tiroir se compte sans voir ce qu'il devrait contenir (le Z, brique 116) : tant que la session du jour
  // est ouverte, ni la page ni le bilan imprimé ne le disent ; après le Z du jour, la page redit ses chiffres (ceux du
  // serveur : le fond plus les espèces de la session). Un autre jour, ou sans point de contact : comme la v10.
  const caisseDuJour = jour => !!(bridge.caisse && jour === C.today() && (caisseEtat || (bridge.caisseSansReseau && bridge.caisseSansReseau())));
  const jourTunis = x => new Date(x).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  let dernierBilan = null;
  function sousTiroir(b, cur) {
    dernierBilan = { b, cur };
    if (caisseDuJour(b.jour)) {
      // Sans réseau, le poste qui tient la caisse : sa session est ouverte.
      if (!caisseEtat || caisseEtat.session) return 'Le tiroir se compte à la fermeture (Z), sans voir ce qu\'il devrait contenir.';
      const z = caisseEtat.dernierZ;
      if (z && jourTunis(z.fermeeLe) === b.jour) return `Au Z, le tiroir devait contenir <b>${h(argentCaisse(z.attendu))}</b> ; compté : ${h(argentCaisse(z.compte))}.`;
    }
    return b.tiroir != null ? `Le tiroir doit contenir <b>${C.money(b.tiroir, cur)}</b> ce soir, fond de caisse compris` : 'aucun compte de caisse';
  }
  const bilanAImprimer = b => (caisseDuJour(b.jour) ? Object.assign({}, b, { tiroir: null }) : b);
  // (brique 120) Les tickets gardés sans réseau sont partis : la page Caisse redit l'état de sa session.
  window.addEventListener('skanfact-tickets-remis', () => { if ($('#cs-session')) dessinerSession(); });
  // (plateforme) 1.94.0 — les questions du cabinet, relues par le point de contact : elles entrent dans les données, et
  // l'Accueil (« À faire ») et la Comptabilité se redessinent ; jamais pendant une saisie (une fenêtre, une case active).
  window.addEventListener('skanfact-questions', e => {
    data.questionsCabinet = Array.isArray(e.detail) ? e.detail : [];
    const enSaisie = !!$('#modal-root .modal') || !!(document.activeElement && document.activeElement.matches('input, textarea, select'));
    if (!enSaisie && /^(#\/(dashboard|compta)([?].*)?)?$/.test(location.hash)) render();
  });
  const PHRASES_ALERTE = {
    numero: a => `Le ticket imprimé ${h(a.numeroPoste)} est enregistré sous le numéro ${h(a.numeroSerie)} : les deux numéros diffèrent.`,
    chaine: a => `Le ticket ${h(a.numeroSerie)} ne suit pas le ticket précédent de cette caisse : la chaîne des tickets est cassée (un ticket manque ou a été remplacé).`,
    empreinte: a => `Le ticket ${h(a.numeroSerie)} ne correspond pas à ce que le poste avait scellé : il a pu être modifié entre la vente et son envoi.`,
    apres_fermeture: a => `Le ticket ${h(a.numeroSerie)} est arrivé après le Z de sa session : ce Z ne le compte pas.`,
    remise: a => `Le ticket ${h(a.numeroSerie)} a été remisé de ${h((a.detail || {}).taux || '?')} % sans réseau, au-delà du plafond de la caisse (${h((a.detail || {}).plafond || '0')} %), sans le code d'un responsable.`,
  };
  function alertesCaisse(alertes) {
    return `<div class="banner warn" id="cs-alertes"><span><b>${alertes.length > 1 ? `${alertes.length} alertes de caisse` : 'Une alerte de caisse'}.</b> SkanFact n'a rien corrigé : chaque ticket est enregistré tel qu'il est arrivé. ${info('cs.alertes')}
      <ul class="cs-alertes">${alertes.map(a => `<li>${(PHRASES_ALERTE[a.nature] || (() => h(a.nature)))(a)} <span class="muted">(${h(heureCaisse(a.le))})</span></li>`).join('')}</ul></span></div>`;
  }
  // (brique 123) Changer de caissier : sur l'appareil de la caisse, le suivant choisit son nom et tape son code de caisse ;
  // la caisse reste ouverte sur ce poste, et les tickets suivants portent son nom. Chaque caissier pose son code lui-même.
  // (05/10/2026) Qui est au poste se lit dans la barre du haut (sur le poste de la caisse, toucher son nom passe la main) ;
  // les gestes plus rares — fermer la caisse, son code, l'écran du client, quitter la caisse — sont dans le menu « ⋯ ».
  const initialeDe = nom => (String(nom || '').trim()[0] || '?').toUpperCase();
  function gestesCaisse() {
    if (!$('#cs-menu')) return;
    const d = bridge.droitsDossier ? bridge.droitsDossier() : {};
    const e = caisseEtat || {};
    const ss = e.session;
    $('#cs-gestes').innerHTML = e.posteDeCaisse
      ? `<button type="button" class="ct-bouton ct-caissier" id="cs-relais" aria-label="${h(e.moi || 'Le caissier')} est au poste : changer de caissier"><span class="ct-avatar" aria-hidden="true">${h(initialeDe(e.moi))}</span><span id="cs-moi">${h(e.moi || 'Changer de caissier')}</span><span aria-hidden="true" class="ct-chevron">⌄</span></button>`
      : e.moi ? `<span class="ct-caissier"><span class="ct-avatar" aria-hidden="true">${h(initialeDe(e.moi))}</span><span id="cs-moi">${h(e.moi)}</span></span>` : '';
    $('#cs-menu').innerHTML = [
      ss && (ss.ici || fermerDIci()) ? `<button type="button" role="menuitem" id="cs-fermer">${ss.ici ? 'Fermer la caisse (Z)…' : 'Fermer d\'ici la caisse de cet appareil (Z)…'}</button>` : '',
      e.posteDeCaisse ? '<button type="button" role="menuitem" id="cs-relais-menu">Changer de caissier…</button>' : '',
      d.caisse && !d.responsable ? '<button type="button" role="menuitem" id="cs-mon-code">Mon code de caisse…</button>' : '',
      d.responsable && bridge.poserCodeResponsable ? '<button type="button" role="menuitem" id="cs-code-responsable">Mon code de responsable…</button>' : '',
      typeof BroadcastChannel !== 'undefined' ? '<button type="button" role="menuitem" id="cs-ecran-client">Ouvrir l\'écran du client</button>' : '',
      '<hr>', '<button type="button" role="menuitem" id="cs-quitter">Quitter la caisse</button>'].filter(Boolean).join('');
    if ($('#cs-fermer')) $('#cs-fermer').onclick = fermerCaisse;
    if ($('#cs-relais')) $('#cs-relais').onclick = changerDeCaissier;
    if ($('#cs-relais-menu')) $('#cs-relais-menu').onclick = changerDeCaissier;
    // (Sans l'événement du clic, que la fenêtre lirait comme « responsable ».)
    if ($('#cs-mon-code')) $('#cs-mon-code').onclick = () => monCodeDeCaisse(false);
    if ($('#cs-code-responsable')) $('#cs-code-responsable').onclick = () => monCodeDeCaisse(true);
    if ($('#cs-ecran-client')) $('#cs-ecran-client').onclick = ouvrirEcranClient;
    $('#cs-quitter').onclick = () => { location.hash = '#/dashboard'; };
  }
  function fermerMenuCaisse() {
    const m = $('#cs-menu');
    if (!m || m.hidden) return;
    m.hidden = true;
    if ($('#cs-menu-bouton')) $('#cs-menu-bouton').setAttribute('aria-expanded', 'false');
  }
  // Un clic ailleurs referme le menu de la caisse.
  document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('.ct-menu')) fermerMenuCaisse(); });
  async function changerDeCaissier() {
    let liste;
    try { liste = (await bridge.caissiers()).filter(c => !c.moi); } catch (e) { toast(plainError(e), true); return; }
    modal(`<h2>Changer de caissier</h2>
      <p>La caisse reste ouverte sur ce poste, avec son tiroir : les tickets suivants porteront le nom de qui prend la main. Choisis ton nom, puis tape ton code de caisse.</p>
      ${liste.length ? `<div class="field" id="cs-caissiers" role="radiogroup" aria-label="Qui prend la caisse">${liste.map((c, i) => `<label class="check"><input type="radio" name="cs-caissier" value="${h(c.id)}"${i === 0 && liste.length === 1 ? ' checked' : ''}> <span>${h(c.nom)}</span></label>`).join('')}</div>
        <label class="field">Ton code de caisse (4 chiffres)<input type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="num" id="cs-code"></label>`
        : '<p class="small warn-text" id="cs-aucun">Aucun autre caissier n\'a encore posé son code de caisse : chacun le pose depuis la page Caisse, avec « Mon code de caisse… », connecté avec son mot de passe.</p>'}
      <p class="small warn-text" role="alert" id="cs-relais-refus"></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>${liste.length ? '<button class="btn btn-primary" id="cs-prendre">Prendre la caisse</button>' : ''}</div>`,
      (root, close) => {
        $('[data-close]', root).onclick = close;
        if (!liste.length) return;
        const refus = t => { $('#cs-relais-refus', root).textContent = t; };
        $('#cs-prendre', root).onclick = async () => {
          const choisi = $('input[name="cs-caissier"]:checked', root);
          const code = $('#cs-code', root);
          if (!choisi) { refus('Choisis d\'abord ton nom dans la liste.'); return; }
          if (!/^[0-9]{4}$/.test(code.value)) { refus('Le code de caisse a 4 chiffres.'); code.focus(); return; }
          const b = $('#cs-prendre', root); b.disabled = true;
          try {
            await bridge.relayerCaisse(choisi.value, code.value);
            // Le poste est maintenant à la personne qui a pris la main : tout se relit avec ses droits.
            location.reload();
          } catch (e) { b.disabled = false; code.value = ''; refus(plainError(e)); code.focus(); }
        };
        const code = $('#cs-code', root);
        code.onkeydown = ev => { if (ev.key === 'Enter') $('#cs-prendre', root).click(); };
        ($('input[name="cs-caissier"]:checked', root) ? code : $('input[name="cs-caissier"]', root)).focus();
      });
  }
  function monCodeDeCaisse(responsable) {
    modal(`<h2>${responsable ? 'Mon code de responsable' : 'Mon code de caisse'}</h2>
      <p>${responsable ? 'Quatre chiffres, à toi seul. À la caisse, un retour, ou une remise au-delà de celle permise sans code, se fait avec le code d\'un responsable présent : tu le tapes sur le poste de la caisse, et l\'avoir ou le ticket porte ton nom. Il n\'ouvre rien d\'autre. Ne le donne à personne.'
        : 'Quatre chiffres, à toi seul. Sur le poste de la caisse, « Changer de caissier… », ton nom, ton code : la caisse est à toi, sans mot de passe. Ne le donne à personne : les tickets que tu encaisses portent ton nom.'}</p>
      <label class="field">Nouveau code (4 chiffres)<input type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="num" id="cs-nouveau"></label>
      <label class="field">Le même, encore une fois<input type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="num" id="cs-nouveau-bis"></label>
      <p class="small warn-text" role="alert" id="cs-code-refus"></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="cs-code-ok">Enregistrer mon code</button></div>`,
      (root, close) => {
        $('[data-close]', root).onclick = close;
        const refus = (t, champ) => { $('#cs-code-refus', root).textContent = t; champ.focus(); };
        $('#cs-code-ok', root).onclick = async () => {
          const a = $('#cs-nouveau', root), b = $('#cs-nouveau-bis', root);
          if (!/^[0-9]{4}$/.test(a.value)) { refus('Le code de caisse a 4 chiffres, ni plus ni moins.', a); return; }
          if (a.value !== b.value) { refus('Les deux codes ne sont pas les mêmes : retape-le.', b); return; }
          try { await (responsable ? bridge.poserCodeResponsable(a.value) : bridge.poserCodeCaisse(a.value)); close(); toast(responsable ? 'Ton code de responsable est enregistré.' : 'Ton code de caisse est enregistré.'); }
          catch (e) { a.value = ''; b.value = ''; refus(plainError(e), a); }
        };
        $('#cs-nouveau', root).focus();
      });
  }
  // Fermer : compter le tiroir sans voir ce qu'il devrait contenir ; le serveur dit l'attendu et l'écart, et fige le Z.
  // (05/10/2026) Le comptage se fait sur l'écran de la caisse, billet par billet et pièce par pièce, ou le total tapé.
  // (plateforme, 1.87.14) Le propriétaire et l'administrateur ferment la caisse d'un autre appareil (perdu, éteint, loin) :
  // c'est la règle du serveur (caisse.fermer_ailleurs). L'écran la taisait, et le commerçant au téléphone perdu restait
  // sans caisse (recette du 21/10/2026).
  function fermerDIci() { return Boolean(bridge.droitsDossier && bridge.droitsDossier().responsable); }
  function fermerCaisse() {
    caisseState.tab = 'vendre'; caisseState.ecran = 'fermeture';
    vers('#/caisse')();
  }
  // (plateforme, brique 126) Les Z passés, les plus récents d'abord, 20 par page (« Plus de Z… » lit la suivante).
  async function dessinerLesZ(el, avant, deja) {
    let r;
    try { r = await bridge.listeZ(avant); } catch (e) { el.innerHTML = `<h2>Les Z</h2><p class="small warn-text">${h(plainError(e))}</p>`; return; }
    const tous = (deja || []).concat(r.z);
    el.innerHTML = `<h2>Les Z</h2>${tous.length ? `<div class="scroll-x"><table class="list compact" id="cs-z-liste"><thead><tr><th>Fermée le</th><th>Ouverte par</th><th>Fermée par</th><th class="r">Tickets</th><th class="r">Ventes TTC</th><th class="r">Écart</th></tr></thead><tbody>
      ${tous.map((z, i) => `<tr class="clickable" data-z="${i}"><td class="nw">${h(heureCaisse(z.fermeeLe))}</td><td>${h(z.ouvertePar)}</td><td>${h(z.fermePar)}</td>
        <td class="r">${z.nombre}</td><td class="r nw">${h(argentCaisse(z.total))}</td><td class="r nw${Number(z.ecart) && !ecartDArrondi(z.ecart) ? ' warn-text' : ''}">${h(argentCaisse(z.ecart))}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="small muted">Aucun Z pour l\'instant : le premier s\'écrit à la fermeture de la caisse.</p>'}
      ${r.suite ? '<button type="button" class="btn btn-sm mt" id="cs-z-plus">Plus de Z…</button>' : ''}`;
    $$('[data-z]', el).forEach(tr => { tr.onclick = () => montrerZ(tous[Number(tr.dataset.z)]); });
    if ($('#cs-z-plus', el)) $('#cs-z-plus', el).onclick = () => dessinerLesZ(el, r.suite, tous);
  }
  const MODES_Z = { especes: 'Espèces', carte: 'Carte', cheque: 'Chèque' };
  // (1.294.0) Un écart plus petit que la plus petite pièce en usage (10 millimes) ne dit pas qu'il « manque de l'argent » :
  // 4,629 DT ne se rendent pas en pièces, la monnaie s'arrondit au comptoir. Il reste écrit, en clair, sans alarme.
  // À VÉRIFIER : la pièce de 5 millimes, encore émise mais rare ; et comment le comptable veut voir ces arrondis.
  const ecartDArrondi = e => Math.abs(Number(e) || 0) > 0.0005 && Math.abs(Number(e)) < 0.0095;
  function montrerZ(z) {
    const ligne = (l, v, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${l}</td><td class="r num nw">${v}</td></tr>`;
    const ecart = Number(z.ecart);
    modal(`<h2>Z de caisse</h2>
      <p class="small muted" id="cs-z-qui">Ouverte par ${h(z.ouvertePar)} le ${h(heureCaisse(z.ouverteLe))} sur « ${h(z.appareil)} »${z.fermePar ? `, fermée par ${h(z.fermePar)} le ${h(heureCaisse(z.fermeeLe))}` : ''} ; ${z.nombre ? `${z.nombre} ticket${z.nombre > 1 ? 's' : ''}, du ${h(z.premier)} au ${h(z.dernier)}` : 'aucun ticket'}.</p>
      <table class="list compact" id="cs-z-table"><tbody>
        ${ligne('Ventes TTC', h(argentCaisse(z.total)))}${ligne('dont TVA', h(argentCaisse(z.tva)))}
        ${(z.avoirs || []).length ? ligne(`Retours : ${z.avoirs.map(a => `${h(a.numero)} (ticket ${h(a.ticket)})`).join(', ')}`, `− ${h(argentCaisse(z.retoursTtc))}`)
          + ligne('<b>Net des ventes</b>', `<b>${h(argentCaisse(z.net))}</b>`) : ''}
        ${Object.entries(z.parMode).map(([k, v]) => ligne(h(MODES_Z[k] || k), h(argentCaisse(v)))).join('')}
        ${Object.entries(z.rendu || {}).map(([k, v]) => ligne(`Rendu (${h((MODES_Z[k] || k).toLowerCase())})`, `− ${h(argentCaisse(v))}`)).join('')}
        ${Number(z.sorties) ? ligne('Payé du tiroir pour la paie (salaires, avances)', `− ${h(argentCaisse(z.sorties))}`) : ''}
        ${ligne('Fond de caisse', h(argentCaisse(z.fond)))}${ligne('<b>Le tiroir devait contenir</b>', `<b>${h(argentCaisse(z.attendu))}</b>`)}
        ${ligne('Espèces comptées', h(argentCaisse(z.compte)))}
        ${(z.comptage || []).map(x => ligne(`<span class="small muted">${x.nombre} × ${Number(x.valeur) >= 1 ? `${Number(x.valeur)} DT` : `${Math.round(Number(x.valeur) * 1000)} millimes`}</span>`, `<span class="small muted">${h(argentCaisse(x.total))}</span>`)).join('')}
        ${ligne('<b>Écart</b>', `<b>${h(argentCaisse(z.ecart))}</b>`, ecart && !ecartDArrondi(ecart) ? 'warn-text' : '')}
      </tbody></table>
      <p class="small ${ecart && !ecartDArrondi(ecart) ? 'warn-text' : 'muted'}" id="cs-z-ecart">${ecartDArrondi(ecart) ? `Écart de ${h(argentCaisse(Math.abs(ecart)))}, moins que la plus petite pièce (10 millimes) : l'arrondi de la monnaie rendue suffit à l'expliquer.` : ecart < 0 ? 'Il manque de l\'argent dans le tiroir.' : ecart > 0 ? 'Il y a plus d\'argent que prévu dans le tiroir.' : 'Le tiroir tombe juste.'} Le Z est figé : il garde ces chiffres.</p>
      <div class="modal-actions"><button class="btn" id="cs-z-imprimer">Imprimer le Z</button><button class="btn btn-primary" id="cs-z-ok">Terminé</button></div>`,
      (root, close) => {
        $('#cs-z-ok', root).onclick = () => { close(); vers('#/caisse')(); };
        $('#cs-z-imprimer', root).onclick = () => Promise.resolve(bridge.imprimerTicket(C.zHtml(z, company()), company().caisseLargeur)).catch(e => toast(plainError(e), true));
      });
  }
  routes.caisse = () => {
    const s = caisseState;
    const cur = company().currency;
    if (!s.jour) s.jour = C.today();
    const comptes = C.comptesDeCaisse(data);
    const articles = (data.catalog || []).slice().sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'fr'));
    const ttcDe = it => C.computeTotals({ type: 'facture', applyStamp: false, lines: [C.ligneDePanier(it, company())] }, company()).totalTTC;
    // (05/10/2026) La caisse tactile prend tout l'écran (`body.mode-caisse`, posé par le routeur) : une barre du haut — la
    // sortie, la caisse, son état, ses deux onglets, qui est au poste, le menu des gestes plus rares — puis l'écran du
    // moment. L'en-tête reste celui de la page : « Guide-moi » et les bandeaux s'y posent comme ailleurs.
    const ONGLETS_CAISSE = { vendre: 'Vendre', tickets: 'Tickets du jour' };
    // Revenir à la caisse depuis une autre page : la monnaie de la dernière vente a été rendue, la vente reprend.
    if (s.ecran === 'rendu' && !$('#cs-body')) s.ecran = 'vente';
    $('#view').innerHTML = `
      <header class="page-head ct-tete">
        <a class="ct-sortie" href="#/dashboard" aria-label="Quitter la caisse : revenir à SkanFact" title="Quitter la caisse"><span aria-hidden="true">‹</span><span class="ct-marque" aria-hidden="true">SF</span></a>
        <span class="ct-nom"><h1>Caisse</h1><small>${h(company().name || '')}</small></span>
        <span class="ct-etat" id="cs-etat"></span>
        <div class="ct-onglets" id="cs-tabs" role="tablist" aria-label="La caisse">${CAISSE_TABS.map(([id, label]) =>
          `<button type="button" role="tab" aria-selected="${id === s.tab}" data-tab="${id}" class="${id === s.tab ? 'active' : ''}">${id === 'tickets' ? 'Tickets<span class="ct-long"> du jour</span>' : h(ONGLETS_CAISSE[id] || label)}</button>`).join('')}</div>
        <span class="ct-espace"></span>
        <div class="actions ct-gestes" id="cs-actions"></div>
        <div class="ct-gestes" id="cs-gestes"></div>
        <div class="ct-menu"><button type="button" class="ct-bouton" id="cs-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-controls="cs-menu" aria-label="Plus de gestes : fermer la caisse, ton code, l'écran client, quitter">⋯</button>
          <div class="ct-menu-liste" id="cs-menu" role="menu" hidden></div></div>
      </header>
      ${bridge.caisse ? '<div id="cs-session"></div>' : ''}
      <div class="ct-corps${s.tab === 'tickets' ? ' ct-defile' : ''}" id="cs-body"></div>`;
    $('#cs-menu-bouton').onclick = e => {
      e.stopPropagation();
      const m = $('#cs-menu');
      m.hidden = !m.hidden;
      $('#cs-menu-bouton').setAttribute('aria-expanded', String(!m.hidden));
      if (!m.hidden && $('button', m)) $('button', m).focus();
    };
    $('#cs-menu').addEventListener('click', e => { if (e.target.closest('button')) fermerMenuCaisse(); });
    $('#cs-menu').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); fermerMenuCaisse(); $('#cs-menu-bouton').focus(); } });
    gestesCaisse();
    $$('#cs-tabs [data-tab]').forEach(b => { b.onclick = () => { s.tab = b.dataset.tab; vers('#/caisse')(); }; });
    if (bridge.caisse) dessinerSession();

    // ---- Vendre : la caisse tactile (05/10/2026 ; maquette validée par Skander ; docs/caisse.md, « La caisse tactile ») ----
    // L'écran du comptoir, au doigt : les articles à gauche (la douchette toujours prête, les familles, les tuiles), le
    // ticket à droite, « Encaisser » toujours visible ; puis le paiement (le mode, ce que le client donne, la monnaie
    // calculée pendant la frappe) ; puis la monnaie à rendre, en grand ; le soir, le comptage du tiroir. Le panier survit
    // à un changement de page, et il ne vit qu'en mémoire : un ticket n'existe qu'une fois encaissé. Caisse fermée (ou
    // tenue ailleurs) : on l'ouvre d'abord.
    const ICONES = {
      scan: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14"/></svg>',
      client: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
      horloge: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      ok: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
      imprimante: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
    };
    const PAVE = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'];
    const touche = k => `<button type="button" data-touche="${k}" aria-label="${k === '⌫' ? 'Effacer le dernier chiffre' : k === ',' ? 'Virgule' : k === 'suivant' ? 'Coupure suivante' : k}">${k === 'suivant' ? 'Suivant' : k}</button>`;
    // La couleur d'une tuile suit sa famille (ou son nom) : la même à chaque fois, sans réglage.
    const teinte = t => { let x = 0; for (const c of String(t || '')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
    const initiales = l => String(l || '').replace(/\(.*?\)/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '•';
    const nbArticles = () => C.round3(s.panier.reduce((x, l) => x + (Number(l.qty) || 0), 0));
    // Un pavé de chiffres dans une fenêtre (une quantité, une remise) : `ok` reçoit le texte tapé (virgule décimale).
    // `o.entier` : un nombre de pièces, sans virgule (sa place reste vide, le pavé garde sa forme).
    const pave = (titre, valeur, o, ok) => {
      modal(`<h2>${h(titre)}</h2>${o.aide ? `<p class="small">${h(o.aide)}</p>` : ''}
        <div class="ct-fenetre-pave"><input type="text" inputmode="none" class="num ct-affiche" id="pv-valeur" value="${h(String(valeur || '').replace('.', ','))}" autocomplete="off" aria-label="${h(titre)}">
        <div class="ct-pave">${PAVE.map(k => (o.entier && k === ',' ? '<span aria-hidden="true"></span>' : touche(k))).join('')}</div></div>
        <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="pv-ok">${h(o.bouton || 'Valider')}</button></div>`,
      (root, close) => {
        const champ = $('#pv-valeur', root);
        // Le premier chiffre touché remplace la valeur proposée ; les suivants s'y ajoutent.
        let neuf = true;
        $$('[data-touche]', root).forEach(b => { b.onclick = () => {
          const k = b.dataset.touche;
          let v = neuf ? '' : champ.value;
          if (k === '⌫') v = champ.value.slice(0, -1);
          else if (k === ',') { if (!v.includes(',')) v = (v || '0') + ','; }
          else v += k;
          neuf = false; champ.value = v;
        }; });
        champ.oninput = () => { neuf = false; };
        $('[data-close]', root).onclick = close;
        $('#pv-ok', root).onclick = () => { close(); ok(champ.value.trim()); };
        champ.select();
      }, null, { garde: false });
    };
    // Ce que l'écran de vente montre selon la session lue au serveur : fermée, tenue ailleurs, ou la vente.
    const vueDeSession = () => (caisseEtat && !caisseEtat.session ? 'fermee' : caisseEtat && !caisseEtat.session.ici ? 'ailleurs' : 'vente');
    const drawVendre = () => {
      if (!s.ecran) s.ecran = 'vente';
      // Un nouvel écran (paiement, monnaie, comptage) se montre par le haut : sur téléphone, la page défile.
      if (s.ecran !== s.ecranVu) { s.ecranVu = s.ecran; window.scrollTo(0, 0); }
      $('#cs-actions').innerHTML = '';
      $('#cs-body').className = 'ct-corps';
      s.vueDessinee = vueDeSession();
      // Sans article, rien ne se vend : le premier se crée ici, la caisse ouverte ou non.
      if (!articles.length) {
        $('#cs-body').className = 'ct-corps ct-defile';
        $('#cs-body').innerHTML = etatVide('Ce que tu vends au comptoir', [
          'La caisse vend les articles de ton <b>Catalogue</b> : chacun avec son prix et, pour la douchette, son <b>code-barres</b>.',
          'Crée ton premier article — il arrive tout de suite dans la caisse.'], [['cs-new-art', '+ Nouvel article', true]]);
        $('#cs-new-art').onclick = () => catalogForm(null, () => vers('#/caisse')(), { titre: 'Nouvel article' });
        ecranClient('repos');
        return;
      }
      const ss = caisseEtat ? caisseEtat.session : undefined;
      // Fermée, ou tenue sur un autre appareil : rien ne se vend ici ; l'écran le dit, et l'ouvre.
      // (plateforme, 1.87.14) Tenue sur un autre appareil, le propriétaire ou un administrateur la ferme d'ici, par le même
      // comptage du tiroir (le serveur ne l'accepte que d'eux).
      if (caisseEtat && (!ss || (!ss.ici && !(s.ecran === 'fermeture' && fermerDIci())))) { s.ecran = 'vente'; return drawFermee(); }
      if (s.ecran === 'fermeture') return drawFermeture();
      if (s.ecran === 'paiement' && s.panier.length) return drawPaiement();
      if (s.ecran === 'rendu') return drawRendu();
      s.ecran = 'vente';
      $('#cs-body').innerHTML = `<div class="ct-vente">
        <section class="ct-articles" aria-label="Les articles">
          <div class="ct-cherche">
            <label class="ct-scan">${ICONES.scan}<input type="text" id="cs-scan" autocomplete="off" spellcheck="false" placeholder="Scanne un code-barres, ou cherche un article" value="${h(s.q)}" aria-label="Scanne un code-barres, ou cherche un article"><span class="ct-pret">Douchette prête</span></label>
            <button type="button" class="ct-bouton" id="cs-libre">+ <span>Article libre</span></button>
          </div>
          <div class="ct-familles" id="cs-familles" role="tablist" aria-label="Familles d'articles"></div>
          <div class="cs-articles ct-tuiles" id="cs-articles" role="list"></div>
        </section>
        <section class="ct-ticket" id="cs-ticket" aria-label="Le ticket en cours"></section>
      </div>`;
      // Les familles : celles que le Catalogue donne à ses articles ; « Favoris », les plus vendus en caisse ces 60 derniers
      // jours (15 au plus) ; « Tout ». Sans famille ni vente, pas d'onglets : la caisse montre tout.
      const depuis = C.addDays(C.today(), -60);
      const vendus = {};
      data.documents.forEach(d => { if (C.estTicket(d) && d.date >= depuis) (d.lines || []).forEach(l => { if (l.itemId) vendus[l.itemId] = (vendus[l.itemId] || 0) + (Number(l.qty) || 0); }); });
      const favoris = articles.filter(a => vendus[a.id] > 0).sort((a, b) => vendus[b.id] - vendus[a.id]).slice(0, 15);
      const familles = [...new Set(articles.map(a => String(a.famille || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      const onglets = [...(favoris.length ? [['fav', 'Favoris']] : []), ['tout', 'Tout'], ...familles.map(f => [`f:${f}`, f])];
      if (!onglets.some(o => o[0] === s.famille)) s.famille = onglets[0][0];
      const drawFamilles = () => {
        $('#cs-familles').innerHTML = onglets.length && articles.length ? onglets.map(([k, l]) => `<button type="button" role="tab" data-famille="${h(k)}" aria-selected="${s.famille === k && !s.q.trim()}">${h(l)}</button>`).join('') : '';
        $$('#cs-familles [data-famille]').forEach(b => { b.onclick = () => { s.famille = b.dataset.famille; s.q = ''; $('#cs-scan').value = ''; drawFamilles(); drawArticles(); }; });
      };
      const drawArticles = () => {
        const q = s.q.trim();
        const liste = q ? articles.filter(a => C.correspondRecherche(`${a.label} ${a.code || ''} ${a.description || ''} ${a.famille || ''}`, q))
          : s.famille === 'fav' ? favoris : s.famille.startsWith('f:') ? articles.filter(a => String(a.famille || '').trim() === s.famille.slice(2)) : articles;
        const vus = liste.slice(0, 60);
        const dansPanier = {};
        s.panier.forEach(l => { if (l.itemId) dansPanier[l.itemId] = C.round3((dansPanier[l.itemId] || 0) + (Number(l.qty) || 0)); });
        $('#cs-articles').innerHTML = vus.length
          ? vus.map(a => {
            const st = a.tracked ? C.stockOf(data, a.id) : null;
            const n = dansPanier[a.id] || 0;
            const prix = Number(a.unitPrice) > 0 ? C.money(ttcDe(a), cur) : '';
            // Le stock d'une tuile : « Rupture », « Reste 2 » sous le seuil d'alerte de l'article (3 sans seuil), sinon le stock.
            const bas = st && st.qty > 0 && st.qty <= (Number(a.minStock) || 3);
            const stock = !st ? '' : st.qty <= 0 ? '<span class="cs-art-stock rupture">Rupture</span>' : `<span class="cs-art-stock${bas ? ' bas' : ''}">${bas ? 'Reste' : 'Stock'} ${pct(st.qty)}</span>`;
            return `<button type="button" class="cs-art${n ? ' dans' : ''}" data-art="${h(a.id)}" role="listitem" aria-label="${h(a.label)}, ${prix ? h(prix) : 'prix à fixer'}${n ? `, ${pct(n)} dans le ticket` : ''}">
              <span class="cs-art-tete"><span class="ct-pastille" style="--teinte:${teinte(a.famille || a.label)}" aria-hidden="true">${h(initiales(a.label))}</span><span class="cs-art-nom">${h(a.label)}</span></span>
              <span class="cs-art-pied">${prix ? `<span class="cs-art-prix">${prix}</span>` : '<span class="cs-art-prix warn-text">prix à fixer</span>'}${stock}</span>
              ${n ? `<span class="ct-badge" aria-hidden="true">${pct(n)}</span>` : ''}
            </button>`;
          }).join('') + (liste.length > vus.length ? `<p class="small muted cs-plus">${liste.length - vus.length} autres articles : précise la recherche.</p>` : '')
          : `<p class="small muted">Aucun article ne correspond à « ${h(q)} ». <button type="button" class="btn btn-sm" id="cs-creer-art">+ Créer cet article</button></p>`;
        // À la souris, le curseur revient au champ du haut après chaque tuile (la douchette reste prête) ; au doigt, non :
        // le clavier de l'écran s'ouvrirait. Une frappe de la douchette y arrive quand même (voir `caisseClavier`).
        $$('#cs-articles [data-art]').forEach(b => { b.onclick = () => { ajouter(articles.find(a => a.id === b.dataset.art)); if (window.matchMedia('(pointer: fine)').matches) scan(); }; });
        if ($('#cs-creer-art')) $('#cs-creer-art').onclick = () => {
          const code = C.normCode(q) && /\d{4,}/.test(q) ? q : '';
          catalogForm(articleNeuf(code ? { code } : { label: q }), it => { if (it) { s.q = ''; ajouter(it); vers('#/caisse')(); } });
        };
      };
      const ajouter = it => {
        if (!it) return;
        // Un article sans prix ne part pas gratuitement : sa fiche s'ouvre pour qu'on le fixe, et il
        // entre dans le ticket une fois le prix enregistré (la même règle que `motifEncaissement`).
        if (!(Number(it.unitPrice) > 0)) {
          toast(`« ${it.label} » n'a pas encore de prix : fixe-le, il entrera dans le ticket.`);
          catalogForm(it, maj => { if (maj && Number(maj.unitPrice) > 0) ajouter(maj); vers('#/caisse')(); }, { focus: 'unitPrice' });
          return;
        }
        const deja = s.panier.find(l => l.itemId === it.id);
        if (deja) deja.qty = C.round3((Number(deja.qty) || 0) + 1);
        else s.panier.push(C.ligneDePanier(it, company()));
        s.vise = deja ? s.panier.indexOf(deja) : s.panier.length - 1;
        drawTicket();
        drawArticles();
      };
      const changerQte = (i, q) => {
        if (!s.panier[i]) return;
        if (!(q > 0)) s.panier.splice(i, 1); else { s.panier[i].qty = C.round3(q); s.vise = i; }
        drawTicket(); drawArticles();
      };
      // Ce qui empêche d'aller au paiement : la session, puis le panier. Sans compte de caisse, la carte et le chèque
      // restent possibles : le paiement le dit pour les espèces.
      const motifDuPanier = () => {
        const m = motifSession() || C.motifEncaissement(data, company(), s.panier, { mode: 'especes', recu: '', remise: s.remise });
        return m && !C.comptesDeCaisse(data).especes && !motifSession() && !C.motifEncaissement(data, company(), s.panier, { mode: 'carte', recu: '', remise: s.remise }) ? '' : m;
      };
      const drawTicket = () => {
        const t = C.totauxDuPanier(s.panier, company(), { recu: '', remise: s.remise });
        const motif = motifDuPanier();
        // Le panier est bon, la caisse ouverte : seul le compte manque (la carte, elle, bute sur la banque absente).
        const sansCompte = !motifSession() && !C.comptesDeCaisse(data).especes
          && C.motifEncaissement(data, company(), s.panier, { mode: 'carte', recu: '', remise: s.remise }) === C.MOTIF_SANS_BANQUE;
        const attente = s.attente || [];
        const client = s.clientId ? clientName(s.clientId) : '';
        // Au téléphone (caisse.css), le ticket se tient replié en bas de l'écran, sous les tuiles ; « Tout voir » le déplie.
        $('#cs-ticket').classList.toggle('ouvert', !!s.ticketOuvert);
        $('#cs-ticket').innerHTML = `<button type="button" class="ct-tirer" id="cs-ticket-tirer" aria-expanded="${!!s.ticketOuvert}"><b>Ticket · ${h(pl(nbArticles(), 'article'))}</b><span>${s.ticketOuvert ? 'Replier' : 'Tout voir'}</span></button>
          <div class="ct-ticket-tete">
            <button type="button" class="ct-client" id="cs-client-bouton">${ICONES.client}<span><small>Client</small><b>${h(client || 'Vente au comptoir')}</b></span><span aria-hidden="true" class="ct-chevron">›</span></button>
            <button type="button" class="ct-bouton carre" id="cs-attente" aria-label="Mettre la vente en attente" ${s.panier.length ? '' : 'disabled'}>${ICONES.pause}</button>
            ${/* L'horloge garde sa place, vide ou non : en apparaissant, elle aurait poussé « pause » sous le doigt. */''}
            <button type="button" class="ct-bouton carre ct-horloge" id="cs-reprendre" ${attente.length ? `aria-label="${h(pl(attente.length, 'vente'))} en attente : en reprendre une"` : 'style="visibility:hidden" aria-hidden="true" tabindex="-1"'}>${ICONES.horloge}<span class="ct-nb" aria-hidden="true">${attente.length || 0}</span></button>
          </div>
          <div class="cs-zone ct-lignes" id="cs-zone">${s.panier.length ? s.panier.map((l, i) => {
            const tl = t.lines[i] || { ttc: 0 };
            const unite = Number(l.qty) ? C.round3(tl.ttc / Number(l.qty)) : 0;
            return `<div class="ct-ligne" data-ligne="${i}">
              <div class="ct-ligne-nom"><b><span class="ct-q">${pct(l.qty)} × </span>${h(l.label)}</b><small>${C.money(unite, cur)} l'unité</small></div>
              <div class="ct-pas"><button type="button" data-moins="${i}" aria-label="Un ${h(l.label)} de moins">−</button><button type="button" class="ct-qte" data-qte="${i}" aria-label="Quantité de ${h(l.label)} : ${pct(l.qty)}, à toucher pour la taper">${pct(l.qty)}</button><button type="button" data-plus="${i}" aria-label="Un ${h(l.label)} de plus">+</button></div>
              <b class="ct-ligne-total">${C.money(tl.ttc, cur)}</b></div>`;
          }).join('') : `<div class="ct-vide">${ICONES.scan}<b>Le ticket est vide</b><span>Scanne un article, ou touche-le à gauche : il s'ajoute ici.</span></div>`}</div>
          <div class="ct-ticket-pied">
            <div class="ct-gestes-ticket">
              <button type="button" class="ct-bouton" id="cs-remise-bouton" ${s.panier.length ? '' : 'disabled'}>${s.remise ? `Remise ${h(String(s.remise).replace('.', ','))} %` : '% Remise'}</button>
              <button type="button" class="ct-bouton danger" id="cs-vider" ${s.panier.length ? '' : 'disabled'}>Annuler le ticket</button>
            </div>
            <div class="ct-sous" id="cs-ligne-remise"${t.discount ? '' : ' style="visibility:hidden" aria-hidden="true"'}><span>Remise ${h(String(s.remise || '0').replace('.', ','))} %</span><span>− ${C.money(t.remiseTtc, cur)}</span></div>
            <div class="ct-sous"><span>${h(pl(nbArticles(), 'article'))}</span><span>dont TVA ${C.money(t.totalVAT, cur)}${t.stamp ? ` · timbre ${C.money(t.stamp, cur)}` : ''}</span></div>
            <div class="ct-total"><span>Total ${info('cs.ticket')}</span><b id="cs-total">${C.money(t.netToPay, cur)}</b></div>
            <p class="cs-motif" id="cs-motif">${s.panier.length && motif ? h(motif) : ''}${s.panier.length && motif && sansCompte ? ' <button type="button" class="btn btn-sm" id="cs-creer-caisse">Créer la caisse</button>' : ''}</p>
            <button type="button" class="ct-principal cs-encaisser" id="cs-encaisser" ${motif ? 'disabled' : ''}>Encaisser ${s.panier.length ? C.money(t.netToPay, cur) : ''}</button>
          </div>`;
        $('#cs-ticket-tirer').onclick = () => { s.ticketOuvert = !s.ticketOuvert; drawTicket(); };
        $('#cs-client-bouton').onclick = choisirClient;
        $('#cs-attente').onclick = mettreEnAttente;
        if (attente.length) $('#cs-reprendre').onclick = reprendreAttente;
        $$('[data-moins]', $('#cs-ticket')).forEach(b => { b.onclick = () => { const i = Number(b.dataset.moins); changerQte(i, C.round3((Number(s.panier[i].qty) || 0) - 1)); }; });
        $$('[data-plus]', $('#cs-ticket')).forEach(b => { b.onclick = () => { const i = Number(b.dataset.plus); changerQte(i, C.round3((Number(s.panier[i].qty) || 0) + 1)); }; });
        $$('[data-qte]', $('#cs-ticket')).forEach(b => { b.onclick = () => {
          const i = Number(b.dataset.qte), l = s.panier[i];
          pave(`Quantité : ${l.label}`, l.qty, { aide: '0 retire la ligne du ticket.' }, v => {
            const q = Number(String(v || '0').replace(/\s/g, '').replace(',', '.'));
            if (!isFinite(q) || q < 0) { toast('Une quantité s\'écrit comme 3 ou 2,5.', true); return; }
            changerQte(i, q);
          });
        }; });
        $('#cs-remise-bouton').onclick = () => pave('Remise sur le ticket (%)', s.remise, { aide: 'Un pourcentage du ticket entier : 10, ou 7,5. Vide ou 0 : aucune remise.' }, v => {
          s.remise = v === '0' ? '' : v; drawTicket();
        });
        // Annuler le ticket se répare : « Annuler » sur le bandeau remet le panier tel qu'il était.
        $('#cs-vider').onclick = () => {
          const avant = { panier: s.panier.slice(), remise: s.remise, clientId: s.clientId };
          s.panier = []; s.remise = ''; s.clientId = '';
          drawTicket(); drawArticles(); scan();
          toastUndo('Ticket annulé.', () => { Object.assign(s, avant); drawTicket(); drawArticles(); });
        };
        $('#cs-encaisser').onclick = versPaiement;
        if ($('#cs-creer-caisse')) $('#cs-creer-caisse').onclick = () => creerCaisse(() => drawTicket());
        // La ligne qu'on vient de scanner reste sous les yeux, même au-delà de ce que la zone montre.
        const z = $('#cs-zone'), tr = s.vise != null && z ? $$('.ct-ligne', z)[s.vise] : null;
        if (tr) { const bas = tr.offsetTop + tr.offsetHeight; if (bas > z.scrollTop + z.clientHeight) z.scrollTop = bas - z.clientHeight; }
        s.vise = null;
        ecranClient(s.panier.length ? 'vente' : 'repos');
      };
      // Le client : une liste à toucher, avec sa recherche ; « Vente au comptoir » en tête.
      const choisirClient = () => {
        modal(`<h2>Le client</h2><p class="small">Facultatif : le ticket porte son nom. Sans client, c'est une vente au comptoir. ${info('cs.client')}</p>
          <input type="search" id="cs-cl-q" placeholder="Rechercher un client…" autocomplete="off" aria-label="Rechercher un client">
          <div class="ct-clients" id="cs-cl-liste" role="listbox" aria-label="Les clients"></div>
          <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`,
        (root, close) => {
          const tous = [{ v: '', label: 'Vente au comptoir', text: '' }].concat(clientItems());
          const dessiner = () => {
            const q = $('#cs-cl-q', root).value.trim();
            const vus = tous.filter(c => !q || (c.v && C.correspondRecherche(c.text || c.label, q))).slice(0, 40);
            $('#cs-cl-liste', root).innerHTML = vus.length ? vus.map(c => `<button type="button" role="option" aria-selected="${c.v === (s.clientId || '')}" data-client="${h(c.v)}"><b>${h(c.label)}</b>${c.sub ? `<small>${h(c.sub)}</small>` : ''}</button>`).join('')
              : `<p class="small muted">Aucun client ne correspond à « ${h(q)} ».</p>`;
            $$('[data-client]', root).forEach(b => { b.onclick = () => { s.clientId = b.dataset.client; close(); drawTicket(); }; });
          };
          $('#cs-cl-q', root).oninput = dessiner;
          dessiner();
          $('[data-close]', root).onclick = close;
        }, null, { garde: false });
      };
      // Une vente mise en attente (le client est allé chercher un article) : elle reste en mémoire sur ce poste, comme le
      // panier, jamais au serveur — un panier n'est pas une pièce.
      const mettreEnAttente = () => {
        if (!s.panier.length) return;
        s.attente = (s.attente || []).concat([{ panier: s.panier, remise: s.remise, clientId: s.clientId, le: Date.now() }]);
        s.panier = []; s.remise = ''; s.clientId = '';
        drawTicket(); drawArticles(); scan();
        toast('Vente mise en attente : le bouton de l\'horloge la reprend.');
      };
      const reprendreAttente = () => {
        const liste = s.attente || [];
        modal(`<h2>Les ventes en attente</h2>
          <div class="ct-attentes">${liste.map((a, i) => {
            const t = C.totauxDuPanier(a.panier || [], company(), { recu: '', remise: a.remise });
            const n = C.round3((a.panier || []).reduce((x, l) => x + (Number(l.qty) || 0), 0));
            const noms = (a.panier || []).map(l => l.label);
            return `<div class="ct-attente"><span><b>${h(noms.slice(0, 2).join(', '))}${noms.length > 2 ? ` et ${noms.length - 2} autre${noms.length > 3 ? 's' : ''}` : ''}</b><br><small>${h(new Date(a.le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))} · ${h(pl(n, 'article'))} · ${C.money(t.netToPay, cur)}${a.clientId ? ` · ${h(clientName(a.clientId))}` : ''}</small></span>
              <button type="button" class="btn" data-oublier="${i}">Abandonner</button><button type="button" class="btn btn-primary" data-reprendre="${i}">Reprendre</button></div>`;
          }).join('')}</div>
          ${s.panier.length ? '<p class="small muted">Le ticket en cours passe en attente à sa place.</p>' : ''}
          <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`,
        (root, close) => {
          $('[data-close]', root).onclick = close;
          $$('[data-reprendre]', root).forEach(b => { b.onclick = () => {
            const l = (s.attente || []).slice(); const [a] = l.splice(Number(b.dataset.reprendre), 1);
            if (s.panier.length) l.push({ panier: s.panier, remise: s.remise, clientId: s.clientId, le: Date.now() });
            s.attente = l;
            s.panier = a.panier || []; s.remise = a.remise || ''; s.clientId = a.clientId || '';
            close(); drawTicket(); drawArticles();
          }; });
          $$('[data-oublier]', root).forEach(b => { b.onclick = () => {
            const avant = (s.attente || []).slice();
            const l = avant.slice(); l.splice(Number(b.dataset.oublier), 1); s.attente = l;
            close(); drawTicket();
            toastUndo('Vente en attente abandonnée.', () => { s.attente = avant; drawTicket(); });
          }; });
        }, null, { garde: false });
      };
      // Un article hors du Catalogue (une réparation, un article sans fiche) : son nom, son prix TTC, sa TVA. Il part sur
      // le ticket comme une ligne libre ; il ne crée rien au Catalogue et ne sort rien du stock.
      const articleLibre = () => {
        const assujetti = C.assujettiTVA(company());
        modal(`<h2>Article libre</h2>
          <form id="al" class="grid-2">
            <label class="field span-2">${lbl('Désignation', 'cs.libre')}<input type="text" name="label" placeholder="Article divers" autocomplete="off"></label>
            <label class="field obligatoire"><span>Prix TTC (${h(C.normCurrency(cur))})</span><input type="text" inputmode="decimal" class="num" name="ttc" autocomplete="off"></label>
            <label class="field"${assujetti ? '' : ' hidden'}>TVA<select name="tva">${C.VAT_RATES.map(r => `<option value="${r}" ${r === 19 ? 'selected' : ''}>${r}%</option>`).join('')}</select></label>
          </form>
          <p class="small warn-text" role="alert" id="al-refus"></p>
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="al-ok">Ajouter au ticket</button></div>`,
        (root, close) => {
          $('#al-ok', root).onclick = () => {
            const v = formValues($('#al', root));
            const taux = C.ligneDePanier({ vatRate: Number(v.tva) || 0 }, company()).vatRate;
            // Le HT qui retombe exactement sur le prix TTC tapé, comme la fiche d'un article.
            const r = C.calculPrix({ mode: 'ttc', valeur: v.ttc, tva: taux, decimales: C.decimalsFor(cur) });
            if (!r.ok) { $('#al-refus', root).textContent = 'Tape le prix TTC, comme 12 ou 12,500.'; $('[name=ttc]', root).focus(); return; }
            // Un prix TTC qu'aucun HT n'atteint à ce taux (4,500 à 19 %) : le plus proche, et la caisse le dit, comme la fiche.
            if (!r.exact) toast(`Aucun prix HT ne donne exactement ${C.money(Number(String(v.ttc).replace(/\s/g, '').replace(',', '.')), cur)} TTC à ${pct(r.tva)} % : le plus proche donne ${C.money(r.ttc, cur)}.`);
            s.panier.push({ itemId: '', label: String(v.label || '').trim() || 'Article divers', unit: '', qty: 1, unitPrice: r.ht, vatRate: taux });
            s.vise = s.panier.length - 1;
            close(); drawTicket(); drawArticles();
          };
        });
      };
      const versPaiement = () => {
        const motif = motifDuPanier();
        if (motif) { toast(motif, true); return; }
        // Chaque vente commence en espèces : la précédente payée par carte ne décide pas de celle-ci (vu sur le serveur
        // d'essai le 05/10/2026 : la vente suivante restait sur « Carte », et le tiroir ne serait pas tombé juste).
        s.mode = 'especes'; s.recu = ''; s.ecran = 'paiement';
        drawVendre();
      };
      $('#cs-libre').onclick = articleLibre;
      const scanIn = $('#cs-scan');
      scanIn.oninput = () => { s.q = scanIn.value; drawFamilles(); drawArticles(); };
      scanIn.onkeydown = e => {
        if (e.key === 'Escape' && scanIn.value) { e.preventDefault(); e.stopPropagation(); scanIn.value = ''; s.q = ''; drawFamilles(); drawArticles(); return; }
        if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const q = scanIn.value.trim();
        if (!q) return;
        // Un code connu désigne UN article ; sinon un seul résultat de recherche fait l'affaire. Plusieurs
        // résultats : la liste reste filtrée, on choisit d'un clic.
        const parCode = C.articleParCode(data, q);
        const liste = parCode ? [parCode] : articles.filter(a => C.correspondRecherche(`${a.label} ${a.code || ''}`, q));
        if (liste.length === 1) { scanIn.value = ''; s.q = ''; ajouter(liste[0]); drawFamilles(); drawArticles(); }
        else if (!liste.length) toast(`Aucun article ne porte le code « ${q} ».`, true);
      };
      drawFamilles(); drawArticles(); drawTicket();
      if (window.matchMedia('(pointer: fine)').matches) scan();
    };
    // ---- Encaisser : le mode, ce que le client donne, la monnaie ----
    const drawPaiement = () => {
      const t = C.totauxDuPanier(s.panier, company(), { recu: '', remise: s.remise });
      const dec = C.decimalsFor(cur);
      const remiseDuRecap = t.discount ? C.money(t.remiseTtc, cur) : '';
      $('#cs-body').innerHTML = `<div class="ct-paiement" id="cs-paiement">
        <section class="ct-recap" aria-label="Le ticket à encaisser">
          <div class="ct-recap-tete"><b>Le ticket</b><small>${h(pl(nbArticles(), 'article'))}</small></div>
          <div class="ct-recap-lignes">${s.panier.map((l, i) => `<div class="ct-recap-ligne"><span><b>${pct(l.qty)} ×</b> ${h(l.label)}</span><b>${C.money((t.lines[i] || {}).ttc || 0, cur)}</b></div>`).join('')}</div>
          <div class="ct-recap-pied">
            ${remiseDuRecap ? `<small><span>Remise ${h(String(s.remise).replace('.', ','))} %</span><span>− ${remiseDuRecap}</span></small>` : ''}
            <small><span>Total HT ${C.money(t.netHT, cur)}</span><span>TVA ${C.money(t.totalVAT, cur)}</span></small>
            <button type="button" class="ct-bouton" id="cs-revenir">‹ Revenir au ticket</button>
          </div>
        </section>
        <section class="ct-payer" aria-label="Encaisser">
          <div class="ct-payer-defile">
          <div class="ct-apayer"><span>À payer</span><b id="cs-a-payer">${C.money(t.netToPay, cur)}</b></div>
          <div class="ct-modes cs-modes" role="radiogroup" aria-label="Mode de paiement">${C.MODES_CAISSE.map(([k, l]) =>
            `<button type="button" role="radio" aria-checked="${s.mode === k}" class="cs-mode ct-mode${s.mode === k ? ' on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
          ${s.mode === 'especes' ? `<div class="ct-especes">
            <div class="ct-especes-gauche">
              <div class="ct-montants">
                <label class="ct-recu"><span>Reçu du client</span><input type="text" inputmode="none" class="num" id="cs-recu" value="${h(s.recu)}" placeholder="facultatif" autocomplete="off" aria-label="Reçu du client (${h(C.normCurrency(cur))})"></label>
                <div class="ct-rendre rien" id="cs-rendre-boite" aria-live="polite"><span id="cs-rendre-libelle">À rendre</span><b id="cs-rendu">—</b></div>
              </div>
              <div class="ct-billets" id="cs-billets"></div>
              <p class="ct-aide">Touche le billet que le client donne, ou tape le montant.${bridge.ticketEncaisse ? ' Le tiroir s\'ouvre à la validation.' : ''} ${info('cs.recu')}</p>
            </div>
            <div class="ct-pave" id="cs-pave">${PAVE.map(touche).join('')}</div>
          </div>` : `<div class="ct-autre"><div><b>${s.mode === 'carte' ? 'Paiement par carte' : 'Paiement par chèque'}</b>
            <p>${s.mode === 'carte' ? 'Passe la carte sur le terminal de paiement, puis valide ici quand il a accepté. Rien à rendre : l\'argent arrive sur ta banque.' : 'Le chèque se remet ensuite en banque : il ne va pas dans le tiroir. Rien à rendre.'}</p></div></div>`}
          <p class="cs-motif" id="cs-motif"></p>
          </div>
          <button type="button" class="ct-principal" id="cs-valider">Valider</button>
        </section>
      </div>`;
      // Les billets proposés : le montant exact, puis les sommes rondes au-dessus du total (par 5, 10, 20, 50, 100, 200).
      if ($('#cs-billets')) {
        const net = t.netToPay;
        const ronds = [...new Set([5, 10, 20, 50, 100, 200].map(p => Math.ceil((net + 1e-9) / p) * p))].filter(v => v > net).slice(0, 4);
        $('#cs-billets').innerHTML = [`<button type="button" data-billet="${net.toFixed(dec)}">Montant exact</button>`]
          .concat(ronds.map(v => `<button type="button" data-billet="${v}">${v} ${h(C.normCurrency(cur))}</button>`)).join('');
        // Après un billet touché, le pavé tape un nouveau montant (il ne s'ajoute pas au billet).
        $$('#cs-billets [data-billet]').forEach(b => { b.onclick = () => { s.recu = String(b.dataset.billet).replace('.', ','); s.recuNeuf = true; $('#cs-recu').value = s.recu; majPaiement(); }; });
        $$('#cs-pave [data-touche]').forEach(b => { b.onclick = () => {
          const k = b.dataset.touche;
          let v = s.recuNeuf ? '' : s.recu || '';
          s.recuNeuf = false;
          if (k === '⌫') v = v.slice(0, -1);
          else if (k === ',') { if (!v.includes(',')) v = (v || '0') + ','; }
          else if (!v.includes(',') || v.length - v.indexOf(',') <= dec) v += k;
          s.recu = v; $('#cs-recu').value = v; majPaiement();
        }; });
        // Le montant reçu se tape aussi au clavier : seules la monnaie et le bouton suivent la frappe (7.17.0).
        $('#cs-recu').oninput = () => { s.recu = $('#cs-recu').value; s.recuNeuf = false; majPaiement(); };
        $('#cs-recu').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); encaisser(); } };
      }
      $$('#cs-paiement [data-mode]').forEach(b => { b.onclick = () => { s.mode = b.dataset.mode; if (s.mode !== 'especes') s.recu = ''; drawPaiement(); }; });
      $('#cs-revenir').onclick = () => { s.ecran = 'vente'; drawVendre(); scan(); };
      $('#cs-valider').onclick = encaisser;
      majPaiement();
      if ($('#cs-recu') && window.matchMedia('(pointer: fine)').matches) $('#cs-recu').focus();
    };
    const majPaiement = () => {
      const recu = s.mode === 'especes' ? s.recu : '';
      const t = C.totauxDuPanier(s.panier, company(), { recu, remise: s.remise });
      const motif = motifSession() || C.motifEncaissement(data, company(), s.panier, { mode: s.mode, recu, remise: s.remise });
      if ($('#cs-rendu')) {
        const lu = t.recu != null && isFinite(t.recu);
        const manque = lu && t.rendu < 0;
        $('#cs-rendre-boite').className = `ct-rendre${!lu ? ' rien' : manque ? ' manque' : ''}`;
        $('#cs-rendre-libelle').textContent = manque ? 'Il manque' : 'À rendre';
        $('#cs-rendu').textContent = lu ? C.money(Math.abs(t.rendu), cur) : '—';
      }
      // Le refus d'un compte qui manque porte le geste qui le règle (7.0.0) : le compte se crée par-dessus la caisse, et
      // le paiement attend.
      const sansCaisse = motif && s.mode === 'especes' && !C.comptesDeCaisse(data).especes;
      $('#cs-motif').innerHTML = motif ? `${h(motif)}${motif === C.MOTIF_SANS_BANQUE ? ' <button type="button" class="btn btn-sm" id="cs-creer-banque">Créer mon compte bancaire</button>'
        : sansCaisse ? ' <button type="button" class="btn btn-sm" id="cs-creer-caisse">Créer la caisse</button>' : ''}` : '';
      if ($('#cs-creer-banque')) $('#cs-creer-banque').onclick = () => accountForm(null, () => drawPaiement(), modeleCompte());
      if ($('#cs-creer-caisse')) $('#cs-creer-caisse').onclick = () => creerCaisse(() => drawPaiement());
      const b = $('#cs-valider');
      b.disabled = !!motif;
      b.textContent = motif ? (t.manque > 0 ? `Il manque ${C.money(t.manque, cur)}` : 'Valider')
        : t.rendu > 0 ? `Valider · rendre ${C.money(t.rendu, cur)}` : `Valider ${C.money(t.netToPay, cur)}`;
      ecranClient('paiement', { recu: s.mode === 'especes' && t.recu != null && isFinite(t.recu) ? C.money(t.recu, cur) : '', rendu: t.rendu > 0 ? C.money(t.rendu, cur) : '' });
    };
    // ---- La monnaie à rendre, en grand ----
    const drawRendu = () => {
      const d = s.dernierId ? data.documents.find(x => x.id === s.dernierId) : null;
      if (!d) { s.ecran = 'vente'; drawVendre(); return; }
      const ca = d.caisse || {};
      const tt = C.computeTotals(d, company());
      const especes = ca.mode === 'especes';
      const rendu = especes && Number(ca.rendu) > 0 ? Number(ca.rendu) : 0;
      const modeNom = (C.MODES_CAISSE.find(m => m[0] === ca.mode) || [0, ''])[1];
      // En espèces avec le montant reçu : la monnaie à rendre (0 si le compte est juste). Sinon (le montant reçu non tapé,
      // la carte, le chèque) : ce qui a été payé — un « 0,000 » en grand ne dirait rien.
      const monnaie = especes && ca.recu != null;
      $('#cs-body').innerHTML = `<div class="ct-rendu" id="cs-rendu-ecran"><div class="ct-rendu-contenu">
        <span class="ct-ok">${ICONES.ok}</span>
        <p class="ct-rendu-titre">${rendu ? 'Rendre au client' : monnaie ? 'Le compte est juste : rien à rendre' : especes ? 'Encaissé en espèces' : `Payé par ${h(modeNom.toLowerCase())} : rien à rendre`}</p>
        ${monnaie ? `<b class="ct-rendu-montant" id="cs-a-rendre">${C.money(rendu, cur)}</b>` : `<b class="ct-rendu-montant" id="cs-paye">${C.money(tt.netToPay, cur)}</b>`}
        <p class="ct-rendu-detail">Ticket ${h(d.number)}${d.caisseHorsLigne ? ' (sans réseau : il partira au serveur au retour du réseau)' : ''} · ${especes && ca.recu != null ? `${C.money(ca.recu, cur)} reçus en espèces sur ${C.money(tt.netToPay, cur)}` : `${h(modeNom)} · ${C.money(tt.netToPay, cur)}`}</p>
        <div class="ct-rendu-gestes">
          <button type="button" class="ct-bouton" id="cs-print-last">${ICONES.imprimante} ${bridge.ticketEncaisse ? 'Réimprimer le ticket' : 'Imprimer le ticket'}</button>
          <button type="button" class="ct-bouton" id="cs-voir-ticket">Voir le ticket</button>
        </div>
        <button type="button" class="ct-principal" id="cs-nouvelle">Nouvelle vente</button>
        <p class="ct-aide">Scanner l'article suivant commence aussi la vente suivante.</p>
      </div></div>`;
      $('#cs-print-last').onclick = () => imprimerTicketDe(d);
      $('#cs-voir-ticket').onclick = () => ticketApercu(d);
      $('#cs-nouvelle').onclick = () => { s.ecran = 'vente'; drawVendre(); scan(); };
      $('#cs-nouvelle').focus();
      ecranClient('merci', { total: C.money(tt.netToPay, cur), recu: especes && ca.recu != null ? C.money(ca.recu, cur) : '', rendu: rendu ? C.money(rendu, cur) : '', numero: d.number, mode: modeNom });
    };
    const scan = () => { const i = $('#cs-scan'); if (i) i.focus(); };
    const encaisser = () => {
      const b = $('#cs-valider');
      if (!b || b.disabled || b.dataset.busy) return;
      const recu = s.mode === 'especes' ? s.recu : '';
      const motif = motifSession() || C.motifEncaissement(data, company(), s.panier, { mode: s.mode, recu, remise: s.remise });
      if (motif) { toast(motif, true); return; }
      // Avant le numéro : un refus après `nextNumber` trouerait la série des tickets (6.0.0).
      if (closedBlock(C.today(), 'Ce ticket')) return;
      if (licenceBlock('Émettre un ticket de caisse', 'caisse')) return;
      if (bridge.encaisser) {
        // (brique 125) Une remise au-delà du plafond de la caisse : le code d'un responsable présent, demandé avant.
        const remise = Number(String(s.remise || '0').replace(',', '.')) || 0;
        const plafond = Number(company().remiseCaisseAuDela) || 0;
        const responsable = (bridge.droitsDossier ? bridge.droitsDossier() : {}).responsable;
        if (remise > plafond && !responsable && !b.dataset.code) {
          demanderResponsable(`Remise de ${String(remise).replace('.', ',')} %`,
            `Au-delà de ${String(plafond).replace('.', ',')} %, une remise se fait avec l'accord d'un responsable présent, qui tape son code sur ce poste. Le ticket portera son nom.`,
            code => { b.dataset.code = JSON.stringify(code); encaisser(); });
          return;
        }
        const code = b.dataset.code ? JSON.parse(b.dataset.code) : null;
        delete b.dataset.code;
        b.dataset.busy = '1'; b.disabled = true;
        // Le numéro vient du serveur : celui que le moteur vient de prendre sur ce poste se rend.
        const compteurs = JSON.stringify(data.counters || {});
        const t = C.ticketDeCaisse(data, company(), s.panier, { mode: s.mode, recu: recu === '' ? null : recu, clientId: s.clientId, remise: s.remise });
        data.counters = JSON.parse(compteurs); t.number = '';
        bridge.encaisser(t, C.computeTotals(t, company()).netToPay, code ? { responsable: code } : undefined).then(e => {
          data.documents.push(e);
          // (plateforme, brique 138) L'application de bureau imprime le ticket encaissé, et ouvre le tiroir pour des espèces.
          if (bridge.ticketEncaisse) {
            Promise.resolve(bridge.ticketEncaisse(C.ticketHtml(e, company(), { clientName: e.clientId ? clientName(e.clientId) : '', exemple: C.estDemo(data) }),
              company().caisseLargeur, !!(e.caisse && e.caisse.mode === 'especes'))).then(r => { if (r && !r.ok && r.raison) toast(r.raison, true); }, x => toast(plainError(x), true));
          }
          s.panier = []; s.recu = ''; s.clientId = ''; s.remise = ''; s.dernierId = e.id;
          // La monnaie s'affiche en grand ; la vente suivante recommence en espèces.
          s.ecran = 'rendu'; s.mode = 'especes';
          const rendu = e.caisse && e.caisse.rendu ? ` — à rendre ${C.money(e.caisse.rendu, cur)}` : '';
          toast(`Ticket ${e.number} encaissé${e.caisseHorsLigne ? ' sans réseau (il partira au serveur au retour du réseau)' : ''}${rendu}`);
        }, x => toast(plainError(x), true)).finally(() => { delete b.dataset.busy; drawVendre(); });
        return;
      }
      b.dataset.busy = '1';
      const t = C.ticketDeCaisse(data, company(), s.panier, { mode: s.mode, recu: recu === '' ? null : recu, clientId: s.clientId });
      data.documents.push(t);
      save(true);
      s.panier = []; s.recu = ''; s.clientId = ''; s.dernierId = t.id; s.ecran = 'rendu'; s.mode = 'especes';
      const rendu = t.caisse && t.caisse.rendu ? ` — à rendre ${C.money(t.caisse.rendu, cur)}` : '';
      toast(`Ticket ${t.number} encaissé${rendu}`);
      drawVendre();
    };
    // La caisse fermée (ou tenue sur un autre appareil) : on l'ouvre ici, avec le fond de caisse.
    const drawFermee = () => {
      const ss = caisseEtat.session;
      ecranClient('repos');
      if (ss && !ss.ici) {
        $('#cs-body').innerHTML = `<div class="ct-fermee"><div class="ct-fermee-carte" id="cs-ailleurs"><h2>La caisse est ouverte sur un autre appareil.</h2>
          <p>« ${h(ss.appareil)} », par ${h(ss.qui)}, depuis le ${h(heureCaisse(ss.ouverteLe))} : une caisse n'est tenue que par un appareil à la fois. ${fermerDIci() ? 'Ferme-la là-bas ; perdu, éteint ou loin, ferme-la d\'ici : le Z dira l\'écart du tiroir, et un ticket encaissé là-bas sans réseau arrivera quand même.' : 'Ferme-la là-bas pour l\'ouvrir ici, ou demande au propriétaire ou à un administrateur de la fermer d\'ici.'} ${info('cs.session')}</p>
          ${fermerDIci() ? '<button type="button" class="ct-principal" id="cs-fermer-ici">Fermer la caisse d\'ici</button>' : ''}</div></div>`;
        if ($('#cs-fermer-ici')) $('#cs-fermer-ici').onclick = fermerCaisse;
        return;
      }
      if (!comptes.especes) {
        $('#cs-body').innerHTML = `<div class="ct-fermee"><div class="ct-fermee-carte" id="cs-sans-caisse"><h2>D'abord, la caisse.</h2>
          <p>Les espèces encaissées au comptoir vont dans le compte de caisse, pas à la banque : c'est ce qui permet à SkanFact de dire, le soir, combien le tiroir doit contenir.</p>
          <button type="button" class="ct-principal" id="cs-creer">Créer la caisse</button></div></div>`;
        $('#cs-creer').onclick = () => creerCaisse(() => vers('#/caisse')());
        return;
      }
      // Ce que le tiroir contient déjà, proposé (vu sur le serveur d'essai le 05/10/2026 : la caisse créée avec 50 DT
      // s'ouvrait à 0, et le Z du soir aurait annoncé 50 DT de trop) : le solde du compte de caisse aujourd'hui, par la
      // même fonction que la Trésorerie et le bilan du jour. Se recompte et se corrige si le tiroir dit autre chose.
      const idCaisse = C.comptesDeCaisse(data).especes;
      const dansLeTiroir = idCaisse ? C.accountBalance(data, company(), idCaisse, C.today()).balance : 0;
      const fondPropose = dansLeTiroir > 0 ? dansLeTiroir.toFixed(caisseEtat.decimales ?? 3).replace('.', ',') : '';
      $('#cs-body').innerHTML = `<div class="ct-fermee"><div class="ct-fermee-carte" id="cs-fermee"><h2>La caisse est fermée.</h2>
        <p>Ouvre-la sur cet appareil avec le fond de caisse (les espèces déjà dans le tiroir) : elle encaisse ensuite ici, et seulement ici, jusqu'à sa fermeture. ${info('cs.session')}</p>
        ${licence.locked && bridge.dessinerAbonnement ? `<p class="ct-abo" id="cs-abo"><b>${h(licence.label)} :</b> la caisse ne s'ouvre plus tant que l'abonnement n'est pas réglé. ${h(licence.detail)} Les tickets déjà faits se lisent toujours.</p>` : ''}
        <label class="field">Fond de caisse (${h(caisseEtat.devise === 'TND' ? 'DT' : caisseEtat.devise)})<input type="text" inputmode="decimal" class="num" id="cs-fond" placeholder="0" value="${h(fondPropose)}"></label>
        <div class="ct-fond-ecart" id="cs-fond-ecart" aria-live="polite"></div>
        <button type="button" class="ct-principal" id="cs-ouvrir">Ouvrir la caisse</button></div></div>`;
      // (1.313.0) Un fond qui n'est pas ce que la Trésorerie garde pour la caisse : la différence est de l'argent qui entre
      // dans le tiroir, ou en sort, à l'ouverture. Rien ne la notait : le Z du soir comptait un tiroir de 66 DT quand la
      // Trésorerie, le livre et le comptable gardaient 16 DT pour la caisse (les 50 DT du fond n'étaient entrés nulle part).
      // L'écran le dit sous le champ, avant le geste ; il propose d'où vient l'argent (une banque, un apport du gérant) ou
      // où il est allé (versé à une banque, un manque), et l'ouverture le note dans la Trésorerie.
      const autres = (data.accounts || []).filter(a => a.id !== idCaisse && a.kind !== 'caisse');
      const fondTape = () => { const v = Number(String($('#cs-fond').value || '0').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? C.round3(v) : NaN; };
      const ecartFond = () => { const v = fondTape(); return isFinite(v) && idCaisse ? C.round3(v - dansLeTiroir) : 0; };
      const dessinerEcart = () => {
        const d = ecartFond(), boite = $('#cs-fond-ecart');
        if (Math.abs(d) < 0.0005) { boite.innerHTML = ''; return; }
        const choix = d > 0
          ? [['apport', 'apportés par le gérant'], ...autres.map(a => [`compte:${a.id}`, `retirés de « ${a.name} »`])]
          : [...autres.map(a => [`compte:${a.id}`, `versés à « ${a.name} »`]), ['retrait', 'pris par le gérant'], ['manque', 'un manque : sortis sans être notés']];
        const garde = $('#cs-fond-origine') ? $('#cs-fond-origine').value : '';
        boite.innerHTML = `<p>Ta caisse, dans la Trésorerie, a ${argentCaisse(dansLeTiroir)} : ${d > 0 ? `les ${argentCaisse(d)} de plus y entrent` : `les ${argentCaisse(-d)} qui manquent en sortent`} à l'ouverture.</p>
          <label class="field">${d > 0 ? 'D\'où viennent-ils ?' : 'Où sont-ils allés ?'}<select id="cs-fond-origine">${choix.map(([k, l]) => `<option value="${h(k)}"${k === garde ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>`;
      };
      dessinerEcart();
      $('#cs-fond').addEventListener('input', dessinerEcart);
      // Le mouvement de l'ouverture, du jour, dans le compte de la caisse : un virement avec une banque, un apport, un manque.
      const noterEcartDuFond = d => {
        const o = $('#cs-fond-origine') ? $('#cs-fond-origine').value : (d > 0 ? 'apport' : 'manque');
        const vers = o.startsWith('compte:') ? o.slice(7) : '';
        const m = { id: C.uid(), date: C.today(), amount: Math.abs(d), method: 'especes', reference: 'Ouverture de la caisse', label: '' };
        if (vers) Object.assign(m, d > 0 ? { kind: 'virement', accountId: vers, versAccountId: idCaisse, label: 'Fond de caisse retiré de la banque' } : { kind: 'virement', accountId: idCaisse, versAccountId: vers, label: 'Espèces du tiroir versées à la banque' });
        else if (d > 0) Object.assign(m, { kind: 'apport', accountId: idCaisse, label: 'Fond de caisse apporté par le gérant' });
        else if (o === 'retrait') Object.assign(m, { kind: 'retrait', accountId: idCaisse, label: 'Espèces du tiroir prises par le gérant' });
        else Object.assign(m, { kind: 'autre-sortie', accountId: idCaisse, compte: '658', label: 'Manque dans le tiroir à l\'ouverture' });
        data.movements = data.movements || [];
        data.movements.push(m);
        save(true);
        return m;
      };
      $('#cs-ouvrir').onclick = async () => {
        if (licenceBlock('Ouvrir la caisse', 'caisse')) return;
        const b = $('#cs-ouvrir'); b.disabled = true;
        const d = ecartFond();
        try {
          const r = await bridge.ouvrirCaisse($('#cs-fond').value.trim() || '0');
          const m = Math.abs(d) >= 0.0005 ? noterEcartDuFond(d) : null;
          toast(`Caisse ouverte, fond de caisse ${argentCaisse(r.fond)}${m ? ` ; ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)} : ${argentCaisse(m.amount)}, noté dans la Trésorerie` : ''}`);
          vers('#/caisse')();
        } catch (e) { b.disabled = false; toast(plainError(e), true); $('#cs-fond').focus(); }
      };
      $('#cs-fond').onkeydown = e => { if (e.key === 'Enter') $('#cs-ouvrir').click(); };
    };
    // ---- Le soir : compter le tiroir (le comptage à l'aveugle, brique 122 ; maquette « Fermeture », 05/10/2026) ----
    // Billet par billet, pièce par pièce : toucher une coupure, taper combien il y en a ; le total se fait tout seul, en
    // millimes entiers. Ou taper le total compté. Ce que le tiroir devait contenir ne se voit qu'au Z, après le geste : le
    // Z le dit, avec l'écart, et garde le détail du comptage. Les coupures du dinar qui ont cours : À VÉRIFIER (Banque
    // centrale de Tunisie). Une autre devise que le dinar : le total tapé seulement.
    const COUPURES = [[50000, 'billet'], [20000, 'billet'], [10000, 'billet'], [5000, 'piece'], [2000, 'piece'], [1000, 'piece'],
      [500, 'piece'], [200, 'piece'], [100, 'piece'], [50, 'piece'], [20, 'piece'], [10, 'piece']];
    const drawFermeture = () => {
      ecranClient('repos');
      const dinars = C.normCurrency(cur) === 'DT';
      const coupures = dinars ? COUPURES : [];
      if (!s.comptage) s.comptage = { actif: 0, frais: true, nombres: {}, tape: '' };
      const c = s.comptage;
      const nom = v => (v >= 1000 ? String(v / 1000) : String(v));
      const unite = v => (v > 1000 ? 'dinars' : v === 1000 ? 'dinar' : 'millimes');
      const totalCoupures = () => coupures.reduce((x, [v], i) => x + v * (Number(c.nombres[i]) || 0), 0);
      const libelle = i => `${coupures[i][1] === 'billet' ? 'Billets' : 'Pièces'} de ${nom(coupures[i][0])} ${unite(coupures[i][0])}`;
      const rangee = ([v, sorte], i) => {
        const n = Number(c.nombres[i]) || 0;
        return `<button type="button" class="ct-coupure" data-coupure="${i}" aria-pressed="${c.actif === i}" aria-label="${libelle(i)} : ${n}">
          <span class="ct-forme ${sorte}"><b>${nom(v)}</b><small>${unite(v)}</small></span>
          <span class="ct-coupure-sorte">${sorte === 'billet' ? 'billets' : 'pièces'}</span>
          <span class="ct-coupure-nombre" data-nombre="${i}">${n}</span>
          <span class="ct-coupure-total" data-sous-total="${i}">${C.money(v * n / 1000, '', 3)}</span></button>`;
      };
      $('#cs-body').innerHTML = `<div class="ct-fermeture" id="cs-fermeture">
        <section class="ct-coupures" aria-label="Compter le tiroir">
          <div class="ct-titre"><h2>Compte le tiroir</h2><span>${dinars ? 'Touche une coupure, puis tape combien il y en a.' : 'Compte les espèces du tiroir, fond de caisse compris.'}</span></div>
          ${dinars ? `<div class="ct-coupures-grille">
            <div><span class="ct-sur">Billets et pièces en dinars</span>${coupures.slice(0, 6).map((x, i) => rangee(x, i)).join('')}</div>
            <div><span class="ct-sur">Pièces en millimes</span>${coupures.slice(6).map((x, i) => rangee(x, i + 6)).join('')}</div>
          </div>` : ''}
        </section>
        <section class="ct-compte" aria-label="Le compte du tiroir">
          <div class="ct-compte-defile">
          <div class="ct-compte-total"><span>Total compté</span><b id="cs-compte-total"></b><small id="cs-compte-detail"></small></div>
          ${dinars ? `<div class="ct-active" id="cs-active"><span id="cs-active-nom"></span><b id="cs-active-nombre"></b></div>
          <div class="ct-pave" id="cs-pave-compte">${['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', 'suivant'].map(touche).join('')}</div>` : ''}
          <details class="ct-tape" id="cs-tape"${dinars ? '' : ' open'}><summary>${dinars ? 'Taper le total compté à la place' : 'Le total compté'}</summary>
            <label class="field">Espèces comptées (${h(C.normCurrency(cur))})<input type="text" inputmode="decimal" class="num" id="cs-compte" value="${h(c.tape)}" autocomplete="off"></label></details>
          <p class="ct-aide">Ce que le tiroir devait contenir reste caché pendant que tu comptes : le Z le dit, avec l'écart. ${info('cs.comptage')}</p>
          <p class="cs-motif" role="alert" id="cs-compte-refus"></p>
          </div>
          <button type="button" class="ct-principal" id="cs-z">Fermer la caisse et faire le Z</button>
        </section></div>`;
      $('#cs-actions').innerHTML = '<button type="button" class="ct-bouton" id="cs-revenir-vente" aria-label="Revenir à la vente">‹ <span class="ct-long">Revenir à la vente</span><span class="ct-court">Vente</span></button>';
      const champ = $('#cs-compte');
      // Le total : celui tapé s'il y en a un, sinon celui des coupures.
      const maj = () => {
        const tape = champ.value.trim();
        const tot = totalCoupures();
        const billets = coupures.reduce((x, [v, sorte], i) => x + (sorte === 'billet' ? v * (Number(c.nombres[i]) || 0) : 0), 0);
        const lu = tape ? Number(tape.replace(/\s/g, '').replace(',', '.')) : null;
        $('#cs-compte-total').textContent = tape ? (isFinite(lu) ? C.money(lu, cur) : '—') : C.money(tot / 1000, cur);
        $('#cs-compte-detail').textContent = tape ? 'Le total tapé compte : les coupures ne comptent pas.'
          : dinars ? `Billets ${C.money(billets / 1000, cur)} · pièces ${C.money((tot - billets) / 1000, cur)}` : '';
        $$('[data-coupure]').forEach(b => {
          const i = Number(b.dataset.coupure), n = Number(c.nombres[i]) || 0;
          b.setAttribute('aria-pressed', String(c.actif === i));
          b.setAttribute('aria-label', `${libelle(i)} : ${n}`);
          $(`[data-nombre="${i}"]`).textContent = String(n);
          $(`[data-sous-total="${i}"]`).textContent = C.money(coupures[i][0] * n / 1000, '', 3);
        });
        if ($('#cs-active')) {
          $('#cs-active-nom').textContent = libelle(c.actif);
          $('#cs-active-nombre').textContent = String(Number(c.nombres[c.actif]) || 0);
        }
      };
      // Une coupure touchée : le premier chiffre tapé remplace son nombre, les suivants s'y ajoutent.
      const choisir = i => { c.actif = i; c.frais = true; maj(); };
      const taper = k => {
        if (k === 'suivant') { choisir((c.actif + 1) % coupures.length); return; }
        // Compter au détail efface le total tapé.
        if (champ.value) { champ.value = ''; c.tape = ''; }
        const n = Number(c.nombres[c.actif]) || 0;
        if (k === '⌫') c.nombres[c.actif] = Math.floor(n / 10);
        else c.nombres[c.actif] = c.frais ? Number(k) : Math.min(99999, n * 10 + Number(k));
        c.frais = false;
        maj();
      };
      $$('[data-coupure]').forEach(b => { b.onclick = () => {
        const i = Number(b.dataset.coupure);
        choisir(i);
        // Sur un écran étroit (tablette debout, téléphone), le pavé du comptage serait loin sous la liste : la coupure
        // touchée demande son nombre dans une fenêtre (caisse.css cache alors le pavé de la colonne).
        if (!window.matchMedia('(max-width: 920px)').matches) return;
        pave(libelle(i), String(Number(c.nombres[i]) || ''), { entier: true, aide: 'Combien y en a-t-il dans le tiroir ?', bouton: 'Compter' }, t => {
          if (champ.value) { champ.value = ''; c.tape = ''; }
          c.nombres[i] = Math.min(99999, Math.floor(Number(t.replace(/\s/g, '').replace(',', '.')) || 0));
          maj();
        });
      }; });
      $$('#cs-pave-compte [data-touche]').forEach(b => { b.onclick = () => taper(b.dataset.touche); });
      champ.oninput = () => { c.tape = champ.value; maj(); };
      // Au clavier aussi : les chiffres comptent la coupure choisie, Entrée passe à la suivante.
      $('#cs-fermeture').onkeydown = e => {
        if (!dinars || e.target === champ || e.ctrlKey || e.metaKey || e.altKey) return;
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); taper(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); taper('⌫'); }
        else if (e.key === 'Enter' && e.target.closest('[data-coupure], #cs-pave-compte')) { e.preventDefault(); taper('suivant'); }
      };
      $('#cs-revenir-vente').onclick = () => { s.ecran = 'vente'; drawVendre(); };
      $('#cs-z').onclick = async () => {
        const b = $('#cs-z');
        if (b.disabled) return;
        const refus = t => { $('#cs-compte-refus').textContent = t; };
        const tape = champ.value.trim();
        const tot = totalCoupures();
        if (!tape && !dinars) { refus('Tape le total des espèces comptées (0 si le tiroir est vide).'); champ.focus(); return; }
        // Rien de compté : un tiroir vide se dit, il ne se suppose pas.
        if (!tape && !tot && !await confirmDialog('Le tiroir est vide ?\nRien n\'est compté : la caisse se fermera avec 0 compté, et le Z dira l\'écart avec ce qu\'il devait contenir.', 'Fermer avec un tiroir vide')) return;
        const compte = tape || (tot / 1000).toFixed(3);
        const comptage = tape ? [] : coupures.map(([v], i) => ({ valeur: (v / 1000).toFixed(3), nombre: Number(c.nombres[i]) || 0 })).filter(x => x.nombre > 0);
        b.disabled = true; refus('');
        try {
          const r = await bridge.fermerCaisse(compte, comptage);
          s.comptage = null; s.ecran = 'vente';
          montrerZ(r.z);
        } catch (e) { b.disabled = false; refus(plainError(e)); }
      };
      maj();
      // 1.294.0 : le comptage s'ouvre depuis le menu, le focus n'est nulle part dans l'écran ; le premier chiffre tapé se
      // perdait. La coupure choisie reçoit le focus (sur grand écran : sur un téléphone, le clavier s'ouvrirait pour rien).
      const choisie = $(`#cs-fermeture [data-coupure="${c.actif}"]`) || $('#cs-fermeture [data-coupure]');
      if (dinars && choisie && !window.matchMedia('(max-width: 920px)').matches) choisie.focus({ preventScroll: true });
    };
    // L'écran de vente suit la session lue au serveur (la page a pu se dessiner avant sa réponse) : il se redessine si elle
    // change ce qu'il montre (fermée, tenue ailleurs, la vente) ; sinon seul « Encaisser » suit.
    caisseRedessiner = () => {
      if (s.tab !== 'vendre' || !location.hash.startsWith('#/caisse') || !$('#cs-body')) return;
      if (vueDeSession() !== s.vueDessinee) { drawVendre(); return; }
      const mm = motifSession();
      if (mm && $('#cs-motif') && $('#cs-encaisser')) { $('#cs-motif').textContent = mm; $('#cs-encaisser').disabled = true; }
    };

    // ---- Tickets et bilan du jour ----
    const drawTickets = () => {
      const b = C.bilanCaisse(data, company(), s.jour);
      $('#cs-actions').innerHTML = b.nombre || b.rembourse ? '<button class="btn" id="cs-bilan-print">Imprimer le bilan du jour</button>' : '';
      // (1.294.0) Les tickets du jour dans la DA des listes (relances, catalogue) : quatre chiffres dans une carte, la
      // liste et les Z chacun dans la sienne.
      const chiffreT = (id, l, v, sous) => `<div class="mg-chiffre"${id ? ` id="${id}"` : ''}><span class="mu lbl">${l}</span><b class="val">${v}</b><small class="sub">${sous}</small></div>`;
      $('#cs-body').innerHTML = `<div class="lf mg ca cs-tk">
        <div class="cf-carte mg-resume" id="cs-resume">
          ${chiffreT('cs-ventes', `${b.retours ? 'Ventes du jour, retours déduits' : 'Ventes TTC'} ${info('cs.bilan')}`, C.money(b.retours ? b.net : b.total, cur), b.retours
            ? `${C.money(b.total, cur)} vendus en ${pl(b.nombre, 'ticket')} − ${C.money(b.retoursTtc, cur)} en ${pl(b.retours, 'retour')} (${h(b.avoirs.join(', '))})`
            : `${pl(b.nombre, 'ticket')}${b.nombre ? ' · dont TVA ' + C.money(b.tva, cur) : ''}${b.rembourse ? ' · rendu aux clients : ' + C.money(b.rembourse, cur) : ''}`)}
          ${chiffreT('', 'Espèces du jour', C.money(b.parMode.especes, cur), `<span id="cs-tiroir">${sousTiroir(b, cur)}</span>`)}
          ${chiffreT('', 'Carte', C.money(b.parMode.carte, cur), b.parMode.carte < 0 ? 'rendu aux clients par carte' : 'versé par ta banque')}
          ${chiffreT('', 'Chèques', C.money(b.parMode.cheque, cur), b.parMode.cheque < 0 ? 'rendu aux clients par chèque' : 'à remettre en banque')}
        </div>
        <div class="cf-carte"><div class="cf-onglet">
          <div class="cs-tk-tete"><h2>Les tickets du ${h(C.fmtDate(s.jour))}</h2>${dateFieldHtml(lbl('Jour', 'cs.jour'), 'csJour', s.jour, {})}</div>
          ${b.tickets.length ? `<div class="scroll-x"><table class="list compact" id="cs-liste"><thead><tr><th>Ticket</th><th>Heure</th><th>Articles</th><th>Paiement</th><th class="r">Total TTC</th></tr></thead><tbody>
            ${b.tickets.slice().sort((x, y) => (y.issuedTs || 0) - (x.issuedTs || 0)).map(d => {
              const tt = C.computeTotals(d, company());
              const mode = (C.MODES_CAISSE.find(x => x[0] === (d.caisse || {}).mode) || [0, '—'])[1];
              const rendus = C.resteARendre(data, d).some(r => r.rendu > 0);
              return `<tr class="clickable" data-tk="${h(d.id)}"><td><strong>${h(d.number)}</strong>${rendus ? '<div class="small muted">article rendu</div>' : ''}</td>
                <td class="nw">${h(C.heureDuTicket(d) || '—')}</td>
                <td class="tronq">${h((d.lines || []).map(l => (l.qty !== 1 ? pct(l.qty) + ' × ' : '') + l.label).join(', '))}</td>
                <td>${h(mode)}${d.clientId ? `<div class="small muted">${h(nomClientPiece(d))}</div>` : ''}</td>
                <td class="r nw">${C.money(tt.netToPay, cur)}</td></tr>`;
            }).join('')}
          </tbody></table></div>` : `<div class="mg-vide"><b>Aucun ticket ce jour-là</b>${s.jour === C.today() ? '<span>Les ventes encaissées aujourd\'hui s\'écrivent ici.</span><button type="button" class="btn btn-primary" id="cs-aller-vendre">Ouvrir la caisse</button>' : '<span>Choisis un autre jour.</span>'}</div>`}
        </div></div>
        ${bridge.listeZ ? '<div class="cf-carte"><div class="cf-onglet" id="cs-les-z"><h2>Les Z</h2><p class="small muted">Lecture des Z…</p></div></div>' : ''}
      </div>`;
      if ($('#cs-les-z')) void dessinerLesZ($('#cs-les-z'));
      bindDateFields($('#cs-body'));
      const j = $('#cs-body [name=csJour]');
      if (j) j.addEventListener('change', () => { if (j.value) { s.jour = j.value; drawTickets(); } });
      $$('#cs-liste [data-tk]').forEach(tr => { tr.onclick = () => { const d = data.documents.find(x => x.id === tr.dataset.tk); if (d) ticketApercu(d); }; });
      if ($('#cs-aller-vendre')) $('#cs-aller-vendre').onclick = () => { s.tab = 'vendre'; vers('#/caisse')(); };
      if ($('#cs-bilan-print')) $('#cs-bilan-print').onclick = () => {
        Promise.resolve(bridge.imprimerTicket(C.bilanCaisseHtml(bilanAImprimer(C.bilanCaisse(data, company(), s.jour)), company()), company().caisseLargeur))
          .catch(e => toast(plainError(e), true));
      };
    };
    if (s.tab === 'tickets') drawTickets(); else drawVendre();
  };

  routes.stock = () => {
    const cur = company().currency;
    const s = stockState;
    const items = C.trackedItems(data);
    // Les alertes se RECALCULENT à chaque dessin. Capturées une fois à l'entrée de la page, elles
    // restaient celles d'avant : enregistrer un inventaire ou un mouvement redessine le corps de la
    // page sans recharger la route, donc l'onglet continuait d'annoncer « 3 » et le panneau
    // continuait de lister trois articles qu'on venait de réapprovisionner. Un compteur qui ment
    // sur un écran qu'on vient d'utiliser fait douter de tous les autres.
    let alerts = C.stockAlerts(data);
    const relireAlertes = () => {
      alerts = C.stockAlerts(data);
      const onglet = $('#st-tabs button[data-tab="alertes"]');
      if (!onglet) return;
      const pastille = onglet.querySelector('.nav-count');
      if (alerts.length && pastille) pastille.textContent = alerts.length;
      else if (alerts.length) onglet.insertAdjacentHTML('beforeend', ` <span class="nav-count">${alerts.length}</span>`);
      else if (pastille) pastille.remove();
    };

    // Même défaut que sur Paie : le bouton vert de l'en-tête ne suivait pas l'onglet. Sur
    // « Numéros de série », il disait « + Mouvement » pendant que « + Entrée de numéros », le vrai
    // geste, était un bouton vert plus petit dans le panneau.
    // Et sur « Mouvements », le journal même des mouvements, le bouton qui en ajoute un disparaissait :
    // l'onglet où on le cherche était le seul, avec « État du stock », à ne pas pouvoir l'avoir oublié
    // (10.14.0, vu à la souris).
    const ST_ACTION = { etat: ['st-adj', '+ Mouvement'], mouvements: ['st-adj', '+ Mouvement'], series: ['se-add', '+ Entrée de numéros'] };
    // Le bouton d'export DIT ce qu'il exporte : jusqu'ici il s'appelait « Exporter en CSV » sur les
    // cinq onglets et renvoyait l'état du stock sur les cinq.
    const ST_LABELS = { etat: 'l\'état du stock', mouvements: 'les mouvements', series: 'les numéros de série',
      inventaire: 'l\'inventaire', alertes: 'ce qu\'il faut recommander' };
    // 10.12.0 (H-E27, vu au test humain) — sans article suivi, le seul bouton vert de la page était
    // « + Mouvement » : un mouvement de rien, puisqu'aucun article n'est compté ; et l'état vide
    // expliquait le geste en prose (« ouvre le Catalogue, modifie la prestation et coche… »), la
    // notice de montage que la 7.0.0 avait retirée partout ailleurs. Le geste qui manque est EN
    // BAS, dans l'état vide, et il se fait d'un clic ; l'en-tête ne propose rien qu'on ne puisse
    // pas encore faire — ni mouvement, ni export d'un stock qui n'existe pas.
    const stHead = () => {
      const a = items.length ? ST_ACTION[s.tab] : null;
      return `<div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Stock</span></div><h1>Stock</h1><p class="sous">Ce que tu as en rayon, ce qui entre et sort, ce qu'il faut recommander</p></div>
        <div class="actions">
          ${items.length ? `<button class="btn" id="st-csv" data-csv="${h(s.tab)}">Exporter ${h(ST_LABELS[s.tab] || ST_LABELS.etat)}</button>` : ''}
          <button class="btn" id="st-war">Garanties</button>
          <button class="btn" id="st-depots">Dépôts…</button>
          ${a ? `<button class="btn btn-primary" id="${a[0]}">${a[1]}</button>` : ''}
        </div>`;
    };
    $('#view').innerHTML = `
      <div class="page-head lf-tete" id="st-head">${stHead()}</div>
      ${items.length ? '' : etatVide('Ce que tu as en rayon', [
        'Le stock ne se saisit pas : il se déduit de tes achats et de tes ventes. Un article compté est un article du Catalogue marqué <b>« Suivi en stock »</b> : indique ce que tu as en rayon aujourd\'hui, et SkanFact suit le reste tout seul.',
        'Les prestations (du temps, du conseil) n\'ont pas de stock : on ne suit que de la marchandise.'],
        [['st-new', '+ Nouvel article suivi', true], ...(data.catalog.length ? [['st-pick', 'Choisir dans le Catalogue']] : [])])}
      <div class="lf mg st" ${items.length ? '' : 'hidden'}>
        <div class="cf-carte mg-resume" id="st-resume"></div>
        <div class="mg-barre"><div class="pa-seg" id="st-tabs" role="tablist" aria-label="Le stock">${STOCK_TABS.map(([id, label]) =>
          `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === s.tab}" class="${id === s.tab ? 'active' : ''}">${label}${id === 'alertes' && alerts.length ? ` <span class="nav-count">${alerts.length}</span>` : ''}</button>`).join('')}</div></div>
        <div class="cf-carte"><div class="cf-onglet" id="st-body"></div></div>
      </div>`;

    // (1.277.0, la nouvelle DA, comme la Trésorerie) Les quatre chiffres du stock, au-dessus des onglets : redessinés à
    // chaque dessin (un inventaire, un mouvement les changent). Ceux qui annoncent un problème ouvrent les alertes.
    const chiffreS = (lbl2, val, sous, ton, bulle, stat) => `<div class="mg-chiffre"${stat ? ` data-stat="${stat}" role="button" tabindex="0"` : ''}><span class="mu">${lbl2}${bulle ? ' ' + info(bulle) : ''}</span><b class="${ton || ''}">${val}</b><small>${sous}</small></div>`;
    function drawResume() {
      const el = $('#st-resume'); if (!el) return;
      const t = C.stockTotals(data);
      // Un article sans prix de vente (une planche qu'on transforme, pas qu'on revend) ne vaut pas « 0 » vendu : il n'a pas
      // de prix (10.12.0, une menuiserie).
      const prix = t.rows.filter(r => Number(r.unitPrice) > 0), sans = t.rows.length - prix.length;
      const vente = C.round3(prix.reduce((a, r) => a + Math.max(0, r.qty) * r.unitPrice, 0));
      el.innerHTML = chiffreS('Valeur du stock', montantU(t.value, cur), `${pl(t.count, 'article')} suivi${sPl(t.count)}, au coût moyen`, '', 'stk.value')
        + chiffreS('Sous le seuil', String(t.low), t.low ? 'à recommander — voir lesquels' : 'rien à recommander', t.low ? 'rouge' : 'vert', 'stk.min', t.low ? 'low' : '')
        + chiffreS('Stocks négatifs', String(t.negative), t.negative ? 'une entrée manque quelque part — voir lesquels' : 'rien d\'impossible', t.negative ? 'rouge' : '', 'stk.negative', t.negative ? 'neg' : '')
        + chiffreS('Prix de vente du stock', prix.length ? montantU(vente, cur) : '—', !prix.length ? 'aucun prix de vente fixé' : sans ? `ce qu'il rapporterait vendu — ${pl(sans, 'article')} sans prix, non compté${sPl(sans)}` : 'ce qu\'il rapporterait vendu', '');
      // Un compteur rouge qui nomme un ensemble doit l'ouvrir (7.15.0).
      $$('#st-resume [data-stat]').forEach(x => {
        const go = e2 => { if (e2.target.closest('.i[data-info]')) return; s.tab = 'alertes'; marquerOnglet(); draw(); };
        x.onclick = go;
        x.onkeydown = e2 => { if (e2.key === 'Enter' || e2.key === ' ') { e2.preventDefault(); go(e2); } };
      });
    }
    const marquerOnglet = () => $$('#st-tabs button').forEach(x => { x.classList.toggle('active', x.dataset.tab === s.tab); x.setAttribute('aria-selected', String(x.dataset.tab === s.tab)); });

    const qtyCell = (st) => `<span class="${st.negative ? 'warn-text' : st.low ? 'warn-text' : ''}"><strong>${pct(st.qty)}</strong>${st.unit ? ' ' + h(C.uniteAccordee(st.qty, st.unit)) : ''}</span>`;

    function drawState() {
      const t = C.stockTotals(data);
      const q = s.q.trim().toLowerCase();
      const rows = t.rows.filter(r => (!q || C.correspondRecherche(`${r.label || ''} ${r.location || ''}`, q))
        && (!s.only || (s.only === 'alerte' ? (r.low || r.negative) : r.qty > 0)));
      // Paginé comme toute liste (2.2.0) : cent vingt articles faisaient six mille pixels. Le total,
      // lui, porte la sélection entière, jamais la page (2.2.0, 7.16.0).
      const pageEtat = paginate(rows, s.etat);
      $('#st-body').innerHTML = `
        <div class="panel"><h2>État du stock ${info('stk.state')}</h2>
          <div class="filters">
            <input type="search" id="st-q" placeholder="Rechercher un article…" value="${h(s.q)}">
            <select id="st-only"><option value="">Tous les articles</option><option value="positif" ${s.only === 'positif' ? 'selected' : ''}>En stock seulement</option><option value="alerte" ${s.only === 'alerte' ? 'selected' : ''}>À surveiller</option></select>
            <span class="small muted">${rows.length} sur ${t.count}</span>
          </div>
          ${rows.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Article</th><th>Emplacement</th><th class="r">En stock</th><th class="r">Seuil</th><th class="r">Coût moyen ${info('stk.cmp')}</th><th class="r">Valeur</th><th class="r">Prix de vente</th></tr></thead><tbody>
            ${pageEtat.rows.map(r => `<tr class="clickable ${r.negative ? 'row-warn' : ''}" data-iid="${h(r.itemId)}">
              <td><strong>${h(r.label)}</strong>${r.negative ? '<div class="small warn-text">stock négatif : une entrée manque</div>' : r.low ? '<div class="small warn-text">sous le seuil d\'alerte</div>' : ''}</td>
              <td>${h(r.location) || '<span class="muted">—</span>'}</td>
              <td class="r nw">${qtyCell(r)}</td>
              <td class="r nw">${r.minStock ? pct(r.minStock) : '<span class="muted">—</span>'}</td>
              <td class="r nw">${C.money(r.cmp, cur)}</td>
              <td class="r nw"><strong>${C.money(Math.max(0, r.value), cur)}</strong></td>
              <td class="r nw">${Number(r.unitPrice) > 0 ? C.money(r.unitPrice, cur) : '<span class="muted" title="Pas de prix de vente fixé">—</span>'}</td></tr>`).join('')}
            <tr class="total-row"><td colspan="5"><strong>Total</strong></td>
              <td class="r"><strong>${C.money(C.round3(rows.reduce((a, r) => a + Math.max(0, r.value), 0)), cur)}</strong></td><td></td></tr>
          </tbody></table></div>${pagerBar(pageEtat.pg, { noun: 'article' })}
          <p class="small muted mt">Valorisation au <b>coût moyen pondéré</b> : à chaque entrée, le coût unitaire moyen est recalculé sur tout le stock. <em>À VÉRIFIER avec ton comptable : la méthode retenue pour tes comptes annuels.</em></p>`
            : '<div class="empty">Aucun article ne correspond.</div>'}
        </div>`;
      $('#st-q').oninput = e => { s.q = e.target.value; s.etat.page = 1; sansPerdreLaFrappe(e.target, drawState); };
      $('#st-only').onchange = e => { s.only = e.target.value; s.etat.page = 1; drawState(); };
      bindPager($('#st-body'), s.etat, () => drawState(), '#st-body');
      $$('#st-body tr[data-iid]').forEach(tr => tr.onclick = () => navigate('#/article/' + tr.dataset.iid));
    }

    function drawMoves() {
      // Même défaut que sur la Trésorerie : l'année était écrite dans le code. Un inventaire se
      // justifie sur l'exercice écoulé, et la page n'offrait aucun moyen d'y retourner.
      const tout = C.stockJournal(data, { from: '', to: '9999-12-31' });
      const annees = Array.from(new Set(tout.map(m => (m.date || '').slice(0, 4)).filter(Boolean)
        .concat([C.today().slice(0, 4)]))).sort().reverse();
      if (!annees.includes(s.year)) s.year = annees[0];
      const year = s.year;
      const all = C.stockJournal(data, { from: `${year}-01-01`, to: `${year}-12-31` });
      const paged = paginate(all, s.moves);
      $('#st-body').innerHTML = `
        <div class="panel"><h2>Mouvements de ${h(year)} ${info('stk.moves')}</h2>
          <div class="filters"><select id="st-year">${annees.map(y => `<option ${y === s.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
            <span class="small muted">${pl(all.length, 'mouvement')}</span></div>
          ${all.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Date</th><th>Article</th><th>Origine</th><th>Référence</th><th class="r">Quantité</th><th class="r">Coût unitaire</th><th class="r">Stock après</th></tr></thead><tbody>
            ${paged.rows.map(m => `<tr class="${m.docId ? 'clickable' : ''}" ${m.docId ? `data-go="${h(m.source === 'achat' ? '#/achat/' : '#/doc/')}${h(m.docId)}"` : ''}>
              <td class="nw">${C.fmtDate(m.date)}</td><td>${h(m.label)}</td>
              <td>${h(C.moveSourceLabel(m.source))}${m.note ? `<div class="small muted">${h(m.note)}</div>` : ''}</td>
              <td class="nw">${h(m.ref) || '<span class="muted">—</span>'}</td>
              <td class="r nw ${m.qty < 0 ? 'warn-text' : 'ok-text'}"><strong>${qteSignee(m.qty)}</strong></td>
              <td class="r nw">${C.money(m.unitApplied, cur)}</td>
              <td class="r nw ${m.qtyAfter < 0 ? 'warn-text' : ''}">${pct(m.qtyAfter)}</td></tr>`).join('')}
          </tbody></table></div>
          ${paged.pg ? pagerBar(paged.pg, { noun: 'mouvement' }) : ''}
          <p class="small muted mt">Tout vient des pièces déjà saisies : une ligne d'achat en destination « stock » fait une entrée, une facture ou un bon de livraison fait une sortie. Seuls la matière utilisée, la casse, l'inventaire et l'ajustement se saisissent à la main.</p>`
            : `<div class="empty">Aucun mouvement en ${h(year)}.</div>`}
        </div>`;
      $('#st-year').onchange = e => { s.year = e.target.value; s.moves.page = 1; drawMoves(); };
      $$('#st-body tr[data-go]').forEach(tr => tr.onclick = () => navigate(tr.dataset.go));
      bindPager($('#st-body'), s.moves, () => drawMoves(), '#st-body');
    }

    // Le comptage se TAPE, ligne après ligne : le tableau ne se redessine jamais pendant la frappe
    // (règle 7.17.0). Il se redessinait à chaque chiffre, et un champ de nombre recréé rend son curseur
    // au DÉBUT : « 28 » tapé devenait 82 — un écart de +52 planches prêt à être enregistré. On met à
    // jour la ligne, le compte et le bouton ; le champ, lui, reste celui dans lequel on écrit.
    const etatInventaire = () => {
      const rows = C.inventoryDiff(data, s.counts, s.countDate);
      const counted = rows.filter(r => r.counted != null);
      const gaps = counted.filter(r => r.gap !== 0);
      return { rows, counted, gaps, value: C.round3(gaps.reduce((a, r) => a + r.value, 0)) };
    };
    function majInventaire() {
      const { rows, counted, gaps, value } = etatInventaire();
      const lignes = {}; $$('#st-body tr[data-ligne]').forEach(tr => { lignes[tr.dataset.ligne] = tr; });
      rows.forEach(r => {
        const tr = lignes[r.itemId]; if (!tr) return;
        tr.classList.toggle('row-warn', r.gap != null && r.gap !== 0);
        const ec = $('[data-ecart]', tr);
        ec.className = `r nw ${r.gap ? (r.gap < 0 ? 'warn-text' : 'ok-text') : ''}`;
        ec.innerHTML = r.gap == null ? '<span class="muted">—</span>' : `<strong>${qteSignee(r.gap)}</strong>`;
        $('[data-valeur]', tr).innerHTML = r.gap == null || r.gap === 0 ? '<span class="muted">—</span>' : C.money(r.value, cur);
      });
      $('#inv-compte').textContent = `${pl(counted.length, 'article')} compté${sPl(counted.length)} sur ${rows.length}`;
      $('#inv-apply').disabled = !gaps.length;
      $('#inv-apply').textContent = gaps.length ? `Enregistrer ${pl(gaps.length, 'écart')}` : 'Enregistrer les écarts';
      $('#inv-clear').disabled = !counted.length;
      const imp = $('#inv-impact');
      imp.className = `small ${value < 0 ? 'warn-text' : 'muted'}`;
      imp.textContent = gaps.length ? `Impact sur la valeur du stock : ${C.money(value, cur)}` : counted.length ? 'Aucun écart : ce que tu as compté est ce que dit l\'application.' : 'Aucun écart pour l\'instant.';
    }

    function drawInventory() {
      const { rows } = etatInventaire();
      // Paginé : le comptage d'un article d'une autre page reste dans `s.counts`, et les écarts se
      // calculent sur TOUS les articles (`etatInventaire`), pas sur la page affichée.
      const invPage = paginate(rows, s.inv);
      $('#st-body').innerHTML = `
        ${s.dernierInventaire ? `<div class="cf-carte" id="inv-fait"><p><b>Inventaire du ${C.fmtDate(s.dernierInventaire.date)} enregistré</b> : ${pl(s.dernierInventaire.comptes, 'article compté', 'articles comptés')}, ${pl(s.dernierInventaire.ecarts, 'écart')} pour ${C.money(s.dernierInventaire.valeur, company().currency)} au coût moyen.
          ${peutEcrireAuCabinet() ? 'La valeur du stock a changé : c\'est ce que ton cabinet passe en variation de stock à la clôture.' : ''}</p>
          <div class="inline">${peutEcrireAuCabinet() ? '<button class="btn btn-primary btn-sm" id="inv-prevenir">Prévenir mon comptable</button>' : ''}<button class="btn btn-sm btn-ghost" id="inv-fait-ok">Fermer</button></div></div>` : ''}
        <div class="panel"><h2>Inventaire physique ${info('stk.inventory')}</h2>
          <p class="small muted mb">Une fois par an au minimum, on compte ce qu'il y a vraiment en rayon et on le compare à ce que dit l'application. Un écart n'est pas une faute : c'est de la casse non déclarée, une sortie oubliée ou une erreur de saisie. L'important est de le voir.</p>
          <div class="filters">
            <label class="small">${lbl('Date du comptage', 'stk.countDate')} ${dateFieldHtml('', 'countDate', s.countDate, {})}</label>
            <span class="small muted" id="inv-compte"></span>
          </div>
          <div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Article</th><th class="r">Stock théorique</th><th class="r">Compté</th><th class="r">Écart</th><th class="r">Valeur de l'écart</th></tr></thead><tbody>
            ${invPage.rows.map(r => `<tr data-ligne="${h(r.itemId)}">
              <td><strong>${h(r.label)}</strong>${r.unit ? ` <span class="muted">(${h(r.unit)})</span>` : ''}</td>
              <td class="r nw">${pct(r.book)}</td>
              <td class="r"><input type="number" step="0.01" class="num inv-in" data-iid="${h(r.itemId)}" value="${r.counted == null ? '' : r.counted}" placeholder="—" style="width:90px" aria-label="Compté : ${h(r.label)}"></td>
              <td class="r nw" data-ecart></td><td class="r nw" data-valeur></td></tr>`).join('')}
          </tbody></table></div>${pagerBar(invPage.pg, { noun: 'article' })}
          <div class="inline mt">
            <button class="btn btn-primary" id="inv-apply" disabled></button>
            <button class="btn" id="inv-clear" disabled>Effacer le comptage</button>
            <span class="small" id="inv-impact"></span>
          </div>
          <p class="small muted mt">Rien n'est modifié tant que tu ne cliques pas : le comptage reste à l'écran, et c'est toi qui décides de le passer en mouvements d'inventaire.</p>
        </div>`;
      bindDateFields($('#st-body'));
      const hid = $('#st-body input[name=countDate]');
      if (hid) hid.onchange = () => { s.countDate = hid.value || C.today(); drawInventory(); };
      majInventaire();
      $$('#st-body .inv-in').forEach(el => el.oninput = () => { s.counts[el.dataset.iid] = el.value; majInventaire(); });
      $('#inv-clear').onclick = () => { s.counts = {}; drawInventory(); };
      if ($('#inv-fait-ok')) $('#inv-fait-ok').onclick = () => { s.dernierInventaire = null; drawInventory(); };
      if ($('#inv-prevenir')) $('#inv-prevenir').onclick = () => {
        const x = s.dernierInventaire;
        const effet = x.valeur ? `soit ${C.money(Math.abs(x.valeur), company().currency)} ${x.valeur < 0 ? 'en moins' : 'en plus'} au coût moyen` : 'sans changement de la valeur du stock';
        ecrireAuComptable(`Bonjour, j'ai fait l'inventaire du stock au ${C.fmtDate(x.date)} : ${pl(x.comptes, 'article compté', 'articles comptés')}, ${pl(x.ecarts, 'écart')}, ${effet}. Les mouvements d'inventaire sont enregistrés dans SkanFact.`);
      };
      bindPager($('#st-body'), s.inv, () => drawInventory(), '#st-body');
      $('#inv-apply').onclick = async () => {
        // Le résumé se lit AVANT les mouvements : après eux, le stock compté et le stock théorique sont les mêmes.
        const { gaps, counted, value } = etatInventaire();
        if (!gaps.length) return;
        if (licenceBlock('Créer les mouvements de cet inventaire', 'stock')) return;
        if (!await confirmDialog(`Enregistrer ${pl(gaps.length, 'mouvement')} d'inventaire au ${C.fmtDate(s.countDate)} ? Le stock théorique sera aligné sur ce que tu as compté. Cette opération est tracée dans les mouvements et se corrige comme n'importe quel ajustement.`, 'Enregistrer')) return;
        if (closedBlock(s.countDate, 'Cet inventaire')) return;
        gaps.forEach(r => data.stockAdjustments.push({ id: C.uid(), createdAt: Date.now(), date: s.countDate, itemId: r.itemId, qty: r.gap,
          unitCost: '', source: 'inventaire', reference: '', note: `Inventaire du ${C.fmtDate(s.countDate)}` }));
        // (1.284.0, revue du Stock S6) Le résumé reste à l'écran : c'est lui que « Prévenir mon comptable » envoie.
        s.dernierInventaire = { date: s.countDate, comptes: counted.length, ecarts: gaps.length, valeur: value };
        s.counts = {}; save(true); toast(`${pl(gaps.length, 'écart')} enregistré${sPl(gaps.length)}`); draw();
      };
    }

    // (1.284.0, revue du Stock S1-S3) Le geste d'un article sous son seuil est de le COMMANDER, pas de saisir sa facture
    // d'achat (on payait avant d'avoir commandé) : un bon de commande fournisseur, au fournisseur de son dernier achat, à
    // son dernier prix, pour la quantité qui ramène au « stock à atteindre ». Un stock négatif garde l'achat oublié.
    const aCommanderParFournisseur = () => {
      const groupes = new Map();
      alerts.filter(r => r.kind !== 'negatif' && r.aCommander > 0).forEach(r => {
        const f = C.fournisseurDeLArticle(data, r.itemId);
        const cle = f && supplierById(f.supplierId) ? f.supplierId : '';
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(r);
      });
      return groupes;
    };
    // Le brouillon déjà ouvert chez ce fournisseur (pas encore parti), et ce qui le complète : un article déjà sur le bon voit
    // sa quantité grandir — deux lignes « Sable lavé » sur le même bon se liraient comme deux commandes.
    const brouillonChez = cle => cle ? commandesF().find(x => x.supplierId === cle && x.status === 'brouillon' && C.statutCommandeFournisseur(data, x) === 'brouillon') : null;
    const completer = (ouvert, rows) => {
      ouvert.lines = ouvert.lines || [];
      bonDesArticles(rows, ouvert.supplierId).lines.forEach(l => { const deja = ouvert.lines.find(x => x.itemId && x.itemId === l.itemId); if (deja) deja.qty = C.round3((Number(deja.qty) || 0) + l.qty); else ouvert.lines.push(l); });
    };
    const commanderTout = () => {
      const groupes = aCommanderParFournisseur();
      if (!groupes.size) return;
      // Un seul fournisseur : son brouillon ouvert se complète et s'ouvre (1.284.2, joué à la souris : le bouton ouvrait un
      // bon neuf à côté du brouillon du même fournisseur) ; sans brouillon, le bon se prépare à l'écran.
      if (groupes.size === 1) {
        const [[cle, rows]] = [...groupes];
        const ouvert = brouillonChez(cle);
        if (!ouvert) return ouvrirBon(bonDesArticles(rows, cle));
        if (licenceBlock('Préparer les bons de commande', 'stock')) return;
        completer(ouvert, rows); save(true);
        toast(`Brouillon ${ouvert.number} complété (${pl(rows.length, 'article')}) : relis-le, puis envoie-le.`);
        return navigate('#/commandef/' + ouvert.id);
      }
      if (licenceBlock('Préparer les bons de commande', 'stock')) return;
      // Un bon par fournisseur, en brouillon et numéroté : il se relit, puis part. Les articles sans fournisseur connu font
      // un bon à part, ouvert à l'écran : le fournisseur se choisit avant de l'enregistrer.
      // Un fournisseur qui a déjà un bon en brouillon (pas encore parti) le complète : un seul bon par fournisseur (1.284.2,
      // joué à la main : le gravier commandé d'un clic, puis « tout ce qui manque », faisaient deux bons chez le même).
      let n = 0, completes = 0;
      [...groupes].filter(([cle]) => cle).forEach(([cle, rows]) => {
        const ouvert = brouillonChez(cle);
        if (ouvert) { completer(ouvert, rows); completes++; return; }
        const nouveau = bonDesArticles(rows, cle);
        nouveau.number = C.numeroSuivant(data, commandesF(), 'BCF', nouveau.date);
        commandesF().push(nouveau); n++;
      });
      save(true);
      const sans = groupes.get('');
      const fait = [n ? `${pl(n, 'bon de commande', 'bons de commande')} préparé${sPl(n)} en brouillon` : '', completes ? `${pl(completes, 'brouillon')} déjà ouvert${sPl(completes)} complété${sPl(completes)}` : ''].filter(Boolean).join(', ');
      toast(`${fait.replace(/^./, c => c.toUpperCase())}, un bon par fournisseur : relis-les, puis envoie-les.${sans ? ` Reste ${pl(sans.length, 'article')} sans fournisseur connu : choisis-le sur ce bon.` : ''}`);
      if (sans) ouvrirBon(bonDesArticles(sans, '')); else { etatCF.onglet = 'commandes'; navigate('#/commandesf'); }
    };

    function drawAlerts() {
      const alPage = paginate(alerts, s.alertes);
      const groupes = aCommanderParFournisseur();
      const nbArt = [...groupes.values()].reduce((a, x) => a + x.length, 0);
      $('#st-body').innerHTML = `
        <div class="panel"><div class="st-alertes-tete" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Ce qui demande ton attention ${info('stk.alerts')}</h2>
          ${nbArt > 1 ? `<button class="btn btn-primary btn-sm" id="st-cmd-tout">Commander tout ce qui manque (${pl(nbArt, 'article')}${groupes.size > 1 ? `, ${groupes.size} bons` : ''})</button>` : ''}</div>
          ${alerts.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Article</th><th>Problème</th><th class="r">En stock</th><th class="r">Seuil</th><th class="r">À commander</th><th></th></tr></thead><tbody>
            ${alPage.rows.map(r => `<tr class="clickable ${r.kind === 'negatif' ? 'row-warn' : ''}" data-see="${h(r.itemId)}">
              <td><strong>${h(r.label)}</strong>${r.location ? `<div class="small muted">${h(r.location)}</div>` : ''}</td>
              <td>${r.kind === 'negatif' ? '<span class="warn-text">Stock négatif — tu as vendu plus que tu n\'as acheté. Un achat manque, ou une quantité a été saisie de travers.</span>'
                : r.kind === 'rupture' ? '<span class="warn-text">Rupture : il n\'en reste plus.</span>'
                : 'Sous le seuil d\'alerte.'}${(r.enCommande || []).length ? `<div class="small muted" data-en-commande>Déjà en commande : ${r.enCommande.map(x => `${pct(x.reste)} — <a href="#/commandef/${h(x.id)}">${h(x.number || 'brouillon')}</a>`).join(', ')}</div>` : ''}</td>
              <td class="r nw">${qtyCell(r)}</td>
              <td class="r nw">${r.minStock ? pct(r.minStock) : '<span class="muted">—</span>'}</td>
              <td class="r nw">${r.kind === 'negatif' ? '<span class="muted">—</span>' : `<strong>${pct(r.aCommander)}</strong>`}</td>
              <td class="r">${/* Un seul bouton par ligne (règle 7.29.0) ; un stock négatif ne s'ajuste jamais (règle 4.0.0) : c'est
                   un achat oublié. Sous le seuil, le geste est le bon de commande (1.284.0). La ligne ouvre la fiche. */''}${r.kind === 'negatif'
                ? `<button class="btn btn-sm" data-achat="${h(r.itemId)}" data-qte="${C.round3(Math.abs(r.qty))}">Saisir l'achat oublié…</button>`
                : r.aCommander > 0 ? `<button class="btn btn-sm" data-commander="${h(r.itemId)}">Commander…</button>`
                : `<button class="btn btn-sm" data-voir-commande="${h(r.enCommande[0].id)}">Voir la commande</button>`}</td></tr>`).join('')}
          </tbody></table></div>${pagerBar(alPage.pg, { noun: 'article' })}`
            : '<div class="empty">Rien à signaler : aucun stock négatif, aucun article sous son seuil.</div>'}
        </div>`;
      bindPager($('#st-body'), s.alertes, () => drawAlerts(), '#st-body');
      // L'achat oublié d'un stock négatif : au moins ce qui manque pour revenir à zéro (1.284.2, joué à la main : 1 seau
      // proposé pour -3, le stock restait négatif après l'achat).
      $$('#st-body [data-achat]').forEach(b => b.onclick = e => { e.stopPropagation(); navigate(`#/achat/new/-/facture/-/article/${b.dataset.achat}${Number(b.dataset.qte) > 0 ? '/' + b.dataset.qte : ''}`); });
      $$('#st-body [data-commander]').forEach(b => b.onclick = e => {
        e.stopPropagation();
        ouvrirBonArticle(b.dataset.commander);
      });
      if ($('#st-cmd-tout')) $('#st-cmd-tout').onclick = commanderTout;
      $$('#st-body [data-voir-commande]').forEach(b => b.onclick = e => { e.stopPropagation(); navigate('#/commandef/' + b.dataset.voirCommande); });
      $$('#st-body [data-en-commande] a').forEach(a2 => a2.onclick = e => e.stopPropagation());
      $$('#st-body tr[data-see]').forEach(tr => tr.onclick = () => navigate('#/article/' + tr.dataset.see));
    }

    function drawSerials() {
      const serialized = C.serializedItems(data);
      const q = s.ser.q.trim().toLowerCase();
      const all = C.serialList(data, { status: s.ser.status })
        .filter(x => !q || C.correspondRecherche(`${x.serial || ''} ${x.itemLabel || ''} ${x.clientName || ''}`, q));
      const paged = paginate(all, s.ser);
      const gaps = C.serialGaps(data);
      $('#st-body').innerHTML = `
        ${gaps.length ? `<div class="panel" style="border-inline-start:3px solid var(--warning)"><h2>Les deux comptes ne disent pas la même chose ${info('ser.gap')}</h2>
          <p class="small">${gaps.map(g => `<b>${h(g.label)}</b> : ${pct(g.qty)} en stock, ${pl(g.serials, 'numéro')} disponible${sPl(g.serials)}`).join(' · ')}. Un numéro n'a pas été saisi à l'entrée, ou pas attribué à la sortie.</p></div>` : ''}
        <div class="panel"><h2>Numéros de série ${info('ser.list')}</h2>
          ${serialized.length ? `<div class="filters">
            <input type="search" id="se-q" placeholder="Rechercher : numéro, article, client…" value="${h(s.ser.q)}">
            <select id="se-st"><option value="">Tous les états</option>${C.SERIAL_STATUSES.map(([v, l]) => `<option value="${v}" ${s.ser.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span class="small muted">${pl(all.length, 'numéro')}</span>
          </div>
          ${all.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Numéro</th><th>Article</th><th>État</th><th>Entré le</th><th>Client</th><th>Livré le</th><th>Garantie</th><th></th></tr></thead><tbody>
            ${paged.rows.map(x => `<tr>
              <td><strong>${h(x.serial)}</strong></td><td>${h(x.itemLabel)}</td>
              <td>${h(C.serialStatusLabel(x.status))}</td>
              <td class="nw">${C.fmtDate(x.inDate)}</td>
              <td>${x.clientId ? `<a href="#/client/${h(x.clientId)}">${h(x.clientName)}</a>` : '<span class="muted">—</span>'}</td>
              <td class="nw">${x.outDate ? C.fmtDate(x.outDate) : '<span class="muted">—</span>'}</td>
              <td class="nw">${!x.warrantyEndDate ? '<span class="muted">—</span>'
                : x.expired ? `<span class="muted">expirée le ${C.fmtDate(x.warrantyEndDate)}</span>`
                : `<span class="${x.warrantyEndingSoon ? 'warn-text' : 'ok-text'}">jusqu'au ${C.fmtDate(x.warrantyEndDate)}</span>`}</td>
              <td class="r"><button class="btn btn-sm" data-ser="${h(x.id)}">Modifier</button></td></tr>`).join('')}
          </tbody></table></div>
          ${paged.pg ? pagerBar(paged.pg, { noun: 'numéro' }) : ''}`
            : '<div class="empty">Aucun numéro ne correspond.</div>'}`
            : `<div class="empty">
                <p><b>Aucun article n'est suivi par numéro de série.</b> C'est utile pour du matériel garanti :
                tu sauras qui a quoi, depuis quand, et jusqu'à quand c'est couvert.</p>
                <div class="inline" style="justify-content:center;margin-top:10px">
                  ${data.catalog.length ? '<button class="btn btn-primary" id="ser-pick">Choisir un article à suivre…</button>' : ''}
                  <button class="btn${data.catalog.length ? ' btn-ghost' : ' btn-primary'}" id="ser-new">+ Nouvel article suivi</button>
                </div></div>`}
        </div>`;
      if ($('#se-q')) $('#se-q').oninput = e => { s.ser.q = e.target.value; s.ser.page = 1; sansPerdreLaFrappe(e.target, drawSerials); };
      if ($('#se-st')) $('#se-st').onchange = e => { s.ser.status = e.target.value; s.ser.page = 1; drawSerials(); };
      // L'état vide expliquait le geste en prose et laissait retraverser l'application de mémoire.
      if ($('#ser-pick')) $('#ser-pick').onclick = () => choisirArticleASuivre(() => render());
      // « + Nouvelle prestation suivie » ouvrait une fiche VIERGE, cases décochées : le bouton promettait
      // un suivi que le formulaire ne posait pas (10.12.0, H-E27). La fiche arrive suivie, par numéro.
      if ($('#ser-new')) $('#ser-new').onclick = () => catalogForm(articleNeuf({ tracked: true, serialized: true }), it => { if (it) render(); }, { creation: true, titre: 'Nouvel article suivi par numéro' });
      $$('#st-body [data-ser]').forEach(b => b.onclick = () => { const x = data.serials.find(y => y.id === b.dataset.ser); if (x) serialForm(x, () => draw()); });
      bindPager($('#st-body'), s.ser, () => drawSerials(), '#st-body');
    }

    const bindStHead = () => {
      if ($('#st-adj')) $('#st-adj').onclick = () => adjustForm(null, () => draw());
      if ($('#se-add')) $('#se-add').onclick = () => serialIntakeForm(null, () => draw());
      $('#st-war').onclick = () => navigate('#/garanties');
      // Les dépôts (brique 94) : le principal se renomme ; les autres s'ajoutent. Un dépôt qui a du stock ne se retire pas.
      if ($('#st-depots')) $('#st-depots').onclick = () => {
        const lignes = C.depotsDe(data).map(d => ({ ...d }));
        modal(`<h2>Dépôts ${info('dep.depots')}</h2>
          <p class="small muted">Là où ta marchandise est rangée. Tant qu'il n'y en a qu'un, SkanFact n'en parle pas.</p>
          <div id="dep-lignes"></div>
          <button type="button" class="btn btn-sm mt" id="dep-add">+ Dépôt</button>
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="dep-ok">Enregistrer</button></div>`,
        (root, fermer) => {
          const dessiner = () => {
            $('#dep-lignes', root).innerHTML = lignes.map((d, i) => `<label class="field">${i === 0 ? 'Dépôt principal' : 'Dépôt'}<input type="text" data-dep="${i}" value="${h(d.nom)}" placeholder="Magasin de Sfax"></label>`).join('');
            $$('[data-dep]', root).forEach(el => { el.oninput = () => { lignes[Number(el.dataset.dep)].nom = el.value; }; });
          };
          dessiner();
          $('#dep-add', root).onclick = () => { lignes.push({ id: C.uid(), nom: '' }); dessiner(); $$('[data-dep]', root).pop().focus(); };
          $('#dep-ok', root).onclick = () => {
            const noms = lignes.map(d => String(d.nom || '').trim());
            if (noms.slice(1).some(n => !n)) return toast('Donne un nom à chaque dépôt (ou n\'ajoute pas celui qui reste vide).', true);
            if (new Set(noms.map(n => n.toLowerCase())).size !== noms.length) return toast('Deux dépôts portent le même nom : un nom désigne un seul dépôt.', true);
            data.depotPrincipalNom = noms[0] === 'Dépôt principal' ? '' : noms[0];
            data.depots = lignes.slice(1).map((d, i) => ({ id: d.id, nom: noms[i + 1] }));
            save(true); fermer(); toast('Dépôts enregistrés'); render(true);
          };
        });
      };
      if ($('#st-csv')) $('#st-csv').onclick = exportStock;
      if ($('#st-new')) $('#st-new').onclick = () => catalogForm(articleNeuf({ tracked: true }), it => { if (it) render(); }, { creation: true, titre: 'Nouvel article suivi' });
      if ($('#st-pick')) $('#st-pick').onclick = () => choisirArticleAStocker(it => { if (it) render(); });
    };
    const draw = dansUnLot(() => {
      $('#st-head').innerHTML = stHead(); bindStHead(); poserGuideMoi();
      if (!items.length) { $('#st-body').innerHTML = ''; return; }
      drawResume();
      if (s.tab === 'series') return drawSerials();
      if (s.tab === 'mouvements') return drawMoves();
      relireAlertes();
      if (s.tab === 'inventaire') return drawInventory();
      if (s.tab === 'alertes') return drawAlerts();
      drawState();
    });
    $$('#st-tabs button').forEach(b => b.onclick = () => {
      s.tab = b.dataset.tab;
      marquerOnglet();
      draw();
    });
    // Le bouton exportait l'état du stock quel que soit l'onglet ouvert : depuis « Mouvements », on
    // demandait le journal et on recevait l'inventaire, sans un mot. Un export suit ce qu'on regarde.
    const ST_EXPORTS = {
      etat: () => ({
        nom: `stock-${C.today()}.csv`, rows: C.stockTotals(data).rows, cols: [
          { key: 'label', label: 'Article' }, { key: 'location', label: 'Emplacement' },
          { key: 'qty', label: 'En stock' }, { key: 'unit', label: 'Unité' },
          { key: 'minStock', label: 'Seuil' }, { key: 'cmp', label: 'Coût moyen', type: 'money' },
          { label: 'Valeur', type: 'money', get: r => Math.max(0, r.value) },
          { key: 'unitPrice', label: 'Prix de vente', type: 'money' }]
      }),
      mouvements: () => ({
        nom: `mouvements-stock-${s.year}.csv`,
        rows: C.stockJournal(data, { from: `${s.year}-01-01`, to: `${s.year}-12-31` }), cols: [
          { key: 'date', label: 'Date', type: 'date' }, { key: 'label', label: 'Article' },
          { label: 'Origine', get: m => C.moveSourceLabel(m.source) }, { key: 'ref', label: 'Référence' },
          { key: 'note', label: 'Note' }, { key: 'qty', label: 'Quantité' },
          { key: 'unitApplied', label: 'Coût unitaire', type: 'money' }, { key: 'qtyAfter', label: 'Stock après' }]
      }),
      series: () => ({
        nom: `numeros-serie-${C.today()}.csv`, rows: C.serialList(data, { status: s.ser.status }), cols: [
          { key: 'serial', label: 'Numéro' }, { key: 'itemLabel', label: 'Article' },
          { label: 'Statut', get: x => C.serialStatusLabel(x.status) }, { key: 'clientName', label: 'Client' },
          { key: 'inDate', label: 'Entrée', type: 'date' }, { key: 'outDate', label: 'Sortie', type: 'date' },
          { key: 'warrantyEndDate', label: 'Fin de garantie', type: 'date' }]
      }),
      inventaire: () => ({
        nom: `inventaire-${s.countDate}.csv`, rows: C.inventoryDiff(data, s.counts, s.countDate), cols: [
          { key: 'label', label: 'Article' }, { key: 'unit', label: 'Unité' },
          { key: 'book', label: 'Selon SkanFact' }, { key: 'counted', label: 'Compté' },
          { key: 'gap', label: 'Écart' }, { key: 'value', label: 'Valeur de l\'écart', type: 'money' }]
      }),
      alertes: () => ({
        nom: `a-recommander-${C.today()}.csv`, rows: C.stockAlerts(data), cols: [
          { key: 'label', label: 'Article' }, { key: 'location', label: 'Emplacement' },
          { key: 'kind', label: 'Problème' }, { key: 'qty', label: 'En stock' },
          { key: 'minStock', label: 'Seuil' },
          { label: 'À commander', get: r => r.kind === 'negatif' ? '' : r.aCommander }]
      })
    };
    async function exportStock() {
      const e = (ST_EXPORTS[s.tab] || ST_EXPORTS.etat)();
      if (!e.rows.length) return toast('Rien à exporter dans cet onglet.', true);
      const f = await bridge.saveText(e.nom, C.toCsv(e.rows, e.cols));
      if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
    };
    draw();
  };

  // (1.284.0, revue du Stock S4-S5) La fiche d'un article dans la nouvelle DA : chemin, titre, phrase, quatre chiffres, et ce
  // qui décide d'une commande — d'où il vient (le dernier achat : fournisseur, prix, date) et combien il se vend (12 mois).
  // L'historique des mouvements se pagine (règle des listes) ; un seul bouton principal : l'étape suivante.
  const ficheArticle = { id: '', page: 1 };
  routes.article = (parts) => {
    const item = data.catalog.find(c => c.id === parts[0]);
    if (!item) return navigate('#/stock');
    if (ficheArticle.id !== item.id) Object.assign(ficheArticle, { id: item.id, page: 1 });
    const cur = company().currency;
    const st = C.stockOf(data, item.id);
    const moves = st.moves.slice().reverse();
    const alerte = item.tracked ? C.stockAlerts(data).find(r => r.itemId === item.id) : null;
    const dernier = C.fournisseurDeLArticle(data, item.id);
    const fourn = dernier ? supplierById(dernier.supplierId) : null;
    const t = C.today();
    const ilYaUnAn = new Date(Date.parse(t) - 365 * 86_400_000).toISOString().slice(0, 10);
    const vendu = C.ventesDeLArticle(data, company(), item.id, ilYaUnAn, t);
    const unite = q => st.unit ? ' ' + h(C.uniteAccordee(q, st.unit)) : '';
    const principal = alerte && alerte.kind === 'negatif' ? ['art-achat', 'Saisir l\'achat oublié…'] : alerte && alerte.aCommander > 0 ? ['art-commander', 'Commander…'] : ['adj-item', '+ Mouvement'];
    const enCmd = alerte && alerte.enCommande ? alerte.enCommande.reduce((a, x) => a + x.reste, 0) : 0;
    const bouton = (id, txt) => `<button class="btn ${principal[0] === id ? 'btn-primary' : ''}" id="${id}">${txt}</button>`;
    const chiffreA = (lbl2, val, sous, ton, aide) => `<div class="mg-chiffre"><span class="mu">${lbl2}${aide ? ' ' + info(aide) : ''}</span><b class="${ton || ''}">${val}</b><small>${sous}</small></div>`;
    const marge = C.round3(st.unitPrice - st.cmp);
    $('#view').innerHTML = `
      <div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<a href="#/stock">Stock</a>${ICONE_CHEVRON}<span>${h(item.label)}</span></div>
        <h1>${h(item.label)}</h1>
        <p class="sous">${[item.code ? 'réf. ' + h(item.code) : '', item.location ? h(item.location) : '', item.unit ? 'unité : ' + h(item.unit) : '', item.tracked ? 'suivi en stock' : 'non suivi en stock'].filter(Boolean).join(' · ')}</p></div>
        <div class="actions">${backButton('#/stock')}<button class="btn" id="edit-item">Modifier l'article</button>
          ${C.depotsDe(data).length > 1 ? '<button class="btn" id="transfert">Transférer…</button>' : ''}
          ${principal[0] !== 'adj-item' ? bouton(principal[0], principal[1]) : ''}${bouton('adj-item', '+ Mouvement')}</div></div>
      <div class="lf mg ca art">
      ${C.depotsDe(data).length > 1 ? `<p class="small mb" id="art-depots">Par dépôt ${info('dep.depots')} : ${C.stockParDepot(data, item.id).map(x => `<b>${h(x.nom)}</b> ${pct(x.qty)}${unite(x.qty)}`).join(' · ')}</p>` : ''}
      ${item.parLot ? `<p class="small mb" id="art-lots">Par lot ${info('lot.parLot')} : ${C.stockParLot(data, item.id).map(x => `<b>${h(x.lot || 'sans lot')}</b> ${pct(x.qty)}${unite(x.qty)}${x.peremption ? ` <span class="${x.peremption < C.today() ? 'warn-text' : 'muted'}">(${x.peremption < C.today() ? 'périmé le' : 'périme le'} ${C.fmtDate(x.peremption)})</span>` : ''}`).join(' · ') || 'rien en stock'}</p>` : ''}
      ${st.negative ? `<div class="panel" style="border-inline-start:3px solid var(--danger)"><h2 style="color:var(--danger)">Stock négatif</h2>
        <p class="small">D'après les pièces saisies, il en reste <b>${pct(st.qty)}</b> — ce qui est impossible. Il manque une entrée : un achat non saisi, une quantité mal recopiée, ou un stock de départ oublié. Corrige la pièce en cause plutôt que d'ajuster, sinon l'erreur restera dans les chiffres.</p></div>` : ''}
      <div class="cf-carte mg-resume" id="art-resume">${chiffreA('En stock', `${pct(st.qty)}${unite(st.qty)}`,
          alerte && alerte.kind !== 'negatif' ? `seuil ${pct(st.minStock)} — ${alerte.aCommander > 0 ? `${pct(alerte.aCommander)} à commander` : ''}${alerte.aCommander > 0 && enCmd ? ' · ' : ''}${enCmd ? `${pct(enCmd)} en commande` : ''}` : st.minStock ? `seuil d'alerte : ${pct(st.minStock)}` : 'aucun seuil défini',
          st.negative || (alerte && alerte.kind === 'rupture') ? 'rouge' : alerte ? 'ambre' : '', 'stk.min')
        + chiffreA('Coût moyen pondéré', montantU(st.cmp, cur), 'recalculé à chaque entrée', '', 'stk.cmp')
        + chiffreA('Valeur du stock', montantU(Math.max(0, st.value), cur), 'au coût moyen')
        + chiffreA('Marge unitaire', montantU(marge, cur), `vendu ${C.money(st.unitPrice, cur)} HT`, marge < 0 ? 'rouge' : 'vert')}</div>
      <div class="cf-carte" id="art-decide" style="padding:14px 18px"><div class="grid-2">
        <div id="art-dernier-achat"><div class="mu small">Dernier achat ${info('stk.dernierAchat')}</div>
          ${dernier ? `<p><b>${fourn ? `<a href="#/fournisseur/${h(fourn.id)}">${h(fourn.name)}</a>` : 'Fournisseur supprimé'}</b> · ${C.money(dernier.unitCost, cur)} HT l'unité · le ${C.fmtDate(dernier.date)}
            · <a href="${dernier.source === 'achat' ? '#/achat/' : '#/reception/'}${h(dernier.docId)}">${h(dernier.ref) || 'voir la pièce'}</a></p>`
            : `<p class="muted">Aucun achat ni réception de cet article : le premier bon de commande demandera le fournisseur.</p>`}</div>
        <div id="art-vendu"><div class="mu small">Vendu sur 12 mois ${info('stk.vendu12')}</div>
          ${vendu.pieces ? `<p><b>${pct(vendu.qty)}${unite(vendu.qty)}</b> · ${C.money(vendu.ht, cur)} HT · sur ${pl(vendu.pieces, 'facture')}</p>`
            : '<p class="muted">Aucune vente facturée depuis un an.</p>'}</div>
      </div></div>
      <div class="cf-carte" style="padding:14px 18px"><h2>Historique des mouvements</h2><div id="art-hist"></div></div>
      </div>`;
    const drawHist = () => {
      const pg = paginate(moves, ficheArticle);
      $('#art-hist').innerHTML = moves.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
          <th>Date</th><th>Origine</th><th>Référence</th><th class="r">Quantité</th><th class="r">Coût unitaire</th><th class="r">Stock après</th><th class="r">Coût moyen après</th><th></th></tr></thead><tbody>
          ${pg.rows.map(m => `<tr>
            <td class="nw">${C.fmtDate(m.date)}</td>
            <td>${h(C.moveSourceLabel(m.source))}${m.note ? `<div class="small muted">${h(m.note)}</div>` : ''}</td>
            <td class="nw">${m.docId ? `<a href="${m.source === 'achat' ? '#/achat/' : m.source === 'reception' ? '#/reception/' : '#/doc/'}${h(m.docId)}">${h(m.ref) || 'voir'}</a>` : (h(m.ref) || '<span class="muted">—</span>')}${C.depotsDe(data).length > 1 ? `<div class="small muted" data-depot>${h(C.nomDepot(data, m.depotId))}</div>` : ''}</td>
            <td class="r nw ${m.qty < 0 ? 'warn-text' : 'ok-text'}"><strong>${qteSignee(m.qty)}</strong></td>
            <td class="r nw">${C.money(m.unitApplied, cur)}</td>
            <td class="r nw ${m.qtyAfter < 0 ? 'warn-text' : ''}">${pct(m.qtyAfter)}</td>
            <td class="r nw">${C.money(m.cmpAfter, cur)}</td>
            <td class="r">${m.manual ? `<button class="btn btn-sm btn-ghost" data-rm="${h(m.id)}" title="Supprimer ce mouvement">✕</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>${pagerBar(pg.pg, { noun: 'mouvement' })}`
        : '<div class="empty">Aucun mouvement. Le stock bougera dès qu\'un achat en destination « stock » ou une vente portera cet article.</div>';
      bindPager($('#art-hist'), ficheArticle, drawHist, '#art-hist');
      bindRm();
    };
    bindBack('#/stock');
    $('#edit-item').onclick = () => catalogForm(item, () => render());
    $('#adj-item').onclick = () => adjustForm(item.id, () => render());
    // Transférer d'un dépôt à l'autre (brique 94) : deux mouvements, sans coût ; ce que le dépôt n'a pas se refuse.
    if ($('#transfert')) $('#transfert').onclick = () => {
      const deps = C.depotsDe(data);
      const opts = sel => deps.map(d => `<option value="${h(d.id)}" ${d.id === sel ? 'selected' : ''}>${h(d.nom)}</option>`).join('');
      modal(`<h2>Transférer « ${h(item.label)} »</h2>
        <form id="tr-form" class="grid-2" onsubmit="return false">
          <label class="field">De<select name="de">${opts(deps[0].id)}</select></label>
          <label class="field">Vers<select name="vers">${opts(deps[1].id)}</select></label>
          <label class="field">Quantité${item.unit ? ` (${h(item.unit)})` : ''}<input type="number" name="qty" step="any" min="0" class="num"></label>
          ${dateFieldHtml('Date', 'date', C.today())}
          <label class="field span-2">Note (optionnel)<input type="text" name="note" placeholder="Réassort du magasin"></label>
        </form>
        <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="tr-ok">Transférer</button></div>`,
      (root, fermer) => {
        $('#tr-ok', root).onclick = () => {
          const v = formValues($('#tr-form', root));
          const r = C.transfertStock(data, { id: C.uid(), itemId: item.id, de: v.de, vers: v.vers, qty: v.qty, date: v.date || C.today(), note: String(v.note || '').trim() });
          if (r.erreur) return toast(r.erreur, true);
          data.stockAdjustments = data.stockAdjustments || [];
          r.ajustements.forEach(a => data.stockAdjustments.push(a));
          save(true); fermer(); toast(`Transféré : ${pct(Number(v.qty))} de ${C.nomDepot(data, v.de)} vers ${C.nomDepot(data, v.vers)}.`); render(true);
        };
      });
    };
    function bindRm() { $$('#art-hist [data-rm]').forEach(b => b.onclick = async () => {
      // Un transfert (brique 94) : ses deux mouvements partent ensemble, sinon un dépôt garderait ce que l'autre a rendu.
      const cible = (data.stockAdjustments || []).find(x => x.id === b.dataset.rm);
      const paire = cible && cible.transfertId ? (data.stockAdjustments || []).filter(x => x.transfertId === cible.transfertId) : [];
      if (!await confirmDialog(paire.length > 1 ? 'Supprimer ce transfert ? Ses deux mouvements (la sortie et l\'entrée) partent ensemble.' : 'Supprimer ce mouvement saisi à la main ?')) return;
      const gone3 = cible;
      if (gone3 && closedBlock(gone3.date, 'Ce mouvement de stock')) return;
      const ids = paire.length > 1 ? paire.map(x => x.id) : [b.dataset.rm];
      ids.forEach(id => forget('stockAdjustments', id, item.label));
      data.stockAdjustments = data.stockAdjustments.filter(x => !ids.includes(x.id));
      save(true); render();
    }); }
    drawHist();
    if ($('#art-commander')) $('#art-commander').onclick = () => ouvrirBonArticle(item.id);
    if ($('#art-achat')) $('#art-achat').onclick = () => navigate(`#/achat/new/-/facture/-/article/${item.id}/${C.round3(Math.abs(st.qty))}`);
  };

  // ---------- validation de ce qui a été lu sur la photo (4.2.0) ----------
  // C'est ici que se joue la règle la plus importante du module : l'application ne remplit jamais toute
  // seule. Elle montre ce qu'elle a cru lire, signale ce qui ne colle pas, et attend un clic.
  // `o.source` vaut 'teif' pour une facture électronique (H1) : la même relecture, mais ce qui a été lu
  // est EXACT (un XML ne se devine pas) et ses remarques sont celles du recomptage, pas d'une machine.
  function ocrReviewForm(read, file, done, o) {
    o = o || {};
    // Où chaque champ a été lu sur la pièce (brique 84 ; 14 § 2.3) : la ligne lue, en petit sous le champ,
    // en entier (elle passe à la ligne sur un téléphone : c'est elle qui dit d'où vient le chiffre).
    const luIci = (...cles) => {
      const lu = cles.map(k => o.ou && o.ou[k]).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
      return lu ? `<span class="small muted lu-ici" title="${h(lu)}" style="display:block;margin-top:3px;overflow-wrap:anywhere">Lu : « ${h(lu)} »</span>` : '';
    };
    const ici = (html, k) => { const s = luIci(k); return s ? html.replace(/<\/(label|div)>\s*$/, `${s}</$1>`) : html; };
    const teif = o.source === 'teif';
    const cur = (read && read.currency && C.normCurrency(read.currency)) || company().currency;
    // Toute la normalisation (nombres, dates, reconnaissance du fournisseur, avertissements) vit dans
    // core.js : elle est testable sans Electron, ce qui compte quand on manipule ce qu'une machine a cru lire.
    const prep = C.ocrToPurchase(read, data);
    // `o.categorie` : celle déjà choisie sur la page de lecture (elle ne se perd pas en passant à la vérification).
    const head = { ...prep.head, category: o.categorie || '' };
    const lines = prep.lines;

    const computed = () => C.round3(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
    const gapHT = () => prep.readHT == null ? null : C.round3(computed() - prep.readHT);

    const autre = head.kind === 'avoir' && head.refFacture
      ? data.purchases.find(x => x.kind !== 'avoir' && x.number === head.refFacture && (!head.supplierId || x.supplierId === head.supplierId)) : null;
    // (1.163.0, maquette achat « Vérifier case par case ») La pièce à gauche, chaque case à droite avec ce qui a été lu dessous,
    // le contrôle qui se refait à chaque frappe, le geste au pied. Elle remplace la fenêtre « Ce que SkanFact a lu » : ses
    // phrases en vrac, une liste qui sortait du cadre, des euros comptés en millimes (vu par Skander le 27/10/2026).
    const base = C.normCurrency(company().currency);
    const enDevise = cur !== base;
    const millieme = C.decimalsFor(cur) === 3;
    const fichierVu = file && file.path && bridge.fichierALire ? bridge.fichierALire(file.path) : null;
    const urlVue = fichierVu && /^image\//.test(fichierVu.type || '') ? URL.createObjectURL(fichierVu) : '';
    const pdfVu = fichierVu && /pdf/i.test(fichierVu.type || '') && bridge.apercuPdf;
    const docHtml = urlVue ? `<img src="${urlVue}" alt="${h(file.name)}">` : pdfVu ? '<span class="small muted">La première page se prépare…</span>' : `<span class="vc-sans">${lfIc(teif ? 'piece' : 'photo', 28)}<b>${h(file.name)}</b><small>${teif ? 'chaque montant vient du fichier signé' : 'la pièce n\'est plus là pour la montrer'}</small></span>`;
    modal(`<div class="vc-tete"><h2>${teif ? (head.kind === 'avoir' ? 'La facture d\'avoir électronique' : 'La facture électronique') + (head.number ? ' ' + h(head.number) : '') : 'Vérifier case par case'}</h2>
        <span class="small muted">${h(file.name)} · ${teif ? 'lue sans rien envoyer nulle part, chaque montant recompté · ' : ''}rien n'entre dans tes données avant « Remplir la pièce »</span></div>
      <div class="vc-corps"><div class="vc-doc" id="vc-doc">${docHtml}</div>
      <div class="vc-form">
      <form id="orf">
        <section class="vc-g"><h4>Le fournisseur</h4>
        <div class="field obligatoire">${lbl('Fournisseur', 'ocr.supplier')}
          ${combo({ name: 'supplierId', value: head.supplierId, items: fournisseursEnService(head.supplierId).map(x => ({ v: x.id, label: x.name, sub: x.matricule || '', text: `${x.name} ${x.matricule || ''}` })), placeholder: '— À choisir —', search: 'Rechercher un fournisseur…', add: head.supplierName && !head.supplierId ? `+ Créer « ${h(head.supplierName)} »` : '+ Nouveau fournisseur' })}${luIci('supplier', 'matricule')}
        </div></section>
        <section class="vc-g"><h4>La pièce</h4>
        <div class="vc-2">${ici(field(lbl('Numéro de la facture', 'buy.number'), 'number', head.number, 'text', ''), 'number')}
        ${ici(dateFieldHtml(lbl('Date', 'buy.date'), 'date', head.date, { obligatoire: true }), 'date')}</div>
        <div class="vc-2">${ici(dateFieldHtml(lbl('Échéance', 'buy.due'), 'dueDate', head.dueDate, { clearable: true }), 'dueDate')}
        <div class="field">${lbl('Catégorie de charge', 'buy.category')}
          ${combo({ name: 'category', value: head.category, items: C.expenseCategories(data).map(c => ({ v: c, label: c })), placeholder: '— À choisir —', search: 'Rechercher une catégorie…' })}
        </div></div>
        ${enDevise ? `<label class="field vc-devise">${lbl('Devise', 'buy.currency')}<span class="vc-taux">${h(symboleDevise(cur))} · 1 ${h(symboleDevise(cur))} = <input type="number" name="exchangeRate" class="num" step="0.0001" min="0" placeholder="taux" aria-label="Taux de change : 1 ${h(cur)} en ${h(base)}"> ${h(base)}</span><span class="small muted lu-ici">lue sur la pièce · le taux du jour de la pièce, À VÉRIFIER avec ton cabinet</span></label>` : ''}
        <div class="vc-2">${ici(field(lbl(`Timbre et frais (${h(symboleDevise(cur))})`, 'buy.fees'), 'fees', head.fees, 'number', `step="${millieme ? '0.001' : '0.01'}" min="0" class="num"`), 'fees')}
        ${ici(`<label class="field">${lbl('Objet', 'buy.subject')}<input type="text" name="subject" value="${h(head.subject)}"></label>`, 'subject')}</div></section>
      </form>
      <section class="vc-g"><h4>Les lignes <small>· ${h(symboleDevise(cur))}, au ${millieme ? 'millime' : 'centime'}</small></h4>
        <table class="lines-edit buy-lines"><thead><tr><th>Désignation</th><th class="r" style="width:70px">Qté</th><th class="r" style="width:100px">P.U. HT</th><th style="width:80px">TVA</th><th class="r" style="width:118px">Total HT</th><th></th></tr></thead>
          <tbody id="orf-lines"></tbody></table>
        <div class="inline mt"><button type="button" class="btn btn-sm" id="orf-add">+ Ligne</button>
          <span class="small muted" id="orf-sum"></span></div></section>
      <section class="vc-g"><h4>Le contrôle <small>· se refait à chaque frappe</small></h4><div id="ocr-warn"></div></section>
      </div></div>
      <div class="vc-pied"><span class="small muted" id="vc-reste"></span><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">${lfIc('coche', 15, 2.4)}Remplir la pièce</button></div>`,
      (root, close) => {
        const supCombo = bindCombo($('[data-combo=supplierId]', root), {
          items: fournisseursEnService(head.supplierId).map(x => ({ v: x.id, label: x.name, text: x.name })), placeholder: '— À choisir —',
          onAdd: saisi => supplierForm(null, sup => {
            supCombo.setItems(fournisseursEnService(sup.id).map(x => ({ v: x.id, label: x.name, text: x.name })));
            supCombo.setValue(sup.id);
          }, head.supplierName && !head.supplierId ? Object.assign({ name: saisi || head.supplierName, matricule: head.matricule || '' },
            // Une facture électronique porte aussi l'adresse et les contacts du fournisseur : la fiche naît complète.
            teif && read.fournisseur ? { address: read.fournisseur.adresse || '', phone: read.fournisseur.telephone || '', email: read.fournisseur.email || '' } : {}) : { name: saisi })
        });
        bindCombo($('[data-combo=category]', root), { items: C.expenseCategories(data).map(c => ({ v: c, label: c })), placeholder: '— À choisir —' });
        bindDateFields(root);
        if (pdfVu) bridge.apercuPdf(fichierVu, 900).then(r => { const z = $('#vc-doc', root); if (z) z.innerHTML = r ? `<img src="${r.adresse}" alt="Première page de « ${h(file.name)} »">${r.pages > 1 ? `<p class="small muted">Page 1 sur ${r.pages}</p>` : ''}` : '<span class="small muted">Ce PDF ne se montre pas ici.</span>'; });

        // (1.163.0) Ce que le contrôle laisse à revoir en remplissant la pièce : la phrase « elles restent en ambre sur la pièce »
        // se tient (la pièce le dit dans son bandeau « Lue par l'IA »).
        let ctlCourant = [], justeCourant = false;
        const drawLines = () => {
          $('#orf-lines', root).innerHTML = lines.map((l, i) => `<tr data-i="${i}">
            <td><input type="text" data-k="label" value="${h(l.label)}"></td>
            <td><input type="number" class="num" data-k="qty" value="${l.qty}" step="0.01"></td>
            <td><input type="number" class="num" data-k="unitPrice" value="${l.unitPrice}" step="${millieme ? '0.001' : '0.01'}"></td>
            <td><select data-k="vatRate">${C.VAT_RATES.map(r => `<option value="${r}" ${Number(l.vatRate) === r ? 'selected' : ''}>${r}%</option>`).join('')}</select></td>
            <td class="total">${argentLu(C.round3(l.qty * l.unitPrice), cur)}</td>
            <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-rm="${i}" title="Supprimer">✕</button></td></tr>`).join('');
          $$('[data-k]', $('#orf-lines', root)).forEach(el => el.oninput = el.onchange = () => {
            const i = Number(el.closest('tr').dataset.i);
            lines[i][el.dataset.k] = el.type === 'number' || el.dataset.k === 'vatRate' ? Number(el.value) : el.value;
            drawLines();
          });
          $$('[data-rm]', $('#orf-lines', root)).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.rm), 1); if (!lines.length) lines.push({ label: '', qty: 1, unit: '', unitPrice: 0, vatRate: 19, destination: 'charge', deductible: true }); drawLines(); });
          const g = gapHT();
          $('#orf-sum', root).innerHTML = `Total des lignes : <b>${argentLu(computed(), cur)}</b> HT`
            + (prep.readHT != null ? ` · total lu sur la pièce : ${argentLu(prep.readHT, cur)}` : '') + luIci('totalHT');
          const taux = $('[name=exchangeRate]', root);
          if (taux && taux.closest('.vc-taux')) taux.closest('.vc-taux').classList.toggle('ok', Number(taux.value) > 0);
          const ctl = [
            ['Le fournisseur', !!$('input[name=supplierId]', root).value, $('input[name=supplierId]', root).value ? 'choisi' : 'aucun reconnu : choisis-le, ou crée-le depuis la liste'],
            ['Le total', g == null || Math.abs(g) <= 0.005, g == null ? `lignes : ${argentLu(computed(), cur)} HT, aucun total lu pour comparer` : Math.abs(g) <= 0.005 ? `recalculé ${argentLu(computed(), cur)} = total lu ${argentLu(prep.readHT, cur)} HT, au ${millieme ? 'millime' : 'centime'}` : `les lignes font ${argentLu(computed(), cur)}, la pièce dit ${argentLu(prep.readHT, cur)} : un écart de ${argentLu(g, cur)}`],
            ...(!read.number ? [['Le numéro', !!($('[name=number]', root).value || '').trim(), 'obligatoire pour déduire la TVA : saisis-le']] : []),
            ...(enDevise ? [['La devise', !!(taux && Number(taux.value) > 0), taux && Number(taux.value) > 0 ? `1 ${symboleDevise(cur)} = ${taux.value} ${base}` : `en ${cur} : le taux de change, ci-dessus, avant d'enregistrer`]] : []),
            ...(head.kind === 'avoir' && head.refFacture && !autre ? [['La facture corrigée', false, `${head.refFacture} n'est pas dans tes achats : l'avoir sera enregistré sans y être rattaché`]] : []),
            // Ce que le serveur a remarqué en lisant (le destinataire, la devise, le total) : redit ici, une ligne chacun.
            // (Le total lu et la devise ont déjà leur ligne, refaite à chaque frappe.)
            ...(o.remarques || []).filter(m => !/^La pièce est en [A-Z]{3}|^Recompt/i.test(m)).map(m => [/matricule/i.test(m) ? 'Le destinataire' : 'La lecture', /celui de la pièce|tombe juste/i.test(m), m])
          ];
          $('#ocr-warn', root).innerHTML = ctl.map(([n, ok, t]) => `<div class="ac-lec-l ${ok ? 'sur' : 'douteux'}"><span class="st">${ok ? lfIc('coche', 12, 3) : '!'}</span><span class="n">${h(n)}</span><span class="v"><span class="vt">${h(t)}</span></span></div>`).join('');
          ctlCourant = ctl; justeCourant = g != null && Math.abs(g) <= 0.005;
          const reste = ctl.filter(x => !x[1]).length;
          $('#vc-reste', root).textContent = reste ? `${pl(reste, 'case')} à revoir : ${reste > 1 ? 'elles restent' : 'elle reste'} en ambre sur la pièce` : 'Tout est vérifié';
        };
        drawLines();
        $('#orf-add', root).onclick = () => { lines.push({ label: '', qty: 1, unit: '', unitPrice: 0, vatRate: 19, destination: 'charge', deductible: true }); drawLines(); };
        $('#orf', root).oninput = $('#orf', root).onchange = drawLines;
        $('#ok', root).onclick = () => {
          const v = formValues($('#orf', root));
          if (!v.supplierId) return refus($('[name=supplierId]', root), 'Choisis le fournisseur : sans lui, l\'achat n\'est rattaché à personne.');
          close();
          const extra = teif ? {
            kind: head.kind, achatLie: autre ? autre.id : '',
            ...(head.currency && head.currency !== C.normCurrency(company().currency) ? { currency: head.currency } : {}),
            ...(head.refTtn ? { notes: `Référence TTN : ${head.refTtn}` } : {})
          } : {};
          done({ head: { supplierId: v.supplierId, number: v.number || '', date: v.date || C.today(), dueDate: v.dueDate || '',
            subject: v.subject || '', category: v.category || '', fees: Number(v.fees) || 0, currency: cur, exchangeRate: enDevise ? (Number(v.exchangeRate) > 0 ? Number(v.exchangeRate) : '') : 1, ...extra }, lines,
            aRevoir: ctlCourant.filter(x => !x[1]).map(x => ({ 'Le fournisseur': 'du fournisseur', 'Le total': 'du total', 'Le numéro': 'du numéro de facture', 'La devise': 'du taux de change', 'Le destinataire': 'du destinataire de la facture', 'La facture corrigée': 'de la facture corrigée' })[x[0]] || 'd\'une remarque de la lecture'),
            juste: justeCourant });
        };
      }, () => { if (urlVue) URL.revokeObjectURL(urlVue); }, { classe: 'modal-vc' });
  }

  // ---------- Numéros de série et garanties (4.1.0) ----------
  const serialById = id => data.serials.find(x => x.id === id);

  // Entrée : on colle une liste de numéros, un par ligne. Coller vaut mieux que saisir vingt fois.
  function serialIntakeForm(itemId, done) {
    const items = C.serializedItems(data);
    // Un refus qui nomme un geste sans le proposer oblige à traverser l'application de mémoire.
    if (!items.length) {
      return modal(`<h2>Aucun article suivi par numéro</h2>
        <p>Pour saisir des numéros de série, il faut d'abord dire quel article se suit unité par unité.</p>
        <p class="small muted">Une case à cocher sur la fiche de l'article, dans le Catalogue. Elle active aussi le suivi en stock, dont elle dépend.</p>
        <div class="modal-actions"><button class="btn" data-close>Plus tard</button>
          <button class="btn btn-primary" id="ser-go">${data.catalog.length ? 'Choisir un article…' : 'Créer un article suivi'}</button></div>`,
        (root, close) => {
          $('#ser-go', root).onclick = () => {
            close();
            if (data.catalog.length) navigate('#/catalogue');
            else catalogForm(null, () => render());
          };
        });
    }
    const first = itemId && items.some(c => c.id === itemId) ? itemId : items[0].id;
    // La facture d'achat se choisit par sa référence (10.14.1, LET-01) : un ticket sans numéro porte
    // « SN-AAAAMMJJ », pas « sans numéro » répété sur chaque ligne de la liste.
    const achatsChoix = C.enLot(() => data.purchases.map(p => ({ v: p.id, date: p.date, label: C.referenceAchat(p, data),
      sub: `${C.fmtDate(p.date)} · ${supplierName(p.supplierId)}${String(p.number || '').trim() ? '' : ' · sans numéro'}`,
      text: `${C.referenceAchat(p, data)} ${supplierName(p.supplierId)}` })));
    modal(`<h2>Entrée de numéros de série</h2>
      <p class="small muted">Un numéro par ligne. Tu peux les coller depuis un bon de livraison fournisseur ou un fichier : SkanFact ignore les lignes vides et refuse les doublons.</p>
      <form id="sif" class="grid-2">
        <div class="field obligatoire">${lbl('Article', 'ser.item')}
          ${combo({ name: 'itemId', value: first, items: items.map(c => ({ v: c.id, label: c.label, sub: c.unit || '', text: c.label })), placeholder: '— Choisir un article —', search: 'Rechercher un article…' })}
        </div>
        ${dateFieldHtml(lbl('Date d\'entrée', 'ser.inDate'), 'inDate', C.today(), {})}
        <div class="field span-2">${lbl('Facture d\'achat (optionnel)', 'ser.purchase')}
          ${combo({ name: 'inPurchaseId', value: '', items: achatsChoix.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 200), placeholder: '— Aucune —', search: 'Rechercher une facture d\'achat…' })}
        </div>
        <label class="field span-2">${lbl('Numéros de série', 'ser.intake')}<textarea name="list" rows="8" placeholder="SN-2026-0001&#10;SN-2026-0002&#10;SN-2026-0003"></textarea></label>
        <div class="span-2 annonce-stable" id="sif-hint"></div>
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=itemId]', root), { items: items.map(c => ({ v: c.id, label: c.label, text: c.label })), placeholder: '— Choisir un article —' });
        bindCombo($('[data-combo=inPurchaseId]', root), { items: achatsChoix, placeholder: '— Aucune —' });
        const parse = () => (formValues($('#sif', root)).list || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const hint = () => {
          const v = formValues($('#sif', root));
          const nums = parse();
          const known = new Set(data.serials.filter(x => x.itemId === v.itemId).map(x => (x.serial || '').toLowerCase()));
          const dbl = nums.filter(x => known.has(x.toLowerCase()));
          const item = data.catalog.find(c => c.id === v.itemId) || {};
          $('#sif-hint', root).innerHTML = `<span class="small ${dbl.length ? 'warn-text' : 'muted'}">`
            + (nums.length ? `${pl(nums.length, 'numéro')} à enregistrer${item.warrantyMonths ? `, garantie de ${item.warrantyMonths} mois` : ', sans garantie'}.` : 'Colle ou saisis au moins un numéro.')
            + (dbl.length ? ` ${pl(dbl.length, 'numéro')} déjà connu${sPl(dbl.length)} et ignoré${sPl(dbl.length)} : ${dbl.slice(0, 5).join(', ')}.` : '') + '</span>';
        };
        $('#sif', root).oninput = $('#sif', root).onchange = hint; hint();
        $('#ok', root).onclick = () => {
          const v = formValues($('#sif', root));
          const nums = parse();
          if (!v.itemId) return refus($('[name=itemId]', root), 'Choisis un article.');
          if (!nums.length) return refus($('[name=list]', root), 'Saisis au moins un numéro de série.');
          if (licenceBlock('Créer des numéros de série', 'stock')) return;
          const item = data.catalog.find(c => c.id === v.itemId) || {};
          const known = new Set(data.serials.filter(x => x.itemId === v.itemId).map(x => (x.serial || '').toLowerCase()));
          let added = 0;
          nums.forEach(num => {
            if (known.has(num.toLowerCase())) return;
            known.add(num.toLowerCase());
            data.serials.push({ id: C.uid(), itemId: v.itemId, serial: num, status: 'stock',
              inDate: v.inDate || C.today(), inPurchaseId: v.inPurchaseId || '', clientId: '', outDate: '', outDocId: '',
              warrantyMonths: Number(item.warrantyMonths) || 0, notes: '' });
            added++;
          });
          save(true); close();
          toast(added ? `${pl(added, 'numéro')} enregistré${sPl(added)}` : 'Tous ces numéros étaient déjà connus', !added);
          if (done) done();
        };
      });
  }

  // Sortie : attribuer des unités à un client, avec la garantie qui démarre ce jour-là.
  function serialAssignForm(doc, done) {
    const lines = (doc.lines || []).map(l => ({ l, item: C.itemOfLine(l, data) }))
      .filter(x => x.item && x.item.serialized);
    if (!lines.length) return toast('Aucune ligne de ce document ne porte un article suivi par numéro de série.', true);
    const chosen = {};                       // itemId → Set d'identifiants
    const draw = dansUnLot((root) => {
      const body = $('#sa-body', root);
      body.innerHTML = lines.map(({ l, item }) => {
        const need = Number(l.qty) || 0;
        const avail = C.availableSerials(data, item.id);
        const already = data.serials.filter(x => x.outDocId === doc.id && x.itemId === item.id);
        const picked = chosen[item.id] || new Set(already.map(x => x.id));
        chosen[item.id] = picked;
        return `<div class="panel"><h2>${h(item.label)}</h2>
          <p class="small muted mb">${pct(need)} unité${sPl(need)} sur ce document.</p>
          ${avail.length || already.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th></th><th>Numéro</th><th>Entré le</th><th>État</th></tr></thead><tbody>
            ${already.concat(avail).map(x => `<tr>
              <td><input type="checkbox" data-pick="${h(x.id)}" data-item="${h(item.id)}" ${picked.has(x.id) ? 'checked' : ''}></td>
              <td><strong>${h(x.serial)}</strong></td><td class="nw">${C.fmtDate(x.inDate)}</td>
              <td>${x.outDocId === doc.id ? '<span class="ok-text">déjà attribué à ce document</span>' : C.serialStatusLabel(x.status)}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="small ${picked.size === need ? 'muted' : 'warn-text'}">${pl(picked.size, 'sélectionné')} sur ${pct(need)} attendu${sPl(need)}.${item.warrantyMonths ? ` Garantie de ${item.warrantyMonths} mois à compter du ${C.fmtDate(doc.date)}.` : ' Aucune garantie définie sur cet article.'}</p>`
            : '<div class="empty">Aucune unité disponible en stock pour cet article. Saisis d\'abord les numéros entrés, depuis la page Stock.</div>'}
        </div>`;
      }).join('');
      $$('[data-pick]', body).forEach(cb => cb.onchange = () => {
        const set = chosen[cb.dataset.item];
        if (cb.checked) set.add(cb.dataset.pick); else set.delete(cb.dataset.pick);
        draw(root);
      });
    });
    modal(`<h2>Numéros de série de ${h(doc.number || 'ce document')}</h2>
      <p class="small muted">Coche les unités effectivement livrées. Leur garantie démarre à la date du document (${C.fmtDate(doc.date)}), et elles apparaîtront dans le parc de ${h(clientName(doc.clientId) || 'ce client')}.</p>
      <div id="sa-body"></div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Attribuer</button></div>`,
      (root, close) => {
        draw(root);
        $('#ok', root).onclick = () => {
          const keep = new Set();
          Object.keys(chosen).forEach(k => chosen[k].forEach(id => keep.add(id)));
          // Ce qui était attribué à ce document et ne l'est plus revient en stock.
          data.serials.forEach(x => {
            if (x.outDocId === doc.id && !keep.has(x.id)) {
              x.status = 'stock'; x.outDate = ''; x.outDocId = ''; x.clientId = '';
            }
          });
          keep.forEach(id => {
            const x = serialById(id); if (!x) return;
            x.status = 'vendu'; x.outDate = doc.date; x.outDocId = doc.id; x.clientId = doc.clientId || '';
            const item = data.catalog.find(c => c.id === x.itemId);
            if (item && !x.warrantyMonths) x.warrantyMonths = Number(item.warrantyMonths) || 0;
          });
          save(true); close(); toast(`${pl(keep.size, 'numéro')} attribué${sPl(keep.size)}`);
          if (done) done();
        };
      });
  }

  function serialForm(serial, done) {
    const x = serial;
    modal(`<h2>${h(x.serial)}</h2>
      <form id="sef" class="grid-2">
        <label class="field span-2">${lbl('Numéro de série', 'ser.number')}<input type="text" name="serial" value="${h(x.serial)}"></label>
        <label class="field">${lbl('État', 'ser.status')}<select name="status">${C.SERIAL_STATUSES.map(([v, l]) => `<option value="${v}" ${x.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">${lbl('Garantie', 'ser.warranty')}<select name="warrantyMonths">${C.WARRANTY_CHOICES.map(m => `<option value="${m}" ${Number(x.warrantyMonths) === m ? 'selected' : ''}>${m ? m + ' mois' : 'Aucune'}</option>`).join('')}</select></label>
        ${dateFieldHtml(lbl('Entré le', 'ser.inDate'), 'inDate', x.inDate || '', { clearable: true })}
        ${dateFieldHtml(lbl('Sorti le', 'ser.outDate'), 'outDate', x.outDate || '', { clearable: true })}
        <div class="field span-2">${lbl('Client', 'ser.client')}
          ${combo({ name: 'clientId', value: x.clientId || '', items: clientItems(x.clientId), placeholder: '— Aucun —', search: 'Rechercher un client…' })}
        </div>
        <label class="field span-2">${lbl('Notes', 'ser.notes')}<input type="text" name="notes" value="${h(x.notes || '')}"></label>
        <div class="span-2 annonce-stable" id="sef-hint"></div>
      </form>
      <div class="modal-actions">
        <button class="btn btn-danger" id="del-ser" style="margin-inline-end:auto">Supprimer</button>
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=clientId]', root), { items: clientItems(x.clientId), placeholder: '— Aucun —' });
        const hint = () => {
          const v = formValues($('#sef', root));
          const end = C.warrantyEnd({ outDate: v.outDate, warrantyMonths: Number(v.warrantyMonths) || 0 });
          $('#sef-hint', root).innerHTML = `<span class="small muted">${end
            ? `Garantie jusqu'au <b>${C.fmtDate(end)}</b>${end < C.today() ? ' — déjà expirée' : ''}.`
            : 'Pas de garantie en cours : il faut une date de sortie et une durée.'}</span>`;
        };
        $('#sef', root).oninput = $('#sef', root).onchange = hint; hint();
        $('#ok', root).onclick = () => {
          const v = formValues($('#sef', root));
          if (!(v.serial || '').trim()) return refus($('[name=serial]', root), 'Le numéro ne peut pas être vide.');
          Object.assign(x, v, { warrantyMonths: Number(v.warrantyMonths) || 0 });
          if (x.status === 'stock') { x.outDate = ''; x.outDocId = ''; x.clientId = ''; }
          save(true); close(); if (done) done();
        };
        $('#del-ser', root).onclick = async () => {
          if (!await confirmDialog(`Supprimer le numéro ${x.serial} ? Son historique sera perdu.`)) return;
          forget('serials', x.id, x.serial);
          data.serials = data.serials.filter(y => y.id !== x.id);
          save(true); close(); if (done) done();
        };
      });
  }

  // Les demandes d'accord (plateforme, brique 100) : celles qui attendent d'abord, puis les dernières décidées.
  routes.accords = () => {
    const dessiner = () => {
      const l = accordsVus;
      const tete = `<div class="page-head"><h1>Demandes d'accord ${info('doc.encoursAccord')}</h1><div class="actions">${backButton('#/factures')}</div></div>`;
      if (!l) {
        $('#view').innerHTML = `${tete}<div class="panel"><p class="small muted">Lecture des demandes…</p></div>`;
      } else if (!l.accords.length) {
        $('#view').innerHTML = `${tete}${etatVide('Aucune demande d\'accord', [
          'Quand l\'entreprise le demande, une facture qui ferait dépasser l\'encours autorisé d\'un client, ou dont la remise dépasse celle permise, ne s\'émet par un commercial qu\'avec l\'accord du propriétaire ou d\'un administrateur ; de même une commande fournisseur au-delà du montant permis ne part qu\'avec son accord. Les demandes arrivent ici, et sur l\'accueil du responsable.',
          accordRegle() ? 'L\'accord est demandé : rien n\'attend pour l\'instant.' : 'Pour l\'instant, SkanFact avertit seulement : l\'accord se règle dans Paramètres → Documents.',
        ], !accordRegle() && l.peutDecider ? [['ac-regler', 'Régler l\'accord…', true]] : [])}`;
        if ($('#ac-regler')) $('#ac-regler').onclick = () => allerParametres('documents', 'p-facturation');
      } else {
        const lignes = l.accords.map(a => {
          const d = a.geste === 'commande' ? (data.supplierOrders || []).find(x => x.id === a.piece) : docById(a.piece);
          // Une pièce faite sur un autre poste depuis l'ouverture de celui-ci n'y est pas encore : on le dit, et le geste.
          const piece = d ? `<a href="${h(lienAccord(a))}">${h(d.number || 'Brouillon')}</a>`
            : '<span class="muted small">pas encore sur ce poste</span> <button type="button" class="btn btn-sm" data-recharger-accords>Recharger</button>';
          const decision = a.statut === 'en_attente'
            ? (l.peutDecider && !a.mienne ? `<span class="inline">${boutonsDecision(a)}</span>` : '<span class="muted">En attente</span>')
            : `${a.statut === 'accorde' ? 'Accordée' : '<span class="warn-text">Refusée</span>'} par ${h(a.decideur)} le ${h(instantAccord(a.decideLe))}${a.motif ? `<div class="small muted">« ${h(a.motif)} »</div>` : ''}`;
          return `<tr data-accord="${h(a.id)}"><td class="nw">${h(instantAccord(a.demandeLe))}</td><td class="nw">${piece}</td><td>${h((tiersAccord(a) || {}).name || '—')}</td>
            ${a.geste === 'remise'
              ? `<td class="num nw">remise ${tauxAccord(a.taux)}</td><td class="num nw">—</td><td class="num nw">${tauxAccord(a.seuil)} sans accord</td>`
              : a.geste === 'commande'
              ? `<td class="num nw">${montantAccord(a.montant)} HT</td><td class="num nw">—</td><td class="num nw">${montantAccord(a.plafond)} sans accord</td>`
              : `<td class="num nw">${montantAccord(a.montant)}</td><td class="num nw">${montantAccord(a.encours)}</td><td class="num nw">${montantAccord(a.plafond)}</td>`}
            <td>${h(a.demandeur)}</td><td>${decision}</td></tr>`;
        }).join('');
        $('#view').innerHTML = `${tete}<div class="panel">
          <p class="small muted mb">${l.peutDecider ? 'Accorde ou refuse : un accord couvre le montant demandé ; une facture qui grossit ensuite redemande l\'accord. On ne décide jamais sa propre demande.' : 'Le propriétaire ou un administrateur décide. Une facture accordée s\'émet depuis sa page.'}</p>
          <div class="scroll-x"><table class="list compact"><thead><tr><th>Demandée le</th><th>Pièce</th><th>Client ou fournisseur</th><th class="num">Montant</th><th class="num">Déjà dus</th><th class="num">Autorisé</th><th>Demandée par</th><th>Décision</th></tr></thead>
          <tbody>${lignes}</tbody></table></div>
          ${l.accords.length >= 50 ? '<p class="small muted mt">Les 50 demandes les plus récentes.</p>' : ''}</div>`;
        brancherDecisions($('#view'), dessiner);
        $$('[data-recharger-accords]').forEach(b => { b.onclick = () => location.reload(); });
      }
      bindBack('#/factures');
    };
    dessiner();
    lireAccords().then(() => { if (routeOf(location.hash) === 'accords') dessiner(); },
      e => { if (routeOf(location.hash) === 'accords' && !accordsVus) { $('#view .panel').innerHTML = `<p class="small">${h(plainError(e))}</p>`; } });
  };
  // (1.295.0) La fenêtre part sur 60 jours : celle de la ligne « garanties » de l'accueil, qui y mène ; les deux disent le
  // même chiffre (6.8.1). Chaque liste nommée se pagine.
  const garState = { days: 60, q: '', pages: { ap: { page: 1 }, pr: { page: 1 }, ex: { page: 1 }, q: { page: 1 } } };
  // Proposer un contrat de maintenance (ou un devis) pour un ou plusieurs appareils d'un client : la pièce naît avec une
  // ligne par appareil et garde leurs numéros (`garanties`), pour que la page et l'accueil ne la redemandent plus.
  function proposerMaintenance(clientId, serials, type) {
    if (!clientId || !serials.length) return;
    if (licenceBlock('Créer une pièce')) return;
    navigate(`#/doc/new/${type === 'devis' ? 'devis' : 'contrat'}/client/${clientId}/garantie/${serials.map(x => x.id).join(',')}`);
  }
  // Un client qui a plusieurs appareils à proposer : on choisit lesquels, et la pièce (contrat à faire signer, ou devis).
  function proposerPourClient(g) {
    if (g.items.length === 1) return proposerMaintenance(g.clientId, g.items, 'contrat');
    modal(`<h2>Proposer la maintenance à ${h(g.clientName)}</h2>
      <p class="small muted">Une seule pièce pour ses appareils : une ligne par appareil, avec son numéro et le jour où la maintenance prend le relais de la garantie. Les prix se donnent sur la pièce.</p>
      <div class="gar-choix">${g.items.map(x => `<label class="check"><input type="checkbox" data-gar="${h(x.id)}" checked> <span><b>${h(x.itemLabel)}</b> n° ${h(x.serial)} <span class="muted">· garantie jusqu'au ${C.fmtDate(x.warrantyEndDate)}</span></span></label>`).join('')}</div>
      <div class="choix-t" role="radiogroup" aria-label="La pièce"><button type="button" data-gar-type="contrat" class="on" aria-pressed="true">Contrat de maintenance</button><button type="button" data-gar-type="devis" aria-pressed="false">Devis</button></div>
      <p class="small muted" id="gar-type-aide">Un contrat se fait signer, puis se facture chaque mois depuis sa page.</p>
      <p class="small warn-text" id="gar-refus" role="alert"></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="gar-ok">Préparer la proposition</button></div>`,
    (root, close) => {
      let type = 'contrat';
      $$('[data-gar-type]', root).forEach(b => { b.onclick = () => {
        type = b.dataset.garType;
        $$('[data-gar-type]', root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        $('#gar-type-aide', root).textContent = type === 'devis' ? 'Un devis se fait accepter ; il se transforme ensuite en contrat ou en facture.' : 'Un contrat se fait signer, puis se facture chaque mois depuis sa page.';
      }; });
      $('#gar-ok', root).onclick = () => {
        const ids = $$('[data-gar]', root).filter(c => c.checked).map(c => c.dataset.gar);
        if (!ids.length) { $('#gar-refus', root).textContent = 'Coche au moins un appareil.'; $('[data-gar]', root).focus(); return; }
        close(); proposerMaintenance(g.clientId, g.items.filter(x => ids.includes(x.id)), type);
      };
    });
  }
  // L'état d'un numéro, dit comme on le dit au téléphone à un client qui appelle avec une panne.
  const etatGarantie = x => x.status !== 'vendu' ? `<span class="badge">${h(C.serialStatusLabel(x.status))}</span>`
    : !x.warrantyEndDate ? '<span class="badge">Sans garantie</span>'
    : x.expired ? `<span class="badge">Hors garantie depuis le ${C.fmtDate(x.warrantyEndDate)}</span>`
    : `<span class="badge ${x.warrantyDays <= 30 ? 'b-due' : 'b-paid'}">Garantie jusqu'au ${C.fmtDate(x.warrantyEndDate)}</span>`;
  const pieceDeProposition = d => d ? `<a href="#/doc/${h(d.id)}">${h(d.number || (d.type === 'devis' ? 'Devis en brouillon' : 'Contrat en brouillon'))}</a> <span class="badge ${['signé', 'accepté'].includes(d.status) ? 'b-paid' : ['refusé', 'terminé'].includes(d.status) ? '' : 'b-due'}">${h(d.status)}</span><small class="mu"> ${d.type === 'devis' ? 'devis' : 'contrat'} du ${C.fmtDate(d.date)}</small>` : '';
  routes.garanties = () => {
    const tete = actions => `<div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<a href="#/stock">Stock</a>${ICONE_CHEVRON}<span>Garanties</span></div><h1>Garanties ${info('ser.ending')}</h1><p class="sous">Ce que tes clients ont chez eux, jusqu'à quand c'est garanti, et le bon moment pour leur proposer un contrat de maintenance</p></div><div class="actions">${actions || ''}</div></div>`;
    // 10.12.0 — une entreprise qui ne suit AUCUN article par numéro de série lisait « aucune
    // garantie ne se termine dans les 90 prochains jours », sous un sélecteur de durée : une
    // phrase rassurante sur un univers vide (7.0.0). La page dit à quoi elle sert et donne le geste
    // qui la remplit — la fiche d'un article, arrivée déjà suivie par numéro.
    if (!C.serializedItems(data).length) {
      $('#view').innerHTML = `${tete()}<div class="lf mg ca gar">
        ${etatVide('Aucun article suivi par numéro de série', [
          'Cette page annonce les garanties qui se terminent chez tes clients : c\'est le moment naturel de proposer un contrat de maintenance. Elle se remplit à partir des numéros de série enregistrés à la vente.',
          'Un article se suit par numéro quand on veut savoir <b>quel appareil</b> est chez <b>quel client</b> : un ordinateur, une machine, un climatiseur. Les fournitures vendues au mètre ou au kilo ne se suivent pas ainsi.'
        ], data.catalog.length
          ? [['g-choisir', 'Choisir un article à suivre…', true], ['g-suivre', '+ Nouvel article suivi']]
          : [['g-suivre', '+ Nouvel article suivi', true]])}</div>`;
      // Les mêmes gestes que « Numéros de série » dans le Stock : une prestation du catalogue qu'on
      // se met à suivre, ou une fiche neuve suivie en stock ET par numéro (un numéro de série suppose
      // une quantité), avec le garde-fou de création du formulaire.
      if ($('#g-choisir')) $('#g-choisir').onclick = () => choisirArticleASuivre(() => render());
      $('#g-suivre').onclick = () => catalogForm(articleNeuf({ tracked: true, serialized: true }), it => { if (it) render(); }, { creation: true, titre: 'Nouvel article suivi par numéro' });
      return;
    }
    const s = garState;
    const peutProposer = !enLecture('documents');
    const draw = () => {
      const ix = C.propositionsDeGarantie(data);
      const tous = C.serialList(data);
      const vendus = tous.filter(x => x.status === 'vendu');
      const aProposer = C.garantiesAProposer(data, s.days, undefined, ix);
      const groupes = C.garantiesParClient(aProposer);
      const proposees = vendus.filter(x => ix.has(x.id)).sort((a, b) => (a.warrantyEndDate || '9').localeCompare(b.warrantyEndDate || '9'));
      const expirees = vendus.filter(x => x.expired && !ix.has(x.id)).sort((a, b) => b.warrantyEndDate.localeCompare(a.warrantyEndDate));
      const sous = vendus.filter(x => x.underWarranty);
      const nClients = new Set(sous.map(x => x.clientId).filter(Boolean)).size;
      // Les pièces, pas les appareils : un contrat pour trois climatiseurs est UNE proposition qui attend sa réponse.
      const pieces = [...new Set(proposees.map(x => ix.get(x.id)))];
      const nSignees = pieces.filter(d => ['signé', 'accepté'].includes(d.status)).length;
      const nRefusees = pieces.filter(d => d.status === 'refusé').length;
      const nAttente = pieces.length - nSignees - nRefusees;
      const prochaine = vendus.filter(x => x.underWarranty && !ix.has(x.id)).sort((a, b) => a.warrantyEndDate.localeCompare(b.warrantyEndDate))[0];
      const chiffre = (l, v, sousT, ton, aller) => `<div class="mg-chiffre"${aller ? ` data-aller="${aller}" role="button" tabindex="0"` : ''}><span class="mu">${l}</span><b class="${ton || ''}">${v}</b><small>${sousT}</small></div>`;
      $('#gar-resume').innerHTML = chiffre('À proposer', String(aProposer.length), aProposer.length ? `finissent d'ici ${s.days} jours, chez ${pl(groupes.length, 'client')}` : `rien d'ici ${s.days} jours`, aProposer.length ? 'ambre' : 'vert', aProposer.length ? 'g-aproposer' : '')
        + chiffre('Déjà proposées', String(proposees.length), proposees.length ? `en ${pl(pieces.length, 'pièce')} : ${[nSignees ? `${nSignees} signée${nSignees > 1 ? 's' : ''}` : '', nAttente ? `${nAttente} en attente de réponse` : '', nRefusees ? `${nRefusees} refusée${nRefusees > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}` : 'aucune proposition faite', nSignees === pieces.length && pieces.length ? 'vert' : '', proposees.length ? 'g-proposees' : '')
        + chiffre('Sous garantie', String(sous.length), sous.length ? `chez ${pl(nClients, 'client')}` : 'aucun appareil garanti chez un client', '')
        + chiffre('Hors garantie', String(expirees.length), expirees.length ? 'sans contrat proposé — voir lesquels' : 'aucun', '', expirees.length ? 'g-expirees' : '');
      $$('#gar-resume [data-aller]').forEach(x => {
        const aller = () => { const c = $('#' + x.dataset.aller); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        x.onclick = aller; x.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aller(); } };
      });
      const client = x => x.clientId ? `<a href="#/client/${h(x.clientId)}">${h(x.clientName || 'Client')}</a>` : '<span class="mu">sans client</span>';
      const appareil = x => `<b>${h(x.itemLabel)}</b><div class="small muted">n° ${h(x.serial)}</div>`;
      const q = s.q.trim().toLowerCase();
      let corps;
      if (q) {
        const trouves = tous.filter(x => `${x.serial} ${x.itemLabel} ${x.clientName}`.toLowerCase().includes(q));
        const pg = paginate(trouves, s.pages.q);
        corps = trouves.length ? `<div class="section-head"><h2>Ce que la recherche trouve</h2></div>
          <table class="list gar-t" id="g-trouves"><thead><tr><th>Appareil</th><th>Client</th><th>Livré le</th><th>Garantie</th><th>Proposition</th></tr></thead><tbody>
          ${pg.rows.map(x => `<tr data-ser-id="${h(x.id)}"><td>${appareil(x)}</td><td>${x.status === 'vendu' ? client(x) : '<span class="mu">—</span>'}</td><td class="nw">${x.outDate ? C.fmtDate(x.outDate) : '<span class="mu">—</span>'}</td><td>${etatGarantie(x)}</td><td>${pieceDeProposition(ix.get(x.id)) || '<span class="mu">—</span>'}</td></tr>`).join('')}
          </tbody></table>${pagerBar(pg.pg, { noun: 'numéro' })}`
          : `<div class="mg-vide"><b>Aucun numéro ne correspond à « ${h(s.q.trim())} »</b><span>La recherche lit le numéro de série, l'article et le client, sur tous les numéros (en stock, chez un client, retournés).</span></div>`;
      } else {
        const pgA = paginate(groupes, s.pages.ap), pgP = paginate(proposees, s.pages.pr), pgE = paginate(expirees, s.pages.ex);
        // Un seul bouton principal : celui du premier client à qui l'on peut proposer (un numéro sans client n'en a pas).
        const principal = pgA.rows.find(g => g.clientId);
        const ligneGroupe = g => {
          const f = g.items[0];
          return `<tr data-groupe="${h(g.clientId || f.id)}"><td>${g.clientId ? `<a href="#/client/${h(g.clientId)}"><b>${h(g.clientName)}</b></a>` : '<span class="mu">sans client</span>'}</td>
            <td>${g.items.map(x => `<div>${h(x.itemLabel)} <span class="small muted">n° ${h(x.serial)}</span></div>`).join('')}</td>
            <td class="nw"><b>${C.fmtDate(f.warrantyEndDate)}</b><div class="small ${f.warrantyDays <= 30 ? 'ambre' : 'muted'}">dans ${pl(f.warrantyDays, 'jour')}</div></td>
            ${g.clientId ? rowMenuCell('g:' + g.clientId, peutProposer ? `<button type="button" class="btn btn-sm${principal === g ? ' btn-primary' : ''}" data-proposer="${h(g.clientId)}">${g.items.length > 1 ? `Proposer un contrat (${g.items.length})` : 'Proposer un contrat'}</button>` : '')
              : `<td class="actions row-actions"><button type="button" class="btn btn-sm" data-rattacher="${h(f.id)}">Rattacher un client…</button></td>`}</tr>`;
        };
        corps = `<div id="g-aproposer"><div class="section-head"><h2>À proposer ${info('gar.aproposer')}</h2></div>
          ${groupes.length ? `<table class="list gar-t gar-groupes"><thead><tr><th>Client</th><th>Appareils</th><th>Fin de garantie</th><th></th></tr></thead><tbody>${pgA.rows.map(ligneGroupe).join('')}</tbody></table>${pagerBar(pgA.pg, { noun: 'client' })}`
            : `<div class="mg-vide"><b>Rien à proposer d'ici ${s.days} jours</b><span>${prochaine ? `La prochaine garantie qui finit sans proposition : ${h(prochaine.itemLabel)} n° ${h(prochaine.serial)} chez ${h(prochaine.clientName || 'un client')}, le <b>${C.fmtDate(prochaine.warrantyEndDate)}</b>. Elle viendra ici ${s.days} jours avant.` : 'Aucune garantie en cours sans proposition. Les appareils livrés avec une durée de garantie viendront ici avant qu\'elle finisse.'}</span></div>`}</div>
          ${proposees.length ? `<div id="g-proposees"><div class="section-head"><h2>Déjà proposées ${info('gar.proposees')}</h2></div>
            <table class="list gar-t"><thead><tr><th>Appareil</th><th>Client</th><th>Garantie</th><th>Proposition</th></tr></thead><tbody>
            ${pgP.rows.map(x => `<tr><td>${appareil(x)}</td><td>${client(x)}</td><td>${etatGarantie(x)}</td><td>${pieceDeProposition(ix.get(x.id))}</td></tr>`).join('')}
            </tbody></table>${pagerBar(pgP.pg, { noun: 'appareil' })}</div>` : ''}
          ${expirees.length ? `<div id="g-expirees"><div class="section-head"><h2>Hors garantie, sans contrat</h2></div>
            <table class="list gar-t"><thead><tr><th>Appareil</th><th>Client</th><th>Livré le</th><th>Garantie expirée le</th><th></th></tr></thead><tbody>
            ${pgE.rows.map(x => `<tr><td>${appareil(x)}</td><td>${client(x)}</td><td class="nw">${C.fmtDate(x.outDate)}</td><td class="nw">${C.fmtDate(x.warrantyEndDate)}</td>${rowMenuCell('e:' + x.id)}</tr>`).join('')}
            </tbody></table>${pagerBar(pgE.pg, { noun: 'appareil' })}</div>` : ''}`;
      }
      $('#gar-wrap').innerHTML = `<div class="mg-f"><input type="search" class="cherche" id="g-q" placeholder="Un numéro de série, un article, un client…" value="${h(s.q)}" aria-label="Chercher un appareil">
          <label class="sel nw">Finit d'ici <select id="g-days">${[30, 60, 90, 180, 365].map(d => `<option value="${d}" ${s.days === d ? 'selected' : ''}>${d} jours</option>`).join('')}</select></label></div>${corps}`;
      const qEl = $('#g-q');
      qEl.oninput = e => { s.q = e.target.value; s.pages.q.page = 1; sansPerdreLaFrappe(e.target, draw); };
      $('#g-days').onchange = e => { s.days = Number(e.target.value); s.pages.ap.page = 1; draw(); };
      $$('[data-proposer]').forEach(b => b.onclick = () => { const g = groupes.find(x => x.clientId === b.dataset.proposer); if (g) proposerPourClient(g); });
      $$('[data-rattacher]').forEach(b => b.onclick = () => { const x = serialById(b.dataset.rattacher); if (x) serialForm(x, () => draw()); });
      bindRowMenus($('#gar-wrap'), cle => {
        const [genre, id] = [cle.slice(0, 1), cle.slice(2)];
        if (genre === 'g') {
          const g = groupes.find(x => (x.clientId || x.items[0].id) === id); if (!g) return [];
          return [
            ...(g.clientId && peutProposer ? [
              { icon: 'contrat', label: 'Proposer un contrat de maintenance', hint: g.items.length > 1 ? `Une pièce pour ses ${g.items.length} appareils, à faire signer` : 'À faire signer, puis à facturer chaque mois', run: () => proposerPourClient(g) },
              { icon: 'nouveau', label: 'Faire un devis plutôt', hint: 'Une ligne par appareil, à faire accepter', run: () => proposerMaintenance(g.clientId, g.items, 'devis') }] : []),
            ...(g.clientId ? [{ icon: 'client', label: 'Ouvrir la fiche du client', hint: 'Son matériel, ses pièces', run: () => navigate('#/client/' + g.clientId) }] : []),
            ...g.items.map(x => ({ icon: 'modifier', label: `Modifier le numéro ${x.serial}…`, hint: 'Client, date de livraison, durée de garantie', run: () => { const sx = serialById(x.id); if (sx) serialForm(sx, () => draw()); } })),
          ];
        }
        const x = expirees.find(y => y.id === id); if (!x) return [];
        return [
          ...(x.clientId && peutProposer ? [{ icon: 'contrat', label: 'Proposer un contrat de maintenance', hint: 'La garantie est finie : la maintenance la remplace', run: () => proposerMaintenance(x.clientId, [x], 'contrat') }] : []),
          { icon: 'modifier', label: 'Modifier le numéro…', hint: 'Client, date de livraison, durée de garantie', run: () => { const sx = serialById(x.id); if (sx) serialForm(sx, () => draw()); } },
        ];
      });
      $$('#gar-wrap .pager').forEach(el => {
        const sec = el.closest('#g-aproposer') ? s.pages.ap : el.closest('#g-proposees') ? s.pages.pr : el.closest('#g-expirees') ? s.pages.ex : s.pages.q;
        bindPager(el.parentElement, sec, draw);
      });
    };
    const exporter = async () => {
      const ix = C.propositionsDeGarantie(data);
      const rows = C.serialList(data, { status: 'vendu' }).map(x => { const d = ix.get(x.id); return { article: x.itemLabel, numero: x.serial, client: x.clientName, livre: x.outDate || '', fin: x.warrantyEndDate || '',
        etat: !x.warrantyEndDate ? 'sans garantie' : x.expired ? 'hors garantie' : 'sous garantie', proposition: d ? `${d.number || 'brouillon'} (${d.status})` : '' }; });
      const cols = [{ key: 'article', label: 'Article' }, { key: 'numero', label: 'Numéro de série' }, { key: 'client', label: 'Client' }, { key: 'livre', label: 'Livré le', type: 'date' },
        { key: 'fin', label: 'Fin de garantie', type: 'date' }, { key: 'etat', label: 'État' }, { key: 'proposition', label: 'Proposition' }];
      const f = await bridge.saveText(`garanties-${C.today()}.csv`, C.toCsv(rows, cols));
      if (f) toast('Exporté : ' + String(f).split(/[\\/]/).pop());
    };
    $('#view').innerHTML = `${tete('<button type="button" class="btn" id="g-export">Exporter</button>')}
      <div class="lf mg ca gar"><div class="cf-carte mg-resume" id="gar-resume"></div><div class="cf-carte"><div class="cf-onglet"><div id="gar-wrap"></div></div></div></div>`;
    $('#g-export').onclick = () => exporter().catch(e => toast(plainError(e), true));
    draw();
  };

  // ---------- Immobilisations et amortissements (3.5.0) ----------
  const assetById = id => data.assets.find(a => a.id === id);
  // (1.289.0) La facture de la cession d'un bien : la même recherche pour la fiche et le tableau des sorties (6.8.1).
  const factureDeCession = a => data.documents.find(d => d.assetId === a.id && d.type === 'facture') || null;
  // `supplierItems` vit dans l'éditeur d'achat : ici on refait la liste, sans la sortir de son contexte.
  const supItems = garder => fournisseursEnService(garder)
    .map(x => ({ v: x.id, label: x.name, sub: x.contact || '', text: `${x.name} ${x.contact || ''}` }));

  function assetForm(asset, done, preset) {
    if (!asset && licenceBlock('Créer la fiche du bien', 'immos')) return;
    // 10.12.0 — la famille partait sur « Matériel informatique » (et 3 ans) avec « Ordinateur
    // portable du bureau » en invite : le métier de l'auteur, proposé à une menuiserie qui
    // enregistrait sa scie à format — et une durée de trois ans que personne n'avait décidée. La
    // famille se CHOISIT ; c'est elle qui propose la durée (la durée est une décision, 3.5.0).
    const a = asset || Object.assign({ id: C.uid(), label: '', category: '', date: C.today(), amount: 0,
      residual: 0, years: '', supplierId: '', purchaseId: '', lineIndex: null, notes: '' }, preset || {});
    modal(`<h2>${asset ? 'Modifier l\'immobilisation' : 'Nouvelle immobilisation'}</h2>
      <p class="small muted">Un bien qui reste dans l'entreprise ne se déduit pas d'un coup : il se déduit un peu chaque année, pendant sa durée d'usage. <em>À VÉRIFIER avec ton comptable : la durée dépend de la nature du bien.</em></p>
      <form id="imf" class="grid-2">
        <label class="field span-2 obligatoire">${lbl('Désignation', 'immo.label')}<input type="text" name="label" value="${h(a.label)}" placeholder="Le bien, tel que tu l'appelles"></label>
        <label class="field obligatoire">${lbl('Famille', 'immo.class')}<select name="category"><option value="" ${a.category ? '' : 'selected'}>— Choisis la famille —</option>${C.DEFAULT_ASSET_CLASSES.map(([v, l]) => `<option value="${v}" ${a.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${dateFieldHtml(lbl('Mise en service', 'immo.date'), 'date', a.date, { obligatoire: true })}
        ${field(lbl(`Valeur d'acquisition HT (${h(C.normCurrency(company().currency))})`, 'immo.amount'), 'amount', a.amount || 0, 'number', 'step="0.001" min="0" class="num"').replace('class="field"', 'class="field obligatoire"')}
        ${field(lbl('Durée (années)', 'immo.years'), 'years', a.years || '', 'number', 'step="1" min="1" max="50" class="num"').replace('class="field"', 'class="field obligatoire"')}
        ${field(lbl(`Valeur résiduelle (${h(C.normCurrency(company().currency))})`, 'immo.residual'), 'residual', a.residual || 0, 'number', 'step="0.001" min="0" class="num"')}
        <div class="field">${lbl('Fournisseur', 'immo.supplier')}
          ${combo({ name: 'supplierId', value: a.supplierId || '', items: supItems(a.supplierId), placeholder: '— Aucun —', search: 'Rechercher un fournisseur…' })}
        </div>
        <div class="span-2 annonce-stable" id="amort-hint"></div>
        <label class="field span-2">${lbl('Notes', 'immo.notes')}<input type="text" name="notes" value="${h(a.notes || '')}"></label>
      </form>
      <div class="modal-actions">
        ${asset ? '<button class="btn btn-danger" id="del-imm" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        bindCombo($('[data-combo=supplierId]', root), { items: supItems(a.supplierId), placeholder: '— Aucun —' });
        // La famille propose sa durée usuelle, mais ne l'impose pas : si l'utilisateur a déjà touché
        // le champ, on ne l'écrase pas derrière son dos.
        let yearsTouched = !!asset;
        $('input[name=years]', root).oninput = () => { yearsTouched = true; };
        const hint = () => {
          const v = formValues($('#imf', root));
          const draft = { ...a, ...v, amount: Number(v.amount) || 0, residual: Number(v.residual) || 0, years: Number(v.years) || 0 };
          const rows = C.assetSchedule(draft);
          const el = $('#amort-hint', root);
          if (!rows.length) { el.innerHTML = `<span class="small muted">${v.category ? 'Renseigne une valeur, une durée et une date de mise en service pour voir le plan d\'amortissement.' : 'Choisis la famille du bien : elle propose sa durée d\'amortissement usuelle, que tu pourras changer.'}</span>`; return; }
          const cur = company().currency;
          el.innerHTML = `<span class="small muted">Plan sur ${pl(rows.length, 'exercice')} — ${rows.slice(0, 4).map(r => `<b>${r.year}</b> : ${C.money(r.annuity, cur)}`).join(' · ')}${rows.length > 4 ? ' · …' : ''}</span>`;
        };
        $('select[name=category]', root).onchange = e => {
          if (!yearsTouched && e.target.value) $('input[name=years]', root).value = C.assetClassYears(e.target.value);
          hint();
        };
        // (1.314.0) Une date se valide en quittant son champ (« change » sur le champ caché) : l'aperçu la suit, sinon il
        // montrait le plan de l'ancienne date (vitrine posée le 15/03, plan calculé au 10/03).
        $('#imf', root).oninput = hint; $('#imf', root).onchange = hint; hint();
        $('#ok', root).onclick = () => {
          const v = formValues($('#imf', root));
          // Un refus MONTRE le champ (7.20.0) : sept champs, et un bandeau de 2,6 secondes.
          const champ = n => $(`[name=${n}]`, root);
          if (!v.label.trim()) return refus(champ('label'), 'Donne un nom à ce bien.');
          if (!v.category) return refus(champ('category'), 'Choisis la famille du bien : elle propose sa durée d\'amortissement.');
          if (!(Number(v.amount) > 0)) return refus(champ('amount'), 'La valeur d\'acquisition doit être supérieure à zéro.');
          if (!(Number(v.years) > 0)) return refus(champ('years'), 'La durée d\'amortissement doit être d\'au moins un an.');
          if (Number(v.residual) >= Number(v.amount)) return refus(champ('residual'), 'La valeur résiduelle doit rester inférieure à la valeur d\'acquisition.');
          if (!v.date) return refus(champ('date'), 'Date de mise en service invalide.');
          if (closedBlock([a.date, v.date], 'Ce bien')) return;
          if (!asset && licenceBlock('Créer la fiche du bien', 'immos')) return;
          Object.assign(a, v, { amount: Number(v.amount), residual: Number(v.residual) || 0, years: Number(v.years) });
          if (!asset) data.assets.push(a);
          save(true); close(); if (done) done(a);
        };
        if ($('#del-imm', root)) $('#del-imm', root).onclick = async () => {
          if (!await confirmDialog(`Supprimer « ${a.label} » ?${a.purchaseId ? ' La ligne d\'achat correspondante repassera dans « À immobiliser ».' : ''} L\'achat lui-même n\'est pas touché.`)) return;
          if (closedBlock([a.date, a.disposal && a.disposal.date], 'Ce bien')) return;
          forget('assets', a.id, a.label);
          data.assets = data.assets.filter(x => x.id !== a.id);
          save(true); close(); navigate('#/immos');
        };
      });
  }

  // Céder un bien moins de cinq ans après son acquisition peut obliger à reverser une part de la TVA
  // récupérée à l'achat. SkanFact ne calcule rien : il rappelle la question au bon moment.
  // 10.12.0 — la phrase parlait toujours au futur d'une VENTE : « n'aura été détenu… avant de
  // conclure la vente », y compris sur la fiche d'un bien déjà sorti, et d'un bien mis au rebut qui
  // n'a été vendu à personne. Elle dit maintenant ce qui est : au passé une fois la sortie enregistrée,
  // et « la vente » seulement quand un prix a été donné.
  const vatWarning = (asset, dateIso, { vente = true, passe = false } = {}) => {
    if (!asset.date || !dateIso || dateIso < asset.date) return '';
    if (C.days360(asset.date, dateIso) >= 5 * 360) return '';
    return `Ce bien ${passe ? 'n\'a été détenu' : 'n\'aura été détenu'} que ${dureeDetenue(C.days360(asset.date, dateIso))}. Une sortie avant cinq ans peut imposer de reverser une partie de la TVA récupérée à l'achat — <em>À VÉRIFIER avec ton comptable${vente && !passe ? ' avant de conclure la vente' : ''}.</em>`;
  };
  // 10.12.0 — « détenu que 1 mois » pour une sortie le jour même de la mise en service : le
  // `Math.max(1, …)` arrondissait le néant à un mois, et « 40 mois » se relit mal quand on pense en
  // années. La durée se dit comme on la dit.
  function dureeDetenue(jours) {
    const mois = Math.floor(Math.max(0, jours) / 30);
    if (mois < 1) return 'moins d\'un mois';
    if (mois < 12) return `${mois} mois`;
    const ans = Math.floor(mois / 12), reste = mois % 12;
    return pl(ans, 'an') + (reste ? ` et ${reste} mois` : '');
  }

  // 10.12.0 — la fenêtre de sortie s'ouvrait sur « moins-value de 18 489,722 DT » en orange, avec le
  // prix à son zéro par défaut : une alarme sur un chiffre que personne n'avait encore donné. Tant
  // qu'aucun prix n'est donné (vide ou zéro), on dit la valeur nette et ce qu'elle deviendrait sans
  // prix, en gris — la même phrase que la fiche d'un bien sorti sans prix ; la couleur n'arrive
  // qu'avec un prix, c'est lui qui fait une plus- ou une moins-value.
  function annonceSortie(r, avecPrix, cur) {
    const vnc = `Valeur nette comptable au ${C.fmtDate(r.date)} : <b>${C.money(r.nbv, cur)}</b>`;
    if (!avecPrix) return `<span class="small muted">${vnc}. Sans prix (mis au rebut, volé), la sortie est une moins-value de ce montant ; si tu le vends, indique le prix obtenu.</span>`;
    return `<span class="small">${vnc} — `
      + (r.result >= 0
        ? `<span class="ok-text">plus-value de ${C.money(r.result, cur)}</span>`
        : `<span class="warn-text">moins-value de ${C.money(-r.result, cur)}</span>`)
      // E-11 : la seconde moitié de la phrase suit la première — « cette plus-value » écrit
      // sous une moins-value se lisait comme une faute sur un chiffre qu'on vient d'annoncer.
      + `. <em>À VÉRIFIER avec ton comptable : le traitement fiscal de cette ${r.result >= 0 ? 'plus-value' : 'moins-value'}.</em></span>`;
  }

  function disposalForm(asset, done) {
    const d = { ...(asset.disposal || { date: C.today(), amount: 0, reason: '' }) };
    const cur = company().currency;
    modal(`<h2>Sortie de « ${h(asset.label)} »</h2>
      <p class="small muted">Vendu, mis au rebut ou volé : le bien quitte l'actif. On amortit jusqu'au jour de la sortie, puis on compare le prix obtenu à ce qu'il valait encore dans les comptes.</p>
      <form id="dsf" class="grid-2">
        ${dateFieldHtml(lbl('Date de sortie', 'immo.disposal'), 'date', d.date, { obligatoire: true })}
        ${field(lbl(`Prix de cession HT (${h(C.normCurrency(company().currency))})`, 'immo.disposalPrice'), 'amount', asset.disposal ? (d.amount || 0) : '', 'number', 'step="0.001" min="0" class="num" placeholder="0 si mis au rebut ou volé"')}
        <label class="field span-2">${lbl('Motif', 'immo.disposalReason')}<input type="text" name="reason" value="${h(d.reason || '')}" placeholder="Revendu, mis au rebut, volé…"></label>
        <div class="span-2 annonce-stable" id="dsf-hint"></div>
      </form>
      <div class="modal-actions">
        ${/* 10.12.0 — remettre un bien à l'actif se refait d'un clic (« Sortir du patrimoine ») : ce
             n'est pas un geste destructeur, donc pas de rouge — ni ici, ni dans la question. */''}
        ${asset.disposal ? '<button class="btn" id="undo-dis" style="margin-inline-end:auto">Annuler la sortie</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer la sortie</button></div>`,
      (root, close) => {
        const hint = () => {
          const v = formValues($('#dsf', root));
          const r = C.disposalResult({ ...asset, disposal: { date: v.date, amount: Number(v.amount) || 0 } });
          const el = $('#dsf-hint', root);
          if (!r) { el.innerHTML = ''; return; }
          const tva = vatWarning(asset, v.date, { vente: Number(v.amount) > 0 });
          el.innerHTML = annonceSortie(r, Number(v.amount) > 0, cur)
            + (tva ? `<div class="small warn-text mt">${tva}</div>` : '');
        };
        $('#dsf', root).oninput = hint; $('#dsf', root).onchange = hint; hint();
        $('#ok', root).onclick = async () => {
          const v = formValues($('#dsf', root));
          const champ = n => $(`#dsf [name=${n}]`, root);
          if (!v.date) return refus(champ('date'), 'Indique la date de sortie.');
          if (v.date < asset.date) return refus(champ('date'), `La sortie ne peut pas précéder la mise en service (${C.fmtDate(asset.date)}).`);
          if (v.date > C.today() && !await confirmDialog(`La date (${C.fmtDate(v.date)}) est dans le futur. Enregistrer quand même ?`, 'Enregistrer', undefined, { titre: 'Une sortie datée dans le futur' })) return;
          if (closedBlock([asset.disposal && asset.disposal.date, v.date], 'Cette sortie')) return;
          // Un prix laissé VIDE n'est pas un prix décidé : on demande une fois si le bien sort vraiment
          // sans être vendu. Un « 0 » tapé, lui, est une réponse.
          if (String(v.amount).trim() === '') {
            const r = C.disposalResult({ ...asset, disposal: { date: v.date, amount: 0 } });
            if (!await confirmDialog(`Aucun prix de cession : « ${asset.label} » sort sans être vendu (mis au rebut, volé)${r && r.nbv > 0 ? `, avec une moins-value de ${C.money(r.nbv, cur)}` : ''}. C'est bien ça ?`, 'Oui, sans prix', false)) { champ('amount').focus(); return; }
          }
          asset.disposal = { date: v.date, amount: Number(v.amount) || 0, reason: v.reason || '' };
          save(true); close(); if (done) done(asset);
        };
        if ($('#undo-dis', root)) $('#undo-dis', root).onclick = async () => {
          if (!await confirmDialog('Remettre ce bien à l\'actif ? L\'amortissement reprendra comme s\'il n\'était jamais sorti.', 'Remettre à l\'actif', false)) return;
          if (closedBlock(asset.disposal && asset.disposal.date, 'Cette sortie')) return;
          delete asset.disposal; save(true); close(); if (done) done(asset);
        };
      });
  }

  const immoState = { tab: 'tableau', year: C.today().slice(0, 4) };
  const IMMO_TABS = [['tableau', 'Tableau des amortissements'], ['attente', 'À immobiliser'], ['sorties', 'Sorties et cessions']];

  routes.immos = () => {
    const cur = company().currency;
    const s = immoState;
    const years = Array.from(new Set(data.assets.map(a => (a.date || '').slice(0, 4)).filter(Boolean)
      .concat([C.today().slice(0, 4)]))).sort().reverse();
    if (!years.includes(s.year)) s.year = years[0];
    const waiting = C.assetsToCreate(data);

    $('#view').innerHTML = `
      <div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Immobilisations</span></div><h1>Immobilisations</h1><p class="sous">Ce que tu gardes plusieurs années, ce qu'il coûte chaque année, ce qu'il vaut encore</p></div>
        <div class="actions">
          <select id="im-year" ${s.tab === 'attente' ? 'hidden' : ''}>${years.map(y => `<option ${y === s.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <button class="btn" id="im-csv">Exporter en CSV</button>
          <button class="btn btn-primary" id="new-imm">+ Nouveau bien</button>
        </div></div>
      <div class="lf mg ca im">
        <div class="mg-barre"><div class="pa-seg" id="im-tabs" role="tablist" aria-label="Les immobilisations">${IMMO_TABS.map(([id, label]) =>
          `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === s.tab}" class="${id === s.tab ? 'active' : ''}">${label}${id === 'attente' && waiting.length ? ` <span class="nav-count">${waiting.length}</span>` : ''}</button>`).join('')}</div></div>
        <div class="cf-carte"><div class="cf-onglet" id="im-body"></div></div>
      </div>`;

    // 10.12.0 — « 1 bien à l'actif » sous une carte dont le seul bien était sorti de l'actif : le
    // compte portait sur les lignes du tableau de l'exercice, qui gardent un bien sorti en cours
    // d'année (sa dotation court jusqu'au jour de la sortie). La phrase dit les deux.
    function biensAuBilan(t, annee) {
      const sortis = t.rows.filter(r => r.out).length, restent = t.rows.length - sortis;
      return (restent ? `${pl(restent, 'bien')} à l'actif au 31/12/${annee}` : `aucun bien à l'actif au 31/12/${annee}`)
        + (sortis ? ` · ${pl(sortis, 'sorti', 'sortis')} en ${annee}` : '');
    }

    // 10.14.1 — ce que le bilan du 31/12 porte au compte 22 sans que ce tableau le montre, et
    // l'inverse (`C.immosHorsTableau`). Regardée un 1er janvier, la page disait 52 500 DT
    // d'immobilisations et le bilan 53 950, sans un mot : l'imprimante de décembre n'avait pas de
    // fiche. On le dit AU-DESSUS du tableau, avec le geste qui le règle.
    function horsTableauHtml(hors, annee) {
      const ferme = (licence.reserves || []).includes('immos');
      const liste = rows => rows.map(r => `« ${h(r.label || 'sans désignation')} » (${C.money(r.amount, cur)})`).join(', ');
      const out = [];
      if (hors.sansFiche.length) {
        const n = hors.sansFiche.length, un = n === 1;
        out.push(`<div class="warn-box mb" id="im-sans-fiche"><b>${un ? `« ${h(hors.sansFiche[0].label || 'Une ligne d\'achat')} » n'a pas de fiche` : `${n} lignes d'achat marquées « immobilisation » n'ont pas de fiche`}</b> :
          ${C.money(C.round3(hors.sansFiche.reduce((t, w) => t + w.amount, 0)), cur)} ${un ? 'est' : 'sont'} ${`${annee}-12-31` < C.today() ? `au bilan du 31/12/${h(annee)} (compte 22)` : `au bilan (compte 22) depuis ${un ? 'son' : 'leur'} achat`}, et ${un ? 'son' : 'leur'} amortissement n'est compté nulle part.
          ${ferme ? `Ton comptable ${un ? 'la' : 'les'} voit dans les écritures du paquet et établit le plan : tu n'as rien à faire.`
            : `<div class="mt"><button class="btn btn-sm btn-primary" id="im-creer-fiche">${un ? 'Créer la fiche du bien…' : `Voir les ${n} lignes à immobiliser`}</button></div>`}</div>`);
      }
      if (hors.pasEnService.length) {
        const un = hors.pasEnService.length === 1;
        out.push(`<p class="small muted mb" id="im-pas-en-service">Au bilan du 31/12/${h(annee)} sans être dans ce tableau : ${liste(hors.pasEnService)}, acheté${un ? '' : 's'} en ${h(annee)} et mis en service plus tard. L'amortissement commence à la mise en service.</p>`);
      }
      if (hors.avantFacture.length) {
        const un = hors.avantFacture.length === 1;
        out.push(`<p class="small muted mb" id="im-avant-facture">Dans ce tableau sans être encore au bilan du 31/12/${h(annee)} : ${liste(hors.avantFacture)}, mis en service avant ${un ? 'sa facture' : 'leur facture'}. Le compte 22 ${un ? 'le' : 'les'} reçoit avec la facture d'achat.</p>`);
      }
      return out.join('');
    }
    function brancherHorsTableau(hors) {
      const b = $('#im-creer-fiche');
      if (!b) return;
      b.onclick = () => {
        if (hors.sansFiche.length > 1) return $('#im-tabs button[data-tab=attente]').click();
        const cible = hors.sansFiche[0];
        // La fiche se propose au montant d'AUJOURD'HUI (un avoir postérieur au 31/12 l'a peut-être
        // diminué) : c'est celui de la liste « à immobiliser ».
        const w = waiting.find(x => x.purchaseId === cible.purchaseId && x.lineIndex === cible.lineIndex) || cible;
        assetForm(null, () => render(), { label: w.label, amount: w.amount, date: w.date, supplierId: w.supplierId, purchaseId: w.purchaseId, lineIndex: w.lineIndex });
      };
    }

    function drawTable() {
      const y = Number(s.year);
      const t = C.assetTotals(data, y);
      const hors = C.immosHorsTableau(data, y);
      // 10.12.0 — une entreprise sans AUCUN bien voyait quatre cartes à « 0,000 DT », un export sur
      // rien et une phrase sans bouton (7.0.0 : une liste vide dit à quoi elle sert et donne le geste
      // qui la remplit — ni filtres ni chiffres au-dessus du vide). Si des lignes d'achat attendent
      // leur fiche, c'est ce geste-là, l'étape suivante (U-11).
      if (!data.assets.length) {
        $('#im-body').innerHTML = etatVide('Ce que tu gardes plusieurs années',
          ['Un ordinateur, un véhicule, une machine, du mobilier : un bien qui sert plus d\'un an ne se passe pas en charge d\'un coup, il s\'<b>amortit</b> — une part de sa valeur chaque année, sur sa durée d\'utilisation.',
           waiting.length ? `${pl(waiting.length, 'ligne d\'achat attend', 'lignes d\'achat attendent')} ${waiting.length > 1 ? 'leur fiche : tant qu\'elles n\'existent pas, leur amortissement n\'est' : 'sa fiche : tant qu\'elle n\'existe pas, son amortissement n\'est'} déduit nulle part.`
             : 'Enregistre-le ici avec sa valeur et sa date de mise en service, ou saisis sa facture d\'achat avec la destination «\u00a0immobilisation\u00a0»\u00a0: SkanFact te proposera d\'en créer la fiche.'],
          waiting.length ? [['immo-vers-attente', `Voir ${pl(waiting.length, 'ligne')} à immobiliser`, true], ['immo-premier', '+ Enregistrer un autre bien']]
            : [['immo-premier', '+ Enregistrer mon premier bien', true]]);
        $('#immo-premier').onclick = () => assetForm(null, () => render());
        if ($('#immo-vers-attente')) $('#immo-vers-attente').onclick = () => $('#im-tabs button[data-tab=attente]').click();
        return;
      }
      $('#im-body').innerHTML = `${horsTableauHtml(hors, s.year)}
        <div class="mg-resume im-chiffres">
          <div class="mg-chiffre"><span class="mu">Valeur d'acquisition ${info('immo.gross')}</span><b>${montantU(t.grossActif, cur)}</b><small>${biensAuBilan(t, s.year)}</small></div>
          <div class="mg-chiffre"><span class="mu">Dotation ${s.year} ${info('immo.annuity')}</span><b>${montantU(t.annuity, cur)}</b><small>la charge de l'exercice</small></div>
          <div class="mg-chiffre"><span class="mu">Amortissement cumulé</span><b>${montantU(t.cumulActif, cur)}</b><small>au 31/12/${s.year}, depuis l'origine</small></div>
          <div class="mg-chiffre"><span class="mu">Valeur nette comptable ${info('immo.nbv')}</span><b>${montantU(t.nbv, cur)}</b><small>au 31/12/${s.year} : ce qu'il reste à amortir</small></div>
        </div>
        <div class="panel"><h2>Tableau des amortissements — ${s.year} ${info('immo.table')}</h2>
          ${t.rows.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
            <th>Bien</th><th>Famille</th><th class="r">Mise en service</th><th class="r">Durée</th>
            <th class="r">Valeur HT</th><th class="r">Cumul au 01/01</th><th class="r">Dotation ${s.year} ${info('immo.annuity')}</th><th class="r">Cumul au 31/12</th><th class="r">VNC ${info('immo.nbv')}</th></tr></thead><tbody>
            ${t.rows.map(a => `<tr class="clickable" data-aid="${h(a.id)}">
              <td><strong>${h(a.label)}</strong>${a.out ? `<div class="small warn-text">sorti le ${C.fmtDate(a.disposalResult.date)}</div>` : ''}</td>
              <td>${h(C.assetClassLabel(a.category))}</td>
              <td class="r nw">${C.fmtDate(a.date)}</td>
              <td class="r nw">${a.years} an${a.years > 1 ? 's' : ''}</td>
              ${/* Un total sous une colonne est lu comme sa somme (9.8.8) : ce qui n'y entre pas le DIT. */''}
              <td class="r nw">${a.out ? `<span class="muted">${C.money(a.amount, cur)}</span><div class="small muted">hors total</div>` : C.money(a.amount, cur)}</td>
              <td class="r nw">${C.money(a.opening, cur)}</td>
              <td class="r nw"><strong>${C.money(a.annuity, cur)}</strong></td>
              <td class="r nw">${a.out ? `<span class="muted">${C.money(a.cumulated, cur)}</span><div class="small muted">hors total</div>` : C.money(a.cumulated, cur)}</td>
              <td class="r nw">${a.out ? '<span class="muted">—</span>' : C.money(a.nbv, cur)}</td></tr>`).join('')}
            <tr class="total-row"><td colspan="4"><strong>Total</strong></td>
              <td class="r"><strong>${C.money(t.grossActif, cur)}</strong></td>
              <td class="r"><strong>${C.money(t.opening, cur)}</strong></td>
              <td class="r"><strong>${C.money(t.annuity, cur)}</strong></td>
              <td class="r"><strong>${C.money(t.cumulActif, cur)}</strong></td>
              <td class="r"><strong>${C.money(t.nbv, cur)}</strong></td></tr>
          </tbody></table></div>
          ${t.rows.some(r => r.out) ? `<p class="small muted mt">${t.rows.filter(r => r.out).length > 1 ? 'Les biens sortis' : 'Le bien sorti'} en ${s.year} ${t.rows.filter(r => r.out).length > 1 ? 'comptent' : 'compte'} dans la dotation de l'année, jusqu'au jour de la sortie ; au 31/12, ${t.rows.filter(r => r.out).length > 1 ? 'ils ne sont' : 'il n\'est'} plus à l'actif : ${t.rows.filter(r => r.out).length > 1 ? 'ni leur valeur ni leur cumul n\'entrent' : 'ni sa valeur ni son cumul n\'entrent'} dans le total.</p>` : ''}
          <p class="small muted mt">Amortissement linéaire, au prorata du nombre de jours d'utilisation la première année (base 360). La dotation de l'exercice est une <b>charge</b> : elle est déjà comptée dans le résultat simplifié et dans le seuil de rentabilité. <em>À VÉRIFIER avec ton comptable : les durées retenues et la règle de prorata.</em></p>`
            : '<div class="empty">Aucune immobilisation pour cet exercice. Un bien qui reste dans l\'entreprise — ordinateur, véhicule, mobilier — se saisit ici, ou se crée depuis l\'onglet « À immobiliser » à partir d\'une ligne d\'achat.</div>'}
        </div>`;
      $$('#im-body tr[data-aid]').forEach(tr => tr.onclick = () => navigate('#/immo/' + tr.dataset.aid));
      brancherHorsTableau(hors);
    }

    function drawWaiting() {
      $('#im-body').innerHTML = `
        <div class="panel"><h2>Lignes d'achat à immobiliser ${info('immo.waiting')}</h2>
          <p class="small muted mb">Ces lignes ont été saisies avec la destination « immobilisation ». SkanFact ne crée pas leur fiche tout seul : la durée d'amortissement est une décision, pas une donnée.</p>
          ${waiting.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Date</th><th>Fournisseur</th><th>Désignation</th><th class="r">Valeur HT</th><th></th></tr></thead><tbody>
            ${/* 10.12.0 — deux boutons par ligne, dont un VERT sur chaque ligne : autant de boutons
                 principaux que de lignes (U-11), et une rangée de boutons que la 7.29.0 avait
                 retirée partout ailleurs. La ligne garde UN bouton, celui pour lequel la page
                 existe ; la pièce d'origine s'ouvre en cliquant la ligne, comme dans toute liste.
                 Le vert est l'étape suivante : la ligne la plus récente, et elle seule. */''}
            ${waiting.map((w, i) => `<tr class="clickable" data-open="${h(w.purchaseId)}" title="Ouvrir la facture d'achat (elle s'ouvre en modification)"><td class="nw">${C.fmtDate(w.date)}</td>
              <td>${h(supplierName(w.supplierId))}${w.number ? `<div class="small muted">${h(w.number)}</div>` : ''}</td>
              <td>${h(w.label)}</td><td class="r nw">${C.money(w.amount, cur)}</td>
              <td class="r"><button class="btn btn-sm${i === 0 ? ' btn-primary' : ''}" data-mk="${i}" title="Nom, famille, durée d'amortissement, date de mise en service">Créer la fiche du bien…</button></td></tr>`).join('')}
          </tbody></table></div>`
            : (data.purchases || []).length
              ? '<div class="empty">Rien en attente. Toutes les lignes d\'achat marquées « immobilisation » ont leur fiche.</div>'
              : etatVide('Rien à immobiliser pour l\'instant',
                  ['Une ligne apparaît ici dès que tu saisis un achat dont la destination est <b>« immobilisation »</b> : un ordinateur, un véhicule, du mobilier — tout ce que tu gardes plus d\'un an.',
                   'Tant qu\'une ligne reste en attente, son amortissement n\'est déduit nulle part.'],
                  // Secondaire : le bouton principal de la page est « + Nouveau bien », dans l'en-tête —
                  // deux verts pour deux gestes différents, c'est ne plus dire lequel vient (U-11).
                  [['immo-vers-achats', '+ Saisir une facture d\'achat']])}
        </div>`;
      if ($('#immo-vers-achats')) $('#immo-vers-achats').onclick = () => navigate('#/achat/new');
      $$('#im-body [data-mk]').forEach(b => b.onclick = e => {
        e.stopPropagation();
        const w = waiting[Number(b.dataset.mk)];
        // La dernière fiche créée, l'onglet n'a plus rien à montrer : on arrive au tableau, là où le
        // bien vient d'entrer — pas sur « Rien en attente » (chaque écran finit par le geste suivant).
        assetForm(null, () => { if (!C.assetsToCreate(data).length) s.tab = 'tableau'; render(); }, { label: w.label, amount: w.amount, date: w.date, supplierId: w.supplierId, purchaseId: w.purchaseId, lineIndex: w.lineIndex });
      });
      $$('#im-body [data-open]').forEach(b => b.onclick = () => navigate('#/achat/' + b.dataset.open));
    }

    function drawDisposals() {
      const y = Number(s.year);
      const rows = data.assets.map(a => ({ a, d: C.disposalResult(a) }))
        .filter(x => x.d && Number(x.d.date.slice(0, 4)) === y)
        .sort((x, z) => z.d.date.localeCompare(x.d.date));
      const gain = C.round3(rows.reduce((t, x) => t + Math.max(0, x.d.result), 0));
      const loss = C.round3(rows.reduce((t, x) => t + Math.min(0, x.d.result), 0));
      $('#im-body').innerHTML = `
        <div class="panel"><h2>Sorties de ${s.year} ${info('immo.disposal')}</h2>
          ${rows.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Date</th><th>Bien</th><th>Motif</th><th class="r">Valeur HT</th><th class="r">VNC à la sortie</th><th class="r">Prix obtenu</th><th class="r">Résultat</th><th>Facture</th></tr></thead><tbody>
            ${rows.map(({ a, d }) => `<tr class="clickable" data-aid="${h(a.id)}">
              <td class="nw">${C.fmtDate(d.date)}</td><td><strong>${h(a.label)}</strong></td><td>${h(d.reason) || '<span class="muted">—</span>'}</td>
              <td class="r nw">${C.money(a.amount, cur)}</td><td class="r nw">${C.money(d.nbv, cur)}</td><td class="r nw">${d.price > 0 ? C.money(d.price, cur) : '<span class="muted">sans prix</span>'}</td>
              <td class="r nw ${d.result < 0 ? 'warn-text' : 'ok-text'}"><strong>${C.money(d.result, cur)}</strong></td>
              <td class="nw">${(() => { if (!(d.price > 0)) return '<span class="muted">—</span>'; const f = factureDeCession(a); return f ? (f.status === 'brouillon' ? '<span class="muted">brouillon</span>' : `<a href="#/doc/${h(f.id)}">${h(f.number)}</a>`) : '<span class="warn-text">à facturer</span>'; })()}</td></tr>`).join('')}
          </tbody></table></div>
          ${/* 10.12.0 — « Plus-values : 0,000 DT » en VERT quand il n'y en a aucune : un zéro dans la
               couleur d'une bonne nouvelle. Un total nul se dit « aucune », en gris. */''}
          <p class="small mt">Plus-values : ${gain ? `<b class="ok-text">${C.money(gain, cur)}</b>` : '<span class="muted">aucune</span>'} · Moins-values : ${loss ? `<b class="warn-text">${C.money(loss, cur)}</b>` : '<span class="muted">aucune</span>'}.
          <em>À VÉRIFIER avec ton comptable : une plus-value de cession est en principe imposable, une moins-value déductible.</em></p>`
            : '<div class="empty">Aucune sortie sur cet exercice. Un bien vendu, mis au rebut ou volé se sort depuis sa fiche.</div>'}
        </div>`;
      $$('#im-body tr[data-aid]').forEach(tr => tr.onclick = e => { if (!e.target.closest('a')) navigate('#/immo/' + tr.dataset.aid); });
    }

    const draw = dansUnLot(() => {
      // Une liste d'une seule année ne choisit rien ; l'export est celui du TABLEAU (7.17.0 : un
      // export suit ce qu'on regarde) ; et sans aucun bien, le vert est celui de l'état vide (U-11).
      $('#im-year').hidden = s.tab === 'attente' || years.length < 2;
      $('#im-csv').hidden = s.tab !== 'tableau' || !data.assets.length;
      // Une ligne sans fiche dans l'exercice regardé : « Créer la fiche du bien… » est l'étape
      // suivante, au-dessus du tableau — un seul vert (U-11).
      const sansFicheAn = s.tab === 'tableau' && !(licence.reserves || []).includes('immos')
        && C.immosEnAttente(data, `${s.year}-12-31`).length;
      $('#new-imm').classList.toggle('btn-primary', !!data.assets.length && !(s.tab === 'attente' && waiting.length) && !sansFicheAn);
      if (s.tab === 'attente') return drawWaiting();
      if (s.tab === 'sorties') return drawDisposals();
      drawTable();
    });
    $$('#im-tabs button').forEach(b => b.onclick = () => {
      s.tab = b.dataset.tab;
      $$('#im-tabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      draw();
    });
    $('#im-year').onchange = e => { s.year = e.target.value; draw(); };
    $('#new-imm').onclick = () => assetForm(null, () => render());
    $('#im-csv').onclick = async () => {
      const t = C.assetTotals(data, Number(s.year));
      if (!t.rows.length) return toast('Rien à exporter sur cet exercice.', true);
      const cols = [
        { key: 'label', label: 'Bien' },
        { label: 'Famille', get: a => C.assetClassLabel(a.category) },
        { key: 'date', label: 'Mise en service', type: 'date' },
        { key: 'years', label: 'Durée (ans)' },
        { key: 'amount', label: 'Valeur HT', type: 'money' },
        { key: 'opening', label: 'Cumul au 01/01', type: 'money' },
        { key: 'annuity', label: 'Dotation', type: 'money' },
        { key: 'cumulated', label: 'Cumul au 31/12', type: 'money' },
        { label: 'VNC', type: 'money', get: a => a.out ? 0 : a.nbv },
        { label: 'Sortie', get: a => a.out ? C.fmtDate(a.disposalResult.date) : '' }
      ];
      const f = await bridge.saveText(`immobilisations-${s.year}.csv`, C.toCsv(t.rows, cols));
      if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
    };
    draw();
  };

  routes.immo = (parts) => {
    const a = assetById(parts[0]);
    if (!a) return navigate('#/immos');
    const cur = company().currency;
    const rows = C.assetSchedule(a);
    const dis = C.disposalResult(a);
    const thisYear = Number(C.today().slice(0, 4));
    const buy = a.purchaseId ? purchaseById(a.purchaseId) : null;
    // (1.289.0, Skander : « respecter la DA de ce qu'on a déjà fait avec facture et devis ») La fiche d'un bien prend le
    // squelette des pièces : ‹ vers la liste, chemin, titre et pastille ; frise mise en service → amortissement → fin ; à
    // gauche le plan, l'achat d'origine et les notes ; à droite ce que le bien vaut et ses gestes. Un bien en service n'a
    // pas d'étape suivante (son plan court seul) : la colonne le dit, sans bouton vert (10.12.0).
    const amorti = C.assetCumulated(a, dis ? dis.date : C.today());
    const partAmortie = a.amount ? Math.min(100, Math.round(amorti / a.amount * 1000) / 10) : 0;
    const fin = rows.length ? rows[rows.length - 1].to : '';
    const fini = !dis && !!fin && fin <= C.today();
    const etatImmo = dis ? 'sorti' : fini ? 'amorti' : 'en service';
    const ligneAn = rows.find(r => r.year === thisYear);
    const friseImmo = `<div class="panel ed-frise trois" id="im-frise"><ol>
        <li class="fait"><span class="rond" aria-hidden="true">${lfIc('coche', 13, 3)}</span><span class="ed-fr-txt"><b>Mis en service</b><span>${h(C.fmtDate(a.date))}${buy ? ` · <a href="#/achat/${h(buy.id)}">${h(C.referenceAchat(buy, data))}</a>` : ''}</span></span><span class="vh"> : fait</span></li>
        <li class="${dis || fini ? 'fait' : 'partiel'}"><span class="rond" aria-hidden="true">${dis || fini ? lfIc('coche', 13, 3) : 2}</span><span class="ed-fr-txt"><b>Amortissement</b><span>${pct(partAmortie)} % de sa valeur${dis ? ' à la sortie' : ''}</span></span><span class="vh">${dis || fini ? ' : fait' : ' : en cours'}</span></li>
        <li class="${dis || fini ? 'fait' : ''}"><span class="rond" aria-hidden="true">${dis || fini ? lfIc('coche', 13, 3) : 3}</span><span class="ed-fr-txt"><b>${dis ? 'Sorti' : 'Fin du plan'}</b><span>${dis ? h(C.fmtDate(dis.date)) + (dis.reason ? ' · ' + h(dis.reason) : '') : fin ? (fini ? 'amorti le ' : 'le ') + h(C.fmtDate(fin)) : '—'}</span></span><span class="vh">${dis || fini ? ' : fait' : ' : pas encore'}</span></li>
      </ol></div>`;
    const resumeImmo = `<div class="totals-box" id="im-resume"><table class="ed-tot">
        <tr><td>Valeur d'acquisition</td><td>${h(C.money(a.amount, cur))}</td></tr>
        ${Number(a.residual) ? `<tr class="sous"><td>Valeur résiduelle</td><td>${h(C.money(a.residual, cur))}</td></tr>` : ''}
        <tr><td>Durée</td><td>${a.years} an${a.years > 1 ? 's' : ''}</td></tr>
        <tr><td>Amorti ${dis ? 'à la sortie' : 'à ce jour'}</td><td>${h(C.money(amorti, cur))}</td></tr>
        <tr class="trait"><td>Valeur nette comptable ${info('immo.nbv')}</td><td>${dis ? h(C.money(0, cur)) : h(C.money(C.assetNBV(a, C.today()), cur))}</td></tr>
      </table></div>`;
    const phraseImmo = dis ? (dis.price > 0 ? `Vendu ${h(C.money(dis.price, cur))} : ${dis.result >= 0 ? `plus-value de ${h(C.money(dis.result, cur))}` : `moins-value de ${h(C.money(-dis.result, cur))}`}.` : `Sorti sans prix : moins-value de ${h(C.money(dis.nbv, cur))}.`)
      : fini ? 'Entièrement amorti : il ne coûte plus rien chaque année, et reste au bilan tant que tu le gardes.'
      : `En service : ${ligneAn ? `${h(C.money(ligneAn.annuity, cur))} de dotation en ${thisYear}` : 'pas de dotation cette année'}, jusqu'au ${h(C.fmtDate(fin))}. Rien à faire : le plan court seul.`;
    // (1.289.0) Un bien vendu se facture à l'acheteur : la fiche l'offre tant qu'aucune facture de la cession n'existe,
    // puis montre celle qui existe. Le bouton reste secondaire : la vente a pu être facturée ailleurs.
    const factCession = dis && dis.price > 0 ? factureDeCession(a) : null;
    // Vendu et pas encore facturé : c'est l'étape suivante, le seul bouton vert de la page (rien ne l'impose : la vente a pu
    // être facturée ailleurs, la fiche reste libre).
    const aFacturer = !!(dis && dis.price > 0 && !factCession);
    // Préparée mais pas émise : l'étape suivante est de l'émettre, le bouton vert y mène.
    const brouillonCession = factCession && factCession.status === 'brouillon' ? factCession : null;
    const gesteCession = factCession && !brouillonCession ? `<p class="small" id="im-cession">Facturée : <a href="#/doc/${h(factCession.id)}">${h(factCession.number || 'brouillon de facture')}</a>${factCession.clientId ? ' · ' + h(clientName(factCession.clientId)) : ''}</p>` : '';
    $('#view').innerHTML = `
      <div class="page-head ed-tete">
        ${retourListe('#/immos', 'immobilisations')}<div class="ed-titre">
          <div class="chemin ed-chemin" role="navigation" aria-label="Chemin"><a href="#/dashboard">Accueil</a><span class="sep" aria-hidden="true">›</span><a href="#/immos" class="ed-retour">Immobilisations</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">${h(a.label)}</span></div>
          <div class="ed-h1"><h1>${h(a.label)}</h1><span class="badge ${dis ? '' : fini ? 'facturé' : 'payée'}" id="im-etat">${etatImmo}</span></div>
          <div class="small muted" id="im-sous">${[C.assetClassLabel(a.category), 'mis en service le ' + C.fmtDate(a.date), a.supplierId ? supplierName(a.supplierId) : ''].filter(Boolean).map(h).join(' · ')}</div>
        </div>
        <div class="actions"></div></div>
      <div class="buy-editor editor charte">
        <div class="ed-gauche">
      ${friseImmo}
      ${/* 10.12.0 — un bien sorti n'est pas une erreur : liseré neutre ; la phrase suit le prix. */''}
      ${dis ? `<div class="panel" id="im-sortie">
        <h2>Sorti le ${C.fmtDate(dis.date)}${dis.reason ? ' — ' + h(dis.reason) : ''}</h2>
        <p class="small">${dis.price > 0
          ? `Vendu ${C.money(dis.price, cur)} alors qu'il valait encore ${C.money(dis.nbv, cur)} dans les comptes : ${dis.result >= 0 ? `<b class="ok-text">plus-value de ${C.money(dis.result, cur)}</b>` : `<b class="warn-text">moins-value de ${C.money(-dis.result, cur)}</b>`}.`
          : `Sorti sans prix (mis au rebut, volé) alors qu'il valait encore ${C.money(dis.nbv, cur)} dans les comptes : <b>moins-value de ${C.money(dis.nbv, cur)}</b>.`}
        <em>À VÉRIFIER avec ton comptable.</em></p>
        ${vatWarning(a, dis.date, { passe: true }) ? `<p class="small warn-text">${vatWarning(a, dis.date, { passe: true })}</p>` : ''}</div>` : ''}
      <div class="panel"><h2>Plan d'amortissement ${info('immo.plan')}</h2>
        ${rows.length ? `<div class="scroll-x"><table class="list compact" id="im-plan"><thead><tr><th>Exercice</th><th>Période</th><th class="r">Jours</th><th class="r">Dotation</th><th class="r">Cumul</th><th class="r">VNC au 31/12</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="${r.year === thisYear ? 'row-now' : ''}">
            <td><strong>${r.year}</strong>${r.year === thisYear ? ' <span class="small muted">(exercice en cours)</span>' : ''}</td>
            <td class="nw">${C.fmtDate(r.from)} → ${C.fmtDate(r.to)}</td>
            <td class="r nw">${r.days}</td><td class="r nw"><strong>${C.money(r.annuity, cur)}</strong></td>
            <td class="r nw">${C.money(r.cumulated, cur)}</td><td class="r nw">${C.money(r.nbv, cur)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Plan indisponible : vérifie la valeur, la durée et la date de mise en service.</div>'}
        ${dis ? `<p class="small muted mt">Ce tableau est le plan <b>d'origine</b>, celui qui aurait couru si le bien était resté. Il est sorti le ${C.fmtDate(dis.date)} : l'exercice ${dis.date.slice(0, 4)} n'a été amorti que jusqu'à ce jour-là (${C.money(C.round3(C.assetCumulated(a, dis.date) - C.assetCumulated(a, `${Number(dis.date.slice(0, 4)) - 1}-12-31`)), cur)}), et les suivants n'ont plus aucune dotation. C'est ce que montre le tableau des amortissements de l'exercice.</p>` : ''}
      </div>
      ${buy ? `<div class="panel"><h2>Achat d'origine</h2>
        <p class="small">Ce bien vient de la pièce <a href="#/achat/${h(buy.id)}">${h(C.referenceAchat(buy, data))}</a> du ${C.fmtDate(buy.date)}${buy.supplierId ? ', ' + h(supplierName(buy.supplierId)) : ''}. Modifier l'achat ne change pas cette fiche : la valeur immobilisée est recopiée à la création.</p></div>` : ''}
      ${a.notes ? `<div class="panel"><h2>Notes</h2><p class="small">${C.nl2br(a.notes)}</p></div>` : ''}
        </div>
        <aside class="ed-droite">
          <div class="panel ed-totaux">${resumeImmo}</div>
          ${aFacturer ? `<div class="panel ed-geste" id="ed-geste"><button class="btn btn-primary btn-grand" id="im-facturer">Facturer la cession</button>
            <p class="ed-phrase">${phraseImmo} Il reste à facturer l'acheteur : la facture s'ouvre avec le bien et son prix.</p>`
          : brouillonCession ? `<div class="panel ed-geste" id="ed-geste"><button class="btn btn-primary btn-grand" id="im-cession-ouvrir">Émettre la facture de la cession</button>
            <p class="ed-phrase">${phraseImmo} Sa facture est préparée${brouillonCession.clientId ? ' pour ' + h(clientName(brouillonCession.clientId)) : ''}, pas encore émise.</p>` : `<div class="panel ed-geste ed-geste-calme" id="ed-geste"><p class="ed-phrase ed-etat">${lfIc('coche', 16, 2.4)}<span>${phraseImmo}</span></p>`}
            <div class="ed-deux"><button class="btn" id="edit-imm">Modifier</button><button class="btn" id="dispose">${dis ? 'Modifier la sortie' : 'Sortir du patrimoine'}</button></div>${gesteCession}</div>
        </aside>
      </div>`;
    $('#edit-imm').onclick = () => assetForm(a, () => render());
    $('#dispose').onclick = () => disposalForm(a, () => render());
    if ($('#im-facturer')) $('#im-facturer').onclick = () => navigate(`#/doc/new/facture/cession/${a.id}`);
    if ($('#im-cession-ouvrir')) $('#im-cession-ouvrir').onclick = () => navigate(`#/doc/${brouillonCession.id}`);
  };

  // ---------- Trésorerie ----------
  const tresoState = { tab: 'position', account: '', days: 90, year: C.today().slice(0, 4), showPointed: false, mode: 'echeance', q: '', sens: '', decalages: {},
    moves: { sort: null, page: 1 }, effets: { page: 1 },
    // Le détail de la prévision et les deux listes du rapprochement sont paginés (10.14.0) : avec
    // huit mille pièces, « Pas encore pointés » faisait neuf mille lignes — quatre cent cinquante
    // mille pixels, et chaque case cochée redessinait le tout.
    prevision: { page: 1 }, pending: { page: 1 }, pointes: { page: 1 } };
  const TRESO_TABS = [['position', 'Où j\'en suis'], ['prevision', 'Ce qui arrive'], ['mouvements', 'Mouvements'], ['rapprochement', 'Rapprochement']];

  // Le compte que la fiche société porte déjà, s'il n'existe pas encore (`C.compteDepuisFiche`).
  const modeleCompte = () => C.compteDepuisFiche(company(), data.accounts);
  // Le bouton NOMME la banque quand la fiche la porte : « Créer le compte « BIAT » » dit ce qui va
  // naître, « Créer un compte » laisse deviner qu'il faudra tout retaper.
  const libelleCompteDepuisFiche = (avecBanque, sans) => { const m = modeleCompte(); return m && m.bank ? `${avecBanque} « ${h(m.bank)} »` : sans; };

  function accountForm(acc, done, modele, opts) {
    // (plateforme) 1.134.0 — le refus arrive à l'ouverture, avant la saisie.
    if (!acc && licenceBlock('Créer un compte de trésorerie', 'pilotage')) return;
    const a = acc || { id: C.uid(), name: '', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: C.today(), isDefault: !data.accounts.length, statementBalance: '', notes: '', ...(modele || {}) };
    // Un compte né de la fiche société n'attend plus qu'UNE chose : son solde. Le curseur y va, la
    // valeur proposée (0) sélectionnée — la première frappe la remplace (9.4.5).
    const depuisFiche = !acc && !!(modele && (modele.bank || modele.rib));
    modal(`<h2>${acc ? 'Modifier le compte' : 'Nouveau compte'}</h2>
      <p class="small muted">${depuisFiche
        ? '<b>Banque et RIB viennent de ta fiche société</b> : il ne te reste que le <b>solde de départ</b> — celui de ton relevé au jour où tu commences à suivre ce compte dans SkanFact. Tout ce qui est saisi après s\'y ajoute.'
        : 'Le <b>solde de départ</b> est celui de ton relevé au jour où tu commences à suivre ce compte dans SkanFact. Tout ce qui est saisi après s\'y ajoute.'}</p>
      <form id="af" class="grid-2">
        <label class="field span-2 obligatoire">${lbl('Nom du compte', 'tre.name')}<input type="text" name="name" value="${h(a.name)}" placeholder="ex. Attijari — compte courant" required></label>
        <label class="field">${lbl('Type', 'tre.kind')}<select name="kind">${C.ACCOUNT_KINDS.map(([v, l]) => `<option value="${v}" ${a.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field(lbl('Banque', 'tre.bank'), 'bank', a.bank || '')}
        ${ribField('RIB', a.rib)}
        ${field(lbl(`Solde de départ (${h(C.normCurrency(company().currency))})`, 'tre.opening'), 'opening', a.opening || 0, 'number', 'step="0.001" class="num"')}
        ${dateFieldHtml(lbl('À la date du', 'tre.openingDate'), 'openingDate', a.openingDate || C.today(), {})}
        <label class="check span-2"><input type="checkbox" name="isDefault" ${a.isDefault ? 'checked' : ''}> Compte par défaut ${info('tre.default')}</label>
        <label class="field span-2">${lbl('Notes', 'tre.notes')}<input type="text" name="notes" value="${h(a.notes || '')}"></label>
      </form>
      <div class="modal-actions">
        ${acc ? '<button class="btn btn-danger" id="del-acc" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        if (depuisFiche) { const o = $('[name=opening]', root); o.focus(); o.select(); }
        // (plateforme) 1.74.0 — ouverte pour UNE case (le RIB que l'ordre de virement réclame), elle y met le curseur.
        if (opts && opts.focus) { const c = $(`[name=${opts.focus}]`, root); if (c) c.focus(); }
        $('#ok', root).onclick = () => {
          const v = formValues($('#af', root));
          if (!v.name.trim()) return refus($('[name=name]', root), 'Donne un nom à ce compte.');
          if (!acc && licenceBlock('Créer un compte de trésorerie', 'pilotage')) return;
          // Le solde de départ et sa date sont le point zéro de toute la trésorerie : les changer
          // après coup déplace tous les soldes, y compris ceux des mois déjà clôturés.
          if (acc && (Number(v.opening) !== Number(acc.opening) || v.openingDate !== acc.openingDate)
              && closedBlock([acc.openingDate, v.openingDate], 'Ce solde de départ')) return;
          Object.assign(a, v, { opening: Number(v.opening) || 0 });
          if (a.isDefault) data.accounts.forEach(x => { if (x.id !== a.id) x.isDefault = false; });
          else if (!data.accounts.some(x => x.isDefault && x.id !== a.id)) a.isDefault = true;   // il en faut toujours un
          // Une caisse créée la première (10.15.0, H5 : « Créer la caisse » avant tout compte bancaire) est
          // le compte par défaut faute d'autre : le premier compte BANCAIRE reprend ce rôle, sinon les
          // virements des clients continueraient d'arriver dans le tiroir.
          if (!acc && a.kind !== 'caisse' && !a.isDefault) {
            const d = data.accounts.find(x => x.isDefault);
            if (d && d.kind === 'caisse') { d.isDefault = false; a.isDefault = true; }
          }
          if (!acc) data.accounts.push(a);
          save(true); close(); if (done) done(a);
        };
        if ($('#del-acc', root)) $('#del-acc', root).onclick = async () => {
          // Ce que la suppression fait, dit comme le moteur le fera (10.14.1) : un mouvement bascule
          // sur le compte par défaut, mais un VIREMENT avec un autre compte reste sur cet autre compte
          // — c'est ce que son relevé dit —, sa contrepartie passant au compte d'attente.
          const lignes = C.cashMovements(data, company(), {}, a.id);
          const vir = lignes.filter(x => x.virement).length, n = lignes.length - vir;
          const phraseMv = n ? ` ${pl(n, 'mouvement')} y ${n > 1 ? 'sont rattachés : ils basculeront' : 'est rattaché : il basculera'} sur le compte par défaut.` : '';
          const phraseVir = vir ? ` ${vir > 1 ? `${vir} virements avec tes autres comptes resteront sur ces comptes` : 'Un virement avec un autre de tes comptes restera sur cet autre compte'} : ${vir > 1 ? 'leur' : 'sa'} contrepartie passera au compte d'attente (471), où ton comptable la verra.` : '';
          if (!await confirmDialog(`Supprimer « ${a.name} » ?${phraseMv}${phraseVir}`)) return;
          forget('accounts', a.id, a.name);
          data.accounts = data.accounts.filter(x => x.id !== a.id);
          if (data.accounts.length && !data.accounts.some(x => x.isDefault)) data.accounts[0].isDefault = true;
          save(true); close(); render();
        };
      });
  }

  // (1.266.0) `preset` : un mouvement neuf qui naît déjà sur un compte (le menu ⋯ d'un compte de la Trésorerie).
  function movementForm(mv, done, preset) {
    // (plateforme) 1.134.0 — le refus arrive à l'ouverture, avant la saisie.
    if (!mv && licenceBlock('Créer un mouvement de trésorerie', 'pilotage')) return;
    const m = mv || { id: C.uid(), date: C.today(), kind: 'autre-sortie', amount: 0, accountId: (data.accounts.find(a => a.isDefault) || data.accounts[0] || {}).id || '', label: '', reference: '', method: 'virement', ...(preset || {}) };
    // Les justificatifs d'un mouvement libre (10.14.1, S-04) : la quittance d'un loyer payé sans
    // facture, l'avis d'imposition, le relevé qui prouve des frais bancaires. Un mouvement sans facture
    // n'a QUE ce fichier pour se justifier — et il part dans le paquet du comptable. Sur un mouvement
    // neuf, les copies partent avec l'enregistrement, et une fenêtre abandonnée les retire ; sur un
    // mouvement rangé, le fichier s'enregistre tout de suite (comme dans l'éditeur d'un achat).
    const ajoutes = [];
    let enregistre = false;
    let champs = null;
    const opts = {
      garde: () => (champs ? champs() : false) || ajoutes.length > 0,
      perte: 'Ce que tu viens de saisir dans cette fenêtre ne sera pas enregistré.'
    };
    modal(`<h2>${mv ? 'Modifier le mouvement' : 'Nouveau mouvement'}</h2>
      <p class="small muted">Ce qui n'a ni facture ni achat : salaires, impôts, frais bancaires, apport, retrait${data.accounts.length > 1 ? ', virement entre tes comptes' : ''}. Les encaissements clients et les règlements fournisseurs n'ont <b>pas</b> à être saisis ici — ils remontent tout seuls.</p>
      <form id="mf2" class="grid-2">
        ${dateFieldHtml(lbl('Date', 'tre.moveDate'), 'date', m.date, { obligatoire: true })}
        <label class="field">${lbl('Nature', 'tre.moveKind')}<select name="kind">${C.MOVE_KINDS
          // Un virement entre deux comptes ne se propose qu'avec deux comptes (10.14.0) : on ne propose
          // pas un geste qui sera refusé. Un virement déjà saisi garde sa nature, quoi qu'il arrive.
          .filter(([v]) => v !== 'virement' || data.accounts.length > 1 || m.kind === 'virement')
          .map(([v, l, s]) => `<option value="${v}" ${m.kind === v ? 'selected' : ''}>${v === 'virement' ? '⇄' : s > 0 ? '↑' : '↓'} ${l}</option>`).join('')}</select></label>
        ${obligatoire(field(lbl(`Montant (${h(C.normCurrency(company().currency))})`, 'tre.moveAmount'), 'amount', Math.abs(m.amount) || 0, 'number', 'step="0.001" min="0" class="num"'))}
        <label class="field">${lbl('Compte', 'tre.moveAccount')}<select name="accountId">${data.accounts.map(a => `<option value="${a.id}" ${m.accountId === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select></label>
        <label class="field span-2">${lbl('Libellé', 'tre.moveLabel')}<input type="text" name="label" value="${h(m.label || '')}" placeholder="Salaires de septembre"></label>
        ${field(lbl('Référence', 'tre.moveRef'), 'reference', m.reference || '', 'text', 'placeholder="N° de chèque, référence du virement…"')}
        <label class="field">${lbl('Mode', 'tre.moveMethod')}<select name="method">${C.PAYMENT_METHODS.map(([v, l]) => `<option value="${v}" ${m.method === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field mf-rep">${lbl('Se répète', 'tre.repete')}<select name="repete">${[['', 'Non, une seule fois'], ['mois', 'Chaque mois'], ['trimestre', 'Chaque trimestre'], ['annee', 'Chaque année']].map(([v, l]) => `<option value="${v}" ${(m.repete || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="mf-rep mf-jusqu">${dateFieldHtml(lbl('Jusqu\'au (facultatif)', 'tre.repeteJusqu'), 'repeteJusqu', m.repeteJusqu || '', {})}</div>
        <label class="field span-2" id="mf-cp" ${m.kind === 'virement' ? 'hidden' : ''}>${lbl('Contrepartie comptable', 'tre.compte')}<select name="compte">${C.COMPTES_CONTREPARTIE.map(([v, l]) => `<option value="${v}" ${String(m.compte || '') === v ? 'selected' : ''}>${v ? v + ' — ' : ''}${l}</option>`).join('')}${m.compte && !C.COMPTES_CONTREPARTIE.some(([v]) => v === String(m.compte)) ? `<option value="${h(m.compte)}" selected>${h(m.compte)} — ${h(C.accountLabel(data, m.compte))}</option>` : ''}</select></label>
        <label class="field span-2" id="mf-vers" ${m.kind === 'virement' ? '' : 'hidden'}>${lbl('Vers le compte', 'tre.moveVers')}<select name="versAccountId"><option value="">— Choisir le compte qui reçoit —</option>${data.accounts.map(a => `<option value="${a.id}" ${m.versAccountId === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select></label>
      </form>
      ${avertValideHtml('mf-valide')}
      <div class="mv-pj"><div class="field">${lbl('Justificatifs', 'tre.moveJustif')}</div><div id="mv-pj"></div></div>
      <div class="modal-actions">
        ${mv ? '<button class="btn btn-danger" id="del-mv" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => {
        // La contrepartie comptable et le compte qui reçoit vivent à la MÊME place : un virement n'a
        // pas de contrepartie à choisir, c'est le compte d'arrivée (règle H-E1 : ce qui apparaît
        // selon une valeur ne pousse rien).
        const kindSel = $('[name=kind]', root), versSel = $('[name=versAccountId]', root);
        // Pour un virement, le compte choisi est celui d'où l'argent PART, et le libellé laissé vide
        // s'écrira « Virement vers … » : l'invite le montre avant qu'on l'enregistre.
        const texteCompte = $('[name=accountId]', root).closest('label').querySelector('.fl').firstChild;
        const libelle = $('[name=label]', root);
        const accorder = () => {
          const vir = kindSel.value === 'virement';
          $('#mf-cp', root).hidden = vir; $('#mf-vers', root).hidden = !vir;
          texteCompte.data = vir ? 'Depuis le compte ' : 'Compte ';
          // Le compte d'où l'argent part ne se propose pas comme compte d'arrivée : l'enregistrement le
          // refuserait (10.14.1 — on ne propose pas un choix qui sera refusé).
          const depuis = $('[name=accountId]', root).value;
          [...versSel.options].forEach(o => { o.hidden = !!o.value && o.value === depuis; });
          if (versSel.value && versSel.value === depuis) versSel.value = '';
          const cible = data.accounts.find(a => a.id === versSel.value);
          libelle.placeholder = vir ? (cible ? `Virement vers ${cible.name}` : 'Virement vers le compte choisi') : 'Salaires de septembre';
          // (1.266.0) Un virement entre tes comptes ne se répète pas ici ; « jusqu'au » n'a de sens que pour ce qui revient.
          // Les deux gardent leur place (visibilité seule) : rien ne bouge sous le curseur.
          $$('.mf-rep', root).forEach(x => { x.style.visibility = vir ? 'hidden' : ''; });
          $('.mf-jusqu', root).style.visibility = vir || !$('[name=repete]', root).value ? 'hidden' : '';
        };
        $('[name=repete]', root).addEventListener('change', accorder);
        kindSel.addEventListener('change', accorder);
        versSel.addEventListener('change', accorder);
        $('[name=accountId]', root).addEventListener('change', accorder);
        accorder();
        // (1.304.0) Daté dans la période que le cabinet a validée : la phrase pendant la saisie, comme le paiement d'une facture.
        // Rouvert sans rien changer de ce qui s'écrit chez lui (date, nature, montant, compte, contrepartie, compte qui reçoit),
        // rien : un libellé ou une référence ne change pas ses livres.
        const empreinteMv = x => JSON.stringify([x.date, x.kind, Math.abs(Number(x.amount)) || 0, x.accountId || '', x.kind === 'virement' ? '' : String(x.compte || '').trim(), x.kind === 'virement' ? x.versAccountId || '' : '']);
        const valideDuMouvement = (v, quandLu) => (!mv || empreinteMv(v) !== empreinteMv(mv) ? dateDansLaPeriodeValidee([v.date, mv && mv.date], quandLu) : '');
        const majValideM = () => { const v = formValues($('#mf2', root)); majAvertValide($('#mf-valide', root), valideDuMouvement(v, majValideM), v.date, { sujet: 'Ce mouvement', fem: false, neuve: !mv, geste: 'En l\'enregistrant' }); };
        $('#mf2', root).addEventListener('input', majValideM);
        $('#mf2', root).addEventListener('change', majValideM);
        majValideM();
        // L'instantané des champs APRÈS le montage et les montants complétés (modal() le fait juste
        // après ce rappel) : le garde-fou additionne les champs et les fichiers joints.
        queueMicrotask(() => { champs = suivreSaisie(root); });
        // (1.163.0, Skander le 27/10/2026) Le panneau des justificatifs de toute pièce : les fichiers par leur nom, l'aperçu de
        // celui qu'on regarde, « Joindre un autre fichier » (clic ou glissé).
        const etatPj = {};
        const drawPj = () => {
          const el = $('#mv-pj', root); if (!el) return;
          panneauJustificatifs(el, {
            ownerId: m.id, list: m.attachments || [], etat: etatPj,
            vide: `<button type="button" class="ac-vide-j" id="add-att">${lfIc('photo', 26, 1.6)}<b>Joindre un justificatif</b><span>Un mouvement sans facture — un loyer, un impôt, des frais bancaires — n'a que ce fichier pour se prouver : c'est lui que ton comptable demandera. Clique, ou glisse-le ici.</span></button>`,
            joindre: async f => {
              try {
                const nouveaux = (await bridge.addAttachments(m.id, f)).filter(Boolean);
                if (!nouveaux.length) return;
                m.attachments = (m.attachments || []).concat(nouveaux);
                if (mv) save(true); else ajoutes.push(...nouveaux);
                justificatifsJoints(etatPj, nouveaux);
                drawPj();
                toast(nouveaux.length > 1 ? `${nouveaux.length} justificatifs joints` : `Justificatif joint : ${nouveaux[0].name || 'le fichier'}`);
              } catch (e) { toast(plainError(e), true); }
            },
            retirer: async a => {
              if (!await retirerJustificatif(m.id, a)) return;
              m.attachments = (m.attachments || []).filter(x => x.file !== a.file);
              const i = ajoutes.findIndex(x => x.file === a.file); if (i >= 0) ajoutes.splice(i, 1);
              if (mv) save(true);
              drawPj();
            },
          });
        };
        drawPj();
        $('#ok', root).onclick = async () => {
          const v = formValues($('#mf2', root));
          // (plateforme) 1.75.0 — le refus dit ce qui est attendu, comme le paiement d'une facture.
          if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Écris le montant en chiffres, plus grand que zéro : par exemple 250,500.');
          if (!v.date) return refus($('[name=date]', root), 'Date invalide.');
          if (v.kind === 'virement' && !v.versAccountId) return refus($('[name=versAccountId]', root), 'Choisis le compte qui reçoit l\'argent.');
          if (v.kind === 'virement' && v.versAccountId === v.accountId) return refus($('[name=versAccountId]', root), 'Un virement va d\'un compte à un AUTRE : choisis le compte qui reçoit l\'argent.');
          if (!mv && licenceBlock('Créer un mouvement de trésorerie', 'pilotage')) return;
          if (v.date > C.today() && !await confirmDialog(`La date (${C.fmtDate(v.date)}) est dans le futur. Un mouvement de trésorerie se saisit quand il a eu lieu. Enregistrer quand même ?`, 'Enregistrer', undefined, { titre: 'Un mouvement daté dans le futur' })) return;
          if (closedBlock([mv && mv.date, v.date], 'Ce mouvement')) return;
          // Lu AVANT de ranger : `m` est le mouvement rangé lui-même quand on le modifie.
          const dvM = valideDuMouvement(v);
          const vir = v.kind === 'virement';
          Object.assign(m, v, { amount: Math.abs(Number(v.amount)), compte: vir ? '' : String(v.compte || '').trim() });
          if (!vir) { delete m.versAccountId; delete m.reconciledVers; }
          if (vir || !m.repete) { delete m.repete; delete m.repeteJusqu; } else if (!m.repeteJusqu) delete m.repeteJusqu;
          if (!mv) data.movements.push(m);
          enregistre = true;
          save(true); close();
          if (dvM) direAuComptableApres(mv ? 'Mouvement modifié' : 'Mouvement enregistré', { fait: mv ? 'de modifier' : 'd\'enregistrer', fem: false, quoi: `un mouvement daté du ${C.fmtDate(dvM)} (${m.label || (C.MOVE_KINDS.find(k => k[0] === m.kind) || [])[1] || 'mouvement'}, ${C.money(m.amount, company().currency)})` });
          if (done) done(m);
        };
        if ($('#del-mv', root)) $('#del-mv', root).onclick = async () => {
          const pj = (m.attachments || []).length;
          // (1.304.0) La date RANGÉE (celle que le cabinet a lue), pas celle qu'on aurait tapée sans enregistrer.
          await periodeValideeLue();
          const dvSup = dateDansLaPeriodeValidee([m.date]);
          if (!await confirmDialog(`Supprimer ce mouvement ?${pj ? ` ${pj > 1 ? `Ses ${pj} justificatifs partent` : 'Son justificatif part'} avec lui.` : ''}${dvSup ? ` ${phraseAnnulationValidee(dvSup, { sujet: 'Il', fem: false })}` : ''}`, 'Supprimer')) return;
          if (closedBlock(m.date, 'Ce mouvement')) return;
          forget('movements', m.id, m.label || '');
          (m.attachments || []).forEach(a => { try { bridge.removeAttachment(m.id, a.file); } catch (_) { /* une copie déjà partie */ } });
          data.movements = data.movements.filter(x => x.id !== m.id); enregistre = true; save(true); close(); render();
          if (dvSup) direAuComptableApres('Mouvement supprimé', { fait: 'de supprimer', fem: false, annule: true, quoi: `un mouvement daté du ${C.fmtDate(dvSup)} (${m.label || (C.MOVE_KINDS.find(k => k[0] === m.kind) || [])[1] || 'mouvement'}, ${C.money(m.amount, company().currency)})` });
        };
      },
      // Une fenêtre abandonnée ne laisse pas de copie derrière elle (le jumeau de `discard` des
      // éditeurs, 8.5.1) : le fichier d'origine ne bouge pas, seule la copie rangée part.
      () => { if (!enregistre && !mv) ajoutes.forEach(a => { try { bridge.removeAttachment(m.id, a.file); } catch (_) { /* rien à retirer */ } }); },
      opts);
  }

  routes.tresorerie = () => {
    const cur = company().currency;
    const s = tresoState;
    if (!data.accounts.length) {
      // 10.14.0 — la fiche société porte déjà la banque et le RIB : l'état vide le DIT, et le compte
      // naît avec. Il ouvrait un formulaire vide, où il fallait retaper ce qu'on venait de donner.
      const m = modeleCompte();
      const quoi = m ? [m.bank ? `ta banque (<b>${h(m.bank)}</b>)` : '', m.rib ? 'ton RIB' : ''].filter(Boolean).join(' et ') : '';
      $('#view').innerHTML = `<div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Trésorerie</span></div><h1>Trésorerie</h1><p class="sous">Ce que tu as, ce qui va rentrer et sortir, et ton relevé pointé</p></div></div>
        ${etatVide('Est-ce que j\'aurai de quoi payer le mois prochain ?', [
          'Pour y répondre, SkanFact a besoin de savoir ce que tu as aujourd\'hui. Crée ton compte bancaire et saisis son solde actuel — il reprendra ensuite tout seul tes encaissements et tes règlements.',
          ...(m ? [`<span id="tre-depuis-fiche">Ta fiche société porte déjà ${quoi} : le compte naît avec. Il ne te reste que son solde d'aujourd'hui.</span>`] : []),
          'Rien à ressaisir : les paiements clients et les règlements fournisseurs déjà enregistrés remontent automatiquement.'],
          [['first-acc', '+ ' + (m && m.bank ? `Créer le compte « ${m.bank} »` : 'Créer mon premier compte'), true]])}`;
      $('#first-acc').onclick = () => accountForm(null, () => render(), modeleCompte());
      return;
    }
    // (1.266.0, Skander 03/11 : « go la trésorerie », dans la nouvelle DA, comme les marges) L'en-tête des listes (chemin,
    // phrase), quatre chiffres au lieu de quatre tuiles, les onglets segmentés de la Paie avec leur nombre, et sous eux
    // une seule carte. Le trou de trésorerie se dit en bandeau, sur toutes les vues : c'est la seule chose qui presse.
    const t0 = C.today();
    const pos0 = C.cashPosition(data, company(), t0);
    const f30 = C.cashForecast(data, company(), 30, t0);
    const p30 = C.cashForecast(data, company(), 30, t0, { prudent: true });
    // (1.266.0) Le seuil que l'entreprise se fixe (zéro par défaut) : les phrases le nomment quand il n'est pas zéro.
    const seuilT = f30.seuil;
    const sousSeuil = seuilT ? `sous ton seuil (${C.money(seuilT, cur)})` : 'sous zéro';
    const retards30 = C.round3(f30.late.clients.reduce((x, e) => x + e.amount, 0));
    const nbRetards30 = f30.late.clients.length;
    const recos = data.accounts.map(a => ({ a, r: C.reconciliation(data, company(), a.id, t0) }));
    const aPointer = recos.reduce((n, x) => n + x.r.moves.filter(m => !m.reconciled).length, 0);
    const nbMouvAn = C.cashMovements(data, company(), { from: `${s.year}-01-01`, to: `${s.year}-12-31` }, null).length;
    const compteTr = { mouvements: nbMouvAn, rapprochement: aPointer };
    const chiffreT = (lbl2, val, sous, ton, bulle) => `<div class="mg-chiffre"><span class="mu">${lbl2}${bulle ? ' ' + info(bulle) : ''}</span><b class="${ton || ''}">${val}</b><small>${sous}</small></div>`;
    const trou = f30.shortfall;
    const trouP = !trou && p30.shortfall && retards30 > 0 ? p30.shortfall : null;
    const bandeauT = trou
      ? `<div class="bandeau rouge tr-trou" role="status">${lfIc('alerte', 18, 2)}<span class="txt"><b>Ton solde passe ${sousSeuil} le ${C.fmtDate(trou.date)}</b><span>Si tout se passe comme prévu, après « ${h(trou.label)} ». Au plus bas : ${C.money(trou.lowest.balance, cur)} le ${C.fmtDate(trou.lowest.date)}. Un trou anticipé se négocie avec la banque ; un trou constaté se subit.</span></span></div>`
      : trouP
        ? `<div class="bandeau ambre tr-trou" role="status">${lfIc('alerte', 18, 2)}<span class="txt"><b>Sans les factures en retard, ton solde passe ${sousSeuil} le ${C.fmtDate(trouP.date)}</b><span>${C.money(retards30, cur)} sont déjà échus chez tes clients et la prévision compte dessus. S'ils ne rentrent pas, il descend jusqu'à ${C.money(trouP.lowest.balance, cur)}.</span></span></div>`
        : '';
    // (1.266.0) UN bouton principal : l'étape suivante, calculée. Voir le trou s'il y en a un ; sinon relancer ce qui est
    // déjà dû ; sinon pointer le relevé ; quand tout est en ordre, noter un mouvement.
    const premierAPointer = (recos.find(x => x.r.moves.some(m => !m.reconciled)) || {}).a;
    const principalT = trou ? { id: 'tr-voir-trou', ic: 'echeance', l: 'Voir ce qui arrive' }
      : retards30 > 0 ? { id: 'tr-relancer', ic: 'cloche', l: nbRetards30 > 1 ? `Relancer ${nbRetards30} factures` : 'Relancer la facture en retard' }
        : aPointer > 0 ? { id: 'tr-pointer', ic: 'coche', l: 'Pointer le relevé' } : null;
    const sous30 = [trou ? `${sousSeuil} le ${C.fmtDate(trou.date)}` : '', retards30 > 0 ? `sans les retards : ${h(C.money(p30.end, cur))}` : ''].filter(Boolean).join(' · ') || 'aucun trou prévu';
    $('#view').innerHTML = `
      <div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Trésorerie</span></div><h1>Trésorerie</h1><p class="sous">Ce que tu as, ce qui va rentrer et sortir, et ton relevé pointé</p></div>
        <div class="actions"><button class="btn" id="new-acc">${lfIc('croix', 15, 2.4)} Compte</button><button class="btn${principalT ? '' : ' btn-primary'}" id="new-move">${lfIc('croix', 15, 2.4)} Mouvement</button>${principalT ? `<button class="btn btn-primary" id="${principalT.id}">${lfIc(principalT.ic, 15, 2.2)} ${h(principalT.l)}</button>` : ''}</div></div>
      ${bandeauT}${bandeauSansPaie('ces soldes et cette prévision', true)}
      <div class="lf mg tr">
        <div class="cf-carte mg-resume" id="tr-resume">
          ${chiffreT('Disponible aujourd\'hui', montantU(pos0.total, cur), pl(pos0.accounts.length, 'compte'), pos0.total < seuilT ? 'rouge' : '', 'tre.total')}
          ${chiffreT('À encaisser sous 30 jours', montantU(f30.inflow, cur), retards30 > 0 ? `dont ${h(C.money(retards30, cur))} déjà échus` : 'rien d\'échu', '', 'dash.open')}
          ${chiffreT('À décaisser sous 30 jours', montantU(-f30.outflow, cur), f30.estimes < -0.0005 ? `dont ${h(C.money(-f30.estimes, cur))} estimés` : paieCachee() ? 'achats et saisies, sans les salaires' : 'achats, salaires, saisies', '', 'tre.decaisser')}
          ${chiffreT('Dans 30 jours', montantU(f30.end, cur), sous30, trou || f30.end < seuilT ? 'rouge' : 'vert', 'tre.projected')}
        </div>
        <div class="mg-barre"><div class="pa-seg" id="t-tabs" role="tablist" aria-label="La trésorerie">${TRESO_TABS.map(([id, label]) =>
          `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === s.tab}" class="${id === s.tab ? 'active' : ''}">${label}${compteTr[id] ? ` <small>${compteTr[id]}</small>` : ''}</button>`).join('')}</div></div>
        <div class="cf-carte"><div class="cf-onglet" id="t-body"></div></div></div>`;
    if ($('#tr-voir-trou')) $('#tr-voir-trou').onclick = () => { s.tab = 'prevision'; render(true); };
    if ($('#tr-relancer')) $('#tr-relancer').onclick = () => navigate('#/relances');
    if ($('#tr-pointer')) $('#tr-pointer').onclick = () => { if (premierAPointer) s.account = premierAPointer.id; s.tab = 'rapprochement'; render(true); };

    const draw = dansUnLot(() => {
      if (s.tab === 'prevision') return drawForecast();
      if (s.tab === 'mouvements') return drawMoves();
      if (s.tab === 'rapprochement') return drawReco();
      drawPosition();
    });

    // (1.298.0) Noter payée une échéance d'une dépense qui revient : le mouvement naît de celui d'origine, daté de son
    // occurrence (aujourd'hui si elle est à venir), et la prévision ne la projette plus (`repeteDe` + `occurrence`).
    const noterRepete = e => {
      const src = e && (data.movements || []).find(x => x.id === e.movementId);
      if (!src) return;
      const quand = e.occurrence || e.date;
      movementForm(null, () => render(true), {
        kind: src.kind, amount: Math.abs(Number(src.amount) || 0), accountId: src.accountId, label: src.label || '', method: src.method || 'virement',
        compte: src.compte || '', date: quand > C.today() ? C.today() : quand, repeteDe: src.id, occurrence: quand });
    };

    // --- Où j'en suis
    // (1.266.0) Chaque compte en carte : son solde, la courbe de ses trente derniers jours, jusqu'où son relevé est pointé
    // et ce qui reste à pointer, son menu ⋯ ; le disponible au pied. Puis ce qui demande un geste (l'argent déjà dû par les
    // clients, ce que l'entreprise doit déjà, la prochaine échéance fiscale) et les effets en portefeuille.
    function drawPosition() {
      const pos = pos0, f = f30;
      const kindDe = a => (C.ACCOUNT_KINDS.find(k => k[0] === a.kind) || [, a.kind])[1];
      // (1.298.0) Ce qui est déjà dû, rangé par ce que c'est : les achats, les salaires, les dépenses qui reviennent.
      const dusClients = f.late.clients, dusFourn = f.late.suppliers, dusSalaires = f.late.salaires || [], dusRepetes = f.late.repetes || [];
      const totSalaires = C.round3(-dusSalaires.reduce((x, e) => x + e.amount, 0));
      const totDus = C.round3(dusClients.reduce((x, e) => x + e.amount, 0)), totDois = C.round3(-dusFourn.reduce((x, e) => x + e.amount, 0));
      const fisc = (C.upcomingFiscal ? C.upcomingFiscal(data, t0, 45) : []).slice(0, 1)[0];
      const fiscEst = fisc ? C.cashForecast(data, company(), 45, t0).events.find(e => e.kind === 'fiscal' && (e.id === fisc.filingId || (fisc.socialId && e.id === fisc.socialId))) : null;
      const surveiller = [
        dusClients.length ? `<li class="tr-s"><span>${lfIc('cloche', 16)}</span><span class="txt"><b>${h(C.money(totDus, cur))} déjà échus chez tes clients</b><small>${pl(dusClients.length, 'facture')} en retard : la prévision les attend aujourd'hui</small></span><button type="button" class="btn btn-sm" id="tr-s-rel">Relancer</button></li>` : '',
        dusFourn.length ? `<li class="tr-s"><span>${lfIc('alerte', 16)}</span><span class="txt"><b>${h(C.money(totDois, cur))} déjà dus à tes fournisseurs</b><small>${pl(dusFourn.length, 'achat')} échu${sPl(dusFourn.length)}, pas encore réglé${sPl(dusFourn.length)}</small></span><button type="button" class="btn btn-sm" id="tr-s-ach">Voir ce que je dois</button></li>` : '',
        // (1.298.0) Une dépense qui revient, passée sans être notée : la prévision la compte aujourd'hui ; un geste la note.
        ...dusRepetes.slice(0, 3).map((e, i) => `<li class="tr-s tr-s-rep"><span>${lfIc('echeance', 16)}</span><span class="txt"><b>${h(e.label)} du ${C.fmtDate(e.occurrence)} : ${h(C.money(-e.amount, cur))}, pas encore noté</b><small>la prévision le compte comme à payer aujourd'hui ; payé, note-le, et il en sort</small></span><button type="button" class="btn btn-sm" data-noter-rep="${i}">Noter comme payé</button></li>`),
        dusRepetes.length > 3 ? `<li class="tr-s"><span>${lfIc('echeance', 16)}</span><span class="txt"><b>${pl(dusRepetes.length - 3, 'autre dépense', 'autres dépenses')} qui revien${dusRepetes.length - 3 > 1 ? 'nent' : 't'}, pas encore notée${sPl(dusRepetes.length - 3)}</b><small>dans « Ce qui arrive », marquées « déjà échue »</small></span><button type="button" class="btn btn-sm" id="tr-s-rep">Voir ce qui arrive</button></li>` : '',
        dusSalaires.length && !paieCachee() ? `<li class="tr-s"><span>${lfIc('alerte', 16)}</span><span class="txt"><b>${h(C.money(totSalaires, cur))} de salaires pas encore payés</b><small>${pl(dusSalaires.length, 'bulletin')} du mois passé</small></span><button type="button" class="btn btn-sm" id="tr-s-paie">Voir la paie</button></li>` : '',
        fisc ? `<li class="tr-s"><span>${lfIc('echeance', 16)}</span><span class="txt"><b>${h(fisc.label)} le ${C.fmtDate(fisc.date)}</b><small>${fiscEst ? `estimée à ${h(C.money(-fiscEst.amount, cur))} sur ce qui est saisi à ce jour : elle est dans la prévision` : 'son montant n\'est pas dans la prévision : SkanFact connaît la date, pas la somme'}</small></span><button type="button" class="btn btn-sm" id="tr-s-fisc">Voir le calendrier</button></li>` : ''].filter(Boolean);
      const recoDe = id => (recos.find(x => x.a.id === id) || {}).r;
      // La courbe des trente derniers jours d'un compte : son solde au soir de chaque jour (depuis sa date d'ouverture
      // si elle est plus récente) ; lue sur les mêmes mouvements que son solde.
      const sparkCompte = a => {
        const d0 = C.addDays(t0, -30);
        const debut = a.openingDate && a.openingDate > d0 ? a.openingDate : d0;
        let b = C.accountBalance(data, company(), a.id, debut).balance;
        const mv = C.cashMovements(data, company(), { from: C.addDays(debut, 1), to: t0 }, a.id).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        const vals = [];
        let i = 0;
        for (let d = debut; d <= t0; d = C.addDays(d, 1)) {
          while (i < mv.length && mv[i].date <= d) b = C.round3(b + mv[i++].amount);
          vals.push(b);
        }
        if (vals.length < 2) return '';
        const W = 120, H = 34, mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn), dx = 30 - (vals.length - 1);
        const pts = vals.map((v, k) => `${((k + dx) * W / 30).toFixed(1)},${(mx === mn ? H / 2 : H - 3 - (H - 6) * (v - mn) / sp).toFixed(1)}`).join(' ');
        return `<svg class="tr-spark${vals[vals.length - 1] < vals[0] ? ' baisse' : ''}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
      };
      const carte = a => {
        const r = recoDe(a.id), moves = r ? r.moves : [];
        const nAP = moves.filter(m => !m.reconciled).length;
        const dernier = moves.filter(m => m.reconciled).reduce((d, m) => (m.date > d ? m.date : d), '');
        return `<article class="tr-compte" data-acc="${h(a.id)}">
          <div class="tr-c-tete"><span class="tr-c-ic">${lfIc(a.kind === 'caisse' ? 'depot' : 'carte', 18, 1.8)}</span>
            <span class="tr-c-nom"><b title="${h(a.name)}">${h(a.name)}</b><small class="tr-c-sous">${h([a.bank, kindDe(a)].filter(Boolean).join(' · '))}${a.isDefault ? ' · <span class="tr-c-def">par défaut</span>' : ''}</small></span>
            ${RowMenu.bouton(a.id, 'Actions', 'tr-c-menu')}</div>
          <div class="tr-c-solde"><b class="${a.balance < 0 ? 'rouge' : ''}">${C.money(a.balance, cur)}</b>${sparkCompte(a)}</div>
          <div class="tr-c-pied"><span>${dernier ? `Relevé pointé jusqu'au ${C.fmtDate(dernier)}` : moves.length ? 'Relevé jamais pointé' : 'Aucun mouvement'}</span>${nAP ? `<span class="tr-c-ap">${pl(nAP, 'mouvement')} à pointer</span>` : moves.length ? `<span class="tr-c-ok">${lfIc('coche', 13, 2.6)} tout pointé</span>` : ''}</div>
        </article>`;
      };
      const eff = C.portefeuilleEffets(data, company(), t0);
      const effPage = paginate(eff.effets, s.effets);
      const jours = d => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+t0.slice(0, 4), +t0.slice(5, 7) - 1, +t0.slice(8, 10))) / 864e5);
      const nonPointe = C.round3(pos.accounts.reduce((x, a) => x + (a.pending || 0), 0));
      $('#t-body').innerHTML = `
        <div class="tr-cartes" id="tr-comptes">${pos.accounts.map(carte).join('')}</div>
        <div class="tr-dispo"><span><b>Disponible</b> <small class="muted">${pl(pos.accounts.length, 'compte')}${Math.abs(nonPointe) > 0.0005 ? ` · dont ${h(moneySigne(nonPointe, cur))} pas encore pointés ${info('tre.pending')}` : ''}</small></span><b class="${pos.total < 0 ? 'rouge' : ''}">${C.money(pos.total, cur)}</b></div>
        ${surveiller.length ? `<div class="tr-surv"><h3>À surveiller</h3><ul>${surveiller.join('')}</ul></div>` : `<p class="tr-calme">${lfIc('coche', 16, 2.4)} Rien d'échu ni chez tes clients ni chez tes fournisseurs.</p>`}
        ${eff.effets.length ? `<section class="tr-sec tr-effets"><h3 class="tr-h">Effets en portefeuille ${info('tre.effets')}</h3>
          <div class="tr-eff-tot">${eff.aRecevoir ? `<span>À encaisser <b class="ok-text">${C.money(eff.aRecevoir, cur)}</b></span>` : ''}${eff.aPayer ? `<span>À payer <b>${C.money(eff.aPayer, cur)}</b></span>` : ''}</div>
          <div id="tr-eff"><div class="scroll-x"><table class="list compact" id="tr-effets"><thead><tr><th>Échéance</th><th>Effet</th><th>Tiers</th><th>Pièce</th><th class="r">Montant</th></tr></thead><tbody>
            ${effPage.rows.map(x => `<tr class="clickable" data-go="${h(x.docId ? '#/doc/' + x.docId : '#/achat/' + x.purchaseId)}"><td class="nw">${C.fmtDate(x.echeance)}<div class="small muted">dans ${pl(jours(x.echeance), 'jour')}</div></td>
              <td>${h(methodLabel(x.type))}${x.numero ? ` <span class="muted">n° ${h(x.numero)}</span>` : ''}${x.recuLe ? `<div class="small muted">${x.sens === 'recevoir' ? 'reçu' : 'remis'} le ${C.fmtDate(x.recuLe)}</div>` : ''}</td>
              <td>${h(x.tiers)}</td><td class="nw">${h(x.piece || '—')}</td>
              <td class="r nw m ${x.sens === 'recevoir' ? 'ok-text' : ''}">${moneySigne(x.sens === 'recevoir' ? x.montant : -x.montant, cur)}</td></tr>`).join('')}
          </tbody></table></div>${pagerBar(effPage.pg, { noun: 'effet' })}</div></section>` : ''}`;
      $$('#tr-comptes [data-acc]').forEach(c => c.onclick = e => { if (e.target.closest('button, a')) return; s.account = c.dataset.acc; s.tab = 'mouvements'; s.moves.page = 1; render(true); });
      bindRowMenus($('#tr-comptes'), id => {
        const a = data.accounts.find(x => x.id === id); if (!a) return [];
        return [
          { icon: 'modifier', label: 'Modifier le compte', run: () => accountForm(a, () => render(true)) },
          { icon: 'loupe', label: 'Voir ses mouvements', run: () => { s.account = a.id; s.tab = 'mouvements'; s.moves.page = 1; render(true); } },
          { icon: 'oui', label: 'Le rapprocher de son relevé', run: () => { s.account = a.id; s.tab = 'rapprochement'; render(true); } },
          { sep: true },
          { icon: 'nouveau', label: 'Noter un mouvement sur ce compte', run: () => movementForm(null, () => render(true), { accountId: a.id }) }];
      }, id => ((data.accounts.find(x => x.id === id)) || {}).name || '');
      if ($('#tr-eff')) {
        bindPager($('#tr-eff'), s.effets, () => draw(), '#tr-eff');
        $$('#tr-effets tr[data-go]').forEach(tr => tr.onclick = () => navigate(tr.dataset.go));
      }
      if ($('#tr-s-rel')) $('#tr-s-rel').onclick = () => navigate('#/relances');
      if ($('#tr-s-ach')) $('#tr-s-ach').onclick = () => navigate('#/achats');
      if ($('#tr-s-rep')) $('#tr-s-rep').onclick = () => { s.tab = 'prevision'; render(true); };
      if ($('#tr-s-paie')) $('#tr-s-paie').onclick = () => navigate('#/paie');
      $$('#t-body [data-noter-rep]').forEach(b => b.onclick = () => noterRepete(dusRepetes[Number(b.dataset.noterRep)]));
      if ($('#tr-s-fisc')) $('#tr-s-fisc').onclick = vers('#/compta', () => { comptaState.tab = 'calendrier'; });
    }

    // --- Ce qui arrive
    // L'origine d'une échéance, en mots : une saisie datée d'après aujourd'hui se nomme par ce
    // qu'elle est (10.14.0), sinon « Contrat récurrent » l'aurait rangée parmi les factures à venir.
    const ORIGINE_PREVISION = {
      client: 'Facture client', fournisseur: 'Achat', salaire: 'Bulletin à payer', contrat: 'Contrat récurrent',
      'salaire-prevu': 'Salaire du mois', fiscal: 'Impôt', repete: 'Dépense qui revient',
      'saisi-vente': 'Paiement client saisi', 'saisi-achat': 'Règlement saisi', 'saisi-paie': 'Bulletin payé',
      'saisi-avance': 'Avance sur salaire', 'saisi-libre': 'Mouvement saisi'
    };
    // (1.266.0) Trois façons d'attendre l'argent des clients : à l'échéance que la facture dit ; au délai réel de chaque
    // client (mesuré sur ses factures soldées) ; sans les factures déjà en retard.
    const MODES_TRESO = [['echeance', 'À l\'échéance'], ['habitude', 'Comme ils paient d\'habitude'], ['prudent', 'Sans les retards']];
    // Plusieurs semaines vides de suite se lisent en une ligne : « rien de prévu » répété huit fois ne dit rien de plus.
    const semainesFusionnees = l => l.reduce((out, w) => {
      const p = out[out.length - 1];
      if (!w.n && p && !p.n) { p.au = w.au; p.solde = w.solde; p.fusion = (p.fusion || 1) + 1; } else out.push({ ...w });
      return out;
    }, []);
    const cleDecalage = e => `${e.kind}:${e.id}`;
    // Ouvrir ce d'où vient une échéance : sa pièce, son bulletin, son mouvement, la paie, le calendrier fiscal.
    const ouvrirEcheance = e => {
      const src = e.source || '';
      // (17 § 3.3, lot P1b) Une sortie prévue d'un module du bas (un salaire, une avance) : il dit lui-même comment l'ouvrir.
      const sortie = Socle.lire('sorties-prevues').find(s => s.ouvre(e));
      if (sortie) return sortie.ouvrir(e, () => draw());
      if (e.kind === 'fiscal') return vers('#/compta', () => { comptaState.tab = 'calendrier'; })();
      if (e.kind === 'repete') { const m = (data.movements || []).find(x => x.id === e.movementId); if (m) movementForm(m, () => draw()); return; }
      if (src === 'libre') { const m = (data.movements || []).find(x => x.id === e.id); if (m) movementForm(m, () => draw()); return; }
      navigate(e.kind === 'client' || src === 'vente' ? '#/doc/' + e.id : e.kind === 'fournisseur' || src === 'achat' ? '#/achat/' + e.id : '#/contrat/' + e.id);
    };
    // L'essai « et si je décale ce paiement ? » : une autre date pour une échéance, sans rien enregistrer.
    const decalerEcheance = e => modal(`<h2>Et si je décale cette échéance ?</h2>
      <p class="small muted">${h(e.label)} · ${moneySigne(e.amount, cur)} · prévue le ${C.fmtDate(e.date)}</p>
      <p class="small">C'est un <b>essai</b> : rien n'est enregistré, ni sur la pièce ni chez ${e.amount > 0 ? 'le client' : 'le fournisseur'}. La courbe montre ce que deviendrait ton solde ; « Annuler l'essai » remet tout comme avant. Une date au-delà de l'horizon sort l'échéance de la prévision.</p>
      <form id="dcf" class="grid-2">${dateFieldHtml(lbl('Nouvelle date', 'tre.essai'), 'date', C.addDays(e.date, 15), { obligatoire: true })}</form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Essayer cette date</button></div>`,
    (root, close) => {
      $('#ok', root).onclick = () => {
        const v = formValues($('#dcf', root));
        if (!v.date) return refus($('[name=date]', root), 'Choisis la date à essayer.');
        s.decalages = { ...(s.decalages || {}), [cleDecalage(e)]: v.date };
        s.prevision.page = 1; close(); draw();
      };
    });
    // Le seuil sous lequel la trésorerie alerte : zéro, un minimum de sécurité, ou un découvert autorisé (en négatif).
    const reglerSeuil = () => modal(`<h2>Le seuil d'alerte de ta trésorerie</h2>
      <p class="small muted">SkanFact t'alerte quand la prévision passe sous ce montant : le bandeau rouge, le point d'exclamation dans la barre, l'alerte de l'accueil. Zéro par défaut. Mets ton minimum de sécurité (par exemple 5 000), ou ton découvert autorisé en négatif (par exemple −10 000).</p>
      <form id="sf" class="grid-2">${field(lbl(`Seuil (${h(C.normCurrency(company().currency))})`, 'tre.seuil'), 'seuil', Number(company().tresoSeuil) || 0, 'number', 'step="0.001" class="num"')}</form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
    (root, close) => {
      $('#ok', root).onclick = () => {
        const brut = String(formValues($('#sf', root)).seuil || '0').replace(',', '.');
        const n = Number(brut);
        if (!Number.isFinite(n)) return refus($('[name=seuil]', root), 'Écris un montant en chiffres : 0, 5000 ou -10000.');
        const avant = company().tresoSeuil;
        company().tresoSeuil = C.round3(n);
        save(true); close(); render(true);
        toastUndo(`Seuil d'alerte : ${C.money(n, cur)}`, () => { company().tresoSeuil = avant; save(true); render(true); });
      };
    });
    // (1.266.0) L'horizon et la façon d'attendre les clients en barres segmentées, le seuil réglable ; la courbe suit le
    // CALENDRIER (avec le seuil, les échéances fiscales et un curseur qui lit chaque jour) ; puis les semaines et le détail,
    // chaque échéance avec son menu : l'ouvrir, la décaler pour essayer, noter payée une dépense qui revient.
    function drawForecast() {
      const dec = s.decalages || {};
      const nbDec = Object.keys(dec).length;
      const f = C.cashForecast(data, company(), s.days, t0, { encaissement: s.mode, decalages: dec });
      const sansEssai = nbDec ? C.cashForecast(data, company(), s.days, t0, { encaissement: s.mode }) : null;
      const brutes = C.semainesTreso(f);
      const sem = semainesFusionnees(brutes);
      const prevPage = paginate(f.events.map((_, i) => i), s.prevision);
      const nbHabitude = f.events.filter(e => e.habitude && !e.late).length;
      const nbRetards = f.late.clients.length;
      const nbEstimes = f.events.filter(e => e.estime).length;
      const noteMode = s.mode === 'prudent' ? ' <b>Sans les retards</b> : les factures clients déjà échues n\'y comptent pas.'
        : s.mode === 'habitude' ? (nbHabitude ? ` <b>Comme ils paient d'habitude</b> : ${pl(nbHabitude, 'facture')} ${nbHabitude > 1 ? 'sont attendues' : 'est attendue'} au délai réel de ${nbHabitude > 1 ? 'leur' : 'son'} client, mesuré sur ses factures payées.` : ' <b>Comme ils paient d\'habitude</b> : aucun client n\'a encore assez de factures payées (deux au moins) pour mesurer son délai ; tout est attendu à l\'échéance.')
          : nbRetards ? ` ${pl(nbRetards, 'facture')} déjà échue${sPl(nbRetards)} y ${nbRetards > 1 ? 'sont attendues' : 'est attendue'} aujourd'hui.` : '';
      $('#t-body').innerHTML = `
        ${nbDec ? `<div class="bandeau ambre tr-essai" role="status">${lfIc('horloge', 18, 2)}<span class="txt"><b>Essai : ${pl(nbDec, 'échéance décalée', 'échéances décalées')}, rien n'est enregistré</b><span>Sans l'essai, ton solde descend au plus bas à ${C.money(sansEssai.lowest.balance, cur)} ; avec, à ${C.money(f.lowest.balance, cur)}. Pour le faire vraiment, change la date sur la pièce ou demande-le au tiers.</span></span><button type="button" class="btn btn-sm" id="t-essai-fin">Annuler l'essai</button></div>` : ''}
        <div class="tr-barre">
          <div class="pa-seg filtre" id="t-days" role="tablist" aria-label="Horizon">${[30, 60, 90, 180].map(d => `<button type="button" role="tab" data-days="${d}" aria-selected="${Number(s.days) === d}" class="${Number(s.days) === d ? 'active' : ''}">${d} jours</button>`).join('')}</div>
          <div class="pa-seg filtre" id="t-mode" role="tablist" aria-label="Comment attendre les clients">${MODES_TRESO.map(([k, l]) => `<button type="button" role="tab" data-mode="${k}" aria-selected="${s.mode === k}" class="${s.mode === k ? 'active' : ''}">${l}${k === 'prudent' && nbRetards && s.mode !== 'prudent' ? ` <small>${nbRetards}</small>` : ''}</button>`).join('')}</div>
          ${info('tre.prudent')}
          <button type="button" class="btn btn-sm tr-seuil" id="t-seuil">Seuil : ${h(C.money(f.seuil, cur))}</button>
          <button type="button" class="btn btn-sm" id="exp-prev">${lfIc('exporter', 15)} Exporter</button>
        </div>
        <div class="tr-graphe-t"><span>Aujourd'hui <b>${C.money(f.start, cur)}</b></span><span>Au plus bas <b class="${f.lowest.balance < f.seuil ? 'rouge' : ''}">${C.money(f.lowest.balance, cur)}</b> <small class="muted">le ${C.fmtDate(f.lowest.date)}</small></span><span>Le ${C.fmtDate(f.horizon)} <b class="${f.end < f.seuil ? 'rouge' : ''}">${C.money(f.end, cur)}</b></span>${f.shortfall ? `<span class="rouge-t">${lfIc('alerte', 14, 2.2)} ${f.seuil ? 'sous ton seuil' : 'sous zéro'} le ${C.fmtDate(f.shortfall.date)}</span>` : ''}</div>
        <div class="tr-graphe-w" id="t-courbe">${forecastChart(f)}</div>
        <p class="small muted tr-note">Ce qui a une échéance connue : factures ouvertes, achats à régler, bulletins dus, contrats récurrents, dépenses qui reviennent, et ce qui est déjà saisi pour plus tard.${nbEstimes ? ` <b>Estimé</b> : les salaires des mois sans bulletin et les impôts du mois, calculés sur ce qui est saisi à ce jour.` : ''}${noteMode}</p>
        <h3 class="tr-h">Semaine par semaine</h3>
        <div class="scroll-x"><table class="list compact" id="t-sem"><thead><tr><th>Semaine</th><th class="r">Entre</th><th class="r">Sort</th><th class="r">Solde en fin de semaine</th></tr></thead><tbody>
          ${sem.map(w => `<tr class="${w.solde < f.seuil ? 'row-warn' : ''}${w.n ? '' : ' tr-vide'}"><td class="nw">${C.fmtDate(w.du)}${w.au !== w.du ? ` → ${C.fmtDate(w.au)}` : ''}${w.n ? '' : ` <small class="muted">${w.fusion > 1 ? `${w.fusion} semaines sans rien de prévu` : 'rien de prévu'}</small>`}</td>
            <td class="r nw m">${w.entrees ? `<span class="ok-text">${moneySigne(w.entrees, cur)}</span>` : '<span class="muted">—</span>'}</td>
            <td class="r nw m">${w.sorties ? moneySigne(w.sorties, cur) : '<span class="muted">—</span>'}</td>
            <td class="r nw m"><b class="${w.solde < f.seuil ? 'rouge' : ''}">${C.money(w.solde, cur)}</b></td></tr>`).join('')}
        </tbody><tfoot><tr><td><b>${pl(brutes.length, 'semaine')}</b></td><td class="r nw m">${moneySigne(f.inflow, cur)}</td><td class="r nw m">${moneySigne(f.outflow, cur)}</td><td class="r nw m"><b>${C.money(f.end, cur)}</b></td></tr></tfoot></table></div>
        ${f.fiscal.length ? `<h3 class="tr-h">Échéances fiscales sur la période ${info('compta.fiscal')}</h3>
          <ul class="tr-fisc">${f.fiscal.map(x => {
            const e = f.events.find(ev => ev.kind === 'fiscal' && (ev.id === x.filingId || (x.socialId && ev.id === x.socialId)));
            return `<li><b>${C.fmtDate(x.date)}</b><span>${h(x.label)}</span>${e ? `<span class="m">${moneySigne(e.amount, cur)} <small class="mg-pas ambre">estimé</small></span>` : '<span class="muted">montant inconnu</span>'}</li>`; }).join('')}</ul>
          <p class="small muted tr-note">La déclaration du mois (TVA, retenues sur les achats et sur les salaires) et la CNSS du trimestre sont estimées sur ce qui est saisi à ce jour et comptées dans la courbe ; marquée déposée, une déclaration en sort. Les autres n'ont que leur date : pense à les provisionner. Les montants : À VÉRIFIER avec ton comptable.</p>` : ''}
        <h3 class="tr-h">Le détail, dans l'ordre ${info('tre.events')}</h3>
        ${f.events.length ? `<div id="t-prev"><div class="scroll-x"><table class="list compact"><thead><tr><th>Date</th><th>Origine</th><th>Pièce</th><th class="r">Mouvement</th><th class="r">Solde après</th><th class="row-actions-h"></th></tr></thead><tbody>
          ${prevPage.rows.map(i => { const p = f.points[i + 1], e = f.events[i]; return `<tr class="clickable ${p.balance < f.seuil ? 'row-warn' : ''}" data-ev="${i}">
            <td class="nw">${C.fmtDate(p.date)}${e.late ? `<div class="small warn-text">déjà échue${e.occurrence ? ` (le ${C.fmtDate(e.occurrence)})` : ''}</div>` : ''}${e.decale ? '<div class="small"><small class="mg-pas ambre">décalée (essai)</small></div>' : ''}</td>
            <td class="small">${ORIGINE_PREVISION[e.kind === 'saisi' ? 'saisi-' + e.source : e.kind] || 'Contrat récurrent'}${e.estime ? ' <small class="mg-pas ambre">estimé</small>' : ''}${e.habitude && !e.late ? `<div class="small muted">+${pl(e.habitude, 'jour')}, son habitude</div>` : ''}</td>
            <td>${h(e.label)}</td>
            <td class="r nw m ${p.delta > 0 ? 'ok-text' : ''}">${moneySigne(p.delta, cur)}</td>
            <td class="r nw m ${p.balance < f.seuil ? 'warn-text' : ''}"><b>${C.money(p.balance, cur)}</b></td>${rowMenuCell(String(i))}</tr>`; }).join('')}
        </tbody></table></div>${pagerBar(prevPage.pg, { noun: 'échéance' })}</div>` : `<div class="mg-vide">${lfIc('echeance', 24, 1.6)}<b>Rien d'attendu sur ${s.days} jours</b><span>Aucune facture ouverte, aucun achat à régler, aucun salaire dû.</span></div>`}`;
      $$('#t-days [data-days]').forEach(b => b.onclick = () => { s.days = Number(b.dataset.days); s.prevision.page = 1; draw(); });
      $$('#t-mode [data-mode]').forEach(b => b.onclick = () => { s.mode = b.dataset.mode; s.prevision.page = 1; draw(); });
      $('#t-seuil').onclick = reglerSeuil;
      // (1.298.0) La prévision s'exporte telle qu'elle est lue (horizon, façon d'attendre les clients, essai compris) : c'est
      // le tableau qu'on montre à son banquier pour négocier un trou avant qu'il arrive.
      $('#exp-prev').onclick = async () => {
        if (!f.events.length) return toast('Rien d\'attendu sur la période : rien à exporter.', true);
        const lignes = f.events.map((e, i) => ({ date: f.points[i + 1].date, origine: ORIGINE_PREVISION[e.kind === 'saisi' ? 'saisi-' + e.source : e.kind] || 'Contrat récurrent',
          piece: e.label, montant: f.points[i + 1].delta, solde: f.points[i + 1].balance,
          note: [e.late ? `déjà échue${e.occurrence ? ` le ${C.fmtDate(e.occurrence)}` : ''}` : '', e.estime ? 'estimé' : '', e.decale ? 'décalée (essai)' : ''].filter(Boolean).join(', ') }));
        const nom = `prevision-${C.today()}-${s.days}j.csv`;
        const f2 = await bridge.saveText(nom, C.toCsv(lignes, [{ key: 'date', label: 'Date', type: 'date' }, { key: 'origine', label: 'Origine' }, { key: 'piece', label: 'Pièce' },
          { key: 'montant', label: 'Mouvement', type: 'money' }, { key: 'solde', label: 'Solde après', type: 'money' }, { key: 'note', label: 'Note' }]));
        if (f2) toast('Exporté : ' + f2.split(/[\\/]/).pop());
      };
      if ($('#t-essai-fin')) $('#t-essai-fin').onclick = () => { s.decalages = {}; s.prevision.page = 1; draw(); };
      brancherCourbe($('#t-courbe'), f);
      if ($('#t-prev')) {
        bindPager($('#t-prev'), s.prevision, () => draw(), '#t-prev');
        $$('#t-prev tr[data-ev]').forEach(tr => tr.onclick = ev => { if (ev.target.closest('button, a')) return; ouvrirEcheance(f.events[Number(tr.dataset.ev)]); });
        bindRowMenus($('#t-prev'), id => {
          const e = f.events[Number(id)]; if (!e) return [];
          const ouvrir = e.kind === 'salaire-prevu' ? 'Voir la paie' : e.kind === 'fiscal' ? 'Voir le calendrier fiscal' : e.kind === 'repete' ? 'Ouvrir le mouvement d\'origine' : e.kind === 'salaire' || e.source === 'paie' ? 'Ouvrir le bulletin' : e.kind === 'contrat' ? 'Ouvrir le contrat' : 'Ouvrir la pièce';
          const src = e.kind === 'repete' ? (data.movements || []).find(x => x.id === e.movementId) : null;
          return [
            { icon: 'loupe', label: ouvrir, run: () => ouvrirEcheance(e) },
            src ? { icon: 'argent', label: 'Noter comme payé', run: () => noterRepete(e) } : null,
            { sep: true },
            { icon: 'modifier', label: 'Décaler (essai)…', run: () => decalerEcheance(e) },
            e.decale ? { icon: 'restaurer', label: 'Remettre à sa date', run: () => { const d = { ...(s.decalages || {}) }; delete d[cleDecalage(e)]; s.decalages = d; draw(); } } : null];
        }, id => ((f.events[Number(id)]) || {}).label || '');
      }
    }

    // --- Mouvements
    // (1.266.0) La barre des listes : une recherche (libellé, tiers, référence), le compte, l'année, et « Entrées »,
    // « Sorties » en pastilles comptées ; les trois tuiles deviennent le pied du tableau, sur ce qui est affiché. Sur UN
    // compte, dans l'ordre des dates et sans filtre, chaque ligne dit le solde après elle ; les mois se séparent.
    function drawMoves() {
      const accSolde = s.account ? data.accounts.find(a => a.id === s.account) : data.accounts.length === 1 ? data.accounts[0] : null;
      const soldeOk = !!accSolde && !s.q && !s.sens && !s.sansPj && (!s.moves.sort || s.moves.sort.key === 'date');
      // Le solde après chaque mouvement, lu sur les mêmes mouvements que le solde du compte : le départ à sa date, puis
      // chaque mouvement dans l'ordre (`accountBalance` fait la même somme).
      const soldeApres = new Map();
      if (soldeOk) {
        let b = Number(accSolde.opening) || 0;
        C.cashMovements(data, company(), { from: accSolde.openingDate || '', to: '9999-12-31' }, accSolde.id).forEach(m => { b = C.round3(b + m.amount); soldeApres.set(m.id, b); });
      }
      const cols = [
        { key: 'date', label: 'Date', cls: 'nw', asc: true, val: m => m.date || '', get: m => C.fmtDate(m.date) },
        // Le 📎 d'une ligne DÉDUITE est celui de la pièce d'où elle vient (10.14.1, S-04) : le règlement
        // d'un achat montre le justificatif de l'achat, un mouvement libre le sien.
        { key: 'label', label: 'Libellé', asc: true, val: m => (m.label || '').toLowerCase(), get: m => `<span class="tr-lib">${h(m.label)}</span>${marqueJustif(C.justificatifsDe(data, m))}${m.party ? `<div class="small muted">${h(m.party)}</div>` : ''}` },
        { key: 'account', label: 'Compte', asc: true, val: m => m.accountId, get: m => h(((data.accounts.find(a => a.id === m.accountId)) || {}).name || '—') },
        { key: 'method', label: 'Mode', asc: true, val: m => m.method || '', get: m => h(methodLabel(m.method)) },
        { key: 'reference', label: 'Référence', asc: true, val: m => (m.reference || '').toLowerCase(), get: m => h(m.reference || '') || '<span class="muted">—</span>' },
        { key: 'amount', label: 'Montant', r: true, val: m => m.amount, get: m => `<span class="${m.amount > 0 ? 'ok-text' : ''}">${moneySigne(m.amount, cur)}</span>` },
        ...(soldeOk ? [{ key: 'solde', label: 'Solde après', r: true, get: m => (soldeApres.has(m.id) ? `<span class="${soldeApres.get(m.id) < 0 ? 'rouge' : ''}">${C.money(soldeApres.get(m.id), cur)}</span>` : '<span class="muted">—</span>') }] : [])
      ].filter(c => !(c.key === 'account' && s.account));   // un compte choisi : la colonne « Compte » répéterait son nom
      // L'année se choisit. Elle était figée sur l'année en cours, sans le moindre moyen de
      // remonter : le 3 janvier, la page de trésorerie devenait vide et l'année écoulée
      // inatteignable — alors que c'est exactement le moment où on la regarde.
      const annees = Array.from(new Set(C.cashMovements(data, company(), { from: '', to: '9999-12-31' }, null)
        .map(m => (m.date || '').slice(0, 4)).filter(Boolean).concat([C.today().slice(0, 4)]))).sort().reverse();
      if (!annees.includes(s.year)) s.year = annees[0];
      const period = { from: `${s.year}-01-01`, to: `${s.year}-12-31` };
      const duCompte = C.cashMovements(data, company(), period, s.account || null);
      const cherche = duCompte.filter(m => !s.q || C.correspondRecherche([m.label, m.party, m.reference, methodLabel(m.method)].join(' '), s.q));
      // Tous comptes confondus, un virement entre deux comptes de l'entreprise n'est ni une entrée ni
      // une sortie : l'argent change de poche (10.14.0). Il ne compte que sur UN compte choisi.
      const interne = m => !s.account && m.virement;
      const nbE = cherche.filter(m => m.amount > 0 && !interne(m)).length, nbS = cherche.filter(m => m.amount < 0 && !interne(m)).length;
      // (1.298.0) Un mouvement libre (un loyer, un impôt, des frais) n'a que son fichier pour se prouver : c'est lui que le
      // comptable demande à la fin du mois. Ceux qui n'en ont pas se retrouvent d'un geste.
      const sansPj = m => m.source === 'libre' && !C.justificatifsDe(data, m).length;
      const nbSansPj = cherche.filter(sansPj).length;
      if (!nbSansPj) s.sansPj = false;
      const all = cherche.filter(m => (!s.sens || (s.sens === 'entrees' ? m.amount > 0 : m.amount < 0) && !interne(m)) && (!s.sansPj || sansPj(m)));
      const rows = applySort(all.slice().reverse(), cols, s.moves.sort);
      const pg = paginate(rows, s.moves);
      const entrees = C.round3(all.filter(m => m.amount > 0 && !interne(m)).reduce((x, m) => x + m.amount, 0));
      const sorties = C.round3(all.filter(m => m.amount < 0 && !interne(m)).reduce((x, m) => x + m.amount, 0));
      const nbInternes = s.account ? 0 : all.filter(m => m.virement && !m.arrivee).length;
      const filtre = !!(s.q || s.sens || s.sansPj);
      const parDate = !s.moves.sort || s.moves.sort.key === 'date';
      $('#t-body').innerHTML = `
        <div class="tr-barre">
          <label class="cherche tr-q">${lfIc('recherche', 16)}<input type="search" id="t-q" autocomplete="off" placeholder="Rechercher : libellé, tiers, référence…" value="${h(s.q)}" aria-label="Rechercher un mouvement"></label>
          <label class="sel"><select id="t-acc" aria-label="Compte"><option value="">Tous les comptes</option>${data.accounts.map(a => `<option value="${a.id}" ${s.account === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select></label>
          <label class="sel"><select id="t-year" aria-label="Année">${annees.map(y => `<option ${y === s.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <div class="pa-seg filtre tr-sens" role="tablist" aria-label="Sens">${[['', 'Tout', cherche.length], ['entrees', 'Entrées', nbE], ['sorties', 'Sorties', nbS]].map(([k, l, n]) => `<button type="button" role="tab" data-sens="${k}" aria-selected="${s.sens === k}" class="${s.sens === k ? 'active' : ''}">${l} <small>${n}</small></button>`).join('')}</div>
          ${nbSansPj ? `<div class="pa-seg filtre" role="group" aria-label="Justificatifs"><button type="button" class="${s.sansPj ? 'active' : ''}" id="t-sans-pj" aria-pressed="${!!s.sansPj}" title="Les mouvements saisis ici (loyer, impôts, frais) qui n'ont pas encore leur justificatif">Sans justificatif <small>${nbSansPj}</small></button></div>` : ''}
          <button class="btn btn-sm" id="exp-moves">${lfIc('exporter', 15)} Exporter</button>
        </div>
        ${rows.length ? `<div id="m-wrap"><div class="scroll-x"><table class="list sortable" id="t-moves"><thead>${sortHead(cols, s.moves.sort)}</thead><tbody>
          ${pg.rows.map((m, k) => { const cible = m.source === 'libre' ? '' : m.docId ? '#/doc/' + m.docId : m.purchaseId ? '#/achat/' + m.purchaseId : m.payslipId || m.advanceId || m.socialId ? '#/paie' : m.saisieId ? `#/salarie/${encodeURIComponent(m.employeeId)}` : '';
            const mois = (m.date || '').slice(0, 7), avant = k ? (pg.rows[k - 1].date || '').slice(0, 7) : '';
            const sep = parDate && mois && mois !== avant ? `<tr class="tr-mois"><td colspan="${cols.length}">${h(enTete(C.MONTHS_FR[Number(mois.slice(5, 7)) - 1] || ''))} ${h(mois.slice(0, 4))}</td></tr>` : '';
            return `${sep}<tr class="${m.source === 'libre' || cible ? 'clickable' : ''}" data-mv="${m.source === 'libre' ? h(m.movementId) : ''}" data-go="${h(cible)}">
            ${cols.map(c => `<td class="${c.r ? 'r nw m' : ''}${c.cls ? ' ' + c.cls : ''}">${c.get(m)}</td>`).join('')}</tr>`; }).join('')}
        </tbody><tfoot><tr><td colspan="3"><b>${pl(all.length, 'mouvement')}</b> <small class="muted">en ${h(s.year)}${nbInternes ? ` · hors ${pl(nbInternes, 'virement')} entre tes comptes` : ''}</small></td>
          <td colspan="${cols.length - 3}" class="r nw m"><span class="tr-pied"><span>Entrées <b class="ok-text">${moneySigne(entrees, cur)}</b></span><span>Sorties <b>${moneySigne(sorties, cur)}</b></span><span>Variation <b class="${entrees + sorties < 0 ? 'rouge' : ''}">${moneySigne(C.round3(entrees + sorties), cur)}</b></span></span></td></tr></tfoot></table></div>${pagerBar(pg.pg, { noun: 'mouvement' })}</div>`
          : `<div class="mg-vide">${lfIc(filtre ? 'recherche' : 'carte', 24, 1.6)}<b>${filtre ? 'Aucun mouvement ne correspond' : `Aucun mouvement en ${h(s.year)}`}</b><span>${filtre ? (s.q ? `Rien pour « ${h(s.q)} »` : 'Rien dans ce sens') + ` en ${h(s.year)}.` : 'Les paiements des factures, les règlements des achats et les mouvements saisis arrivent ici tout seuls.'}</span>${filtre ? '<button type="button" class="btn" id="t-tout">Tout revoir</button>' : ''}</div>`}
        <p class="small muted tr-note">Une ligne s'ouvre sur la pièce d'où elle vient : le compte et le mode de règlement se corrigent là-bas. Les mouvements libres (impôts, apports, frais bancaires) se modifient ici même, et leur justificatif s'y joint.</p>`;
      $('#t-q').oninput = e => { s.q = e.target.value; s.moves.page = 1; sansPerdreLaFrappe(e.target, () => draw()); };
      $('#t-acc').onchange = e => { s.account = e.target.value; s.moves.page = 1; draw(); };
      $('#t-year').onchange = e => { s.year = e.target.value; s.moves.page = 1; draw(); };
      $$('#t-body [data-sens]').forEach(b => b.onclick = () => { s.sens = b.dataset.sens; s.moves.page = 1; draw(); });
      if ($('#t-tout')) $('#t-tout').onclick = () => { s.q = ''; s.sens = ''; s.sansPj = false; s.moves.page = 1; draw(); };
      if ($('#t-sans-pj')) $('#t-sans-pj').onclick = () => { s.sansPj = !s.sansPj; s.moves.page = 1; draw(); };
      // Un mouvement déduit d'un paiement ne se modifie pas ici — mais il DOIT mener à sa pièce :
      // la phrase juste en dessous disait d'aller la corriger, sans offrir d'y aller.
      $$('#t-body tr[data-mv], #t-body tr[data-go]').forEach(tr => {
        if (tr.dataset.mv) tr.onclick = () => movementForm(data.movements.find(m => m.id === tr.dataset.mv), () => draw());
        else if (tr.dataset.go) tr.onclick = () => navigate(tr.dataset.go);
      });
      const wrap = $('#m-wrap');
      // `bindSort` passe la colonne cliquée à son rappel : `() => draw()` la jetait, et les six
      // en-têtes affichaient leur « ⇅ » sans jamais rien trier. Un tri qui ne trie pas ne se voit
      // pas — on croit que la liste était déjà dans cet ordre.
      if (wrap) {
        bindSort(wrap, key => { s.moves.sort = toggleSort(s.moves.sort, key, cols); s.moves.page = 1; draw(); });
        bindPager(wrap, s.moves, () => draw(), '#m-wrap');
      }
      $('#exp-moves').onclick = async () => {
        if (!all.length) return toast('Rien à exporter.', true);
        const cs = [{ key: 'date', label: 'Date', type: 'date' }, { key: 'label', label: 'Libellé' }, { key: 'party', label: 'Tiers' },
          { label: 'Compte', get: m => ((data.accounts.find(a => a.id === m.accountId)) || {}).name || '' },
          { key: 'method', label: 'Mode' }, { key: 'reference', label: 'Référence' }, { key: 'amount', label: 'Montant', type: 'money' }];
        const f2 = await bridge.saveText(`mouvements-${s.year}.csv`, C.toCsv(all, cs));
        if (f2) toast('Exporté : ' + f2.split(/[\\/]/).pop());
      };
    }

    // --- Rapprochement
    // Ce que le solde recopié dit face à SkanFact : UNE phrase, pour le premier dessin et pour la frappe.
    const verdictReleve = gap => gap == null ? '<span class="small muted">Saisis le solde de ton relevé pour voir l\'écart.</span>'
      : Math.abs(gap) < 0.0005 ? '<span class="ok-text"><strong>Ça tombe juste.</strong> Ton relevé et SkanFact disent la même chose.</span>'
      : `<span class="warn-text"><strong>Écart de ${C.money(Math.abs(gap), cur)}.</strong> ${gap > 0 ? 'SkanFact compte plus que ta banque' : 'ta banque compte plus que SkanFact'} : il manque une pièce quelque part.</span>`;

    function drawReco() {
      const accId = s.account || (data.accounts.find(a => a.isDefault) || data.accounts[0]).id;
      const r = C.reconciliation(data, company(), accId, C.today());
      const pending = r.moves.filter(m => !m.reconciled).slice().reverse();
      // Ce qui est déjà pointé se relit et se dépointe. Avant la 7.17.0, cocher faisait disparaître
      // la ligne à l'instant même : un clic à côté était définitif, et rien nulle part ne montrait
      // ce qui avait été pointé. Or pointer par erreur fausse l'écart avec le relevé — c'est-à-dire
      // exactement le chiffre pour lequel on est venu sur cette page.
      const pointes = r.moves.filter(m => m.reconciled).slice().reverse();
      const pendPage = paginate(pending, s.pending), pointPage = paginate(pointes, s.pointes);
      const ligne = m => `<tr><td><input type="checkbox" data-rec="${h(m.id)}" data-src="${h(m.source)}" ${m.reconciled ? 'checked' : ''}></td>
              <td class="nw">${C.fmtDate(m.date)}</td><td>${h(m.label)}<div class="small muted">${h(m.party || '')}</div></td>
              <td class="small">${h(m.reference || '')}</td>
              <td class="r nw ${m.amount > 0 ? 'ok-text' : ''}">${moneySigne(m.amount, cur)}</td></tr>`;
      $('#t-body').innerHTML = `
        <div class="tr-barre">
          <label class="sel"><select id="t-acc2" aria-label="Compte bancaire à rapprocher">${data.accounts.map(a => { const n = a.id === accId ? pending.length : C.reconciliation(data, company(), a.id, C.today()).moves.filter(m => !m.reconciled).length; return `<option value="${a.id}" ${accId === a.id ? 'selected' : ''}>${h(a.name)}${n ? ` · ${n} à pointer` : ' · tout pointé'}</option>`; }).join('')}</select></label>
          ${info('tre.reco')}
          <button type="button" class="btn btn-sm tr-import" id="t-import">${lfIc('depot', 15)} Importer le relevé</button>
        </div>
        <section class="tr-sec"><h3 class="tr-h">Ton relevé face à SkanFact ${info('tre.gap')}</h3>
          <div class="tr-reco" id="t-reco">
            <div><span>Solde de départ</span><b>${C.money(r.opening, cur)}</b><small>au ${C.fmtDate(r.openingDate || (data.accounts.find(a => a.id === accId) || {}).openingDate || '')}</small></div>
            <span class="tr-op" aria-hidden="true">+</span>
            <div><span>Mouvements pointés</span><b>${moneySigne(C.round3(r.pointed - r.opening), cur)}</b><small>${pl(pointes.length, 'mouvement')}</small></div>
            <span class="tr-op" aria-hidden="true">=</span>
            <div class="fort"><span>Devrait figurer sur ton relevé</span><b>${C.money(r.pointed, cur)}</b><small>si tout est pointé jusqu'à sa date</small></div>
          </div>
          <div class="tr-stmt">
            <label class="field">${lbl(`Solde réel de ton relevé (${h(C.normCurrency(company().currency))})`, 'tre.stmt')}<input type="number" id="stmt" step="0.001" value="${r.statement == null ? '' : r.statement}" class="num" placeholder="Recopie-le ici"></label>
            <span id="stmt-verdict">${verdictReleve(r.gap)}</span>
          </div>
        </section>
        <section class="tr-sec"><h3 class="tr-h">État de rapprochement ${info('tre.etat')}</h3>
          ${(() => { const et = C.etatRapprochement(data, company(), accId, C.today()); return et.statement == null
            ? '<p class="small muted">Saisis le solde de ton relevé ci-dessus : l\'état de rapprochement se remplit tout seul.</p>'
            : `<div class="scroll-x"><table class="list compact" id="t-etat"><tbody>
                <tr><td>Solde du relevé bancaire</td><td class="r nw">${C.money(et.statement, cur)}</td></tr>
                <tr><td>+ Encaissements enregistrés, pas encore crédités par la banque (${pl(et.entrees.length, 'mouvement')})</td><td class="r nw">${C.money(et.totalEntrees, cur)}</td></tr>
                <tr><td>− Paiements enregistrés, pas encore débités par la banque (${pl(et.sorties.length, 'mouvement')})</td><td class="r nw">${C.money(et.totalSorties, cur)}</td></tr>
                <tr class="total-row"><td>= Solde que SkanFact devrait porter</td><td class="r nw"><strong>${C.money(et.theorique, cur)}</strong></td></tr>
                <tr><td>Solde de SkanFact</td><td class="r nw">${C.money(et.balance, cur)}</td></tr>
                <tr class="${Math.abs(et.ecart) < 0.0005 ? 'ok' : 'due'}"><td><strong>Écart</strong></td><td class="r nw"><strong id="t-ecart">${C.money(et.ecart, cur)}</strong></td></tr>
              </tbody></table></div>
              <p class="small muted mt">${Math.abs(et.ecart) < 0.0005 ? 'Aucun écart : chaque mouvement de la banque est dans SkanFact, et réciproquement. C\'est l\'état que ton comptable joint au dossier.' : 'Un écart est une pièce qui manque d\'un côté : un prélèvement non saisi, un chèque compté deux fois, un montant mal recopié. Pointe les mouvements ci-dessous jusqu\'à ce qu\'il tombe à zéro.'}</p>
              <div class="inline mt"><button class="btn" id="t-etat-csv">Exporter l'état</button>${peutEcrireAuCabinet() ? `<button class="btn" id="t-etat-compta">${lfIc('message', 15)} ${Math.abs(et.ecart) < 0.0005 ? 'Envoyer l\'état à mon comptable' : 'Demander à mon comptable'}</button>` : ''}</div>`; })()}
        </section>
        <section class="tr-sec"><h3 class="tr-h">Pas encore pointés — ${pl(pending.length, 'mouvement')} ${info('tre.pending')}</h3>
          <p class="small muted mb">Coche ce que tu retrouves sur ton relevé. Ce qui reste décoché est soit en cours de traitement à la banque, soit une erreur de saisie.</p>
          ${pending.length ? `<div id="t-pend"><table class="list compact"><thead><tr><th style="width:46px"></th><th>Date</th><th>Libellé</th><th>Référence</th><th class="r">Montant</th></tr></thead><tbody>
            ${pendPage.rows.map(ligne).join('')}
          </tbody><tfoot><tr><td colspan="4"><strong>Total non pointé</strong></td><td class="r"><strong>${C.money(r.pendingAmount, cur)}</strong></td></tr></tfoot></table>${pagerBar(pendPage.pg, { noun: 'mouvement' })}</div>`
            : '<div class="empty">Tout est pointé. Ton relevé et SkanFact sont alignés.</div>'}
        </section>
        ${pointes.length ? `<section class="tr-sec"><h3 class="tr-h"><button class="btn btn-ghost btn-sm" id="t-vus">${s.showPointed ? '▾' : '▸'}</button> Déjà pointés — ${pl(pointes.length, 'mouvement')}</h3>
          <p class="small muted mb">Décoche si tu t'es trompé : le mouvement revient dans la liste du dessus et le solde pointé se recalcule.</p>
          ${s.showPointed ? `<div id="t-vus-l"><table class="list compact"><thead><tr><th style="width:46px"></th><th>Date</th><th>Libellé</th><th>Référence</th><th class="r">Montant</th></tr></thead><tbody>
            ${pointPage.rows.map(ligne).join('')}
          </tbody></table>${pagerBar(pointPage.pg, { noun: 'mouvement' })}</div>` : ''}
        </section>` : ''}`;
      if ($('#t-vus')) $('#t-vus').onclick = () => { s.showPointed = !s.showPointed; draw(); };
      $('#t-acc2').onchange = e => { s.account = e.target.value; s.pending.page = 1; s.pointes.page = 1; draw(); };
      if ($('#t-pend')) bindPager($('#t-pend'), s.pending, () => draw(), '#t-pend');
      if ($('#t-vus-l')) bindPager($('#t-vus-l'), s.pointes, () => draw(), '#t-vus-l');
      // (1.298.0, revue de la Trésorerie) Le rapprochement fini est ce que le comptable joint au dossier ; un écart qu'on ne
      // trouve pas, c'est à lui qu'on le demande. La conversation s'ouvre avec le résumé prêt (`ecrireAuComptable`).
      if ($('#t-etat-compta')) $('#t-etat-compta').onclick = () => {
        const et = C.etatRapprochement(data, company(), accId, C.today());
        const acc = data.accounts.find(a => a.id === accId) || {};
        const enCours = et.entrees.length + et.sorties.length;
        const suite = enCours ? ` ${pl(enCours, 'mouvement enregistré', 'mouvements enregistrés')} ne ${enCours > 1 ? 'sont' : 'est'} pas encore ${enCours > 1 ? 'passés' : 'passé'} à la banque.` : '';
        ecrireAuComptable(Math.abs(et.ecart) < 0.0005
          ? `Bonjour, j'ai rapproché le compte « ${acc.name} » de son relevé au ${C.fmtDate(C.today())} : solde du relevé ${C.money(et.statement, cur)}, aucun écart.${suite} L'état de rapprochement est dans SkanFact (Trésorerie, Rapprochement).`
          : `Bonjour, je rapproche le compte « ${acc.name} » de son relevé au ${C.fmtDate(C.today())} et il reste un écart de ${C.money(Math.abs(et.ecart), cur)} (${et.ecart > 0 ? 'SkanFact compte plus que la banque' : 'la banque compte plus que SkanFact'}).${suite} Peux-tu m'aider à le trouver ? L'état est dans SkanFact (Trésorerie, Rapprochement).`);
      };
      if ($('#t-etat-csv')) $('#t-etat-csv').onclick = async () => {
        const et = C.etatRapprochement(data, company(), accId, C.today());
        const rows = [{ poste: 'Solde du relevé bancaire', montant: et.statement }]
          .concat(et.entrees.map(m => ({ poste: `+ ${C.fmtDate(m.date)} ${m.label} (${m.party || ''}) — non crédité`, montant: m.amount })))
          .concat(et.sorties.map(m => ({ poste: `− ${C.fmtDate(m.date)} ${m.label} (${m.party || ''}) — non débité`, montant: -m.amount })))
          .concat([{ poste: 'Solde que SkanFact devrait porter', montant: et.theorique }, { poste: 'Solde de SkanFact', montant: et.balance }, { poste: 'Écart', montant: et.ecart }]);
        const f = await bridge.saveText(`rapprochement-${C.today()}.csv`, C.toCsv(rows, [{ key: 'poste', label: 'Poste' }, { key: 'montant', label: 'Montant', type: 'money' }]));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      // Le verdict se lit PENDANT la frappe : on recopie un solde et on attend qu'il réponde. Il ne
      // répondait qu'en quittant la case — « Saisis le solde… » restait affiché sous un solde saisi.
      // Seul le verdict se met à jour ; l'état de rapprochement suit à la sortie de la case.
      $('#stmt').oninput = e => {
        const v = e.target.value;
        $('#stmt-verdict').innerHTML = verdictReleve(v === '' ? null : C.round3(r.pointed - Number(v)));
      };
      $('#stmt').onchange = e => {
        const acc = data.accounts.find(a => a.id === accId);
        acc.statementBalance = e.target.value === '' ? '' : Number(e.target.value);
        save(true); draw();
      };
      // Pointer un mouvement : le drapeau vit sur le paiement d'origine, pas sur une copie.
      // La ligne quitte l'écran à l'instant du clic : au moment où on comprend qu'on s'est trompé,
      // il n'y a plus rien sous le doigt. D'où « Annuler » (7.12.0), en plus du panneau du dessous.
      const porteur = id => {
        let hit = null;
        data.documents.forEach(d => (d.payments || []).forEach(p => { if (p.id === id) hit = p; }));
        data.purchases.forEach(pu => (pu.payments || []).forEach(p => { if (p.id === id) hit = p; }));
        data.movements.forEach(m => { if (m.id === id) hit = m; });
        // L'ARRIVÉE d'un virement entre deux comptes (10.14.0) se pointe sur le relevé du compte qui
        // reçoit : son drapeau est `reconciledVers`, jamais celui du départ — sinon pointer la caisse
        // pointait aussi la banque, et le relevé de la banque tombait juste sur une ligne jamais vue.
        if (!hit && id.endsWith('~vers')) {
          const mv = data.movements.find(m => m.id + '~vers' === id);
          if (mv) hit = { get reconciled() { return !!mv.reconciledVers; }, set reconciled(x) { mv.reconciledVers = x; } };
        }
        // 10.14.0 : un salaire payé (« pay-… ») et une avance versée (« av-… ») portent leur drapeau
        // sur le bulletin et sur l'avance. Sans ces deux lignes, leur case acceptait le clic et ne
        // pointait rien : le rapprochement d'un mois de paie ne tombait jamais juste.
        if (!hit && id.startsWith('pay-')) hit = data.payslips.find(sl => 'pay-' + sl.id === id) || null;
        if (!hit && id.startsWith('av-')) hit = data.advances.find(a => 'av-' + a.id === id) || null;
        if (!hit && id.startsWith('soc-')) hit = (data.socialFilings || []).find(f => 'soc-' + f.id === id) || null;
        // (plateforme) 1.230.0 — le versement d'une saisie sur salaire porte son drapeau sur lui-même.
        if (!hit && id.startsWith('sai-')) (data.employees || []).forEach(e => (e.saisies || []).forEach(x => (x.versements || []).forEach(v => { if (`sai-${x.id}-${v.id}` === id) hit = v; })));
        return hit;
      };
      $$('[data-rec]').forEach(cb => cb.onchange = () => {
        const id = cb.dataset.rec;
        const hit = porteur(id);
        if (!hit) return;
        const avant = !!hit.reconciled;
        hit.reconciled = cb.checked; save(true); draw();
        toastUndo(cb.checked ? 'Mouvement pointé' : 'Mouvement dépointé', () => {
          const h2 = porteur(id);
          if (h2) { h2.reconciled = avant; save(true); draw(); }
        });
      });
      // (1.266.0) Le relevé de la banque, importé (CSV ou tableur exporté en CSV) : le lecteur de relevé du Cabinet
      // (`SkanCompta.releveDepuisCsv`) le lit, chaque ligne retrouve le mouvement de même montant à cinq jours près
      // (`C.apparierReleve`). On relit avant de pointer : les paires cochées, les lignes absentes de SkanFact à créer d'un
      // clic, le solde final du relevé recopié. Rien n'est pointé sans le bouton, et « Annuler » remet tout.
      $('#t-import').onclick = async () => {
        if (!bridge.openText) return toast('L\'import d\'un relevé lit un fichier : ouvre SkanFact dans ton navigateur ou dans l\'application.', true);
        let lu;
        try { lu = await bridge.openText({ title: 'Choisir le relevé de ta banque (CSV)' }); } catch (e) { return toast(plainError(e), true); }
        if (!lu || lu.canceled) return;
        if (!lu.ok) return toast(lu.motif || 'Ce fichier ne se lit pas.', true);
        const K = window.SkanCompta;
        const rel = K.releveDepuisCsv(K.rangeesDeTexte(lu.texte), null);
        if (rel.motif) return toast(rel.lignes && rel.lignes.length === 0 && /vide/.test(rel.motif) ? rel.motif : 'Ce fichier n\'a pas les colonnes d\'un relevé : il faut une date, un libellé et un montant (ou un débit et un crédit). Exporte-le de ta banque en CSV.', true);
        if (!rel.lignes.length) return toast('Ce relevé ne porte aucune ligne lisible.', true);
        revueReleve(rel, lu.nom || 'le relevé');
      };
      function revueReleve(rel, nom) {
        const acc = data.accounts.find(a => a.id === accId);
        const ap = C.apparierReleve(rel.lignes, r.moves, 5);
        const crees = new Set();
        modal(`<h2>Le relevé de « ${h(acc.name)} »</h2>
          <p class="small muted">${h(nom)} · ${pl(rel.lignes.length, 'ligne lue', 'lignes lues')}${rel.ignorees.length ? ` · ${pl(rel.ignorees.length, 'ligne ignorée', 'lignes ignorées')} (date ou montant illisible)` : ''}</p>
          <div class="tr-imp-res"><span><b>${ap.paires.length}</b> retrouvée${sPl(ap.paires.length)} dans SkanFact</span>${ap.dejaPointees.length ? `<span><b>${ap.dejaPointees.length}</b> déjà pointée${sPl(ap.dejaPointees.length)}</span>` : ''}${ap.remises.length ? `<span><b>${ap.remises.length}</b> remise${sPl(ap.remises.length)} en plusieurs mouvements</span>` : ''}<span><b>${ap.absentes.length}</b> absente${sPl(ap.absentes.length)} de SkanFact</span><span><b>${ap.restants.length}</b> mouvement${sPl(ap.restants.length)} de SkanFact pas sur ce relevé</span></div>
          ${ap.paires.length ? `<h3 class="tr-h">Retrouvées : même montant, à cinq jours près ${info('tre.import')}</h3>
            <div class="scroll-x"><table class="list compact" id="imp-paires"><thead><tr><th style="width:40px"></th><th>Sur le relevé</th><th>Dans SkanFact</th><th class="r">Montant</th></tr></thead><tbody>
            ${ap.paires.map((x, i) => `<tr><td><input type="checkbox" data-paire="${i}" checked aria-label="Pointer ce mouvement"></td>
              <td><span class="nw">${C.fmtDate(x.ligne.date)}</span><div class="small muted">${h(x.ligne.libelle)}</div></td>
              <td><span class="nw">${C.fmtDate(x.mouvement.date)}</span>${x.jours ? ` <small class="muted">(${x.jours} j d'écart)</small>` : ''}<div class="small muted">${h(x.mouvement.label)}${x.mouvement.party ? ' — ' + h(x.mouvement.party) : ''}</div></td>
              <td class="r nw m ${x.ligne.montant > 0 ? 'ok-text' : ''}">${moneySigne(x.ligne.montant, cur)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${ap.remises.length ? `<h3 class="tr-h">Une ligne du relevé, plusieurs mouvements : une remise ${info('tre.remise')}</h3>
            <div class="scroll-x"><table class="list compact" id="imp-remises"><thead><tr><th style="width:40px"></th><th>Sur le relevé</th><th>Dans SkanFact</th><th class="r">Montant</th></tr></thead><tbody>
            ${ap.remises.map((x, i) => `<tr><td><input type="checkbox" data-remise="${i}" checked aria-label="Pointer ces ${x.mouvements.length} mouvements"></td>
              <td><span class="nw">${C.fmtDate(x.ligne.date)}</span><div class="small muted">${h(x.ligne.libelle)}</div></td>
              <td>${x.mouvements.map(m => `<div class="tr-imp-m"><span class="nw">${C.fmtDate(m.date)}</span> <span class="small muted">${h(m.label)}${m.party ? ' — ' + h(m.party) : ''}</span> <span class="nw m">${moneySigne(m.amount, cur)}</span></div>`).join('')}</td>
              <td class="r nw m ${x.ligne.montant > 0 ? 'ok-text' : ''}">${moneySigne(x.ligne.montant, cur)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${ap.absentes.length ? `<h3 class="tr-h">Sur le relevé, pas dans SkanFact</h3>
            <p class="small muted">Des frais, un prélèvement, un virement reçu sans facture : crée le mouvement, il naît pointé. Un paiement de client se note plutôt sur sa facture.${paieCachee() ? ' <b id="imp-sans-paie">Un salaire, une avance ou une déclaration sociale payés n\'apparaissent pas pour ton rôle : ne les crée pas ici, la paie les porte déjà.</b>' : ''}</p>
            <div class="scroll-x"><table class="list compact" id="imp-absentes"><tbody>
            ${ap.absentes.map((l, i) => `<tr><td class="nw">${C.fmtDate(l.date)}</td><td>${h(l.libelle)}</td><td class="r nw m ${l.montant > 0 ? 'ok-text' : ''}">${moneySigne(l.montant, cur)}</td><td class="r"><button type="button" class="btn btn-sm" data-absente="${i}">Créer le mouvement</button></td></tr>`).join('')}</tbody></table></div>` : ''}
          ${rel.soldes.fin != null ? `<p class="small">Solde final du relevé : <b>${C.money(rel.soldes.fin, cur)}</b>. Il sera recopié comme solde de ton relevé.</p>` : ''}
          <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn btn-primary" id="ok"></button></div>`,
        (root, close) => {
          const ok = $('#ok', root);
          // Ce qui se pointe : le mouvement de chaque paire cochée, et TOUS ceux d'une remise cochée (1.298.0).
          const coches = () => [...$$('[data-paire]', root).filter(c => c.checked).map(c => ap.paires[Number(c.dataset.paire)].mouvement),
            ...$$('[data-remise]', root).filter(c => c.checked).flatMap(c => ap.remises[Number(c.dataset.remise)].mouvements)];
          const dire = () => { const n = coches().length; ok.textContent = n ? `Pointer ${pl(n, 'mouvement')}` : rel.soldes.fin != null ? 'Recopier le solde' : 'Rien à pointer'; ok.disabled = !n && rel.soldes.fin == null; };
          $$('[data-paire], [data-remise]', root).forEach(c => c.onchange = dire); dire();
          $$('[data-absente]', root).forEach(b => b.onclick = () => {
            const l = ap.absentes[Number(b.dataset.absente)];
            movementForm(null, () => { crees.add(b.dataset.absente); b.disabled = true; b.textContent = 'Créé, pointé'; }, {
              date: l.date, amount: Math.abs(l.montant), kind: C.natureDuReleve(l.libelle, l.montant), accountId: accId,
              label: l.libelle || '', reference: l.reference || '', reconciled: true });
          });
          ok.onclick = () => {
            const l = coches();
            const avant = l.map(m => { const hit = porteur(m.id); return hit ? { id: m.id, v: !!hit.reconciled } : null; }).filter(Boolean);
            const soldeAvant = acc.statementBalance;
            avant.forEach(x => { const hit = porteur(x.id); if (hit) hit.reconciled = true; });
            if (rel.soldes.fin != null) acc.statementBalance = rel.soldes.fin;
            save(true); close(); render(true);   // les compteurs de l'en-tête (« à pointer ») bougent aussi
            toastUndo(avant.length ? `${pl(avant.length, 'mouvement pointé', 'mouvements pointés')} depuis le relevé` : 'Solde du relevé recopié', () => {
              avant.forEach(x => { const hit = porteur(x.id); if (hit) hit.reconciled = x.v; });
              acc.statementBalance = soldeAvant; save(true); render(true);
            });
          };
        });
      }
    }

    $$('#t-tabs [data-tab]').forEach(b => b.onclick = () => {
      s.tab = b.dataset.tab;
      $$('#t-tabs [data-tab]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      draw();
    });
    // Le compte de la fiche, s'il n'existe pas encore (une caisse créée d'abord, la banque ensuite).
    $('#new-acc').onclick = () => accountForm(null, () => render(), modeleCompte());
    $('#new-move').onclick = () => movementForm(null, () => draw());
    draw();
  };

  // Courbe du solde prévu (1.266.0) : sur le calendrier, en marches — le solde ne bouge qu'aux dates où il se passe
  // quelque chose, et reste plat entre deux. Un point par JOUR (ce qui tombe le même jour, les retards attendus
  // aujourd'hui compris, se lit en un seul point) ; le seuil et le zéro tracés ; un fanion par échéance fiscale (plein
  // quand son montant estimé est dans la courbe) ; un curseur qui lit le jour survolé (`brancherCourbe`).
  function forecastChart(f) {
    const W = 1080, H = 230, left = 60, right = 14, bottom = 26, top = 18;
    const pts = f.points;
    if (pts.length < 2) return `<div class="mg-vide">${lfIc('echeance', 24, 1.6)}<b>Rien à projeter</b><span>Aucune échéance connue sur la période.</span></div>`;
    const cur = company().currency;
    const jour = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
    const j0 = jour(f.today), jN = Math.max(j0 + 1, jour(f.horizon));
    const seuil = Number(f.seuil) || 0;
    // L'échelle part de zéro quand le solde s'en approche (c'est le passage sous zéro qui compte) ; loin de zéro, elle
    // serre les valeurs, sinon quelques milliers de dinars d'écart sur soixante mille dessinent une ligne plate.
    const vals = pts.map(p => p.balance).concat(seuil ? [seuil] : []);
    const vMax = Math.max(...vals), vMin = Math.min(...vals);
    const prochesDeZero = vMin <= 0 || vMin < vMax * 0.25;
    const marge = Math.max(1, (vMax - vMin) * 0.25);
    const hi = prochesDeZero ? Math.max(0, vMax) : vMax + marge, lo = prochesDeZero ? Math.min(0, vMin) : vMin - marge;
    const span = Math.max(1, hi - lo);
    const x = d => left + (W - left - right) * ((jour(d) - j0) / (jN - j0));
    const y = v => top + (H - bottom - top) * (1 - (v - lo) / span);
    const zero = y(Math.max(lo, 0));
    let line = `M${x(pts[0].date).toFixed(1)},${y(pts[0].balance).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) line += ` H${x(pts[i].date).toFixed(1)} V${y(pts[i].balance).toFixed(1)}`;
    line += ` H${x(f.horizon).toFixed(1)}`;
    const area = `${line} V${zero.toFixed(1)} H${x(f.today).toFixed(1)} Z`;
    const grid = [hi, lo + span / 2, lo].map(v => `<line class="grille" x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join('');
    // Un repère par semaine (le lundi), libellé une semaine sur deux au-delà de deux mois.
    const pas = jN - j0 > 70 ? 14 : 7;
    let reperes = '';
    for (let k = 1; k * 7 < jN - j0; k++) {
      const d = C.addDays(f.today, k * 7);
      const xx = x(d).toFixed(1), loin = xx - left > 60 && W - right - xx > 96;
      reperes += `<line class="grille fine" x1="${xx}" x2="${xx}" y1="${top}" y2="${H - bottom}"/>${(k * 7) % pas === 0 && loin ? `<text x="${xx}" y="${H - 8}" text-anchor="middle">${h(C.fmtDate(d).slice(0, 5))}</text>` : ''}`;
    }
    // Un point par jour : le solde au soir, et ce qui l'a fait bouger.
    const jours = [];
    pts.forEach((p, i) => {
      const e = i ? f.events[i - 1] : null;
      let g = jours[jours.length - 1];
      if (!g || g.date !== p.date) { g = { date: p.date, balance: p.balance, items: [] }; jours.push(g); }
      g.balance = p.balance;
      if (e) g.items.push(e);
    });
    const bas = f.lowest;
    const dots = jours.filter(g => g.items.length).map(g => `<circle cx="${x(g.date).toFixed(1)}" cy="${y(g.balance).toFixed(1)}" r="${g.items.length > 1 ? 4 : g.balance < seuil ? 3.5 : 2.6}" class="${g.balance < seuil ? 'pt-n' : 'pt'}${g.items.length > 1 ? ' grp' : ''}"/>`).join('');
    const fiscEst = new Set(f.events.filter(e => e.kind === 'fiscal').map(e => e.date));
    const fanions = (f.fiscal || []).filter(fi => fi.date >= f.today && fi.date <= f.horizon).map(fi => {
      const xx = x(fi.date).toFixed(1);
      return `<g class="tr-fanion${fiscEst.has(fi.date) ? ' plein' : ''}"><line x1="${xx}" x2="${xx}" y1="${top - 12}" y2="${H - bottom}"/><path d="M${xx},${top - 12} l9,3.5 -9,3.5 Z"/><title>${h(`${fi.label} — ${C.fmtDate(fi.date)}${fiscEst.has(fi.date) ? ' (montant estimé dans la courbe)' : ' (montant inconnu)'}`)}</title></g>`;
    }).join('');
    const ySeuil = y(seuil).toFixed(1);
    const svg = `<svg class="mg-graphe tr-graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(`Solde prévu jusqu'au ${C.fmtDate(f.horizon)} : au plus bas ${C.money(bas.balance, cur)} le ${C.fmtDate(bas.date)}`)}">
      ${grid}${reperes}
      <path d="${area}" class="tr-aire"/>
      ${lo <= 0 ? `<line class="zero" x1="${left}" x2="${W - right}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}"/>` : ''}
      ${seuil ? `<line class="tr-seuil-l" x1="${left}" x2="${W - right}" y1="${ySeuil}" y2="${ySeuil}"/><text class="tr-seuil-t" x="${W - right - 4}" y="${(y(seuil) - 5).toFixed(1)}" text-anchor="end">seuil ${h(short(seuil))}</text>` : ''}
      ${fanions}
      <path d="${line}" class="courbe"/>
      ${dots}
      <circle cx="${x(bas.date).toFixed(1)}" cy="${y(bas.balance).toFixed(1)}" r="5" class="${bas.balance < seuil ? 'bas-n' : 'bas'}"/>
      <g class="tr-curseur" hidden><line y1="${top}" y2="${H - bottom}"/><circle r="5"/></g>
      <text x="${left}" y="${H - 8}">${h(C.fmtDate(f.today))}</text>
      <text x="${W - right}" y="${H - 8}" text-anchor="end">${h(C.fmtDate(f.horizon))}</text>
    </svg><div class="tr-bulle" hidden></div>`;
    forecastChart.derniere = { W, jours: jours.map(g => ({ ...g, x: x(g.date), y: y(g.balance) })), cur, seuil };
    return svg;
  }
  // Le curseur de la courbe : il suit la souris (ou le doigt), s'arrête sur le jour le plus proche qui a quelque chose,
  // et dit ce jour-là — la date, le solde au soir, et ce qui l'a fait bouger (quatre lignes au plus, puis « et N autres »).
  function brancherCourbe(boite, f) {
    const g = forecastChart.derniere;
    const svg = boite && $('svg.tr-graphe', boite);
    if (!svg || !g || !g.jours.length) return;
    const curseur = $('.tr-curseur', svg), ligne = $('line', curseur), rond = $('circle', curseur), bulle = $('.tr-bulle', boite);
    const montrer = ev => {
      const rc = svg.getBoundingClientRect();
      if (!rc.width) return;
      const vx = (ev.clientX - rc.left) * g.W / rc.width;
      let best = g.jours[0];
      g.jours.forEach(j => { if (Math.abs(j.x - vx) < Math.abs(best.x - vx)) best = j; });
      // Un élément SVG n'a pas la propriété `hidden` des éléments HTML : c'est l'attribut qui se pose et se retire.
      curseur.removeAttribute('hidden');
      ligne.setAttribute('x1', best.x.toFixed(1)); ligne.setAttribute('x2', best.x.toFixed(1));
      rond.setAttribute('cx', best.x.toFixed(1)); rond.setAttribute('cy', best.y.toFixed(1));
      rond.setAttribute('class', best.balance < g.seuil ? 'n' : '');
      const it = best.items;
      bulle.innerHTML = `<b>${h(C.fmtDate(best.date))}${best.date === f.today ? ' · aujourd\'hui' : ''}</b><span class="tr-b-solde">Solde au soir : <b class="${best.balance < g.seuil ? 'rouge' : ''}">${C.money(best.balance, g.cur)}</b></span>
        ${it.slice(0, 4).map(e => `<span class="tr-b-l"><span>${h(e.label)}${e.estime ? ' <i>estimé</i>' : ''}${e.late ? ' <i>en retard</i>' : ''}</span><b class="${e.amount > 0 ? 'ok-text' : ''}">${moneySigne(e.amount, g.cur)}</b></span>`).join('')}
        ${it.length > 4 ? `<span class="muted">et ${it.length - 4} autre${it.length - 4 > 1 ? 's' : ''}</span>` : ''}${!it.length ? '<span class="muted">rien ce jour-là</span>' : ''}`;
      bulle.hidden = false;
      const px = best.x * rc.width / g.W, bw = bulle.offsetWidth || 220;
      bulle.style.left = `${Math.max(4, Math.min(rc.width - bw - 4, px + 12 > rc.width - bw ? px - bw - 12 : px + 12))}px`;
      bulle.style.top = `${Math.max(4, best.y * rc.height / (svg.viewBox.baseVal.height || 230) - 30)}px`;
    };
    const cacher = () => { curseur.setAttribute('hidden', ''); bulle.hidden = true; };
    svg.addEventListener('pointermove', montrer);
    svg.addEventListener('pointerdown', montrer);
    svg.addEventListener('pointerleave', cacher);
  }

  // ---------- Statistiques ----------
  // Une page de pilotage : la même période comparée à l'an dernier, et les quatre questions
  // que se pose un dirigeant — est-ce que je vends, est-ce qu'on me paie, qu'est-ce qui se vend,
  // et qui sont mes clients.
  const statsState = { kind: 'annee', year: C.today().slice(0, 4), n: String(Number(C.today().slice(5, 7))), tab: 'ventes' };

  // (plateforme, lot messagerie) « Mon comptable » : le fil avec le cabinet (plateforme/messagerie.js ; maquette validée
  // par Skander le 09/10/2026). La page fournit ce que le fil ne sait pas : les pièces du dossier (« Parler d'une pièce »),
  // les ouvrir, répondre à une question de la révision (le chemin de `repondreA`), ranger une photo dans les achats.
  let conversationOuverte = null;
  let ceMoisLu = null;
  // (plateforme 1.173.0) Les achats dont le cabinet a joint la pièce dans son classeur (Skander, 29/10/2026 : « oui, tout ») :
  // justifiés ici aussi. Un drapeau non énumérable, posé à la lecture : il ne s'écrit jamais dans le dossier.
  function marquerJustifsCabinet(l) {
    let change = false;
    const par = new Map((l || []).filter(x => x.achat).map(x => [x.achat, x]));
    for (const p of data.purchases || []) {
      const x = par.get(p.id);
      const v = x ? { nom: x.titre, cabinet: x.cabinet, le: (x.jointeLe || x.deposeLe || '').slice(0, 10), piece: x } : undefined;
      if (!!p.justifCabinet !== !!v) change = true;
      Object.defineProperty(p, 'justifCabinet', { value: v, enumerable: false, configurable: true, writable: true });
    }
    if (change) updateNavCounts();
    return change;
  }
  routes.comptable = () => {
    if (conversationOuverte) { conversationOuverte.arreter(); conversationOuverte = null; }
    ceMoisLu = null; // une visite neuve relit ce que le cabinet a fait ; les redessins de la même visite gardent leur lecture
    const view = $('#view');
    if (!bridge.messagerie) {
      view.innerHTML = '<div class="page-head"><h1>Mon comptable</h1></div><div class="panel"><p class="small muted">La messagerie avec ton cabinet se tient en ligne, au serveur.</p></div>';
      return;
    }
    view.innerHTML = '<div id="msg-racine"></div>';
    const doc = d => {
      const t = C.computeTotals(d, company());
      return `${d.number || 'Brouillon'} · ${nomClientPiece(d)} · ${C.money(d.type === 'devis' ? t.totalTTC : t.netToPay, docCur(d))}`;
    };
    const achat = p => `${p.number || p.subject || 'Sans numéro'} · ${p.supplierId ? supplierName(p.supplierId) : 'Sans fournisseur'} · ${C.money(C.purchaseTotals(p, company()).netToPay, p.currency || company().currency)}`;
    const ouvrirPiece = (genre, id) => {
      if (genre === 'achat') { if (!purchaseById(id)) return false; navigate('#/achat/' + id); return true; }
      if (!docById(id)) return false;
      navigate('#/doc/' + id);
      return true;
    };
    const pieceDepart = pieceDuMessage; pieceDuMessage = null;
    const texteDepart = texteDuMessage; texteDuMessage = null;
    const questionDepart = questionDuMessage; questionDuMessage = null;
    conversationOuverte = bridge.messagerie.dessiner($('#msg-racine'), {
      toast,
      pieceDepart,
      prepare: texteDepart ? { texte: texteDepart } : null,
      questionDepart,
      pieces: () => [
        ...data.documents.filter(d => ['facture', 'avoir', 'devis'].includes(d.type) && (d.number || d.status !== 'brouillon'))
          .map(d => ({ genre: d.type, id: d.id, libelle: doc(d), date: d.date })),
        ...data.purchases.map(p => ({ genre: 'achat', id: p.id, libelle: achat(p), date: p.date })),
      ],
      ouvrirPiece,
      // (1.221.0, l'épreuve d'un mois) La date d'un achat que le cabinet demande : la cliente la corrige depuis la demande,
      // l'achat garde tout le reste ; son écriture au cabinet suit l'achat.
      achatDuNumero: numero => {
        const p = data.purchases.find(x => x.number === numero);
        return p ? { id: p.id, date: p.date, libelle: achat(p) } : null;
      },
      corrigerDateAchat: async (numero, date) => {
        const p = data.purchases.find(x => x.number === numero);
        if (!p) throw new Error(`L'achat ${numero} n'est plus dans ton dossier.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Cette date ne se lit pas.');
        p.date = date;
        await save(true);
        updateNavCounts();
        return { genre: 'achat', id: p.id, libelle: achat(p) };
      },
      // Une question de la révision nomme sa pièce par son numéro.
      pieceDuNumero: numero => {
        const d = data.documents.find(x => x.number === numero);
        if (d) return { genre: d.type === 'avoir' ? 'avoir' : d.type === 'devis' ? 'devis' : 'facture', id: d.id };
        const p = data.purchases.find(x => x.number === numero);
        return p ? { genre: 'achat', id: p.id } : null;
      },
      repondre: async (id, texte) => {
        const r = C.repondreQuestion(data.questionsCabinet || [], id, { texte }, Date.now());
        if (!r.ok) throw new Error(r.motif);
        data.questionsCabinet = r.liste;
        await save(true);
        updateNavCounts();
      },
      rangerAchat: m => { rangementDuMessage = { message: m.id, fichier: m, lu: false }; navigate('#/achat/new'); },
      // (1.123.0) La demande cite le numéro d'un achat déjà saisi (un seul) : la photo s'y joint, et le fil dit où elle
      // est rangée (« Ranger dans mes achats » ouvrait un achat neuf, un doublon : revue du mois d'un client, 23/10/2026).
      achatCite: texte => {
        const net = x => String(x || '').toLowerCase().replace(/\s+/g, '');
        const t = net(texte);
        const vus = data.purchases.filter(p => net(p.number).length >= 3 && t.includes(net(p.number)));
        return vus.length === 1 ? { id: vus[0].id, libelle: achat(vus[0]) } : null;
      },
      joindreAchat: async (m, id) => {
        const p = purchaseById(id);
        if (!p) throw new Error('Cet achat n\'est plus dans ton dossier : range la photo comme un autre achat.');
        const fiche = await bridge.attachPath(p.id, bridge.ocrDepuisFichier(m).path);
        p.attachments = (p.attachments || []).concat([fiche]);
        await save(true);
        await bridge.messagerie.rangerAchat(m.id, p.id, achat(p));
        return achat(p);
      },
      // (1.124.0) « Ce mois-ci » : les ventes et les achats du mois (les mêmes règles que l'accueil et le contrôle de
      // clôture : facture ou avoir émis, achat sans pièce jointe), et ce que le cabinet en a fait dans les livres, relu à
      // chaque visite de la page (revue du mois d'un client, 23/10/2026, point 4).
      ceMois: () => {
        const mois = C.today().slice(0, 7);
        const du = mois + '-01', au = C.today();
        const pl = (n, un, plur) => `${n} ${n > 1 ? plur || un + 's' : un}`;
        const ventes = data.documents.filter(d => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.status !== 'annulée' && (d.date || '').startsWith(mois)).length;
        const achats = (data.purchases || []).filter(p => (p.date || '').startsWith(mois));
        const sansPiece = achats.filter(p => C.sansJustificatif(p)).length;
        const pieces = !ventes && !achats.length ? 'Aucune vente ni aucun achat enregistré ce mois-ci.'
          : `${ventes ? pl(ventes, 'vente') : 'Aucune vente'} · ${achats.length ? pl(achats.length, 'achat') : 'aucun achat'}${sansPiece ? `, dont ${sansPiece} sans justificatif` : ''}.`;
        if (!ceMoisLu || ceMoisLu.du !== du) {
          ceMoisLu = { du, r: bridge.messagerie.resume ? bridge.messagerie.resume(du, au) : Promise.resolve(null) };
        }
        const cabinet = ceMoisLu.r.then(r => {
          if (!r) return null;
          const le = r.valideeLe ? ` (dernière validation le ${C.fmtDate(r.valideeLe)})` : '';
          if (!r.validees && !r.brouillard) return 'Rien encore dans tes livres pour ce mois.';
          if (!r.validees) return `Ton cabinet n'a encore rien validé : ${pl(r.brouillard, 'écriture attend', 'écritures attendent')} au brouillard.`;
          if (!r.brouillard) return `Ton cabinet a validé tout le mois : ${pl(r.validees, 'écriture')}${le}.`;
          return `Ton cabinet a validé ${pl(r.validees, 'écriture')}${le} ; ${pl(r.brouillard, 'autre attend', 'autres attendent')} au brouillard.`;
        });
        const nom = new Date(du + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return {
          titre: `Ce mois-ci · ${nom}`, lignes: [pieces], cabinet,
          action: sansPiece ? { libelle: sansPiece > 1 ? 'Voir les achats sans justificatif' : 'Voir l\'achat sans justificatif', faire: () => CHECK_ACTIONS.justificatifs.run({ du, au }) } : null,
        };
      },
      // (1.173.0) Ce que le cabinet a rangé dans le classeur : la liste, et chaque pièce s'ouvre en grand.
      range: bridge.messagerie.range ? async () => { const l = await bridge.messagerie.range(); marquerJustifsCabinet(l); return l; } : null,
      ouvrirRange: async x => {
        try { const lu = await bridge.messagerie.contenuRange(x); justificatifEnGrand(null, { name: lu.nom }, lu, lu.telecharger); } catch (e) { toast(plainError(e), true); }
      },
      voirMandat: () => { comptaState.tab = 'cabinet'; navigate('#/compta'); },
      inviter: () => { comptaState.tab = 'cabinet'; navigate('#/compta'); },
      sansCabinet: bridge.dessinerSansCabinet ? el => {
        const focus = !!comptaState.versInvitation; comptaState.versInvitation = false;
        bridge.dessinerSansCabinet(el, { peutInviter: roleBarre() === 'proprietaire', focus, toast });
      } : null,
      surAttente: a => majMessagerie({ ...(messagerieVue || {}), ...a }),
    });
  };
  // (plateforme, Support S1) « Écrire au support » : la demande part à l'équipe SkanFact, la réponse revient ICI (« Tes
  // demandes au support »), et un e-mail sans contenu prévient la personne. Ce qui part avec, compté et décidé : le
  // sujet, le texte, la version de l'application et le NOM de la page où elle était — celle d'avant l'Aide, c'est là
  // qu'elle travaillait ; jamais un identifiant, ni rien de son dossier.
  let supportOuvert = null;
  // Ce qui attend au support, relu par le démarrage (la pastille de l'Aide, le bandeau) ; après un envoi, tout de suite.
  let relireSupport = () => {};
  const PAGES_DU_SUPPORT = ['aide', 'parametres', 'support', 'guide'];
  const pageDuSupport = () => {
    const ici = routeOf(location.hash);
    if (!PAGES_DU_SUPPORT.includes(ici)) return ici;
    for (let i = navStack.length - 1; i >= 0; i--) { const r = routeOf(navStack[i]); if (!PAGES_DU_SUPPORT.includes(r)) return r; }
    return ici;
  };
  // (plateforme, « Signaler un problème ») Le journal de cet écran (pont.js) : lu ici, et joint à la demande si on le coche,
  // sous le texte de la personne, dans les 4 000 signes d'un message (les plus anciennes lignes partent d'abord).
  const ligneDuJournal = e => `${new Date(e.le).toLocaleString('fr-FR', { timeZone: 'Africa/Tunis', hourCycle: 'h23' })} ${e.message}${e.ou ? ` (${e.ou})` : ''}`;
  function avecJournal(texte, journal) {
    const lignes = journal.map(ligneDuJournal);
    let joint = '';
    while (lignes.length) {
      joint = `\n\n--- journal de cet écran (${pl(lignes.length, 'erreur')}) ---\n${lignes.join('\n')}`;
      if (texte.length + joint.length <= 4000) return texte + joint;
      lignes.shift();
    }
    return texte;
  }
  function voirJournal(journal) {
    modal(`<h2>Le journal de cet écran</h2>
      <p class="small muted">Les erreurs que l'écran a notées depuis son ouverture : l'heure, le message, et l'endroit du code de SkanFact. Il ne part au support que si tu le coches en écrivant ta demande.</p>
      ${journal.length ? `<ul class="small" id="journal-ecran">${journal.map(e => `<li>${h(ligneDuJournal(e))}</li>`).join('')}</ul>`
        : '<p id="journal-ecran">Aucune erreur notée depuis l\'ouverture de cet écran.</p>'}
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`);
  }
  async function ecrireAuSupport(genre) {
    const idee = genre === 'idee';
    let v = null;
    try { v = await bridge.updateVersion(); } catch (_) { /* sans version, la demande part sans elle */ }
    const version = v && v.version && v.version !== 'dev' ? `${v.version}${v.envoi ? '+' + v.envoi : ''}` : null;
    const page = pageDuSupport();
    const nomPage = PAGE_LABELS[page] || '';
    const joint = [version ? `la version de SkanFact (v${h(v.version)})` : 'la version de SkanFact', nomPage ? `la page où tu étais (${h(nomPage)})` : ''].filter(Boolean).join(' et ');
    const journalEcran = !idee && bridge.journalDeLEcran ? bridge.journalDeLEcran() : [];
    modal(`<h2>${idee ? 'Proposer une amélioration' : 'Écrire au support'}</h2>
      <p class="small">${idee
        ? 'Dis ce qui te manque — même si ça te paraît petit : c\'est souvent le petit geste répété tous les lundis qui fait gagner le plus. L\'équipe SkanFact lit chaque idée et te répond ici.'
        : 'Une question, ou quelque chose qui ne marche pas comme prévu : l\'équipe SkanFact te répond ici, dans SkanFact, en général dans la journée. Un e-mail te prévient que la réponse t\'attend.'}</p>
      <form id="sup-form" novalidate>
        ${idee ? `<label class="field obligatoire">${lbl('Ce que tu aimerais faire', 'support.ideeQuoi')}
          <textarea id="sup-quoi" rows="3" maxlength="1800" placeholder="Ex. : envoyer la même relance à plusieurs clients d'un coup."></textarea></label>
        <label class="field">${lbl('Comment tu fais aujourd\'hui', 'support.ideeAujourdhui')}
          <textarea id="sup-auj" rows="3" maxlength="1800" placeholder="Ex. : je les ouvre un par un, ça me prend une demi-heure chaque lundi."></textarea></label>
        <p class="small muted">Cette seconde question est celle qui sert le plus : elle dit le vrai problème, et pas seulement la solution imaginée.</p>`
        : `<label class="field obligatoire">${lbl('Le sujet', 'support.sujet')}
          <input id="sup-sujet" maxlength="140" autocomplete="off" placeholder="Ex. : l'émission d'une facture ne répond plus"></label>
        <label class="field obligatoire">${lbl('Ce qui se passe', 'support.texte')}
          <textarea id="sup-texte-demande" rows="5" maxlength="4000" placeholder="Ce que tu faisais, ce que tu attendais, ce qui s'est passé à la place. Une question ? Pose-la telle quelle."></textarea></label>`}
      </form>
      <div class="notes-md mt"><strong>Joint automatiquement</strong>
        <p class="small">${joint} : c'est ce qui aide l'équipe à voir ce que tu vois.</p>
        ${journalEcran.length ? `<label class="check small"><input type="checkbox" id="sup-journal" checked> Et le journal de cet écran : ${pl(journalEcran.length, 'erreur')} depuis son ouverture (l'heure, le message, l'endroit du code).</label>
        <p class="small"><a href="#" id="sup-voir-journal">Lire ce journal avant de l'envoyer</a></p>` : ''}
        <p class="small muted">Rien d'autre : ni client, ni montant, ni document de ton entreprise.</p>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="sup-send">Envoyer au support</button></div>`,
      (root, close) => {
        const bouton = $('#sup-send', root);
        if ($('#sup-voir-journal', root)) $('#sup-voir-journal', root).onclick = e => { e.preventDefault(); voirJournal(journalEcran); };
        const envoyer = async () => {
          if (bouton.disabled) return;
          let sujet, texte;
          if (idee) {
            const quoi = $('#sup-quoi', root).value.trim();
            if (quoi.length < 3) return refus($('#sup-quoi', root), 'Dis en une phrase ce que tu aimerais faire.');
            const auj = $('#sup-auj', root).value.trim();
            // Le sujet de l'idée : sa première ligne, sans balise, tenue dans les 140 signes d'un sujet.
            const ligne = quoi.split('\n')[0].replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
            sujet = `Une idée : ${ligne}`;
            if (sujet.length > 140) sujet = sujet.slice(0, 139).trimEnd() + '…';
            texte = `Ce que j'aimerais faire :\n${quoi}\n\nComment je fais aujourd'hui :\n${auj || '(non précisé)'}`;
          } else {
            sujet = $('#sup-sujet', root).value.trim();
            texte = $('#sup-texte-demande', root).value.trim();
            if (sujet.length < 3) return refus($('#sup-sujet', root), 'Donne un sujet à ta demande, en quelques mots : c\'est lui que l\'équipe lit en premier.');
            if (/[<>]/.test(sujet)) return refus($('#sup-sujet', root), 'Le sujet s\'écrit sans les signes < et >.');
            if (texte.length < 3) return refus($('#sup-texte-demande', root), 'Dis ce qui se passe : ce que tu faisais, ce que tu attendais. C\'est ce qui permet de t\'aider.');
          }
          if ($('#sup-journal', root) && $('#sup-journal', root).checked) texte = avecJournal(texte, journalEcran);
          bouton.disabled = true;
          try {
            const r = await bridge.support.ecrire({ sujet, texte, version, page: /^[a-z][a-z0-9_-]{0,39}$/.test(page) ? page : null });
            close();
            toast('Envoyé : l\'équipe SkanFact te répond ici, dans « Tes demandes au support ».');
            void relireSupport();
            navigate('#/support/' + encodeURIComponent(r.id));
          } catch (e) { toast(plainError(e), true); bouton.disabled = false; }
        };
        bouton.onclick = envoyer;
        $('#sup-form', root).onsubmit = e => { e.preventDefault(); void envoyer(); };
      });
  }
  routes.support = (parts) => {
    if (supportOuvert) { supportOuvert.arreter(); supportOuvert = null; }
    const view = $('#view');
    if (!bridge.support) {
      view.innerHTML = '<div class="page-head"><h1>Tes demandes au support</h1></div><div class="panel"><p class="small muted">Le support de SkanFact se joint en ligne, depuis l\'application.</p></div>';
      return;
    }
    view.innerHTML = '<div id="sup-racine"></div>';
    supportOuvert = bridge.support.dessiner($('#sup-racine'), {
      ecrire: () => ecrireAuSupport('question'),
      choisie: parts && parts[0] ? decodeURIComponent(parts[0]) : null,
      toast: (t, erreur) => toast(t, erreur),
      ouvrirArticle: id => navigate('#/aide/' + id),
    });
  };
  // (plateforme, brique 113) Le groupe : les sociétés de la personne, leurs chiffres lus dans leurs livres au serveur.
  routes.groupe = async () => {
    const tete = `<div class="page-head"><h1>Le groupe ${info('groupe.page')}</h1><div class="actions">${backButton('#/dashboard')}</div></div>`;
    if (!bridge.groupe) { $('#view').innerHTML = `${tete}<div class="panel"><p class="small muted">Le groupe se lit en ligne, au serveur.</p></div>`; return; }
    $('#view').innerHTML = `${tete}<div class="panel"><p class="small muted">Lecture des chiffres de tes sociétés…</p></div>`;
    let r;
    try { r = await bridge.groupe(); } catch (e) {
      $('#view').innerHTML = `${tete}<div class="panel"><p>${h(plainError(e))}</p><button class="btn" id="gr-reessayer">Réessayer</button></div>`;
      $('#gr-reessayer').onclick = () => render(true);
      return;
    }
    const argent = (v, devise) => C.money(Number(v), devise === 'TND' ? 'DT' : devise);
    const COLONNES = [['caMois', 'CA du mois (HT)'], ['caExercice', 'CA de l\'exercice (HT)'], ['aEncaisser', 'À encaisser'], ['aPayer', 'À payer'], ['tresorerie', 'Trésorerie']];
    const ligne = s => s.chiffres
      ? `<tr><td><button type="button" class="link-add" data-groupe-ouvrir="${h(s.id)}" title="Ouvrir ${h(s.raisonSociale)}">${h(s.raisonSociale)}</button></td>${COLONNES.map(([k]) => `<td class="r nw">${h(argent(s.chiffres[k], s.devise))}</td>`).join('')}</tr>`
      : `<tr><td><button type="button" class="link-add" data-groupe-ouvrir="${h(s.id)}" title="Ouvrir ${h(s.raisonSociale)}">${h(s.raisonSociale)}</button></td><td colspan="${COLONNES.length}" class="small muted">${h(s.motif || '')}</td></tr>`;
    const total = t => `<tr class="total-row"><td><strong>Total du groupe${r.totaux.length > 1 ? ` (${h(t.devise === 'TND' ? 'DT' : t.devise)})` : ''}</strong></td>${COLONNES.map(([k]) => `<td class="r nw"><strong>${h(argent(t.chiffres[k], t.devise))}</strong></td>`).join('')}</tr>`;
    $('#view').innerHTML = `${tete}
      <div class="panel" id="groupe-tableau"><h2>Tes sociétés, au ${h(C.fmtDate(r.jour))}</h2>
        <table class="list"><thead><tr><th>Société</th>${COLONNES.map(([, l]) => `<th class="r">${h(l)}</th>`).join('')}</tr></thead>
          <tbody>${r.societes.map(ligne).join('')}</tbody>
          <tfoot>${r.totaux.map(total).join('')}</tfoot></table>
        <p class="small muted mt">Les chiffres viennent des livres de chaque société : le chiffre d'affaires hors taxes (comptes 70), ce que les clients doivent encore (411), ce qui reste à payer aux fournisseurs (401), la banque et la caisse (classe 5). Deux devises ne s'additionnent pas : chacune a son total.</p>
      </div>`;
    $$('[data-groupe-ouvrir]').forEach(b => b.onclick = async () => {
      if (!await leaveOk()) return;
      toast('Ouverture de la société…');
      try { await bridge.switchDossier(b.dataset.groupeOuvrir); } catch (e) { toast(plainError(e), true); }
    });
  };
  // (1.296.0, revue des modules : « Les statistiques ») La page dans la DA des listes, jouée comme une quincaillerie qui
  // facture les chantiers et vend au comptoir : l'en-tête (chemin, phrase, Exporter), quatre chiffres de la période dans une
  // carte — ce qui est vendu, ce qui est entré, ce qui est gagné, ce qui est acheté, chacun comparé à la même période de
  // l'an dernier —, puis quatre onglets : Ventes, Devis, Clients, Achats. Le taux d'acceptation et l'entonnoir des devis
  // vivent ici (Skander, 03/11/2026), la répartition des achats aussi (Skander, 30/10/2026). La période se choisit à
  // droite des onglets, comme l'année des Marges.
  const STATS_TABS = [['ventes', 'Ventes'], ['devis', 'Devis'], ['clients', 'Clients'], ['achats', 'Achats']];
  routes.stats = () => {
    const cur = company().currency;
    const s = statsState;
    if (!STATS_TABS.some(t => t[0] === s.tab)) s.tab = 'ventes';
    s.pagesF = s.pagesF || {}; s.pagesC = s.pagesC || {};
    // Les années d'un commerce qui n'a encore que des achats comptent aussi : l'onglet Achats a des chiffres.
    const years = Array.from(new Set(data.documents.map(d => (d.date || '').slice(0, 4))
      .concat((data.purchases || []).map(p => (p.date || '').slice(0, 4))).filter(Boolean)
      .concat([C.today().slice(0, 4)]))).sort().reverse();
    if (!years.includes(s.year)) s.year = years[0];
    const QUARTERS = [['1', '1ᵉʳ trimestre · janv.–mars'], ['2', '2ᵉ trimestre · avr.–juin'], ['3', '3ᵉ trimestre · juil.–sept.'], ['4', '4ᵉ trimestre · oct.–déc.']];
    const choix = (id, label, opts, val) => `<label class="sel"${id === 's-n' && s.kind === 'annee' ? ' hidden' : ''} id="${id}-l"><select id="${id}" aria-label="${h(label)}">${opts.map(([v, l]) => `<option value="${h(v)}" ${v === val ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>${lfIc('bas', 14)}</label>`;

    $('#view').innerHTML = `
      <div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Statistiques</span></div><h1>Statistiques</h1><p class="sous">Ce que tu vends, ce qui rentre, ce que tu gagnes et ce que tu achètes</p></div>
        <div class="actions mg-act"><button class="btn" id="s-export">Exporter</button></div></div>
      <div class="lf mg sx">
        <div class="cf-carte mg-resume" id="s-resume"></div>
        <div class="mg-barre"><div class="pa-seg" id="s-tabs" role="tablist" aria-label="Les statistiques">${STATS_TABS.map(([id, label]) =>
          `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === s.tab}" class="${id === s.tab ? 'active' : ''}">${label}</button>`).join('')}</div>
          <div class="sx-periode">${choix('s-kind', 'Période analysée', [['annee', 'Année entière'], ['trimestre', 'Trimestre'], ['mois', 'Mois']], s.kind)}
            ${choix('s-year', 'Année', years.map(y => [y, y]), s.year)}
            ${choix('s-n', 'Mois ou trimestre', [], s.n)}</div></div>
        <div class="cf-carte"><div class="cf-onglet" id="s-body"></div></div>
      </div>`;

    const fillN = () => {
      const sel = $('#s-n');
      $('#s-n-l').hidden = s.kind === 'annee';
      if (s.kind === 'annee') return;
      const opts = s.kind === 'trimestre' ? QUARTERS : MONTHS.map((m, i) => [String(i + 1), m]);
      if (!opts.some(o => o[0] === s.n)) s.n = opts[0][0];
      sel.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === s.n ? 'selected' : ''}>${h(l)}</option>`).join('');
    };

    // La comparaison d'un chiffre à la même période de l'an dernier : « ▲ 12 % sur 2025 ». Rien l'an dernier, rien à
    // comparer — et on le dit, plutôt qu'un « + 100 % » qui ne veut rien dire. Un achat qui monte n'est ni bien ni mal :
    // sa flèche reste grise.
    const compare = (now, before, an, neutre) => {
      if (!before) return `rien à comparer en ${an}`;
      const d = Math.round((now - before) / Math.abs(before) * 100);
      return `<span class="delta ${neutre ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}" title="${h(`Même période en ${an} : ${C.money(before, cur)}`)}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} %</span> sur la même période de ${an}`;
    };
    const chiffre = (id, lbl2, val, sous, ton, bulle, aller) => `<div class="mg-chiffre" id="${id}"${aller ? ` data-aller="${aller}" role="button" tabindex="0"` : ''}><span class="mu">${lbl2}${bulle ? ' ' + info(bulle) : ''}</span><b class="${ton || ''}">${val}</b><small>${sous}</small></div>`;
    const section = (id, titre, bulle, corps, tete) => `<section class="sx-s" id="${id}"><div class="section-head"><h2>${titre}${bulle ? ' ' + info(bulle) : ''}</h2>${tete || ''}</div>${corps}</section>`;
    const vide = (titre, phrase) => `<div class="mg-vide">${lfIc('recherche', 24, 1.6)}<b>${titre}</b><span>${phrase}</span></div>`;

    const draw = dansUnLot(() => {
      const p = C.periodBounds(s.kind, s.year, s.n);
      const an = p.year - 1;
      const now = C.today();
      const cur1 = C.salesTotals(data, company(), p.from, p.to);
      const prev = C.salesTotals(data, company(), p.prev.from, p.prev.to);
      const canaux = C.ventesParCanal(data, company(), p.from, p.to);
      const enc = C.encaisseSur(data, company(), p.from, p.to);
      const encPrev = C.encaisseSur(data, company(), p.prev.from, p.prev.to);
      // La marge de la page Marges, sur la même période : le même calcul (`marginBy`), le même chiffre.
      const lignesMarge = C.marginBy(data, company(), p.from, p.to, 'client', 0);
      const vendu = C.round3(lignesMarge.reduce((a, r) => a + r.revenue, 0));
      const marge = C.round3(lignesMarge.reduce((a, r) => a + r.margin, 0));
      const margeIncomplete = lignesMarge.some(r => !r.complete);
      const ach = C.achatsRepartis(data, company(), p.from, p.to);
      const achPrev = C.achatsRepartis(data, company(), p.prev.from, p.prev.to);
      const aging = C.agedReceivables(data, company(), now);

      $('#s-resume').innerHTML =
        chiffre('s-c-ventes', 'Vendu HT', montantU(cur1.ht, cur), compare(cur1.ht, prev.ht, an), '', 'stat.ca', 'ventes')
        // Ce qui est entré ne se compare pas seulement à l'an dernier : ce qui reste dû aujourd'hui se lit à côté (l'onglet
        // Clients le range par retard).
        + chiffre('s-c-encaisse', 'Encaissé', montantU(enc.montant, cur), aging.total > 0.0005 ? `${pl(enc.reglements, 'règlement')} · <span class="ambre">${h(C.money(aging.total, cur))} encore dus</span>` : compare(enc.montant, encPrev.montant, an), '', 'stat.encaisse', 'clients')
        + chiffre('s-c-marge', 'Marge estimée', lignesMarge.length ? `${montantU(marge, cur)}${margeIncomplete ? ' <span class="u" title="Des prestations n\'ont pas de coût connu : la marge est surestimée">≈</span>' : ''}` : '—',
          lignesMarge.length ? `${vendu ? `${pct(Math.round(marge / vendu * 1000) / 10)} % de ce qui est vendu` : ''} · voir les marges` : 'aucune vente sur la période', marge < 0 ? 'rouge' : '', 'stat.marge', 'marges')
        + chiffre('s-c-achats', 'Acheté HT', montantU(ach.ht, cur), compare(ach.ht, achPrev.ht, an, true), '', 'stat.achats', 'achats');
      $$('#s-resume [data-aller]').forEach(el => {
        const aller = () => { if (el.dataset.aller === 'marges') { navigate('#/marges'); return; } s.tab = el.dataset.aller; draw(); };
        el.onclick = aller;
        el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aller(); } };
      });
      $$('#s-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === s.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });

      const body = $('#s-body');
      if (s.tab === 'ventes') body.innerHTML = ongletVentes(p, cur1, canaux, now);
      else if (s.tab === 'devis') body.innerHTML = ongletDevis(p, now);
      else if (s.tab === 'clients') body.innerHTML = ongletClients(p, aging, now);
      else body.innerHTML = ongletAchats(p, ach, achPrev, an);
      $$('tr.clickable[data-client]', body).forEach(tr => tr.onclick = () => navigate('#/client/' + tr.dataset.client));
      $$('tr.clickable[data-fournisseur]', body).forEach(tr => tr.onclick = () => navigate('#/fournisseur/' + tr.dataset.fournisseur));
      if ($('#s-goal')) $('#s-goal').onclick = () => askGoal(draw);
      if ($('#s-sx-f')) bindPager($('#s-sx-f'), s.pagesF, () => draw(), '#s-sx-f');
      if ($('#s-sx-c')) bindPager($('#s-sx-c'), s.pagesC, () => draw(), '#s-sx-c');
      $('#s-export').onclick = async () => {
        const funnel = C.quoteFunnel(data, company(), p.from, p.to, now);
        const rows = statsCsvRows(p, cur1, prev, funnel, aging, C.topItems(data, company(), p.from, p.to, 8), C.topClients(data, company(), p.from, p.to, 8),
          C.clientMovement(data, company(), p.from, p.to, company().dormantDays || 180, now), C.payerRanking(data, company(), 5),
          C.objectiveProgress(company().revenueTarget, C.salesTotals(data, company(), `${p.year}-01-01`, `${p.year}-12-31`).ht, now, p.year),
          { canaux, enc, marge, vendu, margeIncomplete, ach, refus: C.motifsDeRefus(data, company(), p.from, p.to) });
        const cols = [{ key: 'section', label: 'Rubrique' }, { key: 'label', label: 'Libellé' }, { key: 'value', label: 'Valeur' }];
        const name = `statistiques-${p.kind === 'annee' ? p.year : `${p.year}-${p.kind}${p.n}`}.csv`;
        const f = await bridge.saveText(name, C.toCsv(rows, cols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
    });

    function ongletVentes(p, cur1, canaux, now) {
      const series = C.revenueByMonth(data, company(), `${p.year}-01-01`, `${p.year}-12-31`);
      const seriesPrev = C.revenueByMonth(data, company(), `${p.year - 1}-01-01`, `${p.year - 1}-12-31`);
      const anPrecedentVide = !seriesPrev.some(x => Number(x.ht));
      series.forEach(x => { x.off = x.month < p.from.slice(0, 7) || x.month > p.to.slice(0, 7); });
      const items = C.topItems(data, company(), p.from, p.to, 8);
      const clients = C.topClients(data, company(), p.from, p.to, 8);
      const yearHT = C.salesTotals(data, company(), `${p.year}-01-01`, `${p.year}-12-31`).ht;
      const obj = C.objectiveProgress(company().revenueTarget, yearHT, now, p.year);
      const itemMax = items.length ? Math.max(...items.map(x => x.ht), 1) : 1;
      const clientMax = clients.length ? Math.max(...clients.map(x => x.ht), 1) : 1;
      const objectif = obj ? `<div class="sx-obj"><div class="gauge"><div class="g-bar"><i style="width:${Math.min(100, Math.max(0, obj.pct))}%"></i><span class="g-mark" style="inset-inline-start:${Math.min(100, obj.expectedPct)}%" title="Où tu devrais en être aujourd'hui"></span></div>
          <div class="g-legend"><span><strong>${C.money(obj.ht, cur)}</strong> réalisés en ${p.year} · ${obj.pct} % de l'objectif</span><span class="muted">objectif ${C.money(obj.goal, cur)}</span></div></div>
          <p class="small ${obj.ahead >= 0 ? 'ok-text' : 'warn-text'}">${obj.ahead >= 0 ? `En avance de ${C.money(obj.ahead, cur)} sur le rythme de l'année.` : `En retard de ${C.money(-obj.ahead, cur)} sur le rythme de l'année.`}
            ${obj.remaining > 0 ? ` Il reste ${C.money(obj.remaining, cur)} à facturer, soit ${C.money(obj.perMonth, cur)} par mois sur les ${obj.monthsLeft} mois restants.` : ' Objectif atteint.'}</p></div>`
        : '';
      const ligneCanal = (nom, c) => `<tr><td><b>${nom}</b></td><td class="r">${c.pieces}${c.avoirs ? `<small class="mu sx-avoirs">et ${pl(c.avoirs, 'avoir')}</small>` : ''}</td><td class="r">${lfMontant(c.ht, cur)}</td><td class="r">${c.pieces ? lfMontant(c.panier, cur) : '<span class="mu">—</span>'}</td></tr>`;
      const comptoir = canaux.comptoir.pieces || canaux.comptoir.avoirs;
      return section('s-mois', `Mois par mois — ${p.year}`, 'stat.chart', `${compareChart(series, anPrecedentVide ? [] : seriesPrev)}
          <div class="legend"><span><i style="background:var(--primary)"></i>${h(p.label)}</span>${p.kind === 'annee' ? '' : `<span><i style="background:var(--primary);opacity:.28"></i>reste de ${p.year}</span>`}${anPrecedentVide ? '' : `<span><i style="background:#9aa7b4;opacity:.6"></i>${p.year - 1}</span>`}</div>
          ${objectif}`,
          obj ? '' : `<button class="btn btn-sm" id="s-goal">Se fixer un objectif…</button>`)
        + section('s-canaux', comptoir ? 'Factures et comptoir' : 'Les factures', 'stat.canaux', `<div class="lf-tab scroll-x"><table class="list lf-table" data-sans-cartes><thead><tr><th>Vendu par</th><th class="r">Pièces</th><th class="r">HT</th><th class="r">Panier moyen HT</th></tr></thead><tbody>
            ${ligneCanal('Factures', canaux.factures)}${comptoir ? ligneCanal('Tickets de caisse', canaux.comptoir) : ''}</tbody>
            <tfoot><tr><td><span class="pied-t"><b>${h(p.label.charAt(0).toUpperCase() + p.label.slice(1))}</b></span></td><td class="r m">${cur1.invoices}</td><td class="r m">${lfMontant(cur1.ht, cur)}</td><td></td></tr></tfoot></table></div>
          <p class="small mu sx-note" id="s-tva">TVA collectée sur la période : <b>${h(C.money(cur1.vat, cur))}</b>, à reverser, avoirs déduits. ${info('stat.vat')}</p>`)
        + `<div class="sx-deux">${section('s-items', 'Ce qui se vend le mieux', 'stat.items', items.length ? `<ul class="rank">${items.map(x => `<li><span class="name">${h(x.label)}</span><span class="bar"><i style="width:${largeurRang(x.ht, itemMax)}%"></i></span><span class="amt">${C.money(x.ht, cur)}</span></li>`).join('')}</ul>
            <p class="small mu sx-note">Regroupées par libellé, remises comprises.${items.some(x => x.acomptes) ? ' Un acompte facturé a sa ligne, le mois où il est facturé ; le mois du solde, sa déduction vient en moins de cette ligne.' : ''}</p>` : vide('Aucune vente sur cette période', 'Le classement se remplit dès la première facture émise.'))}
          ${section('s-clients', 'Meilleurs clients (HT)', 'stat.clients', clients.length ? `<ul class="rank">${clients.map(x => `<li><a class="name" href="${x.clientId ? '#/client/' + h(x.clientId) : '#/caisse'}">${h(x.name)}</a><span class="bar"><i style="width:${largeurRang(x.ht, clientMax)}%"></i></span><span class="amt">${C.money(x.ht, cur)}</span></li>`).join('')}</ul>
            ${clients.length > 1 ? `<p class="small ${clients[0].ht / Math.max(1, cur1.ht) > 0.5 ? 'warn-text' : 'mu'} sx-note">${h(clients[0].name)} pèse ${Math.round(clients[0].ht / Math.max(1, cur1.ht) * 100)} % du chiffre d'affaires.${clients[0].ht / Math.max(1, cur1.ht) > 0.5 ? ' C\'est beaucoup : perdre ce client ferait très mal.' : ''}</p>` : ''}`
            : vide('Aucun client facturé sur cette période', 'Le classement se remplit dès la première facture émise.'))}</div>`;
    }

    function ongletDevis(p, now) {
      const funnel = C.quoteFunnel(data, company(), p.from, p.to, now);
      const refus = C.motifsDeRefus(data, company(), p.from, p.to);
      if (!funnel.total) return vide('Aucun devis émis sur cette période', 'Le taux d\'acceptation se lit dès qu\'un devis envoyé a reçu sa réponse.');
      const funMax = Math.max(1, funnel.accepted, funnel.refused, funnel.expired, funnel.pending);
      const nbRefus = refus.reduce((a, x) => a + x.count, 0);
      const premier = refus.find(x => !x.sans);
      return section('s-entonnoir', `Ce que sont devenus les ${pl(funnel.total, 'devis', 'devis')} de la période`, 'stat.funnel', `<div class="lf-tab scroll-x"><table class="list lf-table" data-sans-cartes><thead><tr><th>Issue</th><th class="r">Devis</th><th class="r">Montant TTC</th><th class="mg-barre-h"><span class="vh">Part</span></th></tr></thead><tbody>
            ${[['Acceptés', funnel.accepted, funnel.acceptedAmount, 'ok'], ['Refusés', funnel.refused, funnel.refusedAmount, 'bad'],
               ['Expirés sans réponse', funnel.expired, funnel.expiredAmount, 'warn'], ['Encore en attente', funnel.pending, funnel.pendingAmount, 'neutral']]
              .map(([l, n2, amt, cls]) => `<tr><td><b>${l}</b></td><td class="r">${n2}</td><td class="r">${lfMontant(amt, cur)}</td><td class="mg-barre"><span class="bar"><i class="f-${cls}" style="width:${Math.round(n2 / funMax * 100)}%"></i></span></td></tr>`).join('')}
          </tbody></table></div>
          <p class="small mu sx-note" id="s-taux">Taux d'acceptation : <strong>${funnel.rate == null ? '—' : funnel.rate + ' %'}</strong> (sur les devis tranchés : ceux qui attendent ne le font pas baisser).
            ${funnel.replyDelay == null ? '' : `Délai moyen entre le devis et sa première facture : <strong>${pl(funnel.replyDelay, 'jour')}</strong>.`}${funnel.expired ? ` <a href="#/devis">${pl(funnel.expired, 'devis', 'devis')} sans réponse : une relance suffit souvent.</a>` : ''}</p>`)
        + (nbRefus ? section('s-refus', 'Pourquoi les clients refusent', 'stat.refus', `<div class="lf-tab scroll-x"><table class="list lf-table" data-sans-cartes><thead><tr><th>Motif noté</th><th class="r">Devis</th><th class="r">Montant TTC</th></tr></thead><tbody>
            ${refus.map(x => `<tr><td>${x.sans ? '<span class="mu">Sans motif noté</span>' : `<b>${h(x.label)}</b>`}</td><td class="r">${x.count}</td><td class="r">${lfMontant(x.ttc, cur)}</td></tr>`).join('')}</tbody></table></div>
          ${premier && premier.count * 2 >= nbRefus && nbRefus > 1 ? `<p class="small sx-note">« ${h(premier.label)} » revient dans ${premier.count} refus sur ${nbRefus}.</p>` : ''}`) : '');
    }

    function ongletClients(p, aging, now) {
      const mvt = C.clientMovement(data, company(), p.from, p.to, company().dormantDays || 180, now);
      const payers = C.payerRanking(data, company(), 5);
      const factures = data.documents.some(d => d.type === 'facture' && d.number);
      const dus = aging.total ? `<div class="lf-tab scroll-x"><table class="list lf-table" data-sans-cartes><thead><tr><th>Retard</th><th class="r">Factures</th><th class="r">Montant</th></tr></thead><tbody>
            ${aging.buckets.map(b => `<tr class="${b.min >= 61 && b.amount ? 'warn-text' : ''}"><td>${h(b.label)}</td><td class="r">${b.count || '—'}</td><td class="r">${b.amount ? lfMontant(b.amount, cur) : '—'}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td><span class="pied-t"><b>Total dû aujourd'hui</b><span>toutes périodes confondues</span></span></td><td></td><td class="r m">${lfMontant(aging.total, cur)}</td></tr></tfoot></table></div>
          <p class="small mu sx-note">Au-delà de 90 jours, une créance devient difficile à recouvrer : c'est le moment d'une relance écrite. <a href="#/relances" id="s-relances">Voir les relances</a></p>`
        // Une phrase rassurante se vérifie sur un univers non vide (10.12.0) : « tout est encaissé » félicitait quelqu'un
        // qui n'avait jamais émis une facture.
        : factures ? vide('Rien en attente de paiement', 'Tout est encaissé.') : vide('Aucune facture émise pour l\'instant', 'Il n\'y a rien à encaisser.');
      const nouveaux = mvt.nouveaux.length ? `<table class="list lf-table" data-sans-cartes><thead><tr><th>Client</th><th class="sx-date">Première facture</th><th class="r">HT sur la période</th></tr></thead><tbody>
            ${mvt.nouveaux.slice(0, 8).map(x => `<tr class="clickable" data-client="${h(x.clientId)}"><td class="cl"><span class="cl-i">${pastilleClient(x.clientId, x.name)}<span><b>${h(x.name)}</b></span></span></td><td class="sx-date">${C.fmtDate(x.since)}</td><td class="r">${lfMontant(x.ht, cur)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="small mu sx-note">Aucun nouveau client sur cette période.</p>';
      const dormants = mvt.dormants.length ? `<table class="list lf-table" data-sans-cartes><thead><tr><th>Client</th><th>Dernière pièce</th><th class="r">Silence</th></tr></thead><tbody>
            ${mvt.dormants.slice(0, 8).map(x => `<tr class="clickable" data-client="${h(x.clientId)}"><td class="cl"><span class="cl-i">${pastilleClient(x.clientId, x.name)}<span><b>${h(x.name)}</b></span></span></td><td>${C.fmtDate(x.last)}</td><td class="r">${x.days} j</td></tr>`).join('')}</tbody></table>
          <p class="small mu sx-note">Un appel suffit parfois : ce sont des clients qui te connaissent déjà.</p>`
        : '<p class="small mu sx-note">Aucun client endormi. Tu les fais tous travailler.</p>';
      const delai = C.delaiJours(company().paymentTermsDays, 30);
      const payeurs = payers.tous.length === 1 ? `<p class="sx-note">Un seul client a soldé une facture : <a href="#/client/${h(payers.tous[0].clientId)}">${h(payers.tous[0].name)}</a>, en ${pl(payers.tous[0].delay, 'jour')} en moyenne. Le classement viendra avec le deuxième.</p>`
        : payers.tous.length ? `<div class="sx-deux sx-payeurs">
            <div><h3 class="sub-h">Les plus rapides</h3><ul class="rank plain">${payers.rapides.map(x => `<li><a class="name" href="#/client/${h(x.clientId)}">${h(x.name)}</a><span class="amt">${x.delay} j</span></li>`).join('')}</ul></div>
            <div><h3 class="sub-h">Les plus lents</h3><ul class="rank plain">${payers.lents.map(x => `<li><a class="name" href="#/client/${h(x.clientId)}">${h(x.name)}</a><span class="amt">${delai && x.delay > delai ? `<span class="warn-text" title="Plus que ton délai annoncé">${x.delay} j</span>` : `${x.delay} j`}</span></li>`).join('')}</ul></div></div>
          <p class="small mu sx-note">Délai moyen entre la date de facture et le dernier paiement, sur les factures soldées. ${delai ? `Ton délai annoncé est de ${pl(delai, 'jour')}.` : 'Tes factures sont payables à réception.'}</p>`
        : vide('Aucune facture soldée pour l\'instant', 'Le classement apparaîtra au premier paiement.');
      return section('s-dus', 'Ce qu\'on te doit', 'stat.aging', dus)
        + section('s-mouvement', 'Nouveaux et endormis', 'stat.mouvement', `<div class="sx-deux"><div><h3 class="sub-h">Nouveaux sur la période (${mvt.nouveaux.length})</h3>${nouveaux}</div>
            <div><h3 class="sub-h">Endormis depuis plus de ${pl(company().dormantDays || 180, 'jour')} (${mvt.dormants.length})</h3>${dormants}</div></div>`)
        + section('s-payeurs', 'Qui paie vite, qui paie tard', 'stat.payeurs', payeurs);
    }

    function ongletAchats(p, ach, achPrev, an) {
      if (!ach.pieces) return vide(`Aucun achat ${p.kind === 'annee' ? 'en ' + p.year : 'sur cette période'}`, (data.purchases || []).length ? 'Choisis une autre période, ou ouvre la liste des achats.' : 'La répartition se remplit dès la première facture d\'achat ou dépense enregistrée.');
      const max = Math.max(1, ...ach.fournisseurs.map(x => Math.abs(x.ht)), ...ach.categories.map(x => Math.abs(x.ht)));
      const ligne = (x, attr) => `<tr${attr}><td class="cl">${attr ? `<span class="cl-i">${pastilleClient(x.supplierId, x.label)}<span><b>${h(x.label)}</b></span></span>` : `<b>${h(x.label)}</b>`}</td><td class="r">${x.pieces}</td><td class="r m${x.ht < 0 ? ' rouge' : ''}">${lfMontant(x.ht, cur)}</td><td class="r sx-part">${ach.ht ? `${pct(Math.round(x.ht / ach.ht * 1000) / 10)} %` : ''}</td><td class="mg-barre"><span class="bar"><i class="f-neutral" style="width:${Math.max(3, Math.round(Math.abs(x.ht) / max * 100))}%"></i></span></td></tr>`;
      const tableau = (id, titre, liste, etat, noun, attr) => {
        const vue = paginate(liste, etat);
        return `<div id="${id}"><div class="lf-tab scroll-x"><table class="list lf-table" data-sans-cartes><thead><tr><th>${titre}</th><th class="r">Pièces</th><th class="r">HT</th><th class="r sx-part">Part</th><th class="mg-barre-h"><span class="vh">Part des achats</span></th></tr></thead><tbody>
            ${vue.rows.map(x => ligne(x, attr(x))).join('')}</tbody>
            <tfoot><tr><td><span class="pied-t"><b>Total</b><span>${pl(liste.length, noun)}</span></span></td><td class="r m">${ach.pieces}</td><td class="r m">${lfMontant(ach.ht, cur)}</td><td class="sx-part"></td><td></td></tr></tfoot></table>
          ${pagerBar(vue.pg, { noun })}</div></div>`;
      };
      return section('s-fournisseurs', 'Par fournisseur', 'stat.achats', tableau('s-sx-f', 'Fournisseur', ach.fournisseurs, s.pagesF, 'fournisseur', x => x.supplierId ? ` class="clickable" data-fournisseur="${h(x.supplierId)}"` : ''),
          `<a class="btn btn-sm" href="#/achats">Voir les achats</a>`)
        + section('s-categories', 'Par catégorie', 'stat.achats-cat', tableau('s-sx-c', 'Catégorie', ach.categories, s.pagesC, 'catégorie', () => ''))
        + `<p class="small mu sx-note">Hors taxes, en ${h(C.normCurrency(cur))}, factures d'achat et dépenses de la période ; un avoir fournisseur vient en moins, un acompte versé n'y est pas (sa facture le reprend). ${achPrev.ht ? `${C.money(achPrev.ht, cur)} sur la même période de ${an}.` : ''}</p>`;
    }

    fillN();
    // Une autre période remet les tableaux paginés à leur première page.
    const autrePeriode = () => { s.pagesF.page = 1; s.pagesC.page = 1; draw(); };
    $('#s-kind').onchange = e => { s.kind = e.target.value; fillN(); autrePeriode(); };
    $('#s-year').onchange = e => { s.year = e.target.value; autrePeriode(); };
    $('#s-n').onchange = e => { s.n = e.target.value; autrePeriode(); };
    $$('#s-tabs [data-tab]').forEach(b => b.onclick = () => { s.tab = b.dataset.tab; draw(); });
    draw();
  };

  // Histogramme comparatif : la période en cours devant, la même période l'an dernier derrière.
  function compareChart(series, prev) {
    const W = 640, H = 220, left = 48, bottom = 26, top = 10;
    const vals = series.map(x => x.ht).concat(prev.map(x => x.ht));
    const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
    const span = Math.max(1, hi - lo);
    const slot = (W - left) / Math.max(1, series.length);
    const y = v => top + (H - bottom - top) * (1 - (v - lo) / span);
    const zero = y(0);
    const grid = [0, 0.5, 1].map(f => { const v = lo + span * f; return `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="lbl" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${hi || lo ? short(v) : (f ? '' : '0')}</text>`; }).join('');
    // Sur un mois seul, deux barres à 34 % d'un créneau large de 600 px seraient deux pavés :
    // on plafonne la largeur et on centre la paire dans son créneau.
    const bw = Math.min(slot * 0.34, 52), gap = Math.min(slot * 0.04, 8);
    const bar = (v, x0, cls, title) => `<rect class="${cls}" x="${x0}" width="${bw}" y="${Math.min(y(v), zero)}" height="${Math.max(1, Math.abs(zero - y(v)))}" rx="2"><title>${h(title)}</title></rect>`;
    const bars = series.map((x, i) => {
      const mid = left + i * slot + slot / 2, p = prev[i];
      const cy = company().currency;
      return (p ? bar(p.ht, mid - bw - gap / 2, 'bar-prev', `${p.label} ${p.month.slice(0, 4)} — ${C.money(p.ht, cy)}`) : '')
        + bar(x.ht, p ? mid + gap / 2 : mid - bw / 2, x.off ? 'bar-inv bar-off' : 'bar-inv', `${x.label} ${x.month.slice(0, 4)} — ${C.money(x.ht, cy)}`)
        + `<text class="lbl" x="${mid}" y="${H - 8}" text-anchor="middle">${h(x.label)}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<line class="axis" x1="${left}" x2="${W}" y1="${zero}" y2="${zero}"/>${bars}</svg>`;
  }

  // Objectif annuel : demandé depuis la page Statistiques, enregistré dans la société.
  function askGoal(after) {
    modal(`<h2>Objectif de chiffre d'affaires</h2>
      <p class="small muted">Le montant HT que tu veux facturer sur une année entière. Tu peux le changer quand tu veux dans Paramètres → Documents.</p>
      <form id="gf"><label class="field">${lbl(`Objectif annuel HT (${C.normCurrency(company().currency)})`, 'stat.target')}<input type="number" name="target" min="0" step="1" class="num montant" value="${Number(company().revenueTarget) || ''}" placeholder="aucun objectif"></label></form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (root, close) => { $('#ok', root).onclick = () => {
        const v = formValues($('#gf', root));
        data.company.revenueTarget = Math.max(0, Number(v.target) || 0);
        save(true); close(); if (after) after();
        toast(data.company.revenueTarget ? 'Objectif enregistré' : 'Objectif retiré');
      }; });
  }

  // Export CSV de la page : une ligne par chiffre, pour reprise dans un tableur.
  // (1.296.0) `plus` : ce que la page montre de plus depuis sa revue — le comptoir, l'encaissé, la marge, les achats répartis,
  // les motifs de refus. L'export dit ce que la page dit.
  function statsCsvRows(p, cur1, prev, funnel, aging, items, clients, mvt, payers, obj, plus) {
    const cur = company().currency;
    const m = n => C.money(n, cur);
    const rows = [
      { section: 'Période', label: 'Analysée', value: p.label },
      { section: 'Période', label: 'Du', value: p.from }, { section: 'Période', label: 'Au', value: p.to },
      { section: 'Ventes', label: 'Chiffre d\'affaires HT', value: m(cur1.ht) },
      { section: 'Ventes', label: 'Chiffre d\'affaires HT — même période l\'an dernier', value: m(prev.ht) },
      { section: 'Ventes', label: 'TVA collectée', value: m(cur1.vat) },
      { section: 'Ventes', label: 'Total TTC', value: m(cur1.ttc) },
      { section: 'Ventes', label: 'Factures émises', value: cur1.invoices },
      { section: 'Ventes', label: 'Panier moyen HT', value: m(cur1.avgTicket) },
      ...(plus ? [
        { section: 'Ventes', label: 'Dont factures', value: `${m(plus.canaux.factures.ht)} (${pl(plus.canaux.factures.pieces, 'facture')})` },
        { section: 'Ventes', label: 'Dont tickets de caisse', value: `${m(plus.canaux.comptoir.ht)} (${pl(plus.canaux.comptoir.pieces, 'ticket')})` },
        { section: 'Encaissements', label: 'Encaissé sur la période', value: `${m(plus.enc.montant)} (${pl(plus.enc.reglements, 'règlement')})` },
        { section: 'Marge', label: 'Marge estimée', value: `${m(plus.marge)}${plus.margeIncomplete ? ' (surestimée : des coûts manquent)' : ''}` },
        { section: 'Achats', label: 'Achats HT de la période', value: `${m(plus.ach.ht)} (${pl(plus.ach.pieces, 'pièce')})` },
        ...plus.ach.fournisseurs.map(x => ({ section: 'Achats par fournisseur', label: x.label, value: `${m(x.ht)} (${pl(x.pieces, 'pièce')})` })),
        ...plus.ach.categories.map(x => ({ section: 'Achats par catégorie', label: x.label, value: `${m(x.ht)} (${pl(x.pieces, 'pièce')})` }))
      ] : []),
      { section: 'Devis', label: 'Émis', value: funnel.total },
      { section: 'Devis', label: 'Acceptés', value: `${funnel.accepted} (${m(funnel.acceptedAmount)})` },
      { section: 'Devis', label: 'Refusés', value: `${funnel.refused} (${m(funnel.refusedAmount)})` },
      { section: 'Devis', label: 'Expirés sans réponse', value: `${funnel.expired} (${m(funnel.expiredAmount)})` },
      { section: 'Devis', label: 'En attente', value: `${funnel.pending} (${m(funnel.pendingAmount)})` },
      { section: 'Devis', label: 'Taux d\'acceptation', value: funnel.rate == null ? '' : funnel.rate + ' %' },
      { section: 'Devis', label: 'Délai moyen de réponse (jours)', value: funnel.replyDelay == null ? '' : funnel.replyDelay },
      ...(plus ? plus.refus.map(x => ({ section: 'Devis refusés', label: x.label, value: `${x.count} (${m(x.ttc)})` })) : [])
    ];
    aging.buckets.forEach(b => rows.push({ section: 'Impayés', label: b.label, value: `${b.count} — ${m(b.amount)}` }));
    rows.push({ section: 'Impayés', label: 'Total dû', value: m(aging.total) });
    items.forEach((x, i) => rows.push({ section: 'Prestations', label: `${i + 1}. ${x.label}`, value: m(x.ht) }));
    clients.forEach((x, i) => rows.push({ section: 'Clients', label: `${i + 1}. ${x.name}`, value: m(x.ht) }));
    mvt.nouveaux.forEach(x => rows.push({ section: 'Nouveaux clients', label: x.name, value: `${C.fmtDate(x.since)} — ${m(x.ht)}` }));
    mvt.dormants.forEach(x => rows.push({ section: 'Clients endormis', label: x.name, value: `${C.fmtDate(x.last)} — ${pl(x.days, 'jour')}` }));
    payers.tous.forEach(x => rows.push({ section: 'Délai de paiement', label: x.name, value: `${pl(x.delay, 'jour')} sur ${pl(x.count, 'facture')}` }));
    if (obj) {
      rows.push({ section: 'Objectif', label: 'Objectif annuel HT', value: m(obj.goal) });
      rows.push({ section: 'Objectif', label: 'Réalisé', value: `${m(obj.ht)} (${obj.pct} %)` });
      rows.push({ section: 'Objectif', label: 'Reste à facturer', value: m(obj.remaining) });
    }
    return rows;
  }

  // (1.301.0) Les livres du cabinet lus au serveur (`bridge.livresDuCabinet`) : ses déclarations de l'année, sa période validée.
  let livresCabinetLus = null;
  // « d'octobre », « d'août », « de septembre » : l'élision devant une voyelle.
  const deMois = m => (/^[aeiouyéèêâh]/i.test(String(m)) ? `d'${m}` : `de ${m}`);
  routes.compta = () => {
    const cur = company().currency;
    const years = Array.from(new Set(data.documents.map(d => (d.date || '').slice(0, 4)).filter(Boolean).concat([C.today().slice(0, 4)]))).sort().reverse();
    if (!years.includes(comptaState.year)) comptaState.year = years[0];
    // Un mois finit à son VRAI dernier jour (10.14.0) : « -31 » pour tous faisait arrêter les états
    // « au 31/09/2025 », et février comptait deux jours d'amortissement de trop (le 31 février vaut
    // le 30 en base 360, et mars recomptait les 29 et 30).
    const period = () => comptaState.month
      ? (({ from, to }) => ({ from, to }))(C.packPeriod(comptaState.year, comptaState.month))
      : { from: `${comptaState.year}-01-01`, to: `${comptaState.year}-12-31` };
    const periodLabel = () => comptaState.month ? `${MONTHS[Number(comptaState.month) - 1]} ${comptaState.year}` : `année ${comptaState.year}`;

    // (1.301.0) La DA des listes, comme les Statistiques et les Marges : le chemin, la phrase, les onglets dans leur barre et la
    // période à droite, chaque onglet dans sa carte. Les identifiants restent (`#c-tabs`, `#c-year`, `#c-month`, `#c-body`).
    const choixPeriode = (id, label, opts) => `<label class="sel"><select id="${id}" aria-label="${h(label)}">${opts}</select>${lfIc('bas', 14)}</label>`;
    const avecCabinet = !!(messagerieVue && messagerieVue.cabinet);
    $('#view').innerHTML = `
      <div class="page-head lf-tete"><div class="titre"><div class="chemin"><a href="#/dashboard">Accueil</a>${ICONE_CHEVRON}<span>Comptabilité</span></div><h1>Comptabilité</h1>
        <p class="sous">${avecCabinet ? 'Tes ventes, tes achats, ta TVA et tes livres, mois par mois — et ce que ton cabinet en a fait' : 'Tes ventes, tes achats, ta TVA et tes livres, mois par mois'}</p></div>
        ${!C.sousModuleOn(data, 'compta.livres') ? `<div class="actions mg-act"><button class="btn" id="c-plus" title="Grand livre, balance, états financiers">+ Comptabilité complète</button></div>` : ''}</div>
      ${bandeauSansPaie('cette comptabilité')}
      <div class="lf mg cpt">
        <div class="mg-barre"><div class="pa-seg" id="c-tabs" role="tablist" aria-label="La comptabilité">${COMPTA_TABS.filter(([id]) => !ONGLETS_OPTION.includes(id) || C.sousModuleOn(data, 'compta.livres')).map(([id, label]) =>
          `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === comptaState.tab}" class="${id === comptaState.tab ? 'active' : ''}${ONGLETS_OPTION.includes(id) ? ' opt' : ''}">${label}${ONGLETS_OPTION.includes(id) && !(licence.options || []).includes('compta') ? ' 🔒' : ''}</button>`).join('')}</div>
          <div class="sx-periode" id="c-period" ${['calendrier', 'clotures', 'cabinet'].includes(comptaState.tab) ? 'hidden' : ''}>
            ${choixPeriode('c-year', 'Année', years.map(y => `<option ${y === comptaState.year ? 'selected' : ''}>${y}</option>`).join(''))}
            ${choixPeriode('c-month', 'Mois', `<option value="">Toute l'année</option>${MONTHS.map((m, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === comptaState.month ? 'selected' : ''}>${m}</option>`; }).join('')}`)}</div></div>
        <div class="cf-carte"><div class="cf-onglet" id="c-body"></div></div>
      </div>`;
    // (1.301.0) Ce que le cabinet a fait des livres (ses déclarations, sa période validée), lu au serveur pour les onglets qui le
    // disent ; relu au plus toutes les 30 secondes, et l'onglet se redessine quand la réponse arrive — jamais sous une fenêtre
    // ni pendant une saisie.
    const lireLivresDuCabinet = () => {
      if (!(messagerieVue && messagerieVue.cabinet) || !bridge.livresDuCabinet || !['tva', 'calendrier', 'clotures'].includes(comptaState.tab)) return;
      const annee = Number(comptaState.tab === 'tva' ? comptaState.year : C.today().slice(0, 4));
      if (livresCabinetLus && livresCabinetLus.annee === annee && Date.now() - livresCabinetLus.lu < 30000) return;
      livresCabinetLus = { annee, declarations: [], valideJusqua: '', lu: Date.now(), enCours: true };
      void bridge.livresDuCabinet(annee).then(l => {
        livresCabinetLus = l ? { ...l, lu: Date.now() } : { annee, declarations: [], valideJusqua: '', lu: Date.now(), illisible: true };
        if (routeOf(location.hash) === 'compta' && ['tva', 'calendrier', 'clotures'].includes(comptaState.tab) && !$('#modal-root .modal')
          && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) draw();
      });
    };
    const draw = dansUnLot(() => {
      // Un onglet masqué ne peut pas rester l'onglet courant : la page s'ouvrirait sur du vide,
      // sans onglet allumé, et on croirait s'être trompé de page.
      if (ONGLETS_OPTION.includes(comptaState.tab) && !C.sousModuleOn(data, 'compta.livres')) comptaState.tab = 'ventes';
      $('#c-period').hidden = ['calendrier', 'clotures', 'cabinet'].includes(comptaState.tab);
      $$('#c-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === comptaState.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
      lireLivresDuCabinet();
      if (comptaState.tab === 'achats') return drawBuyJournal(period(), periodLabel());
      if (comptaState.tab === 'tva') return drawVat();
      if (comptaState.tab === 'ecritures') return drawEntries();
      if (comptaState.tab === 'grandlivre') return drawGrandLivre();
      if (comptaState.tab === 'balance') return drawBalance();
      if (comptaState.tab === 'etats') return drawEtats();
      if (comptaState.tab === 'calendrier') return drawFiscal();
      if (comptaState.tab === 'clotures') return drawClosures();
      if (comptaState.tab === 'cabinet') return drawCabinet();
      const p = period();
      // Recherche : la Comptabilité était l'autre page de liste sans champ de recherche (audit).
      const q = comptaState.q.trim().toLowerCase();
      const hit = (...parts) => !q || C.correspondRecherche(parts.filter(Boolean).join(' '), q);
      const allRows = C.salesJournal(data, company(), p);
      // Le nom d'un justificatif se cherche ici aussi (10.14.1, S-04) : « bon de commande Hôtel »
      // retrouve la facture qui le porte.
      const rows = allRows.filter(r => hit(r.number, r.client, r.subject, r.creditOfNumber, C.nomsJustificatifs({ attachments: C.justificatifsDe(data, { source: 'vente', docId: r.id }) })));
      const sum = C.vatSummary(rows);
      const allPays = C.paymentsJournal(data, company(), p);
      const pays = allPays.filter(r => hit(r.number, r.client, r.reference, r.method));
      const paidTotal = pays.reduce((s, r) => s + r.amount, 0);
      const open = data.documents.filter(d => d.type === 'facture' && ['envoyée', 'partielle', 'retard'].includes(effStatus(d)));
      // Converti, comme sa jumelle de l'accueil : une facture en euros ne s'additionne pas
      // à une facture en dinars (7.16.0).
      const openAmount = open.reduce((s, d) => s + C.toBase(d, balance(d).remaining, company()), 0);
      // Les attestations à recevoir : ce que les clients ont DÉJÀ retenu en payant (10.14.0), en
      // dinars. La liste comptait les factures impayées, et additionnait les retenues en devise sans
      // les convertir — la faute de la 7.16.0, un panneau plus bas.
      const rsAttendues = C.attestationsARecevoir(data, company());
      const rsPendingAmount = C.round3(rsAttendues.reduce((s, x) => s + x.amount, 0));
      // Ce que les clients ont retenu sur les encaissements de la période : c'est ce chiffre-là qui se
      // déclare, pas la retenue que les factures de la période portent.
      // Un avoir posé après un encaissement régularise dans son mois : il compte ici, sauf sous un
      // filtre de recherche (qui ne porte que sur des lignes d'encaissement).
      const rsSubies = C.round3(pays.reduce((s, r) => s + (r.rs || 0), 0) + (q ? 0 : C.retenuesDeLaPeriode(data, company(), p, 'ventes').regularisations));
      const avecRsSubie = pays.some(r => Math.abs(r.rs || 0) > 0.0005);
      const journalCols = [
        { key: 'date', label: 'Date', asc: true, val: r => r.date || '', get: r => C.fmtDate(r.date) },
        { key: 'number', label: 'Numéro', asc: true, val: r => r.number || '', get: r => `<strong>${h(r.number)}</strong>${marqueJustif(C.justificatifsDe(data, { source: 'vente', docId: r.id }))}${r.type === 'avoir' ? `<div class="small muted">avoir · ${h(r.creditOfNumber)}</div>` : ''}` },
        { key: 'client', label: 'Client', asc: true, val: r => (r.client || '').toLowerCase(), get: r => `${h(r.client)}<div class="small muted">${h(r.subject)}</div>` },
        { key: 'ht', label: 'HT', r: true, val: r => r.ht, get: r => montantCompta(r.ht) },
        { key: 'tva', label: 'TVA', r: true, val: r => r.tva, get: r => montantCompta(r.tva) },
        { key: 'ttc', label: 'TTC', r: true, val: r => r.ttc, get: r => montantCompta(r.ttc) },
        { key: 'rs', label: 'RS', r: true, val: r => r.rs, get: r => r.rs ? montantCompta(r.rs) : '—' },
        { key: 'net', label: 'Net', r: true, val: r => r.net, get: r => montantCompta(r.net) },
        { key: 'status', label: 'Statut', asc: true, val: r => r.status || '', get: r => badge(r.status) }
      ];
      const payCols = [
        { key: 'date', label: 'Date', asc: true, val: r => r.date || '', get: r => C.fmtDate(r.date) },
        { key: 'number', label: 'Facture', asc: true, val: r => r.number || '', get: r => `<strong>${h(r.number)}</strong>` },
        { key: 'client', label: 'Client', asc: true, val: r => (r.client || '').toLowerCase(), get: r => h(r.client) },
        { key: 'method', label: 'Mode', asc: true, val: r => r.method || '', get: r => h(r.method) },
        { key: 'reference', label: 'Référence', asc: true, val: r => (r.reference || '').toLowerCase(), get: r => h(r.reference) },
        { key: 'amount', label: 'Montant', r: true, val: r => r.amount, get: r => C.money(r.amount, cur) },
        // La colonne n'existe que si un encaissement de la sélection porte une retenue (9.4.8).
        ...(avecRsSubie ? [{ key: 'rs', label: 'Retenue subie', r: true, val: r => r.rs || 0, get: r => r.rs ? C.money(r.rs, cur) : '<span class="muted">—</span>' }] : [])
      ];
      const jPage = paginate(applySort(rows, journalCols, comptaState.journal.sort), comptaState.journal);
      const pPage = paginate(applySort(pays, payCols, comptaState.pays.sort), comptaState.pays);
      // Les attestations en attente couvrent TOUTES les années : onze cents lignes d'un bloc sous deux
      // tableaux paginés (10.14.0). La plus ancienne d'abord, c'est celle qu'on réclame en premier.
      const rsPage = paginate(rsAttendues, comptaState.rs);
      $('#c-body').innerHTML = `
        <div class="filters">
          <input type="search" id="cpt-q" placeholder="Rechercher : n°, client, objet, référence…" value="${h(comptaState.q)}">
          ${q ? `<span class="small muted">${rows.length} sur ${pl(allRows.length, 'document')} · ${pays.length} sur ${pl(allPays.length, 'paiement')}</span>
            ${filterReset(true)}
            <span class="small warn-text">Les totaux ci-dessous ne portent que sur la sélection.</span>` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="lbl">CA HT — ${h(periodLabel())} ${info('dash.caMonth')}</div><div class="val">${C.money(sum.ht, cur)}</div><div class="sub">${pl(sum.count, 'document')}, avoirs déduits</div></div>
          <div class="stat"><div class="lbl">TVA collectée ${info('compta.vat')}</div><div class="val">${C.money(sum.tva, cur)}</div><div class="sub">+ timbres ${C.money(sum.timbre, cur)}</div></div>
          <div class="stat"><div class="lbl">Encaissé sur la période ${info('compta.payments')}</div><div class="val">${C.money(paidTotal, cur)}</div><div class="sub">${pl(pays.length, 'paiement')}</div></div>
          <div class="stat" data-cstat="encaisser" role="button" tabindex="0" title="Voir les factures qui restent à encaisser"><div class="lbl">Reste à encaisser (total) ${info('dash.open')}</div><div class="val">${C.money(openAmount, cur)}</div><div class="sub">${pl(open.length, 'facture ouverte', 'factures ouvertes')}</div></div>
        </div>
        <div class="panel"><h2>TVA par taux — ${h(periodLabel())} ${info('compta.vat')}</h2>
          <table class="list compact"><thead><tr><th>Taux</th><th class="r">Base HT</th><th class="r">TVA</th></tr></thead><tbody>
            ${C.VAT_RATES.map(r => `<tr><td>TVA ${r} %</td><td class="r">${C.money(sum.byRate[r].base, cur)}</td><td class="r">${C.money(sum.byRate[r].vat, cur)}</td></tr>`).join('')}
            <tr class="total-row"><td><strong>Total</strong></td><td class="r"><strong>${C.money(sum.ht, cur)}</strong></td><td class="r"><strong>${C.money(sum.tva, cur)}</strong></td></tr>
          </tbody></table>
          <p class="small muted mt">Timbres fiscaux : ${C.money(sum.timbre, cur)} · TTC facturé : ${C.money(sum.ttc, cur)} · Retenues à la source subies sur les encaissements de la période : ${C.money(rsSubies, cur)}${Math.abs(sum.rs - rsSubies) > 0.0005 ? ` (les factures de la période en portent ${C.money(sum.rs, cur)} : un client la retient en payant)` : ''}. <em>À VÉRIFIER avec le comptable</em> avant déclaration.</p>
        </div>
        <div class="panel"><h2>Journal des ventes — ${h(periodLabel())} ${info('compta.journal')}</h2>
          <div class="inline mb"><button class="btn" id="exp-journal">Exporter en CSV</button><button class="btn" id="exp-pdfs">Exporter tous les PDF de la période</button><button class="btn${messagerieVue && messagerieVue.cabinet ? '' : ' btn-primary'}" id="exp-comptable">${messagerieVue && messagerieVue.cabinet ? 'Envoyer par e-mail…' : 'Envoyer au comptable…'}</button>${info('compta.comptable')}</div>
          ${messagerieVue && messagerieVue.cabinet ? '<p class="small muted mb" id="exp-cabinet-lit">Ton cabinet lit ces ventes en direct : il n\'y a rien à lui envoyer. Ce bouton sert à les envoyer à quelqu\'un d\'autre, par e-mail.</p>' : ''}
          ${rows.length ? `<div class="scroll-x" id="j-wrap"><table class="list compact sortable"><thead>${sortHead(journalCols, comptaState.journal.sort)}</thead><tbody>
            ${jPage.rows.map(r => `<tr class="clickable" data-id="${r.id}">${journalCols.map(c => `<td class="${c.r ? 'r nw' : ''}">${c.get(r)}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>${pagerBar(jPage.pg, { noun: 'document' })}` : '<div class="empty">Aucune facture émise sur cette période.</div>'}
        </div>
        <div class="panel"><h2>Encaissements — ${h(periodLabel())}</h2>
          <div class="inline mb"><button class="btn" id="exp-pays">Exporter en CSV</button></div>
          ${pays.length ? `<div id="p-wrap"><table class="list compact sortable"><thead>${sortHead(payCols, comptaState.pays.sort)}</thead><tbody>
            ${pPage.rows.map(r => `<tr class="clickable" data-id="${r.docId}">${payCols.map(c => `<td class="${c.r ? 'r nw' : ''}">${c.get(r)}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>${pagerBar(pPage.pg, { noun: 'paiement' })}` : '<div class="empty">Aucun encaissement sur cette période.</div>'}
        </div>
        <div class="panel" id="p-rs-clients"><h2>Retenues à la source — attestations à recevoir ${info('compta.rs')}</h2>
          ${rsAttendues.length ? `<p class="small muted">${C.money(rsPendingAmount, cur)} retenus par tes clients en te payant, sans attestation reçue. Coche quand l'attestation arrive (elle justifie la retenue auprès du fisc). Une facture pas encore payée n'y figure pas : rien n'a encore été retenu.</p>
          <div id="rs-wrap"><table class="list compact"><thead><tr><th>Facture</th><th>Client</th><th>Date</th><th class="r">Retenue</th><th></th></tr></thead><tbody>
            ${rsPage.rows.map(x => { const d = x.doc, t = C.computeTotals(d, company()); return `<tr class="clickable" data-id="${d.id}"><td><strong>${h(d.number)}</strong></td><td>${h(nomClientPiece(d))}</td><td>${C.fmtDate(d.date)}</td><td class="r">${C.money(x.amount, cur)} <span class="muted small">(${pct(t.withholdingRate)} %${x.complete ? '' : ', payée en partie'})</span></td><td class="actions"><button class="btn btn-sm" data-cert="${d.id}">Attestation reçue</button></td></tr>`; }).join('')}
          </tbody></table></div>${pagerBar(rsPage.pg, { noun: 'attestation' })}` : '<p class="small muted">Aucune attestation en attente.</p>'}
        </div>`;
      // `if (e.target.closest('button')) return` comme les sept autres liaisons de ligne : sans lui,
      // un bouton posé DANS la ligne agit ET fait quitter la page. « Attestation reçue » cochait la
      // case puis emmenait sur la facture — on ne voyait jamais que c'était noté.
      $$('tr.clickable[data-id]').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; navigate('#/doc/' + tr.dataset.id); });
      // Chaque tableau a son propre tri et sa propre pagination : on limite la liaison à son panneau.
      const jPanel = $('#j-wrap') && $('#j-wrap').closest('.panel');
      const pPanel = $('#p-wrap') && $('#p-wrap').closest('.panel');
      if (jPanel) {
        bindSort(jPanel, key => { comptaState.journal.sort = toggleSort(comptaState.journal.sort, key, journalCols); comptaState.journal.page = 1; draw(); });
        bindPager(jPanel, comptaState.journal, () => draw(), '#j-wrap');
      }
      if (pPanel) {
        bindSort(pPanel, key => { comptaState.pays.sort = toggleSort(comptaState.pays.sort, key, payCols); comptaState.pays.page = 1; draw(); });
        bindPager(pPanel, comptaState.pays, () => draw(), '#p-wrap');
      }
      if ($('#rs-wrap')) bindPager($('#p-rs-clients'), comptaState.rs, () => draw(), '#p-rs-clients');
      // Même règle que « Marquer déposée » : la ligne quitte la liste des attestations manquantes,
      // et le seul endroit où l'on peut décocher est la fiche de la facture. Le retour vient à nous.
      $$('[data-cert]').forEach(b => b.onclick = () => {
        const d = docById(b.dataset.cert);
        d.withholdingCertificate = true; save(true); draw();
        toastUndo('Attestation notée reçue pour ' + d.number, () => { d.withholdingCertificate = false; save(true); draw(); });
      });
      const tag = tagOf();
      // Envoi au comptable : journal de la période en pièce jointe, message prérempli
      $('#exp-comptable').onclick = async () => {
        if (await demoBlock('Envoyer la comptabilité au comptable')) return;
        if (!rows.length) return toast('Rien à envoyer sur cette période.', true);
        if (!await messagerie()) return;
        const tpl = { ...C.DEFAULT_EMAIL_TEMPLATES.comptable, ...((company().emailTemplates || {}).comptable || {}) };
        const vars = { objet: periodLabel(), numero: rows.length, montant: C.money(sum.ht, cur), societe: company().name, client: company().accountantName || '' };
        modal(`<h2>${messagerieVue && messagerieVue.cabinet ? 'Envoyer la comptabilité par e-mail' : 'Envoyer la comptabilité au comptable'}</h2>
          <p class="small muted">${pl(rows.length, 'document')} · ${C.money(sum.ht, cur)} HT · TVA ${C.money(sum.tva, cur)} — ${h(periodLabel())}</p>
          <form id="cpf" class="grid-2">
            ${field(lbl(messagerieVue && messagerieVue.cabinet ? 'Son adresse e-mail' : 'Email du comptable', 'compta.comptableEmail'), 'to', company().accountantEmail || '', 'email', 'placeholder="comptable@cabinet.tn"')}
            <label class="check" style="align-self:end"><input type="checkbox" name="remember" checked> Retenir cette adresse</label>
            <label class="field span-2">${lbl('Objet', 'mail.objet')}<input type="text" name="subject" value="${h(C.fillTemplate(tpl.subject, vars))}"></label>
            <label class="field span-2">${lbl('Message', 'mail.message')}<textarea name="body" rows="8">${h(C.fillTemplate(tpl.body, vars).replace(/(^|\D)1 documents\b/, (m, avant) => `${avant}1 document`))}</textarea></label>
          </form>
          <p class="small muted">${bridge.dessinerMandat ? 'Le journal des ventes se télécharge en CSV : joins-le au message (un navigateur ne joint pas de fichier lui-même).' : 'Le journal des ventes est joint en CSV.'} Les encaissements et les PDF s'exportent séparément si ton comptable les demande.</p>
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Ouvrir dans la messagerie</button></div>`,
          (root, close) => { $('#ok', root).onclick = async () => {
            const v = formValues($('#cpf', root));
            if (!v.to || !/^[^@\s]+@[^@\s]+$/.test(v.to)) return refus($('[name=to]', root), 'Adresse email invalide.');
            const b = $('#ok', root); b.disabled = true; b.textContent = 'Préparation…';
            try {
              const att = await bridge.saveTextSilent(`journal-ventes-${tag}.csv`, C.toCsv(rows, journalColumns()));
              const r = await bridge.composeMail({ to: v.to, subject: v.subject, body: v.body, attachment: att, mode: modeEnvoi() });
              if (v.remember) { data.company.accountantEmail = v.to; save(true); }
              close();
              toast(messageOuvert(r, 'le journal'));
            } catch (e) { b.disabled = false; b.textContent = 'Ouvrir dans la messagerie'; toast(plainError(e), true); }
          }; });
      };
      // La carte « Reste à encaisser » affichait le même chiffre que sa jumelle de l'accueil et,
      // contrairement à elle, n'ouvrait rien : la 7.15.0 n'avait armé que le tableau de bord.
      $$('#c-body .stat[data-cstat]').forEach(el => {
        const go = e => { if (e.target.closest('.i[data-info]')) return; filtre('facture', 'à encaisser')(); navigate('#/factures'); };
        el.onclick = go;
        el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } };
      });
      $('#cpt-q').oninput = e => { comptaState.q = e.target.value; comptaState.journal.page = 1; comptaState.pays.page = 1; sansPerdreLaFrappe(e.target, draw); };
      if ($('#reset-f')) $('#reset-f').onclick = () => { comptaState.q = ''; draw(); };
      $('#exp-journal').onclick = async () => {
        const p2 = await bridge.saveText(`journal-ventes-${tag}.csv`, C.toCsv(rows, journalColumns())); if (p2) toast('Exporté : ' + p2.split(/[\\/]/).pop());
      };
      $('#exp-pays').onclick = async () => {
        const p2 = await bridge.saveText(`encaissements-${tag}.csv`, C.toCsv(pays, payColumns())); if (p2) toast('Exporté : ' + p2.split(/[\\/]/).pop());
      };
      $('#exp-pdfs').onclick = async () => {
        if (!rows.length) return toast('Rien à exporter sur cette période.', true);
        const files = rows.map(r => { const d = docById(r.id); return { name: `${d.number}_${(r.client || '').replace(/[^\w\-àâäéèêëïîôöùûüç ]/gi, '').trim().replace(/\s+/g, '_')}.pdf`, html: C.documentHtml(d, clientById(d.clientId), company(), { stampText: stampFor(d) }) }; });
        toast(`Génération de ${files.length} PDF…`);
        try { const dir = await bridge.exportPdfMany(files, `SkanFact-${tag}`); if (dir) { toast(`${files.length} PDF exportés dans ${dir.split(/[\\/]/).pop()}`); ditOuverture(await bridge.openPath(dir), dir.split(/[\\/]/).pop()); } }
        catch (e) { toast(plainError(e), true); }
      };
    });
    // ---------- onglet Achats : le journal symétrique de celui des ventes ----------
    function drawBuyJournal(p, label) {
      const q = comptaState.q.trim().toLowerCase();
      const allRows = C.purchaseJournal(data, company(), p);
      const rows = allRows.filter(r => !q || C.correspondRecherche(`${r.piece || ''} ${r.supplier || ''} ${r.subject || ''} ${r.category || ''} ${C.nomsJustificatifs({ attachments: C.justificatifsDe(data, { purchaseId: r.id }) })}`, q));
      const sum = C.purchaseSummary(rows);
      const cols = [
        { key: 'date', label: 'Date', asc: true, cls: 'nw', val: r => r.date || '', get: r => C.fmtDate(r.date) },
        { key: 'number', label: 'N° fournisseur', asc: true, cls: 'nw', val: r => (r.number || r.piece || '').toLowerCase(), get: r => celluleNumeroAchat(r.number, r.piece, marqueJustif(C.justificatifsDe(data, { purchaseId: r.id }))) },
        { key: 'supplier', label: 'Fournisseur', asc: true, val: r => r.supplier.toLowerCase(), get: r => `${h(r.supplier)}${r.subject ? `<div class="small muted">${h(r.subject)}</div>` : ''}` },
        { key: 'category', label: 'Catégorie', asc: true, val: r => (r.category || '').toLowerCase(), get: r => `${h(r.category || '—')}${r.kind === 'Dépense' ? '<div class="small muted">dépense</div>' : ''}` },
        { key: 'ht', label: 'HT', r: true, val: r => r.ht, get: r => montantCompta(r.ht) },
        { key: 'tva', label: 'TVA', r: true, val: r => r.tva, get: r => montantCompta(r.tva) },
        { key: 'deductible', label: 'dont déductible', r: true, val: r => r.deductible, get: r => r.deductible === r.tva ? montantCompta(r.deductible) : r.deductibleAcompte ? `<strong title="${h(`Déjà déduite avec l'acompte : ${montantCompta(r.deductibleAcompte)}`)}">${montantCompta(r.deductible)}</strong><span class="muted small"> acompte déduit</span>` : `<strong>${montantCompta(r.deductible)}</strong>` },
        // « Net à payer » : une pièce pas encore réglée figure aussi dans ce journal — « payé » disait
        // le contraire de son statut, affiché une colonne plus loin (10.14.0).
        { key: 'net', label: 'Net à payer', r: true, val: r => r.net, get: r => montantCompta(r.net) },
        { key: 'status', label: 'Statut', val: r => r.status, get: r => buyBadge(r.status) }
      ];
      // 10.0.1 — Les règlements fournisseurs partaient dans le paquet du comptable
      // (`journaux/reglements-fournisseurs.csv`, depuis la 6.1.0) et n'avaient AUCUN écran ici : le
      // seul des cinq journaux que ton comptable recevait sans que tu puisses l'ouvrir. `decColumns`
      // existait, lue par personne — la signature d'un mécanisme écrit et jamais branché (7.3.0).
      // Le panneau est le jumeau exact des « Encaissements » de l'onglet Ventes : même place, même
      // export, même ligne cliquable — l'argent qui sort se lit comme l'argent qui entre.
      const allDecs = C.supplierPayments(data, company(), p);
      const decs = allDecs.filter(r => !q || C.correspondRecherche(`${r.number || ''} ${r.supplier || ''} ${r.reference || ''} ${r.method || ''}`, q));
      const decTotal = decs.reduce((s, r) => s + r.amount, 0);
      // La retenue à la source s'opère au RÈGLEMENT (10.14.0) : c'est ici, sur l'argent parti, qu'elle
      // se lit — celle d'une facture pas encore payée n'est ni retenue, ni à reverser.
      const rsOp = C.round3(decs.reduce((s, r) => s + (r.rs || 0), 0));
      // Un avoir posé après le règlement régularise la retenue dans SON mois (10.14.0) : la carte dit
      // ce qui se reverse, régularisation comprise ; le tableau, lui, ne liste que les règlements.
      const rsReg = q ? 0 : C.retenuesDeLaPeriode(data, company(), p, 'achats').regularisations;
      const avecRs = decs.some(r => Math.abs(r.rs || 0) > 0.0005);
      const decCols = [
        { key: 'date', label: 'Date', asc: true, cls: 'nw', val: r => r.date || '', get: r => C.fmtDate(r.date) },
        { key: 'number', label: 'Pièce', asc: true, cls: 'nw', val: r => (r.number || r.piece || '').toLowerCase(), get: r => celluleNumeroAchat(r.number, r.piece) },
        { key: 'supplier', label: 'Fournisseur', asc: true, val: r => (r.supplier || '').toLowerCase(), get: r => h(r.supplier) },
        { key: 'method', label: 'Mode', asc: true, val: r => r.method || '', get: r => h(r.method) },
        { key: 'reference', label: 'Référence', asc: true, val: r => (r.reference || '').toLowerCase(), get: r => h(r.reference) },
        { key: 'amount', label: 'Montant', r: true, val: r => r.amount, get: r => C.money(r.amount, cur) },
        // La colonne n'existe que si un règlement de la sélection a retenu quelque chose : une colonne
        // de zéros coûte de la largeur à toutes les autres (9.4.8).
        ...(avecRs ? [{ key: 'rs', label: 'Retenue opérée', r: true, val: r => r.rs || 0, get: r => r.rs ? C.money(r.rs, cur) : '<span class="muted">—</span>' }] : [])
      ];
      const decPage = paginate(applySort(decs, decCols, comptaState.decs.sort), comptaState.decs);
      const pg = paginate(applySort(rows, cols, comptaState.buys.sort), comptaState.buys);
      $('#c-body').innerHTML = `
        <div class="filters">
          <input type="search" id="cpt-q" placeholder="Rechercher : n°, fournisseur, objet…" value="${h(comptaState.q)}">
          ${q ? `<span class="small muted">${rows.length} sur ${allRows.length}</span>${filterReset(true)}
            <span class="small warn-text">Les totaux ne portent que sur la sélection.</span>` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="lbl">Achats HT — ${h(label)} ${info('compta.buyJournal')}</div><div class="val">${C.money(sum.ht, cur)}</div><div class="sub">${pl(sum.count, 'pièce')}</div></div>
          <div class="stat"><div class="lbl">TVA déductible ${info('compta.deductible')}</div><div class="val">${C.money(sum.deductible, cur)}</div><div class="sub">${sum.deductible === sum.tva ? 'toute la TVA de tes achats' : `sur ${C.money(sum.tva, cur)} de TVA facturée`}</div></div>
          <div class="stat"><div class="lbl">Retenues opérées ${info('buy.withholding')}</div><div class="val">${C.money(C.round3(rsOp + rsReg), cur)}</div><div class="sub">${Math.abs(sum.rs - rsOp - rsReg) > 0.0005 ? `sur tes règlements, à reverser — les achats de la période en portent ${C.money(sum.rs, cur)}` : 'sur tes règlements, à reverser au fisc'}${Math.abs(rsReg) > 0.0005 ? `, dont ${C.money(rsReg, cur)} de régularisation par un avoir` : ''}</div></div>
          <div class="stat"><div class="lbl">Total réglé ou dû ${info('compta.buyNet')}</div><div class="val">${C.money(sum.net, cur)}</div><div class="sub">net à payer, toutes pièces</div></div>
        </div>
        ${sum.byCategory.length ? `<div class="panel"><h2>Où part ton argent — ${h(label)} ${info('compta.byCategory')}</h2>
          <ul class="rank">${sum.byCategory.slice(0, 10).map(x => `<li><span class="name">${h(x.label)}</span><span class="bar"><i style="width:${largeurRang(x.ht, sum.byCategory[0].ht)}%"></i></span><span class="amt">${C.money(x.ht, cur)}</span></li>`).join('')}</ul>
        </div>` : ''}
        <div class="panel"><h2>Journal des achats — ${h(label)} ${info('compta.buyJournal')}</h2>
          <div class="inline mb"><button class="btn" id="exp-buys">Exporter en CSV</button></div>
          ${rows.length ? `<div class="scroll-x" id="b-wrap"><table class="list compact sortable"><thead>${sortHead(cols, comptaState.buys.sort)}</thead><tbody>
            ${pg.rows.map(r => `<tr class="clickable" data-bid="${r.id}">${cols.map(c => `<td class="${c.r ? 'r nw' : ''}${c.cls ? ' ' + c.cls : ''}">${c.get(r)}</td>`).join('')}</tr>`).join('')}
          </tbody><tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="r"><strong>${montantCompta(sum.ht)}</strong></td><td class="r"><strong>${montantCompta(sum.tva)}</strong></td>
            <td class="r"><strong>${montantCompta(sum.deductible)}</strong></td><td class="r"><strong>${montantCompta(sum.net)}</strong></td><td></td></tr></tfoot></table></div>${pagerBar(pg.pg, { noun: 'pièce' })}`
            : '<div class="empty">Aucun achat sur cette période.</div>'}
        </div>
        <div class="panel"><h2>Règlements fournisseurs — ${h(label)} ${info('compta.decaissements')}</h2>
          <div class="inline mb"><button class="btn" id="exp-decs">Exporter en CSV</button></div>
          ${decs.length ? `<div id="d-wrap"><table class="list compact sortable"><thead>${sortHead(decCols, comptaState.decs.sort)}</thead><tbody>
            ${decPage.rows.map(r => `<tr class="clickable" data-bid="${r.purchaseId}">${decCols.map(c => `<td class="${c.r ? 'r nw' : ''}${c.cls ? ' ' + c.cls : ''}">${c.get(r)}</td>`).join('')}</tr>`).join('')}
          </tbody><tfoot><tr><td colspan="5"><strong>Total réglé</strong></td><td class="r"><strong>${C.money(decTotal, cur)}</strong></td>${avecRs ? `<td class="r"><strong>${C.money(rsOp, cur)}</strong></td>` : ''}</tr></tfoot></table></div>${pagerBar(decPage.pg, { noun: 'règlement' })}`
            : '<div class="empty">Aucun règlement fournisseur sur cette période.</div>'}
        </div>`;
      $$('#c-body tr[data-bid]').forEach(tr => tr.onclick = () => navigate('#/achat/' + tr.dataset.bid));
      $('#cpt-q').oninput = e => { comptaState.q = e.target.value; comptaState.buys.page = 1; comptaState.decs.page = 1; sansPerdreLaFrappe(e.target, draw); };
      if ($('#reset-f')) $('#reset-f').onclick = () => { comptaState.q = ''; draw(); };
      const panel = $('#b-wrap') && $('#b-wrap').closest('.panel');
      if (panel) {
        bindSort(panel, key => { comptaState.buys.sort = toggleSort(comptaState.buys.sort, key, cols); comptaState.buys.page = 1; draw(); });
        bindPager(panel, comptaState.buys, () => draw(), '#b-wrap');
      }
      $('#exp-buys').onclick = async () => {
        if (!rows.length) return toast('Rien à exporter sur cette période.', true);
        const f = await bridge.saveText(`journal-achats-${tagOf()}.csv`, C.toCsv(rows, buyJournalColumns()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      // Le panneau des règlements a son tri, sa pagination et son export — comme les autres listes
      // depuis la 2.2.0, et l'export porte sur la SÉLECTION entière, jamais sur la page affichée.
      const dPanel = $('#d-wrap') && $('#d-wrap').closest('.panel');
      if (dPanel) {
        bindSort(dPanel, key => { comptaState.decs.sort = toggleSort(comptaState.decs.sort, key, decCols); comptaState.decs.page = 1; draw(); });
        bindPager(dPanel, comptaState.decs, () => draw(), '#d-wrap');
      }
      $('#exp-decs').onclick = async () => {
        if (!decs.length) return toast('Rien à exporter sur cette période.', true);
        // `decColumns()` est la MÊME liste que celle du paquet envoyé au comptable (6.1.0) : deux
        // exports du même mois ne peuvent pas dire deux choses différentes.
        const f = await bridge.saveText(`reglements-fournisseurs-${tagOf()}.csv`, C.toCsv(decs, decColumns()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
    }

    // ---------- onglet TVA : la soustraction qui manquait ----------
    function drawVat() {
      const year = comptaState.year;
      // La TVA se déclare par mois : le bloc du haut porte toujours sur UN mois. Sans mois choisi,
      // on prend le mois en cours si l'année affichée est l'année en cours, sinon décembre — et on le dit.
      const auto = !comptaState.month;
      const upTo = comptaState.month ? Number(comptaState.month)
        : (year === C.today().slice(0, 4) ? Number(C.today().slice(5, 7)) : 12);
      const chain = C.vatChain(data, company(), year, 12);
      const cur1 = chain[upTo - 1] || null;
      const res = C.simpleResult(data, company(), period());
      // Le crédit avec lequel l'année commence (10.14.0) : CALCULÉ dès que SkanFact connaît l'année
      // d'avant — c'est le crédit que décembre reporte —, saisi à la main pour la première seulement.
      // Le bouton « Reporter un crédit… » s'offrait sur toutes les années, et le chiffre calculé,
      // lui, n'existait pas : le crédit de décembre se perdait chaque 1er janvier.
      const rep = C.reportTvaDebut(data, company(), year);
      const carryIn = rep.saisi;
      const ligneReport = rep.source === 'calcule'
        ? `<p class="small mt">${rep.montant
            ? `Crédit de TVA venu de décembre ${h(rep.depuis)} : <b class="nw">${C.money(rep.montant, cur)}</b> — calculé sur tes pièces de ${h(rep.depuis)}, il vient en déduction de janvier.`
            // Un crédit nul ne « vient en déduction » de rien : on dit qu'il n'y en a pas.
            : `Aucun crédit de TVA venu de décembre ${h(rep.depuis)} : sa déclaration ne reporte rien sur janvier.`} ${info('compta.carryIn')}</p>
           <div class="inline"><button class="btn btn-sm" id="carry-voir">Voir la déclaration de décembre ${h(rep.depuis)}</button>${carryIn && carryIn !== rep.montant ? `<button class="btn btn-sm" id="carry-oublier">Oublier le ${C.money(carryIn, cur)} saisi à la main</button>` : ''}</div>
           ${carryIn && carryIn !== rep.montant ? `<p class="small muted">Un crédit de ${C.money(carryIn, cur)} avait été saisi à la main pour ${h(year)} : il n'est plus repris, SkanFact connaît ${h(rep.depuis)} et en calcule le report.</p>` : ''}`
        : `<div class="inline mt"><button class="btn btn-sm" id="set-carry">${carryIn ? `Crédit de TVA venu de ${Number(year) - 1} : ${C.money(carryIn, cur)} — corriger…` : `Reporter un crédit de TVA de ${Number(year) - 1}…`}</button>${info('compta.carryIn')}</div>`;
      // (1.301.0) La déclaration du mois chez le cabinet : déposée le…, et ce que les pièces du mois disent depuis. Un achat de
      // septembre saisi après le dépôt changeait la TVA de septembre ici sans un mot, alors que le cabinet en avait déclaré une
      // autre : deux écrans, deux chiffres (le Cabinet disait « déposée »). Rien tant que ses livres ne sont pas lus.
      const livresLus = messagerieVue && messagerieVue.cabinet && livresCabinetLus && !livresCabinetLus.enCours && !livresCabinetLus.illisible && livresCabinetLus.annee === Number(year);
      const lignesCabinet = livresLus ? C.declarationsDuCabinet(data, company(), year, livresCabinetLus.declarations, C.today()) : [];
      const parCabinet = lignesCabinet.find(x => x.periode === `${year}-${String(upTo).padStart(2, '0')}`) || null;
      const moisNom = `${MONTHS[upTo - 1]} ${year}`;
      const signe = n => `${n > 0 ? '+' : '−'} ${C.money(Math.abs(n), cur)}`;
      const blocCabinet = !parCabinet ? '' : parCabinet.deposee
        ? `<p class="small cpt-cab" id="vat-cabinet">${lfIc('coche', 15, 2.4)}<span>Déposée par ton cabinet le ${h(C.fmtDate(parCabinet.deposee.le))}${parCabinet.deposee.reference ? ` (réf. ${h(parCabinet.deposee.reference)})` : ''}. ${info('compta.cabinetDecl')}</span></p>
          ${parCabinet.ecarts.length ? `<div class="warn-box cpt-ecart" id="vat-ecart"><p>${parCabinet.ecarts.map(e => `Tes pièces ${h(deMois(moisNom))} disent aujourd'hui une TVA ${e.nom} de <b class="nw">${h(C.money(e.maintenant, cur))}</b> ; ton cabinet en a déclaré <span class="nw">${h(C.money(e.declare, cur))}</span> (<span class="nw">${h(signe(e.ecart))}</span>).`).join(' ')}
            Une pièce arrivée après le dépôt se reprend sur une déclaration suivante : dis-le à ton cabinet. <em>À VÉRIFIER avec ton comptable.</em></p>
            <div class="inline"><button class="btn btn-sm btn-primary" id="vat-ecart-dire">Le dire à mon comptable</button></div></div>` : ''}`
        : messagerieVue.declarationsConfiees
          ? `<p class="small cpt-cab${parCabinet.retard ? ' warn-text' : ''}" id="vat-cabinet"><span>${parCabinet.retard ? `Ton cabinet ne l'a pas encore déposée : la date limite était le ${h(C.fmtDate(parCabinet.limite))}.` : `Ton cabinet ne l'a pas encore déposée : il a jusqu'au ${h(C.fmtDate(parCabinet.limite))}.`}</span> <button type="button" class="btn-lien" id="vat-cabinet-ecrire">Lui écrire</button></p>` : '';
      const deposeesParMois = new Map(lignesCabinet.filter(x => x.deposee).map(x => [x.periode, x]));
      // (1.302.0) Les mois sans rien (ni vente, ni achat, ni crédit, ni déclaration déposée) : au téléphone, ils ne font plus
      // leur carte (douze cartes, dont huit de zéros, faisaient une page de 4 500 px), et la phrase les nomme.
      const moisRien = chain.map((m, i) => (!m.collected && !m.deductible && !m.carryIn && !m.toPay && !m.carryOut && !deposeesParMois.has(m.month) ? i : -1)).filter(i => i >= 0);
      const plages = [];
      for (let k = 0; k < moisRien.length; k++) {
        let f = k;
        while (f + 1 < moisRien.length && moisRien[f + 1] === moisRien[f] + 1) f++;
        plages.push(f === k ? MONTHS[moisRien[k]] : f === k + 1 ? `${MONTHS[moisRien[k]]}, ${MONTHS[moisRien[f]]}` : `${MONTHS[moisRien[k]]} à ${MONTHS[moisRien[f]]}`);
        k = f;
      }
      const moisRienDits = plages.length > 1 ? `${plages.slice(0, -1).join(', ')} et ${plages[plages.length - 1]}` : plages[0] || '';
      $('#c-body').innerHTML = `
        <div class="panel"><h2>Déclaration de TVA — ${h(MONTHS[upTo - 1])} ${year} ${info('compta.vatReturn')}</h2>
          ${auto ? `<p class="small muted mb">La TVA se déclare mois par mois : voici ${h(MONTHS[upTo - 1])}. Choisis un autre mois en haut à droite, ou lis le tableau ci-dessous pour toute l'année.</p>` : ''}
          ${cur1 && !cur1.collected && !cur1.deductible && !cur1.carryIn
            // Sur une base vide, `toPay` vaut 0, donc la ligne verte annonçait « Crédit de TVA
            // reportable sur la période suivante » à quelqu'un qui n'a jamais facturé. Et la
            // branche « Rien à déclarer » était du CODE MORT : `vatChain` renvoie toujours douze
            // mois, donc `cur1` n'est jamais null — elle faisait croire que le cas était traité.
            ? `<p>Rien à déclarer pour ${h(MONTHS[upTo - 1])} ${year} : aucune vente, aucun achat sur ce mois.</p>
               <p class="small muted">Cette page calculera <b>TVA collectée sur tes ventes − TVA déductible sur tes achats</b>. Si le résultat est négatif, le crédit se reporte sur le mois suivant tout seul. <em>À VÉRIFIER avec ton comptable : ta périodicité de dépôt et les taux qui s'appliquent à ton activité.</em></p>`
            : cur1 ? `<div class="vat-box">
            <div class="vat-line"><span>TVA collectée sur tes ventes</span><span class="num">${C.money(cur1.collected, cur)}</span></div>
            <div class="vat-line minus"><span>− TVA déductible sur tes achats</span><span class="num">${C.money(cur1.deductible, cur)}</span></div>
            ${cur1.carryIn ? `<div class="vat-line minus"><span>− Crédit de TVA reporté ${info('compta.carry')}</span><span class="num">${C.money(cur1.carryIn, cur)}</span></div>` : ''}
            <div class="vat-line total ${cur1.toPay ? 'due' : 'ok'}">
              <span>${cur1.toPay ? 'TVA à reverser' : 'Crédit de TVA reportable sur la période suivante'}</span>
              <span class="num">${C.money(cur1.toPay || cur1.carryOut, cur)}</span></div>
          </div>
          <p class="small muted mt">Timbres fiscaux encaissés sur la période : ${C.money(cur1.stamps, cur)} · retenues subies : ${C.money(cur1.withheldBySale, cur)} · retenues que tu as opérées : ${C.money(cur1.withheldOnBuys, cur)}. Ces trois lignes se déclarent séparément de la TVA. <em>À VÉRIFIER avec ton comptable.</em></p>` : ''}
          ${blocCabinet}
          ${cur1 && (cur1.collected || cur1.deductible) ? `<div class="inline mt">
            <button class="btn btn-sm" id="vat-ventes">Voir les ventes ${h(deMois(MONTHS[upTo - 1]))}</button>
            <button class="btn btn-sm" id="vat-achats">Voir les achats ${h(deMois(MONTHS[upTo - 1]))}</button>
          </div>` : ''}
          ${ligneReport}
        </div>
        ${chain.some(m => m.collected || m.deductible || m.carryIn) ? `
        <div class="panel"><h2>Mois par mois — ${year} ${info('compta.vatMonths')}</h2>
          <table class="list compact"><thead><tr><th>Mois</th><th class="r">Collectée</th><th class="r">Déductible</th><th class="r">Crédit repris</th><th class="r">À payer</th><th class="r">Crédit reporté</th></tr></thead><tbody>
            ${chain.map((m, i) => `<tr class="clickable ${m.toPay ? '' : 'row-ok'}${moisRien.includes(i) ? ' cpt-rien' : ''}" data-vm="${String(i + 1).padStart(2, '0')}" title="Voir la déclaration ${h(deMois(m.label))}"><td>${h(m.label)}${deposeesParMois.has(m.month) ? ' <small class="ok-text cpt-dep">déposée</small>' : ''}</td><td class="r nw">${montantCompta(m.collected)}</td><td class="r nw">${montantCompta(m.deductible)}</td>
              <td class="r nw">${m.carryIn ? montantCompta(m.carryIn) : '<span class="muted">—</span>'}</td>
              <td class="r nw">${m.toPay ? `<strong>${montantCompta(m.toPay)}</strong>` : '<span class="muted">—</span>'}</td>
              <td class="r nw">${m.carryOut ? montantCompta(m.carryOut) : '<span class="muted">—</span>'}</td></tr>`).join('')}
            <tr class="total-row"><td><strong>Total à reverser</strong></td><td class="r">${montantCompta(chain.reduce((s, m) => s + m.collected, 0))}</td>
              <td class="r">${montantCompta(chain.reduce((s, m) => s + m.deductible, 0))}</td><td></td>
              <td class="r"><strong>${montantCompta(chain.reduce((s, m) => s + m.toPay, 0))}</strong></td><td></td></tr>
          </tbody></table>
          ${moisRien.length ? `<p class="small muted mt cpt-tel-seul" id="vat-mois-vides">Au téléphone, les mois sans rien ne s'affichent pas : ${h(moisRienDits)}.</p>` : ''}
          <p class="small muted mt">Le crédit d'un mois vient en déduction du suivant : c'est pour ça que le total ne se lit pas ligne par ligne. <em>Ces chiffres sont l'arithmétique exacte de tes données, pas une déclaration officielle : à faire valider par ton comptable avant tout dépôt.</em></p>
        </div>
        ` : ''}
        <div class="panel"><h2>Résultat simplifié — ${h(periodLabel())} ${info('compta.result')}</h2>
          <div class="stats compact-stats">
            <div class="stat"><div class="lbl">Produits (ventes HT)</div><div class="val">${C.money(res.produits, cur)}</div><div class="sub">${pl(res.salesCount, 'pièce')}</div></div>
            <div class="stat"><div class="lbl">Charges ${info('compta.charges')}</div><div class="val">${C.money(res.charges, cur)}</div><div class="sub">${pl(res.buysCount, 'pièce')} d'achat, TVA non récupérable comprise</div></div>
            <div class="stat"><div class="lbl">Coût des sorties de stock ${info('stk.cogs')}</div><div class="val">${C.money(res.cogs, cur)}</div><div class="sub">${res.cogs ? 'ventes, matière utilisée et casse, au coût moyen' : 'aucune sortie de stock'}</div></div>
            <div class="stat"><div class="lbl">Coût de la paie ${info('pay.employerCost')}</div><div class="val">${C.money(res.payroll, cur)}</div><div class="sub">${res.payroll ? 'brut + charges patronales' : 'aucun bulletin sur la période'}</div></div>
            <div class="stat"><div class="lbl">Dotation aux amortissements ${info('immo.annuity')}</div><div class="val">${C.money(res.depreciation, cur)}</div><div class="sub">${res.depreciation ? 'une charge qui ne sort pas d\'argent' : 'aucun bien amorti sur la période'}</div></div>
            ${res.horsSuivi ? `<div class="stat"><div class="lbl">Marchandises sans article suivi ${info('compta.horsSuivi')}</div><div class="val">${C.money(res.horsSuivi, cur)}</div><div class="sub">achetées pour le stock, jamais entrées dans un stock suivi</div></div>` : ''}
            ${res.autres ? `<div class="stat"><div class="lbl">${res.autres > 0 ? 'Autres charges' : 'Autres produits'} ${info('compta.autres')}</div><div class="val">${C.money(Math.abs(res.autres), cur)}</div><div class="sub">frais bancaires, écritures diverses, cessions</div></div>` : ''}
            ${res.change ? `<div class="stat"><div class="lbl">${res.change < 0 ? 'Perte de change' : 'Gain de change'} ${info('compta.change')}</div><div class="val">${C.money(Math.abs(res.change), cur)}</div><div class="sub">avoir ou acompte à un autre taux que sa pièce</div></div>` : ''}
            <div class="stat"><div class="lbl">Résultat avant impôt</div><div class="val ${res.resultat >= 0 ? 'ok' : 'due'}">${C.money(res.resultat, cur)}</div><div class="sub">${res.marge == null ? '' : `${pct(res.marge).replace('-', '−')} % du chiffre d'affaires`}</div></div>
            <div class="stat"><div class="lbl">Non comptés en charges</div><div class="val">${C.money(C.round3(res.stock - res.horsSuivi + res.immo), cur)}</div><div class="sub">${C.money(C.round3(res.stock - res.horsSuivi), cur)} en stock · ${C.money(res.immo, cur)} en immobilisations</div></div>
          </div>
          <p class="small muted mt">Sur un exercice terminé, ce résultat est celui des écritures, au millime. En cours d'année, les amortissements y sont comptés jour par jour (<a href="#/immos">Immobilisations</a>) et le stock par ses sorties (<a href="#/stock">Stock</a>), alors que les écritures ne les passent qu'au 31 décembre. Il n'y manque que les provisions et l'impôt. <em>À VÉRIFIER avec ton comptable.</em></p>
        </div>`;
      // Cinq chiffres sur lesquels tout repose, et aucun ne menait à la pièce qui le fabrique : il
      // fallait retenir le mois, changer d'onglet, refaire le filtre. Les douze lignes du tableau
      // ouvrent maintenant leur propre mois, et deux boutons mènent au journal correspondant.
      const versOnglet = (tab, mois) => { comptaState.month = mois; comptaState.tab = tab; draw(); $$('#c-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); };
      $$('#c-body tr[data-vm]').forEach(tr => tr.onclick = () => { comptaState.month = tr.dataset.vm; if ($('#c-month')) $('#c-month').value = tr.dataset.vm; draw(); });
      if ($('#vat-ventes')) $('#vat-ventes').onclick = () => versOnglet('ventes', String(upTo).padStart(2, '0'));
      if ($('#vat-achats')) $('#vat-achats').onclick = () => versOnglet('achats', String(upTo).padStart(2, '0'));
      if ($('#vat-ecart-dire')) $('#vat-ecart-dire').onclick = () => ecrireAuComptable(`Bonjour, ma TVA ${deMois(moisNom)} : ${parCabinet.ecarts.map(e => `tu as déclaré une TVA ${e.nom} de ${C.money(e.declare, cur)}, mes pièces disent aujourd'hui ${C.money(e.maintenant, cur)} (${signe(e.ecart)})`).join(' ; ')}. Une pièce est sans doute arrivée après le dépôt : peux-tu la reprendre sur la prochaine déclaration ?`);
      if ($('#vat-cabinet-ecrire')) $('#vat-cabinet-ecrire').onclick = () => ecrireAuComptable(`Bonjour, où en est ma déclaration de TVA ${deMois(moisNom)} ? ${parCabinet.retard ? `La date limite était le ${C.fmtDate(parCabinet.limite)}.` : `Elle est à déposer d'ici le ${C.fmtDate(parCabinet.limite)}.`}`);
      if ($('#carry-voir')) $('#carry-voir').onclick = vers('#/compta', () => { comptaState.year = rep.depuis; comptaState.month = '12'; resetPages(); });
      if ($('#carry-oublier')) $('#carry-oublier').onclick = () => {
        const avant = { ...(data.vatCarryIn || {}) };
        const reste = { ...avant }; delete reste[year];
        data.vatCarryIn = reste; save(true); draw();
        toastUndo('Chiffre saisi oublié', () => { data.vatCarryIn = avant; save(true); draw(); });
      };
      if ($('#set-carry')) $('#set-carry').onclick = () => promptDialog('Crédit de TVA reporté',
        `Crédit de TVA restant à la fin de ${Number(year) - 1}, tel qu'il figure sur ta dernière déclaration. Il viendra en déduction du premier mois de ${year}.`,
        String(carryIn || ''), v => {
          data.vatCarryIn = { ...(data.vatCarryIn || {}), [year]: Math.max(0, Number(String(v).replace(',', '.')) || 0) };
          save(true); draw(); toast('Crédit de TVA enregistré');
        }, 'number', { champ: `Crédit de TVA de ${Number(year) - 1}`, unite: cur, ok: 'Enregistrer le crédit', montant: true });
    }

    // ---------- onglet Calendrier fiscal ----------
    // Clôturer un mois, c'est promettre que ce mois ne bougera plus. C'est ce qui permet d'envoyer
    // un dossier au comptable sans qu'il change dans son dos. Rouvrir reste possible — mais tracé.
    // ---------- Écritures comptables (Cabinet 1.1.0) ----------
    // Ce que le comptable retape aujourd'hui pièce par pièce. Ici, c'est un fichier.
    function drawEntries() {
      figerAuxiliaires();
      const cur = company().currency;
      const p = period();
      // 8.9.0 : le livre-journal — chaque pièce porte un numéro continu dans l'exercice.
      const entries = C.livreJournal(data, company(), p, {});
      const bal = C.entriesBalance(entries);
      const byAcc = C.entriesByAccount(entries);
      const exo = p.from.slice(0, 4);
      const central = C.journalCentralisateur(data, company(), exo, {});
      const ods = (data.ecrituresOD || []).filter(o => C.inPeriod(o.date, p.from, p.to)).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const clos = C.closedUntil(data);
      const cols = [
        { key: 'numero', label: 'N°', r: true, info: 'ecr.numero', val: e => e.numero },
        { key: 'date', label: 'Date', val: e => e.date },
        { key: 'journal', label: 'Journal', val: e => e.journal },
        { key: 'piece', label: 'Pièce', val: e => e.piece },
        { key: 'account', label: 'Compte', val: e => e.account },
        { key: 'label', label: 'Libellé', val: e => e.label },
        { key: 'debit', label: 'Débit', r: true, info: 'ecr.quoi', val: e => e.debit },
        { key: 'credit', label: 'Crédit', r: true, info: 'ecr.quoi', val: e => e.credit },
        { key: 'lettre', label: 'Let.', info: 'bal.lettrage', val: e => e.lettre || '' }
      ];
      const sorted = applySort(entries, cols, ecrState.sort);
      const { rows, pg } = paginate(sorted, ecrState);

      $('#c-body').innerHTML = `
        <div class="panel"><h2>Livre-journal — ${h(periodLabel())} ${info('ecr.quoi')}</h2>
          <p class="small">Les pièces de la période transformées en écritures comptables, en partie double, ${messagerieVue && messagerieVue.cabinet ? 'celles que ton cabinet lit dans ses livres.' : 'prêtes à importer dans le logiciel de ton comptable. Il n\'a plus rien à retaper.'} Chaque pièce porte son numéro dans l'exercice ${h(exo)} ${info('ecr.numero')}${clos ? ` — les mois clôturés (jusqu'au ${C.fmtDate(clos)}) ne bougent plus, leurs numéros non plus` : ' — clôture les mois envoyés pour que leurs numéros ne bougent plus'}.</p>
          <div class="pay-grid">
            <div><div class="k-label">Lignes</div><div class="v">${bal.lines}</div></div>
            <div><div class="k-label">Pièces</div><div class="v">${bal.pieces}</div></div>
            <div><div class="k-label">Total débit</div><div class="v">${C.money(bal.debit, cur)}</div></div>
            <div><div class="k-label">Total crédit</div><div class="v ${bal.balanced ? 'ok' : 'due'}">${C.money(bal.credit, cur)}</div></div>
          </div>
          ${!bal.lines
            ? '<div class="banner info"><span>Aucune pièce sur cette période : il n\'y a rien à exporter. Choisis un autre mois en haut à droite.</span></div>'
            : bal.balanced
            ? '<div class="todo-ok">Débit = crédit sur chaque pièce : le fichier passera à l\'import.</div>'
            : `<div class="banner"><span>${bal.off.length} pièce${bal.off.length > 1 ? 's' : ''} ne tombe${bal.off.length > 1 ? 'nt' : ''} pas juste — signale-le avant d'envoyer.</span></div>`}
          <p class="small muted"><em>À VÉRIFIER avec ton comptable :</em> les numéros de compte ci-dessous sont ceux du plan comptable tunisien tel qu'il est couramment utilisé, mais chaque cabinet a ses habitudes. Ils se modifient dans « Plan de comptes », et l'export suit.</p>
          <div class="inline mt">
            <button class="btn btn-primary" id="ecr-od">Saisir une opération diverse…</button>
            <button class="btn" id="ecr-csv" ${bal.lines ? '' : 'disabled'}>Exporter en CSV</button>
            <button class="btn" id="ecr-fec" ${bal.lines ? '' : 'disabled'}>Fichier FEC…</button>${info('ecr.fec')}
            <button class="btn" id="ecr-mail" ${bal.lines ? '' : 'disabled'}>${messagerieVue && messagerieVue.cabinet ? 'Envoyer par e-mail…' : 'Envoyer au comptable'}</button>
            <button class="btn btn-ghost" id="ecr-plan">Plan de comptes…</button>
          </div>
          ${messagerieVue && messagerieVue.cabinet ? '<p class="small muted mt" id="ecr-cabinet-lit">Ton cabinet lit ces écritures en direct : il n\'y a rien à lui envoyer. Ce bouton sert à les envoyer à quelqu\'un d\'autre, par e-mail.</p>' : ''}
        </div>

        <div class="panel" id="ecr-ods"><h2>Opérations diverses saisies à la main ${info('ecr.od')}</h2>
          ${ods.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th class="r">Montant</th><th>Comptes</th><th></th></tr></thead><tbody>
            ${ods.map(o => { const v = C.odValide(o, company()); return `<tr data-od="${h(o.id)}">
              <td class="nw">${C.fmtDate(o.date)}</td><td class="nw"><strong>${h(o.piece)}</strong></td><td>${h(o.label)}</td>
              <td class="r nw">${montantCompta(v.debit)}</td>
              <td class="small muted">${h((o.lignes || []).map(l => l.compte).join(', '))}</td>
              ${rowMenuCell(o.id)}</tr>`; }).join('')}
          </tbody></table></div>`
            : `<div class="empty mini">Aucune opération diverse sur cette période. Ce qui n'a ni facture, ni achat, ni règlement — un loyer sans facture, une régularisation, une charge avancée par le gérant — se saisit ici, en partie double.</div>`}
        </div>

        <div class="panel"><h2>Journal centralisateur — exercice ${h(exo)} ${info('ecr.central')}</h2>
          ${central.pieces ? `<div class="scroll-x"><table class="list compact" id="ecr-central"><thead><tr><th>Mois</th>${central.journaux.map(j => `<th class="r" colspan="2" title="${h(j.label)}">${h(j.code)} <span class="muted small">D / C</span></th>`).join('')}<th class="r">Débit</th><th class="r">Crédit</th><th class="r">Pièces</th></tr></thead><tbody>
            ${central.mois.map(m => `<tr class="${m.pieces ? '' : 'muted'}"><td class="nw">${h(m.label)}</td>${central.journaux.map(j => `<td class="r nw">${m.par[j.code].debit ? montantCompta(m.par[j.code].debit) : '—'}</td><td class="r nw">${m.par[j.code].credit ? montantCompta(m.par[j.code].credit) : '—'}</td>`).join('')}<td class="r nw">${m.debit ? montantCompta(m.debit) : '—'}</td><td class="r nw">${m.credit ? montantCompta(m.credit) : '—'}</td><td class="r">${m.pieces || '—'}</td></tr>`).join('')}
          </tbody><tfoot><tr class="total-row"><td>Total</td>${central.journaux.map(j => `<td class="r nw"><strong>${montantCompta(central.totaux[j.code].debit)}</strong></td><td class="r nw"><strong>${montantCompta(central.totaux[j.code].credit)}</strong></td>`).join('')}<td class="r nw"><strong>${montantCompta(central.debit)}</strong></td><td class="r nw"><strong>${montantCompta(central.credit)}</strong></td><td class="r"><strong>${central.pieces}</strong></td></tr></tfoot></table></div>
          <div class="inline mt"><button class="btn" id="ecr-central-csv">Exporter le centralisateur</button></div>` : '<div class="empty">Aucune écriture sur cet exercice.</div>'}
        </div>

        <div class="panel"><h2>Par compte</h2>
          ${byAcc.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Compte</th><th>Intitulé</th><th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde</th></tr></thead><tbody>
            ${byAcc.map(a => `<tr>
              <td class="nw"><strong>${h(a.account)}</strong></td>
              <td class="muted">${h(C.accountLabel(data, a.account, (entries.find(e => e.account === a.account && e.role) || {}).tiers))}</td>
              <td class="r nw">${montantCompta(a.debit)}</td><td class="r nw">${montantCompta(a.credit)}</td>
              <td class="r nw">${montantCompta(a.solde)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">—</div>'}
          <!-- « Retenue à la source opérée » et « subie » s'affichent l'une SOUS l'autre, avec des
               numéros de compte voisins, et rien dans toute l'application ne les distinguait : deux
               mots de la même famille pour deux choses opposées, au seul endroit où on les voit
               côte à côte. -->
          <p class="small muted mt"><b>Retenue à la source opérée</b> : ce que <b>tu</b> as retenu en payant un fournisseur, et que tu dois reverser au Trésor à sa place — tu lui en remets l'attestation.
          <b>Subie</b> : ce que <b>tes clients</b> t'ont retenu sur tes factures, et que tu récupéreras sur ton impôt, avec l'attestation qu'ils te doivent. ${info('ecr.rs')}</p>
          <p class="small muted mt">Un compte inattendu ou un solde qui surprend se corrige dans le plan de comptes : les écritures se recalculent aussitôt.</p>
        </div>

        <div class="panel"><h2>Le détail</h2>
          ${entries.length ? `<div class="scroll-x"><table class="list compact" id="ecr-t">
            <thead>${sortHead(cols, ecrState.sort)}</thead>
            <tbody>${rows.map(e => `<tr>
              <td class="r nw muted">${e.numero}</td>
              <td class="nw">${C.fmtDate(e.date)}</td><td>${h(e.journal)}</td><td class="nw">${h(e.piece)}${marqueJustif(C.justificatifsDe(data, e))}</td>
              <td class="nw"><strong>${h(e.account)}</strong></td><td>${h(e.label)}</td>
              <td class="r nw">${e.debit ? montantCompta(e.debit) : '<span class="muted">—</span>'}</td>
              <td class="r nw">${e.credit ? montantCompta(e.credit) : '<span class="muted">—</span>'}</td>
              <td class="nw small muted">${h(e.lettre || '')}</td></tr>`).join('')}</tbody>
            <tfoot><tr class="total-row"><td colspan="6">Total de la sélection</td>
              <td class="r nw"><strong>${montantCompta(bal.debit)}</strong></td><td class="r nw"><strong>${montantCompta(bal.credit)}</strong></td><td></td></tr></tfoot>
          </table></div>${pagerBar(pg, { noun: 'écriture' })}`
            : '<div class="empty">Aucune pièce sur cette période.</div>'}
        </div>`;

      bindSort($('#c-body'), key => { ecrState.sort = toggleSort(ecrState.sort, key, cols); ecrState.page = 1; drawEntries(); });
      bindPager($('#c-body'), ecrState, drawEntries);
      const tag = comptaState.month ? `${comptaState.year}-${comptaState.month}` : comptaState.year;
      $('#ecr-csv').onclick = async () => {
        const f = await bridge.saveText(`ecritures-${tag}.csv`, C.toCsv(sorted, C.entryCsvColumns()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      // H3 — le fichier des écritures (FEC) : la période ENTIÈRE, jamais la page ni le tri de l'écran
      // (un fichier normé suit l'ordre de ses numéros). Un refus se dit avant d'enregistrer, pièce
      // par pièce ; un mois non clôturé se dit après, parce que ses numéros peuvent encore bouger.
      $('#ecr-fec').onclick = async () => {
        // (16 § 10.1, point 4) Un FEC se lit comme les livres complets : sans la paie, il ne s'écrit pas (choix par défaut, À VÉRIFIER).
        if (paieCachee()) return infoDialog('Le fichier FEC ne s\'écrit pas sans la paie', `Il n'aurait ni les salaires ni les charges sociales, et un FEC se lit comme les livres complets. Demande-le à ${company().managerName || 'la direction'} ou au cabinet.`);
        const r = C.fecEntreprise(data, company(), p);
        if (!r.ok) {
          infoDialog(r.vide ? 'Rien à exporter' : 'Le fichier FEC ne peut pas s\'écrire',
            r.vide ? 'Aucune écriture sur cette période.'
              : `${pl(r.refus.length, 'pièce')} ne passerai${r.refus.length > 1 ? 'ent' : 't'} pas l'import d'un logiciel comptable :\n\n${r.refus.slice(0, 8).map(x => `• ${x.piece} : ${x.motif}`).join('\n')}${r.refus.length > 8 ? `\n… et ${r.refus.length - 8} autres.` : ''}`);
          return;
        }
        const f = await bridge.saveText(r.nom, r.texte);
        if (!f) return;
        toast(`Fichier FEC enregistré : ${pl(r.pieces, 'pièce')}, ${pl(r.lignes, 'ligne')}.${r.provisoire ? ' Des mois de la période ne sont pas clôturés : leurs numéros peuvent encore bouger.' : ''}`);
      };
      if ($('#ecr-central-csv')) $('#ecr-central-csv').onclick = async () => {
        const f = await bridge.saveText(`centralisateur-${exo}.csv`, C.toCsv(C.centralisateurRows(central), C.centralisateurCsvColumns(central.journaux)));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      $('#ecr-mail').onclick = async () => {
        if (await demoBlock('Envoyer les écritures au comptable')) return;
        if (!await messagerie()) return;
        const att = await bridge.saveTextSilent(`ecritures-${tag}.csv`, C.toCsv(sorted, C.entryCsvColumns()));
        const r = await bridge.composeMail({
          to: messagerieVue && messagerieVue.cabinet ? '' : company().accountantEmail || '', subject: `Écritures ${periodLabel()} — ${company().name || ''}`,
          body: `Bonjour,\n\nVoici les écritures comptables de ${periodLabel()} : ${bal.lines} lignes, ${bal.pieces} pièces, débit = crédit = ${C.money(bal.debit, cur)}.\n\nLes numéros de compte sont ceux réglés dans SkanFact ; dis-moi s'ils ne correspondent pas aux tiens, je les change.\n\nBien à toi,\n${company().name || ''}`,
          attachments: att ? [att] : [], mode: modeEnvoi()
        });
        toast(messageOuvert(r, att ? 'le fichier des écritures' : null));
      };
      $('#ecr-plan').onclick = () => chartForm(drawEntries);
      $('#ecr-od').onclick = () => odForm(null, drawEntries);
      bindRowMenus($('#ecr-ods'), id => {
        const o = (data.ecrituresOD || []).find(x => x.id === id); if (!o) return [];
        return [
          { icon: 'modifier', label: 'Modifier l\'opération', hint: 'Date, libellé, lignes', run: () => odForm(o, drawEntries) },
          { sep: true },
          { icon: 'supprimer', label: 'Supprimer l\'opération', hint: 'Elle disparaît des écritures', danger: true, run: async () => {
            if (closedBlock(o.date, 'Cette opération diverse')) return;
            await periodeValideeLue();
            const dvSup = dateDansLaPeriodeValidee([o.date]);
            if (!await confirmDialog(`Supprimer l'opération ${o.piece} — ${o.label} ?${dvSup ? ` ${phraseAnnulationValidee(dvSup, { sujet: 'Elle', fem: true })}` : ''}`, 'Supprimer', true)) return;
            const totalSup = C.odValide(o, company()).debit || 0;
            forget('ecrituresOD', o.id, o.label || '');
            data.ecrituresOD = data.ecrituresOD.filter(x => x.id !== o.id); save(true); drawEntries();
            if (dvSup) direAuComptableApres(`${o.piece} supprimée`, { fait: 'de supprimer', fem: true, annule: true, quoi: `l'opération diverse ${o.piece} « ${o.label} » datée du ${C.fmtDate(dvSup)} (${C.money(totalSup, company().currency)})` });
          } }
        ];
      });
    }

    // L'opération diverse (8.9.0) : la seule écriture que l'utilisateur ÉCRIT lui-même. Elle
    // n'entre qu'équilibrée — la fenêtre montre l'écart pendant la saisie et refuse tant qu'il
    // reste. Le numéro de pièce est pris à l'enregistrement, jamais avant (règle 6.0.0).
    function odForm(od, done) {
      const o = od ? deepCopy(od) : { id: C.uid(), date: C.today(), piece: '', journal: 'OD', label: '', lignes: [{ compte: '', label: '', debit: 0, credit: 0 }, { compte: '', label: '', debit: 0, credit: 0 }] };
      if (!Array.isArray(o.lignes) || !o.lignes.length) o.lignes = [{ compte: '', label: '', debit: 0, credit: 0 }, { compte: '', label: '', debit: 0, credit: 0 }];
      const proposes = C.comptesProposes(data, company());
      const ligneHtml = (l, i) => `<tr data-i="${i}">
        <td style="width:120px"><input type="text" class="od-compte mono" list="od-comptes" value="${h(l.compte || '')}" placeholder="616" inputmode="numeric"></td>
        <td class="small muted od-lib">${h(C.accountLabel(data, l.compte || ''))}</td>
        <td><input type="text" class="od-label" value="${h(l.label || '')}" placeholder="Libellé de la ligne (facultatif)"></td>
        <td style="width:110px"><input type="number" class="od-debit num" step="0.001" min="0" value="${l.debit ? l.debit : ''}"></td>
        <td style="width:110px"><input type="number" class="od-credit num" step="0.001" min="0" value="${l.credit ? l.credit : ''}"></td>
        <td><button type="button" class="btn btn-ghost od-del" title="Retirer la ligne" aria-label="Retirer la ligne">✕</button></td></tr>`;
      modal(`<h2>${od ? 'Modifier l\'opération diverse' : 'Opération diverse'} ${info('ecr.od')}</h2>
        <p class="small muted">Ce qui n'a ni facture, ni achat, ni règlement : un loyer sans facture, une charge avancée par le gérant, une régularisation. Autant au débit qu'au crédit, sinon rien ne s'enregistre. <em>À VÉRIFIER avec ton comptable</em> pour le choix des comptes.</p>
        <form id="odf" class="grid-2">
          ${dateFieldHtml(lbl('Date', 'ecr.odDate'), 'date', o.date, {})}
          <label class="field">${lbl('Pièce', 'ecr.odPiece')}<input type="text" name="piece" value="${h(o.piece || '')}" placeholder="${od ? '' : 'attribuée à l\'enregistrement'}" ${od ? '' : 'disabled'}></label>
          <label class="field span-2 obligatoire">${lbl('Libellé', 'ecr.odLibelle')}<input type="text" name="label" value="${h(o.label || '')}" placeholder="Assurance annuelle du local, avancée par le gérant"></label>
        </form>
        <datalist id="od-comptes">${proposes.map(c => `<option value="${h(c.compte)}">${h(c.compte)} — ${h(c.label)}</option>`).join('')}</datalist>
        <div class="scroll-x mt"><table class="list compact" id="od-lignes" style="table-layout:fixed"><thead><tr><th style="width:120px">Compte</th><th style="width:170px">Intitulé</th><th>Libellé</th><th class="r" style="width:120px">Débit</th><th class="r" style="width:120px">Crédit</th><th style="width:56px"></th></tr></thead>
          <tbody>${o.lignes.map(ligneHtml).join('')}</tbody>
          <tfoot><tr class="total-row"><td colspan="3"><button type="button" class="btn btn-ghost" id="od-add">+ Ajouter une ligne</button></td><td class="r nw" id="od-td">—</td><td class="r nw" id="od-tc">—</td><td></td></tr></tfoot></table></div>
        <div id="od-ecart" class="small mt"></div>
        ${avertValideHtml('od-valide')}
        <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="od-ok">Enregistrer</button></div>`,
        (layer, close) => {
          // (1.303.0) Une opération datée dans la période que le cabinet a validée (la neuve, ou celle qu'on change, à sa nouvelle
          // date comme à l'ancienne) : dit sous l'écriture avant d'enregistrer. Rouverte sans rien changer, elle ne dit rien.
          const empreinteOd = x => JSON.stringify([x.date, x.label, (x.lignes || []).map(l => [l.compte, l.label || '', Number(l.debit) || 0, Number(l.credit) || 0])]);
          const valideDeLOd = (n, quandLu) => (!od || empreinteOd(n) !== empreinteOd(od) ? dateDansLaPeriodeValidee([n.date, od && od.date], quandLu) : '');
          const majValideOd = () => { const n = lire(); majAvertValide($('#od-valide', layer), valideDeLOd(n, majValideOd), n.date, { sujet: 'Cette opération', fem: true, neuve: !od, geste: 'En l\'enregistrant' }); };
          const lire = () => {
            const v = formValues($('#odf', layer));
            const lignes = $$('#od-lignes tbody tr', layer).map(tr => ({
              compte: $('.od-compte', tr).value.trim(), label: $('.od-label', tr).value.trim(),
              debit: Number($('.od-debit', tr).value) || 0, credit: Number($('.od-credit', tr).value) || 0
            }));
            return { ...o, date: v.date, label: v.label, piece: od ? String(v.piece || '').trim() || o.piece : o.piece, lignes };
          };
          const recalc = () => {
            const v = C.odValide(lire(), company());
            $('#od-td', layer).textContent = montantCompta(v.debit); $('#od-tc', layer).textContent = montantCompta(v.credit);
            const ecart = C.round3(v.debit - v.credit);
            $('#od-ecart', layer).innerHTML = ecart ? `<span class="due">Écart de ${C.money(Math.abs(ecart), company().currency)} : l'écriture ne tombe pas juste.</span>` : (v.debit ? '<span class="ok">Débit = crédit : l\'écriture tombe juste.</span>' : '');
            $$('#od-lignes tbody tr', layer).forEach(tr => { $('.od-lib', tr).textContent = C.accountLabel(data, $('.od-compte', tr).value.trim()); });
            majValideOd();
          };
          $('#odf', layer).addEventListener('input', majValideOd);
          $('#odf', layer).addEventListener('change', majValideOd);
          const brancher = () => {
            $$('#od-lignes tbody tr', layer).forEach(tr => {
              $$('input', tr).forEach(inp => { inp.oninput = recalc; });
              $('.od-del', tr).onclick = () => { if ($$('#od-lignes tbody tr', layer).length <= 2) return toast('Une écriture garde au moins deux lignes.', true); tr.remove(); recalc(); };
            });
          };
          brancher(); recalc();
          $('#od-add', layer).onclick = () => {
            const tb = $('#od-lignes tbody', layer);
            tb.insertAdjacentHTML('beforeend', ligneHtml({ compte: '', label: '', debit: 0, credit: 0 }, tb.children.length));
            brancher(); $('#od-lignes tbody tr:last-child .od-compte', layer).focus();
          };
          $('#od-ok', layer).onclick = () => {
            const n = lire();
            const v = C.odValide(n, company());
            if (!v.ok) { if (!n.label.trim()) return refus('#odf input[name=label]', v.erreurs[0]); return toast(v.erreurs[0], true); }
            if (!od && licenceBlock('Créer une opération diverse')) return;
            if (closedBlock([od && od.date, n.date], 'Cette opération diverse')) return;
            const dvOd = valideDeLOd(n);
            if (!od) n.piece = C.odPiece(data, n.date);
            n.lignes = v.lignes;
            if (od) Object.assign(od, n); else data.ecrituresOD.push(n);
            save(true); close();
            if (dvOd) direAuComptableApres(`${n.piece} enregistrée`, { fait: od ? 'de modifier' : 'd\'enregistrer', fem: true, quoi: `l'opération diverse ${n.piece} « ${n.label} » datée du ${C.fmtDate(dvOd)} (${C.money(v.debit, company().currency)})` });
            else toast(`${n.piece} enregistrée`);
            if (done) done(n);
          };
        });
    }

    // Les six colonnes d'une balance, partagées par la générale et les auxiliaires : ouverture,
    // mouvements, soldes — chaque montant dans SA colonne, débit ou crédit, jamais un signe.
    const BAL_HEAD = `<th class="r">Ouverture D</th><th class="r">Ouverture C</th><th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde D</th><th class="r">Solde C</th>`;
    const balCells = r => ['ouvertureD', 'ouvertureC', 'debit', 'credit', 'soldeD', 'soldeC']
      .map(k => `<td class="r nw">${r[k] ? montantCompta(r[k]) : '<span class="muted">—</span>'}</td>`).join('');
    const balFoot = t => `<tr class="total-row"><td colspan="2">Totaux</td>${['ouvertureD', 'ouvertureC', 'debit', 'credit', 'soldeD', 'soldeC'].map(k => `<td class="r nw"><strong>${montantCompta(t[k])}</strong></td>`).join('')}</tr>`;

    // Les comptes auxiliaires s'écrivent sur les fiches (compteAux) la première fois qu'on en a
    // besoin : un code figé ne change plus, quoi qu'il arrive à la liste.
    function figerAuxiliaires() {
      if (!C.auxiliairesActifs(data)) return;
      if (C.numeroterAuxiliaires(data)) save();
    }

    // Le grand livre (8.8.0) : « mouvement de compte », le premier terme du comptable. Un compte,
    // ses lignes une à une, le solde qui avance — et le solde d'ouverture en tête, déduit de tout
    // ce qui précède la période.
    function drawGrandLivre() {
      figerAuxiliaires();
      const cur = company().currency;
      const p = period();
      const tout = C.grandLivre(data, company(), p, {});
      const choix = tout.comptes.map(c => ({ v: c.account, label: `${c.account} — ${c.label}` }));
      if (glState.compte && !tout.comptes.some(c => c.account.startsWith(glState.compte))) glState.compte = '';
      const gl = glState.compte ? C.grandLivre(data, company(), p, { compte: glState.compte }) : tout;
      const lignes = gl.lignes;
      $('#c-body').innerHTML = `
        <div class="panel"><h2>Grand livre — ${h(periodLabel())} ${info('gl.quoi')}</h2>
          <p class="small">Chaque compte, mouvement par mouvement, avec le solde qui avance. Le solde d'ouverture reprend tout ce qui précède la période ; les charges et les produits repartent de zéro au 1er janvier. ${info('gl.solde')}</p>
          <div class="inline mt" style="align-items:center;gap:10px;flex-wrap:wrap">
            <label class="field" style="min-width:320px;margin:0">${lbl('Compte', 'gl.compte')}
              ${combo({ name: 'glCompte', value: glState.compte, items: [{ v: '', label: 'Tous les comptes' }, ...choix], placeholder: 'Un compte, ou un début de numéro…' })}</label>
            <button class="btn" id="gl-csv" ${lignes ? '' : 'disabled'}>Exporter en CSV</button>
            <button class="btn btn-ghost" id="gl-plan">Plan de comptes…</button>
          </div>
          <div class="pay-grid mt">
            <div><div class="k-label">Comptes</div><div class="v">${gl.comptes.length}</div></div>
            <div><div class="k-label">Lignes</div><div class="v">${lignes}</div></div>
            <div><div class="k-label">Total débit</div><div class="v">${C.money(gl.debit, cur)}</div></div>
            <div><div class="k-label">Total crédit</div><div class="v">${C.money(gl.credit, cur)}</div></div>
          </div>
        </div>
        ${!tout.comptes.length
          ? '<div class="panel"><div class="empty">Aucune écriture sur cette période, et aucun solde reporté. Choisis un autre mois en haut à droite.</div></div>'
          : gl.comptes.map(c => `
        <div class="panel gl-compte" data-compte="${h(c.account)}"><h2><span class="mono">${h(c.account)}</span> ${h(c.label)}</h2>
          <div class="scroll-x"><table class="list compact gl-t">
            <thead><tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Libellé</th>${c.lignes.some(e => e.role) ? '<th>Let.</th>' : ''}<th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde ${info('gl.solde')}</th></tr></thead>
            <tbody>
              <tr class="gl-ouv"><td class="nw muted">—</td><td></td><td></td><td class="muted">Solde d'ouverture</td>${c.lignes.some(e => e.role) ? '<td></td>' : ''}<td></td><td></td><td class="r nw">${montantCompta(c.ouverture)}</td></tr>
              ${c.lignes.map(e => `<tr>
                <td class="nw">${C.fmtDate(e.date)}</td><td>${h(e.journal)}</td><td class="nw">${h(e.piece)}${marqueJustif(C.justificatifsDe(data, e))}</td><td>${h(e.label)}</td>
                ${c.lignes.some(x => x.role) ? `<td class="nw small muted">${h(e.lettre || '')}</td>` : ''}
                <td class="r nw">${e.debit ? montantCompta(e.debit) : '<span class="muted">—</span>'}</td>
                <td class="r nw">${e.credit ? montantCompta(e.credit) : '<span class="muted">—</span>'}</td>
                <td class="r nw gl-solde">${montantCompta(e.solde)}</td></tr>`).join('')}
            </tbody>
            <tfoot><tr class="total-row"><td colspan="${c.lignes.some(e => e.role) ? 5 : 4}">Total du compte</td>
              <td class="r nw"><strong>${montantCompta(c.debit)}</strong></td><td class="r nw"><strong>${montantCompta(c.credit)}</strong></td>
              <td class="r nw"><strong>${montantCompta(c.solde)}</strong></td></tr></tfoot>
          </table></div>
        </div>`).join('')}`;
      bindCombo($('[data-combo=glCompte]'), { items: [{ v: '', label: 'Tous les comptes' }, ...choix], onPick: v => { glState.compte = v || ''; drawGrandLivre(); } });
      const tag = comptaState.month ? `${comptaState.year}-${comptaState.month}` : comptaState.year;
      $('#gl-csv').onclick = async () => {
        const f = await bridge.saveText(`grand-livre-${tag}${glState.compte ? '-' + glState.compte : ''}.csv`, C.toCsv(C.grandLivreRows(gl), C.grandLivreCsvColumns()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      $('#gl-plan').onclick = () => chartForm(drawGrandLivre);
    }

    // La balance (8.8.0) : tous les comptes sur une page, et des totaux qui doivent tomber juste.
    // C'est le premier document qu'un cabinet tire pour contrôler un dossier. Les auxiliaires
    // (clients, fournisseurs) disent qui doit quoi, tiers par tiers.
    function drawBalance() {
      figerAuxiliaires();
      const cur = company().currency;
      const p = period();
      const vue = balState.vue;
      const tag = comptaState.month ? `${comptaState.year}-${comptaState.month}` : comptaState.year;
      const VUES = [['generale', 'Générale'], ['clients', 'Auxiliaire clients'], ['fournisseurs', 'Auxiliaire fournisseurs'], ['lettrage', 'Lettrage']];
      // (1.302.0) Les vues de la balance en boutons segmentés, comme les onglets de la page (la DA des listes).
      const sel = `<div class="pa-seg mt" id="bal-vues" role="tablist" aria-label="Les vues de la balance">${VUES.map(([id, label]) => `<button type="button" role="tab" data-vue="${id}" aria-selected="${id === vue}" class="${id === vue ? 'active' : ''}">${label}</button>`).join('')}</div>`;
      let corps, csvRows = [], csvCols = [], nomCsv = '';
      if (vue === 'generale') {
        const b = C.balanceGenerale(data, company(), p, {});
        csvRows = b.rows; csvCols = C.balanceCsvColumns(); nomCsv = `balance-${tag}.csv`;
        corps = `
          <div class="pay-grid">
            <div><div class="k-label">Comptes</div><div class="v">${b.rows.length}</div></div>
            <div><div class="k-label">Mouvements débit</div><div class="v">${C.money(b.totals.debit, cur)}</div></div>
            <div><div class="k-label">Mouvements crédit</div><div class="v">${C.money(b.totals.credit, cur)}</div></div>
            <div><div class="k-label">Soldes débiteurs = créditeurs</div><div class="v ${b.equilibree ? 'ok' : 'due'}">${C.money(b.totals.soldeD, cur)}</div></div>
          </div>
          ${!b.rows.length ? '<div class="banner info"><span>Aucun compte mouvementé sur cette période, et aucun solde reporté.</span></div>'
            : b.equilibree ? '<div class="todo-ok" id="bal-ok">La balance tombe juste : ouverture, mouvements et soldes ont chacun le même total au débit et au crédit.</div>'
            : '<div class="banner" id="bal-ko"><span>La balance ne tombe pas juste — signale-le avant d\'envoyer quoi que ce soit.</span></div>'}
          ${b.rows.length ? `<div class="scroll-x mt"><table class="list compact" id="bal-t">
            <thead><tr><th>Compte</th><th>Intitulé</th>${BAL_HEAD}</tr></thead>
            <tbody>${b.rows.map(r => `<tr class="bal-c${h(r.classe)}"><td class="nw"><strong>${h(r.account)}</strong></td><td>${h(r.label)}</td>${balCells(r)}</tr>`).join('')}</tbody>
            <tfoot>${balFoot(b.totals)}</tfoot></table></div>` : ''}`;
      } else if (vue === 'lettrage') {
        // 8.9.0 : le lettrage est une LECTURE, pas une saisie — les règlements sont déjà rattachés à
        // leurs pièces. Ce qui est soldé porte sa lettre ; ce qui reste ouvert est listé, tiers par tiers.
        const lc = C.lettrage(data, company(), 'clients', C.today());
        const lf = C.lettrage(data, company(), 'fournisseurs', C.today());
        const bloc = (l, qui) => `
          <h3 class="mt">${qui === 'clients' ? 'Clients' : 'Fournisseurs'} — ${pl(l.lettrees, 'pièce')} lettrée${l.lettrees > 1 ? 's' : ''}, ${pl(l.ouverts, 'pièce')} ouverte${l.ouverts > 1 ? 's' : ''}, reste ${C.money(l.reste, cur)}</h3>
          ${l.ouverts ? `<div class="scroll-x"><table class="list compact" id="let-${qui}"><thead><tr><th>Compte</th><th>${qui === 'clients' ? 'Client' : 'Fournisseur'}</th><th>Pièce</th><th>Date</th><th>Échéance</th><th class="r">Montant</th><th class="r">${qui === 'clients' ? 'Avoirs' : 'Avoirs et acomptes'}</th><th class="r">Réglé</th><th class="r">Reste</th></tr></thead><tbody>
            ${l.rows.flatMap(r => r.ouverts.map(o => `<tr class="${o.retard ? 'b-late' : ''}" data-go="${h(qui === 'clients' ? '#/doc/' + o.id : '#/achat/' + o.id)}" style="cursor:pointer">
              <td class="nw"><strong>${h(r.account)}</strong></td><td>${h(r.tiers)}</td><td class="nw">${h(o.piece)}</td><td class="nw">${C.fmtDate(o.date)}</td>
              <td class="nw ${o.retard ? 'due' : ''}">${o.echeance ? C.fmtDate(o.echeance) : '—'}</td>
              <td class="r nw">${montantCompta(o.montant)}</td><td class="r nw">${o.avoirs ? montantCompta(o.avoirs) : '—'}</td><td class="r nw">${o.regle ? montantCompta(o.regle) : '—'}</td><td class="r nw"><strong>${montantCompta(o.reste)}</strong></td></tr>`)).join('')}
          </tbody><tfoot><tr class="total-row"><td colspan="8">Reste à lettrer</td><td class="r nw"><strong>${montantCompta(l.reste)}</strong></td></tr></tfoot></table></div>`
            : `<div class="todo-ok">Tout est lettré : aucune pièce ${qui === 'clients' ? 'client' : 'fournisseur'} ouverte.</div>`}`;
        csvRows = lc.rows.flatMap(r => r.ouverts.map(o => ({ role: 'client', account: r.account, tiers: r.tiers, ...o }))).concat(lf.rows.flatMap(r => r.ouverts.map(o => ({ role: 'fournisseur', account: r.account, tiers: r.tiers, ...o }))));
        csvCols = [{ key: 'role', label: 'Rôle' }, { key: 'account', label: 'Compte' }, { key: 'tiers', label: 'Tiers' }, { key: 'piece', label: 'Pièce' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'echeance', label: 'Échéance' }, { key: 'montant', label: 'Montant', type: 'money' }, { key: 'avoirs', label: 'Avoirs et acomptes', type: 'money' }, { key: 'regle', label: 'Réglé', type: 'money' }, { key: 'reste', label: 'Reste', type: 'money' }];
        nomCsv = `lettrage-${C.today()}.csv`;
        corps = `<p class="small">Une facture soldée et ses règlements portent la même lettre — son numéro — dans le livre-journal et le grand livre. Ici, ce qui reste <b>ouvert</b> à ce jour, tiers par tiers : c'est la liste que ton comptable te demande avant de clôturer. ${info('bal.lettrage')}</p>${bloc(lc, 'clients')}${bloc(lf, 'fournisseurs')}`;
      } else {
        const b = C.balanceAuxiliaire(data, company(), p, vue, {});
        csvRows = b.rows; csvCols = C.balanceAuxCsvColumns(); nomCsv = `balance-${vue}-${tag}.csv`;
        const qui = vue === 'clients' ? 'client' : 'fournisseur';
        corps = `
          <p class="small">Un ${qui} par ligne : ce qu'il ${vue === 'clients' ? 'devait' : 'était dû'} à l'ouverture, ce qui a été ${vue === 'clients' ? 'facturé et encaissé' : 'acheté et réglé'} sur la période, et ce qui reste. ${info('bal.aux')}
            ${C.auxiliairesActifs(data) ? '' : '<br><span class="muted">Les tiers partagent encore le compte collectif ; « Plan de comptes… » active un sous-compte par tiers (411001, 401001…), comme les cabinets les tiennent.</span>'}</p>
          ${!b.rows.length ? `<div class="empty">Aucun ${qui} mouvementé sur cette période.</div>`
            : `<div class="scroll-x"><table class="list compact" id="bal-aux">
            <thead><tr><th>Compte</th><th>${vue === 'clients' ? 'Client' : 'Fournisseur'}</th>${BAL_HEAD}</tr></thead>
            <tbody>${b.rows.map(r => `<tr><td class="nw"><strong>${h(r.account)}</strong></td><td>${h(r.tiers)}</td>${balCells(r)}</tr>`).join('')}</tbody>
            <tfoot>${balFoot(b.totals)}</tfoot></table></div>`}`;
      }
      $('#c-body').innerHTML = `
        <div class="panel"><h2>Balance — ${h(periodLabel())} ${info('bal.quoi')}</h2>
          <p class="small">Tous les comptes sur une page : le solde à l'ouverture de la période, les mouvements, le solde à la fin. <em>À VÉRIFIER avec ton comptable :</em> les numéros de compte sont ceux du plan réglé dans SkanFact.</p>
          ${sel}
          <div class="inline mt">
            <button class="btn" id="bal-csv">Exporter en CSV</button>
            <button class="btn btn-ghost" id="bal-plan">Plan de comptes…</button>
          </div>
        </div>
        <div class="panel">${corps}</div>`;
      $$('#bal-vues button').forEach(b => b.onclick = () => { balState.vue = b.dataset.vue; drawBalance(); });
      $$('#c-body tr[data-go]').forEach(tr => { tr.onclick = () => navigate(tr.dataset.go); });
      $('#bal-csv').onclick = async () => {
        const f = await bridge.saveText(nomCsv, C.toCsv(csvRows, csvCols));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      $('#bal-plan').onclick = () => chartForm(drawBalance);
    }

    // Les états financiers (9.0.0) : le bilan et l'état de résultat déduits de la balance de
    // l'exercice. Une présentation d'ensemble, pas la liasse — c'est le cabinet qui l'établit, et
    // c'est écrit. Ce qui est garanti : actif = passif, et le résultat des deux états est le même.
    function drawEtats() {
      figerAuxiliaires();
      const cur = company().currency;
      const p = period();
      const y = p.from.slice(0, 4);
      const t = C.today();
      // Sur l'année en cours, l'arrêté est à aujourd'hui ; sur un mois choisi, à la fin du mois.
      const to = comptaState.month ? (p.to > t ? t : p.to) : (y === t.slice(0, 4) ? t : `${y}-12-31`);
      const e = C.etatsFinanciers(data, company(), y, to, {});
      // En cours d'exercice, deux écritures d'inventaire attendent le 31 décembre : la dotation et
      // la variation du stock. La phrase les nomme toutes les deux et refait le calcul qui mène au
      // résultat simplifié — seulement s'il tombe juste : une égalité affichée se vérifie (10.14.0).
      const enAttente = (() => {
        const dot = e.dotationEnAttente || 0, vs = e.variationStockEnAttente || 0;
        if (!dot && !vs) return '';
        const sr = C.simpleResult(data, company(), { from: `${y}-01-01`, to }).resultat;
        const tombe = Math.abs(C.round3(e.resultat - dot + vs) - sr) < 0.002;
        const stocks = (e.actif.find(g => g.titre === 'Stocks') || { total: 0 }).total;
        const quoi = [
          dot ? `la dotation aux amortissements (${C.money(dot, cur)} au ${C.fmtDate(to)})` : '',
          vs ? `la variation du stock depuis le dernier inventaire (${moneySigne(vs, cur)} : ${C.money(C.round3(stocks + vs), cur)} sur l'étagère, ${C.money(stocks, cur)} au bilan)` : ''
        ].filter(Boolean);
        return `<p class="small muted mt" id="et-attente">${quoi.length > 1 ? 'Deux écritures d\'inventaire ne s\'écrivent' : 'Une écriture d\'inventaire ne s\'écrit'} qu'au 31 décembre, et le résultat ci-dessus ne ${quoi.length > 1 ? 'les' : 'la'} compte pas encore : ${quoi.join(' et ')}. Le <a href="#/compta" data-onglet="tva">résultat simplifié</a> ${quoi.length > 1 ? 'les' : 'la'} compte déjà${tombe ? ` : ${C.money(e.resultat, cur)}${dot ? ` − ${C.money(dot, cur)}` : ''}${vs ? ` ${vs > 0 ? '+' : '−'} ${C.money(Math.abs(vs), cur)}` : ''} = ${C.money(sr, cur)}` : ''}.</p>`;
      })();
      const tab = (g) => g.lignes.length ? `<table class="list compact"><tbody>${g.lignes.map(l => `<tr><td class="nw"><strong>${h(l.account)}</strong></td><td>${h(l.label)}</td><td class="r nw">${montantCompta(l.montant)}</td></tr>`).join('')}
        <tr class="total-row"><td colspan="2">${h(g.titre)}</td><td class="r nw"><strong>${montantCompta(g.total)}</strong></td></tr></tbody></table>` : `<p class="small muted">${h(g.titre)} : —</p>`;
      $('#c-body').innerHTML = `
        <div class="panel"><h2>États financiers — exercice ${h(y)}, arrêtés au ${C.fmtDate(to)} ${info('etats.quoi')}</h2>
          <p class="small">Le bilan et l'état de résultat, déduits de la balance de l'exercice. Une présentation d'ensemble pour savoir où tu en es : <em>ce n'est pas la liasse fiscale, c'est ton comptable qui l'établit, à partir de ces chiffres.</em> <em>À VÉRIFIER avec lui.</em></p>
          <div class="pay-grid">
            <div><div class="k-label">Total actif</div><div class="v">${C.money(e.totalActif, cur)}</div></div>
            <div><div class="k-label">Total passif</div><div class="v ${e.equilibre ? 'ok' : 'due'}">${C.money(e.totalPassif, cur)}</div></div>
            <div><div class="k-label">Résultat de l'exercice</div><div class="v ${e.resultat >= 0 ? 'ok' : 'due'}" id="et-resultat">${C.money(e.resultat, cur)}</div></div>
            <div><div class="k-label">Produits − charges</div><div class="v">${C.money(e.produits.total, cur)} − ${C.money(e.charges.total, cur)}</div></div>
          </div>
          ${e.equilibre ? '<div class="todo-ok" id="et-ok">Actif = passif : le bilan tient debout.</div>' : '<div class="banner" id="et-ko"><span>Le bilan ne tombe pas juste — signale-le avant d\'envoyer quoi que ce soit.</span></div>'}
          ${enAttente}
          <div class="inline mt"><button class="btn" id="et-csv">Exporter en CSV</button><button class="btn btn-ghost" id="et-plan">Plan de comptes…</button></div>
        </div>
        <div class="split">
          <div class="panel"><h2>Bilan — actif ${info('etats.bilan')}</h2>${e.actif.map(tab).join('')}
            <p class="mt"><strong>Total actif : ${C.money(e.totalActif, cur)}</strong></p></div>
          <div class="panel"><h2>Bilan — passif</h2>${e.passif.map(tab).join('')}
            <table class="list compact"><tbody><tr class="total-row"><td colspan="2">Résultat de l'exercice</td><td class="r nw"><strong>${montantCompta(e.resultat)}</strong></td></tr></tbody></table>
            <p class="mt"><strong>Total passif : ${C.money(e.totalPassif, cur)}</strong></p></div>
        </div>
        <div class="split">
          <div class="panel"><h2>État de résultat — produits ${info('etats.resultat')}</h2>${tab(e.produits)}</div>
          <div class="panel"><h2>État de résultat — charges</h2>${tab(e.charges)}
            <p class="mt"><strong>Résultat : ${C.money(e.resultat, cur)}</strong> ${e.resultat >= 0 ? '(bénéfice)' : '(perte)'}</p></div>
        </div>`;
      $('#et-csv').onclick = async () => {
        const f = await bridge.saveText(`etats-financiers-${y}.csv`, C.toCsv(C.etatsCsvRows(e), C.etatsCsvColumns()));
        if (f) toast('Exporté : ' + f.split(/[\\/]/).pop());
      };
      $('#et-plan').onclick = () => chartForm(drawEtats);
      const lien = $('#c-body a[data-onglet]');
      if (lien) lien.onclick = ev => { ev.preventDefault(); comptaState.tab = lien.dataset.onglet; draw(); $$('#c-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === lien.dataset.onglet)); };
    }

    // Le plan de comptes. Aucun numéro n'est certain : le comptable a le dernier mot, donc tout
    // se modifie, et « Revenir aux comptes proposés » ramène la proposition de départ.
    function chartForm(done) {
      const acc = C.chartAccounts(data);
      const keys = Object.keys(C.DEFAULT_ACCOUNTS);
      modal(`<h2>Plan de comptes</h2>
        <p class="small muted">Demande ces numéros à ton comptable : ce sont les siens qui comptent, pas les nôtres. Les écritures exportées les reprendront tels quels. <em>À VÉRIFIER.</em></p>
        <form id="chf"><table class="list compact"><tbody>
          ${keys.map(k => `<tr><td>${h(C.ACCOUNT_LABELS[k] || k)}</td>
            <td style="width:140px"><input type="text" name="${h(k)}" value="${h(acc[k])}" placeholder="${h(C.DEFAULT_ACCOUNTS[k])}"></td></tr>`).join('')}
        </tbody></table>
        <label class="check mt"><input type="checkbox" name="auxiliaires" ${C.auxiliairesActifs(data) ? 'checked' : ''}> Un sous-compte par client et par fournisseur (411001, 401001…) ${info('plan.aux')}</label>
        </form>
        <details class="mt"><summary class="small">Le plan comptable tunisien, pour nommer les comptes (${C.PLAN_COMPTABLE.length} intitulés)</summary>
          <div style="max-height:260px;overflow:auto"><table class="list compact"><tbody>
            ${C.PLAN_COMPTABLE.map(([n, l]) => `<tr><td class="nw ${n.length === 1 ? '' : 'muted'}" style="padding-inline-start:${4 + (n.length - 1) * 10}px"><strong>${h(n)}</strong></td><td>${h(l)}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="small muted">Nomenclature du Système comptable des entreprises (1996). Elle sert à écrire l'intitulé d'un compte à l'écran et dans les exports ; elle n'impose rien. <em>À VÉRIFIER.</em></p>
        </details>
        <div class="modal-actions"><button class="btn btn-ghost" id="ch-reset">Revenir aux comptes proposés</button>
          <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ch-ok">Enregistrer</button></div>`,
        (layer, close) => {
          // Ce bouton jette des numéros de compte que le cabinet a dictés un par un. Il ne s'exécute
          // pas sur un clic : une fois la fenêtre fermée, plus rien ne les retrouve.
          $('#ch-reset', layer).onclick = async () => {
            const perso = Object.keys(data.chartAccounts || {}).length;
            if (perso && !await confirmDialog(
              `Remettre les ${perso} compte${perso > 1 ? 's' : ''} que tu as modifié${perso > 1 ? 's' : ''} à la proposition de départ ?\n\n`
              + 'Les numéros que ton comptable t\'a donnés seront perdus : il n\'y a pas de retour en arrière une fois la fenêtre fermée.',
              'Remettre la proposition', true)) return;
            delete data.chartAccounts; save(); close(); toast('Comptes remis à la proposition de départ'); if (done) done();
          };
          $('#ch-ok', layer).onclick = () => {
            const v = formValues($('#chf', layer));
            const out = {};
            keys.forEach(k => { const val = String(v[k] || '').trim(); if (val && val !== C.DEFAULT_ACCOUNTS[k]) out[k] = val; });
            if (Object.keys(out).length) data.chartAccounts = out; else delete data.chartAccounts;
            // Les sous-comptes par tiers : on fige les codes dès qu'on les active, pour que le
            // 411004 d'aujourd'hui soit encore le même client dans six mois.
            data.auxiliaires = !!$('input[name=auxiliaires]', layer).checked;
            if (data.auxiliaires) C.numeroterAuxiliaires(data);
            save(); close(); toast('Plan de comptes enregistré'); if (done) done();
          };
        });
    }

    // Pourquoi le panneau n'a rien à clôturer, dit à partir de `C.rienACloturer` (E-06) : une
    // entreprise qui vient de commencer a des pièces, toutes dans le mois en cours, et « aucune pièce
    // datée » la faisait douter de ce qu'elle venait de saisir. Chaque phrase donne le jour où le
    // premier mois deviendra clôturable — c'est la seule chose qu'on peut faire de cette information.
    function phraseRienACloturer(r) {
      const des = `à partir du 1er ${C.monthLabel(r.des)}`;
      if (r.cas === 'aucune') return 'Aucune pièce datée pour l\'instant : il n\'y a encore rien à clôturer.';
      if (r.cas === 'a-jour') return `Tout est clôturé jusqu'au mois en cours : ${h(r.mois)} se clôturera une fois terminé, ${des}.`;
      const qui = r.n === 1 ? 'Ta seule pièce est datée' : `Tes ${r.n} pièces sont toutes datées`;
      const quand = r.enCours ? `${h(r.mois)}, le mois en cours` : r.n === 1 ? h(r.mois) : `${h(r.mois)} ou après`;
      return `${qui} de ${quand} : un mois se clôture une fois terminé, donc ${des}.`;
    }

    function drawClosures() {
      const closed = C.closedUntil(data);
      const months = C.closableMonths(data, C.today());
      const next = months[0] || null;
      const checks = next ? C.closureChecks(data, company(), next.from, next.to, { reserves: licence.reserves || [], sansPiecesJointes: bridge.piecesJointes === false }) : [];
      const log = C.closureLog(data);
      const blocking = checks.filter(c => c.level === 'danger');
      // (1.301.0) Le cabinet valide ses livres de son côté : jusqu'où, lu au serveur. L'onglet disait « Aucune période n'est
      // clôturée » à un client dont le cabinet avait validé septembre — et un achat de septembre saisi ensuite lui arrivait
      // comme une correction, sans que personne ne l'ait dit.
      const avecCab = !!(messagerieVue && messagerieVue.cabinet);
      const valideCab = avecCab && livresCabinetLus && !livresCabinetLus.enCours && !livresCabinetLus.illisible ? livresCabinetLus.valideJusqua || '' : '';
      // Un seul bouton pour un geste : quand le mois validé est le prochain à clôturer, c'est « Clôturer septembre », plus bas.
      const clotPossible = valideCab && valideCab > (closed || '') && months.some(m => m.to === valideCab);
      const aligner = clotPossible && !(next && next.to === valideCab) ? valideCab : '';
      const ligneCabinet = !valideCab ? '' : `<div class="cpt-cab-clot" id="clot-cabinet"><p>${lfIc('coche', 15, 2.4)}<span>Ton cabinet a validé tes livres jusqu'au <strong>${h(C.fmtDate(valideCab))}</strong> : ses écritures de cette période ne bougent plus chez lui. ${info('clot.cabinet2')}</span></p>
          ${valideCab > (closed || '') ? `<p class="small">Chez toi, des pièces de cette période peuvent encore changer : chez lui, un changement s'écrirait comme une correction au ${h(C.fmtDate(C.addDays(valideCab, 1)))}, le premier jour encore ouvert.${clotPossible ? ' Clôture-les aussi, pour qu\'elles restent comme il les a validées.' : ''}</p>
          ${aligner ? `<div class="inline"><button class="btn btn-sm" id="clot-aligner">Clôturer jusqu'au ${h(C.fmtDate(aligner))}</button></div>` : ''}` : ''}</div>`;
      // Le texte prêt pour la conversation : ce qui vient d'être clôturé ou rouvert.
      const texteClotureAuCabinet = e => (e.action === 'reouverture'
        ? `Bonjour, j'ai rouvert ${e.until ? `mes mois à partir du ${C.fmtDate(C.addDays(e.until, 1))}` : 'toutes mes périodes clôturées'}${e.reason ? `, motif : ${e.reason}` : ''}. Des pièces de ces mois peuvent changer : je te dirai lesquelles.`
        : `Bonjour, j'ai clôturé jusqu'au ${C.fmtDate(e.until)} : mes pièces jusqu'à cette date ne bougeront plus.`);
      const direAuCabinet = (msg, e) => { if (avecCab) toastUndo(msg, () => ecrireAuComptable(texteClotureAuCabinet(e)), 'Le dire à mon comptable'); else toast(msg); };

      $('#c-body').innerHTML = `
        <div class="panel"><h2>État ${info('clot.etat')}</h2>
          ${closed
            ? `<p>Tout ce qui est daté jusqu'au <strong>${C.fmtDate(closed)}</strong> est clôturé : plus aucune pièce de cette période ne peut être créée, modifiée ou supprimée.</p>`
            : `<p>Aucune période n'est clôturée${avecCab ? ' chez toi' : ''}. Tes pièces passées peuvent encore être modifiées — y compris celles que ton comptable a déjà reçues.</p>`}
          ${ligneCabinet}
          <p class="small muted">Clôturer un mois est la promesse que ce mois ne bougera plus. C'est ce qui permet à ton comptable de travailler sur un dossier stable. Une réouverture reste possible, avec un motif, et elle est inscrite dans le journal ci-dessous.</p>
        </div>

        <div class="panel"><h2>Clôturer ${info('clot.cloturer')}</h2>
          ${!next
            ? `<div class="empty" id="clot-rien">${phraseRienACloturer(C.rienACloturer(data, C.today()))}</div>`
            : `<p>Prochain mois à clôturer : <strong>${h(next.label)}</strong> <span class="muted small">(du ${C.fmtDate(next.from)} au ${C.fmtDate(next.to)})</span></p>
               ${checks.length
                 ? `<div class="panel sub" style="margin:12px 0">
                      <h3 style="margin-top:0">À regarder avant de clôturer</h3>
                      <table class="list compact"><tbody>
                        ${checks.map(c => `<tr class="${c.level === 'danger' ? 'row-warn' : ''}"><td><strong>${h(c.label)}</strong><div class="small muted">${h(c.detail)}</div></td>
                          <td class="r nw">${c.count == null ? '' : c.count}</td>
                          <td class="r nw">${actionDeControle(c.id) ? `<button class="btn btn-sm" data-check="${h(c.id)}">${h(actionDeControle(c.id).label)}</button>` : ''}</td></tr>`).join('')}
                      </tbody></table>
                      <p class="small muted">Tu peux clôturer quand même : ces points sont là pour que tu les voies, pas pour t'empêcher d'avancer.</p>
                    </div>`
                 : '<p class="small" style="color:var(--primary)">Rien à signaler sur ce mois.</p>'}
               <div class="inline mt">
                 <button class="btn btn-primary" id="do-close">Clôturer ${h(next.label)}</button>
                 ${months.length > 1 ? `<button class="btn" id="close-to">Clôturer jusqu'à un mois plus récent…</button>` : ''}
               </div>`}
        </div>

        ${/* 10.12.0 — « Rien n'est clôturé, donc rien à rouvrir » dans un cadre de 110 px, sous un État
             qui venait de le dire : un panneau qui n'a rien à proposer ne s'affiche pas. */''}
        ${closed ? `<div class="panel"><h2>Rouvrir ${info('clot.rouvrir')}</h2>
          <p class="small">Rouvrir sert quand une pièce a été oubliée dans une période déjà clôturée. <strong>Préviens ton comptable</strong> : les chiffres qu'il a reçus vont changer. ${avecCab ? 'Le motif que tu écris ici reste dans le journal des clôtures, avec la date ; « Le dire à mon comptable » l\'ouvre ensuite dans votre conversation, déjà écrit.' : 'Le motif que tu écris ici reste dans le journal des clôtures, avec la date — il ne part pas tout seul chez lui.'}</p>
          <button class="btn btn-danger" id="do-reopen">Rouvrir une période…</button>
        </div>` : ''}

        <div class="panel" id="p-cloture-cabinet"><h2>La clôture de ton comptable ${info('clot.cabinet')}</h2>
          ${(data.clotures || []).length
            ? `<table class="list compact"><thead><tr><th>Exercice</th><th>Reçu le</th><th>Origine</th><th class="r nw">Résultat</th><th>Verrou</th><th></th></tr></thead><tbody>
                ${(data.clotures || []).slice().sort((a, b) => String(b.exercice).localeCompare(String(a.exercice))).map(c => `<tr>
                  <td class="nw">${h(c.exercice)}</td>
                  <td class="nw">${C.fmtDate(String(c.recuLe || '').slice(0, 10))}</td>
                  <td>${c.origine === 'prouvee'
                    ? `<span class="badge b-paid">signée</span> <span class="small muted mono">${h(c.empreinte || '')}</span>`
                    : '<span class="badge b-late">origine non prouvée</span>'}</td>
                  <td class="r nw">${C.money(c.resultat || 0, company().currency)}</td>
                  <td>${c.verrouille === false
                    ? `<span class="badge b-due">verrou en attente</span><div class="small muted">${h(c.verrouMotif || '')}</div>`
                    : '<span class="badge b-paid">verrouillé</span>'}</td>
                  <td class="r nw">${c.etatsHtml ? `<button class="btn btn-sm" data-etats="${h(c.exercice)}">Voir les états</button>` : ''}</td></tr>`).join('')}
              </tbody></table>
              <p class="small muted">Les à-nouveaux officiels de ton comptable sont posés. Quand l'exercice est
              <strong>verrouillé</strong>, plus aucune pièce datée dedans ne bouge : c'est ce qui garantit que
              ton bilan et le sien disent la même chose. Un exercice qui n'est pas encore terminé sur ce poste
              n'est pas verrouillé tout de suite, et la ligne le dit.</p>`
            : `<div class="empty mini">Aucune clôture reçue. Quand ton comptable a fini un exercice, il t'envoie un
               fichier <code>.skanclose</code> : il porte les à-nouveaux officiels et tes états financiers.</div>`}
          <div class="inline mt"><button class="btn" id="cl-import">Importer un dossier de clôture…</button></div>
        </div>

        <div class="panel"><h2>Journal des clôtures ${info('clot.journal')}</h2>
          ${log.length
            ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Action</th><th>Jusqu'au</th><th>Motif</th>${avecCab ? '<th></th>' : ''}</tr></thead><tbody>
                ${log.map((e, i) => `<tr><td><span class="badge ${e.action === 'reouverture' ? 'b-late' : 'b-paid'}">${h(C.CLOSURE_ACTIONS[e.action] || e.action)}</span></td>
                  <td class="nw">${e.until ? C.fmtDate(e.until) : '<span class="muted">tout rouvert</span>'}</td>
                  <td class="small">${h(e.reason || '')}${e.previous ? `<div class="muted">auparavant : ${C.fmtDate(e.previous)}</div>` : ''}</td>
                  ${avecCab ? `<td class="r">${i === 0 ? '<button class="btn btn-sm" id="clot-dire">Le dire à mon comptable</button>' : ''}</td>` : ''}</tr>`).join('')}
              </tbody></table></div>`
            : '<div class="empty mini">Aucune clôture pour l\'instant : chaque clôture et chaque réouverture s\'inscriront ici, avec leur motif.</div>'}
        </div>`;

      // Les contrôles avant clôture étaient du TEXTE : « 3 achats sans justificatif » sans rien pour
      // les ouvrir, alors que la même liste porte ses boutons à un onglet de distance (Cabinet).
      // Même table, même branchement — un manque qu'on ne peut pas ouvrir n'est pas un manque,
      // c'est un reproche.
      $$('[data-check]').forEach(b => b.onclick = () => actionDeControle(b.dataset.check).run(checks.find(c => c.id === b.dataset.check)));

      // 9.8.0 — le flux RETOUR. Le fichier de clôture pose les à-nouveaux OFFICIELS du comptable et
      // verrouille l'exercice : on montre donc ce qui va changer AVANT d'écrire quoi que ce soit.
      $$('[data-etats]').forEach(b => b.onclick = async () => {
        const c = (data.clotures || []).find(x => String(x.exercice) === b.dataset.etats);
        if (!c) return;
        try { const r = await bridge.ouvrirEtatsCloture({ source: c.exercice, html: c.etatsHtml }); ditOuverture(r, r && r.path ? r.path.split(/[\\/]/).pop() : `les états de ${c.exercice}`); }
        catch (e) { toast(plainError(e), true); }
      });
      if ($('#cl-import')) $('#cl-import').onclick = () => importerCloture();

      async function importerCloture(motDePasse) {
        let lu;
        try { lu = await bridge.lireCloture({ motDePasse }); }
        catch (e) {
          // Un fichier scellé n'est pas une panne : c'est le cas normal quand le comptable a choisi
          // un mot de passe. On le demande au lieu d'afficher du rouge (règle 8.0.1).
          if (codeErreur(e) === 'ERR-ENT-081' && !motDePasse) {
            promptDialog('Le mot de passe du dossier de clôture',
              'Ton comptable te le dit au téléphone, jamais dans le même mail que le fichier.', '',
              v => { if (v) importerCloture(v); }, 'password', { champ: 'Mot de passe', ok: 'Ouvrir le fichier' });
            return;
          }
          return toast(plainError(e), true);
        }
        if (!lu) return;
        const v = C.clotureValide(lu.cloture, { matricule: company().taxId });
        if (!v.ok) return toast(v.motifs[0], true);
        const orig = await origineAcceptee(lu, 'Dossier de clôture');
        if (!orig) return;
        const cl = lu.cloture;
        const fin = (cl.exercice && cl.exercice.au) || '';
        const deja = (data.clotures || []).find(x => String(x.exercice) === String(cl.exercice.annee));
        const ok = await confirmDialog(
          `Reprendre la clôture ${cl.exercice.annee} de ton comptable ?\n\n`
          + `• ${pl(cl.anouveaux.length, 'à-nouveau officiel', 'à-nouveaux officiels')} seront enregistrés.\n`
          + `• Ton exercice sera VERROUILLÉ jusqu'au ${C.fmtDate(fin)} : plus aucune pièce datée dedans ne pourra être créée, modifiée ou supprimée.\n`
          + `• ${orig.ligne}\n`
          + (deja ? `\nUne clôture ${cl.exercice.annee} a déjà été reprise : celle-ci la remplacera.` : ''),
          'Reprendre la clôture', !!orig.alerte);
        if (!ok) return;
        retenirSignature(orig);
        data.clotures = (data.clotures || []).filter(x => String(x.exercice) !== String(cl.exercice.annee));
        data.clotures.push({
          exercice: String(cl.exercice.annee), du: cl.exercice.du, au: fin,
          recuLe: new Date().toISOString(), cabinet: cl.cabinet || '',
          origine: lu.origine.niveau, empreinte: lu.origine.empreinte || '',
          anouveaux: cl.anouveaux, inventaire: cl.inventaire || [], resultat: cl.resultat || 0,
          etats: cl.etats || null, etatsHtml: lu.etatsHtml || ''
        });
        // Le VERROU. Deux règles, et la seconde n'existe que parce que le parcours réel l'a montrée :
        //  — on ne recule jamais le verrou : si le client avait clôturé plus loin que son comptable,
        //    lui retirer sa clôture rouvrirait des mois qu'il avait arrêtés ;
        //  — on ne verrouille pas une période qui n'est pas TERMINÉE sur ce poste. Un cabinet qui
        //    clôture un exercice encore en cours, ou deux horloges qui ne disent pas la même date,
        //    ce n'est pas rien : on le DIT, au lieu d'avaler un refus en silence et de laisser
        //    croire que l'exercice est verrouillé alors qu'il ne l'est pas.
        const entree = data.clotures[data.clotures.length - 1];
        let mot = `Clôture ${cl.exercice.annee} reprise`;
        if (fin > C.today()) {
          entree.verrouille = false;
          entree.verrouMotif = `L'exercice finit le ${C.fmtDate(fin)} : il n'est pas encore terminé sur ce poste. Le verrou se posera quand il le sera.`;
          mot += ` — le verrou attend la fin de l'exercice (${C.fmtDate(fin)}).`;
        } else if (fin > C.closedUntil(data)) {
          const r = C.closePeriod(data, fin, { at: Date.now(), by: 'clôture du cabinet', reason: `Clôture ${cl.exercice.annee} reçue du cabinet` });
          if (r.error) { entree.verrouille = false; entree.verrouMotif = r.error; mot += ` — ${r.error}`; }
          else { entree.verrouille = true; mot += ` — exercice verrouillé jusqu'au ${C.fmtDate(fin)}.`; }
        } else {
          entree.verrouille = true;
          mot += ` — déjà verrouillé jusqu'au ${C.fmtDate(C.closedUntil(data))}.`;
        }
        save(true);
        toast(mot);
        draw(); updateNavCounts();
      }

      if ($('#do-close')) $('#do-close').onclick = async () => {
        const warn = blocking.length
          ? `\n\n${pl(blocking.length, 'point')} à régler d'abord : ${blocking.map(c => c.label).join(', ')}.`
          : '';
        if (!await confirmDialog(`Clôturer ${next.label} ?\n\nAprès ça, aucune pièce datée du ${C.fmtDate(next.from)} au ${C.fmtDate(next.to)} ne pourra plus être créée, modifiée ou supprimée. Tu pourras rouvrir si besoin, avec un motif.${warn}`, 'Clôturer', false)) return;
        const r = C.closePeriod(data, next.to, { at: Date.now(), by: deviceLabel() });
        if (r.error) return toast(r.error, true);
        save(true); draw(); updateNavCounts(); direAuCabinet(`${next.label} clôturé`, { action: 'cloture', until: next.to });
      };

      // `vise` : le dernier mois demandé par un autre écran (le paquet d'août propose « Clôturer
      // jusqu'à août 2026… » quand juin et juillet ne le sont pas encore — 10.14.0).
      const ouvrirJusqua = vise => {
        modal(`<h2>Clôturer jusqu'à…</h2>
          <p class="small">Tous les mois jusqu'à celui que tu choisis seront clôturés d'un coup.</p>
          <form id="ct" class="grid-2"><label class="field span-2">${lbl('Dernier mois à clôturer', 'clot.jusqua')}
            <select name="m">${months.map(m => `<option value="${m.to}"${m.to === vise ? ' selected' : ''}>${h(m.label)}</option>`).join('')}</select></label></form>
          <div id="ct-points" class="small annonce-stable encadre"></div>
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Clôturer</button></div>`,
          (root, close) => {
            // 10.14.0 — les points à régler se lisent AVANT le geste, sur TOUTE la période choisie (9.4.2) :
            // « Clôturer » d'un coup sautait les contrôles que le bouton du mois suivant montre.
            // TOUS les points, pas seulement les bloquants : « Rien à signaler du 01/06 au 31/08 »
            // s'affichait sur une période qui portait cinq achats sans justificatif et douze mouvements
            // non pointés — ceux que le paquet du même mois liste (10.14.0). L'encadré orange est gardé
            // pour ce qui bloque vraiment ; le reste se dit en clair, sans alarme.
            const points = () => {
              const to = $('select[name=m]', root).value;
              const tous = C.closureChecks(data, company(), next.from, to, { reserves: licence.reserves || [], sansPiecesJointes: bridge.piecesJointes === false });
              const dangers = tous.filter(c => c.level === 'danger');
              $('#ct-points', root).innerHTML = tous.length
                ? `<p class="${dangers.length ? 'warn-box' : ''}">${pl(tous.length, 'point')} à regarder du ${C.fmtDate(next.from)} au ${C.fmtDate(to)} : ${tous.map(c => h(c.label)).join(', ')}. Tu peux clôturer quand même.</p>`
                : `<p class="muted">Rien à signaler du ${C.fmtDate(next.from)} au ${C.fmtDate(to)}.</p>`;
            };
            $('select[name=m]', root).onchange = points;
            points();
            $('#ok', root).onclick = () => {
              const to = $('select[name=m]', root).value;
              const r = C.closePeriod(data, to, { at: Date.now(), by: deviceLabel() });
              close();
              if (r.error) return toast(r.error, true);
              save(true); draw(); updateNavCounts(); direAuCabinet('Clôturé jusqu\'au ' + C.fmtDate(to), { action: 'cloture', until: to });
            };
          });
      };
      if ($('#close-to')) $('#close-to').onclick = () => ouvrirJusqua('');
      // (1.301.0) Clôturer comme le cabinet a validé ; redire au cabinet la dernière clôture ou réouverture.
      if ($('#clot-aligner')) $('#clot-aligner').onclick = () => ouvrirJusqua(aligner);
      if ($('#clot-dire')) $('#clot-dire').onclick = () => ecrireAuComptable(texteClotureAuCabinet(log[0]));
      if (comptaState.clotJusqua) {
        const vise = comptaState.clotJusqua;
        comptaState.clotJusqua = '';
        if (months.some(m => m.to === vise) && vise !== (next && next.to)) ouvrirJusqua(vise);
      }

      if ($('#do-reopen')) $('#do-reopen').onclick = () => {
        const opts = C.closureLog(data).filter(e => e.action === 'cloture').map(e => e.previous).filter((v, i, a) => a.indexOf(v) === i);
        modal(`<h2>Rouvrir une période</h2>
          <p class="small">Les chiffres déjà envoyés à ton comptable vont changer. <strong>Préviens-le toi-même</strong> : ce motif reste dans le journal des clôtures, avec la date, mais il ne part pas chez lui.</p>
          <form id="rf" class="grid-2">
            ${dateFieldHtml(lbl('Rouvrir jusqu\'au (exclu)', 'clot.rouvrir'), 'until', opts[0] || '', { span: true })}
            <label class="field span-2">${lbl('Motif', 'clot.motif')}<input type="text" name="reason" placeholder="Facture d'achat retrouvée, erreur de montant…"></label>
            <label class="check span-2"><input type="checkbox" name="all"> Tout rouvrir (plus aucune période clôturée)</label>
          </form>
          <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-danger" id="ok">Rouvrir</button></div>`,
          (root, close) => {
            $('#ok', root).onclick = () => {
              const v = formValues($('#rf', root));
              const r = C.reopenPeriod(data, v.all ? '' : v.until, { at: Date.now(), by: deviceLabel(), reason: (v.reason || '').trim() });
              if (r.error) return toast(r.error, true);
              close(); save(true); draw(); updateNavCounts();
              direAuCabinet('Période rouverte', { action: 'reouverture', until: v.all ? '' : v.until, reason: (v.reason || '').trim() });
            };
          });
      };
    }

    // Le paquet mensuel : tout ce que le comptable attend, dans un fichier, vérifiable.
    // Avant de le fabriquer, on montre exactement ce qu'il contiendra — y compris ce qui manque.
    function drawCabinet() {
      const co = company();
      const months = (() => {
        // Les douze derniers mois terminés, le plus récent d'abord : c'est celui qu'on envoie.
        const out = [];
        let m = C.addMonths(C.today().slice(0, 7) + '-01', -1, 1).slice(0, 7);
        for (let i = 0; i < 12; i++) { out.push(m); m = C.addMonths(m + '-01', -1, 1).slice(0, 7); }
        return out;
      })();
      if (!cabinetState.month) cabinetState.month = months[0];
      const per = C.packPeriod(Number(cabinetState.month.slice(0, 4)), Number(cabinetState.month.slice(5, 7)));
      const aClore = C.closableMonths(data, C.today());
      const plan = C.packPlan(data, co, per, { device: deviceLabel(), reserves: licence.reserves || [] });
      const paired = co.cabinet && co.cabinet.publicKey ? co.cabinet : null;
      const sent = (data.packs || []).filter(x => x.month === per.month).sort((a, b) => (b.at || 0) - (a.at || 0));
      const history = (data.packs || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
      const cur = co.currency;
      const tt = plan.totaux;
      const moisVide = !(tt.pieces + tt.ventes + tt.achats + tt.encaissements + tt.bulletins);
      // 10.13.0 (test humain du pont) — l'étape suivante du mois, CALCULÉE (U-11). Répondre puis
      // cliquer le vert « Envoyer au comptable » joignait le paquet fabriqué AVANT la réponse : elle
      // n'arrivait jamais au cabinet, sous une phrase qui promettait « il n'y a rien d'autre à
      // envoyer ». Une question qui attend passe d'abord (la réponse partira dans CE paquet), une
      // réponse plus récente que le paquet le fait refaire, et seulement ensuite on l'envoie.
      const questions = data.questionsCabinet || [];
      const enAttente = questions.filter(q => !repondue(q));
      const nonParties = sent.length ? C.reponsesApres(questions, sent[0].at) : [];
      // 10.14.0 — les écritures du mois ne sont plus celles du dernier paquet fabriqué : une
      // réouverture, ou une version de SkanFact qui corrige un calcul. Le comptable travaille sur
      // l'ancien paquet ; un paquet fabriqué ne se réécrit pas, il se refait — encore faut-il le DIRE.
      // (Un paquet d'avant la 10.14.0 n'a pas de sceau : on ne peut rien comparer, on ne dit rien.)
      const change = sent.length && sent[0].sceau ? C.ecartsSceau(sent[0].sceau, plan.sceau) : [];
      const suivante = moisVide ? '' : enAttente.length ? 'repondre'
        : !sent.length ? 'fabriquer' : nonParties.length || change.length ? 'refaire' : 'envoyer';

      // La plateforme (brique 44 bis) : plus de paquet — les livres sont au serveur, le cabinet les lit
      // en direct. L'onglet porte les questions du comptable, et dit à qui le dossier est confié.
      if (bridge.dessinerMandat) {
        const mandatPanneau = '<div class="panel" id="p-cabinet-mandat"><h2>Ton cabinet comptable</h2><div id="cab-pair"></div></div>';
        $('#c-body').innerHTML = (data.questionsCabinet || []).length ? `${panneauQuestions()}${mandatPanneau}`
          : `${mandatPanneau}${messagerieVue && messagerieVue.cabinet ? panneauQuestions() : ''}`;
        // (plateforme) 1.94.0 — venu du premier pas « Inviter mon comptable » : le curseur sur son adresse, et la page la montre.
        // L'adresse se dessine après la réponse du serveur (l'invitation en cours) : on l'attend trois secondes au plus.
        void bridge.dessinerMandat($('#cab-pair'));
        if (comptaState.versInvitation) {
          comptaState.versInvitation = false;
          const poser = n => {
            const champ = $('#mandat-email');
            if (champ) { champ.scrollIntoView({ block: 'center' }); champ.focus(); } else if (n > 0) setTimeout(() => poser(n - 1), 100);
          };
          poser(30);
        }
        $$('[data-rep]').forEach(b => b.onclick = () => repondreA(b.dataset.rep));
        return;
      }
      $('#c-body').innerHTML = `
        <div class="panel"><h2>Le paquet du mois ${info('cab.paquet')}</h2>
          <div class="inline mb">
            <select id="cab-month">${months.map(m => `<option value="${m}" ${m === cabinetState.month ? 'selected' : ''}>${h(C.monthLabel(m + '-01'))}</option>`).join('')}</select>
            ${moisVide ? '' : `<span class="badge ${plan.definitive ? 'b-paid' : 'b-due'}">${plan.definitive ? 'définitif — mois clôturé' : 'provisoire — mois non clôturé'}</span>`}
          </div>
          ${moisVide ? '' : plan.definitive
            ? '<p class="small muted">Ce mois est clôturé : le paquet est <b>définitif</b>. Ton comptable peut travailler dessus en sachant que rien ne bougera.</p>'
            : `<p class="small" style="background:var(--warning-soft);padding:10px 12px;border-radius:8px">
                 Ce mois n'est <b>pas clôturé</b> : le paquet partira marqué « provisoire ». Tu peux l'envoyer quand même — mais l'envoi qui compte est celui qui suit la clôture.
                 <a href="#" id="cab-goclose" class="warn-link">${aClore.length && aClore[0].to !== per.to && aClore.some(m => m.to === per.to) ? `Clôturer jusqu'à ${h(per.label)}…` : `Clôturer ${h(per.label)}`}</a></p>`}

          ${/* 10.12.0 — un mois sans pièce montrait un tableau de sept zéros et trois cartes à 0,000 DT,
               au-dessus d'un panneau qui dit « aucune pièce » : on ne compte pas au-dessus du vide (7.0.0). */''}
          ${moisVide ? '' : `<div class="dash-grid mt">
            <div>
              <table class="list compact"><thead><tr><th>Ce que contient le paquet</th><th class="r">Nombre</th></tr></thead><tbody>
                <tr><td>Pièces de vente émises (PDF joints)</td><td class="r">${plan.totaux.pieces}</td></tr>
                <tr><td>Lignes au journal des ventes</td><td class="r">${plan.totaux.ventes}</td></tr>
                <tr><td>Lignes au journal des achats</td><td class="r">${plan.totaux.achats}</td></tr>
                <tr><td>Justificatifs d'achat joints</td><td class="r">${plan.totaux.justificatifs}</td></tr>
                <tr><td>Encaissements clients</td><td class="r">${plan.totaux.encaissements}</td></tr>
                <tr><td>Bulletins de paie</td><td class="r">${plan.totaux.bulletins}</td></tr>
              </tbody></table>
              ${/* 10.13.0 — « Fichiers en tout : 15 » était posé en pied, sous une colonne qui additionne
                   14 et qui ne compte pas des fichiers (des lignes de journal, des encaissements) : un
                   total sous une colonne est lu comme sa somme (9.8.8). Le poids du paquet se DIT. */''}
              ${/* 10.14.0 — « 16 fichiers » annoncés, 17 comptés dans l'historique : la signature (9.2.0)
                   part avec chaque paquet et n'était pas comptée. La page de garde, le manifeste et
                   sa signature s'ajoutent aux fichiers du plan. */''}
              <p class="small muted mt">Le paquet fera ${pl(plan.entries.length + 3, 'fichier')} : les pièces en PDF, les journaux en CSV, la page de garde, le manifeste et sa signature.</p>
            </div>
            <div>
              <div class="stat"><div class="lbl">CA HT du mois</div><div class="val">${C.money(plan.ca, cur)}</div></div>
              <div class="stat"><div class="lbl">TVA collectée</div><div class="val">${C.money(plan.tvaCollectee, cur)}</div></div>
              <div class="stat"><div class="lbl">TVA déductible</div><div class="val">${C.money(plan.tvaDeductible, cur)}</div></div>
            </div>
          </div>`}
        </div>

        <div class="panel" id="p-manques"><h2>Ce qui manque ${info('cab.manques')}</h2>
          ${moisVide
            // « Rien à signaler : le dossier du mois est complet » était la SEULE alternative à une
            // liste de manques. Sur un mois sans une seule pièce, tous les compteurs valent zéro,
            // donc la liste est vide, donc l'application félicitait — en vert — quelqu'un qui n'a
            // rien fait, en annonçant neuf fichiers (cinq journaux vides, les écritures et la TVA)
            // et en armant le bouton d'envoi. Avant d'écrire une phrase rassurante, vérifier que
            // l'univers dont elle parle n'est pas vide.
            ? (() => {
                // La raison du vide, et le jour où ça changera : « émets une facture » à quelqu'un qui en
                // a émis en septembre l'envoie chercher ce qu'il a déjà fait (10.12.0).
                const suite = C.premierePieceApres(data, per.month + '-01');
                if (!suite) return `<p>Ce mois ne contient <b>aucune pièce</b> : il n'y a rien à envoyer à ton comptable.</p>
                  <p class="small muted">Choisis un autre mois en haut de la page, ou commence par émettre une facture.</p>
                  <div class="inline mt"><button class="btn btn-primary" id="cab-vers-factures">Aller aux factures</button></div>`;
                const moisSuite = suite.slice(0, 7);
                const pret = months.includes(moisSuite);
                return `<p>Ce mois ne contient <b>aucune pièce</b> : il n'y a rien à envoyer à ton comptable.</p>
                  <p class="small muted">Tes pièces commencent en ${h(C.monthLabel(moisSuite + '-01'))}. ${pret
                    ? 'Ce mois-là est terminé : son paquet est prêt à être préparé.'
                    : `Un paquet se prépare une fois le mois terminé : celui de ${h(C.monthLabel(moisSuite + '-01'))} le sera à partir du ${h(C.fmtDate(C.addMonths(moisSuite + '-01', 1, 1)))}.`}</p>
                  ${pret ? `<div class="inline mt"><button class="btn btn-primary" id="cab-vers-mois" data-mois="${h(moisSuite)}">Voir ${h(C.monthLabel(moisSuite + '-01'))}</button></div>` : ''}`;
              })()
            : plan.checklist.length
            ? `<table class="list compact"><tbody>${plan.checklist.map(c => `<tr class="${c.level === 'danger' ? 'row-warn' : ''}">
                <td><strong>${h(c.label)}</strong><div class="small muted">${h(c.detail)}</div></td><td class="r nw">${c.count}</td>
                <td class="r nw">${actionDeControle(c.id) ? `<button class="btn btn-sm" data-check="${h(c.id)}">${h(actionDeControle(c.id).label)}</button>` : ''}</td></tr>`).join('')}</tbody></table>
               <p class="small muted mt">Ces points figureront sur la page de garde du paquet. Le comptable saura quoi te réclamer — c'est mieux qu'un dossier qu'il croit complet.</p>`
            : '<p class="small" style="color:var(--primary)">Rien à signaler : le dossier du mois est complet.</p>'}
        </div>

        ${/* Les réponses partent DANS le paquet : quand il y a des questions, elles viennent avant lui. */''}
        ${questions.length ? panneauQuestions() : ''}

        <div class="panel" id="p-envoyer"><h2>Fabriquer et envoyer ${info('cab.envoyer')}</h2>
          ${paired
            ? `<p class="small" style="background:var(--primary-soft);padding:10px 12px;border-radius:8px">
                 Le paquet sera <b>chiffré pour ${h(paired.name || 'ton cabinet')}</b> (empreinte ${h(paired.fingerprint || '')}).
                 Lui seul pourra l'ouvrir : aucun mot de passe à transmettre. ${info('cab.pourcabinet')}</p>`
            : `<label class="check mb"><input type="checkbox" id="cab-seal" ${cabinetState.seal ? 'checked' : ''}> Protéger le paquet par un mot de passe ${info('cab.motdepasse')}</label>
               <div id="cab-pw" ${cabinetState.seal ? '' : 'hidden'} class="mb">
                 <input type="password" id="cab-pwv" placeholder="Mot de passe convenu avec ton comptable" style="max-width:340px">
                 <div class="small muted">Transmets-le-lui par un autre canal que le fichier : par téléphone, pas dans le même mail.
                   Mieux : demande-lui son fichier d'appairage et importe-le dans <a href="#" id="cab-gopair" class="warn-link">Paramètres → Envois → Ton cabinet comptable</a>.</div>
               </div>`}
          ${/* 10.13.0 (U-11, test humain du pont) — le vert suit `suivante` : fabriquer, puis envoyer ; mais
               refaire d'abord quand une réponse est plus récente que le paquet, et répondre avant tout. */''}
          ${suivante === 'repondre' ? `<p class="small muted mb">${h(pl(enAttente.length, 'question de ton comptable attend', 'questions de ton comptable attendent'))} ta réponse, plus haut :
            réponds d'abord, ${enAttente.length > 1 ? 'tes réponses partiront' : 'ta réponse partira'} dans ce paquet.</p>` : ''}
          ${suivante === 'refaire' && nonParties.length ? `<div class="warn-box mb">Tu as répondu à ton comptable après avoir fabriqué ce paquet :
            ${nonParties.length > 1 ? 'tes réponses n\'y sont pas' : 'ta réponse n\'y est pas'}. Un paquet fabriqué ne se réécrit pas — refais-le avant de l'envoyer.</div>` : ''}
          ${change.length ? `<div class="warn-box mb" id="cab-change">Les écritures de ${h(per.label)} ne sont plus celles du paquet fabriqué le ${h(C.fmtDate(C.jourDeLInstant(sent[0].at)))} :
            ${change.slice(0, 4).map(x => `compte ${h(x.account)}, ${[0, 1].filter(i => Math.abs(x.avant[i] - x.maintenant[i]) > 0.0005)
              .map(i => `${i ? 'crédit' : 'débit'} ${C.money(x.avant[i], company().currency)} → ${C.money(x.maintenant[i], company().currency)}`).join(', ')}`).join(' ; ')}${change.length > 4 ? ` — et ${pl(change.length - 4, 'autre compte', 'autres comptes')}` : ''}.
            Ton comptable travaille sur l'ancien : refais le paquet et renvoie-le-lui.</div>` : ''}
          <div class="inline">
            <button class="btn ${suivante === 'fabriquer' || suivante === 'refaire' ? 'btn-primary' : ''}" id="cab-build" ${moisVide ? 'disabled title="Ce mois ne contient aucune pièce."' : ''}>${!sent.length ? 'Fabriquer le paquet…'
              : nonParties.length ? `Refaire le paquet avec ${nonParties.length > 1 ? 'tes réponses' : 'ta réponse'}…` : 'Refaire le paquet…'}</button>
            ${sent.length ? `<button class="btn ${suivante === 'envoyer' ? 'btn-primary' : ''}" id="cab-mail">Envoyer au comptable…</button>` : ''}
          </div>
          <div id="cab-prog" class="small muted mt" hidden></div>
        </div>

        ${questions.length ? '' : panneauQuestions()}

        <div class="panel" id="p-paquets"><h2>Ce qui a déjà été envoyé ${info('cab.historique')}</h2>
          ${history.length
            ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Mois</th><th>Fabriqué le</th><th>État</th><th class="r">Fichiers</th><th class="r">Taille</th><th>Empreinte</th><th></th></tr></thead><tbody>
                ${history.map(x => `<tr><td class="nw"><strong>${h(C.monthLabel(x.month + '-01'))}</strong></td>
                  <td class="nw small">${x.at ? C.fmtDate(C.jourDeLInstant(x.at)) : ''}</td>
                  <td><span class="badge ${x.definitive ? 'b-paid' : 'b-due'}">${x.definitive ? 'définitif' : 'provisoire'}</span>${x.cabinet ? ' <span class="small muted">pour le cabinet</span>' : x.sealed ? ' <span class="small muted">chiffré</span>' : ''}</td>
                  <td class="r">${x.files || ''}</td><td class="r nw">${x.bytes ? (x.bytes / 1048576).toFixed(1).replace('.', ',') + ' Mo' : ''}</td>
                  <td class="small muted mono">${h(String(x.digest || '').slice(0, 12))}</td>
                  <td class="actions"><button class="btn btn-sm" data-reveal="${h(x.path || '')}" ${x.path ? '' : 'disabled title="Paquet fabriqué avant cette version : son chemin n\'a pas été gardé."'}>Montrer le fichier</button></td></tr>`).join('')}
              </tbody></table></div>
               <p class="small muted mt">L'empreinte est la carte d'identité du paquet : si ton comptable obtient la même, le fichier qu'il a reçu est bien celui que tu as envoyé, à l'octet près.</p>`
            : '<div class="empty mini">Aucun paquet fabriqué pour l\'instant : chaque paquet s\'inscrira ici, avec son empreinte.</div>'}
        </div>`;

      // ---------------------------------------------- les questions du comptable (9.10.0)
      //
      // Elles arrivent par un fichier `.skanask`, s'affichent ici ET en face de la pièce qu'elles
      // visent, et les réponses repartent dans le paquet suivant — jamais dans un envoi à part,
      // qu'on oublierait. Rien ici ne touche à un chiffre.
      function panneauQuestions() {
        const qs = (data.questionsCabinet || []).slice()
          .sort((a, b) => Number(!!repondue(a)) - Number(!!repondue(b)) || Number(b.recueLe || 0) - Number(a.recueLe || 0));
        const bloquees = C.questionsSansReponse(data.questionsCabinet || []);
        const attendu = id => (C.QUESTION_ATTENDUS.find(x => x.id === id) || {}).label || 'Une explication';
        return `<div class="panel" id="p-questions"><h2>Les questions de ton comptable ${info('cab.questions')}</h2>
          ${bloquees.length ? `<div class="warn-box grave mb">${h(pl(bloquees.length, 'question t\'a été envoyée', 'questions t\'ont été envoyées'))} deux fois sans réponse.
            Tant qu'${bloquees.length > 1 ? 'elles restent' : 'elle reste'} en l'air, ton comptable ne peut pas arrêter ton mois.</div>` : ''}
          ${qs.length
            ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Pièce</th><th>La question</th><th>Attendu</th><th>Reçue</th><th>Réponse</th><th></th></tr></thead><tbody>
                ${qs.map((q, i) => `<tr class="${!repondue(q) && (Number(q.recues) || 0) >= C.QUESTION_RELANCE ? 'row-warn' : ''}">
                  <td class="nw">${q.piece ? `<strong>${lienPiece(q.piece)}</strong>` : '<span class="muted">—</span>'}
                    ${q.compte ? `<div class="small muted">${h(q.compte)} ${h(q.libelleCompte || '')}</div>` : ''}</td>
                  <td>${h(q.objet || '')}<div class="small">${h(C.typoFr(q.texte))}</div></td>
                  <td class="nw small">${h(attendu(q.attendu))}</td>
                  <td class="nw small">${(Number(q.recues) || 0) > 1 ? `<span class="badge b-late">${h(pl(Number(q.recues), 'fois', 'fois'))}</span>` : '<span class="muted">1 fois</span>'}</td>
                  <td>${repondue(q)
                    ? `<span class="badge b-paid">répondue</span><div class="small">${h(C.typoFr(q.reponse.texte || ''))}</div>`
                    : '<span class="badge b-due">sans réponse</span>'}</td>
                  <td class="actions r nw"><button class="btn btn-sm${suivante === 'repondre' && i === 0 ? ' btn-primary' : ''}" data-rep="${h(q.id)}">${repondue(q) ? 'Corriger ma réponse' : 'Répondre'}</button></td></tr>`).join('')}
              </tbody></table></div>
              <p class="small muted mt">Ton comptable lit tes réponses dès que tu les enregistres : il n'y a rien d'autre à envoyer.</p>`
            : `<div class="empty mini">Aucune question reçue. Quand ton comptable a besoin d'une pièce ou d'une explication,
               sa question arrive ici d'elle-même, et en face de la pièce qu'elle vise.</div>`}

        </div>`;
      }
      $$('[data-rep]').forEach(b => b.onclick = () => repondreA(b.dataset.rep));
      if ($('#q-import')) $('#q-import').onclick = () => importerQuestions();

      async function importerQuestions(motDePasse) {
        let lu;
        try { lu = await bridge.lireQuestions({ motDePasse }); }
        catch (e) {
          // Un fichier scellé n'est pas une panne : c'est le cas normal quand le comptable a choisi
          // un mot de passe. On le demande au lieu d'afficher du rouge (règle 8.0.1).
          if (codeErreur(e) === 'ERR-ENT-084' && !motDePasse) {
            promptDialog('Le mot de passe de l\'envoi de questions',
              'Ton comptable te le dit au téléphone, jamais dans le même mail que le fichier.', '',
              v => { if (v) importerQuestions(v); }, 'password', { champ: 'Mot de passe', ok: 'Ouvrir le fichier' });
            return;
          }
          return toast(plainError(e), true);
        }
        if (!lu) return;
        const v = C.questionsValides(lu.envoi, { matricule: company().taxId });
        if (!v.ok) return toast(v.motifs[0], true);
        const orig = await origineAcceptee(lu, 'Envoi de questions');
        if (!orig) return;
        const ok = await confirmDialog(
          `Reprendre ${pl(v.questions, 'question')} de ton comptable ?\n\n`
          + (v.questions > 1 ? '• Elles s\'afficheront en face des pièces qu\'elles visent.\n' : '• Elle s\'affichera en face de la pièce qu\'elle vise.\n')
          + '• Aucun de tes chiffres ne change : une question est une demande, pas une écriture.\n'
          + `• ${orig.ligne}`,
          'Reprendre les questions', !!orig.alerte);
        if (!ok) return;
        retenirSignature(orig);
        const r = C.fusionnerQuestionsRecues(data.questionsCabinet || [], lu.envoi, Date.now());
        data.questionsCabinet = r.liste;
        save(true);
        toast(`${pl(r.nouvelles, 'question reçue', 'questions reçues')}${r.revues ? `, ${pl(r.revues, 'déjà connue', 'déjà connues')}` : ''}`);
        draw(); updateNavCounts();
      }
      $('#cab-month').onchange = e => { cabinetState.month = e.target.value; draw(); };
      if ($('#cab-vers-mois')) $('#cab-vers-mois').onclick = e => { cabinetState.month = e.currentTarget.dataset.mois; draw(); };
      // Le lien dit ce que le clic fera (7.29.0) : « Clôturer août 2026 » menait à une page qui
      // proposait de clôturer juin. Quand des mois d'avant restent ouverts, il ouvre la fenêtre
      // « Clôturer jusqu'à… » sur ce mois-ci, avec les points à régler de toute la période.
      if ($('#cab-goclose')) $('#cab-goclose').onclick = e => { e.preventDefault(); comptaState.tab = 'clotures'; comptaState.clotJusqua = per.to; draw(); $$('#c-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'clotures')); };
      if ($('#cab-seal')) $('#cab-seal').onchange = e => { cabinetState.seal = e.target.checked; $('#cab-pw').hidden = !e.target.checked; };
      if ($('#cab-gopair')) $('#cab-gopair').onclick = e => { e.preventDefault(); allerParametres('envois', 'p-cabinet'); };

      if ($('#cab-vers-factures')) $('#cab-vers-factures').onclick = () => navigate('#/factures');
      // L'historique donnait l'empreinte du paquet et jamais son emplacement : six semaines plus
      // tard, le comptable réclame « le fichier de mars » et rien ne dit où il est. Le chemin était
      // pourtant enregistré depuis la 6.1.0 — il n'était affiché nulle part.
      $$('[data-reveal]').forEach(b2 => { if (b2.dataset.reveal) b2.onclick = () => bridge.showInFolder(b2.dataset.reveal); });
      // Chaque manque mène aux pièces concernées, filtrées. Le `if` n'est pas une précaution : la
      // table est complète par construction, et un test le vérifie contre `core.packChecklist`.
      $$('[data-check]').forEach(b => b.onclick = () => actionDeControle(b.dataset.check).run(plan.checklist.find(c => c.id === b.dataset.check)));
      $('#cab-build').onclick = async () => {
        // Les contrôles de saisie d'abord, la grande question ensuite : poser une question de fond
        // puis refuser sur un champ trop court, c'est faire répondre pour rien.
        const pw = (!paired && cabinetState.seal) ? ($('#cab-pwv').value || '').trim() : '';
        if (!paired && cabinetState.seal && pw.length < 6) return refus('#cab-pwv', 'Choisis un mot de passe d\'au moins six caractères.');
        if (await demoBlock('Fabriquer le paquet du comptable')) return;
        if (!plan.definitive && !await confirmDialog(`${per.label} n'est pas clôturé : le paquet partira marqué « provisoire » et pourra encore changer.\n\nFabriquer quand même ?`, 'Fabriquer', false, { titre: 'Un paquet provisoire' })) return;

        // Le HTML de chaque pièce est produit ici : c'est le renderer qui sait dessiner un document.
        const entries = plan.entries.map(e => {
          if (e.kind === 'pdf') {
            const d = docById(e.docId);
            return d ? { ...e, html: C.documentHtml(d, clientById(d.clientId), co, { stampText: stampFor(d) }) } : e;
          }
          if (e.kind === 'payslip') {
            const sl = (data.payslips || []).find(x => x.id === e.slipId);
            return sl ? { ...e, html: C.payslipHtml(sl, data, co, {}) } : e;
          }
          return e;
        });
        const cover = C.packCoverHtml(plan, co, { version: $('#app-version').textContent, at: C.fmtDate(C.today()) });

        const prog = $('#cab-prog');
        prog.hidden = false; prog.textContent = 'Préparation…';
        const off = bridge.onPackProgress(d => { prog.textContent = `${d.done} / ${d.total} — ${d.label}`; });
        try {
          const r = await bridge.buildPack({
            plan: { manifest: plan.manifest, entries },
            coverHtml: cover, password: pw, cabinetKey: paired ? paired.publicKey : '',
            suggestedName: C.packFileName(co, per, plan.definitive)
          });
          prog.hidden = true;
          if (!r) return;
          data.packs = (data.packs || []).concat([{
            id: C.uid(), month: per.month, at: Date.now(), definitive: plan.definitive,
            sealed: !!r.chiffre, cabinet: r.pourCabinet || '', files: r.fichiers, bytes: r.octets, digest: r.empreinte,
            path: r.path, missing: (r.absents || []).length,
            // Combien de réponses le paquet emporte : le mail d'envoi le dit, et c'est ce que le
            // comptable cherche en l'ouvrant quand il a posé une question.
            reponses: C.reponsesAEnvoyer(data.questionsCabinet || []).length,
            // Le résumé des écritures envoyées (10.14.0) : c'est lui qui dira, un mois plus tard,
            // que ce mois a changé depuis que le comptable l'a reçu.
            sceau: plan.sceau
          }]);
          save(true);
          const warn = (r.absents || []).length ? ` ${pl(r.absents.length, 'fichier')} n'${r.absents.length > 1 ? 'ont' : 'a'} pas pu être joint${sPl(r.absents.length)} (voir le manifeste).` : '';
          toast(`Paquet créé : ${r.path.split(/[\\/]/).pop()}${warn}`);
          draw();
        } catch (err) {
          prog.hidden = true;
          toast('Fabrication impossible : ' + (err.message || err), true);
        } finally { if (typeof off === 'function') off(); }
      };

      if ($('#cab-mail')) $('#cab-mail').onclick = async () => {
        if (await demoBlock('Envoyer le paquet au comptable')) return;
        if (!await messagerie()) return;
        const last = sent[0];
        const to = co.accountantEmail || '';
        bridge.composeMail({
          to, subject: `${co.name || ''} — comptabilité ${per.label}${last.definitive ? '' : ' (provisoire)'}`,
          body: `Bonjour,\n\nVoici le dossier de ${per.label}.\n\n`
            + `${last.definitive ? 'Le mois est clôturé : ces chiffres ne bougeront plus.' : 'Le mois n\'est pas encore clôturé : ce dossier est provisoire.'}\n`
            + `Le paquet contient les journaux, les pièces en PDF, les justificatifs d'achat et la page de garde.\n`
            + (last.reponses ? `Il porte aussi ${last.reponses > 1 ? 'mes réponses à tes questions' : 'ma réponse à ta question'}.\n` : '')
            + (last.cabinet ? 'Il est chiffré pour ta clé (empreinte ' + last.cabinet + ') : toi seul peux l\'ouvrir.\n'
               : last.sealed ? 'Il est protégé par le mot de passe convenu — je te le donne par téléphone.\n' : '')
            + `\nEmpreinte du manifeste : ${String(last.digest || '').slice(0, 16)}\n\nBien à toi,\n${co.name || ''}`,
          attachments: [last.path], mode: modeEnvoi()
        }).then(r => emailComptablePret(to, r, 'le paquet'));
      };
    }

    // Là où se PRÉPARE chaque échéance. Une règle sans écran ne porte pas de bouton : mieux vaut
    // rien qu'un bouton qui mène au hasard.
    const FISCAL_VERS = {
      tva: echeance => {
        // (plateforme, lot débutant) L'échéance du 28/10 déclare septembre ; « Préparer » ouvrait octobre.
        if (echeance) {
          const y = Number(echeance.slice(0, 4)), m = Number(echeance.slice(5, 7));
          comptaState.year = String(m === 1 ? y - 1 : y); comptaState.month = String(m === 1 ? 12 : m - 1).padStart(2, '0');
          if ($('#c-year')) $('#c-year').value = comptaState.year;
          if ($('#c-month')) $('#c-month').value = comptaState.month;
        }
        comptaState.tab = 'tva'; draw(); $$('#c-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tva'));
      },
      // (17 § 3.3, lot P1b) La CNSS et la déclaration d'employeur : le Personnel dit où elles se préparent.
      ...Object.fromEntries(Socle.lire('declarations-sociales').map(d => [d.id, d.preparer]))
    };
    function drawFiscal() {
      const rules = C.fiscalDeadlines(data);
      // En retard d'abord, puis ce qui arrive : une déclaration sociale jamais déposée ne sortait plus
      // du calendrier une fois sa date passée (10.14.0).
      const up = C.calendrierFiscal(data, C.today(), 120);
      // Une échéance marquée déposée quitte « Ce qui arrive » sur-le-champ. Le « Annuler » du
      // bandeau dure huit secondes ; passé ce délai, l'occurrence pointée par erreur n'était plus
      // NULLE PART, et le seul recours restant était de désactiver la règle — donc de perdre aussi
      // l'échéance suivante. C'est la règle de la 7.17.0 (« un verdict qui vit deux secondes n'est
      // pas un verdict »), jamais portée ici : le panneau qui suit rend le geste relisible.
      // L'identifiant est `règle@date` : on le redécoupe pour nommer la ligne.
      const deposees = (data.fiscalFilings || []).slice().sort((a2, b2) => (b2.at || 0) - (a2.at || 0)).map(f => {
        const [ruleId, date] = String(f.id).split('@');
        const r = rules.find(x => x.id === ruleId);
        return { id: f.id, at: f.at, date, label: r ? r.label : ruleId, sociale: false };
      }).concat((data.socialFilings || []).slice().sort((a2, b2) => String(b2.filedAt || '').localeCompare(String(a2.filedAt || ''))).map(f => ({
        // La CNSS et la déclaration d'employeur se pointent dans la Paie OU ici : c'est la même
        // mention (10.12.0), donc elle se relit et se retire des deux endroits.
        // Son échéance se connaît : elle suit la même règle que la Paie (10.14.0 — « — » avant).
        id: f.id, at: f.filedAt ? Date.parse(f.filedAt + 'T12:00:00Z') : 0, date: C.dateLimiteDeclarationSociale(data, f.id), label: f.label || f.id, sociale: true
      })));
      const attente = x => `${x.label} porte sur une période qui se termine le ${C.fmtDate(x.fin)} : on la marque déposée une fois la période terminée, sinon il manquerait ses derniers bulletins.`;
      // (1.301.0) Le cabinet tient les déclarations : ce qu'il a déposé (le, la référence), ce qui attend, ce qui est en retard,
      // lu dans ses livres. Le calendrier ne savait rien de son dépôt : la TVA de septembre, déposée par le cabinet le 27/10,
      // n'y était nulle part, et « Marquer déposée » attendait un geste que le client n'avait pas à faire.
      const anneeCab = C.today().slice(0, 4);
      const cabDecl = !!(messagerieVue && messagerieVue.cabinet && messagerieVue.declarationsConfiees);
      const livresOk = cabDecl && livresCabinetLus && !livresCabinetLus.enCours && livresCabinetLus.annee === Number(anneeCab);
      const lignesCab = livresOk && !livresCabinetLus.illisible ? C.declarationsDuCabinet(data, company(), anneeCab, livresCabinetLus.declarations, C.today()) : [];
      const parPeriodeCab = new Map(lignesCab.map(x => [x.periode, x]));
      const periodeDeLEcheance = iso => { const [y, m] = String(iso).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
      const etatCab = x => (x.deposee ? `<span class="ok-text">Déposée le ${h(C.fmtDate(x.deposee.le))}</span>${x.deposee.reference ? ` <span class="small muted">réf. ${h(x.deposee.reference)}</span>` : ''}${x.ecarts.length ? '<div class="small warn-text">tes pièces du mois ont changé depuis</div>' : ''}`
        : x.retard ? `<span class="badge retard">en retard</span> <span class="small">${x.preparee ? 'préparée, pas encore déposée' : 'pas encore préparée'}</span>`
        : `<span class="small">${x.preparee ? 'préparée, pas encore déposée' : 'à préparer'}</span>`);
      const panneauCabinet = !cabDecl ? '' : `<div class="panel" id="p-decl-cabinet"><h2>Tes déclarations de TVA, chez ton cabinet ${info('compta.cabinetDecl')}</h2>
          ${!livresOk ? '<p class="small muted">Lecture des livres de ton cabinet…</p>'
            : livresCabinetLus.illisible ? '<p class="small muted">Les déclarations de ton cabinet ne se lisent pas d\'ici pour l\'instant (pas de réseau, ou pas le droit de lire les livres) : le calendrier ci-dessous reste le tien.</p>'
            : !lignesCab.length ? `<p class="small muted">Aucun mois terminé à déclarer en ${h(anneeCab)} pour l'instant.</p>`
            : `<div class="scroll-x"><table class="list compact" id="decl-cabinet"><thead><tr><th>Mois</th><th>Date limite</th><th>Chez ton cabinet</th><th></th></tr></thead><tbody>
              ${lignesCab.map(x => `<tr data-periode="${h(x.periode)}" class="${x.retard ? 'row-warn' : ''}"><td><strong>${h(x.label)}</strong></td><td class="nw">${h(C.fmtDate(x.limite))}</td><td>${etatCab(x)}</td>
                <td class="actions">${x.ecarts.length ? `<button class="btn btn-sm" data-decl-voir="${h(x.periode)}">Voir la TVA</button>` : !x.deposee ? `<button class="btn btn-sm" data-decl-ecrire="${h(x.periode)}">Lui écrire</button>` : ''}</td></tr>`).join('')}
            </tbody></table></div><p class="small muted mt">Ton cabinet dépose ces déclarations : son dépôt s'affiche ici de lui-même, tu n'as rien à pointer. <em>À VÉRIFIER avec ton comptable</em> pour les dates limites.</p>`}
        </div>`;
      // La ligne « tva » de « Ce qui arrive » quand le cabinet dépose : son dépôt s'il est fait, sinon « Ton cabinet la dépose » ;
      // le client garde la main (« Je l'ai déposée moi-même »).
      const actionEcheance = x => {
        const cab = cabDecl && x.id === 'tva' ? parPeriodeCab.get(periodeDeLEcheance(x.date)) || null : null;
        if (cab && cab.deposee) return `<span class="ok-text small">Déposée par ton cabinet le ${h(C.fmtDate(cab.deposee.le))}</span>`;
        const prep = FISCAL_VERS[x.id] ? `<button class="btn btn-sm btn-ghost" data-fvers="${h(x.id)}" data-fdate="${h(x.date)}">Préparer</button>` : '';
        if (cabDecl && x.id === 'tva') return `<span class="small muted">Ton cabinet la dépose</span> <button class="btn btn-sm btn-ghost" data-fdone="${h(x.filingId)}" data-fsoc="" data-flab="${h(x.label)}"${x.enCours ? ` disabled title="${h(attente(x))}"` : ''}>Je l'ai déposée moi-même</button>`;
        return `${prep}<button class="btn btn-sm" data-fdone="${h(x.filingId)}" data-fsoc="${h(x.socialId || '')}" data-flab="${h(x.label)}"${x.enCours ? ` disabled title="${h(attente(x))}"` : ''}>Marquer déposée</button>`;
      };
      $('#c-body').innerHTML = `
        ${panneauCabinet}
        <div class="panel"><h2>Ce qui arrive ${info('compta.fiscal')}</h2>
          ${up.length ? `<table class="list compact"><thead><tr><th>Échéance</th><th>Date</th><th class="r">Dans</th><th></th></tr></thead><tbody>
            ${up.map(x => `<tr class="${x.retard || (x.days <= 7 && !x.enCours) ? 'row-warn' : ''}"><td><strong>${h(x.label)}</strong>${x.note ? `<div class="small muted">${h(x.note)}</div>` : ''}${x.enCours ? `<div class="small muted">Déposable après le ${C.fmtDate(x.fin)}, une fois la période terminée.</div>` : ''}${x.retard ? `<div class="small">${x.id === 'cnss' ? 'Cotisations du trimestre' : 'Retenues de l\'année'} : ${C.money(x.amount, company().currency)}. Pas encore marquée déposée : si tu l'as déjà fait, marque-la ; sinon, dépose-la au plus vite.</div>` : ''}</td>
              <td class="nw">${C.fmtDate(x.date)}</td><td class="r nw">${x.retard ? `<span class="badge retard">en retard de ${pl(-x.days, 'jour')}</span>` : x.days === 0 ? "aujourd'hui" : x.days + ' j'}</td>
              <td class="actions">${actionEcheance(x)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">Aucune échéance activée. Active celles qui te concernent ci-dessous.</div>'}
          <p class="small muted mt"><em>À VÉRIFIER avec ton comptable :</em> les dates limites, la périodicité et les déclarations qui te concernent dépendent de ta forme juridique, de ton régime fiscal et de la présence de salariés. Ce calendrier est un pense-bête que tu règles toi-même, pas une source officielle.</p>
        </div>
        ${deposees.length ? `<div class="panel"><h2>Déjà déposées</h2>
          <p class="small muted mb">Ce que tu as marqué comme déposé. Le « Annuler » du bandeau ne dure que quelques
          secondes : c'est ici qu'on revient sur une échéance pointée par erreur, un mois plus tard.</p>
          <table class="list compact"><thead><tr><th>Déclaration</th><th>Échéance</th><th>Marquée le</th><th></th></tr></thead><tbody>
            ${deposees.map(f => `<tr><td><strong>${h(f.label)}</strong></td><td class="nw">${h(f.date ? C.fmtDate(f.date) : '—')}</td>
              <td class="nw small muted">${f.at ? h(new Date(f.at).toLocaleDateString('fr-FR')) : '—'}</td>
              <td class="r"><button class="btn btn-sm" data-fundo="${h(f.id)}" data-fsoc="${f.sociale ? '1' : ''}" data-flab="${h(f.label)}">Retirer « déposée »</button></td></tr>`).join('')}
          </tbody></table></div>` : ''}
        <div class="panel"><h2>Les échéances et leur réglage</h2>
          <table class="list compact"><thead><tr><th>Déclaration</th><th>Périodicité</th><th class="r" style="width:110px">Jour limite</th><th style="width:90px">Active</th></tr></thead><tbody>
            ${rules.map(r => `<tr><td><strong>${h(r.label)}</strong>${r.note ? `<div class="small muted">${h(r.note)}</div>` : ''}</td>
              <td class="small">${r.every === 'month' ? 'chaque mois' : r.every === 'year' ? `une fois par an (${MONTHS[(Number(r.month) || 1) - 1]})` : `${(r.months || []).map(m => MONTHS[m - 1]).join(', ')}`}</td>
              <td class="r"><input type="number" class="num" data-day="${h(r.id)}" value="${Number(r.day) || 28}" min="1" max="31"></td>
              <td><label class="check"><input type="checkbox" data-active="${h(r.id)}" ${r.active !== false ? 'checked' : ''}></label></td></tr>`).join('')}
          </tbody></table>
        </div>`;
      const setRule = (id, patch) => {
        const list = Array.isArray(data.fiscalDeadlines) ? data.fiscalDeadlines.slice() : [];
        const i = list.findIndex(x => x.id === id);
        if (i >= 0) list[i] = { ...list[i], ...patch }; else list.push({ id, ...patch });
        data.fiscalDeadlines = list; save(true);
      };
      // Une échéance restait rouge après le dépôt : le calendrier ne savait pas ce qu'on avait fait,
      // et le seul recours était de désactiver la règle — donc de perdre l'échéance suivante.
      // « Marquer déposée » pointe une OCCURRENCE, et laisse un « Annuler » (règle de la 7.12.0).
      // La CNSS et la déclaration d'employeur se pointent sur la déclaration de la Paie (une seule
      // mention pour les deux écrans, 10.12.0) ; les autres échéances, sur leur occurrence.
      $$('[data-fdone]').forEach(b => b.onclick = () => {
        const id = b.dataset.fdone, soc = b.dataset.fsoc;
        if (soc) data.socialFilings = (data.socialFilings || []).concat([{ id: soc, filedAt: C.today(), label: b.dataset.flab }]);
        else data.fiscalFilings = (data.fiscalFilings || []).concat([{ id, at: Date.now() }]);
        save(true); draw();
        toastUndo(`${b.dataset.flab} marquée déposée`, () => {
          if (soc) data.socialFilings = (data.socialFilings || []).filter(f => f.id !== soc);
          else data.fiscalFilings = (data.fiscalFilings || []).filter(f => f.id !== id);
          save(true); draw();
        });
      });
      // (plateforme, 16 § 10.1-6 ; 17 lot P1b) Une déclaration sociale passe par le Personnel, qui remplit le point
      // « declarations-sociales » : payée, la question dit que le paiement part.
      const retirerSociale = (id, label, apres) => { const d = Socle.lire('declarations-sociales').find(x => x.retirer); return d && d.retirer(id, label, apres); };
      $$('[data-fundo]').forEach(b => b.onclick = () => {
        const id = b.dataset.fundo;
        if (b.dataset.fsoc) return retirerSociale(id, b.dataset.flab, draw);
        data.fiscalFilings = (data.fiscalFilings || []).filter(f => f.id !== id);
        save(true); draw();
        toast(`${b.dataset.flab} n'est plus marquée déposée`);
      });
      // Et chaque échéance mène à l'écran où on la prépare : la TVA du mois, les déclarations de paie.
      $$('[data-fvers]').forEach(b => b.onclick = () => FISCAL_VERS[b.dataset.fvers](b.dataset.fdate));
      // (1.301.0) Les déclarations du cabinet : la TVA d'un mois dont les pièces ont changé depuis le dépôt ; un mot au cabinet.
      $$('[data-decl-voir]').forEach(b => b.onclick = () => {
        const per = b.dataset.declVoir;
        comptaState.tab = 'tva'; comptaState.year = per.slice(0, 4); comptaState.month = per.slice(5, 7);
        if ($('#c-month')) $('#c-month').value = comptaState.month;
        draw();
      });
      $$('[data-decl-ecrire]').forEach(b => b.onclick = () => {
        const x = parPeriodeCab.get(b.dataset.declEcrire);
        if (x) ecrireAuComptable(`Bonjour, où en est ma déclaration de TVA ${deMois(x.label)} ? ${x.retard ? `La date limite était le ${C.fmtDate(x.limite)}.` : `Elle est à déposer d'ici le ${C.fmtDate(x.limite)}.`}`);
      });
      $$('[data-active]').forEach(c => c.onchange = () => { setRule(c.dataset.active, { active: c.checked }); draw(); });
      $$('[data-day]').forEach(i => i.onchange = () => { setRule(i.dataset.day, { day: Math.min(31, Math.max(1, Number(i.value) || 28)) }); draw(); });
    }

    const tagOf = () => comptaState.month ? `${comptaState.year}-${comptaState.month}` : comptaState.year;
    const resetPages = () => { comptaState.journal.page = 1; comptaState.pays.page = 1; comptaState.buys.page = 1; comptaState.decs.page = 1; };
    $('#c-year').onchange = e => { comptaState.year = e.target.value; resetPages(); draw(); };
    $('#c-month').onchange = e => { comptaState.month = e.target.value; resetPages(); draw(); };
    // La porte mène à LA CASE, pas à la page qui mène à la page qui la contient. Les Paramètres
    // n'en portent qu'un bouton (« Choisir les modules affichés… ») : y envoyer ferait deux clics
    // de plus pour trouver une ligne au milieu de dix-neuf. `pageFocus` amène la ligne à l'écran et
    // la marque une seconde et demie — c'est la règle « un raccourci vise un PANNEAU » (7.18.0).
    if ($('#c-plus')) $('#c-plus').onclick = vers('#/modules', () => { pageFocus = 'sm-compta-livres'; });
    $$('#c-tabs button[data-tab]').forEach(b => b.onclick = () => {
      // LA porte de l'option, ici et nulle part ailleurs (SPEC-UI-ENT-002). Le cadenas se voit
      // AVANT le clic : un onglet qui refuse sans le dire d'abord, on croit s'être trompé.
      if (ONGLETS_OPTION.includes(b.dataset.tab) && optionBlock('compta', ONGLET_QUOI[b.dataset.tab] || 'Cet écran')) return;
      comptaState.tab = b.dataset.tab;
      $$('#c-tabs button').forEach(x => x.classList.toggle('active', x === b));
      resetPages(); draw();
    });
    draw();
  };

  // ---------- Paramètres ----------
  //
  // Refonte 7.30.0. Ce qui n'allait pas, mesuré par `npm run e2e:parametres` :
  //
  //   — huit onglets d'un déséquilibre de 1 à 12. « Licence » et « Cabinet comptable » pesaient un
  //     cinquième d'écran chacun (une phrase, parfois une phrase disant qu'il n'y a rien à faire),
  //     pendant que « Sécurité et données » en faisait deux, avec huit panneaux et dix-huit boutons.
  //     Un onglet permanent pour une phrase apprend à ne plus lire les onglets ;
  //   — « Sécurité et données » était devenu le fourre-tout : il portait aussi « Choisir les modules
  //     affichés » et « Revoir l'assistant de démarrage », qui ne sont ni de la sécurité ni des
  //     données ;
  //   — la lecture de photo de facture vivait sous « Mises à jour », par accident d'histoire ;
  //   — soixante réglages, et aucun moyen d'en chercher un.
  //
  // Cinq onglets, et une recherche. La recherche est ce qui rend le rangement pardonnable : quand on
  // ne sait pas dans quelle famille un réglage a été classé, on tape son nom.

  // La mécanique (index, recherche, sommaire, la porte unique vers un panneau) vit dans
  // `src/renderer/reglages.js`, chargé par LES DEUX applications : le cabinet a exactement la même
  // page à ranger, et recopier aurait garanti la divergence (règle du menu d'actions, 7.29.0).
  // Ce qui reste ici est ce que le module ne peut pas savoir : les noms d'onglets et quoi faire
  // quand la recherche ne trouve rien.

  // Ce que le régime fait aux pièces, dit sous le choix du régime (10.14.0). La phrase se DÉDUIT du
  // régime choisi : écrite au dessin seulement, elle disait « Tu es assujetti » sous un « Forfaitaire »
  // qu'on venait de choisir — et même après l'avoir enregistré, jusqu'à la page suivante.
  // Les achats encore ouverts qui suivent l'ancien régime (10.14.0) : la règle figée protège ce qui est
  // déclaré, mais une erreur de régime doit pouvoir se réparer — dans les mois non clôturés, jamais
  // au-delà. Le panneau lit le régime ENREGISTRÉ : proposer d'appliquer un régime qu'on n'a pas encore
  // enregistré ferait deux vérités.
  function dessinerAchatsHorsRegime() {
    const zone = $('#regime-achats'); if (!zone) return;
    const sel = $('#pf select[name=taxRegime]');
    const r = C.achatsHorsRegime(data, company());
    if (!r.pieces.length || (sel && sel.value !== C.regimeOf(company()).id)) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<div class="banner info mt"><span>${h(pl(r.pieces.length, 'achat'))} des mois non clôturés ${r.pieces.length > 1 ? 'suivent' : 'suit'} encore l'ancien régime : ${r.cible ? `${r.pieces.length > 1 ? 'leur' : 'sa'} TVA n'est pas récupérée` : `${r.pieces.length > 1 ? 'ils déduisent' : 'il déduit'} encore ${h(C.money(r.tva, company().currency))} de TVA`}. Si ce régime était une erreur, applique celui d'aujourd'hui.</span><button type="button" class="btn btn-sm" id="regime-achats-ok">Appliquer à ${h(pl(r.pieces.length, 'achat'))}…</button></div>`;
    $('#regime-achats-ok').onclick = async () => {
      const r2 = C.achatsHorsRegime(data, company());
      if (!r2.pieces.length) return dessinerAchatsHorsRegime();
      const ok = await confirmDialog(`${pl(r2.pieces.length, 'achat')} des mois non clôturés ${r2.cible ? 'récupéreront leur TVA' : 'ne récupéreront plus leur TVA'} : ${C.money(r2.tva, company().currency)} de TVA déductible ${r2.cible ? 'en plus' : 'en moins'} sur ${r2.pieces.length > 1 ? 'leurs mois' : 'son mois'}, ${r2.cible ? 'retirée' : 'ajoutée'} au coût de ces achats.\n\nLes mois clôturés ne bougent pas. Si la TVA d'un de ces mois est déjà déclarée, la déclaration changerait : vois-le avec ton comptable avant.`, 'Appliquer mon régime', false, { titre: 'Appliquer ton régime à ces achats ?' });
      if (!ok) return;
      const ids = new Set(r2.pieces.map(x => x.id));
      data.purchases.forEach(x => { if (ids.has(x.id)) x.tvaRecuperable = r2.cible; });
      save(true);
      toast(`${pl(r2.pieces.length, 'achat')} ${r2.pieces.length > 1 ? 'suivent' : 'suit'} maintenant ton régime`);
      dessinerAchatsHorsRegime();
    };
  }
  // Le régime et le taux tels qu'ils sont CHOISIS à l'écran, avant d'enregistrer (9.4.2). Un taux
  // grisé n'est pas un choix : c'est celui des réglages qui compte.
  function regimeChoisi() {
    const sel = $('#pf select[name=taxRegime]'), tv = $('#pf select[name=defaultVatRate]');
    const co = { ...company(), taxRegime: sel ? sel.value : company().taxRegime };
    if (tv && !tv.disabled) co.defaultVatRate = tv.value;
    return co;
  }
  // Les articles du catalogue à 0 % quand l'entreprise facture la TVA (10.14.0) : nés au forfait, ils
  // faisaient naître des lignes sans TVA après le passage au réel. Un article peut aussi être vraiment
  // exonéré : la phrase le dit, et le geste ne se fait qu'à la demande, avec son « Annuler ». Elle lit
  // le régime et le taux CHOISIS : c'est au moment où l'on passe au réel qu'il faut le voir.
  function dessinerCatalogueSansTva() {
    const zone = $('#regime-catalogue'); if (!zone) return;
    const co = regimeChoisi();
    const liste = C.articlesSansTva(data, co);
    if (!liste.length) { zone.innerHTML = ''; return; }
    const n = liste.length, taux = C.defaultVat(co), plus = n > 1;
    zone.innerHTML = `<div class="regime-cat small mt"><span>${h(pl(n, 'article'))} de ton catalogue ${plus ? 'sont' : 'est'} à 0\u00a0% de TVA : une ligne tirée ${plus ? 'de l\'un d\'eux' : 'de lui'} n'en porte pas. C'est juste s'${plus ? 'ils sont exonérés' : 'il est exonéré'} ; s'${plus ? 'ils sont nés' : 'il est né'} quand ton entreprise ne facturait pas de TVA, passe-${plus ? 'les' : 'le'} au taux de tes nouvelles lignes.</span><button type="button" class="btn btn-sm" id="regime-cat-ok">Passer à ${taux}\u00a0%…</button></div>`;
    $('#regime-cat-ok').onclick = async () => {
      const co2 = regimeChoisi();
      const l2 = C.articlesSansTva(data, co2);
      if (!l2.length) return dessinerCatalogueSansTva();
      const t2 = C.defaultVat(co2);
      const noms = l2.slice(0, 8).map(x => '• ' + (x.label || 'Sans nom')).join('\n') + (l2.length > 8 ? `\n… et ${pl(l2.length - 8, 'autre')}` : '');
      const ok = await confirmDialog(`${pl(l2.length, 'article')} de ton catalogue ${l2.length > 1 ? 'passeront' : 'passera'} de 0\u00a0% à ${t2}\u00a0% de TVA :\n\n${noms}\n\nLes lignes déjà posées sur tes devis et factures ne changent pas : seules les prochaines lignes tirées du catalogue porteront ce taux.`, `Passer à ${t2} %`, false, { titre: `Passer ${l2.length > 1 ? 'ces articles' : 'cet article'} à ${t2}\u00a0% de TVA ?` });
      if (!ok) return;
      const avant = new Map(l2.map(x => [x.id, x.vatRate]));
      l2.forEach(x => { x.vatRate = t2; });
      save(true);
      toastUndo(`${pl(l2.length, 'article')} à ${t2}\u00a0% de TVA`, () => {
        data.catalog.forEach(x => { if (avant.has(x.id)) x.vatRate = avant.get(x.id); });
        save(true); dessinerCatalogueSansTva();
      });
      dessinerCatalogueSansTva();
    };
  }
  // 10.14.1 (MR-02) — le jumeau de `dessinerCatalogueSansTva` pour ce qui FABRIQUE des factures : un
  // contrat récurrent ou un modèle né au forfait gardait ses lignes à 0 %, et chaque facture qu'il
  // engendrait après le passage au réel sortait sans la TVA due. Même règle que le catalogue : on le
  // SIGNALE avec le geste, on ne le change pas d'office (une prestation peut être vraiment exonérée).
  function dessinerSourcesSansTva() {
    const zone = $('#regime-sources'); if (!zone) return;
    const co = regimeChoisi();
    const src = C.sourcesSansTva(data, co);
    const n = src.contrats.length + src.modeles.length;
    if (!n) { zone.innerHTML = ''; return; }
    const taux = C.defaultVat(co), plus = n > 1;
    const quoi = [src.contrats.length ? pl(src.contrats.length, 'contrat récurrent', 'contrats récurrents') : '', src.modeles.length ? pl(src.modeles.length, 'modèle') : ''].filter(Boolean).join(' et ');
    zone.innerHTML = `<div class="regime-cat small mt"><span>${h(quoi)} ${plus ? 'portent' : 'porte'} des lignes à 0\u00a0% de TVA : elles sortiront sans TVA sur chaque facture ${plus ? 'qu\'ils fabriquent' : 'qu\'il fabrique'}. C'est juste si elles sont exonérées ; ${plus ? 's\'ils sont nés' : 's\'il est né'} quand ton entreprise ne facturait pas de TVA, passe ces lignes au taux de tes nouvelles lignes.</span><button type="button" class="btn btn-sm" id="regime-src-ok">Passer à ${taux}\u00a0%…</button></div>`;
    $('#regime-src-ok').onclick = async () => {
      const co2 = regimeChoisi();
      const s2 = C.sourcesSansTva(data, co2);
      const tous = [...s2.contrats.map(r => ({ x: r, nom: `Contrat « ${r.subject || 'sans objet'} » — ${clientName(r.clientId)}` })), ...s2.modeles.map(t => ({ x: t, nom: `Modèle « ${t.name || 'sans nom'} »` }))];
      if (!tous.length) return dessinerSourcesSansTva();
      const t2 = C.defaultVat(co2);
      const noms = tous.slice(0, 8).map(y => '• ' + y.nom).join('\n') + (tous.length > 8 ? `\n… et ${pl(tous.length - 8, 'autre')}` : '');
      const ok = await confirmDialog(`Les lignes à 0\u00a0% de ${tous.length > 1 ? 'ces contrats et modèles' : 'ce contrat ou modèle'} passeront à ${t2}\u00a0% de TVA :\n\n${noms}\n\nLes factures déjà émises ne changent pas : seules les prochaines factures qu'ils fabriqueront porteront ce taux. Le montant hors taxe ne bouge pas ; le client paiera la TVA en plus.`, `Passer à ${t2} %`, false, { titre: `Passer ces lignes à ${t2}\u00a0% de TVA ?` });
      if (!ok) return;
      const avant = [];
      tous.forEach(y => (y.x.lines || []).forEach(l => { if (C.ligneFactureeSansTva(l)) { avant.push([l, l.vatRate]); l.vatRate = t2; } }));
      save(true);
      toastUndo(`${pl(avant.length, 'ligne')} à ${t2}\u00a0% de TVA`, () => {
        avant.forEach(([l, v]) => { l.vatRate = v; });
        save(true); dessinerSourcesSansTva();
      });
      dessinerSourcesSansTva();
    };
  }
  function noteRegime(c) {
    return C.assujettiTVA(c)
      ? '<p class="small muted mt">Tu es assujetti : tes documents portent une colonne TVA et un total de TVA, tu récupères la TVA de tes achats, et la page Comptabilité calcule ce que tu dois déclarer.</p>'
        + (C.defaultVat(c) === 0 ? '<p class="small mt"><strong>Tes nouvelles lignes naissent à 0\u00a0% de TVA.</strong> C\'est juste si tu vends surtout sans TVA ; sinon, choisis ton taux dans « TVA des nouvelles lignes » — un taux resté à 0\u00a0% d\'un ancien régime ferait des factures sans la TVA que tu dois collecter.</p>' : '')
      : `<p class="small mt"><strong>Tu n'es pas assujetti à la TVA.</strong> Tes documents ne portent donc ni colonne TVA ni total de TVA : la mention « ${h(C.mentionTVA(c))} » s'imprime à la place. Le taux des nouvelles lignes est forcé à 0 % — c'est pour ça qu'il est grisé. La TVA que tu paies à tes fournisseurs ne se récupère pas : elle entre dans le coût de tes achats.</p>`;
  }
  routes.parametres = async () => {
    const c = company();
    const path = await bridge.dataPath();
    const TABS = SETTINGS_TABS.filter(t => (t[0] !== 'equipe' || equipeVisible()) && (t[0] !== 'abonnement' || abonnementVisible()));
    if (!TABS.some(t => t[0] === settingsTab)) settingsTab = 'societe';
    const manques = C.companyGaps(c);
    // (plateforme, lot débutant) Il restait affiché après « Enregistrer » une fiche complète, jusqu'au rechargement.
    const bandeauManques = m => m.length ? `<div class="set-manque mb"><b>Il manque ${pl(m.length, 'information')} :</b> ${h(m.join(', '))}.
            <div class="small mt">Ces informations s'impriment sur chaque document. Tant qu'elles manquent, SkanFact prévient avant chaque émission.</div></div>` : '';
    $('#view').innerHTML = `<div class="page-head"><h1>Paramètres</h1>
        <div class="actions set-search">
          <input type="search" id="set-q" placeholder="Chercher un réglage : timbre, logo…" autocomplete="off" spellcheck="false">
        </div></div>
      <div id="set-res" class="set-res" hidden></div>
      <div id="set-corps">
      <div class="tabs" id="set-tabs" role="tablist" aria-label="Les paramètres">${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}" class="${id === settingsTab ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="set-somm" id="set-somm"></div>
      <form id="pf">
        <section data-pane="societe">
        ${panneau('p-identite')}
          <p class="small muted mb">Ces informations s'impriment en haut de chaque devis et facture. Le matricule fiscal est obligatoire sur une facture.
          <button type="button" class="btn btn-sm btn-ghost" id="redo-setup-2">Revoir l'assistant de démarrage…</button></p>
          <div id="set-manque-zone">${bandeauManques(manques)}</div>
          <div class="grid-2">
          ${field(lbl('Raison sociale', 'co.name'), 'name', c.name)}
          ${field(lbl('Matricule fiscal', 'co.matricule'), 'matricule', c.matricule, 'text', 'placeholder="1234567X/A/M/000"')}
          ${field(lbl('Registre de commerce (RC)', 'co.rc'), 'rc', c.rc || '', 'text', 'placeholder="facultatif, ex. B123456789"')}
          ${field(lbl('Matricule CNSS employeur', 'pay.cnssEmployerId'), 'cnss', c.cnss || '', 'text', 'placeholder="s\'il y a des salariés"')}
          ${field(lbl('Code d\'exploitation CNSS', 'pay.cnssCode'), 'cnssCode', c.cnssCode || '', 'text', 'placeholder="0000" inputmode="numeric"')}
          ${field(lbl('Capital social', 'co.capital'), 'capital', c.capital || '', 'text', 'placeholder="facultatif, ex. 1 000 DT"')}
          ${field(lbl('Gérant (qui signe)', 'co.managerName'), 'managerName', c.managerName || '', 'text', 'placeholder="Prénom et nom"')}
          <label class="field span-2">${lbl('Adresse', 'co.address')}<textarea name="address">${h(c.address)}</textarea></label>
          ${field(lbl('Téléphone', 'co.phone'), 'phone', c.phone)}
          ${field(lbl('Email', 'co.email'), 'email', c.email, 'email')}
          ${field(lbl('Site web', 'co.website'), 'website', c.website || '')}
          <label class="field span-2">${lbl('Slogan (sous le nom, sur les documents)', 'co.tagline')}<input type="text" name="tagline" value="${h(c.tagline || '')}" placeholder="Ce que fait ton entreprise, en quelques mots"></label>
        </div></div>
        <!-- Le régime fiscal vivait au milieu des « Règles de facturation », entre le délai de
             paiement et la devise. Ce n'est pas une règle de document : c'est ce que ton entreprise
             EST, et c'est lui qui décide si tes factures portent de la TVA (règle 7.22.0). Il vit
             donc avec l'identité, juste sous elle. -->
        ${panneau('p-regime')}
          <p class="small muted mb">C'est le régime qui décide si tes factures portent de la TVA — pas ton métier. <em>À VÉRIFIER avec ton comptable.</em></p>
          <div class="grid-2">
          <label class="field">${lbl('Régime fiscal', 'co.taxRegime')}<select name="taxRegime">${C.REGIMES.map(r => `<option value="${r.id}" ${C.regimeOf(c).id === r.id ? 'selected' : ''}>${h(r.label)}</option>`).join('')}</select></label>
          <label class="field">${lbl('TVA des nouvelles lignes', 'doc.defaultVat')}<select name="defaultVatRate" ${C.assujettiTVA(c) ? '' : 'disabled'}>${C.VAT_RATES.map(v => `<option value="${v}" ${C.defaultVat(c) === v ? 'selected' : ''}>${v} %</option>`).join('')}</select></label>
        </div>
        <div id="regime-note">${noteRegime(c)}</div>
        <div class="grid-2 mt">${champsAttestationRS(c, 'entreprise')}</div>
        <label class="check mt"><input type="checkbox" name="fodec" ${c.fodec === true ? 'checked' : ''}> Je fabrique ce que je vends : mes factures portent la FODEC ${info('co.fodec')}</label>
        <div id="regime-achats"></div>
        <div id="regime-catalogue"></div>
        <div id="regime-sources"></div>
        <p class="small muted mt">Changer de régime ne réécrit <b>aucune</b> pièce déjà émise : une facture qui porte de la TVA la garde pour toujours. Un achat déjà saisi non plus : sa TVA reste récupérée, ou non, comme le jour où tu l'as saisi.</p></div>
        ${panneau('p-banque')}
          <p class="small muted mb">Le RIB s'affiche sur les factures, dans le bloc « Règlement ». C'est ce que ton client copie pour te payer : relis-le deux fois.</p>
          <div class="grid-2">
          ${field(lbl('Banque', 'pay.bank'), 'bank', c.bank)}
          ${ribField('RIB', c.rib)}
          <label class="field span-2">${lbl('Conditions de paiement (sur les factures)', 'pay.terms')}<textarea name="paymentTerms">${h(c.paymentTerms || '')}</textarea></label>
        </div></div>
        </section>

        <section data-pane="documents" hidden>
        ${panneau('p-facturation')}<div class="grid-3">
          ${field(lbl(`<span>Timbre fiscal par facture (<span data-unite-timbre>${C.normCurrency(c.currency)}</span>)</span>`, 'doc.stampFee'), 'stampFee', c.stampFee, 'number', 'step="0.001" min="0" class="num"')}
          ${field(lbl('Validité des devis (jours)', 'doc.quoteValidity'), 'quoteValidityDays', c.quoteValidityDays, 'number', 'min="0" class="num"')}
          ${field(lbl('Délai de paiement (jours)', 'doc.paymentDays'), 'paymentTermsDays', c.paymentTermsDays, 'number', 'min="0" class="num"')}
          ${accordsEnLigne() ? `<label class="check" style="align-self:end"${estResponsable() ? '' : ' title="Réglé par le propriétaire ou un administrateur"'}><input type="checkbox" name="encoursAccord" ${c.encoursAccord ? 'checked' : ''}${estResponsable() ? '' : ' disabled'}> Au-delà de l'encours d'un client : l'accord d'un responsable ${info('doc.encoursAccord')}</label>` : ''}
          ${accordsEnLigne() ? field(lbl(`Commande fournisseur permise sans accord (HT, ${h(c.currency || 'DT')})`, 'doc.commandeAccord'), 'commandeAccordAuDela', Number(c.commandeAccordAuDela) > 0 ? c.commandeAccordAuDela : '', 'number', `step="0.001" min="0" class="num" placeholder="aucun seuil"${estResponsable() ? '' : ' disabled title="Réglé par le propriétaire ou un administrateur"'}`) : ''}
          ${accordsEnLigne() ? field(lbl('Remise permise sans accord (%)', 'doc.remiseAccord'), 'remiseAccordAuDela', Number(c.remiseAccordAuDela) > 0 ? c.remiseAccordAuDela : '', 'number', `step="0.01" min="0" max="100" class="num" placeholder="aucun seuil"${estResponsable() ? '' : ' disabled title="Réglé par le propriétaire ou un administrateur"'}`) : ''}
          <label class="field">${lbl('Retenue à la source par défaut', 'doc.withholdingDefault')}${withholdingSelect('defaultWithholdingRate', c.defaultWithholdingRate)}</label>
          ${/* 10.12.0 — « 0 » affiché dans le champ se lisait « un seuil de zéro dinar », c'est-à-dire
               toutes les factures : c'est l'inverse de ce qu'il veut dire (aucun seuil, 9.1.1). Le champ
               reste vide et le dit ; il porte son unité, comme le timbre juste à côté (9.4.8). */''}
          ${field(lbl(`Seuil de retenue à la source (${C.normCurrency(c.currency)})`, 'doc.withholdingThreshold'), 'withholdingThreshold', Number(c.withholdingThreshold) > 0 ? c.withholdingThreshold : '', 'number', 'step="0.001" min="0" class="num" placeholder="aucun seuil"')}
          <!-- La devise était le SEUL champ libre d'un réglage à liste fermée : l'éditeur de
               document et la fiche client offrent les sept codes dans une liste depuis la 2.4.0,
               et ici on tapait ce qu'on voulait. « Dinar », « TND », « dt » : decimalsFor ne
               reconnaît que 'DT' et 'TND', donc tout le reste passait à deux décimales au lieu de
               trois — sur des montants en dinars, et sur toutes les pièces à venir. -->
          <label class="field">${lbl('Devise', 'doc.currency')}<select name="currency">${C.CURRENCIES.map(x => `<option value="${x}" ${C.normCurrency(c.currency) === x ? 'selected' : ''}>${h(C.libelleDevise(x))}</option>`).join('')}</select></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="openAfterExport" ${c.openAfterExport !== false ? 'checked' : ''}> Ouvrir le PDF après export ${info('doc.openAfterExport')}</label>
        </div>
        <p class="small muted mt">Retenue à la source : calculée sur le TTC hors timbre, modifiable sur chaque facture et par client. Les taux et l'assiette sont <em>À VÉRIFIER avec ton comptable</em>. La TVA et le régime se règlent dans <b>Mon entreprise</b>.</p></div>
        ${/* 10.14.0 — la numérotation continue : quelqu'un qui facturait ailleurs continue à FAC-2026-048 au
             lieu de repartir à 001. On règle la DERNIÈRE pièce émise ailleurs : c'est le numéro qu'on a
             sous les yeux ; `nextNumber` fait la suivante. */''}
        ${panneau('p-numerotation', info('doc.numerotation'))}
          <p class="small muted">Tu facturais déjà avant SkanFact — dans un autre logiciel, sur un carnet ? Indique le numéro de ta dernière pièce de ${C.today().slice(0, 4)} : la suivante le suivra, au lieu de repartir à 001.</p>
          ${/* Le motif d'un refus vit dans une place RÉSERVÉE au-dessus du tableau. Posé dans la ligne, il
               élargissait la dernière colonne et le tableau redistribuait les autres : le champ où l'on
               tapait partait de 220 px sous le curseur (règle H-E1). Sous le tableau, la barre
               « Modifications non enregistrées » le recouvrait. */''}
          <p class="small num-motif" id="num-motif" aria-live="polite"></p>
          <table class="list compact" id="num-table"><thead><tr><th>Pièces de ${C.today().slice(0, 4)}</th><th class="r">Dernière émise ${info('doc.numDerniere')}</th><th>La prochaine portera</th></tr></thead>
          <tbody>${C.TYPES_NUMEROTES.map(type => {
            const e = C.etatNumerotation(data, type, C.today().slice(0, 4));
            const nom = { facture: 'Factures', avoir: 'Avoirs', devis: 'Devis' }[type];
            return `<tr><td>${nom}</td><td class="r">${e.verrouillee
              ? `<span class="mono">${h(e.derniereNumero)}</span>`
              : `<input type="number" class="num num-derniere" data-num="${type}" data-nom="${nom}" data-avant="${e.derniere || ''}" value="${e.derniere || ''}" min="0" step="1" placeholder="aucune" aria-label="Dernière ${nom.toLowerCase().replace(/s$/, '')} émise en ${e.annee}">`}</td>
              <td><span class="mono" data-num-prochaine="${type}">${h(e.prochaine)}</span>${e.verrouillee ? ' <span class="small muted">— la suite est tenue par SkanFact</span>' : ''}</td></tr>`;
          }).join('')}</tbody></table>
          <p class="small muted mt">Une facture et un avoir reçoivent leur numéro à l'émission ; leur série d'une année doit rester continue — <em>À VÉRIFIER avec ton comptable</em>. Une fois une facture de l'année numérotée ici, sa suite ne se change plus.</p></div>
        <!-- « Image de marque » a fait deux voyages : de l'onglet Société (où on la cherchait entre
             le matricule fiscal et le RIB) vers Apparence en 7.11.0, puis ici. Le titre disait
             depuis toujours ce qu'elle est — « sur tes documents » — et l'onglet Apparence, qui ne
             portait plus que deux listes déroulantes, ne pesait qu'un demi-écran. -->
        ${panneau('p-marque')}${marqueResume(c)}</div>
        ${panneau('p-textes')}<div class="grid-2">
          <label class="field span-2">${lbl('Conditions des devis', 'doc.quoteTerms')}<textarea name="quoteTerms">${h(c.quoteTerms || '')}</textarea></label>
          <label class="field span-2">${lbl('Pied de page des documents', 'doc.footer')}<textarea name="footer">${h(c.footer)}</textarea></label>
          <label class="field span-2">${lbl('Conditions de paiement — documents en anglais', 'doc.en')}<textarea name="paymentTermsEn">${h(c.paymentTermsEn || '')}</textarea></label>
          <label class="field span-2">${lbl('Conditions des devis — documents en anglais', 'doc.en')}<textarea name="quoteTermsEn">${h(c.quoteTermsEn || '')}</textarea></label>
        </div>
        ${/* 10.12.0 — les conditions de paiement ANGLAISES sont ici, les françaises avec le RIB : qui
             cherche la phrase de ses factures parmi les « textes imprimés » ne trouvait que sa
             traduction. Le panneau le dit, et le bouton y mène, curseur dans la case. */''}
        <p class="small muted mt">Les conditions de paiement en français s'impriment avec le RIB : elles se règlent dans <button type="button" class="btn btn-sm btn-ghost" data-vers-champ="p-banque:paymentTerms">Coordonnées bancaires</button></p></div>
        ${panneau('p-objectifs')}
          <p class="small muted mb">Ces deux réglages ne servent qu'à la page Statistiques : ils ne s'impriment nulle part et ne changent aucun calcul de facture.</p>
          <div class="grid-3">
          ${/* 10.12.0 — « 0 » dans la case se lisait « un objectif de zéro » : vide, il dit « aucun ». */''}
          ${field(lbl(`Objectif de chiffre d'affaires HT par an (${C.normCurrency(c.currency)})`, 'stat.target'), 'revenueTarget', Number(c.revenueTarget) > 0 ? c.revenueTarget : '', 'number', 'step="1" min="0" class="num montant" placeholder="aucun objectif"')}
          ${field(lbl('Un client est « endormi » après (jours)', 'stat.dormant'), 'dormantDays', c.dormantDays || 180, 'number', 'min="1" class="num"')}
        </div></div>
        ${bridge.teifDuServeur ? `${panneau('p-efacture', info('set.efacture'))}
          <label class="check"><input type="checkbox" name="efacture" ${c.efacture ? 'checked' : ''}> Mon entreprise est soumise à la facture électronique</label>
          <p class="small muted mt">SkanFact écrit le fichier TEIF de chaque facture et de chaque avoir à l'émission, avec les montants de la pièce. Soumise, ton entreprise ne peut pas émettre une pièce dont le fichier serait refusé (ton matricule, l'identifiant du client) : SkanFact le dit avant de prendre le numéro, avec le bouton qui corrige. Chaque pièce émise se signe ensuite avec DigiGo (« Signer (DigiGo)… », dans son menu « Plus ») ; signée, elle part d'elle-même à la TTN, avec le compte El Fatoora de l'entreprise. Qui est soumis, et depuis quand : À VÉRIFIER avec ton comptable (loi de finances 2026, art. 53).</p>${bridge.dessinerSignataire ? '<div id="signataire-panel"></div>' : ''}${bridge.dessinerTtn ? '<div id="ttn-panel"></div>' : ''}</div>` : ''}
        ${bridge.dessinerPaiement ? `${panneau('p-paiement')}<div id="paiement-panel"></div></div>` : ''}
        ${bridge.dessinerImprimante ? `${panneau('p-imprimante')}<div id="imprimante-panel"></div></div>` : ''}
        ${panneau('p-caisse')}
          <p class="small muted mb">Ces réglages ne servent qu'aux tickets de la page Caisse : tes devis et tes factures n'en dépendent pas.</p>
          <div class="grid-2">
            <label class="field">${lbl('Largeur du papier', 'cs.largeur')}<select name="caisseLargeur"><option value="80" ${Number(c.caisseLargeur) !== 58 ? 'selected' : ''}>80 mm (le plus courant)</option><option value="58" ${Number(c.caisseLargeur) === 58 ? 'selected' : ''}>58 mm</option></select></label>
            <label class="check" style="align-self:end"><input type="checkbox" name="caisseTimbre" ${c.caisseTimbre ? 'checked' : ''}> Timbre fiscal sur chaque ticket ${info('cs.timbre')}</label>
            ${bridge.encaisser ? field(lbl('Remise permise sans code à la caisse (%)', 'cs.plafond'), 'remiseCaisseAuDela', Number(c.remiseCaisseAuDela) > 0 ? c.remiseCaisseAuDela : '', 'number', `step="0.01" min="0" max="100" class="num" placeholder="0"${estResponsable() ? '' : ' disabled title="Réglé par le propriétaire ou un administrateur"'}`) : ''}
            <label class="field span-2">${lbl('Message en bas du ticket', 'cs.pied')}<textarea name="caissePied" rows="2" placeholder="Merci de votre visite.">${h(c.caissePied || '')}</textarea></label>
          </div></div>
        </section>

        <section data-pane="envois" hidden>
        ${/* 10.12.0 — hors Mac il n'y a rien à choisir : la phrase était posée dans un « champ » qui
             répétait le titre du panneau en étiquette, et elle héritait du gras des étiquettes. La
             bulle passe sur le titre, la phrase redevient une phrase. */''}
        ${panneau('p-envoi')}<p class="small muted" id="mail-fixe">Le message s'ouvre dans la messagerie de ton appareil, sans pièce jointe : un navigateur ne sait pas en joindre. Pour une facture ou un avoir émis, SkanFact met dans le message le lien de la pièce : ton client y voit la pièce telle que tu l'imprimes, et ce qu'il en doit ; il la règle en ligne si tu as branché le paiement en ligne (onglet Documents). Il n'y a rien à régler ici.</p></div>
        ${panneau('p-comptable')}<div class="grid-2">
          ${field(lbl('Email du comptable', 'compta.comptable'), 'accountantEmail', c.accountantEmail || '', 'email', 'placeholder="comptable@cabinet.tn"')}
        </div><p class="small muted mt">Utilisé par « Envoyer au comptable » sur la page Comptabilité. Ton comptable a SkanFact Cabinet ? Relie-le plutôt dans « Ton cabinet comptable », plus bas : il voit tes pièces au fil de l'eau, sans e-mail.</p></div>
        ${panneau('p-modeles', info('mail.templates'))}
          <p class="small muted mt">Variables utilisables : {numero} {client} {objet} {montant} {echeance} {jours} {societe} {reference}. Les documents en anglais utilisent les modèles en anglais.</p>
          <!-- Les deux jeux sont REPLIÉS : trente-deux champs de texte à eux seuls, c'est-à-dire
               deux écrans et demi pour un onglet qui en compte quatre. Un modèle de message se
               modifie une fois par an ; on l'ouvre quand on vient pour ça. Le sommaire de l'onglet
               et la recherche mènent ici directement, donc rien n'est perdu. -->
          ${[['fr', 'et', 'Modèles en français'], ['en', 'eten', 'Modèles en anglais (clients étrangers)']].map(([lg, prefix, title]) => { const modeles = [['devis', lg === 'fr' ? 'Envoi d\'un devis' : 'Quote'], ['devisModifie', lg === 'fr' ? 'Nouvelle version d\'un devis' : 'New version of a quote'], ['facture', lg === 'fr' ? 'Envoi d\'une facture' : 'Invoice'], ['avoir', lg === 'fr' ? 'Envoi d\'un avoir' : 'Credit note'], ['relance1', lg === 'fr' ? 'Rappel (≤ 15 jours de retard)' : 'Reminder (≤ 15 days)'], ['relance2', lg === 'fr' ? 'Relance (16 à 45 jours)' : 'Second reminder (16–45 days)'], ['relance3', lg === 'fr' ? 'Dernière relance (> 45 jours)' : 'Final reminder (> 45 days)'], ['relanceDevis', lg === 'fr' ? 'Relance d\'un devis sans réponse' : 'Quote follow-up'], ['comptable', lg === 'fr' ? 'Envoi au comptable' : 'To the accountant'],
            // Le gabarit de la clé de licence n'a de sens que sur le poste de l'éditeur (7.33.0).
            ...(licence.editeur ? [['licence', lg === 'fr' ? 'Envoi d\'une clé de licence (éditeur)' : 'Licence key (publisher)'],
              ['licenceCabinet', lg === 'fr' ? 'Envoi d\'une clé de licence Cabinet (éditeur)' : 'Cabinet licence key (publisher)']] : [])];
            // Le compte se DÉDUIT de la liste (10.14.1) : écrit « 9 » à la main, il en annonçait un de
            // moins que les dix de l'éditeur. Le modèle affiché est celui qui PARTIRA (`modeleMail`) :
            // celui d'une profession libérale nomme sa note d'honoraires (MR-09).
            return `<details><summary>${title} <span class="muted small">— ${modeles.length} messages</span></summary>
          ${modeles.map(([k, label]) => {
            const t = C.modeleMail(c, k, lg === 'en');
            return `<div class="section-head"><h2 class="small">${label}</h2></div><div class="grid-2"><label class="field span-2">${lbl('Objet', 'mail.modeleObjet')}<input type="text" name="${prefix}_${k}_subject" value="${h(t.subject)}"></label><label class="field span-2">${lbl('Message', 'mail.modeleMessage')}<textarea name="${prefix}_${k}_body" rows="4">${h(t.body)}</textarea></label></div>`; }).join('')}
          </details>`; }).join('')}
        </div>
        </section>

        <!-- L'onglet « Apparence » ne pesait plus qu'un demi-écran une fois l'image de marque
             partie avec les documents : deux listes déroulantes ne font pas un onglet. Il vit
             désormais en tête de « L'application », avec ce qui parle du logiciel lui-même. -->
        <section data-pane="app" hidden>
        ${panneau('p-apparence')}<div class="grid-3">
          <label class="field">${lbl('Thème', 'ap.theme')}<select name="theme"><option value="light" ${c.theme !== 'dark' && c.theme !== 'auto' ? 'selected' : ''}>Clair</option><option value="dark" ${c.theme === 'dark' ? 'selected' : ''}>Sombre</option><option value="auto" ${c.theme === 'auto' ? 'selected' : ''}>Comme le système</option></select></label>
          <label class="field">${lbl('Langue des documents par défaut', 'ap.defaultLang')}<select name="defaultLang"><option value="fr" ${c.defaultLang !== 'en' ? 'selected' : ''}>Français</option><option value="en" ${c.defaultLang === 'en' ? 'selected' : ''}>English</option></select></label>
        </div><p class="small muted mt">Le thème sombre ne concerne que l'interface : les documents restent clairs. Le changement se voit tout de suite ; il n'est gardé qu'une fois enregistré.</p></div>
        </section>
      </form>

      <!-- Ce qui suit vit HORS du formulaire : ce sont des panneaux d'action, dont les boutons
           n'ont pas l'attribut type=button et soumettraient donc le formulaire. Un même onglet peut
           s'écrire en deux sections portant le même data-pane : elles se montrent ensemble, et les
           panneaux voisins, masqués, ne laissent aucun trou entre elles. -->
      <section data-pane="envois" hidden>
        ${panneau('p-cabinet')}
          <div id="cab-pair"></div>
        </div>
      </section>

      <section data-pane="app" hidden>
      ${panneau('p-modules')}
        <p class="small muted mb">SkanFact sait faire beaucoup de choses. Tu choisis lesquelles apparaissent
        dans le menu de gauche — sans rien supprimer : ce qui est masqué reste atteignable par la
        recherche, et un module qui contient des données se réaffiche tout seul.</p>
        <div class="inline">
          <button type="button" class="btn" id="go-modules">Choisir les modules affichés…</button>
          <button type="button" class="btn btn-ghost" id="redo-setup">Revoir l'assistant de démarrage…</button>
        </div>
      </div>
      ${panneau('p-maj')}<div id="update-panel"></div></div>
      ${panneau('p-licence', info('lic.etat'))}<div id="lic-panel"></div></div>
      ${licence.editeur ? `${panneau('p-editeur', info('lic.editeur'))}<div id="editeur-panel"></div></div>` : ''}
      ${panneau('p-depannage')}
        <p class="small muted mb">Quand quelque chose ne va pas, le journal vaut mieux qu'une description : il dit où
        ${bridge.journalDeLEcran ? 'l\'écran s\'est arrêté ; tu le lis avant, et il ne part avec ta demande que si tu le coches.' : 'l\'application s\'est arrêtée, et il ne contient ni nom de client, ni montant.'} Et quand quelque chose manque,
        dis-le : SkanFact est écrit par une seule personne, et c'est ce qui décide de la suite.</p>
        <div class="inline">
          ${/* 10.12.0 — vert au repos, « Signaler un problème » disait qu'il y en avait un. */''}
          <button type="button" class="btn" id="set-support">Signaler un problème…</button>
          <button type="button" class="btn" id="set-idee">Proposer une amélioration…</button>
          <button type="button" class="btn" id="set-log">${bridge.journalDeLEcran ? 'Voir le journal de cet écran' : 'Ouvrir le journal technique'}</button>
          <button type="button" class="btn" id="set-aide">Ouvrir l'aide</button>
        </div>
      </div>
      </section>

      ${equipeVisible() ? `<section data-pane="equipe" hidden>
      ${panneau('p-equipe', info('set.equipe'))}<div id="equipe-panel"></div></div>
      ${bridge.accesSupport ? `${panneau('p-acces-support', info('set.accesSupport'))}<div id="acces-panel"></div></div>` : ''}
      </section>` : ''}

      ${abonnementVisible() ? `<section data-pane="abonnement" hidden>
      ${panneau('p-abonnement', info('set.abonnement'))}<div id="abonnement-panel"></div></div>
      </section>` : ''}

      <section data-pane="compte" hidden>
      ${bridge.dessinerCompte ? `${panneau('p-compte')}<div id="compte-panel"></div></div>` : ''}
      ${bridge.dessinerAppareils ? `${panneau('p-appareils')}<div id="appareils-panel"></div></div>` : ''}
      </section>

      <section data-pane="donnees" hidden>
      ${exportVisible() ? `${panneau('p-export', info('data.export'))}<div id="export-panel"></div></div>` : ''}
      ${exportVisible() && bridge.dessinerSauvegardes ? `${panneau('p-mes-sauvegardes', info('data.mes-sauvegardes'))}<div id="mes-sauvegardes-panel"></div></div>` : ''}
      ${bridge.quarantaine && bridge.quarantaine() ? `${panneau('p-quarantaine')}<div id="quarantaine-panel"></div></div>` : ''}
      ${bridge.dessinerServices ? `${panneau('p-services')}<div id="services-panel"></div></div>` : ''}
      ${panneau('p-dossiers', info('data.dossiers'))}
        <p class="small muted mb">Chaque dossier est une entreprise : ses clients, ses documents, ses achats, ses sauvegardes. Ils ne se mélangent jamais. Tu passes de l'un à l'autre en un clic, l'application se recharge.</p>
        <div id="dossiers-list"></div>
        <div class="inline mt"><button type="button" class="btn" id="dos-add">+ Nouveau dossier sur cet ordinateur</button>
          <button type="button" class="btn" id="dos-share">↔ Partager ce dossier à deux…</button>
          <button type="button" class="btn" id="dos-join">↓ Rejoindre un dossier déjà partagé…</button>${info('data.shared')}</div>
        ${/* 10.12.0 — « le premier bouton… le second » décrivait deux boutons quand la rangée en
             porte trois : le « premier » était « + Nouveau dossier ». Un bouton se désigne par son nom. */''}
        <p class="small muted mt"><b>Partager ce dossier à deux</b> pose le dossier ouvert, avec tout ce qu'il contient, dans ${NUAGE}, sur une clé ou un disque réseau. <b>Rejoindre un dossier déjà partagé</b> sert sur le <b>deuxième ordinateur</b>, pour ouvrir ce que le premier vient d'y poser.</p>
        <!-- « Ce poste » avait son propre panneau pour UN champ, qui ne sert qu'à une chose : dire
             qui a enregistré en dernier sur un dossier partagé. Il vit donc sous les dossiers, là
             où cette question se pose, au lieu de faire un titre pour une ligne. -->
        <h3 class="mt">Le nom de cet ordinateur ${info('data.device')}</h3>
        <p class="small muted mb">Il dit qui a enregistré en dernier quand vous travaillez à deux sur un dossier partagé. Il part aussi, avec la version installée, dans le signal de présence que l'application envoie à SkanFact toutes les quatre heures : choisissez un nom qui ne vous gêne pas, comme « PC du bureau ».</p>
        <div class="inline"><input type="text" id="dev-name" value="" style="max-width:280px"><button type="button" class="btn" id="dev-save">Renommer</button></div>
      </div>
      ${panneau('p-sauvegardes', info('data.backups'))}
        <p class="small muted">Fichier de données : <code>${h(path)}</code></p>
        <p class="small">${pl(data.documents.length, 'document')}, ${pl(data.clients.length, 'client')}, ${pl(data.catalog.length, 'prestation')}.</p>
        <p class="small muted">Chaque jour, avant la première modification, l'état est copié dans le dossier <code>backups</code> (30 jours conservés) ; une copie est aussi prise avant tout import, avant l'exemple et avant un effacement.</p>
        <div class="inline mt">
          <button class="btn" id="backup-now">Sauvegarder maintenant</button>
          <button class="btn" id="open-backups">Ouvrir le dossier des sauvegardes</button>
          <button class="btn" id="export-data">Exporter les données…</button>
          <button class="btn" id="import-data">Importer…</button>
        </div>
        <!-- Le moteur sait restaurer depuis la 7.0.0 (backups:peek et backups:restore), et
             AUCUN écran ne l'appelait : seule la sortie du jeu d'exemple s'en servait. Le seul
             chemin proposé à quelqu'un qui vient de perdre quelque chose était « Importer et
             choisis un fichier de ce dossier » — c'est-à-dire naviguer dans un dossier caché, y
             reconnaître un nom de fichier, et remplacer TOUT sans savoir ce qu'on perd. Le jour où
             on en a besoin est le pire jour pour apprendre un chemin. -->
        <div id="backup-list" class="mt"></div>
      </div>
      ${panneau('p-externe', info('data.external'))}
        <p class="small muted">${NUAGE}, clé USB, disque réseau. À chaque enregistrement, le fichier de données et les sauvegardes y sont copiés. Si cet ordinateur meurt, tout est ailleurs. <b>C'est le réglage le plus important de cette page.</b></p>
        <div id="ext-status" class="small mt"></div>
        <div class="inline mt"><button class="btn btn-primary" id="ext-choose">Choisir un dossier…</button><button class="btn btn-ghost" id="ext-remove" hidden>Retirer</button></div>
      </div>
      ${panneau('p-motdepasse', info('sec.password'))}
        <p id="sec-status">${security.encrypted ? `🔒 Mot de passe activé : le fichier de données et ses sauvegardes sont chiffrés (AES-256). Verrouiller : menu Fichier ou ${MOD}+L.` : 'Le fichier de données est en clair sur ce disque. Tu peux le protéger par un mot de passe demandé à chaque ouverture.'}</p>
        ${/* 10.12.0 — « il n'existe aucune récupération » se lisait SOUS le bouton qui l'engage :
             un avertissement se lit avant le geste (9.4.2). Et le bouton n'est plus vert d'office :
             la copie externe est l'étape d'avant, c'est elle qui l'allume (drawExternal). */''}
        <p class="small muted mt">Le mot de passe protège les fichiers sur le disque (ordinateur perdu ou volé). Il n'existe aucune récupération : sans lui, les données sont définitivement illisibles, <b>y compris pour toi</b>.</p>
        <div class="inline mt">${security.encrypted ? '<button class="btn" id="sec-change">Changer le mot de passe…</button><button class="btn" id="sec-lock">Verrouiller maintenant</button><button class="btn btn-danger" id="sec-remove">Retirer le mot de passe…</button>' : '<button class="btn" id="sec-set">Activer un mot de passe…</button>'}</div>
      </div>
      <!-- La lecture de photo était rangée sous « Mises à jour », par accident d'histoire : c'est
           là qu'était le seul autre panneau qui parle à internet. Mais ce n'est pas un réglage du
           logiciel — c'est la SEULE fonction qui fait sortir quelque chose de cet ordinateur, et
           c'est à ce titre qu'on la cherche. Elle vit donc avec les données et la sécurité. -->
      ${OCR_EN_PAUSE && !bridge.lectureSurLeServeur ? '' : panneau('p-ocr', info(bridge.lectureSurLeServeur ? 'ocr.ia' : 'ocr.key')) + '<div id="ocr-panel"></div></div>'}
      <!-- Charger l'exemple n'est PAS un geste dangereux : une sauvegarde est prise, la société est
           conservée, un bandeau permanent offre le retour, et l'article « Démarrer » le présente
           comme l'étape d'apprentissage. Il vivait pourtant dans l'encadré rouge, collé à « Tout
           effacer » — donc on hésitait à cliquer sur ce qu'on nous demandait de faire, puis on
           prenait le bouton écarlate d'à côté pour en sortir, et on perdait tout. -->
      ${panneau('p-exemple', info('data.demo'))}
        <div class="dz-row">
          <div><b>${bridge.exemple ? 'Ouvrir l\'exemple' : 'Charger le jeu d\'exemple'}</b>
            <div class="small muted">${bridge.exemple
              ? 'Ton entreprise d\'essai, remplie de cinq ans d\'activité inventée, pour cliquer partout sans rien risquer. Elle vit à part : rien de ce que tu y fais ne touche cette entreprise, et rien n\'est remplacé ici.'
              : 'Remplace tes données par cinq ans d\'activité fictive, pour cliquer partout sans rien casser. Une sauvegarde est prise avant, ta fiche société est conservée, et le bandeau de l\'exemple te rendra tes données d\'un clic.'}</div></div>
          <button class="btn" id="load-demo">${bridge.exemple ? 'Ouvrir l\'exemple' : 'Charger l\'exemple'}</button>
        </div>
      </div>
      ${panneau('p-danger')}
        <div class="dz-row">
          <div><b>Tout effacer</b> ${info('data.wipe')}
            <div class="small muted">Supprime clients, prestations, documents, contrats, modèles et textes. Les paramètres société restent. Une sauvegarde est prise avant.</div></div>
          <button class="btn btn-danger" id="wipe-data">Tout effacer…</button>
        </div>
      </div>
      </section>
      </div>

      <div class="save-bar" id="save-bar" hidden>
        <span>Modifications non enregistrées</span>
        <button class="btn" id="cancel-set">Abandonner les modifications</button>
        <button class="btn btn-primary" id="save">Enregistrer</button>
      </div>`;

    // --- onglets, sommaire et recherche
    //
    // Un onglet de huit panneaux fait deux écrans de haut : on descend en lisant les titres un par
    // un pour savoir s'il contient ce qu'on cherche. Le sommaire les montre tous d'un coup ; la
    // recherche répond quand on ne sait même pas dans quel onglet regarder. Les deux sont dans
    // `reglages.js`, partagé avec l'app du cabinet, et ils lisent l'ÉCRAN : un panneau ajouté demain
    // est trouvable le jour où il est écrit.
    const showTab = id => {
      settingsTab = id;
      $$('#set-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
      $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== id);
      reg.rafraichirSommaire(id);
      $('#view').scrollTop = 0;
    };
    const reg = Reglages.installer({
      corps: $('#set-corps'), champ: $('#set-q'), resultats: $('#set-res'), sommaire: $('#set-somm'),
      nomOnglet: pane => (SETTINGS_TABS.find(t => t[0] === pane) || [pane, pane])[1],
      ouvrirOnglet: pane => showTab(pane),
      ongletCourant: () => settingsTab,
      // (plateforme) Les panneaux sans objet en ligne (cachés) ne se comptent ni ne se trouvent.
      exclus: bridge.panneauxAbsents || [],
      pluriel: pl,
      rienTrouve: (mots, phrase) => `<div class="empty"><p>${phrase} Ou regarde dans l'Aide, qui explique à quoi
        sert chaque réglage.</p>
        <button type="button" class="btn btn-primary" id="set-vers-aide">Ouvrir l'aide</button></div>`,
      apresResultats: res => { if ($('#set-vers-aide', res)) $('#set-vers-aide', res).onclick = () => navigate('#/aide'); }
    });
    $$('#set-tabs button').forEach(b => b.onclick = () => { settingsFocus = ''; showTab(b.dataset.tab); });
    showTab(settingsTab);
    // Un lien qui promet « le mot de passe » ou « la copie externe » atterrissait en haut d'une pile
    // de six panneaux : on redescendait à la main en cherchant le titre. On amène le panneau visé —
    // et par la même porte que le sommaire, donc l'onglet suit même si l'appelant s'est trompé.
    // `panneau:champ` amène le panneau ET met le curseur dans le champ (10.12.0) : « Le renseigner »
    // qui ouvrait la fiche société en haut laissait chercher la case parmi douze. La même porte sert
    // aux renvois d'un panneau à l'autre (`data-vers-champ`) : `allerParametres` depuis la page
    // elle-même viserait l'adresse courante, et ne redessinerait rien (7.15.0).
    // Déclarée AVANT `amenerChamp`, qui la lit : une `const` posée plus bas dans la même route est une
    // zone morte, et la ReferenceError, levée dans une route asynchrone, était avalée par `render` —
    // les panneaux Mises à jour et Licence restaient vides, sans une ligne dans aucune console.
    let majLue = null;
    const amenerChamp = spec => {
      const [vise, champ] = String(spec).split(':');
      reg.montrer(vise);
      // Le champ visé reçoit le curseur, et ce qu'il contient déjà est sélectionné : « Saisir la
      // nouvelle » attestation remplace l'ancien numéro à la première frappe (10.15.0, H7).
      if (champ) setTimeout(() => { const el = $(`#pf [name="${champ}"]`); if (el) { el.focus(); if (el.value && typeof el.select === 'function') el.select(); } }, 80);
      // Les panneaux qui se remplissent APRÈS le dessin (la version et l'état des mises à jour,
      // l'achat de la licence) poussent ce qui est dessous : la palette amenait « Licence » et le
      // laissait 900 px sous le bord (10.14.0). On revise une fois qu'ils ont fini — la règle du
      // Cabinet (`reg.montrer` attend ses panneaux), portée ici.
      setTimeout(() => Promise.allSettled([majLue, achatDessine]).then(() => {
        const cible = document.getElementById(vise);
        if (!cible || location.hash !== '#/parametres') return;
        const r = cible.getBoundingClientRect(), vue = $('#view').getBoundingClientRect();
        if (r.top < vue.top || r.top > vue.bottom - 80) reg.montrer(vise);
      }), 0);
    };
    amenerDansParametres = spec => { if (spec) amenerChamp(spec); };
    $$('#pf [data-vers-champ]').forEach(b => b.onclick = () => amenerChamp(b.dataset.versChamp));
    if (settingsFocus) { const spec = settingsFocus; settingsFocus = ''; amenerChamp(spec); }

    // --- barre « Enregistrer » : elle n'apparaît que s'il y a quelque chose à enregistrer
    let setDirty = false;
    const markSet = () => { if (setDirty) return; setDirty = true; $('#save-bar').hidden = false; };
    $('#pf').addEventListener('input', markSet);
    $('#pf').addEventListener('change', markSet);
    // Le timbre se règle dans la devise de l'entreprise : son unité suit la liste pendant qu'on la
    // change (règle 9.4.8). Elle ne le faisait que dans l'écran « facturation » de l'assistant, parti
    // en 10.14.0 — la règle déménage avec le seul champ qui reste, sinon l'unité mentirait jusqu'à
    // l'enregistrement.
    $('#pf').addEventListener('change', e => {
      if (e.target && e.target.name === 'currency') { const u = $('#pf [data-unite-timbre]'); if (u) u.textContent = C.normCurrency(e.target.value); }
    });
    // La numérotation (10.14.0). La prochaine pièce se lit PENDANT la frappe, par la même fonction que
    // l'enregistrement : un aperçu calculé à part finirait par annoncer un autre numéro que celui que
    // la facture portera. Un refus se dit sur la ligne, en orange, sans bloquer la frappe.
    const anneeNum = C.today().slice(0, 4);
    const numEssai = el => C.poserNumerotation({ documents: data.documents, counters: { ...data.counters } }, el.dataset.num, anneeNum, el.value);
    // Toutes les lignes se relisent à chaque frappe : le motif affiché est celui de la PREMIÈRE ligne
    // refusée, nommée, et il s'efface quand elle est corrigée — pas quand on tape dans une autre.
    const majNumerotation = () => {
      let motif = '';
      $$('#pf [data-num]').forEach(el => {
        const r = numEssai(el);
        if (r.ok) { $(`#pf [data-num-prochaine="${el.dataset.num}"]`).textContent = r.etat.prochaine; el.classList.remove('champ-doute'); }
        else { el.classList.add('champ-doute'); if (!motif) motif = `${el.dataset.nom} : ${/^[A-ZÀ-Ý][a-zà-ÿ]/.test(r.motif) ? r.motif[0].toLowerCase() + r.motif.slice(1) : r.motif}`; }
      });
      $('#num-motif').textContent = motif;
    };
    $$('#pf [data-num]').forEach(el => el.addEventListener('input', () => { majNumerotation(); markSet(); }));
    const applySettings = () => {
      if (!peutEcrireDossier('company')) { toast('Ton rôle ne permet pas de modifier les paramètres de l\'entreprise : ils se règlent par le propriétaire ou un administrateur. Rien n\'a été enregistré.', true); return false; }
      // La numérotation d'abord : un refus n'écrit RIEN du reste — le contrôle passe avant
      // l'écriture (6.0.0), et une page à moitié enregistrée ne se relit plus.
      const nums = $$('#pf [data-num]').filter(el => el.value.trim() !== (el.dataset.avant || ''));
      for (const el of nums) { const r = numEssai(el); if (!r.ok) { refus(el, r.motif); return false; } }
      nums.forEach(el => { C.poserNumerotation(data, el.dataset.num, anneeNum, el.value); el.dataset.avant = el.value.trim(); });
      const v = formValues($('#pf'));
      // (plateforme, 1.87.13) Un matricule mal formé se refuse ici comme dans « Compléter ma fiche » : la fiche
      // l'enregistrait sans un mot (« 1234567X », la suite oubliée), le serveur ne le portait pas à l'entreprise, et seule
      // l'émission le disait (recette du 21/10/2026). Le contrôle passe avant l'écriture : rien d'autre n'est enregistré.
      const mfEl = $('#pf [name="matricule"]');
      if (mfEl && String(v.matricule || '').trim() && !C.matriculeBienForme(v.matricule)) {
        refus(mfEl, `« ${String(v.matricule).trim()} » n'a pas la forme d'un matricule fiscal : sept chiffres, une lettre (jamais I, O ni U), puis code TVA, catégorie et établissement (1234567A/A/M/000), tels qu'ils figurent sur ta carte d'identification fiscale.`);
        return false;
      }
      // L'attestation d'exonération de retenue (10.15.0, H7) : ses trois champs ne sont pas des
      // réglages de la fiche, et une attestation sans fin se refuse avant d'écrire quoi que ce soit.
      const exosCo = lireAttestationRS(data.company, v, $('#pf'));
      if (!exosCo) return false;
      // Le taux des nouvelles lignes d'une entreprise qui ne facture pas de TVA est AFFICHÉ à 0 %,
      // grisé : c'est ce que ses lignes porteront, pas un réglage qu'elle a choisi (10.14.0). Le
      // ranger écrasait son vrai taux — et le jour où elle passait au réel, chaque ligne naissait à
      // 0 % : la TVA collectée manquait sur ses factures, donc sur sa déclaration.
      if (!C.assujettiTVA({ ...data.company, ...v })) delete v.defaultVatRate;
      const et = {}, eten = {};
      Object.keys(v).forEach(k => { const m = k.match(/^(et|eten)_(\w+)_(subject|body)$/); if (m) { const bag = m[1] === 'et' ? et : eten; bag[m[2]] = bag[m[2]] || {}; bag[m[2]][m[3]] = v[k]; delete v[k]; } });
      Object.assign(data.company, v, { emailTemplates: et, emailTemplatesEn: eten, exonerationsRS: exosCo });
      // Un champ `type=number` vidé rend la CHAÎNE VIDE, pas zéro. Trois réglages étaient bornés
      // ici et trois autres du même bloc ne l'étaient pas : vider le timbre fiscal le mettait
      // silencieusement à 0 sur toutes les factures à venir, et vider un délai donnait 0 jour sur
      // un chemin (`newDocument`) et 30 sur l'autre (`invoiceFromQuote`, qui replie sur 30). Un
      // réglage vidé par erreur ne doit pas donner deux réponses différentes selon l'écran.
      data.company.defaultWithholdingRate = Number(data.company.defaultWithholdingRate) || 0;
      data.company.revenueTarget = Math.max(0, Number(data.company.revenueTarget) || 0);
      data.company.dormantDays = Math.max(1, Number(data.company.dormantDays) || 180);
      data.company.stampFee = Math.max(0, Number(data.company.stampFee) || 0);
      data.company.currency = C.normCurrency(data.company.currency);
      // 0 est un délai (« à réception ») : seule une case VIDE reprend les 30 jours (10.12.0).
      data.company.quoteValidityDays = C.delaiJours(data.company.quoteValidityDays, 30);
      data.company.paymentTermsDays = C.delaiJours(data.company.paymentTermsDays, 30);
      // Le seuil de retenue (9.1.1). Un seuil négatif n'a pas de sens et un seuil vidé veut dire
      // « aucun » : les deux retombent sur 0, la valeur qui ne fait rien.
      data.company.withholdingThreshold = Math.max(0, Number(data.company.withholdingThreshold) || 0);
      data.company.caisseLargeur = Number(data.company.caisseLargeur) === 58 ? 58 : 80;
      // (brique 125) Le plafond de remise de la caisse : vide, 0 % (toute remise demande un responsable).
      data.company.remiseCaisseAuDela = Math.min(100, Math.max(0, Number(data.company.remiseCaisseAuDela) || 0));
      // L'accord d'un responsable (brique 100) : oui ou non ; « non » est la valeur qui ne change rien (03 D11).
      data.company.encoursAccord = data.company.encoursAccord === true;
      // La remise permise sans accord (brique 103) : vide ou zéro, pas de seuil ; jamais plus de 100 %.
      data.company.remiseAccordAuDela = Math.min(100, Math.max(0, Number(data.company.remiseAccordAuDela) || 0));
      // Le montant d'une commande fournisseur permis sans accord (brique 114) : vide ou zéro, pas de seuil.
      data.company.commandeAccordAuDela = Math.max(0, Number(data.company.commandeAccordAuDela) || 0);
      save(true); applyTheme(); $('#brand-company').textContent = data.company.name || 'Ton entreprise';
      accorderNomDossier();     // le dossier porte le nom de la société, pas « Mon entreprise »
      // La licence est attachée au matricule fiscal : une fiche société modifiée se revérifie.
      rafraichirLicence().then(() => { drawLicencePanel(); redessinerBarre(); });
      setDirty = false; $('#save-bar').hidden = true;
      if ($('#set-manque-zone')) $('#set-manque-zone').innerHTML = bandeauManques(C.companyGaps(company()));
      dessinerAchatsHorsRegime();
      return true;
    };
    // Le régime choisi se lit tout de suite, AVANT d'enregistrer (9.4.2) : la phrase qui dit ce qu'il
    // fait, et le taux des nouvelles lignes, grisé à 0 % quand il ne facture pas de TVA.
    const selRegime = $('#pf select[name=taxRegime]');
    if (selRegime) selRegime.addEventListener('change', () => {
      const co = { ...data.company, taxRegime: selRegime.value };
      if ($('#regime-note')) $('#regime-note').innerHTML = noteRegime(co);
      const tv = $('#pf select[name=defaultVatRate]');
      // Au réel, le taux retrouve celui des réglages ; sinon, 0 % et grisé — la même règle que `defaultVat`.
      if (tv) { tv.disabled = !C.assujettiTVA(co); tv.value = String(C.defaultVat(co)); }
      dessinerCatalogueSansTva(); dessinerSourcesSansTva();
    });
    // Le taux choisi change ce que dit la note (des lignes à 0 %) et ce que le catalogue peut recevoir.
    const selTaux = $('#pf select[name=defaultVatRate]');
    if (selTaux) selTaux.addEventListener('change', () => {
      if ($('#regime-note')) $('#regime-note').innerHTML = noteRegime(regimeChoisi());
      dessinerCatalogueSansTva(); dessinerSourcesSansTva();
    });
    dessinerCatalogueSansTva(); dessinerSourcesSansTva();
    dessinerAchatsHorsRegime();
    if (selRegime) selRegime.addEventListener('change', dessinerAchatsHorsRegime);
    setGuard({ dirty: () => setDirty, what: 'les paramètres', save: applySettings, discard: applyTheme });
    $('#save').onclick = () => { if (applySettings()) toast('Paramètres enregistrés'); };
    // « Annuler », collé à « Enregistrer », jetait sans un mot tout ce qui venait d'être tapé —
    // y compris dix minutes de modèles d'email. Le mot dit maintenant ce qu'il fait, et il demande.
    $('#cancel-set').onclick = async () => {
      if (!await confirmDialog('Abandonner les modifications en cours des paramètres ?\n\nCe qui vient d\'être saisi et pas encore enregistré sera perdu.', 'Abandonner', true)) return;
      setDirty = false; applyTheme(); render();
    };
    // Le thème et les couleurs sont purement visuels et réversibles : les montrer tout de suite
    // évite de chercher « Enregistrer » pour savoir à quoi ça ressemble. L'enregistrement, lui,
    // reste explicite — la barre du bas apparaît comme pour tout le reste.
    const themeSel = $('#pf select[name=theme]');
    if (themeSel) themeSel.onchange = () => {
      const v = themeSel.value;
      const sombre = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.body.classList.toggle('dark', sombre);
      markSet();
    };
    // ---------- appairage du cabinet (6.2.0) ----------
    // Le cabinet remet à ses clients un petit fichier contenant sa clé publique. Une fois importé,
    // les paquets mensuels sont chiffrés POUR LUI : rien à transmettre, rien à retenir, et une clé
    // volée chez un client n'ouvre aucun paquet, pas même les siens.
    function drawCabinetPair() {
      const el = $('#cab-pair'); if (!el) return;
      if (bridge.dessinerMandat) { void bridge.dessinerMandat(el); return; }
      const cab = company().cabinet;
      const sig = data.cabinetSignature;
      el.innerHTML = cab && cab.publicKey
        ? `<p>Tes paquets mensuels sont chiffrés pour <strong>${h(cab.name || 'ton cabinet')}</strong>${cab.email ? ` <span class="muted">(${h(cab.email)})</span>` : ''}.</p>
           <table class="list compact"><tbody>
             <tr><td>Empreinte de sa clé ${info('cab.empreinte')}</td><td class="mono"><strong>${h(cab.fingerprint || '')}</strong></td></tr>
             <tr><td>Appairé le</td><td>${cab.pairedAt ? C.fmtDate(String(cab.pairedAt).slice(0, 10)) : '—'}</td></tr>
             ${sig ? `<tr><td>Signature de ses envois ${info('cab.signature')}</td><td><strong class="mono">${h(sig.empreinte)}</strong>
               <span class="small muted">retenue le ${C.fmtDate(C.jourDeLInstant(sig.depuis))}</span></td></tr>` : ''}
           </tbody></table>
           <p class="small muted mt">Vérifie cette empreinte <b>de vive voix</b> avec ton comptable la première fois : c'est ce qui garantit que tu as bien sa clé et pas celle de quelqu'un d'autre.</p>
           <div class="inline mt"><button class="btn" id="cab-repair">Remplacer par un autre cabinet…</button>${sig ? '<button class="btn" id="cab-oublier-sig">Oublier sa signature…</button>' : ''}<button class="btn btn-danger" id="cab-unpair">Retirer</button></div>`
        : `${sig ? `<p class="small">Signature retenue de ton cabinet ${info('cab.signature')} : <span class="mono"><strong>${h(sig.empreinte)}</strong></span>
             <span class="muted">(depuis le ${C.fmtDate(C.jourDeLInstant(sig.depuis))})</span> <button class="btn btn-sm" id="cab-oublier-sig">Oublier…</button></p>` : ''}
           <p>Aucun cabinet appairé. Tes paquets mensuels peuvent être protégés par un mot de passe, mais c'est moins pratique et moins sûr : un mot de passe se transmet, donc il fuite.</p>
           <p class="small muted">Demande à ton comptable son <b>fichier d'appairage</b> (il l'exporte depuis SkanFact Cabinet). Une fois importé ici, chaque paquet sera chiffré pour lui seul, sans mot de passe à échanger.</p>
           <p class="small muted">Ton comptable n'a pas encore l'application ? <b>SkanFact Cabinet</b> est gratuite pour lui : elle est jointe à chaque version de SkanFact, sous le même lien de téléchargement. Elle lit tes paquets, ne modifie jamais tes données et ne t'envoie rien.</p>
           <button class="btn btn-primary mt" id="cab-import">Importer le fichier du cabinet…</button>`;

      // 10.13.0 (test humain du pont) — le geste redessinait TOUTE la page : elle remontait en haut,
      // et le panneau qui porte la réponse (l'empreinte à vérifier de vive voix) repartait sous le
      // bas de l'écran, à côté d'un bandeau qui la recouvrait. Seul ce panneau dépend du cabinet :
      // on redessine CE panneau, là où l'on est, et ce qui est en cours de saisie ailleurs reste en
      // cours — rien ne l'enregistre à la place de l'utilisateur. Un fichier refusé dit sa phrase,
      // jamais « Error invoking remote method… » (règle 6.4.0).
      const doImport = async () => {
        try {
          const r = await bridge.importCabinet();
          if (!r) return;
          // Un AUTRE cabinet signe avec sa propre clé : garder la signature de l'ancien ferait refuser
          // sa première clôture. Réimporter le même fichier ne change rien.
          const avant = data.company.cabinet && data.company.cabinet.fingerprint;
          if (avant && avant !== r.fingerprint) data.cabinetSignature = null;
          data.company.cabinet = r;
          save(true); drawCabinetPair();
          toast(`Cabinet appairé : ${r.name || ''}`);
        } catch (e) { toast(plainError(e) || 'Fichier illisible', true); }
      };
      if ($('#cab-import')) $('#cab-import').onclick = doImport;
      if ($('#cab-repair')) $('#cab-repair').onclick = doImport;
      if ($('#cab-unpair')) $('#cab-unpair').onclick = async () => {
        if (!await confirmDialog('Retirer ce cabinet ? Tes prochains paquets ne seront plus chiffrés pour lui — il faudra revenir au mot de passe.', 'Retirer')) return;
        delete data.company.cabinet; data.cabinetSignature = null; save(true); drawCabinetPair();
        toast('Cabinet retiré');
      };
      if ($('#cab-oublier-sig')) $('#cab-oublier-sig').onclick = async () => {
        if (!await confirmDialog('Oublier la signature retenue de ton cabinet ?\n\nLe prochain fichier signé qu\'il t\'enverra sera retenu à sa place. Ne le fais que si ton comptable t\'a dit avoir changé de clé.', 'Oublier la signature')) return;
        data.cabinetSignature = null; save(true); drawCabinetPair();
        toast('Signature oubliée : la prochaine sera retenue');
      };
    }
    drawCabinetPair();
    if (bridge.dessinerQuarantaine && $('#quarantaine-panel')) bridge.dessinerQuarantaine($('#quarantaine-panel'));
    if (bridge.dessinerCompte && $('#compte-panel')) void bridge.dessinerCompte($('#compte-panel'), { modal, toast });
    if (bridge.dessinerEquipe && $('#equipe-panel')) void bridge.dessinerEquipe($('#equipe-panel'), { modal, toast, confirmDialog, nom: company().name });
    if (bridge.accesSupport && $('#acces-panel')) bridge.accesSupport.dessiner($('#acces-panel'), { toast: (t, erreur) => toast(t, erreur), nomDePage: p => PAGE_LABELS[p] || p });
    if (bridge.dessinerAbonnement && $('#abonnement-panel')) void bridge.dessinerAbonnement($('#abonnement-panel'), { ecrire: bridge.support ? () => ecrireAuSupport('question') : null });
    if (bridge.dessinerAppareils && $('#appareils-panel')) void bridge.dessinerAppareils($('#appareils-panel'));
    if (bridge.dessinerExport && $('#export-panel')) bridge.dessinerExport($('#export-panel'));
    if (bridge.dessinerSauvegardes && $('#mes-sauvegardes-panel')) void bridge.dessinerSauvegardes($('#mes-sauvegardes-panel'), { modal, toast });
    if (bridge.dessinerServices && $('#services-panel')) void bridge.dessinerServices($('#services-panel'));
    if (bridge.dessinerPaiement && $('#paiement-panel')) void bridge.dessinerPaiement($('#paiement-panel'));
    if (bridge.dessinerSignataire && $('#signataire-panel')) void bridge.dessinerSignataire($('#signataire-panel'));
    if (bridge.dessinerTtn && $('#ttn-panel')) void bridge.dessinerTtn($('#ttn-panel'));
    if (bridge.dessinerImprimante && $('#imprimante-panel')) void bridge.dessinerImprimante($('#imprimante-panel'));
    drawLicencePanel();
    drawEditeurPanel();
    drawUpdatePanel();
    // Les vérifications silencieuses (toutes les quatre heures) n'envoient rien quand il n'y a rien
    // à annoncer : sans cette relecture, la date affichée serait celle du démarrage, pour toujours.
    majLue = bridge.updateVersion().then(v => { upd.app = v; drawUpdatePanel(); ouvrirPanneauMaj(); }).catch(() => {});
    drawOcrPanel();
    $('#go-modules').onclick = () => navigate('#/modules');
    $$('#redo-setup, #redo-setup-2').forEach(b => b.onclick = rejouerAssistant);
    // « Signaler un problème » n'existait que dans l'Aide. C'est pourtant dans les Paramètres qu'on
    // va quand quelque chose ne marche pas — et le journal, qui est ce qui sert vraiment à dépanner,
    // n'était atteignable que depuis un message d'erreur de mise à jour.
    $('#set-support').onclick = supportForm;
    $('#set-idee').onclick = ideeForm;
    $('#set-log').onclick = () => bridge.journalDeLEcran ? voirJournal(bridge.journalDeLEcran()) : bridge.openLog();
    $('#set-aide').onclick = () => navigate('#/aide');
    $('#backup-now').onclick = async () => { const p = await bridge.createBackup(); toast(p ? 'Sauvegarde créée : elle est en tête de la liste ci-dessous.' : 'Rien à sauvegarder pour l\'instant'); drawExternal(); drawBackups(); };

    // La liste des sauvegardes, avec le bouton qui les remet. Chaque nom est traduit : « avant-demo »
    // ne veut rien dire pour quelqu'un qui n'a pas écrit le code. La quotidienne s'appelle
    // « skanfact-AAAA-MM-JJ.json » (storage.js) : la règle qui l'attendait en DÉBUT de nom ne l'a
    // jamais reconnue, et la plus fréquente des sauvegardes se disait « Sauvegarde », sans rien dire.
    const NOM_SAUVEGARDE = [
      [/^avant-demo/, 'Juste avant de charger l\'exemple'],
      [/^avant-restauration/, 'Juste avant une restauration'],
      [/^avant-effacement/, 'Juste avant « Tout effacer »'],
      [/^avant-import/, 'Juste avant un import'],
      [/^avant-beta/, 'Juste avant de recevoir les versions bêta'],
      [/^manuelle/, 'Sauvegarde que tu as demandée'],
      [/^skanfact-\d{4}-\d{2}-\d{2}\.json$/, 'Début de journée, avant la première modification']
    ];
    const nommer = f => (NOM_SAUVEGARDE.find(([re]) => re.test(f)) || [null, 'Sauvegarde'])[1];
    async function drawBackups() {
      if (!$('#backup-list')) return;
      let liste = [];
      try { liste = (await bridge.listBackups()) || []; } catch (_) {}
      // Redemandé APRÈS l'attente : changer de page pendant la question laisse une poignée détachée.
      const el = $('#backup-list'); if (!el) return;
      if (!liste.length) {
        el.innerHTML = '<p class="small muted">Aucune sauvegarde pour l\'instant. La première sera prise demain matin, ou tout de suite avec le bouton ci-dessus.</p>';
        return;
      }
      const vues = liste.slice(0, 12);
      el.innerHTML = `<p class="small muted mb"><b>Revenir en arrière.</b> Restaurer remet l'application dans l'état de la sauvegarde choisie.
        L'état actuel est mis de côté juste avant, donc ce geste se défait.</p>
        <table class="list compact"><thead><tr><th>Quand</th><th>Ce que c'était</th><th></th></tr></thead><tbody>
        ${vues.map(b => `<tr><td class="nw">${h(new Date(b.mtime).toLocaleString('fr-FR'))}</td>
          <td>${h(nommer(b.name))}<div class="small muted">${h(b.name)}</div></td>
          <td class="r"><button type="button" class="btn btn-sm" data-restore="${h(b.name)}">Restaurer…</button></td></tr>`).join('')}
        </tbody></table>
        ${liste.length > vues.length ? `<p class="small muted mt">${pl(liste.length - vues.length, 'sauvegarde')} plus ancienne${sPl(liste.length - vues.length)} dans le dossier.</p>` : ''}`;
      $$('[data-restore]', el).forEach(b => b.onclick = () => restaurer(b.dataset.restore));
    }
    // On REGARDE d'abord, et on dit ce qu'on va perdre. Sans ça, une restauration est un pari.
    async function restaurer(nom) {
      const vu = await bridge.peekBackup(nom);
      if (!vu || !vu.ok) return toast('Sauvegarde illisible : ' + ((vu && vu.error) || 'erreur inconnue'), true);
      const ici = { documents: data.documents.length, clients: data.clients.length, catalog: data.catalog.length };
      const dit = c => `${pl(c.documents, 'document')}, ${pl(c.clients, 'client')}, ${pl(c.catalog, 'prestation')}`;
      const ok = await confirmDialog(
        `Revenir à la sauvegarde du ${new Date(vu.mtime).toLocaleString('fr-FR')} ?\n${nommer(nom)}.\n\n`
        + `Elle contient : ${dit(vu.compte)}${vu.societe ? ' — ' + vu.societe : ''}${vu.demo ? '\n⚠ C\'est le jeu d\'exemple, pas de vraies données.' : ''}\n`
        + `Aujourd'hui tu as : ${dit(ici)}\n\n`
        + 'Ton état actuel est sauvegardé juste avant, sous « avant-restauration » : ce geste se défait.',
        'Restaurer', false)
        || false;
      if (!ok) return;
      if (!await closedWipeOk('Une restauration remplace tout.')) return;
      const r = await bridge.restoreBackup(nom);
      if (!r || !r.ok) return toast('Restauration impossible : ' + ((r && r.error) || 'erreur inconnue'), true);
      data = C.migrateData(r.data);
      try { window.__data = data; } catch (_) {}
      applyTheme();
      $('#brand-company').textContent = data.company.name || 'Ton entreprise';
      drawNav();
      toast('Restauré : ' + dit(vu.compte));
      navigate('#/dashboard');
    }
    drawBackups();
    const drawExternal = async () => {
      const i = await bridge.externalBackupInfo();
      // « Tes premiers pas » lit cet état ; sans cette ligne, choisir enfin un dossier de copie
      // laissait l'étape « Mettre tes données à l'abri » décochée jusqu'au prochain démarrage.
      // Une copie qui ÉCHOUE ne coche pas l'étape : un dossier iCloud pas encore synchronisé ou une
      // clé en lecture seule ne protègent rien. La règle vivait dans l'écran de sauvegarde de
      // l'assistant ; depuis que la copie est une étape des premiers pas (10.14.0), elle vit ici.
      const copieOk = !!(i && i.dir && !i.lastError);
      copieExterne = copieOk;
      dossierPartage = !!(i && i.partage);
      const el = $('#ext-status'); if (!el) return;
      el.innerHTML = i.dir ? `Dossier : <code>${h(i.dir)}</code>, sous-dossier <b>${h(i.sub || 'SkanFact')}</b> pour cette entreprise<br>${i.lastError ? `<span style="color:var(--danger)">Dernière copie impossible : ${h(i.lastError)}</span>` : (i.lastCopy ? `Dernière copie : ${h(new Date(i.lastCopy).toLocaleString('fr-FR'))}` : 'Copie à la prochaine sauvegarde.')}` : '<span class="muted">Aucun dossier de copie externe.</span>';
      $('#ext-remove').hidden = !i.dir;
      // Un seul vert sur l'onglet, et c'est l'étape suivante (U-11) : tant qu'aucune copie n'existe,
      // c'est elle ; une fois posée, « Choisir » devient « Changer » et le vert passe au mot de passe.
      const etapeMotDePasse = ok => {
        $('#ext-choose').classList.toggle('btn-primary', !ok);
        if ($('#sec-set')) $('#sec-set').classList.toggle('btn-primary', ok);
      };
      $('#ext-choose').textContent = i.dir ? 'Changer de dossier…' : 'Choisir un dossier…';
      // Tant que la copie échoue, l'étape suivante reste de la réparer : le vert ne passe pas au mot
      // de passe au-dessus d'une ligne rouge « Dernière copie impossible ».
      etapeMotDePasse(copieOk);
      // Un dossier PARTAGÉ ne reçoit pas de copie externe : il vit déjà hors de cet ordinateur, et
      // la recopier reviendrait à dupliquer ce que les deux postes s'échangent. C'est le
      // comportement depuis la 3.2.0, mais il n'était écrit nulle part — on le disait d'autant
      // moins qu'on ne pouvait pas partager un dossier existant. Le silence est le vrai danger d'un
      // dossier partagé (règle 3.2.0) : il vaut pour l'application autant que pour les données.
      const liste = await bridge.listDossiers();
      // La page a pu changer pendant l'attente (règle 7.6.0) : on n'écrit que dans un panneau encore
      // affiché — sinon `$('#ext-remove')` vaut null et l'exception échappe.
      if (!el.isConnected) return;
      const ouvert = (liste.dossiers || []).find(d => d.id === liste.current);
      if (ouvert && ouvert.shared) {
        el.innerHTML = `<span class="muted">Ce dossier est <b>partagé</b> : il vit déjà hors de cet ordinateur (<code>${h(ouvert.dir)}</code>), et c'est cette copie-là que les deux postes ouvrent. La copie externe ne s'applique qu'aux dossiers rangés sur cet ordinateur.</span>`;
        $('#ext-remove').hidden = true;
        // Proposer de choisir un dossier qui ne servirait pas serait un bouton qui ne fait rien.
        $('#ext-choose').hidden = true;
        etapeMotDePasse(true);
      }
    };
    drawExternal();

    // --- dossiers (plusieurs entreprises, et le dossier partagé à deux)
    async function drawDossiers() {
      const el = $('#dossiers-list'); if (!el) return;
      const r = await bridge.listDossiers();
      // Même règle (7.6.0), trouvée par e2e:aide qui quitte les Paramètres avant la réponse :
      // `#dev-name` n'existait plus, et « Cannot set properties of null » échappait à tout le monde.
      if (!el.isConnected) return;
      const nomPoste = $('#dev-name'); if (nomPoste) nomPoste.value = r.device.name || '';
      // Une ligne garde au plus UN bouton visible (7.29.0) : « Ouvrir ». Renommer et retirer passent
      // par le menu d'actions, où chacun dit ce qu'il fait — trois boutons côte à côte se lisaient
      // comme trois gestes de même poids, et « Retirer » était à un pixel de « Renommer ».
      el.innerHTML = `<table class="list compact"><thead><tr><th>Dossier</th><th>Emplacement</th><th class="row-actions-h"></th></tr></thead><tbody>
        ${r.dossiers.map(d => `<tr class="${d.id === r.current ? 'row-ok' : ''}">
          <td><strong>${h(d.name)}</strong>${d.id === r.current ? ' <span class="badge b-paid">ouvert</span>' : ''}${d.shared ? ' <span class="badge b-due">partagé</span>' : ''}</td>
          <td class="small muted">${h(d.dir)}</td>
          ${rowMenuCell(d.id, d.id === r.current ? '' : `<button type="button" class="btn btn-sm" data-open="${h(d.id)}">Ouvrir</button>`)}</tr>`).join('')}
      </tbody></table>
      ${(r.retires || []).length ? `<div class="small mt" id="dos-retires"><b>Retirés de la liste</b> <span class="muted">— leurs fichiers sont restés sur le disque</span>
        ${r.retires.map(d => `<div class="inline mt-s"><span>${h(d.name)}</span> <span class="muted">${h(d.dir)}</span> <button type="button" class="btn btn-sm" data-remettre="${h(d.id)}">Remettre dans la liste</button></div>`).join('')}</div>` : ''}`;
      $$('[data-open]', el).forEach(b => b.onclick = async () => {
        if (setDirty && !await confirmDialog('Des paramètres ne sont pas enregistrés. Changer de dossier maintenant ?', 'Changer quand même', undefined, { titre: 'Des paramètres ne sont pas enregistrés' })) return;
        await bridge.switchDossier(b.dataset.open);
      });
      bindRowMenus(el, id => {
        const d = r.dossiers.find(x => x.id === id); if (!d) return [];
        return [
          { icon: 'modifier', label: 'Renommer ce dossier', hint: 'Le nom affiché dans le menu du haut', run: () =>
            promptDialog('Renommer le dossier', 'Nom du dossier', d.name, async v => { await bridge.renameDossier({ id: d.id, name: v }); drawDossiers(); }, 'text', { info: 'data.dossiers' }) },
          ...(r.dossiers.length > 1 && d.id !== r.current ? [{ sep: true },
            { icon: 'supprimer', label: 'Retirer de la liste', hint: 'Ses fichiers restent sur le disque', danger: true, run: async () => {
              if (!await confirmDialog(`Retirer « ${d.name} » de la liste ? Ses fichiers ne sont PAS supprimés : ils restent dans ${d.dir}.\n\nIl apparaîtra sous « Retirés de la liste », dans ce panneau, avec un bouton pour l'y remettre.`, 'Retirer de la liste')) return;
              await bridge.forgetDossier(d.id);
            } }] : [])
        ];
      });
      $$('[data-remettre]', el).forEach(b => b.onclick = async () => {
        const res = await bridge.restoreDossier(b.dataset.remettre);
        if (res && res.ok) { toast(`« ${res.dossier.name} » est de retour dans la liste`); drawDossiers(); }
        else toast((res && res.error) || 'Ce dossier n\'a pas pu être remis dans la liste.', true);
      });
    }
    drawDossiers();
    $('#dos-add').onclick = nouvelleEntreprise;
    $('#dos-share').onclick = partagerDossier;
    $('#dos-join').onclick = rejoindreDossier;
    $('#dev-save').onclick = async () => {
      const r = await bridge.renameDevice($('#dev-name').value);
      if (r && r.ok) toast('Ce poste s\'appelle maintenant « ' + r.name + ' »');
    };

    // 10.14.0 — le mot de passe se propose AVEC la copie : elle part sur une clé USB ou un dossier
    // synchronisé, en clair, et c'est le seul moment où la question se comprend sans explication.
    // `aria-busy` tient le bouton « occupé » jusqu'à ce que la question soit posée : la visite guidée
    // (« Mettre mes données à l'abri ») attend ce moment pour passer à l'étape qui en parle — sans
    // lui, elle pouvait annoncer « C'est tout » une fraction de seconde avant que la fenêtre s'ouvre.
    $('#ext-choose').onclick = async () => {
      const b = $('#ext-choose');
      const i = await bridge.chooseExternalBackup();
      if (!i) return;
      if (i.lastError) { toast('Dossier choisi, mais copie impossible : ' + i.lastError, true); drawExternal(); return; }
      b.setAttribute('aria-busy', 'true');
      try {
        await drawExternal();
        if (security.encrypted) toast('Copie externe activée');
        else passwordDialog('set', { copie: i.dir });
      } finally { b.removeAttribute('aria-busy'); }
    };
    // Le panneau lui-même écrit « C'est le réglage le plus important de cette page » — et le bouton
    // qui l'éteint s'exécutait sans une question, à côté de celui qui l'allume.
    $('#ext-remove').onclick = async () => {
      if (!await confirmDialog('Arrêter la copie externe ?\n\nLes fichiers déjà copiés restent où ils sont, mais plus rien n\'y sera copié : si cet ordinateur tombe en panne, tout ce que tu enregistreras à partir de maintenant sera perdu.', 'Arrêter la copie', true)) return;
      await bridge.setExternalBackup(null); toast('Copie externe désactivée'); drawExternal();
    };
    if ($('#sec-set')) $('#sec-set').onclick = () => passwordDialog('set');
    if ($('#sec-change')) $('#sec-change').onclick = () => passwordDialog('change');
    if ($('#sec-remove')) $('#sec-remove').onclick = () => passwordDialog('remove');
    if ($('#sec-lock')) $('#sec-lock').onclick = lockNow;
    $('#open-backups').onclick = () => bridge.openBackups();
    $('#export-data').onclick = exportAll;
    $('#import-data').onclick = importAll;
    // Choisir une image redessine toute la page : sans ce `applySettings()` préalable, tout ce qui était
    // saisi et pas encore enregistré dans le formulaire disparaissait en silence (défaut de l'audit).
    // UNE porte pour le logo, le cachet et les couleurs : la fenêtre qui les montre sur la prochaine
    // facture. Le panneau gardait ses propres champs à côté — deux façons de modifier la même chose,
    // et « Voir sur une facture… » enregistrait d'abord ce qui était tapé, donc une couleur pas encore
    // vue (vu à la souris, 10.14.0). Ce qui est tapé AILLEURS dans la page s'enregistre d'abord, sinon
    // le redessin qui suit l'effacerait (5.2.1).
    $('#marque-apercu').onclick = () => { if (applySettings() === false) return; imageDeMarque(() => render()); };
    $('#load-demo').onclick = loadDemo;
    // Effacement définitif : on demande d'écrire le mot, pas juste de cliquer
    $('#wipe-data').onclick = () => {
      // Le décompte est calculé, pas écrit à la main : jusqu'à la 7.0.0 la fenêtre annonçait trois
      // chiffres et l'action en vidait sept listes sur trente — elle en vide maintenant trente, et
      // il serait malhonnête de continuer à n'en annoncer que trois.
      // On n'énumère que ce qui a un nom en français : les listes techniques (pièces supprimées,
      // archive de fusion, journal des clôtures) partent aussi, mais les annoncer n'apprendrait rien.
      const compte = Object.keys(C.LIST_LABELS)
        .filter(k => Array.isArray(data[k]) && data[k].length)
        .map(k => C.compteListe(k, data[k].length));
      const empruntee = !!(data.company && data.company.demo);
      // Rien à effacer : on le dit au lieu de faire taper EFFACER pour vider le néant (vérifier que
      // l'univers n'est pas vide, 7.0.0). La fiche société d'un exemple, elle, reste à rendre.
      if (!compte.length && !empruntee) {
        modal(`<h2>Rien à effacer</h2><p>Ce dossier ne contient encore aucune donnée : ni client, ni document, ni prestation. Tes paramètres société, eux, ne partent jamais avec « Tout effacer ».</p>
          <div class="modal-actions"><button class="btn btn-primary" data-close>Compris</button></div>`, null, null, { garde: false });
        return;
      }
      const emises = data.documents.filter(d => (d.type === 'facture' || d.type === 'avoir') && C.isIssued(d)).length;
      // Revenir en arrière se fait par la liste des sauvegardes, juste au-dessus : la fenêtre
      // envoyait vers « Importer », c'est-à-dire chercher un fichier dans un dossier caché — le chemin
      // que la 7.3.0 a remplacé parce que le jour d'une restauration est le pire jour pour l'apprendre.
      modal(`<h2>Tout effacer</h2>
        <p>Cette action supprime <b>tout ce que contient ce dossier</b> : ${h(compte.join(', '))}.${emises ? ` ${emises > 1 ? `Les ${emises} factures et avoirs émis partent aussi` : 'La pièce émise part aussi'}.` : ''}</p>
        <p class="small muted">Une sauvegarde est prise juste avant : pour revenir en arrière, le panneau <em>Sauvegardes</em> de cet onglet la montrera en tête de liste, avec son bouton <em>Restaurer…</em>. ${empruntee
          ? '<b>La fiche société part également</b>, parce qu\'elle vient du jeu d\'exemple : garder un matricule et un RIB inventés ferait partir ta première vraie facture dans le vide.'
          : 'Tes paramètres société sont conservés.'}</p>
        <form id="wf"><label class="field"><span>Pour confirmer, écris <b>EFFACER</b> ci-dessous</span><input type="text" name="w" autocomplete="off" spellcheck="false" placeholder="EFFACER"></label></form>
        <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-danger" id="ok" disabled>Tout effacer</button></div>`,
        (root, close) => {
          const inp = $('input[name=w]', root), ok = $('#ok', root);
          inp.oninput = () => { ok.disabled = inp.value.trim().toUpperCase() !== 'EFFACER'; };
          ok.onclick = async () => {
            close();
            if (!await closedWipeOk('Tout effacer.')) return;
            clearGuard();                       // les données partent : plus rien à protéger
            await bridge.createBackup('avant-effacement');
            // La liste des choses à vider se déduit des données (core.wipeData) : écrite à la main,
            // elle avait raté treize modules sur vingt — après le jeu d'exemple il restait de faux
            // fournisseurs, de faux salariés et de faux comptes bancaires.
            // La fiche société est conservée SAUF si elle vient de l'exemple : garder un faux
            // matricule et un faux RIB, c'est envoyer la première vraie facture dans le vide.
            const identiteEmpruntee = !!(data.company && data.company.demo);
            C.wipeData(data, { garderSociete: !identiteEmpruntee });
            save(true);
            toast(identiteEmpruntee
              ? 'Données effacées — la fiche société de l\'exemple aussi : remplis la tienne dans Paramètres'
              : 'Données effacées');
            if (identiteEmpruntee) allerParametres('societe', 'p-identite'); else render();
            $('#brand-company').textContent = data.company.name;
          };
        },
        // Un mot de CONFIRMATION n'est pas un travail à protéger (10.12.0) : renoncer à tout effacer
        // ne demande pas « Abandonner cette saisie ? ». Le jumeau du Cabinet (`confirmTyped`) n'a pas
        // de formulaire, donc pas de garde-fou d'office : les deux répondent pareil.
        null, { garde: false });
    };
  };

  // ---------- Aide ----------
  // ---------- Tous les modules (7.0.0) ----------
  // La contrepartie de la barre latérale filtrée. Elle n'a de sens que si cette page existe : sans
  // elle, masquer un module reviendrait à le supprimer pour quelqu'un qui ne connaît pas la palette.
  // Trois règles s'y voient à l'œil nu :
  //   — le cœur du métier ne se décoche pas (il n'a même pas de case) ;
  //   — tout le reste se décoche ET se recoche, toujours : une case qui se change en cadenas sous le
  //     doigt (ce qu'elle faisait jusqu'à la 7.12.0 dès que le module contenait une ligne) laissait
  //     le module dans le menu sans plus aucun moyen de revenir en arrière ;
  //   — décocher ne supprime rien : la phrase le dit avant, pas après, et masquer un module qui
  //     contient quelque chose se confirme, en nommant ce qui reste atteignable.
  routes.modules = () => {
    const co = company();
    const choisis = Array.isArray(co.modules) ? co.modules.slice() : null;
    const dessine = () => {
      const lignes = C.MODULES.map(m => {
        const n = C.moduleCount(data, m.id);
        const why = C.moduleWhy(data, m.id);
        const on = C.moduleOn(data, m.id);
        const pages = C.PAGES.filter(p => p.module === m.id && !p.horsMenu).map(p => p.titre).join(' · ');
        const contenu = n ? `${n} élément${n > 1 ? 's' : ''} enregistré${n > 1 ? 's' : ''}.` : 'Rien d\'enregistré pour l\'instant.';
        const note = m.toujours ? 'Toujours affiché : c\'est le cœur du métier.'
          : why === 'tout' ? `Affiché : tu n'as encore rien retiré du menu. ${contenu}`
          : why === 'masque' ? `Hors du menu. ${contenu}${n ? ' Rien n\'est supprimé.' : ''}`
          : contenu;
        return `<div class="mod-row${on ? ' on' : ''}">
          <label class="mod-check">${m.toujours
            ? `<span class="mod-lock" title="${h(note)}">★</span>`
            : `<input type="checkbox" data-mod="${h(m.id)}" data-n="${n}" ${on ? 'checked' : ''}>`}</label>
          <div class="mod-txt">
            <div class="mod-t">${h(m.label)}${(licence.reserves || []).includes(m.id) ? ' <span class="badge">offre Complet : tu peux lire, pas créer</span>' : ''}</div>
            <div class="small muted">${h(m.quoi)}</div>
            <div class="small muted mt-s"><b>Pages :</b> ${h(pages)} · ${h(note)}</div>
          </div>
          <div class="mod-go">${on && pages ? `<button class="btn btn-sm" data-open="${h(m.id)}">Ouvrir</button>` : ''}</div>
        </div>${(m.sousModules || []).map(sm => {
          // Une option payante est **décochée par défaut** : on ne fait pas apparaître chez
          // quelqu'un un écran qu'il n'a pas demandé et qui se paie. Et la case reste ACTIVE même
          // si l'option manque à la licence — un réglage qui se retire la possibilité de revenir
          // en arrière est le piège de la 7.12.0. C'est `optionBlock` qui parle de la licence,
          // au moment où on ouvre l'onglet, pas cette case.
          const smOn = C.sousModuleOn(data, sm.id);
          const aOption = (licence.options || []).includes(sm.option);
          return `<div class="mod-row mod-sub${smOn ? ' on' : ''}" id="sm-${h(sm.id.replace(/\./g, '-'))}">
            <label class="mod-check"><input type="checkbox" data-sousmod="${h(sm.id)}" ${smOn ? 'checked' : ''}></label>
            <div class="mod-txt">
              <div class="mod-t">${h(sm.label)} <span class="badge">${aOption ? 'dans ton offre' : 'offre Complet'}</span></div>
              <div class="small muted">${h(sm.quoi)}</div>
              ${aOption ? '' : `<div class="small muted mt-s">Ils ne sont pas dans ton offre ${h(licence.offreLabel || 'Essentiel')} : les trois onglets s'affichent avec un cadenas et disent quoi faire.</div>`}
            </div><div class="mod-go"></div>
          </div>`;
        }).join('')}`;
      }).join('');
      $('#mod-list').innerHTML = lignes;
      $$('[data-mod]').forEach(cb => cb.onchange = async () => {
        const id = cb.dataset.mod;
        const n = Number(cb.dataset.n) || 0;
        // Masquer un module qui contient quelque chose est un geste légitime — c'est son menu — mais
        // il mérite une phrase : ce qu'il advient des données (rien), par où la page reste
        // atteignable, et le fait qu'elle revienne d'elle-même le jour où il y enregistre autre
        // chose. Sans elle, décocher « Achats » après trente factures fournisseur fait peur.
        if (!cb.checked && n) {
          const ok = await confirmDialog(
            `Retirer « ${C.moduleById(id).label} » du menu ?\n\n`
            + `Il contient ${n} élément${n > 1 ? 's' : ''} : rien n'est supprimé et aucun calcul ne change. `
            + `Ses pages restent atteignables par la recherche (${MOD}+K) et par leur adresse, et le module revient tout seul `
            + 'dans le menu le jour où tu y enregistres quelque chose de nouveau.',
            'Retirer du menu', false);   // rien n'est détruit : le bouton n'a pas à être rouge
          if (!ok) { cb.checked = true; return; }
        }
        const liste = Array.isArray(company().modules) ? company().modules.slice() : C.MODULES.map(m => m.id);
        const i = liste.indexOf(id);
        if (cb.checked && i < 0) liste.push(id);
        if (!cb.checked && i >= 0) liste.splice(i, 1);
        company().modules = liste;
        save();
        dessine();
        drawNav();
        // Le panneau se redessine (les explications changent au premier choix) : sans ce rappel, le
        // focus retombait sur le corps de la page et il fallait reprendre la souris à chaque case.
        const encore = $(`[data-mod="${id}"]`);
        if (encore) encore.focus();
        toast(cb.checked ? 'Affiché dans le menu' : 'Retiré du menu — rien n\'est supprimé, et la case reste là pour revenir en arrière');
      });
      $$('[data-sousmod]').forEach(cb => cb.onchange = () => {
        const id = cb.dataset.sousmod;
        // `null` (aucun choix enregistré) devient la liste de tous les modules VISIBLES plus le
        // sous-module : sans le « plus », cocher l'option masquerait d'un coup tout le reste du
        // menu. C'est la règle « on ne masque jamais ce que quelqu'un a saisi » (7.0.0).
        const liste = Array.isArray(company().modules) ? company().modules.slice() : C.MODULES.map(m => m.id);
        const i = liste.indexOf(id);
        if (cb.checked && i < 0) liste.push(id);
        if (!cb.checked && i >= 0) liste.splice(i, 1);
        company().modules = liste;
        save();
        dessine();
        const encore = $(`[data-sousmod="${id}"]`);
        if (encore) encore.focus();
        toast(cb.checked ? 'Affiché dans la page Comptabilité' : 'Retiré — rien n\'est supprimé, et la case reste là');
      });
      $$('[data-open]').forEach(b => b.onclick = () => {
        const p = C.PAGES.find(x => x.module === b.dataset.open && !x.horsMenu);
        if (p) navigate('#/' + p.id);
      });
    };
    $('#view').innerHTML = `<div class="page-head"><h1>Tous les modules</h1>
      <div class="actions">${backButton('#/dashboard')}${choisis ? '<button class="btn" id="mod-all">Tout afficher</button>' : ''}</div></div>
      <p class="lead">SkanFact sait faire beaucoup de choses. Tu n'en as pas besoin le premier jour, et
      une liste de ${C.PAGES.filter(p => !p.horsMenu).length} entrées dans le menu ne t'aide pas à trouver la bonne.</p>
      <div class="panel">
        <p class="small muted mb"><b>Retirer un module du menu ne supprime rien</b> et ne désactive aucun calcul :
        ses pages restent atteignables par la recherche (${MOD}+K) et par leur adresse, et la case reste
        là pour le remettre. Un module que tu as masqué <b>revient tout seul</b> le jour où tu y
        enregistres quelque chose — on ne cache jamais ton travail.</p>
        <div id="mod-list"></div>
      </div>`;
    dessine();
    bindBack('#/dashboard');
    if ($('#mod-all')) $('#mod-all').onclick = () => {
      company().modules = null; save(); drawNav(); render();
      toast('Toutes les pages sont affichées');
    };
  };

  // L'aide comptait trente-deux articles présentés en une liste plate de trente-deux titres, sans
  // recherche : quelqu'un qui bute sur « assiette » ne pouvait pas taper « assiette ». Il devait
  // deviner dans lequel des trente-deux ça se trouve — et le glossaire était l'avant-dernier.
  // La recherche lit aussi le CORPS des articles : c'est ce qui permet de trouver un mot qui
  // n'apparaît dans aucun titre.
  let aideQ = '';
  const sansBalises = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const aideMots = q => C.plier(q || '').trim().split(/\s+/).filter(Boolean);
  // Plier sans changer la LONGUEUR (10.12.0) : le surlignage et l'extrait retrouvent le mot par sa
  // position dans le texte plié, puis découpent le texte d'origine aux mêmes positions. Une lettre
  // dont le pliage changerait la longueur (un accent déjà décomposé) est gardée telle quelle.
  const plierPareil = s => Array.from(String(s || ''), ch => { const f = C.plier(ch); return f.length === ch.length ? f : ch; }).join('');

  // La recherche CLASSE ses résultats (7.27.0). Taper « tva » rendait dix-sept articles sur
  // trente-deux, dans l'ordre où ils sont écrits dans guide.js : « Démarrer : tes premiers pas »
  // arrivait premier, et « TVA, timbre fiscal et retenue à la source » quatrième. Une liste non
  // classée de dix-sept titres ne vaut pas mieux que la liste des trente-deux qu'elle remplace.
  // Le titre d'abord, le sous-titre ensuite, le corps en dernier.
  function aideFiltre(arts, q) {
    const mots = aideMots(q);
    if (!mots.length) return arts;
    const notes = [];
    arts.forEach((a, i) => {
      const titre = C.plier(a.title), sous = C.plier(a.sub);
      const corps = C.plier(sansBalises(a.body || ''));
      if (!mots.every(m => titre.includes(m) || sous.includes(m) || corps.includes(m))) return;
      const rang = mots.every(m => titre.includes(m)) ? 0
        : mots.every(m => `${titre} ${sous}`.includes(m)) ? 1 : 2;
      notes.push({ a, rang, i });
    });
    return notes.sort((x, y) => x.rang - y.rang || x.i - y.i).map(x => x.a);
  }

  // Surligner le mot cherché, sans jamais laisser passer de HTML : on découpe, on échappe chaque
  // morceau, et on recolle avec des <mark>. Échapper APRÈS aurait mangé les balises qu'on vient de
  // poser ; échapper AVANT décalerait toutes les positions (« l'» devient « &#39; »).
  function aideSurligne(texte, mots) {
    if (!mots.length) return h(texte);
    const bas = plierPareil(texte);
    const coupes = [];
    mots.forEach(m => { let k = bas.indexOf(m); while (k >= 0) { coupes.push([k, k + m.length]); k = bas.indexOf(m, k + m.length); } });
    coupes.sort((x, y) => x[0] - y[0]);
    let out = '', pos = 0;
    coupes.forEach(([d, f]) => {
      if (d < pos) return;                          // deux mots qui se chevauchent : on garde le premier
      out += h(texte.slice(pos, d)) + '<mark>' + h(texte.slice(d, f)) + '</mark>';
      pos = f;
    });
    return out + h(texte.slice(pos));
  }

  // L'extrait : le bout de phrase où le mot cherché se trouve vraiment. Sans lui, un résultat dont
  // le mot n'est ni dans le titre ni dans le sous-titre ne dit pas pourquoi il est là.
  function aideExtrait(a, q) {
    const mots = aideMots(q);
    // `sansBalises` remplace chaque balise par une espace : un titre collé à la phrase suivante
    // donnerait « comptable . La TVA ». On recolle la ponctuation, sinon l'extrait a l'air cassé.
    const texte = sansBalises(a.body || '').replace(/\s+([.,)])/g, '$1').trim();
    const bas = plierPareil(texte);
    let i = -1;
    mots.forEach(m => { const k = bas.indexOf(m); if (k >= 0 && (i < 0 || k < i)) i = k; });
    if (i < 0) return '';
    let d = Math.max(0, i - 55);
    const f = Math.min(texte.length, i + 125);
    if (d > 0) { const e = texte.indexOf(' ', d); if (e > 0 && e < i) d = e + 1; }
    return aideSurligne((d > 0 ? '… ' : '') + texte.slice(d, f).trim() + (f < texte.length ? ' …' : ''), mots);
  }

  // ---------- l'Aide (refonte 7.23.0, mise en page revue en 7.27.0) ----------
  //
  // 7.23.0 avait remplacé la liste plate par sept cartes : on choisit un TERRITOIRE avant de
  // choisir un titre. La capture a montré ce que la relecture ne montrait pas :
  //
  //   — les sept cartes étaient identiques, grises, et n'annonçaient que leur NOMBRE d'articles.
  //     Rien ne distinguait « Ton équipe » d'« Encaisser », et 400 px de vide restaient dessous ;
  //   — ouvrir un thème redessinait la liste ENTIÈRE des sept thèmes juste en dessous, le thème
  //     ouvert compris, sans état actif ni moyen de refermer ;
  //   — le fil d'Ariane s'empilait verticalement au milieu de l'écran (voir plus bas) ;
  //   — « article suivant » se posait à l'extrémité droite de la PAGE, 250 px à côté de la colonne
  //     de l'article qu'il prolonge.
  //
  // Maintenant : une pastille colorée par thème qui mène à sa section, et les trente-deux articles
  // visibles d'un coup, rangés et colorés. Un plan montre le territoire ; il ne le cache pas
  // derrière un clic qui ne promet qu'un nombre.
  const aideIcone = t => `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>`;

  const aideChip = t => `<button class="help-chip th-${h(t.id)}" data-theme="${h(t.id)}">${aideIcone(t)}${h(t.label)} <span class="hc-n">${t.articles.length}</span></button>`;

  const aideSection = t => `<section class="help-sec th-${h(t.id)}" id="sec-${h(t.id)}" data-sec="${h(t.id)}">
      <header>
        <span class="hs-ico">${aideIcone(t)}</span>
        <div class="hs-t"><h2>${h(t.label)}</h2><p class="hs-s">${h(t.sub)}</p></div>
        <span class="hs-n">${pl(t.articles.length, 'article')}</span>
      </header>
      <div class="help-arts">${t.articles.map(id => {
        const a = G.ARTICLES.find(x => x.id === id);
        return a ? `<button class="help-art" data-art="${h(a.id)}"><span class="ht">${h(a.title)}</span><span class="hs">${h(a.sub)}</span></button>` : '';
      }).join('')}</div>
    </section>`;

  const aideAccueil = () => `<div class="help-rail">${G.THEMES.map(aideChip).join('')}</div>
    <div class="help-secs">${G.THEMES.map(aideSection).join('')}</div>`;

  // Le sommaire d'un article long. Onze intertitres dans « Ta comptabilité mois par mois », sept
  // dans le glossaire et ses cinquante-neuf entrées : sans sommaire on fait défiler à l'aveugle, et
  // on ne sait même pas ce que l'article contient avant de l'avoir lu en entier. En dessous de
  // quatre intertitres il n'y a rien à résumer — un sommaire de deux lignes est du bruit.
  const AIDE_SOMMAIRE_MIN = 4;
  function aideCorps(a) {
    const titres = [...a.body.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map(m => sansBalises(m[1]).trim());
    let i = 0;
    const corps = clavierLocal(a.body).replace(/<h3>/g, () => `<h3 id="art-h-${i++}">`);
    const sommaire = titres.length >= AIDE_SOMMAIRE_MIN
      ? `<aside class="help-toc"><div class="tt">Dans cet article</div><ol>${titres
        .map((t, k) => `<li><button data-h="art-h-${k}">${h(t)}</button></li>`).join('')}</ol></aside>`
      : '';
    return { corps, sommaire };
  }

  // ---------- La visite guidée (10.14.0) ----------
  // Skander : « quelqu'un qui découvre l'application n'a pas envie de lire la page Aide ; il faut
  // pouvoir toujours le guider pour chaque étape afin de faire quelque chose, et couvrir toute
  // l'app ». Le moteur vit dans `visite.js` (sans métier), le contenu dans `visites.js` ; ici, ce
  // qui les relie à l'application : la navigation, la progression, et la page « Me guider ».
  //
  // La progression décrit la PERSONNE, pas l'entreprise : elle vit sur ce poste (`prefs`), comme la
  // taille des pages, et ne part ni dans les données ni dans les sauvegardes — changer d'entreprise
  // ne fait pas redécouvrir SkanFact.
  const VISITES_PREF = 'visites';
  const visitesEtat = () => Object.assign({ faites: {}, reprise: null, vues: {}, proposer: true }, prefs.get(VISITES_PREF, {}) || {});
  const visitesPoser = modif => { const e = visitesEtat(); modif(e); prefs.set(VISITES_PREF, e); };
  let VISITES = null;
  // (1.273.0, L9 ; docs/leger.md) Les visites ne partent plus avec la page : `visite.js` (le moteur) et `visites.js` (le
  // contenu) se chargent au premier geste qui les demande (`chargerVisites`). Avant, aucune visite n'existe : la liste
  // est vide, et ce qui les montre les charge d'abord.
  const visitesChargees = () => typeof SkanVisites !== 'undefined' && typeof Visite !== 'undefined';
  const visiteEnCours = () => typeof Visite !== 'undefined' && Visite.enCours();
  let visitesInstallees = false;
  async function chargerVisites(silencieux) {
    const ok = (typeof Visite !== 'undefined' || await chargerScript('visite.js'))
      && (typeof SkanVisites !== 'undefined' || await chargerScript('visites.js'))
      && await chargerTextes();
    if (!ok) {
      if (!silencieux) toast(SANS_RESEAU_VISITES, true);
      return false;
    }
    if (!visitesInstallees) { visitesInstallees = true; installerVisites(); }
    return true;
  }
  // Ce que l'accueil et la porte du premier jour disent de la découverte et des premiers pas AVANT que les visites soient
  // chargées : leur durée et leurs chapitres. Un test le confronte aux visites (tests/v10/visites-en-ligne.test.ts) :
  // un résumé qui ne dirait plus la même chose qu'elles fait tomber le test, jamais l'accueil.
  const RESUME_VISITES = { decouvrir: { duree: '12 min', chapitres: 12 }, 'premiers-pas': { duree: '3 min', chapitres: 1 } };
  function resumeVisite(id) {
    const v = visiteParId(id);
    if (v) return { duree: v.duree, chapitres: Visite.chapitres(v.etapes || []).length };
    return RESUME_VISITES[id] || null;
  }
  const visites = () => VISITES || (!visitesChargees() ? [] : VISITES = SkanVisites.parcours({
    data: () => data, premier: premierObjet, estDemo: () => C.estDemo(data), editeur: () => !!licence.editeur, Visite, G,
    // Les données sont-elles déjà chiffrées ? La visite du mot de passe n'a alors plus rien à faire.
    chiffre: () => !!security.encrypted
  }).filter(v => !(bridge.visitesAbsentes || []).includes(v.id)));
  const visiteParId = id => visites().find(v => v.id === id) || null;
  // Les visites qui concernent CE poste : celle des licences n'existe que chez l'éditeur.
  const visitesVisibles = () => visites().filter(v => typeof v.visible !== 'function' || v.visible());
  const visitePage = route => visiteParId('page-' + route);
  // La découverte laissée en route, et l'étape où elle reprend — ou null.
  const decouverteEnPause = () => { const r = visitesEtat().reprise; return r && r.id === 'decouvrir' ? r : null; };

  // Le premier objet d'une sorte, pour qu'une visite s'ouvre sur quelque chose de VRAI — la fiche
  // d'un client qui a des pièces, une facture qui attend son paiement — plutôt que sur une page
  // vide. Choisi dans les données du moment : l'exemple a tout, une entreprise neuve n'a rien, et la
  // visite dit alors ce qui manque (`manque`) au lieu de s'ouvrir sur le néant.
  function premierObjet(cle) {
    if (!data) return null;
    const docs = data.documents || [];
    const co = company();
    const recent = liste => liste.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const lien = (prefixe, x) => (x ? prefixe + x.id : null);
    const devis = docs.filter(d => d.type === 'devis' && (d.lines || []).length);
    const factures = docs.filter(d => d.type === 'facture');
    const st = d => C.effectiveStatus(d, data, co);
    // Le plus rempli : UN compte par candidat (10.14.0). Le tri appelait `compte` à chaque
    // comparaison, et chaque compte relisait toutes les pièces — six secondes sur « Me guider » avec
    // mille cinq cents clients. À égalité, le premier de la liste, comme le tri stable d'avant.
    const plusRempli = (liste, compte) => {
      let meilleur, max = -Infinity;
      liste.forEach(x => { const n = compte(x); if (n > max) { max = n; meilleur = x; } });
      return meilleur;
    };
    const parCle = (liste, cle) => { const m = new Map(); liste.forEach(x => m.set(x[cle], (m.get(x[cle]) || 0) + 1)); return m; };
    // La pièce OUVERTE à l'écran passe avant toutes les autres quand elle convient (10.14.1, S-03) :
    // « Enregistrer un paiement », lancé depuis « Guide-moi » sur une facture, guide sur CETTE facture —
    // pas sur la plus récente de la liste, trois écrans plus loin. Une seule règle pour le choix de la
    // cible et pour « ce geste se fait-il ici ? » (`ici` dans les visites).
    const ouverte = prefixe => { const m = new RegExp('^#/' + prefixe + '/([^/]+)$').exec(location.hash); return m && m[1] !== 'new' ? m[1] : null; };
    const docIci = (() => { const id = ouverte('doc'); return id ? docById(id) : null; })();
    const achatIci = (() => { const id = ouverte('achat'); return id ? (data.purchases || []).find(p => p.id === id) || null : null; })();
    const pref = (x, ok) => (x && ok(x) ? x : null);
    const aFacturer = d => d.type === 'devis' && (d.lines || []).length && !piecesDuDevis(d.id).totales.length;
    const ouverteSt = d => d.type === 'facture' && ['retard', 'partielle', 'envoyée'].includes(st(d));
    const emiseSt = d => d.type === 'facture' && d.status !== 'brouillon' && st(d) !== 'annulée';
    const du = p => { try { return C.purchaseBalance(p, co, data).remaining > 0.0005; } catch (_) { return false; } };
    switch (cle) {
      case 'doc':
      case 'devis': {
        // Celui qui montre le plus : un devis accepté pas encore facturé porte « Facturer ce devis ».
        const acceptes = devis.filter(d => d.status === 'accepté' && !piecesDuDevis(d.id).totales.length);
        return lien('#/doc/', pref(docIci, d => d.type === 'devis' && (d.lines || []).length) || recent(acceptes) || recent(devis.filter(d => d.status === 'envoyé')) || recent(devis));
      }
      // Ce qu'on envoie depuis la pièce ouverte : un devis, une facture ou un avoir émis ; sinon un devis.
      case 'pieceAEnvoyer': return lien('#/doc/', pref(docIci, d => (d.lines || []).length && (d.type === 'devis' || (['facture', 'avoir'].includes(d.type) && d.status !== 'brouillon')))
        || recent(devis.filter(d => d.status === 'brouillon')) || recent(devis));
      // Le devis ouvert, s'il n'est pas encore facturé ; sinon le plus parlant (accepté d'abord).
      case 'devisAFacturer': return lien('#/doc/', pref(docIci, aFacturer) || recent(devis.filter(d => d.status === 'accepté' && aFacturer(d))) || recent(devis));
      case 'devisBrouillon': return lien('#/doc/', pref(docIci, d => d.type === 'devis' && d.status === 'brouillon' && (d.lines || []).length) || recent(devis.filter(d => d.status === 'brouillon')));
      case 'devisAccepte': return lien('#/doc/', pref(docIci, d => d.type === 'devis' && d.status === 'accepté' && aFacturer(d)) || recent(devis.filter(d => d.status === 'accepté' && !piecesDuDevis(d.id).totales.length)));
      case 'factureBrouillon': return lien('#/doc/', pref(docIci, d => d.type === 'facture' && d.status === 'brouillon') || recent(factures.filter(d => d.status === 'brouillon')));
      case 'factureOuverte': return lien('#/doc/', pref(docIci, ouverteSt) || recent(factures.filter(ouverteSt)));
      case 'factureEmise': return lien('#/doc/', pref(docIci, emiseSt) || recent(factures.filter(emiseSt)));
      // Ce qu'une visite « faire » doit trouver pour avoir un sens (10.14.1) : une facture en retard à
      // relancer, un achat qui attend son règlement, un mois terminé à clôturer. Sans eux, la visite
      // dit POURQUOI elle ne peut pas se lancer, au lieu de finir sur un geste impossible.
      case 'factureRetard': return lien('#/doc/', pref(docIci, d => d.type === 'facture' && st(d) === 'retard') || recent(factures.filter(d => st(d) === 'retard')));
      case 'achatDu': return lien('#/achat/', pref(achatIci, du) || recent((data.purchases || []).filter(du)));
      case 'moisACloturer': return C.closableMonths(data, C.today()).length ? '#/compta' : null;
      case 'client': { const n = parCle(docs, 'clientId'); return lien('#/client/', plusRempli(data.clients || [], c => n.get(c.id) || 0)); }
      case 'contrat': return lien('#/contrat/', (data.recurring || []).find(r => r.active !== false) || (data.recurring || [])[0]);
      case 'fournisseur': { const n = parCle(data.purchases || [], 'supplierId'); return lien('#/fournisseur/', plusRempli(data.suppliers || [], s => n.get(s.id) || 0)); }
      case 'achat': return lien('#/achat/', achatIci || recent((data.purchases || []).filter(p => (p.lines || []).length > 1)) || recent(data.purchases || []));
      case 'affaire': { const n = parCle(docs, 'projectId'); return lien('#/affaire/', plusRempli(data.projects || [], p => n.get(p.id) || 0)); }
      case 'salarie': return lien('#/salarie/', C.activeEmployees(data)[0] || (data.employees || [])[0]);
      case 'article': return lien('#/article/', (data.catalog || []).find(c => c.tracked));
      case 'immo': return lien('#/immo/', (data.assets || []).find(a => !a.disposal) || (data.assets || [])[0]);
      // La pièce que vise la première question du comptable encore sans réponse : c'est là que la
      // question s'affiche aussi, et qu'on y répond sans chercher.
      case 'pieceQuestion': {
        const q = (data.questionsCabinet || []).find(x => x.piece && !(x.reponse && String(x.reponse.texte || '').trim()));
        if (!q) return null;
        const doc = docs.find(d => d.number === q.piece);
        if (doc) return '#/doc/' + doc.id;
        const achat = (data.purchases || []).find(p => p.number === q.piece);
        return achat ? '#/achat/' + achat.id : null;
      }
      // Un achat à qui il manque son justificatif — celui que le comptable réclame d'abord, sinon le
      // plus récent. Sans achat du tout, rien : la visite dit alors ce qui manque.
      case 'achatSansJustif': {
        const sans = (data.purchases || []).filter(p => p.kind !== 'acompte' && C.sansJustificatif(p));
        const reclame = (data.questionsCabinet || []).find(x => x.attendu === 'piece' && !(x.reponse && String(x.reponse.texte || '').trim()));
        const vise = reclame && sans.find(p => p.number === reclame.piece);
        // L'achat ouvert passe avant : joindre un second fichier à une pièce qui en a déjà un reste un geste juste.
        return lien('#/achat/', pref(achatIci, p => p.kind !== 'acompte') || vise || recent(sans) || recent(data.purchases || []));
      }
      default: return null;
    }
  }

  // `p` : la visite, ou son identifiant (1.273.0, L9 : les visites se chargent alors d'abord).
  async function lancerVisite(p, depart) {
    if (typeof p === 'string') p = await chargerVisites() ? visiteParId(p) : null;
    if (!p) return;
    // Rien ne reste ouvert par-dessus l'écran qu'on va montrer : la palette, une bulle « i », une
    // liste déroulante, le sélecteur d'entreprise, un menu.
    closePalette(); closeInfoPop(); if (closeOverlay) closeOverlay(); fermerDossiers(); closeMenus();
    // Une visite qui a besoin de ce que les données n'ont pas (une facture à encaisser, un devis à
    // envoyer) le DIT, et propose celle qui le fabrique : un bouton qui accepte le clic et ne fait
    // rien est pire qu'un bouton absent (7.0.0). La page « Me guider » éteint déjà ces boutons ;
    // ce chemin-ci sert à la palette, aux suites et aux bandeaux.
    const manque = visiteManque(p);
    if (manque) { expliquerManque(p, manque); return; }
    // La découverte se fait sur l'EXEMPLE : elle le charge d'abord (avec sa question et sa
    // sauvegarde), et « Démarrer dans ma vraie entreprise » en sort d'abord. Une visite qui dirait
    // « tu es dans l'exemple » sur de vraies données, ou l'inverse, mentirait dès sa première bulle.
    if (p.exemple && !C.estDemo(data) && !await loadDemo(p.id)) return;
    if (p.reel && C.estDemo(data) && !await demoSortie(p.id)) return;
    // La proposition « Première fois sur cette page ? » n'a plus d'objet pendant une visite.
    fermerAppelGuide();
    Visite.lancer(p, depart || 0);
    // Le bouton « Visite guidée » du bandeau de l'exemple disparaît pendant la visite.
    const bv = $('#demo-visite'); if (bv) bv.remove();
  }
  // Ce qui manque à une visite pour pouvoir se dérouler, ou null. UNE fonction pour le bouton éteint
  // de « Me guider » et pour le refus de `lancerVisite` : les deux ne peuvent pas diverger (9.4.5).
  function visiteManque(p) {
    if (!p || typeof p.si !== 'function') return null;
    let ok = true;
    try { ok = !!p.si(); } catch (_) { ok = false; }
    return ok ? null : (p.manque || { texte: 'Il faut d\'abord quelque chose à montrer ici.' });
  }
  // La première visite qu'on peut FAIRE en remontant ce qui manque : le paiement attend une facture
  // émise, qui attend un brouillon, qui attend un devis — on propose le devis, pas un bouton éteint
  // qui renvoie à un autre bouton éteint. Bornée : une chaîne qui boucle ne gèle rien.
  function visitePossibleAvant(p) {
    let x = p;
    for (let n = 0; n < 8; n++) {
      const m = visiteManque(x);
      if (!m) return x === p ? null : x;
      const avant = m.visite && visiteParId(m.visite);
      if (!avant || avant === x) return null;
      x = avant;
    }
    return null;
  }
  function expliquerManque(p, m) {
    const avant = visitePossibleAvant(p);
    modal(`<h2>${h(p.titre)}</h2><p>${h(m.texte)}</p>
      ${avant ? `<p class="small muted">La visite « ${h(avant.titre)} » t'y amène pas à pas.</p>` : ''}
      <div class="modal-actions"><button class="btn" data-close>Fermer</button>
        ${avant ? `<button class="btn btn-primary" id="vm-go">${h(avant.titre)}</button>` : ''}</div>`,
    (root, close) => { const b = $('#vm-go', root); if (b) b.onclick = () => { close(); lancerVisite(avant); }; }, null, { garde: false });
  }
  // Les gestes de la dernière bulle d'une visite : « Passer à ma vraie entreprise » à la fin de la
  // découverte — le moment où l'on a vu, et où l'on veut faire pour de vrai.
  async function actionDeVisite(id) {
    if (id === 'passer-au-reel') {
      if (await demoSortie('premiers-pas')) lancerVisite('premiers-pas');
    } else if (id === 'rester') {
      toast('Bonne exploration ! « Quitter l\'exemple », en haut de chaque page, te rend tes données.');
    }
  }
  // L'habillage que le moteur demande (10.14.0, « wow, beau, attirant ») : la couleur d'une visite
  // (son domaine), son dessin, où en est la personne, la suite à lui proposer, et si la fin se fête.
  const iconeDomaine = id => { const t = G.THEMES.find(x => x.id === id); return t ? aideIcone(t) : ''; };
  // Le dessin d'une visite : celui de sa famille quand elle en a un à elle, sinon celui de son domaine.
  const iconeVisite = (coul, p) => { const propre = p && SkanVisites.iconeDe(p); return propre ? aideIcone({ icon: propre }) : iconeDomaine(coul); };
  // Le premier pas qui manque, et la visite qui le fait — dans la VRAIE entreprise seulement :
  // l'exemple a déjà tout, et y proposer « ton premier client » mentirait.
  function pasSuivant() {
    if (!data || C.estDemo(data)) return null;
    const pp = lesPas();
    if (!pp.demarrage) return null;
    // L'étape SUIVANTE du moteur — jamais une facultative : la fin d'une visite ne propose pas
    // « découvrir l'exemple » à quelqu'un qui est en train de faire son premier devis.
    const e = pp.suivante;
    const v = e && PAS_VISITES[e.action] && visiteParId(PAS_VISITES[e.action]);
    return v && !visiteManque(v) ? { etape: e, visite: v } : null;
  }
  const minuscule = t => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
  const VISITES_DES_PAS = new Set(['premiers-pas', ...Object.values(PAS_VISITES)]);
  // Le moteur reçoit ses gestes une fois chargé (1.273.0, L9 : `chargerVisites`).
  const installerVisites = () => Visite.installer({
    aller: hash => vers(hash)(),
    hash: () => location.hash || '#/dashboard',
    parcours: visiteParId,
    lancerSuite: p => lancerVisite(p),
    expliquer: el => SkanVisites.expliquer(el, { G }),
    zone: el => SkanVisites.zone(el),
    action: id => actionDeVisite(id),
    // Une liste vidée par une recherche ou un filtre pendant la visite d'une page : ce bouton la
    // réaffiche, et la bulle le propose au lieu de « M'y ramener » (on est déjà sur la page).
    remettre: '#reset-f',
    couleur: p => SkanVisites.couleurDe(p),
    icone: iconeVisite,
    // « Tes premiers pas » se lisent sur les DONNÉES, comme sur l'accueil : une étape faite sans la
    // visite compte aussi, et celle qu'on vient de finir compte déjà (ce qu'elle a créé est là). Ils ne
    // se montrent qu'à la fin d'une visite des premiers pas, et jamais sur l'exemple.
    progres: p => {
      if (!data || C.estDemo(data) || !VISITES_DES_PAS.has(p.id)) return null;
      const pp = lesPas();
      const suivante = pp.suivante;
      return { titre: 'Tes premiers pas', fait: pp.faits, total: pp.total,
        texte: suivante ? 'Prochaine étape : ' + minuscule(suivante.titre) + '.' : 'Tout est en place : tu sais faire l\'essentiel.' };
    },
    // La suite proposée : d'abord le premier pas qui manque (dans la vraie entreprise), puis celles que
    // la visite propose — sans celles déjà faites, tant qu'il en reste d'autres.
    suites: p => {
      const et = visitesEtat();
      const s = pasSuivant();
      const ids = [s ? s.visite.id : null, ...(p.suite || [])].filter((id, i, a) => id && id !== p.id && a.indexOf(id) === i && !visiteManque(visiteParId(id) || {}));
      const neuves = ids.filter(id => !et.faites[id]);
      return (neuves.length ? neuves : ids).slice(0, 3);
    },
    // La fête : la PREMIÈRE fois qu'on réussit un geste (ou la découverte). La visite d'une page n'en
    // est pas un — des confettis toutes les deux minutes ne veulent plus rien dire.
    fete: p => p.type !== 'page' && !visitesEtat().faites[p.id],
    // L'étape où l'on en est, et le compte quand on le connaît (`Visite.pointDeReprise`).
    etape: (p, i, compte) => visitesPoser(e => { e.reprise = Object.assign({ id: p.id, i }, compte || {}); }),
    fini: p => {
      visitesPoser(e => { e.faites[p.id] = C.today(); if (e.reprise && e.reprise.id === p.id) e.reprise = null; });
      if (location.hash === '#/guide') render(true);
    },
    interrompu: (p, i, compte) => {
      visitesPoser(e => { e.reprise = Object.assign({ id: p.id, i: Math.max(0, i) }, compte || {}); });
      // Où la reprendre : « Guide-moi » de cette page quand il la propose (la visite de la page, un geste
      // qui se fait ici), sinon « Me guider » — la découverte n'est que là (S-03).
      const g = Visite.guideDeLaPage(visitesVisibles(), cleDePage(location.hash), { cleDe: cleDePage });
      toast($('#guide-moi') && Visite.dansLeGuide(g, p.id)
        ? 'Visite mise en pause. Tu la reprends depuis « Guide-moi », en haut de cette page, ou depuis « Me guider », en bas du menu.'
        : 'Visite mise en pause. Tu la reprends quand tu veux depuis « Me guider », en bas du menu.');
      if (location.hash === '#/guide') render(true);
    }
  });

  // La première fois qu'on ouvre une page, une invitation propose sa visite — trois fois au plus,
  // puis elle se tait : un débutant la voit, quelqu'un qui connaît la page n'en est pas encombré.
  //
  // 10.14.1 (S-03) : elle ne pousse plus l'écran de travail. C'était une bande SOUS l'en-tête, avec la
  // page : sur un portable, la grille de saisie commençait 90 px plus bas pendant les trois premières
  // visites. Elle s'ACCROCHE désormais au bouton « Guide-moi », par-dessus la page, et se referme au
  // premier geste ailleurs : elle apprend en passant où la visite se retrouvera — dans « Guide-moi »,
  // avec tout ce qu'on peut faire ici. Pas de vert : le bouton principal de la page reste le seul
  // (U-11). Elle porte la couleur du domaine de la page, comme la visite qu'elle propose.
  const VISITE_PROPOSEE_MAX = 3;
  let appelEnAttente = '';
  // (plateforme) 1.129.0 — une seule proposition par ouverture de l'application : trois en cinq minutes, c'était du bruit
  // (revue du mois d'un client, point 16). Les pages suivantes se taisent jusqu'à la prochaine ouverture.
  let visiteProposeeIci = false;
  function fermerAppelGuide() {
    const a = document.getElementById('guide-appel');
    if (a) { if (typeof a._fermer === 'function') a._fermer(); else a.remove(); }
  }
  function appelGuide(route, reprise) {
    // Sur « Me guider » et sur l'Aide, la page EST déjà l'invitation : la proposer encore serait du bruit.
    if (!data || visiteEnCours() || route === 'guide' || route === 'aide') return;
    // (plateforme, Support S2) En lecture pour le support, la page n'est pas celle de qui la lit : aucune invitation (vue le
    // 14/10/2026 par-dessus la fenêtre qui ferme la lecture).
    if (bridge.lecture) return;
    const et = visitesEtat();
    // (1.273.0, L9) Ce qui la tait sans lire les visites passe d'abord : elles ne se chargent que pour une invitation
    // qui peut encore se montrer, puis l'invitation reprend, si l'on est toujours sur la page.
    if (!et.proposer || et.faites['page-' + route] || (!reprise && (et.vues[route] || 0) >= VISITE_PROPOSEE_MAX)) return;
    if (visiteProposeeIci && !reprise) return;
    // Deux invitations l'une sous l'autre se contredisent (7.18.0) : quand l'accueil propose déjà
    // « Nouveau sur SkanFact ? », la visite de la page se tait — et ne compte pas cette ouverture.
    // (plateforme, lot onboarding) Les premiers pas sont l'invitation de l'accueil : la bulle de la visite de la page s'y
    // posait par-dessus, et couvrait le tiers de l'écran d'un téléphone (vu sur app.skanfact.tn le 09/10/2026).
    if ($('#view .pp-accueil, #view .premiers-pas')) return;
    if (!visitesChargees()) {
      chargerVisites(true).then(ok => { if (ok && cleDePage(location.hash) === route) appelGuide(route, reprise); });
      return;
    }
    const p = visitePage(route);
    if (!p) return;
    const bouton = $('#guide-moi');
    // Une page asynchrone n'a pas encore son en-tête : l'invitation attend le bouton (`poserGuideMoi`).
    if (!bouton) { appelEnAttente = route; return; }
    fermerAppelGuide();
    if (!reprise) visitesPoser(e => { e.vues[route] = (e.vues[route] || 0) + 1; });
    visiteProposeeIci = true;
    const coul = SkanVisites.couleurDe(p);
    const el = document.createElement('div');
    el.className = 'guide-appel' + (coul ? ' th-' + coul : '');
    el.id = 'guide-appel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'ga-t');
    el.innerHTML = `<span class="ga-fleche" aria-hidden="true"></span>
      <div class="ga-tete"><span class="ga-ico" aria-hidden="true">${iconeDomaine(coul) || ICONE_GUIDE}</span>
        <b id="ga-t">Première fois sur cette page ?</b></div>
      <p class="ga-txt">${h(p.resume || '')} Je te montre à quoi elle sert et ce que fait chaque bouton, en ${h(p.duree || 'une minute')}.</p>
      <div class="ga-actions"><button type="button" class="btn btn-sm ga-go" id="ga-go">${ICONE_LECTURE}Faire la visite</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ga-non" title="Ne plus me proposer la visite de cette page">Plus tard</button></div>
      <p class="ga-note">Tu la retrouves dans « Guide-moi », avec tout ce qu'on peut faire ici.
        <button type="button" class="ga-jamais" id="ga-jamais">Ne plus me proposer de visites</button></p>`;
    document.body.appendChild(el);
    const scroller = $('#view');
    const depart = scroller ? scroller.scrollTop : 0;
    // (plateforme, 1.87.3) Au téléphone, c'est la page entière qui défile, pas `#view` : l'invitation restait posée sur le
    // bas de l'écran (230 points d'un éditeur de facture) pendant tout le défilement. Le défilement de la fenêtre la ferme.
    const departFenetre = window.scrollY;
    // Sous le bouton, calée sur son bord droit, la flèche sur son milieu ; jamais hors de l'écran.
    const placer = () => {
      const r = bouton.getBoundingClientRect();
      if (!r.width || !document.body.contains(bouton)) { fermer(); return; }
      // (plateforme, lot achats du 05/10/2026) Dans le coin bas droit de l'écran, plus sous le bouton : posée sous
      // « Guide-moi », elle couvrait le premier champ de la page (le fournisseur d'un achat, le texte d'une page vide), et le
      // clic donné pour écrire tombait sur elle. Le bouton s'allume tant qu'elle est là : elle dit toujours où se trouve la
      // visite. La caisse tactile garde la place d'avant (ses tuiles et son ticket remplissent l'écran).
      if (!document.body.classList.contains('mode-caisse')) { el.classList.add('ga-coin'); bouton.classList.add('guide-moi-signale'); return; }
      const w = el.offsetWidth;
      const gauche = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
      el.style.top = Math.round(r.bottom + 10) + 'px';
      el.style.left = Math.round(gauche) + 'px';
      el.style.setProperty('--ga-fleche', Math.round(Math.min(w - 22, Math.max(14, r.left + r.width / 2 - gauche))) + 'px');
    };
    // Le premier geste ailleurs la referme : on s'est mis au travail. Un clic sur « Guide-moi » ouvre
    // le menu (qui la referme aussi) ; un défilement de la page aussi — elle flotterait loin du bouton.
    const dehors = e => { if (!el.contains(e.target)) fermer(); };
    const clavier = e => { if (e.key === 'Escape' && el.contains(document.activeElement)) { e.stopPropagation(); fermer(); bouton.focus(); } };
    const defile = () => { if (!scroller || Math.abs(scroller.scrollTop - depart) > 4 || Math.abs(window.scrollY - departFenetre) > 4) fermer(); };
    function fermer() {
      el.remove();
      bouton.classList.remove('guide-moi-signale');
      document.removeEventListener('mousedown', dehors, true);
      document.removeEventListener('keydown', clavier, true);
      window.removeEventListener('resize', placer);
      if (scroller) scroller.removeEventListener('scroll', defile);
      window.removeEventListener('scroll', defile);
    }
    el._fermer = fermer;
    placer();
    document.addEventListener('mousedown', dehors, true);
    document.addEventListener('keydown', clavier, true);
    window.addEventListener('resize', placer);
    if (scroller) scroller.addEventListener('scroll', defile);
    window.addEventListener('scroll', defile, { passive: true });
    $('#ga-go', el).onclick = () => { fermer(); lancerVisite(p); };
    $('#ga-non', el).onclick = () => { visitesPoser(e => { e.vues[route] = VISITE_PROPOSEE_MAX; }); fermer(); };
    $('#ga-jamais', el).onclick = () => {
      visitesPoser(e => { e.proposer = false; });
      fermer();
      toast('Plus de proposition de visite. Les visites restent dans « Guide-moi » ; la case de « Me guider » les rallume.');
    };
  }
  const ICONE_GUIDE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>';
  const ICONE_LECTURE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10.2 8.6l5 3.4-5 3.4z"/></svg>';
  const ICONE_DECOUVRIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/></svg>';
  const ICONE_DEMARRER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
  // L'illustration de l'accueil : une facture, un graphique, une coche. Ses couleurs viennent des
  // jetons de la feuille de style — elle se retourne toute seule en sombre.
  const ILLUS_ACCUEIL = `<svg class="pp-acc-deco" viewBox="0 0 250 176" aria-hidden="true" focusable="false">
    <g transform="translate(128 14) rotate(7 56 42)"><rect class="d-carte" width="112" height="84" rx="13"/>
      <path class="d-barre" d="M22 64v-12M40 64v-22M58 64v-16M76 64v-30M94 64v-24"/><path class="d-ligne" d="M20 30l20-9 18 6 18-12 18 5"/></g>
    <g transform="translate(34 28) rotate(-5 62 72)"><rect class="d-carte" width="124" height="144" rx="15"/>
      <rect class="d-titre" x="16" y="18" width="48" height="9" rx="4.5"/><rect class="d-pale" x="84" y="18" width="24" height="9" rx="4.5"/>
      <rect class="d-txt" x="16" y="42" width="92" height="6" rx="3"/><rect class="d-txt" x="16" y="56" width="74" height="6" rx="3"/>
      <rect class="d-txt" x="16" y="70" width="84" height="6" rx="3"/><rect class="d-txt" x="16" y="84" width="58" height="6" rx="3"/>
      <rect class="d-total" x="16" y="106" width="92" height="22" rx="7"/><rect class="d-titre" x="62" y="114" width="38" height="6" rx="3"/></g>
    <g transform="translate(150 104)"><circle class="d-ok" cx="24" cy="24" r="23"/><path class="d-coche" d="M13 25l7.5 7.5L35 17"/></g>
    <path class="d-eclat" d="M24 22l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path class="d-eclat petit" d="M226 118l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z"/>
  </svg>`;

  // La page « Me guider » : un centre d'apprentissage, pas une liste de liens. En tête, OÙ J'EN SUIS
  // (un anneau) et LE prochain geste (un seul vert, U-11) ; puis ce que j'ai déjà réussi, ce que mon
  // essai a déjà construit, les grands départs, et chaque domaine avec ses visites et sa progression.
  let guideQ = '';
  const ICONE_COCHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICONE_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>';
  const ICONE_CADENAS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  // Ce que l'essai a déjà construit — des FAITS tirés des données, jamais une estimation (« 7 pièces
  // vérifiées, intactes » est la seule affirmation que ce projet s'autorise). Et la promesse qui fait
  // acheter sans peur, parce qu'elle est tenue par un test depuis la 6.4.0 : licence ou pas, tes
  // données restent à toi. Aucun compte à rebours criard (8.0.1) : le ton suit la pastille.
  function carteEssai() {
    if (!data || C.estDemo(data) || !licence || (licence.state !== 'essai' && licence.state !== 'finessai')) return '';
    const docs = data.documents || [];
    const co = company();
    const emises = docs.filter(d => (d.type === 'facture' || d.type === 'avoir') && d.number && d.status !== 'brouillon' && effStatus(d) !== 'annulée');
    const ca = emises.reduce((s, d) => s + (d.type === 'avoir' ? -1 : 1) * C.toBase(d, C.computeTotals(d, co).netHT, co), 0);
    const faits = [
      [(data.clients || []).length, 'client', 'clients'],
      [docs.filter(d => d.number).length, 'pièce numérotée', 'pièces numérotées'],
      [docs.reduce((n, d) => n + (d.payments || []).length, 0), 'paiement noté', 'paiements notés'],
      [(data.purchases || []).length, 'achat saisi', 'achats saisis']
    ].filter(x => x[0] > 0).map(x => pl(x[0], x[1], x[2]));
    if (ca > 0.0005) faits.push(`${C.money(ca, co.currency)} facturés HT`);
    const fin = licence.state === 'finessai';
    const j = Number(licence.daysLeft);
    const ton = (bridge.pastilleAbonnement ? bridge.pastilleAbonnement() : C.pastilleLicence(licence)).ton;
    const titre = fin ? 'Ton essai est terminé' : j <= 0 ? 'C\'est le dernier jour de ton essai' : `Ton essai : encore ${pl(j, 'jour')}`;
    return `<section class="panel g-essai${fin || ton === 'attire' || ton === 'alerte' ? ' proche' : ''}" aria-labelledby="g-essai-t">
      <span class="g-essai-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/></svg></span>
      <div class="g-essai-txt"><h2 id="g-essai-t">${h(titre)}</h2>
        ${faits.length ? `<p class="g-essai-sur">Déjà dans ton SkanFact :</p><ul class="g-essai-faits">${faits.map(f => `<li>${h(f)}</li>`).join('')}</ul>`
          : `<p class="g-essai-sur">Tout fonctionne pendant l'essai, et ce que tu y crées reste quand tu ${bridge.dessinerAbonnement ? 't\'abonnes' : 'actives ta licence'} : rien à ressaisir.</p>`}
        ${fin && bridge.dessinerAbonnement && licence.detail ? `<p class="small"><b>${h(licence.detail)}</b></p>` : ''}
        <p class="small">${fin ? 'Tes données sont intactes : tu gardes' : `${bridge.dessinerAbonnement ? 'Abonnement' : 'Licence'} ou pas, tes données restent à toi : tu gardes toujours`} la lecture, l'impression, l'export et l'envoi à ton comptable. Seule la création de nouvelles pièces attend ${bridge.dessinerAbonnement ? 'ton abonnement' : 'ta licence'}.</p></div>
      <button type="button" class="btn" id="g-licence">${bridge.dessinerAbonnement ? (fin ? 'Choisir mon offre' : 'Voir l\'abonnement') : (fin ? 'Activer ma licence' : 'Voir ma licence')}</button>
    </section>`;
  }
  // Ce que fait vraiment un bouton de visite, dit sur le bouton : la découverte CHARGE l'exemple, une
  // visite qui fait écrire tes données (`reel`) en SORT — et le changement de données passe AVANT le
  // verbe (10.14.0) : une visite mise en pause sur l'exemple disait « Recommencer » ou « Reprendre »,
  // et le clic quittait l'exemple sans que rien l'annonce. UNE fonction pour la carte et le héros.
  function libelleVisite(v, verbe) {
    const ex = C.estDemo(data);
    if (v.exemple && !ex) return 'Charger l\'exemple et ' + verbe;
    if (v.reel && ex) return 'Quitter l\'exemple et ' + verbe;
    return verbe.charAt(0).toUpperCase() + verbe.slice(1);
  }
  // (1.273.0, L9) Une page qui lit les visites ou le texte de l'aide les attend : son titre et « Un instant… », puis la
  // page entière, redessinée si l'on y est toujours. Sans réseau et jamais chargés : la page le dit, et se redessine
  // seule au retour du réseau.
  function attendreAvant(pret, charger, titre, sansReseau, dessiner) {
    return parts => {
      if (pret()) return dessiner(parts);
      const hash = location.hash;
      $('#view').innerHTML = `<div class="page-head"><h1>${h(titre)}</h1></div><p class="muted" data-attente-page>Un instant…</p>`;
      return charger(true).then(ok => {
        if (location.hash !== hash) return;
        if (ok) { render(true); return; }
        const p = $('[data-attente-page]');
        if (p) p.textContent = sansReseau;
        window.addEventListener('online', () => { if (location.hash === hash) render(true); }, { once: true });
      });
    };
  }
  const SANS_RESEAU_VISITES = 'Les visites guidées ne sont pas encore sur ce poste, et le réseau manque : elles se chargent dès qu\'il revient.';
  const pageGuide = () => {
    const et = visitesEtat();
    const toutes = visitesVisibles();
    const gestes = toutes.filter(v => v.type !== 'page');
    const pages = toutes.filter(v => v.type === 'page');
    const nbFaites = toutes.filter(v => et.faites[v.id]).length;
    const pagesFaites = pages.filter(v => et.faites[v.id]).length;
    const gestesFaits = gestes.filter(v => et.faites[v.id]).length;
    const reprise = et.reprise && visiteParId(et.reprise.id);
    // Où la visite reprendra, et ce qu'on en sait : « Étape 6 sur 14 », ou « Étape 6 » d'une page
    // qui se relira — jamais « Étape 2 sur 2 » d'une page arrêtée au premier de ses blocs (10.14.1).
    const rep = reprise ? Visite.pointDeReprise(reprise, et.reprise) : null;
    const repriseI = rep ? rep.i : 0;
    const exemple = C.estDemo(data);
    const pp = lesPas();
    const pas = pasSuivant();
    const dec = visiteParId('decouvrir');
    // LE prochain geste, et UN seul vert (U-11) : reprendre ce qui est commencé ; sinon la
    // découverte si l'exemple est chargé ou si rien d'autre n'attend ; sinon le premier pas qui
    // manque ; sinon rien — tout se vaut, c'est la personne qui choisit.
    // 26/09 — la découverte est FACULTATIVE : elle ne passe jamais devant un premier pas du métier.
    // Elle mène quand l'exemple est chargé, ou quand aucun premier pas n'attend.
    const decouvrirDabord = !!(dec && !et.faites.decouvrir && (exemple || !pas));
    const prochain = reprise
      ? { etiq: 'En pause', label: libelleVisite(reprise, 'reprendre'), titre: reprise.titre, sous: rep.note ? `${rep.texte} — ${rep.note}` : rep.texte, run: () => lancerVisite(reprise, repriseI) }
      : decouvrirDabord
        ? { etiq: 'Pour commencer', label: exemple ? 'Commencer la découverte' : 'Charger l\'exemple et découvrir', titre: dec.titre, sous: `${dec.duree} · ${pl(Visite.chapitres(dec.etapes).length, 'chapitre')}`, run: () => lancerVisite(dec) }
        : pas
          // Le sous-titre dit OÙ l'on en est — le titre dit déjà quoi : « Compléter ma fiche société »
          // suivi de « compléter ta fiche société » ne s'écrit qu'une fois.
          ? { etiq: 'Prochaine étape', label: 'Me guider', titre: pas.visite.titre, sous: `Premier pas ${pp.etapes.findIndex(x => x.action === pas.etape.action) + 1} sur ${pp.total} · ${pas.visite.duree}`, run: () => lancerVisite(pas.visite) }
          : null;
    const titreHero = reprise ? 'Reprends ta visite là où tu l\'as laissée' : decouvrirDabord ? 'Apprends SkanFact en le faisant'
      : pas ? 'Continue tes premiers pas' : 'Tu as les bases — explore à ton rythme';
    // L'anneau : tes premiers pas tant qu'ils ne sont pas faits (dans ta vraie entreprise), sinon les
    // visites faites. Ce qu'il compte est écrit dessous.
    const anneauPas = !exemple && pp.demarrage;
    // Une découverte en pause se mesure en ÉTAPES : « 10 sur 42 » dit où l'on en est, « 0 visite
    // faite sur 58 » décourage quelqu'un qui a fait le quart du tour.
    const anneauDec = !anneauPas && reprise && reprise.id === 'decouvrir';
    const aFait = anneauPas ? pp.faits : anneauDec ? repriseI : nbFaites;
    const aTotal = anneauPas ? pp.total : anneauDec ? reprise.etapes.length : toutes.length;
    const aQuoi = anneauPas ? 'premiers pas' : anneauDec ? 'étapes parcourues' : 'visites faites';
    const pct = aTotal ? aFait / aTotal : 0;
    const R = 52, CIRC = 2 * Math.PI * R;
    const anneau = `<div class="g-anneau" role="img" aria-label="${h(`${aFait} sur ${aTotal} : ${aQuoi}`)}">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="g-an-fond" cx="60" cy="60" r="${R}"/><circle class="g-an-plein" cx="60" cy="60" r="${R}" style="--circ:${CIRC.toFixed(1)};--off:${(CIRC * (1 - pct)).toFixed(1)}"/></svg>
        <span class="g-an-t"><b>${aFait}<small> / ${aTotal}</small></b><span>${aQuoi}</span></span></div>`;
    const statut = v => et.faites[v.id] ? '<span class="g-etat fait">Fait</span>'
      : reprise && reprise.id === v.id ? `<span class="g-etat encours">En pause · ${rep.sur ? `${repriseI + 1}/${rep.sur}` : `étape ${repriseI + 1}`}</span>` : '';
    // Une visite qui n'a encore rien à montrer (aucune facture à encaisser) garde sa ligne, bouton
    // éteint, et DIT pourquoi — par la même fonction que celle qui refuserait au lancement (9.4.5).
    // La visite qui fabrique ce qui manque est proposée à côté.
    const libelle = v => et.faites[v.id] ? 'Refaire' : reprise && reprise.id === v.id ? 'Recommencer' : 'Commencer';
    const bouton = v => {
      const m = visiteManque(v);
      if (!m) return `<button type="button" class="btn btn-sm" data-visite="${h(v.id)}">${libelle(v)}</button>`;
      const avant = visitePossibleAvant(v);
      return avant
        ? `<button type="button" class="btn btn-sm" data-visite="${h(avant.id)}" title="${h(m.texte)}">D'abord : ${h(minuscule(avant.titre))}</button>`
        : `<button type="button" class="btn btn-sm" disabled title="${h(m.texte)}">${libelle(v)}</button>`;
    };
    const cherche = v => h(C.plier([v.titre, v.resume, (v.mots || []).join(' ')].join(' ')));
    // « Pas encore : il te faut… » — après deux-points, la phrase reprend en minuscule.
    const manqueDe = v => { const m = visiteManque(v); return m ? `<span class="small g-manque">Pas encore : ${h(minuscule(m.texte))}</span>` : ''; };
    const ligne = v => `<li class="g-ligne${et.faites[v.id] ? ' faite' : ''}" data-cherche="${cherche(v)}">
        <span class="g-l-ico" aria-hidden="true">${et.faites[v.id] ? ICONE_COCHE : reprise && reprise.id === v.id ? ICONE_PAUSE : ICONE_LECTURE}</span>
        <span class="g-txt"><b>${h(v.titre)}</b><span class="small muted">${h(v.resume || '')}</span>${manqueDe(v)}</span>
        <span class="g-duree">${h(v.duree || '')}</span>${statut(v)}${bouton(v)}</li>`;
    const themes = SkanVisites.THEMES.filter(t => t.id !== 'pages' && t.id !== 'demarrer').map(t => {
      const liste = gestes.filter(v => v.theme === t.id);
      if (!liste.length) return '';
      const faites = liste.filter(v => et.faites[v.id]).length;
      return `<section class="g-theme th-${h(t.couleur)}" id="g-${h(t.id)}" data-g-theme>
        <header class="g-th-tete"><span class="g-th-ico">${t.icone ? aideIcone({ icon: t.icone }) : iconeDomaine(t.couleur)}</span>
          <span class="g-th-t"><h2>${h(t.titre)}</h2><span>${h(t.sous)}</span></span>
          <span class="g-th-n" title="${h(`${faites} visite${faites > 1 ? 's' : ''} faite${faites > 1 ? 's' : ''} sur ${liste.length}`)}">${faites}<small> / ${liste.length}</small></span></header>
        <span class="g-th-barre" aria-hidden="true"><i style="width:${Math.round(faites / liste.length * 100)}%"></i></span>
        <ul class="g-liste">${liste.map(ligne).join('')}</ul></section>`;
    }).join('');
    // Tes réussites : jamais sur l'exemple — celles d'une entreprise inventée ne sont pas les tiennes.
    const rr = exemple ? null : C.reussites(data, company(), { copieExterne, partage: dossierPartage });
    $('#view').innerHTML = `
      <div class="page-head"><h1>Me guider</h1>
        <div class="actions"><button type="button" class="btn" id="g-aide">Ouvrir l'Aide</button></div></div>
      <section class="g-hero">
        <div class="g-hero-txt"><span class="g-sur">Ton guide</span>
          <h2>${h(titreHero)}</h2>
          <p>Chaque visite te montre où cliquer, sur ton vrai écran, et attend que tu l'aies fait. Pendant une visite, tu peux cliquer partout, faire une pause avec la croix, et reprendre ici.</p>
          ${prochain ? `<div class="g-prochain"><span class="g-pr-t"><span class="g-pr-etiq">${h(prochain.etiq)}</span><b>${h(prochain.titre)}</b><span class="small muted">${h(prochain.sous)}</span></span>
            ${reprise ? `<button type="button" class="btn btn-primary" id="g-reprendre">${ICONE_LECTURE}${h(prochain.label)}</button>`
              : `<button type="button" class="btn btn-primary" id="g-prochain">${ICONE_LECTURE}${h(prochain.label)}</button>`}</div>` : ''}</div>
        <div class="g-hero-mesure">${anneau}
          <ul class="g-chiffres">
            <li><b>${gestesFaits}<small> / ${gestes.length}</small></b><span>${gestesFaits > 1 ? 'gestes guidés réussis' : 'geste guidé réussi'}</span></li>
            <li><b>${pagesFaites}<small> / ${pages.length}</small></b><span>${pagesFaites > 1 ? 'pages découvertes' : 'page découverte'}</span></li>
            <li><b>${et.faites.decouvrir ? 'Faite' : 'À faire'}</b><span>la découverte de l'exemple</span></li>
          </ul></div>
      </section>
      ${carteEssai()}
      ${rr ? `<section class="panel g-reussites" aria-labelledby="g-reu-t">
        <div class="g-reu-tete"><h2 id="g-reu-t">Tes réussites</h2><span class="g-reu-n">${rr.faites} sur ${rr.total}</span></div>
        <ul class="g-reu-liste">${rr.liste.map(r => `<li class="g-reu${r.fait ? ' obtenue' : ''}"><span class="g-reu-ico" aria-hidden="true">${r.fait ? ICONE_COCHE : ICONE_CADENAS}</span>
          <span class="g-reu-t"><b>${h(r.titre)}</b><span>${h(r.quoi)}</span></span></li>`).join('')}</ul></section>` : ''}
      <div class="g-cartes" id="g-demarrer" data-g-theme>
        ${gestes.filter(v => v.theme === 'demarrer').map(v => {
          const lib = libelleVisite(v, et.faites[v.id] ? 'refaire' : reprise && reprise.id === v.id ? 'recommencer' : 'commencer');
          const coul = SkanVisites.couleurDe(v);
          return `
          <div class="g-carte${coul ? ' th-' + coul : ''}${et.faites[v.id] ? ' faite' : ''}" data-cherche="${cherche(v)}">
            <div class="g-carte-t"><span class="g-carte-ico">${v.exemple ? ICONE_DECOUVRIR : v.reel ? ICONE_DEMARRER : iconeDomaine(coul)}</span>
              <span class="g-duree">${h(v.duree)}</span></div>
            <b class="g-carte-titre">${h(v.titre)}</b>
            <p class="small">${h(v.resume)}</p>${statut(v)}
            <button type="button" class="btn btn-sm" data-visite="${h(v.id)}">${lib}</button></div>`;
        }).join('')}
      </div>
      <div class="help-search g-cherche"><span class="hs-champ"><svg class="hs-loupe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/></svg>
        <input type="search" id="guide-q" placeholder="Je veux… (faire une facture, relancer un client, déclarer ma TVA)" autocomplete="off" spellcheck="false" value="${h(guideQ)}"></span>
        <div class="help-count small muted" id="guide-n" hidden></div></div>
      <div class="g-themes">${themes}</div>
      <section class="panel g-pages-sec" id="g-pages" data-g-theme>
        <div class="g-reu-tete"><h2>Chaque page, en une minute</h2><span class="g-reu-n">${pagesFaites} sur ${pages.length}</span></div>
        <p class="small muted">À quoi elle sert, et ce que fait chacun de ses boutons.</p>
        <ul class="g-pages">${pages.map(v => { const m = visiteManque(v); const c = SkanVisites.couleurDe(v); return `<li data-cherche="${cherche(v)}">
          <button type="button" class="g-page${c ? ' th-' + c : ''}${et.faites[v.id] ? ' fait' : ''}" data-visite="${h(v.id)}"${m ? ` disabled title="${h(m.texte)}"` : ` title="${h(v.resume || '')}"`}>${et.faites[v.id] ? ICONE_COCHE : ''}${h(v.titre)}</button></li>`; }).join('')}</ul>
      </section>
      <label class="check g-proposer"><input type="checkbox" id="guide-proposer" ${et.proposer ? 'checked' : ''}>
        <span>Me proposer la visite d'une page quand je l'ouvre pour la première fois</span></label>`;
    // Le vert du héros porte LE prochain geste ; les cartes et les lignes n'en portent aucun (U-11).
    if (prochain) ($('#g-reprendre') || $('#g-prochain')).onclick = prochain.run;
    $$('[data-visite]').forEach(b => b.onclick = () => lancerVisite(visiteParId(b.dataset.visite)));
    $('#g-aide').onclick = () => navigate('#/aide');
    if ($('#g-licence')) $('#g-licence').onclick = () => allerParametres('app', 'p-licence');
    $('#guide-proposer').onchange = e => visitesPoser(x => { x.proposer = e.target.checked; if (e.target.checked) x.vues = {}; });
    // Chercher ne redessine rien : on montre ou on cache des lignes déjà là. Le champ garde donc
    // sa frappe et son curseur (10.12.0 : un champ qui redessine son écran perd ce qu'on tape).
    const q = $('#guide-q'), n = $('#guide-n');
    const filtrer = () => {
      guideQ = q.value;
      const mots = C.plier(q.value.trim()).split(/\s+/).filter(Boolean);
      let vus = 0;
      $$('[data-cherche]').forEach(li => { const ok = mots.every(m => li.dataset.cherche.includes(m)); li.hidden = !ok; if (ok) vus++; });
      $$('[data-g-theme]').forEach(sec => { sec.hidden = mots.length > 0 && !$$('[data-cherche]', sec).some(li => !li.hidden); });
      n.hidden = !mots.length;
      // Une recherche qui ne trouve rien ne laisse pas la personne devant le vide : l'Aide, qui lit
      // le corps de ses trente-deux articles, en parle peut-être.
      n.innerHTML = vus ? h(`${pl(vus, 'visite')} pour « ${q.value.trim()} »`)
        : `Aucune visite pour « ${h(q.value.trim())} ». <a href="#/aide" id="guide-aide">Chercher dans l'Aide →</a>`;
      const a = $('#guide-aide');
      if (a) a.onclick = ev => { ev.preventDefault(); aideQ = q.value.trim(); navigate('#/aide'); };
    };
    q.oninput = filtrer;
    if (guideQ) filtrer();
  };

  routes.guide = attendreAvant(visitesChargees, chargerVisites, 'Me guider', SANS_RESEAU_VISITES, pageGuide);
  const pageAide = (parts) => {
    const arts = G.ARTICLES;
    const vise = parts && parts[0] ? parts[0] : '';
    // `#/aide` seul ouvre l'ACCUEIL. Avant, il ouvrait d'office le premier article : on ne voyait
    // jamais la carte du domaine, et on ne savait pas qu'il y en avait trente et un autres.
    aideArticle = arts.some(x => x.id === vise) ? vise : '';
    // Demander un article PRÉCIS efface la recherche en cours. Sans ça, arriver ici par l'article
    // d'une page (« Guide-moi ») alors qu'une recherche traînait en mémoire relançait le filtrage au
    // dessin : `#aide-vue` — qui CONTIENT l'article — repartait caché, et la page s'ouvrait blanche.
    // Trouvé par `npm run e2e:aide`, invisible à la lecture.
    if (aideArticle) aideQ = '';
    const a = aideArticle ? arts.find(x => x.id === aideArticle) : null;
    const theme = a ? G.themeOf(a.id) : null;
    const geste = a ? G.GESTES[a.id] : null;
    // L'article suivant DANS SON THÈME : on lit un domaine, on ne saute pas de la paie au stock.
    const voisins = theme ? theme.articles : [];
    const iCourant = a ? voisins.indexOf(a.id) : -1;
    const suivant = iCourant >= 0 && iCourant < voisins.length - 1 ? arts.find(x => x.id === voisins[iCourant + 1]) : null;
    const precedent = iCourant > 0 ? arts.find(x => x.id === voisins[iCourant - 1]) : null;

    $('#view').innerHTML = `
      <div class="page-head"><h1>Aide</h1>
        <div class="actions">${backButton('#/dashboard', 'aide')}${bridge.support && routeOf(backTarget('#/dashboard', 'aide')) !== 'support' ? '<button class="btn" id="aide-demandes">Tes demandes au support</button>' : ''}<button class="btn" id="aide-support">${bridge.support ? 'Écrire au support' : 'Signaler un problème'}</button><button class="btn" id="aide-idee">Proposer une amélioration</button><button class="btn" id="aide-changelog">Nouveautés de la version</button></div></div>
      ${/* 10.12.0 — la phrase promettait « le ? en haut de chaque page » : aucune page n'en porte. Le
           bouton s'appelle « Guide-moi » depuis la 10.14.1 (poserGuideMoi) ; une phrase affichée que
           rien ne tient est un bug (7.3.0). */''}
      ${a ? '' : `<p class="lead">Comment marche SkanFact, et comment tenir la gestion d'une petite entreprise sans rien oublier. Cherche un mot, ou choisis un domaine. Partout ailleurs dans l'application, les petits <span class="i-demo">i</span> expliquent le champ juste à côté, et «&nbsp;Guide-moi&nbsp;» en haut de chaque page liste tout ce qu'on peut y faire — sa visite, chaque geste pas à pas — et ouvre l'article de cette page.</p>
      <div class="guide-band aide-guide"><span class="gb-ico" aria-hidden="true">${ICONE_GUIDE}</span>
        <span class="gb-txt"><b>Tu préfères qu'on te montre ?</b> La visite guidée te fait faire chaque geste sur ton vrai écran, et explique chaque bouton de chaque page.</span>
        <button type="button" class="btn btn-sm" id="aide-guide">Me guider</button></div>`}
      <div class="help-search">
        ${/* 10.12.0 (U-30, trouvé dans l'app du comptable) — la loupe vit AVEC le champ : centrée
              sur le bloc entier, elle descendait sous la ligne du texte dès que le compte des
              résultats s'affichait. */''}
        <span class="hs-champ"><svg class="hs-loupe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/></svg>
        <input type="search" id="aide-q" placeholder="Rechercher : un mot, une question… (« assiette », « relance », « timbre »)" autocomplete="off" spellcheck="false" value="${h(aideQ)}"></span>
        <div class="help-count small muted" id="aide-n" hidden></div>
      </div>
      <div id="aide-res" hidden></div>
      <div id="aide-vue">${a ? '' : aideAccueil()}</div>`;

    const vue = $('#aide-vue');
    if (a) {
      const { corps, sommaire } = aideCorps(a);
      // Le fil d'Ariane est un <div>, plus un <nav>. C'était un <nav> depuis la 7.23.0, et
      // `nav { display: flex; flex-direction: column }` — la règle de la barre latérale, posée sur
      // l'ÉLÉMENT — l'emportait sur `.help-fil`. Résultat : « Aide › Vendre et facturer › Le
      // devis » s'empilait verticalement, centré au milieu de la page, en tête de CHAQUE article.
      // Rien en console, rien dans les tests : ça ne se voit que sur une capture.
      vue.innerHTML = `
        <div class="help-fil small">
          <button data-home="1">Aide</button><span class="sep">›</span>
          ${theme ? `<button data-theme="${h(theme.id)}">${h(theme.label)}</button><span class="sep">›</span>` : ''}
          <span>${h(a.title)}</span>
        </div>
        <div class="help-layout${sommaire ? '' : ' seul'}${theme ? ' th-' + h(theme.id) : ''}">
          <div class="help-col">
            <article class="panel help-body">
              ${theme ? `<div class="help-kicker">${aideIcone(theme)}${h(theme.label)}</div>` : ''}
              <h2 class="help-h">${h(a.title)}</h2>
              <p class="help-sub">${h(a.sub)}</p>
              ${corps}
              ${geste ? `<div class="help-geste"><button class="btn btn-primary" data-geste="${h(geste.hash)}">${h(geste.label)}</button>
                <span class="small muted">On lit une explication pour faire quelque chose.</span></div>` : ''}
              <p class="small muted help-foot">Une question de fiscalité ou de comptabilité que cette aide ne tranche pas ? Elle est pour ton comptable : lui seul connaît ta situation et la réglementation en vigueur.</p>
            </article>
            <div class="help-suite">
              ${precedent ? `<button class="btn btn-ghost" data-art="${h(precedent.id)}">← ${h(precedent.title)}</button>` : '<span></span>'}
              ${suivant ? `<button class="btn" data-art="${h(suivant.id)}">${h(suivant.title)} →</button>` : '<span></span>'}
            </div>
          </div>
          ${sommaire}
        </div>`;
    }

    // Un seul endroit pour brancher ce qui mène quelque part : la vue se redessine souvent (accueil,
    // article, résultats de recherche) et un branchement oublié fait un bouton mort.
    const brancher = () => {
      $$('[data-art]').forEach(b => b.onclick = () => { aideQ = ''; navigate('#/aide/' + b.dataset.art); });
      // Un thème n'ouvre plus un panneau par-dessus la liste : il EMMÈNE à sa section. `vers`
      // redessine même quand le hash ne change pas (on peut déjà être sur `#/aide`), sans quoi le
      // clic serait avalé en silence — le piège de la 7.15.0.
      $$('[data-theme]').forEach(b => b.onclick = vers('#/aide', () => { aideQ = ''; pageFocus = 'sec-' + b.dataset.theme; }));
      $$('[data-home]').forEach(b => b.onclick = vers('#/aide', () => { aideQ = ''; pageFocus = ''; }));
      $$('[data-geste]').forEach(b => b.onclick = () => navigate(b.dataset.geste));
      // Le sommaire, lui, ne redessine rien : la page est déjà là, on descend dedans.
      $$('[data-h]').forEach(b => b.onclick = () => {
        const el = document.getElementById(b.dataset.h);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    brancher();

    // Descendre à la section demandée : c'est `pageFocus` (7.18.0) qui le fait, et pas ce code-ci.
    // Raison, apprise ici : `render()` remet `#view.scrollTop` à zéro APRÈS avoir appelé la route.
    // Un défilement posé pendant le dessin est donc effacé une ligne plus loin — la pastille
    // s'allumait, la section se marquait, et la page ne bougeait pas d'un pixel, c'est-à-dire le
    // défaut de la 7.0.0 : un bouton qui accepte le clic et n'en fait rien. `pageFocus` s'exécute
    // après la remise à zéro, et il apporte le repère coloré avec lui.
    // Trouvé par `npm run e2e:aide`, qui MESURE la position de la section après le clic.

    const q = $('#aide-q');
    const chercher = () => {
      aideQ = q.value;
      const mots = aideQ.trim();
      const res = $('#aide-res'), n = $('#aide-n');
      res.hidden = !mots; n.hidden = !mots;
      $('#aide-vue').hidden = !!mots;
      if (!mots) { brancher(); return; }
      const trouves = aideFiltre(arts, aideQ);
      const surligne = aideMots(aideQ);
      n.textContent = trouves.length
        ? `${pl(trouves.length, 'article')} sur ${arts.length}, le plus proche en premier`
        : `Aucun article sur ${arts.length}`;
      res.innerHTML = trouves.length
        ? `<div class="help-arts help-res">${trouves.map(x => {
          const t = G.themeOf(x.id);
          const ex = aideExtrait(x, aideQ);
          return `<button class="help-art${t ? ' th-' + h(t.id) : ''}" data-art="${h(x.id)}">
              ${t ? `<span class="hth">${h(t.label)}</span>` : ''}
              <span class="ht">${aideSurligne(x.title, surligne)}</span>
              <span class="hs">${ex || aideSurligne(x.sub, surligne)}</span></button>`;
        }).join('')}</div>`
        : `<div class="empty"><p>${mots.split(/\s+/).filter(Boolean).length > 1
          ? 'Aucun article ne contient tous ces mots — chacun doit s\'y trouver. Essaie-les un par un'
          : `Aucun article ne parle de « ${h(mots)} ». Essaie un mot voisin`} — ou ouvre le glossaire, qui définit les cinquante-neuf termes employés dans l'application.</p>
            <button class="btn btn-primary" data-art="vocabulaire">Ouvrir « Le vocabulaire »</button></div>`;
      brancher();
    };
    q.oninput = chercher;
    // Échap vide la recherche plutôt que de fermer quoi que ce soit : c'est le geste attendu dans un
    // champ de recherche, et il n'y a rien d'autre à fermer sur cette page.
    q.onkeydown = e => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; chercher(); } };
    if (aideQ) chercher();
    bindBack('#/dashboard', 'aide');
    $('#aide-changelog').onclick = showChangelog;
    if ($('#aide-guide')) $('#aide-guide').onclick = () => navigate('#/guide');
    $('#aide-support').onclick = supportForm;
    $('#aide-idee').onclick = ideeForm;
    if ($('#aide-demandes')) $('#aide-demandes').onclick = () => navigate('#/support');
  };
  routes.aide = attendreAvant(textesPrets, chargerTextes, 'Aide', SANS_RESEAU_AIDE, pageAide);

  // ---------- signaler un problème (6.6.0) ----------
  // Un rapport utile tient en trois choses : ce qui s'est passé, la version, et le journal technique.
  // Ce qu'il ne contient JAMAIS : un nom de client, un montant, une donnée d'entreprise.
  async function supportForm() {
    // (plateforme, Support S1) En ligne, la demande part au support de SkanFact et la réponse revient dans l'application
    // (« Tes demandes au support »), pas dans une messagerie ; il n'y a pas de journal de l'ordinateur à joindre.
    if (bridge.support) return ecrireAuSupport('probleme');
    let info = {};
    try { info = await bridge.supportInfo(); } catch {}
    const tech = `SkanFact ${info.version || '?'} · ${info.platform || '?'} · Electron ${info.electron || '?'}`;
    modal(`<h2>Signaler un problème</h2>
      <p class="small">Décris ce que tu faisais au moment du problème : c'est ce qui permet de le reproduire, et donc de le corriger. Le reste est déjà rempli.</p>
      <label class="field">${lbl('Ce qui s\'est passé', 'aide.probleme')}
        <textarea id="sup-what" rows="4" placeholder="Ex. : j'ai cliqué sur « Émettre » depuis un devis et l'application n'a plus répondu."></textarea></label>
      <div class="notes-md mt"><strong>Joint automatiquement</strong>
        <p class="small">${h(tech)}</p>
        <p class="small">Le journal technique : ${pl(info.lines || 0, 'ligne')}${info.lines ? ' — dates, erreurs et piles d\'appels' : ' (aucune erreur enregistrée, bon signe)'}.</p>
        <p class="small muted">Ce journal ne contient <strong>aucune donnée de ton entreprise</strong> : ni client, ni montant, ni document. Tu peux le lire avant d'envoyer.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="sup-log">Voir le journal</button>
        <button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="sup-send">Préparer le message</button></div>`,
      (root, close) => {
        $('#sup-log', root).onclick = () => bridge.openLog();
        $('#sup-send', root).onclick = async () => {
          if (!await messagerie()) return;
          const what = $('#sup-what', root).value.trim();
          const body = `Bonjour,\n\nJ'ai rencontré un problème avec SkanFact.\n\n`
            + `Ce qui s'est passé :\n${what || '(à compléter)'}\n\n`
            + `--- informations techniques ---\n${tech}\nDossier : ${info.logPath || ''}\n\n`
            + (info.log ? `--- journal (${info.lines} lignes) ---\n${String(info.log).slice(-6000)}\n` : '(journal vide)\n');
          await bridge.composeMail({ to: LICENCE_CONTACT, subject: `Problème SkanFact ${info.version || ''}`, body, mode: modeEnvoi() });
          close(); toast('Message préparé — relis-le avant de l\'envoyer');
        };
      });
  }

  // ---------- proposer une amélioration (8.1.0) ----------
  //
  // Le pendant de « Signaler un problème », et il vit juste à côté volontairement : quelqu'un qui
  // prend la peine d'ouvrir l'un est très exactement quelqu'un qui a quelque chose à dire sur
  // l'autre. Jusqu'ici l'application savait recevoir ce qui ne marche pas, et n'avait aucune porte
  // pour ce qui manque — alors que SkanFact est écrit par une seule personne, pour qui c'est la
  // seule source d'idées qui existe.
  //
  // Il n'emporte NI journal NI pile d'appels, contrairement au signalement : une idée n'a pas de
  // trace technique, et joindre le journal « au cas où » serait prendre des données sans raison.
  //
  // Les deux questions ne sont pas interchangeables. On demande d'abord ce que la personne aimerait
  // faire, puis comment elle s'en sort aujourd'hui — et c'est la SECONDE qui apprend quelque chose.
  // On propose toujours une solution, et la solution imaginée est rarement la meilleure ; ce qu'il
  // faut connaître, c'est le besoin qui l'a fait naître. La première question seule ferait écrire
  // « il faudrait un bouton X », sans jamais dire pourquoi.
  async function ideeForm() {
    // (plateforme, Support S1) L'idée part au support de SkanFact, avec ses deux questions ; la réponse revient ici.
    if (bridge.support) return ecrireAuSupport('idee');
    let info = {};
    try { info = await bridge.supportInfo(); } catch {}
    const tech = `SkanFact ${info.version || '?'} · ${info.platform || '?'}`;
    modal(`<h2>Proposer une amélioration</h2>
      <p class="small">SkanFact est écrit par une seule personne, et ce sont les idées de ceux qui s'en servent tous les jours qui décident de la suite. Dis ce qui te manque — même si ça te paraît petit : c'est souvent le petit geste répété tous les lundis qui fait gagner le plus.</p>
      <label class="field obligatoire">${lbl('Ce que tu aimerais faire', 'aide.ideeQuoi')}
        <textarea id="idee-quoi" rows="3" placeholder="Ex. : envoyer la même relance à plusieurs clients d'un coup."></textarea></label>
      <label class="field">${lbl('Comment tu fais aujourd\'hui', 'aide.ideeAujourdhui')}
        <textarea id="idee-auj" rows="3" placeholder="Ex. : je les ouvre un par un, ça me prend une demi-heure chaque lundi."></textarea></label>
      <p class="small muted">Cette seconde question est celle qui sert le plus : elle dit le vrai problème, et pas seulement la solution imaginée.</p>
      <div class="notes-md mt"><strong>Joint automatiquement</strong>
        <p class="small">${h(tech)} — pour pouvoir te répondre si ce que tu demandes existe déjà dans une version plus récente.</p>
        <p class="small muted">Rien d'autre : ni journal technique, ni donnée de ton entreprise.</p>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="idee-send">Préparer le message</button></div>`,
      (root, close) => {
        $('#idee-send', root).onclick = async () => {
          const quoi = $('#idee-quoi', root).value.trim();
          // Un refus MONTRE le champ (règle 7.20.0) : un message seul ferait relire toute la fenêtre.
          if (!quoi) return refus('#idee-quoi', 'Dis en une phrase ce que tu aimerais faire.');
          if (!await messagerie()) return;
          const auj = $('#idee-auj', root).value.trim();
          const body = 'Bonjour,\n\nUne idée pour SkanFact.\n\n'
            + `Ce que j'aimerais faire :\n${quoi}\n\n`
            + `Comment je fais aujourd'hui :\n${auj || '(non précisé)'}\n\n`
            + `--- version ---\n${tech}\n`;
          await bridge.composeMail({ to: LICENCE_CONTACT, subject: `Idée pour SkanFact ${info.version || ''}`, body, mode: modeEnvoi() });
          close(); toast('Message préparé — relis-le avant de l\'envoyer');
        };
      });
  }

  // ---------- mises à jour ----------
  const upd = { state: 'idle', version: '', percent: 0, message: '', notes: '', app: null, canaux: null };
  bridge.onUpdateEvent(ev => {
    upd.state = ev.state;
    if (ev.version) upd.version = ev.version;
    if (ev.percent != null) upd.percent = ev.percent;
    upd.transferred = ev.transferred; upd.total = ev.total;
    if (ev.message) upd.message = ev.message;
    if (ev.detail != null) upd.detail = ev.detail;
    if (ev.soft != null) upd.soft = !!ev.soft;
    if (ev.notes != null) upd.notes = ev.notes;
    drawUpdatePanel();
    drawUpdatePill();
    if (ev.state === 'downloaded') proposerInstallation(ev);
  });

  // ---------- lecture de factures : la clé et le consentement (4.2.0) ----------
  // Sans clé, aucune requête ne part de l'ordinateur. Le panneau le dit avant de proposer quoi que ce soit.
  async function drawOcrPanel() {
    if (!$('#ocr-panel')) return;
    // (27/10/2026, Skander) Sur la plateforme, seule l'IA de Claude (hors de Tunisie) lit les pièces : celle de nos serveurs se
    // trompait trop. Elle se demande à chaque pièce si le serveur a sa clé ; l'entreprise la coupe ici (company.lectureIA), et
    // les pièces se joignent alors et se saisissent à la main.
    if (bridge.lectureSurLeServeur) {
      let st = null;
      try { st = await bridge.ocrStatus(); } catch (_) {}
      const el = $('#ocr-panel'); if (!el) return;
      const coupee = company().lectureIA === false, avecIA = !!(st && st.iaServeur);
      // (27/10/2026, maquette « Lecture des achats », docs/maquettes/complements.html) Les deux voies côte à côte : celle qui
      // lit maintenant est marquée ; ce qui part chez Anthropic, et ce qui ne part jamais ; le geste au pied.
      el.innerHTML = `<p class="small" style="margin:0">Une photo ou un PDF de facture d'achat, même écrite à la main, se lit par l'IA, puis SkanFact te montre ce qu'il a compris : tu vérifies chaque case avant que la pièce se remplisse.</p>
        <div class="ocr-voies">
          <div class="ocr-voie${avecIA && !coupee ? ' on' : ''}${!avecIA || coupee ? ' eteinte' : ''}"><span class="vt">${lfIc('eclat', 16, 2)}Lire avec l'IA de Claude<span class="badge ${avecIA && !coupee ? 'partielle' : 'brouillon'}">${!avecIA ? 'pas sur ce serveur' : coupee ? 'coupée' : 'hors de Tunisie'}</span></span>
            <p>${!avecIA ? 'Ce serveur n\'a pas l\'IA : les pièces se joignent et se saisissent à la main.' : 'Demandée à chaque pièce : rien ne part sans ton « Lire avec l\'IA ».'}</p></div>
          <div class="ocr-voie${!avecIA || coupee ? ' on' : ''}"><span class="vt">${lfIc('ecriture', 16, 2)}Saisir à la main<span class="badge payée">toujours là</span></span><p>La pièce se joint à l'achat, tu remplis les cases. Rien ne sort de Tunisie.</p></div>
        </div>
        ${avecIA ? `<div class="ocr-part"><b>Ce qui part chez Anthropic, quand tu dis oui</b>
          <div class="ocr-gl ok">${lfIc('coche', 15, 2.4)}<span>L'image de la pièce, et la consigne de lecture de SkanFact</span></div>
          <div class="ocr-gl non">${lfIc('croix', 15, 2.4)}<span>Ni tes clients, ni tes chiffres, ni le nom de ton entreprise</span></div></div>
        <div class="ocr-pied"><span class="small muted">${coupee ? 'Coupée pour toute l\'entreprise : les pièces se joignent et se saisissent à la main.' : 'Le réglage vaut pour toute l\'entreprise.'}</span><button class="btn${coupee ? ' btn-primary' : ''}" id="ocr-ia">${coupee ? 'Proposer l\'IA de nouveau' : 'Couper l\'IA'}</button></div>` : ''}`;
      // (27/10/2026, revue des toasts) Un réglage qui se défait d'un clic offre « Annuler » sous la main.
      const poser = v => { data.company.lectureIA = v; save(true); drawOcrPanel(); };
      if ($('#ocr-ia', el)) $('#ocr-ia', el).onclick = () => {
        poser(coupee);
        toastUndo(coupee ? 'L\'IA se proposera à chaque pièce : elle ne lit que si tu dis oui.' : 'L\'IA est coupée : tes pièces se joindront et se saisiront à la main.', () => poser(!coupee));
      };
      return;
    }
    // En pause (8.7.0) : le panneau reste là pour DIRE où la fonction est passée — un réglage qui
    // disparaît sans un mot fait chercher — mais il n'offre plus rien à activer.
    if (OCR_EN_PAUSE) {
      $('#ocr-panel').innerHTML = `<p class="small mb"><span class="badge émis">En pause</span> La lecture automatique d'une photo de facture est mise en pause : tant qu'il n'existe pas d'application SkanFact sur téléphone, photographier une facture pour la faire lire n'a pas de vrai usage. Le code reste prêt pour le jour où elle existera.</p>
        <p class="small muted">Ce qui marche, hors ligne et sans rien envoyer : <b>« Joindre un justificatif… »</b> sur un achat, avant même de le saisir. <b>Aucune pièce ne quitte cet ordinateur.</b></p>`;
      return;
    }
    let st = { hasKey: false, model: '' };
    try { st = await bridge.ocrStatus(); } catch (_) {}
    // On REDEMANDE l'élément après l'attente : entre la question au processus principal et sa
    // réponse, l'utilisateur a pu changer de page, et l'écran est alors entièrement redessiné. La
    // poignée obtenue avant l'attente désigne un élément détaché — on écrivait dedans sans rien
    // afficher, puis `$('#ocr-key')` cherchait dans le document VIVANT, ne trouvait rien, et
    // `null.onclick` levait une exception que personne ne voyait.
    const el = $('#ocr-panel'); if (!el) return;
    el.innerHTML = `
      <p class="small mb">Photographier une facture fournisseur au lieu de la saisir. SkanFact envoie l'image à un service d'intelligence artificielle qui en lit les informations, puis <b>te propose un formulaire pré-rempli à valider</b>. Il ne remplit jamais tes données tout seul : une erreur de lecture sur une quantité fausserait tout ton stock.</p>
      <div class="vat-box" style="max-width:760px">
        <div class="vat-line"><span>État</span><span class="num">${st.hasKey ? '<span class="ok-text">Activé</span>' : 'Désactivé'}</span></div>
        <div class="vat-line"><span>Ce qui sort de ton ordinateur</span><span class="num">${st.hasKey ? 'l\'image, au moment où tu cliques' : '<span class="ok-text">rien</span>'}</span></div>
        <div class="vat-line"><span>Dernière lecture</span><span class="num">${st.lastUsed ? h(new Date(st.lastUsed).toLocaleString('fr-FR')) : '<span class="muted">jamais</span>'}</span></div>
      </div>
      <p class="small muted mt">${st.hasKey
        ? 'La clé est stockée sur cet ordinateur seulement (<code>lecture-config.json</code>), jamais dans tes données ni dans tes sauvegardes. Chaque lecture coûte quelques centimes, facturés par le fournisseur de la clé.'
        : 'Tant qu\'aucune clé n\'est saisie, <b>aucune pièce ne quitte cet ordinateur</b> : une photo de facture peut quand même être jointe à un achat comme justificatif, ce qui marche hors ligne.'}</p>
      <div class="inline mt">
        <button class="btn ${st.hasKey ? '' : 'btn-primary'}" id="ocr-key">${st.hasKey ? 'Changer la clé' : 'Activer la lecture de factures…'}</button>
        ${st.hasKey ? '<button class="btn btn-danger" id="ocr-off">Désactiver et effacer la clé</button>' : ''}
      </div>`;
    $('#ocr-key', el).onclick = () => ocrKeyForm(() => drawOcrPanel());
    if ($('#ocr-off', el)) $('#ocr-off', el).onclick = async () => {
      if (!await confirmDialog('Effacer la clé de cet ordinateur ? Plus rien ne sera envoyé nulle part. Tu pourras toujours joindre les photos comme justificatifs.')) return;
      await bridge.ocrSetKey(null);
      toast('Clé effacée'); drawOcrPanel();
    };
  }

  function ocrKeyForm(done) {
    modal(`<h2>Activer la lecture de factures</h2>
      <p class="small">Avant d'activer, lis ceci — c'est important et ça ne prend pas trente secondes :</p>
      <ul class="small" style="margin:0 0 14px 18px">
        <li>L'<b>image de la facture</b> est envoyée sur internet, à un service d'intelligence artificielle, au moment où tu cliques « Lire ». Rien d'autre ne part : ni tes clients, ni tes chiffres, ni ta comptabilité.</li>
        <li>Il faut une <b>clé payante</b>, que tu crées toi-même sur <code>console.anthropic.com</code>. Chaque facture lue coûte quelques centimes.</li>
        <li>La clé reste <b>sur cet ordinateur</b>, dans un fichier à part. Elle n'est jamais mise dans tes données ni dans tes sauvegardes.</li>
        <li>Tu peux tout désactiver et effacer la clé à tout moment, d'un clic.</li>
      </ul>
      <form id="okf" class="grid-2">
        <label class="field span-2">${lbl('Clé d\'API', 'ocr.key')}<input type="password" name="key" placeholder="sk-ant-…" autocomplete="off"></label>
        <label class="field span-2">${lbl('Modèle', 'ocr.model')}<input type="text" name="model" value="claude-sonnet-5" spellcheck="false"></label>
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Activer</button></div>`,
      (root, close) => {
        $('#ok', root).onclick = async () => {
          const v = formValues($('#okf', root));
          if (!(v.key || '').trim()) return refus($('[name=key]', root), 'Colle ta clé d\'API.');
          try {
            await bridge.ocrSetKey(v.key.trim(), (v.model || '').trim() || undefined);
            close(); toast('Lecture de factures activée'); if (done) done();
          } catch (e) { toast(e.message || 'Échec', true); }
        };
      });
  }

  function drawUpdatePill() {
    const pill = $('#update-pill'); if (!pill) return;
    const show = upd.state === 'available' || upd.state === 'downloading' || upd.state === 'downloaded';
    pill.hidden = !show;
    if (show) pill.textContent = upd.state === 'downloaded' ? `Version ${upd.version} prête` : `Version ${upd.version} en cours de téléchargement…`;
  }

  // Notes de version (markdown simple : titres et puces) → HTML sûr
  // Les notes de version viennent du CHANGELOG, qui est du Markdown. Le rendu ne traitait que les
  // titres et les listes : tout le reste s'affichait TEL QUEL, astérisques et accents graves
  // compris. Sur un écran que l'utilisateur regarde au moment précis où il décide d'installer une
  // mise à jour, ça donnait « **Les sélecteurs de période étirés** » et des `backticks` partout.
  //
  // On échappe D'ABORD, puis on remet la mise en forme : l'inverse laisserait passer du HTML venu
  // d'un fichier qu'on ne contrôle pas entièrement. Un lien devient son seul texte — il n'y a rien
  // à ouvrir depuis ce panneau, et un lien mort est pire qu'une phrase.
  function inlineMd(texte) {
    return h(texte)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  }

  function notesHtml(md) {
    const lines = String(md || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    let out = '', inList = false;
    for (const l of lines) {
      if (/^[-*] /.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inlineMd(l.slice(2))}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      if (/^#+ /.test(l)) out += `<h3>${inlineMd(l.replace(/^#+ /, ''))}</h3>`;
      else if (/^> /.test(l)) out += `<blockquote>${inlineMd(l.slice(2))}</blockquote>`;
      else out += `<p>${inlineMd(l)}</p>`;
    }
    if (inList) out += '</ul>';
    return `<div class="notes-md">${out}</div>`;
  }

  // Ce qu'on dit juste après avoir enregistré une clé, au même mot près depuis la porte de l'assistant
  // et depuis le panneau : « Licence enregistrée : active jusqu'au 24/09/2027 — offre Entreprise ».
  // L'état se nomme lui-même « Licence active… » : le recoller derrière « Licence enregistrée »
  // faisait dire deux fois « Licence » dans la même phrase.
  const licenceEnregistree = st => 'Licence enregistrée : ' + String((st && st.label) || '').replace(/^Licence /, '');

  // Le panneau de licence. Il dit l'état, ce qui est bloqué et ce qui ne l'est pas, et prépare la
  // demande. Jamais d'appel réseau : la vérification se fait avec la clé publique embarquée.
  function drawLicencePanel() {
    const el = $('#lic-panel'); if (!el) return;
    const st = licence || {};
    const saisie = $('#lic-key') ? $('#lic-key').value.trim() : '';
    const cls = st.state === 'active' || st.state === 'libre' || st.state === 'editeur' ? 'accepté' : st.state === 'essai' ? 'émis' : 'annulée';
    el.innerHTML = st.state === 'libre'
      ? `<p><span class="badge accepté">Licence non requise</span></p>
         <p class="small">Cette version de SkanFact n'exige aucune licence : tu peux l'utiliser et la partager telle quelle.</p>`
      : `<p><span class="badge ${cls}">${h(st.label || '')}</span></p>
         ${st.detail ? `<p class="small">${h(st.detail)}</p>` : ''}
         ${st.name ? `<table class="list compact"><tbody>
            <tr><td>Titulaire</td><td><strong>${h(st.name)}</strong></td></tr>
            ${st.matricule ? `<tr><td>Matricule</td><td>${h(st.matricule)}</td></tr>` : ''}
            <tr><td>Offre ${info('lic.offre')}</td><td><strong>${h(st.offreLabel || 'Entreprise')}</strong>${(st.reserves || []).length ? ` <span class="small muted">— ${h(C.liste((st.reserves || []).map(libelleOffre)))} restent lisibles ; leur création fait partie de l'offre Entreprise.</span>` : ''}</td></tr>
            ${st.exp ? `<tr><td>Valable jusqu'au</td><td>${C.fmtDate(st.exp)}</td></tr>` : ''}
            ${st.cabinet ? `<tr><td>Cabinet parrain</td><td class="mono">${h(st.cabinet)}</td></tr>` : ''}
            ${st.empreinte ? `<tr><td>Empreinte ${info('lic.empreinteCle')}</td><td><span class="mono">${h(st.empreinte)}</span>
              <button type="button" class="btn btn-ghost btn-sm" id="lic-copier-emp">Copier</button></td></tr>` : ''}
          </tbody></table>` : ''}
         ${/* 10.14.0 — acheter sans quitter l'application : rempli par `dessinerAchat`. */''}
         <div id="lic-achat"></div>
         <label class="field mt">${lbl('Clé de licence', 'lic.cle')}
           <textarea id="lic-key" rows="3" placeholder="SKAN1.…">${h(st.key || '')}</textarea></label>
         <div class="inline mt">
           ${/* 10.12.0 — vert sur une case vide, « Enregistrer la clé » était l'étape suivante de
                personne. Il s'allume quand une clé NOUVELLE est collée (U-11). */''}
           <button type="button" class="btn" id="lic-save">Enregistrer la clé</button>
           <button type="button" class="btn" id="lic-ask">Demander une licence</button>
           ${st.key ? '<button type="button" class="btn btn-ghost" id="lic-clear">Retirer la clé</button>' : ''}
         </div>
         <p class="small muted mt"><strong>Tes données t'appartiennent, licence ou pas.</strong> Même expirée, tu peux tout lire, imprimer, exporter et envoyer à ton comptable. Seule la création de nouvelles pièces attend le renouvellement.</p>
         <p class="small muted">La licence fonctionne <strong>sans connexion</strong> : sa signature se vérifie sur cet ordinateur. Ta clé n'est présentée qu'aux services de SkanFact — pour les mises à jour, et pour savoir si elle a été révoquée —, jamais à un tiers.</p>`;
    // La porte de l'éditeur — discrète exprès : elle ne concerne qu'une personne, et elle n'existe
    // que tant que l'application n'est PAS armée (`libre`). Une fois la clé publique embarquée, plus
    // aucun client ne la voit ; sur le poste de l'éditeur, le panneau « Éditeur » a pris le relais.
    if (!licence.editeur && licence.state === 'libre') el.innerHTML += `<p class="small muted mt"><button type="button" class="btn btn-ghost btn-sm" id="lic-devenir">Tu édites SkanFact ? Créer mes clés de signature…</button></p>`;
    // Une clé collée mais pas encore enregistrée survit à un redessin du panneau (« Enregistrer » des
    // Paramètres le redessine) : on ne jette pas ce qui vient d'être tapé.
    if (saisie && saisie !== (st.key || '') && $('#lic-key')) $('#lic-key').value = saisie;
    const cleNouvelle = () => { const v = $('#lic-key').value.trim(); return !!v && v !== (st.key || ''); };
    if ($('#lic-key') && $('#lic-save')) {
      const allumer = () => $('#lic-save').classList.toggle('btn-primary', cleNouvelle());
      $('#lic-key').addEventListener('input', allumer);
      allumer();
    }

    const setKey = async (key) => {
      try {
        // La clé est attachée au matricule : celui du FORMULAIRE compte, s'il vient d'être corrigé
        // et pas encore enregistré (règle 5.2.1 : tout geste des Paramètres enregistre d'abord).
        enregistrerEnCours();
        licence = await bridge.licenceSet(key, company().matricule || '');
        drawLicencePanel(); licenceBanner(); redessinerBarre();
        toast(licence.locked ? licence.label : key ? licenceEnregistree(licence) : 'Clé retirée — ' + licence.label);
      } catch (e) {
        // Le refus se MONTRE sur la case, comme à la porte de l'assistant (règle 7.0.0) : la clé
        // collée reste, marquée, avec la phrase qui dit pourquoi.
        if (key && $('#lic-key')) refus($('#lic-key'), plainError(e)); else toast(plainError(e), true);
      }
    };
    if ($('#lic-devenir')) $('#lic-devenir').onclick = devenirEditeur;
    // Une suite de 32 caractères qu'on affiche sans bouton pour la prendre est une suite de
    // 32 caractères qu'on recopie à la main, donc qu'on recopie faux (10.9.2).
    if ($('#lic-copier-emp')) $('#lic-copier-emp').onclick = () => copierTexte(st.empreinte, 'Empreinte copiée');
    if ($('#lic-save')) $('#lic-save').onclick = () => setKey($('#lic-key').value.trim());
    if ($('#lic-clear')) $('#lic-clear').onclick = async () => {
      if (!await confirmDialog('Retirer la clé de licence de cet ordinateur ?')) return;
      setKey('');
    };
    if ($('#lic-ask')) $('#lic-ask').onclick = async () => {
      if (!await messagerie()) return;
      const m = await bridge.licenceMail(company(), deviceLabel());
      await bridge.composeMail({ to: LICENCE_CONTACT, subject: m.subject, body: m.body, mode: modeEnvoi() });
      toast('Message préparé');
    };
    achatDessine = dessinerAchat();
  }

  // ---------- acheter depuis l'application (10.14.0) ----------
  // Le chemin du site, sans le site : l'offre se choisit ici, la commande part de la fiche société
  // (raison sociale, adresse, email, matricule — ce que la facture portera), le paiement se fait
  // chez le prestataire dans le navigateur, et la clé REVIENT toute seule. Plus de clé à copier
  // depuis un mail et à recoller ici, un caractère de moins, « pas reconnue ».
  //
  // Les prix ne sont écrits nulle part ici : ils viennent du serveur, qui les lit dans les réglages
  // de la console (10.5.0). Un prix écrit dans l'application serait faux au premier changement.
  let tarifsAchat = null, tarifsLusA = 0, achatDessine = null;
  // On achète quand on n'a pas de licence payée en cours. Un renouvellement pendant qu'une licence
  // court encore partirait d'AUJOURD'HUI et perdrait les jours déjà payés (règle 7.33.0) : il se
  // demande par mail tant que le serveur ne sait pas partir de la fin de la licence en cours.
  const achatPossible = st => !!st && !st.editeur && ['essai', 'finessai', 'expiree', 'invalide'].includes(st.state);
  const PHRASE_OFFRE = {
    independant: 'Ventes, achats, TVA et paquet du comptable. Sans stock, biens, paie, marges ni dossier partagé.',
    entreprise: 'Tout SkanFact : stock, biens, paie, trésorerie et marges, dossier partagé à deux.'
  };
  async function lireTarifs() {
    // Relus toutes les dix minutes au plus : un panneau qui se redessine ne doit pas interroger le
    // serveur à chaque frappe, et un prix changé dans la console doit finir par arriver.
    if (tarifsAchat && Date.now() - tarifsLusA < 10 * 60 * 1000) return tarifsAchat;
    try { tarifsAchat = await bridge.achatTarifs(); } catch (_) { tarifsAchat = { ouvert: false, raison: '' }; }
    tarifsLusA = Date.now();
    return tarifsAchat;
  }
  async function dessinerAchat() {
    const el = $('#lic-achat'); if (!el) return;
    const st = licence || {};
    const cmd = st.commande;
    if (cmd) {
      const offre = cmd.offre === 'independant' ? 'Indépendant' : 'Entreprise';
      el.innerHTML = `<div class="lic-achat">
          <p><strong>Ta commande attend son paiement</strong> ${info('lic.commande')}</p>
          <p class="small">Offre ${h(offre)}${Number(cmd.montant) ? ' — ' + C.money(Number(cmd.montant), cmd.devise === 'TND' ? 'DT' : (cmd.devise || 'DT')) + ' TTC' : ''}, commandée le ${C.fmtDate(String(cmd.creeLe || '').slice(0, 10))}. Une fois payée, ta clé s'enregistre ici toute seule — elle part aussi par mail.</p>
          <div class="inline">
            <button type="button" class="btn btn-primary" id="achat-verifier">J'ai payé : récupérer ma clé</button>
            <button type="button" class="btn" id="achat-reprendre">Rouvrir la page de paiement</button>
            <button type="button" class="btn btn-ghost" id="achat-oublier">Oublier cette commande</button>
          </div>
          <p class="small muted" id="achat-etat" aria-live="polite"></p>
        </div>`;
      $('#achat-verifier').onclick = () => verifierAchat(true);
      $('#achat-reprendre').onclick = async () => {
        const r = await bridge.achatReprendre().catch(() => null);
        if (!r || !r.ok) toast('La page de paiement n\'est plus disponible : oublie cette commande et repasse-la.', true);
      };
      $('#achat-oublier').onclick = async () => {
        if (!await confirmDialog('Oublier cette commande ?\n\nRien n\'a été payé : il n\'y a rien à annuler chez le prestataire. Si tu as payé, attends plutôt ta clé : elle arrive aussi par mail.', 'Oublier la commande', true, { prudent: true })) return;
        licence = await bridge.achatOublier(company().matricule || '');
        drawLicencePanel();
      };
      return;
    }
    if (!achatPossible(st)) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="small muted mt">Lecture des tarifs…</p>';
    const t = await lireTarifs();
    // Le panneau a pu être redessiné, ou quitté, pendant la question au serveur (10.5.0 : une
    // réponse en retard ne repeint pas l'écran qu'on a quitté).
    const ici = $('#lic-achat'); if (!ici || ici !== el) return;
    if (!t || !t.ouvert) {
      // Fermé, on le DIT — et le geste qui reste est le mail, juste en dessous.
      el.innerHTML = t && t.raison ? `<p class="small muted mt">${h(t.raison)} Demande ta licence par mail : « Demander une licence », ci-dessous.</p>` : '';
      return;
    }
    const urgent = st.locked || st.state === 'finessai' || st.state === 'expiree';
    const offres = (t.offres || []).filter(o => o.ttc != null);
    const devise = t.devise === 'TND' ? 'DT' : (t.devise || 'DT');
    el.innerHTML = `<div class="lic-achat">
        <p><strong>Acheter ta licence</strong> ${info('lic.acheter')}</p>
        <div class="lic-offres">
          ${offres.map(o => `<div class="lic-offre">
            <strong>${h(o.label)}</strong>
            <span class="lic-prix">${C.money(o.ttc, devise)} <span class="small muted">TTC${!t.duree || t.duree === '1a' ? ' · un an' : ''}</span></span>
            <span class="small muted">${h(PHRASE_OFFRE[o.id] || '')}</span>
            <button type="button" class="btn${urgent && o.id === 'entreprise' ? ' btn-primary' : ''}" data-acheter="${h(o.id)}">Acheter l'offre ${h(o.label)}…</button>
          </div>`).join('')}
        </div>
        <p class="small muted">Payée par carte chez le prestataire, dans ton navigateur. La clé revient ici toute seule — et par mail.</p>
      </div>`;
    $$('[data-acheter]', el).forEach(b => { b.onclick = () => acheter(b.dataset.acheter, t); });
  }

  async function acheter(offreId, t) {
    enregistrerEnCours();
    const co = company();
    const o = (t.offres || []).find(x => x.id === offreId);
    if (!o) return;
    // Ce que le serveur exige, dit AVANT la question : on ne confirme pas un achat pour lire ensuite
    // qu'il manque l'adresse e-mail (10.14.0, « un refus se dit avant la question »).
    if (!String(co.name || '').trim()) {
      if (await confirmDialog('La raison sociale de ton entreprise manque : c\'est elle que la facture et la licence porteront.', 'Compléter ma fiche', false)) allerParametres('societe', 'p-identite:name');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(co.email || '').trim())) {
      if (await confirmDialog('L\'adresse e-mail de ton entreprise manque : c\'est par là que la facture et la clé arrivent aussi.', 'Compléter ma fiche', false)) allerParametres('societe', 'p-identite:email');
      return;
    }
    const devise = t.devise === 'TND' ? 'DT' : (t.devise || 'DT');
    const cab = (co.cabinet || {}).fingerprint;
    const ligne = (k, v) => `<div><span>${h(k)}</span><span>${v}</span></div>`;
    const ok = await new Promise(resolve => {
      let fait = false;
      modal(`<h2>Acheter l'offre ${h(o.label)}</h2>
        <div class="kv recap-emission">
          ${ligne('Offre', `<strong>${h(o.label)}</strong> — un an`)}
          ${ligne('Montant', `<strong>${C.money(o.ttc, devise)} TTC</strong> <span class="small muted">(${C.money(o.ht, devise)} HT + TVA${o.timbre ? ' + timbre' : ''})</span>`)}
          ${cab && Number(t.remiseParrainage) ? ligne('Parrainage', `−${h(String(t.remiseParrainage))} % sur le HT si le serveur reconnaît ton cabinet — le montant exact s'affiche sur la page de paiement`) : ''}
          ${ligne('Au nom de', `<strong>${h(co.name)}</strong>${co.matricule ? ' · ' + h(co.matricule) : ''}`)}
          ${ligne('Clé et facture', h(co.email))}
        </div>
        <p class="small muted">Ce qui part au serveur de SkanFact : la raison sociale, l'adresse, l'adresse e-mail, le matricule, le téléphone${cab ? ' et l\'empreinte de ton cabinet (pour la remise)' : ''} — ce que la facture porte. Rien de tes clients, de tes pièces ni de tes montants.</p>
        <p class="small muted">Le paiement s'ouvre dans ton navigateur, chez le prestataire. Revenir ensuite ici suffit : la clé s'enregistre toute seule.</p>
        <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Payer ${C.money(o.ttc, devise)}…</button></div>`,
      (root, close) => {
        $('#ok', root).onclick = () => { fait = true; close(); resolve(true); };
        $('[data-close]', root).onclick = () => { fait = true; close(); resolve(false); };
      }, () => { if (!fait) resolve(false); }, { garde: false });
    });
    if (!ok) return;
    try {
      const r = await bridge.achatCommander(offreId, co);
      licence = await bridge.licenceStatus(co.matricule || '');
      drawLicencePanel();
      toast(r.payUrl ? 'La page de paiement s\'ouvre dans ton navigateur' : 'Commande enregistrée');
    } catch (e) { toast(plainError(e), true); }
  }

  // Redemande au serveur où en est la commande. `voulu` : un clic (on dit tout) ; sinon c'est le
  // retour au premier plan ou le démarrage, et une commande qui attend encore ne dit rien.
  let verifEnCours = false;
  async function verifierAchat(voulu) {
    if (verifEnCours || !(licence && licence.commande)) return;
    verifEnCours = true;
    const bouton = $('#achat-verifier');
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Vérification…'; }
    try {
      const r = await bridge.achatVerifier(data ? (company().matricule || '') : '');
      if (r && r.status) licence = r.status;
      if (r && r.etat === 'payee') {
        licenceBanner(); redessinerBarre();
        toast(licenceEnregistree(licence));
      } else if (voulu && r) {
        const phrase = r.phrase || 'Le paiement n\'est pas encore confirmé.';
        if (r.etat === 'ouverte') toast(phrase + ' Réessaie dans un instant.');
        else toast(phrase, r.etat === 'refusee' || r.etat === 'hors-ligne');
      } else if (r && (r.etat === 'refusee' || r.etat === 'inconnue')) {
        // Même sans clic, une commande que le serveur ne rendra jamais se dit une fois.
        toast(r.phrase, true);
      }
    } catch (e) { if (voulu) toast(plainError(e), true); }
    finally { verifEnCours = false; drawLicencePanel(); }
  }

  // La pastille du pied de la barre. Ce qu'elle dit et le ton qu'elle prend se décident dans
  // `core.pastilleLicence` (8.0.1) : la règle s'y teste sans Electron, et le renderer ne fait que
  // la poser. Elle est là pendant TOUT l'essai — un essai invisible est une surprise au
  // trente-et-unième jour — mais discrète tant qu'il reste du temps.
  function licenceBanner() {
    const el = $('#lic-banner');
    if (!el) return;
    const p = bridge.pastilleAbonnement ? bridge.pastilleAbonnement() : C.pastilleLicence(licence);
    // (maquette « Barre v3 ») L'abonnement parle quand il faut : rien quand tout est payé ; calme pendant l'essai, ambre
    // à l'approche, rouge le dernier jour ou en retard. C'est l'affaire de qui le règle : les autres ne voient que la
    // lecture seule, qui les touche.
    const responsable = !bridge.droitsDossier || !!(bridge.droitsDossier() || {}).responsable;
    const lecture = /^Lecture seule$/.test(p.texte || '');
    const montre = p.show && (responsable || lecture);
    el.hidden = !montre;
    el.classList.toggle('warn', p.ton === 'alerte' || p.ton === 'attire');
    el.classList.toggle('alerte', p.ton === 'alerte');
    el.classList.toggle('attire', p.ton === 'attire');
    el.classList.toggle('calme', p.ton === 'calme');
    if (!montre) return;
    const t = p.texte || '';
    const sous = lecture ? (responsable ? 'Règle ta facture pour créer' : 'La propriétaire règle la facture')
      : /^Lecture seule le/.test(t) ? 'Facture non réglée' : /^Échéance/.test(t) ? 'Ta facture t\'attend' : /^S'arrête/.test(t) ? 'Tu peux encore continuer'
        : /dernier jour/.test(t) ? 'Choisis ton offre aujourd\'hui' : p.ton === 'attire' ? 'Choisis ton offre' : 'Tout est ouvert, sans carte';
    const dessin = /Lecture seule/.test(t) ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
      : /^(Échéance|S'arrête)/.test(t) ? '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
    el.innerHTML = `<span class="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dessin}</svg></span>`
      + `<span class="lib"><span class="abo-t">${h(t)}</span><small>${h(sous)}</small></span><span class="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>`;
    el.dataset.tip = t;
    if (window.SkanBarre) window.SkanBarre.apresCompte();
  }

  // ---------- l'éditeur de SkanFact (7.33.0) ----------
  //
  // SkanFact se vend, et la vente d'une licence est une facture comme une autre : elle passe par le
  // dossier de l'ÉDITEUR — client, prestation du catalogue, TVA, timbre, journal des ventes, paquet du
  // comptable. Un programme à part aurait refait la facturation et laissé sa comptabilité fausse.
  // Le module n'apparaît que sur le poste où vit la clé privée de signature (`licence.editeur`), et
  // la clé ne traverse jamais le pont : l'écran envoie les champs, main.js signe.

  // L'état de licence du poste, relu avec le matricule de la société ouverte. Rejoué au chargement
  // du dossier et quand la fiche société change : un état lu une fois au démarrage se périme (7.1.x).
  async function rafraichirLicence() {
    try {
      const mf = data ? (company().matricule || '') : '';
      const st = await bridge.licenceStatus(mf);
      if (st) { licence = st; licenceMatriculeVu = mf; }
      editeur = licence.editeur ? await bridge.editeurStatus().catch(() => null) : null;
      pont = licence.editeur ? (await bridge.pontStatus().catch(() => null)) || { editeur: true, base: '', configure: false } : { editeur: false, base: '', configure: false };
    } catch (_) {}
    licenceBanner();
  }
  // Redessiner la barre sans changer de page : `drawNav` réécrit les liens, donc le marquage de la
  // page ouverte se refait ici.
  function redessinerBarre() {
    if (!data) return;
    const actif = $('nav a.active, .sidebar-foot a.active');
    const route = actif ? actif.dataset.route : '';
    drawNav();
    $$('nav a, .sidebar-foot a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
    updateNavCounts();
    montrerEntreeActive();
  }
  // « cabinet » (9.4.1) n'est pas une offre de `editeur.offres` : c'est le TYPE d'une licence de
  // SkanFact Cabinet, rangé dans `offre` pour que la colonne reste renseignée.
  const offreLabelDe = id => id === 'cabinet' ? 'Cabinet comptable'
    : ((editeur && editeur.offres && editeur.offres[id]) || {}).label || (id === 'independant' ? 'Indépendant' : 'Entreprise');
  const dureeLabelDe = id => (((editeur && editeur.durees) || []).find(d => d.id === id) || {}).label || '';

  async function copierTexte(txt, msg) {
    try { await navigator.clipboard.writeText(txt); toast(msg || 'Copié'); }
    catch (_) { toast('Impossible d\'accéder au presse-papiers.', true); }
  }
  async function copierClePublique() {
    try { await bridge.editeurCopierPublique(); toast('Clé publique copiée — colle-la dans la conversation qui prépare la prochaine version'); }
    catch (e) { toast(plainError(e), true); }
  }
  async function abriterClePrivee() {
    try {
      const r = await bridge.editeurExporter();
      if (!r || !r.ok) return;
      if (r.autreCle) toast(`Copie enregistrée : ${r.path} — le fichier public déjà présent à côté est celui d'une AUTRE clé, il n'a pas été touché.`, true);
      else toast(r.publique ? `Deux fichiers enregistrés : ${r.path} et licence-publique.json à côté` : 'Copie enregistrée : ' + r.path);
    } catch (e) { toast(plainError(e), true); }
  }

  // Devenir l'éditeur : créer ses clés de signature, ou reprendre celles d'un autre ordinateur.
  async function devenirEditeur() {
    enregistrerEnCours();   // la suite redessine la page : rien de ce qui est tapé ne doit se perdre
    const c = await choiceDialog('Tes clés de signature — réservé à l\'éditeur de SkanFact',
      'Si tu n\'es pas l\'éditeur de SkanFact, ferme cette fenêtre : ces clés ne servent qu\'à VENDRE des licences. '
      + 'La clé PRIVÉE signe les licences ; elle reste sur cet ordinateur. La clé PUBLIQUE, embarquée dans SkanFact, permet à l\'application de chaque client de reconnaître ta signature. '
      + 'Si tu as déjà créé tes clés sur un autre ordinateur, reprends-les : en créer de nouvelles rendrait invalides toutes les licences déjà émises.',
      'Créer de nouvelles clés', 'Reprendre ma clé existante…');
    if (!c) return;
    try {
      if (c === 'a') await bridge.editeurKeygen();
      else { const r = await bridge.editeurImporter(); if (!r || r.canceled) return; }
    } catch (e) { return toast(plainError(e), true); }
    await rafraichirLicence();
    redessinerBarre();
    modal(`<h2>Tes clés sont ${c === 'a' ? 'créées' : 'reprises'}</h2>
      <p>Ta clé privée est dans <code>${h((editeur || {}).chemin || '')}</code>. Elle ne quitte jamais cet ordinateur : ni dans tes données, ni dans tes sauvegardes, ni dans le paquet du comptable.</p>
      <p class="small"><strong>Mets-en une copie à l'abri maintenant</strong> (gestionnaire de mots de passe, clé USB à part). Si tu la perds, tu ne pourras plus renouveler aucun client existant — aucun logiciel ne peut la refabriquer.</p>
      <p class="small">La clé <strong>publique</strong> n'a rien de secret : c'est elle qu'il faut embarquer dans la prochaine version de SkanFact pour armer l'application de tout le monde. « Copier la clé publique » la met dans le presse-papiers.</p>
      <div class="modal-actions"><button class="btn" data-close>Plus tard</button><button class="btn" id="ed-copie">Copier la clé publique</button><button class="btn btn-primary" id="ed-abri">Enregistrer une copie de la clé privée…</button></div>`,
      (root) => {
        $('#ed-copie', root).onclick = copierClePublique;
        $('#ed-abri', root).onclick = abriterClePrivee;
      });
    render();
  }

  // Le panneau de l'éditeur (Paramètres → L'application), sous le panneau Licence.
  function drawEditeurPanel() {
    const el = $('#editeur-panel'); if (!el || !editeur) return;
    const n = (data.licences || []).length;
    // Trois états, pas deux : armée avec CETTE clé, pas encore armée, ou armée avec une AUTRE clé —
    // dans ce dernier cas les licences émises ici ne valent nulle part, pas même sur ce poste.
    const etat = editeur.correspond ? 'ok' : editeur.armee ? 'autre' : 'attente';
    el.innerHTML = `<p><span class="badge accepté">Clés de signature présentes sur cet ordinateur</span>
        ${etat === 'ok' ? '<span class="badge accepté">Application armée avec cette clé</span>' : etat === 'autre' ? '<span class="badge annulée">Application armée avec une AUTRE clé</span>' : '<span class="badge émis">En attente d\'armement</span>'}</p>
      <p class="small">Clé privée : <code>${h(editeur.chemin)}</code>. ${etat === 'ok'
        ? 'L\'application de tes clients est armée avec cette clé : les licences que tu émets sont valables chez eux.'
        : etat === 'autre'
          ? 'SkanFact embarque une autre clé publique que la tienne : les licences que tu émettrais ne seraient reconnues NULLE PART, pas même ici. Reprends la bonne clé privée, ou fais embarquer celle-ci dans la prochaine version.'
          : 'Tant que la clé publique n\'est pas embarquée dans SkanFact, les licences que tu émets ne sont reconnues que sur ce poste : copie-la et fais-la embarquer dans la prochaine version.'}</p>
      <div class="inline mt">
        <button type="button" class="btn btn-primary" id="ed-lic">Ouvrir la page Licences${n ? ` (${n})` : ''}</button>
        <button type="button" class="btn" id="ed-emettre">Émettre une licence…</button>
        <button type="button" class="btn" id="ed-pub">Copier la clé publique</button>
        <button type="button" class="btn" id="ed-exp">Enregistrer une copie de la clé privée…</button>
      </div>
      <p class="small muted mt"><strong>Sans copie de la clé privée, un disque qui lâche rend impossible tout renouvellement chez tes clients.</strong> Une copie dans ton gestionnaire de mots de passe ou sur une clé USB à part suffit.</p>
      ${blocCleReponse(editeur.reponse || {})}
      ${blocCleServeur(editeur.serveur || {})}
      ${blocPont(pont)}`;
    $('#ed-lic').onclick = () => navigate('#/licences');
    $('#ed-emettre').onclick = () => licenceForm(null, null);
    $('#ed-pub').onclick = copierClePublique;
    $('#ed-exp').onclick = abriterClePrivee;
    brancherCleReponse();
    brancherCleServeur();
    brancherPont();
  }

  // ---------- le pont comptable (8.7.0, § 11 du plan) ----------
  //
  // La console vend (clé, vente, mail) ; la comptabilité, elle, est ici. SkanFact TIRE les ventes
  // non facturées, fabrique un BROUILLON de facture par vente (jamais un numéro : il se prend à
  // l'émission, comme partout), et rend le numéro à la console une fois la facture émise. Le secret
  // d'administration vit à côté des clés de signature, jamais dans les données.
  function blocPont(p) {
    if (!p.base) {
      return `<p class="mt"><strong>Pont comptable — la console vend, SkanFact facture</strong> <span class="badge">Pas de plan de contrôle dans cette version</span></p>
        <p class="small">Cette version de SkanFact n'a pas d'adresse de console : le pont n'a rien à quoi se brancher.</p>`;
    }
    return `<p class="mt"><strong>Pont comptable — la console vend, SkanFact facture</strong> ${p.configure ? '<span class="badge accepté">Branché</span>' : '<span class="badge émis">Pas encore branché</span>'}</p>
      <p class="small">${p.configure
        ? `Le secret d'administration de la console est enregistré sur cet ordinateur. La page Licences montre les ventes de la console qui n'ont pas encore de facture, et rend à la console le numéro de chaque facture émise ici.`
        : `Colle ici le <strong>secret d'administration</strong> de la console (le réglage <code>ADMIN_SECRET</code> du service). Il est enregistré à côté de tes clés de signature, jamais dans tes données ni dans une sauvegarde — et il est essayé tout de suite.`}</p>
      <div class="inline mt">
        <input type="password" id="ed-pont-secret" placeholder="${p.configure ? 'Nouveau secret (laisser vide pour garder l\'actuel)' : 'Secret d\'administration de la console'}" autocomplete="off" style="min-width:320px">
        <button type="button" class="btn ${p.configure ? '' : 'btn-primary'}" id="ed-pont-save">${p.configure ? 'Remplacer le secret' : 'Brancher la console'}</button>
        ${p.configure ? '<button type="button" class="btn" id="ed-pont-retirer">Débrancher</button>' : ''}
      </div>
      ${p.configure ? `<div class="inline mt">
        <button type="button" class="btn" id="ed-pont-ventes">Voir les ventes à facturer</button>
        ${C.chargeHistorique(data, company()).length && !data.pontImporte ? '<button type="button" class="btn" id="ed-pont-import">Envoyer l\'historique à la console…</button>' : ''}
      </div>
      ${data.pontImporte ? `<p class="small muted mt">Historique envoyé à la console le ${C.fmtDate(data.pontImporte)}.</p>` : ''}
      ${blocExportConsole()}` : ''}`;
  }

  // L'export de la base de la console (10.4.0). La base du service est le SEUL endroit où vit
  // « qui a acheté quelle clé » : sans copie, la perdre emporte toutes les ventes, et plus aucune
  // clé vendue ne peut être renvoyée, renouvelée ni révoquée. L'avertissement se lit AVANT le
  // geste, jamais sous le bouton (9.4.2).
  function blocExportConsole() {
    const e = C.exportConsoleAFaire(data, C.today());
    const etat = !e.du
      ? '<span class="badge retard">Jamais exportée</span>'
      : (e.reclame ? `<span class="badge partielle">Exportée il y a ${pl(e.jours, 'jour')}</span>` : `<span class="badge payée">Exportée le ${C.fmtDate(e.du)}</span>`);
    return `<p class="mt"><strong>La copie de la base</strong> ${etat}</p>
      <p class="small">La base de la console porte tes clients, tes licences et tes ventes — et le contenu signé de chaque clé, celui qui permet de la refabriquer à l'identique. L'export la range dans un seul fichier de <code>~/.skanfact/</code>, à côté de tes clés : jamais dans tes données, jamais dans une sauvegarde, jamais dans un dossier partagé.</p>
      <div class="inline mt"><button type="button" class="btn ${e.reclame ? 'btn-primary' : ''}" id="ed-export-base">Exporter la base…</button></div>`;
  }
  function brancherPont() {
    const champ = $('#ed-pont-secret');
    if ($('#ed-pont-save')) $('#ed-pont-save').onclick = async () => {
      const secret = (champ && champ.value || '').trim();
      if (!secret) return refus('#ed-pont-secret', 'Colle le secret d\'administration de la console.');
      const b = $('#ed-pont-save'); b.disabled = true;
      try {
        const r = await bridge.pontSetSecret(secret);
        pont = { ...pont, configure: !!r.configure };
        const e = r.etat || {};
        toast(`Console branchée${e.emission ? ' — ' + e.emission : ''}`);
        drawEditeurPanel();
      } catch (e) { b.disabled = false; toast(plainError(e), true); }
    };
    if ($('#ed-pont-retirer')) $('#ed-pont-retirer').onclick = async () => {
      if (!await confirmDialog('Débrancher la console ? Le secret est effacé de cet ordinateur. Les brouillons déjà créés restent, et rien n\'est touché sur la console.', 'Débrancher', false)) return;
      try { await bridge.pontSetSecret(''); pont = { ...pont, configure: false }; drawEditeurPanel(); toast('Console débranchée'); }
      catch (e) { toast(plainError(e), true); }
    };
    if ($('#ed-pont-ventes')) $('#ed-pont-ventes').onclick = () => navigate('#/licences');
    if ($('#ed-pont-import')) $('#ed-pont-import').onclick = envoyerHistoriqueConsole;
    if ($('#ed-export-base')) $('#ed-export-base').onclick = async () => {
      const b = $('#ed-export-base'); b.disabled = true;
      try {
        const r = await bridge.pontExporterBase();
        // Le COMPTE par table, dit : un export tronqué ressemble à un export complet, et c'est le
        // jour où l'on en a besoin qu'on s'en aperçoit (règle du manifeste, 6.1.0).
        const lignes = Object.keys(r.comptes || {}).map(t => `${t} : ${r.comptes[t]}`).join('\n');
        data.exportConsole = r.jour; save(true);
        await infoDialog('Base exportée', `${r.chemin}\n\n${lignes}\n\nEmpreinte : ${String(r.sha256 || '').slice(0, 16)}…\n\nCe fichier n'est pas chiffré et porte tes clients : garde-le où tu gardes tes clés.`);
        drawEditeurPanel();
      } catch (e) { b.disabled = false; toast(plainError(e), true); }
    };
  }

  // L'historique des licences émises DANS SkanFact part UNE fois vers la console, pour qu'elle
  // connaisse tous les clients. Ce qui part est listé avant d'être envoyé (règle du paquet : on
  // voit ce qui partira), et la console dit ce qu'elle a pris, ce qu'elle avait déjà, ce qu'elle
  // a refusé — jamais un « ok » muet.
  async function envoyerHistoriqueConsole() {
    const charge = C.chargeHistorique(data, company());
    if (!charge.length) return toast('Aucune licence émise ici à envoyer.');
    const ok = await confirmDialog(`Envoyer ${pl(charge.length, 'licence')} à la console ?\n\nPour chacune : la clé, le client (nom, matricule, email), l'offre, les dates, le prix et le numéro de facture s'il existe. Rien d'autre — pas tes autres clients, pas tes autres factures.\n\nUne licence déjà connue de la console est laissée telle quelle.`, 'Envoyer', false);
    if (!ok) return;
    try {
      const r = await bridge.pontRequete('importer', { licences: charge });
      data.pontImporte = C.today(); save(true);
      const refus = (r.ignorees || []).length ? `\n\nRefusées (${r.ignorees.length}) : ${r.ignorees.slice(0, 5).map(x => `${x.id} — ${x.raison}`).join(' ; ')}${r.ignorees.length > 5 ? '…' : ''}` : '';
      await infoDialog('Historique envoyé', `${pl(r.importees || 0, 'licence importée', 'licences importées')}, ${pl(r.dejaLa || 0, 'déjà connue', 'déjà connues')}.${refus}`);
      drawEditeurPanel();
    } catch (e) { toast(plainError(e), true); }
  }

  // Rendre à la console le numéro des factures émises ici. Silencieux : un échec réseau ne doit
  // pas interrompre ce que l'utilisateur faisait ; la prochaine ouverture de la page réessaiera.
  async function annoncerFacturesConsole() {
    if (!pont.configure) return 0;
    let n = 0;
    for (const d of C.facturesAAnnoncer(data)) {
      try {
        await bridge.pontRequete(`ventes/${d.venteConsoleId}/facturee`, { numero: d.number });
        d.factureeAnnoncee = C.today(); n++;
      } catch (_) { break; }
    }
    if (n) save(true);
    return n;
  }

  // Le bloc « Ventes de la console » de la page Licences.
  async function drawVentesConsole() {
    const el = $('#lic-console'); if (!el || !pont.configure) return;
    el.hidden = false;
    el.innerHTML = '<h2>Ventes de la console</h2><p class="muted small">Lecture des ventes…</p>';
    const annoncees = await annoncerFacturesConsole();
    let lignes;
    try { lignes = ((await bridge.pontRequete('ventes?non_facturees=1')) || {}).lignes || []; }
    catch (e) {
      const el2 = $('#lic-console'); if (!el2) return;
      // Ce panneau a la place d'un code, et c'est le refus qu'on dépanne le plus souvent à distance
      // (un secret d'administration mal collé, une console éteinte). Le code va au bout, en gris.
      const code = codeErreur(e);
      el2.innerHTML = `<h2>Ventes de la console</h2><p class="small" style="color:var(--danger)">${h(plainError(e))}`
        + (code ? ` <span class="muted">${h(code)}</span>` : '') + '</p>';
      return;
    }
    const el2 = $('#lic-console'); if (!el2) return;
    // Une vente déjà tirée (le brouillon existe ici, pas encore émis) ne se propose pas deux fois.
    const dejaLa = new Set(data.documents.filter(d => d.venteConsoleId).map(d => d.venteConsoleId));
    const nouvelles = lignes.filter(v => !dejaLa.has(v.id));
    const enAttente = lignes.filter(v => dejaLa.has(v.id));
    // « TND » (la console) et « DT » (SkanFact) sont la même monnaie : elle s'écrit comme partout ici (M-14).
    const cur = x => C.money(Number(x.montant_ht) || 0, C.normCurrency(x.devise || 'DT'));
    el2.innerHTML = `<h2>Ventes de la console ${info('lic.console')}</h2>
      ${nouvelles.length ? `<p class="small">${pl(nouvelles.length, 'vente')} sans facture. Un clic crée un <strong>brouillon</strong> par vente ; le numéro se prend à l'émission, et il est rendu à la console.</p>
        <div class="scroll-x"><table class="list"><thead><tr><th>Client</th><th>Offre</th><th>Fin</th><th class="r">Montant HT</th><th>Payée</th></tr></thead><tbody>
        ${nouvelles.map(v => `<tr><td><strong>${h(v.client || '')}</strong>${v.matricule ? `<div class="small muted">MF ${h(v.matricule)}</div>` : ''}${C.clientPourVente(data.clients, v) ? '' : '<div class="small muted">nouveau client — sa fiche sera créée</div>'}</td>
          <td>${h(offreLabelDe(v.offre))}</td><td>${v.fin ? C.fmtDate(v.fin) : '<span class="muted">À vie</span>'}</td><td class="r nw">${cur(v)}</td>
          <td>${v.payee_le ? `<span class="ok-text">${C.fmtDate(v.payee_le)}${v.moyen ? ' · ' + h(v.moyen) : ''}</span>` : '<span class="muted">pas encore</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="inline mt"><button class="btn btn-primary" id="lic-console-brouillons">Créer ${nouvelles.length > 1 ? 'les ' + nouvelles.length + ' brouillons' : 'le brouillon'} de facture</button></div>`
        : `<p class="small muted">Aucune vente en attente de facture${enAttente.length ? '' : ' : la console et ta comptabilité sont d\'accord'}.</p>`}
      ${enAttente.length ? `<p class="small muted mt">${pl(enAttente.length, 'brouillon')} déjà créé${enAttente.length > 1 ? 's' : ''} depuis la console, à émettre : ${enAttente.map(v => { const d = data.documents.find(x => x.venteConsoleId === v.id); return d ? `<a href="#/doc/${h(d.id)}">${h(v.client || d.id)}</a>` : ''; }).filter(Boolean).join(', ')}.</p>` : ''}
      ${annoncees ? `<p class="small muted">${pl(annoncees, 'numéro de facture rendu', 'numéros de facture rendus')} à la console.</p>` : ''}`;
    if ($('#lic-console-brouillons')) $('#lic-console-brouillons').onclick = () => creerBrouillonsConsole(nouvelles);
  }

  // Un brouillon par vente. Le client est retrouvé par matricule puis par nom, créé sinon ; la ligne
  // porte le montant HT vendu par la console, la TVA du régime de la société, la remise de
  // parrainage ; et la licence entre dans l'historique local avec `origine: 'console'` — elle se
  // lit et s'envoie ici, mais ne se renouvelle ni ne se révoque ici : c'est la console qui l'a
  // signée, c'est elle qui la reprend.
  async function creerBrouillonsConsole(ventes) {
    if (await demoBlock('Créer des factures depuis la console')) return;
    if (licenceBlock('Créer une facture de licence')) return;
    let crees = 0, clientsCrees = 0;
    ventes.forEach(v => {
      if (data.documents.some(d => d.venteConsoleId === v.id)) return;
      let client = C.clientPourVente(data.clients, v);
      if (!client) {
        // 10.9.1 — une vente en ligne porte tout ce qu'une facture réclame : la raison sociale
        // (`v.client`), le contact, l'adresse, le téléphone. Les laisser vides obligeait à les
        // ressaisir sur la première facture, dans un pont fait pour ne rien ressaisir.
        client = { id: C.uid(), name: v.client || 'Client de la console', contact: v.contact || '', matricule: v.matricule || '',
          address: v.adresse || '', phone: v.tel || '', email: v.email || '', notes: '', withholdingRate: '' };
        data.clients.push(client); clientsCrees++;
      } else {
        // Une fiche qui existe déjà appartient à son auteur : on COMBLE ce qui est vide, jamais
        // plus. Écraser une adresse corrigée à la main par celle d'une commande serait perdre
        // une correction que personne ne se rappellerait avoir faite.
        [['email', 'email'], ['contact', 'contact'], ['address', 'adresse'], ['phone', 'tel'], ['matricule', 'matricule']]
          .forEach(([ici, la]) => { if (!client[ici] && v[la]) client[ici] = v[la]; });
      }
      const inv = newDocument('facture');
      applyClientDefaults(inv, client.id);
      // La console vend dans SA devise (le tarif) : la facture la garde. Mais elle écrit le dinar
      // « TND » quand SkanFact écrit « DT » — sans `normCurrency`, le brouillon réclamait un taux de
      // change entre le dinar et lui-même (trouvé par l'e2e). Une vraie devise étrangère, elle,
      // laisse le taux à saisir, et « À faire » le réclame comme pour toute pièce.
      inv.currency = C.normCurrency(v.devise || company().currency); inv.exchangeRate = '';
      const fin = v.fin ? 'jusqu\'au ' + C.fmtDate(v.fin) : 'sans limite de durée';
      // Une vente de licence de CABINET (9.4.1) se facture comme telle : le produit est SkanFact
      // Cabinet et ce qui est vendu est un quota de dossiers, pas une offre.
      const cab = v.type === 'cabinet';
      const produit = cab ? `SkanFact Cabinet — ${pl(Number(v.dossiers_hors) || 0, 'dossier')} hors SkanFact` : `SkanFact ${offreLabelDe(v.offre)}`;
      inv.lines = [{ label: `Licence ${produit} — ${fin}`, description: `Licence n° ${v.licence_id}, ${fin}`,
        qty: 1, unit: '', unitPrice: Number(v.montant_ht) || 0, unitCost: '', vatRate: C.tauxPourRegime(company(), v.tva !== null && v.tva !== undefined && v.tva !== '' ? Number(v.tva) : C.defaultVat(company())) }];
      Object.assign(inv, { clientId: client.id, subject: `Licence ${cab ? 'SkanFact Cabinet' : 'SkanFact ' + offreLabelDe(v.offre)}`,
        discountRate: Math.min(100, Math.max(0, Number(v.remise) || 0)), withholdingRate: clientWithholding(client.id),
        licenceId: v.licence_id, venteConsoleId: v.id });
      data.documents.push(inv);
      if (v.licence_id && !data.licences.some(l => l.id === v.licence_id)) {
        data.licences.push({ id: v.licence_id, clientId: client.id, nom: client.name, matricule: v.matricule || '', offre: v.offre || 'entreprise',
          exp: v.fin || '', key: v.cle || '', emisLe: (v.emise_le || '').slice(0, 10), cabinet: v.cabinet_empreinte || '', note: '', invoiceId: inv.id, itemId: '',
          prix: Number(v.montant_ht) || 0, tva: inv.lines[0].vatRate, emails: [], remplace: '', origine: 'console',
          type: cab ? 'cabinet' : 'entreprise', dossiersHors: cab ? Number(v.dossiers_hors) || 0 : 0,
          envoyeeConsoleLe: (v.envoyee_le || '').slice(0, 10), payeeConsoleLe: v.payee_le || '', revoqueeLe: v.revoquee_le || '' });
      }
      crees++;
    });
    save(true);
    redessinerBarre();
    toast(`${pl(crees, 'brouillon créé', 'brouillons créés')}${clientsCrees ? ' · ' + pl(clientsCrees, 'fiche client créée', 'fiches client créées') : ''}`);
    render(true);
  }

  // ---------- la clé du serveur (8.5.0, P 0.2) ----------
  //
  // La console (api.skanfact.tn) signe les ventes courantes avec une clé de SECOND rang, « srv-1 ».
  // Elle se fabrique ici, sur cet ordinateur, comme la clé de réponse : sa moitié privée va dans le
  // réglage SRV_PRIVATE_KEY du service, sa moitié publique dans la version suivante de SkanFact (et
  // dans LICENCE_PUBLIC_KEYS du service, pour qu'il reconnaisse ses propres clés).
  //
  // Tant que la publique n'est pas embarquée, une clé émise par la console est REFUSÉE par les
  // clients (« pas reconnue ») : le panneau le dit, sinon on vendrait des clés qui n'ouvrent rien.
  function blocCleServeur(srv) {
    const etat = !srv.existe ? 'absente' : (!srv.embarquee ? 'attente' : (srv.correspond ? 'ok' : 'autre'));
    const badge = { absente: '<span class="badge émis">Pas encore créée</span>',
      attente: '<span class="badge émis">Créée — en attente d\'embarquement</span>',
      ok: '<span class="badge accepté">La console peut vendre</span>',
      autre: '<span class="badge annulée">L\'application embarque une AUTRE clé « srv-1 »</span>' }[etat];
    const dit = {
      absente: 'Sans cette clé, la console ne peut pas émettre de licence : chaque vente passe par ce poste. Créer la clé ici la garde sur cet ordinateur — elle ne doit jamais passer par ailleurs. C\'est une clé de second rang : si le service est compromis un jour, on la retire sans toucher à ta clé maître ni aux licences qu\'elle a signées.',
      attente: 'La clé existe sur cet ordinateur. Il reste trois gestes : coller la <strong>privée</strong> dans le réglage <code>SRV_PRIVATE_KEY</code> du service, coller la <strong>liste complète</strong> (bouton « Copier LICENCE_PUBLIC_KEYS ») dans le réglage <code>LICENCE_PUBLIC_KEYS</code> du service — jamais la clé seule —, et la publique dans la version suivante de SkanFact. Tant que la version n\'est pas publiée, une clé émise par la console est refusée par les clients.',
      ok: 'L\'application publiée embarque cette clé sous le kid <code>srv-1</code> : les clés émises depuis la console sont reconnues chez les clients.',
      autre: 'SkanFact embarque une autre clé « srv-1 » que celle de cet ordinateur : les clés signées par le service avec celle-ci seraient refusées partout. Reprends la bonne clé privée, ou fais embarquer celle-ci dans la prochaine version.'
    }[etat];
    return `<p class="mt"><strong>Plan de contrôle — clé du serveur (${h(srv.kid || 'srv-1')})</strong> ${badge}</p>
      <p class="small">${dit}</p>
      <div class="inline mt">
        ${srv.existe
          ? `<button type="button" class="btn" id="ed-srv-priv">Copier la clé privée (pour le service)</button>
             <button type="button" class="btn" id="ed-srv-service">Copier LICENCE_PUBLIC_KEYS (pour le service)</button>
             <button type="button" class="btn" id="ed-srv-pub">Copier la clé publique (pour la version)</button>`
          : '<button type="button" class="btn btn-primary" id="ed-srv-creer">Créer la clé du serveur</button>'}
      </div>`;
  }
  function brancherCleServeur() {
    if ($('#ed-srv-creer')) $('#ed-srv-creer').onclick = async () => {
      if (!await confirmDialog('Créer la clé du serveur (srv-1) ?\n\n'
        + 'Elle est écrite sur cet ordinateur, à côté de ta clé maître. Tu colleras ensuite sa moitié privée dans les réglages du service, et sa moitié publique dans la version suivante de SkanFact.',
        'Créer la clé', false)) return;
      try { editeur = await bridge.cleServeurCreer(); drawEditeurPanel(); toast('Clé du serveur créée'); }
      catch (e) { toast(plainError(e), true); }
    };
    if ($('#ed-srv-priv')) $('#ed-srv-priv').onclick = async () => {
      try { await bridge.cleServeurCopier('privee'); toast('Clé PRIVÉE copiée — colle-la dans le réglage SRV_PRIVATE_KEY du service, puis vide ton presse-papiers'); }
      catch (e) { toast(plainError(e), true); }
    };
    if ($('#ed-srv-pub')) $('#ed-srv-pub').onclick = async () => {
      try { await bridge.cleServeurCopier('publique'); toast('Clé publique copiée — colle-la dans la conversation qui prépare la prochaine version'); }
      catch (e) { toast(plainError(e), true); }
    };
    // La liste complète, assemblée par l'application : coller la clé seule dans ce réglage laissait
    // le service sans aucune clé (15/09/2026).
    if ($('#ed-srv-service')) $('#ed-srv-service').onclick = async () => {
      try { const r = await bridge.cleServeurCopier('service'); toast(`Valeur copiée (${pl(r.nombre, 'clé')}) — colle-la telle quelle dans le réglage LICENCE_PUBLIC_KEYS du service, du [ au ]`); }
      catch (e) { toast(plainError(e), true); }
    };
  }

  // ---------- la clé de réponse du plan de contrôle (8.4.0) ----------
  //
  // Le serveur signe ses réponses, l'application vérifie cette signature : c'est ce qui empêche
  // n'importe quel intermédiaire de répondre « révoquée » à un client qui a payé. Il faut donc une
  // seconde paire de clés, et elle se fabrique sur CET ordinateur — jamais ailleurs.
  //
  // Tant que la moitié publique n'est pas embarquée dans une version publiée, aucune réponse du
  // serveur ne restreint quoi que ce soit. Le panneau le dit en toutes lettres : c'est ce qui rend
  // la mise en place sans danger, et ce qui évite de croire que la révocation fonctionne alors
  // qu'elle ne fonctionne pas encore.
  function blocCleReponse(r) {
    const etat = !r.existe ? 'absente' : (!r.embarquee ? 'attente' : (r.correspond ? 'ok' : 'autre'));
    const badge = { absente: '<span class="badge émis">Pas encore créée</span>',
      attente: '<span class="badge émis">Créée — en attente d\'embarquement</span>',
      ok: '<span class="badge accepté">Réponses du serveur vérifiables</span>',
      autre: '<span class="badge annulée">L\'application embarque une AUTRE clé de réponse</span>' }[etat];
    const dit = {
      absente: 'Sans cette clé, le serveur ne peut pas prouver que ses réponses viennent bien de lui : l\'application les ignore toutes, et une licence révoquée continue de fonctionner. Créer la clé ici la garde sur cet ordinateur — elle ne doit jamais passer par ailleurs.',
      attente: 'La clé existe sur cet ordinateur. Il reste deux gestes : coller la <strong>privée</strong> dans le réglage <code>REPONSE_PRIVATE_KEY</code> du service, et la <strong>publique</strong> dans la version suivante de SkanFact. Tant que la publique n\'est pas publiée, aucune révocation ne mord.',
      ok: 'L\'application publiée embarque cette clé : une révocation prononcée depuis la console est appliquée chez le client à sa prochaine connexion.',
      autre: 'SkanFact embarque une autre clé de réponse que celle de cet ordinateur : les réponses signées ici seraient ignorées partout. Reprends la bonne clé privée, ou fais embarquer celle-ci dans la prochaine version.'
    }[etat];
    return `<p class="mt"><strong>Plan de contrôle — clé de réponse</strong> ${badge}</p>
      <p class="small">${dit}</p>
      ${r.base ? `<p class="small muted">Service : <code>${h(r.base)}</code></p>`
        : '<p class="small muted">Aucune adresse de plan de contrôle n\'est configurée dans cette version : l\'application ne parle à aucun serveur, et rien ne dépend de lui.</p>'}
      <div class="inline mt">
        ${r.existe
          ? `<button type="button" class="btn" id="ed-rep-priv">Copier la clé privée (pour le service)</button>
             <button type="button" class="btn" id="ed-rep-pub">Copier la clé publique (pour la version)</button>`
          : '<button type="button" class="btn btn-primary" id="ed-rep-creer">Créer la clé de réponse</button>'}
      </div>`;
  }
  function brancherCleReponse() {
    if ($('#ed-rep-creer')) $('#ed-rep-creer').onclick = async () => {
      // Le second argument de confirmDialog est le LIBELLÉ du bouton, pas un détail : y glisser un
      // paragraphe donnerait un bouton de trois lignes. Tout ce qui s'explique va dans le message.
      if (!await confirmDialog('Créer la clé de réponse du plan de contrôle ?\n\n'
        + 'Elle est écrite sur cet ordinateur, à côté de ta clé de signature. Tu colleras ensuite sa moitié privée dans les réglages du service, et sa moitié publique dans la version suivante de SkanFact.',
        'Créer la clé', false)) return;
      try { editeur = await bridge.cleReponseCreer(); drawEditeurPanel(); toast('Clé de réponse créée'); }
      catch (e) { toast(plainError(e), true); }
    };
    // La clé privée ne traverse pas le pont : main.js la met au presse-papiers, l'écran n'en reçoit
    // que la confirmation.
    if ($('#ed-rep-priv')) $('#ed-rep-priv').onclick = async () => {
      try { await bridge.cleReponseCopier('privee'); toast('Clé PRIVÉE copiée — colle-la dans le réglage REPONSE_PRIVATE_KEY du service, puis vide ton presse-papiers'); }
      catch (e) { toast(plainError(e), true); }
    };
    if ($('#ed-rep-pub')) $('#ed-rep-pub').onclick = async () => {
      try { await bridge.cleReponseCopier('publique'); toast('Clé publique copiée — colle-la dans la conversation qui prépare la prochaine version'); }
      catch (e) { toast(plainError(e), true); }
    };
  }

  // Émettre une licence — ou la renouveler (`prec` : la licence qu'on remplace). Un seul geste fait
  // les trois choses qui vont ensemble : la clé signée, le brouillon de facture dans les ventes, et
  // la ligne dans l'historique. Le prix vit dans le catalogue, jamais dans le code.
  async function licenceForm(prec, done) {
    if (!editeur || !editeur.actif) return toast('Crée d\'abord tes clés de signature : Paramètres → L\'application → Licence.', true);
    // Une clé signée depuis le jeu d'exemple sortirait vraiment, et sa facture disparaîtrait avec
    // l'exemple : même porte que les envois (7.6.0), on prévient.
    if (await demoBlock('Émettre une licence')) return;
    // Les durées partent d'aujourd'hui — ou de la FIN de la licence qu'on renouvelle si elle est
    // encore à venir : « À faire » réclame le renouvellement trente jours avant, et ces trente jours
    // sont payés. Elles se recalculent à chaque ouverture, jamais sur une copie prise au démarrage.
    const depuis = prec && prec.exp && prec.exp > C.today() ? prec.exp : '';
    try { const frais = await bridge.editeurStatus(depuis); if (frais && frais.actif) editeur = frais; } catch (_) {}
    const cur = company().currency;
    const dur = editeur.durees || [];
    const offres = Object.keys(editeur.offres || {});
    const l = {
      clientId: prec ? prec.clientId : '', offre: prec ? prec.offre : 'independant', duree: '1a', expDate: '',
      itemId: prec ? prec.itemId || '' : '', prix: prec ? prec.prix : '', tva: prec ? prec.tva : C.defaultVat(company()),
      // La remise de parrainage vaut pour la PREMIÈRE année : au renouvellement, l'empreinte reste
      // (elle est la preuve) et la remise repart à zéro — à remettre à la main si on l'accorde encore.
      // Sur une licence de CABINET, `cabinet` est le SUJET de la clé, pas un parrainage.
      parrain: !!(prec && prec.cabinet && prec.type !== 'cabinet'), empreinte: prec && prec.type !== 'cabinet' ? prec.cabinet || '' : '', remise: prec ? 0 : 20, note: '',
      // 9.4.1 — le TYPE se choisit à l'émission ; un renouvellement garde celui de la licence en
      // cours. Une licence de cabinet porte l'empreinte du cabinet et un quota de dossiers hors
      // SkanFact ; ni offre, ni parrainage.
      type: prec && prec.type === 'cabinet' ? 'cabinet' : 'entreprise',
      cabEmpreinte: prec && prec.type === 'cabinet' ? prec.cabinet || '' : '',
      dossiersHors: prec && prec.type === 'cabinet' ? prec.dossiersHors || '' : ''
    };
    const items = data.catalog.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr')).map(c => ({
      v: c.id, label: c.label, sub: c.description || '', right: C.money(c.unitPrice, cur) + ' HT', text: `${c.label} ${c.description || ''}`
    }));
    modal(`<h2>${prec ? 'Renouveler la licence' : 'Émettre une licence'}</h2>
      ${editeur.armee && !editeur.correspond ? '<p class="banner danger">SkanFact embarque une AUTRE clé publique que la tienne : cette licence ne serait reconnue nulle part. Reprends la bonne clé privée avant d\'émettre.</p>' : ''}
      ${prec ? `<p class="small muted">Nouvelle clé pour ${h(prec.nom)}${depuis ? ` : les durées partent du <strong>${C.fmtDate(depuis)}</strong>, fin de la licence actuelle — rien de ce qui est déjà payé n'est repris` : ''}. Une facture est créée, comme pour une première licence.</p>` : ''}
      <form id="lf" class="grid-2">
        <div class="field span-2 obligatoire">${lbl('Client', 'lic.client')}${combo({ name: 'clientId', value: l.clientId, items: clientItems(l.clientId), placeholder: '— Choisir un client —', search: 'Rechercher : nom, contact, MF…', add: '+ Nouveau client' })}</div>
        <label class="field span-2">${lbl('Type de licence', 'lic.type')}<select name="type" ${prec ? 'disabled' : ''}>
          <option value="entreprise" ${l.type === 'entreprise' ? 'selected' : ''}>Entreprise — s'installe dans SkanFact</option>
          <option value="cabinet" ${l.type === 'cabinet' ? 'selected' : ''}>Cabinet comptable — s'installe dans SkanFact Cabinet</option></select></label>
        <label class="field" id="lf-offre" ${l.type === 'cabinet' ? 'hidden' : ''}>${lbl('Offre', 'lic.offre')}<select name="offre">${offres.map(o => `<option value="${h(o)}" ${l.offre === o ? 'selected' : ''}>${h(editeur.offres[o].label)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Durée', 'lic.duree')}<select name="duree">${dur.map(d => `<option value="${h(d.id)}" ${l.duree === d.id ? 'selected' : ''}>${h(d.label)}${d.exp ? ` — jusqu'au ${C.fmtDate(d.exp)}` : ''}</option>`).join('')}</select></label>
        <div class="span-2" id="lf-date" hidden>${dateFieldHtml(lbl('Date de fin', 'lic.duree'), 'expDate', l.expDate)}</div>
        <div class="grid-2 span-2" id="lf-cab" ${l.type === 'cabinet' ? '' : 'hidden'}>
          <div class="field obligatoire">${lbl('Empreinte du cabinet', 'lic.empreinte')}
            <div class="inline">
              <input type="text" name="cabEmpreinte" value="${h(l.cabEmpreinte)}" placeholder="AB12-CD34-EF56-7890-ABCD" class="mono grow" autocapitalize="characters" spellcheck="false">
              <button type="button" class="btn" id="lf-verif-cab">Vérifier</button>
            </div>
            <p class="small" id="lf-verdict-cab" hidden></p>
          </div>
          <label class="field obligatoire">${lbl('Dossiers hors SkanFact couverts', 'lic.quota')}<input type="number" name="dossiersHors" class="num" min="1" max="5000" step="1" value="${h(l.dossiersHors)}" placeholder="en plus des 3 gratuits"></label>
        </div>
        <div class="field span-2">${lbl('Prestation du catalogue', 'lic.prestation')}${combo({ name: 'itemId', value: l.itemId, items, placeholder: '— Facultatif : la ligne de la facture —', search: 'Rechercher une prestation…', add: '+ Nouvelle prestation' })}</div>
        <label class="field obligatoire">${lbl(`Prix HT (${h(cur)})`, 'lic.prix')}<input type="number" name="prix" class="num" step="0.001" min="0" value="${h(l.prix)}"></label>
        <label class="field">${lbl('TVA', 'lic.tva')}<select name="tva">${C.VAT_RATES.map(r => `<option value="${r}" ${Number(l.tva) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></label>
        <label class="check span-2" id="lf-parrain-row" ${l.type === 'cabinet' ? 'hidden' : ''}><input type="checkbox" name="parrain" ${l.parrain ? 'checked' : ''}> ${lbl('Client parrainé par un cabinet comptable', 'lic.parrain')}</label>
        <div class="grid-2 span-2" id="lf-parrain" ${l.parrain && l.type !== 'cabinet' ? '' : 'hidden'}>
          <div class="field">${lbl('Empreinte du cabinet', 'lic.empreinte')}
            <div class="inline">
              <input type="text" name="empreinte" value="${h(l.empreinte)}" placeholder="AB12-CD34-EF56-7890-ABCD" class="mono grow" autocapitalize="characters" spellcheck="false">
              <button type="button" class="btn" id="lf-verif">Vérifier</button>
            </div>
            <p class="small" id="lf-verdict" hidden></p>
          </div>
          ${field(lbl('Remise sur la facture (%)', 'lic.remise'), 'remise', l.remise, 'number', 'min="0" max="100" class="num"')}
        </div>
        ${field(lbl('Note interne', 'lic.note'), 'note', l.note, 'text', 'placeholder="écrite dans la clé : rien de confidentiel"')}
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">${prec ? 'Renouveler et facturer' : 'Émettre et facturer'}</button></div>`,
      (root, close) => {
        const form = $('#lf', root);
        const cc = bindCombo($('[data-combo=clientId]', root), { items: clientItems(l.clientId), placeholder: '— Choisir un client —',
          onAdd: saisi => clientForm(null, c => { cc.setItems(clientItems(l.clientId)); cc.setValue(c.id); }, { name: saisi }) });
        // Le combo des clients propose « + Nouveau client » depuis toujours ; celui du catalogue, non
        // — alors que l'éditeur qui vend ses deux offres n'a, au premier jour, AUCUNE prestation de
        // licence dans son catalogue. Il retapait donc son prix à chaque émission, de mémoire, dans
        // un champ vide : une faute de frappe y devient une facture fausse, et rien ne la rattrape.
        // Une fois la prestation créée, le prix et la TVA viennent d'elle — c'est à ça qu'elle sert.
        const ic = bindCombo($('[data-combo=itemId]', root), { items, placeholder: '— Facultatif : la ligne de la facture —',
          add: '+ Nouvelle prestation',
          onAdd: saisi => catalogForm(saisi ? articleNeuf({ label: saisi }) : null, it => {
            if (!it) return;   // « Supprimer » depuis la fenêtre du catalogue rappelle done(null).
            const maj = data.catalog.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr')).map(c => ({
              v: c.id, label: c.label, sub: c.description || '', right: C.money(c.unitPrice, cur) + ' HT', text: `${c.label} ${c.description || ''}`
            }));
            ic.setItems(maj); ic.setValue(it.id);
            $('input[name=prix]', root).value = it.unitPrice; $('select[name=tva]', root).value = String(it.vatRate);
          }, { creation: true }),
          onPick: id => {
            const it = data.catalog.find(c => c.id === id); if (!it) return;
            $('input[name=prix]', root).value = it.unitPrice; $('select[name=tva]', root).value = String(it.vatRate);
          } });

        // « Vérifier » dit ce qu'il peut prouver, et seulement ça. La forme est vérifiable hors ligne ;
        // l'appartenance à un vrai cabinet ne l'est pas — il faudrait sa clé publique, que l'éditeur
        // n'a pas. Afficher un vert rassurant sur une empreinte simplement bien formée serait un
        // mensonge, et c'est justement le genre d'affirmation que cette application s'interdit.
        // Deux champs d'empreinte, une seule règle : celui du parrainage (une licence d'entreprise
        // amenée par un cabinet) et celui du SUJET (la licence du cabinet lui-même, 9.4.1).
        const verifierEmpreinteDe = (champ, pVerdict) => {
          const verdict = (texte, ton) => {
            const p = $(pVerdict, root); if (!p) return;
            p.hidden = false; p.textContent = texte;
            p.className = 'small ' + (ton === 'ok' ? 'ok-text' : ton === 'ko' ? 'err-text' : 'muted');
          };
          const e = C.empreinteCabinet($(champ, root).value);
          if (!e.ok) {
            return verdict(e.raison === 'vide' ? 'Colle l\'empreinte que le comptable lit dans SkanFact Cabinet → Réglages.'
              : e.raison === 'caracteres' ? 'Ce n\'est pas une empreinte : elle ne contient que des chiffres et les lettres A à F.'
              : `Il manque quelque chose : une empreinte fait 20 caractères (cinq groupes de quatre), celle-ci en a ${e.longueur}.`, 'ko');
          }
          // On range la forme canonique dans le champ : c'est elle qui sera enregistrée, donc deux
          // saisies du même cabinet ne peuvent pas donner deux empreintes différentes.
          $(champ, root).value = e.valeur;
          const vues = C.licencesDuCabinet(data.licences, e.valeur, prec && prec.id);
          if (!vues.length) {
            return verdict('Forme correcte. Ce cabinet n\'a encore parrainé personne : rien ici ne peut prouver qu\'il existe — fais relire l\'empreinte à voix haute par ton client.', 'neutre');
          }
          const noms = [...new Set(vues.map(v => v.nom).filter(Boolean))];
          verdict(`Forme correcte, et ce cabinet est déjà connu : ${pl(vues.length, 'licence')} parrainée${vues.length > 1 ? 's' : ''}${noms.length ? ' (' + noms.slice(0, 3).join(', ') + (noms.length > 3 ? '…' : '') + ')' : ''}.`, 'ok');
        };
        const verifierEmpreinte = () => verifierEmpreinteDe('#lf input[name=empreinte]', '#lf-verdict');
        const verifierEmpreinteCab = () => verifierEmpreinteDe('#lf input[name=cabEmpreinte]', '#lf-verdict-cab');
        const champE = () => $('#lf input[name=empreinte]', root);
        const champCab = () => $('#lf input[name=cabEmpreinte]', root);
        $('#lf-verif', root).onclick = verifierEmpreinte;
        champE().onblur = () => { if (champE().value.trim()) verifierEmpreinte(); };
        $('#lf-verif-cab', root).onclick = verifierEmpreinteCab;
        champCab().onblur = () => { if (champCab().value.trim()) verifierEmpreinteCab(); };
        const majDate = () => { $('#lf-date', root).hidden = $('select[name=duree]', root).value !== 'date'; };
        $('select[name=duree]', root).onchange = majDate; majDate();
        // Le type décide des champs : une licence de cabinet n'a ni offre ni parrainage, une licence
        // d'entreprise n'a ni empreinte-sujet ni quota. Rien de ce qui est masqué n'est envoyé.
        const majType = () => {
          const cab = $('select[name=type]', root).value === 'cabinet';
          $('#lf-offre', root).hidden = cab;
          $('#lf-cab', root).hidden = !cab;
          $('#lf-parrain-row', root).hidden = cab;
          $('#lf-parrain', root).hidden = cab || !$('input[name=parrain]', root).checked;
        };
        $('select[name=type]', root).onchange = majType;
        $('input[name=parrain]', root).onchange = e => { $('#lf-parrain', root).hidden = !e.target.checked; };
        $('#ok', root).onclick = async () => {
          const v = formValues(form);
          const client = clientById(v.clientId);
          if (!client) return refus('#lf [data-combo=clientId]', 'Choisis le client qui reçoit la licence.');
          if (v.duree === 'date' && !v.expDate) return refus('#lf-date .d-txt', 'Indique la date de fin.');
          // Le type : celui du formulaire à l'émission, celui de la licence en cours au renouvellement
          // (le sélecteur y est désactivé, et un champ désactivé ne remonte pas dans `formValues`).
          const type = prec ? l.type : (v.type === 'cabinet' ? 'cabinet' : 'entreprise');
          let empCab = null, quota = 0;
          if (type === 'cabinet') {
            empCab = C.empreinteCabinet(v.cabEmpreinte);
            if (!empCab.ok) return refus('#lf input[name=cabEmpreinte]', 'Colle l\'empreinte du cabinet : les vingt caractères qu\'il lit dans SkanFact Cabinet → Réglages → Mon cabinet.');
            quota = Math.round(Number(v.dossiersHors));
            if (!Number.isFinite(quota) || quota < 1 || quota > 5000) return refus('#lf input[name=dossiersHors]', 'Combien de dossiers hors SkanFact cette licence couvre-t-elle, en plus des trois gratuits ? (entre 1 et 5000)');
          }
          if (v.prix === '' || !(Number(v.prix) >= 0)) return refus('#lf input[name=prix]', 'Indique le prix HT de la licence (0 pour une licence offerte).');
          // La facture de licence est une facture : elle passe par le garde-fou de création comme
          // les autres — l'éditeur aussi a une licence (la sienne), et un essai qui se termine.
          if (licenceBlock('Créer une facture de licence')) return;
          const b = $('#ok', root); b.disabled = true;
          let r;
          try {
            r = await bridge.licenceEmettre({ nom: client.name, matricule: client.matricule || '', offre: v.offre, duree: v.duree, dateLibre: v.expDate,
              depuis, cabinet: type === 'cabinet' ? empCab.valeur : (v.parrain ? v.empreinte : ''), note: v.note,
              type, dossiersHors: quota });
          } catch (e) { b.disabled = false; return toast(plainError(e), true); }
          // La facture : un brouillon, comme « Facturer ce devis ». Pas de numéro avant l'émission.
          const it = v.itemId ? data.catalog.find(c => c.id === v.itemId) : null;
          const inv = newDocument('facture');
          applyClientDefaults(inv, client.id);
          // Le prix a été saisi dans la devise de la SOCIÉTÉ (le champ le dit) : la facture reste
          // dans cette devise, même pour un client réglé en euros — sinon 390 deviendrait 390 € sans
          // taux de change. La langue du client, elle, est gardée.
          inv.currency = company().currency; inv.exchangeRate = '';
          const fin = v.duree === 'date' ? 'jusqu\'au ' + C.fmtDate(r.exp) : dureeLabelDe(v.duree);
          const produit = type === 'cabinet' ? `SkanFact Cabinet — ${pl(quota, 'dossier')} hors SkanFact` : `SkanFact ${offreLabelDe(r.offre)}`;
          const label = it ? it.label : `Licence ${produit} — ${fin}`;
          inv.lines = [{ label, description: `Licence n° ${r.id}${r.exp ? ', valable jusqu\'au ' + C.fmtDate(r.exp) : ', sans limite de durée'}`,
            qty: 1, unit: (it && it.unit) || '', unitPrice: Number(v.prix), unitCost: (it && it.unitCost) || '', vatRate: C.tauxPourRegime(company(), Number(v.tva)), ...(it ? { itemId: it.id } : {}) }];
          Object.assign(inv, { clientId: client.id, subject: `Licence ${type === 'cabinet' ? 'SkanFact Cabinet' : 'SkanFact ' + offreLabelDe(r.offre)}`,
            discountRate: type !== 'cabinet' && v.parrain ? Math.min(100, Math.max(0, Number(v.remise) || 0)) : 0, withholdingRate: clientWithholding(client.id), licenceId: r.id });
          data.documents.push(inv);
          const lic = { id: r.id, clientId: client.id, nom: r.nom, matricule: r.matricule, offre: r.offre, exp: r.exp, key: r.key, emisLe: r.emisLe,
            cabinet: r.cabinet, note: r.note, invoiceId: inv.id, itemId: it ? it.id : '', prix: Number(v.prix), tva: Number(v.tva), emails: [],
            remplace: prec ? prec.id : '', type: r.type === 'cabinet' ? 'cabinet' : 'entreprise', dossiersHors: r.type === 'cabinet' ? Number(r.dossiersHors) || 0 : 0 };
          data.licences.push(lic);
          // La licence remplacée sort du compte des choses à faire ; elle reste lisible dans la liste.
          if (prec) { const p = data.licences.find(x => x.id === prec.id); if (p) p.remplaceePar = lic.id; }
          save(true); close();
          if (done) done(lic);
          // Le compteur de la barre latérale se rafraîchissait par EFFET DE BORD de la navigation
          // vers la facture. Sans elle, il restait sur son ancienne valeur — une licence émise à
          // l'instant n'était comptée nulle part jusqu'au prochain changement de page. C'est l'e2e
          // qui l'a vu (8.2.0) : un état lu une fois ne se met pas à jour tout seul (règle 7.1.x).
          redessinerBarre();
          // On finit le geste là où il se termine vraiment : sur la clé. Filer sur la facture
          // enterrait le produit que le client attend, et obligeait à revenir ici pour l'envoyer.
          montrerCle(lic, { neuve: true });
        };
      });
  }

  // Le mail au client : la clé, la marche à suivre, et la facture en PDF si elle est émise.
  async function envoyerLicence(lic) {
    if (await demoBlock('Envoyer un e-mail')) return;
    if (!await messagerie()) return;
    const client = clientById(lic.clientId);
    const inv = lic.invoiceId ? docById(lic.invoiceId) : null;
    const en = ((client && client.lang) || company().defaultLang) === 'en';
    const defs = en ? C.DEFAULT_EMAIL_TEMPLATES_EN : C.DEFAULT_EMAIL_TEMPLATES;
    const sur = en ? (company().emailTemplatesEn || {}) : (company().emailTemplates || {});
    // La clé d'un CABINET a son gabarit (9.4.1) : elle se colle dans SkanFact Cabinet, et le quota
    // remplace l'offre.
    const cab = lic.type === 'cabinet';
    const gabarit = cab ? 'licenceCabinet' : 'licence';
    const tpl = { ...defs[gabarit], ...(sur[gabarit] || {}) };
    const nDossiers = Number(lic.dossiersHors) || 0;
    const emise = !!(inv && inv.number);
    // « Votre facture N est jointe » n'est écrit que si la pièce part vraiment : une phrase qui
    // annonce une pièce absente est un bug, pas une formule.
    const phraseFacture = emise ? (en ? `Your invoice ${inv.number} is attached.\n\n` : `Votre facture ${inv.number} est jointe à ce message.\n\n`) : '';
    const vars = {
      cle: lic.key, offre: offreLabelDe(lic.offre),
      quota: en ? `${nDossiers} ${nDossiers === 1 ? 'file' : 'files'}` : pl(nDossiers, 'dossier'),
      fin: lic.exp ? (en ? ', valid until ' : ', valable jusqu\'au ') + C.fmtDate(lic.exp) : (en ? ', lifetime' : ', à vie'),
      client: client ? client.name : lic.nom, societe: company().name,
      numero: emise ? inv.number : (en ? '(draft)' : '(brouillon)'), facture: phraseFacture
    };
    modal(`<h2>Envoyer la clé de licence</h2>
      <form id="mf" class="grid-2">
        ${field(lbl('Destinataire', 'lic.envoiA'), 'to', (client && client.email) || '', 'email', 'placeholder="email@client.tn"')}
        <label class="check" style="align-self:end"><input type="checkbox" name="attach" ${emise ? 'checked' : 'disabled'}> Joindre la facture en PDF${inv && !emise ? ' (encore en brouillon)' : ''}</label>
        <label class="field span-2">${lbl('Objet', 'mail.objet')}<input type="text" name="subject" value="${h(C.fillTemplate(tpl.subject, vars))}"></label>
        <label class="field span-2">${lbl('Message', 'mail.message')}<textarea name="body" rows="10">${h(C.fillTemplate(tpl.body, vars))}</textarea></label>
      </form>
      <p class="small muted">${inv && !emise ? 'La facture est encore en brouillon : émets-la d\'abord pour pouvoir la joindre. ' : ''}Modèle du message : Paramètres → Envois.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Ouvrir dans la messagerie</button></div>`,
      (root, close) => {
        // Décocher la pièce jointe retire la phrase qui l'annonce (et la recocher la remet).
        const caseJointe = $('input[name=attach]', root);
        if (caseJointe && phraseFacture) caseJointe.onchange = e => {
          const ta = $('textarea[name=body]', root);
          if (!e.target.checked) ta.value = ta.value.replace(phraseFacture, '');
          else if (!ta.value.includes(phraseFacture)) ta.value = ta.value.replace(/(Merci de votre confiance|Thank you for your trust)/, phraseFacture + '$1');
        };
        $('#ok', root).onclick = async () => {
        const v = formValues($('#mf', root));
        if (!v.to || !/^[^@\s]+@[^@\s]+$/.test(v.to)) return refus('#mf input[name=to]', 'Adresse email invalide.');
        const b = $('#ok', root); b.disabled = true; b.textContent = 'Préparation…';
        try {
          let attachment = null;
          if (v.attach && inv) attachment = await bridge.exportPdfSilent(C.documentHtml(inv, client, company(), { stampText: stampFor(inv) }), docFileName(inv));
          const r = await bridge.composeMail({ to: v.to, subject: v.subject, body: v.body, attachment, mode: modeEnvoi() });
          if (client && !client.email) client.email = v.to;
          const stored = data.licences.find(x => x.id === lic.id) || lic;
          stored.emails = stored.emails || []; stored.emails.push({ date: C.today(), to: v.to, facture: !!attachment });
          // L'historique de la FACTURE ne note l'envoi que si elle est vraiment partie avec la clé.
          if (attachment && inv) { inv.emails = inv.emails || []; inv.emails.push({ date: C.today(), to: v.to, subject: v.subject, kind: 'licence' }); }
          save(true); close();
          toast(messageOuvert(r, attachment ? 'la facture' : null));
        } catch (e) { b.disabled = false; b.textContent = 'Ouvrir dans la messagerie'; toast(plainError(e), true); }
      }; });
  }

  // ---------- le cycle de vie d'une licence (8.2.0) ----------
  //
  // Jusqu'ici, « Émettre » signait la clé, fabriquait la facture et filait droit sur cette dernière :
  // la CLÉ — c'est-à-dire le produit que le client attend — n'était montrée nulle part, et il fallait
  // revenir à la page Licences pour l'envoyer. On finit le geste là où il se termine vraiment.
  function montrerCle(lic, opts) {
    opts = opts || {};
    const client = clientById(lic.clientId);
    const inv = lic.invoiceId ? docById(lic.invoiceId) : null;
    const suivi = C.licenceSuivi(lic, data, company());
    // Une clé de CABINET se colle dans SkanFact Cabinet, pas dans SkanFact — et son sujet est une
    // empreinte, pas un matricule (9.4.1).
    const cab = lic.type === 'cabinet';
    modal(`<h2>${opts.neuve ? 'Licence émise' : 'La clé de ' + h(lic.nom || '')}</h2>
      <p class="small">Voici ce que ${h(client ? client.name : 'le client')} doit coller dans <em>${cab ? 'SkanFact Cabinet → Réglages → Mon cabinet → Licence' : 'Paramètres → L\'application → Licence'}</em>.</p>
      <pre class="code-box mono" id="cle-txt">${h(lic.key || '')}</pre>
      <p class="small muted">${cab ? `Cabinet comptable · ${pl(Number(lic.dossiersHors) || 0, 'dossier')} hors SkanFact` : h(offreLabelDe(lic.offre))}${lic.exp ? ' · jusqu\'au ' + C.fmtDate(lic.exp) : ' · sans limite de durée'}${cab ? ' · empreinte ' + h(lic.cabinet || '') : lic.matricule ? ' · matricule ' + h(lic.matricule) : ' · sans matricule (s\'active partout)'}</p>
      ${suivi.envoyee ? `<p class="small ok-text">Déjà envoyée le ${C.fmtDate(suivi.envoyeeLe)}${suivi.envois > 1 ? ' (' + pl(suivi.envois, 'envoi') + ')' : ''}.</p>` : ''}
      ${inv && !inv.number ? '<p class="small warn-text">La facture est un <strong>brouillon</strong> : relis-la puis émets-la, sinon cette vente n\'entre ni dans ton journal ni dans ta TVA.</p>' : ''}
      <div class="modal-actions">
        <button class="btn" data-close>Fermer</button>
        ${inv ? '<button class="btn" id="cle-fact">Ouvrir la facture</button>' : ''}
        <button class="btn" id="cle-copier">Copier la clé</button>
        <button class="btn btn-primary" id="cle-mail">Envoyer par email</button></div>`,
      (root, close) => {
        $('#cle-copier', root).onclick = () => copierTexte(lic.key, 'Clé de licence copiée');
        $('#cle-mail', root).onclick = () => { close(); envoyerLicence(lic); };
        if ($('#cle-fact', root)) $('#cle-fact', root).onclick = () => { close(); navigate('#/doc/' + inv.id); };
      });
  }

  // Changer d'offre en cours de route. L'offre voyage DANS la charge signée : on ne peut pas la
  // changer sans re-signer, donc une clé neuve part forcément. Mais commercialement ce n'est pas un
  // achat : la date de fin ne bouge pas, et on ne facture que la DIFFÉRENCE au prorata des jours qui
  // restent. Refaire payer une année pleine au sixième mois est le meilleur moyen de faire refuser
  // la montée en gamme.
  // 9.4.1 — le QUOTA d'un cabinet se change comme une offre : la date de fin ne bouge pas, et seule
  // la différence de prix est facturée, au prorata des jours restants. Le quota est dans la clé
  // signée, donc une clé neuve part ; l'ancienne marche jusqu'à ce que le cabinet colle la nouvelle.
  async function changerQuotaForm(lic, done) {
    if (await demoBlock('Changer le quota d\'une licence')) return;
    if (lic.exp && C.daysBetween(C.today(), lic.exp) < 0) {
      return modal(`<h2>Cette licence est expirée</h2>
        <p>On ne change pas le quota d'une licence terminée : il n'y a plus de jours à reporter, et la clé qu'on signerait serait déjà périmée. C'est un <strong>renouvellement</strong> qu'il faut, avec le quota voulu.</p>
        <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn btn-primary" id="cq-ren">Renouveler</button></div>`,
        (root, close) => { $('#cq-ren', root).onclick = () => { close(); licenceForm(lic, done); }; });
    }
    const cur = company().currency;
    const actuel = Math.max(0, Math.round(Number(lic.dossiersHors) || 0));
    const majPrix = () => {
      const pr = C.prorataOffre(lic, Number($('#cq-prix').value) || 0, Number(lic.prix) || 0);
      const el = $('#cq-calc'); if (!el) return;
      el.innerHTML = pr.jours == null
        ? `Licence <strong>à vie</strong> : pas de prorata possible, la différence se facture en entier — <strong>${h(C.money(pr.montant, cur))} HT</strong>.`
        : `Il reste <strong>${pl(pr.jours, 'jour')}</strong> sur ${pl(pr.total, 'jour')}. Différence au prorata : <strong>${h(C.money(pr.montant, cur))} HT</strong>.`;
    };
    modal(`<h2>Changer le quota</h2>
      <p class="small">${h(lic.nom)} couvre <strong>${pl(actuel, 'dossier')}</strong> hors SkanFact${lic.exp ? ` jusqu'au <strong>${C.fmtDate(lic.exp)}</strong>` : ' sans limite de durée'}, en plus des trois gratuits. La date de fin ne change pas : seule la différence de prix est facturée.</p>
      <form id="cqf" class="grid-2">
        <label class="field obligatoire">${lbl('Nouveau quota', 'lic.chgquota')}<input type="number" id="cq-quota" name="dossiersHors" class="num" min="1" max="5000" step="1" value="${actuel}"></label>
        <label class="field obligatoire">${lbl(`Prix plein du nouveau quota (${h(cur)} HT)`, 'lic.prixPlein')}<input type="number" id="cq-prix" name="prix" class="num" step="0.001" min="0" placeholder="pour un an"></label>
      </form>
      <div class="notes-md mt"><p class="small" id="cq-calc">Indique le prix plein du nouveau quota pour voir la différence.</p>
      <p class="small muted">Prix payé pour le quota actuel : ${h(C.money(Number(lic.prix) || 0, cur))} HT.</p></div>
      <p class="small muted">Une clé neuve sera signée — le quota est inscrit dedans, il ne peut pas se modifier à distance. Envoie-la au cabinet : l'ancienne continue de fonctionner jusqu'à ce qu'il colle la nouvelle.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Changer et facturer la différence</button></div>`,
      (root, close) => {
        $('#cq-prix', root).oninput = majPrix;
        $('#ok', root).onclick = async () => {
          const v = formValues($('#cqf', root));
          const q = Math.round(Number(v.dossiersHors));
          if (!Number.isFinite(q) || q < 1 || q > 5000) return refus('#cq-quota', 'Indique le nouveau nombre de dossiers hors SkanFact (entre 1 et 5000).');
          if (q === actuel) return refus('#cq-quota', `Cette licence couvre déjà ${pl(q, 'dossier')} : il n'y a rien à changer.`);
          if (v.prix === '' || !(Number(v.prix) >= 0)) return refus('#cq-prix', 'Indique le prix plein du nouveau quota.');
          const pr = C.prorataOffre(lic, Number(v.prix), Number(lic.prix) || 0);
          if (licenceBlock('Créer une facture de licence')) return;
          const b = $('#ok', root); b.disabled = true;
          let r;
          try {
            r = await bridge.licenceEmettre({ nom: lic.nom, matricule: lic.matricule || '', type: 'cabinet', dossiersHors: q,
              exp: lic.exp || '', cabinet: lic.cabinet || '', note: lic.note || '' });
          } catch (e) { b.disabled = false; return toast(plainError(e), true); }
          const inv = newDocument('facture');
          applyClientDefaults(inv, lic.clientId);
          inv.currency = company().currency; inv.exchangeRate = '';
          inv.lines = [{ label: `Passage à ${pl(q, 'dossier')} hors SkanFact`,
            description: `Différence depuis ${pl(actuel, 'dossier')}${pr.jours == null ? '' : `, au prorata des ${pl(pr.jours, 'jour')} restants`}${lic.exp ? ' jusqu\'au ' + C.fmtDate(lic.exp) : ''}`,
            qty: 1, unit: '', unitPrice: pr.montant, unitCost: '', vatRate: C.tauxPourRegime(company(), Number(lic.tva) || C.defaultVat(company())) }];
          Object.assign(inv, { clientId: lic.clientId, subject: `Changement de quota SkanFact Cabinet — ${pl(q, 'dossier')}`,
            discountRate: 0, withholdingRate: clientWithholding(lic.clientId), licenceId: r.id });
          data.documents.push(inv);
          const neuve = { id: r.id, clientId: lic.clientId, nom: r.nom, matricule: r.matricule, offre: r.offre, exp: r.exp,
            key: r.key, emisLe: r.emisLe, cabinet: r.cabinet, note: r.note, invoiceId: inv.id, itemId: '',
            prix: Number(v.prix), tva: Number(lic.tva) || C.defaultVat(company()), emails: [], remplace: lic.id, type: 'cabinet', dossiersHors: q };
          data.licences.push(neuve);
          const anc = data.licences.find(x => x.id === lic.id);
          if (anc) { anc.remplaceePar = neuve.id; anc.motif = 'offre'; }
          save(true); close(); redessinerBarre();
          if (done) done(neuve);
          montrerCle(neuve, { neuve: true });
        };
      });
  }

  async function changerOffreForm(lic, done) {
    if (lic.type === 'cabinet') return changerQuotaForm(lic, done);
    if (await demoBlock('Changer l\'offre d\'une licence')) return;
    if (lic.exp && C.daysBetween(C.today(), lic.exp) < 0) {
      return modal(`<h2>Cette licence est expirée</h2>
        <p>On ne change pas l'offre d'une licence terminée : il n'y a plus de jours à reporter, et la clé qu'on signerait serait déjà périmée. C'est un <strong>renouvellement</strong> qu'il faut, dans l'offre voulue.</p>
        <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn btn-primary" id="co-ren">Renouveler</button></div>`,
        (root, close) => { $('#co-ren', root).onclick = () => { close(); licenceForm(lic, done); }; });
    }
    const offres = Object.keys(editeur.offres || {}).filter(o => o !== lic.offre);
    if (!offres.length) return toast('Il n\'existe pas d\'autre offre.', true);
    const cur = company().currency;
    const majPrix = () => {
      const pr = C.prorataOffre(lic, Number($('#co-prix').value) || 0, Number(lic.prix) || 0);
      const el = $('#co-calc'); if (!el) return;
      el.innerHTML = pr.jours == null
        ? `Licence <strong>à vie</strong> : pas de prorata possible, la différence se facture en entier — <strong>${h(C.money(pr.montant, cur))} HT</strong>.`
        : `Il reste <strong>${pl(pr.jours, 'jour')}</strong> sur ${pl(pr.total, 'jour')}. Différence au prorata : <strong>${h(C.money(pr.montant, cur))} HT</strong>.`;
    };
    modal(`<h2>Changer l'offre</h2>
      <p class="small">${h(lic.nom)} est en <strong>${h(offreLabelDe(lic.offre))}</strong>${lic.exp ? ` jusqu'au <strong>${C.fmtDate(lic.exp)}</strong>` : ' sans limite de durée'}. La date de fin ne change pas : seule la différence de prix est facturée.</p>
      <form id="cof" class="grid-2">
        <label class="field">${lbl('Nouvelle offre', 'lic.chgoffre')}<select name="offre">${offres.map(o => `<option value="${h(o)}">${h(editeur.offres[o].label)}</option>`).join('')}</select></label>
        <label class="field obligatoire">${lbl(`Prix plein de la nouvelle offre (${h(cur)} HT)`, 'lic.prixPlein')}<input type="number" id="co-prix" name="prix" class="num" step="0.001" min="0" placeholder="690"></label>
      </form>
      <div class="notes-md mt"><p class="small" id="co-calc">Indique le prix plein de la nouvelle offre pour voir la différence.</p>
      <p class="small muted">Prix payé pour l'offre actuelle : ${h(C.money(Number(lic.prix) || 0, cur))} HT.</p></div>
      <p class="small muted">Une clé neuve sera signée — l'offre est inscrite dedans, elle ne peut pas se modifier à distance. Envoie-la au client : l'ancienne continue de fonctionner jusqu'à ce qu'il colle la nouvelle.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Changer et facturer la différence</button></div>`,
      (root, close) => {
        $('#co-prix', root).oninput = majPrix;
        $('#ok', root).onclick = async () => {
          const v = formValues($('#cof', root));
          if (v.prix === '' || !(Number(v.prix) >= 0)) return refus('#co-prix', 'Indique le prix plein de la nouvelle offre.');
          const pr = C.prorataOffre(lic, Number(v.prix), Number(lic.prix) || 0);
          if (licenceBlock('Créer une facture de licence')) return;
          const b = $('#ok', root); b.disabled = true;
          let r;
          try {
            r = await bridge.licenceEmettre({ nom: lic.nom, matricule: lic.matricule || '', offre: v.offre,
              exp: lic.exp || '', cabinet: lic.cabinet || '', note: lic.note || '' });
          } catch (e) { b.disabled = false; return toast(plainError(e), true); }
          const inv = newDocument('facture');
          applyClientDefaults(inv, lic.clientId);
          inv.currency = company().currency; inv.exchangeRate = '';
          inv.lines = [{ label: `Passage à l'offre ${offreLabelDe(r.offre)}`,
            description: `Différence depuis ${offreLabelDe(lic.offre)}${pr.jours == null ? '' : `, au prorata des ${pl(pr.jours, 'jour')} restants`}${lic.exp ? ' jusqu\'au ' + C.fmtDate(lic.exp) : ''}`,
            qty: 1, unit: '', unitPrice: pr.montant, unitCost: '', vatRate: C.tauxPourRegime(company(), Number(lic.tva) || C.defaultVat(company())) }];
          Object.assign(inv, { clientId: lic.clientId, subject: `Changement d'offre SkanFact — ${offreLabelDe(r.offre)}`,
            discountRate: 0, withholdingRate: clientWithholding(lic.clientId), licenceId: r.id });
          data.documents.push(inv);
          const neuve = { id: r.id, clientId: lic.clientId, nom: r.nom, matricule: r.matricule, offre: r.offre, exp: r.exp,
            key: r.key, emisLe: r.emisLe, cabinet: r.cabinet, note: r.note, invoiceId: inv.id, itemId: '',
            prix: Number(v.prix), tva: Number(lic.tva) || C.defaultVat(company()), emails: [], remplace: lic.id };
          data.licences.push(neuve);
          const anc = data.licences.find(x => x.id === lic.id);
          if (anc) { anc.remplaceePar = neuve.id; anc.motif = 'offre'; }
          save(true); close(); redessinerBarre();
          if (done) done(neuve);
          montrerCle(neuve, { neuve: true });
        };
      });
  }

  // Réémettre la MÊME licence pour un matricule corrigé. Le matricule voyage dans la charge signée :
  // le client qui corrige sa fiche société voit sa clé refusée du jour au lendemain, et c'est LUI qui
  // a bien fait. Aucune facture n'est créée — il a déjà payé cette licence-là.
  async function corrigerMatriculeForm(lic, done) {
    if (await demoBlock('Réémettre une licence')) return;
    if (lic.exp && C.daysBetween(C.today(), lic.exp) < 0) return toast('Cette licence est expirée : c\'est un renouvellement qu\'il faut.', true);
    modal(`<h2>Corriger le matricule</h2>
      <p class="small">La clé de ${h(lic.nom)} porte le matricule <strong>${h(lic.matricule || '(aucun)')}</strong>. S'il a été mal saisi — ou si le client vient de renseigner sa fiche — sa clé est refusée sur son poste. On en signe une neuve, <strong>sans rien refacturer</strong> : même offre, même date de fin.</p>
      <form id="cmf">
        <label class="field">${lbl('Matricule fiscal exact', 'lic.matriculeCle')}<input type="text" name="matricule" value="${h(lic.matricule || '')}" placeholder="1234567A/M/P/000" class="mono"></label>
        <p class="small muted">Laisse vide pour une clé sans matricule : elle s'active dans n'importe quelle société. Pratique en dépannage, à éviter pour un client payant — il pourrait la partager.</p>
      </form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Signer la clé corrigée</button></div>`,
      (root, close) => {
        $('#ok', root).onclick = async () => {
          const v = formValues($('#cmf', root));
          if (String(v.matricule || '').trim() === String(lic.matricule || '').trim()) return refus('#cmf input[name=matricule]', 'Ce matricule est déjà celui de la clé : il n\'y a rien à corriger.');
          const b = $('#ok', root); b.disabled = true;
          let r;
          try {
            r = await bridge.licenceEmettre({ nom: lic.nom, matricule: v.matricule, offre: lic.offre,
              exp: lic.exp || '', cabinet: lic.cabinet || '', note: lic.note || '' });
          } catch (e) { b.disabled = false; return toast(plainError(e), true); }
          // La facture reste attachée à la licence d'ORIGINE : c'est elle qui a été vendue, et la
          // nouvelle clé n'est pas une seconde vente. Sans ça, « À faire » réclamerait une facture
          // qui n'a aucune raison d'exister.
          const neuve = { id: r.id, clientId: lic.clientId, nom: r.nom, matricule: r.matricule, offre: r.offre, exp: r.exp,
            key: r.key, emisLe: r.emisLe, cabinet: r.cabinet, note: r.note, invoiceId: lic.invoiceId || '', itemId: lic.itemId || '',
            prix: Number(lic.prix) || 0, tva: Number(lic.tva) || 0, emails: [], remplace: lic.id, sansFacture: true };
          data.licences.push(neuve);
          const anc = data.licences.find(x => x.id === lic.id);
          if (anc) { anc.remplaceePar = neuve.id; anc.motif = 'matricule'; }
          save(true); close(); redessinerBarre();
          if (done) done(neuve);
          montrerCle(neuve, { neuve: true });
        };
      });
  }

  // Révoquer. Ce que ce geste fait, et surtout ce qu'il NE FAIT PAS : la licence est hors ligne,
  // vérifiée sur le poste du client contre la clé publique embarquée, sans aucun réseau. Rien ne
  // peut faire cesser de fonctionner une clé déjà envoyée — c'est le prix de la promesse inverse,
  // celle qui fait la valeur du produit (le client travaille sans connexion, et l'application lui
  // survit même si son éditeur disparaît). Un bouton qui prétendrait couper serait un mensonge, et
  // c'est exactement le genre d'affirmation que cette application s'interdit.
  async function revoquerForm(lic, done) {
    if (await demoBlock('Révoquer une licence')) return;
    const inv = lic.invoiceId ? docById(lic.invoiceId) : null;
    const emise = !!(inv && inv.number);
    modal(`<h2>Révoquer la licence de ${h(lic.nom)}</h2>
      <p class="small">À faire quand le client se rétracte ou qu'on le rembourse. Ce qui se passe :</p>
      <div class="notes-md">
        <p class="small"><strong>Dans tes livres</strong> — la licence sort des actives, ne réclame plus de renouvellement, et l'historique garde le motif et la date.</p>
        <p class="small"><strong>En comptabilité</strong> — ${emise ? `la facture <strong>${h(inv.number)}</strong> est émise : elle se corrige par un <strong>avoir</strong>, jamais par une suppression. Le bouton ci-dessous l'ouvre.` : inv ? 'la facture est encore un <strong>brouillon</strong> : tu peux simplement la supprimer, rien n\'est parti nulle part.' : 'aucune facture n\'est rattachée.'}</p>
        <p class="small warn-text"><strong>Chez le client, la clé continue de fonctionner</strong> jusqu'au ${lic.exp ? C.fmtDate(lic.exp) : '… (elle est à vie)'}. SkanFact vérifie les licences <em>hors ligne</em> : il n'existe aucun serveur qui puisse la désactiver à distance. Demande-lui de la retirer dans Paramètres → L'application → Licence.</p>
      </div>
      <form id="rvf"><label class="field obligatoire">${lbl('Motif', 'lic.motifRevocation')}<input type="text" name="motif" placeholder="Ex. : rétractation sous 14 jours, remboursé le 20/09."></label></form>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Révoquer</button></div>`,
      (root, close) => {
        $('#ok', root).onclick = () => {
          const v = formValues($('#rvf', root));
          if (!String(v.motif || '').trim()) return refus('#rvf input[name=motif]', 'Dis pourquoi : c\'est la seule trace qui expliquera ce chiffre dans six mois.');
          const stored = data.licences.find(x => x.id === lic.id) || lic;
          stored.revoqueeLe = C.today(); stored.revoqueeMotif = String(v.motif).trim();
          save(true); close(); redessinerBarre();
          if (done) done(stored);
          if (emise) {
            modal(`<h2>Et la facture ?</h2>
              <p>La facture <strong>${h(inv.number)}</strong> est émise : la rembourser se fait par un avoir, qui reprend ses lignes et son client.</p>
              <div class="modal-actions"><button class="btn" data-close>Plus tard</button><button class="btn btn-primary" id="rv-av">Créer l'avoir</button></div>`,
              (r2, c2) => { $('#rv-av', r2).onclick = () => { c2(); navigate('#/doc/new/avoir/' + inv.id); }; });
          } else {
            toast('Licence révoquée');
          }
        };
      });
  }

  const licState = { q: '', st: '', sort: null, tri: '', page: 1 };
  routes.licences = () => {
    const s = licState;
    // Émettre et renouveler demandent la clé privée ; LIRE l'historique, non. Un dossier restauré ou
    // partagé sur un poste sans clé montre ses licences (copier la clé, renvoyer le mail, ouvrir la
    // facture) au lieu d'affirmer qu'il n'y a rien.
    const peut = !!licence.editeur;
    if (!peut && !(data.licences || []).length) {
      $('#view').innerHTML = `<div class="page-head"><h1>Licences</h1></div>
        ${etatVide('Cette page est celle de l\'éditeur de SkanFact', ['Elle liste les licences qu\'il a émises. Sur cet ordinateur, aucune clé de signature n\'est installée et ce dossier n\'en a émis aucune : il n\'y a rien à montrer ici. Ta propre licence, elle, se lit dans les Paramètres.'], [['lic-param', 'Voir ma licence', true]])}`;
      $('#lic-param').onclick = () => allerParametres('app', 'p-licence');
      return;
    }
    const cols = [
      { key: 'nom', label: 'Client', asc: true, val: r => (r.nom || '').toLowerCase(),
        get: r => `<strong>${h(r.nom)}</strong>${r.matricule ? `<div class="small muted">MF ${h(r.matricule)}</div>` : ''}` },
      { key: 'offre', label: 'Offre', asc: true, val: r => r.offre,
        get: r => r.type === 'cabinet' ? `Cabinet comptable<div class="small muted">${pl(Number(r.dossiersHors) || 0, 'dossier')} hors SkanFact</div>` : h(offreLabelDe(r.offre)) },
      { key: 'exp', label: 'Fin', val: r => r.exp || '9999', get: r => r.exp ? C.fmtDate(r.exp) : '<span class="muted">À vie</span>' },
      { key: 'etat', label: 'État', val: r => ({ bientot: 0, expiree: 1, active: 2, vie: 3, revoquee: 4 })[r.etat],
        get: r => `<span class="badge ${r.renouvelee ? '' : r.etat === 'bientot' ? 'retard' : r.etat === 'expiree' || r.etat === 'revoquee' ? 'annulée' : 'accepté'}">${h(r.renouvelee ? r.motifLabel : r.etatLabel)}</span>${r.etat === 'bientot' && !r.renouvelee ? `<div class="small muted">dans ${pl(r.jours, 'jour')}</div>` : ''}${r.revoqueeLe ? `<div class="small muted">le ${C.fmtDate(r.revoqueeLe)}${r.revoqueeMotif ? ' — ' + h(r.revoqueeMotif) : ''}</div>` : ''}` },
      { key: 'facture', label: 'Facture', val: r => { const d = r.invoiceId && docById(r.invoiceId); return d ? (d.number || 'brouillon') : ''; },
        get: r => { const d = r.invoiceId && docById(r.invoiceId); return d ? `<a href="#/doc/${h(d.id)}">${h(d.number || 'Brouillon')}</a>${d.status !== 'brouillon' ? ` <span class="badge ${h(effStatus(d))}">${h(effStatus(d))}</span>` : ''}` : '<span class="muted">—</span>'; } },
      { key: 'envoyee', label: 'Clé envoyée', val: r => r.envoyee ? (r.envoyeeLe || '1') : '',
        get: r => r.envoyee ? `<span class="ok-text">${C.fmtDate(r.envoyeeLe)}</span>`
          : r.revoqueeLe || r.remplaceePar ? '<span class="muted">—</span>'
          : '<span class="warn-text">jamais</span>' },
      { key: 'emise', label: 'Émise le', val: r => r.emisLe || '', get: r => r.emisLe ? C.fmtDate(r.emisLe) : '—' }
    ];
    const FILTRES = [['', 'Toutes'], ['bientot', 'À renouveler'], ['active', 'Actives'], ['vie', 'À vie'], ['expiree', 'Expirées'], ['revoquee', 'Révoquées']];
    const draw = dansUnLot((sortKey) => {
      if (typeof sortKey === 'string' && sortKey) { s.sort = toggleSort(s.sort, sortKey, cols); s.page = 1; }
      const all = C.licenceRows(data, C.today(), company());
      const kept = applySort(all
        .filter(r => !s.q || C.correspondRecherche([r.nom, r.matricule, r.id, offreLabelDe(r.offre), r.note].join(' '), s.q))
        .filter(r => !s.st || r.etat === s.st)
        .filter(r => !s.tri || (s.tri === 'envoi' ? (!r.envoyee && !r.revoqueeLe && !r.remplaceePar)
          : s.tri === 'facture' ? (!r.facturee && !r.revoqueeLe && !r.remplaceePar)
          : s.tri === 'impaye' ? (r.facturee && !r.payee && !r.revoqueeLe && !r.remplaceePar) : true)), cols, s.sort);
      const filtered = !!(s.q || s.st || s.tri);
      const { rows: page, pg } = paginate(kept, s);
      const aRenouveler = kept.filter(r => r.etat === 'bientot' && !r.renouvelee).length;
      $('#lic-wrap').innerHTML = kept.length ? `<table class="list sortable"><thead>${sortHead(cols, s.sort, '<th class="row-actions-h"></th>')}</thead><tbody>
          ${page.map(r => `<tr>${cols.map(c => `<td class="${c.r ? 'r nw' : ''}${c.cls ? ' ' + c.cls : ''}">${c.get(r)}</td>`).join('')}${rowMenuCell(r.id)}</tr>`).join('')}
        </tbody><tfoot><tr><td colspan="7">${pl(kept.length, 'licence')}${filtered ? ` sur ${all.length}` : ''}${aRenouveler ? ` · ${aRenouveler} à renouveler` : ''}</td><td></td></tr></tfoot></table>${pagerBar(pg, { noun: 'licence', grandTotal: all.length })}`
        : (filtered ? '<div class="empty">Aucune licence ne correspond.</div>'
          : etatVide('Aucune licence émise', ['Chaque licence que tu vends passe par ici : la clé est signée avec ta clé privée, la facture est créée dans tes ventes, et le mail au client est prêt.'], peut ? [['lic-first', '+ Émettre ma première licence', true]] : []));
      const note = $('#lic-note');
      if (note) { note.hidden = !filtered; note.innerHTML = filtered ? `<span class="small muted">${kept.length} sur ${all.length}</span>${filterReset(true)}` : ''; }
      if ($('#reset-f')) $('#reset-f').onclick = () => { s.q = ''; s.st = ''; s.tri = ''; s.page = 1; render(true); };
      if ($('#lic-first')) $('#lic-first').onclick = () => licenceForm(null, draw);
      // Seul `#lic-wrap` se redessine : l'en-tête suit l'état vide ici (U-11, comme les contrats).
      const nouvelle = $('#lic-new');
      if (nouvelle) nouvelle.classList.toggle('btn-primary', !!(kept.length || filtered));
      bindRowMenus($('#lic-wrap'), id => {
        const r = data.licences.find(x => x.id === id); if (!r) return [];
        const inv = r.invoiceId ? docById(r.invoiceId) : null;
        const suite = r.remplaceePar ? data.licences.find(x => x.id === r.remplaceePar) : null;
        const revoquee = !!r.revoqueeLe;
        // Une licence vendue par la console se lit et s'envoie ici ; renouveler, changer l'offre,
        // corriger, révoquer se font DANS la console, qui l'a signée (8.7.0). Offrir ces gestes ici
        // fabriquerait une seconde clé que la console ne connaîtrait pas.
        const console_ = r.origine === 'console';
        if (console_) return [
          { icon: 'contrat', label: 'Voir la clé', hint: 'Vendue par la console — renouvellement et révocation s\'y font aussi', run: () => montrerCle(r) },
          { icon: 'copier', label: 'Copier la clé', hint: 'Dans le presse-papiers, pour la coller où tu veux', run: () => copierTexte(r.key, 'Clé de licence copiée') },
          inv ? { icon: 'facture', label: 'Ouvrir la facture', hint: inv.number || 'Encore en brouillon', run: () => navigate('#/doc/' + inv.id) } : null
        ];
        return [
          { icon: 'contrat', label: 'Voir la clé', hint: 'La clé, son offre, sa date de fin — et de quoi l\'envoyer', run: () => montrerCle(r) },
          { icon: 'copier', label: 'Copier la clé', hint: 'Dans le presse-papiers, pour la coller où tu veux', run: () => copierTexte(r.key, 'Clé de licence copiée') },
          { icon: 'email', label: 'Envoyer la clé par email', hint: inv && inv.number ? `Avec la facture ${inv.number} en PDF` : 'La clé et la marche à suivre', run: () => envoyerLicence(r) },
          inv ? { icon: 'facture', label: 'Ouvrir la facture', hint: inv.number || 'Encore en brouillon', run: () => navigate('#/doc/' + inv.id) } : null,
          // Une licence déjà renouvelée ne se renouvelle pas une seconde fois : c'est sa remplaçante
          // qui porte la suite — sinon on fabriquerait une troisième clé et une troisième facture.
          peut ? { sep: true } : null,
          peut && !r.remplaceePar && !revoquee ? { icon: 'contrat', label: 'Renouveler', hint: 'Une nouvelle clé et une nouvelle facture', run: () => licenceForm(r, draw) } : null,
          peut && suite ? { icon: 'contrat', label: 'Renouveler la suivante', hint: `Cette licence a déjà été remplacée (n° ${suite.id})`, run: () => licenceForm(suite, draw) } : null,
          // Une licence de CABINET (9.4.1) n'a ni offre ni matricule : c'est son quota qui se change,
          // et son sujet est une empreinte.
          peut && !r.remplaceePar && !revoquee ? { icon: 'contrat', label: r.type === 'cabinet' ? 'Changer le quota' : 'Changer l\'offre', hint: 'Même date de fin, on ne facture que la différence au prorata', run: () => changerOffreForm(r, draw) } : null,
          peut && !r.remplaceePar && !revoquee && r.type !== 'cabinet' ? { icon: 'client', label: 'Corriger le matricule', hint: 'Une clé neuve pour le bon matricule, sans refacturer', run: () => corrigerMatriculeForm(r, draw) } : null,
          peut && !revoquee ? { sep: true } : null,
          peut && !revoquee ? { icon: 'supprimer', label: 'Révoquer la licence', hint: 'Rétractation ou remboursement — la clé, elle, vit jusqu\'à sa date de fin', run: () => revoquerForm(r, draw) } : null
        ];
      });
      bindSort($('#lic-wrap'), draw);
      bindPager($('#lic-wrap'), s, () => draw(), '#lic-wrap');
    });
    const all = data.licences || [];
    $('#view').innerHTML = `<div class="page-head"><h1>Licences ${info('lic.liste')}</h1><div class="actions">${peut ? '<button class="btn btn-primary" id="lic-new">+ Émettre une licence</button>' : ''}</div></div>
      ${peut ? '' : '<div class="banner info"><span>Historique en lecture : les clés de signature ne sont pas sur cet ordinateur. Copier une clé, la renvoyer ou ouvrir sa facture reste possible ; émettre et renouveler, non.</span></div>'}
      ${filtersBar(`<input type="text" id="q" placeholder="Rechercher : client, matricule, n°…" value="${h(s.q)}">
        <select id="st">${FILTRES.map(([v, l]) => `<option value="${v}" ${s.st === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${info('list.sort')}<span class="f-note" id="lic-note" hidden></span>`, all.length, !!(s.q || s.st))}
      <div class="panel" id="lic-console" hidden></div>
      <div id="lic-wrap"></div>`;
    if ($('#lic-new')) $('#lic-new').onclick = () => licenceForm(null, draw);
    if (peut && pont.configure) drawVentesConsole();
    if ($('#q')) $('#q').oninput = e => { s.q = e.target.value.toLowerCase(); s.page = 1; draw(); };
    if ($('#st')) $('#st').onchange = e => { s.st = e.target.value; s.page = 1; draw(); };
    draw();
  };

  // Quand une vérification a eu lieu, écrit comme on le dirait. Une date seule (« 14/09/2026
  // 09:12 ») oblige à la comparer mentalement à aujourd'hui ; ce qu'on veut savoir, c'est si c'est
  // récent. Des JOURS DE CALENDRIER au-delà d'une heure, pas des tranches de 24 h (règle Cabinet).
  function quandVerif(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = x => String(x).padStart(2, '0');
    const heure = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const mn = Math.floor((Date.now() - ms) / 60000);
    if (mn < 1) return 'à l\'instant';
    if (mn < 60) return `il y a ${pl(mn, 'minute')}`;
    const jour = x => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    const j = Math.round((jour(new Date()) - jour(d)) / 86400000);
    if (j <= 0) return `aujourd'hui à ${heure}`;
    if (j === 1) return `hier à ${heure}`;
    return `le ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${heure}`;
  }

  // L'écran des mises à jour vit dans `src/renderer/majui.js` depuis le 23/09/2026, le même que
  // celui du Cabinet : « le même workflow que Apple » (Skander). Ici ne restent que ce qui est propre
  // à cette application — le jeton d'accès, la panne de relais — et les branchements.
  function drawUpdatePanel() {
    const el = $('#update-panel'); if (!el) return;
    const a = upd.app || {};
    const isMacUnsigned = a.platform === 'darwin' && !a.macSigned;
    // Quand le relais est en place, il n'y a plus rien à saisir : c'est lui qui détient l'accès au
    // dépôt. Montrer un champ « token » que personne n'a à remplir ne ferait qu'inquiéter.
    // Et si le relais a échoué, on le DIT et on remontre le champ : un écran qui affirme « rien à
    // configurer » devant une mise à jour impossible est pire que pas d'écran du tout.
    const relayNote = a.relayFailure ? `<p class="small mt" style="color:var(--danger)">${h(a.relayFailure)}</p>` : '';
    // Trois états, et un seul interrupteur pour passer de l'un à l'autre (`a.private`, qui vaut
    // `GITHUB.private` dans main.js) :
    //
    //  1. relais en place  → rien à saisir, c'est lui qui détient l'accès ;
    //  2. dépôt PRIVÉ      → le champ où coller un jeton, parce que sans lui rien ne se télécharge ;
    //  3. dépôt PUBLIC     → rien à saisir non plus ; on ne garde qu'un bouton pour RETIRER un
    //     ancien jeton, hérité de l'époque où le dépôt était privé.
    //
    // La 7.24.0 avait supprimé le champ purement et simplement, le dépôt venant de passer public.
    // Remettre le dépôt en privé aurait alors donné un cul-de-sac : l'écran aurait écrit « colle
    // ton jeton ci-dessous » au-dessus de rien du tout.
    const tokenBlock = a.relay
      // Un vieux jeton peut traîner sur le poste (le dépôt a été privé). Il ne sert plus à rien et
      // il n'est plus lu : le dire ici n'apprend rien à personne et donne l'air d'un réglage à
      // faire. On ne le mentionne QUE là où on peut le retirer — les deux autres branches.
      // Depuis le 23/09/2026, la ligne « Mises à jour automatiques — Activées » le dit déjà.
      ? ''
      : a.private ? relayNote + `<div class="token-box">
      <div class="k-label">Jeton d'accès au dépôt</div>
      <p class="small muted">SkanFact est distribué depuis un dépôt <b>privé</b> : un jeton de lecture est nécessaire pour recevoir les mises à jour. Il reste sur cet ordinateur et n'est envoyé à personne d'autre qu'à GitHub. ${info('upd.token')}</p>
      <div class="inline"><input type="password" id="upd-token" placeholder="github_pat_…" autocomplete="off" spellcheck="false"><button class="btn btn-sm" id="upd-token-save">Enregistrer</button>${a.hasToken ? `<button class="btn btn-sm btn-ghost" id="upd-token-clear">Retirer</button>` : ''}</div>
      ${a.hasToken ? '<p class="small muted">Un jeton est déjà enregistré sur cet ordinateur.</p>' : ''}
    </div>`
        : relayNote + (a.hasToken ? `<div class="token-box">
      <div class="k-label">Ancien jeton d'accès</div>
      <p class="small muted">Le dépôt de SkanFact est <b>public</b> : les mises à jour arrivent sans rien présenter. Un jeton datant de l'époque où il était privé est encore enregistré sur cet ordinateur ; il ne sert plus à rien.</p>
      <div class="inline"><button class="btn btn-sm btn-ghost" id="upd-token-clear">Retirer ce jeton</button></div>
    </div>` : '');
    el.innerHTML = MajUI.panneau({
      p: 'upd', nom: 'SkanFact', icone: '<span class="brand-mark">SF</span>', a, u: upd,
      notes: notesHtml(upd.notes), quand: quandVerif(a.lastCheck), macNonSigne: isMacUnsigned,
      tokenManquant: !a.relay && a.private && (upd.state === 'token' || !a.hasToken),
      heures: a.autoEvery ? Math.round(a.autoEvery / 3600000) : 0,
      canaux: upd.canaux, aideEssai: info('upd.beta'), avecNouveautes: true, fin: tokenBlock
    });
    $('#upd-changelog').onclick = showChangelog;
    if ($('#upd-beta')) $('#upd-beta').onchange = e => setBeta(e.target.checked);
    if ($('#upd-token-save')) $('#upd-token-save').onclick = async () => {
      const t = $('#upd-token').value.trim(); if (!t) return refus('#upd-token', 'Colle d\'abord le jeton d\'accès.');
      if (!/^(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]+$/.test(t)) return refus('#upd-token', 'Ce n\'est pas un jeton GitHub : il commence par github_pat_ ou ghp_.');
      const r = await bridge.updateSetToken(t); upd.app.hasToken = r.hasToken; upd.state = 'idle'; toast('Jeton enregistré');
      runCheck();
    };
    if ($('#upd-token-clear')) $('#upd-token-clear').onclick = async () => { const r = await bridge.updateSetToken(''); upd.app.hasToken = r.hasToken; upd.state = 'idle'; drawUpdatePanel(); };
    if ($('#upd-check')) $('#upd-check').onclick = runCheck;
    if ($('#upd-retry')) $('#upd-retry').onclick = async () => {
      upd.percent = 0; drawUpdatePanel();
      const r = await bridge.updateDownload();
      if (r && r.state === 'error') { upd.state = 'error'; upd.message = r.message; upd.detail = r.detail || ''; upd.soft = !!r.soft; drawUpdatePanel(); }
    };
    if ($('#upd-releases')) $('#upd-releases').onclick = () => bridge.updateOpenReleases();
    if ($('#upd-log')) $('#upd-log').onclick = () => bridge.openLog();
    if ($('#upd-install')) $('#upd-install').onclick = () => installerMaj($('#upd-install'));
  }

  // Installer, d'où que vienne le clic (le panneau ou la fenêtre « prête »).
  async function installerMaj(b) {
    if (b) { b.disabled = true; b.textContent = 'Redémarrage…'; }
    const r = await bridge.updateInstall();
    if (r && r.state === 'error') { upd.state = 'error'; upd.message = r.message; upd.detail = r.detail || ''; upd.soft = !!r.soft; drawUpdatePanel(); }
  }

  // À l'ouverture du panneau, comme le panneau « Mise à jour de logiciels » de macOS : on relit les
  // canaux publiés (la vraie dernière version d'essai), et on cherche si la dernière recherche date.
  function ouvrirPanneauMaj() {
    bridge.updateCanaux().then(c => { upd.canaux = c || null; drawUpdatePanel(); }).catch(() => {});
    const a = upd.app || {};
    if (a.packaged && (upd.state === 'idle' || upd.state === 'none') && Date.now() - (a.lastCheck || 0) > 60 * 1000) runCheck();
  }

  // La fenêtre de Sparkle : une version vient de finir de se télécharger. Une fois par version et
  // par jour au plus, jamais par-dessus une autre question, et pas quand le panneau est déjà sous
  // les yeux — il dit la même chose, avec le même bouton.
  function proposerInstallation(ev) {
    const panneau = $('#update-panel');
    if (panneau && panneau.offsetParent) return;
    if (document.querySelector('#modal-root .modal')) return;
    const lire = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* rappel perdu, rien de grave */ } };
    if (!MajUI.doitProposer(ev.version, lire, Date.now())) return;
    MajUI.noterProposee(ev.version, ecrire, Date.now());
    const a = upd.app || {};
    modal(MajUI.fenetrePrete({
      nom: 'SkanFact', icone: '<span class="brand-mark">SF</span>', version: ev.version, installee: a.version,
      notes: notesHtml(ev.notes || upd.notes), macNonSigne: a.platform === 'darwin' && !a.macSigned
    }), (root, close) => { $('#maj-go', root).onclick = () => { close(); installerMaj(); }; });
  }

  // Le canal bêta (7.25.0). Ce que fait l'interrupteur « Versions d'essai » : il choisit QUELLES
  // versions cet ordinateur reçoit. Désactivé — et il l'est chez tout le monde tant que personne n'y
  // touche — l'application ignore les essais, y compris publiés le jour même. Une question avant de
  // l'activer : une bêta s'installe PAR-DESSUS l'application qui tient la vraie comptabilité. On
  // prévient, on prend une sauvegarde nommée, on n'interdit pas.
  async function setBeta(on) {
    const box = $('#upd-beta');
    if (on) {
      const ok = await confirmDialog(
        'Les versions bêta sont des versions d\'essai : elles arrivent avant les autres et peuvent contenir des défauts.\n\n' +
        'Elles s\'installent par-dessus SkanFact et travaillent sur les mêmes données. Une sauvegarde va être prise tout de suite, avant tout changement.\n\n' +
        'Tu pourras revenir au canal normal à tout moment en désactivant « Versions d\'essai ».',
        'Recevoir les bêtas', false);
      if (!ok) { if (box) box.checked = false; return; }
      // Le filet, pris AVANT d'armer le canal : au moment où la bêta s'installera, l'utilisateur
      // sera peut-être ailleurs, et c'est trop tard pour y penser.
      try { await bridge.createBackup('avant-beta'); } catch (_) { /* pas de filet ≠ pas de canal */ }
    }
    const r = await bridge.updateSetBeta(!!on);
    upd.app.beta = r.beta;
    upd.state = 'idle';
    drawUpdatePanel();
    toast(r.beta ? 'Canal bêta activé — sauvegarde « avant-beta » prise' : 'Retour au canal normal');
    runCheck();
  }

  async function runCheck() {
    // Pendant un téléchargement seulement : une version PRÊTE n'empêche plus de chercher la suivante
    // (23/09/2026 — la 10.9.3 prête cachait la 10.10.0 publiée entre-temps).
    if (upd.state === 'downloading') return drawUpdatePanel();
    upd.state = 'checking'; drawUpdatePanel();
    const r = await bridge.updateCheck();
    // Le détail technique et la gravité voyagent avec le message : sans eux, « Détails techniques »
    // et le gris ne servent que pour les erreurs venues d'un ÉVÉNEMENT, jamais pour celles que
    // `update:check` renvoie directement — c'est-à-dire justement celles qu'on lit après un clic.
    if (r.state === 'error') { upd.state = 'error'; upd.message = r.message; upd.detail = r.detail || ''; upd.soft = !!r.soft; drawUpdatePanel(); }
    else if (r.state === 'dev') { upd.state = 'idle'; drawUpdatePanel(); toast('Disponible uniquement dans l\'application installée'); }
    else if (r.state === 'unconfigured') { upd.state = 'unconfigured'; drawUpdatePanel(); }
    else if (r.state === 'token') { upd.state = 'token'; drawUpdatePanel(); const i = $('#upd-token'); if (i) i.focus(); }
    // Le repli automatique a pu débrancher le relais pendant la vérification : on relit l'état de
    // l'application, sinon l'écran continue d'annoncer « rien à configurer » à tort.
    bridge.updateVersion().then(v => { upd.app = v; drawUpdatePanel(); });
    // sinon : les événements (none / available / downloading / downloaded) mettent le panneau à jour
  }

  async function showChangelog() {
    const md = await bridge.changelog();
    const body = md ? notesHtml(md.replace(/^# .*\n/, '').replace(/^Format[\s\S]*?\n\n/, '')) : '<p class="muted">Historique indisponible.</p>';
    modal(`<h2>Nouveautés</h2><div class="changelog">${body}</div><div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`);
  }

  // ---------- actions du menu de l'application ----------
  bridge.onMenuAction(name => {
    const click = sel => { const b = $(sel); if (b) b.click(); else toast('Ouvre d\'abord un devis ou une facture.', true); };
    if (name === 'new-devis') navigate('#/doc/new/devis');
    else if (name === 'new-facture') navigate('#/doc/new/facture');
    else if (name === 'new-avoir') navigate('#/doc/new/avoir');
    else if (name === 'save') click('#save');
    else if (name === 'pdf') click('#pdf');
    else if (name === 'settings') navigate('#/parametres');
    else if (name === 'export-data') exportAll();
    else if (name === 'import-data') importAll();
    else if (name === 'changelog') showChangelog();
    else if (name === 'search') openPalette();
    else if (name === 'lock') lockNow();
    else if (name === 'back') go(() => goBack());
    else if (name === 'apercu') {
      if (pleinEcranCourant) pleinEcranCourant();
      else toast('Le grand aperçu s\'ouvre depuis un devis ou une facture.', true);
    }
    else if (name.startsWith('help:')) navigate('#/aide/' + name.slice(5));
    else if (name.startsWith('go:')) navigate('#/' + name.slice(3));
  });

  // ---------- assistant de première utilisation ----------
  const OB = window.SkanOnboarding;
  // `rejoue` : l'assistant se relance depuis les Paramètres, prérempli avec ce qui est déjà réglé.
  // Jusqu'à la 7.1.1 il ne s'affichait qu'une fois — `needsSetup` exige qu'il n'y ait NI société, NI
  // document, NI client — et « Passer » le condamnait pour de bon. Quelqu'un qui l'avait sauté par
  // réflexe le premier jour ne pouvait plus jamais le revoir.
  function runSetup(rejoue) {
    // (plateforme, lot onboarding) L'assistant au nouveau style (plateforme/assistant.js) : « Où te joindre ? », puis
    // l'activité, la TVA et le menu. Il écrit par `OB.applySetup`, et montre la vraie facture et le vrai menu.
    if (window.SkanAssistant) {
      return window.SkanAssistant.ouvrir({
        rejoue: !!rejoue, C, OB,
        donnees: () => data,
        enregistrer: () => save(true),
        apercu: (co, lignes) => { const ex = factureDApercu(co); if (lignes) ex.doc.lines = lignes; return C.documentHtml(ex.doc, ex.client, co, {}); },
        menu: modules => C.navPages({ ...data, company: { ...data.company, modules } }).filter(p => !pageCachee(p.id)),
        deconnecter: () => { if (bridge.deconnecter) bridge.deconnecter(); },
        courriel: () => (bridge.courrielDuCompte ? bridge.courrielDuCompte() : Promise.resolve(''))
      }).then(fait => { drawNav(); return fait; });
    }
    return new Promise(resolve => {
      const steps = OB.STEPS;
      const co = (data && data.company) || {};
      const defauts = { currency: 'DT', stampFee: 1, quoteValidityDays: 30, paymentTermsDays: 30, defaultWithholdingRate: 0, activity: '', fillCatalog: true };
      // Reprise : l'assistant écrit à chaque étape depuis la 7.2.0, on repart donc là où il s'est
      // arrêté, avec ce qui avait déjà été tapé. Avant, fermer la fenêtre au cinquième écran
      // effaçait les cinq — alors que « Passer », geste plus radical, les conservait.
      const reprise = !rejoue && !!co.setupStarted;
      const a = rejoue ? { ...co, activity: co.activity || '', fillCatalog: false }
        : reprise ? { ...defauts, ...co, activity: co.activity || '', fillCatalog: !(data.catalog || []).length }
        : { ...defauts };
      if (!Array.isArray(a.modules)) delete a.modules;      // rejeu : null ne doit pas passer pour un choix
      a.modulesTouche = Array.isArray(a.modules);           // un choix déjà enregistré ne se fait pas écraser
      // Le régime, exactement pareil — et il ne l'était pas. `regimeTouche` n'est jamais enregistré
      // (`applySetup` ne recopie que les champs de la société), donc il repartait à `undefined` au
      // rejeu : rejouer l'assistant pour corriger son MÉTIER — le seul endroit où l'on puisse le
      // faire — écrasait en silence le régime fiscal réglé à la main. Or un seul métier sur quinze
      // en propose un ; pour les quatorze autres, `regimeSuggere` rend `''`, c'est-à-dire « réel ».
      // Un forfaitaire qui re-cliquait son propre métier repartait donc au réel et se remettait à
      // facturer 19 % de TVA — exactement la faute que la 7.22.0 avait été écrite pour empêcher.
      a.regimeTouche = !!String(co.taxRegime || '').trim();
      // La PORTE (10.14.0) : découvrir sur l'exemple, ou commencer tout de suite. Elle ne s'ouvre
      // qu'une fois par personne sur ce poste (`accueilVu`, comme la progression des visites) : une
      // seconde entreprise créée demain n'a pas à reproposer la découverte à quelqu'un qui connaît
      // SkanFact. Jamais au rejeu (on vient corriger une réponse), jamais depuis l'exemple.
      const et = visitesEtat();
      const porte = !rejoue && !et.faites.decouvrir && !et.accueilVu && !C.estDemo(data);
      const premier = porte ? 0 : 1;                        // la porte est l'écran 0, jamais une question
      const questions = steps.filter(s => !s.porte);
      let i = reprise ? Math.min(Math.max(Number(co.setupStep) || 0, 0), steps.length - 1) : 0;
      if (i < premier) i = premier;
      const root = document.createElement('div'); root.id = 'setup';
      document.body.appendChild(root);

      const LETTRES = ['Aucune', 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six'];
      const bodyFor = s => {
        // Deux battants, le recommandé en avant — et UN seul vert (U-11). Le compte des questions et
        // ce qu'elles demandent se lisent sur `OB.STEPS` ; la durée et les chapitres de la découverte,
        // sur la visite elle-même : un compte recopié à la main mentirait au premier écran ajouté.
        if (s.porte) {
          const dec = resumeVisite('decouvrir');
          const nChap = dec ? dec.chapitres : 0;
          const quoi = C.liste(questions.map(x => x.quoi));
          return `<div class="setup-porte">
            <p class="sp-lead">Deux façons de commencer — et tu peux faire l'une puis l'autre.</p>
            <div class="sp-choix">
              <article class="pp-choix reco"><span class="pp-choix-badge">Recommandé</span>
                <span class="pp-choix-ico">${ICONE_DECOUVRIR}</span>
                <h3>Découvrir avec un exemple</h3>
                <p>Une entreprise de cinq ans, toute remplie : je te fais faire le tour, sans rien risquer. Tu prépares la tienne ensuite, en sachant à quoi sert chaque case.</p>
                <ul class="pp-choix-meta">${dec ? `<li>${h(dec.duree)}</li>` : ''}${nChap ? `<li>${pl(nChap, 'chapitre')}</li>` : ''}</ul>
                <button type="button" class="btn btn-primary" id="sf-decouvrir">Commencer la découverte</button></article>
              <article class="pp-choix"><span class="pp-choix-ico">${ICONE_DEMARRER}</span>
                <h3>Commencer avec mon entreprise</h3>
                <p>${h(quoi.charAt(0).toUpperCase() + quoi.slice(1))} — puis je te guide pour chaque premier geste, un clic après l'autre.</p>
                <ul class="pp-choix-meta"><li>${LETTRES[questions.length] || questions.length} ${questions.length > 1 ? 'questions' : 'question'}</li></ul>
                <button type="button" class="btn" id="sf-next">Commencer avec mon entreprise</button></article>
            </div>
            ${/* 10.14.0 — deux personnes n'ont rien à faire de la découverte ni des trois questions : celle
                 qui a DÉJÀ acheté (sa clé porte son nom et son matricule) et celle qui rejoint un dossier
                 posé par un associé (il est déjà rempli). Sans ces deux portes, la première retapait ce
                 que sa clé savait, la seconde fabriquait une entreprise vide à côté de la vraie. */''}
            <div class="sp-autres"><span class="small muted">Tu as déjà ce qu'il faut ?</span>
              <button type="button" class="btn btn-sm" id="sf-cle">J'ai déjà une clé de licence…</button>
              <button type="button" class="btn btn-sm" id="sf-rejoindre">Je rejoins un dossier partagé…</button></div>
            <div class="sp-note">${s.intro}</div>
          </div>`;
        }
        if (s.id === 'entreprise') return `<form id="sf-form" class="grid-2">
          <label class="field span-2 obligatoire">${lbl('Raison sociale', 'co.name')}<input type="text" name="name" value="${h(a.name || '')}" placeholder="Nom exact de l'entreprise, forme juridique comprise" autofocus></label>
          ${field(lbl('Matricule fiscal', 'co.matricule'), 'matricule', a.matricule || '', 'text', 'placeholder="1234567X/A/M/000"')}
          ${field(lbl('Registre de commerce (RC)', 'co.rc'), 'rc', a.rc || '', 'text', 'placeholder="facultatif, ex. B123456789"')}
          <label class="field span-2">${lbl('Adresse', 'co.address')}<textarea name="address" placeholder="Rue et numéro&#10;Code postal et ville">${h(a.address || '')}</textarea></label>
          ${field(lbl('Téléphone', 'co.phone'), 'phone', a.phone || '')}
          ${field(lbl('Email', 'co.email'), 'email', a.email || '', 'email')}
          ${field(lbl('Capital social', 'co.capital'), 'capital', a.capital || '', 'text', 'placeholder="facultatif, ex. 1 000 DT"')}
        </form>
        ${a.depuisLicence ? '<p class="small muted">La raison sociale et le matricule viennent de ta clé de licence. Vérifie qu\'ils s\'écrivent exactement comme sur tes papiers : la clé reste valable tant que le matricule ne change pas.</p>'
          : a.nomDuDossier ? '<p class="small muted">C\'est le nom du dossier que tu viens de créer. Corrige-le ici pour qu\'il s\'imprime exactement comme sur tes papiers, forme juridique comprise.</p>' : ''}
        <p class="small muted">Le matricule fiscal est obligatoire sur une facture en Tunisie. Si tu ne l'as pas encore, laisse vide et complète-le avant ta première facture.</p>`;
        if (s.id === 'activite') {
          // Le métier ne porte plus de taux de TVA (7.22.0) : il annonçait « TVA 19 % » pour tout le
          // monde et « TVA 0 % » pour la santé, deux affirmations fausses la moitié du temps. Ce qui
          // décide, c'est le régime, et il se demande juste en dessous.
          const reg = C.regimeOf({ taxRegime: a.taxRegime });
          return `<div class="act-grid">
          ${C.ACTIVITIES.map(x => `<button type="button" class="act ${a.activity === x.id ? 'sel' : ''}" data-act="${x.id}">
            <span class="act-l">${h(x.label)}</span>
            <span class="act-s">${x.catalog.length ? pl(x.catalog.length, 'prestation proposée', 'prestations proposées') : 'catalogue vide'}${x.honoraires ? ' · note d\'honoraires' : ''}</span></button>`).join('')}
        </div>
        <label class="check mt"><input type="checkbox" id="sf-cat" ${a.fillCatalog ? 'checked' : ''}> Préremplir mon catalogue avec ces prestations (prix à ajuster ensuite)</label>
        <p class="small muted mt">Le catalogue sert à insérer une prestation dans un devis en un clic, sans retaper le libellé ni le prix.</p>
        <label class="field mt span-2">${lbl('Régime fiscal', 'co.taxRegime')}
          <select id="sf-regime">${C.REGIMES.map(r => `<option value="${r.id}" ${reg.id === r.id ? 'selected' : ''}>${h(r.label)}</option>`).join('')}</select></label>
        <p class="small muted" id="sf-regime-aide">${h(reg.aide)}</p>
        <p class="small muted"><em>À VÉRIFIER avec ton comptable :</em> le régime dépend de ton chiffre d'affaires et de ta forme juridique. Dans le doute, garde « Réel » — c'est le cas le plus courant, et ça se change ensuite dans Paramètres.</p>`;
        }
        // Tant que personne ne posait la question, `company.modules` restait à `null` et le menu
        // affichait ses dix-sept entrées dès le premier jour : Stock, Paie, Immobilisations et
        // Marges à quelqu'un qui n'a pas encore un seul client. Le tri existait, personne ne
        // l'armait. Les cases arrivent cochées d'après le métier déclaré à l'écran précédent.
        if (s.id === 'modules') {
          if (!a.modulesTouche) a.modules = C.modulesSuggeres(a.activity);
          const suggere = C.modulesSuggeres(a.activity);
          const coeur = C.MODULES.filter(m => m.toujours);
          const choix = C.MODULES.filter(m => !m.toujours);
          // Le cœur du métier tient en UNE ligne. La première version lui donnait trois lignes
          // verrouillées en tête de liste : elles ne se cochent pas, elles ne se décochent pas, et
          // elles poussaient les vraies questions — et la phrase qui rassure — sous la coupe. Une
          // capture l'a montré tout de suite ; la relecture du code, non.
          return `<p class="small muted">Les cases sont posées d'après ton métier. ${C.liste(coeur.map(m => m.label))} sont toujours là.</p>
          <div id="sf-mods" class="mods-serre">${choix.map(m => {
            const on = a.modules.includes(m.id);
            return `<div class="mod-row${on ? ' on' : ''}">
              <label class="mod-check"><input type="checkbox" data-sfmod="${h(m.id)}" ${on ? 'checked' : ''}></label>
              <div class="mod-txt">
                <div class="mod-t">${h(m.label)}${suggere.includes(m.id) ? ' <span class="small muted">— proposé pour ton métier</span>' : ''}</div>
                <div class="small muted">${h(m.quoi)}</div>
              </div>
            </div>`;
          }).join('')}</div>
          <p class="small muted"><b>Rien n'est supprimé ni désactivé.</b> Une page retirée du menu reste atteignable par la recherche
          (${MOD}+K), et un module qui contient quelque chose revient tout seul.</p>`;
        }
        return '';
      };

      const draw = dansUnLot(() => {
        const s = steps[i];
        // Le compteur et la barre comptent les QUESTIONS : la porte n'en est pas une, elle n'en porte
        // aucun — « 1 / 4 » sur un écran de bienvenue ferait croire à un formulaire de quatre pages.
        root.innerHTML = `<div class="setup-card${s.porte ? ' porte' : ''}">
          <div class="setup-head">
            <div class="brand-mark">SF</div>
            <div><div class="setup-t">${h(s.title)}</div><div class="setup-s">${h(s.sub)}</div></div>
            ${/* « Question 2 sur 3 », comme le Cabinet (A4) : « 2 / 3 » se lit comme une date ou une fraction. */''}
            ${s.porte ? '' : `<div class="setup-step">Question ${i} sur ${questions.length}</div>`}
          </div>
          ${s.porte ? '' : `<div class="setup-bar"><i style="width:${Math.round(i / questions.length * 100)}%"></i></div>`}
          <div class="setup-body">${bodyFor(s)}</div>
          <div class="setup-foot">
            <button class="btn btn-ghost" id="sf-skip">Passer et tout régler plus tard</button>
            ${i > premier ? '<button class="btn" id="sf-prev">Retour</button>' : ''}
            ${s.porte ? '' : `<button class="btn btn-primary" id="sf-next">${i === steps.length - 1 ? 'Terminer' : 'Continuer'}</button>`}
          </div>
        </div>`;
        // L'étoile d'un champ obligatoire et sa légende, comme dans toute fenêtre (7.20.0) : l'assistant
        // écrivait « OBLIGATOIRE » en orange, seul écran de l'application à le dire autrement (A3). La
        // légende se DÉDUIT de l'étoile, elle ne se recopie pas écran par écran — et elle vit dans le
        // PIED, à côté des boutons, comme dans une fenêtre : posée sous le formulaire, elle ajoutait
        // une ligne au corps, qui défilait alors pour 7 pixels à 1440×900 (vu à la souris).
        if ($('.field.obligatoire', root) && !$('.oblig-note', root)) {
          const note = document.createElement('span');
          note.className = 'oblig-note';
          note.innerHTML = '<b>*</b> obligatoire';
          const pied = $('.setup-foot', root);
          pied.insertBefore(note, $('#sf-prev', pied) || $('#sf-next', pied));
        }
        const form = $('#sf-form', root);
        if (form) { const f = $('input, textarea', form); if (f) f.focus(); }
        // Sur la porte, le curseur est sur le chemin recommandé : Entrée le prend, Tab passe à l'autre.
        if (s.porte && $('#sf-decouvrir', root)) $('#sf-decouvrir', root).focus();
        // Choisir un métier redessine l'écran : on relit d'abord TOUT ce que l'écran porte, sinon le
        // régime et la case « préremplir » repartent à leur valeur d'avant le clic — on ne jette
        // jamais ce que quelqu'un vient de saisir (règle 7.1.x, « Passer » ne jette rien).
        const lireActivite = () => {
          const cat = $('#sf-cat', root); if (cat) a.fillCatalog = cat.checked;
          const reg = $('#sf-regime', root); if (reg) a.taxRegime = reg.value;
        };
        $$('[data-act]', root).forEach(b => b.onclick = () => {
          lireActivite();
          a.activity = b.dataset.act;
          // Le métier PROPOSE son régime tant que personne n'a touché à la liste (règle 3.5.0 : la
          // famille d'un bien propose sa durée sans l'imposer). Sans ça, un kinésithérapeute qui
          // vient de cliquer « Santé et paramédical » repart avec 19 % de TVA sur ses honoraires.
          if (!a.regimeTouche) a.taxRegime = C.regimeSuggere(a.activity);
          draw();
        });
        const selRegime = $('#sf-regime', root);
        if (selRegime) selRegime.onchange = () => {
          a.taxRegime = selRegime.value;
          a.regimeTouche = true;             // un choix fait à la main ne se fait plus écraser
          // On ne redessine pas tout l'écran pour trois lignes de texte : le métier choisi garderait
          // son focus, mais la liste sauterait sous le doigt. Seule l'explication change.
          const aide = $('#sf-regime-aide', root);
          if (aide) aide.textContent = C.regimeOf({ taxRegime: a.taxRegime }).aide;
        };
        if ($('#sf-cat', root)) $('#sf-cat', root).onchange = e => { a.fillCatalog = e.target.checked; };
        $$('[data-sfmod]', root).forEach(cb => cb.onchange = () => {
          const liste = Array.isArray(a.modules) ? a.modules.slice() : C.modulesSuggeres(a.activity);
          const k = liste.indexOf(cb.dataset.sfmod);
          if (cb.checked && k < 0) liste.push(cb.dataset.sfmod);
          if (!cb.checked && k >= 0) liste.splice(k, 1);
          a.modules = liste;
          a.modulesTouche = true;            // un choix fait à la main ne se fait plus écraser
          cb.closest('.mod-row').classList.toggle('on', cb.checked);
        });
        if ($('#sf-decouvrir', root)) $('#sf-decouvrir', root).onclick = () => {
          porteVue();
          // L'assistant reste EN ATTENTE à « Ton entreprise » : la sauvegarde que prend l'exemple
          // le garde, et sortir de l'exemple le rouvre là — trois questions, posées à quelqu'un qui
          // sait maintenant à quoi elles servent.
          etape(i + 1);
          root.remove();
          resolve('decouvrir');
        };
        if ($('#sf-cle', root)) $('#sf-cle', root).onclick = cleALaPorte;
        if ($('#sf-rejoindre', root)) $('#sf-rejoindre', root).onclick = () => rejoindreDossier({ avant: porteVue, remplacerVierge: true,
          autre: 'Si c\'est toi qui commences, choisis plutôt «\u00a0Commencer avec mon entreprise\u00a0»\u00a0: tu pourras la partager ensuite, depuis le menu de ton entreprise, en haut à gauche.' });
        if ($('#sf-prev', root)) $('#sf-prev', root).onclick = () => { collect(); etape(i - 1); i--; draw(); };
        $('#sf-next', root).onclick = () => {
          collect();
          // Le régime et la case « préremplir » ne vivent pas dans `#sf-form` : `collect()` ne les
          // voit pas. On les relit ici, sinon un choix fait au clavier juste avant « Continuer »
          // serait perdu — l'assistant doit écrire à chaque étape (règle 7.3.0).
          lireActivite();
          porteVue();
          if (steps[i].id === 'entreprise' && !String(a.name || '').trim()) return refus($('#sf-form [name=name]', root), 'La raison sociale est nécessaire : c\'est le nom qui apparaît sur tes documents.');
          // L'écran « Ton activité » se traversait sans rien cliquer, et la case « Préremplir mon
          // catalogue » était cochée d'office : on promettait un catalogue qui n'arrivait jamais,
          // et `defaultVatRate` restait vide alors qu'une bulle affirme ailleurs que l'assistant
          // l'a réglé d'après le métier. « Autre activité » existe précisément pour ce cas.
          if (steps[i].id === 'activite' && !a.activity) return refus($('.act-grid', root), 'Choisis une activité — « Autre activité » convient si aucune ne correspond.');
          if (i === steps.length - 1) return finish();
          etape(i + 1);
          i++; draw();
        };
        // Entrée continue depuis un CHAMP ; sur un bouton, elle fait ce que fait ce bouton. Elle
        // cliquait « Continuer » quel que soit l'élément sous le curseur : sur la porte, Entrée sur
        // « Commencer la découverte » aurait ouvert le formulaire à la place.
        root.onkeydown = e => {
          if (e.key !== 'Enter' || ['TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(e.target.tagName) || steps[i].porte) return;
          const suite = $('#sf-next', root);
          if (suite) { e.preventDefault(); suite.click(); }
        };
        $('#sf-skip', root).onclick = async () => {
          // On ramasse d'abord : « Passer » jetait tout ce qui venait d'être tapé, même au dernier
          // écran, sans le dire. Quelqu'un qui avait rempli quatre écrans et cliquait « Passer » au
          // cinquième repartait avec une fiche société vide.
          collect();
          const saisi = ['name', 'matricule', 'rc', 'address', 'phone', 'email', 'bank', 'rib', 'capital']
            .filter(k => String(a[k] || '').trim()).length;
          // L'avertissement ne nomme que ce qui MANQUE : il reprochait l'absence de raison sociale à
          // quelqu'un qui venait de la taper (une nouvelle entreprise arrive avec son nom).
          const manque = [!String(a.name || '').trim() && 'raison sociale', !String(a.matricule || '').trim() && 'matricule fiscal'].filter(Boolean);
          const surLaPorte = !!steps[i].porte;
          if (!await confirmDialog(
            (saisi ? `Ce que tu as déjà rempli (${saisi} champ${saisi > 1 ? 's' : ''}) est conservé. ` : '')
            + (surLaPorte ? 'Passer l\'assistant et découvrir SkanFact seul ?' : 'Passer la suite de l\'assistant ?')
            + ' Tu pourras tout régler dans Paramètres'
            + (manque.length ? `, mais une facture sans ${manque.join(' ni ')} n'est pas conforme.` : '.'),
            'Passer', false)) return;
          porteVue();
          OB.applySetup(data, a);            // on garde ce qui a été saisi, on n'invente rien
          save(true); drawNav(); root.remove(); resolve(false);
          // Refuser la porte n'est pas refuser d'être aidé : on dit où la retrouver (règle 7.18.0 —
          // la même phrase que « Non merci » de l'accueil).
          if (surLaPorte) toast('D\'accord. La découverte et chaque visite guidée restent dans « Me guider », en bas du menu.');
        };
      });
      const collect = () => { const f = $('#sf-form', root); if (f) Object.assign(a, formValues(f)); };
      // La porte a été vue, quel que soit le battant choisi : elle ne se rouvre plus, ni ici ni sur
      // l'accueil (où elle vivait avant la 10.14.0, et vit encore pour qui ne l'a jamais vue). Au niveau
      // de l'assistant, pas dans `draw()` : la fenêtre de la clé la rappelle APRÈS s'être fermée, et une
      // fonction déclarée dans `draw()` n'y existe pas — la fenêtre se fermait sur une ReferenceError,
      // la clé enregistrée, et l'assistant restait sur la porte sans un mot.
      const porteVue = () => { if (steps[i].porte) visitesPoser(e => { e.accueilVu = true; }); };
      // « J'ai déjà une clé de licence » (10.14.0). La clé porte le nom et le matricule de l'entreprise
      // à qui elle a été vendue : on l'enregistre par la MÊME porte que le panneau Licence
      // (`licence:set`, qui refuse une clé fausse ou celle d'une autre entreprise en disant pourquoi),
      // puis l'assistant reprend à « Ton entreprise », ces deux champs déjà remplis. Un refus se MONTRE
      // sur la case (7.0.0) : la fenêtre reste ouverte avec ce qui a été collé.
      const cleALaPorte = () => modal(`<h2>J'ai déjà une clé de licence</h2>
        <p>Colle la clé reçue par mail après ton achat : elle commence par « SKAN1. ». SkanFact y lit le nom et le matricule de ton entreprise, et l'assistant reprend avec eux, déjà remplis.</p>
        <form id="sf-cle-form"><label class="field obligatoire">${lbl('Clé de licence', 'lic.cle')}<textarea name="cle" rows="4" placeholder="SKAN1.…" spellcheck="false" autocomplete="off"></textarea></label></form>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" id="sf-cle-ok">Enregistrer la clé et continuer</button></div>`,
      (m, close) => {
        const champ = $('[name=cle]', m);
        $('#sf-cle-ok', m).onclick = async () => {
          const k = champ.value.trim();
          if (!k) return refus(champ, 'Colle ta clé de licence : elle commence par « SKAN1. ».');
          let st;
          try { st = await bridge.licenceSet(k, ''); } catch (e) { return refus(champ, plainError(e)); }
          licence = st;
          close();
          porteVue();
          // Le nom de la clé est celui qu'on a acheté, donc le nom légal : il remplace le nom d'un
          // dossier tout juste créé (une étiquette), jamais une raison sociale tapée à la main.
          if (st.name && (!String(a.name || '').trim() || a.nomDuDossier)) { a.name = st.name; a.nomDuDossier = false; }
          if (st.matricule && !String(a.matricule || '').trim()) a.matricule = st.matricule;
          a.depuisLicence = true;
          toast(licenceEnregistree(st));
          etape(i + 1); i++; draw();
        };
      });
      // Écrire à chaque changement d'étape, sans déclarer l'assistant terminé. Rien ne vivait sur
      // le disque avant `finish()` : une veille, un Cmd+Q ou un rechargement du chien de garde au
      // cinquième écran, et les cinq écrans étaient à retaper. En rejeu on ne touche à rien tant
      // que l'utilisateur n'a pas fini : ses données existent déjà, elles ne sont pas un brouillon.
      const etape = n => {
        if (rejoue) return;
        try { OB.applySetup(data, a, { done: false, step: n }); save(true); } catch (_) {}
      };
      const finish = () => {
        OB.applySetup(data, a);
        save(true);
        drawNav();                           // le choix des modules change le menu tout de suite
        root.remove();
        resolve(true);
      };
      // « + Nouveau dossier sur cet ordinateur » demande déjà le nom de l'entreprise ; l'assistant
      // le redemandait aussitôt sous un autre libellé, champ vide, et on se demandait si les deux
      // désignaient la même chose. On ne reprend PAS le dossier d'origine, dont le nom d'usine est
      // « Mon entreprise » : ce serait remplacer la page blanche par une fausse réponse.
      (async () => {
        if (!rejoue && !reprise && !String(a.name || '').trim() && bridge.listDossiers) {
          try {
            const r = await bridge.listDossiers();
            const d = ((r || {}).dossiers || []).find(x => x.id === r.current);
            if (d && d.id !== 'principal' && String(d.name || '').trim()) { a.name = d.name; a.nomDuDossier = true; }
          } catch (_) { /* pas de dossiers : on démarre sur la page blanche, comme avant */ }
        }
        draw();
      })();
    });
  }

  // Le battant « Découvrir avec un exemple » de la porte (10.14.0) : l'exemple se charge — avec sa
  // sauvegarde, prise juste avant — et la découverte démarre sur lui. S'il n'a pas pu se charger,
  // l'assistant reprend là où la porte l'a laissé : personne ne reste devant un accueil vide sans
  // savoir par quoi commencer.
  async function decouvrirDepuisLaPorte() {
    if (await loadDemo('decouvrir')) { lancerVisite('decouvrir'); return; }
    if (await reprendreAssistant()) render();
  }
  // L'assistant que la porte a laissé EN ATTENTE, repris là où il s'était arrêté (« Ton entreprise ») :
  // au retour de l'exemple, ou quand l'exemple n'a pas pu se charger. Rend `true` quand l'assistant
  // s'est montré (terminé ou passé), `false` s'il n'y avait rien à reprendre.
  async function reprendreAssistant() {
    if (!OB.needsSetup(data)) return false;
    const fait = await runSetup();
    applyTheme();
    $('#brand-company').textContent = data.company.name || 'Ton entreprise';
    if (fait === true) toast('C\'est prêt.');
    return true;
  }

  // L'assistant, rejouable (7.1.1). Il ne réécrit que ce qu'on lui redonne : les champs arrivent
  // préremplis avec les réglages actuels, et le catalogue n'est pas re-proposé (on en a déjà un).
  // Hors de `routes.parametres` depuis la 7.2.0 : le bouton était rangé dans un panneau qui parle
  // de la barre latérale, cinquième de sept, dans le sixième des huit onglets, et absent de la
  // palette. Quelqu'un qui veut revoir les questions ne le trouvait pas, et concluait qu'on ne
  // peut pas revoir l'assistant — alors qu'il a été écrit pour ça.
  async function rejouerAssistant() {
    if (!await confirmDialog('Revoir l\'assistant de démarrage ? Tes réponses actuelles y sont déjà inscrites : tu peux les corriger ou simplement le parcourir. Aucune de tes pièces n\'est touchée.', 'Revoir l\'assistant', false)) return;
    // Ce qui vient d'être réglé part AVEC l'assistant, pas à la poubelle : un thème choisi puis
    // « Revoir l'assistant » revenait à Clair sans un mot (10.13.0, vu à la souris — règle 7.30.0).
    // Depuis une autre page (la palette), c'est la question de toute sortie qui se pose : une pièce
    // en cours ne s'enregistre pas dans le dos de celui qui la tape.
    if (/^#\/parametres/.test(location.hash)) enregistrerEnCours();
    else if (!await leaveOk()) return;
    clearGuard();
    await runSetup(true);
    applyTheme();
    $('#brand-company').textContent = data.company.name || 'Ton entreprise';
    render();
  }

  // ---------- import / export ----------
  async function exportAll() {
    if (security.encrypted && !await confirmDialog('L\'export JSON est en clair (non chiffré). Continuer ?', 'Exporter', false, { titre: 'Exporter en clair ?' })) return;
    const p = await bridge.exportData(data); if (p) toast('Exporté : ' + p.split(/[\\/]/).pop());
  }
  async function importAll() {
    // La question nomme ce qui sera remplacé et le geste qui suit : « Confirmer » ne disait ni
    // l'un ni l'autre, et le fichier ne se choisit qu'après.
    if (!await confirmDialog(`Importer un fichier remplacera toutes les données de ${data.company.name || 'cette entreprise'}. Une sauvegarde de l'état actuel est prise juste avant, et le panneau Sauvegardes pourra la restaurer.`, 'Choisir le fichier à importer…')) return;
    if (!await closedWipeOk('Importer un fichier remplace tout.')) return;
    try {
      let r = await bridge.importData();
      if (r && r.needPassword) {
        r = await new Promise(resolve => promptDialog('Fichier chiffré', 'Mot de passe de ce fichier', '', async pw => resolve(await bridge.importData({ retry: true, password: pw })), 'password'));
      }
      if (r && r.needPassword) return toast('Mot de passe incorrect.', true);
      const d = r && r.data;
      // `save` autant que `clearGuard` comptent : sans l'enregistrement, quitter juste après un import
      // reperdait le fichier importé ; sans le désarmement, le garde-fou réclamait ensuite des
      // modifications qui n'existent plus.
      if (d) { clearGuard(); data = migrate(d); save(true); applyTheme(); $('#brand-company').textContent = data.company.name; toast(r.piecesJointes ? `Données importées, avec ${pl(r.piecesJointes, 'pièce jointe reprise', 'pièces jointes reprises')} de la copie` : 'Données importées'); render(); }
    } catch (e) { toast('Import impossible : ' + plainError(e), true); }
  }
  // « Exporter » et « Importer » vivaient dans le pied de la barre latérale, donc toujours visibles,
  // alors que « Paramètres » et « Aide » ne l'étaient jamais. Les deux boutons dont un débutant n'a
  // pas besoin occupaient la place des deux dont il a besoin. Ils n'ont pas disparu : ils étaient
  // déjà en double dans Paramètres → Données et sécurité (#export-data / #import-data), à côté des
  // sauvegardes, c'est-à-dire là où on les cherche.

  // ---------- le garde-fou d'erreur (9.1.0, SPEC-OUT-004) ----------
  //
  // Posé ICI, avant tout le reste : une exception levée pendant la séquence de démarrage est la
  // plus grave de toutes — l'écran reste blanc — et c'est précisément celle qu'un garde-fou
  // installé plus bas ne verrait pas.
  //
  // Ce que ce dépôt a payé pour l'écrire : `h(a.relayFailure)` (6.8.0), une variable d'une autre
  // route (7.20.0), `C.pl(...)` alors que `pl` est locale (7.22.0), `clientItems` déclarée dans un
  // autre formulaire (7.23.0), `null.onclick` après une attente (7.6.0). Cinq fois le même scénario :
  // un écran blanc, un bouton mort ou une fenêtre qui ne s'ouvre pas, et RIEN nulle part — parce que
  // sur le poste d'un utilisateur, la console du navigateur n'existe pas.
  //
  // Il n'affiche rien et ne recharge rien. Il écrit, et « Aide → Signaler un problème » emporte le
  // journal. Une erreur d'interface n'est pas toujours visible pour l'utilisateur : lui coller une
  // fenêtre le ferait douter d'un travail qui s'est peut-être bien passé, et une application qui
  // annonce une panne qui n'en est pas une apprend à cliquer sans lire (7.28.0).
  const noterErreur = (info) => { try { bridge.supportErreur(info); } catch {} };
  window.addEventListener('error', e => noterErreur({
    message: (e && e.message) || '(sans message)', source: (e && e.filename) || '',
    ligne: (e && e.lineno) || 0, pile: (e && e.error && e.error.stack) || ''
  }));
  // Une promesse rejetée et jamais rattrapée ne passe PAS par `error` : c'est un événement à part,
  // et c'est celui d'une fonction asynchrone qui échoue — le cas le plus courant ici, puisque tout
  // ce qui traverse le pont l'est.
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    noterErreur({
      message: 'promesse rejetée : ' + ((r && r.message) || String(r || '(sans raison)')),
      source: '', ligne: 0, pile: (r && r.stack) || ''
    });
  });

  // ---------- chien de garde et messages du processus principal ----------
  // Abonnés AVANT la séquence de démarrage : l'assistant de première utilisation la met en attente,
  // et un message reçu pendant ce temps serait perdu pour toujours.
  // Le chien de garde : répondre au processus principal tant que l'interface tourne. La réponse
  // part du fil principal du renderer — c'est exactement lui qu'une boucle infinie bloquerait.
  bridge.onAlivePing();
  // Après un gel, l'application se recharge toute seule. Elle le dit : un redémarrage silencieux
  // ferait douter de ce qui a été enregistré, alors qu'il ne s'est rien perdu de ce qui l'était.
  bridge.onFreezeNotice(f => {
    modal(`<h2>SkanFact s'était bloqué</h2>
      <p>L'application n'a plus répondu pendant ${h(String((f && f.silence) || '?'))} secondes, et elle vient de redémarrer toute seule.</p>
      <p class="small"><strong>Ce qui était enregistré est intact.</strong> Ce qui était en cours de saisie sans avoir été enregistré est perdu — c'était déjà le cas avant le redémarrage.</p>
      <p class="small">SkanFact a noté où le programme s'était arrêté. Si cela se reproduit, envoie-le : <em>Aide → Signaler un problème</em>. C'est ce qui permet de corriger.</p>
      <div class="modal-actions"><button class="btn" data-close>Continuer</button><button class="btn btn-primary" id="fz-rep">Signaler</button></div>`,
      (root, close) => { $('#fz-rep', root).onclick = () => { close(); supportForm(); }; });
  });
  // ---------- démarrage ----------
  (async () => {
    // (1.155.0, maquette « chargement ») Une pièce ouverte par son adresse se dessine en squelette tant que le dossier
    // arrive : rien ne saute ensuite, et au-delà de 3 secondes la page dit pourquoi elle attend.
    const vue0 = $('#view');
    let lent = null;
    if (vue0 && !vue0.children.length && /^#\/doc\//.test(location.hash)) {
      const bloc = (h2) => `<div class="panel sq-bloc"><span class="sq sq-titre"></span><span class="sq" style="height:${h2}px"></span></div>`;
      vue0.innerHTML = `<div class="sq-page" aria-busy="true" aria-label="La pièce arrive"><div class="sq-tete"><span class="sq" style="width:160px;height:12px"></span><span class="sq" style="width:220px;height:26px"></span></div>
        <div class="sq-corps"><div class="sq-gauche">${bloc(120)}${bloc(260)}${bloc(160)}</div><div class="sq-droite">${bloc(220)}${bloc(48)}</div></div>
        <p class="sq-lent" id="sq-lent" hidden>La connexion est lente : la pièce arrive.</p></div>`;
      lent = setTimeout(() => { const l = $('#sq-lent'); if (l) l.hidden = false; }, 3000);
    }
    const loaded = await bridge.loadData();
    if (lent) clearTimeout(lent);
    let raw = loaded && loaded.data;
    security.encrypted = !!(loaded && loaded.encrypted);
    if (loaded && loaded.locked) raw = await showLockScreen();
    data = migrate(raw);
    if (raw && (raw.version || 1) < 3) save(true); // données migrées vers le nouveau format : on enregistre tout de suite
    // Le jeu d'exemple se refait tout seul quand l'application a changé de version, ou quand on a
    // changé de mois (9.4.2) : personne ne pense à l'effacer puis à le recharger, et un exemple
    // périmé raconte des retards qui n'existent pas. Ne touche rien d'autre que l'exemple.
    await rafraichirExemple();
    // (plateforme 1.173.0) Les achats que le cabinet a justifiés dans son classeur le sont ici aussi, dès l'ouverture.
    if (bridge.messagerie && bridge.messagerie.range) bridge.messagerie.range().then(l => { if (marquerJustifsCabinet(l) && /^#\/(achat|purchases|dashboard)/.test(location.hash)) render(true); }, () => null);
    applyTheme();
    // Toute première ouverture : la porte, puis l'assistant qui remplit l'entreprise avant d'entrer
    // dans l'application — ou la découverte d'abord, si c'est le battant choisi (10.14.0).
    let decouvrirDabord = false;
    // Retenu AVANT l'assistant : une fois la société remplie, rien ne distingue plus une installation
    // neuve d'une mise à jour, et la carte « Ce qui change pour toi » s'ouvrait sur le tout premier
    // écran de quelqu'un pour qui rien n'a changé (vu à la souris, parcours d'un débutant).
    // (plateforme, lot onboarding) L'entreprise que la porte vient de créer ouvre l'assistant : posé dans le dossier dès
    // l'ouverture, il se reprend là où il s'est arrêté, sur ce poste ou un autre. Il est au propriétaire et aux
    // administrateurs (ceux qui mettent l'entreprise en place) : un membre de l'équipe ne le voit jamais. La porte a été
    // vue (celle de l'entrée, qui a fait choisir entre l'essai et l'entreprise) : l'accueil ne la repropose pas, comme la
    // v10 après la sienne (`porteVue`).
    if (bridge.assistantDemande && bridge.assistantDemande()) {
      visitesPoser(e => { e.accueilVu = true; });
      if (!data.company.setupDone && !data.company.setupStarted) {
        data.company.setupStarted = true;
        data.company.setupStep = 0;
        save(true);
      }
    }
    const premierLancement = OB.needsSetup(data);
    if (premierLancement && estResponsable()) {
      const done = await runSetup();
      applyTheme();
      // Le premier message de l'application était un toast de deux secondes et demie, qui nommait
      // un onglet de Paramètres — une entrée de menu que l'utilisateur ne voyait même pas dans sa
      // barre latérale. Ce qu'il faut dire au premier lancement est maintenant dans le panneau
      // « Tes premiers pas », qui reste à l'écran et dont chaque ligne est cliquable.
      if (done === true) toast('C\'est prêt.');
      decouvrirDabord = done === 'decouvrir';
    }
    // La licence se lit AVANT le premier dessin — hors ligne, instantané, jamais renvoyé nulle part —
    // et avec le matricule de la société, parce qu'une clé est émise pour UNE entreprise. Elle dit
    // aussi si ce poste est celui de l'éditeur : la barre en dépend.
    await rafraichirLicence();
    // …et se relit toutes les heures et au retour au premier plan : SkanFact reste ouvert des jours
    // entiers, et un état lu une fois au démarrage se périme (7.1.x) — sans ça, un essai ne se
    // terminait jamais tant que l'application n'était pas relancée.
    // 10.14.0 — une commande passée depuis l'application se redemande au même moment : on revient de
    // la page de paiement du navigateur, c'est le retour au premier plan, et la clé est là.
    const relireLicence = () => rafraichirLicence().then(() => {
      redessinerBarre(); if (location.hash === '#/parametres') drawLicencePanel();
      if (licence && licence.commande) verifierAchat(false);
    });
    setInterval(relireLicence, 60 * 60 * 1000);
    window.addEventListener('focus', relireLicence);
    // (plateforme, lot messagerie) Ce qui attend dans le fil du cabinet, relu toutes les 30 secondes tant que la page est
    // visible : la pastille de « Mon comptable », et l'entrée elle-même (elle paraît avec le mandat). Un rôle qui n'écrit
    // pas au cabinet ne la voit jamais, et on ne redemande plus.
    if (bridge.messagerie) {
      let sansMessagerie = false;
      const suivreMessagerie = async () => {
        if (sansMessagerie || document.visibilityState !== 'visible') return;
        try { majMessagerie(await bridge.messagerie.attente()); } catch (e) { if (e && e.statut === 403) { sansMessagerie = true; majMessagerie(null); } }
      };
      void suivreMessagerie();
      setInterval(suivreMessagerie, 30 * 1000);
      document.addEventListener('visibilitychange', () => { void suivreMessagerie(); });
    }
    // (plateforme, Support S1) Ce qui attend au support (une réponse de l'équipe à lire), relu toutes les minutes tant que
    // la page est visible, et tout de suite après un envoi. Une personne sans rôle dans l'entreprise n'a pas de support
    // ici : on ne redemande plus.
    if (bridge.support) {
      let sansSupport = false;
      relireSupport = async () => {
        if (sansSupport || document.visibilityState !== 'visible') return;
        try { bridge.support.noter(await bridge.support.attente()); } catch (e) { if (e && e.statut === 403) { sansSupport = true; bridge.support.noter(null); } }
      };
      void relireSupport();
      setInterval(() => { void relireSupport(); }, 60 * 1000);
      document.addEventListener('visibilitychange', () => { void relireSupport(); });
    }
    if (licence && licence.commande) verifierAchat(false);
    // La copie de sauvegarde externe ne vit pas dans les données : on la lit une fois ici pour que
    // « Tes premiers pas » sache si l'étape est faite. Un échec n'empêche rien : l'étape s'affiche
    // simplement comme à faire.
    bridge.externalBackupInfo().then(i => {
      const avant = copieExterne, avantPartage = dossierPartage;
      copieExterne = !!(i && i.dir && !i.lastError);   // une copie en échec ne coche pas l'étape
      dossierPartage = !!(i && i.partage);
      if ((copieExterne !== avant || dossierPartage !== avantPartage) && location.hash === '#/dashboard') render(true);
    }).catch(() => {});
    $('#brand-company').textContent = data.company.name || 'Ton entreprise';
    accorderNomDossier();
    // La recherche générale, enfin visible et cliquable. La touche est écrite sur le bouton : c'est
    // ainsi qu'on apprend un raccourci — en le lisant là où on cliquerait de toute façon.
    if ($('#nav-search')) {
      $('#nav-search-k').textContent = SUR_MAC ? '⌘K' : 'Ctrl K';
      $('#nav-search').onclick = () => openPalette();
    }
    bridge.updateVersion().then(v => {
      upd.app = v; const el = $('#app-version'); if (el) el.textContent = 'v' + v.version;
      // (plateforme) L'envoi qui tourne, au survol du numéro (serveur/ecrans.ts).
      if (el && v.envoi) el.title = 'Envoi ' + v.envoi;
      // Le repère se pose sur la VERSION INSTALLÉE, jamais sur le canal choisi : ce qui compte,
      // c'est ce qui tourne. Quelqu'un qui vient de décocher la case tourne encore sur une bêta.
      const tag = $('#beta-tag'); if (tag) tag.hidden = !C.estBeta(v.version);
      // Les nouveautés de la version, dites en phrases de tous les jours, au premier lancement (10.14.1,
      // S-06). Une installation neuve n'a rien qui change ; l'écran doit être libre (ni fenêtre, ni
      // assistant, ni visite) — la carte attend son tour, elle ne passe jamais par-dessus une question.
      const presentee = typeof Nouveautes !== 'undefined' && !bridge.sansNouveautesV10 && Nouveautes.presenter({
        app: 'entreprise', nomApp: 'SkanFact', version: v.version,
        installationNeuve: premierLancement || (!data.company.name && !(data.documents || []).length && !(data.clients || []).length),
        peutMontrer: () => !$('.modal-bg') && !$('#setup') && !(typeof Visite !== 'undefined' && Visite.enCours())
      });
      if (v.lastUpdate) {
        if (v.lastUpdate.ok && !presentee) toast('SkanFact mis à jour en version ' + v.version);
        else modal(`<h2>Mise à jour non installée</h2><p>${h(v.lastUpdate.message || 'Erreur inconnue')}.</p><p class="small muted">Tu peux installer la nouvelle version à la main depuis la page des versions, ou réessayer depuis Paramètres → L'application → Mises à jour.</p>
          <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn btn-primary" id="open-rel">Voir les versions</button></div>`, (root) => { $('#open-rel', root).onclick = () => bridge.updateOpenReleases(); });
      }
    });
    $('#update-pill').onclick = () => allerParametres('app', 'p-maj');
    $('#lic-banner').onclick = () => allerParametres('app', 'p-licence');
    if (!location.hash) location.hash = '#/dashboard';
    render();
    if (decouvrirDabord) decouvrirDepuisLaPorte();
    // (plateforme) La visite demandée avant d'arriver ici — la porte « Découvrir », « Voir un exemple » d'une autre
    // entreprise, « Quitter l'exemple » — démarre une fois le dossier chargé : la découverte verse d'abord l'exemple s'il
    // manque (`lancerVisite`, puis `loadDemo`). « exemple » : l'exemple seul, sans visite.
    if (bridge.visiteDemandee) {
      const demandee = bridge.visiteDemandee();
      if (demandee === 'exemple') { if (!C.estDemo(data)) loadDemo(); }
      else if (demandee) lancerVisite(demandee);
    }
    if (bridge.ouvertureDemandee && bridge.ouvertureDemandee() === 'abonnement') allerAbonnement();
    if (loaded && loaded.corruptFile) {
      modal(`<h2>Fichier de données illisible</h2>
        <p>Le fichier de données n'a pas pu être lu. Il n'a pas été effacé : il a été renommé en<br><code>${h(loaded.corruptFile.split(/[\\/]/).pop())}</code>.</p>
        <p>Pour retrouver tes données : <strong>Importer</strong> puis choisis la sauvegarde la plus récente dans le dossier <code>backups</code>.</p>
        <div class="modal-actions"><button class="btn" data-close>Plus tard</button><button class="btn" id="c-open">Ouvrir le dossier des sauvegardes</button><button class="btn btn-primary" id="c-import">Importer une sauvegarde</button></div>`,
        (root, close) => { $('#c-open', root).onclick = () => bridge.openBackups(); $('#c-import', root).onclick = () => { close(); importAll(); }; });
    }
  })();
})();
