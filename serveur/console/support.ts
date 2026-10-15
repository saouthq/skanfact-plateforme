// Le support, vu de la console (Support S1 ; docs/support.md ; 0095 ; skanfact docs/cadrage/10-console.md § 2.7), pur :
// ce que la base rend, relu prudemment ; l'état de chaque demande ; leur rang ; et les articles de l'Aide qu'une réponse
// peut citer. Trois règles :
//   - C3 : l'écran Support, la pastille de la barre, la tuile de l'accueil et la ligne d'« À décider » comptent par la
//     MÊME fonction (`etatDe`) ;
//   - une demande sans réponse depuis plus de vingt-quatre heures (deux, si elle est urgente : 0115) remonte en tête, la
//     plus ancienne d'abord : c'est la promesse faite au client (« on te répond dans la journée ») ;
//   - une réponse type n'est pas un second texte à tenir : c'est un article de l'Aide de l'application, celui que le
//     client a sous les yeux (web/public/v10/guide.js, lu tel que le navigateur le reçoit). On cite son identifiant.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const SANS_REPONSE_HEURES = 24;
// Une demande urgente (une caisse arrêtée, une facture qui ne part pas) : deux heures (0115 ; l'audit F13). À VÉRIFIER avec
// Skander avant de l'écrire sur le site.
export const SANS_REPONSE_HEURES_URGENTE = 2;
export const PRIORITES = ['normale', 'urgente'] as const;
export type Priorite = (typeof PRIORITES)[number];
export const delaiDe = (p: Priorite) => (p === 'urgente' ? SANS_REPONSE_HEURES_URGENTE : SANS_REPONSE_HEURES);
export const CANAUX = ['application', 'email', 'whatsapp', 'telephone'] as const;
export type Canal = (typeof CANAUX)[number];
export const CANAUX_NOTES: readonly Canal[] = ['email', 'whatsapp', 'telephone'];

export type LigneDemande = {
  id: string; numero: number; sujet: string; canal: Canal; ouverteLe: string;
  entreprise: { id: string; nom: string; essai: boolean };
  demandeur: { id: string; nom: string };
  noteePar: string | null; suiviePar: string | null;
  // Qui la suit (0115) : son identifiant, pour « la prendre » ou la confier ; sa priorité ; l'attente de la technique.
  suivieParId: string | null; priorite: Priorite; technique: { le: string; motif: string } | null;
  dernierClientLe: string | null; dernierEquipeLe: string | null; dernierCote: 'client' | 'equipe' | null; messages: number;
  close: { le: string; cote: 'client' | 'equipe'; par: string | null; motif: string | null } | null;
};
export type MessageDemande = { id: string; cote: 'client' | 'equipe'; texte: string; article: string | null; le: string; nom: string; notePar: string | null };
export type Demande = {
  ligne: LigneDemande; version: string | null; page: string | null;
  personne: { nom: string; email: string; roles: string[] };
  messages: MessageDemande[];
};

// ── Lire ce que la base rend (plateforme.console_support) : un champ illisible vaut « rien », jamais une valeur devinée.
const texte = (v: unknown) => (typeof v === 'string' ? v : null);
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const cote = (v: unknown) => (v === 'client' || v === 'equipe' ? v : null);

export function lireLigne(x: unknown): LigneDemande | null {
  const l = objet(x);
  const id = texte(l.id), sujet = texte(l.sujet), ouverteLe = texte(l.ouverteLe);
  const canal = CANAUX.includes(l.canal as Canal) ? l.canal as Canal : null;
  const e = objet(l.entreprise), p = objet(l.demandeur);
  if (!id || !sujet || !ouverteLe || !canal || !texte(e.id) || !texte(p.id)) return null;
  const c = l.close ? objet(l.close) : null;
  const closeCote = c ? cote(c.cote) : null;
  const tq = l.technique ? objet(l.technique) : null;
  return {
    id, numero: Number(l.numero) || 0, sujet, canal, ouverteLe,
    entreprise: { id: String(e.id), nom: String(e.nom ?? ''), essai: e.essai === true },
    demandeur: { id: String(p.id), nom: String(p.nom ?? '') },
    noteePar: texte(l.noteePar), suiviePar: texte(l.suiviePar), suivieParId: texte(l.suivieParId),
    priorite: l.priorite === 'urgente' ? 'urgente' : 'normale',
    technique: tq && texte(tq.le) ? { le: String(tq.le), motif: String(tq.motif ?? '') } : null,
    dernierClientLe: texte(l.dernierClientLe), dernierEquipeLe: texte(l.dernierEquipeLe), dernierCote: cote(l.dernierCote),
    messages: Number(l.messages) || 0,
    close: c && texte(c.le) && closeCote ? { le: String(c.le), cote: closeCote, par: texte(c.par), motif: texte(c.motif) } : null,
  };
}

export function lireDemande(x: unknown): Demande | null {
  const d = objet(x);
  const ligne = lireLigne(d.ligne);
  if (!ligne) return null;
  const p = objet(d.personne);
  const messages = Array.isArray(d.messages) ? d.messages.flatMap((m): MessageDemande[] => {
    const o = objet(m);
    const c = cote(o.cote), id = texte(o.id), t = texte(o.texte), le = texte(o.le);
    return c && id && t !== null && le ? [{ id, cote: c, texte: t, article: texte(o.article), le, nom: String(o.nom ?? ''), notePar: texte(o.notePar) }] : [];
  }) : [];
  return {
    ligne, version: texte(d.version), page: texte(d.page),
    personne: { nom: String(p.nom ?? ''), email: String(p.email ?? ''), roles: Array.isArray(p.roles) ? p.roles.filter((r): r is string => typeof r === 'string') : [] },
    messages,
  };
}

// Les closes se lisent par pages (0114) : `closes` est la page demandée, `nCloses` le compte de toutes.
export const CLOSES_PAR_PAGE = 50;
export type MembreSupport = { id: string; nom: string; role: 'direction' | 'support' };
export function lireSupport(x: unknown): { ouvertes: LigneDemande[]; closes: LigneDemande[]; nCloses: number; demande: Demande | null; equipe: MembreSupport[] } {
  const s = objet(x);
  const liste = (v: unknown) => (Array.isArray(v) ? v.map(lireLigne).filter((l): l is LigneDemande => l !== null) : []);
  const closes = liste(s.closes);
  const n = typeof s.nCloses === 'number' && Number.isInteger(s.nCloses) && s.nCloses >= 0 ? s.nCloses : closes.length;
  const equipe = (Array.isArray(s.equipe) ? s.equipe : []).flatMap((m): MembreSupport[] => {
    const o = objet(m);
    return texte(o.id) && (o.role === 'direction' || o.role === 'support') ? [{ id: String(o.id), nom: String(o.nom ?? ''), role: o.role }] : [];
  });
  return { ouvertes: liste(s.ouvertes), closes, nCloses: n, demande: s.demande ? lireDemande(s.demande) : null, equipe };
}

// ── L'état d'une demande ─────────────────────────────────────────────────────────────────────────────────────────────
// `nouvelle` : personne de l'équipe n'y a encore répondu ; `a_repondre` : le client a réécrit après notre réponse ;
// `attend_technique` : la technique doit répondre (0115) — sauf si le client a réécrit depuis, qui attend alors au moins un
// mot de nous ; `attend_client` : la balle est dans son camp ; `close`. Une demande nouvelle ou à répondre attend depuis le
// dernier mot du client ; au-delà de son délai (vingt-quatre heures, deux si elle est urgente), elle est « sans réponse »
// (la ligne d'« À décider », le rouge de la liste).
export type EtatDemande =
  | { etat: 'nouvelle' | 'a_repondre'; attendDepuis: string; heures: number; sansReponse: boolean }
  | { etat: 'attend_client'; depuis: string }
  | { etat: 'attend_technique'; depuis: string }
  | { etat: 'close'; le: string; cote: 'client' | 'equipe' };

export function etatDe(l: LigneDemande, maintenant: Date): EtatDemande {
  if (l.close) return { etat: 'close', le: l.close.le, cote: l.close.cote };
  const reecrit = !!l.technique && l.dernierCote === 'client' && Date.parse(l.dernierClientLe ?? '') > Date.parse(l.technique.le);
  if (l.technique && !reecrit) return { etat: 'attend_technique', depuis: l.technique.le };
  if (l.dernierCote === 'equipe') return { etat: 'attend_client', depuis: l.dernierEquipeLe ?? l.ouverteLe };
  const attendDepuis = l.dernierClientLe ?? l.ouverteLe;
  const heures = Math.max(0, Math.floor((maintenant.getTime() - new Date(attendDepuis).getTime()) / 3_600_000));
  return { etat: l.dernierEquipeLe ? 'a_repondre' : 'nouvelle', attendDepuis, heures, sansReponse: heures >= delaiDe(l.priorite) };
}

// Le rang : sans réponse au-delà de son délai (la plus ancienne d'abord), puis celles qui attendent notre réponse (les
// urgentes d'abord, puis la plus ancienne), puis celles qui attendent la technique, puis le client (la plus récente
// d'abord : on la relit si le client tarde).
export function ranger<T extends LigneDemande>(lignes: T[], maintenant: Date): (T & { etat: EtatDemande })[] {
  const rang = (e: EtatDemande) => (e.etat === 'close' ? 4 : e.etat === 'attend_client' ? 3 : e.etat === 'attend_technique' ? 2 : e.sansReponse ? 0 : 1);
  const quand = (e: EtatDemande) => (e.etat === 'close' ? e.le : e.etat === 'attend_client' || e.etat === 'attend_technique' ? e.depuis : e.attendDepuis);
  return lignes.map((l) => ({ ...l, etat: etatDe(l, maintenant) })).sort((a, b) => {
    const ra = rang(a.etat), rb = rang(b.etat);
    if (ra !== rb) return ra - rb;
    if (ra === 1 && a.priorite !== b.priorite) return a.priorite === 'urgente' ? -1 : 1;
    const c = quand(a.etat).localeCompare(quand(b.etat));
    return (ra >= 2 ? -c : c) || a.numero - b.numero;
  });
}

// Ce que l'accueil compte, et ce que la pastille de la barre compte : les demandes qui attendent NOTRE réponse.
// `attenteMax` : les heures de la plus ancienne qui attend notre réponse (rien si aucune n'attend).
export function compter(lignes: LigneDemande[], maintenant: Date): { ouvertes: number; aRepondre: number; sansReponse: number; attenteMax: number | null } {
  const etats = lignes.filter((l) => !l.close).map((l) => etatDe(l, maintenant));
  const a = etats.flatMap((e) => (e.etat === 'nouvelle' || e.etat === 'a_repondre' ? [e] : []));
  return {
    ouvertes: etats.length, aRepondre: a.length, sansReponse: a.filter((e) => e.sansReponse).length,
    attenteMax: a.length ? Math.max(...a.map((e) => e.heures)) : null,
  };
}

// ── Les articles de l'Aide (les « réponses types ») ──────────────────────────────────────────────────────────────────
// Lus une fois dans le fichier que le navigateur du client reçoit : la console propose exactement l'Aide qu'il lit, et
// l'article de la page où il était quand il a écrit (la même table que le bouton d'Aide de cette page).
export type Article = { id: string; titre: string; sous: string };
type Aide = { articles: Article[]; parPage: Record<string, string> };
let aide: Aide | null = null;
function lireAide(): Aide {
  if (aide) return aide;
  try {
    const bac: Record<string, unknown> = {};
    bac.self = bac;
    vm.createContext(bac);
    vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/guide.js'), 'utf8'), bac, { filename: 'v10/guide.js', timeout: 2000 });
    const g = (bac.SkanGuide ?? {}) as { ARTICLES?: unknown; PAR_PAGE?: unknown };
    const articles = Array.isArray(g.ARTICLES) ? g.ARTICLES.flatMap((a): Article[] => {
      const o = objet(a);
      return typeof o.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(o.id) && typeof o.title === 'string'
        ? [{ id: o.id, titre: o.title, sous: typeof o.sub === 'string' ? o.sub : '' }] : [];
    }) : [];
    const ids = new Set(articles.map((a) => a.id));
    const parPage = Object.fromEntries(Object.entries(objet(g.PAR_PAGE)).filter((x): x is [string, string] => typeof x[1] === 'string' && ids.has(x[1])));
    aide = { articles, parPage };
  } catch { aide = { articles: [], parPage: {} }; }
  return aide;
}
export const articlesDeLAide = () => lireAide().articles;
export const articleConnu = (id: string) => lireAide().articles.some((a) => a.id === id);

// Les réponses types proposées pour une demande, quatre au plus : l'article de la page où la personne était, puis ceux
// dont le titre ou la phrase partagent des mots avec sa demande (sans les accents ni les petits mots). Les autres restent
// à un choix de là.
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const PETITS = new Set(['avec', 'dans', 'pour', 'sans', 'plus', 'tout', 'tous', 'toute', 'faire', 'fait', 'comment', 'bonjour', 'merci', 'cette', 'votre', 'notre',
  'quand', 'mais', 'elle', 'elles', 'leur', 'leurs', 'aussi', 'encore', 'deja', 'peux', 'peut', 'veux', 'trouve', 'trouver', 'aider', 'aide', 'besoin', 'possible']);
const mots = (t: string) => new Set(plier(t).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length >= 4 && !PETITS.has(m)).map((m) => m.replace(/s$/, '')));
export function suggestions(articles: Article[], parPage: Record<string, string>, page: string | null, texte: string, n = 4): string[] {
  const choisis: string[] = [];
  const dePage = page ? parPage[page] : undefined;
  if (dePage && articles.some((a) => a.id === dePage)) choisis.push(dePage);
  const cherches = mots(texte);
  const notes = articles.filter((a) => !choisis.includes(a.id))
    .map((a) => ({ id: a.id, n: [...mots(`${a.titre} ${a.sous}`)].filter((m) => cherches.has(m)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  for (const x of notes) { if (choisis.length >= n) break; choisis.push(x.id); }
  return choisis;
}
export const suggererPour = (d: Demande) => {
  const a = lireAide();
  return suggestions(a.articles, a.parPage, d.page, [d.ligne.sujet, ...d.messages.filter((m) => m.cote === 'client').map((m) => m.texte)].join(' '));
};
