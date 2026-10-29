// (1.172.0) Un fichier ZIP écrit dans le navigateur : l'export du classeur d'un client (« Exporter », maquette
// docs/maquettes/cabinet/classeur.html). Les fichiers y sont rangés tels quels, sans compression (des photos et des PDF
// sont déjà compressés) : le format « stocké » du ZIP, que tout ordinateur ouvre. Les noms sont en UTF-8 (le bit 11 le dit),
// les chemins avec « / ». Rien ne part ailleurs : le fichier naît ici et se télécharge.
(function () {
  'use strict';
  /** @type {Uint32Array | null} */ let table = null;
  const crc32 = (/** @type {Uint8Array} */ o) => {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < o.length; i++) c = (table[(c ^ (o[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  // L'heure et le jour du format DOS (à deux secondes près), ceux de l'instant donné, à l'heure de ce poste.
  const dos = (/** @type {Date} */ d) => ({
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    jour: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  });
  /**
   * @param {{ chemin: string, octets: Uint8Array | string }[]} fichiers
   * @param {Date} [quand]
   * @returns {Uint8Array}
   */
  function creer(fichiers, quand = new Date()) {
    const enc = new TextEncoder();
    const { heure, jour } = dos(quand);
    /** @type {Uint8Array[]} */ const parts = [];
    /** @type {Uint8Array[]} */ const centre = [];
    let decalage = 0;
    const vus = new Set();
    for (const f of fichiers) {
      // Deux fichiers du même nom ne s'écrasent pas : le second prend « (2) ».
      let chemin = String(f.chemin).replace(/\\/g, '/').replace(/^\/+/, '');
      for (let n = 2; vus.has(chemin); n++) chemin = String(f.chemin).replace(/(\.[^./]+)?$/, (x) => ` (${n})${x}`);
      vus.add(chemin);
      const nom = enc.encode(chemin);
      const octets = typeof f.octets === 'string' ? enc.encode(f.octets) : f.octets;
      const crc = crc32(octets);
      const tete = new DataView(new ArrayBuffer(30));
      tete.setUint32(0, 0x04034b50, true); tete.setUint16(4, 20, true); tete.setUint16(6, 0x0800, true); tete.setUint16(8, 0, true);
      tete.setUint16(10, heure, true); tete.setUint16(12, jour, true); tete.setUint32(14, crc, true);
      tete.setUint32(18, octets.length, true); tete.setUint32(22, octets.length, true); tete.setUint16(26, nom.length, true); tete.setUint16(28, 0, true);
      parts.push(new Uint8Array(tete.buffer), nom, octets);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, heure, true); c.setUint16(14, jour, true); c.setUint32(16, crc, true); c.setUint32(20, octets.length, true);
      c.setUint32(24, octets.length, true); c.setUint16(28, nom.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
      c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, decalage, true);
      centre.push(new Uint8Array(c.buffer), nom);
      decalage += 30 + nom.length + octets.length;
    }
    const tailleCentre = centre.reduce((t, x) => t + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, tailleCentre, true); fin.setUint32(16, decalage, true);
    const tout = [...parts, ...centre, new Uint8Array(fin.buffer)];
    const sortie = new Uint8Array(tout.reduce((t, x) => t + x.length, 0));
    let i = 0;
    for (const x of tout) { sortie.set(x, i); i += x.length; }
    return sortie;
  }
  /** @type {any} */ (window).SkanZip = { creer, crc32 };
})();
