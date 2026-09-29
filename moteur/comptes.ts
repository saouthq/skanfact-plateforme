// Le plan comptable par défaut : le compte de chaque rôle, celui de la v10 (`DEFAULT_ACCOUNTS`,
// core.js), qu'un test confronte à la v10 (docs/ecritures.md § 4). Ce sont des numéros du système
// comptable des entreprises, pas des taux : l'entreprise les remplace par les siens (`chartAccounts`
// de son dossier). À VÉRIFIER avec le comptable, comme dans la v10 : 706 ou 707 selon ce qu'on vend,
// le 22 des immobilisations, le 409 des avances.

export const PLAN_PAR_DEFAUT = {
  clients: '411',
  fournisseurs: '401',
  ventes: '706',
  tvaCollectee: '4367',
  tvaDeductible: '4366',
  timbre: '4368',
  rsSubie: '4358',
  rsOperee: '4352',
  achatsStock: '607',
  charges: '606',
  immobilisations: '22',
  fraisAccessoires: '608',
  avancesFournisseurs: '409',
  banque: '532',
  caisse: '54',
  salairesBruts: '640',
  chargesPatronales: '645',
  personnel: '425',
  cnss: '4531',
  irpp: '4321',
  resultat: '13',
  tvaAPayer: '4365',
  fraisBancaires: '627',
  impots: '434',
  associes: '4421',
  emprunts: '16',
  attente: '471',
  reportANouveau: '12',
  dotations: '681',
  amortissements: '28',
  vncCedee: '675',
  produitsCession: '775',
  taxesSalaires: '661',
  tfpFoprolos: '4335',
  stocks: '37',
  variationStocks: '603',
  subventions: '14',
  repriseSubventions: '739',
  pertesChange: '655',
  gainsChange: '755',
} as const;

export type RoleCompte = keyof typeof PLAN_PAR_DEFAUT;
export type Plan = Record<RoleCompte, string>;

// Un numéro de compte : des chiffres (et, pour un compte auxiliaire, le code du tiers accolé).
export const NUMERO_DE_COMPTE = /^[0-9A-Za-z]{1,20}$/;

// Le plan de l'entreprise : les défauts, remplacés par ce qu'elle a réglé (un réglage illisible ne
// remplace rien : la valeur qui ne fait rien, c'est garder le défaut).
export function planDeLEntreprise(regle: Record<string, unknown> | null | undefined): Plan {
  const plan: Plan = { ...PLAN_PAR_DEFAUT };
  for (const role of Object.keys(PLAN_PAR_DEFAUT) as RoleCompte[]) {
    const v = regle?.[role];
    const texte = typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (NUMERO_DE_COMPTE.test(texte)) plan[role] = texte;
  }
  return plan;
}
