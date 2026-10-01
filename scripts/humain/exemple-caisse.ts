// Les comptes d'un essai à la main de la caisse (scripts/humain/lancer.sh) : la Boulangerie Ben Youssef, Nadia la
// propriétaire (code du téléphone par application), Sami et Leila, caissiers ; un compte de caisse et trois articles.
// Les codes (caisse, responsable) se posent ensuite à la souris : c'est ce qu'on teste. Les comptes s'écrivent dans
// /tmp (jamais dans le dépôt) ; `node scripts/humain/code.ts` donne le code du téléphone de Nadia à l'instant.
//   node scripts/humain/exemple-caisse.ts http://127.0.0.1:8090
import fs from 'node:fs';

const adresse = process.argv[2] ?? 'http://127.0.0.1:8090';
const TRAVAIL = '/tmp/skanfact-humain-plateforme';
const MDP = 'Un-bon-mot-de-passe';
const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
  const r = await fetch(`${adresse}/v1${chemin}`, {
    method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  const texte = await r.text();
  const lu = (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${methode} ${chemin} : ${r.status} ${String(lu.motif ?? texte)}`);
  return lu;
};
const personne = async (nom: string, email: string) => {
  await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  return String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Préparation', type: 'navigateur' } })).jeton);
};

const nadia = await personne('Nadia', 'nadia@exemple.tn');
const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', nadia, { methode: 'application' })).adresseApplication))?.[1] ?? '';
const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Boulangerie Ben Youssef' })).id);
await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
  { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
  { collection: 'catalog', cle: 'pain', rang: 0, revision: null, contenu: { id: 'pain', label: 'Pain de mie', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7 } },
  { collection: 'catalog', cle: 'lait', rang: 1, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
  { collection: 'catalog', cle: 'huile', rang: 2, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
] });
for (const [nom, email] of [['Sami', 'sami@exemple.tn'], ['Leila', 'leila@exemple.tn']] as const) {
  const j = await personne(nom, email);
  const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email, roles: ['caissier'] })).jeton);
  await api('POST', '/invitations/accepter', j, { jeton: inv });
}
fs.mkdirSync(TRAVAIL, { recursive: true });
fs.writeFileSync(`${TRAVAIL}/totp.secret`, secret, { mode: 0o600 });
fs.writeFileSync(`${TRAVAIL}/comptes.txt`, [
  `Boulangerie Ben Youssef (${ent})`, `mot de passe de tous : ${MDP}`,
  'nadia@exemple.tn  propriétaire (code du téléphone : node scripts/humain/code.ts)',
  'sami@exemple.tn   caissier', 'leila@exemple.tn  caissière', '',
].join('\n'));
console.log(fs.readFileSync(`${TRAVAIL}/comptes.txt`, 'utf8'));
