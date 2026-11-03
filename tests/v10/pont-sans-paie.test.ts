// Le point de contact rend à la page que la paie manque à ses chiffres (cadrage 16 § 10.1, point 4 ; 1.266.7). Le serveur dit
// `paieCachee` à la comptabilité interne et à la lecture d'une entreprise qui a une paie ; le point de contact le donne à la
// page (`droitsDossier`), et le garde dans la copie du poste, pour que la page le dise encore sans réseau.

import { describe, expect, it } from 'vitest';
import { chargerPont, type Routes } from './bac-pont.ts';

const ENT = '00000000-0000-4000-8000-0000000000b4';
type Pont = { loadData: () => Promise<unknown>; droitsDossier: () => Record<string, unknown> };
const DOSSIER = `GET /v1/entreprises/${ENT}/dossier-v10`;
const routes = (droits: Record<string, unknown>): Routes => ({
  'GET /v1/moi': () => ({ statut: 200, corps: { email: 'samia@exemple.tn', entreprises: [{ id: ENT, essai: false }] } }),
  [DOSSIER]: () => ({ statut: 200, corps: { objets: [{ collection: '_racine', cle: 'company', rang: null, revision: 1, contenu: { name: 'Matériaux Ben Youssef' } }], droits } }),
  [`GET /v1/entreprises/${ENT}/compta/questions`]: () => ({ statut: 200, corps: { questions: [] } }),
  [`GET /v1/entreprises/${ENT}/quarantaine`]: () => ({ statut: 200, corps: { remises: [] } }),
  [`GET /v1/entreprises/${ENT}/abonnement/etat`]: () => ({ statut: 200, corps: {} }),
});
const SANS_PAIE = { cachees: ['employees', 'payslips', 'advances', 'socialFilings'], lectureSeule: ['documents'], ecrivables: ['purchases', 'movements'], tout: false, responsable: false, caisse: false };

describe('« sans la paie », au point de contact', () => {
  it('le point de contact rend à la page que la paie lui manque, et le garde dans la copie du poste', async () => {
    const t = chargerPont<Pont>(ENT, routes({ ...SANS_PAIE, paieCachee: true }), {}, { SkanAbonnement: { licence: (a: unknown) => a } });
    await t.pont.loadData();
    expect(t.pont.droitsDossier().paieCachee).toBe(true);
    // Des droits qui ne le disent pas (un serveur d'avant) : rien n'est caché.
    const u = chargerPont<Pont>(ENT, routes(SANS_PAIE), {}, { SkanAbonnement: { licence: (a: unknown) => a } });
    await u.pont.loadData();
    expect(u.pont.droitsDossier().paieCachee).toBe(false);
    // Sur « mon ordinateur », la copie du poste garde le drapeau avec les autres droits.
    const copies: { droits?: Record<string, unknown> }[] = [];
    const poste = { garde: () => true, limite: () => null, lireCopie: async () => null, lireAttente: async () => null,
      ecrireCopie: async (_e: string, c: { droits?: Record<string, unknown> }) => { copies.push(c); } };
    const v = chargerPont<Pont>(ENT, routes({ ...SANS_PAIE, paieCachee: true }), {}, { SkanAbonnement: { licence: (a: unknown) => a },
      SkanPoste: new Proxy(poste, { get: (p, k) => (typeof k === 'string' && k in p ? (p as Record<string, unknown>)[k] : () => undefined) }) });
    await v.pont.loadData();
    await new Promise((r) => setTimeout(r, 450));
    expect(copies.at(-1)?.droits?.paieCachee).toBe(true);
  });
});
