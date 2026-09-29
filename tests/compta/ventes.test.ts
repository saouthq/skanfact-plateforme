// Les écritures des ventes tenues par le serveur (brique 32 ; docs/ecritures.md). Deux chemins, un
// chiffre : les factures, avoirs et encaissements de l'exemple de cinq ans de la v10 sont émis et
// réglés par le serveur ; chaque écriture qu'il TIENT (dans sa base) est celle que la v10 CALCULE
// (`journalEntries`), ligne par ligne : même journal, même date, même compte, même millime, dans le
// même ordre. Puis la TVA collectée de chaque mois, les timbres et les retenues subies, lus dans les
// écritures du serveur, sont ceux de la déclaration de la v10.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { declarationTva, finDeMois, type EcritureDatee } from '../../moteur/declarations.ts';
import { PLAN_PAR_DEFAUT } from '../../moteur/comptes.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { ecrireFamilleDeVente } from '../../serveur/compta/ventes.ts';
import { REGLEMENTS_VENTES, tenirReglements } from '../../serveur/reglements.ts';
import { lirePaiements } from '../../serveur/v10/lecture.ts';
import { creerBrouillon, emettre, type BrouillonSaisi } from '../../serveur/ventes/pieces.ts';
import { demo, entier, exiger, v10, type Societe } from '../moteur/v10.ts';

type LigneV10 = { label?: string; qty?: number; unitPrice?: number; vatRate?: number; noDiscount?: boolean };
type PaiementV10 = { id: string; date: string; amount: number; method?: string; accountId?: string; exchangeRate?: number };
type DocV10 = {
  id: string; type: string; number?: string; status?: string; date: string; clientId?: string; currency?: string; exchangeRate?: number | string;
  lines: LigneV10[]; discountRate?: number; withholdingRate?: number; applyStamp?: boolean; creditOf?: string; payments?: PaiementV10[];
};
type LigneJournal = { date: string; journal: string; source: string; docId: string; account: string; debit: number; credit: number };
type MoisV10 = { month: string; collected: number; stamps: number; withheldBySale: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneJournal[];
  vatChain: (data: unknown, c: Societe, annee: string, jusqua: number) => MoisV10[];
  DEFAULT_ACCOUNTS: Record<string, string>;
};

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as {
  company: Societe; documents: DocV10[]; clients: { id: string; name: string }[]; accounts: { id: string }[];
};
// Ce que la v10 écrit : les factures et avoirs émis (numérotés, pas en brouillon).
const emises = donnees.documents.filter((d) => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.number)
  .sort((a, b) => a.date.localeCompare(b.date));
const texte = (x: number | string | undefined, dec: number) => (Number(x) || 0).toFixed(dec).replace(/\.?0+$/, '') || '0';
// Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);

let proprio = '';
let ent = '';
const clients = new Map<string, string>();
const pieces = new Map<string, string>();      // identifiant v10 → pièce du serveur

beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('compta-ventes@exemple.tn', 'Compta') returning id`)).rows[0].id;
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Exemple v10') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Exemple de cinq ans') returning id`, [org])).rows[0].id;
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, ent]);
  await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'timbre.facture', '1000', '2000-01-01', 'Timbre de l''exemple v10', $2)`, [ent, proprio]);
  await enTantQue(pool, proprio, async (tx) => {
    await tx.query(`select socle.creer_serie($1, 'facture', 'FAC', true, null, null)`, [ent]);
    await tx.query(`select socle.creer_serie($1, 'avoir', 'AVO', true, null, null)`, [ent]);
  });
  // Les comptes de trésorerie de l'exemple (un compte bancaire par défaut, une caisse) : ils
  // décident du journal de chaque encaissement, comme dans la v10.
  for (const [rang, a] of donnees.accounts.entries()) {
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu, modifie_par) values ($1, 'accounts', $2, $3, $4, $5)`, [ent, a.id, rang, JSON.stringify(encoder(a)), proprio]);
  }
  for (const c of donnees.clients) {
    clients.set(c.id, (await admin.query(`insert into socle.tiers (entreprise, raison_sociale, ref_v10) values ($1, $2, $3) returning id`, [ent, c.name, c.id])).rows[0].id);
  }
  // Les factures, puis les avoirs (rattachés à leur facture), émis par le serveur ; puis les règlements.
  const brouillon = (d: DocV10): BrouillonSaisi => {
    const devise = d.currency && d.currency !== 'DT' ? d.currency : 'TND';
    return {
      type: d.type as 'facture' | 'avoir', tiers: clients.get(d.clientId ?? '') ?? '', datePiece: d.date,
      ...(devise === 'TND' ? {} : { devise, cours: texte(d.exchangeRate, 6) }),
      tauxRemise: texte(d.discountRate, 4), tauxRetenue: texte(d.withholdingRate, 4),
      ...(d.applyStamp === undefined ? {} : { appliquerTimbre: d.applyStamp }),
      ...(d.type === 'avoir' && d.creditOf ? { corrige: pieces.get(d.creditOf) ?? '' } : {}),
      lignes: d.lines.map((l) => ({
        designation: l.label || 'Ligne', quantite: texte(l.qty, 3), prixUnitaire: texte(l.unitPrice, 6), tauxTva: texte(l.vatRate, 4),
        ...(l.noDiscount ? { sansRemise: true } : {}),
      })),
    };
  };
  for (const d of [...emises.filter((x) => x.type === 'facture'), ...emises.filter((x) => x.type === 'avoir')]) {
    pieces.set(d.id, await enTantQue(pool, proprio, async (tx) => {
      const id = await creerBrouillon(tx, proprio, ent, brouillon(d));
      await emettre(tx, proprio, ent, id);
      return id;
    }));
  }
  for (const d of emises.filter((x) => x.type === 'facture' && (x.payments ?? []).length)) {
    const id = pieces.get(d.id) ?? '';
    await enTantQue(pool, proprio, async (tx) => {
      const devise = d.currency && d.currency !== 'DT' ? d.currency : 'TND';
      await tenirReglements(tx, REGLEMENTS_VENTES, ent, proprio, id, lirePaiements(encoder(d.payments), d.number ?? '', devise === 'TND' ? 3 : 2, devise));
      await ecrireFamilleDeVente(tx, ent, id);
    });
  }
}, 240_000);
afterAll(async () => { await admin.end(); await pool.end(); });

// Les écritures du serveur, lignes comprises, dans l'ordre de leur famille.
async function ecrituresDuServeur() {
  return (await admin.query(`select e.id, e.origine_type, e.origine, e.famille, e.journal, e.date_ecriture::text date, e.rang,
      json_agg(json_build_object('compte', l.compte, 'debit', l.debit::text, 'credit', l.credit::text) order by l.rang) lignes
    from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1
    group by e.id order by e.famille, e.rang`, [ent])).rows as { id: string; origine_type: string; origine: string; famille: string; journal: string; date: string; rang: number; lignes: { compte: string; debit: string; credit: string }[] }[];
}
const enLigne = (date: string, journal: string, compte: string, debit: bigint, credit: bigint) => `${date} ${journal} ${compte} ${debit} ${credit}`;

describe('les écritures des ventes, tenues par le serveur, contre la v10', () => {
  it('le plan comptable par défaut est celui de la v10, rôle pour rôle', () => {
    expect({ ...PLAN_PAR_DEFAUT }).toEqual(core.DEFAULT_ACCOUNTS);
  });

  it('chaque facture, chaque avoir et chaque encaissement de l\'exemple s\'écrit au serveur comme la v10 l\'écrit : journal, date, compte, millime, ordre', async () => {
    expect(emises.filter((d) => d.type === 'facture').length).toBeGreaterThan(250);
    expect(emises.filter((d) => d.type === 'avoir').length).toBeGreaterThan(3);
    const v10Lignes = core.journalEntries(donnees, donnees.company, {}, { sections: ['ventes', 'encaissements'] });
    const serveur = await ecrituresDuServeur();
    const faux: string[] = [];
    let encaissements = 0, enDevise = 0, avecRetenue = 0;
    for (const d of emises) {
      const id = pieces.get(d.id) ?? '';
      // La pièce elle-même (journal des ventes).
      const attendue = v10Lignes.filter((l) => l.docId === d.id && l.source === 'vente')
        .map((l) => enLigne(l.date, l.journal, l.account, entier(l.debit, 3) ?? -1n, entier(l.credit, 3) ?? -1n));
      const tenue = serveur.filter((e) => e.origine === id).flatMap((e) => e.lignes.map((l) => enLigne(e.date, e.journal, l.compte, BigInt(l.debit), BigInt(l.credit))));
      if (JSON.stringify(attendue) !== JSON.stringify(tenue)) faux.push(`${d.number} : v10 [${attendue.join(' | ')}] ; serveur [${tenue.join(' | ')}]`);
      if (d.currency && d.currency !== 'DT') enDevise++;
      if (d.type !== 'facture') continue;
      // Ses encaissements, dans l'ordre des dates.
      const attendus = v10Lignes.filter((l) => l.docId === d.id && l.source === 'encaissement')
        .map((l) => enLigne(l.date, l.journal, l.account, entier(l.debit, 3) ?? -1n, entier(l.credit, 3) ?? -1n));
      const tenus = serveur.filter((e) => e.famille === id && e.origine_type === 'encaissement')
        .flatMap((e) => e.lignes.map((l) => enLigne(e.date, e.journal, l.compte, BigInt(l.debit), BigInt(l.credit))));
      if (JSON.stringify(attendus) !== JSON.stringify(tenus)) faux.push(`${d.number} encaissements : v10 [${attendus.join(' | ')}] ; serveur [${tenus.join(' | ')}]`);
      encaissements += serveur.filter((e) => e.famille === id && e.origine_type === 'encaissement').length;
      if (tenus.some((l) => l.includes(` ${PLAN_PAR_DEFAUT.rsSubie} `))) avecRetenue++;
    }
    expect(faux.slice(0, 5)).toEqual([]);
    // Le banc a mesuré quelque chose : tous les encaissements, des pièces en devise, des retenues.
    expect(encaissements).toBe(emises.filter((d) => d.type === 'facture').reduce((s, d) => s + (d.payments ?? []).length, 0));
    expect(encaissements).toBeGreaterThan(200);
    expect(enDevise).toBeGreaterThanOrEqual(1);   // l'exemple a une facture en euros (les devises ont leur banc au moteur)
    expect(avecRetenue).toBeGreaterThan(5);
    // Chaque écriture est équilibrée, et la balance aussi.
    const balance = (await admin.query('select sum(debit)::text d, sum(credit)::text c from compta.ligne where entreprise = $1', [ent])).rows[0];
    expect(balance.d).toBe(balance.c);
  });

  it('la TVA collectée de chaque mois, les timbres et les retenues subies, lus dans les écritures du serveur, sont ceux que la v10 déclare', async () => {
    const serveur = await ecrituresDuServeur();
    const journal: EcritureDatee[] = serveur.map((e) => ({ date: e.date, lignes: e.lignes.map((l) => ({ compte: l.compte, debit: BigInt(l.debit), credit: BigInt(l.credit) })) }));
    const P = PLAN_PAR_DEFAUT;
    const comptes = { tvaCollectee: P.tvaCollectee, tvaDeductible: P.tvaDeductible, timbre: P.timbre, retenueSubie: P.rsSubie, retenueOperee: P.rsOperee };
    const annees = [...new Set(emises.map((d) => d.date.slice(0, 4)))].sort();
    const faux: string[] = [];
    let mois = 0;
    for (const a of annees) {
      const v = core.vatChain(donnees, donnees.company, a, 12);
      for (let m = 1; m <= 12; m++) {
        const du = `${a}-${String(m).padStart(2, '0')}-01`, au = finDeMois(Number(a), m);
        const n = declarationTva(journal, du, au, comptes, 0n);
        const x = v[m - 1] as MoisV10;
        const paires: [string, number, bigint][] = [['collectée', x.collected, n.collectee], ['timbres', x.stamps, n.timbres], ['retenues subies', x.withheldBySale, n.retenuesSubies]];
        for (const [nom, attendu, lu] of paires) if (entier(attendu, 3) !== lu) faux.push(`${a}-${m} ${nom} : v10 ${attendu}, serveur ${lu}`);
        if (n.collectee) mois++;
      }
    }
    expect(faux).toEqual([]);
    expect(mois).toBeGreaterThan(40);
  });
});
