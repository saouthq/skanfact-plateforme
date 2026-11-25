// 1.388.64 (#26) — le pont client ↔ cabinet : la question arrivée page ouverte, le mandat qu'on change, l'archivage, l'arrêt,
// les déclarations et la paie hors d'atteinte, et les finitions du fil.
import { describe, it, expect } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(racine, f), 'utf8');
const MSG = lire('web/public/plateforme/messagerie.js');
const PONT = lireEcran('plateforme/pont.js');
const PC = lireEcran('plateforme/pont-cabinet.js');
const APP2 = lire('modules/socle/ecrans/entreprise/app-2.js');
const CAB = lire('modules/socle/ecrans/cabinet/app-1.js');
const PAIE = lire('modules/personnel/ecrans/cabinet/paie.js');
const CSS = lire('web/public/plateforme/messagerie-fil.css');

describe('PONT-1 : une question arrivée page ouverte se répond', () => {
  it('le fichier ne part qu\'une fois la question retrouvée', () => {
    const i = MSG.indexOf("surClic(fil, '[data-msg-q-envoyer]'");
    const bloc = MSG.slice(i, MSG.indexOf('await relire();', i));
    const verif = bloc.indexOf('o.questionConnue && !(await o.questionConnue(id))');
    expect(verif).toBeGreaterThan(0);
    expect(verif).toBeLessThan(bloc.indexOf('await envoyerFichier('));
  });
  it('l\'écran relit les questions avant de dire qu\'une question n\'existe plus', () => {
    expect(PONT).toMatch(/\(window\)\.__relireQuestions = relireLesQuestions/);
    const i = APP2.indexOf('questionConnue: async id =>');
    expect(APP2.slice(i, i + 600)).toContain('window.__relireQuestions');
    const r = APP2.indexOf('repondre: async (id, texte) =>');
    expect(APP2.slice(r, r + 400)).toMatch(/__relireQuestions[\s\S]*C\.repondreQuestion/);
  });
});

describe('PONT-3 : le propriétaire change ce qu\'il confie sans arrêter le mandat', () => {
  it('le panneau du mandat actif offre « Changer ce que je lui confie… » et appelle la route du périmètre', () => {
    expect(PONT).toContain("m.statut === 'actif' ? '<button type=\"button\" class=\"btn\" id=\"mandat-changer\">Changer ce que je lui confie…</button>'");
    expect(PONT).toContain("await appel('PUT', '/mandat/perimetre', { perimetre })");
    expect(PONT).toContain('(m.perimetre || []).includes(k) ? \' checked\'');
  });
});

describe('PONT-8 : archiver un client sur SkanFact ne met pas fin au mandat, et la fenêtre le dit', () => {
  it('la fenêtre nomme le mandat qui continue', () => {
    const i = CAB.indexOf('async function fenArchiver(');
    const bloc = CAB.slice(i, i + 3000);
    expect(bloc).toContain('Archiver ne met pas fin au mandat.');
    expect(bloc).toContain('const relies = l.filter(d => !d.manual && !d.demo)');
    expect(bloc).toContain('const corps = `${noms}${mandat}');
  });
});

describe('PONT-12 : les déclarations hors du mandat', () => {
  it('la Déclaration le dit à l\'ouverture, et le dossier sort de la campagne', () => {
    const i = CAB.indexOf('function vueDeclaration(dossier)');
    const bloc = CAB.slice(i, i + 1400);
    expect(bloc).toContain('Les déclarations ne sont pas confiées au cabinet');
    expect(bloc.indexOf("!dossier.perimetre.includes('declarations')")).toBeLessThan(bloc.indexOf('Lecture de la déclaration'));
    expect(CAB).toContain("const sansTva = sansTvaCd(d) || (!d.manual && Array.isArray(d.perimetre) && !d.perimetre.includes('declarations'));");
  });
});

describe('PONT-14 : la paie refusée au rôle se dit à l\'ouverture', () => {
  it('le refus du serveur est gardé à la lecture, et l\'onglet le dit au lieu de « Déclarer un salarié… »', () => {
    expect(PC).toContain("paieRefus.set(id, String(e.message || ''))");
    expect(PC).toContain("paieRefusee: (/** @type {string} */ id) => paieRefus.get(id) || ''");
    const i = PAIE.indexOf('function vuePaie(dossier)');
    const bloc = PAIE.slice(i, i + 1500);
    expect(bloc).toContain('La paie de ce dossier ne t\'est pas ouverte');
  });
});

describe('PONT-6, 11, 15 à 18 : les finitions du fil et du mandat', () => {
  it('PONT-6 : un échec remplace la phrase au lieu d\'en empiler une', () => {
    expect(PC).toContain("ligne.querySelectorAll('[role=alert]').forEach((/** @type {Element} */ e) => e.remove())");
    expect(PC).toContain('Ce client a retiré sa proposition');
  });
  it('PONT-11 : sans mandat actif, « Mon comptable » propose d\'inviter un cabinet', () => {
    expect(MSG).toContain('entreprise && !(f && f.actif) ? `<div class="msg-encart attend" data-msg-sans-cabinet>');
    expect(MSG).toContain('Inviter mon comptable</button>');
  });
  it('PONT-15 : le client ne lit pas un numéro de compte en titre de question', () => {
    expect(MSG).toMatch(/const titreQ = .*\/\^\\s\*compte\\b\/i/);
    expect(MSG).not.toContain('esc(q.objet || q.texte)');
  });
  it('PONT-16 et 18 : « Envoyer » vide en sombre, la croix du fichier à 44 points', () => {
    expect(CSS).toContain('.msg-envoyer.vide, body.dark .msg-envoyer.vide {');
    expect(CSS).toMatch(/\.msg-page \.msg-joint button \{ min-width: 44px; min-height: 44px;/);
  });
  it('PONT-17 : la proposition s\'accepte en tête du Tableau de bord', () => {
    expect(PC).not.toContain('sur la page Dossiers');
    expect(PC).toContain("Tu l'acceptes en tête de ton Tableau de bord");
  });
});
