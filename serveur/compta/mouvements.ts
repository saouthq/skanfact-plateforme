// Les mouvements libres de la trésorerie, tenus par le serveur (1.79.0 ; recette du 20/10/2026 ; docs/ecritures.md,
// « Les mouvements de trésorerie »). Un salaire réglé sans la Paie, un impôt payé, des frais bancaires, un apport, un
// retrait, un virement entre deux comptes de l'entreprise, l'écart d'un Z de caisse : la v10 les écrit dans son livre
// (`journalEntries`, section « tresorerie », core.js), le serveur ne les écrivait nulle part — le Cabinet tenait une
// banque et une caisse fausses de ces montants-là. Chaque mouvement est une FAMILLE (D2) : il s'écrit, se réécrit et
// s'efface seul ; une écriture validée qu'il ne veut plus se contre-passe (0018). Les mêmes comptes que la v10 :
//   - la trésorerie du compte choisi (journal BQ ou CA), sinon du compte par défaut ;
//   - la contrepartie choisie à la main (« compte »), sinon le rôle de la nature (627 frais bancaires, 434 impôts…) ;
//     un salaire d'un mois sans bulletin (ni le mois d'avant) va au 640, sinon au 425 que le bulletin a crédité ;
//   - un virement : le compte d'arrivée est la contrepartie ; un départ supprimé laisse l'arrivée contre le 471 ; un
//     virement d'un compte vers lui-même n'écrit rien.

import { createHash } from 'node:crypto';
import type { Plan } from '../../moteur/comptes.ts';
import { requetes, type Transaction } from '../base.ts';
import { aVraimentChange, estJour, estObjet, exact, type ChangementLu } from '../v10/lecture.ts';
import { ecrireFamille, libelle, type EcritureAEcrire } from './ecrire.ts';
import { journalDeCompte, lirePlan, type PlanDuDossier } from './plan.ts';
import './textes.ts';

// Les natures de la v10 (`MOVE_KINDS` et `MOVE_ACCOUNTS`, core.js) : le sens, et le rôle du compte de contrepartie.
const NATURES: Record<string, { sens: 1 | -1; role: keyof Plan }> = {
  salaire: { sens: -1, role: 'personnel' }, impot: { sens: -1, role: 'impots' }, banque: { sens: -1, role: 'fraisBancaires' },
  retrait: { sens: -1, role: 'associes' }, emprunt: { sens: -1, role: 'emprunts' }, 'autre-sortie': { sens: -1, role: 'attente' },
  apport: { sens: 1, role: 'associes' }, pret: { sens: 1, role: 'emprunts' }, 'autre-entree': { sens: 1, role: 'attente' },
  virement: { sens: -1, role: 'attente' },
};
const nature = (kind: string) => libelle(`compta.libelle.mouvement.${NATURES[kind] ? kind : 'autre'}`, {});

function identifiant(...parties: string[]): string {
  const h = createHash('sha256').update(parties.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export const familleDuMouvement = (entreprise: string, cle: string) => identifiant(entreprise, 'mouvement', cle);

const texte = (v: unknown) => (typeof v === 'string' ? v : '');
const moisPrecedent = (mois: string) => {
  const a = Number(mois.slice(0, 4)), m = Number(mois.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

// Ce que le dossier dit en plus du plan : le nom de chaque compte de trésorerie, les mois qui ont un bulletin.
export type Contexte = { noms: Map<string, string>; moisAvecBulletin: Set<string> };
export async function lireContexte(tx: Transaction, entreprise: string): Promise<Contexte> {
  const objets = (collection: string) => requetes(tx).selectFrom('socle.dossier_v10').select(['cle', 'contenu'])
    .where('entreprise', '=', entreprise).where('collection', '=', collection).execute();
  const noms = new Map((await objets('accounts')).map((o) => [o.cle, estObjet(o.contenu) ? texte(o.contenu.name) : '']));
  const moisAvecBulletin = new Set((await objets('payslips')).filter((o) => estObjet(o.contenu))
    .map((o) => { const b = o.contenu as Record<string, unknown>; return `${b.year}-${String(b.month).padStart(2, '0')}`; }));
  return { noms, moisAvecBulletin };
}

// L'écriture d'un mouvement (aucune s'il est illisible, nul, ou un virement d'un compte vers lui-même).
export function ecrituresDuMouvement(famille: string, m: unknown, p: PlanDuDossier, ctx: Contexte): EcritureAEcrire[] {
  if (!estObjet(m) || !estJour(m.date)) return [];
  const montantSigne = exact(m.amount ?? 0, 3);
  if (montantSigne === null || montantSigne === 0n) return [];
  const montant = montantSigne < 0n ? -montantSigne : montantSigne;
  const kind = texte(m.kind), mode = texte(m.method), date = m.date as string;
  const n = NATURES[kind] ?? { sens: -1 as const, role: 'attente' as const };
  const nom = (id: string) => ctx.noms.get(id) || libelle('compta.libelle.mouvement.un_autre_compte', {});
  const piece = texte(m.reference).trim() || nature(kind);
  const ecriture = (journal: 'BQ' | 'CA', entree: string, debit: string, credit: string): EcritureAEcrire[] => [{
    journal, date, origineType: 'mouvement', origine: famille, piece, tiers: null, libelle: entree,
    lignes: [{ compte: debit, libelle: entree, debit: montant, credit: 0n, tauxTva: null }, { compte: credit, libelle: entree, debit: 0n, credit: montant, tauxTva: null }],
  }];
  // Les deux côtés d'un virement (`virementCotes`, core.js) : chacun un compte qui EXISTE, ou ''.
  let depart = '', vers = '';
  if (kind === 'virement') {
    const existe = (id: string) => id !== '' && p.tresorerie.some((a) => a.id === id);
    const defaut = p.tresorerie.find((a) => a.parDefaut) ?? p.tresorerie[0];
    vers = existe(texte(m.versAccountId)) ? texte(m.versAccountId) : '';
    depart = existe(texte(m.accountId)) ? texte(m.accountId) : '';
    if (!depart && (!texte(m.accountId) || !vers)) depart = defaut ? defaut.id : '';
    if (depart && depart === vers) return [];
    if (!depart && vers) {
      const jv = journalDeCompte(p, vers, mode);
      return ecriture(jv.journal, texte(m.label) || libelle('compta.libelle.mouvement.virement_sans_depart', { compte: nom(vers) }), jv.compte, p.plan.attente);
    }
  }
  const j = journalDeCompte(p, (kind === 'virement' ? depart : texte(m.accountId)) || null, mode);
  let role = n.role;
  if (kind === 'salaire' && !ctx.moisAvecBulletin.has(date.slice(0, 7)) && !ctx.moisAvecBulletin.has(moisPrecedent(date.slice(0, 7)))) role = 'salairesBruts';
  const contrepartie = vers ? journalDeCompte(p, vers, mode).compte : (kind !== 'virement' && texte(m.compte).trim()) || p.plan[role];
  const entree = texte(m.label) || (vers ? libelle('compta.libelle.mouvement.virement_vers', { compte: nom(vers) }) : nature(kind));
  return n.sens > 0 ? ecriture(j.journal, entree, j.compte, contrepartie) : ecriture(j.journal, entree, contrepartie, j.compte);
}

async function ecrireLeMouvement(tx: Transaction, entreprise: string, cle: string, contenu: unknown, p: PlanDuDossier, ctx: Contexte) {
  const famille = familleDuMouvement(entreprise, cle);
  await ecrireFamille(tx, entreprise, famille, contenu === null ? [] : ecrituresDuMouvement(famille, contenu, p, ctx));
}

// Tous les mouvements (le plan a changé : D3).
export async function reecrireLesMouvements(tx: Transaction, entreprise: string): Promise<number> {
  const p = await lirePlan(tx, entreprise), ctx = await lireContexte(tx, entreprise);
  const tous = await requetes(tx).selectFrom('socle.dossier_v10').select(['cle', 'contenu']).where('entreprise', '=', entreprise).where('collection', '=', 'movements').execute();
  for (const o of tous) await ecrireLeMouvement(tx, entreprise, o.cle, o.contenu, p, ctx);
  return tous.length;
}

// Ce qu'un envoi change : les mouvements touchés ; un bulletin touché fait relire les salaires réglés (leur compte suit
// les mois qui ont un bulletin).
export async function suivreMouvements(tx: Transaction, entreprise: string, changements: ChangementLu[]): Promise<void> {
  const touches = changements.filter((c) => c.collection === 'movements' && aVraimentChange(c));
  const bulletins = changements.some((c) => c.collection === 'payslips' && aVraimentChange(c));
  if (!touches.length && !bulletins) return;
  const p = await lirePlan(tx, entreprise), ctx = await lireContexte(tx, entreprise);
  for (const c of touches) await ecrireLeMouvement(tx, entreprise, c.cle, c.apres, p, ctx);
  if (bulletins) {
    const deja = new Set(touches.map((c) => c.cle));
    const salaires = await requetes(tx).selectFrom('socle.dossier_v10').select(['cle', 'contenu']).where('entreprise', '=', entreprise).where('collection', '=', 'movements').execute();
    for (const o of salaires) if (!deja.has(o.cle) && estObjet(o.contenu) && o.contenu.kind === 'salaire') await ecrireLeMouvement(tx, entreprise, o.cle, o.contenu, p, ctx);
  }
}
