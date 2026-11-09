// (1.330.0) La paie de la boulangerie, jouée à la souris (docs/revue-modules.md) :
//   - « Le mois » en FRISE (Skander, 09/11 : « je n'aime pas les 4 card, ce n'est pas intuitif ni ergonomique et ça porte à
//     confusion ») : un seul repère pour l'étape affichée ; l'étape « Pointer » ne se dit pas « facultatif » quand ses
//     journées retiennent les bulletins, et se dit faite une fois le mois validé ; regarder une autre étape que celle du
//     moment le dit et y mène ;
//   - le brut prérempli à 0,000 se remplace : « 1250 » tapé après un clic donnait 12 500 DT ;
//   - « Une absence sur plusieurs jours » ouverte depuis un mois passé propose un jour de ce mois ;
//   - ouverte sur la case du RIB, la fiche la montre au-dessus de son pied ; le RIB s'enregistre sans ses espaces.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { poserMouchard, retirerMouchard } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le mois de la paie, en frise, et la fiche d\'un salarié tapée à la souris (1.330.0)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1330-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await retirerMouchard(admin).catch(() => undefined); await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // La boulangerie : Sarra, propriétaire (avec son code), et Karim, commercial.
  const boulangerie = async () => {
        const email = `sarra-paie-1330-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
        const karimEmail = `karim-paie-1330-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    return { jeton, ent, karim };
  };


  it('la frise du mois, le brut tapé après un clic, l\'absence du mois regardé, la case du RIB visible et enregistrée sans espaces', async () => {
    const { jeton, ent } = await boulangerie();
    // Le mois écoulé : deux salariés présents à leurs horaires, aucune journée validée.
    const [aa, mm] = aujourdhui.slice(0, 7).split('-').map(Number) as [number, number];
    const y = mm === 1 ? aa - 1 : aa, m = mm === 1 ? 12 : mm - 1, ym = `${y}-${String(m).padStart(2, '0')}`;
    const salarie = (id: string, name: string, grossSalary: number, iban: string) => ({ id, name, cin: '', cnss: '', position: 'Boulanger', contract: 'cdi',
      hireDate: '2023-03-01', endDate: '', grossSalary, headOfFamily: false, children: 0, method: 'virement', iban, notes: '', active: true });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: salarie('e1', 'Hédi Trabelsi', 1250, '') },
      { collection: 'employees', cle: 'e2', rang: 1, revision: null, contenu: salarie('e2', 'Amira Ben Salah', 600, '') },
    ] })).statut).toBe(200);
    // La fiche de la boulangerie est faite : l'assistant ne s'ouvre pas par-dessus la paie.
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Gharbi', address: 'Rue de Marseille\n1000 Tunis' } }] })).statut).toBe(200);
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // 1. Le mois écoulé, en frise : quatre étapes, UN seul repère (l'étape affichée), « Pointer » dit ce qui retient.
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator(`#p-mois [data-p-mois="${m}"]`).click();
    await p.locator('#p-sous .pa-etape[data-sous="pointage"]').click();
    const etapes = () => p.locator('#p-sous .pa-etape').evaluateAll((l) => l.map((x) => [(x as HTMLElement).dataset.sous, (x as HTMLElement).dataset.etat,
      x.classList.contains('ouverte'), (x.querySelector('.d')?.textContent || '').replace(/\s+/g, ' ').trim()]));
    await expect.poll(async () => (await etapes()).length, { timeout: 10_000 }).toBe(4);
    let E = await etapes();
    expect(E.filter((e) => e[2]).map((e) => e[0])).toEqual(['pointage']);
    expect(E[0]?.[1]).toBe('ici');
    expect(String(E[0]?.[3])).toMatch(/^1 chose à régler avant les bulletins$/);
    expect(E.map((e) => e[3]).join(' ')).not.toMatch(/facultatif/);
    // La frise relie ses étapes : un trait, pas des cartes (aucune bordure autour d'une étape).
    expect(await p.locator('#p-sous .pa-etape').first().evaluate((x) => getComputedStyle(x).borderTopWidth)).toBe('0px');
    // « Une absence sur plusieurs jours » depuis le mois écoulé propose son 1er, pas aujourd'hui.
    await p.locator('#pt-periode').click();
    await expect.poll(() => p.locator('#pp [name="du"]').inputValue(), { timeout: 10_000 }).toBe(`${ym}-01`);
    await p.locator('.modal [data-close]').first().click();
    // Le mois validé : « Pointer » est fait, l'étape du moment passe aux bulletins.
    await p.locator('#pt-jav').click();
    await p.locator('#jav-ok').click();
    await expect.poll(() => p.locator('#pt-aregler').count(), { timeout: 10_000 }).toBe(0);
    await p.locator('#pt-valider').click();
    await expect.poll(async () => { const x = (await etapes())[0]; return `${x?.[1]} | ${x?.[3]}`; }, { timeout: 10_000 }).toBe('fait | le mois est validé');
    E = await etapes();
    expect(E[1]?.[1]).toBe('ici');
    // On regarde « Pointer », fait : une ligne le dit, et mène à l'étape du moment.
    expect(net(await p.locator('#pa-ou').innerText())).toMatch(/^Tu regardes Pointer, fait\. L'étape du moment : Bulletins — 0 sur 2 établis\. Aller à « Bulletins »$/);
    await p.locator('#pa-ou [data-aller-sous="bulletins"]').click();
    await expect.poll(async () => (await etapes()).filter((e) => e[2]).map((e) => e[0])).toEqual(['bulletins']);
    expect(await p.locator('#pa-ou').count()).toBe(0);

    // 2. Un salarié neuf : un clic dans le brut prérempli (à gauche du « 0,000 » aligné à droite), « 1250 » tapé : 1250.
    await p.locator('#p-tabs [data-tab="salaries"]').click();
    await p.locator('#new-emp, #p-embaucher').first().click();
    await p.locator('#ef input[name=name]').fill('Sami Khelifi');
    const brut = p.locator('#ef input[name=grossSalary]');
    await brut.scrollIntoViewIfNeeded();
    const b = await brut.boundingBox();
    if (!b) throw new Error('le brut est introuvable');
    await p.mouse.click(b.x + 12, b.y + b.height / 2);
    await p.keyboard.type('1250');
    expect(await brut.inputValue()).toBe('1250');

    // 3. La case du RIB amenée à l'écran (comme « Renseigner le RIB… » qui y pose le curseur) : au-dessus du pied de la
    // fenêtre, pas dessous ; le RIB tapé avec ses espaces s'enregistre sans eux.
    // Sur un portable (1366 × 640 utiles) : la fiche défile, et la case du RIB est sous le pied à l'ouverture.
    await p.setViewportSize({ width: 1366, height: 640 });
    const iban = p.locator('#ef input[name=iban]');
    await p.locator('.modal').first().evaluate((x) => { x.scrollTop = 0; });
    expect(await iban.evaluate((x) => {
      const pied = x.closest('.modal')?.querySelector(':scope > .modal-actions:last-child');
      return pied ? x.getBoundingClientRect().top > pied.getBoundingClientRect().top : false;
    })).toBe(true);
    await iban.focus();
    const vu = await iban.evaluate((x) => {
      const pied = x.closest('.modal')?.querySelector(':scope > .modal-actions:last-child');
      return pied ? x.getBoundingClientRect().bottom <= pied.getBoundingClientRect().top + 1 : false;
    });
    expect(vu).toBe(true);
    const rib = '08 123 0001234567890 52';
    await iban.fill(rib);
    await p.locator('.modal #ok').click();
    await expect.poll(async () => {
      const o = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
        .find((x) => x.collection === 'employees' && x.contenu.name === 'Sami Khelifi');
      return o?.contenu.iban;
    }, { timeout: 10_000 }).toBe(rib.replace(/\s/g, ''));

    // 4. Au téléphone, le mois validé : le bandeau « Validé le … » et ses deux gestes tiennent dans la largeur (ils poussaient
    // la page de 28 px de côté).
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator(`#p-mois [data-p-mois="${m}"]`).click();
    await p.locator('.pa-etape[data-sous="pointage"]').click();
    await expect.poll(() => p.locator('#pt-valide #pt-corriger').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
