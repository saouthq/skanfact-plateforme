// Un jeu de données inventées pour regarder la console sur le serveur d'essai (Skander, 15/10/2026 : « c'est dur de juger
// une interface vide de données »). Tout passe par les vraies portes du serveur (l'inscription, l'application, la
// console) ; seul l'âge d'un abonnement et de ses relances se pose dans la base, comme le temps l'aurait fait
// (scripts/humain/exemple-console.ts fait de même pour l'essai sur le poste).
//
// Ce qu'il pose : quinze entreprises dans chaque état d'abonnement, deux cabinets, deux membres de l'équipe inventés
// (support et technique, que personne ne peut ouvrir : leur mot de passe est tiré au hasard et jamais écrit, leur code
// jamais gardé), des demandes de support (une urgente, une qui attend la technique, des closes), des appels notés et les
// gestes de la console qui vont avec — chacun avec son motif, au journal, au nom du membre inventé qui l'a fait.
//
// Ce qu'il ne touche pas : le service (ses mesures et sa veille sont celles du vrai serveur), l'entreprise SkanFact de
// « Nos factures » (une fois désignée, elle ne se change plus : c'est à la direction de le faire), les envois à la TTN.
// Les adresses sont en example.com (réservées : rien n'y arrive) ; aucun numéro de téléphone.
//
// Il refuse de reposer ce qu'il a déjà posé (la Clinique Dentaire Amri existe déjà) : il ne s'ajoute jamais deux fois.
//   PG_ADMIN=postgres:///skanfact?host=/var/run/postgresql node scripts/humain/demo-console.ts http://127.0.0.1:<port>
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { ajouter } from '../../base/equipe.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const adresse = process.argv[2] ?? 'http://127.0.0.1:8090';
const admin = process.env.PG_ADMIN;
if (!admin) throw new Error('PG_ADMIN manque : l\'adresse de la base, avec son nom');
// Un mot de passe par personne, tiré au hasard, gardé le temps du script seulement.
const mdp = () => `Demo-${randomBytes(12).toString('base64url')}`;
const courriel = (nom: string) => `${nom}.demo@example.com`;

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
const motsDePasse = new Map<string, string>();
const personne = async (nom: string, email: string) => {
  const m = mdp();
  motsDePasse.set(email, m);
  await api('POST', '/inscription', undefined, { email, nom, motDePasse: m });
  return String((await api('POST', '/connexion', undefined, { email, motDePasse: m, appareil: { nom: 'Jeu de démonstration', type: 'navigateur' } })).jeton);
};
const codeApplication = async (jeton: string) => /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).adresseApplication))?.[1] ?? '';

const c = new pg.Client({ connectionString: admin });
await c.connect();
if ((await c.query(`select 1 from socle.entreprise where raison_sociale = 'Clinique Dentaire Amri'`)).rowCount) {
  console.log('Le jeu de démonstration est déjà posé : rien n\'est ajouté.');
  await c.end();
  process.exit(0);
}

// L'équipe inventée : un support et une technique. Leur session de la console ne sert qu'au temps du script.
const equipe = [
  { cle: 'karim', nom: 'Karim Jaziri', role: 'support' },
  { cle: 'youssef', nom: 'Youssef Trabelsi', role: 'technique' },
] as const;
const sessions: Record<string, string> = {};
for (const m of equipe) {
  const email = courriel(m.cle);
  const j = await personne(m.nom, email);
  const secret = await codeApplication(j);
  await ajouter(c, email, m.role, 'Jeu de démonstration de la console (inventé)');
  const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: motsDePasse.get(email), appareil: { nom: 'Jeu de démonstration', type: 'navigateur' } });
  sessions[m.cle] = String((await api('POST', '/console/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
}
const karim = sessions.karim ?? '';

// Les entreprises : l'abonnement se pose ensuite, comme le temps l'aurait fait ; `relances` : celles que le serveur a
// déjà envoyées pour l'échéance d'aujourd'hui, et il y a combien de jours.
type Etat = { essai: number; paye?: number; offre?: 'essentiel' | 'complet'; periodicite?: 'annuel' | 'mensuel'; resilie?: number; pieces: number; creee: number };
type Fiche = { nom: string; proprio: string; cle: string; ville: string; etat: Etat; relances?: [string, number][] };
const entreprises: Fiche[] = [
  { nom: 'Quincaillerie El Amel', proprio: 'Hédi Gharbi', cle: 'hedi', ville: 'Sfax', etat: { essai: 2, pieces: 0, creee: 28 }, relances: [['j15', 13], ['j7', 5]] },
  { nom: 'Atelier Mejri', proprio: 'Sonia Mejri', cle: 'sonia', ville: 'Nabeul', etat: { essai: -3, pieces: 6, creee: 33 }, relances: [['j15', 18], ['j7', 10], ['j1', 4]] },
  { nom: 'Pharmacie Ennour', proprio: 'Mehdi Ennour', cle: 'mehdi', ville: 'Sousse', etat: { essai: -9, pieces: 3, creee: 39 }, relances: [['j15', 24], ['j7', 16], ['j1', 10], ['lecture_seule', 1]] },
  { nom: 'Clinique Dentaire Amri', proprio: 'Ines Amri', cle: 'ines', ville: 'Tunis', etat: { essai: -200, paye: 165, offre: 'complet', periodicite: 'annuel', pieces: 24, creee: 230 } },
  { nom: 'Librairie Al Kitab', proprio: 'Walid Kitab', cle: 'walid', ville: 'Tunis', etat: { essai: -60, paye: 10, offre: 'essentiel', periodicite: 'mensuel', pieces: 11, creee: 90 }, relances: [['j15', 5]] },
  { nom: 'Boulangerie Essalem', proprio: 'Rania Salem', cle: 'rania', ville: 'Bizerte', etat: { essai: 20, pieces: 2, creee: 10 } },
  { nom: 'Studio Lina', proprio: 'Lina Haddad', cle: 'lina', ville: 'La Marsa', etat: { essai: -40, pieces: 4, creee: 70 } },
  { nom: 'Garage Ben Salah', proprio: 'Nizar Ben Salah', cle: 'nizar', ville: 'Monastir', etat: { essai: 12, pieces: 1, creee: 18 } },
  { nom: 'Menuiserie Hammami', proprio: 'Fethi Hammami', cle: 'fethi', ville: 'Kairouan', etat: { essai: 5, pieces: 0, creee: 25 } },
  { nom: 'Café El Medina', proprio: 'Mounir Medini', cle: 'mounir', ville: 'Tunis', etat: { essai: -380, paye: -20, offre: 'essentiel', periodicite: 'annuel', pieces: 31, creee: 410 }, relances: [['j15', 35], ['j7', 27], ['j1', 21], ['lecture_seule', 12]] },
  { nom: 'Imprimerie Zitouna', proprio: 'Amel Zitouni', cle: 'amel', ville: 'Ariana', etat: { essai: -90, paye: 25, offre: 'complet', periodicite: 'mensuel', resilie: -2, pieces: 18, creee: 120 } },
  { nom: 'Transport Ferchichi', proprio: 'Anis Ferchichi', cle: 'anis', ville: 'Gabès', etat: { essai: 6, pieces: 1, creee: 24 } },
  // Trois inscrites cette semaine, et une abonnée de l'entonnoir (son essai a fini il y a douze jours).
  { nom: 'Fleurs de Carthage', proprio: 'Salma Ben Romdhane', cle: 'salma', ville: 'Carthage', etat: { essai: 28, pieces: 0, creee: 2 } },
  { nom: 'Opticien Jebali', proprio: 'Karim Jebali', cle: 'kjebali', ville: 'Sousse', etat: { essai: 29, pieces: 1, creee: 1 } },
  { nom: 'Traiteur Dar Zmen', proprio: 'Nadia Zmen', cle: 'nadia', ville: 'Hammamet', etat: { essai: -12, paye: 18, offre: 'essentiel', periodicite: 'mensuel', pieces: 12, creee: 42 } },
];
const ids: Record<string, string> = {};
const jetons: Record<string, string> = {};
for (const e of entreprises) {
  const j = await personne(e.proprio, courriel(e.cle));
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
  await c.query(`update socle.entreprise set cree_le = now() - make_interval(days => $2::int), ville = $3 where id = $1`, [id, s.creee, e.ville]);
  await c.query(`update plateforme.abonnement set essai_jusqu_au = current_date + $2::int,
      paye_jusqu_au = case when $3::int is null then null else current_date + $3::int end, offre = $4, periodicite = $5,
      resilie_le = case when $6::int is null then null else current_date + $6::int end
    where entreprise = $1`, [id, s.essai, s.paye ?? null, s.offre ?? null, s.periodicite ?? null, s.resilie ?? null]);
  for (const [rang, ilYA] of e.relances ?? []) {
    await c.query(`insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le)
      select a.entreprise, greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au)), $2, now() - make_interval(days => $3::int, hours => 2)
        from plateforme.abonnement a where a.entreprise = $1`, [id, rang, ilYA]);
  }
}

// Les gestes de la console, faits par le support inventé : son aperçu, son motif, son nom au journal.
const geste = async (jeton: string, nom: string, quoi: string, corps: Record<string, unknown>) => {
  const id = ids[nom] ?? '';
  const fiche = await api('GET', `/console/entreprises/${id}`, jeton);
  await api('POST', `/console/entreprises/${id}/abonnement/${quoi}`, jeton, { ligne: fiche.ligne, ...corps });
};
await geste(karim, 'Menuiserie Hammami', 'prolonger', { jours: 14, motif: 'Il attend son comptable pour reprendre ses factures' });
await api('POST', `/console/entreprises/${ids['Atelier Mejri']}/appels`, karim, { resultat: 'parle', resume: 'Elle hésite entre Essentiel et Complet ; rappeler lundi.' });
await api('POST', `/console/entreprises/${ids['Pharmacie Ennour']}/appels`, karim, { resultat: 'message_laisse', resume: 'Message laissé pour lui rappeler la lecture seule.' });
await api('POST', `/console/entreprises/${ids['Quincaillerie El Amel']}/appels`, karim, { resultat: 'sans_reponse' });

// Les demandes de support : écrites depuis l'application, puis suivies dans la console.
const demande = async (nom: string, sujet: string, texte: string) =>
  String((await api('POST', `/entreprises/${ids[nom]}/support`, jetons[nom], { sujet, texte, version: null, page: null })).id);
const urgente = await demande('Clinique Dentaire Amri', 'La facture ne part pas à la TTN', 'Bonjour, depuis ce matin ma facture reste « en attente » et le patient attend son reçu.');
await api('POST', `/console/support/demandes/${urgente}/priorite`, karim, { priorite: 'urgente', motif: 'Un client bloqué au comptoir' });
const technique = await demande('Librairie Al Kitab', 'L\'export du mois est vide', 'J\'ai exporté le mois de septembre pour mon comptable, le fichier est vide.');
await api('POST', `/console/support/demandes/${technique}/repondre`, karim, { texte: 'Bonjour Walid, je transmets à l\'équipe technique et je reviens vers vous dès que c\'est corrigé.', article: null });
await api('POST', `/console/support/demandes/${technique}/technique`, karim, { attend: true, motif: 'Export du mois vide : à reproduire' });
await demande('Studio Lina', 'Le timbre fiscal ne s\'affiche pas', 'Sur ma dernière facture, je ne vois pas le timbre fiscal. Est-ce normal ?');
const repondue = await demande('Atelier Mejri', 'Comment ajouter mon logo ?', 'Je voudrais mettre le logo de l\'atelier sur mes devis.');
await api('POST', `/console/support/demandes/${repondue}/repondre`, karim, { texte: 'Bonjour Sonia, dans Paramètres › Mon entreprise, le bouton « Logo » le pose sur toutes vos pièces.', article: null });
const close = await demande('Boulangerie Essalem', 'Mot de passe oublié', 'Je n\'arrive plus à me connecter sur la tablette.');
await api('POST', `/console/support/demandes/${close}/repondre`, karim, { texte: 'Bonjour Rania, le lien « Mot de passe oublié » de l\'entrée vous en envoie un nouveau.', article: null });
await api('POST', `/console/support/demandes/${close}/clore`, karim, { motif: 'Réglé : elle s\'est reconnectée' });

// Deux cabinets. Le premier : une collaboratrice, un dossier qu'il tient lui-même, deux clients qui lui ont donné leur
// mandat, une demande qui attend sa réponse. Le second commence : rien encore.
const associe = await personne('Mourad Ben Youssef', courriel('mourad'));
await codeApplication(associe);
const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ben Youssef' });
const cabinet = String(cab.id);
const invitation = await api('POST', `/cabinets/${cabinet}/invitations`, associe, { email: courriel('rim'), role: 'revision' });
await api('POST', '/invitations/accepter', await personne('Rim Saidi', courriel('rim')), { jeton: invitation.jeton });
await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Épicerie Ben Ali' });
for (const nom of ['Clinique Dentaire Amri', 'Librairie Al Kitab']) {
  const m = await api('POST', `/entreprises/${ids[nom]}/mandat`, jetons[nom], { codeCabinet: String(cab.code) });
  await api('POST', `/cabinets/${cabinet}/mandats/${String(m.mandat)}/accepter`, associe);
}
await api('POST', `/entreprises/${ids['Boulangerie Essalem']}/mandat`, jetons['Boulangerie Essalem'], { codeCabinet: String(cab.code) });
const leila = await personne('Leila Nour', courriel('leila'));
await codeApplication(leila);
await api('POST', '/cabinets', leila, { nom: 'Cabinet Nour' });

// Les sessions de la console des membres inventés se ferment : plus personne ne peut agir en leur nom.
for (const j of Object.values(sessions)) await api('POST', '/console/deconnexion', j).catch(() => undefined);
await c.end();
console.log(`Posé : ${entreprises.length} entreprises, 2 cabinets, ${equipe.length} membres inventés de l'équipe, 5 demandes de support, 3 appels.`);
