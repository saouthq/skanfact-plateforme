// Épreuve « un mois complet » (1.220.0) : Boulangerie El Amal, septembre 2026, comme un comptable, clavier et souris, sur
// le serveur de l'essai humain (scripts/humain/lancer.sh cabinet). Les pièces (geste principal à Entrée), la Banque
// (Entrée ligne à ligne ; un chèque inconnu se laisse), puis « Valider le mois ». Compte les clics, les touches, la
// molette et le temps ; une photo à chaque étape et un journal dans $EPREUVE_SORTIE (dist/epreuve par défaut).
// Elle VALIDE des écritures : sauvegarder la base de l'essai avant (pg_dump), la remettre après.
import fs from 'node:fs';
import { createRequire } from 'node:module'; const require = createRequire('/home/user/skanfact-plateforme/'); const { chromium } = require('playwright-core');
const C = JSON.parse(fs.readFileSync('/tmp/skanfact-humain-plateforme/cabinet.json', 'utf8'));
const D = process.env.EPREUVE_SORTIE || 'dist/epreuve'; fs.mkdirSync(D, { recursive: true });
const log = []; const t0 = Date.now();
const m = { clics: 0, touches: 0, molette: 0, attente: 0 };
const dire = (s) => { const l = `[${((Date.now() - t0) / 1000).toFixed(1)} s] ${s}`; log.push(l); console.log(l); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const err = []; p.on('pageerror', (e) => err.push(e.message));
await p.addInitScript((j) => { if (globalThis.location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, C.jetons.leila);
let n = 0; const photo = async (nom) => { n++; await p.screenshot({ path: `${D}/${String(n).padStart(2, '0')}-${nom}.png` }); };
// Comme une main : si la cible n'est pas à l'écran, la molette la fait venir (et on compte la distance).
const voir = async (loc) => {
  const bx = await loc.boundingBox(); if (!bx) return;
  if (bx.y < 60 || bx.y + bx.height > 880) { const d = Math.round(bx.y - 300); await p.mouse.move(800, 450); await p.mouse.wheel(0, d); m.molette += Math.abs(d); await p.waitForTimeout(250); }
};
const clic = async (loc, quoi) => { await loc.waitFor({ timeout: 10000 }); await voir(loc); await loc.click(); m.clics++; dire(`clic : ${quoi}`); await p.waitForTimeout(600); };
const touche = async (k, quoi) => { await p.keyboard.press(k); m.touches++; dire(`touche ${k} : ${quoi}`); await p.waitForTimeout(700); };
const texte = async (sel) => (await p.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const modale = () => p.locator('#modal-root .modal').first();

try {
  // 1. Ouvrir le dossier, la comptabilité, septembre.
  await p.goto(`${C.adresse}/v10/cabinet/?c=${C.cabinet}#/dossier/${C.entreprise.be}`);
  await p.locator('#view h1').first().waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
  for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  await photo('fiche');
  await clic(p.locator('a.cp-ns').filter({ hasText: /^Saisie/ }).first(), 'Saisie dans la barre de gauche');
  await p.waitForTimeout(1500);
  await clic(p.locator('[data-cp-mois="2026-09"]'), 'septembre au ruban');
  await photo('saisie-sept');
  dire(`en-tête des pièces : ${await texte('.sx-bande, #sx-zone')}`.slice(0, 300));

  // 2. Les pièces du mois, une par une : lire la fiche, faire le geste principal (↵) ou le second.
  const vues = new Map();
  for (let i = 0; i < 8; i++) {
    if (await p.locator('#sx-fini').count()) { dire(`l'écran dit : ${await texte('#sx-fini')}`); await photo('pieces-attendent'); break; }
    const fiche = p.locator('#sx-fiche');
    if (!(await fiche.count())) { dire('plus de fiche : les pièces du mois sont traitées'); break; }
    const titre = await texte('#sx-fiche .sx-fi-t');
    const prim = fiche.locator('.btn-primary').first();
    const lib = (await prim.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    dire(`pièce : ${titre.slice(0, 120)} · geste principal « ${lib} »`);
    vues.set(titre, (vues.get(titre) || 0) + 1);
    if (vues.get(titre) > 1) {
      // Un humain ne refait pas deux fois la même demande : il va chercher la pièce qu'il n'a pas encore vue.
      dire(`DÉFAUT : la pièce revient après son geste (${vues.get(titre)}e fois) ; je clique la pièce suivante dans la bande`);
      const pas = p.locator('[data-sx-k]').filter({ hasNotText: /Minoterie|IMG_8790/ }).first();
      if (await pas.count()) { await clic(pas, `la pièce « ${(await pas.innerText()).trim()} » dans la bande`); vues.clear(); continue; }
      break;
    }
    await photo(`piece-${i + 1}`);
    if (!lib) { await touche('Alt+ArrowRight', 'pas de geste : pièce suivante'); continue; }
    // Le geste principal au clavier, comme écrit sous la fiche.
    await p.locator('body').click({ position: { x: 1300, y: 20 } }); m.clics++;
    await touche('Enter', lib);
    if (await modale().isVisible().catch(() => false)) {
      dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
      await photo(`piece-${i + 1}-fenetre`);
      const ok = modale().locator('.btn-primary').first();
      if (await ok.isEnabled().catch(() => false)) await clic(ok, `valider la fenêtre (« ${(await ok.innerText()).trim()} »)`);
      else await touche('Escape', 'fermer la fenêtre');
    }
    dire(`message : ${await texte('#toast')}`);
    await p.waitForTimeout(800);
    const titre2 = await texte('#sx-fiche .sx-fi-t');
    if (titre2 === titre) { dire('la même pièce reste : Alt+→'); await touche('Alt+ArrowRight', 'pièce suivante'); }
  }
  await photo('pieces-fin');
  dire(`après les pièces : ${await texte('#sx-zone')}`.slice(0, 300));

  // 3. La Banque : rapprocher ce qui est proposé, ligne par ligne, à la touche Entrée.
  if (await p.locator('#sx-vers-banque').count()) await touche('Enter', 'Passer à la Banque (proposé par la Saisie)');
  else await clic(p.locator('a.cp-ns').filter({ hasText: /^Banque/ }).first(), 'Banque dans la barre de gauche');
  await p.waitForTimeout(1500);
  await photo('banque');
  dire(`filtres : ${await texte('.bq-f')}`);
  dire(`pied : ${await texte('.bqp')}`);
  const faites = new Set();
  for (let i = 0; i < 14; i++) {
    const prim = p.locator('.bq-livre .btn-primary').first();
    if (!(await prim.count())) { dire('plus de geste principal en face'); break; }
    const lib = (await prim.innerText()).replace(/\s+/g, ' ').trim();
    const ligne = await texte('.bq-l.on');
    if (faites.has(ligne)) { dire('la même ligne revient : je m’arrête là'); break; } faites.add(ligne);
    dire(`ligne : ${ligne.slice(0, 120)} · geste « ${lib} »`);
    if (/^Écrire|^Saisir/.test(lib)) { await photo(`banque-ligne-${i + 1}`); }
    await p.locator('.bq-aide').click().catch(() => {}); m.clics++;
    await touche('Enter', lib);
    if (await modale().isVisible().catch(() => false)) {
      dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 220)}`);
      await photo(`banque-fenetre-${i + 1}`);
      // Un chèque inconnu : le comptable ne sait pas quel compte mettre ; il ferme et passe à la ligne suivante.
      dire('je ne sais pas ce que c\'est : Échap, puis la ligne suivante (↓)');
      await touche('Escape', 'fermer la liste des comptes');
      await touche('Escape', 'fermer la fenêtre');
      await p.locator('.bq-aide').click().catch(() => {}); m.clics++;
      await touche('ArrowDown', 'ligne suivante');
      continue;
    }
    const ann = await texte('#bq-annonce');
    dire(`annonce : ${ann}`);
    if (!ann && i > 0) { const l2 = await texte('.bq-l.on'); if (l2 === ligne) { dire('rien ne bouge : je m’arrête'); break; } }
  }
  await photo('banque-fin');
  dire(`filtres : ${await texte('.bq-f')}`);
  dire(`pied : ${await texte('.bqp')}`);

  // 4. Valider le mois depuis la Saisie.
  await clic(p.locator('a.cp-ns').filter({ hasText: /^Saisie/ }).first(), 'retour à la Saisie');
  await p.waitForTimeout(1200);
  const lot = p.locator('[data-lot-mois="2026-09"]').first();
  if (await lot.count()) {
    await clic(lot, `« ${(await lot.innerText()).trim()} »`);
    await photo('valider-fenetre');
    dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
    await clic(modale().locator('#ok'), 'Valider');
    await p.waitForTimeout(2000);
    dire(`après : ${(await modale().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)} ${await texte('#toast')}`);
    await photo('valide');
  } else dire('pas de bouton « Valider le mois »');
  dire(`ruban : ${await texte('[data-cp-mois="2026-09"]')}`);
  dire(`en-tête : ${await texte('#view .page-head, #view header')}`.slice(0, 300));
} catch (e) { dire(`ARRÊT : ${e.message.split('\n')[0]}`); await photo('arret'); }
dire(`BILAN : ${m.clics} clics, ${m.touches} touches, ${m.molette} px de molette, ${((Date.now() - t0) / 1000).toFixed(0)} s (dont attentes du script) ; erreurs : ${JSON.stringify(err)}`);
fs.writeFileSync(`${D}/epreuve.log`, log.join('\n'));
await b.close();
