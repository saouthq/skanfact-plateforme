// Ce que l'IA de Claude rend de la facture d'essai de la Quincaillerie Ben Salem (quincaillerie-photo.jpg,
// quincaillerie.pdf) : les parcours à la souris la lisent par l'IA, jouée par cet essai (aucun appel réel ne part).
// 3 × 42,350 et 2 × 68,900 à 19 %, la livraison à 7 % ; 279,850 HT, 51,372 de TVA, 1,000 de timbre : 332,222 à payer.

import type { AppelIA, ReponseIA } from '../../../serveur/achats/lecture-ia.ts';

// Datée du jour (et payable à 30 jours) : le parcours J2 déclare la TVA du mois en cours, l'achat doit en être. Datée en dur
// du 03/10/2026, la pièce sortait du mois le 1er novembre et la TVA déductible tombait à zéro (rouge GitHub du 01/11/2026).
const jourDans = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export const QUINCAILLERIE: ReponseIA = {
  estUneFacture: true, fournisseur: 'Quincaillerie Ben Salem',
  matricules: [{ valeur: '1234567A/B/M/000', de: 'emetteur' }, { valeur: '7654321B/A/M/000', de: 'client' }],
  numero: 'FV-2026-0412', date: jourDans(0), echeance: jourDans(30), objet: 'Fournitures atelier', devise: 'TND',
  lignes: [
    { designation: 'Vis inox 6x40 (boîte de 200)', quantite: '3', prixUnitaire: '42.350', remise: null, tauxTva: '19', totalHT: '127.050' },
    { designation: 'Colle à bois 5 kg', quantite: '2', prixUnitaire: '68.900', remise: null, tauxTva: '19', totalHT: '137.800' },
    { designation: 'Livraison', quantite: '1', prixUnitaire: '15.000', remise: null, tauxTva: '7', totalHT: '15.000' },
  ],
  totalHT: '279.850', totalTVA: '51.372', timbre: '1.000', fodec: null, retenue: null, totalTTC: '332.222', netAPayer: '332.222',
  ou: [{ champ: 'numero', texte: 'Facture FV-2026-0412' }],
  doutes: [],
};

export const iaQuincaillerie: AppelIA = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(QUINCAILLERIE) }] });
