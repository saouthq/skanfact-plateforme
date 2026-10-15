// La liste des clients recalée sur sa maquette, pure (serveur/console/clients.ts ; docs/console.md C17) : chaque vue du
// métier compte la liste qu'elle ouvre ; un silence se compte en jours de Tunis ; un montant par an se dit par la règle
// de la facture, hors taxes, jamais inventé, et ce qui n'est pas encore payé se dit « attendu » sans compter dans ce que la
// sélection rapporte ; l'échéance est le prochain jour où quelque chose change ; les tris gardent l'urgence pour
// départager et mettent en bas ce qui n'a pas de valeur. Les dates et les montants sont comptés à la main.

import { describe, expect, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { avecEnPlus, avecVenues, cabinetDe, comptesDesVues, dansLaVue, dansLesFiltres, duType, echeanceDe, ligneClient, ligneExport, lireEnPlus, lireFiltres, optionsDesFiltres, parAn, parAnDeLaSelection, trier, VUES_CLIENTS } from '../../serveur/console/clients.ts';
import { gestesDeLaListe } from '../../serveur/console/routes.ts';
import { categorieOrg, chercherOrg, lireFiltresOrg, optionsDesFiltresOrg, orgDansLaVue, orgDansLesFiltres, organisations, parAnDeLaLigne, SANS_CABINET, trierOrg,
  usageDeLaLigne, vuDeLaLigne, type Organisation } from '../../serveur/console/organisations.ts';
import { lireEntreprises, rangerParUrgence } from '../../serveur/console/decider.ts';
import { annuel, lignesEcheances, lireExtras, lirePrix, lireRemisesEcheances } from '../../serveur/console/echeances.ts';
import { aRenouveler, lireRenouvellements } from '../../serveur/console/renouvellements.ts';
import { auPrix } from './au-prix.ts';

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
// Ce que chaque renouvellement coûtera, par la règle de la facture, à ces prix-là.
const R = auPrix(LISTE, JOUR, PRIX);
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
    expect(comptesDesVues(LISTE, JOUR)).toEqual({ tout: 13, arrivees: 0, a_appeler: 3, argent: 2, silencieux: 2, tenus: 1, cabinet: 1 });
  });

  it('jamais ouverte, le silence se compte depuis l\'inscription : née il y a neuf jours, pas encore ; dix, oui (0114)', () => {
    const neuve = (creeLe: string) => lireEntreprises([brute('Née', { essaiJusquAu: '2026-11-01' }, { derniereActivite: null, creeLe })], JOUR, REGLES_DE_DEPART)[0];
    const a = neuve('2026-10-04'), b = neuve('2026-10-03'), c = neuve(JOUR);
    if (!a || !b || !c) throw new Error('trois entreprises attendues');
    expect(dansLaVue(c, 'silencieux', JOUR)).toBe(false);
    expect(dansLaVue(a, 'silencieux', JOUR)).toBe(false);
    expect(dansLaVue(b, 'silencieux', JOUR)).toBe(true);
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

  it('un montant par an, hors taxes, par la règle de la facture ; ce qui n\'est pas payé est attendu ; rien ne s\'invente', () => {
    expect(parAn(nom('H'), R)).toEqual({ montantHt: '468.000', attendu: false, remise: null }); // 39 DT × 12 mois
    expect(parAn(nom('I'), R)).toEqual({ montantHt: '690.000', attendu: false, remise: null });
    expect(parAn(nom('F'), R)).toEqual({ montantHt: '390.000', attendu: true, remise: null });
    expect(parAn(nom('G'), R)).toEqual({ montantHt: '390.000', attendu: true, remise: null });
    expect(parAn(nom('K'), R)).toEqual({ montantHt: '828.000', attendu: true, remise: null }); // 69 DT × 12 mois
    // Un résilié ne se renouvelle pas ; un essai sans offre, un dossier tenu ne rapportent rien de dit.
    expect(parAn(nom('J'), R)).toBeNull();
    expect(parAn(nom('A'), R)).toBeNull();
    expect(parAn(nom('L'), R)).toBeNull();
    // Sans prix du jour pour son offre, rien : jamais un zéro ni un montant deviné.
    expect(parAn(nom('I'), auPrix(LISTE, JOUR, lirePrix([{ offre: 'essentiel', periodicite: 'annuel', montantHt: '390000' }])))).toBeNull();
    expect(ligneClient(nom('H'), R)).toMatchObject({ echeance: '2026-10-20', parAn: { montantHt: '468.000', attendu: false } });
  });

  it('la sélection rapporte ce que rapportent ses abonnements actifs, sans ce qui est attendu', () => {
    // H 468 + I 690 ; F, G, K sont attendus, J est résilié.
    expect(parAnDeLaSelection(LISTE, R)).toEqual({ montantHt: '1158.000', abonnements: 2 });
    expect(parAnDeLaSelection(LISTE.filter((e) => dansLaVue(e, 'argent', JOUR)), R)).toEqual({ montantHt: '0.000', abonnements: 0 });
  });
});

describe('Clients : la remise de la prochaine période (0106)', () => {
  it('« par an » la déduit de chaque période, comme « Ce qui revient chaque année » des échéances, et la dit', () => {
    const remises = lireRemisesEcheances({ [id(8)]: { nature: 'groupe', taux: 17, groupe: 'Famille' }, [id(9)]: { nature: 'cabinet', taux: 20, cabinet: 'Cabinet Nour' } });
    const liste = avecVenues(lireEntreprises(BRUT, JOUR, REGLES_DE_DEPART), {}, remises);
    const de = (lettre: string) => liste.find((e) => e.raisonSociale.startsWith(`${lettre} `)) as (typeof liste)[number];
    const RR = auPrix(liste, JOUR, PRIX, remises);
    // H : (39,000 − 17 % = 32,370) × 12 = 388,440 ; I : 690,000 − 20 % = 552,000.
    expect(parAn(de('H'), RR)).toEqual({ montantHt: '388.440', attendu: false, remise: { nature: 'groupe', taux: 17 } });
    expect(parAn(de('I'), RR)).toEqual({ montantHt: '552.000', attendu: false, remise: { nature: 'cabinet', taux: 20 } });
    expect(parAnDeLaSelection(liste, RR)).toEqual({ montantHt: '940.440', abonnements: 2 });
    // Le même chiffre que les échéances, sur les mêmes entreprises et les mêmes remises.
    expect(annuel(lignesEcheances(lireEntreprises(BRUT, JOUR, REGLES_DE_DEPART), lireExtras({}), RR, JOUR), RR).montantHt).toBe('940.440');
  });
});

describe('Clients : le renouvellement, par la règle de la facture (0113)', () => {
  it('la période et l\'offre de la prochaine facture : la suite de l\'échéance, ou aujourd\'hui après la grâce ; rien pour ce qui ne se renouvelle pas', () => {
    // G, échue le 08/10, est encore en grâce : sa facture part du 09/10. K, en lecture seule, repart d'aujourd'hui.
    expect(aRenouveler(nom('G'), JOUR)).toMatchObject({ offre: 'essentiel', periodicite: 'annuel', debut: '2026-10-09', attendu: true });
    expect(aRenouveler(nom('K'), JOUR)).toMatchObject({ offre: 'complet', periodicite: 'mensuel', debut: JOUR, attendu: true });
    expect(aRenouveler(nom('H'), JOUR)).toMatchObject({ debut: '2026-10-21', attendu: false });
    for (const l of 'ABEJLM') expect(aRenouveler(nom(l), JOUR)).toBeNull();
  });

  it('ce qui s\'ajoute à l\'offre compte, chaque année ; le rattrapage d\'un module ouvert en cours, une fois, sur la prochaine facture', () => {
    const h = nom('H');
    const r = auPrix(LISTE, JOUR, PRIX, new Map(), { [h.id]: [
      { option: 'module_paie', quantite: 1, compte: 1, inclus: 0, prixHt: '15000' },
      { option: 'rattrapage_paie', quantite: 1, compte: 10, inclus: 31, prixHt: '4839', du: '2026-10-11', au: '2026-10-20' }] });
    // La facture : 39,000 + 15,000 + 4,839 ; chaque année : (39,000 + 15,000) × 12, sans le rattrapage.
    expect(r.get(h.id)).toMatchObject({ periodeHt: 58839n, parAnHt: 648000n });
    expect(parAn(h, r)?.montantHt).toBe('648.000');
    const lignes = lignesEcheances(LISTE, lireExtras({}), r, JOUR);
    expect(lignes.find((l) => l.entreprise.id === h.id)?.montantHt).toBe('58.839');
    expect(annuel(lignes, r).montantHt).toBe(parAnDeLaSelection(LISTE, r).montantHt);
  });

  it('l\'offre changée pour la prochaine échéance (0111) est celle que la facture portera', () => {
    const brut = brute('N · Essentiel à l\'année, passe au Complet mensuel', { payeJusquAu: '2026-10-20', offre: 'essentiel', periodicite: 'annuel' });
    const [e] = lireEntreprises([brut], JOUR, REGLES_DE_DEPART, new Map([[brut.id, { delai: null,
      offreSuivante: { offre: 'complet' as const, periodicite: 'mensuel' as const, aPartirDu: '2026-10-21' } }]]));
    const n = e as NonNullable<typeof e>;
    expect(aRenouveler(n, JOUR)).toMatchObject({ offre: 'complet', periodicite: 'mensuel', debut: '2026-10-21' });
    expect(parAn(n, auPrix([n], JOUR, PRIX))?.montantHt).toBe('828.000');
  });

  it('un prix qui manque, une ligne illisible : rien, jamais un montant deviné', () => {
    const i = nom('I');
    const d = aRenouveler(i, JOUR);
    if (!d) throw new Error('I se renouvelle');
    expect(lireRenouvellements([d], { [i.id]: { incalculable: true } }).get(i.id)).toBeNull();
    expect(lireRenouvellements([d], { [i.id]: { prixHt: '690,000' } }).get(i.id)).toBeNull();
    expect(lireRenouvellements([d], {}).get(i.id)).toBeNull();
  });
});

describe('Clients : les tris', () => {
  const urgence = rangerParUrgence(LISTE, JOUR);
  it('« le plus urgent d\'abord » est l\'ordre reçu, intact', () => {
    expect(lettres(trier(urgence, 'urgence', R))).toBe(lettres(urgence));
  });
  it('l\'échéance la plus proche d\'abord, sans échéance en bas ; à égalité, l\'urgence départage', () => {
    const t = trier(urgence, 'echeance', R);
    // A et B le 15/10, G le 16/10, E et F le 18/10 (grâce du 10/10), C le 20/10 avec H, D le 21/10, J le 25/10, I en 2027.
    expect(t.slice(0, 2).map((e) => e.raisonSociale.charAt(0)).sort().join('')).toBe('AB');
    expect(t.map((e) => echeanceDe(e))).toEqual([...t.map((e) => echeanceDe(e))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0)));
    expect(lettres(t.slice(-3)).split('').sort().join('')).toBe('KLM');
    const ab = urgence.filter((e) => echeanceDe(e) === '2026-10-15');
    expect(lettres(t.filter((e) => echeanceDe(e) === '2026-10-15'))).toBe(lettres(ab));
  });
  it('ce qui rapporte le plus d\'abord, attendu compris ; rien en bas', () => {
    expect(lettres(trier(urgence, 'par_an', R)).slice(0, 5)).toBe('KIH' + lettres(urgence.filter((e) => 'FG'.includes(e.raisonSociale.charAt(0)))));
  });
  it('le nom dans l\'ordre de lecture ; le plus récemment ouvert d\'abord, jamais ouvert en bas', () => {
    expect(lettres(trier(urgence, 'nom', R))).toBe('ABCDEFGHIJKLM');
    const vu = trier(urgence, 'vu', R);
    expect(lettres(vu).slice(-3)).toBe('IHD');
  });
});

// Une facture d'abonnement telle que la base la rend (plateforme.console_factures_abonnement) : émise, son net en
// millimes, ses avoirs et ses règlements.
function facture(debut: string, net: string, o: { echeance?: string; reglements?: string[]; avoirs?: string[]; payeeLe?: string | null; emise?: boolean } = {}) {
  return {
    id: `f-${debut}`, editeur: 'e', piece: `p-${debut}`, client: 'c', offre: 'essentiel', periodicite: 'mensuel', debut, fin: debut, montantHt: '39000',
    prepareLe: '2026-10-01T08:00:00Z', preparePar: 'Nadia', payeeLe: o.payeeLe ?? null, dansLeDossier: true, numero: o.emise === false ? null : 'FAC-1',
    emise: o.emise ?? true, echeance: o.echeance ?? '2026-10-20', devise: 'TND', decimales: 3, net, avoirs: o.avoirs ?? [], reglements: o.reglements ?? [],
  };
}

describe('Clients : ce que chaque ligne dit en plus (0110)', () => {
  const enPlus = lireEnPlus({
    [id(1)]: { piecesMois: 4, essaiJours: 30, prolonge: 0, prolongeUneFois: false, factures: [], premiereFactureLe: '2026-10-02' },
    // A : une facture payée (rien n'attend) et une facture qui attend, réglée en partie : il en reste 17,410.
    [id(2)]: { piecesMois: 0, essaiJours: 30, prolonge: 14, prolongeUneFois: true, factures: [facture('2026-09-01', '46410', { reglements: ['46410'], payeeLe: '2026-09-02T08:00:00Z' }), facture('2026-10-15', '47410', { reglements: ['30000'] })] },
    // B : deux factures qui attendent ; la plus ancienne d'abord. C : seulement une facture annulée par son avoir.
    [id(3)]: { piecesMois: 2, factures: [facture('2026-11-15', '47410'), facture('2026-10-15', '47410', { echeance: '2026-10-15' })] },
    [id(4)]: { piecesMois: -3, essaiJours: 'trente', premiereFactureLe: '02/10/2026', factures: [facture('2026-10-15', '47410', { avoirs: ['47410'] })] },
    // D : préparée, pas encore émise : elle attend, sans reste ni échéance de pièce.
    [id(5)]: { factures: [facture('2026-10-15', '47410', { emise: false })] },
  }, JOUR);
  it('lit prudemment : un nombre illisible vaut zéro, une durée illisible n\'existe pas', () => {
    expect(enPlus.get(id(1))).toEqual({ piecesMois: 4, essaiJours: 30, prolonge: 0, prolongeUneFois: false, moisOffertRecent: false, attend: null, premiereFactureLe: '2026-10-02' });
    expect(enPlus.get(id(4))).toMatchObject({ piecesMois: 0, essaiJours: null, prolonge: 0, prolongeUneFois: false, attend: null, premiereFactureLe: null });
  });
  it('la facture qui attend : la plus ancienne pas encore réglée, avec ce qu\'il en reste — jamais une payée ni une annulée', () => {
    expect(enPlus.get(id(2))?.attend).toEqual({ offre: 'essentiel', periodicite: 'mensuel', etat: 'partielle', reste: '17.410', devise: 'TND', echeance: '2026-10-20' });
    expect(enPlus.get(id(3))?.attend).toMatchObject({ reste: '47.410', echeance: '2026-10-15' });
    expect(enPlus.get(id(5))?.attend).toMatchObject({ etat: 'a_emettre', reste: null });
  });
  it('un essai dont la facture attend est dans « l\'argent attendu », plus « à appeler » ; l\'usage trie par les pièces du mois', () => {
    const liste = avecEnPlus(LISTE, new Map([[nom('A').id, { piecesMois: 0, essaiJours: 30, prolonge: 0, prolongeUneFois: false, attend: { offre: 'essentiel' as const, periodicite: 'mensuel' as const, etat: 'a_payer', reste: '47.410', devise: 'TND', echeance: '2026-10-15' } }],
      [nom('I').id, { piecesMois: 9, essaiJours: null, prolonge: 0, prolongeUneFois: false, attend: null }], [nom('H').id, { piecesMois: 2, essaiJours: null, prolonge: 0, prolongeUneFois: false, attend: null }]]));
    const dans = (v: (typeof VUES_CLIENTS)[number]) => lettres(liste.filter((e) => dansLaVue(e, v, JOUR)));
    expect(dans('a_appeler')).toBe('CE');
    expect(dans('argent')).toBe('AFG');
    // Sans ce qu'elle dit en plus, une ligne n'a rien émis ce mois : I (9), H (2), puis les autres dans l'ordre reçu.
    expect(lettres(trier(liste, 'usage', R)).slice(0, 2)).toBe('IH');
    // L'export dit les pièces du mois, comme la colonne.
    expect(ligneExport(liste.find((e) => e.id === nom('I').id) as (typeof liste)[number], R).pieces).toBe(9);
  });
});

describe('Clients : les filtres de la ligne d\'outils', () => {
  it('le type, l\'offre et le cabinet ; chaque option compte ce que les deux autres filtres laissent (C3)', () => {
    expect(duType(nom('L'), 'tenues')).toBe(false); // tenuParCabinet dans ses faits, mais aucun cabinet nommé
    const liste = LISTE.map((e) => (e.raisonSociale.startsWith('L ') ? { ...e, tenuePar: 'Cabinet Nour' } : e));
    const l = (lettre: string) => liste.find((e) => e.raisonSociale.startsWith(`${lettre} `)) as (typeof liste)[number];
    expect(duType(l('L'), 'tenues')).toBe(true);
    expect(cabinetDe(l('L'))).toBe('Cabinet Nour');
    expect(cabinetDe(l('H'))).toBe('Cabinet Nour'); // venue par lui
    const f = lireFiltres({ offre: 'essentiel', cabinet: 'Cabinet Nour', type: 'nimporte' });
    expect(f).toEqual({ type: null, offre: 'essentiel', cabinet: 'Cabinet Nour' });
    expect(lettres(liste.filter((e) => dansLesFiltres(e, f)))).toBe('H');
    const o = optionsDesFiltres(liste, f);
    // L'offre Essentiel avec le cabinet : H ; Complet : aucune ; sans offre : L. Le cabinet, sur les Essentiel : H seul.
    expect(o.offre).toEqual({ essentiel: 1, complet: 0, aucune: 1 });
    expect(o.cabinet).toEqual([{ nom: 'Cabinet Nour', n: 1 }]);
  });
});

describe('Clients : les gestes du menu d\'une ligne', () => {
  const e = (lettre: string, autre: Partial<(typeof LISTE)[number]> = {}) => ({ ...nom(lettre), enPlus: { piecesMois: 0, essaiJours: 30, prolonge: 0, prolongeUneFois: false, attend: null }, ...autre });
  it('ceux de sa fiche, par la même règle, sans ceux qui demandent la fiche (payer, offrir, un module)', () => {
    expect(gestesDeLaListe('support', e('A'))).toEqual(['prolonger']);
    expect(gestesDeLaListe('support', e('A', { enPlus: { piecesMois: 0, essaiJours: 30, prolonge: 7, prolongeUneFois: true, attend: null } }))).toEqual([]);
    expect(gestesDeLaListe('direction', e('A'))).toEqual(['prolonger', 'suspendre']);
    // 0111 : un abonné qui paie se voit offrir un mois ou changer d'offre (à son échéance) ; la grâce, un délai (sans offre :
    // pas d'offre à changer) ; la lecture seule après une échéance manquée, un délai (« Réactiver »). 0113 : un mois offert
    // va sur la prochaine facture, celle qu'un abonné en grâce ou non renouvelé doit encore — un geste pour qu'il revienne.
    expect(gestesDeLaListe('direction', e('I'))).toEqual(['offrir-mois', 'changer-offre', 'suspendre', 'resilier']);
    // Le support offre un mois (0113), un par entreprise sur douze mois ; la direction, sans compter.
    expect(gestesDeLaListe('support', e('I'))).toEqual(['offrir-mois']);
    const offertRecemment = (l: string) => e(l, { enPlus: { piecesMois: 0, essaiJours: null, prolonge: 0, prolongeUneFois: false, moisOffertRecent: true, attend: null } });
    expect(gestesDeLaListe('support', offertRecemment('I'))).toEqual([]);
    expect(gestesDeLaListe('direction', offertRecemment('I'))).toContain('offrir-mois');
    expect(gestesDeLaListe('direction', e('E'))).toEqual(['prolonger', 'accorder-delai', 'suspendre']);
    expect(gestesDeLaListe('direction', e('G'))).toEqual(['accorder-delai', 'offrir-mois', 'changer-offre', 'suspendre']);
    expect(gestesDeLaListe('direction', e('K'))).toEqual(['accorder-delai', 'offrir-mois', 'suspendre']);
    expect(gestesDeLaListe('direction', e('J'))).toEqual(['annuler-resiliation', 'suspendre']);
    expect(gestesDeLaListe('direction', e('L'))).toEqual([]);
    expect(gestesDeLaListe('direction', e('M'))).toEqual(['retirer-offert']);
    expect(gestesDeLaListe('technique', e('I'))).toEqual([]);
  });
});

describe('Clients : une ligne par organisation (0110)', () => {
  // Un groupe que la console a déclaré : B (essai), G (en grâce), K (lecture seule depuis le 28/09) ; leur numéro et leur
  // ville ; un cabinet. Le reste : une ligne par entreprise, L en dossier tenu.
  const identites = new Map([[nom('B').id, { numero: 'E-0002', ville: 'Sfax' }], [nom('G').id, { numero: 'E-0007', ville: 'Sfax' }],
    [nom('K').id, { numero: 'E-0011', ville: null }], [nom('A').id, { numero: 'E-0001', ville: 'Sousse' }]]);
  const groupes = new Map([['g1', { numero: 'G-0001', nom: 'Groupe Essai', membres: [nom('B').id, nom('G').id, nom('K').id] }]]);
  const cabinet = { id: 'c1', nom: 'Cabinet Ennour', creeLe: '2026-01-01', associes: [{ nom: 'Sonia Associée', email: 'sonia@cabinet.tn' }], collaborateurs: 3,
    comptes: { client: 2, tenu: 1, en_attente: 0 }, derniereActivite: '2026-10-12T10:00:00Z' };
  const lignes = organisations(LISTE, JOUR, identites, groupes, [cabinet], new Map([['c1', 'C-0001']]));
  const ligne = (id: string) => lignes.find((o) => o.id === id);

  it('un groupe réunit ses sociétés, la plus urgente d\'abord par l\'urgence de la liste ; chaque autre entreprise a sa ligne ; le cabinet en dernier', () => {
    expect(lignes).toHaveLength(13 - 3 + 1 + 1);
    const g = ligne('g1');
    expect(g).toMatchObject({ sorte: 'groupe', numero: 'G-0001', nom: 'Groupe Essai', ville: 'Sfax' });
    // G, en grâce, passe devant B, dont l'essai finit dans deux jours, et devant K, en lecture seule depuis quinze jours
    // (plus rien ne presse) : le groupe dit « en retard ».
    expect(lettres(g?.societes ?? [])).toBe('GBK');
    expect(categorieOrg(g as Organisation)).toBe('en_retard');
    expect(ligne(nom('A').id)).toMatchObject({ sorte: 'entreprise', numero: 'E-0001', ville: 'Sousse' });
    expect(ligne(nom('L').id)?.sorte).toBe('tenu');
    expect(lignes.at(-1)).toMatchObject({ id: 'c1', sorte: 'cabinet', numero: 'C-0001', societes: [] });
    expect(categorieOrg(lignes.at(-1) as Organisation)).toBe('hors');
    // Par l'urgence de la liste, le groupe se range avec ce qui est en grâce, et le cabinet, sans échéance, en bas.
    const ordre = trierOrg(lignes, 'urgence', R, JOUR);
    expect(ordre.findIndex((o) => o.id === 'g1')).toBeLessThan(ordre.findIndex((o) => o.id === nom('A').id));
    expect(ordre.at(-1)?.id).toBe('c1');
  });

  it('une vue garde une ligne quand une de ses sociétés y est ; les filtres et leurs comptes portent sur des lignes (C3)', () => {
    const dans = (v: (typeof VUES_CLIENTS)[number]) => lignes.filter((o) => orgDansLaVue(o, v, JOUR)).map((o) => o.nom.charAt(0)).join('');
    // L'argent attendu : F seule, et le groupe (G y est). À appeler : A, C, E — pas le groupe (B a servi).
    expect(dans('argent')).toBe('GF');
    expect(dans('a_appeler')).toBe('ACE');
    expect(dans('tenus')).toBe('L');
    expect(lignes.filter((o) => orgDansLaVue(o, 'tout', JOUR))).toHaveLength(lignes.length);
    const f = lireFiltresOrg({ type: 'groupes', offre: 'nimporte' });
    expect(f).toEqual({ type: 'groupes', offre: null, cabinet: null });
    expect(lignes.filter((o) => orgDansLesFiltres(o, f)).map((o) => o.id)).toEqual(['g1']);
    // Complet : le groupe (K) et I. Chaque compte d'option refait la liste qu'il ouvre.
    const o = optionsDesFiltresOrg(lignes, lireFiltresOrg({}));
    expect(o.type).toEqual({ seules: 9, groupes: 1, tenues: 1, cabinets: 1 });
    expect(lignes.filter((x) => orgDansLesFiltres(x, lireFiltresOrg({ offre: 'complet' }))).map((x) => x.nom.charAt(0))).toEqual(['G', 'I']);
    expect(o.offre.complet).toBe(2);
    for (const c of o.cabinet) expect(lignes.filter((x) => orgDansLesFiltres(x, lireFiltresOrg({ cabinet: c.nom })))).toHaveLength(c.n);
    expect(lignes.filter((x) => orgDansLesFiltres(x, lireFiltresOrg({ cabinet: SANS_CABINET })))).toHaveLength(o.sansCabinet);
    expect(o.cabinet.map((c) => c.nom)).toContain('Cabinet Ennour');
  });

  it('la recherche lit la ligne et ses sociétés : la ville, un numéro de société, l\'associé d\'un cabinet ; sans accents ni casse', () => {
    expect(chercherOrg(lignes, 'SFAX', identites).map((o) => o.id)).toEqual(['g1']);
    expect(chercherOrg(lignes, 'e-0007', identites).map((o) => o.id)).toEqual(['g1']);
    expect(chercherOrg(lignes, 'sonia associee', identites).map((o) => o.id)).toEqual(['c1']);
    expect(chercherOrg(lignes, 'sousse essai', identites).map((o) => o.id)).toEqual([nom('A').id]);
  });

  it('ce qu\'une ligne rapporte est la somme de ses sociétés, payé et attendu à part ; son usage, la somme des pièces du mois', () => {
    // G : Essentiel à l'année, échue, pas payée : 390,000 attendus ; K, Complet au mois, non renouvelé : 12 × 69,000 =
    // 828,000 attendus ; B, à l'essai sans offre : rien. Rien de payé.
    expect(parAnDeLaLigne(ligne('g1') as Organisation, R)).toEqual({ actif: 0n, attendu: 390000n + 828000n });
    expect(parAnDeLaLigne(ligne(nom('I').id) as Organisation, R)).toEqual({ actif: BigInt(parAn(nom('I'), R)?.montantHt.replace('.', '') ?? '0'), attendu: 0n });
    const avec = organisations(avecEnPlus(LISTE, new Map([[nom('B').id, { piecesMois: 4, essaiJours: 30, prolonge: 0, prolongeUneFois: false, attend: null }],
      [nom('G').id, { piecesMois: 3, essaiJours: null, prolonge: 0, prolongeUneFois: false, attend: null }]])), JOUR, identites, groupes, [], new Map());
    expect(usageDeLaLigne(avec.find((o) => o.id === 'g1') as Organisation)).toBe(7);
    // La dernière activité d'un groupe : la plus récente de ses sociétés.
    expect(vuDeLaLigne(ligne('g1') as Organisation)).toBe('2026-10-12T09:00:00.000Z');
  });
});
