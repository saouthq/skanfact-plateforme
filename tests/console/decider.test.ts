// L'accueil de la console, pur (serveur/console/decider.ts ; docs/console.md ; skanfact docs/cadrage/10-console.md § 2.1,
// 2.2) : une console où rien ne se passe affiche une liste vide ; ce qui demande une décision vient en tête, rangé par
// urgence ; rien n'est vert sans mesure ; chacun ne lit que ce que son rôle lui ouvre.

import { describe, expect, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { aDecider, chercher, lireEntreprises, lireVeille, rangerParUrgence, tableau, type Veille } from '../../serveur/console/decider.ts';

const JOUR = '2026-10-13';
const MAINTENANT = new Date('2026-10-13T08:00:00Z');
let n = 0;
// Une entreprise telle que la base la rend : par défaut, un essai qui finit dans vingt jours, avec des pièces.
function ligne(faits: Record<string, unknown>, autre: Record<string, unknown> = {}) {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, raisonSociale: `Société ${n}`, matricule: null, active: true, creeLe: '2026-09-01',
    organisation: { id: 'o', type: 'independant', nom: `Société ${n}` }, tenuePar: null, proprietaire: { nom: `Proprio ${n}`, email: `p${n}@exemple.tn` },
    membres: 1, derniereActivite: null, pieces: 4,
    faits: { connu: true, essaiJusquAu: plusJours(JOUR, 20), payeJusquAu: null, offre: null, periodicite: null, resilieLe: null, suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  };
}
const veilleOk: Veille = { etat: 'ok', derniere: MAINTENANT.toISOString(), problemes: [] };

describe('« À décider »', () => {
  it('une console où rien ne se passe affiche une liste vide', () => {
    const liste = lireEntreprises([ligne({}), ligne({ payeJusquAu: plusJours(JOUR, 200), offre: 'complet', periodicite: 'annuel' })], JOUR, REGLES_DE_DEPART);
    expect(aDecider(liste, veilleOk, JOUR, 'direction')).toEqual([]);
    expect(aDecider([], { etat: 'absente' }, JOUR, 'direction')).toEqual([]);
  });

  it('la grâce, la lecture seule de la semaine et l\'essai sans usage, rangés par urgence', () => {
    const grace = ligne({ essaiJusquAu: plusJours(JOUR, -3) });
    const graceUrgente = ligne({ essaiJusquAu: plusJours(JOUR, -6) });
    const lectureSeule = ligne({ essaiJusquAu: plusJours(JOUR, -10) });
    const vieilleLecture = ligne({ essaiJusquAu: plusJours(JOUR, -40) });
    const suspendue = ligne({ suspenduLe: plusJours(JOUR, -1) });
    const sansUsage = ligne({ essaiJusquAu: plusJours(JOUR, 2) }, { pieces: 0 });
    const avecUsage = ligne({ essaiJusquAu: plusJours(JOUR, 2) });
    const sansUsageLoin = ligne({ essaiJusquAu: plusJours(JOUR, 9) }, { pieces: 0 });
    const liste = lireEntreprises([grace, graceUrgente, lectureSeule, vieilleLecture, suspendue, sansUsage, avecUsage, sansUsageLoin], JOUR, REGLES_DE_DEPART);
    const d = aDecider(liste, veilleOk, JOUR, 'direction');
    expect(d.map((l) => [l.sorte, 'entreprise' in l ? l.entreprise.nom : null])).toEqual([
      ['en_retard', graceUrgente.raisonSociale], ['en_retard', grace.raisonSociale], ['lecture_seule', lectureSeule.raisonSociale], ['essai_sans_usage', sansUsage.raisonSociale],
    ]);
    // Chaque ligne ouvre la fiche, et dit ce qu'il faut pour décider.
    expect(d[0]).toMatchObject({ ouvre: 'fiche', echeance: plusJours(JOUR, -6), lectureSeuleLe: plusJours(JOUR, 2), apresEssai: true });
    expect(d[3]).toMatchObject({ ouvre: 'fiche', jusquAu: plusJours(JOUR, 2), jours: 2, proprietaire: { nom: sansUsage.proprietaire.nom } });
  });

  it('la veille : absente, pas de ligne ; silencieuse, une ligne ; ses problèmes graves passent en tête', () => {
    const absente = lireVeille(null, null, MAINTENANT);
    expect(absente).toEqual({ etat: 'absente' });
    const silencieuse = lireVeille('{"problemes":{}}', new Date(MAINTENANT.getTime() - 6 * 60_000), MAINTENANT);
    expect(silencieuse.etat).toBe('silencieuse');
    const contenu = JSON.stringify({ problemes: {
      disque: { titre: 'Le disque est plein à 80 %', grave: false, faire: 'Libère de la place.', depuis: '2026-10-13T07:00:00Z' },
      sauvegarde: { titre: 'La sauvegarde de la nuit manque', grave: true, faire: 'Relance-la.', depuis: '2026-10-13T07:30:00Z' },
    } });
    const ok = lireVeille(contenu, new Date(MAINTENANT.getTime() - 60_000), MAINTENANT);
    const liste = lireEntreprises([ligne({ essaiJusquAu: plusJours(JOUR, -2) })], JOUR, REGLES_DE_DEPART);
    expect(aDecider(liste, absente, JOUR, 'direction').map((l) => l.sorte)).toEqual(['en_retard']);
    expect(aDecider(liste, silencieuse, JOUR, 'direction').map((l) => l.sorte)).toEqual(['veille_silencieuse', 'en_retard']);
    expect(aDecider(liste, ok, JOUR, 'direction').map((l) => (l.sorte === 'service' ? l.cle : l.sorte))).toEqual(['sauvegarde', 'en_retard', 'disque']);
  });

  it('un problème de la veille qui n\'est pas encore confirmé ne se montre pas (la page d\'état et la base le taisent aussi)', () => {
    const fichier = (vus: number | undefined) => JSON.stringify({ problemes: {
      service: { titre: 'SkanFact ne répond plus', grave: true, faire: '', depuis: '2026-10-13T07:59:00Z', ...(vus === undefined ? {} : { vus, ditLe: null }) },
      disque: { titre: 'Le disque est plein à 80 %', grave: false, faire: '', depuis: '2026-10-13T07:00:00Z', vus: 1, ditLe: '2026-10-13T07:00:00Z' },
    } });
    const cles = (contenu: string) => { const v = lireVeille(contenu, MAINTENANT, MAINTENANT); return v.etat === 'ok' ? v.problemes.map((p) => p.cle) : null; };
    // Une seule minute sans réponse : un redémarrage, pas une panne (exploitation/veille.ts, CONFIRMATIONS).
    expect(cles(fichier(1))).toEqual(['disque']);
    expect(cles(fichier(2))).toEqual(['service', 'disque']);
    // Un fichier qui ne compte pas les relevés dit ses problèmes tels quels.
    expect(cles(fichier(undefined))).toEqual(['service', 'disque']);
  });

  it('la technique ne lit que le service ; le support, que les clients', () => {
    const ok = lireVeille(JSON.stringify({ problemes: { disque: { titre: 'Disque', grave: true, faire: '', depuis: '' } } }), MAINTENANT, MAINTENANT);
    const liste = lireEntreprises([ligne({ essaiJusquAu: plusJours(JOUR, -2) })], JOUR, REGLES_DE_DEPART);
    expect(aDecider(liste, ok, JOUR, 'technique').map((l) => l.sorte)).toEqual(['service']);
    expect(aDecider(liste, ok, JOUR, 'support').map((l) => l.sorte)).toEqual(['en_retard']);
  });
});

describe('le tableau du matin', () => {
  it('rien n\'est vert sans mesure : ce que la console ne mesure pas encore se dit, avec sa raison', () => {
    const t = tableau([], { etat: 'absente' }, JOUR);
    // L'encaissé du mois (C30) : sans entreprise SkanFact désignée, rien ne s'encaisse par la plateforme — jamais un zéro.
    expect(t.revenusDuMois).toEqual({ mesure: false, raison: 'editeur_absent' });
    // Le support se mesure depuis la Support S1 : sans demande, des zéros (une mesure), et pas de « plus longue attente ».
    expect(t.support).toEqual({ ouvertes: 0, aRepondre: 0, sansReponse: 0, attenteMax: null });
    expect(t.service).toEqual({ etat: 'non_mesure', raison: 'pas_de_veille' });
    expect(tableau([], lireVeille('{}', new Date(MAINTENANT.getTime() - 10 * 60_000), MAINTENANT), JOUR).service).toMatchObject({ etat: 'non_mesure', raison: 'veille_silencieuse' });
    expect(tableau([], veilleOk, JOUR).service).toEqual({ etat: 'ok' });
  });

  it('chaque chiffre se compte comme la liste qu\'il ouvre', () => {
    const liste = lireEntreprises([
      ligne({}), ligne({}, { creeLe: plusJours(JOUR, -2) }),
      ligne({ payeJusquAu: plusJours(JOUR, 100), offre: 'complet', periodicite: 'annuel' }),
      ligne({ payeJusquAu: plusJours(JOUR, 10), offre: 'essentiel', periodicite: 'mensuel' }),
      ligne({ essaiJusquAu: plusJours(JOUR, -2) }), ligne({ essaiJusquAu: plusJours(JOUR, -20) }), ligne({ offert: true }),
    ], JOUR, REGLES_DE_DEPART);
    expect(tableau(liste, veilleOk, JOUR)).toMatchObject({
      entreprisesDeLaSemaine: 1, essais: 2, actifs: { total: 2, essentiel: 1, complet: 1 }, enRetard: 1, lectureSeule: 1,
    });
  });
});

describe('la liste des clients', () => {
  it('le plus urgent en haut, et une recherche sans accents ni casse', () => {
    const calme = ligne({}, { raisonSociale: 'Boulangerie Ennour' });
    const presse = ligne({ essaiJusquAu: plusJours(JOUR, 3) }, { raisonSociale: 'Quincaillerie El Amel' });
    const retard = ligne({ essaiJusquAu: plusJours(JOUR, -1) }, { raisonSociale: 'Société Générale de Négoce' });
    const liste = lireEntreprises([calme, presse, retard], JOUR, REGLES_DE_DEPART);
    expect(rangerParUrgence(liste, JOUR).map((e) => e.raisonSociale)).toEqual(['Société Générale de Négoce', 'Quincaillerie El Amel', 'Boulangerie Ennour']);
    expect(chercher(liste, 'societe NEGOCE').map((e) => e.raisonSociale)).toEqual(['Société Générale de Négoce']);
    expect(chercher(liste, presse.proprietaire.email).map((e) => e.raisonSociale)).toEqual(['Quincaillerie El Amel']);
  });
});

describe('« À décider » : l\'argent qui attend (0113)', () => {
  const a = ligne({ payeJusquAu: plusJours(JOUR, 200), offre: 'essentiel', periodicite: 'annuel' });
  const b = ligne({ payeJusquAu: plusJours(JOUR, 100), offre: 'complet', periodicite: 'mensuel' });
  const liste = lireEntreprises([a, b], JOUR, REGLES_DE_DEPART);
  const qui = (x: { id: string; raisonSociale: string }) => ({ id: x.id, nom: x.raisonSociale });
  const ecran = (piece: string) => `/v10/?e=ed#/doc/${piece}`;
  const argent = {
    // Payée, puis annulée par un avoir : elle a aussi un trop-perçu (plus bas), qui ne fait pas une seconde ligne.
    defaites: [{ piece: 'f1', numero: 'FAC-2026-001', payeeLe: '2026-09-02T10:00:00Z', debut: '2026-09-03', fin: '2026-10-02', entreprise: qui(b), ecran: ecran('f1'), cause: 'avoir' as const }],
    aEmettre: [
      // Préparée le 11/10 à 22 h 30 en UTC : le 11/10 à Tunis (23 h 30), deux jours avant le 13/10 — elle attend.
      { piece: 'f2', debut: '2026-10-20', fin: '2027-10-19', prepareLe: '2026-10-11T22:30:00Z', entreprise: qui(a), ecran: ecran('f2'), montantHt: null },
      // Le 11/10 à 23 h 30 en UTC, c'est déjà le 12/10 à Tunis : un jour seulement, elle n'attend pas encore.
      { piece: 'f3', debut: '2026-10-20', fin: '2026-11-19', prepareLe: '2026-10-11T23:30:00Z', entreprise: qui(b), ecran: ecran('f3'), montantHt: null },
    ],
    trop: [{ entreprise: qui(a), numero: 'FAC-2026-004', piece: 'f4', ecran: ecran('f4'), devise: 'TND', trop: '12.345', annulee: false },
      { entreprise: qui(b), numero: 'FAC-2026-001', piece: 'f1', ecran: ecran('f1'), devise: 'TND', trop: '47.410', annulee: true },
      // Une entreprise hors de la liste (une autre fiche) : sa ligne ne vient pas.
      { entreprise: { id: 'ailleurs', nom: 'Ailleurs' }, numero: null, piece: 'f5', ecran: ecran('f5'), devise: 'TND', trop: '1.000', annulee: true }],
  };

  it('la direction seule, pour les entreprises de la liste : payée puis défaite d\'abord, puis ce qui attend d\'être émis depuis deux jours, puis les trop-perçus', () => {
    const d = aDecider(liste, veilleOk, JOUR, 'direction', [], MAINTENANT, argent);
    expect(d.map((l) => [l.sorte, 'entreprise' in l ? l.entreprise.nom : null])).toEqual([
      ['facture_defaite', b.raisonSociale], ['a_emettre', a.raisonSociale], ['trop_percu', a.raisonSociale]]);
    expect(d.find((l) => l.sorte === 'a_emettre')).toMatchObject({ prepareLe: '2026-10-11', jours: 2, ecran: ecran('f2') });
    // La facture défaite par un avoir dit sa cause et ce qui est à rendre ; son trop-perçu n'a pas sa propre ligne.
    expect(d.find((l) => l.sorte === 'facture_defaite')).toMatchObject({ cause: 'avoir', trop: '47.410' });
    expect(aDecider(liste, veilleOk, JOUR, 'support', [], MAINTENANT, argent)).toEqual([]);
    expect(aDecider(liste, veilleOk, JOUR, 'technique', [], MAINTENANT, argent)).toEqual([]);
    // La fiche d'une entreprise : seulement les siennes.
    const seule = lireEntreprises([b], JOUR, REGLES_DE_DEPART);
    expect(aDecider(seule, { etat: 'absente' }, JOUR, 'direction', [], MAINTENANT, argent).map((l) => l.sorte)).toEqual(['facture_defaite']);
  });
});

describe('« À décider » : le renouvellement à facturer (1.83.0)', () => {
  it('un abonnement payé qui finit dans trente jours (dix pour un mois) sans facture pour la période suivante ; la direction seule', () => {
    const annuel = ligne({ payeJusquAu: plusJours(JOUR, 30), offre: 'complet', periodicite: 'annuel' });
    const annuelLoin = ligne({ payeJusquAu: plusJours(JOUR, 31), offre: 'complet', periodicite: 'annuel' });
    const mensuel = ligne({ payeJusquAu: plusJours(JOUR, 10), offre: 'essentiel', periodicite: 'mensuel' });
    const mensuelLoin = ligne({ payeJusquAu: plusJours(JOUR, 11), offre: 'essentiel', periodicite: 'mensuel' });
    const facturee = ligne({ payeJusquAu: plusJours(JOUR, 5), offre: 'complet', periodicite: 'annuel' });
    const resiliee = ligne({ payeJusquAu: plusJours(JOUR, 5), offre: 'complet', periodicite: 'annuel', resilieLe: plusJours(JOUR, -1) });
    const liste = lireEntreprises([annuel, annuelLoin, mensuel, mensuelLoin, facturee, resiliee], JOUR, REGLES_DE_DEPART);
    const qui = (x: { id: string; raisonSociale: string }) => ({ id: x.id, nom: x.raisonSociale });
    // Une facture préparée pour la période suivante éteint la ligne ; une facture d'une période déjà payée, non.
    const argent = { defaites: [], trop: [], aEmettre: [], facturees: [
      { entreprise: facturee.id, debut: plusJours(JOUR, 6) }, { entreprise: annuel.id, debut: plusJours(JOUR, -335) }] };
    const d = aDecider(liste, veilleOk, JOUR, 'direction', [], MAINTENANT, argent);
    expect(d.map((l) => [l.sorte, 'entreprise' in l ? l.entreprise.nom : null])).toEqual([['a_facturer', mensuel.raisonSociale], ['a_facturer', annuel.raisonSociale]]);
    expect(d[1]).toMatchObject({ ouvre: 'fiche', entreprise: qui(annuel), jusquAu: plusJours(JOUR, 30), jours: 30, offre: 'complet', periodicite: 'annuel' });
    // Le support ne facture pas ; sans l'argent de la direction, rien.
    expect(aDecider(liste, veilleOk, JOUR, 'support', [], MAINTENANT, argent)).toEqual([]);
    // Un client qui part n'en reçoit pas.
    const partant = { ...argent, sorties: [{ entreprise: qui(annuel), close: null, contrat: { fin: null } }] } as unknown as Parameters<typeof aDecider>[6];
    expect(aDecider(liste, veilleOk, JOUR, 'direction', [], MAINTENANT, partant).map((l) => 'entreprise' in l ? l.entreprise.nom : null)).toEqual([mensuel.raisonSociale]);
  });
});
