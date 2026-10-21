// Le PDF fait par le serveur (lot Fonctions 3 ; 12 § 2 : « la page HTML de la pièce, imprimée par un Chromium sans
// écran » ; docs/pdf.md). Dans un navigateur, « PDF » ouvrait la fenêtre d'impression : le fichier dépendait du
// navigateur, et un téléphone n'en faisait souvent rien. Le serveur imprime la page que l'écran a dessinée (le même
// gabarit, `documentHtml` et les autres) comme l'application de bureau v10 : une fenêtre de 800 × 600, les marges et la
// pagination de `fitToPage` et `paginate` (core.js, pris à la même source que l'écran), A4 sans marge.
//
// Enfermé : la page ne lance aucun script à elle (JavaScript coupé ; seules les deux fonctions de core.js tournent, du
// serveur), ne joint rien (hors ligne, chaque demande refusée ; une image ou une police de la page doit y être
// intégrée), et ne lit aucun fichier de la machine. Le serveur ne lit rien dans la base : il imprime ce que la personne
// voit déjà.
//
// La file : au plus `simultanees` impressions à la fois, les suivantes attendent leur tour (au plus `attente` en file,
// et `attenteMs`) ; au-delà, « occupé ». Chromium se lance à la première impression, et reste là.

import type { Browser } from 'playwright-core';
import { codeDeLEcran } from '../v10/teif.ts';

export type Imprime = { pdf: Buffer; pages: number };
export type Moteur = (html: string) => Promise<Imprime>;
export type Imprimeur = { imprimer: Moteur; arreter: () => Promise<void> };

export class ImprimeurOccupe extends Error {}
export class ImpressionImpossible extends Error {}
export class ImpressionTropLongue extends Error {}

type Core = { fitToPage: (d: unknown) => void; paginate: (d: unknown) => void };

export type Reglages = { ms?: number; simultanees?: number; attente?: number; attenteMs?: number };

// Le nombre de pages d'un PDF, par ses objets « /Type /Page » (pas « /Pages », l'arbre qui les range).
export function pagesDe(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

// Le moteur réel : Chromium (celui de Playwright, PLAYWRIGHT_BROWSERS_PATH ; ou `navigateur`, un chemin donné).
export function moteurDuServeur(r: { ms?: number; navigateur?: string | null } = {}): { imprimer: Moteur; arreter: () => Promise<void> } {
  const ms = r.ms ?? 20_000;
  let lance: Promise<Browser> | null = null;
  const navigateur = async (): Promise<Browser> => {
    lance ??= (async () => {
      const { chromium } = await import('playwright-core');
      return chromium.launch({ ...(r.navigateur ? { executablePath: r.navigateur } : {}), timeout: ms });
    })();
    try { return await lance; } catch (e) {
      // Rien à relancer au hasard : la prochaine impression réessaie (un navigateur posé entre-temps).
      lance = null;
      throw new ImpressionImpossible('navigateur-absent', { cause: e });
    }
  };
  const C = () => codeDeLEcran<Core>('core.js');
  return {
    imprimer: async (html) => {
      const b = await navigateur();
      const cx = await b.newContext({ javaScriptEnabled: false, offline: true, viewport: { width: 800, height: 600 } });
      try {
        await cx.route('**/*', (route) => route.abort());
        const page = await cx.newPage();
        page.setDefaultTimeout(ms);
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: ms });
          // Comme l'aperçu et la v10 : marges resserrées si le contenu déborde d'un peu, puis de vraies pages A4.
          await page.evaluate(`(${C().fitToPage.toString()})(document)`);
          await page.evaluate(`(${C().paginate.toString()})(document)`);
          const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' }, preferCSSPageSize: true });
          return { pdf, pages: pagesDe(pdf) };
        } catch (e) {
          if (e instanceof Error && e.name === 'TimeoutError') throw new ImpressionTropLongue('chromium', { cause: e });
          throw new ImpressionImpossible('chromium', { cause: e });
        }
      } finally {
        await cx.close().catch(() => undefined);
      }
    },
    arreter: async () => {
      const l = lance;
      lance = null;
      if (l) await (await l.catch(() => null))?.close().catch(() => undefined);
    },
  };
}

// La file : un créneau se passe de main en main, jamais deux impressions de plus que permis.
export function creerImprimeur(moteur: { imprimer: Moteur; arreter?: () => Promise<void> }, r: Reglages = {}): Imprimeur {
  const simultanees = r.simultanees ?? 2;
  const attente = r.attente ?? 8;
  const attenteMs = r.attenteMs ?? 60_000;
  let actives = 0;
  const file: { ok: () => void; ko: (e: Error) => void }[] = [];
  return {
    imprimer: async (html) => {
      if (actives < simultanees) actives++;
      else {
        if (file.length >= attente) throw new ImprimeurOccupe('file-pleine');
        await new Promise<void>((ok, ko) => {
          const place = { ok: () => { clearTimeout(minuterie); ok(); }, ko };
          const minuterie = setTimeout(() => {
            const i = file.indexOf(place);
            if (i >= 0) file.splice(i, 1);
            ko(new ImprimeurOccupe('attente'));
          }, attenteMs);
          file.push(place);
        });
      }
      try { return await moteur.imprimer(html); } finally {
        const suivant = file.shift();
        if (suivant) suivant.ok(); else actives--;
      }
    },
    arreter: async () => { await moteur.arreter?.(); },
  };
}

export function imprimeurDuServeur(r: Reglages & { navigateur?: string | null } = {}): Imprimeur {
  return creerImprimeur(moteurDuServeur(r), r);
}
