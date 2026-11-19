// (1.371.0) Le premier jour d'un comptable dont aucun client n'est sur SkanFact : il ajoute un client, et tout ce qu'il
// tenait ailleurs doit entrer sans ressaisie. Le parcours vérifie, écran ET livres :
//   - à la création, SkanFact demande « à partir de quand tiens-tu ce dossier ? » : sans réponse, toute l'année se
//     comptait « à saisir » (dix mois en rouge pour un client créé il y a une minute) ; « Plus tard » reste possible,
//     et la fiche comme « À voir » portent alors la question ;
//   - une liste de clients collée pose la question UNE fois pour tous ;
//   - la fiche d'un client aux livres vides dit par où commencer : le livre d'abord (seul bouton), puis les reprises,
//     qui se cochent à mesure ;
//   - une liste de salariés et un tableau d'immobilisations se collent depuis un tableur : on voit ce qui entrera, une
//     ligne illisible est refusée et nommée, les autres entrent ;
//   - « Exporter le lettrage » exporte le compte montré, pas tout le grand livre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le premier jour d\'un client tenu au cabinet (1.371.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-jour1-'));
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
  it('un client créé demande son début de mission, sa fiche dit par où commencer, ses salariés et ses biens se collent', async () => {
    const associe = await personne('Sami');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Gharbi' })).corps.id);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    const plusTard = async () => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click(); };
    const mois = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', month: 'long', year: 'numeric' });
    const annee = Number(new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Tunis' }).slice(0, 4));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#new-d').waitFor({ timeout: 30_000 });
    await plusTard();

    // Un client, sans début de mission : la question vient tout de suite, avec ses trois cas.
    await p.locator('#new-d').click();
    await p.locator('#f-name').fill('Atelier Zitouna');
    await p.getByRole('button', { name: 'Créer le dossier', exact: true }).click();
    const q = p.locator('.modal').filter({ hasText: 'À partir de quand tiens-tu Atelier Zitouna ?' });
    await q.waitFor({ timeout: 20_000 });
    expect(net(await q.innerText())).toContain('rien n\'est compté avant');
    expect(await q.locator('[data-dm]').count()).toBeGreaterThanOrEqual(2);
    await q.locator('[data-dm]').first().click();
    expect(net(await q.locator('#ok').innerText())).toBe(`Commencer en ${mois}`);
    await q.locator('#ok').click();
    await q.waitFor({ state: 'detached', timeout: 20_000 });
    const idZ = decodeURIComponent((await p.evaluate(() => location.hash)).replace('#/dossier/', ''));

    // Sa fiche : aucun mois réclamé avant la mission, et « Par où commencer », le livre d'abord (le seul bouton vert).
    const debuter = p.locator('.fd-debuter');
    await debuter.waitFor({ timeout: 30_000 });
    const fiche = net(await p.locator('#view').innerText());
    expect(fiche).toContain('Par où commencer avec Atelier Zitouna');
    expect(fiche).toContain('avant la mission');
    expect(fiche).not.toContain('à saisir');
    expect(fiche).not.toContain('Début de mission à préciser');
    // La prochaine déclaration est celle du premier mois de la mission, pas celle du mois d'avant (celle du prédécesseur).
    expect(fiche).toContain(`La prochaine : ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', month: 'long' })},`);
    expect(net(await debuter.locator('a.btn').allInnerTexts().then((t) => t.join(' | ')))).toBe('Commencer son livre…');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-jour1-0-par-ou-commencer.png') });

    // Le livre : son titre s'élide (« d'Atelier »), et se crée vide pour un client qui démarre.
    await debuter.getByText('Commencer son livre…', { exact: true }).click();
    await p.locator('#lv-reprendre').click();
    const livre = p.locator('.modal').filter({ hasText: 'Commencer le livre' });
    await livre.waitFor({ timeout: 20_000 });
    expect(net(await livre.locator('h2').innerText())).toBe('Commencer le livre d\'Atelier Zitouna');
    await livre.getByRole('button', { name: 'Créer le livre', exact: true }).click();
    await livre.waitFor({ state: 'detached', timeout: 30_000 });

    // Une liste de salariés collée depuis un tableur : titres dans le désordre, une colonne inconnue, un brut illisible, un
    // n° CNSS mal écrit (le salarié entre sans numéro), une embauche absente (posée au 1er janvier, dite « à préciser »).
    const base = `#/dossier/${encodeURIComponent(idZ)}/comptabilite`;
    await p.evaluate((h) => { location.hash = h; }, `${base}/paie`);
    await p.locator('#pa-salarie, #pa-salarie2').locator('visible=true').first().click();
    await p.locator('#sf-coller').click();
    await p.locator('#ct-liste').fill(['Poste\tNom et prénom\tN° CNSS\tType de contrat\tSalaire brut\tDate d\'embauche\tEnfants\tAdresse',
      'Menuisier\tAmine Ben Salah\t12345678-90\tCDI\t1250,500\t01/03/2022\t2\tTunis', 'Secrétaire\tSonia Khelifi\t\tCDD\t900\t15/09/2024\t0\tAriana',
      'Apprenti\tKarim Jaziri\t1234-5\tSIVP\t650,000\t\t\tSfax', '\tLigne Fausse\t\t\tabc\t\t\t'].join('\n'));
    const bilan = p.locator('#ct-bilan');
    await expect.poll(async () => net(await bilan.innerText()), { timeout: 10_000 }).toContain('3 salariés entreront');
    const dit = net(await p.locator('#ct-apercu').innerText());
    expect(dit).toContain('1 ligne refusée : ligne 5 (Ligne Fausse), le salaire brut « abc » ne se lit pas');
    expect(dit).toContain('1 colonne laissée de côté : Adresse');
    expect(dit).toContain('« 1234-5 » illisible : laissé vide');
    expect(dit).toContain(`01/01/${annee} (à préciser)`);
    expect(dit).toContain('1 250,500');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-jour1-1-salaries-colles.png') });
    await p.locator('.modal #ok').click();
    await expect.poll(async () => net(await p.locator('#toast, .toast').first().innerText().catch(() => '')), { timeout: 60_000 }).toContain('3 salariés ajoutés');
    const salaries = await p.evaluate(async ([d, a]) => (await (window as unknown as { cabinet: { livre: (d: string, a: number) => Promise<{ livre: { salaries: { nom: string; brut: number; cnss: string; contrat: string; embauche: string; enfants: number }[] } }> } }).cabinet.livre(String(d), Number(a))).livre.salaries, [idZ, annee] as const);
    expect(salaries.map((s) => `${s.nom}|${s.brut}|${s.cnss}|${s.contrat}|${s.embauche}|${s.enfants}`).sort()).toEqual([
      'Amine Ben Salah|1250.5|12345678-90|cdi|2022-03-01|2', `Karim Jaziri|650||sivp|${annee}-01-01|0`, 'Sonia Khelifi|900||cdd|2024-09-15|0']);

    // Le tableau des immobilisations : la durée se déduit du taux, une famille reconnue propose la sienne, une date absente refuse.
    await p.evaluate((h) => { location.hash = h; }, `${base}/immobilisations`);
    await p.getByRole('button', { name: 'Ajouter un bien…', exact: true }).first().click();
    // (1.387.20, issue 10, CABPAIE-25) Le taux dégressif, obligatoire, porte son étoile ; la note dit quoi faire, sans note de travail.
    expect(await p.locator('#im-taux-l').getAttribute('class')).toContain('obligatoire');
    expect(net(await p.locator('#im-degr-n').textContent() ?? '')).toMatch(/^Saisis le taux dégressif/);
    expect(net(await p.locator('#im-degr-n').textContent() ?? '')).not.toMatch(/personne ne l|nul n'a dit/);
    await p.locator('#im-coller').click();
    await p.locator('#ct-liste').fill(['Désignation\tDate de mise en service\tValeur d\'acquisition HT\tTaux\tDurée\tCompte\tFournisseur',
      'Scie à format\t15/03/2023\t18500,000\t10 %\t\t2231\tSCM', 'Camionnette Partner\t01/06/2024\t62000\t20%\t\t\tStafim',
      `Ordinateur portable\t10/01/${annee}\t2400,000\t\t3\t\tMytek`, 'Matériel de bureau divers\t01/02/2025\t1500\t\t\t\t', 'Enseigne\t\t900\t10%\t\t\t'].join('\n'));
    await expect.poll(async () => net(await bilan.innerText()), { timeout: 10_000 }).toContain('4 biens entreront');
    const ditB = net(await p.locator('#ct-apercu').innerText());
    expect(ditB).toContain('1 ligne refusée : ligne 6 (Enseigne), la date de mise en service manque');
    expect(ditB).toContain('Scie à format 15/03/2023 10 ans 2231 18 500,000');
    expect(ditB).toContain('Matériel de bureau divers 01/02/2025 5 ans (proposée)');
    await p.locator('.modal #ok').click();
    await expect.poll(async () => net(await p.locator('#toast, .toast').first().innerText().catch(() => '')), { timeout: 60_000 }).toContain('4 biens ajoutés');
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 30_000 }).toContain('Scie à format');
    const biens = await p.evaluate(async ([d, a]) => (await (window as unknown as { cabinet: { livre: (d: string, a: number) => Promise<{ livre: { immobilisations: { libelle: string; duree: number; valeur: number; compte: string }[] } }> } }).cabinet.livre(String(d), Number(a))).livre.immobilisations, [idZ, annee] as const);
    expect(biens.map((b) => `${b.libelle}|${b.duree}|${b.valeur}|${b.compte}`).sort()).toEqual([
      'Camionnette Partner|5|62000|22', 'Matériel de bureau divers|5|1500|2282', 'Ordinateur portable|3|2400|22', 'Scie à format|10|18500|2231']);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-jour1-2-biens-colles.png') });

    // Ses soldes, repris APRÈS coup sur le livre déjà commencé : l'écran Exercice l'offre en tête, la fenêtre dit « Reprendre
    // ces soldes », et le serveur l'accepte tant que l'exercice n'a aucune ouverture (0215).
    await p.evaluate((h) => { location.hash = h; }, `${base}/exercice`);
    const reprise = p.locator('.modal').filter({ hasText: 'Reprendre les soldes d\'ouverture d\'Atelier Zitouna' });
    // L'écran Exercice se redessine quand le livre arrive : un clic tombé sur le bouton d'avant (sans son geste) ne fait rien.
    // Sur une machine chargée, on reclique tant que la fenêtre ne s'ouvre pas (rouge GitHub de 43704f50).
    await expect.poll(async () => {
      if (!await reprise.count()) await p.locator('#cl-reprise-haut').click({ timeout: 5_000 }).catch(() => {});
      return reprise.count();
    }, { timeout: 60_000, interval: 1_000 }).toBe(1);
    const cellule = (l: number, c: number) => reprise.locator(`tbody tr:nth-child(${l}) td:nth-child(${c}) input`).first();
    await cellule(1, 1).fill('411'); await cellule(1, 2).fill('Client Alpha'); await cellule(1, 3).fill('1 000,000');
    await reprise.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
    await cellule(2, 1).fill('101'); await cellule(2, 2).fill('Capital social'); await cellule(2, 4).fill('1000');
    await reprise.getByRole('button', { name: 'Reprendre ces soldes', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#toast, .toast').first().innerText().catch(() => '')), { timeout: 30_000 }).toContain(`Soldes d'ouverture de ${annee} repris`);
    // Le lettrage : son export porte le 411, pas le capital.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${base}/lettrage`);
    await p.reload();
    const exp = p.getByRole('button', { name: 'Exporter le lettrage', exact: true });
    await exp.waitFor({ timeout: 30_000 });
    const [fichier] = await Promise.all([p.waitForEvent('download'), exp.click()]);
    expect(fichier.suggestedFilename()).toMatch(/^lettrage-411-/);
    const csv = fs.readFileSync(await fichier.path(), 'utf8');
    expect(csv).toContain(';411;');
    expect(csv).not.toContain(';101;');

    // La fiche coche ce qui est repris, et n'offre plus « Commencer son livre ».
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${encodeURIComponent(idZ)}`);
    await p.reload();
    await debuter.waitFor({ timeout: 30_000 });
    await plusTard();
    const apres = net(await debuter.innerText());
    expect(apres).toContain('Ses soldes d\'ouverture sont repris');
    expect(apres).toContain('3 salariés au dossier');
    expect(apres).toContain('4 biens au tableau');
    expect(apres).not.toContain('Commencer son livre');

    // « Plus tard » : la fiche et « À voir » portent la question, et disent ce que le silence coûte.
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.locator('#new-d').click();
    await p.locator('#f-name').fill('Salon Jasmin');
    await p.getByRole('button', { name: 'Créer le dossier', exact: true }).click();
    const q2 = p.locator('.modal').filter({ hasText: 'À partir de quand tiens-tu Salon Jasmin ?' });
    await q2.waitFor({ timeout: 20_000 });
    await q2.getByRole('button', { name: 'Plus tard', exact: true }).click();
    const band = p.locator('.fd-debut');
    // Tout de suite : c'est « Plus tard » qui redessine la fiche. En trente secondes, un rafraîchissement de fond la
    // redessinait aussi, et la preuve de ce geste restait verte sur une machine lente (rouge GitHub de c6c7ce2).
    await band.waitFor({ timeout: 4_000 });
    expect(net(await band.innerText())).toContain('Tant que ce n\'est pas dit, toute l\'année est comptée à saisir');
    await band.locator('#fd-debut').click();
    await p.locator('.modal').filter({ hasText: 'À partir de quand tiens-tu Salon Jasmin ?' }).waitFor({ timeout: 10_000 });
    await p.locator('.modal #dm-non').click();

    // Une liste de clients collée : la question, une fois, pour tous.
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.locator('#new-d').click();
    await p.locator('#nd-coller').click();
    await p.locator('#cl-liste').fill('Pharmacie Ennasr\nLibrairie Carthage\nGarage Sfaxien');
    await p.locator('.modal #ok').click();
    const q3 = p.locator('.modal').filter({ hasText: 'À partir de quand tiens-tu ces 3 dossiers ?' });
    await q3.waitFor({ timeout: 30_000 });
    await q3.locator('[data-dm]').first().click();
    await q3.locator('#ok').click();
    await q3.waitFor({ state: 'detached', timeout: 30_000 });
    const etat = await p.evaluate(async () => (await (window as unknown as { cabinet: { state: () => Promise<{ dossiers: { name: string; from: string }[] }> } }).cabinet.state()).dossiers.map((d) => `${d.name}|${d.from ? 'dit' : 'à préciser'}`).sort());
    expect(etat).toEqual(['Atelier Zitouna|dit', 'Garage Sfaxien|dit', 'Librairie Carthage|dit', 'Pharmacie Ennasr|dit', 'Salon Jasmin|à préciser']);
    // Quatre clients de plus, « Plus tard » : avec Salon Jasmin, cinq attendent, et « À voir » n'en fait qu'une ligne.
    await p.locator('#new-d').click();
    await p.locator('#nd-coller').click();
    await p.locator('#cl-liste').fill('Café El Medina\nQuincaillerie Ben Salah\nHammam Essalem\nPressing Le Lac');
    await p.locator('.modal #ok').click();
    const q4 = p.locator('.modal').filter({ hasText: 'À partir de quand tiens-tu ces 4 dossiers ?' });
    await q4.waitFor({ timeout: 30_000 });
    await q4.locator('#dm-non').click();
    await p.evaluate(() => { location.hash = '#/production'; });
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 30_000 }).toContain('5 dossiers : début de mission à préciser');
    expect(net(await p.locator('#view').innerText())).toContain('sans réponse, toute l\'année est comptée à saisir');
    expect(erreurs).toEqual([]);
  }, 240_000);
});
