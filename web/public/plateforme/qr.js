// @ts-check
// Le code QR de la TTN sur la pièce imprimée (brique 83 ; docs/facture-electronique.md). Quand la TTN accepte
// une facture, le serveur pose sur la pièce du dossier sa référence et le contenu de son code QR ; le moteur
// (core.js) les imprime, et dessine le QR par son point d'extension `qrImage`, branché ici sur le dessin des
// codes QR (tiers/qrcode.js : qrcode-generator, MIT, recopié tel quel). Chargé par l'application et par
// l'espace client. Rien ne s'invente : le QR dit, octet pour octet, ce que la TTN a rendu.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {string} texte @returns {string} Un <svg> (22 mm de côté, sa marge blanche comprise), ou rien. */
  function qrImage(texte) {
    const qr = w.qrcode;
    if (typeof qr !== 'function') return '';
    // (Le contenu que rend la TTN est en ASCII, une adresse ou un code ; s'il portait autre chose, l'encodage
    // attendu par les lecteurs est À VÉRIFIER avec la TTN.)
    for (const niveau of ['M', 'L']) {
      try {
        const q = qr(0, niveau);
        q.addData(String(texte));
        q.make();
        return String(q.createSvgTag({ cellSize: 2, margin: 8, scalable: true })).replace('<svg ', '<svg class="ttn-qr" style="width:22mm;height:22mm;flex:none" ');
      } catch {
        // Trop long à ce niveau de correction : on essaie le suivant.
      }
    }
    return '';
  }
  // (1.379.6, docs/leger.md L13) Le dessin des codes QR (10 Ko) ne part plus avec la page de l'entreprise : il se charge
  // à la première pièce qui porte un QR de la TTN, ou à la pose d'une application d'authentification (compte.js).
  const ici = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  /** @type {Promise<void> | null} */
  let enCours = null;
  const charger = () => typeof w.qrcode === 'function' ? Promise.resolve() : (enCours = enCours || new Promise((ok) => {
    const s = document.createElement('script');
    s.src = ici && ici.src ? ici.src.replace(/plateforme\/qr\.js.*$/, 'tiers/qrcode.js') : '../tiers/qrcode.js';
    s.onload = () => ok(); s.onerror = () => { enCours = null; ok(); };
    document.head.appendChild(s);
  }));
  // Le moteur se branche dès qu'il est là (l'application le charge après ce fichier, l'espace client avant).
  const brancher = () => { if (w.SkanCore) w.SkanCore.qrImage = qrImage; };
  w.SkanQr = { qrImage, brancher, charger };
  brancher();
})();
