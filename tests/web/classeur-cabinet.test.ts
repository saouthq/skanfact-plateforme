// Le classeur du dossier au Cabinet (maquette « Classeur », docs/maquettes/cabinet/classeur.html ; 1.171.0, refait en 1.172.0),
// à la souris. Ce que le parcours vérifie, le 28/10/2026 :
//   - la barre : « Tout le dossier › Le classeur » mène au classeur ;
//   - un client dont septembre a une écriture : l'arbre (septembre et sa rubrique Achats, l'exercice NON surligné en même
//     temps), la pièce qui s'ouvre d'elle-même à droite avec son écriture au brouillard, le pied « rubrique N sur 7 » (« Ce qui
//     manque » n'est pas une rubrique) ; la recherche (ce qui se trouve, et ce qui ne se trouve pas) ;
//   - un client dont rien n'est arrivé depuis juillet : « Août et septembre 2026 », août surligné dans l'arbre, ce qui manque,
//     un seul « Relancer » ;
//   - les déclarations de l'année ; au téléphone : les puces des mois, la carte du mois sur toute la largeur, rien qui déborde,
//     la pièce puis « ‹ Septembre 2026 · Achats » pour revenir.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');

describe('le classeur du dossier au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-classeur-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, email };
  };
  const gerants = new Map<string, string>();
  async function unCabinet() {
    const { jeton: associe, email: courrielAssocie } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string, fiche: Record<string, unknown>) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: fiche, revision: null })).statut).toBeLessThan(300);
      gerants.set(ent, j);
      return ent;
    };
    const ecrire = async (ent: string, e: Record<string, unknown>) => expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, e)).statut).toBe(201);
    // La boulangerie : sa mission commence en septembre ; un achat de farine au brouillard, à vérifier.
    const boulangerie = await client('Boulangerie El Amal', 'Sarra Ben Salah', { contact: 'Sarra', from: '2026-09' });
    await ecrire(boulangerie, { date: '2026-09-03', journal: 'AC', piece: 'FA-0914', libelle: 'Minoterie du Cap Bon, farine T55',
      lignes: [{ compte: '601', debit: '1551,428' }, { compte: '4366', debit: '294,772' }, { compte: '401', credit: '1846,200' }] });
    // La menuiserie : sa mission commence en août, sa dernière écriture est du 15/07 ; rien depuis.
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', { contact: 'Hédi', from: '2026-08' });
    await ecrire(menuiserie, { date: '2026-07-15', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] });
    return { associe, courrielAssocie, cab, boulangerie, menuiserie };
  }
  async function contexte(jeton: string, tel = false) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
    await cx.clock.setFixedTime(LE_28);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return { p, erreurs };
  }
  async function ouvrir(p: Page, cabinet: string, ent: string) {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/classeur`);
    await p.locator('#page-cl .cl-res').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }

  it('au bureau : l\'arbre, la rubrique, la pièce et son écriture ; la recherche ; des mois vides ; les déclarations', async () => {
    const { associe, cab, boulangerie, menuiserie } = await unCabinet();
    const { p, erreurs } = await contexte(associe);
    await ouvrir(p, cab.id, boulangerie);
    // La barre : « Tout le dossier » propose le classeur en premier.
    expect(await p.locator('#nav-dossier .panneau.volet a').first().getAttribute('href')).toBe(`#/dossier/${boulangerie}/classeur`);
    // L'arbre : septembre est ouvert sur sa rubrique Achats ; l'exercice n'est pas surligné en même temps que le mois.
    expect(await p.locator('.cl-a-m.ici').innerText()).toMatch(/^Septembre/);
    expect(await p.locator('.cl-a-t.ici').count()).toBe(0);
    expect(await p.locator('.cl-a-m.avant').innerText()).toMatch(/Janvier à août\s+avant la mission/);
    expect(await p.locator('.cl-a-s.ici').innerText()).toMatch(/Achats\s+1/);
    expect(await p.locator('.cl-res-t').first().innerText()).toMatch(/Septembre 2026\s+1 pièce/);
    // La rubrique : une seule écriture, dite au singulier ; le pied compte sept rubriques.
    expect(await p.locator('.cl-sec h3').first().innerText()).toMatch(/Achats\s*1\s*1 facture ou ticket : 1 en ordre/);
    expect(await p.locator('.cl-suite').innerText()).toMatch(/rubrique 2 sur 7/);
    const ligne = p.locator('li[data-cl-k]').filter({ hasText: 'FA-0914' });
    expect(await ligne.innerText()).toMatch(/1\s846,200[\s\S]*saisie, au brouillard/);
    // La pièce à droite s'ouvre d'elle-même (la maquette) : son écriture, au brouillard, ligne par ligne.
    const ap = p.locator('.cl-ap');
    await expect.poll(() => ap.innerText().catch(() => '')).toMatch(/L'écriture FA-0914, au brouillard[\s\S]*601[\s\S]*1\s551,428[\s\S]*4366[\s\S]*294,772/i);
    expect(await ligne.getAttribute('class')).toMatch(/\bici\b/);
    expect(await ap.innerText()).toMatch(/Elle compte dans la déclaration de septembre/);
    expect(await ap.getByRole('link', { name: 'Ouvrir dans les écritures' }).getAttribute('href')).toBe(`#/dossier/${boulangerie}/comptabilite/saisie`);
    // La recherche : ce qui se trouve (un fournisseur), et ce qui ne se trouve pas ; aucun lien de l'arbre ne reste surligné.
    await p.locator('#cl-q').fill('minoterie');
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/« minoterie » dans tout le dossier\s+1 pièce, sur 2026/);
    expect(await p.locator('.cl-arbre .ici').count()).toBe(0);
    await p.locator('#cl-q').fill('ooredoo');
    await expect.poll(() => p.locator('.cl-vide').innerText().catch(() => '')).toMatch(/Rien pour « ooredoo » dans tout le dossier/);
    await p.locator('#cl-q').fill('');
    await p.waitForTimeout(400);
    // Les déclarations de l'année.
    await p.locator('.cl-arbre [data-cl-decls]').click();
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/Les déclarations de 2026/);

    // Des mois vides : août et septembre ensemble, août surligné dans l'arbre, ce qui manque, une seule relance.
    await ouvrir(p, cab.id, menuiserie);
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/Août et septembre 2026\s+aucune pièce · la dernière écriture de Hédi date du 15\/07/);
    expect(await p.locator('.cl-a-m.ici').innerText()).toMatch(/^Août/);
    expect(await p.locator('.cl-a-s').count()).toBe(0);
    expect(await p.locator('li.cl-trou').allInnerTexts()).toEqual([expect.stringMatching(/^Août 2026 · ventes, achats, relevé bancaire\nen retard depuis le 28\/09 · jamais relancé/), expect.stringMatching(/^Septembre 2026 · ventes, achats, relevé bancaire\nà déposer aujourd'hui/)]);
    expect(await p.locator('#page-cl .btn-primary').allInnerTexts()).toEqual(['Relancer Hédi…']);
    expect(await p.locator('#page-cl button', { hasText: 'Relancer Hédi' }).count()).toBe(1);
    expect(await p.locator('#page-cl .cl-sous').innerText()).toMatch(/rien depuis le 15\/07/);
    expect(erreurs).toEqual([]);
  });

  it('une pièce en double se marque de sa jumelle, côte à côte ; une pièce se range dans un autre mois', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    const sarra = gerants.get(boulangerie) ?? '';
    // Sarra envoie deux fois la même photo (même nom, mêmes octets), puis un ticket.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const envoyer = async (nom: string) => {
      const f = await api('POST', `/entreprises/${boulangerie}/messages/fichiers`, sarra, { cote: 'entreprise', nom, contenu: PNG });
      expect((await api('POST', `/entreprises/${boulangerie}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id })).statut).toBe(201);
    };
    await envoyer('facture-steg.png');
    await envoyer('facture-steg.png');
    await envoyer('ticket-24-10.png');
    const { p, erreurs } = await contexte(associe);
    await ouvrir(p, cab.id, boulangerie);
    // Arrivées en octobre, septembre pas encore déposé : elles servent septembre (la maquette), ouvert d'emblée.
    expect(await p.locator('.cl-a-m.ici').innerText()).toMatch(/^Septembre/);
    // La seconde photo se dit « en double ? », et son geste la marque en double de la première.
    const dbl = p.locator('li[data-cl-k]').filter({ hasText: 'en double ?' });
    await expect.poll(() => dbl.count()).toBe(1);
    expect(await dbl.innerText()).toMatch(/la même que facture-steg\.png \?/);
    await dbl.click();
    await expect.poll(() => p.locator('.cl-ap .cl-dbl figure').count()).toBe(2);
    expect(await p.locator('.cl-ap .btn-primary').allInnerTexts()).toEqual(['Marquer en double']);
    await p.locator('.cl-ap .btn-primary').click();
    await expect.poll(() => p.locator('li[data-cl-k]').filter({ hasText: 'en double' }).innerText()).toMatch(/la même que facture-steg\.png · classée en double/);
    // Le ticket se range dans un autre mois (rangé au mauvais endroit) : il garde sa date d'arrivée, et rien ne s'écrit dans les livres.
    await p.locator('li[data-cl-k]').filter({ hasText: 'ticket-24-10' }).click();
    await p.locator('[data-cl-trois]').click();
    await p.locator('[data-cl-menu="mois"]').click();
    // Le mois de son arrivée : elle y reste, même si septembre attend encore ses pièces.
    await p.locator('#mo-m').selectOption('2026-10');
    expect(await p.locator('.modal #ok').innerText()).toBe('Déplacer en octobre');
    await p.locator('.modal #ok').click();
    await expect.poll(() => p.locator('.cl-a-m.ici').innerText()).toMatch(/^Octobre/);
    expect(await p.locator('li[data-cl-k]').filter({ hasText: 'ticket-24-10' }).innerText()).toMatch(/reçue le \d\d\/10/);
    expect(await p.locator('li[data-cl-k]').filter({ hasText: 'facture-steg' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
  });

  it('une pièce lue dont le total est celui d\'un achat sans justificatif : sa ligne le dit, et la lecture lui donne fournisseur, date et montant', async () => {
    const { associe, courrielAssocie, cab, boulangerie } = await unCabinet();
    const sarra = gerants.get(boulangerie) ?? '';
    // Sarra saisit un achat STEG sans justificatif (100,350 HT à 13 % : 113,396 TTC), puis envoie la photo de la facture.
    expect((await api('POST', `/entreprises/${boulangerie}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's-steg', rang: 0, revision: null, contenu: { id: 's-steg', name: 'STEG' } },
      { collection: 'purchases', cle: 'p-steg', rang: 1, revision: null, contenu: { id: 'p-steg', kind: 'facture', number: 'FA-0919', date: '2026-09-30', supplierId: 's-steg',
        currency: 'DT', category: 'Énergie', fees: 0, withholdingRate: 0, createdAt: 1, attachments: [],
        lines: [{ id: 'p-steg-l', label: 'Électricité, août et septembre', qty: 1, unitPrice: { '~n': '100.350' }, vatRate: 13, destination: 'charge' }] } },
    ] })).statut).toBe(200);
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    // Un ticket arrivé avant elle : la facture lue passe devant lui tant qu'elle est à traiter.
    const t = await api('POST', `/entreprises/${boulangerie}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'ticket-24-10.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${boulangerie}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: t.corps.id })).statut).toBe(201);
    const f = await api('POST', `/entreprises/${boulangerie}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'IMG_8850.jpg', contenu: PNG });
    const m = await api('POST', `/entreprises/${boulangerie}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id });
    expect(m.statut).toBe(201);
    // La lecture, telle que le service d'IA l'aurait rendue (le test ne paie pas l'appel).
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try {
      await admin.query(`insert into cabinet.lecture (cabinet, entreprise, message, fournisseur, numero, date_piece, total, devise, lu_par)
        values ($1, $2, $3, 'STEG', '0298 4471', null, '113.396', 'TND', (select id from socle.utilisateur where lower(email) = lower($4)))`,
      [cab.id, boulangerie, m.corps.id, courrielAssocie]);
    } finally { await admin.end(); }
    const { p, erreurs } = await contexte(associe);
    await ouvrir(p, cab.id, boulangerie);
    const ligne = p.locator('li[data-cl-k]').filter({ hasText: 'IMG_8850' });
    await expect.poll(() => ligne.innerText().catch(() => '')).toMatch(/un achat du même montant existe déjà : FA-0919, sans justificatif/);
    expect(await ligne.innerText()).toMatch(/STEG[\s\S]*113,396/);
    await ligne.click();
    await expect.poll(() => p.locator('.cl-ap').innerText().catch(() => '')).toMatch(/Un achat du même montant existe déjà[\s\S]*FA-0919/);
    expect(await p.locator('.cl-ap .cl-ap-b b .cl-ia-ic').count()).toBe(1);
    // Son historique dit l'achat saisi sans pièce, la lecture et ce qu'elle a repéré.
    await p.locator('[data-cl-trois]').click();
    await p.locator('[data-cl-menu="historique"]').click();
    await expect.poll(() => p.locator('.cl-hist').innerText().catch(() => '')).toMatch(/saisit l'achat FA-0919[\s\S]*sans justificatif[\s\S]*SkanFact lit la pièce[\s\S]*STEG · n° 0298 4471 · 113,396 DT[\s\S]*SkanFact repère FA-0919/);
    await p.locator('[data-cl-trois]').click();
    await p.locator('[data-cl-menu="historique"]').click();
    // Jointe, la ligne garde sa place (elle ne file pas sous le curseur), et le bandeau dit « Plus que ».
    const cles = async () => p.locator('#page-cl .cl-sec li[data-cl-k]').evaluateAll((l) => l.map((x) => x.getAttribute('data-cl-k')));
    const avant = await cles();
    const k = await ligne.getAttribute('data-cl-k');
    await p.locator('.cl-ap .btn-primary', { hasText: 'Joindre à FA-0919' }).click();
    await expect.poll(() => p.locator(`li[data-cl-k="${k}"]`).innerText().catch(() => '')).toMatch(/jointe à FA-0919/);
    expect(avant.indexOf(k)).toBeLessThan(avant.findIndex((x) => x !== k && x?.startsWith('p:')));
    expect((await cles()).indexOf(k)).toBe(avant.indexOf(k));
    // Le même fichier, déposé par le cabinet : « déjà là », et il se marque en double de lui.
    await p.locator('#cl-deposer').click();
    await p.locator('#dp-f').setInputFiles({ name: 'IMG_8850.jpg', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await expect.poll(() => p.locator('#dp-l').innerText()).toMatch(/déjà là \(FA-0919\) : elle sera marquée en double/);
    await p.locator('.modal #ok').click();
    const deposee = p.locator('li[data-cl-k^="d:"]').filter({ hasText: 'IMG_8850' });
    await expect.poll(() => deposee.innerText().catch(() => '')).toMatch(/la même que IMG_8850\.jpg[\s\S]*en double/);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('au téléphone : les puces des mois, la carte du mois sur toute la largeur, la pièce et le retour', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    const { p, erreurs } = await contexte(associe, true);
    await ouvrir(p, cab.id, boulangerie);
    await p.waitForTimeout(800);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);
    expect(await p.locator('.cl-arbre').isVisible()).toBe(false);
    expect(await p.locator('.cl-tel-m [data-cl-m][aria-pressed="true"]').innerText()).toBe('sept.');
    // La carte du mois prend toute la largeur (une règle du bureau la laissait à 232 px, 1.171.0).
    expect(await p.evaluate(() => Math.round(document.querySelector('.cl-g > :first-child')?.getBoundingClientRect().width ?? 0))).toBeGreaterThan(330);
    // Au téléphone, rien ne s'ouvre de soi-même : la liste d'abord.
    expect(await p.locator('.cl-ap').count()).toBe(0);
    await p.locator('li[data-cl-k]').filter({ hasText: 'FA-0914' }).click();
    await expect.poll(() => p.locator('.cl-ap').innerText().catch(() => '')).toMatch(/L'écriture FA-0914, au brouillard/i);
    expect(await p.locator('#cl-retour').innerText()).toMatch(/Septembre 2026 · Achats/);
    await p.locator('#cl-retour').click();
    await expect.poll(() => p.locator('li[data-cl-k]').count()).toBe(1);
    expect(erreurs).toEqual([]);
  });
});
