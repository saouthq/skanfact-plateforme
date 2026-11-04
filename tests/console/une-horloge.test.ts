// (rouge GitHub de 1.276.1, 04/11/2026) Les routes de la console écrivaient à l'heure du contexte (`maintenant()`) mais
// dataient leur jour du vrai calendrier (`aujourdhuiATunis()` sans argument) : un essai lancé à 23 h 42 à Tunis et fini après
// minuit voyait la reprise ouverte « le 05 » quand son horloge disait « le 04 », et la fiche d'un groupe introuvable.
// Une seule horloge : le jour de la console se lit toujours de `maintenant()`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const dossier = path.join(import.meta.dirname, '../../serveur/console');

describe('la console n\'a qu\'une horloge', () => {
  it('aucun jour de la console ne se lit du vrai calendrier : toujours de l\'heure du contexte', () => {
    const fautifs: string[] = [];
    for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith('.ts'))) {
      const code = sansCommentaires(fs.readFileSync(path.join(dossier, f), 'utf8'));
      for (const [i, l] of code.split('\n').entries()) if (/aujourdhuiATunis\(\s*\)/.test(l)) fautifs.push(`${f}:${i + 1}`);
    }
    expect(fautifs).toEqual([]);
    // Le fichier des routes lit bien son jour de l'horloge du contexte.
    expect(sansCommentaires(fs.readFileSync(path.join(dossier, 'routes.ts'), 'utf8'))).toMatch(/aujourdhuiATunis\(maintenant\(\)\)/);
  });
});
