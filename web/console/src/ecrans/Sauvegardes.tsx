// Les sauvegardes du service (10 § 2.8 ; 06 § 4 ; serveur/console/routes.ts, GET /console/service/sauvegardes ;
// serveur/console/sauvegardes.ts ; docs/console.md C14) : ce qu'on promet de pouvoir reprendre et ce que la mesure en dit,
// où sont les copies, nuit par nuit, la copie hors de la machine heure par heure, les exercices de restauration et les
// remises d'une entreprise. Trois règles :
//   - une promesse ne se dit tenue qu'avec une mesure ET une preuve faite sur ce serveur : sinon « à prouver » ;
//   - ce que la console ne peut pas voir (le verrou de la copie chez le fournisseur) se dit invérifiable d'ici ;
//   - la console ne touche jamais au serveur : un geste est une commande composée, à copier dans sa console.
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { Barres, echelle } from '../graphes.tsx';
import { entier, minutes as minutesEnMots } from '../nombres.ts';
import { heureDe, jourCourt, jourMois, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Icone, maj, Puce, toast, Zone, type NomIcone, type TonPuce } from '../ui.tsx';
import { Commande } from './Alertes.tsx';
import { EnteteService, Tuile, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type EtatBrique, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const G = `${K}.sg`;

type Resultat = { le: string; ok: boolean };
type EtatPromesse = 'tenue' | 'a_prouver' | 'pas_tenue' | 'pas_encore' | 'inverifiable';
type EtatCopie = 'en_place' | 'en_retard' | 'manque' | 'pas_encore' | 'inverifiable' | 'nonmesure';
type HorsDeLaNuit = 'arrivee' | 'en_attente' | 'sans_objet' | 'pas_reglee';
type Nuit = {
  jour: string; hors: HorsDeLaNuit;
  sauvegarde: (Resultat & { lignes: number | null; migrations: number | null }) | null; horsMachine: Resultat | null; copieDeBase: Resultat | null;
  restauration: (Resultat & { secondes: number | null; lignes: number | null; migrations: number | null }) | null;
};
type Exercice = { jour: string; le: string; ok: boolean; secondes: number | null; lignes: number | null; migrations: number | null };
type IdPromesse = 'programme' | 'base' | 'site' | 'entreprise' | 'rancongiciel';
type Promesse = {
  id: IdPromesse; perte: number; retour: number; etat: EtatPromesse;
  mesure?: { exemplaires?: number; enMarche?: boolean | null; dernier?: string | null; regle?: boolean | null; retard?: number | null; plusLong24h?: number | null };
  preuve?: { le?: string; ok?: boolean; minutes?: number | null; vieux?: boolean; n?: number; derniere?: string | null } | null;
};
type Remise = { le: string; entreprise: string; nom: string; motif: string; minute: string | null; numerosRetires: number; preparee: { par: string; le: string } | null };
type Donnees = {
  maintenant: string; aujourdhui: string; role: 'direction' | 'technique'; veille: Veille; briques: Brique[]; alertesEnCours: AlertesEnCours;
  situation: {
    sauvegarde: { etat: EtatBrique; le?: string; ok?: boolean; vieille?: boolean; lignes?: number | null; migrations?: number | null };
    archivage: { etat: EtatBrique; enMarche: boolean | null; dernier: string | null };
    hors: { etat: EtatBrique; regle: boolean | null; retard: number | null; attenteDepuis: string | null };
    exercice: { etat: EtatBrique; exercice: Exercice | null; vieux?: boolean; prochain: string };
  };
  promesses: Promesse[];
  copies: { liste: { id: 'serveur' | 'hors_machine' | 'secours' | 'intouchable'; etat: EtatCopie; retard?: number | null }[]; enPlace: number };
  nuits: Nuit[]; lignes: { jour: string; lignes: number }[]; retards: { heure: string; plusLong: number | null }[];
  pointLePlusAncien: string | null; exercices: Exercice[]; remisesFaites: { n: number; derniere: string | null }; remises: Remise[] | null;
  calendrier: { sauvegarde: string; copieDeBase: string; exercice: { jourDuMois: number; heure: string } };
  garde: { nuits: number; jours: number }; commandes: { exercice: readonly string[]; copie: readonly string[] };
  seuils: { sauvegardeH: number; horsMachineMin: number; horsMachineGraveMin: number; exerciceJ: number };
};

// Une durée ne se coupe pas en fin de ligne (« 1 h » d'un côté, « 43 » de l'autre).
const minutes = (n: number) => minutesEnMots(n).replace(/ /g, '\u00a0');
// L'heure d'un minuteur, écrite en UTC dans le serveur, se dit à l'heure de Tunis (UTC+1, sans heure d'été).
const aTunis = (hhmm: string) => heureDe(`2026-01-01T${hhmm}:00Z`);
// Une durée promise, en minutes : « rien », « 1 min », « 4 h ».
const promise = (m: number) => (m === 0 ? dire(`${G}.p.rien`) : minutes(m));

const PUCE_PROMESSE: Record<EtatPromesse, TonPuce> = { tenue: 'actif', a_prouver: 'a_regarder', pas_tenue: 'urgent', pas_encore: 'hors', inverifiable: 'hors' };
const PUCE_COPIE: Record<EtatCopie, TonPuce> = { en_place: 'actif', en_retard: 'en_retard', manque: 'urgent', pas_encore: 'hors', inverifiable: 'hors', nonmesure: 'hors' };
const ICONE_COPIE: Record<Donnees['copies']['liste'][number]['id'], NomIcone> = { serveur: 'serveur', hors_machine: 'nuage', secours: 'echange', intouchable: 'cadenas' };

// ── Les quatre chiffres ─────────────────────────────────────────────────────────────────────────────────────────────
function Situation({ d }: { d: Donnees }) {
  const { sauvegarde: s, archivage: a, hors: h, exercice: e } = d.situation;
  const sauvegarde = !s.le
    ? <Tuile titre={titre(`${G}.k.sauvegarde`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={phrase(`${G}.k.sauvegarde_aucune`)} />
    : <Tuile titre={titre(`${G}.k.sauvegarde`)} etat={s.etat} mot
        valeur={titre(s.ok ? (s.vieille ? `${G}.k.sauvegarde_vieille_mot` : `${G}.k.sauvegarde_faite`) : `${G}.k.sauvegarde_ratee`)}
        sous={[dire(s.ok ? `${G}.k.sauvegarde_ok` : `${G}.k.sauvegarde_echec`, { quand: quand(s.le, d.aujourdhui) }),
          s.vieille ? dire(`${G}.k.sauvegarde_vieille`, { heures: d.seuils.sauvegardeH }) : null,
          s.ok && s.lignes != null ? selon(s.lignes, `${G}.k.sauvegarde_lignes`, { n: entier(s.lignes), migrations: s.migrations ?? '—' }) : null].filter(Boolean).join(' · ')} />;
  const archivage = a.enMarche === null
    ? <Tuile titre={titre(`${G}.k.archivage`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={phrase(`${G}.k.archivage_non`)} />
    : <Tuile titre={titre(`${G}.k.archivage`)} etat={a.etat} mot valeur={titre(a.enMarche ? `${G}.k.archivage_marche` : `${G}.k.archivage_arrete`)}
        sous={a.dernier ? dire(`${G}.k.archivage_dernier`, { quand: quand(a.dernier, d.aujourdhui) }) : phrase(`${G}.k.archivage_rien`)} />;
  const hors = h.regle === null
    ? <Tuile titre={titre(`${G}.k.hors`)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={phrase(`${G}.k.archivage_non`)} />
    : h.regle === false
      ? <Tuile titre={titre(`${G}.k.hors`)} etat="attention" mot valeur={titre(`${G}.k.hors_pas_reglee`)} sous={phrase(`${G}.k.hors_sous_pas_reglee`)} />
      : h.retard
        ? <Tuile titre={titre(`${G}.k.hors`)} etat={h.etat} mot valeur={dire(`${G}.k.hors_retard`, { minutes: minutes(h.retard) })} sous={phrase(`${G}.k.hors_sous_retard`, { minutes: minutes(h.retard) })} />
        : <Tuile titre={titre(`${G}.k.hors`)} etat={h.etat} mot valeur={titre(`${G}.k.hors_a_jour`)} sous={phrase(`${G}.k.hors_sous_a_jour`)} />;
  const x = e.exercice;
  const exercice = !x
    ? <Tuile titre={titre(`${G}.k.exercice`)} etat="nonmesure" valeur={titre(`${G}.k.exercice_aucun`)} mot sous={dire(`${G}.k.exercice_prochain`, { quand: quand(e.prochain, d.aujourdhui) })} />
    : <Tuile titre={titre(`${G}.k.exercice`)} etat={e.etat} mot valeur={titre(x.ok ? `${G}.k.exercice_reussi` : `${G}.k.exercice_rate`)}
        sous={[dire(x.ok ? `${G}.k.exercice_ok` : `${G}.k.exercice_echec`, { quand: quand(x.le, d.aujourdhui) }),
          x.ok && x.secondes != null ? dire(`${G}.k.exercice_duree`, { duree: minutes(Math.ceil(x.secondes / 60)) }) : null,
          dire(`${G}.k.exercice_prochain`, { quand: jourCourt(e.prochain.slice(0, 10)) })].filter(Boolean).join(' · ')} />;
  return (
    <section className="c-sv-claires c-sg-situation" aria-label={titre(`${G}.situation`)}>
      <div className="c-sv-tuiles">{sauvegarde}{archivage}{hors}{exercice}</div>
    </section>
  );
}

// ── Ce qu'on promet de pouvoir reprendre (06 § 4.1) ─────────────────────────────────────────────────────────────────
// En face de chaque promesse écrite d'avance : ce que la mesure dit aujourd'hui, et ce qui la prouve. Une promesse
// qu'aucun geste fait sur ce serveur n'a prouvée n'est jamais verte.
// Une phrase de la table, toujours la même forme : une majuscule, un point final.
const enPhrase = (x: string) => maj(/[.!?…]$/.test(x) ? x : `${x}.`);
function mesureDe(p: Promesse, d: Donnees): string {
  const m = p.mesure ?? {};
  switch (p.id) {
    case 'programme': return selon(m.exemplaires ?? 0, `${G}.p.programme.mesure`);
    case 'base': return m.enMarche === null || m.enMarche === undefined ? phrase(`${G}.k.archivage_non`)
      : m.enMarche ? dire(`${G}.p.base.mesure`, { quand: m.dernier ? quand(m.dernier, d.aujourdhui) : dire('console.ecran.temps.jamais') }) : phrase(`${G}.p.base.arrete`);
    case 'site': return m.regle === false ? phrase(`${G}.k.hors_sous_pas_reglee`)
      : m.plusLong24h == null ? phrase(`${G}.p.site.non_lu`) : dire(`${G}.p.site.mesure`, { minutes: m.plusLong24h ? minutes(m.plusLong24h) : dire(`${G}.p.site.zero`) });
    case 'entreprise': return phrase(`${G}.p.entreprise.mesure`);
    case 'rancongiciel': return m.regle === false ? phrase(`${G}.k.hors_sous_pas_reglee`) : phrase(`${G}.p.rancongiciel.mesure`);
  }
}
function preuveDe(p: Promesse, d: Donnees): string {
  const x = p.preuve;
  switch (p.id) {
    case 'programme': return phrase(`${G}.p.programme.preuve`);
    case 'base': return !x?.le ? phrase(`${G}.p.base.sans_exercice`)
      : dire(x.ok ? `${G}.p.base.exercice_ok` : `${G}.p.base.exercice_rate`, { quand: jourCourt(x.le.slice(0, 10)), duree: x.minutes != null ? minutes(x.minutes) : '—' });
    case 'site': return phrase(`${G}.p.site.preuve`);
    case 'entreprise': return x?.n ? selon(x.n, `${G}.p.entreprise.faites`, { quand: quand(x.derniere ?? null, d.aujourdhui) }) : phrase(`${G}.p.entreprise.jamais`);
    case 'rancongiciel': return phrase(`${G}.p.rancongiciel.preuve`);
  }
}
function Promesses({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-liste-carte c-sg-promesses" aria-labelledby="sg-promesses">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-promesses">{titre(`${G}.p.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.p.sous`)}</p>
        </div>
      </div>
      <div className="c-defile">
        <table className="c-table c-al-table c-sg-table">
          <thead>
            <tr>
              <th scope="col">{titre(`${G}.p.col.si`)}</th>
              <th scope="col" className="c-droite">{titre(`${G}.p.col.perte`)}</th>
              <th scope="col" className="c-droite">{titre(`${G}.p.col.retour`)}</th>
              <th scope="col">{titre(`${G}.p.col.mesure`)}</th>
              <th scope="col">{titre(`${G}.p.col.preuve`)}</th>
              <th scope="col">{titre(`${G}.p.col.etat`)}</th>
            </tr>
          </thead>
          <tbody>
            {d.promesses.map((p) => (
              <tr key={p.id}>
                <th scope="row"><b>{titre(`${G}.p.${p.id}.si`)}</b><span className="c-sous">{phrase(`${G}.p.${p.id}.exemple`)}</span></th>
                <td className="c-droite c-num" data-col={titre(`${G}.p.col.perte`)}>{promise(p.perte)}</td>
                <td className="c-droite c-num" data-col={titre(`${G}.p.col.retour`)}>{promise(p.retour)}</td>
                <td data-col={titre(`${G}.p.col.mesure`)}>{enPhrase(mesureDe(p, d))}</td>
                <td data-col={titre(`${G}.p.col.preuve`)}>{enPhrase(preuveDe(p, d))}</td>
                <td data-col={titre(`${G}.p.col.etat`)}><Puce ton={PUCE_PROMESSE[p.etat]}>{dire(`${G}.p.etat.${p.etat}`)}</Puce></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Où sont les copies (06 § 4.2, la règle 3-2-1-1) ─────────────────────────────────────────────────────────────────
function Copies({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-liste-carte c-sg-copies" aria-labelledby="sg-copies">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-copies">{titre(`${G}.c.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.c.sous`, { n: d.copies.enPlace })}</p>
        </div>
      </div>
      <ul className="c-sg-copies-liste">
        {d.copies.liste.map((c) => (
          <li key={c.id} className={`c-sg-copie c-sg-copie-${c.etat}`}>
            <span className="c-sg-copie-icone" aria-hidden="true"><Icone nom={ICONE_COPIE[c.id]} taille={18} /></span>
            <div className="c-sg-copie-texte">
              <b>{titre(`${G}.c.${c.id}.nom`)}</b>
              <span className="c-sous">{phrase(`${G}.c.${c.id}.quoi`)}</span>
              <span>{c.etat === 'en_retard' && c.retard ? phrase(`${G}.c.en_retard_de`, { minutes: minutes(c.retard) }) : phrase(`${G}.c.${c.id}.${c.etat}`)}</span>
            </div>
            <Puce ton={PUCE_COPIE[c.etat]}>{dire(`${G}.c.etat.${c.etat}`)}</Puce>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Nuit par nuit ───────────────────────────────────────────────────────────────────────────────────────────────────
function Marque({ r, quoi }: { r: Resultat | null; quoi: string }) {
  if (!r) return <span className="c-sous">—</span>;
  return (
    <span className={`c-sg-marque c-ton-${r.ok ? 'bon' : 'grave'}`}>
      <Icone nom={r.ok ? 'ok' : 'croix'} taille={14} />
      <span className="c-num">{heureDe(r.le)}</span>
      <span className="c-cache">{dire(r.ok ? `${G}.n.reussie` : `${G}.n.ratee`, { quoi })}</span>
    </span>
  );
}
function Nuits({ d }: { d: Donnees }) {
  const lignes = d.lignes;
  const max = Math.max(1, ...lignes.map((x) => x.lignes));
  const montrees = d.nuits;
  const pied = {
    sauvegardes: montrees.filter((n) => n.sauvegarde?.ok).length,
    copies: montrees.filter((n) => n.copieDeBase?.ok).length,
    arrivees: montrees.filter((n) => n.hors === 'arrivee').length,
    attendues: montrees.filter((n) => n.hors === 'arrivee' || n.hors === 'en_attente').length,
  };
  return (
    <section className="c-carte c-liste-carte c-sg-nuits" aria-labelledby="sg-nuits">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-nuits">{titre(`${G}.n.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.n.sous`, { sauvegarde: aTunis(d.calendrier.sauvegarde), copie: aTunis(d.calendrier.copieDeBase), nuits: d.garde.nuits, jours: d.garde.jours })}</p>
        </div>
      </div>
      {lignes.length >= 2 ? (
        <div className="c-sg-graphe">
          <div className="c-sv-graphe-tete">
            <b>{titre(`${G}.n.lignes_titre`)}</b>
            <span className="c-sous">{phrase(`${G}.n.lignes_sous`, { de: entier(lignes[0]?.lignes ?? 0), a: entier(lignes.at(-1)?.lignes ?? 0), nuits: lignes.length,
              ecart: `${(lignes.at(-1)?.lignes ?? 0) >= (lignes[0]?.lignes ?? 0) ? '+' : '−'}${entier(Math.abs((lignes.at(-1)?.lignes ?? 0) - (lignes[0]?.lignes ?? 0)))}` })}</span>
          </div>
          <Barres valeurs={lignes.map((x) => x.lignes)} haut={echelle(max).haut} seuil={null} hauteur={96} etiquette={dire(`${G}.n.lignes_titre`)}
            bulle={(i) => ({ titre: jourCourt(lignes[i]?.jour), lignes: [{ texte: dire(`${G}.n.lignes_bulle`), valeur: entier(lignes[i]?.lignes ?? 0) }] })}
            abscisses={[{ x: 0, texte: jourMois(lignes[0]?.jour) }, { x: 1, texte: jourMois(lignes.at(-1)?.jour) }]} />
        </div>
      ) : null}
      {montrees.length ? (
        <div className="c-defile">
          <table className="c-table c-al-table c-sg-table">
            <thead>
              <tr>
                <th scope="col">{titre(`${G}.n.col.nuit`)}</th>
                <th scope="col">{titre(`${G}.n.col.sauvegarde`)}</th>
                <th scope="col" className="c-droite">{titre(`${G}.n.col.lignes`)}</th>
                <th scope="col">{titre(`${G}.n.col.copie`)}</th>
                <th scope="col">{titre(`${G}.n.col.hors`)}</th>
                <th scope="col">{titre(`${G}.n.col.exercice`)}</th>
              </tr>
            </thead>
            <tbody>
              {montrees.map((n) => (
                <tr key={n.jour}>
                  <th scope="row" className="c-num">{jourCourt(n.jour)}</th>
                  <td><Marque r={n.sauvegarde} quoi={dire(`${G}.n.col.sauvegarde`)} /></td>
                  <td className="c-droite c-num">{n.sauvegarde?.ok && n.sauvegarde.lignes != null ? entier(n.sauvegarde.lignes) : '—'}</td>
                  <td><Marque r={n.copieDeBase} quoi={dire(`${G}.n.col.copie`)} /></td>
                  <td>
                    {n.hors === 'arrivee' && n.horsMachine ? <span className="c-sg-marque c-ton-bon"><Icone nom="ok" taille={14} /><span>{dire(`${G}.n.hors.arrivee`, { heure: heureDe(n.horsMachine.le) })}</span></span>
                      : <span className={`c-sg-hors c-sg-hors-${n.hors}`}>{dire(`${G}.n.hors.${n.hors}`)}</span>}
                  </td>
                  <td>{n.restauration ? <Marque r={n.restauration} quoi={dire(`${G}.n.col.exercice`)} /> : <span className="c-sous">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{selon(montrees.length, `${G}.n.pied`)}</th>
                <td>{dire(`${G}.n.pied_sur`, { n: pied.sauvegardes, sur: montrees.length })}</td>
                <td />
                <td>{dire(`${G}.n.pied_sur`, { n: pied.copies, sur: montrees.length })}</td>
                <td>{pied.attendues ? dire(`${G}.n.pied_sur`, { n: pied.arrivees, sur: pied.attendues }) : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : <p className="c-sg-vide">{phrase(`${G}.n.aucune`)}</p>}
    </section>
  );
}

// ── L'archivage à la minute, et la copie hors de la machine heure par heure ─────────────────────────────────────────
function Archivage({ d }: { d: Donnees }) {
  const r = d.retards;
  const lus = r.filter((x) => x.plusLong !== null);
  const seuil = d.seuils.horsMachineMin;
  const haut = echelle(Math.max(seuil * 1.5, ...lus.map((x) => x.plusLong ?? 0))).haut;
  return (
    <section className="c-carte c-liste-carte c-sg-archivage" aria-labelledby="sg-archivage">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-archivage">{titre(`${G}.a.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.a.sous`)}</p>
        </div>
      </div>
      <dl className="c-sg-faits">
        <div><dt>{titre(`${G}.a.plus_ancien`)}</dt><dd>{d.pointLePlusAncien ? quand(d.pointLePlusAncien, d.aujourdhui) : phrase(`${G}.a.plus_ancien_aucun`)}</dd></div>
        <div><dt>{titre(`${G}.a.dernier`)}</dt><dd>{d.situation.archivage.dernier ? quand(d.situation.archivage.dernier, d.aujourdhui) : '—'}</dd></div>
      </dl>
      {d.situation.hors.regle === false ? <p className="c-sg-vide">{phrase(`${G}.k.hors_sous_pas_reglee`)}</p>
        : lus.length ? (
          <div className="c-sg-graphe">
            <div className="c-sv-graphe-tete"><b>{titre(`${G}.a.retard_titre`)}</b><span className="c-sous">{phrase(`${G}.a.retard_sous`, { seuil })}</span></div>
            <Barres valeurs={r.map((x) => x.plusLong)} haut={haut} seuil={{ valeur: seuil, texte: dire(`${G}.a.seuil`, { n: seuil }) }} hauteur={120}
              etiquette={dire(`${G}.a.retard_titre`)}
              bulle={(i) => { const x = r[i]; return { titre: heureDe(x?.heure ?? d.maintenant), lignes: [x?.plusLong == null ? { texte: dire(`${G}.a.bulle_rien`) } : { texte: dire(`${G}.a.bulle`), valeur: x.plusLong ? minutes(x.plusLong) : dire(`${G}.p.site.zero`) }] }; }}
              abscisses={[{ x: 0, texte: heureDe(r[0]?.heure ?? d.maintenant) }, { x: 0.5, texte: heureDe(r[12]?.heure ?? d.maintenant) }, { x: 1, texte: dire(`${G}.a.maintenant`) }]} />
          </div>
        ) : <p className="c-sg-vide">{phrase(`${G}.a.rien_lu`)}</p>}
      <div className="c-sg-geste">
        <p>{maj(dire(`${G}.a.geste`))}</p>
        {d.commandes.copie.map((c) => <Commande key={c} code={c} />)}
      </div>
    </section>
  );
}

// ── Les exercices de restauration ───────────────────────────────────────────────────────────────────────────────────
function Exercices({ d }: { d: Donnees }) {
  const e = d.situation.exercice;
  return (
    <section className="c-carte c-liste-carte c-sg-exercices" aria-labelledby="sg-exercices">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-exercices">{titre(`${G}.e.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.e.sous`, { jour: d.calendrier.exercice.jourDuMois === 1 ? dire(`${G}.e.premier`) : String(d.calendrier.exercice.jourDuMois), heure: aTunis(d.calendrier.exercice.heure), j: d.seuils.exerciceJ, prochain: quand(e.prochain, d.aujourdhui) })}</p>
        </div>
      </div>
      {d.exercices.length ? (
        <div className="c-defile">
          <table className="c-table c-al-table c-sg-table">
            <thead>
              <tr>
                <th scope="col">{titre(`${G}.e.col.le`)}</th>
                <th scope="col">{titre(`${G}.e.col.resultat`)}</th>
                <th scope="col" className="c-droite">{titre(`${G}.e.col.duree`)}</th>
                <th scope="col" className="c-droite">{titre(`${G}.e.col.lignes`)}</th>
                <th scope="col" className="c-droite">{titre(`${G}.e.col.migrations`)}</th>
              </tr>
            </thead>
            <tbody>
              {d.exercices.map((x) => (
                <tr key={x.le}>
                  <th scope="row">{quand(x.le, d.aujourdhui)}</th>
                  <td><Puce ton={x.ok ? 'actif' : 'urgent'}>{dire(x.ok ? `${G}.e.reussi` : `${G}.e.rate`)}</Puce></td>
                  <td className="c-droite c-num">{x.secondes != null ? minutes(Math.ceil(x.secondes / 60)) : '—'}</td>
                  <td className="c-droite c-num">{x.lignes != null ? entier(x.lignes) : '—'}</td>
                  <td className="c-droite c-num">{x.migrations != null ? entier(x.migrations) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sg-vide">{phrase(`${G}.e.aucun`)}</p>}
      <div className="c-sg-geste">
        <p>{maj(dire(`${G}.e.geste`))}</p>
        {d.commandes.exercice.map((c) => <Commande key={c} code={c} />)}
      </div>
    </section>
  );
}

// ── Les remises d'une entreprise ────────────────────────────────────────────────────────────────────────────────────
// Leur nombre pour tous ; leur détail nomme le client : la direction seule (03 § 5).
function Remises({ d, preparer }: { d: Donnees; preparer: () => void }) {
  const r = d.remises;
  return (
    <section className="c-carte c-liste-carte c-sg-remises" aria-labelledby="sg-remises">
      <div className="c-al-section-tete">
        <div>
          <h2 id="sg-remises">{titre(`${G}.r.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${G}.r.sous`)}</p>
        </div>
        {d.role === 'direction' ? <Bouton icone="retour" onClick={preparer}>{titre(`${G}.r.preparer`)}</Bouton> : null}
      </div>
      {r === null ? (
        <p className="c-sg-vide">{d.remisesFaites.n ? selon(d.remisesFaites.n, `${G}.r.technique`, { quand: quand(d.remisesFaites.derniere, d.aujourdhui) }) : phrase(`${G}.r.aucune`)}</p>
      ) : r.length ? (
        <div className="c-defile">
          <table className="c-table c-al-table c-sg-table">
            <thead>
              <tr>
                <th scope="col">{titre(`${G}.r.col.le`)}</th>
                <th scope="col">{titre(`${G}.r.col.client`)}</th>
                <th scope="col">{titre(`${G}.r.col.a`)}</th>
                <th scope="col">{titre(`${G}.r.col.motif`)}</th>
                <th scope="col" className="c-droite">{titre(`${G}.r.col.numeros`)}</th>
              </tr>
            </thead>
            <tbody>
              {r.map((x) => (
                <tr key={`${x.le}-${x.entreprise}`}>
                  <th scope="row">{quand(x.le, d.aujourdhui)}{x.preparee ? <span className="c-sous">{dire(`${G}.r.preparee`, { nom: x.preparee.par })}</span> : null}</th>
                  <td><a href={`#/clients/${x.entreprise}`} data-donnee>{x.nom}</a></td>
                  <td className="c-num">{x.minute ?? '—'}</td>
                  <td data-donnee>{x.motif}</td>
                  <td className="c-droite c-num">{entier(x.numerosRetires)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sg-vide">{phrase(`${G}.r.aucune`)}</p>}
    </section>
  );
}

// ── Préparer une remise : la console compose l'essai puis la remise ─────────────────────────────────────────────────
type Client = { id: string; raisonSociale: string };
function FenetreRemise({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [q, setQ] = useState('');
  const [trouves, setTrouves] = useState<Client[] | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [minute, setMinute] = useState('');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<{ texte: string; champ: string | null } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [commandes, setCommandes] = useState<{ essai: string; remise: string } | null>(null);
  // Chercher un client : par son nom ou son matricule, les huit premiers.
  useEffect(() => {
    if (client || q.trim().length < 2) { setTrouves(null); return undefined; }
    let fini = false;
    const t = setTimeout(() => {
      void api('GET', `/console/entreprises?q=${encodeURIComponent(q.trim())}&limite=8`).then((r) => {
        if (fini || !r || r.statut !== 200) return;
        const l = (r.corps as { lignes?: { id: string; raisonSociale: string }[] }).lignes ?? [];
        setTrouves(l.map((x) => ({ id: x.id, raisonSociale: x.raisonSociale })));
      }).catch(() => undefined);
    }, 250);
    return () => { fini = true; clearTimeout(t); };
  }, [q, client, api]);
  // Le client choisi, la liste se ferme et le curseur va à la case suivante : la minute (rien ne bouge sous la souris).
  const choisir = (c: Client) => {
    setClient(c); setRefus(null);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.c-dialogue input[name="minute"]')?.focus());
  };
  const envoyer = () => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/service/remise', { entreprise: client?.id ?? '', minute: minute.trim(), motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { setCommandes(r.corps as { essai: string; remise: string }); toast(phrase(`${G}.r.preparee_toast`)); return; }
        setRefus({ texte: refusDe(r), champ: typeof r.corps.champ === 'string' ? r.corps.champ : null });
      } catch (x) { setRefus({ texte: panneDe(x), champ: null }); } finally { setOccupe(false); }
    })();
  };
  if (commandes) {
    return (
      <Dialogue titre={titre(`${G}.r.f.composees`)} sous={client?.raisonSociale} fermer={fait}
        pied={<Bouton ton="principal" onClick={fait}>{titre('console.ecran.fermer')}</Bouton>}>
        <ol className="c-sg-etapes">
          <li><b>{titre(`${G}.r.f.etape_essai`)}</b><span>{phrase(`${G}.r.f.etape_essai_sous`)}</span><Commande code={commandes.essai} /></li>
          <li><b>{titre(`${G}.r.f.etape_remise`)}</b><span>{phrase(`${G}.r.f.etape_remise_sous`)}</span><Commande code={commandes.remise} /></li>
        </ol>
        <p className="c-al-qui">{phrase(`${G}.r.f.journal`)}</p>
      </Dialogue>
    );
  }
  const faute = (c: string) => refus?.champ === c;
  return (
    <Dialogue titre={titre(`${G}.r.f.titre`)} sous={phrase(`${G}.r.f.sous`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${G}.r.f.composer`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${A_CE_QUI_VA}`)}</span>
        <ul>
          <li>{phrase(`${G}.r.f.p1`)}</li>
          <li>{phrase(`${G}.r.f.p2`)}</li>
          <li>{phrase(`${G}.r.f.p3`, { quand: d.pointLePlusAncien ? quand(d.pointLePlusAncien, d.aujourdhui) : '—' })}</li>
        </ul>
      </div>
      {client ? (
        <div className="c-champ">
          <span className="c-champ-libelle">{titre(`${G}.r.f.client`)}</span>
          <div className="c-sg-client"><b data-donnee>{client.raisonSociale}</b><Bouton petit ton="discret" onClick={() => { setClient(null); setRefus(null); }}>{titre(`${G}.r.f.changer`)}</Bouton></div>
        </div>
      ) : (
        <div className="c-champ">
          <Champ libelle={titre(`${G}.r.f.client`)} aide={phrase(`${G}.r.f.client_aide`)} valeur={q} changer={(v) => { setQ(v); setRefus(null); }} faute={faute('entreprise')} premier />
          {trouves ? (trouves.length ? (
            <ul className="c-sg-trouves" aria-label={dire(`${G}.r.f.trouves`)}>
              {trouves.map((c) => <li key={c.id}><button type="button" onClick={() => choisir(c)} data-donnee>{c.raisonSociale}</button></li>)}
            </ul>
          ) : <p className="c-sous">{phrase(`${G}.r.f.aucun_client`)}</p>) : null}
        </div>
      )}
      <Champ libelle={titre(`${G}.r.f.minute`)} aide={phrase(`${G}.r.f.minute_aide`)} valeur={minute} changer={(v) => { setMinute(v); setRefus(null); }}
        faute={faute('minute')} placeholder="2026-10-12 14:03" inputMode="numeric" nom="minute" />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${G}.r.f.motif_aide`)} valeur={motif} changer={(v) => { setMotif(v); setRefus(null); }} faute={faute('motif')} />
      <p className="c-al-qui">{phrase(`${G}.r.f.qui`, { nom: moi.nom })}</p>
      {refus ? <Alerte ton="danger">{refus.texte}</Alerte> : null}
    </Dialogue>
  );
}
const A_CE_QUI_VA = `${K}.al.geste.ce_qui_va`;

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Sauvegardes() {
  const [l, relire] = useLecture<Donnees>('/console/service/sauvegardes', 'service-sauvegardes');
  useRelireTantQueRegarde(relire);
  const [remise, setRemise] = useState(false);
  const d = l.etat === 'lu' ? l.donnees : null;
  return (
    <>
      <EnteteService vue="sauvegardes" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <Situation d={d} />
          <Promesses d={d} />
          <Copies d={d} />
          <Nuits d={d} />
          <div className="c-sg-duo">
            <Archivage d={d} />
            <Exercices d={d} />
          </div>
          <Remises d={d} preparer={() => setRemise(true)} />
        </>
      ) : null}
      {remise && d ? <FenetreRemise d={d} fermer={() => setRemise(false)} fait={() => { setRemise(false); relire(); }} /> : null}
    </>
  );
}
