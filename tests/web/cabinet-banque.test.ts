// La banque, à la souris (brique 40 ; docs/cabinet.md, C19 à C21 ; 1.206.0, l'écran en deux colonnes de la
// maquette docs/maquettes/cabinet/comptabilite.html). Les écrans sont ceux du Cabinet v10 ; le relevé se lit
// dans le navigateur, et tout s'écrit au serveur. Ce que le parcours vérifie, écran ET serveur :
//   - l'écran vide montre ce qui viendra ; un relevé CSV (un titre au-dessus du tableau) s'importe quand il se
//     boucle, et ce qui est sûr se rapproche d'office à l'import ; le compte et la banque se retiennent ;
//   - les lignes se rangent par ce qu'elles demandent (proposées, à traiter, rapprochées), le livre en face ;
//   - la proposée se rapproche à la touche Entrée, « Annuler » la défait ; « Valider la proposée » la repose ;
//   - l'écriture manquante s'écrit depuis la ligne : un brouillard, rapproché du même geste, la règle retenue ;
//   - le pied fait l'équation du relevé jusqu'au millime, l'état de rapprochement le montre ;
//   - tout se défait d'un coup, « Annuler » repose tout ; le relevé se retire sans toucher aux écritures ;
//   - au téléphone, des cartes : le tableau du bureau se cache, le livre en face garde ses tableaux.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la banque, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-banque-'));
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

  it('l\'écran vide, puis un relevé s\'importe et se rapproche d\'office ; la proposée se rapproche à la touche Entrée et se défait ; l\'écriture manquante s\'écrit depuis la ligne ; l\'équation du relevé au millime, l\'état ; tout se défait et se repose ; au téléphone, des cartes', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, piece: string, libelle: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date, journal: 'BQ', piece, libelle, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    // Le solde de la banque au 1er mars ; le virement du client ; deux chèques du même montant, à deux jours d'écart.
    const nouveau = await saisir('2026-01-01', 'AN-1', 'Solde de la banque repris', [['532', '10000,500', ''], ['101', '', '10000,500']]);
    const virement = await saisir('2026-03-02', 'VIR-1', 'Virement du client Dupont, facture FA-2026-0042 de février', [['532', '1190,250', ''], ['411', '', '1190,250']]);
    const cheque1 = await saisir('2026-03-10', 'CHQ-1234', 'Chèque 1234', [['6061', '700', ''], ['532', '', '700']]);
    const cheque2 = await saisir('2026-03-12', 'CHQ-1235', 'Chèque 1235', [['6061', '700', ''], ['532', '', '700']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [nouveau, virement, cheque1, cheque2] })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/banque/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const fenetre = p.locator('#modal-root .modal').first();
    const menu = async (cle: string) => { await p.locator(`[data-rowmenu="${cle}"]`).first().click(); return p.getByRole('menuitem'); };
    // Une ligne du tableau (au bureau) et son groupe ; les pastilles de compte ; le pied.
    const ligne = (id: string | undefined) => p.locator(`table.bq-t [data-bq-ligne="${id}"]`);
    const groupes = async () => p.locator('table.bq-t [data-bq-ligne]').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.groupe));
    const pied = () => p.locator('.bqp').innerText().then((t) => t.replace(/\s+/g, ' '));
    const annuler = () => p.locator('#toast').getByRole('button', { name: 'Annuler' }).click();

    // ── L'écran vide : l'aperçu de ce qui viendra, et l'import ──────────────────────────────────
    await aller();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Le relevé n'est pas encore là/);
    await p.locator('#bq-import').first().click();
    await fenetre.locator('[name=banque]').fill('BIAT');
    const csv = ['Relevé de compte BIAT — mars 2026', 'Date;Libellé;Référence;Débit;Crédit',
      '02/03/2026;VIR CLIENT DUPONT;R1;;1 190,250', '05/03/2026;PRLV STEG;R2;85,125;', '10/03/2026;CHQ 1234;R3;700,000;'].join('\r\n');
    const [fichier] = await Promise.all([p.waitForEvent('filechooser'), fenetre.locator('#rv-fichier').click()]);
    await fichier.setFiles({ name: 'releve-mars.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect.poll(() => fenetre.locator('#rv-apercu').innerText()).toMatch(/3 lignes lues · mouvements 405,125/);
    expect(await fenetre.locator('[name=compte]').inputValue()).toBe('532');
    await fenetre.locator('[name=debut]').fill('10000,500');
    await fenetre.locator('[name=fin]').fill('10405,625');
    await expect.poll(() => fenetre.locator('#rv-fin-hint').innerText()).toMatch(/Ça tombe juste/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-1-import.png') });
    await fenetre.getByRole('button', { name: 'Importer', exact: true }).click();
    // Ce qui est sûr se rapproche à l'import : le virement ; le chèque de 700 (deux en face) attend qu'on le confirme.
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toBe('Relevé importé : 3 lignes, dont 1 rapprochée d\'office.');
    const [R] = await releves(cafe, associe);
    const [L1, L2, L3] = R?.lignes.map((l) => l.id) ?? [];
    expect(R?.lignes.map((l) => [l.rapprochement?.ecriture ?? null, l.rapprochement?.auto ?? null])).toEqual([[virement, true], [null, null], [null, null]]);
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { banques?: Record<string, unknown> }).banques?.BIAT).toBeTruthy();
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { banque?: unknown } }[])
      .find((f) => f.entreprise === cafe)?.contenu.banque).toEqual({ compte: '532', banque: 'BIAT' });

    // ── Les lignes rangées par ce qu'elles demandent, le livre en face ─────────────────────────
    await expect.poll(() => p.locator('.bq-f').innerText().then((t) => t.replace(/\s+/g, ' '))).toMatch(/3 Toutes 1 Rapprochées 1 Proposées 1 À traiter 0 En attente du client/);
    expect(await groupes()).toEqual(['prop', 'dec']);
    expect(await ligne(L3).innerText()).toMatch(/BQ CHQ-1234 · Chèque 1234[\s\S]*même montant/);
    expect(await ligne(L2).innerText()).toMatch(/Rien dans le livre en face/);
    // La proposée est choisie d'office ; le livre en face la montre, cochée, l'écart à zéro.
    await expect.poll(() => p.locator('.bq-livre').innerText()).toMatch(/en face de\s+CHQ 1234[\s\S]*BQ CHQ-1234[\s\S]*écart 0/);
    // L'équation : le relevé, les deux lignes pas encore au livre, l'écriture du chèque pas encore en banque.
    expect(await pied()).toMatch(/Relevé au 10\/03 10 405,625 \+ 2 lignes pas encore au livre 785,125 − 1 écriture pas encore en banque 700,000 = Attendu au livre 532 10 490,750 Écart expliqué au millime/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-2-deux-colonnes.png') });

    // ── La touche Entrée rapproche la proposée ; « Annuler » la défait ; « Valider la proposée » la repose ─
    await p.locator('.bq-aide').click();
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toMatch(/^Rapprochée avec BQ CHQ-1234\./);
    await expect.poll(async () => (await releves(cafe, associe))[0]?.lignes[2]?.rapprochement).toMatchObject({ ecriture: cheque1, auto: false });
    await annuler();
    await expect.poll(async () => (await releves(cafe, associe))[0]?.lignes[2]?.rapprochement ?? null, { timeout: 10_000 }).toBeNull();
    await expect.poll(() => groupes()).toEqual(['prop', 'dec']);
    await p.locator('table.bq-t [data-bq-valider]').click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toMatch(/^1 ligne rapprochée : chacune avec l'écriture proposée\./);
    await expect.poll(async () => (await releves(cafe, associe))[0]?.lignes[2]?.rapprochement?.ecriture).toBe(cheque1);

    // ── Une écriture d'un autre montant, trouvée par la recherche, ne se rapproche pas : l'écart se dit ──────
    await ligne(L2).click();
    await p.locator('#bq-cherche').fill('Solde');
    await p.locator('[data-bq-choix]', { hasText: 'AN-1' }).click();
    await expect.poll(() => p.locator('#bq-ecart-refus').innerText().catch(() => '')).toMatch(/Les deux montants ne sont pas égaux \(écart\s[\s\S]*\)/);
    expect(await p.locator('#bq-principal').count()).toBe(0);
    expect((await releves(cafe, associe))[0]?.lignes[1]?.rapprochement ?? null).toBeNull();
    await p.locator('#bq-cherche').fill('');
    await p.locator('#bq-cherche').press('Escape');

    // ── L'écriture manquante, depuis la ligne : un brouillard rapproché, et la règle retenue ────────
    await (await menu(`LIG:${L2}`)).filter({ hasText: 'Écrire autre chose…' }).click();
    await expect.poll(() => fenetre.innerText()).toMatch(/Aucune règle ne reconnaît ce libellé/);
    await fenetre.locator('[name=compte]').fill('6061');
    await fenetre.locator('[name=retenir]').check();
    await fenetre.locator('[name=motif]').fill('STEG');
    await fenetre.getByRole('button', { name: 'Créer le brouillard' }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toBe('Brouillard créé et rapproché.');
    const lu = (await releves(cafe, associe))[0];
    const steg = lu?.lignes[1]?.rapprochement;
    expect(steg).toMatchObject({ rang: 1, niveau: 'certain', auto: false });
    const ecrite = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; statut: string; lignes: { compte: string; debit: string; credit: string }[] }[];
    expect(ecrite.find((e) => e.id === steg?.ecriture)).toMatchObject({ statut: 'brouillard', lignes: [{ compte: '532', debit: '0.000', credit: '85.125' }, { compte: '6061', debit: '85.125', credit: '0.000' }] });
    expect(((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { libelles?: unknown }).libelles).toEqual([{ motif: 'STEG', compte: '6061' }]);

    // ── Tout est rapproché : le mois le dit, le pied boucle, les règles et l'état se lisent ─────────
    await expect.poll(() => p.locator('.bq-fini').innerText()).toMatch(/Mars 2026 est rapproché à la BIAT[\s\S]*3 mouvements sur 3 ont leur écriture/);
    expect(await pied()).toMatch(/Relevé au 10\/03 10 405,625 = Attendu au livre 532 10 405,625 Écart expliqué au millime plus rien à écrire/);
    await p.locator('#bq-regles').click();
    await expect.poll(() => fenetre.innerText()).toMatch(/Les règles de la banque[\s\S]*STEG[\s\S]*6061/);
    await fenetre.getByRole('button', { name: 'Fermer' }).click();
    await p.locator('.bq-fini [data-bq-etat]').click();
    await expect.poll(() => fenetre.innerText()).toMatch(/Solde du relevé au 10\/03\/2026\s+10\s405,625[\s\S]*Solde du livre au 10\/03\/2026\s+10\s405,625[\s\S]*Les deux soldes rectifiés sont égaux : 10\s405,625\sDT/);
    expect(await fenetre.innerText()).not.toMatch(/Provisoire/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-3-etat.png') });
    await fenetre.getByRole('button', { name: 'Fermer' }).click();

    // ── Au téléphone : des cartes ; le tableau du bureau se cache ; le livre en face garde ses tableaux ─
    await p.setViewportSize({ width: 390, height: 860 });
    await expect.poll(() => p.locator('table.bq-t').isVisible()).toBe(false);
    await p.locator('.bq-km [data-bq-voir]').click();
    // Rien ne déborde : le mois rapproché (sa phrase, son bouton) tient dans la carte, la carte dans l'écran.
    await expect.poll(() => p.locator('.bq-fini').innerText()).toMatch(/est rapproché/);
    expect(await p.evaluate(() => {
      const e = document.querySelector('.bq-ecran') as HTMLElement, parent = e.parentElement as HTMLElement;
      return [e.getBoundingClientRect().width <= parent.clientWidth + 1, document.documentElement.scrollWidth <= window.innerWidth];
    })).toEqual([true, true]);
    await expect.poll(() => p.locator('.bq-km [data-bq-ligne]').count()).toBeGreaterThan(0);
    // Le livre en face d'une rapprochée montre son écriture : un vrai tableau, pas des cartes. On choisit le virement,
    // dont le libellé est long : une écriture au libellé court tiendrait même dans un tableau qui déborde.
    await p.locator(`.bq-km [data-bq-ligne="${L1}"]`).click();
    await expect.poll(() => p.locator('table.bq-ec').first().innerText().catch(() => '')).toMatch(/facture FA-2026-0042/);
    expect(await p.locator('table.bq-ec').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-cartes') === 'oui'))).not.toContain(true);
    // Et il tient dans son cadre : la colonne Crédit n'en sort pas.
    expect(await p.locator('table.bq-ec').first().evaluate((t) => [t.scrollWidth <= t.clientWidth + 1, t.getBoundingClientRect().right <= (t.closest('.bq-livre') as HTMLElement).getBoundingClientRect().right])).toEqual([true, true]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-4-telephone.png'), fullPage: true });
    await p.setViewportSize({ width: 1440, height: 900 });

    // ── Tout défaire d'un coup ; « Annuler » repose chaque ligne sur son écriture, l'automatique gardé ─
    const avant = (await releves(cafe, associe))[0]?.lignes.map((l) => [l.rapprochement?.ecriture, l.rapprochement?.rang, l.rapprochement?.auto]);
    await (await menu(`REL:${R?.id}`)).filter({ hasText: 'Défaire tous les rapprochements' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^3 rapprochements défaits\./);
    expect((await releves(cafe, associe))[0]?.lignes.map((l) => l.rapprochement)).toEqual([null, null, null]);
    await annuler();
    await expect.poll(async () => (await releves(cafe, associe))[0]?.lignes.map((l) => [l.rapprochement?.ecriture, l.rapprochement?.rang, l.rapprochement?.auto]), { timeout: 10_000 }).toEqual(avant);

    // ── Retirer le relevé : les écritures restent ─────────────────────────────────────────────
    await (await menu(`REL:${R?.id}`)).filter({ hasText: 'Retirer ce relevé' }).click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Retirer' }).click();
    await expect.poll(async () => (await releves(cafe, associe)).length, { timeout: 10_000 }).toBe(0);
    expect(((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as unknown[]).length).toBe(5);
    expect(L1).toBeTruthy();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
