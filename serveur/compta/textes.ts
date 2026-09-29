// Les textes du module Comptabilité (14 § 5) : ce que font ses gestes, et les libellés des
// écritures (écrits dans la langue de l'entreprise au moment où l'écriture s'écrit, comme la v10).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.compta.livres.voir': 'voir les livres, la balance et le grand livre',
  'compta.champ.journal': 'un journal : VT, AC, BQ, CA, OD, PAIE ou AN',
  'compta.champ.compte': 'un numéro de compte (des chiffres)',
  'compta.champ.fin_avant_debut': 'la fin de la période ne peut pas précéder son début',
  'compta.libelle.facture': 'Facture {numero} — {client}',
  'compta.libelle.avoir': 'Avoir {numero} — {client}',
  'compta.libelle.ventes': '{libelle} (HT {taux} %)',
  'compta.libelle.tva': 'TVA {taux} % — {numero}',
  'compta.libelle.timbre': 'Timbre fiscal {numero}',
  'compta.libelle.change': 'Écart de change {numero}',
  'compta.libelle.regularisation': 'Régularisation de la retenue {facture} (avoir {numero})',
  'compta.libelle.reglement': 'Règlement {numero} — {client}',
  'compta.libelle.remboursement': 'Remboursement {numero} — {client}',
  'compta.libelle.retenue_subie': 'Retenue à la source subie {numero}',
  'compta.libelle.gain_change': 'Gain de change — {libelle}',
  'compta.libelle.perte_change': 'Perte de change — {libelle}',
  'compta.libelle.achat.facture': 'Achat {numero} — {fournisseur}',
  'compta.libelle.achat.depense': 'Dépense {numero} — {fournisseur}',
  'compta.libelle.achat.avoir': 'Avoir fournisseur {numero} — {fournisseur}',
  'compta.libelle.achat.acompte': 'Acompte versé {numero} — {fournisseur}',
  'compta.libelle.sans_numero': '(sans numéro)',
  'compta.libelle.frais': 'Frais accessoires {numero}',
  'compta.libelle.tva_deductible': 'TVA déductible {numero}',
  'compta.libelle.imputation': 'Imputation acompte {acompte} sur {numero}',
  'compta.libelle.reglement_fournisseur': 'Règlement fournisseur {numero} — {fournisseur}',
  'compta.libelle.remboursement_fournisseur': 'Remboursement {numero} — {fournisseur}',
  'compta.libelle.retenue_operee': 'Retenue à la source opérée {numero}',
});
