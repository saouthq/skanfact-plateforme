// 1.295.0 — Les garanties jouées comme un installateur de climatisation (l'Hôtel Le Golfe a quatre climatiseurs dont la
// garantie finit, la Clinique Les Pins un onduleur, un onduleur est parti sans fiche client) : une fin de garantie se
// propose UNE fois ; la pièce qui la propose garde ses numéros ; l'accueil compte ce que la page compte ; un client reçoit
// une seule proposition pour ses appareils.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const T = '2026-11-06';
const co = { ...C.DEFAULT_COMPANY, name: 'Clim et Info Jlassi', currency: 'DT' };
const ser = (id: string, itemId: string, serial: string, clientId: string, outDate: string, warrantyMonths: number) =>
  ({ id, itemId, serial, status: outDate ? 'vendu' : 'stock', inDate: '2024-10-01', clientId, outDate, outDocId: '', warrantyMonths });
const base = (documents: Obj[] = []): Obj => ({
  company: co, purchases: [], documents,
  clients: [{ id: 'golfe', name: 'Hôtel Le Golfe' }, { id: 'pins', name: 'Clinique Les Pins' }, { id: 'trab', name: 'Mme Trabelsi' }],
  catalog: [{ id: 'clim', label: 'Climatiseur split 12000 BTU', serialized: true, tracked: true }, { id: 'ond', label: 'Onduleur 1500 VA', serialized: true, tracked: true }],
  serials: [
    // Fin le 19/11/2026 (13 jours) ×3, le 14/12/2026 (38 jours).
    ser('s1', 'clim', 'CL-24-0117', 'golfe', '2024-11-20', 24), ser('s2', 'clim', 'CL-24-0118', 'golfe', '2024-11-20', 24),
    ser('s3', 'clim', 'CL-24-0119', 'golfe', '2024-11-20', 24), ser('s4', 'clim', 'CL-24-0144', 'golfe', '2024-12-15', 24),
    ser('s5', 'ond', 'UPS-25-8812', 'pins', '2025-12-01', 12), // fin le 30/11/2026
    ser('s8', 'ond', 'UPS-25-8890', '', '2025-11-25', 12), // sans client, fin le 24/11/2026
    ser('s7', 'clim', 'CL-26-0502', 'trab', '2026-06-01', 24), // garanti jusqu'en 2028 : hors fenêtre
  ],
});
const contrat = (id: string, garanties: string[], extra: Obj = {}) => ({ id, type: 'contrat', status: 'brouillon', number: '', date: T, createdAt: 1, clientId: 'golfe', lines: [], garanties, ...extra });

describe('garanties 1.295.0', () => {
  it('une garantie proposée ne se compte plus ; annulée, elle revient ; la page et l\'accueil disent le même chiffre', () => {
    const vide = base();
    expect(C.garantiesAProposer(vide, 60, T).map((x: Obj) => x.id)).toEqual(['s1', 's2', 's3', 's8', 's5', 's4']);
    const d = base([contrat('k1', ['s1', 's2', 's3'])]);
    const ix = C.propositionsDeGarantie(d);
    expect([...ix.keys()].sort()).toEqual(['s1', 's2', 's3']);
    expect(C.garantiesAProposer(d, 60, T).map((x: Obj) => x.id)).toEqual(['s8', 's5', 's4']);
    const todo = C.todoList(d, co, T).find((x: Obj) => x.id === 'garanties');
    expect(todo.count).toBe(C.garantiesAProposer(d, 60, T).length);
    // Une pièce annulée ne propose plus rien.
    const an = base([contrat('k1', ['s1', 's2', 's3'], { status: 'annulé' })]);
    expect(C.garantiesAProposer(an, 60, T).length).toBe(6);
    // Deux pièces pour un même appareil : la plus récente fait foi (un devis refusé, puis un contrat).
    const deux = base([{ ...contrat('dv', ['s5']), type: 'devis', status: 'refusé', date: '2026-10-01', clientId: 'pins' }, { ...contrat('k2', ['s5']), clientId: 'pins', date: '2026-11-02' }]);
    expect(C.propositionsDeGarantie(deux).get('s5').id).toBe('k2');
    // Une facture qui porterait la marque ne propose rien : seuls un contrat ou un devis.
    expect(C.propositionsDeGarantie(base([{ ...contrat('f', ['s5']), type: 'facture' }])).size).toBe(0);
  });

  it('un groupe par client, dans l\'ordre de la fin la plus proche ; un numéro sans client reste seul', () => {
    const g = C.garantiesParClient(C.garantiesAProposer(base(), 60, T));
    expect(g.map((x: Obj) => [x.clientId, x.items.map((i: Obj) => i.id), x.premiere])).toEqual([
      ['golfe', ['s1', 's2', 's3', 's4'], '2026-11-19'],
      ['', ['s8'], '2026-11-24'],
      ['pins', ['s5'], '2026-11-30'],
    ]);
  });

  it('la ligne de maintenance : une désignation courte, le numéro et le jour où elle prend le relais', () => {
    const x = C.serialList(base(), {}, T).find((s: Obj) => s.id === 's4');
    expect(C.ligneDeMaintenance(x)).toEqual({ label: 'Maintenance : Climatiseur split 12000 BTU',
      description: 'N° de série CL-24-0144 · à partir du 15/12/2026, à la fin de la garantie du constructeur.' });
  });
});
