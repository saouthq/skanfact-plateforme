// @ts-check
// Lire un tableur dans le navigateur (brique 85 ; 14 § 2.3 : « un tableur : les colonnes sont reconnues par
// leur titre et leur contenu ») : un CSV, ou un classeur Excel (.xlsx). Partagé par l'entreprise
// (plateforme/pont.js : importer ses clients ou son catalogue) et le Cabinet (plateforme/pont-cabinet.js :
// une balance, des écritures) — un seul fichier, qui ne diverge pas.
//
// Un classeur Excel est une archive ZIP : ses fichiers XML se décompressent ici, dans le navigateur (rien
// ne part sur le serveur pour être lu), puis la v10 lit sa première feuille (compta.js, `lireFichierTexte`
// et `texteDeClasseur`, les mêmes que sur l'ordinateur). Plus de 20 Mo pour une entrée, ou de 60 Mo pour le
// classeur, se refuse : un petit fichier peut annoncer des gigaoctets (une « bombe »).

(function () {
  const MAX_ENTREE = 20 * 1024 * 1024;
  const MAX_CLASSEUR = 60 * 1024 * 1024;
  const TROP_GROS = 'Ce classeur est anormalement gros : refusé.';

  /** @param {Uint8Array} corps @param {number} permis ce que l'entrée peut encore occuper */
  async function inflater(corps, permis) {
    const lecteur = new Blob([new Uint8Array(corps)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    /** @type {Uint8Array[]} */ const morceaux = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.length;
      if (total > Math.min(MAX_ENTREE, permis)) { await lecteur.cancel(); throw new Error(TROP_GROS); }
      morceaux.push(value);
    }
    const tout = new Uint8Array(total);
    let o = 0;
    for (const m of morceaux) { tout.set(m, o); o += m.length; }
    return tout;
  }

  // Les entrées XML d'une archive ZIP, décompressées d'avance (la v10 les lit ensuite d'un trait).
  /** @param {Uint8Array} u8 */
  async function dezipper(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let fin = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65535; i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    if (fin < 0) return null;
    const n = dv.getUint16(fin + 10, true);
    if (n > 5000) return null;
    /** @type {{ name: string, data: () => Uint8Array }[]} */ const entrees = [];
    let p = dv.getUint32(fin + 16, true);
    let lu = 0;
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null;
      const methode = dv.getUint16(p + 10, true), taille = dv.getUint32(p + 20, true);
      const lnom = dv.getUint16(p + 28, true), lextra = dv.getUint16(p + 30, true), lcom = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nom = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + lnom));
      const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const corps = u8.subarray(debut, debut + taille);
      // Seuls les fichiers XML servent à lire une feuille : les images et le reste restent fermés.
      const data = /\.(xml|rels)$/.test(nom) ? (methode === 8 ? await inflater(corps, MAX_CLASSEUR - lu) : corps.slice()) : null;
      lu += data ? data.length : 0;
      entrees.push({ name: nom, data: () => { if (!data) throw new Error('entrée non lue'); return data; } });
      p += 46 + lnom + lextra + lcom;
    }
    return entrees;
  }

  // Ce que la v10 lit d'un fichier de tableur : { ok, texte } ou { ok: false, motif } (sa phrase, avec le
  // geste qui marche). Une archive abîmée se lit comme la v10 le dit (« enregistre-le de nouveau ») ; un
  // classeur trop gros se refuse avec sa raison.
  /** @param {Uint8Array} octets @param {string} nom @returns {Promise<{ ok: boolean, texte?: string, motif?: string, classeur?: boolean }>} */
  async function lire(octets, nom) {
    /** @type {any} */ const KC = /** @type {any} */ (window).SkanCompta;
    let entrees = null;
    if (octets[0] === 0x50 && octets[1] === 0x4b) {
      try { entrees = await dezipper(octets); } catch (e) {
        if (e instanceof Error && e.message === TROP_GROS) return { ok: false, motif: TROP_GROS };
        entrees = null;
      }
    }
    return KC.lireFichierTexte(octets, nom, entrees ? { dezipper: () => entrees } : {});
  }

  /** @type {any} */ (window).SkanTableur = { lire, TROP_GROS };
})();
