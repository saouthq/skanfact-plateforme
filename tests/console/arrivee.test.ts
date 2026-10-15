// L'arrivée d'un nouveau client, pure (serveur/console/arrivee.ts ; docs/console.md C50) : cinq marches lues dans ce que
// la console sait déjà ; une marche a son délai compté depuis l'inscription, et c'est la PREMIÈRE marche manquante qui
// bloque, le lendemain de son délai ; l'arrivée dure les trente premiers jours, celui de l'inscription compris, et un
// dossier qu'un cabinet tient n'arrive pas. Les jours sont comptés à la main.

import { describe, expect, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { arrivee, DELAIS, enArrivee } from '../../serveur/console/arrivee.ts';
import { avecEnPlus, comptesDesVues, dansLaVue, lireEnPlus } from '../../serveur/console/clients.ts';
import { lireEntreprises, type Entreprise } from '../../serveur/console/decider.ts';

const JOUR = '2026-10-13';
let n = 0;
// Une entreprise telle que la base la rend (plateforme.console_entreprises) : en essai, jamais ouverte, sans pièce, sauf
// mention contraire.
function nee(creeLe: string, autre: Record<string, unknown> = {}, faits: Record<string, unknown> = {}, premiereFactureLe: string | null = null): Entreprise {
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const [e] = lireEntreprises([{
    id, raisonSociale: `Née ${n}`, matricule: null, active: true, creeLe, organisation: { id: 'o', type: 'independant', nom: 'x' }, tenuePar: null,
    proprietaire: null, membres: 1, derniereActivite: null, pieces: 0,
    faits: { connu: true, essaiJusquAu: '2026-11-12', payeJusquAu: null, offre: null, periodicite: null, resilieLe: null, suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  }], JOUR, REGLES_DE_DEPART);
  if (!e) throw new Error('une entreprise attendue');
  return avecEnPlus([e], lireEnPlus({ [id]: { premiereFactureLe } }, JOUR))[0] as Entreprise;
}
const faites = (a: ReturnType<typeof arrivee>) => a.marches.filter((m) => m.faite).map((m) => m.id).join(',');

describe('L\'arrivée : les marches et leur délai', () => {
  it('inscrite aujourd\'hui : jour 0, une marche, la suivante est « ouverte », attendue dans deux jours', () => {
    const a = arrivee(nee('2026-10-13T08:00:00Z'), JOUR);
    expect(a.jours).toBe(0);
    expect(faites(a)).toBe('inscrite');
    expect(a.franchies).toBe(1);
    expect(a.suivante).toBe('ouverte');
    expect(a.bloquee).toBeNull();
    expect(a.marches.map((m) => m.avant)).toEqual([null, '2026-10-15', '2026-10-18', '2026-10-27', '2026-11-12']);
    expect(a.marches[0]?.le).toBe('2026-10-13');
  });

  it('jamais ouverte : le jour de son délai, pas encore bloquée ; le lendemain, bloquée depuis un jour', () => {
    expect(DELAIS.ouverte).toBe(2);
    expect(arrivee(nee('2026-10-11'), JOUR).bloquee).toBeNull();
    expect(arrivee(nee('2026-10-10'), JOUR).bloquee).toEqual({ marche: 'ouverte', depuis: 1 });
  });

  it('ouverte, une pièce, pas de facture émise au quinzième jour : bloquée à la première facture', () => {
    const a = arrivee(nee('2026-09-28', { derniereActivite: '2026-09-29T10:00:00Z', pieces: 2 }), JOUR);
    expect(a.jours).toBe(15);
    expect(faites(a)).toBe('inscrite,ouverte,premiere_piece');
    expect(a.bloquee).toEqual({ marche: 'premiere_facture', depuis: 1 });
  });

  it('sa première facture émise se lit au jour dit, et la marche suivante est l\'abonnement, pas encore en retard', () => {
    const a = arrivee(nee('2026-09-28', { derniereActivite: '2026-09-29T10:00:00Z', pieces: 2 }, {}, '2026-10-02'), JOUR);
    expect(faites(a)).toBe('inscrite,ouverte,premiere_piece,premiere_facture');
    expect(a.marches.find((m) => m.id === 'premiere_facture')?.le).toBe('2026-10-02');
    expect(a.suivante).toBe('abonnee');
    expect(a.bloquee).toBeNull();
  });

  it('abonnée et tout franchi : cinq marches, plus de suivante', () => {
    const a = arrivee(nee('2026-10-01', { derniereActivite: '2026-10-12T10:00:00Z', pieces: 4 },
      { payeJusquAu: '2027-10-01', offre: 'essentiel', periodicite: 'annuel' }, '2026-10-03'), JOUR);
    expect(a.franchies).toBe(5);
    expect(a.suivante).toBeNull();
    expect(a.bloquee).toBeNull();
  });

  it('payée avant sa première pièce : la marche manquante reste la suivante, celle d\'après comptée franchie', () => {
    const a = arrivee(nee('2026-10-01', { derniereActivite: '2026-10-02T10:00:00Z' },
      { payeJusquAu: '2027-10-01', offre: 'complet', periodicite: 'annuel' }), JOUR);
    expect(faites(a)).toBe('inscrite,ouverte,abonnee');
    expect(a.suivante).toBe('premiere_piece');
    // Douze jours, délai de cinq : bloquée depuis sept.
    expect(a.bloquee).toEqual({ marche: 'premiere_piece', depuis: 7 });
  });

  it('une première facture illisible vaut « rien », jamais une date devinée', () => {
    const a = arrivee(nee('2026-10-01', {}, {}, '2026-10-02T10:00:00Z'), JOUR);
    expect(a.marches.find((m) => m.id === 'premiere_facture')).toMatchObject({ faite: false, le: null });
  });
});

describe('L\'arrivée : les trente premiers jours, et la vue de la liste', () => {
  it('le trentième jour en est encore (jour 29), le trente et unième n\'en est plus', () => {
    expect(enArrivee(nee('2026-09-14'), JOUR)).toBe(true);
    expect(enArrivee(nee('2026-09-13'), JOUR)).toBe(false);
  });

  it('la vue garde les inscrites des trente jours, jamais un dossier qu\'un cabinet tient ; sa carte compte la même liste (C3)', () => {
    const liste = [nee('2026-10-13'), nee('2026-09-14'), nee('2026-09-13'), nee('2026-10-01', {}, { tenuParCabinet: true })];
    const dedans = liste.map((e) => dansLaVue(e, 'arrivees', JOUR));
    expect(dedans).toEqual([true, true, false, false]);
    expect(comptesDesVues(liste, JOUR).arrivees).toBe(2);
  });
});
