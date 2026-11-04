  // ---------- la paie d'un dossier (10.3.0) ----------
  //
  // Le travail mensuel le plus réclamé après la TVA, et le Cabinet ne savait pas le faire. Un
  // cabinet a soixante clients dont deux utilisent SkanFact : pour les cinquante-huit autres, le
  // comptable établissait les bulletins ailleurs et RETAPAIT l'écriture ici.
  //
  // Tout se calcule sur `s.livre`, déjà en mémoire : le moteur est celui de l'app entreprise
  // (`compta.js`), donc le bulletin du client et celui du cabinet ne peuvent pas diverger.
  function vuePaie(dossier) {
    const s = livresState;
    const L = s.livre;
    // U-12 — le dernier mois qui a des bulletins, sinon le mois courant : jamais décembre en
    // septembre, un mois futur qui avait l'air d'un dossier vide.
    if (!s.paieMois) s.paieMois = K.moisDeTravail((L.bulletins || []).filter(b => Number(b.annee) === Number(s.annee)).map(b => b.mois), s.annee, K.today());
    const m = s.paieMois;
    const bulletins = KC.bulletinsDuMois(L, s.annee, m);
    const masse = KC.masseSalariale(bulletins);
    const anneeEntiere = KC.masseSalariale((L.bulletins || []).filter(b => Number(b.annee) === Number(s.annee)));
    const controles = KC.controlesPaie(L, s.annee, m);
    const aFaire = controles.filter(c => c.niveau !== 'info'), etatsNormaux = controles.filter(c => c.niveau === 'info');
    const aPasser = bulletins.filter(b => !b.ecritureId).length;
    const nomDe = id => ((L.salaries || []).find(x => x.id === id) || {}).nom || '—';
    // Trois états, le vocabulaire du LIVRE (10.12.0) : « brouillon » disait un bulletin sans aucune
    // écriture, et « écrite » une écriture encore au brouillard — pendant que la déclaration du même
    // mois disait « pas encore d'écriture validée ». Deux écrans ne se contredisent pas (6.8.1).
    const statutDe = id => (ecritureDuLivre(L, id) || {}).statut;
    const etatDe = b => !b.ecritureId ? 'a-passer' : statutDe(b.ecritureId) === 'brouillard' ? 'brouillard' : 'ecrite';
    const auBrouillard = bulletins.some(b => etatDe(b) === 'brouillard');
    // (plateforme) 1.102.0 — l'écriture de paie est datée du dernier jour du mois : avant ce jour, elle ne se valide pas
    // (son numéro suit l'ordre des jours). L'écran le dit avant le geste, sans bouton qui mène au refus.
    const ecrPaie = auBrouillard ? ecritureDuLivre(L, (bulletins.find(b => etatDe(b) === 'brouillard') || {}).ecritureId) : null;
    const paieAttendSonJour = ecrPaie && String(ecrPaie.date || '') > K.today() ? String(ecrPaie.date) : '';
    const t = s.paieTrimestre || Math.ceil(m / 3);
    const cnss = KC.cnssDuTrimestre(L, s.annee, t);
    // 10.14.1 (DECL D2) — le fichier de télédéclaration du trimestre, par la MÊME fonction que le
    // processus principal qui l'écrira : ses refus se lisent AVANT le geste (9.4.2), chacun avec la
    // case qui le lève, et le bouton s'éteint par le même verdict (9.4.5).
    const fichier = cnss.lignes.length ? KC.fichierCnssDuLivre(L, { matricule: dossier.cnssEmployeur, code: dossier.cnssCode }, s.annee, t) : null;
    // Un trimestre EN COURS n'a pas encore tous ses bulletins : on le déclare une fois terminé (la
    // règle de « Marquer déposée » de l'app entreprise, 10.12.0) — sinon le fichier oublierait son
    // dernier mois, et le portail l'accepterait.
    // Le dernier jour du trimestre, en UTC pur (règle 5.2.3) : le jour 0 du mois qui suit.
    const finTrim = new Date(Date.UTC(Number(s.annee), t * 3, 0)).toISOString().slice(0, 10);
    const trimEnCours = K.today() <= finTrim ? `Le ${KC.TRIMESTRES_PAIE[t - 1][1]} ${s.annee} se termine le ${fmtJour(finTrim)} : on le déclare une fois terminé, sinon il manquerait ses derniers bulletins.` : '';
    const actifs = (L.salaries || []).filter(x => x.actif);

    const lignesBulletins = bulletins.map(b => {
      const c = b.calcul || {};
      return `<tr data-bul="${esc(b.id)}">
        <td class="tronq" title="${esc(nomDe(b.salarieId))}">${esc(nomDe(b.salarieId))}</td>
        <td class="r nw">${esc(money(c.gross))}</td>
        <td class="r nw">${esc(money(c.cnssEmployee))}</td>
        <td class="r nw">${esc(money(KC.round3((c.irpp || 0) + (c.css || 0))))}</td>
        <td class="r nw"><b>${esc(money(c.net))}</b></td>
        <td class="r nw">${esc(money(KC.employerChargesOf(c)))}</td>
        <td class="r nw">${esc(money(c.employerCost))}</td>
        <td class="nw">${{ 'a-passer': '<span class="badge b-due">à passer</span>', brouillard: '<span class="badge b-part">au brouillard</span>', ecrite: '<span class="badge b-paid">écrite</span>' }[etatDe(b)]}</td>
        ${RowMenu.cellule('PAIE:' + b.id)}</tr>`;
    }).join('');

    // U-11 — le bouton en couleur est l'ÉTAPE SUIVANTE du mois : un salarié à déclarer, puis les
    // bulletins qui manquent, puis l'écriture. « + Bulletin… » était vert sur un dossier sans
    // salarié — principal ET éteint, c'est-à-dire un geste qu'on montre du doigt et qu'on refuse.
    const manquants = (controles.find(c => c.id === 'bulletins-manquants') || {}).count || 0;
    // Au brouillard, l'étape suivante est de VALIDER : la paie n'entre dans les livres qu'à ce moment.
    const suivante = !actifs.length ? 'salarie' : manquants ? 'bulletin' : aPasser ? 'ecrire' : auBrouillard ? 'valider' : '';
    const cls = pas => 'btn btn-sm' + (pas === suivante ? ' btn-primary' : '');
    // U-23 — un bouton éteint dit POURQUOI à côté de lui, pas seulement au survol : l'infobulle ne
    // se voit ni au clavier ni au doigt (règle 9.4.5). Le `title` reste, pour qui survole.
    const pourquoiBulletin = actifs.length ? '' : 'Déclare d\'abord un salarié.';
    const pourquoiEcrire = aPasser ? '' : (bulletins.length ? 'L\'écriture de ce mois est déjà passée : la repasser compterait la paie deux fois.' : 'Aucun bulletin pour ce mois.');
    const motifs = [pourquoiBulletin && '« + Bulletin » attend un salarié : déclare-le d\'abord.',
      pourquoiEcrire && (bulletins.length ? '« Passer l\'écriture de paie » : celle de ce mois est déjà passée — la repasser compterait la paie deux fois.'
        : '« Passer l\'écriture de paie » attend les bulletins du mois.')].filter(Boolean);
    // (plateforme) 1.235.0 — la paie du Cabinet telle que sa maquette (docs/revue-paie-cabinet.md, lots C1 à C3) : qui fait la
    // paie (le choix écrit du client), cinq vues, la frise du mois, un seul bouton principal (l'étape suivante, selon le
    // parcours : tenue au cabinet avec l'accord du client, faite par le client et vérifiée, ou seule), les bulletins rangés
    // par ce qui change depuis le mois d'avant, le bulletin ouvert dans un volet.
    const vue = s.paieVue || 'mois';
    const P = parcoursPaie(dossier, L, s.annee, m, bulletins);
    const tete = paieEnTete(dossier, L, s.annee, m, P, vue);
    // (1.240.0, la maquette « paiesalaries ») La fiche du salarié choisi, à droite de la liste.
    const ficheSal = vue === 'salaries' && s.paieSal ? (L.salaries || []).find(x => x.id === s.paieSal) || null : null;
    // (1.241.0, la maquette « paiesortie ») Le départ d'un salarié qui a une date de sortie : son dernier bulletin en projet.
    const departSal = vue === 'salaries' && s.paieDepart ? (L.salaries || []).find(x => x.id === s.paieDepart && x.sortie) || null : null;
    if (vue === 'salaries') return `${tete}
    ${(() => { const fin = (L.salaries || []).filter(x => x.actif && x.sortie && x.sortie >= aujourdhuiPaie() && x.sortie <= dansJours(45));
    return fin.length ? `<div class="cp-pa-bandeau" id="pa-cdd">${fin.map(x => `<b>${esc(x.nom)}</b> : son ${esc(KC.contractLabel(x.contrat).split(' —')[0])} finit le ${esc(fmtJour(x.sortie))}`).join(' · ')}. Le renouveler, ou préparer sa sortie : le dernier bulletin solde ses congés pas pris ; <b>À VÉRIFIER</b> : l'indemnité de fin de contrat avec le contrat et la convention.
      <span class="cp-pa-g">${fin.map(x => `<button type="button" class="btn btn-sm" data-pa-depart="${esc(x.id)}">Préparer son départ</button><button type="button" class="btn btn-sm" data-pa-docs="${esc(x.id)}">Ses documents de sortie…</button>${peutMeRappeler(dossier) ? `<button type="button" class="btn btn-sm" data-pa-me-rappeler="${esc(x.id)}" data-le="${esc(rappelAvantSortie(x.sortie))}">Me le rappeler le ${esc(fmtJour(rappelAvantSortie(x.sortie)).slice(0, 5))}</button>` : ''}`).join('')}</span></div>` : ''; })()}
    ${departSal ? paieDepart(dossier, L, departSal, P) : ''}
    <div class="panel mt" id="pa-salaries"><div class="cp-pa-titre-l"><h2>Les salariés ${info('pa.salaries')}</h2>${(() => {
      const enPoste = (L.salaries || []).filter(x => x.actif), finit = enPoste.filter(x => x.sortie && x.sortie >= aujourdhuiPaie()), sortis = (L.salaries || []).filter(x => !x.actif || (x.sortie && x.sortie < aujourdhuiPaie()));
      return `<span class="small muted" id="pa-sal-resume">${esc(pl(enPoste.length, 'en poste', 'en poste'))} · ${finit.length ? esc(pl(finit.length, 'contrat qui finit', 'contrats qui finissent')) : 'aucun contrat qui finit'} · ${sortis.length ? esc(pl(sortis.length, 'sorti', 'sortis')) : 'aucun sorti'}</span>`; })()}${P.mode === 'cabinet' || P.mode === 'tenue' ? '<button type="button" class="btn btn-sm" id="pa-salarie">+ Un salarié…</button>' : `<span class="small muted">${esc(P.client)} les déclare dans SkanFact.</span>`}</div>
        ${regimesDuDossier(dossier, L)}
        ${(L.salaries || []).length
    ? `<div class="cp-pa-grille${ficheSal ? ' avec-volet' : ''}"><div class="scroll-x"><table class="list compact" id="pa-sal-liste"><thead><tr><th>Nom</th><th class="nw">N° CNSS</th>
        <th>Poste</th><th class="nw">Contrat</th><th class="r nw">Brut mensuel</th><th class="nw">RIB</th><th class="row-actions-h"></th></tr></thead>
        <tbody>${(L.salaries || []).map(x => `<tr class="${x.actif ? '' : 'muted'}${ficheSal && ficheSal.id === x.id ? ' sel' : ''}" data-sal="${esc(x.id)}" tabindex="0">
          <td class="tronq" title="${esc(x.nom)}">${marquesDuNom(esc(x.nom), [
    x.reporteDe ? `<span class="badge" data-repris="${esc(x.reporteDe)}" title="Repris de l'exercice ${esc(x.reporteDe)} : sa fiche a suivi, ses bulletins restent dans leur mois">repris de ${esc(x.reporteDe)}</span>` : '',
    x.actif ? '' : '<span class="badge">sorti</span>'])}${x.embauche ? `<div class="small muted">depuis ${esc(fmtJour(x.embauche).slice(3))}</div>` : ''}</td>
          <td class="nw">${x.cnss ? esc(x.cnss) : '<span class="warn-text small">à renseigner</span>'}</td>
          <td class="tronq" title="${esc(x.poste)}">${esc(x.poste || '—')}</td>
          <td class="nw small">${esc(KC.contractLabel(x.contrat).split(' —')[0])}${x.sortie ? `<div class="${x.actif && x.sortie >= aujourdhuiPaie() && x.sortie <= dansJours(45) ? 'warn-text' : 'muted'}">${x.sortie < aujourdhuiPaie() ? 'sorti' : 'finit'} le ${esc(fmtJour(x.sortie))}</div>` : ''}</td>
          <td class="r nw">${esc(money(x.brut))}${/* (plateforme) 1.68.0 — les primes de chaque mois de la fiche, comme la liste de
            l'entreprise : celles qu'un bulletin nouveau reprendra, pour un mois entier. */''}${(x.primes || []).length
    ? `<div class="small muted">+ ${esc(money(Math.round((x.primes || []).reduce((a, p) => a + (Number(p.amount) || 0), 0) * 1000) / 1000))} de primes</div>` : ''}</td>
          <td class="nw small">${x.rib ? `··· ${esc(String(x.rib).replace(/\s/g, '').slice(-4))}` : x.methode === 'especes' ? '<span class="muted">espèces</span>' : '<span class="warn-text">à demander</span>'}</td>
          ${RowMenu.cellule('SAL:' + x.id)}</tr>`).join('')}</tbody></table></div>${ficheSal ? paieFicheSalarie(dossier, L, ficheSal, P, s.annee) : ''}</div>`
    : `<div class="empty mini">Aucun salarié déclaré. C'est par là qu'une paie commence.
        <div class="mt"><button class="btn btn-sm" id="pa-salarie2">Déclarer un salarié…</button></div></div>`}
    ${(() => { const manque = (L.salaries || []).filter(x => x.actif && (!x.cnss || (!x.rib && x.methode !== 'especes')));
      return manque.length && !dossier.manual && api.messagerie && P.mode !== 'cabinet' ? `<div class="ctrl-geste" id="pa-sal-manque"><span class="small">${manque.map(x => `<b>${esc(x.nom)}</b> : ${[!x.cnss && 'n° CNSS', !x.rib && x.methode !== 'especes' && 'RIB'].filter(Boolean).join(' et ')}`).join(' · ')}</span><button type="button" class="btn btn-sm" id="pa-sal-demander">Les demander à ${esc(P.client)}</button></div>` : ''; })()}
    </div>
`;
    if (vue === 'conges') return `${tete}${paieAbsencesAVenir(dossier, L, P)}${vueConges(dossier, L, s.annee)}${vueAvances(dossier, L, s.annee)}`;
    if (vue === 'cnss') return `${tete}
    <div class="panel mt"><h2>La déclaration CNSS ${info('pa.cnss')}</h2>
        <div class="filters">
          <label class="f-lab" for="pa-trim">Trimestre</label>
          <select id="pa-trim">${KC.TRIMESTRES_PAIE.map(x => `<option value="${x[0]}" ${x[0] === t ? 'selected' : ''}>${esc(x[1])} ${esc(s.annee)}</option>`).join('')}</select>
        </div>
        ${cnss.lignes.length
    ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Salarié</th><th class="nw">N° CNSS</th>
        <th class="r nw">Assiette</th><th class="r nw">Part salarié</th><th class="r nw">Part employeur</th></tr></thead>
        <tbody>${cnss.lignes.map(l => `<tr><td class="tronq" title="${esc(l.nom)}">${esc(l.nom)}</td>
          <td class="nw">${l.cnss ? esc(l.cnss) : '<span class="warn-text small">—</span>'}</td>
          <td class="r nw">${esc(money(l.assiette))}</td><td class="r nw">${esc(money(l.partSalarie))}</td>
          <td class="r nw">${esc(money(KC.round3(l.partEmployeur + l.accident)))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="2">${esc(pl(cnss.salaries, 'salarié'))}</th>
          <th class="r nw">${esc(money(cnss.assiette))}</th><th class="r nw">${esc(money(cnss.partSalarie))}</th>
          <th class="r nw">${esc(money(KC.round3(cnss.partEmployeur + cnss.accident)))}</th></tr>
          <tr class="dc-total"><th colspan="4"><b>Total à verser</b></th><th class="r nw"><b>${esc(money(cnss.total))}</b></th></tr></tfoot></table></div>
        ${/* La date limite par la règle des Échéances (le jour réglé dans les Réglages) : la Paie
              écrivait « le 15 » à côté d'un calendrier réglable — deux écrans, deux dates pour la
              même déclaration (10.14.0, dateLimiteSociale). */''}
        <div class="mt">${ligneEcheanceDeclaration(dossier, `${s.annee}-${String(t * 3).padStart(2, '0')}`, null, 'cnss', 'pa-portail')}</div>
        ${paieCnssDuLivre(L, s.annee, t, cnss)}
        ${paieAccuseCnss(dossier, s.annee, t)}
        ${panneauFichierCnss(dossier, fichier, trimEnCours)}
        ${/* (plateforme) 1.65.0 — l'état récapitulatif des salaires déclarés, celui de l'entreprise, imprimé. */''}
        <div class="ctrl-geste mt"><button type="button" class="btn btn-sm" id="pa-etat">Imprimer l'état récapitulatif</button>
          <span class="small muted">Les cotisations du trimestre sur le total des salaires, au taux du régime, dans l'ordre du formulaire.</span></div>`
    : `<div class="empty mini">Aucun bulletin sur ce trimestre : il n'y a rien à déclarer.</div>`}
    </div>

`;
    if (vue === 'tous') return `${tete}${paieDeTousMesDossiers(dossier, s)}`;
    if (vue === 'annee') return `${tete}<div class="ctrl-geste mt" id="pa-vers-tous"><span class="small muted">Où en est la paie des autres dossiers ce mois-ci ?</span><button type="button" class="btn btn-sm" data-pa-vue="tous">La paie de tous mes dossiers</button></div>${paieMoisParMois(L, s.annee, anneeEntiere)}${paieLivreEtFinDAnnee(dossier, L, s.annee, anneeEntiere)}
    <div class="panel mt"><h2>La masse salariale de l'exercice ${info('pa.masse')}</h2>
      ${/* U-24 — un tableau de zéros n'apprend rien : sans bulletin sur l'exercice, on le dit. */''}
      ${!anneeEntiere.count ? `<div class="empty mini">Aucun bulletin sur l'exercice ${esc(s.annee)} : la masse salariale se calcule dès le premier.</div>` : `
      ${/* « Versé » est un ÉTAT (10.12.0) : le Cabinet lit les bulletins, pas leur paiement — le net
            reste au 425 tant que la banque ne l'a pas soldé. La masse dit donc ce que les bulletins
            portent, jamais ce qui est sorti. */''}
      <table class="list compact"><tbody>
        <tr><td>Salaires bruts</td><td class="r nw">${esc(money(anneeEntiere.brut))}</td></tr>
        <tr><td>Retenues salariales (CNSS, IRPP, CSS)</td><td class="r nw">${esc(money(KC.round3(anneeEntiere.cnssSalarie + anneeEntiere.irpp + anneeEntiere.css)))}</td></tr>
        <tr><td>Net des bulletins</td><td class="r nw">${esc(money(anneeEntiere.net))}</td></tr>
        <tr><td>Charges patronales (CNSS, accident, TFP, FOPROLOS)</td><td class="r nw">${esc(money(anneeEntiere.chargesPatronales))}</td></tr>
        <tr class="dc-total"><td><b>Coût employeur</b></td><td class="r nw"><b>${esc(money(anneeEntiere.cout))}</b></td></tr>
      </tbody></table>
      <p class="small muted mt">Ce qui entre dans le résultat, c'est le <b>coût employeur</b> — jamais le net, jamais le brut seul.</p>`}
    </div>`;
    if (vue === 'pointage') return `${tete}${paiePointageResume(dossier, L, s.annee, m, P)}${vuePointage(dossier, L, s.annee, m)}`;
    if (vue === 'ecarts') return `${tete}${paieEcarts(L, s.annee, m, bulletins, nomDe)}`;
    if (vue === 'param') return `${tete}${paieParametrage(dossier, L, P)}`;
    return `${tete}${paieLeMois(dossier, L, s.annee, m, bulletins, P, { aFaire, etatsNormaux, auBrouillard, paieAttendSonJour, masse, cls, actifs, etatDe, nomDe })}`;
  }

  // (plateforme) 1.235.0 — le parcours de la paie d'un mois, lu des deux applications (docs/revue-paie-cabinet.md) : qui la
  // fait (le choix ÉCRIT du client : « tenue » par le cabinet, « seule » faite par lui et vérifiée, « sans »), où en sont
  // les bulletins (envoyés pour accord, approuvés, vérifiés, une correction proposée, validés, payés), et l'étape suivante :
  // le seul bouton principal de la page. Un dossier que le Cabinet tient sans SkanFact chez le client n'attend aucun accord.
  // Le prénom du client que les boutons nomment : le contact de sa fiche au Cabinet, sinon le gérant qu'il a écrit dans son
  // SkanFact (lu avec son choix de paie), sinon « ton client ».
  const clientDePaie = (dossier, L) => prenomCl(dossier.contact) || prenomCl(((L && L.modePaie) || {}).gerant) || 'ton client';
  function parcoursPaie(dossier, L, annee, m, bulletins) {
    const ym = `${annee}-${String(m).padStart(2, '0')}`;
    const mp = L.modePaie || {};
    const ecrit = mp.paieModeDes && ym < String(mp.paieModeDes) ? String(mp.paieModeAvant || '') : String(mp.paieMode || '');
    const surSkanFact = !!L.reglagesPaie;
    const mode = !surSkanFact ? 'cabinet' : ecrit === 'seule' ? 'seule' : ecrit === 'sans' ? 'sans' : 'tenue';
    const accordRequis = mode === 'tenue' && ecrit === 'tenue';
    const client = clientDePaie(dossier, L);
    const n = bulletins.length;
    const tous = f => n > 0 && bulletins.every(f);
    const controles = KC.controlesPaie(L, annee, m);
    const manquants = (controles.find(c => c.id === 'bulletins-manquants') || {}).count || 0;
    const actifs = (L.salaries || []).filter(x => x.actif);
    const enAttente = bulletins.filter(b => b.correction && !b.correction.reponse);
    const P = { ym, mode, ecrit, accordRequis, client, n, manquants, actifs: actifs.length, enAttente,
      reponses: bulletins.filter(b => b.correction && b.correction.reponse),
      envoyes: tous(b => b.pourAccordLe), approuves: tous(b => b.bonAPayerLe), verifies: tous(b => b.verifieLe), valides: tous(b => b.valideLe),
      payes: bulletins.filter(b => b.payeLe).length, remis: tous(b => b.remisLe) };
    // 1.236.0 — le pointage du mois : combien de salariés en poste ont une grille enregistrée (celle du client, ou du cabinet).
    const donnees = donneesDuPointage(dossier, L);
    P.pointe = actifs.filter(x => KC.pointageEnregistre(donnees, x.id, Number(annee), m)).length;
    // 1.237.0 — l'échéance d'une avance que le bulletin du mois ne retient pas (la maquette : « l'avance n'est pas retenue »).
    P.oublis = bulletins.flatMap(b => KC.echeancesDuMois(donnees, b.salarieId, Number(annee), m)
      .filter(d => !(b.retenues || []).some(r => r.advanceId === d.advanceId)).map(d => ({ b, d })));
    P.sansCnss = actifs.filter(x => !x.cnss);
    P.entrees = actifs.filter(x => String(x.embauche || '').slice(0, 7) === ym);
    const dernier = k => bulletins.map(b => String(b[k] || '')).sort().pop() || '';
    P.envoyeLe = dernier('pourAccordLe'); P.approuveLe = dernier('bonAPayerLe'); P.valideLe = dernier('valideLe');
    // L'étape suivante : un geste (`id`, son texte) ou une attente (le texte d'un bouton éteint qui dit pourquoi).
    P.geste = !P.actifs ? { id: 'pa-salarie', t: 'Déclarer un salarié…' }
      : mode === 'sans' ? null
        : mode === 'seule' ? (!n ? { attente: `Les bulletins sont à faire par ${client}` } : enAttente.length ? { attente: `En attente de ${client}` }
          : P.oublis.length ? { id: 'pa-proposer-oubli', t: `Proposer la correction à ${client}` }
          : !P.verifies ? { id: 'pa-verifier-tout', t: `Marquer ${n > 1 ? `les ${n} bulletins vérifiés` : 'le bulletin vérifié'}` } : null)
          : manquants ? { id: 'pa-bulletin', t: `Établir les bulletins : ${manquants} à faire…` }
            : P.valides ? (!P.remis ? { id: 'pa-remettre', t: `Marquer ${n > 1 ? `les ${n} bulletins remis` : 'le bulletin remis'} aux salariés` } : null)
              : accordRequis && !P.envoyes ? { id: 'pa-envoyer', t: `Envoyer à ${client} pour accord` }
                : accordRequis && !P.approuves ? { attente: `En attente de l'accord de ${client}` }
                  : n ? { id: 'pa-valider-bul', t: `Valider ${n > 1 ? `les ${n} bulletins` : 'le bulletin'}` } : null;
    return P;
  }
  const jourCourt = d => (d ? fmtJour(String(d).slice(0, 10)).slice(0, 5) : '');
  // L'en-tête de la paie : le mois, qui la fait, et les cinq vues (comme la maquette).
  function paieEnTete(dossier, L, annee, m, P, vue) {
    const qui = { cabinet: 'tenue au cabinet', tenue: `tenue au cabinet${P.accordRequis ? `, avec l'accord de ${P.client}` : ''}`,
      seule: `faite par ${P.client} dans SkanFact · le cabinet la vérifie, et la corrige avec son accord`,
      sans: `faite par ${P.client} seul dans SkanFact · le cabinet la lit et la passe en comptabilité` }[P.mode];
    const V = [['mois', 'Le mois'], ['salaries', 'Salariés', P.actifs], ['conges', 'Congés et avances'], ['cnss', 'CNSS du trimestre', P.sansCnss.length, 'alerte'], ['annee', 'L\'année']];
    const vueDe = ['pointage', 'ecarts', 'param'].includes(vue) ? 'mois' : vue === 'tous' ? 'annee' : vue;
    return `<div class="cp-pa-tete" id="pa-tete"><div class="cp-pa-titre"><h2>Paie ${esc(KC.deMois(KC.moisPaie(m)))} ${esc(annee)}</h2>
        <select id="pa-mois" aria-label="Le mois de la paie">${KC.MOIS_PAIE.map((lab, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>
        <p class="small muted" id="pa-qui">${esc(pl(P.actifs, 'salarié'))} · ${esc(qui)}</p></div>
      <div class="cp-pa-vues">${vue !== 'mois' && (P.mode === 'cabinet' || P.mode === 'tenue') && P.actifs && !P.valides ? '<button type="button" class="btn btn-sm" id="pa-bulletin">+ Un bulletin…</button>' : ''}
      <div class="pa-so" role="group" aria-label="La paie">${V.map(([k, t, nb, ton]) => `<button type="button" data-pa-vue="${k}" aria-pressed="${vueDe === k}">${esc(t)}${nb ? ` <span class="cp-pa-nb${ton ? ` ${ton}` : ''}">${nb}</span>` : ''}</button>`).join('')}</div></div></div>`;
  }
  // Ce qui change depuis le mois d'avant, dit sur la ligne du bulletin (la maquette) : heures sup, jours sans solde, entrée
  // au prorata, avance retenue, correction ; sinon « comme <mois> ».
  // (plateforme) 1.238.0 — l'échéancier d'une avance (la maquette, « septembre · 100,000 retenu … novembre · 100,000 ») :
  // les retenues faites, lues sur les bulletins mois par mois, puis celles à venir à la retenue convenue, la dernière
  // soldant ce qui reste. Un mois à venir qui a déjà son bulletin sans la retenue est un oubli : il se dit.
  function echeancierAvance(L, a) {
    const bul = (L.remboursements || []).filter(p => p.employeeId === a.employeeId);
    const faites = bul.map(p => ({ y: Number(p.year), m: Number(p.month), montant: KC.round3((p.deductions || []).filter(d => d.advanceId === a.id).reduce((s2, d) => s2 + (Number(d.amount) || 0), 0)) }))
      .filter(x => x.montant > 0).sort((x, z) => x.y - z.y || x.m - z.m);
    const avecBulletin = new Set(bul.map(p => `${Number(p.year)}-${Number(p.month)}`));
    const der = faites[faites.length - 1];
    const depart = (a.debut || String(a.date || '').slice(0, 7)).split('-').map(Number);
    let y = der ? der.y : depart[0], m = der ? der.m + 1 : depart[1];
    const prevues = [];
    let reste = KC.round3(Math.max(0, (Number(a.amount) || 0) - faites.reduce((s2, x) => s2 + x.montant, 0)));
    const par = KC.round3(Number(a.monthly) || reste);
    while (reste > 0.0005 && par > 0 && prevues.length < 120 && y > 0) {
      if (m > 12) { y += 1; m = 1; }
      const x = KC.round3(Math.min(par, reste));
      prevues.push({ y, m, montant: x, oubli: avecBulletin.has(`${y}-${m}`) });
      reste = KC.round3(reste - x); m += 1;
    }
    return { faites, prevues };
  }
  // Sur la ligne d'un bulletin : « avance : 2e retenue sur 3 · il restera 100,000 en novembre ».
  function laRetenueDAvance(L, b, x) {
    const a = (L.avances || []).find(v => v.id === x.advanceId);
    if (!a) return `avance retenue · ${money(x.amount)}`;
    const { faites, prevues } = echeancierAvance(L, a);
    const ici = Number(b.annee) * 12 + Number(b.mois);
    const jusquIci = faites.filter(f => f.y * 12 + f.m <= ici);
    const rang = jusquIci.length || 1;
    const reste = KC.round3(Math.max(0, (Number(a.amount) || 0) - jusquIci.reduce((s2, f) => s2 + f.montant, 0)));
    const suivant = Number(b.mois) === 12 ? 1 : Number(b.mois) + 1;
    return `avance : ${rang === 1 ? '1re' : `${rang}e`} retenue sur ${faites.length + prevues.length} · ${reste > 0.0005 ? `il restera ${money(reste)} en ${KC.moisPaie(suivant)}` : 'soldée'}`;
  }
  function paieCeQuiChange(L, b, avant, moisAvant) {
    const c = b.calcul || {}, R = [];
    const hs = (b.primes || []).filter(x => /suppl|h sup/i.test(x.label || ''));
    if (hs.length) R.push(hs.map(x => x.label).join(', ').replace(/^Heures supplémentaires/i, 'heures sup'));
    if (Number(b.joursAbsence) > 0) R.push(`${joursFr(b.joursAbsence)} jour${Number(b.joursAbsence) > 1 ? 's' : ''} sans solde`);
    if (b.prorata) R.push(`${b.prorata.motif || 'prorata'} · ${joursFr(b.prorata.jours)} jours sur ${joursFr(b.prorata.sur)}`);
    (b.retenues || []).filter(x => x.advanceId).forEach(x => R.push(laRetenueDAvance(L, b, x)));
    if (b.correction && !b.correction.reponse) R.push('correction proposée');
    if (!R.length && avant && Math.abs(Number(c.net) - Number((avant.calcul || {}).net)) < 0.0005) R.push(`comme ${KC.moisPaie(moisAvant)}`);
    if (!avant) R.push('nouveau ce mois');
    return R;
  }
  function paieLeMois(dossier, L, annee, m, bulletins, P, o) {
    const s = livresState;
    const moisAvant = m === 1 ? 12 : m - 1;
    const avants = m === 1 ? [] : KC.bulletinsDuMois(L, annee, moisAvant);
    const avantDe = b => avants.find(x => x.salarieId === b.salarieId);
    const masse = KC.masseSalariale(bulletins), masseAvant = KC.masseSalariale(avants);
    const ecart = (a, b0) => (avants.length ? `${a - b0 >= 0 ? '+' : '−'} ${money(Math.abs(KC.round3(a - b0)))} sur ${KC.moisPaie(moisAvant)}` : '');
    // La frise : cinq étapes, la date de chacune, celle où l'on est.
    const E = [
      ['Pointage', P.pointe ? `${P.pointe === P.actifs ? 'les' : `${P.pointe} sur`} ${pl(P.actifs, 'salarié')} pointé${P.actifs > 1 ? 's' : ''}${P.mode !== 'cabinet' ? ` · par ${P.client}` : ''}` : P.mode === 'cabinet' ? 'à saisir au cabinet, ou des mois complets' : `pas reçu de ${P.client} : des mois complets`, true],
      ['Bulletins', !P.n ? `${P.manquants || P.actifs} à faire` : P.mode === 'seule' ? `faits par ${P.client}${P.enAttente.length ? ` · ${pl(P.enAttente.length, 'correction proposée', 'corrections proposées')}` : P.verifies ? ' · vérifiés' : ''}`
        : P.valides ? `${P.n} validés le ${jourCourt(P.valideLe)}` : P.approuves && P.accordRequis ? `approuvés par ${P.client} le ${jourCourt(P.approuveLe)}`
          : P.envoyes && P.accordRequis ? `envoyés à ${P.client} le ${jourCourt(P.envoyeLe)}` : `${P.n} préparés${P.manquants ? `, ${P.manquants} à faire` : ''}`, P.n > 0 && !P.manquants && (P.valides || P.mode === 'seule' || P.mode === 'sans')],
      ['Écriture de paie', o.auBrouillard ? `au brouillard${o.paieAttendSonJour ? ` · se valide le ${jourCourt(o.paieAttendSonJour)}` : ''}` : bulletins.some(b => o.etatDe(b) === 'ecrite') ? 'validée' : `datée du dernier jour du mois`, bulletins.length > 0 && bulletins.every(b => o.etatDe(b) === 'ecrite')],
      // (1.247.0) Un virement revenu : le salaire n'est pas payé, quoi que dise le bulletin.
      ((rev) => ['Salaires payés', rev ? `${rev > 1 ? `${rev} virements revenus` : '1 virement revenu'}` : P.payes && P.payes === P.n ? 'payés' : P.payes ? `${P.payes} sur ${P.n}` : `par ${P.client}`, P.n > 0 && P.payes === P.n && !rev])(KC.virementsRevenus(L.releves || [], bulletins, o.nomDe).length),
      ['Déclarés', `IRPP et CSS avec ${KC.moisPaie(m)} · CNSS au trimestre`, false]];
    const ici = Math.max(0, E.findIndex(e => !e[2]));
    const frise = `<ol class="cp-pa-frise" id="pa-frise">${E.map(([t, d, fait], i) => `<li class="${fait ? 'fait' : i === ici ? 'ici' : ''}"${i === 0 ? ' data-pa-vue="pointage" role="button" tabindex="0"' : ''}><span class="n">${fait ? '✓' : i + 1}</span><span><b>${esc(t)}</b><small>${esc(d)}</small></span></li>`).join('')}</ol>`;
    const g = P.geste;
    const bouton = !g ? '' : g.attente ? `<button type="button" class="btn" id="pa-attente" disabled>${esc(g.attente)}</button>`
      : `<button type="button" class="btn btn-primary" id="${esc(g.id)}">${esc(g.t)}</button>`;
    const tuile = (t, v, sous, id) => `<div class="cp-pa-tuile" ${id ? `id="${id}"` : ''}><span class="t">${esc(t)}</span><b>${esc(money(v))}</b><small>${esc(sous)}</small></div>`;
    const tuiles = bulletins.length ? `<div class="cp-pa-tuiles">${tuile('Brut', masse.brut, `${pl(masse.count, 'bulletin')}${avants.length ? ` · ${KC.moisPaie(moisAvant)} : ${avants.length}` : ''}`)}${tuile('Net à payer', masse.net, ecart(masse.net, masseAvant.net) || 'ce que touchent les salariés')}${tuile('Charges patronales', masse.chargesPatronales, 'CNSS, accident, TFP, FOPROLOS')}${tuile(`Coût pour ${dossier.name || 'le dossier'}`, masse.cout, [ecart(masse.cout, masseAvant.cout).split(' sur ')[0], raisonsDuMois(L, bulletins, avants)].filter(Boolean).join(' : ') || 'brut et charges', 'pa-tuile-cout')}</div>` : '';
    // Les bandeaux du parcours : l'accord, la correction proposée, la vérification, la lecture seule.
    const corrRep = P.reponses.filter(b => b.correction.reponse);
    const bandeaux = [
      P.mode === 'sans' ? `<div class="cp-pa-bandeau gris" id="pa-sans">${esc(P.client)} fait sa paie seul dans SkanFact : le Cabinet la lit et la passe en comptabilité. Pour la vérifier ou la tenir, ${esc(P.client)} le choisit dans « Qui fait ma paie ».</div>` : '',
      P.mode === 'seule' && !P.enAttente.length ? `<div class="cp-pa-bandeau" id="pa-seule">Le cabinet ne change un bulletin fait par ${esc(P.client)} qu'avec son accord : il prépare la correction (avant, après), ${esc(P.client)} l'accepte d'un geste dans SkanFact, et la trace reste. Refusée, elle reste une remarque.</div>` : '',
      P.enAttente.map(b => paieCorrectionCarte(L, b, P)).join(''),
      corrRep.map(b => `<div class="cp-pa-bandeau ${b.correction.reponse === 'acceptee' ? 'vert' : 'gris'}" data-pa-rep="${esc(b.id)}">La correction du bulletin de <b>${esc(o.nomDe(b.salarieId))}</b> a été ${b.correction.reponse === 'acceptee' ? 'acceptée' : 'refusée'} par ${esc(P.client)}${b.correction.reponduLe ? ` le ${esc(jourCourt(b.correction.reponduLe))}` : ''}${b.correction.raison ? ` : « ${esc(b.correction.raison)} »` : ''}.</div>`).join(''),
      P.accordRequis && P.envoyes && !P.approuves && !P.valides ? `<div class="cp-pa-bandeau" id="pa-attend-accord">Les bulletins sont chez ${esc(P.client)} depuis le ${esc(jourCourt(P.envoyeLe))} : son bon à payer arrive dans SkanFact. Changer un bulletin d'ici le lui redemande.</div>` : '',
      P.accordRequis && P.approuves && !P.valides ? `<div class="cp-pa-bandeau vert" id="pa-accord">${esc(P.client)} a approuvé ${P.n > 1 ? `les ${P.n} bulletins` : 'le bulletin'} le ${esc(jourCourt(P.approuveLe))} (son bon à payer, dans SkanFact). Validés, ils ne changent plus.</div>` : '',
      P.valides ? `<div class="cp-pa-bandeau vert" id="pa-valides">Les bulletins ${esc(KC.deMois(KC.moisPaie(m)))} sont validés : ils ne bougent plus. Une correction passera par une régularisation sur un mois suivant.</div>` : '',
      paieDepuisLaValidation(dossier, L, m, bulletins, o), paieVirementsRevenus(dossier, L, bulletins, P, o)].join('');
    // Les bulletins, rangés par ce qui change (la maquette), le bulletin choisi ouvert à côté.
    const etiquette = b => b.valideLe ? '<span class="badge b-paid">validé</span>' : b.correction && !b.correction.reponse ? '<span class="badge b-due">correction proposée</span>'
      : b.bonAPayerLe ? '<span class="badge b-paid">approuvé</span>' : b.pourAccordLe ? '<span class="badge b-part">chez le client</span>'
        : b.verifieLe ? '<span class="badge b-paid">vérifié</span>' : P.mode === 'seule' ? '<span class="badge">à vérifier</span>' : '<span class="badge">préparé</span>';
    const lig = b => {
      const c = b.calcul || {}, av = avantDe(b), R = paieCeQuiChange(L, b, av, moisAvant);
      const d = av ? KC.round3(Number(c.net) - Number((av.calcul || {}).net)) : null;
      return `<tr data-bul="${esc(b.id)}" class="clickable${s.paieBul === b.id ? ' sel' : ''}" tabindex="0"><td class="cp-pa-qui"><b>${esc(o.nomDe(b.salarieId))}</b>${(() => { const x = (L.salaries || []).find(y => y.id === b.salarieId) || {}; return x.poste ? `<span class="cp-pa-poste">${esc(x.poste)}</span>` : ''; })()}<small>${esc(R.join(' · '))}</small></td>
        <td class="r nw">${esc(money(c.gross))}</td><td class="r nw"><b>${esc(money(c.net))}</b></td>
        <td class="r nw small">${d === null ? 'nouveau' : Math.abs(d) < 0.0005 ? '=' : `${d > 0 ? '+' : '−'} ${esc(money(Math.abs(d)))}`}</td>
        <td class="nw">${etiquette(b)}</td>${RowMenu.cellule('PAIE:' + b.id)}</tr>`;
    };
    const change = bulletins.filter(b => { const av = avantDe(b); return !av || paieCeQuiChange(L, b, av, moisAvant).some(t => !t.startsWith('comme ')); });
    const pareil = bulletins.filter(b => !change.includes(b));
    const groupe = (t, L2) => L2.length ? `<tr class="cp-pa-groupe"><td colspan="6"><b>${esc(t)}</b> · ${L2.length}</td></tr>${L2.map(lig).join('')}` : '';
    const sel = bulletins.find(b => b.id === s.paieBul);
    const table = bulletins.length ? `<div class="cp-pa-grille${sel ? ' avec-volet' : ''}"><div class="panel cp-pa-liste" id="pa-bulletins"><div class="scroll-x"><table class="list compact pa-bulletins"><thead><tr><th>Salarié</th><th class="r">Brut</th><th class="r">Net à payer</th><th class="r nw">Sur ${esc(KC.moisPaie(moisAvant))}</th><th>Où il en est</th><th class="row-actions-h"></th></tr></thead>
        <tbody>${groupe('Ce qui change ce mois', change)}${groupe(`Comme ${KC.moisPaie(moisAvant)}`, pareil)}</tbody>
        <tfoot><tr><th>${esc(pl(masse.count, 'bulletin'))}${avants.length ? ` <small class="muted">· ${esc(KC.moisPaie(moisAvant))} : ${avants.length}</small>` : ''}</th><th class="r nw">${esc(money(masse.brut))}</th><th class="r nw">${esc(money(masse.net))}</th><th class="r nw small">${avants.length ? esc(ecart(masse.net, masseAvant.net).split(' sur ')[0]) : ''}</th><th colspan="2"></th></tr></tfoot></table></div>
        <div class="cp-pa-touches small muted">↑ ↓ un salarié · Entrée son bulletin · Espace vérifié · P le bulletin en PDF${P.geste && P.geste.id ? `<span id="pa-touche-geste"> · Ctrl Entrée ${esc(P.geste.t.replace(/…$/, '').replace(/^./, c => c.toLowerCase()))}</span>` : ''}</div></div>
        ${sel ? paieVoletBulletin(dossier, L, sel, avantDe(sel), P, o.nomDe) : ''}</div>`
      : `<div class="panel empty" id="pa-vide">${P.actifs && !P.pointe && (P.mode === 'tenue' || P.mode === 'cabinet') ? `<p><b>Le pointage ${esc(KC.deMois(KC.moisPaie(m)))} n'est pas encore là.</b> Sans lui, chaque bulletin part d'un mois complet ; une absence ou des heures sup se règlent à la main.</p>
        <div class="ctrl-geste" id="pa-pt-attendu">${P.mode === 'tenue' && api.messagerie && !dossier.manual ? `<button type="button" class="btn btn-sm" id="pa-demander-pt">Le demander à ${esc(P.client)}</button>` : ''}<button type="button" class="btn btn-sm" id="pa-saisir-pt">Le saisir moi-même</button><button type="button" class="btn btn-sm" id="pa-sans-pt">Préparer sans pointage : des mois complets</button></div>
        ${P.entrees.length ? `<p class="small" id="pa-entrees">${P.entrees.map(x => `<b>${esc(x.nom)}</b>, entrée le ${esc(fmtJour(x.embauche))}`).join(', ')} : ${P.entrees.length > 1 ? 'leur premier bulletin sera' : 'son premier bulletin sera'} au prorata.</p>` : ''}` : ''}${!P.actifs ? 'Aucun salarié déclaré : c\'est par là qu\'une paie commence.' : P.mode === 'seule' || P.mode === 'sans' ? `Les bulletins ${esc(KC.deMois(KC.moisPaie(m)))} ne sont pas encore faits : ${esc(P.client)} les fait dans SkanFact, ils arrivent ici.` : `Aucun bulletin ${esc(KC.deMois(KC.moisPaie(m)))} : « Établir les bulletins » les prépare un à un, avec la fiche et le pointage de chacun.`}</div>`;
    const controles = paieControles(dossier, L, annee, m, bulletins, avants, masse, P, o);
    // Le jour d'après lequel l'écriture se valide se dit toujours (une information avant le geste) ; le bouton « La valider »
    // attend que les bulletins le soient (1.235.0).
    const brouillard = o.auBrouillard && (o.paieAttendSonJour || P.valides !== false) ? (o.paieAttendSonJour
      ? `<div class="small mb ctrl-geste" id="pa-brouillard"><span>L'écriture de paie ${esc(KC.deMois(KC.moisPaie(m)))} est <b>au brouillard</b>, datée du ${esc(fmtJour(o.paieAttendSonJour))} : elle se valide à partir de ce jour-là.</span></div>`
      : `<div class="small mb ctrl-geste" id="pa-brouillard"><span>L'écriture de paie ${esc(KC.deMois(KC.moisPaie(m)))} est <b>au brouillard</b> : elle n'entre dans les livres — et dans la déclaration du mois — qu'une fois validée.</span><button type="button" class="btn btn-sm" id="pa-valider">La valider dans la saisie</button></div>`) : '';
    // « + Un bulletin… » reste à portée tant que le cabinet tient la paie et qu'elle n'est pas validée ; il prend le nom du
    // geste (#pa-bulletin) quand le bouton principal ne l'a pas déjà.
    const secondaires = `<span class="cp-pa-sec">${(P.mode === 'cabinet' || P.mode === 'tenue') && P.actifs && !P.valides && !(g && g.id === 'pa-bulletin') ? '<button type="button" class="btn btn-sm" id="pa-bulletin">+ Un bulletin…</button>' : ''}${bulletins.length ? '<button type="button" class="btn btn-sm" id="pa-journal">Journal de paie</button>' : ''}</span>`;
    return `<section class="panel cp-pa-mois" id="pa-mois-carte">${frise}<div class="cp-pa-geste">${secondaires}${bouton}</div></section>
      ${bandeaux}${paieAnomalies(L, P, o)}${paieFaits(dossier, L, annee, m, bulletins, P, o)}${tuiles}${controles}${brouillard}${table}${paieEcriture(L, m, bulletins, P)}${paieMoisDAvant(L, annee, m, avants)}`;
  }
  const aujourdhuiPaie = () => new Date().toISOString().slice(0, 10);
  const dansJours = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  // (plateforme) 1.236.0 — L'année, mois par mois (la maquette, paieannee) : le coût de chaque mois, et deux chemins, un
  // chiffre : les douze mois additionnés font l'année calculée d'un coup.
  function paieMoisParMois(L, annee, an) {
    if (!an.count) return '';
    const M = KC.MOIS_PAIE.map((lab, i) => ({ lab, x: KC.masseSalariale(KC.bulletinsDuMois(L, annee, i + 1)) }));
    const tot = k => KC.round3(M.reduce((a, y) => a + Number(y.x[k] || 0), 0));
    const max = Math.max(...M.map(y => Number(y.x.cout) || 0), 1);
    const juste = ['brut', 'net', 'cout'].every(k => Math.abs(tot(k) - Number(an[k] || 0)) < 0.0005);
    return `<div class="panel mt" id="pa-annee-mois"><h2>Le coût de la paie, mois par mois</h2>
      <div class="scroll-x"><table class="list compact"><thead><tr><th>Mois</th><th class="r">Bulletins</th><th class="r">Brut</th><th class="r">Net</th><th class="r">Coût employeur</th><th class="cp-pa-barre-h"></th></tr></thead><tbody>
      ${M.map(y => `<tr${y.x.count ? '' : ' class="muted"'}><td>${esc(y.lab)}</td><td class="r">${y.x.count || '—'}</td><td class="r nw">${y.x.count ? esc(money(y.x.brut)) : ''}</td><td class="r nw">${y.x.count ? esc(money(y.x.net)) : ''}</td><td class="r nw">${y.x.count ? esc(money(y.x.cout)) : ''}</td><td class="cp-pa-barre"><i style="width:${Math.round((Number(y.x.cout) || 0) / max * 100)}%"></i></td></tr>`).join('')}
      <tr class="dc-total"><td><b>L'année</b></td><td class="r"><b>${an.count}</b></td><td class="r nw"><b>${esc(money(tot('brut')))}</b></td><td class="r nw"><b>${esc(money(tot('net')))}</b></td><td class="r nw"><b>${esc(money(tot('cout')))}</b></td><td></td></tr></tbody></table></div>
      <p class="small ${juste ? 'ok-text' : 'warn-text'}" id="pa-annee-juste">${juste ? '✓ Les douze mois additionnés font l\'année, au millime.' : 'Les douze mois additionnés ne font pas l\'année : un bulletin est hors des mois de l\'exercice.'}</p></div>`;
  }
  // (plateforme) 1.236.0 — « Les bulletins sont faits » (la maquette, paieapres ; docs/revue-paie-cabinet.md, C4) : ce qui
  // reste après la validation, dans l'ordre : les remettre aux salariés, les salaires payés par le client (lui rappeler),
  // les déclarer. Pour une paie faite par le client et vérifiée, il ne reste que la déclaration.
  // (plateforme) 1.238.0 — la déclaration CNSS face au livre (la maquette, paiecnss) : ce que les écritures VALIDÉES du
  // trimestre font naître au compte CNSS (crédits moins contre-passations, hors règlements), contre le total à verser
  // des bulletins (deux chemins, un chiffre) ; puis ce qui a été versé après le trimestre (un règlement : une pièce
  // qui touche la trésorerie). Le compte est celui du plan du dossier (son rôle), sinon l'usage (À VÉRIFIER).
  function paieCnssDuLivre(L, annee, t, cnss) {
    const compte = String((((L.plan || []).find(c => c.role === 'cnss')) || {}).compte || KC.COMPTES_PAIE.cnss);
    const tresorerie = e => (e.lignes || []).some(l => /^5/.test(String(l.compte || '')));
    const du = `${annee}-${String(t * 3 - 2).padStart(2, '0')}-01`, au = finDuMoisPaie(annee, t * 3);
    const ne = KC.mouvementCompte(L, compte, du, au, tresorerie);
    const livre = KC.round3(ne.credit - ne.debit);
    const ecart = KC.round3(livre - cnss.total);
    const brouillard = (L.ecritures || []).some(e => e.statut === 'brouillard' && e.date >= du && e.date <= au && (e.lignes || []).some(l => String(l.compte || '').startsWith(compte)));
    // Versé : un règlement passé le trimestre suivant (la CNSS se paie dans le mois qui suit le trimestre).
    const verse = KC.mouvementCompte(L, compte, '', finDuMoisPaie(annee, t * 3 + 3), e => !tresorerie(e) || e.date <= au);
    const egaux = Math.abs(ecart) < 0.0005;
    return `<div class="ctrl-geste mt ${egaux ? 'ok' : 'ko'}" id="pa-cnss-livre"><span class="small">Le compte ${esc(compte)} du livre (écritures validées du trimestre) : <b>${esc(money(livre))}</b> · la déclaration : <b>${esc(money(cnss.total))}</b> · ${egaux
      ? '<span class="ok-text">égaux au millime</span>'
      : `<span class="warn-text">écart de ${esc(money(Math.abs(ecart)))}${brouillard ? ' : des écritures de paie du trimestre sont encore au brouillard' : ' : une écriture CNSS passée hors de la paie, ou un bulletin sans son écriture'}</span>`}${verse.debit > 0.0005
      ? ` · versé le trimestre suivant : <b>${esc(money(verse.debit))}</b>${verse.debit >= cnss.total - 0.0005 ? ' <span class="ok-text">(le trimestre est payé)</span>' : ''}`
      : ' · rien de versé le trimestre suivant dans le livre'}</span></div>`;
  }
  // (plateforme) 1.238.0 — un mois validé, et ce qui est arrivé depuis (la maquette, paieapresval) : un pointage changé
  // après la validation. Un mois validé ne se rouvre pas en silence : le bulletin ne bouge pas, la différence se
  // régularise sur le mois suivant ; l'écran le dit, avec ce qui a changé, et mène au pointage.
  function paieDepuisLaValidation(dossier, L, m, bulletins, o) {
    const valides = bulletins.filter(b => b.valideLe);
    if (!valides.length) return '';
    const data = donneesDuPointage(dossier, L);
    const depuis = valides.map(b => ({ b, r: KC.pointageSurBulletin(data, bulletinPourLePointage(b)) })).filter(x => x.r && x.r.change);
    if (!depuis.length) return '';
    const suivant = KC.moisPaie(Number(m) === 12 ? 1 : Number(m) + 1);
    return `<div class="cp-pa-bandeau ambre" id="pa-depuis-val"><b>Depuis la validation, le pointage a changé.</b> ${depuis.map(({ b, r }) => `${esc(o.nomDe(b.salarieId))} : ${esc(ecartDuPointage(r))}`).join(' · ')}. Un mois validé ne se rouvre pas en silence : ${depuis.length > 1 ? 'ces bulletins restent' : 'le bulletin reste'} tel${depuis.length > 1 ? 's' : ''} quel${depuis.length > 1 ? 's' : ''}, la différence se régularise sur ${esc(suivant)} (une prime ou une retenue « régularisation ${esc(KC.moisPaie(m))} »).
      <button type="button" class="btn btn-sm" data-pa-vue="pointage">Voir le pointage</button></div>`;
  }
  // (plateforme) 1.247.0 — le virement d'un salaire revenu sur le compte (KC.virementsRevenus) : le relevé le dit, le
  // bulletin reste « payé » dans SkanFact tant que le client ne l'a pas repayé ; le cabinet le lui dit d'un geste.
  // Le relevé lu est celui de l'année du livre ouvert (un salaire de décembre revenu en janvier se voit l'année suivante).
  function paieVirementsRevenus(dossier, L, bulletins, P, o) {
    const R = KC.virementsRevenus(L.releves || [], bulletins, o.nomDe);
    if (!R.length) return '';
    const relie = !dossier.manual && !!api.messagerie;
    return `<div class="cp-pa-bandeau rouge" id="pa-revenus"><b>${R.length > 1 ? `${R.length} virements de salaire sont revenus sur le compte.` : 'Un virement de salaire est revenu sur le compte.'}</b>
      ${R.map(x => `<span class="cp-pa-revenu" data-pa-revenu="${esc(x.bulletin)}">${esc(o.nomDe(x.salarieId))} : ${esc(money(x.net))}, payé le ${esc(jourCourt(x.payeLe))}, revenu le ${esc(jourCourt(x.date))} (« ${esc(x.libelle)} »)${relie ? ` <button type="button" class="btn btn-sm" data-pa-revenu-dire="${esc(x.bulletin)}">Le dire à ${esc(P.client)}</button>` : ''}</span>`).join('')}
      <small class="muted">Le salarié n'a pas reçu son salaire : souvent un RIB faux ou un compte fermé. Il reste à le payer de nouveau ; SkanFact ne change rien au bulletin.</small></div>`;
  }
  // (plateforme) 1.238.0 — « Me le rappeler le 01/12 » (la maquette, paiesalaries) : MON rappel sur le dossier (celui de la
  // conversation, que le client ne lit pas) et une note pour l'équipe ; quinze jours avant la fin du contrat, ou demain.
  const peutMeRappeler = dossier => !dossier.manual && !!(api.messagerie && api.messagerie.meRappeler);
  const rappelAvantSortie = sortie => {
    const x = new Date(`${String(sortie).slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 15);
    const j = x.toISOString().slice(0, 10);
    return j > aujourdhuiPaie() ? j : dansJours(1);
  };
  // (plateforme) 1.238.0 — l'en-tête du pointage (la maquette, paiepointage) : qui l'a fait, combien de salariés diffèrent
  // d'un mois complet (une absence non payée, des heures sup), et l'étape suivante d'ici : établir les bulletins.
  function paiePointageResume(dossier, L, annee, m, P) {
    const { lignes } = lignesDuPointage(dossier, L, annee, m);
    if (!lignes.length) return '';
    const diff = lignes.filter(({ p }) => Number(p.absences) > 0 || Object.values(p.hs || {}).some(h => Number(h) > 0));
    const pointes = lignes.filter(({ p }) => (p.jours || []).some(j => j.source === 'pointe')).length;
    const qui = P.mode === 'cabinet' ? 'saisi au cabinet' : pointes ? `par ${P.client}${P.mode === 'tenue' ? ' ou le cabinet' : ''}` : `pas encore reçu de ${P.client}`;
    const preparer = P.geste && P.geste.id === 'pa-bulletin' ? `<button type="button" class="btn btn-primary btn-sm" id="pa-pt-preparer">${esc(P.geste.t)}</button>` : '';
    return `<div class="ctrl-geste mt" id="pt-resume"><span class="small"><b>${esc(pl(pointes, 'salarié pointé', 'salariés pointés'))}</b> sur ${esc(String(lignes.length))} · ${esc(qui)} · ${diff.length ? `<b>${esc(pl(diff.length, 'différence', 'différences'))}</b> avec un mois complet : ${esc(diff.map(({ e, p }) => `${e.name} (${[Number(p.absences) > 0 ? `${joursFr(p.absences)} j non payé${Number(p.absences) > 1 ? 's' : ''}` : '', Object.values(p.hs || {}).some(h => Number(h) > 0) ? 'heures sup' : ''].filter(Boolean).join(', ')})`).join(' · '))}` : 'aucune différence avec un mois complet'}</span>${preparer}</div>`;
  }
  // Le dernier jour d'un mois de paie (AAAA-MM-JJ, en UTC : un jour, jamais un instant) : le jour où les salaires sont dus.
  const finDuMoisPaie = (annee, m) => new Date(Date.UTC(Number(annee), Number(m), 0)).toISOString().slice(0, 10);
  function paieFaits(dossier, L, annee, m, bulletins, P, o) {
    const pret = P.n > 0 && (P.valides || (P.mode === 'seule' && P.verifies && !P.enAttente.length));
    if (!pret) return '';
    const mo = KC.moisPaie(m), relie = !dossier.manual && !!api.messagerie;
    const etape = (n, fait, titre, dit, geste) => `<li class="${fait ? 'fait' : ''}"><span class="n">${fait ? '✓' : n}</span><span><b>${esc(titre)}</b><small>${esc(dit)}</small></span>${geste || ''}</li>`;
    // (plateforme) 1.245.0 — « Les envoyer » (la maquette, paieapres) : les bulletins validés, en PDF, dans les documents
    // du client (le classeur du dossier, qu'il lit dans « Mon comptable »). Ce qui y est déjà se dit, et se remplace.
    const peutEnvoyer = relie && P.valides && !!(api.classeur && api.classeur.deposerPdf);
    const env = peutEnvoyer ? paiePdfsState.par[`${dossier.id}:${annee}-${String(m).padStart(2, '0')}`] : null;
    const dejaEnv = env && env.n ? `${env.n === P.n ? (P.n > 1 ? `les ${P.n}` : 'le bulletin') : `${env.n} sur ${P.n}`} dans les documents de ${P.client} (le ${fmtJour(env.le)})` : '';
    const envoyer = peutEnvoyer ? `<button type="button" class="btn btn-sm" id="pa-envoyer-pdf">${env && env.n ? 'Les renvoyer' : `Les envoyer à ${esc(P.client)}`}</button>` : '';
    const L1 = P.mode === 'seule' ? '' : etape(1, P.remis, 'Les remettre aux salariés', [P.remis ? 'remis' : 'chaque bulletin s\'imprime depuis le menu de sa ligne', dejaEnv].filter(Boolean).join(' · '), envoyer);
    const revenus = KC.virementsRevenus(L.releves || [], bulletins, o.nomDe).length;
    // (1.270.0 ; Skander, 04/11/2026 : « les entreprises hors SkanFact, il y en aura beaucoup ») Un client qui n'est pas sur
    // SkanFact ne marque rien payé : c'est le cabinet qui le note, quand le client le lui dit (sinon l'étape restait ouverte).
    const horsSk = !!dossier.manual;
    const L2 = etape(P.mode === 'seule' ? 1 : 2, P.payes === P.n && !revenus, 'Les salaires', `${P.payes === P.n ? (horsSk ? 'payés, notés au cabinet' : `payés par ${P.client}`) : `${P.payes} sur ${P.n} payés · ${horsSk ? `à noter quand ${P.client} te le dit` : `par ${P.client}`}`}${revenus ? ` · ${revenus > 1 ? `${revenus} virements revenus` : '1 virement revenu'}` : ''}`,
      P.payes < P.n && relie ? (pourLe => `<button type="button" class="btn btn-sm" id="pa-rappel" data-pour="${esc(pourLe)}">Lui rappeler${pourLe ? `, pour le ${esc(jourCourt(pourLe))}` : ''}</button>`)(finDuMoisPaie(annee, m) > aujourdhuiPaie() ? finDuMoisPaie(annee, m) : '')
        : P.payes < P.n && horsSk && P.valides ? `<button type="button" class="btn btn-sm" id="pa-noter-payes">Noter ${P.n - P.payes > 1 ? `les ${P.n - P.payes} salaires payés` : 'le salaire payé'}</button>` : '');
    const ms = KC.masseSalariale(bulletins);
    const L3 = etape(P.mode === 'seule' ? 2 : 3, false, 'Les déclarer', `avec la déclaration ${KC.deMois(mo)} : retenues sur salaires (IRPP et CSS) ${money(KC.round3(ms.irpp + ms.css))}, TFP ${money(ms.tfp)}, FOPROLOS ${money(ms.foprolos)} · la CNSS au trimestre`, '<button type="button" class="btn btn-sm" id="pa-declarer">Ouvrir les déclarations</button>');
    return `<section class="panel cp-pa-faits" id="pa-faits"><h3>Les bulletins ${esc(KC.deMois(mo))} sont faits</h3><ol>${L1}${L2}${L3}</ol></section>`;
  }
  // L'écriture de paie du mois, compte par compte (la maquette) : celle que le serveur tient au fil des bulletins.
  function paieEcriture(L, m, bulletins, P) {
    const id = (bulletins.find(b => b.ecritureId) || {}).ecritureId;
    const e = id ? ecritureDuLivre(L, id) : null;
    if (!e || !(e.lignes || []).length) return '';
    const num = v => Number(v) || 0;
    const D = KC.round3((e.lignes || []).reduce((a, l) => a + num(l.debit), 0)), C = KC.round3((e.lignes || []).reduce((a, l) => a + num(l.credit), 0));
    const statut = e.statut === 'brouillard' ? 'au brouillard' : e.statut === 'validee' ? 'validée' : String(e.statut || '');
    return `<details class="panel cp-pa-ecr" id="pa-ecriture"${P.valides ? ' open' : ''}><summary><b>L'écriture de paie, compte par compte</b> <small class="muted">${esc(statut)} · datée du ${esc(fmtJour(e.date))} · ${esc(money(D))}</small></summary>
      <div class="scroll-x"><table class="list compact"><thead><tr><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead><tbody>
      ${(() => {
        // Une ligne par salarié et par compte dans le livre ; ici, par compte (la maquette).
        const par = new Map();
        (e.lignes || []).forEach(l => { const k = String(l.compte || ''); const x = par.get(k) || { compte: k, debit: 0, credit: 0, n: 0 }; x.debit = KC.round3(x.debit + num(l.debit)); x.credit = KC.round3(x.credit + num(l.credit)); x.n++; par.set(k, x); });
        const intitule = c => ((L.plan || []).find(y => String(y.compte) === c) || {}).libelle || ((e.lignes || []).find(l => String(l.compte) === c) || {}).libelle || '';
        return [...par.values()].sort((a, b) => (b.debit > 0) - (a.debit > 0) || a.compte.localeCompare(b.compte)).map(x => `<tr data-compte="${esc(x.compte)}"><td class="mono nw">${esc(x.compte)}</td><td>${esc(intitule(x.compte))}${x.n > 1 ? ` <small class="muted">${x.n} lignes</small>` : ''}</td><td class="r nw">${x.debit ? esc(money(x.debit)) : ''}</td><td class="r nw">${x.credit ? esc(money(x.credit)) : ''}</td></tr>`).join('');
      })()}
      <tr class="dc-total"><td colspan="2"><b>Total</b>${Math.abs(D - C) < 0.0005 ? ' <span class="ok-text small">équilibrée</span>' : ' <span class="warn-text small">déséquilibrée</span>'}</td><td class="r nw"><b>${esc(money(D))}</b></td><td class="r nw"><b>${esc(money(C))}</b></td></tr></tbody></table></div>
      <p class="small muted">Une ligne par salarié et par compte dans le livre ; ici, par compte. Le net reste au compte du personnel jusqu'au virement, que la Banque solde. Comptes proposés : <b>À VÉRIFIER</b> avec le cabinet.</p></details>`;
  }
  // (plateforme) 1.237.0 — les écarts sur le mois d'avant, ligne à ligne (la maquette, paieecarts) : chaque rubrique qui
  // bouge, salarié par salarié, avec sa source ; et deux chemins, un chiffre : la somme des écarts fait l'écart du brut.
  function paieEcarts(L, annee, m, bulletins, nomDe) {
    const retour = '<p><button type="button" class="btn-lien" data-pa-vue="mois">← Le mois</button></p>';
    if (m === 1) return `<div class="panel" id="pa-ecarts">${retour}<p class="muted">Janvier ouvre l'exercice : les écarts se lisent à partir de février.</p></div>`;
    const avants = KC.bulletinsDuMois(L, annee, m - 1), mo = KC.moisPaie(m), ma = KC.moisPaie(m - 1);
    const rubriques = b => {
      const c = (b && b.calcul) || {}, R = new Map();
      if (!b) return R;
      R.set('Salaire de base', { v: Number(c.baseGross) || 0, src: b.prorata ? `prorata · ${joursFr(b.prorata.jours)} jours sur ${joursFr(b.prorata.sur)}` : 'fiche' });
      if (Number(c.absenceCut)) R.set('Absence sans solde', { v: -Number(c.absenceCut), src: `pointage · ${joursFr(c.absentDays)} j` });
      (c.bonuses || []).forEach(p => { const k = p.label || 'Prime'; const x = R.get(k) || { v: 0, src: /suppl|h sup/i.test(k) ? 'pointage' : 'fiche' }; x.v = KC.round3(x.v + (Number(p.amount) || 0)); R.set(k, x); });
      return R;
    };
    const ids = [...new Set([...bulletins, ...avants].map(b => b.salarieId))];
    const lignes = [], calmes = [];
    ids.forEach(id => {
      const b = bulletins.find(x => x.salarieId === id), a = avants.find(x => x.salarieId === id);
      const Rb = rubriques(b), Ra = rubriques(a);
      const L2 = [...new Set([...Ra.keys(), ...Rb.keys()])].map(k => ({ k, avant: Ra.has(k) ? Ra.get(k).v : null, apres: Rb.has(k) ? Rb.get(k).v : null, src: (Rb.get(k) || Ra.get(k)).src }))
        .map(x => ({ ...x, d: KC.round3((x.apres || 0) - (x.avant || 0)) })).filter(x => Math.abs(x.d) >= 0.0005);
      if (!a && b) L2.forEach(x => { x.src = `entrée : premier bulletin${b.prorata ? ' au prorata' : ''}`; });
      if (a && !b) L2.forEach(x => { x.src = `pas de bulletin en ${mo}`; });
      if (L2.length) L2.forEach(x => lignes.push({ nom: nomDe(id), ...x })); else calmes.push(nomDe(id));
    });
    const brutA = KC.masseSalariale(avants).brut, brutB = KC.masseSalariale(bulletins).brut;
    const somme = KC.round3(lignes.reduce((s0, x) => s0 + x.d, 0)), ecart = KC.round3(brutB - brutA), juste = Math.abs(somme - ecart) < 0.0005;
    const sg = v => `${v >= 0 ? '+' : '−'} ${money(Math.abs(v))}`;
    return `<div class="panel" id="pa-ecarts">${retour}<h2>Les écarts ${esc(KC.deMois(mo))} sur ${esc(ma)}</h2>
      <p class="small muted">brut : ${esc(money(brutA))} en ${esc(ma)}, ${esc(money(brutB))} en ${esc(mo)} · chaque écart a sa ligne et sa source${calmes.length ? ` · ${esc(calmes.join(', '))} : rien ne change` : ''}</p>
      ${lignes.length ? `<div class="scroll-x"><table class="list compact"><thead><tr><th>Salarié</th><th>Rubrique</th><th class="r">${esc(ma)}</th><th class="r">${esc(mo)}</th><th class="r">Écart</th><th>D'où ça vient</th></tr></thead><tbody>
      ${lignes.map(x => `<tr><td>${esc(x.nom)}</td><td>${esc(x.k)}</td><td class="r nw">${x.avant == null ? '—' : esc(money(x.avant))}</td><td class="r nw">${x.apres == null ? '—' : esc(money(x.apres))}</td><td class="r nw"><b>${esc(sg(x.d))}</b></td><td class="small muted">${esc(x.src)}</td></tr>`).join('')}
      <tr class="dc-total"><td colspan="4"><b>L'écart du brut, expliqué en entier</b></td><td class="r nw"><b>${esc(sg(somme))}</b></td><td></td></tr></tbody></table></div>` : `<p class="muted">Aucune rubrique ne change d'un mois à l'autre.</p>`}
      <p class="small ${juste ? 'ok-text' : 'warn-text'}" id="pa-ecarts-juste">${juste ? `✓ Brut ${esc(mo)} − brut ${esc(ma)} = ${esc(money(brutB))} − ${esc(money(brutA))} = ${esc(sg(ecart))}, égal au millime.` : `Les lignes font ${esc(sg(somme))}, le brut a bougé de ${esc(sg(ecart))} : une rubrique n'est pas lue.`}</p>
      <p class="small muted">Les cotisations et l'impôt suivent le brut : un écart du net qui ne vient d'aucune ligne ci-dessus serait une erreur de taux ou de barème.</p></div>`;
  }
  // (plateforme) 1.237.0 — le paramétrage de la paie du dossier (la maquette, paieparam) : ce qui est réglé, ce qui ne l'est
  // pas encore. Ce que SkanFact ne sait pas encore régler se dit « non réglé », jamais avec une valeur inventée.
  function paieParametrage(dossier, L, P) {
    const bar = reglagesPaie(dossier, L), b = KC.baremesPaie(bar), duClient = !!L.reglagesPaie;
    const v = n => String(n).replace('.', ',');
    const r = (k) => bar[k] != null && bar[k] !== '';
    const L2 = [
      ['Régime horaire', r('heuresMois') ? `${v(bar.heuresMois)} h par mois` : 'non réglé (208 h par défaut, À VÉRIFIER)', r('heuresMois')],
      ['Heures sup', r('hsMaj1') ? `+ ${v(bar.hsMaj1)} %${r('hsMaj2') ? `, + ${v(bar.hsMaj2)} %` : ''}${r('hsMaj3') ? `, + ${v(bar.hsMaj3)} %` : ''}` : 'non réglé', r('hsMaj1')],
      ['Congés', r('leaveDaysPerYear') ? `${v(bar.leaveDaysPerYear)} jours ouvrables par an` : `non réglé (${v(b.leaveDaysPerYear)} par défaut, À VÉRIFIER)`, r('leaveDaysPerYear')],
      ['Accident du travail', r('accidentRate') ? `${v(bar.accidentRate)} % (taux de ce dossier)` : `non réglé (${v(b.accidentRate)} % par défaut)`, r('accidentRate')],
      ['TFP · FOPROLOS', r('tfpRate') || r('foprolosRate') ? `${v(b.tfpRate)} % · ${v(b.foprolosRate)} %` : `non réglés (${v(b.tfpRate)} % · ${v(b.foprolosRate)} % par défaut)`, r('tfpRate') || r('foprolosRate')],
      ['Comptes de la paie', Object.values(KC.COMPTES_PAIE).join(' · '), true],
      ['Convention collective', 'non réglée : SkanFact ne la règle pas encore', false, true],
      ['Travail de nuit', 'non réglé', false], ['Férié travaillé', 'non réglé', false], ['Maintien du salaire en maladie', 'non réglé', false],
      ['Prime d\'ancienneté', 'non réglée', false, true], ['Prime de fin d\'année', 'non réglée', false], ['Minimum de la grille', 'non saisi', false, true]];
    const regles = L2.filter(x => x[2]).length;
    return `<div class="panel" id="pa-param"><p><button type="button" class="btn-lien" data-pa-vue="mois">← Le mois</button></p><h2>Le paramétrage de la paie du dossier</h2>
      <p class="small muted" id="pa-param-qui">${duClient ? `réglé par ${esc(P.client)} dans son SkanFact : le cabinet le lit` : (rg => rg ? `réglé au cabinet par ${esc(prenomCl(rg.par) || rg.par || 'le cabinet')} le ${esc(fmtJour(jourTunisCl(rg.le)))}${rg.copieDe ? `, copié de ${esc(rg.copieDe)}` : ''}` : 'réglé au cabinet, pour ce dossier')((dossier.paie || {}).regle)} · ${regles} réglés · ${L2.length - regles} à régler</p>
      <div class="cp-pa-bandeau ambre" id="pa-param-conv"><b>La convention collective n'est pas réglée.</b> Si elle prévoit une prime d'ancienneté ou un minimum par catégorie, les bulletins sont faux d'autant : c'est la première chose à vérifier (<b>À VÉRIFIER</b> : son nom et son texte).</div>
      <div class="scroll-x"><table class="list compact"><tbody>${L2.map(([k, val, ok, abord]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(val)}</td><td class="nw">${ok ? '<span class="badge b-paid">réglé</span>' : abord ? '<span class="badge b-due">à vérifier d\'abord</span>' : '<span class="badge">non réglé</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="ctrl-geste">${duClient ? '<span class="small muted">Ces taux se changent dans son SkanFact (Paie › Barèmes).</span>' : `<button type="button" class="btn btn-sm" id="pa-regimes">Régler les taux…</button>${dossiersACopier(dossier).length ? '<button type="button" class="btn btn-sm" id="pa-copier-param">Copier le paramétrage d\'un autre dossier…</button>' : ''}`}</div></div>`;
  }
  // (plateforme) 1.246.0 — « Copier le paramétrage d'un autre dossier » (la maquette, paieparam) : les dossiers du portefeuille
  // dont le cabinet a réglé la paie. Le taux d'accident du travail dépend de l'activité : il ne se copie que si on le coche.
  const TAUX_COPIABLES = ['tfpRate', 'foprolosRate', 'heuresMois', 'hsMaj1', 'hsMaj2', 'hsMaj3', 'leaveDaysPerYear'];
  const paieRegleeAuCabinet = x => !!(x && x.paie && (Object.keys(x.paie.regimesContrat || {}).length || [...TAUX_COPIABLES, 'accidentRate'].some(k => x.paie[k] != null && x.paie[k] !== '')));
  // Seuls les dossiers tenus au cabinet ont une paie réglée ici (un client relié règle la sienne dans son SkanFact).
  const dossiersACopier = dossier => ((S && S.dossiers) || []).filter(x => x.id !== dossier.id && x.manual && !x.archived && paieRegleeAuCabinet(x));
  function copierParametrageForm(dossier) {
    const L = dossiersACopier(dossier);
    const v = n => String(n).replace('.', ',');
    const resume = x => {
      const p = x.paie || {}, bits = [];
      if (p.heuresMois) bits.push(`${v(p.heuresMois)} h`);
      if (p.hsMaj1) bits.push(`heures sup + ${[p.hsMaj1, p.hsMaj2, p.hsMaj3].filter(Boolean).map(v).join(' / ')} %`);
      if (p.leaveDaysPerYear) bits.push(`${v(p.leaveDaysPerYear)} j de congés`);
      if (p.tfpRate) bits.push(`TFP ${v(p.tfpRate)} %`);
      if (p.foprolosRate) bits.push(`FOPROLOS ${v(p.foprolosRate)} %`);
      if (p.accidentRate) bits.push(`accident ${v(p.accidentRate)} %`);
      const n = Object.keys(p.regimesContrat || {}).length; if (n) bits.push(pl(n, 'contrat aux taux propres', 'contrats aux taux propres'));
      return bits.join(' · ') || 'réglé';
    };
    modal(`<h2>Copier le paramétrage d'un autre dossier</h2>
      <p class="small">Le régime horaire, les heures sup, les congés, la TFP et le FOPROLOS, et les taux par contrat de ce dossier-là
      remplacent ceux de <b>${esc(dossier.name)}</b>. Les bulletins déjà établis gardent les leurs. <b>À VÉRIFIER</b> : la convention
      collective de ce client.</p>
      <div class="cp-pa-copier" id="pa-copier-liste">${L.map((x, i) => `<label class="radio-ligne"><input type="radio" name="src" value="${esc(x.id)}" ${i ? '' : 'checked'}> <span><b>${esc(x.name)}</b><small class="muted"> · ${esc(resume(x))}</small></span></label>`).join('')}</div>
      <label class="cp-pa-copier-at mt"><input type="checkbox" id="pa-copier-at"><span>Copier aussi le taux d'accident du travail<small class="muted">Il dépend de l'activité : d'habitude, celui de l'avis de la CNSS de ce client.</small></span></label>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Copier</button></div>`, (layer, close) => {
      $('#ok', layer).onclick = async () => {
        const src = L.find(x => x.id === ($('input[name="src"]:checked', layer) || {}).value);
        if (!src) return;
        const p = src.paie || {}, mien = dossier.paie || {}, taux = {};
        for (const k of TAUX_COPIABLES) if (p[k] != null && p[k] !== '') taux[k] = Number(p[k]);
        const at = $('#pa-copier-at', layer).checked ? p.accidentRate : mien.accidentRate;
        if (at != null && at !== '') taux.accidentRate = Number(at);
        const rc = {};
        for (const [c, r] of Object.entries(p.regimesContrat || {})) rc[c] = Object.fromEntries(Object.entries(r).map(([t, x]) => [t, t === 'sansIrpp' ? true : Number(x)]));
        try {
          S = await api.savePaie(dossier.id, rc, taux, { copieDe: src.id });
          close(); toast(`Paramétrage de la paie copié de ${src.name}.`); render();
        } catch (e) { toast(plainError(e), 'error'); }
      };
    });
  }
  // (plateforme) 1.237.0 — les absences déjà connues des semaines qui viennent (la maquette, paieabsences) : leur effet sur
  // le bulletin, et qui décide. Une demande pas acceptée ne compte nulle part : la décision est au client.
  function paieAbsencesAVenir(dossier, L, P) {
    const auj = aujourdhuiPaie(), fin = dansJours(60);
    const V = (L.conges || []).filter(l => (l.to || l.from || '') >= auj && (l.from || '') <= fin).sort((a, b) => String(a.from).localeCompare(String(b.from)));
    if (!V.length) return '';
    const nom = id => ((L.salaries || []).find(x => x.id === id) || {}).nom || '—';
    const data = donneesDuPointage(dossier, L);
    return `<div class="panel" id="pa-absences"><h2>Les absences à venir, déjà connues</h2><p class="small muted">${P.mode === 'cabinet' ? 'saisies au cabinet' : `posées par ${esc(P.client)} dans SkanFact`} · elles arriveront avec le pointage de leur mois</p>
      <div class="scroll-x"><table class="list compact"><thead><tr><th>Salarié</th><th>Absence</th><th>Effet sur le bulletin</th><th>À faire</th></tr></thead><tbody>
      ${V.map(l => { const lv = KC.leavesOf({ ...data, leaves: [l] }, '', '')[0] || {}; const demande = !KC.congeRetenu(l);
        return `<tr><td>${esc(nom(l.employeeId))}</td><td>${esc(lv.kindLabel || l.kind || '')}, du ${esc(fmtJour(l.from))} au ${esc(fmtJour(l.to))} · ${esc(joursFr(lv.days || 0))} j</td>
        <td class="small">${demande ? `si ${esc(P.client)} l'accepte : ${lv.paid ? 'payée' : 'retirée du salaire'}` : lv.paid ? 'payée : le salaire ne baisse pas' : 'retirée du salaire, au prorata'}${l.kind === 'maladie' ? ' · la CNAM indemnise selon ses règles (À VÉRIFIER)' : ''}</td>
        <td class="small">${demande ? `<span class="warn-text">la décision est à ${esc(P.client)}</span>` : l.statut === 'refuse' ? 'refusée' : '<span class="ok-text">acceptée</span>'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  // (plateforme) 1.237.0 — L'année (la maquette, paieannee) : les bulletins et le livre disent le même chiffre (le brut des
  // bulletins dont l'écriture est validée, contre le 640 du livre) ; puis ce que la fin de l'année demande.
  function paieLivreEtFinDAnnee(dossier, L, annee, an) {
    if (!an.count) return '';
    const B = (L.bulletins || []).filter(b => Number(b.annee) === Number(annee));
    const statut = b => (b.ecritureId ? (ecritureDuLivre(L, b.ecritureId) || {}).statut : '');
    const valides = B.filter(b => statut(b) === 'validee'), attente = B.filter(b => statut(b) !== 'validee');
    const brutV = KC.masseSalariale(valides).brut, brutA = KC.masseSalariale(attente).brut;
    const exo = L.exercice || {}, m = KC.mouvementCompte(L, KC.COMPTES_PAIE.salairesBruts, exo.du || `${annee}-01-01`, exo.au || `${annee}-12-31`);
    const livre = KC.round3((m.debit || 0) - (m.credit || 0)), egaux = Math.abs(livre - brutV) < 0.0005;
    const data = donneesDuPointage(dossier, L);
    const enPoste = (L.salaries || []).filter(x => x.actif);
    const reste = enPoste.map(x => ({ x, r: (KC.leaveBalance(data, x.id, Number(annee)) || {}).remaining || 0 })).filter(y => y.r > 0);
    const totalReste = KC.round3(reste.reduce((a, y) => a + y.r, 0));
    const vus = new Set(B.map(b => b.salarieId));
    return `<div class="panel mt" id="pa-livre"><h2>Les bulletins et le livre disent le même chiffre</h2>
      <div class="ctrl-geste ${egaux ? 'ok' : 'ko'}" id="pa-livre-640"><span>Bulletins dont l'écriture est validée : brut <b>${esc(money(brutV))}</b> · compte ${esc(KC.COMPTES_PAIE.salairesBruts)} du livre (validé) : <b>${esc(money(livre))}</b> · ${egaux ? '<span class="ok-text">égaux au millime</span>' : `<span class="warn-text">écart de ${esc(money(Math.abs(KC.round3(livre - brutV))))} : une écriture de salaires passée hors de la paie, ou une paie corrigée à la main</span>`}</span></div>
      ${attente.length ? `<p class="small muted">${esc(pl(attente.length, 'bulletin'))} (${esc(money(brutA))} de brut) au brouillard : ils entreront au ${esc(KC.COMPTES_PAIE.salairesBruts)} à leur validation.</p>` : ''}</div>
      <div class="panel mt" id="pa-fin-annee"><h2>La fin de l'année</h2><p class="small muted">ce que décembre et janvier demandent</p><ul class="cp-pa-liste-fin">
      <li><b>Prime de fin d'année</b> · si la convention collective en prévoit une (<b>À VÉRIFIER</b>) · décembre</li>
      <li><b>Attestations de salaires ${esc(annee)}</b> · une par salarié, pour sa déclaration d'impôt · ${esc(pl(vus.size, 'salarié'))} · janvier</li>
      <li><b>La déclaration annuelle d'employeur</b> · nominative, une fois décembre clos (<b>À VÉRIFIER</b> : la date) · <button type="button" class="btn-lien" id="pa-vers-annuelle">La préparer (Liasse)</button></li>
      <li><b>Bulletins faits pour ce dossier en ${esc(annee)}</b> · ${esc(String(B.length))} · la lettre de mission les facture au bulletin (<b>À VÉRIFIER</b> : le tarif)</li>
      <li><b>Les congés pas pris, à la clôture</b> · une dette envers les salariés au 31/12 (<b>À VÉRIFIER</b> : la pratique du cabinet pour la provision) · ${reste.length ? `${esc(reste.map(y => `${y.x.nom.split(' ')[0]} ${joursFr(y.r)} j`).join(', '))} · ${esc(joursFr(totalReste))} jours` : 'aucun reste'}</li></ul></div>`;
  }
  // (plateforme) 1.237.0 — pourquoi la paie du mois bouge (la maquette : « une entrée, 8 h sup, 2 jours sans solde »).
  function raisonsDuMois(L, bulletins, avants) {
    const entrees = bulletins.filter(b => !avants.some(a => a.salarieId === b.salarieId)).length;
    const sorties = avants.filter(a => !bulletins.some(b => b.salarieId === a.salarieId)).length;
    const hs = bulletins.filter(b => (b.primes || []).some(p => p.hs || /suppl|h sup/i.test(p.label || ''))).length;
    const absents = KC.round3(bulletins.reduce((a, b) => a + (Number(b.joursAbsence) || 0), 0));
    const R = [];
    if (entrees) R.push(entrees > 1 ? `${entrees} entrées` : 'une entrée');
    if (sorties) R.push(sorties > 1 ? `${sorties} sorties` : 'une sortie');
    if (hs) R.push(`des heures sup pour ${pl(hs, 'salarié')}`);
    if (absents) R.push(`${joursFr(absents)} jour${absents > 1 ? 's' : ''} sans solde`);
    return R.join(', ');
  }
  // (plateforme) 1.237.0 — les contrôles avant l'envoi (la maquette en montre douze) : ceux qui demandent un geste en tête,
  // les justes ensuite. Une règle sans réglage daté (le SMIG, le plafond des heures sup, le férié) se dit À VÉRIFIER,
  // jamais avec un chiffre inventé.
  function paieControles(dossier, L, annee, m, bulletins, avants, masse, P, o) {
    if (!bulletins.length && !o.aFaire.length) return '';
    const C = [];
    const ko = (titre, dit, gestes) => C.push({ ok: false, titre, dit, gestes: gestes || '' });
    const ok = (titre, dit) => C.push({ ok: true, titre, dit });
    const nom = id => o.nomDe(id);
    const relie = !dossier.manual && !!api.messagerie;
    o.aFaire.filter(c => c.id !== 'cnss-manquant').forEach(c => ko(c.quoi, c.detail));
    if (P.sansCnss.length) ko(`${pl(P.sansCnss.length, 'salarié')} sans n° CNSS`, `${P.sansCnss.map(x => x.nom).join(', ')} : le bulletin se fait ; la déclaration du trimestre l'attendra.`,
      P.sansCnss.map(x => `${relie && P.mode !== 'cabinet' ? `<button type="button" class="btn btn-sm" data-pa-demander-cnss="${esc(x.id)}">Le demander à ${esc(P.client)}</button>` : ''}<button type="button" class="btn btn-sm" data-sal-cnss="${esc(x.id)}">Le renseigner…</button>`).join(''));
    if (!bulletins.length) return paieControlesHtml(C, P);
    const neg = bulletins.filter(b => !(Number((b.calcul || {}).net) > 0));
    if (neg.length) ko('Un net négatif ou nul', neg.map(b => nom(b.salarieId)).join(', ')); else ok('Aucun net négatif ni nul', '');
    // Les écarts de plus de 5 % sur le mois d'avant : expliqués par une raison sur la ligne, ou à regarder.
    const gros = bulletins.map(b => ({ b, a: avants.find(x => x.salarieId === b.salarieId) })).filter(({ b, a }) => a && Number((a.calcul || {}).gross) > 0
      && Math.abs(Number((b.calcul || {}).gross) - Number(a.calcul.gross)) / Number(a.calcul.gross) > 0.05);
    const nonExpl = gros.filter(({ b, a }) => !paieCeQuiChange(L, b, a, m === 1 ? 12 : m - 1).some(r => !/^comme |^nouveau/.test(r)));
    if (nonExpl.length) ko('Un écart de plus de 5 % sans raison', `${nonExpl.map(({ b }) => nom(b.salarieId)).join(', ')} : ni heures sup, ni absence, ni prorata ne l'expliquent.`, '<button type="button" class="btn btn-sm" data-pa-vue="ecarts">Les écarts ligne à ligne</button>');
    else ok(gros.length ? 'Écarts de plus de 5 % expliqués' : 'Aucun écart de plus de 5 %', gros.map(({ b, a }) => `${nom(b.salarieId)} ${Number(b.calcul.gross) > Number(a.calcul.gross) ? '+' : '−'} ${String(Math.round(Math.abs(Number(b.calcul.gross) / Number(a.calcul.gross) - 1) * 1000) / 10).replace('.', ',')} %`).join(' · '));
    if (P.mode !== 'cabinet') {
      if (P.pointe === P.actifs) ok('Pointage repris sur chaque bulletin', ''); else ko('Un mois sans pointage', `${pl(P.actifs - P.pointe, 'salarié')} sans grille : son bulletin part d'un mois complet.`);
    }
    if (P.oublis.length) ko('Une avance pas retenue', P.oublis.map(({ b, d }) => `${nom(b.salarieId)} : ${money(d.amount)}`).join(' · '), '<button type="button" class="btn btn-sm" data-pa-vue="conges">Voir les avances</button>');
    else { const ret = bulletins.filter(b => (b.retenues || []).some(r => r.advanceId)); if (ret.length) ok('Avances retenues', ret.map(b => nom(b.salarieId)).join(', ')); }
    const pro = bulletins.filter(b => b.prorata);
    if (pro.length) ok('Entrées et sorties au prorata', pro.map(b => `${nom(b.salarieId)}, ${joursFr(b.prorata.jours)} jours sur ${joursFr(b.prorata.sur)}`).join(' · '));
    const hs = bulletins.filter(b => (b.primes || []).some(p => p.hs || /suppl|h sup/i.test(p.label || '')));
    if (hs.length) ok('Heures sup payées', `${hs.map(b => nom(b.salarieId)).join(', ')} · le plafond : À VÉRIFIER`);
    const r = ((bulletins[0] || {}).calcul || {}).rates || {};
    const v = n => String(n).replace('.', ',');
    if (r.cnssEmployee != null) ok('Taux du dossier', `CNSS ${v(r.cnssEmployee)} % et ${v(r.cnssEmployer)} %, accident ${v(r.accidentRate)} %, TFP ${v(r.tfpRate)} %, FOPROLOS ${v(r.foprolosRate)} % (À VÉRIFIER)`);
    const bas = bulletins.map(b => ({ b, base: Number((b.calcul || {}).baseGross) || 0 })).sort((a, b) => a.base - b.base)[0];
    if (bas) ok('Le SMIG', `le plus bas : ${nom(bas.b.salarieId)}, ${money(bas.base)} de base · le SMIG n'est pas réglé dans SkanFact : À VÉRIFIER`);
    // Deux chemins, un chiffre : l'écriture de paie, lue du livre, contre les bulletins.
    const id = (bulletins.find(b => b.ecritureId) || {}).ecritureId, e = id ? ecritureDuLivre(L, id) : null;
    if (e) {
      const D = KC.round3((e.lignes || []).reduce((a, l) => a + (Number(l.debit) || 0), 0));
      if (Math.abs(D - Number(masse.cout)) < 0.0005) ok('Bulletins = écriture de paie', `au millime : ${money(D)}`);
      else ko('Les bulletins et l\'écriture ne disent pas le même chiffre', `bulletins ${money(masse.cout)} · écriture ${money(D)}`);
    }
    return paieControlesHtml(C, P);
  }
  function paieControlesHtml(C, P) {
    if (!C.length) return '';
    const kos = C.filter(c => !c.ok), oks = C.filter(c => c.ok);
    return `<div class="panel" id="pa-controles"><div class="cp-pa-titre-l"><h3>Les contrôles ${P.accordRequis && !P.envoyes ? `avant l'envoi à ${esc(P.client)}` : 'du mois'}</h3><span class="small muted">${pl(C.length, 'contrôle')} · ${pl(oks.length, 'juste', 'justes')}${kos.length ? ` · ${kos.length} à savoir` : ''}</span>
      <span class="cp-pa-liens"><button type="button" class="btn-lien" data-pa-vue="ecarts">Les écarts ligne à ligne</button><button type="button" class="btn-lien" data-pa-vue="param">Le paramétrage du dossier</button></span></div>
      ${kos.map(c => `<div class="ctrl-geste ko" data-ctl="ko"><span><b>${esc(c.titre)}</b>${c.dit ? ` — ${esc(c.dit)}` : ''}</span>${c.gestes}</div>`).join('')}
      ${oks.map(c => `<div class="ctrl-geste ok small" data-ctl="ok"><span>✓ <b>${esc(c.titre)}</b>${c.dit ? ` · ${esc(c.dit)}` : ''}</span></div>`).join('')}
      ${kos.length ? '<div class="small muted">Un signalement, pas un blocage : les bulletins se font quand même.</div>' : ''}</div>`;
  }
  // (plateforme) 1.237.0 — une paie faite par le client : l'anomalie trouvée d'elle-même (la maquette, paieverif), avec la
  // correction déjà préparée.
  function paieAnomalies(L, P, o) {
    if (P.mode !== 'seule' || !P.oublis.length) return '';
    return P.oublis.filter(({ b }) => !(b.correction && !b.correction.reponse)).map(({ b, d }) => `<div class="cp-pa-bandeau ambre" data-pa-oubli="${esc(b.id)}"><b>${esc(o.nomDe(b.salarieId))} : l'avance n'est pas retenue.</b> ${esc(d.label)} : ${esc(money(d.amount))} ce mois ; son net serait de ${esc(money(KC.round3(Number(b.calcul.net) - d.amount)))}, pas ${esc(money(b.calcul.net))}.
      <span class="cp-pa-g"><button type="button" class="btn btn-sm" data-pa-vue="conges">Voir l'avance</button></span></div>`).join('');
  }
  // (plateforme) 1.237.0 — le mois d'avant, en une ligne (la maquette) : ses bulletins, son écriture, ses salaires.
  function paieMoisDAvant(L, annee, m, avants) {
    if (m === 1 || !avants.length) return '';
    const mo = KC.moisPaie(m - 1);
    const e = avants.find(b => b.ecritureId) ? ecritureDuLivre(L, avants.find(b => b.ecritureId).ecritureId) : null;
    const payes = avants.filter(b => b.payeLe).length;
    return `<p class="small muted cp-pa-avant" id="pa-mois-avant">${esc(mo.charAt(0).toUpperCase() + mo.slice(1))} : ${esc(pl(avants.length, 'bulletin'))}${e ? ` · l'écriture ${e.statut === 'validee' ? 'validée' : 'au brouillard'}` : ''} · ${payes === avants.length ? 'salaires payés' : `${payes} sur ${avants.length} payés`}. <button type="button" class="btn-lien" id="pa-ouvrir-avant">Ouvrir ${esc(mo)}</button></p>`;
  }
  // La correction proposée au client, et ce qu'on en fait : la relancer, la retirer (la maquette).
  function paieCorrectionCarte(L, b, P) {
    const c = b.correction, nom = ((L.salaries || []).find(x => x.id === b.salarieId) || {}).nom || '';
    return `<div class="panel cp-pa-corr" data-pa-corr="${esc(b.id)}"><h3>La correction proposée à ${esc(P.client)} <small class="muted">envoyée le ${esc(jourCourt(c.le))}${c.relanceLe ? ` · relancée le ${esc(jourCourt(c.relanceLe))}` : ''} · ${esc(P.client)} l'accepte ou la refuse dans SkanFact</small></h3>
      <p><b>${esc(nom)}</b> : ${esc(c.titre || '')}${c.motif ? ` — ${esc(c.motif)}` : ''}</p>
      <div class="scroll-x"><table class="list compact"><thead><tr><th>Bulletin de ${esc(nom)}</th><th class="r">Fait par ${esc(P.client)}</th><th class="r">Corrigé</th></tr></thead><tbody>
      ${(c.lignes || []).map(l => `<tr><td>${esc(l.libelle)}</td><td class="r nw">${esc(money(l.avant))}</td><td class="r nw">${esc(money(l.apres))}</td></tr>`).join('')}
      <tr class="dc-total"><td><b>Net à payer</b></td><td class="r nw">${esc(money((b.calcul || {}).net))}</td><td class="r nw"><b>${esc(money(c.net))}</b></td></tr></tbody></table></div>
      <div class="ctrl-geste"><button type="button" class="btn btn-sm" data-pa-relancer="${esc(b.id)}">La relancer</button><button type="button" class="btn btn-sm" data-pa-retirer="${esc(b.id)}">Retirer la proposition</button></div></div>`;
  }
  // Le bulletin ouvert dans un volet (la maquette) : ce qu'il gagne et d'où vient chaque ligne, ce qui est retenu, le net,
  // ce que paie l'employeur, et « Pourquoi cet IRPP ? », lu du calcul gardé avec le bulletin.
  function paieVoletBulletin(dossier, L, b, avant, P, nomDe) {
    const c = b.calcul || {}, x = (L.salaries || []).find(y => y.id === b.salarieId) || {};
    const rib = String(x.rib || '').replace(/\s/g, '');
    const paiement = rib ? `par virement · ··· ${rib.slice(-4)}` : 'RIB à demander';
    const r = c.rates || {};
    // (plateforme) 1.238.0 — le calcul d'une heure sup (la maquette) : heures × le salaire d'une heure × la majoration,
    // le salaire d'une heure étant le brut de la fiche sur les heures du mois des réglages. Sans ces chiffres, « pointage ».
    const heuresMois = Number(KC.baremesPaie(reglagesPaie(dossier, L)).heuresMois) || 0;
    const calculHs = p => (Number(p.heures) > 0 && Number(p.hs) > 0 && heuresMois > 0 && Number(x.brut) > 0
      ? `pointage · ${joursFr(p.heures)} h × ${money(KC.round3(Number(x.brut) / heuresMois))} × ${joursFr(100 + Number(p.hs))} %` : 'pointage');
    const ligne = (t, src, v, cl) => `<tr${cl ? ` class="${cl}"` : ''}><td>${esc(t)}${src ? ` <small class="cp-pa-src">${esc(src)}</small>` : ''}</td><td class="r nw">${esc(v)}</td></tr>`;
    const gains = [ligne('Salaire de base', b.prorata ? `${b.prorata.motif || 'prorata'} · ${joursFr(b.prorata.jours)} j sur ${joursFr(b.prorata.sur)}` : 'fiche', money(c.baseGross)),
      Number(c.absenceCut) ? ligne(`Absence sans solde : ${joursFr(c.absentDays)} j`, 'pointage', `− ${money(c.absenceCut)}`) : '',
      ...(c.bonuses || []).map(p => ligne(p.label, /suppl|h sup/i.test(p.label || '') ? calculHs(p) : 'fiche', money(p.amount))),
      ligne('Brut', '', money(c.gross), 'dc-total')].join('');
    const ret = [ligne('CNSS, part du salarié', `${String(r.cnssEmployee).replace('.', ',')} % du brut cotisable`, `− ${money(c.cnssEmployee)}`),
      ligne('IRPP', `barème annuel${x.chefFamille || (c.situation || {}).headOfFamily ? ' · chef de famille' : ''}${(c.situation || {}).children ? ` · ${c.situation.children} enfant${c.situation.children > 1 ? 's' : ''}` : ''}`, `− ${money(c.irpp)}`),
      ligne('Contribution sociale de solidarité', `${String(r.solidarity).replace('.', ',')} % de l'imposable`, `− ${money(c.css)}`),
      ...(c.deductions || []).map(d => ligne(d.label, 'retenue', `− ${money(d.amount)}`)),
      ligne('Net à payer', [avant ? `${Number(c.net) - Number((avant.calcul || {}).net) >= 0 ? '+' : '−'} ${money(Math.abs(KC.round3(Number(c.net) - Number((avant.calcul || {}).net))))} sur le mois d'avant` : '', paiement].filter(Boolean).join(' · '), money(c.net), 'dc-total')].join('');
    const empl = [ligne('CNSS, part de l\'employeur', `${String(r.cnssEmployer).replace('.', ',')} % · accident du travail ${String(r.accidentRate).replace('.', ',')} %`, money(KC.round3(Number(c.cnssEmployer) + Number(c.accident)))),
      ligne('TFP et FOPROLOS', `${String(r.tfpRate).replace('.', ',')} % et ${String(r.foprolosRate).replace('.', ',')} % · déclarés chaque mois`, money(KC.round3(Number(c.tfp) + Number(c.foprolos)))),
      ligne('Coût du salarié', '', money(c.employerCost), 'dc-total')].join('');
    const pourquoi = Number(c.irpp) > 0 ? `<p class="small cp-pa-irpp" id="pa-irpp"><b>Pourquoi ${esc(money(c.irpp))} d'IRPP ?</b> Le mois après CNSS (${esc(money(c.afterCnss))}) fait ${esc(money(KC.round3(Number(c.afterCnss) * 12)))} sur l'année ; moins les frais professionnels (${esc(money(c.pro))}) et la situation de famille (${esc(money(c.family))}) : ${esc(money(c.annualTaxable))} imposables. Le barème annuel donne ${esc(money(c.irppYear))}, soit ${esc(money(c.irpp))} par mois.</p>`
      : '<p class="small muted cp-pa-irpp" id="pa-irpp">Pas d\'IRPP ce mois : l\'imposable de l\'année reste dans la tranche à 0 % du barème.</p>';
    // 1.237.0 — les gestes du bulletin, ceux de la maquette : son PDF, le modifier (paie tenue, pas validé) ou proposer sa
    // correction (paie du client), le marquer vérifié.
    const enCorr = !!(b.correction && !b.correction.reponse);
    const peutModifier = (P.mode === 'cabinet' || P.mode === 'tenue') && !b.valideLe && !(L.exercice || {}).clos;
    const gestes = `<div class="ctrl-geste cp-pa-volet-g"><button type="button" class="btn btn-sm" data-pa-pdf="${esc(b.id)}">Le bulletin (PDF)</button>${peutModifier ? `<button type="button" class="btn btn-sm" data-pa-modifier="${esc(b.id)}">Modifier…</button>` : ''}${P.mode === 'seule' && !b.valideLe && !enCorr ? `<button type="button" class="btn btn-sm" data-pa-proposer="${esc(b.id)}">Proposer une correction…</button>` : ''}${!b.verifieLe && !b.valideLe && !enCorr && P.mode !== 'sans' ? `<button type="button" class="btn btn-sm" data-pa-verifie="${esc(b.id)}">Vérifié</button>` : ''}</div>`;
    const etat = b.valideLe ? 'validé' : enCorr ? 'correction proposée' : b.bonAPayerLe ? 'approuvé' : b.verifieLe ? 'vérifié' : P.mode === 'seule' ? `fait par ${P.client}` : 'à vérifier';
    const sit = c.situation || {};
    const situation = [x.poste, KC.contractLabel(x.contrat || 'cdi').split(' —')[0] + (x.sortie ? ` · fin le ${fmtJour(x.sortie)}` : ''),
      (sit.headOfFamily || x.chefDeFamille) ? 'chef de famille' : 'célibataire', Number(sit.children || x.enfants) ? `${sit.children || x.enfants} enfant${Number(sit.children || x.enfants) > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');

    // (plateforme) 1.238.0 — « Contrôlé : … » (la maquette) : ce que les contrôles du mois disent de CE bulletin.
    const data = donneesDuPointage(dossier, L);
    const pt = KC.pointageSurBulletin(data, bulletinPourLePointage(b));
    const dues = KC.echeancesDuMois(data, b.salarieId, Number(b.annee), Number(b.mois));
    const retenues = new Set((b.retenues || []).map(d => d.advanceId).filter(Boolean));
    const controle = [Number(c.net) > 0 ? ['ok', 'net positif'] : ['ko', 'net négatif ou nul'],
      pt ? (pt.change ? ['ko', 'ne suit plus le pointage'] : ['ok', 'pointage repris']) : null,
      dues.length ? (dues.every(d => retenues.has(d.advanceId)) ? ['ok', 'avance retenue'] : ['ko', 'avance pas retenue']) : null,
      b.prorata ? ['ok', `prorata ${joursFr(b.prorata.jours)} j sur ${joursFr(b.prorata.sur)}`] : null].filter(Boolean);
    const controleHtml = `<p class="small" id="pa-volet-ctl"><b>Contrôlé :</b> ${controle.map(([k, t]) => `<span class="${k === 'ok' ? 'ok-text' : 'warn-text'}">${k === 'ok' ? '✓' : '!'} ${esc(t)}</span>`).join(' · ')}</p>`;
    return `<aside class="panel cp-pa-volet" id="pa-volet" data-pa-sel="${esc(b.id)}"><div class="cp-pa-volet-t"><b>${esc(nomDe(b.salarieId))} · ${esc(KC.moisPaie(b.mois))} ${esc(b.annee)}</b><button type="button" class="btn-x" id="pa-volet-x" aria-label="Fermer">×</button></div>
      <p class="small muted">${esc(situation)} <span class="badge" id="pa-volet-etat">${esc(etat)}</span></p>
      <h4>Ce qu'il gagne</h4><table class="list compact">${gains}</table>
      <h4>Ce qui est retenu</h4><table class="list compact">${ret}</table>
      <h4>Ce que paie l'employeur</h4><table class="list compact">${empl}</table>${pourquoi}${controleHtml}${gestes}</aside>`;
  }

  // Le fichier CNSS du trimestre : ce qui l'empêche de sortir, nommé case par case avec le geste qui
  // le lève, puis le bouton. Un avertissement (identité reprise du nom, CIN vide) ne bloque pas :
  // il se lit, en gris, avant le dépôt.
  function panneauFichierCnss(dossier, f, enCours) {
    if (!f) return '';
    const geste = r => {
      if (r.champ === 'employeur' || r.champ === 'code') return `<button type="button" class="btn btn-sm" data-pa-emp="${esc(r.champ)}">Renseigner ${r.champ === 'code' ? 'le code d\'exploitation' : 'le matricule CNSS'} de ${esc(dossier.name)}…</button>`;
      const champ = { cnss: 'cnss', cin: 'cin', identite: 'identiteCnss' }[r.champ];
      return champ && r.salarieId ? `<button type="button" class="btn btn-sm" data-pa-sal="${esc(r.salarieId)}" data-pa-champ="${esc(champ)}">Ouvrir la fiche de ${esc(r.nom)}…</button>` : '';
    };
    const ligne = r => `<div class="ctrl-geste"><span>${r.nom ? `<b>${esc(r.nom)}</b> — ` : ''}${esc(r.motif)}</span>${geste(r)}</div>`;
    return `<div class="mt" id="pa-fichier-bloc">
      ${f.refus.length ? `<div class="warn-box mb"><div><b>Le fichier CNSS attend ${esc(pl(f.refus.length, 'correction'))}</b> — il ne sort pas tant qu'une ligne est fausse : le portail le refuserait.</div>${f.refus.map(ligne).join('')}</div>` : ''}
      ${avertissementsCnss(f)}
      ${enCours ? `<p class="small muted mb" id="pa-en-cours">${esc(enCours)}</p>` : ''}
      <div class="ctrl-geste"><button type="button" class="btn btn-sm" id="pa-fichier" ${f.ok && !enCours ? '' : 'disabled'}
        title="${esc(enCours || (f.ok ? '' : 'Corrige d\'abord ce qui est signalé au-dessus.'))}">Fabriquer le fichier CNSS…</button>
        <span class="small muted">Au format ${esc(f.format)} de la télédéclaration des salaires. <b>À VÉRIFIER</b> : contrôle-le sur le portail avant de valider le dépôt — SkanFact Cabinet ne dépose rien.</span>${info('pa.fichier')}</div>
    </div>`;
  }

  // Les avertissements, UNE ligne par salarié : deux phrases et deux boutons pour la même fiche
  // (identité reprise du nom, CIN absent) se lisaient comme deux problèmes (vu au test humain).
  // La règle de la CNSS se dit une fois, sous la liste.
  function avertissementsCnss(f) {
    if (!f.avertissements.length) return '';
    const court = { identite: 'identité reprise du nom de la fiche', cin: 'CIN absent (la case part vide)' };
    const par = [];
    f.avertissements.forEach(a => {
      let g = par.find(x => x.salarieId === a.salarieId);
      if (!g) par.push(g = { salarieId: a.salarieId, nom: a.nom, champs: [] });
      g.champs.push(a.champ);
    });
    const champDe = g => (g.champs.includes('identite') ? 'identiteCnss' : 'cin');
    return `<div class="small mb pa-avert">${par.map(g => `<div class="ctrl-geste"><span><b>${esc(g.nom)}</b> — ${esc(g.champs.map(c => court[c] || c).join(' · '))}</span>
        <button type="button" class="btn btn-sm" data-pa-sal="${esc(g.salarieId)}" data-pa-champ="${champDe(g)}">Compléter sa fiche…</button></div>`).join('')}
      <div class="muted">Le fichier sort quand même. <b>À VÉRIFIER</b> : la CNSS demande l'identité « prénom, prénom du père, nom » comme sur la carte d'assuré (le nom de jeune fille pour une femme mariée), et le portail peut refuser un CIN vide.</div></div>`;
  }

  // (plateforme) 1.65.0 — les documents de la paie d'un dossier (le bulletin, le journal du mois, l'état CNSS du trimestre)
  // sont ceux de l'entreprise (core.js), au même millime et dans la même forme. Leur moteur se charge la première fois
  // qu'on en imprime un : le Cabinet n'en a pas besoin pour le reste, et sa page reste légère. La fenêtre s'ouvre tout de
  // suite, dans le geste : un navigateur bloque celle qu'on ouvre après une attente.
  let moteurDesDocuments = null;
  const chargerMoteurDesDocuments = () => moteurDesDocuments || (moteurDesDocuments = new Promise((ok, ko) => {
    if (window.SkanCore) return ok(window.SkanCore);
    const sc = document.createElement('script');
    sc.src = '../core.js';
    sc.onload = () => (window.SkanCore ? ok(window.SkanCore) : ko(new Error('Le moteur des documents ne s\'est pas chargé : recharge la page, puis réessaie.')));
    sc.onerror = () => { moteurDesDocuments = null; ko(new Error('Le moteur des documents ne se charge pas : vérifie ta connexion, puis réessaie.')); };
    document.head.appendChild(sc);
  }));
  // (plateforme) 1.92.0 — le PDF fait par le serveur (pont-cabinet.js, `exportPdf`) : le document se télécharge sous son
  // nom, celui que l'entreprise lui donne (`nommer` le dit, de la paie du dossier). Sans l'outil sur ce serveur, ou sans
  // réseau, le pont rend la fenêtre d'impression. Le nom d'un fichier ne garde que des lettres, des chiffres et des tirets.
  const nomDeFichier = s => String(s || '').replace(/[^\w\-àâäéèêëïîôöùûüç ]/gi, '').trim().replace(/\s+/g, '_');
  async function imprimerDocumentPaie(dossier, fabriquer, nommer) {
    // Sans le PDF du serveur, la fenêtre s'ouvre tout de suite, dans le geste.
    const w = api.exportPdf ? null : window.open('', '_blank');
    if (!api.exportPdf && !w) return toast('Le navigateur a bloqué la fenêtre du document : autorise les fenêtres de SkanFact, puis réessaie.', 'error');
    try {
      const { C, d, societe } = await donneesDocumentsPaie(dossier);
      const html = fabriquer(C, d, societe);
      if (!w) {
        const f = await api.exportPdf(html, `${nommer(d)}.pdf`);
        if (f) toast('PDF enregistré : ' + f);
        return;
      }
      w.document.write(html);
      w.document.close();
      w.print();
    } catch (e) { if (w) w.close(); toast(plainError(e), 'error'); }
  }
  async function donneesDocumentsPaie(dossier) {
    {
      const C = await chargerMoteurDesDocuments();
      const paie = api.paieDuDossierV10(dossier.id);
      // L'employeur : le dossier (son nom, son matricule fiscal, son numéro d'employeur à la CNSS et son code d'exploitation).
      // (plateforme) 1.72.0 — et, de sa fiche, son adresse (en tête du document ; sa dernière ligne fait la ville du « le … »)
      // et son gérant (qui signe les documents du personnel). La paie du dossier porte ses congés et ses avances, et ses
      // réglages sont ceux du dossier : ceux du SkanFact du client, s'il y tient sa paie.
      const societe = { name: dossier.name || '', address: dossier.adresse || '', matricule: dossier.matricule || '', cnss: dossier.cnssEmployeur || '',
        cnssCode: dossier.cnssCode || '', managerName: dossier.gerant || '', currency: 'DT' };
      const d = { employees: paie.employees, payslips: paie.payslips, leaves: paie.leaves || [], advances: paie.advances || [],
        payrollSettings: reglagesPaie(dossier, livresState.livre) };
      return { C, d, societe };
    }
  }
  // (plateforme) 1.245.0 — les bulletins envoyés au client : ce que son classeur a déjà, par dossier et par mois.
  const paiePdfsState = { par: {}, lu: {} };
  const titreBulletinPdf = (nom, annee, m) => `Bulletin de paie · ${nom} · ${moisLong(`${annee}-${String(m).padStart(2, '0')}`)} ${annee}`;
  async function lirePdfsDuMois(dossier, annee, m, bulletins, nomDe) {
    const cle = `${dossier.id}:${annee}-${String(m).padStart(2, '0')}`;
    const titres = new Set(bulletins.map(b => titreBulletinPdf(nomDe(b.salarieId), annee, m)));
    const docs = (((await api.classeur.documents(dossier.id)) || {}).documents || []).filter(x => x.rubrique === 'piece' && !x.remplacePar && titres.has(x.titre));
    const le = docs.map(x => jourTunisCl(x.deposeLe)).sort().pop() || '';
    paiePdfsState.par[cle] = { n: docs.length, le, docs };
    return paiePdfsState.par[cle];
  }

  // (plateforme) 1.69.0 — le pointage du mois d'un dossier : la grille de l'entreprise (1.60.0), que le Cabinet tient pour
  // son client. Une case par salarié et par jour ; les jours payés et les absences se recalculent à chaque geste ; un
  // bulletin déjà établi qui ne suit plus le pointage le dit, et se met à jour d'un geste. Les salariés : ceux en poste ce
  // mois-là (leur entrée, leur sortie), et un salarié sorti s'il a un bulletin du mois.
  const INITIALES_JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const affichePointage = c => c === 'D' ? '½' : c === '-' ? '·' : c;
  const libelleDuJour = j => KC.libellePointage(j.code) + (j.source === 'conge' ? ' (Congés et absences)' : j.source === 'pointe' ? ' (pointé)' : '');
  const joursFr = n => String(KC.round3(Number(n) || 0)).replace('.', ',');
  const ecartDuPointage = r => [r.absences ? `${joursFr(r.avant)} jour${Number(r.avant) > 1 ? 's' : ''} non payé${Number(r.avant) > 1 ? 's' : ''} au bulletin, ${joursFr(r.absentDays)} au pointage` : '',
    r.heures ? 'pas les mêmes heures supplémentaires' : '', !r.absences && !r.heures ? 'ses primes au jour ne suivent plus les jours payés' : ''].filter(Boolean).join(' ; ');
  function lignesDuPointage(dossier, L, annee, m) {
    const data = donneesDuPointage(dossier, L);
    const n = new Date(Date.UTC(Number(annee), Number(m), 0)).getUTCDate();   // le jour 0 du mois qui suit, en UTC (règle 5.2.3)
    const premier = `${annee}-${String(m).padStart(2, '0')}-01`, dernier = `${annee}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const avecBulletin = new Set(KC.bulletinsDuMois(L, annee, m).map(b => b.salarieId));
    const lignes = data.employees.filter(e => {
      const x = (L.salaries || []).find(y => y.id === e.id) || {};
      return (x.actif || avecBulletin.has(e.id)) && (!e.hireDate || e.hireDate <= dernier) && (!e.endDate || e.endDate >= premier);
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'))
      .map(e => ({ e, p: KC.pointageDuMois(data, e, Number(annee), Number(m)) }));
    return { data, lignes };
  }
  function vuePointage(dossier, L, annee, m) {
    const { data, lignes } = lignesDuPointage(dossier, L, annee, m);
    const majorations = KC.majorationsHs(KC.baremesPaie(data.payrollSettings));
    const clos = !!(L.exercice || {}).clos;
    const ecarts = clos ? [] : KC.bulletinsDuMois(L, annee, m).map(b => ({ b, r: KC.pointageSurBulletin(data, bulletinPourLePointage(b)) })).filter(o => o.r && o.r.change);
    const nomDe = id => ((L.salaries || []).find(x => x.id === id) || {}).nom || '—';
    const leMois = `${KC.deMois(KC.moisPaie(m))} ${annee}`;
    const pct = x => String(x).replace('.', ',');
    return `<div class="panel mt pt-cabinet" id="pt-panneau"><h2>Le pointage ${esc(leMois)} ${info('pa.pointage')}</h2>
      <p class="small muted">${clos ? `L'exercice ${esc(annee)} est clos : son pointage se lit, il ne se change plus.`
    : `Clique une case pour changer son code, ou tape sa lettre ; les flèches passent d'une case à l'autre.${L.reglagesPaie ? ' Les congés et absences que le client saisit dans son SkanFact s\'y posent d\'eux-mêmes.' : ''} Un bulletin établi ensuite reprend ses absences non payées et ses heures supplémentaires.`}</p>
      <div class="pt-legende">${KC.CODES_POINTAGE.map(([c, l]) => `<span class="pt-cle"><span class="pt-c pt-${c}" aria-hidden="true">${affichePointage(c)}</span>${esc(l)}</span>`).join('')}<span class="pt-cle"><span class="pt-c pt-hors" aria-hidden="true">·</span>Hors contrat</span></div>
      ${lignes.length ? `<div class="scroll-x"><table class="list compact pt-grille" id="pt-grille"><thead><tr><th>Salarié</th>
        <th class="r" title="Le mois complet, moins les jours hors contrat et les absences non payées : les jours du bulletin">Payés</th><th class="r">Non payés</th>
        ${majorations.map(x => `<th class="r nw">HS +${esc(pct(x))} %</th>`).join('')}
        ${lignes[0].p.jours.map(j => `<th class="pt-j${j.repos ? ' pt-repos' : ''}">${j.jour}<span>${INITIALES_JOURS[j.wd]}</span></th>`).join('')}</tr></thead><tbody>
        ${lignes.map(({ e, p }) => `<tr data-pe="${esc(e.id)}"><td class="nw"><strong>${esc(e.name)}</strong></td>
          <td class="r nw"><strong data-pt-payes>${esc(joursFr(p.payes))}</strong></td><td class="r nw" data-pt-abs>${p.absences ? esc(joursFr(p.absences)) : '<span class="muted">—</span>'}</td>
          ${majorations.map(x => `<td class="r"><input type="number" class="num pt-hs" data-hs="${x}" value="${p.hs[String(x)] || ''}" min="0" step="0.5" placeholder="0" ${clos ? 'disabled' : ''} aria-label="${esc(e.name)} : heures supplémentaires à +${esc(pct(x))} %"></td>`).join('')}
          ${p.jours.map(j => `<td class="pt-td"><button type="button" class="pt-c pt-${j.code === '-' ? 'hors' : j.code}${j.source === 'pointe' ? ' pt-main' : ''}" data-pt="${j.jour}"${j.repos ? ' data-repos="1"' : ''} ${j.code === '-' || clos ? 'disabled' : ''} title="${esc(libelleDuJour(j))}" aria-label="${esc(e.name)}, ${j.jour} ${esc(KC.moisPaie(m))} : ${esc(libelleDuJour(j))}">${affichePointage(j.code)}</button></td>`).join('')}
        </tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">Aucun salarié en poste ${esc(leMois)}.</div>`}
      ${/* Sous la grille : apparue au-dessus, l'alerte poussait les cases sous la souris (vu dans l'entreprise, 1.60.0). */''}
      ${ecarts.length ? `<div class="warn-box mt" id="pt-ecarts">${ecarts.map(({ b, r }) => `<div class="ctrl-geste"><span>Le bulletin de <b>${esc(nomDe(b.salarieId))}</b> ne suit plus le pointage : ${esc(ecartDuPointage(r))}.${b.valideLe ? ` Il est validé depuis le ${esc(fmtJour(String(b.valideLe).slice(0, 10)))} : il ne change plus, la différence se régularise sur le bulletin du mois suivant.` : b.payeLe ? ' Il est déjà payé : son net changera.' : ''}</span>${b.valideLe ? '' : `<button type="button" class="btn btn-sm" data-pt-reprendre="${esc(b.id)}">Reprendre le pointage dans le bulletin</button>`}</div>`).join('')}</div>` : ''}
      ${majorations.length || clos || !lignes.length ? '' : L.reglagesPaie
    ? '<p class="small muted mt" id="pt-sans-hs">Pour pointer des heures supplémentaires, il faut leurs majorations : ce client les règle dans son SkanFact (<b>Paie › Barèmes</b>).</p>'
    : '<div class="small muted mt ctrl-geste" id="pt-sans-hs"><span>Pour pointer des heures supplémentaires, règle d\'abord leurs majorations. <em>À VÉRIFIER : le Code du travail et la convention collective du client.</em></span><button type="button" class="btn btn-sm" id="pt-taux">Régler les heures supplémentaires…</button></div>'}
    </div>`;
  }
  // La case de la grille où est le curseur, pour la lui rendre après un redessin.
  const ouEstLeCurseurDuPointage = el => {
    const a = document.activeElement, tr = a && a.closest && a.closest('#pt-grille tr[data-pe]');
    if (!tr || !el.contains(tr)) return null;
    return a.dataset.hs ? { e: tr.dataset.pe, hs: a.dataset.hs } : a.dataset.pt ? { e: tr.dataset.pe, d: Number(a.dataset.pt) } : null;
  };
  function brancherPointage(el, root, dossier) {
    const s = livresState;
    const L = s.livre, y = Number(s.annee), m = Number(s.paieMois);
    const taux = $('#pt-taux', el);
    if (taux) taux.onclick = () => regimesForm(root, dossier, { focus: 'hsMaj1' });
    if (!$('#pt-grille', el) || (L.exercice || {}).clos) return;
    const { data } = lignesDuPointage(dossier, L, y, m);
    const employe = id => data.employees.find(e => e.id === id);
    // Seul le panneau se redessine (pas toute la page), et le curseur revient à sa case.
    const redessiner = focus => {
      const neuf = document.createElement('div');
      neuf.innerHTML = vuePointage(dossier, L, y, m);
      $('#pt-panneau', el).replaceWith(neuf.firstElementChild);
      // (1.238.0) L'en-tête du pointage suit la grille : qui est pointé, ce qui diffère d'un mois complet.
      const resume = $('#pt-resume', el);
      if (resume) {
        const r = document.createElement('div');
        r.innerHTML = paiePointageResume(dossier, L, y, m, parcoursPaie(dossier, L, y, m, KC.bulletinsDuMois(L, y, m)));
        if (r.firstElementChild) { resume.replaceWith(r.firstElementChild); const pr = $('#pa-pt-preparer', el); if (pr) pr.onclick = () => bulletinForm(root, dossier, null); }
      }
      brancherPointage(el, root, dossier);
      if (focus) {
        const c = $(`#pt-grille tr[data-pe="${focus.e}"] ${focus.hs ? `.pt-hs[data-hs="${focus.hs}"]` : `.pt-c[data-pt="${focus.d}"]`}`, el);
        if (c) { c.focus(); if (focus.hs) c.select(); }
      }
    };
    const enregistrer = id => {
      const t = KC.pointageEnregistre(data, id, y, m);
      if (!t) return;
      const copie = JSON.parse(JSON.stringify(t));
      pointageEnCours = pointageEnCours.then(() => api.savePointage({ dossierId: dossier.id, pointage: copie }))
        .catch(err => toast(`Le pointage n'est pas enregistré : ${plainError(err)} Recharge la page pour revoir celui du serveur.`, 'error'));
    };
    const poser = (b, code) => {
      const e = employe(b.closest('tr').dataset.pe);
      if (!e) return;
      if (!KC.poserPointage(data, e, y, m, Number(b.dataset.pt), code)) {
        if (b.dataset.repos) toast(`Le ${b.dataset.pt} ${KC.moisPaie(m)} est un jour de repos : il se pointe « Repos », ou « Présent » s'il a été travaillé (ses heures vont en heures supplémentaires).`, 'error');
        return;
      }
      enregistrer(e.id);
      redessiner({ e: e.id, d: Number(b.dataset.pt) });
    };
    const ORDRE = KC.CODES_POINTAGE.map(x => x[0]);
    $$('#pt-grille .pt-c[data-pt]', el).forEach(b => {
      // Un jour de repos ne passe que de « Repos » à « Présent » et retour.
      const ordre = b.dataset.repos ? KC.CODES_REPOS : ORDRE;
      b.onclick = () => { const c = ordre[(ordre.indexOf(b.textContent === '½' ? 'D' : b.textContent) + 1) % ordre.length]; poser(b, c); };
      b.onkeydown = ev => {
        const k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
        if (ORDRE.includes(k)) { ev.preventDefault(); poser(b, k); return; }
        const pas = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
        if (!pas) return;
        ev.preventDefault();
        const tr = b.closest('tr');
        const ligne = pas[0] ? (pas[0] < 0 ? tr.previousElementSibling : tr.nextElementSibling) : tr;
        if (!ligne) return;
        const cases = [...ligne.querySelectorAll('.pt-c[data-pt]')];
        let d = Number(b.dataset.pt) + pas[1];
        let cible = cases.find(x => Number(x.dataset.pt) === d);
        // Un jour hors contrat ne se pointe pas : on le saute.
        while (cible && cible.disabled) { d += pas[1] || 1; cible = cases.find(x => Number(x.dataset.pt) === d); }
        if (cible) cible.focus();
      };
    });
    $$('#pt-grille .pt-hs', el).forEach(i => {
      i.onchange = () => {
        const e = employe(i.closest('tr').dataset.pe);
        if (!e) return;
        if (i.value !== '' && !(Number(i.value) >= 0)) return refus(i, 'Un nombre d\'heures se tape en chiffres : 6, ou 7,5.');
        KC.poserHeuresSup(data, e, y, m, Number(i.dataset.hs), i.value);
        enregistrer(e.id);
        // La grille se redessine APRÈS que Tab a posé le curseur, et le lui rend (vu dans l'entreprise, 1.60.0).
        setTimeout(() => redessiner(ouEstLeCurseurDuPointage(el)), 0);
      };
      // Comme dans un tableur : Entrée ou ↓ passe au salarié suivant, dans la même colonne ; ↑ au précédent.
      i.onkeydown = ev => {
        const pas = ev.key === 'ArrowDown' || ev.key === 'Enter' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
        if (!pas) return;
        ev.preventDefault();
        const tr = i.closest('tr'), autre = pas > 0 ? tr.nextElementSibling : tr.previousElementSibling;
        const c = autre && autre.querySelector(`.pt-hs[data-hs="${i.dataset.hs}"]`);
        if (c) { c.focus(); c.select(); } else i.blur();
      };
    });
    $$('[data-pt-reprendre]', el).forEach(bt => { bt.onclick = async () => {
      const b = (L.bulletins || []).find(x => x.id === bt.dataset.ptReprendre);
      if (!b) return;
      const nom = ((L.salaries || []).find(x => x.id === b.salarieId) || {}).nom || '';
      if (b.payeLe && !await confirmDialog(`Le bulletin de ${nom} est déjà payé`, 'Reprendre le pointage change son net. Continuer ?', 'Reprendre le pointage')) return;
      const r = KC.pointageSurBulletin(data, bulletinPourLePointage(b));
      if (!r) return;
      bt.disabled = true;
      try {
        await pointageEnCours;
        const v = { id: b.id, salarieId: b.salarieId, annee: b.annee, mois: b.mois, brut: b.brut, joursTravailles: b.joursTravailles,
          joursAbsence: r.absentDays, primes: r.bonuses, retenues: b.retenues || [], prorata: b.prorata || null };
        const rep = await api.saveBulletin({ dossierId: dossier.id, annee: s.annee, bulletin: v });
        s.livre = rep.livre; toast(`Bulletin de ${nom} mis à jour sur le pointage.`); drawLivres(root, dossier);
      } catch (err) { bt.disabled = false; toast(plainError(err), 'error'); }
    }; });
  }

  // Le bulletin imprimé, celui de l'entreprise (sur une page) ; sans « À faire valider par votre comptable » : c'est le
  // comptable qui l'imprime. Du menu de la ligne, du volet, ou de la touche P.
  function imprimerBulletin(dossier, b) {
    return imprimerDocumentPaie(dossier, (C, d, so) => {
      const bulletinDuDossier = (d.payslips || []).find(p => p.id === b.id);
      if (!bulletinDuDossier) throw new Error('Ce bulletin n\'est plus dans la paie du dossier : recharge la page.');
      return C.payslipHtml(bulletinDuDossier, d, so, { notice: false });
    }, d => {
      const p = (d.payslips || []).find(y => y.id === b.id) || {};
      const sal = (d.employees || []).find(y => y.id === p.employeeId) || {};
      return `Bulletin_${nomDeFichier(sal.name)}_${p.year}-${String(p.month).padStart(2, '0')}`;
    });
  }
  function brancherPaie(el, root, dossier) {
    const s = livresState;
    const redraw = () => drawLivres(root, dossier);
    const mois = $('#pa-mois', el);
    if (mois) mois.onchange = () => { s.paieMois = Number(mois.value) || 1; s.paieBul = null; redraw(); };
    // (plateforme) 1.235.0 — les cinq vues, le bulletin ouvert à côté, et les gestes du parcours (docs/revue-paie-cabinet.md).
    $$('[data-pa-vue]', el).forEach(b => {
      const aller = () => { s.paieVue = b.dataset.paVue; s.paieBul = null; redraw(); };
      b.onclick = aller;
      if (b.tagName === 'LI') b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aller(); } };
    });
    const lignes = $$('#pa-bulletins tr[data-bul]', el);
    // Le focus revient sur la ligne après le dessin (le clavier ne se perd pas en ouvrant ou fermant le volet).
    const ouvrir = id => { s.paieBul = s.paieBul === id ? null : id; s.paieFocus = id; redraw(); };
    if (s.paieFocus) { const tr = $(`#pa-bulletins tr[data-bul="${s.paieFocus}"]`, el); s.paieFocus = null; if (tr) tr.focus({ preventScroll: true }); }
    lignes.forEach((tr, i) => {
      tr.onclick = e => { if (e.target.closest('button, a, .row-actions')) return; ouvrir(tr.dataset.bul); };
      tr.onkeydown = e => {
        if (e.target !== tr) return;
        // (1.240.0, la maquette : « Entrée valider le mois ») Ctrl + Entrée fait l'étape suivante, le bouton principal :
        // Entrée seule ouvre le bulletin, et une touche seule ne valide pas un mois par mégarde.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { const g = $('#pa-mois-carte .cp-pa-geste .btn-primary', el); if (g && !g.disabled) { e.preventDefault(); g.click(); } return; }
        if (e.key === 'Enter') { e.preventDefault(); ouvrir(tr.dataset.bul); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = lignes[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); }
        else if (e.key === ' ' && $(`[data-pa-verifie="${tr.dataset.bul}"]`, el)) { e.preventDefault(); $(`[data-pa-verifie="${tr.dataset.bul}"]`, el).click(); }
        else if (e.key === 'p' || e.key === 'P') { const x = duMois().find(y => y.id === tr.dataset.bul); if (x) { e.preventDefault(); imprimerBulletin(dossier, x); } }
      };
    });
    const vx = $('#pa-volet-x', el);
    if (vx) vx.onclick = () => { s.paieFocus = s.paieBul; s.paieBul = null; redraw(); };
    const duMois = () => KC.bulletinsDuMois(s.livre, s.annee, s.paieMois);
    const P0 = () => parcoursPaie(dossier, s.livre, s.annee, s.paieMois, duMois());
    const aujourdhui = () => new Date().toISOString().slice(0, 10);
    const marquer = async (bouton, ids, champs, dire) => {
      if (bouton) bouton.disabled = true;
      try {
        const r = await api.marquerBulletins({ dossierId: dossier.id, annee: s.annee, ids, champs });
        s.livre = r.livre; toast(dire); redraw();
      } catch (err) { toast(plainError(err), 'error'); if (bouton) bouton.disabled = false; }
    };
    const env = $('#pa-envoyer', el);
    if (env) env.onclick = () => {
      const P = P0(), B = duMois();
      marquer(env, B.map(b => b.id), { pourAccordLe: aujourdhui() }, `${B.length > 1 ? `Les ${B.length} bulletins sont envoyés` : 'Le bulletin est envoyé'} à ${P.client} : son bon à payer arrive dans SkanFact.`);
    };
    const val = $('#pa-valider-bul', el);
    if (val) val.onclick = async () => {
      const P = P0(), B = duMois();
      if (!await confirmDialog(`Valider ${B.length > 1 ? `les ${B.length} bulletins` : 'le bulletin'} ${KC.deMois(KC.moisPaie(s.paieMois))} ?`,
        `Validés, ils ne bougent plus, ni ici ni chez ${P.client} : une correction passera par une régularisation sur un mois suivant. L'écriture de paie du mois, elle, se valide dans la saisie.`, 'Valider')) return;
      // (1.242.0, la maquette « paieapres ») Le toast dit ce qui est fait et offre « Annuler » : la validation du jour
      // s'efface (le pont n'accepte que celle-là, d'un bulletin ni remis ni payé) ; après le toast, ils ne changent plus.
      const jour = aujourdhui(), ids = B.map(b => b.id);
      val.disabled = true;
      try {
        const r = await api.marquerBulletins({ dossierId: dossier.id, annee: s.annee, ids, champs: { valideLe: jour } });
        s.livre = r.livre; redraw();
        toastUndo(`${B.length > 1 ? `${B.length} bulletins validés` : 'Bulletin validé'} : ${B.length > 1 ? 'ils ne changent plus' : 'il ne change plus'}. L'écriture de paie ${KC.deMois(KC.moisPaie(s.paieMois))} reste au brouillard.`, async () => {
          try {
            const r2 = await api.marquerBulletins({ dossierId: dossier.id, annee: s.annee, ids, champs: { valideLe: null }, annulerValidation: true, valideLe: jour });
            s.livre = r2.livre; toast('Validation annulée : les bulletins se modifient de nouveau.'); redraw();
          } catch (err) { toast(plainError(err), 'error'); }
        });
      } catch (err) { toast(plainError(err), 'error'); val.disabled = false; }
    };
    const vt = $('#pa-verifier-tout', el);
    if (vt) vt.onclick = () => {
      const B = duMois().filter(b => !b.verifieLe && !(b.correction && !b.correction.reponse));
      if (!B.length) return toast('Chaque bulletin attend la réponse à sa correction.', 'error');
      marquer(vt, B.map(b => b.id), { verifieLe: aujourdhui() }, `${B.length > 1 ? `${B.length} bulletins vérifiés` : 'Bulletin vérifié'}.`);
    };
    // 1.237.0 — les gestes de l'inventaire de la maquette.
    $$('[data-pa-pdf]', el).forEach(b => { b.onclick = () => { const x = duMois().find(y => y.id === b.dataset.paPdf); if (x) imprimerBulletin(dossier, x); }; });
    $$('[data-pa-modifier]', el).forEach(b => { b.onclick = () => { const x = duMois().find(y => y.id === b.dataset.paModifier); if (x) bulletinForm(root, dossier, x); }; });
    $$('[data-pa-demander-cnss]', el).forEach(b => { b.onclick = () => {
      const x = (s.livre.salaries || []).find(y => y.id === b.dataset.paDemanderCnss);
      if (x) fenDemanderCl(dossier, { piece: `Le n° CNSS de ${x.nom}` }, { hors: true, apres: async () => redraw() });
    }; });
    const spt0 = $('#pa-sans-pt', el);
    if (spt0) spt0.onclick = () => bulletinForm(root, dossier, null);
    const oav = $('#pa-ouvrir-avant', el);
    if (oav) oav.onclick = () => { s.paieMois = Math.max(1, Number(s.paieMois) - 1); s.paieBul = null; redraw(); };
    const pob = $('#pa-proposer-oubli', el);
    if (pob) pob.onclick = () => {
      const P = P0(), o1 = P.oublis.find(({ b }) => !(b.correction && !b.correction.reponse));
      if (o1) correctionForm(root, dossier, o1.b, { libelle: o1.d.label, montant: o1.d.amount, advanceId: o1.d.advanceId, motif: `${o1.d.label} : l'échéance de ce mois (${money(o1.d.amount)}) n'est pas retenue sur le bulletin.` });
    };
    $$('[data-pa-docs]', el).forEach(b => { b.onclick = () => { const x = (s.livre.salaries || []).find(y => y.id === b.dataset.paDocs); if (x) documentPersonnelForm(root, dossier, x); }; });
    $$('[data-pa-me-rappeler]', el).forEach(b => { b.onclick = async () => {
      const x = (s.livre.salaries || []).find(y => y.id === b.dataset.paMeRappeler);
      if (!x) return;
      b.disabled = true;
      try {
        const r = await api.messagerie.meRappeler(dossier.id, b.dataset.le, `Le contrat de ${x.nom} finit le ${fmtJour(x.sortie)} : le renouveler, ou préparer sa sortie (dernier bulletin, documents).`);
        toast(r && r.garde ? `Ton rappel du ${fmtJour(r.garde)} sur ce dossier est plus tôt : il reste, la note est ajoutée.` : `Rappel posé le ${fmtJour(b.dataset.le)} : le dossier remonte ce jour-là dans tes messages.`);
        b.textContent = `Rappel le ${fmtJour(b.dataset.le).slice(0, 5)} ✓`;
      } catch (err) { b.disabled = false; toast(plainError(err), 'error'); }
    }; });
    // (1.240.0) La fiche d'un salarié : une ligne l'ouvre (clic ou Entrée), la croix la ferme.
    $$('#pa-sal-liste tr[data-sal]', el).forEach(tr => {
      const choisir = () => { s.paieSal = s.paieSal === tr.dataset.sal ? null : tr.dataset.sal; redraw(); };
      tr.onclick = e => { if (e.target.closest('button, a, .row-actions')) return; choisir(); };
      tr.onkeydown = e => { if (e.target === tr && e.key === 'Enter') { e.preventDefault(); choisir(); } };
    });
    const sfx = $('#pa-sal-x', el);
    if (sfx) sfx.onclick = () => { s.paieSal = null; redraw(); };
    const sfm = $('#pa-sal-modifier', el);
    if (sfm) sfm.onclick = () => { const x = (s.livre.salaries || []).find(y => y.id === s.paieSal); if (x) salarieForm(root, dossier, x); };
    const sfd = $('#pa-sal-fiche-demander', el);
    if (sfd) sfd.onclick = () => { const x = (s.livre.salaries || []).find(y => y.id === s.paieSal); if (x) fenDemanderCl(dossier, { titre: `${[!x.cnss && 'Le n° CNSS', !x.rib && x.methode !== 'especes' && 'le RIB'].filter(Boolean).join(' et ').replace(/^l/, 'L')} de ${x.nom}` }, { hors: true, apres: async () => redraw() }); };
    // (1.241.0) Le départ d'un salarié : l'ouvrir, le fermer, l'envoyer au client, ses deux documents.
    $$('[data-pa-depart]', el).forEach(b => { b.onclick = () => { s.paieDepart = b.dataset.paDepart; s.paieSal = null; redraw(); }; });
    const dpx = $('#pa-depart-x', el);
    if (dpx) dpx.onclick = () => { s.paieDepart = null; redraw(); };
    const leDepart = () => (s.livre.salaries || []).find(y => y.id === s.paieDepart);
    const dpc = $('#pa-depart-cert', el);
    if (dpc) dpc.onclick = () => { const x = leDepart(); if (x) documentPersonnelForm(root, dossier, x, 'certificat'); };
    const dps = $('#pa-depart-solde', el);
    if (dps) dps.onclick = () => { const x = leDepart(); if (x) documentPersonnelForm(root, dossier, x, 'solde'); };
    const dpe = $('#pa-depart-envoyer', el);
    if (dpe) dpe.onclick = () => {
      const x = leDepart(); if (!x) return;
      const prenom = clientDePaie(dossier, s.livre), brut = ($('#pa-depart-brut', el) || {}).textContent || '';
      fenDemanderCl(dossier, { titre: `Le départ de ${x.nom}, le ${fmtJour(x.sortie)}`, texte: `Bonjour${prenom && prenom !== 'ton client' ? ` ${prenom}` : ''}, le contrat de ${x.nom} finit le ${fmtJour(x.sortie)}. Le renouvelles-tu ? Sinon, voici le projet de son dernier bulletin : brut ${brut}, avec ses congés pas pris (l'indemnité de fin de contrat reste à vérifier avec son contrat). Je prépare son certificat de travail et son solde de tout compte.` }, { hors: true, apres: async () => redraw() });
    };
    // (1.243.0) L'accusé CNSS du trimestre : le ranger (la fenêtre du classeur), l'ouvrir (le classeur, sur lui).
    const tCnss = () => Number(($('#pa-trim', el) || {}).value) || 1;
    const acr = $('#pa-cnss-accuse-ranger', el);
    if (acr) acr.onclick = () => fenDeposerCl(dossier, `${s.annee}-${String(tCnss() * 3).padStart(2, '0')}`, { rubrique: 'accuse', periode: `${s.annee}-${String(tCnss() * 3).padStart(2, '0')}`, titre: titreAccuseCnss(s.annee, tCnss()), apres: async () => redraw() });
    const acv = $('#pa-cnss-accuse-voir', el);
    // L'accusé s'ouvre en grand ici, comme une pièce du classeur (le classeur se remet sur ce dossier, comme en y entrant).
    if (acv) acv.onclick = () => {
      const a = accuseCnssDe(dossier, s.annee, tCnss()); if (!a) return;
      if (clState.id !== dossier.id) Object.assign(clState, { id: dossier.id, annee: s.annee, mois: '', rub: '', filtre: 'rub', sel: '', q: '', plus: false, decl: '', vue: '', menu: '', hist: false, ouvrir: false });
      enGrandCl(dossier, [{ k: `ds:${a.id}`, sorte: 'doc', doc: a, classee: true, rub: 'declaration', mois: a.periode, titre: a.titre }], 0, {});
    };
    // (1.244.0) La paie de tous mes dossiers : une ligne ouvre la paie de son dossier ; relancer un pointage attendu.
    $$('#pa-tous-liste tr[data-pa-tous]', el).forEach(tr => {
      const aller = () => { if (tr.dataset.paTous === dossier.id) { s.paieVue = 'mois'; redraw(); return; } s.paieVue = 'mois'; s.paieBul = null; navigate(`#/dossier/${encodeURIComponent(tr.dataset.paTous)}/comptabilite/paie`); };
      tr.onclick = aller; tr.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); aller(); } };
    });
    const ptr = $('#pa-tous-relire', el);
    if (ptr) ptr.onclick = () => { paieTousState.cle = ''; redraw(); };
    $$('[data-pa-tous-relancer]', el).forEach(b => { b.onclick = () => {
      const d = mesDossiers().find(x => x.id === b.dataset.paTousRelancer);
      if (d) fenDemanderCl(d, { piece: `Le pointage ${KC.deMois(KC.moisPaie(s.paieMois))}` }, { hors: true, apres: async () => { paieTousState.cle = ''; redraw(); } });
    }; });
    const sdm = $('#pa-sal-demander', el);
    if (sdm) sdm.onclick = () => fenDemanderCl(dossier, { titre: `Les n° CNSS et RIB qui manquent : ${(s.livre.salaries || []).filter(x => x.actif && (!x.cnss || (!x.rib && x.methode !== 'especes'))).map(x => x.nom).join(', ')}` }, { hors: true, apres: async () => redraw() });
    const van = $('#pa-vers-annuelle', el);
    if (van) van.onclick = () => { pageFocus = 'li-employeur'; allerSousOnglet(root, dossier, 'liasse'); };
    const rem = $('#pa-remettre', el);
    if (rem) rem.onclick = () => { const B = duMois().filter(b => !b.remisLe); marquer(rem, B.map(b => b.id), { remisLe: aujourdhui() }, `${B.length > 1 ? `${B.length} bulletins remis` : 'Bulletin remis'} aux salariés.`); };
    const noter = $('#pa-noter-payes', el);
    if (noter) noter.onclick = () => { const B = duMois().filter(b => !b.payeLe); marquer(noter, B.map(b => b.id), { paidDate: aujourdhui() }, `${B.length > 1 ? `${B.length} salaires notés payés` : 'Salaire noté payé'} aujourd'hui.`); };
    const mo = () => KC.deMois(KC.moisPaie(s.paieMois));
    const rap = $('#pa-rappel', el);
    if (rap) rap.onclick = () => {
      const B = duMois(), payes = B.filter(b => b.payeLe).length, pour = rap.dataset.pour || '';
      const prenom = clientDePaie(dossier, livresState.livre);
      fenDemanderCl(dossier, { titre: `Payer les salaires ${mo()}`, texte: `Bonjour${prenom && prenom !== 'ton client' ? ` ${prenom}` : ''}, les salaires ${mo()} ne sont pas tous marqués payés dans SkanFact (${payes} sur ${B.length}). Peux-tu les payer${pour ? ` d'ici le ${pour.slice(8, 10)}/${pour.slice(5, 7)}` : ''}, ou me dire s'ils le sont déjà ?` }, { hors: true, pour, apres: async () => redraw() });
    };
    $$('[data-pa-revenu-dire]', el).forEach(b => { b.onclick = () => {
      const x = KC.virementsRevenus(s.livre.releves || [], duMois(), id => ((s.livre.salaries || []).find(y => y.id === id) || {}).nom || '').find(y => y.bulletin === b.dataset.paRevenuDire);
      if (!x) return;
      const nom = ((s.livre.salaries || []).find(y => y.id === x.salarieId) || {}).nom || 'ce salarié';
      const prenom = clientDePaie(dossier, livresState.livre);
      fenDemanderCl(dossier, { titre: `Le salaire de ${nom} est revenu`, texte: `Bonjour${prenom && prenom !== 'ton client' ? ` ${prenom}` : ''}, le virement du salaire de ${nom} (${money(x.net)}, payé le ${jourCourt(x.payeLe)}) est revenu sur le compte le ${jourCourt(x.date)} : le relevé dit « ${x.libelle} ». Peux-tu vérifier son RIB, le payer de nouveau et me dire quand c'est fait ?` }, { hors: true, apres: async () => redraw() });
    }; });
    const dpt = $('#pa-demander-pt', el);
    if (dpt) dpt.onclick = () => fenDemanderCl(dossier, { piece: `Le pointage ${mo()}` }, { hors: true, apres: async () => redraw() });
    const spt = $('#pa-saisir-pt', el);
    if (spt) spt.onclick = () => { s.paieVue = 'pointage'; redraw(); };
    const dcl = $('#pa-declarer', el);
    if (dcl) dcl.onclick = () => allerSousOnglet(root, dossier, 'declaration');
    // (plateforme) 1.245.0 — ce que le classeur du client a déjà (lu une fois par mois affiché), puis « Les envoyer ».
    const envPdf = $('#pa-envoyer-pdf', el);
    const clePdf = `${dossier.id}:${s.annee}-${String(s.paieMois).padStart(2, '0')}`;
    const nomPdf = id => ((s.livre.salaries || []).find(x => x.id === id) || {}).nom || 'Salarié';
    if (envPdf && !paiePdfsState.lu[clePdf]) {
      paiePdfsState.lu[clePdf] = true;
      lirePdfsDuMois(dossier, s.annee, s.paieMois, duMois().filter(b => b.valideLe), nomPdf).then(x => { if (x.n) redraw(); }, () => null);
    }
    if (envPdf) envPdf.onclick = async () => {
      const B = duMois().filter(b => b.valideLe);
      envPdf.setAttribute('disabled', ''); envPdf.textContent = 'Envoi…';
      const mois = `${s.annee}-${String(s.paieMois).padStart(2, '0')}`;
      let faits = 0;
      try {
        const avant = await lirePdfsDuMois(dossier, s.annee, s.paieMois, B, nomPdf);
        const { C, d, societe } = await donneesDocumentsPaie(dossier);
        for (const b of B) {
          const p = (d.payslips || []).find(y => y.id === b.id);
          if (!p) throw new Error('Un bulletin n\'est plus dans la paie du dossier : recharge la page.');
          const nom = nomPdf(b.salarieId), titre = titreBulletinPdf(nom, s.annee, s.paieMois);
          const deja = avant.docs.find(x => x.titre === titre);
          await api.classeur.deposerPdf(dossier.id, C.payslipHtml(p, d, societe, { notice: false }), `Bulletin_${nomDeFichier(nom)}_${mois}.pdf`, {
            rubrique: 'piece', periode: mois, titre, provenance: 'la Paie du cabinet', raison: 'rien', detail: 'bulletin validé', paie: true, remplace: deja ? deja.id : null,
          });
          faits++;
        }
        await lirePdfsDuMois(dossier, s.annee, s.paieMois, B, nomPdf);
        toast(`${faits > 1 ? `Les ${faits} bulletins sont` : 'Le bulletin est'} dans les documents de ${clientDePaie(dossier, livresState.livre)}${avant.n ? ' (à la place de ceux d\'avant, gardés et marqués remplacés)' : ''}.`);
      } catch (e) {
        toast(`${faits ? `${faits} sur ${B.length} envoyés. ` : ''}Pas envoyé${faits ? 's tous' : ''} : ${plainError(e)}`, 'error');
      }
      redraw();
    };
    $$('[data-pa-verifie]', el).forEach(b => { b.onclick = () => marquer(b, [b.dataset.paVerifie], { verifieLe: aujourdhui() }, 'Bulletin vérifié.'); });
    $$('[data-pa-proposer]', el).forEach(b => { b.onclick = () => {
      const x = duMois().find(y => y.id === b.dataset.paProposer);
      if (x) correctionForm(root, dossier, x);
    }; });
    $$('[data-pa-relancer]', el).forEach(b => { b.onclick = () => {
      const x = duMois().find(y => y.id === b.dataset.paRelancer);
      if (!x || !x.correction) return;
      const P = P0();
      marquer(b, [x.id], { correction: { ...x.correction, relanceLe: new Date().toISOString() } }, `${P.client} est relancé : la correction remonte en haut de sa paie.`);
    }; });
    $$('[data-pa-retirer]', el).forEach(b => { b.onclick = async () => {
      const x = duMois().find(y => y.id === b.dataset.paRetirer);
      if (!x) return;
      if (!await confirmDialog('Retirer la proposition ?', 'Le bulletin reste tel que le client l\'a fait ; la proposition disparaît de sa paie.', 'Retirer')) return;
      marquer(b, [x.id], { correction: null }, 'La proposition est retirée.');
    }; });
    // (plateforme) 1.69.0
    brancherPointage(el, root, dossier);
    // (plateforme) 1.70.0
    brancherConges(el, root, dossier);
    // (plateforme) 1.71.0
    brancherAvances(el, root, dossier);
    const trim = $('#pa-trim', el);
    if (trim) trim.onchange = () => { s.paieTrimestre = Number(trim.value) || 1; redraw(); };
    [$('#pa-salarie', el), $('#pa-salarie2', el)].forEach(b => { if (b) b.onclick = () => salarieForm(root, dossier, null); });
    $$('[data-sal-cnss]', el).forEach(b => { b.onclick = () => {
      const x = (s.livre.salaries || []).find(y => y.id === b.dataset.salCnss);
      if (x) salarieForm(root, dossier, x, { focus: 'cnss' });
    }; });
    [$('#pa-bulletin', el), $('#pa-bulletin2', el), $('#pa-pt-preparer', el)].forEach(b => { if (b) b.onclick = () => bulletinForm(root, dossier, null); });
    const cpp = $('#pa-copier-param', el);
    if (cpp) cpp.onclick = () => copierParametrageForm(dossier);
    const rg = $('#pa-regimes', el);
    if (rg) rg.onclick = () => (s.livre && s.livre.reglagesPaie ? tauxDuSkanFactDuClient(s.livre.reglagesPaie) : regimesForm(root, dossier));
    $$('[data-pa-emp]', el).forEach(b => { b.onclick = () => dossierForm(dossier, { focus: b.dataset.paEmp === 'code' ? '#f-cnss-code' : '#f-cnss' }); });
    $$('[data-pa-sal]', el).forEach(b => { b.onclick = () => {
      const x = (s.livre.salaries || []).find(y => y.id === b.dataset.paSal);
      if (x) salarieForm(root, dossier, x, { focus: b.dataset.paChamp });
    }; });
    // (plateforme) 1.65.0 — le journal de paie du mois et l'état récapitulatif CNSS du trimestre, imprimés.
    const jp = $('#pa-journal', el);
    if (jp) jp.onclick = () => imprimerDocumentPaie(dossier, (C, d, so) => C.journalDePaieHtml(d, so, Number(s.annee), Number(s.paieMois)),
      () => `Journal_de_paie_${s.annee}-${String(s.paieMois).padStart(2, '0')}`);
    const et = $('#pa-etat', el);
    if (et) et.onclick = () => {
      const trimestre = Number(s.paieTrimestre || Math.ceil(s.paieMois / 3));
      imprimerDocumentPaie(dossier, (C, d, so) => C.etatRecapitulatifCnssHtml(d, so, Number(s.annee), trimestre), () => `Etat_recapitulatif_CNSS_${s.annee}-T${trimestre}`);
    };
    const fc = $('#pa-fichier', el);
    if (fc) fc.onclick = async () => {
      fc.disabled = true;
      try {
        const t = s.paieTrimestre || Math.ceil(s.paieMois / 3);
        const r = await api.fichierCnss({ dossierId: dossier.id, annee: s.annee, trimestre: t });
        if (!r) return;                                    // le choix du dossier a été annulé
        if (!r.ok) { redraw(); return toast((r.refus[0] || {}).motif || 'Le fichier n\'a pas pu être fabriqué.', 'error'); }
        const html = `<p>Le fichier <b class="mono">${esc(r.nom)}</b> est prêt : ${esc(pl(r.lignes, 'salarié'))}, ${esc(money(r.total))} de salaires déclarés.</p>
          <p class="small muted">Il est dans tes téléchargements. Garde-lui exactement ce nom : le portail refuse un fichier renommé — et ton
          navigateur ajoute « (1) » au nom d'un fichier déjà téléchargé. Dépose-le sur le portail CNSS
          (télédéclaration des salaires), puis vérifie que le nombre de salariés et le total que le portail affiche sont ceux-ci.</p>`;
        await infoHtml('Fichier CNSS téléchargé', html);
      } catch (err) { toast(plainError(err), 'error'); }
      finally { fc.disabled = false; }
    };
    const pv = $('#pa-valider', el);
    if (pv) pv.onclick = () => { pageFocus = 'sa-brouillard'; allerSousOnglet(root, dossier, 'saisie'); };
    const ec = $('#pa-ecrire', el);
    if (ec) ec.onclick = async () => {
      ec.disabled = true;
      try {
        const r = await api.ecrirePaie({ dossierId: dossier.id, annee: s.annee, mois: s.paieMois });
        s.livre = r.livre;
        toast(`Écriture de paie ${KC.deMois(KC.moisPaie(s.paieMois))} passée en brouillard.`);
        redraw();
      } catch (err) { toast(plainError(err), 'error'); ec.disabled = false; }
    };
    // UNE table d'actions par racine (9.4.8) : celle de la Paie vit sur SON panneau, jamais sur
    // `document` — deux tables posées sur la même racine se mangent, et celle qui perd retire les
    // boutons qu'elle ne reconnaît pas.
    RowMenu.brancherMenus(el, id => {
      if (id.startsWith('SAL:')) {
        const x = (s.livre.salaries || []).find(y => y.id === id.slice(4));
        if (!x) return [];
        const a = [{ icon: 'modifier', label: 'Modifier la fiche', hint: 'Nom, CNSS, poste, brut, primes', run: () => salarieForm(root, dossier, x) },
          // (plateforme) 1.72.0 — les documents du personnel, ceux de l'entreprise.
          { icon: 'pdf', label: 'Attestation, certificat, solde…', hint: 'Les documents du personnel, à signer', run: () => documentPersonnelForm(root, dossier, x) }];
        if (x.actif) a.push({ sep: true }, { icon: 'non', label: 'Noter la sortie', danger: true,
          hint: 'Son nom reste sur les bulletins déjà établis', run: async () => {
            if (!await confirmDialog(`Noter la sortie de ${x.nom} ?`, 'Il ne sera plus proposé pour un nouveau bulletin. Son nom reste sur ceux qui existent — un bulletin remis ne se réécrit pas.', 'Noter la sortie')) return;
            try { const r = await api.retirerSalarie({ dossierId: dossier.id, annee: s.annee, id: x.id }); s.livre = r.livre; toast('Sortie notée.'); redraw(); }
            catch (err) { toast(plainError(err), 'error'); }
          } });
        return a;
      }
      const b = (s.livre.bulletins || []).find(y => y.id === id.slice(5));
      if (!b) return [];
      const a = [{ icon: 'ouvrir', label: 'Voir le détail du calcul', hint: 'Assiette, tranches, charges', run: () => detailBulletin(b) },
        // (plateforme) 1.65.0 — le bulletin imprimé, celui de l'entreprise (sur une page) ; sans l'avertissement « À faire
        // valider par votre comptable » : c'est le comptable qui l'imprime.
        { icon: 'pdf', label: 'Imprimer le bulletin', hint: 'À remettre au salarié', run: () => imprimerBulletin(dossier, b) }];
      // (plateforme) 1.63.0 — l'écriture de paie du mois SUIT les bulletins : le serveur la réécrit, et contre-passe celle
      // qui était validée (une écriture validée ne se modifie jamais). Un bulletin se corrige donc tant que l'exercice
      // n'est pas clos, comme dans le SkanFact du client ; la v10 le refusait dès que l'écriture était passée, et sur la
      // plateforme, où le serveur la passe toujours, aucun bulletin ne se corrigeait au Cabinet.
      // 1.235.0 (D3) — une paie faite par le client ne se réécrit pas au Cabinet : il propose sa correction, le client
      // l'accepte (CLAUDE.md : « le cabinet n'écrit jamais chez un client sans son accord »). Un bulletin validé ne bouge plus.
      const Pm = parcoursPaie(dossier, s.livre, b.annee, b.mois, KC.bulletinsDuMois(s.livre, b.annee, b.mois));
      if (Pm.mode === 'seule' && !b.valideLe && !(b.correction && !b.correction.reponse) && !(s.livre.exercice || {}).clos) {
        a.push({ icon: 'modifier', label: 'Proposer une correction…', hint: `${Pm.client} l'accepte ou la refuse dans SkanFact`, run: () => correctionForm(root, dossier, b) });
        return a;
      }
      if (Pm.mode === 'seule' || Pm.mode === 'sans' || b.valideLe) return a;
      if (!(s.livre.exercice || {}).clos) a.push(
        { icon: 'modifier', label: 'Modifier le bulletin', hint: 'Brut, primes, absences, retenues', run: () => bulletinForm(root, dossier, b) },
        { sep: true },
        { icon: 'supprimer', label: 'Supprimer ce bulletin', danger: true, hint: 'L\'écriture de paie du mois se refait sans lui', run: async () => {
          if (!await confirmDialog('Supprimer ce bulletin ?', 'L\'écriture de paie du mois se refait sans lui ; validée, elle se contre-passe.', 'Supprimer', true)) return;
          try { const r = await api.supprimerBulletin({ dossierId: dossier.id, annee: s.annee, id: b.id }); s.livre = r.livre; toast('Bulletin supprimé.'); redraw(); }
          catch (err) { toast(plainError(err), 'error'); }
        } });
      return a;
    });
  }

  // (plateforme) 1.70.0 — les congés et absences d'un dossier : ceux de l'entreprise (5.1.0), par son moteur (compta.js).
  // Le solde de chaque salarié en poste, puis les congés et absences de l'année. Un client sur SkanFact les saisit dans son
  // SkanFact : le Cabinet les lit (il n'écrit jamais chez un client sans son accord). Pour un dossier tenu, il les saisit,
  // dans la fenêtre de l'entreprise. Chacun se pose de lui-même sur la grille du pointage, et un bulletin établi ensuite
  // retire du brut une absence non payée.
  const congesState = { page: 1, size: prefs.get('cgSize', 25), sizeKey: 'cgSize' };
  // Le pluriel des deux applications : au-delà d'un jour, en valeur absolue (« −1,5 jour » disait le singulier).
  const joursCg = n => `${joursFr(n)} jour${Math.abs(Number(n)) > 1 ? 's' : ''}`;
  // Qui peut les saisir : le Cabinet, pour un dossier tenu dont l'exercice est ouvert.
  const congesTenus = L => !L.reglagesPaie && !(L.exercice || {}).clos;
  // (1.240.0, la maquette « paiesalaries ») La fiche d'un salarié, à droite : ce qui manque d'abord (« 2 choses à
  // compléter »), son contrat, son salaire, sa situation, son n° CNSS, sa CIN, son RIB (masqué), ses congés ; « Demander à
  // … son n° CNSS et son RIB » (par la conversation) et « Modifier… ». Rien n'y est inventé : un champ vide le dit.
  function paieFicheSalarie(dossier, L, x, P, annee) {
    const sansRib = !x.rib && x.methode !== 'especes';
    const manque = [!x.cnss && 'n° CNSS', sansRib && 'RIB'].filter(Boolean);
    const contrat = KC.contractLabel(x.contrat).split(' —')[0];
    const primes = (x.primes || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    let conges = '';
    try {
      const b = KC.leaveBalance(donneesDuPointage(dossier, L), x.id, Number(annee));
      conges = `${joursFr(b.acquired)} j acquis en ${annee} · ${joursFr(b.taken)} j pris · <b>reste ${joursFr(b.remaining)} j</b>`;
    } catch { conges = '<span class="muted">dans « Congés et avances »</span>'; }
    const dd = (t, v, id) => `<dt>${t}</dt><dd${id ? ` id="${id}"` : ''}>${v}</dd>`;
    const demander = (!x.cnss || sansRib) && x.actif && !dossier.manual && api.messagerie && P.mode !== 'cabinet';
    return `<aside class="panel cp-pa-volet" id="pa-sal-fiche" aria-label="La fiche de ${esc(x.nom)}">
      <div class="cp-pa-volet-t"><div><b>${esc(x.nom)}</b><small class="muted">${esc([x.poste, x.embauche ? `entrée le ${fmtJour(x.embauche)}` : ''].filter(Boolean).join(' · ') || '—')}</small></div>
        ${manque.length ? `<span class="badge warn" id="pa-sal-manque-n">${esc(pl(manque.length, 'chose à compléter', 'choses à compléter'))}</span>` : '<span class="badge ok">complète</span>'}
        <button type="button" class="btn btn-sm btn-ghost" id="pa-sal-x" aria-label="Fermer la fiche">✕</button></div>
      <dl class="cp-pa-fi">
        ${dd('Contrat', `${esc(contrat)}${x.sortie ? ` · ${x.sortie < aujourdhuiPaie() ? 'sorti' : 'fin'} le ${esc(fmtJour(x.sortie))}` : ''}`)}
        ${dd('Salaire de base', `${esc(money(x.brut))} par mois${primes ? ` · + ${esc(money(Math.round(primes * 1000) / 1000))} de primes chaque mois` : ''}`)}
        ${dd('Situation', x.chefDeFamille ? `chef de famille${x.enfants ? `, ${esc(pl(x.enfants, 'enfant'))} à charge` : ', sans enfant à charge'}` : `pas chef de famille${x.enfants ? ` · ${esc(pl(x.enfants, 'enfant'))}` : ''}`)}
        ${dd('N° CNSS', x.cnss ? esc(x.cnss) : '<span class="warn-text">à demander</span> · la déclaration du trimestre l\'attend', 'pa-sal-cnss')}
        ${dd('CIN', x.cin ? esc(x.cin) : '<span class="warn-text">à renseigner</span>')}
        ${dd('RIB', x.rib ? `··· ${esc(String(x.rib).replace(/\s/g, '').slice(-4))}` : x.methode === 'especes' ? 'payé en espèces' : '<span class="warn-text">à demander</span> · sans lui, son salaire se paie à part', 'pa-sal-rib')}
        ${dd('Congés', conges)}
      </dl>
      <div class="ctrl-geste">${demander ? `<button type="button" class="btn btn-primary btn-sm" id="pa-sal-fiche-demander">Demander à ${esc(P.client)} ${[!x.cnss && 'son n° CNSS', sansRib && 'son RIB'].filter(Boolean).join(' et ')}</button>` : ''}<button type="button" class="btn btn-sm" id="pa-sal-modifier">Modifier…</button>${x.sortie && x.actif ? `<button type="button" class="btn btn-sm" data-pa-depart="${esc(x.id)}">Préparer son départ</button>` : ''}</div>
    </aside>`;
  }

  // (1.241.0, la maquette « paiesortie ») Le départ d'un salarié dont la fiche porte une date de sortie (un CDD qui finit) :
  // son dernier bulletin en projet — le salaire de sa fiche, l'indemnité de congés pas pris (KC.indemniteConges, le même
  // chiffre que le solde de tout compte), l'indemnité de fin de contrat laissée vide (À VÉRIFIER : la convention) —, et ce
  // que son départ demande. Rien ne s'écrit : le projet s'envoie au client, les documents se préparent un par un.
  function paieDepart(dossier, L, x, P) {
    const an = x.sortie.slice(0, 4), mois = Number(x.sortie.slice(5, 7)), tri = Math.ceil(mois / 3);
    let ic = { jours: 0, journalier: 0, montant: 0, solde: 0 }, sal = { gross: Number(x.brut) || 0, prorata: null };
    try {
      const data = { ...api.paieDuDossierV10(dossier.id), payrollSettings: reglagesPaie(dossier, L) };
      ic = KC.indemniteConges(data, x.id, x.sortie);
      // Le salaire du mois de sa sortie, au prorata s'il part avant la fin du mois : le calcul du bulletin lui-même.
      const e = (data.employees || []).find(y => y.id === x.id);
      if (e) sal = KC.saisieDuMois(data, e, Number(an), mois);
    } catch { /* sans données de paie : le brut de la fiche, et zéro de congés, dits tels quels */ }
    const salaire = KC.round3(Number(sal.gross) || 0);
    const brut = KC.round3(salaire + ic.montant);
    const ligne = (t, sous, v) => `<tr><td>${t}<div class="small muted">${sous}</div></td><td class="r nw">${v}</td></tr>`;
    const envoyer = api.messagerie && !dossier.manual && P.mode !== 'cabinet';
    return `<section class="panel mt" id="pa-depart" aria-label="Le départ de ${esc(x.nom)}">
      <div class="cp-pa-volet-t"><div><b>Le départ de ${esc(x.nom)}, le ${esc(fmtJour(x.sortie))}</b><small class="muted">${esc(KC.contractLabel(x.contrat).split(' —')[0])} qui arrive à son terme · le projet se prépare avec ${esc(P.client)} : le renouveler, ou le laisser finir</small></div>
        <button type="button" class="btn btn-sm btn-ghost" id="pa-depart-x" aria-label="Fermer le départ">✕</button></div>
      <div class="cp-pa-grille avec-volet">
        <div><h4>Son dernier bulletin, ${esc(KC.moisPaie(mois))} ${esc(an)} <span class="muted small">· À VÉRIFIER : la règle des congés et l'indemnité de fin de contrat</span></h4>
          <table class="list compact" id="pa-depart-bul"><tbody>
            ${ligne(`Salaire de ${esc(KC.moisPaie(mois))}`, sal.prorata ? `au prorata : ${esc(joursFr(sal.prorata.jours))} j sur ${esc(joursFr(sal.prorata.sur))} (${esc(sal.prorata.motif)}) · ${esc(money(sal.prorata.brutFiche))} pour un mois complet` : 'le brut de sa fiche, pour un mois complet', esc(money(salaire)))}
            ${ligne(`Congés pas pris : ${esc(joursFr(ic.jours))} j`, ic.solde < 0 ? `il a pris ${esc(joursFr(-ic.solde))} j de plus qu'il n'en a acquis : rien à indemniser` : `le solde au ${esc(fmtJour(x.sortie))} · ${esc(joursFr(ic.jours))} × ${esc(money(ic.journalier))} (son brut sur les jours d'un mois complet)`, esc(money(ic.montant)))}
            ${ligne('Indemnité de fin de contrat', 'selon son contrat et la convention collective (À VÉRIFIER)', '<span class="muted">—</span>')}
          </tbody><tfoot><tr><th>Brut du dernier bulletin</th><th class="r nw" id="pa-depart-brut">${esc(money(brut))}</th></tr></tfoot></table></div>
        <div><h4>Ce que son départ demande</h4><dl class="cp-pa-fi" id="pa-depart-demande">
          <dt>Certificat de travail</dt><dd>daté du ${esc(fmtJour(x.sortie))}, à remettre</dd>
          <dt>Solde de tout compte</dt><dd>le reçu, signé par ${esc(x.nom.split(' ')[0])}</dd>
          <dt>Attestation de salaires</dt><dd>${esc(an)}, pour sa déclaration d'impôt</dd>
          <dt>CNSS</dt><dd>sa sortie dans la déclaration du ${tri === 1 ? '1er' : `${tri}e`} trimestre ${esc(an)}</dd>
          <dt>Le livre</dt><dd>l'indemnité de congés passe comme un salaire (le compte : À VÉRIFIER)</dd></dl>
          <div class="ctrl-geste">${envoyer ? `<button type="button" class="btn btn-primary btn-sm" id="pa-depart-envoyer">Envoyer le projet à ${esc(P.client)}</button>` : ''}<button type="button" class="btn btn-sm" id="pa-depart-cert">Le certificat de travail…</button><button type="button" class="btn btn-sm" id="pa-depart-solde">Le solde de tout compte…</button></div></div>
      </div></section>`;
  }

  // (1.243.0, la maquette « paiecnss » : « déposé le 15/10, l'accusé est dans le classeur ») L'accusé de dépôt de la
  // déclaration CNSS d'un trimestre : rangé au classeur (0180, rubrique « accuse ») au dernier mois du trimestre — le serveur
  // range un accusé par mois —, reconnu à son titre « L'accusé CNSS du Ne trimestre ». La Paie dit s'il y est (et l'ouvre),
  // ou propose de le ranger. SkanFact ne dépose rien : l'accusé est la preuve que le cabinet a déposé.
  function estAccuseCnss(x) { return /^L'accusé CNSS du /.test(String((x && x.titre) || '')); }
  function titreAccuseCnss(annee, t) { return `L'accusé CNSS du ${t === 1 ? '1er' : `${t}e`} trimestre ${annee}`; }
  function accuseCnssDe(dossier, annee, t) {
    const per = `${annee}-${String(t * 3).padStart(2, '0')}`, titre = titreAccuseCnss(annee, t);
    return (((clState.docs.get(dossier.id) || {}).documents) || []).find(x => !x.remplacePar && x.rubrique === 'accuse' && x.periode === per && x.titre === titre) || null;
  }
  function paieAccuseCnss(dossier, annee, t) {
    const e = clState.docs.get(dossier.id);
    if (!e || (!e.lu && !e.lecture)) { void chargerDocsCl(dossier).then(() => { if ($('#pa-cnss-accuse')) drawLivres($('#view'), dossier); }); }
    if (!e || !e.lu) return '<p class="small muted mt" id="pa-cnss-accuse">L\'accusé de dépôt : lecture du classeur…</p>';
    const a = accuseCnssDe(dossier, annee, t);
    return a
      ? `<div class="ctrl-geste mt" id="pa-cnss-accuse"><span class="small"><b>Déposée</b> · l'accusé est dans le classeur (rangé le ${esc(fmtJour(jourTunisCl(a.deposeLe)))}).</span><button type="button" class="btn btn-sm" id="pa-cnss-accuse-voir">Ouvrir l'accusé</button></div>`
      : `<div class="ctrl-geste mt" id="pa-cnss-accuse"><span class="small muted">Déposée sur le portail de la CNSS ? Range son accusé : il prouve le dépôt, et il se retrouve dans le classeur.</span>${e.lectureSeule ? '' : '<button type="button" class="btn btn-sm" id="pa-cnss-accuse-ranger">Ranger l\'accusé…</button>'}</div>`;
  }

  // (1.244.0, la maquette « paiedossiers ») La paie d'un mois de tous les dossiers dont je fais la paie : une ligne par
  // dossier, ses salariés, son pointage, où en sont ses bulletins, ses salaires. Une lecture du serveur, en lot ; chaque
  // ligne ouvre la paie de son dossier ; « Relancer … » pour un pointage qui n'arrive pas.
  const paieTousState = { cle: '', donnees: null, erreur: '' };
  function etatPaieDossier(x) {
    const n = x.bulletins, seule = x.mode === 'seule' || x.mode === 'sans';
    if (!x.salaries && !n) return ['', 'aucun salarié'];
    if (!n) return seule ? ['ambre', `à faire par le client`] : ['rouge', 'à préparer'];
    if (x.valides >= n) return ['ok', x.remis >= n ? 'validés · remis' : 'validés'];
    if (seule) return x.verifies >= n ? ['ok', 'vérifiés'] : ['ambre', 'à vérifier'];
    if (x.approuves >= n) return ['ambre', 'approuvés, à valider'];
    if (x.envoyes >= n) return ['ambre', 'chez le client pour accord'];
    return ['ambre', x.mode === 'tenue' ? 'préparés, à envoyer pour accord' : 'préparés, à valider'];
  }
  function pointageDuDossierTous(x) {
    if (x.mode === 'seule' || x.mode === 'sans') return 'fait par le client';
    if (!x.salaries) return '—';
    if (!x.pointes) return x.bulletins ? 'sans pointage' : 'attendu';
    return x.pointes >= x.salaries ? `reçu · ${pl(x.pointes, 'salarié pointé', 'salariés pointés')}` : `${x.pointes} sur ${x.salaries} pointés`;
  }
  function paieDeTousMesDossiers(dossier, s) {
    const mois = `${s.annee}-${String(s.paieMois).padStart(2, '0')}`, titre = `La paie ${KC.deMois(KC.moisPaie(s.paieMois))} ${s.annee} de tous mes dossiers`;
    if (paieTousState.cle !== mois) {
      Object.assign(paieTousState, { cle: mois, donnees: null, erreur: '' });
      api.paieDeTousMesDossiers(mois).then(r => { if (paieTousState.cle === mois) paieTousState.donnees = r; })
        .catch(err => { if (paieTousState.cle === mois) paieTousState.erreur = plainError(err); })
        .then(() => { if ($('#pa-tous')) drawLivres($('#view'), dossier); });
    }
    if (paieTousState.erreur) return `<div class="panel mt" id="pa-tous"><h2>${esc(titre)}</h2><p class="warn-text small">${esc(paieTousState.erreur)}</p><button type="button" class="btn btn-sm" id="pa-tous-relire">Réessayer</button></div>`;
    if (!paieTousState.donnees) return `<div class="panel mt" id="pa-tous"><h2>${esc(titre)}</h2><p class="small muted">Lecture de la paie de chaque dossier…</p></div>`;
    const D = (paieTousState.donnees.dossiers || []).filter(x => x.salaries || x.bulletins);
    const n = D.reduce((a, x) => a + x.bulletins, 0), ici = dossier.id;
    const attendus = D.filter(x => !x.bulletins && !x.pointes && x.salaries && (x.mode === 'tenue') && !x.tenu);
    const ligne = x => { const [ton, mot] = etatPaieDossier(x);
      return `<tr data-pa-tous="${esc(x.entreprise)}" tabindex="0" class="${x.entreprise === ici ? 'sel' : ''}"><td class="tronq"><b>${esc(x.nom)}</b></td><td class="r nw">${x.bulletins} <span class="muted small">/ ${x.salaries}</span></td>
        <td class="small nw">${esc(pointageDuDossierTous(x))}</td><td><span class="cp-pa-etat ${ton}">${esc(mot)}</span></td>
        <td class="small">${!x.bulletins ? '—' : x.payes >= x.bulletins ? 'payés' : x.payes ? `${x.payes} sur ${x.bulletins} payés` : 'à payer'}</td></tr>`; };
    return `<div class="panel mt" id="pa-tous"><div class="cp-pa-titre-l"><h2>${esc(titre)}</h2><span class="small muted" id="pa-tous-resume">${esc(pl(D.length, 'dossier avec une paie', 'dossiers avec une paie'))} · ${esc(pl(n, 'bulletin'))} ce mois</span></div>
      ${D.length ? `<div class="scroll-x"><table class="list compact" id="pa-tous-liste"><thead><tr><th>Dossier</th><th class="r nw">Bulletins / salariés</th><th>Pointage</th><th>Bulletins</th><th>Salaires</th></tr></thead>
        <tbody>${D.map(ligne).join('')}</tbody><tfoot><tr><th>${esc(pl(D.length, 'dossier'))}</th><th class="r nw">${n}</th><th colspan="3"></th></tr></tfoot></table></div>
        <p class="small muted mt">Une ligne ouvre la paie de son dossier. « Sans pointage » : les bulletins sont faits sur des mois complets.</p>`
        : '<div class="empty mini">Aucun de tes dossiers n\'a de salarié déclaré : il n\'y a pas de paie ce mois-ci.</div>'}
      ${attendus.length && api.messagerie ? `<div class="ctrl-geste mt" id="pa-tous-relances">${attendus.map(x => `<button type="button" class="btn btn-sm" data-pa-tous-relancer="${esc(x.entreprise)}">Relancer ${esc(x.nom)}</button>`).join('')}<span class="small muted">le pointage ${esc(KC.deMois(KC.moisPaie(s.paieMois)))} n'est pas arrivé</span></div>` : ''}
    </div>`;
  }

  function vueConges(dossier, L, annee) {
    const data = donneesDuPointage(dossier, L);
    const y = Number(annee);
    const tient = congesTenus(L);
    const tous = KC.leavesOf(data, '', y);
    const soldes = data.employees.filter(e => ((L.salaries || []).find(x => x.id === e.id) || {}).actif)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr')).map(e => ({ e, b: KC.leaveBalance(data, e.id, y) }));
    const nomDe = id => ((L.salaries || []).find(x => x.id === id) || {}).nom || '—';
    const droit = KC.baremesPaie(data.payrollSettings).leaveDaysPerYear;
    // Le pied borne la page AVANT qu'on la découpe (une liste raccourcie ne garde pas une page qui n'existe plus).
    const pied = pagerBar(tous.length, congesState, 'absence');
    const page = paginate(tous, congesState);
    const tiret = '<span class="muted">—</span>';
    return `<div class="panel mt" id="cg-panneau"><h2>Les congés et absences de ${esc(annee)} ${info('pa.conges')}</h2>
      <div class="small mb ctrl-geste" id="cg-droit"><span>Le droit annuel : <b>${esc(joursCg(droit))} ouvrables</b>, acquis au prorata des mois travaillés${L.reglagesPaie
    ? ' ; ce client le règle dans son SkanFact (<b>Paie › Barèmes</b>).' : '. <em>À VÉRIFIER avec la convention collective du client.</em>'}</span>${L.reglagesPaie ? ''
    : '<button type="button" class="btn btn-sm" id="cg-droit-regler">Régler le droit annuel…</button>'}</div>
      ${soldes.length ? `<div class="scroll-x"><table class="list compact" id="cg-soldes"><thead><tr><th>Salarié</th>
        <th class="r nw">Acquis ${esc(annee)}</th><th class="r">Pris</th><th class="r">Solde</th><th class="r">Maladie</th><th class="r nw">Sans solde</th></tr></thead>
        <tbody>${soldes.map(({ e, b }) => `<tr data-cg-solde="${esc(e.id)}"><td class="tronq" title="${esc(e.name)}">${esc(e.name)}</td>
          <td class="r nw">${esc(joursFr(b.acquired))}</td><td class="r nw">${esc(joursFr(b.taken))}</td>
          <td class="r nw${b.remaining < 0 ? ' warn-text' : ''}"><b>${esc(joursFr(b.remaining))}</b></td>
          <td class="r nw">${b.byKind.maladie ? esc(joursFr(b.byKind.maladie)) : tiret}</td>
          <td class="r nw">${b.byKind['sans-solde'] ? esc(joursFr(b.byKind['sans-solde'])) : tiret}</td></tr>`).join('')}</tbody></table></div>
      ${soldes.some(x => x.b.remaining < 0) ? '<p class="small muted mt">Un solde négatif : le salarié a pris plus de jours qu\'il n\'en a acquis. Ce n\'est pas interdit, mais il faut le savoir.</p>' : ''}`
    : '<div class="empty mini">Aucun salarié en poste : le solde de chacun se calcule dès qu\'il est déclaré.</div>'}
      <div class="filters mt">${tient && (L.salaries || []).some(x => x.actif) ? '<button type="button" class="btn btn-sm" id="cg-ajouter">+ Congé ou absence…</button>' : ''}
        <span class="small muted" id="cg-qui">${L.reglagesPaie ? 'Ce client les saisit dans son SkanFact (<b>Paie › Congés et absences</b>) : le Cabinet les lit.'
    : (L.exercice || {}).clos ? `L'exercice ${esc(annee)} est clos : ses congés se lisent, ils ne se changent plus.`
      : 'Chacun se pose de lui-même sur la grille du pointage ; un bulletin établi ensuite retire du brut une absence non payée.'}</span></div>
      ${tous.length ? `<div class="scroll-x"><table class="list compact" id="cg-liste"><thead><tr><th>Salarié</th><th>Nature</th>
        <th class="nw">Du</th><th class="nw">Au</th><th class="r">Jours</th><th>Effet</th><th>Motif</th></tr></thead>
        <tbody>${page.map(l => `<tr data-cg="${esc(l.id)}"${tient ? ' class="clickable" tabindex="0" title="Modifier cette absence"' : ''}>
          <td class="tronq" title="${esc(nomDe(l.employeeId))}">${esc(nomDe(l.employeeId))}</td><td>${esc(l.kindLabel)}</td>
          <td class="nw">${esc(fmtJour(l.from))}</td><td class="nw">${esc(fmtJour(l.to))}</td><td class="r nw">${esc(joursFr(l.days))}</td>
          <td class="nw">${/* 1.235.0 (D1) — une demande que le client n'a pas acceptée ne compte nulle part (congeRetenu) : elle ne se dit pas « payée ». */''}${!l.retenu ? `<span class="muted">${l.statut === 'refuse' ? 'refusée' : 'demandée, pas encore acceptée'}</span>` : l.paid ? '<span class="ok-text">payée</span>' : '<span class="warn-text">retirée du salaire</span>'}</td>
          <td class="tronq" title="${esc(l.note || '')}">${esc(l.note || '')}</td></tr>`).join('')}</tbody></table></div>${pied}`
    : `<div class="empty mini">Aucun congé ni absence en ${esc(annee)}.</div>`}
    </div>`;
  }
  function brancherConges(el, root, dossier) {
    const panneau = $('#cg-panneau', el);
    if (!panneau) return;
    const L = livresState.livre;
    const regler = $('#cg-droit-regler', panneau);
    if (regler) regler.onclick = () => regimesForm(root, dossier, { focus: 'leaveDaysPerYear' });
    const ajouter = $('#cg-ajouter', panneau);
    if (ajouter) ajouter.onclick = () => congeForm(root, dossier, null);
    bindPager(panneau, () => drawLivres(root, dossier), congesState);
    if (!congesTenus(L)) return;
    $$('#cg-liste tr[data-cg]', panneau).forEach(tr => {
      const ouvrir = () => { const c = (L.conges || []).find(x => x.id === tr.dataset.cg); if (c) congeForm(root, dossier, c); };
      tr.onclick = ouvrir;
      tr.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrir(); } };
    });
  }
  // La fenêtre d'un congé ou d'une absence (celle de l'entreprise, leaveForm) : le salarié, la nature, l'effet sur le
  // salaire, du … au …, le motif ; les jours ouvrables qu'elle compte, ce qu'elle fait au salaire et, pour un congé payé, le
  // solde avant et après, se lisent AVANT d'enregistrer.
  function congeForm(root, dossier, conge) {
    const s = livresState, L = s.livre;
    const salaries = (L.salaries || []).filter(x => x.actif || (conge && x.id === conge.employeeId))
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
    if (!salaries.length) return toast('Déclare d\'abord un salarié.', 'error');
    // Un congé nouveau tombe dans le mois regardé : aujourd'hui s'il en est, sinon son premier jour — jamais avant l'entrée
    // du salarié (vu au test humain : le 1er septembre proposé pour une entrée le 15).
    const mois = `${s.annee}-${String(s.paieMois || 1).padStart(2, '0')}`;
    const auMois = String(K.today()).slice(0, 7) === mois ? K.today() : `${mois}-01`;
    const jour = salaries[0].embauche && salaries[0].embauche > auMois ? salaries[0].embauche : auMois;
    const c = conge || { id: '', employeeId: salaries[0].id, kind: 'conges', from: jour, to: jour, paid: null, note: '' };
    // Hors du contrat, une absence ne se pose sur aucun pointage ni aucun bulletin, mais entamerait le compteur : elle se dit
    // dans l'annonce, et se refuse.
    const horsContrat = v => {
      const x = salaries.find(y => y.id === v.employeeId) || {};
      return x.embauche && v.from && v.from < x.embauche ? { champ: 'from', motif: `L'entrée de ${x.nom} est le ${fmtJour(x.embauche)} : une absence ne commence pas avant.` }
        : x.sortie && v.to && v.to > x.sortie ? { champ: 'to', motif: `La sortie de ${x.nom} est le ${fmtJour(x.sortie)} : une absence ne finit pas après.` } : null;
    };
    modal(`<h2>${conge ? 'Modifier l\'absence' : 'Congé ou absence'}</h2>
      <form id="cg-form" class="grid-2">
        <label class="field span-2 obligatoire">${lbl('Salarié', 'pa.cgSalarie')}<select name="employeeId">${salaries.map(x => `<option value="${esc(x.id)}" ${x.id === c.employeeId ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Nature', 'pa.cgNature')}<select name="kind">${KC.LEAVE_KINDS.map(([v, lab, payee]) => `<option value="${v}" ${c.kind === v ? 'selected' : ''}>${esc(lab)}${payee ? '' : ' (non payée)'}</option>`).join('')}</select></label>
        <label class="field">${lbl('Effet sur le salaire', 'pa.cgEffet')}<select name="paid">
          <option value="">selon la nature</option><option value="1" ${c.paid === true ? 'selected' : ''}>payée</option><option value="0" ${c.paid === false ? 'selected' : ''}>non payée</option></select></label>
        <label class="field obligatoire">${lbl('Du', 'pa.cgDates')}<input name="from" placeholder="JJ/MM/AAAA" value="${esc(fmtJour(c.from))}"></label>
        <label class="field obligatoire">${lbl('Au', 'pa.cgDates')}<input name="to" placeholder="JJ/MM/AAAA" value="${esc(fmtJour(c.to))}"></label>
        <label class="field span-2">${lbl('Motif', 'pa.cgMotif')}<input name="note" maxlength="200" value="${esc(c.note || '')}" placeholder="Certificat médical, congé annuel…"></label>
        <div class="span-2 annonce-stable small" id="cg-annonce"></div>
      </form>
      <div class="modal-actions">${conge ? '<button type="button" class="btn btn-danger" id="cg-supprimer" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
    (layer, close) => {
      const f = $('#cg-form', layer);
      const champ = n => $(`[name=${n}]`, f);
      const lire = () => ({ employeeId: champ('employeeId').value, kind: champ('kind').value, paid: champ('paid').value,
        from: K.dateTapee(champ('from').value.trim(), s.annee), to: K.dateTapee(champ('to').value.trim(), s.annee), note: champ('note').value.trim() });
      const annoncer = () => {
        const v = lire();
        const a = $('#cg-annonce', layer);
        if (!v.from || !v.to || v.to < v.from) { a.innerHTML = '<span class="muted">Le premier et le dernier jour de l\'absence, compris.</span>'; return; }
        const data = donneesDuPointage(dossier, L);
        const jours = KC.workingDays(v.from, v.to, data.payrollSettings.offDays);
        const payee = v.paid === '' ? KC.leaveIsPaid(v.kind) : v.paid === '1';
        let solde = '';
        if (v.kind === 'conges') {
          // Une absence déjà comptée l'est dans le solde du moteur : « avant » la lui rend, sinon elle se retrancherait deux fois.
          const b = KC.leaveBalance(data, v.employeeId, Number(v.from.slice(0, 4)));
          const deja = conge && conge.kind === 'conges' && conge.employeeId === v.employeeId && String(conge.from).slice(0, 4) === v.from.slice(0, 4)
            ? KC.workingDays(conge.from, conge.to, data.payrollSettings.offDays) : 0;
          const avant = KC.round3(b.remaining + deja), apres = KC.round3(avant - jours);
          solde = ` Solde de congés : <b>${esc(joursCg(avant))}</b> avant, <b>${esc(joursCg(apres))}</b> après.${apres < 0
            ? ` <span class="warn-text">Il prendrait ${esc(joursCg(-apres))} de plus qu'il n'en a acquis : ce n'est pas interdit, mais il faut le savoir.</span>` : ''}`;
        }
        const hors = horsContrat(v);
        a.innerHTML = hors ? `<span class="warn-text">${esc(hors.motif)}</span>`
          : `<span class="${jours ? 'muted' : 'warn-text'}">${jours ? `<b>${esc(joursCg(jours))} ouvrable${jours > 1 ? 's' : ''}</b>, dimanches exclus. `
          : 'Aucun jour ouvrable dans cette période : vérifie les dates. '}${payee ? 'Payée : le salaire du mois n\'est pas réduit.'
          : 'Non payée : le brut d\'un bulletin établi ensuite est réduit au prorata.'}${solde}</span>`;
      };
      f.oninput = f.onchange = annoncer; annoncer();
      $('#ok', layer).onclick = async () => {
        const v = lire();
        if (!v.employeeId) return refus(champ('employeeId'), 'Choisis le salarié.');
        if (!champ('from').value.trim()) return refus(champ('from'), 'Indique le premier jour de l\'absence.');
        if (!v.from) return refus(champ('from'), `« ${champ('from').value.trim()} » n'est pas une date lisible. Écris-la JJ/MM/AAAA.`);
        if (!champ('to').value.trim()) return refus(champ('to'), 'Indique le dernier jour de l\'absence.');
        if (!v.to) return refus(champ('to'), `« ${champ('to').value.trim()} » n'est pas une date lisible. Écris-la JJ/MM/AAAA.`);
        if (v.to < v.from) return refus(champ('to'), `La fin ne peut pas précéder le début (${fmtJour(v.from)}).`);
        const hors = horsContrat(v);
        if (hors) return refus(champ(hors.champ), hors.motif);
        const ok = $('#ok', layer);
        ok.disabled = true;
        try {
          const id = conge ? conge.id : 'cg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          const r = await api.saveConge({ dossierId: dossier.id, conge: { id, employeeId: v.employeeId, kind: v.kind, from: v.from, to: v.to,
            paid: v.paid === '' ? null : v.paid === '1', note: v.note } });
          L.conges = r.conges;
          close();
          toast(`L'absence de ${((L.salaries || []).find(x => x.id === v.employeeId) || {}).nom || ''} est enregistrée.`);
          drawLivres(root, dossier);
        } catch (err) { ok.disabled = false; toast(plainError(err), 'error'); }
      };
      const sup = $('#cg-supprimer', layer);
      if (sup) sup.onclick = async () => {
        if (!await confirmDialog('Supprimer cette absence ?', 'Elle se retire du pointage. Un bulletin déjà établi ne change pas de lui-même : le pointage dira s\'il ne le suit plus.', 'Supprimer', true)) return;
        try {
          const r = await api.supprimerConge({ dossierId: dossier.id, id: conge.id });
          L.conges = r.conges;
          close(); toast('Absence supprimée.'); drawLivres(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }

  // (plateforme) 1.71.0 — les avances sur salaire d'un dossier : celles de l'entreprise (5.1.0), par son moteur (compta.js).
  // Une somme prêtée au salarié, remboursée par retenues sur ses bulletins ; ce qui est remboursé se lit sur les bulletins
  // eux-mêmes (leurs retenues marquées du numéro de l'avance), de toutes les années. Un client sur SkanFact les saisit dans
  // son SkanFact : le Cabinet les lit (il n'écrit jamais chez un client sans son accord), et un bulletin nouveau en retient
  // l'échéance. Pour un dossier tenu, il les saisit, dans la fenêtre de l'entreprise ; le serveur en écrit le versement.
  const avancesState = { page: 1, size: prefs.get('avSize', 25), sizeKey: 'avSize' };
  // Les modes d'un versement au salarié (les clés de l'entreprise) : en espèces, il sort de la caisse ; sinon, de la banque.
  const MODES_AVANCE = [['virement', 'Virement'], ['cheque', 'Chèque'], ['especes', 'Espèces']];
  // Qui peut les saisir : le Cabinet, pour un dossier tenu dont l'exercice est ouvert (la règle des congés).
  const avancesTenues = L => !L.reglagesPaie && !(L.exercice || {}).clos;
  function vueAvances(dossier, L, annee) {
    const tient = avancesTenues(L);
    // Celles de l'année regardée (le moteur commun le dit) : versées cette année-là, ou avant et pas soldées à son début.
    const toutes = KC.avancesDeLAnnee(donneesDuPointage(dossier, L), annee);
    const enCours = toutes.filter(a => !a.done);
    const nomDe = id => ((L.salaries || []).find(x => x.id === id) || {}).nom || '—';
    const modeDe = m => (MODES_AVANCE.find(x => x[0] === m) || [, m || '—'])[1];
    const pied = pagerBar(toutes.length, avancesState, 'avance');
    const page = paginate(toutes, avancesState);
    return `<div class="panel mt" id="av-panneau"><h2>Les avances sur salaire de ${esc(annee)} ${info('pa.avances')}</h2>
      <div class="filters">${tient && (L.salaries || []).some(x => x.actif) ? '<button type="button" class="btn btn-sm" id="av-ajouter">+ Avance sur salaire…</button>' : ''}
        <span class="small muted" id="av-qui">${toutes.length ? `${enCours.length} en cours${enCours.length
    ? ` · <b>${esc(money(KC.round3(enCours.reduce((s2, a) => s2 + a.remaining, 0))))}</b> encore à retenir` : ''}. ` : ''}${L.reglagesPaie
    ? 'Ce client les saisit dans son SkanFact (<b>Paie › Avances</b>) : le Cabinet les lit, et un bulletin nouveau en retient l\'échéance.'
    : (L.exercice || {}).clos ? `L'exercice ${esc(annee)} est clos : ses avances se lisent, elles ne se changent plus.`
      : 'Un bulletin nouveau en retient l\'échéance du mois, jusqu\'à la dernière ; le versement s\'écrit le jour même, à la banque ou à la caisse.'}</span></div>
      ${toutes.length ? `<div class="scroll-x"><table class="list compact" id="av-liste"><thead><tr><th>Salarié</th><th class="nw">Versée le</th><th>Mode</th>
        <th class="r">Avancé</th><th class="r nw">Par mois</th><th class="r">Retenu</th><th class="r">Reste</th><th>Note</th></tr></thead>
        <tbody>${page.map(a => `<tr data-av="${esc(a.id)}"${tient ? ' class="clickable" tabindex="0" title="Modifier cette avance"' : ''}>
          <td class="tronq" title="${esc(nomDe(a.employeeId))}">${esc(nomDe(a.employeeId))}</td><td class="nw">${esc(fmtJour(a.date))}</td><td class="nw">${esc(modeDe(a.method))}</td>
          <td class="r nw">${esc(money(a.amount))}</td><td class="r nw">${esc(money(a.monthly))}</td><td class="r nw">${esc(money(a.repaid))}</td>
          <td class="r nw">${a.done ? '<span class="ok-text">soldée</span>' : `<b>${esc(money(a.remaining))}</b>`}</td>
          <td class="tronq" title="${esc(a.note || '')}">${esc(a.note || '')}</td></tr>`).join('')}</tbody></table></div>${pied}`
    : `<div class="empty mini">Aucune avance en ${esc(annee)}.</div>`}
      ${enCours.length ? `<h3 class="mt">L'échéancier</h3><ul class="cp-pa-echeancier" id="av-echeancier">${enCours.map(a => {
    const { faites, prevues } = echeancierAvance(L, a);
    const lab = (x) => `${KC.moisPaie(x.m)}${x.y !== Number(annee) ? ` ${x.y}` : ''}`;
    return `<li data-av-ech="${esc(a.id)}"><b>${esc(nomDe(a.employeeId))}</b> · ${esc(money(a.amount))} versés le ${esc(fmtJour(a.date))} · ${esc(money(a.monthly))} par mois<span class="cp-pa-ech">${[
      ...faites.map(x => `<span class="fait">${esc(lab(x))} · ${esc(money(x.montant))} retenu</span>`),
      ...prevues.map(x => x.oubli ? `<span class="oubli" title="Son bulletin est fait, sans cette retenue">${esc(lab(x))} · ${esc(money(x.montant))} pas retenu</span>` : `<span>${esc(lab(x))} · ${esc(money(x.montant))}</span>`)].join('')}</span></li>`;
  }).join('')}</ul>` : ''}
    </div>`;
  }
  function brancherAvances(el, root, dossier) {
    const panneau = $('#av-panneau', el);
    if (!panneau) return;
    const L = livresState.livre;
    const ajouter = $('#av-ajouter', panneau);
    if (ajouter) ajouter.onclick = () => avanceForm(root, dossier, null);
    bindPager(panneau, () => drawLivres(root, dossier), avancesState);
    if (!avancesTenues(L)) return;
    $$('#av-liste tr[data-av]', panneau).forEach(tr => {
      const ouvrir = () => { const a = (L.avances || []).find(x => x.id === tr.dataset.av); if (a) avanceForm(root, dossier, a); };
      tr.onclick = ouvrir;
      tr.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrir(); } };
    });
  }
  // La fenêtre d'une avance (celle de l'entreprise, advanceForm) : le salarié, le jour du versement, le montant, la retenue de
  // chaque mois, le mode, la note ; la durée du remboursement et la part du net habituel se lisent AVANT d'enregistrer.
  function avanceForm(root, dossier, avance) {
    const s = livresState, L = s.livre;
    const salaries = (L.salaries || []).filter(x => x.actif || (avance && x.id === avance.employeeId))
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
    if (!salaries.length) return toast('Déclare d\'abord un salarié.', 'error');
    // Ce qui a déjà été retenu sur des bulletins : une avance ne descend pas en dessous, ni ne change de salarié.
    const deja = avance ? (KC.advancesOf(donneesDuPointage(dossier, L), avance.employeeId).find(x => x.id === avance.id) || { repaid: 0 }).repaid : 0;
    // Une avance nouvelle tombe dans le mois regardé : aujourd'hui s'il en est, sinon son premier jour — jamais avant l'entrée
    // du salarié proposé (vu au test humain : le 1er septembre proposé pour une entrée le 15, comme pour les congés).
    const mois = `${s.annee}-${String(s.paieMois || 1).padStart(2, '0')}`;
    const auMois = String(K.today()).slice(0, 7) === mois ? K.today() : `${mois}-01`;
    const jour = salaries[0].embauche && salaries[0].embauche > auMois ? salaries[0].embauche : auMois;
    const a = avance || { id: '', employeeId: salaries[0].id, date: jour, amount: 0, monthly: 0, method: 'virement', note: '' };
    const modes = MODES_AVANCE.some(m => m[0] === a.method) || !a.method ? MODES_AVANCE : [...MODES_AVANCE, [a.method, a.method]];
    modal(`<h2>${avance ? 'Modifier l\'avance' : 'Avance sur salaire'}</h2>
      <p class="small muted">Une somme prêtée au salarié, remboursée par retenues sur ses prochains bulletins : chaque bulletin nouveau en propose l'échéance, jusqu'à la dernière.</p>
      <form id="av-form" class="grid-2">
        <label class="field span-2 obligatoire">${lbl('Salarié', 'pa.avSalarie')}<select name="employeeId" ${deja ? 'disabled' : ''}>${salaries.map(x => `<option value="${esc(x.id)}" ${x.id === a.employeeId ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>
        <label class="field obligatoire">${lbl('Versée le', 'pa.avDate')}<input name="date" placeholder="JJ/MM/AAAA" value="${esc(fmtJour(a.date))}"></label>
        <label class="field">${lbl('Mode', 'pa.avMode')}<select name="method">${modes.map(([v, lab]) => `<option value="${esc(v)}" ${(a.method || 'virement') === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>
        <label class="field obligatoire">${lbl('Montant avancé (DT)', 'pa.avMontant')}<input name="amount" inputmode="decimal" class="num montant" placeholder="Ce qui lui est prêté" value="${esc(montantChamp(a.amount))}"></label>
        <label class="field obligatoire">${lbl('Retenue mensuelle (DT)', 'pa.avMensuel')}<input name="monthly" inputmode="decimal" class="num montant" placeholder="Retenue sur chaque bulletin" value="${esc(montantChamp(a.monthly))}"></label>
        <label class="field span-2">${lbl('Note', 'pa.avNote')}<input name="note" maxlength="200" value="${esc(a.note || '')}" placeholder="Pourquoi, et ce qui a été convenu"></label>
        <div class="span-2 annonce-stable small" id="av-annonce"></div>
      </form>
      <div class="modal-actions">${avance ? '<button type="button" class="btn btn-danger" id="av-supprimer" style="margin-inline-end:auto">Supprimer</button>' : ''}
        <button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
    (layer, close) => {
      const f = $('#av-form', layer);
      const champ = n => $(`[name=${n}]`, f);
      const lire = () => ({ employeeId: champ('employeeId').value, date: K.dateTapee(champ('date').value.trim(), s.annee),
        amount: lireMontant(champ('amount').value), monthly: lireMontant(champ('monthly').value), method: champ('method').value, note: champ('note').value.trim() });
      const annoncer = () => {
        const v = lire();
        const zone = $('#av-annonce', layer);
        if (!(v.amount > 0) || !(v.monthly > 0)) { zone.innerHTML = '<span class="muted">Le montant et la retenue mensuelle disent la durée du remboursement.</span>'; return; }
        // Sous ce qui a déjà été retenu, le montant se refusera : l'annonce le dit avant (vu au test humain : elle disait
        // l'avance « soldée »).
        if (deja && v.amount < deja - 0.0005) { zone.innerHTML = `<span class="warn-text">Déjà retenu : <b>${esc(money(deja))}</b>. Le montant avancé ne descend pas en dessous.</span>`; return; }
        const sal = salaries.find(x => x.id === v.employeeId) || {};
        // (plateforme, 03/11/2026 — 16 § 10.1, point 10) Le net habituel compte les primes de la fiche, un mois plein : sans elles,
        // une retenue raisonnable se disait « lourde » (le même défaut que la fenêtre de l'entreprise).
        const net = KC.computePayslip({ grossSalary: sal.brut, headOfFamily: sal.chefDeFamille, children: sal.enfants, contrat: sal.contrat }, { bonuses: KC.primesDuMois({ primes: sal.primes }) },
          KC.baremesPaie(reglagesPaie(dossier, L))).net;
        const reste = KC.round3(Math.max(0, v.amount - deja));
        const lourde = net > 0 && v.monthly > net * 0.3;
        // Trois lignes au plus, la place que l'annonce garde : plus longue, elle poussait « Enregistrer » sous le curseur (vu au
        // test humain).
        zone.innerHTML = `<span class="${lourde ? 'warn-text' : 'muted'}">${deja ? `Déjà retenu : <b>${esc(money(deja))}</b> ; reste ${esc(money(reste))}. ` : ''}`
          + (deja && !reste ? 'Elle est soldée.' : `Remboursée en <b>${Math.ceil((deja ? reste : v.amount) / v.monthly)} mois</b> à ${esc(money(v.monthly))} par bulletin`
            + (net > 0 ? ` — ${esc(joursFr(Math.round(v.monthly / net * 1000) / 10))} % du net habituel de ${esc(sal.nom || 'ce salarié')} (${esc(money(net))}).` : '.'))
          + (lourde ? ' C\'est lourd pour le salarié. <em>À VÉRIFIER : la part du salaire qui peut être retenue.</em>' : '') + '</span>';
      };
      f.oninput = f.onchange = annoncer; annoncer();
      $('#ok', layer).onclick = async () => {
        const v = lire();
        const sal = salaries.find(x => x.id === v.employeeId);
        if (!sal) return refus(champ('employeeId'), 'Choisis le salarié.');
        if (!champ('date').value.trim()) return refus(champ('date'), 'Indique le jour où l\'argent a été remis.');
        if (!v.date) return refus(champ('date'), `« ${champ('date').value.trim()} » n'est pas une date lisible. Écris-la JJ/MM/AAAA.`);
        if (v.date.slice(0, 4) !== String(s.annee)) return refus(champ('date'), `Une avance se saisit dans l'année regardée (${s.annee}) : pour une avance de ${v.date.slice(0, 4)}, change d'année en haut de la page.`);
        if (sal.sortie && v.date > sal.sortie) return refus(champ('date'), `La sortie de ${sal.nom} est le ${fmtJour(sal.sortie)} : aucun bulletin ne retiendrait une avance versée après.`);
        const illisible = ['amount', 'monthly'].map(champ).find(el => montantIllisible(el.value));
        if (illisible) return refus(illisible, motifIllisible(illisible.value));
        if (!(v.amount > 0)) return refus(champ('amount'), 'Indique le montant avancé.');
        if (!(v.monthly > 0)) return refus(champ('monthly'), 'Indique la retenue mensuelle : c\'est elle qui rembourse l\'avance, bulletin après bulletin.');
        if (v.amount < deja - 0.0005) return refus(champ('amount'), `${money(deja)} ont déjà été retenus sur des bulletins : le montant avancé ne descend pas en dessous.`);
        const ok = $('#ok', layer);
        ok.disabled = true;
        try {
          const id = avance ? avance.id : 'av' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          // Le livre de l'année revient avec : le versement s'écrit (ou change de journal), et le brouillard le compte.
          const r = await api.saveAvance({ dossierId: dossier.id, annee: s.annee, avance: { id, employeeId: v.employeeId, date: v.date,
            amount: KC.round3(v.amount), monthly: KC.round3(v.monthly), method: v.method, note: v.note } });
          s.livre = r.livre;
          close();
          toast(`L'avance de ${sal.nom} est enregistrée.`);
          drawLivres(root, dossier);
        } catch (err) { ok.disabled = false; toast(plainError(err), 'error'); }
      };
      const sup = $('#av-supprimer', layer);
      if (sup) sup.onclick = async () => {
        if (!await confirmDialog('Supprimer cette avance ?', deja
          ? `${money(deja)} ont déjà été retenus sur des bulletins : ces retenues y restent, et son versement se retire des écritures.`
          : 'Son versement se retire des écritures ; aucun bulletin ne l\'a encore retenue.', 'Supprimer', true)) return;
        try {
          const r = await api.supprimerAvance({ dossierId: dossier.id, annee: s.annee, id: avance.id });
          s.livre = r.livre;
          close(); toast('Avance supprimée.'); drawLivres(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }

  // (plateforme) 1.72.0 — les documents du personnel d'un dossier (ceux de l'entreprise, 5.1.0) : l'attestation de travail,
  // le certificat de travail, le solde de tout compte, imprimés par le moteur des documents de l'entreprise (core.js,
  // `hrDocumentHtml`) sur la paie du dossier. L'employeur : la fiche du dossier (son nom, son matricule fiscal, son adresse,
  // son gérant, son numéro d'employeur à la CNSS). Ce qui manquerait au document — le gérant qui signe, la civilité du
  // salarié, sa sortie — se dit avant d'imprimer, avec le geste qui le renseigne. Le solde propose les lignes de l'entreprise
  // (compta.js, `lignesDuSolde`) : l'indemnité de congés non pris y est celle que le document imprime. Rouverte après une
  // fiche renseignée, elle reprend le document qu'on avait choisi (`kindDemande`).
  function documentPersonnelForm(root, dossier, x, kindDemande) {
    const s = livresState, L = s.livre;
    const data = { ...api.paieDuDossierV10(dossier.id), payrollSettings: reglagesPaie(dossier, L) };
    const e = (data.employees || []).find(y => y.id === x.id);
    if (!e) return toast('Ce salarié n\'est plus dans la paie du dossier : recharge la page.', 'error');
    const jour = K.today();
    const lignes = KC.lignesDuSolde(data, e.id, jour);
    const ic = KC.indemniteConges(data, e.id, jour);
    const resteAvances = KC.round3(KC.advancesOf(data, e.id).filter(a => !a.done).reduce((t, a) => t + a.remaining, 0));
    modal(`<h2>Document pour ${esc(x.nom)}</h2>
      <form id="dp-form" class="grid-2">
        <label class="field span-2">${lbl('Document', 'pa.docType')}<select name="kind">${KC.HR_DOCS.map(([v, lab]) => `<option value="${esc(v)}" ${v === kindDemande ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Daté du', 'pa.docDate')}<input name="date" placeholder="JJ/MM/AAAA" value="${esc(fmtJour(jour))}"></label>
        <label class="check" style="align-self:end" id="dp-salaire"><input type="checkbox" name="withSalary"> Mentionner le salaire ${info('pa.docSalaire')}</label>
      </form>
      <p class="small muted" id="dp-desc"></p>
      ${dossier.gerant ? '' : `<div class="warn-box mb" id="dp-gerant">Le document dira « Je soussigné » <b>sans nom</b> : le gérant de ${esc(dossier.name)} n'est pas sur la fiche du dossier. <button type="button" class="btn btn-sm" id="dp-gerant-go">Renseigner le gérant…</button></div>`}
      ${e.gender ? '' : `<div class="warn-box mb" id="dp-civ">Le document parlera de ${esc(x.nom)} au masculin, sans « Madame » ni « Monsieur » : sa civilité n'est pas renseignée. <button type="button" class="btn btn-sm" id="dp-civ-go">Renseigner sa civilité…</button></div>`}
      <div class="panel" id="dp-solde" hidden><h2>Solde de tout compte (DT)</h2>
        <p class="small muted mb">Ce qui reste dû au salarié à son départ. Les montants sont à toi : SkanFact propose l'indemnité de congés non pris, sur son dernier salaire. <em>À VÉRIFIER : les indemnités dépendent du motif de la rupture et de la convention collective.</em></p>
        <div id="dp-lignes"></div>
        ${ic.solde < 0 ? `<p class="small warn-text mt">Il a pris ${esc(joursFr(-ic.solde))} jour${-ic.solde >= 2 ? 's' : ''} de congé de plus qu'il n'en a acquis : l'indemnité ci-dessus vaut donc zéro. <em>À VÉRIFIER avec le client : ces jours peuvent se retenir sur le solde.</em></p>` : ''}
        ${resteAvances > 0 ? `<p class="small mt" id="dp-avances">Il reste <b>${esc(money(resteAvances))}</b> à rembourser sur ses avances. Ce document ne les retient pas : un bulletin les rembourse, et ce qu'il ne peut pas retenir se règle avec lui. <em>À VÉRIFIER avec le client : ce qui peut se retenir au départ.</em></p>` : ''}
      </div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="ok">Imprimer</button></div>`,
    (layer, close) => {
      const f = $('#dp-form', layer);
      const champ = n => $(`[name=${n}]`, f);
      const total = () => KC.round3(lignes.reduce((t, l) => t + (Number(l.amount) || 0), 0));
      // Le tableau ne se redessine qu'à l'ajout ou au retrait d'une ligne : pendant la frappe, seule la donnée change (le
      // curseur reste dans sa case, 7.17.0).
      const dessinerLignes = () => {
        const zone = $('#dp-lignes', layer);
        zone.innerHTML = `<table class="lines-edit"><tbody>${lignes.map((l, i) => `<tr data-i="${i}">
            <td><input type="text" data-dl="label" value="${esc(l.label || '')}" aria-label="Ligne ${i + 1} : libellé"></td>
            <td style="width:130px"><input type="text" inputmode="decimal" class="num montant" data-dl="amount" placeholder="0,000" value="${esc(montantChamp(l.amount))}" aria-label="Ligne ${i + 1} : montant (DT)"></td>
            <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-dlx="${i}" aria-label="Retirer la ligne ${i + 1}" title="Retirer cette ligne">✕</button></td></tr>`).join('')}</tbody></table>
          <div class="inline mt"><button type="button" class="btn btn-sm" id="dp-plus">+ Ligne</button>
            <span class="small muted">Net à percevoir : <b id="dp-total">${esc(money(total()))}</b></span></div>`;
        $$('[data-dl]', zone).forEach(el => { el.oninput = () => {
          const l = lignes[Number(el.closest('tr').dataset.i)];
          if (el.dataset.dl === 'amount') l.amount = lireMontant(el.value); else l.label = el.value;
          l.touche = true;
          $('#dp-total', layer).textContent = money(total());
        }; });
        $$('[data-dlx]', zone).forEach(b => { b.onclick = () => { lignes.splice(Number(b.dataset.dlx), 1); dessinerLignes(); }; });
        $('#dp-plus', layer).onclick = () => {
          lignes.push({ label: '', amount: 0 });
          dessinerLignes();
          const l = $$('#dp-lignes [data-dl=label]', layer).pop(); if (l) l.focus();
        };
      };
      let dateVue = jour;
      const sync = () => {
        const kind = champ('kind').value;
        const desc = (KC.HR_DOCS.find(d => d[0] === kind) || [])[2] || '';
        $('#dp-solde', layer).hidden = kind !== 'solde';
        $('#dp-salaire', layer).style.display = kind === 'attestation' ? '' : 'none';
        $('#dp-desc', layer).innerHTML = esc(desc) + (kind !== 'attestation' && !x.sortie
          ? ` <span class="warn-text">${esc(x.nom)} n'a pas de date de sortie : le document portera la date du jour.</span> <button type="button" class="btn btn-sm" id="dp-sortie-go">Renseigner sa sortie…</button>` : '');
        // Avec le geste qui la renseigne, comme le gérant et la civilité (vu à l'essai humain : la seule des trois sans bouton).
        const sortie = $('#dp-sortie-go', layer);
        if (sortie) sortie.onclick = () => ficheDuSalarie('sortie');
        // Sans date de sortie, la date du document arrête le compte des congés : la ligne proposée la suit (celle que le
        // document imprimera), tant qu'on n'y a pas touché.
        const iso = K.dateTapee(champ('date').value.trim(), s.annee);
        if (iso && iso !== dateVue) {
          dateVue = iso;
          const l = lignes.find(y => y.cle === 'conges' && !y.touche), n = KC.lignesDuSolde(data, e.id, iso).find(y => y.cle === 'conges');
          if (l && n) { Object.assign(l, { label: n.label, amount: n.amount }); dessinerLignes(); }
        }
      };
      dessinerLignes(); sync();
      f.onchange = sync;
      // La fiche du salarié s'ouvre sur la case qui manque ; enregistrée, le document se rouvre, sur le même document.
      const ficheDuSalarie = focus => {
        const kind = champ('kind').value;
        close();
        salarieForm(root, dossier, x, { focus, apres: livre => {
          const y = (livre.salaries || []).find(z => z.id === x.id);
          if (y) documentPersonnelForm(root, dossier, y, kind);
        } });
      };
      const gerant = $('#dp-gerant-go', layer);
      if (gerant) gerant.onclick = () => {
        const kind = champ('kind').value;
        close();
        // La fiche du dossier s'ouvre sur la case ; enregistrée, le document se rouvre, sur la fiche relue (vu à l'essai
        // humain : il fallait repasser par le menu, quand la civilité, elle, y revenait).
        dossierForm(dossier, { focus: '#f-gerant', apres: () => {
          const d = (S.dossiers || []).find(y => y.id === dossier.id);
          if (d) documentPersonnelForm(root, d, x, kind);
        } });
      };
      const civ = $('#dp-civ-go', layer);
      if (civ) civ.onclick = () => ficheDuSalarie('genre');
      $('#ok', layer).onclick = () => {
        const kind = champ('kind').value;
        const t = champ('date').value.trim();
        const date = K.dateTapee(t, s.annee);
        if (!date) return refus(champ('date'), t ? `« ${t} » n'est pas une date lisible. Écris-la JJ/MM/AAAA.` : 'Indique la date du document.');
        const gardees = [];
        if (kind === 'solde') {
          // Un montant illisible ne passe pas jusqu'ici : la porte de toutes les fenêtres le refuse sur sa case (10.14.1).
          for (let i = 0; i < lignes.length; i++) {
            const l = lignes[i], label = String(l.label || '').trim();
            if (!label && !Number(l.amount)) continue;
            if (!label) return refus($(`#dp-lignes tr[data-i="${i}"] [data-dl=label]`, layer), 'Cette ligne a un montant sans libellé : dis ce qu\'il paie, ou retire la ligne.');
            gardees.push({ label, amount: KC.round3(Number(l.amount) || 0) });
          }
        }
        const opts = { date, withSalary: kind === 'attestation' && champ('withSalary').checked, lines: gardees };
        imprimerDocumentPaie(dossier, (C, d, so) => {
          const sal = (d.employees || []).find(y => y.id === e.id);
          if (!sal) throw new Error('Ce salarié n\'est plus dans la paie du dossier : recharge la page.');
          return C.hrDocumentHtml(kind, sal, d, so, opts);
        }, () => `${nomDeFichier(KC.hrDocLabel(kind))}_${nomDeFichier(e.name)}`);
        close();
      };
    });
  }

  // Le détail d'un bulletin, tel qu'il a été FIGÉ. Un chiffre qu'on ne peut pas ouvrir se croit ou
  // ne se croit pas ; celui-ci s'ouvre, ligne par ligne, avec les taux qui ont servi.
  function detailBulletin(b) {
    const c = b.calcul || {};
    const r = c.rates || {};
    const L = livresState.livre;
    const nom = ((L.salaries || []).find(x => x.id === b.salarieId) || {}).nom || '';
    const ligne = (lab, val, sub) => `<tr><td>${esc(lab)}${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</td><td class="r nw">${esc(money(val))}</td></tr>`;
    modal(`<h2>${esc(nom)} — ${esc(KC.moisPaie(b.mois))} ${esc(b.annee)}</h2>
      <table class="list compact"><tbody>
        ${ligne('Brut de base', c.baseGross)}
        ${c.absenceCut ? ligne('Absence non rémunérée', -c.absenceCut, `${pl(c.absentDays, 'jour')} sur ${c.workedDays}`) : ''}
        ${(c.bonuses || []).map(p => ligne(p.label, p.amount, p.taxable ? 'imposable' : 'non imposable')).join('')}
        <tr class="dc-total"><td><b>Brut du mois</b></td><td class="r nw"><b>${esc(money(c.gross))}</b></td></tr>
        ${ligne('CNSS part salarié', -c.cnssEmployee, `${taux(r.cnssEmployee)}\u00a0% de ${money(c.cnssBase)}`)}
        ${ligne('IRPP', -c.irpp, `barème annuel sur ${money(c.annualTaxable)} imposables`)}
        ${ligne('Contribution sociale de solidarité', -c.css, `${taux(r.solidarity)}\u00a0%`)}
        ${(c.deductions || []).map(d => ligne(d.label, -d.amount)).join('')}
        <tr class="dc-total"><td><b>Net à payer</b></td><td class="r nw"><b>${esc(money(c.net))}</b></td></tr>
        ${ligne('CNSS part employeur', c.cnssEmployer, `${taux(r.cnssEmployer)}\u00a0%`)}
        ${ligne('Accident du travail', c.accident, `${taux(r.accidentRate)}\u00a0%`)}
        ${ligne('TFP', c.tfp, `${taux(r.tfpRate)}\u00a0%`)}
        ${ligne('FOPROLOS', c.foprolos, `${taux(r.foprolosRate)}\u00a0%`)}
        <tr class="dc-total"><td><b>Coût employeur</b></td><td class="r nw"><b>${esc(money(c.employerCost))}</b></td></tr>
      </tbody></table>
      <p class="small muted mt">Les taux affichés sont ceux qui ont servi le jour où ce bulletin a été établi : ils sont
      figés avec lui. <b>À VÉRIFIER</b> — les barèmes changent à chaque loi de finances.</p>
      <div class="modal-actions"><button class="btn btn-primary" data-close>Fermer</button></div>`);
  }

  // 10.15.0 (H4) — les contrats aux règles particulières (CIVP, Karama, saisonnier). Le panneau DIT
  // ce qui s'écarte du barème : un bulletin de CIVP sans CNSS employeur, sans la ligne qui l'explique,
  // se lit comme une erreur de calcul. Aucune règle n'est écrite d'avance (9.1.1) : la table part vide.
  // (plateforme) 1.66.0 — les taux de la paie propres à l'ENTREPRISE (l'accident du travail selon son activité, la TFP,
  // le FOPROLOS), à côté des taux d'un contrat : sans eux, chaque bulletin que le Cabinet établissait prenait ceux du
  // barème par défaut. Une case vide suit le barème ; aucun taux n'est écrit d'avance pour un client (9.1.1).
  const TAUX_DU_CLIENT = [['accidentRate', 'Accident du travail', 'pa.accident'], ['tfpRate', 'TFP', 'pa.tfp'], ['foprolosRate', 'FOPROLOS', 'pa.foprolos']];
  const tauxDuClient = (paie) => TAUX_DU_CLIENT.filter(([k]) => Number.isFinite(Number((paie || {})[k])) && (paie || {})[k] !== '' && (paie || {})[k] != null)
    .map(([k, lab]) => `${lab} ${String(Number(paie[k])).replace('.', ',')} %`);
  // (plateforme) 1.67.0 — les réglages de la paie d'un dossier : ceux du SkanFact du client qui y tient sa paie (lus avec
  // elle, posés dans le livre), sinon ceux que le Cabinet règle dans sa fiche (un dossier tenu).
  const reglagesPaie = (dossier, L) => (L && L.reglagesPaie) || dossier.paie || {};
  // (plateforme) 1.69.0 — la paie du dossier dans la forme de l'entreprise, celle que lit le pointage du moteur commun : les
  // salariés (leur entrée, leur sortie, leur brut, leurs primes de chaque mois), les congés du client sur SkanFact, le
  // pointage, les réglages de la paie. Le pointage est le tableau du livre lui-même : ce que la grille pose s'y écrit.
  const donneesDuPointage = (dossier, L) => {
    if (!Array.isArray(L.pointages)) L.pointages = [];
    return {
      employees: (L.salaries || []).map(x => ({ id: x.id, name: x.nom, hireDate: x.embauche || '', endDate: x.sortie || '', grossSalary: x.brut, primes: x.primes || [] })),
      leaves: L.conges || [], timesheets: L.pointages, payrollSettings: reglagesPaie(dossier, L),
      // (plateforme) 1.71.0 — les avances, et les retenues de TOUS les bulletins du dossier qui les remboursent (une avance
      // d'une année se retient souvent sur la suivante) : le moteur commun en tire ce qui reste, et l'échéance du mois.
      advances: L.avances || [], payslips: L.remboursements || []
    };
  };
  // Un bulletin du Cabinet dans la forme de l'entreprise, que le pointage compare et reprend.
  const bulletinPourLePointage = b => ({ id: b.id, employeeId: b.salarieId, year: Number(b.annee), month: Number(b.mois),
    workedDays: b.joursTravailles, absentDays: b.joursAbsence, bonuses: b.primes || [], prorata: b.prorata || null });
  // Les enregistrements du pointage, l'un après l'autre : une case pointée juste après l'autre s'écrit dans la bonne révision.
  let pointageEnCours = Promise.resolve();
  function regimesDuDossier(dossier, L) {
    // (plateforme) 1.67.0 — les taux du SkanFact du client, s'il y tient sa paie : le Cabinet les lit sans les changer.
    const bar = reglagesPaie(dossier, L);
    const duClient = !!(L && L.reglagesPaie);
    const actifs = KC.CONTRACT_TYPES.filter(([k]) => k !== 'cdi')
      .map(([k, lab]) => ({ nom: lab.split(' —')[0], r: KC.regimeDuContrat(bar, k) }))
      .filter(x => Object.keys(x.r).length);
    const propres = tauxDuClient(bar);
    const morceaux = [...(propres.length ? [`<b>Ce client</b> : ${esc(propres.join(', '))}`] : []),
      ...actifs.map(x => `<b>${esc(x.nom)}</b> : ${esc(KC.libelleRegime(x.r))}`)];
    return `<div class="small mb ctrl-geste" id="pa-regimes-bloc"><span>${duClient ? '<b>Réglés dans son SkanFact</b> — ' : ''}${morceaux.length
      ? morceaux.join(' · ')
      : 'Tous les contrats suivent le barème général.'} ${info('pa.regimes')}</span>
      <button type="button" class="btn btn-sm" id="pa-regimes">${duClient ? 'Voir les taux de la paie…' : 'Taux de la paie…'}</button></div>`;
  }

  // (plateforme) 1.67.0 — les taux de la paie d'un client qui la tient dans son SkanFact, en lecture : les siens, ceux du
  // barème général, ses taux par contrat. Le Cabinet ne les change pas (il n'écrit jamais chez un client sans son accord,
  // et le mandat de paie ouvre ses salariés et ses bulletins, pas ses réglages) : la fenêtre dit où il les règle.
  function tauxDuSkanFactDuClient(reglages) {
    const bar = KC.baremesPaie(reglages || {});
    const pct = n => String(Number(n)).replace('.', ',');
    const contrats = KC.CONTRACT_TYPES.filter(([k]) => k !== 'cdi')
      .map(([k, lab]) => ({ nom: lab.split(' —')[0], r: KC.regimeDuContrat(bar, k) }))
      .filter(x => Object.keys(x.r).length);
    modal(`<h2>Les taux de la paie de ce client</h2>
      <p class="small">Ce client tient sa paie dans son SkanFact : ses taux sont ceux qu'il y règle (<b>Paie › Barèmes</b>), et
      chaque bulletin que tu établis pour lui les prend. Le Cabinet les lit sans les changer : pour en corriger un, demande-le-lui.</p>
      <table class="list compact" id="rc-lu"><tbody>${KC.REGIME_TAUX.map(([k, lab]) => `<tr><td>${esc((TAUX_DU_CLIENT.find(t => t[0] === k) || [k, lab])[1])}</td>
        <td class="r nw">${esc(pct(bar[k]))} %</td><td class="small muted">${(reglages || {})[k] != null && (reglages || {})[k] !== '' ? 'le sien' : 'le barème général'}</td></tr>`).join('')}</tbody></table>
      <p class="small mt">${contrats.length ? `Ses taux par contrat : ${contrats.map(x => `<b>${esc(x.nom)}</b> : ${esc(KC.libelleRegime(x.r))}`).join(' · ')}.`
    : 'Tous ses contrats suivent ces taux.'}</p>
      ${/* (plateforme) 1.69.0 */''}
      <p class="small mt" id="rc-lu-hs">${KC.majorationsHs(bar).length
    ? `Ses heures supplémentaires : ${esc(pct(bar.heuresMois))} heures pour un mois complet ; majorations ${KC.majorationsHs(bar).map(x => `${esc(pct(x))} %`).join(', ')}.`
    : 'Il n\'a réglé aucune majoration d\'heures supplémentaires : la grille du pointage n\'en a pas de colonne.'}</p>
      ${/* (plateforme) 1.70.0 */''}
      <p class="small mt" id="rc-lu-conges">Son droit annuel aux congés payés : ${esc(pct(bar.leaveDaysPerYear))} jours ouvrables (${(reglages || {}).leaveDaysPerYear != null && (reglages || {}).leaveDaysPerYear !== '' ? 'le sien' : 'celui du barème'}).</p>
      <div class="modal-actions"><button class="btn btn-primary" data-close>Fermer</button></div>`);
  }

  // (plateforme) 1.69.0 — les heures supplémentaires du pointage d'un dossier tenu : les heures d'un mois complet (ce que
  // vaut une heure) et jusqu'à trois majorations. Aucune n'est écrite d'avance (À VÉRIFIER, comme dans l'entreprise).
  const HS_DU_CLIENT = [['heuresMois', 'Heures d\'un mois complet', 'pa.heuresMois'], ['hsMaj1', 'Majoration 1 (%)', 'pa.hs'],
    ['hsMaj2', 'Majoration 2 (%)', 'pa.hs'], ['hsMaj3', 'Majoration 3 (%)', 'pa.hs']];
  function regimesForm(root, dossier, opts) {
    const bar = KC.baremesPaie(dossier.paie || {});
    const pct = n => String(n).replace('.', ',');
    const contrats = KC.CONTRACT_TYPES.filter(([k]) => k !== 'cdi');
    const tauxGeneraux = KC.baremesPaie({});
    modal(`<h2>Taux de la paie</h2>
      <h3>Les taux de ce client</h3>
      <p class="small">Ceux qui dépendent de l'entreprise : l'accident du travail selon son activité (le taux de l'avis de la
      CNSS), la TFP (1 % pour une industrie manufacturière, 2 % sinon), le FOPROLOS. Laisse une case <b>vide</b> pour le taux
      général (en gris). ${dossier.manual
    ? 'Chaque bulletin que tu établis pour ce client les prend ; un bulletin déjà établi garde les siens, et une case de sa fenêtre lui donne ceux-ci.'
    : 'Chaque bulletin que tu établis pour ce client les suit, et les garde une fois établi ; un bulletin que le client a établi dans son SkanFact garde les siens.'}
      <b>À VÉRIFIER</b> sur ses avis et avec les textes de l'année.</p>
      <div class="grid-3" id="rc-client" style="grid-template-columns:repeat(3,minmax(0,170px))">${TAUX_DU_CLIENT.map(([k, lab, aide]) => `<label class="field">${lbl(lab + ' (%)', aide)}<input type="text" inputmode="decimal" class="num" data-taux="${k}"
        value="${(dossier.paie || {})[k] != null && (dossier.paie || {})[k] !== '' ? esc(pct(Number(dossier.paie[k]))) : ''}" placeholder="${esc(pct(tauxGeneraux[k]))}"></label>`).join('')}</div>
      <h3 class="mt">Les heures supplémentaires</h3>
      <p class="small">Pour le pointage de ce client : une heure vaut son brut divisé par les heures d'un mois complet (208 =
      26 jours de 8 heures ; 173,33 pour 40 heures par semaine), majoré. Chaque majoration réglée a sa colonne dans la grille ;
      une case vide n'y paraît pas. <b>À VÉRIFIER</b> : le régime horaire et la convention collective du client.</p>
      <div class="grid-3" id="rc-hs" style="grid-template-columns:minmax(0,210px) repeat(3,minmax(0,150px))">${HS_DU_CLIENT.map(([k, lab, aide]) => `<label class="field">${lbl(lab, aide)}<input type="text" inputmode="decimal" class="num" data-hs-k="${k}"
        value="${(dossier.paie || {})[k] != null && (dossier.paie || {})[k] !== '' && Number((dossier.paie || {})[k]) > 0 ? esc(pct(Number(dossier.paie[k]))) : ''}" placeholder="${k === 'heuresMois' ? '208' : ''}"></label>`).join('')}</div>
      ${/* (plateforme) 1.70.0 */''}
      <h3 class="mt">Les congés payés</h3>
      <p class="small">Le droit de chaque salarié sur une année entière, en jours ouvrables ; il s'acquiert au prorata des mois
      travaillés. Laisse la case <b>vide</b> pour celui du barème (en gris). <b>À VÉRIFIER</b> : la convention collective du
      client, souvent plus favorable que le minimum du Code du travail.</p>
      <div class="grid-3" id="rc-conges" style="grid-template-columns:minmax(0,260px)"><label class="field">${lbl('Congés payés par an (jours ouvrables)', 'pa.congesDroit')}<input type="text" inputmode="decimal" class="num" data-cg-k="leaveDaysPerYear"
        value="${(dossier.paie || {}).leaveDaysPerYear != null && (dossier.paie || {}).leaveDaysPerYear !== '' ? esc(pct(Number(dossier.paie.leaveDaysPerYear))) : ''}" placeholder="${esc(pct(tauxGeneraux.leaveDaysPerYear))}"></label></div>
      <h3 class="mt">Les taux par contrat</h3>
      <p class="small">Laisse une case <b>vide</b> pour appliquer le taux général (en gris) ; mets <b>0</b> pour une exonération.
      Chaque bulletin de ce client pour un salarié sous ce contrat suivra la ligne, et gardera ses taux une fois établi.
      <b>À VÉRIFIER</b> : SkanFact ne connaît aucune de ces exonérations — elles changent d'un dispositif et d'une année à l'autre.</p>
      <div class="scroll-x"><table class="list compact" id="rc-t"><thead><tr><th>Contrat</th>${KC.REGIME_TAUX.map(([, lab]) => `<th class="r nw">${esc(lab)} (%)</th>`).join('')}<th class="nw">Sans IRPP</th></tr></thead>
        <tbody>${contrats.map(([k, lab]) => {
    const r = KC.regimeDuContrat(bar, k);
    const nom = lab.split(' —')[0];
    return `<tr><td class="nw" title="${esc(lab)}">${esc(nom)}</td>${KC.REGIME_TAUX.map(([t, tl]) => `<td class="r"><input type="text" inputmode="decimal" class="num" data-rc="${k}" data-k="${t}" value="${r[t] != null ? esc(pct(r[t])) : ''}" placeholder="${esc(pct(bar[t]))}" style="width:72px" aria-label="${esc(nom)} : ${esc(tl)} (%)"></td>`).join('')}
          <td><input type="checkbox" data-rc-irpp="${k}" ${r.sansIrpp ? 'checked' : ''} aria-label="${esc(nom)} : sans IRPP"></td></tr>`;
  }).join('')}</tbody></table></div>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
    (layer, close) => {
      $('.modal', layer).classList.add('cab-large');
      // (plateforme) 1.69.0 — ouverte depuis la grille du pointage, elle amène à la case des majorations ; (1.70.0) depuis les
      // congés, à celle du droit annuel.
      if (opts && opts.focus) { const c = $(`[data-hs-k="${opts.focus}"], [data-cg-k="${opts.focus}"]`, layer); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } }
      // (plateforme) 1.66.0 — un taux du client change le taux général d'un contrat : la case grise le suit.
      $$('[data-taux]', layer).forEach(i => { i.oninput = () => {
        const n = Number(i.value.trim().replace(/\s/g, '').replace(',', '.'));
        const gris = i.value.trim() && Number.isFinite(n) ? n : tauxGeneraux[i.dataset.taux];
        $$(`[data-rc][data-k="${i.dataset.taux}"]`, layer).forEach(c => { c.placeholder = pct(gris); });
      }; });
      $('#ok', layer).onclick = async () => {
        const taux = {};
        for (const i of $$('[data-taux]', layer)) {
          const t = i.value.trim();
          if (!t) continue;
          const n = Number(t.replace(/\s/g, '').replace(',', '.'));
          if (!Number.isFinite(n) || n < 0 || n > 100) return refus(i, `« ${t} » n'est pas un taux entre 0 et 100. Laisse la case vide pour le taux général.`);
          if (Math.round(n * 1e4) / 1e4 !== n) return refus(i, `« ${t} » : un taux se garde avec quatre décimales au plus.`);
          taux[i.dataset.taux] = n;
        }
        // (plateforme) 1.69.0 — les heures d'un mois complet (de 1 à 400, deux décimales au plus) et les majorations (%).
        for (const i of $$('[data-hs-k]', layer)) {
          const t = i.value.trim();
          if (!t) continue;
          const n = Number(t.replace(/\s/g, '').replace(',', '.'));
          if (i.dataset.hsK === 'heuresMois') {
            if (!Number.isFinite(n) || n < 1 || n > 400 || Math.round(n * 100) / 100 !== n) return refus(i, `« ${t} » n'est pas un nombre d'heures entre 1 et 400 (deux décimales au plus) : 208, ou 173,33. Laisse la case vide pour 208.`);
          } else {
            if (!Number.isFinite(n) || n < 0 || n > 100) return refus(i, `« ${t} » n'est pas une majoration entre 0 et 100 %. Laisse la case vide si ce client n'en a pas.`);
            if (Math.round(n * 1e4) / 1e4 !== n) return refus(i, `« ${t} » : une majoration se garde avec quatre décimales au plus.`);
          }
          taux[i.dataset.hsK] = n;
        }
        // (plateforme) 1.70.0 — le droit annuel aux congés payés : de 1 à 60 jours, deux décimales au plus.
        for (const i of $$('[data-cg-k]', layer)) {
          const t = i.value.trim();
          if (!t) continue;
          const n = Number(t.replace(/\s/g, '').replace(',', '.'));
          if (!Number.isFinite(n) || n < 1 || n > 60 || Math.round(n * 100) / 100 !== n) return refus(i, `« ${t} » n'est pas un nombre de jours entre 1 et 60 (deux décimales au plus) : 18, ou 24. Laisse la case vide pour celui du barème.`);
          taux[i.dataset.cgK] = n;
        }
        const rc = {};
        for (const i of $$('[data-rc]', layer)) {
          const t = i.value.trim();
          if (!t) continue;
          const n = Number(t.replace(/\s/g, '').replace(',', '.'));
          if (!Number.isFinite(n) || n < 0 || n > 100) return refus(i, `« ${t} » n'est pas un taux entre 0 et 100. Laisse la case vide pour le taux général.`);
          if (Math.round(n * 1e4) / 1e4 !== n) return refus(i, `« ${t} » : un taux se garde avec quatre décimales au plus.`);
          (rc[i.dataset.rc] = rc[i.dataset.rc] || {})[i.dataset.k] = n;
        }
        $$('[data-rc-irpp]', layer).forEach(i => { if (i.checked) (rc[i.dataset.rcIrpp] = rc[i.dataset.rcIrpp] || {}).sansIrpp = true; });
        try {
          S = await api.savePaie(dossier.id, rc, taux);
          close(); toast('Taux de la paie enregistrés.'); render();
        } catch (e) { toast(plainError(e), 'error'); }
      };
    });
  }

  function salarieForm(root, dossier, x, opts) {
    const s = livresState;
    const e = x || { contrat: 'cdi', actif: true, enfants: 0 };
    modal(`<h2>${x ? 'Modifier ' + esc(x.nom) : 'Déclarer un salarié'}</h2>
      <form id="sf" class="grid-2">
        <label class="field obligatoire span-2">${lbl('Nom et prénom', 'pa.nom')}<input name="nom" value="${esc(e.nom || '')}"></label>
        <label class="field">${lbl('N° CIN', 'pa.cin')}<input name="cin" value="${esc(e.cin || '')}"></label>
        <label class="field">${lbl('N° CNSS', 'pa.numCnss')}<input name="cnss" value="${esc(e.cnss || '')}"></label>
        <label class="field span-2">${lbl('Identité CNSS (comme sur la carte d\'assuré)', 'pa.identite')}<input name="identiteCnss" value="${esc(e.identiteCnss || '')}" placeholder="Prénom, prénom du père, nom"></label>
        ${/* (plateforme) 1.72.0 — la civilité, qui fait l'accord des documents du personnel. */''}
        <label class="field">${lbl('Civilité', 'pa.civilite')}<select name="genre"><option value="">— à préciser —</option>${KC.CIVILITES.map(([v, l]) => `<option value="${v}" ${e.genre === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">${lbl('Poste occupé', 'pa.poste')}<input name="poste" value="${esc(e.poste || '')}"></label>
        <label class="field">${lbl('Type de contrat', 'pa.contrat')}<select name="contrat">${KC.CONTRACT_TYPES.map(c => `<option value="${c[0]}" ${c[0] === (e.contrat || 'cdi') ? 'selected' : ''}>${esc(c[1].split(' —')[0])}</option>`).join('')}</select></label>
        ${/* 10.12.0 — la règle H-3 portée à la Paie (le jumeau manquant) : un montant s'écrit et se
              relit en français (« 1 250,500 »), une date se saisit JJ/MM/AAAA. Les champs
              numériques du navigateur refusaient la virgule sans un mot, et « AAAA-MM-JJ » était
              le format interne affiché sur un écran de saisie (règle 9.4.5). */''}
        <label class="field obligatoire">${lbl('Salaire brut mensuel (DT)', 'pa.brut')}<input name="brut" type="text" inputmode="decimal" class="num montant" placeholder="0,000" value="${esc(montantChamp(e.brut))}"></label>
        <label class="field obligatoire">${lbl('Date d\'embauche', 'pa.embauche')}<input name="embauche" placeholder="JJ/MM/AAAA" value="${esc(e.embauche ? fmtJour(e.embauche) : '')}"></label>
        <label class="field">${lbl('Date de sortie', 'pa.sortie')}<input name="sortie" placeholder="JJ/MM/AAAA" value="${esc(e.sortie ? fmtJour(e.sortie) : '')}"></label>
        <label class="check span-2"><input type="checkbox" name="chefDeFamille" ${e.chefDeFamille ? 'checked' : ''}> Chef de famille (déduction annuelle)</label>
        <label class="field">${lbl('Enfants à charge', 'pa.enfants')}<input name="enfants" type="number" min="0" step="1" class="num" value="${esc(String(e.enfants || 0))}"></label>
      </form>
      ${/* (plateforme) 1.68.0 — les primes de chaque mois : posées une fois, reprises par chaque bulletin nouveau (celles de
           l'entreprise, 1.59.0 ; celles d'un client sur SkanFact y apparaissent, et se gardent). */''}
      <div class="panel mt" id="sf-primes-p"><h2>Primes de chaque mois (DT) ${info('pa.primesFiche')}</h2><div id="sf-primes"></div>
        <button type="button" class="btn btn-sm mt" id="sf-plus-prime">+ Prime</button></div>
      <p class="small muted">Le numéro CNSS n'est pas nécessaire pour calculer un bulletin ; la déclaration trimestrielle le
      demande. Le chef de famille et les enfants à charge entrent dans le calcul de l'IRPP.
      <b>À VÉRIFIER</b> — les conditions et les montants dépendent de la loi de finances.</p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Enregistrer</button></div>`,
    (rootModal, close) => {
      // (plateforme) 1.68.0 — les primes de chaque mois de la fiche. Le tableau ne se redessine qu'à l'ajout ou au retrait
      // d'une ligne : pendant la frappe, seule la donnée change (le curseur reste dans sa case, 7.17.0).
      const primesFiche = (e.primes || []).map(p => ({ ...p }));
      const dessinerPrimes = () => {
        const zone = $('#sf-primes', rootModal);
        zone.innerHTML = primesFiche.length ? `<table class="lines-edit"><tbody>${primesFiche.map((p, i) => `<tr data-i="${i}">
            <td><input type="text" data-fp="label" value="${esc(p.label || '')}" placeholder="Prime de présence" aria-label="Prime ${i + 1} : libellé"></td>
            <td style="width:130px"><input type="text" inputmode="decimal" class="num montant" data-fp="amount" placeholder="0,000" value="${esc(Number(p.amount) ? montantChamp(p.amount) : '')}" aria-label="Prime ${i + 1} : montant du mois (DT)"></td>
            <td style="width:110px"><label class="check small"><input type="checkbox" data-fp="taxable" ${p.taxable !== false ? 'checked' : ''}> imposable</label></td>
            <td style="width:110px"><label class="check small" title="Au prorata des jours payés du mois : 24 jours sur 26 en donnent les 24 vingt-sixièmes"><input type="checkbox" data-fp="parJour" ${p.parJour ? 'checked' : ''}> au jour</label></td>
            <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-fpx="${i}" aria-label="Retirer la prime ${i + 1}" title="Retirer cette prime">✕</button></td></tr>`).join('')}</tbody></table>`
          : '<p class="small muted">Aucune prime de chaque mois. Une prime de présence, de transport : pose-la ici une fois, chaque bulletin nouveau la reprendra.</p>';
        $$('[data-fp]', zone).forEach(el => { el.oninput = el.onchange = () => {
          const p = primesFiche[Number(el.closest('tr').dataset.i)];
          if (el.type === 'checkbox') p[el.dataset.fp] = el.checked;
          else if (el.dataset.fp === 'amount') p.amount = lireMontant(el.value);
          else p.label = el.value;
        }; });
        $$('[data-fpx]', zone).forEach(bt => { bt.onclick = () => { primesFiche.splice(Number(bt.dataset.fpx), 1); dessinerPrimes(); }; });
      };
      $('#sf-plus-prime', rootModal).onclick = () => {
        primesFiche.push({ label: '', amount: 0, taxable: true, parJour: true });
        dessinerPrimes();
        const l = $$('#sf-primes [data-fp=label]', rootModal).pop(); if (l) l.focus();
      };
      dessinerPrimes();
      // Ouverte pour UN champ (le numéro CNSS qu'un contrôle vient de nommer), elle y met le curseur.
      if (opts && opts.focus) { const c = $(`[name=${opts.focus}]`, rootModal); if (c) c.focus(); }
      $('#ok', rootModal).onclick = async () => {
        const f = $('#sf', rootModal);
        // Une date tapée et illisible se REFUSE en montrant son champ ; vide, elle reste vide.
        const dateDe = (nom, quoi) => {
          const champ = $(`[name=${nom}]`, f), t = champ.value.trim();
          if (!t) return '';
          const iso = K.dateTapee(t, s.annee);
          if (!iso) { refus(champ, `${quoi} : « ${t} » n'est pas une date lisible. Écris-la JJ/MM/AAAA.`); return null; }
          return iso;
        };
        // (plateforme) 1.68.0 — un montant de prime illisible ou négatif se refuse sur sa case, avant l'enregistrement.
        const primeIllisible = $$('#sf-primes [data-fp=amount]', rootModal).find(i => montantIllisible(i.value));
        if (primeIllisible) return refus(primeIllisible, motifIllisible(primeIllisible.value));
        const primeNegative = $$('#sf-primes [data-fp=amount]', rootModal).find(i => lireMontant(i.value) < 0);
        if (primeNegative) return refus(primeNegative, 'Une prime ne peut pas être négative : une retenue se saisit sur le bulletin.');
        const embauche = dateDe('embauche', 'Date d\'embauche'); if (embauche === null) return;
        const sortie = dateDe('sortie', 'Date de sortie'); if (sortie === null) return;
        const v = {
          id: x ? x.id : '', nom: $('[name=nom]', f).value, cin: $('[name=cin]', f).value,
          cnss: $('[name=cnss]', f).value, identiteCnss: $('[name=identiteCnss]', f).value, poste: $('[name=poste]', f).value,
          // (plateforme) 1.72.0
          genre: $('[name=genre]', f).value,
          contrat: $('[name=contrat]', f).value, brut: lireMontant($('[name=brut]', f).value),
          embauche, sortie,
          chefDeFamille: $('[name=chefDeFamille]', f).checked, enfants: Number($('[name=enfants]', f).value) || 0,
          actif: x ? x.actif : true,
          // (plateforme) 1.68.0
          primes: primesFiche
        };
        // Ce que le fichier CNSS refuserait se refuse ICI, où l'on peut le corriger (10.14.1).
        if (String(v.cnss || '').trim() && !KC.lireMatriculeCnss(v.cnss).ok) return refus($('[name=cnss]', f), 'Le matricule CNSS s\'écrit 12345678-90 : huit chiffres au plus, puis la clé sur deux (comme sur la carte d\'assuré).');
        if (String(v.identiteCnss || '').trim()) { const idc = KC.identiteCnss(v.identiteCnss); if (!idc.ok) return refus($('[name=identiteCnss]', f), KC.motifIdentiteCnss(idc)); }
        const ok = KC.salarieValide(v);
        if (!ok.ok) return toast(ok.motif, 'error');
        try {
          const r = await api.saveSalarie({ dossierId: dossier.id, annee: s.annee, salarie: v });
          s.livre = r.livre; close(); toast('Salarié enregistré.'); drawLivres(root, dossier);
          // (plateforme) 1.72.0 — ouverte depuis un document du personnel (sa civilité à renseigner), elle y revient.
          if (opts && opts.apres) opts.apres(r.livre);
        } catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }

  // (plateforme) 1.235.0 — proposer la correction d'un bulletin fait par le client (docs/revue-paie-cabinet.md, C3) : ce
  // qui manque (une retenue oubliée, une prime, des jours sans solde), pourquoi, et le net qu'il aurait, calculé par le
  // même moteur et le barème du bulletin. Rien ne change chez le client : il lit la proposition dans sa paie, l'accepte
  // d'un geste ou la refuse (1.227.0).
  function correctionForm(root, dossier, b, pre) {
    const s = livresState, L = s.livre;
    const sal = (L.salaries || []).find(x => x.id === b.salarieId) || {};
    const client = clientDePaie(dossier, L);
    const baremes = KC.baremesDuBulletin(L, b, reglagesPaie(dossier, L));
    const NATURES = [['retenue', 'Une retenue oubliée (avance, prêt, acompte)', 'Remboursement d\'avance'], ['prime', 'Une prime ou des heures sup oubliées', 'Prime'], ['absence', 'Des jours sans solde', '']];
    modal(`<h2>Proposer une correction à ${esc(client)}</h2>
      <p class="small muted">Le bulletin de <b>${esc(sal.nom || '')}</b> (${esc(KC.moisPaie(b.mois))} ${esc(b.annee)}) reste celui de ${esc(client)} : il lit ta proposition dans sa paie, l'accepte d'un geste ou la refuse. La trace reste écrite sur le bulletin.</p>
      <form id="pc" class="form-grid">
        <label class="field obligatoire">${lbl('Ce qui manque', 'pa.cNature')}<select name="nature">${NATURES.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
        <label class="field" id="pc-lib-l">${lbl('Libellé sur le bulletin', 'pa.cLibelle')}<input name="libelle" type="text" maxlength="80" value="${esc((pre && pre.libelle) || NATURES[0][2])}"></label>
        <label class="field obligatoire" id="pc-mt-l">${lbl('Montant (DT)', 'pa.cMontant')}<input name="montant" type="text" inputmode="decimal" class="num montant" placeholder="0,000" value="${esc(pre && pre.montant ? montantChamp(pre.montant) : '')}"></label>
        <label class="field obligatoire" id="pc-j-l" hidden>${lbl('Jours sans solde en tout', 'pa.cJours')}<input name="jours" type="number" min="0" step="0.5" class="num" value="${esc(String(b.joursAbsence || 0))}"></label>
        <label class="field span2 obligatoire">${lbl(`Pourquoi (${client} le lit)`, 'pa.cMotif')}<textarea name="motif" rows="2" maxlength="500" placeholder="Par exemple : l'échéance d'octobre de son avance n'est pas retenue.">${esc((pre && pre.motif) || '')}</textarea></label>
      </form>
      <div id="pc-apercu" class="ok-box mt"></div>
      <p class="small warn-text" id="pc-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button><button class="btn btn-primary" id="pc-ok">Proposer la correction à ${esc(client)}</button></div>`,
    (rm, close) => {
      const f = $('#pc', rm);
      const formValues = () => Object.fromEntries(['nature', 'libelle', 'montant', 'jours', 'motif'].map(n => [n, $(`[name=${n}]`, f).value]));
      const lire = () => {
        const v = formValues(), nature = v.nature;
        const montantLu = lireMontant(v.montant);
        const primes = (b.primes || []).map(p => ({ ...p })), retenues = (b.retenues || []).map(r => ({ ...r }));
        let joursAbsence = Number(b.joursAbsence) || 0;
        const libelle = String(v.libelle || '').trim() || (nature === 'prime' ? 'Prime' : 'Retenue');
        // 1.237.0 — une retenue d'avance garde son avance (`advanceId`) : acceptée, elle la rembourse chez le client.
        if (nature === 'retenue') retenues.push({ label: libelle, amount: montantLu, ...(pre && pre.advanceId ? { advanceId: pre.advanceId } : {}) });
        else if (nature === 'prime') primes.push({ label: libelle, amount: montantLu, taxable: true });
        else joursAbsence = Math.max(0, Number(v.jours) || 0);
        const c = KC.computePayslip({ grossSalary: sal.brut, headOfFamily: sal.chefDeFamille, children: sal.enfants, contrat: sal.contrat },
          { year: b.annee, month: b.mois, gross: b.brut, workedDays: b.joursTravailles, absentDays: joursAbsence, bonuses: primes, deductions: retenues, prorata: b.prorata }, KC.baremesPaie(baremes));
        const motif = String(v.motif || '').trim();
        const refus = nature !== 'absence' && !(montantLu > 0) ? 'Écris le montant de ce qui manque.'
          : nature === 'absence' && joursAbsence === (Number(b.joursAbsence) || 0) ? `Le bulletin porte déjà ${joursFr(joursAbsence)} jour${joursAbsence > 1 ? 's' : ''} sans solde : écris le nombre corrigé.`
            : !motif ? `Dis à ${client} pourquoi : c'est ce qu'il lit avant d'accepter.` : '';
        const lignes = nature === 'absence' ? [{ libelle: 'Jours sans solde', avant: `${joursFr(b.joursAbsence || 0)} j`, apres: `${joursFr(joursAbsence)} j` }]
          : [{ libelle, avant: 0, apres: montantLu }];
        const titre = nature === 'retenue' ? `${libelle} oubliée` : nature === 'prime' ? `${libelle} oubliée` : 'Des jours sans solde';
        return { nature, c, refus, motif, lignes, titre, bulletin: nature === 'retenue' ? { retenues } : nature === 'prime' ? { primes } : { joursAbsence } };
      };
      const maj = () => {
        const v = formValues();
        $('#pc-mt-l', rm).hidden = v.nature === 'absence'; $('#pc-lib-l', rm).hidden = v.nature === 'absence'; $('#pc-j-l', rm).hidden = v.nature !== 'absence';
        const x = lire(), avant = Number((b.calcul || {}).net);
        $('#pc-apercu', rm).innerHTML = `<b>Net à payer : ${esc(money(avant))} → ${esc(money(x.c.net))}</b> <span class="small muted">— le même moteur, le barème du bulletin.</span>`;
        $('#pc-refus', rm).hidden = !x.refus; $('#pc-refus', rm).textContent = x.refus;
        $('#pc-ok', rm).disabled = !!x.refus;
      };
      const nat = $('[name=nature]', f);
      nat.onchange = () => { const n = NATURES.find(([k]) => k === nat.value); if (n && n[2]) $('[name=libelle]', f).value = n[2]; maj(); };
      $$('input, textarea', f).forEach(i => { i.oninput = maj; });
      maj();
      $('#pc-ok', rm).onclick = async () => {
        const x = lire();
        if (x.refus) return maj();
        const bt = $('#pc-ok', rm); bt.disabled = true;
        try {
          const r = await api.proposerCorrection({ dossierId: dossier.id, annee: s.annee, id: b.id, titre: x.titre, motif: x.motif, lignes: x.lignes, bulletin: x.bulletin });
          s.livre = r.livre; close(); toast(`La correction est proposée à ${client} : elle l'attend dans sa paie.`); drawLivres(root, dossier);
        } catch (err) { $('#pc-refus', rm).hidden = false; $('#pc-refus', rm).textContent = plainError(err); bt.disabled = false; }
      };
    });
  }
  function bulletinForm(root, dossier, b) {
    const s = livresState;
    const L = s.livre;
    const actifs = (L.salaries || []).filter(x => x.actif || (b && x.id === b.salarieId));
    // (plateforme) 1.68.0 — un bulletin nouveau part des primes de chaque mois de la fiche du salarié proposé (celles de
    // l'entreprise, au prorata des jours payés pour une prime au jour) : sans elles, on les retapait chaque mois.
    // (plateforme) 1.69.0 — un bulletin nouveau part du MOIS du salarié proposé, comme dans l'entreprise : son entrée ou sa
    // sortie (le brut proratisé), ses absences non payées (ses congés, son pointage), ses primes de chaque mois (au jour sur
    // les jours payés, 1.68.0), ses heures supplémentaires pointées. Sans pointage ni congé : le brut et les primes de la fiche.
    const donnees = donneesDuPointage(dossier, L);
    const saisieDe = (salarieId, mois) => {
      const emp = donnees.employees.find(x => x.id === salarieId);
      return emp ? KC.saisieDuMois(donnees, emp, Number(s.annee), Number(mois)) : null;
    };
    const depart = b ? null : saisieDe((actifs[0] || {}).id, s.paieMois);
    const e = b || { mois: s.paieMois, annee: s.annee, joursTravailles: depart ? depart.workedDays : 26, joursAbsence: depart ? depart.absentDays : 0,
      primes: depart ? depart.bonuses : [], prorata: depart ? depart.prorata : null,
      // (plateforme) 1.71.0 — et l'échéance de chacune de ses avances en cours, comme dans l'entreprise.
      retenues: depart ? depart.deductions : [] };
    const salDefaut = b ? b.salarieId : (actifs[0] || {}).id;
    const brutDefaut = b ? b.brut : (depart ? depart.gross : 0);
    // (plateforme) 1.66.0 — dans un dossier TENU, les taux de la paie sont ceux que le Cabinet règle pour le client. Un
    // bulletin modifié garde ceux de son calcul (un bulletin de septembre, les taux de septembre : les barèmes ne sont
    // pas datés) ; une case lui donne ceux d'aujourd'hui (le bon taux d'accident du travail, réglé après coup), et dit
    // d'abord chacun de ceux qui changent.
    const tauxDuJour = (() => {
      // (plateforme) 1.67.0 — ou d'un client sur SkanFact : les taux d'aujourd'hui sont ceux qu'il y règle.
      if (!(dossier.manual || L.reglagesPaie) || !b || !b.calcul || !b.calcul.bareme) return [];
      const sal = (L.salaries || []).find(x => x.id === b.salarieId) || {};
      // (plateforme) 1.266.3 — les taux du jour du MOIS du bulletin (la CSS est datée) : sinon un bulletin de 2027 sans CSS
      // se dirait « à d'autres taux que ceux du dossier ».
      const jour = KC.computePayslip({ grossSalary: sal.brut, headOfFamily: sal.chefDeFamille, children: sal.enfants, contrat: sal.contrat }, { year: b.annee, month: b.mois },
        KC.baremesPaie(reglagesPaie(dossier, L))).bareme;
      const figes = b.calcul.bareme;
      const virgule = n => String(Number(n)).replace('.', ',');
      return KC.REGIME_TAUX.filter(([k]) => figes[k] != null && Number(figes[k]) !== Number(jour[k]))
        .map(([k, lab]) => `${(TAUX_DU_CLIENT.find(t => t[0] === k) || [k, lab])[1]} ${virgule(jour[k])} % (${virgule(figes[k])} % sur ce bulletin)`);
    })();
    modal(`<h2>${b ? 'Modifier le bulletin' : 'Établir un bulletin'}</h2>
      <form id="bf" class="grid-2">
        <label class="field obligatoire span-2">${lbl('Salarié', 'pa.bSalarie')}
          <select name="salarieId" ${b ? 'disabled' : ''}>${actifs.map(x => `<option value="${esc(x.id)}" ${x.id === salDefaut ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>
        <label class="field">${lbl('Mois', 'pa.bMois')}<select name="mois">${KC.MOIS_PAIE.map((lab, i) => `<option value="${i + 1}" ${i + 1 === Number(e.mois) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>
        <label class="field obligatoire">${lbl('Brut du mois (DT)', 'pa.bBrut')}<input name="brut" type="text" inputmode="decimal" class="num montant" placeholder="0,000" value="${esc(montantChamp(brutDefaut))}"></label>
        <label class="field">${lbl('Jours ouvrables du mois', 'pa.bOuvrables')}<input name="joursTravailles" type="number" min="1" step="1" class="num" value="${esc(String(e.joursTravailles || 26))}"></label>
        <label class="field">${lbl('Jours d\'absence non payés', 'pa.bAbsence')}<input name="joursAbsence" type="number" min="0" step="0.5" class="num" value="${esc(String(e.joursAbsence || 0))}"></label>
      </form>
      ${/* (plateforme) 1.63.0 — toutes les primes et toutes les retenues du bulletin, l'une sous l'autre (la disposition
           de l'entreprise) : le formulaire n'en montrait qu'une de chaque, et l'enregistrement effaçait les autres. */''}
      ${/* (plateforme) 1.69.0 — d'où viennent le brut et l'absence proposés : un brut proratisé, un mois pointé. */''}
      <p class="small muted mt" id="bf-mois-note" hidden></p>
      <div class="bf-lignes mt">
        <div class="panel"><h2>Primes et indemnités (DT) ${info('pa.bPrime')}</h2><div id="bf-primes"></div>
          <button type="button" class="btn btn-sm mt" id="bf-plus-prime">+ Prime</button></div>
        <div class="panel"><h2>Retenues (DT) ${info('pa.bRetenue')}</h2><div id="bf-retenues"></div>
          <button type="button" class="btn btn-sm mt" id="bf-plus-retenue">+ Retenue</button></div>
      </div>
      ${tauxDuJour.length ? `<label class="check small mt" id="bf-taux"><input type="checkbox" id="bf-taux-du-jour">
        <span><b>Prendre les taux de la paie d'aujourd'hui</b> : ${esc(tauxDuJour.join(', '))}. Sans cette case, le bulletin garde ceux de son calcul.</span></label>` : ''}
      <div id="bf-apercu" class="ok-box mt"></div>
      ${/* (plateforme) 1.63.0 — un avertissement se lit AVANT le geste : l'écriture validée du mois se contre-passe. */''}
      ${b && b.ecritureId && (ecritureDuLivre(L, b.ecritureId) || {}).statut !== 'brouillard' ? `<p class="small muted mt" id="bf-ecriture">L'écriture de paie ${esc(KC.deMois(KC.moisPaie(b.mois)))} est validée : enregistrer ce bulletin la contre-passe (au brouillard) et en écrit une nouvelle à côté.</p>` : ''}
      <p class="small warn-text" id="bf-refus" role="status" aria-live="polite" hidden></p>
      <div class="modal-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" id="ok">Enregistrer le bulletin</button></div>`,
    (rootModal, close) => {
      const f = $('#bf', rootModal);
      // (plateforme) 1.63.0 — les lignes du bulletin, TOUTES, avec ce qu'elles portent (une prime d'heures
      // supplémentaires, une prime au jour : `marquesDePrime` du moteur), et le prorata d'une entrée ou d'une sortie.
      const primes = (e.primes || []).map(p => ({ ...p }));
      // (plateforme) 1.68.0 — les primes proposées suivent le salarié choisi, tant qu'on n'y a pas touché (règle 10.6.0).
      let primesTouchees = !!b;
      // (plateforme) 1.71.0 — les retenues proposées (les échéances des avances) suivent le salarié et le mois, de même.
      let retenuesTouchees = !!b;
      const retenues = (e.retenues || []).map(r => ({ ...r }));
      // (plateforme) 1.69.0 — celui du bulletin, ou celui du mois du salarié pour un bulletin nouveau (son entrée, sa sortie).
      let prorata = e.prorata || null;
      const jourFr = n => String(KC.round3(Number(n) || 0)).replace('.', ',');
      const noteAuJour = x => `au jour : ${jourFr(x.jours)} j payé${Number(x.jours) > 1 ? 's' : ''} sur ${jourFr(x.sur)} · ${money(x.mensuel)} pour un mois plein`;
      const dessiner = (sel, liste, sorte) => {
        const zone = $(sel, rootModal);
        zone.innerHTML = liste.length ? `<table class="lines-edit"><tbody>${liste.map((x, i) => `<tr data-i="${i}">
            <td><input type="text" data-l="label" value="${esc(x.label || '')}" placeholder="${sorte === 'prime' ? 'Prime de rendement' : 'Remboursement d\'avance'}" aria-label="${sorte === 'prime' ? 'Nom de la prime' : 'Nom de la retenue'}">${sorte === 'prime' && x.parJour ? `<div class="small muted" data-pj>${esc(noteAuJour(x))}</div>` : ''}</td>
            <td style="width:130px"><input type="text" inputmode="decimal" class="num montant" data-l="amount" placeholder="0,000" value="${esc(montantChamp(x.amount))}" aria-label="Montant (DT)"></td>
            ${sorte === 'prime' ? `<td style="width:110px"><label class="check small"><input type="checkbox" data-l="taxable" ${x.taxable !== false ? 'checked' : ''}> imposable</label></td>` : ''}
            <td class="line-tools"><button type="button" class="btn btn-ghost btn-sm" data-retirer="${i}" aria-label="Retirer cette ligne" title="Retirer cette ligne">✕</button></td></tr>`).join('')}</tbody></table>`
          : `<p class="small muted">${sorte === 'prime' ? 'Aucune prime ce mois-ci.' : 'Aucune retenue ce mois-ci.'}</p>`;
        $$('[data-l]', zone).forEach(el => { el.oninput = el.onchange = () => {
          const x = liste[Number(el.closest('tr').dataset.i)];
          if (liste === primes) primesTouchees = true; else retenuesTouchees = true;
          if (el.dataset.l === 'taxable') x.taxable = el.checked;
          else if (el.dataset.l === 'label') x.label = el.value;
          else {
            x.amount = lireMontant(el.value);
            // Un montant retapé à la main n'est plus « au jour » : la prime ne le prétend plus (comme dans l'entreprise).
            if (x.parJour) { ['parJour', 'mensuel', 'jours', 'sur'].forEach(k => { delete x[k]; }); const n = $('[data-pj]', el.closest('tr')); if (n) n.remove(); }
          }
          maj();
        }; });
        $$('[data-retirer]', zone).forEach(bt => { bt.onclick = () => { if (liste === primes) primesTouchees = true; else retenuesTouchees = true; liste.splice(Number(bt.dataset.retirer), 1); dessiner(sel, liste, sorte); maj(); }; });
      };
      // Les primes au jour suivent les jours payés, comme dans l'entreprise : ceux du mois, moins ce que le contrat ne
      // couvre pas (l'entrée, la sortie), moins l'absence non payée.
      const suivreLesJours = () => {
        const ouvrables = Number($('[name=joursTravailles]', f).value) || 26;
        const absence = Number($('[name=joursAbsence]', f).value) || 0;
        const hors = prorata ? Math.max(0, Number(prorata.sur) - Number(prorata.jours)) : 0;
        const j = Math.max(0, Math.min(ouvrables, KC.round3(ouvrables - hors - absence)));
        let change = false;
        primes.forEach(x => {
          if (!x.parJour) return;
          const m = KC.round3(Number(x.mensuel) * j / ouvrables);
          if (m !== x.amount || j !== x.jours || ouvrables !== x.sur) { Object.assign(x, { amount: m, jours: j, sur: ouvrables }); change = true; }
        });
        if (change) dessiner('#bf-primes', primes, 'prime');
      };
      const lire = () => {
        const sal = (L.salaries || []).find(x => x.id === (b ? b.salarieId : $('[name=salarieId]', f).value)) || {};
        const brut = lireMontant($('[name=brut]', f).value);
        // Une ligne laissée vide (ni nom, ni montant, ni marque) ne s'enregistre pas.
        const remplie = x => !!(Number(x.amount) || String(x.label || '').trim() || x.parJour || x.hs);
        return {
          id: b ? b.id : '', salarieId: sal.id, annee: s.annee, mois: Number($('[name=mois]', f).value) || 1,
          brut,
          joursTravailles: Number($('[name=joursTravailles]', f).value) || 26,
          joursAbsence: Number($('[name=joursAbsence]', f).value) || 0,
          primes: primes.filter(remplie).map(p => ({ ...p, label: String(p.label || '').trim() || 'Prime' })),
          retenues: retenues.filter(remplie).map(r => ({ ...r, label: String(r.label || '').trim() || 'Retenue' })),
          // Un brut retouché à la main n'est plus proratisé (la règle de l'entreprise, et celle du moteur).
          prorata: prorata && KC.round3(Number(prorata.brut)) === KC.round3(brut) ? prorata : null
        };
      };
      // L'aperçu se recalcule pendant la frappe : c'est le seul moyen de vérifier un net AVANT de
      // l'enregistrer, et le moteur est exactement celui qui enregistrera (9.4.5) — barèmes DU
      // DOSSIER compris : l'aperçu les ignorait et annonçait un net que l'enregistrement démentait.
      //
      // 10.10.0 (C-11) — et le bouton s'éteint par la MÊME fonction que celle qui refusera
      // (`bulletinValide`), avec son motif AU-DESSUS du bouton (9.4.2). Quarante jours d'absence sur
      // vingt-six affichaient un net de −586 DT sans un mot, et le bulletin s'enregistrait.
      // (plateforme) 1.64.0 — un bulletin modifié garde le barème figé avec son calcul (les taux du client ce mois-là),
      // l'aperçu comme l'enregistrement : avec les réglages du dossier au Cabinet, il changeait de taux en silence.
      // (plateforme) 1.66.0 — ou, dans un dossier tenu, les taux d'aujourd'hui, si la case est cochée.
      // (plateforme) 1.69.0 — d'où viennent le brut et l'absence proposés, sous l'en-tête : un brut proratisé (l'entrée, la
      // sortie), un mois pointé (l'absence et les heures supplémentaires viennent de sa grille).
      const direLeMois = v => {
        const note = $('#bf-mois-note', rootModal);
        const lignes = [];
        if (v.prorata) lignes.push(`Brut proratisé : ${v.prorata.motif || 'une entrée ou une sortie dans le mois'}, ${joursFr(v.prorata.jours)} jours sur ${joursFr(v.prorata.sur)} (${money(v.prorata.brutFiche)} pour un mois plein).`);
        if (!b && KC.pointageEnregistre(donnees, v.salarieId, Number(s.annee), v.mois)) lignes.push(`Le mois est pointé : ${(v.primes || []).some(x => x.hs) ? 'l\'absence et les heures supplémentaires viennent' : 'l\'absence vient'} de sa grille.`);
        note.hidden = !lignes.length;
        note.textContent = lignes.join(' ');
      };
      const caseDuJour = $('#bf-taux-du-jour', rootModal);
      // (plateforme) 1.67.0 — les réglages du dossier : ceux du SkanFact du client, s'il y tient sa paie.
      const reglages = reglagesPaie(dossier, L);
      let baremes = KC.baremesDuBulletin(L, b, reglages);
      if (caseDuJour) caseDuJour.onchange = () => { baremes = caseDuJour.checked ? reglages : KC.baremesDuBulletin(L, b, reglages); maj(); };
      const maj = () => {
        const v = lire();
        const sal = (L.salaries || []).find(x => x.id === v.salarieId) || {};
        const c = KC.computePayslip({ grossSalary: sal.brut, headOfFamily: sal.chefDeFamille, children: sal.enfants, contrat: sal.contrat },
          { year: v.annee, month: v.mois, gross: v.brut, workedDays: v.joursTravailles, absentDays: v.joursAbsence,
            bonuses: v.primes.map(p => ({ label: p.label, amount: p.amount, taxable: p.taxable })),
            deductions: v.retenues.map(d => ({ label: d.label, amount: d.amount })), prorata: v.prorata },
          KC.baremesPaie(baremes));
        const illisible = montantIllisibleDans(rootModal);
        const verdict = illisible ? { ok: false, motif: motifIllisible(illisible.value) } : KC.bulletinValide(v, L, baremes);
        const apercu = $('#bf-apercu', rootModal);
        apercu.className = verdict.ok ? 'ok-box mt' : 'warn-box mt';
        // Un net calculé en lisant une case illisible pour zéro serait un chiffre faux affiché : il
        // attend que la case se lise, et le refus dessous dit laquelle.
        apercu.innerHTML = illisible ? '<b>Net à payer —</b> <span class="small muted">— un montant ne se lit pas encore.</span>' : `<b>Net à payer ${esc(money(c.net))}</b>
          <span class="small muted">— brut ${esc(money(c.gross))}, retenues ${esc(money(KC.round3(c.cnssEmployee + c.irpp + c.css + c.otherDeductions)))},
          coût employeur ${esc(money(c.employerCost))}</span>${c.regime ? `<div class="small mt" id="bf-regime"><b>${esc(KC.contractLabel(c.contrat).split(' —')[0])}</b> : ${esc(KC.libelleRegime(c.regime))} — ${L.reglagesPaie ? 'réglé dans son SkanFact' : 'réglé dans « Taux de la paie… »'}.</div>` : ''}`;
        direLeMois(v);
        const refus = $('#bf-refus', rootModal);
        refus.hidden = verdict.ok;
        refus.textContent = verdict.ok ? '' : verdict.motif;
        const bouton = $('#ok', rootModal);
        bouton.disabled = !verdict.ok;
        bouton.title = verdict.ok ? '' : verdict.motif;
      };
      // Le brut PROPOSÉ suit le salarié choisi, tant qu'on n'y a pas touché (règle 10.6.0 : un champ
      // pré-rempli se recalcule quand ce dont il dépend change). Changer de salarié gardait le brut
      // du premier de la liste : un bulletin juste en apparence, au mauvais salaire.
      let brutTouche = !!b;
      $('[name=brut]', f).addEventListener('input', () => { brutTouche = true; });
      const choixSal = $('[name=salarieId]', f);
      // (plateforme) 1.68.0 et 1.69.0 — ce qui est PROPOSÉ suit le salarié et le mois choisis, tant qu'on n'y a pas touché
      // (règle 10.6.0) : le brut (proratisé à l'entrée ou à la sortie), les jours et l'absence (ses congés, son pointage),
      // les primes de chaque mois et les heures supplémentaires pointées ; celles « au jour » suivent ensuite les jours payés
      // (le formulaire le refait juste après).
      let absenceTouchee = !!b;
      ['joursAbsence', 'joursTravailles'].forEach(n => $(`[name=${n}]`, f).addEventListener('input', () => { absenceTouchee = true; }));
      const reprendreLeMois = () => {
        if (b) return;
        const i = saisieDe(choixSal.value, $('[name=mois]', f).value);
        if (!i) return;
        prorata = i.prorata;
        if (!brutTouche) $('[name=brut]', f).value = montantChamp(i.gross);
        if (!absenceTouchee) { $('[name=joursTravailles]', f).value = String(i.workedDays); $('[name=joursAbsence]', f).value = String(i.absentDays); }
        // (plateforme) 1.71.0 — les échéances des avances du salarié et du mois choisis, tant qu'on n'a pas touché aux retenues.
        if (!retenuesTouchees) {
          retenues.splice(0, retenues.length, ...(i.deductions || []).map(d => ({ ...d })));
          dessiner('#bf-retenues', retenues, 'retenue');
        }
        if (primesTouchees) return;
        primes.splice(0, primes.length, ...i.bonuses.map(p => ({ ...p })));
        dessiner('#bf-primes', primes, 'prime');
      };
      if (choixSal) choixSal.addEventListener('change', reprendreLeMois);
      $('[name=mois]', f).addEventListener('change', reprendreLeMois);
      f.oninput = f.onchange = () => { suivreLesJours(); maj(); };
      dessiner('#bf-primes', primes, 'prime');
      dessiner('#bf-retenues', retenues, 'retenue');
      const ajouter = (sel, liste, sorte, ligne) => {
        liste.push(ligne); dessiner(sel, liste, sorte);
        const champs = $$(`${sel} [data-l=label]`, rootModal); if (champs.length) champs[champs.length - 1].focus();
        maj();
      };
      $('#bf-plus-prime', rootModal).onclick = () => { primesTouchees = true; ajouter('#bf-primes', primes, 'prime', { label: '', amount: 0, taxable: true }); };
      $('#bf-plus-retenue', rootModal).onclick = () => { retenuesTouchees = true; ajouter('#bf-retenues', retenues, 'retenue', { label: '', amount: 0 }); };
      maj();
      $('#ok', rootModal).onclick = async () => {
        const v = lire();
        const ok = KC.bulletinValide(v, L, baremes);
        if (!ok.ok) return toast(ok.motif, 'error');
        try {
          const r = await api.saveBulletin({ dossierId: dossier.id, annee: s.annee, bulletin: v, tauxDuJour: !!(caseDuJour && caseDuJour.checked) });
          s.livre = r.livre; close(); toast('Bulletin enregistré.'); drawLivres(root, dossier);
        } catch (err) { toast(plainError(err), 'error'); }
      };
    });
  }

