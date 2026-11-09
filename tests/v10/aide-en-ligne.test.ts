// L'Aide de l'entreprise, lue telle que le navigateur la reçoit (adaptations comprises). Lot débutant 2 (12/10/2026 ;
// docs/debutant.md) : un commerçant qui débute lisait, dans « Démarrer », qu'il fallait poser l'adresse de son comptable
// dans Paramètres → Envois et importer son « fichier d'appairage » pour lui envoyer un « paquet » — trois choses qui
// n'existent pas en ligne, où il confie son dossier par le code du cabinet (Comptabilité → Cabinet) et où le comptable
// lit ses livres en direct. L'article vers lequel il renvoyait décrivait le paquet de bout en bout.

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';


type Article = { id: string; title: string; sub?: string; body: string };

function guide() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(lireEcran('v10/guide.js'), bac, { filename: 'v10/guide.js' });
  return bac.SkanGuide as { ARTICLES: Article[] };
}
const texte = (a?: Article) => `${a?.title ?? ''} ${a?.sub ?? ''} ${a?.body ?? ''}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('l\'Aide de l\'entreprise, en ligne', () => {
  const { ARTICLES } = guide();
  const article = (id: string) => ARTICLES.find((a) => a.id === id);

  it('confier son dossier à son comptable : le code du cabinet, sans paquet ni fichier d\'appairage', () => {
    // Le test mesure : les trois articles sont lus, et ils parlent bien du comptable.
    for (const id of ['demarrer', 'compta', 'cabinet']) expect(texte(article(id)), id).toMatch(/comptable/);
    // Ce qui n'existe pas en ligne : le fichier d'appairage, le paquet qu'on fabrique et qui part chiffré. (« Paramètres →
    // Envois », « Email du comptable » et « Envoyer au comptable » existent en ligne — les journaux partent par e-mail — et
    // « il n'y a ni paquet ni fichier » dit vrai : le test vise ce qui faisait faire un geste impossible, pas un mot.)
    for (const id of ['demarrer', 'compta', 'cabinet']) {
      expect(texte(article(id)).match(/appairage|paquet (du mois|mensuel|du cabinet)|tes paquets/gi) ?? [], id).toEqual([]);
    }
    const cabinet = texte(article('cabinet'));
    expect(article('cabinet')?.title).toBe('Confier ta comptabilité à ton comptable');
    expect(cabinet).toContain('Comptabilité → Cabinet');
    expect(cabinet).toContain('code de son cabinet');
    // Ce que l'article cite existe : le bouton du panneau du mandat (plateforme/pont.js), l'onglet de la Comptabilité.
    expect(lireEcran('plateforme/pont.js')).toContain('Confier mon dossier');
    expect(cabinet).toContain('« Confier mon dossier »');
    expect(texte(article('demarrer'))).toContain('Comptabilité → Cabinet');
  });

  // (1.331.0, revue de l'Aide) Les articles décrivaient encore l'application de bureau : la licence qu'on colle (SKAN1),
  // la copie externe sur une clé USB, deux postes qui se passent un fichier, « fonctionne entièrement sur ton
  // ordinateur », « pas de pointage » au-dessus d'un pointage qui existe, et des numéros de version (« Depuis la 8.9.0 »)
  // que personne ne connaît. Le test vise ce qui ferait faire un geste impossible ou croire une chose fausse.
  it('aucun article ne décrit l\'application de bureau, ni ne nomme une version', () => {
    expect(ARTICLES.length).toBeGreaterThan(30);
    const faux = /\b\d+\.\d+\.\d+\b|SKAN1|copie externe|clé USB|iCloud|OneDrive|\.dmg|\.exe\b|(?<!pas )sur ton ordinateur|fonctionne entièrement|pas de pointage|pas de remise au comptoir|pas de lots|pas de dépôts|dossier partagé|Rejoindre un dossier|Paie → Barèmes|onglet <b>Barèmes|Préparer le paquet/i;
    expect(ARTICLES.filter((a) => faux.test(`${a.title} ${a.sub ?? ''} ${a.body}`)).map((a) => `${a.id} : ${(`${a.title} ${a.sub ?? ''} ${a.body}`.match(faux) || [''])[0]}`)).toEqual([]);
    // Ce qui existe se dit : l'abonnement (son onglet), les sauvegardes de chaque nuit, l'équipe et ses rôles.
    expect(article('licence')?.title).toBe('Ton abonnement');
    expect(texte(article('licence'))).toContain('Paramètres → Ton abonnement');
    expect(texte(article('donnees'))).toMatch(/chaque nuit/);
    expect(texte(article('donnees'))).toContain('Toutes les données de l\'entreprise');
    expect(texte(article('deux'))).toContain('Paramètres → L\'équipe → Inviter quelqu\'un…');
    for (const r of ['Propriétaire', 'Administrateur', 'Commercial', 'Caissier', 'Magasinier', 'Comptabilité interne', 'Paie', 'Lecture']) expect(texte(article('deux'))).toContain(r);
    expect(texte(article('conges'))).toContain('Note la demande');
    expect(texte(article('paie'))).toMatch(/Pointer.*Les bulletins.*Payer.*Déclarer/);
  });

  it('l\'Aide du Cabinet ne promet ni fichier à envoyer au client, ni poste à rejoindre', () => {
    const bac: Record<string, unknown> = {};
    bac.self = bac;
    vm.createContext(bac);
    vm.runInContext(lireEcran('v10/cabinet/cabguide.js'), bac, { filename: 'v10/cabinet/cabguide.js' });
    const arts = (bac.CabGuide as { ARTICLES: { id: string; t: string; s: string; d: string }[] }).ARTICLES;
    // Les articles que le Cabinet en ligne cache (`articlesAbsents` : sauvegardes, déménagement, licence, mises à jour)
    // parlent du bureau exprès ; les autres non.
    const absents = /ARTICLES_ABSENTS = \[([^\]]*)\]/.exec(lireEcran('plateforme/pont-cabinet.js'))?.[1] ?? '';
    const montres = arts.filter((a) => !absents.includes(`'${a.id}'`));
    expect(montres.length).toBeGreaterThan(10);
    const faux = /\.skanclose|copie externe|identité de ce poste|second poste|Deux postes, un cabinet/i;
    expect(montres.filter((a) => faux.test(`${a.t} ${a.s} ${a.d}`)).map((a) => a.id)).toEqual([]);
    const equipe = arts.find((a) => a.id === 'equipe');
    expect(equipe?.d).toContain('Inviter un collaborateur…');
    // Le bouton qui fabriquait le .skanclose ne se montre pas en ligne (il ne savait que refuser).
    expect(lireEcran('plateforme/pont-cabinet.js')).toMatch(/#cl-fichier \{ display: none !important; \}/);
  });
});
