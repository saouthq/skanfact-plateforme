// Le plan comptable de l'entreprise, tel que son dossier le règle (docs/ecritures.md § 4) : les
// comptes par défaut (moteur/comptes.ts, ceux de la v10) remplacés par les siens (`chartAccounts`),
// les comptes auxiliaires quand elle les a demandés (`auxiliaires` : 411 + le code du client), et ses
// comptes de trésorerie (`accounts`), qui décident du journal d'un règlement.

import { planDeLEntreprise, type Plan } from '../../moteur/comptes.ts';
import { requetes, type Transaction } from '../base.ts';
import { estJour, estObjet } from '../v10/lecture.ts';

// `depart` : le jour du solde de départ du compte (`openingDate`), s'il en a un (1.357.7).
type CompteDeTresorerie = { id: string; caisse: boolean; parDefaut: boolean; depart: string | null };
export type PlanDuDossier = {
  plan: Plan;
  auxiliaires: boolean;
  // Le code auxiliaire de chaque client et de chaque fournisseur, par sa fiche du serveur (socle.tiers).
  codesClients: Map<string, string>;
  codesFournisseurs: Map<string, string>;
  tresorerie: CompteDeTresorerie[];
};

// Ce qui, changé dans le dossier, change le plan : le serveur réécrit alors tout le brouillard.
export const REGLAGES_DU_PLAN = [{ collection: '_racine', cle: 'chartAccounts' }, { collection: '_racine', cle: 'auxiliaires' }, { collection: 'accounts' }];

async function objetsDe(tx: Transaction, entreprise: string, collection: string) {
  return requetes(tx).selectFrom('socle.dossier_v10').select(['cle', 'contenu'])
    .where('entreprise', '=', entreprise).where('collection', '=', collection).orderBy('rang').orderBy('cle').execute();
}

// Les codes auxiliaires (`codesAuxiliaires`, core.js) : celui de la fiche, sinon le suivant du plus
// grand, dans l'ordre de la liste.
function codesAuxiliaires(liste: { id: string; compteAux: unknown }[]): Map<string, string> {
  const codes = new Map<string, string>();
  let max = 0;
  for (const t of liste) {
    if (t.compteAux !== undefined && t.compteAux !== null && t.compteAux !== '') {
      codes.set(t.id, String(t.compteAux));
      max = Math.max(max, Number(t.compteAux) || 0);
    }
  }
  for (const t of liste) if (!codes.has(t.id)) { max += 1; codes.set(t.id, String(max).padStart(3, '0')); }
  return codes;
}

export async function lirePlan(tx: Transaction, entreprise: string): Promise<PlanDuDossier> {
  const racine = new Map((await objetsDe(tx, entreprise, '_racine')).map((o) => [o.cle, o.contenu]));
  const reglage = racine.get('chartAccounts');
  const auxiliaires = racine.get('auxiliaires') === true;
  const codesClients = new Map<string, string>(), codesFournisseurs = new Map<string, string>();
  if (auxiliaires) {
    // Un tiers du dossier est une fiche du serveur par son identifiant v10.
    const fiches = await requetes(tx).selectFrom('socle.tiers').select(['id', 'ref_v10']).where('entreprise', '=', entreprise).where((eb) => eb.not(eb('ref_v10', 'is', null))).execute();
    for (const [collection, cible] of [['clients', codesClients], ['suppliers', codesFournisseurs]] as const) {
      const codes = codesAuxiliaires((await objetsDe(tx, entreprise, collection)).map((o) => ({ id: o.cle, compteAux: estObjet(o.contenu) ? o.contenu.compteAux : undefined })));
      for (const f of fiches) { const c = codes.get(f.ref_v10 ?? ''); if (c) cible.set(f.id, c); }
    }
  }
  const tresorerie = (await objetsDe(tx, entreprise, 'accounts')).filter((o) => estObjet(o.contenu)).map((o) => {
    const a = o.contenu as Record<string, unknown>;
    return { id: o.cle, caisse: a.kind === 'caisse', parDefaut: a.isDefault === true, depart: estJour(a.openingDate) ? a.openingDate : null };
  });
  return { plan: planDeLEntreprise(estObjet(reglage) ? reglage : null), auxiliaires, codesClients, codesFournisseurs, tresorerie };
}

// Le compte d'un client : 411, ou 411 + son code quand l'entreprise tient des comptes auxiliaires.
export const compteClient = (p: PlanDuDossier, tiers: string | null) => {
  const code = p.auxiliaires && tiers ? p.codesClients.get(tiers) : undefined;
  return code ? p.plan.clients + code : p.plan.clients;
};
// Celui d'un fournisseur : 401, ou 401 + son code.
export const compteFournisseur = (p: PlanDuDossier, tiers: string | null) => {
  const code = p.auxiliaires && tiers ? p.codesFournisseurs.get(tiers) : undefined;
  return code ? p.plan.fournisseurs + code : p.plan.fournisseurs;
};

// Le journal et le compte d'un règlement (`journalDeCompte`, core.js) : le compte de trésorerie
// choisi, sinon celui par défaut, sinon le premier ; sans aucun, les espèces vont à la caisse.
const ESPECES = ['espèces', 'especes', 'Espèces'];
// (1.353.0) Sans compte nommé, un règlement qui n'est pas en espèces ne tombe jamais dans une caisse par défaut
// (`compteSansNom`, core.js) : il va au premier compte qui n'est pas une caisse, et sans un tel compte il reste sans
// compte (le mode décide : la banque). Sans mode connu, rien ne change.
export const compteDeTresorerie = (p: PlanDuDossier, compte: string | null, mode = '') => {
  const nomme = compte ? p.tresorerie.find((a) => a.id === compte) : undefined;
  if (nomme) return nomme;
  const defaut = p.tresorerie.find((a) => a.parDefaut) ?? p.tresorerie[0];
  if (!defaut || !defaut.caisse || !mode || ESPECES.includes(mode)) return defaut;
  return p.tresorerie.find((a) => !a.caisse);
};
// (1.357.7, bout en bout 16) Un flux daté AVANT le solde de départ de son compte est déjà compris dans ce solde : la
// Trésorerie de la v10 ne le compte pas (`accountBalance`). L'écrire à la banque la comptait deux fois — le prêt du four du
// 02/11 dans un solde de départ du 11/11 : le 532 à 66 250 pour 48 250 au relevé. Son côté trésorerie va à la contrepartie du
// solde de départ (le compte d'attente, comme `ecrituresDOuverture`), en opération diverse : la banque ne bouge pas, et ce que
// le solde de départ portait sans explication diminue d'autant. Le jour d'un flux est facultatif : sans lui, rien ne change.
// (1.358.0, bout en bout 18) « De ma poche » (`POCHE`, core.js) : un règlement d'achat payé avec l'argent personnel du gérant.
// Rien ne sort de la banque ni de la caisse : une opération diverse contre son compte courant d'associé.
export const POCHE = '@poche';
export function journalDeCompte(p: PlanDuDossier, compte: string | null, mode: string, jour = ''): { journal: 'BQ' | 'CA' | 'OD'; compte: string } {
  if (compte === POCHE) return { journal: 'OD', compte: p.plan.associes };
  const t = compteDeTresorerie(p, compte, mode);
  if (jour && t?.depart && jour < t.depart) return { journal: 'OD', compte: p.plan.attente };
  const caisse = t ? t.caisse : ESPECES.includes(mode);
  return caisse ? { journal: 'CA', compte: p.plan.caisse } : { journal: 'BQ', compte: p.plan.banque };
}
