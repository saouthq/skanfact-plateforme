// L'ouverture d'une entreprise, au point de contact (web/public/plateforme/pont.js ; docs/leger.md, S2 ; 13/10/2026). Le
// point de contact tourne dans un bac à sable (tests/v10/bac-pont.ts), devant un serveur imité. Ce qu'il garantit :
//   - ce que la page attend avant son premier dessin sans dépendre du dossier part AVEC lui, avant la moindre réponse :
//     les questions du cabinet, les remises des appareils retirés, l'état de l'abonnement. Demandés l'un après l'autre,
//     ils coûtaient trois allers-retours, et la seconde ouverture dépassait 2 s sur une connexion lente (2,23 s sur
//     GitHub) ;
//   - l'état de l'abonnement lu avec le dossier sert la première lecture de la v10 (`licenceStatus`, juste avant son
//     premier dessin), une fois ; les suivantes (chaque heure, au retour au premier plan) redemandent ;
//   - une lecture restée sans réponse ne passe pas pour l'état (la v10 redemande), ni une lecture trop ancienne (plus de
//     quinze secondes : l'assistant d'une première ouverture peut durer).
// Le même parcours dans un vrai navigateur, sur une connexion lente : tests/web/leger.test.ts (S2).

import { describe, expect, it } from 'vitest';
import { chargerPont, type Reponse, type Routes } from './bac-pont.ts';

const ENT = '00000000-0000-4000-8000-0000000000a1';
type Pont = { loadData: () => Promise<unknown>; licenceStatus: (matricule?: string) => Promise<unknown> };

const DOSSIER = `GET /v1/entreprises/${ENT}/dossier-v10`;
const QUESTIONS = `GET /v1/entreprises/${ENT}/compta/questions`;
const REMISES = `GET /v1/entreprises/${ENT}/quarantaine`;
const ABONNEMENT = `GET /v1/entreprises/${ENT}/abonnement/etat`;
const compte: Routes = { 'GET /v1/moi': () => ({ statut: 200, corps: { email: 'nadia@exemple.tn', entreprises: [{ id: ENT, essai: false }] } }) };
// Une vraie entreprise au travail : sa fiche et un devis (elle ne fait pas lire le compte).
const entreprise: Routes = {
  ...compte,
  [DOSSIER]: () => ({ statut: 200, corps: { objets: [
    { collection: '_racine', cle: 'company', rang: null, revision: 1, contenu: { name: 'Atelier Nadia' } },
    { collection: 'documents', cle: 'd1', rang: 0, revision: 1, contenu: { id: 'd1', type: 'devis', status: 'brouillon' } },
  ], droits: { tout: true } } }),
  [QUESTIONS]: () => ({ statut: 200, corps: { questions: [] } }),
  [REMISES]: () => ({ statut: 200, corps: { remises: [] } }),
};
// L'état de l'abonnement que rend le serveur imité, numéroté : on sait quelle lecture la v10 a reçue. `reponses` : ce
// que rend chaque demande, dans l'ordre (la dernière ensuite).
function abonnement(...reponses: Reponse[]) {
  let n = 0;
  return { route: (): Reponse => { n += 1; return reponses[Math.min(n, reponses.length) - 1] ?? { statut: 200, corps: { n } }; }, lus: () => n };
}
// La page charge `SkanAbonnement` avant le point de contact : ici, ce qu'il reçoit, tel quel.
const SkanAbonnement = { licence: (a: unknown) => ({ de: a }) };
// Un tour de la boucle des promesses : ce qui devait partir est parti.
const unInstant = () => new Promise((r) => setTimeout(r, 30));

describe('l\'ouverture d\'une entreprise, au point de contact', () => {
  it('le dossier, les questions du cabinet, les remises et l\'état de l\'abonnement se demandent ensemble, avant la moindre réponse', async () => {
    // Le serveur imité ne répond qu'au compte : ce qui part sans attendre de réponse part quand même.
    const t = chargerPont<Pont>(ENT, compte, {}, { SkanAbonnement });
    void t.pont.loadData();
    await unInstant();
    expect(t.demandes).toEqual(expect.arrayContaining([DOSSIER, QUESTIONS, REMISES, ABONNEMENT]));
  });

  it('l\'état de l\'abonnement lu avec le dossier sert la première lecture de la v10, une fois ; les suivantes redemandent', async () => {
    const a = abonnement({ statut: 200, corps: { etat: 'essai', lecture: 1 } }, { statut: 200, corps: { etat: 'essai', lecture: 2 } });
    const t = chargerPont<Pont>(ENT, { ...entreprise, [ABONNEMENT]: a.route }, {}, { SkanAbonnement });
    await t.pont.loadData();
    expect(a.lus()).toBe(1);
    expect(await t.pont.licenceStatus('')).toEqual({ de: { etat: 'essai', lecture: 1 } });
    expect(a.lus()).toBe(1);
    // Chaque heure, au retour au premier plan : une vraie lecture.
    expect(await t.pont.licenceStatus('')).toEqual({ de: { etat: 'essai', lecture: 2 } });
    expect(a.lus()).toBe(2);
  });

  it('une lecture restée sans réponse au chargement ne passe pas pour l\'état : la v10 redemande', async () => {
    // Le frontal répond à la place du serveur (un 503 vide) : pas de réponse, l'état reste inconnu.
    const a = abonnement({ statut: 503, texte: '' }, { statut: 200, corps: { etat: 'actif' } });
    const t = chargerPont<Pont>(ENT, { ...entreprise, [ABONNEMENT]: a.route }, {}, { SkanAbonnement });
    await t.pont.loadData();
    expect(await t.pont.licenceStatus('')).toEqual({ de: { etat: 'actif' } });
    expect(a.lus()).toBe(2);
  });

  it('une lecture faite plus de quinze secondes avant la première de la v10 se redemande', async () => {
    let maintenant = Date.UTC(2026, 9, 13, 8, 0, 0);
    class Horloge extends Date { static override now() { return maintenant; } }
    const a = abonnement({ statut: 200, corps: { etat: 'essai', lecture: 1 } }, { statut: 200, corps: { etat: 'essai', lecture: 2 } });
    const t = chargerPont<Pont>(ENT, { ...entreprise, [ABONNEMENT]: a.route }, {}, { SkanAbonnement, Date: Horloge });
    await t.pont.loadData();
    // L'assistant d'une première ouverture a duré : la lecture du chargement a seize secondes.
    maintenant += 16_000;
    expect(await t.pont.licenceStatus('')).toEqual({ de: { etat: 'essai', lecture: 2 } });
    expect(a.lus()).toBe(2);
  });
});
