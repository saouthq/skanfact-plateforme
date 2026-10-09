// « Tes premiers pas » de la plateforme (lot onboarding ; maquette validée par Skander le 09/10/2026 ;
// web/public/plateforme/premiers-pas.js), calculés sur le moteur de la v10. Ce qu'ils tiennent :
//   - l'ordre de la maquette ; le RIB seulement quand on attend un virement (un commerce encaisse sur place) ;
//   - ce qui vit sur le serveur se dit tel qu'il est : une adresse à vérifier seulement si le serveur sait envoyer le code,
//     le code du téléphone fait seulement s'il est actif, le comptable fait dès que le mandat est proposé ;
//   - ce qui manque à la fiche se nomme (sans matricule, la facture n'est pas conforme) ;
//   - qui facture sans devis a commencé aussi : « Ta première facture » ;
//   - le panneau quitte l'accueil quand le métier est fait : ni le code recommandé, ni une étape facultative ne le
//     retiennent ; jamais dans l'entreprise d'essai, qui a déjà tout (même essayée avant l'exemple).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Etape = { id: string; titre: string; fait: boolean; action: string | null; quoi: string; badge?: string; facultatif?: boolean; attente?: string };
type Pas = { etapes: Etape[]; faits: number; total: number; fini: boolean; demarrage: boolean; suivante: Etape | null };
type Etat = { compte?: { adresseVerifiee: boolean; courriel: boolean; codeActif: boolean } | null; mandat?: string | null; essai?: boolean };

const module = { exports: {} as unknown };
const core = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${core}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports;
const fenetre: { SkanPremiersPas?: { etapes: (c: unknown, d: unknown, co: unknown, e?: Etat) => Pas } } = {};
vm.runInNewContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/premiers-pas.js'), 'utf8'), { window: fenetre });
const pas = (data: Record<string, unknown>, etat?: Etat) => (fenetre.SkanPremiersPas as NonNullable<typeof fenetre.SkanPremiersPas>).etapes(C, data, data.company, etat);

// Une entreprise de conseil que l'assistant vient de mettre en place : son nom, son matricule, son téléphone.
const conseil = { name: 'Gharbi Conseil', matricule: '4142136K/A/M/000', phone: '+216 55 123 456', activity: 'conseil', setupDone: true };
const compte = { adresseVerifiee: true, courriel: true, codeActif: false };

describe('les premiers pas de la plateforme', () => {
  it('l\'ordre de la maquette, ce que la porte et l\'assistant ont fait, et le RIB qui suit, à faire maintenant', () => {
    const p = pas({ company: conseil, clients: [], documents: [] }, { compte, mandat: null });
    expect(p.etapes.map((e) => e.titre)).toEqual(['Ton compte et ton adresse vérifiée', 'Ton entreprise et où te joindre', 'Ton activité, ta TVA et ton menu',
      'Ton RIB, pour être payé par virement', 'Protège ton compte', 'Ton premier client', 'Ton premier devis', 'Ta facture à ton image', 'Invite ton comptable']);
    expect(p.etapes.filter((e) => e.fait).map((e) => e.id)).toEqual(['compte', 'societe', 'activite']);
    expect([p.faits, p.total, p.demarrage, p.suivante?.id]).toEqual([3, 9, true, 'rib']);
    expect(p.etapes.find((e) => e.id === 'code')?.badge).toBe('Recommandé');
    expect(p.etapes.filter((e) => e.facultatif).map((e) => [e.id, e.badge])).toEqual([['marque', 'Facultatif'], ['comptable', 'Facultatif']]);
    // Un RIB faux ne compte pas : il se dit, avec ce qui ne va pas.
    const faux = pas({ company: { ...conseil, rib: '08001000123456789062' }, clients: [], documents: [] }, { compte });
    expect(faux.etapes.find((e) => e.id === 'rib')).toMatchObject({ fait: false, quoi: expect.stringContaining('clé incorrecte') });
    expect(pas({ company: { ...conseil, rib: '08001000123456789013' }, clients: [], documents: [] }, { compte }).etapes.find((e) => e.id === 'rib')?.fait).toBe(true);
  });

  it('un commerce encaisse sur place : pas de RIB réclamé', () => {
    const p = pas({ company: { ...conseil, activity: 'commerce' }, clients: [], documents: [] }, { compte });
    expect(p.etapes.map((e) => e.id)).not.toContain('rib');
    expect(p.suivante?.id).toBe('code');
  });

  it('le compte se dit tel qu\'il est : l\'adresse à vérifier seulement quand le serveur sait envoyer le code ; le code fait seulement s\'il est actif', () => {
    const premiere = (etat: Etat) => pas({ company: conseil, clients: [], documents: [] }, etat).etapes[0];
    expect(premiere({ compte: { adresseVerifiee: false, courriel: true, codeActif: true } })).toMatchObject({ titre: 'Vérifie ton adresse e-mail', fait: false, action: 'adresse' });
    expect(premiere({ compte: { adresseVerifiee: false, courriel: false, codeActif: false } })).toMatchObject({ titre: 'Ton compte', fait: true });
    // Pas encore lu : le compte existe (on est dedans), rien ne se dit vérifié, ni le code fait.
    expect(premiere({})).toMatchObject({ titre: 'Ton compte', fait: true });
    expect(pas({ company: conseil, clients: [], documents: [] }, {}).etapes.find((e) => e.id === 'code')?.fait).toBe(false);
    expect(pas({ company: conseil, clients: [], documents: [] }, { compte: { ...compte, codeActif: true } }).etapes.find((e) => e.id === 'code')?.fait).toBe(true);
  });

  it('ce qui manque à la fiche se nomme ; sans matricule, la facture n\'est pas conforme', () => {
    const fiche = (co: Record<string, unknown>) => pas({ company: co, clients: [], documents: [] }, { compte }).etapes[1];
    expect(fiche({ ...conseil, matricule: '' })).toMatchObject({ fait: false, quoi: 'Il manque ton matricule fiscal : une facture sans matricule fiscal n\'est pas conforme.' });
    expect(fiche({ ...conseil, phone: '' })).toMatchObject({ fait: false, quoi: 'Il manque où te joindre (une adresse, un téléphone ou un e-mail) : tes clients le lisent sous ton nom, sur chaque facture.' });
    expect(fiche({ ...conseil, phone: '', email: 'contact@gharbi.tn' })?.fait).toBe(true);
  });

  it('l\'activité laissée « Plus tard » se choisit ici ; qui facture sans devis a commencé aussi', () => {
    expect(pas({ company: { ...conseil, activity: '' }, clients: [], documents: [] }, { compte }).etapes[2]).toMatchObject({ fait: false, action: 'assistant' });
    const facture = pas({ company: conseil, clients: [{ id: 'c1' }], documents: [{ id: 'f1', type: 'facture' }] }, { compte }).etapes.find((e) => e.id === 'devis');
    expect(facture).toMatchObject({ titre: 'Ta première facture', fait: true });
  });

  it('le comptable : fait dès que le mandat est proposé, et la proposition se dit', () => {
    const comptable = (mandat: string | null) => pas({ company: conseil, clients: [], documents: [] }, { compte, mandat }).etapes.find((e) => e.id === 'comptable');
    expect(comptable(null)).toMatchObject({ fait: false, attente: '' });
    expect(comptable('propose')).toMatchObject({ fait: true, attente: 'Ta proposition attend que ton cabinet l\'accepte.' });
    expect(comptable('actif')).toMatchObject({ fait: true, attente: '' });
  });

  it('le panneau quitte l\'accueil quand le métier est fait : ni le code recommandé ni les facultatifs ne le retiennent ; jamais dans l\'exemple', () => {
    const fait = { company: { ...conseil, rib: '08001000123456789013' }, clients: [{ id: 'c1' }], documents: [{ id: 'd1', type: 'devis' }] };
    const p = pas(fait, { compte, mandat: null });
    expect(p.etapes.filter((e) => !e.fait).map((e) => e.id)).toEqual(['code', 'marque', 'comptable']);
    expect(p.demarrage).toBe(false);
    const exemple = pas({ demo: true, company: { ...conseil, activity: '' }, clients: [], documents: [] }, { compte });
    expect([exemple.demarrage, exemple.suivante]).toEqual([false, null]);
  });

  // Lot onboarding (09/10/2026) : une entreprise d'essai essayée avant l'exemple (ses propres pièces, sans le jeu de la
  // v10) n'est pas la vraie entreprise : ses premiers pas n'occupent pas l'accueil, et rien n'y est « à faire ensuite ».
  it('jamais dans une entreprise d\'essai, même sans l\'exemple ; une vraie entreprise au même point, si', () => {
    const debut = { company: { ...conseil, activity: '' }, clients: [], documents: [] };
    const essai = pas(debut, { compte, mandat: null, essai: true });
    expect([essai.demarrage, essai.suivante]).toEqual([false, null]);
    const vraie = pas(debut, { compte, mandat: null, essai: false });
    expect(vraie.demarrage).toBe(true);
    expect(vraie.suivante?.id).toBe('activite');
  });
});
