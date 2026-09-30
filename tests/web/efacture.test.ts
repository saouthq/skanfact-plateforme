// La facture électronique, à la souris (brique 80 ; docs/facture-electronique.md ; 05 § 3.1). Nadia dit, dans
// ses Paramètres, que son entreprise est soumise à la facture électronique. Elle émet une facture à la
// Menuiserie, dont le matricule s'arrête à la lettre-clé : SkanFact le dit AVANT le numéro, avec le bouton
// qui ouvre la fiche du client ; complétée, la facture s'émet, et son fichier El Fatoora (celui que le
// serveur a écrit à l'émission) se télécharge. Ce que le parcours vérifie, écran ET serveur :
//   - le réglage s'enregistre dans la fiche de l'entreprise ;
//   - le refus arrive avant la confirmation, et rien n'est émis ; le bouton mène au champ à corriger ;
//   - le fichier téléchargé est EXACTEMENT celui du serveur, écrit à l'émission (la fiche du client changée
//     ensuite n'y entre pas), et la fenêtre dit où il est (jamais « Montrer le fichier », qu'un navigateur
//     ne sait pas faire).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la facture électronique, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-efacture-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  it('soumise, Nadia voit avant le numéro ce qui empêcherait le fichier ; complétée, la facture s\'émet et son fichier se télécharge', async () => {
    const email = `nadia-efacture-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; rang: number | null; contenu: Record<string, unknown> };
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const tout = await objets();
    const societe = tout.find((o) => o.collection === '_racine' && o.cle === 'company');
    const menuiserie = tout.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    // Le matricule complet de l'entreprise ; celui de la Menuiserie s'arrête à la lettre-clé (« 1234567A »).
    // Une facture en brouillon.
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, matricule: '7654321B/A/M/000' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: {
        id: 'f1', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
        lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
        discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
      } },
    ] });

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));

    // Paramètres → Documents : « Mon entreprise est soumise à la facture électronique ».
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Paramètres');
    await nadia.waitForTimeout(600);
    await plusTard(nadia);
    await nadia.getByRole('tab', { name: 'Documents', exact: true }).click();
    const panneau = nadia.locator('#p-efacture');
    await panneau.getByLabel('Mon entreprise est soumise à la facture électronique').check();
    await nadia.screenshot({ path: path.join(PHOTOS, 'efacture-1-reglage.png') });
    await nadia.locator('#save-bar').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu.efacture, { timeout: 15_000 }).toBe(true);

    // La facture : « Émettre » dit ce qui manque AVANT la confirmation ; rien n'est émis.
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture/);
    await plusTard(nadia);
    await nadia.locator('#issue').click();
    const fenetre = nadia.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Avant d\'émettre : la facture électronique');
    expect(net(await fenetre.locator('.teif-manques').innerText())).toMatch(/^L'identifiant de Menuiserie du Lac \(exemple\) ne va pas : le matricule « 1234567A » s'arrête à la lettre-clé : .* Ouvrir la fiche du client$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'efacture-2-avant.png') });
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1', [ent])).rows[0].n).toBe(0);
    // Le bouton ouvre la fiche du client, sur le champ à corriger.
    await fenetre.getByRole('button', { name: 'Ouvrir la fiche du client', exact: true }).click();
    const fiche = nadia.locator('#modal-root .modal').last();
    const matricule = fiche.locator('[name=matricule]');
    await expect.poll(() => matricule.evaluate((i) => i === document.activeElement || i.classList.contains('invalide') || i.getAttribute('aria-invalid') === 'true'), { timeout: 5_000 }).toBe(true);
    await matricule.fill('1234567A/A/M/000');
    await fiche.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    // Émettre : la confirmation, puis le numéro.
    await expect.poll(() => nadia.locator('#modal-root .modal').count()).toBe(0);
    await nadia.locator('#issue').click();
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);

    // La Menuiserie déménage APRÈS l'émission : le fichier reste celui de la facture émise.
    const duServeur = (await api('GET', `/entreprises/${ent}/dossier-v10/f1/teif`, jeton)).corps as { nom: string; xml: string };
    expect(duServeur.nom).toBe('TEIF_7654321BAM000_FAC-2026-001.xml');
    const adresse = String(menuiserie.contenu.address ?? '');
    expect(adresse.length).toBeGreaterThan(5);
    expect(duServeur.xml).toContain(`<AdressDescription>${adresse}</AdressDescription>`);
    const client = (await objets()).find((o) => o.collection === 'clients' && o.cle === menuiserie.cle);
    if (!client) throw new Error('client absent');
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: client.cle, rang: client.rang, revision: client.revision, contenu: { ...client.contenu, address: '7 avenue Habib Bourguiba, Sfax' } }] });
    await nadia.reload();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
    await plusTard(nadia);
    // « Fichier pour El Fatoora » : le fichier du serveur, tel quel, dans les Téléchargements.
    await nadia.locator('#more-btn').click();
    const telechargement = nadia.waitForEvent('download');
    await nadia.getByRole('button', { name: 'Fichier pour El Fatoora (TEIF)…', exact: true }).click();
    const recu = await telechargement;
    expect(recu.suggestedFilename()).toBe(duServeur.nom);
    expect(fs.readFileSync(await recu.path(), 'utf8')).toBe(duServeur.xml);
    expect(duServeur.xml).not.toContain('Sfax');
    const pret = nadia.locator('#modal-root .modal').last();
    await expect.poll(() => pret.locator('h2').innerText()).toBe('Le fichier El Fatoora est prêt');
    expect(net(await pret.locator('p').first().innerText())).toBe(`${duServeur.nom} est dans tes Téléchargements. Il reste deux gestes, faits avec les outils de ton entreprise :`);
    expect(await pret.getByRole('button', { name: 'Montrer le fichier' }).count()).toBe(0);
    await nadia.screenshot({ path: path.join(PHOTOS, 'efacture-3-fichier.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 180_000);
});
