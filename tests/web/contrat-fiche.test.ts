// La fiche d'un contrat récurrent au squelette des pièces (1.290.0) : la frise, le résumé, UN bouton vert qui suit l'étape,
// et la fin d'un contrat (« terminé »).
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

describe('la fiche d\'un contrat récurrent', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-contrat-fiche-'));
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

  // (1.290.0) La fiche d'un contrat au squelette des pièces : frise contrat → prochaine facture → encaissé, résumé à droite,
  // UN bouton vert qui suit l'étape (générer, puis émettre le brouillon préparé, reprendre un contrat suspendu), et la fin
  // d'un contrat : passé sa fin, il est « terminé », ne compte plus « à générer » et ne se suspend plus.
  it('dû, généré puis à émettre ; suspendu puis repris ; terminé', async () => {
    const email = `contrat-fiche-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Ascenseurs Ben Salah' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (k: number) => new Date(Date.parse(auj) + k * 86_400_000).toISOString().slice(0, 10);
    const fr = (iso: string) => iso.split('-').reverse().join('/');
    const ligne = (label: string, prix: string) => ({ label, qty: 1, unit: 'mois', unitPrice: { '~n': prix }, vatRate: 19 });
    const contrat = (id: string, contenu: Record<string, unknown>) => ({ collection: 'recurring', cle: id, rang: 0, revision: null, contenu: { id, clientId: 'c1', every: 'month', day: 1, active: true, ...contenu } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Résidence Les Jasmins' } },
      contrat('du', { subject: 'Entretien des ascenseurs', nextDate: jour(-3), lines: [ligne('Entretien mensuel', '437.500')] }),
      contrat('pause', { subject: 'Nettoyage des parties communes', nextDate: jour(-40), active: false, lines: [ligne('Nettoyage', '612.300')] }),
      // Fini : sa fin (il y a vingt jours) est passée avant sa prochaine échéance (il y a cinq jours).
      contrat('fini', { subject: 'Location du photocopieur', nextDate: jour(-5), endDate: jour(-20), lines: [ligne('Location', '540.000')] })] });
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
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrat/${id}`);
      await p.locator('#c-resume-fiche').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };

    // Dû : le bouton vert génère, la frise le dit ; le menu ne compte que lui (pas le contrat fini).
    await ouvrir('du');
    expect(net(await p.locator('.ed-chemin').innerText())).toBe('Accueil › Facturation récurrente › Entretien des ascenseurs');
    expect(await p.locator('#c-etat').innerText()).toBe('actif');
    expect(net(await p.locator('#c-resume-fiche').innerText())).toContain('Par facture (HT) i 437,500 DT Soit TTC 521,625 DT');
    expect(await p.locator('#ed-geste .btn-primary').count()).toBe(1);
    expect(await p.locator('#ed-geste .btn-primary').getAttribute('id')).toBe('c-gen2');
    expect(net(await p.locator('#c-frise li').nth(1).innerText())).toContain(`à générer · ${fr(jour(-3))}`);
    expect((await p.locator('#nav-contrats').innerText()).trim()).toBe('1');
    await p.screenshot({ path: path.join(PHOTOS, 'contrat-fiche-1-du.png') });
    await p.locator('#c-gen2').click();
    // Généré : l'étape suivante est d'émettre le brouillon préparé ; il est dans la liste des factures du contrat.
    await expect.poll(async () => p.locator('#ed-geste .btn-primary').getAttribute('id').catch(() => ''), { timeout: 10_000 }).toBe('c-emettre');
    expect(net(await p.locator('#c-emettre').innerText())).toMatch(/^Émettre la facture de \S+ \d{4}$/);
    expect(await p.locator('#c-gen2').count()).toBe(0);
    expect(net(await p.locator('#c-docs').innerText())).toContain('brouillon');
    await p.screenshot({ path: path.join(PHOTOS, 'contrat-fiche-2-a-emettre.png') });
    await p.locator('#c-emettre').click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(/#\/doc\/[^/]+$/);

    // Suspendu : le vert reprend ; la liste vide ne promet pas une date passée.
    await ouvrir('pause');
    expect(await p.locator('#c-etat').innerText()).toBe('suspendu');
    expect(await p.locator('#ed-geste .btn-primary').getAttribute('id')).toBe('c-toggle');
    expect(net(await p.locator('#c-docs').innerText())).toBe('Aucune facture pour l\'instant : le contrat est suspendu.');
    await p.locator('#c-toggle').click();
    await expect.poll(async () => p.locator('#c-etat').innerText().catch(() => ''), { timeout: 10_000 }).toBe('actif');
    expect(await p.locator('#ed-geste .btn-primary').count()).toBe(0);

    // Terminé : pas de vert, pas de « Suspendre », la phrase dit la fin et comment prolonger.
    await ouvrir('fini');
    expect(await p.locator('#c-etat').innerText()).toBe('terminé');
    expect(await p.locator('#ed-geste .btn-primary').count()).toBe(0);
    expect(await p.locator('#c-toggle').count()).toBe(0);
    expect(net(await p.locator('#ed-geste .ed-etat').innerText())).toBe(`Contrat terminé le ${fr(jour(-20))} : il ne prépare plus de facture. Recule sa fin (Modifier) pour le prolonger.`);
    await p.screenshot({ path: path.join(PHOTOS, 'contrat-fiche-3-termine.png') });

    // La liste : le filtre « Terminés » ne montre que lui.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrats`);
    await p.locator('#st').waitFor({ timeout: 20_000 });
    await p.locator('#st').selectOption('terminé');
    await expect.poll(async () => p.locator('#c-wrap tr[data-rid]').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.locator('#c-wrap tr[data-rid]').getAttribute('data-rid')).toBe('fini');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
