// Les échéances des abonnements et les cabinets, purs (serveur/console/echeances.ts, cabinets.ts ; docs/console.md ;
// skanfact docs/cadrage/10-console.md § 2.3, 2.4) : chaque carte compte la liste qu'elle ouvre ; ce qui vient dans les
// trente jours, ni plus ni moins ; une relance ne compte que pour l'échéance d'aujourd'hui ; un montant hors taxes au
// prix du jour, jamais inventé ; ce qui revient chaque année sans les résiliés ; un cabinet compte ce que sa fiche
// montre, et une entreprise dit la même chose sur la fiche de son cabinet. Les dates sont comptées à la main.

import { describe, expect, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { auPrix } from './au-prix.ts';
import { echeanceDe, etatAbonnement, plusJours, relanceDue } from '../../serveur/abonnement/etat.ts';
import { cabinetsDe, chercherCabinets, ficheCabinet, ligneCabinet, lireCabinets } from '../../serveur/console/cabinets.ts';
import { lireEntreprises } from '../../serveur/console/decider.ts';
import { annuel, cartes, lignesEcheances, lireExtras, lirePrix, lireRemisesEcheances, relancesDe, relancesRecentes, vue, VUES, type LigneEcheance } from '../../serveur/console/echeances.ts';

const JOUR = '2026-10-13';
let n = 0;
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
// Une entreprise telle que la base la rend (plateforme.console_entreprises).
function entreprise(nom: string, faits: Record<string, unknown>, autre: Record<string, unknown> = {}) {
  n++;
  return {
    id: id(n), raisonSociale: nom, matricule: null, active: true, creeLe: '2026-08-01',
    organisation: { id: 'o', type: 'independant', nom }, tenuePar: null, proprietaire: null, membres: 1, derniereActivite: null, pieces: 3,
    faits: { connu: true, essaiJusquAu: '2026-09-01', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null, suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  };
}
// Les prix du 28/09/2026, hors taxes, en millimes (plateforme.prix_du_jour).
const PRIX = [
  { offre: 'essentiel', periodicite: 'annuel', montantHt: '390000' }, { offre: 'essentiel', periodicite: 'mensuel', montantHt: '39000' },
  { offre: 'complet', periodicite: 'annuel', montantHt: '690000' }, { offre: 'complet', periodicite: 'mensuel', montantHt: '69000' },
];

// Un portefeuille : chaque état, chaque cas de bord.
const A = entreprise('A · essai qui finit dans 2 jours', { essaiJusquAu: '2026-10-15' });
const B = entreprise('B · essai qui finit dans 30 jours', { essaiJusquAu: '2026-11-12' });
const C = entreprise('C · essai qui finit dans 31 jours', { essaiJusquAu: '2026-11-13' });
const D = entreprise('D · Essentiel au mois', { payeJusquAu: '2026-10-20', offre: 'essentiel', periodicite: 'mensuel' });
const E = entreprise('E · Complet à l\'année', { payeJusquAu: '2027-05-01', offre: 'complet', periodicite: 'annuel' });
const F = entreprise('F · résilié', { payeJusquAu: '2026-10-25', offre: 'essentiel', periodicite: 'annuel', resilieLe: '2026-10-01' });
const G = entreprise('G · essai fini, en grâce', { essaiJusquAu: '2026-10-10' });
const H = entreprise('H · non renouvelé, en grâce', { payeJusquAu: '2026-10-08', offre: 'essentiel', periodicite: 'annuel' });
const I = entreprise('I · essai fini, lecture seule', { essaiJusquAu: '2026-09-20' });
const J = entreprise('J · non renouvelé, lecture seule', { payeJusquAu: '2026-10-01', offre: 'complet', periodicite: 'mensuel' });
const K = entreprise('K · suspendu', { essaiJusquAu: '2026-11-01', suspenduLe: '2026-10-12' });
const L = entreprise('L · offert', { offert: true });
const M = entreprise('M · tenu par un cabinet', { tenuParCabinet: true }, { tenuePar: 'Cabinet Nour' });
const N = entreprise('N · sans ligne', { connu: false, essaiJusquAu: null });
const TOUTES = [A, B, C, D, E, F, G, H, I, J, K, L, M, N];

const EXTRAS = {
  relances: [
    // A : relancée pour une ÉCHÉANCE PASSÉE (avant sa prolongation) : rien de parti pour celle d'aujourd'hui.
    { entreprise: A.id, echeance: '2026-10-01', rangs: { j15: '2026-09-16T07:00:00Z', j7: '2026-09-24T07:00:00Z', j1: '2026-09-30T07:00:00Z' } },
    { entreprise: D.id, echeance: '2026-10-20', rangs: { j15: '2026-10-05T07:00:00Z', j7: '2026-10-13T07:00:00Z' } },
    { entreprise: G.id, echeance: '2026-10-10', rangs: { j15: '2026-09-25T07:00:00Z', j7: '2026-10-03T07:00:00Z', j1: '2026-10-09T07:00:00Z' } },
    { entreprise: J.id, echeance: '2026-10-01', rangs: { j15: '2026-09-16T07:00:00Z', lecture_seule: '2026-10-09T07:00:00Z' } },
    // Une suspension ne se relance pas, même si une relance traîne pour son échéance.
    { entreprise: K.id, echeance: '2026-11-01', rangs: { j15: '2026-10-17T07:00:00Z' } },
  ],
  evenements: [
    { entreprise: A.id, nature: 'essai_prolonge', le: '2026-09-28T09:00:00Z', motif: 'il attend son comptable', jours: 14, qui: { nom: 'Nadia', role: 'support' } },
    // Une prolongation d'un essai fini ne se raconte plus : G est en grâce.
    { entreprise: G.id, nature: 'essai_prolonge', le: '2026-09-01T09:00:00Z', motif: 'déménagement', jours: 7, qui: null },
    { entreprise: L.id, nature: 'offert', le: '2026-10-02T09:00:00Z', motif: 'pilote jusqu\'au 31/12/2026', jours: null, qui: { nom: 'Skander', role: 'direction' } },
    // Un « offert » retiré depuis ne se raconte plus : E paie.
    { entreprise: E.id, nature: 'offert', le: '2026-05-01T09:00:00Z', motif: 'salon', jours: null, qui: null },
    { entreprise: K.id, nature: 'suspendu', le: '2026-10-12T09:00:00Z', motif: 'chèque sans provision', jours: null, qui: { nom: 'Skander', role: 'direction' } },
  ],
};

const liste = lireEntreprises(TOUTES, JOUR, REGLES_DE_DEPART);
// Ce que chaque prochaine facture dira, par la règle de la facture, à ces prix-là.
const R = auPrix(liste, JOUR, lirePrix(PRIX));
const lignes = lignesEcheances(liste, lireExtras(EXTRAS), R, JOUR);
const nomsDe = (l: LigneEcheance[]) => l.map((x) => x.entreprise.nom);
const de = (e: { id: string }) => lignes.find((l) => l.entreprise.id === e.id) as LigneEcheance;

describe('les échéances des abonnements', () => {
  it('ce qui vient dans les trente jours, aujourd\'hui compris : la fin d\'un essai, la fin d\'une période payée, rien d\'autre', () => {
    // C finit dans 31 jours, E dans plus de six mois ; la grâce, la lecture seule et ce qui n'a pas d'échéance ont leur vue.
    expect(nomsDe(vue(lignes, 'avenir', JOUR))).toEqual([A, D, F, B].map((e) => e.raisonSociale));
  });

  it('une vue par état, chacune rangée : la plus proche d\'abord, la lecture seule la plus récente d\'abord', () => {
    expect(nomsDe(vue(lignes, 'essai', JOUR))).toEqual([A, B, C].map((e) => e.raisonSociale));
    expect(nomsDe(vue(lignes, 'actif', JOUR))).toEqual([D, F, E].map((e) => e.raisonSociale));
    // La lecture seule tombe le 16/10 pour H (échéance du 08/10, sept jours de grâce), le 18/10 pour G (le 10/10).
    expect(vue(lignes, 'en_retard', JOUR).map((l) => [l.entreprise.nom, l.date])).toEqual([[H.raisonSociale, '2026-10-16'], [G.raisonSociale, '2026-10-18']]);
    expect(vue(lignes, 'lecture_seule', JOUR).map((l) => [l.entreprise.nom, l.date])).toEqual([[K.raisonSociale, '2026-10-12'], [J.raisonSociale, '2026-10-09'], [I.raisonSociale, '2026-09-28']]);
    expect(nomsDe(vue(lignes, 'hors', JOUR))).toEqual([L, M, N].map((e) => e.raisonSociale));
  });

  it('chaque carte compte la liste qu\'elle ouvre, et les cinq états refont le portefeuille', () => {
    const c = cartes(lignes, JOUR);
    for (const v of VUES) expect(c[v].n, v).toBe(vue(lignes, v, JOUR).length);
    expect(c.essai.n + c.actif.n + c.en_retard.n + c.lecture_seule.n + c.hors.n).toBe(TOUTES.length);
    expect(c).toEqual({
      avenir: { n: 4, essais: 2 },
      // Dans la semaine : A (2 jours) ; B et C sont loin.
      essai: { n: 3, semaine: 1 },
      actif: { n: 3, essentiel: 2, complet: 1, resilies: 1 },
      en_retard: { n: 2, du: '2026-10-16', au: '2026-10-18' },
      // Cette semaine : K (depuis hier) et J (depuis le 09/10) ; I depuis quinze jours.
      lecture_seule: { n: 3, semaine: 2 },
      hors: { n: 3, offert: 1, tenu_par_cabinet: 1, inconnu: 1 },
    });
  });

  it('le montant, hors taxes : celui de la prochaine facture, jamais pour un essai, une résiliation ou une suspension', () => {
    expect(Object.fromEntries(lignes.map((l) => [l.entreprise.nom.slice(0, 1), l.montantHt]))).toEqual({
      A: null, B: null, C: null, D: '39.000', E: '690.000', F: null, G: null, H: '390.000', I: null, J: '69.000', K: null, L: null, M: null, N: null,
    });
    // Un prix qui manque ne s'invente pas.
    const sansComplet = lignesEcheances(liste, lireExtras(EXTRAS), auPrix(liste, JOUR, lirePrix(PRIX.filter((p) => p.offre !== 'complet'))), JOUR);
    expect(sansComplet.find((l) => l.entreprise.id === J.id)?.montantHt).toBeNull();
  });

  it('ce qui revient chaque année : les actifs qui se renouvellent, le mensuel compté douze fois, sans les résiliés', () => {
    // D : 39,000 × 12 = 468,000 ; E : 690,000. F est résilié.
    expect(annuel(lignes, R)).toEqual({ montantHt: '1158.000', abonnements: 2, mensuels: 1, resilies: 1, sansPrix: 0 });
    // Sans le prix du Complet à l'année, E se compte à part, il ne vaut pas zéro en silence.
    expect(annuel(lignes, auPrix(liste, JOUR, lirePrix(PRIX.filter((p) => !(p.offre === 'complet' && p.periodicite === 'annuel')))))).toEqual({ montantHt: '468.000', abonnements: 1, mensuels: 1, resilies: 1, sansPrix: 1 });
  });

  it('la remise de la prochaine période (0106) : déduite du montant et du revenu annuel, et dite ; jamais pour qui n\'a pas de montant', () => {
    const remises = lireRemisesEcheances({ [D.id]: { nature: 'groupe', taux: 17, groupe: 'Famille' }, [E.id]: { nature: 'cabinet', taux: 15, cabinet: 'Cabinet' },
      [A.id]: { nature: 'groupe', taux: 20, groupe: 'Famille' }, [H.id]: { nature: 'parrainage', taux: 10 } });
    const RR = auPrix(liste, JOUR, lirePrix(PRIX), remises);
    const avec = lignesEcheances(liste, lireExtras(EXTRAS), RR, JOUR);
    const ligne = (e: { id: string }) => avec.find((l) => l.entreprise.id === e.id);
    // D : 39,000 − 17 % (6,630) = 32,370 ; E : 690,000 − 15 % (103,500) = 586,500 ; H : une remise illisible ne s'applique pas.
    expect([ligne(D), ligne(E), ligne(H), ligne(A)].map((l) => [l?.montantHt, l?.remise])).toEqual([
      ['32.370', { nature: 'groupe', taux: 17 }], ['586.500', { nature: 'cabinet', taux: 15 }], ['390.000', null], [null, null]]);
    // Chaque année : 32,370 × 12 + 586,500 = 974,940.
    expect(annuel(avec, RR)).toEqual({ montantHt: '974.940', abonnements: 2, mensuels: 1, resilies: 1, sansPrix: 0 });
  });

  it('une relance ne compte que pour l\'échéance d\'aujourd\'hui ; ni une résiliation, ni une suspension ne se relancent', () => {
    // A a été relancée pour son ancienne échéance : rien n'est parti pour celle du 15/10. Deux jours avant elle, c'est
    // celle des sept jours qui part (son jour est passé, et rien de plus pressant n'est parti) ; celle des quinze jours
    // est sautée ; la veille viendra demain.
    expect(de(A).relances).toEqual([
      { rang: 'j15', prevueLe: '2026-09-30', partieLe: null, etat: 'sautee' }, { rang: 'j7', prevueLe: '2026-10-08', partieLe: null, etat: 'a_partir' },
      { rang: 'j1', prevueLe: '2026-10-14', partieLe: null, etat: 'prevue' },
    ]);
    expect(de(D).relances).toEqual([
      { rang: 'j15', prevueLe: '2026-10-05', partieLe: '2026-10-05T07:00:00Z', etat: 'partie' }, { rang: 'j7', prevueLe: '2026-10-13', partieLe: '2026-10-13T07:00:00Z', etat: 'partie' },
      { rang: 'j1', prevueLe: '2026-10-19', partieLe: null, etat: 'prevue' },
    ]);
    // En grâce : les trois d'avant l'échéance, puis celle de la lecture seule, à venir.
    expect(de(G).relances.map((r) => [r.rang, r.prevueLe, r.etat])).toEqual([
      ['j15', '2026-09-25', 'partie'], ['j7', '2026-10-03', 'partie'], ['j1', '2026-10-09', 'partie'], ['lecture_seule', '2026-10-18', 'prevue'],
    ]);
    // H, en grâce, n'a jamais été relancée : l'échéance du 08/10 est passée, les trois ne partiront plus ; la lecture
    // seule tombe le 16/10, et sa relance avec elle.
    expect(de(H).relances.map((r) => [r.rang, r.etat])).toEqual([['j15', 'manquee'], ['j7', 'manquee'], ['j1', 'manquee'], ['lecture_seule', 'prevue']]);
    // I est en lecture seule depuis le 28/09 sans que sa relance soit partie : le serveur ne l'examine que le jour même.
    expect(de(I).relances).toEqual([{ rang: 'lecture_seule', prevueLe: '2026-09-28', partieLe: null, etat: 'manquee' }]);
    expect(de(J).relances).toEqual([{ rang: 'lecture_seule', prevueLe: '2026-10-09', partieLe: '2026-10-09T07:00:00Z', etat: 'partie' }]);
    expect(de(F).relances).toEqual([]);
    expect(de(K).relances).toEqual([]);
    expect(de(L).relances).toEqual([]);
  });

  it('ce que l\'écran dit d\'une relance est ce que le serveur fera : jour après jour, celle qui est « à partir » est celle qui part', () => {
    // Deux chemins, une réponse : `relancesDe` (ce que la console dit) et `relanceDue` (ce que le passage horaire envoie,
    // sur ce que plateforme.relances_a_examiner lui donne : les entreprises actives dont l'échéance est à moins de quinze
    // jours devant ou de huit jours derrière). Chaque entreprise du portefeuille, une désactivée en plus, depuis des
    // départs différents (une console ouverte au milieu d'une échéance), jusqu'à la fin de l'année.
    const desactivee = entreprise('P · désactivée', { essaiJusquAu: '2026-10-20' }, { active: false });
    for (const [e] of [...TOUTES, desactivee].map((x) => lireEntreprises([x], JOUR, REGLES_DE_DEPART))) {
      if (!e) throw new Error('entreprise illisible');
      for (let depart = '2026-09-01'; depart <= '2026-11-20'; depart = plusJours(depart, 3)) {
        const parties: { echeance: string; rang: string; le: string }[] = [];
        for (let jour = depart; jour <= '2026-12-31'; jour = plusJours(jour, 1)) {
          const echeance = echeanceDe(e.faits);
          const rangs = Object.fromEntries(parties.filter((p) => p.echeance === echeance).map((p) => [p.rang, p.le]));
          const dites = relancesDe(etatAbonnement(e.faits, jour), e.faits, echeance ? { echeance, rangs } : undefined, jour, e.active);
          const examinee = e.active && echeance !== null && echeance >= plusJours(jour, -8) && echeance <= plusJours(jour, 15);
          const due = examinee ? relanceDue(e.faits, jour, parties) : null;
          expect(dites.filter((r) => r.etat === 'a_partir').map((r) => r.rang), `${e.raisonSociale}, depuis le ${depart}, le ${jour}`).toEqual(due ? [due.rang] : []);
          if (due) parties.push({ echeance: due.echeance, rang: due.rang, le: `${jour}T07:00:00Z` });
        }
      }
    }
  });

  it('ce qui se raconte : la prolongation d\'un essai en cours, un « offert » qui l\'est encore, une suspension qui dure', () => {
    expect(de(A).prolongation).toEqual({ le: '2026-09-28T09:00:00Z', motif: 'il attend son comptable', jours: 14, qui: { nom: 'Nadia', role: 'support' } });
    expect(de(G).prolongation).toBeNull();
    expect(de(L).offert?.motif).toBe('pilote jusqu\'au 31/12/2026');
    expect(de(E).offert).toBeNull();
    expect(de(K).suspension?.motif).toBe('chèque sans provision');
    expect(de(J).suspension).toBeNull();
  });

  it('ce que la base rend d\'illisible vaut « rien », jamais une valeur devinée', () => {
    const e = lireExtras({ relances: [{ entreprise: 3 }, { entreprise: A.id, echeance: '2026-10-15', rangs: { j15: 12, j7: '2026-10-08T07:00:00Z', autre: 'x' } }], evenements: [{ nature: 'paye', entreprise: A.id, le: 'x' }] });
    expect([...e.relances.entries()]).toEqual([[A.id, { echeance: '2026-10-15', rangs: { j7: '2026-10-08T07:00:00Z' } }]]);
    expect(e.prolongation.size + e.offert.size + e.suspension.size).toBe(0);
    expect(lireExtras(null).relances.size).toBe(0);
    expect(lirePrix([{ offre: 'essentiel', periodicite: 'annuel', montantHt: '390,000' }]).size).toBe(0);
  });
});

describe('les relances prévues, selon la règle du jour (0104)', () => {
  it('celles de la règle du jour ; une relance partie sous une autre règle reste dite', () => {
    const regles = { ...REGLES_DE_DEPART, relances: [{ aPartirDu: '2000-01-01', jours: [10, 3] }] };
    const [e] = lireEntreprises([entreprise('Z · essai qui finit dans 12 jours', { essaiJusquAu: '2026-10-25' })], JOUR, regles);
    if (!e) throw new Error('entreprise attendue');
    // Celle des quinze jours est partie le 10/10, sous la règle d'avant : elle reste dite ; dix et trois jours sont prévues.
    const r = relancesDe(e.etat, e.faits, { echeance: '2026-10-25', rangs: { j15: '2026-10-10T08:00:00Z' } }, JOUR);
    expect(r.map((x) => [x.rang, x.prevueLe, x.etat])).toEqual([['j15', '2026-10-10', 'partie'], ['j10', '2026-10-15', 'prevue'], ['j3', '2026-10-22', 'prevue']]);
    // Aucune règle : aucune relance prévue (une règle qu'on ne connaît pas ne fait rien).
    const [sans] = lireEntreprises([entreprise('Y · essai sans règle', { essaiJusquAu: '2026-10-25' })], JOUR, { ...REGLES_DE_DEPART, relances: [] });
    if (!sans) throw new Error('entreprise attendue');
    expect(relancesDe(sans.etat, sans.faits, undefined, JOUR)).toEqual([]);
  });
});

describe('les cabinets', () => {
  const T1 = entreprise('Épicerie Ben Ali', { tenuParCabinet: true }, { tenuePar: 'Cabinet Nour' });
  const C1 = entreprise('Boulangerie Essalem', { essaiJusquAu: '2026-10-30' });
  const C2 = entreprise('Atelier Mejri', { payeJusquAu: '2027-01-10', offre: 'complet', periodicite: 'annuel' });
  const P1 = entreprise('Pharmacie Ennour', { essaiJusquAu: '2026-10-20' });
  const entreprises = lireEntreprises([T1, C1, C2, P1], JOUR, REGLES_DE_DEPART);
  const BRUT = [{
    id: id(901), nom: 'Cabinet Nour', creeLe: '2026-09-20',
    collaborateurs: [
      { nom: 'Sonia', email: 'sonia@cabinet-nour.tn', roles: ['supervision'], depuis: '2026-09-20T08:00:00Z', derniereConnexion: '2026-10-12T08:00:00Z' },
      { nom: 'Rim', email: 'rim@cabinet-nour.tn', roles: ['revision'], depuis: '2026-09-22T08:00:00Z', derniereConnexion: '2026-10-13T07:30:00Z' },
    ],
    dossiers: [
      { entreprise: T1.id, tenu: true, mandat: { statut: 'actif', debut: '2026-09-22' } },
      { entreprise: C1.id, tenu: false, mandat: { statut: 'actif', debut: '2026-10-01' } },
      { entreprise: C2.id, tenu: false, mandat: { statut: 'actif', debut: '2026-09-25' } },
      { entreprise: P1.id, tenu: false, mandat: { statut: 'propose', debut: '2026-10-12' } },
      // Une entreprise que la liste des clients ne connaît pas : ni comptée, ni montrée.
      { entreprise: id(999), tenu: false, mandat: { statut: 'actif', debut: '2026-10-01' } },
    ],
  }, { id: id(902), nom: 'Cabinet Ennakhil', creeLe: '2026-10-05', collaborateurs: [], dossiers: [] }];
  const cabinets = lireCabinets(BRUT);
  const [nour, ennakhil] = cabinets;
  if (!nour || !ennakhil) throw new Error('deux cabinets attendus');
  const connues = new Set(entreprises.map((e) => e.id));

  it('la liste compte ce que la fiche montre : les clients abonnés, les dossiers tenus, ceux qui attendent son accord', () => {
    const [ligne] = cabinets.map((c) => ligneCabinet(c, connues));
    expect(ligne).toMatchObject({ nom: 'Cabinet Nour', collaborateurs: 2, comptes: { client: 2, tenu: 1, en_attente: 1 }, associes: [{ nom: 'Sonia', email: 'sonia@cabinet-nour.tn' }] });
    // Sa dernière activité : la plus récente de ses collaborateurs.
    expect(ligne?.derniereActivite).toBe('2026-10-13T07:30:00Z');
    const fiche = ficheCabinet(nour, entreprises);
    expect(fiche.comptes).toEqual(ligne?.comptes);
    // Les clients d'abord, puis les dossiers tenus, puis ceux qui attendent ; par nom.
    expect(fiche.dossiers.map((d) => [d.place, d.entreprise.raisonSociale])).toEqual([
      ['client', 'Atelier Mejri'], ['client', 'Boulangerie Essalem'], ['tenu', 'Épicerie Ben Ali'], ['en_attente', 'Pharmacie Ennour'],
    ]);
    // Un cabinet sans rien n'invente rien.
    expect(ligneCabinet(ennakhil, connues)).toMatchObject({ collaborateurs: 0, comptes: { client: 0, tenu: 0, en_attente: 0 }, associes: [], derniereActivite: null });
  });

  it('une entreprise dit la même chose sur la fiche de son cabinet et dans la liste des clients ; et la fiche du client nomme ce cabinet', () => {
    const fiche = ficheCabinet(nour, entreprises);
    for (const d of fiche.dossiers) {
      const e = entreprises.find((x) => x.id === d.entreprise.id);
      expect(d.entreprise.etat).toEqual(e?.etat);
      expect(d.entreprise.faits).toEqual(e?.faits);
    }
    // Rien de plus qu'une ligne de la liste fermée : jamais le propriétaire ni ses membres, ici.
    expect(Object.keys(fiche.dossiers[0]?.entreprise ?? {}).sort()).toEqual(['creeLe', 'derniereActivite', 'etat', 'faits', 'id', 'matricule', 'pieces', 'raisonSociale']);
    expect(cabinetsDe(C1.id, cabinets)).toEqual([{ id: id(901), nom: 'Cabinet Nour', place: 'client', mandat: { statut: 'actif', debut: '2026-10-01' } }]);
    expect(cabinetsDe(T1.id, cabinets).map((c) => c.place)).toEqual(['tenu']);
    expect(cabinetsDe(P1.id, cabinets).map((c) => c.place)).toEqual(['en_attente']);
    expect(cabinetsDe(id(12345), cabinets)).toEqual([]);
  });

  it('chercher un cabinet : son nom, un associé, sans les accents ni la casse', () => {
    const lignesC = cabinets.map((c) => ligneCabinet(c, connues));
    expect(chercherCabinets(lignesC, 'ennakhil').map((c) => c.nom)).toEqual(['Cabinet Ennakhil']);
    expect(chercherCabinets(lignesC, 'SONIA@').map((c) => c.nom)).toEqual(['Cabinet Nour']);
    expect(chercherCabinets(lignesC, '').length).toBe(2);
    expect(lireCabinets(null)).toEqual([]);
  });
});

describe('les relances parties depuis hier (l\'accueil)', () => {
  it('celles des vingt-quatre dernières heures, nommées, la plus récente d\'abord ; ni avant, ni après l\'heure qu\'il est', () => {
    const maintenant = new Date('2026-10-13T08:00:00Z');
    const liste = lireEntreprises([A, B, D, G], JOUR, REGLES_DE_DEPART);
    const extras = lireExtras({ relances: [
      // A : la veille de la fin de son essai, partie cette nuit ; sa relance des sept jours, partie il y a six jours.
      { entreprise: A.id, echeance: '2026-10-15', rangs: { j7: '2026-10-07T07:00:00Z', j1: '2026-10-13T03:00:00Z' } },
      // D : quinze jours avant, partie hier à 09:00 (moins de vingt-quatre heures) ; G : il y a vingt-quatre heures et une minute.
      { entreprise: D.id, echeance: '2026-10-20', rangs: { j15: '2026-10-12T09:00:00Z' } },
      { entreprise: G.id, echeance: '2026-10-10', rangs: { lecture_seule: '2026-10-12T07:59:00Z' } },
      // Une entreprise que la liste ne connaît pas (désactivée, hors du portefeuille lu) : rien à nommer.
      { entreprise: id(999), echeance: '2026-10-14', rangs: { j1: '2026-10-13T04:00:00Z' } },
      // Une heure dans le futur (horloge d'un autre serveur) : pas encore partie.
      { entreprise: B.id, echeance: '2026-11-12', rangs: { j15: '2026-10-13T09:00:00Z' } },
    ] });
    expect(relancesRecentes(liste, extras, maintenant)).toEqual([
      { entreprise: { id: A.id, nom: A.raisonSociale }, rang: 'j1', partieLe: '2026-10-13T03:00:00Z' },
      { entreprise: { id: D.id, nom: D.raisonSociale }, rang: 'j15', partieLe: '2026-10-12T09:00:00Z' },
    ]);
    expect(relancesRecentes(liste, lireExtras(null), maintenant)).toEqual([]);
  });
});
