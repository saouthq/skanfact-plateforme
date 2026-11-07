// Les Devis de l'entreprise, 1.306.0, joués comme un menuisier de Sfax (« Menuiserie El Amen ») et ses deux clients : Ines Ben
// Ammar, à qui le dressing est parti par e-mail il y a douze jours, et l'Hôtel Thyna (des portes dont le devis a expiré, un
// comptoir parti par WhatsApp). Ines demande une porte miroir : le prix de la pose change sur un devis déjà chez elle, et
// l'éditeur le dit pendant la saisie, après l'enregistrement, jusqu'à ce qu'il reparte. Puis la réponse des clients se note
// depuis leur fiche, avec la même fenêtre que le devis (quand, comment, pourquoi) et le même menu que la liste des devis.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'devis-1306.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les devis 1.306.0 : le devis changé après l\'envoi, la réponse notée de toutes les portes', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-devis-1306-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'devis-1306.txt'), '');
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const fr = (iso: string) => iso.split('-').reverse().join('/');

  it('l\'artisan de Sfax : un devis changé après l\'envoi le dit jusqu\'à ce qu\'il reparte, et la réponse du client se note pareil de toutes les portes', async () => {
    const hatem = await personne('hatem');
    const ent = String((await api('POST', '/entreprises-essai', hatem)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hatem)).corps.objets as Obj[];
    const devisLu = async (id: string) => ((await objets()).find((o) => o.collection === 'documents' && o.cle === id) ?? {}).contenu as Obj;
    await objets();
    const auj = jourDe(0), hier = jourDe(-1);
    // Le menuisier (« Menuiserie El Amen », Sfax) a trois devis dehors : le dressing d'Ines Ben Ammar, envoyé par e-mail il y a
    // douze jours ; les portes des chambres de l'Hôtel Thyna, expiré depuis quinze jours ; son comptoir de réception, envoyé par
    // WhatsApp il y a cinq jours. Les prix ne sont pas ronds : un arrondi s'y verrait.
    const ligne = (label: string, qty: number, prix: number, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const devis = (id: string, number: string, clientId: string, subject: string, date: string, dueDate: string, envoi: Obj, lines: Obj[]) => ({ collection: 'documents', cle: id, rang: 0, revision: null,
      contenu: enc({ id, type: 'devis', number, date, dueDate, clientId, subject, status: 'envoyé', emails: [{ date, kind: 'devis', ...envoi }], lines, discountRate: 0, applyStamp: true,
        withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1, notes: '' }) });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Ines Ben Ammar', email: 'ines.benammar@exemple.tn', phone: '+216 98 123 457', city: 'Sfax' } },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Hôtel Thyna', email: 'achats@thyna.exemple.tn', phone: '+216 74 400 218', city: 'Sfax' } },
      devis('q1', 'DEV-2026-021', 'c1', 'Dressing de la chambre', jourDe(-12), jourDe(18), { to: 'ines.benammar@exemple.tn' },
        [ligne('Panneaux de chêne massif', 6, 185.5, 'm²'), ligne('Quincaillerie et coulisses', 1, 96.75), ligne('Pose sur place', 1, 350)]),
      devis('q2', 'DEV-2026-018', 'c2', 'Portes des chambres', jourDe(-45), jourDe(-15), { to: 'achats@thyna.exemple.tn' },
        [ligne('Porte isoplane laquée', 12, 420.35), ligne('Pose et réglage', 12, 65.5)]),
      devis('q3', 'DEV-2026-022', 'c2', 'Comptoir de la réception', jourDe(-5), jourDe(25), { to: '+21674400218', canal: 'whatsapp' },
        [ligne('Comptoir en chêne et laiton', 1, 2850.125)]),
    ] })).statut).toBe(200);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
      contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hatem Kallel', name: 'Menuiserie El Amen', city: 'Sfax' } }] })).statut).toBe(200);

    const cx = await contexte(hatem);
    // La messagerie qui s'ouvrirait : l'adresse du message, gardée (comme le parcours des envois).
    await cx.addInitScript(() => {
      const clic = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.href.startsWith('mailto:')) { (window as unknown as { __mailto: string }).__mailto = this.href; return; }
        clic.call(this);
      };
    });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (id: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/${id}`);
      await p.locator('#ed-frise').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `devis-1306-${nom}.png`), fullPage: true });
    const change = () => p.locator('#ed-recu-change');
    const prix = (i: number) => p.locator('#lines tr').filter({ has: p.locator('input[data-k="unitPrice"]') }).nth(i).locator('input[data-k="unitPrice"]');
    const etape = (n: number) => p.locator('#ed-frise li').nth(n).innerText().then(net);

    // A. Ines a demandé une porte miroir : la pose passe de 350 à 420 DT. Tant qu'on n'a rien changé de ce qu'elle lit, rien ;
    // retaper le même prix non plus.
    await ouvrir('q1');
    expect(await p.locator('.ed-recu li').allInnerTexts()).toEqual([`Le PDF et le lien pour le lire, le ${jm(jourDe(-12))}`, `Valable jusqu'au ${fr(jourDe(18))}`, 'Sans timbre : il viendra sur la facture']);
    expect(await change().isVisible()).toBe(false);
    expect(net(await p.locator('.ed-cl-puces').innerText())).toContain('premier document pour ce client');
    await prix(2).fill('350');
    await prix(2).press('Tab');
    expect(await change().isVisible()).toBe(false);
    await prix(2).fill('420');
    await prix(2).press('Tab');
    await expect.poll(() => change().isVisible(), { timeout: 5_000 }).toBe(true);
    expect(net(await change().innerText())).toBe(`Déjà envoyé à Ines Ben Ammar le ${jm(jourDe(-12))} : enregistré, personne ne lui aura dit ces changements. Renvoie-le ensuite, il garde son numéro.`);
    expect(await p.locator('#ed-renvoyer').isVisible()).toBe(false);
    await plusTard(p);
    await p.locator('.ed-recu').screenshot({ path: path.join(PHOTOS, 'devis-1306-a-pendant-recu.png') });
    await photo('a-pendant');
    await p.locator('#save').click();
    await expect.poll(() => toast(p), { timeout: 5_000 }).toContain('Enregistré : DEV-2026-021 — personne ne l\'a dit à Ines Ben Ammar');
    expect(await p.locator('#toast').getByRole('button', { name: 'Le renvoyer' }).count()).toBe(1);
    const apres = `Modifié le ${jm(auj)}, après l'envoi du ${jm(jourDe(-12))} : personne ne l'a dit à Ines Ben Ammar.`;
    await expect.poll(async () => net(await change().innerText().catch(() => '')), { timeout: 10_000 }).toBe(apres);
    // (1.307.0, maquette) Le renvoi est l'étape suivante : le bouton principal, plus dans « Ce que le client a reçu ».
    expect(net(await p.locator('#ed-geste #ed-renvoyer').innerText())).toBe('Renvoyer la nouvelle version');
    expect(await p.locator('.ed-recu #ed-renvoyer').count()).toBe(0);
    await expect.poll(async () => (await devisLu('q1')).modifieApresEnvoi, { timeout: 10_000 }).toBe(auj);
    // Rechargé : il le redit.
    await ouvrir('q1');
    expect(net(await change().innerText())).toBe(apres);
    await plusTard(p);
    await p.locator('.ed-recu').screenshot({ path: path.join(PHOTOS, 'devis-1306-a-apres-recu.png') });
    await photo('a-apres');

    // « Renvoyer la nouvelle version » : la fenêtre d'envoi, le message parti, et le devis ne le dit plus.
    await p.locator('#ed-renvoyer').click();
    const envoi = p.locator('.modal').filter({ has: p.locator('#mf') });
    await envoi.waitFor({ timeout: 10_000 });
    expect(net(await envoi.locator('h2').innerText())).toBe('Renvoyer DEV-2026-021');
    expect(net(await envoi.locator('#ok').innerText())).toBe('Envoyer à 1 contact');
    expect(await envoi.locator('[data-canal="lien"]').count()).toBe(1);
    await envoi.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => (window as unknown as { __mailto?: string }).__mailto ?? ''), { timeout: 15_000 }).not.toBe('');
    const mail = new URL(await p.evaluate(() => (window as unknown as { __mailto: string }).__mailto));
    expect(decodeURIComponent(mail.pathname)).toBe('ines.benammar@exemple.tn');
    expect(mail.searchParams.get('body') ?? '').toMatch(/^Bonjour,\n\nVoici la nouvelle version de notre devis DEV-2026-021[\s\S]*\n\nPour voir le devis en ligne : /);
    await p.locator('#mf-envoye').click();
    await expect.poll(() => change().isVisible(), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => (await devisLu('q1')).modifieApresEnvoi ?? null, { timeout: 10_000 }).toBe(null);
    expect(((await devisLu('q1')).emails as Obj[]).map((x) => x.date)).toEqual([jourDe(-12), auj]);
    await ouvrir('q1');
    expect(await change().isVisible()).toBe(false);
    expect((await p.locator('.ed-recu li').allInnerTexts())[0]).toBe(`Le PDF et le lien pour le lire, le ${jm(auj)}`);

    // B. Depuis la fiche d'Ines : le menu de son devis est celui de la liste des devis. Elle a dit oui au téléphone hier.
    const menuDe = async (numero: string) => {
      await p.locator('#cl-docs tr').filter({ hasText: numero }).locator('.row-menu-btn').click();
      const m = p.locator('.row-menu');
      await m.waitFor();
      return m;
    };
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c1`);
    await p.locator('#cl-docs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    let m = await menuDe('DEV-2026-021');
    const gestes = await m.getByRole('menuitem').allInnerTexts();
    noter('menu du devis d\'Ines, de sa fiche', gestes.map(net));
    expect(gestes.map((x) => net(x).split(' ')[0])).toEqual(expect.arrayContaining(['Ouvrir']));
    expect(gestes.some((x) => net(x).startsWith('Le client a accepté…'))).toBe(true);
    expect(gestes.some((x) => net(x).startsWith('Prolonger'))).toBe(false);
    await m.getByRole('menuitem').filter({ hasText: 'Le client a accepté…' }).click();
    const oui = p.locator('.modal').filter({ hasText: 'Le client a accepté ?' });
    await oui.waitFor();
    expect(net(await oui.locator('.ed-recap').innerText())).toContain('DEV-2026-021 · Ines Ben Ammar');
    // Le champ de date à la française : un jour avant le devis se refuse, en montrant le champ.
    const leOui = oui.locator('.datefield').filter({ has: p.locator('input[name="rep-le"]') }).locator('.d-txt');
    await leOui.fill(fr(jourDe(-13)));
    await leOui.press('Tab');
    await oui.getByRole('button', { name: 'Accepter seulement' }).click();
    await expect.poll(() => toast(p), { timeout: 5_000 }).toBe(`Le devis est daté du ${fr(jourDe(-12))} : il n'a pas pu être accepté avant.`);
    expect(await oui.locator('.champ-faute').count()).toBe(1);
    await leOui.fill(fr(hier));
    await leOui.press('Tab');
    await oui.getByRole('button', { name: 'Accepter seulement' }).click();
    await expect.poll(async () => ((await devisLu('q1')).reponse ?? {}).le, { timeout: 10_000 }).toBe(hier);
    expect((await devisLu('q1')).status).toBe('accepté');
    await ouvrir('q1');
    expect(await etape(3)).toMatch(new RegExp(`^Accepté ${jm(hier)} · au téléphone`));

    // C. L'Hôtel Thyna : ses portes ont expiré, il veut encore y réfléchir (prolonger) ; son comptoir est parti chez un autre.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c2`);
    await p.locator('#cl-docs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    m = await menuDe('DEV-2026-018');
    expect((await m.getByRole('menuitem').allInnerTexts()).some((x) => net(x).startsWith('Prolonger sa validité…'))).toBe(true);
    await m.getByRole('menuitem').filter({ hasText: 'Prolonger sa validité…' }).click();
    const pro = p.locator('.modal').filter({ hasText: 'Prolonger DEV-2026-018' });
    await pro.waitFor();
    const valable = pro.locator('.datefield').filter({ has: p.locator('input[name="pr-le"]') }).locator('.d-txt');
    await valable.fill(fr(jourDe(20)));
    await valable.press('Tab');
    await pro.locator('#pr-ok').click();
    await expect.poll(async () => (await devisLu('q2')).dueDate, { timeout: 10_000 }).toBe(jourDe(20));
    m = await menuDe('DEV-2026-022');
    await m.getByRole('menuitem').filter({ hasText: 'Le client a refusé…' }).click();
    const non = p.locator('.modal').filter({ hasText: 'Le client a refusé ce devis ?' });
    await non.waitFor();
    await non.getByRole('button', { name: 'Un concurrent', exact: true }).click();
    await non.locator('#rep-refus').click();
    await expect.poll(async () => ((await devisLu('q3')).reponse ?? {}).motif, { timeout: 10_000 }).toBe('Un concurrent');
    await photo('c-fiche');
    await ouvrir('q3');
    // Deux devis déjà : l'hôtel n'est pas un client nouveau (la carte le disait).
    expect(net(await p.locator('.ed-cl-puces').innerText())).toContain('2 devis');
    expect(net(await p.locator('.ed-cl-puces').innerText())).not.toContain('premier document');
    expect(await etape(3)).toMatch(new RegExp(`Refusé ${jm(auj)} · Un concurrent`));
    expect(net(await p.locator('.ed-envois').innerText())).toContain(`Réponse : refusé le ${jm(auj)}`);
    await photo('c-refuse');

    // D. L'hôtel revient : un autre comptoir, plus simple. « Dupliquer » le devis refusé : le nouveau ne porte ni le refus
    // ni son pourquoi. Et une pièce tirée d'un devis (« Transformer ») ne porte pas son acceptation.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c2`);
    await p.locator('#cl-docs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    m = await menuDe('DEV-2026-022');
    await m.getByRole('menuitem').filter({ hasText: 'Dupliquer' }).click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#\/doc\/(?!q3)/);
    const numeros = async () => (await objets()).filter((o) => o.collection === 'documents').map((o) => String(o.contenu.number));
    await expect.poll(numeros, { timeout: 10_000 }).toContain('DEV-2026-023');
    const duplique = (await objets()).find((o) => o.collection === 'documents' && o.contenu.number === 'DEV-2026-023')?.contenu as Obj;
    expect([duplique.status, duplique.reponse ?? null, duplique.modifieApresEnvoi ?? null, duplique.emails]).toEqual(['brouillon', null, null, []]);
    const C = ecranDeLaPlateforme('core.js') as Obj;
    const commande = C.convertDoc({ ...(await devisLu('q1')), modifieApresEnvoi: auj }, 'commande', { quoteValidityDays: 30, paymentTermsDays: 30 }, auj, null) as Obj;
    expect([commande.type, commande.reponse ?? null, commande.modifieApresEnvoi ?? null]).toEqual(['commande', null, null]);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
