// La coque de bureau (brique 137 ; docs/bureau.md, B) : la même application web, dans une fenêtre Electron, avec
// l'agent local pour ce qu'un navigateur ne sait pas faire. L'agent vit ICI, dans la coque : il n'écoute aucun port.
// Seule la page de SkanFact (son origine exacte) lui parle, par des gestes déclarés : imprimer un ticket, ouvrir le
// tiroir, régler l'imprimante ; le processus principal refuse tout geste venu d'ailleurs. La fenêtre reste chez
// SkanFact : un lien vers ailleurs s'ouvre dans le navigateur du poste.
//
//   SKANFACT_ADRESSE         l'adresse de SkanFact (les essais, un poste de développement) ;
//   SKANFACT_BUREAU_DONNEES  où la coque range ses réglages (les essais) ; sinon le dossier de l'application.

import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { concat, enGris, INIT, POINTS, ticket, TIROIR, type Image, type Rouleau } from '../agent/escpos.ts';
import { envoyer, ImpressionImpossible, reglage, type Reglage } from '../agent/imprimante.ts';

const ici = path.dirname(fileURLToPath(import.meta.url));
// L'adresse du service : À VÉRIFIER (le nom de domaine du service n'est pas encore pris ; `09` § 4).
const ADRESSE = new URL(process.env.SKANFACT_ADRESSE ?? 'https://app.skanfact.tn');
const ORIGINE = ADRESSE.origin;
if (process.env.SKANFACT_BUREAU_DONNEES) app.setPath('userData', process.env.SKANFACT_BUREAU_DONNEES);

// ── Les réglages de ce poste (l'imprimante de tickets), dans le dossier de l'application.
const fichier = () => path.join(app.getPath('userData'), 'bureau.json');
const reglages = z.object({ imprimante: reglage.nullable().default(null) });
function lire(): z.infer<typeof reglages> {
  try { return reglages.parse(JSON.parse(fs.readFileSync(fichier(), 'utf8'))); } catch { return { imprimante: null }; }
}
function ecrire(r: z.infer<typeof reglages>) {
  fs.mkdirSync(path.dirname(fichier()), { recursive: true });
  fs.writeFileSync(fichier(), JSON.stringify(r, null, 2));
}

// ── Photographier le ticket tel que la v10 le dessine (docs/bureau.md, A1) : une fenêtre cachée, à la largeur du
// rouleau en points, qui ne charge rien d'autre que ce dessin.
async function photographier(html: string, rouleau: Rouleau): Promise<Image> {
  const points = POINTS[rouleau];
  // Le ticket se dessine à la largeur du rouleau (en millimètres) : on l'agrandit pour qu'elle fasse `points` points.
  const zoom = points / ((rouleau * 96) / 25.4);
  const w = new BrowserWindow({ show: false, width: points, height: 400, useContentSize: true,
    webPreferences: { sandbox: true, partition: 'ticket', zoomFactor: zoom, backgroundThrottling: false } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const hauteur = Math.ceil(Number(await w.webContents.executeJavaScript('document.documentElement.scrollHeight')) * zoom);
    w.setContentSize(points, hauteur);
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: points, height: hauteur });
    const { width, height } = img.getSize();
    return enGris(new Uint8Array(img.toBitmap()), width, height, rouleau);
  } finally {
    w.destroy();
  }
}

type Resultat = { ok: true } | { ok: false; raison: string };
const echec = (e: unknown): Resultat => ({ ok: false, raison: e instanceof ImpressionImpossible ? e.raison : 'inconnue' });

// ── Les gestes de l'agent : seulement pour la page de SkanFact.
function geste<A extends unknown[], R>(canal: string, f: (...a: A) => Promise<R> | R) {
  ipcMain.handle(canal, async (e: IpcMainInvokeEvent, ...a: unknown[]) => {
    if (e.senderFrame?.origin !== ORIGINE) throw new Error(`refusé : ${e.senderFrame?.origin ?? '?'} n'est pas SkanFact`);
    return f(...(a as A));
  });
}

const impression = z.object({ html: z.string().min(1).max(2_000_000), largeur: z.union([z.literal(58), z.literal(80)]).catch(80),
  tiroir: z.boolean().default(false) });

geste('bureau:imprimer', async (demande: unknown): Promise<Resultat> => {
  const d = impression.safeParse(demande);
  if (!d.success) return { ok: false, raison: 'demande_fausse' };
  const imprimante = lire().imprimante;
  if (!imprimante) return { ok: false, raison: 'sans_imprimante' };
  try {
    await envoyer(imprimante, ticket(await photographier(d.data.html, d.data.largeur), { tiroir: d.data.tiroir }));
    return { ok: true };
  } catch (e) { return echec(e); }
});

geste('bureau:tiroir', async (): Promise<Resultat> => {
  const imprimante = lire().imprimante;
  if (!imprimante) return { ok: false, raison: 'sans_imprimante' };
  try { await envoyer(imprimante, concat([INIT, TIROIR])); return { ok: true }; } catch (e) { return echec(e); }
});

geste('bureau:imprimante', (): Reglage | null => lire().imprimante);

geste('bureau:regler-imprimante', (r: unknown): Resultat => {
  const p = reglage.nullable().safeParse(r);
  if (!p.success) return { ok: false, raison: 'reglage_faux' };
  ecrire({ ...lire(), imprimante: p.data });
  return { ok: true };
});

// ── La fenêtre de SkanFact.
app.whenReady().then(() => {
  // Rien n'est demandé au poste (caméra, micro, position…) sans qu'une brique le décide.
  session.defaultSession.setPermissionRequestHandler((_w, _p, rappel) => rappel(false));
  // La fenêtre du ticket ne charge que le ticket.
  session.fromPartition('ticket').webRequest.onBeforeRequest((d, rappel) => rappel({ cancel: !d.url.startsWith('data:') }));
  const fenetre = new BrowserWindow({
    width: 1440, height: 900, show: true, title: 'SkanFact',
    webPreferences: { preload: path.join(ici, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Un lien vers ailleurs s'ouvre dans le navigateur du poste ; la coque reste chez SkanFact.
  // (La fenêtre vierge que la v10 ouvre pour imprimer sans imprimante réglée reste permise.)
  const dehors = (url: string) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); };
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || new URL(url, ADRESSE).origin === ORIGINE) return { action: 'allow' };
    dehors(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== ORIGINE) { e.preventDefault(); dehors(url); } });
  void fenetre.loadURL(ADRESSE.href);
});
app.on('window-all-closed', () => app.quit());
