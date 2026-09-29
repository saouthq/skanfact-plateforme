// La banque, à la souris (brique 40 ; docs/cabinet.md, C19 à C21). Les écrans sont ceux du Cabinet
// v10 ; le relevé se lit dans le navigateur, et tout s'écrit au serveur. Ce que le parcours vérifie,
// écran ET serveur :
//   - un relevé CSV (un titre au-dessus du tableau) s'importe quand il se boucle ; le compte et la
//     banque se retiennent (la fiche du dossier, les réglages du cabinet) ;
//   - l'automatique pose le certain, garde l'ambiguïté (« probable ») sans rien poser ;
//   - l'ambiguïté se tranche à la main (« Choisir l'écriture en face ») ;
//   - l'écriture manquante s'écrit depuis la ligne : un brouillard, rapproché du même geste, et le mot
//     retenu pour les prochains relevés ;
//   - tout se défait, et le relevé se retire sans toucher aux écritures.

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

  it('un relevé s\'importe, l\'automatique pose le certain et garde l\'ambiguïté, qui se tranche à la main ; l\'écriture manquante s\'écrit depuis la ligne ; tout se défait, le relevé se retire', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, piece: string, libelle: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date, journal: 'BQ', piece, libelle, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    // Le virement du client ; deux chèques du même montant, à deux jours d'écart : l'ambiguïté.
    const virement = await saisir('2026-03-02', 'VIR-1', 'Virement Dupont', [['532', '1190,250', ''], ['411', '', '1190,250']]);
    const cheque1 = await saisir('2026-03-10', 'CHQ-1234', 'Chèque 1234', [['6061', '700', ''], ['532', '', '700']]);
    const cheque2 = await saisir('2026-03-12', 'CHQ-1235', 'Chèque 1235', [['6061', '700', ''], ['532', '', '700']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [virement, cheque1, cheque2] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
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

    // ── L'import : le fichier tel que la banque le donne, un titre au-dessus du tableau ─────────────
    await aller();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Aucun relevé bancaire importé pour 2026/);
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
    await expect.poll(async () => (await releves(cafe, associe)).length, { timeout: 10_000 }).toBe(1);
    const [R] = await releves(cafe, associe);
    const [, L2, L3] = R?.lignes.map((l) => l.id) ?? [];
    // Le compte du dossier et l'association des colonnes de cette banque sont retenus.
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { banques?: Record<string, unknown> }).banques?.BIAT).toBeTruthy();
    // La fiche du dossier s'écrit après les réglages : on l'attend.
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { banque?: unknown } }[])
      .find((f) => f.entreprise === cafe)?.contenu.banque).toEqual({ compte: '532', banque: 'BIAT' });

    // ── L'automatique : le virement se pose ; le chèque de 700 est ambigu : gardé, pas posé ──────────
    await expect.poll(() => p.locator('#bq-auto').count()).toBe(1);
    await p.locator('#bq-auto').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^1 ligne rapprochée d.office ; 1 à trancher, 1 sans réponse\.$/);
    let lu = (await releves(cafe, associe))[0];
    expect(lu?.lignes.map((l) => [l.niveau, l.rapprochement?.ecriture ?? null, l.rapprochement?.auto ?? null]))
      .toEqual([['aucun', virement, true], ['aucun', null, null], ['probable', null, null]]);

    // ── L'ambiguïté se tranche à la main : la plus probable est en tête ─────────────────────────
    await (await menu(`LIG:${L3}`)).filter({ hasText: 'Choisir l\'écriture en face' }).click();
    await expect.poll(() => fenetre.locator('#ce-jugement').innerText()).toMatch(/La plus probable est en tête/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-2-trancher.png') });
    await fenetre.locator('button.btn-primary[data-pick]').click();
    await expect.poll(async () => (await releves(cafe, associe))[0]?.lignes[2]?.rapprochement?.ecriture, { timeout: 10_000 }).toBe(cheque1);

    // ── L'écriture manquante, depuis la ligne : un brouillard rapproché, et le mot retenu ─────────
    await (await menu(`LIG:${L2}`)).filter({ hasText: 'Écrire l\'écriture manquante' }).click();
    await expect.poll(() => fenetre.innerText()).toMatch(/Aucune règle ne reconnaît ce libellé/);
    await fenetre.locator('[name=compte]').fill('6061');
    await fenetre.locator('[name=retenir]').check();
    await fenetre.locator('[name=motif]').fill('STEG');
    await fenetre.getByRole('button', { name: 'Créer le brouillard' }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toBe('Brouillard créé et rapproché.');
    lu = (await releves(cafe, associe))[0];
    const steg = lu?.lignes[1]?.rapprochement;
    expect(steg).toMatchObject({ rang: 1, niveau: 'certain', auto: false });
    const ecrite = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; statut: string; lignes: { compte: string; debit: string; credit: string }[] }[];
    expect(ecrite.find((e) => e.id === steg?.ecriture)).toMatchObject({ statut: 'brouillard', lignes: [{ compte: '532', debit: '0.000', credit: '85.125' }, { compte: '6061', debit: '85.125', credit: '0.000' }] });
    expect(((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { libelles?: unknown }).libelles).toEqual([{ motif: 'STEG', compte: '6061' }]);
    await aller();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Les mots retenus[\s\S]*STEG[\s\S]*6061/);
    expect(await p.locator('.stat', { hasText: 'Rapproché' }).first().locator('.val').innerText()).toBe('3');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-3-rapproche.png') });

    // ── Tout défaire, puis retirer le relevé : les écritures restent ─────────────────────────────
    await (await menu(`REL:${R?.id}`)).filter({ hasText: 'Défaire tous les rapprochements' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('3 rapprochements défaits.');
    expect((await releves(cafe, associe))[0]?.lignes.map((l) => l.rapprochement)).toEqual([null, null, null]);
    await (await menu(`REL:${R?.id}`)).filter({ hasText: 'Retirer ce relevé' }).click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Retirer' }).click();
    await expect.poll(async () => (await releves(cafe, associe)).length, { timeout: 10_000 }).toBe(0);
    expect(((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as unknown[]).length).toBe(4);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
