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

  it('le mot entier se surligne, et rien du texte ne passe en HTML', () => {
    // Du HTML AVANT, ENTRE et APRÈS les mots surlignés : chaque morceau s'échappe, pas seulement le dernier.
    expect(R.surligne('<i>Le</i> taux de validité <b>du</b> mois validé', R.mots('valider'), esc))
      .toBe('&#60;i&#62;Le&#60;/i&#62; taux de <mark>validité</mark> &#60;b&#62;du&#60;/b&#62; mois <mark>validé</mark>');
    expect(R.extrait('<p>Une écriture validée ne se modifie jamais.</p>', 'valider', esc)).toBe('Une écriture <mark>validée</mark> ne se modifie jamais.');
    expect(R.extrait('<p>Rien ici.</p>', 'valider', esc)).toBe('');
  });

  it('sur les vrais articles du Cabinet, une question trouve son article ; les deux écrans appellent ce module', () => {
    const G = charger('v10/cabinet/cabguide.js', 'CabGuide') as { ARTICLES: Art[] };
    expect(G.ARTICLES.length).toBeGreaterThan(5);
    const trouve = (q: string) => R.filtre(G.ARTICLES, q, (a) => ({ titre: a.t, sous: a.s || '', corps: a.d || '' }));
    // La question qui ne trouvait rien : chaque mot était exigé, « comment » et « une » compris.
    expect(trouve('comment valider une écriture').length).toBeGreaterThan(0);
    expect(trouve('xylophone tablette')).toEqual([]);
    // Aucun des deux écrans ne garde sa propre recherche : ils appellent AideRecherche.
    const code = (f: string) => lireEcran(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['v10/app.js', 'v10/cabinet/app.js']) {
      expect(code(f), f).toMatch(/window\.AideRecherche/);
      // (Les anciennes : la liste des petits mots de l'entreprise, et le « chaque mot exigé » du Cabinet.)
      expect(code(f), f).not.toMatch(/AIDE_MOTS_VIDES|mots\.every\(m => titre\.includes\(m\) \|\| corps\.includes\(m\)\)/);
    }
  });
});
