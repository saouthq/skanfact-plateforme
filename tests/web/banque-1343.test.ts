// La Banque d'un dossier au Cabinet, jouée comme un comptable (1.343.0 ; docs/revue-modules.md). Ce que le
// parcours vérifie, écran ET serveur :
//   - la bande au-dessus de la liste a sa place réservée : l'annonce d'un geste la prend sans pousser la liste ;
//   - une pastille à zéro est éteinte ; filtrer laisse le panneau de droite sur une ligne MONTRÉE ; un filtre que le geste
//     vide se lève ;
//   - le pont : la réponse du client nomme « la Minoterie », et la fenêtre propose le compte du fournisseur ;
//   - Entrée dans la liste des comptes choisit, elle n'enregistre pas la fenêtre du même coup ;
//   - l'écriture écrite d'après la réponse s'annonce dans la carte et choisit la ligne suivante ;
//   - « Revoir mars » : les rapprochées se déplient, le panneau ne montre pas une ligne cachée.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la banque d\'un dossier, jouée comme un comptable (1.343.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-banque-1343-'));
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

  type Releve = { id: string; lignes: { id: string; niveau: string; rapprochement: { ecriture: string; rang: number; niveau: string; auto: boolean } | null }[] };
  const releves = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/releves?annee=2026`, jeton)).corps.releves as Releve[];

  it('(1.343.0) la bande réservée, les pastilles et le filtre, la réponse du client qui nomme son fournisseur, Entrée qui choisit sans enregistrer, le geste annoncé dans la carte', async () => {
    const client = await personne('client');
    const associe = await personne('associe');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Boulangerie Essaada' })).corps.id);
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string, string?][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit, tiers]) => ({ compte, debit, credit, ...(tiers ? { tiers } : {}) })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    const ids = [
      await saisir('2026-01-01', 'AN', 'AN-1', 'Solde de la banque repris', [['532', '10000,500', ''], ['101', '', '10000,500']]),
      // Trois fournisseurs : un seul porte le mot « Minoterie » ; « Sahel » en nomme deux (il ne nomme personne).
      await saisir('2026-03-01', 'AC', 'FA-0901', 'Farine de mars', [['6061', '406,980', ''], ['401', '', '406,980', 'Minoterie du Cap Bon']]),
      await saisir('2026-03-01', 'AC', 'LV-77', 'Levures', [['6061', '120', ''], ['401', '', '120', 'Levures du Sahel']]),
      await saisir('2026-03-01', 'AC', 'EM-12', 'Sachets', [['6061', '80', ''], ['401', '', '80', 'Emballages du Sahel']]),
      await saisir('2026-03-02', 'BQ', 'VIR-1', 'Virement du client Dupont', [['532', '1190,250', ''], ['411', '', '1190,250', 'Dupont']]),
      await saisir('2026-03-10', 'BQ', 'CHQ-1234', 'Chèque 1234', [['6061', '700', ''], ['532', '', '700']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);
    // Le relevé de mars : le virement et le chèque se proposent, les frais sont à traiter, le chèque 4410 072 est au client.
    const lignesReleve = [
      { date: '2026-03-02', libelle: 'VIR CLIENT DUPONT', reference: 'R1', montant: '1190,250' },
      { date: '2026-03-08', libelle: 'CHQ 4410 072', reference: 'R2', montant: '-406,980' },
      { date: '2026-03-10', libelle: 'CHQ 1234', reference: 'R3', montant: '-700' },
      { date: '2026-03-15', libelle: 'FRAIS TENUE DE COMPTE', reference: 'R4', montant: '-11,900' },
    ];
    const rel = await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'mars.csv', empreinte: 'b'.repeat(64), soldeDebut: '10000,500', soldeFin: '10071,870', lignes: lignesReleve });
    expect([200, 201]).toContain(rel.statut);
    // La question posée sur le chèque, envoyée ; le client répond en nommant « la Minoterie », jamais son nom entier.
    const url = `/entreprises/${ent}/compta/questions`;
    const q = String((await api('POST', url, associe, { periode: '2026-03', compte: '532', montant: '406.980', objet: 'Question sur CHQ 4410 072', texte: 'Que paie ce chèque de 406,980 DT ?', attendu: 'explication' })).corps.id);
    expect((await api('POST', `${url}/envoyer`, associe, { annee: 2026 })).corps.envoyees).toBe(1);
    expect((await api('POST', `${url}/${q}/repondre`, client, { texte: 'C\'est le chèque au fournisseur de farine, la Minoterie.' })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/banque/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('[data-cp-mois="2026-03"]').click();
    await p.locator('.bq-f').waitFor();
    const fenetre = p.locator('#modal-root .modal').first();
    const pastille = (c: string) => p.locator(`.bq-fc.${c}`);
    const choisie = () => p.locator('table.bq-t [data-bq-ligne].on').innerText().catch(() => '');
    const enFace = () => p.locator('.bq-livre').innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '');
    const haut = () => p.locator('table.bq-t').evaluate((t) => Math.round(t.getBoundingClientRect().top));
    await expect.poll(() => p.locator('.bq-f').innerText().then((t) => t.replace(/\s+/g, ' '))).toMatch(/4 Toutes 0 Rapprochées 2 Proposées 1 À traiter 1 En attente/);

    // ── Une pastille à zéro est éteinte : elle ne mène plus à une liste vide ────────────────────────
    expect(await pastille('ok').isDisabled()).toBe(true);
    expect(await pastille('prop').isDisabled()).toBe(false);

    // ── La bande au repos et l'annonce ont la même place : la liste ne bouge pas sous le geste ──────
    await expect.poll(() => p.locator('#bq-annonce-place').count()).toBe(1);
    const repos = await p.locator('#bq-annonce-place').evaluate((e) => Math.round(e.getBoundingClientRect().height));
    const hautAvant = await haut();

    // ── Filtrer : le panneau suit une ligne montrée ─────────────────────────────────────────────
    expect(await choisie()).toMatch(/VIR CLIENT DUPONT/);
    await pastille('att').click();
    await expect.poll(choisie).toMatch(/CHQ 4410 072/);
    await expect.poll(enFace).toMatch(/en face de CHQ 4410 072/);
    await expect.poll(enFace).toMatch(/Réponse : «\s*C'est le chèque au fournisseur de farine, la Minoterie\.\s*»[\s\S]*Sa réponse est là/);
    expect(await enFace()).not.toMatch(/Tant qu'il n'a pas répondu/);
    // La pastille choisie le reste sous le curseur (le survol la repeignait comme éteinte).
    await pastille('att').hover();
    expect(await pastille('att').evaluate((b) => [b.matches(':hover'), getComputedStyle(b).borderColor === getComputedStyle(b).color])).toEqual([true, true]);

    // ── Le pont : la réponse nomme « la Minoterie », la fenêtre propose son compte ─────────────────
    await p.locator('#bq-principal').click();
    await expect.poll(() => fenetre.innerText()).toMatch(/a répondu : «\s*C'est le chèque au fournisseur de farine, la Minoterie\.\s*»[\s\S]*Le compte de Minoterie du Cap Bon \(401\) est proposé/);
    expect(await fenetre.locator('[name=compte]').inputValue()).toBe('401');

    // ── Entrée dans la liste des comptes CHOISIT, elle n'enregistre pas la fenêtre ─────────────────
    await fenetre.locator('[name=compte]').fill('');
    await fenetre.locator('[name=compte]').pressSequentially('401');
    await p.locator('.sugg-pop .sugg-it').first().waitFor();
    await fenetre.locator('[name=compte]').press('Enter');
    await p.waitForTimeout(600);
    expect(await fenetre.count()).toBe(1);
    expect(await fenetre.locator('[name=compte]').inputValue()).toBe('401');
    expect((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as unknown[]).toHaveLength(ids.length);

    // ── Le brouillard d'après la réponse : l'annonce dans la carte, à la place réservée, le filtre vidé se lève ─
    await fenetre.getByRole('button', { name: 'Créer le brouillard' }).click();
    await expect.poll(() => p.locator('#bq-annonce').innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/« CHQ 4410 072 » : brouillard créé au compte 401 et rapproché ; la ligne suivante est choisie/);
    expect(await p.locator('#bq-annonce').evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(repos);
    expect(await haut()).toBe(hautAvant);
    expect(await pastille('att').isDisabled()).toBe(true);
    expect(await pastille('tout').getAttribute('aria-pressed')).toBe('true');
    expect(await p.locator('table.bq-t').innerText()).not.toMatch(/Aucune ligne dans cet état/);
    const ecrites = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; piece: string; statut: string; lignes: { compte: string; tiers: string | null }[] }[];
    const nouvelle = ecrites.find((e) => !['AN-1', 'FA-0901', 'LV-77', 'EM-12', 'VIR-1', 'CHQ-1234'].includes(e.piece));
    expect(nouvelle?.statut).toBe('brouillard');
    expect(nouvelle?.lignes.map((l) => [l.compte, l.tiers])).toEqual([['532', null], ['401', 'Minoterie du Cap Bon']]);
    expect((await releves(ent, associe))[0]?.lignes[1]?.rapprochement?.ecriture).toBe(nouvelle?.id);
    await p.screenshot({ path: path.join(PHOTOS, 'banque-1343-annonce.png') });

    // ── Tout rapproché, « Revoir mars » : les rapprochées se déplient, le panneau montre une ligne visible ─
    await p.locator('table.bq-t [data-bq-valider]').click();
    await expect.poll(() => pastille('prop').innerText()).toMatch(/^0/);
    await p.locator('table.bq-t [data-bq-ligne]').first().click();
    await p.locator('#bq-principal').click();
    await fenetre.locator('[name=compte]').fill('6278');
    await fenetre.getByRole('button', { name: 'Créer le brouillard' }).click();
    await p.locator('.bq-fini2').waitFor({ timeout: 10_000 });
    await p.getByRole('button', { name: /^Revoir mars/ }).click();
    await expect.poll(() => p.locator('table.bq-t [data-bq-ligne]').count()).toBe(4);
    expect(await p.locator('#bq-voir-faites').count()).toBe(0);
    expect(await choisie()).not.toBe('');

    expect(erreurs).toEqual([]);
    await ctx.close();
  }, 180_000);
});
