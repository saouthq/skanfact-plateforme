// Un essai à la main du Cabinet, comme les maquettes de « Mon cabinet » le dessinent (docs/maquettes/cabinet/) : le
// cabinet Jlassi Conseil, sa direction (Leïla Jlassi, associée), sa tenue des dossiers (Anis Gharbi) et sa saisie (Rim
// Toumi) ; dix clients sur SkanFact qui lui ont donné leur mandat et deux dossiers qu'il tient lui-même ; qui suit quoi,
// qui valide quoi ; les pièces que les clients ont envoyées et leurs messages. Tout est inventé ; les comptes s'écrivent
// dans /tmp, jamais dans le dépôt.
//   PG_ADMIN=… node scripts/humain/exemple-cabinet.ts http://127.0.0.1:8090
import fs from 'node:fs';

const adresse = process.argv[2] ?? 'http://127.0.0.1:8090';
const TRAVAIL = '/tmp/skanfact-humain-plateforme';
const MDP = 'Un-bon-mot-de-passe';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
const jetons: Record<string, string> = {};
const personne = async (nom: string, email: string) => {
  await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Préparation', type: 'navigateur' } })).jeton);
  // Le code du téléphone par application : le rôle de la direction l'exige, et chacun l'a comme sur un vrai poste.
  await api('POST', '/moi/code', j, { methode: 'application' });
  jetons[email] = j;
  return j;
};
fs.mkdirSync(TRAVAIL, { recursive: true });

// L'équipe : la direction crée le cabinet et invite les deux autres.
const leila = await personne('Leïla Jlassi', 'leila.jlassi@exemple.tn');
const cab = await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' });
const cabinet = String(cab.id);
const membre: Record<string, string> = {};
for (const [nom, email, role] of [['Anis Gharbi', 'anis.gharbi@exemple.tn', 'revision'], ['Rim Toumi', 'rim.toumi@exemple.tn', 'saisie']] as const) {
  const inv = await api('POST', `/cabinets/${cabinet}/invitations`, leila, { email, role });
  await api('POST', '/invitations/accepter', await personne(nom, email), { jeton: inv.jeton });
}
const equipe = await api('GET', `/cabinets/${cabinet}/equipe`, leila) as { membres: { membre: string; nom: string }[] };
for (const m of equipe.membres) membre[m.nom.split(' ')[0] ?? m.nom] = m.membre;

// Les douze dossiers. `suit` : qui le tient au quotidien ; `valide` : la direction qui valide le travail de la saisie.
type Dossier = { cle: string; nom: string; gerant?: string; email?: string; suit: 'Leïla' | 'Anis' | 'Rim'; valide?: 'Leïla' };
const DOSSIERS: Dossier[] = [
  { cle: 'be', nom: 'Boulangerie El Amal', gerant: 'Sarra Mansour', email: 'sarra@boulangerie-elamal.tn', suit: 'Anis' },
  { cle: 'mb', nom: 'Menuiserie Ben Ali', gerant: 'Hédi Ben Ali', email: 'hedi@menuiserie-benali.tn', suit: 'Leïla' },
  { cle: 'gt', nom: 'Garage Triki', gerant: 'Sami Triki', email: 'sami@garage-triki.tn', suit: 'Leïla' },
  { cle: 'an', nom: 'Atelier Numérique Sfax', gerant: 'Karim Zouari', email: 'karim@atelier-numerique.tn', suit: 'Leïla' },
  { cle: 'dz', nom: 'Café Dar Zitouna', gerant: 'Walid Ferchichi', email: 'walid@dar-zitouna.tn', suit: 'Anis' },
  { cle: 'le', nom: 'Librairie Ennour', gerant: 'Amel Nouri', email: 'amel@librairie-ennour.tn', suit: 'Anis' },
  { cle: 'pe', nom: 'Pharmacie El Menzah', gerant: 'Nour Ayari', email: 'nour@pharmacie-elmenzah.tn', suit: 'Anis' },
  { cle: 'sp', nom: 'Studio Photo Lumière', gerant: 'Ines Gharsalli', email: 'ines@studio-lumiere.tn', suit: 'Anis' },
  { cle: 'ic', nom: 'Imprimerie Carthage', gerant: 'Mehdi Ferjani', email: 'mehdi@imprimerie-carthage.tn', suit: 'Rim', valide: 'Leïla' },
  { cle: 'iy', nom: 'Institut Yasmine', gerant: 'Yasmine Dridi', email: 'yasmine@institut-yasmine.tn', suit: 'Rim', valide: 'Leïla' },
  { cle: 'sm', nom: 'SARL Mansour Distribution', suit: 'Leïla' },
  { cle: 'cj', nom: 'Clinique Les Jasmins', suit: 'Leïla' },
];
const entreprise: Record<string, string> = {};
const gerant: Record<string, string> = {};
for (const d of DOSSIERS) {
  if (d.gerant && d.email) {
    const j = await personne(d.gerant, d.email);
    const id = String((await api('POST', '/entreprises', j, { raisonSociale: d.nom })).id);
    // Le café saisit lui-même ses achats : il ne confie au cabinet que la comptabilité et les déclarations ; quatre clients
    // lui confient aussi leur paie.
    const perimetre = d.cle === 'dz' ? ['comptabilite', 'declarations'] : ['be', 'gt', 'pe', 'ic'].includes(d.cle) ? ['comptabilite', 'declarations', 'saisie_achats', 'paie'] : null;
    const m = await api('POST', `/entreprises/${id}/mandat`, j, { codeCabinet: String(cab.code), ...(perimetre ? { perimetre } : {}) });
    await api('POST', `/cabinets/${cabinet}/mandats/${String(m.mandat)}/accepter`, leila);
    entreprise[d.cle] = id;
    gerant[d.cle] = j;
  } else {
    entreprise[d.cle] = String((await api('POST', `/cabinets/${cabinet}/dossiers`, leila, { raisonSociale: d.nom })).entreprise);
  }
}
const portefeuille = await api('GET', `/cabinets/${cabinet}/portefeuille`, leila) as { dossiers: { mandat: string; entreprise: string }[] };
const mandatDe = (cle: string) => portefeuille.dossiers.find((x) => x.entreprise === entreprise[cle])?.mandat ?? '';
for (const d of DOSSIERS) {
  const qui = membre[d.suit];
  if (qui) await api('PUT', `/cabinets/${cabinet}/mandats/${mandatDe(d.cle)}/affectations/${qui}`, leila, { role: d.suit === 'Rim' ? 'saisie' : 'revision' });
  if (d.valide && membre.Leïla) await api('PUT', `/cabinets/${cabinet}/mandats/${mandatDe(d.cle)}/affectations/${membre.Leïla}`, leila, { role: 'supervision' });
}

// La fiche de chaque dossier au cabinet : le contact, son téléphone, les honoraires par mois (HT, en millimes), comme la maquette.
// (1.169.0) Et sa forme, sa ville, la fonction du contact.
const FICHES: Record<string, [string, string, number, string, string, string]> = {
  be: ['Sarra', '22 53 10 84', 450000, 'SARL', 'Tunis', 'responsable'], mb: ['Hédi', '98 41 22 07', 350000, 'SARL', 'Ben Arous', 'responsable'],
  gt: ['Sami', '55 08 47 19', 400000, 'SUARL', 'La Marsa', 'responsable'], an: ['Karim', '58 39 70 21', 380000, 'SUARL', 'Sfax', 'responsable'],
  dz: ['Walid', '29 77 03 52', 300000, 'SUARL', 'Tunis', 'responsable'], le: ['Amel', '50 64 18 93', 250000, 'SARL', 'Ariana', 'responsable'],
  pe: ['Nour', '98 15 62 40', 650000, 'SARL', 'El Menzah', 'titulaire'], sp: ['Ines', '93 07 52 68', 150000, 'Personne physique', 'Tunis', 'photographe'],
  ic: ['Mehdi', '22 90 47 15', 420000, 'SARL', 'Ben Arous', 'comptable interne'], iy: ['Yasmine', '27 41 86 09', 180000, 'Personne physique', 'Nabeul', 'responsable'],
  sm: ['Nabil', '74 22 61 30', 900000, 'SARL', 'Sfax', 'responsable'], cj: ['Salma', '71 80 25 46', 1200000, 'SA', 'Tunis', 'responsable'],
};
const ACTIVITES: Record<string, string> = { be: 'boulangerie-pâtisserie', mb: 'menuiserie bois', gt: 'garage automobile', an: 'services numériques', dz: 'café',
  le: 'librairie-papeterie', pe: 'pharmacie', sp: 'studio photo', ic: 'imprimerie', iy: 'institut de beauté', sm: 'distribution alimentaire', cj: 'clinique' };
// La fiche peut déjà exister (le serveur dit alors sa révision) : on la reprend, sans rien écraser d'autre.
const poserFiche = async (ent: string, contenu: Record<string, unknown>) => {
  for (let i = 0, revision: number | null = null; i < 2; i++) {
    const r = await fetch(`${adresse}/v1/cabinets/${cabinet}/fiches/${ent}`, { method: 'PUT', headers: { authorization: `Bearer ${leila}`, 'content-type': 'application/json' }, body: JSON.stringify({ contenu, revision }) });
    if (r.ok) return;
    const lu = await r.json() as { revision?: number | null };
    if (r.status !== 409) throw new Error(`PUT fiche ${ent} : ${r.status}`);
    revision = lu.revision ?? null;
  }
};
// Les livres, mois par mois de janvier à septembre, comme les maquettes les dessinent : F déclaré et déposé, D révisé
// et prêt à déposer, P préparé, R au brouillard (à réviser), S tenu et pas encore saisi, M rien reçu, H avant la mission.
const LIVRES: Record<string, string> = { be: 'FFFFFFFRR', mb: 'FFFFFFFMM', gt: 'FFFFFFFFD', an: 'HHHHHFFFR', dz: 'FFFFFFFFM', le: 'FFFFFFFFM',
  pe: 'FFFFFFFFR', sp: 'FFFFFFFFF', ic: 'FFFFFFFFP', iy: 'FFFFFFFFD', sm: 'FFFFFFFFF', cj: 'FFFFFFFFS' };
const mois = (i: number) => `2026-${String(i + 1).padStart(2, '0')}`;
for (const d of DOSSIERS) {
  const ent = entreprise[d.cle] ?? '';
  const g = LIVRES[d.cle] ?? '';
  const debut = Math.max(0, g.search(/[^H]/));
  const f = FICHES[d.cle];
  await poserFiche(ent, { from: mois(debut), ...(f ? { contact: f[0], phone: f[1], ...(d.email ? { email: d.email } : {}), fees: f[2], forme: f[3], ville: f[4], fonction: f[5], activite: ACTIVITES[d.cle] ?? '' } : {}) });
  for (let i = 0; i < g.length; i++) {
    const e = g[i];
    if (!e || 'MSH'.includes(e)) continue;
    const montant = `${300 + i * 17},${String(125 + i * 3).padStart(3, '0')}`;
    const ecriture = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: `${mois(i)}-18`, journal: 'OD', piece: `OD-${i + 1}`,
      libelle: 'Honoraires du mois', lignes: [{ compte: '6226', debit: montant }, { compte: '4286', credit: montant }] })).id);
    if (e === 'R') continue;
    await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: [ecriture] });
    await api('PUT', `/cabinets/${cabinet}/revisions/${ent}/${mois(i)}`, leila, {
      contenu: { faite: true, faiteLe: Date.parse(`${mois(i + 1)}-20T09:00:00Z`), faitePar: d.suit, comptes: [], notes: [], questionnaire: [] }, revision: null });
    if (e === 'D') continue;
    // P : la déclaration est préparée, pas encore déposée.
    await api('PUT', `/entreprises/${ent}/compta/declarations/${mois(i)}`, leila, { cases: { tvaCollectee: montant, aDecaisser: montant } });
    if (e === 'P') continue;
    await api('POST', `/entreprises/${ent}/compta/declarations/${mois(i)}/pointer`, leila, { quoi: 'deposee', le: `${mois(i + 1)}-26` });
    // Payée aussi, sauf la dernière du studio photo (déposée, pas encore payée).
    if (!(d.cle === 'sp' && i === g.length - 1)) await api('POST', `/entreprises/${ent}/compta/declarations/${mois(i)}/pointer`, leila, { quoi: 'payee', le: `${mois(i + 1)}-27` });
  }
}

// Les pièces elles-mêmes, lisibles comme de vraies pièces : une facture, un relevé, un ticket, un document, dessinés par
// le navigateur de la machine (une photo en PNG, un PDF imprimé). Sans navigateur, une image d'un point.
const papier = (nom: string, dossier: string): string => {
  const ligne = (a: string, b: string) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const css = '<style>body{margin:0;font:13px Helvetica,Arial,sans-serif;color:#23272e}.f{width:520px;padding:28px 30px;background:#fff}'
    + 'h1{font-size:15px;margin:0 0 2px;letter-spacing:.02em}.s{color:#5b616b;margin-bottom:14px;border-bottom:1.5px solid #23272e;padding-bottom:8px}'
    + 'table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dotted #c8cdd4}td:last-child{text-align:right}'
    + '.t td{font-weight:800;border-top:1.5px solid #23272e;border-bottom:0}.p{color:#5b616b;font-size:11px;margin-top:12px}</style>';
  if (/relev/i.test(nom)) return `${css}<div class="f"><h1>RELEVÉ DE COMPTE</h1><div class="s">Compte courant · ${dossier} · septembre 2026 · page 1 sur 1</div><table>`
    + ['01/09|Solde au 31/08||8 412,605', '03/09|Versement espèces||2 300,000', '05/09|Chèque 4410 081|1 846,200|', '10/09|Prélèvement CNSS|612,480|', '12/09|Virement reçu|1 190,000|', '15/09|Frais de tenue de compte|11,900|', '22/09|Versement espèces||1 950,000']
      .map((x) => { const [a, b, c, d] = x.split('|'); return `<tr><td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`; }).join('') + '</table></div>';
  if (/ticket/i.test(nom)) return `${css}<div class="f" style="width:300px;font-family:monospace"><h1>STATION-SERVICE ROUTE DE BIZERTE</h1><div class="s">24/09/2026 · 07:42 · pompe 3</div><table>`
    + ligne('Gasoil sans soufre', '') + ligne('27,90 L × 2,150', '60,000') + '<tr class="t"><td>TOTAL DT</td><td>60,000</td></tr>' + ligne('Espèces', '60,000') + '</table><div class="p">Merci de votre visite · ticket n° 118 042</div></div>';
  if (/contrat|bail|attestation/i.test(nom)) return `${css}<div class="f"><h1>${/attestation/i.test(nom) ? 'ATTESTATION DE SITUATION' : 'CONTRAT DE LOCATION D\'UN LOCAL COMMERCIAL'}</h1><div class="s">${dossier} · page 1 sur 1</div>`
    + '<p>Le présent document est établi pour servir et valoir ce que de droit. Durée : trois ans, du 1er janvier 2027 au 31 décembre 2029.</p><p>Loyer mensuel : 1 450,000 dinars hors taxes, payable d\'avance le 5 de chaque mois.</p></div>';
  const [f, n, l] = /electricite/i.test(nom) ? ['STEG · FACTURE D\'ÉLECTRICITÉ ET DE GAZ', 'N° 0298 4471 · du 01/08 au 30/09/2026', [['Consommation électricité (3 120 kWh)', '142,318'], ['Redevances et location du compteur', '22,655']]]
    : /farine/i.test(nom) ? ['MINOTERIE DU CAP BON', 'Facture n° MC-3391 du 03/09/2026', [['Farine boulangère T55, 40 sacs', '1 520,000'], ['Transport', '32,000']]]
    : /lait/i.test(nom) ? ['CENTRALE LAITIÈRE DU NORD', 'Facture n° CL-20981 du 02/10/2026', [['Lait demi-écrémé, 240 L', '312,000']]]
    : /hebergement/i.test(nom) ? ['OVH SAS', 'Invoice FR-41720 · 30/09/2026 · EUR', [['Hébergement serveur, 3e trimestre', '87,00 €']]]
    : ['FOURNITURES EL AMEN', 'Facture n° FA-0921 du 22/10/2026', [['Fournitures diverses', '186,420']]];
  // Le total : la somme des lignes, au millime (les montants s'écrivent « 1 520,000 »).
  const millimes = l.reduce((t, x) => t + Math.round(Number(String(x[1]).replace(/[^\d,]/g, '').replace(',', '.')) * 1000), 0);
  const total = /€/.test(l[0]?.[1] ?? '') ? l[0]?.[1] ?? '' : `${Math.trunc(millimes / 1000).toLocaleString('fr-FR').replace(/\u202f/g, ' ')},${String(millimes % 1000).padStart(3, '0')}`;
  return `${css}<div class="f"><h1>${f}</h1><div class="s">${n} · client : ${dossier}</div><table>${l.map(([a, b]) => ligne(a, b)).join('')}`
    + `<tr class="t"><td>Total hors taxes</td><td>${total}</td></tr></table><div class="p">Payable à 30 jours · TVA selon le taux en vigueur</div></div>`;
};
type Feuille = { setContent: (h: string) => Promise<void>; pdf: (o: object) => Promise<Buffer>; close: () => Promise<void>;
  locator: (s: string) => { screenshot: (o: object) => Promise<Buffer> } };
let navigateur: { newPage: () => Promise<Feuille>; close: () => Promise<void> } | null = null;
try {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright-core');
  const chemin = fs.readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
  navigateur = await chromium.launch(chemin ? { executablePath: `/opt/pw-browsers/${chemin}/chrome-linux/chrome` } : {});
} catch { navigateur = null; }
const fichierDe = async (nom: string, dossier: string): Promise<string> => {
  if (!navigateur) return PNG;
  const page = await navigateur.newPage();
  await page.setContent(papier(nom, dossier));
  const octets: Buffer = /\.pdf$/i.test(nom) ? await page.pdf({ width: '580px', height: '760px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    : await page.locator('.f').screenshot({ type: 'png' });
  await page.close();
  return octets.toString('base64');
};

// Ce que les clients ont envoyé : des pièces (une photo, un PDF) et des messages.
const envoyer = async (cle: string, fichiers: string[], texte: string, repond: Record<string, string> = {}) => {
  const j = gerant[cle] ?? '';
  const id = entreprise[cle] ?? '';
  for (const nom of fichiers) {
    const f = await api('POST', `/entreprises/${id}/messages/fichiers`, j, { cote: 'entreprise', nom, contenu: await fichierDe(nom, DOSSIERS.find((x) => x.cle === cle)?.nom ?? '') });
    await api('POST', `/entreprises/${id}/messages`, j, { cote: 'entreprise', texte: '', fichier: f.id, repondA: repond[nom] ?? null });
  }
  if (texte) await api('POST', `/entreprises/${id}/messages`, j, { cote: 'entreprise', texte });
};
// Ce que le cabinet a demandé à la boulangerie : le relevé arrive en réponse, l'attestation est encore attendue.
const demandes = await api('POST', `/entreprises/${entreprise.be}/messages`, leila, { cote: 'cabinet', texte: 'Bonjour Sarra, pour boucler septembre il me manque :',
  demandes: ['Le relevé BIAT de septembre', 'L\'attestation CNSS du 3e trimestre'], pour: '2026-10-31' }) as { ids: string[] };
await envoyer('be', ['facture-electricite-septembre.jpg', 'Releve_BIAT_09-2026.pdf', 'ticket-carburant-24-09.jpg', 'facture-farine-0903.pdf'], 'Bonjour, voici les pièces de septembre. La facture d\'août de la STEG, je la cherche encore.',
  { 'Releve_BIAT_09-2026.pdf': demandes.ids[0] ?? '' });
await envoyer('dz', ['facture-lait-octobre.pdf', 'IMG_2207.jpg'], '');
await envoyer('pe', ['Releve_ATB_09-2026.pdf', 'contrat-bail-2027.pdf'], 'Le nouveau bail, pour info.');
await envoyer('iy', ['IMG_0412.jpg', 'IMG_0413.jpg', 'attestation-CNSS.pdf'], '');
await envoyer('gt', [], 'Bonjour, j\'ai annulé la facture de juillet par erreur. Que faut-il faire ?');
await envoyer('an', ['facture-hebergement-T3.pdf'], 'Payée en euros par carte.');
// (1.169.0) Ce que la maquette des Dossiers montre aussi : un hôtel qui propose son dossier (pas encore accepté), et un
// dossier archivé (la fin de sa mission).
const mounir = await personne('Mounir Ben Hassen', 'mounir@hotel-lespins.tn');
const hotel = String((await api('POST', '/entreprises', mounir, { raisonSociale: 'Hôtel Les Pins' })).id);
await api('POST', `/entreprises/${hotel}/mandat`, mounir, { codeCabinet: String(cab.code), perimetre: ['comptabilite', 'declarations', 'paie'] });
const mejri = String((await api('POST', `/cabinets/${cabinet}/dossiers`, leila, { raisonSociale: 'Transport Mejri' })).entreprise);
await poserFiche(mejri, { contact: 'Lotfi', forme: 'SARL', ville: 'Bizerte', fonction: 'gérant', archived: true });
await navigateur?.close();

fs.writeFileSync(`${TRAVAIL}/comptes-cabinet.txt`, [
  `cabinet : ${adresse}/v10/cabinet/?c=${cabinet}`, `mot de passe de tous : ${MDP}`,
  'leila.jlassi@exemple.tn  direction (associée)', 'anis.gharbi@exemple.tn  tenue des dossiers', 'rim.toumi@exemple.tn  saisie', '',
].join('\n'));
fs.writeFileSync(`${TRAVAIL}/cabinet.json`, JSON.stringify({ cabinet, adresse, jetons: { leila, anis: jetons['anis.gharbi@exemple.tn'], rim: jetons['rim.toumi@exemple.tn'] }, entreprise }, null, 1), { mode: 0o600 });
console.log(fs.readFileSync(`${TRAVAIL}/comptes-cabinet.txt`, 'utf8'));
