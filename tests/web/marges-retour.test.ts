// L'écran Marges dans la nouvelle DA, et le retour d'une pièce ouverte depuis une fiche (1.261.0, Skander 03/11/2026) :
//   - Marges : l'en-tête des listes (chemin, phrase), les onglets des fiches avec leur nombre, un tableau des factures ;
//     « Où est la marge » n'a plus de tuiles : le chiffre d'affaires, la marge et le coût des ventes sont au pied du tableau ;
//   - une pièce ouverte depuis la fiche d'un fournisseur y ramène : son chemin nomme le fournisseur, et « ‹ » revient à la
//     fiche (il menait aux Achats : « le ux de retour me renvoie vers achat »). Ouverte depuis la liste, elle ramène à la liste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les marges dans la nouvelle DA, et le retour vers la fiche', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-marges-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('Marges : chemin, onglets comptés, pas de tuiles, les chiffres au pied ; une pièce ouverte depuis une fiche y ramène', async () => {
    const email = `marges-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = jour(0);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c-lac', rang: 20, revision: null, contenu: { id: 'c-lac', name: 'Hôtel du Lac' } },
      { collection: 'projects', cle: 'pr1', rang: 21, revision: null, contenu: { id: 'pr1', name: 'Câblage du hall', clientId: 'c-lac', status: 'en cours', startDate: auj } },
      { collection: 'suppliers', cle: 's1', rang: 22, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte', paymentTermsDays: 30 } },
      // L'achat du chantier : 100,250 HT (la marge 183,267 ne tombe pas ronde).
      { collection: 'purchases', cle: 'a1', rang: 23, revision: null, contenu: { id: 'a1', kind: 'facture', number: 'CB-2026-77', date: auj, dueDate: jour(30), supplierId: 's1', projectId: 'pr1',
        currency: 'DT', fees: 0, withholdingRate: 0, createdAt: 5, payments: [], attachments: [], category: 'Achats',
        lines: [{ label: 'Câble', qty: 1, unitPrice: { '~n': '100.25' }, vatRate: 19, destination: 'charge' }] } },
      // (1.263.0) Le salarié dont les heures iront sur le chantier : son coût de l'heure vient de son salaire du contrat.
      { collection: 'employees', cle: 'e1', rang: 24, revision: null, contenu: { id: 'e1', name: 'Mourad Trabelsi', grossSalary: { '~n': '1450.375' }, contract: 'cdi', hireDate: '2019-04-01', active: true } },
    ] });
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: auj, dueDate: jour(30), clientId: 'c-lac', createdAt: 10, projectId: 'pr1',
      subject: 'Câblage', lines: [{ label: 'Câblage', description: '', qty: 1, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
      client: { id: 'c-lac', name: 'Hôtel du Lac' }, revision: null, rang: 30, netAPayer: '337.385' });
    expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/marges`);
    await p.locator('#mg-body tr[data-pid="pr1"]').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // 1. L'en-tête des listes et les onglets des fiches, chacun avec son nombre.
    expect(net(await p.locator('#view .lf-tete .chemin').innerText())).toBe('Accueil Marges');
    expect(net(await p.locator('#view .lf-tete .sous').innerText())).toBe('Ce que te rapporte chaque chantier, chaque client, chaque contrat');
    expect(await p.locator('#mg-tabs [role="tab"]').evaluateAll((l) => l.map((b) => `${(b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}${b.getAttribute('aria-selected') === 'true' ? ' *' : ''}`)))
      .toEqual(['Affaires 1 *', 'Où est la marge', 'Contrats', 'Seuil de rentabilité']);
    // L'affaire : vendu, acheté, la marge et son taux, au pied le total.
    const ligne = net(await p.locator('#mg-body tr[data-pid="pr1"]').innerText());
    expect(ligne).toBe('Câblage du hall HL Hôtel du Lac en cours 283,517 100,250 183,267 64,6 % 0,000');
    expect(await p.locator('#mg-an').isHidden()).toBe(true);
    // Les onglets sont ceux de la Paie (la barre segmentée), pas des onglets soulignés.
    expect(await p.locator('#mg-tabs').getAttribute('class')).toContain('pa-seg');
    // Les statuts comptés ; un statut sans affaire le dit, « Tout revoir » rend la liste.
    expect(await p.locator('#mg-body [data-pst]').allInnerTexts().then((l) => l.map(net))).toEqual(['Toutes 1', 'En cours 1', 'Terminée 0', 'Annulée 0']);
    await p.locator('#mg-body [data-pst="terminée"]').click();
    await expect.poll(() => p.locator('#mg-body tr[data-pid]').count()).toBe(0);
    expect(net(await p.locator('#mg-body .mg-vide b').innerText())).toBe('Aucune affaire ne correspond');
    await p.locator('#mg-tout').click();
    await expect.poll(() => p.locator('#mg-body tr[data-pid]').count()).toBe(1);
    // La recherche lit le nom du client.
    await p.locator('#mg-q').fill('lac');
    await expect.poll(() => p.locator('#mg-body tr[data-pid]').count()).toBe(1);
    await p.locator('#mg-q').fill('moulins');
    await expect.poll(() => p.locator('#mg-body tr[data-pid]').count()).toBe(0);
    await p.locator('#mg-tout').click();
    // La fiche de l'affaire : chemin, statut, le résumé, les onglets Ventes, Achats, Notes.
    await p.locator('#mg-body tr[data-pid="pr1"] td.cn').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().then(net).catch(() => '')).toBe('Câblage du hall');
    expect(net(await p.locator('#view .ed-chemin').innerText())).toBe('Accueil › Marges › Câblage du hall');
    expect(net(await p.locator('#view .mg-resume').innerText())).toMatch(/^Vendu HT i 283,517 DT 1 facture Coût i 100,250 DT achats 100,250 DT Marge i 183,267 DT 64,6 % du prix de vente En caisse i /);
    expect(await p.locator('#p-tabs [data-ong]').evaluateAll((l) => l.map((b) => `${(b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}${b.getAttribute('aria-selected') === 'true' ? ' *' : ''}`))).toEqual(['Ventes 1 *', 'Achats 1', 'Heures', 'Notes']);
    await p.locator('#p-tabs [data-ong="achats"]').click();
    await expect.poll(() => p.locator('#p-buys').isVisible()).toBe(true);
    expect(net(await p.locator('#p-buys').innerText())).toContain('CB-2026-77');
    // (1.262.0) Où en est le chantier : facturé sur prévu, encaissé sur facturé.
    expect(await p.locator('.mg-av .mg-av-t').allInnerTexts().then((l) => l.map(net))).toEqual([
      'Facturé 283,517 DT : tout ce qui était prévu est facturé', 'Encaissé 0,000 DT sur 337,385 DT TTC · 337,385 DT à encaisser']);
    // Un budget d'achats de 80 : la barre dit le dépassement, en rouge.
    await p.locator('#p-budget').click();
    await p.locator('#modal-root [name=budget]').fill('80');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('.mg-av').nth(2).innerText().then(net).catch(() => '')).toBe('Coût sur le budget 100,250 DT : budget de 80,000 DT dépassé de 20,250 DT');
    expect(await p.locator('.mg-av').nth(2).locator('i').getAttribute('class')).toBe('rouge');
    // Détacher l'achat depuis sa ligne, puis « Annuler » le remet.
    await p.locator('#p-tabs [data-ong="achats"]').click();
    await p.locator('#p-buys .row-menu-btn').click();
    await p.locator('.row-menu').getByRole('menuitem', { name: /Détacher de l'affaire/ }).click();
    await expect.poll(() => p.locator('#p-buys .mg-vide b').innerText().catch(() => '')).toBe('Aucun achat rattaché');
    await p.locator('#toast.show.avec-bouton').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => p.locator('#p-buys tr[data-pc="a1"]').count()).toBe(1);
    // (1.263.0) Les heures du chantier : 7,5 h notées (« 7,5 » à la française) coûtent l'heure du salarié, et le coût de
    // l'affaire est la somme de ses morceaux : achats + main d'œuvre, la marge baisse d'autant.
    await p.locator('#p-tabs [data-ong="heures"]').click();
    await p.locator('#p-time-new').click();
    await p.locator('#modal-root [name=hours]').fill('7,5');
    await expect.poll(() => p.locator('#ht-effet').innerText().then(net).catch(() => '')).toMatch(/^Coût de l'heure : [\d ,]+ DT \([\d ,]+ DT pour 208 h\), estimé sur son salaire du contrat : pas encore de bulletin ce mois-là · ces heures coûtent [\d ,]+ DT\.$/);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#p-time tr[data-pc]').count()).toBe(1);
    const lu = (t: string) => Number(t.replace(/[^\d,-]/g, '').replace(',', '.'));
    const mo = lu(await p.locator('#p-time tfoot td.m').innerText());
    expect(mo).toBeGreaterThan(40);
    const resume = net(await p.locator('#view .mg-resume').innerText());
    const cout = lu(/Coût i ([\d ,]+) DT/.exec(resume)?.[1] ?? '');
    expect(Math.round(cout * 1000)).toBe(Math.round((100.25 + mo) * 1000));
    expect(resume).toContain(`main d'œuvre`);
    expect(resume).toContain('(7,5 h, estimée)');
    expect(lu(/Marge i ([\d ,]+) DT/.exec(resume)?.[1] ?? '')).toBe(Math.round((283.517 - cout) * 1000) / 1000);
    await p.locator('#view .ed-retour-btn').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/marges');

    // 2. « Où est la marge » : plus de tuiles ; le chiffre d'affaires, la marge et son taux au pied.
    await p.locator('#mg-tabs [data-tab="analyse"]').click();
    await expect.poll(() => p.locator('#mg-tabs [data-tab="analyse"]').getAttribute('aria-selected')).toBe('true');
    expect(await p.locator('#mg-body .stats, #mg-body .stat').count()).toBe(0);
    expect(await p.locator('#mg-an').isVisible()).toBe(true);
    const pied = net(await p.locator('#mg-body tfoot').innerText());
    expect(pied).toContain(`Année ${auj.slice(0, 4)} 1 client · coût des ventes`);
    // Chaque chiffre dans sa case : le chiffre d'affaires sous « Vendu HT », la marge sous « Marge ».
    expect(await p.locator('#mg-body tfoot td').evaluateAll((l) => l.map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).slice(1, 5))).toEqual(['283,517', '', '283,517', '100 %']);
    await p.screenshot({ path: path.join(PHOTOS, 'marges-1-analyse.png') });
    // Le seuil : la cascade se termine par le résultat de l'année.
    await p.locator('#mg-tabs [data-tab="seuil"]').click();
    await expect.poll(() => p.locator('#mg-body .mg-c.total').count()).toBe(1);
    expect(net(await p.locator('#mg-body .mg-c').first().innerText())).toBe("Chiffre d'affaires HT 283,517 DT");
    // (1.263.0) Mois par mois : douze mois ; celui de la facture porte son chiffre d'affaires.
    expect(await p.locator('#mg-body .mg-mois-t tbody tr').count()).toBe(12);
    expect(net(await p.locator('#mg-body .mg-mois-t tbody tr').nth(Number(auj.slice(5, 7)) - 1).innerText())).toMatch(/^\S+ 283,517 183,267 /);
    await p.locator('#mg-tabs [data-tab="affaires"]').click();

    // 3. Depuis la fiche du fournisseur, l'achat ouvert y ramène, par son chemin et par « ‹ ».
    await p.evaluate(() => { location.hash = '#/fournisseur/s1'; });
    await expect.poll(() => p.locator('#view h1').first().innerText().then(net).catch(() => '')).toMatch(/^Ciments de Bizerte/);
    await p.locator('#view .cf-onglet tbody tr.clickable').first().click();
    await expect.poll(() => p.locator('#view h1').first().innerText().then(net).catch(() => '')).toMatch(/CB-2026-77/);
    await expect.poll(() => p.locator('#view .ed-chemin').innerText().then(net)).toBe('Accueil › Ciments de Bizerte › CB-2026-77');
    expect(await p.locator('#view .ed-retour-btn').getAttribute('aria-label')).toBe('Revenir à Ciments de Bizerte');
    await p.locator('#view .ed-retour-btn').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/fournisseur/s1');

    // 4. Ouvert depuis la liste des achats, il ramène à la liste, comme avant.
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.locator('#view tr[data-id="a1"]').first().click();
    await expect.poll(() => p.locator('#view .ed-chemin').innerText().then(net)).toBe('Accueil › Achats et dépenses › CB-2026-77');
    await p.locator('#view .ed-retour-btn').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/achats');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
