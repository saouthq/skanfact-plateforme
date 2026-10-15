// Le support vu de la console, sans la base (serveur/console/support.ts ; docs/support.md) : ce que la base rend, lu
// prudemment ; l'état de chaque demande, son rang, ce que l'accueil et la barre comptent (la MÊME fonction, C3) ; et les
// articles de l'Aide proposés en réponse, lus dans l'Aide que le client a sous les yeux.
import { describe, expect, it } from 'vitest';
import {
  articleConnu, articlesDeLAide, compter, delaiDe, etatDe, lireSupport, ranger, SANS_REPONSE_HEURES, SANS_REPONSE_HEURES_URGENTE, suggestions, type LigneDemande,
} from '../../serveur/console/support.ts';

const MAINTENANT = new Date('2026-10-13T12:00:00Z');
const ilYa = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3_600_000).toISOString();
let n = 0;
const ligne = (l: Partial<LigneDemande>): LigneDemande => ({
  id: `d${++n}`, numero: n, sujet: `Demande ${n}`, canal: 'application', ouverteLe: ilYa(100),
  entreprise: { id: 'e1', nom: 'Menuiserie', essai: false }, demandeur: { id: 'u1', nom: 'Nadia' },
  noteePar: null, suiviePar: null, suivieParId: null, priorite: 'normale', technique: null,
  dernierClientLe: null, dernierEquipeLe: null, dernierCote: 'client', attendClientLe: null, attendClientApresTechniqueLe: null, messages: 1, close: null, incident: null, correction: null, ...l,
});

describe('l\'état d\'une demande', () => {
  it('nouvelle tant que l\'équipe n\'a rien dit ; à répondre quand le client a réécrit ; elle attend depuis son PREMIER mot resté sans réponse', () => {
    expect(etatDe(ligne({ ouverteLe: ilYa(3), dernierClientLe: ilYa(3), attendClientLe: ilYa(3) }), MAINTENANT)).toEqual({ etat: 'nouvelle', attendDepuis: ilYa(3), heures: 3, sansReponse: false });
    // Ouverte il y a quatre jours, répondue, puis le client a réécrit il y a deux heures : deux heures, pas cent.
    expect(etatDe(ligne({ dernierEquipeLe: ilYa(50), dernierClientLe: ilYa(2), attendClientLe: ilYa(2), dernierCote: 'client' }), MAINTENANT))
      .toEqual({ etat: 'a_repondre', attendDepuis: ilYa(2), heures: 2, sansReponse: false });
    // L'audit C08 : ouverte il y a 26 heures, toujours sans réponse, et le client relance il y a une heure (« vous avez vu
    // mon message ? ») : elle attend depuis 26 heures, et reste sans réponse — la relance ne l'efface pas des urgences.
    expect(etatDe(ligne({ ouverteLe: ilYa(26), attendClientLe: ilYa(26), dernierClientLe: ilYa(1) }), MAINTENANT))
      .toEqual({ etat: 'nouvelle', attendDepuis: ilYa(26), heures: 26, sansReponse: true });
    // Sans aucun mot daté du client (une ligne d'avant), on compte depuis l'ouverture.
    expect(etatDe(ligne({ ouverteLe: ilYa(30) }), MAINTENANT)).toMatchObject({ etat: 'nouvelle', heures: 30, sansReponse: true });
  });

  it('« sans réponse » commence à vingt-quatre heures pile, pas une de moins', () => {
    expect(SANS_REPONSE_HEURES).toBe(24);
    expect(etatDe(ligne({ dernierClientLe: ilYa(23.99) }), MAINTENANT)).toMatchObject({ heures: 23, sansReponse: false });
    expect(etatDe(ligne({ dernierClientLe: ilYa(24) }), MAINTENANT)).toMatchObject({ heures: 24, sansReponse: true });
  });

  it('la balle chez le client : elle attend depuis notre dernière réponse ; close : par qui, et quand', () => {
    expect(etatDe(ligne({ dernierClientLe: ilYa(60), dernierEquipeLe: ilYa(5), dernierCote: 'equipe' }), MAINTENANT)).toEqual({ etat: 'attend_client', depuis: ilYa(5) });
    // Close, même si le dernier mot était du client : close passe avant tout.
    expect(etatDe(ligne({ dernierClientLe: ilYa(1), close: { le: ilYa(0.5), cote: 'client', par: 'Nadia', motif: null } }), MAINTENANT))
      .toEqual({ etat: 'close', le: ilYa(0.5), cote: 'client' });
  });
});

describe('la priorité et l\'attente de la technique (0115)', () => {
  it('urgente : sans réponse à deux heures pile ; normale : à vingt-quatre', () => {
    expect(delaiDe('urgente')).toBe(SANS_REPONSE_HEURES_URGENTE);
    expect(delaiDe('normale')).toBe(SANS_REPONSE_HEURES);
    const urgente = (h: number) => etatDe(ligne({ priorite: 'urgente', dernierClientLe: ilYa(h) }), MAINTENANT);
    expect(urgente(SANS_REPONSE_HEURES_URGENTE - 1)).toMatchObject({ etat: 'nouvelle', sansReponse: false });
    expect(urgente(SANS_REPONSE_HEURES_URGENTE)).toMatchObject({ etat: 'nouvelle', sansReponse: true });
    expect(etatDe(ligne({ dernierClientLe: ilYa(SANS_REPONSE_HEURES_URGENTE) }), MAINTENANT)).toMatchObject({ sansReponse: false });
  });
  it('elle attend la technique depuis son geste ; le client réécrit après : elle attend notre réponse ; avant : elle attend toujours la technique', () => {
    const technique = { le: ilYa(5), motif: 'export TEJ vide' };
    expect(etatDe(ligne({ technique, dernierClientLe: ilYa(6) }), MAINTENANT)).toEqual({ etat: 'attend_technique', depuis: ilYa(5) });
    expect(etatDe(ligne({ technique, dernierClientLe: ilYa(1), dernierEquipeLe: ilYa(7) }), MAINTENANT)).toMatchObject({ etat: 'a_repondre', heures: 1 });
    // Il a réécrit pendant l'attente, puis relancé : l'attente court depuis son premier mot après le début de l'attente.
    expect(etatDe(ligne({ technique, dernierClientLe: ilYa(1), attendClientLe: ilYa(6), attendClientApresTechniqueLe: ilYa(3), dernierEquipeLe: ilYa(7) }), MAINTENANT))
      .toMatchObject({ etat: 'a_repondre', heures: 3 });
    // Notre dernier mot après elle (« on y travaille ») : elle attend toujours la technique, pas le client.
    expect(etatDe(ligne({ technique, dernierClientLe: ilYa(6), dernierEquipeLe: ilYa(2), dernierCote: 'equipe' }), MAINTENANT)).toMatchObject({ etat: 'attend_technique' });
    // Close : close, quoi qu'elle attende.
    expect(etatDe(ligne({ technique, close: { le: ilYa(1), cote: 'equipe', par: 'Karim', motif: 'réglé' } }), MAINTENANT).etat).toBe('close');
  });
  it('le rang : sans réponse, puis à répondre (les urgentes d\'abord), puis la technique, puis le client', () => {
    const a = ligne({ dernierClientLe: ilYa(30) });
    const b = ligne({ dernierClientLe: ilYa(10) });
    const c = ligne({ priorite: 'urgente', dernierClientLe: ilYa(1) });
    const d = ligne({ technique: { le: ilYa(3), motif: 'à corriger' }, dernierClientLe: ilYa(4) });
    const e = ligne({ dernierCote: 'equipe', dernierEquipeLe: ilYa(2), dernierClientLe: ilYa(3) });
    expect(ranger([e, d, b, c, a], MAINTENANT).map((x) => x.id)).toEqual([a.id, c.id, b.id, d.id, e.id]);
    // Une attente de la technique n'est pas une réponse due : l'accueil ne la compte pas.
    expect(compter([d], MAINTENANT)).toMatchObject({ ouvertes: 1, aRepondre: 0 });
  });
});

describe('le rang des demandes', () => {
  it('sans réponse d\'abord (la plus ancienne), puis celles qui attendent notre réponse (la plus ancienne), puis celles qui attendent le client (la plus récente), puis les closes', () => {
    // Données rangées dans le désordre exprès : l'ordre d'arrivée ne donne pas la réponse.
    const lignes = [
      ligne({ sujet: 'attend le client, ancien', dernierClientLe: ilYa(80), dernierEquipeLe: ilYa(40), dernierCote: 'equipe' }),
      ligne({ sujet: 'close', close: { le: ilYa(1), cote: 'equipe', par: 'Karim', motif: 'réglé' } }),
      ligne({ sujet: 'nouvelle 2 h', dernierClientLe: ilYa(2) }),
      ligne({ sujet: 'sans réponse 30 h', dernierClientLe: ilYa(30) }),
      ligne({ sujet: 'attend le client, récent', dernierClientLe: ilYa(9), dernierEquipeLe: ilYa(3), dernierCote: 'equipe' }),
      ligne({ sujet: 'sans réponse 50 h', dernierClientLe: ilYa(50) }),
      ligne({ sujet: 'à répondre 8 h', dernierEquipeLe: ilYa(20), dernierClientLe: ilYa(8) }),
    ];
    expect(ranger(lignes, MAINTENANT).map((l) => l.sujet)).toEqual([
      'sans réponse 50 h', 'sans réponse 30 h', 'à répondre 8 h', 'nouvelle 2 h', 'attend le client, récent', 'attend le client, ancien', 'close',
    ]);
    // Chaque ligne porte son état : l'écran ne le recalcule pas.
    expect(ranger(lignes, MAINTENANT)[0]?.etat).toMatchObject({ etat: 'nouvelle', sansReponse: true, heures: 50 });
  });

  it('ce que l\'accueil et la barre comptent : les ouvertes, celles qui attendent notre réponse, les sans réponse, et la plus longue attente', () => {
    const lignes = [
      ligne({ dernierClientLe: ilYa(30) }), ligne({ dernierClientLe: ilYa(2) }),
      ligne({ dernierEquipeLe: ilYa(3), dernierCote: 'equipe' }),
      ligne({ close: { le: ilYa(1), cote: 'client', par: 'Nadia', motif: null }, dernierClientLe: ilYa(70) }),
    ];
    expect(compter(lignes, MAINTENANT)).toEqual({ ouvertes: 3, aRepondre: 2, sansReponse: 1, attenteMax: 30 });
    // Personne n'attend notre réponse : pas de « plus longue attente » (rien, pas zéro).
    expect(compter([ligne({ dernierEquipeLe: ilYa(3), dernierCote: 'equipe' })], MAINTENANT)).toEqual({ ouvertes: 1, aRepondre: 0, sansReponse: 0, attenteMax: null });
    expect(compter([], MAINTENANT)).toEqual({ ouvertes: 0, aRepondre: 0, sansReponse: 0, attenteMax: null });
  });
});

describe('ce que la base rend, lu prudemment', () => {
  it('une ligne illisible ne s\'affiche pas ; un champ illisible vaut « rien », jamais une valeur devinée', () => {
    const bonne = { id: 'a', numero: 7, sujet: 'Logo flou', canal: 'whatsapp', ouverteLe: ilYa(2), entreprise: { id: 'e', nom: 'Atelier', essai: true },
      demandeur: { id: 'u', nom: 'Nadia' }, noteePar: 'Karim', dernierCote: 'client', messages: 2,
      close: { le: ilYa(1), cote: 'ailleurs', par: 'Karim' } };
    const lu = lireSupport({
      ouvertes: [bonne, { ...bonne, id: 'b', canal: 'pigeon' }, { ...bonne, id: 'c', sujet: null }, 'texte'],
      closes: 'pas une liste',
      demande: { ligne: bonne, version: 3, page: 'factures', personne: { nom: 'Nadia', email: 'n@exemple.tn', roles: ['proprietaire', 7] },
        messages: [{ id: 'm1', cote: 'client', texte: 'Bonjour', le: ilYa(2), nom: 'Nadia' }, { id: 'm2', cote: 'robot', texte: 'x', le: ilYa(1) }] },
    });
    expect(lu.ouvertes.map((l) => l.id)).toEqual(['a']);
    // Une clôture dont le côté ne se lit pas n'est pas une clôture : la ligne reste ouverte plutôt que close « par personne ».
    expect(lu.ouvertes[0]?.close).toBeNull();
    expect(lu.ouvertes[0]).toMatchObject({ canal: 'whatsapp', noteePar: 'Karim', entreprise: { essai: true }, dernierClientLe: null });
    expect(lu.closes).toEqual([]);
    expect(lu.demande?.version).toBeNull();
    expect(lu.demande?.personne.roles).toEqual(['proprietaire']);
    expect(lu.demande?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(lireSupport(null)).toEqual({ ouvertes: [], closes: [], nCloses: 0, demande: null, equipe: [] });
  });
});

describe('les réponses types : les articles de l\'Aide que le client lit', () => {
  it('lus dans l\'Aide de l\'application, telle que le navigateur la reçoit', () => {
    const ids = articlesDeLAide().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['facture', 'fiscal', 'support']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(articleConnu('facture')).toBe(true);
    expect(articleConnu('nexiste-pas')).toBe(false);
    // L'article réécrit pour la plateforme : il dit où la réponse attend, pas « prépare le message ».
    expect(articlesDeLAide().find((a) => a.id === 'support')?.sous).toMatch(/réponse/);
  });

  it('l\'article de la page d\'abord, puis ceux qui partagent des mots avec la demande (sans accents, sans petits mots), quatre au plus', () => {
    const articles = [
      { id: 'facture', titre: 'Émettre une facture', sous: 'Le numéro, le timbre' },
      { id: 'fiscal', titre: 'TVA, timbre fiscal et retenue', sous: 'Ce qui surprend' },
      { id: 'caisse', titre: 'La caisse', sous: 'Les tickets du comptoir' },
      { id: 'stock', titre: 'Le stock', sous: 'Les articles et leurs mouvements' },
      { id: 'paie', titre: 'La paie', sous: 'Les bulletins' },
      { id: 'aide', titre: 'Faire avec, comment, pour', sous: 'Bonjour merci' },
    ];
    const parPage = { caisse: 'caisse', factures: 'facture' };
    // Depuis la caisse : la caisse d'abord, même si la demande parle de TVA ; « timbre » rapproche fiscal ET facture,
    // « ticket » (sans son s) la caisse — déjà prise ; les petits mots (« comment », « pour », « merci ») ne comptent pas.
    expect(suggestions(articles, parPage, 'caisse', 'Bonjour, comment enlever le TIMBRE fiscal sur un ticket ? Merci')).toEqual(['caisse', 'fiscal', 'facture']);
    // Une page inconnue ne propose rien d'elle-même ; les accents ne séparent pas « émettre » d'« emettre ».
    expect(suggestions(articles, parPage, 'inconnue', 'je veux emettre')).toEqual(['facture']);
    // Rien en commun : rien de proposé (les articles restent à un choix de là).
    expect(suggestions(articles, parPage, null, 'Bonjour, merci')).toEqual([]);
    // Quatre au plus.
    expect(suggestions(articles, parPage, 'factures', 'timbre fiscal tickets caisse stock articles paie bulletins', 4)).toHaveLength(4);
  });
});
