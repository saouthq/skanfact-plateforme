// Le service (10 § 2.8 ; serveur/console/routes.ts, GET /console/service ; serveur/console/service.ts ; docs/console.md
// C12) : l'écran de la direction et de la technique. Ce que le serveur mesure de lui-même à chaque requête (le temps de
// réponse des listes et des fiches contre son budget, les requêtes, les pannes), et ce que sa veille relève chaque minute
// (le service répond-il, les briques jour par jour, les nuits, la machine). Trois règles :
//   - rien n'est vert sans mesure (C2) : une minute sans relevé, une période sans requête, une veille absente se disent
//     « non mesuré », avec leur raison — jamais un vert, jamais un zéro ;
//   - l'écran ne refait aucun calcul du serveur : les centiles, les parts, l'état des jours et des briques arrivent faits ;
//     il les écrit, les range en graphiques, et les rend lisibles à la souris et au clavier ;
//   - ce que la veille écrit (le titre d'un problème, ce qu'il faut faire, un nom de disque, une version) est une donnée :
//     ses mots s'affichent tels quels, avec la typographie de l'écran (une majuscule en tête d'un titre, un nombre qui
//     reste avec son unité).
// L'écran se relit chaque minute tant que quelqu'un le regarde (la page visible, un geste dans les cinq dernières minutes) :
// laissé ouvert sans personne, il ne tient pas la session de la console éveillée.
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { dire, phrase, selon, titre, typo } from '../langue.ts';
import { useConsole, useLecture, useRelireQuandOnRegarde } from '../contexte.ts';
import { Barres, Bande, Courbe, echelle, Trait, type Abscisse, type Case, type Contenu, type Ton } from '../graphes.tsx';
import { decimal, duree, entier, minutes, pourCent } from '../nombres.ts';
import { dans, heureDe, ilYA, jourCourt, jourMois, quand } from '../temps.ts';
import { nomDeVersion } from '../version.ts';
import { Alerte, Bouton, Icone, Lien, maj, Puce, Vide, type NomIcone, type TonPuce } from '../ui.tsx';

const K = 'console.ecran.service';
export type Periode = '1h' | '24h' | '7j' | '30j';
export const PERIODES: readonly Periode[] = ['1h', '24h', '7j', '30j'];
export const estPeriode = (x: unknown): x is Periode => typeof x === 'string' && (PERIODES as readonly string[]).includes(x);

type Probleme = { cle: string; titre: string; grave: boolean; faire: string; depuis: string };
export type Veille = { etat: 'absente' } | { etat: 'silencieuse'; derniere: string } | { etat: 'ok'; derniere: string; problemes: Probleme[] };
type Point = { debut: string; n: number; pannes: number; parMinute: number; p50: number | null; p95: number | null; sousBudget: number | null; lectures: number };
type Total = { n: number; pannes: number; partPannes: number | null; lectures: number; p50: number | null; p95: number | null; sousBudget: number | null };
export type IdBrique = 'programme' | 'requetes' | 'mises-a-jour' | 'sauvegarde' | 'a-la-minute' | 'hors-machine' | 'restauration' | 'disques' | 'certificat' | 'chaines';
export type EtatBrique = 'bon' | 'attention' | 'grave' | 'nonmesure';
export type Brique = { id: IdBrique; etat: EtatBrique; jours: { jour: string; etat: EtatBrique; alertes: string[] }[]; ouvertes: { titre: string; grave: boolean; faire: string; debut: string }[] };
export type Resultat = { le: string; ok: boolean };
export type Nuit = { jour: string; sauvegarde: Resultat | null; horsMachine: Resultat | null; copieDeBase: Resultat | null; restauration: Resultat | null };
type Etape = 'copieDeBase' | 'sauvegarde' | 'horsMachine' | 'restauration';
type Evenement =
  | { le: string; type: 'alerte'; sorte: 'ouverte' | 'reglee'; titre: string; grave: boolean; brique: IdBrique | null }
  | { le: string; type: 'version'; version: string; retour: boolean }
  | { le: string; type: 'nuit'; jour: string; etapes: { quoi: Etape; ok: boolean }[] };
export type Machine = { minute: string; repond: boolean; charge: number | null; memoire: number | null; processeurs: number | null; disques: { point: string; pourcent: number }[] };
type Donnees = {
  maintenant: string; aujourdhui: string; periode: Periode; budget: number;
  seuils: { pannes: number; disque: { alerte: number; grave: number }; certificat: { alerte: number; grave: number }; lectures: number };
  veille: Veille; depuis: string; pas: number; points: Point[]; resume: { lePlusLent: number | null; auDessusDuBudget: number }; total: Total;
  tuiles: Point[]; total24h: Total; trafic: { parMinute: number; minutes: number };
  disponibilite: { mesurees: number; bas: number; taux: number | null; coupures: number };
  jours: { jour: string; etat: 'bon' | 'perturbe' | 'coupure' | 'nonmesure'; mesurees: number; bas: number; graves: string[] }[];
  coupures: { debut: string; fin: string; minutes: number }[];
  briques: Brique[]; nuits: Nuit[]; exercice: { jour: string; restauration: Resultat } | null;
  journal: Evenement[];
  machine: Machine[]; dernier: { minute: string; version: string | null; certificat: string | null; archiveLe: string | null; regles: LuDesRequetes | null } | null;
  misesEnLigne: { version: string; le: string; retour: boolean }[]; numeros?: Record<string, string>; enLigne: { version: string; depuis: string | null; vueArriver: boolean } | null;
  alertesEnCours: AlertesEnCours;
};
// Ce que la veille a pu lire des requêtes à son dernier relevé (exploitation/veille.ts, `requetes`).
type EtatLu = 'calme' | 'alerte' | 'trop_peu' | 'non_lu';
export type LuDesRequetes = { pannes?: { etat: EtatLu; part: number | null; n: number }; temps?: { etat: EtatLu; p95: number | null; lectures: number } };
// Les alertes ouvertes, et combien sont graves : le compte de l'onglet « Alertes » ; et la plus urgente, que le bandeau
// de chaque vue nomme (serveur/console/service.ts).
export type AlertesEnCours = { n: number; graves: number; cles: string[]; premiere: { titre: string; grave: boolean; debut: string } | null };

// ── Le temps, à l'heure de Tunis ────────────────────────────────────────────────────────────────────────────────────
const PARTIES = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parties(instant: string | number) {
  const p = Object.fromEntries(PARTIES.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { semaine: p.weekday ?? '', jour: p.day ?? '', mois: p.month ?? '', heure: p.hour ?? '', minute: p.minute ?? '' };
}
const hm = (x: ReturnType<typeof parties>) => `${x.heure}:${x.minute}`;
// Un pas d'une série : « lun. 12/10 · 09:20 → 09:30 » (une minute : « lun. 12/10 · 09:20 »).
export function titrePas(debut: string | number, pas: number): string {
  const a = parties(debut);
  const tete = `${a.semaine} ${a.jour}/${a.mois} · ${hm(a)}`;
  return pas <= 60_000 ? tete : `${tete} → ${hm(parties(Number(new Date(debut)) + pas))}`;
}
// Un jour de calendrier : « lun. 12/10 ».
const titreJour = (jour: string) => { const a = parties(`${jour}T12:00:00+01:00`); return `${a.semaine} ${a.jour}/${a.mois}`; };

// Les heures ou les jours nommés sous un graphique : un repère clair par période, jamais un texte sur un autre ; chacun à sa
// place dans la période (de 0 à 1), sous une courbe comme sous des bâtons.
export function abscisses(debuts: readonly string[], periode: Periode): Abscisse[] {
  const res: Abscisse[] = [];
  let avant: ReturnType<typeof parties> | null = null;
  debuts.forEach((debut, i) => {
    const q = parties(debut);
    const nouveauJour = avant !== null && q.jour !== avant.jour;
    let texte: string | null = null;
    if (periode === '1h' && Number(q.minute) % 15 === 0) texte = hm(q);
    else if (periode === '24h' && q.minute === '00' && Number(q.heure) % 4 === 0) texte = hm(q);
    else if (periode === '7j' && nouveauJour) texte = `${q.semaine} ${Number(q.jour)}`;
    else if (periode === '30j' && nouveauJour) texte = `${q.jour}/${q.mois}`;
    if (texte) res.push({ x: (i + 0.5) / debuts.length, texte });
    avant = q;
  });
  // Trente jours : un jour sur sept, en partant du plus récent.
  return periode === '30j' ? res.filter((_, k) => (res.length - 1 - k) % 7 === 0) : res;
}

// ── Les états, leurs mots, leurs couleurs ───────────────────────────────────────────────────────────────────────────
const PUCE: Record<EtatBrique, TonPuce> = { bon: 'actif', attention: 'en_retard', grave: 'urgent', nonmesure: 'hors' };
const ICONE_ETAT: Record<EtatBrique, NomIcone> = { bon: 'ok', attention: 'alerte', grave: 'alerte', nonmesure: 'info' };
const TON_JOUR: Record<Donnees['jours'][number]['etat'], Ton> = { bon: 'bon', perturbe: 'attention', coupure: 'grave', nonmesure: 'nonmesure' };
export const ICONE_BRIQUE: Record<IdBrique, NomIcone> = {
  programme: 'serveur', requetes: 'echange', 'mises-a-jour': 'version', sauvegarde: 'base', 'a-la-minute': 'journal', 'hors-machine': 'nuage',
  restauration: 'retour', disques: 'disque', certificat: 'cadenas', chaines: 'ok',
};
export function EtatPuce({ etat, texte }: { etat: EtatBrique; texte?: string }) {
  return <Puce ton={PUCE[etat]}>{texte ?? dire(`${K}.etat.${etat}`)}</Puce>;
}
// Ce que la veille écrit, à l'écran : ses mots, une majuscule s'il ouvre une ligne, et la typographie de l'écran.
export const enTitre = (s: string) => maj(typo(s));

// ── Se relire tant que quelqu'un regarde ────────────────────────────────────────────────────────────────────────────
// En pause (« Pause » de l'en-tête), l'écran garde sa dernière lecture.
export function useRelireTantQueRegarde(relire: () => void) {
  useRelireQuandOnRegarde(relire, { attendre: () => pause.lire() });
}

// ── L'en-tête : l'état du service en une ligne ──────────────────────────────────────────────────────────────────────
function EtatGeneral({ briques }: { briques: Brique[] }) {
  const n = (e: EtatBrique) => briques.filter((b) => b.etat === e).length;
  const pire: EtatBrique = n('grave') ? 'grave' : n('attention') ? 'attention' : n('bon') ? 'bon' : 'nonmesure';
  const etats = (['grave', 'attention', 'bon', 'nonmesure'] as const).filter((e) => n(e) > 0).map((e) => selon(n(e), `${K}.compte.${e}`));
  return (
    <span className={`c-sv-etat c-sv-etat-${pire}`}>
      <Icone nom={ICONE_ETAT[pire]} taille={16} />{maj(dire(`${K}.compte.resume`, { briques: selon(briques.length, `${K}.compte.briques`), etats: etats.join(' · ') }))}
    </span>
  );
}

// ── En ce moment : ce que la veille voit à l'instant ────────────────────────────────────────────────────────────────
// Une alerte ouverte se dit dans l'en-tête (son bandeau) : ici ne restent que la veille absente ou muette, et ce qu'elle
// voit sans l'avoir encore confirmé en alerte (une clé qu'aucune alerte ouverte ne porte). Tout va bien : rien, l'état
// des briques le dit déjà.
function EnCeMoment({ v, aujourdhui, alertes }: { v: Veille; aujourdhui: string; alertes: AlertesEnCours }) {
  if (v.etat === 'absente' || v.etat === 'silencieuse') {
    const absente = v.etat === 'absente';
    return (
      <section className="c-carte c-sv-moment" aria-labelledby="sv-moment">
        <span className={`c-ligne-icone${absente ? '' : ' c-urgent'}`}><Icone nom={absente ? 'serveur' : 'alerte'} /></span>
        <div className="c-sv-moment-texte">
          <h2 id="sv-moment">{titre(`${K}.${absente ? 'absente_titre' : 'silencieuse_titre'}`)}</h2>
          <p className="c-carte-sous">{absente ? phrase(`${K}.absente`) : phrase(`${K}.silencieuse`, { quand: quand(v.derniere, aujourdhui) })}</p>
        </div>
      </section>
    );
  }
  const restants = v.problemes.filter((p) => !alertes.cles.includes(p.cle));
  if (!restants.length) return null;
  return (
    <section className="c-carte c-decider c-sv-problemes" aria-labelledby="sv-moment">
      <div className="c-carte-tete">
        <div>
          <h2 id="sv-moment">{titre(`${K}.problemes_titre`)} <span className="c-compte-titre">{restants.length}</span></h2>
          <p className="c-carte-sous">{phrase(`${K}.problemes_sous`, { quand: ilYA(v.derniere) })}</p>
        </div>
        {/* Ce qu'il faut faire, qui s'en occupe, ce qui est parti et à qui : la page des alertes. */}
        <Lien href="#/service/alertes" petit fleche>{titre(`${K}.voir_alertes`)}</Lien>
      </div>
      <ul className="c-lignes">
        {restants.map((p) => (
          <li key={p.cle} className="c-ligne-decision c-ligne-sans-action">
            <span className={`c-ligne-icone c-${p.grave ? 'urgent' : 'aujourdhui'}`}><Icone nom="alerte" /></span>
            <div className="c-ligne-texte">
              <span className="c-ligne-titre"><span data-donnee>{enTitre(p.titre)}</span><Puce ton={p.grave ? 'urgent' : 'en_retard'}>{dire(`${K}.${p.grave ? 'grave' : 'a_regarder'}`)}</Puce></span>
              {p.faire ? <span className="c-ligne-desc"><b>{titre(`${K}.a_faire`)}</b>{typo(' : ')}<span data-donnee>{typo(p.faire)}</span></span> : null}
              {p.depuis ? <span className="c-ligne-meta">{phrase(`${K}.depuis`, { quand: quand(p.depuis, aujourdhui) })}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── La disponibilité, 30 jours, et les tuiles des dernières 24 heures ───────────────────────────────────────────────
function Disponibilite({ d }: { d: Donnees }) {
  const { taux, mesurees, bas, coupures } = d.disponibilite;
  const derniere = d.coupures[0];
  const premierJour = d.jours[0]?.jour ?? d.aujourdhui;
  const possibles = Math.max(mesurees, Math.floor((Date.parse(d.maintenant) - Date.parse(`${premierJour}T00:00:00+01:00`)) / 60_000));
  const compte = (e: Donnees['jours'][number]['etat']) => d.jours.filter((j) => j.etat === e).length;
  const cases: Case[] = d.jours.map((j) => ({
    ton: TON_JOUR[j.etat],
    contenu: {
      titre: `${titreJour(j.jour)} · ${dire(`${K}.jour.${j.etat}`)}`,
      lignes: j.etat === 'nonmesure' ? [{ texte: dire(`${K}.jour.nonmesure_detail`) }]
        : [
            ...j.graves.map((g) => ({ texte: g })),
            { texte: j.bas ? dire(`${K}.jour.bas_detail`, { bas: minutes(j.bas), n: entier(j.mesurees) }) : dire(`${K}.jour.bon_detail`, { n: entier(j.mesurees) }) },
          ],
    },
  }));
  const phraseCoupures = taux === null ? phrase(`${K}.dispo.non_mesure_raison`)
    : coupures === 0 || !derniere ? phrase(`${K}.dispo.aucune_coupure`)
      : phrase(`${K}.dispo.${coupures === 1 ? 'une_coupure' : 'coupures'}`, { n: coupures, total: minutes(bas), duree: minutes(derniere.minutes), quand: quand(derniere.debut, d.aujourdhui) });
  return (
    <div className="c-sv-dispo">
      <h2 id="sv-dispo" className="c-tuile-titre">{titre(`${K}.dispo.titre`)}</h2>
      {taux === null ? (
        <p className="c-sv-dispo-chiffre"><span className="c-sv-dispo-mot">{titre(`${K}.dispo.non_mesure`)}</span></p>
      ) : (
        <p className="c-sv-dispo-chiffre"><b>{pourCent(taux, 2)}</b><span>{dire(`${K}.dispo.vue`)}</span></p>
      )}
      <p className="c-sv-dispo-phrase">
        {phraseCoupures}
        {taux !== null ? (
          <span className="c-sv-dispo-couverture">
            {mesurees >= possibles ? phrase(`${K}.dispo.couverture_toute`, { mesurees: entier(mesurees) })
              : phrase(`${K}.dispo.couverture`, { mesurees: entier(mesurees), possibles: entier(possibles) })}
          </span>
        ) : null}
      </p>
      <Bande sombre cases={cases} etiquette={dire(`${K}.dispo.bande`)} />
      <div className="c-sv-axe" aria-hidden="true">
        <span className="c-num">{jourMois(premierJour)}</span>
        <span className="c-num">{jourMois(d.jours[14]?.jour)}</span>
        <span>{dire('console.ecran.temps.aujourdhui')}</span>
      </div>
      <ul className="c-sv-legende" aria-label={dire(`${K}.legende`)}>
        {(['bon', 'perturbe', 'coupure', 'nonmesure'] as const).map((e) => (
          <li key={e}><i className={`c-case-cle c-ton-${TON_JOUR[e]}`} />{titre(`${K}.jour.${e}`)} <b className="c-num">{compte(e)}</b></li>
        ))}
      </ul>
      <p className="c-sv-exterieur"><Icone nom="info" taille={16} /><span><b>{titre(`${K}.exterieur`)}</b> {phrase(`${K}.exterieur_raison`)}</span></p>
    </div>
  );
}

export type PropsTuile = { titre: string; etat?: EtatBrique; valeur: string; unite?: string; mot?: boolean; donnee?: boolean; sous: string; trait?: ReactNode };
export function Tuile({ titre: t, etat, valeur, unite, mot, donnee, sous, trait }: PropsTuile) {
  return (
    <div className="c-sv-tuile">
      <div className="c-sv-tuile-tete"><span className="c-tuile-titre">{t}</span>{etat ? <EtatPuce etat={etat} /> : null}</div>
      <p className={mot ? 'c-sv-tuile-mot' : 'c-sv-tuile-valeur'}>
        <b className={donnee ? 'c-mono' : undefined} {...(donnee ? { 'data-donnee': true } : {})}>{valeur}</b>
        {unite ? <span>{unite}</span> : null}
      </p>
      {trait ?? null}
      <span className="c-tuile-sous">{sous}</span>
    </div>
  );
}

function Tuiles({ d }: { d: Donnees }) {
  const t = d.total24h;
  const budget = duree(d.budget);
  const p95s = d.tuiles.map((p) => p.p95);
  const hautTemps = echelle(Math.max(d.budget * 1.3, Math.min(d.budget * 4, ...p95s.map((v) => v ?? 0)))).haut;
  const parts = d.tuiles.map((p) => (p.n ? (p.pannes / p.n) * 100 : null));
  const hautPannes = echelle(Math.max(d.seuils.pannes * 150, ...parts.map((v) => v ?? 0))).haut;
  const temps = t.p95 === null
    ? <Tuile titre={titre(`${K}.tuile.temps`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot
        sous={t.lectures ? phrase(`${K}.tuile.temps_peu`, { n: entier(t.lectures), min: d.seuils.lectures }) : phrase(`${K}.tuile.temps_non`)} />
    : <Tuile titre={titre(`${K}.tuile.temps`)} etat={t.p95 <= d.budget ? 'bon' : 'attention'} valeur={Number.isFinite(t.p95) ? entier(t.p95 < 1000 ? t.p95 : t.p95 / 1000) : '> 60'}
        unite={dire(`${K}.unite.${t.p95 < 1000 ? 'ms' : 's'}`)} sous={dire(`${K}.tuile.temps_sous`, { budget })}
        trait={<Trait valeurs={p95s} haut={hautTemps} seuil={d.budget} />} />;
  const pannes = t.partPannes === null
    ? <Tuile titre={titre(`${K}.tuile.pannes`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={phrase(`${K}.tuile.pannes_non`)} />
    : <Tuile titre={titre(`${K}.tuile.pannes`)} etat={t.partPannes > d.seuils.pannes ? 'grave' : 'bon'} valeur={pourCent(t.partPannes, 2)} unite={dire(`${K}.unite.des_requetes`)}
        sous={selon(t.pannes, `${K}.tuile.pannes_sous`, { total: entier(t.n), seuil: pourCent(d.seuils.pannes, 0) })}
        trait={<Trait valeurs={parts} haut={hautPannes} seuil={d.seuils.pannes * 100} />} />;
  const enLigne = d.enLigne;
  const mises = selon(d.misesEnLigne.length, `${K}.tuile.mises`);
  const version = enLigne
    ? <Tuile titre={titre(`${K}.tuile.version`)} valeur={nomDeVersion(enLigne.version, d.numeros)} donnee
        sous={`${enLigne.depuis ? dire(`${K}.tuile.${enLigne.vueArriver ? 'version_depuis' : 'version_deja'}`, { quand: quand(enLigne.depuis, d.aujourdhui) }) : dire(`${K}.tuile.version_avant`)} · ${mises}`} />
    : <Tuile titre={titre(`${K}.tuile.version`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={phrase(`${K}.tuile.version_non`)} />;
  return (
    <div className="c-sv-tuiles-zone">
      <h2 className="c-tuile-titre c-sv-tuiles-titre">{titre(`${K}.tuile.titre`)}</h2>
      <div className="c-sv-tuiles">
        {temps}
        <Tuile titre={titre(`${K}.tuile.requetes`)} valeur={entier(t.n)} unite={dire(`${K}.unite.en_24h`)}
          sous={dire(`${K}.tuile.requetes_sous`, { n: decimal(t.n / 1440, 1) })} trait={<Trait valeurs={d.tuiles.map((p) => p.n)} haut={echelle(Math.max(1, ...d.tuiles.map((p) => p.n))).haut} />} />
        {pannes}
        {version}
      </div>
    </div>
  );
}

// ── Les requêtes de la période : le temps de réponse, le trafic, les pannes ─────────────────────────────────────────
// Les mises en ligne et les coupures de la période, posées sur les pas de la série.
function reperes(d: Donnees) {
  const n = d.points.length;
  const pasDe = (iso: string) => Math.floor((Date.parse(iso) - Date.parse(d.depuis)) / d.pas);
  // Un repère par pas, et dans la bulle chaque mise en ligne de ce pas DANS L'ORDRE DU TEMPS : « 564718c », puis « retour à
  // c7b2e91 » — la version qui a cassé, puis celle qu'on a remise. L'étiquette nomme la première, et dit qu'il y en a d'autres.
  const parPas = new Map<number, { version: string; retour: boolean }[]>();
  for (const m of [...d.misesEnLigne].sort((a, b) => Date.parse(a.le) - Date.parse(b.le))) {
    const i = pasDe(m.le);
    if (i < 0 || i >= n) continue;
    parPas.set(i, [...(parPas.get(i) ?? []), { version: nomDeVersion(m.version, d.numeros), retour: m.retour }]);
  }
  const marques: { i: number; texte: string; versions: { version: string; retour: boolean }[] }[] = [];
  for (const [i, versions] of [...parPas].sort((a, b) => b[0] - a[0])) {
    // Deux étiquettes trop proches se cachent l'une l'autre : la plus récente garde la sienne.
    const libre = marques.every((x) => !x.texte || Math.abs(x.i - i) / n > 0.12);
    const premiere = versions[0]?.version ?? '';
    marques.push({ i, versions, texte: !libre ? '' : versions.length > 1 ? `${premiere} +${versions.length - 1}` : premiere });
  }
  const plages = d.coupures
    .map((c) => ({ de: Math.max(0, pasDe(c.debut)), a: Math.min(n - 1, pasDe(c.fin)), minutes: c.minutes }))
    .filter((p) => p.a >= 0 && p.de <= n - 1 && p.de <= p.a);
  return { marques, plages };
}

function TempsDeReponse({ d, periodeTexte }: { d: Donnees; periodeTexte: string }) {
  const [chiffres, setChiffres] = useState(false);
  const { marques, plages } = useMemo(() => reperes(d), [d]);
  const p95 = d.points.map((p) => p.p95);
  const max = Math.max(d.budget * 1.3, Math.min(d.budget * 4, ...p95.map((v) => v ?? 0)));
  const { haut, graduations } = echelle(max);
  const budget = duree(d.budget);
  // Les pas qui ont des lectures, mais trop peu pour un centile : sans courbe, un trait hachuré au pied le dit.
  const peu = d.points.map((p) => p.lectures > 0 && p.p95 === null);
  const bulle = (i: number): Contenu => {
    const p = d.points[i];
    if (!p) return { titre: '', lignes: [] };
    const lignes: Contenu['lignes'] = p.p95 === null
      ? p.lectures ? [{ texte: dire(`${K}.bulle.lectures`), valeur: entier(p.lectures) }, { texte: dire(`${K}.bulle.peu`, { min: d.seuils.lectures }) }]
        : [{ texte: dire(`${K}.bulle.sans_lecture`) }]
      : [
          { cle: 'p95', texte: dire(`${K}.bulle.p95`), valeur: duree(p.p95) },
          ...(p.p50 === null ? [] : [{ cle: 'p50', texte: dire(`${K}.bulle.p50`), valeur: duree(p.p50) }]),
          ...(p.sousBudget === null ? [] : [{ texte: dire(`${K}.bulle.sous_budget`), valeur: pourCent(p.sousBudget, 1) }]),
        ];
    lignes.push({ texte: dire(`${K}.bulle.requetes`), valeur: entier(p.n) }, { texte: dire(`${K}.bulle.pannes`), valeur: entier(p.pannes) });
    for (const m of marques.filter((x) => x.i === i)) for (const v of m.versions) lignes.push({ texte: dire(`${K}.bulle.${v.retour ? 'retour' : 'mise_en_ligne'}`), valeur: v.version });
    for (const c of plages.filter((x) => x.de <= i && i <= x.a)) lignes.push({ texte: dire(`${K}.bulle.coupure`), valeur: minutes(c.minutes) });
    return { titre: titrePas(p.debut, d.pas), lignes };
  };
  const t = d.total;
  const auDessus = d.resume.auDessusDuBudget;
  return (
    <article className="c-carte c-sv-graphe" aria-labelledby="sv-temps">
      <div className="c-sv-graphe-tete">
        <div>
          <h3 id="sv-temps">{titre(`${K}.temps.titre`)}</h3>
          <p className="c-carte-sous">{maj(dire(`${K}.temps.sous`, { periode: periodeTexte }))}</p>
        </div>
        <ul className="c-sv-cles" aria-label={dire(`${K}.legende`)}>
          <li><i className="c-cle c-cle-p95" />{titre(`${K}.temps.p95`)}</li>
          <li><i className="c-cle c-cle-p50" />{titre(`${K}.temps.p50`)}</li>
          <li><i className="c-cle c-cle-seuil" />{titre(`${K}.temps.budget`, { budget })}</li>
          {peu.some(Boolean) ? <li><i className="c-cle-peu" />{titre(`${K}.temps.peu`, { min: d.seuils.lectures })}</li> : null}
        </ul>
      </div>
      {t.lectures === 0 ? (
        <Vide icone="info">{phrase(`${K}.temps.vide`)}</Vide>
      ) : (
        <Courbe series={[{ cle: 'p95', valeurs: p95 }, { cle: 'p50', valeurs: d.points.map((p) => p.p50) }]} haut={haut} aire hauteur={240}
          graduations={graduations.map((v) => ({ valeur: v, texte: v === 0 ? '' : duree(v) }))} seuil={{ valeur: d.budget, texte: dire(`${K}.temps.budget`, { budget }) }}
          abscisses={abscisses(d.points.map((p) => p.debut), d.periode)} marques={marques} plages={plages} peu={peu}
          etiquette={dire(`${K}.temps.etiquette`, { periode: periodeTexte })} bulle={bulle} />
      )}
      <div className="c-sv-graphe-pied">
        {t.p95 !== null && t.sousBudget !== null ? (
          <p>
            {phrase(`${K}.temps.resume`, { centile: duree(t.p95), sous: pourCent(t.sousBudget, 1) })}
            {d.resume.lePlusLent !== null ? ` ${auDessus === 0 ? phrase(`${K}.temps.jamais_au_dessus`)
              : phrase(`${K}.temps.au_dessus`, { duree: minutes((auDessus * d.pas) / 60_000), lent: duree(d.resume.lePlusLent) })}` : ''}
          </p>
        ) : t.lectures > 0 ? <p>{phrase(`${K}.temps.trop_peu`, { n: entier(t.lectures), min: d.seuils.lectures })}</p> : <span />}
        {t.n > 0 ? <Bouton petit ton="discret" onClick={() => setChiffres(!chiffres)}>{titre(`${K}.chiffres.${chiffres ? 'cacher' : 'montrer'}`)}</Bouton> : null}
      </div>
      {chiffres ? <Chiffres d={d} /> : null}
    </article>
  );
}

// Les chiffres de la période, pas à pas : ce qui s'est passé, le plus récent en haut.
function Chiffres({ d }: { d: Donnees }) {
  const lignes = d.points.filter((p) => p.n > 0).reverse();
  return (
    <div className="c-defile c-sv-chiffres" tabIndex={0} role="region" aria-label={dire(`${K}.chiffres.etiquette`)}>
      <table className="c-table">
        <thead>
          <tr>
            <th scope="col">{titre(`${K}.chiffres.quand`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.bulle.p95`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.bulle.p50`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.bulle.sous_budget`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.bulle.requetes`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.bulle.pannes`)}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((p) => (
            <tr key={p.debut}>
              <td className="c-mono" data-donnee>{titrePas(p.debut, d.pas)}</td>
              <td className="c-droite c-mono">{p.p95 === null ? '—' : duree(p.p95)}</td>
              <td className="c-droite c-mono">{p.p50 === null ? '—' : duree(p.p50)}</td>
              <td className="c-droite c-mono">{p.sousBudget === null ? '—' : pourCent(p.sousBudget, 1)}</td>
              <td className="c-droite c-mono">{entier(p.n)}</td>
              <td className={`c-droite c-mono${p.pannes ? ' c-sv-rouge' : ''}`}>{entier(p.pannes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Les pannes, regroupées en une trentaine de barres au plus : une heure, six heures ou un jour par barre.
const GROUPE: Record<Periode, number> = { '1h': 5, '24h': 6, '7j': 6, '30j': 4 };
function TraficEtPannes({ d, periodeTexte }: { d: Donnees; periodeTexte: string }) {
  const trafic = d.points.map((p) => p.parMinute);
  const { haut, graduations } = echelle(Math.max(1, ...trafic), 2);
  const g = GROUPE[d.periode];
  const groupes = Array.from({ length: Math.ceil(d.points.length / g) }, (_, k) => d.points.slice(k * g, k * g + g));
  const parts = groupes.map((x) => { const n = x.reduce((s, p) => s + p.n, 0); return n ? (x.reduce((s, p) => s + p.pannes, 0) / n) * 100 : null; });
  const seuil = d.seuils.pannes * 100;
  const hautPannes = echelle(Math.max(seuil * 1.5, ...parts.map((v) => v ?? 0)), 3).haut;
  const part = d.total.partPannes;
  const bulleTrafic = (i: number): Contenu => {
    const p = d.points[i];
    return p ? { titre: titrePas(p.debut, d.pas), lignes: [{ cle: 'trafic', texte: dire(`${K}.bulle.par_minute`), valeur: decimal(p.parMinute, 1) }, { texte: dire(`${K}.bulle.requetes`), valeur: entier(p.n) }] } : { titre: '', lignes: [] };
  };
  const bullePannes = (i: number): Contenu => {
    const x = groupes[i] ?? [];
    const premier = x[0];
    const n = x.reduce((s, p) => s + p.n, 0), pannes = x.reduce((s, p) => s + p.pannes, 0);
    return {
      titre: premier ? titrePas(premier.debut, d.pas * x.length) : '',
      lignes: n ? [{ texte: dire(`${K}.bulle.pannes`), valeur: dire(`${K}.bulle.sur`, { a: entier(pannes), b: entier(n) }) }, { texte: dire(`${K}.bulle.part`), valeur: pourCent(pannes / n, 2) }]
        : [{ texte: dire(`${K}.bulle.aucune_requete`) }],
    };
  };
  return (
    <article className="c-carte c-sv-graphe" aria-label={dire(`${K}.trafic.etiquette_carte`)}>
      <div className="c-sv-graphe-tete">
        <div>
          <h3>{titre(`${K}.trafic.titre`)}</h3>
          <p className="c-carte-sous">{maj(periodeTexte)}</p>
        </div>
        <p className="c-sv-gros"><b>{d.trafic.minutes ? decimal(d.trafic.parMinute, 1) : '—'}</b><span>{dire(`${K}.trafic.derniere_heure`)}</span></p>
      </div>
      <Courbe series={[{ cle: 'trafic', valeurs: trafic }]} haut={haut} aire hauteur={112}
        graduations={graduations.map((v) => ({ valeur: v, texte: v === 0 ? '' : decimal(v, v < 10 && v % 1 ? 1 : 0) }))}
        etiquette={dire(`${K}.trafic.etiquette`, { periode: periodeTexte })} bulle={bulleTrafic} />
      <div className="c-sv-separe" />
      <div className="c-sv-graphe-tete">
        <div>
          <h3>{titre(`${K}.pannes.titre`)}</h3>
          <p className="c-carte-sous">{part === null ? phrase(`${K}.pannes.sans_requete`) : dire(`${K}.pannes.sous`, { part: pourCent(part, 2) })}</p>
        </div>
        {/* Sans requête, rien à juger : la phrase le dit, aucune pastille ne le redit. La période est celle de la carte. */}
        {part === null ? null
          : <EtatPuce etat={part > d.seuils.pannes ? 'grave' : 'bon'} texte={dire(`${K}.pannes.${part > d.seuils.pannes ? 'au_dessus' : 'sous_le_seuil'}`)} />}
      </div>
      {/* Une seule ligne du temps, sous les bâtons : la courbe du dessus couvre la même période, alignée sur la même marge. */}
      <Barres valeurs={parts} haut={hautPannes} seuil={{ valeur: seuil, texte: dire(`${K}.pannes.seuil`, { seuil: pourCent(d.seuils.pannes, 0) }) }} hauteur={92}
        etiquette={dire(`${K}.pannes.etiquette`, { periode: periodeTexte })} bulle={bullePannes} abscisses={abscisses(d.points.map((p) => p.debut), d.periode)} />
      <p className="c-sv-note">{phrase(`${K}.pannes.note`)}</p>
    </article>
  );
}

// ── Les briques du service, jour par jour ───────────────────────────────────────────────────────────────────────────
// Ce que la veille a relevé de chaque règle, en une phrase : la vue d'ensemble le dit sous chaque brique, la page des
// alertes dans la colonne « en ce moment » de chaque règle — une seule fonction pour les deux (C3). Rien de relevé : null,
// et l'appelant dit ce que la règle surveille.
export type Faits = {
  aujourdhui: string; dernier: Donnees['dernier']; nuit: Nuit | null; exercice: Donnees['exercice']; machine: Machine | null;
  jour: { mesurees: number; bas: number } | null;
};
export function faitDeRegle(regle: string, f: Faits): { texte: string; donnee?: boolean } | null {
  const nuit = f.nuit;
  const reussi = (r: Resultat) => dire(`${K}.fait.derniere_${r.ok ? 'ok' : 'echec'}`, { quand: quand(r.le, f.aujourdhui) });
  switch (regle) {
    case 'service':
      return f.jour && f.jour.mesurees ? { texte: dire(`${K}.fait.programme`, { ok: entier(f.jour.mesurees - f.jour.bas), n: entier(f.jour.mesurees) }) } : null;
    case 'requetes': {
      // Ce que la veille a pu juger à son dernier relevé : les pannes sur leurs minutes, le 95e centile des listes et des
      // fiches. La nuit, trop peu de requêtes : elle le dit, sans chiffre.
      const r = f.dernier?.regles;
      const juge = (e: EtatLu | undefined) => e === 'calme' || e === 'alerte';
      const part = juge(r?.pannes?.etat) ? r?.pannes?.part ?? null : null;
      const p95 = juge(r?.temps?.etat) ? r?.temps?.p95 ?? null : null;
      if (part !== null && p95 !== null) return { texte: dire(`${K}.fait.requetes`, { pannes: pourCent(part, 1), duree: duree(p95) }) };
      if (part !== null) return { texte: dire(`${K}.fait.requetes_pannes`, { pannes: pourCent(part, 1) }) };
      return r?.pannes || r?.temps ? { texte: dire(`${K}.fait.requetes_peu`) } : null;
    }
    case 'sauvegarde': return nuit?.sauvegarde ? { texte: reussi(nuit.sauvegarde) } : null;
    case 'copie-de-base': return nuit?.copieDeBase ? { texte: reussi(nuit.copieDeBase) } : null;
    case 'archivage': return f.dernier?.archiveLe ? { texte: dire(`${K}.fait.archive`, { quand: quand(f.dernier.archiveLe, f.aujourdhui) }) } : null;
    case 'hors-machine': return nuit?.horsMachine ? { texte: dire(`${K}.fait.hors_${nuit.horsMachine.ok ? 'ok' : 'retard'}`, { jour: jourCourt(nuit.jour) }) } : null;
    case 'restauration': return f.exercice ? { texte: dire(`${K}.fait.exercice_${f.exercice.restauration.ok ? 'ok' : 'echec'}`, { jour: jourCourt(f.exercice.jour) }) } : null;
    case 'disques': return f.machine?.disques.length ? { texte: f.machine.disques.map((x) => `${x.point} ${pourCent(x.pourcent / 100, 0)}`).join(' · '), donnee: true } : null;
    case 'certificat': return f.dernier?.certificat ? { texte: dire(`${K}.fait.certificat`, { jour: jourCourt(f.dernier.certificat), dans: dans(f.dernier.certificat, f.aujourdhui) }) } : null;
    default: return null;
  }
}
// La règle qui dit le fait de chaque brique (une brique en couvre parfois plusieurs : la première parle pour elle).
const REGLE_DE_LA_BRIQUE: Partial<Record<IdBrique, string>> = {
  programme: 'service', requetes: 'requetes', sauvegarde: 'sauvegarde', 'a-la-minute': 'archivage', 'hors-machine': 'hors-machine',
  restauration: 'restauration', disques: 'disques', certificat: 'certificat', chaines: 'chaine',
};
const faitsDe = (d: Donnees): Faits => ({
  aujourdhui: d.aujourdhui, dernier: d.dernier, nuit: d.nuits[0] ?? null, exercice: d.exercice, machine: d.machine.at(-1) ?? null, jour: d.jours.at(-1) ?? null,
});
// Ce que chaque brique dit d'elle-même aujourd'hui : son alerte ouverte, sinon un fait relevé, sinon ce qu'elle surveille.
function faitDe(b: Brique, d: Donnees): { texte: string; donnee?: boolean } {
  const ouverte = b.ouvertes[0];
  if (ouverte) return { texte: ouverte.titre, donnee: true };
  const regle = REGLE_DE_LA_BRIQUE[b.id];
  return (regle ? faitDeRegle(regle, faitsDe(d)) : null) ?? { texte: dire(`${K}.brique.${b.id}.quoi`) };
}

function Briques({ d }: { d: Donnees }) {
  const legende = (['bon', 'attention', 'grave', 'nonmesure'] as const);
  return (
    <section className="c-carte c-sv-briques" aria-labelledby="sv-briques">
      <div className="c-carte-tete">
        <div>
          <h2 id="sv-briques">{titre(`${K}.briques.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.briques.sous`)}</p>
        </div>
        <ul className="c-sv-legende c-sv-legende-claire" aria-label={dire(`${K}.legende`)}>
          {legende.map((e) => <li key={e}><i className={`c-case-cle c-ton-${e}`} />{titre(`${K}.etat.${e}`)}</li>)}
        </ul>
      </div>
      <ul className="c-sv-briques-liste">
        {d.briques.map((b) => {
          const fait = faitDe(b, d);
          const nom = dire(`${K}.brique.${b.id}.nom`);
          const cases: Case[] = b.jours.map((j) => ({
            ton: j.etat,
            contenu: { titre: `${titreJour(j.jour)} · ${dire(`${K}.etat.${j.etat}`)}`, lignes: j.alertes.length ? j.alertes.map((a) => ({ texte: a })) : [{ texte: dire(`${K}.brique.jour_${j.etat === 'nonmesure' ? 'non' : 'bon'}`) }] },
          }));
          return (
            <li key={b.id} className="c-sv-brique">
              <span className={`c-sv-brique-icone c-ton-${b.etat}`}><Icone nom={ICONE_BRIQUE[b.id]} /></span>
              <div className="c-sv-brique-texte">
                <b>{maj(nom)}</b>
                <span className="c-sous" {...(fait.donnee ? { 'data-donnee': true } : {})}>{enTitre(fait.texte)}</span>
              </div>
              <Bande petite cases={cases} etiquette={dire(`${K}.briques.bande`, { nom })} />
              <span className="c-sv-brique-etat"><EtatPuce etat={b.etat} /></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Les nuits, ce qui vient de se passer, la machine ────────────────────────────────────────────────────────────────
function Sauvegardes({ d }: { d: Donnees }) {
  const mesure = new Set(d.jours.filter((j) => j.mesurees > 0).map((j) => j.jour));
  const jours = d.jours.slice(-14).map((j) => j.jour);
  const nuit = (jour: string) => d.nuits.find((x) => x.jour === jour);
  const pasVue = (jour: string): Ton => (jour === d.aujourdhui || !mesure.has(jour) ? 'nonmesure' : 'attention');
  // Une nuit où la sauvegarde a échoué n'avait rien à envoyer hors de la machine : sa copie est sans objet, ni bonne ni
  // mauvaise — la sauvegarde, elle, se dit en échec.
  const sansObjet = (jour: string) => nuit(jour)?.sauvegarde?.ok === false;
  const motDe = (r: Resultat | null | undefined, jour: string, quoi: 'sauvegarde' | 'hors') =>
    quoi === 'hors' && sansObjet(jour) ? dire(`${K}.nuit.sans_objet`)
      : r ? (quoi === 'hors' ? dire(`${K}.nuit.hors_${r.ok ? 'ok' : 'echec'}`, { quand: quand(r.le, d.aujourdhui) }) : dire(`${K}.nuit.sauvegarde_${r.ok ? 'ok' : 'echec'}`, { heure: heureDe(r.le) }))
        : dire(`${K}.nuit.${pasVue(jour) === 'attention' ? 'pas_vue' : 'non_relevee'}`);
  const cases = (quoi: 'sauvegarde' | 'hors'): Case[] => jours.map((jour) => {
    const x = nuit(jour);
    const r = quoi === 'sauvegarde' ? x?.sauvegarde : x?.horsMachine;
    const ton: Ton = quoi === 'hors' && sansObjet(jour) ? 'sansobjet' : r ? (r.ok ? 'bon' : 'grave') : quoi === 'hors' && x?.sauvegarde ? 'nonmesure' : pasVue(jour);
    return { ton, contenu: { titre: titreJour(jour), lignes: [{ texte: dire(`${K}.nuit.${quoi}`), valeur: motDe(r, jour, quoi) }] } };
  });
  const relevees = jours.filter((j) => nuit(j) || (mesure.has(j) && j !== d.aujourdhui));
  const faites = jours.filter((j) => nuit(j)?.sauvegarde?.ok).length;
  // Une copie n'arrive que d'une sauvegarde faite : on ne compte pas l'arrivée de rien.
  const arrivees = jours.filter((j) => nuit(j)?.sauvegarde?.ok && nuit(j)?.horsMachine?.ok).length;
  return (
    <section className="c-carte c-sv-bas-carte" aria-labelledby="sv-nuits">
      <h2 id="sv-nuits">{titre(`${K}.nuits.titre`)}</h2>
      <p className="c-carte-sous">{phrase(`${K}.nuits.sous`)}</p>
      <div className="c-sv-nuits">
        <span className="c-sv-nuits-nom">{titre(`${K}.nuit.sauvegarde`)}</span>
        <Bande petite cases={cases('sauvegarde')} etiquette={dire(`${K}.nuits.bande_sauvegarde`)} />
        <span className="c-sv-nuits-nom">{titre(`${K}.nuit.hors`)}</span>
        <Bande petite cases={cases('hors')} etiquette={dire(`${K}.nuits.bande_hors`)} />
        <span />
        <div className="c-sv-nuits-axe" aria-hidden="true">
          <span className="c-num">{jourMois(jours[0])}</span>
          <span>{dire('console.ecran.temps.aujourdhui')}</span>
        </div>
      </div>
      <ul className="c-sv-legende c-sv-legende-claire" aria-label={dire(`${K}.legende`)}>
        <li><i className="c-case-cle c-ton-bon" />{titre(`${K}.nuits.faite`)}</li>
        <li><i className="c-case-cle c-ton-grave" />{titre(`${K}.nuits.echec`)}</li>
        <li><i className="c-case-cle c-ton-attention" />{titre(`${K}.nuits.pas_vue`)}</li>
        <li><i className="c-case-cle c-ton-nonmesure" />{titre(`${K}.etat.nonmesure`)}</li>
        {jours.some(sansObjet) ? <li><i className="c-case-cle c-ton-sansobjet" />{titre(`${K}.nuits.sans_objet`)}</li> : null}
      </ul>
      <p className="c-sv-nuits-resume">
        {relevees.length ? phrase(`${K}.nuits.${faites ? 'resume' : 'resume_sans'}`, { faites: selon(faites, `${K}.nuits.faites`), arrivees: selon(arrivees, `${K}.nuits.arrivees`), n: selon(relevees.length, `${K}.nuits.relevees`) })
          : phrase(`${K}.nuits.aucune`)}
      </p>
    </section>
  );
}

// Une nuit se nomme par ses deux jours, comme on le dit : « nuit du 12 au 13/10 », « nuit du 30/09 au 01/10 ».
function nuitDu(jour: string): { veille: string; jour: string } {
  const [a = '', m = '', j = ''] = jour.split('-');
  const avant = new Date(Date.UTC(Number(a), Number(m) - 1, Number(j)) - 86_400_000);
  const mAvant = String(avant.getUTCMonth() + 1).padStart(2, '0'), jAvant = String(avant.getUTCDate()).padStart(2, '0');
  return { veille: mAvant === m ? String(Number(jAvant)) : `${jAvant}/${mAvant}`, jour: `${j}/${m}` };
}
// Ce qui vient de se passer : une ligne par fait, le plus récent en haut ; les filtres disent combien chacun en compte.
const FILTRES = ['tout', 'alerte', 'version', 'nuit'] as const;
type Filtre = (typeof FILTRES)[number];
function LigneEvenement({ e, d }: { e: Evenement; d: Donnees }) {
  const quandEtQuoi = (suite: string) => <span className="c-sous">{quand(e.le, d.aujourdhui)}{suite}</span>;
  if (e.type === 'alerte') {
    return (
      <li>
        <span className={`c-sv-evt-icone c-ton-${e.sorte === 'reglee' ? 'bon' : e.grave ? 'grave' : 'attention'}`}><Icone nom={e.sorte === 'reglee' ? 'ok' : 'alerte'} taille={15} /></span>
        <div className="c-sv-evt-texte">
          <span className="c-sv-evt-quoi"><b>{titre(`${K}.journal.${e.sorte}`)}</b> <span data-donnee>{typo(e.titre)}</span></span>
          {quandEtQuoi(e.brique ? ` · ${dire(`${K}.brique.${e.brique}.nom`)}` : '')}
        </div>
      </li>
    );
  }
  if (e.type === 'version') {
    return (
      <li>
        <span className="c-sv-evt-icone c-ton-bon"><Icone nom={e.retour ? 'retour' : 'version'} taille={15} /></span>
        <div className="c-sv-evt-texte">
          <span className="c-sv-evt-quoi"><b>{titre(`${K}.journal.${e.retour ? 'retour' : 'version'}`)}</b> <span className="c-mono" data-donnee>{nomDeVersion(e.version, d.numeros)}</span></span>
          {quandEtQuoi('')}
        </div>
      </li>
    );
  }
  // Une nuit en une ligne : chaque étape dans l'ordre où elle s'est faite ; un échec se dit en rouge, et colore l'icône.
  const rate = e.etapes.some((x) => !x.ok);
  return (
    <li>
      <span className={`c-sv-evt-icone c-ton-${rate ? 'grave' : 'bon'}`}><Icone nom="base" taille={15} /></span>
      <div className="c-sv-evt-texte">
        <span className="c-sv-evt-quoi">
          <b>{titre(`${K}.journal.nuit`, nuitDu(e.jour))}</b>{' '}
          {e.etapes.map((x, k) => (
            <Fragment key={x.quoi}>{k ? ' · ' : ''}<span className={x.ok ? undefined : 'c-sv-evt-echec'}>{dire(`${K}.journal.${x.quoi}_${x.ok ? 'ok' : 'echec'}`)}</span></Fragment>
          ))}
        </span>
        {quandEtQuoi('')}
      </div>
    </li>
  );
}
function Evenements({ d }: { d: Donnees }) {
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [tout, setTout] = useState(false);
  const choisis = filtre === 'tout' ? d.journal : d.journal.filter((e) => e.type === filtre);
  const montres = tout ? choisis : choisis.slice(0, 6);
  const absente = d.veille.etat === 'absente';
  return (
    <section className="c-carte c-sv-bas-carte" aria-labelledby="sv-journal">
      <h2 id="sv-journal">{titre(`${K}.journal.titre`)}</h2>
      <p className="c-carte-sous">{phrase(`${K}.journal.sous`)}</p>
      {d.journal.length === 0 ? (
        <Vide icone={absente ? 'info' : 'ok'}>{phrase(`${K}.journal.${absente ? 'non_mesure' : 'vide_tout'}`)}</Vide>
      ) : (
        <>
          <div className="c-pilules c-sv-filtres" role="group" aria-label={dire(`${K}.journal.filtres`)}>
            {FILTRES.map((f) => (
              <button key={f} type="button" className="c-pilule" aria-pressed={filtre === f} onClick={() => { setFiltre(f); setTout(false); }}>
                {titre(`${K}.journal.filtre.${f}`)}
                <span className="c-pilule-n">{entier(f === 'tout' ? d.journal.length : d.journal.filter((e) => e.type === f).length)}</span>
              </button>
            ))}
          </div>
          {choisis.length === 0 ? <Vide icone="ok">{phrase(`${K}.journal.vide_${filtre}`)}</Vide> : (
            <ol className="c-sv-evenements">
              {montres.map((e, k) => <LigneEvenement key={`${e.le}-${e.type}-${k}`} e={e} d={d} />)}
            </ol>
          )}
          {choisis.length > 6 ? <Bouton petit ton="discret" onClick={() => setTout(!tout)}>{tout ? titre(`${K}.journal.moins`) : titre(`${K}.journal.plus`, { n: choisis.length - 6 })}</Bouton> : null}
        </>
      )}
    </section>
  );
}

function LaMachine({ d }: { d: Donnees }) {
  const m = d.machine.at(-1);
  const charge = (x: Machine) => (x.charge !== null && x.processeurs ? (x.charge / x.processeurs) * 100 : null);
  const max = (f: (x: Machine) => number | null) => Math.max(...d.machine.map(f).map((v) => v ?? 0));
  const lignes: { cle: string; nom: string; valeur: number; auPlus: number; sous: string; seuils?: { alerte: number; grave: number }; donnee?: boolean }[] = [];
  if (m) {
    const c = charge(m);
    if (c !== null && m.charge !== null && m.processeurs) lignes.push({ cle: 'charge', nom: titre(`${K}.machine.charge`), valeur: c, auPlus: max(charge), sous: dire(`${K}.machine.charge_sous`, { charge: decimal(m.charge, 2), n: m.processeurs }) });
    if (m.memoire !== null) lignes.push({ cle: 'memoire', nom: titre(`${K}.machine.memoire`), valeur: m.memoire, auPlus: max((x) => x.memoire), sous: dire(`${K}.machine.memoire_sous`) });
    for (const disque of m.disques) {
      lignes.push({
        cle: `disque:${disque.point}`, nom: disque.point, donnee: true, valeur: disque.pourcent, seuils: d.seuils.disque,
        auPlus: max((x) => x.disques.find((y) => y.point === disque.point)?.pourcent ?? null),
        sous: dire(`${K}.machine.disque_sous`, { alerte: pourCent(d.seuils.disque.alerte / 100, 0), grave: pourCent(d.seuils.disque.grave / 100, 0) }),
      });
    }
  }
  return (
    <section className="c-carte c-sv-bas-carte" aria-labelledby="sv-machine">
      <h2 id="sv-machine">{titre(`${K}.machine.titre`)}</h2>
      <p className="c-carte-sous">{m ? phrase(`${K}.machine.sous`, { quand: quand(m.minute, d.aujourdhui) }) : phrase(`${K}.machine.sous_vide`)}</p>
      {lignes.length === 0 ? (
        <Vide icone="info">{phrase(`${K}.machine.vide`)}</Vide>
      ) : (
        <ul className="c-sv-jauges">
          {lignes.map((l) => {
            const etat = l.seuils ? (l.valeur >= l.seuils.grave ? 'grave' : l.valeur >= l.seuils.alerte ? 'attention' : 'bon') : 'bon';
            return (
              <li key={l.cle}>
                <div className="c-sv-jauge-tete">
                  <span {...(l.donnee ? { 'data-donnee': true, className: 'c-mono' } : {})}>{l.nom}</span>
                  <b className="c-num">{pourCent(Math.min(l.valeur, 999) / 100, 0)}</b>
                </div>
                <span className={`c-sv-jauge c-ton-${etat}`} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, l.valeur)}%` }} />
                  {l.seuils ? <i style={{ insetInlineStart: `${l.seuils.alerte}%` }} /> : null}
                  {l.seuils ? <i style={{ insetInlineStart: `${l.seuils.grave}%` }} /> : null}
                </span>
                <span className="c-sous">{l.sous} · {dire(`${K}.machine.au_plus`, { valeur: pourCent(Math.min(l.auPlus, 999) / 100, 0) })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── L'en-tête du service, et ses vues ───────────────────────────────────────────────────────────────────────────────
// Le même sur chaque vue, comme la maquette le pose : le fil (où l'on est) et, en face, l'écran « en direct » — relu il y
// a combien, qu'on met en pause ; le titre et l'état des briques sur une ligne, et en face la période quand la vue en a
// une ; un onglet par vue qui existe (jamais un onglet vers un écran pas encore écrit), dans l'ordre de la maquette ;
// puis, sur les vues autres que les alertes, l'alerte ouverte la plus urgente en une ligne, qui mène à sa page. L'onglet
// des alertes porte le compte des alertes ouvertes, en rouge si l'une est grave : la même fonction, côté serveur, sur
// chaque vue (C3).
export type VueDuService = 'vue' | 'alertes' | 'incidents' | 'securite' | 'versions' | 'sauvegardes' | 'travaux' | 'performances';
type PourEntete = { briques: Brique[]; maintenant: string; alertesEnCours: AlertesEnCours };
const ONGLETS: readonly { vue: VueDuService; href: string }[] = [
  { vue: 'vue', href: '#/service' }, { vue: 'performances', href: '#/service/performances' },
  { vue: 'sauvegardes', href: '#/service/sauvegardes' }, { vue: 'travaux', href: '#/service/travaux' },
  { vue: 'alertes', href: '#/service/alertes' },
  { vue: 'incidents', href: '#/service/incidents' }, { vue: 'securite', href: '#/service/securite' },
  { vue: 'versions', href: '#/service/versions' },
];

// La pause de la relecture : une seule pour toutes les vues (on passe d'un onglet à l'autre sans la perdre), le temps de
// la page. En pause, l'écran ne se relit plus de lui-même ; « Reprendre » le relit tout de suite.
let enPause = false;
const abonnes = new Set<() => void>();
const pause = {
  lire: () => enPause,
  abonner: (f: () => void) => { abonnes.add(f); return () => { abonnes.delete(f); }; },
  poser: (v: boolean) => { enPause = v; for (const f of abonnes) f(); },
};
export const usePause = () => useSyncExternalStore(pause.abonner, pause.lire);

// « Relu il y a 12 s » : compté depuis l'arrivée de la lecture sur ce poste (l'heure du serveur peut différer de la
// sienne), à la seconde sous la minute.
function EnDirect({ maintenant, relire, occupe }: { maintenant: string | null; relire: () => void; occupe: boolean }) {
  const enPauseIci = usePause();
  const [recuA, setRecuA] = useState(() => Date.now());
  const [, battre] = useState(0);
  useEffect(() => { setRecuA(Date.now()); }, [maintenant]);
  useEffect(() => {
    const m = setInterval(() => { if (document.visibilityState === 'visible') battre((n) => n + 1); }, 1000);
    return () => clearInterval(m);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - recuA) / 1000));
  const depuis = occupe ? dire(`${K}.direct.relecture`)
    : s < 5 ? dire(`${K}.direct.relu_instant`) : s < 60 ? dire(`${K}.direct.relu_s`, { n: s }) : dire(`${K}.direct.relu_min`, { n: Math.floor(s / 60) });
  return (
    <div className={`c-sv-direct${enPauseIci ? ' c-sv-direct-pause' : ''}`} role="group" aria-label={titre(`${K}.direct.groupe`)}>
      <span className="c-sv-direct-point" aria-hidden="true" />
      <span className="c-sv-direct-texte" aria-live="polite">
        {enPauseIci ? maj(dire(`${K}.direct.en_pause`, { heure: maintenant ? heureDe(maintenant) : '—' })) : `${maj(dire(`${K}.direct.en_direct`))} · ${depuis}`}
      </span>
      <button type="button" className="c-sv-direct-bouton" onClick={() => { const v = !enPauseIci; pause.poser(v); if (!v) relire(); }}>
        {titre(`${K}.direct.${enPauseIci ? 'reprendre' : 'pause'}`)}
      </button>
    </div>
  );
}

// L'alerte ouverte la plus urgente, en une ligne : sa gravité, son titre, depuis quand ; et, s'il y en a d'autres, leur
// compte. Ce qu'il faut faire, qui s'en occupe et ce qui est parti vivent sur la page des alertes, où mène la ligne.
// Sur la vue d'ensemble, la même alerte en grand : c'est la première chose à voir de la page, et son geste est l'étape
// suivante de l'écran (le seul bouton principal).
function BandeauAlerte({ a, maintenant, grand }: { a: AlertesEnCours; maintenant: string; grand: boolean }) {
  const p = a.premiere;
  if (!p) return null;
  const depuis = Math.max(0, Math.round((Date.parse(maintenant) - Date.parse(p.debut)) / 60_000));
  const quandEtAutres = `${dire(`${K}.bandeau.depuis`, { heure: heureDe(p.debut), duree: minutes(depuis) })}${a.n > 1 ? ` · ${selon(a.n - 1, `${K}.bandeau.autres`)}` : ''}`;
  if (grand) {
    return (
      <section className={`c-sv-alerte c-sv-alerte-${p.grave ? 'grave' : 'attention'}`} aria-labelledby="sv-alerte">
        <span className={`c-ligne-icone c-${p.grave ? 'urgent' : 'aujourdhui'}`}><Icone nom="alerte" /></span>
        <div className="c-sv-alerte-texte">
          <div className="c-sv-alerte-tete">
            <Puce ton={p.grave ? 'urgent' : 'en_retard'}>{dire(`${K}.${p.grave ? 'grave' : 'a_regarder'}`)}</Puce>
            <h2 id="sv-alerte" data-donnee>{enTitre(p.titre)}</h2>
          </div>
          <p className="c-carte-sous">{maj(quandEtAutres)}</p>
        </div>
        <Lien href="#/service/alertes" ton="principal" fleche>{titre(`${K}.bandeau.voir`)}</Lien>
      </section>
    );
  }
  return (
    <section className={`c-sv-bandeau c-sv-bandeau-${p.grave ? 'grave' : 'attention'}`} aria-label={titre(`${K}.bandeau.titre`)}>
      <Puce ton={p.grave ? 'urgent' : 'en_retard'}>{dire(`${K}.${p.grave ? 'grave' : 'a_regarder'}`)}</Puce>
      <b className="c-sv-bandeau-titre" data-donnee>{enTitre(p.titre)}</b>
      <span className="c-sv-bandeau-quand">{quandEtAutres}</span>
      <a className="c-sv-bandeau-lien" href="#/service/alertes">{titre(`${K}.bandeau.voir`)}<Icone nom="fleche" taille={16} /></a>
    </section>
  );
}

// Le dernier compte d'alertes lu, d'une vue à l'autre : pendant qu'une vue se lit, son onglet « Alertes » garde le
// compte qu'il montrait. Sans lui, le compte disparaît puis revient à chaque changement d'onglet, et les onglets qui le
// suivent glissent de trente points sous le curseur, deux fois par clic.
let alertesLues: AlertesEnCours | null = null;

export function EnteteService({ vue, d, relire, occupe, periode }: {
  vue: VueDuService; d: PourEntete | null; relire: () => void; occupe: boolean;
  periode?: { valeur: Periode; choisir: (p: Periode) => void };
}) {
  useEffect(() => { if (d) alertesLues = d.alertesEnCours; }, [d]);
  const a = d ? d.alertesEnCours : alertesLues;
  return (
    <div className="c-sv-entete">
      <div className="c-sv-entete-haut">
        <nav className="c-fil" aria-label={titre(`${K}.fil`)}>
          <a href="#/">{titre(`${K}.fil.console`)}</a><Icone nom="droite" taille={14} />
          {vue === 'vue' ? <span>{titre(`${K}.fil.plateforme`)}</span> : <a href="#/service">{titre(`${K}.fil.service`)}</a>}
          <Icone nom="droite" taille={14} />
          <span aria-current="page">{titre(vue === 'vue' ? `${K}.fil.service` : `${K}.onglet.${vue}`)}</span>
        </nav>
        <EnDirect maintenant={d?.maintenant ?? null} relire={relire} occupe={occupe} />
      </div>
      <header className="c-entete c-sv-entete-titre">
        <div className="c-titre-ligne"><h1>{titre(`${K}.titre`)}</h1>{d ? <EtatGeneral briques={d.briques} /> : null}</div>
        {periode ? (
          <div className="c-segments c-sv-periodes" role="group" aria-label={dire(`${K}.periode.groupe`)}>
            {PERIODES.map((p) => (
              <button key={p} type="button" className="c-pilule" aria-pressed={periode.valeur === p} onClick={() => periode.choisir(p)}>{dire(`${K}.periode.${p}`)}</button>
            ))}
          </div>
        ) : null}
      </header>
      <nav className="c-onglets c-sv-onglets" aria-label={titre(`${K}.onglets`)}>
        {ONGLETS.map((o) => (
          <a key={o.vue} href={o.href} aria-current={vue === o.vue ? 'page' : undefined}>
            {titre(`${K}.onglet.${o.vue}`)}
            {o.vue === 'alertes' && a && a.n > 0 ? (
              <>
                <span className={`c-onglet-n${a.graves ? ' c-onglet-n-grave' : ''}`} aria-hidden="true">{entier(a.n)}</span>
                <span className="c-cache">{selon(a.n, `${K}.onglet.alertes_n`)}</span>
              </>
            ) : null}
          </a>
        ))}
      </nav>
      {d && vue !== 'alertes' ? <BandeauAlerte a={d.alertesEnCours} maintenant={d.maintenant} grand={vue === 'vue'} /> : null}
    </div>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Service({ periode: demandee }: { periode: string | null }) {
  const { moi } = useConsole();
  const [periode, setPeriode] = useState<Periode>(estPeriode(demandee) ? demandee : '24h');
  useEffect(() => { history.replaceState(null, '', `#/service${periode === '24h' ? '' : `?periode=${periode}`}`); }, [periode]);
  const [l, relire] = useLecture<Donnees>(`/console/service?periode=${periode}`, 'service');
  useRelireTantQueRegarde(relire);
  const d = l.etat === 'lu' ? l.donnees : null;
  const enCours = l.etat === 'lu' && l.enCours;
  const periodeTexte = d ? dire(`${K}.periode.texte.${d.periode}`) : '';
  return (
    <>
      <EnteteService vue="vue" d={d} relire={relire} occupe={enCours} periode={{ valeur: periode, choisir: setPeriode }} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <EnCeMoment v={d.veille} aujourdhui={d.aujourdhui || moi.aujourdhui} alertes={d.alertesEnCours} />
          <section className="c-sv-hero" aria-labelledby="sv-dispo">
            <Disponibilite d={d} />
            <Tuiles d={d} />
          </section>
          <section className="c-sv-requetes" aria-label={titre(`${K}.requetes.titre`)}>
            <div className={`c-sv-graphes${enCours && d.periode !== periode ? ' c-sv-attente' : ''}`} aria-busy={enCours || undefined}>
              <TempsDeReponse d={d} periodeTexte={periodeTexte} />
              <TraficEtPannes d={d} periodeTexte={periodeTexte} />
            </div>
          </section>
          <Briques d={d} />
          <div className="c-sv-bas">
            <Evenements d={d} />
            <div className="c-sv-bas-pile">
              <Sauvegardes d={d} />
              <LaMachine d={d} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
