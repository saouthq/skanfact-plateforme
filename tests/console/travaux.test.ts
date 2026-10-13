// Les travaux et les envois du service, rangés sans la base (serveur/console/travaux.ts ; docs/console.md C25).
import { describe, expect, it } from 'vitest';
import { attenteDe, etatTour, lireTravaux, quatorzeJours, type ARegarder } from '../../serveur/console/travaux.ts';

describe('les travaux, relus prudemment', () => {
  it('chaque partenaire range ses bons et ses refus sous deux noms ; une ligne sans jour ou sans compte ne compte pas', () => {
    const t = lireTravaux({
      jour: '2026-10-13',
      ttn: { jours: [{ jour: '2026-10-13', n: 12, acceptes: 9, refuses: 1 }, { jour: 'hier', n: 3 }], enFile: 2, medianeS: 38 },
      signature: { jours: [{ jour: '2026-10-12', n: 4, reussies: 3, echouees: 1 }] },
      sms: { jours: [{ jour: '2026-10-13', n: 5 }, { jour: '2026-10-12', n: -1 }] },
      paiements: { jours: [] },
      tours: [{ nom: 'facteur', le: '2026-10-13T09:00:00Z', dureeMs: 120, ok: true, compte: { avancees: 3, faux: 'x' } }, { nom: 'x', le: 'jamais', ok: true }],
    });
    expect(t.partenaires.ttn).toEqual([{ jour: '2026-10-13', n: 12, bons: 9, refus: 1 }]);
    expect(t.partenaires.signature).toEqual([{ jour: '2026-10-12', n: 4, bons: 3, refus: 1 }]);
    // Un partenaire qui ne dit pas de refus : tout ce qui est parti est bon.
    expect(t.partenaires.sms).toEqual([{ jour: '2026-10-13', n: 5, bons: 5, refus: 0 }]);
    expect(t.partenaires.relances).toEqual([]);
    expect(t.ttn).toEqual({ enFile: 2, medianeS: 38 });
    expect(t.tours).toEqual([{ nom: 'facteur', le: '2026-10-13T09:00:00Z', dureeMs: 120, ok: true, compte: { avancees: 3 }, echecLe: null, echec: null }]);
    expect(lireTravaux(null).aRegarder).toEqual([]);
  });

  it('quatorze jours, aujourd\'hui compris ; un jour sans envoi vaut zéro', () => {
    const j = quatorzeJours([{ jour: '2026-10-13', n: 2, bons: 2, refus: 0 }, { jour: '2026-09-29', n: 7, bons: 7, refus: 0 }], '2026-10-13');
    expect(j).toHaveLength(14);
    expect(j[0]).toEqual({ jour: '2026-09-30', n: 0, bons: 0, refus: 0 });
    expect(j[13]).toEqual({ jour: '2026-10-13', n: 2, bons: 2, refus: 0 });
  });
});

describe('qui attend quoi', () => {
  const r = (x: Partial<ARegarder>): ARegarder => ({ sorte: 'ttn', cle: 'AB12CD34', entreprise: { id: 'e', nom: null }, statut: 'deposee', essais: 2,
    prochain: null, deposeLe: null, depuis: '2026-10-13T08:00:00Z', motif: null, pieces: null, ...x });
  it('une panne se réessaie seule ; un refus, un compte retenu ou un échec attendent l\'entreprise', () => {
    expect(attenteDe(r({}))).toBe('seul');
    expect(attenteDe(r({ statut: 'a_envoyer', motif: { cle: 'ttn.compte_refuse', valeurs: {} } }))).toBe('entreprise');
    expect(attenteDe(r({ statut: 'refusee' }))).toBe('entreprise');
    expect(attenteDe(r({ sorte: 'signature', statut: 'echouee' }))).toBe('entreprise');
  });
});

describe('l\'état d\'un tour', () => {
  const t = new Date('2026-10-13T10:00:00Z');
  const tour = (le: string, ok = true) => ({ nom: 'facteur', le, dureeMs: 10, ok, compte: {}, echecLe: null, echec: null });
  it('passé à son rythme, en échec, arrêté après trois pas sans passage ; jamais vu, il n\'a pas encore de trace', () => {
    expect(etatTour('facteur', [tour('2026-10-13T09:59:00Z')], t).etat).toBe('bon');
    expect(etatTour('facteur', [tour('2026-10-13T09:59:00Z', false)], t).etat).toBe('echec');
    // Trois minutes pile : pas encore arrêté ; une de plus, si.
    expect(etatTour('facteur', [tour('2026-10-13T09:57:00Z')], t).etat).toBe('bon');
    expect(etatTour('facteur', [tour('2026-10-13T09:56:59Z')], t).etat).toBe('arrete');
    // Un tour d'une heure a trois heures devant lui.
    expect(etatTour('contrats', [{ ...tour('2026-10-13T08:00:00Z'), nom: 'contrats' }], t).etat).toBe('bon');
    expect(etatTour('facteur', [], t)).toEqual({ etat: 'jamais', tour: null });
  });
});

describe('la trace d\'un tour', () => {
  it('ne garde que des nombres nommés, et la nature d\'une erreur, jamais son message', async () => {
    const { compteDe, natureDe } = await import('../../serveur/service/tours.ts');
    expect(compteDe({ contrats: 3, emises: 0, refusees: -1, nom: 'Pharmacie', liste: [1], 'clé-x': 2 })).toEqual({ contrats: 3, emises: 0 });
    expect(compteDe(true)).toEqual({});
    expect(natureDe(Object.assign(new Error('la pièce de Pharmacie Ben Ali'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
    expect(natureDe(new TypeError('Pharmacie Ben Ali'))).toBe('TypeError');
    expect(natureDe('Pharmacie Ben Ali')).toBe('Erreur');
  });
});
