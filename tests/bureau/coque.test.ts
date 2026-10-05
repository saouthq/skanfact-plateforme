// La coque de bureau, lancée pour de vrai (brique 137 ; docs/bureau.md, B) : Electron sur un écran virtuel, une page
// « SkanFact » et une page étrangère servies ici, une fausse imprimante réseau. Ce que le test garantit :
//   - la page de SkanFact imprime un ticket : la photo de SON dessin, entière (un ticket plus haut que l'écran), à la
//     largeur du rouleau, puis la coupe et le tiroir quand on le demande ; sans imprimante réglée, la page le sait ;
//   - une page d'une autre origine n'obtient rien de l'agent, et l'imprimante ne reçoit rien ;
//   - la fenêtre reste chez SkanFact : un lien vers ailleurs n'y est pas suivi, une fenêtre vers ailleurs ne s'ouvre pas ;
//     aucune permission n'est accordée ; la fenêtre du ticket ne charge rien d'autre que le ticket.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { fermerCoque } from './fermer.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUPE, INIT, TIROIR } from '../../bureau/agent/escpos.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const electron = (await import('electron')).default as unknown as string;

// Un écran virtuel quand le poste n'en a pas (la CI) : sans écran, Electron ne dessine rien.
async function ecran(): Promise<{ display: string; fermer: () => void }> {
  if (process.env.DISPLAY) return { display: process.env.DISPLAY, fermer: () => {} };
  const n = 90 + Math.floor(Math.random() * 9);
  const x: ChildProcess = spawn('Xvfb', [`:${n}`, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  await new Promise((ok) => setTimeout(ok, 800));
  return { display: `:${n}`, fermer: () => x.kill() };
}
const serveur = async (pages: Record<string, string>) => {
  const demandes: string[] = [];
  const s = http.createServer((q, r) => { demandes.push(q.url ?? '/'); r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(pages[q.url ?? '/'] ?? '<p>rien</p>'); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { adresse: `http://127.0.0.1:${(s.address() as net.AddressInfo).port}`, demandes, fermer: () => s.close() };
};
const imprimante = async () => {
  const recus: Buffer[][] = [];
  // Un envoi compte quand l'agent a fini de l'envoyer (connexion fermée).
  const s = net.createServer((c) => { const r: Buffer[] = []; c.on('data', (d) => r.push(d)); c.on('end', () => recus.push(r)); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { port: (s.address() as net.AddressInfo).port, envoi: (i: number) => Buffer.concat(recus[i] ?? []), combien: () => recus.length, fermer: () => s.close() };
};

describe('la coque de bureau', () => {
  let app: ElectronApplication;
  let page: Page;
  let e: Awaited<ReturnType<typeof ecran>>;
  let skanfact: Awaited<ReturnType<typeof serveur>>;
  let ailleurs: Awaited<ReturnType<typeof serveur>>;
  let papier: Awaited<ReturnType<typeof imprimante>>;
  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'coque-'));

  beforeAll(async () => {
    e = await ecran();
    ailleurs = await serveur({ '/': '<title>Ailleurs</title><p>une page étrangère</p>' });
    skanfact = await serveur({ '/': `<title>SkanFact</title><p>la caisse</p><a id="dehors" href="${ailleurs.adresse}/">un lien</a>` });
    papier = await imprimante();
    app = await _electron.launch({ executablePath: electron, args: ['--no-sandbox', '--disable-gpu', path.join(RACINE, 'bureau/coque/principal.ts')],
      // (Le « navigateur du poste » d'un lien vers ailleurs : une commande qui ne fait rien, pas un vrai navigateur.)
      env: { ...process.env, DISPLAY: e.display, SKANFACT_ADRESSE: skanfact.adresse, SKANFACT_BUREAU_DONNEES: donnees, BROWSER: 'true' } });
    page = await app.firstWindow();
    await page.waitForLoadState();
  }, 120_000);
  afterAll(async () => { await fermerCoque(app); skanfact?.fermer(); ailleurs?.fermer(); papier?.fermer(); e?.fermer(); }, 60_000);

  // Un ticket de 80 mm plus haut que l'écran : du texte, et une barre noire tout en bas.
  const ticketHtml = (largeur: number) => `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: ${largeur}mm auto; margin: 0 }
    html, body { margin: 0; background: #fff } body { width: ${largeur}mm; font: 11px Arial }</style></head><body>
    <div>Café crème × 2 — 7,000 DT</div><img src="${skanfact.adresse}/espion.png">${'<div>ligne</div>'.repeat(300)}<div style="height:6mm;background:#000"></div></body></html>`;
  type Bureau = Record<string, (...x: unknown[]) => Promise<unknown>>;
  const appel = <T>(f: string, ...a: unknown[]) => page.evaluate(([f, a]) => {
    const geste = (window as unknown as { skanfactBureau: Bureau }).skanfactBureau[f as string];
    if (!geste) throw new Error(`pas de geste ${String(f)}`);
    return geste(...(a as unknown[]));
  }, [f, a] as const) as Promise<T>;

  it('la page de SkanFact imprime un ticket entier, à la largeur du rouleau, puis la coupe et le tiroir quand on le demande', async () => {
    expect(await page.title()).toBe('SkanFact');
    // Sans imprimante réglée, la page le sait (elle proposera de la régler).
    expect(await appel('imprimerTicket', ticketHtml(80), 80, {})).toEqual({ ok: false, raison: 'sans_imprimante' });
    expect(await appel('reglerImprimante', { branchement: 'reseau', hote: '' })).toEqual({ ok: false, raison: 'reglage_faux' });
    expect(await appel('reglerImprimante', { branchement: 'reseau', hote: '127.0.0.1', port: papier.port })).toEqual({ ok: true });
    expect(await appel('imprimante')).toEqual({ branchement: 'reseau', hote: '127.0.0.1', port: papier.port });

    expect(await appel('imprimerTicket', ticketHtml(80), 80, { tiroir: true })).toEqual({ ok: true });
    await expect.poll(() => papier.combien()).toBe(1);
    const b = papier.envoi(0);
    expect(b.subarray(0, 2).equals(Buffer.from(INIT))).toBe(true);
    // Le raster à 72 octets par ligne (576 points) ; la fin : la coupe, puis le tiroir.
    expect(b.subarray(2, 6).toString('hex')).toBe('1d763000');
    expect(b.readUInt16LE(6)).toBe(72);
    expect(b.subarray(b.length - COUPE.length - TIROIR.length).equals(Buffer.concat([COUPE, TIROIR]))).toBe(true);
    // Le ticket entier : sa hauteur (en lignes, toutes bandes) dépasse l'écran de 900, et la dernière ligne
    // dessinée (la barre noire du bas) est imprimée.
    let o = 2;
    let lignes = 0;
    let derniereNoire = -1;
    while (b[o] === 0x1d && b[o + 1] === 0x76) {
      const parLigne = b.readUInt16LE(o + 4);
      const n = b.readUInt16LE(o + 6);
      for (let y = 0; y < n; y++) {
        const ligne = b.subarray(o + 8 + y * parLigne, o + 8 + (y + 1) * parLigne);
        // Une ligne de la barre : noire sur presque toute la largeur (le bord peut tomber entre deux points).
        if (ligne.filter((x) => x === 0xff).length >= parLigne - 2) derniereNoire = lignes + y;
      }
      lignes += n;
      o += 8 + parLigne * n;
    }
    expect(lignes).toBeGreaterThan(900);
    expect(derniereNoire).toBeGreaterThan(lignes - 60);
    // La fenêtre du ticket ne charge rien d'autre que le ticket (une image du ticket ne part chercher personne).
    expect(skanfact.demandes.filter((d) => d.startsWith('/espion'))).toEqual([]);
    // Sans tiroir demandé : la coupe, et rien après.
    expect(await appel('imprimerTicket', ticketHtml(58), 58, {})).toEqual({ ok: true });
    await expect.poll(() => papier.combien()).toBe(2);
    const c = papier.envoi(1);
    expect(c.readUInt16LE(6)).toBe(48);
    expect(c.subarray(c.length - COUPE.length).equals(Buffer.from(COUPE))).toBe(true);
    // « Ouvrir le tiroir » : l'impulsion seule.
    expect(await appel('ouvrirTiroir')).toEqual({ ok: true });
    await expect.poll(() => papier.combien()).toBe(3);
    expect(papier.envoi(2).toString('hex')).toBe(Buffer.concat([INIT, TIROIR]).toString('hex'));
    // L'imprimante éteinte : la page le sait.
    expect(await appel('reglerImprimante', { branchement: 'reseau', hote: '127.0.0.1', port: 1 })).toEqual({ ok: true });
    expect(await appel('ouvrirTiroir')).toEqual({ ok: false, raison: 'injoignable' });
    expect(await appel('reglerImprimante', { branchement: 'reseau', hote: '127.0.0.1', port: papier.port })).toEqual({ ok: true });
  }, 120_000);

  it('la fenêtre reste chez SkanFact ; une page d\'ailleurs n\'obtient rien de l\'agent', async () => {
    // Un lien vers ailleurs n'est pas suivi dans la coque ; une fenêtre vers ailleurs ne s'ouvre pas.
    await page.evaluate(() => document.getElementById('dehors')?.click());
    await page.waitForTimeout(800);
    expect(new URL(page.url()).origin).toBe(skanfact.adresse);
    expect(await page.evaluate((u) => window.open(u) === null, `${ailleurs.adresse}/`)).toBe(true);
    // Rien n'est accordé au poste sans qu'une brique le décide (ici, les notifications).
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
    // Une page d'une autre origine dans la fenêtre (chargée par la coque elle-même) : chaque geste est refusé, et
    // l'imprimante ne reçoit rien.
    const avant = papier.combien();
    await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w.isVisible())?.loadURL(u), `${ailleurs.adresse}/`);
    await expect.poll(() => page.title()).toBe('Ailleurs');
    for (const [f, a] of [['imprimerTicket', [ticketHtml(80), 80, { tiroir: true }]], ['ouvrirTiroir', []], ['imprimante', []],
      ['reglerImprimante', [{ branchement: 'reseau', hote: 'pirate.exemple.tn' }]]] as const) {
      await expect(appel(f, ...a)).rejects.toThrow(/refusé/);
    }
    await page.waitForTimeout(500);
    expect(papier.combien()).toBe(avant);
    expect(JSON.parse(fs.readFileSync(path.join(donnees, 'bureau.json'), 'utf8')).imprimante.hote).toBe('127.0.0.1');
  }, 120_000);
});
