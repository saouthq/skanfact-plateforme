// Un essai à la main de la console (scripts/humain/lancer.sh ; docs/console.md) : l'équipe SkanFact (une direction et un
// support avec le code du téléphone par application, une technique sans code), huit entreprises inventées dans chaque
// état d'abonnement, et une veille du serveur qui signale deux problèmes. Tout est inventé ; les comptes s'écrivent dans
// /tmp, jamais dans le dépôt. `node scripts/humain/code-console.ts amira` donne le code du téléphone à l'instant.
//   PG_ADMIN=… SKANFACT_VEILLE_FICHIER=/tmp/skanfact-humain-plateforme/veille.json node scripts/humain/exemple-console.ts http://127.0.0.1:8090
import fs from 'node:fs';
import pg from 'pg';
import { ajouter } from '../../base/equipe.ts';

const adresse = process.argv[2] ?? 'http://127.0.0.1:8090';
const TRAVAIL = '/tmp/skanfact-humain-plateforme';
const MDP = 'Un-bon-mot-de-passe';
const admin = process.env.PG_ADMIN;
if (!admin) throw new Error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL');
const base = new URL(admin);
base.pathname = '/skanfact_humain';

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
const codeApplication = async (jeton: string) => /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).adresseApplication))?.[1] ?? '';

const c = new pg.Client({ connectionString: base.toString() });
await c.connect();
fs.mkdirSync(TRAVAIL, { recursive: true });

// L'équipe SkanFact.
const equipe = [
  { prenom: 'amira', nom: 'Amira Ben Salem', email: 'amira@exemple.tn', role: 'direction', code: true },
  { prenom: 'karim', nom: 'Karim Jaziri', email: 'karim@exemple.tn', role: 'support', code: true },
  { prenom: 'youssef', nom: 'Youssef Trabelsi', email: 'youssef@exemple.tn', role: 'technique', code: false },
] as const;
for (const m of equipe) {
  const j = await personne(m.nom, m.email);
  if (m.code) fs.writeFileSync(`${TRAVAIL}/console-${m.prenom}.secret`, await codeApplication(j), { mode: 0o600 });
  await ajouter(c, m.email, m.role, 'Essai de la console à la main');
}

// Les entreprises, chacune avec sa propriétaire ; l'abonnement se pose ensuite, comme le temps l'aurait fait.
type Etat = { essai: number; paye?: number; offre?: 'essentiel' | 'complet'; periodicite?: 'annuel' | 'mensuel'; offert?: boolean; suspendu?: number; pieces: number };
const entreprises: { nom: string; proprio: string; email: string; etat: Etat }[] = [
  { nom: 'Quincaillerie El Amel', proprio: 'Hédi Gharbi', email: 'hedi@exemple.tn', etat: { essai: 2, pieces: 0 } },
  { nom: 'Atelier Mejri', proprio: 'Sonia Mejri', email: 'sonia@exemple.tn', etat: { essai: -3, pieces: 6 } },
  { nom: 'Pharmacie Ennour', proprio: 'Mehdi Ennour', email: 'mehdi@exemple.tn', etat: { essai: -9, pieces: 3 } },
  { nom: 'Clinique Dentaire Amri', proprio: 'Ines Amri', email: 'ines@exemple.tn', etat: { essai: -200, paye: 165, offre: 'complet', periodicite: 'annuel', pieces: 24 } },
  { nom: 'Librairie Al Kitab', proprio: 'Walid Kitab', email: 'walid@exemple.tn', etat: { essai: -60, paye: 10, offre: 'essentiel', periodicite: 'mensuel', pieces: 11 } },
  { nom: 'Boulangerie Essalem', proprio: 'Rania Salem', email: 'rania@exemple.tn', etat: { essai: 20, pieces: 2 } },
  { nom: 'Studio Lina', proprio: 'Lina Haddad', email: 'lina@exemple.tn', etat: { essai: -40, offert: true, pieces: 4 } },
  { nom: 'Garage Ben Salah', proprio: 'Nizar Ben Salah', email: 'nizar@exemple.tn', etat: { essai: 12, suspendu: -1, pieces: 1 } },
];
for (const e of entreprises) {
  const j = await personne(e.proprio, e.email);
  const id = String((await api('POST', '/entreprises', j, { raisonSociale: e.nom })).id);
  await api('GET', `/entreprises/${id}/dossier-v10`, j);
  if (e.etat.pieces) {
    await api('POST', `/entreprises/${id}/dossier-v10`, j, { changements: Array.from({ length: e.etat.pieces }, (_, i) => ({
      collection: 'documents', cle: `d${i}`, rang: i, revision: null,
      contenu: { id: `d${i}`, type: 'devis', number: '', status: 'brouillon', date: '2026-10-01', clientId: '', currency: 'DT', lines: [] },
    })) });
  }
  const s = e.etat;
  await c.query(`update plateforme.abonnement set essai_jusqu_au = current_date + $2::int,
      paye_jusqu_au = case when $3::int is null then null else current_date + $3::int end, offre = $4, periodicite = $5,
      offert = $6, suspendu_le = case when $7::int is null then null else current_date + $7::int end
    where entreprise = $1`, [id, s.essai, s.paye ?? null, s.offre ?? null, s.periodicite ?? null, s.offert ?? false, s.suspendu ?? null]);
}
await c.end();

// La veille du serveur : deux problèmes, dont un grave.
const veille = process.env.SKANFACT_VEILLE_FICHIER ?? `${TRAVAIL}/veille.json`;
fs.writeFileSync(veille, JSON.stringify({ problemes: {
  disque: { titre: 'Le disque est plein à 82 %', grave: false, faire: 'Libère de la place, ou agrandis le disque avant 90 %.', depuis: new Date(Date.now() - 3 * 3600_000).toISOString() },
  sauvegarde: { titre: 'La copie hors machine de cette nuit n\'est pas arrivée', grave: true, faire: 'Relance la sauvegarde, puis vérifie la copie.', depuis: new Date(Date.now() - 40 * 60_000).toISOString() },
} }, null, 2));
fs.writeFileSync(`${TRAVAIL}/comptes-console.txt`, [
  `console : ${adresse}/console/`, `mot de passe de tous : ${MDP}`,
  ...equipe.map((m) => `${m.email}  ${m.role}${m.code ? ` (code : node scripts/humain/code-console.ts ${m.prenom})` : ' (sans code du téléphone)'}`),
  `veille : ${veille} (touch le fichier pour qu'elle reste « vivante »)`, '',
].join('\n'));
console.log(fs.readFileSync(`${TRAVAIL}/comptes-console.txt`, 'utf8'));
