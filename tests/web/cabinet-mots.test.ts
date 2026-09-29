// Le Cabinet sans paquets, dans les mots (brique 38 bis ; docs/cabinet.md, C4). Sur la plateforme, il
// n'y a plus de paquets : les livres de chaque client sont tenus en direct par le serveur. Ce parcours
// ouvre chaque écran du Cabinet, comme une personne, et lit TOUT ce qui s'y voit — le texte de la
// page, et l'explication de chaque bulle « i » qu'elle porte : aucune phrase ne parle encore de
// paquet. Ce qui se lit est écrit dans dist/photos/cabinet-mots.txt, écran par écran.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Les mots des paquets, et ce qu'ils disaient sans les nommer : un mois « reçu », « envoyé » par le
// client, « Reçu le », « clôturé » par lui ; un mois « provisoire » est devenu « à valider » (C14).
const INTERDIT = /paquet|skanpack|appairage|clé de secours|mois reçus?\b|reçu le|n'a envoyé|a envoyé ses|t'envoie ses|t'envoient|envoie (?:encore )?ses|ne t'a rien envoyé|pas envoyé|rien envoyé|mois clôturés?|provisoire/i;

describe('le Cabinet sans paquets, dans les mots', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-mots-'));
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

  it('chaque écran du Cabinet, et chaque bulle qu\'il porte, se lit sans un mot de paquet', async () => {
    // Un client sur SkanFact (un achat au brouillard en août, une OD validée), un dossier tenu ; et un
    // second cabinet, vide, pour les écrans d'un premier jour.
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe);
    const tenu = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const od = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, {
      date: '2026-07-31', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires à payer', lignes: [{ compte: '6226', debit: '300' }, { compte: '4286', credit: '300' }],
    })).corps.id);
    await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [od] });
    const vide = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Neuf' })).corps.id);

    const erreurs: string[] = [];
    const p: Page = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);

    const vus: Record<string, string[]> = {};
    const tout: string[] = [];
    // Ce qui se voit : le texte de la page (innerText ne lit pas ce qui est caché), ce qu'écrivent les
    // champs vides et les infobulles des éléments visibles, et l'explication des bulles « i » présentes.
    const lire = async (nom: string) => {
      await p.waitForTimeout(700);
      const texte = [await p.locator('body').innerText(), ...await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('[placeholder], [title]')]
        .filter((e) => e.offsetParent !== null).map((e) => `${e.getAttribute('placeholder') ?? ''} ${e.getAttribute('title') ?? ''}`.trim()).filter(Boolean))].join('\n');
      const bulles = await p.evaluate(() => {
        const G = (window as unknown as { CabGuide?: { INFO?: Record<string, { t?: string; d?: string }> } }).CabGuide;
        return [...new Set([...document.querySelectorAll<HTMLElement>('[data-info]')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.info ?? ''))]
          .map((k) => ({ cle: k, texte: `${(G?.INFO?.[k]?.t ?? '')} — ${(G?.INFO?.[k]?.d ?? '').replace(/<[^>]+>/g, '')}` }));
      });
      // Le nom d'une bulle (« e.provisoire ») ne se lit pas à l'écran : seul son texte se juge.
      vus[nom] = [...texte.split('\n').map((l) => l.trim()).filter((l) => INTERDIT.test(l)),
        ...bulles.filter((b) => INTERDIT.test(b.texte)).map((b) => `(bulle ${b.cle}) ${b.texte}`)];
      tout.push(`== ${nom}\n${texte}`);
    };
    const ouvrir = async (c: string, hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${c}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      // L'offre de visite peut partir avec un redessin entre le moment où on la voit et le clic : un
      // bouton parti n'est plus à fermer.
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      // L'écran se redessine une fois ce qui arrive après le premier dessin connu (le Cabinet réclamait
      // la clé de secours à ce moment-là seulement) : on lit le second dessin, comme une personne qui
      // revient sur l'écran.
      await p.waitForTimeout(500);
      await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    };

    // « À faire » ne montre d'abord que ses deux lignes les plus urgentes : tout se lit déplié.
    await p.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('cab.todoAll', 'true'); });
    // Le cabinet neuf : son premier jour.
    for (const h of ['#/dossiers', '#/relances', '#/echeances', '#/ecritures', '#/production']) { await ouvrir(vide, h); await lire(`cabinet neuf ${h}`); }
    // Le cabinet au travail : chaque page, chaque onglet des réglages.
    for (const h of ['#/dossiers', '#/relances', '#/echeances', '#/ecritures', '#/production', '#/aide', '#/guide']) { await ouvrir(cabinet, h); await lire(h); }
    await ouvrir(cabinet, '#/reglages');
    for (const onglet of await p.locator('#set-tabs [role="tab"]').allInnerTexts()) {
      await p.locator('#set-tabs [role="tab"]', { hasText: onglet }).first().click();
      await lire(`#/reglages ${onglet}`);
    }
    // La fiche de chaque dossier, et chaque écran de sa comptabilité.
    for (const [nom, id] of [['client sur SkanFact', ent], ['dossier tenu', tenu]] as const) {
      await ouvrir(cabinet, `#/dossier/${id}/suivi`);
      await lire(`${nom} : suivi`);
      for (const onglet of ['saisie', 'banque', 'paie', 'immobilisations', 'inventaire', 'journal', 'grand-livre', 'balance', 'lettrage', 'recherche', 'declaration', 'revision', 'exercice', 'liasse']) {
        await ouvrir(cabinet, `#/dossier/${id}/comptabilite/${onglet}/2026`);
        await lire(`${nom} : ${onglet}`);
      }
    }

    const rapport = Object.entries(vus).filter(([, l]) => l.length).map(([ecran, l]) => `== ${ecran}\n${[...new Set(l)].join('\n')}`).join('\n\n');
    fs.writeFileSync(path.join(PHOTOS, 'cabinet-mots.txt'), rapport || '(aucun mot de paquet)\n');
    fs.writeFileSync(path.join(PHOTOS, 'cabinet-textes.txt'), tout.join('\n\n'));
    expect(rapport).toBe('');
    expect(erreurs).toEqual([]);
  }, 300_000);
});
