// Le rapport #23 (deux chemins, un chiffre ; 1.388.61) : ce que les écrans de l'entreprise disent de la déclaration du mois,
// de la TVA collectée, de la retenue à venir, du gain de change et des relances. Lu dans le code des écrans (ils ne
// s'exécutent qu'avec un navigateur) ; une preuve (tests/preuves.sh) retire chaque règle pour voir ce test tomber. La
// prévision elle-même (les timbres dans la déclaration) se joue dans tests/moteur/tresorerie-1266.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const lire = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '../..', f), 'utf8');
const app1 = lire('modules/socle/ecrans/entreprise/app-1.js');
const app2 = lire('modules/socle/ecrans/entreprise/app-2.js');

describe('le rapport #23', () => {
  // CHIFFRE-1 : la TVA mois par mois montre le montant de la déclaration, timbres et retenues opérées compris.
  it('la TVA mois par mois dit « À déclarer » : TVA, timbres et retenues opérées, comme l\'écriture du mois', () => {
    expect(app2).toMatch(/const aDeclarer = m => C\.round3\(\(m\.toPay \|\| 0\) \+ \(m\.stamps \|\| 0\) \+ \(m\.withheldOnBuys \|\| 0\)\);/);
    expect(app2).toMatch(/<td class="r nw" data-vm-declarer>\$\{aDeclarer\(m\) \?/);
    expect(app2).toMatch(/<th class="r">TVA à payer<\/th><th class="r" title="[^"]+">À déclarer<\/th>/);
  });

  // CHIFFRE-2 : les Statistiques ne disent plus « à reverser » d'une TVA collectée brute.
  it('les Statistiques disent la TVA collectée sans « à reverser », et où lire ce qui se reverse', () => {
    expect(app2).not.toMatch(/, à reverser, avoirs déduits/);
    expect(app2).toMatch(/Ce que tu reverses vraiment \(moins la TVA de tes achats et ton crédit\) se lit dans Comptabilité › TVA à payer\./);
  });

  // CHIFFRE-5 : la retenue que les clients garderont, et celle que tu garderas, se disent à côté des totaux.
  it('« Reste à encaisser » et « Tu dois » disent l\'écart avec les comptes 411 et 401', () => {
    expect(app2).toMatch(/const rsOpen = C\.round3\(open\.reduce\(\(s, d\) => s \+ \(C\.retenueASubir\(d, data, company\(\)\) \|\| 0\), 0\)\);/);
    expect(app2).toMatch(/\$\{rsOpen > 0\.0005 \? ` · le compte 411 porte \$\{C\.money\(rsOpen, cur\)\} de plus : la retenue que tes clients garderont en payant` : ''\}/);
    expect(app1).toMatch(/const rsAGarderTout = C\.round3\(\(data\.purchases \|\| \[\]\)\.reduce\(\(t, p\) => t \+ C\.toBase\(p, C\.retenueAOperer\(p, company\(\), data\) \|\| 0, company\(\)\), 0\)\);/);
    expect(app1).toMatch(/Tu garderas \$\{nb\(rsAGarderTout\)\} de retenue à la source en payant, pour l'État : le compte 401 de tes écritures porte ce montant en plus/);
  });

  // CHIFFRE-6 : le gain de change d'un règlement se dit d'un règlement.
  it('le gain de change nomme aussi le règlement', () => {
    expect(app2).toMatch(/<div class="sub">règlement, avoir ou acompte à un autre taux que sa pièce<\/div>/);
  });

  // CHIFFRE-7 : « Relancer N factures » compte ce que la page Relances propose (sans les reportées).
  it('le bouton de relance de la Trésorerie compte comme le menu et la page Relances', () => {
    expect(app2).toMatch(/const nbRetards30 = C\.overdueInvoices\(data, company\(\)\)\.filter\(C\.aRelancer\)\.length;/);
    expect(app2).toMatch(/: retards30 > 0 && nbRetards30 > 0 \? \{ id: 'tr-relancer'/);
  });

  // CHIFFRE-4 : la phrase « ton cabinet lit en direct » dit ce qui diffère de sa balance.
  it('la Comptabilité dit en quoi la balance du cabinet peut différer', () => {
    expect(app2).toMatch(/Sa balance peut différer de celle-ci sur deux points : la déclaration du mois n\\'y est que lorsqu\\'il l\\'a passée/);
  });
});
