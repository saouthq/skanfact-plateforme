// La fiche d'une liste de prix au squelette des pièces (1.292.0) : la frise, le résumé, la liste qui passe avant pour un
// client (aujourd'hui ou plus tard dans sa durée), la liste suivante (préparée, ou déjà prête), tout le catalogue à −x %,
// le prix sous le coût, l'article en double refusé.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la fiche d\'une liste de prix', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-listeprix-fiche-'));
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
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('fin proche, liste qui passe avant, suivante préparée puis prête, remise sur le catalogue', async () => {
    const email = `lp-fiche-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux du Sahel' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (k: number) => new Date(Date.parse(auj) + k * 86_400_000).toISOString().slice(0, 10);
    const fr = (iso: string) => iso.split('-').reverse().join('/');
    const o = (collection: string, cle: string, contenu: Record<string, unknown>) => ({ collection, cle, rang: 0, revision: null, contenu: { id: cle, ...contenu } });
    const art = (id: string, label: string, prix: string, cout?: string) => o('catalog', id, { label, unit: 'pièce', unitPrice: { '~n': prix }, unitCost: cout ? { '~n': cout } : '', vatRate: 19, type: 'produit' });
    const liste = (id: string, nom: string, extra: Record<string, unknown>, lignes: { itemId: string; prix: string }[]) => o('priceLists', id, { nom, categorie: '', clientIds: [], depuis: '', jusquau: '', lignes: lignes.map((x) => ({ itemId: x.itemId, prix: { '~n': x.prix } })), ...extra });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      art('ciment', 'Ciment gris 50 kg', '21.000', '17.400'), art('fer', 'Fer à béton 12 mm (t)', '2480.000', '2210.000'), art('sable', 'Sable fin (m³)', '58.500'),
      o('clients', 'c1', { name: 'Quincaillerie El Amel', categorieTarif: 'Revendeur' }), o('clients', 'c2', { name: 'Matériaux Ben Romdhane', categorieTarif: 'revendeur ' }), o('clients', 'c3', { name: 'Mme Nadia Trabelsi' }),
      // Elle finit dans 14 jours ; une liste nomme El Amel (elle passe avant) ; une promotion commencera pendant la suivante.
      liste('lrev', 'Revendeurs 2026', { categorie: 'Revendeur', depuis: jour(-300), jusquau: jour(14) }, [{ itemId: 'ciment', prix: '19.500' }, { itemId: 'fer', prix: '2390.000' }]),
      liste('llac', 'Chantier Lac 2', { clientIds: ['c1'], depuis: jour(-60) }, [{ itemId: 'ciment', prix: '18.900' }]),
      liste('lhiv', 'Promo hiver', { categorie: 'Revendeur', depuis: jour(25), jusquau: jour(85) }, [{ itemId: 'sable', prix: '52.000' }]),
      liste('lold', 'Revendeurs 2025', { categorie: 'Revendeur', depuis: jour(-700), jusquau: jour(-301) }, [{ itemId: 'ciment', prix: '18.000' }])] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const ouvrir = async (id: string) => {
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/listeprix/${id}`);
      await p.locator('#lp-resume').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const vert = () => p.locator('#ed-geste .btn-primary');
    const frise = () => p.locator('#lp-frise li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('b')?.textContent}:${li.querySelector('.ed-fr-txt > span')?.textContent}`));

    // 1. Elle finit dans 14 jours : le vert prépare la suivante ; deux listes passent avant pour certains clients, l'une
    // dès maintenant (elle nomme El Amel), l'autre à partir du jour où elle commence.
    await ouvrir('lrev');
    expect(await frise()).toEqual(['Préparée:enregistrée', `En vigueur:depuis le ${fr(jour(-300))}`, `Fin:jusqu'au ${fr(jour(14))}`]);
    expect(net(await p.locator('#lp-r-noms').innerText())).toBe('Quincaillerie El Amel, Matériaux Ben Romdhane');
    expect(await vert().getAttribute('id')).toBe('lp-suite');
    expect(net(await p.locator('#lp-masque-b').innerText())).toContain('Pour Quincaillerie El Amel, la liste « Chantier Lac 2 » passe avant celle-ci sur certains articles.');
    expect(net(await p.locator('#lp-masque-b').innerText())).not.toContain('Promo hiver');

    // 2. La suivante : dès le lendemain de la fin, pour un an, les mêmes clients et les mêmes prix ; l'année du nom avance.
    await vert().click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/listeprix/new');
    await expect.poll(() => p.locator('#lp-head input[name=nom]').inputValue().catch(() => ''), { timeout: 10_000 }).toBe('Revendeurs 2027');
    expect(await p.locator('#lp-head [name=depuis]').inputValue()).toBe(jour(15));
    const unAn = new Date(Date.UTC(Number(jour(15).slice(0, 4)) + 1, Number(jour(15).slice(5, 7)) - 1, Number(jour(15).slice(8, 10)) - 1)).toISOString().slice(0, 10);
    expect(await p.locator('#lp-head [name=jusquau]').inputValue()).toBe(unAn);
    // Sans sable, la promotion d'hiver (le sable seul) ne la touche pas.
    expect(net(await p.locator('#lp-masque-b').innerText())).not.toContain('Promo hiver');

    // 3. Tout le catalogue à −x % : sans remise, refusé et dit ; à 12 %, chaque article au millime, le fer sous son coût.
    await p.locator('#lp-pct-ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 5_000 }).toContain('Indique une remise entre 0 et 100 %');
    await p.locator('#lp-pct').fill('12');
    await p.locator('#lp-pct-ok').click();
    const prix = () => p.locator('#lp-lignes input[data-lk=prix]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));
    expect(await prix()).toEqual(['18.480', '2182.400', '51.480']);
    expect(net(await p.locator('#lp-lignes [data-perte]').innerText())).toBe('sous son coût (2 210,000 DT)');
    expect(await p.locator('#lp-lignes [data-perte]').count()).toBe(1);
    expect(net(await p.locator('#lp-r-ecart').innerText())).toBe('−12 %');
    // Le sable est maintenant dans la liste : la promotion qui commence pendant sa durée passe avant, le bandeau le dit.
    expect(net(await p.locator('#lp-masque-b').innerText())).toContain(`la liste « Promo hiver » passe avant celle-ci sur certains articles à partir du ${fr(jour(25))}.`);
    // Défaire le remplissage rend les deux prix d'avant.
    await p.locator('#lp-pct-annuler').click();
    expect(await prix()).toEqual(['19.500', '2390.000']);
    await p.locator('#lp-pct-ok').click();
    await vert().click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#\/listeprix\/(?!new)/);
    await expect.poll(async () => net(await p.locator('#lp-etat').innerText().catch(() => '')), { timeout: 10_000 }).toBe('à venir');
    expect(net(await p.locator('#ed-geste .ed-etat').innerText())).toBe(`Commence le ${fr(jour(15))} : d'ici là, ses clients ont les prix du catalogue.`);

    // 4. La liste qui finit a maintenant sa suivante : rien à préparer, la colonne y mène ; la liste de 2025 aussi, sans
    // bandeau (elle est finie : rien ne passe plus avant elle).
    await ouvrir('lrev');
    expect(await vert().count()).toBe(0);
    expect(net(await p.locator('#ed-geste .ed-etat').innerText())).toBe(`Elle finit le ${fr(jour(14))}. Sa suivante : Revendeurs 2027, dès le ${fr(jour(15))}.`);
    await ouvrir('lold');
    expect(await p.locator('#lp-masque-b').count()).toBe(0);
    expect(net(await p.locator('#ed-geste .ed-etat').innerText())).toBe(`Terminée le ${fr(jour(-301))}. Sa suivante : Revendeurs 2026, depuis le ${fr(jour(-300))}.`);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/listesprix`);
    await expect.poll(async () => net(await p.locator('#lp-resume').innerText().catch(() => '')), { timeout: 20_000 }).toContain('Revendeurs 2026 — dans 14 jours · la suivante est prête');

    // 5. Un article deux fois : refusé sur la ligne, rien n'est enregistré.
    await ouvrir('llac');
    await p.locator('#lp-add').click();
    await p.locator('#lp-lignes select[data-lk=itemId]').nth(1).selectOption('ciment');
    await p.locator('#lp-lignes input[data-lk=prix]').nth(1).fill('18.500');
    await vert().click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 5_000 }).toBe('« Ciment gris 50 kg » est deux fois dans la liste : garde une seule ligne par article.');
    const stocke = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: { lignes: unknown[] } }[]).find((x) => x.collection === 'priceLists' && x.cle === 'llac');
    expect(stocke?.contenu.lignes.length).toBe(1);
    expect(erreurs).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'listeprix-fiche-1-double.png') });
    await cx.close();
  }, 180_000);
});
