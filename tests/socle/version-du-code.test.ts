// La version du code (serveur/ecrans.ts, `versionDuCode`) : le jour de l'envoi, l'année d'abord, et le début de son
// empreinte, lus dans le dépôt ; sans dépôt lisible, « dev ». Sur un dépôt fait ici : les preuves tournent dans une copie
// sans git.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { versionDuCode } from '../../serveur/ecrans.ts';

describe('la version du code', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  afterAll(() => fs.rmSync(dossier, { recursive: true, force: true }));

  it('le jour de l\'envoi (l\'année d\'abord) et le début de son empreinte ; « dev » sans dépôt', () => {
    expect(versionDuCode(dossier)).toBe('dev');
    const git = (...a: string[]) => execFileSync('git', ['-C', dossier, '-c', 'user.name=Essai', '-c', 'user.email=essai@exemple.tn', ...a],
      { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-05T09:30:00+01:00', GIT_COMMITTER_DATE: '2026-10-05T09:30:00+01:00' } }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(dossier, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'Un envoi');
    const court = git('rev-parse', '--short', 'HEAD');
    expect(versionDuCode(dossier)).toBe(`2026.10.05 · ${court}`);
  });
});
