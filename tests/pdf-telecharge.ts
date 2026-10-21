// Le PDF qu'un geste de l'écran télécharge (1.88.0 : le serveur fait le PDF ; docs/pdf.md), relu par pdftotext : son
// nom, son nombre de pages, et son texte, les espaces fines et insécables ramenées à des espaces, les blancs à un seul.
// Les parcours lisaient la fenêtre d'impression ; ils lisent maintenant le fichier que la personne reçoit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';

export async function pdfTelecharge(p: Page, geste: () => Promise<unknown>): Promise<{ nom: string; texte: string; pages: number }> {
  const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 30_000 }), geste()]);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-telecharge-')), 'piece.pdf');
  await telechargement.saveAs(f);
  try {
    const octets = fs.readFileSync(f);
    if (octets.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`« ${telechargement.suggestedFilename()} » n'est pas un PDF`);
    const texte = execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }).replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const pages = (octets.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    return { nom: telechargement.suggestedFilename(), texte, pages };
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
}
