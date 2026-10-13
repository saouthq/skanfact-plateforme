// Les mesures du service, pures (serveur/service/mesures.ts ; docs/console.md C12) : une durée tombe dans le seau de sa
// borne, une borne y entre ; « 95 % sous le budget » se lit exactement, parce que chaque budget est une borne ; deux
// minutes s'additionnent seau par seau, jamais par leurs moyennes ; une route qu'on nomme pour sa sorte existe ; une
// panne est un 5xx, jamais un refus écrit. Les comptes sont faits à la main.

import { describe, expect, it } from 'vitest';
import { ajouter, BUDGETS, estPanne, fusionner, histogrammeVide, NB_SEAUX, partSous, quantile, SEAUX_MS, seauDe, SORTE_PAR_ROUTE, sorteDe, total } from '../../serveur/service/mesures.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { routesDuServeur } from '../../serveur/principal.ts';

const avec = (durees: number[]) => {
  const h = histogrammeVide();
  for (const d of durees) ajouter(h, d);
  return h;
};

describe('les mesures du service', () => {
  it('une durée tombe dans le premier seau dont la borne la contient ; une borne y entre', () => {
    expect(seauDe(0)).toBe(0);
    expect(seauDe(1)).toBe(0);
    expect(seauDe(1.01)).toBe(1);
    expect(SEAUX_MS[seauDe(300)]).toBe(300);
    expect(SEAUX_MS[seauDe(300.5)]).toBe(400);
    expect(SEAUX_MS[seauDe(212)]).toBe(250);
    expect(seauDe(60_000)).toBe(SEAUX_MS.length - 1);
    expect(seauDe(60_001)).toBe(NB_SEAUX - 1);
    expect(seauDe(Number.NaN)).toBe(0);
  });

  it('chaque budget écrit est une borne de seau, et une sorte sans budget le dit', () => {
    for (const b of Object.values(BUDGETS)) if (b !== null) expect(SEAUX_MS).toContain(b);
    expect(BUDGETS.ecriture).toBeNull();
    expect(() => partSous(avec([10]), 310)).toThrow(/borne/);
  });

  it('le 95e centile est la borne du seau de la 95e requête sur cent ; sans requête, rien', () => {
    // Quatre-vingt-quinze requêtes en 12 ms (seau 12), cinq en 700 ms (seau 800) : la 95e est encore à 12 ms.
    const h = avec([...Array<number>(95).fill(11), ...Array<number>(5).fill(700)]);
    expect(total(h)).toBe(100);
    expect(quantile(h, 0.95)).toBe(12);
    expect(quantile(h, 0.96)).toBe(800);
    expect(quantile(h, 0.5)).toBe(12);
    expect(quantile(histogrammeVide(), 0.95)).toBeNull();
    expect(quantile(avec([70_000]), 0.95)).toBe(Infinity);
  });

  it('« sous le budget » se compte exactement, une durée égale au budget comprise', () => {
    // 300 ms pile est sous le budget de 300 ; 301 ne l'est pas.
    expect(partSous(avec([300, 301, 100, 299]), 300)).toBe(0.75);
    expect(partSous(histogrammeVide(), 300)).toBeNull();
  });

  it('deux minutes s\'additionnent seau par seau', () => {
    const a = avec([5, 5, 900]);
    const b = avec([5, 2000]);
    const f = fusionner(histogrammeVide(), a);
    fusionner(f, b);
    expect(total(f)).toBe(5);
    expect(f[seauDe(5)]).toBe(3);
    expect(quantile(f, 0.95)).toBe(2000);
    // Une ligne relue de la base (des textes, un trou) ne fausse rien.
    expect(total(fusionner(histogrammeVide(), ['2', '', 'x', '1'] as unknown as number[]))).toBe(3);
  });

  it('une panne est un 5xx ; un refus écrit (4xx) n\'en est pas une', () => {
    expect(estPanne(500)).toBe(true);
    expect(estPanne(503)).toBe(true);
    expect(estPanne(403)).toBe(false);
    expect(estPanne(409)).toBe(false);
    expect(estPanne(200)).toBe(false);
  });

  it('la sorte suit la méthode, sauf les routes nommées ; la console est à part', () => {
    expect(sorteDe('GET', '/entreprises/:entreprise/ventes/factures')).toBe('lecture');
    expect(sorteDe('POST', '/entreprises/:entreprise/ventes/factures')).toBe('ecriture');
    expect(sorteDe('POST', '/entreprises/:entreprise/dossier-v10/ticket')).toBe('caisse');
    expect(sorteDe('GET', '/entreprises/:entreprise/compta/balance')).toBe('comptes');
    expect(sorteDe('GET', '/console/service')).toBe('console');
  });

  it('chaque route nommée pour sa sorte existe parmi les routes du serveur', () => {
    // Le contexte n'est lu qu'au moment de servir : déclarer les routes n'en demande aucun.
    const declarees = new Set(routesDuServeur({} as Contexte, { veille: null }).map((r) => `${r.methode} ${r.chemin}`));
    for (const cle of Object.keys(SORTE_PAR_ROUTE)) expect(declarees, cle).toContain(cle);
  });
});
