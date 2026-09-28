// Les listes que les écrans lisent (règle : toute liste qu'on nomme se pagine) : les factures, la
// plus récente d'abord, et les clients, par ordre alphabétique. Page après page, aucune ligne n'est
// sautée ni vue deux fois, même quand plusieurs lignes ont la même clé de tri (même jour, même nom).
// Une facture émise montre le client de sa copie figée (R7).

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

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function entreprise() {
  const email = `listes-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Listes ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier des listes' })).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  await appeler('POST', `/entreprises/${ent}/series`, jeton, { type: 'facture', prefixe: 'FAC', legale: true });
  const client = async (raisonSociale: string) => String((await appeler('POST', `/entreprises/${ent}/clients`, jeton, { raisonSociale })).corps.id);
  const piece = async (tiers: string, datePiece: string, type = 'facture') => String((await appeler('POST', `/entreprises/${ent}/ventes`, jeton, {
    type, tiers, datePiece, lignes: [{ designation: 'Étagère', quantite: '3', prixUnitaire: '120.250', tauxTva: '19' }],
  })).corps.id);
  return { ent, jeton, client, piece };
}
// Toutes les pages d'une liste, `limite` lignes à la fois.
async function toutesLesPages(jeton: string, url: string, cle: 'lignes' | 'clients', curseur: 'avant' | 'apres', limite: number) {
  const vues: Record<string, unknown>[] = [];
  let suite: string | null = null;
  let pages = 0;
  do {
    const r = await appeler('GET', `${url}${url.includes('?') ? '&' : '?'}limite=${limite}${suite ? `&${curseur}=${encodeURIComponent(suite)}` : ''}`, jeton);
    expect(r.statut).toBe(200);
    vues.push(...(r.corps[cle] as Record<string, unknown>[]));
    suite = r.corps.suite as string | null;
    pages++;
  } while (suite && pages < 20);
  return { vues, pages };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les listes des écrans', () => {
  it('les factures, la plus récente d\'abord, page après page : trois le même jour, aucune sautée ni vue deux fois', async () => {
    const e = await entreprise();
    const c = await e.client('Garage Nord');
    const ids = [await e.piece(c, '2026-10-01'), await e.piece(c, '2026-10-03'), await e.piece(c, '2026-10-01'), await e.piece(c, '2026-09-30'), await e.piece(c, '2026-10-01')];
    await e.piece(c, '2026-10-02', 'devis');
    const emise = ids[1] ?? '';
    await appeler('POST', `/entreprises/${e.ent}/ventes/${emise}/emettre`, e.jeton);

    const { vues, pages } = await toutesLesPages(e.jeton, `/entreprises/${e.ent}/ventes?type=facture`, 'lignes', 'avant', 2);
    expect(pages).toBe(3);
    // L'ordre attendu : le jour, du plus récent au plus ancien ; le même jour, l'identifiant.
    const attendu = [...ids].map((id, i) => ({ id, jour: ['2026-10-01', '2026-10-03', '2026-10-01', '2026-09-30', '2026-10-01'][i] ?? '' }))
      .sort((a, b) => (a.jour === b.jour ? (a.id < b.id ? 1 : -1) : a.jour < b.jour ? 1 : -1)).map((x) => x.id);
    expect(vues.map((v) => v.id)).toEqual(attendu);
    // L'émise dit son numéro et son net à payer, en texte exact ; un brouillon, ni l'un ni l'autre.
    // 3 × 120,250 = 360,750 HT ; TVA 19 % = 68,543 ; timbre 1,000 → 430,293.
    expect(vues.find((v) => v.id === emise)).toMatchObject({ statut: 'emise', numero: 'FAC-2026-001', netAPayer: '430.293', symbole: 'DT', client: 'Garage Nord', datePiece: '2026-10-03' });
    expect(vues.filter((v) => v.statut === 'brouillon').every((v) => v.numero === null && v.netAPayer === null)).toBe(true);
    // Le devis n'est pas une facture : il est dans sa propre liste.
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes?type=devis`, e.jeton)).corps.lignes).toHaveLength(1);
  });

  it('R7 : dans la liste comme en la lisant, une facture émise garde le client de sa copie ; un brouillon suit la fiche', async () => {
    const e = await entreprise();
    const c = await e.client('Menuiserie Ancienne');
    const emise = await e.piece(c, '2026-10-01');
    await appeler('POST', `/entreprises/${e.ent}/ventes/${emise}/emettre`, e.jeton);
    const brouillon = await e.piece(c, '2026-10-02');
    await admin.query(`update socle.tiers set raison_sociale = 'Menuiserie Nouvelle' where id = $1`, [c]);
    const lignes = (await appeler('GET', `/entreprises/${e.ent}/ventes`, e.jeton)).corps.lignes as Record<string, unknown>[];
    expect(lignes.find((l) => l.id === emise)?.client).toBe('Menuiserie Ancienne');
    expect(lignes.find((l) => l.id === brouillon)?.client).toBe('Menuiserie Nouvelle');
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${emise}`, e.jeton)).corps).toMatchObject({ client: 'Menuiserie Ancienne', deviseSymbole: 'DT' });
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${brouillon}`, e.jeton)).corps).toMatchObject({ client: 'Menuiserie Nouvelle' });
  });

  it('les clients, par ordre alphabétique, page après page : deux du même nom, aucun sauté ni vu deux fois', async () => {
    const e = await entreprise();
    const ids = new Map<string, string[]>();
    // Les deux « Carthage Verre » tombent à cheval sur deux pages : une page qui reprendrait après
    // le dernier NOM vu, sans son identifiant, sauterait le second.
    for (const nom of ['Zitouna Services', 'Carthage Verre', 'Médina Cuir', 'Carthage Verre', 'Atlas Bois']) {
      ids.set(nom, [...(ids.get(nom) ?? []), await e.client(nom)]);
    }
    const { vues, pages } = await toutesLesPages(e.jeton, `/entreprises/${e.ent}/clients`, 'clients', 'apres', 2);
    expect(pages).toBe(3);
    expect(vues.map((v) => v.raison_sociale)).toEqual(['Atlas Bois', 'Carthage Verre', 'Carthage Verre', 'Médina Cuir', 'Zitouna Services']);
    expect(new Set(vues.map((v) => v.id)).size).toBe(5);
    expect(vues.slice(1, 3).map((v) => v.id)).toEqual([...(ids.get('Carthage Verre') ?? [])].sort());
  });

  it('un curseur illisible repart du début ; un type inconnu est refusé sur son champ', async () => {
    const e = await entreprise();
    const c = await e.client('Garage Sud');
    await e.piece(c, '2026-10-01');
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes?avant=pas-un-curseur`, e.jeton)).corps.lignes).toHaveLength(1);
    expect((await appeler('GET', `/entreprises/${e.ent}/clients?apres=%E2%9C%93`, e.jeton)).corps.clients).toHaveLength(1);
    expect(await appeler('GET', `/entreprises/${e.ent}/ventes?type=bon`, e.jeton)).toMatchObject({ statut: 400, corps: { champ: 'type' } });
  });

  it('un champ refusé donne aussi sa raison seule, que l\'écran montre sous le champ', async () => {
    const e = await entreprise();
    const c = await e.client('Garage Est');
    const r = await appeler('POST', `/entreprises/${e.ent}/ventes`, e.jeton, { type: 'facture', tiers: c, datePiece: '2026-10-01',
      lignes: [{ designation: 'Vis', quantite: '1', prixUnitaire: '12.5000001', tauxTva: '19' }] });
    expect(r.statut).toBe(400);
    expect(r.corps).toMatchObject({ champ: 'lignes.0.prixUnitaire', raison: 'un nombre à 6 décimales au plus, écrit avec une virgule ou un point (« 2,525 »)' });
    expect(r.corps.motif).toBe('Le champ « lignes.0.prixUnitaire » ne va pas : un nombre à 6 décimales au plus, écrit avec une virgule ou un point (« 2,525 »).');
    // Un taux illisible est un refus sur son champ, jamais une panne du serveur ; un taux hors de 0 à 100 aussi.
    const taux = async (tauxTva: string) => appeler('POST', `/entreprises/${e.ent}/ventes`, e.jeton, { type: 'facture', tiers: c, datePiece: '2026-10-01',
      lignes: [{ designation: 'Vis', quantite: '1', prixUnitaire: '12.5', tauxTva }] });
    expect(await taux('sept')).toMatchObject({ statut: 400, corps: { champ: 'lignes.0.tauxTva', raison: 'un nombre à 4 décimales au plus, écrit avec une virgule ou un point (« 2,525 »)' } });
    expect(await taux('119')).toMatchObject({ statut: 400, corps: { champ: 'lignes.0.tauxTva', raison: 'un pourcentage entre 0 et 100' } });
  });
});
