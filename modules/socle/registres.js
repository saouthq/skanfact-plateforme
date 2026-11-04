// Les registres du socle (docs/cadrage/17-rangement.md § 3.2 et § 3.3 ; lot B0, 04/11/2026). Ce par quoi les modules
// se parlent à l'écran, au lieu de lire chez les autres. Posés VIDES : aucun module ne s'en sert encore ; chaque boîte
// (lots P1b et B) les remplit, et sa fiche (`modules/<m>/module.json`) dit ce qu'elle y met. Servi en premier sur les
// deux pages (l'entreprise et le Cabinet), sous `plateforme/registres.js`, pour que tout script qui suit le trouve.
//
//   - la porte d'un module : `Socle.declarer(module, porte)`, un objet figé, ce qu'il rend public ; un autre la lit par
//     `Socle.porte(module)`. Une porte se déclare une fois ;
//   - un point : le module du haut le déclare (`Socle.declarerPoint(module, point)`, « sorties prévues » de la
//     Trésorerie), ceux du bas le remplissent (`Socle.remplir(point, module, fonction)`), et `Socle.lire(point, …)` rend
//     la suite de leurs listes, dans l'ordre où ils l'ont rempli ; un point que personne ne remplit rend une liste vide ;
//   - un emplacement du socle (une ligne de « À faire », une entrée de la palette, de « Créer », une page, un onglet…) :
//     `Socle.poser(emplacement, module, entree)`, chaque entrée avec son rang d'aujourd'hui (`rang`), pour que l'ordre
//     affiché ne bouge pas ; `Socle.entrees(emplacement)` les rend rangées. Deux entrées au même rang sont refusées ;
//   - un événement : `Socle.annoncer(nom, detail)` et `Socle.ecouter(nom, fonction)`, qui rend de quoi cesser
//     d'écouter. Ce sont les événements de la page (`window`) : les trois d'aujourd'hui (« skanposte »,
//     « skanfact-questions », « skanfact-tickets-remis ») gardent leur nom et leurs écoutes. On annonce seulement après
//     la réponse du serveur ; ce qui se fait dans la même opération reste au serveur.
//
// Chaque refus dit ce qui est refusé et ce qui débloque (une erreur « Socle : … »). `Socle.etat()` dit ce que les
// registres tiennent (le support, les tests). Le code reste court : il part à la première ouverture de chaque page, et
// le rangement ne l'alourdit pas de plus d'un kilo-octet par lot (17 § 4.3).
'use strict';
(function () {
  const w = /** @type {any} */ (window);
  if (w.Socle) return;

  // Les emplacements du socle : les listes que les écrans écrivent encore en dur (17 § 3.3).
  const EMPLACEMENTS = Object.freeze(['a-faire', 'palette', 'creer', 'pages', 'parties-des-pages', 'metiers', 'imports',
    'onglets-compta', 'parametres-cabinet']);
  /** @type {Map<string, Readonly<Record<string, unknown>>>} */
  const portes = new Map();
  /** @type {Map<string, { module: string, remplis: { module: string, f: (...a: unknown[]) => unknown }[] }>} */
  const points = new Map();
  /** @type {Map<string, Readonly<Record<string, unknown> & { module: string, rang: number }>[]>} */
  const places = new Map(EMPLACEMENTS.map((e) => [e, []]));

  /** @param {string} t @returns {never} */
  const refus = (t) => { throw new Error(`Socle : ${t}`); };
  /** @param {string} q @param {unknown} n @returns {string} */
  const nom = (q, n) => (typeof n === 'string' && /^[a-z][a-z0-9-]*$/.test(n) ? n
    : refus(`${q} « ${String(n)} » n'est pas un nom : des minuscules, des chiffres et des tirets.`));
  /** @param {string} q @param {unknown} f */
  const fonction = (q, f) => { if (typeof f !== 'function') refus(`${q} attend une fonction.`); };
  /** @param {string} p */
  const point = (p) => points.get(nom('Le point', p)) || refus(`le point « ${p} » n'est pas déclaré : le module qui en a besoin le déclare (Socle.declarerPoint).`);
  /** @param {string} e */
  const place = (e) => places.get(e) || refus(`l'emplacement « ${String(e)} » n'existe pas : ${EMPLACEMENTS.join(', ')}.`);

  w.Socle = Object.freeze({
    EMPLACEMENTS,
    /** @param {string} module @param {Record<string, unknown>} porte */
    declarer(module, porte) {
      nom('Le module', module);
      if (portes.has(module)) refus(`la porte de « ${module} » est déjà déclarée : une seule par module.`);
      if (!porte || typeof porte !== 'object' || Array.isArray(porte)) refus(`la porte de « ${module} » est un objet.`);
      const figee = Object.freeze({ ...porte });
      portes.set(module, figee);
      return figee;
    },
    /** @param {string} module */
    porte: (module) => portes.get(nom('Le module', module)) || refus(`« ${module} » n'a pas déclaré sa porte (Socle.declarer).`),
    /** @param {string} module @param {string} p */
    declarerPoint(module, p) {
      nom('Le module', module);
      const deja = points.get(nom('Le point', p));
      if (deja) refus(`le point « ${p} » est déjà déclaré par « ${deja.module} ».`);
      points.set(p, { module, remplis: [] });
    },
    /** @param {string} p @param {string} module @param {(...a: unknown[]) => unknown} f */
    remplir(p, module, f) {
      const x = point(p);
      nom('Le module', module);
      if (x.module === module) refus(`« ${module} » ne remplit pas son propre point « ${p} ».`);
      if (x.remplis.some((r) => r.module === module)) refus(`« ${module} » remplit déjà le point « ${p} ».`);
      fonction(`Le point « ${p} »`, f);
      x.remplis.push({ module, f });
    },
    /** @param {string} p @param {...unknown} args @returns {unknown[]} */
    lire(p, ...args) {
      /** @type {unknown[]} */
      const tout = [];
      for (const r of point(p).remplis) {
        const part = r.f(...args);
        if (!Array.isArray(part)) refus(`« ${r.module} » a rempli le point « ${p} » avec autre chose qu'une liste.`);
        tout.push(...part);
      }
      return tout;
    },
    /** @param {string} e @param {string} module @param {Record<string, unknown> & { rang: number }} entree */
    poser(e, module, entree) {
      const liste = place(e);
      nom('Le module', module);
      if (!entree || !Number.isFinite(entree.rang)) refus(`une entrée de « ${e} » porte son rang d'aujourd'hui (un nombre).`);
      const prise = liste.find((x) => x.rang === entree.rang);
      if (prise) refus(`le rang ${entree.rang} de « ${e} » est déjà pris par « ${prise.module} ».`);
      liste.push(Object.freeze({ ...entree, module }));
    },
    /** @param {string} e */
    entrees: (e) => [...place(e)].sort((a, b) => a.rang - b.rang),
    /** @param {string} n @param {unknown} [detail] */
    annoncer: (n, detail) => w.dispatchEvent(new CustomEvent(nom('L\'événement', n), { detail })),
    /** @param {string} n @param {(detail: unknown, e: Event) => void} f @returns {() => void} */
    ecouter(n, f) {
      nom('L\'événement', n);
      fonction(`L'écoute de « ${n} »`, f);
      /** @param {Event} e */
      const h = (e) => f(/** @type {CustomEvent} */ (e).detail, e);
      w.addEventListener(n, h);
      return () => w.removeEventListener(n, h);
    },
    etat: () => ({
      portes: [...portes.keys()],
      points: Object.fromEntries([...points].map(([p, x]) => [p, { module: x.module, remplis: x.remplis.map((r) => r.module) }])),
      emplacements: Object.fromEntries([...places].map(([e, l]) => [e, l.length])),
    }),
  });
})();
