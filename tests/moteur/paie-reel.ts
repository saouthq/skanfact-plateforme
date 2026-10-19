// Les chiffres d'un journal de paie réel (septembre 2026, douze salariés) et de l'état récapitulatif CNSS de son
// trimestre, reçus de Skander le 19/10/2026. Les documents ne sont JAMAIS gardés dans le dépôt : d'eux, ce fichier ne
// garde que des montants, sans un nom, un matricule ni un numéro (« salarié 1 » à « salarié 12 »). Lus par
// paie-journal-reel.test.ts (1.59.0, le bulletin) et paie-etats.test.ts (1.61.0, le journal et les états).

// Les colonnes du journal (J., H.S.Base + CP, Indemnités, S.Cotis, CNSS, S.Imposable, Impôts, CSS, Net à payer,
// TFP, Foprolos, AT, CP), en millimes ; J. en millièmes de jour.
export const COLONNES = ['jours', 'base', 'indemnites', 'cotisable', 'cnss', 'imposable', 'irpp', 'css', 'net', 'tfp', 'foprolos', 'accident', 'cnssEmployeur'] as const;
export type Colonne = typeof COLONNES[number];
// Chaque salarié : son brut de base mensuel, ses jours payés, sa famille (déduite de son impôt), puis sa ligne du journal.
export const SALARIES: { brut: number; jours: number; chef: boolean; enfants: number; journal: string }[] = [
  { brut: 1276, jours: 26, chef: true, enfants: 2, journal: '26 1276 80 1356 131.261 1224.739 119.316 5.303 1100.120 27.120 13.560 6.780 231.469' },
  { brut: 1130, jours: 26, chef: true, enfants: 3, journal: '26 1130 80 1210 117.128 1092.872 87.563 4.668 1000.641 24.200 12.100 6.050 206.547' },
  { brut: 1136, jours: 26, chef: true, enfants: 1, journal: '26 1136 80 1216 117.709 1098.291 92.949 4.776 1000.567 24.320 12.160 6.080 207.571' },
  { brut: 612, jours: 19.5, chef: false, enfants: 0, journal: '19.5 459 60 519 50.239 468.761 0.783 2.109 465.869 10.380 5.190 2.595 88.593' },
  { brut: 612, jours: 10.5, chef: false, enfants: 0, journal: '10.5 247.154 32.308 279.462 27.052 252.410 0 1.136 251.274 5.589 2.795 1.397 47.704' },
  { brut: 540, jours: 4, chef: true, enfants: 2, journal: '4 83.077 12.308 95.385 9.233 86.151 0 0.179 85.972 1.908 0.954 0.477 16.282' },
  { brut: 548, jours: 11, chef: false, enfants: 0, journal: '11 231.846 33.846 265.692 25.719 239.973 0 1.080 238.893 5.314 2.657 1.328 45.354' },
  { brut: 548, jours: 16.02, chef: false, enfants: 0, journal: '16.02 337.652 49.292 386.945 37.456 349.488 0 1.573 347.916 7.739 3.869 1.935 66.051' },
  { brut: 677, jours: 20, chef: false, enfants: 0, journal: '20 520.769 61.538 582.308 56.367 525.940 8.502 2.367 515.072 11.646 5.823 2.912 99.400' },
  { brut: 612, jours: 20, chef: false, enfants: 0, journal: '20 470.769 61.538 532.308 51.527 480.780 2.405 2.164 476.211 10.646 5.323 2.662 90.865' },
  { brut: 548, jours: 14.3, chef: false, enfants: 0, journal: '14.3 301.400 44 345.400 33.435 311.965 0 1.404 310.561 6.908 3.454 1.727 58.960' },
  { brut: 548, jours: 20, chef: false, enfants: 0, journal: '20 421.538 61.538 483.077 46.762 436.315 0 1.963 434.352 9.662 4.831 2.415 82.461' },
];
// Les totaux imprimés au pied du journal (Nombre 12).
export const TOTAUX_DU_JOURNAL: Partial<Record<Colonne, string>> = {
  base: '6615.206', indemnites: '656.369', cotisable: '7271.575', cnss: '703.888', imposable: '6567.687', irpp: '311.518', css: '28.721',
  net: '6227.448', tfp: '145.432', foprolos: '72.716', accident: '36.358', cnssEmployeur: '1241.258',
};
// Les écarts, tranchés : chacun vaut UN millime, et vient des fractions que le logiciel du journal garde.
// « 5 indemnites » : le salarié 5, sa colonne, ce que SkanFact écrit.
export const ECARTS: Record<string, string> = {
  '3 net': '1000.566',            // 1 216 − 117,709 − 92,949 − 4,776 ; le journal part de 117,7088, 92,9488 et 4,7757
  '5 indemnites': '32.307',       // 12,115 + 20,192 (30 et 50 × 10,5 / 26, chacune au millime) ; le journal : 32,3077
  '5 cotisable': '279.461', '5 imposable': '252.409', '5 net': '251.273',
  '6 indemnites': '12.307', '6 cotisable': '95.384',
  '8 indemnites': '49.293',       // 18,485 + 30,808 ; le journal : 80 × 16,02 / 26 = 49,2923
  '8 imposable': '349.489', '8 cnssEmployeur': '66.052',
  '9 indemnites': '61.539', '9 imposable': '525.941',
  '10 indemnites': '61.539', '10 imposable': '480.781', '10 net': '476.212',
  '12 indemnites': '61.539',
};
export const ECARTS_DES_TOTAUX: Partial<Record<Colonne, string>> = { base: '6615.205', indemnites: '656.370', css: '28.722', net: '6227.447' };

// Les deux primes de la fiche, au jour, comme sur le bulletin de juin.
export const PRIMES = [{ label: 'Prime de présence', amount: 30, taxable: true, parJour: true }, { label: 'Prime de transport', amount: 50, taxable: true, parJour: true }];

// L'état récapitulatif des salaires déclarés du 3e trimestre 2026 (les trois mois, toute l'entreprise).
export const ETAT_CNSS = { salaires: '29119.268', secu: { taux: '26.75', montant: '7789.404' }, accident: { taux: '0.50', montant: '145.596' }, total: '7935.000' };
