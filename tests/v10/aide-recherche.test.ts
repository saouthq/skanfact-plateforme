// La recherche de l'Aide, une pour les deux applications (1.332.0 ; modules/socle/aide/recherche.js). Elle vivait dans
// l'écran de l'entreprise (1.331.0) pendant que le Cabinet gardait la sienne, qui exigeait chaque mot tapé : « comment
// valider une écriture » n'y trouvait aucun article. Ce que le test tient :
//   - une question se lit comme une question : les petits mots ne cherchent rien, un mot se cherche par sa racine ;
//   - les articles qui ont tous les mots passent avant ceux qui n'en ont qu'une partie, le titre avant le corps ;
//   - le surlignage marque le mot ENTIER et ne laisse passer aucun HTML ;
//   - sur les VRAIS articles, une question du Cabinet trouve son article, et les deux écrans appellent ce module —
//     aucun ne garde sa propre recherche.

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type Champs = { titre: string; sous: string; corps: string };
type Recherche = {
  mots: (q: string) => string[];
  filtre: <T>(arts: T[], q: string, champs: (a: T) => Champs) => T[];
  tous: <T>(a: T, q: string, champs: (a: T) => Champs) => boolean;
  surligne: (texte: string, mots: string[], esc: (s: string) => string) => string;
  extrait: (corps: string, q: string, esc: (s: string) => string) => string;
};
const charger = (fichier: string, nom: string) => {
  const bac: Record<string, unknown> = {};
  bac.self = bac; bac.window = bac;
  vm.createContext(bac);
  vm.runInContext(lireEcran(fichier), bac, { filename: fichier });
  return bac[nom];
};
const R = charger('v10/aide-recherche.js', 'AideRecherche') as Recherche;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Art = { id: string; t: string; s: string; d: string };
const champs = (a: Art) => ({ titre: a.t, sous: a.s, corps: a.d });

describe('la recherche de l\'Aide, une pour les deux applications', () => {
  it('une question se lit comme une question : les petits mots ne cherchent rien, un mot se cherche par sa racine', () => {
    expect(R.mots('Comment valider une écriture ?')).toEqual(['valid', 'ecritur']);
    // Une question faite QUE de petits mots les garde : sinon elle ne chercherait rien.
    expect(R.mots('et ou')).toEqual(['et', 'ou']);
    // Une racine trop courte garde le mot entier : « tva » ne devient pas « tv ».
    expect(R.mots('tva')).toEqual(['tva']);
    expect(R.mots('  ')).toEqual([]);
  });

  it('ceux qui ont tous les mots d\'abord, puis le poids (titre, sous-titre, corps), puis l\'ordre', () => {
    const arts: Art[] = [
      { id: 'corps', t: 'La banque', s: 'Les relevés', d: '<p>On lettre un acompte ici aussi.</p>' },
      { id: 'partiel', t: 'Le lettrage', s: 'Rapprocher', d: '<p>Rien d\'autre.</p>' },
      { id: 'titre', t: 'Lettrer un acompte', s: 'Le 411', d: '<p>Pas à pas.</p>' },
      { id: 'rien', t: 'La paie', s: 'Les bulletins', d: '<p>Le brut.</p>' },
    ];
    const q = 'comment lettrer un acompte';
    // « lettrer » trouve « lettre » et « lettrage » par sa racine ; « la paie » ne porte aucun des mots.
    expect(R.filtre(arts, q, champs).map((a) => a.id)).toEqual(['titre', 'corps', 'partiel']);
    expect(R.tous(arts[0] as Art, q, champs)).toBe(true);
    expect(R.tous(arts[1] as Art, q, champs)).toBe(false);
    // Rien de tapé : tous les articles, dans leur ordre.
    expect(R.filtre(arts, '', champs).map((a) => a.id)).toEqual(['corps', 'partiel', 'titre', 'rien']);
  });

  it('une question en langage courant (ENTSOCLE-23) : le morceau lu d\'un bloc, l\'intertitre et l\'expression courante pèsent', () => {
    // Trois articles qui portent tous les deux mots, une seule fois chacun dans le corps : sans le poids neuf, l'ordre du fichier.
    const bloc: Art[] = [
      { id: 'epars', t: 'Les réglages', s: '', d: '<p>Un mot sur la sécurité. Ne passe pas trop de temps ici, et n\'oublie rien.</p>' },
      { id: 'phrase', t: 'Tes données', s: '', d: '<p>Un mot de passe oublié se refait depuis la page de connexion.</p>' },
    ];
    expect(R.filtre(bloc, 'mot de passe oublié', champs).map((a) => a.id)[0]).toBe('phrase');
    const inter: Art[] = [
      { id: 'corps', t: 'La banque', s: '', d: '<p>Le relevé, et on relance aussi.</p>' },
      { id: 'intertitre', t: 'Encaisser', s: '', d: '<h3>Les relances</h3><p>Le relevé.</p>' },
    ];
    expect(R.filtre(inter, 'relancer', champs).map((a) => a.id)).toEqual(['intertitre', 'corps']);
    const courant: Art[] = [
      { id: 'devis', t: 'Le devis', s: '', d: '<p>Le client accepte, puis il paie.</p>' },
      { id: 'payer', t: 'Se faire payer', s: 'Retards et relances', d: '<p>Le client paie en retard : relance-le.</p>' },
      { id: 'bulletin', t: 'Payer quelqu\'un', s: '', d: '<p>Le bulletin du salarié, la paie du mois.</p>' },
    ];
    expect(R.filtre(courant, 'mon client ne paie pas', champs).map((a) => a.id)[0]).toBe('payer');
    // L'expression ne compte que dans le poids : un article qui n'a que ses mots à elle ne se propose pas.
    expect(R.filtre([{ id: 'relances', t: 'Les relances', s: '', d: '<p>Retards.</p>' }] as Art[], 'client ne paie pas', champs)).toEqual([]);
    expect(R.filtre(courant, 'la paie', champs).map((a) => a.id)[0]).toBe('bulletin');
  });

  it('sur les vrais articles de l\'entreprise, une question en langage courant trouve son article (ENTSOCLE-23)', () => {
    const bac: Record<string, unknown> = {};
    bac.self = bac; bac.window = bac;
    vm.createContext(bac);
    for (const f of ['v10/guide.js']) vm.runInContext(lireEcran(f), bac, { filename: f });
    const G = bac.SkanGuide as { ARTICLES: { id: string; title: string; sub?: string; body?: string }[] };
    const premier = (q: string) => R.filtre(G.ARTICLES, q, (a) => ({ titre: a.title, sous: a.sub || '', corps: a.body || '' }))[0]?.id;
    expect(premier('client ne paie pas')).toBe('paiements');
    expect(premier('mon client ne m\'a pas payé')).toBe('paiements');
    expect(premier('mot de passe oublié')).toBe('donnees');
    expect(premier('la paie')).toBe('paie');
    expect(premier('comment relancer un client')).toBe('paiements');
  });

  it('le mot entier se surligne, et rien du texte ne passe en HTML', () => {
    // Du HTML AVANT, ENTRE et APRÈS les mots surlignés : chaque morceau s'échappe, pas seulement le dernier.
    expect(R.surligne('<i>Le</i> taux de validité <b>du</b> mois validé', R.mots('valider'), esc))
      .toBe('&#60;i&#62;Le&#60;/i&#62; taux de <mark>validité</mark> &#60;b&#62;du&#60;/b&#62; mois <mark>validé</mark>');
    expect(R.extrait('<p>Une écriture validée ne se modifie jamais.</p>', 'valider', esc)).toBe('Une écriture <mark>validée</mark> ne se modifie jamais.');
    expect(R.extrait('<p>Rien ici.</p>', 'valider', esc)).toBe('');
  });

  it('sur les vrais articles du Cabinet, une question trouve son article ; les deux écrans appellent ce module', () => {
    const G = charger('v10/cabinet/cabguide.js', 'CabGuide') as { ARTICLES: Art[]; articleDe: (k: string) => string | null; articleDeLaPage: (k: string) => string | null };
    expect(G.ARTICLES.length).toBeGreaterThan(5);
    const trouve = (q: string) => R.filtre(G.ARTICLES, q, (a) => ({ titre: a.t, sous: a.s || '', corps: a.d || '' }));
    // La question qui ne trouvait rien : chaque mot était exigé, « comment » et « une » compris.
    expect(trouve('comment valider une écriture').length).toBeGreaterThan(0);
    expect(trouve('xylophone tablette')).toEqual([]);
    // (issue 12 CABPORTEFEUILLE-25) Le portefeuille, l'abonnement et les pièces ont leur article, trouvé en premier.
    expect(trouve('comment archiver un dossier')[0]?.id).toBe('portefeuille');
    expect(trouve('combien coûte un dossier')[0]?.id).toBe('abonnement');
    expect(trouve('coller une liste de clients')[0]?.id).toBe('portefeuille');
    expect(trouve('déposer une pièce')[0]?.id).toBe('pieces');
    expect(G.ARTICLES.some((a) => /Nouveau client…/.test(a.d))).toBe(false);
    // Leurs bulles et leurs pages y mènent (« Guide-moi », le lien d'une bulle).
    expect(G.articleDe('cd.page')).toBe('portefeuille');
    expect(G.articleDe('pc.page')).toBe('pieces');
    expect(G.articleDe('abo.cab')).toBe('abonnement');
    expect(G.articleDeLaPage('dossiers')).toBe('portefeuille');
    expect(G.articleDeLaPage('pieces')).toBe('pieces');
    // Aucun des deux écrans ne garde sa propre recherche : ils appellent AideRecherche.
    const code = (f: string) => lireEcran(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['v10/app.js', 'v10/cabinet/app.js']) {
      expect(code(f), f).toMatch(/window\.AideRecherche/);
      // (Les anciennes : la liste des petits mots de l'entreprise, et le « chaque mot exigé » du Cabinet.)
      expect(code(f), f).not.toMatch(/AIDE_MOTS_VIDES|mots\.every\(m => titre\.includes\(m\) \|\| corps\.includes\(m\)\)/);
    }
  });
});
