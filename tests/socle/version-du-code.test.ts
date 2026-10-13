// La version du code (serveur/ecrans.ts, `versionDuCode`) : le numéro que l'envoi déclare (« version » de son
// package.json) et le début de son empreinte, lus dans le dépôt ; un envoi sans numéro lisible, « dev » devant son
// empreinte ; sans dépôt lisible, « dev ». Sur un dépôt fait ici : les preuves tournent dans une copie sans git.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { versionDuCode } from '../../serveur/ecrans.ts';

describe('la version du code', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  afterAll(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync('git', ['-C', dossier, '-c', 'user.name=Essai', '-c', 'user.email=essai@exemple.tn', ...a],
    { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-05T09:30:00+01:00', GIT_COMMITTER_DATE: '2026-10-05T09:30:00+01:00' } }).trim();
  const envoyer = (fichier: string, contenu: string) => {
    fs.writeFileSync(path.join(dossier, fichier), contenu);
    git('add', fichier);
    git('commit', '-q', '-m', `Un envoi : ${fichier}`);
    return git('rev-parse', '--short', 'HEAD');
  };

  it('le numéro que l\'envoi déclare et le début de son empreinte ; « dev » sans numéro lisible, ou sans dépôt', () => {
    expect(versionDuCode(dossier)).toBe('dev');
    git('init', '-q');
    // Un envoi sans package.json : pas de numéro.
    expect(versionDuCode(dossier)).toBe('dev');
    let court = envoyer('a.txt', 'a');
    expect(versionDuCode(dossier)).toBe(`dev · ${court}`);
    court = envoyer('package.json', JSON.stringify({ name: 'essai', version: '1.4.2' }));
    expect(versionDuCode(dossier)).toBe(`1.4.2 · ${court}`);
    // Lu depuis un sous-dossier du dépôt (le serveur est dans serveur/) : c'est le package.json de la racine.
    fs.mkdirSync(path.join(dossier, 'serveur'));
    expect(versionDuCode(path.join(dossier, 'serveur'))).toBe(`1.4.2 · ${court}`);
    // Le numéro est celui de l'ENVOI, pas celui d'un fichier retouché depuis.
    fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ name: 'essai', version: '9.9.9' }));
    expect(versionDuCode(dossier)).toBe(`1.4.2 · ${court}`);
    // Ce qui n'est pas un numéro ne se dit pas comme un numéro.
    court = envoyer('package.json', JSON.stringify({ name: 'essai', version: 'un-jour' }));
    expect(versionDuCode(dossier)).toBe(`dev · ${court}`);
  });
});
