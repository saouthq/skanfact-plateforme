// Le Tableau de bord du Cabinet, Priorités comprises (1.194.0 ; maquette docs/maquettes/cabinet/tableau-de-bord.html),
// à la souris. Skander, 30/10/2026 : « on va fusionner Priorités et Tableau de bord et on va appliquer la maquette ».
// Ce que le parcours vérifie :
//   - une seule entrée dans la barre, qui porte le chiffre rouge des urgents ; l'ancien lien des Priorités y mène ;
//   - « À faire maintenant » d'abord, « À voir » replié derrière son nombre ;
//   - la campagne du mois : un anneau, cinq étapes ; un clic sur une étape ne garde que ses dossiers dans la grille ;
//   - le choix d'une personne vaut pour toute la page (la grille, « À faire ») ;
//   - la recherche vide le dit, avec « Effacer la recherche » ; le menu ⋯ d'une ligne mène à sa fiche ;
//   - au téléphone, rien ne déborde de la page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Tableau de bord du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-tb-'));
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
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, email };
  };
  // Le dernier mois fini (celui de la campagne) : le mois en cours n'entre jamais dans la grille.
  const moisAvant = (() => { const d = new Date(); const a = d.getUTCFullYear(), m = d.getUTCMonth() - 1; return m <= 0 ? `${a - 1}-${String(12 + m).padStart(2, '0')}` : `${a}-${String(m).padStart(2, '0')}`; })();
  const moisFini = (() => { const d = new Date(); const a = d.getUTCFullYear(), m = d.getUTCMonth(); return m === 0 ? `${a - 1}-12` : `${a}-${String(m).padStart(2, '0')}`; })();

  // Un cabinet de deux personnes (Leïla, associée ; Rim, saisie) et trois clients sur SkanFact : la menuiserie confiée à
  // Rim, les deux autres à personne. Le garage a déposé la déclaration du mois fini.
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const rim = await personne('Rim Toumi');
    const inv = (await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: rim.email, role: 'saisie' })).corps as { jeton: string };
    expect((await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.jeton })).statut).toBe(200);
    const client = async (nom: string, gerant: string, contact: string, depuis = moisFini, regime = '') => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${moisFini}-14`, journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
        lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] })).statut).toBe(201);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact, forme: 'SARL', from: depuis, ...(regime ? { regime } : {}) }, revision: null })).statut).toBeLessThan(300);
      return { ent, mandat };
    };
    // La librairie est tenue depuis le mois d'avant, sans rien écrit : un mois sans écriture, urgent.
    const librairie = await client('Librairie Ennour', 'Amel Nouri', 'Amel', moisAvant, 'is');
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', 'Hédi');
    const garage = await client('Garage Triki', 'Sami Triki', 'Sami');
    expect((await api('PUT', `/entreprises/${garage.ent}/compta/declarations/${moisFini}`, associe, { cases: { tvaCollectee: '19,024' } })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${garage.ent}/compta/declarations/${moisFini}/pointer`, associe, { quoi: 'deposee', le: `${moisFini}-28` })).statut).toBe(200);
    // La menuiserie est confiée à Rim (sa saisie).
    const eq = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps as { membres: { membre: string; nom: string }[] };
    const membreRim = eq.membres.find((m) => m.nom === 'Rim Toumi')?.membre;
    expect(membreRim).toBeTruthy();
    expect((await api('PUT', `/cabinets/${cab.id}/mandats/${menuiserie.mandat}/affectations/${membreRim}`, associe, { role: 'saisie' })).statut).toBeLessThan(300);
    return { associe, cab, librairie, menuiserie, garage };
  }
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  };

  it('une page : À faire, la campagne du mois, la grille, la charge ; une personne vaut pour toute la page', async () => {
    const { associe, cab, menuiserie } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // L'ancien lien des Priorités mène au Tableau de bord ; la barre n'a plus qu'une entrée, avec le chiffre des urgents.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/priorites`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(p.url()).toMatch(/#\/production$/);
    expect(await p.locator('#page-bord h1').innerText()).toMatch(/^Tableau de bord/);
    const routes = await p.locator('#nav .nav-quotidien > a.lien').evaluateAll((l) => l.map((a) => (a as HTMLElement).dataset.route));
    expect(routes).toEqual(['production', 'pieces', 'echeances', 'messages']);
    const urgents = await p.locator('#tb-afaire [data-priorite^="u:"]').count();
    expect(await p.locator('#nav-production').innerText()).toBe(urgents ? String(urgents) : '');

    // Le travail de qui : tout le cabinet, puis chacun avec les dossiers qu'il suit (rien n'est confié à Leïla).
    expect((await p.locator('.tb-qui [data-tb-qui]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))).toEqual(['Tout le cabinet', 'Leïla 0', 'Rim 1']);
    expect(await p.locator('.tb-qui [data-tb-qui=""]').getAttribute('aria-pressed')).toBe('true');

    // « À voir » se replie derrière son nombre quand il y a de l'urgent, et se déplie d'un clic.
    expect(urgents).toBeGreaterThan(0);
    expect(await p.locator('#tb-afaire .afaire-ligne').filter({ hasText: 'Librairie Ennour' }).innerText()).toMatch(/1 mois sans écriture/);
    const avoir = p.locator('#tb-avoir');
    expect(await avoir.getAttribute('aria-expanded')).toBe('false');
    expect(await p.locator('#tb-afaire [data-priorite^="v:"]').count()).toBe(0);
    await avoir.click();
    expect(await p.locator('#tb-avoir').getAttribute('aria-expanded')).toBe('true');
    expect(await p.locator('#tb-afaire [data-priorite^="v:"]').count()).toBeGreaterThan(0);

    // La campagne du mois : le garage a déposé, les deux autres non ; l'anneau dit 1 sur 3.
    const camp = p.locator('#tb-campagne');
    expect(await camp.locator('.tb-h-v').innerText()).toMatch(/^1\s*sur 3$/);
    expect(await camp.locator('.tb-h-titre').innerText()).toMatch(/^Déclarations d(e |')\S+$/);
    expect(await camp.innerText()).toMatch(/À VÉRIFIER/);
    expect(await camp.locator('[data-tb-etape="fini"] .tb-et-n').innerText()).toBe('1');
    expect(await camp.locator('[data-tb-etape="fini"] .tb-et-noms').innerText()).toBe('Garage Triki');
    // Un clic sur « Déposée » ne garde que le garage dans la grille, et la puce le dit ; elle le retire d'un clic.
    await camp.locator('[data-tb-etape="fini"]').click();
    const lignes = () => p.locator('#tb-grille tbody tr[data-tb-id] td.cl b').allInnerTexts();
    await expect.poll(lignes).toEqual(['Garage Triki']);
    expect(await p.locator('.tb-p-et').innerText()).toMatch(/: déposée\s*1/);
    await p.locator('.tb-p-et').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-1.png'), fullPage: true });

    // Rim : la grille ne garde que la menuiserie ; « À faire » ne parle plus que d'elle ; la charge la surligne.
    await p.locator('.tb-qui [data-tb-qui]').filter({ hasText: 'Rim' }).click();
    await expect.poll(lignes).toEqual(['Menuiserie Ben Ali']);
    // (Une ligne du cabinet entier, sans dossier, comme « On est le 30 : relancer », reste.)
    expect(await p.locator('#tb-afaire .afaire-ligne').filter({ hasText: 'Librairie Ennour' }).count()).toBe(0);
    for (const t of await p.locator('#tb-afaire .afaire-ligne:not(:has(.marque-s.cab)) .afaire-txt').allInnerTexts()) expect(t).toMatch(/Menuiserie Ben Ali/);
    expect(await p.locator('.tb-qui [data-tb-qui]').filter({ hasText: 'Rim' }).getAttribute('aria-pressed')).toBe('true');
    // (1.195.0) La ligne du haut suit la personne ; un filtre sans dossier dit chez qui, et le filtre qu'on retire.
    expect(await p.locator('.ctx-cab').innerText()).toMatch(/Mon cabinet · 1 dossier confié à Rim/);
    await p.locator('[data-tb-filtre="manque"]').click();
    await expect.poll(() => p.locator('#tb-vide').innerText().catch(() => '')).toMatch(/^Aucune pièce manquante dans les dossiers de Rim\s+Les autres filtres, et « Tout le cabinet », sont au-dessus\.\s+Retirer le filtre « Pièces manquantes »$/);
    await p.locator('#tb-vide [data-tb-filtre="tous"]').click();
    await expect.poll(lignes).toEqual(['Menuiserie Ben Ali']);
    await p.locator('.tb-qui [data-tb-qui=""]').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);

    // (1.195.0) « Une période… » : du mois au mois, parmi les mois finis.
    await p.locator('#tb-per').click();
    await p.locator('#tb-per-de').selectOption(moisFini);
    await p.locator('#tb-per-a').selectOption(moisFini);
    await p.locator('#tb-per-ok').click();
    await expect.poll(() => p.locator('#tb-grille thead th.c').count()).toBe(1);
    expect(await p.locator('#tb-dossiers .tb-sous').innerText()).toMatch(/^La période choisie · /);
    expect(await p.locator('#tb-per').getAttribute('aria-pressed')).toBe('true');
    await p.locator('[data-tb-periode="6"]').click();
    await expect.poll(() => p.locator('#tb-grille thead th.c').count()).toBe(2);
    // Les prochaines dates disent combien de dossiers elles concernent (trois au plus ici).
    for (const n of await p.locator('#tb-dates .der-m b').allInnerTexts()) expect(n).toMatch(/^[0-3] dossiers?$/);

    // La charge de chacun : Rim saisit la menuiserie.
    const charge = p.locator('#tb-charge');
    expect(await charge.locator('.top-l').filter({ hasText: 'Rim Toumi' }).innerText()).toMatch(/saisie/);

    // La recherche qui ne trouve rien le dit, et « Effacer la recherche » rend la grille.
    await p.locator('#tb-q').fill('zzz');
    await expect.poll(() => p.locator('#tb-vide').innerText().catch(() => '')).toMatch(/^Aucun dossier ne s'appelle « zzz »/);
    await p.locator('#tb-q-effacer').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);
    await p.locator('#tb-q').fill('menuis');
    await expect.poll(lignes).toEqual(['Menuiserie Ben Ali']);
    expect(await p.locator('#tb-q').evaluate((i) => i === document.activeElement)).toBe(true);
    await p.locator('#tb-q').fill('');

    // Le menu ⋯ d'une ligne : sa comptabilité, ses échéances, écrire au contact, sa fiche.
    const ligneM = p.locator('#tb-grille tbody tr[data-tb-id]').filter({ hasText: 'Menuiserie Ben Ali' });
    await expect.poll(() => ligneM.count()).toBe(1);
    await ligneM.locator('.tb-trois').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.innerText().catch(() => '')).toMatch(/Ouvrir sa comptabilité/);
    expect(await menu.innerText()).toMatch(/Écrire à Hédi/);
    expect(await menu.innerText()).toMatch(/suivi par Rim/i);
    // (1.195.0) Confier, sans quitter le tableau de bord.
    expect(await menu.innerText()).toMatch(/Confier à quelqu'un…\s+aujourd'hui : Rim/);
    await menu.getByRole('menuitem').filter({ hasText: 'Sa fiche' }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}`);

    // La ligne ouvre la comptabilité du client.
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#tb-grille').waitFor({ timeout: 15_000 });
    await p.locator('#tb-grille tbody tr[data-tb-id]').filter({ hasText: 'Menuiserie Ben Ali' }).locator('td.cl').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}/comptabilite`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // (1.196.0, maquette « La révision », « La clôture », « La fiche d'un mois ») Les onglets Révision et Bilans lisent les livres ;
  // une case de la grille s'ouvre sur ses quatre étapes. L'exercice d'avant : la librairie a son inventaire et une échéance
  // annuelle passée (le régime « is » du cabinet), la menuiserie est close, le garage n'a pas de livre.
  it('Révision, Bilans et la fiche d\'un mois : tout est lu dans les livres', async () => {
    const { associe, cab, librairie, menuiserie, garage } = await unCabinet();
    const an = new Date().getUTCFullYear() - 1;
    expect((await api('PUT', `/cabinets/${cab.id}/reglages`, associe, { contenu: { regimes: [{ id: 'is', label: 'Société à l\'IS', tva: '', cnss: true,
      annuelles: [{ id: 'is', label: 'Déclaration de l\'IS', mois: 1, jour: 1 }] }] }, revision: null })).statut).toBeLessThan(300);
    // Le garage : 1 250,000 au compte d'attente, au brouillard avec ses honoraires.
    expect((await api('POST', `/entreprises/${garage.ent}/compta/ecritures`, associe, { date: `${moisFini}-20`, journal: 'OD', piece: 'OD-2', libelle: 'Virement à identifier',
      lignes: [{ compte: '471', debit: '1250,000' }, { compte: '401', credit: '1250,000' }] })).statut).toBe(201);
    for (const [x, clos] of [[librairie, false], [menuiserie, true]] as const) {
      expect((await api('POST', `/entreprises/${x.ent}/compta/exercices`, associe, { annee: an, ouverture: [] })).statut).toBe(201);
      expect((await api('PUT', `/entreprises/${x.ent}/compta/inventaires/${an}`, associe, { date: `${an}-12-31`, compte: '31', lignes: [{ ref: 'A1', libelle: 'Stock', quantite: '3', cout: '12,375' }] })).statut).toBeLessThan(300);
      if (!clos) continue;
      expect((await api('PUT', `/cabinets/${cab.id}/revisions/${x.ent}/${an}`, associe, { contenu: { faite: true, faiteLe: Date.now(), faitePar: 'Leïla Jlassi', comptes: [], notes: [], questionnaire: [] }, revision: null })).statut).toBeLessThan(300);
      expect((await api('PUT', `/entreprises/${x.ent}/compta/annuel/${an}`, associe, { tauxImpot: '15', revision: null })).statut).toBeLessThan(300);
      expect((await api('POST', `/entreprises/${x.ent}/compta/exercices/${an}/cloturer`, associe)).statut).toBe(200);
    }
    // La librairie est confiée à Leïla : son bilan en retard entre dans la charge de Leïla.
    const eq = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps as { membres: { membre: string; nom: string }[] };
    const membreLeila = eq.membres.find((m) => m.nom === 'Leïla Jlassi')?.membre;
    expect((await api('PUT', `/cabinets/${cab.id}/mandats/${librairie.mandat}/affectations/${membreLeila}`, associe, { role: 'revision' })).statut).toBeLessThan(300);
    // La lecture refuse une année qui n'en est pas une, en nommant le champ.
    const refus = await api('GET', `/cabinets/${cab.id}/revue?annee=deux`, associe);
    expect(refus.statut).toBe(400);
    expect(refus.corps.champ).toBe('annee');

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/production`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // La fiche d'un mois : une case de la grille s'ouvre sur ses étapes et sur ce que lit la révision ; Échap la referme.
    const caseG = p.locator(`#tb-grille tr[data-tb-id="${garage.ent}"] [data-tb-case="${moisFini}"]`);
    await caseG.click();
    const fiche = p.locator('#tb-fiche');
    await expect.poll(() => fiche.locator('.tb-mc-t b').innerText().catch(() => '')).toMatch(/^Garage Triki · \S+ \d{4}$/);
    expect(await caseG.getAttribute('aria-expanded')).toBe('true');
    expect((await fiche.locator('.tb-mc-et li b').allInnerTexts())).toEqual(['Pièces reçues', 'Saisie', 'Révision', 'Déclaration']);
    expect(await fiche.locator('.tb-mc-et li').nth(3).innerText()).toMatch(/déposée/);
    await expect.poll(() => fiche.locator('.tb-mc-f').innerText()).toMatch(/Compte d'attente\s*1 250,000 DT/);
    expect(await fiche.locator('.tb-mc-f').innerText()).toMatch(/Au brouillard\s*2 écritures/);
    expect(await fiche.locator('.tb-mc-a .btn-primary').innerText()).toBe('Voir les 2 au brouillard');
    await p.keyboard.press('Escape');
    await expect.poll(() => fiche.count()).toBe(0);
    // Un clic ailleurs la referme aussi ; « Ouvrir » mène au journal du mois.
    const caseL = p.locator(`#tb-grille tr[data-tb-id="${librairie.ent}"] [data-tb-case="${moisFini}"]`);
    await caseL.click();
    await expect.poll(() => fiche.count()).toBe(1);
    await p.locator('#page-bord h1').click();
    await expect.poll(() => fiche.count()).toBe(0);
    await caseL.click();
    await fiche.locator('[data-tb-ouvrir="journal"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${librairie.ent}/comptabilite/journal/${moisFini.slice(0, 4)}`);
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#tb-grille').waitFor({ timeout: 15_000 });

    // Révision : le compte d'attente du garage se voit, le brouillard de chacun ; le pied additionne.
    await p.locator('[data-tb-vue="revision"]').click();
    const rev = p.locator('#tb-revision');
    await rev.waitFor({ timeout: 15_000 });
    const ligneG = rev.locator(`tbody tr[data-tb-id="${garage.ent}"]`);
    expect(await ligneG.getAttribute('class')).toMatch(/tb-revoir/);
    expect(await ligneG.locator('td').nth(3).innerText()).toBe('1 250,000 DT');
    expect(await ligneG.locator('td').nth(5).innerText()).toBe('2 écritures');
    expect(await ligneG.locator('td').nth(2).innerText()).toBe('aucun relevé');
    expect(await rev.locator('tfoot').innerText()).toMatch(/1 250,000\s+1 compte à solder/);
    expect(await p.locator('[data-tb-vue="revision"] .tb-cnt').innerText()).toBe('3 à revoir');

    // Bilans : l'exercice d'avant, étape par étape ; la librairie a dépassé l'échéance que le cabinet a réglée.
    await p.locator('[data-tb-vue="bilans"]').click();
    const bil = p.locator('#tb-bilans');
    await bil.waitFor({ timeout: 15_000 });
    expect(await p.locator('[data-tb-vue="bilans"]').innerText()).toMatch(new RegExp(`^Bilans ${an}`));
    const ordre = await bil.locator('tbody tr td.cl b').allInnerTexts();
    expect(ordre).toEqual(['Librairie Ennour', 'Menuiserie Ben Ali', 'Garage Triki']);
    const lib = bil.locator(`tbody tr[data-tb-id="${librairie.ent}"]`);
    expect(await lib.locator('td').nth(5).innerText()).toMatch(/^revue des comptes à faire\s+Déclaration de l'IS : date passée depuis \d+ mois? \(le 01\/01, À VÉRIFIER\)$/);
    expect(await lib.locator('td.c .prod-fini').count()).toBe(1);
    expect(await p.locator('[data-tb-vue="bilans"] .tb-cnt').innerText()).toBe('1 en retard');
    const men = bil.locator(`tbody tr[data-tb-id="${menuiserie.ent}"]`);
    expect(await men.locator('td.c .prod-fini').count()).toBe(4);
    expect(await men.locator('td').nth(5).innerText()).toMatch(/^Clos le \d{2}\/\d{2}\/\d{4}$/);
    // (Le garage n'est suivi que depuis cette année : la ligne le dit.)
    expect(await bil.locator(`tbody tr[data-tb-id="${garage.ent}"] td`).nth(5).innerText()).toMatch(new RegExp(`^pas de livre ${an} · mission depuis \\S+ ${an + 1}$`));
    // La charge compte le bilan en retard chez qui valide (Leïla, qui suit la librairie).
    expect(await p.locator('#tb-charge').innerText()).toMatch(new RegExp(`1 bilan ${an} en retard`));
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-bilans.png'), fullPage: true });
    // La ligne d'un exercice ouvre sa clôture.
    await men.locator('td.cl').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}/comptabilite/exercice/${an}`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // (1.197.0, maquette « Quand les pièces arrivent ») Le jour du mois suivant où le mois d'un client est complet, face au
  // seuil que le cabinet règle dans ses Réglages (20 par défaut). Le garage importe aujourd'hui le relevé du mois fini :
  // son mois est complet aujourd'hui ; la librairie n'a rien envoyé.
  it('Quand les pièces arrivent : le jour où le mois est complet, face au seuil du cabinet', async () => {
    const { associe, cab, librairie, garage } = await unCabinet();
    expect((await api('POST', `/entreprises/${garage.ent}/compta/releves`, associe, { annee: Number(moisFini.slice(0, 4)), compte: '532', banque: 'BIAT', fichier: 'Releve.pdf',
      empreinte: '7'.repeat(64), soldeDebut: '0,000', soldeFin: '100,125', lignes: [{ date: `${moisFini}-10`, libelle: 'VERSEMENT', reference: '', montant: '100,125' }] })).statut).toBe(201);
    const jour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', day: '2-digit' }).format(new Date()));
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/production`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const bloc = p.locator('#tb-arrivee');
    await expect.poll(() => bloc.locator('.tb-ar-l').count()).toBeGreaterThan(0);
    expect(await bloc.locator('.tb-ar-g b').innerText()).toBe('20 · seuil du cabinet');
    const g = bloc.locator(`.tb-ar-l[data-tb-ar="${garage.ent}"]`);
    expect(await g.locator('small').innerText()).toBe(`en moyenne le ${jour} · au plus tard le ${jour}`);
    expect(await g.locator('.tb-ar-ok').innerText()).toBe(jour > 20 ? 'après le seuil' : 'avant le seuil');
    // La librairie n'a rien envoyé : elle passe en tête, en rouge.
    const premiere = bloc.locator('.tb-ar-l').first();
    expect(await premiere.getAttribute('data-tb-ar')).toBe(librairie.ent);
    expect(await premiere.locator('small').innerText()).toMatch(/^rien sur \d+ mois$/);
    expect(await premiere.locator('.tb-ar-ok').innerText()).toBe('rien ce mois-ci');
    expect(await bloc.locator('#tb-ar-relancer').innerText()).toMatch(/^\d+ clients? envoi(e|ent) après le seuil ou rien du tout/);
    // Le seuil se règle dans Le cabinet › Réglages ; la page le suit.
    const autre = jour > 20 ? 31 : 1;
    await p.evaluate(() => { location.hash = '#/reglages'; });
    await p.locator('#c-seuil').waitFor({ timeout: 15_000 });
    expect(await p.locator('#c-seuil').inputValue()).toBe('20');
    await p.locator('#c-seuil').fill(String(autre));
    await p.locator('#c-save').click();
    await expect.poll(() => api('GET', `/cabinets/${cab.id}/reglages`, associe).then((r) => (r.corps.contenu as Record<string, unknown>).seuilPieces)).toBe(autre);
    await p.evaluate(() => { location.hash = '#/production'; });
    await expect.poll(() => p.locator('#tb-arrivee .tb-ar-g b').innerText().catch(() => '')).toBe(`${autre} · seuil du cabinet`);
    expect(await p.locator(`#tb-arrivee .tb-ar-l[data-tb-ar="${garage.ent}"] .tb-ar-ok`).innerText()).toBe(jour > autre ? 'après le seuil' : 'avant le seuil');
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-arrivee.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // (1.198.0, maquette « Le menu ⋯ de la page », « Sans réseau », « Abonnement en lecture seule ») Exporter la grille avec
  // ses filtres, en tableur ou en PDF pour une réunion ; une bande quand le réseau manque, une autre quand l'abonnement est
  // en lecture seule.
  it('Exporter la grille, et les bandes hors ligne et lecture seule', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    // L'abonnement du cabinet, lu comme en lecture seule depuis le 21/10.
    await p.route('**/v1/cabinets/*/abonnement', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ etat: { etat: 'lecture_seule', depuis: '2026-10-21' } }) }));
    let html = '';
    await p.route('**/v1/pdf', async (r) => { html = String((r.request().postDataJSON() as { html: string }).html); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pdf: 'JVBERg==', nom: 'tableau.pdf' }) }); });
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/production`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#tb-ls').innerText().catch(() => '')).toMatch(/^Tes dossiers payants sont en lecture seule depuis le 21\/10\s+Tout se lit, rien n'est perdu, et tout s'exporte/);

    // Exporter en tableur : les filtres posés valent (la recherche « menuis » : la menuiserie seule).
    await p.locator('#tb-q').fill('menuis');
    await expect.poll(() => p.locator('#tb-grille tbody tr[data-tb-id]').count()).toBe(1);
    await p.locator('#tb-exporter').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.innerText().catch(() => '')).toMatch(/La grille[\s\S]*Exporter en tableur[\s\S]*PDF pour une réunion/i);
    const [dl] = await Promise.all([p.waitForEvent('download'), menu.getByRole('menuitem').filter({ hasText: 'Exporter en tableur' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    expect(csv[0]).toMatch(/^Dossier;Matricule fiscal;Tenu;Suivi par;.+;Mois en retard$/);
    expect(csv.length).toBe(2);
    expect(csv[1]).toMatch(/^Menuiserie Ben Ali;;sur SkanFact;Rim Toumi;/);
    // PDF pour une réunion : la grille, les chiffres du mois, l'équipe.
    await p.locator('#tb-exporter').click();
    await menu.getByRole('menuitem').filter({ hasText: 'PDF pour une réunion' }).click();
    await expect.poll(() => html).toMatch(/<h1>Tableau de bord · Jlassi Conseil<\/h1>/);
    expect(html).toMatch(/Menuiserie Ben Ali/);
    expect(html).not.toMatch(/Garage Triki/);
    expect(html).toMatch(/<h2>L'équipe<\/h2>/);

    // Hors ligne : une bande dit l'heure de la dernière lecture ; elle part quand le réseau revient.
    await cx.setOffline(true);
    await expect.poll(() => p.locator('#tb-hors').innerText().catch(() => '')).toMatch(/^Hors ligne · tu vois le tableau tel qu'il était à \d{1,2}\s+h\s+\d{2}/);
    await cx.setOffline(false);
    await expect.poll(() => p.locator('#tb-hors').count()).toBe(0);
    // « Régler l'abonnement » mène à « Ton abonnement ».
    await p.locator('#tb-ls-regler').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toMatch(/^#\/reglages/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('au téléphone : rien ne déborde, la grille défile dans son cadre, l\'onglet du bas s\'appelle « Tableau »', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);
    await expect.poll(() => p.locator('.sb-onglets .sb-onglet[aria-current="page"] .nom').innerText()).toBe('Tableau');
    // (1.195.0, maquette vue téléphone) Les trois derniers mois au plus, sans « Sur la période ».
    expect(await p.locator('#tb-grille thead th.c').count()).toBeLessThanOrEqual(3);
    expect(await p.locator('#tb-grille td.tb-av').count()).toBe(0);
    // La grille défile dans son cadre si elle est plus large que l'écran.
    expect(await p.locator('#tb-dossiers .lf-tab').evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
    // Au doigt, le menu ⋯ d'une ligne se touche (44 points).
    const bouton = await p.locator('#tb-grille .tb-trois').first().boundingBox();
    expect(Math.round(bouton?.height ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(bouton?.width ?? 0)).toBeGreaterThanOrEqual(44);
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-tel.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
