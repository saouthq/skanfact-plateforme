// L'instrument de rendu (12 § 4, 14 § 2.6) : ce qu'il cherche dans une page ouverte. Partagé par les pages de
// l'entreprise (tests/web/rendu.test.ts) et celles du Cabinet (tests/web/cabinet-telephone.test.ts, brique 110) :
// une même règle, mesurée de la même façon des deux côtés. La fonction tourne DANS la page (page.evaluate) : ce
// qu'elle emploie vit en elle.

// Ce que l'instrument cherche dans la page ouverte. `cibles` : les cibles de 44 points ne s'exigent
// qu'au doigt (le téléphone) sur les pages de la v10, dessinées pour la souris sur un ordinateur. `W` : la
// largeur de l'écran. Pas `innerWidth` : un vrai téléphone dézoome une page trop large pour la faire tenir, et
// `innerWidth` grandit avec elle ; mesurée contre lui, une page qui déborde ne débordait jamais (brique 108).
// La page se mesure AU REPOS : ses animations finies (l'entrée d'une page glisse, une bulle grandit) et ses polices
// posées ; une cible mesurée au milieu d'une transformation paraissait plus petite qu'elle n'est (vu en CI le
// 01/10/2026 : « cible de 104×44 » sur la page du groupe, un peu moins de 44 en vrai : l'arrondi le cachait ; la mesure dit désormais ses dixièmes). Une animation sans fin ne s'attend pas.
export async function problemes([cibles, W]: [boolean, number]): Promise<string[]> {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)));
  const pb: string[] = [];
  if (document.documentElement.scrollWidth > W) pb.push(`la page déborde : ${document.documentElement.scrollWidth} points pour ${W}`);
  // Un élément dans un cadre qui défile de côté, ce cadre étant lui-même dans l'écran (la fonction tourne
  // dans la page : ce qu'elle emploie vit en elle).
  const dansUnCadre = (el: Element) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  if (cibles) {
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, [role=button]')) {
      if (!visible(el) || el.closest('[hidden], .combo-pop, #info-pop')) continue;
      // Un lien DANS une phrase (« … à faire dans les Réglages. ») suit la ligne de son texte : la règle des cibles
      // l'exempte (WCAG 2.5.8, « inline »). Seulement un lien en ligne, entouré de son texte (brique 110).
      if (el.matches('a') && getComputedStyle(el).display === 'inline'
        && ((el.parentElement?.textContent ?? '').trim().length - (el.textContent ?? '').trim().length) > 15) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) pb.push(`cible de ${Math.round(r.width * 10) / 10}×${Math.round(r.height * 10) / 10} : ${el.outerHTML.slice(0, 90)}`);
    }
  }
  // Au téléphone, une phrase écrasée dans une colonne trop étroite (un mot par ligne, brique 105 : « Tes premiers
  // pas » à côté de leurs boutons) : un bloc de texte de plus de 60 lettres qui tient dans moins de 140 points.
  if (cibles) {
    for (const el of document.querySelectorAll<HTMLElement>('#view p, #view li, #view .small, #view span')) {
      if (!visible(el) || el.closest('[hidden], .combo-pop, #info-pop, table, .preview, svg')) continue;
      const texte = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      if (texte.length > 60 && r.width < 140 && getComputedStyle(el).display !== 'inline') pb.push(`texte écrasé en ${Math.round(r.width)} points : « ${texte.slice(0, 50)}… »`);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const coupe = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    // Un champ de saisie défile sous le doigt : son texte n'est pas coupé.
    if (coupe && cs.textOverflow !== 'ellipsis' && !el.matches('input, textarea, select') && el.scrollWidth > el.clientWidth + 1 && !el.closest('table, .preview, .doc-page')) pb.push(`texte coupé : <${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}> ${(el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').slice(0, 60)}`);
    const r = el.getBoundingClientRect();
    // Un tableau large défile dans son cadre (telephone.css : les listes, les lignes d'un achat) : ce qui
    // dépasse DANS un cadre qui défile, lui-même dans l'écran, ne sort pas de l'écran.
    if (r.right > W + 1 && cs.position !== 'fixed' && !el.closest('.preview, .doc-page, .combo-pop') && !dansUnCadre(el)) pb.push(`sort de l'écran : <${el.tagName.toLowerCase()}> ${(el.textContent ?? '').slice(0, 40)}`);
  }
  return pb;
}
