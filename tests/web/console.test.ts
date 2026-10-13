// La console de l'équipe SkanFact, à la souris (Console 1 ; docs/console.md ; serveur/console ; web/console). Ce que le
// parcours vérifie, écran ET serveur :
//   - l'entrée en deux étapes, le mot de passe puis le code du téléphone ; un membre sans code en place est refusé avec
//     la raison, sans qu'aucun champ ne soit montré faux (son mot de passe était bon) ;
//   - l'accueil : « À décider » le plus urgent en haut (le problème grave du service), ses filtres ; chaque chiffre du
//     tableau du matin ouvre la liste qu'il compte, du même nombre — les inscriptions de la semaine comprises, avec un
//     filtre qui se voit et se retire ;
//   - la fiche d'un client : « Prolonger l'essai », l'aperçu calculé au serveur, un motif exigé, puis l'essai prolongé
//     dans la base, son histoire (le motif, l'auteur) et sa ligne au journal ;
//   - le support : de 7 à 30 jours ; hors des bornes, l'aperçu le dit À SA PLACE (le motif ne bouge pas sous la souris),
//     un clic à côté ne ferme pas la fenêtre ; après son geste, la pastille de « À décider » se recompte, et le menu des
//     gestes, vide, n'est plus le bouton principal ;
//   - la technique : l'accueil et le service seulement ; « Clients » lui dit que ce n'est pas son rôle ;
//   - les abonnements : chaque carte ouvre la liste qu'elle compte, du même nombre (C3) ;
//   - les cabinets : passer d'un onglet à l'autre ne déplace pas les onglets ; la liste compte ce que la fiche montre ;
//     l'aperçu d'un cabinet mène à ses dossiers filtrés, et le filtre se retire ; la fiche d'un client mène à son cabinet ; une
//     adresse qui ne mène à aucun cabinet le dit, et mène à la liste ;
//   - en clair et en sombre, à l'ordinateur (1440) et au téléphone (390) : l'instrument de rendu ne trouve rien, l'écran
//     des alertes du service et la fenêtre d'une sourdine compris (de vraies alertes, posées par la porte de la veille) ;
//     en langue factice, chaque texte vient du catalogue ;
//   - le service des écrans de l'application ne garde jamais la console.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { LISTE_GESTES_CONSOLE } from '../../serveur/console/gestes.ts';
import { problemes } from '../instrument-rendu.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
// Le texte d'un écran, ses espaces (fines, insécables, retours) ramenées à une seule.
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const jourCourt = (iso: string) => iso.split('-').reverse().join('/');

// En langue factice, chaque texte visible vient du catalogue (⟦…⟧), sauf les données (data-donnee) ; chaque nom donné
// aux lecteurs d'écran aussi (tests/web/rendu.test.ts).
function horsCatalogue(): string[] {
  const pb: string[] = [];
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const texte = (n.textContent ?? '').trim();
    if (!/\p{L}{2,}/u.test(texte) || n.parentElement?.closest('[data-donnee], script, style')) continue;
    if (!texte.includes('⟦')) pb.push(texte.slice(0, 60));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!(el.getAttribute('aria-label') ?? '').includes('⟦')) pb.push(`aria-label « ${el.getAttribute('aria-label')} »`);
  }
  return pb;
}

// Ce que l'instrument de rendu ne mesure pas, et que le téléphone a montré : une carte de liste qui garde sa marge (elle
// s'ajoutait à celle de son contenu : 36 points perdus de chaque côté au lieu de 18) ; deux noms de mois du petit
// graphique d'une fiche qui se chevauchent (« 11/2512/26… »). Le texte d'un mois se mesure par son étendue, pas par sa
// case : il en déborde.
function auTelephone(): string[] {
  const pb: string[] = [];
  for (const c of document.querySelectorAll<HTMLElement>('.c-liste-carte, .c-decider')) {
    const marge = getComputedStyle(c).paddingInlineStart;
    if (marge !== '0px') pb.push(`une carte de liste garde sa marge (${marge}) : ${c.className}`);
  }
  const mois = [...document.querySelectorAll<HTMLElement>('.c-barre-mois')].filter((m) => getComputedStyle(m).visibility !== 'hidden').map((m) => {
    const r = document.createRange();
    r.selectNodeContents(m);
    return r.getBoundingClientRect();
  });
  for (let i = 1; i < mois.length; i++) {
    const a = mois[i - 1], b = mois[i];
    if (a && b && b.left < a.right - 0.5) pb.push(`deux mois du graphique se chevauchent (le ${i}e et le ${i + 1}e)`);
  }
  return pb;
}

type Membre = { email: string; prenom: string; nom: string; secret: string };

describe('la console de l\'équipe, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-veille-')), 'veille.json');
  const aujourdhui = aujourdhuiATunis();
  const erreurs: string[] = [];
  let n = 0;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Un compte SkanFact, avec ou sans son code d'application ; dans l'équipe si on lui donne un rôle (par l'outil de
  // l'exploitation, comme le premier membre se pose).
  const membre = async (prenom: string, role: 'direction' | 'support' | 'technique', avecCode = true): Promise<Membre> => {
    const email = `console-web-${prenom.toLowerCase()}-${Date.now()}-${++n}@exemple.tn`;
    const nom = `${prenom} Essai`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = avecCode ? /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '' : '';
    await ajouterALEquipe(admin, email, role, 'essai de la console à la souris');
    return { email, prenom, nom, secret };
  };
  const code = (m: Membre) => codeTotp(depuisBase32(m.secret), Date.now());
  // Le jeton de la console d'un membre, par l'API (l'entrée à la souris se vérifie une fois, plus bas).
  const jetonConsole = async (m: Membre) => {
    const r = await api('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: code(m) });
    return String(c.corps.jeton);
  };
  // Une personne inscrite et connectée à l'application : son adresse et son jeton.
  const personne = async (sorte: string) => {
    const email = `console-web-${sorte}-${Date.now()}-${++n}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `${sorte} ${n}`, motDePasse: MDP });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  const inscrite = async (sorte: string) => (await personne(sorte)).jeton;
  const exiger = (r: { statut: number; corps: Record<string, unknown> }, statut: number) => {
    if (r.statut !== statut) throw new Error(`attendu ${statut}, reçu ${r.statut} : ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Une entreprise inventée, et l'état de son abonnement posé comme le temps l'aurait fait.
  const entreprise = async (nom: string, essaiDans: number, autre: { payeDans?: number; offre?: 'essentiel' | 'complet'; emise?: boolean } = {}) => {
    const jeton = await inscrite('proprio');
    const id = String((await api('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
    // Une facture émise aujourd'hui : sans pièce émise, la fiche ne dessine pas ses douze mois, et rien ne les mesure.
    if (autre.emise) {
      await api('GET', `/entreprises/${id}/dossier-v10`, jeton);
      const client = { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana' };
      await api('POST', `/entreprises/${id}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client }] });
      const r = await api('POST', `/entreprises/${id}/dossier-v10/emettre`, jeton, { document: { id: 'f0', type: 'facture', number: '', status: 'brouillon', date: new Date().toISOString().slice(0, 10), clientId: 'c1', createdAt: 1,
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 1, unit: 'sac', unitPrice: 25, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
      client, revision: null, rang: 0, netAPayer: '29.750' });
      if (r.statut !== 200) throw new Error(`la facture du jeu n'est pas émise : ${JSON.stringify(r.corps)}`);
    }
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = current_date + $2::int,
        paye_jusqu_au = case when $3::int is null then null else current_date + $3::int end, offre = $4, periodicite = $5 where entreprise = $1`,
    [id, essaiDans, autre.payeDans ?? null, autre.offre ?? null, autre.offre ? 'annuel' : null]);
    return id;
  };
  // Le nombre d'entreprises de la liste des clients, tel que sa ligne de compte le dit : « 1–50 sur 61 entreprises »,
  // « 13 entreprises », « une entreprise ».
  const totalClients = async (q: Page) => {
    const t = net(await q.locator('.c-liste-resume b').first().innerText());
    return Number(/sur (\d+)/.exec(t)?.[1] ?? /^(\d+) /.exec(t)?.[1] ?? (/^une /i.test(t) ? 1 : Number.NaN));
  };
  // Une page de la console, à une largeur, un thème et une langue, avec la session d'un membre.
  const ouvrir = async (jeton: string | null, hash: string, o: { largeur?: number; theme?: 'clair' | 'sombre'; factice?: boolean } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      if (j) sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${hash}`);
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const ecrire = (problemes: Record<string, unknown>) => fs.writeFileSync(veille, JSON.stringify({ problemes }));
  // Ce que la veille voit à l'instant (son fichier) : deux problèmes qu'aucune alerte de la base ne porte encore.
  const PROBLEMES = {
    disque: { titre: 'Le disque est plein à 82 %', grave: false, faire: 'Libère de la place avant 90 %.', depuis: new Date(Date.now() - 3 * 3600_000).toISOString() },
    sauvegarde: { titre: 'La copie hors machine de cette nuit n\'est pas arrivée', grave: true, faire: 'Relance la sauvegarde, puis vérifie la copie.', depuis: new Date(Date.now() - 40 * 60_000).toISOString() },
  };

  // Un cabinet inventé : son associé (le code du téléphone en place, son rôle l'exige), un dossier qu'il tient, un client
  // qui lui a donné son mandat, un autre qui le lui propose.
  const cabinetSeul = async (nom: string) => {
    const associe = await inscrite('associe');
    exiger(await api('POST', '/moi/code', associe, { methode: 'application' }), 200);
    return { associe, cab: exiger(await api('POST', '/cabinets', associe, { nom }), 201) };
  };
  const cabinetAvecDossiers = async (nom: string) => {
    const { associe, cab } = await cabinetSeul(nom);
    // Une collaboratrice invitée, qui accepte : l'équipe compte deux personnes.
    const collab = await personne('collaboratrice');
    const invitation = exiger(await api('POST', `/cabinets/${String(cab.id)}/invitations`, associe, { email: collab.email, role: 'revision' }), 201);
    exiger(await api('POST', '/invitations/accepter', collab.jeton, { jeton: invitation.jeton }), 200);
    const id = String(cab.id);
    const tenu = String(exiger(await api('POST', `/cabinets/${id}/dossiers`, associe, { raisonSociale: 'Cordonnerie de la Console' }), 201).entreprise);
    const client = await inscrite('proprio');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Librairie de la Console' })).corps.id);
    const mandat = String(exiger(await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.code) }), 201).mandat);
    exiger(await api('POST', `/cabinets/${id}/mandats/${mandat}/accepter`, associe), 200);
    const attente = await inscrite('proprio');
    const entAttente = String((await api('POST', '/entreprises', attente, { raisonSociale: 'Pressing de la Console' })).corps.id);
    exiger(await api('POST', `/entreprises/${entAttente}/mandat`, attente, { codeCabinet: String(cab.code) }), 201);
    return { id, nom, client: ent, tenu };
  };

  let direction: Membre, support: Membre, technique: Membre, sansCode: Membre;
  let essaiCalme = '', essaiSupport = '', enLecture = '', abonnee = '';
  let cabinet: Awaited<ReturnType<typeof cabinetAvecDossiers>>;

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    ecrire(PROBLEMES);
    // Les alertes du service, par la porte de la veille : une grave et une à regarder, leurs étapes, ce qui est parti, et
    // qui est prévenu (masqué). Les tables du service sont communes à la base de test : on part de tables vides.
    await admin.query('truncate plateforme.service_releve, plateforme.service_alerte, plateforme.service_envoi, plateforme.service_sourdine, plateforme.service_demande');
    const il = (min: number) => new Date(Math.floor(Date.now() / 60_000) * 60_000 - min * 60_000).toISOString();
    await admin.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)', [
      JSON.stringify({ minute: il(1), repond: true, charge: 0.4, memoire: 40, processeurs: 2, disques: [{ point: '/var', pourcent: 82 }], version: 'abcdef1', certificat: null, archiveLe: null,
        destinataires: { courriel: { a: 'e•••@•••.tn', pret: true }, sms: { a: '+216 •• ••• 456', pret: false } }, regles: { pannes: { etat: 'calme', part: 0, n: 40 }, temps: { etat: 'trop_peu', p95: null, lectures: 4 } } }),
      JSON.stringify({
        'hors-machine': { titre: 'la copie hors de la machine est en retard de 90 minutes', grave: true, regle: 'hors-machine', faire: 'f', depuis: il(90),
          etapes: [{ texte: 'Sur le serveur, l\'état de la copie :', code: 'sudo systemctl status skanfact-hors-machine' }, { texte: 'La procédure : docs/mise-en-ligne.md, I.' }] },
        'disque:/var': { titre: 'le disque /var est plein à 82 %', grave: false, regle: 'disques', faire: 'f', depuis: il(180),
          etapes: [{ texte: 'Libère de la place. Ce qui le remplit :', code: 'sudo du -xhd1 /var | sort -h | tail -n 8' }] },
      }), '[]',
      JSON.stringify([{ le: il(90), sorte: 'nouveau', cle: 'hors-machine', titre: 't', depuis: il(90), grave: true, courriel: true, sms: false }]),
    ]);
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    direction = await membre('Amira', 'direction');
    support = await membre('Karim', 'support');
    technique = await membre('Youssef', 'technique');
    sansCode = await membre('Salma', 'technique', false);
    essaiCalme = await entreprise('Quincaillerie de la Console', 2);
    essaiSupport = await entreprise('Boulangerie du Support', 2);
    enLecture = await entreprise('Pharmacie en Lecture Seule', -9);
    // Inscrite il y a plus d'une semaine : hors de la tuile « Inscriptions », pour que retirer son filtre se voie.
    const ancienne = await entreprise('Clinique Abonnée', -200, { payeDans: 160, offre: 'complet', emise: true });
    abonnee = ancienne;
    await admin.query('update socle.entreprise set cree_le = cree_le - interval \'200 days\' where id = $1', [ancienne]);
    cabinet = await cabinetAvecDossiers('Cabinet de la Console');
    // Un second cabinet, sans dossier : la recherche a quelque chose à écarter.
    await cabinetSeul('Fiduciaire Témoin');
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  // La veille écrit chaque minute : sans elle, au bout de cinq minutes, la console la dirait silencieuse.
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'entrée : le mot de passe puis le code du téléphone ; sans code en place, la raison, et aucun champ montré faux', async () => {
    const p = await ouvrir(null, '#/');
    expect(net(await p.locator('h1').first().innerText())).toBe('Se connecter à la console');
    // Sans code du téléphone : refusé avec sa raison, « Ton compte » entre guillemets, et le mot de passe n'est pas faux.
    await p.getByLabel('Ton adresse e-mail', { exact: true }).fill(sansCode.email);
    await p.getByLabel('Ton mot de passe', { exact: true }).fill(MDP);
    await cliquer(p.getByRole('button', { name: 'Continuer', exact: true }));
    const refus = p.locator('.c-alerte-danger');
    await expect.poll(() => refus.innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/code du téléphone/);
    expect(await refus.innerText()).toContain('«\u202fTon compte\u202f»');
    expect(await p.locator('.c-champ-faute').count()).toBe(0);
    // La direction : le mot de passe, puis le code de son application, et la console s'ouvre à son nom.
    await p.getByLabel('Ton adresse e-mail', { exact: true }).fill(direction.email);
    await cliquer(p.getByRole('button', { name: 'Continuer', exact: true }));
    await p.getByLabel('Le code', { exact: true }).fill(code(direction));
    await cliquer(p.getByRole('button', { name: 'Ouvrir la console', exact: true }));
    await expect.poll(() => p.locator('h1').first().innerText(), { timeout: 15_000 }).toBe(`Bonjour ${direction.prenom}`);
    expect(net(await p.locator('.c-trace').innerText())).toBe('Chaque geste est tracé, à ton nom.');
    await fermer(p);
  }, 60_000);

  it('l\'accueil : le plus urgent en haut, ses filtres, et chaque chiffre ouvre la liste qu\'il compte', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/');
    const decider = p.locator('.c-decider .c-ligne-decision');
    await expect.poll(() => decider.count(), { timeout: 15_000 }).toBeGreaterThan(1);
    // Le problème grave du service passe en tête, marqué urgent.
    expect(net(await decider.first().innerText())).toContain('La copie hors machine de cette nuit n\'est pas arrivée');
    expect(net(await decider.first().locator('.c-puce').first().innerText())).toBe('Urgent');
    // À côté, les relances que le serveur a envoyées seul depuis hier (ici aucune) : la colonne le dit.
    await expect.poll(() => p.locator('.c-relances').innerText().then(net).catch(() => '')).toContain('Les relances parties depuis hier');
    expect(net(await p.locator('.c-relances').innerText())).toContain('Aucune relance n\'est partie depuis hier');
    // Le filtre « Clients » ne garde que les clients.
    await cliquer(p.locator('.c-decider .c-pilule', { hasText: 'Clients' }));
    await expect.poll(async () => (await decider.allInnerTexts()).some((t) => t.includes('La copie hors machine'))).toBe(false);
    // Un chiffre du tableau, et la liste qu'il ouvre : le même nombre.
    const totalDe = totalClients;
    for (const [tuile, adresse] of [['En lecture seule', 'etat=lecture_seule'], ['Inscriptions', 'nouvelles=1']] as const) {
      await p.goto(`${serveur.adresse}/console/#/`);
      const t = p.locator('a.c-tuile', { hasText: tuile });
      await expect.poll(() => t.count(), { timeout: 15_000 }).toBe(1);
      const valeur = Number(await t.locator('.c-tuile-valeur').innerText());
      await cliquer(t);
      await expect.poll(() => p.evaluate(() => location.hash)).toContain(adresse);
      await expect.poll(() => totalDe(p).catch(() => NaN), { timeout: 15_000 }).toBe(valeur);
    }
    // Le filtre des inscriptions se voit, et se retire : la liste revient à toutes les entreprises.
    const nouvelles = await totalDe(p);
    await cliquer(p.getByRole('button', { name: 'Retirer ce filtre', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).not.toContain('nouvelles');
    await expect.poll(() => totalDe(p).catch(() => NaN), { timeout: 15_000 }).toBeGreaterThan(nouvelles);
    await fermer(p);
    void enLecture;
  }, 90_000);

  it('les clients : chaque vue du métier ouvre la liste qu\'elle compte ; chaque ligne dit son échéance et ce qu\'elle rapporte ; le tri suit l\'adresse', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/clients');
    const carte = (v: string) => p.locator('.c-vue', { has: p.locator(`.c-point-v-${v}`) });
    await expect.poll(() => carte('tout').getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true');
    // Les cartes se comptent avec la liste : on attend qu'elles soient lues avant de les croire.
    const nDe = (v: string) => carte(v).locator('.c-vue-n').innerText().then(Number);
    await expect.poll(() => nDe('tout'), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => totalClients(p).catch(() => Number.NaN), { timeout: 15_000 }).toBe(await nDe('tout'));
    // Les deux essais qui finissent dans deux jours sans une pièce sont à appeler ; la cordonnerie que tient le cabinet
    // est à convertir. Chaque carte, cliquée : sa liste, lue au serveur pour CETTE vue, compte ce qu'elle annonçait.
    for (const v of ['a_appeler', 'tenus', 'tout']) {
      const n = await nDe(v);
      expect(n).toBeGreaterThan(v === 'a_appeler' ? 1 : 0);
      const lue = p.waitForResponse((r) => r.url().includes('/console/entreprises?') && (v === 'tout' ? !r.url().includes('vue=') : r.url().includes(`vue=${v}`)));
      await cliquer(carte(v));
      await lue;
      await expect.poll(() => totalClients(p).catch(() => Number.NaN), { timeout: 15_000 }).toBe(n);
      expect(await carte(v).getAttribute('aria-pressed')).toBe('true');
      expect(await p.evaluate(() => location.hash)).toBe(v === 'tout' ? '#/clients' : `#/clients?vue=${v}`);
    }
    // La clinique abonnée : son renouvellement dans 160 jours, et 690 DT hors taxes par an au prix du jour. La pharmacie
    // en lecture seule n'a plus d'échéance : la colonne État dit depuis quand, et la date n'est écrite qu'une fois.
    // (La base des tests est commune : chaque ligne se trouve par la recherche, jamais par son rang.)
    const ligne = async (nom: string) => {
      await p.getByRole('searchbox').fill(nom);
      const l = p.locator('.c-table-clients tbody tr', { hasText: nom });
      await expect.poll(() => p.locator('.c-table-clients tbody tr').count().then(async (n) => n === 1 && await l.count() === 1), { timeout: 15_000 }).toBe(true);
      return l;
    };
    const clinique = await ligne('Clinique Abonnée');
    expect(net(await clinique.locator('.c-cl-echeance').innerText())).toBe(`${jourCourt(plusJours(aujourdhui, 160))} dans 160 jours`);
    expect(net(await clinique.locator('.c-cl-par-an').innerText())).toBe('690,000 DT');
    // Ce que rapporte la sélection : la clinique seule, abonnée à l'année au Complet.
    expect(net(await p.locator('.c-liste-resume p').innerText())).toBe('Une entreprise · un abonnement actif dans la sélection : 690,000 DT hors taxes par an');
    const pharmacie = await ligne('Pharmacie en Lecture Seule');
    expect(net(await pharmacie.locator('.c-cl-echeance').innerText())).toBe('—');
    expect(net(await pharmacie.innerText())).toContain(`Depuis le ${jourCourt(plusJours(aujourdhui, -1))}`);
    const quincaillerie = await ligne('Quincaillerie de la Console');
    expect(net(await quincaillerie.innerText()).split(jourCourt(plusJours(aujourdhui, 2))).length).toBe(2);
    await p.getByRole('searchbox').fill('');
    // Le tri par échéance : la plus proche d'abord, et l'adresse le garde.
    await p.locator('.c-tri select').selectOption('echeance');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/clients?tri=echeance');
    const dates = async () => (await p.locator('.c-cl-echeance b').allInnerTexts()).map((t) => t.split('/').reverse().join('-'));
    await expect.poll(async () => { const d = await dates(); return d.length > 1 && d.every((x, i) => i === 0 || (d[i - 1] ?? '') <= x); }, { timeout: 15_000 }).toBe(true);
    await fermer(p);
  }, 90_000);

  it('la fiche : prolonger un essai, avec l\'aperçu du serveur et un motif ; la base, l\'histoire et le journal le disent', async () => {
    const p = await ouvrir(await jetonConsole(direction), `#/clients/${essaiCalme}`);
    const finAvant = plusJours(aujourdhui, 2);
    await cliquer(p.locator('.c-menu > button'));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Prolonger l\'essai' }));
    const fenetre = p.getByRole('dialog');
    await expect.poll(() => fenetre.count()).toBe(1);
    // L'aperçu : la fin d'après, calculée par le serveur (30 jours par défaut pour la direction).
    const apres = jourCourt(plusJours(finAvant, 30));
    await expect.poll(() => fenetre.locator('.c-apercu').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain(apres);
    // Sans motif : refusé, et le curseur va au motif.
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => fenetre.locator('.c-alerte-danger').innerText().catch(() => '')).toMatch(/motif/i);
    expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    await fenetre.getByLabel('Motif', { exact: true }).fill('Le client attend son comptable');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe('C\'est fait : essai prolongé.');
    await expect.poll(() => fenetre.count()).toBe(0);
    // La base, puis l'histoire de la fiche, dans son onglet « Journal » : le geste, le motif, l'auteur.
    const lu = (await admin.query('select essai_jusqu_au::text j from plateforme.abonnement where entreprise = $1', [essaiCalme])).rows[0] as { j: string };
    expect(lu.j).toBe(plusJours(finAvant, 30));
    await cliquer(p.locator('.c-onglets a', { hasText: 'Journal' }));
    await expect.poll(() => p.evaluate(() => location.hash)).toContain('onglet=journal');
    const premier = p.locator('.c-histoire li').first();
    await expect.poll(() => premier.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Essai prolongé');
    expect(net(await premier.innerText())).toContain('Le client attend son comptable');
    expect(net(await premier.innerText())).toContain(direction.nom);
    // Le journal de la console : la même ligne, avec son motif.
    await p.goto(`${serveur.adresse}/console/#/journal?entreprise=${essaiCalme}`);
    const ligne = p.locator('.c-table tbody tr:not(.c-table-jour)').first();
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Le client attend son comptable');
    expect(net(await ligne.innerText())).toContain('Essai prolongé');
    await p.screenshot({ path: path.join(PHOTOS, 'console-journal.png'), fullPage: true });
    await fermer(p);
  }, 90_000);

  it('le support : de 7 à 30 jours, dit à sa place ; un clic à côté ne ferme pas la fenêtre ; la pastille se recompte', async () => {
    const p = await ouvrir(await jetonConsole(support), `#/clients/${essaiSupport}`);
    // Le support ne voit que ses écrans : « À décider », « Clients » et « Abonnements ».
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net)).toEqual(expect.arrayContaining(['Clients', 'Abonnements']));
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net).some((t) => /Équipe|Journal|Service/.test(t))).toBe(false);
    const pastille = p.locator('.c-nav-compte');
    await expect.poll(() => pastille.innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^\d+$/);
    const avant = Number(await pastille.innerText());
    // Ce qui attend pour ce client : la ligne d'« À décider » qui le nomme, sans son nom (c'est sa fiche), avec le geste
    // qui y répond en vert — le seul vert de la fiche ; le menu des gestes ne l'est jamais.
    const attend = p.locator('.c-fiche-attend li');
    await expect.poll(() => attend.count(), { timeout: 10_000 }).toBe(1);
    expect(net(await attend.innerText())).toContain('Un essai qui finit sans avoir servi');
    expect(net(await attend.innerText())).not.toContain('Boulangerie du Support');
    expect(await p.locator('main .c-btn-principal').count()).toBe(1);
    expect(await attend.locator('.c-btn-principal').count()).toBe(1);
    await cliquer(p.locator('.c-menu > button'));
    expect(await p.locator('.c-menu-liste button').allInnerTexts()).toEqual(['Prolonger l\'essai']);
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Prolonger l\'essai' }));
    const fenetre = p.getByRole('dialog');
    const motif = fenetre.getByLabel('Motif', { exact: true });
    await expect.poll(() => fenetre.locator('.c-apercu').count(), { timeout: 10_000 }).toBe(1);
    const yAvant = (await motif.boundingBox())?.y ?? -1;
    // 45 jours : hors des bornes du support. L'aperçu le dit à sa place, le motif ne bouge pas, le geste est éteint.
    await fenetre.getByLabel('Nombre de jours', { exact: true }).fill('45');
    await expect.poll(() => fenetre.locator('.c-apercu-refus').innerText().then(net).catch(() => '')).toBe('De 7 à 30 jours pour le support : au-delà, c\'est la direction qui prolonge.');
    expect(Math.abs(((await motif.boundingBox())?.y ?? 0) - yAvant)).toBeLessThan(2);
    expect(await fenetre.locator('.c-dialogue-pied .c-btn-principal').isDisabled()).toBe(true);
    // Un clic à côté de la fenêtre : elle reste, avec ce qu'on a tapé.
    await p.mouse.click(8, 450);
    expect(await fenetre.count()).toBe(1);
    expect(await fenetre.getByLabel('Nombre de jours', { exact: true }).inputValue()).toBe('45');
    // 14 jours, un motif : le geste se fait.
    await fenetre.getByLabel('Nombre de jours', { exact: true }).fill('14');
    await expect.poll(() => fenetre.locator('.c-apercu').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain(jourCourt(plusJours(aujourdhui, 16)));
    await motif.fill('Le client attend son comptable');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(0);
    // L'essai sans usage de la semaine n'est plus à décider : la pastille se recompte, et la fiche ne le dit plus.
    await expect.poll(() => pastille.innerText().then(Number).catch(() => 0), { timeout: 15_000 }).toBe(avant - 1);
    await expect.poll(() => p.locator('.c-fiche-attend').count(), { timeout: 10_000 }).toBe(0);
    // Un second « prolonger » n'est plus permis au support : le menu le dit, et n'est plus le bouton principal.
    await expect.poll(() => p.locator('.c-menu > button').getAttribute('class'), { timeout: 10_000 }).not.toContain('c-btn-principal');
    await cliquer(p.locator('.c-menu > button'));
    expect(await p.locator('.c-menu-liste button').count()).toBe(0);
    expect(net(await p.locator('.c-menu-note').innerText())).toMatch(/une fois par entreprise/);
    await fermer(p);
  }, 90_000);

  it('le journal : qui se choisit d\'un clic ; chaque geste porte sa famille ; l\'avant barré au-dessus de l\'après ; un jour se dit comme on le dit', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/journal');
    const lignes = p.locator('.c-table-journal tbody tr:not(.c-table-jour)');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    // Le jour d'aujourd'hui se nomme « Aujourd'hui · mardi 13 octobre », sans l'année du jour.
    expect(net(await p.locator('.c-table-jour').first().innerText())).toMatch(/^Aujourd'hui · \S+ \d{1,2} \S+( · (un geste|\d+ gestes))?$/);
    // La prolongation de la fiche : la famille « Abonnements », la fin d'essai d'avant barrée, la nouvelle dessous.
    const prolongation = lignes.filter({ hasText: 'Essai prolongé' }).first();
    expect(net(await prolongation.locator('.c-jr-famille').innerText())).toBe('Abonnements');
    expect(await prolongation.locator('.c-changes-empile del').count()).toBeGreaterThan(0);
    expect(net(await prolongation.innerText())).not.toContain('→');
    // Qui se choisit d'un clic : seulement les gestes de ce membre, et sa pilule le dit.
    const pilule = p.locator('.c-jr-qui .c-pilule', { hasText: support.nom });
    const lue = p.waitForResponse((r) => r.url().includes('/console/journal?') && r.url().includes('qui='));
    await cliquer(pilule);
    await lue;
    await expect.poll(() => pilule.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(async () => {
      const qui = await p.locator('.c-jr-qui-cellule').allInnerTexts();
      return qui.length > 0 && qui.every((t) => t.includes(support.nom));
    }, { timeout: 15_000 }).toBe(true);
    await fermer(p);
  }, 90_000);

  it('l\'équipe : ce que chaque rôle ouvre vient des gestes du serveur ; le menu d\'une ligne s\'ouvre entier, même au bas de l\'écran', async () => {
    const jeton = await jetonConsole(direction);
    // L'attendu vient de la liste des gestes elle-même, jamais de ce que la route en rend : c'est la route qu'on éprouve.
    const lu = { droits: LISTE_GESTES_CONSOLE.filter((g) => g.code !== 'console.session') };
    const p = await ouvrir(jeton, '#/equipe');
    const droits = p.locator('.c-eq-droits tbody tr');
    await expect.poll(() => droits.count(), { timeout: 15_000 }).toBe(lu.droits.length);
    // Une ligne par geste du serveur, dans son ordre ; un « oui » là où le rôle l'a, un tiret sinon — et la nuance du
    // support (prolonger un essai) à la place du « oui ».
    for (const [i, d] of lu.droits.entries()) {
      const cellules = droits.nth(i).locator('td');
      for (const [j, r] of (['direction', 'support', 'technique'] as const).entries()) {
        const t = net(await cellules.nth(j + 1).innerText());
        if (!d.roles.includes(r)) expect(t).toBe('—');
        else if (d.code === 'console.abonnement.prolonger' && r === 'support') expect(t).toContain('une fois par entreprise');
        else if (d.code === 'console.accueil.voir' && r !== 'direction') expect(t).toContain('ses lignes');
        else expect(t).toBe('Oui');
      }
    }
    // Le menu de la ligne du support, amenée au bas d'un écran bas : il s'ouvre entier, rien ne le coupe (la carte du
    // tableau coupait le menu ouvert vers le haut).
    await p.setViewportSize({ width: 1440, height: 640 });
    const ligne = p.locator('.c-table:not(.c-eq-droits) tbody tr', { hasText: support.nom });
    const bouton = ligne.locator('.c-menu-btn');
    await bouton.evaluate((e) => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.bottom - window.innerHeight + 10); });
    await cliquer(bouton);
    const liste = p.locator('.c-menu-liste');
    await expect.poll(() => liste.count()).toBe(1);
    await p.waitForTimeout(150);
    const entier = await liste.evaluate((m) => {
      const r = m.getBoundingClientRect();
      const coins = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]];
      return r.top >= 0 && r.bottom <= window.innerHeight && coins.every(([x, y]) => m.contains(document.elementFromPoint(x ?? 0, y ?? 0)));
    });
    expect(entier).toBe(true);
    // « Ses gestes au journal » mène au journal de cette personne.
    await cliquer(liste.getByRole('button', { name: /ses gestes au journal/i }));
    await expect.poll(() => p.evaluate(() => location.hash)).toMatch(/^#\/journal\?qui=[0-9a-f-]{36}$/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('la technique : l\'accueil et le service seulement ; les clients ne sont pas dans son rôle', async () => {
    const jeton = await jetonConsole(technique);
    const p = await ouvrir(jeton, '#/clients');
    expect(net(await p.locator('h1').first().innerText())).toBe('Cet écran n\'est pas dans ton rôle');
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net).some((t) => /Clients|Équipe|Journal/.test(t))).toBe(false);
    await p.goto(`${serveur.adresse}/console/#/service`);
    const graves = p.locator('.c-ligne-decision');
    await expect.poll(() => graves.count(), { timeout: 15_000 }).toBe(2);
    expect(net(await graves.first().innerText())).toContain('La copie hors machine');
    expect(net(await graves.first().innerText())).toContain('Grave');
    // Le serveur aussi : aucun client pour la technique.
    expect((await api('GET', '/console/entreprises', jeton)).statut).toBe(403);
    await fermer(p);
  }, 60_000);

  it('l\'en-tête du service : l\'alerte la plus urgente une fois, en grand puis en une ligne ; la pause ; Ctrl K mène aux clients', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/service');
    // La plus urgente des deux alertes ouvertes : la grave, en grand, avec son geste ; et le compte des autres.
    const grande = p.locator('.c-sv-alerte');
    await expect.poll(() => grande.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await grande.innerText())).toMatch(/^Grave La copie hors de la machine est en retard de 90 minutes Depuis \d\d:\d\d, il y a 1 h 3\d · une autre alerte ouverte Voir l'alerte$/);
    // Ce que la veille voit et qu'aucune alerte ne porte encore se dit à part ; ce qui EST une alerte ouverte ne se redit pas.
    expect(await p.locator('.c-sv-problemes .c-ligne-decision').count()).toBe(2);
    ecrire({ 'hors-machine': { titre: 'la copie hors de la machine est en retard', grave: true, faire: 'f', depuis: new Date().toISOString() } });
    try {
      await p.reload();
      await expect.poll(() => grande.count(), { timeout: 15_000 }).toBe(1);
      expect(await p.locator('.c-sv-problemes').count()).toBe(0);
    } finally { ecrire(PROBLEMES); }
    // Sur une autre vue, la même alerte en une ligne, qui mène à sa page ; la page des alertes ne la redit pas.
    await p.goto(`${serveur.adresse}/console/#/service/sauvegardes`);
    const ligne = p.locator('.c-sv-bandeau');
    await expect.poll(() => ligne.count(), { timeout: 15_000 }).toBe(1);
    await cliquer(ligne.getByRole('link', { name: 'Voir l\'alerte', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/service/alertes');
    await expect.poll(() => p.locator('.c-al-alerte').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await ligne.count()).toBe(0);
    // La pause : l'écran le dit, et « Reprendre » le rend en direct.
    await cliquer(p.getByRole('button', { name: 'Pause', exact: true }));
    expect(net(await p.locator('.c-sv-direct-texte').innerText())).toMatch(/^En pause · relu à \d\d:\d\d$/);
    await cliquer(p.getByRole('button', { name: 'Reprendre', exact: true }));
    expect(net(await p.locator('.c-sv-direct-texte').innerText())).toMatch(/^En direct · /);
    // La recherche des clients ne vit qu'en tête de l'accueil ; Ctrl K y mène de partout.
    expect(await p.locator('.c-haut').count()).toBe(0);
    await p.keyboard.press('Control+k');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/clients');
    await expect.poll(() => p.evaluate(() => document.activeElement?.matches('.c-liste-outils input[type="search"]') ?? false)).toBe(true);
    await fermer(p);
  }, 90_000);

  it('les abonnements : chaque carte ouvre la liste qu\'elle compte, du même nombre', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/abonnements');
    const compte = () => p.locator('#ab-liste .c-compte-titre').innerText().then(Number).catch(() => NaN);
    // La liste d'arrivée est celle de « À venir » : elle compte ce que dit sa carte.
    const avenir = p.locator('.c-vue', { has: p.locator('.c-point-avenir') });
    await expect.poll(() => avenir.getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true');
    await expect.poll(compte, { timeout: 15_000 }).toBe(Number(await avenir.locator('.c-vue-n').innerText()));
    // Chaque autre carte : sa liste, lue au serveur pour CETTE vue, compte ce que la carte annonçait.
    for (const v of ['essai', 'actif', 'en_retard', 'lecture_seule', 'hors']) {
      const carte = p.locator('.c-vue', { has: p.locator(`.c-point-${v}`) });
      const n = Number(await carte.locator('.c-vue-n').innerText());
      const lue = p.waitForResponse((r) => r.url().includes(`/console/abonnements?vue=${v}&`));
      await cliquer(carte);
      await lue;
      await expect.poll(compte, { timeout: 15_000 }).toBe(n);
      expect(await carte.getAttribute('aria-pressed')).toBe('true');
      expect(await p.evaluate(() => location.hash)).toBe(`#/abonnements?vue=${v}`);
    }
    // Ce qui revient chaque année vit à côté de la liste, une seule fois : l'en-tête ne le redit pas.
    expect(net(await p.locator('.c-ab-annuel').innerText())).toMatch(/^Ce qui revient chaque année [\d ]+,\d{3} DT hors taxes /);
    expect(await p.locator('.c-entete-chiffre').count()).toBe(0);
    // Ce que dit chaque puce de relance se lit à côté : cinq états, chacun sa phrase.
    expect(await p.locator('.c-ab-legende li').count()).toBe(5);
    // Le compte est dans le titre de la liste : sur une page courte, aucun pied ne le redit.
    expect(await p.locator('.c-liste-pied').count()).toBe(Number(await p.locator('#ab-liste .c-compte-titre').innerText()) > 50 ? 1 : 0);
    await fermer(p);
  }, 90_000);

  it('les cabinets : les onglets ne bougent pas ; la liste compte ce que la fiche montre ; la fiche d\'un client mène à son cabinet', async () => {
    const p = await ouvrir(await jetonConsole(support), '#/clients');
    const onglets = p.locator('.c-onglets');
    await expect.poll(() => p.locator('.c-liste-resume').count(), { timeout: 15_000 }).toBe(1);
    const yEntreprises = (await onglets.boundingBox())?.y ?? -1;
    // Passer aux cabinets : l'adresse suit, et les onglets restent sous le curseur (un même en-tête pour les deux).
    await cliquer(onglets.getByRole('link', { name: 'Cabinets', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/cabinets');
    await expect.poll(() => onglets.locator('[aria-current="page"]').innerText().then(net).catch(() => '')).toBe('Cabinets');
    expect(Math.abs(((await onglets.boundingBox())?.y ?? 0) - yEntreprises)).toBeLessThan(1);
    // Le cabinet, cherché par son nom parmi les autres : un client abonné, un dossier tenu, un en attente.
    const lignes = p.locator('.c-table tbody tr');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBeGreaterThan(1);
    await p.locator('.c-liste-outils input[type="search"]').fill(cabinet.nom);
    // La recherche se lit après la pause de la frappe, et l'adresse la garde.
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe(`#/cabinets?q=${encodeURIComponent(cabinet.nom)}`);
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await lignes.first().innerText())).toContain(cabinet.nom);
    const comptes = async (q: Page) => (await q.locator('.c-table tbody tr').first().locator('td.c-droite .c-mono').allInnerTexts()).map(Number);
    expect(await comptes(p)).toEqual([1, 1, 1]);
    // Un compte posé seul garde sa minuscule derrière le nombre : « 2 personnes », jamais « 2 Personnes ».
    expect(net(await lignes.first().locator('td').nth(4).innerText())).toBe('2 personnes');
    // Sa fiche : les trois cartes comptent la même chose que la liste, et ses trois dossiers.
    await cliquer(lignes.first().getByRole('link', { name: cabinet.nom, exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/cabinets/${cabinet.id}`);
    // L'aperçu : chaque place nomme ses dossiers et mène à sa liste, filtrée.
    const tenus = p.locator('section[aria-labelledby="cab-tenu"]');
    await expect.poll(() => tenus.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Cordonnerie de la Console');
    expect(await p.locator('section[aria-labelledby="cab-en_attente"] li').count()).toBe(1);
    await cliquer(tenus.getByRole('link', { name: 'Voir les dossiers qu\'il tient', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/cabinets/${cabinet.id}?onglet=dossiers&place=tenu`);
    const cartes = p.locator('.c-vues .c-vue');
    await expect.poll(() => cartes.locator('.c-vue-n').allInnerTexts().then((t) => t.map(Number)), { timeout: 15_000 }).toEqual([1, 1, 1]);
    const dossiers = p.locator('section[aria-labelledby="cab-dossiers"] tbody tr');
    // Arrivée filtrée : la carte allumée, une ligne, le compte du titre.
    await expect.poll(() => dossiers.count()).toBe(1);
    expect(await cartes.nth(1).getAttribute('aria-pressed')).toBe('true');
    expect(net(await dossiers.first().innerText())).toContain('Cordonnerie de la Console');
    expect(net(await p.locator('#cab-dossiers .c-compte-titre').innerText())).toBe('1');
    // Le filtre se voit, et se retire.
    await cliquer(p.getByRole('button', { name: 'Retirer ce filtre', exact: true }));
    await expect.poll(() => dossiers.count()).toBe(3);
    expect(await cartes.nth(1).getAttribute('aria-pressed')).toBe('false');
    // Une carte filtre aussi la liste à elle seule, et se rallume pour la rendre entière.
    await cliquer(cartes.nth(2));
    await expect.poll(() => dossiers.count()).toBe(1);
    await cliquer(cartes.nth(2));
    await expect.poll(() => dossiers.count()).toBe(3);
    // La fiche du client nomme son cabinet, et y mène.
    await cliquer(dossiers.filter({ hasText: 'Librairie de la Console' }).getByRole('link', { name: 'Librairie de la Console', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/clients/${cabinet.client}`);
    const carteCabinet = p.locator('section[aria-labelledby="fiche-cabinets"]');
    await expect.poll(() => carteCabinet.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('avec son mandat depuis le');
    expect(net(await carteCabinet.innerText())).toContain(cabinet.nom);
    await cliquer(carteCabinet.getByRole('link', { name: 'Ouvrir la fiche du cabinet', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/cabinets/${cabinet.id}`);
    // Le dossier tenu : « tenue par » mène aussi au cabinet.
    await p.goto(`${serveur.adresse}/console/#/clients/${cabinet.tenu}`);
    await expect.poll(() => p.locator('section[aria-labelledby="fiche-ent"] .c-fiche-ent a').getAttribute('href').catch(() => ''), { timeout: 15_000 }).toBe(`#/cabinets/${cabinet.id}`);
    // Une adresse qui ne mène à aucun cabinet : la phrase, et le chemin vers la liste (pas « Réessayer »).
    await p.goto(`${serveur.adresse}/console/#/cabinets/00000000-0000-4000-8000-000000000000`);
    await expect.poll(() => p.locator('.c-vide').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Aucun cabinet à cette adresse');
    expect(await p.getByRole('button', { name: 'Réessayer' }).count()).toBe(0);
    await cliquer(p.getByRole('link', { name: 'Voir les cabinets', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/cabinets');
    await fermer(p);
  }, 90_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone : l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    const jeton = await jetonConsole(direction);
    const ECRANS: { nom: string; hash: string; geste?: (p: Page) => Promise<void> }[] = [
      { nom: 'accueil', hash: '#/' },
      { nom: 'clients', hash: '#/clients' },
      { nom: 'fiche', hash: `#/clients/${enLecture}` },
      // Une fiche qui a émis : ses douze mois se dessinent, et se mesurent.
      { nom: 'fiche-emises', hash: `#/clients/${abonnee}` },
      { nom: 'fiche-cabinet-client', hash: `#/clients/${cabinet.client}` },
      { nom: 'abonnements', hash: '#/abonnements' },
      { nom: 'abonnements-essai', hash: '#/abonnements?vue=essai' },
      { nom: 'cabinets', hash: '#/cabinets' },
      { nom: 'cabinet', hash: `#/cabinets/${cabinet.id}` },
      { nom: 'geste', hash: `#/clients/${enLecture}`, geste: async (p) => { await cliquer(p.locator('.c-menu > button')); await cliquer(p.locator('.c-menu-liste button').first()); await p.getByRole('dialog').waitFor(); } },
      { nom: 'journal', hash: '#/journal' },
      { nom: 'equipe', hash: '#/equipe' },
      { nom: 'service', hash: '#/service' },
      { nom: 'alertes', hash: '#/service/alertes' },
      { nom: 'sauvegardes', hash: '#/service/sauvegardes' },
      { nom: 'performances', hash: '#/service/performances' },
      { nom: 'travaux', hash: '#/service/travaux' },
      { nom: 'securite', hash: '#/service/securite' },
      { nom: 'remise', hash: '#/service/sauvegardes', geste: async (p) => { await cliquer(p.locator('.c-sg-remises .c-al-section-tete button')); await p.getByRole('dialog').waitFor(); } },
      { nom: 'sourdine', hash: '#/service/alertes', geste: async (p) => { await cliquer(p.locator('.c-al-alerte').first().locator('.c-al-gestes button').last()); await p.getByRole('dialog').waitFor(); } },
    ];
    const faux: string[] = [];
    let vus = 0;
    for (const largeur of [1440, 390]) {
      for (const theme of ['clair', 'sombre'] as const) {
        for (const e of [...ECRANS, ...(largeur < 600 ? [{ nom: 'menu', hash: '#/', geste: async (p: Page) => { await cliquer(p.locator('.c-menu-tel')); } }] : [])]) {
          const p = await ouvrir(jeton, e.hash, { largeur, theme });
          await expect.poll(() => p.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
          if (e.geste) await e.geste(p);
          await p.waitForTimeout(300);
          const nom = `console-${e.nom}-${largeur}-${theme}`;
          faux.push(...(await p.evaluate(problemes, [largeur < 600, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
          if (largeur < 600) faux.push(...(await p.evaluate(auTelephone)).map((x) => `${nom} : ${x}`));
          await p.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
          vus++;
          await fermer(p);
        }
      }
    }
    // L'entrée, sans session, et chaque écran en langue factice.
    for (const e of [{ nom: 'entree', hash: '#/' }, ...ECRANS]) {
      const p = await ouvrir(e.nom === 'entree' ? null : jeton, e.hash, { factice: true });
      if (e.geste) await e.geste(p);
      await p.waitForTimeout(300);
      faux.push(...(await p.evaluate(horsCatalogue)).map((x) => `console-${e.nom}-factice : hors catalogue : ${x}`));
      faux.push(...(await p.evaluate(problemes, [false, 1440] as [boolean, number])).map((x) => `console-${e.nom}-factice : ${x}`));
      await fermer(p);
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4 + 2);
    expect(erreurs).toEqual([]);
  }, 400_000);

  it('le service des écrans de l\'application ne garde jamais la console', async () => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await cx.newPage();
    await p.goto(`${serveur.adresse}/`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
    // La console visitée sous le service des écrans : ni sa page, ni ses fichiers ne se gardent.
    await p.goto(`${serveur.adresse}/console/`);
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await p.goto(`${serveur.adresse}/`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
    const gardes = await p.evaluate(async () => {
      const cles: string[] = [];
      for (const nom of await caches.keys()) for (const r of await (await caches.open(nom)).keys()) cles.push(new URL(r.url).pathname);
      return cles;
    });
    expect(gardes.length).toBeGreaterThan(0);
    expect(gardes.filter((c) => c === '/console' || c.startsWith('/console/'))).toEqual([]);
    await cx.close();
  }, 60_000);
});
