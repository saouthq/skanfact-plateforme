// Deux gestes de « Déclarer et clôturer » qui parlaient faux (1.378.4 ; issue 9, CABDECLARER-15 et -22), sur un dossier
// que le cabinet tient lui-même — le cas de presque tous ses clients au premier jour :
//   - « Ouvrir 2027 (à-nouveaux)… » sur un exercice qui n'est pas fini DEMANDE avant d'écrire, et dit que les à-nouveaux
//     seront à refaire ; « Pas maintenant » n'écrit rien ;
//   - une question posée à un client sans SkanFact ne « part » nulle part : le contrôle de la révision le dit, au lieu de
//     promettre un envoi dans une conversation qui n'existe pas.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'exercice suivant se demande, et la question d\'un dossier tenu dit où elle est (1.378.4)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ouvrir-1378-4-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };


  const SESSION = (j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); };

  it('(1.378.4) ouvrir l\'exercice suivant d\'un exercice en cours se confirme ; la question d\'un dossier tenu reste dans la révision, et le dit', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const an = new Date().getFullYear();
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    const ids = [
      await saisir(`${an}-01-01`, 'AN', 'AN-1', 'Solde de la banque repris', [['532', '5000', ''], ['101', '', '5000']]),
      await saisir(`${an}-02-10`, 'BQ', 'VIR-7', 'Virement reçu, sans pièce', [['532', '1200,500', ''], ['471', '', '1200,500']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript(SESSION, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const ouvrir = async (onglet: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/${onglet}/${an}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(600);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const fenetre = p.locator('#modal-root .modal').last();

    // ── Ouvrir l'année suivante : la question d'abord ─────────────────────────────────────────────
    await ouvrir('exercice');
    await expect.poll(() => p.locator('#cl-suivant').innerText(), { timeout: 15_000 }).toBe(`Ouvrir ${an + 1} (à-nouveaux)…`);
    await p.locator('#cl-suivant').click();
    await p.locator('#cl-suivant-avant').waitFor({ timeout: 10_000 });
    expect(net(await fenetre.locator('h2').innerText())).toBe(`Ouvrir ${an + 1} dès maintenant ?`);
    expect(net(await p.locator('#cl-suivant-avant').innerText())).toContain(`L'exercice ${an} n'est pas fini (il va jusqu'au 31/12/${an})`);
    expect(net(await p.locator('#cl-suivant-avant').innerText())).toContain(`seront à refaire une fois ${an} clôturé`);
    await p.screenshot({ path: path.join(PHOTOS, 'ouvrir-1378-4-a-question.png') });
    // « Pas maintenant » n'écrit rien : le bouton propose toujours d'ouvrir, le livre de l'an prochain n'existe pas.
    await fenetre.getByRole('button', { name: 'Pas maintenant', exact: true }).click();
    await p.waitForTimeout(500);
    expect(await p.locator('#cl-suivant').innerText()).toBe(`Ouvrir ${an + 1} (à-nouveaux)…`);
    const exercices = (await api('GET', `/entreprises/${ent}/compta/exercices`, associe)).corps as unknown as { exercices?: { annee: number }[] };
    expect(JSON.stringify(exercices)).not.toContain(`"annee":${an + 1}`);
    // Confirmé : les à-nouveaux se posent, et la suite se lit.
    await p.locator('#cl-suivant').click();
    await fenetre.getByRole('button', { name: `Ouvrir ${an + 1}`, exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('h2').innerText().catch(() => '')), { timeout: 15_000 }).toBe(`À-nouveaux posés sur ${an + 1}`);
    await fenetre.getByRole('button', { name: `Rester sur ${an}`, exact: true }).click();

    // ── La question à un client sans SkanFact ─────────────────────────────────────────────────────
    await ouvrir('revision');
    await p.locator('#rv-question').click({ timeout: 15_000 });
    await p.locator('#qf-texte').fill('Peux-tu m\'envoyer la pièce de ce virement de 1 200,500 DT ?');
    expect(net(await fenetre.locator('.qf-ou').innerText())).toBe('Ce dossier n\'a pas SkanFact : la question reste dans ta révision, pour la lui poser de vive voix ou par e-mail.');
    await p.locator('#qf-garder').click();
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 15_000 }).toContain('1 question posée : ce dossier n\'a pas SkanFact, elle reste dans ta révision. Pose-la de vive voix ou par e-mail, puis note la réponse ici.');
    const vue = net(await p.locator('#view').innerText());
    expect(vue).not.toContain('pas encore partie');
    expect(vue).not.toContain('conversation');
    await p.screenshot({ path: path.join(PHOTOS, 'ouvrir-1378-4-b-question-tenue.png'), fullPage: true });

    expect(erreurs).toEqual([]);
    await ctx.close();
  }, 180_000);
});
