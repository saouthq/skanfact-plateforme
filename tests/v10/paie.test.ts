// La paie du dossier v10, tenue par le serveur (0014, brique 31 ; docs/paie.md). Ce que le serveur
// garantit, quel que soit ce que l'interface lui envoie :
//   - chaque bulletin se recalcule au serveur au même millime que l'écran de la v10, chacun de ses
//     montants (deux chemins, un chiffre), et la déclaration CNSS de chaque trimestre est la sienne ;
//   - un bulletin garde le barème qui l'a calculé : une loi de finances plus tard, il se relit et se
//     paie sans changer d'un millime ;
//   - un bulletin qui ne tombe pas juste, sans son barème, au brut nul ou au net négatif se refuse,
//     et rien de l'envoi n'est écrit ;
//   - chaque geste a sa trace, chaque LECTURE aussi (03 D10) ; la base elle-même ne montre la paie
//     qu'à ceux qui la font, et la masse salariale se lit sans un nom.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue, requetes } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { MONTANTS } from '../../serveur/v10/paie.ts';
import { texteConnu } from '../../textes/index.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { demo, ecranDeLaPlateforme, entier, exiger, hasard, type Societe } from '../moteur/v10.ts';

type Reglages = Record<string, unknown>;
type Salarie10 = { id: string; name: string; contract?: string; grossSalary?: number; headOfFamily?: boolean; children?: number; [k: string]: unknown };
type Saisie10 = { gross?: number; workedDays?: number; absentDays?: number; bonuses?: { label?: string; amount: number; taxable?: boolean }[]; deductions?: { label?: string; amount: number }[] };
type Calcul10 = Record<string, unknown>;
type Bulletin10 = Saisie10 & { id: string; employeeId: string; year: number; month: number; computed: Calcul10; paidDate?: string; [k: string]: unknown };
// L'écran de la PLATEFORME (la v10 et ses adaptations : un bulletin y fige son barème), et la v10 telle
// qu'elle est (le banc), pour ce qu'elle dit d'un dossier entier.
const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: Salarie10, i: Saisie10, s: Reglages) => Calcul10; baremesPaie: (r: Reglages) => Reglages };
const banc = exiger('../../banc/v10/compta.js') as { computePayslip: (e: Salarie10, i: Saisie10, s: Reglages) => Calcul10 };
const core = exiger('../../banc/v10/core.js') as {
  payrollSettings: (d: unknown) => Reglages;
  payrollCost: (d: unknown, periode: { from: string; to: string }) => number;
  cnssDeclaration: (d: unknown, annee: number, trimestre: number) => { slips: number; base: number; employee: number; employer: number; accident: number; total: number;
    rows: { employeeId: string; months: number; days: number; base: number; employee: number; employer: number; accident: number; total: number }[] };
  DEFAULT_COMPANY: Societe;
};

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
// Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
function encoder(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isInteger(v)) return { '~n': String(v) };
  if (Array.isArray(v)) return v.map(encoder);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)]));
  return v;
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
async function essai() {
  const { jeton } = await personne('paie');
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);   // le dossier naît au premier chargement
  const revisions = new Map<string, number>();
  // Envoie des objets du dossier (null : le retirer), avec la révision que l'interface en connaît.
  const envoyer = async (collection: string, objets: [string, unknown][], rang = 0) => {
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, {
      changements: objets.map(([cle, contenu], i) => ({ collection, cle, rang: contenu === null ? null : rang + i, revision: revisions.get(`${collection}/${cle}`) ?? null, contenu: contenu === null ? null : encoder(contenu) })),
    });
    if (r.statut === 200) {
      for (const [i, x] of (r.corps.revisions as { revision: number | null }[]).entries()) {
        const k = `${collection}/${objets[i]?.[0]}`;
        if (x.revision === null) revisions.delete(k); else revisions.set(k, x.revision);
      }
    }
    return r;
  };
  const idDe = async (ref: string) => String((await admin.query('select id from paie.bulletin where entreprise = $1 and ref_v10 = $2', [ent, ref])).rows[0]?.id ?? '');
  const lire = async (ref: string) => (await appeler('GET', `/entreprises/${ent}/paie/bulletins/${await idDe(ref)}`, jeton)).corps;
  const trace = async () => (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'paie.%' and not lecture order by instant, id`, [ent])).rows.map((x) => String(x.geste));
  const inviter = async (role: string) => {
    const p = await personne(role);
    const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: invitation });
    await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id);
    return { ...p, utilisateur };
  };
  return { jeton, ent, envoyer, idDe, lire, trace, inviter };
}

// Un salarié tel que la fiche de la v10 l'écrit.
const salarie = (id: string, x: Partial<Salarie10> = {}): Salarie10 => ({
  id, name: 'Sonia Trabelsi', cin: '09876543', cnss: '223344-55', position: 'Comptable', contract: 'cdi', hireDate: '2025-03-01', endDate: '',
  grossSalary: 1234.567, headOfFamily: true, children: 2, method: 'virement', iban: 'TN59 1000 6035 1835 9847 8831', notes: '', ...x,
});
const REGLAGES = ecran.baremesPaie({});
// Un bulletin tel que l'écran de la plateforme l'établit : la saisie du mois, et son calcul (barème figé).
const bulletin = (id: string, e: Salarie10, annee: number, mois: number, saisie: Saisie10 = {}, reglages: Reglages = REGLAGES, x: Partial<Bulletin10> = {}): Bulletin10 => {
  const i = { gross: e.grossSalary ?? 0, workedDays: 26, absentDays: 0, bonuses: [], deductions: [], ...saisie };
  return { id, employeeId: e.id, year: annee, month: mois, ...i, computed: ecran.computePayslip(e, i, reglages), paidDate: '', accountId: '', method: 'virement', reference: '', issuedAt: `${annee}-${String(mois).padStart(2, '0')}-28`, ...x };
};
const periode = (a: number, t: number) => ({ from: `${a}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`, to: `${a}-${String(t * 3).padStart(2, '0')}-${t === 1 || t === 4 ? 31 : 30}` });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesPaie(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la paie du dossier v10, tenue par le serveur', () => {
  it('les bulletins de l\'exemple de cinq ans se recalculent au serveur au millime de l\'écran, et chaque déclaration CNSS est celle de la v10', async () => {
    const e = await essai();
    const d = demo.buildDemoData({ ...core.DEFAULT_COMPANY }, '2026-09-28') as unknown as { employees: Salarie10[]; payslips: Bulletin10[] };
    const reglages = core.payrollSettings(d);
    // L'écran de la plateforme calcule chaque bulletin comme la v10 (ses montants n'ont pas bougé d'un
    // millime), et fige en plus le barème et la situation qui l'ont calculé.
    for (const p of d.payslips) {
      const s = d.employees.find((x) => x.id === p.employeeId) as Salarie10;
      const avant = banc.computePayslip(s, p, reglages);
      p.computed = ecran.computePayslip(s, p, reglages);
      for (const [, a] of MONTANTS) expect(p.computed[a], `${p.id} ${a}`).toBe(avant[a]);
      expect(p.computed.bareme).toBeTruthy();
    }
    expect((await e.envoyer('employees', d.employees.map((s) => [s.id, s]))).statut).toBe(200);
    const envoi = await e.envoyer('payslips', d.payslips.map((p) => [p.id, p]));
    expect(envoi.statut, JSON.stringify(envoi.corps)).toBe(200);

    const faux: string[] = [];
    for (const p of d.payslips) {
      const lu = await e.lire(p.id);
      const montants = lu.montants as Record<string, string>;
      for (const [n, a] of MONTANTS) {
        if (n === 'brutDeBase' || n === 'apresCnss') continue;   // la saisie, et un montant qui ne se garde pas
        if (entier(montants[n], 3) !== entier(p.computed[a] as number, 3)) faux.push(`${p.id} ${n} : écran ${String(p.computed[a])}, serveur ${montants[n]}`);
      }
    }
    expect(faux).toEqual([]);
    expect(d.payslips.length).toBeGreaterThan(70);
    // Chaque trimestre : la déclaration du serveur est celle de la v10, salarié par salarié.
    const refs = new Map((await admin.query('select id, ref_v10 from paie.salarie where entreprise = $1', [e.ent])).rows.map((r) => [String(r.id), String(r.ref_v10)]));
    let trimestres = 0;
    for (const annee of [...new Set(d.payslips.map((p) => p.year))]) {
      for (const t of [1, 2, 3, 4]) {
        const v = core.cnssDeclaration(d, annee, t);
        if (!v.slips) continue;
        trimestres++;
        const s = (await appeler('GET', `/entreprises/${e.ent}/paie/cnss?annee=${annee}&trimestre=${t}`, e.jeton)).corps as {
          bulletins: number; totaux: Record<string, string>; lignes: { salarie: { id: string }; mois: number; jours: string; assiette: string; total: string }[] };
        expect(s.bulletins, `${annee} T${t}`).toBe(v.slips);
        expect([s.totaux.assiette, s.totaux.partSalarie, s.totaux.partEmployeur, s.totaux.accident, s.totaux.total].map((x) => entier(x, 3)), `${annee} T${t}`)
          .toEqual([v.base, v.employee, v.employer, v.accident, v.total].map((x) => entier(x, 3)));
        expect(s.lignes.map((l) => [refs.get(l.salarie.id), l.mois, entier(l.jours, 3), entier(l.assiette, 3), entier(l.total, 3)]).sort(), `${annee} T${t}`)
          .toEqual(v.rows.map((r) => [r.employeeId, r.months, entier(r.days, 3), entier(r.base, 3), entier(r.total, 3)]).sort());
        // La masse salariale du trimestre : le coût employeur que la v10 compte sur la même période.
        const masse = (await appeler('GET', `/entreprises/${e.ent}/paie/masse?du=${periode(annee, t).from}&au=${periode(annee, t).to}`, e.jeton)).corps;
        expect(entier(String(masse.coutEmployeur), 3), `${annee} T${t}`).toBe(entier(core.payrollCost(d, periode(annee, t)), 3));
        expect(masse.bulletins).toBe(v.slips);
      }
    }
    expect(trimestres).toBeGreaterThan(15);
    // Chaque bulletin, chaque salarié a laissé sa trace, une seule fois.
    const traces = await e.trace();
    expect(traces.filter((g) => g === 'paie.bulletin.etablir')).toHaveLength(d.payslips.length);
    expect(traces.filter((g) => g === 'paie.salarie.enregistrer')).toHaveLength(d.employees.length);
  });

  it('200 bulletins tirés au hasard (barèmes, régimes de contrat, absences, primes, retenues, familles) : les mêmes montants qu\'à l\'écran', async () => {
    const e = await essai();
    const h = hasard(20260929);
    const salaries: Salarie10[] = [];
    const bulletins: Bulletin10[] = [];
    while (bulletins.length < 200) {
      const k = bulletins.length;
      const reglages = ecran.baremesPaie({
        cnssEmployee: h.parmi([9.18, 9.18, 8.5]), cnssEmployer: h.parmi([16.57, 12.5]), accidentRate: h.parmi([0.4, 1.2, 4]),
        tfpRate: h.parmi([2, 1, 0]), foprolosRate: h.parmi([1, 0]), solidarity: h.parmi([1, 0.5, 0]), proRate: h.parmi([10, 5]),
        proCap: h.parmi([2000, 1500]), headOfFamily: h.parmi([300, 150]), perChild: h.parmi([100, 90]), maxChildren: h.parmi([4, 3]),
        ...(h.suivant() < 0.3 ? { brackets: [{ upTo: 5000, rate: 0 }, { upTo: 20000, rate: 26 }, { upTo: 30000, rate: 28 }, { upTo: 50000, rate: 32 }, { upTo: null, rate: 35 }] } : {}),
        regimesContrat: { civp: { cnssEmployee: 0, cnssEmployer: 0, sansIrpp: true }, cdd: { cnssEmployer: 12.5 }, saisonnier: { solidarity: 0.5 } },
      });
      const s = salarie(`s${k}`, {
        name: `Salarié ${k}`, contract: h.parmi(['cdi', 'cdd', 'civp', 'saisonnier']), headOfFamily: h.suivant() < 0.5, children: h.entre(0, 6),
        grossSalary: h.parmi([450, 1200.5, 2345.678, h.decimal(9000, 3)]),
      });
      const b = bulletin(`b${k}`, s, 2026, h.entre(1, 12), {
        workedDays: h.parmi([26, 22, 25.5]), absentDays: h.parmi([0, 0, 1, 0.5, 3.5]),
        bonuses: Array.from({ length: h.parmi([0, 1, 2]) }, () => ({ label: 'Prime', amount: h.parmi([400, 55.555, h.decimal(1000, 3)]), taxable: h.suivant() < 0.7 })),
        deductions: Array.from({ length: h.parmi([0, 0, 1]) }, () => ({ label: 'Avance', amount: h.parmi([200, 33.333]) })),
      }, reglages);
      // Seuls les bulletins que le formulaire de la v10 laisse enregistrer (un brut, un net positif).
      if (!(Number(b.computed.gross) > 0 && Number(b.computed.net) >= 0)) continue;
      salaries.push(s);
      bulletins.push(b);
    }
    expect((await e.envoyer('employees', salaries.map((s) => [s.id, s]))).statut).toBe(200);
    const envoi = await e.envoyer('payslips', bulletins.map((b) => [b.id, b]));
    expect(envoi.statut, JSON.stringify(envoi.corps)).toBe(200);
    const lignes = new Map((await admin.query('select ref_v10, net, irpp, css, cout_employeur, frais_pro from paie.bulletin where entreprise = $1', [e.ent])).rows.map((r) => [String(r.ref_v10), r]));
    const faux: string[] = [];
    for (const b of bulletins) {
      const r = lignes.get(b.id);
      const paires: [string, unknown, unknown][] = [['net', b.computed.net, r?.net], ['irpp', b.computed.irpp, r?.irpp], ['css', b.computed.css, r?.css], ['coût', b.computed.employerCost, r?.cout_employeur], ['frais pro', b.computed.pro, r?.frais_pro]];
      for (const [nom, v, s] of paires) if (entier(v as number, 3) !== BigInt(String(s))) faux.push(`${b.id} ${nom} : écran ${String(v)}, serveur ${String(s)}`);
    }
    expect(faux).toEqual([]);
    // Le banc a mesuré quelque chose : des régimes sans IRPP, des familles au plafond, des primes libres.
    expect(bulletins.filter((b) => (b.computed.regime as { sansIrpp?: boolean } | null)?.sansIrpp).length).toBeGreaterThan(10);
    expect(bulletins.filter((b) => Number(b.computed.freeBonus) > 0).length).toBeGreaterThan(10);
  });

  it('un bulletin garde son barème : une loi de finances plus tard, il se relit et se paie au même millime', async () => {
    const e = await essai();
    const s = salarie('s1');
    await e.envoyer('employees', [['s1', s]]);
    const janvier = bulletin('b1', s, 2026, 1, { bonuses: [{ label: 'Rendement', amount: 150.555, taxable: true }] });
    expect((await e.envoyer('payslips', [['b1', janvier]])).statut).toBe(200);
    // Calculé à la main (barème livré par la v10 : CNSS 9,18 %, frais pro 10 % plafonnés à 2 000 par
    // an, chef de famille 300, 100 par enfant, tranches 0 % jusqu'à 5 000, 15 % jusqu'à 10 000, 25 %
    // jusqu'à 20 000, CSS 1 %) : brut 1 234,567 + 150,555 = 1 385,122 ; CNSS 127,154 ; après CNSS
    // 1 257,968, soit 15 095,616 par an ; frais pro 1 509,562 ; famille 500 ; imposable 13 086,054 ;
    // IRPP 750 + 25 % × 3 086,054 = 1 521,514 par an, 126,793 par mois ; CSS 10,905 ; net 1 120,270 ;
    // charges 229,515 + 5,540 + 27,702 + 13,851 = 276,608 ; coût 1 661,730.
    expect(await e.lire('b1')).toMatchObject({
      montants: { brut: '1385.122', cnssSalarie: '127.154', fraisPro: '1509.562', imposableAnnuel: '13086.054', irppAnnuel: '1521.514', irpp: '126.793', css: '10.905', net: '1120.270', chargesPatronales: '276.608', coutEmployeur: '1661.730' },
      bareme: { cnssSalarie: '9.1800', plafondFraisPro: '2000.000', chefDeFamille: '300.000', parEnfant: '100.000' },
      situation: { chefDeFamille: true, enfants: 2 },
    });
    // Une loi de finances : un autre barème de l'IRPP, une autre CNSS. Les bulletins de février se
    // calculent avec lui ; celui de janvier ne bouge pas, même quand on le marque payé.
    const nouvelle = ecran.baremesPaie({ cnssEmployee: 9.68, brackets: [{ upTo: 5000, rate: 0 }, { upTo: 20000, rate: 26 }, { upTo: 30000, rate: 28 }, { upTo: 50000, rate: 32 }, { upTo: null, rate: 35 }] });
    const fevrier = bulletin('b2', s, 2026, 2, { bonuses: [{ label: 'Rendement', amount: 150.555, taxable: true }] }, nouvelle);
    expect((await e.envoyer('payslips', [['b1', { ...janvier, paidDate: '2026-02-03' }], ['b2', fevrier]])).statut).toBe(200);
    expect(await e.lire('b1')).toMatchObject({ montants: { net: '1120.270' }, bareme: { cnssSalarie: '9.1800' }, paiement: { payeLe: '2026-02-03' } });
    const lu = await e.lire('b2');
    expect(lu).toMatchObject({ bareme: { cnssSalarie: '9.6800' }, montants: { net: Number(fevrier.computed.net).toFixed(3) } });
    expect((lu.montants as { net: string }).net).not.toBe('1120.270');
    expect(await e.trace()).toEqual(['paie.salarie.enregistrer', 'paie.bulletin.etablir', 'paie.bulletin.modifier', 'paie.bulletin.etablir']);
  });

  it('un bulletin qui ne tombe pas juste, sans son barème, au brut nul ou au net négatif : refusé, et rien de l\'envoi n\'est écrit', async () => {
    const e = await essai();
    const s = salarie('s1');
    await e.envoyer('employees', [['s1', s]]);
    const bon = bulletin('ok', s, 2026, 3);
    const refus = async (b: Bulletin10) => {
      const r = await e.envoyer('payslips', [['ok', bon], [b.id, b]]);
      expect(r.statut).toBe(403);
      return r.corps.motif;
    };
    // Le bulletin de janvier (calculé à la main plus bas), avec un millime de plus sur l'impôt et de
    // moins sur le net : le serveur dit lequel ne tombe pas juste.
    const faux = bulletin('x', s, 2026, 4, { bonuses: [{ label: 'Rendement', amount: 150.555, taxable: true }] });
    expect([faux.computed.irpp, faux.computed.net]).toEqual([126.793, 1120.27]);
    faux.computed = { ...faux.computed, irpp: 126.794, net: 1120.269 };
    // Chaque montant a son nom au catalogue (le refus le nomme par une clé calculée).
    expect(MONTANTS.filter(([n]) => !texteConnu(`paie.montant.${n}`))).toEqual([]);
    expect(await refus(faux)).toBe('Le serveur ne trouve pas les mêmes montants que l\'écran pour le bulletin de Sonia Trabelsi (04/2026) : l\'impôt sur le revenu du mois vaut 126.794 à l\'écran, 126.793 au serveur. Rien n\'a été enregistré.');
    const sansBareme = bulletin('x', s, 2026, 4);
    delete sansBareme.computed.bareme;
    expect(await refus(sansBareme)).toBe('Le bulletin de Sonia Trabelsi (04/2026) n\'a pas gardé le barème qui l\'a calculé : ouvre-le et enregistre-le à nouveau. Rien n\'a été enregistré.');
    expect(await refus(bulletin('x', s, 2026, 4, { deductions: [{ label: 'Avance', amount: 5000 }] }))).toMatch(/^Le bulletin de Sonia Trabelsi \(04\/2026\) aurait un net négatif/);
    expect(await refus(bulletin('x', s, 2026, 4, { absentDays: 26 }))).toMatch(/^Le bulletin de Sonia Trabelsi \(04\/2026\) a un salaire brut nul/);
    expect(await refus(bulletin('x', s, 2026, 4, {}, ecran.baremesPaie({ cnssEmployee: 9.18345 })))).toMatch(/^Le barème du bulletin de Sonia Trabelsi \(04\/2026\) est illisible/);
    expect(await refus(bulletin('x', salarie('s1', { children: 2.5 }), 2026, 4))).toMatch(/compte des enfants à charge qui ne sont pas un nombre entier/);
    expect(await refus(bulletin('x', salarie('s9'), 2026, 4))).toBe('Un bulletin de 04/2026 nomme un salarié qui n\'existe plus : rien n\'a été enregistré.');
    expect(await refus(bulletin('x', s, 2026, 4, {}, REGLAGES, { paidDate: '2026-02-30' }))).toBe('La date de paiement du bulletin de Sonia Trabelsi (04/2026) n\'est pas une date valable : rien n\'a été enregistré.');
    expect(await refus(bulletin('x', s, 2026, 13))).toBe('Un bulletin de Sonia Trabelsi n\'a pas de mois valable : rien n\'a été enregistré.');
    // Un salarié illisible se refuse aussi, avant ses bulletins.
    expect((await e.envoyer('employees', [['s2', salarie('s2', { name: 'Karim', children: -1 })]])).corps.motif).toBe('Le nombre d\'enfants à charge de Karim doit être un nombre entier entre 0 et 99 : rien n\'a été enregistré.');
    expect((await admin.query('select count(*)::int n from paie.bulletin where entreprise = $1', [e.ent])).rows[0].n).toBe(0);
    expect((await admin.query(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'payslips'`, [e.ent])).rows[0].n).toBe(0);
  });

  it('modifier, supprimer, chacun avec sa trace ; un bulletin seulement déplacé ne se recalcule pas ; le salarié garde sa fiche', async () => {
    const e = await essai();
    const s = salarie('s1');
    await e.envoyer('employees', [['s1', s]]);
    const b1 = bulletin('b1', s, 2026, 5), b2 = bulletin('b2', s, 2026, 6);
    await e.envoyer('payslips', [['b1', b1], ['b2', b2]]);
    // Un bulletin ajouté avant les autres : ils reviennent dans l'envoi, déplacés, sans avoir changé.
    const b0 = bulletin('b0', s, 2026, 4);
    expect((await e.envoyer('payslips', [['b0', b0], ['b1', b1], ['b2', b2]])).statut).toBe(200);
    expect(await e.trace()).toEqual(['paie.salarie.enregistrer', 'paie.bulletin.etablir', 'paie.bulletin.etablir', 'paie.bulletin.etablir']);
    // Une prime ajoutée : le bulletin se recalcule, sa trace dit ce qu'il était.
    const avecPrime = bulletin('b1', s, 2026, 5, { bonuses: [{ label: 'Prime de fin de mois', amount: 99.999, taxable: false }] });
    await e.envoyer('payslips', [['b1', avecPrime]], 1);
    // Une prime non imposable passe telle quelle au net : ni CNSS, ni impôt.
    expect(entier(avecPrime.computed.net as number, 3)).toBe((entier(b1.computed.net as number, 3) ?? 0n) + 99_999n);
    expect(await e.lire('b1')).toMatchObject({ montants: { primesNonImposables: '99.999', net: Number(avecPrime.computed.net).toFixed(3) }, saisie: { primes: [{ libelle: 'Prime de fin de mois', montant: '99.999', imposable: false }] } });
    const modif = (await admin.query(`select avant, apres from socle.audit where entreprise = $1 and geste = 'paie.bulletin.modifier'`, [e.ent])).rows[0];
    expect([modif.avant.net, modif.apres.net]).toEqual([String(entier(b1.computed.net as number, 3)), String(entier(avecPrime.computed.net as number, 3))]);
    // Retiré : il disparaît du serveur, avec sa trace.
    await e.envoyer('payslips', [['b2', null]]);
    expect(await e.idDe('b2')).toBe('');
    // Le RIB du salarié change : sa fiche au serveur ne le garde pas, elle ne bouge pas. Ses enfants
    // changent : elle suit, avec sa trace. Retiré du dossier, il garde sa fiche.
    await e.envoyer('employees', [['s1', { ...s, iban: 'TN59 0000' }]]);
    await e.envoyer('employees', [['s1', { ...s, children: 3 }]]);
    expect((await admin.query('select enfants from paie.salarie where entreprise = $1', [e.ent])).rows[0].enfants).toBe(3);
    expect(await e.trace()).toEqual(['paie.salarie.enregistrer', 'paie.bulletin.etablir', 'paie.bulletin.etablir', 'paie.bulletin.etablir', 'paie.bulletin.modifier', 'paie.bulletin.supprimer', 'paie.salarie.modifier']);
    // Le bulletin de mai garde la situation du mois où il a été calculé.
    expect(await e.lire('b1')).toMatchObject({ situation: { enfants: 2 } });
  });

  it('la paie ne se lit qu\'avec son geste, chaque lecture se trace ; la base la cache aux autres rôles ; la masse salariale se lit sans un nom', async () => {
    const e = await essai();
    // Deux salariés, trois mois : deux bulletins par mois (une page peut s'arrêter au milieu d'un mois).
    const s1 = salarie('s1'), s2 = salarie('s2', { name: 'Karim Jlassi', grossSalary: 987.654, headOfFamily: false, children: 0 });
    await e.envoyer('employees', [['s1', s1], ['s2', s2]]);
    const bulletins = [1, 2, 3].flatMap((mois) => [bulletin(`a${mois}`, s1, 2026, mois), bulletin(`b${mois}`, s2, 2026, mois)]);
    await e.envoyer('payslips', bulletins.map((b) => [b.id, b]));
    // La liste, page après page, du mois le plus récent au plus ancien : aucun sauté, aucun vu deux fois.
    const vus: { id: string; mois: number; net: string }[] = [];
    let suite: string | null = null;
    do {
      const r = await appeler('GET', `/entreprises/${e.ent}/paie/bulletins?annee=2026&limite=3${suite ? `&avant=${suite}` : ''}`, e.jeton);
      vus.push(...(r.corps.lignes as { id: string; mois: number; net: string }[]));
      expect(r.corps.total).toBe(6);
      suite = r.corps.suite as string | null;
    } while (suite);
    expect(vus.map((l) => l.mois)).toEqual([3, 3, 2, 2, 1, 1]);
    expect(new Set(vus.map((l) => l.id)).size).toBe(6);
    // Lire un bulletin se trace, avec le bulletin lu (03 D10) ; lire la liste aussi.
    await appeler('GET', `/entreprises/${e.ent}/paie/bulletins/${vus[0]?.id}`, e.jeton);
    const lecture = (await admin.query(`select objet_type, objet_id from socle.audit where entreprise = $1 and lecture and objet_id is not null`, [e.ent])).rows;
    expect(lecture).toEqual([{ objet_type: 'bulletin', objet_id: vus[0]?.id }]);
    expect((await admin.query(`select count(*)::int n from socle.audit where entreprise = $1 and lecture and geste = 'paie.bulletins.voir'`, [e.ent])).rows[0].n).toBe(4);

    // La comptabilité interne tient les livres sans lire un salaire ; le commercial ne voit rien.
    const compta = await e.inviter('comptabilite_interne');
    const commercial = await e.inviter('commercial');
    expect((await appeler('GET', `/entreprises/${e.ent}/paie/bulletins`, compta.jeton)).statut).toBe(403);
    expect((await appeler('GET', `/entreprises/${e.ent}/paie/cnss?annee=2026&trimestre=1`, compta.jeton)).statut).toBe(403);
    const masse = await appeler('GET', `/entreprises/${e.ent}/paie/masse?du=2026-01-01&au=2026-03-31`, compta.jeton);
    expect(masse.statut).toBe(200);
    const somme = (k: string, l = bulletins) => (l.reduce((a, b) => a + Math.round(Number(b.computed[k]) * 1000), 0) / 1000).toFixed(3);
    expect(masse.corps).toEqual({
      du: '2026-01-01', au: '2026-03-31', bulletins: 6,
      brut: somme('gross'), net: somme('net'), chargesPatronales: somme('employerCharges'), coutEmployeur: somme('employerCost'),
    });
    expect(JSON.stringify(masse.corps)).not.toMatch(/Sonia|Karim/);
    // Un bulletin compte au dernier jour de son mois, comme dans la v10 : jusqu'au 30 mars, mars n'y est pas.
    const avantFin = (await appeler('GET', `/entreprises/${e.ent}/paie/masse?du=2026-01-01&au=2026-03-30`, compta.jeton)).corps;
    expect(avantFin).toMatchObject({ bulletins: 4, coutEmployeur: core.payrollCost({ payslips: bulletins }, { from: '2026-01-01', to: '2026-03-30' }).toFixed(3) });
    // Refusée par la porte (celle qui dit qui peut la voir), pas seulement par la base.
    const refusee = await appeler('GET', `/entreprises/${e.ent}/paie/masse?du=2026-01-01&au=2026-03-31`, commercial.jeton);
    expect(refusee.statut).toBe(403);
    expect(refusee.corps.qui).toEqual(expect.arrayContaining([expect.objectContaining({ roles: expect.arrayContaining(['proprietaire']) })]));
    expect((await appeler('GET', `/entreprises/${e.ent}/paie/masse?du=2026-03-31&au=2026-01-01`, e.jeton)).statut).toBe(400);
    // La base elle-même : la comptabilité interne n'y voit aucun bulletin ni aucun salarié, même par
    // une requête directe ; la masse salariale par sa fonction, oui ; le commercial, pas même elle.
    const voit = (u: string) => enTantQue(pool, u, async (tx) => ({
      bulletins: (await requetes(tx).selectFrom('paie.bulletin').select('id').execute()).length,
      salaries: (await requetes(tx).selectFrom('paie.salarie').select('id').execute()).length,
    }));
    expect(await voit(compta.utilisateur)).toEqual({ bulletins: 0, salaries: 0 });
    const proprietaire = String((await admin.query(`select utilisateur from socle.membre where entreprise = $1 and 'proprietaire' = any(roles)`, [e.ent])).rows[0].utilisateur);
    expect(await voit(proprietaire)).toEqual({ bulletins: 6, salaries: 2 });
    await expect(enTantQue(pool, commercial.utilisateur, (tx) => tx.query(`select * from paie.masse_salariale($1, '2026-01-01', '2026-12-31')`, [e.ent])))
      .rejects.toThrow(/ton rôle ne permet pas de voir la masse salariale/);
    // Le rôle Paie, lui, fait la paie.
    const paie = await e.inviter('paie');
    expect((await appeler('GET', `/entreprises/${e.ent}/paie/bulletins`, paie.jeton)).corps.total).toBe(6);
    expect(await voit(paie.utilisateur)).toEqual({ bulletins: 6, salaries: 2 });
  });

  it('la base refuse elle-même un bulletin d\'un salarié d\'une autre entreprise, qui change de salarié, ou dont les montants ne se tiennent pas', async () => {
    const e = await essai();
    const autre = await essai();
    await e.envoyer('employees', [['s1', salarie('s1')], ['s2', salarie('s2', { name: 'Karim Jlassi' })]]);
    await autre.envoyer('employees', [['s1', salarie('s1')]]);
    await e.envoyer('payslips', [['b1', bulletin('b1', salarie('s1'), 2026, 7)]]);
    const salarieDe = async (x: typeof e, ref: string) => (await admin.query('select id from paie.salarie where entreprise = $1 and ref_v10 = $2', [x.ent, ref])).rows[0].id;
    const id = await e.idDe('b1');
    await expect(admin.query('update paie.bulletin set salarie = $1 where id = $2', [await salarieDe(autre, 's1'), id])).rejects.toThrow(/un bulletin ne change pas de salarié/);
    await expect(admin.query('update paie.bulletin set salarie = $1 where id = $2', [await salarieDe(e, 's2'), id])).rejects.toThrow(/un bulletin ne change pas de salarié/);
    const proprietaire = (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur;
    await expect(admin.query(`insert into paie.bulletin (entreprise, salarie, annee, mois, brut_de_base, jours_ouvrables, chef_de_famille, enfants, bareme,
      retenue_absence, primes_imposables, primes_non_imposables, brut, assiette_cnss, cnss_salarie, frais_pro, deductions_famille, imposable_annuel,
      irpp_annuel, irpp, css, autres_retenues, net, cnss_employeur, accident_travail, tfp, foprolos, charges_patronales, cout_employeur, cree_par)
      select $1, $2, 2026, 8, 1000000, 26000, false, 0, '{}', 0, 0, 0, 1000000, 1000000, 91800, 0, 0, 0, 0, 0, 0, 0, 908200, 0, 0, 0, 0, 0, 1000000, $3`,
    [e.ent, await salarieDe(autre, 's1'), proprietaire])).rejects.toThrow(/un bulletin appartient à l'entreprise de son salarié/);
    // Un net qui ne dit pas ce que le brut moins les retenues donne, un coût qui oublie une charge.
    await expect(admin.query('update paie.bulletin set net = net + 1 where id = $1', [id])).rejects.toThrow(/bulletin_check/);
    await expect(admin.query('update paie.bulletin set tfp = tfp + 1 where id = $1', [id])).rejects.toThrow(/bulletin_check/);
    await expect(admin.query('update paie.bulletin set tfp = tfp + 1, charges_patronales = charges_patronales + 1 where id = $1', [id])).rejects.toThrow(/bulletin_check/);
    await expect(admin.query(`update paie.bulletin set bareme = '{"cnssSalarie": 9.18}' where id = $1`, [id])).rejects.toThrow(/bulletin_bareme_check/);
  });
});
