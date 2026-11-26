// (1.388.92) « À faire » du Cabinet : la ligne des questions sans réponse NOMME des clients (« 2 clients n'ont pas
// répondu à tes questions »), et sa pastille les compte. Elle comptait les questions en retard : « 5 » à côté de deux
// clients. Le moteur du Cabinet (cabcore.js) est lu tel que le navigateur le reçoit, dans un bac à sable.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ICI = path.dirname(new URL(import.meta.url).pathname);
type Ligne = { id: string; label: string; count: number; rows: unknown[] };
const bac: { CabCore?: { cabinetTodo: (etat: object, jour: string, opts: object) => Ligne[] } } = {};
vm.createContext(bac);
vm.runInContext(fs.readFileSync(path.join(ICI, '../../web/public/v10/cabinet/cabcore.js'), 'utf8'), bac);
const K = bac.CabCore as NonNullable<typeof bac.CabCore>;

describe('(1.388.92) les questions sans réponse dans « À faire »', () => {
  it('la pastille compte les clients que la ligne nomme, pas leurs questions en retard', () => {
    const etat = { dossiers: [{ id: 'a', name: 'Garage A', manual: true, from: '2026-05' }, { id: 'b', name: 'Café B', manual: true, from: '2026-05' }], settings: {} };
    const maintenant = Date.UTC(2026, 10, 26, 10);
    const il = (jours: number) => String(maintenant - jours * 86400000);
    const questions = [
      { dossierId: 'a', name: 'Garage A', enRetard: 3, attendDepuis: il(12) },
      { dossierId: 'b', name: 'Café B', enRetard: 2, attendDepuis: il(9) },
    ];
    const ligne = K.cabinetTodo(etat, '2026-11-26', { questions, maintenant }).find((x) => x.id === 'questions');
    expect(ligne?.label).toBe('2 clients n\'ont pas répondu à tes questions');
    expect(ligne?.count).toBe(2);
    expect(ligne?.rows).toHaveLength(2);
  });
});
