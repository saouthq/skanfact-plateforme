// Les adaptations du code de la v10 (décision de Skander, 28/09/2026 : « récupérer le même code et
// l'adapter »). Le code est copié TEL QUEL par ./reprendre.mjs (npm run reprendre-v10) ; seules ces retouches y
// sont appliquées, chacune avec sa raison. Chaque `avant` doit se trouver UNE fois exactement dans
// son fichier : si une version de la v10 le change, la reprise s'arrête au lieu de deviner.
//
// Règle : une adaptation touche le BRANCHEMENT (le point de contact, les gestes officiels), jamais
// un écran. Ce qui se voit reste la v10.

export const ADAPTATIONS = [
  {
    fichier: 'index.html',
    pourquoi: 'le point de contact avec le serveur se charge avant tout le reste, et la mise en page du téléphone après la feuille de style de la v10',
    avant: '  <link rel="stylesheet" href="style.css">\n',
    apres: '  <link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="../plateforme/telephone.css">\n  <script src="../plateforme/pont.js"></script>\n  <script src="../plateforme/telephone.js"></script>\n',
  },
  {
    fichier: 'app.js',
    pourquoi: 'le repli « navigateur » de la v10 reste le socle du point de contact ; le pont de la plateforme n\'en remplace que ce qu\'il fait autrement (les données viennent du serveur)',
    avant: '  const bridge = window.skanfact || {\n    _mem: null,',
    apres: '  const bridge = Object.assign({\n    _mem: null,',
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
];
