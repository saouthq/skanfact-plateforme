// L'instrument de la console, en un exemplaire : un mécanisme de mesure se partage comme un mécanisme de production —
// recopié dans chaque fichier de test, il dériverait (et l'écran qu'un fichier ne mesure pas dérive à son tour). Chaque
// écran nommé s'ouvre en clair et en sombre, à l'ordinateur (1440) et au téléphone (390) ; l'instrument de rendu le
// mesure (tests/instrument-rendu.ts), puis ce que le téléphone seul a montré ; enfin chaque écran s'ouvre en langue
// factice, où tout texte visible vient du catalogue. Ce que chaque fichier fournit : ses écrans (un geste amène une
// fenêtre ou un état), et la façon d'ouvrir une page de SA console — son serveur, sa session, ce qui dit qu'un écran
// est lu. Un geste trouve son bouton par la STRUCTURE de l'écran, jamais par son texte : en langue factice, le texte
// change.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { expect } from 'vitest';
import { problemes } from '../instrument-rendu.ts';

export type EcranConsole = { nom: string; hash: string; geste?: (p: Page) => Promise<void>; sansSession?: boolean };
export type OuvrirConsole = (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => Promise<Page>;

// En langue factice, chaque texte visible vient du catalogue (⟦…⟧), sauf les données (data-donnee) ; chaque nom donné
// aux lecteurs d'écran aussi (tests/web/rendu.test.ts).
export function horsCatalogue(): string[] {
  const pb: string[] = [];
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const texte = (n.textContent ?? '').trim();
    if (!/\p{L}{2,}/u.test(texte) || n.parentElement?.closest('[data-donnee], script, style')) continue;
    if (!texte.includes('⟦')) pb.push(texte.slice(0, 60));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!(el.getAttribute('aria-label') ?? '').includes('⟦')) pb.push(`aria-label « ${el.getAttribute('aria-label')} »`);
  }
  return pb;
}

// Ce que l'instrument de rendu ne mesure pas, et que le téléphone a montré : une carte de liste qui garde sa marge (elle
// s'ajoutait à celle de son contenu : 36 points perdus de chaque côté au lieu de 18). (Le petit graphique des mois d'une
// fiche, qu'il mesurait aussi, a quitté la fiche en 1.19.0.)
export function auTelephone(): string[] {
  const pb: string[] = [];
  for (const c of document.querySelectorAll<HTMLElement>('.c-liste-carte, .c-decider')) {
    const marge = getComputedStyle(c).paddingInlineStart;
    if (marge !== '0px') pb.push(`une carte de liste garde sa marge (${marge}) : ${c.className}`);
  }
  return pb;
}

// Un chiffre tient dans sa tuile, à toutes les largeurs (vu le 14/10/2026 : « 751,700 DT » débordait de 18 points au
// téléphone, sur la tuile voisine). Le texte se mesure par son étendue, pas par sa case : il en déborde sans qu'elle
// grandisse.
export function chiffresDansLeurTuile(): string[] {
  const pb: string[] = [];
  for (const v of document.querySelectorAll<HTMLElement>('.c-tuile-valeur')) {
    const t = v.closest<HTMLElement>('.c-tuile');
    if (!t) continue;
    const r = document.createRange();
    r.selectNodeContents(v);
    const bord = t.getBoundingClientRect().right - Number(getComputedStyle(t).paddingInlineEnd.replace('px', ''));
    const depasse = r.getBoundingClientRect().right - bord;
    if (depasse > 0.5) pb.push(`« ${v.textContent?.trim() ?? ''} » dépasse sa tuile de ${Math.round(depasse)} points`);
  }
  return pb;
}

// Chaque écran, mesuré : ce que l'instrument trouve (vide si rien) et le nombre de pages mesurées dans les deux thèmes
// et les deux largeurs. `telephone` : des écrans qui n'existent qu'au téléphone (le menu) ; `factice` : des écrans
// mesurés seulement en langue factice (l'entrée, sans session) ; `photos` : où ranger une capture de chaque page.
export async function mesurerLaConsole(o: { ecrans: EcranConsole[]; ouvrir: OuvrirConsole; telephone?: EcranConsole[]; factice?: EcranConsole[]; photos?: string }): Promise<{ faux: string[]; vus: number }> {
  const faux: string[] = [];
  let vus = 0;
  if (o.photos) fs.mkdirSync(o.photos, { recursive: true });
  for (const largeur of [1440, 390]) {
    for (const theme of ['clair', 'sombre'] as const) {
      for (const e of [...o.ecrans, ...(largeur < 600 ? o.telephone ?? [] : [])]) {
        const p = await o.ouvrir(e, { largeur, theme });
        await expect.poll(() => p.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        if (e.geste) await e.geste(p);
        await p.waitForTimeout(300);
        const nom = `console-${e.nom}-${largeur}-${theme}`;
        faux.push(...(await p.evaluate(problemes, [largeur < 600, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
        faux.push(...(await p.evaluate(chiffresDansLeurTuile)).map((x) => `${nom} : ${x}`));
        if (largeur < 600) faux.push(...(await p.evaluate(auTelephone)).map((x) => `${nom} : ${x}`));
        if (o.photos) await p.screenshot({ path: path.join(o.photos, `${nom}.png`), fullPage: true });
        vus++;
        await p.context().close();
      }
    }
  }
  for (const e of [...(o.factice ?? []), ...o.ecrans]) {
    const p = await o.ouvrir(e, { largeur: 1440, factice: true });
    if (e.geste) await e.geste(p);
    await p.waitForTimeout(300);
    faux.push(...(await p.evaluate(horsCatalogue)).map((x) => `console-${e.nom}-factice : hors catalogue : ${x}`));
    faux.push(...(await p.evaluate(problemes, [false, 1440] as [boolean, number])).map((x) => `console-${e.nom}-factice : ${x}`));
    await p.context().close();
  }
  return { faux, vus };
}
