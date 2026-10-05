// @ts-check
// Les champs de date du navigateur parlent la langue du NAVIGATEUR : réglé en anglais, un champ `type=date` s'affiche
// et se tape « mm/dd/yyyy », et le 05/10 s'y lit le 10 mai (vu sur le serveur d'essai le 05/10/2026, sur la péremption
// d'un article). La v10 de bureau l'évitait en imposant le français (`--lang=fr-FR`) ; sur le web, chaque champ
// `type=date` devient ici un champ texte JJ/MM/AAAA, quelle que soit la langue du navigateur — comme les autres dates
// de la v10, qui sont déjà des champs texte. Sa valeur, lue ou posée par le code, reste le jour ISO (AAAA-MM-JJ),
// comme celle du champ du navigateur ; une date incomplète ou qui n'existe pas vaut '' (comme dans le champ du
// navigateur), et le champ le dit en quittant la saisie.
(() => {
  const natif = /** @type {{ get: (this: HTMLInputElement) => string, set: (this: HTMLInputElement, v: string) => void }} */ (
    /** @type {unknown} */ (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')));
  // Le jour d'abord, toujours : « 5/10/2026 », « 05-10-26 », « 05.10.2026 », « 05102026 » ; et le jour ISO collé tel
  // quel (« 2026-10-05 », l'année d'abord : il ne se confond avec rien).
  /** @param {string} texte @returns {string} */
  const versIso = (texte) => {
    const t = String(texte || '').trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    const m = iso ? [t, iso[3], iso[2], iso[1]]
      : /^(\d{1,2})[/.\-\s]+(\d{1,2})[/.\-\s]+(\d{4}|\d{2})$/.exec(t) || /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
    if (!m) return '';
    const an = String(m[3]);
    const j = Number(m[1]), mo = Number(m[2]), a = an.length === 2 ? 2000 + Number(an) : Number(an);
    const d = new Date(Date.UTC(a, mo - 1, j));
    if (a < 1900 || d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return '';
    return `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  };
  /** @param {string} iso @returns {string} */
  const versJour = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const AIDE = 'Une date s\'écrit jour/mois/année : 05/10/2026.';
  /** @param {HTMLInputElement} el */
  const adapter = (el) => {
    if (el.dataset.jourMois) return;
    el.dataset.jourMois = '1';
    const iso = natif.get.call(el);
    el.type = 'text';
    el.inputMode = 'numeric';
    el.autocomplete = 'off';
    if (!el.placeholder) el.placeholder = 'JJ/MM/AAAA';
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return versIso(natif.get.call(this)); },
      /** @param {unknown} v */
      set(v) { natif.set.call(this, versJour(String(v ?? '')) || String(v ?? '')); },
    });
    natif.set.call(el, versJour(iso));
    // En quittant la saisie : le jour lu se réécrit JJ/MM/AAAA ; illisible, le champ le dit (avant le code de l'écran,
    // qui lit la valeur juste après).
    el.addEventListener('change', () => {
      const tape = natif.get.call(el).trim();
      const lu = versIso(tape);
      if (lu) natif.set.call(el, versJour(lu));
      const faux = Boolean(tape) && !lu;
      el.title = faux ? AIDE : '';
      if (faux) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      el.style.borderColor = faux ? '#B42318' : '';
    }, true);
  };
  /** @param {Node} noeud */
  const parcourir = (noeud) => {
    if (noeud.nodeType !== 1) return;
    const el = /** @type {Element} */ (noeud);
    if (el.matches('input[type=date]')) adapter(/** @type {HTMLInputElement} */ (el));
    el.querySelectorAll('input[type=date]').forEach((c) => adapter(/** @type {HTMLInputElement} */ (c)));
  };
  new MutationObserver((liste) => liste.forEach((m) => m.addedNodes.forEach(parcourir)))
    .observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => parcourir(document.documentElement));
})();
