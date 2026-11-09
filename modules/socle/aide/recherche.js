// @ts-check
// La recherche de l'Aide, la même pour les deux applications (1.332.0). Elle vivait dans l'écran de l'entreprise
// (1.331.0) pendant que le Cabinet gardait la sienne, qui exigeait chaque mot tapé : « comment valider une écriture » n'y
// trouvait aucun article. Deux recherches sur le même genre de corpus finissent par dire deux choses ; celle-ci est une
// seule, et chaque application lui dit seulement où lire le titre, le sous-titre et le corps d'un article (`champs`).
//
// On tape une QUESTION, pas une liste de mots-clés (1.331.0) : les petits mots ne cherchent rien ; un mot se cherche par
// sa racine (« valider » trouve « validé », « congés » trouve « congé ») ; un article qui n'a qu'une partie des mots se
// propose quand même, après ceux qui les ont tous ; le titre pèse plus que le sous-titre, qui pèse plus que le corps.
(function () {
  'use strict';
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);
  // Le pliage du moteur (core.js `plier`) : sans accent, en minuscules, « œ » et « æ » dépliés.
  /** @param {unknown} s */
  const plier = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');
  /** @param {unknown} s */
  const sansBalises = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const MOTS_VIDES = new Set(('a ai as au aux avec c ca ce ces cet cette chez combien comment d dans de des dois doit du '
    + 'elle en es est et etre faire fait faut il ils j je l la le les leur m ma me mes moi mon n ne nos notre on ou par pas '
    + 'peut peux plus pour pourquoi puis puisque qu quand que quel quelle quels quelles qui quoi s sa se ses si son sont sur '
    + 't ta te tes toi ton tu un une veux vos votre vous y').split(' '));
  /** @param {string} m */
  const racine = (m) => { const r = m.replace(/(ements|ement|ations|ation|eurs|euses|euse|ent|ez|er|es|e|s|x)$/, ''); return r.length >= 4 ? r : m; };
  /** @param {string} q @returns {string[]} */
  const mots = (q) => {
    const tous = plier(q || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const pleins = tous.filter((m) => !MOTS_VIDES.has(m));
    return [...new Set((pleins.length ? pleins : tous).map(racine))];
  };
  // Plier sans changer la LONGUEUR (10.12.0) : le surlignage retrouve le mot par sa position dans le texte plié.
  /** @param {unknown} s */
  const plierPareil = (s) => Array.from(String(s || ''), (ch) => { const f = plier(ch); return f.length === ch.length ? f : ch; }).join('');

  /**
   * Les articles qui portent au moins un mot cherché, rangés : tous les mots d'abord, puis le poids, puis l'ordre du fichier.
   * @template T
   * @param {T[]} arts @param {string} q
   * @param {(a: T) => { titre: string, sous: string, corps: string }} champs
   * @returns {T[]}
   */
  function filtre(arts, q, champs) {
    const ms = mots(q);
    if (!ms.length) return arts;
    /** @type {{ a: T, n: number, poids: number, i: number }[]} */ const notes = [];
    arts.forEach((a, i) => {
      const c = champs(a);
      const titre = plier(c.titre), sous = plier(c.sous), corps = plier(sansBalises(c.corps));
      const trouves = ms.filter((m) => titre.includes(m) || sous.includes(m) || corps.includes(m));
      if (!trouves.length) return;
      const poids = trouves.reduce((s, m) => s + (titre.includes(m) ? 4 : sous.includes(m) ? 2 : 1), 0);
      notes.push({ a, n: trouves.length, poids, i });
    });
    return notes.sort((x, y) => y.n - x.n || y.poids - x.poids || x.i - y.i).map((x) => x.a);
  }
  /**
   * L'article porte-t-il TOUS les mots cherchés ? (la liste dit ceux qui les ont tous, et ceux qui n'en ont qu'une partie)
   * @template T @param {T} a @param {string} q @param {(a: T) => { titre: string, sous: string, corps: string }} champs
   */
  function tous(a, q, champs) {
    const c = champs(a);
    const tout = plier(`${c.titre} ${c.sous} ${sansBalises(c.corps)}`);
    return mots(q).every((m) => tout.includes(m));
  }
  /**
   * Surligner les mots cherchés, sans laisser passer de HTML : on découpe, on échappe chaque morceau, on recolle avec des
   * <mark> ; le mot ENTIER où se trouve la racine (« validité », jamais « valid|ité »).
   * @param {string} texte @param {string[]} ms @param {(s: string) => string} esc
   */
  function surligne(texte, ms, esc) {
    if (!ms.length) return esc(texte);
    const bas = plierPareil(texte);
    /** @type {[number, number][]} */ const coupes = [];
    /** @param {number} f */
    const finDuMot = (f) => { while (f < bas.length && /[\p{L}\p{N}]/u.test(bas[f] || '')) f++; return f; };
    ms.forEach((m) => { let k = bas.indexOf(m); while (k >= 0) { const f = finDuMot(k + m.length); coupes.push([k, f]); k = bas.indexOf(m, f); } });
    coupes.sort((x, y) => x[0] - y[0]);
    let out = '', pos = 0;
    coupes.forEach(([d, f]) => {
      if (d < pos) return;
      out += esc(texte.slice(pos, d)) + '<mark>' + esc(texte.slice(d, f)) + '</mark>';
      pos = f;
    });
    return out + esc(texte.slice(pos));
  }
  /**
   * L'extrait : le bout de phrase du corps où le premier mot cherché se trouve, surligné ; « » s'il n'y est pas.
   * @param {string} corps @param {string} q @param {(s: string) => string} esc
   */
  function extrait(corps, q, esc) {
    const ms = mots(q);
    const texte = sansBalises(corps).replace(/\s+([.,)])/g, '$1').trim();
    const bas = plierPareil(texte);
    let i = -1;
    ms.forEach((m) => { const k = bas.indexOf(m); if (k >= 0 && (i < 0 || k < i)) i = k; });
    if (i < 0) return '';
    let d = Math.max(0, i - 55);
    const f = Math.min(texte.length, i + 125);
    if (d > 0) { const e = texte.indexOf(' ', d); if (e > 0 && e < i) d = e + 1; }
    return surligne((d > 0 ? '… ' : '') + texte.slice(d, f).trim() + (f < texte.length ? ' …' : ''), ms, esc);
  }

  w.AideRecherche = Object.freeze({ mots, filtre, tous, surligne, extrait, plier, plierPareil, sansBalises });
})();
