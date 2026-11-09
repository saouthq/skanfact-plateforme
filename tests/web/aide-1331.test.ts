// (1.331.0) L'aide, le guide et le support, joués comme une utilisatrice (docs/revue-modules.md) :
//   - une QUESTION tapée (« comment valider le pointage ») trouve son article : les petits mots ne cherchent rien, un mot se
//     cherche par sa racine, et un article qui n'a qu'une partie des mots se propose après ceux qui les ont tous ;
//   - rien trouvé : la question part au support telle qu'elle a été tapée, le curseur au bout du texte ; refermer sans
//     rien changer ne demande rien ;
//   - l'en-tête dit le chemin (Accueil › Aide › le domaine › l'article), sans « ← Accueil » ni « Nouveautés » qui
//     n'ouvrait que « Historique indisponible » ; le geste d'un article mène au panneau qu'il nomme ;
//   - le journal des clôtures dit le jour du geste et la personne qui l'a fait (il notait « cet ordinateur », sans le
//     montrer).
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


describe('l\'aide, le guide et le support, à la souris (1.331.0)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-aide-1331-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
        const email = `sarra-aide-1331-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
        const karimEmail = `karim-aide-1331-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    return { jeton, ent, karim };
  };



  // La fiche de la boulangerie est faite (l'assistant ne s'ouvre pas par-dessus), puis SkanFact s'ouvre sur `hash`.
  const ouvrir = async (jeton: string, ent: string, hash: string) => {
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
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    return { p, cx, erreurs };
  };

  it('une question trouve son article ; rien trouvé, elle part au support telle quelle', async () => {
    const { jeton, ent } = await boulangerie();
    const { p, cx, erreurs } = await ouvrir(jeton, ent, '#/aide');
    await p.locator('#aide-q').waitFor({ timeout: 20_000 });
    // L'en-tête des autres pages : le chemin, le titre, sa phrase ; ni « ← Accueil » (le chemin y mène), ni « Nouveautés »
    // (en ligne, il n'ouvrait que « Historique indisponible »).
    expect(net(await p.locator('.aide-tete .chemin').innerText())).toBe('Accueil Aide');
    expect(await p.locator('.aide-tete #back').count()).toBe(0);
    expect(await p.locator('#aide-changelog').count()).toBe(0);
    expect(await p.locator('#aide-idee').count()).toBe(1);
    expect(await p.locator('.aide-tete .actions .btn').allInnerTexts()).toContain('Écrire au support');

    // 1. Une question, tapée au clavier comme on la pose.
    await p.locator('#aide-q').click();
    await p.keyboard.type('comment valider le pointage');
    await expect.poll(() => p.locator('#aide-res .help-art').count(), { timeout: 5_000 }).toBeGreaterThan(1);
    expect(await p.locator('#aide-res .help-art').first().getAttribute('data-art')).toBe('paie');
    expect(net(await p.locator('#aide-n').innerText())).toMatch(/^1 article avec tous tes mots, puis \d+ autres qui en ont une partie$/);
    expect(await p.locator('#aide-partie').count()).toBe(1);
    // Le mot entier se surligne, pas sa racine (« valid|ité »).
    const marques = await p.locator('#aide-res .help-art').first().locator('mark').allInnerTexts();
    expect(marques.length).toBeGreaterThan(0);
    expect(marques.every((x) => /^(pointage|valider|valides|validé|validée|validation)$/i.test(x.trim()))).toBe(true);
    // « congés » trouve l'article des congés (la racine), et un pluriel ne fait pas tout perdre.
    await p.locator('#aide-q').fill('');
    await p.keyboard.type('noter une demande de congés');
    await expect.poll(async () => (await p.locator('#aide-res .help-art').evaluateAll((xs) => xs.slice(0, 3).map((x) => x.getAttribute('data-art')))).includes('conges'), { timeout: 5_000 }).toBe(true);
    // « les avoirs » : l'article dit « avoir » ; sans la racine, « Facturer » passait devant.
    await p.locator('#aide-q').fill('');
    await p.keyboard.type('les avoirs');
    await expect.poll(() => p.locator('#aide-res .help-art').first().getAttribute('data-art'), { timeout: 5_000 }).toBe('avoir');

    // 2. Rien trouvé : la question part au support, telle qu'elle a été tapée.
    await p.locator('#aide-q').fill('');
    await p.keyboard.type('xylophone tablette');
    await p.locator('#aide-res .empty').waitFor({ timeout: 5_000 });
    expect(net(await p.locator('#aide-res .empty').innerText())).toContain('Pose ta question au support');
    await p.locator('#aide-q-support').click();
    const m = p.locator('#modal-root .modal').last();
    await m.locator('#sup-sujet').waitFor({ timeout: 5_000 });
    expect(await m.locator('#sup-sujet').inputValue()).toBe('xylophone tablette');
    expect(await m.locator('#sup-texte-demande').inputValue()).toBe('xylophone tablette');
    await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 3_000 }).toBe('sup-texte-demande');
    // Refermer sans rien changer ne demande rien : ce qui est prérempli n'est pas une saisie.
    await m.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 3_000 }).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('un article dit son chemin, et son geste mène au panneau qu\'il nomme', async () => {
    const { jeton, ent } = await boulangerie();
    const { p, cx, erreurs } = await ouvrir(jeton, ent, '#/aide/licence');
    await p.locator('.help-body').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.aide-tete .chemin').innerText())).toBe('Accueil Aide Piloter et protéger Ton abonnement');
    // Le fil d'Ariane de l'article est passé dans le chemin : « Aide » ne s'écrit plus deux fois l'un sous l'autre.
    expect(await p.locator('.help-fil').count()).toBe(0);
    expect(net(await p.locator('.help-body').innerText())).not.toMatch(/SKAN1|licence expirée|ton ordinateur/);
    await p.locator('[data-geste]').click();
    await p.locator('#p-abonnement').waitFor({ state: 'visible', timeout: 10_000 });
    expect(p.url()).toMatch(/#\/parametres$/);

    // « Travailler à plusieurs » mène à l'équipe, pas en haut de « Ton compte ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/aide/deux`);
    await p.locator('.help-body').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('[data-geste]').innerText())).toBe('Inviter quelqu\'un');
    await p.locator('[data-geste]').click();
    await p.locator('#p-equipe').waitFor({ state: 'visible', timeout: 10_000 });

    // « Clôturer un mois » mène à l'onglet des clôtures ; le chemin ramène à l'Aide.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/aide/cloture`);
    await p.locator('.help-body').waitFor({ timeout: 20_000 });
    await p.locator('[data-geste]').click();
    await p.getByRole('heading', { name: /Journal des clôtures/ }).waitFor({ timeout: 10_000 });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/aide/cloture`);
    await p.locator('.help-body').waitFor({ timeout: 20_000 });
    await p.locator('.aide-tete .chemin [data-home]').click();
    await p.locator('#aide-vue .help-secs').waitFor({ timeout: 10_000 });
    expect(p.url()).toMatch(/#\/aide$/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('le journal des clôtures dit le jour du geste et la personne qui l\'a fait', async () => {
    const { jeton, ent } = await boulangerie();
    // Un devis du mois dernier : le mois se clôture.
    const [aa, mm] = aujourdhui.slice(0, 7).split('-').map(Number) as [number, number];
    const y = mm === 1 ? aa - 1 : aa, mois = mm === 1 ? 12 : mm - 1;
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', number: '', status: 'brouillon', date: `${y}-${String(mois).padStart(2, '0')}-05`, createdAt: 1,
        lines: [{ label: 'Pain de mie', qty: 10, unitPrice: 2, vatRate: 7 }], payments: [] } },
    ] })).statut).toBe(200);
    const nom = String((await api('GET', '/moi', jeton)).corps.nom || '');
    expect(nom).not.toBe('');
    const { p, cx, erreurs } = await ouvrir(jeton, ent, '#/compta');
    await p.locator('#c-tabs [data-tab="clotures"]').click();
    await p.locator('#do-close').click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Clôturer', exact: true }).click();
    const ligne = p.locator('table.list tbody tr').filter({ hasText: 'Clôture' }).first();
    await ligne.waitFor({ timeout: 10_000 });
    const entetes = await p.locator('table.list thead th').allInnerTexts();
    expect(entetes.map((x) => x.trim())).toEqual(expect.arrayContaining(['Le', 'Par']));
    const cellules = (await ligne.locator('td').allInnerTexts()).map(net);
    const [jj, mmm, aaaa] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).split('-').reverse();
    expect(cellules).toContain(`${jj}/${mmm}/${aaaa}`);
    expect(cellules).toContain(net(nom));
    expect(cellules.join(' ')).not.toContain('cet ordinateur');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
