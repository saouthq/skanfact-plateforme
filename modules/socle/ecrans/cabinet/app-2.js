  function vueInventaire(dossier) {
    const s = livresState;
    const d = s.inv;
    if (!d) return `<div class="empty mini">Lecture de l'inventaire…</div>`;
    if (d.erreur) return lectureRatee(d.erreur, 'inv');
    const inv = d.inventaire;
    const v = d.variation || {};
    // 10.12.0 (U-11) — un seul vert, l'étape suivante. Sans inventaire, le geste vit dans l'état
    // vide, qui EST le corps de l'écran : deux « Saisir l'inventaire… » verts à quarante pixels
    // l'un de l'autre, c'était le même bouton montré deux fois. Une fois compté, le vert passe à
    // l'écriture de la variation, puis s'éteint : il n'y a plus rien à faire.
    const ecrivable = !!(inv && v.ok && v.ecriture && !inv.ecritureId);
    const suivante = ecrivable ? 'ecrire' : '';
    const cls = pas => 'btn btn-sm' + (pas === suivante ? ' btn-primary' : '');
    // U-23 — la raison d'un bouton éteint se lit à côté de lui : le panneau de la variation vient
    // donc JUSTE sous la barre (le résumé avant le détail), et sa ligne d'état est cette raison.
    // Sous deux cents lignes comptées, elle n'était plus « à côté » de rien.
    const pourquoi = !inv || ecrivable ? '' : inv.ecritureId ? 'L\'écriture de variation est passée : la repasser compterait le stock deux fois.' : (v.motif || '');
    // (1.319.0) L'état du stock que le client a envoyé depuis son SkanFact (le plus récent de l'année) : lu, jamais écrit ;
    // il se reprend comme inventaire d'un geste, au coût moyen et à la valeur de sa page Stock.
    const etat = (d.duClient || [])[0] || null;
    const commeLeClient = !!(inv && etat && inv.date === etat.date && Math.abs((Number(inv.total) || 0) - (Number(etat.total) || 0)) < 0.0005);
    // (1.320.0) Ce que le client avait reçu sans facture à cette date : la marchandise est dans le stock compté, sa charge dans
    // aucun livre. Elle se passe en factures non parvenues (607 / 408), au brouillard ; déjà passée, la ligne le dit.
    const sf = (etat && etat.sansFacture) || { total: 0, receptions: [] };
    const fnp = sf.receptions.length ? ecritureFnpDeLAnnee(s.livre, s.annee) : null;
    const blocSansFacture = !sf.receptions.length ? '' : `<div class="mt" id="iv-sans-facture">
        <p class="small"><b>Reçu sans facture</b> au ${esc(fmtJour(etat.date))} : ${esc(pl(sf.receptions.length, 'réception'))}, <b class="nw">${esc(money(sf.total))}</b> HT ${info('iv.sansFacture')}</p>
        <div class="scroll-x"><table class="list compact"><thead><tr><th>Réception</th><th>Fournisseur</th><th class="r nw">Hors taxes</th></tr></thead>
        <tbody>${sf.receptions.map(r => `<tr><td class="nw">${esc(r.numero || '—')} <span class="muted">· ${esc(fmtJour(r.date))}${r.commande ? ` · ${esc(r.commande)}` : ''}</span></td>
          <td class="tronq" title="${esc(r.fournisseur)}">${esc(r.fournisseur || '—')}</td><td class="r nw">${esc(money(r.ht))}</td></tr>`).join('')}</tbody></table></div>
        ${fnp ? `<p class="small ligne-ok" id="iv-fnp-ok"><span aria-hidden="true">✓</span> Passées en factures non parvenues (${esc(fnp.piece || fnp.numero || '')}, ${fnp.statut === 'validee' ? 'validée' : 'au brouillard'}) : au 1er janvier, « Extourner » sur l'écriture la retourne.</p>`
    : `<button class="btn btn-sm" id="iv-fnp">Passer en factures non parvenues…</button>`}
      </div>`;
    const panneauClient = !etat ? '' : `<div class="panel mt" id="iv-client"><h2>L'état du stock envoyé par ${esc(dossier.name || 'le client')} ${info('iv.client')}</h2>
        <p class="small">Au <b>${esc(fmtJour(etat.date))}</b> : ${esc(pl(etat.lignes.length, 'article'))}, <b class="nw">${esc(money(etat.total))}</b> au coût moyen de son SkanFact${
          etat.envoyeLe ? ` <span class="muted">· envoyé le ${esc(fmtJour(KC.jourDeLInstant(etat.envoyeLe)))}</span>` : ''}.</p>
        ${commeLeClient ? `<p class="small ligne-ok" id="iv-client-ok"><span aria-hidden="true">✓</span> L'inventaire de ${esc(s.annee)} est celui que le client a envoyé.</p>`
    : inv ? `<p class="small warn-text" id="iv-client-ecart">L'inventaire saisi (${esc(money(inv.total))} au ${esc(fmtJour(inv.date))}) n'est pas l'état envoyé par le client.</p>` : ''}
        ${commeLeClient ? '' : `<button class="btn btn-sm${inv ? '' : ' btn-primary'}" id="iv-reprendre-client">Le reprendre comme inventaire…</button>`}
        ${blocSansFacture}
      </div>`;
    // (1.321.0) L'état des impayés que le client a envoyé : ce qu'il sait de ses clients (relances, litiges), que les livres ne
    // disent pas. Une facture contestée ou très en retard se provisionne d'ici ; déjà provisionnée, la ligne le dit. Ce que dit
    // le client se lit sous son nom (une colonne à part écrasait le nom et le litige).
    const imp = d.impayes || null;
    const aProvisionner = l => !!l.litige || (Number(l.retard) || 0) > 90;
    const panneauImpayes = !imp || !(imp.lignes || []).length ? '' : `<div class="panel mt" id="iv-impayes"><h2>Les impayés de ${esc(dossier.name || 'du client')} ${info('iv.impayes')}</h2>
        <p class="small">${esc(pl(imp.lignes.length, 'facture'))} en retard, <b class="nw">${esc(money(Number(imp.total) || 0))}</b> toutes taxes${
          Number(imp.contestees) ? `, dont ${esc(pl(Number(imp.contestees), 'contestée'))} par son client` : ''}${imp.envoyeLe ? ` <span class="muted">· envoyé le ${esc(fmtJour(KC.jourDeLInstant(imp.envoyeLe)))}</span>` : ''}.</p>
        <div class="scroll-x"><table class="list compact" id="iv-impayes-t"><thead><tr><th>Facture</th><th>Client</th><th class="r nw">Retard</th><th class="r nw">Reste TTC</th>
          <th class="r nw">Reste HT</th><th class="nw">Relances</th><th></th></tr></thead>
        <tbody>${imp.lignes.map(l => { const prov = ecritureProvisionDe(s.livre, l.numero); return `<tr data-impaye="${esc(l.numero)}"><td class="nw">${esc(l.numero)} <span class="muted small">· échue le ${esc(fmtJour(l.echeance))}</span></td>
          <td>${esc(l.client || '—')}${l.litige ? `<div class="small warn-text"><b>Contestée</b> : ${esc(l.litige)}</div>` : ''}</td><td class="r nw">${esc(pl(Number(l.retard) || 0, 'jour'))}</td>
          <td class="r nw">${esc(money(Number(l.resteTTC) || 0))}</td><td class="r nw">${esc(money(Number(l.resteHT) || 0))}</td>
          <td class="nw">${Number(l.relances) ? `${esc(String(Number(l.relances)))}${l.derniereRelance ? ` <span class="muted small">· la dernière le ${esc(fmtJour(l.derniereRelance))}</span>` : ''}` : '<span class="muted">aucune</span>'}</td>
          <td class="nw">${prov ? `<span class="small ligne-ok"><span aria-hidden="true">✓</span> provisionnée (${esc(prov.piece)})</span>`
    : aProvisionner(l) ? `<button class="btn btn-sm" data-provision="${esc(l.numero)}">Provisionner…</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
      </div>`;
    // (1.322.0) Le parc sous garantie que le client a envoyé depuis sa page Garanties : les réparations qu'il fera gratuitement
    // sont une charge à venir que ses livres ne disent pas. Par article, ce qui est encore garanti ; « Provisionner les
    // garanties… » une fois pour l'exercice (déjà passée, la ligne le dit).
    const gar = d.garanties || null;
    const provGar = gar ? ecritureProvisionGarantiesDe(s.livre, s.annee) : null;
    const panneauGaranties = !gar || !(gar.articles || []).length ? '' : `<div class="panel mt" id="iv-garanties"><h2>Les garanties en cours chez les clients de ${esc(dossier.name || 'ce dossier')} ${info('iv.garanties')}</h2>
        <p class="small">${esc(pl(Number(gar.nombre) || 0, 'appareil'))} sous garantie au ${esc(fmtJour(gar.date))}, vendus <b class="nw">${esc(money(Number(gar.ht) || 0))}</b> hors taxes${
          Number((gar.annee || {}).nombre) ? ` · vendus avec une garantie dans l'année : ${esc(pl(Number(gar.annee.nombre), 'appareil'))}, ${esc(money(Number(gar.annee.ht) || 0))} HT` : ''}${gar.envoyeLe ? ` <span class="muted">· envoyé le ${esc(fmtJour(KC.jourDeLInstant(gar.envoyeLe)))}</span>` : ''}.</p>
        <div class="scroll-x"><table class="list compact" id="iv-garanties-t"><thead><tr><th>Article</th><th class="r nw">Appareils</th><th class="r nw">Vendus HT</th><th class="nw">Garantis jusqu'au</th></tr></thead>
        <tbody>${gar.articles.map(a => `<tr><td>${esc(a.libelle)}</td><td class="r nw">${esc(String(Number(a.nombre) || 0))}</td><td class="r nw">${esc(money(Number(a.ht) || 0))}</td><td class="nw">au plus tard le ${esc(fmtJour(a.fin))}</td></tr>`).join('')}</tbody></table></div>
        <div class="inline mt">${provGar ? `<span class="small ligne-ok" id="iv-gar-faite"><span aria-hidden="true">✓</span> Provision passée (${esc(provGar.piece)}) : la repasser compterait la charge deux fois.</span>`
    : `<button class="btn btn-sm" id="iv-gar-provision">Provisionner les garanties…</button>`}</div>
      </div>`;
    // (1.324.0) Les autres dossiers que le cabinet tient et qui sont du même groupe (l'un client ou fournisseur de l'autre) :
    // ce qu'ils se sont vendu sur l'exercice, à retirer d'un ensemble consolidé, et ce que l'un doit à l'autre selon les livres
    // de chacun, l'écart et les pièces qui l'expliquent : la même phrase que la page Groupe de l'entreprise.
    const grp = d.groupe || null;
    const nomGrp = id => id === dossier.id ? (dossier.name || 'ce dossier') : ((grp.societes || []).find(x => x.id === id) || {}).raisonSociale || '—';
    const zero = v => Math.abs(Number(v) || 0) < 0.0005;
    const lienSoeur = id => (id === dossier.id ? '' : `<a class="btn btn-sm" href="#/dossier/${esc(encodeURIComponent(id))}/comptabilite/inventaire/${esc(String(s.annee))}">Ouvrir ${esc(nomGrp(id))}</a>`);
    const paireGrp = p => `<div class="iv-paire" data-paire="${esc(p.creancier)}:${esc(p.debiteur)}"><p class="small"><b>Ce que ${esc(p.debiteurNom)} doit à ${esc(p.creancierNom)}</b> : selon ${esc(p.creancierNom)}, <b class="nw">${esc(money(Number(p.selonCreancier)))}</b> ; selon ${esc(p.debiteurNom)}, <b class="nw">${esc(money(Number(p.selonDebiteur)))}</b>.</p>
        ${zero(p.ecart) ? '<p class="small ligne-ok"><span aria-hidden="true">✓</span> Les deux livres disent le même montant.</p>'
    : `<p class="small warn-text">Écart de <b class="nw">${esc(money(Math.abs(Number(p.ecart))))}</b>${p.pieces.length ? ' :' : '.'}</p>${p.pieces.length ? `<ul class="small iv-pieces">${p.pieces.map(x => `<li>${esc(KC.phraseEntreSocietes(x, nomGrp, v => money(Number(v))))}</li>`).join('')}</ul>` : ''}${
      Number(p.autres) ? `<p class="small muted">… et ${esc(pl(Number(p.autres), 'autre pièce'))}.</p>` : ''}${zero(p.reste) ? '' : `<p class="small muted">Le reste de l'écart (${esc(money(Math.abs(Number(p.reste))))}) ne vient d'aucune pièce : un règlement noté d'un seul côté, ou une écriture passée sans la fiche du tiers.</p>`}
        <div class="inline">${lienSoeur(p.creancier)}${lienSoeur(p.debiteur)}</div>`}</div>`;
    const panneauGroupe = !grp || !((grp.ventes || []).length || (grp.paires || []).length) ? '' : `<div class="panel mt" id="iv-groupe"><h2>Les sociétés du même groupe que ${esc(dossier.name || 'ce dossier')} ${info('iv.groupe')}</h2>
        <p class="small">Au ${esc(fmtJour(grp.jour))}, tu tiens aussi ${esc((grp.societes || []).map(x => x.raisonSociale).join(', '))}.</p>
        ${(grp.ventes || []).length ? `<p class="small"><b>Ventes de l'exercice entre elles</b> (hors taxes, à retirer d'un chiffre d'affaires consolidé) : ${grp.ventes.map(v => `${esc(v.deNom)} → ${esc(v.versNom)} <b class="nw">${esc(money(Number(v.caExercice)))}</b>`).join(' · ')}.</p>` : ''}
        ${(grp.paires || []).map(paireGrp).join('')}
      </div>`;
    return `<div class="filters">
      ${info('iv.etat')}
      <span class="small muted">Exercice ${esc(s.annee)}</span>
      ${inv ? `<button class="${cls('reprendre')}" id="iv-saisir">Reprendre l'inventaire…</button>
      <button class="${cls('ecrire')}" id="iv-ecrire" ${ecrivable ? '' : 'disabled'}
        title="${esc(pourquoi)}">Écrire la variation de stock</button>` : ''}
    </div>
    ${panneauClient}
    ${panneauImpayes}
    ${panneauGaranties}
    ${panneauGroupe}
    ${!inv
    ? `<div class="empty">Aucun inventaire saisi pour ${esc(s.annee)}.
        <p class="small muted">Un inventaire, c'est ce qui reste au dernier jour, compté et valorisé.
        La différence avec ce que portent les comptes devient une écriture <span class="nw">(${esc(KC.COMPTES_IMMO.variationStocks)} / ${esc(KC.COMPTES_IMMO.stocks)})</span>.</p>
        <button class="btn${etat ? '' : ' btn-primary'}" id="iv-saisir2">Saisir l'inventaire…</button>
        <div class="small mt">${lienArticle('immobilisations')}</div></div>`
    : `<div class="panel mt" id="iv-variation"><h2>La variation ${info('iv.variation')}</h2>
        ${v.ok
    ? `<table class="list compact"><tbody>
            <tr><td>Stock aux comptes à l'ouverture</td><td class="r nw">${esc(money(v.initial))}</td></tr>
            <tr><td>Stock compté au ${esc(fmtJour(inv.date))}</td><td class="r nw">${esc(money(v.final))}</td></tr>
            <tr class="dc-total"><td><b>Variation</b></td><td class="r nw"><b>${esc(money(v.ecart))}</b></td></tr></tbody></table>
          ${/* U-13 — un état NORMAL se dit sur une ligne grise avec sa coche : « rien à écrire » et
                « déjà passée » ne demandent aucun geste, ils ne méritent pas un encadré vert qui pèse
                autant qu'une alerte. */''}
          ${pourquoi ? `<p class="small ligne-ok mt" id="iv-motifs"><span aria-hidden="true">✓</span> ${esc(pourquoi)}</p>`
    : `<p class="small muted mt">Le stock ${v.ecart > 0 ? 'augmente' : 'diminue'} :
              on ${v.ecart > 0 ? 'débite' : 'crédite'} le stock et on ${v.ecart > 0 ? 'crédite' : 'débite'} la variation.
              L'écriture arrive en <b>brouillard</b>, au ${esc(fmtJour(inv.date))}.</p>`}`
    : `<div class="warn-box">${esc(v.motif || '')}</div>`}
      </div>
      <div class="panel mt"><h2>Ce qui a été compté au ${esc(fmtJour(inv.date))} ${info('iv.lignes')}</h2>
        <div class="scroll-x"><table class="list compact"><thead><tr><th class="nw">Réf.</th><th>Désignation</th>
          <th class="r nw">Quantité</th><th class="r nw">Coût unitaire</th><th class="r nw">Valeur</th></tr></thead>
        <tbody>${inv.lignes.map(l => `<tr><td class="nw">${esc(l.ref)}</td>
          <td class="tronq" title="${esc(l.libelle)}">${esc(l.libelle)}</td>
          <td class="r nw">${esc(String(l.quantite).replace('.', ','))}</td><td class="r nw">${esc(money(l.cout))}</td>
          <td class="r nw">${esc(money(l.valeur))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">${esc(pl(inv.lignes.length, 'ligne comptée', 'lignes comptées'))}</th>
          <th class="r nw">${esc(money(inv.total))}</th></tr></tfoot></table></div></div>`}`;
  }

  function brancherInventaire(el, root, dossier) {
    const s = livresState;
    const rev = revDuLivre(s.livre);
    if (!s.inv || s.invRev !== rev) { s.invRev = rev; chargerInventaire(root, dossier); return; }
    if (s.inv.erreur) return;
    [$('#iv-saisir', el), $('#iv-saisir2', el)].forEach(b => { if (b) b.onclick = () => inventaireForm(root, dossier); });
    const rc = $('#iv-reprendre-client', el);
    if (rc) rc.onclick = () => inventaireForm(root, dossier, (s.inv.duClient || [])[0] || null);
    $$('[data-provision]', el).forEach(b => {
      b.onclick = () => {
        const l = ((s.inv.impayes || {}).lignes || []).find(x => x.numero === b.dataset.provision);
        if (l) provisionForm(root, dossier, l);
      };
    });
    const gb = $('#iv-gar-provision', el);
    if (gb) gb.onclick = () => provisionGarantiesForm(root, dossier, s.inv.garanties);
    const fb = $('#iv-fnp', el);
    if (fb) fb.onclick = () => facturesNonParvenuesForm(root, dossier, (s.inv.duClient || [])[0] || null);
    const ec = $('#iv-ecrire', el);
    if (ec) ec.onclick = async () => {
      ec.disabled = true;
      try {
        const r = await api.ecrireVariationStock({ dossierId: dossier.id, annee: s.annee });
        s.livre = r.livre; toast('Variation de stock passée en brouillard.');
        await chargerInventaire(root, dossier);
      } catch (err) { toast(plainError(err), 'error'); ec.disabled = false; }
    };
  }

  // (1.320.0) L'écriture des factures non parvenues de l'année, si elle est passée et compte encore (ni contre-passée, ni
  // supprimée) : sa pièce est FNP-<année>, celle que pose `facturesNonParvenuesForm`.
  function ecritureFnpDeLAnnee(livre, annee) {
    return ((livre && livre.ecritures) || []).find(e => e.piece === `FNP-${annee}` && !e.contrepassee && e.statut !== 'contrepassee') || null;
  }
  // (1.321.0) La provision d'une facture du client, si elle est passée et compte encore : sa pièce est PROV-<numéro>.
  function ecritureProvisionDe(livre, numero) {
    return ((livre && livre.ecritures) || []).find(e => e.piece === `PROV-${numero}` && !e.contrepassee && e.statut !== 'contrepassee') || null;
  }
  // Le montant se retient ici (hors taxes, au plus ce qui reste dû) ; l'écriture se montre avant, et arrive au brouillard.
  function provisionForm(root, dossier, ligne) {
    const s = livresState;
    const au = (s.livre && s.livre.exercice && s.livre.exercice.au) || `${s.annee}-12-31`;
    modal(`<h2>Provisionner ${esc(ligne.numero)}</h2>
      <p class="small muted">${esc(ligne.client || 'Le client')} doit encore ${esc(money(Number(ligne.resteTTC) || 0))} toutes taxes
      (${esc(money(Number(ligne.resteHT) || 0))} hors taxes), en retard de ${esc(pl(Number(ligne.retard) || 0, 'jour'))}${ligne.litige ? `, et la conteste : « ${esc(ligne.litige)} »` : ''}.
      La provision se passe au ${esc(fmtJour(au))}, hors taxes.</p>
      <form id="pv" class="grid-2"><label class="field obligatoire">${lbl('Provision retenue (hors taxes)', 'iv.impayes')}
        <input name="montant" inputmode="decimal" value="${esc(montantChamp(Number(ligne.resteHT) || 0))}"></label></form>
      <div class="scroll-x"><table class="list compact mt" id="pv-lignes"><thead><tr><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead><tbody></tbody></table></div>
      <div id="pv-motif" class="small annonce-stable"></div>
      <p class="small muted mt">Elle arrive au <b>brouillard</b> (pièce PROV-${esc(ligne.numero)}) : relis-la, puis valide-la. Elle ne s'extourne pas : elle se reprend quand le risque disparaît. Comptes à vérifier avec ton plan.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Passer au brouillard</button></div>`,
    (rootModal, close) => {
      const lire = () => KC.ecritureProvisionCreance(ligne, ($('[name=montant]', rootModal) || {}).value, au);
      const maj = () => {
        const r = lire();
        $('#pv-lignes tbody', rootModal).innerHTML = r.ok ? r.ecriture.lignes.map(l => `<tr><td class="nw">${esc(l.compte)}</td><td>${esc(l.libelle)}</td>
          <td class="r nw">${l.debit ? esc(money(l.debit)) : ''}</td><td class="r nw">${l.credit ? esc(money(l.credit)) : ''}</td></tr>`).join('') : '';
        $('#pv-motif', rootModal).innerHTML = r.ok ? '' : `<div class="warn-box">${esc(r.motif)}</div>`;
        const b = $('#ok', rootModal); b.disabled = !r.ok; b.title = r.ok ? '' : r.motif;
      };
      $('[name=montant]', rootModal).oninput = maj;
      maj();
      $('#ok', rootModal).onclick = async () => {
        const r = lire();
        if (!r.ok) return toast(r.motif, 'error');
        const b = $('#ok', rootModal);
        b.disabled = true;
        try {
          if (ecritureProvisionDe(s.livre, ligne.numero)) throw new Error(`${ligne.numero} est déjà provisionnée (PROV-${ligne.numero}) : la reprovisionner compterait la charge deux fois.`);
          const res = await api.saisir(dossier.id, s.annee, r.ecriture);
          s.livre = res.livre; close();
          toast(`Provision de ${ligne.numero} passée au brouillard : ${money(r.montant)} au 491.`);
          await chargerInventaire(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); b.disabled = false; }
      };
    });
  }
  function ecritureProvisionGarantiesDe(livre, annee) {
    return ((livre && livre.ecritures) || []).find(e => e.piece === `PROV-GAR-${annee}` && !e.contrepassee && e.statut !== 'contrepassee') || null;
  }
  // (1.322.0) Le montant, c'est la comptable qui le juge : la case part vide (aucun taux inventé) ; l'écriture se montre avant.
  function provisionGarantiesForm(root, dossier, etat) {
    const s = livresState;
    modal(`<h2>Provisionner les garanties de ${esc(s.annee)}</h2>
      <p class="small muted">${esc(dossier.name || 'Le client')} a ${esc(pl(Number(etat.nombre) || 0, 'appareil'))} sous garantie au ${esc(fmtJour(etat.date))}, vendus ${esc(money(Number(etat.ht) || 0))} hors taxes.
      Les réparations qu'il fera gratuitement sont une charge de cet exercice : le montant, c'est toi qui le juges (ce que coûtent d'habitude ces réparations, pour ce qui reste à courir).</p>
      <form id="pg" class="grid-2"><label class="field obligatoire">${lbl('Provision retenue (hors taxes)', 'iv.garanties')}
        <input name="montant" inputmode="decimal" value="" placeholder="0,000"></label></form>
      <div class="scroll-x"><table class="list compact mt" id="pg-lignes"><thead><tr><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead><tbody></tbody></table></div>
      <div id="pg-motif" class="small annonce-stable"></div>
      <p class="small muted mt">Elle arrive au <b>brouillard</b> (pièce PROV-GAR-${esc(s.annee)}) : relis-la, puis valide-la. Elle se reprend quand la garantie a couru. Comptes à vérifier avec ton plan.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Passer au brouillard</button></div>`,
    (rootModal, close) => {
      const lire = () => KC.ecritureProvisionGaranties(etat, ($('[name=montant]', rootModal) || {}).value, s.annee);
      const maj = () => {
        const r = lire();
        $('#pg-lignes tbody', rootModal).innerHTML = r.ok ? r.ecriture.lignes.map(l => `<tr><td class="nw">${esc(l.compte)}</td><td>${esc(l.libelle)}</td>
          <td class="r nw">${l.debit ? esc(money(l.debit)) : ''}</td><td class="r nw">${l.credit ? esc(money(l.credit)) : ''}</td></tr>`).join('') : '';
        $('#pg-motif', rootModal).innerHTML = r.ok ? '' : `<div class="warn-box">${esc(r.motif)}</div>`;
        const ok = $('#ok', rootModal); ok.disabled = !r.ok; ok.title = r.ok ? '' : r.motif;
      };
      $('[name=montant]', rootModal).oninput = maj;
      maj();
      $('#ok', rootModal).onclick = async () => {
        const r = lire();
        if (!r.ok) return toast(r.motif, 'error');
        const b = $('#ok', rootModal);
        b.disabled = true;
        try {
          if (ecritureProvisionGarantiesDe(s.livre, s.annee)) throw new Error(`Les garanties de ${s.annee} sont déjà provisionnées (PROV-GAR-${s.annee}) : les reprovisionner compterait la charge deux fois.`);
          const res = await api.saisir(dossier.id, s.annee, r.ecriture);
          s.livre = res.livre; close();
          toast(`Provision pour garanties passée au brouillard : ${money(r.montant)} au 1512.`);
          await chargerInventaire(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); b.disabled = false; }
      };
    });
  }
  // Ce qui s'écrit, montré avant : la date, les comptes, les montants ; au brouillard, donc encore modifiable.
  function facturesNonParvenuesForm(root, dossier, etat) {
    const s = livresState;
    const r = KC.ecritureFacturesNonParvenues(etat, s.annee);
    if (!r.ok) return toast(r.motif, 'error');
    const e = r.ecriture;
    modal(`<h2>Les factures non parvenues de ${esc(s.annee)}</h2>
      <p class="small muted">${esc(dossier.name || 'Le client')} a reçu cette marchandise sans sa facture : elle est dans son stock compté, sa
      charge dans aucun livre. Elle devient une charge de ${esc(s.annee)}, au ${esc(fmtJour(e.date))}.</p>
      <div class="scroll-x"><table class="list compact" id="fnp-lignes"><thead><tr><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead>
      <tbody>${e.lignes.map(l => `<tr><td class="nw">${esc(l.compte)}</td><td>${esc(l.libelle)}</td><td class="r nw">${l.debit ? esc(money(l.debit)) : ''}</td>
        <td class="r nw">${l.credit ? esc(money(l.credit)) : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted mt">Elle arrive au <b>brouillard</b> (pièce ${esc(e.piece)}) : relis-la, change le compte de charge s'il le faut, puis valide-la.
      Au 1er janvier, « Extourner » sur l'écriture la retourne, et la vraie facture prend sa place. La TVA de ces factures n'y est pas.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Passer au brouillard</button></div>`,
    (rootModal, close) => {
      $('#ok', rootModal).onclick = async () => {
        const b = $('#ok', rootModal);
        b.disabled = true;
        try {
          if (ecritureFnpDeLAnnee(s.livre, s.annee)) throw new Error(`Les factures non parvenues de ${s.annee} sont déjà passées (FNP-${s.annee}) : les repasser compterait la charge deux fois.`);
          const res = await api.saisir(dossier.id, s.annee, e);
          s.livre = res.livre; close();
          toast(`Factures non parvenues passées au brouillard : ${money(r.total)} au 408.`);
          await chargerInventaire(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); b.disabled = false; }
      };
    });
  }

  async function chargerInventaire(root, dossier) {
    const s = livresState;
    try { s.inv = await api.inventaire({ dossierId: dossier.id, annee: s.annee }); }
    catch (e) { s.inv = { erreur: plainError(e) }; }
    s.invRev = revDuLivre(s.livre);
    drawLivres(root, dossier);
  }

  function inventaireForm(root, dossier, depuisLeClient) {
    const s = livresState;
    const dejaLa = (s.inv && s.inv.inventaire) || null;
    // (1.319.0) Repris de l'état envoyé par le client : ses lignes, sa date, et la valeur de chaque ligne (cinquième colonne :
    // le coût moyen exact de son SkanFact, dont le coût unitaire n'est que l'arrondi au millime).
    const source = depuisLeClient ? { date: depuisLeClient.date, compte: dejaLa && dejaLa.compte, lignes: depuisLeClient.lignes.map(l => ({ ...l, valeurDite: true })) } : dejaLa;
    const colonnes = l => [l.ref, l.libelle, String(l.quantite).replace('.', ','), montantChamp(l.cout) || '0'].concat(l.valeurDite ? [montantChamp(l.valeur) || '0'] : []).join('\t');
    // On saisit en COLLANT une liste depuis un tableur : ligne par ligne dans un formulaire,
    // personne ne compterait deux cents références (même règle que les dossiers collés, 6.8.0).
    // Ce qu'on rouvre se relit en français (H-3) : « 7.5 » dans une liste de coûts, c'est sept
    // mille cinq cents pour qui lit « 7.500 ». Le moteur relit les deux formes.
    const depart = source ? source.lignes.map(colonnes).join('\n') : '';
    modal(`<h2>L'inventaire de ${esc(s.annee)}</h2>
      <p class="small muted">Une ligne par référence : <b>référence, désignation, quantité, coût unitaire</b> (et, si tu l'as, sa
      <b>valeur</b>), séparées par une tabulation ou un point-virgule. Colle-les depuis ton tableur.</p>
      ${depuisLeClient ? `<p class="small ligne-ok" id="iv-repris"><span aria-hidden="true">✓</span> Repris de l'état envoyé par ${esc(dossier.name || 'le client')} au ${esc(fmtJour(depuisLeClient.date))} : la dernière colonne est la valeur au coût moyen de son SkanFact.</p>` : ''}
      <form id="iv" class="grid-2">
        <label class="field obligatoire">${lbl('Date de l\'inventaire', 'iv.date')}
          <input name="date" placeholder="31/12/${esc(s.annee)}" value="${esc(fmtJour((source && source.date) || (s.livre.exercice.au || '')))}"></label>
        <label class="field">${lbl('Compte de stock', 'iv.compte')}
          <input name="compte" value="${esc((dejaLa && dejaLa.compte) || KC.COMPTES_IMMO.stocks)}"></label>
      </form>
      <label class="field mt">${lbl('Les lignes comptées', 'iv.coller')}
        <textarea id="iv-lignes" rows="10" placeholder="REF-01&#9;Câble HDMI 2 m&#9;24&#9;7,500">${esc(depart)}</textarea></label>
      ${/* 10.14.1 — le total ou le refus paraît à la première frappe : sans hauteur réservée,
            « Enregistrer l'inventaire » descendait de 54 px sous le curseur. */''}
      <div id="iv-apercu" class="small muted annonce-stable encadre"></div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Enregistrer l'inventaire</button></div>`,
    (rootModal, close) => {
      const apercu = $('#iv-apercu', rootModal);
      // Les lignes sont lues par le MOTEUR (`lignesInventaireDepuisTexte`) : c'est lui qui refuse
      // une quantité illisible (C-16), et l'écran dit ce qu'il refuse — jamais un zéro en silence.
      // La date se tape comme partout ailleurs, « 31/12/2026 », et se range en ISO.
      const lire = () => {
        const r = KC.lignesInventaireDepuisTexte($('#iv-lignes', rootModal).value || '');
        const dateTape = (($('[name=date]', rootModal) || {}).value || '').trim();
        return {
          date: K.dateTapee(dateTape, s.annee, `${s.annee}-12`) || dateTape,
          compte: (($('[name=compte]', rootModal) || {}).value || '').trim(),
          lignes: r.lignes, refus: r.refus
        };
      };
      const maj = () => {
        const inv = lire();
        const v = KC.inventaireValide(inv);
        // U-13 — le refus attend le premier geste : « un inventaire sans une seule ligne… » en
        // orange sur une fenêtre qu'on vient d'ouvrir, c'était reprocher ce qu'on n'a pas encore eu
        // le temps de faire. Le bouton éteint dit déjà pourquoi, au survol et sous le doigt.
        apercu.innerHTML = v.ok
          ? `<div class="ok-box mt">${esc(pl(inv.lignes.length, 'ligne'))} — total ${esc(money(KC.totalInventaire(inv)))}.</div>`
          : !touche ? ''
            : `<div class="warn-box mt">${v.motifs.slice(0, 5).map(m => `<div>${esc(m)}</div>`).join('')}${v.motifs.length > 5 ? `<div>… et ${v.motifs.length - 5} de plus.</div>` : ''}</div>`;
        const b = $('#ok', rootModal);
        b.disabled = !v.ok; b.title = v.ok ? '' : v.motifs[0];
      };
      let touche = !!source;
      $$('input,textarea', rootModal).forEach(x => { x.oninput = () => { touche = true; maj(); }; });
      maj();
      $('#ok', rootModal).onclick = async () => {
        try {
          const inv = lire();
          const v = KC.inventaireValide(inv);
          if (!v.ok) return toast(v.motifs[0], 'error');
          delete inv.refus;
          const r = await api.saveInventaire({ dossierId: dossier.id, annee: s.annee, inventaire: inv });
          s.livre = r.livre; close(); toast('Inventaire enregistré.');
          await chargerInventaire(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }

  // ---------------------------------------------------------------- la banque (9.5.0)
  //
  // Le rapprochement, et lui seul : le lettrage vit dans l'onglet d'à côté, avec son propre modèle
  // et ses propres tests. Confondre les deux est l'erreur de vocabulaire la plus courante de ce
  // métier, et un écran qui les mélange la rend définitive.
  // (plateforme) 1.206.0 — la Banque refaite comme la maquette (docs/maquettes/cabinet/comptabilite.html, états « Banque… ») :
  // un seul écran, deux colonnes. À gauche le relevé, rangé par ce que chaque ligne DEMANDE (proposées, à traiter, en
  // attente du client, rapprochées repliées), chaque ligne avec sa nature (une icône), sa proposition et pourquoi ; à
  // droite le livre en face de la ligne choisie (les écritures du même montant, la recherche, l'écart, un seul bouton
  // principal). ↑ ↓ changent de ligne, Espace coche, Entrée fait le geste principal, « / » cherche. En bas, l'écart du
  // relevé, toujours expliqué ou nommé. Le jugement reste celui du moteur (`candidatsDeLigne`, `ecritureProposee`,
  // `suspens`) : l'écran ne refait aucun calcul de son côté.
  // `pieces` : les factures cochées en face d'une ligne (1.208.0), une liste par ligne ; `toutes` : la ligne dont on montre
  // toutes les pièces non réglées (« Partager entre plusieurs pièces »).
  const banqueState = { importer: false, etat: '', etatJoint: null, regles: '', nouvelle: null, nouvelleVoir: false, releve: '', filtre: '', sel: '', coches: new Set(), voirFaites: false, cherche: '', choix: {}, pieces: {}, remise: {}, toutes: '', annonce: null, gestesReleve: null };

  const svgBq = (d, t = 16) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const BQ_IC = {
    entre: '<path d="M17 7 7 17"/><path d="M15 17H7V9"/>',
    sort: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
    prlv: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
    chq: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h12M6 14h5M15 14h3"/>',
    carte: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h3"/>',
    frais: '<path d="M18 6 6 18"/><circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/>',
    paie: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 14c1.4.7 2.3 2.4 2.6 4.5"/>',
    esp: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    doc: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
    attente: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    regle: '<path d="M4 6h10M4 12h7M4 18h10"/><path d="m16 15 2 2 4-4"/><circle cx="18" cy="7" r="2.5"/>',
    ok: '<path d="m5 12 5 5 9-10"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    loupe: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    stylo: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    lien: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    retour: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    alerte: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    banque: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    pdf: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'
  };
  const NAT_DIT = { entre: 'Virement reçu', sort: 'Virement émis', prlv: 'Prélèvement', chq: 'Chèque', carte: 'Paiement par carte', frais: 'Frais de la banque', paie: 'Salaires', esp: 'Versement d\'espèces' };
  // La nature d'un mouvement se lit dans son libellé, comme le comptable la lit ; le sens (le signe) départage le reste.
  function natureBq(libelle, montant) {
    const L = String(libelle || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (/^VIR(EMENT)?\s+SALAIRE|SALAIRES?\b/.test(L) && Number(montant) < 0) return 'paie';
    if (/^(FRAIS|AGIOS|COM(MISSION)?S?\b|INTERETS|TVA\s+SUR)/.test(L)) return 'frais';
    if (/^VERS(EMENT)?\b|ESPECES/.test(L)) return 'esp';
    if (/\bCHQ\b|CHEQUE|REMISE/.test(L)) return 'chq';
    if (/^PRLV|PRELEVEMENT/.test(L)) return 'prlv';
    if (/^CARTE|\bCB\b|\bTPE\b/.test(L)) return 'carte';
    return Number(montant) >= 0 ? 'entre' : 'sort';
  }
  const icNature = (libelle, montant) => {
    const k = natureBq(libelle, montant);
    return `<span class="bqx ${k === 'frais' ? 'frais' : Number(montant) >= 0 ? 'in' : 'out'}" title="${esc(NAT_DIT[k])}" aria-label="${esc(NAT_DIT[k])}">${svgBq(BQ_IC[k])}</span>`;
  };
  // Une écriture se nomme par sa pièce, comme la maquette (« FA-0919 ») : le code du journal devant (« BQ BQ-0922 ») se
  // répète sans rien dire. Sans pièce, le journal et la date la nomment.
  const pieceBq = e => (e ? String(e.piece || '').trim() || `${e.journal || ''} du ${fmtJour(e.date || '').slice(0, 5)}`.trim() : '');
  // Qui répond pour le client : le prénom de son contact (« En attente de Sarra »), sinon « du client ».
  const contactBq = dossier => prenomCl((dossier || {}).contact);
  const deClientBq = dossier => (contactBq(dossier) ? `de ${contactBq(dossier)}` : 'du client');
  const aClientBq = dossier => (contactBq(dossier) ? `à ${contactBq(dossier)}` : 'au client');
  // D'où vient un relevé, comme on le dit au comptable : « importé ce matin (Excel de la BIAT) ».
  function importeBq(R) {
    const f = String(R.fichier || '').toLowerCase();
    const fmt = /\.xlsx?$/.test(f) ? 'Excel' : /\.csv$/.test(f) ? 'CSV' : /\.ofx$/.test(f) ? 'OFX' : '';
    const de = fmt ? ` (${fmt}${R.banque ? ` de la ${R.banque}` : ''})` : '';
    if (!R.importeLe) return '';
    const t = new Date(R.importeLe);
    if (Number.isNaN(t.getTime())) return '';
    const jour = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const auj = new Date(), hier = new Date(auj.getTime() - 86400000);
    const h = t.getHours();
    const quand = jour(t) === jour(auj) ? (h < 12 ? 'ce matin' : h < 18 ? 'cet après-midi' : 'ce soir')
      : jour(t) === jour(hier) ? 'hier' : `le ${fmtJour(jour(t))}`;
    return `importé ${quand}${de}`;
  }
  // Un montant signé, comme sur le relevé : + en vert ce qui entre, − ce qui sort.
  const montantSigne = m => `<span class="bq-mt${Number(m) >= 0 ? ' in' : ''}">${Number(m) >= 0 ? '+ ' : '− '}${esc(montant(Math.abs(Number(m) || 0)).replace(/[\u202f\u00a0]/g, ' '))}</span>`;

  // Le mois d'un relevé, comme on le nomme : « septembre 2026 », ou « 08/09 → 07/10 » s'il chevauche deux mois.
  const moisDuReleve = R => String(R.du || '').slice(0, 7) === String(R.au || '').slice(0, 7) && R.du
    ? `${moisLong(String(R.du).slice(0, 7))} ${String(R.du).slice(0, 4)}` : `${fmtJour(R.du)} → ${fmtJour(R.au)}`;
  // Un exercice clos ne se rapproche plus : la liste se lit, aucun geste ne s'offre.
  const lectureSeuleLivre = () => !!(livresState.livre && livresState.livre.exercice && livresState.livre.exercice.clos);
  const joursBanque = dossier => ((dossier.banque || {}).jours != null) ? dossier.banque.jours : KC.RELEVE_JOURS;
  // (1.208.0) Les taux de retenue à la source que le cabinet a réglés (« Les règles de la banque ») : aucun par défaut, et
  // alors aucune ligne ne se lit « au net de sa retenue ».
  const tauxRetenueBq = () => (Array.isArray(S.tauxRetenue) ? S.tauxRetenue : []).map(Number).filter(t => t > 0 && t < 100);

  // Ce que chaque ligne du relevé DEMANDE. Une fonction, une table : la liste, les pastilles, le compteur de l'onglet
  // et le geste « Valider les N » la lisent ; écrits chacun de son côté, ils finiraient par ne plus dire le même chiffre.
  //   ok   : rapprochée (une écriture en face) ;
  //   att  : une question au client l'attend (posée depuis cette ligne, même compte, même montant, même mois) ;
  //   prop : une seule écriture du même montant, ou la plus probable : à confirmer d'un geste ;
  //   dec  : à traiter (plusieurs écritures égales, une règle qui propose l'écriture, ou rien en face).
  function lectureBanque(dossier, R) {
    const L = livresState.livre;
    const jours = joursBanque(dossier);
    const table = Array.isArray(S.libelles) ? S.libelles : [];
    const nom = nomDeCompte();
    const qs = (L.questions || []).filter(q => q.statut !== 'close');
    // (1.208.0) Les pièces encore ouvertes, lues une fois pour tout le relevé ; une pièce proposée à une ligne ne se propose
    // plus à une autre (deux virements du même client du même montant ne paient pas deux fois la même facture).
    const ouvertes = { 1: KC.piecesOuvertes(L, 1), [-1]: KC.piecesOuvertes(L, -1) };
    const proposees = new Set();
    // (1.299.0) Les écritures proposées en remise à une ligne ne se proposent plus à une autre (le même chèque ne fait pas
    // deux remises).
    const enRemise = new Set();
    const taux = tauxRetenueBq();
    return R.lignes.map(l => {
      const r = l.rapprochement || {};
      if (r.ecritureId) return { l, g: 'ok', e: ecritureDuLivre(L, r.ecritureId), rang: Number(r.ligne),
        autres: KC.facesDuRapprochement(r).slice(1).map(f => ({ e: ecritureDuLivre(L, f.ecritureId), rang: Number(f.ligne), ecritureId: f.ecritureId })) };
      const q = qs.find(x => String(x.compte || '') === String(R.compte) && String(x.periode || '') === String(l.date).slice(0, 7)
        && KC.round3(Math.abs(Number(x.montant) || 0) - Math.abs(Number(l.montant) || 0)) === 0);
      if (q) return { l, g: 'att', q, titre: q.statut === 'repondue' ? `${contactBq(dossier) || 'Le client'} a répondu` : `Question ${aClientBq(dossier)}`,
        pq: q.statut === 'repondue' ? 'à écrire d\'après sa réponse' : `posée le ${fmtJour(KC.jourDeLInstant(q.creeLe || 0))}`, ton: 'q' };
      const jug = KC.candidatsDeLigne(L, R.id, l.id, { jours });
      if ((jug.niveau === 'certain' || jug.niveau === 'probable') && jug.meilleur) {
        const c = jug.meilleur, e = ecritureDuLivre(L, c.ecritureId);
        return { l, g: 'prop', jug, c, titre: `${pieceBq(e)}${c.libelle ? `${pieceBq(e) ? ' · ' : ''}${c.libelle}` : ''}`, pq: pourquoiBq(l, c, jug.niveau), ton: 'sur' };
      }
      if (jug.niveau === 'a-confirmer') return { l, g: 'dec', jug, titre: `${jug.candidats.length} écritures au même montant`, pq: 'rien ne les départage : à toi de choisir', ton: 'choix' };
      // (1.299.0) Une remise de chèques : aucune écriture seule, deux à quatre qui font la ligne au millime (le client les a
      // notées une par une). Une seule combinaison se propose ; plusieurs, c'est au comptable de cocher (plus bas).
      const rem = KC.remiseDeLigne(L, R.id, l.id, { jours });
      const cleE = c => c.ecritureId + '#' + c.ligne;
      if (rem.ecritures.length && !rem.ecritures.some(c => enRemise.has(cleE(c)))) {
        rem.ecritures.forEach(c => enRemise.add(cleE(c)));
        const noms = rem.ecritures.map(c => c.piece || pieceBq(ecritureDuLivre(L, c.ecritureId))).filter(Boolean);
        return { l, g: 'prop', jug, remise: rem.ecritures, titre: `Remise de ${rem.ecritures.length} écritures`, pq: `leur somme fait la ligne au millime${noms.length ? ` · ${noms.join(', ')}` : ''}`, ton: 'sur' };
      }
      // (1.208.0) Rien au compte de banque : la ligne paie peut-être une facture encore ouverte (la même, au net de sa
      // retenue, ou plusieurs qui font une remise de chèques). Une réponse unique se propose, comme une écriture trouvée.
      const rep = KC.reponsesDeLigne(L, R.id, l.id, { taux, ouvertes });
      const cleP = p => p.ecritureId + '#' + p.ligne;
      if (rep.proposees.length && !rep.proposees.some(p => proposees.has(cleP(p)))) {
        rep.proposees.forEach(p => proposees.add(cleP(p)));
        const p0 = rep.proposees[0];
        const titre = rep.proposees.length > 1 ? `${rep.proposees.map(p => p.piece || p.tiers).join(' · ')}` : `${p0.piece || 'Une facture'}${p0.tiers ? ` · ${p0.tiers}` : ''}`;
        return { l, g: 'prop', jug, rep, fact: rep.proposees, titre, pq: rep.pourquoi, ton: 'sur' };
      }
      if (rem.possibles.length) {
        return { l, g: 'dec', jug, rep, remisePossibles: rem.possibles, titre: `${rem.combinaisons > 2 ? 'Plusieurs remises' : 'Deux remises'} possibles`, pq: `${pl(rem.possibles.length, 'écriture')} en jeu : coche celles du bordereau`, ton: 'choix' };
      }
      const prop = KC.ecritureProposee(l, table, { compte: R.compte, journal: 'BQ' });
      if (prop.regle) {
        const c2 = prop.lignes[1].compte;
        return { l, g: 'dec', jug, rep, prop, titre: `${c2}${nom(c2) ? ` · ${nom(c2)}` : ''}`, pq: `sa règle « ${prop.regle} »`, ton: 'regle' };
      }
      return { l, g: 'dec', jug, rep, titre: 'Rien dans le livre en face', pq: `l'écrire, ou demander ${aClientBq(dossier)}`, ton: 'rien' };
    });
  }
  // Pourquoi une écriture est proposée : le montant, l'écart de jours, les mots que la banque et le livre partagent.
  function pourquoiBq(l, c, niveau) {
    const j = Math.abs(Math.round((Date.parse(l.date + 'T00:00:00Z') - Date.parse(c.date + 'T00:00:00Z')) / 86400000));
    // Un mot partagé ne dit quelque chose que s'il n'est pas un mot de banque (« virement », « reçu », « chèque »).
    const sansAcc = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mots = sansAcc(l.libelle).split(/[^a-z0-9]+/).filter(m => m.length >= 4 && !MOTS_BANQUE_BQ.includes(m) && sansAcc(c.libelle).includes(m));
    return [niveau === 'probable' ? 'même montant, la plus probable' : 'même montant', j ? pl(j, 'jour') + ' d\'écart' : 'même jour', mots.length ? `« ${mots[0]} »` : ''].filter(Boolean).join(' · ');
  }
  const MOTS_BANQUE_BQ = ['virement', 'recu', 'recue', 'emis', 'emise', 'cheque', 'cheques', 'remise', 'prelevement', 'prlv', 'paiement', 'reglement', 'carte', 'facture', 'compte', 'versement', 'banque', 'agence', 'tunis', 'mois'];
  const GROUPES_BQ = [['prop', 'Proposées · à confirmer'], ['dec', 'À traiter'], ['att', 'En attente du client']];
  // Le titre d'un groupe, avec le prénom du contact quand on le connaît (« En attente de Sarra »).
  const titreGroupeBq = (dossier, g, titre) => (g === 'att' ? `En attente ${deClientBq(dossier)}` : titre);
  // L'écart du relevé, comme la maquette l'écrit : relevé ± ce que le livre n'a pas encore ± ce que la banque n'a pas
  // encore passé = ce que le livre devrait dire. Les lignes du livre d'AVANT le premier relevé importé ne s'expliquent
  // par aucun relevé : elles se nomment à part, dans les pistes.
  // Les lignes sans écriture comptent sur TOUS les relevés du compte jusqu'à celui-ci (le chèque d'août resté sans pièce
  // pèse encore sur le solde de septembre) ; le livre d'avant le premier relevé est porté par le solde de début de ce
  // premier relevé.
  function ecartBanque(R) {
    const L = livresState.livre;
    const sus = KC.suspens(L, R.id);
    const rels = (L.releves || []).filter(x => x.compte === R.compte && String(x.du) <= String(R.au)).sort((a, b) => String(a.du).localeCompare(String(b.du)));
    const premierR = rels[0] || R, premier = premierR.du;
    // Pas encore au livre À LA DATE du relevé : sans écriture en face, ou rapprochée d'une écriture datée après (la banque
    // paie les salaires le 30/08, le livre les écrit le 31/08 : au 30/08, le livre ne les a pas encore). `ecritLe` le dit.
    // Une remise (1.299.0) est au livre quand sa DERNIÈRE écriture l'est.
    const ecritLe = l => KC.facesDuRapprochement(l.rapprochement).map(f => String((ecritureDuLivre(L, f.ecritureId) || {}).date || '')).sort().pop() || '';
    const banqueAll = rels.flatMap(x => x.lignes.map(l => ({ ...l, releve: x, ecritLe: ecritLe(l) }))
      .filter(l => !(l.rapprochement && l.rapprochement.ecritureId) || l.ecritLe > String(R.au)));
    const livreRec = sus.livre.filter(x => x.date >= premier);
    const sB = KC.round3(banqueAll.reduce((a, x) => a + Number(x.montant), 0));
    const sLr = KC.round3(livreRec.reduce((a, x) => a + x.montant, 0));
    const attendu = KC.round3(sus.soldeFin - sB + sLr);
    const nonExplique = KC.round3(attendu - sus.soldeComptable);
    const livreAvantPremier = KC.round3(KC.lignesBancaires(L, R.compte).filter(c => c.date < premier).reduce((a, c) => a + c.montant, 0));
    const ruptures = rels.slice(1).map((x, i) => ({ avant: rels[i], apres: x })).filter(p => KC.round3(Number(p.avant.soldeFin) - Number(p.apres.soldeDebut)));
    return { sus, premierR, premier, banqueAll, livreRec, sB, sLr, attendu, nonExplique, livreAvantPremier, ruptures };
  }

  function vueBanque(dossier) {
    const s = livresState;
    const releves = (s.livre.releves || []).slice().sort((a, b) => (b.du || '').localeCompare(a.du || ''));
    if (banqueState.importer) return '<div class="bq-ecran bqi-page" id="bqi"></div>';
    if (!releves.length) return banqueVide(dossier);
    // (1.217.0) Un mois choisi au ruban montre SON relevé ; sans relevé pour ce mois, l'écran le dit (maquette « bqvide »)
    // au lieu de garder celui d'un autre mois.
    const mBq = moisSx();
    const duMois = mBq ? releves.filter(r => String(r.du || '').slice(0, 7) <= mBq && String(r.au || r.du || '').slice(0, 7) >= mBq) : releves;
    if (mBq && !duMois.length && !banqueState.etat && !banqueState.regles) return banqueVide(dossier, mBq, releves);
    const R = duMois.find(r => r.id === banqueState.releve) || releves.find(r => r.id === banqueState.releve && (banqueState.etat === r.id || banqueState.regles === r.id)) || duMois[0] || releves[0];
    if (banqueState.releve !== R.id) { banqueState.releve = R.id; banqueState.sel = ''; banqueState.coches.clear(); banqueState.choix = {}; banqueState.pieces = {}; banqueState.remise = {}; }
    if (banqueState.etat === R.id) return vueEtatBq(dossier, R, ecartBanque(R), lectureSeuleLivre());
    if (banqueState.regles === R.id) return vueReglesBq(dossier, R, lectureSeuleLivre());
    const lus = lectureBanque(dossier, R);
    const n = g => lus.filter(x => x.g === g).length;
    const restent = lus.filter(x => x.g !== 'ok');
    // La ligne choisie : celle qu'on a choisie, sinon la première qui demande quelque chose, dans l'ordre des groupes.
    const ordre = GROUPES_BQ.flatMap(([g]) => lus.filter(x => x.g === g));
    if (!lus.some(x => x.l.id === banqueState.sel)) banqueState.sel = (ordre[0] || lus[0] || { l: {} }).l.id || '';
    const sel = lus.find(x => x.l.id === banqueState.sel);
    const f = banqueState.filtre;
    const voit = g => !f || f === g || (f === 'reste' && g !== 'ok');
    const lect = lectureSeuleLivre();
    const EC = ecartBanque(R);
    const regles = (Array.isArray(S.libelles) ? S.libelles : []).filter(x => x && x.motif && x.compte).length;
    const coches = [...banqueState.coches].filter(id => lus.some(x => x.l.id === id && x.g === 'prop'));
    const pastille = (c, k, t) => `<button type="button" class="bq-fc ${c}" data-bq-filtre="${c === 'tout' ? '' : c}" aria-pressed="${(c === 'tout' ? '' : c) === f}"><i></i><b>${k}</b> ${t}</button>`;
    const ligneTab = x => {
      const l = x.l, on = l.id === banqueState.sel;
      return `<tr class="bq-l${on ? ' on' : ''}" data-bq-ligne="${esc(l.id)}" data-groupe="${x.g}">
        <td class="bq-c">${x.g === 'prop' ? `<input type="checkbox" data-bq-coche="${esc(l.id)}"${banqueState.coches.has(l.id) ? ' checked' : ''} aria-label="Choisir ${esc(l.libelle)}">` : ''}</td>
        <td class="bq-d">${esc(fmtJour(l.date).slice(0, 5))}</td>
        <td><div class="bq-lb">${icNature(l.libelle, l.montant)}<div><span class="mono">${esc(l.libelle || '—')}</span>${x.g === 'ok'
          ? `<small class="bq-p">${svgBq(BQ_IC.ok, 12)} avec <b>${esc(pieceBq(x.e))}</b>${(x.autres || []).length ? ` et ${pl(x.autres.length, 'autre écriture', 'autres écritures')} (une remise)` : x.e && x.e.libelle ? ` · ${esc(x.e.libelle)}` : ''}${origineBq(x)}</small>`
          : `<small class="bq-p"><i class="bq-pt ${x.ton}"></i><b>${esc(x.titre)}</b> · ${esc(x.pq)}</small>`}</div></div></td>
        <td class="r">${montantSigne(l.montant)}</td>
        <td class="r bq-mc">${x.g === 'ok' && !lect ? `<button type="button" class="cp-plus bq-defaire1" data-bq-defaire="${esc(l.id)}" title="Défaire ce rapprochement : la ligne revient « À traiter », l'écriture reste">Défaire</button>` : RowMenu.bouton('LIG:' + l.id, '⋯', 'bq-menu btn-ghost')}</td></tr>`;
    };
    const carteTel = x => {
      const l = x.l;
      return `<div class="bq-k1${l.id === banqueState.sel ? ' on' : ''}" data-bq-ligne="${esc(l.id)}" data-groupe="${x.g}" role="button" tabindex="0">
        <div class="bq-k1h"><span class="bq-lb">${icNature(l.libelle, l.montant)}<span class="bq-d">${esc(fmtJour(l.date).slice(0, 5))}</span></span>${montantSigne(l.montant)}</div>
        <span class="mono">${esc(l.libelle || '—')}</span>${x.g === 'ok' ? `<small class="bq-p">${svgBq(BQ_IC.ok, 12)} avec <b>${esc(pieceBq(x.e))}</b>${(x.autres || []).length ? ` + ${x.autres.length}` : ''}</small>`
          : `<small class="bq-p"><i class="bq-pt ${x.ton}"></i><b>${esc(x.titre)}</b> · ${esc(x.pq)}</small>`}</div>`;
    };
    const valider = n('prop') && !lect ? `<button type="button" class="btn btn-sm" data-bq-valider>${svgBq(BQ_IC.ok, 14)} Valider ${coches.length ? `les ${coches.length} cochées` : n('prop') > 1 ? `les ${n('prop')}` : 'la proposée'}</button>` : '';
    const groupesTab = GROUPES_BQ.map(([g, titre]) => {
      const rs = lus.filter(x => x.g === g);
      if (!rs.length || !voit(g)) return '';
      return `<tr class="bq-g"><td colspan="5"><b>${esc(titreGroupeBq(dossier, g, titre))}</b> <span class="mu">${rs.length}</span>${g === 'prop' ? valider : ''}</td></tr>${rs.map(ligneTab).join('')}`;
    }).join('');
    const faites = lus.filter(x => x.g === 'ok');
    const ouvertes = banqueState.voirFaites || f === 'ok';
    const faitesTab = faites.length && voit('ok') ? `<tr class="bq-g bq-fait"><td colspan="5"><i class="bq-pt sur"></i><b>Rapprochées</b> <span class="mu">${faites.length}${resumeOrigines(faites)}</span>
      <button type="button" class="cp-plus bq-voir" id="bq-voir-faites" aria-expanded="${ouvertes}">${ouvertes ? 'Replier' : 'Les voir'} ${svgBq(BQ_IC.chev, 13)}</button></td></tr>${ouvertes ? faites.map(ligneTab).join('')
        + (lect ? '' : `<tr class="bq-plus"><td colspan="5"><button type="button" class="cp-plus" data-bq-defaire-tous>Défaire tous les rapprochements ${esc(moisDuReleve(R).includes('→') ? 'du relevé' : 'du mois')}</button></td></tr>`) : ''}` : '';
    const cartes = GROUPES_BQ.map(([g, titre]) => {
      const rs = lus.filter(x => x.g === g);
      return rs.length && voit(g) ? `<div class="bq-gm"><b>${esc(titreGroupeBq(dossier, g, titre))}</b> <span class="mu">${rs.length}</span>${g === 'prop' ? valider : ''}</div>${rs.map(carteTel).join('')}` : '';
    }).join('') + (faites.length && voit('ok') ? `<div class="bq-gm"><b>Rapprochées</b> <span class="mu">${faites.length}</span><button type="button" class="cp-plus bq-voir" data-bq-voir>${banqueState.voirFaites || f === 'ok' ? 'Replier' : 'Les voir'}</button></div>${banqueState.voirFaites || f === 'ok' ? faites.map(carteTel).join('') : ''}` : '');
    const toutFait = !restent.length && banqueState.revoir !== R.id;
    if (toutFait) {
      const mois = moisDuReleve(R).replace(/^./, c => c.toUpperCase());
      const att = lus.filter(x => x.g === 'att').length;
      const moisCourt = moisDuReleve(R).replace(/ \d{4}$/, '');
      const suivant = /^\d{4}-\d{2}/.test(String(R.au || '')) ? moisLong(moisSuivant(String(R.au).slice(0, 7))) : '';
      return `<div class="bq-ecran"><div class="bq-h"><div><b>Relevé ${esc(R.banque || 'de banque')} · ${esc(moisDuReleve(R))}</b><span class="mu">${pl(R.lignes.length, 'mouvement')}${importeBq(R) ? ` · ${esc(importeBq(R))}` : ''}</span></div></div>
        <div class="bq-fini2" role="status"><span class="bq-fini-ic">${svgBq(BQ_IC.ok, 22)}</span><b>${esc(mois)} est rapproché${R.banque ? ` à la ${esc(R.banque)}` : ''}</b>
          <p>${R.lignes.length - att} mouvements sur ${R.lignes.length} ont leur écriture.${att ? ` ${att > 1 ? `${att} attendent` : '1 attend'} la réponse ${esc(deClientBq(dossier))}, au compte d'attente (471) : rien ne bloque, cela se réglera de sa réponse.` : ''}</p>
          <div class="cp-gestes"><button type="button" class="btn btn-primary" data-bq-etat>L'état de rapprochement (PDF)</button>${lect ? '' : `<button type="button" class="btn" id="bq-import">Importer le relevé${suivant ? ` ${/^[aeiou]/i.test(suivant) ? 'd\'' : 'de '}${esc(suivant)}` : ''}…</button>`}<button type="button" class="btn btn-ghost" id="bq-revoir">Revoir ${esc(moisCourt)}</button></div>
          <span class="mu">Le Tableau de bord le dit : « banque à jour au ${esc(fmtJour(R.au).slice(0, 5))} ».</span></div>
        ${piedBanque(R, EC)}</div>`;
    }
    return `<div class="bq-ecran"><div class="bq-h"><div><b>Relevé ${esc(R.banque || 'de banque')} · ${esc(moisDuReleve(R))}
          <label class="bq-per" title="${releves.length > 1 ? `${releves.length} relevés` : 'Le relevé'}">${esc(R.compte)}${R.banque ? ` ${esc(R.banque)}` : ''} ${svgBq(BQ_IC.chev, 13)}
            <select id="bq-releve" aria-label="Le relevé à rapprocher">${releves.map(r => `<option value="${esc(r.id)}" ${r.id === R.id ? 'selected' : ''}>${esc(r.compte)}${r.banque ? ' ' + esc(r.banque) : ''} · ${esc(moisDuReleve(r))}</option>`).join('')}</select></label></b>
          <span class="mu" title="du ${esc(fmtJour(R.du))} au ${esc(fmtJour(R.au))}${R.fichier ? ` · ${esc(R.fichier)}` : ''}">${importeBq(R) ? `${esc(importeBq(R))} · ` : ''}${pl(R.lignes.length, 'mouvement')}</span></div>
        <button type="button" class="btn btn-sm" id="bq-regles" title="Les mots retenus : une ligne qui contient le mot se voit proposer le compte">Les règles${regles ? ` · ${regles}` : ''}</button>
        ${lect ? '' : '<button type="button" class="btn btn-sm" id="bq-import">Importer un relevé…</button>'}
</div>
      <div class="bq-f" role="group" aria-label="Montrer">${pastille('tout', R.lignes.length, 'Toutes')}${pastille('ok', n('ok'), 'Rapprochées')}${pastille('prop', n('prop'), 'Proposées')}${pastille('dec', n('dec'), 'À traiter')}${pastille('att', n('att'), `En attente ${deClientBq(dossier)}`)}
        ${EC.nonExplique ? `<button type="button" class="bq-fc ko" id="bq-vers-ecart" title="Voir en bas : les pistes">${svgBq(BQ_IC.alerte, 14)} <b>${esc(montant(Math.abs(EC.nonExplique)))}</b> d'écart non expliqué</button>` : ''}
        <span class="bq-j" aria-hidden="true">${[['ok', n('ok')], ['prop', n('prop')], ['dec', n('dec')], ['att', n('att')]].map(([c, k]) => `<i class="${c}" style="flex:${k}"></i>`).join('')}</span></div>
      ${!restent.length ? `<div class="bq-fini"><span class="bq-fini-ic">${svgBq(BQ_IC.ok, 22)}</span><div><b>${esc(moisDuReleve(R).replace(/^./, c => c.toUpperCase()))} est rapproché${R.banque ? ` à la ${esc(R.banque)}` : ''}</b>
          <p>${pl(R.lignes.length, 'mouvement')} sur ${R.lignes.length} ont leur écriture.</p></div><button type="button" class="btn btn-primary" data-bq-etat>L'état de rapprochement (PDF)</button></div>` : ''}
      ${banqueState.annonce && banqueState.annonce.sel === banqueState.sel ? `<div class="bq-toast" role="status" id="bq-annonce">${svgBq(BQ_IC.ok, 15)}<span>${(m => { const i = m.indexOf(' : '); return i > 0 ? `<b>${esc(m.slice(0, i))}</b> : ${esc(m.slice(i + 3))}` : esc(m); })(banqueState.annonce.msg)}</span>${banqueState.annonce.defaire && !lect ? '<button type="button" class="cp-plus" id="bq-annuler">Annuler</button>' : ''}</div>` : ''}
      <div class="bq2">
        <div class="bq-liste">
          <table class="list compact bq-t" data-sans-cartes><thead><tr><th></th><th>Date</th><th>La banque</th><th class="r">Montant</th><th></th></tr></thead><tbody>${groupesTab}${faitesTab}</tbody></table>
          <div class="bq-km">${cartes}</div>
          ${!groupesTab && !faitesTab ? '<div class="empty mini">Aucune ligne dans cet état.</div>' : ''}
          <p class="bq-aide"><kbd>↑</kbd> <kbd>↓</kbd> une ligne <span>·</span> <kbd>Espace</kbd> cocher <span>·</span> <kbd>Entrée</kbd> valider <span>·</span> <kbd>/</kbd> chercher <span>·</span> <kbd>⋯</kbd> les autres gestes</p>
        </div>
        ${sel ? livreEnFace(dossier, R, sel, lect) : ''}
      </div>
      ${piedBanque(R, EC)}</div>`;
  }

  // D'où viennent les rapprochées : d'office (l'automatique), à la main, et leurs écritures nées dans SkanFact.
  function resumeOrigines(faites) {
    const auto = faites.filter(x => (x.l.rapprochement || {}).par === 'auto').length;
    const sf = faites.filter(x => x.e && x.e.source === 'skanfact').length;
    const parts = [auto ? `${auto} d'office` : '', faites.length - auto ? `${faites.length - auto} à la main` : '', sf ? `${sf} depuis SkanFact` : ''].filter(Boolean);
    return parts.length ? ` · ${parts.join(', ')}` : '';
  }
  // (1.208.0, B6) D'où vient une rapprochée, comme la maquette : ce que son écriture paie ou porte (la paie du mois, le
  // versement de la caisse, l'encaissement ou le paiement de factures, la règle qui a proposé le compte), lu dans
  // l'écriture elle-même ; puis qui l'a posée (d'office, à la main).
  const quoiBq = x => {
    const e = x.e, l = x.l;
    if (!e) return '';
    // (1.299.0) Une remise : ce que portent TOUTES ses écritures (les trois chèques, pas le premier seul).
    const lignes = [e].concat((x.autres || []).map(f => f.e).filter(Boolean)).flatMap(y => y.lignes || []);
    const sur = c => lignes.some(z => String(z.compte || '').startsWith(c));
    const mois = String(e.date || '').slice(0, 7);
    if (e.journal === 'PAIE' || sur('421')) return /^\d{4}-\d{2}$/.test(mois) ? `la paie ${deMois(mois)}` : 'la paie';
    if (sur('54')) return 'versement de la caisse';
    const tiers = lignes.filter(z => /^4[01]1/.test(String(z.compte || '')));
    if (tiers.length) {
      const noms = tiers.map(z => (/lettre (\S+)/.exec(String(z.libelle || '')) || [])[1] || z.tiers || '').filter(Boolean);
      const quoi = Number(l.montant) >= 0 ? 'encaissement' : 'paiement';
      return noms.length ? `${quoi} de ${noms.length > 3 ? pl(noms.length, 'facture') : noms.join(', ')}` : '';
    }
    const regle = (Array.isArray(S.libelles) ? S.libelles : []).filter(z => z && z.motif && z.compte && String(l.libelle || '').toUpperCase().includes(String(z.motif).toUpperCase()))
      .find(z => sur(String(z.compte)));
    return regle ? `règle « ${regle.motif} »` : '';
  };
  const origineBq = x => {
    const r = x.l.rapprochement || {};
    const chips = [];
    const quoi = quoiBq(x);
    if (quoi) chips.push(`<span class="bq-src quoi">${esc(quoi)}</span>`);
    if (x.e && x.e.source === 'skanfact') chips.push('<span class="bq-src sf">depuis SkanFact</span>');
    chips.push(r.par === 'auto' ? '<span class="bq-src">d\'office</span>' : '<span class="bq-src toi">à la main</span>');
    return chips.join('');
  };

  // Le livre en face de la ligne choisie. Une ligne rapprochée montre son écriture ; une autre, ce qui peut lui répondre.
  function livreEnFace(dossier, R, x, lect) {
    const L = livresState.livre;
    const l = x.l;
    const tete = `<div class="bq-lh"><b>Le livre</b><span>en face de <b class="mono">${esc(String(l.libelle || '').slice(0, 34))}</b> · ${esc(money(l.montant))}</span></div>`;
    if (x.g === 'ok' && (x.autres || []).length) {
      // (1.299.0) Une remise : la ligne répond de plusieurs écritures ; chacune s'ouvre, et la somme se relit.
      const faces = [{ e: x.e, rang: x.rang, ecritureId: x.e ? x.e.id : '' }].concat(x.autres);
      const mt = f => { const z = f.e && (f.e.lignes || [])[f.rang]; return z ? KC.round3((Number(z.debit) || 0) - (Number(z.credit) || 0)) : 0; };
      const total = KC.round3(faces.reduce((t, f) => t + mt(f), 0));
      return `<aside class="bq-livre" aria-label="Le livre en face">${tete}
        <div class="bq-ok">${svgBq(BQ_IC.ok, 15)}<span>Rapprochée avec <b>${faces.length} écritures</b> : une remise${(l.rapprochement || {}).par === 'auto' ? ', d\'office' : ''}</span></div>
        <table class="list compact bq-ec bq-rem" data-sans-cartes><thead><tr><th>Pièce</th><th>Date</th><th class="r">Montant</th><th></th></tr></thead><tbody>${faces.map(f => `<tr><td><div class="bq-lb"><div><b class="mono">${esc(pieceBq(f.e) || '—')}</b><small class="bq-p">${esc(((f.e && (f.e.lignes || [])[f.rang]) || {}).libelle || (f.e && f.e.libelle) || '')}</small></div></div></td><td>${esc(f.e ? fmtJour(f.e.date) : '')}</td><td class="r">${esc(montant(mt(f)))}</td><td class="r">${f.e ? `<button type="button" class="cp-plus" data-bq-voir-ecriture="${esc(f.e.id)}">Ouvrir</button>` : ''}</td></tr>`).join('')}</tbody></table>
        <div class="bq-som ${KC.round3(Number(l.montant) - total) ? 'ko' : 'ok'}"><span>La ligne ${esc(money(l.montant))}</span><span>${faces.length} écritures ${esc(money(total))}</span><b>${KC.round3(Number(l.montant) - total) ? `écart ${esc(money(KC.round3(Number(l.montant) - total)))}` : `${svgBq(BQ_IC.ok, 13)} écart 0`}</b></div>
        <div class="cp-gestes">${lect ? '' : '<button type="button" class="btn btn-ghost" id="bq-defaire">Défaire</button>'}</div></aside>`;
    }
    if (x.g === 'ok') {
      const e = x.e;
      return `<aside class="bq-livre" aria-label="Le livre en face">${tete}
        ${e ? `<div class="bq-ok">${svgBq(BQ_IC.ok, 15)}<span>Rapprochée avec <b>${esc(pieceBq(e))}</b> du ${esc(fmtJour(e.date))}${(l.rapprochement || {}).par === 'auto' ? ', d\'office' : ''}</span></div>
          ${tableEcriture(e.lignes || [], x.rang)}` : '<p class="bq-rien">Cette écriture n\'est plus au livre de cet exercice.</p>'}
        <div class="cp-gestes">${e ? '<button type="button" class="btn" id="bq-voir-ecriture">Voir l\'écriture</button>' : ''}${lect ? '' : '<button type="button" class="btn btn-ghost" id="bq-defaire">Défaire</button>'}</div></aside>`;
    }
    if (x.g === 'att') {
      const q = x.q;
      return `<aside class="bq-livre" aria-label="Le livre en face">${tete}
        <div class="bq-q">${svgBq(BQ_IC.msg, 15)}<div><b>${esc(q.objet || `Question ${aClientBq(dossier)}`)}</b><small>${q.statut === 'repondue' && q.reponse ? `Réponse : « ${esc(String(q.reponse.texte || '').slice(0, 160))} »` : `posée le ${esc(fmtJour(KC.jourDeLInstant(q.creeLe || 0)))}${(q.envois || []).length > 1 ? ` · relancée ${(q.envois || []).length - 1} fois` : ''}`}</small></div></div>
        <p class="bq-rien">Tant qu'il n'a pas répondu, la ligne attend : elle ne bloque rien. ${q.statut === 'repondue' ? 'Sa réponse est là : écris la ligne d\'après elle.' : 'Tu peux aussi la mettre au compte d\'attente (471) le temps qu\'il réponde.'}</p>
        ${lect ? '' : `<div class="cp-gestes">${q.statut === 'repondue' ? '<button type="button" class="btn btn-primary" id="bq-principal">Écrire d\'après sa réponse <kbd class="bq-k">Entrée</kbd></button>' : '<button type="button" class="btn btn-primary" id="bq-principal">Ouvrir la conversation <kbd class="bq-k">Entrée</kbd></button>'}<button type="button" class="btn" id="bq-attente">Au compte d'attente</button></div>`}</aside>`;
    }
    // Ce qui peut répondre : les écritures du même montant à ± n jours d'abord (le jugement du moteur), puis ce que la
    // recherche trouve dans le reste du compte (un montant, un mot, une pièce).
    const jug = x.jug || { candidats: [], libres: [] };
    const cle = c => c.ecritureId + '#' + c.ligne;
    const q = banqueState.cherche.trim().toLowerCase();
    const enTete = jug.candidats.slice().sort((a, b) => (x.c && cle(b) === cle(x.c)) - (x.c && cle(a) === cle(x.c)));
    const trouves = q ? jug.libres.filter(c => !enTete.some(y => cle(y) === cle(c))).filter(c => {
      const txt = `${c.libelle} ${c.piece} ${montant(Math.abs(c.montant))} ${String(Math.abs(c.montant)).replace('.', ',')}`.toLowerCase();
      return txt.includes(q);
    }).slice(0, 12) : [];
    const liste = enTete.concat(trouves);
    const choisi = banqueState.choix[l.id] != null ? banqueState.choix[l.id] : (x.c ? cle(x.c) : (enTete.length === 1 ? cle(enTete[0]) : ''));
    const cc = liste.find(c => cle(c) === choisi);
    const ecart = cc ? KC.round3(Number(l.montant) - cc.montant) : null;
    const pieces = liste.length ? `<table class="list compact bq-pc"><tbody>${liste.map(c => {
      const e = ecritureDuLivre(L, c.ecritureId);
      const on = cle(c) === choisi;
      return `<tr class="${on ? 'on' : ''}" data-bq-choix="${esc(cle(c))}"><td class="bq-c"><input type="radio" name="bq-choix" value="${esc(cle(c))}"${on ? ' checked' : ''} aria-label="${esc(c.piece || pieceBq(e))}"></td>
        <td><div class="bq-lb"><span class="bqx doc">${svgBq(BQ_IC.doc)}</span><div><span><b class="mono">${esc(c.piece || pieceBq(e) || '—')}</b> <small>du ${esc(fmtJour(c.date))}${e && e.statut === 'brouillard' ? ' · brouillard' : ''}</small></span>
          <small class="bq-p">${esc(c.libelle || '')}${enTete.some(y => cle(y) === cle(c)) ? ` · ${esc(pourquoiBq(l, c, x.c && cle(x.c) === cle(c) ? jug.niveau : 'probable').replace(/^même montant, la (seule|plus probable)/, 'même montant'))}` : ''}</small></div></div></td>
        <td class="r">${esc(montant(c.montant))}</td></tr>`;
    }).join('')}</tbody></table>
      ${cc ? `<div class="bq-som ${ecart ? 'ko' : 'ok'}"><span>La ligne ${esc(money(l.montant))}</span><span>cochée ${esc(money(cc.montant))}</span><b>${ecart ? `écart ${esc(money(ecart))}` : `${svgBq(BQ_IC.ok, 13)} écart 0`}</b></div>`
        // L'écriture cochée, ligne à ligne (comme la maquette montre celle qui sera passée) : on rapproche en la voyant.
        + (() => { const e = ecritureDuLivre(L, cc.ecritureId); return e && (e.lignes || []).length ? tableEcriture(e.lignes, -1) : ''; })() : ''}` : '';
    const prop = x.prop;
    const sansRien = !liste.length;
    let corps = '', principal = '';
    // (1.208.0) Les factures encore ouvertes que la ligne peut payer : la proposée, celles du tiers que la banque nomme, ce
    // que la recherche trouve ; des cases à cocher (une remise paie plusieurs factures). Cochées, la somme, la retenue qui
    // explique l'écart, l'écriture qui sera passée et ce qui se lettre se lisent AVANT le geste.
    const rep = x.rep || { ouvertes: [], proposees: [], duTiers: [] };
    const cleP = p => p.ecritureId + '#' + p.ligne;
    const rg = reglementBq(R, x);
    const montrees = [];
    const ajoute = p => { if (p && !montrees.some(y => cleP(y) === cleP(p))) montrees.push(p); };
    (rg ? rg.pieces : []).forEach(ajoute);
    (x.fact || []).forEach(ajoute);
    // Les autres factures du tiers nommé : trois quand une pièce est déjà cochée (l'écriture qui sera passée reste en vue),
    // six sinon ; « les voir toutes » montre le reste.
    if (sansRien || rg) (rep.duTiers || []).slice(0, rg ? 3 : 6).forEach(ajoute);
    if (q) rep.ouvertes.filter(p => `${p.piece} ${p.tiers} ${p.libelle} ${montant(Math.abs(p.reste))} ${String(Math.abs(p.reste)).replace('.', ',')}`.toLowerCase().includes(q)).forEach(ajoute);
    const toutes = banqueState.toutes === l.id;
    if (toutes) rep.ouvertes.forEach(ajoute);
    const vues = montrees.slice(0, toutes ? 40 : 12);
    const deQui = Number(l.montant) >= 0 ? 'de clients' : 'de fournisseurs';
    const voirToutes = rep.ouvertes.length > vues.length && !toutes ? '<button type="button" class="cp-plus" id="bq-toutes">les voir toutes</button>' : '';
    const ouvertesHtml = vues.length ? `<div class="bq-st"><b>Factures ${deQui} non réglées</b><span class="mu">${vues.length < rep.ouvertes.length ? `${vues.length} sur ${rep.ouvertes.length}` : rep.ouvertes.length}</span>${voirToutes}</div>
      <table class="list compact bq-pc bq-fo"><tbody>${vues.map(p => {
        const on = !!rg && rg.cles.includes(cleP(p));
        const prop1 = (x.fact || []).some(y => cleP(y) === cleP(p));
        return `<tr class="${on ? 'on' : ''}" data-bq-piece="${esc(cleP(p))}"><td class="bq-c"><input type="checkbox"${on ? ' checked' : ''} aria-label="${esc(p.piece || p.tiers || 'la facture')}"></td>
        <td><div class="bq-lb"><span class="bqx doc">${svgBq(BQ_IC.doc)}</span><div><span><b class="mono">${esc(p.piece || '—')}</b> <small>du ${esc(fmtJour(p.date))}${p.statut === 'brouillard' ? ' · brouillard' : ''}${p.entiere ? '' : ' · déjà payée en partie'}</small></span>
          <small class="bq-p">${esc([p.tiers, p.compte].filter(Boolean).join(' · '))}${prop1 && rep.pourquoi ? ` · ${esc(rep.pourquoi)}` : ''}</small></div></div></td>
        <td class="r">${esc(montant(Math.abs(p.reste)))}</td></tr>`;
      }).join('')}</tbody></table>`
      : (sansRien && rep.ouvertes.length ? `<p class="bq-rien">${pl(rep.ouvertes.length, 'facture', 'factures')} ${deQui} non réglée${rep.ouvertes.length > 1 ? 's' : ''} : cherche un tiers, une pièce ou un montant, ou ${voirToutes || 'les voir toutes'}.</p>` : '');
    // (1.299.0) Une remise : plusieurs écritures du livre qui font la ligne ensemble. Proposée (une seule combinaison), à
    // cocher (deux combinaisons possibles), ou choisie à la main (« Plusieurs écritures font cette ligne ? »). Cochées, leur
    // somme et l'écart se lisent AVANT le geste.
    const rm = rg ? null : remiseBq(dossier, R, x);
    let remiseHtml = '';
    if (rm) {
      const cleE = c => c.ecritureId + '#' + c.ligne;
      const vuesR = [];
      const ajouteR = c => { if (c && !vuesR.some(y => cleE(y) === cleE(c))) vuesR.push(c); };
      rm.faces.forEach(ajouteR); (x.remise || []).forEach(ajouteR); (x.remisePossibles || []).forEach(ajouteR);
      rm.voisines.forEach(ajouteR); trouves.forEach(ajouteR);
      const n = rm.faces.length;
      remiseHtml = `<div class="bq-st"><b>Une remise : plusieurs écritures font la ligne</b><span class="mu">${n ? pl(n, 'cochée', 'cochées') : 'aucune cochée'}</span>${lect ? '' : '<button type="button" class="cp-plus" id="bq-remise-non" title="Revenir au choix d\'une seule écriture, ou écrire la ligne">Une seule écriture</button>'}</div>
        ${x.remisePossibles && !banqueState.remise[l.id] ? `<p class="bq-rien">Plusieurs combinaisons de ces écritures font ${esc(money(l.montant))} : coche celles que la banque a remises ensemble (le bordereau de remise les nomme).</p>` : ''}
        <table class="list compact bq-pc bq-rem" data-sans-cartes><tbody>${vuesR.map(c => {
          const e = ecritureDuLivre(L, c.ecritureId), on = rm.cles.includes(cleE(c));
          return `<tr class="${on ? 'on' : ''}" data-bq-remise="${esc(cleE(c))}"><td class="bq-c"><input type="checkbox"${on ? ' checked' : ''} aria-label="${esc(c.piece || pieceBq(e) || 'l\'écriture')}"></td>
          <td><div class="bq-lb"><span class="bqx doc">${svgBq(BQ_IC.doc)}</span><div><span><b class="mono">${esc(c.piece || pieceBq(e) || '—')}</b> <small>du ${esc(fmtJour(c.date))}${e && e.statut === 'brouillard' ? ' · brouillard' : ''}</small></span>
            <small class="bq-p">${esc(c.libelle || '')}</small></div></div></td>
          <td class="r">${esc(montant(c.montant))}</td></tr>`;
        }).join('')}</tbody></table>
        ${n ? `<div class="bq-som ${rm.ecart ? 'ko' : 'ok'}"><span>La ligne ${esc(money(l.montant))}</span><span>${pl(n, 'cochée', 'cochées')} ${esc(money(rm.somme))}</span><b>${rm.ecart ? `écart ${esc(money(rm.ecart))}` : `${svgBq(BQ_IC.ok, 13)} écart 0`}</b></div>` : ''}
        ${n && rm.ecart ? `<p class="bq-rien bq-refus" id="bq-ecart-refus">${n > 1 ? `Les ${n} écritures cochées font` : 'L\'écriture cochée fait'} ${esc(money(rm.somme))}, la ligne ${esc(money(l.montant))} : coche celles que la banque a remises ensemble, ou cherche celle qui manque.</p>` : ''}`;
    }
    let reglementHtml = '';
    if (rg) {
      const n = rg.pieces.length, m = Number(l.montant);
      const nomP = p => p.piece || p.tiers || 'la facture';
      const comptes = [...new Set(rg.pieces.map(p => p.compte))].join(', ');
      const brouillard = rg.pieces.filter(p => p.statut === 'brouillard').map(nomP);
      const entamees = rg.pieces.filter(p => !p.entiere || !p.seule).map(nomP);
      const phrases = [];
      if (rg.ecart) {
        phrases.push(`<p class="bq-rien bq-refus" id="bq-ecart-refus">${n > 1 ? `Les ${n} pièces cochées font` : 'La pièce cochée fait'} ${esc(money(Math.abs(rg.somme)))}, la ligne ${esc(money(Math.abs(m)))} (écart ${esc(money(rg.ecart))}) : coche ce que la ligne paie, ou « Écrire autre chose ».${!tauxRetenueBq().length && Math.abs(rg.somme) > Math.abs(m) ? ' Une retenue à la source ? Ses taux se règlent dans « Les règles de la banque ».' : ''}</p>`);
      } else {
        if (rg.retenue) {
          const lr = rg.ec.lignes[rg.ec.lignes.length - 1];
          const t = String(rg.retenue.taux).replace('.', ',');
          const qui = rg.pieces[0].tiers;
          phrases.push(m > 0
            ? `<p class="bq-rien">${esc(qui || 'Le client')} a retenu ${esc(money(rg.retenue.montant))} (${esc(t)} %) : la retenue va au <b class="mono">${esc(lr.compte)}</b>, une créance ; son certificat est à lui demander. <b>À VÉRIFIER</b> : le taux et l'assiette.</p>`
            : `<p class="bq-rien">${esc(contactBq(dossier) || 'Le client')} a retenu ${esc(money(rg.retenue.montant))} (${esc(t)} %)${qui ? ` sur ${esc(qui)}` : ''} : la retenue va au <b class="mono">${esc(lr.compte)}</b>, à déclarer ; son certificat est à remettre. <b>À VÉRIFIER</b> : le taux et l'assiette.</p>`);
        }
        if (rg.lettrable) phrases.push(`<p class="bq-rien">${n > 1 ? `Les ${n} pièces se lettrent` : `${esc(nomP(rg.pieces[0]))} se lettre`} au ${esc(comptes)} avec ce règlement : pour cela, l'écriture est validée (une écriture validée ne se modifie plus, elle se contre-passe).</p>`);
        else if (brouillard.length) phrases.push(`<p class="bq-rien">${esc(brouillard.join(', '))} ${brouillard.length > 1 ? 'sont' : 'est'} au brouillard : l'écriture se passe au brouillard et se rapproche ; le lettrage se fera une fois tout validé.</p>`);
        else if (entamees.length) phrases.push(`<p class="bq-rien">${esc(entamees.join(', '))} ${entamees.length > 1 ? 'sont déjà payées' : 'est déjà payée'} en partie : l'écriture se passe et se rapproche ; le lettrage se fera à la main.</p>`);
      }
      reglementHtml = `<div class="bq-som ${rg.ecart ? 'ko' : 'ok'}"><span>La ligne ${esc(money(l.montant))}</span><span>${n > 1 ? `${n} cochées` : 'cochée'} ${esc(money(rg.somme))}</span><b>${rg.ecart ? `écart ${esc(money(rg.ecart))}` : rg.retenue ? `${svgBq(BQ_IC.ok, 13)} net de sa retenue ${esc(montant(rg.retenue.montant))}` : `${svgBq(BQ_IC.ok, 13)} écart 0`}</b></div>`
        + (rg.ecart ? '' : `<div class="bq-st"><b>L'écriture qui sera passée</b><span class="mu">journal BQ · ${rg.lettrable ? 'validée' : 'au brouillard'}</span></div>${tableEcriture(rg.ec.lignes, -1)}`)
        + phrases.join('');
    }
    if (rg) {
      corps = (liste.length ? pieces : '') + ouvertesHtml + reglementHtml;
      principal = rg.ecart ? '' : rg.lettrable ? (rg.pieces.length > 1 ? `Rapprocher et lettrer les ${rg.pieces.length}` : 'Rapprocher et lettrer') : 'Écrire et rapprocher';
    } else if (rm) {
      corps = remiseHtml + ouvertesHtml;
      principal = rm.faces.length && !rm.ecart ? (rm.faces.length > 1 ? `Rapprocher les ${rm.faces.length}` : 'Rapprocher') : '';
    } else if (!sansRien) {
      // (1.206.0) Un rapprochement relie deux montants égaux : une écriture d'un autre montant (trouvée par la recherche) ne
      // se rapproche pas ; la phrase dit l'écart et le geste qui débloque.
      corps = pieces + (x.ton === 'choix' && !cc ? '<p class="bq-rien">Plusieurs écritures portent ce montant : coche la bonne. La date et le libellé ne les départagent pas.</p>' : '')
        + (cc && ecart ? `<p class="bq-rien bq-refus" id="bq-ecart-refus">Les deux montants ne sont pas égaux (écart ${esc(money(ecart))}) : une ligne du relevé se rapproche d'une écriture du même montant. Corrige l'écriture, ou « Écris autre chose » pour cette ligne.</p>` : '')
        + ouvertesHtml;
      principal = cc && !ecart ? 'Rapprocher' : '';
    } else if (prop) {
      const aussi = (R.lignes || []).filter(z => z.id !== l.id && !(z.rapprochement && z.rapprochement.ecritureId) && KC.ecritureProposee(z, Array.isArray(S.libelles) ? S.libelles : [], { compte: R.compte, journal: 'BQ' }).regle === prop.regle);
      corps = `<p class="bq-rien">Rien dans le livre pour cette ligne. <b>Sa règle « ${esc(prop.regle)} »</b> propose l'écriture${aussi.length ? ` ; elle sert aussi ${aussi.length > 1 ? `à ${aussi.length} autres lignes` : `à « ${esc(String(aussi[0].libelle || '').slice(0, 30))} »`} du relevé` : ''}.</p>${tableEcriture([...prop.lignes].sort((u, v) => (v.debit > 0) - (u.debit > 0)), -1)}${ouvertesHtml}`;
      principal = 'Écrire et rapprocher';
    } else {
      corps = `<p class="bq-rien">Rien dans le livre au même montant${q ? ` ni pour « ${esc(banqueState.cherche)} »` : ''}. L'écrire (au brouillard, rapprochée du même geste), ou demander ${esc(aClientBq(dossier))} ce que c'est.${lect ? '' : ' <button type="button" class="cp-plus" id="bq-remise-oui">Plusieurs écritures font cette ligne ?</button>'}</p>${ouvertesHtml}`;
      principal = 'Écrire l\'écriture…';
    }
    return `<aside class="bq-livre" aria-label="Le livre en face">${tete}
      <label class="bq-ch">${svgBq(BQ_IC.loupe, 15)}<input type="search" id="bq-cherche" value="${esc(banqueState.cherche)}" placeholder="Chercher un montant, un tiers, une pièce…  ( / )" aria-label="Chercher dans le livre"></label>
      ${corps}
      ${lect ? '' : `<div class="cp-gestes">${principal ? `<button type="button" class="btn btn-primary" id="bq-principal">${esc(principal)} <kbd class="bq-k">Entrée</kbd></button>` : ''}
        ${sansRien && !prop && !rg && !rm ? (!dossier.manual && api.question ? `<button type="button" class="btn" id="bq-demander">Demander ${esc(aClientBq(dossier))}</button>` : '') : '<button type="button" class="btn" id="bq-autre">Écrire autre chose</button>'}</div>`}
    </aside>`;
  }
  // (1.208.0) Le règlement que la ligne choisie paierait : les factures cochées (celles qu'on a cochées, sinon la proposée),
  // leur somme, la retenue qui explique l'écart, l'écriture qui sera passée et si elle se lettre. UNE fonction pour l'écran
  // et pour Entrée : ce qu'on lit est ce qui s'écrit.
  function reglementBq(R, x) {
    const l = x.l, rep = x.rep || { ouvertes: [] };
    const cleP = p => p.ecritureId + '#' + p.ligne;
    const cles = banqueState.pieces[l.id] != null ? banqueState.pieces[l.id] : (x.fact || []).map(cleP);
    const pieces = cles.map(k => rep.ouvertes.find(p => cleP(p) === k)).filter(Boolean);
    if (!pieces.length) return null;
    const m = KC.round3(Number(l.montant) || 0);
    const somme = KC.round3(pieces.reduce((t, p) => t + p.reste, 0));
    const retenue = KC.round3(m - somme) ? KC.retenueDeReglement(pieces, m, tauxRetenueBq()) : null;
    const ecart = retenue ? 0 : KC.round3(m - somme);
    const ec = KC.ecritureDeReglement(l, pieces, { compte: R.compte, journal: 'BQ', retenue });
    const lettrable = !ecart && pieces.every(p => p.statut !== 'brouillard' && p.entiere && p.seule);
    return { cles: pieces.map(cleP), pieces, somme, retenue, ecart, ec, lettrable };
  }
  // (1.299.0) La remise que la ligne choisie rapprocherait : les écritures cochées (celles qu'on a cochées, sinon la
  // proposée), leur somme, l'écart. `voisines` : les écritures du même sens des vingt jours d'avant la ligne, à cocher
  // à la main. Hors du mode remise (rien de proposé, rien demandé, ou « Une seule écriture »), rien. UNE fonction pour
  // l'écran et pour Entrée : ce qu'on lit est ce qui se pose.
  function remiseBq(dossier, R, x) {
    const l = x.l, choisies = banqueState.remise[l.id];
    if (x.g === 'ok' || x.g === 'att' || choisies === false || (choisies == null && !x.remise && !x.remisePossibles)) return null;
    const cleE = c => c.ecritureId + '#' + c.ligne;
    const libres = (x.jug || { libres: [] }).libres || [];
    const cles = Array.isArray(choisies) ? choisies : (x.remise || []).map(cleE);
    const faces = cles.map(k => libres.find(c => cleE(c) === k)).filter(Boolean);
    const somme = KC.round3(faces.reduce((t, c) => t + c.montant, 0));
    const t = Date.parse(String(l.date) + 'T00:00:00Z'), jours = joursBanque(dossier);
    const avant = c => (t - Date.parse(String(c.date) + 'T00:00:00Z')) / 86400000;
    const voisines = libres.filter(c => Math.sign(c.montant) === Math.sign(Number(l.montant)) && avant(c) <= 20 && avant(c) >= -jours)
      .sort((a, b) => Math.abs(avant(a)) - Math.abs(avant(b))).slice(0, 12);
    return { cles: faces.map(cleE), faces, somme, ecart: KC.round3(Number(l.montant) - somme), voisines };
  }
  const tableEcriture = (lignes, marque) => `<table class="list compact bq-ec" data-sans-cartes><thead><tr><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead><tbody>${lignes.map((z, i) =>
    `<tr class="${i === marque ? 'br-ligne' : ''}"><td class="mono">${esc(z.compte || '')}</td><td class="tronq" title="${esc(z.libelle || '')}">${esc(z.libelle || '')}</td><td class="r">${Number(z.debit) ? esc(montant(z.debit)) : ''}</td><td class="r">${Number(z.credit) ? esc(montant(z.credit)) : ''}</td></tr>`).join('')}</tbody></table>`;

  // Le pied : l'équation à gauche, le verdict à droite. Un écart que rien n'explique se dit en rouge, avec les pistes
  // que l'écran a déjà regardées (une écriture du livre au même montant sans ligne au relevé, les écritures d'avant le
  // premier relevé, le relevé qui ne suit pas le précédent).
  function piedBanque(R, EC) {
    const t = (op, lab, v, attr = '') => `<span class="bqp-op" aria-hidden="true">${op}</span><span class="bqp-t"${attr}><small>${lab}</small><b>${esc(montant(Math.abs(v)))}</b></span>`;
    const sgn = v => (v < 0 ? '−' : '+');
    const nB = EC.banqueAll.length, nL = EC.livreRec.length;
    const dAutres = EC.banqueAll.filter(x => x.releve.id !== R.id).length;
    const dApres = EC.banqueAll.filter(x => x.ecritLe).length;
    const dont = [dAutres ? `${dAutres} d'avant` : '', dApres ? `${dApres} écrite${dApres > 1 ? 's' : ''} après le ${fmtJour(R.au).slice(0, 5)}` : ''].filter(Boolean).join(', ');
    const eq = [t('', `Relevé au ${fmtJour(R.au).slice(0, 5)}`, EC.sus.soldeFin),
      nB ? t(sgn(-EC.sB), `${pl(nB, 'ligne')} pas encore au livre${dont ? ` (dont ${dont})` : ''}`, EC.sB, ' role="button" tabindex="0" id="bq-eq-banque" title="Les montrer dans la liste"') : '',
      nL ? t(sgn(EC.sLr), `${pl(nL, 'écriture')} pas encore en banque`, EC.sLr, ' role="button" tabindex="0" id="bq-eq-livre" title="Les voir : chèques émis, virements pas encore passés"') : '',
      t('=', `Attendu au livre ${R.compte}`, EC.attendu)].join('');
    if (!EC.nonExplique) {
      return `<div class="bqp" role="status" aria-label="L'écart du relevé"><div class="bqp-eq">${eq}</div>
        <div class="bqp-v ok"><span class="bqp-i">${svgBq(BQ_IC.ok, 15)}</span><div><b>Écart expliqué au millime</b>${nB
          ? `<button type="button" class="cp-plus bqp-pdf" data-bq-etat>L'état de rapprochement (PDF)</button>` : '<small>plus rien à écrire</small>'}</div></div></div>`;
    }
    const L = livresState.livre;
    const pistes = [];
    const memeMontant = EC.sus.livre.filter(x => KC.round3(Math.abs(x.montant) - Math.abs(EC.nonExplique)) === 0);
    memeMontant.slice(0, 2).forEach(x => {
      const e = ecritureDuLivre(L, x.ecritureId);
      pistes.push(`<div class="bqp-pi"><b>Une écriture du livre fait ${esc(montant(Math.abs(EC.nonExplique)))} sans ligne au relevé</b><span>${esc(x.piece || pieceBq(e))} du ${esc(fmtJour(x.date))} · « ${esc(x.libelle || '')} » : écrite deux fois, ou au mauvais compte ?</span>${e ? `<button type="button" class="btn btn-sm" data-bq-voir-ecriture="${esc(x.ecritureId)}">Ouvrir ${esc(x.piece || pieceBq(e))}</button>` : ''}</div>`);
    });
    const d0 = KC.round3(Number(EC.premierR.soldeDebut) - EC.livreAvantPremier);
    if (d0) {
      pistes.push(`<div class="bqp-pi"><b>Le premier relevé ne part pas du solde du livre</b><span>le relevé du ${esc(fmtJour(EC.premier))} commence à ${esc(money(EC.premierR.soldeDebut))} ; le livre ${esc(R.compte)} disait ${esc(money(EC.livreAvantPremier))} la veille (${esc(money(d0))} d'écart) : le solde d'ouverture du compte, ou des relevés d'avant qui manquent.</span></div>`);
    }
    EC.ruptures.forEach(p => {
      pistes.push(`<div class="bqp-pi"><b>Un relevé ne commence pas où le précédent finit</b><span>fin du ${esc(fmtJour(p.avant.au))} : ${esc(money(p.avant.soldeFin))} · début du ${esc(fmtJour(p.apres.du))} : ${esc(money(p.apres.soldeDebut))}. Des mouvements entre les deux ne sont dans aucun relevé.</span></div>`);
    });
    if (!d0 && !EC.ruptures.length) {
      pistes.push(`<div class="bqp-pi ok">${svgBq(BQ_IC.ok, 14)}<span>Les relevés se suivent et se bouclent : chacun commence où le précédent finit, début + mouvements = la fin que la banque imprime.</span></div>`);
    }
    pistes.push(`<div class="bqp-pi"><span>Pas trouvé ? Cherche ${esc(montant(Math.abs(EC.nonExplique)))} dans les écritures du compte : une ligne oubliée, ou saisie avec une faute de frappe.</span><button type="button" class="btn btn-sm btn-ghost" id="bq-chercher-ecart">Chercher ${esc(montant(Math.abs(EC.nonExplique)))}</button></div>`);
    return `<div class="bqp ko" role="status" aria-label="L'écart du relevé" id="bq-pied"><div class="bqp-eq">${eq}</div>
      <div class="bqp-v ko"><b>Écart non expliqué : ${esc(money(Math.abs(EC.nonExplique)))}</b><small>Le livre ${esc(R.compte)} dit ${esc(money(EC.sus.soldeComptable))}, il devrait dire ${esc(money(EC.attendu))}</small></div>
      <div class="bqp-pistes">${pistes.join('')}</div></div>`;
  }

  // Aucun relevé : l'écran montre la page qu'il deviendra (grisée), et le geste qui la remplit (règle des maquettes).
  function banqueVide(dossier, mois, releves) {
    const L = livresState.livre;
    const compte = (dossier.banque || {}).compte || '532';
    const lignesAp = n => Array.from({ length: n }, (_, i) => `<div class="apx-l"><span class="apx-b"></span><span class="t"><span class="apx-b"></span><span class="apx-b"></span></span><span class="apx-b" style="width:${60 + (i * 17) % 30}%;justify-self:end"></span></div>`).join('');
    const nb = KC.lignesBancaires(L, compte).length;
    const nomBq = (dossier.banque || {}).banque || ((releves || [])[0] || {}).banque || '';
    const nomM = mois ? moisLong(mois) : '';
    // Le relevé d'avant ce mois : « août : rapproché le 12/09 », ou « importé, N lignes à traiter ».
    const avant = mois && releves ? releves.filter(r => String(r.au || r.du || '').slice(0, 7) < mois)[0] : null;
    const dit = (() => {
      if (!avant) return `aucun relevé importé${nb ? ` · ${pl(nb, 'écriture')} au livre sur ce compte` : ''}`;
      const reste = (avant.lignes || []).filter(l => !(l.rapprochement && (l.rapprochement.ecritureId || l.rapprochement.ignore))).length;
      const mA = moisLong(String(avant.au || avant.du).slice(0, 7));
      return `${mA} : ${reste ? `${pl(reste, 'ligne')} encore à rapprocher` : 'tout est rapproché'} · le relevé ${deMois(mois)} n'est pas encore là`;
    })();
    return `<div class="bq-ecran"><div class="bq-h"><div><b>Banque · ${esc(mois ? `${nomM} ${mois.slice(0, 4)}` : livresState.annee)}${mois ? ` <span class="bq-per">${esc(compte)}${nomBq ? ` ${esc(nomBq)}` : ''}</span>` : ''}</b><span class="mu">${mois ? esc(dit) : `compte ${esc(compte)}${nomBq ? ` · ${esc(nomBq)}` : ''} · ${esc(dit)}`}</span></div></div>
      <div class="apx"><div class="apx-f" aria-hidden="true"><div class="apx-pills">${'<span class="apx-b"></span>'.repeat(5)}</div>
        <div class="apx-2"><div class="apx-r">${lignesAp(6)}</div><div class="apx-r apx-cad"><span class="apx-b" style="width:40%"></span><span class="apx-b" style="height:30px"></span>${lignesAp(2)}<span class="apx-b apx-btn"></span></div></div></div>
        <div class="apx-c"><span class="apx-ic">${svgBq(BQ_IC.banque, 22)}</span><b>Le relevé ${esc(mois ? deMois(mois) : '')}${mois ? ' ' : ''}n'est pas encore là</b>
          <p>Importe le fichier ${esc(nomBq ? `de la ${nomBq}` : 'de la banque')} tel qu'elle le donne (Excel ou CSV). Chaque ligne arrive avec sa pièce en face, et pourquoi ; ce qui est sûr se confirme d'un coup.</p>
          <div class="cp-gestes">${lectureSeuleLivre() ? '' : `<button type="button" class="btn btn-primary" id="bq-import">Importer le relevé…</button>`}${!dossier.manual && api.messagerie ? '<button type="button" class="btn" id="bq-demander-releve">Le demander au client</button>' : ''}</div>
          <span class="apx-mini">Le relevé en PDF : pas encore (À VÉRIFIER : les banques qui ne donnent que le PDF).</span></div></div></div>`;
  }

  // Le geste d'une ligne, puis la ligne SUIVANTE (celle d'après dans l'ordre des groupes) : on ne revient jamais chercher
  // sa place dans la liste. `faire` rend le message ; `defaire`, s'il y a lieu, l'« Annuler » du message.
  // (1.221.0, l'épreuve d'un mois) La suivante est la prochaine ligne qui demande du travail : après elle dans l'ordre des
  // groupes, sinon en reprenant au début (une ligne « à traiter » laissée plus haut n'est jamais sautée) ; celles qui
  // attendent le client ne viennent qu'à la fin, quand il ne reste qu'elles.
  function suivanteBq(dossier, R, id) {
    const ordre = GROUPES_BQ.flatMap(([g]) => lectureBanque(dossier, R).filter(x => x.g === g)).map(x => ({ id: x.l.id, g: x.g }));
    const i = ordre.findIndex(x => x.id === id);
    if (i < 0) return banqueState.sel;
    const travail = x => x.id !== id && x.g !== 'att';
    const t = ordre.slice(i + 1).find(travail) || ordre.slice(0, i).find(travail) || ordre.find(x => x.id !== id);
    return t ? t.id : '';
  }
  async function gesteBanque(root, dossier, R, id, faire, defaire) {
    const suivante = suivanteBq(dossier, R, id);
    try {
      const msg = await faire();
      if (msg === null) return;
      banqueState.sel = suivante; banqueState.cherche = ''; delete banqueState.choix[id]; banqueState.coches.delete(id);
      // (1.207.0) Le message vit DANS la carte, au-dessus de la liste (maquette) : on le lit là où l'on travaille, avec son
      // « Annuler » ; il s'efface dès qu'on choisit une autre ligne.
      const l = (R.lignes || []).find(x => x.id === id) || {};
      banqueState.annonce = { sel: suivante, msg: `${l.libelle ? `« ${String(l.libelle).slice(0, 40)} » : ` : ''}${msg.replace(/\.$/, '')}${suivante && suivante !== id ? ' ; la ligne suivante est choisie.' : '.'}`,
        defaire: defaire ? async () => { await defaire(); banqueState.sel = id; } : null };
      drawLivres(root, dossier);
    } catch (e) { toast(plainError(e), 'error'); }
  }
  // `autres` (1.299.0) : les autres écritures d'une remise ({ ecritureId, ligne }).
  const poserBq = async (dossier, R, ligneId, ecritureId, rang, autres) => {
    const plus = (autres || []).map(c => ({ ecritureId: c.ecritureId, ligne: Number(c.ligne) }));
    const x = await api.rapprocher({ dossierId: dossier.id, annee: livresState.annee, releveId: R.id, ligneId, choix: { ecritureId, ligne: Number(rang), niveau: 'certain', date: K.today(), ...(plus.length ? { autres: plus } : {}) } });
    livresState.livre = x.livre;
  };
  const defaireBq = async (dossier, R, ligneId) => {
    const x = await api.rapprocher({ dossierId: dossier.id, annee: livresState.annee, releveId: R.id, ligneId, choix: {} });
    livresState.livre = x.livre;
  };
  // « Annuler » d'une ligne écrite depuis la Banque : le rapprochement défait, puis l'écriture du brouillard retirée (elle
  // vient de naître et rien d'autre ne la tient).
  const defaireEcriteBq = async (dossier, R, ligneId, ecritureId) => {
    await defaireBq(dossier, R, ligneId);
    if (ecritureId) livresState.livre = (await api.supprimerEcriture(dossier.id, livresState.annee, ecritureId)).livre;
  };
  // (1.208.0) Écrire le RÈGLEMENT de factures depuis une ligne : l'écriture (la banque, chaque facture, la retenue), son
  // rapprochement, puis — quand on l'a dit avant le geste — sa validation et le lettrage de chaque compte de tiers. Un
  // lettrage refusé par le serveur ne défait rien : l'écriture reste rapprochée, et le message le dit.
  async function reglerBq(dossier, R, l, rg, lettrer) {
    const s = livresState;
    const r = await api.saisir(dossier.id, s.annee, rg.ec);
    s.livre = r.livre;
    const noms = rg.pieces.map(p => p.piece || p.tiers).filter(Boolean);
    const dit = noms.length > 2 ? `${noms.length} factures` : noms.join(' et ') || 'la facture';
    if (!(r.livre.ecritures || []).some(x => x.id === r.id)) return { id: r.id, msg: `Le règlement de ${dit} est gardé sur ce poste : il part au serveur au retour du réseau, puis se rapproche.` };
    await poserBq(dossier, R, l.id, r.id, 0);
    const rs = rg.retenue ? `, retenue de ${money(rg.retenue.montant)} au ${rg.ec.lignes[rg.ec.lignes.length - 1].compte}` : '';
    if (!lettrer) return { id: r.id, msg: `Règlement de ${dit} écrit au brouillard${rs}, et rapproché.` };
    try {
      s.livre = (await api.valider(dossier.id, s.annee, r.id)).livre;
      const comptes = [...new Set(rg.pieces.map(p => p.compte))];
      for (const c of comptes) {
        const ids = [...new Set(rg.pieces.filter(p => p.compte === c).map(p => p.ecritureId)), r.id];
        s.livre = (await api.lettrer({ dossierId: dossier.id, annee: s.annee, compte: c, ids })).livre;
      }
      return { id: r.id, msg: `Rapproché : ${dit} ${noms.length > 1 ? 'sont payées, lettrées' : 'est payée, lettrée'} au ${comptes.join(', ')}${rs}.` };
    } catch (e) {
      return { id: r.id, msg: `Règlement de ${dit} écrit et rapproché${rs} ; le lettrage n'a pas pu se faire (${plainError(e)}) : il se fera dans le Lettrage.` };
    }
  }
  // Écrire la ligne au brouillard d'après une contrepartie (la règle, le 471), et la rapprocher du même geste.
  async function ecrireEtRapprocher(dossier, R, l, compte, libelle) {
    const s = livresState;
    const b = KC.ecritureProposee(l, Array.isArray(S.libelles) ? S.libelles : [], { compte: R.compte, journal: 'BQ' });
    const lib = libelle || b.libelle;
    // (1.220.0, épreuve d'un mois) Une écriture écrite depuis le relevé a une pièce : la référence de la ligne, sinon
    // « BQ-MMJJ » (le jour du relevé), comme les autres écritures de banque ; jamais « sans n° ».
    const pieceBq = (() => {
      if (b.piece) return b.piece;
      const base = `BQ-${String(l.date).slice(5, 7)}${String(l.date).slice(8, 10)}`;
      const prises = new Set((s.livre.ecritures || []).filter(x => x.journal === 'BQ').map(x => String(x.piece || '')));
      let n = base, i = 2; while (prises.has(n)) n = `${base}-${i++}`;
      return n;
    })();
    const ec = { ...b, piece: pieceBq, libelle: lib, lignes: [{ ...b.lignes[0], libelle: lib }, { ...b.lignes[1], compte, libelle: lib }] };
    delete ec.aChoisir; delete ec.regle;
    const r = await api.saisir(dossier.id, s.annee, ec);
    s.livre = r.livre;
    if ((r.livre.ecritures || []).some(x => x.id === r.id)) await poserBq(dossier, R, l.id, r.id, 0);
    return r.id;
  }

  function brancherBanque(el, root, dossier) {
    const s = livresState;
    const releves = s.livre.releves || [];
    const R = releves.find(r => r.id === banqueState.releve);
    if (banqueState.importer) { const pg = $('#bqi', el); if (pg) releveFormDans(pg, root, dossier); return; }
    $$('#bq-import', el).forEach(b => { b.onclick = () => releveForm(root, dossier); });
    const dem = $('#bq-demander-releve', el);
    if (dem) dem.onclick = () => fenDemanderCl(dossier, { piece: 'Le relevé de banque du mois' }, { hors: true, apres: async () => drawLivres(root, dossier) });
    banqueState.gestesReleve = null;
    if (!R) return;
    if (banqueState.etat === R.id) { brancherEtatBq(el, root, dossier, R); return; }
    if (banqueState.regles === R.id) { brancherReglesBq(el, root, dossier, R); return; }
    const lus = lectureBanque(dossier, R);
    const parId = new Map(lus.map(x => [x.l.id, x]));
    const sel = parId.get(banqueState.sel);
    const redessiner = () => drawLivres(root, dossier);
    const sur = (sel2, fn) => { const x = $(sel2, el); if (x) x.onclick = fn; };

    const choixReleve = $('#bq-releve', el);
    if (choixReleve) choixReleve.onchange = () => {
      banqueState.releve = choixReleve.value;
      // Le ruban suit le relevé choisi : un mois choisi ne le cache pas (1.217.0).
      const r2 = (livresState.livre.releves || []).find(r => r.id === choixReleve.value);
      if (r2 && moisSx() && r2.au) livresState.mois = String(r2.au).slice(0, 7);
      redessiner();
    };
    $$('[data-bq-filtre]', el).forEach(b => { b.onclick = () => { const v = b.dataset.bqFiltre; banqueState.filtre = banqueState.filtre === v ? '' : v; redessiner(); }; });
    sur('#bq-vers-ecart', () => { const p = $('#bq-pied', el); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $$('#bq-voir-faites, [data-bq-voir]', el).forEach(b => { b.onclick = () => { if (banqueState.filtre === 'ok') banqueState.filtre = ''; else banqueState.voirFaites = !banqueState.voirFaites; redessiner(); }; });
    // Choisir une ligne : le clic sur la ligne (pas sur sa case ni son menu), la carte au téléphone.
    $$('[data-bq-ligne]', el).forEach(tr => {
      tr.addEventListener('click', ev => {
        if (ev.target.closest('input,button,a,.row-menu-btn')) return;
        if (banqueState.sel === tr.dataset.bqLigne) return;
        banqueState.sel = tr.dataset.bqLigne; banqueState.cherche = '';
        redessiner();
        if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) { const p = $('.bq-livre'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' && tr.classList.contains('bq-k1')) { ev.preventDefault(); tr.click(); } });
    });
    $$('[data-bq-coche]', el).forEach(c => { c.onchange = () => { const id = c.dataset.bqCoche; if (c.checked) banqueState.coches.add(id); else banqueState.coches.delete(id); redessiner(); }; });
    $$('[data-bq-choix]', el).forEach(tr => { tr.onclick = () => { if (sel) { banqueState.choix[sel.l.id] = tr.dataset.bqChoix; banqueState.pieces[sel.l.id] = []; redessiner(); } }; });
    // (1.208.0) Cocher une facture en face : elle s'ajoute aux cochées (une remise en paie plusieurs) ; l'écriture du compte
    // de banque qui était choisie ne l'est plus (une ligne se rapproche d'une écriture OU paie des factures).
    $$('[data-bq-piece]', el).forEach(tr => { tr.onclick = () => {
      if (!sel) return;
      const avant = (reglementBq(R, sel) || { cles: [] }).cles;
      const k = tr.dataset.bqPiece;
      banqueState.pieces[sel.l.id] = avant.includes(k) ? avant.filter(x => x !== k) : avant.concat(k);
      banqueState.choix[sel.l.id] = '';
      redessiner();
    }; });
    sur('#bq-toutes', () => { if (sel) { banqueState.toutes = sel.l.id; redessiner(); } });
    // (1.299.0) Cocher une écriture de la remise ; entrer dans le mode remise à la main, ou en sortir.
    $$('[data-bq-remise]', el).forEach(tr => { tr.onclick = () => {
      if (!sel) return;
      const avant = (remiseBq(dossier, R, sel) || { cles: [] }).cles;
      const k = tr.dataset.bqRemise;
      banqueState.remise[sel.l.id] = avant.includes(k) ? avant.filter(x => x !== k) : avant.concat(k);
      redessiner();
    }; });
    sur('#bq-remise-oui', () => { if (sel) { banqueState.remise[sel.l.id] = []; delete banqueState.choix[sel.l.id]; redessiner(); } });
    sur('#bq-remise-non', () => { if (sel) { banqueState.remise[sel.l.id] = false; redessiner(); } });
    // La recherche relit le livre à chaque frappe, sans perdre le curseur.
    const ch = $('#bq-cherche', el);
    if (ch) {
      let t = null;
      ch.oninput = () => { clearTimeout(t); t = setTimeout(() => {
        // Le choix fait parmi les résultats d'une autre recherche ne vaut plus : l'écran et la touche Entrée parlent du même.
        banqueState.cherche = ch.value; if (sel) delete banqueState.choix[sel.l.id]; const pos = ch.selectionStart; redessiner();
        const n2 = $('#bq-cherche'); if (n2) { n2.focus(); try { n2.setSelectionRange(pos, pos); } catch (_) { /* rien */ } }
      }, 160); };
      ch.onkeydown = ev => { if (ev.key === 'Escape') { ch.blur(); if (banqueState.cherche) { banqueState.cherche = ''; if (sel) delete banqueState.choix[sel.l.id]; redessiner(); } } };
    }

    // Valider les proposées : les cochées, sinon toutes. Un seul appel, et un seul « Annuler » qui les défait toutes.
    const validerProposees = async () => {
      const coches = [...banqueState.coches].filter(id => (parId.get(id) || {}).g === 'prop');
      const choisies = (coches.length ? coches.map(id => parId.get(id)) : lus.filter(x => x.g === 'prop')).filter(Boolean);
      // (1.299.0) Une remise proposée se pose avec ses autres écritures, dans le même appel.
      const lot = choisies.filter(x => x.c || (x.remise && x.remise.length > 1));
      const choixDe = x => (x.c ? { ligneId: x.l.id, ecritureId: x.c.ecritureId, ligne: x.c.ligne }
        : { ligneId: x.l.id, ecritureId: x.remise[0].ecritureId, ligne: x.remise[0].ligne, autres: x.remise.slice(1).map(c => ({ ecritureId: c.ecritureId, ligne: c.ligne })) });
      // (1.208.0) Une proposée qui paie une facture n'a pas encore d'écriture : elle s'écrit au brouillard (jamais validée
      // en lot : le lettrage se fait ligne à ligne, ou une fois le mois validé), puis se rapproche.
      const factures = choisies.filter(x => !x.c && !x.remise && x.fact);
      if (!lot.length && !factures.length) return;
      const ecrites = [];
      try {
        if (lot.length) {
          const r = await api.rapprocherPlusieurs({ dossierId: dossier.id, annee: s.annee, releveId: R.id, choix: lot.map(choixDe) });
          s.livre = r.livre;
        }
        for (const x of factures) {
          const rg = reglementBq(R, { ...x });
          if (rg && !rg.ecart) ecrites.push({ ligneId: x.l.id, id: (await reglerBq(dossier, R, x.l, rg, false)).id });
        }
        banqueState.coches.clear();
        redessiner();
        const n = lot.length + ecrites.length;
        // Ce que chaque ligne a reçu, dit tel quel : l'écriture proposée, une remise et ses écritures, un règlement écrit.
        const remises = lot.filter(x => !x.c);
        const parts = [lot.length - remises.length ? `${lot.length - remises.length === n ? 'chacune' : lot.length - remises.length} avec l'écriture proposée` : '',
          remises.length ? (remises.length > 1 ? `${remises.length} remises avec leurs écritures` : `une remise avec ses ${remises[0].remise.length} écritures`) : '',
          ecrites.length ? `${pl(ecrites.length, 'règlement écrit', 'règlements écrits')} au brouillard d'après ${ecrites.length > 1 ? 'leurs factures' : 'sa facture'}` : ''].filter(Boolean);
        toastUndo(`${pl(n, 'ligne rapprochée', 'lignes rapprochées')} : ${parts.join(', ')}.`, async () => {
          try {
            if (lot.length) { const r2 = await api.rapprocherPlusieurs({ dossierId: dossier.id, annee: s.annee, releveId: R.id, choix: lot.map(x => ({ ligneId: x.l.id })) }); s.livre = r2.livre; }
            for (const e of ecrites) await defaireEcriteBq(dossier, R, e.ligneId, e.id);
            redessiner();
          } catch (e) { toast(plainError(e), 'error'); }
        });
      } catch (e) { redessiner(); toast(plainError(e), 'error'); }
    };
    // Le même bouton, dans le tableau au bureau et dans les cartes au téléphone.
    $$('[data-bq-valider]', el).forEach(b => { b.onclick = validerProposees; });

    // Le geste principal du livre en face : rapprocher l'écriture cochée, écrire d'après la règle, ou ouvrir l'écriture.
    const principal = async () => {
      if (!sel || lectureSeuleLivre()) return;
      const l = sel.l;
      if (sel.g === 'att') {
        if (sel.q.statut === 'repondue') return ecrireDepuisBanque(root, dossier, R, l);
        location.hash = `#/messages/${encodeURIComponent(dossier.id)}`;
        return;
      }
      const rg = reglementBq(R, sel);
      if (rg) {
        if (rg.ecart) { toast(`Les pièces cochées ne font pas la ligne (écart ${money(rg.ecart)}) : coche ce que la ligne paie.`, 'error'); return; }
        let fait = null;
        return gesteBanque(root, dossier, R, l.id, async () => { fait = await reglerBq(dossier, R, l, rg, rg.lettrable); return fait.msg; },
          rg.lettrable ? null : () => defaireEcriteBq(dossier, R, l.id, fait && fait.id));
      }
      const rm = remiseBq(dossier, R, sel);
      if (rm) {
        if (!rm.faces.length) { toast('Coche les écritures que la banque a remises ensemble.', 'error'); return; }
        if (rm.ecart) { toast(`Les écritures cochées ne font pas la ligne (écart ${money(rm.ecart)}) : coche celles de la remise.`, 'error'); return; }
        const [p0, ...plus] = rm.faces;
        return gesteBanque(root, dossier, R, l.id, async () => {
          await poserBq(dossier, R, l.id, p0.ecritureId, p0.ligne, plus);
          delete banqueState.remise[l.id];
          return plus.length ? `Rapprochée avec ${rm.faces.length} écritures (une remise).` : `Rapprochée avec ${pieceBq(ecritureDuLivre(s.livre, p0.ecritureId)) || 'l\'écriture'}.`;
        }, () => defaireBq(dossier, R, l.id));
      }
      const cle = c => c.ecritureId + '#' + c.ligne;
      const jug = sel.jug || { candidats: [], libres: [] };
      const choisi = banqueState.choix[l.id] != null ? banqueState.choix[l.id] : (sel.c ? cle(sel.c) : (jug.candidats.length === 1 ? cle(jug.candidats[0]) : ''));
      const cc = choisi ? jug.libres.find(c => cle(c) === choisi) : null;
      if (cc && KC.round3(Number(l.montant) - cc.montant) !== 0) { toast('Les deux montants ne sont pas égaux : une ligne du relevé se rapproche d\'une écriture du même montant.', 'error'); return; }
      if (cc) {
        const e = ecritureDuLivre(s.livre, cc.ecritureId);
        return gesteBanque(root, dossier, R, l.id, async () => { await poserBq(dossier, R, l.id, cc.ecritureId, cc.ligne); return `Rapprochée avec ${e ? pieceBq(e) : 'l\'écriture'}.`; },
          () => defaireBq(dossier, R, l.id));
      }
      if (sel.prop && !jug.candidats.length) {
        const compte = sel.prop.lignes[1].compte;
        let ecrite = '';
        return gesteBanque(root, dossier, R, l.id, async () => { ecrite = await ecrireEtRapprocher(dossier, R, l, compte); return `Écrite au brouillard (${compte}, d'après la règle « ${sel.prop.regle} ») et rapprochée.`; },
          () => defaireEcriteBq(dossier, R, l.id, ecrite));
      }
      return ecrireDepuisBanque(root, dossier, R, l);
    };
    sur('#bq-principal', principal);
    sur('#bq-autre', () => { if (sel) ecrireDepuisBanque(root, dossier, R, sel.l); });
    sur('#bq-demander', () => { if (sel) demanderLigneBq(root, dossier, R, sel.l); });
    sur('#bq-attente', () => { if (sel) mettreEnAttenteBq(root, dossier, R, sel.l); });
    sur('#bq-voir-ecriture', () => { if (sel && sel.e) ecritureDialog(sel.e, sel.rang); });
    sur('#bq-defaire', () => {
      if (!sel || !sel.e) return;
      const e = sel.e, rang = sel.rang, l = sel.l, autres = (sel.autres || []).map(f => ({ ecritureId: f.ecritureId, ligne: f.rang }));
      gesteBanque(root, dossier, R, l.id, async () => { await defaireBq(dossier, R, l.id); return autres.length ? 'Rapprochement défait : la ligne revient à traiter, les écritures de la remise restent au livre.' : 'Rapprochement défait : la ligne revient à traiter, l\'écriture reste au livre.'; },
        () => poserBq(dossier, R, l.id, e.id, rang, autres));
    });
    $$('[data-bq-voir-ecriture]', el).forEach(b => { b.onclick = () => { const e = ecritureDuLivre(s.livre, b.dataset.bqVoirEcriture); if (e) ecritureDialog(e, -1); }; });
    // Les termes de l'équation s'ouvrent : les lignes du relevé sans écriture se montrent dans la liste ; les écritures
    // pas encore passées en banque (chèques émis, virements en route) se listent.
    const eqB = $('#bq-eq-banque', el);
    if (eqB) { eqB.onclick = () => { banqueState.filtre = 'reste'; redessiner(); }; eqB.onkeydown = ev => { if (ev.key === 'Enter') eqB.click(); }; }
    const eqL = $('#bq-eq-livre', el);
    if (eqL) { eqL.onclick = () => suspensLivreDialog(R); eqL.onkeydown = ev => { if (ev.key === 'Enter') eqL.click(); }; }
    $$('[data-bq-etat]', el).forEach(b => { b.onclick = () => ouvrirEtatBq(root, dossier, R); });
    sur('#bq-chercher-ecart', () => {
      const EC = ecartBanque(R);
      banqueState.cherche = montant(Math.abs(EC.nonExplique)).replace(/ /g, ' ');
      redessiner();
      const n2 = $('#bq-cherche'); if (n2) { n2.scrollIntoView({ behavior: 'smooth', block: 'center' }); n2.focus(); }
    });
    sur('#bq-regles', () => ouvrirReglesBq(root, dossier, R));
    sur('#bq-revoir', () => { banqueState.revoir = R.id; redessiner(); });
    sur('#bq-annuler', async () => {
      const a = banqueState.annonce; banqueState.annonce = null;
      if (!a || !a.defaire) return redessiner();
      try { await a.defaire(); } catch (e) { toast(plainError(e), 'error'); }
      redessiner();
    });

    // Le clavier : ↑ ↓ une ligne, Espace coche, Entrée le geste principal, « / » la recherche. Un seul écouteur, qui se
    // retire de lui-même quand l'écran Banque n'est plus là.
    if (window.__bqClavier) document.removeEventListener('keydown', window.__bqClavier);
    window.__bqClavier = ev => {
      if (!document.body.contains(el) || !$('.bq2', el)) { document.removeEventListener('keydown', window.__bqClavier); window.__bqClavier = null; return; }
      const m = $('#modal-root');
      if (m && m.children.length) return;
      const t = ev.target;
      const dansChamp = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (ev.key === '/' && !dansChamp) { ev.preventDefault(); const c = $('#bq-cherche', el); if (c) c.focus(); return; }
      if (dansChamp || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (t && t.closest && t.closest('.row-menu, [role=menu]')) return;
      const visibles = $$('.bq-t [data-bq-ligne]', el).map(x => x.dataset.bqLigne);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!visibles.length) return;
        ev.preventDefault();
        const i = visibles.indexOf(banqueState.sel);
        const j = ev.key === 'ArrowDown' ? Math.min(visibles.length - 1, i + 1) : Math.max(0, i - 1);
        if (visibles[j] && visibles[j] !== banqueState.sel) {
          banqueState.sel = visibles[j]; banqueState.cherche = ''; redessiner();
          const tr = $(`.bq-t [data-bq-ligne="${CSS.escape(visibles[j])}"]`);
          if (tr) tr.scrollIntoView({ block: 'nearest' });
        }
      } else if (ev.key === ' ' && sel && sel.g === 'prop' && !(t && t.closest && t.closest('button,a'))) {
        ev.preventDefault();
        if (banqueState.coches.has(sel.l.id)) banqueState.coches.delete(sel.l.id); else banqueState.coches.add(sel.l.id);
        redessiner();
      } else if (ev.key === 'Enter' && !(t && t.closest && t.closest('button,a'))) {
        const b = $('#bq-principal', el);
        if (b) { ev.preventDefault(); b.click(); }
      } else if (/^[epadr]$/i.test(ev.key) && sel && sel.g !== 'ok' && !lectureSeuleLivre()) {
        // Les lettres du menu ⋯ (maquette) : E écrire, P une autre pièce, A au 471, D demander, R une règle.
        const g = gestesLigneBq(sel).find(a => a.note === ev.key.toUpperCase() && !a.off);
        if (g) { ev.preventDefault(); g.run(); }
      }
    };
    document.addEventListener('keydown', window.__bqClavier);

    // Le menu ⋯ d'une ligne, comme la maquette : chaque geste avec ce qu'il fait et sa lettre au clavier ; ce qui ne se fait
    // pas encore, grisé, dit pourquoi au clic (jamais un bouton qui ne répond rien).
    const gestesLigneBq = x => {
      const l = x.l;
      const motif = KC.motifDeLibelle(l.libelle);
      const regle = (Array.isArray(S.libelles) ? S.libelles : []).find(r => r && r.motif && motif && String(r.motif).toUpperCase() === String(motif).toUpperCase());
      const peutDemander = !dossier.manual && api.messagerie && api.question && x.g !== 'att';
      const n = (x.jug && x.jug.candidats ? x.jug.candidats.length : 0);
      return [
        { icon: 'nouveau', cle: 'ecrire-manquante', label: 'Écrire autre chose…', hint: 'une écriture à la main, au journal BQ, rapprochée du même geste', note: 'E', run: () => ecrireDepuisBanque(root, dossier, R, l) },
        { icon: 'loupe', cle: 'choisir-en-face', label: 'Choisir une autre pièce en face', hint: n > 1 ? `${n} écritures au même montant, et tout le compte` : 'toutes les écritures du compte, la bonne se pointe à la main', note: 'P', run: () => choisirEcritureForm(root, dossier, R, l) },
        { icon: 'copier', label: 'Partager entre plusieurs pièces', hint: 'toutes les factures non réglées en face : coche celles que la ligne paie (une remise de chèques)', run: () => { banqueState.sel = l.id; banqueState.toutes = l.id; banqueState.choix[l.id] = ''; redessiner(); } },
        { sep: true },
        { icon: 'horloge', label: 'Mettre au compte d\'attente (471)', hint: 'le mois se termine, la ligne reste à régler', note: 'A', run: () => mettreEnAttenteBq(root, dossier, R, l) },
        peutDemander ? { icon: 'message', label: `Demander ${aClientBq(dossier)} ce que c'est`, hint: 'dans votre conversation, la ligne du relevé citée', note: 'D', run: () => demanderLigneBq(root, dossier, R, l) } : null,
        { icon: 'texte', label: 'Retenir une règle d\'après cette ligne', hint: regle ? `« ${regle.motif} » en a déjà une (${regle.compte}) : la revoir` : motif ? `le compte se proposera aux lignes qui contiennent « ${motif} »` : 'son libellé est trop courant pour une règle', note: 'R', off: !regle && !motif, run: () => (regle ? ouvrirReglesBq(root, dossier, R) : motif ? ouvrirReglesBq(root, dossier, R, { motif, depuis: l.libelle, sens: Number(l.montant) < 0 ? 'debit' : 'credit' }) : toast('Ce libellé est trop courant pour une règle : elle proposerait le compte à trop de lignes.')) },
        { sep: true },
        { icon: 'annuler', label: 'Défaire le rapprochement', hint: 'rien à défaire : la ligne n\'est pas encore rapprochée', off: true, run: () => toast('Rien à défaire : la ligne n\'est pas encore rapprochée.') }
      ].filter(Boolean);
    };

    // Défaire tous les rapprochements d'un relevé (le pied des rapprochées ouvertes, et le menu ⋯ du relevé).
    const defaireTous = async rel => {
      // « Annuler » repose chaque ligne sur l'écriture qu'elle avait.
      const avant = rel.lignes.filter(l => l.rapprochement && l.rapprochement.ecritureId)
        .map(l => ({ ligneId: l.id, ecritureId: l.rapprochement.ecritureId, ligne: l.rapprochement.ligne, auto: l.rapprochement.par === 'auto',
          ...(Array.isArray(l.rapprochement.autres) && l.rapprochement.autres.length ? { autres: l.rapprochement.autres.map(a => ({ ecritureId: a.ecritureId, ligne: a.ligne })) } : {}) }));
      try {
        const x = await api.derapprocher({ dossierId: dossier.id, annee: s.annee, releveId: rel.id });
        s.livre = x.livre;
        redessiner();
        if (!x.defaits) { toast('Aucun rapprochement à défaire.'); return; }
        toastUndo(`${pl(x.defaits, 'rapprochement défait', 'rapprochements défaits')}.`, async () => {
          try { const r2 = await api.rapprocherPlusieurs({ dossierId: dossier.id, annee: s.annee, releveId: rel.id, choix: avant }); s.livre = r2.livre; redessiner(); }
          catch (e) { toast(plainError(e), 'error'); }
        });
      } catch (e) { toast(plainError(e), 'error'); }
    };
    sur('[data-bq-defaire-tous]', () => defaireTous(R));
    // Les gestes du relevé vivent dans le ⋯ de la page (maquette : deux boutons seulement à côté du relevé). Ce qui se
    // détruit demande, ce qui se répare se propose (règle 7.29.0).
    banqueState.gestesReleve = lectureSeuleLivre() ? null : () => {
      const k = R.lignes.filter(l => l.rapprochement && l.rapprochement.ecritureId).length;
      const nR = (Array.isArray(S.libelles) ? S.libelles : []).filter(x => x && x.motif && x.compte).length;
      return [
        { icon: 'texte', label: 'Les règles de la banque', hint: nR ? `${pl(nR, 'règle')} : un mot du libellé, le compte qu'il propose` : 'aucune encore : elles se retiennent en écrivant une ligne', run: () => ouvrirReglesBq(root, dossier, R) },
        { icon: 'non', label: 'Défaire tous les rapprochements', hint: k ? `Les ${pl(k, 'ligne rapprochée', 'lignes rapprochées')} de ce relevé se défont d'un coup ; les écritures restent au livre` : 'Aucune ligne de ce relevé n\'est rapprochée', run: () => defaireTous(R) },
        { icon: 'supprimer', label: 'Retirer ce relevé', hint: 'Le fichier sort du livre ; les écritures qu\'il a servi à créer restent au livre', run: () => retirerReleve(root, dossier, R) }
      ];
    };
    // « Défaire » au bout d'une rapprochée ouverte : la ligne revient à traiter, « Annuler » la repose.
    $$('[data-bq-defaire]', el).forEach(b => { b.onclick = () => {
      const x = parId.get(b.dataset.bqDefaire);
      if (!x || lectureSeuleLivre()) return;
      const e = x.e, rang = x.rang, autres = (x.autres || []).map(f => ({ ecritureId: f.ecritureId, ligne: f.rang }));
      gesteBanque(root, dossier, R, x.l.id, async () => { await defaireBq(dossier, R, x.l.id); return autres.length ? 'Rapprochement défait : la ligne revient à traiter, les écritures de la remise restent au livre.' : 'Rapprochement défait : la ligne revient à traiter, l\'écriture reste au livre.'; }, e ? () => poserBq(dossier, R, x.l.id, e.id, rang, autres) : null);
    }; });

    // UNE seule table d'actions par racine : `bindRowMenus` écrase la précédente en silence (9.4.8).
    bindRowMenus(el, cle => {
      const x = parId.get(cle.slice(4));
      if (!x) return [];
      const l = x.l;
      const actions = [];
      if (x.g === 'ok') {
        if (x.e) actions.push({ icon: 'loupe', label: 'Voir l\'écriture en face', hint: `${pieceBq(x.e)} — toutes ses lignes`, run: () => ecritureDialog(x.e, x.rang) });
        if (!lectureSeuleLivre()) actions.push({ icon: 'non', label: 'Défaire le rapprochement', hint: 'Même « d\'office » se défait : l\'automatique propose, c\'est toi qui décides', run: () => {
          const e = x.e, rang = x.rang;
          gesteBanque(root, dossier, R, l.id, async () => { await defaireBq(dossier, R, l.id); return 'Rapprochement défait : la ligne revient à traiter.'; }, e ? () => poserBq(dossier, R, l.id, e.id, rang) : null);
        } });
        return actions;
      }
      if (lectureSeuleLivre()) return [];
      return gestesLigneBq(x);
    });
  }

  function demanderLigneBq(root, dossier, R, l) {
    const m = Math.abs(Number(l.montant) || 0);
    const sens = Number(l.montant) < 0 ? 'sorti' : 'entré';
    questionForm(root, dossier, {
      periode: String(l.date).slice(0, 7), montant: m, compte: /^[0-9]{1,12}$/.test(String(R.compte || '')) ? String(R.compte) : '', piece: l.reference || '',
      icone: 'banque', titre: `${l.libelle || 'Ligne du relevé'}`, sous: `relevé${R.banque ? ` ${R.banque}` : ''} · ${fmtJour(l.date)} · ${money(m)} ${sens}`,
      objet: `Relevé du ${fmtJour(l.date)} : ${l.libelle || ''}`.slice(0, 200),
      quoi: `ce mouvement de ${money(m)} ${sens} le ${fmtJour(l.date)} sur ton relevé${l.libelle ? ` (« ${l.libelle} »)` : ''}`,
      attendu: 'explication',
      // (1.221.0, l'épreuve d'un mois) La question partie, la ligne attend le client : on passe à la suivante, comme après
      // tout geste (un Entrée de plus n'ouvre pas la conversation à la place du travail qui reste).
      apres: () => {
        const suivante = suivanteBq(dossier, R, l.id) || l.id;
        banqueState.sel = suivante;
        banqueState.annonce = { sel: suivante, msg: `« ${String(l.libelle || 'Ligne du relevé').slice(0, 40)} » : demandée à ${contactBq(dossier) || 'le client'} ; elle attend sa réponse${suivante !== l.id ? ' ; la ligne suivante est choisie' : ''}.`, defaire: null };
        drawLivres(root, dossier);
      }
    });
  }
  // Au compte d'attente : une écriture au brouillard 532 / 471, rapprochée ; elle se régularisera de la réponse. Ce qui
  // part au 471 se DEMANDE avant (un compte d'attente qu'on remplit sans le dire, personne ne le solde).
  async function mettreEnAttenteBq(root, dossier, R, l) {
    const ok = await confirmDialog(`Mettre ${money(l.montant)} au compte d'attente ?`,
      `« ${l.libelle || 'Ligne du relevé'} » du ${fmtJour(l.date)} s'écrit au brouillard en 471 (compte d'attente), rapprochée du relevé. Elle reste à régulariser quand on saura ce que c'est : la révision la montrera tant que le 471 n'est pas soldé.`,
      'Mettre au 471');
    if (!ok) return;
    let ecrite = '';
    gesteBanque(root, dossier, R, l.id, async () => { ecrite = await ecrireEtRapprocher(dossier, R, l, '471', `${l.libelle || 'Mouvement bancaire'} · en attente`); return 'Au compte d\'attente (471), au brouillard, et rapprochée.'; },
      () => defaireEcriteBq(dossier, R, l.id, ecrite));
  }
  // Les écritures du livre pas encore passées en banque : les chèques émis, les virements en route.
  function suspensLivreDialog(R) {
    const EC = ecartBanque(R);
    modal(`<h2>Pas encore passées en banque</h2>
      <p class="small muted">Écrites au ${esc(R.compte)} jusqu'au ${esc(fmtJour(R.au))}, sans ligne sur ce relevé : un chèque émis que le fournisseur n'a pas encore remis, un virement en route. Ce n'est pas une erreur : c'est ce qui explique une part de l'écart.</p>
      <div class="scroll-x" style="max-height:360px"><table class="list compact"><thead><tr><th class="nw">Date</th><th class="nw">Pièce</th><th>Libellé</th><th class="r nw">Montant</th></tr></thead>
      <tbody>${EC.livreRec.map(x => `<tr><td class="nw">${esc(fmtJour(x.date))}</td><td class="nw mono">${esc(`${x.journal || ''} ${x.piece || ''}`.trim())}</td><td class="tronq" title="${esc(x.libelle || '')}">${esc(x.libelle || '')}</td><td class="r nw">${esc(money(x.montant))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>Total</b></td><td class="r nw"><b>${esc(money(EC.sLr))}</b></td></tr></tfoot></table></div>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`, layer => { $('.modal', layer).classList.add('cab-moyen'); });
  }
  // Les règles (les mots retenus) dans leur fenêtre : on les relit, on retire celle qui se trompe.
  // (1.209.0, maquette « les règles ») Les règles de la banque sont une page de la Banque : le tableau (le mot du libellé,
  // le sens, le montant au plus, le compte, la TVA, combien de lignes de ce dossier elle prend et la dernière), « Nouvelle
  // règle » avec ce qu'elle prendrait AVANT de l'enregistrer (et la règle qui les prenait déjà), les taux de retenue.
  // Une règle propose ; elle n'écrit jamais sans le comptable. Les règles valent pour tous les dossiers du cabinet.
  const reglesBq = () => (Array.isArray(S.libelles) ? S.libelles : []).filter(x => x && x.motif && x.compte);
  const cleRegleBq = x => `${x.motif}|${x.sens || ''}|${x.auPlusMillimes || ''}`;
  const lignesDuDossierBq = () => (livresState.livre.releves || []).flatMap(r => (r.lignes || []).map(l => ({ l, r })));
  // Les lignes qu'une table de règles donne à chaque règle (la plus précise passe), en une passe.
  const prisesParRegleBq = (table, lignes) => {
    const m = new Map();
    lignes.forEach(x => { const t = KC.compteDuLibelle(table, x.l.libelle, x.l.montant); if (t && t.regle) { const k = cleRegleBq(t.regle); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } });
    return m;
  };
  const sensBq = x => (x.sens === 'debit' ? 'débit' : x.sens === 'credit' ? 'crédit' : 'les deux');
  const auPlusBq = x => (Number(x.auPlusMillimes) > 0 ? `jusqu'à ${montant(Number(x.auPlusMillimes) / 1000)}` : '');
  function ouvrirReglesBq(root, dossier, R, brouillon) {
    banqueState.regles = R.id; banqueState.etat = '';
    banqueState.nouvelle = brouillon || null;
    drawLivres(root, dossier);
  }
  function vueReglesBq(dossier, R, lect) {
    const table = reglesBq();
    const nom = nomDeCompte();
    const lignes = lignesDuDossierBq();
    const prises = prisesParRegleBq(table, lignes);
    const n = banqueState.nouvelle;
    const ligneT = (x, i) => {
      const ps = prises.get(cleRegleBq(x)) || [];
      const der = ps.map(y => y.l.date).sort().pop();
      return `<tr><td><div class="bq-lb">${icNature(x.motif, x.sens === 'credit' ? 1 : -1)}<b class="mono" style="align-self:center">${esc(x.motif)}</b></div>${KC.motifDeLibelle(x.motif) ? '' : ' <small class="mu">trop courant : ne propose plus rien</small>'}</td>
        <td>${esc(sensBq(x))}${auPlusBq(x) ? `<small class="bq-p">${esc(auPlusBq(x))}</small>` : ''}</td>
        <td><span class="mono">${esc(x.compte)}</span> <span class="mu">${esc(nom(x.compte))}</span></td>
        <td>${x.tva ? `${esc(String(x.tva.taux).replace('.', ','))} % · <span class="mono">${esc(x.tva.compte)}</span> <small class="bq-p">À VÉRIFIER</small>` : '<span class="mu">—</span>'}</td>
        <td class="r"><b>${ps.length}</b><small class="bq-p">${ps.length ? `ici · la dernière le ${esc(fmtJour(der).slice(0, 5))}` : 'aucune ligne ici'}</small></td>
        ${lect ? '<td></td>' : `<td class="actions row-actions bqr-act"><button type="button" class="cp-plus" data-bqr-modifier="${i}">Modifier</button>${RowMenu.bouton('REG:' + i, '⋯', 'bqr-plus').replace('<button ', `<button aria-label="Plus de gestes pour la règle ${esc(x.motif)}" `)}</td>`}</tr>`;
    };
    const form = n && !lect ? formRegleBq(n, table, lignes, nom) : '';
    return `<div class="bq-ecran bqr-page"><div class="bq-h"><div><b>Les règles de la banque · ${table.length}</b><span class="mu">elles proposent l'écriture des lignes que rien ne rapproche : frais, agios, prélèvements, salaires · pour tous les dossiers du cabinet</span></div>
        <button type="button" class="btn btn-sm btn-ghost" id="bqr-retour">Retour au relevé</button>${lect || n ? '' : '<button type="button" class="btn btn-sm btn-primary" id="bqr-nouvelle">Nouvelle règle</button>'}</div>
      ${form}
      ${table.length ? `<div class="scroll-x"><table class="list compact bqr-t" data-cartes="oui"><thead><tr><th>Quand le libellé contient</th><th>Sens</th><th>Compte</th><th>TVA</th><th class="r">A servi</th><th></th></tr></thead>
        <tbody>${table.map(ligneT).join('')}</tbody></table></div>`
        : '<div class="empty mini">Aucune règle encore : « Nouvelle règle », ou en écrivant une ligne du relevé (« Proposer ce compte aux lignes qui contiennent… »).</div>'}
      <p class="bqr-pied">Une règle propose ; elle n'écrit jamais sans toi. Ses lignes arrivent « À traiter » avec la règle dite, et tu valides. Quand deux règles prennent la même ligne, la plus précise passe d'abord (le mot le plus long, puis le sens, puis le montant) et la page le dit avant d'enregistrer. « A servi » compte les lignes des relevés de ce dossier qu'elle prend.</p>
      <h3 class="bq-st2">Les taux de retenue à la source</h3>
      <p class="small muted">Une ligne qui paie une facture moins sa retenue se reconnaît à ces taux, au millime près (« net de sa retenue »). Sans taux, rien ne se reconnaît ainsi : la ligne reste un écart. <b>À VÉRIFIER</b> avec le comptable : les taux en vigueur et leur assiette.</p>
      ${lect ? `<p>${tauxRetenueBq().length ? esc(tauxRetenueBq().map(t => String(t).replace('.', ',') + ' %').join(', ')) : 'aucun taux'}</p>` : `<div class="bq-taux"><label class="field">${lbl('Taux, en %', 'bq.taux')}<input id="bq-taux" inputmode="decimal" placeholder="par exemple 1,5 ; 3" value="${esc(tauxRetenueBq().map(t => String(t).replace('.', ',')).join(' ; '))}"></label>
        <button type="button" class="btn btn-sm" id="bq-taux-ok">Retenir ces taux</button></div>`}</div>`;
  }
  // Le brouillon d'une règle, tel qu'il se lit des champs (montants en millimes, entiers).
  const regleDuBrouillonBq = n => {
    const x = { motif: String(n.motif || '').trim(), compte: String(n.compte || '').trim() };
    if (n.sens === 'debit' || n.sens === 'credit') x.sens = n.sens;
    const mx = KC.nombreStrict(String(n.auPlus || '').replace(/\s/g, '').replace(',', '.'));
    if (String(n.auPlus || '').trim() && Number.isFinite(mx) && mx > 0) x.auPlusMillimes = Math.round(mx * 1000);
    const t = String(n.tvaTaux || '').trim().replace(',', '.');
    if (t && String(n.tvaCompte || '').trim()) x.tva = { taux: String(Number(t)), compte: String(n.tvaCompte).trim() };
    return x;
  };
  // Ce que la règle prendrait dans les relevés de ce dossier, et à quelle règle ces lignes allaient : dit avant d'enregistrer.
  function apercuRegleBq(n, table, lignes) {
    const x = regleDuBrouillonBq(n);
    if (!x.motif || !x.compte) return '<span class="mu">Le mot du libellé et le compte disent ce qu\'elle prendrait.</span>';
    const autres = table.filter((y, i) => i !== n.index);
    const avant = new Map(lignes.map(y => [y, KC.compteDuLibelle(autres, y.l.libelle, y.l.montant)]));
    const apres = lignes.map(y => [y, KC.compteDuLibelle([...autres, x], y.l.libelle, y.l.montant)]);
    const prend = apres.filter(([, t]) => t && t.regle === x).map(([y]) => y);
    const vole = prend.filter(y => avant.get(y));
    const restent = apres.filter(([y, t]) => t && t.regle !== x && KC.compteDuLibelle([x], y.l.libelle, y.l.montant)).map(([, t]) => t.motif);
    const somme = KC.round3(prend.reduce((s2, y) => s2 + Math.abs(Number(y.l.montant) || 0), 0));
    const voir = banqueState.nouvelleVoir && prend.length ? `<ul class="bqr-vu">${prend.slice(0, 12).map(y => `<li><span>${esc(fmtJour(y.l.date).slice(0, 5))}</span><span class="mono">${esc(y.l.libelle || '')}</span><b>${montantSigne(y.l.montant)}</b></li>`).join('')}${prend.length > 12 ? `<li class="mu">… et ${prend.length - 12} autres</li>` : ''}</ul>` : '';
    return `<span>Elle prendrait <b>${pl(prend.length, 'ligne')}</b> des relevés de ce dossier${prend.length ? ` (${esc(money(somme))})` : ''}</span>${prend.length ? `<button type="button" class="cp-plus" id="bqr-voir">${banqueState.nouvelleVoir ? 'Les cacher' : 'Les voir'}</button>` : ''}
      ${vole.length ? `<span class="ambre">${pl(vole.length, 'ligne')} allai${vole.length > 1 ? 'ent' : 't'} à « ${esc([...new Set(vole.map(y => avant.get(y).motif))].join(' », « '))} » : celle-ci, plus précise, passe devant</span>`
        : restent.length ? `<span class="ambre">${pl(restent.length, 'ligne')} qui ${restent.length > 1 ? 'contiennent' : 'contient'} le mot ${restent.length > 1 ? 'restent' : 'reste'} à « ${esc([...new Set(restent)].join(' », « '))} », plus précise</span>`
        : `<span class="ok">${svgBq(BQ_IC.ok, 13)} aucune autre règle ne prend ces lignes</span>`}${voir}`;
  }
  function formRegleBq(n, table, lignes, nom) {
    const ch = (lab, html, aide = '') => `<label class="bqr-ch"><span>${lab}</span>${html}${aide ? `<small>${aide}</small>` : ''}</label>`;
    return `<div class="bqr-n" id="bqr-n"><b>${n.index != null ? `Modifier la règle « ${esc(n.motif)} »` : 'Nouvelle règle'}</b>
      <div class="bqr-g">
        ${ch('Quand le libellé contient', `<input id="bqr-motif" class="mono" maxlength="40" value="${esc(n.motif || '')}" placeholder="VERS ESP">`, n.depuis ? `tapé d'après « ${esc(n.depuis)} »` : 'un mot du libellé, au moins 4 lettres')}
        ${ch('Sens', `<select id="bqr-sens"><option value="">Les deux</option><option value="debit"${n.sens === 'debit' ? ' selected' : ''}>Débit (sort)</option><option value="credit"${n.sens === 'credit' ? ' selected' : ''}>Crédit (entre)</option></select>`)}
        ${ch('Montant au plus', `<input id="bqr-auplus" inputmode="decimal" value="${esc(n.auPlus || '')}" placeholder="tous">`, 'vide : tous les montants')}
        ${ch('Compte', `<input id="bqr-compte" class="mono" inputmode="numeric" maxlength="12" value="${esc(n.compte || '')}" placeholder="6278">`, `<span id="bqr-nom">${esc(n.compte ? nom(n.compte) || 'pas dans le plan' : '')}</span>`)}
        ${ch('TVA', `<span class="bqr-tva"><input id="bqr-tva" inputmode="decimal" value="${esc(n.tvaTaux || '')}" placeholder="aucune" aria-label="Taux de TVA, en %"><input id="bqr-tvac" class="mono" inputmode="numeric" maxlength="12" value="${esc(n.tvaCompte || '')}" placeholder="compte" aria-label="Compte de TVA"></span>`, 'le taux, en %, et son compte · À VÉRIFIER')}
        ${ch('Journal', '<span class="bqr-in">BQ</span>')}
      </div>
      <div class="bqr-ap" id="bqr-ap">${apercuRegleBq(n, table, lignes)}</div>
      <div class="cp-gestes"><button type="button" class="btn btn-primary" id="bqr-ok">Enregistrer la règle</button><button type="button" class="btn" id="bqr-annuler">Annuler</button></div></div>`;
  }
  function brancherReglesBq(el, root, dossier, R) {
    const redessiner = () => drawLivres(root, dossier);
    const sur = (q, fn) => { const b = $(q, el); if (b) b.onclick = fn; };
    sur('#bqr-retour', () => { banqueState.regles = ''; banqueState.nouvelle = null; redessiner(); });
    // (1.215.0, la maquette) « Modifier » au bout de chaque règle ; le reste dans son ⋯.
    $$('[data-bqr-modifier]').forEach(bt => { bt.onclick = () => { const i = Number(bt.dataset.bqrModifier), x = reglesBq()[i]; if (!x) return;
      banqueState.nouvelle = { index: i, motif: x.motif, sens: x.sens || '', auPlus: x.auPlusMillimes ? montant(x.auPlusMillimes / 1000) : '', compte: x.compte, tvaTaux: x.tva ? String(x.tva.taux).replace('.', ',') : '', tvaCompte: x.tva ? x.tva.compte : '' };
      redessiner(); const m = $('#bqr-motif'); if (m) m.focus(); }; });
    sur('#bqr-nouvelle', () => { banqueState.nouvelle = {}; banqueState.nouvelleVoir = false; redessiner(); const m = $('#bqr-motif'); if (m) m.focus(); });
    sur('#bqr-annuler', () => { banqueState.nouvelle = null; redessiner(); });
    const n = banqueState.nouvelle;
    const champs = { motif: '#bqr-motif', sens: '#bqr-sens', auPlus: '#bqr-auplus', compte: '#bqr-compte', tvaTaux: '#bqr-tva', tvaCompte: '#bqr-tvac' };
    const lire = () => { Object.entries(champs).forEach(([k, q]) => { const c = $(q, el); if (c) n[k] = c.value; }); };
    // L'aperçu se refait à chaque frappe, sans redessiner la page (le curseur reste où il est).
    const apercu = () => {
      lire();
      const ap = $('#bqr-ap', el); if (ap) ap.innerHTML = apercuRegleBq(n, reglesBq(), lignesDuDossierBq());
      const nm = $('#bqr-nom', el); if (nm) nm.textContent = n.compte ? nomDeCompte()(n.compte.trim()) || 'pas dans le plan' : '';
      const v = $('#bqr-voir', el); if (v) v.onclick = () => { banqueState.nouvelleVoir = !banqueState.nouvelleVoir; apercu(); };
    };
    if (n) { Object.values(champs).forEach(q => { const c = $(q, el); if (c) c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', apercu); }); apercu(); }
    sur('#bqr-ok', async () => {
      lire();
      const x = regleDuBrouillonBq(n);
      // Chaque refus dit ce qui est refusé, pourquoi, et montre le champ.
      if (!x.motif || x.motif.length < 3) { refus($('#bqr-motif', el), 'Écris un mot du libellé (au moins 3 lettres) : c\'est lui qui reconnaît les lignes.'); return; }
      if (!KC.motifDeLibelle(x.motif)) { refus($('#bqr-motif', el), `« ${x.motif} » est trop courant dans les relevés (il prendrait n'importe quelle ligne) : choisis un mot plus précis.`); return; }
      if (!/^\d{1,12}$/.test(x.compte)) { refus($('#bqr-compte', el), 'Le compte s\'écrit en chiffres (par exemple 6278).'); return; }
      if (String(n.auPlus || '').trim() && !x.auPlusMillimes) { refus($('#bqr-auplus', el), `« ${n.auPlus} » n'est pas un montant : laisse vide pour tous les montants, ou écris par exemple 50,000.`); return; }
      const tTxt = String(n.tvaTaux || '').trim();
      if (tTxt && (!/^\d{1,2}([.,]\d{1,4})?$/.test(tTxt) || !(Number(tTxt.replace(',', '.')) > 0))) { refus($('#bqr-tva', el), `« ${tTxt} » n'est pas un taux : écris un nombre entre 0 et 100 (par exemple 19), ou laisse vide.`); return; }
      if (tTxt && !/^\d{1,12}$/.test(String(n.tvaCompte || '').trim())) { refus($('#bqr-tvac', el), 'Une TVA va à un compte : écris-le en chiffres (À VÉRIFIER avec le plan du dossier).'); return; }
      const avant = reglesBq();
      const autres = avant.filter((y, i) => i !== n.index);
      if (autres.some(y => cleRegleBq(y) === cleRegleBq(x))) { refus($('#bqr-motif', el), `Une règle « ${x.motif} » avec ce sens et ce montant existe déjà : modifie-la dans le tableau.`); return; }
      const apres = n.index != null ? avant.map((y, i) => (i === n.index ? x : y)) : [...avant, x];
      try {
        S = await api.saveBanque({ libelles: apres });
        banqueState.nouvelle = null;
        redessiner();
        toastUndo(n.index != null ? `La règle « ${x.motif} » est modifiée.` : `La règle « ${x.motif} » proposera le ${x.compte} aux lignes qui la contiennent.`, async () => { S = await api.saveBanque({ libelles: avant }); redessiner(); });
      } catch (e) { toast(plainError(e), 'error'); }
    });
    // Les taux, séparés par « ; » (ou des espaces) ; un taux qui n'en est pas un se refuse en montrant le champ.
    const champT = $('#bq-taux', el);
    sur('#bq-taux-ok', async () => {
      const morceaux = String(champT.value || '').split(/[;\s]+/).map(x => x.trim()).filter(Boolean);
      const faux = morceaux.find(x => !/^\d{1,2}([.,]\d{1,4})?$/.test(x) || !(Number(x.replace(',', '.')) > 0));
      if (faux) { refus(champT, `« ${faux} » n'est pas un taux : écris des nombres entre 0 et 100, séparés par « ; » (par exemple 1,5 ; 3).`); return; }
      const taux = [...new Set(morceaux.map(x => String(Number(x.replace(',', '.')))))];
      try {
        S = await api.saveBanque({ tauxRetenue: taux });
        redessiner();
        toast(taux.length ? `${pl(taux.length, 'taux retenu', 'taux retenus')} : ${taux.map(t => t.replace('.', ',') + ' %').join(', ')}.` : 'Plus aucun taux : aucune ligne ne se lira « au net de sa retenue ».');
      } catch (e) { toast(plainError(e), 'error'); }
    });
    bindRowMenus(el, cle => {
      if (!cle.startsWith('REG:')) return [];
      const i = Number(cle.slice(4));
      const x = reglesBq()[i];
      if (!x) return [];
      return [
        { icon: 'modifier', label: 'Modifier cette règle', hint: 'le mot, le sens, le montant, le compte, la TVA', run: () => {
          banqueState.nouvelle = { index: i, motif: x.motif, sens: x.sens || '', auPlus: x.auPlusMillimes ? montant(x.auPlusMillimes / 1000) : '', compte: x.compte, tvaTaux: x.tva ? String(x.tva.taux).replace('.', ',') : '', tvaCompte: x.tva ? x.tva.compte : '' };
          redessiner();
        } },
        { icon: 'supprimer', label: 'Retirer cette règle', hint: 'Les prochains relevés ne proposeront plus ce compte ; les écritures déjà passées ne bougent pas', run: async () => {
          const avant = reglesBq();
          try {
            S = await api.saveBanque({ libelles: avant.filter((y, j) => j !== i) });
            redessiner();
            toastUndo(`« ${x.motif} » ne proposera plus de compte.`, async () => { S = await api.saveBanque({ libelles: avant }); redessiner(); });
          } catch (e) { toast(plainError(e), 'error'); }
        } }
      ];
    });
  }

  // L'état de rapprochement, tel qu'il s'imprime pour le dossier de révision : les deux côtés, chacun rectifié, et leur
  // égalité ; « provisoire » tant qu'il reste des lignes du relevé à écrire. La page part au serveur, qui en fait le PDF.
  const moiNom = () => { const c = ((S && S.collaborateurs) || []).find(x => x.id === S.moi) || {}; return c.nom || c.name || ''; };
  function etatRapprochementHtml(dossier, R, EC) {
    const L = livresState.livre;
    // Provisoire tant qu'une ligne du relevé n'a pas d'écriture ; une ligne écrite après la date du relevé est un décalage
    // de dates, pas un manque.
    const lignesB = EC.banqueAll, aEcrire = lignesB.filter(x => !x.ecritLe).length, provisoire = aEcrire > 0;
    const banqueRect = KC.round3(EC.sus.soldeFin + EC.sLr);
    const livreRect = KC.round3(EC.sus.soldeComptable + EC.sB);
    const egaux = KC.round3(banqueRect - livreRect) === 0;
    const l = (lab, v, cl = '') => `<tr class="${cl}"><td>${esc(lab)}</td><td class="r">${v == null ? '' : esc(montant(v))}</td></tr>`;
    const nomDossier = dossier.name || '';
    const aujourdhui = K.today();
    return `<div class="bqe${provisoire ? ' prov' : ''}" role="document" aria-label="L'état de rapprochement">
      <div class="bqe-h"><div><b>État de rapprochement bancaire</b><br><span>${esc(nomDossier)} · compte ${esc(R.compte)}${R.banque ? ` ${esc(R.banque)}` : ''} · exercice ${esc(String(livresState.annee))}</span></div>
        <div style="text-align:right"><b>au ${esc(fmtJour(R.au))}</b><br><span>relevé du ${esc(fmtJour(R.du))} · ${pl(R.lignes.length, 'mouvement')}</span></div></div>
      <div class="bqe-c">
        <table><thead><tr><th>Côté banque</th><th></th></tr></thead><tbody>
          ${l(`Solde du relevé au ${fmtJour(R.au)}`, EC.sus.soldeFin)}
          ${EC.livreRec.length ? `<tr class="st"><td colspan="2">Écritures du livre pas encore passées en banque</td></tr>${EC.livreRec.map(x => l(`${fmtJour(x.date).slice(0, 5)} · ${x.piece && !String(x.libelle || '').startsWith(x.piece) ? `${x.piece} ` : ''}${x.libelle || ''}`.trim(), x.montant, 'sous')).join('')}` : ''}
          ${l('Solde rectifié', banqueRect, 'tot')}</tbody></table>
        <table><thead><tr><th>Côté livre (${esc(R.compte)})</th><th></th></tr></thead><tbody>
          ${l(`Solde du livre au ${fmtJour(R.au)}`, EC.sus.soldeComptable)}
          ${lignesB.length ? `<tr class="st"><td colspan="2">Mouvements du relevé pas encore au livre</td></tr>${lignesB.map(x => l(`${fmtJour(x.date).slice(0, 5)} · ${x.libelle || ''}${x.ecritLe ? ` (écrite le ${fmtJour(x.ecritLe).slice(0, 5)})` : ''}`, x.montant, 'sous')).join('')}` : ''}
          ${l('Solde rectifié', livreRect, 'tot')}</tbody></table>
      </div>
      <div class="bqe-eg ${egaux ? '' : 'ko'}">${egaux ? `✓ Les deux soldes rectifiés sont égaux : ${esc(montant(banqueRect))} DT` : `Écart non expliqué : ${esc(montant(KC.round3(banqueRect - livreRect)))} DT`}</div>
      <div class="bqe-p"><span>Préparé le ${esc(fmtJour(aujourdhui))}${moiNom() ? ` par ${esc(moiNom())}` : ''}</span><span>${pl(R.lignes.filter(x => x.rapprochement && x.rapprochement.ecritureId).length, 'mouvement rapproché', 'mouvements rapprochés')} sur ${R.lignes.length}${provisoire ? ` · provisoire : ${pl(aEcrire, 'ligne')} à écrire` : ''}</span></div>
      <div class="bqe-sig"><span>Le comptable</span><span>Pour ${esc(nomDossier || 'le client')}</span></div></div>`;
  }
  // (1.209.0, maquette « l'état de rapprochement ») L'état est une page de la Banque, plus une fenêtre : la feuille telle
  // qu'elle s'imprime, « Retour au relevé », « Joindre au dossier de révision » (le PDF rangé dans le classeur du client, au
  // mois du relevé, dans « Le travail du cabinet », classé) et « Télécharger le PDF ». Joint une deuxième fois, il remplace
  // le premier (qui reste, marqué remplacé) : le classeur garde un état par relevé, le dernier.
  const titreEtatBq = R => `État de rapprochement du relevé ${R.compte}${R.banque ? ` ${R.banque}` : ''} au ${fmtJour(R.au)}`;
  const nomEtatBq = R => `etat-rapprochement-${R.compte}-${R.au}.pdf`;
  const pageEtatBq = (R, corps) => {
    const css = [...document.styleSheets].map(f => { try { return [...f.cssRules].filter(r => /\.bqe/.test(r.cssText)).map(r => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titreEtatBq(R))}</title><style>body{margin:24px;font:13px Helvetica,Arial,sans-serif}${css}</style></head><body>${corps}</body></html>`;
  };
  function vueEtatBq(dossier, R, EC, lect) {
    const k = EC.banqueAll.filter(x => !x.ecritLe).length;
    const j = banqueState.etatJoint && banqueState.etatJoint.releve === R.id ? banqueState.etatJoint : null;
    const joindre = !lect && api.classeur && api.classeur.deposerPdf
      ? `<button type="button" class="btn btn-sm" id="bqe-joindre">${j && j.doc ? 'Joindre à nouveau (remplace)' : 'Joindre au dossier de révision'}</button>` : '';
    return `<div class="bq-ecran bqe-page"><div class="bq-h"><div><b>L'état de rapprochement · ${esc(R.compte)}${R.banque ? ` ${esc(R.banque)}` : ''} · au ${esc(fmtJour(R.au))}</b>
        <span class="mu">${k ? `provisoire : ${pl(k, 'ligne')} du relevé ${k > 1 ? 'ne sont' : 'n\'est'} pas encore ${k > 1 ? 'écrites' : 'écrite'} · il deviendra définitif quand ${k > 1 ? 'elles le seront' : 'elle le sera'}` : 'définitif : chaque ligne du relevé a son écriture'}</span></div>
        <button type="button" class="btn btn-sm btn-ghost" id="bqe-retour">Retour au relevé</button>${joindre}<button type="button" class="btn btn-sm btn-primary" id="bqe-pdf">${svgBq(BQ_IC.pdf, 15)} Télécharger le PDF</button></div>
      <p class="bqe-joint${j && j.ko ? ' ko' : ''}" id="bqe-joint" role="status"${j && j.texte ? '' : ' hidden'}>${j && j.texte ? j.texte : ''}</p>
      <div class="bqe-fond">${etatRapprochementHtml(dossier, R, EC)}</div></div>`;
  }
  // Ce que le classeur a déjà pour ce relevé : le dernier état joint (pas remplacé).
  const etatDejaJointBq = (docs, R) => (docs || []).find(x => x.rubrique === 'piece' && !x.remplacePar && x.titre === titreEtatBq(R)) || null;
  async function ouvrirEtatBq(root, dossier, R) {
    banqueState.etat = R.id; banqueState.etatJoint = null;
    drawLivres(root, dossier);
    if (!api.classeur || !api.classeur.deposerPdf) return;
    try {
      const avant = etatDejaJointBq(((await api.classeur.documents(dossier.id)) || {}).documents, R);
      if (avant && banqueState.etat === R.id) {
        banqueState.etatJoint = { releve: R.id, doc: avant.id, texte: `Déjà au classeur depuis le ${esc(fmtJour(jourTunisCl(avant.deposeLe)))}${avant.deposeNom ? ` (${esc(prenomCl(avant.deposeNom))})` : ''} : le joindre à nouveau le remplace, l'ancien reste marqué remplacé.` };
        drawLivres(root, dossier);
      }
    } catch (_) { /* le classeur ne se lit pas : la page reste, « Joindre » dira pourquoi s'il échoue */ }
  }
  function brancherEtatBq(el, root, dossier, R) {
    const EC = ecartBanque(R);
    const corps = etatRapprochementHtml(dossier, R, EC);
    const html = pageEtatBq(R, corps);
    const retour = $('#bqe-retour', el);
    if (retour) retour.onclick = () => { banqueState.etat = ''; banqueState.etatJoint = null; drawLivres(root, dossier); };
    const pdf = $('#bqe-pdf', el);
    if (pdf) pdf.onclick = async () => {
      try { const f = await api.exportPdf(html, nomEtatBq(R)); if (f) toast(`PDF enregistré : ${f}`); }
      catch (e) { toast(plainError(e), 'error'); }
    };
    const joindre = $('#bqe-joindre', el);
    if (joindre) joindre.onclick = async () => {
      joindre.setAttribute('disabled', ''); joindre.textContent = 'Jointure…';
      const k = EC.banqueAll.filter(x => !x.ecritLe).length;
      const mois = String(R.au).slice(0, 7);
      try {
        const avant = etatDejaJointBq(((await api.classeur.documents(dossier.id)) || {}).documents, R);
        const doc = await api.classeur.deposerPdf(dossier.id, html, nomEtatBq(R), {
          rubrique: 'piece', periode: mois, titre: titreEtatBq(R), provenance: 'la Banque du cabinet', raison: 'banque',
          detail: k ? `provisoire : ${pl(k, 'ligne')} du relevé à écrire` : 'définitif', remplace: avant ? avant.id : null,
        });
        const ou = `${cap(moisLong(mois))} ${mois.slice(0, 4)} › Le travail du cabinet`;
        banqueState.etatJoint = { releve: R.id, doc: doc.id, texte: `${svgBq(BQ_IC.ok, 14)}<span>Joint au classeur du dossier : <b>${esc(ou)}</b>${avant ? ', à la place de celui d\'avant (gardé, marqué remplacé)' : ''}. <a href="#/dossier/${encodeURIComponent(dossier.id)}/classeur">Le voir dans le classeur</a></span>` };
        drawLivres(root, dossier);
        toast(`L'état de rapprochement est dans le classeur : ${ou}.`);
      } catch (e) {
        banqueState.etatJoint = { releve: R.id, ko: true, texte: `Pas joint : ${esc(plainError(e))} Le PDF peut se télécharger et se déposer à la main dans le classeur.` };
        drawLivres(root, dossier);
      }
    };
  }

  // Une écriture, lue en entier, sans rien pouvoir y changer : c'est ce qu'un contrôle demande.
  // La ligne appariée est marquée, pour qu'on voie d'un coup d'œil laquelle répond au relevé.
  function ecritureDialog(e, ligneMarquee) {
    modal(`<h2>${esc(e.journal || '')} ${esc(e.piece || '(sans pièce)')}${e.numero ? ` <span class="muted small">n° ${esc(String(e.numero))}</span>` : ''}</h2>
      <p class="small muted">${esc(fmtJour(e.date))} · ${esc(e.libelle || '')}${e.statut === 'brouillard' ? ' · <b>brouillard</b>' : ''}</p>
      <div class="scroll-x"><table class="list compact"><thead><tr><th class="nw">Compte</th><th>Libellé</th><th class="r nw">Débit</th><th class="r nw">Crédit</th></tr></thead>
      <tbody>${(e.lignes || []).map((l, i) => `<tr class="${i === ligneMarquee ? 'br-ligne' : ''}"><td class="nw">${esc(l.compte || '')}${i === ligneMarquee ? ' <span class="badge">en face</span>' : ''}</td>
        <td class="tronq" title="${esc(l.libelle || '')}">${esc(l.libelle || '')}</td>
        <td class="r nw">${Number(l.debit) ? esc(money(l.debit)) : ''}</td><td class="r nw">${Number(l.credit) ? esc(money(l.credit)) : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`,
    // Une fenêtre de CONTRÔLE se lit : à 580 px, chaque libellé tombait à « TVA, timbres et
    // retenues de j… » — la ligne qu'on est venu vérifier.
    layer => { $('.modal', layer).classList.add('cab-moyen'); });
  }

  async function retirerReleve(root, dossier, rel) {
    const ok = await confirmDialog(`Retirer le relevé de ${fmtJour(rel.du)} → ${fmtJour(rel.au)} ?`,
      `Ses ${rel.lignes.length} lignes sortent du livre, et les rapprochements avec. Les écritures que tu as créées depuis ce relevé, elles, RESTENT : elles ont été décidées par un clic, et effacer un fichier ne défait pas une décision.`,
      'Retirer');
    if (!ok) return;
    try {
      const r = await api.supprimerReleve({ dossierId: dossier.id, annee: livresState.annee, id: rel.id });
      livresState.livre = r.livre; banqueState.releve = '';
      toast(r.ecrituresGardees ? `Relevé retiré. ${pl(r.ecrituresGardees, 'écriture gardée', 'écritures gardées')}.` : 'Relevé retiré.');
      drawLivres(root, dossier);
    } catch (e) { toast(plainError(e), 'error'); }
  }

  // Choisir l'écriture en face, à la main. On montre TOUS les candidats du bon montant d'abord, puis
  // le reste du compte : une ambiguïté se tranche en voyant les deux, pas en cherchant.
  // 10.12.0 (vu au test humain) — et la fenêtre DIT ce que l'automatique a jugé : la ligne portait
  // « Probable » pendant que la fenêtre montrait ses deux écritures à égalité. Le jugement vient du
  // moteur (`candidatsDeLigne`, le même que l'automatique) ; le plus probable passe en tête et son
  // bouton est le seul en couleur — rien n'est posé tant qu'on n'a pas cliqué.
  function choisirEcritureForm(root, dossier, R, ligne) {
    const s = livresState;
    const jours = ((dossier.banque || {}).jours != null) ? dossier.banque.jours : KC.RELEVE_JOURS;
    const jug = KC.candidatsDeLigne(s.livre, R.id, ligne.id, { jours });
    const cle = c => c.ecritureId + '#' + c.ligne;
    const prefere = jug.meilleur ? cle(jug.meilleur) : '';
    const memeMontant = jug.libres.filter(c => KC.round3(c.montant - ligne.montant) === 0)
      .sort((a, b) => (cle(b) === prefere) - (cle(a) === prefere) || a.date.localeCompare(b.date));
    const autres = jug.libres.filter(c => KC.round3(c.montant - ligne.montant) !== 0);
    const jugement = !memeMontant.length ? ''
      : jug.niveau === 'certain' ? `Une seule écriture porte ce montant à ${pl(jours, 'jour')} près : c'est très probablement elle.`
        : jug.niveau === 'probable' ? 'La plus probable est en tête : son libellé partage le plus de mots avec celui de la banque. Rien n\'est posé tant que tu n\'as pas cliqué.'
          : jug.niveau === 'a-confirmer' ? 'Rien ne les départage — ni la date, ni le libellé : c\'est à toi de choisir.'
            : `Aucune à ${pl(jours, 'jour')} près de la banque : vérifie la date avant de rapprocher.`;
    const ligneHtml = c => `<tr><td class="nw">${esc(fmtJour(c.date))}</td><td class="tronq" title="${esc(c.libelle)}">${esc(c.libelle)}</td>
      <td class="nw">${esc(c.piece)}</td><td class="r nw">${esc(money(c.montant))}</td>
      <td class="actions"><button type="button" class="btn btn-sm${cle(c) === prefere ? ' btn-primary' : ''}" data-pick="${esc(c.ecritureId)}|${c.ligne}">Rapprocher</button></td></tr>`;
    modal(`<h2>Rapprocher ${esc(fmtJour(ligne.date))} · ${esc(money(ligne.montant))}</h2>
      <p class="small muted">${esc(ligne.libelle)}</p>
      <h3 class="sub-h">Du même montant · ${pl(memeMontant.length, 'écriture')}</h3>
      ${jugement ? `<p class="small muted" id="ce-jugement">${esc(jugement)}</p>` : ''}
      ${memeMontant.length ? `<div class="scroll-x"><table class="list compact"><tbody>${memeMontant.map(ligneHtml).join('')}</tbody></table></div>`
        : '<div class="empty mini">Aucune écriture du compte ' + esc(R.compte) + ' ne porte ce montant.</div>'}
      ${autres.length ? `<h3 class="sub-h">Les autres écritures du compte · ${pl(autres.length, 'écriture')}</h3>
        <div class="scroll-x" style="max-height:230px"><table class="list compact"><tbody>${autres.slice(0, 60).map(ligneHtml).join('')}</tbody></table></div>` : ''}
      ${/* La fenêtre finit par le geste SUIVANT (7.27.0) : quand rien dans le livre ne porte le
            montant, ce qu'il reste à faire, c'est l'écrire — et ce bouton-là est alors le principal. */''}
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn ${memeMontant.length ? '' : 'btn-primary'}" id="ce-ecrire">Écrire l'écriture manquante…</button></div>`,
      (rootModal, close) => {
        // Cinq colonnes et un bouton par ligne : dans la fenêtre ordinaire de 580 px, « Rapprocher »
        // vivait derrière un défilement de côté — on voyait « R », pas le geste (vu au test humain).
        $('.modal', rootModal).classList.add('cab-moyen');
        $('#ce-ecrire', rootModal).onclick = () => { close(); ecrireDepuisBanque(root, dossier, R, ligne); };
        $$('[data-pick]', rootModal).forEach(b => { b.onclick = async () => {
          const [ecritureId, i] = b.dataset.pick.split('|');
          try {
            const x = await api.rapprocher({ dossierId: dossier.id, annee: s.annee, releveId: R.id, ligneId: ligne.id, choix: { ecritureId, ligne: Number(i), niveau: 'certain', date: K.today() } });
            s.livre = x.livre; close(); drawLivres(root, dossier);
          } catch (e) { toast(plainError(e), 'error'); }
        }; });
      });
  }

  // L'écriture proposée depuis une ligne non rapprochée. Elle arrive PRÉREMPLIE et jamais
  // enregistrée : la banque ne fait pas foi contre la pièce. Quand aucune règle ne reconnaît le
  // libellé, la contrepartie reste VIDE — verser d'office au 471 rangerait le doute dans un compte
  // que personne ne solde, et la question disparaîtrait sans avoir été posée.
  function ecrireDepuisBanque(root, dossier, R, ligne) {
    const s = livresState;
    const table = Array.isArray(S.libelles) ? S.libelles : [];
    const brouillon = KC.ecritureProposee(ligne, table, { compte: R.compte, journal: 'BQ' });
    let contre = brouillon.lignes[1];
    // (1.221.0, l'épreuve d'un mois) La ligne demandée au client et répondue : sa réponse se lit DANS la fenêtre (elle
    // restait derrière), et le fournisseur ou le client qu'elle nomme propose son compte, avec son nom pour le lettrage.
    const qR = ((s.livre && s.livre.questions) || []).find(q => q.statut === 'repondue' && q.reponse && String(q.compte || '') === String(R.compte)
      && String(q.periode || '') === String(ligne.date).slice(0, 7) && KC.round3(Math.abs(Number(q.montant) || 0) - Math.abs(Number(ligne.montant) || 0)) === 0);
    const repTexte = qR ? String(qR.reponse.texte || '') : '';
    let tiersR = null;
    if (repTexte && !brouillon.regle) {
      const vus = new Map();
      for (const e of (s.livre.ecritures || [])) for (const l of (e.lignes || [])) if (l.tiers && /^4[01]/.test(String(l.compte)) && !vus.has(l.tiers)) vus.set(l.tiers, String(l.compte));
      const rep = normSx(repTexte);
      const nomme = [...vus.keys()].filter(t => normSx(t).length >= 4 && rep.includes(normSx(t)));
      if (nomme.length === 1) { tiersR = { nom: nomme[0], compte: vus.get(nomme[0]) }; contre = { ...contre, compte: tiersR.compte, tiers: tiersR.nom }; }
    }
    modal(`<h2>Écrire ${esc(fmtJour(ligne.date))} · ${esc(money(ligne.montant))}</h2>
      <p class="small muted">${esc(ligne.libelle)}</p>
      ${repTexte ? `<div class="ok-box mb" id="bf-reponse"><b>${esc(contactBq(dossier) || 'Le client')} a répondu :</b> « ${esc(repTexte.slice(0, 300))} »${tiersR ? `<br>Le compte de ${esc(tiersR.nom)} (${esc(tiersR.compte)}) est proposé.` : ''}</div>`
      : brouillon.regle
        ? `<div class="ok-box mb">Le libellé contient « ${esc(brouillon.regle)} » : le compte ${esc(contre.compte)} est proposé.</div>`
        : `<div class="info-box mb">Aucune règle ne reconnaît ce libellé. Choisis le compte : il sera retenu, et le prochain relevé le proposera tout seul.</div>`}
      <form id="bf" class="grid-2">
        <label class="field">${lbl('Journal', 'bq.eJournal')}<input name="journal" value="${esc(brouillon.journal)}"></label>
        <label class="field">${lbl('Date', 'bq.eDate')}<input type="date" name="date" value="${esc(brouillon.date)}"></label>
        <label class="field span-2">${lbl('Libellé', 'bq.eLibelle')}<input name="libelle" value="${esc(tiersR ? `${brouillon.libelle} · ${tiersR.nom}`.slice(0, 120) : brouillon.libelle)}"></label>
        <label class="field">${lbl('Compte ' + esc(R.compte), 'bq.eBanque')}<input value="${esc(money(ligne.montant))}" disabled></label>
        <label class="field obligatoire">${lbl('Contrepartie', 'bq.eContrepartie')}<input name="compte" value="${esc(contre.compte)}" placeholder="${Number(ligne.montant) >= 0 ? '411, ou tape « client »' : '627, ou tape « frais »'}">
          <small class="muted bf-nom" id="bf-nom">${esc(nomDeCompte()(contre.compte) || ' ')}</small></label>
        ${brouillon.regle ? '' : `<div class="span-2 bf-retenir"><label class="check"><input type="checkbox" name="retenir" ${KC.motifDeLibelle(ligne.libelle) && !tiersR ? 'checked' : ''}> <span>Proposer ce compte aux lignes qui contiennent</span></label>
          <input name="motif" class="bf-motif" value="${esc(KC.motifDeLibelle(ligne.libelle))}" placeholder="STEG" aria-label="Mot retenu"></div>`}
      </form>
      ${/* 10.14.1 — la TVA d'une facture payée par la banque se ventile APRÈS : la pièce arrive en
            brouillard, « Reprendre dans la grille » l'ouvre, et la ligne de banque reste rapprochée. */''}
      <p class="small muted">Une TVA à récupérer ? Crée le brouillard, puis <b>Reprendre dans la grille</b> (onglet Saisie) pour ventiler HT et TVA : la ligne ${esc(R.compte)} reste rapprochée.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Créer le brouillard</button></div>`,
      (rootModal, close) => {
        // Le compte tapé se NOMME pendant la frappe, comme dans la grille : un 6061 qu'on croit
        // être l'électricité se voit avant d'être écrit. Seul l'intitulé se récrit (7.17.0).
        const nomC = nomDeCompte();
        // Un compte est un NUMÉRO (10.14.1, BANK-02) : « elec » tapé à sa place s'annonçait « compte
        // hors plan : il sera ajouté au plan », et l'enregistrement le refusait ensuite. Le mot sert
        // à CHERCHER — la liste propose les comptes par leur nom, plan de référence compris.
        const nomDe = c => !c ? ' ' : !/^\d{1,12}$/.test(c) ? 'un compte est un numéro : choisis-le dans la liste, par son nom ou son numéro'
          : (nomC(c) || KC.libelleDuPlan(c) ? `${nomC(c) || KC.libelleDuPlan(c)}${nomC(c) ? '' : ' — il entrera au plan du dossier'}` : 'ni dans le plan du dossier ni dans le plan de référence : vérifie le numéro');
        const champC = $('[name=compte]', rootModal);
        // Le curseur va dans la SEULE case à remplir (26/09) : le journal, la date et le libellé
        // viennent du relevé ; il se posait dans « Journal », et la frappe partait au mauvais endroit.
        if (!contre.compte) setTimeout(() => { try { champC.focus(); } catch (_) { /* rien */ } }, 0);
        champC.addEventListener('input', () => { $('#bf-nom', rootModal).textContent = nomDe(champC.value.trim()); });
        suggererCompte(champC, () => KC.comptesProposables(s.livre.plan || []), c => { $('#bf-nom', rootModal).textContent = nomDe(c.compte); }, () => ligne.libelle);
        $('#ok', rootModal).onclick = async () => {
          const v = n => (($(`[name=${n}]`, rootModal) || {}).value || '').trim();
          const compte = v('compte');
          if (!compte) return refus($('[name=compte]', rootModal), 'Choisis le compte de contrepartie : sans lui, l\'écriture ne s\'enregistre pas.');
          if (!/^\d{1,12}$/.test(compte)) return refus($('[name=compte]', rootModal), `« ${compte} » n'est pas un numéro de compte : cherche-le par son nom dans la liste qui s'ouvre sous la case.`);
          const cocheR = $('[name=retenir]', rootModal);
          if (cocheR && cocheR.checked && v('motif') && !KC.motifDeLibelle(v('motif'))) {
            return refus($('[name=motif]', rootModal), `« ${v('motif')} » se trouve sur trop de lignes de relevé pour décider d'un compte : garde un mot propre à ce tiers (STEG, SONEDE, le nom du client…), ou décoche.`);
          }
          const ec = {
            ...brouillon, journal: v('journal') || 'BQ', date: v('date'), libelle: v('libelle'),
            lignes: [{ ...brouillon.lignes[0], libelle: v('libelle') }, (({ tiers, ...c }) => ({ ...c, compte, libelle: v('libelle'), ...(tiers && compte === (tiersR || {}).compte ? { tiers } : {}) }))(contre)]
          };
          delete ec.aChoisir; delete ec.regle;
          try {
            const r = await api.saisir(dossier.id, s.annee, ec);
            s.livre = r.livre;
            // Le mot RETENU se voit et se corrige dans la fenêtre (10.14.1) : le moteur propose le plus
            // long qui ne soit pas un mot bancaire (`motifDeLibelle`) — « FACTURE » retenu à la place de
            // « STEG » faisait proposer 606 sur le virement d'un client.
            const coche = $('[name=retenir]', rootModal);
            if (coche && coche.checked) {
              const mot = v('motif').toUpperCase();
              if (mot) {
                const table2 = (Array.isArray(S.libelles) ? S.libelles : []).filter(x => x.motif !== mot).concat([{ motif: mot, compte }]);
                S = await api.saveBanque({ libelles: table2 });
              }
            }
            // L'écriture créée rapproche la ligne du même geste : la laisser « sans réponse » après
            // l'avoir écrite ferait recommencer le travail au relevé suivant.
            const idx = (r.livre.ecritures || []).find(x => x.id === r.id);
            if (idx) {
              const x = await api.rapprocher({ dossierId: dossier.id, annee: s.annee, releveId: R.id, ligneId: ligne.id, choix: { ecritureId: r.id, ligne: 0, niveau: 'certain', date: K.today() } });
              s.livre = x.livre;
            }
            close(); toast('Brouillard créé et rapproché.'); drawLivres(root, dossier);
          } catch (e) { toast(plainError(e), 'error'); }
        };
      });
  }

  // L'import d'un relevé, en DEUX temps. On lit le fichier, on montre ce qu'on a compris, et on
  // demande ce que le fichier ne dit pas : le compte bancaire, et les deux soldes du relevé papier.
  // C'est ce contrôle-là qui refuse un fichier auquel il manque des lignes (ERR-CAB-040).
  // Le nom d'une colonne de relevé tel qu'on l'écrit, accents compris : « Debit » et « Credit »,
  // fabriqués depuis la clé technique, se lisaient comme des fautes (IMP-01).
  const NOM_COLONNE_RELEVE = { date: 'Date', libelle: 'Libellé', montant: 'Montant (signé)', debit: 'Débit', credit: 'Crédit', reference: 'Référence' };
  // (1.209.0, maquette « importer le relevé ») L'import est une page de la Banque, plus une fenêtre : le fichier lu, les
  // colonnes reconnues, « Avant d'importer » (la période, le solde de début contre la fin du relevé d'avant, début +
  // mouvements = fin, aucun doublon), et un mois qui manque se dit AVANT que rien n'entre.
  function releveForm(root, dossier) {
    banqueState.importer = true; banqueState.etat = ''; banqueState.regles = '';
    drawLivres(root, dossier);
  }
  // (1.216.0) Ce que contient une colonne d'un relevé, deviné à son titre (« DATE OPER », « LIBELLE OPERATION », « MONTANT »…).
  const sansAccentBq = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function devinerColonnesBq(entetes) {
    const g = {};
    const regles = [['date', /\bdate\b|\bjour\b/], ['libelle', /libell|designation|operation|intitul|description|motif/], ['debit', /\bdebit\b|sortie/], ['credit', /\bcredit\b|entree/],
      ['montant', /montant|amount|somme/], ['reference', /\bref|piece|numero|\bn[o°]\b/], ['solde', /solde|balance/]];
    entetes.forEach((e, i) => { const t = sansAccentBq(e); const r = regles.find(([k, re]) => g[k] == null && re.test(t)); if (r) g[r[0]] = i; });
    if (g.debit != null || g.credit != null) delete g.montant;
    delete g.solde;
    return g;
  }
  // Le choix des colonnes comme la maquette : un menu au-dessus de chaque colonne du fichier, son titre et ce que SkanFact
  // y a compris dessous, les trois premières lignes, et ce qui a été compris en une phrase.
  function colonnesReleveBq(lu, banque) {
    const ent = lu.entetes || [], assoc = lu.assoc || {};
    const ou = i => Object.keys(assoc).find(k => Number(assoc[k]) === i) || (/solde|balance/.test(sansAccentBq(ent[i])) ? 'solde' : '');
    const CH = [['', 'Ignorée'], ['date', 'Date'], ['libelle', 'Libellé'], ['montant', 'Montant (−/+)'], ['debit', 'Débit'], ['credit', 'Crédit'], ['reference', 'Référence'], ['solde', 'Solde']];
    const sous = { date: 'jj/mm/aaaa', montant: 'virgule, 3 décimales', solde: 'sert au contrôle', debit: 'sorties', credit: 'entrées' };
    const rg = lu.rangees || [];
    const t = rg.findIndex(r => r.map(x => String(x).trim()).join('|') === ent.map(x => String(x).trim()).join('|'));
    const corps = rg.slice(t + 1).filter(r => r.some(x => String(x).trim()));
    const reste = Math.max(0, (lu.nRangees || 0) - (t + 1) - 3);
    const l = lu.lignes || [];
    const compris = l.length && !lu.motif ? `<div class="bqc-ok">${svgBq(BQ_IC.ok, 14)}<span>Compris : ${pl(l.length, 'mouvement')} du ${esc(fmtJour(l[0].date).slice(0, 5))} au ${esc(fmtJour(l[l.length - 1].date).slice(0, 5))}${assoc.montant != null ? ' · <b>une seule colonne de montant</b>, le signe dit le sens' : ' · <b>un débit et un crédit</b>'}</span></div>` : '';
    return `<div class="bqc" id="rv-colonnes"><div class="bqc-et"><span class="on">1</span><b>Dis ce que contient chaque colonne</b><i>·</i><span>2</span><span class="mu">Vérifier avant d'importer</span></div>
      <div class="scroll-x"><table class="bqc-t"><thead><tr>${ent.map((e, i) => { const v = ou(i); return `<th><label class="bqc-sel${v ? '' : ' ig'}">${svgBq(BQ_IC.chev, 12)}<select data-col-i="${i}" aria-label="La colonne « ${esc(e || 'sans titre')} »">${CH.map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label><small class="mono">« ${esc(e || '—')} »</small>${sous[v] ? `<small class="bqc-s">${sous[v]}</small>` : ''}</th>`; }).join('')}</tr></thead>
      <tbody>${corps.slice(0, 3).map(r => `<tr>${ent.map((_, i) => { const v = ou(i); return `<td class="${v === '' ? 'ig' : ''}${['montant', 'debit', 'credit', 'solde'].includes(v) ? ' r' : ''}${v === 'libelle' ? ' mono' : ''}">${esc(String(r[i] == null ? '' : r[i]))}</td>`; }).join('')}</tr>`).join('')}
      ${reste ? `<tr><td colspan="${ent.length}" class="mu">… et ${pl(reste, 'autre ligne', 'autres lignes')}</td></tr>` : ''}</tbody></table></div>
      ${compris}
      <div class="cp-gestes"><button type="button" class="btn btn-primary" id="rv-relire">${banque ? 'Retenir ce modèle et continuer' : 'Lire avec ces colonnes'}</button></div>
      <p class="mu bqc-n">${banque ? `Le modèle se retient pour ${esc(banque)}, dans tous les dossiers du cabinet : le prochain relevé s'importe sans cette étape.` : 'Nomme la banque au-dessus : ses colonnes seront retenues pour le prochain relevé.'}</p></div>`;
  }
  function releveFormDans(page, root, dossier) {
    const s = livresState;
    const banques = (S.banques && typeof S.banques === 'object') ? S.banques : {};
    const comptes = (s.livre.plan || []).map(c => c.compte).filter(c => /^5/.test(c)).sort();
    const defaut = (dossier.banque || {}).compte || comptes[0] || '532';
    let lu = null;
    const fermer = () => { banqueState.importer = false; drawLivres(root, dossier); };
    // (1.215.0, la maquette) Le relevé attendu se nomme (celui du mois qui suit le dernier de ce compte) ; la page a deux
    // colonnes : le fichier et ce qu'il dit à gauche, « Avant d'importer » à droite, qui liste d'avance ce qui sera vérifié.
    const derR = (s.livre.releves || []).filter(r => r.compte === defaut && r.au).sort((x, y) => String(x.au).localeCompare(String(y.au))).pop();
    const attendu = derR ? moisSuivant(String(derR.au).slice(0, 7)) : '';
    const courant = (s.livre.releves || []).find(r => r.id === banqueState.releve);
    const nomBq = (dossier.banque || {}).banque || (derR || {}).banque || '';
    page.innerHTML = `<div class="bq-h"><div><b>${attendu ? `Importer le relevé ${esc(deMois(attendu))}` : 'Importer un relevé'} · ${esc(defaut)}${nomBq ? ` ${esc(nomBq)}` : ''}</b><span class="mu" id="rv-sous">rien n'entre avant que tu aies vu ce que SkanFact a compris</span></div>
        <button type="button" class="btn btn-sm btn-ghost" data-close>${courant && courant.au ? `Retour à ${esc(moisLong(String(courant.au).slice(0, 7)))}` : 'Retour au relevé'}</button></div>
      <div id="rv-trou-z"></div>
      <div class="bqi-2">
        <div class="bqi-g">
          <div class="bqi-fic"><span class="bqi-fic-ic" aria-hidden="true">${svgBq(BQ_IC.importer || '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', 20)}</span>
            <div><b>Le fichier du relevé</b><span id="rv-etat" class="small muted">Excel (.xlsx) ou CSV, tel que la banque le donne : rien à retoucher.</span></div>
            <button type="button" class="btn btn-sm btn-primary" id="rv-fichier">Choisir le fichier…</button></div>
          <form id="rv" class="grid-2 bqi-f">
            <label class="field obligatoire">${lbl('Compte bancaire', 'bq.rCompte')}
              <input name="compte" value="${esc(defaut)}" list="rv-comptes" placeholder="532">
              <datalist id="rv-comptes">${comptes.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
            <label class="field">${lbl('Banque', 'bq.rBanque')}<input name="banque" value="${esc(nomBq)}" list="rv-banques" placeholder="Le nom, pour retenir ses colonnes">
              <datalist id="rv-banques">${Object.keys(banques).map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
            <label class="field">${lbl('Solde au début (DT)', 'bq.rDebut')}<input name="debut" class="num montant" inputmode="decimal" value="0,000">
              <span class="small muted" id="rv-debut-hint"></span></label>
            <label class="field">${lbl('Solde à la fin (DT)', 'bq.rFin')}<input name="fin" class="num montant" inputmode="decimal" value="" placeholder="écrit sur le relevé">
              <span class="small muted" id="rv-fin-hint"></span></label>
          </form>
          <div id="rv-apercu"></div>
          <p class="small muted bqi-n">Les lignes au-dessus du tableau et les lignes de solde sont reconnues, et les soldes que le relevé écrit se reportent seuls. Les colonnes se reconnaissent à leur titre (Date, Libellé, Débit, Crédit…) ; une banque nouvelle, tu les nommes une fois, SkanFact s'en souvient.</p>
        </div>
        <div class="bqi-d">
          <div id="rv-avant"><div class="bqi-av bqi-av-vide"><b>Avant d'importer</b><ul>
            <li class="mu"><span>La période du relevé${attendu ? `, ${esc(moisLong(attendu))} attendu` : ''}</span></li>
            <li class="mu"><span>Le solde de début est la fin du relevé d'avant${derR ? ` (${esc(money(derR.soldeFin))} au ${esc(fmtJour(derR.au))})` : ''}</span></li>
            <li class="mu"><span>Début + mouvements = la fin du relevé : aucune ligne ne manque</span></li>
            <li class="mu"><span>Aucune ligne n'est déjà importée</span></li></ul>
            <p class="small muted">Tout se vérifie dès que le fichier est choisi.</p></div></div>
          <div class="cp-gestes"><button class="btn btn-primary" id="ok" disabled>Importer</button><button class="btn" data-close>Annuler</button></div>
          <p class="small muted">Un relevé importé se retire tant qu'aucune de ses lignes n'est rapprochée.</p>
        </div>
      </div>`;
    $$('[data-close]', page).forEach(b => { b.onclick = fermer; });
    ((rootModal, close) => {
        const etat = $('#rv-etat', rootModal), apercu = $('#rv-apercu', rootModal), ok = $('#ok', rootModal);
        const v = n => (($(`[name=${n}]`, rootModal) || {}).value || '').trim();
        // Le solde de DÉPART se propose depuis le livre (T-04) : le solde du compte choisi, la
        // veille de la première ligne du relevé. Un relevé ne commence quasiment jamais à zéro, et
        // « 0 » passait le bouclage tout en rendant l'écart de rapprochement faux. La proposition
        // est NOMMÉE (« d'après le livre ») et cède la place à ce qu'on tape.
        const champDebut = $('[name=debut]', rootModal), hint = $('#rv-debut-hint', rootModal);
        let debutTouche = false, finTouche = false;
        if (champDebut) champDebut.addEventListener('input', () => { debutTouche = true; });
        const champFin = $('[name=fin]', rootModal), hintFin = $('#rv-fin-hint', rootModal);
        // Le verdict se lit PENDANT la frappe dès qu'il tombe juste (10.14.1) : la bulle promettait
        // « l'écart s'écrit sous la case », et on ne l'apprenait qu'en cliquant « Importer ». Tant que
        // ça ne tombe pas juste, rien de rouge (un chiffre à moitié tapé n'est pas une faute), et le
        // montant ATTENDU ne s'écrit jamais : on le recopierait, et le contrôle ne prouverait plus rien.
        // UNE fonction pour la frappe et pour des soldes LUS dans le fichier : lus tous les deux, la
        // fenêtre disait « lu dans le relevé » sans dire s'ils tombaient juste — la seule chose que le
        // débutant voulait savoir (vu au guide, 10.14.1). Lus et faux, les lignes du fichier ne font
        // pas le compte de la banque : c'est dit, sans rouge (le refus viendra à l'import, avec l'écart).
        const verdictFin = source => {
          if (!hintFin) return;
          // Le verdict juge le BOUCLAGE : sans compte, `releveValide` refuse avant de compter, et le
          // verdict ne pouvait jamais dire « juste » (vu au guide, 10.14.1). Le compte manquant a son
          // propre refus, à l'import.
          const juste = !!(lu && (lu.lignes || []).length && v('fin') && KC.releveValide({ compte: v('compte') || '532',
            soldeDebut: KC.nombreDepuisCsv(v('debut')), soldeFin: KC.nombreDepuisCsv(v('fin')), lignes: lu.lignes }).ok);
          // Lu dans le fichier, la phrase tient sur UNE ligne : sur deux, elle poussait « Choisir le
          // fichier… » au moment où le relevé se lisait (H-E1).
          if (juste) { hintFin.className = 'small ok-inline'; hintFin.textContent = source ? source + ' · ✓ ça tombe juste' : '✓ Ça tombe juste : début + mouvements = fin, aucune ligne ne manque.'; }
          else if (source) { hintFin.className = 'small muted'; hintFin.textContent = source + ' — mais début + mouvements ne donne pas cette fin : une ligne manque peut-être au fichier.'; }
          else { hintFin.className = 'small muted'; hintFin.textContent = 'recopie le solde de fin écrit sur le relevé'; }
        };
        if (champFin) champFin.addEventListener('input', () => { finTouche = true; verdictFin(''); });
        [champDebut, champFin].forEach(c => { if (c) c.addEventListener('input', () => { if (lu && (lu.lignes || []).length) montrer(); }); });
        // Les soldes que le RELEVÉ écrit (10.14.1, IMP-01) passent avant ceux du livre : ce sont les
        // chiffres de la banque, ceux que la fenêtre demandait de recopier du papier. Ce qu'on a
        // tapé soi-même n'est jamais écrasé.
        const soldesLus = () => {
          const so = (lu && lu.soldes) || {};
          let finLue = false, debutLu = false;
          if (champFin && !finTouche) {
            if (so.fin != null) { champFin.value = montantChamp(so.fin) || '0'; finLue = true; }
            else if (hintFin) { hintFin.className = 'small muted'; hintFin.textContent = 'le fichier ne l\'écrit pas : recopie-le depuis le relevé papier ou PDF'; }
          }
          if (champDebut && !debutTouche && so.debut != null) {
            champDebut.value = montantChamp(so.debut) || '0';
            if (hint) hint.textContent = 'lu dans le relevé';
            debutLu = true;
          }
          // Le verdict APRÈS les deux soldes : jugé avant le début, il comparait la fin à un 0.
          if (finLue) verdictFin('lu dans le relevé');
          return debutLu;
        };
        const proposerDebut = lignes => {
          if (soldesLus()) return;
          if (!champDebut || debutTouche || !lignes.length) return;
          const compte = v('compte'), premiere = lignes.map(l => l.date).filter(Boolean).sort()[0];
          if (!compte || !premiere) return;
          // (1.209.0) Un relevé de ce compte avant celui-ci : son solde de fin est le début de celui-ci (le chiffre de la
          // banque, pas celui du livre, que les lignes pas encore écrites décalent).
          const prec = (s.livre.releves || []).filter(r => r.compte === compte && r.au && r.au < premiere).sort((x, y) => String(x.au).localeCompare(String(y.au))).pop();
          if (prec && prec.soldeFin != null) {
            champDebut.value = montantChamp(Number(prec.soldeFin)) || '0';
            if (hint) hint.textContent = `la fin du relevé du ${fmtJour(prec.au)}`;
            return;
          }
          const avant = KC.lignesBancaires(s.livre, compte).filter(c => c.date < premiere);
          const solde = KC.round3(avant.reduce((a, c) => a + c.montant, 0));
          champDebut.value = montantChamp(solde) || '0';
          // Le solde s'arrête AVANT la première ligne : c'est celui du soir de la veille. « au 02/10
          // (veille de la première ligne) » sous une première ligne du 02/10 se contredisait.
          if (hint) hint.textContent = `d'après le livre : ${money(solde)} au soir du ${fmtJour(KC.ajouterJoursIso(premiere, -1))}, veille de la première ligne`;
        };
        let forcer = false;
        // Les contrôles d'avant l'import, recalculés à chaque frappe d'un solde. Rend les mois sans relevé entre le dernier
        // relevé de ce compte et ce fichier (vides : rien ne manque).
        const controlesImport = lignes => {
          const zone = $('#rv-avant', rootModal);
          const dates = lignes.map(l => l.date).filter(Boolean).sort();
          const du = dates[0] || '', au = dates[dates.length - 1] || '';
          const compte = v('compte') || defaut;
          const autres = (s.livre.releves || []).filter(r => r.compte === compte);
          const prec = autres.filter(r => r.au && du && r.au < du).sort((x, y) => String(x.au).localeCompare(String(y.au))).pop();
          const trou = [];
          if (prec && du) { for (let m = moisSuivant(String(prec.au).slice(0, 7)); m < du.slice(0, 7); m = moisSuivant(m)) trou.push(m); }
          const debut = KC.nombreDepuisCsv(v('debut')), fin = v('fin') ? KC.nombreDepuisCsv(v('fin')) : null;
          const cle = l => `${l.date}|${KC.round3(Number(l.montant) || 0)}|${String(l.libelle || '').trim().toLowerCase()}`;
          const deja = new Set(autres.flatMap(r => (r.lignes || []).map(cle)));
          const doubles = lignes.filter(l => deja.has(cle(l))).length;
          const juste = fin != null && KC.releveValide({ compte, soldeDebut: debut, soldeFin: fin, lignes }).ok;
          const ok = t => `<li class="ok">${svgBq(BQ_IC.ok, 14)}<span>${t}</span></li>`, ko = t => `<li class="ko">${svgBq(BQ_IC.alerte, 14)}<span>${t}</span></li>`;
          const sous = $('#rv-sous', rootModal);
          if (sous) sous.textContent = `${String(lu.fichier || '').split(/[\\/]/).pop()} · ${pl(lignes.length, 'mouvement')}${du ? ` · du ${fmtJour(du)} au ${fmtJour(au)}` : ''}`;
          const contact = contactBq(dossier) || 'le client';
          // La boîte du mois manquant ne se redessine que si elle change : la frappe d'un solde la redessinait, et le clic
          // sur « L'importer quand même » tombait sur une boîte déjà remplacée.
          // (1.218.0, maquette « bqimportko ») Le refus prend la page : rien n'est importé, les trois mois côte à côte
          // (le dernier importé, le trou, ce fichier), ce qui a été vérifié, et ce qui débloque.
          const banqueNom = v('banque');
          const htmlTrou = (trou.length && !forcer ? `<div class="bqk" id="rv-trou"><div class="bqk-t"><span class="bqx">${svgBq(BQ_IC.alerte, 18)}</span><div><b>Ce relevé est celui ${esc(deMois(du.slice(0, 7)))} : ${trou.length > 1 ? `${esc(trou.map(m => moisLong(m)).join(', '))} manquent` : `celui ${esc(deMois(trou[0]))} manque`}</b>
                <p>Rien n'est importé. Le livre de la banque se rapproche mois après mois : ${trou.length > 1 ? 'des mois sautés laisseraient' : 'un mois sauté laisserait'} un trou que personne ne verrait.</p></div></div>
              <div class="bqk-f"><div><small>Dernier relevé importé</small><b>${esc(moisLong(String(prec.au).slice(0, 7)))} · fin ${esc(money(prec.soldeFin))}</b><small>du ${esc(fmtJour(prec.du))} au ${esc(fmtJour(prec.au))}</small></div>
                <div class="trou"><small>${esc(cap(trou.map(m => moisLong(m)).join(', ')))}</small><b>pas encore importé</b></div>
                <div><small>Ce fichier</small><b>${esc(moisLong(du.slice(0, 7)))} · ${esc(pl(lignes.length, 'mouvement'))}</b><small>du ${esc(fmtJour(du))} au ${esc(fmtJour(au))}</small></div></div>
              <ul class="bqk-ok"><li>${svgBq(BQ_IC.ok, 14)}<span>le fichier est bien un relevé${banqueNom ? ` de la ${esc(banqueNom)}` : ''}, ${esc(compte)}</span></li>
                ${doubles ? `<li class="ko">${svgBq(BQ_IC.alerte, 14)}<span>${esc(pl(doubles, 'ligne déjà importée', 'lignes déjà importées'))}</span></li>` : `<li>${svgBq(BQ_IC.ok, 14)}<span>aucun doublon</span></li>`}</ul>
              <div class="cp-gestes"><button type="button" class="btn btn-primary" id="rv-dabord">Importer d'abord celui ${esc(deMois(trou[0]))}…</button>${!dossier.manual && api.question ? `<button type="button" class="btn" id="rv-demander">Le demander à ${esc(contact)}</button>` : ''}<button type="button" class="btn btn-ghost" id="rv-forcer">L'importer quand même</button></div></div>` : '');
          rootModal.classList.toggle('bqi-bloque', !!htmlTrou);
          const zoneT = $('#rv-trou-z', rootModal);
          if (zoneT && zoneT.dataset.h !== htmlTrou) { zoneT.innerHTML = htmlTrou; zoneT.dataset.h = htmlTrou; }
          if (zone) zone.innerHTML = `<div class="bqi-av"><b>Avant d'importer</b><ul>
              ${du ? ok(`La période : du ${esc(fmtJour(du))} au ${esc(fmtJour(au))}, ${pl(lignes.length, 'mouvement')}.`) : ''}
              ${prec ? (KC.round3(debut - Number(prec.soldeFin || 0)) === 0 ? ok(`Le solde de début (${esc(money(debut))}) est la fin du relevé du ${esc(fmtJour(prec.au))}.`) : ko(`Le solde de début (${esc(money(debut))}) n'est pas la fin du relevé du ${esc(fmtJour(prec.au))} (${esc(money(prec.soldeFin))}) : écart ${esc(money(KC.round3(debut - Number(prec.soldeFin || 0))))}.`)) : ok('Le premier relevé de ce compte : son solde de début se lit dans le relevé, ou dans le livre.')}
              ${fin == null ? ko('Le solde de fin manque : recopie-le du relevé, c\'est lui qui prouve qu\'aucune ligne ne manque.') : juste ? ok('Début + mouvements = la fin du relevé : aucune ligne ne manque.') : ko('Début + mouvements ne donne pas la fin du relevé : une ligne manque peut-être au fichier.')}
              ${doubles ? ko(`${pl(doubles, 'ligne est', 'lignes sont')} déjà dans un relevé de ce compte (même date, même montant, même libellé) : ${doubles > 1 ? 'elles seraient' : 'elle serait'} en double.`) : ok('Aucune ligne n\'est déjà dans un relevé de ce compte.')}
              <li class="mu"><span>À l'import, ce qui ne fait aucun doute se rapproche d'office ; le reste arrive « à traiter », avec ce que SkanFact propose.</span></li></ul></div>`;
          const sur2 = (q, fn) => { const b = $(q, rootModal); if (b) b.onclick = fn; };
          sur2('#rv-dabord', () => $('#rv-fichier', rootModal).click());
          sur2('#rv-demander', () => fenDemanderCl(dossier, { piece: `Le relevé de banque ${deMois(trou[0])}` }, { hors: true, apres: async () => drawLivres(root, dossier) }));
          sur2('#rv-forcer', () => { forcer = true; montrer(); });
          return trou;
        };
        const montrer = () => {
          if (!lu) return;
          // (1.216.0, maquette « une banque nouvelle ») Les colonnes se devinent à leur titre ; le fichier se relit seul avec ce
          // choix, et le choix reste sous les yeux pour être corrigé, puis retenu pour la banque.
          if (lu.motif && lu.entetes && !lu.devine) {
            const g = devinerColonnesBq(lu.entetes);
            lu.devine = true;
            if (g.date != null && g.libelle != null && (g.montant != null || g.debit != null || g.credit != null)) {
              const avant = lu;
              void api.lireReleve({ chemin: lu.fichier, assoc: g }).then(r => { if (lu === avant) { lu = { ...r, assoc: g, devine: true, modele: true }; montrer(); } }, () => {});
            }
          }
          const lignes = lu.lignes || [];
          proposerDebut(lignes);
          const somme = KC.round3(lignes.reduce((a, l) => a + l.montant, 0));
          // Le doublon se dit DÈS que le fichier est choisi (T-08) : l'empreinte est connue à la
          // lecture, c'est-à-dire au moment exact où l'app écrivait un bandeau vert. Un vert dans la
          // fenêtre et un refus rouge en bas de l'écran, c'est deux messages contradictoires, et
          // le rassurant est celui où l'œil est posé. Le bandeau devient orange, nomme la date du
          // premier import, et le bouton s'éteint en disant pourquoi (9.4.5).
          const deja = KC.releveDejaImporte(s.livre, lu.empreinte);
          apercu.innerHTML = `${lu.motif ? `<div class="warn-box mb">${esc(lu.motif)}</div>` : ''}
            ${deja ? `<div class="warn-box mb" id="rv-deja"><b>Ce fichier a déjà été importé</b> le ${esc(fmtJour(KC.jourDeLInstant(deja.importeLe)))} (${esc(fmtJour(deja.du))} → ${esc(fmtJour(deja.au))}).
              L'importer une seconde fois doublerait chacun de ses mouvements : les soldes n'ont pas besoin d'être saisis.</div>`
            : lignes.length && !(lu.entetes && lu.modele) ? `<div class="ok-box mb">${pl(lignes.length, 'ligne lue', 'lignes lues')} · mouvements ${esc(money(somme))}${
              lu.ignorees.length ? ` · ${pl(lu.ignorees.length, 'ligne ignorée', 'lignes ignorées')}` : ''}${
              lu.totaux ? ` · ${pl(lu.totaux, 'ligne de total écartée', 'lignes de total écartées')}` : ''}${
              lu.ligneTitres > 1 ? ` · titres trouvés ligne ${lu.ligneTitres}` : ''}</div>` : ''}
            ${lu.ignorees && lu.ignorees.length ? `<div class="small muted">${lu.ignorees.slice(0, 5).map(i => `Ligne ${i.ligne} : ${esc(i.motif)}`).join(' · ')}</div>` : ''}
            ${lignes.length && !(lu.entetes && lu.modele) ? `<div class="scroll-x" style="max-height:200px"><table class="list compact"><thead><tr><th class="nw">Date</th><th>Libellé</th><th class="r nw">Montant</th></tr></thead>
              <tbody>${lignes.slice(0, 12).map(l => `<tr><td class="nw">${esc(fmtJour(l.date))}</td><td class="tronq" title="${esc(l.libelle)}">${esc(l.libelle)}</td><td class="r nw">${esc(money(l.montant))}</td></tr>`).join('')}</tbody></table></div>` : ''}
            ${lu.entetes && (lu.motif || lu.modele) ? colonnesReleveBq(lu, v('banque')) : ''}`;
          // (1.209.0) « Avant d'importer » : ce qui est vérifié, ligne à ligne, avant que rien n'entre ; un mois qui manque
          // entre le dernier relevé et celui-ci se refuse en le nommant, avec ce qui débloque.
          const trou = lignes.length && !deja ? controlesImport(lignes) : [];
          const bloqueTrou = trou.length && !forcer;
          ok.disabled = !lignes.length || !!deja || !!bloqueTrou;
          ok.title = deja ? 'Ce fichier est déjà dans le livre.' : bloqueTrou ? `Le relevé ${trou.length > 1 ? 'des mois d\'avant manque' : `${deMois(trou[0])} manque`} : importe-le d'abord, ou « L'importer quand même ».` : '';
          const relire = $('#rv-relire', rootModal);
          if (relire) relire.onclick = async () => {
            const assoc = {};
            $$('[data-col-i]', rootModal).forEach(sel2 => { if (sel2.value && sel2.value !== 'solde') assoc[sel2.value] = Number(sel2.dataset.colI); });
            // (1.209.0, maquette « une banque nouvelle ») Le modèle se retient dès qu'on le valide, pour cette banque.
            if (v('banque')) { try { S = await api.saveBanque({ banques: { ...banques, [v('banque')]: assoc } }); banques[v('banque')] = assoc; } catch (e) { toast(plainError(e), 'error'); } }
            lu = { ...await api.lireReleve({ chemin: lu.fichier, assoc }), assoc, devine: true, modele: true };
            montrer();
          };
        };
        $('#rv-fichier', rootModal).onclick = async () => {
          try {
            const banque = v('banque');
            const r = await api.lireReleve({ assoc: banques[banque] || null });
            if (r.annule) return;
            lu = { ...r, assoc: banques[banque] || r.colonnes };
            etat.textContent = String(r.fichier || '').split(/[\\/]/).pop();
            montrer();
          } catch (e) { toast(plainError(e), 'error'); }
        };
        ok.onclick = async () => {
          if (!lu || !lu.lignes.length) return;
          const compte = v('compte');
          if (!compte) return refus($('[name=compte]', rootModal), 'Choisis le compte bancaire : il ne se devine pas depuis le fichier.');
          // Le solde de fin est la PREUVE qu'aucune ligne ne manque (10.14.1, BANK-01) : il ne se
          // propose pas à 0 — un « 0,000 » posé d'office faisait cliquer « Importer » et tomber sur
          // un refus rouge au bas de l'écran, par-dessus les boutons. Vide, il se réclame ; faux, le
          // refus du moteur se MONTRE sur la case (10.12.0), avec l'écart.
          if (!v('fin')) return refus(champFin, 'Recopie le solde de fin écrit sur le relevé (papier ou PDF) : c\'est lui qui prouve qu\'aucune ligne ne manque.');
          const releve = {
            compte, banque: v('banque'), fichier: lu.fichier, empreinte: lu.empreinte,
            soldeDebut: KC.nombreDepuisCsv(v('debut')), soldeFin: KC.nombreDepuisCsv(v('fin')),
            lignes: lu.lignes
          };
          const boucle = KC.releveValide(releve);
          if (!boucle.ok) {
            // Le motif reste écrit SOUS la case : le bandeau s'efface en quelques secondes, et il
            // se pose par-dessus les boutons de la fenêtre — l'écart doit rester lisible pendant
            // qu'on le compare au papier.
            if (hintFin) { hintFin.textContent = boucle.motif; hintFin.className = 'small err-inline'; }
            return refus(champFin, boucle.motif);
          }
          try {
            const r = await api.ajouterReleve({ dossierId: dossier.id, annee: s.annee, releve });
            s.livre = r.livre; banqueState.releve = r.releve.id;
            if (moisSx() && r.releve.au) s.mois = String(r.releve.au).slice(0, 7);
            // Ce que l'association apprend ne sert que si on la garde : sans ça, chaque import
            // d'une même banque redemanderait le même travail.
            if (v('banque') && lu.assoc) {
              S = await api.saveBanque({
                banques: { ...banques, [v('banque')]: lu.assoc },
                dossierId: dossier.id, banque: { compte, banque: v('banque'), jours: (dossier.banque || {}).jours }
              });
            }
            // (1.206.0) Le rapprochement se fait À L'IMPORT (la maquette : « 35 rapprochées à l'import ») : ce qui ne
            // fait aucun doute se pose d'office, le reste arrive rangé — proposé, à traiter. Rien d'ambigu n'est posé.
            let poses = 0;
            try {
              const jours = ((dossier.banque || {}).jours != null) ? dossier.banque.jours : KC.RELEVE_JOURS;
              const a = await api.rapprocherAuto({ dossierId: dossier.id, annee: s.annee, releveId: r.releve.id, jours });
              s.livre = a.livre; poses = (a.compte || {}).certain || 0;
            } catch (_) { /* le relevé est là ; ses lignes sûres arrivent « proposées », à valider d'un geste */ }
            banqueState.sel = ''; banqueState.filtre = '';
            close(); toast(`Relevé importé : ${pl(r.releve.lignes.length, 'ligne')}${poses ? `, dont ${pl(poses, 'rapprochée', 'rapprochées')} d'office` : ''}.`); drawLivres(root, dossier);
          } catch (e) { toast(plainError(e), 'error'); }
        };
    })(page, fermer);
  }

  // Le fil du parcours (3/3) : depuis le livre d'UN client, rien ne menait à l'export qui regroupe
  // TOUS les clients d'un mois — le geste qui suit la relecture d'un livre, et la dernière étape de
  // la boucle. Il fallait connaître la page Écritures et y aller par le menu.
  // `reimport` (10.14.1) : le retour de l'aller-retour, posé À CÔTÉ de l'export qu'il reprend — on
  // exporte, on corrige dans Excel, on réimporte, et les deux gestes se lisent ensemble.
  // H3 (10.15.0) — les exports du livre vivent dans UN menu « Exporter ▾ ». Posé en bouton à côté du
  // CSV, « Fichier FEC… » faisait passer la barre du livre-journal sur deux rangées à 1440 px (mesuré :
  // 1 207 px pour 1 079), et « Exporter les écritures de tous les clients… » tombait seul dessous. Un
  // menu occupe la largeur d'un bouton quoi qu'il contienne (7.28.0) ; sur un écran qui n'a qu'un
  // export, rowmenu.js en fait un bouton nommé (7.29.0), donc rien n'y change.
  const barreLivres = (controles, libelleExport, reimport) => `<div class="filters" data-export="${esc(libelleExport)}"${reimport ? ' data-fec' : ''}>${controles}
    ${RowMenu.bouton('EXP', 'Exporter', 'btn btn-sm btn-ghost')}${reimport ? info('lv.fec') : ''}
    ${reimport ? `<button class="btn btn-sm btn-ghost" id="lv-reimport" title="Le livre-journal exporté et corrigé dans ton tableur, ou le FEC de ton ancien logiciel : ce qu'il change entre en brouillard, rien n'est supprimé">Importer un tableur ou un FEC…</button>` : ''}
    ${/* Un libellé décrit l'écran d'ARRIVÉE (7.29.0). L'ancien libellé (« Regrouper… ») se lisait comme
          « donner à chacun son sous-compte » — deux lecteurs sur deux (T-42) — alors qu'il quitte le
          dossier pour la page Écritures, l'export de tout le portefeuille. Le mot « Exporter » le
          range avec son voisin, et le titre dit qu'on change de page. */''}
    <button class="btn btn-sm btn-ghost" id="lv-tous" title="Quitte ce dossier : la page Écritures regroupe les écritures de tous les clients d'un mois">Exporter les écritures de tous les clients…</button></div>`;

  const fmtJour = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
  };

  // ---------------------------------------------------------------- la grille de saisie (9.3.0)
  //
  // SPEC-UI-CAB-010. L'écran où un comptable passe ses journées, et la seule règle qui le décide :
  // **la souris n'est jamais obligatoire**. Journal, date, pièce, puis les lignes ; Entrée descend,
  // Tab sur la dernière ligne solde, Ctrl+Entrée enregistre. Les touches sont RÉGLABLES (Réglages →
  // Comptabilité) parce qu'on ne les invente pas : on reprend celles que le comptable a déjà dans
  // les doigts, et tant que personne ne l'a regardé travailler, ce qui est livré n'est qu'une
  // proposition.
  //
  // La pièce en cours vit dans `saisieState.piece` et l'écran ne se redessine PAS à chaque frappe :
  // on met à jour la donnée, puis le seul élément qui en dépend (`#sa-solde`). Redessiner la grille
  // à chaque caractère détruirait le champ sous le curseur — c'est le défaut de la 7.17.0, et il
  // rendait un champ littéralement impossible à remplir.
  const saisieState = { dossierId: '', piece: null, focusApres: null, enAttente: {} };

  // 10.12.0 (U-09) — une pièce COMMENCÉE et pas enregistrée. Elle vivait en mémoire, sans trace :
  // fermer la fenêtre l'effaçait sans une question, et ouvrir la saisie d'un AUTRE client la
  // remplaçait par une pièce vide. Trois parades : elle est garée par dossier (`enAttente`) au lieu
  // d'être écrasée, un point le dit sur l'onglet, et la fermeture de la fenêtre demande.
  // « Touchée » ET « commencée » : la date et le journal proposés ne comptent pas, un champ tapé
  // puis vidé non plus — on ne demande pas de confirmer la perte d'une pièce vide.
  const pieceCommencee = p => !!p && (lignesReelles(p).length > 0 || !!String(p.libelle || '').trim()
    || !!String(p.piece || '').trim() || !!p.pieceJointe);
  const pieceEnCours = p => !!(p && p.touchee && pieceCommencee(p));
  const saleDe = id => (saisieState.dossierId === id && pieceEnCours(saisieState.piece)) || pieceEnCours(saisieState.enAttente[id]);
  // Le point qui le dit. Un point SEUL ne dit rien (9.4.4) : il porte son titre, et son nom pour
  // qui ne voit pas l'écran.
  const pointSale = id => `<span class="sa-sale" data-sale="${esc(id)}" role="img" aria-label="Une pièce commencée n'est pas enregistrée" title="Une pièce commencée n'est pas enregistrée"${saleDe(id) ? '' : ' hidden'}>●</span>`;
  // Les NOMS des dossiers dont une pièce commencée n'est pas enregistrée — ce que la fermeture et
  // l'installation d'une mise à jour nomment avant de fermer.
  function nomsDesSaisies() {
    const ids = Object.keys(saisieState.enAttente).filter(id => pieceEnCours(saisieState.enAttente[id]));
    if (pieceEnCours(saisieState.piece) && saisieState.dossierId) ids.unshift(saisieState.dossierId);
    return [...new Set(ids)].map(id => ((S.dossiers || []).find(d => d.id === id) || {}).name).filter(Boolean);
  }
  // `null` et pas '' : une interface qui (re)démarre DIT qu'elle n'a rien en cours, même si c'est
  // aussi ce qu'elle disait avant. Sinon, après un rechargement, le processus principal garde la
  // liste de l'interface précédente et demande pour une pièce qui n'existe plus (7.28.0 : un
  // drapeau se remet à jour quand l'état DISPARAÎT, pas seulement quand il se pose).
  let dernierSignal = null;
  function signalerSaisies(apresGarde) {
    const noms = nomsDesSaisies();
    const gardees = saisiesGardees();
    const cle = noms.join('|') + (gardees ? '·gardées' : '');
    if (cle !== dernierSignal) { dernierSignal = cle; try { api.saisieEnCours(noms, gardees); } catch (_) { /* pont absent en test */ } }
    if (!apresGarde && brouillonE) { clearTimeout(gardeETimer); gardeETimer = setTimeout(garderSaisies, 1000); }
    // Le point de l'onglet se met à jour SANS redessiner : on est au milieu d'une frappe (7.17.0).
    $$('[data-sale]').forEach(x => { x.hidden = !saleDe(x.dataset.sale); });
  }

  // (1.164.0, décision du 27/10/2026, comme les pièces de l'entreprise) Sur « mon ordinateur », la pièce commencée de
  // chaque dossier se garde aussi sur le poste, chiffrée, une seconde après la dernière frappe : elle vivait en mémoire, et
  // un onglet fermé (ou une panne) la perdait. La saisie du dossier propose ensuite de la reprendre ; enregistrée ou
  // vidée, elle s'efface. Sur l'ordinateur d'un autre, rien ne se garde, et fermer l'onglet demande (pont-cabinet.js).
  const brouillonE = api.brouillonEcriture && typeof api.brouillonEcriture.garde === 'function' && api.brouillonEcriture.garde() ? api.brouillonEcriture : null;
  const gardeesE = new Map(); // dossier → la pièce telle qu'elle est gardée (JSON)
  let gardeETimer = null;
  const piecesAGarder = () => {
    const l = Object.entries(saisieState.enAttente).filter(([, x]) => pieceEnCours(x));
    if (saisieState.dossierId && pieceEnCours(saisieState.piece)) l.push([saisieState.dossierId, saisieState.piece]);
    return l;
  };
  const saisiesGardees = () => !!brouillonE && piecesAGarder().every(([id, x]) => gardeesE.get(id) === JSON.stringify(x));
  async function garderSaisies() {
    if (!brouillonE) return;
    const l = piecesAGarder();
    for (const [id, x] of l) {
      const j = JSON.stringify(x);
      if (gardeesE.get(id) !== j) { await brouillonE.garder(id, { p: JSON.parse(j), le: Date.now() }).catch(() => { /* la frappe suivante réessaie */ }); gardeesE.set(id, j); }
    }
    for (const id of [...gardeesE.keys()]) if (!l.some(([x]) => x === id)) { gardeesE.delete(id); await brouillonE.effacer(id).catch(() => { /* déjà parti */ }); }
    signalerSaisies(true);
  }
  // Le bandeau commun aux pièces neuves (maquettes facture, devis, achat : « Reprendre » ou « Le jeter »).
  const quandCommence = ts => { const q = new Date(ts); return `le ${q.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Africa/Tunis' })} à ${q.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' }).replace(':', ' h ')}`; };
  function proposerReprise(el, root, dossier) {
    // Ce que ce poste garde de la pièce de CETTE session (enregistrée ou vidée à l'instant) s'efface : rien à proposer.
    if (!brouillonE || pieceEnCours(saisieState.piece) || gardeesE.has(dossier.id)) return;
    brouillonE.relire(dossier.id).then(b => {
      const d = b && b.contenu && b.contenu.p;
      const tete = $('#sa-tete', el);
      if (!d || !tete || !document.contains(tete) || saisieState.dossierId !== dossier.id || pieceEnCours(saisieState.piece) || gardeesE.has(dossier.id) || $('#sa-reprendre')) return;
      if (Date.now() - (b.contenu.le || 0) > 7 * 86400000) { brouillonE.effacer(dossier.id).catch(() => {}); return; }
      const nl = lignesReelles(d).length;
      const ban = document.createElement('div');
      ban.className = 'bandeau info reprise'; ban.id = 'sa-reprendre'; ban.setAttribute('role', 'status');
      ban.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10a4 4 0 0 1 0 8z"/></svg>`
        + `<span class="txt"><b>Écriture commencée ${esc(quandCommence(b.contenu.le))}, pas encore enregistrée</b><span>${esc([d.journal, String(d.libelle || '').trim() ? `« ${String(d.libelle).trim()} »` : '', nl ? pl(nl, 'ligne') : ''].filter(Boolean).join(' · '))}. Gardée sur cet ordinateur seulement : elle n'est au brouillard qu'une fois enregistrée.</span></span>`
        + '<span class="rep-g"><button type="button" class="btn btn-sm rep-ok" id="sa-reprendre-ok">Reprendre</button><button type="button" class="btn btn-sm" id="sa-reprendre-non">Le jeter</button></span>';
      tete.before(ban);
      $('#sa-reprendre-ok', ban).onclick = () => { saisieState.piece = d; gardeesE.set(dossier.id, JSON.stringify(d)); drawLivres(root, dossier); };
      $('#sa-reprendre-non', ban).onclick = () => { brouillonE.effacer(dossier.id).catch(() => {}); ban.remove(); toast('Brouillon jeté : rien n\'avait été enregistré.'); };
    }).catch(() => { /* rien à proposer */ });
  }

  // Un jour du calendrier, jamais un instant : `K.today()` rend le jour LOCAL, et la comparaison se
  // fait sur des chaînes `AAAA-MM-JJ` — aucune arithmétique de date, donc aucune question de fuseau
  // (règle 5.2.3). Hors de l'exercice ouvert, on propose son dernier jour : c'est là qu'on saisit
  // quand on rattrape un exercice passé.
  const dateProposee = annee => {
    const a = String(annee || '').slice(0, 4);
    if (!/^\d{4}$/.test(a)) return '';
    const auj = K.today();
    return auj.slice(0, 4) === a ? auj : `${a}-12-31`;
  };
  // Ce que le champ Date MONTRE : le jour en français quand on écrit la date complète, le seul
  // numéro de jour quand on est en saisie rapide. Ce que la pièce PORTE reste l'ISO, toujours.
  const dateAffichee = (iso, r) => (!iso ? '' : r.dateComplete ? fmtJour(iso) : String(Number(iso.slice(8, 10))));
  const pieceVide = (journal, date) => ({
    id: '', date: date || '', journal: journal || '', piece: '', libelle: '', pieceJointe: null,
    lignes: [ligneVide(), ligneVide()]
  });
  const ligneVide = () => ({ compte: '', libelle: '', debit: '', credit: '' });
  // (1.174.5) La saisie ouverte pour une pièce (le classeur, les Pièces reçues) : son journal nommé par sa nature (achats,
  // banque, ventes ; la saisie prend le code de ce livre), une date, son nom en libellé ; enregistrée, la pièce se joint à
  // l'écriture (`depuis`). Une saisie déjà commencée pour ce dossier n'est pas écrasée.
  function saisirPiece(dossierId, { nature, date, nom, depuis }) {
    if (saisieState.dossierId === dossierId && pieceEnCours(saisieState.piece)) toast('Une saisie est déjà commencée pour ce dossier : elle t\'attend, la pièce ne s\'y joindra pas d\'elle-même.');
    else {
      if (saisieState.dossierId && saisieState.dossierId !== dossierId && pieceEnCours(saisieState.piece)) saisieState.enAttente[saisieState.dossierId] = saisieState.piece;
      saisieState.dossierId = dossierId;
      saisieState.piece = { ...pieceVide('', date), journalDe: nature, libelle: String(nom || '').replace(/\.(pdf|jpe?g|png|webp|heic)$/i, '').slice(0, 120), depuisClasseur: depuis };
      // (1.336.0) La pièce montrée à côté de la grille est celle qu'on saisit (« La pièce de l'écriture en cours ») : elle
      // prenait la première pièce à traiter de l'année, une autre facture, sous le titre « Saisie de … » de celle-ci.
      if (depuis && (depuis.message || depuis.doc)) {
        // Le choix vaut pour CE dossier : le premier dessin d'un autre dossier remet la Saisie à zéro (et l'oublierait).
        if (sxState.dossier !== dossierId) { Object.assign(sxState, { dossier: dossierId, mode: '', dessin: '' }); sxState.fiches.clear(); sxState.saisir.clear(); }
        Object.assign(sxState, { sel: depuis.message ? `p:${depuis.message}` : `d:${depuis.doc}`, zoom: 1, rot: 0 });
      }
    }
    navigate(`#/dossier/${encodeURIComponent(dossierId)}/comptabilite/saisie`);
  }

  // Les lignes telles que le moteur les attend : les champs texte redeviennent des nombres ici, et
  // nulle part ailleurs. Une ligne entièrement vide ne compte pas — on en laisse toujours une au
  // bout de la grille pour pouvoir taper la suivante.
  // Les montants passent par `lireMontant` (H-3) : « 1 250,500 » tapé avec l'espace des milliers
  // valait zéro, et la ligne « n'avait aucun montant » sous les yeux de qui venait de le taper.
  const lignesReelles = p => (p.lignes || [])
    .filter(l => String(l.compte || '').trim() || lireMontant(l.debit) || lireMontant(l.credit))
    .map(l => ({
      compte: String(l.compte || '').trim(), libelle: String(l.libelle || ''),
      debit: lireMontant(l.debit),
      credit: lireMontant(l.credit),
      // Présents seulement sur une ligne reprise d'une écriture rangée : une ligne tapée n'a pas de
      // tiers, et `undefined` laisse `modifierEcriture` garder celui du même compte.
      ...(l.tiers !== undefined ? { tiers: l.tiers, tiersId: l.tiersId || null, lettre: l.lettre || '' } : {})
    }));

  // Un montant qu'on ne sait pas lire n'est pas un zéro : « 12a » passait pour une ligne « sans
  // montant ». Le refus NOMME la case et ce qui y est écrit (règle 10.10.0 : une cellule illisible
  // se refuse en nommant la ligne). Et c'est la MÊME fonction qui éteint les boutons pendant la
  // frappe et qui refuse à l'enregistrement (9.4.5) : `verdictSaisie`.
  // UNE définition de « illisible », pour la phrase, pour la case marquée pendant la frappe ET pour
  // la case redessinée : la marque ne posait qu'à la frappe, et une pièce rouverte gardait « 12a »
  // sans rouge pendant que la phrase le nommait.
  const montantIllisible = v => { const brut = String(v == null ? '' : v).trim(); return !!brut && !Number.isFinite(KC.nombreStrict(brut)); };
  // 10.14.1 — Une case que le moteur REFUSE se marque comme une case qu'il ne sait pas lire : « -40 »
  // au débit est refusé (« un montant négatif change de colonne »), la phrase le disait sous la grille
  // et la case restait blanche — on cherchait laquelle des lignes.
  const montantRefuse = v => montantIllisible(v) || lireMontant(v) < 0;
  // 10.14.1 — la case de montant qu'on ne sait pas lire, et sa phrase. UNE définition pour la garde
  // du clic ET pour les aperçus qui se recalculent à la frappe : l'aperçu d'un bien disait « La
  // valeur d'acquisition doit être positive » sous « 85 000 DT », celui d'un bulletin comptait une
  // prime « 150 DT » pour zéro — un chiffre faux affiché, et une raison qui accuse autre chose.
  const montantIllisibleDans = root => $$(SEL_MONTANT, root).find(el => !el.disabled && el.offsetParent !== null && montantIllisible(el.value)) || null;
  const motifIllisible = v => `« ${String(v).trim()} » ne se lit pas comme un montant. Écris-le en chiffres, par exemple 1\u202f250,500.`;
  const montantsIllisibles = p => {
    const out = [];
    (p.lignes || []).forEach((l, i) => ['debit', 'credit'].forEach(k => {
      if (montantIllisible(l[k])) {
        out.push(`Ligne ${i + 1} : « ${String(l[k]).trim()} » n'est pas un montant (${k === 'debit' ? 'débit' : 'crédit'}).`);
      }
    }));
    return out;
  };
  const verdictSaisie = (p, plan, opts) => {
    const illisibles = montantsIllisibles(p);
    if (illisibles.length) return { ok: false, motif: illisibles[0], motifs: illisibles };
    return KC.ecritureValide(ecritureSaisie(p), plan, opts);
  };

  const ecritureSaisie = p => ({
    date: p.date, journal: p.journal, piece: p.piece, libelle: p.libelle,
    source: 'saisie', pieceJointe: p.pieceJointe || null, lignes: lignesReelles(p)
  });

  // Une touche, sous la forme des réglages : « Enter », « Control+Enter », « F2 ».
  function toucheDe(ev) {
    const mods = [];
    if (ev.ctrlKey || ev.metaKey) mods.push('Control');
    if (ev.altKey) mods.push('Alt');
    if (ev.shiftKey && ev.key !== 'Tab') mods.push('Shift');
    return mods.concat([ev.key]).join('+');
  }
  const touchesSaisie = () => (((S || {}).settings || {}).saisie || K.DEFAULT_SAISIE).touches || K.DEFAULT_SAISIE.touches;
  const reglagesSaisie = () => ({ ...K.DEFAULT_SAISIE, ...(((S || {}).settings || {}).saisie || {}) });

  // Chercher un compte PENDANT la frappe, par numéro ou par nom. Le classement vient de
  // `compta.comptesQuiCorrespondent` : l'écran ne trie rien lui-même, sinon sa façon de classer
  // finirait par différer de celle qu'un test prouve. Les classes `.sugg-*` viennent de la feuille
  // PARTAGÉE (9.2.1) : même composant visuel des deux côtés, et aucune règle en double.
  function suggererCompte(input, planDe, onPick, contexteDe) {
    const host = input.closest('td') || input.parentElement;
    if (!host) return;
    host.classList.add('sugg-host');
    let pop = null, sel = 0, items = [], choisiAuClavier = false;
    const fermer = () => { if (pop) pop.remove(); pop = null; items = []; };
    const dessiner = () => {
      items = KC.comptesQuiCorrespondent(planDe(), input.value, 8, contexteDe ? contexteDe() : '');
      if (!items.length || document.activeElement !== input) { fermer(); return; }
      // La liste vit sur le BODY, en position fixe calculée sur le champ (T-33) : dans la cellule,
      // elle était rognée par le `.scroll-x` du tableau — une seule entrée visible, coupée en deux.
      // Un conteneur qui défile rogne ce qui dépasse (7.13.0, vu de l'autre côté).
      if (!pop) { pop = document.createElement('div'); pop.className = 'sugg-pop sugg-fixe'; document.body.appendChild(pop); }
      const r = input.getBoundingClientRect();
      pop.style.left = Math.max(8, r.left) + 'px';
      pop.style.top = (r.bottom + 4) + 'px';
      pop.style.minWidth = Math.max(320, r.width) + 'px';
      sel = Math.min(sel, items.length - 1);
      pop.innerHTML = items.map((c, i) => `<div class="sugg-it ${i === sel ? 'sel' : ''}" data-i="${i}">
        <b>${esc(c.compte)}</b> <span class="muted">${esc(c.libelle || '')}</span>${c.horsPlan ? ' <span class="small muted" title="Pas encore dans le plan de ce dossier : il y entrera à l\'enregistrement">· plan de référence</span>' : ''}${c.parLibelle ? ' <span class="small ok-inline" title="Le libellé de la ligne nomme aussi ce compte">· d\'après le libellé</span>' : ''}</div>`).join('');
      $$('.sugg-it', pop).forEach(d => {
        // `mousedown` et pas `click` : le `blur` du champ referme la liste avant qu'un `click`
        // n'arrive, et le choix se perdrait sans que rien ne plante.
        d.onmousedown = ev => { ev.preventDefault(); choisir(items[Number(d.dataset.i)]); };
      });
    };
    const choisir = c => { if (!c) return; input.value = c.compte; fermer(); onPick(c); };
    input.addEventListener('input', () => { sel = 0; choisiAuClavier = false; dessiner(); });
    input.addEventListener('focus', () => { sel = 0; choisiAuClavier = false; dessiner(); });
    input.addEventListener('blur', () => setTimeout(fermer, 120));
    input.addEventListener('keydown', ev => {
      if (!pop || !items.length) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); choisiAuClavier = true; sel = (sel + 1) % items.length; dessiner(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); choisiAuClavier = true; sel = (sel - 1 + items.length) % items.length; dessiner(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fermer(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') {
        // Entrée et Tab CHOISISSENT quand une liste est ouverte : sans ça, il faudrait la souris
        // pour prendre ce qu'on vient de chercher, et la grille cesserait d'être au clavier.
        // Sur un champ VIDE, rien n'a été cherché : Tab ne prend que ce que le libellé nomme ou ce
        // qu'on a désigné aux flèches — sinon « Tab pour passer » posait le premier compte du plan.
        if (items[sel] && (input.value.trim() || items[sel].parLibelle || choisiAuClavier)) { ev.preventDefault(); choisir(items[sel]); }
        else fermer();
      }
    });
  }

  // ===================== (1.210.0) La Saisie face à la pièce (maquette « Saisie… », lots S1 à S6) =====================
  // Les pièces du mois que le client a envoyées et qui attendent le cabinet : une bande en haut (« Pièce 2 sur 6 »), la
  // pièce en grand à gauche, sa fiche à droite. La fiche dépend de ce que la pièce demande : la saisir (chaque champ dit
  // d'où il vient : lu sur la pièce, comme ses pièces d'avant, numéro suivant), la joindre à l'achat déjà au livre, la
  // vérifier (le client l'a saisie lui-même), la déplacer (sa date n'est pas le mois de son écriture), ou la convertir
  // (une facture en devises). « Au kilomètre » garde la grille au clavier, la pièce à côté. Rien ne s'écrit sans un geste.
  const sxState = { sel: '', mode: '', zoom: 1, rot: 0, fiches: new Map(), saisir: new Set(), tente: new Set(), dessin: '' };
  const SX_IC = {
    clavier: svgBq('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>', 14),
    lien: svgBq('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', 16),
    cal: svgBq('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', 16),
    rel: svgBq('<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>', 12),
    ok: svgBq('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 12),
  };
  const mtSx = v => Math.round(montantDe(v) * 1000);
  const millimesSx = v => { const n = Number(String(v == null ? '' : v).replace(/[\s  ]/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 1000) : NaN; };
  const dtSx = m => dtCd(m / 1000);
  const normSx = t => sansAccentsCl(t).replace(/[^a-z0-9]/g, '');
  const moisSx = () => (livresState.mode === 'mois' && livresState.mois ? livresState.mois : '');
  const ecrituresSx = () => ((livresState.livre && livresState.livre.ecritures) || []).filter(e => e.statut !== 'contrepassee' && e.journal !== 'AN');
  const achatSx = e => rubDeJournal(e.journal) === 'achats' || /^(AC|HA)/i.test(String(e.journal || ''));
  const ligne40Sx = e => (e.lignes || []).find(l => /^40/.test(String(l.compte)) && mtSx(l.credit) > 0) || (e.lignes || []).find(l => /^40/.test(String(l.compte))) || null;
  const nomTiersSx = e => { const l = ligne40Sx(e); return (l && l.tiers) || ''; };
  const tvaCompteSx = () => compteRoleCl(livresState.livre, 'tvaDeductible') || '4366';
  const sommeSx = (e, re, sens) => (e.lignes || []).filter(l => re.test(String(l.compte))).reduce((t, l) => t + mtSx(l[sens]), 0);
  const htSx = e => sommeSx(e, /^[26]/, 'debit');
  const tvaSx = e => (e.lignes || []).filter(l => String(l.compte).startsWith(tvaCompteSx().slice(0, 4))).reduce((t, l) => t + mtSx(l.debit) - mtSx(l.credit), 0);
  const ttcSx = e => sommeSx(e, /^40/, 'credit');
  // Le taux d'une écriture d'achat, lu sur ses lignes (TVA / hors taxes, au dixième) : jamais un taux écrit dans le code.
  // (1.325.0) Une écriture à plusieurs taux (une facture électronique, 19 % et 7 %) n'a pas UN taux : le rapport de ses
  // totaux (18,6 %) n'en est aucun ; elle n'en propose pas.
  const lignesTvaSx = e => (e.lignes || []).filter(l => String(l.compte).startsWith(tvaCompteSx().slice(0, 4)) && mtSx(l.debit) - mtSx(l.credit) !== 0);
  const tauxDeSx = e => { if (lignesTvaSx(e).length > 1) return 'mixte'; const h = htSx(e), t = tvaSx(e); return h > 0 && t > 0 ? String(Math.round(t * 1000 / h) / 10) : 'sans'; };
  const journalAchatsSx = () => { const j = ((livresState.livre && livresState.livre.journaux) || []).find(x => /^(AC|HA)|achat/i.test(`${x.code} ${x.libelle || ''}`)); return j ? j.code : 'AC'; };
  const journalBanqueSx = () => { const j = ((livresState.livre && livresState.livre.journaux) || []).find(x => /^(BQ|BAN)|banque/i.test(`${x.code} ${x.libelle || ''}`)); return j ? j.code : 'BQ'; };
  const fichierSx = x => (x.p ? x.p.fichier : x.doc ? x.doc.fichier : null) || { nom: x.titre || 'pièce', type: '' };
  const contenuSx = (dossier, x) => x.p ? api.pieces.contenu(dossier.id, x.p.fichier.id) : api.classeur.contenu(dossier.id, x.doc.id);
  // (1.325.0) La facture électronique reçue (le fichier El Fatoora) : lue sur le serveur dès qu'elle s'ouvre, sans l'IA
  // (lireEfactureCl) ; sa fiche part de ce que le fichier dit, chaque taux de TVA et le timbre compris, au millime.
  const estXmlSx = x => estEfactureCl(fichierSx(x));
  const teifSx = x => (x.lu && x.lu.source === 'teif' && x.lu.detail) || null;
  const deQuiSx = (dossier, x) => {
    if (x.p) {
      const j = jourTunisCl(x.p.recueLe), auj = K.today();
      const hier = new Date(Date.parse(`${auj}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
      const quand = j === auj ? `aujourd'hui à ${heureCl(x.p.recueLe)}` : j === hier ? `hier à ${heureCl(x.p.recueLe)}` : `le ${jjmm(j)}`;
      return `envoyée par ${prenomCl(x.p.de) || prenomCl(dossier.contact) || 'le client'} ${quand}${x.p.texte ? ` · « ${String(x.p.texte).slice(0, 80)} »` : ''}`;
    }
    return x.doc ? `déposée par ${prenomCl(x.doc.deposeNom) || 'le cabinet'} le ${jjmm(jourTunisCl(x.doc.deposeLe))}` : '';
  };
  // Les taux de TVA que ce dossier a déjà écrits sur ses achats : ce que la fiche propose (et « Autre taux… »).
  function tauxVusSx() {
    const vus = new Set(ecrituresSx().filter(achatSx).map(tauxDeSx).filter(t => t !== 'sans' && t !== 'mixte'));
    return [...vus].sort((a, b) => Number(a) - Number(b));
  }
  // Ce que ce fournisseur a d'habitude : combien de pièces, et la charge, le taux et le compte de SA DERNIÈRE (1.211.0 : un
  // taux changé sur une pièce, les suivantes le reprennent ; « le plus fréquent » ne suivait jamais). « tous » dit si ses
  // pièces d'avant disent toutes la même chose (« comme ses 4 tickets ») ou non (« comme son dernier ticket »).
  function habitudesSx(nom, sauf) {
    const n = normSx(nom);
    if (!n) return { n: 0 };
    const es = ecrituresSx().filter(e => achatSx(e) && e.id !== sauf && normSx(nomTiersSx(e)) === n)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.piece || '').localeCompare(String(b.piece || '')));
    if (!es.length) return { n: 0 };
    const charge = e => ((e.lignes || []).find(l => /^[26]/.test(String(l.compte)) && mtSx(l.debit) > 0) || {}).compte || '';
    const der = es[es.length - 1];
    const compte = charge(der), taux = tauxDeSx(der);
    const c40 = String((ligne40Sx(der) || {}).compte || '');
    return { n: es.length, compte, taux, c40, es, tousCompte: es.every(e => charge(e) === compte), tousTaux: es.every(e => tauxDeSx(e) === taux) };
  }
  // « comme ses 4 tickets » quand toutes disent pareil, « comme son dernier ticket » sinon.
  const commeSx = (h, tous, un, plusieurs, fem) => (!h.n ? '' : h.n === 1 ? `comme ${fem ? 'sa' : 'son'} ${un}` : tous ? `comme ses ${h.n} ${plusieurs}` : `comme ${fem ? 'sa dernière' : 'son dernier'} ${un}`);
  // Un fournisseur que le nom du fichier ou le message nomme (« facture-electricite » : la STEG, s'il est au livre).
  function fournisseurDevineSx(x) {
    const dits = new Set(motsCl(`${fichierSx(x).nom} ${(x.p && x.p.texte) || ''}`));
    const noms = [...new Set(ecrituresSx().filter(achatSx).map(nomTiersSx).filter(Boolean))];
    return noms.find(t => motsCl(t).some(w => dits.has(w) || (VEND_CL[w] || []).some(v => dits.has(v)))) || '';
  }
  // Le numéro qui suit le dernier du journal (« FA-0919 » → « FA-0920 »), jamais un numéro déjà pris.
  function numeroSuivantSx(journal, serie) {
    const pris = new Set(ecrituresSx().map(e => String(e.piece || '')));
    const der = ecrituresSx().filter(e => e.journal === journal && /\d+$/.test(String(e.piece || '')) && (!serie || String(e.piece).toUpperCase().startsWith(serie)))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.piece).localeCompare(String(b.piece))).pop();
    if (!der) return '';
    const m = /^(.*?)(\d+)$/.exec(String(der.piece));
    let n = Number(m[2]) + 1, p = '';
    for (let i = 0; i < 50; i++, n++) { p = `${m[1]}${String(n).padStart(m[2].length, '0')}`; if (!pris.has(p)) break; }
    return p;
  }
  // (1.211.0) La série des tickets d'un journal (« TK-0923 » → « TK ») : celle que le dossier a déjà, jamais une inventée.
  const serieTicketSx = journal => { const e = ecrituresSx().find(y => y.journal === journal && /^TK/i.test(String(y.piece || ''))); return e ? 'TK' : ''; };
  // Une ligne du relevé, sans écriture, du même montant et à dix jours au plus : la pièce a été payée par là.
  function ligneBanqueSx(ttcM, date) {
    if (!ttcM || !date) return null;
    for (const R of ((livresState.livre && livresState.livre.releves) || [])) {
      for (const l of R.lignes || []) {
        if (l.rapprochement && l.rapprochement.ecritureId) continue;
        if (mtSx(l.montant) !== -ttcM) continue;
        if (Math.abs(Date.parse(`${l.date}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 864e5 > 10) continue;
        return { R, l };
      }
    }
    return null;
  }
  // Les fournisseurs que le cabinet ne vérifie plus pour ce dossier (un réglage de sa fiche).
  const confianceSx = dossier => (Array.isArray(dossier.sansVerifier) ? dossier.sansVerifier : []).map(normSx);
  const dateArriveeSx = x => {
    const j = x.p ? jourTunisCl(x.p.recueLe) : x.doc ? jourTunisCl(x.doc.deposeLe) : K.today();
    if (j.slice(0, 7) === x.mois) return j;
    return new Date(Date.UTC(Number(x.mois.slice(0, 4)), Number(x.mois.slice(5, 7)), 0)).toISOString().slice(0, 10);
  };

  // Les pièces du mois regardé (toute l'année sur « Toute l'année »), et ce que chacune demande.
  function piecesSx(dossier) {
    const s = livresState;
    if (!api.pieces || !api.classeur || !s.livre) return { pret: true, liste: [], lu: false };
    chargerClasseesCl(dossier); chargerDocsCl(dossier); chargerLecturesCl(dossier);
    const pret = !!(clState.classees && clState.classeesDe === dossier.id && (clState.docs.get(dossier.id) || {}).lu && (clState.lus.get(dossier.id) || {}).lu);
    if (!pret) return { pret: false, liste: [] };
    const m = moisSx();
    const items = modeleCl(dossier, String(s.annee), s.livre);
    const sansJustif = items.filter(x => x.sorte === 'ecr' && x.etat[1] === 'sans justificatif');
    const conf = confianceSx(dossier);
    const liste = items.filter(x => (x.p || x.doc) && x.etat[2] === 'traiter' && x.rub === 'achats' && !['à importer', 'à ranger'].includes(x.etat[1]) && (x.etat[1] !== 'illisible' || x.p) && (!m || x.mois === m))
      .map(x => ({ ...x, sx: quoiSx(x, sansJustif, conf) }))
      .sort((a, b) => (a.sx.k === 'confiance') - (b.sx.k === 'confiance') || String(a.date).localeCompare(String(b.date)));
    return { pret: true, liste, items };
  }
  function quoiSx(x, sansJustif, conf) {
    if (x.etat[1] === 'illisible') return { k: 'illisible', ton: 'rouge', mot: 'illisible' };
    const e = x.numE ? ecrituresSx().find(y => y.id === x.numE) : null;
    if (x.etat[1] === 'à vérifier' && e) {
      if (x.lu && x.lu.date && String(x.lu.date).slice(0, 7) !== String(e.date).slice(0, 7)) return { k: 'mois', e, ton: 'ambre', mot: 'à reclasser' };
      if (conf.includes(normSx(nomTiersSx(e)))) return { k: 'confiance', e, ton: 'gris', mot: 'de confiance' };
      return { k: 'verifier', e, ton: 'ambre', mot: 'à vérifier' };
    }
    if (x.etat[1] === 'en double ?' && !sxState.saisir.has(x.k)) return { k: 'double', ton: 'ambre', mot: 'en double ?' };
    const dit = { total: x.lu && (!x.lu.devise || x.lu.devise === 'TND') && x.lu.total ? x.lu.total : null, numero: x.lu && x.lu.numero, fournisseur: x.lu && x.lu.fournisseur,
      texte: `${fichierSx(x).nom} ${(x.p && x.p.texte) || ''}`, mois: x.mois };
    if (!sxState.saisir.has(x.k)) {
      const c = sansJustif.map(c2 => ({ c: c2, i: indiceAchatCl({ num: c2.num, tiers: c2.titre, objet: `${c2.e.libelle || ''} ${(c2.e.lignes || []).map(l => l.libelle || '').join(' ')}`, montant: c2.montant, mois: c2.mois }, dit) }))
        .filter(o => o.i).sort((a, b) => INDICES_CL.indexOf(a.i) - INDICES_CL.indexOf(b.i))[0];
      if (c) return { k: 'deja', e: c.c.e, i: c.i, ton: 'bleu', mot: 'déjà saisie ?' };
    }
    if (x.lu && x.lu.devise && x.lu.devise !== 'TND') return { k: 'devise', ton: 'ambre', mot: 'en devises' };
    return { k: 'saisir', ton: 'ambre', mot: 'à saisir' };
  }

  // La fiche d'une pièce à saisir : proposée une fois, puis telle que le comptable la corrige.
  function ficheSx(x) {
    let f = sxState.fiches.get(x.k);
    // (1.325.0) Le fichier se lit après l'ouverture de la fiche : elle repart de lui, tant que rien n'y a été tapé.
    if (f && !(teifSx(x) && !f.teif && !f.touchee)) return f;
    const lu = x.lu || null, tnd = !lu || !lu.devise || lu.devise === 'TND';
    const four = (lu && lu.fournisseur) || fournisseurDevineSx(x);
    const h = habitudesSx(four);
    const j = journalAchatsSx();
    // Un ticket de caisse n'est pas une facture à son nom : sa TVA ne se récupère sans doute pas (À VÉRIFIER).
    const ticket = motPiecesSx(x)[0] === 'ticket';
    f = {
      four, fourSrc: lu && lu.fournisseur ? 'lu' : four ? 'nom' : '',
      date: (lu && lu.date) || dateArriveeSx(x), dateSrc: lu && lu.date ? 'lu' : 'arrivee',
      ttc: lu && lu.total && tnd ? dtSx(millimesSx(lu.total)) : '', ttcSrc: lu && lu.total && tnd ? 'lu' : '',
      tva: h.n && h.taux !== 'mixte' ? h.taux : ticket ? 'sans' : '', tvaAutre: '', tvaSrc: h.n && h.taux !== 'mixte' ? 'hab' : ticket ? 'ticket' : '',
      compte: h.n ? h.compte : '', compteSrc: h.n ? 'hab' : '',
      c40: h.c40 || '401', journal: j, serie: ticket ? serieTicketSx(j) : '', numero: (lu && lu.numero) || '',
      paye: true, devise: tnd ? '' : String(lu.devise), montantDev: tnd ? '' : String(lu.total || '').replace('.', ','), taux: tnd ? '' : prefs.get(`sxTaux:${lu.devise}`, '') || '',
    };
    f.piece = numeroSuivantSx(j, f.serie);
    // (1.325.0) Le fichier El Fatoora dit chaque taux de TVA (et sa base) et le timbre : la fiche les prend tels quels,
    // « Celles du fichier » ; un avoir s'écrit à l'envers. Rien de deviné : le compte de la charge reste celui de ses habitudes.
    const D = tnd ? teifSx(x) : null;
    if (D) {
      f.teif = D; f.teifTotal = lu.total; f.avoir = !!D.avoir;
      if ((D.tva || []).length) { f.tva = 'fichier'; f.tvaSrc = 'lu'; }
      const tb = millimesSx(D.timbre);
      if (tb > 0) { f.timbre = dtSx(tb); f.timbreSrc = 'lu'; }
    }
    sxState.fiches.set(x.k, f);
    return f;
  }
  const montantDevSx = f => { const n = Number(String(f.montantDev).replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${f.devise}` : '—'; };
  const tauxEffectifSx = f => (f.devise ? 0 : f.tva === 'autre' ? Number(String(f.tvaAutre).replace(',', '.')) || 0 : f.tva && f.tva !== 'sans' ? Number(f.tva) : 0);
  // La contre-valeur en millimes, en entiers : le montant en centimes, le taux à quatre décimales (2 350,00 € × 3,3812).
  function contreValeurSx(f) {
    const c = Math.round(Number(String(f.montantDev).replace(/[\s  ]/g, '').replace(',', '.')) * 100);
    const t = Math.round(Number(String(f.taux).replace(/[\s  ]/g, '').replace(',', '.')) * 10000);
    return Number.isFinite(c) && Number.isFinite(t) && c > 0 && t > 0 ? Math.round(c * t / 1000) : 0;
  }
  // L'écriture que la fiche écrit (en millimes), et pourquoi elle ne s'écrit pas encore.
  // (1.325.0) Les taux du fichier El Fatoora : une ligne de TVA par taux, chacune au millime du fichier ; la charge prend le
  // reste du total (le hors taxes et le timbre). Le total changé n'est plus celui du fichier : la fiche le dit, sans écrire.
  function ecritureFichierSx(f) {
    const D = f.teif, ttc = millimesSx(f.ttc), timbre = millimesSx(f.timbre || '0') || 0, four = String(f.four || '').trim();
    const tvas = (D.tva || []).map(t => ({ taux: String(t.taux), m: millimesSx(t.montant) })).filter(t => t.m > 0);
    const tva = tvas.reduce((a, t) => a + t.m, 0), charge = ttc - tva, fichier = millimesSx(f.teifTotal || '') || 0;
    const lib = `${f.avoir ? 'Avoir ' : ''}${four}${f.numero ? ` · ${f.numero}` : ''}`.slice(0, 120);
    const refus = !four ? ['four', 'Le fournisseur manque : écris son nom.']
      : !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? ['date', 'La date manque : celle de la pièce.']
        : String(f.date).slice(0, 4) !== String(livresState.annee) ? ['date', `Le ${fmtJourCourt(f.date)} n'est pas dans l'exercice ${livresState.annee}.`]
          : !(ttc > 0) ? ['ttc', 'Le total TTC manque : celui du fichier, en dinars.']
            : fichier && ttc !== fichier ? ['ttc', `Le total n'est plus celui du fichier (${dtSx(fichier)}) : remets-le, ou choisis un taux.`]
              : !(charge - timbre > 0) ? ['timbre', 'Le timbre et la TVA dépassent le total : remets ceux du fichier.']
                : !/^\d{2,12}$/.test(String(f.compte || '').trim()) ? ['compte', 'Le compte de la charge manque : son numéro (6061, 6066…).']
                  : null;
    const sens = (m, l) => (f.avoir ? { ...l, debit: 0, credit: m } : { ...l, debit: m, credit: 0 });
    const lignes = [
      sens(charge, { compte: String(f.compte || '').trim(), libelle: lib }),
      ...tvas.map(t => sens(t.m, { compte: tvaCompteSx(), libelle: `TVA ${t.taux.replace('.', ',')} % · ${four}`.slice(0, 120) })),
      f.avoir ? { compte: f.c40 || '401', libelle: lib, debit: ttc, credit: 0, tiers: four } : { compte: f.c40 || '401', libelle: lib, debit: 0, credit: ttc, tiers: four },
    ];
    return { ttc, ht: charge - timbre, tva, taux: 'fichier', timbre, lib, lignes, refus };
  }
  function ecritureSx(f) {
    if (f.tva === 'fichier' && f.teif && !f.devise) return ecritureFichierSx(f);
    const ttc = f.devise ? contreValeurSx(f) : millimesSx(f.ttc);
    const taux = tauxEffectifSx(f);
    // (1.221.0, l'épreuve d'un mois) Le timbre de la facture (1,000 DT sur la farine de la Minoterie) n'a pas de TVA : il sort
    // de la base, et va à la charge avec le HT, comme le fait l'achat chez le client (core.js : charge + frais). Sans lui, la
    // fiche déduisait 78,465 DT au lieu des 78,400 écrits sur la facture. Rien par défaut : la case vaut 0 tant qu'on n'y tape rien.
    const timbre = f.devise ? 0 : millimesSx(f.timbre || '0') || 0, base = ttc - timbre;
    const ht = taux ? Math.round(base * 100 / (100 + taux)) : base, tva = base - ht;
    const lib = `${String(f.four || '').trim()}${f.numero ? ` · ${f.numero}` : ''}${f.devise ? ` · ${montantDevSx(f).replace(/[\u202f\u00a0]/g, ' ')} à ${String(f.taux).replace('.', ',')}` : ''}`.slice(0, 120);
    const refus = !String(f.four || '').trim() ? ['four', 'Le fournisseur manque : écris son nom.']
      : !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? ['date', 'La date manque : celle de la pièce.']
        : String(f.date).slice(0, 4) !== String(livresState.annee) ? ['date', `Le ${fmtJourCourt(f.date)} n'est pas dans l'exercice ${livresState.annee}.`]
          : f.devise && !(Number(String(f.taux).replace(',', '.')) > 0) ? ['taux', `Le taux de change manque : celui du ${fmtJourCourt(f.date)} (À VÉRIFIER).`]
            : !(ttc > 0) ? ['ttc', f.devise ? 'Le montant en devises manque.' : 'Le total TTC manque : celui de la pièce, en dinars.']
              : timbre && !(base > 0) ? ['timbre', 'Le timbre dépasse le total : le total TTC le comprend déjà.']
              : !f.devise && f.tva === '' ? ['tva', 'La TVA manque : choisis le taux de la pièce, ou « Sans TVA récupérable ».']
                : !f.devise && f.tva === 'autre' && !(taux > 0) ? ['tva', 'Le taux de TVA manque.']
                  : !/^\d{2,12}$/.test(String(f.compte || '').trim()) ? ['compte', 'Le compte de la charge manque : son numéro (6061, 6066…).']
                    : null;
    const lignes = [
      { compte: String(f.compte || '').trim(), libelle: lib, debit: ht + timbre, credit: 0 },
      ...(tva ? [{ compte: tvaCompteSx(), libelle: `TVA ${String(taux).replace('.', ',')} % · ${String(f.four || '').trim()}`.slice(0, 120), debit: tva, credit: 0 }] : []),
      { compte: f.c40 || '401', libelle: lib, debit: 0, credit: ttc, tiers: String(f.four || '').trim() },
    ];
    // (1.325.0) Un avoir (lu dans son fichier) s'écrit à l'envers : le fournisseur au débit, la charge et la TVA reprises.
    if (f.avoir) return { ttc, ht, tva, taux, timbre, lib: `Avoir ${lib}`.slice(0, 120), lignes: lignes.map(l => ({ ...l, libelle: l.libelle === lib ? `Avoir ${lib}`.slice(0, 120) : l.libelle, debit: l.credit, credit: l.debit })), refus };
    return { ttc, ht, tva, taux, timbre, lib, lignes, refus };
  }
  const versLeLivreSx = lignes => lignes.map(l => ({ compte: l.compte, libelle: l.libelle, debit: l.debit / 1000, credit: l.credit / 1000, ...(l.tiers ? { tiers: l.tiers, tiersId: null, lettre: '' } : {}) }));

  // ---------- le dessin ----------
  const SRC_SX = { lu: ['lu', SX_IC.ok, 'lu sur la pièce'], nom: ['hab', SX_IC.rel, 'd\'après le nom du fichier'], hab: ['hab', SX_IC.rel, ''], arrivee: ['ambre', '!', 'date d\'arrivée : mets celle de la pièce'], calc: ['calc', '=', 'numéro suivant'] };
  const srcSx = (k, t) => { const s = SRC_SX[k]; return s ? `<span class="sx-src ${s[0]}">${s[1]} ${esc(t || s[2])}</span>` : '<span class="sx-src"></span>'; };
  const motPiecesSx = x => (x.p && x.p.genre === 'ticket') || /ticket/i.test(fichierSx(x).nom) ? ['ticket', 'tickets'] : ['facture', 'factures'];

  // (1.211.0) La pièce qui suit dans la bande, nommée dans la ligne des touches (« ouvre la pièce suivante (Minoterie…) »).
  const suivanteSx = x => { const L = (sxState.dernier || { liste: [] }).liste, i = L.findIndex(y => y.k === x.k), y = i < 0 ? null : L[i + 1]; return y ? ` (${courtSx(y)})` : ''; };
  // (1.211.0) Une pièce pas encore lue : « Lire la pièce » (avec l'accord du client), ou pourquoi elle se lit à l'œil.
  function lireSx(dossier, x) {
    if (x.lu || (!x.p && !x.doc)) return '';
    if (estXmlSx(x)) {
      const e = (clState.ef || new Map()).get(x.k);
      return `<small class="sx-aide" id="sx-ef-etat">${e && e.etape === 'refus' ? esc(e.motif) : navigator.onLine === false ? 'Le fichier El Fatoora se lit avec le réseau, sur le serveur de SkanFact.' : 'Le fichier El Fatoora se lit sur le serveur de SkanFact, sans l\'IA…'}</small>`;
    }
    const L = clState.lus.get(dossier.id) || {}, encours = clState.lit && clState.lit.k === x.k;
    if (L.ia) return `<button type="button" class="btn btn-sm cl-ia-btn${encours ? ' cl-ia-encours' : ''}" id="sx-lire"${encours || clState.lit || navigator.onLine === false ? ` disabled title="${encours || clState.lit ? 'La lecture est en cours' : 'Attend le retour du réseau'}"` : ''}>${CL_IC.ia}${encours ? 'Lecture en cours…' : 'Lire la pièce'}</button>`;
    return L.coupee ? `<small class="sx-aide">${esc(cap(prenomCl(dossier.contact) || 'le client'))} a coupé la lecture de ses pièces : celle-ci se lit à l'œil.</small>` : '';
  }
  function barreSx(P, dossier) {
    const L = P.liste, i = Math.max(0, L.findIndex(x => x.k === sxState.sel));
    const km = sxState.mode === 'km';
    const m = moisSx();
    const conf = L.filter(x => x.sx.k === 'confiance');
    const nav = km
      ? `<span class="sx-n"><b>${m ? `Achats ${esc(deMois(m))}` : `Achats de ${esc(livresState.annee)}`}</b><span class="mu">journal ${esc(journalAchatsSx())} · ${esc(pl(L.length, 'pièce à traiter', 'pièces à traiter'))}</span></span>`
      : `<span class="sx-n"><button type="button" class="btn btn-sm sx-fl" id="sx-prec" aria-label="Pièce d'avant"${i ? '' : ' disabled'}>${PC_IC.g}</button><b id="sx-rang">Pièce ${i + 1} sur ${L.length}</b><button type="button" class="btn btn-sm sx-fl" id="sx-suiv" aria-label="Pièce suivante"${i < L.length - 1 ? '' : ' disabled'}>${PC_IC.d}</button></span>
        <ol class="sx-p" aria-label="Les pièces à traiter">${L.map(x => `<li><button type="button" class="${x.k === L[i].k ? 'on ' : ''}${x.sx.ton}" data-sx-k="${esc(x.k)}" aria-pressed="${x.k === L[i].k}" title="${esc(`${x.titre} · ${x.sx.mot}`)}"><i aria-hidden="true">${x.photo ? CL_IC.photo : CL_IC.pdf}</i>${esc(courtSx(x))}</button></li>`).join('')}</ol>`;
    return `<div class="sx-barre">${nav}<span class="sx-esp"></span>${conf.length > 1 && !km && monRole() !== 'saisie' ? `<button type="button" class="btn btn-sm" id="sx-conf-tout">Marquer vérifiées les ${conf.length} de confiance</button>` : ''}
      <div class="sx-mode" role="group" aria-label="Comment saisir"><button type="button" data-sx-mode="face" aria-pressed="${!km}">${CL_IC.pdf} Face à la pièce</button><button type="button" data-sx-mode="km" aria-pressed="${km}">${SX_IC.clavier} Au kilomètre</button></div></div>`;
  }
  const courtSx = x => { const t = String((x.lu && x.lu.fournisseur) || (x.sx.e && nomTiersSx(x.sx.e)) || (sxState.fiches.get(x.k) || {}).four || fichierSx(x).nom.replace(/\.[a-z0-9]{2,4}$/i, '')); return t.length > 22 ? `${t.slice(0, 20)}…` : t; };

  function visionneuseSx(dossier, x, petit) {
    const f = fichierSx(x), xml = estXmlSx(x), photo = !xml && !/pdf/.test(f.type || '') && !/\.pdf$/i.test(f.nom);
    return `<div class="sx-dv${petit ? ' petit' : ''}${xml ? ' ef' : ''}"><div class="sx-dv-t"><span class="sx-f-ic">${photo ? CL_IC.photo : CL_IC.pdf}</span><span class="sx-dv-n"><b>${esc(f.nom)}</b><small>${esc(`${xml ? 'facture électronique (El Fatoora) · ' : ''}${deQuiSx(dossier, x)}`)}</small></span>
        <span class="sx-dv-z">${petit || xml ? '' : `<button type="button" class="btn btn-sm sx-fl" data-sx-z="-1" aria-label="Plus petit">${PC_IC.moins}</button><span id="sx-zoom">${Math.round(sxState.zoom * 100)} %</span><button type="button" class="btn btn-sm sx-fl" data-sx-z="1" aria-label="Plus grand">${PC_IC.plus}</button>${photo ? `<button type="button" class="btn btn-sm" id="sx-tourner">${PC_IC.tourne} Tourner</button>` : ''}`}<button type="button" class="btn btn-sm" id="sx-grand">${PC_IC.grand} En grand</button></span></div>
      <div class="sx-dv-f" id="sx-papier" data-k="${esc(x.k)}"><span class="mu">Ouverture de la pièce…</span></div></div>`;
  }

  function ficheSaisirSx(dossier, x) {
    const f = ficheSx(x), E = ecritureSx(f), h = habitudesSx(f.four);
    const [un, plusieurs] = motPiecesSx(x);
    const valide = peutValiderCl(dossier);
    const fem = un === 'facture';
    const habT = commeSx(h, h.tousTaux, un, plusieurs, fem), habC = commeSx(h, h.tousCompte, un, plusieurs, fem);
    const banque = !f.devise && !f.avoir && E.ttc > 0 ? ligneBanqueSx(E.ttc, f.date) : null;
    const D = f.teif || null, luT = D ? 'lu dans le fichier' : '';
    const carte = banque && /CARTE|\bCB\b|TPE/i.test(banque.l.libelle || '');
    const taux = tauxVusSx();
    const plan = ((livresState.livre || {}).plan || []);
    const nomC = c => ((plan.find(y => y.compte === String(c)) || {}).libelle) || KC.libelleDuPlan(String(c || '')) || '';
    const ch = (lab, id, champ, src) => `<div class="sx-fi-r"><label class="sx-fi-l" for="${id}">${lab}</label>${champ}${src}</div>`;
    // (1.325.0) « Celles du fichier » : chaque taux et son montant, tels que le fichier El Fatoora les dit.
    const tauxF = D ? (D.tva || []).map(t => `${String(t.taux).replace('.', ',')} %`) : [];
    const tvaF = D ? (D.tva || []).map(t => `${String(t.taux).replace('.', ',')} % : ${dtSx(millimesSx(t.montant))}`).join(' · ') : '';
    const tvaSel = `<select id="sx-tva" class="sx-in">${tauxF.length ? `<option value="fichier"${f.tva === 'fichier' ? ' selected' : ''}>Celles du fichier : ${esc(tauxF.join(' et '))}</option>` : ''}<option value=""${f.tva === '' ? ' selected' : ''}>À choisir</option><option value="sans"${f.tva === 'sans' ? ' selected' : ''}>Sans TVA récupérable</option>${taux.map(t => `<option value="${esc(t)}"${f.tva === t ? ' selected' : ''}>TVA ${esc(t.replace('.', ','))} %</option>`).join('')}<option value="autre"${f.tva === 'autre' ? ' selected' : ''}>Autre taux…</option></select>`;
    const devise = f.devise ? `<div class="sx-taux"><div><small>En ${esc(f.devise)}</small><b id="sx-mdev-v">${esc(montantDevSx(f))}</b></div>
        <div><small>Taux du ${esc(jjmm(f.date))} (À VÉRIFIER)</small><label class="sx-taux-in">× <input id="sx-taux" class="sx-in" inputmode="decimal" autocomplete="off" value="${esc(f.taux)}" placeholder="3,3812" aria-label="Le taux de change, en dinars pour 1 ${esc(f.devise)}"></label></div>
        <div class="eg"><small>Au livre, en dinars</small><b id="sx-cv">${E.ttc ? `${esc(dtSx(E.ttc))} DT` : '—'}</b></div></div>
      <ul class="sx-ck"><li class="info"><i>i</i><span><b>Au paiement, l'écart de change s'écrit à part</b><small>si le virement se fait à un autre taux : une perte (656) ou un gain (756), À VÉRIFIER</small></span></li>
        <li class="info"><i>i</i><span><b>La TVA et les droits payés à la douane</b><small>arrivent avec la déclaration en douane du transitaire : une pièce à part, à demander</small></span>${dossier.manual ? '' : `<button type="button" class="cp-plus" id="sx-douane">Demander</button>`}</li></ul>` : '';
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(f.devise ? `${f.four || fichierSx(x).nom} · facture en ${f.devise === 'EUR' ? 'euros' : f.devise}` : x.lu && x.lu.fournisseur ? `${x.lu.fournisseur}${x.lu.numero ? ` · ${f.avoir ? 'avoir' : un} ${x.lu.numero}` : ''}` : fichierSx(x).nom)}</b><small>${esc(D ? 'lue dans le fichier El Fatoora, sans l\'IA : chaque montant est celui du fichier, au millime' : x.lu ? `lue par SkanFact ${x.lu.luLe ? `le ${jjmm(jourTunisCl(x.lu.luLe))}` : ''} : chaque champ lu se vérifie sur la pièce` : 'pas encore lue : la fiche part de ses pièces d\'avant')}</small>${lireSx(dossier, x)}</div><span class="cl-st ambre">${esc(x.sx.mot)}</span></div>
      <div class="sx-fi-g">
        ${ch('Fournisseur', 'sx-four', `<span class="sx-cpt sx-cpt-f"><input id="sx-four" class="sx-in" autocomplete="off" list="sx-fours" value="${esc(f.four)}" placeholder="Son nom"><small id="sx-c40" class="mono" title="Son compte : celui de ses écritures d'avant, ou 401">${esc(f.c40 || '401')}</small></span><datalist id="sx-fours">${[...new Set(ecrituresSx().filter(achatSx).map(nomTiersSx).filter(Boolean))].map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`, f.fourSrc ? srcSx(f.fourSrc, f.fourSrc === 'lu' ? luT : '') : h.n ? srcSx('hab', `${h.n} ${h.n > 1 ? plusieurs : un} au livre`) : '<span class="sx-src ambre">nouveau fournisseur</span>')}
        ${ch('Date', 'sx-date', `<input id="sx-date" class="sx-in" autocomplete="off" value="${esc(f.date ? fmtJourCourt(f.date) : '')}" placeholder="24/09/2026">`, srcSx(f.dateSrc, f.dateSrc === 'lu' ? luT || 'lu' : ''))}
        ${f.devise ? ch('Montant', 'sx-mdev', `<input id="sx-mdev" class="sx-in" inputmode="decimal" autocomplete="off" value="${esc(f.montantDev)}">`, `<span class="sx-src">${esc(f.devise)}</span>`)
          : ch('Total TTC', 'sx-ttc', `<input id="sx-ttc" class="sx-in" inputmode="decimal" autocomplete="off" value="${esc(f.ttc)}" placeholder="85,000">`, srcSx(f.ttcSrc, luT || 'lu'))}
        ${f.devise ? '' : ch('Timbre', 'sx-timbre', `<input id="sx-timbre" class="sx-in mono" inputmode="decimal" autocomplete="off" value="${esc(f.timbre || '')}" placeholder="0,000">`, f.timbreSrc === 'lu' && D ? srcSx('lu', 'lu dans le fichier · sans TVA') : '<span class="sx-src">sans TVA : hors de sa base</span>')}
        ${f.devise ? '' : ch('TVA', 'sx-tva', `<span class="sx-tva">${tvaSel}${f.tva === 'autre' ? `<input id="sx-tva-autre" class="sx-in" inputmode="decimal" autocomplete="off" value="${esc(f.tvaAutre)}" placeholder="%" aria-label="Le taux de TVA, en %">` : ''}</span>`, f.tva === 'fichier' && D ? srcSx('lu', tvaF) : f.tvaSrc === 'hab' && f.tva === h.taux ? srcSx('hab', habT) : f.tvaSrc === 'ticket' && f.tva === 'sans' ? '<span class="sx-src ambre">un ticket n\'est pas une facture : À VÉRIFIER</span>' : '<span class="sx-src"></span>')}
        ${ch('Compte', 'sx-compte', `<span class="sx-cpt"><input id="sx-compte" class="sx-in mono" autocomplete="off" value="${esc(f.compte)}" placeholder="Numéro"><small id="sx-compte-nom">${esc(nomC(f.compte))}</small></span>`, f.compteSrc === 'hab' && f.compte === h.compte ? srcSx('hab', habC) : f.devise ? '<span class="sx-src">ou une immobilisation ? À VÉRIFIER</span>' : '<span class="sx-src"></span>')}
        ${ch('Pièce', 'sx-piece', `<input id="sx-piece" class="sx-in mono" autocomplete="off" value="${esc(f.piece)}">`, f.piece && f.piece === numeroSuivantSx(f.journal, f.serie) ? srcSx('calc', `numéro suivant · ${f.serie ? 'série des tickets · ' : ''}journal ${f.journal}`) : `<span class="sx-src">journal ${esc(f.journal)}</span>`)}
      </div>
      ${!f.devise && (f.tvaSrc === 'hab' || f.compteSrc === 'hab' || f.tvaSrc === 'ticket') ? `<p class="sx-aide" id="sx-suivent">${h.n && D ? `Le compte reprend ${fem ? 'sa dernière' : 'son dernier'} ${esc(un)} (la TVA, elle, vient du fichier) : changé ici, ${fem ? 'les prochaines' : 'les prochains'} ${esc(plusieurs)} de ${esc(f.four || 'ce fournisseur')} le reprendront.` : h.n ? `La TVA et le compte reprennent ${fem ? 'sa dernière' : 'son dernier'} ${esc(un)} : changés ici, ${fem ? 'les prochaines' : 'les prochains'} ${esc(plusieurs)} de ${esc(f.four || 'ce fournisseur')} les reprendront.` : `Enregistrés, la TVA et le compte se proposeront pareil pour ${fem ? 'les prochaines' : 'les prochains'} ${esc(plusieurs)} de ${esc(f.four || 'ce fournisseur')}.`}</p>` : ''}
      ${devise}${D ? controlesFichierSx(dossier, f) : ''}
      ${banque ? `<label class="sx-paye"><input type="checkbox" id="sx-paye"${f.paye ? ' checked' : ''}><span><b>Payée ${carte ? 'par carte ' : ''}le ${esc(jjmm(banque.l.date))}</b><small>« ${esc(banque.l.libelle)} ${esc(dtSx(-mtSx(banque.l.montant)))} » est sur le relevé ${esc(banque.R.banque || 'de banque')}, sans écriture : coché, son règlement s'écrit et se rapproche en même temps</small></span></label>` : ''}
      <div class="sx-ec"><div class="sx-ec-t"><b>L'écriture qui s'écrit</b><button type="button" class="cp-plus" id="sx-lignes">Ouvrir en lignes</button></div>
        <table class="sx-t"><tbody id="sx-ec-l">${lignesEcritureSx(f, banque)}</tbody></table></div>
      <p class="sx-refus${sxState.tente.has(x.k) ? '' : ' reste'}" id="sx-refus" role="status"${E.refus ? '' : ' hidden'}>${E.refus ? esc(E.refus[1]) : ''}</p>
      <div class="sx-gestes">${valide ? '<button type="button" class="btn btn-primary" id="sx-ok-valider">Enregistrer et valider <kbd>↵</kbd></button><button type="button" class="btn" id="sx-ok">Au brouillard</button>'
        : `<button type="button" class="btn btn-primary" id="sx-ok">Enregistrer au brouillard <kbd>↵</kbd></button>`}<button type="button" class="btn" id="sx-autre">Autre chose…</button>${valide ? '' : `<span class="fd-qui" id="sx-qui-valide">${esc(cap(reviseurCl(dossier)))} valide le brouillard</span>`}</div>
      <p class="sx-touches">${SX_IC.clavier}<span><kbd>Tab</kbd> champ suivant · <kbd>↵</kbd> ${valide ? 'enregistre, valide' : 'enregistre au brouillard'} et ouvre la pièce suivante${esc(suivanteSx(x))} · <kbd>Alt</kbd>+<kbd>→</kbd> passe la pièce · <kbd>Alt</kbd>+<kbd>L</kbd> en lignes</span></p></div>`;
  }
  // (1.325.0) Ce que le fichier El Fatoora dit de plus qu'une photo : à qui il est adressé, s'il est signé, s'il est un avoir.
  function controlesFichierSx(dossier, f) {
    const D = f.teif, L = [];
    if (D.ailleurs) L.push(['ko', `Adressée à ${D.ailleurs.nom || 'une autre société'}${D.ailleurs.identifiant ? ` (${D.ailleurs.identifiant})` : ''}, pas à ${dossier.name}`, 'le fichier nomme un autre acheteur : à demander avant de la saisir']);
    L.push(D.signe ? ['ok', `Fichier signé${D.refTtn ? ` · réf. TTN ${D.refTtn}` : ''}`, 'chaque montant vient du fichier, au millime : rien n\'a été lu par l\'IA']
      : ['att', 'Le fichier n\'est pas signé', 'les montants viennent du fichier ; sa TVA se déduit-elle sans la signature ? À VÉRIFIER']);
    if (D.avoir) L.push(['info', 'Un avoir : l\'écriture est à l\'envers', `${D.refFacture ? `il diminue la facture ${D.refFacture}` : 'il diminue une facture'} ; la charge et la TVA se reprennent`]);
    const ic = { ok: CL_IC.ok, info: 'i', att: '!', ko: '!' };
    return `<ul class="sx-ck" id="sx-ef-ck">${L.map(([t, titre, sous]) => `<li class="${t}"><i>${ic[t]}</i><span><b>${esc(titre)}</b><small>${esc(sous)}</small></span></li>`).join('')}</ul>`;
  }
  function lignesEcritureSx(f, banque) {
    const E = ecritureSx(f), plan = ((livresState.livre || {}).plan || []);
    const nomC = (c, l) => l.tiers || ((plan.find(y => y.compte === String(c)) || {}).libelle) || KC.libelleDuPlan(String(c || '')) || '';
    const paye = banque && f.paye && !f.devise && !f.avoir;
    const r = E.lignes.map(l => `<tr><td class="mono">${esc(l.compte || '—')}</td><td>${esc(nomC(l.compte, l))}</td><td class="r">${l.debit ? esc(dtSx(l.debit)) : ''}</td><td class="r">${l.credit ? esc(dtSx(l.credit)) : ''}</td></tr>`).join('');
    const b = paye ? `<tr class="bq"><td class="mono">${esc(f.c40 || '401')}</td><td>Règlement du ${esc(jjmm(banque.l.date))} · rapproché</td><td class="r">${esc(dtSx(E.ttc))}</td><td></td></tr><tr class="bq"><td class="mono">${esc(banque.R.compte || '532')}</td><td>${esc(banque.R.banque || 'Banque')}</td><td></td><td class="r">${esc(dtSx(E.ttc))}</td></tr>` : '';
    return r + b;
  }

  function ficheDejaSx(dossier, x) {
    const e = x.sx.e, lu = x.lu || null, qui = prenomCl(dossier.contact) || 'Le client';
    const fort = x.sx.i === 'montant' || x.sx.i === 'numero';
    const tiers = nomTiersSx(e), l40 = ligne40Sx(e) || {};
    const ttc = ttcSx(e), tva = tvaSx(e);
    const egal = (a, b) => a != null && b != null && a === b;
    // (1.216.0) Une pièce pas encore lue n'a rien à dire : pas de colonne « à lire sur la pièce » répétée à chaque ligne.
    const luQ = !!(lu && (lu.fournisseur || lu.date || lu.total));
    const rang = (lab, a, b, ok) => `<tr><td class="mu">${lab}</td>${luQ ? `<td>${a == null ? '<span class="mu">—</span>' : esc(a)}</td>` : ''}<td>${esc(b)}</td><td class="ok">${ok ? CL_IC.ok : ''}</td></tr>`;
    const luTtc = lu && lu.total && (!lu.devise || lu.devise === 'TND') ? millimesSx(lu.total) : null;
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(lu && lu.fournisseur ? `${lu.fournisseur}${lu.numero ? ` · facture ${lu.numero}` : ''}` : fichierSx(x).nom)}</b><small>${esc(deQuiSx(dossier, x))}</small></div><span class="cl-st bleu">${fort ? 'déjà saisie' : 'déjà saisie ?'}</span></div>
      <div class="bandeau info sx-band">${SX_IC.lien}<span class="txt"><b>${fort ? 'Elle est déjà au livre' : 'Peut-être déjà au livre'} : ${esc(e.piece || 'un achat')}, sans justificatif</b><span>${esc(qui)} a saisi cet achat le ${esc(jjmm(e.date))} sans la pièce. ${esc(POURQUOI_CL[x.sx.i] || '')}. La saisir encore le compterait deux fois.</span></span></div>
      ${luQ ? '' : `<p class="sx-aide">La pièce n'est pas encore lue : compare-la à l'œil avec ce que dit ${esc(e.piece || 'l\'achat')}.</p>`}
      <table class="sx-t sx-cmp"><thead><tr><th></th>${luQ ? '<th>La pièce dit</th>' : ''}<th>${esc(e.piece || 'L\'achat')} dit</th><th></th></tr></thead><tbody>
        ${rang('Fournisseur', lu && lu.fournisseur ? lu.fournisseur : null, `${tiers || '—'}${l40.compte ? ` · ${l40.compte}` : ''}`, lu && normSx(lu.fournisseur) === normSx(tiers))}
        ${rang('Date', lu && lu.date ? fmtJourCourt(lu.date) : null, fmtJourCourt(e.date), lu && lu.date === e.date)}
        ${rang('Total TTC', luTtc != null ? dtSx(luTtc) : null, dtSx(ttc), egal(luTtc, ttc))}
        ${rang('TVA', null, tva ? `${dtSx(tva)} · ${tvaCompteSx()}` : 'aucune', false)}
        <tr><td class="mu">Justificatif</td>${luQ ? '<td>cette pièce</td>' : ''}<td class="ambre">aucun</td><td></td></tr></tbody></table>
      <p class="sx-aide">La joindre complète ${esc(e.piece || 'l\'achat')}${tva ? ` : ses ${esc(dtSx(tva))} DT de TVA deviennent justifiés pour le contrôle` : ''}. ${e.statut === 'validee' ? `${esc(e.piece || 'L\'achat')} est validé : rien ne s'y modifie, la pièce s'y ajoute.` : 'Rien ne s\'y modifie : la pièce s\'y ajoute.'}</p>
      <div class="sx-gestes"><button type="button" class="btn btn-primary" id="sx-joindre">${SX_IC.lien} Joindre à ${esc(e.piece || 'cet achat')} <kbd>↵</kbd></button><button type="button" class="btn" id="sx-pas-meme">Ce n'est pas la même : la saisir</button></div>
      <p class="sx-touches">${SX_IC.clavier}<span><kbd>↵</kbd> joint et ouvre la pièce suivante · <kbd>Alt</kbd>+<kbd>→</kbd> la passe</span></p></div>`;
  }

  // (S1) Ce que SkanFact a contrôlé sur une pièce que le client a saisie lui-même, et ce qui reste à regarder.
  function controlesSx(dossier, x) {
    const e = x.sx.e, lu = x.lu || null, tiers = nomTiersSx(e), l40 = ligne40Sx(e) || {};
    const h = habitudesSx(tiers, e.id), ttc = ttcSx(e), ht = htSx(e), tva = tvaSx(e);
    const ch = (e.lignes || []).find(l => /^[26]/.test(String(l.compte)) && mtSx(l.debit) > 0) || {};
    const plan = ((livresState.livre || {}).plan || []);
    const nomC = c => ((plan.find(y => y.compte === String(c)) || {}).libelle) || KC.libelleDuPlan(String(c || '')) || '';
    const L = [];
    L.push(tiers || String(l40.compte || '').length > 3 ? ['ok', 'Le fournisseur et son compte', `${tiers || nomC(l40.compte)} · ${l40.compte}`, l40.compte] : ['att', 'Le fournisseur n\'est pas nommé', `la ligne ${l40.compte || '401'} n'a pas de tiers`, '']);
    if (!h.n) L.push(['info', 'Sa première facture au livre', `la charge : ${ch.compte || '—'} ${nomC(ch.compte)}`, ch.compte || '']);
    else if (h.compte === ch.compte) L.push(['ok', `La charge, ${commeSx(h, h.tousCompte, 'facture', 'factures', true)}${h.n === 1 || h.tousCompte ? ' d\'avant' : ''}`, nomC(ch.compte), ch.compte]);
    else L.push(['att', 'La charge n\'est pas celle d\'avant', `${h.tousCompte ? 'd\'habitude' : 'la dernière fois'} ${h.compte} ${nomC(h.compte)}, ici ${ch.compte || '—'}`, ch.compte || '']);
    const luT = lu && lu.total && (!lu.devise || lu.devise === 'TND') ? millimesSx(lu.total) : null;
    if (luT != null) L.push(luT === ttc ? ['ok', 'Le total lu = le total écrit', `${dtSx(ttc)} DT`, ''] : ['ko', 'Le total lu n\'est pas le total écrit', `la pièce dit ${dtSx(luT)}, l'écriture ${dtSx(ttc)} : à corriger avant de la marquer vérifiée`, '']);
    L.push(tva && tauxDeSx(e) === 'mixte' ? ['ok', 'La TVA écrite, à plusieurs taux', `${lignesTvaSx(e).map(l => l.libelle || l.compte).join(' · ')}${luT == null ? ' · à comparer à la pièce' : ''}`, dtSx(tva)]
      : tva ? [tauxVusSx().includes(tauxDeSx(e)) ? 'ok' : 'att', 'La TVA écrite', `${String(tauxDeSx(e)).replace('.', ',')} % de ${dtSx(ht)}${luT == null ? ' · à comparer à la pièce' : ''}`, dtSx(tva)] : ['info', 'Sans TVA', 'aucune TVA récupérable n\'est écrite', '']);
    const num = (lu && lu.numero) || '';
    const memes = ecrituresSx().filter(y => y.id !== e.id && achatSx(y) && normSx(nomTiersSx(y)) === normSx(tiers) && ((num && `${y.libelle || ''} ${y.piece || ''}`.includes(num)) || (y.piece && y.piece === e.piece)));
    L.push(memes.length ? ['ko', `${num ? `Le numéro ${num}` : 'Ce numéro'} est saisi deux fois`, `aussi dans ${memes.map(y => y.piece || jjmm(y.date)).join(', ')}`, ''] : ['ok', `${num ? `Le numéro ${num}` : `${e.piece || 'Ce numéro'}`} n'est saisi qu'une fois`, `aucune autre pièce de ${tiers || 'ce fournisseur'} avec ce numéro`, '']);
    // Payée : la ligne du fournisseur lettrée, ou un relevé qui la paie (au même montant, ou net d'une retenue).
    const rel = ((livresState.livre && livresState.livre.releves) || []).flatMap(R => (R.lignes || []).map(l => ({ R, l })))
      .find(o => o.l.rapprochement && o.l.rapprochement.ecritureId && ecrituresSx().some(y => y.id === o.l.rapprochement.ecritureId && (y.lignes || []).some(l => /^40/.test(String(l.compte)) && mtSx(l.debit) > 0 && normSx(l.tiers || '') === normSx(tiers))) && Math.abs(-mtSx(o.l.montant) - ttc) <= Math.max(1, Math.round(ttc * 0.05)));
    // Pas encore rapprochée : une ligne du relevé qui nomme le fournisseur, du même montant ou à 5 % près (net d'une retenue).
    const mots = motsCl(tiers);
    const surReleve = !rel && ((livresState.livre && livresState.livre.releves) || []).flatMap(R => (R.lignes || []).map(l => ({ R, l })))
      .find(o => !(o.l.rapprochement && o.l.rapprochement.ecritureId) && mtSx(o.l.montant) < 0 && mots.some(w => motsCl(o.l.libelle).includes(w)) && Math.abs(-mtSx(o.l.montant) - ttc) <= Math.max(1, Math.round(ttc * 0.05)));
    const cRs = compteRoleCl(livresState.livre, 'rsOperee');
    const rsDe = y => (y.lignes || []).filter(l => cRs && String(l.compte).startsWith(cRs)).reduce((t, l) => t + mtSx(l.credit), 0);
    // (1.215.0) La retenue naît au règlement : elle est sur l'achat (saisi net) ou sur l'écriture qui le paie (le fournisseur
    // débité du TTC de la pièce, la retenue au crédit).
    const reglt = rsDe(e) ? null : ecrituresSx().find(y => y.id !== e.id && rsDe(y) > 0 && (y.lignes || []).some(l => /^40/.test(String(l.compte)) && mtSx(l.debit) === ttc && normSx(l.tiers || '') === normSx(tiers)));
    L.push(l40.lettre ? ['ok', 'Payée, lettrée', `la ligne ${l40.compte} porte la lettre ${l40.lettre}`, ''] : reglt ? ['ok', `Payée le ${jjmm(reglt.date)}`, `${reglt.piece || reglt.libelle || 'son règlement'} · net de sa retenue`, dtSx(ttc - rsDe(reglt))] : rel ? ['ok', `Payée le ${jjmm(rel.l.date)}, rapprochée`, `${rel.l.libelle}${-mtSx(rel.l.montant) !== ttc ? ' · net de sa retenue' : ''}`, dtSx(-mtSx(rel.l.montant))]
      : surReleve ? ['att', `Payée le ${jjmm(surReleve.l.date)}, pas encore rapprochée`, `« ${surReleve.l.libelle} » sur le relevé ${surReleve.R.banque || ''}${-mtSx(surReleve.l.montant) !== ttc ? ` : ${dtSx(ttc + mtSx(surReleve.l.montant))} de moins, sa retenue à la source ?` : ''} · se rapproche dans la Banque`, dtSx(-mtSx(surReleve.l.montant))]
        : ['att', 'Pas encore payée dans ses livres', 'aucune ligne du relevé ne la paie encore', '']);
    const rs = rsDe(e) || (reglt ? rsDe(reglt) : 0);
    if (rs) {
      L.push(['att', 'Le certificat de retenue à remettre', `${prenomCl(dossier.contact) || 'Le client'} a retenu ${dtSx(rs)} DT : ${tiers || 'le fournisseur'} attend son certificat (À VÉRIFIER : le délai)`, '', 'certif']);
      // (1.215.0, D2) Ce que le certificat porte, lu sur l'écriture et sur le relevé qui la paie : jamais un taux écrit dans le code.
      const paye = reglt ? reglt.date : rel ? rel.l.date : surReleve ? surReleve.l.date : '';
      L.certif = { rs, brut: reglt ? ttc : ttc + rs, tiers, piece: num || e.piece || '', date: e.date, paye };
    }
    return L;
  }
  // (1.211.0) La confiance chiffrée : les pièces de ce client déjà vérifiées cette année, et celles de ce fournisseur.
  function confianceChiffreeSx(x, tiers) {
    const items = ((sxState.dernier || {}).items || []).filter(y => (y.p || y.doc) && y.etat[1] === 'vérifiée' && y.k !== x.k);
    const four = items.filter(y => y.deLAchat && normSx(nomTiersSx(y.deLAchat)) === normSx(tiers)).length;
    return { tout: items.length, four };
  }
  function ficheVerifierSx(dossier, x) {
    const e = x.sx.e, tiers = nomTiersSx(e), qui = prenomCl(dossier.contact) || 'Le client';
    const L = controlesSx(dossier, x), ko = L.some(c => c[0] === 'ko');
    const conf = x.sx.k === 'confiance';
    const ic = { ok: CL_IC.ok, info: 'i', att: '!', ko: '!' };
    // Un collaborateur en saisie ne vérifie ni ne demande : la page nomme qui le fait (comme le classeur).
    const enSaisie = monRole() === 'saisie', rev = enSaisie ? cap(reviseurCl(dossier)) : '';
    const cc = confianceChiffreeSx(x, tiers);
    const chiffre = cc.tout ? `${pl(cc.tout, `pièce de ${qui} déjà vérifiée`, `pièces de ${qui} déjà vérifiées`)} en ${livresState.annee}${cc.four ? `, dont ${cc.four} de ${tiers}` : ''}.` : '';
    const gestes = enSaisie ? `<span class="fd-qui" id="sx-qui-verifie">${esc(rev)} la vérifie</span>`
      : `<button type="button" class="btn${ko ? '' : ' btn-primary'}" id="sx-verifiee">Marquer vérifiée${ko ? '' : ' <kbd>↵</kbd>'}</button>${dossier.manual ? '' : `<button type="button" class="btn${ko ? ' btn-primary' : ''}" id="sx-corriger">Corriger…${ko ? ' <kbd>↵</kbd>' : ''}</button><button type="button" class="btn" id="sx-demander">Demander à ${esc(qui)}</button>`}`;
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(tiers || e.libelle || 'Achat')}${x.lu && x.lu.numero ? ` · ${esc(x.lu.numero)}` : ''}</b><small>saisie par ${esc(qui)} le ${esc(jjmm(e.date))} dans SkanFact · ${esc(e.piece || '')}</small></div><span class="cl-st ${conf ? 'gris' : 'ambre'}">${esc(x.sx.mot)}</span></div>
      <div class="sx-qui"><span class="sx-pers" aria-hidden="true">${esc(qui.slice(0, 1).toUpperCase())}</span><span><b>${esc(qui)} l'a saisie elle-même</b><small>la pièce est rangée dans son achat · l'écriture est ${e.statut === 'validee' ? 'validée' : 'au brouillard'} : elle suit son achat, ${esc(qui)} la corrige dans SkanFact</small></span></div>
      ${conf ? `<p class="sx-aide">Tu as dit de ne plus vérifier les factures de ${esc(tiers)} : la marquer vérifiée suffit. <button type="button" class="cp-plus" id="sx-conf-non">Reprendre la vérification</button></p>` : ''}
      <ul class="sx-ck">${L.map(([t, titre, sous, droite, geste]) => `<li class="${t}"><i>${ic[t]}</i><span><b>${esc(titre)}</b><small>${esc(sous)}</small></span>${geste === 'certif' ? '<button type="button" class="cp-plus" id="sx-certif">Le préparer</button>' : droite ? `<span class="mono">${esc(droite)}</span>` : ''}</li>`).join('')}</ul>
      ${ko ? `<p class="sx-refus" role="status">Un contrôle ne passe pas : « Corriger… » demande à ${esc(qui)} de corriger son achat, l'écriture suit ; puis la pièce se vérifie.</p>` : ''}
      <div class="sx-gestes">${gestes}</div>
      ${!conf && tiers && !ko && !enSaisie ? `<p class="sx-conf">${CL_IC.ok}<span>${chiffre ? `${esc(chiffre)} ` : ''}Ses factures de ${esc(tiers)} passent toujours ?</span><button type="button" class="cp-plus" id="sx-conf-oui">Ne plus me faire vérifier ${esc(tiers)}</button></p>` : ''}
      ${enSaisie ? '' : `<p class="sx-touches">${SX_IC.clavier}<span>${ko ? `<kbd>↵</kbd> demande la correction` : `<kbd>↵</kbd> marque vérifiée et ouvre la pièce suivante${esc(suivanteSx(x))}`}${dossier.manual ? '' : ' · <kbd>C</kbd> corriger'} · <kbd>Alt</kbd>+<kbd>→</kbd> la passe</span></p>`}</div>`;
  }
  // (1.215.0, D2) « Le préparer » : le certificat de retenue que le client remet à son fournisseur, fait au cabinet. Ce qu'il
  // porte vient de l'écriture (la retenue, le montant de la pièce) et du relevé qui la paie ; le modèle officiel, ses mentions
  // et sa numérotation restent À VÉRIFIER, et la fenêtre le dit avant le PDF.
  function certificatSx(dossier, x) {
    const c = controlesSx(dossier, x).certif;
    if (!c) return;
    const taux = c.brut > 0 ? String(Math.round(c.rs * 1000 / c.brut) / 10).replace('.', ',') : '—';
    const qui = prenomCl(dossier.contact) || 'le client';
    const lignes = [['Payeur', `<b>${esc(dossier.name)}</b>${dossier.matricule ? ` · MF ${esc(dossier.matricule)}` : ''}`], ['Bénéficiaire', `<b>${esc(c.tiers || 'Le fournisseur')}</b>`],
      ['Pièce', `${esc(c.piece || '—')} du ${esc(jjmmaaCl(c.date))}`], ['Montant de la pièce', `${esc(dtSx(c.brut))} DT TTC`],
      ['Retenue', `<b>${esc(dtSx(c.rs))} DT</b> · ${esc(taux)} %`], ['Réglée le', esc(c.paye ? jjmmaaCl(c.paye) : 'pas encore vue au relevé')]];
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Certificat de retenue à la source</title><style>
      body{font:13px/1.5 Inter,Arial,sans-serif;color:#1b2430;margin:48px}h1{font-size:20px;margin:0 0 4px}p.s{color:#5b6675;margin:0 0 28px}
      .p{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}.p div{flex:1;border:1px solid #d3d9e2;border-radius:8px;padding:12px}
      .p b{display:block;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:8px 0;border-bottom:1px solid #e6eaf0}td:last-child{text-align:right;font-weight:600}
      .n{margin-top:32px;font-size:11px;color:#5b6675}</style></head><body>
      <h1>Certificat de retenue à la source</h1><p class="s">Établi le ${esc(jjmmaaCl(K.today()))}, préparé par le cabinet</p>
      <div class="p"><div><small>Payeur</small><b>${esc(dossier.name)}</b>${dossier.matricule ? `MF ${esc(dossier.matricule)}` : ''}</div><div><small>Bénéficiaire</small><b>${esc(c.tiers || '')}</b></div></div>
      <table>${lignes.slice(2).map(([k, v]) => `<tr><td>${k}</td><td>${v.replace(/<\/?b>/g, '')}</td></tr>`).join('')}</table>
      <p class="n">Le modèle officiel de ce certificat, ses mentions et sa numérotation sont À VÉRIFIER.</p></body></html>`;
    modal(`<h2>Le certificat de retenue de ${esc(c.tiers || 'ce fournisseur')}</h2>
      <dl class="sx-certif-l" id="sx-certif-l">${lignes.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="small muted">${esc(cap(qui))} le signe et le remet à ${esc(c.tiers || 'son fournisseur')} ; la retenue se déclare et se reverse le mois qui suit son règlement. Le modèle officiel : À VÉRIFIER.</p>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn btn-primary" id="sx-certif-pdf">Le PDF du certificat</button></div>`,
    (root, close) => {
      $('#sx-certif-pdf', root).onclick = async () => {
        try { const f = await api.exportPdf(html, `Certificat-retenue_${String(c.piece || 'achat').replace(/[^\w-]/g, '')}.pdf`); close(); toast(f ? `Certificat prêt : ${f}` : 'Certificat prêt'); }
        catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }
  // (1.211.0) « Corriger… » : l'achat du client suit sa pièce (le cabinet ne le réécrit pas chez lui). La demande nomme ce
  // qui ne passe pas, d'après les contrôles ; le client corrige dans SkanFact, l'écriture suit, la pièce revient à vérifier.
  function corrigerSx(dossier, x) {
    const e = x.sx.e, qui = prenomCl(dossier.contact);
    const L = controlesSx(dossier, x).filter(c => c[0] === 'ko' || c[0] === 'att');
    const quoi = L.length ? L.map(c => `${c[1].replace(/^./, m => m.toLowerCase())} (${c[2]})`).join(' ; ') : '';
    fenDemanderCl(dossier, { titre: `Corriger ${e.piece || 'ton achat'} · ${nomTiersSx(e)}`, piece: `la correction de ${e.piece || 'ton achat'} (${nomTiersSx(e)})`, mois: x.mois,
      texte: `Bonjour${qui ? ` ${qui}` : ''}, sur ton achat ${e.piece || ''} (${nomTiersSx(e)}, ${dtSx(ttcSx(e))} DT, du ${jjmm(e.date)}) : ${quoi ? `${quoi}. ` : ''}Peux-tu le corriger dans SkanFact ? L'écriture suivra.` }, { hors: true });
  }

  // (S2) La pièce au mauvais mois : la TVA d'une facture se déduit au mois de sa date (À VÉRIFIER). Ce que le geste change
  // dans les deux mois, avant le geste.
  function ficheMoisSx(dossier, x) {
    const e = x.sx.e, lu = x.lu, tiers = nomTiersSx(e);
    const mE = String(e.date).slice(0, 7), mP = String(lu.date).slice(0, 7);
    const L = lireLivreFd(livresState.livre);
    const declE = !!(L.decl[mE] && L.decl[mE].deposee);
    const tva = tvaSx(e);
    const tvaMois = m => ecrituresSx().filter(y => String(y.date).slice(0, 7) === m).reduce((t, y) => t + tvaSx(y), 0);
    const avantE = tvaMois(mE), avantP = tvaMois(mP);
    // (1.211.0) La TVA à payer de chaque mois (la collectée moins la déductible, lues sur les écritures) : ce que le geste
    // change pour le client, avant le geste ; et le jour où le mois de la pièce se dépose.
    const cCol = compteRoleCl(livresState.livre, 'tvaCollectee') || '4367';
    const colMois = m => ecrituresSx().filter(y => String(y.date).slice(0, 7) === m).reduce((t, y) => t + (y.lignes || []).filter(l => String(l.compte).startsWith(cCol)).reduce((u, l) => u + mtSx(l.credit) - mtSx(l.debit), 0), 0);
    const aPayer = v => (v >= 0 ? dtSx(v) : `crédit ${dtSx(-v)}`);
    const payE = colMois(mE) - avantE, payP = colMois(mP) - avantP;
    const depot = (() => { try { return K.dateLimiteDeclaration(S, mP, 'tva', dossier) || ''; } catch { return ''; } })();
    const auj = K.today();
    const declP = !!(L.decl[mP] && L.decl[mP].deposee);
    const depotTxt = declP ? 'déjà déposé' : !depot ? '' : depot === auj ? 'se dépose aujourd\'hui' : depot < auj ? `devait se déposer le ${jjmm(depot)}` : `se dépose au plus tard le ${jjmm(depot)} (À VÉRIFIER)`;
    const enSaisie = monRole() === 'saisie', rev = enSaisie ? cap(reviseurCl(dossier)) : '';
    const horsEx = String(lu.date).slice(0, 4) !== String(livresState.annee);
    const avantDecl = declE && mP < mE;
    const cp = declE ? lu.date : e.date;
    // L'écriture d'un achat du client suit sa pièce (elle ne se change pas dans les livres) : c'est le client qui corrige la
    // date dans SkanFact, et le livre suit. Le cabinet le lui demande ; il ne réécrit rien chez lui.
    const client = e.source && e.source !== 'saisie';
    const qui = prenomCl(dossier.contact) || 'le client';
    const demDate = client ? dateDemandeeSx(dossier, e) : null;
    const bloque = client ? '' : horsEx ? `Le ${fmtJourCourt(lu.date)} n'est pas dans l'exercice ${livresState.annee} : à déplacer à la main.` : avantDecl ? `${cap(moisLong(mE))} est déclaré et la pièce est d'avant : la régularisation se fait à la main (À VÉRIFIER).` : '';
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(tiers || 'Achat')}${lu.numero ? ` · ${esc(lu.numero)}` : ''}</b><small>saisie par ${esc(prenomCl(dossier.contact) || 'le client')} au ${esc(jjmm(e.date))} · ${esc(e.piece || '')}</small></div><span class="cl-st ambre">à reclasser</span></div>
      <div class="bandeau info sx-band">${SX_IC.cal}<span class="txt"><b>La facture est du ${esc(jjmm(lu.date))}, l'écriture du ${esc(jjmm(e.date))}</b><span>La TVA d'une facture se déduit le mois de sa date (À VÉRIFIER) : elle compte en ${esc(moisLong(mP))}, pas en ${esc(moisLong(mE))}.</span></span></div>
      <div class="sx-mv"><div class="de"><b>${esc(cap(moisLong(mE)))}</b><span class="r"><span>TVA déductible</span><b class="moins">${esc(dtSx(avantE))} → ${esc(dtSx(avantE - tva))}</b></span>${declE ? '' : `<span class="r" id="sx-mv-payer-e"><span>TVA à payer</span><b>${esc(aPayer(payE))} → ${esc(aPayer(payE + tva))}</b></span>`}<span class="mu">${declE ? 'déposé : il ne change pas, la correction passe au mois de la pièce' : 'pas encore déposé : il se recalcule'} · brouillard compris</span></div>
        <span class="fl" aria-hidden="true">→</span>
        <div class="vers"><b>${esc(cap(moisLong(mP)))}</b><span class="r"><span>TVA déductible</span><b class="plus">${esc(dtSx(avantP))} → ${esc(dtSx(avantP + tva))}</b></span><span class="r" id="sx-mv-payer-p"><span>TVA à payer</span><b>${esc(aPayer(payP))} → ${esc(aPayer(payP - tva))}</b></span><span class="r"><span>l'écriture</span><b class="mono">${esc(e.piece || '')} · ${esc(jjmm(lu.date))}</b></span>${depotTxt ? `<span class="mu" id="sx-mv-depot">${esc(cap(moisLong(mP)))} ${esc(depotTxt)}</span>` : ''}</div></div>
      <ul class="sx-ck"><li class="${declE ? 'info' : 'ok'}"><i>${declE ? 'i' : CL_IC.ok}</i><span><b>${esc(cap(moisLong(mE)))} ${declE ? 'est déposé' : 'n\'est pas déposé'}</b><small>${declE ? `rien de déclaré ne se réécrit : la contre-passation se date du ${esc(jjmm(cp))}, dans le mois de la pièce` : 'rien de déclaré ne change'}</small></span></li>
        ${client ? `<li class="info"><i>i</i><span><b>${esc(e.piece || 'L\'écriture')} suit l'achat de ${esc(qui)}</b><small>elle ne se change pas dans les livres : ${esc(qui)} corrige la date dans SkanFact, et l'écriture suit${declE ? ` (${esc(moisLong(mE))} étant déposé, SkanFact la régularise au mois de la pièce)` : ''}</small></span></li>`
          : `<li class="ok"><i>${CL_IC.ok}</i><span><b>${e.statut === 'validee' ? `${esc(e.piece || 'L\'écriture')} se contre-passe au ${esc(jjmm(cp))}, et s'écrit à nouveau au ${esc(jjmm(lu.date))}` : `${esc(e.piece || 'L\'écriture')} est au brouillard : sa date passe au ${esc(jjmm(lu.date))}`}</b><small>${e.statut === 'validee' ? 'une écriture validée ne se modifie pas : elle se contre-passe' : 'rien n\'est encore validé : elle se corrige'}</small></span></li>`}</ul>
      ${bloque ? `<p class="sx-refus" role="status">${esc(bloque)}</p>` : ''}
      ${demDate ? `<p class="sx-attend" id="sx-date-demandee" role="status">${CL_IC.ok}<span><b>Demandée à ${esc(qui)} le ${esc(jjmm(KC.jourDeLInstant(demDate.demandeeLe)))}</b> : elle corrige la date dans SkanFact, l'écriture suit. ${esc(e.piece || 'L\'écriture')} reste au brouillard d'ici là.</span></p>` : ''}
      <div class="sx-gestes">${enSaisie ? `<span class="fd-qui" id="sx-qui-verifie">${esc(rev)} ${client ? `la demande à ${esc(qui)}` : 'la déplace'}</span>` : `${client ? (dossier.manual ? '' : demDate ? `<button type="button" class="btn" id="sx-demander-date">Relancer ${esc(qui)}</button>` : `<button type="button" class="btn btn-primary" id="sx-demander-date">Demander à ${esc(qui)} de la dater du ${esc(jjmm(lu.date))} <kbd>↵</kbd></button>`)
        : `<button type="button" class="btn btn-primary" id="sx-deplacer"${bloque ? ' disabled' : ''}>Déplacer en ${esc(moisLong(mP))}${bloque ? '' : ' <kbd>↵</kbd>'}</button>`}<button type="button" class="btn" id="sx-verifiee" title="La date de l'écriture est la bonne : la pièce est vérifiée">Laisser en ${esc(moisLong(mE))}</button>`}</div>
      ${enSaisie || demDate ? '' : `<p class="sx-touches">${SX_IC.clavier}<span><kbd>↵</kbd> ${client ? `demande la date à ${esc(qui)} et ouvre la pièce suivante` : `déplace et ouvre la pièce suivante${esc(suivanteSx(x))}`} · <kbd>Alt</kbd>+<kbd>→</kbd> la passe${client || declE ? '' : ` · la déclaration ${esc(deMois(mE))} se recalcule seule`}</span></p>`}</div>`;
  }

  function ficheDoubleSx(dossier, x) {
    const P = sxState.dernier || { items: [] };
    const j = (P.items || []).find(y => y.k === x.jumelle);
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(fichierSx(x).nom)}</b><small>${esc(deQuiSx(dossier, x))}</small></div><span class="cl-st ambre">en double ?</span></div>
      <div class="bandeau ambre sx-band">${EC_IC.alerte}<span class="txt"><b>La même que ${esc(j ? j.titre : 'une autre pièce')}${j && j.num ? ` (${esc(j.num)})` : ''} ?</b><span>${x.doubleProbable === 'fichier' ? 'Le même fichier, de la même taille.' : 'La même lecture : le fournisseur, le numéro et le total.'} En double, elle sort du compte et reste dans l'historique.</span></span></div>
      <div class="sx-gestes"><button type="button" class="btn btn-primary" id="sx-double">Marquer en double <kbd>↵</kbd></button><button type="button" class="btn" id="sx-pas-double">Ce n'est pas la même : la saisir</button></div></div>`;
  }

  // (1.211.0, A2) La photo illisible : elle reste dans la bande (le mois n'est pas complet sans elle), redemandée ou à
  // redemander au client. Rien ne se saisit d'une pièce qu'on ne lit pas.
  function ficheIllisibleSx(dossier, x) {
    const qui = prenomCl(dossier.contact) || 'le client', redem = x.p && x.p.note;
    const enSaisie = monRole() === 'saisie';
    return `<div class="sx-fi" id="sx-fiche"><div class="sx-fi-t"><div><b>${esc(fichierSx(x).nom)}</b><small>${esc(deQuiSx(dossier, x))}</small></div><span class="cl-st rouge">illisible</span></div>
      <div class="bandeau rouge sx-band">${EC_IC.alerte}<span class="txt"><b>${redem ? `Redemandée à ${esc(cap(qui))}` : 'Illisible : à redemander'}</b><span>${esc(cap(x.em || 'marquée illisible'))}. Rien ne s'en saisit : la nouvelle photo arrive dans cette bande, à sa place.</span></span></div>
      <div class="sx-gestes">${enSaisie ? `<span class="fd-qui">${esc(cap(reviseurCl(dossier)))} relance ${esc(qui)}</span>` : (redem ? `<button type="button" class="btn" id="sx-relancer">Relancer ${esc(qui)}</button>` : `<button type="button" class="btn btn-primary" id="sx-relancer">Relancer ${esc(qui)} <kbd>↵</kbd></button>`)}<button type="button" class="btn" id="sx-lisible">Elle se lit : la saisir</button></div>
      <p class="sx-touches">${SX_IC.clavier}<span>${enSaisie || redem ? '' : `<kbd>↵</kbd> redemande la photo · `}<kbd>Alt</kbd>+<kbd>→</kbd> passe à la pièce suivante${esc(suivanteSx(x))}</span></p></div>`;
  }
  // (1.220.0, épreuve d'un mois) La date d'un achat du client demandée et pas encore reçue : la demande ouverte de la
  // conversation qui la nomme (« la bonne date de FA-0914 … »). Tant qu'elle court, la pièce le dit, ne la redemande pas
  // d'un Entrée, et la validation du mois la laisse au brouillard (validée, elle ne changerait plus de mois).
  const dateDemandeeSx = (dossier, e) => (e && e.piece ? ((piecesLues.demandes || []).find(d => d.entreprise === dossier.id && !d.recueLe && String(d.texte || '').includes(`bonne date de ${e.piece}`)) || null) : null);
  const moisAvantSx = m => { const [a, n] = m.split('-').map(Number); return n === 1 ? `${a - 1}-12` : `${a}-${String(n - 1).padStart(2, '0')}`; };
  function zoneSx(dossier, P) {
    if (!P.pret) return '<div class="sx-attente mu">Lecture des pièces du mois…</div>';
    const m = moisSx();
    if (!P.liste.length) {
      const qui = prenomCl(dossier.contact);
      const br = ecrituresSx().filter(e => e.statut === 'brouillard' && (!m || String(e.date).slice(0, 7) === m)).length;
      // (1.221.0, l'épreuve d'un mois) Le mois FINI n'est pas un mois vide : ses pièces sont traitées et rien n'attend au
      // brouillard. Il le dit, et le geste suivant est la déclaration (« Demander les pièces de septembre » à Sarra, qui
      // venait de tout envoyer, se lisait comme un reproche).
      const traiteesM = m ? (P.items || []).filter(y => (y.p || y.doc) && y.mois === m && y.etat[2] === 'ordre' && y.etat[1] !== 'en double').length : 0;
      const valideesM = m ? ecrituresSx().filter(e => e.statut !== 'brouillard' && String(e.date).slice(0, 7) === m).length : 0;
      if (m && !br && traiteesM) {
        // Un mois d'avant pas encore déposé (août en retard) se déclare d'abord : la TVA d'un mois reprend le reste du
        // précédent (le 4367 ne se solde pas sinon).
        const avant = moisDeLaFrise(dossier).find(x => x.m < m && x.m.slice(0, 4) === m.slice(0, 4) && /retard|à déposer/.test(x.dit));
        const cible = avant ? avant.m : m;
        return `<div class="sx-fini" id="sx-mois-fini"><span class="sx-vide-ic">${CL_IC.ok}</span><span class="txt"><b>${esc(cap(moisLong(m)))} : tout est saisi</b>
          <span>${esc(pl(traiteesM, 'pièce traitée', 'pièces traitées'))}${valideesM ? ` · ${esc(pl(valideesM, 'écriture validée', 'écritures validées'))}` : ''} · rien n'attend au brouillard.${avant ? ` ${esc(cap(moisLong(avant.m)))} n'est pas encore déposé : il se déclare d'abord.` : ''}</span></span>
          <span class="cp-gestes"><button type="button" class="btn btn-primary" id="sx-vers-declaration" data-mois="${esc(cible)}">Déclarer ${esc(moisLong(cible))}${avant ? ' d\'abord' : ''} <kbd>↵</kbd></button></span></div>`;
      }
      // (1.217.0, maquette « savide ») Le mois vide : une carte au milieu de la page qu'il deviendra (grisée), le geste qui
      // la remplit (demander les pièces), et la grille derrière « Une écriture à la main ».
      if (videCacheSx(P)) {
        const av = moisAvantSx(m), faites = (P.items || []).filter(y => (y.p || y.doc) && y.mois === av && y.etat[2] === 'ordre' && y.etat[1] !== 'en double').length;
        const brAv = ecrituresSx().filter(e => e.statut === 'brouillard' && String(e.date).slice(0, 7) === av).length;
        const b2 = n => `<span class="apx-b" style="width:${n}%"></span>`;
        return `<div class="bq-ecran sx-vide-p"><div class="apx"><div class="apx-f" aria-hidden="true"><div class="apx-pills">${'<span class="apx-b"></span>'.repeat(6)}</div>
          <div class="apx-2"><div class="apx-r apx-cad">${b2(30)}${[82, 64, 90, 58, 76, 70].map(b2).join('')}</div><div class="apx-r apx-cad">${[1, 2, 3, 4, 5].map(() => '<span class="apx-b" style="height:28px"></span>').join('')}</div></div></div>
          <div class="apx-c" id="sx-vide"><span class="apx-ic">${CL_IC.ok}</span><b>${esc(cap(moisLong(m)))} : aucune pièce à saisir pour l'instant</b>
            <p>${dossier.manual ? 'Ce dossier est tenu au cabinet : ses pièces se déposent dans son classeur, puis s\'ouvrent ici, en grand, face à leur fiche.' : `Quand ${esc(qui || 'le client')} photographie une facture ou un ticket dans SkanFact, la pièce arrive ici, en grand, face à sa fiche déjà remplie. Ses ventes et sa caisse arrivent seules au livre.`}${br ? ` ${esc(pl(br, 'écriture attend', 'écritures attendent'))} au brouillard.` : ''}</p>
            ${dossier.manual ? '' : `<div class="cp-gestes"><button type="button" class="btn btn-primary" id="sx-demander-mois">Demander les pièces ${esc(deMois(m))}${qui ? ` à ${esc(qui)}` : ''}</button></div>`}
            <div class="cp-gestes"><button type="button" class="btn${dossier.manual ? ' btn-primary' : ''}" id="sx-vide-main">Une écriture à la main</button><button type="button" class="btn" id="sx-vide-km">Au kilomètre</button></div>
            ${faites || brAv ? `<span class="apx-mini" id="sx-vide-av">${esc(cap(moisLong(av)))} : ${esc(pl(faites, 'pièce saisie', 'pièces saisies'))}${brAv ? ` · ${esc(pl(brAv, 'écriture attend', 'écritures attendent'))} au brouillard` : ''}</span>` : ''}</div></div></div>`;
      }
      return `<div class="sx-vide" id="sx-vide"><span class="sx-vide-ic">${CL_IC.ok}</span><span class="txt"><b>${m ? `${esc(cap(moisLong(m)))} : aucune pièce à saisir pour l'instant` : `Aucune pièce à saisir en ${esc(livresState.annee)} pour l'instant`}</b>
        <span>${dossier.manual ? 'Ce dossier est tenu au cabinet : ses pièces se déposent dans son classeur, puis s\'ouvrent ici, face à leur fiche.' : `Quand ${esc(qui || 'le client')} envoie une facture ou un ticket, la pièce arrive ici, en grand, face à sa fiche déjà remplie.`}${br ? ` ${esc(pl(br, 'écriture attend', 'écritures attendent'))} au brouillard.` : ''}</span>
        ${m ? (() => { const av = moisAvantSx(m), faites = (P.items || []).filter(y => (y.p || y.doc) && y.mois === av && y.etat[2] === 'ordre' && y.etat[1] !== 'en double').length, brAv = ecrituresSx().filter(e => e.statut === 'brouillard' && String(e.date).slice(0, 7) === av).length;
          return `<small class="sx-vide-av" id="sx-vide-av">${faites || brAv ? `${esc(cap(moisLong(av)))} : ${esc(pl(faites, 'pièce traitée', 'pièces traitées'))}${brAv ? ` · ${esc(pl(brAv, 'écriture attend', 'écritures attendent'))} au brouillard` : ''}. ` : ''}${dossier.manual ? '' : 'Ses ventes et sa caisse, saisies dans SkanFact, arrivent seules au livre.'}</small>`; })() : ''}</span>
        ${dossier.manual || !m ? '' : `<button type="button" class="btn btn-sm" id="sx-demander-mois">Demander les pièces ${esc(deMois(m))}${qui ? ` à ${esc(qui)}` : ''}</button>`}</div>`;
    }
    if (!P.liste.some(x => x.k === sxState.sel)) sxState.sel = P.liste[0].k;
    const x = P.liste.find(y => y.k === sxState.sel);
    if (sxState.mode === 'km') return barreSx(P, dossier) + (moisSx() && !(saisieState.piece && saisieState.piece.depuisClasseur) ? (grilleCacheeSx(P)
      ? `<div class="sx-jm-g">${journalMoisSx(dossier, P)}<aside class="sx-km-d" id="sx-km-d">${cotePieceSx(dossier, P)}</aside></div>` : journalMoisSx(dossier, P)) : '');
    const fiche = x.sx.k === 'deja' ? ficheDejaSx(dossier, x) : x.sx.k === 'verifier' || x.sx.k === 'confiance' ? ficheVerifierSx(dossier, x)
      : x.sx.k === 'mois' ? ficheMoisSx(dossier, x) : x.sx.k === 'double' ? ficheDoubleSx(dossier, x) : x.sx.k === 'illisible' ? ficheIllisibleSx(dossier, x) : ficheSaisirSx(dossier, x);
    // (1.220.0, épreuve d'un mois) Tout ce qui reste attend le client (une date demandée, une photo redemandée) : rien
    // d'autre à faire ici, et l'étape suivante se propose (la Banque), au lieu de présenter ces pièces comme du travail.
    const attendClient = y => (y.sx.k === 'illisible' && y.p && y.p.note) || (y.sx.k === 'mois' && dateDemandeeSx(dossier, y.sx.e));
    const tousAttendent = P.liste.length && P.liste.every(attendClient) && !(dossier.manual);
    const fini = tousAttendent ? `<div class="sx-fini" id="sx-fini" role="status">${CL_IC.ok}<span><b>${esc(cap(moisLong(m || '')))}${m ? ' : ' : ''}rien d'autre à saisir pour l'instant</b><small>${esc(pl(P.liste.length, 'pièce attend', 'pièces attendent'))} ${esc(prenomCl(dossier.contact) || 'le client')} : ${esc(P.liste.map(y => y.sx.k === 'mois' ? `la date de ${y.sx.e.piece || 'son achat'}` : `une photo lisible de ${fichierSx(y).nom}`).join(', '))}. Elles reviendront ici dès sa réponse.</small></span><button type="button" class="btn btn-primary" id="sx-vers-banque">Passer à la Banque <kbd>↵</kbd></button></div>` : '';
    return `${barreSx(P, dossier)}${fini}<div class="sx-face">${visionneuseSx(dossier, x)}${fiche}</div>`;
  }
  // (1.213.0, S9) « Au kilomètre », le journal du mois : les achats du mois, une pièce par ligne (jour, pièce, compte du
  // fournisseur, libellé, TTC), sa charge et sa TVA dessous en gris, le justificatif de chaque ligne ; puis la ligne en
  // cours : le fournisseur et le TTC suffisent, la charge et la TVA se proposent d'après sa dernière pièce et la pièce se
  // solde seule. Un fournisseur sans pièce d'avant s'ouvre dans la grille (rien ne s'invente). La grille reste dessous.
  const jmSx = () => (sxState.jm = sxState.jm || { jour: '', four: '', ttc: '', piece: '' });
  function propositionJmSx(m) {
    const L = jmSx(), j = journalAchatsSx();
    const four = String(L.four || '').trim(), h = habitudesSx(four);
    const jour = /^\d{1,2}$/.test(String(L.jour).trim()) ? String(L.jour).trim().padStart(2, '0') : '';
    const date = jour ? `${m}-${jour}` : '';
    const f = { four, date, ttc: L.ttc, tva: h.n && h.taux !== 'mixte' ? h.taux : '', tvaAutre: '', compte: h.n ? h.compte : '', c40: (h.n && h.c40) || '401', journal: j, piece: L.piece || numeroSuivantSx(j), numero: '', devise: '' };
    const E = ecritureSx(f);
    const dateOk = date && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
    const refus = !four ? 'Le fournisseur manque.' : !h.n ? `${four} n'a pas de pièce d'avant : rien ne se propose. « Ouvrir en lignes » la saisit dans la grille.` : !dateOk ? `Le jour manque : 1 à ${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()}.` : E.refus ? E.refus[1] : '';
    return { f, E, h, refus, nouveau: four && !h.n };
  }
  // (1.215.0, la maquette) Sur un mois, « Au kilomètre » montre le journal du mois et la pièce à côté ; la grille au clavier
  // reste derrière « Une écriture à la main » (plusieurs charges, un autre journal), ou s'ouvre quand une écriture y est commencée.
  // (1.217.0) Le mois vide cache la grille tant qu'on n'a pas choisi « Une écriture à la main » ou « Au kilomètre » pour CE mois.
  const videCacheSx = P => !!moisSx() && !!(P && P.pret && !P.liste.length) && sxState.mainVide !== moisSx()
    && !pieceEnCours(saisieState.piece) && !(saisieState.piece && saisieState.piece.depuisClasseur);
  const grilleCacheeSx = P => sxState.mode === 'km' && !!moisSx() && !!(P && P.pret && P.liste.length) && !sxState.grille
    && !pieceEnCours(saisieState.piece) && !(saisieState.piece && saisieState.piece.depuisClasseur);
  function journalMoisSx(dossier, P) {
    const m = moisSx(), j = journalAchatsSx(), L = jmSx();
    const plan = ((livresState.livre || {}).plan || []);
    const nomC = c => ((plan.find(y => y.compte === String(c)) || {}).libelle) || KC.libelleDuPlan(String(c || '')) || '';
    const es = ecrituresSx().filter(e => e.journal === j && String(e.date).slice(0, 7) === m)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.piece || '').localeCompare(String(b.piece || '')));
    const sansJ = new Set((P.items || []).filter(x => x.sorte === 'ecr' && x.etat[1] === 'sans justificatif').map(x => x.e && x.e.id));
    const avecJ = new Set((P.items || []).filter(x => (x.p || x.doc) && x.numE).map(x => x.numE));
    let deb = 0, cre = 0;
    const cTva = tvaCompteSx().slice(0, 4);
    const lignes = es.map(e => {
      (e.lignes || []).forEach(l => { deb += mtSx(l.debit); cre += mtSx(l.credit); });
      const l40 = ligne40Sx(e) || {}, tx = tauxDeSx(e);
      const just = sansJ.has(e.id) ? `<span class="sx-jm-sj" role="img" title="Sans justificatif : sa pièce l'attend « Face à la pièce »" aria-label="Sans justificatif">${EC_IC.alerte}</span>` : avecJ.has(e.id) || e.justifClient === true ? `<span class="sx-jm-j" role="img" title="Justificatif joint" aria-label="Justificatif joint">${svgBq(BQ_IC.doc, 15)}</span>` : '';
      // La pièce sur sa ligne (le fournisseur au crédit), puis chaque charge et la TVA dessous, au débit : comme le journal.
      const dessous = (e.lignes || []).filter(l => l !== l40 && mtSx(l.debit) > 0).map(l => {
        const estTva = String(l.compte).startsWith(cTva);
        return `<tr class="sx-jm-s"><td></td><td></td><td class="mono">${esc(l.compte || '')}</td><td>${esc(estTva ? (tx === 'mixte' ? l.libelle || 'TVA déductible' : `TVA déductible${tx !== 'sans' ? ` ${String(tx).replace('.', ',')} %` : ''}`) : (nomC(l.compte) || l.libelle || ''))}</td><td class="r">${esc(dtSx(mtSx(l.debit)))}</td><td></td><td></td></tr>`;
      }).join('');
      return `<tr class="sx-jm-e"><td>${esc(String(e.date).slice(8, 10))}</td><td class="mono">${esc(e.piece || '—')}</td><td class="mono">${esc(l40.compte || '')}</td><td>${esc(nomTiersSx(e) || e.libelle || '')}</td><td></td><td class="r">${esc(dtSx(mtSx(l40.credit) || ttcSx(e)))}</td><td>${just}</td></tr>${dessous}`;
    }).join('');
    const pr = propositionJmSx(m);
    const fours = [...new Set(ecrituresSx().filter(achatSx).map(nomTiersSx).filter(Boolean))];
    const prop = pr.h.n && pr.E.ttc > 0 ? `${esc(pr.f.compte)} ${esc(nomC(pr.f.compte))} ${esc(dtSx(pr.E.ht))}${pr.E.tva ? ` · TVA ${esc(String(pr.E.taux).replace('.', ','))} % ${esc(dtSx(pr.E.tva))}` : ' · sans TVA'} · ${esc(pr.f.c40)} ${esc(dtSx(pr.E.ttc))} <span class="sx-src hab">${SX_IC.rel} ${esc(commeSx(pr.h, pr.h.tousCompte && pr.h.tousTaux, 'pièce', 'pièces', true))}</span>`
      : pr.h.n ? `<span class="mu">la charge ${esc(pr.h.compte)} ${esc(nomC(pr.h.compte))} et ${pr.h.taux === 'sans' ? 'sans TVA' : pr.h.taux === 'mixte' ? 'la TVA (à choisir : sa dernière pièce a plusieurs taux)' : `la TVA à ${esc(String(pr.h.taux).replace('.', ','))} %`} se proposent : le TTC suffit</span>` : '';
    const equi = deb === cre;
    return `<section class="sx-jm" id="sx-jm" aria-label="Le journal du mois">
      <div class="sx-jm-t"><label class="sx-jm-sel">${svgBq(BQ_IC.chev, 12)}<select id="sx-jm-journal" aria-label="Le journal"><option value="${esc(j)}">${esc(j)} · Achats</option></select></label><label class="sx-jm-sel">${svgBq(BQ_IC.chev, 12)}<select id="sx-jm-mois" aria-label="Le mois">${MOIS_CD.map((n, i) => { const v = `${livresState.annee}-${String(i + 1).padStart(2, '0')}`; return `<option value="${v}"${v === m ? ' selected' : ''}>${esc(cap(moisLong(v)))} ${esc(String(livresState.annee))}</option>`; }).join('')}</select></label><span class="mu sx-jm-aide">Le compte du fournisseur et le TTC suffisent : la charge et la TVA se proposent d'après ses pièces d'avant, la pièce se solde seule.</span></div>
      <div class="scroll-x"><table class="sx-t sx-jm-l"><thead><tr><th>Jour</th><th>Pièce</th><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th><th></th></tr></thead>
        <tbody>${lignes || `<tr><td colspan="7" class="mu">Aucun achat ${esc(deMois(m))} au journal ${esc(j)} pour l'instant.</td></tr>`}
        <tr class="sx-jm-n"><td><input id="sx-jm-jour" class="sx-in" inputmode="numeric" maxlength="2" autocomplete="off" value="${esc(L.jour)}" placeholder="jj" aria-label="Le jour"></td>
          <td><input id="sx-jm-piece" class="sx-in mono" autocomplete="off" value="${esc(L.piece || numeroSuivantSx(j))}" aria-label="La pièce"></td>
          <td class="mono" id="sx-jm-c40">${esc(pr.f.c40)}</td>
          <td><input id="sx-jm-four" class="sx-in" list="sx-jm-fours" autocomplete="off" value="${esc(L.four)}" placeholder="Le fournisseur" aria-label="Le fournisseur"><datalist id="sx-jm-fours">${fours.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist></td>
          <td></td><td><input id="sx-jm-ttc" class="sx-in mono r" inputmode="decimal" autocomplete="off" value="${esc(L.ttc)}" placeholder="TTC" aria-label="Le total TTC"></td>
          <td>${pr.nouveau ? '<button type="button" class="btn btn-sm" id="sx-jm-lignes">Ouvrir en lignes</button>' : ''}</td></tr>
        <tr class="sx-jm-p"><td colspan="7" id="sx-jm-prop">${prop}</td></tr>
        <tr class="sx-jm-tot"><td colspan="4"><span id="sx-jm-bilan">${esc(pl(es.length, 'pièce'))} · ${equi ? `débit = crédit ${CL_IC.ok}` : `débit ${esc(dtSx(deb))} ≠ crédit ${esc(dtSx(cre))}`}</span></td><td class="r">${esc(dtSx(deb))}</td><td class="r">${esc(dtSx(cre))}</td><td></td></tr></tbody></table></div>
      <p class="sx-refus${sxState.jmTente ? '' : ' reste'}" id="sx-jm-refus" role="status"${pr.refus && (L.four || L.ttc || sxState.jmTente) ? '' : ' hidden'}>${esc(pr.refus)}</p>
      <div class="sx-jm-pied">${sxState.grille ? '' : '<button type="button" class="cp-plus" id="sx-jm-main">Une écriture à la main…</button>'}
        <p class="sx-touches">${SX_IC.clavier}<span><kbd>Tab</kbd> champ suivant · <kbd>↵</kbd> enregistre la pièce au brouillard et passe à la suivante · les pièces se rangent par date · plusieurs charges : « Ouvrir en lignes » ou « Une écriture à la main », la grille au clavier</span></p></div></section>`;
  }
  async function enregistrerJmSx(root, dossier) {
    const m = moisSx(), pr = propositionJmSx(m);
    sxState.jmTente = true;
    if (pr.nouveau) { jmEnLignesSx(root, dossier); return; }
    if (pr.refus) {
      const r = $('#sx-jm-refus'); if (r) { r.hidden = false; r.classList.remove('reste'); r.textContent = pr.refus; }
      const champ = !pr.f.four ? '#sx-jm-four' : !pr.f.date ? '#sx-jm-jour' : '#sx-jm-ttc';
      const c = $(champ); if (c) { c.focus(); c.setAttribute('aria-invalid', 'true'); }
      return;
    }
    const s = livresState;
    try {
      const res = await api.saisir(dossier.id, s.annee, { date: pr.f.date, journal: pr.f.journal, piece: String(pr.f.piece || '').trim(), libelle: pr.E.lib, source: 'saisie', pieceJointe: null, lignes: versLeLivreSx(pr.E.lignes) });
      s.livre = res.livre;
      toast(`${pr.f.four} · ${dtSx(pr.E.ttc)} DT : au brouillard${res.attente ? ' (gardée sur ce poste, elle partira au retour du réseau)' : ''}.`);
      sxState.jm = { jour: jmSx().jour, four: '', ttc: '', piece: '' };
      sxState.jmTente = false;
      drawLivres(root, dossier);
      const c = $('#sx-jm-four'); if (c) c.focus();
    } catch (err) { await infoDialog('Enregistrement impossible', plainError(err)); }
  }
  // Un fournisseur sans pièce d'avant : la grille reçoit le fournisseur et son TTC, la charge se choisit à la main.
  function jmEnLignesSx(root, dossier) {
    const m = moisSx(), pr = propositionJmSx(m), ttc = pr.E.ttc;
    if (pieceEnCours(saisieState.piece)) { toast('Une écriture est déjà commencée dans la grille : elle t\'attend dessous.'); return; }
    saisieState.dossierId = dossier.id;
    saisieState.piece = { ...pieceVide(pr.f.journal, pr.f.date || `${m}-01`), piece: pr.f.piece, libelle: pr.f.four, touchee: true,
      lignes: [{ compte: '', libelle: pr.f.four, debit: ttc ? montantChamp(ttc / 1000) : '', credit: '' }, { compte: pr.f.c40, libelle: pr.f.four, debit: '', credit: ttc ? montantChamp(ttc / 1000) : '', tiers: pr.f.four, tiersId: null, lettre: '' }, ligneVide()] };
    sxState.jm = { jour: jmSx().jour, four: '', ttc: '', piece: '' };
    sxState.grille = true;
    drawLivres(root, dossier);
    const c = $('#sa-lignes input'); if (c) c.focus();
  }
  // « Au kilomètre » : la pièce choisie à côté de la grille, et le geste qui la prend.
  // (1.215.0) Ce que l'IA a lu sur la pièce de l'écriture en cours passe dans la grille : le libellé (fournisseur et
  // numéro), la pièce, la date, et le total au crédit du fournisseur quand il est en dinars. Rien ne s'enregistre.
  function remplirGrilleSx(dossier) {
    const P = piecesSx(dossier), dc = (saisieState.piece || {}).depuisClasseur;
    const x = dc && P.liste.find(y => (y.p && dc.message === y.p.id) || (y.doc && dc.doc === y.doc.id));
    if (!x || !x.lu) return false;
    const lu = x.lu, p = saisieState.piece, tnd = !lu.devise || lu.devise === 'TND';
    if (lu.fournisseur) p.libelle = [lu.fournisseur, lu.numero].filter(Boolean).join(' · ');
    if (lu.numero) p.piece = lu.numero;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(lu.date || ''))) p.date = lu.date;
    if (lu.total && tnd) {
      const t = montantChamp(Number(lu.total));
      const l40 = p.lignes.find(l => /^40/.test(String(l.compte))) || p.lignes.find(l => !l.compte && !l.debit && !l.credit);
      if (l40) { if (!l40.compte) l40.compte = '401'; l40.credit = t; l40.debit = ''; if (lu.fournisseur && !l40.libelle) l40.libelle = lu.fournisseur; }
    }
    p.touchee = true;
    return true;
  }
  function cotePieceSx(dossier, P) {
    if (!P.pret || !P.liste.length) return '';
    const x = P.liste.find(y => y.k === sxState.sel) || P.liste[0];
    const p = saisieState.piece || {};
    const dc = p.depuisClasseur;
    const prise = dc && ((x.p && dc.message === x.p.id) || (x.doc && dc.doc === x.doc.id));
    const autres = P.liste.filter(y => y.sx.k === 'deja');
    return `<span class="mu">${prise ? 'La pièce de l\'écriture en cours' : 'La pièce à côté'}</span>${visionneuseSx(dossier, x, true)}
      ${prise ? `${!x.lu ? lireSx(dossier, x).replace('id="sx-lire"', 'id="sx-lire-g"') : `<p class="sx-aide" id="sx-lu-g">Lue : ${esc([x.lu.fournisseur, x.lu.numero, x.lu.date ? jjmmaaCl(x.lu.date) : '', x.lu.total ? `${String(x.lu.total).replace('.', ',')} ${!x.lu.devise || x.lu.devise === 'TND' ? 'DT' : x.lu.devise}` : ''].filter(Boolean).join(' · '))}. <button type="button" class="cp-plus" id="sx-lu-remplir">La reporter dans la grille</button></p>`}<p class="sx-aide">Enregistrée, l'écriture la prend pour justificatif.</p>` : x.sx.k === 'saisir' || x.sx.k === 'devise' ? '<button type="button" class="btn btn-sm" id="sx-km-prendre">La saisir dans la grille</button>' : `<p class="sx-aide">${esc(cap(x.sx.mot))} : elle se traite « Face à la pièce ».</p>`}
      ${P.liste.length > 1 ? `<span class="sx-km-nav"><button type="button" class="btn btn-sm sx-fl" id="sx-prec" aria-label="Pièce d'avant">${PC_IC.g}</button><span class="mu">${P.liste.indexOf(x) + 1} sur ${P.liste.length}</span><button type="button" class="btn btn-sm sx-fl" id="sx-suiv" aria-label="Pièce suivante">${PC_IC.d}</button></span>` : ''}
      ${autres.length ? `<p class="sx-aide">${esc(autres.map(y => y.sx.e.piece).filter(Boolean).join(', '))} ${autres.length > 1 ? 'n\'ont' : 'n\'a'} pas de justificatif ${EC_IC.alerte} : ${autres.length > 1 ? 'leurs pièces les attendent' : 'sa pièce l\'attend'} dans « Face à la pièce ».</p>` : ''}`;
  }

  // ---------- la pièce dans la visionneuse ----------
  async function chargerPapierSx(dossier, x, zone) {
    if (zone && estXmlSx(x)) { lireEfactureCl(dossier, x); zone.innerHTML = feuilleEfactureCl(x); return; }
    if (!zone || navigator.onLine === false) { if (zone) zone.innerHTML = '<span class="mu">Sans réseau, la pièce ne s\'ouvre pas : elle est gardée sur le serveur.</span>'; return; }
    const petit = !!zone.closest('.petit');
    const largeur = Math.round(Math.min(petit ? 230 : 430, Math.max(180, zone.clientWidth - 40)) * (petit ? 1 : sxState.zoom));
    let f;
    try { f = await contenuSx(dossier, x); } catch { if (zone.isConnected) zone.innerHTML = '<span class="mu">La pièce ne s\'est pas chargée : elle se rouvre en revenant dessus.</span>'; return; }
    try {
      let adresse = f.adresse;
      if (/pdf/.test(f.type)) { const img = await api.pieces.apercuPdf(f.blob, Math.max(900, largeur * 2), 1); if (!img) throw new Error('pdf'); adresse = img.adresse; }
      else if (!/^image\//.test(f.type)) throw new Error('type');
      if (!zone.isConnected || zone.dataset.k !== x.k) return;
      zone.innerHTML = `<img src="${adresse}" alt="${esc(fichierSx(x).nom)}" style="width:${largeur}px;transform:rotate(${petit ? 0 : sxState.rot}deg)">`;
    } catch { if (zone.isConnected) zone.innerHTML = '<span class="mu">Ce fichier ne se dessine pas ici : « En grand » l\'ouvre tel qu\'il est arrivé.</span>'; }
  }
  async function enGrandSx(dossier, x) {
    if (estXmlSx(x)) return feuilleEnGrandCl(x, dossier.name);
    if (x.p) { pieceState.rot = sxState.rot; return pieceEnGrand({ ...x.p, entreprise: dossier.id }); }
    const f = await contenuSx(dossier, x).catch(err => { toast(plainError(err), 'error'); return null; });
    if (!f) return;
    const calque = document.createElement('div');
    calque.className = 'pc-grand'; calque.setAttribute('role', 'dialog'); calque.setAttribute('aria-label', fichierSx(x).nom);
    calque.innerHTML = `<div class="pc-grand-t"><b>${esc(fichierSx(x).nom)}</b><span>${esc(dossier.name)}</span><span class="pc-sep"></span><button type="button" class="btn btn-sm" id="pcg-fermer">${PC_IC.fermer} Fermer</button></div><div class="pc-grand-d" id="pcg-d"><p style="color:#fff">Ouverture…</p></div>`;
    document.body.append(calque);
    const fermer = () => { calque.remove(); document.removeEventListener('keydown', echap, true); };
    const echap = e => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); } };
    document.addEventListener('keydown', echap, true);
    $('#pcg-fermer', calque).onclick = fermer; $('#pcg-fermer', calque).focus();
    const zone = $('#pcg-d', calque);
    if (!/pdf/.test(f.type)) { zone.innerHTML = `<img src="${f.adresse}" alt="${esc(fichierSx(x).nom)}">`; return; }
    const img = await api.pieces.apercuPdf(f.blob, 1600, 1);
    zone.innerHTML = img ? `<img src="${img.adresse}" alt="${esc(fichierSx(x).nom)}">` : '<p style="color:#fff">Ce PDF ne se dessine pas ici.</p>';
  }

  // ---------- les gestes ----------
  // Après un geste : le livre et les pièces se relisent, la pièce suivante s'ouvre.
  async function apresSx(root, dossier, x, quoi = {}) {
    const P = sxState.dernier || { liste: [] };
    const i = P.liste.findIndex(y => y.k === x.k);
    const suivante = P.liste[i + 1] || P.liste[i - 1] || null;
    sxState.sel = suivante ? suivante.k : '';
    sxState.fiches.delete(x.k); sxState.saisir.delete(x.k);
    clState.docs.delete(dossier.id); clState.livres.delete(`${dossier.id}:${livresState.annee}`); clState.just.clear();
    await Promise.all([relirePieces(), chargerClasseesCl(dossier, true), quoi.docs ? chargerDocsCl(dossier, true) : null]).catch(() => {});
    drawLivres(root, dossier);
  }
  const classerSx = (dossier, x, raison) => x.p ? api.pieces.classer(dossier.id, x.p.id, true, raison) : api.classeur.classer(dossier.id, x.doc.id, true, raison);
  const declasserSx = (dossier, x) => x.p ? api.pieces.classer(dossier.id, x.p.id, false) : api.classeur.classer(dossier.id, x.doc.id, false);
  const joindreSx = (dossier, x, idE) => x.p ? api.pieces.joindre(dossier.id, x.p.id, idE) : api.classeur.classer(dossier.id, x.doc.id, true, 'jointe', idE);

  async function enregistrerSx(root, dossier, x, valider) {
    const f = ficheSx(x), E = ecritureSx(f), el = $('#sx-fiche');
    if (E.refus) {
      const champ = { four: '#sx-four', date: '#sx-date', timbre: '#sx-timbre', ttc: f.devise ? '#sx-mdev' : '#sx-ttc', tva: f.tva === 'autre' ? '#sx-tva-autre' : '#sx-tva', compte: '#sx-compte', taux: '#sx-taux' }[E.refus[0]];
      sxState.tente.add(x.k);
      const r = $('#sx-refus'); if (r) { r.hidden = false; r.classList.remove('reste'); r.textContent = E.refus[1]; }
      const c = champ && $(champ); if (c) { c.focus(); c.classList.add('sx-ko'); c.setAttribute('aria-invalid', 'true'); }
      return;
    }
    const s = livresState;
    // (S4) Le même fournisseur, le même numéro : déjà au livre, on le dit avant d'écrire.
    const deux = f.numero && ecrituresSx().find(y => achatSx(y) && normSx(nomTiersSx(y)) === normSx(f.four) && `${y.libelle || ''} ${y.piece || ''}`.includes(f.numero));
    if (deux && !await confirmDialog('Déjà au livre ?', `<p>${esc(deux.piece || 'Une écriture')} du ${esc(fmtJourCourt(deux.date))} porte déjà le numéro <b>${esc(f.numero)}</b> de ${esc(f.four)}. L'écrire encore compterait la facture deux fois.</p>`, 'L\'écrire quand même')) return;
    const ok = el && $$('#sx-ok, #sx-ok-valider', el); if (ok) ok.forEach(b => { b.disabled = true; });
    const banque = !f.devise && !f.avoir && f.paye ? ligneBanqueSx(E.ttc, f.date) : null;
    try {
      const res = await api.saisir(dossier.id, s.annee, { date: f.date, journal: f.journal, piece: String(f.piece || '').trim(), libelle: E.lib, source: 'saisie', pieceJointe: null, lignes: versLeLivreSx(E.lignes) });
      s.livre = res.livre;
      if (f.devise && f.taux) prefs.set(`sxTaux:${f.devise}`, String(f.taux));
      if (res.attente) { toast(`Gardée sur ce poste, au brouillard${valider ? ' (elle se validera au retour, d\'ici)' : ''} : elle partira au retour du réseau. La pièce s'y joindra alors, depuis le classeur.`); drawLivres(root, dossier); return; }
      let dit = `${f.four} · ${dtSx(E.ttc)} DT : au brouillard`;
      const aValider = [res.id];
      try { await joindreSx(dossier, x, res.id); dit += ', la pièce jointe'; } catch (err) { dit += `, mais la pièce n'a pas pu s'y joindre (${plainError(err)})`; }
      if (banque) {
        try {
          const r2 = await api.saisir(dossier.id, s.annee, { date: banque.l.date, journal: journalBanqueSx(), piece: '', libelle: `Règlement ${f.four} · ${banque.l.libelle}`.slice(0, 120), source: 'saisie', pieceJointe: null,
            lignes: versLeLivreSx([{ compte: f.c40 || '401', libelle: `Règlement ${f.four}`, debit: E.ttc, credit: 0, tiers: f.four }, { compte: banque.R.compte || '532', libelle: banque.l.libelle, debit: 0, credit: E.ttc }]) });
          s.livre = r2.livre;
          aValider.push(r2.id);
          const x2 = await api.rapprocher({ dossierId: dossier.id, annee: s.annee, releveId: banque.R.id, ligneId: banque.l.id, choix: { ecritureId: r2.id, ligne: 1, niveau: 'certain', date: K.today() } });
          s.livre = x2.livre;
          dit += `, son règlement du ${jjmm(banque.l.date)} rapproché`;
        } catch (err) { dit += ` ; le règlement n'a pas pu s'écrire (${plainError(err)})`; }
      }
      // (1.211.0) « Enregistrer et valider » : la tenue et la direction valident du même geste (l'achat et son règlement) ; un
      // refus du serveur laisse l'écriture au brouillard et le dit, avec sa raison.
      if (valider) {
        try {
          for (const id of aValider) s.livre = (await api.valider(dossier.id, s.annee, id)).livre;
          dit = dit.replace(': au brouillard', ': validée');
        } catch (err) { dit += ` ; pas validée (${plainError(err)}) : elle t'attend au brouillard`; }
      }
      toast(`${dit}.`);
      await apresSx(root, dossier, x, { docs: !!x.doc });
    } catch (err) { if (ok) ok.forEach(b => { b.disabled = false; }); await infoDialog('Enregistrement impossible', plainError(err)); }
  }
  // « Ouvrir en lignes » : la grille reçoit l'écriture de la fiche, la pièce s'y joindra à l'enregistrement.
  function enLignesSx(root, dossier, x) {
    const f = ficheSx(x), E = ecritureSx(f);
    if (saisieState.dossierId === dossier.id && pieceEnCours(saisieState.piece)) { toast('Une écriture est déjà commencée dans la grille : elle t\'attend « Au kilomètre ».'); sxState.mode = 'km'; drawLivres(root, dossier); return; }
    saisieState.dossierId = dossier.id;
    saisieState.piece = { ...pieceVide(f.journal, /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : dateProposee(livresState.annee)), piece: f.piece, libelle: E.lib, touchee: true,
      lignes: E.lignes.filter(l => l.compte || l.debit || l.credit).map(l => ({ compte: l.compte, libelle: l.libelle, debit: l.debit ? montantChamp(l.debit / 1000) : '', credit: l.credit ? montantChamp(l.credit / 1000) : '', ...(l.tiers ? { tiers: l.tiers, tiersId: null, lettre: '' } : {}) })).concat([ligneVide()]),
      depuisClasseur: { nom: fichierSx(x).nom, ou: 'la Saisie, face à la pièce', ...(x.p ? { message: x.p.id } : { doc: x.doc.id }) } };
    sxState.mode = 'km';
    drawLivres(root, dossier);
  }
  async function deplacerSx(root, dossier, x) {
    const e = x.sx.e, lu = x.lu, s = livresState;
    const L = lireLivreFd(s.livre), declE = !!(L.decl[String(e.date).slice(0, 7)] && L.decl[String(e.date).slice(0, 7)].deposee);
    const lignes = (e.lignes || []).map(l => ({ compte: l.compte, libelle: l.libelle || '', debit: montantDe(l.debit), credit: montantDe(l.credit), ...(l.tiers ? { tiers: l.tiers, tiersId: l.tiersId || null, lettre: '' } : {}) }));
    try {
      if (e.statut === 'brouillard') {
        const r = await api.modifierEcriture(dossier.id, s.annee, e.id, { date: lu.date, journal: e.journal, piece: e.piece, libelle: e.libelle, source: e.source, pieceJointe: e.pieceJointe || null, lignes });
        s.livre = r.livre;
      } else {
        const r = await api.contrepasser(dossier.id, s.annee, e.id, declE ? lu.date : e.date);
        s.livre = r.livre;
        const r2 = await api.saisir(dossier.id, s.annee, { date: lu.date, journal: e.journal, piece: e.piece, libelle: `${e.libelle || ''} (au ${jjmm(lu.date)}, sa date)`.slice(0, 120), source: 'saisie', pieceJointe: e.pieceJointe || null, lignes });
        s.livre = r2.livre;
      }
      await classerSx(dossier, x, 'verifiee').catch(() => {});
      toast(`${e.piece || 'L\'écriture'} est au ${jjmm(lu.date)}${e.statut === 'brouillard' ? '' : ' (contre-passée, puis réécrite au brouillard)'} : la pièce est vérifiée.`);
      await apresSx(root, dossier, x);
    } catch (err) { await infoDialog('Déplacement impossible', plainError(err)); }
  }
  async function confianceSxPoser(root, dossier, nom, oui) {
    const avant = Array.isArray(dossier.sansVerifier) ? dossier.sansVerifier.slice() : [];
    const liste = oui ? [...avant.filter(n => normSx(n) !== normSx(nom)), nom] : avant.filter(n => normSx(n) !== normSx(nom));
    try {
      await api.sansVerifier(dossier.id, liste);
      dossier.sansVerifier = liste;
      const d2 = (S.dossiers || []).find(y => y.id === dossier.id); if (d2) d2.sansVerifier = liste;
      if (oui) toastUndo(`${nom} : ses factures ne se vérifient plus pièce par pièce. Elles restent dans la bande, « de confiance ».`, () => confianceSxPoser(root, dossier, nom, false));
      else toast(`${nom} : ses factures se vérifient à nouveau.`);
      drawLivres(root, dossier);
    } catch (err) { toast(plainError(err), 'error'); }
  }

  function brancherSx(el, root, dossier) {
    const zone = $('#sx-zone', el);
    if (!zone) return;
    const P = sxState.dernier || { liste: [] };
    const x = P.liste.find(y => y.k === sxState.sel);
    const aller = d => { const i = P.liste.findIndex(y => y.k === sxState.sel); const y = P.liste[i + d]; if (y) { sxState.sel = y.k; sxState.zoom = 1; sxState.rot = 0; redessinerSx(dossier, true); } };
    const on = (sel, f) => { $$(sel, el).forEach(b => { b.onclick = f; }); };
    on('#sx-prec', () => aller(-1));
    on('#sx-suiv', () => aller(1));
    $$('[data-sx-k]', el).forEach(b => { b.onclick = () => { sxState.sel = b.dataset.sxK; sxState.zoom = 1; sxState.rot = 0; redessinerSx(dossier, true); }; });
    $$('[data-sx-mode]', el).forEach(b => { b.onclick = () => {
      sxState.mode = b.dataset.sxMode;
      // (1.215.0, la maquette) « Au kilomètre » est le journal D'UN mois : sur « Toute l'année », il s'ouvre sur le mois de la
      // pièce en cours (celle de la bande). Rien ne change du reste de la Saisie tant qu'on n'a pas fait ce geste.
      if (sxState.mode === 'km' && !moisSx() && !pieceEnCours(saisieState.piece)) {
        const L = (sxState.dernier || { liste: [] }).liste || [];
        const y = L.find(z => z.k === sxState.sel) || L[0];
        if (y && y.mois) { livresState.mode = 'mois'; livresState.mois = y.mois; livresState.page = 1; }
      }
      // Au kilomètre sur un mois : la grille s'ouvre aux achats de ce mois (rien n'est écrasé de ce qu'on a commencé).
      const m = moisSx();
      if (sxState.mode === 'km' && m && !pieceEnCours(saisieState.piece) && !(saisieState.piece && saisieState.piece.depuisClasseur)) {
        const auj = K.today(), fin = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
        saisieState.dossierId = dossier.id;
        saisieState.piece = pieceVide(journalAchatsSx(), auj.slice(0, 7) === m ? auj : fin);
      }
      drawLivres(root, dossier);
    }; });
    { const vb = $('#sx-vers-banque', el); if (vb) { vb.onclick = () => allerSousOnglet(root, dossier, 'banque'); setTimeout(() => { try { vb.focus(); } catch { /* rien */ } }, 0); } }
    const ouvrirVide = km => { sxState.mainVide = moisSx(); if (km) sxState.mode = 'km'; drawLivres(root, dossier); const c = $('#sa-date'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } };
    for (const [id, km] of [['#sx-vide-main', false], ['#sx-vide-km', true]]) { const b = $(id, el); if (b) b.onclick = () => ouvrirVide(km); }
    const vd = $('#sx-vers-declaration', el);
    if (vd) { vd.onclick = () => { if (vd.dataset.mois) { declState.mois = vd.dataset.mois; if (vd.dataset.mois !== livresState.mois) { livresState.mois = vd.dataset.mois; livresState.mode = 'mois'; } } allerSousOnglet(root, dossier, 'declaration'); }; setTimeout(() => { try { vd.focus(); } catch { /* rien */ } }, 0); }
    const dm = $('#sx-demander-mois', el);
    if (dm) dm.onclick = () => fenDemanderCl(dossier, { titre: `Les pièces ${deMois(moisSx())}`, piece: `les pièces ${deMois(moisSx())} (factures d'achat, tickets, relevé)`, mois: moisSx() }, { hors: true });
    $$('#sx-papier', el).forEach(z => { const y = P.liste.find(w => w.k === z.dataset.k); if (y) chargerPapierSx(dossier, y, z); });
    $$('[data-sx-z]', el).forEach(b => { b.onclick = () => { sxState.zoom = Math.min(2, Math.max(0.5, sxState.zoom + Number(b.dataset.sxZ) * 0.25)); const z = $('#sx-zoom', el); if (z) z.textContent = `${Math.round(sxState.zoom * 100)} %`; if (x) chargerPapierSx(dossier, x, $('#sx-papier', zone)); }; });
    on('#sx-tourner', () => { sxState.rot = (sxState.rot + 90) % 360; const im = $('#sx-papier img', zone); if (im) im.style.transform = `rotate(${sxState.rot}deg)`; });
    on('#sx-grand', () => { if (x) enGrandSx(dossier, x); });
    on('#sx-conf-tout', async () => {
      const conf = P.liste.filter(y => y.sx.k === 'confiance');
      try { for (const y of conf) await classerSx(dossier, y, 'verifiee'); toast(`${pl(conf.length, 'pièce marquée vérifiée', 'pièces marquées vérifiées')}.`); } catch (err) { toast(plainError(err), 'error'); }
      await apresSx(root, dossier, conf[conf.length - 1] || { k: '' });
    });
    on('#sx-lire-g', () => { const P2 = piecesSx(dossier), dc = (saisieState.piece || {}).depuisClasseur, y = dc && P2.liste.find(z => (z.p && dc.message === z.p.id) || (z.doc && dc.doc === z.doc.id)); if (y) fenLireCl(dossier, y, () => { if (remplirGrilleSx(dossier)) toast('Ce que l\'IA a lu est dans la grille : vérifie-le sur la pièce.'); drawLivres(root, dossier); }); });
    on('#sx-lu-remplir', () => { if (remplirGrilleSx(dossier)) drawLivres(root, dossier); });
    on('#sx-km-prendre', () => { if (x) enLignesSx(root, dossier, x); });
    // (S9) La ligne en cours du journal du mois : chaque frappe met la proposition à jour ; Entrée enregistre.
    const jm = $('#sx-jm', el);
    if (jm) {
      const majJm = () => {
        const pr = propositionJmSx(moisSx()), z = $('#sx-jm', el); if (!z) return;
        const html = journalMoisSx(dossier, sxState.dernier || P);
        const tmp = document.createElement('div'); tmp.innerHTML = html;
        ['#sx-jm-prop', '#sx-jm-c40'].forEach(id => { const a = $(id, z), b = $(id, tmp); if (a && b) a.innerHTML = b.innerHTML; });
        const L = jmSx(), r = $('#sx-jm-refus', z); if (r) { r.hidden = !pr.refus || !(L.four || L.ttc || sxState.jmTente); r.textContent = pr.refus; }
        const cell = $('#sx-jm-lignes', z);
        if (pr.nouveau && !cell) { const td = $('#sx-jm-ttc', z).closest('tr').lastElementChild; td.innerHTML = '<button type="button" class="btn btn-sm" id="sx-jm-lignes">Ouvrir en lignes</button>'; $('#sx-jm-lignes', z).onclick = () => jmEnLignesSx(root, dossier); }
        else if (!pr.nouveau && cell) cell.remove();
      };
      [['#sx-jm-jour', 'jour'], ['#sx-jm-piece', 'piece'], ['#sx-jm-four', 'four'], ['#sx-jm-ttc', 'ttc']].forEach(([id, k]) => {
        const c = $(id, jm); if (!c) return;
        c.addEventListener('input', () => { jmSx()[k] = c.value; c.removeAttribute('aria-invalid'); majJm(); });
        c.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); enregistrerJmSx(root, dossier); } });
      });
      on('#sx-jm-lignes', () => jmEnLignesSx(root, dossier));
      on('#sx-jm-main', () => { sxState.grille = true; drawLivres(root, dossier); const c = $('#sa-date'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } });
      const jmM = $('#sx-jm-mois'); if (jmM) jmM.onchange = () => { livresState.mode = 'mois'; livresState.mois = jmM.value; livresState.page = 1; drawLivres(root, dossier); };
    }
    if (!x) return;
    // La fiche à saisir : chaque frappe change la fiche et l'écriture montrée, sans redessiner le champ sous le curseur.
    const f = (x.sx.k === 'saisir' || x.sx.k === 'devise') ? ficheSx(x) : null;
    const majEcriture = () => {
      const t = $('#sx-ec-l', zone); if (t) t.innerHTML = lignesEcritureSx(f, !f.devise && !f.avoir && f.paye ? ligneBanqueSx(ecritureSx(f).ttc, f.date) : null);
      const cv = $('#sx-cv', zone); if (cv) { const v = contreValeurSx(f); cv.textContent = v ? `${dtSx(v)} DT` : '—'; }
      const md = $('#sx-mdev-v', zone); if (md) md.textContent = montantDevSx(f);
      const r = $('#sx-refus', zone); if (r) { const E = ecritureSx(f); r.hidden = !E.refus; r.textContent = E.refus ? E.refus[1] : ''; }
    };
    if (f) {
      const champ = (id, k, lire) => { const c = $(id, zone); if (c) c.addEventListener('input', () => { f[k] = lire ? lire(c.value) : c.value; c.classList.remove('sx-ko'); c.removeAttribute('aria-invalid'); if (k === 'four' || k === 'ttc' || k === 'date' || k === 'timbre') { f[`${k}Src`] = ''; } majEcriture(); }); };
      champ('#sx-four', 'four'); champ('#sx-ttc', 'ttc'); champ('#sx-timbre', 'timbre'); champ('#sx-mdev', 'montantDev'); champ('#sx-taux', 'taux'); champ('#sx-tva-autre', 'tvaAutre'); champ('#sx-piece', 'piece');
      const dt = $('#sx-date', zone);
      if (dt) dt.addEventListener('input', () => { const iso = K.dateTapee(dt.value.trim(), livresState.annee); f.date = iso || ''; f.dateSrc = ''; dt.classList.remove('sx-ko'); majEcriture(); });
      // Un fournisseur choisi : ses habitudes remplissent ce qui est encore vide (jamais ce qu'on a tapé).
      const four = $('#sx-four', zone);
      // (1.215.0) Quitter le champ pour cliquer un bouton de la fiche (« Lire la pièce ») redessinait la fiche entre l'appui
      // et le relâché : le bouton remplacé, le clic se perdait. Le redessin attend la fin du clic.
      // (1.221.0, l'épreuve d'un mois) « Minoterie » puis Entrée gardait le mot tapé, un « nouveau fournisseur » à côté de
      // Minoterie du Cap Bon (la liste du navigateur ne se choisit qu'avec ↓) : le seul fournisseur connu qui commence par
      // ce qu'on a tapé, ou qui le contient, est celui qu'on voulait.
      if (four) four.addEventListener('change', () => {
        const t = normSx(f.four), connus = [...new Set(ecrituresSx().filter(achatSx).map(nomTiersSx).filter(Boolean))];
        if (t.length >= 3 && !connus.some(n => normSx(n) === t)) {
          const deb = connus.filter(n => normSx(n).startsWith(t)), dans = connus.filter(n => normSx(n).includes(t));
          const seul = deb.length === 1 ? deb[0] : !deb.length && dans.length === 1 ? dans[0] : '';
          if (seul) { f.four = seul; four.value = seul; }
        }
      });
      if (four) four.addEventListener('change', () => { const h = habitudesSx(f.four); if (h.n) { if (!f.compte) { f.compte = h.compte; f.compteSrc = 'hab'; } if (f.tva === '' && h.taux !== 'mixte') { f.tva = h.taux; f.tvaSrc = 'hab'; } } f.c40 = (h.n && h.c40) || '401';
        // (1.221.0) La date n'est que celle d'arrivée (« mets celle de la pièce ») : le curseur y va avant le total.
        const go = () => redessinerSx(dossier, true, f.dateSrc === 'arrivee' ? '#sx-date' : '#sx-ttc');
        const vise = zone.querySelector('button:hover');
        if (vise) { let fait = false; const une = () => { if (!fait) { fait = true; go(); } }; vise.addEventListener('click', () => setTimeout(une, 0), { once: true }); setTimeout(une, 800); } else go(); });
      const tv = $('#sx-tva', zone); if (tv) tv.onchange = () => { f.tva = tv.value; f.tvaSrc = ''; redessinerSx(dossier, true, f.tva === 'autre' ? '#sx-tva-autre' : '#sx-compte'); };
      const cp = $('#sx-compte', zone);
      if (cp) {
        cp.addEventListener('input', () => { f.compte = cp.value.trim(); f.compteSrc = ''; const n = $('#sx-compte-nom', zone); if (n) n.textContent = (((livresState.livre || {}).plan || []).find(y => y.compte === f.compte) || {}).libelle || KC.libelleDuPlan(f.compte) || ''; majEcriture(); });
        suggererCompte(cp, () => ((livresState.livre || {}).plan || []), c => { f.compte = c.compte; f.compteSrc = ''; const n = $('#sx-compte-nom', zone); if (n) n.textContent = c.libelle || ''; majEcriture(); }, () => f.four);
      }
      const py = $('#sx-paye', zone); if (py) py.onchange = () => { f.paye = py.checked; majEcriture(); };
      on('#sx-ok', () => enregistrerSx(root, dossier, x, false));
      on('#sx-ok-valider', () => enregistrerSx(root, dossier, x, true));
      on('#sx-lignes', () => enLignesSx(root, dossier, x));
      on('#sx-douane', () => fenDemanderCl(dossier, { titre: `La déclaration en douane · ${f.four}`, piece: `la déclaration en douane de la facture ${f.four}${f.numero ? ` ${f.numero}` : ''} (${f.montantDev} ${f.devise}), avec la TVA et les droits payés`, mois: x.mois }, { hors: true }));
      on('#sx-autre', () => menuAutreSx(root, dossier, x, $('#sx-autre', zone)));
      // (1.211.0) « Lire la pièce » : la même lecture que le classeur (avec l'accord du client) ; lue, la fiche repart de ce
      // que la pièce dit, tant que rien n'y a été tapé.
      // (1.215.0) Ce que l'IA a lu remplace la fiche, même touchée : on l'a demandé (avant, une fiche touchée gardait ses
      // champs, et la lecture ne se voyait nulle part).
      on('#sx-lire', () => fenLireCl(dossier, x, () => { sxState.fiches.delete(x.k); redessinerSx(dossier, true); }));
      $$('input, select', zone).forEach(c => c.addEventListener('input', () => { f.touchee = true; }));
    }
    on('#sx-joindre', async () => {
      try {
        await joindreSx(dossier, x, x.sx.e.id);
        const tvaJ = tvaSx(x.sx.e), reste = Math.max(0, P.liste.length - 1);
        toastUndo(`${x.photo ? 'La photo' : 'La pièce'} est jointe à ${x.sx.e.piece || 'son achat'}${tvaJ ? ` · ${dtSx(tvaJ)} DT de TVA justifiée` : ' : l\'achat a son justificatif'} · ${reste ? pl(reste, 'pièce attend', 'pièces attendent') : 'plus aucune pièce n\'attend'}.`, async () => { try { await declasserSx(dossier, x); await apresSx(root, dossier, { k: '' }); } catch (err) { toast(plainError(err), 'error'); } });
        await apresSx(root, dossier, x, { docs: !!x.doc });
      } catch (err) { toast(plainError(err), 'error'); }
    });
    on('#sx-pas-meme', () => { sxState.saisir.add(x.k); redessinerSx(dossier, true, '#sx-four'); });
    on('#sx-pas-double', () => { sxState.saisir.add(x.k); x.etat = ['ambre', 'à saisir', 'traiter']; redessinerSx(dossier, true, '#sx-four'); });
    on('#sx-double', async () => {
      try {
        const jum = ((sxState.dernier || {}).items || []).find(y => y.k === x.jumelle);
        if (jum) await api.classeur.doubler(dossier.id, x.p ? 'message' : 'document', x.p ? x.p.id : x.doc.id, jum.p ? 'message' : 'document', jum.p ? jum.p.id : jum.doc.id);
        else await classerSx(dossier, x, 'double');
        toastUndo(`${fichierSx(x).nom} : marquée en double, hors du compte.`, async () => { try { await declasserSx(dossier, x); await apresSx(root, dossier, { k: '' }); } catch (err) { toast(plainError(err), 'error'); } });
        await apresSx(root, dossier, x, { docs: !!x.doc });
      } catch (err) { toast(plainError(err), 'error'); }
    });
    on('#sx-verifiee', async () => {
      try {
        await classerSx(dossier, x, 'verifiee');
        toastUndo(`${courtSx(x)} : marquée vérifiée.`, async () => { try { await declasserSx(dossier, x); await apresSx(root, dossier, { k: '' }); } catch (err) { toast(plainError(err), 'error'); } });
        await apresSx(root, dossier, x, { docs: !!x.doc });
      } catch (err) { toast(plainError(err), 'error'); }
    });
    on('#sx-deplacer', () => deplacerSx(root, dossier, x));
    on('#sx-corriger', () => corrigerSx(dossier, x));
    on('#sx-certif', () => certificatSx(dossier, x));
    on('#sx-relancer', () => { if (x.p) redemanderPiece(x.p, dossier, async note => { try { await api.pieces.classer(dossier.id, x.p.id, false); await api.pieces.classer(dossier.id, x.p.id, true, 'illisible', note); } catch { /* déjà classée : la relance est partie */ } toast(`Relance envoyée à ${prenomCl(dossier.contact) || 'le client'}.`); await apresSx(root, dossier, x); }); });
    on('#sx-lisible', async () => { try { await declasserSx(dossier, x); sxState.saisir.add(x.k); await apresSx(root, dossier, { k: '' }); sxState.sel = x.k; redessinerSx(dossier, true, '#sx-four'); } catch (err) { toast(plainError(err), 'error'); } });
    on('#sx-demander-date', () => {
      const e = x.sx.e, qui = prenomCl(dossier.contact);
      fenDemanderCl(dossier, { titre: `La date de ${e.piece || 'ton achat'} · ${nomTiersSx(e)}`, piece: `la bonne date de ${e.piece || 'ton achat'} (${nomTiersSx(e)})`, mois: x.mois,
        texte: `Bonjour${qui ? ` ${qui}` : ''}, ton achat ${e.piece || ''} (${nomTiersSx(e)}, ${dtSx(ttcSx(e))} DT) est daté du ${jjmm(e.date)}, mais la facture est du ${jjmm(x.lu.date)}. Peux-tu corriger sa date dans SkanFact ? Sa TVA compte au mois de la facture.` }, { hors: true, apres: async () => { await apresSx(root, dossier, x); } });
    });
    on('#sx-demander', () => fenDemanderCl(dossier, { titre: `${courtSx(x)} · ${x.sx.e.piece || ''}`, texte: `Bonjour${prenomCl(dossier.contact) ? ` ${prenomCl(dossier.contact)}` : ''}, sur ton achat ${x.sx.e.piece || ''} (${nomTiersSx(x.sx.e)}, ${dtSx(ttcSx(x.sx.e))} DT), j'ai une question : `, mois: x.mois }, { hors: true }));
    on('#sx-conf-oui', () => confianceSxPoser(root, dossier, nomTiersSx(x.sx.e), true));
    on('#sx-conf-non', () => confianceSxPoser(root, dossier, nomTiersSx(x.sx.e), false));
  }
  // « Autre chose… » : ce qu'une pièce peut être d'autre qu'un achat à saisir.
  function menuAutreSx(root, dossier, x, ancre) {
    $$('.sx-menu').forEach(m => m.remove());
    const m = document.createElement('div');
    m.className = 'row-menu sx-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = `<button type="button" role="menuitem" data-sx-r="rien"><b>Rien à saisir</b><span>Un contrat, une attestation : gardée dans le dossier, à sa date</span></button>
      <button type="button" role="menuitem" data-sx-r="saisie"><b>Déjà saisie</b><span>Elle est déjà dans ses livres : classée sans rien ajouter</span></button>
      <button type="button" role="menuitem" data-sx-r="double"><b>En double</b><span>La même pièce est déjà arrivée</span></button>`;
    document.body.append(m);
    const r = ancre.getBoundingClientRect();
    m.style.position = 'fixed'; m.style.left = `${Math.max(8, Math.min(window.innerWidth - 330, r.left))}px`; m.style.top = `${r.bottom + 4}px`; m.style.zIndex = '60';
    const fermer = () => { m.remove(); document.removeEventListener('mousedown', dehors, true); };
    const dehors = e => { if (!m.contains(e.target)) fermer(); };
    setTimeout(() => document.addEventListener('mousedown', dehors, true), 0);
    $$('[data-sx-r]', m).forEach(b => { b.onclick = async () => {
      fermer();
      try {
        await classerSx(dossier, x, b.dataset.sxR);
        toastUndo(`${fichierSx(x).nom} : ${b.querySelector('b').textContent.toLowerCase()}.`, async () => { try { await declasserSx(dossier, x); await apresSx(root, dossier, { k: '' }); } catch (err) { toast(plainError(err), 'error'); } });
        await apresSx(root, dossier, x, { docs: !!x.doc });
      } catch (err) { toast(plainError(err), 'error'); }
    }; });
  }
  // Le clavier de la fiche : Entrée enregistre (ou joint, ou vérifie), Alt+→ passe, Alt+← revient, Alt+L ouvre en lignes.
  function clavierSx(e) {
    if (!/\/comptabilite\/saisie/.test(location.hash) || sxState.mode === 'km' || $('#modal-root').children.length || !$('#sx-fiche')) return;
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const b = $(e.key === 'ArrowRight' ? '#sx-suiv' : '#sx-prec'); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
    if (e.altKey && (e.key === 'l' || e.key === 'L')) { const b = $('#sx-lignes'); if (b) { e.preventDefault(); b.click(); } return; }
    // (1.211.0) C : corriger, hors d'un champ où l'on tape.
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) { const b = $('#sx-corriger'); if (b) { e.preventDefault(); b.click(); } return; }
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'TEXTAREA' || $('.sugg-pop'))) return;
    if (t && t !== document.body && !t.closest('#sx-fiche')) return;
    // (1.220.0) Tout attend le client : Entrée mène à l'étape suivante, jamais à une deuxième relance.
    const b = $('#sx-vers-banque') || $('#sx-vers-declaration') || $('#sx-fiche .btn-primary:not([disabled])');
    if (b) { e.preventDefault(); b.click(); }
  }
  document.addEventListener('keydown', clavierSx);
  // Redessiner la seule zone des pièces (la grille et ce qu'on y tape ne bougent pas) : à l'arrivée des pièces, ou d'un clic.
  function redessinerSx(dossier, force, focus) {
    const zone = $('#sx-zone');
    if (!zone || livresState.onglet !== 'saisie' || livresState.dossierId !== dossier.id || $('#modal-root').children.length) return;
    if (!force && zone.contains(document.activeElement) && document.activeElement !== document.body && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const P = piecesSx(dossier);
    const avant = sxState.mode;
    // Les pièces sont arrivées : la Saisie passe face à la première, si rien n'est commencé dans la grille.
    if (!sxState.mode && P.pret && P.liste.length && !pieceEnCours(saisieState.piece) && !(saisieState.piece && saisieState.piece.depuisClasseur)) sxState.mode = 'face';
    if (P.pret && avant !== sxState.mode) { drawLivres(document, dossier); return; }
    // (1.336.0) Ouverte avant que les pièces soient lues (depuis la conversation ou « Pièces reçues »), la grille n'avait
    // pas de place à côté, et la pièce n'y venait jamais. Sa place se pose à leur arrivée, sans redessiner la grille où
    // l'on tape déjà.
    const km = $('.sx-km');
    if (km && sxState.mode === 'km' && P.pret && P.liste.length && !km.hidden && !grilleCacheeSx(P) && !videCacheSx(P) && !$('#sx-km-d')) {
      km.classList.remove('seul');
      km.insertAdjacentHTML('beforeend', '<div class="sx-km-d" id="sx-km-d"></div>');
    }
    const html = zoneSx(dossier, P);
    const cle = `${sxState.mode}|${sxState.sel}|${html.length}|${html}`;
    if (!force && cle === sxState.dessin) return;
    sxState.dessin = cle;
    sxState.dernier = P;
    zone.innerHTML = html;
    // (1.211.0) La grille suit le mode, même dessinée pendant que les pièces se relisaient (elle restait visible sous la fiche).
    const grille = $('.sx-km'); if (grille) grille.hidden = !!(P.pret && P.liste.length && sxState.mode === 'face') || grilleCacheeSx(P);
    const cote = $('#sx-km-d'); if (cote) cote.innerHTML = cotePieceSx(dossier, P);
    brancherSx(document.getElementById('c-livres') || document, document, dossier);
    if (focus) { const c = $(focus, zone); if (c) c.focus(); }
  }

  function vueSaisie(dossier) {
    const s = livresState;
    const r = reglagesSaisie();
    if (!s.livre) {
      return `<div class="empty"><p>La saisie a besoin d'un livre.</p>
        <p class="muted small">Crée-le à partir des paquets reçus, ou reprends le dossier par sa balance d'ouverture — les deux boutons sont en haut de cette page.</p></div>`;
    }
    if (s.livre.exercice.clos) {
      return `<div class="warn-box"><b>L'exercice ${esc(s.annee)} est clos.</b> On n'y saisit plus. Rouvre-le si tu dois vraiment y toucher : la réouverture demande un motif, et c'est elle qui expliquera plus tard pourquoi un chiffre a changé.</div>`;
    }
    if (!saisieState.piece || saisieState.dossierId !== dossier.id) {
      // Une pièce commencée pour un AUTRE client se gare, elle ne s'écrase pas (U-09) : on la
      // retrouve telle quelle en revenant sur son dossier.
      if (saisieState.dossierId && saisieState.dossierId !== dossier.id && pieceEnCours(saisieState.piece)) {
        saisieState.enAttente[saisieState.dossierId] = saisieState.piece;
      }
      const garee = saisieState.enAttente[dossier.id];
      delete saisieState.enAttente[dossier.id];
      saisieState.dossierId = dossier.id;
      saisieState.piece = garee || null;
    }
    if (!saisieState.piece) {
      const j = r.journalParDefaut || dossier.dernierJournal || (s.livre.journaux[0] || {}).code || '';
      // La date est PROPOSÉE : aujourd'hui si l'on est dans l'exercice ouvert, sinon son dernier
      // jour. La grille s'ouvrait vide, et le refus annonçait « La date manque » sur un écran où
      // l'invite grise « 04/03/2026 » se lit comme une valeur — on cherchait ce qui n'allait pas.
      // Elle reste modifiable, et les pièces suivantes reprennent celle de la précédente.
      saisieState.piece = pieceVide(j, dateProposee(s.annee));
    }
    const p = saisieState.piece;
    if (p.journalDe) {
      const re = { achats: /^(AC|HA)|achat/i, banque: /^(BQ|BAN)|banque/i, ventes: /^(VT|VE)|vente/i }[p.journalDe];
      const j = re && s.livre.journaux.find(x => re.test(`${x.code} ${x.libelle || ''}`));
      p.journal = j ? j.code : (r.journalParDefaut || dossier.dernierJournal || (s.livre.journaux[0] || {}).code || '');
      delete p.journalDe;
    }
    const brouillards = (s.livre.ecritures || []).filter(e => e.statut === 'brouillard')
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const guides = K.guidesDuDossier(S, dossier);
    // Le brouillard d'un gros dossier comptait 3 532 pièces sous la grille : 153 000 px et deux
    // secondes à chaque redessin de la saisie (10.14.0, saturation). On pagine les PIÈCES (9.4.5) ;
    // les lots proposés, eux, portent sur tout le brouillard — c'est lui qu'ils valident.
    // (1.212.0, S8) Sur un mois de la frise, le brouillard montre CE mois (la maquette) ; « Tout le brouillard » le reste.
    const mBl = livresState.mode === 'mois' && livresState.mois && !sxState.blTout ? livresState.mois : '';
    const brVus = mBl ? brouillards.filter(e => String(e.date || '').slice(0, 7) === mBl) : brouillards;
    const pagerBrouillard = pagerBar(brVus.length, s, 'pièce');
    const brouillardsPage = paginate(brVus, s);
    // (1.210.0) Les pièces du mois, face à leur fiche : la grille reste dessous, cachée, pour « Au kilomètre » et « En lignes ».
    if (sxState.dossier !== dossier.id) { Object.assign(sxState, { dossier: dossier.id, sel: '', mode: '', zoom: 1, rot: 0, dessin: '' }); sxState.fiches.clear(); sxState.saisir.clear(); }
    const P = piecesSx(dossier);
    sxState.dernier = P;
    if (pieceEnCours(p) || p.depuisClasseur) sxState.mode = 'km';
    else if (!sxState.mode && P.pret && P.liste.length) sxState.mode = 'face';
    const face = P.pret && P.liste.length > 0 && sxState.mode === 'face';
    const videSx = videCacheSx(P);
    const cache = face || grilleCacheeSx(P) || videSx;
    const cote = P.pret && P.liste.length > 0 && !cache;
    const zoneHtml = zoneSx(dossier, P);
    sxState.dessin = `${sxState.mode}|${sxState.sel}|${zoneHtml.length}|${zoneHtml}`;
    const mSx = moisSx();
    const brMois = mSx ? brouillards.filter(e => String(e.date || '').slice(0, 7) === mSx) : brouillards;
    // Le compteur du bouton compte ce que la fenêtre validera : sans l'achat dont la date est demandée au client (1.220.0).
    const aValiderMois = mSx ? brMois.filter(e => String(e.date || '') <= K.today() && !e.attente && !(achatSx(e) && dateDemandeeSx(dossier, e))) : [];
    // Les lots proposés : ceux qui EXISTENT dans le brouillard, pièces du jour et déjà au serveur (le mois choisi a son bouton).
    const lotsBl = lotsDuBrouillard(brouillards.filter(e => String(e.date || '') <= K.today() && !e.attente)).filter(l => !(l.type === 'mois' && l.cle === mSx && aValiderMois.length));
    const abosActifs = (Array.isArray(dossier.abonnements) ? dossier.abonnements : []).filter(a => a.actif).length;

    // (1.174.2) Une saisie ouverte depuis le classeur dit de quelle pièce elle vient : enregistrée, la pièce s'y joint.
    const dc = p.depuisClasseur;
    return `<div class="sx" id="sx-zone">${zoneHtml}</div><div class="sx-km${cote ? '' : ' seul'}"${cache ? ' hidden' : ''}><div class="sx-km-g">${dc ? `<div class="sa-depuis" role="note"><span><b>Saisie de « ${esc(dc.nom)} »</b> · ${esc(dc.ou)} : enregistrée, l'écriture la prend pour justificatif${dc.retour ? ', et elle sort des pièces à classer' : ', et le classeur la compte saisie'}.${dc.dateArrivee ? ' La date proposée est celle de son arrivée : mets celle de la facture.' : ''}</span><a class="btn btn-sm btn-ghost" href="${dc.retour ? esc(dc.retour) : `#/dossier/${encodeURIComponent(dossier.id)}/classeur`}">${dc.retour ? esc(dc.retourTexte || 'Retour aux pièces reçues') : 'Retour au classeur'}</a></div>` : ''}<div class="sa-tete" id="sa-tete">
        <label class="field sa-j"><span class="fl">Journal ${info('sa.journal')}</span>
          <select id="sa-journal">${s.livre.journaux.map(j => `<option value="${esc(j.code)}" ${p.journal === j.code ? 'selected' : ''}>${esc(j.code)} — ${esc(j.libelle)}</option>`).join('')}</select></label>
        <label class="field sa-d"><span class="fl">Date ${info('sa.date')}</span>
          ${/* Le champ montre le jour en FRANÇAIS, la pièce garde l'ISO. L'écran affichait
                « 2026-09-17 » sous une invite qui annonce « 04/03/2026 » : le format interne
                fuyait dans l'écran où un comptable tunisien lit une date. La saisie reste
                tolérante — `dateTapee` accepte 4, 4/3, 04/03/2026 et l'ISO. */''}
          <input id="sa-date" autocomplete="off" placeholder="${r.dateComplete ? '04/03/2026' : '4'}" value="${esc(dateAffichee(p.date, r))}"></label>
        <label class="field sa-p"><span class="fl">Pièce ${info('sa.piece')}</span>
          <input id="sa-piece" autocomplete="off" value="${esc(p.piece)}"></label>
        <label class="field sa-grow"><span class="fl">Libellé ${info('sa.libelle')}</span>
          <input id="sa-libelle" autocomplete="off" value="${esc(p.libelle)}"></label>
        ${/* 10.12.0 (U-01) — « Joindre » vit au bout de la ligne des champs, et l'aide des touches
              sous la grille : chacune coûtait une rangée AU-DESSUS, entre l'en-tête de la pièce et
              ses lignes — sur un portable, c'était la grille qu'on ne voyait plus. */''}
        <button type="button" class="btn btn-sm sa-joindre" id="sa-joindre">${p.pieceJointe ? 'Justificatif joint ✓' : 'Joindre un justificatif…'}</button>
      </div>
      ${guides.length ? `<div class="sa-outils">
        <select id="sa-guide" aria-label="Partir d'un guide d'écritures"><option value="">Partir d'un guide…</option>${guides.map(g => `<option value="${esc(g.id)}">${esc(g.nom)}</option>`).join('')}</select>
          <input id="sa-guide-montant" class="sa-montant" inputmode="decimal" placeholder="Montant" aria-label="Montant du guide" autocomplete="off">
      </div>` : ''}
      ${/* 10.12.0 (U-26) — des largeurs FIXES : l'intitulé du compte apparaît pendant la frappe, et
            la grille se recalculait à chaque caractère — les colonnes sautaient sous le curseur. */''}
      <div class="scroll-x"><table class="list compact sa-grille"><colgroup>
        <col class="sa-c-compte"><col class="sa-c-nom"><col class="sa-c-lib"><col class="sa-c-mt"><col class="sa-c-mt"><col class="sa-c-sup">
      </colgroup><thead><tr>
        <th class="nw">Compte</th><th>Intitulé</th><th>Libellé</th>
        <th class="r nw">Débit</th><th class="r nw">Crédit</th><th></th></tr></thead>
        <tbody id="sa-lignes">${lignesSaisieHtml()}</tbody>
        <tfoot><tr>
          <td colspan="3" class="sa-tl">Total de la pièce</td>
          <td class="r nw" id="sa-td">0,000</td><td class="r nw" id="sa-tc">0,000</td><td></td></tr>
          <tr id="sa-ecart-l"><td colspan="3" class="sa-tl">Écart</td>
          <td class="r nw" id="sa-te" colspan="2">0,000</td><td></td></tr></tfoot></table></div>
      <div class="sa-ajout"><button type="button" class="btn btn-sm btn-ghost" id="sa-ajouter">+ Ajouter une ligne</button></div>
      <div class="sa-pied">
        <div>
          <div id="sa-solde"></div>
          <div class="bandeau ambre sa-decl" id="sa-decl" role="note" hidden></div>
          <div class="bandeau ambre sa-decl" id="sa-double" role="note" hidden></div>
          ${/* Le motif du refus se lit AVANT le bouton, jamais dessous : un avertissement sous le
                geste arrive après la décision (règle 9.4.2). */''}
          <div class="sa-refus" id="sa-refus" hidden></div>
        </div>
        <div class="sa-actions">
          <button type="button" class="btn btn-sm" id="sa-vider">Vider</button>
          <button type="button" class="btn" id="sa-ok">Enregistrer en brouillard</button>
          <button type="button" class="btn btn-primary" id="sa-okvalider">Enregistrer et valider</button>
        </div>
      </div>
      ${/* Les touches : sous la grille, là où les doigts les cherchent pendant qu'ils tapent — et
            repliables, le choix retenu. Un comptable qui les connaît n'a pas à les relire à chaque
            pièce ; un débutant les trouve à l'endroit du geste. */''}
      <details class="sa-touches" id="sa-touches"${prefs.get('saTouches', true) === false ? '' : ' open'}><summary>Les touches de la grille</summary>${aideTouches()}</details>
      </div>${cote ? `<div class="sx-km-d" id="sx-km-d">${cotePieceSx(dossier, P)}</div>` : ''}</div>
      <div class="sx-bl-z"${videSx && !brMois.length ? ' hidden' : ''}><div class="sx-bl-t"><h2 id="sa-brouillard">Le brouillard${mBl ? ` ${esc(deMois(mBl))}` : ''} ${info('sa.brouillard')}</h2><span class="mu" id="sx-bl-n">${brVus.length ? `${esc(pl(brVus.length, 'écriture'))}${mBl && brouillards.length > brVus.length ? ` · ${brouillards.length - brVus.length} d'autres mois` : ''} · elles n'entrent dans aucun chiffre tant qu'elles ne sont pas validées` : mBl && brouillards.length ? `rien n'y attend ${esc(deMois(mBl))} · ${esc(pl(brouillards.length, 'écriture'))} d'autres mois` : 'rien n\'y attend'}</span>
        ${mSx && brouillards.length > brMois.length ? `<button type="button" class="cp-plus" id="sx-bl-tout">${sxState.blTout ? `Seulement ${esc(moisLong(mSx))}` : `Tout le brouillard (${brouillards.length})`}</button>` : ''}
        <span class="sx-bl-g"><button type="button" class="btn btn-sm" id="sx-abos" aria-expanded="${sxState.abosOuverts ? 'true' : 'false'}">Écritures qui reviennent <small class="sx-nb">${abosActifs}</small></button>${guides.length ? `<button type="button" class="btn btn-sm" id="sx-guides">Guides <small class="sx-nb">${guides.length}</small></button>` : ''}${r.validerParLot && aValiderMois.length ? (peutValiderCl(dossier) ? `<button type="button" class="btn btn-sm" data-lot-mois="${esc(mSx)}">Valider ${aValiderMois.length > 1 ? `les ${aValiderMois.length}` : 'celle'} ${esc(deMois(mSx))}</button>` : `<span class="fd-qui" id="sx-qui-lot">${esc(cap(reviseurCl(dossier)))} ${aValiderMois.length > 1 ? 'les valide' : 'la valide'}</span>`) : ''}</span></div>
      ${/* Les lots proposés sont ceux qui EXISTENT dans le brouillard (T-29) : « Valider tout le
            journal VT » quand le seul brouillard est en BQ ouvrait une fenêtre pour dire qu'il n'y
            avait rien à faire — un bouton vif qui ne peut rien valider de ce qui est affiché. Le
            compte est connu avant le clic, donc il est écrit dessus. */''}
      ${brouillards.length ? `${r.validerParLot && peutValiderCl(dossier) && lotsBl.length ? (lots => mSx || lotsBl.length > 3
          ? `<details class="sa-lot-plus" id="sa-lot-plus"><summary>${mSx ? 'Valider un autre lot' : 'Valider par lot'} (${(lots.match(/<button/g) || []).length})</summary><div class="sa-lot">${lots}<span class="muted small">Ce qui ne tombe pas juste n'est pas validé, et te sera nommé.</span></div></details>`
          : `<div class="sa-lot">${lots}<span class="muted small">Ce qui ne tombe pas juste n'est pas validé, et te sera nommé.</span></div>`)(lotsBl.map(l => `<button type="button" class="btn btn-sm" data-lot-${l.type}="${esc(l.cle)}">${esc(K.libelleLot(l))}</button>`).join('')) : ''}
        ${(a => a.length === 1 ? `<p class="muted small" id="sa-attend">L'écriture ${esc(a[0].piece || '')} du journal ${esc(a[0].journal)} est datée du ${esc(fmtJour(a[0].date))} : elle se valide à partir de ce jour-là.</p>`
    : a.length ? `<p class="muted small" id="sa-attend">${a.length} pièces sont datées après aujourd'hui : chacune se valide à partir de sa date.</p>` : '')(brouillards.filter(e => String(e.date || '') > K.today()))}
        <div class="scroll-x"><table class="list compact sx-bl"><thead><tr>
          <th class="nw">Date</th><th>Journal</th><th class="nw">Pièce</th><th>Libellé</th><th class="nw c">Par</th>
          <th class="r nw">Montant</th><th></th></tr></thead>
        <tbody>${brouillardsPage.map(e => {
          const t = KC.soldeDeLignes(e.lignes);
          return `<tr data-br="${esc(e.id)}" class="br-ligne">
            <td class="nw">${esc(String(e.date || '').slice(0, 4) === String(livresState.annee) ? jjmm(e.date) : fmtJour(e.date))}</td><td>${esc(e.journal)}</td><td class="nw mono">${e.piece ? esc(e.piece) : '<span class="sx-sans-n" title="Sans numéro de pièce : la pièce qui la justifie ne se retrouvera pas">sans n°</span>'}</td>
            <td>${esc(e.libelle || '')}${e.pieceJointe ? ' <span title="Justificatif joint">📎</span>' : ''}${attenteBl(e) ? `<small class="sx-bl-att">au compte d'attente : ce que c'est reste à ${dossier.manual ? 'éclaircir' : `demander à ${esc(prenomCl(dossier.contact) || 'le client')}`}</small>` : ''}${
              /* (1.215.0, la maquette) Plus de colonne « État » qui dit « équilibrée » sur chaque ligne : seul ce qui ne va pas se dit, sous le libellé. */
              e.attente ? (e.refus ? `<small class="err-inline sa-refusee" title="${esc(e.refus)}">refusée : ${esc(e.refus)}</small>` : ' <span class="badge sa-attente">attend le réseau</span>')
              : t.equilibre ? '' : `<small class="err-inline sx-bl-ecart">écart ${esc(montant(t.ecart))}</small>`}</td>
            <td class="c">${(q => `<span class="sx-par" title="${esc(q)}">${esc(q === 'le cabinet' ? initialesDe((S.cabinet && S.cabinet.name) || 'Cabinet') : q === 'reprise' ? 'AN' : initialesDe(q))}<span class="sr">${esc(q)}</span></span>`)(e.source === 'skanfact' ? (prenomCl(dossier.contact) || 'le client') : e.source === 'an' ? 'reprise' : 'le cabinet')}</td>
            <td class="r nw">${esc(montant(t.debit))}</td>
            <td class="actions row-actions">${RowMenu.bouton('B:' + e.id, '⋯', 'sx-bl-plus').replace('<button ', `<button aria-label="Plus de gestes pour ${esc(e.piece || 'cette écriture')}" `)}</td></tr>`;
        }).join('')}</tbody></table></div>${pagerBrouillard}</div>`
        : `<div class="empty mini"><p>Rien en brouillard.</p><p class="muted small">Tout ce que tu saisis ici arrive en brouillard : rien ne prend de numéro tant que tu ne l'as pas validé.</p></div>`}

      ${/* Un abonnement est un modèle d'écriture récurrente : il appartient à la SAISIE (T-18). Posé
            hors des sous-onglets, il s'affichait sous la Balance, le Grand livre, la Banque et la
            Déclaration — un état vide secondaire qui repoussait chaque fois le contenu réel. */''}
      <div class="panel mt" id="c-abos"${sxState.abosOuverts ? '' : ' hidden'}><h2>Écritures qui reviennent ${info('sa.abonnements')}</h2><div id="d-abos"></div></div>`;
  }

  // (1.212.0) Une écriture qui passe par le compte d'attente (471) : ce qu'elle est reste à éclaircir.
  // (1.221.0) L'imputation qui SOLDE le 471 d'après la réponse du client (« Imputation : … », 1.180.0) n'y attend rien :
  // elle ne se décrit pas comme une écriture qui reste au compte d'attente.
  const attenteBl = e => !/^Imputation\b/.test(String(e.libelle || '')) && (e.lignes || []).some(l => /^471/.test(String(l.compte || '')) && (Number(l.debit) || Number(l.credit)));
  // Les périmètres qu'un lot peut valider, déduits du brouillard : par journal, puis par mois.
  function lotsDuBrouillard(brouillards) {
    const parJ = {}, parM = {};
    brouillards.forEach(e => {
      if (e.journal) parJ[e.journal] = (parJ[e.journal] || 0) + 1;
      const m = String(e.date || '').slice(0, 7);
      if (m) parM[m] = (parM[m] || 0) + 1;
    });
    const j = Object.keys(parJ).sort().map(k => ({ type: 'journal', cle: k, label: k, n: parJ[k] }));
    const m = Object.keys(parM).sort().map(k => ({ type: 'mois', cle: k, label: moisLabelCourt(k), n: parM[k] }));
    // Un seul journal ET un seul mois : les deux boutons valideraient la même chose.
    return j.length === 1 && m.length === 1 ? j : j.concat(m);
  }

  const TITRE_COMPTE_NEUF = 'Compte neuf pour ce dossier : il entrera au plan sous ce nom à l\'enregistrement.';
  function lignesSaisieHtml() {
    const p = saisieState.piece || pieceVide();
    const plan = ((livresState.livre || {}).plan) || [];
    const nom = c => (plan.find(x => x.compte === String(c || '').trim()) || {}).libelle || '';
    // 10.14.0 — un compte que le dossier n'a pas encore montre le nom qu'il PRENDRA (le plan de
    // référence, comme `assurerCompte`), en italique : on voit ce qu'on vient de taper avant de
    // l'enregistrer, et on le distingue d'un compte déjà au plan.
    const neuf = c => { const n = String(c || '').trim(); return !!n && !nom(n) && !!KC.libelleDuPlan(n); };
    const intitule = c => nom(c) || (neuf(c) ? KC.libelleDuPlan(String(c).trim()) : '');
    // Chaque case porte son `aria-label` : le rapport entre une case et son en-tête de colonne est
    // évident à l'œil et invisible au clavier comme à la voix. Le numéro de ligne y est, sinon cinq
    // cases annoncent toutes « Compte » et on ne sait plus laquelle on remplit.
    const lab = (quoi, i) => `aria-label="${quoi} — ligne ${i + 1}"`;
    return (p.lignes || []).map((l, i) => `<tr data-i="${i}">
      <td><input data-k="compte" class="sa-compte" ${lab('Compte', i)} autocomplete="off" value="${esc(l.compte)}"></td>
      <td class="sa-nom muted small${neuf(l.compte) ? ' sa-nom-neuf' : ''}" data-nom="${i}"${neuf(l.compte) ? ` title="${esc(TITRE_COMPTE_NEUF)}"` : ''}>${esc(intitule(l.compte))}</td>
      <td><input data-k="libelle" ${lab('Libellé', i)} autocomplete="off" value="${esc(l.libelle)}" placeholder="${esc(p.libelle || '')}"></td>
      <td><input data-k="debit" class="r sa-montant${montantRefuse(l.debit) ? ' sa-ko' : ''}" ${lab('Débit', i)}${montantRefuse(l.debit) ? ' aria-invalid="true"' : ''} inputmode="decimal" autocomplete="off" value="${esc(l.debit)}"></td>
      <td><input data-k="credit" class="r sa-montant${montantRefuse(l.credit) ? ' sa-ko' : ''}" ${lab('Crédit', i)}${montantRefuse(l.credit) ? ' aria-invalid="true"' : ''} inputmode="decimal" autocomplete="off" value="${esc(l.credit)}"></td>
      <td class="sa-sup"><button type="button" class="btn btn-sm" data-sup="${i}" title="Retirer cette ligne" aria-label="Retirer cette ligne">✕</button></td>
    </tr>`).join('');
  }

  function brancherSaisie(el, root, dossier) {
    const s = livresState;
    if (!s.livre || !saisieState.piece) return;
    brancherSx(el, root, dossier);
    const abos = $('#sx-abos', el);
    // (1.215.0, la maquette) « Écritures qui reviennent » est un bouton du brouillard : il ouvre (ou referme) leur liste.
    if (abos) abos.onclick = () => { sxState.abosOuverts = !sxState.abosOuverts; const c = $('#c-abos'); abos.setAttribute('aria-expanded', String(sxState.abosOuverts)); if (c) { c.hidden = !sxState.abosOuverts; if (!c.hidden) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
    // (plateforme, 1.87.7) La saisie s'ouvre le curseur dans « Pièce », comme après chaque enregistrement : elle s'ouvrait
    // sans curseur, et la saisie au clavier commençait par un clic (vu en recette le 21/10/2026). Seulement à la souris et au
    // clavier (au doigt, le clavier de l'écran s'ouvrirait), quand rien d'autre n'a le curseur ni de fenêtre ouverte.
    requestAnimationFrame(() => {
      const libre = !document.activeElement || document.activeElement === document.body;
      if (libre && matchMedia('(hover: hover) and (pointer: fine)').matches && !document.querySelector('#modal-root .modal')) {
        // (plateforme) 1.100.0 — sans défiler : arrivée au brouillard (« Voir le brouillard »), la page remontait à la
        // grille sous l'effet de ce focus ; ouverte normalement, elle est déjà en haut, où est « Pièce ».
        const pc = $('#sa-piece', el); if (pc) pc.focus({ preventScroll: true });
      }
    });
    // La pagination du brouillard : la pièce en cours vit dans `saisieState`, le redessin la garde.
    bindPager(el, () => drawLivres(root, dossier), s);
    const p = saisieState.piece;
    const corps = $('#sa-lignes', el);
    const t = touchesSaisie();
    const r = reglagesSaisie();

    // Le montant que ⇥ poserait sur la dernière ligne, ou `null` si le geste ne se propose pas.
    //
    // UNE fonction pour les deux moitiés : celle qui POSE le montant (le gestionnaire de Tab) et
    // celle qui l'ANNONCE dans la case d'où l'on appuie. L'aide disait « Solder la dernière ligne
    // ⇥ Tab » sans dire d'OÙ : le geste ne part que de la case Crédit, sur une ligne qui porte un
    // compte et pas encore de montant — trois conditions qu'aucun écran ne montrait, donc un
    // raccourci qui « ne marche pas » une fois sur deux sans qu'on sache pourquoi (T-48). C'est la
    // règle du bouton éteint (9.4.5) appliquée à une touche : ce qui refuse et ce qui annonce
    // doivent être la même fonction, sinon les deux divergent.
    const soldeProposable = () => {
      const i = (p.lignes || []).length - 1;
      const l = (p.lignes || [])[i];
      if (!l || !String(l.compte || '').trim()) return null;
      if (String(l.debit || '').trim() || String(l.credit || '').trim()) return null;
      const t2 = KC.soldeDeLignes(lignesReelles(p));
      if (t2.equilibre || (!t2.debit && !t2.credit)) return null;
      return { i, debit: t2.solde.debit, credit: t2.solde.credit };
    };

    // Le solde, recalculé sans rien redessiner d'autre. C'est le « contrôle d'équilibre en direct » :
    // il ne refuse rien tout seul — c'est `ecritureValide` qui refuse, à l'enregistrement — il dit
    // seulement où on en est, pendant qu'on tape.
    const majSolde = () => {
      const box = $('#sa-solde', el);
      if (!box) return;
      const t2 = KC.soldeDeLignes(lignesReelles(p));
      box.className = t2.equilibre && t2.debit ? 'sa-solde ok' : t2.debit || t2.credit ? 'sa-solde ko' : 'sa-solde';
      box.innerHTML = !t2.debit && !t2.credit
        ? '<span class="muted">Débit et crédit à zéro.</span>'
        : t2.equilibre
          ? `<b>Équilibrée</b> — ${esc(montant(t2.debit))} de chaque côté.`
          : `<b>Écart ${esc(montant(t2.ecart))}</b> — débit ${esc(montant(t2.debit))} / crédit ${esc(montant(t2.credit))}. Il manque ${t2.solde.debit ? `${esc(montant(t2.solde.debit))} au débit` : `${esc(montant(t2.solde.credit))} au crédit`}.`;

      // Les totaux vivent SOUS leurs colonnes, en chiffres de même chasse. Une somme annoncée dans
      // une phrase à gauche de l'écran ne se compare à rien : l'œil descend une colonne de montants
      // et doit trouver leur total au bout, pas ailleurs.
      const td = $('#sa-td', el), tc = $('#sa-tc', el), te = $('#sa-te', el), lig = $('#sa-ecart-l', el);
      if (td) td.textContent = montant(t2.debit);
      if (tc) tc.textContent = montant(t2.credit);
      if (lig) lig.hidden = t2.equilibre;
      if (te) te.textContent = montant(t2.ecart);

      // **Un bouton éteint dit POURQUOI.** `ecritureValide` est la même fonction que celle qui
      // refusera à l'enregistrement : le motif affiché ici est donc exactement celui qu'on aurait
      // vu après le clic — on le lit avant, pendant qu'on a encore le curseur dans la grille.
      //
      // DEUX verdicts, parce que les deux boutons n'exigent pas la même chose : le brouillard
      // accepte une pièce à moitié tapée (c'est sa raison d'être), la validation exige en plus un
      // libellé (T-51). Éteindre le brouillard sur le motif de la validation enfermerait la saisie
      // en cours ; ne rien dire ferait cliquer un bouton vif pour lire un refus.
      const plan = ((s.livre || {}).plan || []).map(c => c.compte);
      const v = verdictSaisie(p, plan);
      const vv = verdictSaisie(p, plan, { valider: true });
      const motif = $('#sa-refus', el);
      const bOk = $('#sa-ok', el), bVal = $('#sa-okvalider', el);
      if (bOk) { bOk.disabled = !v.ok; bOk.title = v.ok ? '' : v.motif; }
      if (bVal) { bVal.disabled = !vv.ok; bVal.title = vv.ok ? '' : vv.motif; }
      // 10.14.0 — un compte neuf pour le dossier se LIT ici, il n'éteint rien : il entrera au plan à
      // l'enregistrement (6.3.0). Un refus passe devant : c'est lui qui bloque.
      const av = (v.ok && vv.ok && v.avertissements) || [];
      const phrase = !v.ok ? v.motif : !vv.ok ? 'Pour valider : ' + vv.motif
        : av.length ? av[0] + (av.length > 1 ? ` Et ${pl(av.length - 1, 'autre compte neuf', 'autres comptes neufs')} dans cette pièce.` : '') : '';
      if (motif) { motif.hidden = !phrase; motif.textContent = typoTexte(phrase); }

      // Le geste de solde s'annonce là où il se déclenche, avec le montant qu'il posera — et il
      // nomme la colonne quand ce n'est pas celle où l'on est. Le placeholder se remet à jour ici,
      // avec les totaux : écrit une fois au dessin, il serait périmé à la frappe suivante.
      const prop = soldeProposable();
      const derniere = $(`tr[data-i="${(p.lignes || []).length - 1}"] input[data-k="credit"]`, corps);
      if (derniere) {
        derniere.placeholder = prop
          ? `⇥ ${montant(prop.debit || prop.credit)}${prop.debit ? ' au débit' : ''}`
          : '';
      }
    };

    const redessinerLignes = (focus) => {
      corps.innerHTML = lignesSaisieHtml();
      brancherLignes();
      majSolde();
      if (focus) {
        const cible = $(`tr[data-i="${focus.i}"] input[data-k="${focus.k}"]`, corps);
        if (cible) { cible.focus(); cible.select(); }
      }
    };

    const ligneDe = inp => Number(inp.closest('tr').dataset.i);
    const allerA = (i, k) => {
      const cible = $(`tr[data-i="${i}"] input[data-k="${k}"]`, corps);
      if (cible) { cible.focus(); cible.select(); return true; }
      return false;
    };

    function brancherLignes() {
      $$('input[data-k]', corps).forEach(inp => {
        const i = ligneDe(inp), k = inp.dataset.k;
        inp.oninput = () => {
          p.lignes[i][k] = inp.value;
          p.touchee = true;
          if (k === 'compte') {
            const n = inp.value.trim();
            const c = (s.livre.plan || []).find(x => x.compte === n);
            // Le même intitulé qu'au dessin : le nom du plan du dossier, sinon celui qu'il PRENDRA.
            const ref = !c && n ? KC.libelleDuPlan(n) : '';
            const cell = $(`[data-nom="${i}"]`, corps);
            if (cell) {
              cell.textContent = c ? (c.libelle || '') : ref;
              cell.classList.toggle('sa-nom-neuf', !!ref);
              if (ref) cell.title = TITRE_COMPTE_NEUF; else cell.removeAttribute('title');
            }
          }
          // Débit et crédit s'excluent : une ligne va d'un côté OU de l'autre, jamais des deux
          // (invariant de SPEC-DATA-005). On vide l'autre colonne plutôt que de laisser saisir une
          // ligne que la validation refusera trois écrans plus loin.
          if ((k === 'debit' || k === 'credit') && inp.value.trim()) {
            const autre = k === 'debit' ? 'credit' : 'debit';
            if (String(p.lignes[i][autre] || '').trim()) {
              p.lignes[i][autre] = '';
              const el2 = $(`tr[data-i="${i}"] input[data-k="${autre}"]`, corps);
              if (el2) el2.value = '';
            }
          }
          // La case qu'on ne sait pas lire se VOIT, pas seulement dans la phrase sous la grille (H-3).
          if (k === 'debit' || k === 'credit') {
            inp.classList.toggle('sa-ko', montantRefuse(inp.value));
            if (montantRefuse(inp.value)) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
          }
          majSolde();
          signalerSaisies();
        };
        inp.onkeydown = ev => {
          const touche = toucheDe(ev);
          if (touche === t.recopier) {
            ev.preventDefault();
            if (i > 0) { p.lignes[i][k] = p.lignes[i - 1][k]; inp.value = p.lignes[i][k]; inp.dispatchEvent(new Event('input')); }
            return;
          }
          if (touche === t.dupliquer) { ev.preventDefault(); dupliquerPiece(); return; }
          if (touche === t.valider) { ev.preventDefault(); enregistrer(true); return; }
          if (touche === t.ligneSuivante) {
            ev.preventDefault();
            // Sur la dernière ligne, Entrée en AJOUTE une : la grille suit la saisie, on ne clique
            // jamais « ajouter une ligne ».
            if (i === p.lignes.length - 1) { p.lignes.push(ligneVide()); redessinerLignes({ i: i + 1, k: 'compte' }); }
            else allerA(i + 1, 'compte');
            return;
          }
          // Tab depuis le CRÉDIT de la dernière ligne : on solde. C'est le geste qui fait gagner le
          // plus de temps de toute la grille — et il ne s'invente pas : `soldeDeLignes` calcule,
          // l'écran pose. Si la pièce tombe déjà juste, Tab reprend son comportement normal.
          if (ev.key === 'Tab' && !ev.shiftKey && k === 'credit' && i === p.lignes.length - 1) {
            const prop = soldeProposable();
            if (prop && prop.i === i) {
              ev.preventDefault();
              p.lignes[i].debit = montantChamp(prop.debit);
              p.lignes[i].credit = montantChamp(prop.credit);
              redessinerLignes({ i, k: prop.debit ? 'debit' : 'credit' });
            }
          }
        };
        if (k === 'compte') {
          suggererCompte(inp, () => KC.comptesProposables(s.livre.plan || []), c => {
            // 10.14.0 — le libellé de la ligne ne reçoit plus le NOM DU COMPTE : « Banques » sur le
            // 532 ne dit rien de l'opération, il remplaçait dans le journal le libellé de la pièce
            // qu'une ligne vide reprend — et la règle T-51 (une validée dit ce qu'elle enregistre)
            // passait sur des noms de comptes. Le nom vit dans la colonne Intitulé ; le champ vide
            // montre, en attente, le libellé de la pièce qu'il reprendra.
            p.lignes[i].compte = c.compte; p.touchee = true;
            redessinerLignes({ i, k: 'libelle' });
          }, () => (p.lignes[i] && p.lignes[i].libelle) || p.libelle || '');
        }
      });
      $$('[data-sup]', corps).forEach(b => {
        b.onclick = () => {
          const i = Number(b.dataset.sup);
          if (p.lignes.length <= 1) { p.lignes[0] = ligneVide(); } else { p.lignes.splice(i, 1); }
          p.touchee = true;
          redessinerLignes();
          signalerSaisies();
        };
      });
    }

    // L'entête : chaque champ écrit dans la pièce, aucun ne redessine la grille.
    // (1.210.0, S4) Le même numéro de pièce dans le même journal : déjà au livre. Dit pendant la frappe, et demandé avant
    // d'enregistrer : une facture saisie deux fois compte sa charge et sa TVA deux fois.
    const doublonDe = () => { const n = String(p.piece || '').trim(); return n ? (s.livre.ecritures || []).find(e => e.id !== p.id && e.statut !== 'contrepassee' && e.journal === p.journal && String(e.piece || '').trim() === n) || null : null; };
    const majDouble = () => {
      const b = $('#sa-double', el); if (!b) return;
      const d2 = doublonDe();
      b.hidden = !d2;
      b.textContent = d2 ? `Déjà au livre : ${d2.journal} ${d2.piece} du ${fmtJour(d2.date)}${d2.libelle ? ` (${d2.libelle})` : ''}. Le même numéro deux fois, c'est souvent la même pièce saisie deux fois.` : '';
    };
    const j = $('#sa-journal', el);
    if (j) j.onchange = () => { p.journal = j.value; p.touchee = true; api.dernierJournal(dossier.id, j.value).catch(() => {}); majSolde(); majDouble(); };
    // (1.174.5) Un mois dont la déclaration est déposée : l'écriture le change après coup. Dit avant le geste (la maquette
    // « Mois déjà déclaré ») ; la règle de report est À VÉRIFIER avec un comptable.
    const majDecl = () => {
      const b = $('#sa-decl', el); if (!b) return;
      const m = String(p.date || '').slice(0, 7), dc = m ? lireLivreFd(s.livre).decl[m] : null;
      b.hidden = !(dc && dc.deposee);
      if (dc && dc.deposee) b.innerHTML = `<span class="txt"><b>${esc(cap(moisLong(m)))} ${esc(m.slice(0, 4))} est déjà déclaré${dc.deposeeLe ? ` (déposée le ${esc(fmtJourCourt(KC.jourDeLInstant(dc.deposeeLe)).slice(0, 5))})` : ''}.</b><span>Cette écriture change ses livres après la déclaration : ils ne diront plus ce qui a été déposé. Une facture arrivée en retard garde sa date, et sa TVA se récupère sur une déclaration suivante (À VÉRIFIER : le délai et la façon de la reporter).</span></span>`;
    };
    majDecl();
    const dt = $('#sa-date', el);
    if (dt) {
      const lire = () => {
        const iso = K.dateTapee(dt.value, s.annee, p.date || `${s.annee}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
        p.date = iso || '';
        const ko = !!dt.value.trim() && !iso;
        dt.classList.toggle('sa-ko', ko);
        if (ko) dt.setAttribute('aria-invalid', 'true'); else dt.removeAttribute('aria-invalid');
        if (iso) dt.value = dateAffichee(iso, r);
        majSolde();
        majDecl();
      };
      dt.onblur = lire;
      // Un champ PRÉ-REMPLI se sélectionne au clic : sans ça, cliquer dedans et taper « 4/3 »
      // donne « 17/09/20264/3 », et il faut effacer à la main ce que l'application vient de
      // proposer. Le défaut est né avec la date proposée, deux corrections plus haut — c'est le
      // parcours réel qui l'a montré, jamais la relecture.
      dt.onfocus = () => dt.select();
    }
    const pc = $('#sa-piece', el); if (pc) pc.oninput = () => { p.piece = pc.value; p.touchee = true; signalerSaisies(); majDouble(); };
    majDouble();
    // 10.14.0 — l'en-tête RELIT le verdict : les lignes tapées d'abord, « Pour valider : le libellé
    // manque » restait écrit sous un libellé qu'on venait de taper, et le bouton restait éteint — un
    // état lu une fois se périme (7.1.x). Les lignes sans libellé montrent celui qu'elles reprendront.
    const lb = $('#sa-libelle', el); if (lb) lb.oninput = () => {
      p.libelle = lb.value; p.touchee = true; signalerSaisies();
      $$('input[data-k="libelle"]', corps).forEach(x => { x.placeholder = lb.value; });
      majSolde();
    };

    // L'en-tête a sa propre chaîne, et c'est ENTRÉE — la même touche que dans la grille. Tab ne
    // peut pas la faire : chaque libellé porte sa bulle « i », qui est un vrai bouton et prend donc
    // le focus au passage. Les retirer de l'ordre de tabulation rendrait l'explication
    // inatteignable au clavier, ce que ce projet s'interdit depuis la 7.0.0. On ajoute un chemin
    // au lieu d'en couper un : Entrée descend de champ en champ, jusqu'à la première ligne.
    // 10.14.1 (26/09, tapé comme un comptable) — et TAB vers l'avant fait pareil : l'aide des touches
    // annonce « Champ suivant : Tab », et un comptable tape Tab. Après la date, Tab tombait sur la
    // bulle de « Pièce » : la référence tapée partait dans un bouton, perdue sans un mot, et le
    // libellé atterrissait dans la case Pièce. Maj+Tab, lui, passe toujours par les bulles : elles
    // restent atteignables au clavier, par l'autre sens.
    const chaine = [dt, pc, lb];
    // Le journal, lui, ne prend que Tab : Entrée y ouvre la liste.
    if (j && dt) j.addEventListener('keydown', ev => {
      if (ev.key !== 'Tab' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      ev.preventDefault(); dt.focus(); dt.select();
    });
    chaine.forEach((champ, i) => {
      if (!champ) return;
      champ.addEventListener('keydown', ev => {
        const avance = ev.key === 'Tab' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
        if (!avance && toucheDe(ev) !== t.ligneSuivante) return;
        ev.preventDefault();
        if (champ === dt) champ.dispatchEvent(new Event('blur'));
        const suivant = chaine.slice(i + 1).find(Boolean);
        if (suivant) { suivant.focus(); suivant.select(); } else allerA(0, 'compte');
      });
    });

    // Les guides. Ils PRÉREMPLISSENT : après le clic, tout est encore modifiable, et rien n'est
    // enregistré. Un guide qui écrirait directement dans le livre serait un guide qu'on n'ose plus
    // utiliser.
    const gs = $('#sa-guide', el);
    if (gs) {
      gs.onchange = () => {
        const g = K.guidesDuDossier(S, dossier).find(x => x.id === gs.value);
        if (!g) return;
        // Un montant qu'on ne sait pas lire ne s'applique pas pour zéro : le guide répartirait
        // « 1 250 DT » en lignes à 0,000 sans un mot (10.14.1).
        const champM = $('#sa-guide-montant', el);
        if (champM && montantIllisible(champM.value)) { gs.value = ''; return refus(champM, motifIllisible(champM.value)); }
        const montant = lireMontant((champM || {}).value);
        const ecr = KC.ecritureDepuisGuide(g, { date: p.date, journal: g.journal, piece: p.piece, libelle: p.libelle, montant });
        p.journal = ecr.journal; p.libelle = ecr.libelle;
        p.lignes = ecr.lignes.map(l => ({
          compte: l.compte, libelle: l.libelle,
          debit: montantChamp(l.debit), credit: montantChamp(l.credit)
        }));
        p.lignes.push(ligneVide());
        p.touchee = true;
        gs.value = '';
        drawLivres(root, dossier);
      };
    }

    const jo = $('#sa-joindre', el);
    if (jo) jo.onclick = () => joindreJustificatif(root, dossier);
    const tch = $('#sa-touches', el);
    if (tch) tch.addEventListener('toggle', () => prefs.set('saTouches', tch.open));

    const dupliquerPiece = () => {
      const base = lignesReelles(p);
      if (!base.length) return;
      p.lignes = base.map(l => ({ compte: l.compte, libelle: l.libelle, debit: montantChamp(l.debit), credit: montantChamp(l.credit) }))
        .concat([ligneVide()]);
      p.id = ''; p.piece = '';
      toast('Pièce dupliquée : la nouvelle n\'a ni numéro ni pièce, tape-les.');
      drawLivres(root, dossier);
    };

    const enregistrer = async (puisValider) => {
      const ecr = ecritureSaisie(p);
      // Le contrôle porte sur le geste DEMANDÉ : valider exige un libellé, le brouillard non
      // (T-51). Sans ce drapeau, le pont refusait la validation APRÈS l'enregistrement, et l'écran
      // annonçait « Enregistrement impossible » sur une pièce pourtant bien rangée en brouillard.
      const v = verdictSaisie(p, (s.livre.plan || []).map(c => c.compte), puisValider ? { valider: true } : null);
      // Une saisie refusée se MONTRE : on amène le champ fautif à l'écran et on y met le curseur
      // (règle 7.0.0). Un message seul oblige à relire toute la grille. Un montant illisible amène
      // à SA case, pas au compte de la ligne.
      if (!v.ok) {
        const premier = v.motifs[0] || v.motif;
        const illisible = /n'est pas un montant \((débit|crédit)\)/.exec(premier);
        // Le montant illisible passe EN PREMIER : sa phrase cite ce qui est écrit dans la case, et
        // « « date » n'est pas un montant » enverrait sinon le curseur dans le champ Date.
        const ligneFautive = /Ligne (\d+)/.exec(premier);
        if (illisible && ligneFautive) allerA(Number(ligneFautive[1]) - 1, illisible[1] === 'débit' ? 'debit' : 'credit');
        else if (/date/i.test(premier) && dt) { dt.focus(); dt.classList.add('sa-ko'); dt.setAttribute('aria-invalid', 'true'); }
        else if (/journal/i.test(premier) && j) j.focus();
        else if (/libellé/i.test(premier) && lb) lb.focus();
        else if (ligneFautive) allerA(Number(ligneFautive[1]) - 1, 'compte');
        await infoDialog('Cette écriture n\'entre pas', v.motifs.join('\n'));
        return;
      }
      // « Enregistrer et valider » sans licence : on le dit AVANT d'écrire quoi que ce soit, et la
      // pièce reste dans la grille — elle s'enregistre en brouillard d'un clic (10.14.0).
      if (puisValider && await refusLicence('Valider une écriture')) return;
      const deux = doublonDe();
      if (deux && !await confirmDialog('Déjà au livre ?', `<p>${esc(deux.journal)} ${esc(deux.piece)} du ${esc(fmtJour(deux.date))} porte déjà ce numéro. L'enregistrer encore compterait la pièce deux fois.</p>`, 'L\'enregistrer quand même')) return;
      // (plateforme) 1.105.0 — sans réseau, valider attend le serveur : on le dit avant d'écrire, la pièce reste ici.
      if (puisValider && typeof api.horsLigne === 'function' && api.horsLigne()) {
        if (await confirmDialog('Valider demande le réseau', '<p>Sans réseau, une écriture se garde au brouillard de ce poste, sans numéro : elle partira seule au retour du réseau, et tu la valideras alors.</p>', 'Enregistrer en brouillard')) await enregistrer(false);
        return;
      }
      try {
        const res = p.id
          ? await api.modifierEcriture(dossier.id, s.annee, p.id, ecr)
          : await api.saisir(dossier.id, s.annee, ecr);
        s.livre = res.livre;
        const dc = p.depuisClasseur, idE = res.id || p.id;
        let jointe = false;
        if (dc && idE && !res.attente) {
          try {
            if (dc.message) await api.pieces.joindre(dossier.id, dc.message, idE); else await api.classeur.classer(dossier.id, dc.doc, true, 'jointe', idE);
            // Le classeur relira ses pièces, ses documents et ce livre en revenant (sinon il montre encore « à saisir »).
            clState.docs.delete(dossier.id); clState.livres.delete(`${dossier.id}:${s.annee}`); clState.just.clear();
            void Promise.all([relirePieces(), chargerClasseesCl(dossier, true)]).catch(() => {});
            jointe = true;
            toast(dc.retour ? `« ${dc.nom} » est jointe à son écriture : elle sort des pièces à classer.` : `« ${dc.nom} » est jointe à son écriture : le classeur la compte saisie.`);
          } catch (x) { toast(`L'écriture est enregistrée, mais « ${dc.nom} » n'a pas pu s'y joindre : ${plainError(x)}`, 'error'); }
        }
        if (puisValider) {
          const w = await api.valider(dossier.id, s.annee, idE);
          s.livre = w.livre;
          toast(`Écriture validée sous le n° ${w.numero}.`);
        } else {
          toast(res.attente ? 'Gardée sur ce poste, au brouillard : elle partira seule au serveur au retour du réseau.'
            : p.id ? 'Brouillard enregistré.' : 'Écriture enregistrée en brouillard : elle n\'a pas encore de numéro.');
        }
        // On enchaîne : même journal, même date, tout le reste vide. C'est ça, la saisie au
        // kilomètre — on ne revient jamais au menu entre deux pièces.
        saisieState.piece = pieceVide(p.journal, p.date);
        // (1.174.5) Saisie depuis les Pièces reçues : on y revient, sur la pièce suivante (la maquette « Juste après »).
        if (jointe && dc.retour) {
          toast(`« ${dc.nom} » est jointe à son écriture, ${puisValider ? 'validée' : 'au brouillard'} : elle sort des pièces à classer.`);
          navigate(dc.retour);
          return;
        }
        drawLivres(root, dossier);
        const d2 = $('#sa-piece'); if (d2) d2.focus();
        majAValider(dossier);
      } catch (e) { await infoDialog('Enregistrement impossible', plainError(e)); }
    };

    const ok = $('#sa-ok', el); if (ok) ok.onclick = () => enregistrer(false);
    const okv = $('#sa-okvalider', el); if (okv) okv.onclick = () => enregistrer(true);
    // « Vider » jetait une pièce commencée sans un mot ni un retour (U-09) : ce qui se répare laisse
    // un « Annuler » sous la main (7.12.0) — on rend la pièce telle qu'elle était, lignes comprises.
    const vd = $('#sa-vider', el);
    if (vd) vd.onclick = () => {
      const avant = saisieState.piece;
      saisieState.piece = pieceVide(p.journal, p.date);
      drawLivres(root, dossier);
      if (pieceEnCours(avant)) {
        toastUndo('Pièce vidée.', () => {
          // Rendue à SON dossier : si l'on est passé à un autre client entre-temps, elle attend là
          // où elle était, comme toute pièce commencée qu'on quitte.
          if (saisieState.dossierId === dossier.id && $('#sa-lignes')) { saisieState.piece = avant; drawLivres(root, dossier); }
          else { saisieState.enAttente[dossier.id] = avant; signalerSaisies(); }
        });
      }
    };

    $$('[data-lot-journal]', el).forEach(b => { b.onclick = () => validerUnLot(root, dossier, { journal: b.dataset.lotJournal }); });
    $$('[data-lot-mois]', el).forEach(b => { b.onclick = () => validerUnLot(root, dossier, { mois: b.dataset.lotMois }); });
    const blTout = $('#sx-bl-tout', el); if (blTout) blTout.onclick = () => { sxState.blTout = !sxState.blTout; livresState.page = 1; pageFocus = 'sa-brouillard'; drawLivres(root, dossier); };
    // (1.212.0) « Guides » : la grille au clavier, le choix du guide ouvert.
    const gd = $('#sx-guides', el); if (gd) gd.onclick = () => { sxState.mode = 'km'; drawLivres(root, dossier); const g = $('#sa-guide'); if (g) { g.focus(); g.scrollIntoView({ block: 'center' }); if (typeof g.showPicker === 'function') { try { g.showPicker(); } catch { /* sans geste direct : le champ a le curseur */ } } } };
    // « + Ajouter une ligne » (T-32) : le clavier reste le chemin rapide (Entrée sur la dernière
    // ligne), la souris cesse d'être un cul-de-sac — chaque ligne offrait déjà son « ✕ ».
    const aj = $('#sa-ajouter', el);
    if (aj) aj.onclick = () => { p.lignes.push(ligneVide()); redessinerLignes({ i: p.lignes.length - 1, k: 'compte' }); };

    brancherLignes();
    majSolde();

    // Les actions d'un brouillard : une seule porte par ligne (règle 7.29.0), et chaque action
    // porte une phrase entière.
    bindRowMenus(el, cle => {
      if (String(cle).startsWith('A:')) return actionsAbonnement(root, dossier, cle);
      if (!String(cle).startsWith('B:')) return [];
      const e = ecritureDuLivre(s.livre, String(cle).slice(2));
      return e ? actionsEcriture(root, dossier, e) : [];
    });
  }

  // Une écriture rangée, reprise dans la grille. Les montants redeviennent du TEXTE : la grille est
  // faite de champs, et un zéro affiché « 0 » dans une colonne vide se retaperait à chaque pièce.
  const pieceDepuis = e => ({
    id: e.id, date: e.date, journal: e.journal, piece: e.piece, libelle: e.libelle,
    pieceJointe: e.pieceJointe || null,
    // Le tiers et le lettrage de chaque ligne voyagent avec elle, sans case à l'écran : reprise dans
    // la grille puis enregistrée, une ligne de règlement client perdait son tiers (10.14.1).
    lignes: (e.lignes || []).map(l => ({
      compte: l.compte, libelle: l.libelle,
      debit: montantChamp(l.debit), credit: montantChamp(l.credit),
      tiers: l.tiers || '', tiersId: l.tiersId || null, lettre: l.lettre || ''
    })).concat([ligneVide()])
  });

  async function supprimerBrouillard(root, dossier, e) {
    const ok = await confirmDialog('Supprimer ce brouillard ?',
      `<p>${esc(e.journal)} ${esc(e.piece || '(sans pièce)')} du ${esc(fmtJour(e.date))}.</p>${ceQuellePorte(e, 'il')}<p>Il n'a pas de numéro : il ne laissera aucun trou dans la numérotation, et rien n'en restera.</p>`,
      'Supprimer', true);
    if (!ok) return;
    try {
      const r = await api.supprimerEcriture(dossier.id, livresState.annee, e.id);
      livresState.livre = r.livre;
      if (saisieState.piece && saisieState.piece.id === e.id) saisieState.piece = null;
      toast('Brouillard supprimé.');
      drawLivres(root, dossier);
    } catch (err) { await infoDialog('Suppression impossible', plainError(err)); }
  }

  async function joindreJustificatif(root, dossier, ecritureId) {
    const s = livresState;
    // Sans écriture rangée, on joint à la pièce EN COURS : le justificatif se regarde pendant qu'on
    // saisit, pas après (règle 8.5.1, apprise sur l'app entreprise). Il faut donc l'enregistrer
    // d'abord, et on le dit.
    let id = ecritureId;
    if (!id) {
      if (!saisieState.piece || !saisieState.piece.id) {
        const suite = await confirmDialog('Enregistrer d\'abord ?',
          '<p>Un justificatif se range avec une écriture. Celle-ci n\'est pas encore enregistrée.</p><p>Je l\'enregistre en brouillard, puis j\'ouvre le sélecteur de fichier — elle reste modifiable.</p>',
          'Enregistrer et joindre');
        if (!suite) return;
        const ecr = ecritureSaisie(saisieState.piece);
        const v = verdictSaisie(saisieState.piece, (s.livre.plan || []).map(c => c.compte));
        if (!v.ok) { await infoDialog('Cette écriture n\'entre pas', v.motifs.join('\n')); return; }
        try {
          const res = await api.saisir(dossier.id, s.annee, ecr);
          s.livre = res.livre; saisieState.piece.id = res.id; id = res.id;
        } catch (e) { await infoDialog('Enregistrement impossible', plainError(e)); return; }
      } else id = saisieState.piece.id;
    }
    try {
      const r = await api.joindreEcriture({ dossierId: dossier.id, annee: s.annee, id });
      if (r.annule) return;
      s.livre = r.livre;
      if (saisieState.piece && saisieState.piece.id === id) saisieState.piece.pieceJointe = r.pieceJointe;
      toast('Justificatif joint et copié dans le dossier du client.');
      drawLivres(root, dossier);
    } catch (e) { await infoDialog('Justificatif impossible', plainError(e)); }
  }

  // Valider un lot. On DIT d'abord combien de pièces sont concernées : « valider » est irréversible,
  // et un bouton qui en validerait trente sans le dire serait un piège.
  async function validerUnLot(root, dossier, filtre) {
    const s = livresState;
    const toutes = (s.livre.ecritures || []).filter(e => e.statut === 'brouillard'
      && (!filtre.journal || e.journal === filtre.journal)
      && (!filtre.mois || String(e.date || '').slice(0, 7) === filtre.mois) && String(e.date || '') <= K.today());
    // (1.220.0, épreuve d'un mois) Une écriture dont la date est demandée au client reste au brouillard : validée, elle ne
    // changerait plus de mois, et la demande deviendrait sans objet.
    const enDemande = toutes.filter(e => achatSx(e) && dateDemandeeSx(dossier, e));
    const cibles = toutes.filter(e => !enDemande.includes(e));
    if (!cibles.length) { await infoDialog('Rien à valider', enDemande.length ? `${enDemande.map(e => e.piece || e.libelle).join(', ')} : sa date est demandée au client ; elle se validera une fois corrigée.` : 'Aucune écriture en brouillard ne correspond.'); return; }
    if (await refusLicence('Valider un lot d\'écritures')) return;
    // (1.217.0, maquette) « de septembre » : l'exercice est déjà dans la page.
    const quoi = filtre.journal ? `du journal ${filtre.journal}` : String(filtre.mois).slice(0, 4) === String(s.annee) ? deMois(filtre.mois) : KC.deMois(moisLabelCourt(filtre.mois));
    // L'accord suit le nombre (10.12.0, vu au test humain) : « Chacune… Celles qui… » sous « Valider
    // 1 écriture » se lisait comme un modèle de phrase qu'on n'a pas fini de remplir.
    const une = cibles.length === 1;
    // (plateforme) 1.125.0 — un achat du client sans justificatif se dit avant de valider (revue du mois d'un client,
    // point 8) : on peut valider quand même, ou le demander d'abord depuis la ligne.
    const sansJustif = cibles.filter(e => e.justifClient === false);
    const avert = sansJustif.length ? `<p class="small" id="lot-sans-justif"><b>${sansJustif.length > 1 ? `${sansJustif.length} achats du client n'ont pas de justificatif` : 'Un achat du client n\'a pas de justificatif'}</b> : ${sansJustif.slice(0, 5).map(e => esc(e.piece || e.libelle || '—')).join(', ')}${sansJustif.length > 5 ? '…' : ''}. Tu peux valider quand même, ou le lui demander d'abord (le menu de la ligne, « Demander le justificatif »).</p>` : '';
    // (1.212.0, S8) La fenêtre LISTE ce qu'elle valide (pièce, libellé, montant), dit les cas à part (le compte d'attente),
    // et vérifie AVANT : l'équilibre de chacune, aucun mois déposé. Le bouton dit combien.
    const fausses = cibles.filter(e => !KC.soldeDeLignes(e.lignes).equilibre);
    const decl = lireLivreFd(s.livre).decl;
    const deposes = cibles.filter(e => decl[String(e.date || '').slice(0, 7)] && decl[String(e.date || '').slice(0, 7)].deposee);
    const enAttente = cibles.filter(attenteBl);
    const qui = prenomCl(dossier.contact) || 'le client';
    const liste = `<div class="lot-l-w"><table class="list compact lot-l" id="lot-liste"><tbody>${cibles.slice(0, 12).map(e => `<tr><td class="nw mono">${esc(e.piece || '—')}</td><td>${esc(e.libelle || '')}</td><td class="r nw">${esc(montant(KC.soldeDeLignes(e.lignes).debit))}</td></tr>`).join('')}${cibles.length > 12 ? `<tr><td colspan="3" class="muted small">et ${cibles.length - 12} autres</td></tr>` : ''}</tbody></table></div>`;
    // (1.217.0, maquette « valider ») Le compte d'attente en encadré ambre : ce qui arrive après, sans rien modifier.
    const cas = enAttente.length ? `<div class="bandeau ambre lot-cas" id="lot-attente">${EC_IC.alerte}<span class="txt"><b>${esc(enAttente.slice(0, 3).map(e => e.piece || e.libelle || '—').join(', '))}${enAttente.length > 3 ? '…' : ''} ${enAttente.length > 1 ? 'passent' : 'passe'} par le compte d'attente</b><span>${enAttente.length > 1 ? 'Validées, elles y restent' : 'Validée, elle y reste'} jusqu'à ce que ${dossier.manual ? 'tu saches ce que c\'est' : `${esc(qui)} dise ce que c'est`} ; « Imputer » ${enAttente.length > 1 ? 'les corrigera' : 'la corrigera'} par une écriture, sans ${enAttente.length > 1 ? 'les' : 'la'} modifier.</span></span></div>` : '';
    const verif = !fausses.length && !deposes.length
      ? `<p class="small lot-ok" id="lot-verif">${une ? 'Elle est équilibrée et ne tombe pas sur un mois déposé.' : 'Toutes sont équilibrées ; aucune ne tombe sur un mois déposé.'}</p>`
      : `<p class="small" id="lot-verif">${fausses.length ? `${pl(fausses.length, 'ne tombe pas juste', 'ne tombent pas juste')}` : ''}${fausses.length && deposes.length ? ' ; ' : ''}${deposes.length ? `${pl(deposes.length, 'tombe sur un mois déposé', 'tombent sur un mois déposé')}` : ''} : ${fausses.length + deposes.length > 1 ? 'elles ne seront pas validées, et te seront nommées' : 'elle ne sera pas validée, et te sera nommée'}.</p>`;
    const ok = await confirmDialog(`Valider ${une ? 'l\'écriture' : `les ${cibles.length} écritures`} ${quoi} ?`,
      `<div class="lot-fen">${liste}${enDemande.length ? `<div class="bandeau ambre lot-cas" id="lot-demande">${EC_IC.alerte}<span class="txt"><b>${esc(enDemande.map(e => e.piece || e.libelle || '—').join(', '))} ${enDemande.length > 1 ? 'restent' : 'reste'} au brouillard</b><span>${enDemande.length > 1 ? 'Leur date est demandée' : 'Sa date est demandée'} à ${esc(prenomCl(dossier.contact) || 'le client')} : ${enDemande.length > 1 ? 'validées, elles ne changeraient' : 'validée, elle ne changerait'} plus de mois.</span></span></div>` : ''}${cas}${une
        ? '<p class="small muted lot-regle">Une écriture validée reçoit son numéro et ne se modifie plus : une erreur se contre-passe.</p>'
        : '<p class="small muted lot-regle">Chacune reçoit son numéro et ne se modifie plus : une erreur se contre-passe.</p>'}${verif}${avert}</div>`,
      une ? 'Valider l\'écriture' : `Valider les ${cibles.length} écritures`);
    if (!ok) return;
    try {
      const r = await api.validerLot({ dossierId: dossier.id, annee: s.annee, journal: filtre.journal, mois: filtre.mois, ids: cibles.map(e => e.id) });
      s.livre = r.livre;
      // Les numéros pris se DISENT : c'est ce que le comptable reporte sur la pièce papier, et « 3
      // écritures validées » l'obligeait à rouvrir le journal pour les lire (vu au test humain).
      const nums = r.validees.map(x => Number(x.numero)).filter(n => n > 0).sort((a, b) => a - b);
      const plage = !nums.length ? '' : nums.length === 1 ? ` sous le n° ${nums[0]}`
        : nums[nums.length - 1] - nums[0] === nums.length - 1 ? ` sous les n° ${nums[0]} à ${nums[nums.length - 1]}`
          : ` sous les n° ${nums.join(', ')}`;
      const lignes = [`${pl(r.validees.length, 'écriture validée', 'écritures validées')}${plage}.`];
      if (r.refusees.length) {
        // L'accord suit le nombre, et la date s'écrit comme à l'écran (U-28) : « 1 écriture n'est pas
        // entrée — elles restent en brouillard », « du 2026-08-31 », vus en relisant ce message.
        const plus = r.refusees.length > 1;
        lignes.push(`${pl(r.refusees.length, 'écriture n\'est pas entrée', 'écritures ne sont pas entrées')} — ${plus ? 'elles restent' : 'elle reste'} en brouillard :`);
        r.refusees.slice(0, 10).forEach(x => lignes.push(`  • ${x.journal} ${x.piece || '(sans pièce)'} du ${fmtJour(x.date)} : ${x.motif}`));
      }
      if (r.refusees.length) await infoDialog('Validation', lignes.join('\n'));
      else {
        // (plateforme) 1.131.0 — tout est entré : ce qui reste au brouillard des mois validés, tous journaux confondus, ou
        // l'étape suivante (revue du mois d'un client, point 18 : la validation finissait sur une fenêtre à fermer).
        const mois = new Set(cibles.map(e => String(e.date || '').slice(0, 7)));
        const reste = (s.livre.ecritures || []).filter(e => e.statut === 'brouillard' && mois.has(String(e.date || '').slice(0, 7))).length;
        const deQuand = mois.size === 1 ? KC.deMois(moisLabelCourt([...mois][0])) : 'de ces mois';
        toast(`${lignes[0]} ${reste ? `${pl(reste, 'autre reste', 'autres restent')} au brouillard ${deQuand}.`
          : `Prochaine étape : la déclaration, dans « Déclarer et clôturer ».`}`);
      }
      drawLivres(root, dossier);
      majAValider(dossier);
    } catch (e) { await infoDialog('Validation impossible', plainError(e)); }
  }

  // ---------------------------------------------------------------- les abonnements (9.3.0)
  //
  // Un abonnement = un guide + une périodicité. Il vit sur le DOSSIER : un loyer appartient à un
  // client, pas au cabinet. Il génère EN BROUILLARD, jamais une validée d'office — une écriture que
  // personne n'a regardée ne doit pas engager la signature du comptable.
  function dessinerAbonnements(root, dossier) {
    const box = $('#d-abos', root);
    if (!box) return;
    const abos = dossier.abonnements || [];
    const guides = K.guidesDuDossier(S, dossier);
    if (!guides.length) {
      // (plateforme) 1.76.0 — « abonnement » se lisait comme celui de SkanFact (recette du 20/10/2026) : une écriture qui revient.
      box.innerHTML = `<div class="sa-vide">Une écriture qui revient s'appuie sur un guide d'écritures, et il n'y en a aucun pour l'instant.</div>
        <div class="modal-actions"><button type="button" class="btn" id="ab-guides">Écrire un premier guide…</button></div>`;
      const b = $('#ab-guides', box);
      if (b) b.onclick = () => versReglages('pan-guides');
      return;
    }
    box.innerHTML = `${abos.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
        <th>Nom</th><th>Guide</th><th class="nw">Depuis</th><th class="nw">Tous les</th>
        <th class="r nw">Montant</th><th class="nw">État</th><th></th></tr></thead>
      <tbody>${abos.map(a => {
        const g = guides.find(x => x.id === a.guideId);
        const reste = KC.occurrencesAGenerer(a, K.today()).length;
        return `<tr data-ab="${esc(a.id)}">
          <td>${esc(a.nom || '')}</td>
          <td>${g ? esc(g.nom) : '<span class="err-inline">guide supprimé</span>'}</td>
          <td class="nw">${esc(a.depuis || '—')}</td>
          <td class="nw">${a.tousLesMois > 1 ? `${a.tousLesMois} mois` : 'mois'}</td>
          <td class="r nw">${esc(montant(Number(a.montant) || 0))}</td>
          <td class="nw">${!a.actif ? '<span class="muted">suspendu</span>' : reste ? `<b>${pl(reste, 'à générer', 'à générer')}</b>` : '<span class="muted">à jour</span>'}</td>
          ${RowMenu.cellule('A:' + a.id, '')}</tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="sa-vide">Aucune écriture qui revient. C'est ce qui évite de ressaisir le loyer tous les mois.</div>`}
      <div class="modal-actions">
        ${abos.some(a => a.actif && KC.occurrencesAGenerer(a, K.today()).length)
          ? '<button type="button" class="btn btn-primary" id="ab-gen">Générer ce qui manque</button>' : ''}
        <button type="button" class="btn" id="ab-new">Nouvelle écriture qui revient…</button></div>`;
    const nw = $('#ab-new', box); if (nw) nw.onclick = () => abonnementForm(root, dossier, null);
    const gen = $('#ab-gen', box);
    if (gen) gen.onclick = () => genererAbonnements(root, dossier);
    // (plateforme) La saisie branche ses menus AVANT que ce panneau soit dessiné : ses lignes se
    // branchent ici, le panneau étant leur racine (une table d'actions par racine, 9.4.8).
    bindRowMenus(box, cle => actionsAbonnement(root, dossier, cle));
  }

  function actionsAbonnement(root, dossier, cle) {
    const a = (dossier.abonnements || []).find(x => x.id === String(cle).slice(2));
    if (!a) return [];
    return [
      { icon: 'modifier', label: 'Modifier cette écriture qui revient', hint: 'Son guide, son montant, sa période', run: () => abonnementForm(root, dossier, a) },
      a.actif
        ? { icon: 'pause', label: 'Suspendre cette écriture qui revient', hint: 'Elle cesse de se proposer', run: () => basculerAbo(root, dossier, a, false) }
        : { icon: 'reprendre', label: 'Reprendre cette écriture qui revient', hint: 'Elle recommence à se proposer', run: () => basculerAbo(root, dossier, a, true) }
    ];
  }

  async function basculerAbo(root, dossier, abo, actif) {
    const liste = (dossier.abonnements || []).map(a => a.id === abo.id ? { ...a, actif } : a);
    try {
      S = await api.saveAbonnements(dossier.id, liste);
      // (plateforme) 1.77.0 — le même nom que son titre et son menu (1.76.0 : « Écritures qui reviennent »).
      toast(actif ? 'Écriture qui revient reprise.' : 'Écriture qui revient suspendue.');
      render();
    } catch (e) { toast(plainError(e), 'error'); }
  }

  async function genererAbonnements(root, dossier) {
    const annee = livresState.annee || String(new Date().getFullYear());
    try {
      const r = await api.genererAbonnements({ dossierId: dossier.id, annee, jusquA: K.today() });
      livresState.livre = r.livre;
      const lignes = [`${pl(r.crees, 'écriture créée', 'écritures créées')} en brouillard.`];
      if (r.crees) lignes.push('Elles n\'ont pas de numéro : relis-les, puis valide-les.');
      if (r.horsExercice) lignes.push(`${pl(r.horsExercice, 'occurrence tombait', 'occurrences tombaient')} hors de l'exercice ${annee} : elles se génèreront dans le livre de leur année.`);
      if (r.sansGuide.length) lignes.push(`Guide introuvable pour : ${r.sansGuide.join(', ')}.`);
      await infoDialog('Écritures qui reviennent', lignes.join('\n\n'));
      render();
    } catch (e) { await infoDialog('Génération impossible', plainError(e)); }
  }

  function abonnementForm(root, dossier, abo) {
    const guides = K.guidesDuDossier(S, dossier);
    const a = abo ? { ...abo } : {
      id: '', nom: '', guideId: (guides[0] || {}).id || '', actif: true,
      depuis: `${new Date().getFullYear()}-01-01`, jusqua: '', tousLesMois: 1, montant: 0, piece: '', libelle: '', faites: []
    };
    modal(
      `<h2>${abo ? 'Modifier l\'écriture qui revient' : 'Nouvelle écriture qui revient'}</h2>
       <div class="grid-2">
         <label class="field obligatoire">${lbl('Nom', 'sa.abNom')}<input type="text" id="ab-nom" value="${esc(a.nom)}" placeholder="Loyer du local"></label>
         <label class="field obligatoire">${lbl('Guide', 'sa.abGuide')}<select id="ab-guide">${guides.map(g => `<option value="${esc(g.id)}" ${a.guideId === g.id ? 'selected' : ''}>${esc(g.nom)}</option>`).join('')}</select></label>
         <label class="field narrow obligatoire">${lbl('Depuis', 'sa.abDepuis')}<input type="date" id="ab-depuis" value="${esc(a.depuis)}"></label>
         <label class="field narrow">${lbl('Jusqu\'à', 'sa.abJusqua')}<input type="date" id="ab-jusqua" value="${esc(a.jusqua || '')}"></label>
         <label class="field narrow">${lbl('Tous les (mois)', 'sa.abPas')}<input type="number" id="ab-pas" min="1" max="12" value="${Number(a.tousLesMois) || 1}"></label>
         <label class="field narrow obligatoire">${lbl('Montant (DT)', 'sa.abMontant')}<input type="text" id="ab-montant" class="num montant" inputmode="decimal" value="${esc(montantChamp(a.montant))}"></label>
         <label class="field">${lbl('Préfixe de pièce', 'sa.abPiece')}<input type="text" id="ab-piece" value="${esc(a.piece || '')}" placeholder="LOYER"></label>
         <label class="field">${lbl('Libellé', 'sa.abLibelle')}<input type="text" id="ab-libelle" value="${esc(a.libelle || '')}" placeholder="Loyer du local"></label>
       </div>
       <p class="muted small">La génération crée les écritures manquantes <strong>en brouillard</strong>, jusqu'à aujourd'hui. Relancer ne double rien : les mois déjà générés sont retenus.</p>
       <div class="modal-actions">
         ${abo ? '<button class="btn btn-danger" id="ab-sup">Supprimer</button>' : ''}
         <button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (layer, close) => {
        $('#no', layer).onclick = close;
        const ecrire = async liste => {
          try { S = await api.saveAbonnements(dossier.id, liste); close(); render(); toast('Écriture qui revient enregistrée.'); }
          catch (e) { toast(plainError(e), 'error'); }
        };
        const sup = $('#ab-sup', layer);
        if (sup) {
          sup.onclick = async () => {
            const ok = await confirmDialog('Supprimer cette écriture qui revient ?',
              `<p>« ${esc(a.nom)} » ne se proposera plus.</p><p>Les écritures qu'elle a déjà créées ne bougent pas : elles vivent leur vie dans le livre.</p>`, 'Supprimer', true);
            if (ok) ecrire((dossier.abonnements || []).filter(x => x.id !== a.id));
          };
        }
        $('#ok', layer).onclick = () => {
          const nom = $('#ab-nom', layer).value.trim();
          if (!nom) return refus($('#ab-nom', layer), 'Donne-lui un nom : c\'est lui que tu liras dans la liste (« Loyer du local »).');
          const depuis = $('#ab-depuis', layer).value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(depuis)) return refus($('#ab-depuis', layer), 'Il faut une date de départ : c\'est elle qui dit à partir de quel mois générer.');
          const montant = lireMontant($('#ab-montant', layer).value);
          if (!Number.isFinite(montant) || montant <= 0) return refus($('#ab-montant', layer), 'Le montant doit être un nombre positif : c\'est lui que le guide répartit.');
          const neuf = {
            ...a, nom, guideId: $('#ab-guide', layer).value, depuis,
            jusqua: $('#ab-jusqua', layer).value || '',
            tousLesMois: Math.max(1, Number($('#ab-pas', layer).value) || 1),
            montant, piece: $('#ab-piece', layer).value.trim(), libelle: $('#ab-libelle', layer).value.trim(),
            actif: a.actif !== false
          };
          if (!neuf.id) neuf.id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
          const autres = (dossier.abonnements || []).filter(x => x.id !== neuf.id);
          ecrire(autres.concat([neuf]));
        };
      }
    );
  }

  // ---------------------------------------------------------------- la recherche (SPEC-UI-CAB-013)
  //
  // Chercher dans TOUT le journal de l'exercice, pas seulement dans la période affichée : on cherche
  // justement parce qu'on ne sait plus quand c'était. Le moteur est `compta.chercherEcritures` —
  // pur, testé, et il lit aussi bien un libellé qu'un montant.
  const rechState = { q: '', journal: '', statut: '' };

  function vueRecherche(/* lignes */) {
    const s = livresState;
    if (!s.livre) return '<div class="empty">La recherche a besoin d\'un livre.</div>';
    const trouvees = rechState.q.trim() || rechState.journal || rechState.statut
      ? KC.chercherEcritures(s.livre, rechState.q, { journal: rechState.journal, statut: rechState.statut, max: 200 })
      : [];
    const total = (s.livre.ecritures || []).length;
    return `<div class="filters mb">
        <input type="search" id="re-q" placeholder="Pièce, tiers, libellé, compte, numéro, montant…" value="${esc(rechState.q)}" style="min-width:280px">
        <select id="re-journal" aria-label="Le journal"><option value="">Tous les journaux</option>${(s.livre.journaux || []).map(j => `<option value="${esc(j.code)}" ${rechState.journal === j.code ? 'selected' : ''}>${esc(j.code)}</option>`).join('')}</select>
        <select id="re-statut" aria-label="L'état des écritures"><option value="">Brouillard et validées</option>
          <option value="brouillard" ${rechState.statut === 'brouillard' ? 'selected' : ''}>Brouillard seulement</option>
          <option value="validee" ${rechState.statut === 'validee' ? 'selected' : ''}>Validées seulement</option>
          <option value="contrepassee" ${rechState.statut === 'contrepassee' ? 'selected' : ''}>Contre-passées</option></select>
      </div>
      ${!rechState.q.trim() && !rechState.journal && !rechState.statut
        ? `<div class="empty"><p>Tape ce que tu cherches.</p><p class="muted small">${pl(total, 'écriture')} dans le livre de ${esc(s.annee)}. Un montant se cherche aussi : « 1191 » ou « 1191,000 ».</p></div>`
        : !trouvees.length
          ? `<div class="empty"><p>Rien ne correspond.</p><p class="muted small">La recherche porte sur toute l'année, pas seulement sur la période affichée en haut.</p></div>`
          // « 1 écriture trouvée sur 49 écritures » répétait le mot des deux côtés du « sur » :
          // un bandeau « n sur N » se lit d'un coup d'oeil, c'est sa raison d'être (T-54).
          : `<div class="muted small mb">${pl(trouvees.length, 'écriture trouvée', 'écritures trouvées')} sur ${total}${trouvees.length >= 200 ? ' — affichage limité aux 200 premières, précise ta recherche' : ''}.</div>
        <div class="scroll-x"><table class="list compact"><thead><tr>
          <th class="r nw">N°</th><th class="nw">Date</th><th>Journal</th><th class="nw">Pièce</th><th>Libellé</th>
          <th class="r nw">Total</th><th class="nw">État</th><th></th></tr></thead>
        <tbody>${trouvees.map(e => {
          const t = KC.soldeDeLignes(e.lignes);
          return `<tr data-re="${esc(e.id)}" class="${e.statut === 'brouillard' ? 'br-ligne' : e.statut === 'contrepassee' ? 'cp-ligne' : ''}">
            <td class="r nw">${e.numero == null ? '—' : e.numero}</td><td class="nw">${esc(fmtJour(e.date))}</td>
            <td>${esc(e.journal)}</td><td class="nw">${esc(e.piece || '—')}${marqueJustif(e, e.pieceJointe)}</td>
            <td>${esc(e.libelle || '')}</td>
            <td class="r nw">${esc(montant(t.debit))}</td>
            <td class="nw">${e.statut === 'brouillard' ? '<i>brouillard</i>' : e.statut === 'contrepassee' ? 'contre-passée' : 'validée'}</td>
            ${RowMenu.cellule('R:' + e.id, '')}</tr>`;
        }).join('')}</tbody></table></div>`}`;
  }

  // Un champ de recherche redessiné à la frappe perd le curseur, et on n'y tape qu'une lettre
  // (7.17.0). On le rend À SA PLACE, sélection comprise — pas au bout : corriger une faute au milieu
  // d'un mot renvoyait le curseur à la fin. UNE fonction pour tous les champs : la parade était
  // recopiée à deux endroits, et le troisième (le livre-journal) l'avait oubliée.
  function sansPerdreLaFrappe(champ, redessin) {
    const id = champ.id, debut = champ.selectionStart, fin = champ.selectionEnd;
    redessin();
    const n = document.getElementById(id);
    if (!n) return;
    if (document.activeElement !== n) n.focus();
    try { n.setSelectionRange(debut, fin); } catch (_) { /* un champ sans sélection : rien à rendre */ }
  }

  function brancherRecherche(el, root, dossier) {
    const s = livresState;
    const q = $('#re-q', el);
    if (q) {
      // On redessine à la frappe, mais le champ de recherche est REMIS et le curseur replacé au
      // bout : sans ça on ne peut taper qu'une lettre (défaut 7.17.0).
      q.oninput = () => { rechState.q = q.value; sansPerdreLaFrappe(q, () => drawLivres(root, dossier)); };
    }
    const j = $('#re-journal', el); if (j) j.onchange = () => { rechState.journal = j.value; drawLivres(root, dossier); };
    const st = $('#re-statut', el); if (st) st.onchange = () => { rechState.statut = st.value; drawLivres(root, dossier); };
    bindRowMenus(el, cle => {
      if (!String(cle).startsWith('R:') || !s.livre) return [];
      const e = ecritureDuLivre(s.livre, String(cle).slice(2));
      if (!e) return [];
      return actionsEcriture(root, dossier, e);
    });
  }

  // Une écriture retrouvée par son identifiant, dans un index tenu une fois par livre. Chaque menu de
  // ligne la cherchait dans TOUT le livre : un lettrage de 1 700 lignes sur un livre de 12 000 pièces
  // faisait vingt millions de comparaisons, 1,2 s à chaque dessin (10.14.0, saturation). L'index se
  // refait dès que la liste change de taille ou d'objet ; une validation modifie l'écriture SUR
  // place, et l'index pointe sur ce même objet.
  const INDEX_LIVRE = new WeakMap();
  function indexDuLivre(livre) {
    const ec = (livre && livre.ecritures) || [];
    let x = livre ? INDEX_LIVRE.get(livre) : null;
    if (!x || x.ec !== ec || x.n !== ec.length) {
      x = { ec, n: ec.length, parId: new Map(ec.map(e => [e.id, e])), extournees: new Set(ec.filter(e => e.extourneDe).map(e => e.extourneDe)) };
      if (livre) INDEX_LIVRE.set(livre, x);
    }
    return x;
  }
  const ecritureDuLivre = (livre, id) => indexDuLivre(livre).parId.get(id) || null;

  // Les actions d'une écriture, à UN endroit. Elles sont les mêmes depuis la recherche, le
  // livre-journal et le brouillard — trois tables séparées auraient divergé au premier ajout, et
  // c'est exactement le défaut que la 7.29.0 a trouvé sur le devis déjà facturé.
  function actionsEcriture(root, dossier, e) {
    const a = [];
    // Le geste qui DÉTRUIT vit tout en bas, après un trait (7.29.0). Vu au test humain (10.12.0) :
    // posé au milieu, « Supprimer ce brouillard » était la ligne juste au-dessus de « Joindre un
    // justificatif… » — un clic qui glisse d'une ligne efface une pièce au lieu d'y joindre un scan.
    let detruire = null;
    if (e.statut === 'brouillard') {
      // (plateforme) 1.100.0 — une pièce venue de SkanFact ne se reprend pas dans la grille : ses lignes se lisent au
      // livre-journal, le brouillard compté et cherché sur sa pièce. Le geste vient avant « Valider » : on regarde, puis on
      // valide. Depuis le brouillard de la saisie seulement : au livre-journal, ses lignes sont déjà sous les yeux.
      if (e.source === 'skanfact' && livresState.onglet === 'saisie') a.push({ icon: 'loupe', label: 'Voir ses lignes', hint: 'Au livre-journal, avant de la valider',
        run: () => { const s = livresState; s.brouillard = true; s.q = e.piece || ''; s.journal = ''; s.page = 1; allerSousOnglet(root, dossier, 'journal'); } });
      a.push({ icon: 'oui', label: 'Valider cette écriture', hint: 'Elle prend son numéro et ne se modifiera plus',
        run: () => validerEcriture(root, dossier, e) });
      // (plateforme) 1.102.0 — datée après aujourd'hui (l'écriture de paie, au dernier jour du mois), elle ne se valide pas
      // encore : le geste se grise et dit son jour, au lieu d'un refus après le clic.
      if (String(e.date || '') > K.today()) Object.assign(a[a.length - 1], { hint: `À partir du ${fmtJour(e.date)}, sa date`, off: true,
        run: () => infoDialog(`Pas avant le ${fmtJour(e.date)}`, `Cette écriture est datée du ${fmtJour(e.date)} : une écriture ne se valide pas avant sa date, son numéro suit l'ordre des jours. Elle reste au brouillard et se valide à partir de ce jour-là.`) });
      // (plateforme) 1.105.0 — gardée sur ce poste sans réseau (docs/hors-ligne.md, H15) : elle part d'abord au serveur.
      if (e.attente) Object.assign(a[a.length - 1], { hint: 'Une fois partie au serveur, au retour du réseau', off: true,
        run: () => infoDialog('Elle attend le réseau', 'Cette écriture est gardée sur ce poste : elle part seule au serveur au retour du réseau, puis se valide comme les autres. D\'ici là, tu peux la reprendre dans la grille ou la supprimer.') });
      if (e.source !== 'skanfact') a.push({ icon: 'modifier', label: 'Reprendre dans la grille', hint: 'Elle remonte dans la saisie, modifiable',
        run: () => { saisieState.piece = pieceDepuis(e); allerSousOnglet(root, dossier, 'saisie'); } });
      if (e.source !== 'skanfact') detruire = { icon: 'supprimer', label: 'Supprimer ce brouillard', hint: 'Il n\'a pas de numéro : rien ne restera', danger: true,
        run: () => supprimerBrouillard(root, dossier, e) };
    }
    if (e.statut === 'validee' && e.source !== 'skanfact' && !e.contrepasseDe) {
      // Le jour du miroir se dit dès le menu, par la fonction qui le posera : « à la date du jour »
      // sur un exercice passé était faux — le miroir tombe au dernier jour de l'exercice.
      const jour = K.today();
      const dm = KC.dateDuMiroir(livresState.livre, e, jour);
      a.push({ icon: 'contrat', label: 'Contre-passer cette écriture', hint: dm === jour ? 'Une écriture miroir, à la date du jour' : `Une écriture miroir, au ${fmtJour(dm)}`,
        run: () => contrepasserEcriture(root, dossier, e) });
      // Une écriture de DÉCEMBRE ne s'extourne pas dans ce livre : son extourne tombe au 1er janvier,
      // dans l'exercice suivant. On ne PROPOSE pas le geste qui sera refusé (C-06) : on propose
      // celui qui marche — la prévoir, pour qu'« Ouvrir N+1 » la pose.
      // Ni des à-nouveaux (ils ouvrent l'exercice : rien à défaire au 1er février), ni un MIROIR
      // (l'extourne d'une contre-passation rétablirait l'erreur un mois plus tard) : l'extourne est
      // le geste des charges à payer et des produits à recevoir, et de rien d'autre (10.14.0).
      const extournable = e.source !== 'an' && !e.contrepasseDe && !e.extourneDe;
      const dejaExt = indexDuLivre(livresState.livre).extournees.has(e.id);
      const dateExt = KC.premierDuMoisSuivant(e.date);
      const auSuivant = false;
      const suivante = Number((livresState.livre.exercice || {}).annee) + 1;
      if (extournable && !dejaExt && !auSuivant) {
        a.push({ icon: 'horloge', label: 'Extourner au 1er du mois suivant', hint: 'Pour une charge à payer ou un produit à recevoir',
          run: () => extournerEcriture(root, dossier, e) });
      } else if (extournable && !dejaExt && !e.extourne) {
        a.push({ icon: 'horloge', label: `Extourner à l'ouverture de ${suivante}`, hint: `Elle sera posée au ${fmtJour(dateExt)}, dans le livre de ${suivante}`,
          run: () => prevoirExtourneEcriture(root, dossier, e, dateExt, suivante) });
      }
    }
    a.push({ icon: 'texte', label: e.pieceJointe ? 'Remplacer le justificatif…' : 'Joindre un justificatif…',
      court: 'Justificatif…',
      hint: 'Le fichier est copié dans le dossier du client', run: () => joindreJustificatif(root, dossier, e.id) });
    // (plateforme) 1.105.0 — la pièce n'est pas encore au serveur : son justificatif attend qu'elle y soit.
    if (e.attente) Object.assign(a[a.length - 1], { hint: 'Une fois partie au serveur, au retour du réseau', off: true,
      run: () => infoDialog('Elle attend le réseau', 'Cette écriture est gardée sur ce poste : son justificatif se joint une fois qu\'elle est partie au serveur, au retour du réseau.') });
    a.push(...actionsJustifsClient(e));
    // (plateforme) 1.135.0 — l'achat du client porte un justificatif : il s'ouvre d'ici (il n'était que dans le fil).
    if (e.justifClient === true && !e.attente && api.justificatifsEcriture) {
      a.push({ icon: 'ouvrir', label: 'Ouvrir le justificatif du client', court: 'Justificatif',
        hint: `Joint par ${dossier.name} à son achat, dans SkanFact`, run: () => ouvrirJustifEnLigne(dossier, e) });
    }
    // (plateforme) 1.125.0 — l'achat du client n'a pas de justificatif : le réclamer d'ici, la pièce citée d'avance, dans
    // le fil du client (revue du mois d'un client, point 7 : il fallait passer par les Messages et retaper le numéro).
    if (e.justifClient === false && !dossier.manual && api.messagerie) {
      a.push({ icon: 'texte', label: `Demander le justificatif à ${dossier.name}`, court: 'Demander le justificatif',
        hint: 'Une demande de pièce dans vos messages, la pièce citée d\'avance',
        // (1.188.0) La demande part d'ici, de la fenêtre commune ; « Écrire plutôt dans la conversation » y mène.
        run: () => {
          const tiers = ((e.lignes || []).find(l => l.tiers) || {}).tiers;
          const prenom = prenomCl(dossier.contact);
          const piece = `Le justificatif de l'achat ${e.piece || e.libelle || ''} du ${fmtJour(e.date)}${tiers ? ` (${tiers})` : ''}`.replace(/\s+/g, ' ');
          fenDemanderCl(dossier, { piece, mois: String(e.date).slice(0, 7),
            texte: `Bonjour${prenom ? ` ${prenom}` : ''}, l'achat ${e.piece || e.libelle || ''} du ${fmtJour(e.date)}${tiers ? ` (${tiers})` : ''} est enregistré sans sa facture. Peux-tu m'en envoyer une photo ici ? Merci.`.replace(/ {2,}/g, ' ') },
          { hors: true, apres: async () => {} });
        } });
    }
    if (e.pieceJointe) {
      a.push({ icon: 'ouvrir', label: 'Ouvrir le justificatif', hint: esc(e.pieceJointe),
        run: async () => { try { ditOuverture(await api.ouvrirJustificatif(dossier.id, e.pieceJointe), String(e.pieceJointe).split(/[\\/]/).pop()); } catch (x) { await infoDialog('Justificatif introuvable', plainError(x)); } } });
    }
    // (plateforme) 1.189.0 — une question au client sur CETTE écriture, posée d'ici (la fenêtre de la révision) : elle porte
    // l'écriture, sa pièce et sa période ; « Envoyer maintenant » ou « Garder pour l'envoi groupé ».
    if (!dossier.manual && api.messagerie && api.question && e.statut !== 'extournee') {
      const total = (e.lignes || []).reduce((t, l) => t + (Number(l.debit) || 0), 0);
      a.push({ icon: 'email', label: 'Poser une question au client', hint: 'Sur cette écriture : il la lit en face de sa pièce',
        run: () => questionForm(root, dossier, {
          ecritureId: e.id, periode: String(e.date).slice(0, 7), piece: e.piece || '', montant: total,
          titre: `${e.journal || ''} ${e.piece || '(sans pièce)'}`.trim(), sous: `${fmtJour(e.date)} · ${e.libelle || ''}${total ? ` · ${money(total)}` : ''}`,
          objet: `${e.piece || e.libelle || 'Écriture'} du ${fmtJour(e.date)}`.slice(0, 200),
          quoi: `l'écriture ${e.piece ? `${e.piece} ` : ''}du ${fmtJour(e.date)}${e.libelle ? ` (« ${e.libelle} »)` : ''}${total ? `, de ${money(total)}` : ''}`,
          apres: () => drawLivres(root, dossier)
        }) });
    }
    if (detruire) a.push({ sep: true }, detruire);
    return a;
  }

  async function extournerEcriture(root, dossier, e) {
    if (await refusLicence('Extourner une écriture')) return;
    const date = KC.premierDuMoisSuivant(e.date);
    const ok = await confirmDialog('Extourner cette écriture ?',
      `<p>${esc(e.journal)} ${esc(e.piece || '(sans pièce)')} n° ${esc(String(e.numero))} du ${esc(fmtJour(e.date))}.</p><p>Une écriture miroir sera créée et VALIDÉE au ${esc(fmtJour(date))}. L'écriture d'origine ne bouge pas : elle reste dans son mois, avec son numéro — c'est ce qui distingue une extourne d'une contre-passation.</p>`,
      'Extourner');
    if (!ok) return;
    try {
      const r = await api.extourner(dossier.id, livresState.annee, e.id);
      livresState.livre = r.livre;
      toast(`Extourne créée au ${fmtJour(r.date)}, sous le n° ${r.numero}.`);
      drawLivres(root, dossier);
    } catch (err) { await infoDialog('Extourne impossible', plainError(err)); }
  }

  async function prevoirExtourneEcriture(root, dossier, e, date, suivante) {
    const ok = await confirmDialog(`Extourner à l'ouverture de ${suivante} ?`,
      `<p>${esc(e.journal)} ${esc(e.piece || '(sans pièce)')} n° ${esc(String(e.numero))} du ${esc(fmtJour(e.date))}.</p>
       <p>Son extourne tombe le <b>${esc(fmtJour(date))}</b> : elle vit dans le livre de ${esc(String(suivante))}, pas dans celui-ci.
       Elle y sera posée depuis l'onglet <b>Exercice</b>, avec les à-nouveaux de ${esc(String(suivante))}. L'écriture d'origine ne bouge pas.</p>`,
      'Prévoir l\'extourne');
    if (!ok) return;
    try {
      const r = await api.prevoirExtourne({ dossierId: dossier.id, annee: livresState.annee, id: e.id });
      livresState.livre = r.livre;
      drawLivres(root, dossier);
      if (r.suivantOuvert) {
        // L'exercice suivant existe déjà : ses à-nouveaux ont été posés SANS elle. On propose le même
        // geste qu'« Ouvrir N+1 », nommé d'après ce qu'il FERA (10.14.0) : des à-nouveaux validés ne
        // se refont pas — seule l'extourne entre ; la question disait « Refaire les à-nouveaux », et
        // le clic répondait « déjà validés » en rouge.
        const e = r.suivantEtat;
        const refaire = await confirmDialog(`${r.annee} est déjà ouvert`,
          e === 'completer'
            ? `<p>Ses à-nouveaux sont déjà validés : ils ne bougent pas. L'extourne, elle, peut y entrer maintenant, au ${esc(fmtJour(r.date))}, en brouillard.</p>`
            : e === 'ouvrir'
              ? `<p>Ses à-nouveaux ne sont pas encore posés : les poser maintenant y fait entrer l'extourne au ${esc(fmtJour(r.date))}.</p>`
              : `<p>Ses à-nouveaux ont été posés avant cette extourne. Les refaire maintenant la fait entrer au ${esc(fmtJour(r.date))}.</p>`,
          e === 'completer' ? 'Poser l\'extourne' : e === 'ouvrir' ? 'Poser les à-nouveaux' : 'Refaire les à-nouveaux', false, 'Plus tard');
        if (refaire) {
          const o = await api.ouvrirSuivant({ dossierId: dossier.id, annee: livresState.annee });
          toast(`Extourne posée au ${fmtJour(r.date)} dans le livre de ${o.annee}.`);
        }
      } else {
        toast(`Extourne prévue : elle sera posée au ${fmtJour(r.date)} à l'ouverture de ${r.annee}.`);
      }
    } catch (err) { await infoDialog('Extourne impossible', plainError(err)); }
  }

  function brancherVue(el, root, dossier, lignes) {
    const s = livresState;
    const redraw = () => drawLivres(root, dossier);
    // Tout ce qui change la SÉLECTION remet la page à 1 : sans ça, filtrer sur un journal depuis la
    // page 7 donne un tableau vide, et rien à l'écran n'explique pourquoi.
    const j = $('#lv-journal', el); if (j) j.onchange = () => { s.journal = j.value; s.page = 1; redraw(); };
    // Le champ de recherche du livre-journal est redessiné à chaque frappe : sans la parade, on n'y
    // tapait qu'une lettre (vu au test humain, 10.12.0 — « PAIE-2026-08 » devenait « P »). La
    // Recherche et la page Dossiers l'avaient ; lui, jamais (le jumeau manquant, 7.3.0).
    const q = $('#lv-q', el); if (q) q.oninput = () => { s.q = q.value; s.page = 1; sansPerdreLaFrappe(q, redraw); };
    const c = $('#lv-compte', el); if (c) c.onchange = () => { s.compte = c.value; s.page = 1; redraw(); };
    // Un compte qu'on a ouvert reste ouvert quand l'écran se redessine (« Montrer la suite », une
    // page suivante et retour) : sans ça, montrer plus de lignes refermait ce qu'on lisait.
    $$('details.gl-compte[data-gl]', el).forEach(d => d.addEventListener('toggle', () => {
      if (d.open) glOuverts().add(d.dataset.gl); else glOuverts().delete(d.dataset.gl);
    }));
    $$('[data-gl-plus]', el).forEach(b => b.onclick = () => {
      const compte = b.dataset.glPlus;
      s.glLimites = { ...(s.glLimites || {}), [compte]: glLimite(compte) + Number(b.dataset.glN) };
      glOuverts().add(compte);
      redraw();
    });
    const a = $('#lv-aux', el); if (a) a.onclick = () => { s.aux = !s.aux; s.page = 1; redraw(); };
    const ar = $('#lv-aux-role', el); if (ar) ar.onchange = () => { s.auxRole = ar.value; s.page = 1; redraw(); };
    const ri = $('#lv-reimport', el); if (ri) ri.onclick = () => importerTableur(root, dossier);
    const tt = $('#lv-tous', el); if (tt) tt.onclick = () => vers('#/ecritures');
    // Le lettrage automatique (9.5.0). Il DIT ce qu'il a posé et ce qu'il a laissé : « 12 lignes
    // traitées » laisserait croire que tout est réglé alors que la moitié attend une décision.
    const au = $('#lv-auto', el);
    if (au) au.onclick = async () => {
      au.disabled = true;
      try {
        const r = await api.lettrageAuto({ dossierId: dossier.id, annee: s.annee, compte: s.compte || '411' });
        s.livre = r.livre;
        toast(r.poses.length
          ? `${pl(r.poses.length, 'lettre posée', 'lettres posées')} ; ${pl(r.restent, 'ligne reste ouverte', 'lignes restent ouvertes')}.`
          : `Rien à lettrer d'office : ${pl(r.restent, 'ligne ouverte', 'lignes ouvertes')}, aucune paire qui se solde sans ambiguïté.`);
        redraw();
      } catch (e) { toast(plainError(e), 'error'); au.disabled = false; }
    };
    // L'export porte sur `lignes` — la sélection entière, jamais la page affichée.
    bindPager(el, redraw, s);
    // « Ouvrir la pièce dans le paquet » : seulement si on sait DANS QUEL paquet elle vit.
    bindRowMenus(el, cle => {
      // Les exports de la barre (H3) : la MÊME table que les lignes — une seconde table sur cette
      // racine écraserait la première (9.4.8). Le FEC ne se propose que s'il y a un livre : il porte
      // les validées de l'exercice, qu'un paquet lu seul n'a pas.
      if (cle === 'EXP') {
        const barre = $('.filters[data-export]', el);
        return [
          { icon: 'extraire', label: barre ? barre.dataset.export : 'Exporter en CSV', cle: 'export-csv', hint: 'Ce que tu vois, dans un fichier CSV que tout tableur ouvre', run: () => exporterLivre(lignes) },
          s.livre && barre && barre.hasAttribute('data-fec') ? { icon: 'extraire', label: 'Fichier FEC…', cle: 'export-fec', hint: 'Les écritures validées de l\'exercice, au format que Sage, EBP ou Cegid importent', run: () => exporterFec() } : null
        ];
      }
      // Sur le LIVRE, la clé désigne l'écriture : c'est elle qui se valide et se contre-passe.
      // Une validée n'offre JAMAIS « Modifier » ni « Supprimer » — elle se contre-passe, et c'est
      // toute la différence entre une comptabilité et un tableur.
      if (String(cle).startsWith('E:') && s.livre) {
        const id = String(cle).slice(2);
        const e = ecritureDuLivre(s.livre, id);
        if (!e) return [];
        // La MÊME table que la recherche et le brouillard : trois listes séparées auraient divergé
        // au premier ajout (règle 7.29.0).
        const actions = actionsEcriture(root, dossier, e);
        if (e.mois && (s.data.paquets || []).some(z => z.month === e.mois && z.path)) {
          actions.push({ icon: 'loupe', label: 'Voir dans le paquet', court: 'Paquet', hint: `${e.piece} · ${moisLabelCourt(e.mois)}`,
            run: () => openPack(dossier, e.mois) });
        }
        return actions;
      }
      const [piece, mois, journal, date] = String(cle).split('|');
      const p = (s.data.paquets || []).find(z => z.month === mois);
      if (!p || !p.path) return [];
      // 10.14.1 — seule sur sa ligne, l'action porte son mot court (10.12.0) : à 1280 px, « Voir dans
      // le paquet » (170 px, collé au bord) recouvrait le Crédit du livre-journal lu dans les paquets.
      return actionsJustifsClient({ piece, mois, journal, date }).concat([{ icon: 'loupe', label: 'Voir dans le paquet', court: 'Paquet', hint: `${piece} · ${moisLabelCourt(mois)}`,
        run: () => openPack(dossier, mois) }]);
    });
  }

  // H3 — le fichier des écritures (FEC) du livre : l'EXERCICE entier, les seules validées, jamais le
  // filtre ni la recherche de l'écran (un fichier normé suit l'ordre de ses numéros). Les brouillards
  // ne partent pas, et la question le dit AVANT d'enregistrer (9.4.2) : un comptable qui croit avoir
  // tout exporté découvrirait le trou chez son autre logiciel. La date de validation est celle que
  // le livre a écrite (`valideeLe`).
  async function exporterFec() {
    const s = livresState;
    if (!s.livre) return;
    const toutes = KC.lignesDuLivre(s.livre, { brouillard: true });
    const brouillards = new Set(toutes.filter(l => l.statut === 'brouillard').map(l => l.ecritureId)).size;
    const plus = brouillards > 1;
    if (brouillards && !await confirmDialog(plus ? 'Des pièces en brouillard' : 'Une pièce en brouillard',
      `<p>${esc(pl(brouillards, 'pièce reste', 'pièces restent'))} en brouillard sur cet exercice : le fichier FEC ne porte que des écritures validées, ${plus ? 'elles ne partiront pas' : 'elle ne partira pas'}. ${plus ? 'Valide-les' : 'Valide-la'} d'abord dans la Saisie si le logiciel qui reçoit le fichier doit ${plus ? 'les' : 'la'} porter.</p>`,
      'Exporter sans les brouillards')) return;
    const valideLe = new Map((s.livre.ecritures || []).map(e => [e.id, e.valideeLe ? KC.jourDeLInstant(e.valideeLe) : '']));
    const nom = nomDeCompte();
    const r = KC.fichierFec(toutes.filter(l => l.statut !== 'brouillard'), {
      identifiant: (s.data.dossier || {}).matricule || (s.data.dossier || {}).name || '',
      fin: (s.livre.exercice || {}).au,
      decimales: 3,
      nomJournal: c => ((s.livre.journaux || KC.JOURNAUX_PAR_DEFAUT).find(j => j.code === c) || {}).libelle || c,
      nomCompte: (c, l) => nom(c, l.tiers),
      // Un sous-compte de tiers (411001) est son propre compte auxiliaire ; un collectif nu n'en a
      // pas — on n'invente pas un code qu'aucun livre ne porte.
      aux: l => (l.tiers && /^4[01]/.test(String(l.account)) && String(l.account).length > 3) ? { num: l.account, lib: l.tiers } : null,
      dateValidation: p => valideLe.get((p.lignes[0] || {}).ecritureId) || p.date
    });
    if (!r.ok) {
      const refus = r.refus.slice(0, 8).map(x => `• ${x.piece} : ${x.motif}`).join('\n');
      if (r.vide) infoDialog('Rien à exporter', 'Aucune écriture validée sur cet exercice.');
      else infoDialog('Le fichier FEC ne peut pas s\'écrire', `${pl(r.refus.length, 'pièce')} ne passerai${r.refus.length > 1 ? 'ent' : 't'} pas l'import d'un logiciel comptable :\n\n${refus}`);
      return;
    }
    try {
      const f = await api.exportFec(r.texte, r.nom);
      if (f) toast(`Fichier FEC enregistré : ${pl(r.pieces, 'pièce')}, ${pl(r.lignes, 'ligne')}.`);
    } catch (e) { toast(plainError(e), 'error'); }
  }

  async function exporterLivre(lignes) {
    const s = livresState;
    const cols = s.onglet === 'balance'
      ? (s.aux
        ? [['tiers', 'Tiers'], ['account', 'Comptes'], ['ouvertureD', 'Ouverture débit'], ['ouvertureC', 'Ouverture crédit'], ['debit', 'Mouvements débit'], ['credit', 'Mouvements crédit'], ['soldeD', 'Solde débiteur'], ['soldeC', 'Solde créditeur']]
        : [['account', 'Compte'], ['label', 'Intitulé'], ['ouvertureD', 'Ouverture débit'], ['ouvertureC', 'Ouverture crédit'], ['debit', 'Mouvements débit'], ['credit', 'Mouvements crédit'], ['soldeD', 'Solde débiteur'], ['soldeC', 'Solde créditeur']])
      : [['numero', 'N°'], ['date', 'Date'], ['journal', 'Journal'], ['piece', 'Pièce'], ['account', 'Compte'], ['tiers', 'Tiers'], ['label', 'Libellé'], ['debit', 'Débit'], ['credit', 'Crédit'], ['lettre', 'Lettrage']];
    // La MÊME période que l'écran (ouverture comprise, T-38) : un export qui ne porte pas ce que
    // l'écran montre est un second document, et les deux finissent par se contredire.
    const rows = s.onglet === 'balance'
      ? (s.aux ? balanceAux(lignes, s.auxRole === 'fournisseurs' ? 'fournisseurs' : 'clients')
        : KC.balanceDepuisLignes(lignes, (s.periode || {}).ouverture || null, nomDeCompte())).rows
      : KC.journalDepuisLignes(lignes).pieces.flatMap(p => p.lignes.map(e => ({ ...e, numero: p.numero })));
    // `K.toCsvLine` échappe comme le reste du Cabinet : un libellé de facture contient un
    // point-virgule un jour sur dix, et un montant s'écrit à la virgule décimale.
    // Un montant et une date au format de l'app entreprise (C2) : les colonnes se reconnaissent à leur
    // clé, jamais au type de la valeur — un n° de pièce ou de compte est aussi un nombre.
    const MONTANTS = ['debit', 'credit', 'ouvertureD', 'ouvertureC', 'soldeD', 'soldeC'];
    const cell = (v, cle) => MONTANTS.includes(cle) ? K.csvMontant(v) : cle === 'date' ? K.csvDate(v) : String(v == null ? '' : v);
    const csv = [K.toCsvLine(cols.map(c => c[1]))]
      .concat(rows.map(r => K.toCsvLine(cols.map(c => cell(r[c[0]], c[0])))))
      .join('\r\n') + '\r\n';
    const nom = s.onglet === 'balance' ? 'balance' : s.onglet === 'grand-livre' ? 'grand-livre'
      : s.onglet === 'lettrage' ? 'lettrage' : 'livre-journal';
    try {
      // Le même chemin d'export que le reste de l'application : `cab:exportCsv` pose le BOM et la
      // fenêtre d'enregistrement. En écrire un second aurait fini par diverger sur l'un des deux.
      const r = await api.exportCsv(csv, `${nom}-${s.data.dossier.matricule || s.data.dossier.name}`);
      if (r) toast('Fichier enregistré.');
    } catch (e) { toast(plainError(e), 'error'); }
  }

  // 10.14.1 — L'aller-retour par le tableur : exporter le livre-journal, corriger dans Excel une
  // comptabilité mal tenue, et réimporter. Le comptable pilote le fait déjà avec Sage ; un logiciel
  // qui ne lui rend pas la main pour ça est un logiciel qu'on contourne. Deux temps : la fenêtre dit
  // ce qui entrera AVANT d'écrire quoi que ce soit (le moteur ne touche au livre qu'au second geste,
  // et il relit le fichier à ce moment-là).
  async function importerTableur(root, dossier) {
    const s = livresState;
    if (!s.livre) return;
    let lu;
    try { lu = await api.lireEcrituresTableur(dossier.id, s.annee); } catch (e) { return infoDialog('Ce fichier ne s\'importe pas', plainError(e)); }
    if (!lu || lu.annule) return;
    const a = lu.analyse, c = a.compte;
    const parAction = act => a.pieces.filter(p => p.action === act);
    const nomPiece = p => `${p.journal || '?'} ${p.piece || '(sans pièce)'} du ${fmtJour(p.date) || '?'}`;
    const lignesDe = p => (p.lignes_csv.length > 1 ? `lignes ${p.lignes_csv[0]} à ${p.lignes_csv[p.lignes_csv.length - 1]}` : `ligne ${p.lignes_csv[0]}`);
    const liste = (items, fn, max) => `<ul class="imp-liste">${items.slice(0, max || 8).map(x => `<li>${fn(x)}</li>`).join('')}${items.length > (max || 8) ? `<li class="muted">… et ${pl(items.length - (max || 8), 'autre')}</li>` : ''}</ul>`;
    const desequ = a.pieces.filter(p => ['nouvelle', 'brouillard', 'validee'].includes(p.action) && KC.round3(p.ecart) !== 0);
    const validees = parAction('validee');
    const aFaire = c.nouvelles + c.brouillards;
    const jourMiroir = s.livre ? KC.dateDuMiroir(s.livre, {}, K.today()) : K.today();
    // Le bouton dit ce que le clic FERA — la case cochée ajoute un geste, le libellé l'ajoute aussi.
    const libelleOk = corriger => {
      const morceaux = [aFaire ? `Importer ${pl(aFaire, 'pièce')}` : '', corriger && validees.length ? `${aFaire ? 'corriger' : 'Corriger'} ${pl(validees.length, 'validée')}` : ''].filter(Boolean);
      return morceaux.length ? morceaux.join(' et ') : validees.length ? `Corriger ${pl(validees.length, 'validée')}` : 'Rien à importer';
    };
    modal(`<h2>${lu.fec ? 'Reprendre les écritures d\'un FEC' : 'Réimporter depuis un tableur'}</h2>
      <p class="small muted">${esc(lu.nom)} — ${pl(a.pieces.length, 'pièce lue', 'pièces lues')}. Rien n'est encore écrit : voici ce que l'import fera.</p>
      ${lu.fec ? lu.fec.html : ''}
      <div class="imp-bilan">
        ${c.nouvelles ? `<div class="ok-box mb"><b>${pl(c.nouvelles, 'pièce nouvelle', 'pièces nouvelles')}</b> — ${c.nouvelles > 1 ? 'elles entreront' : 'elle entrera'} en brouillard.</div>` : ''}
        ${c.brouillards ? `<div class="ok-box mb"><b>${pl(c.brouillards, 'brouillard corrigé', 'brouillards corrigés')}</b> — ta version remplace ${c.brouillards > 1 ? 'celles' : 'celle'} du livre, sans numéro.</div>` : ''}
        ${validees.length ? `<div class="warn-box mb" id="imp-validees"><b>${pl(validees.length, 'écriture validée que ton fichier change', 'écritures validées que ton fichier change')}</b> : une validée ne se modifie jamais.
          ${liste(validees, p => `n° ${p.cibleNumero} — ${esc(nomPiece(p))} <span class="muted">(${esc(lignesDe(p))})</span>`, 5)}
          <label class="check mt"><input type="checkbox" id="imp-corriger"> <span>${validees.length > 1 ? 'Les' : 'La'} contre-passer au ${esc(fmtJour(jourMiroir))} et poser ma version en brouillard</span></label>
          <span class="small muted">Sans cette case, ${validees.length > 1 ? 'elles restent telles quelles' : 'elle reste telle quelle'} dans le livre et ta version n'entre pas.</span></div>` : ''}
        ${c.identiques ? `<p class="small muted">${pl(c.identiques, 'pièce identique au livre', 'pièces identiques au livre')} : rien à faire.</p>` : ''}
        ${desequ.length ? `<div class="warn-box mb"><b>${pl(desequ.length, 'pièce ne tombe pas juste', 'pièces ne tombent pas juste')}</b> : ${desequ.length > 1 ? 'elles entreront' : 'elle entrera'} quand même en brouillard, pour que tu la corriges dans la grille avant de valider.
          ${liste(desequ, p => `${esc(nomPiece(p))} — écart ${esc(money(Math.abs(p.ecart)))} <span class="muted">(${esc(lignesDe(p))})</span>`, 5)}</div>` : ''}
        ${c.refusees ? `<div class="warn-box mb"><b>${pl(c.refusees, 'pièce refusée', 'pièces refusées')}</b> :
          ${liste(parAction('refusee'), p => `${esc(nomPiece(p))} <span class="muted">(${esc(lignesDe(p))})</span> — ${esc(p.motif)}`)}</div>` : ''}
        ${a.ignorees.length ? `<div class="warn-box mb"><b>${pl(a.ignorees.length, 'ligne écartée', 'lignes écartées')}</b> :
          ${liste(a.ignorees, i => `ligne ${i.ligne} — ${esc(i.motif)}`)}</div>` : ''}
        ${a.comptesNouveaux.length ? `<p class="small">Comptes qui entreront au plan de ce dossier : <b>${a.comptesNouveaux.map(esc).join(', ')}</b>.</p>` : ''}
      </div>
      <p class="small muted">Rien n'est supprimé : une écriture du livre absente de ton fichier ne bouge pas. Tout entre en brouillard : tu relis, puis tu valides toi-même.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok" ${aFaire || validees.length ? '' : 'disabled'}>${libelleOk(false)}</button></div>`,
    (rootModal, close) => {
      const ok = $('#ok', rootModal), coche = $('#imp-corriger', rootModal);
      // Sans pièce nouvelle ni brouillard, le seul geste est de corriger les validées : le bouton
      // s'éteint tant que la case n'est pas cochée, et le dit.
      const majOk = () => {
        ok.textContent = libelleOk(!!(coche && coche.checked));
        if (aFaire) return;
        ok.disabled = !(coche && coche.checked);
        ok.title = ok.disabled ? (validees.length ? 'Coche la case pour contre-passer les validées : sans elle, l\'import ne change rien.' : 'Ton fichier ne change rien au livre.') : '';
      };
      if (coche) coche.onchange = majOk;
      majOk();
      ok.onclick = async () => {
        const corriger = !!(coche && coche.checked);
        if (corriger && await refusLicence('Contre-passer une écriture')) return;
        ok.disabled = true;
        try {
          const r = await api.importerEcrituresTableur(dossier.id, s.annee, lu.fichier, corriger);
          s.livre = r.livre;
          close();
          const faits = [[r.ajoutees, 'pièce ajoutée', 'pièces ajoutées'], [r.remplacees, 'brouillard corrigé', 'brouillards corrigés'],
            [r.corrigees, 'validée corrigée par contre-passation', 'validées corrigées par contre-passation']].filter(x => x[0]).map(x => pl(x[0], x[1], x[2]));
          toast(faits.length ? `Import fait : ${faits.join(', ')}. Tout est en brouillard.` : 'Rien n\'a changé dans le livre.');
          if (r.refusees.length) await infoDialog('Ce qui n\'est pas entré', r.refusees.map(x => `${x.nom} — ${x.motif}`).join('\n'));
          allerSousOnglet(root, dossier, 'saisie');
        } catch (e) { ok.disabled = false; await infoDialog('Import impossible', plainError(e)); }
      };
    });
  }

  // Le chiffre d'affaires mois par mois, en barres. Une fiche client qui ne montre que des cases
  // « reçu / pas reçu » ne dit rien du client lui-même : c'est 60 % de blanc et aucune information
  // que le comptable ne connaisse déjà.
  // Les douze mois de l'année sont toujours dessinés, ceux sans paquet estompés : un graphique
  // réduit aux trois mois reçus n'apprend rien (règle de la 2.5.0 côté entreprise).
  // Ce que dit le panneau quand la courbe n'a rien à montrer — et pourquoi (10.14.1). Une explication
  // fausse est pire qu'une explication absente (10.14.0) : « les paquets de cette année ne portent pas
  // de chiffres (fabriqués avant la 6.2.1) » s'affichait pour une année qui n'en avait reçu AUCUN.
  function caSansChiffre(packs, annee) {
    return packs.some(p => String(p.month || '').slice(0, 4) === annee)
      ? `Les paquets de ${annee} ne portent pas de chiffres : ils ont été fabriqués avant la 6.2.1.`
      : `Aucun paquet reçu pour ${annee} : le chiffre d'affaires vient des paquets du client.`;
  }
  function caChart(packs, annee) {
    const parMois = {};
    packs.forEach(p => { if (p.month.slice(0, 4) === annee && p.figures) parMois[p.month] = Number(p.figures.ca) || 0; });
    const mois = Array.from({ length: 12 }, (_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`);
    const vals = mois.map(m => parMois[m]);
    const max = Math.max(1, ...vals.map(v => v || 0));
    const total = vals.reduce((s, v) => s + (v || 0), 0);
    const recus = vals.filter(v => v != null).length;
    if (!recus) return '';
    const devise = (packs.find(p => p.figures) || { figures: {} }).figures.devise || 'DT';
    // Sous trois mois reçus, une courbe n'apprend rien : douze colonnes de 200 px de haut pour une
    // ou deux barres, et onze « pas reçu ». L'information réelle EST le chiffre — et le fait qu'il
    // ne porte que sur deux mois, ce qu'aucun graphique ne dit aussi clairement qu'une phrase.
    if (recus < 3) {
      const nommes = K.monthListLabel(mois.filter((m, i) => vals[i] != null));
      return `<div class="ca-maigre">
        <div><span class="eyebrow">Chiffre d'affaires déclaré</span>
          <div class="ca-somme">${esc(money(total, devise))}</div></div>
        <div class="muted small">sur ${pl(recus, 'mois', 'mois')} seulement — ${esc(nommes)}.
          La courbe des douze mois apparaîtra quand tu auras reçu au moins trois mois.</div></div>`;
    }
    return `<div class="ca-chart">
      <div class="ca-bars">${mois.map((m, i) => {
        const v = vals[i];
        const haut = v == null ? 0 : Math.max(2, Math.round((v / max) * 100));
        return `<div class="ca-col${v == null ? ' off' : ''}" title="${esc(K.monthLabel(m))} : ${v == null ? 'pas reçu' : esc(money(v, devise))}">
          <div class="ca-v">${v == null ? '' : esc(money(v, devise).replace(/\s\S+$/, ''))}</div>
          <div class="ca-bar" style="height:${haut}%"></div>
          <div class="ca-m">${esc(K.MONTHS_FR[i].slice(0, 3))}</div></div>`;
      }).join('')}</div>
      <div class="ca-foot"><span class="muted small">${pl(recus, 'mois', 'mois')} reçu${recus > 1 ? 's' : ''} sur 12</span>
        <strong>${esc(money(total, devise))}</strong></div></div>`;
  }

  // Ouvrir un paquet : on montre ce qu'il contient, on n'extrait que ce qui est demandé.
  async function openPack(dossier, month) {
    const p = (dossier.packs || []).find(x => x.month === month);
    if (!p || !p.path) return;
    let files, password = null;
    try { files = await api.listPack(p.path); }
    catch (e) {
      const msg = plainError(e);
      if (/ENOENT|introuvable|no such file/i.test(msg)) {
        return toast('Le fichier de ce paquet est introuvable sur le disque. Restaure une sauvegarde, ou demande-le à nouveau à ton client.', 'error');
      }
      if (!/mot de passe|déchiffr|authenticate/i.test(msg)) return toast(msg, 'error');
      password = await askPassword('Paquet protégé', 'Ce paquet est scellé par un mot de passe.');
      if (!password) return;
      try { files = await api.listPack(p.path, password); }
      catch (e2) { return toast(plainError(e2), 'error'); }
    }
    const order = f => (f.name === '00-page-de-garde.pdf' ? 0 : f.name.startsWith('journaux/') ? 1 : f.name === 'manifeste.json' ? 9 : 5);
    files.sort((a, b) => order(a) - order(b) || K.parNom(a.name, b.name));
    // Ce que le manifeste n'annonce pas n'a été comparé à rien — ni son empreinte, ni son existence.
    // Un paquet fabriqué par SkanFact n'en contient jamais.
    const trop = files.filter(f => f.annonce === false);
    modal(
      `<h2>${esc(dossier.name)} — ${esc(p.label)}</h2>
       ${/* 10.14.1 — la page de garde se CITE si elle est là : les paquets de l'exemple (fabriqués sans
             imprimante) n'en ont pas, et « commence par la page de garde » envoyait chercher un fichier
             absent de la liste juste en dessous. */''}
       <p class="muted small">${pl(files.length, 'fichier')}. ${files.some(f => f.name === '00-page-de-garde.pdf')
         ? 'Commence par la page de garde : elle résume le mois et liste ce qui manque.'
         : 'Ce paquet n\'a pas de page de garde : les journaux s\'ouvrent dans ton tableur, et le manifeste dit ce que ton client a envoyé.'}</p>
       ${trop.length ? `<div class="warn-box mt"><strong>${pl(trop.length, 'fichier')} ${trop.length > 1 ? 'ne sont pas annoncés' : 'n\'est pas annoncé'} par le manifeste de ton client ${info('p.intrus')}</strong>
         ${trop.length > 1 ? 'Ils n\'ont' : 'Il n\'a'} été ${trop.length > 1 ? 'vérifiés' : 'vérifié'} par personne : ${trop.length > 1 ? 'ils portent' : 'il porte'} un « ? » dans la liste, et SkanFact pose une question avant l'ouverture.</div>` : ''}
       <table class="list compact mt"><tbody>${files.map((f, i) => `<tr class="clickable" data-i="${i}">
         <td>${esc(f.name)}${f.annonce === false ? ' <span class="err-inline" title="non annoncé par le manifeste">?</span>' : ''}</td><td class="r muted nw">${esc(fmtBytes(f.size))}</td></tr>`).join('')}</tbody></table>
       <div class="modal-actions"><button class="btn" id="xtr">Tout extraire…</button><button class="btn btn-primary" id="ok">Fermer</button></div>`,
      (layer, close) => {
        $('#ok', layer).onclick = close;
        $('#xtr', layer).onclick = () => { close(); extractPack(dossier, month, password); };
        $$('tr[data-i]', layer).forEach(tr => {
          tr.onclick = async () => {
            const f = files[Number(tr.dataset.i)];
            // Un fichier que le manifeste n'annonce pas a pu être glissé dans le paquet après coup,
            // par quelqu'un d'autre que le client. Le contrôle d'extension reste le filet du dessous ;
            // celui-ci prévient AVANT, quand on peut encore ne pas cliquer.
            if (f.annonce === false) {
              const suite = await confirmDialog('Ce fichier n\'est pas annoncé par ton client',
                `<p><strong>${esc(f.name)}</strong> se trouve dans le paquet, mais le manifeste ne le mentionne pas : son empreinte n'a été comparée à rien.</p>
                 <p class="muted small">Un paquet fabriqué par SkanFact n'en contient jamais. Ouvre-le seulement si tu sais d'où il vient, et demande à ton client dans le doute.</p>`,
                'Ouvrir quand même', true);
              if (!suite) return;
            }
            try {
              // Un fichier dont l'extension n'est pas celle d'un document n'est pas lancé : c'est le
              // nom choisi par l'expéditeur qui déciderait sinon quel programme s'exécute.
              ditOuverture(await api.openInPack(p.path, f.name, password), f.name);
            } catch (e) { toast(plainError(e), 'error'); }
          };
        });
      }
    );
  }

  // Prévenir le client que son envoi est arrivé. Il envoie son mois et n'entend plus parler de rien :
  // il ne sait ni si c'est arrivé, ni si c'était lisible, ni s'il manquait quelque chose. Trois
  // lignes du comptable valent mieux que trois relances du client.
  function accuseReception(dossier, pack, onDone) {
    const m = K.accuseMail(S.cabinet, dossier, pack);
    let change = () => false;
    modal(
      `<h2>Accuser réception à ${esc(dossier.name)}</h2>
       <label class="field">${lbl('Destinataire', 'r.mailTo')}<input type="text" id="a-to" value="${esc(m.to)}" placeholder="adresse@client.tn"></label>
       <label class="field mt">${lbl('Objet', 'r.mailObjet')}<input type="text" id="a-sub" value="${esc(m.subject)}"></label>
       <label class="field mt">${lbl('Message', 'r.mailMessage')}<textarea id="a-body" rows="10">${esc(m.body)}</textarea></label>
       <p class="muted small mt">Le message s'ouvre dans ta messagerie : rien ne part sans que tu cliques sur « Envoyer ».</p>
       <div class="modal-actions"><button class="btn" id="no">${onDone ? 'Passer' : 'Annuler'}</button>
       <button class="btn" id="copy">Copier</button>
       <button class="btn btn-primary" id="ok">Ouvrir dans ma messagerie</button></div>`,
      (layer, close) => {
        change = suivreSaisie(layer);
        $('#no', layer).onclick = () => { close(); if (onDone) onDone(); };
        $('#copy', layer).onclick = async () => {
          try { await navigator.clipboard.writeText($('#a-body', layer).value); toast('Texte copié.'); }
          catch { toast('Copie impossible.', 'error'); }
        };
        $('#ok', layer).onclick = async () => {
          const to = $('#a-to', layer).value.trim();
          if (to && to !== dossier.email) { try { await api.saveDossier(dossier.id, { email: to }); } catch {} }
          await api.mail({ to, subject: $('#a-sub', layer).value, body: $('#a-body', layer).value });
          close(); if (onDone) onDone();
        };
      },
      () => { if (onDone) onDone(); },
      { garde: () => change() }
    );
  }

  async function extractPack(dossier, month, password) {
    const p = (dossier.packs || []).find(x => x.month === month);
    if (!p || !p.path) return;
    try {
      const r = await api.extractPack(p.path, password, `${dossier.name}-${month}`);
      if (!r) return;
      toast(`${pl(r.files, 'fichier')} extrait${r.files > 1 ? 's' : ''}.`);
      api.reveal(r.dir);
    } catch (e) { toast(plainError(e), 'error'); }
  }

  // ---------- les formulaires de dossier ----------
  function dossierFields(d) {
    return `<div class="grid-2">
        <label class="field obligatoire span-2">${lbl('Nom du client', 'd.name')}<input type="text" id="f-name" value="${esc(d.name || '')}" ${d.id && !d.manual ? 'readonly' : ''}></label>
        <label class="field span-2">${lbl('Matricule fiscal', 'd.matricule')}<input type="text" id="f-mat" value="${esc(d.matricule || '')}" placeholder="1234567X/A/M/000" ${d.id && !d.manual ? 'readonly' : ''}></label>
        <label class="field">${lbl('Email', 'd.email')}<input type="email" id="f-email" value="${esc(d.email || '')}" placeholder="Pour les relances"></label>
        <label class="field">${lbl('Téléphone', 'd.phone')}<input type="tel" id="f-phone" value="${esc(d.phone || '')}" placeholder="+216 …"></label>
        <label class="field">${lbl('Interlocuteur', 'd.contact')}<input type="text" id="f-contact" value="${esc(d.contact || '')}" placeholder="La personne que tu appelles"></label>
        <label class="field">${lbl('Sa fonction', 'd.fonction')}<input type="text" id="f-fonction" maxlength="80" value="${esc(d.fonction || '')}" placeholder="responsable, comptable interne…"></label>
        <label class="field">${lbl('Forme', 'd.forme')}<input type="text" id="f-forme" maxlength="40" value="${esc(d.forme || '')}" placeholder="SARL, SUARL, SA…" list="f-formes"><datalist id="f-formes"><option value="SARL"><option value="SUARL"><option value="SA"><option value="Personne physique"></datalist></label>
        <label class="field">${lbl('Ville', 'd.ville')}<input type="text" id="f-ville" maxlength="80" value="${esc(d.ville || '')}" placeholder="Tunis"></label>
        <label class="field span-2">${lbl('Activité', 'd.activite')}<input type="text" id="f-activite" maxlength="80" value="${esc(d.activite || '')}" placeholder="boulangerie-pâtisserie, garage automobile…"></label>
        ${/* (plateforme) 1.72.0 — l'adresse et le gérant du client : en tête et au bas de ses documents (bulletin, documents du
             personnel), qui les imprimaient sans adresse et « Je soussigné » sans nom. */''}
        <label class="field span-2">${lbl('Adresse du client', 'd.adresse')}<textarea id="f-adresse" rows="2" maxlength="300" placeholder="12 rue de la Liberté&#10;2000 Le Bardo">${esc(d.adresse || '')}</textarea></label>
        <label class="field span-2">${lbl('Gérant (qui signe)', 'd.gerant')}<input type="text" id="f-gerant" maxlength="200" value="${esc(d.gerant || '')}" placeholder="Prénom et nom"></label>
        <label class="field">${lbl('Régime fiscal', 'd.regime')}<select id="f-regime">
          <option value="">— non précisé —</option>${K.choixRegimes(S, d.regime).map(r => `<option value="${esc(r.id)}" ${d.regime === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field">${lbl('TVA', 'd.tvaPeriod')}<select id="f-tva">
          <option value="">— non précisé —</option>${K.TVA_PERIODS.map(r => `<option value="${esc(r.id)}" ${d.tvaPeriod === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Début de mission', 'd.from')}<input type="text" id="f-from" value="${esc(K.moisAffiche(d.from))}" placeholder="01/2026" inputmode="numeric"></label>
        <label class="field">${lbl('Honoraires mensuels (DT)', 'd.fees')}<input type="text" inputmode="decimal" class="num montant" id="f-fees" value="${esc(montantChamp(d.fees))}" placeholder="0,000"></label>
        <label class="field">${lbl('Matricule CNSS employeur', 'd.cnss')}<input type="text" id="f-cnss" value="${esc(d.cnssEmployeur || '')}" placeholder="123456-72"></label>
        <label class="field">${lbl('Code d\'exploitation CNSS', 'd.cnssCode')}<input type="text" id="f-cnss-code" inputmode="numeric" value="${esc(d.cnssCode || '')}" placeholder="0000"></label>
      </div>
      <label class="field mt">${lbl('Note interne', 'd.note')}<textarea id="f-note" rows="3">${esc(d.note || '')}</textarea></label>`;
  }

  // La forme d'un matricule fiscal (brique 57) : la règle du serveur (serveur/matricule.ts ; E4, E5), quelle que soit
  // l'écriture (espaces, barres, points, tirets, minuscules) ; vide, il n'y en a pas. La case disait encore l'ancienne
  // (« sept chiffres, trois lettres, trois chiffres ») : une lettre-clé O passait, et le serveur la refusait ensuite
  // avec une autre phrase.
  const MATRICULE_FISCAL_FORME = 'Le matricule fiscal s\'écrit comme sur la carte d\'identification fiscale : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000). Laisse la case vide si tu ne l\'as pas.';
  const matriculeFiscalLisible = m => !m || /^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(String(m).toUpperCase().replace(/[\s/.\-_]/g, ''));
  function readDossierFields(layer) {
    const from = K.moisTape($('#f-from', layer).value);
    return {
      name: $('#f-name', layer).value.trim(),
      matricule: $('#f-mat', layer).value.trim(),
      email: $('#f-email', layer).value.trim(),
      phone: $('#f-phone', layer).value.trim(),
      contact: $('#f-contact', layer).value.trim(),
      // (plateforme) 1.169.0
      fonction: $('#f-fonction', layer).value.trim(),
      forme: $('#f-forme', layer).value.trim(),
      ville: $('#f-ville', layer).value.trim(),
      activite: $('#f-activite', layer).value.trim(),
      // (plateforme) 1.72.0
      adresse: $('#f-adresse', layer).value.trim(),
      gerant: $('#f-gerant', layer).value.trim(),
      regime: $('#f-regime', layer).value,
      tvaPeriod: $('#f-tva', layer).value,
      from: from.ok ? from.mois : '',
      fees: lireMontant($('#f-fees', layer).value),
      cnssEmployeur: $('#f-cnss', layer).value.trim(),
      cnssCode: $('#f-cnss-code', layer).value.trim(),
      note: $('#f-note', layer).value
    };
  }

  // (1.287.1, rouge GitHub de 0902db2) La fenêtre attend le serveur avant de s'ouvrir : chaque clic pendant l'attente en
  // ouvrait une de plus (trois fenêtres empilées, trois « Coller une liste… »). Une seule à la fois.
  let ndEnCours = false;
  async function newDossierForm() {
    if (ndEnCours || document.getElementById('nd-coller')) return;
    ndEnCours = true;
    // (plateforme, 1.87.5) Le refus avant la saisie : seul un associé crée un dossier (vu en recette le 21/10/2026).
    const peut = await Promise.resolve(api.creationDossier ? api.creationDossier().catch(() => null) : null).finally(() => { ndEnCours = false; });
    if (peut && !peut.ok) {
      // (plateforme, abonnement du cabinet) Un refus qui se lève ailleurs offre le bouton qui y mène : « Règle-la dans
      // Réglages » avec un seul « Compris » laissait chercher le panneau (recette du 23/10/2026).
      modal(`<h2>Ajouter un client</h2><p><b>${esc(peut.motif)}</b> ${esc(peut.geste)}</p>
        <div class="modal-actions">${peut.vers ? `<button class="btn" data-close>Plus tard</button><button class="btn btn-primary" id="nd-vers">${esc(peut.bouton)}</button>`
          : '<button class="btn btn-primary" data-close>Compris</button>'}</div>`, (layer, close) => {
        const v = $('#nd-vers', layer);
        if (v) v.onclick = () => { close(); versReglages(peut.vers); };
      });
      return;
    }
    const empty = { packs: [] };
    let change = () => false;
    modal(
      `<h2>Nouveau dossier client</h2>
       <p class="muted small">Ajoute un client même s'il n'utilise pas encore SkanFact ${info('d.manual')} : il compte dans ton portefeuille,
       et rien ne lui est réclamé tant qu'il n'a pas commencé.</p>
       ${peut && peut.avertissement ? `<p class="info-box small" id="nd-abonnement"><b>Ce dossier se paie.</b> ${esc(peut.avertissement)}</p>` : ''}
       ${peut && peut.gratuit ? `<p class="small muted" id="nd-gratuit">${esc(peut.gratuit)}</p>` : ''}
       <p class="small nd-plusieurs">Plusieurs clients d'un coup ? <button type="button" class="btn btn-sm" id="nd-coller">Coller une liste de clients…</button></p>
       ${dossierFields(empty)}
       <div class="modal-actions"><button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Créer le dossier</button></div>`,
      (layer, close) => {
        change = suivreSaisie(layer);
        $('#no', layer).onclick = close;
        $('#nd-coller', layer).onclick = () => { close(); collerDossiersForm(); };
        $('#ok', layer).onclick = async () => {
          const f = readDossierFields(layer);
          // Un refus MONTRE la case (7.0.0, 10.12.0) : le curseur y va, elle se marque.
          if (!f.name) return refus($('#f-name', layer), 'Donne au moins un nom à ce client.');
          if (!matriculeFiscalLisible(f.matricule)) return refus($('#f-mat', layer), MATRICULE_FISCAL_FORME);
          const mois = K.moisTape($('#f-from', layer).value);
          if (!mois.ok) return refus($('#f-from', layer), mois.motif);
          try {
            const r = await api.newDossier(f);
            S = r.state; close(); render(); toast('Dossier créé.');
            location.hash = '#/dossier/' + encodeURIComponent(r.id);
          } catch (e) {
            // (plateforme, E5) Un matricule déjà celui d'une entreprise sur SkanFact : refusé sur sa case, comme un
            // matricule mal écrit (il ne se disait qu'en bas de l'écran).
            if (e && e.champ === 'matriculeFiscal') return refus($('#f-mat', layer), plainError(e));
            toast(plainError(e), 'error');
          }
        };
      },
      null,
      { garde: () => change() }
    );
  }

  // 10.14.1 — la liste collée depuis un tableur (6.8.0 : « un par un dans un formulaire, personne ne
  // le ferait ») ne vivait QUE dans l'assistant de démarrage : passé ce premier écran, « + Nouveau
  // dossier » n'offrait plus que la fiche d'un seul client, pendant que sa visite promettait « toute
  // la liste collée depuis ton tableur ». Le même moteur (`cab:importDossiers`), une porte de plus.
  // 10.14.1 (IMP-02) — une liste collée se MONTRE avant d'entrer : un décalage de colonne (le
  // téléphone pris pour le matricule, donc pour l'identifiant du dossier) ne se rattrape pas après
  // coup sans recréer le dossier. L'aperçu est calculé par le MÊME moteur que l'enregistrement
  // (`parseDossierLines`) : deux lectures donneraient deux listes.
  const CONSIGNE_LISTE = 'Un client par ligne. Depuis Excel, copie tes colonnes <strong>avec leur ligne de titres</strong> : '
    + 'elles se reconnaissent à leur titre (nom, matricule, email, téléphone), dans n\'importe quel ordre, et une colonne '
    + 'qu\'on ne sait pas lire (adresse, ville…) est laissée de côté. Tapées à la main, sépare-les par un point-virgule. '
    + 'Seul le nom est obligatoire ; tu vois ce qui entrera avant de valider.';
  function brancherApercuListe(champ, zone, bouton) {
    if (!champ || !zone) return;
    const dessiner = () => {
      const txt = champ.value.trim();
      if (!txt) { zone.innerHTML = ''; return; }
      const r = K.parseDossierLines(txt, S.dossiers || []);
      const n = r.dossiers.length;
      const cellule = (v, douteux) => v ? `<td class="${douteux ? 'douteux' : ''}">${esc(v)}${douteux ? ' <span class="small">(à vérifier)</span>' : ''}</td>` : '<td class="muted">—</td>';
      zone.innerHTML = `<div class="${n ? 'ok-box' : 'warn-box'} mb">${n ? `${pl(n, 'client entrera', 'clients entreront')} dans ton portefeuille` : 'Aucun nom de client reconnu.'}${
        r.ignorés.length ? ` · ${pl(r.ignorés.length, 'déjà là, ignoré', 'déjà là, ignorés')} : ${esc(r.ignorés.slice(0, 3).join(', '))}${r.ignorés.length > 3 ? '…' : ''}` : ''}${
        r.colonnesIgnorees && r.colonnesIgnorees.length ? ` · ${pl(r.colonnesIgnorees.length, 'colonne laissée de côté', 'colonnes laissées de côté')} : ${esc(r.colonnesIgnorees.join(', '))}` : ''}</div>
        ${n ? `<div class="scroll-x" style="max-height:170px"><table class="list compact"><thead><tr><th>Nom</th><th>Matricule</th><th>Email</th><th>Téléphone</th></tr></thead>
          <tbody>${r.dossiers.slice(0, 50).map(d => `<tr><td>${esc(d.name)}</td>${cellule(d.matricule)}${cellule(d.email, d.email && K.emailDouteux(d.email))}${cellule(d.phone)}</tr>`).join('')}</tbody></table></div>` : ''}`;
      if (bouton) bouton.textContent = n ? `Ajouter ${pl(n, 'client')}` : 'Ajouter ces clients';
    };
    champ.addEventListener('input', dessiner);
    dessiner();
  }
  function collerDossiersForm() {
    let change = () => false;
    modal(
      `<h2>Coller une liste de clients</h2>
       <p class="small">${CONSIGNE_LISTE} Un client déjà dans ton portefeuille est ignoré et nommé.</p>
       <label class="field mt">${lbl('Un client par ligne', 'd.liste')}
         <textarea id="cl-liste" rows="9" placeholder="Menuiserie Trabelsi SUARL ; 1122334A/M/P/000 ; contact@trabelsi.tn&#10;Pharmacie El Menzah&#10;Café des Jasmins"></textarea></label>
       <div id="cl-apercu" class="apercu-liste" aria-live="polite"></div>
       <div class="modal-actions"><button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Ajouter ces clients</button></div>`,
      (layer, close) => {
        change = suivreSaisie(layer);
        brancherApercuListe($('#cl-liste', layer), $('#cl-apercu', layer), $('#ok', layer));
        $('#no', layer).onclick = close;
        $('#ok', layer).onclick = async () => {
          const txt = $('#cl-liste', layer).value.trim();
          if (!txt) return refus($('#cl-liste', layer), 'Colle au moins un nom de client, un par ligne.');
          try {
            const r = await api.importDossiers(txt);
            const ignores = (r.ignorés || []);
            if (!r.added) return refus($('#cl-liste', layer), ignores.length
              ? `Aucun client ajouté : ${pl(ignores.length, 'client')} déjà dans ton portefeuille (${ignores.slice(0, 3).join(', ')}${ignores.length > 3 ? '…' : ''}).`
              : 'Aucun nom de client n\'a été reconnu dans cette liste.');
            S = r.state; close(); render();
            toast(`${pl(r.added, 'client')} ajouté${r.added > 1 ? 's' : ''} à ton portefeuille`
              + (ignores.length ? ` — ${pl(ignores.length, 'doublon')} ignoré${ignores.length > 1 ? 's' : ''} : ${ignores.slice(0, 3).join(', ')}` : '') + '.');
          } catch (e) { toast(plainError(e), 'error'); }
        };
      },
      null,
      { garde: () => change() }
    );
  }

  function dossierForm(dossier, opts) {
    let change = () => false;
    modal(
      `<h2>Fiche du dossier</h2>
       ${dossierFields(dossier)}
       <label class="inline small mt"><input type="checkbox" id="f-arch" ${dossier.archived ? 'checked' : ''}> ${lbl('Dossier archivé (client parti : on ne le réclame plus)', 'd.archived')}</label>
       ${!dossier.manual
         ? `<p class="muted small mt">Ce client est sur SkanFact : son nom et son matricule sont ceux qu'il y a donnés, lui seul les change.</p>`
         : ''}
       <div class="modal-actions">
         <button class="btn btn-danger" id="del">Retirer du portefeuille…</button>
         <span class="grow"></span>
         <button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (layer, close) => {
        change = suivreSaisie(layer);
        // Ouverte pour UNE case (le matricule CNSS que le fichier du trimestre réclame), elle y va.
        if (opts && opts.focus) { const c = $(opts.focus, layer); if (c) { c.focus(); if (typeof c.select === 'function') c.select(); } }
        $('#no', layer).onclick = close;
        $('#del', layer).onclick = async () => {
          const ok = await confirmTyped('Retirer ce dossier du portefeuille ?',
            `<p>Le dossier <strong>${esc(dossier.name)}</strong> sort de ton portefeuille : ni toi ni ton équipe ne le verrez plus.</p>
             <p class="muted small">${dossier.manual
    ? 'Tu tiens ce dossier pour un client hors SkanFact : il ne se retire que s\'il n\'a aucune écriture (un dossier créé par erreur). Si le client est simplement parti, préfère <strong>l\'archivage</strong> : il disparaît des listes sans rien perdre.'
    : 'Rien ne s\'efface : ses livres sont ceux de ton client, qui les garde. Pour que ton cabinet le reprenne, il faudra qu\'il te propose à nouveau le mandat.'}</p>`,
            'RETIRER', 'Retirer');
          if (!ok) return;
          try {
            S = await api.deleteDossier(dossier.id);
            close(); location.hash = '#/dossiers'; render(); toast('Dossier retiré du portefeuille.');
          } catch (e) { toast(plainError(e), 'error'); }
        };
        $('#ok', layer).onclick = async () => {
          const f = readDossierFields(layer);
          if (!f.name) return toast('Le nom ne peut pas être vide.', 'error');
          // Un matricule CNSS se refuse À LA SAISIE quand sa forme est fausse : sinon le refus
          // n'arriverait qu'au fichier du trimestre, le jour de l'échéance.
          if (f.cnssEmployeur && !KC.lireMatriculeCnss(f.cnssEmployeur).ok) return refus($('#f-cnss', layer), 'Le matricule CNSS s\'écrit 123456-72 : huit chiffres au plus, puis la clé sur deux.');
          if (f.cnssCode && !/^\d{1,4}$/.test(f.cnssCode)) return refus($('#f-cnss-code', layer), 'Le code d\'exploitation tient en quatre chiffres (0000 pour le code ordinaire).');
          if (dossier.manual && !matriculeFiscalLisible(f.matricule)) return refus($('#f-mat', layer), MATRICULE_FISCAL_FORME);
          const mois = K.moisTape($('#f-from', layer).value);
          if (!mois.ok) return refus($('#f-from', layer), mois.motif);
          try {
            const patch = { ...f, archived: $('#f-arch', layer).checked };
            // Le nom et le matricule partent avec la fiche : ceux d'un dossier tenu se corrigent (brique 57).
            const r = await api.saveDossier(dossier.id, patch);
            S = r.state;
            close();
            // Corriger le matricule d'un dossier sans paquet change son identifiant : il faut suivre,
            // sinon la fiche qu'on vient d'enregistrer affiche « ce dossier n'existe plus ».
            if (r.id && r.id !== dossier.id) location.hash = '#/dossier/' + encodeURIComponent(r.id);
            else render();
            toast(r.moved ? `Fiche enregistrée · ${pl(r.moved, 'paquet')} rangé${r.moved > 1 ? 's' : ''} au nouveau nom.` : 'Fiche enregistrée.');
            // (plateforme) 1.72.0 — ouverte depuis un document du personnel (le gérant à renseigner), elle y revient.
            if (opts && opts.apres && !(r.id && r.id !== dossier.id)) opts.apres();
          } catch (e) {
            // (plateforme, E5) Un matricule déjà celui d'une entreprise sur SkanFact : refusé sur sa case.
            if (e && e.champ === 'matriculeFiscal') return refus($('#f-mat', layer), plainError(e));
            toast(plainError(e), 'error');
          }
        };
      },
      null,
      { garde: () => change() }
    );
  }

  // ---------- relances ----------
  function drawRelances(view) {
    const toutes = lignesRelances();
    // La sélection venue d'une échéance. On la compare sur le NOM, parce que c'est ce que
    // `ligneEcheance` retient — et on garde ce qui reste à relancer : un client qui a envoyé son
    // mois entre-temps n'a plus rien à faire ici, même si l'échéance le nommait tout à l'heure.
    const filtre = Array.isArray(relState.seulement) ? new Set(relState.seulement) : null;
    const rows = filtre ? toutes.filter(r => filtre.has(r.name)) : toutes;
    // Une coche posée sur un client qui a envoyé son mois entre-temps n'a plus de sens : on la
    // laisse tomber au lieu de relancer quelqu'un qui n'a plus rien à envoyer.
    relState.coches = new Set([...relState.coches].filter(id => rows.some(r => r.id === id)));
    const coches = rows.filter(r => relState.coches.has(r.id));
    const rel = K.relanceDue(S);
    // « Personne à relancer : tous tes dossiers sont à jour » félicitait un cabinet qui n'a AUCUN
    // dossier. C'est la règle de la 7.0.0 — avant d'écrire une phrase rassurante, vérifier que
    // l'univers concerné est non vide — et c'était la seule des trois pages qui ne l'appliquait pas :
    // Échéances et Écritures ont leur état vide avec son geste depuis toujours.
    if (!K.dossierList(S).length) {
      relState.seulement = null; relState.depuis = ''; relState.coches.clear();
      view.innerHTML = `<div class="page-head"><h1>Relances</h1></div>
        <div class="panel"><h2>Aucun client pour l'instant</h2>
          <p>Cette page réunit les clients dont il te manque un mois, avec le message déjà écrit : les mois
          manquants sont nommés dedans, et la relance est enregistrée pour que tu saches, lundi, qui tu as
          déjà relancé.</p>
          <div class="modal-actions"><button class="btn btn-primary" id="rl-nd">Ajouter mes clients…</button>
          <button class="btn" id="rl-imp">Importer un paquet…</button></div></div>`;
      $('#rl-nd').onclick = () => newDossierForm();
      $('#rl-imp').onclick = () => doImport();
      return;
    }
    // 10.12.0 (U-11) — un seul vert : le geste de GROUPE quand il y a plusieurs clients à relancer,
    // le « Écrire » de la ligne quand il n'y en a qu'un. Chaque ligne portait son « Écrire » en vert :
    // quatre boutons verts pour trois clients, et plus aucun ne disait par où commencer. Le bouton
    // de la ligne reste visible (c'est le geste pour lequel la page existe, 7.29.0) — sans couleur.
    // (1.334.0) Deux écrans, une même question (« à qui manque-t-il des pièces ? ») : les Échéances disaient « 2 pièces
    // reçues, à classer » du client que cette page proposait de relancer. Un client qui a envoyé des pièces les attend
    // classées, pas une relance ; un client relancé aujourd'hui ne se relance pas deux fois dans la journée. Les deux
    // restent dans la liste (la pastille la compte), mais ni le vert ni « Relancer tout le monde » ne les visent.
    const dossierDe = id => (S.dossiers || []).find(x => x.id === id);
    const piecesPar = new Map();
    for (const pc of piecesLues.pieces || []) piecesPar.set(pc.entreprise, (piecesPar.get(pc.entreprise) || 0) + 1);
    const aRelancer = r => !piecesPar.get(r.id) && !relanceAujourdhui(dossierDe(r.id));
    const candidats = rows.filter(aRelancer);
    const groupeVisible = coches.length > 0 || candidats.length > 1;
    const verte = groupeVisible ? null : (candidats[0] || rows.find(r => piecesPar.get(r.id)) || null);
    const vertLigne = r => (r === verte ? 'btn btn-primary btn-sm' : 'btn btn-sm');
    const nAuj = rows.filter(r => relanceAujourdhui(dossierDe(r.id))).length, nPieces = rows.filter(r => piecesPar.get(r.id)).length;
    const phraseRel = rows.length ? [`${pl(rows.length, 'client')} à qui il manque un mois`,
      nAuj ? `${nAuj > 1 ? `${nAuj} relancés` : '1 relancé'} aujourd'hui` : '',
      nPieces ? `${nPieces > 1 ? `${nPieces} ont` : '1 a'} envoyé des pièces, à classer` : ''].filter(Boolean).join(' · ') : '';
    // « Tous tes dossiers sont à jour » sur trois cents clients HORS SkanFact : aucun n'envoie de
    // paquet, donc aucun ne peut être « à jour » (10.14.0, saturation ; `hors` n'est pas `ok`, 6.8.0).
    // La phrase dit ce qu'on sait : combien envoient, et que les autres n'ont rien à t'envoyer.
    const phraseRienARelancer = () => {
      // Les dossiers de la portée (1.334.0) : Rim ne lit pas « tes 10 clients » quand on lui en confie deux.
      const vus = new Set(mesDossiers().map(d => d.id));
      const tous = K.dossierList(S).filter(r => vus.has(r.id));
      const envoient = tous.filter(r => r.level !== 'hors').length;
      if (!envoient) return `<div class="info-box">Personne à relancer : aucun de tes ${esc(pl(tous.length, 'client'))} n'est sur SkanFact. Tu tiens leurs livres au cabinet, et rien ne leur est réclamé.</div>`;
      return `<div class="todo-ok">Personne à relancer : ${envoient === 1 ? 'ton client sur SkanFact est à jour' : `tes ${esc(pl(envoient, 'client'))} sur SkanFact sont à jour`}${envoient < tous.length ? ` — les ${esc(String(tous.length - envoient))} autres sont tenus au cabinet : rien ne leur est réclamé` : ''}.</div>`;
    };
    // Trois cents clients en retard faisaient trois cents lignes d'un bloc : on pagine ce qu'on NOMME.
    // Le geste de groupe, lui, porte sur tous ceux qui restent à relancer — pas sur la page.
    const pagerRel = pagerBar(rows.length, relState.pg, 'client');
    const rowsPage = paginate(rows, relState.pg);
    view.innerHTML = `
      ${/* U-13 — l'explication de la page vit dans la bulle du titre (règle 9.4.9) : un paragraphe
            permanent s'intercalait entre deux bandeaux, avant le premier nom. */''}
      <div class="cab-page" id="page-rel">${ctxCabinet()}
      <div class="page-head"><div><h1>Relances ${info('r.page')}</h1>${phraseRel ? `<p class="muted" id="rl-phrase">${esc(phraseRel)}</p>` : ''}</div>
        ${groupeVisible ? `<div class="actions"><button class="btn btn-primary" id="group">${
  coches.length ? `Relancer ${pl(coches.length, 'client')} coché${coches.length > 1 ? 's' : ''}`
    : candidats.length === rows.length && !filtre ? 'Relancer tout le monde' : `Relancer ${pl(candidats.length, 'client')}`}</button>${info('r.group')}</div>` : ''}</div>
      ${filtre ? `<div class="banner"><span><strong>${pl(rows.length, 'client')}</strong> sur ${toutes.length}${
  relState.depuis ? ` — ceux qu'il te manque pour « ${esc(relState.depuis)} »` : ''}.</span>
        <button class="btn btn-sm" id="rl-tout">Voir tout le monde</button></div>` : ''}
      ${/* `rel.due` vaut « le jour de relance est ATTEINT », pas « c'est aujourd'hui » : le 23 avec
            un jour réglé au 10, la phrase doit dire que le jour est passé, pas que c'est lui. */''}
      ${rel.due && rel.total ? `<p class="small mb" id="rl-jour">On est le <strong>${rel.jour}</strong>${rel.jour === rel.day
    ? ', ton jour de relance.' : ` : ton jour de relance, le ${rel.day}, est passé.`}
        ${[
    rel.count ? `${pl(rel.count, 'dossier')} ${rel.count > 1 ? 'ont' : 'a'} des mois manquants` : '',
    rel.provisoires ? `${pl(rel.provisoires, rel.count ? 'autre' : 'dossier')} ${rel.provisoires > 1 ? 'ont' : 'a'} envoyé un mois qui n'est pas clôturé` : ''
  ].filter(Boolean).join(', et ')}.</p>` : ''}
      ${rows.length ? `<div class="scroll-x"><table class="list">
        ${/* M11 — « tout le monde ou personne » : un comptable relance les cinq clients d'une
              échéance, ou ceux qu'il n'a pas eus au téléphone. La case d'en-tête coche ce que
              l'écran MONTRE, jamais les soixante — cocher ce qu'on ne voit pas est un piège. */''}
        <thead><tr>
          <th class="nw sel-col"><input type="checkbox" id="rl-all" aria-label="Tout cocher sur cette page"
            ${rowsPage.length && rowsPage.every(r => relState.coches.has(r.id)) ? 'checked' : ''}></th>
          <th class="nw">Client</th><th class="nw">Contact</th><th class="nw">Ce qui manque</th><th class="nw">Dernière relance</th><th></th></tr></thead>
        <tbody>${rowsPage.map(r => `<tr>
          <td class="nw sel-col"><input type="checkbox" data-sel="${esc(r.id)}" aria-label="Relancer ${esc(r.name)}" ${relState.coches.has(r.id) ? 'checked' : ''}></td>
          <td class="nw"><span class="dot-lvl ${r.level === 'ok' ? '' : esc(r.level)}"></span>${esc(r.name)}</td>
          <td class="muted nw">${esc(r.email || r.phone || '— à renseigner')}</td>
          <td>${r.missingCount
            ? esc(K.missingLabel(r.missingMonths))
            : `<span class="muted">${pl(r.provisionalCount, 'mois', 'mois')} non clôturé${r.provisionalCount > 1 ? 's' : ''}</span>`}${piecesPar.get(r.id) ? `<br><small class="rl-pieces">${esc(pl(piecesPar.get(r.id), 'pièce reçue', 'pièces reçues'))}, à classer</small>` : ''}</td>
          <td class="muted nw">${(() => { const rec = derniereRelance(dossierDe(r.id)); if (!rec) return 'jamais'; const c = canalRelance(rec); return `${esc(fmtDay(rec.at))} <span class="small">(${esc(ago(rec.at))}${c ? `, ${esc(c)}` : ''})</span>`; })()}</td>
          ${rowMenuCell(r.id, piecesPar.get(r.id) ? `<button class="${vertLigne(r)}" data-rl-pieces="${esc(r.id)}">Ouvrir les pièces</button>` : `<button class="${vertLigne(r)}" data-rel="${esc(r.id)}">Écrire</button>`)}</tr>`).join('')}</tbody></table></div>${pagerRel}`
        : phraseRienARelancer()}</div>`;
    const findRow = id => K.dossierList(S).find(x => x.id === id);
    // « Écrire » reste le seul bouton visible de la ligne : c'est le geste pour lequel cette page
    // existe, et l'enfouir dans un menu ajouterait un clic à ce qu'on vient y faire. Le reste — qui
    // n'a pas à occuper une place permanente — vit dans le menu.
    $$('[data-rel]', view).forEach(b => { b.onclick = e => { e.stopPropagation(); const r = findRow(b.dataset.rel); if (r) writeRelance(r); }; });
    $$('[data-rl-pieces]', view).forEach(b => { b.onclick = e => { e.stopPropagation(); location.hash = `#/pieces/${encodeURIComponent(b.dataset.rlPieces)}`; }; });
    $$('[data-portee-page]', view).forEach(b => { b.onclick = () => { prefs.set('portee', b.dataset.porteePage); relState.coches.clear(); render(); }; });
    const appeler = async (r) => {
      try { await api.tel({ number: r.phone }); await recordRelance(r, 'tel'); render(); }
      catch (e) { toast(plainError(e), 'error'); }
    };
    bindRowMenus(view, id => {
      const r = findRow(id); if (!r) return [];
      return [
        { icon: 'cloche', label: 'Écrire la relance', hint: 'Le message tout prêt, avec les mois qui manquent', run: () => writeRelance(r) },
        r.phone ? { icon: 'telephone', label: 'Appeler le client', hint: `${r.phone} — l'appel est noté comme une relance`, run: () => appeler(r) } : null,
        { sep: true },
        { icon: 'dossier', label: 'Ouvrir le dossier', hint: 'Ses mois, ses chiffres et son historique', run: () => { location.hash = '#/dossier/' + encodeURIComponent(r.id); } },
        // Le métier du Cabinet est une BOUCLE : un paquet arrive, on vérifie, on écrit, on exporte,
        // on relance qui n'a rien envoyé. Chaque écran doit finir par le geste suivant — c'est ce
        // que l'Aide de l'app entreprise applique depuis la 7.27.0, et qu'aucune page du Cabinet
        // n'appliquait. Avant d'écrire à quelqu'un, on va voir ce qu'on a déjà de lui.
        { icon: 'contrat', label: 'Ouvrir sa comptabilité', hint: 'Livre-journal, grand livre, balance, saisie',
          run: () => { location.hash = '#/dossier/' + encodeURIComponent(r.id) + '/comptabilite'; } }
      ];
    });
    // « Relancer tout le monde » porte sur ce que l'écran MONTRE : sous filtre, il ne peut pas
    // relancer soixante clients pendant que le bandeau en annonce onze (règle 7.16.0).
    const g = $('#group'); if (g) g.onclick = () => groupRelance((coches.length ? coches : candidats).slice());
    $$('[data-sel]', view).forEach(c => {
      c.onchange = () => {
        if (c.checked) relState.coches.add(c.dataset.sel); else relState.coches.delete(c.dataset.sel);
        render();
      };
    });
    const all = $('#rl-all'); if (all) all.onchange = () => {
      // La case d'en-tête porte sur ce que l'écran MONTRE : sous filtre, cocher soixante clients
      // pendant que le bandeau en annonce onze serait exactement le chiffre qui ment (7.16.0).
      // Depuis la pagination (10.14.0), ce que l'écran montre est la PAGE : la case la coche, elle.
      rowsPage.forEach(r => { if (all.checked) relState.coches.add(r.id); else relState.coches.delete(r.id); });
      render();
    };
    bindPager(view, render, relState.pg);
    const rt = $('#rl-tout'); if (rt) rt.onclick = () => { relState.seulement = null; relState.depuis = ''; relState.pg.page = 1; render(); };
  }

  async function recordRelance(row, via, note) {
    try { S = await api.noteRelance(row.id, row.missingMonths || [], via, note || ''); }
    catch (e) { toast(plainError(e), 'error'); }
  }

  // (1.184.0) La relance de la page Relances, de la fiche et des livres : la même fenêtre que partout (fenEcrire), la
  // messagerie SkanFact d'abord, WhatsApp et l'e-mail au choix.
  function writeRelance(row, onDone) {
    const D = (S.dossiers || []).find(x => x.id === row.id);
    if (!D) { if (onDone) onDone(); return; }
    fenEcrire(D, { mois: (row.missingMonths || []).slice(), ...(onDone ? { onDone } : {}) });
  }

  // Douze retardataires ne doivent pas coûter douze allers-retours dans la liste.
  function groupRelance(rows) {
    const next = () => {
      const r = rows.shift();
      if (!r) { render(); return toast('Tournée de relances terminée.'); }
      const fresh = K.dossierList(S).find(x => x.id === r.id) || r;
      writeRelance(fresh, next);
    };
    next();
  }

  function noteRelanceForm(row) {
    modal(
      `<h2>Noter une relance</h2>
       <p class="muted small">Tu l'as appelé, croisé, ou relancé depuis ton téléphone : garde-en la trace ici.</p>
       <label class="field">${lbl('Moyen', 'r.via')}<select id="n-via">${K.RELANCE_WAYS.map(w => `<option value="${esc(w.id)}">${esc(w.label)}</option>`).join('')}</select></label>
       <label class="field mt">${lbl('Note', 'r.note')}<input type="text" id="n-note" placeholder="« promet d'envoyer avant vendredi »"></label>
       <div class="modal-actions"><button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (layer, close) => {
        $('#no', layer).onclick = close;
        $('#ok', layer).onclick = async () => {
          await recordRelance(row, $('#n-via', layer).value, $('#n-note', layer).value.trim());
          close(); render(); toast('Relance enregistrée.');
        };
      }
    );
  }

  // ---------- le calendrier des échéances ----------
  //
  // Une liste de dates, un comptable en a déjà une. Ce que personne d'autre ne fait pour lui :
  // rattacher chaque échéance aux paquets qu'il n'a PAS reçus.
  // ---------------------------------------------------------------- le tableau de production (9.9.0)
  //
  // « Où en est chaque client, et depuis quand ? » — la question qu'un cabinet se pose le lundi
  // matin et à laquelle il répondait jusqu'ici en ouvrant soixante fiches. Tout est LU (paquets
  // reçus, écritures du livre, déclarations pointées) : une liste d'états qu'on coche à la main
  // est fausse le jour où quelqu'un oublie de cocher.
  let prodState = { lignes: null, etapes: [], collaborateurs: [], collab: '', mois: 12, pg: { page: 1, size: 50 } };

  // Les Échéances sans aucune échéance : la raison, et le geste qui les remplit.
  function drawEcheancesVides(view) {
    // « Aucun client pour l'instant » s'affichait aussi à un cabinet qui en a — un client hors
    // SkanFact dont personne ne tient encore le livre n'a aucune échéance à suivre, et la page
    // disait qu'il n'existait pas (10.14.0, vu au test humain). Un état vide dit SA raison (E-06)
    // et le geste qui le remplit : ouvrir la comptabilité d'un client, ou lui remettre le fichier.
    const clients = K.dossierList(S);
    if (!clients.length) {
      view.innerHTML = `<div class="page-head"><h1>Échéances</h1></div>
        <div class="panel"><h2>Aucun client pour l'instant</h2>
          <p>Le calendrier se remplit tout seul à partir de tes dossiers et de la périodicité de TVA que tu leur donnes.</p>
          <div class="modal-actions"><button class="btn btn-primary" id="nd">Ajouter mes clients…</button></div></div>`;
      $('#nd').onclick = () => newDossierForm();
      return;
    }
    const seul = clients.length === 1 ? clients[0] : null;
    view.innerHTML = `<div class="page-head"><h1>Échéances</h1></div>
      <div class="panel"><h2>Aucune échéance à suivre pour l'instant</h2>
        <p>Le calendrier suit les clients dont les livres ont des écritures : ceux qui enregistrent leurs pièces dans
        SkanFact, et ceux dont tu tiens la comptabilité ici, mois par mois une fois le mois terminé. ${seul ? `<b>${esc(seul.name)}</b> n'a encore rien à déclarer sur un mois terminé`
    : `Tes ${clients.length} clients n'ont encore rien à déclarer sur un mois terminé`} : leurs déclarations apparaissent ici
        dès la fin du premier mois qui a des écritures.</p>
        <div class="modal-actions"><button class="btn btn-primary" id="ech-livre">${seul ? `Ouvrir la comptabilité ${esc(K.de(seul.name))}` : 'Choisir un client à tenir…'}</button></div></div>`;
    $('#ech-livre').onclick = () => { location.hash = seul ? `#/dossier/${seul.id}/comptabilite` : '#/dossiers'; };
    typographie(view);
  }

  // 26/09 — un client TENU AU CABINET sans début de mission se voit réclamer toute l'année, depuis
  // janvier : un cabinet qui le reprend en septembre voyait en rouge les déclarations de son
  // prédécesseur. Ce qui les écarte existe — le « Début de mission » de la fiche — et la page le dit,
  // sous « Déjà passées », là où le rouge se lit, avec le bouton qui ouvre la fiche sur cette case.
  function aideDebutDeMission(passees) {
    const sansDebut = [...new Set(passees.flatMap(e => e.aSaisirIds || []))]
      .map(id => (S.dossiers || []).find(d => d.id === id)).filter(d => d && !d.from);
    return sansDebut.length ? `<div class="ctrl-geste small mb" id="ec-mission">
        <span class="muted">Déjà déclarées par ton prédécesseur ? Le « Début de mission » de la fiche écarte d'ici les mois d'avant toi.</span>
        ${sansDebut.slice(0, 3).map(d => `<button class="btn btn-sm" data-mission="${esc(d.id)}" aria-label="${esc('Renseigner le début de mission — ' + d.name)}">Début de mission — ${esc(d.name)}</button>`).join('')}</div>` : '';
  }
  function brancherAideDebutDeMission(view) {
    $$('[data-mission]', view).forEach(b2 => {
      b2.onclick = () => {
        const d = (S.dossiers || []).find(x => x.id === b2.dataset.mission);
        if (d) dossierForm(d, { focus: '#f-from' });   // l'enregistrement redessine la page
      };
    });
  }

  // ---------- Échéances (telles que la maquette, 1.168.0) ----------
  // docs/maquettes/cabinet/echeances.html : à gauche chaque déclaration (en retard, aujourd'hui, à déposer, à venir,
  // déposées repliées), à droite celle qu'on ouvre, dossier par dossier : où il en est, son montant, SON geste. Les
  // états viennent de K.echeances (le même calcul que le chiffre de la barre) et de ce que le serveur sait de chaque
  // déclaration (préparée, déposée, payée, son montant).
  const echState = { sel: '', filtre: 'tout', deposees: false, menu: '', ouverte: false, vue: 'liste', moisCal: '', q: '', replie: true };
  const EC_IC = {
    coche: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    g: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    trois: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
    attente: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    alerte: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    liste: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    mois: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    d: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    jours: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    sortie: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };
  // L'état d'un dossier pour une déclaration : [ton, ce qu'on lit].
  const EC_ST = {
    sans: ['rouge', 'Rien reçu'], saisir: ['ambre', 'À saisir au cabinet'], pieces: ['ambre', 'Pièces à classer'], valider: ['ambre', 'À réviser'],
    prete: ['sarcelle', 'Prête à préparer'], preparee: ['sarcelle', 'Préparée, à déposer'], deposee: ['vert', 'Déposée, à payer'], payee: ['vert', 'Déposée et payée'],
    pointee: ['vert', 'Déposée'], encours: ['gris', 'Le mois continue'],
  };
  const EC_ORDRE = ['sans', 'saisir', 'pieces', 'valider', 'prete', 'preparee', 'deposee', 'payee', 'pointee', 'encours'];
  const EC_FAIT = e => ['deposee', 'payee', 'pointee'].includes(e);
  const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  // Un montant en millimes, écrit en dinars (jamais un nombre à virgule).
  const enDinars = m => { const n = BigInt(m); const neg = n < 0n; const a = neg ? -n : n; return `${neg ? '−' : ''}${(a / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(a % 1000n).toString().padStart(3, '0')}`; };
  // « Déclaration d'août » au milieu d'une phrase ; « CNSS » garde ses capitales.
  const minuscule = t => /^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
  const jourMois = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  function titresEcheance(e) {
    if (e.id === 'tva-m') { const m = K.monthLabel(e.mois[0]); return { titre: `Déclaration ${K.de(m)}${e.physiques ? ' · personnes physiques' : ''}`, court: `Déclaration ${K.de(m.split(' ')[0])}`, moisNom: m.split(' ')[0], sorte: 'mens', physiques: !!e.physiques }; }
    if (e.id === 'employeur') return { titre: e.label, court: e.label.replace(/ \d{4}$/, ''), moisNom: e.label.slice(-4), sorte: 'annuelle' };
    const an = e.date.slice(0, 4) - (e.id === 'cnss' && e.date.slice(5, 7) === '01' ? 1 : 0);
    return { titre: /\d{4}/.test(e.label) ? e.label : `${e.label} ${an}`, court: e.label.replace(/ \d{4}$/, ''), moisNom: e.label.replace(/^CNSS du /, ''), sorte: e.id === 'cnss' ? 'cnss' : 'autre' };
  }
  // Le nom d'une échéance dans une liste repliée : deux « Déclaration de juillet » (le 15 et le 28) se distinguent.
  const nomCourtEch = x => `${x.t.court}${x.t.physiques ? ' (personnes physiques)' : ''}${x.e.id === 'employeur' ? ` ${x.t.moisNom}` : ''}`;
  const quandEch = (e, fait) => e.jours === 0 ? 'aujourd\'hui' : e.jours > 0 ? `dans ${pl(e.jours, 'jour')}` : fait ? `il y a ${pl(-e.jours, 'jour')}` : `en retard de ${pl(-e.jours, 'jour')}`;
  // (1.175.0) Un dossier compté dans la CNSS sans qu'on sache s'il emploie : son trimestre n'est pas saisi ici (cabcore).
  function employeurInconnu(d, e) {
    const m = employeursConnus()[d.id] || {};
    const vus = e.mois.map(x => m[x]).filter(x => typeof x === 'boolean');
    return !vus.some(Boolean) && vus.length < e.mois.length;
  }
  let autresMoisSans = new Map();
  function lignesEcheance(e, piecesPar, pointee) {
    const parNom = new Map((S.dossiers || []).map(d => [d.name, d]));
    const vus = new Set(mesDossiers().map(d => d.id));
    const noms = [...new Set([...(e.deposes || []), ...(e.restants || [])])];
    return noms.map(n => parNom.get(n)).filter(d => d && vus.has(d.id)).map(d => {
      const p = e.mois[e.mois.length - 1];
      const decl = e.id === 'tva-m' ? declarationConnue(d.id, p) : null;
      const nPieces = piecesPar.get(d.id) || 0;
      let st;
      if ((e.deposes || []).includes(d.name) || pointee) st = decl && decl.payeeLe ? 'payee' : decl && decl.deposeeLe ? 'deposee' : 'pointee';
      else if (e.manquants.includes(d.name)) st = nPieces ? 'pieces' : d.manual ? 'saisir' : 'sans';
      else if ((e.aSaisir || []).includes(d.name)) st = 'saisir';
      else if (e.provisoires.includes(d.name)) st = 'valider';
      else st = decl && decl.prepareeLe ? 'preparee' : 'prete';
      const t = titresEcheance(e);
      const brouillards = e.mois.reduce((s, m) => s + brouillardsConnus(d.id, m), 0);
      // (1.175.0) Ce que la ligne d'un dossier qui n'a rien envoyé dit encore : les autres mois qu'il doit, sa dernière relance.
      const autres = st === 'sans' ? (autresMoisSans.get(d.id) || []).filter(m => !e.mois.includes(m)) : [];
      const prudence = e.id === 'cnss' && employeurInconnu(d, e);
      const sous = {
        sans: [`rien reçu pour ${t.moisNom}`, autres.length ? `${autres.map(m => K.monthLabel(m).split(' ')[0]).join(', ')} attend${autres.length > 1 ? 'ent' : ''} aussi` : '', derniereRelanceCd(d)].filter(Boolean).join(' · '), saisir: `${t.moisNom} sans écriture : c'est au cabinet de le saisir`,
        pieces: `${pl(nPieces, 'pièce reçue', 'pièces reçues')}, à classer`, valider: brouillards ? `${pl(brouillards, 'écriture')} de ${t.moisNom} au brouillard` : `${t.moisNom} à réviser`,
        prete: t.sorte === 'mens' ? `${t.moisNom} révisé : la déclaration peut se préparer` : 'les mois sont révisés',
        preparee: decl && decl.prepareeLe ? `préparée le ${jourMois(decl.prepareeLe)}${decl.preparePar ? ` par ${decl.preparePar}` : ''}` : '',
        deposee: decl && decl.deposeeLe ? `déposée le ${jourMois(decl.deposeeLe)}${decl.deposeePar ? ` par ${decl.deposeePar}` : ''}${d.paieDecl === 'client' ? ' · le client la paie lui-même' : ''}` : '',
        payee: decl && decl.payeeLe ? `déposée le ${jourMois(decl.deposeeLe)} et payée le ${jourMois(decl.payeeLe)}` : '',
        pointee: `pointée déposée dans les Échéances${prudence ? ' · compté par prudence : son trimestre n\'est pas saisi ici' : ''}`,
      }[st];
      return { d, st, sous: prudence && st !== 'pointee' && sous ? `${sous} · compté par prudence` : sous, decl, prudence, montant: decl && decl.montant != null ? decl.montant : null };
    }).sort((a, b) => EC_ORDRE.indexOf(a.st) - EC_ORDRE.indexOf(b.st) || a.d.name.localeCompare(b.d.name, 'fr'));
  }
  // Les déclarations à venir : le mois en cours n'est pas terminé, rien n'est encore réclamé.
  function echeancesAVenir() {
    const j = K.deadlineSettings(S);
    const auj = K.today(), cur = auj.slice(0, 7);
    const out = [];
    const vide = { restants: [], deposes: [], manquants: [], provisoires: [], aSaisir: [] };
    const physiques = mesDossiers().some(d => !d.archived && K.periodeTva(S, d) === 'mensuelle' && K.personnePhysique(S, d));
    const jourPP = K.jourTva(S, { forme: 'Personne physique' });
    for (const m of [cur, K.addMonth(cur, 1)]) {
      out.push({ id: 'tva-m', avenir: true, label: `TVA ${K.de(K.monthLabel(m))}`, mois: [m], date: K.dayOf(K.addMonth(m, 1), j.tvaDay), ...vide });
      if (physiques && jourPP !== j.tvaDay) out.push({ id: 'tva-m', avenir: true, physiques: true, label: `TVA ${K.de(K.monthLabel(m))} · personnes physiques`, mois: [m], date: K.dayOf(K.addMonth(m, 1), jourPP), ...vide });
    }
    // (1.175.0) La déclaration annuelle d'employeur de l'année en cours : au plus tard le 28 février qui suit (À VÉRIFIER),
    // pour les dossiers dont la paie ou les comptes disent qu'ils emploient. Un pense-bête « plus tard », jamais un retard.
    // Janvier et février : celle de l'année écoulée est encore à venir.
    const an = Number(cur.slice(0, 4)) - (Number(cur.slice(5, 7)) <= 2 ? 1 : 0);
    const emp = employeursConnus();
    const employeurs = mesDossiers().filter(d => !d.archived && Object.values(emp[d.id] || {}).some(v => v === true));
    if (employeurs.length) out.push({ id: 'employeur', avenir: true, label: `Déclaration d'employeur ${an}`, mois: Array.from({ length: 12 }, (_, i) => `${an}-${String(i + 1).padStart(2, '0')}`), date: `${an + 1}-02-28`, employeurs: employeurs.map(d => d.id), ...vide });
    const mm = Number(cur.slice(5, 7)), fin = `${cur.slice(0, 4)}-${String(Math.ceil(mm / 3) * 3).padStart(2, '0')}`;
    const trim = Math.ceil(mm / 3);
    out.push({ id: 'cnss', avenir: true, label: `CNSS du ${trim}${trim === 1 ? 'ᵉʳ' : 'ᵉ'} trimestre`, mois: [fin], date: K.dayOf(K.addMonth(fin, 1), j.cnssDay), restants: [], deposes: [], manquants: [], provisoires: [], aSaisir: [] });
    for (const e of out) e.jours = Math.round((Date.parse(e.date + 'T00:00:00Z') - Date.parse(auj + 'T00:00:00Z')) / 86400000);
    return out;
  }
  // Chaque déclaration : ses lignes, ses comptes, son groupe. Une déclaration pointée ici (le pense-bête de la v10) est déposée pour tous.
  function itemsEcheances(liste) {
    const l = liste || K.echeances(S, null, { employeurs: employeursConnus(), tenus: tenusConnus(), declares: declaresConnus() });
    const piecesPar = new Map();
    for (const p of piecesLues.pieces || []) piecesPar.set(p.entreprise, (piecesPar.get(p.entreprise) || 0) + 1);
    // Les mois sans rien de chaque dossier relié, toutes déclarations mensuelles confondues : « août attend aussi ».
    const parNom = new Map((S.dossiers || []).map(d => [d.name, d]));
    autresMoisSans = new Map();
    for (const e of l) if (e.id === 'tva-m') for (const n of e.manquants || []) {
      const d = parNom.get(n);
      if (!d || d.manual || piecesPar.get(d.id)) continue;
      if (!autresMoisSans.has(d.id)) autresMoisSans.set(d.id, []);
      autresMoisSans.get(d.id).push(e.mois[0]);
    }
    for (const v of autresMoisSans.values()) v.sort();
    return [...l, ...echeancesAVenir()].map(e => {
      const pointee = !e.avenir && K.echeanceDeposee(S, e);
      const lignes = e.avenir ? [] : lignesEcheance(e, piecesPar, pointee);
      const fait = lignes.filter(x => EC_FAIT(x.st)).length;
      const groupe = e.avenir ? 'avenir' : lignes.length && fait === lignes.length ? 'depose' : e.passee ? 'retard' : e.jours === 0 ? 'jour' : 'bientot';
      return { e, cle: e.avenir ? `avenir@${e.id}@${e.date}` : K.cleEcheance(e), lignes, fait, afaire: lignes.length - fait, groupe, pointee, t: titresEcheance(e) };
    }).filter(x => x.e.avenir || x.lignes.length);
  }
  function drawEcheances(view) {
    const st = echState;
    const liste = K.echeances(S, null, { employeurs: employeursConnus(), tenus: tenusConnus(), declares: declaresConnus() });
    // Chargement : rien n'est encore lu du serveur ; la page se dessine en squelette, sans rien affirmer.
    if (!questionsAttenteLues && !questionsAttenteRefus && api.questionsEnAttente) {
      const r = '<div class="pc-r sq"><i></i><span><i></i><i></i></span></div>';
      view.innerHTML = `<div class="cab-page" id="page-ech">${ctxCabinet()}<div class="page-head"><div><h1>Échéances ${info('ec.dates')}</h1><p class="muted">Lecture du calendrier…</p></div></div>
        <div class="ec-grille"><div class="ec-col"><div class="pc-g2">${r}${r}${r}</div><div class="pc-g2">${r}${r}</div></div><section class="ec-det ec-sq"><div class="pc-papier vide"><b>Lecture du calendrier…</b><span>Les déclarations de tes dossiers, la plus pressée d'abord.</span></div></section></div></div>`;
      return;
    }
    if (!liste.length && questionsAttenteRefus) {
      view.innerHTML = `<div class="page-head"><h1>Échéances</h1></div>
        <div class="panel" id="ech-refus"><h2>Le calendrier n'a pas pu se lire</h2>
          <p>${esc(plainError(questionsAttenteRefus))}</p>
          <p class="small muted">Rien n'est perdu : les livres de tes clients sont intacts. Le calendrier se remplit dès que la lecture réussit.</p>
          <div class="modal-actions"><button class="btn btn-primary" id="ech-relire">Réessayer</button></div></div>`;
      $('#ech-relire', view).onclick = () => { chargerQuestionsAttente(false).then(() => drawEcheances(view)); };
      return;
    }
    if (!liste.length) { drawEcheancesVides(view); return; }
    const toutes = itemsEcheances(liste);
    if (!toutes.length) { drawEcheancesVides(view); return; }
    const ordreGroupe = ['jour', 'retard', 'bientot', 'avenir', 'depose'];
    const parDate = (a, b) => (a.e.date < b.e.date ? 1 : -1);
    const enGroupe = g => toutes.filter(x => x.groupe === g).sort(g === 'avenir' ? (a, b) => -parDate(a, b) : parDate);
    const choisie = toutes.find(x => x.cle === st.sel) || ordreGroupe.map(g => enGroupe(g)[0]).find(Boolean);
    st.sel = choisie.cle;
    const nPresse = toutes.filter(x => x.groupe === 'retard' || x.groupe === 'jour' || (x.groupe === 'bientot' && x.e.jours <= 7)).length;

    const ton = x => ({ retard: 'rouge', jour: 'rouge', bientot: x.afaire && x.e.jours <= 10 ? 'rouge' : 'gris', avenir: 'gris', depose: 'vert' }[x.groupe]);
    // (1.334.0) Ce qui reste à faire n'est rouge que si l'échéance presse (le ton de sa carte) : la déclaration d'octobre, due
    // dans dix-neuf jours, portait une barre toute rouge sous un titre gris.
    const tonReste = x => (x.groupe === 'depose' ? 'vert' : ton(x) === 'rouge' ? 'rouge' : 'gris');
    const barre = (x, grand) => { const prets = grand ? x.lignes.filter(l => ['prete', 'preparee'].includes(l.st)).length : 0; const ret = x.afaire - prets;
      return `<i class="ec-bar${grand ? ' grand' : ''}" aria-hidden="true">${x.fait ? `<b class="vert" style="--n:${x.fait}"></b>` : ''}${prets ? `<b class="sarcelle" style="--n:${prets}"></b>` : ''}${ret ? `<b class="${tonReste(x)}" style="--n:${ret}"></b>` : ''}</i>`; };
    const item = x => {
      const tout = x.groupe === 'depose';
      const q = quandEch(x.e, tout);
      const sous = x.groupe === 'avenir' ? q : tout ? `${q} · ${x.lignes.length === 1 ? 'déposée' : `${x.fait} sur ${x.lignes.length} déposées`}` : `${q} · ${x.afaire} sur ${x.lignes.length} à faire`;
      return `<button type="button" class="ec-i ${ton(x)}${x === choisie ? ' ici' : ''}" data-ech="${esc(x.cle)}"><span class="ec-d"><b>${esc(x.e.date.slice(8, 10))}</b><small>${MOIS_COURT[Number(x.e.date.slice(5, 7)) - 1]}</small></span><span class="ec-it"><b>${esc(x.t.court)}${x.t.physiques ? ' <i class="ec-pp">· personnes physiques</i>' : ''}${x.e.id === 'employeur' ? ` ${esc(x.t.moisNom)}` : ''}</b><small>${esc(sous)}</small>${x.groupe === 'avenir' ? '' : barre(x)}</span>${tout ? `<span class="ec-ok" aria-label="tout est déposé">${EC_IC.coche}</span>` : ''}</button>`;
    };
    const groupe = (titre, g) => {
      const l = enGroupe(g);
      if (!l.length) return '';
      const replie = g === 'depose' && !st.deposees && !l.includes(choisie);
      // (1.175.0) À venir : les trois prochaines ; les autres (la déclaration d'employeur…) sur une ligne « Plus tard ».
      const tard = g === 'avenir' && !st.plusTard ? l.slice(3).filter(x => x !== choisie) : [];
      const montres = replie ? [] : g === 'avenir' ? l.filter(x => !tard.includes(x)) : l;
      return `<div class="ec-g"><p class="ec-gt ${g}">${titre}<span>${l.length}</span>${g === 'depose' ? info('ec.passees') : ''}</p>${montres.map(item).join('')}${tard.length ? `<button type="button" class="ec-plus" id="ec-plus-tard">Plus tard : ${esc(tard.map(nomCourtEch).join(', '))} ${EC_IC.chev}</button>` : ''}${replie ? `<button type="button" class="ec-plus" id="ec-deposees">${esc(l.slice(0, 4).map(nomCourtEch).join(', '))}${l.length > 4 ? '…' : ''} ${EC_IC.chev}</button>` : ''}</div>`;
    };
    const vue = `<div class="ec-vue" role="group" aria-label="Montrer"><button type="button" data-ec-vue="liste" aria-pressed="${st.vue !== 'mois'}">${EC_IC.liste} Liste</button><button type="button" data-ec-vue="mois" aria-pressed="${st.vue === 'mois'}">${EC_IC.mois} Mois</button></div>`;
    const colonne = `<div class="ec-col">${vue}${st.vue === 'mois' ? calendrierEch(toutes, choisie, item) : `${groupe('En retard', 'retard')}${groupe('Aujourd\'hui', 'jour')}${groupe('À déposer', 'bientot')}${groupe('À venir', 'avenir')}${groupe('Déposées', 'depose')}`}</div>`;

    // La déclaration ouverte.
    const x = choisie, e = x.e;
    const lecture = monRole() === 'saisie';
    const hors = navigator.onLine === false;
    const sansReseau = ['relancer', 'deposer', 'payer'];
    const geste = l => {
      const D = l.d, mois = x.t.moisNom;
      if (lecture && ['sans', 'valider', 'prete', 'preparee', 'deposee'].includes(l.st)) return ['', 'texte', { sans: 'la tenue du dossier relance', valider: 'la tenue du dossier révise', prete: 'la tenue du dossier prépare', preparee: 'la tenue du dossier la dépose', deposee: '' }[l.st]];
      return {
        sans: D.manual ? ['saisie', true, 'Ouvrir sa saisie'] : ['relancer', true, 'Relancer'], saisir: ['saisie', true, 'Ouvrir sa saisie'], pieces: ['pieces', true, 'Ouvrir les pièces'],
        valider: ['revision', true, `Réviser ${mois}`], prete: x.t.sorte === 'mens' ? ['declaration', true, 'Préparer'] : ['dossier', 'fantome', 'Ouvrir le dossier'],
        preparee: ['deposer', true, 'Marquer déposée'], deposee: D.paieDecl === 'client' && x.t.sorte === 'mens' ? ['declaration', 'fantome', 'Sa déclaration'] : ['payer', true, 'Marquer payée'],
        payee: x.t.sorte === 'mens' ? ['declaration', 'fantome', 'Sa déclaration'] : ['dossier', 'fantome', 'Ouvrir le dossier'], pointee: ['dossier', 'fantome', 'Ouvrir le dossier'],
      }[l.st];
    };
    const filtrees = x.lignes.filter(l => st.filtre === 'tout' || (st.filtre === 'faire' ? !EC_FAIT(l.st) : EC_FAIT(l.st)));
    // Le vert va à l'étape suivante : pas à « Relancer » un client qu'on vient de relancer aujourd'hui (1.334.0).
    const premier = filtrees.findIndex(l => geste(l)[1] === true && !(geste(l)[0] === 'relancer' && relanceAujourdhui(l.d)));
    const ligne = (l, i) => {
      const [ton2, lib] = l.st === 'deposee' && l.d.paieDecl === 'client' && x.t.sorte === 'mens' ? ['vert', 'Déposée'] : EC_ST[l.st];
      const [quoi, actif, texte] = geste(l);
      const btn = actif === 'texte' ? (texte ? `<span class="ec-qui">${esc(texte)}</span>` : '')
        : `<button type="button" class="btn btn-sm${i === premier && !(hors && sansReseau.includes(quoi)) ? ' btn-primary' : ''}${actif === 'fantome' ? ' btn-ghost' : ''}" data-ec-geste="${quoi}" data-ec-d="${esc(l.d.id)}"${hors && sansReseau.includes(quoi) ? ' disabled title="Attend le retour du réseau"' : ''}>${esc(texte)}</button>`;
      const suivi = suiviPar(l.d);
      const ouvert = st.menu === l.d.id;
      return `<div class="ec-r" data-d="${esc(l.d.id)}"><span class="ec-rd">${marqueD(l.d)}<span><b>${esc(l.d.name)}</b><small>${typeD(l.d)}${x.t.physiques ? '<span>personne physique</span>' : ''}${suivi ? `<span>suivi par ${esc(suivi)}</span>` : ''}</small></span></span>
        <span class="ec-re"><span class="ec-st ${ton2}">${lib}</span>${l.sous ? `<small>${esc(l.sous)}</small>` : ''}</span>
        <span class="ec-rm">${l.montant != null ? `<b>${enDinars(l.montant)} DT</b><small>${l.st === 'payee' ? 'payé' : l.st === 'deposee' && l.d.paieDecl === 'client' ? 'à payer par le client' : EC_FAIT(l.st) || l.st === 'preparee' ? 'à payer' : 'provisoire'}</small>` : '<span class="muted">—</span>'}</span>
        <span class="ec-rg">${btn}${lecture ? '' : `<span class="pc-menu-w"><button type="button" class="btn btn-sm btn-icone btn-ghost" data-ec-menu="${esc(l.d.id)}" aria-haspopup="menu" aria-expanded="${ouvert}" aria-label="Les autres gestes — ${esc(l.d.name)}">${EC_IC.trois}</button>${ouvert ? menuLigneEch(l, x) : ''}</span>`}</span></div>`;
    };
    const prets = x.lignes.filter(l => ['prete', 'preparee'].includes(l.st)).length, bloq = x.afaire - prets;
    // (1.334.0) « 2 prêtes à déposer » comptait aussi celle qui reste à préparer : la légende dit chacune.
    const nPrete = x.lignes.filter(l => l.st === 'prete').length, nPreparee = prets - nPrete;
    const resume = x.groupe === 'avenir' ? (e.id === 'employeur' ? `<div class="ec-ban gris">${EC_IC.attente}<span><b>L'année ${esc(x.t.moisNom)} n'est pas terminée : rien n'est réclamé avant sa fin.</b> La déclaration annuelle se fait d'après la paie de l'année, salarié par salarié, dans la Paie de chaque dossier (à déposer au plus tard le ${esc(jourMois(e.date))}, À VÉRIFIER).</span></div>`
      : `<div class="ec-ban gris">${EC_IC.attente}<span><b>${esc(K.monthLabel(e.mois[0]).replace(/^./, c => c.toUpperCase()))} n'est pas terminé : rien n'est réclamé avant sa fin.</b> Ce qui est déjà là, dossier par dossier.</span></div>`)
      : x.fait === x.lignes.length ? `<div class="ec-ban vert">${EC_IC.coche}<span><b>Tout est déposé pour ${esc(x.t.moisNom)}.</b></span></div>`
        : `<div class="ec-som">${barre(x, true)}<span class="ec-som-l"><b>${x.fait} sur ${x.lignes.length}</b>${x.fait ? `<span><i class="ec-pt vert"></i>${pl(x.fait, 'déposée')}</span>` : ''}${nPreparee ? `<span><i class="ec-pt sarcelle"></i>${nPreparee} préparée${nPreparee > 1 ? 's' : ''}, à déposer</span>` : ''}${nPrete ? `<span><i class="ec-pt sarcelle"></i>${nPrete} à préparer</span>` : ''}${bloq ? `<span><i class="ec-pt ${tonReste(x)}"></i>${bloq} retenue${bloq > 1 ? 's' : ''} : ce qui manque est sur la ligne</span>` : ''}</span></div>`;
    const puces = `<div class="pc-fl ec-fl" role="group" aria-label="Montrer">${[['tout', 'Tout', x.lignes.length], ['faire', 'À faire', x.afaire], ['deposees', 'Déposées', x.fait]].map(([k, t, n]) => `<button type="button" data-ec-filtre="${k}" aria-pressed="${st.filtre === k}">${t}<span>${n}</span></button>`).join('')}</div>`;
    const filtres = x.lignes.length > 15 ? `<div class="ec-outils">${puces}<label class="pc-cherche"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="ec-q" placeholder="Chercher un dossier…" aria-label="Chercher un dossier" value="${esc(st.q)}"></label></div>`
      : x.lignes.length < 4 ? '' : puces;
    const tonTete = x.groupe === 'depose' ? 'vert' : x.groupe === 'avenir' || (x.groupe === 'bientot' && ton(x) === 'gris') ? 'gris' : 'rouge';
    const contenu = x.t.sorte === 'mens' ? 'TVA, retenues à la source, TFP, FOPROLOS, droit de timbre : ce que chaque dossier doit, dans le même formulaire.' : x.t.sorte === 'cnss' ? (x.lignes.some(l => l.prudence) ? 'Les cotisations du trimestre des dossiers employeurs.' : esc(e.detail || 'Les cotisations du trimestre des dossiers employeurs.')) : esc(e.detail || '');
    // (1.175.0) Les personnes physiques à leur jour ; la CNSS qui compte un dossier par prudence, nommé.
    const autresNb = x.t.physiques ? mesDossiers().filter(d => !d.archived && K.periodeTva(S, d) === 'mensuelle' && !K.personnePhysique(S, d)).length : 0;
    const banPP = x.t.physiques ? `<div class="ec-av"><div class="pc-avert ambre">${EC_IC.alerte}<span><b>Les personnes physiques déposent le ${esc(K.jourTva(S, { forme: 'Personne physique' }))}</b> (À VÉRIFIER) : le jour vient de la forme « Personne physique » ou du régime de leur fiche, réglé dans ${estAssocie() ? '<a href="#/reglages" class="pc-lien">Le cabinet › Réglages</a>' : 'Le cabinet › Réglages'}.${autresNb ? ` ${autresNb > 1 ? `Les ${autresNb} autres dossiers, eux, déposent` : 'L\'autre dossier, lui, dépose'} le ${esc(K.deadlineSettings(S).tvaDay)}.` : ''}</span></div></div>` : '';
    const parPrudence = x.e.id === 'cnss' ? x.lignes.filter(l => l.prudence) : [];
    const banPrudence = parPrudence.length ? `<div class="ec-ban gris ec-prud"><span><b>${esc(parPrudence.length > 1 ? `${parPrudence.slice(0, -1).map(l => l.d.name).join(', ')} et ${parPrudence[parPrudence.length - 1].d.name} sont comptés par prudence` : `${parPrudence[0].d.name} est compté par prudence`)}</b> : ${parPrudence.length > 1 ? 'leur trimestre n\'est pas saisi ici, donc SkanFact ne sait pas s\'ils emploient quelqu\'un' : 'son trimestre n\'est pas saisi ici, donc SkanFact ne sait pas s\'il emploie quelqu\'un'}. Un trimestre saisi sans une ligne de salaire sort le dossier de la CNSS ; ne pas savoir n'est pas « non ».</span></div>` : '';
    const avert = x.groupe === 'retard' && x.t.sorte === 'mens' ? `<div class="ec-av"><div class="pc-avert rouge">${EC_IC.alerte}<span><b>Passé le ${jourMois(e.date)}, la ${esc(minuscule(x.t.court))} peut coûter des pénalités de retard</b> (À VÉRIFIER : leur calcul se lit dans le code des droits et procédures fiscaux ; rien n'est calculé ici). Elle se dépose dès qu'elle est prête.</span></div>${aideDebutDeMission([e])}</div>` : '';
    // Au-delà de quinze dossiers : rangés par état, une recherche, les déposés repliés en une ligne.
    const beaucoup = x.lignes.length > 15;
    const q = st.q.trim().toLowerCase();
    const cherchees = filtrees.filter(l => !q || l.d.name.toLowerCase().includes(q));
    const TITRES = { sans: 'Rien reçu', saisir: 'À saisir au cabinet', pieces: 'Pièces à classer', valider: 'À réviser', prete: 'Prêtes à préparer', preparee: 'Préparées, à déposer', deposee: 'Déposées, à payer' };
    let rang = 0;
    const parEtat = () => Object.entries(TITRES).map(([k, t]) => {
      const l = cherchees.filter(y => y.st === k);
      if (!l.length) return '';
      const tous = k === 'sans' && !lecture && l.length > 1 ? `<button type="button" class="pc-lien" data-ec-tous="sans">Relancer les ${l.length}</button>` : '';
      return `<div class="ec-gr"><p class="ec-grt"><span class="ec-st ${EC_ST[k][0]}">${t}</span><span class="ec-grn">${l.length}</span>${tous}</p>${l.map(y => ligne(y, rang++)).join('')}</div>`;
    }).join('');
    const faits = cherchees.filter(y => ['payee', 'pointee'].includes(y.st));
    const replieHtml = !faits.length ? '' : st.replie ? `<button type="button" class="ec-replie" id="ec-replie">${marqueD(faits[0].d, '')}<span class="ec-rp-t"><b>${pl(faits.length, 'déposée')}</b> · ${esc(faits[0].d.name)}${faits.length > 1 ? ` et ${pl(faits.length - 1, 'autre')}` : ''}</span><span class="pc-lien">Les voir</span></button>` : faits.map(y => ligne(y, -1)).join('');
    const lignesHtml = x.groupe === 'avenir' ? lignesAVenir(e, x)
      : beaucoup ? `${parEtat()}${replieHtml}${cherchees.length ? '' : `<p class="muted small" style="padding:12px 18px">Aucun dossier ne contient « ${esc(st.q)} ».</p>`}`
        : `${filtrees.map(ligne).join('')}${filtrees.length ? '' : '<p class="muted small" style="padding:12px 18px">Aucun dossier dans ce filtre.</p>'}`;
    // (1.175.0) Le portail où la déclaration se dépose : une adresse qui s'ouvre dans le navigateur, rien ne part de SkanFact.
    const portail = K.PORTAILS[x.t.sorte === 'cnss' ? 'cnss' : 'ejibaya'];
    const lienPortail = `<a class="btn btn-sm" id="ec-portail" href="${esc(portail.url)}" target="_blank" rel="noopener" title="${esc(portail.url)} — À VÉRIFIER : une adresse d'administration change">Ouvrir ${esc(portail.label)} ${EC_IC.sortie}</a>`;
    const actionsTete = lecture || x.groupe === 'avenir' ? (lienPortail ? `<div class="ec-dt-a">${lienPortail}</div>` : '') : `<div class="ec-dt-a">${lienPortail}<span class="pc-menu-w"><button type="button" class="btn btn-sm btn-icone" data-ec-menu="@tete" aria-haspopup="menu" aria-expanded="${st.menu === '@tete'}" aria-label="Les gestes de la déclaration">${EC_IC.trois}</button>${st.menu === '@tete'
      ? `<div class="row-menu ec-menu" role="menu"><button type="button" role="menuitem" id="ec-pointer"${hors ? ' disabled' : ''}><b>${x.pointee ? 'Annuler « toute déposée »' : `Marquer toute la ${esc(minuscule(x.t.court))} déposée…`}</b><span>${x.pointee ? 'Chaque dossier redevient ce qu\'il était' : 'Le pense-bête pour tous les dossiers d\'un coup'}</span></button><button type="button" role="menuitem" data-ec-geste="production"><b>Voir dans le tableau de bord</b><span>Les mois de chaque dossier, de la saisie à la déclaration</span></button></div>` : ''}</span></div>`;
    const detail = `<section class="ec-det" aria-label="${esc(x.t.titre)}"><button type="button" class="pc-retour" id="ec-retour">${EC_IC.g} Échéances</button>
      <div class="ec-dt"><div class="ec-dt-g"><h2>${esc(x.t.titre)}</h2><p>${x.groupe === 'depose' ? 'Date limite' : 'À déposer au plus tard le'} ${esc(new Date(e.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }))} <span class="ec-tag ${tonTete}">${esc(quandEch(e, x.groupe === 'depose'))}</span></p><small>${contenu}</small></div>${actionsTete}</div>
      ${banPP}${avert}${banPrudence}${resume}${x.groupe === 'avenir' ? '' : filtres}<div class="ec-t" role="table"><div class="ec-th" role="row"><span>Dossier</span><span>Où il en est</span><span>Montant</span><span></span></div>${lignesHtml}</div>
      <p class="ec-pied">Des pense-bêtes : SkanFact ne dépose rien à ta place et ne se connecte à aucune administration ${info('ec.depot')}. Jours proposés : le ${esc(K.deadlineSettings(S).tvaDay)} (déclaration mensuelle), le ${esc(K.deadlineSettings(S).tvaDayPP)} (personnes physiques), le ${esc(K.deadlineSettings(S).cnssDay)} (CNSS), À VÉRIFIER${estAssocie() ? ', <a href="#/reglages" class="pc-lien">réglables dans Réglages</a>' : ''}.</p></section>`;

    const nD = mesDossiers().length;
    const toutFait = !toutes.some(y => ['retard', 'jour', 'bientot'].includes(y.groupe));
    const dernierFait = enGroupe('depose')[0];
    const sousTitre = toutFait && dernierFait ? `Tout est déposé jusqu'à ${dernierFait.t.moisNom}.` : `${nPresse ? `${pl(nPresse, 'échéance')} en retard ou dans les 7 jours` : 'Rien en retard ni dans les 7 jours'}, pour ${pl(nD, 'dossier')}`;
    const bandeauHors = hors ? '<div class="pr-ban gris"><b>Pas de réseau : ce poste montre ce qu\'il savait à sa dernière lecture.</b><span>Les dates et les dossiers se lisent ; « Marquer déposée » et les relances attendent le retour du réseau. Ce qu\'un collègue a déposé depuis n\'est pas encore là.</span></div>' : '';
    view.innerHTML = `<div class="cab-page${st.ouverte ? ' ec-ouverte' : ''}" id="page-ech">${ctxCabinet()}
      <div class="page-head"><div><h1>Échéances ${info('ec.dates')}</h1><p class="muted">${esc(sousTitre)}</p></div>
        ${estAssocie() ? `<div class="actions"><a href="#/reglages" class="btn btn-sm">${EC_IC.jours} Les jours de dépôt</a></div>` : ''}</div>
      ${bandeauHors}<div class="ec-grille">${colonne}${detail}</div></div>`;

    const redessiner = () => drawEcheances(view);
    $$('[data-ech]', view).forEach(b => { b.onclick = () => { st.sel = b.dataset.ech; st.filtre = 'tout'; st.menu = ''; st.ouverte = true; redessiner(); if (matchMedia('(max-width: 760px)').matches) for (const el of [view, $('main'), document.scrollingElement]) if (el) el.scrollTop = 0; }; });
    const dep = $('#ec-deposees', view); if (dep) dep.onclick = () => { st.deposees = true; redessiner(); };
    const pt = $('#ec-plus-tard', view); if (pt) pt.onclick = () => { st.plusTard = true; redessiner(); };
    $('#ec-retour', view).onclick = () => { st.ouverte = false; redessiner(); };
    $$('[data-ec-filtre]', view).forEach(b => { b.onclick = () => { st.filtre = b.dataset.ecFiltre; redessiner(); }; });
    $$('[data-ec-vue]', view).forEach(b => { b.onclick = () => { st.vue = b.dataset.ecVue; redessiner(); }; });
    $$('[data-ec-cal]', view).forEach(b => { b.onclick = () => { st.moisCal = b.dataset.ecCal; redessiner(); }; });
    const rp = $('#ec-replie', view); if (rp) rp.onclick = () => { st.replie = false; redessiner(); };
    const cq = $('#ec-q', view);
    if (cq) cq.oninput = () => { st.q = cq.value; redessiner(); const c = $('#ec-q', view); c.focus(); c.setSelectionRange(c.value.length, c.value.length); };
    $$('[data-ec-menu]', view).forEach(b => { b.onclick = ev => { ev.stopPropagation(); st.menu = st.menu === b.dataset.ecMenu ? '' : b.dataset.ecMenu; redessiner(); }; });
    $$('[data-portee-page]', view).forEach(b => { b.onclick = () => { prefs.set('portee', b.dataset.porteePage); render(); }; });
    const dossierDe = id => (S.dossiers || []).find(d => d.id === id);
    const annee = e.mois[e.mois.length - 1].slice(0, 4);
    const aller = (id, chemin) => { prefs.set('dossierOuvert', id); location.hash = `#/dossier/${encodeURIComponent(id)}/${chemin}`; };
    // Pointer une déclaration d'un dossier (déposée, payée), ou défaire : le serveur refait ses contrôles ; « Annuler » six secondes.
    const pointer = async (id, quoi, defaire) => {
      const periode = e.mois[e.mois.length - 1];
      try {
        await api.pointerDeclaration({ dossierId: id, annee, periode, quoi, valeur: defaire ? null : { le: K.today() } });
        await chargerQuestionsAttente(false);
        if (/^#\/echeances/.test(location.hash)) drawEcheances($('#view'));
        const D = dossierDe(id);
        if (!defaire) toastUndo(`${x.t.court} de ${D ? D.name : 'ce dossier'} : notée ${quoi === 'deposee' ? 'déposée' : 'payée'}.`, () => pointer(id, quoi, true));
        else toast('Pointage annulé.');
      } catch (err) { toast(plainError(err), 'error'); }
    };
    const GESTES = {
      relancer: id => fenRelancer(dossierDe(id), toutes),
      'marquer-sans-livre': id => fenPasPrete(dossierDe(id), x, () => chargerQuestionsAttente(false).then(() => { if (/^#\/echeances/.test(location.hash)) drawEcheances($('#view')); })),
      saisie: id => aller(id, 'comptabilite/saisie'), revision: id => aller(id, 'comptabilite/revision'),
      declaration: id => aller(id, `comptabilite/declaration/${annee}`), dossier: id => aller(id, 'fiche'), paie: id => aller(id, 'comptabilite/paie'),
      pieces: id => { location.hash = `#/pieces/${encodeURIComponent(id)}`; },
      deposer: id => fenDeposer(x.lignes.find(l => l.d.id === id), x, toutes, async (le, reference, paye, accuse) => {
        const periode = e.mois[e.mois.length - 1];
        const D = dossierDe(id);
        try {
          await api.pointerDeclaration({ dossierId: id, annee, periode, quoi: 'deposee', valeur: { le, reference } });
          if (paye === '1') await api.pointerDeclaration({ dossierId: id, annee, periode, quoi: 'payee', valeur: { le } });
          // (1.175.0) « Le client la paie lui-même » se garde sur sa fiche ; « Payée le même jour » le défait.
          const qui = paye === 'client' ? 'client' : paye === '1' ? '' : (D && D.paieDecl) || '';
          if (D && (D.paieDecl || '') !== qui) S = (await api.saveDossier(id, { paieDecl: qui })).state;
          let joint = false;
          if (accuse) {
            try { await api.classeur.deposer(id, { rubrique: 'accuse', categorie: null, periode, titre: `Accusé de dépôt ${K.de(K.monthLabel(periode))}`, detail: reference || null, echeance: null, remplace: null }, accuse); joint = true; }
            catch (err) { toast(`Déposée, mais l'accusé ne s'est pas joint : ${plainError(err)} Il se joint aussi depuis le classeur du dossier.`, 'error'); }
          }
          await chargerQuestionsAttente(false);
          if (/^#\/echeances/.test(location.hash)) drawEcheances($('#view'));
          toastUndo(`${x.t.court} de ${D ? D.name : 'ce dossier'} : marquée déposée${paye === '1' ? ' et payée' : paye === 'client' ? ', payée par le client' : ''}${joint ? ', accusé joint' : ''}.`, () => pointer(id, 'deposee', true));
        } catch (err) { toast(plainError(err), 'error'); }
      }),
      payer: id => pointer(id, 'payee'),
      'annuler-depot': id => pointer(id, 'deposee', true),
      'annuler-pointage': () => { if (st.basculerPointage) st.basculerPointage(); },
      ecrire: id => { location.hash = `#/messages/${encodeURIComponent(id)}`; },
      regime: id => { const D = dossierDe(id); if (D) dossierForm(D, { focus: x.t.sorte === 'cnss' ? '#f-regime' : '#f-tva' }); },
      production: () => { location.hash = '#/production'; },
    };
    $$('[data-ec-geste]', view).forEach(b => { b.onclick = () => { const ouvert = !!st.menu; st.menu = ''; if (ouvert) redessiner(); const f = GESTES[b.dataset.ecGeste]; if (f) f(b.dataset.ecD); }; });
    // « Relancer les N » : les Relances avec ces dossiers-là, pas la page entière.
    $$('[data-ec-tous]', view).forEach(b => { b.onclick = () => { relState.seulement = x.lignes.filter(l => l.st === 'sans').map(l => l.d.name); relState.pg.page = 1; relState.depuis = x.t.titre; vers('#/relances'); }; });
    // Le pense-bête de toute une échéance (la CNSS) : comme avant, dans les réglages du cabinet.
    const bp = $('#ec-pointer', view);
    // (1.168.0) Le même geste depuis la ligne d'un dossier pointé : « Annuler « déposée » » défait le pense-bête entier.
    const basculerPointage = async () => {
      const avant = ((S.settings || {}).depots || []).slice();
      const poser = async (l, refaire) => {
        try {
          S = await api.saveCabinet({ name: (S.cabinet || {}).name || '', email: (S.cabinet || {}).email || '', phone: (S.cabinet || {}).phone || '', settings: { depots: l } });
          render();
          if (refaire) toastUndo(l.includes(x.cle) ? `${x.t.court} : marquée déposée.` : 'Pointage annulé.', () => poser(avant, false));
        } catch (err) { toast(plainError(err), 'error'); }
      };
      st.menu = '';
      redessiner();
      if (x.pointee) { await poser(avant.filter(k => k !== x.cle), true); return; }
      if (!bloq) { await poser(avant.concat([x.cle]), true); return; }
      fenToute(x, () => poser(avant.concat([x.cle]), true));
    };
    if (bp) bp.onclick = basculerPointage;
    st.basculerPointage = basculerPointage;
    brancherAideDebutDeMission(view);
  }
  const suiviPar = d => {
    const droits = d.droits || {};
    // Qui tient le dossier : le premier nommé dans ses droits (la tenue des dossiers ou la saisie), soi compris.
    const rang = r => ({ revision: 0, saisie: 1, paie: 2, supervision: 3 }[r] ?? 4);
    const ids = Object.keys(droits).sort((a, b) => rang(droits[a]) - rang(droits[b]));
    const noms = ids.map(id => ((S.collaborateurs || []).find(c => c.id === id) || {}).nom).filter(Boolean);
    return noms.length ? noms[0].split(' ')[0] : '';
  };
  // (1.175.0) Une échéance à venir : chaque dossier qu'elle concernera (les personnes physiques pour la leur, les employeurs
  // pour la déclaration d'employeur), ce qui est déjà là, et un geste pour l'ouvrir.
  // Les dossiers qu'une échéance à venir concernera (le Tableau de bord les compte, 1.195.0).
  function concerneAVenir(e) {
    const emp = e.id === 'employeur' ? new Set(e.employeurs || []) : null;
    return d => !d.archived && (emp ? emp.has(d.id) : e.id !== 'tva-m' || (K.periodeTva(S, d) === 'mensuelle' && !!e.physiques === K.personnePhysique(S, d)));
  }
  function lignesAVenir(e, x) {
    const emp = e.id === 'employeur' ? new Set(e.employeurs || []) : null;
    const concerne = concerneAVenir(e);
    const cnss = e.id === 'cnss';
    return mesDossiers().filter(concerne).map(d => {
      const n = e.mois.reduce((s, m) => s + ecrituresConnues(d.id, m), 0);
      const suivi = suiviPar(d);
      const geste = emp ? ['paie', 'Ouvrir sa paie'] : ['dossier', 'Ouvrir le dossier'];
      return `<div class="ec-r doux"><span class="ec-rd">${marqueD(d)}<span><b>${esc(d.name)}</b><small>${typeD(d)}${K.personnePhysique(S, d) ? '<span>personne physique</span>' : ''}${suivi ? `<span>suivi par ${esc(suivi)}</span>` : ''}</small></span></span><span class="ec-re"><span class="ec-st gris">${emp ? 'L\'année continue' : 'Le mois continue'}</span><small>${emp ? 'employeur, d\'après sa paie ou ses comptes' : n ? `${pl(n, 'écriture')} déjà là${cnss ? ' sur le trimestre' : ''}` : d.manual ? 'pas encore saisi au cabinet' : 'rien pour l\'instant'}</small></span><span class="ec-rm"><span class="muted">—</span></span><span class="ec-rg"><button type="button" class="btn btn-sm" data-ec-geste="${geste[0]}" data-ec-d="${esc(d.id)}">${geste[1]}</button></span></div>`;
    }).join('') || `<p class="muted small" style="padding:12px 18px">Aucun dossier ne la dépose pour l'instant.</p>`;
  }
  function menuLigneEch(l, x) {
    const D = l.d;
    const prenom = (String(D.contact || '').trim().split(/\s+/)[0]) || '';
    const o = [
      x.t.sorte === 'mens' && ['sans', 'saisir', 'pieces', 'valider', 'prete'].includes(l.st) ? ['marquer-sans-livre', 'Marquer déposée…', 'Déposée avec des pièces reçues ailleurs, ou néant'] : null,
      x.t.sorte === 'mens' && l.st === 'deposee' && D.paieDecl === 'client' ? ['payer', 'Marquer payée', 'Le client te dit l\'avoir payée'] : null,
      x.t.sorte === 'mens' ? ['declaration', 'Ouvrir sa déclaration', 'Les cases du formulaire, à copier pour le portail'] : null,
      ['dossier', 'Ouvrir le dossier', l.st === 'sans' && (D.relances || []).length ? `${D.name}, ${derniereRelanceCd(D)}` : D.name],
      ['production', 'Voir dans le tableau de bord', 'Ses mois, de la saisie à la déclaration'],
      D.manual ? null : ['ecrire', prenom ? `Écrire à ${prenom}` : 'Écrire au client', 'Un message dans votre conversation, sans demande'],
      ['regime', 'Ce dossier ne la dépose pas', 'Changer son régime ou sa périodicité, dans sa fiche'],
      x.t.sorte === 'mens' && ['deposee', 'payee'].includes(l.st) ? ['annuler-depot', 'Annuler « déposée »', 'Le pense-bête se défait ; la déclaration reste préparée'] : null,
      l.st === 'pointee' && x.pointee ? ['annuler-pointage', 'Annuler « déposée »', 'Le pense-bête de toute la déclaration se défait'] : null,
    ].filter(Boolean);
    return `<div class="row-menu ec-menu" role="menu">${o.map(([g, t, d]) => `<button type="button" role="menuitem" data-ec-geste="${g}" data-ec-d="${esc(D.id)}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}</div>`;
  }
  document.addEventListener('click', ev => {
    if (!echState.menu || !/^#\/echeances/.test(location.hash) || ev.target.closest('.pc-menu-w')) return;
    echState.menu = '';
    drawEcheances($('#view'));
  });

  // La vue « Mois » : le mois en grille, un point par déclaration (rouge s'il reste à faire, vert si déposée), puis la liste des jours.
  function calendrierEch(toutes, choisie, item) {
    const st = echState;
    const m = st.moisCal || K.today().slice(0, 7);
    const [a, mm] = m.split('-').map(Number);
    const premier = (new Date(Date.UTC(a, mm - 1, 1)).getUTCDay() + 6) % 7;
    const nbJours = new Date(Date.UTC(a, mm, 0)).getUTCDate();
    const duMois = toutes.filter(x => x.e.date.slice(0, 7) === m);
    const auj = K.today();
    let cases = '<span class="ec-cj hors"></span>'.repeat(premier);
    for (let d = 1; d <= nbJours; d++) {
      const jour = `${m}-${String(d).padStart(2, '0')}`;
      const ici = duMois.filter(x => x.e.date === jour);
      const we = [5, 6].includes((premier + d - 1) % 7);
      cases += `<span class="ec-cj${jour === auj ? ' auj' : ''}${we ? ' we' : ''}"><b>${d}</b>${ici.length ? `<span class="ec-cpts">${ici.map(x => `<b class="ec-pt ${x.groupe === 'depose' ? 'vert' : x.groupe === 'avenir' ? 'gris' : 'rouge'}"></b>`).join('')}</span>` : ''}</span>`;
    }
    const jours = [...new Set(duMois.map(x => x.e.date))].sort();
    const avant = toutes.filter(x => x.e.date.slice(0, 7) < m && x.groupe === 'retard');
    return `<div class="ec-cal"><div class="ec-cal-t"><button type="button" class="btn btn-sm btn-icone" data-ec-cal="${K.addMonth(m, -1)}" aria-label="Mois précédent">${EC_IC.g}</button><b>${esc(K.monthLabel(m).replace(/^./, c => c.toUpperCase()))}</b><button type="button" class="btn btn-sm btn-icone" data-ec-cal="${K.addMonth(m, 1)}" aria-label="Mois suivant">${EC_IC.d}</button></div>
      <div class="ec-cal-g">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(j => `<span class="ec-cjt">${j}</span>`).join('')}${cases}</div>
      <div class="ec-jours">${jours.map(j => `<p class="ec-jt">${esc(new Date(j + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric' }).replace(/^./, c => c.toUpperCase()))}${j === auj ? ' · aujourd\'hui' : ''}</p>${duMois.filter(x => x.e.date === j).map(item).join('')}`).join('') || '<p class="muted small">Aucune déclaration ce mois-ci.</p>'}</div>
      ${avant.length ? `<p class="ec-cal-p"><i class="ec-pt rouge"></i><span>Encore en retard, d'un mois d'avant : ${avant.slice(0, 3).map(x => `la <b>${esc(minuscule(x.t.court))}</b> (${jourMois(x.e.date)})`).join(', ')}.</span></p>` : ''}</div>`;
  }
  // Ce qu'on attend d'un dossier qui n'a rien envoyé : les mois sans pièces, des déclarations à faire.
  function moisAttendus(D, toutes) {
    return [...new Set(toutes.filter(x => !x.e.avenir && x.lignes.some(l => l.d.id === D.id && l.st === 'sans')).flatMap(x => x.e.id === 'tva-m' ? x.e.mois : []))].sort();
  }
  // Relancer : le message prêt, relu ; ce qu'on attend devient des demandes datées dans la conversation.
  function fenRelancer(D, toutes) {
    if (!D) return;
    const mois = moisAttendus(D, toutes);
    const retard = toutes.filter(x => x.groupe === 'retard' && x.lignes.some(l => l.d.id === D.id && l.st === 'sans')).sort((a, b) => (a.t.sorte === 'mens' ? 0 : 1) - (b.t.sorte === 'mens' ? 0 : 1))[0];
    fenEcrire(D, { mois, retard: retard ? ` : la ${minuscule(retard.t.court)} est en retard depuis le ${jourMois(retard.e.date)}` : '' });
  }
  // (1.184.0) Écrire à un client, d'où qu'on vienne (Dossiers, Fiche du dossier, Échéances, Relances, Livres) : la même
  // fenêtre, trois chemins au choix (Skander, 30/10/2026 : « laisser le choix entre mail, WhatsApp et messagerie »). La
  // messagerie SkanFact d'abord : elle OUVRE la conversation du client, le message posé dans sa zone d'écriture et les
  // pièces attendues en demandes datées, à relire et envoyer d'ici (avant, la fenêtre envoyait sans montrer le fil). Un
  // dossier tenu au cabinet n'a pas de conversation (son client n'a pas de compte) : WhatsApp ou e-mail, et son texte ne
  // lui parle pas de SkanFact. Chaque chemin se note sur la fiche (« relancé le… »), la conversation à l'envoi.
  // `o.onDone` : une tournée (plusieurs clients à la suite) ; la conversation reçoit alors le message sans quitter la page.
  function fenEcrire(D, o = {}) {
    if (!D) return;
    const mois = o.mois || [];
    const noms = mois.map(m => K.monthLabel(m).split(' ')[0]);
    const lesMois = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0] || 'du mois';
    const relie = !D.manual && !!api.messagerie;
    const signe = (S.cabinet || {}).name || 'votre cabinet';
    // (1.334.0) Un client sur SkanFact n'envoie pas ses ventes ni ses achats : il les enregistre, et le cabinet les lit dans
    // ses livres (le message le lui dit). En faire une « pièce demandée » lui proposait d'en envoyer une photo ou un PDF.
    // Seuls ses relevés bancaires sont une pièce ; les demandes datées ne vivent que dans la conversation.
    const attendus = !mois.length || !relie ? [] : [`Vos relevés bancaires ${K.de(lesMois)}`];
    const bonjour = D.contact ? `Bonjour ${String(D.contact).split(' ')[0]}` : 'Bonjour';
    const texte = o.texte || (!mois.length
      ? `${bonjour}, `
      : relie
        ? `${bonjour}, pour tenir votre comptabilité à jour, il me manque vos pièces ${K.de(lesMois)}${o.retard || ''}. Il vous suffit d'enregistrer vos ventes et vos achats dans SkanFact : je les vois dans vos livres dès qu'ils y sont, sans rien avoir à m'envoyer. Seuls vos relevés bancaires sont à joindre. Bien à vous, ${signe}`
        : `${bonjour}, pour tenir votre comptabilité à jour, il me manque vos pièces ${K.de(lesMois)}${o.retard || ''} : vos factures de ventes et d'achats, et vos relevés bancaires. Envoyez-les-moi en photo ou en PDF, en réponse à ce message. Bien à vous, ${signe}`);
    const sujet = mois.length ? `Il me manque vos pièces ${K.de(lesMois)}` : `Un mot de ${signe}`;
    // Dans deux jours, au calendrier du poste (jamais un instant converti par toISOString : à Tunis, entre minuit et une
    // heure, il rendait la veille).
    const pour = (() => { const j = new Date(K.today() + 'T00:00:00Z'); j.setUTCDate(j.getUTCDate() + 2); return j.toISOString().slice(0, 10); })();
    const tel = String(D.phone || '').replace(/[^\d+]/g, '');
    const tournee = typeof o.onDone === 'function';
    const CHEMINS = [
      ['fil', 'Messagerie SkanFact', relie ? 'conseillé' : 'pas de compte SkanFact'],
      ['whatsapp', 'WhatsApp', tel ? esc(D.phone) : 'tu choisis le contact'],
      ['mail', 'E-mail', D.email ? esc(D.email) : 'adresse à écrire'],
      ['copier', 'Copier le texte', 'pour un SMS, un autre outil'],
    ];
    let par = relie ? 'fil' : tel ? 'whatsapp' : 'mail';
    // (plateforme) 1.193.0 — comme la demande d'une pièce (1.188.0) : la relance part d'ici, on reste sur l'écran ; « Écrire
    // plutôt dans la conversation » y mène, le message posé, pour y joindre un fichier ou le reprendre.
    const NOTES = {
      fil: attendus.length ? 'Le message part dans sa conversation ; chaque pièce attendue devient une demande datée, qui se coche quand elle arrive.' : 'Le message part dans sa conversation.',
      whatsapp: 'WhatsApp s\'ouvre, le message tout prêt ; la relance se note sur sa fiche.',
      mail: 'Ta messagerie e-mail s\'ouvre, le message tout prêt ; la relance se note sur sa fiche.',
      copier: 'Le texte se copie : colle-le où tu veux ; la relance se note sur sa fiche.',
    };
    const BOUTON = { fil: 'Envoyer dans sa conversation', whatsapp: 'Ouvrir WhatsApp', mail: 'Ouvrir ma messagerie e-mail', copier: 'Copier le texte' };
    modal(`<h2>${esc(o.titre || (mois.length ? `Relancer ${D.name}` : `Écrire à ${D.name}`))}</h2><p class="muted pc-m-sous">Choisis par où il part, relis le message, change ce que tu veux.</p>
      <div class="field"><span class="ec-lab">Par où</span><div class="pc-chips ec-par" role="group" aria-label="Par où">${CHEMINS.map(([k, t, s]) => `<button type="button" data-ec-par="${k}" aria-pressed="${k === par}"${k === 'fil' && !relie ? ' disabled' : ''}><b>${t}</b><small>${s}</small></button>`).join('')}</div></div>
      <label class="field" id="ec-mail-l"${par === 'mail' ? '' : ' hidden'}><span>Adresse e-mail</span><input type="email" id="ec-mail" value="${esc(D.email || '')}" placeholder="adresse@client.tn"></label>
      ${attendus.length ? `<div class="field" id="ec-att-l"${par === 'fil' ? '' : ' hidden'}><span>Ce qu'on attend</span><span class="ec-dems">${attendus.map((t, i) => `<label><input type="checkbox" data-ec-att="${i}" checked> ${esc(t)}</label>`).join('')}</span></div>
      <label class="field" id="ec-pour-l"${par === 'fil' ? '' : ' hidden'}><span>Pour le</span><input type="date" id="ec-pour" value="${pour}" min="${K.today()}"></label>` : ''}
      <label class="field"><span>Le message</span><textarea class="pc-txt" id="ec-msg" rows="6" maxlength="4000">${esc(texte)}</textarea></label>
      <p class="pc-note"><span id="ec-par-note">${NOTES[par]}</span>${mois.length ? ' Sa ligne dira « relancé aujourd\'hui ».' : ''} Tu l'as appelé ? <button type="button" class="pc-lien" id="ec-appel">Noter un appel comme relance</button>${relie && !tournee ? `<span id="ec-conv-l"${par === 'fil' ? '' : ' hidden'}> Un fichier à joindre ? <button type="button" class="pc-lien" id="ec-conv">Écrire plutôt dans la conversation</button></span>` : ''}</p>
      <div class="modal-actions"><button type="button" class="btn" id="ec-rel-non">${tournee ? 'Passer' : 'Annuler'}</button><button type="button" class="btn btn-primary" id="ok" title="Ctrl+Entrée">${BOUTON[par]}</button></div>`,
    (layer, close) => {
      // Chaque chemin se note sur la fiche du dossier (la même liste que « Noter une relance faite… ») : la ligne des
      // Échéances, la vue « Pièces manquantes » et la fiche disent la même dernière relance. Sans mois attendu, un simple
      // mot au client n'est pas une relance : rien ne se note.
      // (1.334.0) La page d'où l'on a relancé se redessine : les Relances et le Tableau de bord gardaient le client « à relancer »
      // et le vert sur lui, la relance partie (seules les Échéances se redessinaient).
      const noter = async (via, note) => { if (!mois.length) return; try { S = await api.noteRelance(D.id, mois, via, note); } catch { /* le message est parti ; sa trace se refera */ } if (/^#\/echeances/.test(location.hash)) drawEcheances($('#view')); else if (/^#\/(relances|production|dossiers)(\/|$)/.test(location.hash) && !tournee) render(); };
      const fini = () => { close(); if (tournee) o.onDone(); };
      $('#ec-appel', layer).onclick = () => { close(); fenNoterRelance(D, mois); };
      const montrer = (id, oui) => { const n = $(id, layer); if (n) n.hidden = !oui; };
      $$('[data-ec-par]', layer).forEach(b => { b.onclick = () => {
        par = b.dataset.ecPar;
        $$('[data-ec-par]', layer).forEach(c => c.setAttribute('aria-pressed', String(c === b)));
        $('#ec-par-note', layer).textContent = NOTES[par]; $('#ok', layer).textContent = BOUTON[par];
        montrer('#ec-mail-l', par === 'mail'); montrer('#ec-att-l', par === 'fil'); montrer('#ec-pour-l', par === 'fil'); montrer('#ec-conv-l', par === 'fil');
      }; });
      layer.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); const ok = $('#ok', layer); if (ok && !ok.disabled) ok.click(); }
      });
      // La conversation s'ouvre, le message posé ; il part d'elle, et la relance se note à son envoi.
      const conv = $('#ec-conv', layer);
      if (conv) conv.onclick = () => {
        const t = $('#ec-msg', layer).value.trim();
        const demandes = $$('[data-ec-att]', layer).filter(c => c.checked).map(c => attendus[Number(c.dataset.ecAtt)]);
        const lePour = ($('#ec-pour', layer) || {}).value || null;
        const d = location.hash;
        const RETOURS = [[/^#\/echeances/, 'Revenir aux Échéances'], [/^#\/relances/, 'Revenir aux Relances'], [/^#\/dossiers/, 'Revenir à Tous les dossiers'], [/^#\/dossier\//, 'Revenir au dossier'], [/^#\/production/, 'Revenir au Tableau de bord']];
        const r = RETOURS.find(([re]) => re.test(d));
        messagePrepare = { id: D.id, texte: t, demandes, pour: lePour, retour: r ? { texte: r[1], hash: d } : null,
          apresEnvoi: () => { messagePrepare = null; void noter('conversation', 'Relance envoyée dans la conversation SkanFact'); } };
        close();
        location.hash = `#/messages/${encodeURIComponent(D.id)}`;
      };
      $('#ec-rel-non', layer).onclick = () => fini();
      $('#ok', layer).onclick = async () => {
        const t = $('#ec-msg', layer).value.trim();
        if (!t) { toast('Écris le message avant de l\'envoyer.', 'error'); $('#ec-msg', layer).focus(); return; }
        const demandes = $$('[data-ec-att]', layer).filter(c => c.checked).map(c => attendus[Number(c.dataset.ecAtt)]);
        const lePour = ($('#ec-pour', layer) || {}).value || null;
        if (par === 'copier') {
          try { await navigator.clipboard.writeText(t); } catch { $('#ec-msg', layer).select(); toast('Sélectionné : copie-le avec Ctrl C.'); return; }
          toast(mois.length ? 'Texte copié : la relance est notée sur sa fiche.' : 'Texte copié.'); fini(); await noter('autre', 'Texte de relance copié'); return;
        }
        if (par === 'whatsapp') {
          try { if (tel) await api.tel({ number: D.phone, whatsapp: true, text: t }); else window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank', 'noopener'); }
          catch (x) { toast(plainError(x), 'error'); return; }
          fini(); await noter('whatsapp', ''); return;
        }
        if (par === 'mail') {
          const to = $('#ec-mail', layer).value.trim();
          // Sans destinataire, la messagerie s'ouvre sur un message qui ne part pas, et la relance se noterait à tort.
          if (!to) { toast('Écris son adresse e-mail : sans elle, rien ne partira.', 'error'); $('#ec-mail', layer).focus(); return; }
          if (to !== (D.email || '')) { try { S = (await api.saveDossier(D.id, { email: to })).state; } catch (x) { toast(`L'adresse n'a pas pu être enregistrée : ${plainError(x)}`, 'error'); return; } }
          try { await api.mail({ to, subject: sujet, body: t }); } catch (x) { toast(plainError(x), 'error'); return; }
          fini(); await noter('email', ''); return;
        }
        if (!relie) return;
        $('#ok', layer).disabled = true;
        try {
          const r = await api.relancerDossier(D.id, t, demandes, lePour);
          // (1.334.0) Une pièce déjà demandée et pas encore reçue ne se redemande pas (le serveur la garde seule) : le dire.
          const deja = r && Array.isArray(r.deja) ? r.deja.length : 0, neuves = demandes.length - deja;
          toast(mois.length ? `Relance partie à ${D.name}${neuves > 0 ? ` : ${pl(neuves, 'demande')} pour le ${jourMois(lePour || K.today())}` : ''}${deja ? `${neuves > 0 ? ',' : ' :'} ${deja > 1 ? `${deja} pièces déjà demandées` : '1 pièce déjà demandée'}, pas redemandée${deja > 1 ? 's' : ''}` : ''}.`
            : `Message envoyé à ${D.name}, dans sa conversation.`);
          fini(); await noter('conversation', 'Relance envoyée dans la conversation SkanFact');
        } catch (x) { $('#ok', layer).disabled = false; toast(plainError(x), 'error'); }
      };
    });
  }
  // (1.185.0) Un dossier tout juste accepté (le pont l'a noté avant de recharger) : sa question, une fois.
  function proposerDebutMission() {
    let id = null;
    try { id = sessionStorage.getItem('skanfact.debutMission'); if (id) sessionStorage.removeItem('skanfact.debutMission'); } catch { return; }
    const d = id && S ? (S.dossiers || []).find(x => x.id === id) : null;
    if (debutAPreciser(d)) fenDebutMission(d);
  }
  // (1.185.0) « À partir de quand tiens-tu ce dossier ? » : à l'acceptation d'un dossier, ou depuis « à préciser ». Trois
  // cas du métier (Skander, 30/10/2026) : une entreprise qui démarre (ce mois-ci), une reprise de l'année entière (janvier :
  // le bilan la demande), une reprise en cours d'année (un autre mois). Les déclarations déjà déposées par le comptable
  // d'avant ne se refont pas ; la lettre de mission fait foi (À VÉRIFIER). La date est le `from` de la fiche, celle que
  // « Modifier la fiche » change ensuite : SkanFact ne réclame rien avant elle.
  function fenDebutMission(D) {
    if (!D) return;
    const mc = K.today().slice(0, 7), janv = `${mc.slice(0, 4)}-01`;
    const mois = []; for (let m = `${Number(mc.slice(0, 4)) - 1}-01`; m <= mc; m = K.addMonth(m, 1)) mois.push(m);
    const CHOIX = [[mc, `Ce mois-ci · ${K.monthLabel(mc)}`, 'une entreprise qui démarre']]
      .concat(janv < mc ? [[janv, `Depuis ${K.monthLabel(janv)}`, 'tu reprends l\'année entière : le bilan la demande']] : [])
      .concat([['autre', 'Un autre mois…', 'une reprise en cours d\'année']]);
    let choix = '';
    modal(`<h2>À partir de quand tiens-tu ${esc(D.name)} ?</h2><p class="muted pc-m-sous">Le début de ta mission : SkanFact ne lui réclame rien avant, et chaque mois à partir de lui.</p>
      <div class="field"><span class="ec-lab">Le début de mission</span><div class="pc-chips ec-par dm-choix" role="radiogroup" aria-label="Le début de mission">${CHOIX.map(([k, t, s2]) => `<button type="button" role="radio" aria-checked="false" aria-pressed="false" data-dm="${k}"><b>${esc(t)}</b><small>${esc(s2)}</small></button>`).join('')}</div></div>
      <label class="field" id="dm-autre-l" hidden><span>Le premier mois de ta mission</span><select id="dm-autre">${mois.slice().reverse().map(m => `<option value="${m}"${m === K.addMonth(mc, -1) ? ' selected' : ''}>${esc(K.monthLabel(m))}</option>`).join('')}</select></label>
      <p class="pc-note">Les déclarations déjà déposées par le comptable d'avant ne se refont pas. Ta lettre de mission fait foi (À VÉRIFIER avec elle). La date se change ensuite sur la fiche du dossier.</p>
      <div class="modal-actions"><button type="button" class="btn" id="dm-non">Plus tard</button><button type="button" class="btn btn-primary" id="ok" disabled>Choisis le début de mission</button></div>`,
    (layer, close) => {
      const ok = $('#ok', layer);
      const premier = () => (choix === 'autre' ? $('#dm-autre', layer).value : choix);
      const maj = () => { const m = premier(); ok.disabled = !m; ok.textContent = m ? `Commencer en ${K.monthLabel(m)}` : 'Choisis le début de mission'; };
      $$('[data-dm]', layer).forEach(b => { b.onclick = () => {
        choix = b.dataset.dm;
        $$('[data-dm]', layer).forEach(c => { c.setAttribute('aria-pressed', String(c === b)); c.setAttribute('aria-checked', String(c === b)); });
        $('#dm-autre-l', layer).hidden = choix !== 'autre';
        maj();
      }; });
      $('#dm-autre', layer).onchange = maj;
      $('#dm-non', layer).onclick = close;
      ok.onclick = async () => {
        const m = premier();
        if (!m) return;
        ok.disabled = true;
        try {
          S = (await api.saveDossier(D.id, { from: m })).state;
          close(); render();
          toast(`${D.name} : ta mission commence en ${K.monthLabel(m)}. Rien ne lui est réclamé avant.`);
        } catch (x) { ok.disabled = false; toast(plainError(x), 'error'); }
      };
    });
  }
  // Marquer déposée une déclaration préparée : la date, le paiement, l'accusé ; ce qui reste dû avant se lit d'abord.
  function fenDeposer(l, x, toutes, valider) {
    if (!l) return;
    const D = l.d;
    const avant = toutes.find(y => y !== x && y.t.sorte === 'mens' && y.e.date < x.e.date && y.lignes.some(z => z.d.id === D.id && !EC_FAIT(z.st)));
    // (1.175.0) La maquette : trois façons de payer, l'avertissement qui nomme les deux mois, l'accusé du portail joint ici.
    const PAYE = [['1', 'Payée le même jour'], ['0', 'Pas encore'], ['client', 'Le client la paie lui-même']];
    let paye = D.paieDecl === 'client' ? 'client' : '1';
    let accuse = null;
    const NOTE = { '1': 'Le paiement ne s\'écrit pas dans les livres : il viendra du relevé bancaire, sinon il compterait deux fois.', '0': 'Elle reste « déposée, à payer » : « Marquer payée » sur sa ligne, le jour où elle l\'est.', client: 'Le client la paie de son côté : sa ligne le dit, et ce choix reste pour ses déclarations suivantes. Le paiement viendra de son relevé bancaire.' };
    modal(`<h2>La ${esc(minuscule(x.t.court))} est déposée ? ${info('ec.depot')}</h2><p class="muted pc-m-sous">${esc(D.name)} · un pense-bête : SkanFact ne dépose rien à ta place.</p>
      <div class="pc-champs"><label class="field"><span>Déposée le</span><input type="date" id="ec-le" value="${K.today()}" max="${K.today()}"></label><label class="field"><span>Montant de la déclaration</span><b class="ec-m">${l.montant != null ? `${enDinars(l.montant)} DT` : '—'}</b></label></div>
      <div class="field"><span class="ec-lab">Le paiement</span><div class="pc-chips" role="group" aria-label="Le paiement">${PAYE.map(([k, t]) => `<button type="button" data-ec-paye="${k}" aria-pressed="${k === paye}">${t}</button>`).join('')}</div></div>
      ${avant ? `<div class="pc-avert ambre">${EC_IC.alerte}<span><b>${esc(cap(avant.t.moisNom))} n'est pas encore déposée pour ${esc(D.name)}.</b> Un crédit de TVA ${esc(K.de(avant.t.moisNom))} se reporte sur ${esc(x.t.moisNom)} : vérifie le montant ${esc(K.de(x.t.moisNom))} une fois ${esc(avant.t.moisNom)} révisé.</span></div>` : ''}
      <label class="field"><span>N° de l'accusé (facultatif)</span><input type="text" id="ec-ref" maxlength="100" placeholder="recopié du portail"></label>
      <label class="cl-zone ec-acc" id="ec-acc"><span class="cl-zone-i" aria-hidden="true">${CL_IC.deposer}</span><b id="ec-acc-t">L'accusé de dépôt</b><span id="ec-acc-s">Glisse le PDF que donne ${esc(K.PORTAILS.ejibaya.label)} (facultatif) : il reste avec la déclaration, dans le classeur du dossier.</span><input type="file" id="ec-acc-f" accept="application/pdf,image/jpeg,image/png,image/webp" hidden></label>
      <p class="pc-note" id="ec-paye-note">${NOTE[paye]}</p>
      <div class="modal-actions"><button type="button" class="btn" id="ec-dep-non">Annuler</button><button type="button" class="btn btn-primary" id="ok">Marquer déposée</button></div>`,
    (layer, close) => {
      $$('[data-ec-paye]', layer).forEach(b => { b.onclick = () => { paye = b.dataset.ecPaye; $$('[data-ec-paye]', layer).forEach(c => c.setAttribute('aria-pressed', String(c === b))); $('#ec-paye-note', layer).textContent = NOTE[paye]; }; });
      const prendre = f => {
        if (!f) return;
        if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) { toast(`« ${f.name} » n'est ni un PDF ni une photo : il ne se joint pas.`, 'error'); return; }
        accuse = f;
        $('#ec-acc-t', layer).textContent = f.name;
        $('#ec-acc-s', layer).textContent = `${tailleTxt(f.size)} · il se range avec la déclaration ${K.de(x.t.moisNom)}, dans le classeur.`;
        $('#ec-acc', layer).classList.add('pris');
      };
      $('#ec-acc-f', layer).onchange = () => prendre($('#ec-acc-f', layer).files[0]);
      const zone = $('#ec-acc', layer);
      zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('sur'); };
      zone.ondragleave = () => zone.classList.remove('sur');
      zone.ondrop = ev => { ev.preventDefault(); zone.classList.remove('sur'); prendre((ev.dataTransfer.files || [])[0]); };
      $('#ec-dep-non', layer).onclick = close;
      $('#ok', layer).onclick = () => { const le = $('#ec-le', layer).value || K.today(); const ref = $('#ec-ref', layer).value.trim(); close(); valider(le, ref, paye, accuse); };
    });
  }
  // Un dossier qui n'a rien de prêt dans SkanFact, déposé quand même : néant, ou avec des pièces reçues ailleurs.
  function fenPasPrete(D, x, apres) {
    if (!D) return;
    const periode = x.e.mois[x.e.mois.length - 1];
    modal(`<h2>${esc(D.name)} n'a rien de prêt pour ${esc(x.t.moisNom)}</h2><p class="muted pc-m-sous">La déclaration a été déposée quand même ?</p>
      <div class="pc-choix"><button type="button" class="pc-ch" data-ec-choix="neant"><b>Néant : aucune activité en ${esc(x.t.moisNom)}</b><span>Seulement si le client te l'a confirmé. La relance s'arrête pour ${esc(x.t.moisNom)}.</span></button>
      <button type="button" class="pc-ch" data-ec-choix="ailleurs"><b>Avec des pièces reçues hors de SkanFact</b><span>Sur papier ou par e-mail. Elles restent à saisir : le mois reste « à saisir » dans sa comptabilité.</span></button></div>
      <div class="pc-champs"><label class="field"><span>Déposée le</span><input type="date" id="ec-le" value="${K.today()}" max="${K.today()}"></label><label class="field"><span>Montant (DT)</span><input type="text" inputmode="decimal" id="ec-montant" value="0,000"></label></div>
      <div class="modal-actions"><button type="button" class="btn" id="ec-pp-non">Pas encore</button><button type="button" class="btn btn-primary" id="ok" disabled title="Choisis d'abord ce qui a été déposé">Marquer déposée</button></div>`,
    (layer, close) => {
      let choix = '';
      $$('[data-ec-choix]', layer).forEach(b => { b.onclick = () => { choix = b.dataset.ecChoix; $$('[data-ec-choix]', layer).forEach(c => c.classList.toggle('ici', c === b)); $('#ok', layer).disabled = false; $('#ok', layer).removeAttribute('title'); if (choix === 'neant') $('#ec-montant', layer).value = '0,000'; }; });
      $('#ec-pp-non', layer).onclick = close;
      $('#ok', layer).onclick = async () => {
        $('#ok', layer).disabled = true;
        try {
          await api.declarerHorsLivre({ dossierId: D.id, periode, le: $('#ec-le', layer).value || K.today(), montant: choix === 'neant' ? '0' : $('#ec-montant', layer).value });
          close();
          toast(`${x.t.court} de ${D.name} : marquée déposée${choix === 'neant' ? ' (néant)' : ''}.`);
          apres();
        } catch (err) { $('#ok', layer).disabled = false; toast(plainError(err), 'error'); }
      };
    });
  }
  // Toute la déclaration d'un coup : ce qui n'est pas prêt se lit avant ; le geste sûr est « Annuler ».
  function fenToute(x, valider) {
    const pasPrets = x.lignes.filter(l => !EC_FAIT(l.st) && !['prete', 'preparee'].includes(l.st));
    const parEtat = k => pasPrets.filter(l => l.st === k).map(l => l.d.name);
    const phrases = [[parEtat('sans'), 'n\'ont rien envoyé', 'n\'a rien envoyé'], [parEtat('saisir'), 'sont à saisir', 'est à saisir'], [parEtat('pieces'), 'ont des pièces à classer', 'a des pièces à classer'], [parEtat('valider'), 'sont à réviser', 'est à réviser']]
      .filter(([l]) => l.length).map(([l, p, u]) => `${l.length > 1 ? `${l.length} ${p} (${l.join(', ')})` : `${l[0]} ${u}`}`);
    modal(`<h2>Marquer toute la ${esc(minuscule(x.t.court))} déposée ?</h2><p class="muted pc-m-sous">Le pense-bête pour chaque dossier d'un coup.</p>
      <div class="pc-avert ambre">${EC_IC.alerte}<span><b>Elle n'est pas prête pour ${pl(pasPrets.length, 'dossier')}</b> : ${esc(phrases.join(', '))}. Les marquer déposés ferait taire leur relance.</span></div>
      <p class="pc-note">Si tu les as déposées quand même (pièces reçues ailleurs, ou néant), pointe-les plutôt sur leur ligne : chacune garde sa date et son paiement.</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary" id="ok">Annuler</button><button type="button" class="btn" id="ec-toute-oui">Marquer déposée quand même</button></div>`,
    (layer, close) => {
      $('#ok', layer).onclick = close;
      $('#ec-toute-oui', layer).onclick = () => { close(); valider(); };
    });
  }

  // ---------- écritures regroupées ----------
  //
  // Chaque paquet porte déjà ses écritures en partie double. Mais rien ne les rassemblait : pour
  // importer un mois dans son logiciel de production, le comptable devait ouvrir soixante paquets
  // un par un — exactement le travail qu'on prétend lui épargner.
  const ecrState = { from: '', to: '', ids: null };

  function moisDisponibles() {
    const s = new Set();
    (S.dossiers || []).forEach(d => (d.packs || []).forEach(p => { s.add(p.month); }));
    return [...s].sort();
  }

  function drawEcritures(view) {
    const mois = moisDisponibles();
    if (!mois.length) {
      view.innerHTML = `<div class="page-head"><h1>Écritures</h1></div>
        <div class="panel"><h2>Rien à regrouper pour l'instant</h2>
          <p>Dès qu'un de tes clients aura une écriture dans ses livres, tu pourras sortir d'ici <strong>toutes les écritures
          du mois, tous clients confondus</strong>, dans un seul fichier à importer dans ton logiciel.</p>
          <p class="small muted">Les pièces qu'un client enregistre dans SkanFact arrivent dans ses livres d'elles-mêmes ; pour un
          client hors SkanFact, c'est ce que tu saisis dans sa comptabilité.</p>
          <div class="modal-actions"><button class="btn btn-primary" id="e-dossiers">Voir mes dossiers</button></div></div>`;
      $('#e-dossiers').onclick = () => { location.hash = '#/dossiers'; };
      return;
    }
    if (!ecrState.from || !mois.includes(ecrState.from)) ecrState.from = mois[mois.length - 1];
    if (!ecrState.to || ecrState.to < ecrState.from) ecrState.to = ecrState.from;
    const plan = K.ecrituresPlan(S, { from: ecrState.from, to: ecrState.to, ids: ecrState.ids });
    // L'accord suit le compte (10.12.0, vu au test humain) : « 1 paquet n'est pas définitif … Leur mois …
    // Ils sont quand même exportés » se lisait sur l'exemple, qui en a UN.
    const provPlus = plan.provisoires.length > 1;
    const opts = m => mois.map(x => `<option value="${esc(x)}" ${m === x ? 'selected' : ''}>${esc(K.monthLabel(x))}</option>`).join('');

    view.innerHTML = `
      <div class="page-head"><h1>Écritures</h1></div>
      <p class="muted small mb">Un seul fichier CSV, toutes les écritures de la période, avec le client et le mois devant chaque ligne —
      à importer dans ton logiciel au lieu de ressaisir. ${info('e.import')}</p>
      ${/* 10.10.0 (C-07) — ce regroupement lit les PAQUETS reçus. Un client hors SkanFact n'en
            envoie aucun : il n'y entrera jamais, et le taire ferait croire à un export complet. */''}
      ${''}

      <div class="panel"><h2>La période ${info('e.periode')}</h2>
        <div class="filters">
          <label class="inline small">Du <select id="e-from">${opts(ecrState.from)}</select></label>
          <label class="inline small">au <select id="e-to">${opts(ecrState.to)}</select></label>
          <button class="btn btn-ghost btn-sm" id="e-last">Le dernier mois</button>
          <button class="btn btn-ghost btn-sm" id="e-year">Toute l'année ${esc(ecrState.to.slice(0, 4))}</button>
        </div>
        <div class="stats mt">
          <div class="stat"><div class="lbl">Mois de livres</div><div class="val">${plan.packs.length}</div>
            <div class="sub">${plan.mois.length ? pl(plan.mois.length, 'mois', 'mois') : 'aucun'}</div></div>
          <div class="stat"><div class="lbl">Clients</div><div class="val">${new Set(plan.packs.map(p => p.id)).size}</div>
            <div class="sub">${plan.sansPaquet.length ? `${plan.sansPaquet.length} sans écriture` : 'tous ont des écritures'}</div></div>
          <div class="stat"><div class="lbl">À valider</div><div class="val ${plan.provisoires.length ? 'due' : 'ok'}">${plan.provisoires.length}</div>
            <div class="sub">${plan.provisoires.length ? 'chiffres susceptibles de bouger' : 'tout est validé'}</div></div>
          <div class="stat"><div class="lbl">Période</div><div class="val" style="font-size:16px">${esc(plan.mois.length ? (plan.mois.length > 1 ? K.monthLabel(plan.mois[0]) + ' → ' + K.monthLabel(plan.mois[plan.mois.length - 1]) : K.monthLabel(plan.mois[0])) : '—')}</div></div>
        </div>

        ${plan.provisoires.length ? `<div class="warn-box mt">${info('e.provisoire')} <strong>${pl(plan.provisoires.length, 'mois')} ${provPlus ? 'sont' : 'est'} à valider</strong> :
          ${esc(plan.provisoires.slice(0, 6).join(' · '))}${plan.provisoires.length > 6 ? ' …' : ''}.
          Des écritures y sont encore au brouillard : les chiffres peuvent encore changer. ${provPlus ? 'Ils sont quand même exportés' : 'Il est quand même exporté'}.</div>` : ''}
        ${plan.sansPaquet.length ? `<p class="small mt">${info('e.manquants')} <span class="err-inline">${pl(plan.sansPaquet.length, 'client')} n'${plan.sansPaquet.length > 1 ? 'ont' : 'a'} aucune écriture sur cette période</span> :
          ${esc(plan.sansPaquet.slice(0, 8).join(', '))}${plan.sansPaquet.length > 8 ? '…' : ''}. <a href="#/relances">Les relancer</a></p>` : ''}

        <div class="modal-actions">
          <button class="btn btn-primary" id="e-go" ${plan.packs.length ? '' : 'disabled'}>Exporter les écritures…</button>
          <span class="muted small">${plan.packs.length ? 'Un seul fichier, prêt pour ton logiciel.' : 'Aucune écriture sur cette période.'}</span>
        </div>
      </div>

      ${plan.packs.length ? `<div class="panel"><h2>Ce qui sera lu</h2>
        <div class="scroll-x"><table class="list compact"><thead><tr><th class="nw">Mois</th><th>Client</th><th class="nw">Matricule</th><th>État</th></tr></thead>
        <tbody>${plan.packs.map(p => `<tr>
          <td class="nw">${esc(K.monthLabel(p.month))}</td><td>${esc(p.name)}</td>
          <td class="muted nw">${esc(p.matricule || '—')}</td>
          <td>${p.definitive ? '<span class="badge accepté">validé</span>' : '<span class="badge partielle">à valider</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;

    $('#e-from').onchange = e => { ecrState.from = e.target.value; if (ecrState.to < ecrState.from) ecrState.to = ecrState.from; render(); };
    $('#e-to').onchange = e => { ecrState.to = e.target.value; if (ecrState.to < ecrState.from) ecrState.from = ecrState.to; render(); };
    $('#e-last').onclick = () => { ecrState.from = ecrState.to = mois[mois.length - 1]; render(); };
    $('#e-year').onclick = () => {
      const an = ecrState.to.slice(0, 4);
      const dedans = mois.filter(m => m.slice(0, 4) === an);
      if (dedans.length) { ecrState.from = dedans[0]; ecrState.to = dedans[dedans.length - 1]; render(); }
    };
    $('#e-go').onclick = async () => {
      const b = $('#e-go'); b.disabled = true; b.textContent = 'Lecture des livres…';
      try {
        const r = await api.exportEcritures({ from: ecrState.from, to: ecrState.to, ids: ecrState.ids });
        if (r) showEcrituresReport(r);
      } catch (e) { toast(plainError(e), 'error'); }
      b.disabled = false; b.textContent = 'Exporter les écritures…';
    };
  }

  function showEcrituresReport(r) {
    modal(
      `<h2>${pl(r.lignes, 'ligne')} d'écriture regroupée${r.lignes > 1 ? 's' : ''}</h2>
       <div class="kv mt">
         <div><span>Clients</span><span>${r.dossiers}</span></div>
         <div><span>Mois</span><span>${esc(K.monthListLabel(r.mois))}</span></div>
         <div><span>Fichier</span><span class="path">${esc(r.path)}</span></div>
       </div>
       ${r.illisibles && r.illisibles.length ? `<div class="warn-box mt"><strong>${pl(r.illisibles.length, 'livre')} n'${r.illisibles.length > 1 ? 'ont' : 'a'} pas pu être lu${r.illisibles.length > 1 ? 's' : ''}</strong> :
         <ul class="small" style="margin:6px 0 0;padding-inline-start:18px">${r.illisibles.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
         <div class="small mt">Le fichier a quand même été écrit avec le reste : mieux vaut 95 % avec le trou signalé qu'un export qui échoue.</div></div>` : ''}
       ${r.vides && r.vides.length ? `<p class="small muted mt">${pl(r.vides.length, 'mois', 'mois')} sans aucune écriture (mois sans activité) : ${esc(r.vides.slice(0, 5).join(', '))}.</p>` : ''}
       <p class="muted small mt">Les colonnes sont celles du livre-journal de SkanFact (numéro, date, journal, pièce, compte, tiers, libellé,
       débit, crédit, lettrage, état), avec <strong>Client</strong>, <strong>Matricule</strong> et <strong>Mois</strong> ajoutées devant. Le fichier est dans tes téléchargements.</p>
       <div class="modal-actions"><span class="grow"></span><button class="btn btn-primary" id="ok">Fermer</button></div>`,
      (layer, close) => {
        $('#ok', layer).onclick = close;
      }
    );
  }

  // ---------- réglages ----------

  // Les trois onglets, et les panneaux qui vivent dans chacun. Mêmes noms que l'app entreprise :
  // un comptable qui ouvre le SkanFact d'un client doit retrouver le même rangement.
  //
  // Mesuré avant de découper (npm run e2e:parametres) : 0,74 écran pour le premier onglet, 1 pour le
  // deuxième, 0,6 pour le troisième. Le troisième reste léger — c'est le prix de la symétrie avec
  // l'autre application, et c'est pour ça que « Signaler un problème » a quitté Sécurité, où il
  // n'avait rien à faire, pour rejoindre « Aide et dépannage ».
  // ---------------------------------------------------------------- la licence du cabinet (9.4.0)
  //
  // Elle se lit dans le processus principal (hors ligne, `licence.js`) et arrive ici toute faite :
  // l'état, ce qui est compté, et POURQUOI chaque dossier compte ou ne compte pas. Un écran qui
  // annoncerait « 7 dossiers comptés » sans pouvoir les nommer serait un chiffre qu'on ne croit pas
  // — et c'est un chiffre qui décide d'une facture.
  let licCab = null;

  async function chargerLicence() {
    try { licCab = await api.licenceStatus(); } catch (e) { licCab = { erreur: plainError(e) }; }
    majBandeauLicence();
  }

  // Le bandeau, à trois tons. La décision vient de `licence.pastille`, dont un test exige qu'elle
  // soit le JUMEAU EXACT de `core.pastilleLicence` : les deux applications doivent dire la même
  // chose de la même échéance, et aucune ne peut charger le module de l'autre.
  function majBandeauLicence() {
    const el = $('#lic-banner');
    if (!el) return;
    const p = (licCab && licCab.pastille) || { show: false };
    // (1.152.0) La pastille de la barre du Cabinet, dessinée comme celle de l'abonnement (deux lignes, son ton).
    if (window.SkanAbonnementCabinet && window.SkanAbonnementCabinet.peindre) { window.SkanAbonnementCabinet.peindre(el, p); return; }
    el.hidden = !p.show;
    el.classList.toggle('warn', p.ton === 'alerte' || p.ton === 'attire');
    el.classList.toggle('calme', p.ton === 'calme');
    if (p.show) el.textContent = p.texte;
  }

  // Le panneau RELIT l'état à chaque affichage. Le compte change à chaque dossier créé, archivé ou
  // reçu : un panneau qui garderait l'état lu au démarrage annoncerait un chiffre périmé — et c'est
  // un chiffre qui décide d'une facture (règle 7.1.x : « un état lu une fois au démarrage se
  // périme »). Le coût est un appel au processus principal, et rien d'autre.
  // Les droits d'un dossier (9.9.0). Le tableau se dessine à partir de l'état déjà chargé (`S`) :
  // pas d'appel, donc pas de panneau qui apparaît une seconde après le reste.
  function panneauDroits(dossier) {
    const liste = (S.collaborateurs || []).filter(c => c.actif);
    // (plateforme) 1.139.0 — seul au cabinet, il n'y a personne à qui confier le dossier (UX 3).
    if (liste.length < 2) return '';
    const droits = dossier.droits || {};
    const confies = liste.filter(c => droits[c.id]);
    // (1.216.0) Une section de la fiche du dossier (l'ancien « Suivi » y est fondu).
    return `<section class="panel fd-p" id="d-droits" aria-labelledby="fd-dr"><div class="fd-ph"><h2 id="fd-dr">Qui travaille sur ce dossier ${info('eq.droits')}</h2><span class="fd-ph-n">${confies.length ? `confié à ${pl(confies.length, 'personne')}` : 'confié à personne'}</span></div>
      <div class="scroll-x"><table class="fd-t"><thead><tr>
        <th>Collaborateur</th><th>Rôle général</th><th>Sur ce dossier</th></tr></thead>
      <tbody>${liste.map(c => `<tr>
        <td>${esc(c.nom)}${c.id === S.moi ? ' <span class="badge">toi</span>' : ''}</td>
        <td class="muted">${esc(K.LIBELLE_ROLE[c.role])}</td>
        <td><select class="dr-role" data-collab="${esc(c.id)}" aria-label="Droit de ${esc(c.nom)} sur ce dossier">
          <option value="">— pas confié —</option>
          ${K.ROLES_COLLAB.map(r => `<option value="${r}" ${droits[c.id] === r ? 'selected' : ''}>${esc(K.LIBELLE_ROLE[r])}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody></table></div>
      ${/* « Confié » et « autorisé » ne sont pas la même question, et les confondre ferait mentir
            le « À faire » de chacun. On le DIT plutôt que de le laisser deviner. */''}
      <p class="fd-sv-n">${confies.length
    ? `Ce dossier est confié à <b>${confies.map(c => esc(c.nom)).join(', ')}</b> : il apparaît dans ${confies.length > 1 ? 'leurs' : 'son'} « À faire ».`
    : 'Ce dossier n\'est confié à personne : seuls les associés y travaillent.'}</p>
      ${/* 10.14.1 (U-11) — au repos, rien à enregistrer : le vert de la page est « Relancer ». Le
            bouton s'allume au premier choix changé (`data-enreg` + `sale`, comme les Réglages). */''}
      <div class="fd-pa"><span class="saved" id="dr-saved" hidden></span>
        <button type="button" class="btn btn-sm" id="dr-save" data-enreg>Enregistrer les droits</button></div></section>`;
  }

  function brancherDroits(view, dossier) {
    const b = $('#dr-save', view);
    if (!b) return;
    $$('.dr-role', view).forEach(sel => sel.addEventListener('change', () => sale(sel)));
    b.onclick = async () => {
      const droits = {};
      $$('.dr-role', view).forEach(s => { if (s.value) droits[s.dataset.collab] = s.value; });
      try {
        S = await api.saveDroits(dossier.id, droits);
        // La page se redessine (la phrase « confié à … » change) : le « ✓ enregistré » se pose sur
        // le panneau NEUF — posé avant, il partait avec l'ancien, et on ne le voyait jamais.
        render();
        flash($('#dr-saved'));
      } catch (e) { await infoDialog('Les droits n\'ont pas été enregistrés', plainError(e)); }
    };
  }

  // ---------------------------------------------------------------- l'équipe (9.9.0)
  //
  // Trois questions, dans cet ordre, parce que c'est l'ordre où elles se posent : qui travaille sur
  // CE poste, qui compose le cabinet, et qui a le droit de faire quoi. Tant que personne n'est
  // déclaré, le panneau ne montre qu'une phrase et un bouton — un cabinet d'une personne n'a rien
  // à régler, et lui poser une grille de droits vide serait lui vendre un problème qu'il n'a pas.
  let equipe = null;
  async function dessinerEquipe(view, dejaLu) {
    if (!dejaLu) {
      try { equipe = await api.collaborateurs(); } catch { equipe = null; }
      // La page a pu changer pendant l'attente : on redemande l'élément APRÈS (règle 7.6.0).
      return dessinerEquipe(document, true);
    }
    const box = $('#eq-panel', view);
    if (!box) return;
    if (!equipe) { box.innerHTML = '<p class="muted small">Chargement…</p>'; return; }
    const liste = (equipe.liste || []).filter(c => c.actif);
    const g = equipe.gestion || { ok: false };
    const moi = liste.find(c => c.id === equipe.moi) || null;
    // (1.333.0) Le nom du cabinet ne se change que par un associé (le serveur le refuse aux autres) : le champ se ferme AVANT
    // qu'on y tape — Rim (Saisie) tapait le nouveau nom et n'apprenait qu'à « Enregistrer » que ce n'était pas permis
    // (la règle de l'entreprise depuis la 1.327.0). La phrase sous le champ le dit en permanence : rien ne pousse la page.
    const champNom = $('#c-name');
    if (champNom && moi && moi.role !== 'supervision') { champNom.disabled = true; champNom.title = 'Seul un associé du cabinet change son nom.'; }
    box.innerHTML = `
      ${moi ? `<div class="ok-box mb" id="eq-moi"><span class="eq-phrase">Tu es connecté sous le nom de <b>${esc(moi.nom)}</b> — ${esc(K.LIBELLE_ROLE[moi.role])}.
          Chacun entre avec son propre compte : chaque écriture validée porte le nom de qui l'a validée.</span></div>` : ''}

      ${liste.length ? `<div class="scroll-x"><table class="list compact"><thead><tr>
          <th>Nom</th><th>Rôle</th><th>Adresse</th><th></th></tr></thead>
        <tbody>${liste.map(c => `<tr${c.id === equipe.moi ? ' class="eq-moi"' : ''}>
          <td>${esc(c.nom)}${c.id === equipe.moi ? ' <span class="badge">toi</span>' : ''}</td>
          <td>${esc(K.LIBELLE_ROLE[c.role])} <span class="muted small">— ${esc(K.DETAIL_ROLE[c.role])}</span></td>
          <td class="muted">${esc(c.poste || '—')}</td>
          ${g.ok && c.id !== equipe.moi ? RowMenu.cellule('EQ:' + c.id) : '<td class="row-actions"></td>'}</tr>`).join('')}</tbody></table></div>` : ''}
      ${(equipe.invitations || []).length ? `<p class="small mt"><b>Invitations qui attendent :</b></p><div class="scroll-x"><table class="list compact" id="eq-invitations"><tbody>${equipe.invitations.map(i => `<tr>
          <td>${esc(i.email)}</td><td>${esc(K.LIBELLE_ROLE[i.role])}</td><td class="muted small">jusqu'au ${esc(fmtJour(KC.jourDeLInstant(Date.parse(i.expire))))}${i.courriel === 'refuse' || i.courriel === 'sans_reponse' ? `<br><b>${i.courriel === 'refuse' ? 'e-mail refusé' : 'e-mail sans réponse du relais'}</b> : annule l'invitation et invite de nouveau (un nouveau lien)` : ''}</td>
          <td class="row-actions">${g.ok ? `<button type="button" class="btn btn-sm" data-inv="${esc(i.id)}">Annuler l'invitation</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}

      ${/* Un bouton éteint DIT pourquoi, et par la même fonction que celle qui refusera (9.4.5) :
            `peutGererCollaborateurs` est appelée côté processus principal au moment du geste, et
            son verdict voyage jusqu'ici. Deux contrôles recopiés finiraient par diverger, et
            l'écran proposerait un geste que l'enregistrement refuse. */''}
      ${g.ok ? '' : `<p class="muted small mt">${esc(g.motif || '')} ${esc(g.geste || '')}</p>`}
      <div class="modal-actions">
        <button class="btn" id="eq-add" ${g.ok ? '' : 'disabled'}>Inviter un collaborateur…</button>
      </div>
      ${(equipe.trace || []).length ? `<p class="small mt"><b>Ce qui a changé dans l'équipe</b> <span class="muted">— les derniers gestes, du plus récent au plus ancien</span></p>
        <div class="scroll-x"><table class="list compact" id="eq-trace"><tbody>${equipe.trace.map(x => `<tr>
          <td class="nw muted small">${esc(fmtJour(KC.jourDeLInstant(Date.parse(x.instant))))}</td><td>${esc(x.phrase)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="muted small">Chacun entre avec <strong>son propre compte</strong> et son code : les rôles disent
      <strong>qui</strong> a validé une écriture, et évitent qu'elle le soit par quelqu'un dont ce n'est pas le travail. Un associé
      voit tous les dossiers ; un collaborateur, ceux qu'un associé lui confie, dans la fiche du dossier, onglet <strong>Suivi</strong>.</p>`;

    const sel = $('#eq-je-suis', box);
    if (sel) {
      sel.onchange = async () => {
        try {
          await api.jeSuis(sel.value);
          S = await api.state();
          equipe = await api.collaborateurs();
          dessinerEquipe(document, true);
          toast(sel.value ? 'C\'est noté : tes gestes porteront ton nom.' : 'Plus personne n\'est déclaré sur ce poste.');
        } catch (e) { toast(plainError(e), 'error'); }
      };
    }
    const add = $('#eq-add', box);
    if (add) add.onclick = () => formCollaborateur(null);
    $$('[data-inv]', box).forEach(b => { b.onclick = async () => {
      try { await api.annulerInvitation(b.dataset.inv); equipe = await api.collaborateurs(); dessinerEquipe(document, true); toast('Invitation annulée.'); }
      catch (e) { toast(plainError(e), 'error'); }
    }; });
    RowMenu.brancherMenus(box, id => {
      const c = liste.find(x => x.id === String(id).slice(3));
      if (!c) return [];
      return [
        { icon: 'modifier', label: 'Changer son rôle', detail: 'Son nom est celui de son compte.', run: () => formCollaborateur(c) },
        { sep: true },
        { icon: 'supprimer', label: 'Retirer du cabinet', danger: true,
          detail: 'Son nom reste sur les écritures qu\'il a validées : une piste d\'audit ne s\'efface pas.',
          run: () => retirerCollaborateur(c) }
      ];
    });
  }

  // La plateforme (brique 46) : une personne rejoint le cabinet par une INVITATION, à son adresse, avec
  // son rôle ; le lien se transmet à la personne, qui l'ouvre et se connecte avec cette adresse (ou crée
  // son compte avec elle). Son nom est celui de son compte : pour quelqu'un qui est déjà là, seul le rôle
  // se change.
  function formCollaborateur(c) {
    const role = c ? c.role : 'saisie';
    modal(`<h2>${c ? 'Le rôle de ' + esc(c.nom) : 'Inviter un collaborateur'}</h2>
      ${c ? '' : `<label class="field obligatoire">${lbl('Son adresse e-mail', 'eq.email')}
        <input type="email" id="eq-email" placeholder="amine@cabinet.tn" autocomplete="off"></label>`}
      <label class="field">${lbl('Rôle', 'eq.role')}<select id="eq-role">
        ${K.ROLES_COLLAB.map(r => `<option value="${r}" ${role === r ? 'selected' : ''}>${esc(K.LIBELLE_ROLE[r])}</option>`).join('')}
      </select></label>
      <p class="muted small" id="eq-detail"></p>
      <p class="muted small">Un associé voit tous les dossiers ; un collaborateur, ceux qu'on lui confie dans la fiche du dossier.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="eq-ok">${c ? 'Enregistrer' : 'Inviter'}</button></div>`,
    (couche, close) => {
      const r = $('#eq-role', couche), d = $('#eq-detail', couche);
      const dire = () => { d.textContent = K.DETAIL_ROLE[r.value] || ''; };
      r.onchange = dire; dire();
      $('#eq-ok', couche).onclick = async () => {
        if (c) {
          try {
            S = await api.saveCollaborateur({ id: c.id, role: r.value });
            equipe = await api.collaborateurs();
            close(); dessinerEquipe(document, true);
            toast('Rôle enregistré.');
          } catch (e) { toast(plainError(e), 'error'); }
          return;
        }
        const email = $('#eq-email', couche).value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refus($('#eq-email', couche), 'Écris son adresse e-mail : c\'est avec elle qu\'il rejoindra le cabinet.');
        try {
          const inv = await api.inviterCollaborateur({ email, role: r.value });
          equipe = await api.collaborateurs();
          close(); dessinerEquipe(document, true);
          // (plateforme, 0119) Avec un relais d'e-mails, l'invitation est déjà partie : le lien reste ici en secours.
          modal(`<h2>${inv.courriel ? 'Invitation partie' : 'Invitation prête'}</h2>
            <p>${inv.courriel ? `Un e-mail est parti à <b>${esc(email)}</b> avec le lien.` : `Envoie ce lien à <b>${esc(email)}</b> (par mail, par exemple).`} Il l'ouvre, se connecte avec cette adresse — ou crée son compte
            avec elle — et rejoint le cabinet. Le lien vaut jusqu'au ${esc(fmtJour(KC.jourDeLInstant(Date.parse(inv.expire))))}, une seule fois.${inv.courriel ? ' Le voici aussi, s\'il ne trouve pas l\'e-mail :' : ''}</p>
            <p><input type="text" id="eq-lien" readonly value="${esc(inv.lien)}" style="width:100%"></p>
            <div class="modal-actions"><button class="btn" id="eq-copier">Copier le lien</button><button class="btn btn-primary" data-close>Fermer</button></div>`,
          (c2) => {
            $('#eq-copier', c2).onclick = async () => {
              try { await navigator.clipboard.writeText(inv.lien); toast('Lien copié.'); }
              catch { $('#eq-lien', c2).select(); toast('Sélectionné : copie-le avec Ctrl C.'); }
            };
          });
        } catch (e) { refus($('#eq-email', couche), plainError(e)); }
      };
    });
  }

  async function retirerCollaborateur(c) {
    const ok = await confirmDialog(`Retirer ${c.nom} ?`,
      '<p>Son nom <strong>reste</strong> sur les écritures qu\'il a validées : une piste d\'audit ne s\'efface pas, '
      + 'et c\'est elle que lit un contrôle.</p><p>Il n\'ouvrira plus le cabinet ni les dossiers qui lui étaient confiés ; '
      + 'son compte, lui, reste le sien.</p>', 'Retirer', true);
    if (!ok) return;
    try {
      S = await api.retirerCollaborateur(c.id);
      equipe = await api.collaborateurs();
      dessinerEquipe(document, true);
      toast(`${c.nom} a été retiré du cabinet.`);
    } catch (e) { await infoDialog('Ce collaborateur reste en place', plainError(e)); }
  }

  async function dessinerLicence(view, dejaLu) {
    // (plateforme, abonnement du cabinet) Le panneau dit l'abonnement que le serveur déduit, et la pastille du haut avec.
    if (api.dessinerAbonnementCabinet) {
      const boite = $('#lic-panel', view);
      if (boite) await api.dessinerAbonnementCabinet(boite);
      await chargerLicence();
      return;
    }
    if (!dejaLu) {
      await chargerLicence();
      // La page a pu changer pendant l'attente : on redemande l'élément APRÈS, jamais avant
      // (règle 7.6.0). Sinon on écrit dans un élément détaché, sans que rien ne s'affiche.
      return dessinerLicence(document, true);
    }
    const box = $('#lic-panel', view);
    if (!box) return;
    if (!licCab) { box.innerHTML = '<p class="muted small">Chargement…</p>'; return; }
    if (licCab.erreur) { box.innerHTML = `<div class="warn-box">${esc(licCab.erreur)}</div>`; return; }
    const c = licCab.comptage || { comptes: 0, liste: [], libres: [], raisons: {} };
    const boite = licCab.locked ? 'warn-box' : licCab.state === 'active' ? 'ok-box' : 'info-box';
    box.innerHTML = `
      <div class="${boite} mb"><b>${esc(licCab.label || '')}</b>${licCab.detail ? '<br>' + esc(licCab.detail) : ''}</div>
      <p class="small">On vend des <strong>dossiers</strong>, jamais des postes : installe SkanFact Cabinet sur autant
      d'ordinateurs que tu veux. Ce qui se compte, ce sont tes dossiers <strong>hors SkanFact</strong> —
      ceux dont le client n'a pas l'application. Les ${licCab.gratuits} premiers sont gratuits.</p>
      <div class="grid-2 mt">
        <div><div class="k-label">Comptés</div><div class="ver">${c.comptes}</div></div>
        <div><div class="k-label">Couverts</div><div class="ver">${licCab.autorises == null ? 'sans limite' : licCab.autorises}</div></div>
      </div>
      ${c.comptes ? `<h3 class="mt">Les dossiers comptés ${info('lic.comptes')}</h3>
        <ul class="small">${c.liste.slice(0, 40).map(d => `<li>${esc(d.name || d.id)} <span class="muted">— ${esc(d.raison)}</span></li>`).join('')}</ul>`
        : `<p class="muted small mt">Aucun dossier compté pour l'instant.</p>`}
      ${Object.keys(c.raisons).length ? `<h3 class="mt">Ce qui ne compte pas</h3>
        <ul class="small">${Object.keys(c.raisons).map(r => `<li>${esc(r)} <span class="muted">— ${pl(c.raisons[r], 'dossier')}</span></li>`).join('')}</ul>` : ''}
      <h3 class="mt">Ta clé ${info('lic.cle')}</h3>
      ${licCab.empreinte ? `<p class="small">Empreinte de ta licence ${info('lic.empreinteCle')} :
        <span class="mono">${esc(licCab.empreinte)}</span>
        <button type="button" class="btn btn-sm" id="lic-copier-emp">Copier</button></p>` : ''}
      <label class="field">${lbl('Colle ta clé ici', 'lic.cle')}<textarea id="lic-key" rows="3" spellcheck="false" placeholder="SKAN1.…">${esc(licCab.key || '')}</textarea></label>
      <div class="modal-actions">
        ${licCab.key ? '<button class="btn" id="lic-clear">Retirer la clé</button>' : ''}
        <button class="btn" id="lic-ask">Demander une licence…</button>
        <button class="btn" id="lic-save" data-enreg>Enregistrer la clé</button>
      </div>
      <p class="muted small">Ce qui part dans la demande : ton <strong>empreinte</strong>, le nombre de dossiers comptés
      et la version. <strong>Jamais un nom de client</strong> — ton portefeuille ne sort pas d'ici.</p>`;

    // Trente-deux caractères affichés sans bouton pour les prendre se recopient à la main,
    // donc se recopient faux (10.9.2).
    const cp = $('#lic-copier-emp', box);
    if (cp) {
      cp.onclick = () => copierEmpreinte(licCab.empreinte);
    }
    const sv = $('#lic-save', box);
    if (sv) {
      sv.onclick = async () => {
        try {
          licCab = await api.licenceSet($('#lic-key', box).value.trim());
          majBandeauLicence(); dessinerLicence(document, true);
          toast('Licence enregistrée.');
        } catch (e) { await infoDialog('Cette clé n\'a pas été retenue', plainError(e)); }
      };
    }
    const cl = $('#lic-clear', box);
    if (cl) {
      cl.onclick = async () => {
        const ok = await confirmDialog('Retirer la clé ?',
          '<p>Tu repasses à l\'offre gratuite : trois dossiers hors SkanFact.</p><p>Rien n\'est effacé, et tout reste lisible, importable et exportable — seule la validation d\'une écriture peut attendre si tu dépasses.</p>',
          'Retirer', true);
        if (!ok) return;
        try { licCab = await api.licenceSet(''); majBandeauLicence(); dessinerLicence(document, true); toast('Clé retirée.'); }
        catch (e) { toast(plainError(e), 'error'); }
      };
    }
    const ask = $('#lic-ask', box);
    if (ask) {
      ask.onclick = async () => {
        try {
          const m = await api.licenceRequestMail();
          await api.mail({ to: 'contact@skanfact.tn', subject: m.subject, body: m.body });
        } catch (e) { await infoDialog('Impossible d\'ouvrir le message', plainError(e)); }
      };
    }
  }

  // ---------------------------------------------------------------- Réglages → Comptabilité (9.3.0)
  //
  // Trois panneaux : les touches de la grille, les guides, la correspondance des comptes. Aucun n'a
  // de valeur imposée — c'est toute la raison d'être de cet onglet. Les touches surtout : elles se
  // reprennent de l'ancien logiciel du comptable, elles ne s'inventent pas.

  const SENS = [['debit', 'Débit'], ['credit', 'Crédit']];
  let corrBrouillon = null;                 // la table en cours d'édition, tant qu'on n'a pas enregistré

  function brancherReglagesCompta(view) {
    // La capture : on APPUIE sur la touche, elle s'inscrit. Tab est une touche comme une autre ici
    // (c'est le raccourci « solder »), donc on l'intercepte aussi — sans quoi elle sortirait du
    // champ au lieu de s'y écrire. Échap rend la main sans rien changer : il faut toujours pouvoir
    // sortir d'un champ qui avale le clavier.
    $$('[data-touche]', view).forEach(inp => {
      const vue = $(`[data-vue="${inp.dataset.touche}"]`, view);
      // La touche vit dans `data-code` ; le champ reste VIDE — il n'est que la zone où l'on appuie.
      const poser = v => { inp.dataset.code = v; if (vue) vue.innerHTML = kbd(v); sale(inp); };
      inp.onkeydown = ev => {
        if (ev.key === 'Escape') { inp.blur(); return; }
        // Un modificateur seul n'est pas un raccourci : on attend la touche qui l'accompagne.
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) { ev.preventDefault(); return; }
        ev.preventDefault();
        // (1.333.0) Une touche ne fait qu'un geste : déjà prise par un autre, elle est refusée tout de suite, en nommant ce
        // geste — enregistrée, la grille n'aurait fait que l'un des deux, sans un mot.
        const t = toucheDe(ev);
        const autre = $$('[data-touche]', view).find(x => x !== inp && String(x.dataset.code || '').toLowerCase() === t.toLowerCase());
        if (autre) { refus(inp, `${nomTouche(t)} sert déjà à « ${K.GESTES_DE_SAISIE[autre.dataset.touche] || autre.dataset.touche} » : choisis une autre touche, ou change d'abord celle-là.`); return; }
        poser(t);
      };
      inp.onfocus = () => { inp.placeholder = 'Appuie sur la touche…'; };
      inp.onblur = () => { inp.placeholder = 'Changer…'; };
    });
    $$('[data-touche-reset]', view).forEach(b => {
      b.onclick = () => {
        const k = b.dataset.toucheReset, d = K.DEFAULT_SAISIE.touches[k];
        const inp = $(`[data-touche="${k}"]`, view), vue = $(`[data-vue="${k}"]`, view);
        if (inp) inp.dataset.code = d;
        if (vue) vue.innerHTML = kbd(d);
        sale(b);
      };
    });
    const sr = $('#sr-save', view);
    if (sr) {
      sr.onclick = async () => {
        const touches = {};
        $$('[data-touche]', view).forEach(i => { touches[i.dataset.touche] = String(i.dataset.code || '').trim() || K.DEFAULT_SAISIE.touches[i.dataset.touche]; });
        // « Remettre d'origine » peut reposer une touche qu'un autre geste a prise entre-temps : le refus se dit ici aussi.
        const double = K.toucheEnDouble(touches);
        if (double) return refus(`[data-touche="${double.geste}"]`, `${nomTouche(double.touche)} sert à la fois à « ${K.GESTES_DE_SAISIE[double.deja]} » et à « ${K.GESTES_DE_SAISIE[double.geste]} » : une touche ne fait qu'un geste. Change l'une des deux.`);
        try {
          S = await api.saveCabinet({
            name: (S.cabinet || {}).name || '', email: (S.cabinet || {}).email || '', phone: (S.cabinet || {}).phone || '',
            settings: {
              saisie: {
                journalParDefaut: $('#sr-journal', view).value.trim().toUpperCase(),
                dateComplete: $('#sr-datec', view).checked,
                validerParLot: $('#sr-lot', view).checked,
                touches,
                // « Tes premiers pas » se cochent sur un GESTE (10.12.0) : `migrate` remplit ces
                // réglages d'office, leur présence ne prouve rien. L'enregistrement, si.
                regleLe: new Date().toISOString()
              }
            }
          });
          flash($('#sr-saved', view));
          // L'avertissement d'une touche en double se change sur place (sans pousser le bouton qu'on vient de cliquer) :
          // resté tel quel, il disait « F2 sert à deux gestes » sous « ✓ enregistré ».
          const dbl = $('#sr-touche-double', view);
          if (dbl) { dbl.className = 'ok-box mt'; dbl.textContent = 'Corrigé : chaque touche ne fait plus qu\'un geste dans la grille.'; }
        } catch (e) { toast(plainError(e), 'error'); }
      };
    }
    const ng = $('#sr-guide-new', view);
    if (ng) ng.onclick = () => guideForm(null);
    dessinerGuides(view);

    // F-9.6.0-12 (livré en 10.0.0) — les régimes et ce que chacun dépose. La table part VIDE : tant
    // qu'elle l'est, le calendrier ne change pas d'un pixel. C'est le cabinet qui écrit SES règles.
    const ra = $('#sr-reg-add', view);
    if (ra) ra.onclick = () => { regBrouillon = lireRegimes(view).concat([{ id: '', label: '', tva: '', cnss: true, annuelles: [] }]); dessinerRegimes(view); };
    const rb = $('#sr-reg-base', view);
    if (rb) rb.onclick = () => {
      regBrouillon = K.REGIMES.map(r => ({ id: r.id, label: r.label, tva: '', cnss: true, annuelles: [] }));
      dessinerRegimes(view);
      toast('Les trois régimes sont posés, sans aucune règle : à toi de dire ce que chacun dépose.');
    };
    const rs2 = $('#sr-reg-save', view);
    if (rs2) rs2.onclick = async () => {
      const table = lireRegimes(view).filter(r => r.id || r.label);
      if (table.some(r => !r.id || !r.label)) return toast('Chaque régime a besoin d\'un identifiant et d\'un nom.', 'error');
      try {
        S = await api.saveCabinet({ settings: { regimes: table } });
        regBrouillon = null; dessinerRegimes(view); flash($('#sr-reg-saved', view));
      } catch (e) { toast(plainError(e), 'error'); }
    };
    dessinerRegimes(view);

    const add = $('#sr-corr-add', view);
    if (add) {
      add.onclick = () => {
        corrBrouillon = lireCorrespondance(view).concat([{ de: '', vers: '', prefixe: false }]);
        dessinerCorrespondance(view);
      };
    }
    const sv = $('#sr-corr-save', view);
    if (sv) {
      sv.onclick = async () => {
        const table = lireCorrespondance(view).filter(r => r.de || r.vers);
        const v = KC.correspondanceValide(table);
        if (!v.ok) { await infoDialog('Cette correspondance n\'entre pas', v.motifs.join('\n')); return; }
        try {
          S = await api.saveCorrespondance(table);
          corrBrouillon = null;
          dessinerCorrespondance(view);
          flash($('#sr-corr-saved', view));
        } catch (e) { toast(plainError(e), 'error'); }
      };
    }
    dessinerCorrespondance(view);

    // 9.10.0 — les cycles de révision et le questionnaire de fin d'exercice. Les deux se saisissent
    // et s'enregistrent ENSEMBLE : ce sont les deux moitiés d'une même chose, la méthode du cabinet.
    const ca = $('#sr-cycles-add', view);
    if (ca) ca.onclick = () => { cyclesBrouillon = lireCycles(view).concat([{ id: '', label: '', prefixes: [] }]); dessinerCycles(view); };
    const cr = $('#sr-cycles-reset', view);
    if (cr) cr.onclick = async () => {
      if (!await confirmDialog('Reprendre les sept cycles proposés ?',
        '<p>Tes cycles à toi seront remplacés par ceux que SkanFact propose. Tu pourras les remodifier ensuite.</p>', 'Reprendre', false)) return;
      cyclesBrouillon = KC.CYCLES_REVISION.map(c => ({ ...c, prefixes: c.prefixes.slice() }));
      dessinerCycles(view);
    };
    const qa = $('#sr-quest-add', view);
    if (qa) qa.onclick = () => { questBrouillon = lireQuestionnaire(view).concat(['']); dessinerQuestionnaire(view); };
    const qs = $('#sr-quest-save', view);
    if (qs) qs.onclick = async () => {
      // Une table de cycles À MOITIÉ remplie est pire que pas de table : le compte tombe alors dans
      // un cycle qui n'a pas de nom, et la feuille maîtresse s'appelle « ».
      const cycles = lireCycles(view).filter(c => c.id || c.label || c.prefixes.length);
      const boiteux = cycles.filter(c => !c.id || !c.label || !c.prefixes.length);
      if (boiteux.length) return toast('Chaque cycle a besoin d\'un identifiant, d\'un nom et d\'au moins un préfixe de compte.', 'error');
      try {
        S = await api.saveQuestionnaire({ cycles, modeles: lireQuestionnaire(view).filter(Boolean) });
        cyclesBrouillon = null; questBrouillon = null;
        dessinerCycles(view); dessinerQuestionnaire(view);
        flash($('#sr-quest-saved', view));
      } catch (e) { toast(plainError(e), 'error'); }
    };
    dessinerCycles(view); dessinerQuestionnaire(view);

    // 10.0.0 — le modèle de liasse, qui se modifie désormais dans sa fenêtre (U-19).
    const lo = $('#sr-liasse-ouvrir', view);
    if (lo) lo.onclick = () => modeleLiasseForm(() => { const r = $('#sr-liasse-resume', view); if (r) r.innerHTML = resumeLiasse(); });
  }

  // Le modèle en UNE phrase : ce qui sert (le proposé ou le tien) et combien de rubriques par état.
  const resumeLiasse = () => {
    const propre = (S.liasse || []).length > 0;
    const table = propre ? S.liasse : KC.MODELE_LIASSE;
    const par = KC.LIASSE_ETATS.map(e => `${e.label} : ${table.filter(r => r.etat === e.id).length}`).join(' · ');
    return `<p class="small"><b>${propre ? 'Ton modèle' : 'Le modèle proposé par SkanFact'}</b> — ${esc(pl(table.length, 'rubrique'))} (${esc(par)}).</p>`;
  };

  // U-19 — la fenêtre du modèle. Même mécanique qu'avant : vide = celui que le moteur PROPOSE, et
  // dès qu'on en écrit un, il le remplace entièrement — jamais un mélange des deux, qui donnerait
  // un rattachement de compte que personne n'a décidé. Elle s'ouvre des Réglages ET de la liasse
  // d'un dossier : on ajuste le modèle là où l'on voit ce qu'il produit.
  function modeleLiasseForm(apres) {
    liasseBrouillon = null;
    // Le garde-fou de saisie en ses trois morceaux (6.8.1) : déclaré AVANT la fenêtre — `modal()`
    // appelle son montage tout de suite, et une variable lue avant sa ligne est une zone morte —,
    // armé au montage, passé à `modal()`.
    let change = () => false;
    modal(`<h2>Le modèle de liasse ${info('li.modele')}</h2>
      <p class="small">Le compte va dans la rubrique dont le préfixe est le plus <strong>long</strong>, parmi celles du bon
      sens de solde — le 44 débiteur est une créance sur l'État, le même 44 créditeur est une dette envers lui.
      <em>À VÉRIFIER : la présentation exacte n'est validée par personne ici.</em></p>
      <div id="sr-liasse"></div>
      <div class="sous-table"><button class="btn btn-sm" id="sr-liasse-add">Ajouter une rubrique</button>
        <button class="btn btn-sm" id="sr-liasse-reset">Reprendre le modèle proposé</button></div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="sr-liasse-save">Enregistrer le modèle</button></div>`,
    (layer, close) => {
      $('.modal', layer).classList.add('cab-large');
      dessinerLiasse(layer);
      change = suivreSaisie(layer);
      $('#sr-liasse-add', layer).onclick = () => { liasseBrouillon = lireLiasse(layer).concat([{ id: '', etat: 'bilan-actif', label: '', comptes: [], signe: 1, deduit: false, charge: false }]); dessinerLiasse(layer); };
      $('#sr-liasse-reset', layer).onclick = async () => {
        if (!await confirmDialog('Reprendre le modèle proposé ?',
          '<p>Tes rubriques à toi seront remplacées par celles que SkanFact propose. Tu pourras les remodifier ensuite.</p>', 'Reprendre', false)) return;
        liasseBrouillon = KC.MODELE_LIASSE.map(r => ({ ...r, comptes: (r.comptes || []).slice() }));
        dessinerLiasse(layer);
      };
      $('#sr-liasse-save', layer).onclick = async () => {
        const table = lireLiasse(layer).filter(r => r.id || r.label || r.comptes.length);
        const boiteux = table.filter(r => !r.id || !r.label);
        if (boiteux.length) return toast('Chaque rubrique a besoin d\'un code et d\'un libellé : sans eux, elle s\'imprimerait « ».', 'error');
        const doublons = table.map(r => r.id).filter((x, i, a) => a.indexOf(x) !== i);
        if (doublons.length) return toast(`Le code « ${doublons[0]} » est posé deux fois : deux rubriques ne peuvent pas porter le même.`, 'error');
        try {
          S = await api.saveLiasse({ modele: table });
          liasseBrouillon = null;
          close();
          toast('Modèle de liasse enregistré.');
          if (apres) apres();
        } catch (e) { toast(plainError(e), 'error'); }
      };
    }, () => { liasseBrouillon = null; }, { garde: () => change() || liasseBrouillon !== null });
  }

  let liasseBrouillon = null;
  const lireLiasse = view => $$('#sr-liasse tr[data-lr]', view).map(tr => ({
    id: ($('[data-k=id]', tr) || {}).value || '',
    etat: ($('[data-k=etat]', tr) || {}).value || 'bilan-actif',
    label: ($('[data-k=label]', tr) || {}).value || '',
    comptes: String((($('[data-k=comptes]', tr) || {}).value) || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean),
    // « d-1 » / « d1 » : les deux sens (10.10.0, C-08), le signe disant lequel s'imprime en plus.
    signe: /-1$/.test(($('[data-k=signe]', tr) || {}).value || '') ? -1 : 1,
    deuxSens: /^d/.test(($('[data-k=signe]', tr) || {}).value || ''),
    deduit: !!($('[data-k=deduit]', tr) || {}).checked,
    charge: !!($('[data-k=charge]', tr) || {}).checked,
    resultat: ($('[data-k=res]', tr) || {}).value === '1'
  }));

  function dessinerLiasse(view) {
    const box = $('#sr-liasse', view);
    if (!box) return;
    const table = liasseBrouillon || (S.liasse || []);
    const propose = !table.length;
    const rows = propose ? KC.MODELE_LIASSE : table;
    const d = propose ? 'disabled' : '';
    box.innerHTML = `${propose ? '<div class="sa-vide">Le modèle proposé sert tant que tu n\'en écris pas un autre.</div>' : ''}
      <div class="scroll-x"><table class="list compact sa-table sa-liasse"><thead><tr>
        <th class="nw">Code</th><th class="nw">État</th><th>Libellé</th><th>Comptes</th><th class="nw">Solde</th><th class="nw">En moins</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-lr="${i}">
        <td><input data-k="id" value="${esc(r.id)}" ${d} placeholder="AC1"></td>
        <td><select data-k="etat" ${d} aria-label="L'état où cette rubrique s'imprime">${KC.LIASSE_ETATS.map(e => `<option value="${esc(e.id)}" ${r.etat === e.id ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}</select></td>
        <td><input data-k="label" value="${esc(r.label)}" ${d} placeholder="Clients et comptes rattachés"></td>
        <td><input data-k="comptes" value="${esc((r.comptes || []).join(' '))}" ${d} placeholder="41"></td>
        <td><select data-k="signe" ${d} aria-label="Le sens du solde que cette rubrique capte">${[
          ['1', 'débiteur', !r.deuxSens && r.signe === 1], ['-1', 'créditeur', !r.deuxSens && r.signe === -1],
          ['d1', 'les deux (débiteur en plus)', r.deuxSens && r.signe === 1], ['d-1', 'les deux (créditeur en plus)', r.deuxSens && r.signe === -1]
        ].map(([v, l, on]) => `<option value="${v}" ${on ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><label class="check"><input type="checkbox" data-k="${r.charge ? 'charge' : 'deduit'}" ${(r.deduit || r.charge) ? 'checked' : ''} ${d}> ${r.charge ? 'charge' : 'déduit'}</label>
          <input type="hidden" data-k="res" value="${r.resultat ? '1' : '0'}"></td>
        <td class="sa-sup">${propose ? '' : `<button type="button" class="btn btn-sm" data-lrx="${i}" aria-label="Retirer cette rubrique">✕</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('[data-lrx]', box).forEach(b => { b.onclick = () => {
      const t = lireLiasse(view); t.splice(Number(b.dataset.lrx), 1); liasseBrouillon = t; dessinerLiasse(view);
    }; });
  }

  let cyclesBrouillon = null, questBrouillon = null;
  const lireCycles = view => $$('#sr-cycles tr[data-cy]', view).map(tr => ({
    id: ($('[data-k=id]', tr) || {}).value || '', label: ($('[data-k=label]', tr) || {}).value || '',
    prefixes: String((($('[data-k=prefixes]', tr) || {}).value) || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  }));
  const lireQuestionnaire = view => $$('#sr-quest input[data-q]', view).map(i => i.value.trim());

  function dessinerCycles(view) {
    const box = $('#sr-cycles', view);
    if (!box) return;
    const table = cyclesBrouillon || (S.cycles || []);
    const propose = !table.length;
    const rows = propose ? KC.CYCLES_REVISION : table;
    box.innerHTML = `${propose ? '<div class="sa-vide">Les sept cycles proposés servent tant que tu n\'en écris pas d\'autres.</div>' : ''}
      <div class="scroll-x"><table class="list compact sa-table"><thead><tr>
        <th class="nw">Identifiant</th><th class="nw">Nom du cycle</th><th>Préfixes de comptes</th><th></th></tr></thead>
      <tbody>${rows.map((c, i) => `<tr data-cy="${i}">
        <td><input data-k="id" value="${esc(c.id)}" ${propose ? 'disabled' : ''} placeholder="tresorerie"></td>
        <td><input data-k="label" value="${esc(c.label)}" ${propose ? 'disabled' : ''} placeholder="Trésorerie"></td>
        <td><input data-k="prefixes" value="${esc((c.prefixes || []).join(' '))}" ${propose ? 'disabled' : ''} placeholder="5 53 54"></td>
        <td class="sa-sup">${propose ? '' : `<button type="button" class="btn btn-sm" data-cyx="${i}" aria-label="Retirer ce cycle">✕</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('[data-cyx]', box).forEach(b => { b.onclick = () => {
      const t = lireCycles(view); t.splice(Number(b.dataset.cyx), 1); cyclesBrouillon = t; dessinerCycles(view);
    }; });
    if (cyclesBrouillon !== null) sale(box);
  }

  function dessinerQuestionnaire(view) {
    const box = $('#sr-quest', view);
    if (!box) return;
    const table = questBrouillon || (S.questionnaire || []).map(q => q.question);
    box.innerHTML = !table.length
      ? '<div class="sa-vide">Aucune question. Elles s\'ajoutent une à une, et se posent ensuite sur chaque exercice d\'un clic.</div>'
      : `<div class="scroll-x"><table class="list compact sa-table"><tbody>${table.map((q, i) => `<tr data-qr="${i}">
          <td><input data-q="${i}" value="${esc(q)}" placeholder="Tous les contrats de leasing ont-ils été communiqués ?"></td>
          <td class="sa-sup"><button type="button" class="btn btn-sm" data-qx="${i}" aria-label="Retirer cette question">✕</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    $$('[data-qx]', box).forEach(b => { b.onclick = () => {
      const t = lireQuestionnaire(view); t.splice(Number(b.dataset.qx), 1); questBrouillon = t; dessinerQuestionnaire(view);
    }; });
    if (questBrouillon !== null) sale(box);
  }

  let regBrouillon = null;
  const lireRegimes = view => $$('#sr-regimes tr[data-rg]', view).map(tr => ({
    id: ($('[data-k=id]', tr) || {}).value || '', label: ($('[data-k=label]', tr) || {}).value || '',
    tva: ($('[data-k=tva]', tr) || {}).value || '',
    cnss: !!($('[data-k=cnss]', tr) || {}).checked,
    annuelles: (() => {
      // Une échéance annuelle par régime, saisie en « nom / JJ-MM » : trois champs par ligne
      // auraient fait une grille de douze colonnes, illisible. Ce qui est tapé reste relu par le
      // moteur, qui borne le mois et le jour — un « 31-02 » ne peut désigner aucune date réelle.
      const t = String((($('[data-k=annuelles]', tr) || {}).value) || '').trim();
      return t ? t.split(';').map((x, i) => {
        const [nom, quand] = x.split('@').map(y => String(y || '').trim());
        const [j, m] = String(quand || '').split(/[-/]/).map(Number);
        return { id: 'a' + (i + 1), label: nom, jour: j || 0, mois: m || 0 };
      }).filter(a => a.label && a.jour && a.mois) : [];
    })()
  }));

  function dessinerRegimes(view) {
    const box = $('#sr-regimes', view);
    if (!box) return;
    const table = regBrouillon || ((S.settings || {}).regimes || []);
    box.innerHTML = !table.length
      ? `<div class="sa-vide">Aucun régime déclaré : le calendrier réclame la TVA mensuelle et la CNSS à tous tes
         clients, comme avant. Déclare-les pour qu'un forfaitaire cesse de se voir réclamer une TVA qu'il ne dépose pas.</div>`
      : `<div class="scroll-x"><table class="list compact sa-table"><thead><tr>
          <th class="nw">Identifiant</th><th class="nw">Nom du régime</th><th class="nw">TVA</th><th class="nw">CNSS</th>
          <th>Échéances annuelles</th><th></th></tr></thead>
        <tbody>${table.map((r, i) => `<tr data-rg="${i}">
          <td><input data-k="id" value="${esc(r.id)}" placeholder="forfaitaire"></td>
          <td><input data-k="label" value="${esc(r.label)}" placeholder="Régime forfaitaire"></td>
          <td><select data-k="tva" aria-label="La périodicité de TVA de ce régime">${K.TVA_PERIODES.map(p => `<option value="${esc(p.id)}" ${(r.tva || '') === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></td>
          <td><label class="check"><input type="checkbox" data-k="cnss" ${r.cnss !== false ? 'checked' : ''}> dépose</label></td>
          <td><input data-k="annuelles" value="${esc((r.annuelles || []).map(a => `${a.label}@${String(a.jour).padStart(2, '0')}-${String(a.mois).padStart(2, '0')}`).join(' ; '))}"
            placeholder="Déclaration annuelle@25-04 ; Acompte@25-06"></td>
          <td class="sa-sup"><button type="button" class="btn btn-sm" data-rgx="${i}" aria-label="Retirer ce régime">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <p class="small muted">Une échéance annuelle s'écrit <code>nom@JJ-MM</code>, séparée par un point-virgule.
        Elle porte sur l'exercice écoulé.</p>`;
    $$('[data-rgx]', box).forEach(b => { b.onclick = () => {
      const t = lireRegimes(view); t.splice(Number(b.dataset.rgx), 1); regBrouillon = t; dessinerRegimes(view);
    }; });
    if (regBrouillon !== null) sale(box);
  }

  function dessinerGuides(view) {
    const box = $('#sr-guides', view);
    if (!box) return;
    const gs = (S.guides || []).slice().sort((a, b) => K.parNom(a.nom, b.nom));
    if (!gs.length) {
      // Un état vide qui explique le geste en prose n'est pas une interface (règle 7.0.0) : le
      // bouton qui crée est juste en dessous, et cette phrase dit à quoi ça sert, pas comment faire.
      box.innerHTML = `<div class="sa-vide">Aucun guide pour l'instant. Un guide fait gagner du temps sur les pièces qui reviennent : le loyer, les honoraires, un achat avec TVA.</div>`;
      return;
    }
    box.innerHTML = `<div class="scroll-x"><table class="list compact"><thead><tr>
        <th>Nom</th><th class="nw">Journal</th><th class="r nw">Lignes</th><th>Comptes</th><th></th></tr></thead>
      <tbody>${gs.map(g => `<tr data-g="${esc(g.id)}">
        <td>${esc(g.nom || '')}</td><td class="nw">${esc(g.journal || '')}</td>
        <td class="r nw">${(g.lignes || []).length}</td>
        <td class="muted small">${esc((g.lignes || []).map(l => l.compte).filter(Boolean).join(' · '))}</td>
        ${RowMenu.cellule('G:' + g.id, '')}</tr>`).join('')}</tbody></table></div>`;
    bindRowMenus(box, cle => {
      const g = (S.guides || []).find(x => x.id === String(cle).slice(2));
      if (!g) return [];
      return [
        { icon: 'modifier', label: 'Modifier ce guide', hint: 'Ses comptes et d\'où viennent ses montants', run: () => guideForm(g) },
        { icon: 'copier', label: 'Dupliquer ce guide', hint: 'Pour en écrire un proche sans repartir de zéro',
          run: () => guideForm({ ...g, id: '', nom: (g.nom || '') + ' (copie)' }) }
      ];
    });
  }

  // Le formulaire d'un guide. La suppression vit DEDANS, comme partout depuis la 5.2.1 : plus aucun
  // « Supprimer » en bout de ligne.
  // 10.14.1 — Le montant fixe et le taux d'une ligne de guide se rangent en NOMBRE quand ils se
  // lisent, et restent tels quels sinon (le moteur les refuse alors en nommant la ligne). Rangés en
  // texte français (« 1 250,000 »), ils se relisaient par `Number()` — c'est-à-dire en rien : le
  // guide rouvert montrait une case VIDE, et l'enregistrer à nouveau effaçait le loyer fixe.
  const nombreOuTexte = v => { const t = String(v == null ? '' : v).trim(); if (!t) return ''; return montantIllisible(t) ? t : lireMontant(t); };
  const montantDuGuide = v => { const n = nombreOuTexte(v); return typeof n === 'number' ? montantSaisi(n) : n; };
  const tauxDuGuide = v => { const n = nombreOuTexte(v); return typeof n === 'number' ? String(n).replace('.', ',') : n; };
  function guideForm(guide) {
    const g = guide
      ? { ...guide, lignes: (guide.lignes || []).map(l => ({ ...l })) }
      : { id: '', nom: '', journal: '', lignes: [{ compte: '', libelle: '', sens: 'debit', base: true }, { compte: '', libelle: '', sens: 'credit', solde: true }] };
    const existe = !!(guide && guide.id && (S.guides || []).some(x => x.id === guide.id));

    const lignesHtml = () => g.lignes.map((l, i) => `<tr data-i="${i}">
      <td><input data-k="compte" value="${esc(l.compte || '')}" placeholder="607"></td>
      <td><input data-k="libelle" value="${esc(l.libelle || '')}" placeholder="Achat"></td>
      <td><select data-k="sens">${SENS.map(([v, t]) => `<option value="${v}" ${l.sens === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input data-k="montant" class="num montant" inputmode="decimal" value="${esc(montantDuGuide(l.montant))}" placeholder="fixe"></td>
      <td><input data-k="taux" class="r" inputmode="decimal" value="${esc(tauxDuGuide(l.taux))}" placeholder="%"></td>
      <td class="nw"><label class="check"><input type="checkbox" data-k="base" ${l.base ? 'checked' : ''}> base</label></td>
      <td class="nw"><label class="check"><input type="checkbox" data-k="solde" ${l.solde ? 'checked' : ''}> solde</label></td>
      <td class="sa-sup"><button type="button" class="btn btn-sm" data-sup="${i}" aria-label="Retirer cette ligne">✕</button></td>
    </tr>`).join('');

    modal(
      `<h2>${existe ? 'Modifier le guide' : 'Nouveau guide'}</h2>
       <div class="grid-2">
         <label class="field obligatoire">${lbl('Nom', 'sa.gNom')}<input type="text" id="g-nom" value="${esc(g.nom || '')}" placeholder="Achat avec TVA 19 %"></label>
         <label class="field narrow obligatoire">${lbl('Journal', 'sa.gJournal')}<input type="text" id="g-journal" maxlength="5" value="${esc(g.journal || '')}" placeholder="AC"></label>
       </div>
       <h3 class="mt">Les lignes ${info('sa.guideLigne')}</h3>
       <div class="scroll-x"><table class="list compact sa-table"><thead><tr>
         <th class="nw">Compte</th><th>Libellé</th><th class="nw">Sens</th><th class="r nw">Montant</th>
         <th class="r nw">Taux</th><th class="nw"></th><th class="nw"></th><th></th></tr></thead>
       <tbody id="g-lignes">${lignesHtml()}</tbody></table></div>
       <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm" id="g-add">Ajouter une ligne</button></div>
       <p class="muted small">« base » = le montant que tu tapes. « taux » = un pourcentage de ce montant. « solde » = ce qu'il manque pour que la pièce tombe juste — une seule ligne peut le porter.</p>
       <div class="modal-actions">
         ${existe ? '<button class="btn btn-danger" id="g-sup">Supprimer ce guide</button>' : ''}
         <button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
      (layer, close) => {
        const corps = $('#g-lignes', layer);
        const relire = () => {
          $$('tr[data-i]', corps).forEach(tr => {
            const i = Number(tr.dataset.i);
            $$('[data-k]', tr).forEach(f => {
              const k = f.dataset.k;
              g.lignes[i][k] = f.type === 'checkbox' ? f.checked : (k === 'montant' || k === 'taux') ? nombreOuTexte(f.value) : f.value;
            });
          });
        };
        const redessiner = () => { corps.innerHTML = lignesHtml(); brancher(); };
        function brancher() {
          $$('[data-k]', corps).forEach(f => { f.onchange = relire; });
          $$('[data-sup]', corps).forEach(b => {
            b.onclick = () => { relire(); g.lignes.splice(Number(b.dataset.sup), 1); redessiner(); };
          });
        }
        brancher();
        $('#g-add', layer).onclick = () => { relire(); g.lignes.push({ compte: '', libelle: '', sens: 'debit' }); redessiner(); };
        $('#no', layer).onclick = close;
        const sup = $('#g-sup', layer);
        if (sup) {
          sup.onclick = async () => {
            const ok = await confirmDialog('Supprimer ce guide ?',
              `<p>« ${esc(g.nom)} » ne sera plus proposé dans la grille.</p><p>Les écritures qu'il a déjà produites ne bougent pas : un guide ne laisse aucun lien derrière lui, il préremplit et s'efface.</p>`,
              'Supprimer', true);
            if (!ok) return;
            try {
              S = await api.saveGuides((S.guides || []).filter(x => x.id !== g.id));
              close(); dessinerGuides(document); toast('Guide supprimé.');
            } catch (e) { toast(plainError(e), 'error'); }
          };
        }
        $('#ok', layer).onclick = async () => {
          relire();
          g.nom = $('#g-nom', layer).value.trim();
          g.journal = $('#g-journal', layer).value.trim().toUpperCase();
          const v = KC.guideValide(g);
          if (!v.ok) {
            if (/nom/i.test(v.motif)) return refus($('#g-nom', layer), v.motif);
            if (/journal/i.test(v.motif)) return refus($('#g-journal', layer), v.motif);
            await infoDialog('Ce guide n\'entre pas', v.motifs.join('\n'));
            return;
          }
          if (!g.id) g.id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
          const autres = (S.guides || []).filter(x => x.id !== g.id);
          try {
            S = await api.saveGuides(autres.concat([g]));
            close(); dessinerGuides(document); toast(existe ? 'Guide modifié.' : 'Guide créé.');
          } catch (e) { toast(plainError(e), 'error'); }
        };
      }
    );
  }

  const lireCorrespondance = view => $$('#sr-corr tr[data-c]', view).map(tr => ({
    de: $('[data-k=de]', tr).value.trim(),
    vers: $('[data-k=vers]', tr).value.trim(),
    prefixe: $('[data-k=prefixe]', tr).checked
  }));

  function dessinerCorrespondance(view) {
    const box = $('#sr-corr', view);
    if (!box) return;
    const table = corrBrouillon || (S.correspondance || []);
    box.innerHTML = !table.length
      ? `<div class="sa-vide">Aucune correspondance. Tant qu'il n'y en a pas, les comptes de tes clients entrent tels quels — ce qui est le bon réglage si ton plan est le leur.</div>`
      : `<div class="scroll-x"><table class="list compact sa-table"><thead><tr>
          <th class="nw">Compte du client</th><th class="nw">Compte du cabinet</th><th class="nw">Toute la famille</th><th></th></tr></thead>
        <tbody>${table.map((r, i) => `<tr data-c="${i}">
          <td><input data-k="de" value="${esc(r.de || '')}" placeholder="411"></td>
          <td><input data-k="vers" value="${esc(r.vers || '')}" placeholder="3411"></td>
          <td><label class="check"><input type="checkbox" data-k="prefixe" ${r.prefixe ? 'checked' : ''}> préfixe</label></td>
          <td class="sa-sup"><button type="button" class="btn btn-sm" data-cs="${i}" aria-label="Retirer cette correspondance">✕</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    $$('[data-cs]', box).forEach(b => {
      b.onclick = () => {
        const t = lireCorrespondance(view);
        t.splice(Number(b.dataset.cs), 1);
        corrBrouillon = t;
        dessinerCorrespondance(view);
      };
    });
    if (corrBrouillon !== null) sale(box);
  }

  const REG_TABS = [['compte', 'Ton compte'], ['cabinet', 'Mon cabinet'], ['compta', 'Comptabilité'], ['donnees', 'Données et sécurité'], ['app', 'L\'application']];

  // Une seule table pour TROIS choses qui, écrites à trois endroits, divergent toujours : le titre du
  // panneau, les mots que sa recherche connaît sans qu'ils soient à l'écran, et son entrée de palette
  // Cmd+K. Même mécanique que SETTINGS_PANNEAUX côté entreprise, et pour la même raison : là-bas, six
  // alias écrits à la main ont nommé des onglets disparus et la palette n'a plus rien rendu.
  const REG_PANNEAUX = {
    'pan-compte': { onglet: 'compte', titre: 'Ton compte', mots: 'compte adresse email e-mail courriel mot de passe changer code telephone authentification double secours activer changer appareil verifier' },
    'pan-appareils': { onglet: 'compte', titre: 'Tes appareils', mots: 'appareil ordinateur telephone perdu vole retirer session connexion' },
    'pan-cabinet': { onglet: 'cabinet', titre: 'Ton cabinet', mots: 'cabinet nom email telephone jour relance tva cnss depot echeance' },
    'pan-appairage': { onglet: 'cabinet', titre: 'Le code de ton cabinet', mots: 'code cabinet client confier dossier mandat accepter' },
    'pan-equipe': { onglet: 'cabinet', titre: 'L\'équipe', mots: 'equipe collaborateur collaborateurs qui saisit valide supervision role droits personne poste partage plusieurs assistant stagiaire chef mission' },
    'pan-licence': api.dessinerAbonnementCabinet
      ? { onglet: 'cabinet', titre: 'Ton abonnement', mots: 'abonnement licence payer prix dossiers tenus gratuits payants plafond facture echeance lecture seule anniversaire prorata' }
      : { onglet: 'cabinet', titre: 'Licence', mots: 'licence cle payer prix dossiers hors skanfact quota gratuit acheter abonnement facture' },
    'pan-saisie': { onglet: 'compta', titre: 'La grille de saisie', mots: 'saisie clavier touches raccourci solder recopier dupliquer journal date kilometre grille brouillard validation' },
    'pan-guides': { onglet: 'compta', titre: 'Guides d\'écritures', mots: 'guide modele ecriture type loyer salaire achat tva honoraires steg prerempli abonnement recurrent' },
    'pan-comptes': { onglet: 'compta', titre: 'Correspondance des comptes', mots: 'correspondance compte plan client cabinet traduire import export numero prefixe' },
    'pan-regimes': { onglet: 'cabinet', titre: 'Les régimes et leurs échéances', mots: 'regime regimes forfaitaire reel tva mensuelle trimestrielle cnss echeance annuelle calendrier fiscal depot' },
    'pan-liasse': { onglet: 'compta', titre: 'Le modèle de liasse', mots: 'liasse nct fiscale bilan actif passif resultat rubrique rubriques etats financiers annuel depot modele' },
    'pan-questionnaire': { onglet: 'compta', titre: 'Révision : cycles et questionnaire', mots: 'revision cycle cycles feuille maitresse lead schedule questionnaire fin exercice question client trésorerie ventes achats immobilisations personnel fiscal capitaux' },
    'pan-donnees': { onglet: 'donnees', titre: 'Tes données', mots: 'donnees sauvegarde sauvegardes copie nuit serveur tunisie restaurer revenir arriere erreur exporter reprendre livres' },
    'pan-inbox': { onglet: 'donnees', titre: 'Boîte de réception', mots: 'boite reception dossier surveille paquets arrives import mail' },
    'pan-backup': { onglet: 'donnees', titre: 'Sauvegardes', mots: 'sauvegarde restaurer copie externe usb icloud filet perdu' },
    'pan-secu': { onglet: 'donnees', titre: 'Sécurité', mots: 'securite mot de passe cle de secours verrouiller chiffrement empreinte' },
    'pan-theme': { onglet: 'app', titre: 'Apparence', mots: 'theme apparence sombre clair nuit dark mode couleur fond ecran yeux' },
    'pan-maj': { onglet: 'app', titre: 'Mises à jour', mots: 'mise a jour version telecharger installer jeton token maj' },
    'pan-support': { onglet: 'app', titre: 'Aide et dépannage', mots: 'probleme bug journal log support signaler panne aide idee suggestion amelioration proposer fonctionnalite demande manque' },
    'pan-exemple': { onglet: 'app', titre: 'Exemple', mots: 'exemple demo dossiers fictifs essayer decouvrir' }
  };
  const panneauReg = (id, extra) => {
    const p = REG_PANNEAUX[id] || { titre: id, mots: '' };
    return `<div class="panel" id="${id}" data-mots="${esc(p.mots)}"><h2>${esc(p.titre)}${extra ? ' ' + extra : ''}</h2>`;
  };
  // L'onglet affiché, et le panneau qu'on veut amener à l'écran en arrivant. Les deux survivent à la
  // navigation : c'est ce qui permet à « À faire → Enregistrer ma clé de secours » d'atterrir sur le
  // bon panneau, dans le bon onglet, plutôt qu'en haut d'une page.
  let reglagesTab = 'cabinet';
  let reglagesFocus = '';
  let reglagesRefus = null;
  // (plateforme, abonnement du cabinet) Au démarrage, les Réglages se redessinent quand une relecture arrive après le
  // premier dessin (la boîte de réception, la clé de secours, les questions). Le second dessin ne savait plus quel
  // panneau amener, et remettait la page en haut : au retour d'un paiement, loin de « Ton abonnement », sur une machine
  // lente. Le panneau demandé reste demandé jusqu'à ce qu'il soit à l'écran ; un redessin sur place, sans panneau à
  // amener, garde le lecteur où il était.
  let reglagesAAmener = '';

  function drawReglages(view) {
    const c = S.cabinet || {};
    const defileur = view.closest('main') || document.scrollingElement;
    const lieu = view.querySelector('#set-corps') && !reglagesFocus && !reglagesAAmener ? { haut: defileur.scrollTop, page: window.scrollY } : null;
    if (!REG_TABS.some(t => t[0] === reglagesTab)) reglagesTab = 'cabinet';
    view.innerHTML = `
      <div class="page-head"><h1>Réglages</h1>
        <div class="actions set-search">
          <input type="search" id="set-q" placeholder="Chercher un réglage…" autocomplete="off" spellcheck="false">
        </div></div>
      <div id="set-res" class="set-res" hidden></div>
      ${/* U-13 — le bandeau existe pour que l'alerte ne se cache pas derrière un onglet (7.32.0).
            Sur l'onglet qui porte le panneau Sécurité, elle y est dite en entier : le bandeau se tait,
            sinon la clé de secours se lisait trois fois sur le même écran. */''}
      <div id="rec-banniere">${recoveryBanner()}</div>
      <div id="set-corps">
      <div class="tabs" id="set-tabs" role="tablist" aria-label="Les réglages du cabinet">${REG_TABS.map(([id, label]) =>
        `<button role="tab" data-tab="${id}" class="${id === reglagesTab ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="set-somm" id="set-somm"></div>
      <section data-pane="compte"${reglagesTab === 'compte' ? '' : ' hidden'}>
      ${panneauReg('pan-compte')}<div id="compte-panel"></div></div>
      ${panneauReg('pan-appareils')}<div id="appareils-panel"></div></div>
      </section>
      <section data-pane="cabinet"${reglagesTab === 'cabinet' ? '' : ' hidden'}>
      ${panneauReg('pan-cabinet')}
        <div class="grid-2">
          <label class="field span-2">${lbl('Nom du cabinet', 'cab.name')}<input type="text" id="c-name" value="${esc(c.name)}" placeholder="Cabinet Ben Salah"></label>
          <label class="field">${lbl('Email', 'cab.email')}<input type="email" id="c-email" value="${esc(c.email)}" placeholder="contact@cabinet.tn"></label>
          <label class="field">${lbl('Téléphone', 'cab.phone')}<input type="tel" id="c-phone" value="${esc(c.phone || '')}" placeholder="+216 …"></label>
          <label class="field narrow">${lbl('Jour de relance', 'cab.relanceDay')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="c-day" min="1" max="28" value="${Number((S.settings || {}).relanceDay) || 10}"><span class="suffixe-ap">de chaque mois</span></span></label>
          <label class="field narrow">${lbl('Pièces attendues', 'cab.seuilPieces')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="c-seuil" min="1" max="31" value="${seuilTb()}"><span class="suffixe-ap">du mois suivant</span></span></label>
          ${/* (1.333.0) Un jour se dit avec son mois, comme le jour de relance juste au-dessus (9.4.8) : « 28 » seul ne dit
                ni de quel mois ni de quoi. La TVA se dépose le mois qui suit la période, la CNSS celui qui suit le trimestre. */''}
          <label class="field narrow">${lbl('TVA : jour de dépôt', 'ec.jours')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="c-tvaday" min="1" max="31" value="${K.deadlineSettings(S).tvaDay}"><span class="suffixe-ap">du mois suivant</span></span></label>
          <label class="field narrow">${lbl('TVA des personnes physiques : jour de dépôt', 'ec.jours')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="c-tvadaypp" min="1" max="31" value="${K.deadlineSettings(S).tvaDayPP}"><span class="suffixe-ap">du mois suivant</span></span></label>
          <label class="field narrow">${lbl('CNSS : jour de dépôt', 'ec.jours')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="c-cnssday" min="1" max="31" value="${K.deadlineSettings(S).cnssDay}"><span class="suffixe-ap">du mois qui suit le trimestre</span></span></label>
        </div>
        <p class="muted small">Les jours de dépôt alimentent la page <a href="#/echeances">Échéances</a>.
        <strong>À VÉRIFIER</strong> : ils dépendent de la forme juridique, du régime et de la loi de finances.</p>
        <p class="muted small mt">Ce nom apparaît en bas des relances que tu envoies, et tes clients le lisent quand ils te confient leur dossier. Seul un associé du cabinet le change.</p>
        <div class="modal-actions"><span class="saved" id="c-saved" hidden></span><button class="btn" id="c-save" data-enreg>Enregistrer mon cabinet</button></div>
      </div>

      ${panneauReg('pan-appairage', info('cab.pairing'))}
        ${api.commentUnClientArrive(true)}
      </div>

      ${panneauReg('pan-regimes', info('rg.regimes'))}
        <p class="small">Ce que chaque <strong>régime</strong> dépose, et quand. Tant que tu n'en déclares aucun, le
        calendrier traite tous tes clients pareil — c'est le comportement d'avant, et il ne change pas tout seul.
        Dès que tu déclares un régime, les dossiers qui le portent suivent ses règles. <em>À VÉRIFIER : les
        périodicités et les dates sont les TIENNES. SkanFact n'écrit aucune règle de droit.</em></p>
        <div id="sr-regimes"></div>
        <div class="sous-table"><button class="btn btn-sm" id="sr-reg-add">Ajouter un régime</button>
          <button class="btn btn-sm" id="sr-reg-base">Partir des trois régimes proposés</button></div>
        <div class="modal-actions"><span class="saved" id="sr-reg-saved" hidden></span><button class="btn" id="sr-reg-save" data-enreg>Enregistrer les régimes</button></div>
      </div>

      ${panneauReg('pan-equipe', info('eq.equipe'))}
        <div id="eq-panel"><p class="muted small">Chargement…</p></div>
      </div>

      ${panneauReg('pan-licence', info(api.dessinerAbonnementCabinet ? 'abo.cab' : 'lic.cab'))}
        <div id="lic-panel"><p class="muted small">Chargement…</p></div>
      </div>

      </section>

      <section data-pane="compta"${reglagesTab === 'compta' ? '' : ' hidden'}>
      ${panneauReg('pan-saisie')}
        <p class="small">La grille de saisie vit dans la fiche d'un client, onglet <strong>Comptabilité → Saisie</strong>.
        Ce qui se règle ici vaut pour tous tes dossiers.</p>
        ${/* Le champ n'est plus `narrow` : son propre texte d'invite (« le dernier utilisé ») y était
              coupé au milieu. Un champ trop étroit pour ce qu'il affiche lui-même est un champ qu'on
              ne peut pas relire. Et les deux cases sont ensemble, alignées à gauche comme tout le
              reste du panneau — l'une d'elles flottait seule à droite de la grille. */''}
        <div class="grid-2">
          ${/* Une liste fermée ne se saisit jamais en texte libre (7.30.0) : un journal tapé de
                travers — « VTE » au lieu de « VT » — ne correspond à aucun journal, et la grille
                s'ouvre alors sur le premier venu sans un mot. « Le dernier utilisé » est la
                première option, parce que c'est le bon défaut et non un vide à remplir. */''}
          <label class="field narrow">${lbl('Journal proposé', 'sa.journalDefaut')}
            <select id="sr-journal">
              <option value="">le dernier utilisé</option>
              ${journauxConnus().map(j => `<option value="${esc(j)}" ${((S.settings || {}).saisie || {}).journalParDefaut === j ? 'selected' : ''}>${esc(j)}</option>`).join('')}
            </select></label>
          ${/* La case vient AVANT son libellé, comme les cinq autres de l'application. Dans une
                grille `span-2`, l'écrire après la posait 500 px à droite du texte qu'elle coche :
                l'œil la cherche à gauche et ne la trouve pas. */''}
          <label class="check span-2">
            <input type="checkbox" id="sr-datec" ${((S.settings || {}).saisie || {}).dateComplete !== false ? 'checked' : ''}>
            ${lbl('Écrire la date complète', 'sa.dateComplete')}</label>
          <label class="check span-2">
            <input type="checkbox" id="sr-lot" ${((S.settings || {}).saisie || {}).validerParLot !== false ? 'checked' : ''}>
            ${lbl('Proposer « valider tout le journal du mois »', 'sa.validerLot')}</label>
        </div>
        <h3 class="mt">${lbl('Les touches', 'sa.touches')}</h3>
        <p class="muted small">Clique sur « Changer… » et <strong>appuie sur la touche</strong> que tu veux utiliser : elle se dessine à gauche. Échap pour ressortir sans rien changer.</p>
        ${/* Chaque touche porte SA bulle : « Solder la pièce » ne dit pas ce que le geste fait, et
              c'est précisément ce qu'on veut savoir avant de lui donner une touche. */''}
        <div class="grid-2">
          ${/* Chacune est écrite en toutes lettres plutôt que produite par une boucle : la clé de la
                bulle doit être LITTÉRALE et en dernier argument, c'est ainsi qu'un test relit
                l'interface pour vérifier qu'aucun texte d'aide ne meurt oublié. */''}
          ${champTouche('ligneSuivante', 'Ligne suivante', 'sa.kSuivante')}
          ${champTouche('solder', 'Solder la pièce', 'sa.kSolder')}
          ${champTouche('recopier', 'Recopier la ligne du dessus', 'sa.kRecopier')}
          ${champTouche('dupliquer', 'Dupliquer la pièce', 'sa.kDupliquer')}
          ${champTouche('valider', 'Enregistrer et valider', 'sa.kValider')}
        </div>
        ${/* (1.333.0) Une touche donnée à deux gestes avant cette version se signale : la grille n'en fait qu'un. */''}
        ${(() => { const d = K.toucheEnDouble(((S.settings || {}).saisie || {}).touches); return d
          ? `<p class="warn-box mt" id="sr-touche-double"><strong>${esc(nomTouche(d.touche))} sert à deux gestes</strong> : « ${esc(K.GESTES_DE_SAISIE[d.deja])} » et « ${esc(K.GESTES_DE_SAISIE[d.geste])} ». Dans la grille, seul l'un des deux se fait. Change l'une des deux touches, puis enregistre.</p>` : ''; })()}
        <div class="modal-actions"><span class="saved" id="sr-saved" hidden></span><button class="btn" id="sr-save" data-enreg>Enregistrer la grille de saisie</button></div>
      </div>

      ${panneauReg('pan-guides', info('sa.guides'))}
        <p class="small">Un guide préremplit une pièce : un journal, des comptes, et d'où vient chaque montant.
        Il n'écrit rien tout seul — après le clic, tout reste modifiable.</p>
        <div id="sr-guides"></div>
        <div class="modal-actions"><button class="btn" id="sr-guide-new">Nouveau guide…</button></div>
      </div>

      ${panneauReg('pan-comptes', info('sa.correspondance'))}
        <p class="small">Traduire les comptes de tes clients vers les tiens, <strong>à l'import et à l'export</strong>.
        Une écriture déjà validée n'est jamais réécrite : elle porte le compte sous lequel tu l'as validée.</p>
        <div id="sr-corr"></div>
        <div class="sous-table"><button class="btn btn-sm" id="sr-corr-add">Ajouter une ligne</button></div>
        <div class="modal-actions"><span class="saved" id="sr-corr-saved" hidden></span><button class="btn" id="sr-corr-save" data-enreg>Enregistrer la correspondance</button></div>
      </div>

      ${panneauReg('pan-questionnaire', info('rv.reglages'))}
        <p class="small">Ta méthode de révision, écrite <strong>une fois pour tous tes dossiers</strong>. Les sept cycles
        proposés rattachent un compte à sa feuille maîtresse par son préfixe — le plus long gagne. Si ton cabinet range
        autrement, écris tes cycles ici : ils remplacent alors ceux que SkanFact propose. <em>À VÉRIFIER : aucun rattachement
        n'est une vérité comptable.</em></p>
        <div id="sr-cycles"></div>
        <div class="sous-table"><button class="btn btn-sm" id="sr-cycles-add">Ajouter un cycle</button>
          <button class="btn btn-sm" id="sr-cycles-reset">Reprendre les sept cycles proposés</button></div>
        <p class="small mt">Le <strong>questionnaire de fin d'exercice</strong> : les questions que tu poses sur chaque
        dossier avant de clôturer. Il part vide — ce sont les tiennes, pas les nôtres.</p>
        <div id="sr-quest"></div>
        <div class="sous-table"><button class="btn btn-sm" id="sr-quest-add">Ajouter une question</button></div>
        <div class="modal-actions"><span class="saved" id="sr-quest-saved" hidden></span><button class="btn" id="sr-quest-save" data-enreg>Enregistrer ma méthode</button></div>
      </div>

      ${panneauReg('pan-liasse', info('li.modele'))}
        <p class="small">Les rubriques de la <strong>liasse</strong>, et les comptes que chacune capte. Le compte va
        dans la rubrique dont le préfixe est le plus <strong>long</strong>, parmi celles du bon sens de solde — le 44
        débiteur est une créance sur l'État, le même 44 créditeur est une dette envers lui.
        <em>À VÉRIFIER : la présentation exacte du système comptable des entreprises n'est validée par personne ici.
        Confronte-la à ce que le portail attend avant de déposer.</em></p>
        ${/* U-19 — la grille de vingt-six rubriques faisait la MOITIÉ de l'onglet (1 998 px sur 4 193)
              pour un réglage qu'on touche une fois par an. Le panneau le résume ; il se modifie dans
              une fenêtre, la même que celle qu'ouvre la liasse d'un dossier. */''}
        <div id="sr-liasse-resume">${resumeLiasse()}</div>
        <div class="modal-actions"><button class="btn" id="sr-liasse-ouvrir">Voir et modifier le modèle…</button></div>
      </div>
      </section>

      <!-- Les trois panneaux ci-dessous sont remplis APRÈS coup par drawBackupPanels(). Ils restent
           donc dans le document quel que soit l'onglet affiché — un onglet dessiné paresseusement
           les laisserait sur « Chargement… » pour toujours, sans une erreur dans aucune console. -->
      <section data-pane="donnees"${reglagesTab === 'donnees' ? '' : ' hidden'}>
      ${/* (1.333.0) En ligne, l'onglet ne gardait que « Se déconnecter » : les filets du bureau (la copie sur une clé, la clé de
            secours) n'ont plus d'objet, et rien ne disait où sont les livres ni comment les reprendre. Le panneau dit ce que
            la veille du serveur a vu des copies (les mêmes phrases que l'entreprise), et comment reprendre ou défaire. */''}
      ${api.dessinerSauvegardes ? `${panneauReg('pan-donnees', info('b.donnees'))}
        <p class="small">Les livres de tes dossiers vivent sur le serveur de SkanFact, en Tunisie : tu les retrouves depuis n'importe quel
        ordinateur en te connectant. Les copies se font toutes seules, sans réglage ; ce qui suit dit ce que la surveillance du serveur en a vu.</p>
        <div id="sv-panel"><p class="muted small">Chargement…</p></div>
        <h3 class="mt">Reprendre tes livres</h3>
        <p class="small">Un dossier que tu tiens toi-même : ouvre-le, puis <strong>Consulter › Livre-journal</strong> et « Exporter le livre-journal »
        (la balance et le grand livre s'exportent de même). Un client sur SkanFact garde ses livres chez lui aussi, et les exporte de son côté.</p>
        <p class="small">Une erreur à défaire (un import, une suppression) ? Écris au support : l'équipe regarde avec toi ce qui peut revenir,
        dossier par dossier, et te dit ce qui changerait avant de faire quoi que ce soit.</p>
        <div class="modal-actions"><button class="btn" id="sv-support">Défaire une erreur : écrire au support…</button></div>
      </div>` : ''}
      ${panneauReg('pan-inbox')}<p class="muted small">Chargement…</p></div>
      ${panneauReg('pan-backup')}<p class="muted small">Chargement…</p></div>
      ${panneauReg('pan-secu')}<p class="muted small">Chargement…</p></div>
      </section>

      <section data-pane="app"${reglagesTab === 'app' ? '' : ' hidden'}>
      ${panneauReg('pan-theme')}
        <p class="small">Un logiciel de comptabilité s'ouvre le matin et se referme le soir : sur un écran
        réglé en sombre, une fenêtre blanche fatigue au bout d'une heure.</p>
        <div class="theme-choix" role="radiogroup" aria-label="Le thème de l'application">
          ${[['auto', 'Comme le système', 'suit le réglage de ton ordinateur'],
            ['light', 'Clair', 'toujours clair'],
            ['dark', 'Sombre', 'toujours sombre']].map(([v, t, sub]) => `
            <label class="theme-op${themeCourant() === v ? ' on' : ''}">
              <input type="radio" name="theme" value="${v}" ${themeCourant() === v ? 'checked' : ''}>
              <span class="theme-ap" data-ap="${v}" aria-hidden="true"><i></i><b></b></span>
              <span class="theme-t">${esc(t)}</span>
              <span class="theme-s">${esc(sub)}</span>
            </label>`).join('')}
        </div>
      </div>

      ${panneauReg('pan-maj')}<div id="upd-panel"><p class="muted small">Chargement…</p></div></div>

      ${panneauReg('pan-support')}
        ${supportCab()
          // (1.332.0) En ligne, la demande part à l'équipe SkanFact et sa réponse revient dans le Cabinet : le panneau le dit,
          // au lieu de promettre un rapport de l'application de bureau qu'on ne pouvait envoyer nulle part.
          ? `<p class="small">Une question, quelque chose qui ne marche pas comme prévu : écris à l'équipe SkanFact. Elle te répond ici, dans
        « Tes demandes au support », en général dans la journée, et un e-mail te prévient que la réponse t'attend.</p>
        <p class="small">Et s'il manque quelque chose, dis-le : ce sont les cabinets qui s'en servent qui décident de la suite.</p>
        <div class="modal-actions"><button class="btn" id="s-support">Écrire au support…</button>
        <button class="btn" id="s-idee">Proposer une amélioration…</button>
        <button class="btn" id="s-demandes">Tes demandes au support</button></div>`
          : `<p class="small">Si quelque chose ne va pas, cette fenêtre rassemble ce qu'il faut pour le comprendre :
        la version, le système, et le journal de l'application. Rien n'en part tout seul.</p>
        <p class="small">Et s'il manque quelque chose, dis-le : ce sont les cabinets qui s'en servent qui décident de la suite.</p>
        <div class="modal-actions"><button class="btn" id="s-support">Signaler un problème…</button>
        <button class="btn" id="s-idee">Proposer une amélioration…</button></div>`}
      </div>

      ${panneauReg('pan-exemple')}
        ${(S.dossiers || []).some(d => d.demo)
          ? `<p>${nbExemple()} dossiers <strong>fictifs</strong> sont chargés : ils montrent les situations que tu rencontreras, dont un client hors SkanFact.
             Ils disparaîtront d'eux-mêmes au premier vrai paquet importé.</p>
             <div class="modal-actions"><button class="btn btn-danger" id="r-demo-off">Effacer l'exemple</button></div>`
          : `<p>Tu peux charger ${nbExemple()} clients fictifs pour voir à quoi ressemble l'application pleine : un client à jour,
             un en retard, un qui n'a envoyé que du provisoire, un dont les pièces sont incomplètes, et un client hors SkanFact.</p>
             <p class="small muted">C'est aussi ce qu'il faut montrer à un confrère à qui tu parles de SkanFact.
             L'exemple s'efface tout seul dès qu'un vrai paquet arrive : aucun risque de mélange.</p>
             <div class="modal-actions"><button class="btn" id="r-demo-on">Charger l'exemple</button></div>`}
      </div>
      </section>
      </div>`;
    drawUpdatePanel();
    drawBackupPanels();
    if (api.dessinerSauvegardes && $('#sv-panel')) void api.dessinerSauvegardes($('#sv-panel'));
    const svs = $('#sv-support');
    if (svs) svs.onclick = () => ecrireAuSupportCab('question', { sujet: 'Défaire une erreur',
      texte: 'Le dossier : \nCe qui s\'est passé : \nLe jour et l\'heure, juste avant l\'erreur : ', curseur: 'Le dossier : '.length });
    void api.dessinerCompte($('#compte-panel'), { modal, toast: (texte, erreur) => toast(texte, erreur ? 'error' : undefined) });
    void api.dessinerAppareils($('#appareils-panel'));
    // Les onglets, le sommaire et la recherche : la mécanique vient de src/renderer/reglages.js,
    // partagée avec l'app entreprise, qui sait déjà basculer d'onglet — il suffit de lui dire
    // comment. Les trois rappels vont ENSEMBLE : n'en donner que deux laisse `montrer()`
    // silencieusement inerte, et on atterrit sur le bon panneau dans un onglet masqué.
    const showTab = id => {
      reglagesTab = id;
      const rb = $('#rec-banniere'); if (rb) rb.hidden = id === REG_PANNEAUX['pan-secu'].onglet;
      $$('#set-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
      $$('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== id; });
      reg.rafraichirSommaire(id);
      $('#view').scrollTop = 0;
    };
    const reg = Reglages.installer({
      corps: $('#set-corps'), champ: $('#set-q'), resultats: $('#set-res'), sommaire: $('#set-somm'),
      nomOnglet: pane => (REG_TABS.find(t => t[0] === pane) || [pane, pane])[1],
      ouvrirOnglet: pane => showTab(pane),
      ongletCourant: () => reglagesTab,
      pluriel: pl,
      rienTrouve: (mots, phrase) => `<div class="empty"><p>${phrase} Ou regarde dans l'<a href="#/aide">aide</a>.</p></div>`
    });
    $$('#set-tabs button').forEach(b => b.onclick = () => { reglagesFocus = ''; showTab(b.dataset.tab); });
    showTab(reglagesTab);
    // Un lien qui promet « la clé de secours » ou « les sauvegardes » doit amener LE PANNEAU, pas le
    // haut d'un onglet. Même porte que le sommaire et que la recherche : l'onglet suit tout seul.
    // 10.14.0 — et on l'amène APRÈS le chargement de l'onglet (règle 10.13.0 : une cible
    // asynchrone se pose après le chargement). « L'équipe » et « Licence » s'affichent
    // « Chargement… » au premier dessin et grandissent ensuite : le défilement posé tout de suite
    // visait une page plus courte, et la pastille de licence ouvrait « Le fichier à remettre »,
    // le panneau Licence 50 px sous le bas de l'écran. Trouvé à la souris.
    const vise = reglagesFocus || reglagesAAmener;
    reglagesFocus = '';
    reglagesAAmener = vise;
    const aRefuser = reglagesRefus;
    reglagesRefus = null;
    const sup = $('#s-support'); if (sup) sup.onclick = supportDialog;
    const idee = $('#s-idee'); if (idee) idee.onclick = ideeDialog;
    const dem = $('#s-demandes'); if (dem) dem.onclick = () => { location.hash = '#/support'; };
    // Le thème s'applique AVANT d'être enregistré : on choisit une apparence en la voyant, pas en
    // cliquant « Enregistrer » puis en attendant. Si l'écriture échoue, on remet ce qui était là —
    // une apparence appliquée que le disque ne porte pas reviendrait au prochain démarrage.
    $$('input[name=theme]', view).forEach(r => {
      r.onchange = async () => {
        const avant = themeCourant();
        S = { ...S, settings: { ...(S.settings || {}), theme: r.value } };
        appliquerTheme();
        try {
          S = await api.saveCabinet({ ...S.cabinet, settings: { theme: r.value } });
          $$('.theme-op', view).forEach(l => l.classList.toggle('on', l.querySelector('input').value === r.value));
        } catch (e) {
          S = { ...S, settings: { ...(S.settings || {}), theme: avant } };
          appliquerTheme();
          toast(plainError(e), 'error');
        }
      };
    });
    brancherReglagesCompta(view);
    // U-11 — une frappe ou un choix dans un panneau rend son « Enregistrer » principal (`sale`).
    // La délégation vit sur le CORPS, redessiné à chaque passage : aucun écouteur ne s'empile d'un
    // dessin à l'autre, et la recherche des réglages, posée hors du corps, ne salit rien.
    const corps = $('#set-corps', view);
    if (corps) { corps.addEventListener('input', e => sale(e.target)); corps.addEventListener('change', e => sale(e.target)); }
    Promise.allSettled([dessinerEquipe(view), dessinerLicence(view)]).then(() => {
      // (plateforme, abonnement du cabinet) Le panneau est amené : la consigne s'éteint ; un redessin sur place remet le
      // lecteur où il était, une fois les panneaux remplis.
      if (reglagesAAmener === vise) reglagesAAmener = '';
      if (lieu) { defileur.scrollTop = lieu.haut; window.scrollTo(0, lieu.page); }
      if (vise && location.hash.startsWith('#/reglages')) {
        // (plateforme, abonnement du cabinet) Le panneau est plus haut que l'écran : il arrive par son haut, sans glisser.
        const haut = vise === 'pan-licence' && api.dessinerAbonnementCabinet ? document.getElementById(vise) : null;
        if (haut) { haut.scrollIntoView({ block: 'start' }); haut.classList.add('flash'); setTimeout(() => haut.classList.remove('flash'), 1600); } else reg.montrer(vise);
      }
      if (aRefuser && location.hash.startsWith('#/reglages')) refus(aRefuser.sel, aRefuser.message);
    });
    bindRecoveryBanner(view);
    if ($('#r-demo-on')) $('#r-demo-on').onclick = async () => {
      S = await chargerOuRetirerExemple(true); toast(phraseExemple()); location.hash = '#/dossiers';
    };
    if ($('#r-demo-off')) $('#r-demo-off').onclick = async () => { S = await chargerOuRetirerExemple(false); render(); toast('Exemple effacé.'); };
    $('#c-save').onclick = async () => {
      // Les trois jours sont bornés côté processus principal, qui écarte SILENCIEUSEMENT ce qui
      // sort des bornes et remet l'ancienne valeur. L'écran, lui, affichait « ✓ enregistré » en
      // vert et gardait la valeur refusée sous les yeux : on repartait convaincu d'avoir réglé son
      // calendrier. On refuse ici, on montre le champ, et on ne félicite plus personne à tort.
      const bornes = [['#c-day', 1, 28, 'Le jour de relance'], ['#c-tvaday', 1, 31, 'Le jour de dépôt de la TVA'],
        ['#c-tvadaypp', 1, 31, 'Le jour de dépôt des personnes physiques'], ['#c-cnssday', 1, 31, 'Le jour de dépôt CNSS']];
      for (const [sel, min, max, quoi] of bornes) {
        const v = Number($(sel).value);
        if (!Number.isFinite(v) || v < min || v > max || v !== Math.round(v)) {
          return refus(sel, `${quoi} doit être un jour du mois, entre ${min} et ${max}.`);
        }
      }
      // Sur la plateforme, le serveur refuse un nom vide et une adresse illisible : on le dit ici, sur
      // le champ, avant d'envoyer quoi que ce soit.
      if (!$('#c-name').value.trim()) return refus('#c-name', 'Donne un nom à ton cabinet : il signe tes relances.');
      const courriel = $('#c-email').value.trim();
      if (courriel && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) {
        return refus('#c-email', 'L\'adresse e-mail du cabinet ne se lit pas : écris-la comme « contact@cabinet.tn ».');
      }
      try {
        S = await api.saveCabinet({
          name: $('#c-name').value.trim(), email: $('#c-email').value.trim(), phone: $('#c-phone').value.trim(),
          settings: {
            relanceDay: Number($('#c-day').value),
            seuilPieces: Number($('#c-seuil').value),
            deadlines: { tvaDay: Number($('#c-tvaday').value), cnssDay: Number($('#c-cnssday').value), tvaDayPP: Number($('#c-tvadaypp').value) }
          }
        });
        $('#brand-cab').textContent = S.cabinet.name || 'Cabinet';
        // L'écran affiche ce qui a VRAIMENT été retenu : `migrate` peut encore corriger une valeur,
        // et un champ qui montre autre chose que l'état enregistré est un mensonge de plus.
        // (Si l'on a déjà quitté les Réglages, il n'y a plus de champ à remettre.)
        const d = K.deadlineSettings(S);
        if ($('#c-day')) {
          $('#c-day').value = Number((S.settings || {}).relanceDay) || 10;
          $('#c-seuil').value = seuilTb();
          $('#c-tvaday').value = d.tvaDay; $('#c-cnssday').value = d.cnssDay; $('#c-tvadaypp').value = d.tvaDayPP;
          flash($('#c-saved'));
        }
      } catch (e) { toast(plainError(e), 'error'); }
    };
    if ($('#c-copier-emp')) $('#c-copier-emp').onclick = () => copierEmpreinte(S.cabinet.fingerprint);
    if ($('#c-pair')) $('#c-pair').onclick = () => remettreAppairage();
  }

  // 10.14.0 (l'assistant, jusqu'au bout) — le fichier d'appairage PART. Enregistré, il ne servait à
  // rien tant que le comptable n'avait pas écrit lui-même le mail, retrouvé soixante adresses et
  // expliqué où cliquer dans une application qu'il n'utilise pas. UNE porte pour les deux boutons (le
  // panneau des Réglages et « Tes premiers pas ») : l'enregistrement, puis le message tout prêt
  // (`K.mailAppairage`), adressé en copie cachée à chaque client qui a une adresse. Et l'écran dit ce
  // qui est VRAIMENT parti (E-14) : un lien `mailto:` ne joint pas de fichier, et trop d'adresses le
  // feraient couper par Windows — elles vont alors dans le presse-papiers, en le disant.
  async function remettreAppairage() {
    if (!(S.cabinet.name || '').trim()) {
      versReglages('pan-cabinet', { sel: '#c-name', message: 'Nomme d\'abord ton cabinet : son nom entre dans le fichier que tes clients importent.' });
      return;
    }
    let r;
    try { r = await api.exportPairing(); } catch (e) { toast(plainError(e), 'error'); return; }
    if (!r) return;
    // L'état porte la date de la remise (10.14.0) : « Tes premiers pas » la lisent.
    if (r.state) S = r.state;
    const nomFichier = String(r.path || '').split(/[\\/]/).pop();
    const m = K.mailAppairage(S.cabinet, S.dossiers, r.fingerprint, nomFichier);
    const qui = m.avecAdresse
      ? `<b>${pl(m.avecAdresse, 'client')}</b> ${m.avecAdresse > 1 ? 'ont' : 'a'} une adresse : le message ${m.avecAdresse > 1 ? 'leur' : 'lui'} sera adressé en copie cachée.`
        + (m.sansAdresse ? ` ${pl(m.sansAdresse, 'autre client', 'autres clients')} n'en ${m.sansAdresse > 1 ? 'ont' : 'a'} pas : ajoute-la sur sa fiche, ou écris-lui à part.` : '')
      : 'Aucun de tes clients n\'a encore d\'adresse : le message s\'ouvrira sans destinataire, et tu choisiras à qui l\'envoyer.';
    modal(`<h2>Le fichier est prêt ${info('cab.pairing')}</h2>
      <p class="small">Il ne contient rien de secret : il s'envoie par mail. Chacun de tes clients qui utilise SkanFact l'importe une fois,
      puis te lit au téléphone l'empreinte qu'il voit — si c'est la tienne, c'est bien à toi qu'il envoie.</p>
      <div class="kv mt"><div><span>Fichier</span><span class="small">${esc(r.path)}</span></div>
        <div><span>Empreinte</span><span class="fingerprint">${esc(r.fingerprint || '')}</span></div></div>
      <div class="ap-etat mt" id="ap-etat" aria-live="polite"><div class="info-box">${qui}</div></div>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button><button class="btn" id="ap-montrer">Le montrer dans le dossier</button><button class="btn btn-primary" id="ap-ecrire">Écrire à mes clients…</button></div>`,
      layer => {
        $('#ap-montrer', layer).onclick = () => api.reveal(r.path);
        $('#ap-ecrire', layer).onclick = async () => {
          let res;
          try { res = await api.mail({ bcc: m.bcc, subject: m.subject, body: m.body, attachment: r.path }); }
          catch (e) { toast(plainError(e), 'error'); return; }
          let copiees = false;
          if (m.bcc.length && !(res && res.bccInclus)) {
            try { await navigator.clipboard.writeText(m.bcc.join(', ')); copiees = true; } catch (_) { copiees = false; }
          }
          const dest = !m.bcc.length ? 'Choisis tes destinataires : aucun client n\'a d\'adresse.'
            : res && res.bccInclus ? `${m.bcc.length > 1 ? `Les ${m.bcc.length} adresses sont` : 'L\'adresse est'} en copie cachée.`
              : copiees ? `${m.bcc.length > 1 ? `Les ${m.bcc.length} adresses sont copiées` : 'L\'adresse est copiée'} : colle-${m.bcc.length > 1 ? 'les' : 'la'} dans le champ « Cci ».`
                : `Ajoute ${m.bcc.length > 1 ? 'ces adresses' : 'cette adresse'} dans le champ « Cci » : ${esc(m.bcc.join(', '))}.`;
          const piece = res && res.montre ? 'Le fichier est montré dans son dossier : glisse-le dans le message pour le joindre.'
            : `Joins le fichier au message : ${esc(r.path)}.`;
          $('#ap-etat', layer).innerHTML = `<div class="ok-box"><b>Ta messagerie s'ouvre avec le message tout prêt.</b> ${dest} ${piece}</div>`;
          // L'étape suivante n'est plus d'écrire : c'est de fermer (U-11). Le message se rouvre au besoin.
          const b = $('#ap-ecrire', layer); b.classList.remove('btn-primary'); b.textContent = 'Rouvrir le message…';
          $('[data-close]', layer).classList.add('btn-primary');
        };
      });
  }

  // ---------- les filets : sauvegardes et sécurité ----------
  function drawBackupPanels() {
    const b = $('#pan-backup'), s = $('#pan-secu'), inb = $('#pan-inbox');
    if (!b || !s || !inb) return;
    const inf = backupInfo || { list: [], external: {}, packs: {}, dir: '' };
    const ext = inf.external || {};
    const list = inf.list || [];

    b.innerHTML = `<h2>Sauvegardes ${info('b.daily')}</h2>
      <p class="small">Chaque jour, avant la première modification, SkanFact met de côté ton fichier tel qu'il était ce matin-là.
      Une sauvegarde est prise aussi avant chaque import et avant chaque suppression. Trente jours sont conservés.</p>

      <div class="kv mt">
        <div><span>Sauvegardes</span><span>${list.length ? `${pl(list.length, 'fichier')} · la plus récente ${esc(fmtWhen(list[0].mtime))}` : '<span class="muted">aucune pour l\'instant</span>'}</span></div>
        <div><span>${lbl('Copie externe', 'b.external')}</span><span>${ext.dir
          ? esc(ext.dir) + (ext.lastError ? ` <span class="err-inline">⚠ ${esc(ext.lastError)}</span>` : ext.lastCopy ? ` <span class="muted small">copié ${esc(fmtWhen(Date.parse(ext.lastCopy)))}</span>` : '')
          : '<span class="muted">aucune — c\'est le seul filet qui te protège d\'une panne de disque</span>'}</span></div>
        <div><span>Paquets sur ce poste</span><span>${inf.packs && inf.packs.files ? `${pl(inf.packs.files, 'fichier')} · ${esc(fmtBytes(inf.packs.bytes))}` : '<span class="muted">aucun</span>'}</span></div>
        <div><span>${lbl('Emplacement', 'b.where')}</span><span class="path">${esc(inf.dir || '')}</span></div>
      </div>

      ${!ext.dir ? `<div class="warn-box mt"><strong>Aucune copie hors de cet ordinateur.</strong>
        Les sauvegardes quotidiennes sont sur le même disque que tes données : elles ne te sauveront pas d'une panne, d'un vol ou d'un vol d'ordinateur.
        Choisis une clé USB, un disque externe ou un dossier synchronisé (iCloud Drive, OneDrive).</div>` : ''}

      <h3 class="mt">Sauvegardes et copies</h3>
      <div class="modal-actions wrap">
        <button class="btn" id="b-now">Sauvegarder maintenant</button>
        <button class="btn" id="b-ext">${ext.dir ? 'Changer le dossier de copie…' : 'Choisir un dossier de copie…'}</button>
        ${ext.dir ? '<button class="btn" id="b-mirror">Copier maintenant</button><button class="btn btn-ghost" id="b-ext-off">Ne plus copier</button>' : ''}
        <span class="grow"></span>
        <button class="btn" id="b-open">Ouvrir le dossier</button>
      </div>

      ${list.length ? `<h3 class="mt">${lbl('Restaurer une sauvegarde', 'b.restore')}</h3>
      <div class="scroll-x"><table class="list compact"><thead><tr><th>Sauvegarde</th><th class="nw">Date</th><th class="r">Taille</th><th></th></tr></thead>
      <tbody>${list.slice(0, 40).map((x, i) => `<tr>
        <td>${esc(x.daily ? 'Quotidienne' : x.name.replace(/-\d{4}-\d{2}-\d{2}_.*$/, '').replace(/_/g, ' '))}
          <span class="muted small">${x.livres ? '· avec les livres' : '· sans les livres'}</span></td>
        <td class="nw">${esc(fmtWhen(x.mtime))} <span class="muted small">${esc(ago(x.mtime))}</span></td>
        <td class="r muted nw">${esc(fmtBytes(x.size + (x.livresSize || 0)))}</td>
        <!-- Un bouton fantôme n'a ni bordure ni couleur, et c'est ici le bouton du pire jour :
             celui où l'on vient rechercher ce qu'on a perdu. Il ressemble maintenant à un bouton. -->
        <td class="actions row-actions"><button class="btn btn-sm" data-restore="${i}">Restaurer cette sauvegarde…</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;

    // La boîte de réception vivait DANS le panneau des sauvegardes, sous un simple <h3>. Ce n'est
    // pas un filet : c'est la porte par laquelle les paquets ARRIVENT, le geste le plus fréquent de
    // l'application. Elle a son panneau, et il passe avant les filets.
    inb.innerHTML = `<h2>${lbl('Boîte de réception', 'b.inbox')}</h2>
      <p class="small">Le dossier où tu ranges les paquets reçus par mail. SkanFact regarde ce qui est arrivé et te le propose —
      il n'importe jamais tout seul, et n'efface jamais rien.</p>
      <div class="kv">
        <div><span>Dossier surveillé</span><span>${inboxInfo && inboxInfo.dir
          ? esc(inboxInfo.dir) + (inboxInfo.erreur ? ` <span class="err-inline">⚠ ${esc(inboxInfo.erreur)}</span>`
            : ` <span class="muted small">${(inboxInfo.nouveaux || []).length ? pl(inboxInfo.nouveaux.length, 'paquet') + ' en attente' : 'rien de nouveau'}</span>`)
          : '<span class="muted">aucun — tu importes les paquets un par un</span>'}</span></div>
      </div>
      <div class="modal-actions wrap">
        <button class="btn" id="i-pick">${inboxInfo && inboxInfo.dir ? 'Changer de dossier…' : 'Choisir un dossier…'}</button>
        ${inboxInfo && inboxInfo.dir ? '<button class="btn" id="i-off">Ne plus surveiller</button>' : ''}
      </div>`;

    s.innerHTML = `<h2>Sécurité</h2>
      <p class="small">Le fichier de ce cabinet est chiffré avec ton mot de passe (AES-256). Il contient la clé qui ouvre les paquets de
      tes clients : si ce poste est perdu ou volé, personne ne peut les lire.</p>

      ${/* U-13 — UNE phrase, et l'orange seulement quand il y a un geste à faire. Le panneau disait
            « Ta clé n'existe qu'ici » dans un encadré orange MÊME une fois la clé enregistrée, puis
            la même chose une seconde fois dans sa ligne d'état. `undefined` = on ne sait pas encore
            (la date arrive par une promesse) : on ne crie pas. */''}
      ${/* 10.14.1 — sans paquet VRAI reçu, la clé ne protège encore rien : l'orange et le bouton vert
            répétaient au cabinet neuf une menace (« aucun paquet déjà reçu… ») sur des paquets qui
            n'existent pas, pendant que la visite « Mettre mon cabinet à l'abri » l'amenait ici pour la
            copie. Le bandeau de la page (`recoveryBanner`) fait déjà ce choix depuis la 9.4.4. */''}
      ${recoveryAt === null && !paquetsReelsRecus() ? `<p class="small muted mt" id="s-rec-plus-tard">${lbl('Pas encore de clé de secours.', 'b.recovery')}
      Elle ne protège que les paquets reçus de tes clients, et tu n'en as reçu aucun : enregistre-la au premier paquet — l'application te le rappellera.</p>`
    : recoveryAt === null ? `<div class="warn-box mt"><strong>${lbl('Tu n\'as jamais enregistré de clé de secours.', 'b.recovery')}</strong>
      Elle n'existe qu'ici : ni nous, ni personne d'autre ne peut la reconstituer. Sans elle et sans cet ordinateur,
      <strong>aucun paquet déjà reçu ne pourra plus être ouvert</strong>, et tes clients devront tous réimporter un nouveau
      fichier d'appairage. Trois minutes maintenant, une fois pour toutes.</div>`
    : recoveryAt ? `<p class="small ligne-ok mt" id="s-rec-ok"><span aria-hidden="true">✓</span> Clé de secours enregistrée le ${esc(fmtDay(recoveryAt))}
      ${info('b.recovery')} — vérifie qu'elle n'est pas sur ${CE_POSTE()}.</p>` : ''}

      <div class="modal-actions wrap">
        <button class="btn${recoveryAt === null && paquetsReelsRecus() ? ' btn-primary' : ''}" id="s-rec">Enregistrer ma clé de secours…</button>
        <button class="btn" id="s-rec-in">Restaurer une clé de secours…</button>
        <span class="grow"></span>
        <button class="btn" id="s-pw">Changer le mot de passe…</button>${info('b.password')}
        <button class="btn" id="s-lock">Se déconnecter</button>
      </div>

      <p class="muted small mt">Tu changes d'ordinateur ? N'y crée <strong>jamais</strong> un cabinet neuf : il aurait une autre empreinte,
      et les paquets de tes clients y seraient refusés. Emporte ton dossier de copie, puis reprends-le depuis l'écran de mot de passe
      (« J'ai déjà un cabinet sur un autre ordinateur »). <a href="#/aide">Aide → Changer d'ordinateur</a>.</p>

      <p class="muted small mt">À VÉRIFIER avec ton assureur ou ton Ordre : la conservation des pièces de tes clients sur ce poste
      relève des mêmes obligations que tes archives papier.</p>`;

    const ip = $('#i-pick', inb);
    if (ip) ip.onclick = async () => {
      try {
        const r = await api.pickInbox();
        if (r) { inboxInfo = r; drawBackupPanels(); toast(r.nouveaux.length ? `${pl(r.nouveaux.length, 'paquet')} en attente dans ce dossier.` : 'Dossier surveillé.'); }
      } catch (e) { toast(plainError(e), 'error'); }
    };
    const io = $('#i-off', inb);
    if (io) io.onclick = async () => { inboxInfo = await api.clearInbox(); drawBackupPanels(); };
    $('#b-now').onclick = quickBackup;
    $('#b-open').onclick = () => api.openDataDir();
    $('#b-ext').onclick = async () => {
      try {
        const r = await api.pickExternal();
        if (r) { backupInfo = await api.backups(); drawBackupPanels(); toast(r.lastError ? 'Dossier choisi, mais la copie a échoué : ' + r.lastError : 'Copie faite.'); }
      } catch (e) { toast(plainError(e), 'error'); }
    };
    const off = $('#b-ext-off');
    if (off) off.onclick = async () => {
      const ok = await confirmDialog('Ne plus copier ?', '<p>Les fichiers déjà copiés restent où ils sont. Plus rien n\'y sera ajouté.</p>', 'Arrêter la copie', true);
      if (!ok) return;
      await api.clearExternal(); backupInfo = await api.backups(); drawBackupPanels();
    };
    const mir = $('#b-mirror');
    if (mir) mir.onclick = async () => {
      const r = await api.mirrorNow();
      backupInfo = await api.backups(); drawBackupPanels();
      toast(r.ok ? 'Copie faite.' : 'Copie impossible : ' + (r.lastError || 'support introuvable'), r.ok ? '' : 'error');
    };
    $$('[data-restore]', b).forEach(btn => { btn.onclick = () => doRestore(list[Number(btn.dataset.restore)]); });

    $('#s-rec').onclick = exportRecovery;
    $('#s-rec-in').onclick = importRecovery;
    $('#s-pw').onclick = changePassword;
    $('#s-lock').onclick = () => seDeconnecter();
  }

  // Le bandeau qui ne peut pas se cacher derrière un onglet. Les onglets rangent — mais ils rangent
  // AUSSI ce qu'il ne faut jamais ranger : cet avertissement-ci ne vivait que dans le panneau
  // Sécurité, à un écran et demi de défilement. Il est maintenant au-dessus de la barre d'onglets,
  // et dans « À faire » sur la page d'accueil. Il disparaît le jour où la clé est enregistrée.
  // Un paquet VRAI, c'est-à-dire reçu d'un client : ceux du jeu d'exemple sont fictifs, et leur perte ne
  // coûterait rien (10.14.0 — la découverte criait la clé de secours en rouge dès son premier écran).
  function paquetsReelsRecus() {
    return (S.dossiers || []).some(d => !d.demo && (d.packs || []).length);
  }
  // Un exercice est TERMINÉ le lendemain de son 31 décembre (jour local, 5.2.3). Avant, clôturer
  // reste possible mais n'est jamais l'étape suivante : le bouton ne se colore pas (U-11).
  function exerciceTermine(annee) {
    return K.today() > `${annee}-12-31`;
  }
  function recoveryBanner() {
    if (recoveryAt !== null) return '';
    // 9.4.4 — l'avertissement est juste, le MOMENT ne l'était pas. Le tout premier écran d'un
    // comptable, avant qu'il ait un seul client, était un bandeau rouge : un premier contact qui
    // menace, et un rouge permanent dès le jour 0 apprend à ignorer le rouge. Tant qu'aucun paquet
    // n'est arrivé, il n'y a rien à perdre — c'est la règle « un filet se réclame au moment où il
    // protège encore » (QUESTIONS.md), prise par l'autre bout. Le rouge apparaît au premier paquet,
    // c'est-à-dire le jour où quelque chose d'irremplaçable est sur ce disque.
    if (!paquetsReelsRecus()) {
      return `<div class="banner"><span><strong>Pense à enregistrer ta clé de secours.</strong>
        C'est elle qui te rendra tes paquets si tu changes d'ordinateur ou si celui-ci est perdu.
        Trois minutes, une fois pour toutes.</span>
        <button class="btn btn-sm nw" id="rec-go">Enregistrer ma clé…</button></div>`;
    }
    return `<div class="banner danger"><span><strong>Tu n'as pas de clé de secours.</strong>
      Si cet ordinateur est perdu, aucun paquet déjà reçu ne pourra plus être ouvert et tes clients devront tous
      refaire leur appairage.</span>
      <button class="btn btn-primary btn-sm nw" id="rec-go">Enregistrer ma clé…</button></div>`;
  }
  // `recoveryAt` vaut `undefined` tant qu'on ne sait pas (la date vit dans app-config.json et arrive
  // par une promesse), `null` quand il n'y en a pas, un nombre sinon. La distinction compte : sur
  // « je ne sais pas encore », on ne crie pas.
  let recoveryAt;
  // Une seule demande par session : l'import est déjà fait quand on la pose, et redemander à chaque
  // fois ferait cliquer « Plus tard » sans lire.
  let cleReclameeCetteSession = false;
  function chargerRecovery(redessiner) {
    // (plateforme) Pas de clé de secours en ligne (C4) : « on ne sait pas » reste la réponse, et rien
    // ne se réclame (ni ligne dans « À faire », ni bandeau).
    if (api.sansCleDeSecours === true) return Promise.resolve();
    if (!api.recoveryStatus) { recoveryAt = null; return Promise.resolve(); }
    const avant = recoveryAt;
    return api.recoveryStatus().then(r => {
      recoveryAt = (r && r.exportedAt) || null;
      // Un état lu une fois au démarrage se périme (règle 7.1.x) : on ne redessine que s'il a
      // vraiment changé, pour ne pas effacer une saisie en cours.
      if (redessiner && recoveryAt !== avant && !$('#modal-root').children.length && !$('#palette-root')) render();
    }).catch(() => { recoveryAt = null; });
  }

  // Les questions sans réponse, résumées dossier par dossier (9.10.0). Lues dans les INDEX, jamais
  // en déchiffrant soixante livres (mesure de la 9.1.0), et comme `recoveryAt` : on ne redessine
  // que si le chiffre a vraiment changé, pour ne pas effacer une saisie en cours.
  let questionsAttente = [];
  // Ce que les livres savent des employeurs, mois par mois, lu dans le même résumé des index
  // (10.12.0, U-21). La page Échéances et « À faire » le reçoivent tous les deux : deux écrans qui
  // comptent la même CNSS avec deux connaissances différentes finiraient par se contredire.
  const employeursConnus = () => Object.fromEntries(questionsAttente.map(q => [q.dossierId, q.employeur || {}]));
  // Les livres des dossiers TENUS AU CABINET (10.12.0), du même résumé : ils entrent dans le
  // calendrier et dans « À faire » avec leurs mois à saisir, jamais comme des retardataires.
  const tenusConnus = () => Object.fromEntries(questionsAttente.filter(q => q.tenu).map(q => [q.dossierId, q.tenu]));
  // Les mois dont la déclaration est notée déposée dans le livre de chaque client (10.14.1).
  const declaresConnus = () => Object.fromEntries(questionsAttente.filter(q => (q.declares || []).length).map(q => [q.dossierId, q.declares]));
  // (1.168.0) Ce que le serveur sait d'un mois d'un dossier : sa déclaration, ses écritures, celles au brouillard.
  const moisConnu = (id, m) => ((questionsAttente.find(q => q.dossierId === id) || {}).mois || {})[m] || null;
  const declarationConnue = (id, m) => (moisConnu(id, m) || {}).declaration || null;
  const brouillardsConnus = (id, m) => Number((moisConnu(id, m) || {}).brouillards || 0);
  const ecrituresConnues = (id, m) => Number((moisConnu(id, m) || {}).ecritures || 0);
  // (plateforme) 1.138.0 — la lecture refusée se retient : les Échéances disaient « Aucune échéance à suivre » d'une
  // lecture qui avait échoué (UX 2). Ce qu'on savait avant reste, plutôt qu'une liste vide.
  let questionsAttenteRefus = null;
  // (1.168.0) Lu au moins une fois : avant, les Échéances se dessinent en squelette, sans rien affirmer.
  let questionsAttenteLues = false;
  function chargerQuestionsAttente(redessiner) {
    if (!api.questionsEnAttente) return Promise.resolve();
    const avant = JSON.stringify(questionsAttente);
    return api.questionsEnAttente().then(r => {
      // La première lecture redessine toujours, même vide : les Échéances quittent leur squelette.
      const premiere = !questionsAttenteLues;
      questionsAttenteRefus = null;
      questionsAttenteLues = true;
      questionsAttente = Array.isArray(r) ? r : [];
      if (redessiner && ((premiere && location.hash.startsWith('#/echeances')) || JSON.stringify(questionsAttente) !== avant) && !$('#modal-root').children.length && !$('#palette-root')) render();
    }).catch(x => {
      const deja = questionsAttenteRefus;
      questionsAttenteRefus = x;
      if (redessiner && !deja && location.hash.startsWith('#/echeances') && !$('#modal-root').children.length && !$('#palette-root')) render();
    });
  }

  async function doRestore(entry) {
    if (!entry) return;
    let peek;
    try { peek = await api.peekBackup(entry.path); }
    catch (e) {
      const msg = plainError(e);
      if (!/autre mot de passe/i.test(msg)) return toast(msg, 'error');
      const pw = await askPassword('Sauvegarde d\'un autre mot de passe', 'Cette sauvegarde a été chiffrée avec un mot de passe différent de celui d\'aujourd\'hui.', 'Lire');
      if (!pw) return;
      try { peek = await api.peekBackup(entry.path, pw); } catch (e2) { return toast(plainError(e2), 'error'); }
      return confirmRestore(entry, peek, pw);
    }
    confirmRestore(entry, peek, null);
  }

  async function confirmRestore(entry, peek, password) {
    const dd = peek.actuels.dossiers - peek.dossiers;
    const dp = peek.actuels.paquets - peek.paquets;
    const ok = await confirmDialog('Restaurer cette sauvegarde ?',
      `<p>Sauvegarde du <strong>${esc(fmtWhen(entry.mtime))}</strong>.</p>
       <table class="list compact"><thead><tr><th></th><th class="r">La sauvegarde</th><th class="r">Maintenant</th></tr></thead>
       <tbody><tr><td>Dossiers</td><td class="r">${peek.dossiers}</td><td class="r">${peek.actuels.dossiers}</td></tr>
       <tr><td>Paquets</td><td class="r">${peek.paquets}</td><td class="r">${peek.actuels.paquets}</td></tr>
       <tr><td>Livres (écritures du cabinet)</td><td class="r">${peek.livres == null ? '<span class="muted">aucun</span>' : peek.livres}</td><td class="r">${peek.actuels.livres || 0}</td></tr></tbody></table>
       ${dd > 0 || dp > 0 ? `<p class="warn-box mt">Tu perdrais <strong>${dd > 0 ? pl(dd, 'dossier') : ''}${dd > 0 && dp > 0 ? ' et ' : ''}${dp > 0 ? pl(dp, 'paquet') : ''}</strong> enregistrés depuis.</p>` : ''}
       ${/* Une restauration dit d'abord ce qu'elle ne rendra PAS (T-35) : une quotidienne, ou une
             sauvegarde d'avant la 9.8.8, ne porte pas les livres. Ils resteront tels qu'ils sont —
             ni rendus, ni détruits — et c'est écrit avant le clic. */''}
       ${peek.livres == null && peek.actuels.livres
         ? `<p class="warn-box mt">Cette sauvegarde <strong>ne porte pas les livres</strong> (${pl(peek.actuels.livres, 'livre')} aujourd'hui) : ils resteront tels qu'ils sont. Seules les sauvegardes prises à la main (« Sauvegarder maintenant ») et celles d'avant un geste important les emportent — pas la sauvegarde quotidienne.</p>`
         : peek.livres > 1 ? `<p class="small">Les ${pl(peek.livres, 'livre')} de la sauvegarde remplaceront ceux d'aujourd'hui qui portent le même nom.</p>`
         : peek.livres === 1 ? '<p class="small">Le livre de la sauvegarde remplacera celui d\'aujourd\'hui qui porte le même nom.</p>'
         : peek.livres === 0 ? '<p class="small">La sauvegarde ne porte aucun livre : ceux d\'aujourd\'hui resteront tels qu\'ils sont.</p>' : ''}
       <p class="muted small">Une sauvegarde de l'état actuel, livres compris, est prise juste avant : tu pourras revenir en arrière.</p>`,
      'Restaurer', dd > 0 || dp > 0);
    if (!ok) return;
    try {
      S = await api.restore(entry.path, password);
      backupInfo = await api.backups();
      render(); toast('Sauvegarde restaurée.');
    } catch (e) { toast(plainError(e), 'error'); }
  }

  function exportRecovery(onDone) {
    modal(
      `<h2>Clé de secours</h2>
       <p class="small">Ce fichier contient la clé qui <strong>ouvre les paquets de tes clients</strong>. Protège-le par un mot de passe
       (différent de celui de l'application : ce fichier a vocation à quitter cet ordinateur).</p>
       <div class="warn-box">Range-le <strong>ailleurs que sur ${CE_POSTE()}</strong> : une clé USB dans un tiroir, un coffre, chez ton associé.
       Une clé de secours posée à côté de l'ordinateur ne protège de rien.</div>
       <label class="field mt">${lbl('Mot de passe du cabinet', 'b.pwCabinet')}<input type="password" id="p0" autocomplete="current-password"></label>
       <p class="muted small">Redemandé parce que ce fichier ouvre les comptabilités de tous tes clients : sans ça, n'importe qui passant devant ce poste déverrouillé repartirait avec.</p>
       <label class="field mt">${lbl('Mot de passe de ce fichier', 'b.pwFichier')}<span class="pw-wrap"><input type="password" id="p1" autocomplete="new-password"><button type="button" class="pw-eye" id="eye">Afficher</button></span></label>
       <label class="field mt">${lbl('Confirme', 'b.pwConfirme')}<input type="password" id="p2" autocomplete="new-password"></label>
       <div class="modal-actions"><button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Enregistrer le fichier…</button></div>`,
      (layer, close) => {
        const p1 = $('#p1', layer), p2 = $('#p2', layer);
        $('#eye', layer).onclick = () => {
          const t = p1.type === 'password' ? 'text' : 'password';
          p1.type = t; p2.type = t; $('#eye', layer).textContent = t === 'password' ? 'Afficher' : 'Masquer';
        };
        enchainerConfirmation(p1, p2);
        $('#no', layer).onclick = close;
        $('#ok', layer).onclick = async () => {
          // Le refus MONTRE la case (règle 7.20.0) ; un toast seul laissait chercher laquelle.
          const vm = K.verdictMotDePasse(p1.value, p2.value, 8);
          if (!vm.ok) return refus(vm.champ === 'confirmation' ? p2 : p1, vm.message);
          try {
            const r = await api.exportRecovery(p1.value, $('#p0', layer).value);
            if (!r) return;
            close();
            recoveryAt = Date.now();
            // Le bandeau et la ligne « À faire » vivent hors de ces trois panneaux : sans un
            // redessin complet, l'application continuerait de reprocher à quelqu'un ce qu'il vient
            // très exactement de faire (règle 7.17.0).
            drawBackupPanels();
            if (location.hash.startsWith('#/reglages') || location.hash.startsWith('#/dossiers')) render();
            if (onDone) onDone();
            const show = await confirmDialog('Clé de secours enregistrée',
              `<p class="muted small">${esc(r.path)}</p><p>Copie-la maintenant sur une clé USB ou un disque que tu ranges ailleurs, et <strong>efface-la de ${CE_POSTE()}</strong>.</p>`,
              'La montrer dans le dossier', false, 'Fermer');
            if (show) api.reveal(r.path);
          } catch (e) { toast(plainError(e), 'error'); }
        };
      }
    );
  }

  async function importRecovery() {
    const ok = await confirmDialog('Restaurer une clé de secours ?',
      `<p>La clé actuelle de ce cabinet sera <strong>remplacée</strong> par celle du fichier.</p>
       <p class="muted small">À faire quand tu réinstalles l'application sur un nouvel ordinateur. Si tu le fais par erreur,
       les paquets déjà reçus avec l'ancienne clé ne s'ouvriront plus. Une sauvegarde est prise juste avant.</p>`,
      'Continuer', true);
    if (!ok) return;
    const pw = await askPassword('Mot de passe de la clé de secours', 'Celui que tu as choisi en l\'enregistrant.', 'Restaurer');
    if (!pw) return;
    try {
      const r = await api.importRecovery(pw);
      if (!r) return;
      await refresh(); render();
      toast('Clé restaurée. Empreinte : ' + r.fingerprint);
    } catch (e) { toast(plainError(e), 'error'); }
  }

  function changePassword() {
    modal(
      `<h2>Changer le mot de passe</h2>
       <p class="small">Le fichier du cabinet et toutes ses sauvegardes seront rechiffrés avec le nouveau mot de passe.</p>
       <label class="field">${lbl('Mot de passe actuel', 'b.pwActuel')}<input type="password" id="p0" autocomplete="current-password"></label>
       <label class="field mt">${lbl('Nouveau mot de passe', 'b.pwNouveau')}<span class="pw-wrap"><input type="password" id="p1" autocomplete="new-password"><button type="button" class="pw-eye" id="eye">Afficher</button></span><span class="muted small ligne-reservee" id="str"></span></label>
       <label class="field mt">${lbl('Confirme', 'b.pwConfirme')}<input type="password" id="p2" autocomplete="new-password"></label>
       <div class="warn-box mt">Il n'y a toujours aucun moyen de le récupérer. Note le nouveau avant de valider.</div>
       <div class="modal-actions"><button class="btn" id="no">Annuler</button><button class="btn btn-primary" id="ok">Changer</button></div>`,
      (layer, close) => {
        const p1 = $('#p1', layer), p2 = $('#p2', layer);
        p1.oninput = () => { $('#str', layer).textContent = strengthText(p1.value); };
        $('#eye', layer).onclick = () => {
          const t = p1.type === 'password' ? 'text' : 'password';
          p1.type = t; p2.type = t; $('#eye', layer).textContent = t === 'password' ? 'Afficher' : 'Masquer';
        };
        enchainerConfirmation(p1, p2);
        $('#no', layer).onclick = close;
        $('#ok', layer).onclick = async () => {
          const vm = K.verdictMotDePasse(p1.value, p2.value, 8);
          if (!vm.ok) return refus(vm.champ === 'confirmation' ? p2 : p1, vm.message);
          try {
            await api.changePassword($('#p0', layer).value, p1.value);
            close();
            backupInfo = await api.backups(); drawBackupPanels();
            toast('Mot de passe changé. Les sauvegardes ont été rechiffrées.');
          } catch (e) { toast(plainError(e), 'error'); }
        };
      }
    );
  }

  // ---------- le support de SkanFact, en ligne (1.332.0) ----------
  //
  // Joué par Leïla, au Cabinet : « Signaler un problème… » montrait le rapport de l'application de bureau (« Electron »,
  // « Dossiers : 0 », une copie externe) et n'envoyait rien ; « Proposer une amélioration » préparait un mail signé
  // « SkanFact Cabinet ? · ? », en vouvoyant. Le Cabinet écrit maintenant à l'équipe SkanFact comme une entreprise : la
  // demande part au serveur (serveur/support, base 0206), la réponse revient ICI, dans « Tes demandes au support » (la
  // même page que l'entreprise : plateforme/support.js), et un e-mail sans contenu prévient la personne. Ce qui part avec
  // une demande, compté et décidé : le sujet, le texte, la version et le NOM de la page où l'on travaillait — jamais un
  // client, un dossier ni un montant.
  const supportCab = () => (api && typeof api.supportEnLigne === 'object' && api.supportEnLigne) || null;
  // La page d'où l'on écrit : celle où l'on travaillait, pas l'Aide ni les Réglages par où l'on passe pour écrire.
  const PAGES_DU_SUPPORT_CAB = ['aide', 'reglages', 'support', 'guide'];
  let routeDeTravail = '';
  let supportCabOuvert = null;
  let sansSupportCab = false;
  // Le bandeau « L'équipe SkanFact a répondu… » : au-dessus de la page, reposé quand une page asynchrone la réécrit.
  const poserSupportCab = view => { if (supportCab() && window.SkanSupport) window.SkanSupport.poser(view); };
  async function relireSupportCab() {
    const s = supportCab();
    if (!s || !window.SkanSupport || sansSupportCab || document.visibilityState !== 'visible') return;
    // Une personne qui n'est plus du cabinet n'a pas de support ici : on ne redemande plus.
    try { window.SkanSupport.noter(await s.attente()); } catch (e) { if (e && e.statut === 403) { sansSupportCab = true; window.SkanSupport.noter(null); } }
  }
  let supportCabSuivi = false;
  function suivreSupportCab() {
    if (supportCabSuivi || !supportCab()) return;
    supportCabSuivi = true;
    void relireSupportCab();
    setInterval(() => { void relireSupportCab(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { void relireSupportCab(); });
  }
  // `genre` : 'question', 'probleme' (les mêmes champs) ou 'idee' (ses deux questions). `pre` : le sujet et le texte déjà
  // là (la question tapée dans l'Aide, qui n'a rien trouvé) ; posés au montage, ils ne comptent pas comme une saisie.
  async function ecrireAuSupportCab(genre, pre) {
    const s = supportCab();
    if (!s) return;
    const idee = genre === 'idee';
    let v = null;
    try { v = await api.updVersion(); } catch (_) { /* sans version, la demande part sans elle */ }
    const version = v && v.version && v.version !== 'dev' && /^[0-9A-Za-z.+-]{1,40}$/.test(v.version) ? v.version : null;
    const page = /^[a-z][a-z0-9_-]{0,39}$/.test(routeDeTravail) ? routeDeTravail : null;
    const nomPage = page ? (NOMS_CAB[page] || ({ dossier: 'un dossier' })[page] || '') : '';
    const joint = [version ? `la version de SkanFact Cabinet (v${esc(version)})` : 'la version de SkanFact Cabinet', nomPage ? `la page où tu étais (${esc(nomPage)})` : ''].filter(Boolean).join(' et ');
    modal(`<h2>${idee ? 'Proposer une amélioration' : 'Écrire au support'}</h2>
      <p class="small">${idee
        ? 'Dis ce qui te manque — même si ça te paraît petit : c\'est souvent le geste répété pour chaque client qui fait gagner le plus. L\'équipe SkanFact lit chaque idée et te répond ici.'
        : 'Une question, ou quelque chose qui ne marche pas comme prévu : l\'équipe SkanFact te répond ici, dans le Cabinet, en général dans la journée. Un e-mail te prévient que la réponse t\'attend.'}</p>
      <form id="sup-form" novalidate>
        ${idee ? `<label class="field obligatoire">${lbl('Ce que tu aimerais faire', 'b.ideeQuoi')}
          <textarea id="sup-quoi" rows="3" maxlength="1800" placeholder="Ex. : relancer d'un seul geste tous les clients qui n'ont pas envoyé août."></textarea></label>
        <label class="field">${lbl('Comment tu fais aujourd\'hui', 'b.ideeAuj')}
          <textarea id="sup-auj" rows="3" maxlength="1800" placeholder="Ex. : j'ouvre chaque dossier et j'écris un mail à la main."></textarea></label>
        <p class="small muted">Cette seconde question est celle qui sert le plus : elle dit le vrai problème, et pas seulement la solution imaginée.</p>`
        : `<label class="field obligatoire">${lbl('Le sujet', 'b.supSujet')}
          <input id="sup-sujet" maxlength="140" autocomplete="off" placeholder="Ex. : la balance du mois ne tombe pas juste" value="${esc(String((pre && pre.sujet) || '').slice(0, 140))}"></label>
        <label class="field obligatoire">${lbl('Ce qui se passe', 'b.supTexte')}
          <textarea id="sup-texte-demande" rows="5" maxlength="4000" placeholder="Ce que tu faisais, ce que tu attendais, ce qui s'est passé à la place. Une question ? Pose-la telle quelle.">${esc(String((pre && pre.texte) || '').slice(0, 4000))}</textarea></label>`}
      </form>
      <div class="notes-md mt"><strong>Joint automatiquement</strong>
        <p class="small">${joint} : c'est ce qui aide l'équipe à voir ce que tu vois.</p>
        <p class="small muted">Rien d'autre : ni client, ni dossier, ni montant de ton cabinet.</p>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="sup-send">Envoyer au support</button></div>`,
    (layer, close) => {
      const bouton = $('#sup-send', layer);
      // Une question venue de l'Aide : le curseur au bout du texte, pour la compléter sans chercher où cliquer.
      const tx = $('#sup-texte-demande', layer);
      if (pre && pre.texte && tx) requestAnimationFrame(() => {
        // (1.333.0) Un texte à trous (« Le dossier : … ») met le curseur dans le premier trou ; une question, à sa fin.
        const ici = typeof pre.curseur === 'number' ? Math.min(pre.curseur, tx.value.length) : tx.value.length;
        tx.focus(); tx.setSelectionRange(ici, ici);
      });
      const envoyer = async () => {
        if (bouton.disabled) return;
        let sujet, texte;
        if (idee) {
          const quoi = $('#sup-quoi', layer).value.trim();
          if (quoi.length < 3) return refus($('#sup-quoi', layer), 'Dis en une phrase ce que tu aimerais faire.');
          const auj = $('#sup-auj', layer).value.trim();
          // Le sujet de l'idée : sa première ligne, sans balise, tenue dans les 140 signes d'un sujet.
          const ligne = quoi.split('\n')[0].replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
          sujet = `Une idée : ${ligne}`;
          if (sujet.length > 140) sujet = sujet.slice(0, 139).trimEnd() + '…';
          texte = `Ce que j'aimerais faire :\n${quoi}\n\nComment je fais aujourd'hui :\n${auj || '(non précisé)'}`;
        } else {
          sujet = $('#sup-sujet', layer).value.trim();
          texte = $('#sup-texte-demande', layer).value.trim();
          if (sujet.length < 3) return refus($('#sup-sujet', layer), 'Donne un sujet à ta demande, en quelques mots : c\'est lui que l\'équipe lit en premier.');
          if (/[<>]/.test(sujet)) return refus($('#sup-sujet', layer), 'Le sujet s\'écrit sans les signes < et >.');
          if (texte.length < 3) return refus($('#sup-texte-demande', layer), 'Dis ce qui se passe : ce que tu faisais, ce que tu attendais. C\'est ce qui permet de t\'aider.');
        }
        bouton.disabled = true;
        try {
          const r = await s.ecrire({ sujet, texte, version, page });
          close();
          toast('Envoyé : l\'équipe SkanFact te répond ici, dans « Tes demandes au support ».');
          void relireSupportCab();
          location.hash = '#/support/' + encodeURIComponent(r.id);
        } catch (e) { toast(plainError(e), 'error'); bouton.disabled = false; }
      };
      bouton.onclick = envoyer;
      $('#sup-form', layer).onsubmit = e => { e.preventDefault(); void envoyer(); };
    });
  }
  // La page « Tes demandes au support » : la même que l'entreprise, son chemin partant du Tableau de bord du Cabinet.
  function drawSupport(view, arg) {
    if (supportCabOuvert) { supportCabOuvert.arreter(); supportCabOuvert = null; }
    const s = supportCab();
    if (!s || !window.SkanSupport) {
      view.innerHTML = '<div class="page-head"><h1>Tes demandes au support</h1></div><div class="panel"><p class="small muted">Le support de SkanFact se joint en ligne, depuis le Cabinet.</p></div>';
      return;
    }
    view.innerHTML = '<div id="sup-racine"></div>';
    supportCabOuvert = window.SkanSupport.page($('#sup-racine'), {
      appel: s.appel,
      ecrire: () => ecrireAuSupportCab('question'),
      choisie: arg ? decodeURIComponent(arg) : null,
      toast: (t, erreur) => toast(t, erreur ? 'error' : undefined),
      ouvrirArticle: id => { location.hash = '#/aide/' + id; },
      accueil: { href: '#/production', nom: 'Tableau de bord' },
    });
  }

  async function supportDialog() {
    // (1.332.0) En ligne, le problème part au support de SkanFact : le rapport de bureau ne servait à rien ici.
    if (supportCab()) return ecrireAuSupportCab('probleme');
    let inf = {};
    try { inf = await api.support(); } catch {}
    // Un gel passé est la première chose à joindre à un rapport : c'est justement ce dont aucune
    // console n'aurait gardé la trace.
    const gel = inf.dernierGel ? `\nDernier blocage : ${inf.dernierGel.at} (${inf.dernierGel.silence} s sans réponse)` : '';
    modal(
      `<h2>Signaler un problème</h2>
       <p class="small">Copie ces informations dans ton message : elles disent où en est ton installation, sans rien révéler du contenu de tes dossiers.</p>
       <pre class="code-box" id="sup">SkanFact Cabinet ${esc(inf.version || '')}
Système : ${esc(inf.platform || '')} ${esc(inf.arch || '')} · Electron ${esc(inf.electron || '')}
Dossiers : ${inf.dossiers || 0} · Paquets : ${inf.paquets || 0}
Copie externe : ${esc((inf.external && inf.external.dir) || 'aucune')}${inf.external && inf.external.lastError ? ' (erreur : ' + esc(inf.external.lastError) + ')' : ''}${esc(gel)}</pre>
       <div class="modal-actions"><button class="btn" id="log">Ouvrir le journal technique</button><span class="grow"></span>
       <button class="btn" id="copy">Copier</button><button class="btn btn-primary" id="ok">Fermer</button></div>`,
      (layer, close) => {
        $('#ok', layer).onclick = close;
        $('#log', layer).onclick = () => api.openLog();
        $('#copy', layer).onclick = async () => {
          try { await navigator.clipboard.writeText($('#sup', layer).textContent); toast('Copié.'); }
          catch { toast('Copie impossible.', 'error'); }
        };
      }
    );
  }

  // ---------- proposer une amélioration (8.1.0) ----------
  //
  // Le pendant de « Signaler un problème ». L'application savait recevoir ce qui ne marche pas et
  // n'avait aucune porte pour ce qui manque — alors qu'un cabinet qui traite soixante dossiers voit
  // en un mois ce que l'éditeur ne verrait pas en un an.
  //
  // Contrairement au signalement, elle n'emporte NI journal NI état du portefeuille : une idée n'a
  // pas de trace technique, et joindre le nombre de dossiers « au cas où » serait prendre une
  // information sur le cabinet sans raison. Seule la version part, pour pouvoir répondre que la
  // chose existe déjà.
  //
  // Les deux questions ne sont pas interchangeables : on demande ce qu'on aimerait faire, PUIS
  // comment on s'en sort aujourd'hui. C'est la seconde qui apprend quelque chose — on propose
  // toujours une solution, et la solution imaginée est rarement la meilleure.
  async function ideeDialog() {
    // (1.332.0) En ligne, l'idée part au support de SkanFact, avec ses deux questions ; la réponse revient ici.
    if (supportCab()) return ecrireAuSupportCab('idee');
    let inf = {};
    try { inf = await api.support(); } catch {}
    const tech = `SkanFact Cabinet ${inf.version || '?'} · ${inf.platform || '?'}`;
    modal(
      `<h2>Proposer une amélioration</h2>
       <p class="small">SkanFact Cabinet est écrit par une seule personne, et ce sont les cabinets qui s'en servent tous les jours qui décident de la suite. Dis ce qui te manque — même si ça te paraît petit.</p>
       <label class="field">${lbl('Ce que tu aimerais faire', 'b.ideeQuoi')}
         <textarea id="idee-quoi" rows="3" placeholder="Ex. : relancer d'un seul geste tous les clients qui n'ont pas envoyé août."></textarea></label>
       <label class="field">${lbl('Comment tu fais aujourd\'hui', 'b.ideeAuj')}
         <textarea id="idee-auj" rows="3" placeholder="Ex. : j'ouvre chaque dossier et j'écris un mail à la main."></textarea></label>
       <p class="small muted">Cette seconde question est celle qui sert le plus : elle dit le vrai problème, et pas seulement la solution imaginée.</p>
       <p class="small muted">Joint automatiquement : ${esc(tech)}. Rien d'autre — ni journal, ni nom de dossier, ni chiffre de tes clients.</p>
       <div class="modal-actions"><button class="btn" data-close>Annuler</button>
       <button class="btn btn-primary" id="idee-send">Préparer le message</button></div>`,
      (layer, close) => {
        $('#idee-send', layer).onclick = async () => {
          const quoi = $('#idee-quoi', layer).value.trim();
          if (!quoi) return refus('#idee-quoi', 'Dis en une phrase ce que tu aimerais faire.');
          const auj = $('#idee-auj', layer).value.trim();
          const body = 'Bonjour,\n\nUne idée pour SkanFact Cabinet.\n\n'
            + `Ce que j'aimerais faire :\n${quoi}\n\n`
            + `Comment je fais aujourd'hui :\n${auj || '(non précisé)'}\n\n`
            + `--- version ---\n${tech}\n`;
          await api.mail({ to: 'contact@skanfact.tn', subject: `Idée pour SkanFact Cabinet ${inf.version || ''}`, body });
          close(); toast('Message préparé — relis-le avant de l\'envoyer.');
        };
      }
    );
  }

  // ---------- La visite guidée (10.14.0) ----------
  //
  // Skander, après la visite guidée de l'application entreprise : « commence par faire ce qu'on vient
  // de faire dans le dernier lot sur l'app cabinet ». Le MOTEUR est le même (`src/renderer/visite.js`,
  // chargé tel quel) ; le contenu vit dans `cabvisites.js` ; ici, ce qui les relie au Cabinet : la
  // navigation, la progression, « Tes premiers pas » et la page « Me guider ».
  //
  // La progression décrit la PERSONNE, pas le cabinet : elle vit sur ce poste (`prefs`), jamais dans la
  // base chiffrée ni dans les sauvegardes.
  const VISITES_PREF = 'visites';
  const visitesEtat = () => Object.assign({ faites: {}, reprise: null, vues: {}, proposer: true, porteVue: false }, prefs.get(VISITES_PREF, {}) || {});
  const visitesPoser = modif => { const e = visitesEtat(); modif(e); prefs.set(VISITES_PREF, e); };
  // Les dossiers qui ont leur livre : ceux que l'index connaît, et celui qu'on regarde s'il est ouvert.
  const avecLivre = () => {
    const ids = new Set((questionsAttente || []).map(q => q.dossierId));
    if (livresState.dossierId && livresState.livre) ids.add(livresState.dossierId);
    return ids;
  };
  // Le dossier qu'une visite montre : celui qu'on regarde s'il convient, sinon la vitrine de l'exemple
  // qui le montre rempli, sinon le premier qui convient. `sorte` : 'skanfact' (il envoie ses paquets),
  // 'hors' (tenu au cabinet), 'livre' (il a son livre), 'client' (n'importe lequel), et 'saisie' (10.14.1,
  // S-03) : n'importe quel dossier qui a son livre — celui qu'on regarde d'abord, sinon le garage de
  // l'exemple. C'est la sorte des GESTES de saisie : « Saisir une pièce », lancé depuis « Guide-moi » sur
  // un client qui envoie ses paquets, se fait dans SON livre. La découverte, elle, garde 'hors' : ses
  // bulles parlent du garage, et ne doivent jamais se poser sur un autre dossier.
  function dossierPour(sorte) {
    const tous = (S && S.dossiers) || [];
    const livres = avecLivre();
    const convient = d => !!d && !d.archived && (sorte === 'client'
      || ((sorte === 'livre' || sorte === 'saisie') && livres.has(d.id))
      || (sorte === 'skanfact' && livres.has(d.id) && (d.packs || []).length > 0)
      || (sorte === 'hors' && livres.has(d.id) && !!d.manual));
    const ouvert = (/^#\/dossier\/([^/]+)/.exec(location.hash) || [])[1];
    const courant = ouvert ? tous.find(d => d.id === decodeURIComponent(ouvert)) : null;
    if (convient(courant)) return courant.id;
    const vitrines = K.demoDossiers(K.today()).filter(d => d.vitrine);
    const vit = vitrines.find(v => v.vitrine === (sorte === 'hors' || sorte === 'saisie' ? 'hors' : 'skanfact'));
    const v = vit && tous.find(d => d.id === vit.id);
    if (v && (sorte === 'client' || convient(v) || (v.demo && sorte !== 'client'))) return v.id;
    const r = tous.find(convient);
    return r ? r.id : null;
  }
  // Les exercices d'un dossier tenu au cabinet, lus dans le résumé des index (jamais dans un livre) :
  // c'est ce qui permet à la découverte de désigner l'exercice CLOS du garage de l'exemple.
  function exercicesDe(sorte) {
    const id = dossierPour(sorte);
    const q = id && (questionsAttente || []).find(x => x.dossierId === id);
    return ((q && q.tenu && q.tenu.exercices) || []).map(e => ({ annee: String(e.annee), clos: !!e.clos }));
  }
  let VISITES = null;
  const visites = () => VISITES || (VISITES = CV.parcours({
    state: () => S, dossier: dossierPour, exercices: exercicesDe, estExemple: () => (S.dossiers || []).some(d => d.demo),
    cleSecours: () => (recoveryAt === undefined ? null : recoveryAt !== null),
    copieExterne: () => !!(backupInfo && backupInfo.external && backupInfo.external.dir),
    // Le nombre d'écritures du livre ouvert : la preuve qu'une pièce a été enregistrée (10.14.1).
    ecritures: () => ((livresState.livre && livresState.livre.ecritures) || []).length,
    // Et ses brouillards : la preuve qu'une pièce vient d'être validée (10.14.1).
    brouillards: () => ((livresState.livre && livresState.livre.ecritures) || []).filter(e => e.statut === 'brouillard').length,
    // Les relevés de la banque du livre de CE dossier — `null` quand son livre n'est pas en mémoire :
    // ne pas savoir n'est pas « aucun » (on ne cache pas une visite sur une donnée qu'on n'a pas lue).
    releves: id => (livresState.livre && String(livresState.livreCle || '').startsWith(id + '|') ? (livresState.livre.releves || []).length : null),
    // Les dossiers qui ont leur livre, et leur nombre : la preuve qu'un livre vient d'être créé (26/09).
    avecLivre: () => avecLivre(), livres: () => avecLivre().size,
    Visite
  }).filter(v => !(api.visitesAbsentes || []).includes(v.id)));
  const visiteParId = id => visites().find(v => v.id === id) || null;
  const visitePage = cle => visiteParId('page-' + cle);
  const decouverteEnPause = () => { const r = visitesEtat().reprise; return r && r.id === 'decouvrir' ? r : null; };

  // Ce qui manque à une visite pour se dérouler, ou null — UNE fonction pour le bouton éteint de « Me
  // guider » et pour le refus au lancement : les deux ne peuvent pas diverger (9.4.5).
  function visiteManque(p) {
    if (!p || typeof p.si !== 'function') return null;
    let ok = true;
    try { ok = !!p.si(); } catch (_) { ok = false; }
    return ok ? null : (p.manque || { texte: 'Il faut d\'abord quelque chose à montrer ici.' });
  }
  // La première visite qu'on peut FAIRE en remontant ce qui manque — jamais un bouton éteint qui
  // renvoie à un autre bouton éteint. Bornée.
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
    modal(`<h2>${esc(p.titre)}</h2><p>${esc(m.texte)}</p>
      ${avant ? `<p class="small muted">La visite « ${esc(avant.titre)} » t'y amène pas à pas.</p>` : ''}
      <div class="modal-actions"><button class="btn" data-dismiss>Fermer</button>
        ${avant ? `<button class="btn btn-primary" id="vm-go">${esc(avant.titre)}</button>` : ''}</div>`,
    (root, close) => { const b = $('#vm-go', root); if (b) b.onclick = () => { close(); lancerVisite(avant); }; }, null, { garde: false });
  }
  async function lancerVisite(p, depart) {
    if (!p) return;
    // Rien ne reste ouvert par-dessus l'écran qu'on va montrer.
    if (fermerPalette) fermerPalette();
    const manque = visiteManque(p);
    if (manque) { expliquerManque(p, manque); return; }
    // La découverte se fait sur l'EXEMPLE : elle le charge d'abord. Les vrais dossiers ne bougent pas —
    // l'exemple vit à côté d'eux, et s'efface au premier vrai paquet.
    if (p.exemple && !(S.dossiers || []).some(d => d.demo)) {
      try { S = await chargerOuRetirerExemple(true); } catch (e) { toast(plainError(e), 'error'); return; }
      VISITES = null;
      render();
      toast(phraseExemple());
    }
    fermerAppelGuide();
    // Une visite lit le résumé des livres pendant qu'elle se déroule (l'exercice clos du garage, ses
    // dossiers tenus) : relu au lancement, jamais celui du démarrage — un exercice clôturé ou rouvert
    // depuis changerait sinon ce que les étapes montrent.
    await chargerQuestionsAttente(false);
    Visite.lancer(p, depart || 0);
  }
  // L'étape suivante des premiers pas, guidée : la même que celle que « À faire » nomme.
  function lancerPasSuivant() {
    const pp = lesPas();
    const e = pp.suivante;
    const v = e && visiteParId(PAS_VISITES[e.action]);
    if (v) lancerVisite(v); else navigate('#/guide');
  }
  async function actionDeVisite(id) {
    if (id === 'poser-cabinet') {
      if (!String((S.cabinet || {}).name || '').trim()) { await runSetup({ sansPorte: true }); render(); }
      lancerVisite(visiteParId('premiers-pas'));
    } else if (id === 'rester') {
      toast('Bonne exploration ! « Effacer l\'exemple », sur la page Dossiers, retire les dossiers fictifs.');
    }
  }
  const navigate = hash => vers(hash);

  // Tes premiers pas (10.14.0) : lus sur l'état, jamais cochés à la main (`K.premiersPas`).
  const lesPas = () => K.premiersPas(S, {
    cleSecours: recoveryAt === undefined ? null : recoveryAt !== null,
    copieExterne: !!(backupInfo && backupInfo.external && backupInfo.external.dir),
    tenus: tenusConnus(), decouverte: !!visitesEtat().faites.decouvrir
  });
  const PAS_ACTIONS = {
    decouverte: ['Faire la découverte', () => { const r = decouverteEnPause(); lancerVisite(visiteParId('decouvrir'), r ? r.i : 0); }],
    cabinet: ['Nommer mon cabinet', () => versReglages('pan-cabinet')],
    equipe: ['Inviter mon équipe', () => versReglages('pan-equipe')],
    clients: ['Ajouter un client…', () => newDossierForm()],
    appairage: ['Remettre le fichier à mes clients…', () => remettreAppairage()],
    cle: ['Enregistrer ma clé…', () => versReglages('pan-secu')],
    copie: ['Choisir un dossier de copie…', () => versReglages('pan-backup')],
    saisie: ['Régler ma grille', () => versReglages('pan-saisie')],
    // (plateforme) Le livre de chaque dossier existe déjà : le premier geste est d'y saisir (C2).
    livre: ['Ouvrir sa saisie', () => ouvrirPremierLivre()]
  };
  function ouvrirPremierLivre() {
    const e = lesPas().etapes.find(x => x.id === 'travail');
    location.hash = e && e.dossierId ? '#/dossier/' + encodeURIComponent(e.dossierId) + '/comptabilite/saisie' : '#/dossiers';
  }
  const PAS_VISITES = { decouverte: 'decouvrir', cabinet: 'nommer-cabinet', equipe: 'equipe', clients: 'ajouter-client', appairage: 'appairage',
    cle: 'cle-secours', copie: 'copie-externe', saisie: 'grille-saisie', livre: 'saisir-piece' };
  const ICONE_GUIDE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>';
  const ICONE_LECTURE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10.2 8.6l5 3.4-5 3.4z"/></svg>';
  const ICONE_COCHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICONE_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>';
  const ICONE_DECOUVRIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/></svg>';
  const ICONE_DEMARRER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
  // Le panneau complet des premiers pas : sur la page Dossiers VIDE, où il est le corps de l'écran.
  // Quand des dossiers existent, il se réduit à UNE ligne de « À faire » (la liste des clients ne se
  // mérite pas au défilement, 9.4.4) et la liste entière vit dans « Me guider ».
  // (plateforme, 1.87.4) Chaque « Me guider » porte le nom de son étape : trois boutons du même nom, un lecteur d'écran ne
  // disait pas où chacun mène (vu au clavier le 21/10/2026).
  // `vertEnTete` : l'en-tête porte déjà le vert de l'étape (U-11) — l'étape en cours ne le double pas.
  function premiersPasPanel(vertEnTete) {
    const p = lesPas();
    const suivante = p.suivante;
    return `<div class="panel premiers-pas">
      <h2>Tes premiers pas <span class="pp-compte">${p.faits} / ${p.total}</span></h2>
      <p class="small muted mb">Le Cabinet fait beaucoup de choses, mais elles s'enchaînent toujours dans le même ordre.
        Chaque étape se coche toute seule quand c'est fait ; celles marquées « facultatif » t'attendent sans te presser.</p>
      <ol class="pp-list">${p.etapes.map(e => {
        const a = PAS_ACTIONS[e.action];
        const encours = e === suivante;
        const guide = !e.fait && PAS_VISITES[e.action];
        const libelle = a && e.action === 'decouverte' && decouverteEnPause() ? 'Reprendre la découverte' : a && a[0];
        return `<li class="${e.fait ? 'fait' : ''}${encours ? ' encours' : ''}">
          <span class="pp-marque">${e.fait ? '✓' : ''}</span>
          <span class="pp-txt"><strong>${esc(e.titre)}${e.facultatif && !e.fait ? ' <span class="pp-facult">facultatif</span>' : ''}</strong><span class="small muted">${esc(e.quoi)}</span></span>
          <span class="pp-go">${guide ? `<button type="button" class="pp-guide" data-pas-guide="${esc(guide)}" aria-label="Me guider : ${esc(e.titre)}" title="Je te montre où cliquer, étape par étape">${ICONE_GUIDE}Me guider</button>` : ''}${!e.fait && a
            ? `<button class="btn btn-sm ${encours && !vertEnTete ? 'btn-primary' : ''}" data-pas="${esc(e.action)}">${esc(libelle)}</button>` : ''}</span>
        </li>`;
      }).join('')}</ol></div>`;
  }
  function bindPremiersPas(root) {
    $$('[data-pas]', root).forEach(b => b.onclick = () => { const a = PAS_ACTIONS[b.dataset.pas]; if (a) a[1](); });
    $$('[data-pas-guide]', root).forEach(b => b.onclick = () => lancerVisite(visiteParId(b.dataset.pasGuide)));
  }
  // La ligne « Tes premiers pas » de « À faire », quand le portefeuille a déjà des dossiers.
  function lignePremiersPas() {
    const p = lesPas();
    if (!p.demarrage || !p.suivante) return null;
    return { id: 'premiers-pas', level: 'info', label: `Tes premiers pas — ${p.faits} sur ${p.total} : ${p.suivante.titre.charAt(0).toLowerCase() + p.suivante.titre.slice(1)}`,
      detail: p.suivante.quoi, count: 0, rows: [] };
  }

  // L'habillage que le moteur demande : la couleur et le dessin d'une visite, la suite, la fête.
  const iconeVisite = (coul, p) => {
    const propre = p && CV.iconeDe(p);
    const t = propre ? propre : '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${t}</svg>`;
  };
  function installerVisites() {
    Visite.installer({
      aller: hash => vers(hash),
      hash: () => location.hash || '#/dossiers',
      parcours: visiteParId,
      lancerSuite: p => lancerVisite(p),
      expliquer: el => CV.expliquer(el, { G }),
      zone: el => CV.zone(el),
      action: id => actionDeVisite(id),
      // Le jumeau de l'app entreprise : une liste vidée par une recherche ou un filtre se réaffiche
      // d'un clic depuis la bulle, au lieu de faire perdre la visite.
      remettre: '#reset-f',
      couleur: p => CV.couleurDe(p),
      icone: iconeVisite,
      progres: p => {
        if (!['premiers-pas', ...Object.values(PAS_VISITES)].includes(p.id)) return null;
        const pp = lesPas();
        return { titre: 'Tes premiers pas', fait: pp.faits, total: pp.total,
          // « 4 / 9 » au-dessus de « Tout est en place » se contredisait : ce qui reste est FACULTATIF
          // (la clé de secours avant le premier paquet, l'équipe, la grille), et la phrase le dit.
          texte: pp.suivante ? 'Prochaine étape : ' + pp.suivante.titre.charAt(0).toLowerCase() + pp.suivante.titre.slice(1) + '.'
            : pp.faits < pp.total ? `L'indispensable est fait : ${pl(pp.total - pp.faits, 'étape reste', 'étapes restent')} facultative${pp.total - pp.faits > 1 ? 's' : ''}, à faire le jour où ${pp.total - pp.faits > 1 ? 'elles serviront' : 'elle servira'}.`
              : 'Tout est en place : ton cabinet est prêt.' };
      },
      suites: p => {
        const et = visitesEtat();
        const pp = lesPas();
        const pas = pp.suivante && PAS_VISITES[pp.suivante.action];
        // Ce que l'écran RÉCLAME maintenant passe devant, même déjà appris : une ligne « Sans réponse »
        // attend son écriture, et la proposer derrière deux visites neuves la faisait oublier (26/09).
        let presse = [];
        try { presse = typeof p.pressee === 'function' ? (p.pressee() || []) : []; } catch (_) { presse = []; }
        const ids = [...presse, pas, ...(p.suite || [])].filter((id, i, a) => id && id !== p.id && a.indexOf(id) === i && visiteParId(id) && !visiteManque(visiteParId(id)));
        const neuves = ids.filter(id => presse.includes(id) || !et.faites[id]);
        return (neuves.length ? neuves : ids).slice(0, 3);
      },
      fete: p => p.type !== 'page' && !visitesEtat().faites[p.id],
      // L'étape où l'on en est, et le compte quand on le connaît (`Visite.pointDeReprise`).
      etape: (p, i, compte) => visitesPoser(e => { e.reprise = Object.assign({ id: p.id, i }, compte || {}); }),
      fini: p => {
        visitesPoser(e => { e.faites[p.id] = K.today(); if (e.reprise && e.reprise.id === p.id) e.reprise = null; });
        if (location.hash === '#/guide') render();
      },
      interrompu: (p, i, compte) => {
        visitesPoser(e => { e.reprise = Object.assign({ id: p.id, i: Math.max(0, i) }, compte || {}); });
        // Où la reprendre : « Guide-moi » de cet écran quand il la propose, sinon « Me guider » — la
        // découverte n'est que là (S-03, le jumeau de l'app entreprise).
        const g = Visite.guideDeLaPage(visites(), CV.cleDePage(location.hash), { cleDe: h => CV.cleDePage(h) });
        toast($('#guide-moi') && Visite.dansLeGuide(g, p.id)
          ? 'Visite mise en pause. Tu la reprends depuis « Guide-moi », en haut de cet écran, ou depuis « Me guider », dans le menu.'
          : 'Visite mise en pause. Tu la reprends quand tu veux depuis « Me guider », dans le menu.');
        if (location.hash === '#/guide') render();
      }
    });
  }

  // « Guide-moi » (10.14.1, S-03) — le jumeau de l'app entreprise, par le MÊME moteur
  // (`Visite.guideDeLaPage`, `Visite.menuDuGuide`) : dans l'en-tête de chaque écran, à la même place, la
  // liste de ce qu'on peut faire ICI — la visite de l'écran, chaque geste guidé pas à pas (ceux de
  // l'onglet ouvert d'abord), puis l'article qui l'explique et toutes les visites. Sur l'écran d'un
  // dossier, un geste ne se propose que s'il se fera dans CE dossier (`surLaPage`, cabvisites.js).
  // Un observateur le repose quand un écran redessine son en-tête — la fiche d'un dossier lit son livre
  // et réécrit `#view` après le routeur.
  const ICONE_GUIDE_MOI = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>';
  function poserGuideMoi() {
    const view = $('#view');
    const head = view && view.querySelector('.page-head');
    if (!S || !head || head.querySelector('.guide-moi')) return;
    const cle = CV.cleDePage(location.hash);
    // « Me guider » EST la liste de toutes les visites : un bouton qui y mène depuis elle-même non.
    if (cle === 'guide') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm guide-moi';
    b.id = 'guide-moi';
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.title = 'Ce qu\'on peut faire sur cet écran, montré pas à pas';
    b.innerHTML = ICONE_GUIDE_MOI + '<span>Guide-moi</span>';
    b.onclick = e => { e.stopPropagation(); ouvrirGuideMoi(b); };
    const actions = head.querySelector(':scope > .actions');
    if (actions) actions.insertBefore(b, actions.firstChild); else head.appendChild(b);
    // Un écran asynchrone pose son en-tête APRÈS le routeur : l'invitation attendait ce bouton.
    if (appelEnAttente && appelEnAttente === cle) { appelEnAttente = ''; appelGuide(); }
  }
  let guideObs = null;
  function surveillerGuideMoi() {
    const view = $('#view');
    if (guideObs || !view || !window.MutationObserver) return;
    guideObs = new MutationObserver(() => poserGuideMoi());
    guideObs.observe(view, { childList: true, subtree: true });
  }
  function ouvrirGuideMoi(bouton) {
    fermerAppelGuide();
    const cle = CV.cleDePage(location.hash);
    const et = visitesEtat();
    const ongletActif = barre => { const t = $(barre + ' button[data-tab].active'); return t ? t.dataset.tab : null; };
    const g = Visite.guideDeLaPage(visites(), cle, { cleDe: h => CV.cleDePage(h), ongletActif });
    // L'article suit l'onglet ouvert des Réglages (`G.articleDeLaPage`).
    const artId = G.articleDeLaPage ? G.articleDeLaPage(cle, ongletActif) : G.PAR_PAGE && G.PAR_PAGE[cle];
    const art = artId && G.ARTICLES.find(a => a.id === artId);
    const exemple = (S.dossiers || []).some(d => d.demo);
    const actions = Visite.menuDuGuide(g, {
      titrePage: g.page ? g.page.titre : 'Cet écran',
      lancer: (v, i) => lancerVisite(v, i),
      manque: v => visiteManque(v),
      fait: v => !!et.faites[v.id],
      // Une visite en pause se reprend à son étape (`Visite.pointDeReprise`, le même calcul que « Me guider »).
      reprise: v => (et.reprise && et.reprise.id === v.id ? Visite.pointDeReprise(v, et.reprise) : null),
      avertir: v => v.exemple && !exemple ? 'L\'exemple se charge d\'abord ; tes vrais dossiers ne bougent pas.' : '',
      // Le nom d'un onglet, tel qu'il est écrit dans sa barre — sans le compteur qui le suit.
      libelleOnglet: og => {
        const t = $(og.barre + ' button[data-tab="' + og.cle + '"]');
        return t ? [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || og.cle : og.cle;
      },
      article: art ? { titre: art.t, ouvrir: () => navigate('#/aide/' + art.id) } : null,
      tout: () => navigate('#/guide')
    });
    RowMenu.ouvrir(bouton, actions, { classe: 'guide-menu', label: 'Guide-moi : ce qu\'on peut faire sur cet écran' });
  }

  // La première fois qu'on ouvre un écran, une invitation propose sa visite — trois fois au plus.
  // 10.14.1 (S-03) : elle s'ACCROCHE à « Guide-moi », par-dessus l'écran, au lieu de pousser l'écran de
  // travail (la bande d'avant faisait commencer la grille de saisie plus bas pendant ses trois
  // premières ouvertures), et elle apprend où la visite se retrouve. Pas de vert : le bouton principal
  // de l'écran reste le seul (U-11).
  const VISITE_PROPOSEE_MAX = 3;
  let appelEnAttente = '';
  // (plateforme) 1.144.0 — une seule proposition par ouverture du Cabinet, comme l'entreprise depuis la 1.129.0 (UX 3).
  let visiteProposeeIci = false;
  function fermerAppelGuide() {
    const a = document.getElementById('guide-appel');
    if (a) { if (typeof a._fermer === 'function') a._fermer(); else a.remove(); }
  }
  function appelGuide(reprise) {
    const cle = CV.cleDePage(location.hash);
    if (!S || Visite.enCours() || cle === 'guide' || cle === 'aide') return;
    const p = visitePage(cle);
    const et = visitesEtat();
    if (!p || visiteManque(p) || !et.proposer || et.faites[p.id] || (!reprise && (et.vues[cle] || 0) >= VISITE_PROPOSEE_MAX)) return;
    if (visiteProposeeIci && !reprise) return;
    // Une page vide qui porte « Tes premiers pas » est déjà une invitation.
    // (1.194.0) Une proposition de client qui attend (`.cd-prop`) passe avant : l'invitation couvrait son « Accepter ».
    if ($('#view .premiers-pas, #view .cd-prop')) return;
    const bouton = $('#guide-moi');
    // Un écran asynchrone n'a pas encore son en-tête : l'invitation attend le bouton (`poserGuideMoi`).
    if (!bouton) { appelEnAttente = cle; return; }
    fermerAppelGuide();
    if (!reprise) visitesPoser(e => { e.vues[cle] = (e.vues[cle] || 0) + 1; });
    visiteProposeeIci = true;
    const coul = CV.couleurDe(p);
    const el = document.createElement('div');
    el.className = 'guide-appel' + (coul ? ' th-' + coul : '');
    el.id = 'guide-appel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'ga-t');
    el.innerHTML = `<span class="ga-fleche" aria-hidden="true"></span>
      <div class="ga-tete"><span class="ga-ico" aria-hidden="true">${ICONE_GUIDE}</span>
        <b id="ga-t">Première fois sur cet écran ?</b></div>
      <p class="ga-txt">${esc(p.resume || '')} Je te montre à quoi il sert et ce que fait chaque bouton, en ${esc(p.duree || 'une minute')}.</p>
      <div class="ga-actions"><button type="button" class="btn btn-sm ga-go" id="ga-go">${ICONE_LECTURE}Faire la visite</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ga-non" title="Ne plus me proposer la visite de cet écran">Plus tard</button></div>
      <p class="ga-note">Tu la retrouves dans « Guide-moi », avec tout ce qu'on peut faire ici.
        <button type="button" class="ga-jamais" id="ga-jamais">Ne plus me proposer de visites</button></p>`;
    document.body.appendChild(el);
    typographie(el);
    const scroller = $('#view');
    const depart = scroller ? scroller.scrollTop : 0;
    // (plateforme, 1.87.7) Au téléphone, c'est la page entière qui défile, pas `#view` (comme à l'entreprise, 1.87.3).
    const departFenetre = window.scrollY;
    // Le curseur que la personne avait (la case « Pièce » de la saisie) : « Plus tard » le lui rend, au lieu de le perdre
    // avec le bouton qui disparaît.
    let retour = null;
    el.addEventListener('mousedown', () => { retour = document.activeElement; }, true);
    // Sous le bouton, calée sur son bord droit, la flèche sur son milieu ; jamais hors de l'écran.
    const placer = () => {
      const r = bouton.getBoundingClientRect();
      if (!r.width || !document.body.contains(bouton)) { fermer(); return; }
      const w = el.offsetWidth;
      const gauche = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
      el.style.top = Math.round(r.bottom + 10) + 'px';
      el.style.left = Math.round(gauche) + 'px';
      el.style.setProperty('--ga-fleche', Math.round(Math.min(w - 22, Math.max(14, r.left + r.width / 2 - gauche))) + 'px');
    };
    // Le premier geste ailleurs la referme : on s'est mis au travail.
    const dehors = e => { if (!el.contains(e.target)) fermer(); };
    const clavier = e => { if (e.key === 'Escape' && el.contains(document.activeElement)) { e.stopPropagation(); fermer(); bouton.focus(); } };
    const defile = () => { if (!scroller || Math.abs(scroller.scrollTop - depart) > 4 || Math.abs(window.scrollY - departFenetre) > 4) fermer(); };
    function fermer() {
      el.remove();
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
    $('#ga-jamais', el).onclick = () => {
      visitesPoser(e => { e.proposer = false; });
      fermer();
      toast('Plus de proposition de visite. Les visites restent dans « Guide-moi » ; la case de « Me guider » les rallume.');
    };
    $('#ga-non', el).onclick = () => {
      visitesPoser(e => { e.vues[cle] = VISITE_PROPOSEE_MAX; }); fermer();
      if (retour && retour !== document.body && document.body.contains(retour)) retour.focus();
    };
  }

  // La page « Me guider » : où j'en suis, LE prochain geste (un seul vert), les grands départs, chaque
  // famille avec ses visites, et chaque écran.
  let guideQ = '';
  function drawGuide(view) {
    const et = visitesEtat();
    const toutes = visites();
    const gestes = toutes.filter(v => v.type !== 'page');
    const pages = toutes.filter(v => v.type === 'page');
    const nbFaites = toutes.filter(v => et.faites[v.id]).length;
    const reprise = et.reprise && visiteParId(et.reprise.id);
    // Où la visite reprendra, et ce qu'on en sait (`Visite.pointDeReprise`, la même que SkanFact).
    const rep = reprise ? Visite.pointDeReprise(reprise, et.reprise) : null;
    const repriseI = rep ? rep.i : 0;
    const exemple = (S.dossiers || []).some(d => d.demo);
    const pp = lesPas();
    const dec = visiteParId('decouvrir');
    const pas = pp.suivante && visiteParId(PAS_VISITES[pp.suivante.action]);
    const pasPret = !!(pas && !visiteManque(pas));
    // 26/09 — la découverte est FACULTATIVE : elle ne passe jamais devant un premier pas du métier
    // (règle des premiers pas, 10.14.0). Elle mène quand l'exemple est chargé (on est en train de
    // découvrir) ou quand aucun premier pas n'attend. Un cabinet qui tient déjà ses clients ne se
    // voit plus proposer « Charger l'exemple » en vert à la place de ce qui lui manque.
    const decouvrirDabord = !!(dec && !et.faites.decouvrir && (exemple || !pasPret));
    const prochain = reprise
      ? { etiq: 'En pause', label: 'Reprendre', titre: reprise.titre, sous: rep.note ? `${rep.texte} — ${rep.note}` : rep.texte, run: () => lancerVisite(reprise, repriseI) }
      : decouvrirDabord
        ? { etiq: 'Pour commencer', label: exemple ? 'Commencer la découverte' : 'Charger l\'exemple et découvrir', titre: dec.titre, sous: `${dec.duree} · ${pl(Visite.chapitres(dec.etapes).length, 'chapitre')}`, run: () => lancerVisite(dec) }
        : pasPret
          ? { etiq: 'Prochaine étape', label: 'Me guider', titre: pas.titre, sous: `Premier pas ${pp.etapes.indexOf(pp.suivante) + 1} sur ${pp.total} · ${pas.duree}`, run: () => lancerVisite(pas) }
          : null;
    const titreHero = reprise ? 'Reprends ta visite là où tu l\'as laissée' : decouvrirDabord ? 'Apprends le Cabinet en le faisant'
      : pp.demarrage ? 'Continue tes premiers pas' : 'Tu as les bases — explore à ton rythme';
    const anneauPas = pp.demarrage;
    const aFait = anneauPas ? pp.faits : nbFaites;
    const aTotal = anneauPas ? pp.total : toutes.length;
    const aQuoi = anneauPas ? 'premiers pas' : 'visites faites';
    const pct = aTotal ? aFait / aTotal : 0;
    const R = 52, CIRC = 2 * Math.PI * R;
    const statut = v => et.faites[v.id] ? '<span class="g-etat fait">Fait</span>'
      : reprise && reprise.id === v.id ? `<span class="g-etat encours">En pause · ${rep.sur ? `${repriseI + 1}/${rep.sur}` : `étape ${repriseI + 1}`}</span>` : '';
    const libelle = v => et.faites[v.id] ? 'Refaire' : reprise && reprise.id === v.id ? 'Recommencer' : 'Commencer';
    const bouton = v => {
      const m = visiteManque(v);
      if (!m) return `<button type="button" class="btn btn-sm" data-visite="${esc(v.id)}">${libelle(v)}</button>`;
      const avant = visitePossibleAvant(v);
      return avant
        ? `<button type="button" class="btn btn-sm" data-visite="${esc(avant.id)}" title="${esc(m.texte)}">D'abord : ${esc(avant.titre.charAt(0).toLowerCase() + avant.titre.slice(1))}</button>`
        : `<button type="button" class="btn btn-sm" disabled title="${esc(m.texte)}">${libelle(v)}</button>`;
    };
    const cherche = v => esc(K.sansAccents([v.titre, v.resume, (v.mots || []).join(' ')].join(' ')));
    const manqueDe = v => { const m = visiteManque(v); return m ? `<span class="small g-manque">Pas encore : ${esc(m.texte.charAt(0).toLowerCase() + m.texte.slice(1))}</span>` : ''; };
    const ligne = v => `<li class="g-ligne${et.faites[v.id] ? ' faite' : ''}" data-cherche="${cherche(v)}">
        <span class="g-l-ico" aria-hidden="true">${et.faites[v.id] ? ICONE_COCHE : reprise && reprise.id === v.id ? ICONE_PAUSE : ICONE_LECTURE}</span>
        <span class="g-txt"><b>${esc(v.titre)}</b><span class="small muted">${esc(v.resume || '')}</span>${manqueDe(v)}</span>
        <span class="g-duree">${esc(v.duree || '')}</span>${statut(v)}${bouton(v)}</li>`;
    const themes = CV.THEMES.filter(t => t.id !== 'pages' && t.id !== 'demarrer').map(t => {
      const liste = gestes.filter(v => v.theme === t.id);
      if (!liste.length) return '';
      const faites = liste.filter(v => et.faites[v.id]).length;
      return `<section class="g-theme th-${esc(t.couleur)}" id="g-${esc(t.id)}" data-g-theme>
        <header class="g-th-tete"><span class="g-th-ico">${iconeVisite(t.couleur, t)}</span>
          <span class="g-th-t"><h2>${esc(t.titre)}</h2><span>${esc(t.sous)}</span></span>
          <span class="g-th-n" title="${esc(`${faites} ${faites > 1 ? 'visites faites' : 'visite faite'} sur ${liste.length}`)}">${faites}<small> / ${liste.length}</small></span></header>
        <span class="g-th-barre" aria-hidden="true"><i style="width:${Math.round(faites / liste.length * 100)}%"></i></span>
        <ul class="g-liste">${liste.map(ligne).join('')}</ul></section>`;
    }).join('');
    const pagesFaites = pages.filter(v => et.faites[v.id]).length;
    const gestesFaits = gestes.filter(v => et.faites[v.id]).length;
    view.innerHTML = `
      <div class="page-head"><h1>Me guider</h1>
        <div class="actions"><button type="button" class="btn" id="g-aide">Ouvrir l'Aide</button></div></div>
      <section class="g-hero">
        <div class="g-hero-txt"><span class="g-sur">Ton guide</span>
          <h2>${esc(titreHero)}</h2>
          <p>Chaque visite te montre où cliquer, sur ton vrai écran, et attend que tu l'aies fait. Pendant une visite, tu peux cliquer partout, faire une pause avec la croix, et reprendre ici.</p>
          ${prochain ? `<div class="g-prochain"><span class="g-pr-t"><span class="g-pr-etiq">${esc(prochain.etiq)}</span><b>${esc(prochain.titre)}</b><span class="small muted">${esc(prochain.sous)}</span></span>
            <button type="button" class="btn btn-primary" id="${reprise ? 'g-reprendre' : 'g-prochain'}">${ICONE_LECTURE}${esc(prochain.label)}</button></div>` : ''}</div>
        <div class="g-hero-mesure"><div class="g-anneau" role="img" aria-label="${esc(`${aFait} sur ${aTotal} : ${aQuoi}`)}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="g-an-fond" cx="60" cy="60" r="${R}"/><circle class="g-an-plein" cx="60" cy="60" r="${R}" style="--circ:${CIRC.toFixed(1)};--off:${(CIRC * (1 - pct)).toFixed(1)}"/></svg>
          <span class="g-an-t"><b>${aFait}<small> / ${aTotal}</small></b><span>${aQuoi}</span></span></div>
          <ul class="g-chiffres">
            <li><b>${gestesFaits}<small> / ${gestes.length}</small></b><span>${gestesFaits > 1 ? 'gestes guidés réussis' : 'geste guidé réussi'}</span></li>
            <li><b>${pagesFaites}<small> / ${pages.length}</small></b><span>${pagesFaites > 1 ? 'écrans découverts' : 'écran découvert'}</span></li>
            <li><b>${et.faites.decouvrir ? 'Faite' : 'À faire'}</b><span>la découverte de l'exemple</span></li>
          </ul></div>
      </section>
      ${pp.demarrage ? premiersPasPanel(!!prochain) : ''}
      <div class="g-cartes" id="g-demarrer" data-g-theme>
        ${gestes.filter(v => v.theme === 'demarrer').map(v => {
          const coul = CV.couleurDe(v);
          const lib = v.exemple && !exemple ? 'Charger l\'exemple et ' + libelle(v).toLowerCase() : libelle(v);
          return `<div class="g-carte${coul ? ' th-' + coul : ''}${et.faites[v.id] ? ' faite' : ''}" data-cherche="${cherche(v)}">
            <div class="g-carte-t"><span class="g-carte-ico">${v.exemple ? ICONE_DECOUVRIR : ICONE_DEMARRER}</span>
              <span class="g-duree">${esc(v.duree)}</span></div>
            <b class="g-carte-titre">${esc(v.titre)}</b>
            <p class="small">${esc(v.resume)}</p>${statut(v)}
            ${visiteManque(v) ? bouton(v) : `<button type="button" class="btn btn-sm" data-visite="${esc(v.id)}">${esc(lib)}</button>`}</div>`;
        }).join('')}
      </div>
      <div class="help-search g-cherche"><span class="hs-champ"><svg class="hs-loupe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/></svg>
        <input type="search" id="guide-q" placeholder="Je veux… (saisir une pièce, relancer un client, déclarer la TVA)" autocomplete="off" spellcheck="false" value="${esc(guideQ)}"></span>
        <div class="help-count small muted" id="guide-n" hidden></div></div>
      <div class="g-themes">${themes}</div>
      <section class="panel g-pages-sec" id="g-pages" data-g-theme>
        <div class="g-reu-tete"><h2>Chaque écran, en une minute</h2><span class="g-reu-n">${pagesFaites} sur ${pages.length}</span></div>
        <p class="small muted">À quoi il sert, et ce que fait chacun de ses boutons.</p>
        <ul class="g-pages">${pages.map(v => { const m = visiteManque(v); const c = CV.couleurDe(v); return `<li data-cherche="${cherche(v)}">
          <button type="button" class="g-page${c ? ' th-' + c : ''}${et.faites[v.id] ? ' fait' : ''}" data-visite="${esc(v.id)}"${m ? ` disabled title="${esc(m.texte)}"` : ` title="${esc(v.resume || '')}"`}>${et.faites[v.id] ? ICONE_COCHE : ''}${esc(v.titre)}</button></li>`; }).join('')}</ul>
      </section>
      <label class="check g-proposer"><input type="checkbox" id="guide-proposer" ${et.proposer ? 'checked' : ''}>
        <span>Me proposer la visite d'un écran quand je l'ouvre pour la première fois</span></label>`;
    // Le vert du héros porte LE prochain geste ; les cartes et les lignes n'en portent aucun (U-11).
    if (prochain) ($('#g-reprendre', view) || $('#g-prochain', view)).onclick = prochain.run;
    $$('[data-visite]', view).forEach(b => b.onclick = () => lancerVisite(visiteParId(b.dataset.visite)));
    bindPremiersPas(view);
    $('#g-aide', view).onclick = () => { location.hash = '#/aide'; };
    $('#guide-proposer', view).onchange = e => visitesPoser(x => { x.proposer = e.target.checked; if (e.target.checked) x.vues = {}; });
    // Chercher ne redessine rien : on montre ou on cache des lignes déjà là (la frappe reste).
    const q = $('#guide-q', view), n = $('#guide-n', view);
    const filtrer = () => {
      guideQ = q.value;
      const mots = K.sansAccents(q.value.trim()).split(/\s+/).filter(Boolean);
      let vus = 0;
      $$('[data-cherche]', view).forEach(li => { const ok = mots.every(m => li.dataset.cherche.includes(m)); li.hidden = !ok; if (ok) vus++; });
      $$('[data-g-theme]', view).forEach(sec => { sec.hidden = mots.length > 0 && !$$('[data-cherche]', sec).some(li => !li.hidden); });
      n.hidden = !mots.length;
      n.innerHTML = vus ? esc(`${pl(vus, 'visite')} pour « ${q.value.trim()} »`)
        : `Aucune visite pour « ${esc(q.value.trim())} ». <a href="#/aide" id="guide-aide">Chercher dans l'Aide →</a>`;
      const a = $('#guide-aide', view);
      if (a) a.onclick = ev => { ev.preventDefault(); aideQ = q.value.trim(); location.hash = '#/aide'; };
    };
    q.oninput = filtrer;
    if (guideQ) filtrer();
  }

  // ---------- assistant de première utilisation ----------
  //
  // C'est le premier contact d'un comptable avec le produit. Jusqu'à la 10.13.0, cinq écrans avant de
  // montrer quoi que ce soit : se nommer, entrer ses clients, poser ses filets, produire le fichier à
  // remettre. Les trois derniers se passaient — ils protégeaient un portefeuille vide et remettaient un
  // fichier à des clients qu'on n'avait pas encore.
  //
  // 10.14.0 (Skander : « oublie pas le onboarding aussi, et fais le même système : la démo avant l'écran
  // de démarrage ») — la PORTE d'abord, comme dans l'application entreprise : « Découvrir avec
  // l'exemple » ou « Commencer avec mon cabinet ». Puis deux questions seulement. Le reste vit dans
  // « Tes premiers pas », au moment où il sert, chaque étape avec sa visite guidée.
  //
  // Le mot de passe reste AVANT la porte : l'état du cabinet est chiffré, exemple compris, et il n'y a
  // pas de cabinet sans lui.
  //
  // Rend 'decouvrir' quand on a choisi la découverte (l'assistant reste EN ATTENTE : le nom manque, il
  // reprendra à la sortie de l'exemple, sans la porte), sinon rien. `o.sansPorte` : la reprise.
  function runSetup(o) {
    const opts = o || {};
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.id = 'setup';
      document.body.appendChild(el);
      let etape = 0;
      const fin = r => { el.remove(); resolve(r); };
      const et = visitesEtat();
      const porte = !opts.sansPorte && !et.porteVue && !et.faites.decouvrir;
      const porteVue = () => visitesPoser(e => { e.porteVue = true; });

      const etapes = [
        ...(porte ? [{
          t: 'Bienvenue dans SkanFact Cabinet',
          porte: true,
          html: () => {
            const dec = visiteParId('decouvrir');
            const nChap = dec ? Visite.chapitres(dec.etapes).length : 0;
            return `
            ${/* 10.10.0 (C-03) — cet écran ne peut pas mentir sur ce qu'est le Cabinet : il tient la
                  comptabilité de chaque dossier, avec ou sans SkanFact chez le client. */''}
            <p class="lead">Le logiciel de comptabilité de ton cabinet — et <strong>le trait d'union avec ceux de tes clients qui utilisent SkanFact</strong>.</p>
            <div class="setup-porte mt">
              <p class="sp-lead">Deux façons de commencer — et tu peux faire l'une puis l'autre.</p>
              <div class="sp-choix">
                <article class="pp-choix reco"><span class="pp-choix-badge">Recommandé</span>
                  <span class="pp-choix-ico">${ICONE_DECOUVRIR}</span>
                  <h3>Découvrir avec l'exemple</h3>
                  <p>Six dossiers fictifs, tout remplis : un client à jour, un en retard, un que tu tiens de bout en bout, paie et biens compris. Je te fais faire le tour, sans rien risquer.</p>
                  <ul class="pp-choix-meta">${dec ? `<li>${esc(dec.duree)}</li>` : ''}${nChap ? `<li>${pl(nChap, 'chapitre')}</li>` : ''}</ul>
                  <button type="button" class="btn btn-primary" id="w-decouvrir">Commencer la découverte</button></article>
                <article class="pp-choix"><span class="pp-choix-ico">${ICONE_DEMARRER}</span>
                  <h3>Commencer avec mon cabinet</h3>
                  <p>Son nom, puis tes clients — et je te guide ensuite pour chaque premier geste : le fichier à remettre à tes clients, ta clé de secours, ta copie externe.</p>
                  <ul class="pp-choix-meta"><li>${['', 'Une', 'Deux', 'Trois'][QUESTIONS] || QUESTIONS} ${QUESTIONS > 1 ? 'questions' : 'question'}</li></ul>
                  <button type="button" class="btn" id="w-next">Commencer avec mon cabinet</button></article>
              </div>
              <div class="sp-note"><p>Ce qu'il fait : il tient le livre de chaque dossier — saisie, banque, déclaration, paie, immobilisations, clôture et liasse. Ce qu'il ne fait pas : il ne modifie <strong>jamais</strong> la comptabilité d'un client chez lui, et ne dépose aucune déclaration à ta place. Ce qu'il coûte : rien pour les dossiers dont le client est sur SkanFact, ni pour trois dossiers hors SkanFact ; au-delà, une licence.</p></div>
            </div>`;
          },
          mount: () => {
            $('#w-decouvrir', el).onclick = () => { porteVue(); fin('decouvrir'); };
          },
          next: () => { porteVue(); return true; }
        }] : []),
        {
          t: 'Ton cabinet',
          html: () => `
            <p class="small">Ce nom apparaît en bas des relances que tu envoies et dans le fichier que tes clients importeront.</p>
            <div class="grid-2 mt">
              <label class="field obligatoire span-2">${lbl('Nom du cabinet', 'cab.name')}<input type="text" id="w-name" value="${esc(S.cabinet.name || '')}" placeholder="Cabinet Ben Salah"></label>
              <label class="field">${lbl('Email', 'cab.email')}<input type="email" id="w-email" value="${esc(S.cabinet.email || '')}" placeholder="contact@cabinet.tn"></label>
              <label class="field">${lbl('Téléphone', 'cab.phone')}<input type="tel" id="w-phone" value="${esc(S.cabinet.phone || '')}" placeholder="+216 …"></label>
              <label class="field narrow">${lbl('Jour de relance', 'cab.relanceDay')}
                <span class="suffixe"><span class="suffixe-av">le</span><input type="number" id="w-day" min="1" max="28" value="${Number((S.settings || {}).relanceDay) || 10}"><span class="suffixe-ap">de chaque mois</span></span></label>
            </div>`,
          next: async () => {
            const nom = $('#w-name', el).value.trim();
            // 10.10.0 (C-01) — le refus se MONTRE (7.0.0) : un message passager de deux secondes et
            // un bouton qui ne bouge pas se lisaient comme « le bouton ne marche pas ». On amène le
            // champ, on y met le curseur, on le marque — et l'étoile dit, avant le clic, qu'il est
            // obligatoire.
            if (!nom) return refus($('#w-name', el), 'Donne un nom à ton cabinet : il signe tes relances et le fichier que tes clients importent.');
            S = await api.saveCabinet({
              name: nom, email: $('#w-email', el).value.trim(), phone: $('#w-phone', el).value.trim(),
              settings: { relanceDay: Number($('#w-day', el).value) }
            });
            return true;
          }
        },
        {
          t: 'Tes clients',
          mount: () => brancherApercuListe($('#w-clients', el), $('#w-apercu', el), null),
          html: () => `
            <p class="small">Mets-les <strong>tous</strong>, même ceux qui n'utilisent pas encore SkanFact : l'application devient le tableau de bord
            de ton portefeuille, et rien n'est réclamé à ceux qui n'ont pas commencé.</p>
            <label class="field mt">${lbl('Un client par ligne', 'd.liste')}
              <textarea id="w-clients" rows="8" placeholder="Menuiserie Trabelsi SUARL ; 1122334A/M/P/000 ; contact@trabelsi.tn ; +216 22 333 444&#10;Pharmacie El Menzah&#10;Café des Jasmins ; ; jasmins@example.tn"></textarea></label>
            <div id="w-apercu" class="apercu-liste" aria-live="polite"></div>
            <p class="muted small">${CONSIGNE_LISTE}</p>
            <p class="muted small">Pas envie maintenant ? Passe : tu pourras charger un jeu d'exemple ou ajouter tes clients un par un.</p>`,
          next: async () => {
            const txt = $('#w-clients', el).value.trim();
            if (!txt) return true;
            const r = await api.importDossiers(txt);
            S = r.state;
            if (r.added) toast(`${pl(r.added, 'client')} ajouté${r.added > 1 ? 's' : ''}.`);
            if (r.ignorés && r.ignorés.length) toast(`${pl(r.ignorés.length, 'doublon')} ignoré${r.ignorés.length > 1 ? 's' : ''} : ${r.ignorés.slice(0, 3).join(', ')}`, 'error');
            return true;
          }
        },
      ];
      // Le nombre de questions se DÉDUIT des écrans (la porte n'en est pas une) : écrit à la main, il
      // mentirait au premier écran ajouté (9.4.2).
      const QUESTIONS = etapes.filter(e => !e.porte).length;

      function draw() {
        const e = etapes[etape];
        const derniere = etape === etapes.length - 1;
        el.innerHTML = `<div class="wiz-card${e.porte ? ' wiz-porte' : ''}">
          ${/* Le compte se DÉDUIT du nombre d'écrans — écrit à la main, il mentirait au premier écran
                ajouté (défaut corrigé en 9.4.2). La porte n'est pas un écran de questions. */''}
          ${e.porte ? '' : `<div class="wiz-dots"><span class="wiz-compte">Question ${etapes.filter(x => !x.porte).indexOf(e) + 1} sur ${QUESTIONS}</span>
            ${etapes.filter(x => !x.porte).map(x => `<span class="${x === e ? 'on' : etapes.indexOf(x) < etape ? 'done' : ''}"></span>`).join('')}</div>`}
          <h1>${esc(e.t)}</h1>
          <div class="wiz-body">${e.html()}</div>
          ${e.porte ? '' : `<div class="wiz-actions">
            ${etape > 0 && !etapes[etape - 1].porte ? '<button class="btn" id="w-back">← Retour</button>' : ''}
            <span class="grow"></span>
            <button class="btn btn-ghost" id="w-skip">Passer</button>
            <button class="btn btn-primary" id="w-next">${derniere ? 'Commencer' : 'Continuer'}</button>
          </div>`}</div>`;
        if (e.mount) e.mount();
        typographie(el);
        const b = $('#w-back', el); if (b) b.onclick = () => { etape--; draw(); };
        const s = $('#w-skip', el); if (s) s.onclick = () => { if (derniere) { fin(); render(); return; } etape++; draw(); };
        $('#w-next', el).onclick = async () => {
          const btn = $('#w-next', el);
          btn.disabled = true;
          let ok = true;
          try { ok = await e.next(); } catch (ex) { toast(plainError(ex), 'error'); ok = false; }
          btn.disabled = false;
          if (!ok) return;
          if (derniere) { fin(); render(); return; }
          etape++; draw();
        };
        const first = el.querySelector('input, textarea');
        if (first) first.focus();
        else if (e.porte) $('#w-decouvrir', el).focus();
      }
      draw();
    });
  }

  // ---------- recherche rapide (Cmd+K) ----------
  //
  // La palette vit à z-index 60 dans la feuille partagée, sous les fenêtres (400), sous l'assistant
  // (250) et sous l'écran de verrouillage (200). Elle s'ouvrait quand même — DERRIÈRE — et prenait
  // le clavier avec `focus()` : la frappe suivante partait dans un champ invisible. Rien à l'écran,
  // rien en console, et le comptable en concluait que l'application était bloquée. C'est le
  // symptôme exact de la 5.2.2, réintroduit par une palette neuve.
  //
  // Ce garde ne vaut que dans un sens : il refuse d'ouvrir la palette sous une fenêtre. L'autre sens
  // — une fenêtre qui s'ouvre pendant que la palette est là — est tenu par `modal()`, qui la referme.
  function palettePossible() {
    return !$('#palette-root')
      && !$('#modal-root').children.length
      && !$('#setup')
      && !($('#lock-screen') && !$('#lock-screen').hidden);
  }

  function openPalette() {
    if (!palettePossible()) return;
    fermerAppelGuide();
    const root = document.createElement('div');
    root.id = 'palette-root';
    root.innerHTML = `<div class="palette">
      <input type="text" id="pal-q" placeholder="Chercher un client, ou taper une action…" autocomplete="off" spellcheck="false">
      <div class="results" id="pal-res"></div>
      <div class="hint">↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer</div></div>`;
    document.body.appendChild(root);
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); fermerPalette = null; };
    let sel = 0, items = [];

    // Chaque entrée dit ce qu'elle EST (U-07) : un réglage étiqueté « action » faisait croire que
    // taper « tva » lançait quelque chose.
    const actions = [
      { kind: 'action', main: 'Nouveau dossier client…', go: () => newDossierForm() },
      { kind: 'page', main: 'Relances', go: () => { location.hash = '#/relances'; } },
      { kind: 'page', main: 'Échéances', go: () => { location.hash = '#/echeances'; } },
      { kind: 'page', main: 'Écritures — exporter un mois', text: 'export exporter regrouper cabinet', go: () => { location.hash = '#/ecritures'; } },
      { kind: 'page', main: 'Tableau de bord', text: 'tableau de bord avancement production portefeuille', go: () => { location.hash = '#/production'; } },
      // Un réglage par PANNEAU, engendré depuis REG_PANNEAUX : taper « clé de secours » mène au
      // panneau Sécurité, pas en haut d'une page. Une liste écrite à la main se périmerait au
      // prochain découpage — c'est exactement ce qui est arrivé côté entreprise en 7.30.0.
      ...Object.keys(REG_PANNEAUX).filter(id => !(api.panneauxAbsents || []).includes(id)).map(id => ({
        kind: 'réglage', main: `Réglages → ${REG_PANNEAUX[id].titre}`,
        text: K.sansAccents('reglages ' + REG_PANNEAUX[id].titre + ' ' + REG_PANNEAUX[id].mots),
        go: () => versReglages(id)
      })),
      { kind: 'page', main: 'Aide', go: () => { location.hash = '#/aide'; } },
      { kind: 'page', main: 'Me guider', text: 'visite guidee guide apprendre tutoriel decouvrir', go: () => { location.hash = '#/guide'; } },
      // Les visites guidées (10.14.0) : chacune se lance d'ici, par ses mots — « relancer », « tva »,
      // « clé de secours ». Celles qui n'ont encore rien à montrer ne se proposent pas.
      ...visites().filter(v => v.type !== 'page' && !visiteManque(v)).map(v => ({
        kind: 'visite', main: v.titre, sub: v.resume,
        text: K.sansAccents([v.titre, v.resume, (v.mots || []).join(' ')].join(' ')),
        go: () => lancerVisite(v)
      }))
    ];
    // Le dossier OUVERT, lu dans l'adresse au moment où la palette s'ouvre : c'est de lui qu'on
    // parle quand on tape « balance » sur sa fiche.
    const ouvert = (/^#\/dossier\/([^/]+)/.exec(location.hash) || [])[1];
    const courantId = ouvert ? decodeURIComponent(ouvert) : null;
    const ecransPalette = Object.fromEntries(Object.keys(ONGLETS_COMPTA).map(k => [k, { label: ONGLETS_COMPTA[k], mots: MOTS_COMPTA[k] || '' }]));
    // Les ARTICLES d'Aide (10.12.0, vu au test humain) : « rapprochement » ne rendait que l'écran
    // Banque — jamais l'article qui explique comment on rapproche. La palette de l'app entreprise
    // les liste depuis toujours ; celle du Cabinet jamais (le jumeau manquant, 7.3.0). On cherche
    // dans le titre, le sous-titre ET le corps sans ses balises — « lettrage » n'est dans aucun
    // titre —, on classe (titre, puis sous-titre, puis corps : 7.27.0), et on en garde quatre :
    // la palette montre d'abord ce qu'on OUVRE, l'explication vient après.
    // (1.332.0) Par la recherche de l'Aide (aideTrouves) : deux recherches sur les mêmes articles finissaient par dire deux
    // choses, et celle d'ici ne trouvait rien à une question tapée en français (« comment lettrer un acompte »).
    const aidesPour = brut => (window.AideRecherche && window.AideRecherche.mots(brut).length ? aideTrouves(brut).slice(0, 4) : [])
      .map(a => ({ kind: 'aide', main: a.t, sub: a.s, go: () => { aideQ = ''; location.hash = '#/aide/' + a.id; } }));

    function draw() {
      const brut = $('#pal-q', root).value.trim();
      const q = brut.toLowerCase();
      const rows = K.dossierList(S, null, { q, withArchived: true }).slice(0, 30).map(r => ({
        kind: 'client', main: r.name,
        sub: [r.matricule, r.missingCount ? pl(r.missingCount, 'mois', 'mois') + ' manquant' + (r.missingCount > 1 ? 's' : '') : ''].filter(Boolean).join(' · '),
        go: () => { location.hash = '#/dossier/' + encodeURIComponent(r.id); }
      }));
      // Les écrans de comptabilité, en couples client + écran : « balance » sur une fiche ouvre SA
      // balance, « béji balance » celle de Béji. Un écran du livre sur un dossier dont on SAIT qu'il
      // n'a pas de livre le dit : l'adresse le ramènerait au livre-journal, où le bouton qui crée le
      // livre attend.
      const ecrans = K.paletteCompta(brut, ecransPalette, S.dossiers, courantId).map(p => {
        const sansLivre = p.dossierId === livresState.dossierId && livresState.livreEtat === 'absent' && !ONGLETS_SANS_LIVRE.includes(p.ecran);
        return {
          kind: 'écran', main: `${ONGLETS_COMPTA[p.ecran]} — ${p.dossierNom}`,
          sub: sansLivre ? 'Comptabilité › s\'ouvre une fois son livre créé' : `Comptabilité › ${groupeCompta(p.ecran).label}`,
          go: () => { location.hash = adresseCompta({ id: p.dossierId }, p.ecran); }
        };
      });
      // On cherche aussi dans les synonymes : « backup », « token », « cle de secours » ne figurent
      // dans aucun libellé, et deux réponses vides suffisent à faire croire que la palette ne
      // connaît pas l'application.
      const qa = K.sansAccents(brut);
      const acts = actions.filter(a => !qa || K.sansAccents(a.main).includes(qa) || (a.text || '').includes(qa));
      items = ecrans.concat(rows, acts, qa ? aidesPour(brut) : []);
      if (sel >= items.length) sel = Math.max(0, items.length - 1);
      $('#pal-res', root).innerHTML = items.length
        ? items.map((x, i) => `<div class="res ${i === sel ? 'sel' : ''}" data-i="${i}">
            <span class="kind">${esc(x.kind)}</span><span class="main">${esc(x.main)}</span>
            ${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ''}</div>`).join('')
        : '<div class="res"><span class="main muted">Rien ne correspond.</span></div>';
      $$('.res[data-i]', root).forEach(el => {
        el.onclick = () => { const x = items[Number(el.dataset.i)]; close(); if (x) x.go(); };
      });
    }
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); const x = items[sel]; close(); if (x) x.go(); }
    };
    document.addEventListener('keydown', onKey, true);
    fermerPalette = close;                // la seule prise depuis l'extérieur : `modal()` s'en sert
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    $('#pal-q', root).oninput = () => { sel = 0; draw(); };
    draw();
    $('#pal-q', root).focus();
  }

  // ---------- mises à jour ----------
  // Même mécanique que dans SkanFact, avec un canal séparé : l'app cabinet ne reçoit QUE ses
  // versions à elle. Sur macOS l'app n'est pas signée, donc elle se remplace elle-même dans le
  // dossier Applications puis se relance — c'est ce que fait mac-update.sh.
  // L'écran vit dans `src/renderer/majui.js` depuis le 23/09/2026, le même que celui de l'app
  // entreprise (« le même workflow que Apple », Skander). Ici ne restent que le jeton d'accès, la
  // panne de relais et les branchements.
  const ICONE_CAB = '<span class="brand-mark cab"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>';
  function drawUpdatePanel() {
    const el = $('#upd-panel'); if (!el) return;
    const a = upd.app || {};
    const macNonSigne = a.platform === 'darwin' && !a.macSigned;
    // Avec le relais, il n'y a rien à saisir : c'est lui qui détient l'accès au dépôt. On ne montre
    // pas un champ que personne n'a à remplir.
    // Un relais en panne se dit : un écran qui affirme « rien à configurer » devant une mise à jour
    // impossible laisse le comptable sans recours.
    const noteRelais = a.relayFailure ? `<p class="small mt" style="color:var(--danger)">${esc(a.relayFailure)}</p>` : '';
    // Trois états, un seul interrupteur (`a.private`, qui vaut `GITHUB.private` dans main.js) :
    // relais en place → rien à saisir ; dépôt privé → le champ jeton ; dépôt public → rien non plus,
    // sinon un bouton pour retirer un jeton devenu inutile. Avant la 7.26.0, cet écran affirmait
    // « SkanFact est distribué depuis un dépôt privé » alors que le dépôt était public depuis
    // treize versions : le comptable cherchait un jeton que personne n'avait à lui donner.
    const jeton = a.relay
      // La ligne « Mises à jour automatiques — Activées » le dit déjà (23/09/2026).
      ? ''
      : a.private ? noteRelais + `<div class="token-box">
      <div class="k-label">Accès au dépôt</div>
      <p class="small muted">SkanFact est distribué depuis un dépôt privé : un jeton de lecture est nécessaire pour recevoir les mises à jour.
      Demande-le à qui t'a remis l'application. Il reste sur cet ordinateur et ne sert qu'à télécharger les nouvelles versions.</p>
      <div class="inline"><input type="text" id="u-token" placeholder="${a.hasToken ? 'Jeton enregistré ✓ — en coller un nouveau pour le remplacer' : 'github_pat_… ou ghp_…'}" autocomplete="off" spellcheck="false">
      <button class="btn btn-sm" id="u-token-save">Enregistrer le jeton</button>${a.hasToken ? '<button class="btn btn-sm btn-ghost" id="u-token-clear">Retirer</button>' : ''}</div>
    </div>`
        : noteRelais + (a.hasToken ? `<div class="token-box">
      <div class="k-label">Ancien jeton d'accès</div>
      <p class="small muted">Les mises à jour arrivent sans rien présenter. Un jeton datant de l'époque où le dépôt était privé est encore enregistré sur cet ordinateur ; il ne sert plus à rien.</p>
      <div class="inline"><button class="btn btn-sm btn-ghost" id="u-token-clear">Retirer ce jeton</button></div>
    </div>` : '');

    el.innerHTML = MajUI.panneau({
      p: 'u', nom: 'SkanFact Cabinet', icone: ICONE_CAB, a, u: upd,
      notes: notesMaj(upd.notes), quand: quandVerif(a.lastCheck), macNonSigne,
      tokenManquant: !a.relay && a.private && (upd.state === 'token' || !a.hasToken),
      heures: a.autoEvery ? Math.round(a.autoEvery / 3600000) : 0,
      canaux: upd.canaux, aideEssai: info('u.essai'), fin: jeton
    });

    const relire = async () => { upd.app = await api.updVersion(); drawUpdatePanel(); };
    const verifier = async () => {
      upd.state = 'checking'; drawUpdatePanel();
      const r = await api.updCheck();
      if (r && (r.state === 'dev' || r.state === 'token' || r.state === 'error')) {
        upd.state = r.state === 'dev' ? 'idle' : r.state; upd.message = r.message || '';
        // Le détail et la gravité voyagent avec le message, sinon « Détails techniques » et le gris
        // ne servent que pour les erreurs venues d'un événement — jamais pour celles qu'on lit
        // après avoir cliqué.
        upd.detail = r.detail || ''; upd.soft = !!r.soft;
        drawUpdatePanel();
      }
      // Le repli automatique a pu débrancher le relais : on relit l'état plutôt que de continuer à
      // annoncer « rien à configurer ».
      upd.app = await api.updVersion();
      drawUpdatePanel();
    };
    if ($('#u-check')) $('#u-check').onclick = verifier;
    if ($('#u-retry')) $('#u-retry').onclick = async () => {
      upd.percent = 0; drawUpdatePanel();
      const r = await api.updDownload();
      if (r && r.state === 'error') { upd.state = 'error'; upd.message = r.message || ''; upd.detail = r.detail || ''; upd.soft = !!r.soft; drawUpdatePanel(); }
    };
    if ($('#u-releases')) $('#u-releases').onclick = () => api.updOpenReleases();
    if ($('#u-log')) $('#u-log').onclick = () => api.openLog();
    if ($('#u-beta')) $('#u-beta').onchange = async (ev) => {
      const on = ev.target.checked;
      if (on) {
        const ok = await confirmDialog('Recevoir les versions d\'essai',
          '<p>Les versions d\'essai arrivent avant les autres et peuvent contenir des défauts.</p>' +
          '<p class="small">Elles s\'installent <b>par-dessus SkanFact Cabinet</b> et travaillent sur les mêmes dossiers, les mêmes paquets et la même clé. Une sauvegarde va être prise tout de suite, avant tout changement.</p>' +
          '<p class="small">Tu pourras revenir au canal normal à tout moment en désactivant « Versions d\'essai ».</p>',
          'Recevoir les versions d\'essai');
        // Un refus DÉCOCHE vraiment la case : la laisser cochée après un « Annuler » ferait croire
        // que le canal est armé alors qu'il ne l'est pas.
        if (!ok) { ev.target.checked = false; return; }
        // Le filet, pris AVANT d'armer le canal : au moment où la bêta s'installera, le comptable
        // sera ailleurs, et il sera trop tard pour y penser.
        try { await api.backupNow('avant-beta'); } catch { /* pas de filet ≠ pas de canal */ }
      }
      const r = await api.updSetBeta(on);
      upd.app = { ...(upd.app || {}), beta: r.beta };
      upd.state = 'idle';
      drawUpdatePanel();
      toast(r.beta ? 'Versions d\'essai activées — sauvegarde « avant-beta » prise' : 'Retour au canal normal');
      verifier();
    };
    if ($('#u-install')) $('#u-install').onclick = () => installerMaj($('#u-install'));
    if ($('#u-token-save')) $('#u-token-save').onclick = async () => {
      const t = $('#u-token').value.trim();
      if (!t) return toast('Colle un jeton d\'abord', 'error');
      if (!/^(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]+$/.test(t)) return toast('Ce n\'est pas un jeton GitHub : il commence par github_pat_ ou ghp_', 'error');
      const r = await api.updSetToken(t);
      upd.app = { ...(upd.app || {}), hasToken: r.hasToken };
      upd.state = 'idle'; toast('Jeton enregistré');
      verifier();
    };
    if ($('#u-token-clear')) $('#u-token-clear').onclick = async () => {
      const r = await api.updSetToken('');
      upd.app = { ...(upd.app || {}), hasToken: r.hasToken };
      upd.state = 'idle'; drawUpdatePanel();
    };
    // Le panneau vient d'APPARAÎTRE (un nouvel élément, pas un redessin par un événement) : on
    // relit les canaux et on cherche, comme macOS quand on ouvre « Mise à jour de logiciels ».
    const neuf = !el.dataset.monte;
    el.dataset.monte = '1';
    if (!upd.app) relire().then(ouvrirPanneauMaj);
    else if (neuf) ouvrirPanneauMaj();
  }

  async function installerMaj(b) {
    // U-09 : redémarrer pour installer ferme l'application SANS passer par la question de la
    // fermeture (l'installeur de Windows arrête le processus, le script de macOS attend sa fin). On
    // pose donc la même question AVANT, ici.
    const enCours = nomsDesSaisies();
    let force = false;
    if (enCours.length) {
      const ok = await confirmDialog(
        enCours.length > 1 ? 'Des pièces ne sont pas enregistrées' : 'Une pièce n\'est pas enregistrée',
        `<p>${enCours.length > 1
          ? `Des pièces commencées ne sont pas enregistrées : <b>${enCours.map(esc).join('</b>, <b>')}</b>.`
          : `Une pièce commencée pour <b>${esc(enCours[0])}</b> n'est pas enregistrée.`}
          Redémarrer maintenant la perd. Enregistre-la en brouillard d'abord : elle ne prend aucun numéro.</p>`,
        'Redémarrer sans l\'enregistrer', true);
      if (!ok) return;
      force = true;
    }
    if (b) { b.disabled = true; b.textContent = 'Redémarrage…'; }
    const r = await api.updInstall(force ? { force: true } : undefined);
    if (r && r.state === 'error') { upd.state = 'error'; upd.message = r.message; upd.detail = r.detail || ''; upd.soft = !!r.soft; drawUpdatePanel(); }
  }

  // Les notes de version (le CHANGELOG, en Markdown) rendues par le module partagé.
  const notesMaj = md => MajUI.notesHtml(md);

  // À l'ouverture du panneau, comme macOS : la vraie dernière version d'essai publiée, et une
  // recherche si la dernière date.
  function ouvrirPanneauMaj() {
    api.updCanaux().then(c => { upd.canaux = c || null; drawUpdatePanel(); }).catch(() => {});
    const a = upd.app || {};
    if (a.packaged && (!upd.state || upd.state === 'idle' || upd.state === 'none') && Date.now() - (a.lastCheck || 0) > 60 * 1000) {
      const b = $('#u-check'); if (b) b.click();
    }
  }

  // La fenêtre de Sparkle, une fois par version et par jour au plus (voir majui.js).
  function proposerInstallation(ev) {
    const p = $('#upd-panel');
    if (p && p.offsetParent) return;
    if (document.querySelector('#modal-root .modal')) return;
    const lire = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* rappel perdu, rien de grave */ } };
    if (!MajUI.doitProposer(ev.version, lire, Date.now())) return;
    MajUI.noterProposee(ev.version, ecrire, Date.now());
    const a = upd.app || {};
    modal(MajUI.fenetrePrete({
      nom: 'SkanFact Cabinet', icone: ICONE_CAB, version: ev.version, installee: a.version,
      notes: notesMaj(ev.notes || upd.notes), macNonSigne: a.platform === 'darwin' && !a.macSigned
    }), (root, close) => { $('#maj-go', root).onclick = () => { close(); installerMaj(); }; });
  }

  // ---------- aide (refondue en 7.28.0) ----------
  //
  // Avant : les huit articles dépliés l'un sous l'autre sur une seule page, sans sous-titres, sans
  // recherche, sans un seul lien vers l'application. Cinq écrans de prose grise où l'on ne savait
  // ni ce qu'il y avait, ni où l'on en était. C'est le premier contact d'un comptable avec
  // SkanFact, et l'app entreprise venait d'être refaite : celle-ci ne pouvait pas rester ainsi.
  //
  // Maintenant : un plan de huit cartes colorées, une recherche qui traverse le corps des articles,
  // et un article qui dit d'où il vient, ce qu'il contient et où il mène. Les classes sont celles
  // de la feuille PARTAGÉE (`.help-…`, `.th-…`) : c'est le même langage visuel que chez le client,
  // et surtout pas un second jeu de règles qui dériverait (règle 6.8.0 sur les collisions de noms).
  let aideQ = '';
  const aideIcone = a => `<svg viewBox="0 0 24 24" aria-hidden="true">${a.icon || ''}</svg>`;

  // (1.332.0) La recherche de l'Aide est celle de l'entreprise (modules/socle/aide/recherche.js) : on tape une QUESTION —
  // les petits mots ne cherchent rien, un mot se cherche par sa racine (« lettrer » trouve « lettrage »), et un article qui
  // n'a qu'une partie des mots se propose après ceux qui les ont tous. Celle d'ici exigeait chaque mot : « comment valider
  // une écriture » ne trouvait rien. Les accents restent ignorés (10.12.0, U-08).
  const champsAide = a => ({ titre: a.t, sous: a.s || '', corps: a.d || '' });
  const RA = () => window.AideRecherche;
  function aideTrouves(q) {
    return RA().filtre(G.ARTICLES, q, champsAide);
  }

  const aideCarte = a => `<button class="help-art grande ${esc(a.couleur || '')}" data-art="${esc(a.id)}">
      <span class="ht"><span class="ha-ico">${aideIcone(a)}</span>${esc(a.t)}</span>
      <span class="hs">${esc(a.s || '')}</span></button>`;

  // Le chemin d'un écran VIDE vers l'article qui l'explique (10.12.0, U-08) : c'est le jour où
  // l'écran est vide qu'on a le plus besoin de l'article — et la bulle de son titre n'existe pas
  // encore, puisque le titre n'apparaît qu'avec la première ligne.
  const lienArticle = id => {
    const a = G.ARTICLES.find(x => x.id === id);
    return a ? `<a class="lien-aide" href="#/aide/${esc(id)}">Comment ça marche : « ${esc(a.t)} » →</a>` : '';
  };

  // Le geste qui finit un article (7.27.0 côté entreprise, 7.28.0 ici). Un écran de comptabilité
  // n'a pas d'adresse à lui seul : il vit dans CHAQUE dossier. Le geste mène donc à celui du dossier
  // ouvert en dernier — en le nommant, pour qu'on sache où l'on va — et, quand aucun ne l'a été, fait
  // choisir le dossier plutôt que d'en deviner un (10.12.0, U-08).
  function gesteAide(g) {
    const pourquoi = '<span class="small muted">On lit une explication pour faire quelque chose.</span>';
    if (g.ecran) {
      const d = (S.dossiers || []).find(x => x.id === livresState.dossierId && !x.archived);
      // Un écran du livre sur un dossier qui n'en a pas : le bouton ne promet pas un écran que
      // l'adresse ramènerait au livre-journal — il mène à la comptabilité, où l'on crée le livre.
      if (d && livresState.livreEtat === 'absent' && !ONGLETS_SANS_LIVRE.includes(g.ecran)) {
        return `<button class="btn btn-primary" data-ecran="journal" data-dossier="${esc(d.id)}">Ouvrir la comptabilité ${esc(K.de(d.name))}</button>
          <span class="small muted">${esc(ONGLETS_COMPTA[g.ecran] || '')} s'ouvre une fois son livre créé : le bouton qui le crée est en tête de sa comptabilité.</span>`;
      }
      if (d) return `<button class="btn btn-primary" data-ecran="${esc(g.ecran)}" data-dossier="${esc(d.id)}">${esc(g.label)} ${esc(K.de(d.name))}</button>${pourquoi}`;
      return `<button class="btn btn-primary" data-geste="#/">Choisir le dossier</button>
        <span class="small muted">${esc(ONGLETS_COMPTA[g.ecran] || '')} vit dans chaque dossier, onglet Comptabilité.</span>`;
    }
    return `<button class="btn btn-primary" data-geste="${esc(g.hash)}"${g.panneau ? ` data-panneau="${esc(g.panneau)}"` : ''}>${esc(g.label)}</button>${pourquoi}`;
  }

  const CHEVRON_AIDE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  // (1.332.0) Une carte de résultat : le titre surligné, et l'extrait du corps où le mot se trouve (sinon le sous-titre).
  const aideCarteTrouvee = (a, q) => {
    const R = RA();
    const mots = R.mots(q);
    const ex = R.extrait(a.d || '', q, esc);
    return `<button class="help-art grande ${esc(a.couleur || '')}" data-art="${esc(a.id)}">
      <span class="ht"><span class="ha-ico">${aideIcone(a)}</span>${R.surligne(String(a.t || ''), mots, esc)}</span>
      <span class="hs">${ex || R.surligne(String(a.s || ''), mots, esc)}</span></button>`;
  };

  function drawAide(view, arg) {
    const a = G.ARTICLES.find(x => x.id === arg) || null;
    if (a) aideQ = '';
    const i = a ? G.ARTICLES.indexOf(a) : -1;
    const prec = i > 0 ? G.ARTICLES[i - 1] : null;
    const suiv = i >= 0 && i < G.ARTICLES.length - 1 ? G.ARTICLES[i + 1] : null;
    const sup = !!supportCab();
    // (1.332.0) L'en-tête des autres pages du Cabinet (le chemin Tableau de bord › Aide › l'article, le titre et sa phrase),
    // et les gestes du support à droite : en ligne, on écrit à l'équipe SkanFact ; hors ligne, le rapport du poste.
    // « Une question que cette aide ne tranche pas ? Réglages → … » faisait chercher un panneau pour un rapport qui ne
    // partait nulle part.
    view.innerHTML = `
      <div class="page-head lf-tete aide-tete"><div class="titre"><div class="chemin"><a href="#/production">Tableau de bord</a>${CHEVRON_AIDE}${a
        ? `<a href="#/aide" data-home="1">Aide</a>${CHEVRON_AIDE}<span>${esc(a.t)}</span>` : '<span>Aide</span>'}</div>
        <h1>Comment ça marche</h1><p class="sous">Ce que fait SkanFact Cabinet, et comment tenir tes dossiers sans rien perdre</p></div>
        <div class="actions">${sup ? '<button class="btn" id="aide-demandes">Tes demandes au support</button>' : ''}<button class="btn" id="aide-support">${sup ? 'Écrire au support' : 'Signaler un problème'}</button></div></div>
      ${a ? '' : `<p class="lead">Cherche un mot ou pose ta question, ou choisis un article. Partout ailleurs dans l'application, les petits <span class="i-demo">i</span> expliquent le champ juste à côté.</p>`}
      <div class="help-search">
        ${/* 10.12.0 (U-30) — la loupe vit AVEC le champ. Centrée sur le bloc entier, elle
              descendait sous la ligne du texte dès que le compte des résultats s'affichait. */''}
        <span class="hs-champ"><svg class="hs-loupe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/></svg>
        <input type="search" id="aide-q" placeholder="Rechercher : un mot, une question… (« comment lettrer un acompte »)" autocomplete="off" spellcheck="false" value="${esc(aideQ)}"></span>
        <div class="help-count small muted" id="aide-n" hidden></div>
      </div>
      <div id="aide-res" hidden></div>
      <div id="aide-vue"></div>`;

    // Le bas d'un article et de l'accueil : où aller quand l'aide ne tranche pas — le support, nommé par ce qu'il fait.
    const pied = sup
      ? 'Une question que cette aide ne tranche pas ? <b>Écris au support</b> (en haut de cette page) : l\'équipe SkanFact te répond ici, en général dans la journée, et ta demande n\'emporte aucune donnée de tes clients.'
      : 'Une question que cette aide ne tranche pas ? <b>Signaler un problème</b> (en haut de cette page) : le rapport dit où l\'application s\'est arrêtée, et ne contient aucune donnée de tes clients.';
    const vue = $('#aide-vue');
    if (a) {
      vue.innerHTML = `
        <div class="help-layout seul ${esc(a.couleur || '')}">
          <div class="help-col">
            <article class="panel help-body">
              <h2 class="help-h"><span class="ha-ico">${aideIcone(a)}</span>${esc(a.t)}</h2>
              <p class="help-sub">${esc(a.s || '')}</p>
              ${a.d}
              ${a.geste ? `<div class="help-geste">${gesteAide(a.geste)}</div>` : ''}
              <p class="small muted help-foot">${pied}</p>
            </article>
            <div class="help-suite">
              ${prec ? `<button class="btn btn-ghost" data-art="${esc(prec.id)}">← ${esc(prec.t)}</button>` : '<span></span>'}
              ${suiv ? `<button class="btn" data-art="${esc(suiv.id)}">${esc(suiv.t)} →</button>` : '<span></span>'}
            </div>
          </div>
        </div>`;
    } else {
      vue.innerHTML = `<div class="help-arts help-res">${G.ARTICLES.map(aideCarte).join('')}</div>
        <p class="small muted mt">${pied}</p>
        ${sup ? '<div class="help-bas"><div><b>Une idée pour le Cabinet ?</b><span>Dis ce qui te manque, et comment tu fais aujourd\'hui : l\'équipe te répond ici.</span><button class="btn btn-sm" id="aide-idee">Proposer une amélioration</button></div></div>' : ''}`;
    }

    const brancher = () => {
      $$('[data-art]').forEach(b => b.onclick = () => { aideQ = ''; location.hash = '#/aide/' + b.dataset.art; });
      $$('[data-home]').forEach(b => b.onclick = e => { e.preventDefault(); aideQ = ''; location.hash = '#/aide'; });
      // Un geste peut viser un PANNEAU des Réglages, pas seulement une page : depuis les onglets,
      // « Ouvrir les réglages » en haut d'un onglet de trois panneaux n'apprend rien.
      $$('[data-geste]').forEach(b => b.onclick = () => {
        if (b.dataset.panneau) return versReglages(b.dataset.panneau);
        location.hash = b.dataset.geste;
      });
      $$('[data-ecran]').forEach(b => b.onclick = () => { location.hash = adresseCompta({ id: b.dataset.dossier }, b.dataset.ecran); });
    };
    brancher();
    $('#aide-support').onclick = supportDialog;
    if ($('#aide-demandes')) $('#aide-demandes').onclick = () => { location.hash = '#/support'; };
    if ($('#aide-idee')) $('#aide-idee').onclick = ideeDialog;

    const q = $('#aide-q');
    const chercher = () => {
      aideQ = q.value;
      const mots = aideQ.trim();
      const res = $('#aide-res'), n = $('#aide-n');
      res.hidden = !mots; n.hidden = !mots;
      $('#aide-vue').hidden = !!mots;
      if (!mots) { brancher(); return; }
      const trouves = aideTrouves(aideQ);
      // (1.332.0) Ce que la liste contient se dit (comme l'Aide de l'entreprise, 1.331.0) : les articles qui portent tous
      // les mots, puis ceux qui n'en ont qu'une partie — sans quoi une réponse approchée se lirait comme LA réponse.
      const complets = trouves.filter(x => RA().tous(x, aideQ, champsAide)).length;
      const autres = trouves.length - complets;
      const total = G.ARTICLES.length;
      n.textContent = !trouves.length ? `Aucun article sur ${total}`
        : !autres ? `${pl(trouves.length, 'article')} sur ${total}, le plus proche en premier`
          : complets ? `${pl(complets, 'article')} avec tous tes mots, puis ${pl(autres, 'autre')} qui en ${autres > 1 ? 'ont' : 'a'} une partie`
            : `Aucun article n'a tous tes mots : ${trouves.length > 1 ? `les ${trouves.length} plus proches, celui qui en a le plus en premier` : 'le plus proche'}`;
      const grille = xs => `<div class="help-arts help-res">${xs.map(x => aideCarteTrouvee(x, aideQ)).join('')}</div>`;
      // Quand l'Aide ne répond pas, la question part au support telle qu'elle a été tapée (1.331.0 côté entreprise) :
      // c'était « Essaie-les un par un », et le comptable repartait sans réponse.
      const versSupport = sup ? `<div class="help-support"><span>Pas la réponse que tu cherches ? L'équipe SkanFact répond ici, en général dans la journée.</span>
          <button class="btn btn-sm" id="aide-q-support">Poser ma question au support</button></div>` : '';
      res.innerHTML = trouves.length
        ? (complets && autres
          ? `${grille(trouves.slice(0, complets))}<p class="help-res-part small muted" id="aide-partie">Avec une partie de tes mots</p>${grille(trouves.slice(complets))}`
          : grille(trouves)) + versSupport
        : `<div class="empty"><p>Aucun article ne parle de « ${esc(mots)} ». ${sup ? 'Pose ta question au support : l\'équipe SkanFact te répond ici, en général dans la journée.' : 'Essaie un mot voisin, ou parcours les articles.'}</p>
          <div class="inline mt">${sup ? '<button type="button" class="btn btn-primary" id="aide-q-support">Poser ma question au support</button>' : ''}<button type="button" class="btn${sup ? '' : ' btn-sm'}" id="aide-effacer">Revenir aux ${esc(pl(total, 'article'))}</button></div></div>`;
      const effacer = $('#aide-effacer');
      if (effacer) effacer.onclick = () => { q.value = ''; chercher(); q.focus(); };
      const poser = $('#aide-q-support');
      if (poser) poser.onclick = () => ecrireAuSupportCab('question', { sujet: mots, texte: mots });
      brancher();
    };
    q.oninput = chercher;
    q.onkeydown = e => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; chercher(); } };
    if (aideQ) chercher();
  }

  // ---------- le garde-fou d'erreur (9.1.0, SPEC-OUT-004) ----------
  //
  // Même garde-fou que dans l'application entreprise, et posé au même endroit : AVANT la séquence
  // de démarrage, parce qu'une exception levée pendant cette séquence laisse l'écran blanc et ne
  // serait vue par aucun garde-fou installé plus bas.
  //
  // Ici, c'est un défaut de CETTE application qui l'a motivé : `h(a.relayFailure)` — copié de
  // l'app entreprise, où la fonction d'échappement s'appelle `h` et non `esc` — faisait planter le
  // panneau des mises à jour AU MOMENT PRÉCIS où il devait annoncer une panne (6.8.0). Rien en
  // console, rien nulle part, et un comptable devant un panneau muet.
  //
  // Il n'affiche rien et ne recharge rien : c'est au chien de garde de décider ça, lui seul sait
  // si l'interface répond encore.
  const noterErreur = (info) => { try { api.supportErreur(info); } catch {} };
  window.addEventListener('error', e => noterErreur({
    message: (e && e.message) || '(sans message)', source: (e && e.filename) || '',
    ligne: (e && e.lineno) || 0, pile: (e && e.error && e.error.stack) || ''
  }));
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    noterErreur({
      message: 'promesse rejetée : ' + ((r && r.message) || String(r || '(sans raison)')),
      source: '', ligne: 0, pile: (r && r.stack) || ''
    });
  });

  // ---------- chien de garde et messages du processus principal ----------
  // Abonnés AVANT la séquence de démarrage : l'écran de verrouillage la met en attente, et un
  // message reçu pendant ce temps serait perdu pour toujours (règle apprise en 6.5.0).
  // Le battement de cœur : répondre tant que l'interface tourne. La réponse part du fil principal
  // du renderer — c'est exactement lui qu'une boucle infinie bloquerait.
  api.onAlivePing();
  // Après un gel, l'application se recharge toute seule. Elle le dit : sans un mot, le comptable se
  // retrouve devant l'écran de verrouillage sans comprendre pourquoi, et doute de ce qui a été
  // enregistré.
  api.onFreezeNotice(f => {
    modal(`<h2>SkanFact Cabinet s'était bloqué</h2>
      <p>L'application n'a plus répondu pendant ${esc(String((f && f.silence) || '?'))} secondes, et elle vient de redémarrer toute seule.</p>
      <p class="small"><strong>Rien n'est perdu :</strong> les paquets déjà rangés le restent et ton cabinet est intact. Il faut seulement rouvrir avec ton mot de passe.</p>
      <p class="small">SkanFact a noté où le programme s'était arrêté. Si cela se reproduit, envoie-le : <em>Aide → Signaler un problème</em>. C'est ce qui permet de corriger.</p>
      <div class="modal-actions"><span class="grow"></span><button class="btn" id="fz-ok">Continuer</button><button class="btn btn-primary" id="fz-rep">Signaler</button></div>`,
      (layer, close) => {
        $('#fz-ok', layer).onclick = close;
        $('#fz-rep', layer).onclick = () => { close(); supportDialog(); };
      });
  });

  // ---------- démarrage ----------
  boot().catch(e => { $('#lock-sub').textContent = 'Erreur au démarrage : ' + plainError(e); });
})();
