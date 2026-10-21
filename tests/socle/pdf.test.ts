// Le PDF fait par le serveur (docs/pdf.md), avec le VRAI Chromium (celui de Playwright, sur la machine des tests comme
// sur le serveur). Ce que le serveur garantit :
//   - la page d'une facture revient en PDF A4, sur une page, avec ses montants (pdftotext le relit) ;
//   - la page est enfermée : son script ne tourne pas, elle ne joint rien (un serveur espion ne reçoit aucune
//     demande), et elle ne lit aucun fichier de la machine ;
//   - au-delà de sa file, l'imprimeur dit qu'il est occupé ;
//   - il faut être connecté ; une page trop lourde se refuse sans rien imprimer ; un serveur sans Chromium le dit
//     (« indisponible »), et l'écran retombe sur la fenêtre d'impression.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { creerImprimeur, ImprimeurOccupe, imprimeurDuServeur, type Imprimeur } from '../../serveur/pdf/imprimeur.ts';
import { LIMITE_PAGE, routesPdf } from '../../serveur/pdf/routes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeDeLEcran } from '../../serveur/v10/teif.ts';

const pool = creerPool(inject('pgApp'));
type Core = { documentHtml: (doc: unknown, client: unknown, societe: unknown, opts: unknown) => string };
const C = codeDeLEcran<Core>('core.js');
// Une facture qui discrimine : 3 × 416,667 à 19 % (1 250,001 HT, 237,500 de TVA), timbre 1,000 : 1 488,501 à payer.
const facture = () => C.documentHtml(
  { type: 'facture', number: 'FAC-2026-014', date: '2026-10-21', applyStamp: true, lines: [{ label: 'Cartons et palettes', qty: 3, unitPrice: 416.667, vatRate: 19 }] },
  { name: 'Société des Transports du Sahel' }, { name: 'Trabelsi Logistique', currency: 'DT', stampFee: 1 }, {});
const texteDu = (pdf: Buffer) => {
  const f = path.join(os.tmpdir(), `pdf-test-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, pdf);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).replace(/[\u202f\u00a0]/g, ' '); } finally { fs.rmSync(f, { force: true }); }
};

type Reponse = { statut: number; corps: Record<string, unknown> };
const apps: FastifyInstance[] = [];
async function serveur(imprimeur: Imprimeur | undefined) {
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    ...(imprimeur ? { imprimeur } : {}) };
  const app = creerApp(ctx, [...routesSocle(ctx), ...routesPdf(ctx)]);
  await app.ready();
  apps.push(app);
  return async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() };
  };
}
async function connectee(appeler: Awaited<ReturnType<typeof serveur>>) {
  const email = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  return jeton;
}

describe('le PDF fait par le serveur', () => {
  const imprimeur = imprimeurDuServeur();
  let espion: http.Server;
  let demandes = 0;
  let adresseEspion = '';
  beforeAll(async () => {
    espion = http.createServer((_q, r) => { demandes++; r.end('x'); });
    await new Promise<void>((ok) => espion.listen(0, '127.0.0.1', ok));
    adresseEspion = `http://127.0.0.1:${(espion.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await imprimeur.arreter();
    await Promise.all(apps.map((a) => a.close()));
    await new Promise<void>((ok) => espion.close(() => ok()));
    await pool.end();
  });

  it('la page d\'une facture revient en PDF A4, sur une page, avec ses montants', async () => {
    const appeler = await serveur(imprimeur);
    const jeton = await connectee(appeler);
    const r = await appeler('POST', '/pdf', jeton, { nom: 'FAC-2026-014_Societe_des_Transports_du_Sahel', html: facture() });
    expect(r.statut).toBe(200);
    expect(r.corps.nom).toBe('FAC-2026-014_Societe_des_Transports_du_Sahel.pdf');
    const pdf = Buffer.from(String(r.corps.pdf), 'base64');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.corps.pages).toBe(1);
    const texte = texteDu(pdf);
    expect(texte).toContain('FAC-2026-014');
    expect(texte).toMatch(/Total HT\s+1 250,001/);
    expect(texte).toMatch(/1 488,501 DT/);
  }, 120_000);

  it('la page est enfermée : son script ne tourne pas, elle ne joint rien, elle ne lit aucun fichier', async () => {
    const secret = path.join(os.tmpdir(), `pdf-secret-${process.pid}.txt`);
    fs.writeFileSync(secret, 'SECRET-DE-LA-MACHINE');
    try {
      const piegee = facture().replace('</body>', `<p id="p">PAGE-SAGE</p>
        <script>document.getElementById('p').textContent = 'SCRIPT-ACTIF'; fetch('${adresseEspion}/fetch');</script>
        <img src="${adresseEspion}/image.png" alt=""><link rel="stylesheet" href="${adresseEspion}/style.css">
        <iframe src="file://${secret}"></iframe><iframe src="${adresseEspion}/cadre"></iframe></body>`);
      const { pdf } = await imprimeur.imprimer(piegee);
      const texte = texteDu(pdf);
      expect(texte).toContain('PAGE-SAGE');
      expect(texte).not.toContain('SCRIPT-ACTIF');
      expect(texte).not.toContain('SECRET-DE-LA-MACHINE');
      expect(demandes).toBe(0);
    } finally { fs.rmSync(secret, { force: true }); }
  }, 120_000);

  it('au-delà de sa file, l\'imprimeur dit qu\'il est occupé', async () => {
    let liberer = () => {};
    const bloque = new Promise<void>((ok) => { liberer = ok; });
    const file = creerImprimeur({ imprimer: async () => { await bloque; return { pdf: Buffer.from('%PDF-'), pages: 1 }; } }, { simultanees: 1, attente: 1 });
    const premier = file.imprimer('a');
    const second = file.imprimer('b');
    await expect(file.imprimer('c')).rejects.toBeInstanceOf(ImprimeurOccupe);
    liberer();
    expect((await premier).pages).toBe(1);
    expect((await second).pages).toBe(1);
  });

  it('il faut être connecté ; une page trop lourde se refuse ; un serveur sans Chromium le dit', async () => {
    const appeler = await serveur(imprimeur);
    expect((await appeler('POST', '/pdf', undefined, { nom: 'x', html: facture() })).statut).toBe(401);
    const jeton = await connectee(appeler);
    const lourde = await appeler('POST', '/pdf', jeton, { nom: 'Lourde', html: 'x'.repeat(LIMITE_PAGE + 1) });
    expect(lourde.statut).toBe(413);
    expect(String(lourde.corps.motif)).toContain('« Lourde » fait 8,0 Mo');
    // Sans imprimeur, et avec un Chromium introuvable : « indisponible », que l'écran lit pour ouvrir la fenêtre.
    const sansImprimeur = await (await serveur(undefined))('POST', '/pdf', jeton, { nom: 'x', html: facture() });
    expect([sansImprimeur.statut, sansImprimeur.corps.indisponible]).toEqual([503, true]);
    const absent = imprimeurDuServeur({ navigateur: '/chemin/sans/chromium' });
    try {
      const r = await (await serveur(absent))('POST', '/pdf', jeton, { nom: 'x', html: facture() });
      expect([r.statut, r.corps.indisponible]).toEqual([503, true]);
      expect(String(r.corps.motif)).toContain('Ce serveur ne fait pas encore les PDF');
    } finally { await absent.arreter(); }
  }, 120_000);
});
