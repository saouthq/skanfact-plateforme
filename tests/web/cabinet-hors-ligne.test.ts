// Le Cabinet se consulte sans réseau (1.104.0 ; docs/hors-ligne.md, H14 ; cadrage 04 § 2 : les dossiers qu'on
// emporte). À la souris, dans un vrai navigateur, le réseau coupé pour de vrai (le serveur s'arrête, et revient au même
// port), comme tests/web/hors-ligne.test.ts. Ce que le parcours vérifie :
//   - sur « mon ordinateur », ce que le Cabinet lit se garde sur le poste, CHIFFRÉ (une écriture du client ne s'y lit
//     pas) ; ses dossiers confiés sont emportés d'eux-mêmes (le livre de l'année), même ceux qu'on n'a pas ouverts ;
//   - le réseau coupé : le livre d'un dossier jamais ouvert se consulte (son écriture au brouillard est comptée), la page se recharge, et le bandeau dit depuis
//     quand, de quand date la copie, et qu'enregistrer demande le réseau ; une page jamais lue le dit, et un geste aussi ;
//   - l'application refermée se rouvre depuis l'entrée sur le Cabinet, toujours sans réseau ;
//   - le réseau revenu : « Recharger » relit le serveur ;
//   - « Se déconnecter », au pied de la barre, dit ce qui s'efface, et efface ce que le poste gardait.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('le Cabinet sans réseau, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-hors-ligne-'));
  const configuration = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), web: dossier, livreurMs: 60_000 });
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...configuration(), port: 0 });
    adresse = serveur.adresse;
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  const couper = async (c: BrowserContext) => { await c.setOffline(true); await serveur?.arreter(); serveur = null; };
  const retablir = async () => { if (!serveur) serveur = await demarrer({ ...configuration(), port: Number(new URL(adresse).port) }); };
  afterEach(async () => { await retablir(); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // Ce que le poste garde pour ce cabinet : les chemins lus, et si une écriture du client s'y lit en clair.
  const lePoste = (p: Page, cab: string) => p.evaluate(async (c) => {
    const bases = await indexedDB.databases();
    if (!bases.some((b) => b.name === 'skanfact-poste')) return null;
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('skanfact-poste'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    if (!db.objectStoreNames.contains('copies')) { db.close(); return { chemins: [] as string[], lisible: false }; }
    const tout = await new Promise<{ cles: IDBValidKey[]; valeurs: { chiffre: ArrayBuffer }[] }>((ok, ko) => {
      const s = db.transaction('copies').objectStore('copies');
      const k = s.getAllKeys(); const v = s.getAll();
      v.onsuccess = () => ok({ cles: k.result, valeurs: v.result }); v.onerror = () => ko(v.error);
    });
    db.close();
    const prefixe = `c:${c}:`;
    const chemins = tout.cles.map(String).filter((x) => x.startsWith(prefixe)).map((x) => x.slice(prefixe.length));
    const lisible = tout.valeurs.some((x) => new TextDecoder('latin1').decode(new Uint8Array(x.chiffre)).includes('Frais de tenue'));
    return { chemins, lisible };
  }, cab);
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('le Cabinet emporte ses dossiers, chiffrés ; sans réseau, il se consulte et se rouvre ; le réseau revenu, on recharge ; déconnecté, le poste oublie', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const annee = aujourdhui.slice(0, 4);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null,
        contenu: { id: 'm1', date: aujourdhui, kind: 'banque', amount: { '~n': '7.125' }, accountId: 'k-banque', method: 'virement', label: 'Frais de tenue de compte' } },
    ] })).statut).toBe(200);

    // « Mon ordinateur », l'application installée (le navigateur promet de garder : 04 § 4).
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await c.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await c.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, leila);
    const erreurs: string[] = [];
    let p = await c.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    // Ses dossiers sont emportés d'eux-mêmes : le livre de l'année du client, qu'on n'a pas ouvert, est sur le poste,
    // chiffré ; l'entrée saura rouvrir ce cabinet.
    await expect.poll(() => p.evaluate((c) => localStorage.getItem(`skanfact.emportes.${c}`), cabinet), { timeout: 30_000 }).not.toBe(null);
    expect(((await lePoste(p, cabinet))?.chemins ?? []).some((x) => x.startsWith(`/entreprises/${ent}/compta/ecritures?`))).toBe(true);
    expect((await lePoste(p, cabinet))?.lisible).toBe(false);
    expect(await p.evaluate(() => localStorage.getItem('skanfact.hors_ligne'))).toBe(`c:${cabinet}`);
    expect(await p.locator('#poste-bandeau:visible').count()).toBe(0);

    // ── Le réseau coupé : le livre du client se consulte, le bandeau le dit ───────────────────────
    await couper(c);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 })
      .toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. (Ce que tu vois reste à l'écran|Tu consultes la copie de ce poste, du \d\d\/\d\d\/\d{4} à \d{1,2} h \d\d)\. Ta saisie au brouillard se garde sur ce poste et partira seule au retour du réseau ; le reste demande le réseau\.$/);
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/journal/${annee}`);
    await expect.poll(() => p.locator('#c-livres').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/1 écriture de l'exercice attend au brouillard/);
    await expect.poll(() => p.locator('#poste-bandeau').innerText())
      .toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. Tu consultes la copie de ce poste, du \d\d\/\d\d\/\d{4} à \d{1,2} h \d\d\. Ta saisie au brouillard se garde sur ce poste et partira seule au retour du réseau ; le reste demande le réseau\.$/);
    // Le Cabinet se pousse sous le bandeau : rien ne passe dessous (le nom du cabinet était rogné).
    await expect.poll(() => p.evaluate(() => {
      const b = document.getElementById('poste-bandeau')?.getBoundingClientRect();
      const barre = document.querySelector('.sidebar')?.getBoundingClientRect();
      return !!b && !!barre && b.height > 0 && barre.top >= b.bottom - 1;
    })).toBe(true);
    // …et la page tient dans la fenêtre : pas de barre de défilement (la marge du Cabinet traversait le corps).
    expect(await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
    // La page se recharge sans réseau, et le livre se consulte encore.
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#c-livres').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/1 écriture de l'exercice attend au brouillard/);
    // Une page jamais lue sur ce poste (la conversation avec le client) le dit, avec ce qui la débloque.
    await p.evaluate((h) => { location.hash = h; }, `#/messages/${ent}`);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Hors ligne, et ce poste n'a pas encore lu cette page : ouvre-la une fois avec le réseau pour la consulter ensuite sans lui\./);

    // ── L'application refermée se rouvre depuis l'entrée, sur le Cabinet ──────────────────────────
    await p.close();
    p = await c.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/`);
    await p.waitForURL(/\/v10\/cabinet\/\?c=/, { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Droguerie du Port/);
    await expect.poll(() => p.locator('#poste-bandeau').innerText()).toMatch(/^Hors ligne depuis/);

    // ── Le réseau revenu : « Recharger » relit le serveur ─────────────────────────────────────────
    await retablir();
    await c.setOffline(false);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 }).toMatch(/^Le réseau est revenu\. Recharge pour voir ce que les autres ont fait depuis ta copie\./);
    await p.getByRole('button', { name: 'Recharger', exact: true }).click();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Droguerie du Port/);
    expect(await p.locator('#poste-bandeau:visible').count()).toBe(0);

    // ── Se déconnecter, au pied de la barre (le seul chemin était « Verrouiller maintenant », au fond des Réglages) :
    //    la fenêtre dit ce qui s'efface, et ce que le poste gardait s'efface ────────────────────────────────────
    await p.locator('.sidebar-foot').getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Te déconnecter ?');
    expect(await fenetre.innerText()).toContain('ce qu\'il gardait pour consulter tes dossiers sans réseau s\'efface');
    await fenetre.getByRole('button', { name: 'Me déconnecter', exact: true }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/v10'), { timeout: 20_000 });
    await expect.poll(() => lePoste(p, cabinet), { timeout: 15_000 }).toBe(null);
    expect(await p.evaluate(() => [localStorage.getItem('skanfact.jeton'), localStorage.getItem('skanfact.hors_ligne')])).toEqual([null, null]);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
