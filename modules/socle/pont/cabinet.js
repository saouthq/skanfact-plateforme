// @ts-check
// Le pont du socle, côté Cabinet (1.332.0 ; docs/cadrage/17-rangement.md § 3.3 : ce qu'un module demande de neuf au pont
// s'écrit dans son dossier, assemblé à la suite du pont). Le support de SkanFact : le cabinet écrit à l'équipe, relit SES
// demandes et leurs réponses (serveur/support/routes.ts, base 0206). Il parle au serveur par la porte que le pont pose au
// socle (`Socle.porte('pont').appel`) et ajoute `supportEnLigne` à `window.cabinet` : l'écran sait par lui qu'il est en
// ligne (sur le bureau, la même clé n'existe pas, et « Signaler un problème » garde son rapport).
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  // (1.362.5) Un mois que le client a CLÔTURÉ chez lui sans une écriture est un mois vide, pas un mois qui manque. Le cabinet lui
  // réclamait « juillet, août et septembre · rien reçu » et « 8 mois sans écriture » le jour où il venait de les déclarer finis.
  // Le portefeuille porte sa clôture (`clotureClient`, base 0213) ; le pont (`moisVersPaquets`) passe ici ses paquets, et ces
  // mois-là reviennent avec `vide` et le jour de la clôture : du premier mois de ses livres jusqu'au dernier mois clos EN ENTIER,
  // jamais le mois en cours, jamais avant ses livres. Pur : il ne parle à personne, et il sert avant la vérification du cabinet.
  w.SkanMoisClos = Object.freeze({
    /** @param {any} K @param {any[]} paquets @param {{ jusqua: string, le: string | null } | undefined} cloture @returns {any[]} */
    completer(K, paquets, cloture) {
      const premier = paquets.map((p) => p.month).sort()[0];
      const jusqua = cloture && cloture.jusqua ? cloture.jusqua.slice(0, 7) : '';
      // Un mois n'est clos en entier que si la clôture va jusqu'à son dernier jour.
      const finDe = (/** @type {string} */ m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const dernierClos = !jusqua ? '' : finDe(jusqua) === cloture?.jusqua ? jusqua : K.addMonth(jusqua, -1);
      const fini = K.addMonth(K.today().slice(0, 7), -1);
      const fin = dernierClos < fini ? dernierClos : fini;
      if (!premier || !fin || premier > fin) return paquets;
      const vus = new Set(paquets.map((p) => p.month));
      /** @type {any[]} */ const vides = [];
      for (const m of K.monthsBetween(premier, fin)) {
        if (vus.has(m)) continue;
        vides.push({ month: m, label: K.monthLabel(m), definitive: true, receivedAt: Date.parse(String(cloture?.le || '')) || null, generatedAt: null,
          files: 0, missing: [], absent: 0, digest: '', bytes: 0, path: '', sealed: false, appVersion: '',
          figures: { ca: 0, devise: 'DT' }, livre: true, integrity: null, vide: true, closLe: cloture?.le || null });
      }
      return paquets.concat(vides);
    },
  });
  if (!w.cabinet || !w.Socle) return;
  /** @type {(methode: string, chemin: string, corps?: unknown) => Promise<any>} */
  const appel = w.Socle.porte('pont').appel;
  const cabinet = new URLSearchParams(location.search).get('c') || '';
  if (!/^[0-9a-f-]{36}$/.test(cabinet)) return;
  const base = `/cabinets/${cabinet}`;
  w.cabinet.supportEnLigne = Object.freeze({
    // La page « Tes demandes au support » (plateforme/support.js) appelle des chemins `/support…` : ceux du cabinet.
    appel: (/** @type {string} */ methode, /** @type {string} */ chemin, /** @type {unknown} */ corps) => appel(methode, `${base}${chemin}`, corps),
    ecrire: (/** @type {{ sujet: string, texte: string, version?: string | null, page?: string | null }} */ d) => appel('POST', `${base}/support`, d),
    attente: () => appel('GET', `${base}/support/attente`),
  });
  // (1.333.0) Réglages › Données et sécurité › Tes données : ce que la veille du serveur a vu des copies (base 0207), dit par
  // le module partagé avec l'entreprise (plateforme/sauvegardes.js). Une lecture refusée se dit à la place du panneau.
  w.cabinet.dessinerSauvegardes = async (/** @type {HTMLElement} */ el) => {
    /** @type {any} */ let s;
    try { s = await appel('GET', `${base}/sauvegardes`); } catch (x) {
      const p = document.createElement('p');
      p.className = 'small';
      p.setAttribute('role', 'alert');
      p.textContent = x instanceof Error ? x.message : String(x);
      el.replaceChildren(p);
      return;
    }
    el.innerHTML = w.SkanSauvegardes.etat(s);
  };
})();
