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
    fichier: "index.html",
    pourquoi: "le point de contact avec le serveur se charge avant tout le reste (précédé du poste, qui garde la copie pour le hors-ligne, brique 72), et la mise en page du téléphone après la feuille de style de la v10 ; l'application s'installe (son manifeste) ; le dessin des codes QR (brique 83) se charge avec lui ; la virgule est la décimale des champs de nombre, et une date s'écrit jour/mois/année, quelle que soit la langue du navigateur (ce que la v10 de bureau obtenait par `--lang=fr-FR`)",
    avant: "  <link rel=\"stylesheet\" href=\"style.css\">\n",
    apres: "  <link rel=\"stylesheet\" href=\"style.css\">\n  <link rel=\"manifest\" href=\"/manifest.webmanifest\">\n  <link rel=\"stylesheet\" href=\"../plateforme/telephone.css\">\n  <script src=\"../tiers/qrcode.js\"></script>\n  <script src=\"../plateforme/qr.js\"></script>\n  <script src=\"../plateforme/virgule.js\"></script>\n  <script src=\"../plateforme/dates.js\"></script>\n  <script src=\"../plateforme/poste.js\"></script>\n  <script src=\"../plateforme/tableur.js\"></script>\n  <script src=\"../plateforme/pont.js\"></script>\n  <script src=\"../plateforme/telephone.js\"></script>\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'à la caisse, « + Nouvel article » ouvre « Nouvel article » : la fiche disait « Nouvelle prestation » à un commerçant qui vend des marchandises (vu sur le serveur d\'essai le 05/10/2026)',
    avant: "        $('#cs-new-art').onclick = () => catalogForm(null, () => vers('#/caisse')());",
    apres: "        $('#cs-new-art').onclick = () => catalogForm(null, () => vers('#/caisse')(), { titre: 'Nouvel article' });",
  },
  {
    fichier: 'app.js',
    pourquoi: 'les nouveautés de la v10 sont celles de l\'application de bureau : la plateforme ne les montre pas (vu sur le serveur d\'essai le 05/10/2026 : « Nouveau dans SkanFact 10.15.0 » s\'ouvrait chez qui avait retenu la version « dev »)',
    avant: "      const presentee = typeof Nouveautes !== 'undefined' && Nouveautes.presenter({",
    apres: "      const presentee = typeof Nouveautes !== 'undefined' && !bridge.sansNouveautesV10 && Nouveautes.presenter({",
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
  // ── L'espace client (brique 77 ; docs/espace-client.md) : sur une facture ou un avoir émis, « Lien pour
  // le client… » dans « Plus » ; la fenêtre est celle du point de contact, dessinée avec la `modal` de la v10.
  {
    fichier: 'app.js',
    pourquoi: 'une pièce émise se partage avec son client par un lien secret (l\'espace client)',
    avant: "            <div class=\"ml-ligne\"><button id=\"wa\">Envoyer par WhatsApp…</button>${info('wa.envoi')}</div>\n",
    apres: "            <div class=\"ml-ligne\"><button id=\"wa\">Envoyer par WhatsApp…</button>${info('wa.envoi')}</div>\n            ${locked && (isInv || isAv) && doc.status !== 'annulée' && !C.estTicket(doc) && bridge.lienClient ? '<button id=\"lien-client\">Lien pour le client…</button>' : ''}\n",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le bouton « Lien pour le client… » ouvre la fenêtre du point de contact',
    avant: "    if ($('#wa')) $('#wa').onclick = envoyerPar(sendByWhatsApp, 'Envoyer par WhatsApp');\n",
    apres: "    if ($('#wa')) $('#wa').onclick = envoyerPar(sendByWhatsApp, 'Envoyer par WhatsApp');\n    if ($('#lien-client')) $('#lien-client').onclick = () => bridge.lienClient(docById(doc.id) || doc, modal);\n",
  },
  // ── Tes appareils (brique 74 ; docs/hors-ligne.md, H9) et ce qu'un appareil retiré a remis (brique
  // 74 bis, H10) : des panneaux des Paramètres, dessinés par le point de contact (comme « Ton cabinet
  // comptable ») ; la v10 de l'ordinateur ne les a pas.
  {
    fichier: 'app.js',
    pourquoi: 'les panneaux « Tes appareils », « Services connectés » (brique 134) et « Remis par un appareil retiré » ont leur entrée (onglet Données, recherche des réglages), posée seulement quand le point de contact sait les dessiner (et, pour le second, qu\'une remise attend)',
    avant: "    'p-dossiers': { onglet: 'donnees',",
    apres: "    'p-quarantaine': { onglet: 'donnees', titre: 'Remis par un appareil retiré', mots: 'appareil retire quarantaine remis hors ligne accepter rejeter changement attente', visible: () => !!(bridge.quarantaine && bridge.quarantaine()) },\n    'p-appareils': { onglet: 'donnees', titre: 'Tes appareils', mots: 'appareil ordinateur telephone perdu vole retirer session connexion hors ligne copie', visible: () => !!bridge.dessinerAppareils },\n    'p-services': { onglet: 'donnees', titre: 'Services connectés', mots: 'service connecte boutique skanecom cle api partenaire couper acces relier', visible: () => !!bridge.dessinerServices },\n    'p-dossiers': { onglet: 'donnees',",
  },
  {
    fichier: 'app.js',
    pourquoi: 'les panneaux « Remis par un appareil retiré » (s\'il y a une remise à décider) et « Tes appareils » se posent en tête de l\'onglet Données',
    avant: "      ${panneau('p-dossiers', info('data.dossiers'))}\n",
    apres: "      ${bridge.quarantaine && bridge.quarantaine() ? `${panneau('p-quarantaine')}<div id=\"quarantaine-panel\"></div></div>` : ''}\n      ${bridge.dessinerAppareils ? `${panneau('p-appareils')}<div id=\"appareils-panel\"></div></div>` : ''}\n      ${bridge.dessinerServices ? `${panneau('p-services')}<div id=\"services-panel\"></div></div>` : ''}\n      ${panneau('p-dossiers', info('data.dossiers'))}\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le point de contact dessine ses panneaux quand les Paramètres s'ouvrent",
    avant: "    drawCabinetPair();\n    drawLicencePanel();\n",
    apres: "    drawCabinetPair();\n    if (bridge.dessinerQuarantaine && $('#quarantaine-panel')) bridge.dessinerQuarantaine($('#quarantaine-panel'));\n    if (bridge.dessinerAppareils && $('#appareils-panel')) void bridge.dessinerAppareils($('#appareils-panel'));\n    if (bridge.dessinerServices && $('#services-panel')) void bridge.dessinerServices($('#services-panel'));\n    if (bridge.dessinerPaiement && $('#paiement-panel')) void bridge.dessinerPaiement($('#paiement-panel'));\n    if (bridge.dessinerSignataire && $('#signataire-panel')) void bridge.dessinerSignataire($('#signataire-panel'));\n    if (bridge.dessinerTtn && $('#ttn-panel')) void bridge.dessinerTtn($('#ttn-panel'));\n    drawLicencePanel();\n",
  },
  // ── Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md) : son panneau dans l'onglet Documents
  // (dessiné par le point de contact), et le mode de règlement « Paiement en ligne » (celui que le
  // serveur pose sur un paiement prouvé par le prestataire).
  {
    fichier: 'app.js',
    pourquoi: 'le panneau « Paiement en ligne » a son entrée (onglet Documents, recherche des réglages), posée seulement quand le point de contact sait le dessiner',
    avant: "    'p-caisse': { onglet: 'documents',",
    apres: "    'p-paiement': { onglet: 'documents', titre: 'Paiement en ligne', mots: 'paiement en ligne konnect carte portefeuille payer client espace lien encaisser', visible: () => !!bridge.dessinerPaiement },\n    'p-caisse': { onglet: 'documents',",
  },
  {
    fichier: 'app.js',
    pourquoi: 'le panneau « Paiement en ligne » se pose avant « Caisse et tickets »',
    avant: "        ${panneau('p-caisse')}\n",
    apres: "        ${bridge.dessinerPaiement ? `${panneau('p-paiement')}<div id=\"paiement-panel\"></div></div>` : ''}\n        ${panneau('p-caisse')}\n",
  },
  {
    fichier: 'core.js',
    pourquoi: 'un paiement reçu en ligne se lit « Paiement en ligne » (le mode que le serveur pose sur un paiement prouvé par le prestataire)',
    avant: "['carte', 'Carte'], ['autre', 'Autre']];",
    apres: "['carte', 'Carte'], ['en_ligne', 'Paiement en ligne'], ['autre', 'Autre']];",
  },
  // ── La facture électronique (brique 80 ; docs/facture-electronique.md) : le réglage « soumise », ce qui empêche
  // le fichier dit avant le numéro, et « Fichier pour El Fatoora » qui télécharge le fichier du serveur.
  {
    fichier: "app.js",
    pourquoi: "le réglage « soumise à la facture électronique » a son entrée (onglet Documents, recherche des réglages), posée quand le point de contact sait lire le fichier du serveur",
    avant: "    'p-paiement': { onglet: 'documents',",
    apres: "    'p-efacture': { onglet: 'documents', titre: 'Facture électronique (El Fatoora)', mots: 'facture electronique el fatoora ttn teif xml signature soumis obligation matricule', visible: () => !!bridge.teifDuServeur },\n    'p-paiement': { onglet: 'documents',",
  },
  {
    fichier: "app.js",
    pourquoi: "le panneau « Facture électronique (El Fatoora) » : l'entreprise dit si elle y est soumise (un champ de la fiche), qui signe, et son compte El Fatoora (dessinés par le point de contact, briques 81 et 82) ; il se pose avant celui du paiement en ligne",
    avant: "        ${bridge.dessinerPaiement ? `${panneau('p-paiement')}",
    apres: "        ${bridge.teifDuServeur ? `${panneau('p-efacture', info('set.efacture'))}\n          <label class=\"check\"><input type=\"checkbox\" name=\"efacture\" ${c.efacture ? 'checked' : ''}> Mon entreprise est soumise à la facture électronique</label>\n          <p class=\"small muted mt\">SkanFact écrit le fichier TEIF de chaque facture et de chaque avoir à l'émission, avec les montants de la pièce. Soumise, ton entreprise ne peut pas émettre une pièce dont le fichier serait refusé (ton matricule, l'identifiant du client) : SkanFact le dit avant de prendre le numéro, avec le bouton qui corrige. Chaque pièce émise se signe ensuite avec DigiGo (« Signer (DigiGo)… », dans son menu « Plus ») ; signée, elle part d'elle-même à la TTN, avec le compte El Fatoora de l'entreprise. Qui est soumis, et depuis quand : À VÉRIFIER avec ton comptable (loi de finances 2026, art. 53).</p>${bridge.dessinerSignataire ? '<div id=\"signataire-panel\"></div>' : ''}${bridge.dessinerTtn ? '<div id=\"ttn-panel\"></div>' : ''}</div>` : ''}\n        ${bridge.dessinerPaiement ? `${panneau('p-paiement')}",
  },
  {
    fichier: "app.js",
    pourquoi: "la fenêtre qui dit ce qui empêche le fichier El Fatoora sert aussi AVANT l'émission d'une entreprise soumise",
    avant: "  async function exporterTeif(doc) {\n",
    apres: "  // (plateforme) Ce qui empêche le fichier El Fatoora, avec le bouton qui mène à la case : la fenêtre de\n  // « Fichier pour El Fatoora », qui sert aussi AVANT l'émission d'une entreprise soumise (brique 80).\n  function manquesTeif(bloquants, cl, avant) {\n    modal(`<h2>${avant ? 'Avant d\\'émettre : la facture électronique' : 'Avant le fichier El Fatoora'}</h2>\n      <p>${avant ? 'Ton entreprise est soumise à la facture électronique : rien n\\'est émis, aucun numéro n\\'est pris. ' : ''}La facture électronique identifie l'émetteur et le destinataire par leur matricule fiscal\n      complet. ${bloquants.length > 1 ? 'Ces points empêchent' : 'Ce point empêche'} de fabriquer un fichier que la TTN accepterait :</p>\n      <ul class=\"teif-manques\">${bloquants.map((b, i) => `<li><span>${h(b.message)}</span>${/^(societe|client)[:]?/.test(b.cible) && !(b.cible === 'client' && !cl)\n        ? `<button class=\"btn btn-sm\" data-teif-go=\"${i}\">${b.cible.startsWith('societe') ? 'Ouvrir ma fiche' : 'Ouvrir la fiche du client'}</button>` : ''}</li>`).join('')}</ul>\n      <div class=\"modal-actions\"><button class=\"btn btn-primary\" data-close>Fermer</button></div>`,\n      (root, close) => {\n        $('[data-close]', root).onclick = close;\n        $$('[data-teif-go]', root).forEach(btn => { btn.onclick = () => {\n          const b = bloquants[Number(btn.dataset.teifGo)];\n          close();\n          if (b.cible.startsWith('societe')) { allerParametres('societe', 'p-identite:' + (b.cible.split(':')[1] || 'matricule')); return; }\n          clientForm(cl, () => render());\n          const champ = b.cible.split(':')[1];\n          if (champ) setTimeout(() => { const i = $$(`.modal [name=${champ}]`).pop(); if (i) refus(i, b.message); }, 60);\n        }; });\n      });\n  }\n  // Soumise à la facture électronique, une pièce dont le fichier serait refusé ne s'émet pas : c'est dit\n  // avant le numéro (le serveur le refuserait de toute façon).\n  function bloqueParEfacture(doc) {\n    if (!bridge.teifDuServeur || !company().efacture || !window.SkanTeif || !['facture', 'avoir'].includes(doc.type) || C.estTicket(doc)) return false;\n    const cl = clientById(doc.clientId) || null;\n    const ctl = window.SkanTeif.controleTeif(Object.assign({}, doc, { number: doc.number || 'A-EMETTRE', status: 'envoyée' }), cl, company());\n    if (ctl.ok) return false;\n    manquesTeif(ctl.bloquants, cl, true);\n    return true;\n  }\n  async function exporterTeif(doc) {\n",
  },
  {
    fichier: "app.js",
    pourquoi: "« Fichier pour El Fatoora » dit ce qui manque par la même fenêtre",
    avant: "    if (!r.ok) {\n      modal(`<h2>Avant le fichier El Fatoora</h2>\n        <p>La facture électronique identifie l'émetteur et le destinataire par leur matricule fiscal\n        complet. ${r.bloquants.length > 1 ? 'Ces points empêchent' : 'Ce point empêche'} de fabriquer un fichier que la TTN accepterait :</p>\n        <ul class=\"teif-manques\">${r.bloquants.map((b, i) => `<li><span>${h(b.message)}</span>${/^(societe|client)[:]?/.test(b.cible) && !(b.cible === 'client' && !cl)\n          ? `<button class=\"btn btn-sm\" data-teif-go=\"${i}\">${b.cible.startsWith('societe') ? 'Ouvrir ma fiche' : 'Ouvrir la fiche du client'}</button>` : ''}</li>`).join('')}</ul>\n        <div class=\"modal-actions\"><button class=\"btn btn-primary\" data-close>Fermer</button></div>`,\n        (root, close) => {\n          $('[data-close]', root).onclick = close;\n          $$('[data-teif-go]', root).forEach(btn => { btn.onclick = () => {\n            const b = r.bloquants[Number(btn.dataset.teifGo)];\n            close();\n            if (b.cible.startsWith('societe')) { allerParametres('societe', 'p-identite:' + (b.cible.split(':')[1] || 'matricule')); return; }\n            clientForm(cl, () => render());\n            const champ = b.cible.split(':')[1];\n            if (champ) setTimeout(() => { const i = $$(`.modal [name=${champ}]`).pop(); if (i) refus(i, b.message); }, 60);\n          }; });\n        });\n      return;\n    }\n",
    apres: "    if (!r.ok) { manquesTeif(r.bloquants, cl, false); return; }\n",
  },
  {
    fichier: "app.js",
    pourquoi: "« Fichier pour El Fatoora » télécharge le fichier écrit par le serveur à l'émission (celui qui sera signé et envoyé)",
    avant: "    const r = T.teifXml(doc, cl, company(), { facture: orig });\n",
    apres: "    // (plateforme) Le fichier du serveur, écrit à l'émission : c'est lui qui sera signé et envoyé (brique 80).\n    // Une pièce qui n'en a pas (émise avant, ou d'une entreprise non soumise à la fiche incomplète) : celui de l'écran.\n    const duServeur = bridge.teifDuServeur ? await bridge.teifDuServeur(doc).catch(() => null) : null;\n    const r = duServeur ? { ok: true, xml: duServeur.xml, nom: duServeur.nom, bloquants: [], remarques: T.controleTeif(doc, cl, company()).remarques } : T.teifXml(doc, cl, company(), { facture: orig });\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le fichier téléchargé est dans les Téléchargements (un navigateur ne sait pas le montrer dans un dossier) ; signé (brique 81), il part de lui-même à la TTN (brique 82)",
    avant: "      <p><b>${h(r.nom)}</b> est enregistré. Il reste deux gestes, faits avec les outils de ton entreprise :</p>\n",
    apres: "      <p><b>${h(r.nom)}</b> est ${bridge.teifDuServeur ? 'dans tes Téléchargements' : 'enregistré'}. ${duServeur && duServeur.signe ? `Il est signé${duServeur.titulaire ? ` par ${h(duServeur.titulaire)}` : ''} (DigiGo).${bridge.ttnDansLaFenetre ? '' : ' Il reste un geste :'}` : bridge.ttnDansLaFenetre ? 'Il reste deux gestes :' : 'Il reste deux gestes, faits avec les outils de ton entreprise :'}</p>\n",
  },
  {
    fichier: "app.js",
    pourquoi: "pas de bouton « Montrer le fichier » dans un navigateur ; l'état de l'envoi à la TTN se dessine dans la fenêtre (brique 82)",
    avant: "      <div class=\"modal-actions\"><button class=\"btn\" id=\"teif-montrer\">Montrer le fichier</button><button class=\"btn btn-primary\" data-close>Fermer</button></div>`,\n      (root, close) => {\n        $('[data-close]', root).onclick = close;\n        $('#teif-montrer', root).onclick = () => { bridge.showInFolder(chemin); };\n      });\n",
    apres: "      <div class=\"modal-actions\">${bridge.teifDuServeur ? '' : '<button class=\"btn\" id=\"teif-montrer\">Montrer le fichier</button>'}<button class=\"btn btn-primary\" data-close>Fermer</button></div>`,\n      (root, close) => {\n        $('[data-close]', root).onclick = close;\n        if ($('#teif-montrer', root)) $('#teif-montrer', root).onclick = () => { bridge.showInFolder(chemin); };\n        if (bridge.ttnDansLaFenetre && $('#teif-ttn', root)) bridge.ttnDansLaFenetre($('#teif-ttn', root), doc, duServeur, close);\n      });\n",
  },
  {
    fichier: "app.js",
    pourquoi: "« Émettre » : une entreprise soumise voit ce qui empêche le fichier AVANT la confirmation",
    avant: "        if (!validate()) return;\n        const n = doc.number || peekNumber(doc.type, doc.date);\n",
    apres: "        if (!validate()) return;\n        if (bloqueParEfacture(doc)) return;\n        const n = doc.number || peekNumber(doc.type, doc.date);\n",
  },
  {
    fichier: "app.js",
    pourquoi: "toute émission (« Émettre et exporter » aussi) passe par le contrôle de la facture électronique",
    avant: "      // Avant `nextNumber` : le compteur est écrit même quand l'enregistrement échoue ensuite. Un\n",
    apres: "      if (bloqueParEfacture(doc)) return false;\n      // Avant `nextNumber` : le compteur est écrit même quand l'enregistrement échoue ensuite. Un\n",
  },
  {
    fichier: "guide.js",
    pourquoi: "le réglage de la facture électronique et « Signer (DigiGo)… » ont leur aide",
    avant: "    'ed.teif': {",
    apres: "    'set.efacture': { t: 'Facture électronique (El Fatoora)', d: 'Coche si ton entreprise doit émettre ses factures en électronique (loi de finances 2026, art. 53 : les prestataires de services ; qui exactement, et depuis quand : À VÉRIFIER avec ton comptable). SkanFact écrit le fichier TEIF de chaque facture et de chaque avoir à l\\'émission. Soumise, une pièce dont le fichier serait refusé ne s\\'émet pas, et SkanFact dit pourquoi avant de prendre le numéro. Non soumise, tes pièces s\\'émettent comme avant, et leur fichier s\\'écrit quand ta fiche et celle du client le permettent.' },\n    'ed.signer': { t: 'Signer (DigiGo)', d: 'Signe le fichier El Fatoora de cette pièce (celui que SkanFact a écrit à l\\'émission) avec le certificat DigiGo de ton signataire, chez TunTrust. Un code arrive sur SON téléphone : rien ne se signe sans lui. Le signataire se désigne dans Paramètres → Documents. Une pièce signée ne se signe plus : « Fichier pour El Fatoora » télécharge alors le fichier signé, celui qui se dépose à la TTN.' },\n    'ed.teif': {",
  },
  // ── La signature DigiGo (brique 81 ; docs/facture-electronique.md) : « Signer (DigiGo)… » sur une pièce émise
  // (la fenêtre est celle du point de contact), et la fenêtre du fichier qui sait qu'il est signé.
  {
    fichier: "app.js",
    pourquoi: "« Signer (DigiGo)… » dans le menu « Plus » d'une facture ou d'un avoir émis, quand le point de contact sait signer",
    avant: "            ${locked && (isInv || isAv) && doc.status !== 'annulée' ? `<div class=\"ml-ligne\"><button id=\"teif\">Fichier pour El Fatoora (TEIF)…</button>${info('ed.teif')}</div>` : ''}\n",
    apres: "            ${locked && (isInv || isAv) && doc.status !== 'annulée' ? `<div class=\"ml-ligne\"><button id=\"teif\">Fichier pour El Fatoora (TEIF)…</button>${info('ed.teif')}</div>` : ''}\n            ${locked && (isInv || isAv) && doc.status !== 'annulée' && !C.estTicket(doc) && bridge.signerPiece ? `<div class=\"ml-ligne\"><button id=\"signer\">Signer (DigiGo)…</button>${info('ed.signer')}</div>` : ''}\n",
  },
  {
    fichier: "app.js",
    pourquoi: "« Signer (DigiGo)… » ouvre la fenêtre du point de contact ; signée, la pièce propose son fichier signé",
    avant: "    if ($('#teif')) $('#teif').onclick = () => exporterTeif(docById(doc.id) || doc);\n",
    apres: "    if ($('#teif')) $('#teif').onclick = () => exporterTeif(docById(doc.id) || doc);\n    if ($('#signer')) $('#signer').onclick = () => bridge.signerPiece(docById(doc.id) || doc, modal, () => exporterTeif(docById(doc.id) || doc));\n",
  },
  {
    fichier: "app.js",
    pourquoi: "la fenêtre du fichier : signée sur la plateforme, l'état de son envoi à la TTN (dessiné par le point de contact, brique 82) à la place des gestes ; sinon, où se signe une pièce, et que SkanFact la déposera",
    avant: "      <ol class=\"teif-suite\">\n        <li><b>Le signer</b> avec ta signature électronique (certificat TunTrust, sur clé ou avec DigiGo).</li>\n        <li><b>Le déposer</b> sur la plateforme El Fatoora de Tunisie TradeNet. Elle te rend la facture\n        validée, avec sa référence et son code QR : c'est elle qui fait foi, garde-la.</li>\n      </ol>\n",
    apres: "      ${duServeur && duServeur.signe && bridge.ttnDansLaFenetre ? '<div id=\"teif-ttn\"></div>' : `<ol class=\"teif-suite\">\n        <li><b>Le signer</b> ${bridge.signerPiece ? 'avec « Signer (DigiGo)… », dans le menu « Plus » de la pièce (ou avec ta clé TunTrust)' : 'avec ta signature électronique (certificat TunTrust, sur clé ou avec DigiGo)'}.</li>\n        ${bridge.ttnDansLaFenetre ? '<li><b>Le déposer</b> : une fois signé, SkanFact le dépose lui-même à la TTN, et te dit ce qu\\'elle en fait.</li>' : `<li><b>Le déposer</b> sur la plateforme El Fatoora de Tunisie TradeNet. Elle te rend la facture\n        validée, avec sa référence et son code QR : c'est elle qui fait foi, garde-la.</li>`}\n      </ol>`}\n",
  },
  // ── La référence de la TTN et son code QR sur la pièce imprimée (brique 83 ; docs/facture-electronique.md).
  {
    fichier: "core.js",
    pourquoi: "la pièce imprimée d'une facture ou d'un avoir accepté par la TTN porte sa référence et son code QR (posés par le serveur, brique 83) ; le QR se dessine par le point d'extension `qrImage`, que la page branche",
    avant: "        ${exoRS ? `<div class=\"info\"><span class=\"k\">${L.withholding}</span><div class=\"terms\">${L.exoRS(escapeHtml(exoRS.numero || ''), fmtDate(exoRS.au))}</div></div>` : ''}\n",
    apres: "        ${exoRS ? `<div class=\"info\"><span class=\"k\">${L.withholding}</span><div class=\"terms\">${L.exoRS(escapeHtml(exoRS.numero || ''), fmtDate(exoRS.au))}</div></div>` : ''}\n        ${doc.ttn && doc.ttn.reference ? `<div class=\"info ttn\"><span class=\"k\">${lang === 'en' ? 'E-invoice' : 'Facture électronique'}</span><div style=\"display:flex;gap:3mm;align-items:center;margin-top:1mm\">${doc.ttn.qr && typeof api.qrImage === 'function' ? api.qrImage(doc.ttn.qr) : ''}<div class=\"terms\">${lang === 'en' ? 'Validated by TTN (El Fatoora)' : 'Validée par la TTN (El Fatoora)'}<br>${lang === 'en' ? 'Reference' : 'Référence'} <b>${escapeHtml(doc.ttn.reference)}</b></div></div></div>` : ''}\n",
  },
  {
    fichier: "core.js",
    pourquoi: "le point d'extension qui dessine un code QR (brique 83) : déclaré ici, vide ; la page de la plateforme et l'espace client le branchent",
    avant: "    planImport, appliquerImport, lireFichierTexte\n  };\n",
    apres: "    planImport, appliquerImport, lireFichierTexte,\n    // (plateforme) Dessiner un code QR : `qrImage(texte)` rend un <svg>. Vide ici ; la page le branche (brique 83).\n    qrImage: null\n  };\n",
  },
  // ── Les envois (brique 79 ; docs/espace-client.md, E7) : un navigateur ne joint pas de fichier ; l'e-mail et
  // le WhatsApp d'une facture ou d'un avoir émis portent le LIEN de la pièce (créé à l'envoi par le point de
  // contact) ; les phrases qui promettaient un PDF joint disent ce qui part vraiment.
  {
    fichier: "app.js",
    pourquoi: "l'e-mail d'une facture ou d'un avoir émis porte le lien de la pièce (un navigateur ne joint pas de fichier) ; la phrase « ci-joint » du modèle se réécrit",
    avant: "    const m = C.emailFor(kind, doc, client, company(), extra, data);\n    const mtitle = ",
    apres: "    const m = C.emailFor(kind, doc, client, company(), extra, data);\n    // (plateforme) Un navigateur ne joint pas de fichier : une facture ou un avoir émis part avec son LIEN,\n    // créé à l'envoi par le point de contact (brique 79).\n    const lien = !!bridge.ajouterLien && C.isLocked(doc) && doc.status !== 'annulée' && !C.estTicket(doc);\n    const corpsOrigine = m.body;\n    if (lien) m.body = bridge.sansPieceJointe(m.body);\n    const mtitle = ",
  },
  {
    fichier: "app.js",
    pourquoi: "la case « Joindre le PDF » devient « Ajouter le lien de la pièce » (rien ne se joint dans un navigateur)",
    avant: "        <label class=\"check\" style=\"align-self:end\"><input type=\"checkbox\" name=\"attach\" checked> Joindre le PDF</label>\n",
    apres: "        ${lien ? `<label class=\"check\" style=\"align-self:end\"><input type=\"checkbox\" name=\"lien\" checked> Ajouter le lien de la pièce ${info('mail.lien')}</label>` : ''}\n",
  },
  {
    fichier: "app.js",
    pourquoi: "la fenêtre de l'e-mail dit ce qui part vraiment : le lien de la pièce, ou rien de joint",
    avant: "      <p class=\"small muted\" id=\"mf-envoi\">${envoiParMail() ? 'Le message s\\'ouvre dans Mail avec le PDF joint : tu le relis et tu cliques sur Envoyer.' : `Le message s'ouvre dans ta messagerie ; le PDF s'affiche dans ${EXPLORATEUR}, pour que tu le glisses dans le message.`} Modèles d'email : Paramètres → Envois.</p>\n",
    apres: "      <p class=\"small muted\" id=\"mf-envoi\">${lien ? 'Le message s\\'ouvre dans ta messagerie : tu le relis et tu cliques sur Envoyer. Un navigateur ne joint pas de fichier : le lien de la pièce s\\'ajoute avant la formule de politesse, et ton client y voit la pièce telle que tu l\\'imprimes, et ce qu\\'il en doit.' : 'Le message s\\'ouvre dans ta messagerie, sans pièce jointe : un navigateur ne sait pas en joindre. Pour envoyer le PDF, le bouton « PDF » de la pièce l\\'enregistre (« Enregistrer au format PDF ») ; joins-le ensuite au message.'} Modèles d'email : Paramètres → Envois.</p>\n",
  },
  {
    fichier: "app.js",
    pourquoi: "décocher le lien rend au message sa phrase d'origine (et le recocher la retire), tant qu'il n'a pas été retouché",
    avant: "      (root, close) => { $('#ok', root).onclick = async () => {\n        const v = formValues($('#mf', root));",
    apres: "      (root, close) => { if (lien) bridge.lienBascule(root, m.body, corpsOrigine); $('#ok', root).onclick = async () => {\n        const v = formValues($('#mf', root));",
  },
  {
    fichier: "app.js",
    pourquoi: "le lien de la pièce se crée à l'envoi (d'un geste) et se place dans le message",
    avant: "          const r = await bridge.composeMail({ to: v.to, subject: v.subject, body: v.body, attachment, mode: modeEnvoi() });\n          if (!client.email) { client.email = v.to; }",
    apres: "          const corps = lien && v.lien ? await bridge.ajouterLien(doc, 'email', v.body, (doc.lang || client.lang || company().defaultLang) === 'en', C.estLiberal(company())) : v.body;\n          const r = await bridge.composeMail({ to: v.to, subject: v.subject, body: corps, attachment, mode: modeEnvoi() });\n          if (!client.email) { client.email = v.to; }",
  },
  {
    fichier: "app.js",
    pourquoi: "l'e-mail ouvert le dit avec son lien",
    avant: "          toast(messageOuvert(r, attachment ? 'le PDF' : null));\n",
    apres: "          toast(corps !== v.body ? 'Message ouvert dans ta messagerie, avec le lien de la pièce' : messageOuvert(r, attachment ? 'le PDF' : null));\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le WhatsApp d'une facture ou d'un avoir émis porte le lien de la pièce ; la phrase « ci-joint » du modèle se réécrit",
    avant: "    const m = C.emailFor(kind, doc, client, company(), extra, data);\n    const titre = ",
    apres: "    const m = C.emailFor(kind, doc, client, company(), extra, data);\n    // (plateforme) Le lien de la pièce au lieu du PDF à glisser (brique 79).\n    const lien = !!bridge.ajouterLien && C.isLocked(doc) && doc.status !== 'annulée' && !C.estTicket(doc);\n    const corpsOrigine = m.body;\n    if (lien) m.body = bridge.sansPieceJointe(m.body);\n    const titre = ",
  },
  {
    fichier: "app.js",
    pourquoi: "la case « Préparer le PDF à glisser » devient « Ajouter le lien de la pièce »",
    avant: "        <label class=\"check\" style=\"align-self:end\"><input type=\"checkbox\" name=\"attach\" checked> <span>Préparer le PDF à glisser</span></label>\n",
    apres: "        ${lien ? `<label class=\"check\" style=\"align-self:end\"><input type=\"checkbox\" name=\"lien\" checked> <span>Ajouter le lien de la pièce</span> ${info('mail.lien')}</label>` : ''}\n",
  },
  {
    fichier: "app.js",
    pourquoi: "la fenêtre du WhatsApp dit ce qui part vraiment",
    avant: "      <p class=\"small muted\">WhatsApp s'ouvre sur la conversation, le message déjà écrit. Un lien ne peut pas y joindre de fichier : le PDF s'affiche dans ${EXPLORATEUR}, glisse-le dans la conversation. Le texte vient du modèle d'email (Paramètres → Envois).</p>\n",
    apres: "      <p class=\"small muted\">WhatsApp s'ouvre sur la conversation, le message déjà écrit. ${lien ? 'Un lien WhatsApp ne porte pas de fichier : le lien de la pièce s\\'ajoute avant la formule de politesse, et ton client y voit la pièce telle que tu l\\'imprimes, et ce qu\\'il en doit.' : 'Un lien WhatsApp ne porte pas de fichier : pour envoyer le PDF, le bouton « PDF » de la pièce l\\'enregistre (« Enregistrer au format PDF ») ; joins-le ensuite à la conversation.'} Le texte vient du modèle d'email (Paramètres → Envois).</p>\n",
  },
  {
    fichier: "app.js",
    pourquoi: "décocher le lien rend au message WhatsApp sa phrase d'origine",
    avant: "        const tel = $('[name=tel]', root);\n",
    apres: "        if (lien) bridge.lienBascule(root, m.body, corpsOrigine);\n        const tel = $('[name=tel]', root);\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le lien de la pièce se crée à l'envoi et se place dans le message WhatsApp",
    avant: "            await bridge.ouvrirWhatsApp({ numero: n.numero, texte: v.body, fichier });\n",
    apres: "            const corps = lien && v.lien ? await bridge.ajouterLien(doc, 'whatsapp', v.body, (doc.lang || client.lang || company().defaultLang) === 'en', C.estLiberal(company())) : v.body;\n            await bridge.ouvrirWhatsApp({ numero: n.numero, texte: corps, fichier });\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le WhatsApp ouvert le dit avec son lien",
    avant: "            toast(fichier ? `WhatsApp s'ouvre sur la conversation : glisse le PDF qui s'affiche dans ${EXPLORATEUR}` : 'WhatsApp s\\'ouvre sur la conversation');\n",
    apres: "            toast(fichier ? `WhatsApp s'ouvre sur la conversation : glisse le PDF qui s'affiche dans ${EXPLORATEUR}` : corps !== v.body ? 'WhatsApp s\\'ouvre sur la conversation, avec le lien de la pièce' : 'WhatsApp s\\'ouvre sur la conversation');\n",
  },
  {
    fichier: "app.js",
    pourquoi: "rien à choisir au premier envoi (la question « Mail ou une autre messagerie » n'a pas d'objet)",
    avant: "  async function messagerie() {\n    if (!SUR_MAC || company().mailClient) return modeEnvoi();\n",
    apres: "  async function messagerie() {\n    // (plateforme) Rien à choisir : le navigateur ouvre la messagerie de l'appareil (brique 79).\n    if (bridge.ajouterLien) return 'mailto';\n    if (!SUR_MAC || company().mailClient) return modeEnvoi();\n",
  },
  {
    fichier: "app.js",
    pourquoi: "Paramètres → Envois dit ce que fait un navigateur (la messagerie de l'appareil, le lien de la pièce), sans choix de messagerie",
    avant: "        ${panneau('p-envoi', SUR_MAC ? '' : info('mail.client'))}${SUR_MAC\n          ? `<div class=\"grid-2\">\n              ${/* 10.14.0 — tant que rien n'est choisi, la liste le DIT : sans cette entrée, « Mail\n                   (Apple) » s'affichait choisi d'office, et le premier enregistrement des Paramètres\n                   — la fiche société, n'importe quoi — l'écrivait pour de bon, en silence : la question\n                   du premier envoi n'arrivait jamais. */''}\n              <label class=\"field\">${lbl('Messagerie', 'mail.client')}<select name=\"mailClient\">${c.mailClient ? '' : '<option value=\"\" selected>Je choisirai au premier envoi</option>'}<option value=\"auto\" ${c.mailClient && c.mailClient !== 'mailto' ? 'selected' : ''}>Mail (Apple) avec le PDF joint</option><option value=\"mailto\" ${c.mailClient === 'mailto' ? 'selected' : ''}>Autre messagerie (mailto, PDF à glisser)</option></select></label>\n            </div>`\n          : `<p class=\"small muted\" id=\"mail-fixe\">Le message s'ouvre dans ta messagerie par défaut, et le PDF s'affiche dans ${EXPLORATEUR} pour que tu le glisses dedans. Sur cet ordinateur, il n'y a rien à régler.</p>`}</div>\n",
    apres: "        ${panneau('p-envoi')}<p class=\"small muted\" id=\"mail-fixe\">Le message s'ouvre dans la messagerie de ton appareil, sans pièce jointe : un navigateur ne sait pas en joindre. Pour une facture ou un avoir émis, SkanFact met dans le message le lien de la pièce : ton client y voit la pièce telle que tu l'imprimes, et ce qu'il en doit ; il la règle en ligne si tu as branché le paiement en ligne (onglet Documents). Il n'y a rien à régler ici.</p></div>\n",
  },
  {
    fichier: "app.js",
    pourquoi: "le relevé envoyé ne prétend pas être joint (un navigateur ne joint pas de fichier)",
    avant: "            close(); toast(messageOuvert(rm, 'le relevé'));\n",
    apres: "            close(); toast(att ? messageOuvert(rm, 'le relevé') : 'Message ouvert dans ta messagerie, sans le relevé : un navigateur ne sait pas le joindre. « Exporter en PDF » l\\'enregistre ; joins-le ensuite au message.');\n",
  },
  {
    fichier: "guide.js",
    pourquoi: "l'aide de l'envoi par WhatsApp dit ce qui part vraiment (le lien de la pièce), et la case du lien a son aide",
    avant: "    'wa.envoi': { t: 'Envoyer par WhatsApp', d: 'Ouvre WhatsApp sur la conversation du client, le message déjà écrit (le même modèle que l\\'email, Paramètres → Envois). Un lien WhatsApp ne peut pas joindre de fichier : SkanFact prépare le PDF et l\\'affiche dans son dossier, tu le glisses dans la conversation.",
    apres: "    'mail.lien': { t: 'Le lien de la pièce', d: 'Un navigateur ne joint pas de fichier : à la place, le message porte le lien de cette facture ou de cet avoir, avant la formule de politesse. Ton client l\\'ouvre sans rien installer : il voit la pièce telle que tu l\\'imprimes et ce qu\\'il en doit, et il la règle en ligne si tu as branché le paiement en ligne (Paramètres → Documents). Le lien se crée quand tu ouvres le message ; il se retrouve, et se retire, dans « Plus » → « Lien pour le client… ».' },\n    'wa.envoi': { t: 'Envoyer par WhatsApp', d: 'Ouvre WhatsApp sur la conversation du client, le message déjà écrit (le même modèle que l\\'email, Paramètres → Envois). Un lien WhatsApp ne porte pas de fichier : pour une facture ou un avoir émis, le message porte le lien de la pièce ; ton client l\\'ouvre, la voit telle que tu l\\'imprimes, et la règle en ligne si tu as branché le paiement en ligne.",
  },
  {
    fichier: "visites.js",
    pourquoi: "la visite de l'envoi ne promet pas un PDF joint",
    avant: "texte: 'SkanFact prépare le mail dans ta messagerie, avec le PDF joint et un texte poli (que tu changes dans Paramètres → Envois).',",
    apres: "texte: 'SkanFact prépare le mail dans ta messagerie, avec un texte poli (que tu changes dans Paramètres → Envois) ; pour une facture ou un avoir émis, avec le lien de la pièce.',",
  },
  {
    fichier: "visites.js",
    pourquoi: "la visite de l'envoi décrit ce qui part (pas de pièce jointe dans un navigateur)",
    avant: "<b>Joindre le PDF</b> : la pièce part telle que ton client la verra, sans le tampon « Brouillon ».",
    apres: "Pas de pièce jointe (un navigateur ne sait pas en joindre) : pour une facture ou un avoir émis, <b>Ajouter le lien de la pièce</b> la montre à ton client telle que tu l\\'imprimes.",
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
    apres: "      // (plateforme) Le serveur émet : numéro, montants en entiers, maillon de la chaîne ; il refuse si\n      // son net à payer n'est pas celui de l'écran. Un refus se dit, et rien n'est émis.\n      try {\n        Object.assign(doc, await bridge.emettre(deepCopy(doc), deepCopy(clientById(doc.clientId) || null), C.computeTotals(doc, company()).netToPay));\n      } catch (e) {\n        // (brique 100) Au-delà de l'encours sans accord : le refus propose de le demander.\n        if (e && e.bouton === 'ventes.accord.demander' && bridge.demanderAccord) demanderAccordPour(doc, e, persist); else toast(plainError(e), true);\n        return false;\n      }\n      doc.status = isInv ? 'envoyée' : 'émis';\n      // L'INSTANT de l'émission",
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
  // L'exemple de la plateforme est l'entreprise d'essai, à part : le pont y mène, et le serveur la remplit du jeu de
  // la v10 la première fois (retour de Skander, 05/10/2026 : elle n'avait que trois clients ; exemple.txt). Une attente
  // dit ce qui se passe pendant ce temps (une minute). `visite` : la visite à lancer une fois l'exemple là.
  {
    fichier: 'app.js',
    pourquoi: '« Voir un exemple » ouvre l\'entreprise d\'essai, remplie de l\'exemple par le serveur, au lieu d\'écrire des pièces inventées dans l\'entreprise ouverte',
    avant: "  async function loadDemo() {\n",
    apres: [
      "  function attenteExemple() {",
      "    let fermer = () => {};",
      "    modal(`<h2>L'exemple se prépare</h2>",
      "      <p>Cinq ans d'une entreprise inventée : ses clients, ses devis, des centaines de factures émises et numérotées par le serveur, leurs règlements, les achats, la paie.</p>",
      "      <p class=\"small muted attente-exemple\" role=\"status\"><span class=\"attente-roue\" aria-hidden=\"true\"></span>Compte une minute : la page s'ouvre toute seule sur l'exemple. Laisse-la ouverte.</p>`, (root, close) => { fermer = close; });",
      "    return () => fermer();",
      "  }",
      "  async function loadDemo(visite) {",
      "    if (bridge.exemple) {",
      "      let fin = null;",
      "      try {",
      "        const r = await bridge.exemple({ visite: typeof visite === 'string' ? visite : '', attendre: () => (fin = attenteExemple()) });",
      "        if (r && r.motif) await infoDialog('L\\'exemple', r.motif);",
      "        return !!(r && r.pret);",
      "      } catch (e) { if (fin) fin(); toast(plainError(e), true); }",
      "      return false;",
      "    }",
      "",
    ].join('\n'),
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
    apres: "        const v = formValues($('#pf2', root));\n        if (enLecture('documents')) return refus($('[name=amount]', root), refusLecture('documents'));\n        if (!(Number(v.amount) > 0)) return refus($('[name=amount]', root), 'Montant invalide.');\n        if (bridge.emettre && (String(v.amount).split('.')[1] || '').length > C.decimalsFor(cur)) return refus($('[name=amount]', root), `Un montant en ${cur} se compte à ${C.decimalsFor(cur)} décimales au plus.`);\n",
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
    apres: "    if ($('#del')) $('#del').onclick = async () => {\n      if (enLecture('purchases')) { toast(refusLecture('purchases', 'supprimé'), true); return; }\n      if (bridge.emettre && data.purchases.some(x => x.achatLie === p.id)) { toast('Un avoir ou un acompte est rattaché à cet achat : détache-le (ou supprime-le) d\\'abord. Rien n\\'a été supprimé.', true); return; }\n      if (!await confirmDialog(`Supprimer ${p.number || 'cette pièce'} ? Les règlements enregistrés seront perdus.`)) return;\n",
  },
  // ── La caisse en ligne (brique 115, docs/caisse.md) ──
  // Un ticket est une facture numérotée sur l'ordinateur : le serveur la refuserait. Sur la plateforme, « Encaisser »
  // passe par le serveur, qui numérote le ticket dans SA série (TIC), le scelle et enregistre son paiement. (Le retour
  // d'un ticket passe par le serveur depuis la brique 124 : caisse-retour.txt.)
  {
    fichier: 'app.js',
    pourquoi: '« Encaisser » passe par le serveur : numéro, sceau et paiement',
    avant: "        if (licenceBlock('Émettre un ticket de caisse', 'caisse')) return;\n",
    apres: "        if (licenceBlock('Émettre un ticket de caisse', 'caisse')) return;\n"
      + "        if (bridge.encaisser) {\n"
      + "          b.dataset.busy = '1';\n"
      + "          // Le numéro vient du serveur : celui que le moteur vient de prendre sur ce poste se rend.\n"
      + "          const compteurs = JSON.stringify(data.counters || {});\n"
      + "          const t = C.ticketDeCaisse(data, company(), s.panier, { mode: s.mode, recu: recu === '' ? null : recu, clientId: s.clientId });\n"
      + "          data.counters = JSON.parse(compteurs); t.number = '';\n"
      + "          bridge.encaisser(t, C.computeTotals(t, company()).netToPay).then(e => {\n"
      + "            data.documents.push(e);\n"
      + "            s.panier = []; s.recu = ''; s.clientId = ''; s.dernierId = e.id;\n"
      + "            const rendu = e.caisse && e.caisse.rendu ? ` — à rendre ${C.money(e.caisse.rendu, cur)}` : '';\n"
      + "            toast(`Ticket ${e.number} encaissé${e.caisseHorsLigne ? ' sans réseau (il partira au serveur au retour du réseau)' : ''}${rendu}`);\n"
      + "          }, x => toast(plainError(x), true)).finally(() => { delete b.dataset.busy; drawTicket(); scan(); });\n"
      + "          return;\n"
      + "        }\n",
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
    pourquoi: 'le point de contact du Cabinet avec le serveur se charge avant tout le reste ; une date s\'y écrit jour/mois/année, quelle que soit la langue du navigateur',
    avant: '  <script src="../rowmenu.js"></script>\n',
    apres: '  <script src="../../plateforme/dates.js"></script>\n  <script src="../../plateforme/tableur.js"></script>\n  <script src="../../plateforme/pont-cabinet.js"></script>\n  <script src="../rowmenu.js"></script>\n',
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
  // ── La lecture d'une facture d'achat en photo ou en PDF, par le serveur (brique 84) ──
  ...lireFichier('lecture-photo.txt'),
  // ── Les commandes livrées en plusieurs fois, et plusieurs bons de livraison en une facture (brique 86) ──
  ...lireFichier('livraisons.txt'),
  // ── Les commandes fournisseurs et leurs réceptions, même partielles (brique 87) ──
  ...lireFichier('commandes-fournisseurs.txt'),
  // ── Le prix par quantité (brique 92) ──
  ...lireFichier('prix-quantite.txt'),
  // ── Les listes de prix, par client ou par catégorie (brique 93) ──
  ...lireFichier('listes-prix.txt'),
  // ── Le stock par dépôt, et les transferts (brique 94) ──
  ...lireFichier('depots.txt'),
  ...lireFichier('kits.txt'),
  ...lireFichier('lots.txt'),
  ...lireFichier('droits.txt'),
  ...lireFichier('accords.txt'),
  ...lireFichier('menu-role.txt'),
  ...lireFichier('lecture-seule.txt'),
  ...lireFichier('telephone.txt'),
  ...lireFichier('compte-hors-ligne.txt'),
  ...lireFichier('petit-ecran.txt'),
  ...lireFichier('cabinet-telephone.txt'),
  ...lireFichier('accueil-role.txt'),
  ...lireFichier('groupe.txt'),
  ...lireFichier('caisse-session.txt'),
  ...lireFichier('caisse-retour.txt'),
  ...lireFichier('caisse-remise.txt'),
  ...lireFichier('caisse-z.txt'),
  ...lireFichier('contrats-seuls.txt'),
  ...lireFichier('bureau.txt'),
  ...lireFichier('efacture-liste.txt'),
  ...lireFichier('comptoir.txt'),
  // ── La caisse tactile (05/10/2026 ; maquette validée par Skander) ──
  ...lireFichier('caisse-tactile.txt'),
  // ── Le lot achats (05/10/2026 ; le parcours d'un commerçant, docs/achats.md) ──
  ...lireFichier('achats-lot.txt'),
  // ── L'exemple rempli et « Faire une facture » (retour de Skander, 05/10/2026 ; docs/exemple.md) ──
  ...lireFichier('exemple.txt'),
  // ── Le lot facture (05/10/2026 ; le parcours d'un commerçant, docs/facture-details.md) ──
  ...lireFichier('facture-details.txt'),
  // ── Le refus d'un matricule montre sa case, et n'en bloque pas d'autres (06/10/2026 ; docs/facture-details.md, E5) ──
  ...lireFichier('matricule-refus.txt'),
  // ── Le lot téléphone (06/10/2026 ; le parcours d'un commerçant au téléphone et sur la tablette, docs/telephone.md) ──
  ...lireFichier('telephone-commercant.txt'),
  ...lireFichier('devis-par-son-lien.txt'),
  ...lireFichier('prix-ttc.txt'),
  ...lireFichier('caisse-sans-compte.txt'),
  // ── Le lot débutant (1) (06/10/2026 ; un commerçant qui débute, à la souris, docs/debutant.md) ──
  ...lireFichier('debutant.txt'),
  // ── Le lot onboarding (09/10/2026 ; décision de Skander, docs/entree.md) : Ton compte ──
  ...lireFichier('compte.txt'),
];
