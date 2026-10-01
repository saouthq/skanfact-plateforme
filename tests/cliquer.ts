// Un clic qui dit pourquoi il n'a pas pu se faire (brique 108). Dans la vérification de GitHub, un clic qui
// attend en vain ne laissait lire que « waiting for locator(…) » : l'élément manquait-il, ou autre chose le
// recouvrait-il ? On ne voit pas l'écran de la CI. Le message dit donc combien d'éléments répondent, où est le
// premier, ce qui se trouve sous le doigt à sa place, et ce que l'écran montre (adresse, titre, fenêtre ouverte,
// et le texte d'une zone qu'on nomme).
import type { Locator } from 'playwright-core';

export async function cliquer(l: Locator, zone = '', delai = 15_000): Promise<void> {
  try {
    await l.click({ timeout: delai });
    return;
  } catch (e) {
    const n = await l.count().catch(() => -1);
    const dessus = n > 0 ? await l.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const qui = !x ? 'rien (hors de l\'écran)' : x === el || el.contains(x) ? 'lui-même' : x.outerHTML.replace(/\s+/g, ' ').slice(0, 120);
      return `en ${Math.round(r.left)},${Math.round(r.top)}, ${Math.round(r.width)}×${Math.round(r.height)} ; sous le doigt : ${qui}`;
    }).catch(() => '') : '';
    const ecran = await l.page().evaluate((z) => {
      const net = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const fenetre = document.querySelector('#modal-root .modal');
      const zoneEl = z ? document.querySelector(z) : null;
      return [location.hash, `titre « ${net(document.querySelector('#view h1')?.textContent, 60)} »`,
        fenetre ? `fenêtre « ${net(fenetre.textContent, 80)} »` : '', zoneEl ? `${z} : « ${net((zoneEl as HTMLElement).innerText, 120)} »` : ''].filter(Boolean).join(' ; ');
    }, zone).catch(() => '?');
    throw new Error(`clic impossible, ${n} trouvé(s)${dessus ? ` ${dessus}` : ''} — écran : ${ecran}`, { cause: e });
  }
}
