// Les alertes du service telles que la console les montre, pur (serveur/console/alertes.ts ; docs/console.md C13) : ce que
// la base rend se relit prudemment ; une sourdine grave ne court jamais plus de quatre heures ; le prochain rappel part du
// dernier message REMIS ; la chronologie dit chaque message et par quel moyen, regroupe ce qui échoue de suite, et nomme
// l'alerte DEVENUE grave ; la plus grave d'abord ; une règle ne se dit jamais calme sans relevé récent ; l'histoire dit
// comment chacune s'est réglée. Les comptes sont faits à la main.

import { describe, expect, it } from 'vitest';
import {
  chronologie, enCours, histoire, lireAlertes, ouvertes, prevenus, prochainRappel, regles, sourdineEnCours, sujetDuService, veilleRecente,
  type AlerteLue, type AlertesLues, type EnvoiLu,
} from '../../serveur/console/alertes.ts';

const MAINTENANT = new Date('2026-10-13T08:00:00Z');
const h = (hhmm: string) => `2026-10-13T${hhmm}:00Z`;
const vide: AlertesLues = { alertes: [], envois: [], sourdines: [], dernieres: [], demandes: [], releve: null };
const alerte = (x: Partial<AlerteLue>): AlerteLue => ({
  id: 'a', cle: 'disque:/var', regle: 'disques', titre: 'le disque /var est plein à 80 %', grave: false, aEteGrave: false, faire: '', etapes: [],
  debut: h('05:00'), fin: null, prise: null, ...x,
});
const envoi = (x: Partial<EnvoiLu>): EnvoiLu => ({ le: h('05:00'), sorte: 'nouveau', cle: 'disque:/var', titre: 't', grave: false, courriel: true, sms: true, demande: null, ...x });

describe('ce que la base rend, relu prudemment', () => {
  it('ce qui est mal formé tombe ; la règle d\'une alerte d\'avant se retrouve par sa clé ; une prise se lit entière ou pas', () => {
    const lu = lireAlertes({
      alertes: [
        { id: 1, cle: 'disque:/', titre: 'x', grave: true, aEteGrave: true, faire: 'f', etapes: [{ texte: 'a', code: 'b' }, { texte: 'c' }, { code: 'sans texte' }, 'rien'], debut: h('05:00'), fin: null,
          prise: { par: 'Amira', le: h('05:10'), motif: 'je regarde', moi: true } },
        { id: 2, cle: 'service', regle: 'service', titre: 'y', debut: h('04:00'), fin: h('04:05'), prise: { par: 'Amira' } },
        { id: 3, cle: 'service', debut: 'hier' },
        { id: 4, debut: h('04:00') },
        null,
      ],
      envois: [
        { le: h('05:00'), sorte: 'nouveau', cle: 'disque:/', titre: 'x', grave: true, courriel: true, sms: 'oui' },
        { le: h('05:01'), sorte: 'autre' },
        { le: 'jamais', sorte: 'essai' },
        { le: h('06:00'), sorte: 'essai', demande: 'd1' },
      ],
      sourdines: [{ id: 's', regle: 'disques', debut: h('05:00'), fin: h('09:00'), par: 'Amira', motif: 'm' }, { id: 't', regle: 'disques', debut: h('05:00') }],
      dernieres: [{ cle: 'service', debut: h('01:00'), fin: h('01:03'), grave: true }, { cle: 3, debut: h('01:00') }],
      demandes: [{ id: 'd1', sorte: 'essai', le: h('05:59'), par: 'Amira', faiteLe: h('06:00') }, { id: 'd2', le: 'jamais' }],
      releve: { minute: h('07:59'), destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: { a: '' } },
        regles: { pannes: { etat: 'calme', part: 0, n: 252 }, temps: { etat: 'inventé' }, base: null } },
    });
    expect(lu.alertes.map((a) => a.id)).toEqual(['1', '2']);
    expect(lu.alertes[0]).toMatchObject({ regle: 'disques', etapes: [{ texte: 'a', code: 'b' }, { texte: 'c' }], prise: { par: 'Amira', le: h('05:10'), motif: 'je regarde', moi: true } });
    expect(lu.alertes[1]).toMatchObject({ regle: 'service', prise: null, fin: h('04:05') });
    expect(lu.envois.map((e) => [e.sorte, e.sms, e.demande])).toEqual([['nouveau', null, null], ['essai', null, 'd1']]);
    expect(lu.sourdines.map((s) => s.id)).toEqual(['s']);
    expect(lu.dernieres).toHaveLength(1);
    expect(lu.demandes.map((d) => d.id)).toEqual(['d1']);
    expect(lu.releve).toEqual({ minute: h('07:59'), destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: null },
      regles: { pannes: { etat: 'calme', part: 0, n: 252, p95: null, lectures: 0 } } });
    expect(lireAlertes(null)).toEqual(vide);
  });

  it('la veille est récente cinq minutes après son dernier relevé, pas une de plus', () => {
    const lu = (minute: string): AlertesLues => ({ ...vide, releve: { minute, destinataires: null, regles: null } });
    expect(veilleRecente(lu(h('07:55')), MAINTENANT)).toBe(true);
    expect(veilleRecente(lu('2026-10-13T07:54:59Z'), MAINTENANT)).toBe(false);
    expect(veilleRecente(vide, MAINTENANT)).toBe(false);
  });
});

describe('la sourdine et le prochain rappel', () => {
  const s = { id: 's', regle: 'disques', debut: h('06:00'), fin: h('14:00'), par: 'Amira', motif: 'm', leveeLe: null, leveePar: null };

  it('la sourdine qui court ; avec une alerte grave ouverte, quatre heures au plus après son début', () => {
    expect(sourdineEnCours({ ...vide, sourdines: [s] }, 'disques', MAINTENANT)?.finEffective).toBe(new Date(h('14:00')).toISOString());
    const grave = { ...vide, sourdines: [s], alertes: [alerte({ grave: true })] };
    expect(sourdineEnCours(grave, 'disques', MAINTENANT)?.finEffective).toBe(new Date(h('10:00')).toISOString());
    expect(sourdineEnCours(grave, 'disques', new Date(h('10:00')))).toBeNull();
    // Levée, finie, pas commencée, d'une autre règle : aucune.
    expect(sourdineEnCours({ ...vide, sourdines: [{ ...s, leveeLe: h('07:00'), leveePar: 'Amira' }] }, 'disques', MAINTENANT)).toBeNull();
    expect(sourdineEnCours({ ...vide, sourdines: [s] }, 'disques', new Date(h('14:00')))).toBeNull();
    expect(sourdineEnCours({ ...vide, sourdines: [s] }, 'disques', new Date(h('05:59')))).toBeNull();
    expect(sourdineEnCours({ ...vide, sourdines: [s] }, 'service', MAINTENANT)).toBeNull();
  });

  it('le prochain rappel : six heures après le dernier message REMIS de cette alerte ; rien de remis, rien à promettre', () => {
    const a = alerte({});
    const lu = { ...vide, alertes: [a], envois: [
      envoi({ le: h('04:00') }), // avant l'alerte (une précédente, réglée) : ne compte pas
      envoi({ le: h('05:00') }),
      envoi({ le: h('06:30'), sorte: 'rappel', courriel: false, sms: false }), // pas remis
      envoi({ le: h('06:40'), sorte: 'rappel', courriel: false, sms: true }),
      envoi({ le: h('07:00'), cle: 'certificat' }),
    ] };
    expect(prochainRappel(lu, a)).toBe(new Date(h('12:40')).toISOString());
    expect(prochainRappel({ ...lu, envois: [envoi({ courriel: false, sms: false })] }, a)).toBeNull();
  });
});

describe('la chronologie d\'une alerte', () => {
  it('chaque message et ses moyens ; ce qui échoue de suite en une ligne ; devenue grave ; prise, sourdine, réglée', () => {
    const a = alerte({ debut: h('05:00'), fin: h('07:30'), aEteGrave: true, prise: { par: 'Amira', le: h('06:10'), motif: 'je libère /var', moi: true } });
    const lu: AlertesLues = { ...vide, alertes: [a],
      envois: [
        envoi({ le: h('05:00') }),
        envoi({ le: h('06:00'), sorte: 'rappel', grave: true, courriel: false, sms: false }),
        envoi({ le: h('06:01'), sorte: 'rappel', grave: true, courriel: false, sms: false }),
        envoi({ le: h('06:02'), sorte: 'rappel', grave: true, courriel: true, sms: true }),
        envoi({ le: h('06:03'), sorte: 'essai', cle: null }), // un essai n'appartient à aucune alerte
        envoi({ le: h('06:05'), cle: 'certificat' }), // une autre alerte
        envoi({ le: h('07:30'), sorte: 'regle', grave: true, sms: true }),
        envoi({ le: h('07:32'), sorte: 'regle', grave: true }), // plus d'une minute après sa fin : une autre fois
      ],
      sourdines: [
        { id: 's', regle: 'disques', debut: h('06:20'), fin: h('08:20'), par: 'Amira', motif: 'pendant le nettoyage', leveeLe: h('07:00'), leveePar: 'Karim' },
        { id: 't', regle: 'disques', debut: h('03:00'), fin: h('04:00'), par: 'Amira', motif: 'avant', leveeLe: null, leveePar: null },
        { id: 'u', regle: 'certificat', debut: h('06:00'), fin: h('09:00'), par: 'Amira', motif: 'autre règle', leveeLe: null, leveePar: null },
      ],
    };
    expect(chronologie(lu, a, MAINTENANT)).toEqual([
      { le: h('05:00'), sorte: 'ouverte', grave: false, attente: 1 },
      { le: h('05:00'), sorte: 'message', quoi: 'nouveau', grave: false, courriel: true, sms: true, fois: 1, jusqua: h('05:00') },
      { le: h('06:00'), sorte: 'message', quoi: 'aggravee', grave: true, courriel: false, sms: false, fois: 2, jusqua: h('06:01') },
      { le: h('06:02'), sorte: 'message', quoi: 'aggravee', grave: true, courriel: true, sms: true, fois: 1, jusqua: h('06:02') },
      { le: h('06:10'), sorte: 'prise', par: 'Amira', motif: 'je libère /var' },
      { le: h('06:20'), sorte: 'sourdine', par: 'Amira', motif: 'pendant le nettoyage', fin: h('08:20') },
      { le: h('07:00'), sorte: 'sourdine_levee', par: 'Karim' },
      { le: h('07:30'), sorte: 'message', quoi: 'regle', grave: true, courriel: true, sms: true, fois: 1, jusqua: h('07:30') },
      { le: h('07:30'), sorte: 'reglee' },
    ]);
  });

  it('le service attend deux minutes de suite ; un rappel grave d\'une alerte déjà dite grave est un rappel', () => {
    const a = alerte({ cle: 'service', regle: 'service', grave: true, debut: h('05:00') });
    const lu = { ...vide, alertes: [a], envois: [envoi({ cle: 'service', le: h('05:01'), grave: true }), envoi({ cle: 'service', le: h('11:01'), sorte: 'rappel', grave: true })] };
    const c = chronologie(lu, a, new Date(h('11:30')));
    expect(c[0]).toEqual({ le: h('05:00'), sorte: 'ouverte', grave: true, attente: 2 });
    expect(c.map((e) => (e.sorte === 'message' ? e.quoi : e.sorte))).toEqual(['ouverte', 'nouveau', 'rappel']);
  });
});

describe('les alertes en cours, qui est prévenu, les règles, l\'histoire', () => {
  const lu: AlertesLues = {
    ...vide,
    alertes: [
      alerte({ id: 'disque', debut: h('05:00'), etapes: [], faire: 'Libère de la place.' }),
      alerte({ id: 'copie', cle: 'hors-machine', regle: 'hors-machine', titre: 'la copie hors de la machine est en retard de 90 minutes', grave: true, aEteGrave: true, debut: h('06:00'), etapes: [{ texte: 'a' }] }),
      alerte({ id: 'vieille', cle: 'service', regle: 'service', titre: 'SkanFact ne répond plus', grave: true, aEteGrave: true, debut: h('02:00'), fin: h('02:10'), prise: { par: 'Karim', le: h('02:05'), motif: 'm', moi: false } }),
      alerte({ id: 'seule', cle: 'temps', regle: 'temps', titre: 'lent', debut: h('01:00'), fin: h('01:30') }),
    ],
    dernieres: [{ cle: 'service', debut: h('02:00'), fin: h('02:10'), grave: true }, { cle: 'service', debut: '2026-10-01T02:00:00Z', fin: '2026-10-01T02:30:00Z', grave: true }],
    envois: [envoi({ sorte: 'essai', cle: null, le: h('03:00'), courriel: true, sms: false }), envoi({ sorte: 'essai', cle: null, le: h('04:00'), courriel: true, sms: null })],
    demandes: [{ id: 'd', sorte: 'essai', le: h('07:59'), par: 'Amira', faiteLe: null }],
    releve: { minute: h('07:59'), destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: null }, regles: { temps: { etat: 'trop_peu', p95: null, lectures: 4 } } },
  };

  it('la plus grave d\'abord, puis la plus ancienne ; ses étapes, ou son texte d\'avant les étapes', () => {
    expect(ouvertes(lu).map((a) => a.id)).toEqual(['copie', 'disque']);
    const e = enCours(lu, MAINTENANT);
    expect(e.map((a) => [a.id, a.brique])).toEqual([['copie', 'hors-machine'], ['disque', 'disques']]);
    expect(e[1]?.etapes).toEqual([{ texte: 'Libère de la place.' }]);
  });

  it('qui est prévenu : tel que la veille l\'a lu, le dernier essai, et celui qui attend la veille', () => {
    expect(prevenus(lu)).toEqual({ destinataires: { courriel: { a: 'v•••@•••.tn', pret: true }, sms: null }, releveLe: h('07:59'),
      dernierEssai: { le: h('04:00'), courriel: true, sms: null }, essaiEnAttente: { le: h('07:59'), par: 'Amira' } });
  });

  it('chaque règle : grave, à regarder, trop peu lue, calme, ou pas branchée ; rien de calme sans relevé récent', () => {
    const r = regles(lu, MAINTENANT);
    const etat = (id: string) => r.find((x) => x.id === id);
    expect(etat('hors-machine')?.etat).toBe('grave');
    expect(etat('disques')?.etat).toBe('attention');
    expect(etat('temps')).toMatchObject({ etat: 'trop_peu', lu: { etat: 'trop_peu', p95: null, lectures: 4 } });
    expect(etat('certificat')?.etat).toBe('calme');
    expect(etat('exterieur')?.etat).toBe('pas_branchee');
    // Sa dernière alerte : la plus récente de ce que la base garde.
    expect(etat('service')?.derniere).toEqual({ cle: 'service', debut: h('02:00'), fin: h('02:10'), grave: true });
    // La veille s'est tue depuis vingt minutes : rien n'est « calme », et ce qu'elle a lu ne vaut plus pour maintenant.
    const tard = regles(lu, new Date(h('08:20')));
    expect(tard.find((x) => x.id === 'certificat')?.etat).toBe('non_lu');
    expect(tard.find((x) => x.id === 'temps')?.lu).toBeNull();
    expect(tard.find((x) => x.id === 'hors-machine')?.etat).toBe('grave');
  });

  it('l\'histoire : la plus récente d\'abord, sa durée, et comment elle s\'est réglée', () => {
    expect(histoire(lu, MAINTENANT).map((x) => [x.id, x.minutes, x.reglee, x.grave])).toEqual([
      ['copie', 120, 'en_cours', true], ['disque', 180, 'en_cours', false], ['vieille', 10, 'prise', true], ['seule', 30, 'seule', false],
    ]);
  });
});

describe('au journal, un geste du service dit sur quoi il porte', () => {
  it('la règle de la sourdine, celle de l\'alerte prise en charge, l\'essai ; et la fin prévue d\'une sourdine', () => {
    expect(sujetDuService('service.sourdine', null, { regle: 'disques', fin: '2026-10-13T10:00:00Z' })).toEqual({ regle: 'disques', essai: false, fin: '2026-10-13T10:00:00Z' });
    // Levée : la fin PRÉVUE est dans l'avant ; l'après porte la minute de la levée (vu à l'écran : « devait courir
    // jusqu'à 09:22 », l'heure même de la levée).
    expect(sujetDuService('service.sourdine_levee', { regle: 'copie', fin: '2026-10-13T12:00:00Z' }, { regle: 'copie', fin: '2026-10-13T09:22:00Z' }))
      .toEqual({ regle: 'copie', essai: false, fin: '2026-10-13T12:00:00Z' });
    // Une prise en charge garde la clé de l'alerte : sa règle s'en déduit, comme partout ailleurs.
    expect(sujetDuService('service.prendre', null, { alerte: 'x', cle: 'disque:/var', prisePar: null })).toEqual({ regle: 'disques', essai: false, fin: null });
    expect(sujetDuService('service.essai', null, { demande: 'd' })).toEqual({ regle: null, essai: true, fin: null });
    // Un autre geste n'est pas un geste du service ; une fin illisible ne se dit pas.
    expect(sujetDuService('abonnement.payer', null, { regle: 'disques' })).toBeNull();
    expect(sujetDuService('service.sourdine', null, { regle: 'disques', fin: 'demain' })?.fin).toBeNull();
  });
});
