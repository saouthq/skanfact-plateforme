// Les alertes du service (Console 3c ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 7 ; docs/console.md C13) : ce
// qui est en cours, qui s'en occupe, ce qui est parti par e-mail et par SMS, les sourdines, les règles de la veille et
// ce qu'elles voient en ce moment, qui est prévenu, et l'histoire des trente derniers jours. Pur (testé :
// tests/console/alertes.test.ts) : la route lit la base et la veille, ces fonctions rangent.

import { briqueDe, CONFIRMATIONS, PANNES_MINUTES, RAPPEL_H, REGLES, regleDe, SOURDINE_GRAVE_MAX_H, TEMPS_MINUTES, type Etape, type EtatRegle } from '../../exploitation/veille.ts';

// ── Ce que la base rend (plateforme.console_service_alertes), relu prudemment ─────────────────────────────────────────
// `moi` : prise par celui qui lit (la base le dit : deux personnes peuvent porter le même nom).
export type Prise = { par: string; le: string; motif: string; moi: boolean };
export type AlerteLue = {
  id: string; cle: string; regle: string | null; titre: string; grave: boolean; aEteGrave: boolean; faire: string; etapes: Etape[];
  debut: string; fin: string | null; prise: Prise | null;
};
export type EnvoiLu = { le: string; sorte: 'nouveau' | 'rappel' | 'regle' | 'essai'; cle: string | null; titre: string | null; grave: boolean; courriel: boolean | null; sms: boolean | null; demande: string | null };
export type SourdineLue = { id: string; regle: string; debut: string; fin: string; par: string; motif: string; leveeLe: string | null; leveePar: string | null };
export type DemandeLue = { id: string; sorte: string; le: string; par: string; faiteLe: string | null };
export type MoyenLu = { a: string; pret: boolean };
export type LuDeLaRegle = { etat: EtatRegle; part?: number | null; n?: number; p95?: number | null; lectures?: number };
export type AlertesLues = {
  alertes: AlerteLue[];
  envois: EnvoiLu[];
  sourdines: SourdineLue[];
  dernieres: { cle: string; debut: string; fin: string | null; grave: boolean }[];
  demandes: DemandeLue[];
  releve: { minute: string; destinataires: { courriel: MoyenLu | null; sms: MoyenLu | null } | null; regles: Record<string, LuDeLaRegle> | null } | null;
};

const texte = (x: unknown) => (typeof x === 'string' ? x : null);
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const bool = (x: unknown) => (x === true ? true : x === false ? false : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const ETATS: readonly EtatRegle[] = ['calme', 'alerte', 'trop_peu', 'non_lu'];
const nombreOuNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const moyen = (x: unknown): MoyenLu | null => {
  const m = x as { a?: unknown; pret?: unknown } | null;
  return m && typeof m.a === 'string' && m.a ? { a: m.a, pret: m.pret === true } : null;
};

export function lireAlertes(brut: unknown): AlertesLues {
  const b = (brut ?? {}) as Record<string, unknown>;
  const r = b.releve as Record<string, unknown> | null;
  const d = r?.destinataires as Record<string, unknown> | null | undefined;
  const regles = r?.regles as Record<string, Record<string, unknown>> | null | undefined;
  return {
    alertes: tableau(b.alertes).flatMap((a) => {
      const debut = date(a.debut);
      if (!debut || typeof a.cle !== 'string') return [];
      const p = a.prise as Record<string, unknown> | null;
      return [{
        id: String(a.id), cle: a.cle, regle: texte(a.regle) ?? regleDe(a.cle), titre: String(a.titre ?? ''), grave: a.grave === true, aEteGrave: a.aEteGrave === true,
        faire: String(a.faire ?? ''), etapes: tableau(a.etapes).flatMap((e) => (typeof e.texte === 'string' ? [{ texte: e.texte, ...(typeof e.code === 'string' ? { code: e.code } : {}) }] : [])),
        debut, fin: date(a.fin), prise: p && typeof p.par === 'string' && date(p.le) ? { par: p.par, le: String(p.le), motif: String(p.motif ?? ''), moi: p.moi === true } : null,
      }];
    }),
    envois: tableau(b.envois).flatMap((e) => {
      const le = date(e.le);
      const sorte = e.sorte === 'nouveau' || e.sorte === 'rappel' || e.sorte === 'regle' || e.sorte === 'essai' ? e.sorte : null;
      return le && sorte ? [{ le, sorte, cle: texte(e.cle), titre: texte(e.titre), grave: e.grave === true, courriel: bool(e.courriel), sms: bool(e.sms), demande: texte(e.demande) }] : [];
    }),
    sourdines: tableau(b.sourdines).flatMap((s) => {
      const debut = date(s.debut), fin = date(s.fin);
      return debut && fin && typeof s.regle === 'string'
        ? [{ id: String(s.id), regle: s.regle, debut, fin, par: String(s.par ?? ''), motif: String(s.motif ?? ''), leveeLe: date(s.leveeLe), leveePar: texte(s.leveePar) }] : [];
    }),
    dernieres: tableau(b.dernieres).flatMap((x) => (typeof x.cle === 'string' && date(x.debut) ? [{ cle: x.cle, debut: String(x.debut), fin: date(x.fin), grave: x.grave === true }] : [])),
    demandes: tableau(b.demandes).flatMap((x) => (date(x.le) ? [{ id: String(x.id), sorte: String(x.sorte), le: String(x.le), par: String(x.par ?? ''), faiteLe: date(x.faiteLe) }] : [])),
    releve: r && date(r.minute) ? {
      minute: String(r.minute),
      destinataires: d ? { courriel: moyen(d.courriel), sms: moyen(d.sms) } : null,
      regles: regles && typeof regles === 'object' ? Object.fromEntries(Object.entries(regles).flatMap(([k, v]) => (v && ETATS.includes(v.etat as EtatRegle)
        ? [[k, { etat: v.etat as EtatRegle, part: nombreOuNull(v.part), n: nombreOuNull(v.n) ?? 0, p95: nombreOuNull(v.p95), lectures: nombreOuNull(v.lectures) ?? 0 }]] : []))) : null,
    } : null,
  };
}

// ── La veille est-elle là ? ─────────────────────────────────────────────────────────────────────────────────────────
// Un relevé de moins de cinq minutes : la veille tourne, ce qu'elle a lu vaut pour maintenant. Plus vieux, rien de ce
// qu'elle a lu n'est « en ce moment » : les règles se disent non lues (rien n'est vert sans mesure).
export const VEILLE_RECENTE_MIN = 5;
export const veilleRecente = (lu: AlertesLues, maintenant: Date) =>
  lu.releve !== null && maintenant.getTime() - Date.parse(lu.releve.minute) <= VEILLE_RECENTE_MIN * 60_000;

// ── La sourdine d'une règle ─────────────────────────────────────────────────────────────────────────────────────────
// Celle qui court : ni levée, ni finie. Pour une règle qui a une alerte grave ouverte, elle finit au plus tard quatre
// heures après son début (la veille le tient aussi, exploitation/veille.ts) : c'est cette fin-là qu'on dit.
export function sourdineEnCours(lu: AlertesLues, regle: string, maintenant: Date): (SourdineLue & { finEffective: string }) | null {
  const grave = lu.alertes.some((a) => a.fin === null && a.grave && a.regle === regle);
  for (const s of lu.sourdines) {
    if (s.regle !== regle || s.leveeLe !== null) continue;
    const fin = Math.min(Date.parse(s.fin), grave ? Date.parse(s.debut) + SOURDINE_GRAVE_MAX_H * 3_600_000 : Infinity);
    if (Date.parse(s.debut) <= maintenant.getTime() && maintenant.getTime() < fin) return { ...s, finEffective: new Date(fin).toISOString() };
  }
  return null;
}

// ── Ce qui est parti ────────────────────────────────────────────────────────────────────────────────────────────────
// Un envoi est « remis » quand un moyen au moins l'a pris (le relais d'e-mails, WinSMS) : pas forcément lu.
const remis = (e: EnvoiLu) => e.courriel === true || e.sms === true;

// Le prochain rappel d'une alerte ouverte : six heures après le dernier message remis (nouveau ou rappel). Rien de remis
// encore : la veille réessaie chaque minute, il n'y a pas de « prochain rappel » à promettre.
export function prochainRappel(lu: AlertesLues, a: AlerteLue): string | null {
  const dits = lu.envois.filter((e) => e.cle === a.cle && (e.sorte === 'nouveau' || e.sorte === 'rappel') && remis(e) && Date.parse(e.le) >= Date.parse(a.debut));
  const dernier = dits.at(-1);
  return dernier ? new Date(Date.parse(dernier.le) + RAPPEL_H * 3_600_000).toISOString() : null;
}

// ── La chronologie d'une alerte ─────────────────────────────────────────────────────────────────────────────────────
// Dans l'ordre du temps : elle s'ouvre (et combien de minutes de suite la veille attend avant de prévenir) ; chaque
// message, sa gravité et par quel moyen il est parti ; qui la prend en charge ; les sourdines de sa règle ; elle se règle.
// Un rappel grave après un message qui ne l'était pas dit qu'elle est DEVENUE grave (la veille le redit aussitôt). Des
// messages qui échouent de suite (un relais en panne : la veille réessaie chaque minute) se disent en une ligne, avec
// leur nombre.
export type Evenement =
  | { le: string; sorte: 'ouverte'; grave: boolean; attente: number }
  | { le: string; sorte: 'message'; quoi: 'nouveau' | 'rappel' | 'aggravee' | 'regle'; grave: boolean; courriel: boolean | null; sms: boolean | null; fois: number; jusqua: string }
  | { le: string; sorte: 'prise'; par: string; motif: string }
  | { le: string; sorte: 'sourdine'; par: string; motif: string; fin: string }
  | { le: string; sorte: 'sourdine_levee'; par: string }
  | { le: string; sorte: 'reglee' };
export function chronologie(lu: AlertesLues, a: AlerteLue, maintenant: Date): Evenement[] {
  const debut = Date.parse(a.debut);
  const fin = a.fin ? Date.parse(a.fin) : maintenant.getTime();
  // Un message « réglé » part la minute où l'alerte se ferme : il compte jusqu'à une minute après sa fin.
  const siens = lu.envois.filter((x) => x.cle === a.cle && x.sorte !== 'essai' && Date.parse(x.le) >= debut && Date.parse(x.le) <= fin + 60_000);
  // Sa gravité à l'ouverture : celle de son premier message (elle a pu le devenir ensuite).
  const e: Evenement[] = [{ le: a.debut, sorte: 'ouverte', grave: siens.find((x) => x.sorte !== 'regle')?.grave ?? a.grave, attente: CONFIRMATIONS[a.cle] ?? 1 }];
  let precedent: Extract<Evenement, { sorte: 'message' }> | null = null;
  let ditGrave: boolean | null = null;
  for (const m of siens) {
    const quoi = m.sorte === 'rappel' && m.grave && ditGrave === false ? 'aggravee' : m.sorte as 'nouveau' | 'rappel' | 'regle';
    if (precedent && !remis(m) && precedent.quoi === quoi && precedent.courriel === m.courriel && precedent.sms === m.sms) {
      precedent.fois++;
      precedent.jusqua = m.le;
      continue;
    }
    precedent = { le: m.le, sorte: 'message', quoi, grave: m.grave, courriel: m.courriel, sms: m.sms, fois: 1, jusqua: m.le };
    e.push(precedent);
    if (remis(m)) {
      precedent = null;
      if (m.sorte !== 'regle') ditGrave = m.grave;
    }
  }
  if (a.prise) e.push({ le: a.prise.le, sorte: 'prise', par: a.prise.par, motif: a.prise.motif });
  if (a.regle) {
    for (const s of lu.sourdines.filter((x) => x.regle === a.regle && Date.parse(x.debut) <= fin && Date.parse(x.leveeLe ?? x.fin) >= debut)) {
      e.push({ le: s.debut, sorte: 'sourdine', par: s.par, motif: s.motif, fin: s.fin });
      if (s.leveeLe && s.leveePar && Date.parse(s.leveeLe) <= fin) e.push({ le: s.leveeLe, sorte: 'sourdine_levee', par: s.leveePar });
    }
  }
  if (a.fin) e.push({ le: a.fin, sorte: 'reglee' });
  return e.sort((x, y) => Date.parse(x.le) - Date.parse(y.le));
}

// ── Les alertes en cours ────────────────────────────────────────────────────────────────────────────────────────────
// Les ouvertes, la plus grave d'abord, puis la plus ancienne : chacune avec ce qu'il faut faire, qui s'en occupe, sa
// sourdine, son prochain rappel et sa chronologie. Le compte de l'onglet « Alertes » est leur nombre, par cette fonction
// seule (C3).
export const ouvertes = (lu: AlertesLues) => lu.alertes.filter((a) => a.fin === null)
  .sort((x, y) => Number(y.grave) - Number(x.grave) || Date.parse(x.debut) - Date.parse(y.debut));
export function enCours(lu: AlertesLues, maintenant: Date) {
  return ouvertes(lu).map((a) => {
    const s = a.regle ? sourdineEnCours(lu, a.regle, maintenant) : null;
    return {
      id: a.id, cle: a.cle, regle: a.regle, brique: briqueDe(a.cle), titre: a.titre, grave: a.grave, debut: a.debut,
      etapes: a.etapes.length ? a.etapes : (a.faire ? [{ texte: a.faire }] : []),
      prise: a.prise, sourdine: s ? { id: s.id, fin: s.finEffective, par: s.par, motif: s.motif } : null,
      prochainRappel: prochainRappel(lu, a), chronologie: chronologie(lu, a, maintenant),
    };
  });
}

// ── Qui est prévenu ─────────────────────────────────────────────────────────────────────────────────────────────────
// Les destinataires, masqués, tels que la veille les a lus à son dernier relevé (réglés sur le serveur, jamais ici), le
// dernier essai et ce qu'il a donné, et l'essai qui attend la veille. `null` : la veille n'a encore rien écrit.
export function prevenus(lu: AlertesLues) {
  const essai = [...lu.envois].reverse().find((e) => e.sorte === 'essai') ?? null;
  const attente = lu.demandes.find((d) => d.faiteLe === null) ?? null;
  return {
    destinataires: lu.releve?.destinataires ?? null,
    releveLe: lu.releve?.minute ?? null,
    dernierEssai: essai ? { le: essai.le, courriel: essai.courriel, sms: essai.sms } : null,
    essaiEnAttente: attente ? { le: attente.le, par: attente.par } : null,
  };
}

// Le rythme des alertes, lu dans la veille elle-même (jamais recopié) : la console le dit tel qu'il est.
export const RYTHME = { minutesService: CONFIRMATIONS.service ?? 1, rappelH: RAPPEL_H, sourdineGraveH: SOURDINE_GRAVE_MAX_H };

// ── Les règles de la veille ─────────────────────────────────────────────────────────────────────────────────────────
// Chaque règle, son état en ce moment (grave ou à regarder si une de ses alertes est ouverte ; pour les deux règles des
// requêtes, ce que la veille a pu lire ; calme sinon — mais rien de vert quand la veille ne relève plus), sa dernière
// alerte (sur tout ce que la base garde) et sa sourdine. Une règle pas branchée le dit.
export type EtatDeRegle = 'grave' | 'attention' | 'calme' | 'trop_peu' | 'non_lu' | 'pas_branchee';
export function regles(lu: AlertesLues, maintenant: Date) {
  const recente = veilleRecente(lu, maintenant);
  return REGLES.map((r) => {
    const siennes = lu.alertes.filter((a) => a.fin === null && a.regle === r.id);
    const derniere = lu.dernieres.filter((x) => regleDe(x.cle) === r.id).sort((x, y) => Date.parse(y.debut) - Date.parse(x.debut))[0] ?? null;
    const luDeLaRegle = lu.releve?.regles?.[r.id] ?? null;
    const etat: EtatDeRegle = !r.branchee ? 'pas_branchee'
      : siennes.some((a) => a.grave) ? 'grave' : siennes.length ? 'attention'
        : !recente ? 'non_lu'
          : luDeLaRegle && (luDeLaRegle.etat === 'trop_peu' || luDeLaRegle.etat === 'non_lu') ? luDeLaRegle.etat : 'calme';
    const s = r.branchee ? sourdineEnCours(lu, r.id, maintenant) : null;
    return {
      id: r.id, brique: r.brique, branchee: r.branchee, seuils: r.seuils, etat,
      ouvertes: siennes.map((a) => ({ id: a.id, titre: a.titre, grave: a.grave })),
      lu: recente ? luDeLaRegle : null,
      derniere, sourdine: s ? { id: s.id, fin: s.finEffective, par: s.par, motif: s.motif } : null,
    };
  });
}
// Les minutes jugées par chaque règle des requêtes : la console le dit à côté du chiffre.
export const MINUTES_JUGEES = { pannes: PANNES_MINUTES, temps: TEMPS_MINUTES };

// ── L'histoire des trente derniers jours ────────────────────────────────────────────────────────────────────────────
// Chaque alerte, la plus récente d'abord : quand, sa règle, sa gravité (celle qu'elle a eue), sa durée, et comment elle
// s'est réglée — seule, après une prise en charge, ou pas encore.
export function histoire(lu: AlertesLues, maintenant: Date) {
  return [...lu.alertes].sort((x, y) => Date.parse(y.debut) - Date.parse(x.debut)).map((a) => ({
    id: a.id, cle: a.cle, regle: a.regle, brique: briqueDe(a.cle), titre: a.titre, grave: a.aEteGrave, debut: a.debut, fin: a.fin,
    minutes: Math.max(0, Math.round(((a.fin ? Date.parse(a.fin) : maintenant.getTime()) - Date.parse(a.debut)) / 60_000)),
    reglee: a.fin === null ? 'en_cours' as const : a.prise ? 'prise' as const : 'seule' as const,
    prise: a.prise,
  }));
}

// ── Au journal ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Un geste du service au journal de la console dit SUR QUOI il porte — la règle mise en sourdine, celle de l'alerte prise
// en charge, l'alerte d'essai — et jusqu'à quand une sourdine devait courir : sans cela, la ligne n'a ni sujet ni effet.
// Ce que la base a gardé du geste (0086 : la règle, ou la clé de l'alerte ; la fin de la sourdine), rien d'autre. Une
// sourdine LEVÉE garde sa fin prévue dans son « avant » (son « après » porte la minute de la levée).
export function sujetDuService(geste: string, avant: Record<string, unknown> | null, apres: Record<string, unknown> | null): { regle: string | null; essai: boolean; fin: string | null } | null {
  if (!geste.startsWith('service.')) return null;
  const regle = typeof apres?.regle === 'string' ? apres.regle : typeof apres?.cle === 'string' ? regleDe(apres.cle) : null;
  return { regle, essai: geste === 'service.essai', fin: date((geste === 'service.sourdine_levee' ? avant : apres)?.fin) };
}
