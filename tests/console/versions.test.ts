// Les versions du service, rangées sans la base (serveur/console/versions.ts ; docs/console.md C27), et la règle des
// consignes du suiveur (exploitation/suivre.ts).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  historique, lireEtatSuiveur, lireVersionsDeLaBase, migrationsDe, prochaine, systemeDe, taches, titreDeTache, versionDAvant,
} from '../../serveur/console/versions.ts';
import { consignesDuTour, lireConsignes, lireLeJournalGit, noterInstallation, NUMERO, NUMEROS_GARDES, numeroDuPaquet, numerosAJour, planDuTour, SANS_CONSIGNE, INSTALLATIONS_GARDEES } from '../../exploitation/suivre.ts';
import { nomDeVersion } from '../../web/console/src/version.ts';

const sha = (c: string) => c.repeat(40).slice(0, 40);
const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'].map(sha) as [string, string, string, string, string];
const maintenant = new Date('2026-10-13T12:00:00Z');

describe('le suiveur et ses consignes', () => {
  // Le dépôt, du plus récent au plus ancien : E D C B A ; C est en service.
  const versions = [E, D, C, B, A];
  it('sans consigne : les plus récentes que celle en service, moins celle qui a échoué', () => {
    expect(planDuTour(versions, C, D, SANS_CONSIGNE, maintenant)).toEqual({ sorte: 'suivre', candidates: [E] });
    expect(planDuTour(versions, null, null, SANS_CONSIGNE, maintenant)).toEqual({ sorte: 'suivre', candidates: versions });
  });
  it('une version retenue ne s\'installe plus, ni aucune d\'avant elle : on attend la suivante', () => {
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, retenues: [D] }, maintenant)).toEqual({ sorte: 'suivre', candidates: [E] });
    expect(planDuTour(versions, B, null, { ...SANS_CONSIGNE, retenues: [E] }, maintenant)).toEqual({ sorte: 'suivre', candidates: [] });
    // Une retenue sortie des trente dernières ne compte plus (elle est plus vieille que tout ce qu'on peut installer).
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, retenues: [sha('f')] }, maintenant)).toEqual({ sorte: 'suivre', candidates: [E, D] });
  });
  it('un gel n\'installe rien jusqu\'à sa fin ; fini, il ne compte plus', () => {
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, gel: { jusquAu: '2026-10-13T13:00:00Z', motif: 'x' } }, maintenant)).toEqual({ sorte: 'gel' });
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, gel: { jusquAu: '2026-10-13T11:59:00Z', motif: 'x' } }, maintenant)).toEqual({ sorte: 'suivre', candidates: [E, D] });
  });
  it('un retour passe avant tout, gel compris ; une version inconnue, déjà en service ou sans le suiveur se dit sans rien installer', () => {
    const gel = { jusquAu: '2026-10-14T00:00:00Z', motif: 'x' };
    expect(planDuTour(versions, C, null, { gel, retenues: [C], retour: { id: 'r', version: B } }, maintenant)).toEqual({ sorte: 'retour', version: B });
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, retour: { id: 'r', version: sha('f') } }, maintenant)).toEqual({ sorte: 'retour_impossible', raison: 'inconnue' });
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, retour: { id: 'r', version: C } }, maintenant)).toEqual({ sorte: 'retour_impossible', raison: 'deja' });
    expect(planDuTour(versions, C, null, { ...SANS_CONSIGNE, retour: { id: 'r', version: A } }, maintenant, (v) => v !== A)).toEqual({ sorte: 'retour_impossible', raison: 'sans_suiveur' });
  });
  it('l\'audit C04 : des consignes illisibles n\'installent rien tant qu\'une version tourne ; absentes (une base d\'avant elles) ou un serveur neuf, le tour suit', () => {
    const gel = { ...SANS_CONSIGNE, gel: { jusquAu: '2026-10-14T00:00:00Z', motif: 'incident' } };
    expect(consignesDuTour({ sorte: 'lues', consignes: gel }, C)).toEqual(gel);
    expect(consignesDuTour({ sorte: 'illisibles' }, C)).toBeNull();
    expect(consignesDuTour({ sorte: 'absentes' }, C)).toEqual(SANS_CONSIGNE);
    expect(consignesDuTour({ sorte: 'illisibles' }, null)).toEqual(SANS_CONSIGNE);
  });
  it('les consignes lues prudemment : une version qui n\'en est pas une ne compte pas', () => {
    expect(lireConsignes({ gel: { jusquAu: 'bientôt' }, retenues: [A, 'abc', 3], retour: { id: 'r', version: 'nope' } })).toEqual({ gel: null, retenues: [A], retour: null });
    expect(lireConsignes(null)).toEqual(SANS_CONSIGNE);
  });
  it('le journal du dépôt : la version, son titre, sa date ; une ligne d\'une autre forme ne compte pas', () => {
    const t = `${A}\x1fUn titre ; avec des signes\x1f2026-10-12T07:10:00+01:00\n${B}\x1fsans date\x1f\nn'importe quoi\n${C}\x1fdeux\x1fseparateurs\x1fde trop\x1f2026-10-01T00:00:00Z`;
    expect(lireLeJournalGit(t)).toEqual([{ version: A, titre: 'Un titre ; avec des signes', le: '2026-10-12T07:10:00+01:00' }]);
  });
  it('l\'historique garde les quarante dernières installations, la plus récente d\'abord', () => {
    let l = noterInstallation(undefined, { version: A, debut: 'x', fin: 'y', ok: true, etape: null, retour: false });
    for (let i = 0; i < 50; i++) l = noterInstallation(l, { version: B, debut: String(i), fin: 'y', ok: true, etape: null, retour: false });
    expect(l).toHaveLength(INSTALLATIONS_GARDEES);
    expect(l[0]?.debut).toBe('49');
  });
});

describe('les versions, rangées pour l\'écran', () => {
  const etat = lireEtatSuiveur({
    version: C, installeeLe: '2026-10-12T07:13:00Z', regardeLe: '2026-10-13T11:58:00Z', derniere: E, verification: 'toutes',
    echec: { version: D, etape: 'démarrage', message: '\nle serveur ne répond pas\n/opt/skanfact/chemin', le: '2026-10-13T02:00:00Z' },
    commits: [
      { version: E, titre: 'La suivante', le: '2026-10-13T09:00:00Z', verification: 'vert', preuves: 'en_cours' },
      { version: D, titre: 'Celle qui a échoué', le: '2026-10-12T22:00:00Z', verification: 'vert', preuves: 'vert' },
      { version: C, titre: 'En service', le: '2026-10-12T06:00:00Z' },
      { version: B, titre: 'D\'avant', le: '2026-10-08T14:00:00Z' },
    ],
    installations: [
      { version: D, debut: '2026-10-13T02:00:00Z', fin: '2026-10-13T02:03:00Z', ok: false, etape: 'démarrage', retour: false },
      { version: C, debut: '2026-10-12T07:10:00Z', fin: '2026-10-12T07:13:12Z', ok: true, etape: null, retour: false },
      { version: B, debut: '2026-10-08T15:00:00Z', fin: '2026-10-08T15:03:40Z', ok: true, etape: null, retour: false },
      { version: 'pas une version', debut: 'x', fin: 'y', ok: true },
    ],
    taches: [{ nom: '0001-sauvegardes.sh', ok: true, le: '2026-09-14T00:00:00Z', sortie: 'tout va bien' }, { nom: '0002-outils.sh', ok: false, le: '2026-09-14T00:00:00Z', sortie: 'a\nb\nla cause\n' }],
    consignes: { lues: '2026-10-13T11:58:00Z', gel: null, retenues: [], retour: null }, plan: 'suivre',
  });
  const base = lireVersionsDeLaBase({
    migrations: [{ numero: 82, nom: 'abonnement', le: '2026-10-12T07:11:00Z' }, { numero: 81, nom: 'sms', le: '2026-10-08T15:01:00Z' }, { numero: 80, nom: 'x', le: '2026-10-08T15:01:30Z' }],
    versions: [
      { version: A, debut: '2026-09-01T00:00:00Z', fin: '2026-09-28T00:00:00Z', sansReponse: 0 },
      { version: sha('9'), debut: '2026-09-28T14:05:00Z', fin: '2026-10-08T15:02:00Z', sansReponse: 3 },
      { version: B, debut: '2026-10-08T15:03:00Z', fin: '2026-10-12T07:12:00Z', sansReponse: 1 },
      { version: C, debut: '2026-10-12T07:13:00Z', fin: '2026-10-13T11:59:00Z', sansReponse: 0 },
    ],
    consignes: [], postgres: '16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)',
  });

  it('l\'état du suiveur relu prudemment : le message d\'un échec, sa première ligne seule ; la sortie d\'une tâche réussie, rien', () => {
    expect(etat.echec?.message).toBe('le serveur ne répond pas');
    expect(etat.installations).toHaveLength(3);
    expect(etat.taches).toEqual([{ nom: '0001-sauvegardes.sh', ok: true, le: '2026-09-14T00:00:00Z', sortie: null }, { nom: '0002-outils.sh', ok: false, le: '2026-09-14T00:00:00Z', sortie: 'la cause' }]);
    // Seules les versions plus récentes que celle en service portent leurs verdicts.
    expect(etat.commits.map((c) => c.plusRecente)).toEqual([true, true, false, false]);
    expect(lireEtatSuiveur('n\'importe quoi')).toMatchObject({ version: null, commits: [], installations: [], consignes: null });
  });

  it('l\'historique : les installations du suiveur, leurs migrations, leur arrivée vue par la veille ; puis ce que la veille seule a vu', () => {
    const h = historique(etat, base);
    expect(h.map((l) => [l.version.slice(0, 1), l.statut, l.remplaceePar?.slice(0, 1) ?? null, l.source])).toEqual([
      ['d', 'echouee', null, 'suiveur'], ['c', 'en_service', null, 'suiveur'], ['b', 'remplacee', 'c', 'suiveur'], ['9', 'remplacee', 'b', 'veille'],
    ]);
    expect(h[1]).toMatchObject({ dureeS: 192, migrations: [82], sansReponse: 0 });
    expect(h[2]).toMatchObject({ migrations: [80, 81], sansReponse: 1 });
    // La plus ancienne suite de la veille tournait déjà au premier relevé : pas une installation.
    expect(h.some((l) => l.version === A)).toBe(false);
    expect(migrationsDe({ debut: '2026-10-12T07:10:00Z', fin: '2026-10-12T07:13:12Z' }, base.migrations)).toEqual([82]);
  });

  it('la version d\'avant, et si on peut y revenir (parmi les trente dernières du dépôt)', () => {
    const h = historique(etat, base);
    expect(versionDAvant(h, etat)).toEqual({ version: B, le: '2026-10-08T15:03:40Z', possible: true });
    expect(versionDAvant(h, { ...etat, commits: etat.commits.filter((c) => c.version !== B) })?.possible).toBe(false);
  });

  it('la prochaine : la plus récente, et où elle en est — retenue, gelée, en attente des preuves, prête', () => {
    expect(prochaine(etat, [], maintenant)).toMatchObject({ version: E, etat: 'attend_preuves', nombre: 2 });
    const prete = { ...etat, commits: etat.commits.map((c) => (c.version === E ? { ...c, preuves: 'vert' as const } : c)) };
    expect(prochaine(prete, [], maintenant)?.etat).toBe('prete');
    const consigne = (x: { sorte: 'gel' | 'retenue' | 'retour' } & Record<string, unknown>) => ({ id: 'x', version: null, quitte: null, jusquAu: null, motif: 'm', par: 'p', le: '2026-10-13T00:00:00Z', enVigueur: true,
      faiteLe: null, faiteOk: null, faiteRaison: null, leveeLe: null, leveePar: null, leveeMotif: null, ...x }) as Parameters<typeof prochaine>[1][number];
    expect(prochaine(prete, [consigne({ sorte: 'gel', jusquAu: '2026-10-14T00:00:00Z' })], maintenant)?.etat).toBe('gelee');
    expect(prochaine(prete, [consigne({ sorte: 'retenue', version: E })], maintenant)?.etat).toBe('retenue');
    // Une retenue levée ne compte plus.
    expect(prochaine(prete, [consigne({ sorte: 'retenue', version: E, enVigueur: false })], maintenant)?.etat).toBe('prete');
    const rouge = { ...etat, commits: etat.commits.map((c) => (c.version === E ? { ...c, verification: 'rouge' as const } : c)) };
    expect(prochaine(rouge, [], maintenant)?.etat).toBe('rouge');
    // Le dernier tour n'a pas pu lire les consignes (l'audit C04) : prête, elle attend qu'il les relise.
    expect(prochaine({ ...prete, consignesIllisibles: '2026-10-13T11:55:00Z' }, [], maintenant)?.etat).toBe('bloquee');
    expect(prochaine({ ...etat, commits: etat.commits.filter((c) => !c.plusRecente) }, [], maintenant)).toBeNull();
  });

  it('les tâches d\'entretien : celles du dépôt, leur titre tiré de l\'en-tête, et ce que le suiveur en a noté', () => {
    const t = taches([{ nom: '0002-outils.sh', titre: 'les outils' }, { nom: '0001-sauvegardes.sh', titre: 'la sauvegarde' }, { nom: '0003-neuve.sh', titre: null }], etat);
    expect(t.map((x) => [x.numero, x.etat, x.sortie])).toEqual([['0001', 'passee', null], ['0002', 'echouee', 'la cause'], ['0003', 'pas_encore', null]]);
    // Les vraies tâches du dépôt ont toutes un titre lisible.
    const dossier = path.join(import.meta.dirname, '../../exploitation/taches');
    for (const f of fs.readdirSync(dossier).filter((n) => n.endsWith('.sh'))) {
      const titre = titreDeTache(fs.readFileSync(path.join(dossier, f), 'utf8'));
      expect(titre, f).toBeTruthy();
      expect((titre ?? '').length, f).toBeLessThanOrEqual(121);
      expect(titre, f).not.toMatch(/\/|\.ts\b|\.md\b|\.json\b/);
    }
    expect(titreDeTache('#!/bin/bash\n# Tâche d\'entretien 0001 (brique 144 ; docs) : la sauvegarde de chaque nuit ; puis une autre chose.\nset -e')).toBe('la sauvegarde de chaque nuit');
    expect(titreDeTache('#!/bin/bash\necho rien')).toBeNull();
    // Un renvoi à un fichier n'est pas pour l'écran ; un titre trop long se coupe à un mot entier, et le dit.
    expect(titreDeTache("# Tâche d'entretien 0007 (x) : la veille du serveur (docs/mise-en-ligne.md, I). Le veilleur.")).toBe('la veille du serveur');
    const long = titreDeTache(`# Tâche d'entretien 0003 (x) : ${'un mot '.repeat(40)}fin`) ?? '';
    expect(long.endsWith('mot…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(121);
  });

  it('le système, lu dans /etc/os-release ; PostgreSQL, son numéro seul', () => {
    expect(base.postgres).toBe('16.10');
    expect(systemeDe('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n')).toBe('Ubuntu 24.04.1 LTS');
    expect(systemeDe(null)).toBeNull();
  });
});

describe('le numéro de version (« v1.4.2 »)', () => {
  it('le dépôt déclare un numéro que le suiveur sait lire', () => {
    const paquet = fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8');
    expect(numeroDuPaquet(paquet)).toMatch(NUMERO);
  });
  it('le suiveur lit le numéro d\'un package.json ; ce qui n\'en est pas un vaut null', () => {
    expect(numeroDuPaquet('{"version":"1.4.2"}')).toBe('1.4.2');
    expect(numeroDuPaquet('{"version":"2.0.0-rc.1"}')).toBe('2.0.0-rc.1');
    expect(numeroDuPaquet('{"name":"x"}')).toBeNull();
    expect(numeroDuPaquet('{"version":"1.4"}')).toBeNull();
    expect(numeroDuPaquet('{"version":"<b>1.4.2</b>"}')).toBeNull();
    expect(numeroDuPaquet('pas du json')).toBeNull();
    expect(numeroDuPaquet(null)).toBeNull();
  });
  it('un commit déjà lu ne se relit pas (même sans numéro) ; seul un commit neuf se lit, une fois', () => {
    const lus: string[] = [];
    const lire = (v: string) => { lus.push(v); return v === E ? '1.1.0' : null; };
    const r = numerosAJour({ [C]: '1.0.0', [B]: null }, [E, C, C, B, null, 'pas-un-sha'], lire);
    expect(r).toEqual({ [E]: '1.1.0', [C]: '1.0.0', [B]: null });
    expect(lus).toEqual([E]);
    // Une lecture ratée (git n'a pas répondu) ne se garde pas : elle se refera au tour suivant.
    expect(numerosAJour({}, [D, E], (v) => (v === D ? undefined : '1.2.0'))).toEqual({ [E]: '1.2.0' });
    // Au plus NUMEROS_GARDES versions.
    const beaucoup = Array.from({ length: NUMEROS_GARDES + 5 }, (_, i) => i.toString(16).padStart(40, '0'));
    expect(Object.keys(numerosAJour(undefined, beaucoup, () => null))).toHaveLength(NUMEROS_GARDES);
  });
  it('la console relit les numéros prudemment, et nomme une version par son numéro, sinon son identifiant court', () => {
    const e = lireEtatSuiveur({ numeros: { [C]: '1.0.0', [D]: '1.1.0', [B]: null, [A]: 'v1', court: '1.0.0' } });
    expect(e.numeros).toEqual({ [C]: '1.0.0', [D]: '1.1.0' });
    expect(nomDeVersion(C, e.numeros)).toBe('v1.0.0');
    expect(nomDeVersion(B, e.numeros)).toBe(B.slice(0, 7));
    expect(nomDeVersion(C, undefined)).toBe(C.slice(0, 7));
    // Deux commits sous le même numéro (un envoi qui ne l'a pas relevé) : l'identifiant les distingue.
    expect(nomDeVersion(C, { [C]: '1.0.0', [D]: '1.0.0' })).toBe(`v1.0.0 · ${C.slice(0, 7)}`);
  });
});
