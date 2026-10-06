// Les envois, à la souris (brique 79 ; docs/espace-client.md, E7). Un navigateur ne joint pas de fichier :
// Nadia envoie sa facture émise par e-mail, puis par WhatsApp, et chaque message porte le LIEN de la pièce,
// avant la formule de politesse, avec « et la régler en ligne » parce qu'elle a branché le paiement en
// ligne ; la phrase « Veuillez trouver ci-joint » du modèle ne ment plus. Son client ouvre le lien et voit
// sa facture. Ce que le parcours vérifie, écran ET serveur :
//   - la case « Ajouter le lien de la pièce » (cochée) ; décochée, le message retrouve sa phrase ;
//   - le message ouvert (le « mailto », l'adresse de WhatsApp) porte un lien qui s'ouvre sur la facture ;
//   - « Lien pour le client… » dit par où chaque lien est parti ;
//   - un devis part aussi avec son lien (le devis par son lien, 06/10/2026), et son client l'ouvre ;
//   - un relevé part sans rien de joint, et le message le dit (jamais « le PDF s'affiche ») ;
//   - sur un Mac, aucune question « Mail ou une autre messagerie » ; une fenêtre ne s'ouvre que pendant le geste ;
//   - Paramètres → Envois ne propose plus « Mail (Apple) avec le PDF joint ».

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

describe('les envois, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-envois-'));
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
  const echappe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Ouvrir l'envoi d'une pièce : le bouton de la barre, ou son entrée dans « Plus ».
  const envoi = async (p: Page, nom: RegExp) => {
    const direct = p.locator('#doc-actions, #view').getByRole('button', { name: nom }).first();
    if (!(await direct.isVisible().catch(() => false))) await p.locator('#more-btn').click();
    await p.getByRole('button', { name: nom }).first().click();
    return p.locator('#modal-root .modal').last();
  };

  it('la facture part avec son lien, par e-mail puis par WhatsApp ; le devis aussi ; le relevé part sans rien de joint', async () => {
    const email = `nadia-envois-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Mac', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    // La facture de la Menuiserie, émise par le serveur (1 073,190), et un devis en brouillon.
    const doc = {
      id: 'f1', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc },
      { collection: 'documents', cle: 'd1', rang: 1, revision: null, contenu: { ...doc, id: 'd1', type: 'devis', number: 'DEV-2026-001', dueDate: '2099-12-31' } },
    ] });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang: 0, netAPayer: '1073.190' })).statut).toBe(200);

    // Nadia est sur un Mac (la v10 y proposait « Mail, le PDF déjà joint »), dans un navigateur strict
    // comme Safari : une fenêtre ne s'ouvre que PENDANT le geste, et « noopener » fait rendre null. Ce que
    // le navigateur ouvrirait (la messagerie, WhatsApp) est noté au lieu d'être ouvert.
    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cn.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      const w = window as unknown as { __ouverts: string[] };
      w.__ouverts = [];
      const clic = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.href.startsWith('mailto:')) { w.__ouverts.push(this.href); return; }
        clic.call(this);
      };
      window.open = ((adresse?: string | URL, _cible?: string, options?: string) => {
        if (!window.event || /noopener/.test(String(options ?? ''))) { w.__ouverts.push('bloquée'); return null; }
        w.__ouverts.push(`fenêtre:${String(adresse ?? '')}`);
        const fausse = { closed: false, opener: {} as unknown, close() { fausse.closed = true; }, location: { set href(v: string) { w.__ouverts.push(v); }, get href() { return ''; } } };
        return fausse as unknown as Window;
      }) as typeof window.open;
    });
    const ouverts = (p: Page) => p.evaluate(() => (window as unknown as { __ouverts: string[] }).__ouverts);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await nadia.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await nadia.waitForTimeout(600);
    await plusTard(nadia);

    // L'e-mail : aucune question « Mail ou une autre messagerie » ; la case du lien, cochée ; « Veuillez
    // trouver ci-joint » devient « Voici » (rien n'est joint), et décocher rend la phrase.
    const fenetre = await envoi(nadia, /^(Email|Envoyer par email…)$/);
    expect(await nadia.locator('#msg-choix').count()).toBe(0);
    const caseLien = fenetre.getByLabel(/Ajouter le lien de la pièce/);
    expect(await caseLien.isChecked()).toBe(true);
    const message = fenetre.locator('textarea[name=body]');
    expect(await message.inputValue()).toMatch(/^Bonjour,\n\nVoici notre facture FAC-2026-001, d'un montant net à payer de 1\s073,190\sDT/);
    expect(net(await fenetre.locator('#mf-envoi').innerText())).toBe('Le message s\'ouvre dans ta messagerie : tu le relis et tu cliques sur Envoyer. Un navigateur ne joint pas de fichier : le lien de la pièce s\'ajoute avant la formule de politesse, et ton client y voit la pièce telle que tu l\'imprimes, et ce qu\'il en doit. Modèles d\'email : Paramètres → Envois.');
    await caseLien.uncheck();
    expect(await message.inputValue()).toMatch(/^Bonjour,\n\nVeuillez trouver ci-joint notre facture FAC-2026-001/);
    await caseLien.check();
    expect(await message.inputValue()).toMatch(/^Bonjour,\n\nVoici notre facture/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'envois-1-email.png') });
    await fenetre.getByRole('button', { name: 'Ouvrir dans la messagerie', exact: true }).click();
    await expect.poll(async () => (await ouverts(nadia)).length, { timeout: 15_000 }).toBe(1);
    const mail = new URL((await ouverts(nadia))[0] ?? '');
    expect(decodeURIComponent(mail.pathname)).toBe(String(menuiserie.contenu.email ?? ''));
    // Pas de paiement en ligne branché : le lien sert à voir la facture, pas à la régler.
    const corps = mail.searchParams.get('body') ?? '';
    const lienMail = new RegExp(`\\n\\nPour voir la facture en ligne : (${echappe(serveur.adresse)}/espace/#[A-Za-z0-9_-]{32})\\n\\nCordialement,\\n`).exec(corps)?.[1];
    expect(lienMail, corps).toBeTruthy();
    await expect.poll(async () => net(await nadia.locator('#toast').innerText())).toBe('Message ouvert dans ta messagerie, avec le lien de la pièce');

    // Le client ouvre le lien du message : sa facture, et ce qu'il en doit.
    const cc = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
    const client = await cc.newPage();
    await client.goto(lienMail ?? '');
    await expect.poll(() => client.frameLocator('iframe.piece').locator('body').innerText(), { timeout: 15_000 }).toContain('FAC-2026-001');
    await expect.poll(() => client.locator('.barre .reste').innerText()).toMatch(/^Reste à payer : 1\s073,190\sDT$/);

    // Nadia branche le paiement en ligne (posé à la main : la clé n'est pas l'objet de ce parcours). Son
    // WhatsApp : la conversation s'ouvre (pendant le geste, puis reçoit son adresse) sur un message qui
    // porte un AUTRE lien de la pièce, pour la voir ET la régler.
    await admin.query(`insert into ventes.prestataire (entreprise, prestataire, portefeuille, cle_scellee, cle_fin, compte_v10, pose_le, pose_par)
      select $1, 'konnect', 'portefeuille-essai', 'v1.a.b.c', 'b3f2', 'konnect', now(), m.utilisateur from socle.membre m where m.entreprise = $1 limit 1`, [ent]);
    const wa = await envoi(nadia, /^Envoyer par WhatsApp…$/);
    expect(await wa.getByLabel(/Ajouter le lien de la pièce/).isChecked()).toBe(true);
    const tel = wa.locator('[name=tel]');
    if (!(await tel.inputValue())) await tel.fill('98 123 456');
    await nadia.screenshot({ path: path.join(PHOTOS, 'envois-2-whatsapp.png') });
    await wa.getByRole('button', { name: 'Ouvrir WhatsApp', exact: true }).click();
    await expect.poll(async () => (await ouverts(nadia)).length, { timeout: 15_000 }).toBe(3);
    const [, vide, conversation] = await ouverts(nadia);
    expect(vide).toBe('fenêtre:');
    expect(conversation).toMatch(/^https:\/\/wa\.me\/216\d{8}\?text=/);
    const texte = new URL(conversation ?? '').searchParams.get('text') ?? '';
    const lienWa = new RegExp(`\\n\\nPour voir la facture et la régler en ligne : (${echappe(serveur.adresse)}/espace/#[A-Za-z0-9_-]{32})\\n\\nCordialement,\\n`).exec(texte)?.[1];
    expect(lienWa, texte).toBeTruthy();
    expect(lienWa).not.toBe(lienMail);
    await expect.poll(async () => net(await nadia.locator('#toast').innerText())).toBe('WhatsApp s\'ouvre sur la conversation, avec le lien de la pièce');

    // « Lien pour le client… » dit par où chaque lien est parti.
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Lien pour le client…', exact: true }).click();
    await expect.poll(() => nadia.locator('#modal-root .modal').last().locator('#lc-liste').innerText(), { timeout: 15_000 })
      .toMatch(/^Cette pièce, envoyé par WhatsApp le .* par Nadia\s*Pas encore ouvert\s*Retirer\s*Cette pièce, envoyé par e-mail le .* par Nadia\s*Vu le .*\s*Retirer$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'envois-3-liens.png') });
    await nadia.locator('#modal-root .modal').last().getByRole('button', { name: 'Fermer', exact: true }).click();

    // Le devis (le devis par son lien) : il part avec son lien, comme la facture ; « ci-joint » devient « Voici », et la
    // fenêtre ne promet pas « ce qu'il en doit » (un devis ne se doit pas). Encore en brouillon, son envoi le fait
    // passer à « envoyé » : son client l'ouvre alors, à part de ses factures.
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d1`);
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Devis/);
    await plusTard(nadia);
    const devis = await envoi(nadia, /^(Email|Envoyer par email…)$/);
    expect(await devis.getByLabel(/Ajouter le lien de la pièce/).isChecked()).toBe(true);
    expect(await devis.locator('textarea[name=body]').inputValue()).toMatch(/^Bonjour,\n\nVoici notre devis DEV-2026-001/);
    expect(net(await devis.locator('#mf-envoi').innerText())).toBe('Le message s\'ouvre dans ta messagerie : tu le relis et tu cliques sur Envoyer. Un navigateur ne joint pas de fichier : le lien de la pièce s\'ajoute avant la formule de politesse, et ton client y voit la pièce telle que tu l\'imprimes. Modèles d\'email : Paramètres → Envois.');
    await nadia.screenshot({ path: path.join(PHOTOS, 'envois-4-devis.png') });
    await devis.getByRole('button', { name: 'Annuler', exact: true }).click();
    const waDevis = await envoi(nadia, /^(WhatsApp|Envoyer par WhatsApp…)$/);
    expect(await waDevis.getByLabel(/Ajouter le lien de la pièce/).isChecked()).toBe(true);
    await waDevis.getByRole('button', { name: 'Ouvrir WhatsApp', exact: true }).click();
    await expect.poll(async () => (await ouverts(nadia)).length, { timeout: 15_000 }).toBe(5);
    const texteDevis = new URL((await ouverts(nadia))[4] ?? '').searchParams.get('text') ?? '';
    expect(texteDevis).toMatch(/^Bonjour,\n\nVoici notre devis DEV-2026-001/);
    const lienDevis = new RegExp(`\\n\\nPour voir le devis en ligne : (${echappe(serveur.adresse)}/espace/#[A-Za-z0-9_-]{32})\\n\\nCordialement,\\n`).exec(texteDevis)?.[1];
    expect(lienDevis, texteDevis).toBeTruthy();
    // Une fiche société qui n'a jamais porté ses conditions de devis (créée ailleurs que par l'écran, ou avant elles) :
    // Nadia imprime celles que la v10 y met par défaut, et son client doit lire les mêmes.
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
    if (!fiche) throw new Error('fiche société absente');
    const sansConditions = Object.fromEntries(Object.entries(fiche.contenu).filter(([k]) => k !== 'quoteTerms' && k !== 'quoteTermsEn'));
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche.revision, contenu: sansConditions }] })).statut).toBe(200);
    // Son client l'ouvre : le devis comme Nadia l'imprime, son état, son montant ; rien à payer.
    const clientDevis = await cc.newPage();
    await clientDevis.goto(lienDevis ?? '');
    await expect.poll(() => clientDevis.frameLocator('iframe.piece').locator('body').innerText(), { timeout: 15_000 }).toContain('DEV-2026-001');
    // Ses conditions, comme Nadia les imprime : celles de sa fiche, ou à défaut celles que la v10 y met.
    expect(net(await clientDevis.frameLocator('iframe.piece').locator('body').innerText())).toContain('Pour accepter ce devis, retournez-le daté et signé avec la mention « Bon pour accord ».');
    await expect.poll(() => clientDevis.locator('.barre .reste').innerText()).toMatch(/^En attente de ta réponse · valable jusqu'au 31\/12\/2099 · 1\s072,190\sDT$/);
    expect(await clientDevis.locator('#payer').count()).toBe(0);
    await clientDevis.screenshot({ path: path.join(PHOTOS, 'envois-5-devis-client.png') });
    // Le lien de son compte : ses devis à part de ses factures ; « Tu dois » ne compte que la facture.
    const duCompte = await api('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: menuiserie.cle });
    const compte = await cc.newPage();
    await compte.goto(`${serveur.adresse}${String(duCompte.corps.adresse)}`);
    await expect.poll(() => compte.locator('.du').innerText(), { timeout: 15_000 }).toMatch(/^Tu dois\s+1\s073,190\sDT/);
    await expect.poll(() => compte.locator('h2.titre-devis + .carte tbody tr').allInnerTexts()).toEqual([expect.stringMatching(/^Devis DEV-2026-001\s+En attente de ta réponse\s+01\/10\/2026\s+31\/12\/2099\s+1\s072,190\sDT\s+Voir$/)]);
    await compte.locator('[data-devis="0"]').click();
    await expect.poll(() => compte.frameLocator('iframe.piece').locator('body').innerText(), { timeout: 15_000 }).toContain('DEV-2026-001');
    // « Lien pour le client… » sur le devis envoyé : le lien de son compte, et celui du devis, parti par WhatsApp.
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Lien pour le client…', exact: true }).click();
    await expect.poll(() => nadia.locator('#modal-root .modal').last().locator('#lc-liste').innerText(), { timeout: 15_000 })
      .toMatch(/^Son compte, donné le .* par Nadia\s*Vu le .*\s*Retirer\s*Cette pièce, envoyé par WhatsApp le .* par Nadia\s*Vu le .*\s*Retirer$/);
    await nadia.locator('#modal-root .modal').last().getByRole('button', { name: 'Fermer', exact: true }).click();
    // Sans le lien (la case décochée) : WhatsApp s'ouvre pendant le geste, sans lien, sur le message du modèle.
    const sansLien = await envoi(nadia, /^(WhatsApp|Envoyer par WhatsApp…)$/);
    await sansLien.getByLabel(/Ajouter le lien de la pièce/).uncheck();
    await sansLien.getByRole('button', { name: 'Ouvrir WhatsApp', exact: true }).click();
    await expect.poll(async () => (await ouverts(nadia)).slice(5), { timeout: 15_000 }).toEqual(['fenêtre:', expect.stringMatching(/^https:\/\/wa\.me\/216\d{8}\?text=Bonjour/)]);
    expect((await ouverts(nadia))[6]).not.toContain('espace');

    // Le relevé de compte : il ne se joint pas, et le message ouvert le dit.
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/client/${menuiserie.cle}`);
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Menuiserie/);
    await plusTard(nadia);
    await nadia.getByRole('button', { name: 'Actions', exact: true }).first().click();
    await nadia.getByRole('menuitem', { name: /^Relevé de compte…/ }).first().click();
    await nadia.locator('#modal-root .modal').last().getByRole('button', { name: 'Envoyer au client…', exact: true }).click();
    await expect.poll(async () => net(await nadia.locator('#toast').innerText()), { timeout: 15_000 })
      .toBe('Message ouvert dans ta messagerie, sans le relevé : un navigateur ne sait pas le joindre. « Exporter en PDF » l\'enregistre ; joins-le ensuite au message.');

    // Paramètres → Envois : ce que fait un navigateur, rien à choisir (même sur un Mac).
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Paramètres');
    await plusTard(nadia);
    await nadia.getByRole('tab', { name: 'Envois', exact: true }).click();
    expect(await nadia.locator('[name=mailClient]').count()).toBe(0);
    expect(net(await nadia.locator('#mail-fixe').innerText())).toBe('Le message s\'ouvre dans la messagerie de ton appareil, sans pièce jointe : un navigateur ne sait pas en joindre. Pour une facture ou un avoir émis, SkanFact met dans le message le lien de la pièce : ton client y voit la pièce telle que tu l\'imprimes, et ce qu\'il en doit ; il la règle en ligne si tu as branché le paiement en ligne (onglet Documents). Il n\'y a rien à régler ici.');
    await nadia.screenshot({ path: path.join(PHOTOS, 'envois-5-parametres.png') });
    expect((await ouverts(nadia)).filter((o) => o === 'bloquée')).toEqual([]);
    expect(erreurs).toEqual([]);
    await cn.close();
    await cc.close();
  }, 180_000);
});
