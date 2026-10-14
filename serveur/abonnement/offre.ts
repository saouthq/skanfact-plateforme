// Ce qu'une offre ouvre (14c ; docs/abonnement.md, « 14c » ; skanfact docs/cadrage/07-offres-et-prix.md, 02 § 1, § 6
// et § 8).
//
// Essentiel ne contient ni la paie ni la comptabilité complète : ces deux modules y sont FERMÉS, sauf achetés seuls
// (14c, deuxième partie : un geste de SkanFact, plateforme.abonnement.modules). Fermé ne cache rien
// (02 § 1 : une offre ne masque jamais rien) : tout ce qui existe se lit, s'imprime, s'exporte et se corrige ; rien de
// NEUF ne s'y crée (02 § 6 ; la v10, 7.33.0). Tout le reste ouvre tout : l'essai, Complet, un abonnement offert, ce
// qu'on ne connaît pas (rien ne se ferme sur ce qu'on ignore). La lecture seule, elle, a sa propre porte (condition.ts).
//
// Le cabinet qui a le mandat d'un dossier y a toujours la paie et la comptabilité complète, quelle que soit l'offre du
// client (02 § 8 : ce que le cabinet fait pour son client ne se facture pas au client).

import type { Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { faitsDe } from './condition.ts';
import { etatAbonnement, type Etat, type Faits, type ModuleAchete, type Offre } from './etat.ts';
import './textes.ts';

export type ModuleDeLOffre = ModuleAchete;
export const MODULES_DE_COMPLET: readonly ModuleDeLOffre[] = ['paie', 'compta'];

// Les parties du dossier où un module fermé ne crée plus rien. La comptabilité complète n'y ferme que les
// immobilisations : ses autres écrans (le grand livre, la balance, les états financiers) se calculent à l'écran, qui
// les retient ; et ce que la loi demande (la TVA, les retenues, les déclarations, les clôtures, les écritures) n'est
// dans aucun module fermé (07 : aucune obligation légale n'est vendue en option).
export const PARTIES_DU_MODULE: Record<ModuleDeLOffre, readonly string[]> = {
  paie: ['employees', 'payslips', 'leaves', 'advances', 'socialFilings'],
  compta: ['assets'],
};

// L'offre qui décide aujourd'hui : celle de la période payée, et pendant la grâce qui la suit, toujours elle. L'essai
// (même fini, pendant sa grâce) ouvre tout.
export function offreQuiDecide(f: Faits, e: Etat): Offre | null {
  if (e.etat === 'actif') return e.offre;
  if (e.etat === 'en_retard' && !e.apresEssai) return f.offre;
  return null;
}

export function modulesFermes(f: Faits | null, jour: string): ModuleDeLOffre[] {
  if (!f) return [];
  // Un module acheté seul sur Essentiel (14c, deuxième partie) y est ouvert.
  return offreQuiDecide(f, etatAbonnement(f, jour)) === 'essentiel' ? MODULES_DE_COMPLET.filter((m) => !(f.modules ?? []).includes(m)) : [];
}

// Pour la personne qui agit : qui n'agit ici que par son cabinet (le mandat) a tout.
export async function modulesFermesPourMoi(tx: Transaction, entreprise: string, jour = aujourdhuiATunis()): Promise<ModuleDeLOffre[]> {
  const fermes = modulesFermes(await faitsDe(tx, entreprise), jour);
  if (!fermes.length) return fermes;
  const perimetre = (await tx.query('select socle.perimetre_cabinet($1) p', [entreprise])).rows[0]?.p as string[] | null | undefined;
  return perimetre ? [] : fermes;
}

// Avant d'écrire dans le dossier : un objet NOUVEAU dans une partie d'un module fermé est refusé, quoi que l'écran
// envoie ; le refus dit ce qui est fermé, ce qui reste, et mène à l'abonnement.
export async function refuserHorsOffre(tx: Transaction, entreprise: string, nouveaux: readonly { collection: string }[]): Promise<void> {
  const touches = MODULES_DE_COMPLET.filter((m) => nouveaux.some((c) => PARTIES_DU_MODULE[m].includes(c.collection)));
  if (!touches.length) return;
  const fermes = await modulesFermesPourMoi(tx, entreprise);
  const ferme = touches.find((m) => fermes.includes(m));
  if (ferme) throw new Refus(`abonnement.offre.${ferme}`, { bouton: 'socle.abonnement.voir' });
}

// Ce que l'offre compte aujourd'hui (14c, deuxième partie ; 0100) : ce que l'entreprise utilise et ce que l'offre qui
// décide comprend — les deux fonctions de la base que la facture lit aussi. `null` quand rien ne se compte (l'essai, un
// abonnement offert : rien ne se facture) et pour qui ne gère ni l'abonnement ni l'équipe (la base ne rend rien).
// Plus aucune offre ne compte les utilisateurs (Skander, 14/10/2026 ; 0102).
export type Comptes = { salaries: number; caisses: number; etablissements: number };
export type Inclus = { caisses: number | null; etablissements: number | null; salaries: number | null };
export type OffreComptee = { offre: Offre; comptes: Comptes; inclus: Inclus };
const nombre = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const plafond = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
export async function ceQueLOffreCompte(tx: Transaction, entreprise: string, jour = aujourdhuiATunis()): Promise<OffreComptee | null> {
  const f = await faitsDe(tx, entreprise);
  if (!f || f.offert) return null;
  const offre = offreQuiDecide(f, etatAbonnement(f, jour));
  if (!offre) return null;
  const v = (await tx.query('select plateforme.ce_que_l_offre_compte($1, $2, $3::date) v', [entreprise, offre, jour])).rows[0]?.v as
    { comptes?: Record<string, unknown>; inclus?: Record<string, unknown> } | null | undefined;
  if (!v?.comptes || !v.inclus) return null;
  const c = v.comptes, i = v.inclus;
  return {
    offre,
    comptes: { salaries: nombre(c.salaries), caisses: nombre(c.caisses), etablissements: nombre(c.etablissements) },
    inclus: { caisses: plafond(i.caisses), etablissements: plafond(i.etablissements), salaries: plafond(i.salaries) },
  };
}
