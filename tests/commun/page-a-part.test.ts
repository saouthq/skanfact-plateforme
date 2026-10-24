// Les pages à part (1.108.0 ; commun/page-a-part.ts) : un seul habit, des fichiers écrits à jour, rien de ce que l'équipe
// écrit qui passe sans être échappé, et les polices lues là où la page est servie.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageRedemarrage, sansJavascript } from '../../commun/page-a-part.ts';
import { pageFermee } from '../../serveur/fermeture.ts';
import { pageEtat, type Releve } from '../../exploitation/veille.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8');

describe('les pages à part', () => {
  it('les fichiers écrits par scripts/pages-a-part.ts sont à jour : la page du frontal, le mot « sans JavaScript » de l\'application et de la console', () => {
    expect(lire('exploitation/maintenance.html')).toBe(pageRedemarrage());
    for (const f of ['web/index.html', 'web/console/index.html']) expect(lire(f), f).toContain(sansJavascript());
  });

  it('la fermeture : l\'heure du retour, le texte de l\'équipe échappé, aucun script, les polices des écrans, rechargée chaque minute', () => {
    const t = new Date('2026-10-22T08:54:00Z');
    const html = pageFermee({ texte: 'Le disque <b>change</b> & "vite"', fin: '2026-10-22T09:00:00Z' }, t);
    expect(html).toContain('<h1>SkanFact revient vers <span data-chiffres>10 h 00</span>.</h1>');
    expect(html).toContain('<blockquote class="pa-message" data-texte>Le disque &#60;b&#62;change&#60;/b&#62; &#38; &#34;vite&#34;</blockquote>');
    expect(html).not.toContain('<b>change</b>');
    expect(html).not.toMatch(/<script/);
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
    expect(html).toContain('src:url(/plateforme/polices/bricolage-grotesque-latin-wght-normal.woff2)');
    expect(html).toContain('Affichée à <span data-chiffres>09:54</span>');
    // Un autre jour : la date avec l'heure.
    expect(pageFermee({ texte: 'Long.', fin: '2026-10-23T09:00:00Z' }, t)).toContain('<span data-chiffres>23/10/2026 à 10 h 00</span>');
  });

  it('le redémarrage (le frontal) : un nouvel essai compté, la page d\'état, les polices du frontal', () => {
    const html = pageRedemarrage();
    expect(html).toContain('<meta http-equiv="refresh" content="15">');
    expect(html).toContain('id="pa-compte">15</b>');
    expect(html).toMatch(/<script>var n=15,[^<]*location\.reload\(\)/);
    expect(html).toContain('href="/etat"');
    expect(html).toContain('src:url(/etat-polices/instrument-sans-latin-wght-normal.woff2)');
    expect(html).not.toContain('/plateforme/polices/');
  });

  it('la page d\'état : l\'état d\'un mot dans la vitrine, les polices du frontal (le frontal la sert seul)', () => {
    const r = { maintenant: new Date('2026-10-22T08:54:00Z'), serviceRepond: true, etat: null, disques: [], certificat: null } as unknown as Releve;
    const html = pageEtat('app.skanfact.tn', r, { problemes: {} });
    expect(html).toContain('<h1><span class="point vert"></span> Tout fonctionne</h1>');
    expect(html).toContain('src:url(/etat-polices/bricolage-grotesque-latin-wght-normal.woff2)');
    expect(html).not.toContain('/plateforme/polices/');
  });
});
