// @ts-check
// La page d'un PDF en image (1.160.0 ; partagé par l'entreprise et le Cabinet depuis 1.167.0, pour l'aperçu des pièces
// reçues) : un seul fichier, pour que les deux applications ne divergent pas.
(function () {
  'use strict';
  // La bibliothèque vit à côté de ce fichier (tiers/pdfjs), quelle que soit la page qui le charge.
  const ICI = /** @type {HTMLScriptElement | null} */ (document.currentScript)?.src || document.baseURI;
  // (1.160.0, demande de Skander : « si le document est en PDF, l'aperçu doit le montrer aussi ») La première page d'un PDF,
  // dessinée en image ici, dans le navigateur, par pdf.js (Mozilla, Apache 2.0, tiers/pdfjs) : rien ne part. La bibliothèque
  // (1,8 Mo) ne se charge qu'au premier PDF à montrer. Rend { adresse, largeur, hauteur, pages } (une image PNG), ou null si
  // le fichier ne se dessine pas (abîmé, protégé par un mot de passe).
  /** @type {Promise<any> | null} */ let pdfjs = null;
  /** @type {WeakMap<Blob, Map<number, Promise<{ adresse: string, largeur: number, hauteur: number, pages: number } | null>>>} */ const pagesPdf = new WeakMap();
  // (1.163.0) Une autre page que la première, pour le justificatif en grand : `numero` (1 par défaut).
  /** @param {Blob} blob @param {number} [largeur] @param {number} [numero] */
  function pageEnImage(blob, largeur = 900, numero = 1) {
    const parTaille = pagesPdf.get(blob) || new Map();
    pagesPdf.set(blob, parTaille);
    const cle = largeur * 1000 + numero;
    const deja = parTaille.get(cle);
    if (deja) return deja;
    const p = (async () => {
      try {
        if (!pdfjs) {
          const base = new URL('../tiers/pdfjs/', ICI);
          pdfjs = import(new URL('pdf.min.mjs', base).href).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href; return m; });
          pdfjs.catch(() => { pdfjs = null; });
        }
        const lib = await pdfjs;
        const chargement = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
        const doc = await chargement.promise;
        if (numero > doc.numPages) { chargement.destroy(); return null; }
        const page = await doc.getPage(numero);
        const un = page.getViewport({ scale: 1 });
        const vue = page.getViewport({ scale: Math.min(3, largeur / un.width) });
        const toile = document.createElement('canvas');
        toile.width = Math.ceil(vue.width); toile.height = Math.ceil(vue.height);
        const ctx = toile.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, toile.width, toile.height);
        await page.render({ canvasContext: ctx, canvas: toile, viewport: vue }).promise;
        /** @type {Blob | null} */ const image = await new Promise((ok) => toile.toBlob(ok, 'image/png'));
        const pages = doc.numPages;
        chargement.destroy();
        return image ? { adresse: URL.createObjectURL(image), largeur: toile.width, hauteur: toile.height, pages } : null;
      } catch { return null; }
    })();
    parTaille.set(cle, p);
    return p;
  }
  /** @type {any} */ (window).SkanApercuPdf = { pageEnImage };
})();
