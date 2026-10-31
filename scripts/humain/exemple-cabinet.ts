// Un essai à la main du Cabinet, comme les maquettes de « Mon cabinet » le dessinent (docs/maquettes/cabinet/) : le
// cabinet Jlassi Conseil, sa direction (Leïla Jlassi, associée), sa tenue des dossiers (Anis Gharbi) et sa saisie (Rim
// Toumi) ; dix clients sur SkanFact qui lui ont donné leur mandat et deux dossiers qu'il tient lui-même ; qui suit quoi,
// qui valide quoi ; les pièces que les clients ont envoyées et leurs messages. Tout est inventé ; les comptes s'écrivent
// dans /tmp, jamais dans le dépôt.
//   PG_ADMIN=… node scripts/humain/exemple-cabinet.ts http://127.0.0.1:8090
// (1.173.2) La même démo sur dev.skanfact.tn (Skander, 29/10/2026 : « une démo de données pour tester ») : DEMO_COURRIEL
// (une adresse Gmail, de l'environnement, jamais du dépôt) remplace chaque adresse inventée par un alias de cette boîte
// (« leila.jlassi@exemple.tn » → « boite+leila.jlassi@gmail.com ») : les invitations, les codes et les demandes du cabinet
// arrivent chez qui teste, et aucun inconnu ne reçoit d'e-mail. DEMO_TRAVAIL : où écrire les comptes ;
// DEMO_NAVIGATEURS : le dossier des navigateurs qui dessinent les pièces.
import fs from 'node:fs';

const adresse = process.argv[2] ?? 'http://127.0.0.1:8090';
const TRAVAIL = process.env.DEMO_TRAVAIL ?? '/tmp/skanfact-humain-plateforme';
const NAVIGATEURS = process.env.DEMO_NAVIGATEURS ?? '/opt/pw-browsers';
const BOITE = /^([^@+\s]+)@gmail\.com$/i.exec(process.env.DEMO_COURRIEL ?? '');
const alias = (texte: string) => !BOITE ? texte : texte.replace(/([a-z0-9._-]+)@([a-z0-9-]+)((?:\.[a-z0-9-]+)+)/gi,
  (tout, local: string, nom: string, reste: string) => (`${nom}${reste}`.toLowerCase() === 'gmail.com' ? tout
    : `${BOITE[1]}+${local}${nom === 'exemple' ? '' : `.${nom}`}@gmail.com`));
const MDP = 'Un-bon-mot-de-passe';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
  const r = await fetch(`${adresse}/v1${chemin}`, {
    method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(corps === undefined ? {} : { body: alias(JSON.stringify(corps)) }),
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
// (1.183.0) Les relances déjà faites hors SkanFact, notées sur la fiche : la librairie appelée deux fois pour septembre, la
// menuiserie relancée par WhatsApp pour août (Skander : « complète l'exemple un peu plus »).
type Relance = { at: number; via: 'email' | 'tel' | 'whatsapp' | 'autre'; months: string[]; note: string };
const RELANCES: Record<string, Relance[]> = {
  le: [{ at: Date.parse('2026-10-08T09:30:00Z'), via: 'tel', months: ['2026-09'], note: 'Amel était en inventaire, rappeler la semaine prochaine' },
    { at: Date.parse('2026-10-20T10:15:00Z'), via: 'tel', months: ['2026-09'], note: 'Elle envoie les relevés vendredi' }],
  mb: [{ at: Date.parse('2026-09-25T08:00:00Z'), via: 'whatsapp', months: ['2026-08'], note: 'Hédi est sur un chantier à Hammamet, il rentre début octobre' }],
};

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
    : /farine/i.test(nom) ? ['MINOTERIE DU CAP BON', 'Facture n° F-2026-0903 du 03/09/2026', [['Farine boulangère T55, 40 sacs de 50 kg', '1 551,428']]]
    : /lait/i.test(nom) ? ['CENTRALE LAITIÈRE DU NORD', 'Facture n° CL-20981 du 02/10/2026', [['Lait demi-écrémé, 240 L', '312,000']]]
    : /appareil/i.test(nom) ? ['PHOTO CENTER TUNIS', 'Facture n° PC-2026-1187 du 14/10/2026', [['Appareil photo hybride, boîtier et objectif 24-70 (3 200,000 TTC)', '2 689,076']]]
    : /hebergement/i.test(nom) ? ['OVH SAS', 'Invoice FR-41720 · 30/09/2026 · EUR', [['Hébergement serveur, 3e trimestre', '87,00 €']]]
    : ['FOURNITURES EL AMEN', 'Facture n° FA-0921 du 22/10/2026', [['Fournitures diverses', '186,420']]];
  // Le total : la somme des lignes, au millime (les montants s'écrivent « 1 520,000 »).
  const millimes = l.reduce((t, x) => t + Math.round(Number(String(x[1]).replace(/[^\d,]/g, '').replace(',', '.')) * 1000), 0);
  const total = /€/.test(l[0]?.[1] ?? '') ? l[0]?.[1] ?? '' : `${Math.trunc(millimes / 1000).toLocaleString('fr-FR').replace(/\u202f/g, ' ')},${String(millimes % 1000).padStart(3, '0')}`;
  // (1.173.0) La facture STEG entière, comme la maquette : sa TVA, son total TTC, et ce que Sarra y a noté à la main (sans
  // eux, la lecture par l'IA ne trouvait ni le total ni l'achat du même montant).
  if (/electricite/i.test(nom)) return `${css}<div class="f" style="width:380px"><h1>${f}</h1><div class="s">${n} · client : ${dossier}</div><table>${l.map(([a, b]) => ligne(a, b)).join('')}`
    + ligne('Total hors taxes', total) + ligne('TVA 13 %', '21,446') + '<tr class="t"><td>Total TTC</td><td>186,419 DT</td></tr></table>'
    + '<div class="p">à payer avant le 15/10/2026 · <i>payé par chèque n° 4410 087 le 12/10 (écrit à la main)</i></div></div>';
  // (1.173.2) La facture de farine, celle de l'achat FA-0914 que Sarra a saisi (1 846,199 DT) : la même TVA, le même total.
  if (/farine/i.test(nom)) return `${css}<div class="f" style="width:380px"><h1>${f}</h1><div class="s">${n} · client : ${dossier}</div><table>${l.map(([a, b]) => ligne(a, b)).join('')}`
    + ligne('Total hors taxes', total) + ligne('TVA 19 %', '294,771') + '<tr class="t"><td>Total TTC</td><td>1 846,199 DT</td></tr></table>'
    + '<div class="p">reçue le 03/09 · bon de livraison n° 0903-12</div></div>';
  return `${css}<div class="f"><h1>${f}</h1><div class="s">${n} · client : ${dossier}</div><table>${l.map(([a, b]) => ligne(a, b)).join('')}`
    + `<tr class="t"><td>Total hors taxes</td><td>${total}</td></tr></table><div class="p">Payable à 30 jours · TVA selon le taux en vigueur</div></div>`;
};
type Feuille = { setContent: (h: string) => Promise<void>; pdf: (o: object) => Promise<Buffer>; close: () => Promise<void>;
  locator: (s: string) => { screenshot: (o: object) => Promise<Buffer> } };
let navigateur: { newPage: (o?: object) => Promise<Feuille>; close: () => Promise<void> } | null = null;
try {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright-core');
  const chemin = fs.readdirSync(NAVIGATEURS).find((d) => /^chromium-\d/.test(d));
  navigateur = await chromium.launch(chemin ? { executablePath: `${NAVIGATEURS}/${chemin}/chrome-linux/chrome` } : {});
} catch { navigateur = null; }
const fichierDe = async (nom: string, dossier: string): Promise<string> => {
  if (!navigateur) return PNG;
  // Deux fois plus de points : une photo de téléphone, que l'œil (et l'IA) lisent nettement.
  const page = await navigateur.newPage({ deviceScaleFactor: 2 });
  await page.setContent(papier(nom, dossier));
  const octets: Buffer = /\.pdf$/i.test(nom) ? await page.pdf({ width: '580px', height: '760px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    : await page.locator('.f').screenshot({ type: 'png' });
  await page.close();
  return octets.toString('base64');
};
// (1.180.0) La photo d'une page déjà écrite (la facture d'un achat).
const photoDe = async (html: string): Promise<string> => {
  if (!navigateur) return PNG;
  const page = await navigateur.newPage({ deviceScaleFactor: 2 });
  await page.setContent(html);
  const octets = await page.locator('.f').screenshot({ type: 'png' });
  await page.close();
  return octets.toString('base64');
};
// La facture d'un achat de la boulangerie, avec les chiffres de l'achat saisi : HT = quantité × prix au millime, TVA au
// millime, TTC = HT + TVA (ce que SkanFact calcule de l'achat, donc ce que le cabinet compare).
const enDinars = (m: number) => `${Math.trunc(m / 1000).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')},${String(m % 1000).padStart(3, '0')}`;
const factureAchat = (fournisseur: string, numero: string, jour: string, libelle: string, quantite: number, prix: string, taux: number): string => {
  const ht = Math.round(quantite * Number(prix) * 1000), tva = Math.round(ht * taux / 100);
  const [a, m, j] = jour.split('-');
  const ligne = (x: string, y: string) => `<tr><td>${x}</td><td>${y}</td></tr>`;
  return '<style>body{margin:0;font:13px Helvetica,Arial,sans-serif;color:#23272e}.f{width:420px;padding:28px 30px;background:#fff}'
    + 'h1{font-size:15px;margin:0 0 2px;letter-spacing:.02em}.s{color:#5b616b;margin-bottom:14px;border-bottom:1.5px solid #23272e;padding-bottom:8px}'
    + 'table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dotted #c8cdd4}td:last-child{text-align:right}'
    + '.t td{font-weight:800;border-top:1.5px solid #23272e;border-bottom:0}.p{color:#5b616b;font-size:11px;margin-top:12px}</style>'
    + `<div class="f"><h1>${fournisseur.toUpperCase()}</h1><div class="s">Facture n° ${numero} du ${j}/${m}/${a} · client : Boulangerie El Amal</div><table>`
    + ligne(libelle, '') + ligne(`${quantite} × ${prix.replace('.', ',')}`, enDinars(ht))
    + ligne('Total hors taxes', enDinars(ht)) + ligne(`TVA ${taux} %`, enDinars(tva)) + `<tr class="t"><td>Total TTC</td><td>${enDinars(ht + tva)} DT</td></tr></table>`
    + '<div class="p">Payable à 30 jours · timbre fiscal non compris</div></div>';
};

// (1.172.0) La boulangerie telle que le classeur de la maquette la dessine (docs/maquettes/cabinet/classeur.html) : ses
// achats de chaque mois saisis par Sarra (avec leur justificatif, sauf l'électricité de septembre), ses ventes, sa paie,
// sa banque au relevé BIAT (juillet rapproché, un chèque d'août sans pièce, septembre à rapprocher). Avant les livres
// des autres mois : un mois déclaré ne reçoit plus d'écriture.
const be = entreprise.be ?? '', sarra = gerant.be ?? '';
{
  await api('GET', `/entreprises/${be}/dossier-v10`, sarra);
  const FOURNISSEURS = [['s-min', 'Minoterie du Cap Bon'], ['s-lev', 'Levures du Sahel'], ['s-hyg', 'Hygiène Plus'], ['s-steg', 'STEG'], ['s-emb', 'Emballages du Sahel']];
  // [clé, fournisseur, numéro, jour, libellé, quantité, prix HT unitaire, TVA, justifié]
  const achats: [string, string, string, string, string, number, string, number, boolean][] = [];
  for (let i = 0; i < 9; i++) {
    const m = String(i + 1).padStart(2, '0');
    if (i < 8) {
      achats.push([`p-${m}1`, 's-min', `FA-${m}01`, `${mois(i)}-03`, 'Farine boulangère T55, sacs de 50 kg', 36 + i, '38.785', 19, true]);
      achats.push([`p-${m}2`, 's-lev', `FA-${m}02`, `${mois(i)}-10`, 'Levure fraîche', 55 + i, '6.165', 7, true]);
      achats.push([`p-${m}3`, 's-emb', `FA-${m}03`, `${mois(i)}-17`, 'Sachets et boîtes à gâteaux', 1, String(212 + i * 9) + '.400', 19, true]);
    }
  }
  achats.push(['p-0908', 's-hyg', 'FA-0908', '2026-08-31', 'Produits d\'entretien du fournil', 1, '180', 19, true]);
  achats.push(['p-0913', 's-lev', 'FA-0913', '2026-09-10', 'Levure fraîche, 60 kg', 60, '6.339', 7, true]);
  achats.push(['p-0914', 's-min', 'FA-0914', '2026-09-03', 'Farine boulangère T55, 40 sacs de 50 kg', 40, '38.7857', 19, true]);
  achats.push(['p-0919', 's-steg', 'FA-0919', '2026-09-30', 'Électricité et gaz, août et septembre', 1, '164.973', 13, false]);
  // (1.180.0) Chaque achat justifié a SA facture, dessinée avec ses chiffres : avant, tous portaient la même image d'un
  // point, et « Ouvrir le justificatif du client » montrait une page vide (Skander, 30/10/2026).
  const fiches = new Map<string, { name: unknown; file: unknown; size: unknown; date: unknown }>();
  for (const [id, fournisseur, number, date, label, qty, prix, vatRate, justifie] of achats) {
    if (!justifie) continue;
    const nom = FOURNISSEURS.find(([cle]) => cle === fournisseur)?.[1] ?? '';
    const pj = await api('POST', `/entreprises/${be}/pieces-jointes`, sarra, { nom: `facture-${number}.png`,
      contenu: await photoDe(factureAchat(nom, number, date, label, qty, prix, vatRate)) });
    fiches.set(id, { name: pj.name, file: pj.file, size: pj.size, date: pj.date });
  }
  await api('POST', `/entreprises/${be}/dossier-v10`, sarra, { changements: [
    ...FOURNISSEURS.map(([id, name], rang) => ({ collection: 'suppliers', cle: id, rang, revision: null, contenu: { id, name } })),
    ...achats.map(([id, fournisseur, number, date, label, qty, prix, vatRate, justifie], rang) => ({ collection: 'purchases', cle: id, rang, revision: null, contenu: {
      id, kind: 'facture', number, date, supplierId: fournisseur, currency: 'DT', category: 'Matières premières', fees: 0, withholdingRate: 0, createdAt: 1,
      attachments: justifie ? [fiches.get(id)] : [], lines: [{ id: `${id}-l`, label, qty, unitPrice: { '~n': prix }, vatRate, destination: 'charge' }] } })),
  ] });
  // (1.206.0) Les règles de la Banque du cabinet : « FRAIS » va aux commissions bancaires, « AGIOS » aux intérêts.
  const reg = await api('GET', `/cabinets/${cabinet}/reglages`, leila) as { contenu?: Record<string, unknown>; revision?: unknown };
  await api('PUT', `/cabinets/${cabinet}/reglages`, leila, { contenu: { ...(reg.contenu ?? {}), libelles: [{ motif: 'FRAIS', compte: '6278' }, { motif: 'AGIOS', compte: '6511' }] },
    revision: reg.revision ?? null });
  // Les ventes du mois (les factures aux hôtels, la caisse), la paie, et la banque : saisies au cabinet.
  const ecrire = (date: string, journal: string, piece: string, libelle: string, lignes: { compte: string; debit?: string; credit?: string }[]) =>
    api('POST', `/entreprises/${be}/compta/ecritures`, leila, { date, journal, piece, libelle, lignes });
  const dt = (millimes: number) => `${Math.trunc(millimes / 1000)},${String(millimes % 1000).padStart(3, '0')}`;
  const fin = (i: number) => String(new Date(Date.UTC(2026, i + 1, 0)).getUTCDate());
  for (let i = 0; i < 9; i++) {
    const m = String(i + 1).padStart(2, '0');
    const hotel = 2_118_000 + i * 41_000, caisse = 14_380_000 + i * 212_000, salaires = 4_286_300;
    const tva = (x: number) => Math.round(x * 7 / 107);
    await ecrire(`${mois(i)}-15`, 'VT', `VT-${m}15`, 'Hôtel Dar Jerba · pains et viennoiseries', [{ compte: '411', debit: dt(hotel) }, { compte: '7071', credit: dt(hotel - tva(hotel)) }, { compte: '4367', credit: dt(tva(hotel)) }]);
    await ecrire(`${mois(i)}-28`, 'VT', `VT-${m}28`, 'Caisse du mois · ventes au comptoir', [{ compte: '541', debit: dt(caisse) }, { compte: '7071', credit: dt(caisse - tva(caisse)) }, { compte: '4367', credit: dt(tva(caisse)) }]);
    await ecrire(`${mois(i)}-${fin(i)}`, 'PAIE', `PAIE-${m}`, 'Salaires du mois · 4 salariés', [{ compte: '640', debit: dt(salaires) }, { compte: '421', credit: dt(salaires) }]);
    await ecrire(`${mois(i)}-${fin(i)}`, 'BQ', `BQ-${m}30`, 'VIR salaires', [{ compte: '421', debit: dt(salaires) }, { compte: '532', credit: dt(salaires) }]);
    await ecrire(`${mois(i)}-22`, 'BQ', `BQ-${m}22`, 'Versement espèces', [{ compte: '532', debit: dt(caisse - 1_000_000) }, { compte: '541', credit: dt(caisse - 1_000_000) }]);
  }
  // Les mois de janvier à juillet sont tenus et validés ; août et septembre attendent au brouillard.
  await api('POST', `/entreprises/${be}/compta/valider`, leila, { jusqua: '2026-07-31' });
  // Les relevés BIAT : juillet rapproché, août aussi sauf un chèque sans pièce, septembre à rapprocher.
  const lues = (await api('GET', `/entreprises/${be}/compta/ecritures?limite=500`, leila)).ecritures as { piece: string; lignes: { id: string; compte: string }[] }[];
  const ligne532 = (piece: string) => lues.find((e) => e.piece === piece)?.lignes.find((l) => l.compte === '532')?.id ?? null;
  const empreinte = (n: number) => n.toString(16).padStart(64, '0');
  // Le solde de fin : celui du début, plus chaque mouvement (au millime, au sens de la banque).
  const soldeApres = (debut: number, montants: string[]) => {
    const fin = montants.reduce((t, x) => t + (x.startsWith('-') ? -1 : 1) * Math.round(Number(x.replace('-', '').replace(',', '.')) * 1000), debut);
    return `${fin < 0 ? '-' : ''}${dt(Math.abs(fin))}`;
  };
  // (1.206.0) Un chèque émis le 28/09 pour la facture d'août d'Hygiène Plus, que la banque n'a pas encore payé : le
  // pied de la Banque l'explique (« 1 écriture pas encore en banque »).
  await ecrire('2026-09-28', 'BQ', 'CHQ 4410 075', 'CHQ 4410 075 · Hygiène Plus FA-0908', [{ compte: '401', debit: '214,200' }, { compte: '532', credit: '214,200' }]);
  // (1.206.0) Les relevés se suivent : celui de juillet part du solde du livre au 1er juillet (la banque et le livre
  // ont vu les mêmes mouvements de janvier à juin), chaque relevé part de la fin du précédent. Avant, tous partaient de
  // 8 412,605 et la Banque montrait un écart que rien n'expliquait.
  let solde = 0;
  for (let i = 0; i < 6; i++) solde += (14_380_000 + i * 212_000 - 1_000_000) - 4_286_300;
  for (const [i, rapproche] of [[6, true], [7, true], [8, false]] as const) {
    const m = String(i + 1).padStart(2, '0'), caisse = 14_380_000 + i * 212_000;
    const lignes = [{ date: `${mois(i)}-22`, libelle: 'VERSEMENT ESPECES', reference: '', montant: dt(caisse - 1_000_000) },
      { date: `${mois(i)}-30`, libelle: `VIR SALAIRES ${m}/2026`, reference: '', montant: `-${dt(4_286_300)}` }];
    if (i === 7) lignes.push({ date: '2026-08-12', libelle: 'CHQ 4410 061', reference: '4410061', montant: '-640,000' });
    if (i === 8) lignes.push({ date: '2026-09-08', libelle: 'VIR Minoterie du Cap Bon', reference: '', montant: '-1818,507' },
      { date: '2026-09-12', libelle: 'CHQ 4410 072', reference: '4410072', montant: '-406,980' },
      { date: '2026-09-14', libelle: 'VIR RECU REF 2609-14177', reference: '2609-14177', montant: '1250,000' },
      { date: '2026-09-15', libelle: 'VIR RECU Hotel Dar Jerba', reference: '', montant: '2344,694' },
      { date: '2026-09-24', libelle: 'CARTE TOTAL ENNASR 24/09', reference: '', montant: '-85,000' },
      { date: '2026-09-26', libelle: 'FRAIS TENUE DE COMPTE', reference: '', montant: '-11,900' },
      { date: '2026-09-30', libelle: 'AGIOS 3E TRIMESTRE', reference: '', montant: '-12,650' });
    const soldeFin = soldeApres(solde, lignes.map((l) => l.montant));
    const r = await api('POST', `/entreprises/${be}/compta/releves`, leila, { annee: 2026, compte: '532', banque: 'BIAT', fichier: `Releve_BIAT_${m}-2026.pdf`,
      empreinte: empreinte(i + 1), soldeDebut: dt(solde), soldeFin, lignes });
    solde = Math.round(Number(soldeFin.replace(',', '.')) * 1000);
    if (!rapproche) continue;
    const releves = (await api('GET', `/entreprises/${be}/compta/releves?annee=2026`, leila)).releves as { id: string; lignes: { id: string; libelle: string }[] }[];
    const rel = releves.find((x) => x.id === r.id);
    // Le versement et les salaires trouvent leur écriture ; le chèque d'août n'a rien en face (sa pièce manque).
    const piece = (libelle: string) => (/SALAIRES/.test(libelle) ? `BQ-${m}30` : /VERSEMENT/.test(libelle) ? `BQ-${m}22` : '');
    const poses = (rel?.lignes ?? []).map((l) => ({ ligne: l.id, ecritureLigne: piece(l.libelle) ? ligne532(piece(l.libelle)) : null, niveau: 'certain' as const }))
      .filter((p) => p.ecritureLigne);
    if (poses.length) await api('POST', `/entreprises/${be}/compta/releves/${r.id}/rapprochements`, leila, { poses });
  }
}
for (const d of DOSSIERS) {
  const ent = entreprise[d.cle] ?? '';
  const g = LIVRES[d.cle] ?? '';
  const debut = Math.max(0, g.search(/[^H]/));
  const f = FICHES[d.cle];
  await poserFiche(ent, { from: mois(debut), ...(f ? { contact: f[0], phone: f[1], ...(d.email ? { email: d.email } : {}), fees: f[2], forme: f[3], ville: f[4], fonction: f[5], activite: ACTIVITES[d.cle] ?? '' } : {}),
    ...(RELANCES[d.cle] ? { relances: RELANCES[d.cle] } : {}) });
  for (let i = 0; i < g.length; i++) {
    const e = g[i];
    if (!e || 'MSH'.includes(e)) continue;
    const montant = `${300 + i * 17},${String(125 + i * 3).padStart(3, '0')}`;
    // La boulangerie a déjà ses livres de janvier à juillet, validés (plus haut) : ses honoraires y sont, et la période est close.
    const dejaTenu = d.cle === 'be' && i < 7;
    const ecriture = dejaTenu ? '' : String((await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: `${mois(i)}-18`, journal: 'OD', piece: `OD-${i + 1}`,
      libelle: 'Honoraires du mois', lignes: [{ compte: '6226', debit: montant }, { compte: '4286', credit: montant }] })).id);
    if (e === 'R') continue;
    if (!dejaTenu) await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: [ecriture] });
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

// (1.196.0) L'exercice 2025 de trois dossiers, pour l'onglet Bilans du Tableau de bord : le garage a son inventaire et sa
// revue des comptes (la liasse reste à l'associé), la boulangerie son inventaire (sa période est déjà validée : aucune
// écriture n'y entre plus), la SARL tenue au cabinet rien encore. La liasse et la clôture ne sont pas aux collaborateurs.
for (const cle of ['gt', 'be', 'sm']) {
  const ent = entreprise[cle] ?? '';
  await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2025, ouverture: [] });
  if (cle !== 'be') {
    const e = await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: '2025-12-31', journal: 'OD', piece: 'OD-2025-12', libelle: 'Honoraires de décembre',
      lignes: [{ compte: '6226', debit: '310,500' }, { compte: '4286', credit: '310,500' }] });
    await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: [String(e.id)] });
  }
  if (cle === 'sm') continue;
  await api('PUT', `/entreprises/${ent}/compta/inventaires/2025`, leila, { date: '2025-12-31', compte: '31', lignes: [{ ref: 'A1', libelle: cle === 'be' ? 'Farine en stock' : 'Pièces détachées', quantite: '40', cout: '38,500' }] });
  if (cle === 'gt') await api('PUT', `/cabinets/${cabinet}/revisions/${ent}/2025`, leila, {
    contenu: { faite: true, faiteLe: Date.parse('2026-03-10T09:00:00Z'), faitePar: 'Leïla Jlassi', comptes: [], notes: [], questionnaire: [] }, revision: null });
}

// Ce que les clients ont envoyé : des pièces (une photo, un PDF) et des messages.
const envoyer = async (cle: string, fichiers: string[], texte: string, repond: Record<string, string> = {}) => {
  const j = gerant[cle] ?? '';
  const id = entreprise[cle] ?? '';
  const envoyes: Record<string, string> = {};
  for (const nom of fichiers) {
    const f = await api('POST', `/entreprises/${id}/messages/fichiers`, j, { cote: 'entreprise', nom, contenu: await fichierDe(nom, DOSSIERS.find((x) => x.cle === cle)?.nom ?? '') });
    envoyes[nom] = String((await api('POST', `/entreprises/${id}/messages`, j, { cote: 'entreprise', texte: '', fichier: f.id, repondA: repond[nom] ?? null })).id);
  }
  if (texte) await api('POST', `/entreprises/${id}/messages`, j, { cote: 'entreprise', texte });
  return envoyes;
};
// Ce que le cabinet a demandé à la boulangerie : le relevé arrive en réponse, l'attestation est encore attendue.
const demandes = await api('POST', `/entreprises/${entreprise.be}/messages`, leila, { cote: 'cabinet', texte: 'Bonjour Sarra, pour boucler septembre il me manque :',
  demandes: ['Le relevé BIAT de septembre', 'L\'attestation CNSS du 3e trimestre'], pour: '2026-10-31' }) as { ids: string[] };
const recues = await envoyer('be', ['facture-levure-0910.pdf', 'IMG_8790.jpg', 'Assurance-local-2026-attestation.pdf', 'IMG_8841.jpg', 'facture-electricite-septembre.jpg', 'Releve_BIAT_09-2026.pdf', 'ticket-carburant-24-09.jpg', 'facture-farine-0903.pdf'],
  'Bonjour, voici les pièces de septembre. La facture d\'août de la STEG, je la cherche encore.', { 'Releve_BIAT_09-2026.pdf': demandes.ids[0] ?? '' });
// (1.172.0) Ce que le cabinet en a déjà fait, comme la maquette du classeur : la levure saisie par Anis, la photo floue
// marquée illisible par Rim (et redemandée), la seconde photo de la levure en double, l'attestation d'assurance gardée ;
// Sarra a rangé la facture de farine dans son achat FA-0914.
{
  const anis = jetons['anis.gharbi@exemple.tn'] ?? '', rim = jetons['rim.toumi@exemple.tn'] ?? '';
  // Rim aide Anis sur la boulangerie : elle en fait la saisie.
  if (membre.Rim) await api('PUT', `/cabinets/${cabinet}/mandats/${mandatDe('be')}/affectations/${membre.Rim}`, leila, { role: 'saisie' });
  const classer = (jeton: string, nom: string, raison: string, note?: string) =>
    api('POST', `/entreprises/${be}/messages/${recues[nom]}/classee`, jeton, { classee: true, raison, ...(note ? { note } : {}) });
  await classer(anis, 'facture-levure-0910.pdf', 'saisie');
  await api('POST', `/entreprises/${be}/messages`, rim, { cote: 'cabinet', texte: 'Bonjour Sarra, la photo IMG_8790 ne se lit pas : peux-tu la reprendre à plat, en pleine lumière ?', demande: 'Une meilleure photo de IMG_8790' });
  await classer(rim, 'IMG_8790.jpg', 'illisible', 'redemandée à Sarra');
  // (1.173.0) En double DE la facture de levure : le classeur les montre côte à côte.
  await api('POST', `/entreprises/${be}/messages/${recues['IMG_8841.jpg']}/double`, anis, { sorte: 'message', jumelle: recues['facture-levure-0910.pdf'] });
  await classer(anis, 'Assurance-local-2026-attestation.pdf', 'rien');
  await api('POST', `/entreprises/${be}/messages/${recues['facture-farine-0903.pdf']}/achat`, sarra, { achat: 'p-0914', libelle: 'FA-0914 · Minoterie du Cap Bon' });
  // Le dossier permanent, rangé par le cabinet ; l'attestation de régularité fiscale est échue depuis le 30/09.
  const ranger = async (o: Record<string, unknown>, nom: string) => api('POST', `/cabinets/${cabinet}/classeur/${be}/documents`, leila,
    { nom, contenu: await fichierDe(nom, 'Boulangerie El Amal'), ...o });
  const PERMANENT: [string, string, string, string | null, string][] = [
    ['juridique', 'Statuts de la SARL', 'mis à jour le 14/03/2021 · 18 pages', null, 'statuts-contrat.pdf'],
    ['juridique', 'Extrait du registre (RNE)', 'du 12/01/2026 · le gérant et ses pouvoirs', null, 'rne-attestation.pdf'],
    ['juridique', 'PV d\'assemblée 2025', 'approbation des comptes 2025, le 25/06/2026', null, 'pv-ag-2025-contrat.pdf'],
    ['fiscal', 'Carte d\'identification fiscale', 'régime réel, TVA déclarée chaque mois', null, 'carte-fiscale-attestation.pdf'],
    ['fiscal', 'Attestation d\'affiliation CNSS', 'employeur, 4 salariés', null, 'affiliation-cnss-attestation.pdf'],
    ['fiscal', 'Attestation de régularité fiscale', 'souvent demandée par les banques et les marchés', '2026-09-30', 'regularite-fiscale-attestation.pdf'],
    ['contrats', 'Contrat de bail du local', '1 450,000 DT par mois', '2027-12-31', 'bail-local-contrat.pdf'],
    ['contrats', 'Contrat de leasing de la camionnette', 'Tunisie Leasing · avec son échéancier', '2027-03-31', 'leasing-contrat.pdf'],
    ['contrats', 'Assurance du local 2026', 'STAR Assurances', '2026-12-31', 'assurance-local-attestation.pdf'],
    ['contrats', 'Contrats de travail', 'les 4 salariés · le dernier signé le 02/03/2026', null, 'contrats-travail-contrat.pdf'],
    ['banque', 'Tableau des immobilisations', 'le four, le pétrin, les vitrines · amortissements au 31/12/2025', null, 'immobilisations-2025.pdf'],
    ['banque', 'Le compte BIAT', 'RIB, convention, qui signe les chèques', null, 'compte-biat-attestation.pdf'],
    ['cabinet', 'Lettre de mission 2026', 'les livres, les déclarations, la paie ; le bilan n\'en fait pas partie', null, 'lettre-mission-contrat.pdf'],
  ];
  for (const [categorie, titre, detail, echeance, nom] of PERMANENT) await ranger({ rubrique: 'permanent', categorie, titre, detail, echeance }, nom);
  await ranger({ rubrique: 'courrier', periode: '2025', titre: 'CNSS · mise à jour de la liste des salariés', detail: 'répondue par Anis le 03/07/2025, sa réponse jointe' }, 'courrier-cnss-attestation.pdf');
  await ranger({ rubrique: 'accuse', periode: '2026-07', titre: 'L\'accusé de dépôt de juillet', detail: 'Accuse_07-2026.pdf' }, 'Accuse_07-2026-attestation.pdf');
  // Le dossier tenu de Nabil : deux photos qu'il a envoyées par WhatsApp, déposées par Leïla dans octobre.
  for (const nom of ['Transports-Ben-Salah-1.jpg', 'Transports-Ben-Salah-2.jpg']) {
    await api('POST', `/cabinets/${cabinet}/classeur/${entreprise.sm}/documents`, leila, { rubrique: 'piece', periode: '2026-10', titre: 'Transports Ben Salah',
      detail: 'facture 2026/0412 du 18/09', provenance: 'WhatsApp de Nabil', nom, contenu: await fichierDe(nom, 'SARL Mansour Distribution') });
  }
}
await envoyer('dz', ['facture-lait-octobre.pdf', 'IMG_2207.jpg'], '');
await envoyer('pe', ['Releve_ATB_09-2026.pdf', 'contrat-bail-2027.pdf'], 'Le nouveau bail, pour info.');
await envoyer('iy', ['IMG_0412.jpg', 'IMG_0413.jpg', 'attestation-CNSS.pdf'], '');
await envoyer('gt', [], 'Bonjour, j\'ai annulé la facture de juillet par erreur. Que faut-il faire ?');
await envoyer('an', ['facture-hebergement-T3.pdf'], 'Payée en euros par carte.');
// (1.183.0) Des conversations qui vivent (Skander : « complète l'exemple un peu plus ») : le cabinet répond, l'équipe se
// laisse des notes, un client promet, une question de la révision attend d'être imputée, et les modèles du cabinet.
{
  const anis = jetons['anis.gharbi@exemple.tn'] ?? '', rim = jetons['rim.toumi@exemple.tn'] ?? '';
  const ecrit = (cle: string, jeton: string, cote: 'cabinet' | 'entreprise', texte: string, extra: Record<string, unknown> = {}) =>
    api('POST', `/entreprises/${entreprise[cle] ?? ''}/messages`, jeton, { cote, texte, ...extra });
  const note = (cle: string, jeton: string, texte: string) => api('POST', `/cabinets/${cabinet}/notes/${entreprise[cle] ?? ''}`, jeton, { texte });
  // Un jour à venir (une promesse se note pour plus tard), au calendrier de Tunis.
  const dansJours = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });

  // La boulangerie : un virement de 1 250,000 DT reçu le 14/09 que personne ne sait expliquer, au compte d'attente ; la
  // question part au client, Sarra y répond : « Imputer le virement » attend le cabinet. L'attestation CNSS, promise.
  const vir = await api('POST', `/entreprises/${be}/compta/ecritures`, leila, { date: '2026-09-14', journal: 'BQ', piece: 'VIR 14/09',
    libelle: 'VIR RECU REF 2609-14177', lignes: [{ compte: '532', debit: '1250,000' }, { compte: '471', credit: '1250,000' }] });
  const q = await api('POST', `/entreprises/${be}/compta/questions`, anis, { periode: '2026-09', compte: '471', ecriture: vir.id, piece: 'VIR 14/09',
    montant: '1250,000', objet: 'Un virement reçu le 14/09 (réf. 2609-14177)', texte: 'Bonjour Sarra, nous avons reçu 1 250,000 DT le 14/09 sans savoir de qui. À quoi correspond ce virement ?', attendu: 'explication' });
  await api('POST', `/entreprises/${be}/compta/questions/envoyer`, anis, { annee: 2026 });
  await api('POST', `/entreprises/${be}/compta/questions/${String(q.id)}/repondre`, sarra, { texte: 'C\'est l\'acompte de la Clinique Les Jasmins pour les gâteaux de leur fête du 30/09.' });
  await ecrit('be', sarra, 'entreprise', 'Pour l\'attestation CNSS, je passe au bureau de la CNSS jeudi et je vous l\'envoie dans la foulée.');
  await api('PUT', `/cabinets/${cabinet}/promesses/${be}`, anis, { pour: dansJours(6), quoi: 'L\'attestation CNSS du 3e trimestre' });
  await note('be', anis, 'Le virement du 14/09 : Sarra dit que c\'est l\'acompte de la Clinique. À imputer au 411 de la Clinique avant de boucler septembre.');
  await note('be', rim, 'J\'ai saisi la levure du 10/09. La photo IMG_8790 est redemandée, elle était floue.');

  // Le garage : la question de Sami trouve sa réponse, et l'équipe se laisse un mot pour la révision.
  await ecrit('gt', leila, 'cabinet', 'Bonjour Sami, pas de souci : une facture émise ne s\'efface pas, elle s\'annule par un avoir. Ouvre la facture de juillet, puis « Faire un avoir » : SkanFact reprend les lignes, tu n\'as qu\'à valider. Je vérifie de mon côté ensuite.');
  await ecrit('gt', gerant.gt ?? '', 'entreprise', 'C\'est fait, merci beaucoup ! L\'avoir porte le numéro AV-2026-0007.');
  await note('gt', leila, 'Avoir AV-2026-0007 sur la facture de juillet : à contrôler en révision d\'octobre (TVA à reprendre sur la déclaration d\'octobre, pas sur juillet déjà déposé).');

  // La menuiserie : rien reçu depuis août ; Leïla demande d'un coup ce qui manque, pour une date.
  await ecrit('mb', leila, 'cabinet', 'Bonjour Hédi, j\'espère que le chantier de Hammamet s\'est bien passé. Pour avancer sur août et septembre, il me manque :',
    { demandes: ['Les factures d\'achat d\'août', 'Les factures d\'achat de septembre', 'Les relevés de banque d\'août et septembre'], pour: dansJours(5) });
  await note('mb', leila, 'Hédi répond mieux par WhatsApp que par e-mail. Si rien lundi, je l\'appelle.');

  // L'institut : Rim demande le relevé ; Yasmine répond qu'elle passe à la banque.
  await ecrit('iy', rim, 'cabinet', 'Bonjour Yasmine, merci pour les photos. Il me manque encore le relevé de septembre.', { demande: 'Le relevé ATB de septembre', pour: dansJours(4) });
  await ecrit('iy', gerant.iy ?? '', 'entreprise', 'Je passe à l\'agence lundi, je vous l\'envoie tout de suite après.');

  // Le studio : une question de métier (immobilisation ou charge ?), Anis répond avec le seuil, à vérifier.
  await envoyer('sp', ['facture-appareil-photo.pdf'], 'Bonjour, j\'ai acheté un nouvel appareil photo à 3 200 DT. Je le mets en charges du mois ?');
  await ecrit('sp', anis, 'cabinet', 'Bonjour Ines, à ce prix c\'est plutôt une immobilisation : il s\'amortit sur plusieurs années (le seuil exact et la durée sont à vérifier avec nous). Je m\'en occupe, tu n\'as rien à faire.');
  await note('sp', anis, 'Appareil photo 3 200 DT : immobilisation 2182, amortissement sur 5 ans (À VÉRIFIER avec Leïla).');

  // La pharmacie : le bail reçu, Anis remercie ; la clinique (tenue) : une note de passation.
  await ecrit('pe', anis, 'cabinet', 'Merci Nour, bien reçu. Je classe le bail dans le dossier permanent.');
  await note('cj', leila, 'Bilan 2026 : Salma veut un rendez-vous fin novembre pour la clôture. Préparer l\'état des stocks.');

  // Les modèles du cabinet, partagés par toute l'équipe.
  for (const [titre, texte] of [
    ['Pièces du mois', 'Bonjour {client}, pour boucler {mois}, il me manque des pièces. Peux-tu me les envoyer ici, en photo ou en PDF ? Merci.'],
    ['Relevé de banque', 'Bonjour {client}, peux-tu m\'envoyer le relevé de banque de {mois} ? Un PDF téléchargé depuis ta banque en ligne suffit.'],
    ['Déclaration déposée', 'Bonjour {client}, ta déclaration de {mois} est déposée. Le montant à payer est dans ton espace, rubrique Déclarations.'],
    ['Bien reçu', 'Bien reçu, merci {client}. Je m\'en occupe.'],
    ['Photo illisible', 'Bonjour {client}, la photo ne se lit pas bien. Peux-tu la reprendre à plat, en pleine lumière, sans reflet ? Merci.'],
  ] as const) await api('POST', `/cabinets/${cabinet}/messages/modeles`, leila, { titre, texte });
}

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
  'leila.jlassi@exemple.tn  direction (associée)', 'anis.gharbi@exemple.tn  tenue des dossiers', 'rim.toumi@exemple.tn  saisie',
  ...DOSSIERS.filter((x) => x.email).map((x) => `${x.email}  ${x.gerant}, ${x.nom}`), '',
].map(alias).join('\n'));
fs.writeFileSync(`${TRAVAIL}/cabinet.json`, JSON.stringify({ cabinet, adresse, jetons: { leila, anis: jetons['anis.gharbi@exemple.tn'], rim: jetons['rim.toumi@exemple.tn'] }, entreprise }, null, 1), { mode: 0o600 });
console.log(fs.readFileSync(`${TRAVAIL}/comptes-cabinet.txt`, 'utf8'));
