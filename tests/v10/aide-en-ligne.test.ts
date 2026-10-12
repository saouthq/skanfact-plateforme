// L'Aide de l'entreprise, lue telle que le navigateur la reçoit (adaptations comprises). Lot débutant 2 (12/10/2026 ;
// docs/debutant.md) : un commerçant qui débute lisait, dans « Démarrer », qu'il fallait poser l'adresse de son comptable
// dans Paramètres → Envois et importer son « fichier d'appairage » pour lui envoyer un « paquet » — trois choses qui
// n'existent pas en ligne, où il confie son dossier par le code du cabinet (Comptabilité → Cabinet) et où le comptable
// lit ses livres en direct. L'article vers lequel il renvoyait décrivait le paquet de bout en bout.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PUBLIC = path.join(import.meta.dirname, '../../web/public');

type Article = { id: string; title: string; sub?: string; body: string };

function guide() {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'v10/guide.js'), 'utf8'), bac, { filename: 'v10/guide.js' });
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
    expect(fs.readFileSync(path.join(PUBLIC, 'plateforme/pont.js'), 'utf8')).toContain('Confier mon dossier');
    expect(cabinet).toContain('« Confier mon dossier »');
    expect(texte(article('demarrer'))).toContain('Comptabilité → Cabinet');
  });
});
