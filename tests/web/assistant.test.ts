// L'assistant de démarrage au nouveau style, à la souris (lot onboarding ; maquettes validées par Skander le 09/10/2026 ;
// docs/entree.md). La porte crée l'entreprise (« Ton entreprise », 1 sur 2), l'assistant prend la suite dans l'entreprise :
// « Où te joindre ? », puis le métier, la TVA et le menu. Ce que le parcours vérifie, écran ET dossier :
//   - chaque écran écrit son étape : la page rechargée reprend là où l'on s'était arrêté, avec ce qui était tapé ;
//   - la facture de l'aperçu est la vraie (le haut, le pied, les totaux et la mention du modèle de la v10) ;
//   - « Continuer » demande un métier (« Plus tard » passe) ; une adresse e-mail mal formée se refuse sur sa case ;
//   - le régime proposé par le métier ne s'impose plus dès qu'on en a choisi un ; le menu se range d'après le métier ;
//   - le catalogue de départ est celui du métier retenu à la fin, versé une fois ;
//   - revoir l'assistant n'écrit rien avant « Enregistrer mes réponses » ; « Fermer sans rien changer » ne change rien ;
//   - un membre de l'équipe ne le voit jamais ; une entreprise créée sans la porte s'ouvre sur son accueil ;
//   - au téléphone, aucun écran ne défile de côté et tout se touche du doigt ;
//   - ses polices sont celles de l'entrée, à l'octet près, et ses couleurs les mêmes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { problemes } from '../instrument-rendu.ts';
import { rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Un titre de l'entrée, tel que l'écran l'écrit (sa première lettre en capitale).
const titre = (cle: string) => { const s = rendre(t(cle), 'fr'); const i = s.search(/\p{L}/u); return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); };
// La typographie de l'écran : l'espace fine insécable avant « ? », « : », « » » (C.typoFr de la v10).
const fine = (s: string) => s.replace(/ ([?!;:»%])/g, ' $1').replace(/« /g, '« ');
// Les espaces d'un montant ou d'une phrase typographiée (les insécables comprises : `\s` les compte), ramenées à une
// espace ordinaire.
const net = (s: string) => s.replace(/\s+/g, ' ').trim();
type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };

describe('l\'assistant de démarrage, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-assistant-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
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
  // Le dernier code parti à cette adresse, lu dans l'objet de l'e-mail (« Ton code SkanFact : 482913 »).
  const codeRecu = (email: string) => /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
  // Une personne inscrite ; ce serveur envoie des e-mails : son adresse se vérifie par le code reçu.
  async function personne(nom: string) {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const defi = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi);
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeRecu(email) })).corps.jeton);
    return { email, jeton };
  }
  async function page(jeton: string, largeur = 1440, hauteur = 900) {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  }
  // La fiche de l'entreprise, telle que le serveur la garde.
  async function fiche(jeton: string, ent: string) {
    return ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
  }
  async function catalogue(jeton: string, ent: string) {
    return ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).filter((o) => o.collection === 'catalog').map((o) => o.contenu);
  }
  // L'assistant ouvert, sur l'écran qui porte ce titre.
  const assistant = (p: Page) => p.locator('#setup.as');
  const ecran = (p: Page, texte: string) => assistant(p).getByRole('heading', { level: 1, name: fine(texte), exact: true }).waitFor({ timeout: 15_000 });
  const suite = (p: Page) => assistant(p).locator('#as-suite');
  // La porte : « Commencer avec mon entreprise », sa raison sociale et son matricule, « Créer mon entreprise ».
  async function parLaPorte(p: Page, raison: string, matricule: string) {
    await p.goto(serveur.adresse);
    await p.getByRole('heading', { level: 1, name: titre('ecran.porte.titre') }).waitFor({ timeout: 15_000 });
    await p.getByRole('button', { name: titre('ecran.porte.demarrer_bouton'), exact: true }).click();
    const champ = (cle: string) => p.locator('label.field').filter({ hasText: titre(cle) }).locator('input');
    await champ('ecran.porte.raison').fill(raison);
    await champ('ecran.porte.matricule').fill(matricule);
    await p.getByRole('button', { name: titre('ecran.porte.creer') }).click();
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    return new URL(p.url()).searchParams.get('e') ?? '';
  }

  it('la porte, puis l\'assistant : chaque écran s\'écrit et se reprend, la facture de l\'aperçu est la vraie, et le métier retenu à la fin décide du catalogue', async () => {
    const { email, jeton } = await personne('amine');
    const { p, erreurs } = await page(jeton);
    // Un matricule à ce fichier seul : les tests partagent une base, et un matricule n'est celui que d'une entreprise
    // (tests/matricule-libre.ts ; vu sur GitHub le 09/10/2026, celui du parcours était déjà pris).
    const ent = await parLaPorte(p, 'Gharbi Informatique SARL', '4142136K/A/M/000');

    // 1. Où te joindre ? Le fil : ton compte fait, ton entreprise en cours. La fiche porte l'étape dès l'ouverture.
    await ecran(p, 'Où te joindre ?');
    expect(await assistant(p).locator('.as-fil li.fait:not(.trait)').allInnerTexts()).toEqual(['Ton compte']);
    expect(await assistant(p).locator('.as-fil li[aria-current=step]').innerText()).toContain('Ton entreprise');
    expect(await assistant(p).locator('.as-puce').innerText()).toBe('Ton entreprise · 2 sur 2');
    await expect.poll(async () => (await fiche(jeton, ent))?.contenu.setupStarted).toBe(true);
    expect((await fiche(jeton, ent))?.contenu.setupStep).toBe(0);
    // La facture de l'aperçu est la prochaine vraie : le nom, le matricule, le numéro qu'elle prendra.
    const coord = assistant(p).locator('#as-coord');
    expect(net(await coord.innerText())).toBe('Gharbi Informatique SARL MF 4142136K/A/M/000');
    expect(await assistant(p).locator('.as-quoi').innerText()).toMatch(/^FACTURE\nFAC-\d{4}-001$/);
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-1-coordonnees.png') });

    // Ce qui est tapé s'imprime pendant la frappe, là où la facture l'imprime : l'adresse, le téléphone (avec
    // l'indicatif), l'adresse du compte proposée d'un clic ; le registre et le capital au pied.
    await assistant(p).locator('textarea[name=address]').fill('12 rue de Marseille\n1000 Tunis');
    await assistant(p).locator('#as-tel').fill('55 123 456');
    const proposer = assistant(p).getByRole('button', { name: `Utiliser ${email}`, exact: true });
    await proposer.click();
    expect(await assistant(p).locator('#as-mail').inputValue()).toBe(email);
    expect(await proposer.isVisible()).toBe(false);
    await assistant(p).locator('#as-rc').fill('B0123452026');
    await assistant(p).locator('#as-cap').fill('10000');
    await expect.poll(async () => net(await coord.innerText()))
      .toBe(`Gharbi Informatique SARL 12 rue de Marseille 1000 Tunis MF 4142136K/A/M/000 +216 55 123 456 ${email}`);
    await expect.poll(async () => net(await assistant(p).locator('#as-pied-feuille').innerText()))
      .toBe('Gharbi Informatique SARL — Matricule fiscal 4142136K/A/M/000 — RC B0123452026 — Capital 10 000 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-2-coordonnees-remplies.png') });

    // Une adresse mal formée : refusée sur sa case, qui garde le curseur ; rien ne s'écrit, l'écran reste.
    await assistant(p).locator('#as-mail').fill('contact@');
    await suite(p).click();
    const refus = assistant(p).locator('#ch-email').getByRole('alert');
    expect(net(await refus.innerText())).toBe(net('Cette adresse n\'a pas la forme d\'une adresse e-mail (nom@domaine.tn) : corrige-la, ou laisse la case vide.'));
    expect(await assistant(p).locator('#as-mail').evaluate((e) => e === document.activeElement && e.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect((await fiche(jeton, ent))?.contenu.address ?? '').toBe('');
    await assistant(p).locator('#as-mail').fill(email);
    expect(await refus.count()).toBe(0);
    await suite(p).click();

    // 2. Que fais-tu ? L'écran d'avant est écrit ; la page rechargée reprend ici, et « Retour » retrouve ce qui était tapé.
    await ecran(p, 'Que fais-tu ?');
    await expect.poll(async () => (await fiche(jeton, ent))?.contenu.setupStep).toBe(1);
    expect((await fiche(jeton, ent))?.contenu).toMatchObject({ address: '12 rue de Marseille\n1000 Tunis', phone: '+216 55 123 456', email, rc: 'B0123452026', capital: '10000' });
    await p.reload();
    await ecran(p, 'Que fais-tu ?');
    await assistant(p).getByRole('button', { name: 'Retour', exact: true }).click();
    await ecran(p, 'Où te joindre ?');
    expect(await assistant(p).locator('textarea[name=address]').inputValue()).toBe('12 rue de Marseille\n1000 Tunis');
    expect(await assistant(p).locator('#as-tel').inputValue()).toBe('55 123 456');
    expect(await assistant(p).locator('#as-indicatif').isVisible()).toBe(true);
    await suite(p).click();
    await ecran(p, 'Que fais-tu ?');

    // « Continuer » sans métier : refusé en disant pourquoi et ce qui débloque ; l'étape n'avance pas.
    await suite(p).click();
    expect(net(await assistant(p).locator('#as-refus-metier').innerText()))
      .toBe(net('Choisis ton métier : il prépare ton catalogue et le nom de tes factures. Aucun ne correspond ? « Autre activité ». Pas encore décidé ? « Plus tard ».'));
    expect((await fiche(jeton, ent))?.contenu.setupStep).toBe(1);
    // Santé : ses trois articles, leurs prix d'exemple ; la note d'honoraires ; « Exonéré » proposé à l'écran suivant.
    await assistant(p).locator('.as-tuile').filter({ hasText: 'Santé et paramédical' }).click();
    expect(await assistant(p).getByRole('radio', { name: /^Santé et paramédical/ }).isChecked()).toBe(true);
    expect(await assistant(p).locator('#as-refus-metier').isVisible()).toBe(false);
    const bloc = assistant(p).locator('#as-catalogue');
    expect(net(await bloc.locator('.as-article').first().innerText())).toBe('Consultation 50,000 DT la séance');
    expect(await bloc.locator('.as-article').count()).toBe(3);
    expect(net(await bloc.locator('.as-info').allInnerTexts().then((x) => x.join(' | ')))).toBe(net(
      'Tes factures s\'appelleront « notes d\'honoraires », comme le veut ta profession. | À l\'écran suivant, « Exonéré » sera déjà choisi : c\'est souvent le cas de ton métier (À VÉRIFIER avec ton comptable).'));
    expect(await assistant(p).getByRole('checkbox', { name: 'Ajouter ces 3 articles à mon catalogue' }).isChecked()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-3-activite.png'), fullPage: true });
    await suite(p).click();

    // 3. Factures-tu la TVA ? Le régime proposé par le métier est coché ; le bas de la vraie facture n'a pas de colonne
    // TVA, et sa mention la remplace.
    await ecran(p, 'Factures-tu la TVA ?');
    expect(await assistant(p).getByRole('radio', { name: /^Non, mon activité est exonérée/ }).isChecked()).toBe(true);
    const apercu = assistant(p).locator('#as-apercu');
    expect(await assistant(p).locator('#as-mention').innerText()).toBe('TVA non applicable — activité exonérée');
    expect(await apercu.locator('.as-lignes .entete .nombres span').allInnerTexts()).toEqual(['TOTAL HT']);
    expect(net(await apercu.locator('.net').innerText())).toBe('NET À PAYER 51,000 DT');
    // Au réel : la colonne, la TVA de la ligne, et le net qui la compte (50,000 + 9,500 + 1,000 de timbre).
    await assistant(p).getByRole('radio', { name: /^Oui, je facture la TVA/ }).check();
    await expect.poll(() => apercu.locator('.as-lignes .entete .nombres span').allInnerTexts()).toEqual(['TVA', 'TOTAL HT']);
    expect(net(await apercu.locator('.as-totaux').innerText())).toBe('Total HT 50,000 TVA 9,500 Timbre fiscal 1,000 NET À PAYER 60,500 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-4-tva.png') });

    // Revenir changer de métier : le régime choisi à la main reste ; même la santé, reprise en passant, ne propose plus le
    // sien.
    await assistant(p).getByRole('button', { name: 'Retour', exact: true }).click();
    await ecran(p, 'Que fais-tu ?');
    await assistant(p).locator('.as-tuile').filter({ hasText: 'Informatique et cybersécurité' }).click();
    await assistant(p).locator('.as-tuile').filter({ hasText: 'Santé et paramédical' }).click();
    expect(net(await bloc.innerText())).toContain('notes d\'honoraires');
    expect(net(await bloc.innerText())).not.toContain('sera déjà choisi');
    await assistant(p).locator('.as-tuile').filter({ hasText: 'Informatique et cybersécurité' }).click();
    expect(await assistant(p).getByRole('checkbox', { name: 'Ajouter ces 5 articles à mon catalogue' }).isChecked()).toBe(true);
    await suite(p).click();
    await ecran(p, 'Factures-tu la TVA ?');
    expect(await assistant(p).getByRole('radio', { name: /^Oui, je facture la TVA/ }).isChecked()).toBe(true);
    expect(net(await apercu.locator('.as-lignes .ligne').innerText())).toBe('Audit de sécurité réseau 19% 1 200,000');
    expect(net(await apercu.locator('.net').innerText())).toBe('NET À PAYER 1 429,000 DT');
    await suite(p).click();

    // 4. De quoi as-tu besoin ? Les modules proposés pour le métier sont allumés ; le vrai menu se range pendant qu'on
    // choisit.
    await ecran(p, 'De quoi as-tu besoin ?');
    const interrupteur = (nom: string) => assistant(p).getByRole('switch', { name: new RegExp(`^${nom}`) });
    expect(await interrupteur('Achats et fournisseurs').isChecked()).toBe(true);
    expect(await interrupteur('Proforma, bons et contrats').isChecked()).toBe(true);
    expect(await interrupteur('Caisse').isChecked()).toBe(false);
    expect(await assistant(p).locator('.as-module .propose').count()).toBe(2);
    const menu = () => assistant(p).locator('#as-menu .page').allInnerTexts();
    expect(await menu()).toEqual(expect.arrayContaining(['Accueil', 'Factures', 'Achats', 'Proforma, bons et contrats', 'Comptabilité']));
    expect(await menu()).not.toContain('Caisse');
    // Vu sans y toucher, le menu ne s'écrit pas en route : une reprise le croirait choisi, et ne le rangerait plus
    // d'après le métier.
    await assistant(p).getByRole('button', { name: 'Retour', exact: true }).click();
    await ecran(p, 'Factures-tu la TVA ?');
    await expect.poll(async () => (await fiche(jeton, ent))?.contenu.setupStep).toBe(2);
    expect((await fiche(jeton, ent))?.contenu.modules ?? null).toBeNull();
    await suite(p).click();
    await ecran(p, 'De quoi as-tu besoin ?');
    await assistant(p).locator('.as-module').filter({ has: p.getByText('Caisse', { exact: true }) }).click();
    await expect.poll(menu).toContain('Caisse');
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-5-menu.png') });
    await suite(p).click();

    // L'entreprise s'ouvre : son menu est celui qu'on a vu ; la fiche, le régime, les modules et le catalogue du métier
    // RETENU (pas celui de la santé, cliqué d'abord) sont écrits, une fois.
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await assistant(p).count()).toBe(0);
    await expect.poll(() => p.locator('#toast').innerText()).toBe('C\'est prêt.');
    // La porte de l'entrée a déjà fait choisir entre l'exemple et l'entreprise : l'accueil ne repose pas la question.
    expect(await p.locator('#view .premiers-pas').count()).toBe(1);
    expect(await p.locator('#view .pp-accueil').count()).toBe(0);
    const routes = await p.locator('#nav a[data-route]').evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.route ?? ''));
    expect(routes).toEqual(expect.arrayContaining(['caisse', 'achats', 'autres', 'compta']));
    for (const x of ['paie', 'stock', 'immos']) expect(routes).not.toContain(x);
    const co = (await fiche(jeton, ent))?.contenu ?? {};
    expect(co).toMatchObject({ setupDone: true, activity: 'informatique', taxRegime: 'reel', defaultVatRate: 19, stampFee: 1,
      modules: ['ventes', 'fichiers', 'compta', 'achats', 'pieces', 'caisse'], tagline: 'Cybersécurité · Infrastructure · Services informatiques' });
    expect(co.setupStarted).toBeUndefined();
    const cat = await catalogue(jeton, ent);
    expect(cat.map((c) => c.label)).toEqual(['Audit de sécurité réseau', 'Maintenance et supervision', 'Installation poste de travail', 'Sauvegarde externalisée', 'Déplacement']);
    expect(cat.every((c) => c.vatRate === 19 && c.fromSetup === true)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'assistant-6-ouverte.png') });
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 180_000);

  it('revoir l\'assistant : ses réponses y sont, rien ne s\'écrit avant la fin, et « Fermer sans rien changer » ne change rien', async () => {
    const { jeton } = await personne('sami');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Sami' })).corps.id);
    const f = await fiche(jeton, ent);
    const depart = { ...f?.contenu, setupDone: true, address: 'Rue de Rome\n1000 Tunis', phone: '+216 71 000 111', activity: 'commerce', taxRegime: 'forfaitaire',
      modules: ['ventes', 'fichiers', 'compta', 'stock'] };
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: f?.revision ?? null, contenu: depart },
      { collection: 'catalog', cle: 'a1', rang: 0, revision: null, contenu: { id: 'a1', label: 'Huile d\'olive 1 L', unitPrice: { '~n': '14.5' }, vatRate: 0, unit: 'u' } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const { p, erreurs } = await page(jeton);
    const ouvrirLeRejeu = async () => {
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await p.locator('#set-tabs [data-tab=app]').click();
      await p.locator('#redo-setup').click();
      await p.locator('.modal').getByRole('button', { name: 'Revoir l\'assistant', exact: true }).click();
      await ecran(p, 'Où te joindre ?');
    };
    await ouvrirLeRejeu();
    expect(await assistant(p).locator('textarea[name=address]').inputValue()).toBe('Rue de Rome\n1000 Tunis');
    expect(await assistant(p).locator('#as-tel').inputValue()).toBe('71 000 111');
    // Le geste qui sort le dit avant d'être cliqué : rien n'est enregistré.
    expect(await assistant(p).locator('#as-sortir').innerText()).toBe('Fermer sans rien changer');
    await assistant(p).locator('#as-tel').fill('71 222 333');
    await suite(p).click();
    await ecran(p, 'Que fais-tu ?');
    expect(await assistant(p).getByRole('radio', { name: /^Commerce et vente de produits/ }).isChecked()).toBe(true);
    // Le catalogue existe : l'assistant ne le remplit pas une seconde fois.
    expect(net(await assistant(p).locator('#as-catalogue').innerText())).toContain('Ton catalogue a déjà 1 article : il ne change pas.');
    expect(await assistant(p).locator('#as-remplir').count()).toBe(0);
    // Rien d'écrit en route.
    expect((await fiche(jeton, ent))?.contenu).toMatchObject({ phone: '+216 71 000 111' });
    await assistant(p).locator('#as-sortir').click();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await assistant(p).count()).toBe(0);
    expect((await fiche(jeton, ent))?.contenu).toMatchObject({ phone: '+216 71 000 111', taxRegime: 'forfaitaire' });

    // Revu jusqu'au bout : le régime réglé à la main reste (le métier n'en propose pas d'autre), le téléphone changé
    // s'enregistre, le menu choisi aussi ; le catalogue reste le sien.
    await ouvrirLeRejeu();
    await assistant(p).locator('#as-tel').fill('71 222 333');
    await suite(p).click();
    await ecran(p, 'Que fais-tu ?');
    await suite(p).click();
    await ecran(p, 'Factures-tu la TVA ?');
    expect(await assistant(p).getByRole('radio', { name: /^Non, je suis au forfait/ }).isChecked()).toBe(true);
    await suite(p).click();
    await ecran(p, 'De quoi as-tu besoin ?');
    expect(await assistant(p).getByRole('switch', { name: /^Stock et garanties/ }).isChecked()).toBe(true);
    expect(await assistant(p).getByRole('switch', { name: /^Caisse/ }).isChecked()).toBe(false);
    await assistant(p).getByRole('button', { name: 'Enregistrer mes réponses', exact: true }).click();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await expect.poll(async () => (await fiche(jeton, ent))?.contenu.phone).toBe('+216 71 222 333');
    expect((await fiche(jeton, ent))?.contenu).toMatchObject({ taxRegime: 'forfaitaire', activity: 'commerce', modules: ['ventes', 'fichiers', 'compta', 'stock'], setupDone: true });
    expect((await catalogue(jeton, ent)).map((c) => c.label)).toEqual(['Huile d\'olive 1 L']);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('l\'assistant est au propriétaire : un membre de l\'équipe ne le voit jamais ; une entreprise créée sans la porte s\'ouvre sur son accueil', async () => {
    const nadia = await personne('nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    const ouvrir = async (jeton: string) => {
      const { p, erreurs } = await page(jeton);
      await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
      await p.locator('#view h1, #setup.as h1').first().waitFor({ timeout: 20_000 });
      return { p, erreurs };
    };
    // Créée par l'API, sans la porte : l'accueil, pas l'assistant.
    const a = await ouvrir(nadia.jeton);
    expect(await assistant(a.p).count()).toBe(0);
    expect(await a.p.locator('#view h1').first().innerText()).toBe('Accueil');
    expect(a.erreurs).toEqual([]);
    await a.p.context().close();

    // L'assistant commencé (l'étape 1 atteinte) : la propriétaire le retrouve là ; Karim, commercial, ouvre l'accueil.
    const f = await fiche(nadia.jeton, ent);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: f?.revision ?? null, contenu: { ...f?.contenu, setupStarted: true, setupStep: 1 } },
    ] })).statut).toBe(200);
    const karim = await personne('karim');
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim.jeton, { jeton: inv })).statut).toBe(200);
    const k = await ouvrir(karim.jeton);
    expect(await assistant(k.p).count()).toBe(0);
    expect(await k.p.locator('#view h1').first().innerText()).toBe('Accueil');
    expect(k.erreurs).toEqual([]);
    await k.p.context().close();
    const n = await ouvrir(nadia.jeton);
    await ecran(n.p, 'Que fais-tu ?');
    await n.p.context().close();
  }, 120_000);

  it('au téléphone : aucun écran de l\'assistant ne défile de côté, tout se touche du doigt, et « Plus tard » mène au bout', async () => {
    const { jeton } = await personne('rania');
    const { p, erreurs } = await page(jeton, 390, 844);
    await parLaPorte(p, 'Rania Chebbi', '');
    const verifier = async (nom: string) => {
      const pb = await p.evaluate(problemes, [true, 390] as [boolean, number]);
      expect(pb, nom).toEqual([]);
      // La gouttière de l'entrée, 16 points, et pas un rembourrage de plus (celui de la page ouverte, dans la v10).
      expect(await assistant(p).locator('h1').evaluate((h) => Math.round(h.getBoundingClientRect().left)), nom).toBe(16);
      await p.screenshot({ path: path.join(PHOTOS, `assistant-telephone-${nom}.png`), fullPage: true });
    };
    await ecran(p, 'Où te joindre ?');
    await verifier('coordonnees');
    await assistant(p).getByRole('button', { name: 'Je le ferai plus tard', exact: true }).click();
    await ecran(p, 'Que fais-tu ?');
    // Deux métiers par ligne ; l'icône passe au-dessus du nom, qui garde la largeur de sa tuile (vu à la souris : à côté
    // de l'icône, « Informatique et cybersécurité » s'écrasait sur quatre lignes).
    const tuiles = await assistant(p).locator('.as-tuile').evaluateAll((ts) => ts.slice(0, 2).map((x) => Math.round(x.getBoundingClientRect().top)));
    expect(tuiles[0]).toBe(tuiles[1]);
    expect(await assistant(p).locator('.as-tuile').evaluateAll((ts) => ts.filter((x) => {
      const ico = (x.querySelector('.ico') as HTMLElement).getBoundingClientRect();
      const txt = (x.querySelector('.txt') as HTMLElement).getBoundingClientRect();
      return Math.abs(txt.left - ico.left) > 1 || txt.top < ico.bottom;
    }).map((x) => x.textContent?.trim()))).toEqual([]);
    await verifier('activite');
    await assistant(p).getByRole('button', { name: 'Plus tard', exact: true }).click();
    await ecran(p, 'Factures-tu la TVA ?');
    await verifier('tva');
    await suite(p).click();
    await ecran(p, 'De quoi as-tu besoin ?');
    await verifier('menu');
    await suite(p).click();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('ses polices sont celles de l\'entrée, à l\'octet près, servies comme des polices ; ses couleurs sont les mêmes', async () => {
    const polices: Record<string, string> = {
      'bricolage-grotesque-latin-wght-normal.woff2': 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
      'instrument-sans-latin-wght-normal.woff2': 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
      'ibm-plex-mono-latin-500-normal.woff2': 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
    };
    for (const [nom, source] of Object.entries(polices)) {
      expect(fs.readFileSync(path.join(RACINE, 'web/public/plateforme/polices', nom)).equals(fs.readFileSync(path.join(RACINE, source))), nom).toBe(true);
      const r = await fetch(`${serveur.adresse}/plateforme/polices/${nom}`);
      expect(r.headers.get('content-type'), nom).toBe('font/woff2');
    }
    // Les couleurs de l'entrée (web/src/entree.css) et de l'assistant, en clair et en sombre : les mêmes, une à une.
    const couleurs = (css: string, bloc: string) => {
      const i = css.indexOf(`${bloc} {`);
      const corps = css.slice(i, css.indexOf('}', i));
      return Object.fromEntries([...corps.matchAll(/(--e-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], (m[2] ?? '').trim()]));
    };
    const entree = fs.readFileSync(path.join(RACINE, 'web/src/entree.css'), 'utf8');
    const assist = fs.readFileSync(path.join(RACINE, 'web/public/plateforme/assistant.css'), 'utf8');
    const clair = couleurs(entree, '.ent');
    expect(Object.keys(clair).length).toBeGreaterThan(20);
    expect(couleurs(assist, '#setup.as')).toEqual(clair);
    const sombre = couleurs(entree, 'body.dark .ent');
    expect(Object.keys(sombre).length).toBeGreaterThan(10);
    expect(couleurs(assist, 'body.dark #setup.as')).toEqual(sombre);
  });
});
