// Les formats officiels (serveur/console/formats.ts, docs/console.md C28) : le registre que le code déclare, et ce que
// la plateforme en a fait, lu prudemment dans la base (0094). Pur : sans base ni serveur.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORMATS, lireFormats, registreDesFormats } from '../../serveur/console/formats.ts';
import { versionTeif } from '../../serveur/v10/teif.ts';
import { texteConnu } from '../../textes/index.ts';
import '../../web/console/src/textes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LU = lireFormats({
  soumises: 3,
  fichiers: { n: 12, entreprises: 2, dernier: '2026-10-12T09:30:00+01:00' },
  versions: [{ version: '1.8.8', n: 9 }, { version: '1.8.7', n: 3 }],
  aSigner: 2,
  signees: { n: 10, dernier: '2026-10-12T10:00:00+01:00' },
  ttn: { sansEnvoi: 1, enRoute: 2, retenues: 1, deposees: 0, acceptees: 6, refusees: 0, derniereAcceptee: '2026-10-12T11:00:00+01:00' },
});

describe('les formats officiels', () => {
  it('ce que la base rend se lit prudemment : un compte illisible vaut 0, une date illisible rien, une version vide se tait', () => {
    expect(lireFormats(null)).toEqual({
      soumises: 0, fichiers: { n: 0, entreprises: 0, dernier: null }, versions: [], aSigner: 0, signees: { n: 0, dernier: null },
      ttn: { sansEnvoi: 0, enRoute: 0, retenues: 0, deposees: 0, acceptees: 0, refusees: 0, derniereAcceptee: null },
    });
    // Le pilote PostgreSQL rend un compte en texte (bigint) : il se lit ; un négatif, une fraction, un mot, non.
    const l = lireFormats({ soumises: '7', aSigner: -2, fichiers: { n: 1.5, entreprises: 'deux', dernier: 'hier' },
      versions: [{ version: '', n: 3 }, { version: '1.8.8', n: 0 }, { version: '1.8.8', n: '4' }, 'pas un objet'], ttn: [] });
    expect(l).toMatchObject({ soumises: 7, aSigner: 0, fichiers: { n: 0, entreprises: 0, dernier: null }, versions: [{ version: '1.8.8', n: 4 }] });
    expect(l.ttn.acceptees).toBe(0);
  });

  it('le registre suit l\'ordre d\'une facture (le fichier, sa signature, son envoi), puis les autres déclarations', () => {
    expect(FORMATS.map((f) => f.code)).toEqual(['teif', 'signature', 'ttn', 'tej', 'cnss', 'liasse', 'ecritures', 'caisse']);
    const r = registreDesFormats(LU, { teif: '1.8.8' }, { ttn: false, digigo: false });
    expect(r.map((f) => f.code)).toEqual(FORMATS.map((f) => f.code));
    // Ce qui reste À VÉRIFIER se dit sur chaque format, sauf l'export des écritures (le cabinet le relit sur sa balance).
    expect(r.filter((f) => !f.aVerifier).map((f) => f.code)).toEqual(['ecritures']);
  });

  it('le fichier TEIF : sa version vient du code qui l\'écrit, et les fichiers d\'une autre version se comptent à part', () => {
    expect(versionTeif()).toMatch(/^\d+\.\d+\.\d+$/);
    const [teif] = registreDesFormats(LU, { teif: versionTeif() }, { ttn: true, digigo: true });
    expect(teif).toMatchObject({ code: 'teif', version: versionTeif(), branche: null, alerte: false });
    expect(teif?.chiffres).toEqual({ fichiers: 12, entreprises: 2, soumises: 3, dernier: '2026-10-12T09:30:00+01:00', autres: versionTeif() === '1.8.8' ? 3 : 12 });
    // Sous une autre version du code (un format changé), tous les fichiers écrits avant sont « d'une autre version ».
    expect(registreDesFormats(LU, { teif: '1.9.0' }, { ttn: true, digigo: true })[0]?.chiffres?.autres).toBe(12);
  });

  it('la signature et l\'envoi disent si ce serveur a l\'adresse du service ; une pièce retenue ou refusée demande un geste', () => {
    const sans = registreDesFormats(LU, { teif: '1.8.8' }, { ttn: false, digigo: false });
    const avec = registreDesFormats(LU, { teif: '1.8.8' }, { ttn: true, digigo: true });
    const de = (r: typeof sans, code: string) => r.find((f) => f.code === code);
    expect(de(sans, 'signature')).toMatchObject({ version: 'XAdES', branche: false, chiffres: { signees: 10, aSigner: 2, dernier: '2026-10-12T10:00:00+01:00' } });
    expect(de(avec, 'signature')?.branche).toBe(true);
    expect(de(sans, 'ttn')).toMatchObject({ version: 'EfactService', branche: false, alerte: true, chiffres: { retenues: 1, acceptees: 6, enRoute: 2, sansEnvoi: 1 } });
    expect(de(avec, 'ttn')?.branche).toBe(true);
    // Rien de retenu ni de refusé : pas d'alerte ; une seule refusée suffit.
    const calme = { ...LU, ttn: { ...LU.ttn, retenues: 0 } };
    expect(de(registreDesFormats(calme, { teif: '1.8.8' }, { ttn: true, digigo: true }), 'ttn')?.alerte).toBe(false);
    expect(de(registreDesFormats({ ...calme, ttn: { ...calme.ttn, refusees: 1 } }, { teif: '1.8.8' }, { ttn: true, digigo: true }), 'ttn')?.alerte).toBe(true);
    // Aucun autre format ne crie : il n'a pas de pièce à envoyer.
    expect(sans.filter((f) => f.alerte).map((f) => f.code)).toEqual(['ttn']);
  });

  it('les formats sans fichier écrit par la plateforme n\'inventent aucun chiffre', () => {
    const r = registreDesFormats(LU, { teif: '1.8.8' }, { ttn: true, digigo: true });
    for (const code of ['tej', 'cnss', 'liasse', 'ecritures', 'caisse']) expect(r.find((f) => f.code === code)?.chiffres).toBeNull();
    expect(r.find((f) => f.code === 'tej')?.version).toBe('TEJ-CCT-RS-V2.0');
    expect(r.find((f) => f.code === 'cnss')?.version).toBeNull();
  });

  it('chaque format nomme un document qui existe, et a ses phrases à l\'écran (la clé que Reglages.tsx lit)', () => {
    for (const f of FORMATS) expect(fs.existsSync(path.join(RACINE, f.doc)), f.doc).toBe(true);
    const ecran = fs.readFileSync(path.join(RACINE, 'web/console/src/ecrans/Reglages.tsx'), 'utf8');
    for (const morceau of ['nom', 'pour', 'fait', 'contre']) expect(ecran).toContain(`\${K}.f.\${f.code}.${morceau}`);
    const cles = FORMATS.flatMap((f) => ['nom', 'pour', 'fait', 'contre', ...(f.aVerifier ? ['verifier'] : [])].map((m) => `console.ecran.reglages.f.${f.code}.${m}`));
    expect(cles.filter((k) => !texteConnu(k))).toEqual([]);
    const etats = [...new Set(FORMATS.map((f) => f.etat))].map((e) => `console.ecran.reglages.f.etat.${e}`);
    expect(etats.filter((k) => !texteConnu(k))).toEqual([]);
  });
});
