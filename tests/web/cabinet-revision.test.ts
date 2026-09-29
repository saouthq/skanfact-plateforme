// La révision et les questions au client, à la souris (brique 44 ; docs/cabinet.md, C32 et C33).
// L'écran est celui du Cabinet v10 ; les feuilles maîtresses se calculent par la v10 sur le livre du
// serveur ; la révision va au serveur, entière ; les questions vont dans les livres du client. Ce que
// le parcours vérifie, écran ET serveur :
//   - signer un compte, écrire et lever une note, poser et remplir le questionnaire, arrêter la
//     révision : chaque geste est gardé au serveur, au nom de qui l'a fait ;
//   - une question posée depuis une ligne reste au cabinet jusqu'à l'envoi ; envoyée, le client la
//     lit ; sa réponse revient sur l'écran du cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la révision et les questions au client, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-rev-'));
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

  type Revision = { periode: string; contenu: { faite: boolean; faitePar: string; comptes: { compte: string; revuPar: string }[];
    notes: { texte: string; levee: boolean; par: string }[]; questionnaire: { question: string; reponse: string }[] } };
  type Question = { id: string; statut: string; compte: string; piece: string; attendu: string; texte: string; envois: string[] };

  it('la révision se tient à la souris et se garde au serveur ; une question part au client à l\'envoi, et sa réponse revient', async () => {
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    // Un virement d'attente validé en mars.
    const od = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-03-10', journal: 'OD', piece: 'OD-7', libelle: 'Virement à justifier',
      lignes: [{ compte: '471', debit: '1200.5' }, { compte: '512', credit: '1200.5' }] })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [od] })).statut).toBe(200);
    const revision = async () => ((await api('GET', `/cabinets/${cabinet}/revisions/${ent}?annee=2026`, associe)).corps.revisions as Revision[]).find((x) => x.periode === '2026')?.contenu;
    const questions = async (jeton: string) => (await api('GET', `/entreprises/${ent}/compta/questions?annee=2026`, jeton)).corps.questions as Question[];

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/revision/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    await aller();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    // L'écran se redessine après chaque enregistrement (et referme le volet des comptes hors cycle) :
    // on rouvre ce qu'il faut jusqu'à voir le geste.
    const menu = async (cle: string, geste: string, volet?: string) => expect.poll(async () => {
      if (volet && !await p.locator(`${volet}[open]`).count()) await p.locator(`${volet} summary`).click({ timeout: 2_000 }).catch(() => {});
      if (!await p.getByRole('menuitem').filter({ hasText: geste }).count()) await p.locator(`[data-rowmenu="${cle}"]`).first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: geste }).count();
    }, { timeout: 20_000 }).toBe(1).then(() => p.getByRole('menuitem').filter({ hasText: geste }).click());

    // ── Signer un compte de la trésorerie ────────────────────────────────────────────────────────
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 20_000 }).toMatch(/0\scompte signé sur 2/);
    await ouvrir('.cy-carte:has-text("Trésorerie")', '[data-rowmenu="RV:512"]');
    await menu('RV:512', 'Signer ce compte');
    await expect.poll(toast).toBe('Compte 512 signé.');
    expect((await revision())?.comptes.map((c) => [c.compte, c.revuPar])).toEqual([['512', 'associe']]);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/1\scompte signé sur 2/);

    // ── Une note de revue, puis levée ────────────────────────────────────────────────────────────
    await ouvrir('#rv-note', '#nv-texte');
    await fenetre.locator('#nv-texte').fill('Rapprocher le 471 avec le relevé de mars');
    await fenetre.locator('#nv-ok').click();
    await expect.poll(async () => (await revision())?.notes.map((n) => [n.texte, n.levee, n.par])).toEqual([['Rapprocher le 471 avec le relevé de mars', false, 'associe']]);
    // Lever la note : un seul clic (un second la rouvrirait), une fois l'écran redessiné avec elle.
    await expect.poll(() => p.locator('[data-note]').first().innerText().catch(() => ''), { timeout: 20_000 }).toBe('Lever la note');
    await p.waitForTimeout(500);
    await p.locator('[data-note]').first().click();
    await expect.poll(async () => (await revision())?.notes[0]?.levee, { timeout: 20_000 }).toBe(true);
    await expect.poll(() => p.locator('[data-note]').first().innerText(), { timeout: 20_000 }).toBe('Rouvrir la note');

    // ── Le questionnaire du cabinet : écrit une fois dans les Réglages, posé, rempli ─────────────
    await ouvrir('#rv-modeles', '#sr-quest-add');
    await ouvrir('#sr-quest-add', '[data-q="0"]');
    await p.locator('[data-q="0"]').fill('Des litiges en cours ?');
    await p.locator('#sr-quest-save').click();
    // Les cycles s'enregistrent avec lui : ceux que la v10 propose (sept, la trésorerie d'abord).
    const methode = async () => (await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { questionnaire?: unknown; cycles?: { id: string }[] };
    await expect.poll(async () => (await methode()).questionnaire).toEqual([{ question: 'Des litiges en cours ?' }]);
    expect((await methode()).cycles?.map((c) => c.id)).toEqual(['tresorerie', 'ventes', 'achats', 'immobilisations', 'personnel', 'fiscal', 'capitaux']);
    // De retour sur le dossier, le questionnaire écrit se propose.
    await aller();
    await ouvrir('#rv-poser', '[data-qq]');
    await expect.poll(async () => (await revision())?.questionnaire.map((q) => q.question)).toEqual(['Des litiges en cours ?']);
    await ouvrir('[data-qq]', '#qq-rep');
    await fenetre.locator('#qq-rep').fill('Aucun litige connu au 31 décembre.');
    await fenetre.locator('#qq-ok').click();
    await expect.poll(async () => (await revision())?.questionnaire[0]?.reponse).toBe('Aucun litige connu au 31 décembre.');

    // ── Une question depuis la ligne du 471 : elle reste au cabinet jusqu'à l'envoi ─────────────
    // Le 471 n'est d'aucun cycle : il est dans le volet des comptes hors cycle.
    await menu('RV:471', 'Poser une question au client', '#rv-hors');
    await expect.poll(() => fenetre.locator('#qf-compte').inputValue()).toBe('471');
    await fenetre.locator('#qf-piece').fill('OD-7');
    await fenetre.locator('#qf-objet').fill('Justificatif absent');
    await fenetre.locator('#qf-attendu').selectOption('piece');
    await fenetre.locator('#qf-texte').fill('Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?');
    await fenetre.locator('#qf-ok').click();
    await expect.poll(async () => (await questions(associe)).map((q) => [q.statut, q.compte, q.piece, q.attendu])).toEqual([['ouverte', '471', 'OD-7', 'piece']]);
    expect(await questions(client)).toEqual([]);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/1\squestion au client n.est pas encore partie/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-revision-1-question.png') });

    // ── L'envoyer : le client la lit ; sa réponse revient sur l'écran du cabinet ────────────────
    await ouvrir('#rv-envoyer', '#qe-ok');
    expect(await fenetre.innerText()).toMatch(/1\squestion partira chez le client\s:\sil la lira dans son SkanFact/);
    await fenetre.locator('#qe-ok').click();
    await expect.poll(toast).toMatch(/^1\squestion envoyée à Menuiserie Ben Salah\.$/);
    const recue = await questions(client);
    expect(recue.map((q) => [q.statut, q.envois.length, q.texte])).toEqual([['envoyee', 1, 'Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?']]);
    expect((await api('POST', `/entreprises/${ent}/compta/questions/${recue[0]?.id}/repondre`, client, { texte: 'La facture est jointe à l\'achat du 9 mars.' })).statut).toBe(200);
    await p.reload();
    await expect.poll(() => p.locator('#rv-questions').innerText(), { timeout: 20_000 }).toMatch(/répondue\s+La facture est jointe à l'achat du 9 mars\./);

    // ── Arrêter la révision ─────────────────────────────────────────────────────────────────────
    await ouvrir('#rv-arreter', '#modal-root .modal');
    await fenetre.getByRole('button', { name: 'Arrêter la révision', exact: true }).click();
    await expect.poll(toast).toBe('Révision arrêtée.');
    expect(await revision()).toMatchObject({ faite: true, faitePar: 'associe' });
    expect((await revision())?.notes[0]?.levee).toBe(true);
    await expect.poll(() => p.locator('#rv-arretee').innerText()).toMatch(/par associe$/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-revision-2-arretee.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
