// L'instrument de COHÉRENCE (1.365.0, demandé par Skander : « pas que chaque page soit différente, on garde une
// identité et on facilite la création d'habitudes »). L'instrument de rendu (instrument-rendu.ts) juge une page seule :
// rien ne déborde, tout se touche. Celui-ci juge les pages ENTRE ELLES : un titre de page a la même taille partout,
// une carte le même arrondi, un bouton la même hauteur, et chaque couleur vient de la charte.
//
// `releve` s'exécute DANS la page (page.evaluate) : elle ne peut rien appeler d'autre. Elle rend, par famille, la
// signature de chaque objet visible — ce que l'œil compare d'une page à l'autre, et rien de plus.

export interface Releve {
  /** Les couleurs de la charte, lues sur la page (chaque jeton `--sb-*` / `--ch-*`, en rgb). */
  palette: string[];
  /** Par famille, les signatures vues et un exemple de chacune. */
  familles: Record<string, Record<string, string>>;
  /** Les couleurs vues (texte, fond, trait) et un exemple de chacune. */
  couleurs: Record<string, string>;
  /** Combien d'objets ont été lus : un instrument qui ne lit rien dirait « tout va bien ». */
  lus: number;
}

export function releve(): Releve {
  const racine = document.querySelector<HTMLElement>('#view') ?? document.body;
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  // Une mesure d'écran en pixels, au demi-pixel (« 13.5px » → 13.5) : ni argent ni taux.
  const px = (v: string) => Math.round(Number(String(v).replace(/px$/, '')) * 2) / 2 || 0;
  // Une couleur en `rgb(r, g, b)` ; transparente ou presque : ''.
  const toile = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (v: string): string => {
    if (!toile || !v || v === 'transparent') return '';
    toile.clearRect(0, 0, 1, 1); toile.fillStyle = '#000'; toile.fillStyle = v; toile.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = toile.getImageData(0, 0, 1, 1).data;
    if ((a ?? 0) < 250) {
      const m = /rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/.exec(v);
      const alpha = m ? Number((m[1] ?? m[2] ?? '').split(/[,/ ]+/).filter(Boolean)[3] ?? 1) : 1;
      if (alpha < 0.98) return '';
    }
    return `rgb(${r}, ${g}, ${b})`;
  };
  const nomDe = (e: Element) => {
    const h = e as HTMLElement;
    const cl = typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${e.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${cl}`.slice(0, 70);
  };

  // La palette : chaque jeton de couleur de la charte, résolu sur cette page (clair ou sombre).
  const palette = new Set<string>(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
  const sonde = document.createElement('div');
  document.body.appendChild(sonde);
  const jetons = new Set<string>();
  for (const feuille of Array.from(document.styleSheets)) {
    // Une feuille venue d'ailleurs refuse qu'on lise ses règles : elle ne porte pas la charte.
    const regles = ((): CSSRule[] => { try { return Array.from(feuille.cssRules); } catch { return []; } })();
    for (const regle of regles) {
      const st = (regle as CSSStyleRule).style;
      if (!st) continue;
      for (let i = 0; i < st.length; i++) { const n = st.item(i); if (/^--(sb|ch)-/.test(n)) jetons.add(n); }
    }
  }
  for (const j of jetons) {
    sonde.style.color = ''; sonde.style.color = `var(${j})`;
    if (sonde.style.color) { const c = rgb(getComputedStyle(sonde).color); if (c) palette.add(c); }
  }
  sonde.remove();

  const familles: Record<string, Record<string, string>> = {};
  const couleurs: Record<string, string> = {};
  let lus = 0;
  const noter = (famille: string, signature: string, e: Element) => {
    lus++;
    (familles[famille] ??= {})[signature] ??= nomDe(e);
  };
  const teinte = (role: string, v: string, e: Element) => { const c = rgb(v); if (c) couleurs[c] ??= `${role} de ${nomDe(e)}`; };

  const dansRacine = (sel: string) => Array.from(racine.querySelectorAll<HTMLElement>(sel)).filter(visible);

  // Le titre de la page, et les titres de section.
  const h1 = dansRacine('h1')[0];
  if (h1) { const s = getComputedStyle(h1); noter('titre de page', `${px(s.fontSize)}px gras ${s.fontWeight}`, h1); }
  for (const h of dansRacine('h2')) {
    if (h.closest('.modal, [role=dialog]')) continue;
    const s = getComputedStyle(h); noter('titre de section', `${px(s.fontSize)}px gras ${s.fontWeight}`, h);
  }
  // Les boutons : la hauteur, l'arrondi, la taille du texte. Le principal : son fond.
  for (const b of dansRacine('.btn')) {
    const s = getComputedStyle(b), petit = b.classList.contains('btn-sm');
    noter(petit ? 'petit bouton' : 'bouton', `${px(s.minHeight)}px de haut, arrondi ${px(s.borderTopLeftRadius)}, texte ${px(s.fontSize)}px gras ${s.fontWeight}`, b);
    if (b.classList.contains('btn-primary') && !(b as HTMLButtonElement).disabled) noter('bouton principal', `fond ${rgb(s.backgroundColor)}`, b);
  }
  // Les champs de saisie.
  for (const c of dansRacine('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), select, textarea')) {
    const s = getComputedStyle(c);
    if (px(s.borderTopWidth) === 0 && !rgb(s.backgroundColor)) continue;   // un champ nu, dessiné par son conteneur
    noter('champ', `arrondi ${px(s.borderTopLeftRadius)}, trait ${px(s.borderTopWidth)}px ${rgb(s.borderTopColor)}, texte ${px(s.fontSize)}px`, c);
  }
  // Les pastilles d'état.
  for (const b of dansRacine('.badge')) { const s = getComputedStyle(b); noter('pastille', `arrondi ${px(s.borderTopLeftRadius) >= 20 ? 'plein' : px(s.borderTopLeftRadius)}, texte ${px(s.fontSize)}px gras ${s.fontWeight}`, b); }
  // Les en-têtes de tableau.
  for (const th of dansRacine('table th')) {
    if (!(th.textContent ?? '').trim()) continue;
    const s = getComputedStyle(th); noter('en-tête de tableau', `${px(s.fontSize)}px gras ${s.fontWeight} ${s.textTransform} ${rgb(s.color)}`, th);
  }
  // Les CARTES : tout bloc qui se détache du fond par un trait ou un fond, avec des coins arrondis. On ne lit pas un nom
  // de classe : une carte dessinée à la main sous un autre nom est exactement ce que l'instrument doit voir.
  const fondPage = rgb(getComputedStyle(document.body).backgroundColor);
  for (const e of Array.from(racine.querySelectorAll<HTMLElement>('div, section, article, aside, li, a, form'))) {
    const r = e.getBoundingClientRect();
    if (r.width < 180 || r.height < 56 || !visible(e)) continue;
    if (e.closest('table, .modal, [role=dialog], .btn, button, label')) continue;
    const s = getComputedStyle(e), rayon = px(s.borderTopLeftRadius);
    const trait = px(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' ? rgb(s.borderTopColor) : '';
    const fond = rgb(s.backgroundColor);
    if (rayon < 6 || (!trait && (!fond || fond === fondPage) && s.boxShadow === 'none')) continue;
    noter('carte', `arrondi ${rayon}, ${trait ? `trait ${px(s.borderTopWidth)}px` : 'sans trait'}, ${s.boxShadow === 'none' ? 'sans ombre' : 'ombre'}`, e);
  }
  // Les couleurs : le texte, le fond et le trait de tout ce qui se voit.
  for (const e of Array.from(racine.querySelectorAll<HTMLElement>('*'))) {
    if (e.closest('svg, canvas, iframe, [data-couleur-libre]') || !visible(e)) continue;
    const s = getComputedStyle(e);
    if (Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) teinte('texte', s.color, e);
    teinte('fond', s.backgroundColor, e);
    if (px(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') teinte('trait', s.borderTopColor, e);
  }
  return { palette: [...palette], familles, couleurs, lus };
}
