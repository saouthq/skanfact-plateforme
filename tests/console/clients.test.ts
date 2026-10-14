// La liste des clients recalée sur sa maquette, pure (serveur/console/clients.ts ; docs/console.md C17) : chaque vue du
// métier compte la liste qu'elle ouvre ; un silence se compte en jours de Tunis ; un montant par an se dit au prix du
// jour, hors taxes, jamais inventé, et ce qui n'est pas encore payé se dit « attendu » sans compter dans ce que la
// sélection rapporte ; l'échéance est le prochain jour où quelque chose change ; les tris gardent l'urgence pour
// départager et mettent en bas ce qui n'a pas de valeur. Les dates et les montants sont comptés à la main.

import { describe, expect, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { avecVenues, comptesDesVues, dansLaVue, echeanceDe, ligneClient, parAn, parAnDeLaSelection, trier, VUES_CLIENTS } from '../../serveur/console/clients.ts';
import { lireEntreprises, rangerParUrgence } from '../../serveur/console/decider.ts';
import { annuel, lignesEcheances, lireExtras, lirePrix, lireRemisesEcheances } from '../../serveur/console/echeances.ts';

const JOUR = '2026-10-13';
let n = 0;
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
// Une entreprise telle que la base la rend (plateforme.console_entreprises), ouverte hier sauf mention contraire.
function brute(nom: string, faits: Record<string, unknown>, autre: Record<string, unknown> = {}) {
  n++;
  return {
    id: id(n), raisonSociale: nom, matricule: null, active: true, creeLe: '2026-08-01',
    organisation: { id: 'o', type: 'independant', nom }, tenuePar: null, proprietaire: null, membres: 1,
    derniereActivite: '2026-10-12T09:00:00Z', pieces: 3,
    faits: { connu: true, essaiJusquAu: '2026-09-01', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null, suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  };
}
// Les prix du jour, hors taxes, en millimes (plateforme.prix_du_jour).
const PRIX = lirePrix([
  { offre: 'essentiel', periodicite: 'annuel', montantHt: '390000' }, { offre: 'essentiel', periodicite: 'mensuel', montantHt: '39000' },
  { offre: 'complet', periodicite: 'annuel', montantHt: '690000' }, { offre: 'complet', periodicite: 'mensuel', montantHt: '69000' },
]);

// Le portefeuille : chaque vue, et ses bords. La grâce dure 7 jours après l'échéance (serveur/abonnement/etat.ts).
const BRUT = [
  brute('A · essai qui finit dans 2 jours, rien émis', { essaiJusquAu: '2026-10-15' }, { pieces: 0 }),
  brute('B · essai qui finit dans 2 jours, a servi', { essaiJusquAu: '2026-10-15' }),
  brute('C · essai qui finit dans 7 jours, rien émis', { essaiJusquAu: '2026-10-20' }, { pieces: 0 }),
  brute('D · essai qui finit dans 8 jours, jamais ouvert', { essaiJusquAu: '2026-10-21' }, { pieces: 0, derniereActivite: null }),
  brute('E · essai fini, en grâce, sans offre', { essaiJusquAu: '2026-10-10' }),
  brute('F · essai fini, offre choisie, pas payée', { essaiJusquAu: '2026-10-10', offre: 'essentiel', periodicite: 'annuel' }),
  brute('G · non renouvelé, en grâce', { payeJusquAu: '2026-10-08', offre: 'essentiel', periodicite: 'annuel' }),
  // Ouvert le 03/10 à Tunis : dix jours pile, il est silencieux.
  brute('H · Essentiel au mois, ouvert le 03/10', { payeJusquAu: '2026-10-20', offre: 'essentiel', periodicite: 'mensuel' }, { derniereActivite: '2026-10-03T08:00:00Z' }),
  // Le 03/10 à 23 h 30 en UTC, c'est déjà le 04/10 à Tunis : neuf jours, pas encore silencieux.
  brute('I · Complet à l\'année, ouvert le 04/10 à Tunis', { payeJusquAu: '2027-05-01', offre: 'complet', periodicite: 'annuel' }, { derniereActivite: '2026-10-03T23:30:00Z' }),
  brute('J · résilié', { payeJusquAu: '2026-10-25', offre: 'essentiel', periodicite: 'annuel', resilieLe: '2026-10-01' }),
  brute('K · lecture seule, non renouvelé', { payeJusquAu: '2026-09-20', offre: 'complet', periodicite: 'mensuel' }),
  brute('L · tenue par son cabinet', { tenuParCabinet: true }),
  brute('M · offerte', { offert: true }),
];
// Venues par un cabinet (plateforme.console_venues_par_cabinet) : H ; L, que son cabinet tient sans abonnement, n'en est
// pas une (elle est « à convertir ») ; I, d'une ligne illisible, non plus.
const LISTE = avecVenues(lireEntreprises(BRUT, JOUR, REGLES_DE_DEPART), {
  [id(8)]: { cabinet: 'Cabinet Nour', depuis: '2026-01-05' }, [id(12)]: { cabinet: 'Cabinet Nour', depuis: '2026-02-01' }, [id(9)]: { cabinet: '', depuis: '2026-01-01' },
});
function nom(lettre: string) {
  const e = LISTE.find((x) => x.raisonSociale.startsWith(`${lettre} `));
  if (!e) throw new Error(`pas d'entreprise ${lettre}`);
  return e;
}
const lettres = (l: readonly { raisonSociale: string }[]) => l.map((e) => e.raisonSociale.charAt(0)).join('');

describe('Clients : les vues du métier', () => {
  it('chaque vue garde exactement les entreprises de sa phrase, et sa carte compte la même liste (C3)', () => {
    const dans = (v: (typeof VUES_CLIENTS)[number]) => lettres(LISTE.filter((e) => dansLaVue(e, v, JOUR)));
    // À appeler : un essai qui finit dans la semaine sans une pièce (A, C — pas B qui a servi, pas D à huit jours), une
    // grâce sans offre (E).
    expect(dans('a_appeler')).toBe('ACE');
    // L'argent attendu : une offre choisie, l'échéance passée, rien de payé (F, G) — jamais la lecture seule (K).
    expect(dans('argent')).toBe('FG');
    // Silencieux : en essai ou abonné, jamais ouvert (D) ou pas depuis dix jours de Tunis (H) — pas I, à neuf jours.
    expect(dans('silencieux')).toBe('DH');
    expect(dans('tenus')).toBe('L');
    // Venus par un cabinet : un mandat avant leur premier paiement (0107), jamais un dossier tenu sans abonnement.
    expect(dans('cabinet')).toBe('H');
    expect(nom('H').venuePar).toEqual({ cabinet: 'Cabinet Nour', depuis: '2026-01-05' });
    expect(nom('I').venuePar).toBeNull();
    expect(dans('tout')).toBe('ABCDEFGHIJKLM');
    expect(comptesDesVues(LISTE, JOUR)).toEqual({ tout: 13, a_appeler: 3, argent: 2, silencieux: 2, tenus: 1, cabinet: 1 });
  });
});

describe('Clients : l\'échéance et ce que rapporte chaque ligne', () => {
  it('l\'échéance est le prochain jour où quelque chose change ; la lecture seule n\'en a plus', () => {
    expect(echeanceDe(nom('A'))).toBe('2026-10-15');
    expect(echeanceDe(nom('H'))).toBe('2026-10-20');
    // La grâce de G finit le 16/10 (échéance du 08/10, sept jours de grâce) : il passe en lecture seule ce jour-là.
    expect(echeanceDe(nom('G'))).toBe('2026-10-16');
    expect(echeanceDe(nom('K'))).toBeNull();
    expect(echeanceDe(nom('L'))).toBeNull();
  });

  it('un montant par an au prix du jour, hors taxes ; ce qui n\'est pas payé est attendu ; rien ne s\'invente', () => {
    expect(parAn(nom('H'), PRIX)).toEqual({ montantHt: '468.000', attendu: false, remise: null }); // 39 DT × 12 mois
    expect(parAn(nom('I'), PRIX)).toEqual({ montantHt: '690.000', attendu: false, remise: null });
    expect(parAn(nom('F'), PRIX)).toEqual({ montantHt: '390.000', attendu: true, remise: null });
    expect(parAn(nom('G'), PRIX)).toEqual({ montantHt: '390.000', attendu: true, remise: null });
    expect(parAn(nom('K'), PRIX)).toEqual({ montantHt: '828.000', attendu: true, remise: null }); // 69 DT × 12 mois
    // Un résilié ne se renouvelle pas ; un essai sans offre, un dossier tenu ne rapportent rien de dit.
    expect(parAn(nom('J'), PRIX)).toBeNull();
    expect(parAn(nom('A'), PRIX)).toBeNull();
    expect(parAn(nom('L'), PRIX)).toBeNull();
    // Sans prix du jour pour son offre, rien : jamais un zéro ni un montant deviné.
    expect(parAn(nom('I'), lirePrix([{ offre: 'essentiel', periodicite: 'annuel', montantHt: '390000' }]))).toBeNull();
    expect(ligneClient(nom('H'), PRIX)).toMatchObject({ echeance: '2026-10-20', parAn: { montantHt: '468.000', attendu: false } });
  });

  it('la sélection rapporte ce que rapportent ses abonnements actifs, sans ce qui est attendu', () => {
    // H 468 + I 690 ; F, G, K sont attendus, J est résilié.
    expect(parAnDeLaSelection(LISTE, PRIX)).toEqual({ montantHt: '1158.000', abonnements: 2 });
    expect(parAnDeLaSelection(LISTE.filter((e) => dansLaVue(e, 'argent', JOUR)), PRIX)).toEqual({ montantHt: '0.000', abonnements: 0 });
  });
});

describe('Clients : la remise de la prochaine période (0106)', () => {
  it('« par an » la déduit de chaque période, comme « Ce qui revient chaque année » des échéances, et la dit', () => {
    const remises = lireRemisesEcheances({ [id(8)]: { nature: 'groupe', taux: 17, groupe: 'Famille' }, [id(9)]: { nature: 'cabinet', taux: 20, cabinet: 'Cabinet Nour' } });
    const liste = avecVenues(lireEntreprises(BRUT, JOUR, REGLES_DE_DEPART), {}, remises);
    const de = (lettre: string) => liste.find((e) => e.raisonSociale.startsWith(`${lettre} `)) as (typeof liste)[number];
    // H : (39,000 − 17 % = 32,370) × 12 = 388,440 ; I : 690,000 − 20 % = 552,000.
    expect(parAn(de('H'), PRIX)).toEqual({ montantHt: '388.440', attendu: false, remise: { nature: 'groupe', taux: 17 } });
    expect(parAn(de('I'), PRIX)).toEqual({ montantHt: '552.000', attendu: false, remise: { nature: 'cabinet', taux: 20 } });
    expect(parAnDeLaSelection(liste, PRIX)).toEqual({ montantHt: '940.440', abonnements: 2 });
    // Le même chiffre que les échéances, sur les mêmes entreprises et les mêmes remises.
    expect(annuel(lignesEcheances(lireEntreprises(BRUT, JOUR, REGLES_DE_DEPART), lireExtras({}), PRIX, JOUR, remises), PRIX, remises).montantHt).toBe('940.440');
  });
});

describe('Clients : les tris', () => {
  const urgence = rangerParUrgence(LISTE, JOUR);
  it('« le plus urgent d\'abord » est l\'ordre reçu, intact', () => {
    expect(lettres(trier(urgence, 'urgence', PRIX))).toBe(lettres(urgence));
  });
  it('l\'échéance la plus proche d\'abord, sans échéance en bas ; à égalité, l\'urgence départage', () => {
    const t = trier(urgence, 'echeance', PRIX);
    // A et B le 15/10, G le 16/10, E et F le 18/10 (grâce du 10/10), C le 20/10 avec H, D le 21/10, J le 25/10, I en 2027.
    expect(t.slice(0, 2).map((e) => e.raisonSociale.charAt(0)).sort().join('')).toBe('AB');
    expect(t.map((e) => echeanceDe(e))).toEqual([...t.map((e) => echeanceDe(e))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0)));
    expect(lettres(t.slice(-3)).split('').sort().join('')).toBe('KLM');
    const ab = urgence.filter((e) => echeanceDe(e) === '2026-10-15');
    expect(lettres(t.filter((e) => echeanceDe(e) === '2026-10-15'))).toBe(lettres(ab));
  });
  it('ce qui rapporte le plus d\'abord, attendu compris ; rien en bas', () => {
    expect(lettres(trier(urgence, 'par_an', PRIX)).slice(0, 5)).toBe('KIH' + lettres(urgence.filter((e) => 'FG'.includes(e.raisonSociale.charAt(0)))));
  });
  it('le nom dans l\'ordre de lecture ; le plus récemment ouvert d\'abord, jamais ouvert en bas', () => {
    expect(lettres(trier(urgence, 'nom', PRIX))).toBe('ABCDEFGHIJKLM');
    const vu = trier(urgence, 'vu', PRIX);
    expect(lettres(vu).slice(-3)).toBe('IHD');
  });
});
