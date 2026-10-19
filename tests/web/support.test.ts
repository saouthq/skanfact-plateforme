// Le support, à la souris, des deux côtés (Support S1 ; docs/support.md ; web/console/src/ecrans/Support.tsx ;
// web/public/plateforme/support.js ; web/v10/support.txt). Ce que le parcours vérifie :
//   - la personne écrit depuis l'Aide de son application et arrive sur sa demande ;
//   - la console l'ouvre en deux colonnes qui tiennent dans la fenêtre : la conversation large, le champ et « Envoyer »
//     à l'écran sans défiler (vu le 13/10/2026 : trois colonnes serraient la conversation, la réponse sous le bas) ;
//   - une réponse type joint l'article et pose le début de la réponse, le curseur sur la ligne vide ; Ctrl + Entrée envoie ;
//   - la personne voit la réponse partout (bandeau, pastille de l'Aide), la lit, et tout s'éteint ; une SECONDE réponse
//     ouverte à l'écran s'éteint aussi (la lecture se notait une fois par demande : la pastille restait allumée) ;
//   - la console se relit au retour sur l'onglet : la réponse de la personne arrive sans recharger la page ;
//   - une réponse commencée survit à la clôture par la personne : l'écran le dit, et « Rouvrir… » la rend ;
//   - au téléphone, la liste d'abord, rien ne déborde ; l'instrument de la console et celui des pages du client ne
//     trouvent rien, en clair et en sombre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { problemes } from '../instrument-rendu.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const SUJET = 'Le timbre fiscal sur ma facture';

describe('le support, à la souris, des deux côtés', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-support-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-support-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jS = '', jClient = '', ent = '', demande = '', emailS = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Ce qui attend la personne au support : les demandes dont la réponse n'est pas lue.
  const aLire = async () => ((await api('GET', `/entreprises/${ent}/support/attente`, jClient)).corps.aLire as { id: string }[]).map((x) => x.id);
  // La console de Karim, du support, sur une adresse ; lue quand sa grille est là.
  const consoleSur = async (hash: string, largeur = 1440, hauteur = 900, theme?: 'clair' | 'sombre', factice = false, jeton = jS) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${factice ? '?langue=factice' : ''}${hash}`);
    await expect.poll(() => p.locator(hash.includes('vue=doc') ? '.c-sd' : hash.includes('vue=evolutions') ? '.c-ev' : '.c-sp-grille').count(), { timeout: 20_000 }).toBe(1);
    if (hash.includes('demande=') && !/vue=(doc|evolutions)/.test(hash)) await expect.poll(() => p.locator('.c-sp-messages').count(), { timeout: 20_000 }).toBe(1);
    return p;
  };
  // L'application de Lina, sur une page.
  const client = async (hash: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jClient);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await expect.poll(() => p.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  // Revenir sur l'onglet : ce que la page entend quand on la retrouve.
  const revenir = (p: Page) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Où sont les morceaux de la page Support de la console, dans la fenêtre.
  const geometrie = (p: Page) => p.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const msgs = [...document.querySelectorAll('.c-sp-msg')];
    return {
      haut: innerHeight, defile: document.documentElement.scrollHeight - innerHeight,
      envoyer: r('.c-sp-repondre button[type="submit"]'), zone: r('.c-sp-repondre textarea'),
      dernier: msgs.at(-1)?.getBoundingClientRect() ?? null, fil: r('.c-sp-fil'), liste: r('.c-sp-liste'), cote: r('.c-sp-cote'),
    };
  });

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    // Karim, du support (un nom à ce fichier : d'autres écrivent dans la même base).
    const email = `support-web-karim-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim Support', motDePasse: MDP });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', j, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'support', 'essai du support à la souris');
    emailS = email;
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jS = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // Lina et son studio.
    const emailC = `support-web-lina-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailC, nom: 'Lina Support', motDePasse: MDP });
    jClient = String((await api('POST', '/connexion', undefined, { email: emailC, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    ent = String((await api('POST', '/entreprises', jClient, { raisonSociale: 'Studio Lina Support' })).corps.id);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('la personne écrit depuis l\'Aide, et arrive sur sa demande', async () => {
    const c = await client('#/aide');
    await cliquer(c.locator('#aide-support'));
    await c.locator('#sup-sujet').fill(SUJET);
    await c.locator('#sup-texte-demande').fill('Le timbre de 1 dinar ne s\'ajoute pas sur ma facture de ce matin. Comment le remettre ?');
    await cliquer(c.locator('#sup-send'));
    await expect.poll(() => c.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/support\/[0-9a-f-]{36}$/);
    demande = (await c.evaluate(() => location.hash)).replace('#/support/', '');
    await expect.poll(() => c.locator('[data-sup-liste] [data-sup-id]').count(), { timeout: 15_000 }).toBe(1);
    expect(net(await c.locator('[data-sup-fil]').innerText())).toContain('Le timbre de 1 dinar ne s\'ajoute pas');
    expect(erreurs).toEqual([]);
    await fermer(c);
  }, 60_000);

  it('la console l\'ouvre en deux colonnes qui tiennent dans la fenêtre : la conversation large, le champ et « Envoyer » à l\'écran', async () => {
    // Une conversation longue : c'est elle qui poussait la réponse sous le bas de l'écran (une conversation d'un message
    // tient partout, et l'essai ne prouverait rien).
    for (let i = 1; i <= 6; i++) {
      expect((await api('POST', `/entreprises/${ent}/support/${demande}/messages`, jClient,
        { texte: `Précision ${i} : ${'le timbre manque encore sur la facture, je recommence et rien ne change. '.repeat(3)}` })).statut).toBe(201);
    }
    for (const [largeur, hauteur] of [[1440, 900], [1280, 800]] as const) {
      const p = await consoleSur('#/support', largeur, hauteur);
      // Sans demande choisie, la plus urgente s'ouvre : la première de la liste. Les tests d'avant laissent les leurs dans la
      // même base (la console les voit toutes) : on n'attend pas que ce soit celle de Lina, on l'ouvre ensuite d'un clic.
      await expect.poll(() => p.locator('.c-sp-ticket').first().getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true');
      const ticket = p.locator('.c-sp-ticket').filter({ hasText: 'Studio Lina Support' });
      if (await ticket.getAttribute('aria-pressed') !== 'true') await cliquer(ticket);
      await expect.poll(() => ticket.getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true');
      await expect.poll(async () => net(await p.locator('#sp-fil-titre').innerText())).toBe(`« ${SUJET} »`);
      const g = await geometrie(p);
      const nom = `${largeur}×${hauteur}`;
      // La page ne défile pas : chaque colonne défile seule.
      expect(g.defile, nom).toBeLessThanOrEqual(1);
      // Le champ, « Envoyer » et le dernier message sont dans la fenêtre.
      expect(g.envoyer?.bottom, nom).toBeLessThanOrEqual(g.haut);
      expect(g.zone?.bottom, nom).toBeLessThanOrEqual(g.haut);
      expect(g.dernier?.bottom, nom).toBeLessThanOrEqual(g.haut);
      // La liste puis le client à gauche, l'une sous l'autre ; la conversation à droite, large.
      const { liste, cote, fil } = g;
      if (!liste || !cote || !fil) throw new Error(`${nom} : la liste, la carte du client ou la conversation manque`);
      expect(liste.right, nom).toBeLessThanOrEqual(fil.left);
      expect(cote.right, nom).toBeLessThanOrEqual(fil.left);
      expect(liste.bottom, nom).toBeLessThanOrEqual(cote.top);
      expect(fil.width, nom).toBeGreaterThanOrEqual(600);
      await fermer(p);
    }
    expect(erreurs).toEqual([]);
  }, 90_000);

  it('une réponse type joint l\'article et pose le début, le curseur sur la ligne vide ; Ctrl + Entrée envoie', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    const type = p.locator('.c-sp-type').first();
    await expect.poll(() => type.count(), { timeout: 15_000 }).toBe(1);
    await cliquer(type);
    expect(await type.getAttribute('aria-pressed')).toBe('true');
    const zone = p.locator('.c-sp-repondre textarea');
    await expect.poll(() => zone.inputValue()).toMatch(/^Bonjour Lina,\n\n\n\nL'article de l'Aide «[\s\u202f].+[\s\u202f]» le montre pas à pas/);
    const v = await zone.inputValue();
    // Le curseur attend dans la réponse, sur la ligne vide sous « Bonjour Lina, » ; l'article est joint en pied. Il s'y pose à
    // l'image suivante (requestAnimationFrame) : on l'attend, sinon une machine lente lit le focus d'avant (CI, Node 24).
    await expect.poll(() => p.evaluate(() => {
      const z = document.activeElement as HTMLTextAreaElement | null;
      return z?.tagName === 'TEXTAREA' ? [z.selectionStart, z.selectionEnd] : null;
    })).toEqual([v.indexOf('\n\n') + 2, v.indexOf('\n\n') + 2]);
    const joint = await p.locator('.c-sp-joint select').inputValue();
    expect(joint).not.toBe('');
    await p.keyboard.type('Il revient dans les Paramètres, onglet Documents.');
    await p.keyboard.press('Control+Enter');
    await expect.poll(() => p.locator('.c-sp-msg-equipe').count(), { timeout: 15_000 }).toBe(1);
    expect(await zone.inputValue()).toBe('');
    // La personne la reçoit telle quelle, avec l'article.
    const d = ((await api('GET', `/entreprises/${ent}/support`, jClient)).corps.demandes as { id: string; messages: { cote: string; texte: string; article: string | null }[] }[]).find((x) => x.id === demande);
    const r = d?.messages.find((m) => m.cote === 'equipe');
    expect(r?.texte).toContain('Bonjour Lina,\n\nIl revient dans les Paramètres, onglet Documents.');
    expect(r?.article).toBe(joint);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('la réponse se voit partout chez la personne ; lue, tout s\'éteint, et une seconde réponse ouverte à l\'écran aussi', async () => {
    expect(await aLire()).toEqual([demande]);
    const c = await client('#/dashboard');
    const bandeau = c.locator('#view > .sup-bandeau');
    await expect.poll(() => bandeau.count(), { timeout: 20_000 }).toBe(1);
    expect(net(await bandeau.innerText())).toMatch(new RegExp(`^L'équipe SkanFact a répondu à ta demande S-\\d{4}, « ${SUJET} »\\. Lire la réponse$`));
    expect(await c.locator('#nav-support').isVisible()).toBe(true);
    expect(net(await c.locator('#nav-support').innerText())).toBe('1');
    await cliquer(bandeau.getByRole('link', { name: 'Lire la réponse' }));
    await expect.poll(() => c.evaluate(() => location.hash)).toBe(`#/support/${demande}`);
    await expect.poll(async () => net(await c.locator('[data-sup-fil]').innerText()), { timeout: 15_000 }).toContain('Il revient dans les Paramètres');
    // Lue à l'écran : la pastille s'éteint, le serveur ne la compte plus.
    await expect.poll(() => c.locator('#nav-support').isVisible(), { timeout: 15_000 }).toBe(false);
    await expect.poll(aLire, { timeout: 15_000 }).toEqual([]);
    // Une seconde réponse, pendant que la demande est ouverte à l'écran : relue, elle se marque lue à son tour.
    expect((await api('POST', `/console/support/demandes/${demande}/repondre`, jS, { texte: 'Et si besoin, je t\'appelle demain matin.', article: null })).statut).toBe(201);
    expect(await aLire()).toEqual([demande]);
    await revenir(c);
    await expect.poll(async () => net(await c.locator('[data-sup-fil]').innerText()), { timeout: 15_000 }).toContain('je t\'appelle demain matin');
    await expect.poll(aLire, { timeout: 15_000 }).toEqual([]);
    // La pastille suit le serveur à son tour : on l'attend (lue d'un coup, une machine chargée la trouvait encore allumée).
    await expect.poll(() => c.locator('#nav-support').isVisible(), { timeout: 15_000 }).toBe(false);
    expect(erreurs).toEqual([]);
    await fermer(c);
  }, 90_000);

  it('la console se relit au retour sur l\'onglet : la réponse de la personne arrive sans recharger', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    const avant = await p.locator('.c-sp-msg-client').count();
    expect((await api('POST', `/entreprises/${ent}/support/${demande}/messages`, jClient, { texte: 'Merci ! Et pour les avoirs, c\'est pareil ?' })).statut).toBeLessThan(300);
    await revenir(p);
    await expect.poll(() => p.locator('.c-sp-msg-client').count(), { timeout: 15_000 }).toBe(avant + 1);
    expect(net(await p.locator('.c-sp-msg').last().innerText())).toContain('Et pour les avoirs, c\'est pareil ?');
    // Le dernier mot est à l'écran, dans la conversation qui défile seule.
    const g = await geometrie(p);
    expect(g.dernier?.bottom).toBeLessThanOrEqual(g.haut);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une réponse commencée survit à la clôture par la personne : l\'écran le dit, et « Rouvrir… » la rend', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    const zone = p.locator('.c-sp-repondre textarea');
    await cliquer(zone);
    await p.keyboard.type('Oui, pour les avoirs c\'est le même réglage.');
    // Sous les doigts, l'écran ne se relit pas : la personne dit que c'est réglé pendant qu'on écrit.
    expect((await api('POST', `/entreprises/${ent}/support/${demande}/reglee`, jClient)).statut).toBeLessThan(300);
    await revenir(p);
    await p.waitForTimeout(1_000);
    expect(await zone.inputValue()).toBe('Oui, pour les avoirs c\'est le même réglage.');
    expect(await p.locator('.c-sp-close').count()).toBe(0);
    // Le curseur sorti du champ, l'écran se relit : la demande est close, la réponse commencée est gardée.
    await cliquer(p.locator('h1'));
    await revenir(p);
    const close = p.locator('.c-sp-close');
    await expect.poll(() => close.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await close.innerText())).toContain('Ta réponse commencée est gardée : rouvre la demande pour l\'envoyer.');
    await cliquer(close.getByRole('button', { name: 'Rouvrir…' }));
    const f = p.locator('[role="dialog"]');
    await f.locator('textarea').fill('elle demande encore pour les avoirs');
    await cliquer(f.getByRole('button', { name: 'Rouvrir la demande', exact: true }));
    await expect.poll(() => f.count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => p.locator('.c-sp-repondre textarea').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('.c-sp-repondre textarea').inputValue()).toBe('Oui, pour les avoirs c\'est le même réglage.');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('le suivi : urgente en tête de la liste, puis elle attend la technique avec son motif, puis revient ; chaque geste demande son motif', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    const suivi = p.locator('.c-sp-suivi');
    // Karim a répondu le premier : il la suit, et ne se voit pas proposer de la prendre.
    expect(net(await suivi.innerText())).toContain('Tu suis cette demande');
    expect(await suivi.getByRole('button', { name: /prendre|suivre/i }).count()).toBe(0);
    const geste = async (nom: RegExp, motif: string, bouton: string) => {
      await cliquer(suivi.getByRole('button', { name: 'Les gestes de cette demande' }));
      await cliquer(p.locator('.c-menu-liste button').filter({ hasText: nom }));
      const f = p.locator('[role="dialog"]');
      // Sans motif : refusé, la fenêtre reste.
      await cliquer(f.getByRole('button', { name: bouton, exact: true }));
      await expect.poll(() => f.locator('.c-alerte').count()).toBe(1);
      await f.locator('textarea').fill(motif);
      await cliquer(f.getByRole('button', { name: bouton, exact: true }));
      await expect.poll(() => f.count(), { timeout: 15_000 }).toBe(0);
    };
    await geste(/Marquer urgente/, 'sa facture ne part pas', 'La marquer urgente');
    await expect.poll(async () => net(await suivi.innerText())).toContain('Urgente');
    expect(net(await p.locator('.c-sp-ticket[aria-pressed="true"]').innerText())).toContain('Urgente');
    await geste(/Attendre la technique/, 'le timbre manque sur l\'export', 'Attendre la technique');
    await expect.poll(async () => net(await suivi.innerText())).toContain('Attend la technique : « le timbre manque sur l\'export »');
    expect(net(await p.locator('.c-sp-fil-etat').innerText())).toMatch(/^Attend la technique depuis/);
    await geste(/La technique a répondu/, 'corrigé sur le serveur', 'Elle revient au support');
    await expect.poll(async () => net(await suivi.innerText())).not.toContain('Attend la technique');
    await geste(/Remettre en normale/, 'la facture est partie', 'La remettre en normale');
    await expect.poll(async () => net(await suivi.innerText())).not.toContain('Urgente');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('le lien d\'une demande (0126) : liée à un incident, puis la version qui la corrige — attendue, puis en service : « à dire au client »', async () => {
    // La version en service : ce que le suiveur écrit à côté de la veille.
    const etat = (numero: string) => {
      fs.mkdirSync(path.join(path.dirname(veille), 'public'), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(veille), 'public', 'etat.json'), JSON.stringify({ version: 'b'.repeat(40), numeros: { ['b'.repeat(40)]: numero } }));
    };
    etat('1.31.0');
    const ref = String((await admin.query(`insert into plateforme.service_incident (annee, numero, titre, gravite, ouvert_le, ouvert_par)
      values (2026, (select coalesce(max(numero), 0) + 1 from plateforme.service_incident where annee = 2026), 'Les factures ne partent plus', 'majeur', now(),
              (select id from socle.utilisateur where email = $1)) returning format('INC-%s-%s', annee, lpad(numero::text, 3, '0')) r`, [emailS])).rows[0].r);
    try {
      const p = await consoleSur(`#/support?demande=${demande}`);
      const suivi = p.locator('.c-sp-suivi');
      const liens = p.locator('.c-sp-attaches');
      expect(await liens.count()).toBe(0);
      const geste = async (nom: RegExp, bouton: string, remplir: (f: ReturnType<Page['locator']>) => Promise<void>) => {
        await cliquer(suivi.getByRole('button', { name: 'Les gestes de cette demande' }));
        await cliquer(p.locator('.c-menu-liste button').filter({ hasText: nom }));
        const f = p.locator('[role="dialog"]');
        await expect.poll(() => f.count()).toBe(1);
        // Sans motif : refusé, la fenêtre reste.
        await cliquer(f.getByRole('button', { name: bouton, exact: true }));
        await expect.poll(() => f.locator('.c-alerte').count()).toBe(1);
        await remplir(f);
        await cliquer(f.getByRole('button', { name: bouton, exact: true }));
        await expect.poll(() => f.count(), { timeout: 15_000 }).toBe(0);
      };
      await geste(/Lier à un incident/, 'Lier', async (f) => {
        expect(await f.locator('select option').allInnerTexts()).toContain(`${ref} · Les factures ne partent plus (en cours)`);
        await f.locator('select').selectOption({ label: `${ref} · Les factures ne partent plus (en cours)` });
        await f.locator('textarea').fill('les factures de Lina ne partent pas non plus');
      });
      await expect.poll(async () => net(await liens.innerText().catch(() => ''))).toContain(`${ref} · Les factures ne partent plus · en cours`);
      await geste(/Noter la version qui la corrige/, 'Noter', async (f) => {
        // Une version mal écrite : la case le dit.
        await f.locator('input').fill('1.32');
        await f.locator('textarea').fill('le timbre manque sur l\'export');
        await cliquer(f.getByRole('button', { name: 'Noter', exact: true }));
        await expect.poll(async () => net(await f.locator('.c-alerte').innerText())).toContain('trois nombres');
        await f.locator('input').fill('1.32.0');
      });
      await expect.poll(async () => net(await liens.innerText())).toContain('Correction attendue en 1.32.0 (en service : 1.31.0)');
      // Pas encore en service : rien à dire au client.
      expect(net(await liens.innerText())).not.toContain('À dire au client');
      expect(await p.locator('.c-sp-ticket[aria-pressed="true"]').getByText('Corrigée').count()).toBe(0);
      // La version arrive en service : la demande le dit, et ce qu'il reste à faire.
      etat('1.32.0');
      await p.reload();
      await expect.poll(async () => net(await liens.innerText().catch(() => '')), { timeout: 15_000 }).toContain('Corrigée en 1.32.0, en service');
      expect(net(await liens.innerText())).toContain('À dire au client');
      expect(await p.locator('.c-sp-ticket[aria-pressed="true"]').getByText('Corrigée').count()).toBe(1);
      expect(erreurs).toEqual([]);
      await fermer(p);
    } finally {
      await admin.query('update plateforme.demande_support set incident = null, correction = null, correction_le = null where id = $1', [demande]);
    }
  }, 90_000);

  it('au téléphone : la liste d\'abord ; choisir une demande amène la conversation ; rien ne déborde, des deux côtés', async () => {
    const p = await consoleSur('#/support', 390, 844);
    // Aucune demande ne s'ouvre d'elle-même : la liste d'abord.
    expect(await p.locator('.c-sp-messages').count()).toBe(0);
    // Une page plus courte que l'écran laisse le vide en bas, jamais dans la barre du haut (vu le 15/10/2026 : une bande
    // sombre de cent pixels sous le logo).
    expect(await p.locator('.c-cote').evaluate((c) => c.getBoundingClientRect().height)).toBeLessThan(90);
    await cliquer(p.locator('.c-sp-ticket').filter({ hasText: 'Studio Lina Support' }));
    await expect.poll(() => p.locator('.c-sp-messages').count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => p.evaluate(() => Math.round(document.getElementById('sp-fil')?.getBoundingClientRect().top ?? -1)), { timeout: 5_000 }).toBeLessThan(120);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await fermer(p);
    const c = await client(`#/support/${demande}`, 390, 844);
    await expect.poll(() => c.locator('[data-sup-fil] [data-sup-messages]').count(), { timeout: 15_000 }).toBe(1);
    expect(await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await fermer(c);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('l\'audit C09 : la réponse gardée par le serveur, dont l\'accusé se perd en chemin, renvoyée, ne fait qu\'un message', async () => {
    const id = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: 'Une coupure pendant la réponse', texte: 'Ma facture ne part pas.', page: 'ventes' })).corps.id);
    const p = await consoleSur(`#/support?demande=${id}`);
    // La première fois, le serveur reçoit et garde la réponse, mais la connexion coupe avant que l'écran le sache.
    let couper = true;
    await p.route('**/console/support/demandes/*/repondre', async (route) => {
      if (!couper) { await route.continue(); return; }
      couper = false;
      await route.fetch();
      await route.abort('connectionreset');
    });
    const zone = p.locator('.c-sp-repondre textarea');
    const texte = 'Bonjour Lina, je regarde ça tout de suite.';
    await zone.fill(texte);
    await cliquer(p.locator('.c-sp-repondre button[type="submit"]'));
    // L'écran ne sait pas : le texte reste, on renvoie.
    await expect.poll(() => (couper ? 'attend' : 'coupé'), { timeout: 10_000 }).toBe('coupé');
    await p.waitForTimeout(800);
    expect(await zone.inputValue()).toBe(texte);
    await cliquer(p.locator('.c-sp-repondre button[type="submit"]'));
    await expect.poll(() => zone.inputValue(), { timeout: 10_000 }).toBe('');
    // Un seul message de l'équipe : le renvoi a rendu celui que le serveur avait déjà.
    expect((await admin.query(`select count(*)::int n from plateforme.message_support where demande = $1 and cote = 'equipe'`, [id])).rows[0]?.n).toBe(1);
    await expect.poll(() => p.locator('.c-sp-msg-equipe').count(), { timeout: 10_000 }).toBe(1);
    await fermer(p);
  }, 60_000);

  it('l\'audit 1.42.0, A07 : après une coupure, revenir sur la demande renvoie la même réponse ; un texte modifié n\'est pas pris pour envoyé', async () => {
    const id = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: 'Une coupure, puis une autre demande', texte: 'Mon devis ne part pas.', page: 'ventes' })).corps.id);
    const autre = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: 'Une demande à côté', texte: 'Où est mon reçu ?', page: 'ventes' })).corps.id);
    const p = await consoleSur(`#/support?demande=${id}`);
    let coupures = 0;
    await p.route('**/console/support/demandes/*/repondre', async (route) => {
      if (coupures > 0) { await route.continue(); return; }
      coupures++;
      await route.fetch();
      await route.abort('connectionreset');
    });
    const zone = p.locator('.c-sp-repondre textarea');
    const envoi = p.locator('.c-sp-repondre button[type="submit"]');
    const messages = async (d: string) => (await admin.query(`select texte from plateforme.message_support where demande = $1 and cote = 'equipe' order by ecrit_le, id`, [d])).rows.map((x) => x.texte as string);
    // 1. La réponse part, l'accusé se perd ; on va sur une autre demande, on revient, on renvoie : un seul message.
    await zone.fill('Bonjour Lina, je regarde ton devis.');
    await cliquer(envoi);
    await expect.poll(() => coupures, { timeout: 10_000 }).toBe(1);
    await p.waitForTimeout(800);
    await p.evaluate((d) => { location.hash = `#/support?demande=${d}`; }, autre);
    await expect.poll(() => p.locator('.c-sp-fil').innerText().then(net), { timeout: 10_000 }).toContain('Une demande à côté');
    await p.evaluate((d) => { location.hash = `#/support?demande=${d}`; }, id);
    await expect.poll(() => zone.inputValue(), { timeout: 10_000 }).toBe('Bonjour Lina, je regarde ton devis.');
    await cliquer(envoi);
    await expect.poll(() => zone.inputValue(), { timeout: 10_000 }).toBe('');
    expect(await messages(id)).toEqual(['Bonjour Lina, je regarde ton devis.']);
    // 2. Coupée de nouveau, la réponse est modifiée avant le renvoi : refusée, le texte reste ; renvoyée, elle part.
    coupures = 0;
    await zone.fill('Bonjour Lina, il manque ton matricule.');
    await cliquer(envoi);
    await expect.poll(() => coupures, { timeout: 10_000 }).toBe(1);
    await p.waitForTimeout(800);
    await zone.fill('Bonjour Lina, il manque ton matricule fiscal.');
    await cliquer(envoi);
    await expect.poll(() => p.locator('.c-sp-repondre .c-alerte').innerText().then(net), { timeout: 10_000 }).toBe('Cette réponse est déjà partie avec un autre texte : relis la conversation, ta modification n\'est pas envoyée.');
    expect(await zone.inputValue()).toBe('Bonjour Lina, il manque ton matricule fiscal.');
    expect(await messages(id)).toEqual(['Bonjour Lina, je regarde ton devis.', 'Bonjour Lina, il manque ton matricule.']);
    await cliquer(envoi);
    await expect.poll(() => zone.inputValue(), { timeout: 10_000 }).toBe('');
    expect(await messages(id)).toEqual(['Bonjour Lina, je regarde ton devis.', 'Bonjour Lina, il manque ton matricule.', 'Bonjour Lina, il manque ton matricule fiscal.']);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('la documentation interne (0133) : une note privée que la personne ne voit jamais ; une réponse écrite par le support, validée par la direction, posée avec le prénom', async () => {
    // Une note privée, posée depuis la carte du client.
    const p = await consoleSur(`#/support?demande=${demande}`);
    const NOTE = 'Elle a déjà vidé le cache du navigateur ; voir avec la technique si ça revient';
    const notes = p.locator('.c-sp-notes');
    await notes.locator('textarea').fill(NOTE);
    await cliquer(notes.getByRole('button', { name: 'Poser la note' }));
    await expect.poll(() => notes.locator('.c-sp-notes-liste li').allInnerTexts().then((t) => t.map(net).join(' | ')), { timeout: 15_000 }).toContain(NOTE);
    // Pas encore de réponse validée : le champ n'en propose aucune.
    expect(await p.locator('.c-sp-inserer').count()).toBe(0);
    // Karim, du support, écrit une réponse : elle attend la validation, et son menu n'a pas « Valider ».
    await cliquer(p.getByRole('button', { name: 'Notre documentation' }));
    await expect.poll(() => p.locator('.c-sd').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.evaluate(() => location.hash)).toBe('#/support?vue=doc');
    const TITRE = `Le timbre absent ${Date.now()}`;
    await cliquer(p.getByRole('button', { name: 'Écrire une réponse' }));
    const d = p.getByRole('dialog');
    await d.locator('input').first().fill(TITRE);
    await d.locator('textarea').fill('Bonjour {prenom},\n\nLe timbre revient quand la case « Timbre fiscal » est cochée sur la facture.');
    await cliquer(d.getByRole('button', { name: 'Écrire la fiche' }));
    const fiche = p.locator('.c-sd-fiche', { hasText: TITRE });
    await expect.poll(() => fiche.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await fiche.locator('.c-puce').innerText()).toLocaleLowerCase('fr')).toBe('à valider');
    await cliquer(fiche.locator('.c-menu > button'));
    expect((await p.locator('.c-menu-liste button').allInnerTexts()).map(net).join(' | ')).not.toMatch(/Valider/);
    await p.keyboard.press('Escape');
    await fermer(p);
    // Amira, de la direction, la relit et la valide.
    const emailD = `support-web-amira-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailD, nom: 'Amira Direction', motDePasse: MDP });
    const jd = String((await api('POST', '/connexion', undefined, { email: emailD, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jd, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, emailD, 'direction', 'essai de la documentation à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email: emailD, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const jD = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const a = await consoleSur('#/support?vue=doc', 1440, 900, undefined, false, jD);
    const sienne = a.locator('.c-sd-fiche', { hasText: TITRE });
    await expect.poll(() => sienne.count(), { timeout: 15_000 }).toBe(1);
    await cliquer(sienne.locator('.c-menu > button'));
    await cliquer(a.locator('.c-menu-liste button', { hasText: 'Valider' }));
    const v = a.getByRole('dialog');
    expect(net(await v.locator('.c-sd-relire').innerText())).toContain('Bonjour {prenom},');
    // (l'audit 1.42.0, A03) Reprise pendant qu'Amira la lit : refusée, rien n'est validé ; la fenêtre montre la nouvelle
    // version à la place de l'ancienne. Valider, alors, valide celle-là.
    await admin.query(`update plateforme.doc_support set texte = texte || ' Merci de ta patience.', ecrite_le = now() where titre = $1`, [TITRE]);
    await cliquer(v.getByRole('button', { name: 'Valider', exact: true }));
    await expect.poll(() => v.locator('.c-alerte').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/^La fiche a été reprise depuis que tu l'as ouverte \(par .+\) : le texte ci-dessus est sa nouvelle version, rien n'est validé\. Relis-le, puis valide-le\.$/);
    expect(net(await v.locator('.c-sd-relire').innerText())).toMatch(/Merci de ta patience\.$/);
    expect((await admin.query('select validee_le from plateforme.doc_support where titre = $1', [TITRE])).rows[0]?.validee_le).toBeNull();
    await cliquer(v.getByRole('button', { name: 'Valider', exact: true }));
    await expect.poll(() => sienne.locator('.c-puce').innerText().then((t) => net(t).toLocaleLowerCase('fr')).catch(() => ''), { timeout: 15_000 }).toBe('validée');
    await fermer(a);
    // Karim la retrouve dans le champ de réponse : posée, elle salue la personne par son prénom.
    const k = await consoleSur(`#/support?demande=${demande}`);
    await expect.poll(() => k.locator('.c-sp-inserer option', { hasText: TITRE }).count(), { timeout: 15_000 }).toBe(1);
    await k.locator('.c-sp-inserer select').selectOption({ label: TITRE });
    await expect.poll(() => k.locator('.c-sp-repondre textarea').inputValue(), { timeout: 10_000 }).toMatch(/^Bonjour Lina,\n\nLe timbre revient/);
    await fermer(k);
    // La personne : jamais la note, ni dans sa demande ni dans ce qui l'attend.
    const c = await client(`#/support/${demande}`);
    await expect.poll(() => c.locator('[data-sup-messages]').count(), { timeout: 15_000 }).toBe(1);
    expect(await c.locator('body').innerText()).not.toContain('vidé le cache');
    expect(JSON.stringify((await api('GET', `/entreprises/${ent}/support`, jClient)).corps)).not.toContain('vidé le cache');
    await fermer(c);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('les demandes d\'évolution (0134) : rattacher la demande à une évolution nouvelle ; la liste la compte en clients, et ouvre la demande', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    await cliquer(p.locator('.c-sp-suivi .c-menu > button'));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Rattacher à une évolution' }));
    const d = p.getByRole('dialog');
    const TITRE = `Le timbre réglable par client ${Date.now()}`;
    // Ou une évolution qui existe, ou une nouvelle : la base de ce fichier peut déjà en avoir. La fenêtre attend sa liste
    // avant de montrer l'un ou l'autre.
    await expect.poll(() => d.locator('select, input').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const nouvelle = d.getByRole('button', { name: 'C\'est une évolution nouvelle' });
    if (await nouvelle.count()) await cliquer(nouvelle);
    await d.getByLabel('Son titre').fill(TITRE);
    await cliquer(d.getByRole('button', { name: 'Noter et rattacher' }));
    // La demande dit l'évolution qu'elle réclame, et son état.
    await expect.poll(() => p.locator('.c-sp-attaches').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain(`Évolution demandée : ${TITRE} À étudier`);
    // La liste : un client, une demande ; le support ne décide pas (pas de menu) ; la demande s'ouvre d'un clic.
    await cliquer(p.getByRole('button', { name: 'Les évolutions' }));
    const ev = p.locator('.c-ev-item', { hasText: TITRE });
    await expect.poll(() => ev.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await ev.locator('.c-ev-clients').innerText())).toBe('1 client');
    expect(await ev.locator('.c-menu').count()).toBe(0);
    await cliquer(ev.locator('.c-ev-demandes button').first());
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe(`#/support?demande=${demande}`);
    await expect.poll(() => p.locator('.c-sp-messages').count(), { timeout: 15_000 }).toBe(1);
    // Détacher : un geste, qui se répare en la rattachant de nouveau.
    await cliquer(p.locator('.c-sp-suivi .c-menu > button'));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Détacher de l\'évolution' }));
    // Sans incident ni évolution, la ligne des liens s'efface toute : on compte, on ne lit pas un texte qui n'est plus là.
    await expect.poll(() => p.locator('.c-sp-attaches', { hasText: TITRE }).count(), { timeout: 15_000 }).toBe(0);
    await fermer(p);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('l\'instrument ne trouve rien : la page Support de la console, sa fenêtre et ses demandes closes ; la page des demandes du client', async () => {
    // Une demande close, pour que la vue des closes ait de quoi se montrer ; et douze de plus, pour que l'instrument mesure
    // aussi une liste qui défile (la suite entière en clôt d'autres, et la colonne de 300 points porte alors sa barre).
    const close = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: 'Le logo flou sur le devis', texte: 'Le logo est flou sur le devis imprimé.', version: '1.3.0', page: 'devis' })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/support/${close}/reglee`, jClient)).statut).toBeLessThan(300);
    for (let i = 1; i <= 12; i++) {
      const id = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: `Une question réglée n° ${i}`, texte: 'Réglée le jour même.', version: '1.3.0', page: 'devis' })).corps.id);
      expect((await api('POST', `/entreprises/${ent}/support/${id}/reglee`, jClient)).statut).toBeLessThan(300);
    }
    // Chaque geste trouve son bouton par la structure de l'écran : en langue factice, son texte change.
    const ECRANS: EcranConsole[] = [
      { nom: 'support', hash: `#/support?demande=${demande}` },
      { nom: 'support-clore', hash: `#/support?demande=${demande}`, geste: async (q) => { await cliquer(q.locator('.c-sp-fil-tete > button, .c-sp-fil-tete > .c-btn').first()); await q.getByRole('dialog').waitFor(); } },
      { nom: 'support-closes', hash: `#/support?vue=closes&demande=${close}` },
      // La documentation interne (0133) : la liste des fiches, et la fenêtre qui en écrit une.
      { nom: 'support-doc', hash: '#/support?vue=doc' },
      { nom: 'support-doc-ecrire', hash: '#/support?vue=doc', geste: async (q) => { await cliquer(q.locator('.c-sd .c-carte-tete .c-btn').first()); await q.getByRole('dialog').waitFor(); } },
      // Les demandes d'évolution (0134) : la liste, et la fenêtre qui y rattache une demande.
      { nom: 'support-evolutions', hash: '#/support?vue=evolutions' },
      { nom: 'support-rattacher', hash: `#/support?demande=${demande}`, geste: async (q) => {
        await cliquer(q.locator('.c-sp-suivi .c-menu > button')); await cliquer(q.locator('.c-menu-liste button').last()); await q.getByRole('dialog').waitFor();
      } },
    ];
    const { faux, vus } = await mesurerLaConsole({
      ecrans: ECRANS,
      ouvrir: (e, o) => consoleSur(e.hash, o.largeur, o.largeur < 600 ? 844 : 900, o.theme, o.factice),
      photos: path.join(RACINE, 'dist/photos'),
    });
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4);
    // La page des demandes du client, à l'ordinateur et au téléphone, en clair et en sombre.
    const pb: string[] = [];
    for (const largeur of [1440, 390]) {
      for (const sombre of [false, true]) {
        const c = await client(`#/support/${demande}`, largeur, largeur < 600 ? 844 : 900);
        await expect.poll(() => c.locator('[data-sup-messages]').count(), { timeout: 15_000 }).toBe(1);
        if (sombre) await c.evaluate(() => document.body.classList.add('dark'));
        await c.waitForTimeout(300);
        pb.push(...(await c.evaluate(problemes, [largeur < 600, largeur] as [boolean, number])).map((x) => `client-support-${largeur}-${sombre ? 'sombre' : 'clair'} : ${x}`));
        await fermer(c);
      }
    }
    expect(pb).toEqual([]);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
