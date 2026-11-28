// Les clés d'accès (1.390.0, tâche 107), jouées dans un vrai navigateur avec l'appareil imité de Chromium (son
// « authentificateur virtuel », qui garde des clés et vérifie la personne comme un téléphone le ferait) : ajouter une clé
// depuis Ton compte (le mot de passe d'abord), se déconnecter, entrer par « Se connecter avec une clé d'accès » sans
// adresse ni mot de passe, puis retirer la clé — et l'entrée par la clé ne marche plus.
// Une clé ne vaut que pour une adresse https ou « localhost » (jamais une adresse IP) : le serveur de ce test a son
// adresse publique en « localhost ».

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
// Le texte d'un écran, ses espaces (fines insécables comprises) ramenées à une seule.
const plat = (t: string) => t.replace(/\s+/g, ' ');
const portLibre = () => new Promise<number>((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const a = s.address() as net.AddressInfo; s.close(() => ok(a.port)); }); });

describe('les clés d\'accès, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let PUBLIQUE = '';
  let INTERNE = '';
  const partis: Courriel[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cles-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    const port = await portLibre();
    PUBLIQUE = `http://localhost:${port}`;
    INTERNE = `http://127.0.0.1:${port}`;
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_ADRESSE: PUBLIQUE }), port, hote: '127.0.0.1', web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${INTERNE}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const codeRecu = (email: string) => /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
  async function personne(nom: string) {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const defi = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi);
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeRecu(email) })).corps.jeton);
    return { email, jeton };
  }
  async function ouvrirCompte(p: Page, adresse?: string, base = PUBLIQUE) {
    if (adresse) await p.goto(`${base}${adresse}`); else await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.getByRole('tab', { name: 'Ton compte', exact: true }).click();
  }
  async function page(jeton: string) {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  }
  const MDP = 'Un-bon-mot-de-passe';
  // L'appareil imité : il garde les clés qu'on y crée, et la personne est « vérifiée » à chaque demande.
  // `garde` : les clés d'un autre appareil imité, recopiées dans celui-ci (le même téléphone, dans un autre navigateur).
  type Cle = { credentialId: string; isResidentCredential: boolean; rpId?: string; privateKey: string; signCount: number; userHandle?: string };
  async function appareil(p: Page, garde: Cle[] = []) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    for (const credential of garde) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
    return { cles: async (): Promise<Cle[]> => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials };
  }

  it('ajouter une clé, entrer sans mot de passe, la retirer', async () => {
    const { email, jeton } = await personne('nadia');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Clé SARL' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await p.goto(`${PUBLIQUE}/v10/?e=${ent}`);
    const app = await appareil(p);
    await ouvrirCompte(p, `/v10/?e=${ent}#/parametres`);

    // La section se montre, recommandée, avec son bouton vert.
    const section = p.locator('#cpt-cles');
    await section.waitFor({ timeout: 10_000 });
    expect(await section.locator('.badge').innerText()).toBe('Recommandé');
    await p.locator('#cpt-cle-ajouter').click();
    const f = p.locator('#modal-root');
    // Un mauvais mot de passe : refusé, la case marquée.
    await f.locator('#cpt-mdp-actuel').fill('pas-le-bon-mot');
    await f.getByRole('button', { name: 'Créer la clé', exact: true }).click();
    await expect.poll(async () => f.locator('#cpt-mdp-actuel').getAttribute('aria-invalid'), { timeout: 10_000 }).toBe('true');
    expect(await app.cles()).toEqual([]);
    // Le bon : l'appareil crée la clé, la liste la montre, l'adresse est prévenue.
    await f.locator('#cpt-cle-nom').fill('Téléphone de Nadia');
    await f.locator('#cpt-mdp-actuel').fill(MDP);
    await f.getByRole('button', { name: 'Créer la clé', exact: true }).click();
    await p.locator('#cpt-cles-liste').waitFor({ timeout: 15_000 });
    expect((await p.locator('#cpt-cles-liste li b').allInnerTexts())).toEqual(['Téléphone de Nadia']);
    expect(await p.locator('#cpt-cles-liste li .muted').innerText()).toMatch(/^Ajoutée le \d{2}\/\d{2}\/\d{4} · pas encore utilisée$/);
    expect((await app.cles()).map((c) => [c.isResidentCredential, c.rpId])).toEqual([[true, 'localhost']]);
    expect(partis.filter((m) => m.a === email).map((m) => m.objet)).toContain('Une clé d\'accès a été ajoutée à ton compte SkanFact');

    // Ajouter la même : cet appareil a déjà une clé pour ce compte.
    await p.locator('#cpt-cle-ajouter').click();
    await f.locator('#cpt-mdp-actuel').fill(MDP);
    await f.getByRole('button', { name: 'Créer la clé', exact: true }).click();
    await expect.poll(async () => plat(await f.getByRole('alert').innerText()), { timeout: 15_000 }).toBe('Cet appareil a déjà une clé d\'accès pour ton compte : elle est dans la liste.');
    await f.getByRole('button', { name: 'Annuler', exact: true }).click();

    // Un autre navigateur, sans session : le même appareil (la clé y est recopiée), et l'entrée par la clé, sans adresse
    // ni mot de passe.
    const garde = await app.cles();
    await api('POST', '/deconnexion', jeton);
    const cx2 = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p2 = await cx2.newPage();
    p2.on('pageerror', (e) => erreurs.push(e.message));
    await p2.goto(`${PUBLIQUE}/`);
    const app2 = await appareil(p2, garde);
    const entrer = p2.locator('#connexion-cle');
    await entrer.waitFor({ timeout: 15_000 });
    expect(plat(await entrer.innerText())).toBe('Se connecter avec une clé d\'accès');
    await entrer.click();
    await expect.poll(async () => p2.locator('#connexion-cle').count(), { timeout: 15_000 }).toBe(0);
    expect(await app2.cles()).toHaveLength(1);

    // La clé utilisée se lit dans Ton compte ; la retirer se demande, puis la clé ne connecte plus.
    await ouvrirCompte(p2, `/v10/?e=${ent}#/parametres`);
    await p2.locator('#cpt-cles-liste').waitFor({ timeout: 10_000 });
    expect(await p2.locator('#cpt-cles-liste li .muted').innerText()).toMatch(/utilisée pour la dernière fois le \d{2}\/\d{2}\/\d{4}$/);
    const retirer = p2.locator('[data-retirer-cle]');
    await retirer.click();
    expect(await retirer.innerText()).toBe('Oui, la retirer');
    expect(plat(await p2.locator('#cpt-cles-alerte').innerText())).toBe('« Téléphone de Nadia » ne permettra plus d\'entrer. Tu pourras toujours te connecter avec ton adresse et ton mot de passe.');
    await retirer.click();
    await expect.poll(async () => p2.locator('#cpt-cles-liste').count(), { timeout: 10_000 }).toBe(0);

    await p2.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await p2.goto(`${PUBLIQUE}/`);
    await p2.locator('#connexion-cle').click();
    await expect.poll(async () => plat(await p2.getByRole('alert').first().innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Cette clé d\'accès n\'est pas reconnue : connecte-toi avec ton adresse et ton mot de passe.');
    await cx2.close();
    expect(erreurs).toEqual([]);
  });
});
