// L'entreprise d'essai des développeurs (14 § 2.5) : une par personne, garnie de clients
// d'exemple, ses factures numérotées comme dans la v10 (« FAC-2026-001 », 0011 : l'écran de la v10
// annonce ce préfixe), marquée essai pour toujours ; une clé de l'API s'y
// crée et y travaille comme ailleurs, et la voisine n'y voit rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

describe('l\'entreprise d\'essai des développeurs', () => {
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const pool = creerPool(inject('pgApp'));
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
  let app: FastifyInstance;
  const appeler = async (methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) => {
    const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
    return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
  };
  let n = 0;
  const personne = async (prenom: string) => {
    const email = `essai-${++n}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    return String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  };
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    declarerGestesVentes();
    app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
    await app.ready();
  });
  afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

  it('une par personne, garnie de clients d\'exemple ; ses factures suivent la série de la v10 ; une clé y travaille ; la voisine n\'y voit rien', async () => {
    const dev = await personne('Développeuse');
    const r = await appeler('POST', '/entreprises-essai', dev);
    expect(r.statut).toBe(201);
    const ent = String(r.corps.id);
    // Devenue propriétaire, elle pose son code sur le téléphone (la règle du rôle), puis n'en a pas une seconde.
    await appeler('POST', '/moi/code', dev, { methode: 'application' });
    expect((await appeler('POST', '/entreprises-essai', dev)).corps.motif).toBe('Tu as déjà une entreprise d\'essai.');
    const moi = (await appeler('GET', '/moi', dev)).corps.entreprises as Record<string, unknown>[];
    expect(moi).toEqual([{ id: ent, raison_sociale: 'Entreprise d\'essai de Développeuse', essai: true, roles: ['proprietaire'], parCabinet: false }]);
    // Elle crée une clé, et la clé facture un client d'exemple.
    const clients = (await appeler('GET', `/entreprises/${ent}/clients`, dev)).corps.clients as { id: string; raison_sociale: string }[];
    expect(clients.map((c) => c.raison_sociale).sort()).toEqual(['Amel Ben Salah (exemple)', 'Atelier Lumière (exemple)', 'Menuiserie du Lac (exemple)']);
    const cle = String((await appeler('POST', `/entreprises/${ent}/cles-api`, dev, { nom: 'Mon logiciel', gestes: ['ventes.pieces.voir', 'ventes.brouillon.modifier', 'ventes.facture.emettre'],
      expireLe: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) })).corps.cle);
    const tunisien = clients.find((c) => c.raison_sociale.startsWith('Menuiserie'))?.id;
    const piece = await appeler('POST', `/entreprises/${ent}/ventes`, cle, { type: 'facture', tiers: tunisien, datePiece: '2026-10-01', lignes: [{ designation: 'Essai', quantite: '1', prixUnitaire: '10', tauxTva: '19' }] });
    const emise = await appeler('POST', `/entreprises/${ent}/ventes/${piece.corps.id}/emettre`, cle);
    expect(emise.statut).toBe(200);
    expect(String(emise.corps.numero)).toBe('FAC-2026-001');
    // Une voisine ne voit rien de l'entreprise d'essai.
    const voisine = await personne('Voisine');
    expect((await appeler('GET', `/entreprises/${ent}/clients`, voisine)).statut).toBe(404);
    // Essai pour toujours ; et une vraie entreprise ne le devient jamais.
    await expect(admin.query('update socle.entreprise set essai = false where id = $1', [ent])).rejects.toThrow(/essai le reste/);
    const vraie = String((await appeler('POST', '/entreprises', voisine, { raisonSociale: 'Vraie entreprise' })).corps.id);
    await expect(admin.query('update socle.entreprise set essai = true where id = $1', [vraie])).rejects.toThrow(/essai le reste/);
  });
});
