// La facture de la maquette (1.155.0 ; docs/maquettes/facture.html, lot 4 de docs/maquettes-appliquees.md), à la souris,
// au clavier et au téléphone, sur un brouillon de deux lignes (deux taux de TVA, retenue du client, timbre) et une facture
// émise par le serveur et payée en partie :
//   - l'en-tête dit le chemin, le statut et « enregistré » ; le client se lit en carte : ce qu'il doit, sa dernière
//     facture (« la refaire »), « Changer » ;
//   - les options sont des puces (la retenue dit « · du client ») ; la remise de toute la pièce vit au pied des lignes ;
//   - les totaux disent la TVA par taux et sur quelle base, le net à payer en grand ; « Avant d'émettre » dit ce qui manque ;
//   - les gestes d'une ligne sont dans son ⋯ ; Entrée sur la dernière ligne en ajoute une ;
//   - émise : la frise (émise, signée, El Fatoora, envoyée, payée), « Enregistrer un paiement » seul en vert, l'e-mail
//     dans ⋯ et dans la frise ; au téléphone, le geste reste au bas de l'écran pendant qu'on fait défiler la pièce.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la facture de la maquette, à la souris, au clavier et au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-facture-charte-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    // Le timbre du brouillon : sa règle, si la base des tests ne l'a pas encore.
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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

  it('le brouillon : carte du client, puces, totaux par taux, avant d\'émettre, gestes des lignes ; émise : la frise et le paiement ; au téléphone, le geste au bas', async () => {
    const email = `charte-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const lac = { id: 'c-lac', name: 'Hôtel du Lac', matricule: '1234567A/A/M/000', email: 'compta@hotel-du-lac.tn', address: '12 rue du Lac\n1053 Les Berges du Lac', withholdingRate: { '~n': '1.5' } };
    const pins = { id: 'c-pins', name: 'École Les Pins', email: 'direction@les-pins.tn' };
    const aujourdhui = jour(0);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: lac.id, rang: 20, revision: null, contenu: lac },
      { collection: 'clients', cle: pins.id, rang: 21, revision: null, contenu: pins },
      // Le brouillon : 2 × 120,500 à 19 % et 3 × 45,300 à 7 %, la retenue de l'hôtel (1,5 %), le timbre.
      { collection: 'documents', cle: 'b1', rang: 9, revision: null, contenu: { id: 'b1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, dueDate: jour(30), clientId: lac.id, createdAt: 9,
        subject: 'Maintenance d\'octobre', lines: [
          { label: 'Maintenance du réseau', description: '', qty: 2, unit: '', unitPrice: { '~n': '120.5' }, vatRate: 19 },
          { label: 'Formation des équipes', description: '', qty: 3, unit: '', unitPrice: { '~n': '45.3' }, vatRate: 7 },
        ], discountRate: 0, withholdingRate: { '~n': '1.5' }, applyStamp: true, currency: 'DT', payments: [] } },
    ] });
    // Une facture émise par le serveur pour l'hôtel (337,385), dont 100 DT sont reçus.
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, dueDate: jour(20), clientId: lac.id, createdAt: 8,
      subject: 'Maintenance de septembre', lines: [{ label: 'Maintenance', description: '', qty: 1, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
    client: lac, revision: null, rang: 0, netAPayer: '337.385' });
    const n1 = String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif);
    expect(n1).toMatch(/^FAC-/);
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f1 = objets.find((o) => o.collection === 'documents' && o.cle === 'f1');
    if (!f1) throw new Error('f1 absente');
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision,
      contenu: { ...f1.contenu, payments: [{ id: 'pa1', date: aujourdhui, amount: 100, method: 'virement' }] } }] });

    const contexte = async (largeur: number, hauteur: number, doigt = false) => {
      const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(doigt ? { isMobile: true, hasTouch: true } : {}) });
      await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
      await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
      return cx;
    };
    const cx = await contexte(1440, 900);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/b1`);
    await p.locator('#ed-client .ed-cl-nom').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // 1. L'en-tête et la carte du client : ce qu'il doit (337,385 − 100), sa dernière facture et « la refaire ».
    expect(net(await p.locator('.ed-chemin').innerText())).toBe('Accueil › Factures › Nouvelle facture');
    expect(net(await p.locator('.ed-h1 .ed-pill').innerText())).toBe('Brouillon · numéro à l\'émission');
    expect(await p.locator('#ed-enreg').isVisible()).toBe(true);
    expect(net(await p.locator('#ed-client .ed-cl-nom').innerText())).toBe('Hôtel du Lac MF 1234567A/A/M/000 · Les Berges du Lac · compta@hotel-du-lac.tn');
    expect(await p.locator('#ed-client .ed-chip').allInnerTexts().then((t) => t.map(net))).toEqual(['doit 237,385 DT', `dernière : ${n1} · ${jm(aujourdhui)} · 337,385 DT · la refaire`]);
    expect(await p.locator('[data-combo=clientId]').isVisible()).toBe(false);

    // 2. Les puces : la retenue est celle du client, le timbre se coche ; les totaux disent la TVA par taux et sa base.
    expect(net(await p.locator('#ed-puces [data-etq=rs]').innerText())).toMatch(/^Retenue 1,5\s?% · du client$/);
    expect(await p.locator('#ed-puces [data-etq=rs]').getAttribute('class')).toContain('chg');
    const totaux = () => p.locator('#totals .ed-tot tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    expect(await totaux()).toEqual(['Total HT 376,900', 'TVA 7 % sur 135,900 9,513', 'TVA 19 % sur 241,000 45,790', 'Timbre fiscal 1,000', 'Total TTC 433,203', 'Retenue à la source 1,5 % − 6,483']);
    expect(net(await p.locator('#totals .ed-net').innerText())).toBe('Net à payer 426,720 DT le montant en lettres est écrit sur la facture');
    // Avant d'émettre : le client a son matricule, chaque ligne a sa TVA.
    expect(await p.locator('#ed-avant li').evaluateAll((l) => l.slice(1).map((x) => `${x.className} ${(x as HTMLElement).innerText.trim()}`))).toEqual(['ok Le client a son matricule', 'ok Chaque ligne a sa TVA']);
    await p.screenshot({ path: path.join(PHOTOS, 'facture-charte-1.png') });

    // 3. La remise de toute la pièce, au pied des lignes : les totaux la disent tout de suite, le formulaire la garde.
    await p.locator('#ed-remise').fill('10');
    await expect.poll(totaux).toContain('Remise 10 % − 37,690');
    expect(await p.locator('#f-head input[name=discountRate]').inputValue()).toBe('10');
    await p.locator('#ed-remise').fill('0');
    await expect.poll(totaux).not.toContain('Remise 10 % − 37,690');

    // 4. Les gestes d'une ligne sont dans son ⋯ : dupliquer, retirer ; Entrée sur la dernière ligne en ajoute une.
    const rangees = () => p.locator('#lines tr').count();
    await p.locator('#lines tr').nth(1).locator('[data-rowmenu]').click();
    // (1.155.0, maquette « Menu d'une ligne ») Ajouter une description, Dupliquer, Monter, Insérer un titre, Supprimer.
    expect(await p.locator('[role=menu] [role=menuitem]').allInnerTexts().then((t) => t.map((x) => net(x).split(' ').slice(0, 2).join(' ')))).toContain('Supprimer la');
    await p.getByRole('menuitem', { name: /^Dupliquer/ }).click();
    await expect.poll(rangees).toBe(3);
    expect(net(await p.locator('#ed-compte').innerText())).toBe('3 lignes');
    await p.locator('#lines tr').nth(2).locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /^Supprimer la ligne/ }).click();
    await expect.poll(rangees).toBe(2);
    await p.locator('#lines tr').nth(1).locator('input[data-k=unitPrice]').press('Enter');
    await expect.poll(rangees).toBe(3);
    expect(await p.evaluate(() => document.activeElement === document.querySelector('#lines tr:last-child input[data-k=label]'))).toBe(true);
    await p.locator('#lines tr').nth(2).locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /^Supprimer la ligne/ }).click();
    await expect.poll(rangees).toBe(2);

    // 5. « Changer » : un client sans matricule, sa retenue (aucune) remplace celle de l'hôtel ; « Avant d'émettre » le dit.
    await p.locator('#cl-changer').click();
    await p.locator('#ed-pq-q').fill('Pins');
    await p.locator('#ed-pq-liste [role=option][data-cl]').filter({ hasText: 'École Les Pins' }).first().click();
    await expect.poll(() => p.locator('#ed-client .ed-cl-nom b').innerText()).toBe('École Les Pins');
    expect(await p.locator('[data-combo=clientId]').isVisible()).toBe(false);
    expect(net(await p.locator('#ed-puces [data-etq=rs]').innerText())).toBe('Retenue aucune');
    expect(await p.locator('#ed-avant li').nth(1).evaluate((x) => `${x.className} ${(x as HTMLElement).innerText.replace(/\s*\n\s*/g, '').trim()}`)).toBe('alerte Le client n\'a pas de matricule (obligatoire pour une entreprise)Sa fiche');

    // 6. Émettre : le geste de la colonne de droite, puis la pièce émise.
    await p.locator('#ed-geste #issue').click();
    // « Juste après l'émission » : ni signature ni envoi ici (chacun a son essai plus bas).
    for (const g of [/Signer par DigiGo/, /L'envoyer par e-mail/]) { const c = p.locator('#modal-root').getByLabel(g); if (await c.count() && await c.isChecked()) await c.uncheck(); }
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 15_000 }).toMatch(/^FAC-/);
    const frise = () => p.locator('#ed-frise li').evaluateAll((l) => l.map((x) => `${x.classList.contains('fait') ? '✓' : '·'} ${(x.querySelector('.ed-fr-txt') as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}`));
    expect(await frise()).toEqual([expect.stringMatching(/^✓ Émise aujourd'hui, \d{1,2} h \d{2}$/), '· Signée DigiGo, à faire', '· El Fatoora partira après la signature', '· Envoyée à direction@les-pins.tn', `· Payée rien de reçu · échéance ${jm(jour(30))}`]);
    expect(net(await p.locator('.lock-banner b').first().innerText())).toBe('Émise : elle ne se modifie plus');
    expect(await p.locator('.btn-primary:visible').evaluateAll((b) => b.map((x) => x.id))).toEqual(['pay']);
    expect(net(await p.locator('#ed-geste .ed-phrase').first().innerText())).toBe(`Rien de reçu · échéance le ${jm(jour(30))}. Un paiement partiel se note aussi.`);
    expect(await p.locator('#pay-panel .pay-grid .k-label').evaluateAll((l) => l.map((x) => (x as HTMLElement).textContent?.replace(/\s*i\s*$/, '').trim()))).toEqual(['Net à payer', 'Avoirs', 'Reçu', 'Reste']);
    // L'e-mail : dans ⋯, et « Envoyer » de la frise ouvre le même envoi.
    await p.locator('#more-btn').click();
    expect(net(await p.locator('#more-list #email').innerText())).toBe('Envoyer par e-mail…');
    await p.keyboard.press('Escape');
    await p.locator('#ed-frise [data-frise=email]').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'facture-charte-2.png') });
    await p.keyboard.press('Escape');

    // 7. La facture payée en partie : la frise dit ce qui est reçu et ce qui reste.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 15_000 }).toBe(n1);
    await expect.poll(frise).toEqual([expect.stringMatching(/^✓ Émise /), '· Signée DigiGo, à faire', '· El Fatoora partira après la signature', '· Envoyée à compta@hotel-du-lac.tn', '· Payée en partie 100,000 sur 337,385 DT']);
    // La relance (maquette « Relancer ») : le canal avec l'adresse, le modèle parmi trois niveaux, le message prêt, sans
    // « À » ni objet ; changer de modèle change le message ; ce qui est parti jusqu'ici, sans rien promettre de plus.
    // « Relancer » ne vient qu'après un envoi : celui d'avant-hier, posé sur la pièce de l'écran.
    await p.evaluate((d) => { const f = (window as unknown as { __data: { documents: { id: string; emails?: unknown[] }[] } }).__data.documents.find((x) => x.id === 'f1');
      if (f) f.emails = [{ date: d, to: 'compta@hotel-du-lac.tn', subject: 'Facture', kind: 'facture' }]; location.hash = '#/factures'; }, jour(-2));
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await p.locator('#more-btn').waitFor();
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /^Relancer/ }).click();
    const rel = p.locator('#modal-root .modal').last();
    await expect.poll(() => rel.locator('h2').innerText()).toBe('Relancer Hôtel du Lac');
    expect(net(await rel.locator('[data-canal=email]').innerText())).toBe('E-mail · compta@hotel-du-lac.tn');
    expect(await rel.locator('[name=subject]').isVisible()).toBe(false);
    expect(await rel.locator('#env-modele option').allInnerTexts()).toEqual(['Rappel · courtois', 'Relance', 'Dernière relance · ferme']);
    const premier = await rel.locator('[name=body]').inputValue();
    await rel.locator('#env-modele').selectOption('3');
    await expect.poll(() => rel.locator('[name=body]').inputValue()).not.toBe(premier);
    expect(net(await rel.locator('.note-v').innerText())).toBe(`Envoyée le ${jour(-2).split('-').reverse().join('/')} · aucune relance pour l'instant.`);
    await p.screenshot({ path: path.join(PHOTOS, 'facture-charte-relance.png') });
    await p.keyboard.press('Escape');
    expect(erreurs).toEqual([]);
    await cx.close();

    // 8. Au téléphone : le net à payer et « Enregistrer un paiement » restent au bas de l'écran, au-dessus des onglets,
    // en haut de la pièce comme à sa fin ; la frise se lit en colonne.
    const tx = await contexte(390, 844, true);
    const t = await tx.newPage();
    t.on('pageerror', (x) => erreurs.push(x.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await t.locator('#ed-geste #pay').waitFor({ timeout: 20_000 });
    await plusTard(t);
    const bas = async () => t.locator('#ed-geste #pay').evaluate((b) => { const r = b.getBoundingClientRect(); return { haut: Math.round(r.top), bas: Math.round(r.bottom), large: Math.round(r.width) }; });
    for (const ou of ['debut', 'fin']) {
      await t.evaluate((x) => window.scrollTo(0, x === 'fin' ? document.documentElement.scrollHeight : 0), ou);
      await t.waitForTimeout(200);
      const r = await bas();
      expect(r.bas, ou).toBeLessThanOrEqual(844 - 84);
      expect(r.haut, ou).toBeGreaterThan(844 - 84 - 120);
      expect(r.large, ou).toBeGreaterThanOrEqual(330);
    }
    expect(net(await t.locator('#ed-geste .ed-net-tel').innerText())).toBe('Net à payer 337,385 DT');
    const etapes = await t.locator('#ed-frise li').evaluateAll((l) => l.map((x) => Math.round(x.getBoundingClientRect().top)));
    expect(etapes.every((y, i) => i === 0 || y > (etapes[i - 1] ?? 0))).toBe(true);
    await t.evaluate(() => window.scrollTo(0, 0));
    await t.screenshot({ path: path.join(PHOTOS, 'facture-charte-3-telephone.png') });
    expect(erreurs).toEqual([]);
    await tx.close();
  }, 240_000);
});
