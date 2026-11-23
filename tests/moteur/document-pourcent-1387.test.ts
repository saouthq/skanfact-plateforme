// (1.387.71, issue 15, V-16) Le document que le client reçoit. « Remise 5% », « TVA 19% » : l'écran écrit « 5 % », le
// papier collait le signe au chiffre. En français le pourcentage prend son espace (insécable, pour ne pas passer seul à
// la ligne) ; en anglais il reste collé. Et le devis d'un marchand n'est pas signé « Le prestataire ».
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as { documentHtml: (doc: Objet, client: Objet, company: Objet, opts?: Objet) => string; sousTotauxDeSections: (doc: Objet, company: Objet) => Record<string, number> };

const societe = (activity: string) => ({ name: 'Meubles du Sahel', currency: 'DT', stampFee: 1, regimeTva: 'reel', activity });
const piece = (type: string, lang: string) => ({ id: 'p1', type, number: type === 'devis' ? 'DEV-2026-001' : 'FAC-2026-001', status: 'envoyé', date: '2026-11-16', dueDate: '2026-12-16',
  clientId: 'c1', lang, currency: 'DT', discountRate: 5, withholdingRate: 1.5, applyStamp: true, stampFee: 1, payments: [],
  lines: [{ label: 'Chaise', qty: 4, unitPrice: 100, vatRate: 19 }, { label: 'Livre de recettes', qty: 1, unitPrice: 50, vatRate: 7 }] });
const texte = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t\n]+/g, ' ');

describe('le pourcentage du document imprimé (issue 15, V-16)', () => {
  it('en français « Remise 5 % », « TVA 19 % », « 1,5 % » avec une espace insécable ; en anglais le signe reste collé', () => {
    const fr = texte(C.documentHtml(piece('facture', 'fr'), { name: 'Client' }, societe('services')));
    expect(fr).toContain('5 %');
    expect(fr).toContain('19 %');
    expect(fr).toContain('7 %');
    expect(fr).toContain('1,5 %');
    expect(fr).not.toMatch(/\d%/);
    const en = texte(C.documentHtml(piece('facture', 'en'), { name: 'Client' }, societe('services')));
    expect(en).toContain('19%');
    expect(en).not.toContain(' %');
  });
  it('le devis d\'un commerce est signé « Le vendeur » ; celui d\'un métier de service reste « Le prestataire »', () => {
    expect(texte(C.documentHtml(piece('devis', 'fr'), { name: 'Client' }, societe('commerce')))).toContain('Le vendeur');
    expect(texte(C.documentHtml(piece('devis', 'fr'), { name: 'Client' }, societe('commerce')))).not.toContain('Le prestataire');
    expect(texte(C.documentHtml(piece('devis', 'fr'), { name: 'Client' }, societe('services')))).toContain('Le prestataire');
  });
  // (1.387.74) Le prix unitaire s'imprime tel qu'il compte ; le capital du pied ne se coupe pas ; la case de signature
  // resserrée garde le nom entier sur une ligne.
  it('un prix unitaire plus fin que la devise s\'imprime entier : 2 × 850,555 € = 1 701,11', () => {
    const doc = { ...piece('facture', 'fr'), currency: 'EUR', exchangeRate: 3.4, discountRate: 0, withholdingRate: 0, applyStamp: false,
      lines: [{ label: 'Bureau', qty: 2, unitPrice: 850.555, vatRate: 0 }, { label: 'Lampe', qty: 1, unitPrice: 40, vatRate: 0 }] };
    const fr = texte(C.documentHtml(doc, { name: 'Client' }, societe('commerce')));
    expect(fr).toContain('850,555');
    expect(fr).not.toContain('850,56');
    expect(fr).toContain('40,00');
    expect(fr).not.toContain('40,000');
    expect(fr).toContain('1\u00a0701,11');
  });
  it('« Capital 10 000 DT » tient d\'un bloc au pied ; la case de signature resserrée garde le nom sur une ligne', () => {
    const html = C.documentHtml(piece('facture', 'fr'), { name: 'Client' }, { ...societe('services'), capital: '10000' });
    expect(html).toContain('Capital 10 000 DT');
    expect(html).toMatch(/\.page\.compact:not\(\.t-contrat\) \.sign \.s small \{[^}]*text-overflow: ellipsis/);
  });
  it('la déduction d\'un acompte n\'entre dans le sous-total d\'aucune section (1.388.27, issue 15 V-3)', () => {
    const doc = { type: 'facture', currency: 'DT', discountRate: 0, lines: [
      { kind: 'titre', label: 'Gros œuvre' }, { label: 'Maçonnerie', qty: 1, unitPrice: 100, vatRate: 19 },
      { kind: 'titre', label: 'Finitions' }, { label: 'Peinture', qty: 2, unitPrice: 100, vatRate: 19 },
      { label: 'Acompte déjà facturé (FAC-2026-001)', qty: 1, unitPrice: -50, vatRate: 19, noDiscount: true }] };
    const st = C.sousTotauxDeSections(doc, { currency: 'DT', stampFee: 1 });
    expect(Object.values(st).sort((a, b) => a - b)).toEqual([100, 200]);
  });
});
