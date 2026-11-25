// 1.388.63 (#25) — l'entreprise par métier : le nom exact tapé, les notes d'honoraires, le titre de lot à l'impression,
// la désignation sur plusieurs lignes.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const racine = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(racine, f), 'utf8');
const APP1 = lire('modules/socle/ecrans/entreprise/app-1.js');

function propositions() {
  const debut = APP1.indexOf('const sansAccents = s =>');
  const fin = APP1.indexOf('function suggererCatalogue(', debut);
  expect(debut).toBeGreaterThan(0);
  expect(fin - debut).toBeLessThan(6000);
  const bac: Record<string, unknown> = {};
  vm.runInNewContext(APP1.slice(debut, fin) + '\nthis.f = propositionsCatalogue;', bac);
  return bac.f as (items: unknown[], q: string, creer: boolean, demandee: boolean) => { shown: { label: string }[] };
}

describe('MET2-3 : le nom exact tapé passe en tête', () => {
  const items = [
    { label: 'Consultation', description: 'Heure de conseil' },
    { label: 'Représentation en justice', description: 'Audience, hors frais et débours' },
    { label: 'Frais et débours', description: 'Avancés pour le compte du client' },
  ];
  it('« Frais et débours » tapé : l\'article de ce nom est le premier proposé', () => {
    const r = propositions()(items, 'Frais et débours', true, false);
    expect(r.shown.map(c => c.label)).toEqual(['Frais et débours', 'Représentation en justice']);
  });
  it('un mot du nom passe avant un mot de la seule description', () => {
    const r = propositions()(items, 'debours', true, false);
    expect(r.shown[0]?.label).toBe('Frais et débours');
  });
  it('à rang égal, l\'ordre du catalogue reste', () => {
    const r = propositions()([{ label: 'Pose A' }, { label: 'Pose B' }], 'pose', true, false);
    expect(r.shown.map(c => c.label)).toEqual(['Pose A', 'Pose B']);
  });
});

describe('MET2-8 : un titre de lot part avec sa première ligne', () => {
  it('sur un devis de 10 lots de 8 postes, aucune page ne finit par un titre de lot', async () => {
    const { ecranDeLaPlateforme } = await import('../moteur/v10.ts');
    const { chromium } = await import('playwright-core');
    const K = ecranDeLaPlateforme('core.js') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    // Plusieurs longueurs de lot : une seule laisserait le hasard de la mise en page décider si un titre tombe en bas.
    const devis = (postes: number) => {
      const lignes: unknown[] = [];
      for (let l = 1; l <= 10; l++) {
        lignes.push({ titre: true, label: `Lot ${l} — Travaux ${l}`, qty: 0, unitPrice: 0, vatRate: 19 });
        for (let i = 1; i <= postes; i++) lignes.push({ label: `Poste ${l}.${i}`, description: 'Fourniture et pose, y compris toutes sujétions de mise en œuvre', qty: 12, unit: 'm²', unitPrice: 48.5, vatRate: 19 });
      }
      const doc = { id: 'd', type: 'devis', number: 'DEV-2026-002', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c',
        subject: 'Villa', lines: lignes, discountRate: 0, withholdingRate: 0, applyStamp: false, stampFee: 1, notes: '', currency: 'DT', payments: [] };
      return K.documentHtml(doc, { id: 'c', name: 'Promoteur Essai' }, { ...K.DEFAULT_COMPANY, name: 'Bâtisseurs Essai' }, { preview: true, zoom: 1 });
    };
    const nav = await chromium.launch();
    try {
      const fautes: string[] = [];
      for (let postes = 2; postes <= 9; postes++) {
        const p = await nav.newPage();
        await p.setContent(devis(postes));
        const r = await p.evaluate(([fit, pag]) => {
          const f = new Function(`return [${fit}, ${pag}]`)();
          f[0](document); const n = f[1](document);
          const fins = Array.from(document.querySelectorAll('.page')).map(pg => { const tr = pg.querySelectorAll('table.lines tbody tr'); const der = tr[tr.length - 1]; return der ? der.className : ''; });
          return { n, titres: document.querySelectorAll('table.lines tr.titre').length, fins };
        }, [String(K.fitToPage), String(K.paginate)]);
        expect(r.titres).toBe(10);
        r.fins.forEach((c: string, i: number) => { if (/\btitre\b/.test(c)) fautes.push(`${postes} postes par lot : page ${i + 1} sur ${r.n}`); });
        await p.close();
      }
      expect(fautes).toEqual([]);
    } finally { await nav.close(); }
  }, 60_000);
});

describe('MET2-6 : une profession libérale lit « Notes d\'honoraires » partout', () => {
  it('le menu et la bande des vues nomment la page comme la pièce', async () => {
    const { ecranDeLaPlateforme } = await import('../moteur/v10.ts');
    const K = ecranDeLaPlateforme('core.js') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const titre = (activity: string) => (K.navPages({ company: { activity }, modules: {} }).find((p: { id: string }) => p.id === 'factures') || {}).titre;
    expect(titre('juridique')).toBe('Notes d\'honoraires');
    expect(titre('informatique')).toBe('Factures');
    const vues = K.vuesDePage({ company: { activity: 'juridique' }, modules: {} }, 'relances');
    if (vues.length) expect(vues[0].titre).toBe('Notes d\'honoraires');
    // La table des pages, elle, ne bouge pas : le nom se calcule, il ne s'écrit pas dans la source partagée.
    expect(K.pageById('factures').titre).toBe('Factures');
  });
  it('la page de la liste prend son nom du métier (titre, bouton, état vide)', () => {
    const debut = APP1.indexOf('const NOM_LF = C.estLiberal(company())');
    expect(debut).toBeGreaterThan(0);
    const bloc = APP1.slice(debut, APP1.indexOf('<ol class="pr-e">', debut));
    expect(bloc).toContain('<h1>${h(NOM_LF.titre)}</h1>');
    expect(bloc).toContain('${h(NOM_LF.nouvelle)} <kbd');
    expect(bloc).toContain('Créer ${h(NOM_LF.premiere)}</button>');
    expect(bloc).not.toMatch(/Créer ma première facture|<h1>Factures<\/h1>/);
  });
});
