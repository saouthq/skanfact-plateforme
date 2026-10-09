// L'exemple de la v10, versé par le serveur dans l'entreprise d'essai (retour de Skander, 05/10/2026 : « le jeu
// d'exemple ne marche pas, il me dit tu es déjà dans l'exemple mais il n'y a rien dessus » ; docs/exemple.md).
// La v10 remplaçait les données du poste par cinq ans d'une entreprise inventée (`buildDemoData`, demo.js). La
// plateforme ne met jamais une pièce inventée dans une vraie entreprise : l'exemple est l'entreprise d'essai, marquée
// pour toujours, et le serveur la remplit de CE jeu, par ses propres chemins :
//   - les factures et les avoirs, il les émet lui-même dans l'ordre de leurs dates (numérotés dans la série de
//     l'entreprise, calculés en entiers, scellés, chaînés), puis tient leurs règlements comme ceux d'une vraie facture ;
//   - le reste du dossier (clients, devis, achats, paie, trésorerie…) s'écrit comme un enregistrement de l'écran, et
//     ses suivis jouent comme pour lui (achats, paie, écritures) ;
//   - le timbre de l'exemple vaut pour ses années d'avant la règle commune : une règle de CETTE entreprise, datée ;
//   - il ne se verse qu'une fois, dans une entreprise d'essai qui n'a pas de pièces à elle ; jamais dans une vraie.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { rendre, t } from '../../textes/index.ts';
import { tracer } from '../trace.ts';
import { appliquer, emettreDepuisV10, lireDossier, type Changement } from './dossier.ts';
import type { Json } from './lecture.ts';
import './textes.ts';

// Le jeu d'exemple est le code de la v10 que servent les écrans (web/public/v10), chargé une fois : le même exemple
// qu'à l'écran, au même jour, aux mêmes montants (un tirage fixe : demo.js).
type Demo = { buildDemoData: (societe: unknown, jour: string) => Record<string, unknown> };
let demo: Demo | null = null;
function jeuDExemple(): Demo {
  if (demo) return demo;
  const executer = (fichier: string, exiger: (nom: string) => unknown) => {
    const module = { exports: {} as unknown };
    const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10', fichier), 'utf8');
    (vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: fichier }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, exiger);
    return module.exports;
  };
  const compta = executer('compta.js', () => ({}));
  const core = executer('core.js', (nom) => (nom.includes('compta') ? compta : {}));
  demo = executer('demo.js', (nom) => (nom.includes('core') ? core : {})) as Demo;
  return demo;
}

// Les nombres comme l'écran les envoie (web/public/plateforme/pont.js, `encoder`) : un entier tel quel, un nombre à
// virgule en texte exact ({ "~n": "450.5" }) — jamais de nombre à virgule en base.
const encoder = (v: unknown): unknown => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number.isFinite(v) ? { '~n': String(v) } : null;
  if (Array.isArray(v)) return v.map(encoder);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && typeof x !== 'function').map(([k, x]) => [k, encoder(x)]));
  return v;
};
const decoder = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(decoder);
  if (v && typeof v === 'object') {
    const cles = Object.keys(v);
    if (cles.length === 1 && cles[0] === '~n') return Number((v as Record<string, string>)['~n']);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]));
  }
  return v;
};
// Une partie du dossier est une liste d'objets à identifiant (une « collection »), sinon un champ de la racine : la
// règle du point de contact (`decouper`).
const COLLECTION = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
const listeAIdentifiants = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.length > 0
  && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 200) && new Set(v.map((x) => x.id)).size === v.length;

// Ce qui fait d'une entreprise d'essai une entreprise déjà essayée : des pièces à elle. L'exemple ne s'y mélange pas (ses
// numéros suivraient les siens, et ses relances parleraient de ses clients).
const PIECES = ['documents', 'purchases', 'payslips', 'supplierOrders', 'receptions'];
// Les questions du cabinet vivent dans les livres, au serveur (brique 44 bis) : jamais dans le dossier.
const HORS_DOSSIER = ['questionsCabinet'];
// L'ordre d'écriture : ce que les pièces nomment d'abord, puis les ventes (les factures émises une à une), les achats,
// la paie, et à la fin ce qui les suppose (la trésorerie, les clôtures, la marque de l'exemple).
const ACHATS = ['purchases'];
const PAIE = ['payslips', 'leaves', 'advances', 'socialFilings'];
const FIN = ['movements', 'ecrituresOD', 'closureLog', 'closedUntil', 'counters', 'demo', 'exemple'];

export async function verserExemple(tx: Transaction, entreprise: string, utilisateur: string, jour: string): Promise<{ deja: boolean; pieces: number }> {
  const e = (await tx.query('select essai from socle.entreprise where id = $1', [entreprise])).rows[0] as { essai: boolean } | undefined;
  if (!e?.essai) throw new Refus('exemple.vraie_entreprise');
  // Un versement à la fois par entreprise : la même demande refaite (une réponse coupée par un relais, redemandée par
  // « On prépare l'exemple ») attend la fin du premier, puis le trouve fait. Le verrou des objets du dossier ne suffisait
  // pas : une entreprise d'essai neuve n'en a encore aucun, et la seconde demande versait par-dessus la première
  // (« Une erreur est survenue de notre côté », vu en ligne le 09/10/2026).
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`exemple:${entreprise}`]);
  // Le dossier se lit verrouillé : un enregistrement de la page parti au même moment (ses réglages de départ, à
  // l'ouverture) attend la fin du versement, au lieu de le faire échouer sur un conflit (vu à la souris le 05/10/2026).
  await tx.query('select 1 from socle.dossier_v10 where entreprise = $1 for update', [entreprise]);
  const objets = await lireDossier(tx, entreprise, utilisateur);
  if (objets.some((o) => o.collection === '_racine' && o.cle === 'demo' && o.contenu === true)) return { deja: true, pieces: 0 };
  if (objets.some((o) => PIECES.includes(o.collection))) throw new Refus('exemple.essai_deja_utilisee');

  const revision = new Map(objets.map((o) => [`${o.collection}/${o.cle}`, o.revision]));
  const rangs = new Map<string, number>();
  for (const o of objets) if (o.collection !== '_racine') rangs.set(o.collection, Math.max(rangs.get(o.collection) ?? -1, o.rang ?? -1));
  const rangSuivant = (collection: string) => { const r = (rangs.get(collection) ?? -1) + 1; rangs.set(collection, r); return r; };
  // L'exemple garde ce que l'entreprise a déjà (son nom) et emprunte le reste (demo.js) : la fiche lue ici.
  const societe = decoder(objets.find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu ?? {});
  const d = jeuDExemple().buildDemoData(societe, jour);

  const parties: Record<'base' | 'ventes' | 'achats' | 'paie' | 'fin', Changement[]> = { base: [], ventes: [], achats: [], paie: [], fin: [] };
  const ecrire = (partie: keyof typeof parties, collection: string, cle: string, contenu: unknown) => {
    parties[partie].push({ collection, cle, rang: collection === '_racine' ? null : rangSuivant(collection), revision: revision.get(`${collection}/${cle}`) ?? null, contenu: encoder(contenu) });
  };
  const legales: Record<string, unknown>[] = [];
  for (const [champ, v] of Object.entries(d)) {
    if (v === undefined || typeof v === 'function' || HORS_DOSSIER.includes(champ)) continue;
    const partie = FIN.includes(champ) ? 'fin' : PAIE.includes(champ) ? 'paie' : ACHATS.includes(champ) ? 'achats' : champ === 'documents' ? 'ventes' : 'base';
    if (COLLECTION.test(champ) && listeAIdentifiants(v)) {
      // Une liste restée vide à la racine (`_racine/accounts` = []) s'en va : la liste vit maintenant dans sa collection.
      if (revision.has(`_racine/${champ}`)) parties.base.push({ collection: '_racine', cle: champ, rang: null, revision: revision.get(`_racine/${champ}`) ?? null, contenu: null });
      for (const x of v) {
        const o = x as Record<string, unknown>;
        // Une facture ou un avoir émis ne s'écrit pas : le serveur l'émet (plus bas). Un brouillon, si.
        if (champ === 'documents' && (o.type === 'facture' || o.type === 'avoir') && o.status !== 'brouillon') { legales.push(o); continue; }
        ecrire(partie, champ, o.id as string, o);
      }
    } else ecrire(partie, '_racine', champ, v);
  }

  await appliquer(tx, entreprise, utilisateur, parties.base, { serveur: true });
  await appliquer(tx, entreprise, utilisateur, parties.ventes, { serveur: true });

  // Le timbre de l'exemple (sa fiche : 1 DT) pour ses années d'avant la règle commune, jusqu'à la veille de celle-ci.
  legales.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.type === b.type ? 0 : a.type === 'facture' ? -1 : 1));
  const premier = legales[0] ? String(legales[0].date) : null;
  const commune = (await tx.query(`select min(debut)::text debut from socle.regle_fiscale where code = 'timbre.facture'`)).rows[0]?.debut as string | null;
  const timbre = Math.round(Number((d.company as Record<string, unknown> | undefined)?.stampFee ?? 0) * 1000);
  if (premier && timbre > 0 && (!commune || premier < commune)) {
    const veille = commune ? new Date(Date.parse(`${commune}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null;
    await tx.query('select socle.poser_regle_entreprise($1, $2, $3, $4, $5, $6)', [entreprise, 'timbre.facture', JSON.stringify(timbre), premier, veille, rendre(t('exemple.motif_timbre'), 'fr')]);
  }

  // Les factures et les avoirs, émis par le serveur dans l'ordre de leurs dates (un avoir après la facture qu'il
  // corrige) ; leurs règlements ensuite, tenus comme ceux d'une vraie facture.
  const clients = new Map(((d.clients ?? []) as Record<string, unknown>[]).map((c) => [c.id, encoder(c) as Json]));
  const reglements: Changement[] = [];
  for (const doc of legales) {
    const rang = rangSuivant('documents');
    const r = await emettreDepuisV10(tx, entreprise, utilisateur, {
      document: encoder({ ...doc, payments: [] }) as Json, client: clients.get(doc.clientId as string) ?? null, revision: null, rang, netAPayer: null,
    }, doc.type === 'avoir' ? 'avoir' : 'facture');
    const paiements = Array.isArray(doc.payments) ? doc.payments : [];
    if (paiements.length) reglements.push({ collection: 'documents', cle: String(doc.id), rang, revision: r.revision, contenu: { ...r.contenu, payments: encoder(paiements) } });
  }
  await appliquer(tx, entreprise, utilisateur, reglements, { serveur: true });
  await appliquer(tx, entreprise, utilisateur, parties.achats, { serveur: true });
  await appliquer(tx, entreprise, utilisateur, parties.paie, { serveur: true });
  await appliquer(tx, entreprise, utilisateur, parties.fin, { serveur: true });

  const pieces = legales.length + parties.ventes.length + parties.achats.length;
  await tracer(tx, entreprise, 'v10.exemple.verser', { type: 'entreprise', id: entreprise }, null, { jour, pieces, emises: legales.length });
  return { deja: false, pieces };
}
