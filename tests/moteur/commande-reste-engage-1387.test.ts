// (1.387.56, issue 13, ENTACHATS-11) La liste des commandes fournisseurs disait « 2 500,000 DT HT engagés » pour une
// commande de 40 sacs à 62,500 dont 15 étaient déjà reçus. Ce qui reste engagé, c'est ce qui reste à recevoir :
// 25 × 62,500 = 1 562,500 DT HT (calcul à la main). En euros, le reste se convertit au taux de la commande.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const C = ecranDeLaPlateforme('core.js') as {
  montantResteCommandeFournisseur: (data: unknown, commande: unknown, company: unknown) => number;
  montantCommandeFournisseur: (commande: unknown, company: unknown) => number;
};
const company = { currency: 'DT' };
const commande = (extra = {}) => ({ id: 'c1', status: 'envoyée', currency: 'DT', exchangeRate: '', lines: [
  { label: 'Farine T55', qty: 40, unit: 'sac', unitPrice: 62.5, vatRate: 19 },
  { label: 'Sucre', qty: 10, unit: 'sac', unitPrice: 30, vatRate: 19 },
], ...extra });
const reception = (status: string, qFarine: number, qSucre: number) => ({ id: 'r-' + status + qFarine, orderId: 'c1', status, date: '2026-11-10',
  lines: [{ ligneCommande: 0, qty: qFarine }, { ligneCommande: 1, qty: qSucre }] });

describe('ce qu\'une commande fournisseur engage encore (issue 13, ENTACHATS-11)', () => {
  it('sans réception, tout est engagé', () => {
    expect(C.montantResteCommandeFournisseur({ receptions: [] }, commande(), company)).toBe(2800);
  });
  it('15 sacs de farine reçus sur 40, le sucre entier : restent 25 × 62,500', () => {
    expect(C.montantResteCommandeFournisseur({ receptions: [reception('validée', 15, 10)] }, commande(), company)).toBe(1562.5);
  });
  it('une réception en préparation n\'est pas encore reçue', () => {
    expect(C.montantResteCommandeFournisseur({ receptions: [reception('brouillon', 15, 10)] }, commande(), company)).toBe(2800);
  });
  it('en euros, le reste se convertit au taux de la commande', () => {
    const c = commande({ currency: 'EUR', exchangeRate: 3.4 });
    expect(C.montantResteCommandeFournisseur({ receptions: [reception('validée', 15, 10)] }, c, company)).toBe(5312.5);
  });
});
