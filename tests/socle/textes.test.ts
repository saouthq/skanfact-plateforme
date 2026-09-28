// Le catalogue des textes (14 § 5) : aucune phrase écrite en dur dans le serveur, chaque phrase de
// la base connue du catalogue, chaque clé employée déclarée, et la langue factice (40 % plus longue)
// qui montre qu'un refus passe bien par le catalogue.

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { clesDuCatalogue, declarerTextes, factice, MESSAGES_DE_LA_BASE, motif, rendre, t, texteConnu, texteFrancais } from '../../textes/index.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestes, GESTES } from '../../serveur/porte/gestes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const fichiers = (dossier: string, ext: string): string[] => fs.readdirSync(path.join(RACINE, dossier), { withFileTypes: true, recursive: true })
  .filter((f) => f.isFile() && f.name.endsWith(ext)).map((f) => path.join(f.parentPath, f.name));
// Le code sans ses commentaires (un test qui lit du code lit du CODE).
const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const LITTERAL = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const PHRASE = /\p{L}{2,}[ ’']\p{L}{2,}/u;
const SQL = /^\s*(select|insert|update|delete|with|set|begin|commit|rollback|savepoint|create|drop|alter|grant)\b/i;

// Le texte d'un gabarit `…${x}…` sans ses expressions (qui sont du code).
function horsExpressions(gabarit: string): string {
  let sortie = '';
  let profondeur = 0;
  for (let i = 0; i < gabarit.length; i++) {
    if (profondeur === 0 && gabarit[i] === '$' && gabarit[i + 1] === '{') { profondeur = 1; i++; continue; }
    if (profondeur > 0) {
      if (gabarit[i] === '{') profondeur++;
      if (gabarit[i] === '}') profondeur--;
      continue;
    }
    sortie += gabarit[i];
  }
  return sortie;
}

// Les phrases écrites en dur dans le code du serveur : hors SQL, hors messages internes
// (`new Error(…)` : une erreur du serveur ne montre jamais son message, seulement « une erreur est
// survenue »), hors messages à l'exploitant (le programme qui refuse de démarrer, ce qu'il écrit
// dans son journal : personne d'autre ne les lit), et hors fichiers du catalogue (`textes.ts` d'un
// module, qui SONT le catalogue).
export function phrasesEnDur(): string[] {
  const trouvees: string[] = [];
  for (const f of fichiers('serveur', '.ts').filter((x) => path.basename(x) !== 'textes.ts')) {
    const code = sansCommentaires(fs.readFileSync(f, 'utf8'));
    for (const m of code.matchAll(LITTERAL)) {
      const texte = m[1] ?? horsExpressions(m[2] ?? '');
      if (!PHRASE.test(texte) || SQL.test(texte)) continue;
      const avant = code.slice(Math.max(0, (m.index ?? 0) - 40), m.index).replace(/\s+/g, ' ');
      if (/(new (Error|RouteSansGeste|ConfigurationFausse)|console\.(log|error))\($/.test(avant)) continue;
      trouvees.push(`${path.relative(RACINE, f)} : ${texte.slice(0, 80)}`);
    }
  }
  return trouvees;
}

// Les phrases que la base écrit (socle.refus, les règles des tables, les motifs du contrôle).
function phrasesDeLaBase(): string[] {
  const vues = new Set<string>();
  for (const f of fichiers('base/migrations', '.sql')) {
    const sql = fs.readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/(?:socle\.refus\((?:format\()?|raise exception |pourquoi := )'((?:[^']|'')*)'/g)) {
      const texte = (m[1] ?? '').replaceAll('\'\'', '\'');
      if (texte !== '%') vues.add(texte);
    }
  }
  return [...vues];
}

const ctx: Contexte = { pool: creerPool(inject('pgApp')), listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, options: { jeton?: string; corps?: unknown; factice?: boolean } = {}) {
  const r = await app.inject({
    method: methode, url: VERSION + url,
    headers: { ...(options.jeton ? { authorization: `Bearer ${options.jeton}` } : {}), ...(options.factice ? { 'x-langue': 'factice' } : {}) },
    ...(options.corps === undefined ? {} : { payload: options.corps as Record<string, unknown> }),
  });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await ctx.pool.end(); });

describe('le catalogue des textes', () => {
  it('aucune phrase n\'est écrite en dur dans le code du serveur', () => {
    expect(phrasesEnDur()).toEqual([]);
  });

  it('chaque phrase de la base est au catalogue, et chaque phrase du catalogue de la base est encore dans la base', () => {
    const base = phrasesDeLaBase();
    const connues = MESSAGES_DE_LA_BASE.map((m) => m.base);
    expect(base.filter((p) => !connues.includes(p))).toEqual([]);
    expect(connues.filter((p) => !base.includes(p))).toEqual([]);
  });

  it('chaque clé employée par le code est déclarée, et chaque geste a son texte', () => {
    const manquantes: string[] = [];
    for (const f of fichiers('serveur', '.ts')) {
      const code = sansCommentaires(fs.readFileSync(f, 'utf8'));
      for (const m of code.matchAll(/(?:\b(?:t|motif|Refus|MiseDeCote|Perimee)\(|message: |regex\([^,]+, |refine\([\s\S]{0,200}?\}, )'([a-z_]+(?:\.[a-zA-Z0-9_]+)+)'/g)) {
        if (!texteConnu(m[1] ?? '')) manquantes.push(`${path.relative(RACINE, f)} : ${m[1]}`);
      }
    }
    expect(manquantes).toEqual([]);
    expect([...GESTES.keys()].filter((g) => !texteConnu(`geste.${g}`))).toEqual([]);
    // Un geste sans son texte ne se déclare pas ; une clé ne change pas de phrase en cours de route.
    expect(() => declarerGestes([{ code: 'essai.sans.texte', module: 'essai', ecrit: false, roles: {} }])).toThrow(/pas son texte au catalogue/);
    expect(() => declarerTextes({ 'commun.introuvable': 'autre chose' })).toThrow(/déclaré deux fois/);
  });

  it('« de » s\'élide devant une voyelle : « ne permet pas d\'inviter », « ne permet pas de voir »', () => {
    const refus = (geste: string) => rendre(motif('porte.role_refuse', { roles: 'Lecture', geste: t(`geste.${geste}`) }), 'fr');
    expect(refus('socle.equipe.gerer')).toBe('Ton rôle (Lecture) ne permet pas d\'inviter, retirer un membre ou changer un rôle.');
    expect(refus('socle.accueil.voir')).toBe('Ton rôle (Lecture) ne permet pas de voir l\'accueil.');
  });

  it('la langue factice est 40 % plus longue, change chaque mot, et garde les valeurs', () => {
    for (const cle of clesDuCatalogue()) {
      const fr = texteFrancais(cle) ?? '';
      const f = factice(fr);
      const valeurs = (s: string) => [...s.matchAll(/\{(?:de:)?[a-zA-Z_]+\}/g)].map((m) => m[0]).sort();
      expect(valeurs(f), cle).toEqual(valeurs(fr));
      expect([...f].length, cle).toBeGreaterThanOrEqual(Math.ceil([...fr].length * 1.4));
      if (/[aeiou]/i.test(fr.replace(/\{[a-zA-Z_]+\}/g, ''))) expect(f, cle).not.toContain(fr);
    }
  });

  it('un refus du serveur, un refus de la base et un champ qui ne va pas passent par le catalogue (langue factice)', async () => {
    // Un champ qui ne va pas : en français, jamais le message anglais de la bibliothèque.
    const champ = await appeler('POST', '/inscription', { corps: { email: 'pas-une-adresse', nom: 'X', motDePasse: 'Un-bon-mot-de-passe' } });
    expect(champ).toMatchObject({ statut: 400, corps: { motif: 'Le champ « email » ne va pas : une adresse e-mail est attendue.', champ: 'email' } });
    const champFactice = await appeler('POST', '/inscription', { corps: { email: 'pas-une-adresse', nom: 'X', motDePasse: 'Un-bon-mot-de-passe' }, factice: true });
    expect(champFactice.corps.motif).toMatch(/^⟦/);
    expect(champFactice.corps.motif).toContain('email');

    // Un refus du serveur (personne connectée) et un refus venu de la base (s'inviter soi-même).
    expect((await appeler('GET', '/moi', { factice: true })).corps.motif).toMatch(/^⟦Çóññ/);
    const email = `textes-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', { corps: { email, nom: 'Textes', motDePasse: 'Un-bon-mot-de-passe' } });
    const jeton = String((await appeler('POST', '/connexion', { corps: { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises', { jeton, corps: { raisonSociale: 'Textes et Cie' } })).corps.id);
    await appeler('POST', '/moi/code', { jeton, corps: { methode: 'application' } });
    const invitation = { email, roles: ['commercial'] };
    expect((await appeler('POST', `/entreprises/${ent}/invitations`, { jeton, corps: invitation })).corps.motif).toBe('Personne ne s\'invite soi-même.');
    const enFactice = (await appeler('POST', `/entreprises/${ent}/invitations`, { jeton, corps: invitation, factice: true })).corps.motif;
    expect(enFactice).toMatch(/^⟦Pérśóññé ñé ś'íñvíté śóí-mêmé ·+⟧\.$/);
  });
});
