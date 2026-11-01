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
let p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const err = []; p.on('pageerror', (e) => err.push(e.message));
await p.addInitScript((j) => { if (globalThis.location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, C.jetons.leila);
let n = 0; const photo = async (nom) => { n++; await p.screenshot({ path: `${D}/${String(n).padStart(2, '0')}-${nom}.png` }); };
// Comme une main : si la cible n'est pas à l'écran, la molette la fait venir (et on compte la distance).
const voir = async (loc) => {
  const bx = await loc.boundingBox(); if (!bx) return;
  if (bx.y < 60 || bx.y + bx.height > 880) { const d = Math.round(bx.y - 300); await p.mouse.move(800, 450); await p.mouse.wheel(0, d); m.molette += Math.abs(d); await p.waitForTimeout(250); }
};
const clic = async (loc, quoi) => { await loc.waitFor({ timeout: 10000 }); await voir(loc); await loc.click(); m.clics++; dire(`clic : ${quoi}`); await p.waitForTimeout(600); };
const taper = async (txt, quoi) => { await p.keyboard.type(txt, { delay: 15 }); m.touches += txt.length; dire(`tape « ${txt} » : ${quoi}`); };
const touche = async (k, quoi) => { await p.keyboard.press(k); m.touches++; dire(`touche ${k} : ${quoi}`); await p.waitForTimeout(700); };
const texte = async (sel) => (await p.locator(sel).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
const modale = () => p.locator('#modal-root .modal').first();

const validerMois = async (mv) => {
  if (mv !== '2026-09') { await clic(p.locator(`[data-cp-mois="${mv}"]`), `${mv} au ruban`); await p.waitForTimeout(1200); }
  const lot = p.locator(`[data-lot-mois="${mv}"]`).first();
  if (await lot.count()) {
    await clic(lot, `« ${(await lot.innerText()).trim()} »`);
    await photo(`valider-fenetre-${mv}`);
    dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
    await clic(modale().locator('#ok'), 'Valider');
    await p.waitForTimeout(2000);
    dire(`après : ${(await modale().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)} ${await texte('#toast')}`);
    await photo(`valide-${mv}`);
  } else dire(`pas de bouton « Valider » pour ${mv}`);
  dire(`ruban : ${await texte(`[data-cp-mois="${mv}"]`)}`);
};

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

  const passage = async (tag, aValider) => {
  // 2. Les pièces du mois, une par une : lire la fiche, faire le geste principal (↵) ou le second.
  const vues = new Map();
  for (let i = 0; i < 8; i++) {
    if (await p.locator('#sx-fini').count()) { dire(`l'écran dit : ${await texte('#sx-fini')}`); await photo(`${tag}pieces-attendent`); break; }
    const fiche = p.locator('#sx-fiche');
    if (!(await fiche.count())) { dire('plus de fiche : les pièces du mois sont traitées'); break; }
    const titre = await texte('#sx-fiche .sx-fi-t');
    const prim = fiche.locator('.btn-primary').first();
    const lib = (await prim.innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    dire(`pièce : ${titre.slice(0, 120)} · geste principal « ${lib} »`);
    vues.set(titre, (vues.get(titre) || 0) + 1);
    if (vues.get(titre) > 1) {
      // Un humain ne refait pas deux fois la même demande : il va chercher la pièce qu'il n'a pas encore vue.
      dire(`DÉFAUT : la pièce revient après son geste (${vues.get(titre)}e fois) ; je clique la pièce suivante dans la bande`);
      const pas = p.locator('[data-sx-k]').filter({ hasNotText: /Minoterie|IMG_8790/ }).first();
      if (await pas.count()) { await clic(pas, `la pièce « ${(await pas.innerText()).trim()} » dans la bande`); vues.clear(); continue; }
      break;
    }
    await photo(`${tag}piece-${i + 1}`);
    if (!lib) { await touche('Alt+ArrowRight', 'pas de geste : pièce suivante'); continue; }
    // Une photo que rien n'a lue : Leïla lit la pièce à l'écran et tape ce qu'elle voit (la facture F-2026-0911).
    const four = p.locator('#sx-four');
    if (await four.count() && !(await four.inputValue())) {
      dire('pièce pas encore lue : je lis la photo et je tape');
      await clic(four, 'la case Fournisseur');
      await taper('Minoterie', 'le fournisseur'); await touche('Enter', 'le fournisseur choisi');
      await touche('Control+A', 'la date d\'arrivée remplacée'); await taper('11/09/2026', 'la date de la facture');
      await touche('Tab', 'case suivante'); await taper('1199,400', 'le total TTC');
      await touche('Tab', 'case suivante'); await taper('1', 'le timbre');
      await touche('Tab', 'case suivante');
      await p.locator('#sx-tva').selectOption('7'); m.clics++; dire('TVA 7 % choisie dans la liste');
      await p.waitForTimeout(800);
      dire(`écriture : ${await texte('#sx-fiche .sx-ec, #sx-ec-l')}`);
      await photo(`${tag}piece-${i + 1}-tapee`);
      await clic(p.locator('#sx-fiche .btn-primary').first(), '« Enregistrer et valider »');
      dire(`message : ${await texte('#toast')}`);
      await p.waitForTimeout(800);
      continue;
    }
    // Le geste principal au clavier, comme écrit sous la fiche.
    await p.locator('body').click({ position: { x: 1300, y: 20 } }); m.clics++;
    await touche('Enter', lib);
    if (await modale().isVisible().catch(() => false)) {
      dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
      await photo(`${tag}piece-${i + 1}-fenetre`);
      const ok = modale().locator('.btn-primary').first();
      if (await ok.isEnabled().catch(() => false)) await clic(ok, `valider la fenêtre (« ${(await ok.innerText()).trim()} »)`);
      else await touche('Escape', 'fermer la fenêtre');
    }
    dire(`message : ${await texte('#toast')}`);
    await p.waitForTimeout(800);
    const titre2 = await texte('#sx-fiche .sx-fi-t');
    if (titre2 === titre) { dire('la même pièce reste : Alt+→'); await touche('Alt+ArrowRight', 'pièce suivante'); }
  }
  await photo(`${tag}pieces-fin`);
  dire(`après les pièces : ${await texte('#sx-zone')}`.slice(0, 300));

  // 3. La Banque : rapprocher ce qui est proposé, ligne par ligne, à la touche Entrée.
  if (await p.locator('#sx-vers-banque').count()) await touche('Enter', 'Passer à la Banque (proposé par la Saisie)');
  else await clic(p.locator('a.cp-ns').filter({ hasText: /^Banque/ }).first(), 'Banque dans la barre de gauche');
  await p.waitForTimeout(1500);
  await photo(`${tag}banque`);
  dire(`filtres : ${await texte('.bq-f')}`);
  dire(`pied : ${await texte('.bqp')}`);
  const faites = new Set(); const demandes = [];
  for (let i = 0; i < 14; i++) {
    const prim = p.locator('.bq-livre .btn-primary').first();
    if (!(await prim.count())) { dire('plus de geste principal en face'); break; }
    const lib = (await prim.innerText()).replace(/\s+/g, ' ').trim();
    const ligne = await texte('.bq-l.on');
    if (faites.has(ligne)) { dire('la même ligne revient : je m’arrête là'); break; } faites.add(ligne);
    dire(`ligne : ${ligne.slice(0, 120)} · geste « ${lib} »`);
    if (/^Ouvrir la conversation/.test(lib)) { dire('il ne reste que la ligne qui attend le client'); await p.locator('.bq-aide').click().catch(() => {}); m.clics++; await touche('ArrowDown', 'ligne suivante'); continue; }
    if (/^Écrire|^Saisir/.test(lib)) { await photo(`${tag}banque-ligne-${i + 1}`); }
    await p.locator('.bq-aide').click().catch(() => {}); m.clics++;
    await touche('Enter', lib);
    if (await modale().isVisible().catch(() => false)) {
      dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 220)}`);
      await photo(`${tag}banque-fenetre-${i + 1}`);
      // Répondue par le client : sa réponse est dans la fenêtre, le compte qu'elle nomme est proposé ; on crée l'écriture.
      if (await p.locator('#bf-reponse').count()) {
        dire(`compte proposé : ${await p.locator('#modal-root [name=compte]').inputValue()}`);
        await clic(modale().locator('#ok'), '« Créer le brouillard »');
        dire(`annonce : ${await texte('#bq-annonce')} ${await texte('#toast')}`);
        continue;
      }
      // Un chèque inconnu : le comptable ne sait pas quel compte mettre ; il ferme, et le demande au client depuis la ligne.
      dire('je ne sais pas ce que c\'est : Échap, puis « Demander » sur la ligne');
      await touche('Escape', 'fermer la liste des comptes');
      if (await modale().isVisible().catch(() => false)) await touche('Escape', 'fermer la fenêtre');
      const dem = p.locator('#bq-demander');
      if (await dem.count()) {
        await clic(dem, `« ${(await dem.innerText()).trim()} »`);
        await photo(`${tag}banque-question-${i + 1}`);
        dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
        const env = modale().locator('#ok, .btn-primary').first();
        await clic(env, `« ${(await env.innerText()).trim()} »`);
        dire(`message : ${await texte('#toast')}`);
        demandes.push(ligne);
        dire(`annonce : ${await texte('#bq-annonce')}`);
      } else { await p.locator('.bq-aide').click().catch(() => {}); m.clics++; await touche('ArrowDown', 'ligne suivante'); }
      continue;
    }
    const ann = await texte('#bq-annonce');
    dire(`annonce : ${ann}`);
    if (!ann && i > 0) { const l2 = await texte('.bq-l.on'); if (l2 === ligne) { dire('rien ne bouge : je m’arrête'); break; } }
  }
  await photo(`${tag}banque-fin`);
  dire(`filtres : ${await texte('.bq-f')}`);
  dire(`pied : ${await texte('.bqp')}`);

  // 4. Valider le mois depuis la Saisie.
  await clic(p.locator('a.cp-ns').filter({ hasText: /^Saisie/ }).first(), 'retour à la Saisie');
  await p.waitForTimeout(1200);
  for (const mv of aValider) await validerMois(mv);
  dire(`en-tête : ${await texte('#view .page-head, #view header')}`.slice(0, 300));
  };
  await passage('', ['2026-09']);
  // 5. Sarra (la cliente), sur SkanFact : ce que son cabinet attend, depuis son accueil. Sa session vient de
  // EPREUVE_SARRA (un fichier qui garde son jeton, hors du dépôt) ; sans lui, l'épreuve s'arrête au cabinet.
  if (process.env.EPREUVE_SARRA) {
    dire('— Sarra ouvre SkanFact —');
    const js = fs.readFileSync(process.env.EPREUVE_SARRA, 'utf8').trim();
    const ps = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    ps.on('pageerror', (e) => err.push(e.message));
    await ps.addInitScript((j) => { if (globalThis.location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, js);
    const page0 = p; p = ps;
    await p.goto(`${C.adresse}/v10/?e=${C.entreprise.be}#/`); await p.waitForTimeout(2500);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await photo('sarra-accueil');
    dire(`accueil : ${await texte('.a-phrase')} · ${await texte('#todo, .todo-list, .panel:has(h2:text("À faire"))')}`.slice(0, 300));
    await clic(p.getByRole('button', { name: 'Répondre' }).first(), '« Répondre » (Ton cabinet attend…)');
    await p.waitForTimeout(1500);
    await photo('sarra-comptable');
    // a. La date de l'achat.
    const cd = p.locator('[data-msg-corriger-date]').first();
    if (await cd.count()) {
      await clic(cd, '« Corriger la date… »');
      dire(`fenêtre : ${(await p.locator('.msg-fenetre').innerText()).replace(/\s+/g, ' ').slice(0, 260)}`);
      await photo('sarra-date');
      await touche('Enter', 'Corriger et prévenir mon cabinet');
      dire(`message : ${await texte('#toast')}`);
    } else dire('DÉFAUT : pas de « Corriger la date » sur la demande de date');
    // b. La photo illisible, reprise à plat.
    const img = `${D}/IMG_8790-bis.png`;
    const pf = await b.newPage({ viewport: { width: 600, height: 760 } });
    await pf.setContent(`<body style="font:15px sans-serif;padding:30px;background:#fff"><h2>Minoterie du Cap Bon</h2><p>Facture F-2026-0911 du 11/09/2026</p><p>Farine T55, 25 sacs</p><p>Total HT 1 120,000 · TVA 7 % 78,400 · Timbre 1,000</p><h3>Net à payer 1 199,400 DT</h3></body>`);
    await pf.screenshot({ path: img }); await pf.close();
    const env = p.locator('.msg-demande-carte:has-text("IMG_8790") [data-msg-envoyer-piece]').first();
    if (await env.count()) {
      await clic(env, '« Envoyer la pièce… » (IMG_8790)');
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), clic(p.locator('.msg-fenetre [data-ep-choisir]').first(), '« Choisir la photo ou le PDF… »')]);
      await fc.setFiles(img);
      dire('choisit la nouvelle photo');
      await p.waitForTimeout(800);
      await photo('sarra-photo');
      await clic(p.locator('.msg-fenetre').getByRole('button', { name: 'Envoyer à mon cabinet' }), '« Envoyer à mon cabinet »');
      dire(`message : ${await texte('#toast')}`);
    }
    // c. La question du chèque.
    const q = p.locator('textarea[data-msg-q-texte]').first();
    if (await q.count()) {
      await clic(q, 'la réponse à la question');
      await taper('C\'est le chèque de la levure, la facture LS-7702 des Levures du Sahel.', 'sa réponse');
      await clic(p.locator('[data-msg-q-envoyer]').first(), '« Envoyer ma réponse »');
      dire(`message : ${await texte('#toast')}`);
    } else dire('pas de question ouverte');
    await p.waitForTimeout(1500);
    await photo('sarra-fin');
    dire(`en attente de toi : ${await texte('.msg-attente, .msg-cote-attente')}`);
    await p.goto(`${C.adresse}/v10/?e=${C.entreprise.be}#/`); await p.waitForTimeout(2000);
    dire(`accueil après : ${await texte('.a-phrase')}`);
    p = page0;
    // 6. Le cabinet reprend : ce que Sarra a fait revient dans la Saisie et la Banque ; puis août et septembre se valident.
    dire('— Leïla reprend le dossier —');
    await p.goto(`${C.adresse}/v10/cabinet/?c=${C.cabinet}#/dossier/${C.entreprise.be}`); await p.waitForTimeout(2000);
    await clic(p.locator('a.cp-ns').filter({ hasText: /^Saisie/ }).first(), 'Saisie dans la barre de gauche');
    await p.waitForTimeout(1500);
    await clic(p.locator('[data-cp-mois="2026-09"]'), 'septembre au ruban');
    await photo('2-saisie-sept');
    await passage('2-', ['2026-09', '2026-08']);

    // 7. La déclaration de septembre : on y va depuis la Saisie (le mois fini la propose) ; ce que les contrôles signalent
    // se règle depuis leur bouton (le compte d'attente : depuis la conversation), puis l'écriture du mois, puis « déposée ».
    dire('— La déclaration de septembre —');
    const versSaisieSept = async () => {
      const lien = p.locator('a.cp-ns').filter({ hasText: /^Saisie/ }).first();
      if (await lien.count()) await clic(lien, 'Saisie dans la barre de gauche');
      else { await p.goto(`${C.adresse}/v10/cabinet/?c=${C.cabinet}#/dossier/${C.entreprise.be}/comptabilite/saisie/2026`); dire('pas de lien Saisie dans la barre ici : je passe par l\'adresse'); }
      await p.waitForTimeout(1500);
      if (await p.locator('[data-cp-mois="2026-09"]').count()) await clic(p.locator('[data-cp-mois="2026-09"]'), 'septembre au ruban');
    };
    // Le mois que la Saisie propose de déclarer (août d'abord s'il n'est pas déposé) ; Entrée y mène.
    let moisD = '2026-09';
    const versDeclaration = async () => {
      await versSaisieSept();
      dire(`saisie : ${await texte('#sx-zone')}`.slice(0, 220));
      if (!(await p.locator('#sx-vers-declaration').count()) && await p.locator('[data-lot-mois="2026-09"]').count()) await validerMois('2026-09');
      const vd = p.locator('#sx-vers-declaration');
      if (!(await vd.count())) { dire('DÉFAUT : la Saisie ne propose pas la déclaration'); return false; }
      moisD = await vd.getAttribute('data-mois') || '2026-09';
      await touche('Enter', `« ${(await vd.innerText()).replace(/\s+/g, ' ').trim()} »`);
      await p.waitForTimeout(2000);
      return true;
    };
    const declarer = async () => {
      if (!(await versDeclaration())) return false;
      const m0 = moisD;
      await photo(`decl-${m0}`);
      dire(`contrôles (${m0}) : ${await texte('#dc-controles, #dc-controles-attente, .ligne-ok')}`);
      if (await p.locator('[data-vers-attente]').count()) {
        await clic(p.locator('[data-vers-attente]').first(), '« L\'imputer depuis la conversation »');
        await p.waitForTimeout(2500);
        await clic(p.locator('[data-msg-imputer]').first(), '« Imputer le virement »');
        dire(`compte proposé : ${await p.locator('#modal-root [name=compte]').inputValue()} · date : ${await p.locator('#modal-root [name=date]').inputValue()}`);
        await photo('decl-imputer');
        await clic(modale().locator('#ok'), '« Imputer au brouillard »');
        dire(`message : ${await texte('#toast')}`);
        if (!(await versDeclaration())) return false;
        dire(`contrôles (${moisD}) : ${await texte('#dc-controles, #dc-controles-attente, .ligne-ok')}`);
      }
      if (!(await p.locator('#dc-preparer').count())) { dire('DÉFAUT : pas de « Préparer la déclaration »'); return false; }
      await clic(p.locator('#dc-preparer'), '« Préparer la déclaration »');
      await p.waitForTimeout(1500);
      if (await modale().isVisible().catch(() => false)) { dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); await clic(modale().locator('#ok, .btn-primary').first(), 'confirmer'); }
      const ec = p.locator('#dc-ecriture');
      if (await ec.count() && await ec.isEnabled()) {
        await clic(ec, '« Écrire l\'écriture du mois »');
        await p.waitForTimeout(1500);
        if (await modale().isVisible().catch(() => false)) { dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); await clic(modale().locator('#ok, .btn-primary').first(), 'confirmer'); }
        dire(`après : ${await texte('#toast')}`);
        // Au brouillard, l'étape se valide d'ici.
        const val = p.locator('#dc-ecriture');
        if (await val.isEnabled().catch(() => false) && /Valider/.test(await val.innerText())) {
          await clic(val, `« ${(await val.innerText()).replace(/\s+/g, ' ').trim()} »`);
          await p.waitForTimeout(1500);
          dire(`après : ${await texte('#toast')}`);
          dire(`contrôles (${m0}) : ${await texte('#dc-controles, #dc-controles-attente, .ligne-ok')}`);
        }
      }
      for (let k = 0; k < 2; k++) {
        await clic(p.locator('#dc-deposee'), '« Marquer déposée »');
        await p.waitForTimeout(1200);
        if (!(await modale().isVisible().catch(() => false))) break;
        dire(`fenêtre : ${(await modale().innerText()).replace(/\s+/g, ' ').slice(0, 260)}`);
        await photo(`decl-deposee-fenetre-${m0}`);
        const ok = modale().locator('#ok, .btn-primary').first();
        const lib = (await ok.innerText()).trim();
        await clic(ok, `« ${lib} »`);
        if (!/brouillard/i.test(lib)) break;
        await p.waitForTimeout(1200);
        if (m0 !== '2026-09') { await clic(p.locator(`[data-cp-mois="${m0}"]`), `${m0} au ruban`); await p.waitForTimeout(1000); }
        await validerMois(m0);
        // Retour à la déclaration du même mois, par la Saisie de septembre (le chemin qu'un comptable prendrait).
        if (!(await versDeclaration())) return false;
        dire(`contrôles (${moisD}) : ${await texte('#dc-controles, #dc-controles-attente, .ligne-ok')}`);
      }
      dire(`après : ${await texte('#toast')}`);
      await photo(`decl-fin-${m0}`);
      dire(`ruban : août ${await texte('[data-cp-mois="2026-08"] small')} · sept. ${await texte('[data-cp-mois="2026-09"] small')}`);
      return true;
    };
    for (let k = 0; k < 3; k++) {
      if (!(await declarer())) break;
      if (/déposé/.test(await texte('[data-cp-mois="2026-09"] small'))) break;
    }
  }
} catch (e) { dire(`ARRÊT : ${e.message.split('\n')[0]}`); await photo('arret'); }
dire(`BILAN : ${m.clics} clics, ${m.touches} touches, ${m.molette} px de molette, ${((Date.now() - t0) / 1000).toFixed(0)} s (dont attentes du script) ; erreurs : ${JSON.stringify(err)}`);
fs.writeFileSync(`${D}/epreuve.log`, log.join('\n'));
await b.close();
