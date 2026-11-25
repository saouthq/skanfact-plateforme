// 1.388.79 — La console limitée à des adresses (pilotage depuis la console, point 9 ; base 0234). Ce que le serveur garantit :
//   - tant que la liste est vide, la console s'ouvre de partout, comme avant ;
//   - le titulaire seul pose ou retire une adresse, avec un motif ; la première doit contenir la sienne, et il ne retire
//     pas l'adresse qui le laisse entrer tant qu'aucune autre ne le fait : la console ne lui ferme jamais la porte ;
//   - depuis une autre adresse, la connexion à la console ET une session déjà ouverte sont refusées, en le disant ;
//   - l'application des clients n'est pas touchée ; la commande du serveur rouvre la console.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, ouvrirAdresses, titulaire as designerTitulaire } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { routesAdressesConsole } from '../../serveur/adresses-console.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const ICI = '197.15.20.4';
const AILLEURS = '41.226.8.9';
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adresses-console-')), 'veille.json');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown, depuis: string = ICI): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, remoteAddress: depuis, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `adresse-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
let nour: Awaited<ReturnType<typeof membre>>;
const nettoyer = () => admin.query('delete from plateforme.adresse_console');
const adresses = async (jeton: string, depuis = ICI) => (await appeler('GET', '/console/adresses', jeton, undefined, depuis)).corps as {
  titulaire: boolean; ici: string; iciPermise: boolean; adresses: { id: number; plage: string; nom: string; contientIci: boolean }[]; historique: { geste: string; motif: string }[];
};

beforeAll(async () => {
  await admin.connect();
  await nettoyer();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAdressesConsole(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
  // Nour est de la direction sans être le titulaire : la base lui refuse les adresses.
  nour = await membre('nour', 'direction');
  if (!(await admin.query('select titulaire from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1', [amira.email])).rows[0]?.titulaire) {
    await designerTitulaire(admin, amira.email, 'mise en place des essais');
  }
});
afterAll(async () => {
  await nettoyer();
  await app.close(); await admin.end(); await pool.end();
});

describe('la console limitée aux adresses du titulaire', () => {
  it('sans adresse, la console s\'ouvre de partout ; la page dit d\'où l\'on parle', async () => {
    const d = await adresses(amira.console, AILLEURS);
    expect(d).toMatchObject({ titulaire: true, ici: AILLEURS, iciPermise: true, adresses: [] });
    expect((await adresses(karim.console, ICI)).titulaire).toBe(false);
  });

  it('seul le titulaire pose une adresse, avec un motif ; une plage qui contient tout internet est refusée', async () => {
    const k = await appeler('POST', '/console/adresses', karim.console, { plage: ICI, nom: 'Maison', motif: 'Essai adresse' });
    expect(k.statut).toBe(403);
    const n2 = await appeler('POST', '/console/adresses', nour.console, { plage: ICI, nom: 'Maison', motif: 'Essai adresse' });
    expect(n2.statut).toBe(403);
    expect(String(n2.corps.motif)).toMatch(/^Seul le titulaire de la console choisit les adresses/);
    const sansMotif = await appeler('POST', '/console/adresses', amira.console, { plage: ICI, nom: 'Maison', motif: 'x' });
    expect(sansMotif.statut).toBe(403);
    const tout = await appeler('POST', '/console/adresses', amira.console, { plage: '0.0.0.0/0', nom: 'Tout', motif: 'Essai adresse' });
    expect(tout.statut).toBe(403);
    expect(String(tout.corps.motif)).toMatch(/tout internet/);
    const illisible = await appeler('POST', '/console/adresses', amira.console, { plage: '197.15.20', nom: 'Maison', motif: 'Essai adresse' });
    expect(String(illisible.corps.motif)).toMatch(/ne se lit pas/);
    expect((await adresses(amira.console)).adresses).toEqual([]);
  });

  it('la première adresse doit contenir celle d\'où l\'on parle : la console ne ferme jamais la porte à son titulaire', async () => {
    const autre = await appeler('POST', '/console/adresses', amira.console, { plage: AILLEURS, nom: 'Ailleurs', motif: 'Essai adresse' });
    expect(autre.statut).toBe(403);
    expect(String(autre.corps.motif)).toContain(ICI);
    const ok = await appeler('POST', '/console/adresses', amira.console, { plage: ICI, nom: 'Maison', motif: 'Essai adresse : chez moi' });
    expect(ok.statut).toBe(201);
    const d = await adresses(amira.console);
    expect(d.adresses).toMatchObject([{ plage: ICI, nom: 'Maison', contientIci: true }]);
    expect(d.iciPermise).toBe(true);
    expect(d.historique[0]).toMatchObject({ geste: 'console.adresse_ajoutee', motif: 'Essai adresse : chez moi' });
    const double = await appeler('POST', '/console/adresses', amira.console, { plage: ICI, nom: 'Encore', motif: 'Essai adresse' });
    expect(String(double.corps.motif)).toMatch(/déjà dans la liste/);
  });

  it('depuis une autre adresse : une session déjà ouverte et la connexion sont refusées, en le disant ; l\'application des clients passe', async () => {
    const session = await appeler('GET', '/console/adresses', amira.console, undefined, AILLEURS);
    expect(session.statut).toBe(403);
    expect(session.corps.adresseRefusee).toBe(AILLEURS);
    expect(String(session.corps.motif)).toMatch(/ne s'ouvre pas depuis cette adresse \(41\.226\.8\.9\)/);
    const entree = await appeler('POST', '/console/connexion', undefined, { email: amira.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } }, AILLEURS);
    expect(entree.statut).toBe(403);
    expect(entree.corps).toMatchObject({ etat: 'refuse', adresseRefusee: AILLEURS });
    // Depuis la liste, la même entrée avance (le code est demandé).
    const ici = await appeler('POST', '/console/connexion', undefined, { email: amira.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } }, ICI);
    expect(ici.statut).toBe(200);
    // L'application des clients ne regarde jamais cette liste.
    const appli = await appeler('GET', '/moi', amira.appli, undefined, AILLEURS);
    expect(appli.statut).toBe(200);
  });

  it('une plage laisse entrer ses adresses ; on ne retire pas l\'adresse qui nous laisse entrer tant qu\'une autre ne le fait pas', async () => {
    // Une plage écrite depuis une de ses adresses se ramène à son début.
    const plage = await appeler('POST', '/console/adresses', amira.console, { plage: '41.226.8.77/24', nom: 'Bureau', motif: 'Essai adresse : le bureau' });
    expect(plage.statut).toBe(201);
    expect((await appeler('GET', '/console/adresses', amira.console, undefined, AILLEURS)).statut).toBe(200);
    const d = await adresses(amira.console);
    const maison = d.adresses.find((a) => a.nom === 'Maison');
    const bureau = d.adresses.find((a) => a.nom === 'Bureau');
    if (!maison || !bureau) throw new Error('deux adresses attendues');
    expect(bureau.plage).toBe('41.226.8.0/24');
    // Depuis la maison, retirer la maison laisserait le bureau seul : la console se fermerait. Refusé.
    const seule = await appeler('POST', '/console/adresses/retirer', amira.console, { id: maison.id, motif: 'Essai adresse' });
    expect(seule.statut).toBe(403);
    expect(String(seule.corps.motif)).toContain(ICI);
    // Depuis le bureau, retirer la maison passe.
    const depuisBureau = await appeler('POST', '/console/adresses/retirer', amira.console, { id: maison.id, motif: 'Essai adresse : déménagé' }, AILLEURS);
    expect(depuisBureau.statut).toBe(200);
    // Le dernier retrait vide la liste : la console s'ouvre de nouveau de partout.
    const dernier = await appeler('POST', '/console/adresses/retirer', amira.console, { id: bureau.id, motif: 'Essai adresse : plus de liste' }, AILLEURS);
    expect(dernier.statut).toBe(200);
    expect((await adresses(amira.console, '8.8.8.8')).iciPermise).toBe(true);
  });

  it('la commande du serveur rouvre la console si toutes les adresses ont changé, et le journal le garde', async () => {
    expect((await appeler('POST', '/console/adresses', amira.console, { plage: ICI, nom: 'Maison', motif: 'Essai adresse' })).statut).toBe(201);
    expect((await appeler('GET', '/console/adresses', amira.console, undefined, AILLEURS)).statut).toBe(403);
    expect(await ouvrirAdresses(admin, 'Essai adresse : la box a changé')).toBe(1);
    const d = await adresses(amira.console, AILLEURS);
    expect(d).toMatchObject({ iciPermise: true, adresses: [] });
    expect(d.historique[0]).toMatchObject({ geste: 'console.adresses_ouvertes', motif: 'Essai adresse : la box a changé' });
  });
});
