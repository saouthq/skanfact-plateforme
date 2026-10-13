// Un essai à la main de la console (scripts/humain/lancer.sh ; docs/console.md) : l'équipe SkanFact (une direction et un
// support avec le code du téléphone par application, une technique sans code), douze entreprises inventées dans chaque
// état d'abonnement — avec les relances parties comme le serveur les pose, et les gestes faits par la console elle-même
// (une prolongation par le support, un abonnement offert, une suspension) —, deux cabinets (l'un avec ses collaborateurs,
// un dossier qu'il tient, deux clients et une demande en attente ; l'autre qui commence), et une veille du serveur qui
// signale deux problèmes. Tout est inventé ; les comptes s'écrivent dans /tmp, jamais dans le dépôt.
// `node scripts/humain/code-console.ts amira` donne le code du téléphone à l'instant.
//   PG_ADMIN=… SKANFACT_VEILLE_FICHIER=/tmp/skanfact-humain-plateforme/veille.json node scripts/humain/exemple-console.ts http://127.0.0.1:8090
import fs from 'node:fs';
import pg from 'pg';
import { ajouter } from '../../base/equipe.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

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
const secrets: Record<string, string> = {};
for (const m of equipe) {
  const j = await personne(m.nom, m.email);
  if (m.code) {
    secrets[m.prenom] = await codeApplication(j);
    fs.writeFileSync(`${TRAVAIL}/console-${m.prenom}.secret`, secrets[m.prenom] ?? '', { mode: 0o600 });
  }
  await ajouter(c, m.email, m.role, 'Essai de la console à la main');
}
// Une session de la console, comme l'entrée la donne : le mot de passe, puis le code du téléphone.
const sessionConsole = async (prenom: 'amira' | 'karim') => {
  const m = equipe.find((x) => x.prenom === prenom);
  const r = await api('POST', '/console/connexion', undefined, { email: m?.email, motDePasse: MDP, appareil: { nom: 'Préparation', type: 'navigateur' } });
  return String((await api('POST', '/console/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secrets[prenom] ?? ''), Date.now()) })).jeton);
};

// Les entreprises, chacune avec sa propriétaire ; l'abonnement se pose ensuite, comme le temps l'aurait fait. `relances` :
// celles que le serveur a déjà envoyées pour l'échéance d'aujourd'hui, et il y a combien de jours.
type Etat = { essai: number; paye?: number; offre?: 'essentiel' | 'complet'; periodicite?: 'annuel' | 'mensuel'; resilie?: number; pieces: number };
type Fiche = { nom: string; proprio: string; email: string; etat: Etat; relances?: [string, number][] };
const entreprises: Fiche[] = [
  { nom: 'Quincaillerie El Amel', proprio: 'Hédi Gharbi', email: 'hedi@exemple.tn', etat: { essai: 2, pieces: 0 }, relances: [['j15', 13], ['j7', 5]] },
  { nom: 'Atelier Mejri', proprio: 'Sonia Mejri', email: 'sonia@exemple.tn', etat: { essai: -3, pieces: 6 }, relances: [['j15', 18], ['j7', 10], ['j1', 4]] },
  { nom: 'Pharmacie Ennour', proprio: 'Mehdi Ennour', email: 'mehdi@exemple.tn', etat: { essai: -9, pieces: 3 }, relances: [['j15', 24], ['j7', 16], ['j1', 10], ['lecture_seule', 1]] },
  { nom: 'Clinique Dentaire Amri', proprio: 'Ines Amri', email: 'ines@exemple.tn', etat: { essai: -200, paye: 165, offre: 'complet', periodicite: 'annuel', pieces: 24 } },
  { nom: 'Librairie Al Kitab', proprio: 'Walid Kitab', email: 'walid@exemple.tn', etat: { essai: -60, paye: 10, offre: 'essentiel', periodicite: 'mensuel', pieces: 11 }, relances: [['j15', 5]] },
  { nom: 'Boulangerie Essalem', proprio: 'Rania Salem', email: 'rania@exemple.tn', etat: { essai: 20, pieces: 2 } },
  { nom: 'Studio Lina', proprio: 'Lina Haddad', email: 'lina@exemple.tn', etat: { essai: -40, pieces: 4 } },
  { nom: 'Garage Ben Salah', proprio: 'Nizar Ben Salah', email: 'nizar@exemple.tn', etat: { essai: 12, pieces: 1 } },
  { nom: 'Menuiserie Hammami', proprio: 'Fethi Hammami', email: 'fethi@exemple.tn', etat: { essai: 5, pieces: 0 } },
  { nom: 'Café El Medina', proprio: 'Mounir Medini', email: 'mounir@exemple.tn', etat: { essai: -380, paye: -20, offre: 'essentiel', periodicite: 'annuel', pieces: 31 }, relances: [['j15', 35], ['j7', 27], ['j1', 21], ['lecture_seule', 12]] },
  { nom: 'Imprimerie Zitouna', proprio: 'Amel Zitouni', email: 'amel@exemple.tn', etat: { essai: -90, paye: 25, offre: 'complet', periodicite: 'mensuel', resilie: -2, pieces: 18 } },
  { nom: 'Transport Ferchichi', proprio: 'Anis Ferchichi', email: 'anis@exemple.tn', etat: { essai: 6, pieces: 1 } },
];
const ids: Record<string, string> = {};
const jetons: Record<string, string> = {};
for (const e of entreprises) {
  const j = await personne(e.proprio, e.email);
  const id = String((await api('POST', '/entreprises', j, { raisonSociale: e.nom })).id);
  ids[e.nom] = id;
  jetons[e.nom] = j;
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
      resilie_le = case when $6::int is null then null else current_date + $6::int end
    where entreprise = $1`, [id, s.essai, s.paye ?? null, s.offre ?? null, s.periodicite ?? null, s.resilie ?? null]);
  // Les relances parties pour l'échéance d'aujourd'hui : la fin de l'essai, ou de la période payée si elle va plus loin.
  for (const [rang, ilYA] of e.relances ?? []) {
    await c.query(`insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le)
      select a.entreprise, greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au)), $2, now() - make_interval(days => $3::int, hours => 2)
        from plateforme.abonnement a where a.entreprise = $1`, [id, rang, ilYA]);
  }
}

// Les gestes de la console, faits par la console : son aperçu, son motif, son auteur au journal.
const geste = async (jeton: string, nom: string, quoi: string, corps: Record<string, unknown>) => {
  const id = ids[nom] ?? '';
  const fiche = await api('GET', `/console/entreprises/${id}`, jeton);
  await api('POST', `/console/entreprises/${id}/abonnement/${quoi}`, jeton, { ligne: fiche.ligne, ...corps });
};
const karim = await sessionConsole('karim');
await geste(karim, 'Menuiserie Hammami', 'prolonger', { jours: 14, motif: 'Il attend son comptable pour reprendre ses factures' });
const amira = await sessionConsole('amira');
await geste(amira, 'Studio Lina', 'offrir', { motif: 'Pilote jusqu\'au 31/12/2026' });
await geste(amira, 'Garage Ben Salah', 'suspendre', { motif: 'Chèque sans provision, en attente d\'un virement' });

// Deux cabinets. Le premier : un associé et une collaboratrice, un dossier qu'il tient lui-même, deux clients qui lui
// ont donné leur mandat, une demande qui attend sa réponse. Le second commence : rien encore.
const associe = await personne('Mourad Ben Youssef', 'mourad@exemple.tn');
await codeApplication(associe);
const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ben Youssef' });
const cabinet = String(cab.id);
const invitation = await api('POST', `/cabinets/${cabinet}/invitations`, associe, { email: 'rim@exemple.tn', role: 'revision' });
await api('POST', '/invitations/accepter', await personne('Rim Saidi', 'rim@exemple.tn'), { jeton: invitation.jeton });
await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Épicerie Ben Ali' });
for (const nom of ['Clinique Dentaire Amri', 'Librairie Al Kitab']) {
  const m = await api('POST', `/entreprises/${ids[nom]}/mandat`, jetons[nom], { codeCabinet: String(cab.code) });
  await api('POST', `/cabinets/${cabinet}/mandats/${String(m.mandat)}/accepter`, associe);
}
await api('POST', `/entreprises/${ids['Boulangerie Essalem']}/mandat`, jetons['Boulangerie Essalem'], { codeCabinet: String(cab.code) });
const leila = await personne('Leila Nour', 'leila@exemple.tn');
await codeApplication(leila);
await api('POST', '/cabinets', leila, { nom: 'Cabinet Nour' });
await c.end();

// La veille du serveur : deux problèmes, dont un grave, écrits comme elle les écrit (exploitation/veille.ts : la clé, le
// titre en bas de casse, le nombre de relevés qui les ont vus). scripts/humain/exemple-service.ts réécrit ce fichier par
// les vraies règles de la veille, avec le mois de mesures qui va avec.
const veille = process.env.SKANFACT_VEILLE_FICHIER ?? `${TRAVAIL}/veille.json`;
const ilYA = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
fs.writeFileSync(veille, JSON.stringify({ problemes: {
  'disque:/var': { titre: 'le disque /var est plein à 76 %', grave: false, vus: 180, ditLe: ilYA(180), depuis: ilYA(180),
    faire: 'Au-delà, la base s\'arrête d\'écrire : libère de la place ou agrandis le disque chez l\'hébergeur (docs/mise-en-ligne.md, I).' },
  'hors-machine': { titre: 'la copie hors de la machine est en retard de 96 minutes', grave: true, vus: 80, ditLe: ilYA(80), depuis: ilYA(80),
    faire: 'Sur le serveur : sudo systemctl status skanfact-hors-machine ; le détail : /var/lib/skanfact/hors-machine/hors-machine.json (docs/mise-en-ligne.md, I).' },
} }, null, 2));
fs.writeFileSync(`${TRAVAIL}/comptes-console.txt`, [
  `console : ${adresse}/console/`, `mot de passe de tous : ${MDP}`,
  ...equipe.map((m) => `${m.email}  ${m.role}${m.code ? ` (code : node scripts/humain/code-console.ts ${m.prenom})` : ' (sans code du téléphone)'}`),
  `veille : ${veille} (touch le fichier pour qu'elle reste « vivante »)`, '',
].join('\n'));
console.log(fs.readFileSync(`${TRAVAIL}/comptes-console.txt`, 'utf8'));
