// Les sauvegardes du service, rangées pour la console (serveur/console/sauvegardes.ts ; docs/console.md C14).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CALENDRIER, commandesRemise, copies, entreApostrophes, GARDE, horsDeLaMachine, lArchivage, laSauvegarde, leDernierExercice, lireSauvegardes, minuteDeTunis,
  nuits, pointLePlusAncien, prochainExercice, promesses, REMISE_PREUVE_J, retardsParHeure,
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
    expect(r).toEqual([{ le: '2026-10-12T15:00:00Z', entreprise: UUID, nom: 'Atelier', motif: 'un import', minute: '2026-10-12 14:03', numerosRetires: 0, secondes: null, preparee: { par: 'Amira', le: '2026-10-12T14:50:00Z' } }]);
  });
});

describe('les quatre chiffres', () => {
  it('la dernière sauvegarde est celle de la dernière nuit qui en a une ; ratée, ou trop vieille, elle est grave', () => {
    expect(laSauvegarde(brut(), MAINTENANT)).toMatchObject({ etat: 'bon', ok: true, lignes: 1908232, vieille: false });
    expect(laSauvegarde(brut(), new Date('2026-10-14T05:00:00Z'))).toMatchObject({ etat: 'grave', vieille: true });
    expect(laSauvegarde(lireSauvegardes({}), MAINTENANT)).toMatchObject({ etat: 'nonmesure' });
  });
  it('hors de la machine : le retard du dernier relevé, aux seuils de la veille ; pas réglée n\'est jamais « à jour »', () => {
    expect(horsDeLaMachine(brut(), MAINTENANT)).toMatchObject({ etat: 'grave', retard: 97 });
    const reglee = brut({ dernier: { minute: '2026-10-13T09:39:00Z', copies: { archivage: null, horsMachine: { regle: true, attenteDepuis: null } } } });
    expect(horsDeLaMachine(reglee, MAINTENANT)).toMatchObject({ etat: 'bon', retard: 0 });
    const non = brut({ dernier: { minute: '2026-10-13T09:39:00Z', copies: { archivage: null, horsMachine: { regle: false, attenteDepuis: null } } } });
    expect(horsDeLaMachine(non, MAINTENANT)).toMatchObject({ etat: 'attention', regle: false });
  });
  it('l\'audit C10 : un relevé de plus de cinq minutes ne dit plus l\'état de maintenant — l\'archivage, la copie hors de la machine, ce qui en dépend', () => {
    // Le dernier relevé est de 09:39 : à 09:44, il vaut encore ; à 09:45, il est périmé (cinq minutes et une).
    const l = brut({ dernier: { minute: '2026-10-13T09:39:00Z', archiveLe: '2026-10-13T09:38:20Z', copies: { archivage: { enMarche: true }, horsMachine: { regle: true, attenteDepuis: null } } } });
    const frais = new Date('2026-10-13T09:44:00Z'), perime = new Date('2026-10-13T09:44:01Z');
    expect(lArchivage(l, frais)).toMatchObject({ etat: 'bon', enMarche: true, perime: false });
    expect(horsDeLaMachine(l, frais)).toMatchObject({ etat: 'bon', regle: true, retard: 0 });
    expect(promesses(l, frais).find((p) => p.id === 'base')?.etat).toBe('tenue');
    expect(copies(l, frais).liste.slice(0, 2).map((c) => c.etat)).toEqual(['en_place', 'en_place']);
    // Rien de ce qu'il disait ne reste vert : non mesuré, avec l'heure du relevé ; le dernier journal archivé reste dit.
    expect(lArchivage(l, perime)).toEqual({ etat: 'nonmesure', enMarche: null, dernier: '2026-10-13T09:38:20Z', releveLe: '2026-10-13T09:39:00Z', perime: true });
    expect(horsDeLaMachine(l, perime)).toMatchObject({ etat: 'nonmesure', regle: null, retard: null, releveLe: '2026-10-13T09:39:00Z', perime: true });
    const base = promesses(l, perime).find((p) => p.id === 'base');
    expect(base?.etat).toBe('a_prouver');
    expect(base?.mesure).toMatchObject({ enMarche: null, releveLe: '2026-10-13T09:39:00Z' });
    expect(copies(l, perime).liste.slice(0, 2)).toEqual([
      { id: 'serveur', etat: 'nonmesure', releveLe: '2026-10-13T09:39:00Z' },
      { id: 'hors_machine', etat: 'nonmesure', retard: null, releveLe: '2026-10-13T09:39:00Z' }]);
    // Un relevé frais rétablit tout.
    const repris = brut({ dernier: { ...l.dernier, minute: '2026-10-13T09:44:00Z', copies: { archivage: { enMarche: true }, horsMachine: { regle: true, attenteDepuis: null } } } });
    expect(lArchivage(repris, perime)).toMatchObject({ etat: 'bon', perime: false });
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
  it('le programme : un seul exemplaire ne peut pas tenir « rien de perdu »', () => {
    expect(etat(brut(), 'programme')).toBe('pas_encore');
    expect(etat(brut({ exemplaires: 2 }), 'programme')).toBe('a_prouver');
    expect(etat(brut(), 'rancongiciel')).toBe('inverifiable');
  });
  it('l\'audit C11 : une entreprise revient en 4 h — tenue seulement par une remise récente, mesurée sous la promesse, revenue à sa minute', () => {
    const remise = (mesuree: unknown, n = 1) => brut({ remisesFaites: { n, derniere: '2026-10-12T15:00:00Z', mesuree } });
    expect(etat(brut(), 'entreprise')).toBe('a_prouver');
    // Faite, mais sans durée : « on l'a déjà fait » ne prouve pas les 4 h.
    expect(etat(remise(null, 3), 'entreprise')).toBe('a_prouver');
    const mesuree = { le: '2026-10-12T15:00:00Z', secondes: 2537, minute: '2026-10-12 14:03' };
    const p = promesses(remise(mesuree), MAINTENANT).find((x) => x.id === 'entreprise');
    expect(p).toMatchObject({ etat: 'tenue', retour: 240, preuve: { n: 1, mesuree, minutes: 43, vieille: false } });
    // 4 h tout juste tient ; une seconde de plus non.
    expect(etat(remise({ ...mesuree, secondes: 14_400 }), 'entreprise')).toBe('tenue');
    expect(etat(remise({ ...mesuree, secondes: 14_401 }), 'entreprise')).toBe('pas_tenue');
    // Sans minute nommée : rien ne dit à quel moment elle a ramené l'entreprise.
    expect(etat(remise({ ...mesuree, minute: null }), 'entreprise')).toBe('a_prouver');
    // Trop vieille : la preuve est à refaire, même rapide ; la veille de la limite, elle vaut encore.
    const le = (j: number) => new Date(MAINTENANT.getTime() - j * 86_400_000).toISOString();
    expect(etat(remise({ ...mesuree, le: le(REMISE_PREUVE_J - 1) }), 'entreprise')).toBe('tenue');
    expect(promesses(remise({ ...mesuree, le: le(REMISE_PREUVE_J + 1) }), MAINTENANT).find((x) => x.id === 'entreprise'))
      .toMatchObject({ etat: 'a_prouver', preuve: { vieille: true } });
  });
  it('la remise mesurée se relit prudemment : une durée qui n\'est pas un entier la fait tomber, une minute illisible devient « aucune »', () => {
    const lue = (mesuree: unknown) => lireSauvegardes({ remisesFaites: { n: 2, derniere: '2026-10-12T15:00:00Z', mesuree } }).remisesFaites;
    expect(lue({ le: '2026-10-12T15:00:00Z', secondes: 600, minute: '2026-10-12 14:03' }).mesuree).toEqual({ le: '2026-10-12T15:00:00Z', secondes: 600, minute: '2026-10-12 14:03' });
    expect(lue({ le: '2026-10-12T15:00:00Z', secondes: '600', minute: '2026-10-12 14:03' }).mesuree).toBeNull();
    expect(lue({ le: '2026-10-12T15:00:00Z', secondes: 600, minute: '12/10 14h03' }).mesuree).toMatchObject({ minute: null });
    expect(lue(undefined)).toEqual({ n: 2, derniere: '2026-10-12T15:00:00Z', mesuree: null });
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
