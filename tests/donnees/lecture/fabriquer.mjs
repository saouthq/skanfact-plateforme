// Fabrique les pièces d'essai de la lecture des factures d'achat (brique 84 ; docs/achats.md). Lancé à la
// main, une fois (le résultat est dans le dépôt, pour que chaque lecture d'essai soit la même partout) :
//
//   node tests/donnees/lecture/fabriquer.mjs
//
// Toutes les pièces sont INVENTÉES : des fournisseurs et des matricules d'essai, jamais une vraie facture
// (une vraie facture ne se met jamais dans le dépôt ; le banc de mesure les lit hors du dépôt, banc/lecture).
//   - quincaillerie.pdf : une facture écrite par la v10 (son gabarit, `documentHtml`), avec son texte ;
//   - quincaillerie-photo.jpg : la même, « photographiée » (penchée, floue, mal éclairée, compressée) ;
//   - quincaillerie-scan.pdf : la même, scannée (un PDF fait d'une image, sans texte) ;
//   - materiaux.png, bureau-etudes.png, fournisseur-eur.png : trois autres façons d'écrire une facture
//     (un tableau récapitulatif de la TVA et une remise par ligne ; une retenue à la source ; des euros).
// Et, pour chacune, le texte qu'en tire le moteur (`*.lu.txt`), que les tests de l'analyse relisent.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright-core';

const ICI = import.meta.dirname;
const ECRAN = path.join(ICI, '../../../web/public/v10');

// Le code de la v10, chargé comme le serveur le charge (serveur/v10/teif.ts).
const charges = new Map();
function charger(fichier) {
  if (charges.has(fichier)) return charges.get(fichier);
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(ECRAN, fichier), 'utf8');
  vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: fichier })(module, module.exports, (nom) => charger(`${nom.replace(/^\.\//, '')}.js`));
  charges.set(fichier, module.exports);
  return module.exports;
}
const C = charger('core.js');

const societe = { name: 'Quincaillerie Ben Salem', matricule: '1234567A/B/M/000', address: '14 rue Ibn Khaldoun\n1002 Tunis', phone: '+216 71 000 000',
  currency: 'DT', stampFee: 1, taxRegime: 'reel', rib: '08 006 0123456789012 34', bank: 'BIAT' };
const client = { name: 'Atelier Nadia', matricule: '7654321B/A/M/000', address: '5 avenue de Carthage, Tunis' };
const doc = { type: 'facture', number: 'FV-2026-0412', date: '2026-10-03', dueDate: '2026-11-02', status: 'envoyée', currency: 'DT', subject: 'Fournitures atelier',
  lines: [{ label: 'Vis inox 6x40 (boîte de 200)', qty: 3, unitPrice: 42.35, vatRate: 19 }, { label: 'Colle à bois 5 kg', qty: 2, unitPrice: 68.9, vatRate: 19 },
    { label: 'Livraison', qty: 1, unitPrice: 15, vatRate: 7 }],
  discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0 };

const STYLE = '<style>body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:13px;color:#111;margin:40px 48px}table{border-collapse:collapse;width:100%;margin:18px 0}'
  + 'th,td{border:1px solid #444;padding:5px 7px;text-align:left}td.n{text-align:right}.entete{display:flex;justify-content:space-between}.titre{text-align:right}'
  + 'h1{font-size:20px;margin:0 0 6px}.tot{margin-left:auto;width:48%}.tot td{border:none;padding:3px 7px}</style>';

const AUTRES = {
  // Un fournisseur de matériaux : une remise sur une ligne, un tableau récapitulatif de la TVA.
  materiaux: `${STYLE}<div class="entete"><div><h1>STE MATERIAUX DU SAHEL SARL</h1>Route de Sousse km 5, 4000 Sousse<br>Tél : 73 000 111 — Fax : 73 000 112<br>
    M.F : 0876543/K/A/M/000 — RC B1234562010</div><div class="titre"><h1>FACTURE N° : 2026/0158</h1>Date : 12/09/2026<br>Échéance : 12/10/2026</div></div>
    <p>Client : Atelier Nadia<br>Adresse : 5 avenue de Carthage, Tunis<br>Code TVA : 7654321B/A/M/000</p>
    <table><tr><th>Réf</th><th>Désignation</th><th>Qté</th><th>P.U. HT</th><th>Remise</th><th>Montant HT</th></tr>
    <tr><td>C425</td><td>Ciment gris 42.5 sac 50 kg</td><td class="n">20</td><td class="n">12,500</td><td class="n">5%</td><td class="n">237,500</td></tr>
    <tr><td>FER8</td><td>Fer à béton diamètre 8 (barre de 12 m)</td><td class="n">40</td><td class="n">9,850</td><td class="n">0%</td><td class="n">394,000</td></tr>
    <tr><td>SAB1</td><td>Sable lavé (m3)</td><td class="n">3</td><td class="n">45,000</td><td class="n">0%</td><td class="n">135,000</td></tr></table>
    <table style="width:55%"><tr><th>Taux</th><th>Base HT</th><th>Montant TVA</th></tr><tr><td>19%</td><td class="n">766,500</td><td class="n">145,635</td></tr></table>
    <table class="tot"><tr><td>Total H.T</td><td class="n">766,500</td></tr><tr><td>Total TVA</td><td class="n">145,635</td></tr><tr><td>Timbre fiscal</td><td class="n">1,000</td></tr>
    <tr><td><b>Net à payer</b></td><td class="n"><b>913,135 DT</b></td></tr></table>
    <p>Arrêtée la présente facture à la somme de : neuf cent treize dinars et cent trente-cinq millimes.</p>`,
  // Un bureau d'études : deux prestations sans quantité, une retenue à la source sur la facture.
  'bureau-etudes': `${STYLE}<h1>CABINET D'ÉTUDES TECHNIQUES EL AMEN</h1>Ingénieurs conseils — 12 rue de Marseille, 1000 Tunis<br>Matricule fiscal : 1112223 P A P 000
    <h1 style="margin-top:24px">FACTURE</h1><div class="entete"><div>N° FA-26-0093</div><div>Tunis, le 25 septembre 2026</div></div>
    <p>Doit : Atelier Nadia — MF 7654321B/A/M/000</p><p>Objet : Étude de l'installation électrique de l'atelier</p>
    <table><tr><th>Désignation</th><th>Montant HT</th></tr><tr><td>Étude et plans (forfait)</td><td class="n">1 500,000</td></tr>
    <tr><td>Suivi de chantier (5 visites)</td><td class="n">500,000</td></tr></table>
    <table class="tot"><tr><td>Total HT</td><td class="n">2 000,000</td></tr><tr><td>TVA 19 %</td><td class="n">380,000</td></tr><tr><td>Timbre fiscal</td><td class="n">1,000</td></tr>
    <tr><td>Total TTC</td><td class="n">2 381,000</td></tr><tr><td>Retenue à la source 1,5 %</td><td class="n">35,700</td></tr><tr><td><b>Net à payer</b></td><td class="n"><b>2 345,300</b></td></tr></table>`,
  // Un fournisseur étranger : des euros, sans TVA tunisienne, sans matricule.
  'fournisseur-eur': `${STYLE}<h1>FOURNITURES PRO SAS</h1>18 rue des Artisans, 69003 Lyon, France<br>SIRET 123 456 789 00012
    <h1 style="margin-top:24px">FACTURE N° F-2026-1187</h1>Date de facture : 02/09/2026<br>Date d'échéance : 02/10/2026
    <p>Client : Atelier Nadia, 5 avenue de Carthage, Tunis, Tunisie</p>
    <table><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire HT</th><th>Total HT</th></tr>
    <tr><td>Scie circulaire pro</td><td class="n">1</td><td class="n">850,00 €</td><td class="n">850,00 €</td></tr>
    <tr><td>Lames carbure (lot de 3)</td><td class="n">2</td><td class="n">120,00 €</td><td class="n">240,00 €</td></tr></table>
    <table class="tot"><tr><td>Total HT</td><td class="n">1 090,00 €</td></tr><tr><td>TVA 0 %</td><td class="n">0,00 €</td></tr><tr><td><b>Total TTC</b></td><td class="n"><b>1 090,00 €</b></td></tr></table>
    <p>Exportation hors de l'Union européenne : exonération de TVA.</p>`,
};

const lire = (fichier) => execFileSync('tesseract', [fichier, 'stdout', '-l', 'fra', '--psm', '4'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const ecrire = (nom, contenu) => { fs.writeFileSync(path.join(ICI, nom), contenu); console.log(`${nom} (${fs.statSync(path.join(ICI, nom)).size} octets)`); };

const navigateur = await chromium.launch();
try {
  const page = await navigateur.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  await page.setContent(C.documentHtml(doc, client, societe, {}));
  ecrire('quincaillerie.pdf', await page.pdf({ format: 'A4', printBackground: true }));
  const image = await page.screenshot({ fullPage: true, type: 'png' });
  const dataImage = `data:image/png;base64,${image.toString('base64')}`;

  // La photo : penchée, un peu floue, plus sombre d'un côté, compressée.
  const photo = await navigateur.newPage({ viewport: { width: 1500, height: 2050 } });
  await photo.setContent(`<body style="margin:0;background:#77706a;overflow:hidden"><div style="position:relative;margin:40px 0 0 60px;width:1380px;transform:rotate(1.6deg);filter:blur(0.7px) grayscale(0.5)">
    <img src="${dataImage}" style="width:100%;display:block"><div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,0.28))"></div></div></body>`);
  await photo.waitForLoadState('load');
  ecrire('quincaillerie-photo.jpg', await photo.screenshot({ type: 'jpeg', quality: 70 }));

  // Le scan : un PDF fait de l'image seule.
  const scan = await navigateur.newPage();
  await scan.setContent(`<body style="margin:0"><img src="${dataImage}" style="display:block;width:98%;margin:0 auto;filter:grayscale(1) contrast(1.1)"></body>`);
  await scan.waitForLoadState('load');
  ecrire('quincaillerie-scan.pdf', await scan.pdf({ format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' } }));

  for (const [nom, html] of Object.entries(AUTRES)) {
    const p = await navigateur.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
    await p.setContent(html);
    ecrire(`${nom}.png`, await p.screenshot({ fullPage: true, type: 'png' }));
  }
} finally {
  await navigateur.close();
}

// Ce que le moteur en tire (le même que celui du serveur : serveur/achats/lecteur.ts).
ecrire('quincaillerie.lu.txt', execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', path.join(ICI, 'quincaillerie.pdf'), '-'], { encoding: 'utf8' }));
ecrire('quincaillerie-photo.lu.txt', lire(path.join(ICI, 'quincaillerie-photo.jpg')));
for (const nom of Object.keys(AUTRES)) ecrire(`${nom}.lu.txt`, lire(path.join(ICI, `${nom}.png`)));
