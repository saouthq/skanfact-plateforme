// Chaque geste qui écrit a SA décision de lecture seule (serveur/abonnement/condition.ts ; docs/abonnement.md) : fermé,
// ouvert, ou décidé par sa route. Un geste nouveau reçoit la sienne, comme une table nouvelle reçoit sa place dans l'export
// (base/entreprise.ts, CLASSEMENT) : sans ce test, un geste ajouté demain serait ouvert en lecture seule sans que personne
// l'ait décidé. Et une décision qui ne désigne plus aucun geste se retire : une liste qui ment finit par ne plus se lire.

import { describe, expect, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { POLITIQUE_LECTURE_SEULE } from '../../serveur/abonnement/condition.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { GESTES } from '../../serveur/porte/gestes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
// Les gestes du dossier de la v10 se déclarent à l'import (serveur/v10/droits.ts), comme au démarrage du serveur.
import '../../serveur/v10/droits.ts';

describe('la lecture seule d\'un abonnement : une décision par geste qui écrit', () => {
  // Tous les modules, comme le serveur les déclare (serveur/principal.ts).
  declarerGestesVentes(); declarerGestesCaisse(); declarerGestesAchats(); declarerGestesPaie(); declarerGestesCompta(); declarerGestesMessagerie();
  const ecrits = [...GESTES.values()].filter((g) => g.ecrit).map((g) => g.code);

  it('chaque geste qui écrit a sa décision', () => {
    expect(ecrits.length).toBeGreaterThan(30);
    const sansDecision = ecrits.filter((code) => !(code in POLITIQUE_LECTURE_SEULE));
    expect(sansDecision, 'des gestes qui écrivent sans décision de lecture seule').toEqual([]);
  });

  it('chaque décision désigne un geste qui écrit', () => {
    const orphelines = Object.keys(POLITIQUE_LECTURE_SEULE).filter((code) => !ecrits.includes(code));
    expect(orphelines, 'des décisions qui ne désignent aucun geste qui écrit').toEqual([]);
  });

  it('ce qui a de la valeur et ce qui engage se ferme ; ce que la loi demande pour l\'existant reste ouvert', () => {
    // Fermé par la porte : une pièce fiscale nouvelle, la caisse qu'on ouvre, un retour, la lecture d'une facture d'achat.
    for (const code of ['ventes.facture.emettre', 'ventes.avoir.emettre', 'caisse.session.ouvrir', 'caisse.ticket.rendre', 'achats.facture.lire']) {
      expect(POLITIQUE_LECTURE_SEULE[code], code).toBe('ferme');
    }
    // Décidé par la route, sur ce qu'elle reçoit : un ticket fait sans réseau avant la lecture seule se reçoit.
    for (const code of ['caisse.ticket.encaisser', 'ventes.boutique.facturer']) expect(POLITIQUE_LECTURE_SEULE[code], code).toBe('route');
    // Jamais fermé : ce qui fait sortir de la lecture seule, et ce que la loi demande pour l'activité passée (07 : aucune
    // obligation légale n'est vendue en option).
    for (const code of ['socle.abonnement.payer', 'socle.offre.changer', 'caisse.session.fermer', 'ventes.facture.signer',
      'ventes.efacture.regler', 'compta.declarations.preparer', 'compta.exercice.cloturer', 'compta.ecritures.valider']) {
      expect(POLITIQUE_LECTURE_SEULE[code], code).toBe('ouvert');
    }
  });
});
