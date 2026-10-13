// La sécurité du service, rangée sans la base (serveur/console/securite.ts ; docs/console.md C26).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTENTES_MIN, ERREURS_AVANT_ATTENTE, joursDuCertificat, lireClesDeCommande, lireSecurite, rangerARegarder, SMS_PAR_HEURE, SMS_PAR_JOUR, type ARegarder,
} from '../../serveur/console/securite.ts';

const migration = (n: string) => fs.readFileSync(path.join(import.meta.dirname, '../../base/migrations', fs.readdirSync(path.join(import.meta.dirname, '../../base/migrations')).find((f) => f.startsWith(n)) ?? ''), 'utf8');

describe('les règles dites sont celles de la base', () => {
  it('l\'attente après des mots de passe faux : la cinquième erreur, puis 1, 5, 15, 60 minutes — comme socle.noter_erreur', () => {
    const corps = /create function socle\.noter_erreur[\s\S]*?end \$\$;/.exec(migration('0002'))?.[0] ?? '';
    expect(corps).toContain(`if v_erreurs >= ${ERREURS_AVANT_ATTENTE} then`);
    const minutes = [...corps.matchAll(/interval '(\d+) minutes?'/g)].map((m) => Number(m[1]));
    expect(minutes).toEqual([...ATTENTES_MIN]);
  });
  it('les codes par SMS : par heure et par jour, comme socle.sms_permis', () => {
    const corps = /create function socle\.sms_permis[\s\S]*?\$\$;/.exec(migration('0081'))?.[0] ?? '';
    expect(corps).toMatch(new RegExp(`interval '1 hour'\\) < ${SMS_PAR_HEURE}`));
    expect(corps).toMatch(new RegExp(`interval '1 day'\\) < ${SMS_PAR_JOUR}`));
  });
});

describe('la sécurité, relue prudemment', () => {
  it('une ligne mal formée ne compte pas ; ce qui manque vaut zéro, jamais une invention', () => {
    const l = lireSecurite({
      heures: [{ heure: '2026-10-13T08:00:00Z', reussies: 3, codesFaux: 1 }, { heure: 'jamais', reussies: 9 }],
      motsDePasseFaux: 4, freines: -1,
      aRegarder: [{ sorte: 'code', id: 'a', le: '2026-10-13T08:00:00Z', erreurs: 4, qui: 'Hédi', adresse: 'h@x.tn', resolu: false, appareil: { type: 'telephone', nouveau: true } },
        { sorte: 'autre', id: 'b', le: '2026-10-13T08:00:00Z' }],
      equipe: [{ id: 'u', nom: 'Amira', role: 'direction', methode: 'courriel', appareils: [{ nom: 'Mac', type: 'bureau' }, { nom: 1 }], sessions: 2, secours: 9 }],
    });
    expect(l.heures).toEqual([{ heure: '2026-10-13T08:00:00Z', reussies: 3, codesFaux: 1 }]);
    expect(l.freines).toBe(0);
    expect(l.aRegarder).toHaveLength(1);
    expect(l.aRegarder[0]?.appareil).toEqual({ type: 'telephone', nouveau: true });
    // Une méthode de code inconnue n'est pas une méthode.
    expect(l.equipe[0]).toMatchObject({ methode: null, appareils: [{ nom: 'Mac', type: 'bureau' }], derniere: null, codesFaux: 0 });
    expect(lireSecurite(undefined)).toEqual({ heures: [], motsDePasseFaux: 0, freines: 0, aRegarder: [], equipe: [] });
  });

  it('ce qui demande un regard : un mot de passe connu d\'abord, l\'équipe devant à urgence égale, un compte freiné en dernier', () => {
    const r = (x: Partial<ARegarder>): ARegarder => ({ sorte: 'code', id: 'x', le: '2026-10-13T08:00:00Z', erreurs: 3, qui: null, adresse: null, role: null,
      resolu: false, console: false, jusquAu: null, connu: null, appareil: null, ...x });
    const rangee = rangerARegarder([
      r({ id: 'freine', sorte: 'attente', le: '2026-10-13T11:00:00Z' }),
      r({ id: 'resolu', resolu: true, le: '2026-10-13T10:00:00Z' }),
      r({ id: 'client', le: '2026-10-13T09:00:00Z' }),
      r({ id: 'equipe', role: 'support', le: '2026-10-13T07:00:00Z' }),
      r({ id: 'client-recent', le: '2026-10-13T09:30:00Z' }),
    ]);
    expect(rangee.map((x) => x.id)).toEqual(['equipe', 'client-recent', 'client', 'resolu', 'freine']);
  });

  it('les clés qui commandent le serveur : leur nom et si elles sont retirées, jamais la clé', () => {
    const cles = lireClesDeCommande([
      { id: 'walid-portable', publique: '-----BEGIN PUBLIC KEY-----x', retiree: true },
      { id: 'skander-mac', publique: '-----BEGIN PUBLIC KEY-----y' },
      { id: 'pas un nom!', publique: 'z' }, 'rien',
    ]);
    expect(cles).toEqual([{ id: 'skander-mac', retiree: false }, { id: 'walid-portable', retiree: true }]);
    expect(JSON.stringify(cles)).not.toContain('PUBLIC KEY');
    // Le fichier du dépôt se lit tel quel.
    expect(lireClesDeCommande(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../exploitation/acces-cles.json'), 'utf8'))).length).toBeGreaterThan(0);
  });

  it('le certificat : les jours qui restent ; rien de lu, rien d\'inventé', () => {
    expect(joursDuCertificat('2026-12-13', '2026-10-13')).toBe(61);
    expect(joursDuCertificat('2026-10-12', '2026-10-13')).toBe(-1);
    expect(joursDuCertificat(null, '2026-10-13')).toBeNull();
    expect(joursDuCertificat('bientôt', '2026-10-13')).toBeNull();
  });
});
