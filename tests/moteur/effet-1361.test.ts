// La traite reçue avant son échéance (1.361.0, bout en bout 24). L'hôtel règle une facture de 477 DT par une traite à
// soixante jours : l'entreprise la dit réglée le jour où elle reçoit la traite, et le comptable voyait l'hôtel devoir la
// facture jusqu'à l'échéance. Le jour de la traite, la créance passe du client (411) aux effets à recevoir (413) ; à
// l'échéance, la banque solde le 413. Côté achats, la traite remise au fournisseur passe du 401 aux effets à payer (403).
// Les montants attendus sont refaits à la main, en millimes.

import { describe, expect, it } from 'vitest';
import { TND, type Devise } from '../../moteur/argent.ts';
import { ecritureDEffetRemis, ecritureDeReglementFournisseur } from '../../moteur/achats.ts';
import { PLAN_PAR_DEFAUT } from '../../moteur/comptes.ts';
import { ecritureDEffetRecu, ecritureDEncaissement } from '../../moteur/reglements.ts';

const EUR: Devise = { code: 'EUR', decimales: 2 };
const lignes = (e: { lignes: { compte: string; debit: bigint; credit: bigint }[] }) => e.lignes.map((l) => `${l.compte} ${l.debit}/${l.credit}`);
const COMPTES = { clients: '411', tresorerie: '532', retenueSubie: '4358', gainsChange: '755', pertesChange: '655' };
const FOURNISSEURS = { fournisseurs: '401', tresorerie: '532', retenueOperee: '4352', gainsChange: '755', pertesChange: '655' };

describe('la traite reçue d\'un client', () => {
  it('le plan propose 413 et 403 (À VÉRIFIER avec le comptable)', () => {
    expect([PLAN_PAR_DEFAUT.effetsARecevoir, PLAN_PAR_DEFAUT.effetsAPayer]).toEqual(['413', '403']);
  });

  it('le jour de la traite, la créance passe du 411 au 413 ; à l\'échéance, la banque solde le 413', () => {
    const traite = { cle: 'r1', date: '2027-01-15', montant: 477_000n };
    expect(lignes(ecritureDEffetRecu({ devise: TND }, traite, TND, { clients: '411', effets: '413' }))).toEqual(['413 477000/0', '411 0/477000']);
    expect(lignes(ecritureDEncaissement({ devise: TND }, traite, 0n, TND, { ...COMPTES, effets: '413' }))).toEqual(['532 477000/0', '413 0/477000']);
    // Sans traite, l'encaissement reste ce qu'il était : la banque contre le client.
    expect(lignes(ecritureDEncaissement({ devise: TND }, traite, 0n, TND, COMPTES))).toEqual(['532 477000/0', '411 0/477000']);
  });

  it('la retenue de ce règlement reste au client : elle naît au règlement, pas à la traite', () => {
    // 477 DT TTC, 1 % de retenue (4,770) : la traite porte le net, 472,230 ; le client garde 4,770 pour l'État.
    const traite = { cle: 'r1', date: '2027-01-15', montant: 472_230n };
    expect(lignes(ecritureDEffetRecu({ devise: TND }, traite, TND, { clients: '411', effets: '413' }))).toEqual(['413 472230/0', '411 0/472230']);
    expect(lignes(ecritureDEncaissement({ devise: TND }, traite, 4_770n, TND, { ...COMPTES, effets: '413' })))
      .toEqual(['532 472230/0', '413 0/472230', '411 0/4770', '4358 4770/0']);
  });

  it('une traite en euros : le 413 au cours de la facture, l\'écart au change à l\'échéance', () => {
    // 2 500 € au cours de 3,412 (8 530 DT) ; la banque les reçoit à 3,380 (8 450 DT) : 80 DT de perte de change.
    const piece = { devise: EUR, cours: 3_412_000n };
    const traite = { cle: 'r1', date: '2027-01-15', montant: 250_000n, cours: 3_380_000n };
    expect(lignes(ecritureDEffetRecu(piece, traite, TND, { clients: '411', effets: '413' }))).toEqual(['413 8530000/0', '411 0/8530000']);
    expect(lignes(ecritureDEncaissement(piece, traite, 0n, TND, { ...COMPTES, effets: '413' }))).toEqual(['532 8450000/0', '413 0/8530000', '655 80000/0']);
  });
});

describe('la traite remise à un fournisseur', () => {
  it('le jour de la traite, la dette passe du 401 au 403 ; à l\'échéance, la banque solde le 403', () => {
    const traite = { cle: 'r1', date: '2027-01-31', montant: 1_190_000n };
    expect(lignes(ecritureDEffetRemis({ devise: TND, nature: 'facture' }, traite, TND, { fournisseurs: '401', effets: '403' }))).toEqual(['401 1190000/0', '403 0/1190000']);
    expect(lignes(ecritureDeReglementFournisseur({ devise: TND, nature: 'facture' }, traite, 0n, TND, { ...FOURNISSEURS, effets: '403' })))
      .toEqual(['403 1190000/0', '532 0/1190000']);
  });

  it('la retenue opérée reste au fournisseur ; un avoir n\'a pas de traite', () => {
    // 1 190 DT TTC, 1,5 % de retenue (17,850) : la traite porte 1 172,150.
    const traite = { cle: 'r1', date: '2027-01-31', montant: 1_172_150n };
    expect(lignes(ecritureDeReglementFournisseur({ devise: TND, nature: 'facture' }, traite, 17_850n, TND, { ...FOURNISSEURS, effets: '403' })))
      .toEqual(['403 1172150/0', '401 17850/0', '532 0/1172150', '4352 0/17850']);
    expect(ecritureDEffetRemis({ devise: TND, nature: 'avoir' }, traite, TND, { fournisseurs: '401', effets: '403' }).lignes).toEqual([]);
  });
});
