// (1.388.82, CE-01) La carte « Déclaré à l'État » de la fiche d'un dossier disait 0,000 DT pendant que l'historique, juste à
// côté, montrait « Juillet déposé 879,999 DT » : une déclaration déposée « hors livre » (l'écran Échéances, son montant
// tapé) ne porte que sa case `aDecaisser`, et la carte ne lisait que les cases détaillées.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const RACINE = path.join(import.meta.dirname, '../..');
const source = fs.readFileSync(path.join(RACINE, 'modules/socle/ecrans/cabinet/app-1.js'), 'utf8');
const debut = source.indexOf('  const montantDe = v =>');
const fin = source.indexOf('\n  // Ce que le livre d\'une année dit', debut);
const corps = source.slice(debut, fin);

const total = (): ((cs: Record<string, unknown>) => number) => {
  const ctx: { t?: (cs: Record<string, unknown>) => number } = {};
  vm.runInNewContext(`${corps}; this.t = totalDeDeclaration;`, ctx);
  return ctx.t as (cs: Record<string, unknown>) => number;
};

describe('le total d\'une déclaration sur la fiche (1.388.82)', () => {
  it('la tranche lue est celle du calcul', () => {
    expect(debut).toBeGreaterThan(0);
    expect(corps.length).toBeGreaterThan(300);
    expect(corps.length).toBeLessThan(1200);
    expect(source).toMatch(/total: totalDeDeclaration\(cs\)/);
  });
  it('déposée hors livre : son seul montant fait le total', () => {
    const t = total();
    // Comme le pont rend les cases : chaque case du serveur, null quand elle n'est pas remplie.
    expect(t({ netAPayer: { montant: null }, timbre: { montant: null }, aDecaisser: { montant: 879.999 } })).toBe(879.999);
    expect(t({ aDecaisser: '412,500' })).toBe(412.5);
  });
  it('préparée dans SkanFact : les cases détaillées, pas le total à décaisser', () => {
    const t = total();
    expect(t({ netAPayer: { montant: 95 }, timbre: { montant: 2 }, irpp: { montant: 30.5 }, aDecaisser: { montant: 97 } })).toBe(127.5);
    // Une case à zéro est une case remplie : le total est zéro, pas le montant à décaisser.
    expect(t({ netAPayer: { montant: 0 }, aDecaisser: { montant: 12 } })).toBe(0);
  });
});

// (1.388.82, CE-02) « Pièces manquantes » : 5 au tableau de bord, 2 dans Tous les dossiers, au même instant. Le tableau de
// bord comptait les mois « à recevoir » de toute l'année (le mois en cours compris, ceux dont les pièces attendaient
// d'être classées aussi) ; la page Tous les dossiers, ce qui se réclame au client. Une règle, deux lecteurs.
describe('« Pièces manquantes » se compte par une seule règle (1.388.82)', () => {
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  it('la règle « réclamé au client » n\'est écrite qu\'une fois', () => {
    expect(code.match(/reclame: !d\.manual && \(!!mo\.manque \|\| sp\.length > 0\)/g) || []).toHaveLength(1);
    expect(code.match(/function reclamesDuPortefeuille\(\)/g) || []).toHaveLength(1);
  });
  it('la puce du tableau de bord et la page Tous les dossiers la lisent', () => {
    const tb = code.slice(code.indexOf('function lignesTb()'), code.indexOf('const anneauTb ='));
    expect(tb).toMatch(/reclamesDuPortefeuille\(\)/);
    expect(tb).toMatch(/reclame: R\.aReclamer\(d\)/);
    expect(code).toMatch(/manque: x => !!x\.reclame,/);
    expect(code).not.toMatch(/manque: x => !x\.d\.manual && x\.manque > 0/);
    const dos = code.slice(code.indexOf('function drawDossiersCd(view)'), code.indexOf('const L = actifs.map(lignesDe);'));
    expect(dos.length).toBeLessThan(3000);
    expect(dos).toMatch(/reclamesDuPortefeuille\(\)/);
    expect(code).toMatch(/v === 'manque' \? x\.reclame && !x\.pc :/);
  });
});

// (1.388.82, CE-03) Le compte d'attente : « −1 250,000 DT · 1 ligne à expliquer » sur la fiche, « rien à signaler » au
// contrôle de clôture, qui ne lit que les validées. La fiche compte le brouillard, et le dit maintenant, comme ses voisines.
describe('le compte d\'attente de la fiche dit son brouillard (1.388.82)', () => {
  it('le brouillard du 471 est compté et nommé sur la tuile', () => {
    expect(source).toMatch(/if \(br && \(e\.lignes \|\| \[\]\)\.some\(l => \/\^471\/\.test\(String\(l\.compte \|\| ''\)\)\)\) brAttente\+\+;/);
    expect(source).toMatch(/à expliquer\$\{brDit\(L\.brAttente\)\}/);
    expect(source).toMatch(/brVente, brBanque, brAttente, comptesBq/);
  });
});

// (1.388.82, CE-04, CE-05) La Paie d'un client employeur sans salarié déclaré ici : la frise cochait « Pointage ✓ personne en
// poste ce mois » (une coche verte sur le vide) et la CNSS s'ouvrait sur le trimestre en cours, « 4e » à côté du « 3ᵉ » des
// Échéances.
describe('la Paie sans salarié déclaré (1.388.82)', () => {
  const paie = fs.readFileSync(path.join(RACINE, 'modules/personnel/ecrans/cabinet/paie.js'), 'utf8');
  const cab = fs.readFileSync(path.join(RACINE, 'web/public/v10/cabinet/cabcore.js'), 'utf8');
  it('la frise ne coche pas le pointage sans salarié, et le dit', () => {
    expect(paie).toMatch(/\['Pointage', !P\.actifs \? 'aucun salarié déclaré ici' : !P\.duMois \? 'personne en poste ce mois'/);
    expect(paie).toMatch(/!!P\.actifs && \(!P\.duMois \|\| P\.pointe > 0 \|\| P\.n > 0\)\],/);
    expect(paie).toMatch(/const cnss = !\(L\.salaries \|\| \[\]\)\.length \? 'CNSS : aucun salarié déclaré ici'/);
  });
  it('les salaires que les livres portent sans salarié déclaré se disent', () => {
    expect(paie).toMatch(/const Hx = !P\.actifs \? salairesHorsBulletins\(L, annee\) : null;/);
    expect(paie).toMatch(/id="pa-ailleurs"/);
  });
  it('sans bulletin, la CNSS s\'ouvre sur le dernier trimestre terminé', () => {
    const f = paie.slice(paie.indexOf('function trimestreCnss(L, s)'), paie.indexOf('function vuePaie(dossier)'));
    expect(f.length).toBeLessThan(1200);
    expect(f).toMatch(/K\.today\(\)\.slice\(0, 7\) > `\$\{s\.annee\}-\$\{String\(t \* 3\)\.padStart\(2, '0'\)\}`\) return t;/);
  });
  it('« 1ᵉʳ », « 3ᵉ » : la Paie écrit les trimestres comme les Échéances', () => {
    expect(paie).toMatch(/qn = q === 1 \? '1ᵉʳ' : `\$\{q\}ᵉ`/);
    expect(cab).not.toMatch(/`(TVA|CNSS) du \$\{trim\}ᵉ trimestre/);
  });
});

// (1.388.82, CE-06) Échéances, vue Mois : la note « Encore en retard » s'arrêtait à trois échéances sur quatre, et nommait
// « la déclaration de septembre » celle des personnes physiques comme l'autre.
describe('la note « Encore en retard » de la vue Mois (1.388.82)', () => {
  const app2 = fs.readFileSync(path.join(RACINE, 'modules/socle/ecrans/cabinet/app-2.js'), 'utf8');
  it('elle nomme chaque échéance par son nom court qualifié, et compte celles qu\'elle ne liste pas', () => {
    const n = app2.slice(app2.indexOf('Encore en retard, d\'un mois d\'avant'), app2.indexOf('function moisAttendus(D, toutes)'));
    expect(n.length).toBeLessThan(500);
    expect(n).toMatch(/avant\.slice\(0, 4\)/);
    expect(n).toMatch(/nomCourtEch\(x\)/);
    expect(n).toMatch(/avant\.length > 4 \? `, et \$\{pl\(avant\.length - 4, 'autre'\)\}` : ''/);
  });
});

// (1.388.82, CE-07) Messages : « Noter pour lundi » sur une pièce demandée faisait passer « On attend » de 1 à 2 — la même
// pièce, demandée pour le 29/11 ET promise pour le 30/11.
describe('une promesse sur une pièce demandée ne compte pas deux fois (1.388.82)', () => {
  const msg = fs.readFileSync(path.join(RACINE, 'web/public/plateforme/messagerie.js'), 'utf8');
  it('la promesse se range sur la ligne de sa pièce', () => {
    expect(msg).toMatch(/const surDemande = promiseActive \? ds\.find\(\(m\) => memeTexte\(m\.demande\.texte\) === memeTexte\(promiseActive\.quoi\)\) : null;/);
    expect(msg).toMatch(/\$\{m === surDemande \? ` · \$\{ditPromesse\(promiseActive\)\}` : ''\}/);
    expect(msg).toMatch(/if \(promesse && !promesse\.tenue && !surDemande\) items\.push\(/);
  });
});

// (1.388.82, CE-08) La Déclaration d'août : « à saisir » au-dessus de « 10 pièces d'août attendent encore au brouillard »,
// quand le tableau de production disait « à réviser ».
describe('l\'état d\'un mois au brouillard (1.388.82)', () => {
  it('un mois dont des écritures attendent au brouillard est « à réviser »', () => {
    const f = source.slice(source.indexOf('function motEtatDecl('), source.indexOf('const panneauPieces = '));
    expect(f.length).toBeLessThan(1200);
    // (1.390.2, issue 6, CAB-1) La fonction est JOUÉE : une déclaration préparée sur un mois dont des pièces attendent au
    // brouillard reste « à réviser » — la 1.388.82 la disait « prêt à déposer », et ce test gravait cet ordre.
    const ctx: { K: unknown; m?: (e: Record<string, unknown>, p: string, b?: number) => string[] } = { K: { today: () => '2026-11-28' } };
    vm.runInNewContext(`${f}; this.m = motEtatDecl;`, ctx);
    const mot = ctx.m as (e: Record<string, unknown>, p: string, b?: number) => string[];
    expect(mot({ brouillard: 3 }, '2026-10')[0]).toBe('à réviser');
    expect(mot({ declaration: true }, '2026-10', 0)[0]).toBe('prêt à déposer');
    expect(mot({ declaration: true, brouillard: 12 }, '2026-10', 12)[0]).toBe('à réviser');
    expect(mot({ declaration: true, declare: true }, '2026-10', 12)[0]).toBe('déposé');
    expect(mot({ saisi: true }, '2026-10', 0)[0]).toBe('à déposer');
  });
});

// (1.388.82, CE-09, CE-10) La saisie : un rôle de saisie se voyait proposer « Valider cette écriture », confirmait, puis lisait
// « Validation refusée » ; et « Face à la pièce » ne répondait pas sur une pièce venue de Pièces reçues.
describe('la saisie au Cabinet (1.388.82)', () => {
  const app2 = fs.readFileSync(path.join(RACINE, 'modules/socle/ecrans/cabinet/app-2.js'), 'utf8');
  it('« Valider cette écriture » se grise pour qui ne valide pas, et la légende des touches ne le promet pas', () => {
    const f = app2.slice(app2.indexOf('function actionsEcriture(root, dossier, e)'), app2.indexOf("if (e.source !== 'skanfact' && attenteBl(e))"));
    expect(f.length).toBeLessThan(4000);
    expect(f).toMatch(/if \(!peutValiderCl\(dossier\)\) Object\.assign\(a\[a\.length - 1\], \{ hint: [\s\S]{0,120}, off: true,/);
    expect(app2).toMatch(/\$\{aideTouches\(peutValiderCl\(dossier\)\)\}/);
    expect(source).toMatch(/valide \? paire\('Enregistrer et valider', t\.valider\) : ''/);
  });
  it('« Face à la pièce » choisi à la main n\'est pas repris par le redessin', () => {
    expect(app2).toMatch(/sxState\.modeVoulu = \{ mode: sxState\.mode, piece: saisieState\.piece \};/);
    expect(app2).toMatch(/if \(\(pieceEnCours\(p\) \|\| p\.depuisClasseur\) && !faceVoulue\) sxState\.mode = 'km';/);
  });
});

// (1.388.82, CE-11) Le sélecteur de dossiers annonçait « Ctrl 1…9 », le curseur dans sa recherche, et le raccourci y était
// ignoré (« jamais dans un champ »).
describe('Ctrl + chiffre dans le sélecteur de dossiers (1.388.82)', () => {
  it('la recherche vide du sélecteur laisse passer le raccourci, les autres champs non', () => {
    expect(source).toMatch(/if \(champ && !\(champ\.matches\('\[data-chercher-d\]'\) && !champ\.value\)\) return;/);
  });
});

// (1.388.82, CE-12) Saisir depuis une pièce : le libellé reprenait le nom du fichier — « IMG_0412 » au livre-journal.
describe('le libellé d\'une écriture saisie depuis une pièce (1.388.82)', () => {
  const app2 = fs.readFileSync(path.join(RACINE, 'modules/socle/ecrans/cabinet/app-2.js'), 'utf8');
  const i = app2.indexOf('  const libelleDeFichier = nom =>');
  const corps = app2.slice(i, app2.indexOf('  function saisirPiece(', i));
  const f = (): ((n: string) => string) => { const ctx: { f?: (n: string) => string } = {}; vm.runInNewContext(`${corps}; this.f = libelleDeFichier;`, ctx); return ctx.f as (n: string) => string; };
  it('un nom parlant se lit, un nom d\'appareil photo laisse le libellé vide', () => {
    expect(i).toBeGreaterThan(0);
    expect(corps.length).toBeLessThan(800);
    const l = f();
    expect(l('facture-hebergement-T3.pdf')).toBe('Facture hebergement T3');
    expect(l('ticket_carburant_24-09.jpg')).toBe('Ticket carburant 24 09');
    expect(l('IMG_0412.jpg')).toBe('');
    expect(l('PXL_20261104_101500.jpg')).toBe('');
    expect(l('20261104.pdf')).toBe('');
    expect(l('فاتورة-الكهرباء.pdf')).toBe('فاتورة الكهرباء');
    expect(app2).toMatch(/libelle: libelleDeFichier\(nom\), depuisClasseur: depuis \};/);
  });
});
