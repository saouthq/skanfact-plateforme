// La fiche d'un client de la maquette (1.200.0 ; docs/maquettes/clients.html, validée le 28/10/2026), à la souris et au
// téléphone, sur cinq clients qui ne se ressemblent pas :
//   - l'hôtel doit une facture à échoir (payée en partie, par chèque) et une en retard, relancée par un appel ; son encours
//     dépasse son plafond ; son délai de paiement est le sien (45 jours) et une facture neuve le reprend ;
//   - l'école a deux factures en retard et ni matricule ni e-mail ;
//   - la pâtisserie a payé trop ; la société de Lyon est à l'étranger ; l'huilerie n'a rien, et s'archive.
// Chaque fois : l'en-tête (le statut, la phrase, le bouton principal calculé), les bandeaux, les onglets et leurs nombres,
// la colonne de droite, le menu ⋯.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la fiche d\'un client, telle que la maquette', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fiche-client-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const jj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('l\'en-tête, les bandeaux, les onglets, la colonne de droite, le menu, archiver, le délai', async () => {
    const email = `fiche-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const depart = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number }[];
    const exemples = depart.filter((o) => o.collection === 'clients');
    if (exemples.length) await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: exemples.map((o) => ({ collection: 'clients', cle: o.cle, rang: null, revision: o.revision, contenu: null })) });
    const clients = [
      { id: 'c-lac', name: 'Hôtel du Lac', contact: 'Karim Jlassi', city: 'Sfax', address: 'Route de Tunis km 4', matricule: '0934561H/A/M/000', phone: '74 225 700', email: 'technique@hotel-lac.tn',
        withholdingRate: 0, creditLimit: 1000, paymentTermsDays: 45, code: 'CL-0007', notes: 'Paie le vendredi, par chèque.' },
      { id: 'c-pins', name: 'École Les Pins', contact: 'Amel Chaabane', city: 'Tunis', phone: '74 610 288' },
      { id: 'c-olivier', name: 'Huilerie Les Oliviers', contact: 'Nizar Triki', phone: '74 298 650', email: 'technique@huilerie.tn', matricule: '1402288T/A/M/000' },
      { id: 'c-mahdia', name: 'Pâtisserie Mahdia', contact: 'Rim Gharbi', city: 'Mahdia', matricule: '1187340M/A/M/000', phone: '73 680 114', email: 'rim@patisserie-mahdia.tn', withholdingRate: 0 },
      { id: 'c-lyon', name: 'Atelier Rhône', contact: 'Claire Morel', city: 'Lyon', phone: '+33 4 78 00 00 00', email: 'claire@atelier-rhone.fr', currency: 'EUR', lang: 'en' },
    ];
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: 20 + i, revision: null, contenu: c })) });
    // Cinq factures : l'hôtel 337,385 à échoir et 1 012,156 en retard de 10 j ; l'école 674,770 (45 j) et 337,385 (20 j) ;
    // la pâtisserie 337,385, payée 400 (62,615 de trop).
    const emises: [string, number, number, string][] = [['f1', 1, 20, 'c-lac'], ['f2', 2, -45, 'c-pins'], ['f3', 3, -10, 'c-lac'], ['f4', 1, -20, 'c-pins'], ['f5', 1, 10, 'c-mahdia']];
    const nets: Record<string, string> = { f1: '337.385', f2: '674.770', f3: '1012.156', f4: '337.385', f5: '337.385' };
    const apres: Record<string, Record<string, unknown>> = {
      f1: { payments: [{ id: 'p1', date: jour(-2), amount: { '~n': '100' }, method: 'cheque', reference: 'CH-2231', accountId: 'banque' }] },
      f3: { reminders: [{ date: jour(-3), level: 1, channel: 'tel', note: 'Il paie vendredi' }] },
      f5: { payments: [{ id: 'p5', date: jour(-1), amount: { '~n': '400' }, method: 'virement', reference: 'VIR-9', accountId: 'banque' }] },
    };
    for (const [i, [id, qty, ech, cl]] of emises.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: jour(-50 + i), dueDate: jour(ech), clientId: cl, createdAt: 10 + i,
        subject: `Maintenance ${i + 1}`, lines: [{ label: 'Maintenance', description: '', qty, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
        client: clients.find((c) => c.id === cl), revision: null, rang: i, netAPayer: nets[id] });
      expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
      if (apres[id]) {
        const r = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang: i, revision: Number(e.revision), contenu: { ...(e.contenu as Record<string, unknown>), ...apres[id] } }] });
        expect(JSON.stringify(r)).not.toMatch(/refus|erreur/i);
      }
    }
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const numero = (id: string) => String(objets.find((o) => o.collection === 'documents' && o.cle === id)?.contenu.number);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (id: string) => {
      await p.evaluate((h) => { location.hash = h; }, `#/client/${id}`);
      await expect.poll(() => p.locator('#view .cf-tete h1').innerText().catch(() => ''), { timeout: 20_000 }).toMatch(new RegExp(`^${clients.find((c) => c.id === id)?.name}`));
    };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#list-wrap tr[data-cid="c-lac"]').waitFor({ timeout: 20_000 });
    await plusTard(p);

    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const depuis = `client depuis ${MOIS[Number(jour(-50).slice(5, 7)) - 1]} ${jour(-50).slice(0, 4)}`;
    const titre = async () => net(await p.locator('#view .cf-tete .titre').innerText());
    const principal = () => p.locator('#view .btn-primary').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.trim()));
    const bandeaux = () => p.locator('#view .cf-bandeaux .banner').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    const onglets = () => p.locator('#view .cf-onglets button').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    const droite = () => p.locator('#view .cf-droite .cf-bloc').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    const onglet = async (o: string) => { await p.locator(`#view .cf-onglets [data-onglet="${o}"]`).click(); await expect.poll(() => p.locator(`#view .cf-onglets [data-onglet="${o}"]`).getAttribute('aria-selected')).toBe('true'); return net(await p.locator('#cf-onglet').innerText()); };
    const enHaut = () => p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); });

    // 1. L'hôtel : en retard sur une facture (relancée par un appel), payé en partie sur l'autre, au-delà de son plafond.
    await ouvrir('c-lac');
    expect(await titre()).toBe(`Accueil Clients Hôtel du Lac HL Hôtel du Lac En retard CL-0007 · Sfax · ${depuis} · te doit 1 249,541 DT dont 1 012,156 DT en retard`);
    expect(await principal()).toEqual([`Relancer ${numero('f3')}`]);
    expect(await bandeaux()).toEqual([
      `1 012,156 DT en retard depuis 10 jours — ${numero('f3')} échue le ${jj(jour(-10))} · dernière relance le ${jj(jour(-3))} (appel : « Il paie vendredi »). La prochaine est au niveau « Rappel ». Voir ses relances`,
      'Encours au-delà de son plafond : 1 249,541 DT pour 1 000,000 DT autorisés — une nouvelle facture le dira avant l\'émission ; tu émets quand même si tu veux : c\'est toi qui décides.']);
    expect(await onglets()).toEqual(['Documents 2', 'Paiements 1', 'Relances 1', 'Affaires et contrats', 'Matériel installé']);
    const [coord, cond, notes] = await droite();
    expect(coord).toBe('Coordonnées Modifier Contact Karim Jlassi Téléphone 74 225 700 E-mail technique@hotel-lac.tn Adresse Route de Tunis km 4 Sfax MF / CIN 0934561H/A/M/000');
    expect(cond).toBe('Ses conditions reprises sur chaque pièce Retenue i aucune Délai 45 jours après la facture Encours i 1 000,000 DT autorisés 1 249,541 DT pris : dépassé de 249,541 DT Prix ceux du catalogue Documents français · DT Timbre oui le montant vient de tes réglages');
    expect(notes).toContain('Notes internes jamais sur un document');
    expect(await p.locator('#cl-notes').inputValue()).toBe('Paie le vendredi, par chèque.');
    await enHaut();
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-client-1-en-retard.png') });
    expect(await onglet('paiements')).toBe(`1 paiement · 100,000 DT reçus Reçu le Sur Moyen Montant ${jj(jour(-2))} ${numero('f1')} Maintenance 1 Chèque CH-2231 100,000 DT Un paiement s'enregistre sur la facture qu'il règle.`.replace('Reçu le Sur Moyen Montant', 'REÇU LE SUR MOYEN MONTANT'));
    // « Voir ses relances » ouvre l'onglet ; on y relance la facture, et ce qui a été fait s'y lit.
    await onglet('pieces');
    await p.locator('#view .cf-bandeaux [data-onglet="relances"]').click();
    await expect.poll(() => p.locator('#view .cf-onglets [data-onglet="relances"]').getAttribute('aria-selected')).toBe('true');
    const rel = net(await p.locator('#cf-onglet').innerText());
    expect(rel).toContain(`${numero('f3')} Maintenance 3 ${jj(jour(-10))} 10 jours Rappel 1 012,156 DT ${jj(jour(-3))} appel, niveau 1 · 1 relance en tout Relancer`);
    expect(rel).toContain(`Ce qui a été fait LE FACTURE COMMENT CE QU'IL A DIT ${jj(jour(-3))} ${numero('f3')} Appel niveau 1 · Rappel Il paie vendredi`);
    await p.locator('#cf-onglet [data-relancer="f3"]').click();
    await p.locator('#modal-root .modal').waitFor({ timeout: 10_000 });
    expect(await p.locator('#modal-root .modal textarea').first().inputValue()).toContain(numero('f3'));
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    // Le menu ⋯ : ce qui ne mérite pas un bouton ; un client qui a des documents ne se supprime pas, il s'archive.
    await p.locator('#view .cf-tete [data-rowmenu]').click();
    expect(net(await p.locator('.row-menu').innerText())).toBe('Hôtel du Lac Modifier la fiche Coordonnées, conditions, retenue LUI ÉCRIRE Par e-mail technique@hotel-lac.tn Par WhatsApp 74 225 700 CRÉER POUR LUI Nouveau devis Pour Hôtel du Lac Nouvelle facture Elle reprend sa fiche Nouveau contrat récurrent Un brouillon préparé à chaque période Nouvelle affaire Pour suivre ce qu\'un chantier rapporte SES DOCUMENTS Relevé de compte… 1 249,541 DT encore dû Archiver Il sort de la liste et des choix ; ses documents restent Supprimer ce client impossible : 2 documents liés ; archive-le plutôt');
    await p.keyboard.press('Escape');

    // 2. L'école : deux factures en retard, ni matricule ni e-mail.
    await ouvrir('c-pins');
    expect(await titre()).toBe(`Accueil Clients École Les Pins ÉP École Les Pins En retard Tunis · ${depuis.replace(jour(-50).slice(5, 7), jour(-49).slice(5, 7))} · te doit 1 012,155 DT dont 1 012,155 DT en retard`);
    expect(await principal()).toEqual(['Lui envoyer son relevé · 2 en retard']);
    expect(await bandeaux()).toEqual([
      `1 012,155 DT en retard depuis 45 jours — ${numero('f2')} échue le ${jj(jour(-45))} · jamais relancée. La prochaine est au niveau « Relance ». Voir ses relances`,
      'Son matricule fiscal manque — le brouillon s\'écrit sans lui ; à l\'émission, El Fatoora le demandera. Pour un particulier, c\'est son numéro de CIN. Compléter la fiche']);
    expect(await onglets()).toEqual(['Documents 2', 'Paiements', 'Relances 2', 'Affaires et contrats', 'Matériel installé']);
    expect((await droite())[0]).toContain('E-mail à renseigner pour lui envoyer ses pièces et ses relances');
    expect((await droite())[1]).toContain('Délai 30 jours celui de tes réglages');
    await p.getByRole('button', { name: 'Lui envoyer son relevé · 2 en retard' }).click();
    await p.locator('#modal-root .modal').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#modal-root .modal').innerText())).toContain('École Les Pins');
    await p.keyboard.press('Escape');

    // 3. La pâtisserie a payé trop ; la société de Lyon est à l'étranger.
    await ouvrir('c-mahdia');
    expect(await titre()).toContain('Pâtisserie Mahdia En sa faveur Mahdia');
    expect(await titre()).toContain('· 62,615 DT en sa faveur');
    expect(await bandeaux()).toEqual([`62,615 DT payés en trop sur ${numero('f5')} — son compte le déduit déjà de ce qu'il te doit. Rends-les-lui depuis la facture, ou laisse-les à déduire de sa prochaine (À VÉRIFIER avec ton comptable). Ouvrir ${numero('f5')}`]);
    expect(await onglet('paiements')).toContain(`${numero('f5')} Maintenance 5 Virement VIR-9 400,000 DT`);
    await p.locator('#view .cf-bandeaux').getByRole('button', { name: `Ouvrir ${numero('f5')}` }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/doc/f5');
    await ouvrir('c-lyon');
    expect(await bandeaux()).toEqual(['Client à l\'étranger : ses pièces sont en EUR et en anglais — ce qu\'il doit se lit ici converti en DT. La mention qui justifie l\'exonération et le timbre d\'une facture à l\'export : À VÉRIFIER avec ton comptable.']);
    expect((await droite())[0]).toContain('MF / CIN sans matricule tunisien');

    // 4. L'huilerie n'a rien : « Nouveau », la prochaine pièce ; on l'archive, elle sort de la liste, puis revient.
    await ouvrir('c-olivier');
    expect(await titre()).toBe('Accueil Clients Huilerie Les Oliviers HO Huilerie Les Oliviers Nouveau aucun document pour l\'instant');
    expect(await principal()).toEqual(['Nouvelle facture']);
    expect(await bandeaux()).toEqual([]);
    expect(await onglet('relances')).toBe('Rien à relancer Il ne te doit rien. Une facture échue et pas payée vient ici, et dans la page Relances.');
    await p.locator('#view .cf-tete [data-rowmenu]').click();
    await p.getByRole('menuitem').filter({ hasText: 'Archiver' }).click();
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toMatch(/^Huilerie Les Oliviers est archivé : il sort de la liste et des choix d'une pièce ; ses documents restent\./);
    expect(await bandeaux()).toEqual([`Client archivé le ${jj(jour(0))} — il n'est plus dans la liste ni dans les choix d'une pièce ; ses documents restent. Le remettre dans la liste`]);
    expect(await titre()).toContain('Huilerie Les Oliviers Archivé');
    await p.evaluate(() => { location.hash = '#/clients'; });
    await p.locator('#list-wrap tr[data-cid="c-lac"]').waitFor({ timeout: 20_000 });
    expect(await p.locator('#list-wrap tr[data-cid="c-olivier"]').count()).toBe(0);
    expect(net(await p.locator('#lf-barre .segment').innerText())).toBe('Tous Te doivent 2 En retard 2 À compléter 1 Sans document 1 Archivés 1');
    await p.locator('#lf-barre .segment [data-f="archives"]').click();
    expect(await p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-olivier']);
    await p.locator('#list-wrap tr[data-cid="c-olivier"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/client/c-olivier');
    await p.locator('#cf-desarchiver').click();
    await expect.poll(() => bandeaux()).toEqual([]);
    expect(await titre()).toContain('Huilerie Les Oliviers Nouveau');

    // 5. Le délai de sa fiche donne l'échéance d'une facture neuve ; sans délai, celui des réglages.
    for (const [id, j] of [['c-lac', 45], ['c-pins', 30]] as const) {
      await p.evaluate((h) => { location.hash = h; }, `#/doc/new/facture/client/${id}`);
      await expect.poll(() => p.locator('#view input[name=dueDate]').inputValue().catch(() => ''), { timeout: 15_000 }).toBe(jour(j));
    }

    // 6. Au téléphone : une colonne, rien ne déborde, le geste principal en tête.
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await tel.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await tel.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(e.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c-lac`);
    await t.locator('#view .cf-tete h1').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await t.locator('#view .cf-tete .btn-primary').isVisible()).toBe(true);
    await t.screenshot({ path: path.join(PHOTOS, 'fiche-client-2-telephone.png') });
    await tel.close();
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
