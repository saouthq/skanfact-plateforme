// Ce que « Ton abonnement » et le bandeau de l'accueil disent (1.118.0 ; docs/revue-abonnement.md ;
// web/public/plateforme/abonnement.js), lu sans navigateur : le rappel déjà parti (jamais annoncé comme à venir), la
// prochaine qui partira, ce qui rouvre tel que ça se passe, et le bouton du bandeau selon ce qui attend et qui lit.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const code = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/abonnement.js'), 'utf8');
const fenetre: Record<string, unknown> = {};
vm.runInNewContext(code, { window: fenetre, Intl, Date, URLSearchParams });
type Etat = Record<string, unknown>;
// Les espaces insécables des nombres (« 7 jours ») se lisent comme des espaces.
const net = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');
const A = fenetre.SkanAbonnement as {
  etatEnClair: (e: Etat, regles?: { essai?: number; relances?: number[] }, suite?: { aFaire?: string | null; prolonge?: boolean; rappels?: { rang: string; le: string }[] }) => { titre: string; texte: string; pastille: string; jauge: { texte: string } | null };
  bandeau: (e: Etat | null, gere: boolean) => { titre: string; texte: string; bouton: string; principal: boolean; ecrire: boolean } | null;
};
const actif = { etat: 'actif', offre: 'essentiel', periodicite: 'mensuel', jusquAu: '2026-11-01', jours: 10, resilie: false };

describe('les textes de l\'abonnement', () => {
  it('le rappel déjà parti se dit avec son jour, et le prochain qui partira ; sans rappel parti, celui qui partira', () => {
    const relances = [15, 7, 1];
    expect(net(A.etatEnClair(actif, { relances }, { rappels: [{ rang: 'j15', le: '2026-10-17' }] }).texte))
      .toBe('Encore 10 jours. Un rappel t\'a été envoyé par e-mail le 17/10/2026 ; le prochain partira 7 jours avant l\'échéance.');
    expect(net(A.etatEnClair({ ...actif, jours: 3 }, { relances }, { rappels: [{ rang: 'j15', le: '2026-10-17' }, { rang: 'j7', le: '2026-10-25' }] }).texte))
      .toBe('Encore 3 jours. Un rappel t\'a été envoyé par e-mail le 25/10/2026 ; le prochain partira la veille de l\'échéance.');
    expect(net(A.etatEnClair({ ...actif, jours: 164 }, { relances }, { rappels: [] }).texte)).toBe('Encore 164 jours. Un rappel partira par e-mail 15 jours avant l\'échéance.');
  });

  it('ce qui rouvre : choisir, régler, ou attendre la facture ; une entreprise suspendue nous écrit', () => {
    const seule = { etat: 'lecture_seule', depuis: '2026-10-20', raison: 'essai_termine' };
    expect(net(A.etatEnClair(seule, {}, {}).texte)).toContain('Choisis ton offre : ta facture arrive ici, et dès qu\'elle est réglée, tout se rouvre, tel que tu l\'as laissé.');
    expect(net(A.etatEnClair(seule, {}, { aFaire: 'payer' }).texte)).toContain('Règle ta facture, juste en dessous : dès que le paiement est confirmé, tout se rouvre');
    expect(net(A.etatEnClair(seule, {}, { aFaire: 'attendre' }).texte)).toContain('un e-mail te prévient quand elle est prête');
    const suspendue = A.etatEnClair({ ...seule, raison: 'suspendu' }, {}, {});
    expect(suspendue.pastille).toBe('Suspendu');
    expect(suspendue.texte).not.toMatch(/abonne-toi|Choisis ton offre/);
    for (const e of [seule, { ...seule, raison: 'non_renouvele' }]) expect(net(A.etatEnClair(e, {}, {}).texte)).not.toContain('aussitôt');
  });

  it('le bandeau de l\'accueil : rien pendant un essai qui court ; son bouton selon ce qui attend et qui lit', () => {
    expect(A.bandeau({ etat: 'essai', jusquAu: '2026-11-30', jours: 20 }, true)).toBeNull();
    expect(A.bandeau({ ...actif, jours: 40 }, true)).toBeNull();
    const grace = { etat: 'en_retard', echeance: '2026-10-20', lectureSeuleLe: '2026-10-28', jours: 6, apresEssai: true };
    expect(A.bandeau(grace, true)).toMatchObject({ bouton: 'Choisir mon offre', principal: true });
    expect(A.bandeau({ ...grace, aFaire: 'payer' }, true)).toMatchObject({ bouton: 'Régler ma facture', principal: true });
    expect(A.bandeau({ ...grace, aFaire: 'attendre' }, true)).toMatchObject({ bouton: 'Voir mon abonnement' });
    expect(A.bandeau(grace, false)).toMatchObject({ bouton: 'Qui le règle ?' });
    expect(A.bandeau({ ...actif, jours: 10 }, true)).toMatchObject({ bouton: 'Renouveler', principal: false });
    expect(A.bandeau({ etat: 'lecture_seule', depuis: '2026-10-20', raison: 'suspendu' }, true)).toMatchObject({ bouton: 'Écrire à SkanFact', ecrire: true });
  });
});
