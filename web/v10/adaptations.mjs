// Les adaptations du code de la v10 (décision de Skander, 28/09/2026 : « récupérer le même code et
// l'adapter »). Le code est copié TEL QUEL par ./reprendre.mjs (npm run reprendre-v10) ; seules ces retouches y
// sont appliquées, chacune avec sa raison. Chaque `avant` doit se trouver UNE fois exactement dans
// son fichier : si une version de la v10 le change, la reprise s'arrête au lieu de deviner.
//
// Règle : une adaptation touche le BRANCHEMENT (le point de contact, les gestes officiels), jamais
// un écran. Ce qui se voit reste la v10.

import { SANS_PAQUETS, lireFichier } from './sans-paquets.mjs';

export const ADAPTATIONS = [
  {
    fichier: 'index.html',
    pourquoi: 'le point de contact avec le serveur se charge avant tout le reste (précédé du poste, qui garde la copie pour le hors-ligne, brique 72), et la mise en page du téléphone après la feuille de style de la v10 ; l\'application s\'installe (son manifeste)',
    avant: '  <link rel="stylesheet" href="style.css">\n',
    apres: '  <link rel="stylesheet" href="style.css">\n  <link rel="manifest" href="/manifest.webmanifest">\n  <link rel="stylesheet" href="../plateforme/telephone.css">\n  <script src="../plateforme/poste.js"></script>\n  <script src="../plateforme/pont.js"></script>\n  <script src="../plateforme/telephone.js"></script>\n',
  },
  {
    fichier: 'app.js',
    pourquoi: 'le repli « navigateur » de la v10 reste le socle du point de contact ; le pont de la plateforme n\'en remplace que ce qu\'il fait autrement (les données viennent du serveur)',
    avant: '  const bridge = window.skanfact || {\n    _mem: null,',
    apres: '  const bridge = Object.assign({\n    _mem: null,',
  },
  {
    fichier: 'app.js',
    pourquoi: 'au retour du réseau, le point de contact relance l\'enregistrement de ce qui a été enregistré sans réseau (brique 73, docs/hors-ligne.md)',
    avant: '  function save(immediate) {\n',
    apres: '  // (plateforme) Le point de contact relance l\'enregistrement au retour du réseau (brique 73).\n  window.__enregistrerMaintenant = () => save(true);\n  function save(immediate) {\n',
  },
  // ── Ce qu'un appareil retiré a remis (brique 74 bis ; docs/hors-ligne.md, H10) : le bandeau du point
  // de contact y mène (« Voir ») par le chemin que la v10 prend pour amener un réglage précis.
  {
    fichier: 'app.js',
    pourquoi: 'le bandeau d\'une remise à décider mène au panneau qui la montre',
    avant: '  function allerParametres(tab, focus) {\n',
    apres: '  // (plateforme) Le point de contact mène à un panneau des Paramètres (brique 74 bis).\n  window.__allerParametres = (tab, focus) => allerParametres(tab, focus);\n  function allerParametres(tab, focus) {\n',
  },
  // ── Tes appareils (brique 74 ; docs/hors-ligne.md, H9) et ce qu'un appareil retiré a remis (brique
  // 74 bis, H10) : des panneaux des Paramètres, dessinés par le point de contact (comme « Ton cabinet
  // comptable ») ; la v10 de l'ordinateur ne les a pas.
  {
    fichier: 'app.js',
    pourquoi: 'les panneaux « Tes appareils » et « Remis par un appareil retiré » ont leur entrée (onglet Données, recherche des réglages), posée seulement quand le point de contact sait les dessiner (et, pour le second, qu\'une remise attend)',
    avant: "    'p-dossiers': { onglet: 'donnees',",
    apres: "    'p-quarantaine': { onglet: 'donnees', titre: 'Remis par un appareil retiré', mots: 'appareil retire quarantaine remis hors ligne accepter rejeter changement attente', visible: () => !!(bridge.quarantaine && bridge.quarantaine()) },\n    'p-appareils': { onglet: 'donnees', titre: 'Tes appareils', mots: 'appareil ordinateur telephone perdu vole retirer session connexion hors ligne copie', visible: () => !!bridge.dessinerAppareils },\n    'p-dossiers': { onglet: 'donnees',",
  },
  {
    fichier: 'app.js',
    pourquoi: 'les panneaux « Remis par un appareil retiré » (s\'il y a une remise à décider) et « Tes appareils » se posent en tête de l\'onglet Données',
    avant: "      ${panneau('p-dossiers', info('data.dossiers'))}\n",
    apres: "      ${bridge.quarantaine && bridge.quarantaine() ? `${panneau('p-quarantaine')}<div id=\"quarantaine-panel\"></div></div>` : ''}\n      ${bridge.dessinerAppareils ? `${panneau('p-appareils')}<div id=\"appareils-panel\"></div></div>` : ''}\n      ${panneau('p-dossiers', info('data.dossiers'))}\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le point de contact dessine ses panneaux quand les Paramètres s\'ouvrent',
    avant: '    drawCabinetPair();\n    drawLicencePanel();\n',
    apres: "    drawCabinetPair();\n    if (bridge.dessinerQuarantaine && $('#quarantaine-panel')) bridge.dessinerQuarantaine($('#quarantaine-panel'));\n    if (bridge.dessinerAppareils && $('#appareils-panel')) void bridge.dessinerAppareils($('#appareils-panel'));\n    drawLicencePanel();\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'la fin du même objet : le pont de la plateforme se pose par-dessus le repli',
    avant: '    onUpdateEvent: () => {}\n  };\n\n  // ---------- état ----------',
    apres: '    onUpdateEvent: () => {}\n  }, window.skanfact || {});\n\n  // ---------- état ----------',
  },
  // ── L'émission d'une facture passe par le serveur (01 R9 : la numérotation légale est au serveur) ──
  // La v10 numérotait sur l'ordinateur, dans une fonction volontairement synchrone pour qu'un double
  // clic ne prenne jamais deux numéros. Ici le numéro vient du serveur, qui le prend dans la même
  // transaction que l'émission et refuse d'émettre deux fois : le double clic ne peut plus trouer la
  // série, et le bouton reste occupé pendant l'attente comme dans la v10.
  {
    fichier: 'app.js',
    pourquoi: 'l\'émission attend le serveur',
    avant: '    function issue() {\n      if (isIssued()) return false;',
    apres: '    async function issue() {\n      if (isIssued()) return false;',
  },
  {
    fichier: 'app.js',
    pourquoi: 'le numéro ne se prend plus sur l\'ordinateur',
    avant: '      if (!doc.number) doc.number = C.nextNumber(data, doc.type, doc.date);\n      // Le timbre se fige ici, avec le numéro',
    apres: '      // (plateforme) Le numéro vient du serveur, à l\'émission, plus bas.\n      // Le timbre se fige ici, avec le numéro',
  },
  {
    fichier: 'app.js',
    pourquoi: 'le serveur émet : il numérote, calcule en entiers, scelle, et vérifie le net à payer que l\'écran montre',
    avant: "      doc.status = isInv ? 'envoyée' : 'émis';\n      // L'INSTANT de l'émission",
    apres: "      // (plateforme) Le serveur émet : numéro, montants en entiers, maillon de la chaîne ; il refuse si\n      // son net à payer n'est pas celui de l'écran. Un refus se dit, et rien n'est émis.\n      try {\n        Object.assign(doc, await bridge.emettre(deepCopy(doc), deepCopy(clientById(doc.clientId) || null), C.computeTotals(doc, company()).netToPay));\n      } catch (e) { toast(plainError(e), true); return false; }\n      doc.status = isInv ? 'envoyée' : 'émis';\n      // L'INSTANT de l'émission",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le bouton « Émettre » attend l\'émission',
    avant: "        if (issue()) { if (isNew) remplacerPage('#/doc/' + doc.id); else render(); }",
    apres: "        if (await issue()) { if (isNew) remplacerPage('#/doc/' + doc.id); else render(); }",
  },
  {
    fichier: 'app.js',
    pourquoi: '« Émettre et exporter » attend l\'émission',
    avant: "        if (c === 'emettre') { if (!issue()) return; }",
    apres: "        if (c === 'emettre') { if (!(await issue())) return; }",
  },
  {
    fichier: 'app.js',
    pourquoi: '« Émettre puis envoyer » attend l\'émission',
    avant: "            $('#em-issue', root).onclick = () => {\n              close();\n              if (!issue()) return;",
    apres: "            $('#em-issue', root).onclick = async () => {\n              close();\n              if (!(await issue())) return;",
  },
  // ── Le menu du haut : une entreprise vit sur le serveur ──
  // Dans la v10, « Partager cette entreprise » et « Rejoindre un dossier partagé » posaient un FICHIER
  // dans iCloud ou sur une clé. Sur la plateforme, il n'y a plus de fichier : chacun ouvre la même
  // entreprise avec son compte. À leur place, le geste qui manquait : se déconnecter.
  {
    fichier: 'app.js',
    pourquoi: 'le menu du haut propose de se déconnecter, au lieu de partager ou rejoindre un fichier',
    avant: "      ${(r.dossiers || []).some(d => d.id === r.current && d.shared) ? '' : `<button type=\"button\" id=\"dm-share\" title=\"Poser CE dossier, avec tout ce qu'il contient, dans iCloud, OneDrive ou sur une clé\"><span class=\"dm-mark\">↔</span><span class=\"dm-nom\">Partager cette entreprise…</span></button>`}\n      <button type=\"button\" id=\"dm-join\" title=\"Ouvrir un dossier déjà posé dans un emplacement partagé par l'autre ordinateur\"><span class=\"dm-mark\">↓</span><span class=\"dm-nom\">Rejoindre un dossier partagé…</span></button>\n",
    apres: "      <button type=\"button\" id=\"dm-sortir\" title=\"Fermer ta session sur cet appareil\"><span class=\"dm-mark\">⏻</span><span class=\"dm-nom\">Se déconnecter</span></button>\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le bouton « Se déconnecter » du menu ferme la session',
    avant: "    $('#dm-join', m).onclick = () => {\n      const partageable",
    apres: "    $('#dm-sortir', m).onclick = () => { fermerDossiers(); bridge.deconnecter(); };\n    if ($('#dm-join', m)) $('#dm-join', m).onclick = () => {\n      const partageable",
  },
  // ── Une facture émise est scellée par le serveur ──
  // La v10 laissait rouvrir une facture émise impayée (« Modifier quand même… »), en le déconseillant.
  // Le serveur, lui, refuse tout changement de ce qui a été scellé (dossier.ts, SCELLE) : le bouton
  // mènerait à « Rien n'a été enregistré ». Il disparaît ; « Corriger par un avoir… » reste.
  {
    fichier: 'app.js',
    pourquoi: 'une facture émise ne se rouvre plus : le serveur l\'a scellée',
    avant: "    const canUnlock = locked && isInv && bal && !bal.paid && !bal.credits.length && doc.status !== 'annulée';",
    apres: "    const canUnlock = !bridge.emettre && locked && isInv && bal && !bal.paid && !bal.credits.length && doc.status !== 'annulée';",
  },
  {
    fichier: 'app.js',
    pourquoi: '« Plus déverrouillable (raison) » n\'a plus de raison à dire : rien ne se déverrouille',
    avant: "            : (isInv && doc.status !== 'annulée'\n",
    apres: "            : (!bridge.emettre && isInv && doc.status !== 'annulée'\n",
  },
  // ── L'exemple rempli ──
  // La v10 remplaçait les données du dossier par un jeu d'exemple, après une sauvegarde sur le disque,
  // et « Quitter l'exemple » les rendait. Sur le serveur, il n'y a pas cette sauvegarde : quitter
  // l'exemple effacerait tout, et des pièces inventées entreraient dans une vraie entreprise.
  // L'exemple de la plateforme est l'entreprise d'essai, à part : le pont y mène.
  {
    fichier: 'app.js',
    pourquoi: '« Voir un exemple » ouvre l\'entreprise d\'essai, au lieu d\'écrire des pièces inventées dans l\'entreprise ouverte',
    avant: "  async function loadDemo() {\n",
    apres: "  async function loadDemo() {\n    if (bridge.exemple) {\n      try { const r = await bridge.exemple(); if (r && r.motif) await infoDialog('L\\'exemple', r.motif); }\n      catch (e) { toast(plainError(e), true); }\n      return false;\n    }\n",
  },
  // ── Les panneaux sans objet sur la plateforme ──
  // Le pont les cache (sauvegardes du disque, copie externe, mot de passe du fichier, licence, mises à
  // jour…) ; la palette Ctrl K, qui propose une entrée par panneau, les tait aussi.
  {
    fichier: 'app.js',
    pourquoi: 'la palette ne propose pas un panneau caché par la plateforme',
    avant: "    return Object.keys(SETTINGS_PANNEAUX).filter(id => !SETTINGS_PANNEAUX[id].visible || SETTINGS_PANNEAUX[id].visible()).map(id => {",
    apres: "    return Object.keys(SETTINGS_PANNEAUX).filter(id => !(bridge.panneauxAbsents || []).includes(id)).filter(id => !SETTINGS_PANNEAUX[id].visible || SETTINGS_PANNEAUX[id].visible()).map(id => {",
  },
  // ── Une facture émise ne s'annule pas (01 § 7, brique 29) ──
  // « Marquer annulée… » posait un statut que le cadrage interdit : une facture émise se corrige par
  // un avoir, et « annulée » se DÉDUIT quand ses avoirs la couvrent (effectiveStatus le fait déjà).
  // Le serveur refuse le statut (v10.annulee) ; l'écran ne le propose plus.
  {
    fichier: 'app.js',
    pourquoi: '« Marquer annulée… » disparaît : une facture émise se corrige par un avoir',
    avant: "          ${s.status === 'annulée' ? `<span class=\"muted small\">Facture annulée.</span>",
    apres: "          ${bridge.emettre ? '' : s.status === 'annulée' ? `<span class=\"muted small\">Facture annulée.</span>",
  },
  // ── Un paiement se compte à l'unité de sa devise (brique 29, D3) ──
  // Le serveur tient chaque règlement en entier dans l'unité de la devise de la facture (le centime
  // pour l'euro) ; la v10 acceptait le millième d'euro. Le refus se dit sur le champ, avant d'enregistrer.
  {
    fichier: 'app.js',
    pourquoi: 'un paiement plus précis que sa devise se refuse sur son champ',
    avant: "        const v = formValues($('#pf2', root));\n        if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Montant invalide.');\n",
    apres: "        const v = formValues($('#pf2', root));\n        if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Montant invalide.');\n        if (bridge.emettre && (String(v.amount).split('.')[1] || '').length > C.decimalsFor(cur)) return refus($('[name=amount]', root), `Un montant en ${cur} se compte à ${C.decimalsFor(cur)} décimales au plus.`);\n",
  },
  // ── Les achats tenus par le serveur (brique 30, docs/achats.md) ──
  // Le serveur tient chaque achat et ses règlements en entiers dans l'unité de la devise de la pièce :
  // un montant plus précis se refuse sur son champ, avant d'enregistrer (comme le paiement d'une vente).
  {
    fichier: 'app.js',
    pourquoi: 'un règlement fournisseur plus précis que sa devise se refuse sur son champ',
    avant: "      $('#ok', root).onclick = async () => {\n        const v = formValues($('#spf', root));\n        if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Montant invalide.');\n",
    apres: "      $('#ok', root).onclick = async () => {\n        const v = formValues($('#spf', root));\n        if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Montant invalide.');\n        if (bridge.emettre && (String(v.amount).split('.')[1] || '').length > C.decimalsFor(cur)) return refus($('[name=amount]', root), `Un montant en ${cur} se compte à ${C.decimalsFor(cur)} décimales au plus.`);\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'des frais d\'achat plus précis que leur devise se refusent sur leur champ',
    avant: "      if (p.dueDate && p.dueDate < p.date) return refus('[name=dueDate]', 'L\\'échéance ne peut pas précéder la date de la pièce.');\n      return true;\n",
    apres: "      if (p.dueDate && p.dueDate < p.date) return refus('[name=dueDate]', 'L\\'échéance ne peut pas précéder la date de la pièce.');\n      if (bridge.emettre && (String(p.fees || 0).split('.')[1] || '').length > C.decimalsFor(p.currency || company().currency)) return refus('[name=fees]', `Des frais en ${p.currency || company().currency} se comptent à ${C.decimalsFor(p.currency || company().currency)} décimales au plus.`);\n      return true;\n",
  },
  // La v10 laissait supprimer une facture d'achat à laquelle un avoir ou un acompte était rattaché :
  // l'avoir restait « imputé » à une facture qui n'existait plus. Le serveur le refuse (D2) ; l'écran
  // le dit AVANT la question « Supprimer ? », avec ce qu'il faut faire.
  {
    fichier: 'app.js',
    pourquoi: 'un achat auquel un avoir ou un acompte est rattaché ne se supprime pas : on le détache d\'abord',
    avant: "    if ($('#del')) $('#del').onclick = async () => {\n      if (!await confirmDialog(`Supprimer ${p.number || 'cette pièce'} ? Les règlements enregistrés seront perdus.`)) return;\n",
    apres: "    if ($('#del')) $('#del').onclick = async () => {\n      if (bridge.emettre && data.purchases.some(x => x.achatLie === p.id)) { toast('Un avoir ou un acompte est rattaché à cet achat : détache-le (ou supprime-le) d\\'abord. Rien n\\'a été supprimé.', true); return; }\n      if (!await confirmDialog(`Supprimer ${p.number || 'cette pièce'} ? Les règlements enregistrés seront perdus.`)) return;\n",
  },
  // ── La caisse n'est pas encore en ligne (étape 4) ──
  // Un ticket est une facture numérotée sur l'ordinateur : le serveur la refuserait, et l'écran finirait
  // sur « Rien n'a été enregistré ». Le geste se refuse avec sa phrase, avant de rien vendre.
  {
    fichier: 'app.js',
    pourquoi: '« Encaisser » se refuse avec sa phrase : la caisse arrive avec l\'étape 4',
    avant: "        if (licenceBlock('Émettre un ticket de caisse', 'caisse')) return;\n",
    apres: "        if (licenceBlock('Émettre un ticket de caisse', 'caisse')) return;\n        if (bridge.emettre) { toast('La caisse n\\'est pas encore dans la version en ligne de SkanFact : rien n\\'a été vendu.', true); return; }\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le retour d\'un ticket se refuse de même',
    avant: "        if (licenceBlock('Émettre un avoir sur un ticket', 'caisse')) return;\n",
    apres: "        if (licenceBlock('Émettre un avoir sur un ticket', 'caisse')) return;\n        if (bridge.emettre) { toast('La caisse n\\'est pas encore dans la version en ligne de SkanFact : rien n\\'a été rendu.', true); return; }\n",
  },
  // ── La paie par le serveur (brique 31, docs/paie.md) ──
  // Un bulletin de la v10 ne gardait qu'une partie de ce qui l'a calculé : six taux et le régime du
  // contrat, mais ni le barème de l'IRPP, ni les frais professionnels, ni les déductions de famille,
  // ni la situation du salarié ce mois-là. Relu après une loi de finances, il ne pouvait plus se
  // recalculer (01 R7). Le moteur de paie les fige maintenant AVEC le calcul, là où naissent tous les
  // bulletins (le formulaire, les bulletins du mois) ; le serveur recalcule chaque bulletin avec eux.
  {
    fichier: 'compta.js',
    pourquoi: 'un bulletin garde le barème entier et la situation du salarié qui l\'ont calculé',
    avant: "        tfpRate: Number(s.tfpRate) || 0, foprolosRate: Number(s.foprolosRate) || 0\n      }\n    };\n  }\n",
    apres: "        tfpRate: Number(s.tfpRate) || 0, foprolosRate: Number(s.foprolosRate) || 0\n      },\n      // (plateforme) Le barème ENTIER de ce calcul et la situation du salarié ce mois-là : le bulletin\n      // les garde, et le serveur le recalcule avec eux.\n      bareme: {\n        cnssEmployee: Number(s.cnssEmployee) || 0, cnssEmployer: Number(s.cnssEmployer) || 0, accidentRate: Number(s.accidentRate) || 0,\n        tfpRate: Number(s.tfpRate) || 0, foprolosRate: Number(s.foprolosRate) || 0, solidarity: Number(s.solidarity) || 0,\n        proRate: Number(s.proRate) || 0, proCap: Number(s.proCap) || 0, headOfFamily: Number(s.headOfFamily) || 0,\n        perChild: Number(s.perChild) || 0, maxChildren: Number(s.maxChildren) || 0, sansIrpp: !!regime.sansIrpp,\n        brackets: (s.brackets || DEFAULT_PAYROLL.brackets).map(b => ({ upTo: b.upTo == null ? null : Number(b.upTo), rate: Number(b.rate) || 0 }))\n      },\n      situation: { headOfFamily: !!emp.headOfFamily, children: Number(emp.children) || 0 }\n    };\n  }\n",
  },
  // ── Le Cabinet (brique 37, docs/cabinet.md) ──
  // Ses écrans sont copiés dans cabinet/, à côté de ceux de l'entreprise : les fichiers qu'il partage
  // avec elle (le moteur comptable, les listes, la visite…) sont CEUX de la copie de l'entreprise, par
  // leur nouveau chemin ; jamais une seconde copie qui divergerait (« un fichier partagé ne diverge pas »).
  ...['rowmenu', 'listes', 'placement', 'reglages', 'majui', 'nouveautes', 'compta', 'visite'].map((n) => ({
    fichier: 'cabinet/index.html',
    pourquoi: `${n}.js est celui que le Cabinet partage avec l'entreprise : la même copie`,
    avant: `<script src="../../renderer/${n}.js"></script>`,
    apres: `<script src="../${n}.js"></script>`,
  })),
  {
    fichier: 'cabinet/index.html',
    pourquoi: 'la feuille de style partagée avec l\'entreprise : la même copie',
    avant: '<link rel="stylesheet" href="../../renderer/style.css">',
    apres: '<link rel="stylesheet" href="../style.css">',
  },
  {
    fichier: 'cabinet/index.html',
    pourquoi: 'le moteur du Cabinet est copié à côté de ses écrans',
    avant: '<script src="../cabcore.js"></script>',
    apres: '<script src="cabcore.js"></script>',
  },
  {
    fichier: 'cabinet/index.html',
    pourquoi: 'le point de contact du Cabinet avec le serveur se charge avant tout le reste',
    avant: '  <script src="../rowmenu.js"></script>\n',
    apres: '  <script src="../../plateforme/pont-cabinet.js"></script>\n  <script src="../rowmenu.js"></script>\n',
  },
  {
    fichier: 'cabinet/index.html',
    pourquoi: 'ce qui n\'a plus d\'objet sans paquets (importer, l\'onglet des paquets) se cache',
    avant: '  <link rel="stylesheet" href="cabinet.css">\n',
    apres: '  <link rel="stylesheet" href="cabinet.css">\n  <link rel="stylesheet" href="../../plateforme/cabinet.css">\n',
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'l\'état d\'un dossier ne parle plus de paquets : ses livres sont ceux du serveur, à jour en direct',
    avant: "(dossier.manual ? 'tenu au cabinet : aucun paquet attendu' : 'aucun paquet reçu pour l\\'instant')",
    apres: "(dossier.manual ? 'tenu au cabinet' : 'sur SkanFact : ses livres sont à jour en direct')",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'la session de la plateforme ouvre le cabinet : plus de mot de passe du cabinet ni d\'écran de verrouillage (03 § 7)',
    avant: '    const st = await api.status();\n',
    apres: "    const st = await api.status();\n    // (plateforme) La session ouvre le cabinet : ni mot de passe du cabinet, ni écran de verrouillage.\n    if (st.session) {\n      const r = await api.unlock('');\n      S = r.state;\n      appliquerTheme();\n      $('#lock-screen').remove();\n      $('#app').hidden = false;\n      start(false, null, false, null);\n      return;\n    }\n",
  },
  // C4 : sans paquets, l'appairage, la clé de secours et la copie sur un disque n'ont plus d'objet (le
  // serveur garde les livres et leurs copies). Le point de contact en tient la liste
  // (`panneauxAbsents`, `etapesAbsentes`), comme celui de l'entreprise.
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'la palette ne propose pas un réglage absent en ligne',
    avant: '      ...Object.keys(REG_PANNEAUX).map(id => ({',
    apres: '      ...Object.keys(REG_PANNEAUX).filter(id => !(api.panneauxAbsents || []).includes(id)).map(id => ({',
  },
  {
    fichier: 'cabinet/cabcore.js',
    pourquoi: '« Tes premiers pas » ne réclame pas une étape sans objet en ligne',
    avant: '    ];\n    const faits = etapes.filter(x => x.fait).length;',
    apres: "    ].filter(x => !((typeof window !== 'undefined' && window.cabinet && window.cabinet.etapesAbsentes) || []).includes(x.id));\n    const faits = etapes.filter(x => x.fait).length;",
  },
  // Un client arrive au cabinet par un MANDAT (brique 36) : il tape le code du cabinet dans son
  // SkanFact, l'associé accepte. Le code se lit là où la v10 expliquait l'appairage, et les
  // dossiers qu'on lui confie s'annoncent là où la v10 annonçait les paquets arrivés.
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'le portefeuille vide explique comment un client arrive (le code du cabinet), plus comment un paquet arrive',
    avant: "        <div class=\"panel\"><h2>Comment un paquet arrive jusqu'ici</h2>\n          <ol class=\"small\" style=\"line-height:1.9;margin:0;padding-inline-start:20px\">\n            <li>Tu remets à ton client le <strong>fichier d'appairage</strong> (Réglages → Mon cabinet → Le fichier à remettre à tes clients).</li>\n            <li>Il l'importe une fois dans son SkanFact, puis t'envoie son <strong>.skanpack</strong> chaque mois.</li>\n            <li>Tu le <strong>glisses sur cette fenêtre</strong>, ou tu le double-cliques dans ${EXPLORATEUR()}.</li>\n          </ol>\n        </div>",
    apres: '        ${api.commentUnClientArrive()}',
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'le panneau de l\'appairage devient celui du code du cabinet',
    avant: "        <p class=\"small\">Chaque client doit importer ce fichier une fois, dans <strong>Paramètres → Envois → Ton cabinet comptable</strong> de son SkanFact.\n        À partir de là, les paquets qu'il fabrique sont chiffrés <strong>pour toi seul</strong> : personne d'autre ne peut les ouvrir,\n        même en interceptant le mail, et il n'a plus aucun mot de passe à te communiquer.</p>\n        <div class=\"mt\"><div class=\"muted small\">${lbl('Empreinte de ton cabinet', 'cab.fingerprint')}</div>\n          <div class=\"empreinte-ligne\"><span class=\"fingerprint\">${esc(c.fingerprint || '—')}</span>${c.fingerprint\n            ? '<button type=\"button\" class=\"btn btn-sm\" id=\"c-copier-emp\">Copier</button>' : ''}</div></div>\n        <p class=\"muted small mt\">Cette empreinte identifie ton cabinet. Ton client la voit après l'import : s'il te la lit au téléphone\n        et qu'elle correspond, c'est bien à toi qu'il envoie.</p>\n        ${c.signatureFingerprint ? `<div class=\"mt\"><div class=\"muted small\">${lbl('Empreinte de ta signature', 'cab.signature')}</div>\n          <div class=\"empreinte-ligne\"><span class=\"fingerprint\">${esc(c.signatureFingerprint)}</span></div></div>\n        <p class=\"muted small mt\">Tes clôtures et tes questions partent signées. Ton client retient cette signature la première fois,\n        puis refuse un envoi qui en porterait une autre : si l'un d'eux te la lit au téléphone, c'est celle-ci.</p>` : ''}\n        <div class=\"modal-actions\"><button class=\"btn\" id=\"c-pair\">Remettre le fichier à mes clients…</button></div>\n",
    apres: '        ${api.commentUnClientArrive(true)}\n',
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'le même panneau, son titre et ses mots de recherche',
    avant: "    'pan-appairage': { onglet: 'cabinet', titre: 'Le fichier à remettre à tes clients', mots: 'appairage fichier client empreinte cle publique chiffrer skanpair' },",
    apres: "    'pan-appairage': { onglet: 'cabinet', titre: 'Le code de ton cabinet', mots: 'code cabinet client confier dossier mandat accepter' },",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'le bouton de l\'appairage n\'existe plus',
    avant: "    $('#c-pair').onclick = () => remettreAppairage();",
    apres: "    if ($('#c-pair')) $('#c-pair').onclick = () => remettreAppairage();",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'les dossiers qu\'on confie au cabinet s\'annoncent à la place des paquets arrivés (il n\'y a plus de boîte de réception)',
    avant: "  function inboxBanner() {\n    if (!inboxInfo || !inboxInfo.dir) return '';",
    apres: "  function inboxBanner() {\n    if (api.bandeauMandats) return api.bandeauMandats();\n    if (!inboxInfo || !inboxInfo.dir) return '';",
  },
  // ── Ton cabinet comptable, côté entreprise (brique 37) ──
  {
    fichier: 'app.js',
    pourquoi: 'le panneau « Ton cabinet comptable » confie le dossier par le code du cabinet (un mandat), plus par un fichier d\'appairage',
    avant: "    function drawCabinetPair() {\n      const el = $('#cab-pair'); if (!el) return;",
    apres: "    function drawCabinetPair() {\n      const el = $('#cab-pair'); if (!el) return;\n      if (bridge.dessinerMandat) { void bridge.dessinerMandat(el); return; }",
  },
  {
    fichier: 'app.js',
    pourquoi: 'la bulle de ce panneau expliquait l\'appairage : le panneau s\'explique lui-même',
    avant: "        ${panneau('p-cabinet', info('cab.appaire'))}",
    apres: "        ${panneau('p-cabinet')}",
  },
  {
    fichier: 'app.js',
    pourquoi: 'les mots de recherche du même panneau',
    avant: "    'p-cabinet': { onglet: 'envois', titre: 'Ton cabinet comptable', mots: 'cabinet comptable appairage empreinte cle publique paquet chiffre' },",
    apres: "    'p-cabinet': { onglet: 'envois', titre: 'Ton cabinet comptable', mots: 'cabinet comptable expert code confier mandat livres' },",
  },
  {
    fichier: 'cabinet/cabcore.js',
    pourquoi: 'le nom du cabinet ne signe plus un fichier d\'appairage : le client le lit quand il confie son dossier',
    avant: "quoi: 'Ce nom signe tes relances et le fichier que tes clients importent.'",
    apres: "quoi: 'Ce nom signe tes relances, et tes clients le lisent quand ils te confient leur dossier.'",
  },
  // ── La saisie du cabinet (brique 38) : une écriture née d'une pièce de l'entreprise suit sa pièce ──
  // Le serveur refuse de la modifier, de la supprimer, de la contre-passer ou de l'extourner à la
  // main (C6) : le menu ne propose pas ce qui serait refusé. Un miroir ne se contre-passe pas non plus.
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'un brouillard né d\'une pièce de l\'entreprise ne se reprend pas dans la grille',
    avant: "      a.push({ icon: 'modifier', label: 'Reprendre dans la grille',",
    apres: "      if (e.source !== 'skanfact') a.push({ icon: 'modifier', label: 'Reprendre dans la grille',",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'un brouillard né d\'une pièce de l\'entreprise ne se supprime pas dans les livres',
    avant: "      detruire = { icon: 'supprimer', label: 'Supprimer ce brouillard'",
    apres: "      if (e.source !== 'skanfact') detruire = { icon: 'supprimer', label: 'Supprimer ce brouillard'",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'seule une écriture saisie se contre-passe ou s\'extourne à la main, et jamais un miroir',
    avant: "    if (e.statut === 'validee') {",
    apres: "    if (e.statut === 'validee' && e.source !== 'skanfact' && !e.contrepasseDe) {",
  },
  {
    fichier: 'cabinet/app.js',
    pourquoi: 'les livres du serveur ne s\'arrêtent pas au 31 décembre : l\'extourne d\'une écriture de décembre se pose directement au 1er janvier',
    avant: "      const auSuivant = dateExt && dateExt > String((livresState.livre.exercice || {}).au || '');",
    apres: "      const auSuivant = false;",
  },
  // ── Le Cabinet sans paquets, dans les mots (brique 38 bis, C14) : ./sans-paquets.txt ──
  ...SANS_PAQUETS,
  // ── La reprise d'un client : l'exercice et sa balance d'ouverture (brique 39, C16 et C17) : ./reprise.txt ──
  ...lireFichier('reprise.txt'),
  ...lireFichier('ecritures.txt'),
  ...lireFichier('revision.txt'),
  ...lireFichier('questions-client.txt'),
  ...lireFichier('cloture.txt'),
  ...lireFichier('equipe.txt'),
  ...lireFichier('relectures.txt'),
  ...lireFichier('fiche-cabinet.txt'),
  ...lireFichier('production.txt'),
  ...lireFichier('cnss.txt'),
  ...lireFichier('abonnements.txt'),
  ...lireFichier('equipe-visite.txt'),
  ...lireFichier('paie-regimes.txt'),
  ...lireFichier('retirer-dossier.txt'),
  ...lireFichier('nom-dossier-tenu.txt'),
  ...lireFichier('liasse-close.txt'),
  ...lireFichier('equipe-trace.txt'),
  ...lireFichier('reprise-v10.txt'),
  ...lireFichier('reprise-portefeuille.txt'),
];
