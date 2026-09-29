// Le Cabinet sans paquets, dans les gestes (brique 38 bis ; docs/cabinet.md, C14 et C15). Un mois
// passé sans aucune écriture se relance ; un mois dont des écritures sont au brouillard est « à
// valider » : c'est le travail du cabinet, jamais une relance. Le parcours, à la souris :
//   - « À faire » nomme les deux, et « Valider » ouvre la saisie du dossier sur l'exercice du mois ;
//   - la page Relances ne liste que le client dont un mois est vide ; le mail demande ses pièces dans
//     SkanFact, s'ouvre dans la messagerie, et la relance est notée dans la fiche, au serveur ;
//   - chaque mois du Suivi s'ouvre dans les livres : son livre-journal s'il est validé, sa saisie s'il
//     reste à valider ; un mois manquant porte la relance.
// Les mois sont comptés depuis aujourd'hui (le jour de relance, le 10, ne touche jamais les mois choisis).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Le mois à n mois d'aujourd'hui (« 2026-07 »), et son nom (« juillet 2026 »).
const mois = (n: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nom = (m: string) => `${NOMS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

describe('les relances et les mois à valider, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-relances-'));
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
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('un mois vide se relance, un mois au brouillard se valide ; la relance part dans la messagerie et se note dans la fiche', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    // Un client sur SkanFact qui confie son dossier (le mandat accepté).
    const confier = async (raisonSociale: string) => {
      const client = await personne('client');
      const ent = String((await api('POST', '/entreprises', client, { raisonSociale })).corps.id);
      await api('GET', `/entreprises/${ent}/dossier-v10`, client);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
      await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe);
      return { client, ent };
    };
    // Une OD du cabinet, validée, le 15 du mois.
    const odValidee = async (ent: string, m: string, piece: string) => {
      const id = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, {
        date: `${m}-15`, journal: 'OD', piece, libelle: 'Honoraires à payer', lignes: [{ compte: '6226', debit: '120' }, { compte: '4286', credit: '120' }],
      })).corps.id);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [id] })).statut).toBe(200);
    };

    // La menuiserie : sa mission commence il y a quatre mois ; seuls les deux derniers mois passés ont
    // des écritures (validées) : les deux premiers sont vides — à relancer.
    const menuiserie = await confier('Menuiserie Ben Salah');
    expect((await api('PUT', `/cabinets/${cabinet}/fiches/${menuiserie.ent}`, associe, { contenu: { from: mois(-4), email: 'menuiserie@exemple.tn' }, revision: null })).statut).toBe(200);
    await odValidee(menuiserie.ent, mois(-2), 'OD-1');
    await odValidee(menuiserie.ent, mois(-1), 'OD-2');
    // La boulangerie : un achat il y a deux mois, au brouillard (à valider) ; le mois d'après, validé.
    const boulangerie = await confier('Boulangerie Ennour');
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${boulangerie.ent}/dossier-v10`, boulangerie.client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Minoterie du Sahel' });
    await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-7', date: `${mois(-2)}-03`, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Farine', qty: 1, unitPrice: 830, vatRate: 7, destination: 'charge', deductible: true }], payments: [],
    });
    await odValidee(boulangerie.ent, mois(-1), 'OD-3');

    const erreurs: string[] = [];
    const p: Page = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      // La messagerie et le téléphone : le lien est noté au lieu d'ouvrir un autre logiciel.
      const cliquer = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (/^(mailto|tel):/.test(this.href)) { sessionStorage.setItem('liens', `${sessionStorage.getItem('liens') ?? ''}${this.href}\n`); return; }
        cliquer.call(this);
      };
    }, associe);
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };

    // « À faire » : un dossier a des mois sans écriture, un autre des écritures à valider.
    await aller('#/dossiers');
    // « À faire » ne montre d'abord que les deux lignes les plus urgentes : on déplie le reste.
    if (await p.locator('#todo-plus').count()) await p.locator('#todo-plus').click();
    const aFaire = p.locator('#todo-list');
    await expect.poll(() => aFaire.innerText()).toMatch(/1 dossier a des mois sans écriture/);
    expect(await aFaire.innerText()).toMatch(/1 dossier a des écritures à valider/);
    expect(await aFaire.innerText()).toContain('Boulangerie Ennour (1 mois) — valide-les avant de déclarer.');
    // (l'écran pose une espace fine insécable devant « : », à la française)
    expect(await p.locator('#view .legende').innerText()).toMatch(/à valider\s: des écritures encore au brouillard/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-relances-1-a-faire.png') });
    // « Valider » ouvre la saisie de la boulangerie, sur l'exercice de son mois à valider.
    await p.locator('[data-todo="provisoires"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${boulangerie.ent}/comptabilite/saisie/${mois(-2).slice(0, 4)}`);

    // Les relances : la menuiserie seule (la boulangerie n'a aucun mois vide) ; ses deux mois nommés.
    await aller('#/relances');
    const liste = p.locator('#view table.list tbody');
    await expect.poll(() => liste.innerText()).toContain('Menuiserie Ben Salah');
    expect(await liste.innerText()).not.toContain('Boulangerie Ennour');
    const manquants = mois(-4).slice(0, 4) === mois(-3).slice(0, 4) ? `${nom(mois(-4)).split(' ')[0]} et ${nom(mois(-3))}` : `${nom(mois(-4))} et ${nom(mois(-3))}`;
    expect(await liste.innerText()).toContain(manquants);
    // Le mail : les pièces dans SkanFact, rien à fabriquer ni à envoyer.
    await p.locator('#view [data-rel]').first().click();
    const objet = await p.locator('#r-sub').inputValue();
    const corps = await p.locator('#r-body').inputValue();
    expect(objet).toMatch(/^Il me manque vos pièces d/);
    expect(corps).toContain('Il vous suffit de les enregistrer dans SkanFact');
    expect(`${objet} ${corps}`).not.toMatch(/paquet|clôturez|provisoire/i);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-relances-2-mail.png') });
    await p.getByRole('button', { name: 'Ouvrir dans ma messagerie', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    // Le mail s'est ouvert dans la messagerie, adressé au client, son objet dedans.
    const liens = String(await p.evaluate(() => sessionStorage.getItem('liens') ?? ''));
    expect(liens).toContain('mailto:menuiserie%40exemple.tn?subject=Il%20me%20manque%20vos%20pi%C3%A8ces');
    // La relance est notée dans la fiche, au serveur : le moyen, les deux mois réclamés.
    const fiches = (await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { relances?: { via: string; months: string[]; at: number }[] } }[];
    const relances = fiches.find((f) => f.entreprise === menuiserie.ent)?.contenu.relances ?? [];
    expect(relances.map((r) => ({ via: r.via, months: r.months }))).toEqual([{ via: 'email', months: [mois(-4), mois(-3)] }]);
    expect(Math.abs(Number(relances[0]?.at) - Date.now())).toBeLessThan(120_000);

    // Le Suivi de la menuiserie : la relance dans son historique ; ses mois, chacun avec son geste.
    await aller(`#/dossier/${menuiserie.ent}/suivi`);
    const historique = p.locator('#view .panel').filter({ has: p.locator('h2', { hasText: 'Relances' }) });
    await expect.poll(() => historique.innerText()).toContain('Email');
    expect(await historique.innerText()).toContain(manquants);
    expect(await p.locator('#d-etat').innerText()).toMatch(/2 mois écrits · 2 manquants · mis à jour le/);
    const caseDe = (m: string) => p.locator(`#view .mcell[data-m="${m}"], #view .mcell[data-relm="${m}"]`);
    expect(await caseDe(mois(-4)).innerText()).toContain('manquant');
    expect(await caseDe(mois(-2)).innerText()).toContain('validé');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-relances-3-suivi.png') });
    // Un mois validé s'ouvre dans le livre-journal, sur ce mois.
    await caseDe(mois(-2)).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}/comptabilite/journal/${mois(-2).slice(0, 4)}`);
    await expect.poll(() => p.locator('#view').innerText()).toContain('OD-1');

    // Le Suivi de la boulangerie : son mois au brouillard est « à valider », et s'ouvre dans la saisie.
    await aller(`#/dossier/${boulangerie.ent}/suivi`);
    await expect.poll(() => caseDe(mois(-2)).innerText()).toContain('à valider');
    expect(await p.locator('#d-etat').innerText()).toMatch(/1 mois à valider/);
    expect(await p.locator('#rel').count()).toBe(0);
    await caseDe(mois(-2)).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${boulangerie.ent}/comptabilite/saisie/${mois(-2).slice(0, 4)}`);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
