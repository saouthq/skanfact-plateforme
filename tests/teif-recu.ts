// Un fichier El Fatoora (TEIF 1.8.8) tel qu'un fournisseur l'envoie à son client (1.325.0), pour les tests de la facture
// électronique reçue : côté entreprise (tests/web/efacture-recue-1325.test.ts) et côté cabinet
// (tests/cabinet/efacture-1325.test.ts). Chaque montant se recompte ici, ligne par ligne puis par taux.

export const compact = (m: string) => m.replace(/\//g, '');
// Un fichier El Fatoora (TEIF 1.8.8) tel qu'un fournisseur l'envoie : chaque montant recompté ici, ligne par ligne, puis par
// taux (la TVA d'un taux est sa base fois son taux), le TTC est le HT plus les taxes.
export type LigneTeif = { code: string; nom: string; qte: number; pu: number; taux: number; remise?: number };
export function teifDe(o: { numero: string; avoir?: string; date: string; echeance?: string; fournisseur: { mf: string; nom: string; ville?: string };
  acheteur: { mf: string; nom: string }; lignes: LigneTeif[]; timbre?: number; devise?: string; signe?: boolean; refTtn?: string }) {
  const dev = o.devise ?? 'TND', r3 = (x: number) => Math.round(x * 1000) / 1000, m = (x: number) => r3(x).toFixed(3);
  const jj = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
  const nets = o.lignes.map((l) => r3(l.qte * l.pu * (1 - (l.remise ?? 0) / 100)));
  const ht = r3(nets.reduce((a, b) => a + b, 0));
  const taux = [...new Set(o.lignes.map((l) => l.taux))];
  const bases = taux.map((t) => ({ t, base: r3(o.lignes.reduce((a, l, i) => a + (l.taux === t ? nets[i] ?? 0 : 0), 0)) })).map((x) => ({ ...x, tva: r3(x.base * x.t / 100) }));
  const timbre = o.timbre ?? 0;
  const ttc = r3(ht + bases.reduce((a, x) => a + x.tva, 0) + timbre);
  const amt = (code: string, v: number) => `<Moa amountTypeCode="${code}"><Amount currencyIdentifier="${dev}">${m(v)}</Amount></Moa>`;
  const lin = o.lignes.map((l, i) => `<Lin><ItemIdentifier>${i + 1}</ItemIdentifier><LinImd lang="fr"><ItemCode>${l.code}</ItemCode><ItemDescription>${l.nom}</ItemDescription></LinImd>`
    + `<LinQty><Quantity measurementUnit="UNIT">${l.qte}</Quantity></LinQty><LinTax><TaxTypeName code="I-1602">TVA</TaxTypeName><TaxDetails><TaxRate>${l.taux}</TaxRate></TaxDetails></LinTax>`
    + (l.remise ? `<LinAlc><Alc allowanceChargeQualifier="A"/><Pcd><Percentage>${l.remise}</Percentage></Pcd></LinAlc>` : '')
    + `<LinMoa><MoaDetails>${amt('I-183', l.pu)}</MoaDetails><MoaDetails>${amt('I-171', nets[i] ?? 0)}</MoaDetails></LinMoa></Lin>`).join('');
  const taxes = (timbre ? `<InvoiceTaxDetails><Tax><TaxTypeName code="I-1601">droit de timbre</TaxTypeName><TaxDetails><TaxRate>0</TaxRate></TaxDetails></Tax><AmountDetails>${amt('I-178', timbre)}</AmountDetails></InvoiceTaxDetails>` : '')
    + bases.map((x) => `<InvoiceTaxDetails><Tax><TaxTypeName code="I-1602">TVA</TaxTypeName><TaxDetails><TaxRate>${x.t}</TaxRate></TaxDetails></Tax><AmountDetails>${amt('I-177', x.base)}</AmountDetails><AmountDetails>${amt('I-178', x.tva)}</AmountDetails></InvoiceTaxDetails>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEIF version="1.8.8" controlingAgency="TTN"><InvoiceHeader><MessageSenderIdentifier type="I-01">${compact(o.fournisseur.mf)}</MessageSenderIdentifier></InvoiceHeader>
<InvoiceBody><Bgm><DocumentIdentifier>${o.numero}</DocumentIdentifier><DocumentType code="${o.avoir ? 'I-12' : 'I-11'}">${o.avoir ? 'Avoir' : 'Facture'}</DocumentType>${o.avoir ? `<DocumentReferences><DocumentReference><Reference refID="I-89">${o.avoir}</Reference></DocumentReference></DocumentReferences>` : ''}</Bgm>
<Dtm><DateText format="ddMMyy" functionCode="I-31">${jj(o.date)}</DateText>${o.echeance ? `<DateText format="ddMMyy" functionCode="I-32">${jj(o.echeance)}</DateText>` : ''}</Dtm>
<PartnerSection><PartnerDetails functionCode="I-62"><Nad><PartnerIdentifier type="I-01">${compact(o.fournisseur.mf)}</PartnerIdentifier><PartnerName nameType="Qualification">${o.fournisseur.nom}</PartnerName>
<PartnerAdresses lang="fr"><AdressDescription>Zone industrielle</AdressDescription><CityName>${o.fournisseur.ville ?? 'Sfax'}</CityName></PartnerAdresses></Nad></PartnerDetails>
<PartnerDetails functionCode="I-64"><Nad><PartnerIdentifier type="I-01">${compact(o.acheteur.mf)}</PartnerIdentifier><PartnerName nameType="Qualification">${o.acheteur.nom}</PartnerName></Nad></PartnerDetails></PartnerSection>
<LinSection>${lin}</LinSection>
<InvoiceMoa><AmountDetails>${amt('I-176', ht)}</AmountDetails><AmountDetails>${amt('I-180', ttc)}</AmountDetails></InvoiceMoa>
<InvoiceTax>${taxes}</InvoiceTax></InvoiceBody>
${o.signe === false ? '' : `<RefTtnVal>${o.refTtn ?? `TTN-${o.date.slice(0, 4)}-${o.numero}`}</RefTtnVal><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature>`}</TEIF>`;
  return { xml, ht, ttc, bases };
}
