// (1.387.71, issue 15, V-16) Le document que le client reçoit. « Remise 5% », « TVA 19% » : l'écran écrit « 5 % », le
// papier collait le signe au chiffre. En français le pourcentage prend son espace (insécable, pour ne pas passer seul à
// la ligne) ; en anglais il reste collé. Et le devis d'un marchand n'est pas signé « Le prestataire ».
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as { documentHtml: (doc: Objet, client: Objet, company: Objet, opts?: Objet) => string };

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
});
