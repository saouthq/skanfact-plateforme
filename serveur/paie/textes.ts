// Les textes du module Paie (14 § 5) : ce que font ses gestes, et le nom de chaque montant d'un
// bulletin (un refus dit lequel ne tombe pas juste). Déclarés dès que le module est chargé.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.paie.bulletins.voir': 'voir les salariés et leurs bulletins de paie',
  'geste.paie.declarations.voir': 'voir les déclarations sociales',
  'geste.paie.masse.voir': 'voir la masse salariale',
  'paie.champ.annee': 'une année, de 2000 à 2200',
  'paie.champ.mois': 'un mois, de 1 à 12',
  'paie.champ.fin_avant_debut': 'la fin de la période ne peut pas précéder son début',
  'paie.montant.brutDeBase': 'le brut de base',
  'paie.montant.retenueAbsence': 'la retenue pour absence',
  'paie.montant.primesImposables': 'les primes imposables',
  'paie.montant.primesNonImposables': 'les primes non imposables',
  'paie.montant.brut': 'le salaire brut',
  'paie.montant.assietteCnss': 'l\'assiette de la CNSS',
  'paie.montant.cnssSalarie': 'la CNSS du salarié',
  'paie.montant.apresCnss': 'le salaire après CNSS',
  'paie.montant.fraisPro': 'les frais professionnels',
  'paie.montant.deductionsFamille': 'les déductions de famille',
  'paie.montant.imposableAnnuel': 'le revenu imposable de l\'année',
  'paie.montant.irppAnnuel': 'l\'impôt sur le revenu de l\'année',
  'paie.montant.irpp': 'l\'impôt sur le revenu du mois',
  'paie.montant.css': 'la contribution sociale de solidarité',
  'paie.montant.autresRetenues': 'les autres retenues',
  'paie.montant.net': 'le net à payer',
  'paie.montant.cnssEmployeur': 'la CNSS de l\'employeur',
  'paie.montant.accidentTravail': 'l\'accident du travail',
  'paie.montant.tfp': 'la TFP',
  'paie.montant.foprolos': 'le FOPROLOS',
  'paie.montant.chargesPatronales': 'les charges patronales',
  'paie.montant.coutEmployeur': 'le coût pour l\'entreprise',
});
