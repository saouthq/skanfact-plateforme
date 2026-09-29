// Le jalon J1 (cadrage 09) : « sur le serveur, une facture est créée, calculée et émise (sans TTN),
// au même millime que la v10 sur l'exemple de cinq ans ». Ici : TOUTES les factures de l'exemple de
// la v10 (figée dans banc/v10) sont saisies en brouillon, émises par le serveur, puis relues dans la
// base ; chaque montant émis doit être celui de la v10. Puis la chaîne de la série se contrôle en
// relisant chaque facture. Enfin, l'entreprise est exportée puis restaurée dans une base vide.

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { controler } from '../../serveur/journal.ts';
import { exporter, restaurer } from '../../base/entreprise.ts';
import { baseNeuve } from '../base-neuve.ts';
import { creerBrouillon, emettre, relirePourChaine, type BrouillonSaisi } from '../../serveur/ventes/pieces.ts';

type LigneV10 = { label?: string; qty?: number; unitPrice?: number; vatRate?: number; noDiscount?: boolean };
type DocV10 = {
  id: string; type: string; number?: string; date: string; clientId?: string; currency?: string; exchangeRate?: number | string;
  lines: LigneV10[]; discountRate?: number; withholdingRate?: number; applyStamp?: boolean; stampFee?: number;
};
type Totaux = { totalHT: number; discount: number; netHT: number; totalVAT: number; stamp: number; stampBase: number; totalTTC: number; withholding: number; netToPay: number };
type Societe = { currency: string; stampFee: number };
const exiger = createRequire(import.meta.url);
const v10 = exiger('../../banc/v10/core.js') as { computeTotals: (d: DocV10, c: Societe) => Totaux; DEFAULT_COMPANY: Societe };
const demo = exiger('../../banc/v10/demo.js') as { buildDemoData: (c: Societe, jour: string) => { company: Societe; documents: DocV10[]; clients: { id: string; name: string }[] } };

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28');
const factures = donnees.documents.filter((d) => d.type === 'facture').sort((a, b) => a.date.localeCompare(b.date));
// Un nombre de la v10 en texte exact, à `dec` décimales (comme un humain l'aurait saisi).
const texte = (x: number | string | undefined, dec: number) => (Number(x) || 0).toFixed(dec).replace(/\.?0+$/, '') || '0';

let proprio = '';
let ent = '';
let serie = '';
const clients = new Map<string, string>();

beforeAll(async () => {
  await admin.connect();
  proprio = (await admin.query(`insert into socle.utilisateur (email, nom) values ('j1@exemple.tn', 'J1') returning id`)).rows[0].id;
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Exemple v10') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Exemple de cinq ans') returning id`, [org])).rows[0].id;
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [proprio, ent]);
  // Le timbre de l'exemple (1 DT), posé comme une règle de l'entreprise pour tout l'historique.
  await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'timbre.facture', '1000', '2000-01-01', 'Timbre de l''exemple v10', $2)`, [ent, proprio]);
  serie = (await enTantQue(pool, proprio, (tx) => tx.query(`select socle.creer_serie($1, 'facture', 'FAC', true, null, null) id`, [ent]))).rows[0].id;
  for (const c of donnees.clients) {
    clients.set(c.id, (await admin.query(`insert into socle.tiers (entreprise, raison_sociale) values ($1, $2) returning id`, [ent, c.name])).rows[0].id);
  }
});
afterAll(async () => { await admin.end(); await pool.end(); });

describe('le jalon J1 : les factures de l\'exemple de cinq ans, émises par le serveur', () => {
  it('chaque facture émise porte, au millime, les montants de la v10', async () => {
    expect(factures.length).toBeGreaterThan(250);
    const ecarts: string[] = [];
    for (const d of factures) {
      const devise = d.currency && d.currency !== 'DT' ? d.currency : 'TND';
      const b: BrouillonSaisi = {
        type: 'facture', tiers: clients.get(d.clientId ?? '') ?? '', datePiece: d.date,
        ...(devise === 'TND' ? {} : { devise, cours: texte(d.exchangeRate, 6) }),
        tauxRemise: texte(d.discountRate, 4), tauxRetenue: texte(d.withholdingRate, 4),
        ...(d.applyStamp === undefined ? {} : { appliquerTimbre: d.applyStamp }),
        lignes: d.lines.map((l) => ({
          designation: l.label || 'Ligne', quantite: texte(l.qty, 3), prixUnitaire: texte(l.unitPrice, 6), tauxTva: texte(l.vatRate, 4),
          ...(l.noDiscount ? { sansRemise: true } : {}),
        })),
      };
      const id = await enTantQue(pool, proprio, async (tx) => {
        const piece = await creerBrouillon(tx, proprio, ent, b);
        await emettre(tx, proprio, ent, piece);
        return piece;
      });
      const emise = (await admin.query('select * from ventes.piece where id = $1', [id])).rows[0];
      const a = v10.computeTotals(d, donnees.company);
      const s = devise === 'TND' ? 1000 : 100;
      const attendu: Record<string, number> = {
        total_ht: a.totalHT * s, remise: a.discount * s, net_ht: a.netHT * s, total_tva: a.totalVAT * s, timbre: a.stamp * s,
        timbre_base: a.stampBase * 1000, total_ttc: a.totalTTC * s, retenue: a.withholding * s, net_a_payer: a.netToPay * s,
      };
      for (const [champ, v] of Object.entries(attendu)) {
        if (BigInt(emise[champ]) !== BigInt(Math.round(v))) ecarts.push(`${d.number ?? d.id} ${champ} : v10 ${Math.round(v)}, serveur ${emise[champ]}`);
      }
    }
    expect(ecarts).toEqual([]);
    // Plus de 270 factures émises une à une (≈ 15 s seul) : la limite commune de 20 s tombait quand
    // toute la suite tourne à la fois (29/09/2026). Ce test vérifie des montants, pas une vitesse.
  }, 60_000);

  it('les numéros se suivent sans trou dans chaque année, et la chaîne de la série se contrôle en relisant chaque facture', async () => {
    const parAn = (await admin.query(`select extract(year from date_piece)::int an, count(*)::int n, max(numero)::int dernier
      from ventes.piece where entreprise = $1 group by 1 order by 1`, [ent])).rows;
    expect(parAn.length).toBeGreaterThanOrEqual(5);
    for (const a of parAn) expect(a.dernier).toBe(a.n);
    const r = await enTantQue(pool, proprio, (tx) => controler(tx, ent, `serie:${serie}`, (o) => relirePourChaine(tx, ent, o.id)));
    expect(r).toEqual({ ok: true });
  });

  it('l\'autre moitié de J1 : l\'entreprise de l\'exemple, exportée puis restaurée dans une base vide, garde chaque facture au millime et sa chaîne', async () => {
    const fichier = await exporter(admin, ent);
    const base = await baseNeuve('skanfact_test_j1');
    const cible = new pg.Client({ connectionString: base.admin });
    await cible.connect();
    const poolCible = creerPool(base.app);
    try {
      await restaurer(cible, fichier);
      const releve = `select count(*)::int n, string_agg(numero_texte || ' ' || net_a_payer || ' ' || total_tva || ' ' || empreinte, ',' order by numero_texte) detail
        from ventes.piece where entreprise = $1`;
      const avant = (await admin.query(releve, [ent])).rows[0];
      expect(avant.n).toBe(factures.length);
      expect((await cible.query(releve, [ent])).rows[0]).toEqual(avant);
      expect(await enTantQue(poolCible, proprio, (tx) => controler(tx, ent, `serie:${serie}`, (o) => relirePourChaine(tx, ent, o.id))))
        .toEqual({ ok: true });
    } finally {
      await cible.end();
      await poolCible.end();
      await base.jeter();
    }
  });
});
