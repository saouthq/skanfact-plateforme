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
    notes: { texte: string; levee: boolean; par: string }[]; questionnaire: { question: string; reponse: string; demande?: string }[] } };
  type Question = { id: string; statut: string; compte: string; piece: string; attendu: string; texte: string; objet: string; montant: string; envois: string[] };

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
    // Un message suit un geste qui passe par le serveur : sur une machine chargée, plus d'une seconde (le délai de
    // expect.poll par défaut) peut s'écouler avant lui (rouge de GitHub du 21/10/2026, « Révision arrêtée. » lu vide).
    const APRES_LE_SERVEUR = { timeout: 15_000 };
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 40_000 }).toBe(1);
    // L'écran se redessine après chaque enregistrement (et referme le volet des comptes hors cycle) :
    // on rouvre ce qu'il faut jusqu'à voir le geste.
    const menu = async (cle: string, geste: string, volet?: string) => expect.poll(async () => {
      if (volet && !await p.locator(`${volet}[open]`).count()) await p.locator(`${volet} summary`).click({ timeout: 2_000 }).catch(() => {});
      if (!await p.getByRole('menuitem').filter({ hasText: geste }).count()) await p.locator(`[data-rowmenu="${cle}"]`).first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: geste }).count();
    }, { timeout: 20_000 }).toBe(1).then(() => p.getByRole('menuitem').filter({ hasText: geste }).click());

    // ── Signer un compte de la trésorerie ────────────────────────────────────────────────────────
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 20_000 }).toMatch(/0\scompte signé sur 2/);
    // La ligne d'avancement garde sa hauteur, qu'elle porte le bouton « Revoir Trésorerie » ou la phrase « Signe les
    // comptes… » : sinon toute la feuille descendait de 5 px au dernier compte signé d'un cycle (1.97.0).
    const hauteurAvance = async () => (await p.locator('.rv-avance').boundingBox())?.height ?? 0;
    await expect.poll(() => p.locator('#rv-suivant').count()).toBe(1);
    const avecBouton = await hauteurAvance();
    await ouvrir('.cy-carte:has-text("Trésorerie")', '[data-rowmenu="RV:512"]');
    await expect.poll(() => p.locator('#rv-signer').count()).toBe(1);
    expect(await hauteurAvance()).toBe(avecBouton);
    // Signer ne pousse rien : « revu » tient la place de « à revoir ». Le nom et la date écrits dans la cellule
    // l'élargissaient de 175 px, l'intitulé voisin se coupait et le tableau débordait (parcours du 21/10/2026) ;
    // qui a signé et quand se lit dans le menu de la ligne.
    const intitule471 = async () => (await p.locator('tr:has([data-rowmenu="RV:471"]) td.tronq').boundingBox())?.width ?? 0;
    const avant = await intitule471();
    await menu('RV:512', 'Signer ce compte');
    await expect.poll(toast, APRES_LE_SERVEUR).toBe('Compte 512 signé.');
    expect((await revision())?.comptes.map((c) => [c.compte, c.revuPar])).toEqual([['512', 'associe']]);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/1\scompte signé sur 2/);
    await expect.poll(() => p.locator('tr:has([data-rowmenu="RV:512"]) td.rv-revu').innerText()).toBe('revu');
    expect(Math.abs(await intitule471() - avant)).toBeLessThan(4);
    await p.locator('[data-rowmenu="RV:512"]').first().click();
    await expect.poll(() => p.getByRole('menuitem').filter({ hasText: 'Retirer ma signature' }).innerText()).toMatch(/Revu par associe le \d\d\/\d\d\/\d{4}/);
    await p.keyboard.press('Escape');

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
    // Comme une personne : on attend le « ✓ enregistré » de l'écran avant de le quitter.
    await expect.poll(() => p.locator('#sr-quest-saved').innerText().catch(() => ''), { timeout: 30_000 }).toBe('✓ enregistré');
    // Les cycles s'enregistrent avec lui : ceux que la v10 propose (sept, la trésorerie d'abord).
    const methode = async () => (await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { questionnaire?: unknown; cycles?: { id: string }[] };
    await expect.poll(async () => (await methode()).questionnaire).toEqual([{ question: 'Des litiges en cours ?' }]);
    expect((await methode()).cycles?.map((c) => c.id)).toEqual(['tresorerie', 'ventes', 'achats', 'immobilisations', 'personnel', 'fiscal', 'capitaux']);
    // De retour sur le dossier, le questionnaire écrit se propose.
    await aller();
    await ouvrir('#rv-poser', '[data-qq]');
    await expect.poll(async () => (await revision())?.questionnaire.map((q) => q.question)).toEqual(['Des litiges en cours ?']);
    // (1.190.0) Relié, posé, il se propose aussitôt au client ; ici, la réponse se note soi-même.
    await expect.poll(() => fenetre.locator('h2').innerText().catch(() => ''), APRES_LE_SERVEUR).toBe('Le questionnaire à Menuiserie Ben Salah');
    await fenetre.locator('[data-close]').click();
    await ouvrir('[data-qq]', '#qq-rep');
    await fenetre.locator('#qq-rep').fill('Aucun litige connu au 31 décembre.');
    await fenetre.locator('#qq-ok').click();
    await expect.poll(async () => (await revision())?.questionnaire[0]?.reponse).toBe('Aucun litige connu au 31 décembre.');

    // ── (1.187.0) Une question depuis la ligne du 471 : sans quitter la révision, le compte et son montant déjà là, ce qu'on
    // attend d'une pastille, la phrase proposée ; « Garder pour l'envoi groupé » la laisse prête, sans rien envoyer ──────
    // Le 471 n'est d'aucun cycle : il est dans le volet des comptes hors cycle.
    await menu('RV:471', 'Poser une question au client', '#rv-hors');
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Une question à Menuiserie Ben Salah');
    expect(await fenetre.locator('.qf-sujet b').innerText()).toMatch(/^Compte 471/);
    expect(await fenetre.locator('[data-qf-attendu][aria-pressed="true"]').innerText()).toBe('Une pièce justificative');
    expect(await fenetre.locator('#qf-texte').inputValue()).toMatch(/^Peux-tu m'envoyer la pièce justificative de ce montant de 1\s200,500\sDT, au compte 471/);
    // La phrase suit la pastille tant qu'on ne l'a pas réécrite ; réécrite, elle reste.
    await fenetre.locator('[data-qf-attendu="explication"]').click();
    expect(await fenetre.locator('#qf-texte').inputValue()).toMatch(/^Peux-tu m'expliquer ce montant de 1\s200,500\sDT, au compte 471/);
    await fenetre.locator('#qf-texte').fill('Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?');
    await fenetre.locator('[data-qf-attendu="piece"]').click();
    expect(await fenetre.locator('#qf-texte').inputValue()).toBe('Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?');
    expect(await fenetre.locator('.modal-actions button').allInnerTexts()).toEqual(['Annuler', 'Garder pour l\'envoi groupé', 'Envoyer maintenant']);
    await fenetre.locator('#qf-garder').click();
    await expect.poll(toast, APRES_LE_SERVEUR).toBe('Gardée : 1 question prête pour Menuiserie Ben Salah. Elle partira avec ton prochain message.');
    await expect.poll(async () => (await questions(associe)).map((q) => [q.statut, q.compte, q.attendu, q.objet.includes('471')])).toEqual([['ouverte', '471', 'piece', true]]);
    expect(await questions(client)).toEqual([]);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/1\squestion au client n.est pas encore partie : elle attend, prête, dans votre conversation/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-revision-1-question.png') });

    // ── L'envoyer d'ici, d'un clic : le client la lit ; sa réponse revient sur l'écran du cabinet ────────────────────────
    await expect.poll(() => p.locator('#rv-envoyer').innerText()).toBe('Envoyer la question prête');
    await p.locator('#rv-envoyer').click();
    await expect.poll(toast, APRES_LE_SERVEUR).toMatch(/^1\squestion envoyée à Menuiserie Ben Salah : sa réponse reviendra ici et dans votre conversation\.$/);
    const recue = await questions(client);
    expect(recue.map((q) => [q.statut, q.envois.length, q.texte])).toEqual([['envoyee', 1, 'Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?']]);
    // Plus rien de prêt : plus de bouton d'envoi.
    await expect.poll(() => p.locator('#rv-envoyer').count()).toBe(0);
    // (1.94.0) Une relance se fait un autre jour : partie aujourd'hui, la relancer le refuse, et le dit.
    await p.locator(`[data-rowmenu="QU:${String(recue[0]?.id)}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Relancer le client' }).click();
    await expect.poll(toast).toBe('Cette question est partie aujourd\'hui : une relance se fait un autre jour, pour laisser au client le temps de répondre.');
    expect((await questions(client)).map((q) => q.envois.length)).toEqual([1]);
    // « Envoyer maintenant » depuis la fenêtre : elle part tout de suite.
    await menu('RV:471', 'Poser une question au client', '#rv-hors');
    await fenetre.locator('#qf-texte').fill('Ce virement est-il bien un acompte ?');
    await fenetre.locator('[data-qf-attendu="confirmation"]').click();
    await fenetre.locator('#qf-envoyer').click();
    await expect.poll(toast, APRES_LE_SERVEUR).toMatch(/^1\squestion envoyée à Menuiserie Ben Salah/);
    expect((await questions(client)).map((q) => [q.texte, q.attendu, q.envois.length])).toEqual([
      ['Peux-tu m\'envoyer la facture de ce virement de 1 200,500 DT ?', 'piece', 1], ['Ce virement est-il bien un acompte ?', 'confirmation', 1]]);

    // ── Gardée, une question attend dans la conversation, au-dessus du champ, et part avec le prochain message ──────────
    expect((await api('POST', `/entreprises/${ent}/compta/questions`, associe, { periode: '2026-03', objet: 'Caisse', texte: 'Le fond de caisse est-il toujours de 200 DT ?' })).statut).toBe(201);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/messages/${ent}`);
    const pretes = p.locator('[data-msg-pretes]');
    await expect.poll(() => pretes.locator('.msg-pretes-tete').innerText().catch(() => ''), { timeout: 20_000 }).toMatch(/^1\squestion prête\s+part avec ce message, même sans texte$/);
    const envoyer = p.locator('[data-msg-envoyer]').first();
    expect(await envoyer.innerText()).toBe('Envoyer la question');
    // « Pas cette fois » la met de côté (elle reste prête) ; « La remettre » la reprend.
    await pretes.getByRole('button', { name: 'Pas cette fois' }).click();
    expect(await envoyer.innerText()).toBe('Envoyer');
    expect(await pretes.locator('.msg-pretes-tete').innerText()).toMatch(/aucune ne part avec ce message$/);
    await pretes.getByRole('button', { name: 'La remettre' }).click();
    await p.locator('[data-msg-texte]').first().fill('Bonjour, encore une question sur mars.');
    expect(await envoyer.innerText()).toBe('Envoyer + 1 question');
    await envoyer.click();
    await expect.poll(toast, APRES_LE_SERVEUR).toMatch(/^1\squestion envoyée à Menuiserie Ben Salah/);
    await expect.poll(() => pretes.isHidden()).toBe(true);
    expect((await questions(client)).map((q) => q.texte)).toContain('Le fond de caisse est-il toujours de 200 DT ?');
    // Le fil les range dans l'ordre : le message, puis la question.
    const fil = await p.locator('[data-msg-fil]').innerText();
    expect(fil.indexOf('Bonjour, encore une question sur mars.')).toBeGreaterThan(-1);
    expect(fil.indexOf('Le fond de caisse est-il toujours de 200 DT ?')).toBeGreaterThan(fil.indexOf('Bonjour, encore une question sur mars.'));
    await aller();
    expect((await api('POST', `/entreprises/${ent}/compta/questions/${recue[0]?.id}/repondre`, client, { texte: 'La facture est jointe à l\'achat du 9 mars.' })).statut).toBe(200);
    await p.reload();
    await expect.poll(() => p.locator('#rv-questions').innerText(), { timeout: 20_000 }).toMatch(/répondue\s+La facture est jointe à l'achat du 9 mars\./);
    // Fermée, elle se dit « close » (comme chez le client), sa réponse toujours dessous : la pastille restait « répondue »
    // (parcours du 21/10/2026).
    // (1.187.0) Sa ligne a deux gestes (la fermer, la voir dans la conversation) : ils sont dans son menu.
    await menu(`QU:${String(recue[0]?.id)}`, 'Fermer cette question');
    await expect.poll(() => p.locator('#rv-questions').innerText(), { timeout: 20_000 }).toMatch(/close\s+La facture est jointe à l'achat du 9 mars\./);

    // ── Arrêter la révision ─────────────────────────────────────────────────────────────────────
    await ouvrir('#rv-arreter', '#modal-root .modal');
    await fenetre.getByRole('button', { name: 'Arrêter la révision', exact: true }).click();
    await expect.poll(toast, APRES_LE_SERVEUR).toBe('Révision arrêtée.');
    expect(await revision()).toMatchObject({ faite: true, faitePar: 'associe' });
    expect((await revision())?.notes[0]?.levee).toBe(true);
    await expect.poll(() => p.locator('#rv-arretee').innerText()).toMatch(/par associe$/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-revision-2-arretee.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('(1.189.0) une question depuis une écriture du livre et depuis une ligne du relevé, sur place ; un dossier tenu n\'en a pas', async () => {
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Garage Triki' })).corps.id);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const od = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-03-18', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires du mois',
      lignes: [{ compte: '6226', debit: '300.125' }, { compte: '4286', credit: '300.125' }] })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [od] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'mars.csv', empreinte: 'a'.repeat(64),
      soldeDebut: '1000', soldeFin: '512.5', lignes: [{ date: '2026-03-14', libelle: 'VIR SARL ATLAS', reference: 'R9', montant: '-487.5' }] })).statut).toBe(201);
    const questions = async () => (await api('GET', `/entreprises/${ent}/compta/questions?annee=2026`, associe)).corps.questions as Question[];
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (h: string, qui = ent) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${qui}/comptabilite/${h}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const fenetre = p.locator('#modal-root .modal').last();
    const menu = async (prefixe: string, geste: string) => expect.poll(async () => {
      if (!await p.getByRole('menuitem').filter({ hasText: geste }).count()) await p.locator(`[data-rowmenu^="${prefixe}"]`).first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: geste }).count();
    }, { timeout: 20_000 }).toBe(1).then(() => p.getByRole('menuitem').filter({ hasText: geste }).click());

    // L'écriture du livre-journal : la fenêtre la nomme, sa phrase la cite ; gardée, elle porte l'écriture et sa période.
    await aller('journal/2026');
    await menu('E:', 'Poser une question au client');
    expect(await fenetre.locator('.qf-sujet b').innerText()).toBe('OD OD-1');
    expect(await fenetre.locator('#qf-texte').inputValue()).toMatch(/^Peux-tu m'envoyer la pièce justificative de l'écriture OD-1 du 18\/03\/2026 \(« Honoraires du mois »\), de 300,125\sDT \?$/);
    await fenetre.locator('#qf-garder').click();
    await expect.poll(async () => (await questions()).map((q) => [q.statut, q.piece, q.attendu]), { timeout: 15_000 }).toEqual([['ouverte', 'OD-1', 'piece']]);
    expect(p.url()).toContain('/comptabilite/journal');

    // La ligne du relevé qu'on ne sait pas expliquer : une explication demandée, envoyée tout de suite (avec la prête).
    await aller('banque');
    await menu('LIG:', 'Demander au client ce qu\'est cette ligne');
    expect(await fenetre.locator('.qf-sujet b').innerText()).toBe('VIR SARL ATLAS');
    expect(await fenetre.locator('[data-qf-attendu][aria-pressed="true"]').innerText()).toBe('Une explication');
    expect(await fenetre.locator('#qf-texte').inputValue()).toMatch(/^Peux-tu m'expliquer ce mouvement de 487,500\sDT sorti le 14\/03\/2026 sur ton relevé \(« VIR SARL ATLAS »\) \?$/);
    expect(await fenetre.locator('#qf-envoyer').innerText()).toBe('Envoyer les 2 maintenant');
    await fenetre.locator('#qf-envoyer').click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toMatch(/^2\squestions envoyées à Garage Triki/);
    const recues = (await api('GET', `/entreprises/${ent}/compta/questions?annee=2026`, client)).corps.questions as Question[];
    expect(recues.map((q) => [q.statut, q.attendu, q.objet, q.montant]).sort()).toEqual([['envoyee', 'explication', 'Relevé du 14/03/2026 : VIR SARL ATLAS', '487.500'], ['envoyee', 'piece', 'OD-1 du 18/03/2026', '300.125']]);
    // (1.206.0) Son montant la relie à sa ligne : la Banque la range « En attente du client », la question en face.
    await aller('banque');
    await expect.poll(() => p.locator('table.bq-t [data-bq-ligne]').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.groupe))).toEqual(['att']);
    await expect.poll(() => p.locator('.bq-livre').innerText()).toMatch(/Relevé du 14\/03\/2026 : VIR SARL ATLAS[\s\S]*Ouvrir la conversation/);

    // Un dossier tenu sans SkanFact n'a pas de conversation : ni la question d'une écriture, ni celle d'une ligne.
    const tenu = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Menuiserie du Sahel' })).corps.entreprise);
    const e2 = String((await api('POST', `/entreprises/${tenu}/compta/ecritures`, associe, { date: '2026-03-18', journal: 'OD', piece: 'OD-9', libelle: 'Loyer',
      lignes: [{ compte: '6132', debit: '500' }, { compte: '401', credit: '500' }] })).corps.id);
    expect((await api('POST', `/entreprises/${tenu}/compta/ecritures/valider`, associe, { ids: [e2] })).statut).toBe(200);
    // Créé après l'ouverture du Cabinet : la page se recharge pour le connaître.
    await p.goto('about:blank');
    await aller('journal/2026', tenu);
    await p.locator('[data-rowmenu^="E:"]').first().click({ timeout: 20_000 });
    await expect.poll(() => p.getByRole('menuitem').count()).toBeGreaterThan(0);
    expect(await p.getByRole('menuitem').filter({ hasText: 'Poser une question au client' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('(1.190.0) le questionnaire de fin d\'exercice part chez le client par la conversation, et sa réponse revient en face', async () => {
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Garage Triki' })).corps.id);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const od = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-03-18', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires du mois',
      lignes: [{ compte: '6226', debit: '300.125' }, { compte: '4286', credit: '300.125' }] })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [od] })).statut).toBe(200);
    // La méthode du cabinet : trois questions de fin d'exercice.
    const QUESTIONS = ['Un leasing ou un emprunt signé dans l\'année ?', 'Un litige en cours ?', 'Une caution donnée pour quelqu\'un ?'];
    const reg = (await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps as { contenu: Record<string, unknown>; revision: unknown };
    expect((await api('PUT', `/cabinets/${cabinet}/reglages`, associe, { contenu: { ...reg.contenu, questionnaire: QUESTIONS.map((question) => ({ question })) }, revision: reg.revision ?? null })).statut).toBe(200);
    const revision = async (qui = ent) => ((await api('GET', `/cabinets/${cabinet}/revisions/${qui}?annee=2026`, associe)).corps.revisions as Revision[]).find((x) => x.periode === '2026')?.contenu;
    const questions = async (jeton: string) => ((await api('GET', `/entreprises/${ent}/compta/questions?annee=2026`, jeton)).corps.questions as Question[])
      .filter((q) => q.objet === 'Questionnaire de fin d\'exercice');
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (qui = ent) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${qui}/comptabilite/revision/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const fenetre = p.locator('#modal-root .modal').last();
    const APRES = { timeout: 20_000 };

    // Posé sur l'exercice, il s'ouvre aussitôt pour partir : les questions cochées, ce qui part se compte sur le bouton.
    await aller();
    await expect.poll(() => p.locator('#rv-poser').count(), APRES).toBe(1);
    await p.locator('#rv-poser').click();
    await expect.poll(() => fenetre.locator('h2').innerText().catch(() => ''), APRES).toBe('Le questionnaire à Garage Triki');
    expect(await fenetre.locator('.qq-ligne').allInnerTexts()).toEqual(QUESTIONS);
    expect(await fenetre.locator('#qq-envoyer').innerText()).toBe('Envoyer les 3 maintenant');
    await fenetre.locator('[data-qq-part]').nth(2).uncheck();
    expect(await fenetre.locator('#qq-envoyer').innerText()).toBe('Envoyer les 2 maintenant');
    await fenetre.locator('#qq-envoyer').click();
    await expect.poll(() => p.locator('#toast').innerText(), APRES).toMatch(/^2\squestions envoyées à Garage Triki : ses réponses arriveront ici/);
    // Le client les lit, envoyées, une explication attendue chacune ; le questionnaire garde le lien vers chacune.
    const recues = await questions(client);
    expect(recues.map((q) => [q.statut, q.attendu, q.texte]).sort()).toEqual([['envoyee', 'explication', QUESTIONS[0]], ['envoyee', 'explication', QUESTIONS[1]]]);
    const qq = (await revision())?.questionnaire ?? [];
    expect(qq.map((q) => [q.question, recues.some((r) => r.id === q.demande)])).toEqual([[QUESTIONS[0], true], [QUESTIONS[1], true], [QUESTIONS[2], false]]);
    // La ligne dit « demandée » ; la question restée propose encore de partir, seule.
    await expect.poll(() => p.locator('#rv-questionnaire').innerText(), APRES).toMatch(/demandée/);
    expect(await p.locator('#rv-qq-demander').innerText()).toBe('Demander la réponse à Garage Triki');

    // Le client répond ; sa réponse arrive en face, et se reprend d'un clic.
    const leasing = recues.find((r) => r.texte === QUESTIONS[0]) as Question;
    expect((await api('POST', `/entreprises/${ent}/compta/questions/${leasing.id}/repondre`, client, { texte: 'Oui, un leasing de 36 mois pour la camionnette, signé en mars.' })).statut).toBe(200);
    // La même adresse ne recharge pas la page : on la quitte pour la relire.
    await p.goto('about:blank');
    await aller();
    await expect.poll(() => p.locator('#rv-questionnaire tr.qq-arrivee').innerText({ timeout: 2_000 }).catch(() => ''), APRES).toMatch(/Garage Triki a répondu\s+Oui, un leasing de 36 mois/);
    await p.locator('[data-qq-garder]').click();
    await expect.poll(async () => (await revision())?.questionnaire[0]?.reponse, APRES).toBe('Oui, un leasing de 36 mois pour la camionnette, signé en mars.');
    await expect.poll(() => p.locator('#rv-questionnaire').innerText(), APRES).toMatch(/la réponse de Garage Triki/);

    // Un dossier tenu sans SkanFact n'a pas de conversation : posé, le questionnaire se remplit à la main, rien ne part.
    const tenu = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Menuiserie du Sahel' })).corps.entreprise);
    const e2 = String((await api('POST', `/entreprises/${tenu}/compta/ecritures`, associe, { date: '2026-03-18', journal: 'OD', piece: 'OD-9', libelle: 'Loyer',
      lignes: [{ compte: '6132', debit: '500' }, { compte: '401', credit: '500' }] })).corps.id);
    expect((await api('POST', `/entreprises/${tenu}/compta/ecritures/valider`, associe, { ids: [e2] })).statut).toBe(200);
    await p.goto('about:blank');
    await aller(tenu);
    await expect.poll(() => p.locator('#rv-poser').count(), APRES).toBe(1);
    await p.locator('#rv-poser').click();
    await expect.poll(async () => (await revision(tenu))?.questionnaire.length, APRES).toBe(3);
    await expect.poll(() => p.locator('[data-qq]').count(), APRES).toBe(3);
    expect(await p.locator('#rv-qq-demander').count()).toBe(0);
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
