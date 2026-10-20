// La fenêtre d'une absence de l'entreprise, au clavier (1.70.0 ; docs/paie.md, « Les congés au Cabinet », ce qui a été vu à
// l'écran). Vu au test humain des congés au Cabinet : dans une fenêtre qui porte « Supprimer » (rouge, à gauche) et
// « Enregistrer », Entrée dans un champ cliquait « Supprimer », et la question qui suit se validait d'Entrée aussi. La même
// règle commune vivait dans l'entreprise. Ce que le parcours vérifie, écran ET serveur : Entrée enregistre la modification,
// sans question, et l'absence reste ; une absence qui commence avant l'entrée du salarié se refuse, sur sa case.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('la fenêtre d\'une absence de l\'entreprise, au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-absence-fenetre-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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

  it('Entrée dans un champ enregistre l\'absence, sans jamais demander de la supprimer ; une absence avant l\'entrée se refuse', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu }] })).statut;
    expect(await dossierV10('employees', 's1', { id: 's1', name: 'Salarié Numéro Un', grossSalary: 980, hireDate: '2025-03-16', contract: 'cdi', active: true, method: 'virement', iban: '' })).toBe(200);
    expect(await dossierV10('leaves', 'l1', { id: 'l1', employeeId: 's1', kind: 'conges', from: '2025-10-13', to: '2025-10-17', paid: null, note: '' })).toBe(200);
    // L'assistant de démarrage déjà fait : la page s'ouvre sur la paie, pas sur « Où te joindre ? ».
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true } }] })).statut).toBe(200);
    const conge = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === 'leaves' && o.cle === 'l1')?.contenu;

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#p-tabs button', { hasText: 'Congés et absences' }).click();
    await p.locator('#p-year').selectOption('2025');
    await p.locator('[data-lv="l1"]').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Modifier l\'absence');

    // Entrée dans le motif : la modification s'enregistre, la fenêtre se ferme, aucune question de suppression.
    await fenetre.locator('[name=note]').fill('Congé annuel');
    await fenetre.locator('[name=note]').press('Enter');
    await expect.poll(conge, { timeout: 15_000 }).toMatchObject({ note: 'Congé annuel', from: '2025-10-13' });
    expect(await p.getByText('Supprimer cette absence ?').count()).toBe(0);
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // Une absence qui commencerait avant l'entrée du salarié se refuse, sur sa case.
    await p.locator('[data-lv="l1"]').click();
    await fenetre.locator('.datefield:has(input[name=from]) input:not([type=hidden])').fill('10/03/2025');
    await fenetre.locator('.datefield:has(input[name=from]) input:not([type=hidden])').press('Tab');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain('L\'entrée de Salarié Numéro Un est le 16/03/2025 : une absence ne commence pas avant.');
    expect(await conge()).toMatchObject({ from: '2025-10-13' });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
