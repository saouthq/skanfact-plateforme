// Les Devis qui deviennent des factures, 1.307.0, joués par le même menuisier de Sfax (« Menuiserie El Amen ») : le devis du
// dressing d'Ines changé après l'envoi prend l'état de la maquette (« Envoyé · modifié depuis », « Renvoyer la nouvelle
// version », le message d'une nouvelle version) ; elle accepte et verse 40 % d'acompte (la fenêtre de la maquette : en
// pourcentage ou en dinars, l'acompte et le solde côte à côte, le second timbre dit avant) ; le solde se compare au devis taux
// par taux avant le brouillon. L'Hôtel Thyna, facturé tout de suite, garde la date de son oui ; le refacturer en entier
// passe par la fenêtre de la maquette, le chemin sûr d'abord.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'devis-1307.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les devis 1.307.0 : du devis à la facture, tel que la maquette', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-devis-1307-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'devis-1307.txt'), '');
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
  const C = ecranDeLaPlateforme('core.js') as Obj;
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  it('le menuisier de Sfax facture ses devis : la nouvelle version renvoyée, 40 % d\'acompte, le solde comparé, l\'hôtel facturé sans réponse notée', async () => {
    const hatem = await personne('hatem');
    const ent = String((await api('POST', '/entreprises-essai', hatem)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hatem)).corps.objets as Obj[];
    const piece = async (id: string) => ((await objets()).find((o) => o.collection === 'documents' && o.cle === id) ?? {}).contenu as Obj;
    const pieces = async () => (await objets()).filter((o) => o.collection === 'documents').map((o) => o.contenu as Obj);
    await objets();
    const auj = jourDe(0);
    const ligne = (label: string, qty: number, prix: number, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const devis = (id: string, number: string, clientId: string, subject: string, date: string, dueDate: string, envoi: Obj, lines: Obj[]) => ({ collection: 'documents', cle: id, rang: 0, revision: null,
      contenu: enc({ id, type: 'devis', number, date, dueDate, clientId, subject, status: 'envoyé', emails: [{ date, kind: 'devis', ...envoi }], lines, discountRate: 0, applyStamp: true,
        withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1, notes: '' }) });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Ines Ben Ammar', email: 'ines.benammar@exemple.tn', phone: '+216 98 123 457', city: 'Sfax' } },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Hôtel Thyna', matricule: '1234567B/A/M/000', email: 'achats@thyna.exemple.tn', phone: '+216 74 400 218', city: 'Sfax' } },
      devis('q1', 'DEV-2026-021', 'c1', 'Dressing de la chambre', jourDe(-12), jourDe(18), { to: 'ines.benammar@exemple.tn' },
        [ligne('Panneaux de chêne massif', 6, 185.5, 'm²'), ligne('Quincaillerie et coulisses', 1, 96.75), ligne('Pose sur place', 1, 350)]),
      devis('q3', 'DEV-2026-022', 'c2', 'Comptoir de la réception', jourDe(-5), jourDe(25), { to: '+21674400218', canal: 'whatsapp' },
        [ligne('Comptoir en chêne et laiton', 1, 2850.125)]),
    ] })).statut).toBe(200);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
      contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hatem Kallel', name: 'Menuiserie El Amen', city: 'Sfax' } }] })).statut).toBe(200);

    const cx = await contexte(hatem);
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
      await p.locator('#ed-geste').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `devis-1307-${nom}.png`) });
    const fen = () => p.locator('#modal-root .modal').last();
    const pastille = () => p.locator('.ed-pill').first().innerText().then(net);
    const etape = (n: number) => p.locator('#ed-frise li').nth(n).innerText().then(net);
    const prix = (i: number) => p.locator('#lines tr').filter({ has: p.locator('input[data-k="unitPrice"]') }).nth(i).locator('input[data-k="unitPrice"]');
    const montantDe = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    const emettre = async () => {
      await p.locator('#ed-geste #issue').click();
      await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
      await photo('emission');
      noter('emission', await p.locator('#modal-root .modal').last().innerText().catch(() => ''), await p.locator('#modal-root [data-apres]').evaluateAll((l) => l.map((x) => (x as HTMLElement).outerHTML.slice(0, 200))));
      await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
      await p.locator('#modal-root #ok').click();
      await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^FAC-/);
      return net(await p.locator('#view h1').first().innerText()).split(' ')[0] ?? '';
    };

    // A. Ines a demandé une porte miroir : la pose passe à 420 DT, sur un devis déjà chez elle. La pastille et le bouton
    // principal le disent (maquette « Modifié après l'envoi ») ; le message est celui d'une nouvelle version.
    await ouvrir('q1');
    expect(await pastille()).toBe('Envoyé · attend la réponse');
    await prix(2).fill('420');
    await prix(2).press('Tab');
    await p.locator('#save').click();
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Envoyé · modifié depuis');
    expect(net(await p.locator('#ed-geste .btn-primary').first().innerText())).toBe('Renvoyer la nouvelle version');
    expect(net(await p.locator('#ed-geste .ed-phrase').first().innerText())).toBe('Son lien montre déjà cette version ; le message lui dit qu\'elle remplace la précédente. Il garde son numéro.');
    expect(await p.locator('.ed-recu #ed-renvoyer').count()).toBe(0);
    await photo('a-modifie');
    // Les deux boutons de la réponse tiennent dans la carte (la photo les montrait dépasser de 14 px).
    // La carte est mesurée contre sa colonne (elle s'élargissait avec eux), les boutons contre l'intérieur de la carte.
    expect(await p.locator('#ed-geste').evaluate((el) => {
      const r = el.getBoundingClientRect(), col = (el.parentElement as HTMLElement).getBoundingClientRect();
      const dedans = r.right - Number.parseInt(getComputedStyle(el).paddingRight, 10);
      return [...(r.right > col.right + 1 ? ['la carte'] : []), ...[...el.querySelectorAll('button')].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().right > dedans + 1).map((b) => (b.textContent || '').trim())];
    })).toEqual([]);
    await p.locator('#ed-renvoyer').click();
    await expect.poll(() => fen().locator('h2').innerText(), { timeout: 10_000 }).toBe('Renvoyer DEV-2026-021');
    expect(await fen().locator('textarea[name=body]').inputValue()).toMatch(/^Bonjour,\n\nVoici la nouvelle version de notre devis DEV-2026-021 \(1\s939,403\sDT TTC\) concernant : Dressing de la chambre\. Elle remplace celle que nous vous avions envoyée\./);
    expect(await fen().locator('[name=subject]').inputValue()).toBe('Nouvelle version du devis DEV-2026-021 — Menuiserie El Amen');
    await fen().locator('#ok').click();
    await p.locator('#mf-envoye').click();
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Envoyé · attend la réponse');
    // L'écran dit « Envoyé » avant que l'enregistrement arrive au serveur : on attend la pièce enregistrée (rouge GitHub de la
    // 1.338.0, une machine lente lisait encore l'ancienne).
    await expect.poll(async () => (((await piece('q1')).emails as Obj[]) || []).map((x) => x.kind), { timeout: 10_000 }).toEqual(['devis', 'devisModifie']);
    expect((await piece('q1')).modifieApresEnvoi ?? null).toBe(null);
    expect(net(await p.locator('#ed-geste .btn-primary').first().innerText())).toMatch(/Le client a accepté…$/);

    // B. Elle dit oui au téléphone, et verse 40 % à la commande. La fenêtre d'acompte : 30 % d'abord, puis 40 % d'un clic ;
    // en dinars, puis de nouveau en pourcentage ; l'acompte et le solde côte à côte, et le second timbre dit avant.
    await p.locator('#accepter').click();
    await fen().getByRole('button', { name: 'Accepter seulement' }).click();
    await expect.poll(() => etape(3), { timeout: 10_000 }).toMatch(new RegExp(`^Accepté ${jm(auj)} · au téléphone`));
    await p.locator('#deposit').click();
    await expect.poll(() => fen().locator('h2').innerText(), { timeout: 10_000 }).toBe('Facture d\'acompte · DEV-2026-021');
    expect(await fen().locator('[data-ac="pct"]').getAttribute('aria-pressed')).toBe('true');
    // (1.356.5) Le TTC est celui de la facture, timbre compris : « TTC + timbre » ajoutait le timbre une seconde fois.
    expect(net(await fen().locator('.ac-2 > div').first().innerText())).toMatch(/^L'acompte · 30 % [\d\s]+,\d{3} DT à payer · [\d\s]+,\d{3} DT TTC, dont timbre 1,000 DT$/);
    expect(net(await fen().locator('.note-v').innerText())).toMatch(/^Deux factures, donc deux timbres : le client paiera [\d\s]+,\d{3} DT en tout, 1,000 DT de plus qu'en une seule facture\.$/);
    await fen().locator('[data-acp="40"]').click();
    await expect.poll(() => fen().locator('[name=percent]').inputValue()).toBe('40');
    expect(await fen().locator('[data-acp="40"]').getAttribute('class')).toContain('on');
    await expect.poll(async () => net(await fen().locator('.ac-2 > div').first().innerText())).toMatch(/^L'acompte · 40 % /);
    const acompte40 = montantDe(net(await fen().locator('#dp-acompte').innerText()));
    const solde40 = montantDe(net(await fen().locator('#dp-solde').innerText()));
    await photo('b-acompte');
    await fen().locator('[data-ac="dt"]').click();
    expect(await fen().locator('#dp-pct').isVisible()).toBe(false);
    await fen().locator('[name=montant]').fill('700');
    await expect.poll(async () => net(await fen().locator('#dp-acompte').innerText())).toBe('701,000 DT');
    await fen().locator('[data-ac="pct"]').click();
    await expect.poll(async () => montantDe(net(await fen().locator('#dp-acompte').innerText()))).toBe(acompte40);
    // Un pourcentage hors du devis se dit en rouge et se refuse en montrant le champ.
    await fen().locator('[name=percent]').fill('120');
    await expect.poll(async () => net(await fen().locator('#dp-apercu').innerText())).toBe('Un acompte est une part du devis Entre 0 et 100 % de son total TTC (1 939,403 DT).');
    await fen().locator('#ok').click();
    expect(await fen().locator('.champ-faute').count()).toBe(1);
    await fen().locator('[data-acp="40"]').click();
    await fen().locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Facture d'acompte de ${net(C.money(acompte40, 'DT'))} en brouillon : à émettre`);
    const numAcompte = await emettre();
    noter('acompte émis', numAcompte, acompte40, solde40);
    await photo('b-acompte-emis');

    // C. Le dressing posé : « Facture de solde » compare le devis, l'acompte et le solde, taux par taux, avant le brouillon.
    await ouvrir('q1');
    await p.locator('#settle2').click();
    await expect.poll(() => fen().locator('h2').innerText(), { timeout: 10_000 }).toBe('Facture de solde · DEV-2026-021');
    const rangs = await fen().locator('.cmp').allInnerTexts();
    expect(rangs.map(net)).toEqual([
      'Taux de TVA Devis HT Acompte Solde HT',
      expect.stringMatching(/^TVA 19 % 1 629,750 DT − [\d\s]+,\d{3} DT [\d\s]+,\d{3} DT$/),
      expect.stringMatching(/^Total HT 1 629,750 DT − [\d\s]+,\d{3} DT [\d\s]+,\d{3} DT$/),
    ]);
    expect(net(await fen().locator('.ed-recap').innerText())).toContain(`Acompte déduit ${numAcompte} du ${jm(auj)} · 40 %`);
    expect(montantDe(net(await fen().locator('#sd-net').innerText()))).toBe(solde40);
    await photo('c-solde');
    await fen().locator('#sd-ok').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Facture de solde de ${net(C.money(solde40, 'DT'))} en brouillon : à émettre (1 acompte déduit)`);
    await expect.poll(async () => ((await pieces()).find((d) => d.type === 'facture' && d.settles)?.settles.depositIds ?? []).length, { timeout: 10_000 }).toBe(1);

    // D. L'Hôtel Thyna : son comptoir est commandé par téléphone, Hatem le facture tout de suite, sans noter la réponse :
    // le devis dit qu'il est accepté, et quand.
    await ouvrir('q3');
    await p.locator('#bill-btn').click();
    await p.locator('#bill-list #convert').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).not.toBe('#/doc/q3');
    await expect.poll(async () => ((await piece('q3')).reponse ?? {}).le, { timeout: 10_000 }).toBe(auj);
    await ouvrir('q3');
    expect(await etape(3)).toBe(`Accepté ${jm(auj)} : fait`);
    // Le refacturer en entier : la fenêtre de la maquette, le chemin sûr d'abord.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/devis`);
    await p.locator('#list-wrap').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#list-wrap tr').filter({ hasText: 'DEV-2026-022' }).locator('.row-menu-btn').click();
    await p.locator('.row-menu').getByRole('menuitem').filter({ hasText: 'Refacturer la totalité…' }).click();
    await expect.poll(() => fen().locator('h2').innerText(), { timeout: 10_000 }).toBe('Refacturer la totalité ?');
    expect(net(await fen().locator('.bandeau').innerText())).toMatch(/^DEV-2026-022 a déjà donné un brouillon de facture de .+ Elle est encore en brouillon : corrige-la plutôt\. Une seconde facture du devis entier ferait payer le client deux fois\.$/);
    await photo('d-refacturer');
    await fen().locator('#rf-voir').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#\/doc\/(?!q3)/);
    await expect.poll(async () => (await pieces()).filter((d) => d.type === 'facture' && d.fromQuoteId === 'q3').length, { timeout: 10_000 }).toBe(1);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
