// Le Cabinet lit les réglages de paie du client, à la souris (1.67.0 ; docs/paie.md, « Le Cabinet lit les réglages de paie
// du client »). Un client qui tient sa paie dans son SkanFact y règle ses taux (Paie › Barèmes) ; sous un mandat de paie,
// le Cabinet les lit à la racine de son dossier (migration 0148), sans les écrire. Ce que le parcours vérifie, écran ET
// serveur :
//   - le panneau des salariés dit ses taux et d'où ils viennent ; la fenêtre les montre, sans une case à changer ;
//   - un bulletin que le Cabinet établit pour lui les prend (le barème que le serveur garde avec lui) ;
//   - le client change sa TFP : le bulletin modifié au Cabinet garde la sienne, et la case « Prendre les taux de la paie
//     d'aujourd'hui » lui donne la nouvelle ;
//   - les réglages du client sont restés ceux qu'il a écrits : le Cabinet n'y a rien changé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les réglages de paie du client sur SkanFact, lus au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reglages-'));
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
  // Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('le Cabinet montre les taux du SkanFact du client sans les changer, et chaque bulletin qu\'il établit pour lui les prend', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps;
    const cabinet = String(cab.id);
    // Un client sur SkanFact, qui confie au cabinet sa comptabilité et sa paie.
    const patron = await personne('client');
    const boulangerie = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${boulangerie}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${boulangerie}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    // Ses réglages de paie, dans son SkanFact : un accident du travail à 2,25 %, une TFP à 1 %, un CIVP sans CNSS patronale.
    const reglages = { accidentRate: 2.25, tfpRate: 1, regimesContrat: { civp: { cnssEmployer: 0 } } };
    const ecrireReglages = async (r: unknown, revision: number | null) => (await api('POST', `/entreprises/${boulangerie}/dossier-v10`, patron,
      { changements: [{ collection: '_racine', cle: 'payrollSettings', rang: null, revision, contenu: encoder(r) }] })).statut;
    expect(await ecrireReglages(reglages, null)).toBe(200);
    // Son salarié, déclaré dans son SkanFact.
    const salarie = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1180.5, hireDate: '2026-01-01', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    expect((await api('POST', `/entreprises/${boulangerie}/paie/dossier`, patron,
      { changements: [{ collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie) }] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const ouvrirLaPaie = async (recharger = false) => {
      // Recharger : la même adresse, rouverte, ne change que son fragment, et la page garde ce qu'elle a lu.
      if (recharger) await p.reload();
      else await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${boulangerie}/comptabilite/paie/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
      await p.locator('#pa-mois').selectOption('10');
    };
    await ouvrirLaPaie();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);

    // ── Le panneau dit ses taux et d'où ils viennent ; la fenêtre les montre sans une case à changer ──────────────
    await expect.poll(() => p.locator('#pa-regimes-bloc').innerText())
      .toMatch(/Réglés dans son SkanFact — Ce client\s*: Accident du travail 2,25 %, TFP 1 % · CIVP\s*: CNSS employeur 0 %/);
    await ouvrir('#pa-regimes', '#rc-lu');
    expect((await fenetre.locator('#rc-lu').innerText()).replace(/\s+/g, ' ')).toContain('Accident du travail 2,25 % le sien TFP 1 % le sien FOPROLOS 1 % le barème général');
    expect(await fenetre.locator('input').count()).toBe(0);
    expect(await fenetre.innerText()).toContain('Paie › Barèmes');
    await fenetre.locator('[data-close]').first().click();
    await expect.poll(() => p.locator('#rc-lu').count()).toBe(0);

    // ── Un bulletin d'octobre établi au Cabinet : il prend les taux du client ────────────────────────────────────
    await ouvrir('#pa-bulletin', '#bf');
    expect(await fenetre.locator('#bf-taux').count()).toBe(0);
    const apercu = (await fenetre.locator('#bf-apercu').innerText()).replace(/\s/g, '');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(() => p.locator('#bf').count()).toBe(0);
    const octobre = async () => {
      const ligne = ((await api('GET', `/entreprises/${boulangerie}/paie/bulletins?annee=2026`, associe)).corps.lignes as { id: string; coutEmployeur: string }[])[0];
      const bareme = ((await api('GET', `/entreprises/${boulangerie}/paie/bulletins/${ligne?.id}`, associe)).corps as { bareme: Record<string, unknown> }).bareme;
      return { cout: String(ligne?.coutEmployeur), taux: [bareme.accidentTravail, bareme.tfp, bareme.foprolos] };
    };
    expect((await octobre()).taux).toEqual(['2.2500', '1.0000', '1.0000']);
    expect(apercu).toContain(`coûtemployeur${(await octobre()).cout.replace('.', ',')}DT`);

    // ── Le client remet sa TFP à 2 % : le bulletin modifié garde la sienne ; la case lui donne la nouvelle ──────
    expect(await ecrireReglages({ ...reglages, tfpRate: 2 }, 1)).toBe(200);
    await ouvrirLaPaie(true);
    await expect.poll(() => p.locator('#pa-regimes-bloc').innerText()).toMatch(/Ce client\s*: Accident du travail 2,25 %, TFP 2 %/);
    await expect.poll(async () => {
      if (!await p.locator('#bf').count()) {
        if (!await p.getByRole('menuitem').filter({ hasText: 'Modifier le bulletin' }).count()) await p.locator('[data-rowmenu^="PAIE:"]').first().click({ timeout: 2_000 }).catch(() => {});
        await p.getByRole('menuitem').filter({ hasText: 'Modifier le bulletin' }).first().click({ timeout: 2_000 }).catch(() => {});
      }
      return p.locator('#bf').count();
    }, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => fenetre.locator('#bf-taux').innerText().catch(() => ''))
      .toBe('Prendre les taux de la paie d\'aujourd\'hui : TFP 2 % (1 % sur ce bulletin). Sans cette case, le bulletin garde ceux de son calcul.');
    // Sans la case, l'aperçu calcule avec les taux du bulletin : le coût employeur que le serveur garde.
    await expect.poll(async () => (await fenetre.locator('#bf-apercu').innerText()).replace(/\s/g, '')).toContain(`coûtemployeur${(await octobre()).cout.replace('.', ',')}DT`);
    await fenetre.locator('#bf-taux-du-jour').check();
    await fenetre.locator('#ok').click();
    await expect.poll(async () => (await octobre()).taux).toEqual(['2.2500', '2.0000', '1.0000']);

    // ── Les réglages du client sont ceux qu'il a écrits : le Cabinet n'y a rien changé ──────────────────────────
    const lu = ((await api('GET', `/entreprises/${boulangerie}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: unknown }[])
      .find((o) => o.collection === '_racine' && o.cle === 'payrollSettings');
    expect([lu?.revision, lu?.contenu]).toEqual([2, encoder({ ...reglages, tfpRate: 2 })]);
    // Ni dans la fiche du dossier au Cabinet.
    const fiche = ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[])
      .find((f) => f.entreprise === boulangerie)?.contenu ?? {};
    expect(fiche.paie).toBeUndefined();
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-reglages.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
