// Les sauvegardes du service, rangées pour la console (serveur/console/sauvegardes.ts ; docs/console.md C14).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CALENDRIER, commandesRemise, copies, entreApostrophes, GARDE, horsDeLaMachine, laSauvegarde, leDernierExercice, lireSauvegardes, minuteDeTunis,
  nuits, pointLePlusAncien, prochainExercice, promesses, retardsParHeure,
} from '../../serveur/console/sauvegardes.ts';

const MAINTENANT = new Date('2026-10-13T09:40:00Z');
const UUID = '01a133c0-b805-7a3e-a711-7b49e8e43224';
const brut = (x: Record<string, unknown> = {}) => lireSauvegardes({
  nuits: [
    { jour: '2026-10-13', sauvegarde: { le: '2026-10-13T01:19:00Z', ok: true, lignes: 1908232, migrations: 87, horsMachine: { le: '2026-10-13T01:20:00Z', ok: true } }, copieDeBase: { le: '2026-10-12T23:31:00Z', ok: true } },
    { jour: '2026-10-12', sauvegarde: { le: '2026-10-12T01:19:00Z', ok: false }, copieDeBase: { le: '2026-09-10T23:31:00Z', ok: true } },
    { jour: '2026-10-05', restauration: { le: '2026-10-05T02:30:00Z', ok: true, secondes: 1262, lignes: 1889032, migrations: 87, message: '/var/lib/x' } },
    { jour: 'hier', sauvegarde: { le: '2026-10-11T01:19:00Z', ok: true } },
  ],
  dernier: { minute: '2026-10-13T09:39:00Z', archiveLe: '2026-10-13T09:38:20Z', copies: { archivage: { enMarche: true }, horsMachine: { regle: true, attenteDepuis: '2026-10-13T08:02:00Z' } } },
  retards: [['2026-10-13T08:00:00Z', 5760, 60], ['2026-10-13T07:00:00Z', 0, 60], ['n\'importe quoi', 1, 1]],
  exemplaires: 1, remisesFaites: { n: 0, derniere: null }, remises: null,
  ...x,
});

describe('ce que la base rend, relu prudemment', () => {
  it('une nuit illisible tombe ; un exercice ne garde que des nombres ; les nuits vont de la plus récente', () => {
    const l = brut();
    expect(l.nuits.map((n) => n.jour)).toEqual(['2026-10-13', '2026-10-12', '2026-10-05']);
    expect(l.nuits[2]?.restauration).toEqual({ le: '2026-10-05T02:30:00Z', ok: true, secondes: 1262, lignes: 1889032, migrations: 87 });
    expect(l.retards).toEqual([{ heure: '2026-10-13T08:00:00Z', plusLong: 5760, lues: 60 }, { heure: '2026-10-13T07:00:00Z', plusLong: 0, lues: 60 }]);
  });
  it('les remises : null pour qui ne les lit pas (la technique), jamais une liste vide qui mentirait', () => {
    expect(brut().remises).toBeNull();
    const r = brut({ remises: [{ le: '2026-10-12T15:00:00Z', entreprise: UUID, nom: 'Atelier', motif: 'un import', minute: '2026-10-12 14:03', numerosRetires: [1, 2],
      preparee: { par: 'Amira', le: '2026-10-12T14:50:00Z' } }] }).remises;
    expect(r).toEqual([{ le: '2026-10-12T15:00:00Z', entreprise: UUID, nom: 'Atelier', motif: 'un import', minute: '2026-10-12 14:03', numerosRetires: 0, preparee: { par: 'Amira', le: '2026-10-12T14:50:00Z' } }]);
  });
});

describe('les quatre chiffres', () => {
  it('la dernière sauvegarde est celle de la dernière nuit qui en a une ; ratée, ou trop vieille, elle est grave', () => {
    expect(laSauvegarde(brut(), MAINTENANT)).toMatchObject({ etat: 'bon', ok: true, lignes: 1908232, vieille: false });
    expect(laSauvegarde(brut(), new Date('2026-10-14T05:00:00Z'))).toMatchObject({ etat: 'grave', vieille: true });
    expect(laSauvegarde(lireSauvegardes({}), MAINTENANT)).toMatchObject({ etat: 'nonmesure' });
  });
  it('hors de la machine : le retard du dernier relevé, aux seuils de la veille ; pas réglée n\'est jamais « à jour »', () => {
    expect(horsDeLaMachine(brut())).toMatchObject({ etat: 'grave', retard: 97 });
    const reglee = brut({ dernier: { minute: '2026-10-13T09:39:00Z', copies: { archivage: null, horsMachine: { regle: true, attenteDepuis: null } } } });
    expect(horsDeLaMachine(reglee)).toMatchObject({ etat: 'bon', retard: 0 });
    const non = brut({ dernier: { minute: '2026-10-13T09:39:00Z', copies: { archivage: null, horsMachine: { regle: false, attenteDepuis: null } } } });
    expect(horsDeLaMachine(non)).toMatchObject({ etat: 'attention', regle: false });
  });
  it('le prochain exercice : le 1er du mois à l\'heure du minuteur, toujours après maintenant', () => {
    expect(prochainExercice(MAINTENANT)).toBe('2026-11-01T04:00:00.000Z');
    expect(prochainExercice(new Date('2026-11-01T03:59:00Z'))).toBe('2026-11-01T04:00:00.000Z');
    expect(prochainExercice(new Date('2026-12-01T04:00:00Z'))).toBe('2027-01-01T04:00:00.000Z');
    expect(leDernierExercice(brut(), MAINTENANT)).toMatchObject({ etat: 'bon', vieux: false });
  });
});

describe('les promesses : rien n\'est vert sans une preuve faite sur ce serveur', () => {
  const etat = (l: ReturnType<typeof brut>, id: string) => promesses(l, MAINTENANT).find((p) => p.id === id)?.etat;
  it('la base : tenue avec l\'archivage en marche ET un exercice réussi sous l\'heure ; sans exercice, à prouver', () => {
    expect(etat(brut(), 'base')).toBe('tenue');
    expect(etat(brut({ nuits: [] }), 'base')).toBe('a_prouver');
    const lent = brut({ nuits: [{ jour: '2026-10-05', restauration: { le: '2026-10-05T02:30:00Z', ok: true, secondes: 3700 } }] });
    expect(etat(lent, 'base')).toBe('pas_tenue');
  });
  it('le site : jamais tenu (aucun site de secours) ; pas tenu dès que la copie a pris plus de cinq minutes dans la journée', () => {
    expect(etat(brut(), 'site')).toBe('pas_tenue');
    expect(etat(brut({ retards: [['2026-10-13T08:00:00Z', 120, 60]] }), 'site')).toBe('a_prouver');
  });
  it('le programme : un seul exemplaire ne peut pas tenir « rien de perdu » ; une entreprise : tenue après une remise faite', () => {
    expect(etat(brut(), 'programme')).toBe('pas_encore');
    expect(etat(brut({ exemplaires: 2 }), 'programme')).toBe('a_prouver');
    expect(etat(brut(), 'entreprise')).toBe('a_prouver');
    expect(etat(brut({ remisesFaites: { n: 1, derniere: '2026-10-12T15:00:00Z' } }), 'entreprise')).toBe('tenue');
    expect(etat(brut(), 'rancongiciel')).toBe('inverifiable');
  });
  it('où sont les copies : le site de secours n\'existe pas, l\'intouchable ne se voit pas d\'ici', () => {
    expect(copies(brut(), MAINTENANT).liste.map((c) => [c.id, c.etat])).toEqual([['serveur', 'en_place'], ['hors_machine', 'en_retard'], ['secours', 'pas_encore'], ['intouchable', 'inverifiable']]);
  });
});

describe('nuit par nuit, heure par heure', () => {
  it('la copie d\'une nuit dont la sauvegarde a raté n\'a rien à envoyer ; sans réglage, elle n\'est pas réglée', () => {
    expect(nuits(brut(), GARDE.nuits).map((n) => n.hors)).toEqual(['arrivee', 'sans_objet', 'pas_reglee']);
  });
  it('vingt-quatre heures, chacune avec son pire retard en minutes ; une heure sans relevé ne vaut pas zéro', () => {
    const r = retardsParHeure(brut(), MAINTENANT);
    expect(r).toHaveLength(24);
    expect(r.at(-1)).toEqual({ heure: '2026-10-13T09:00:00.000Z', plusLong: null });
    expect(r.at(-2)).toEqual({ heure: '2026-10-13T08:00:00.000Z', plusLong: 96 });
    expect(r.at(-3)).toEqual({ heure: '2026-10-13T07:00:00.000Z', plusLong: 0 });
  });
  it('le plus ancien point où revenir : la plus vieille copie de base réussie des trente-cinq jours', () => {
    expect(pointLePlusAncien(brut(), MAINTENANT)).toBe('2026-09-10T23:31:00Z');
    expect(pointLePlusAncien(brut(), new Date('2026-10-20T00:00:00Z'))).toBe('2026-10-12T23:31:00Z');
  });
});

describe('les commandes d\'une remise : composées, jamais lancées', () => {
  const borne = { depuis: '2026-09-01T23:31:00Z', maintenant: MAINTENANT };
  it('l\'essai puis la remise, le motif entre apostrophes : rien ne s\'y interprète', () => {
    const c = commandesRemise({ entreprise: UUID, minute: '2026-10-12 14:03', motif: ' l\'import de $HOME; rm -rf / ' }, borne);
    expect(c).toEqual({ ok: true,
      essai: `sudo bash /opt/skanfact/depot/exploitation/remettre-entreprise.sh ${UUID} "2026-10-12 14:03" 'l'\\''import de $HOME; rm -rf /'`,
      remise: `sudo bash /opt/skanfact/depot/exploitation/remettre-entreprise.sh ${UUID} "2026-10-12 14:03" 'l'\\''import de $HOME; rm -rf /' --remettre` });
    expect(entreApostrophes('a\'b')).toBe('\'a\'\\\'\'b\'');
  });
  it('chaque refus nomme sa case : un client qui n\'est pas un identifiant, une minute illisible, future ou trop vieille, un motif court ou sur deux lignes', () => {
    expect(commandesRemise({ entreprise: 'x; ls', minute: '2026-10-12 14:03', motif: 'abc' }, borne)).toMatchObject({ ok: false, champ: 'entreprise' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-02-31 14:03', motif: 'abc' }, borne)).toMatchObject({ champ: 'minute', raison: 'illisible' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-10-13 11:00', motif: 'abc' }, borne)).toMatchObject({ champ: 'minute', raison: 'futur' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-09-01 23:59', motif: 'abc' }, borne)).toMatchObject({ champ: 'minute', raison: 'trop_vieille' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-10-12 14:03', motif: 'ab' }, borne)).toMatchObject({ champ: 'motif', raison: 'court' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-10-12 14:03', motif: 'un\nimport' }, borne)).toMatchObject({ champ: 'motif', raison: 'illisible' });
    expect(commandesRemise({ entreprise: UUID, minute: '2026-10-12 14:03', motif: 'abc' }, { depuis: null, maintenant: MAINTENANT })).toMatchObject({ raison: 'trop_vieille' });
  });
  it('la minute est à l\'heure de Tunis (UTC+1) : 14:03 à Tunis est 13:03 UTC', () => {
    expect(minuteDeTunis('2026-10-12 14:03')?.toISOString()).toBe('2026-10-12T13:03:00.000Z');
    expect(minuteDeTunis('2026-10-12 24:00')).toBeNull();
  });
});

describe('le calendrier dit par l\'écran est celui des minuteurs du serveur', () => {
  it('la sauvegarde, la copie de base et l\'exercice : les heures et le jour lus dans les tâches', () => {
    const t1 = fs.readFileSync('exploitation/taches/0001-sauvegardes.sh', 'utf8');
    const t8 = fs.readFileSync('exploitation/taches/0008-archivage.sh', 'utf8');
    expect(t1).toContain(`OnCalendar=*-*-* ${CALENDRIER.sauvegarde}:00 UTC`);
    expect(t8).toContain(`minuteur skanfact-base "SkanFact, la copie de base de chaque nuit" $'OnCalendar=*-*-* ${CALENDRIER.copieDeBase}:00 UTC`);
    expect(t8).toContain(`OnCalendar=*-*-0${CALENDRIER.exercice.jourDuMois} ${CALENDRIER.exercice.heure}:00 UTC`);
  });
});
