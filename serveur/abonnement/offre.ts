// Ce qu'une offre ouvre (14c ; docs/abonnement.md, « 14c » ; skanfact docs/cadrage/07-offres-et-prix.md, 02 § 1, § 6
// et § 8).
//
// Essentiel ne contient ni la paie ni la comptabilité complète : ces deux modules y sont FERMÉS. Fermé ne cache rien
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
import { etatAbonnement, type Etat, type Faits, type Offre } from './etat.ts';
import './textes.ts';

export type ModuleDeLOffre = 'paie' | 'compta';
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
  return offreQuiDecide(f, etatAbonnement(f, jour)) === 'essentiel' ? [...MODULES_DE_COMPLET] : [];
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
