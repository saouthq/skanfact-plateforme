// La liste des factures de la maquette (1.154.0 ; docs/maquettes/liste.html, lot 3 de docs/maquettes-appliquees.md), à
// la souris et au clavier, sur trois factures émises par le serveur et un brouillon :
//   - les tuiles comptent comme la liste : « À encaisser » (toutes années) et « En retard » avec l'âge des retards ; un
//     brouillon daté avant la dernière facture émise est « à redater » ; une tuile est un filtre qui se défait ;
//   - le tableau se range par mois, brouillons d'abord ; l'échéance dit le retard en rouge ; un client qui a trop versé :
//     « Payée en trop » et « … à son crédit » ;
//   - la recherche trouve une pièce par son montant, et le dit ; les filtres se lisent en puces, « Tout effacer » ;
//   - le menu ⋯ nomme sa pièce et range ses gestes (Envoyer, La pièce, Corriger), « Relancer » pour une facture en retard ;
//   - on choisit plusieurs pièces : la barre dit combien, et à combien chaque geste s'applique ; Échap ne choisit plus rien ;
//   - ↓ passe d'une pièce à l'autre, Entrée l'ouvre.

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

describe('la liste des factures, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liste-factures-'));
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
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('les tuiles comptent comme la liste, l\'échéance et le trop-perçu se disent, on cherche un montant, on choisit, au clavier', async () => {
    const email = `liste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const clients = [{ id: 'c-lac', name: 'Hôtel du Lac' }, { id: 'c-pins', name: 'École Les Pins' }, { id: 'c-olivier', name: 'Huilerie Les Oliviers' }];
    const aujourdhui = jour(0);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: 20 + i, revision: null, contenu: c })),
      // Un brouillon daté de trois jours avant les factures émises aujourd'hui : il est à redater.
      { collection: 'documents', cle: 'b1', rang: 9, revision: null, contenu: { id: 'b1', type: 'facture', number: '', status: 'brouillon', date: jour(-3), dueDate: jour(27), clientId: 'c-pins', createdAt: 9,
        subject: 'Câblage du préau', lines: [{ label: 'Câblage', description: '', qty: 1, unit: '', unitPrice: { '~n': '120.5' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] } },
    ] });
    // Trois factures émises par le serveur : 337,385 (à échoir dans 20 j), 674,770 (45 j de retard), 1 012,156 (10 j de retard).
    const emises: [string, number, number, string][] = [['f1', 1, 20, 'c-lac'], ['f2', 2, -45, 'c-pins'], ['f3', 3, -10, 'c-olivier']];
    const nets = ['337.385', '674.770', '1012.156'];
    for (const [i, [id, qty, ech, cl]] of emises.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, dueDate: jour(ech), clientId: cl, createdAt: 10 + i,
        subject: `Maintenance ${i + 1}`, lines: [{ label: 'Maintenance', description: '', qty, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
        client: clients.find((c) => c.id === cl), revision: null, rang: i, netAPayer: nets[i] });
      expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
    }
    // L'hôtel a versé 400 DT pour 337,385 : 62,615 DT à son crédit.
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f1 = objets.find((o) => o.collection === 'documents' && o.cle === 'f1');
    if (!f1) throw new Error('f1 absente');
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision,
      contenu: { ...f1.contenu, payments: [{ id: 'pa1', date: aujourdhui, amount: 400, method: 'virement' }] } }] });
    const numero = (id: string) => String(objets.find((o) => o.collection === 'documents' && o.cle === id)?.contenu.number);
    const [n1, n2, n3] = [numero('f1'), numero('f2'), numero('f3')];

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await p.locator('#list-wrap tr[data-id="f3"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const tuile = (st: string) => p.locator(`#lf-haut [data-tuile="${st}"]`);

    // 1. Les tuiles : ce qu'on doit encore (f2 + f3), le retard par âge, le brouillon à redater.
    expect(net(await tuile('à encaisser').innerText())).toMatch(/^À encaisser · 2 factures, toutes années 1 686,926 DT 0,000 à échoir 1 686,926 en retard$/);
    expect(net(await tuile('retard').innerText())).toBe('En retard · 2 factures 1 686,926 DT 1 à 30 j 1 012,156 31 à 60 j 674,770 plus de 60 j —');
    expect(net(await tuile('brouillon').innerText())).toBe(`Brouillons · pas encore numérotés 1 143,395 DT en attente d'émission 1 à redater : sa date précède ${n3} du ${jm(aujourdhui)}`);

    // 2. Le tableau : brouillons d'abord, puis le mois ; le retard en rouge ; le trop-perçu.
    const lignes = () => p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => tr.classList.contains('mois') ? `[${(tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}]` : (tr as HTMLElement).dataset.id));
    expect(await lignes()).toEqual(['[Brouillons 1 pièce · 143,395 DT en attente]', 'b1', expect.stringMatching(/^\[\S+ \d{4} 3 pièces · 2 024,311 DT nets\]$/), 'f3', 'f2', 'f1']);
    const ech = p.locator('#list-wrap tr[data-id="f2"] td.ech small');
    expect(await ech.innerText()).toBe('45 j de retard');
    expect(await ech.getAttribute('class')).toBe('rouge');
    expect(net(await p.locator('#list-wrap tr[data-id="b1"] td.cn').innerText())).toBe(`Brouillon à redater : sa date précède ${n3} du ${jm(aujourdhui)}`);
    expect(net(await p.locator('#list-wrap tr[data-id="f1"] td.st').innerText())).toBe('Payée en trop');
    expect(net(await p.locator('#list-wrap tr[data-id="f1"] td').nth(-2).innerText())).toBe('62,615 DT à son crédit');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-factures-1.png') });

    // 3. Une tuile est un filtre : « En retard » ne garde que f3 et f2, la puce le dit ; recliquée, tout revient.
    await tuile('retard').click();
    await expect.poll(lignes).toEqual([expect.stringMatching(/^\[/), 'f3', 'f2']);
    expect(await tuile('retard').getAttribute('aria-pressed')).toBe('true');
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('En retard Tout effacer');
    expect(net(await p.locator('#f-note').innerText())).toBe('2 sur 4 pièces');
    await tuile('retard').click();
    await expect.poll(() => lignes().then((l) => l.length)).toBe(6);
    expect(await tuile('retard').getAttribute('aria-pressed')).toBe('false');

    // 4. Le client appelle avec un montant : « 674,77 » trouve f2, et dit pourquoi.
    await p.locator('#q').fill('674,77');
    await expect.poll(lignes).toEqual([expect.stringMatching(/^\[/), 'f2']);
    expect(net(await p.locator('#list-wrap tr[data-id="f2"] .trouve').innerText())).toBe('trouvée par son montant');
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('« 674,77 » Tout effacer');
    await p.locator('#reset-f').click();
    await expect.poll(() => lignes().then((l) => l.length)).toBe(6);

    // 5. Le menu ⋯ : il nomme sa pièce, range ses gestes, et propose « Relancer » à une facture en retard.
    await p.locator('#list-wrap tr[data-id="f2"] .row-menu-btn').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.locator('.rm-tete').innerText().catch(() => '')).toBe(`${n2} · École Les Pins`);
    expect(await menu.locator('.rm-titre').allInnerTexts().then((l) => l.map((x) => x.toLowerCase()))).toEqual(['envoyer', 'la pièce', 'corriger']);
    expect(await menu.getByRole('menuitem').allInnerTexts().then((l) => l.map((x) => net(x).split(' ')[0]))).toEqual(['Ouvrir', 'Enregistrer', 'Par', 'Par', 'Relancer', 'PDF', 'Dupliquer', 'Créer']);
    await p.keyboard.press('Escape');

    // 6. Choisir plusieurs pièces : la barre dit combien, ce qui reste dû, et à combien « Relancer » s'applique.
    await p.locator('#list-wrap input[data-x="f2"]').check();
    await p.locator('#list-wrap input[data-x="f1"]').check();
    const barre = p.locator('.barre-choix');
    await expect.poll(() => barre.innerText().then(net).catch(() => '')).toBe('2 pièces choisies reste 674,770 DT Télécharger les PDF 2 Relancer 1 Ne plus rien choisir');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-factures-2-choix.png') });
    await p.locator('body').click({ position: { x: 1300, y: 860 } });
    await p.keyboard.press('Escape');
    await expect.poll(() => barre.count()).toBe(0);
    expect(await p.locator('#list-wrap input[data-x]:checked').count()).toBe(0);

    // 7. Au clavier : ↓ passe d'une pièce à l'autre, Entrée ouvre celle qu'on montre.
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    expect(await p.locator('#list-wrap tr.kb').getAttribute('data-id')).toBe('f3');
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#view h1').first().innerText()).toMatch(new RegExp(`^Facture ${n3}`));
    expect([n1, n2].every(Boolean)).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
