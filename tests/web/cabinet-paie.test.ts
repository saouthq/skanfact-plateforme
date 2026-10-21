// La paie tenue par le cabinet, à la souris (brique 43 ; docs/cabinet.md, C31). L'écran est celui du
// Cabinet v10 ; le salarié et son bulletin s'enregistrent dans le dossier du client (le même que son
// SkanFact), le serveur recalcule le bulletin et tient l'écriture de paie du mois. Ce que le parcours
// vérifie, écran ET serveur :
//   - un salarié déclaré, un bulletin établi : la paie du serveur les tient, au millime de l'écran ;
//   - l'écriture de paie du mois existe sans qu'on la passe : le bouton le dit ;
//   - la paie du dossier (ses salariés, ses bulletins) se lit dès l'ouverture du livre ; un bulletin du client à plusieurs
//     primes et retenues, modifié au Cabinet, garde toutes ses lignes, leurs marques (heures supplémentaires, prime au
//     jour) et son prorata, et se calcule comme dans l'entreprise (1.63.0) ;
//   - les documents de la paie du dossier sortent du Cabinet : le bulletin, le journal du mois, l'état CNSS du trimestre,
//     ceux de l'entreprise (1.65.0).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';
import { pdfTelecharge } from '../pdf-telecharge.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la paie tenue par le cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-paie-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    // Le nom d'un PDF téléchargé garde ses accents dans une langue UTF-8 (sinon : « download »).
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
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
  // Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js), et retour.
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const decoder = (v: unknown): unknown => (Array.isArray(v) ? v.map(decoder) : v && typeof v === 'object'
    ? (Object.keys(v).length === 1 && '~n' in v ? Number((v as { '~n': string })['~n']) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]))) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('un salarié et son bulletin, écrits dans le dossier du client ; le serveur les tient au millime et écrit le mois', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Le livre de 2025 commencé (un client qui démarre : sans balance d'ouverture).
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('3');

    // ── Un salarié ───────────────────────────────────────────────────────────────────────────────
    await ouvrir('#pa-salarie', '#modal-root [name=nom]');
    await fenetre.locator('[name=nom]').fill('Amel Trabelsi');
    await fenetre.locator('[name=brut]').fill('1250,500');
    await fenetre.locator('[name=embauche]').fill('01/01/2025');
    await fenetre.locator('[name=chefDeFamille]').check();
    await fenetre.locator('[name=enfants]').fill('2');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    const dossierPaie = async () => (await api('GET', `/entreprises/${cafe}/paie/dossier`, associe)).corps.objets as { collection: string; contenu: Record<string, unknown> }[];
    expect((await dossierPaie()).map((o) => [o.collection, o.contenu.name])).toEqual([['employees', 'Amel Trabelsi']]);

    // ── Son bulletin de mars ─────────────────────────────────────────────────────────────────────
    await ouvrir('#pa-bulletin', '#bf');
    // Les primes du bulletin, une ligne chacune (1.63.0).
    await fenetre.locator('#bf-plus-prime').click();
    await fenetre.locator('#bf-primes [data-l=label]').fill('Prime de rendement');
    await fenetre.locator('#bf-primes [data-l=amount]').fill('100,250');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-1-bulletin.png') });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    const bulletins = (await api('GET', `/entreprises/${cafe}/paie/bulletins?annee=2025`, associe)).corps.lignes as { mois: number; brut: string; net: string }[];
    expect(bulletins.map((b) => [b.mois, b.brut])).toEqual([[3, '1350.750']]);
    // Deux chemins, un chiffre : le net de l'écran est celui du serveur.
    const net = bulletins[0]?.net ?? '';
    await expect.poll(() => p.locator('table.pa-bulletins').innerText()).toMatch(new RegExp(net.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));

    // ── L'écriture de paie du mois existe, sans qu'on la passe ──────────────────────────────────────
    const ecritures = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { journal: string; date: string }[];
    expect(ecritures.filter((e) => e.journal === 'PAIE').map((e) => e.date)).toEqual(['2025-03-31']);
    await expect.poll(() => p.locator('#pa-ecrire').isDisabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-2-mois.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('un bulletin du client à trois primes et deux retenues, modifié au Cabinet : aucune ligne ne se perd, ni ses marques, ni son prorata, et il se calcule comme dans l\'entreprise', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps;
    const cabinet = String(cab.id);
    // Un client sur SkanFact (1.66.0 : pas un dossier tenu, dont les taux sont ceux que le Cabinet règle), qui confie au
    // cabinet sa comptabilité ET sa paie.
    const patron = await personne('client');
    const cafe = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Café des Arts' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${cafe}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);

    // Le bulletin de septembre 2026 tel que le SkanFact du client l'établit : entré le 15 (quatorze jours sur vingt-six,
    // 700 de brut), deux jours d'absence ; une prime au jour (douze jours payés), une prime d'heures supplémentaires (le
    // pointage), une prime non imposable ; deux retenues. Calculé par l'écran de l'entreprise (le même moteur), avec
    // le barème du client : un accident du travail à 2 %, une TFP à 1 % (1.64.0 : le Cabinet le garde en modifiant).
    type Calcul = Record<string, number>;
    const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Calcul; baremesPaie: (r: unknown) => unknown };
    const salarie = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1300, hireDate: '2026-09-15', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    const prorata = { jours: 14, sur: 26, motif: 'entrée le 15/09/2026', brutFiche: 1300, brut: 700 };
    const primes = [
      { label: 'Prime de présence', amount: 32.308, taxable: true, parJour: true, mensuel: 70, jours: 12, sur: 26 },
      { label: 'Heures supplémentaires : 8 h à +25 %', amount: 75.012, taxable: true, hs: 25, heures: 8 },
      { label: 'Prime de panier', amount: 20.5, taxable: false },
    ];
    const retenues = [{ label: 'Avance sur salaire', amount: 50 }, { label: 'Remboursement de prêt', amount: 25.5 }];
    const bareme = compta.baremesPaie({ accidentRate: 2, tfpRate: 1 });
    const calcul = (absence: number, bonuses: unknown[]) => compta.computePayslip(salarie, { gross: 700, workedDays: 26, absentDays: absence, bonuses, deductions: retenues, prorata }, bareme);
    const bulletin = { id: 'b-s1-2026-09', employeeId: 's1', year: 2026, month: 9, gross: 700, workedDays: 26, absentDays: 2, bonuses: primes, deductions: retenues,
      prorata, computed: calcul(2, primes), issuedAt: '2026-09-30', paidDate: '', accountId: '', method: 'virement', reference: '' };
    const ecrire = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${cafe}/paie/dossier`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    expect(await ecrire('employees', 's1', salarie)).toBe(200);
    // (1.67.0) Ses réglages de paie, ceux de ce calcul, dans son SkanFact : le Cabinet les lit.
    expect((await api('POST', `/entreprises/${cafe}/dossier-v10`, patron,
      { changements: [{ collection: '_racine', cle: 'payrollSettings', rang: null, revision: null, contenu: encoder({ accidentRate: 2, tfpRate: 1 }) }] })).statut).toBe(200);
    expect(await ecrire('payslips', bulletin.id, bulletin)).toBe(200);
    // Septembre validé : l'écriture de paie du mois porte son numéro (une écriture validée ne se modifie plus).
    expect((await api('POST', `/entreprises/${cafe}/compta/valider`, associe, { jusqua: '2026-09-30' })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const fenetre = p.locator('#modal-root .modal').last();
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('9');

    // ── Le bulletin du client, au Cabinet : listé dès l'ouverture du livre (il disait « Aucun salarié déclaré »),
    //    puis toutes ses lignes ─────────────────────────────────────────────────────────────────────
    await expect.poll(() => p.locator('table.pa-bulletins').innerText().catch(() => '')).toContain('Salarié Numéro Un');
    await expect.poll(async () => {
      if (!await p.locator('#bf').count()) {
        if (!await p.getByRole('menuitem').filter({ hasText: 'Modifier le bulletin' }).count()) await p.locator(`[data-rowmenu="PAIE:${bulletin.id}"]`).first().click({ timeout: 2_000 }).catch(() => {});
        await p.getByRole('menuitem').filter({ hasText: 'Modifier le bulletin' }).first().click({ timeout: 2_000 }).catch(() => {});
      }
      return p.locator('#bf').count();
    }, { timeout: 20_000 }).toBe(1);
    // (1.67.0) Ses taux d'aujourd'hui, lus dans son SkanFact, sont ceux du bulletin : pas de case « Prendre les taux de la
    // paie d'aujourd'hui ».
    expect(await fenetre.locator('#bf-taux').count()).toBe(0);
    const valeurs = (sel: string) => fenetre.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(await valeurs('#bf-primes [data-l=label]')).toEqual(primes.map((x) => x.label));
    expect(await valeurs('#bf-primes [data-l=amount]')).toEqual(['32,308', '75,012', '20,500']);
    expect(await fenetre.locator('#bf-primes [data-l=taxable]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked))).toEqual([true, true, false]);
    expect(await valeurs('#bf-retenues [data-l=label]')).toEqual(retenues.map((x) => x.label));
    expect(await valeurs('#bf-retenues [data-l=amount]')).toEqual(['50,000', '25,500']);
    expect(await fenetre.locator('#bf-primes [data-pj]').innerText()).toContain('au jour : 12 j payés sur 26');
    // Ce qu'enregistrer fera de l'écriture validée du mois se lit avant le geste.
    expect((await fenetre.locator('#bf-ecriture').innerText()).replace(/\s/g, ' ')).toBe('L\'écriture de paie de septembre est validée : enregistrer ce bulletin la contre-passe (au brouillard) et en écrit une nouvelle à côté.');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-3-lignes.png') });

    // Un jour d'absence de plus : la prime au jour suit (onze jours payés), le reste ne bouge pas.
    await fenetre.locator('[name=joursAbsence]').fill('3');
    await expect.poll(() => fenetre.locator('#bf-primes [data-pj]').innerText()).toContain('au jour : 11 j payés sur 26');
    expect(await valeurs('#bf-primes [data-l=amount]')).toEqual(['29,615', '75,012', '20,500']);
    // Ce que l'aperçu annonce, avant le geste : le net et le coût employeur que le serveur enregistrera (deux chemins, un
    // chiffre ; le coût employeur porte les taux patronaux du client, que le net ne voit pas).
    const apercu = (await fenetre.locator('#bf-apercu').innerText()).replace(/\s/g, '');
    const annonce = (motif: RegExp) => (apercu.match(motif)?.[1] ?? '?').replace(',', '.');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Bulletin enregistré.');

    // ── Le bulletin du dossier : ses cinq lignes, leurs marques, son prorata ; le serveur l'a refait ──────
    const objets = (await api('GET', `/entreprises/${cafe}/paie/dossier`, associe)).corps.objets as { collection: string; cle: string; contenu: unknown }[];
    const lu = decoder(objets.find((o) => o.collection === 'payslips')?.contenu) as typeof bulletin;
    const attendues = [{ ...primes[0], amount: 29.615, jours: 11 }, primes[1], primes[2]];
    expect(lu.bonuses).toEqual(attendues);
    expect(lu.deductions).toEqual(retenues);
    expect([lu.prorata, lu.absentDays, lu.gross]).toEqual([prorata, 3, 700]);
    // Calculé comme l'entreprise : l'absence au taux du salaire du contrat (1 300 × 3 / 26 = 150), au millime de son écran,
    // avec le barème du client (son accident du travail, sa TFP), pas celui du Cabinet.
    expect(lu.computed).toEqual(calcul(3, attendues));
    expect(lu.computed.absenceCut).toBe(150);
    expect([(lu.computed.rates as unknown as Record<string, number>).accidentRate, (lu.computed.rates as unknown as Record<string, number>).tfpRate]).toEqual([2, 1]);
    // Deux chemins, un chiffre : le net que le serveur a refait est celui de l'écran.
    const lignes = (await api('GET', `/entreprises/${cafe}/paie/bulletins?annee=2026`, associe)).corps.lignes as { mois: number; net: string }[];
    expect(lignes.map((l) => [l.mois, l.net])).toEqual([[9, Number(lu.computed.net).toFixed(3)]]);
    expect([annonce(/Netàpayer([\d,]+)DT/), annonce(/coûtemployeur([\d,]+)DT/)]).toEqual([Number(lu.computed.net).toFixed(3), Number(lu.computed.employerCost).toFixed(3)]);
    // L'écriture validée de septembre reste ; sa contre-passation et la nouvelle s'écrivent au brouillard, au premier
    // jour ouvert (septembre est clos).
    const ecritures = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { journal: string; date: string; statut: string; origine: { type: string } }[];
    expect(ecritures.filter((e) => e.journal === 'PAIE').map((e) => `${e.origine.type} ${e.date} ${e.statut}`).sort())
      .toEqual(['contre_passation 2026-10-01 brouillard', 'paie 2026-09-30 validee', 'paie 2026-10-01 brouillard']);

    // ── Les documents de la paie, ceux de l'entreprise (1.65.0), en PDF fait par le serveur (1.92.0), sous leur nom ──
    const net = Number(lu.computed.net).toFixed(3).replace('.', ',');
    const imprime = await pdfTelecharge(p, async () => {
      await p.locator(`[data-rowmenu="PAIE:${bulletin.id}"]`).first().click();
      await p.getByRole('menuitem').filter({ hasText: 'Imprimer le bulletin' }).first().click();
    });
    expect([imprime.nom, imprime.pages]).toEqual(['Bulletin_Salarié_Numéro_Un_2026-09.pdf', 1]);
    expect(imprime.texte).toContain('Bulletin de paie');
    expect(imprime.texte).toContain('Café des Arts');
    expect(imprime.texte).toContain('Salarié Numéro Un');
    expect(imprime.texte).toContain('Prime de présence (11 j sur 26)');
    // L'absence au taux du salaire du contrat (1 300 × 3 / 26 = 150).
    expect(imprime.texte).toContain('Absence (3 jours)');
    expect(imprime.texte).toMatch(/TAUX 1 300,000 .* − 150,000 /);
    expect(imprime.texte).toContain(`${net} DT`);
    // C'est le comptable qui l'imprime : pas d'« À faire valider par votre comptable ».
    expect(imprime.texte).not.toContain('À faire valider par votre comptable');
    await expect.poll(() => p.locator('#toast').innerText()).toBe('PDF enregistré : Bulletin_Salarié_Numéro_Un_2026-09.pdf');
    const journal = await pdfTelecharge(p, () => p.locator('#pa-journal').click());
    expect(journal.nom).toBe('Journal_de_paie_2026-09.pdf');
    expect(journal.texte).toContain('Journal de paie');
    expect(journal.texte).toContain('septembre 2026');
    expect(journal.texte).toContain('Salarié Numéro Un');
    expect(journal.texte).toContain('Nombre de salariés : 1');
    const etat = await pdfTelecharge(p, () => p.locator('#pa-etat').click());
    expect(etat.nom).toBe('Etat_recapitulatif_CNSS_2026-T3.pdf');
    expect(etat.texte).toContain('État récapitulatif des salaires déclarés');
    expect(etat.texte).toMatch(/Trimestre Année .* 3 2026 NOM ET ADRESSE/);
    expect(etat.texte).toContain('d\'après les bulletins du 3e trimestre 2026');
    // Un serveur sans l'outil (Chromium absent) : la fenêtre d'impression du navigateur revient, comme avant.
    await p.route('**/v1/pdf', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ motif: 'Le PDF ne se fait pas sur ce serveur.', bouton: null, indisponible: true }) }));
    const [fenetreImprimee] = await Promise.all([p.waitForEvent('popup'), p.locator('#pa-journal').click()]);
    await expect.poll(() => fenetreImprimee.content(), { timeout: 15_000 }).toContain('<h1>Journal de paie</h1>');
    await fenetreImprimee.close();
    await p.unroute('**/v1/pdf');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
