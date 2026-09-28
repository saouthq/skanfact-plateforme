// Le programme serveur : il refuse de démarrer sur une configuration fausse (et en production tant
// qu'aucun fournisseur de SMS n'est choisi), écoute, fait tourner le livreur des avis, s'arrête
// proprement ; sans fournisseur, un SMS ne part jamais en silence.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { rendre } from '../../textes/index.ts';
import type { Envoi } from '../../serveur/avis.ts';
import { ConfigurationFausse, demarrer, lireConfiguration, smsAucun } from '../../serveur/principal.ts';

describe('le programme serveur', () => {
  it('une configuration fausse l\'arrête avant qu\'il n\'écoute, et dit laquelle', () => {
    expect(() => lireConfiguration({})).toThrow(ConfigurationFausse);
    expect(() => lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'essai' })).toThrow(/test.*production/);
    expect(() => lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'production' })).toThrow(/fournisseur de SMS/);
    expect(() => lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_SMS: 'orange' })).toThrow(/aucun fournisseur/);
    expect(() => lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_PORT: 'huit' })).toThrow(/port/);
    expect(lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test' })).toMatchObject({ port: 8080, hote: '127.0.0.1', sms: 'aucun', livreurMs: 15_000 });
  });

  it('sans fournisseur, un SMS ne part jamais en silence : la personne est invitée à choisir une application', async () => {
    const e = await smsAucun.envoyer('+21620000000', 'code').catch((x: unknown) => x) as { code?: string; texte?: Parameters<typeof rendre>[0]; bouton?: string };
    expect(e.code).toBe('42501');
    expect(rendre(e.texte as Parameters<typeof rendre>[0], 'fr')).toBe('L\'envoi du code par SMS n\'est pas encore en service : choisis une application d\'authentification.');
    expect(e.bouton).toBe('compte.code.configurer');
  });

  it('il écoute, décrit son API, livre les avis dus à chaque tour, et s\'arrête proprement', async () => {
    const recus: Envoi[] = [];
    const s = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, livreurMs: 50 },
      { envoyer: async (e) => { recus.push(e); return { statut: 200 }; } });
    try {
      const doc = await (await fetch(`${s.adresse}/v1/documentation`)).json() as { openapi: string };
      expect(doc.openapi).toBe('3.1.0');
      // Un avis dû, posé à la main : le livreur le prend au tour suivant.
      const admin = new pg.Client({ connectionString: inject('pgAdmin') });
      await admin.connect();
      const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Programme serveur') returning id`)).rows[0].id as string;
      const ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Programme serveur') returning id`, [org])).rows[0].id as string;
      const qui = (await admin.query(`insert into socle.utilisateur (email, nom) values ('programme@exemple.tn', 'Programme') returning id`)).rows[0].id as string;
      const ab = (await admin.query(`insert into socle.abonnement_avis (entreprise, url, evenements, secret, cree_par)
        values ($1, 'https://recoit.exemple.tn/', '{facture.emise}', 'whsec_' || repeat('A', 43), $2) returning id`, [ent, qui])).rows[0].id as string;
      await admin.query(`insert into socle.avis (entreprise, abonnement, evenement, corps) values ($1, $2, 'facture.emise', '{"numero":"FAC-1"}')`, [ent, ab]);
      for (let i = 0; i < 100 && !recus.length; i++) await new Promise((r) => setTimeout(r, 20));
      expect(recus.map((r) => r.url)).toEqual(['https://recoit.exemple.tn/']);
      await admin.end();
    } finally {
      await s.arreter();
    }
    await expect(fetch(`${s.adresse}/v1/documentation`)).rejects.toThrow();
  });

  it('il sert les écrans à côté de l\'API, avec leurs en-têtes de sécurité, et jamais un fichier hors de leur dossier', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrans-'));
    fs.mkdirSync(path.join(web, 'assets'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>SkanFact</title>');
    fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    const s = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, livreurMs: 60_000, web });
    try {
      const accueil = await fetch(`${s.adresse}/`);
      expect(accueil.status).toBe(200);
      expect(accueil.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(accueil.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(await (await fetch(`${s.adresse}/une/adresse/de/l/application`)).text()).toContain('<title>SkanFact</title>');
      const js = await fetch(`${s.adresse}/assets/app.js`);
      expect([js.headers.get('content-type'), js.headers.get('cache-control')]).toEqual(['text/javascript; charset=utf-8', 'public, max-age=31536000, immutable']);
      // Une adresse de l'API inconnue n'est jamais l'application ; un « ../ » ne sort jamais du dossier.
      expect((await fetch(`${s.adresse}/v1/inconnue`)).status).toBe(404);
      // La requête part BRUTE : un client ordinaire « nettoie » l'adresse avant de l'envoyer, et le
      // piège n'atteindrait jamais le serveur.
      const brut = (chemin: string) => new Promise<{ statut: number; corps: string }>((ok, ko) => {
        const u = new URL(s.adresse);
        http.get({ host: u.hostname, port: u.port, path: chemin }, (r) => {
          let corps = '';
          r.on('data', (d: Buffer) => { corps += d.toString(); });
          r.on('end', () => ok({ statut: r.statusCode ?? 0, corps }));
        }).on('error', ko);
      });
      // « %2e%2e » : l'analyse de l'adresse le ramène déjà à la racine (l'application est rendue).
      expect((await brut('/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).corps).not.toContain('root:');
      // Une barre encodée passe l'analyse : c'est la garde du serveur qui refuse.
      for (const chemin of ['/..%2f..%2f..%2f..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd']) {
        const piege = await brut(chemin);
        expect(piege.statut, chemin).toBe(404);
        expect(piege.corps, chemin).not.toContain('root:');
      }
    } finally {
      await s.arreter();
      fs.rmSync(web, { recursive: true, force: true });
    }
  });
});

