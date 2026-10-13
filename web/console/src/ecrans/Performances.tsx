// Les performances du service (10 § 2.8 ; VISION-ARCHITECTURE.md § 6 ; serveur/console/routes.ts, GET
// /console/service/performances ; serveur/console/performances.ts ; docs/console.md C15) : les budgets de temps que la
// vision promet aux clients en face de la mesure, le temps de réponse sorte par sorte, le trafic contre la période d'avant,
// les routes du serveur, la base PostgreSQL et les exemplaires du programme. Trois règles :
//   - rien n'est vert sans une mesure (C2) : un budget qui se mesure sur le poste, un centile sur trop peu de requêtes, une
//     comparaison que la base ne garde plus se disent « non mesuré », avec leur raison ;
//   - l'écran ne refait aucun calcul du serveur : les centiles, les parts et les états arrivent faits ;
//   - ce que la vue d'ensemble montre déjà (la disponibilité, les briques, les nuits, la machine) ne se répète pas ici.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { useLecture } from '../contexte.ts';
import { Courbe, echelle, Trait, type Contenu } from '../graphes.tsx';
import { decimal, duree, entier, minutes, pourCent } from '../nombres.ts';
import { jourCourt, quand } from '../temps.ts';
import { Alerte, Bouton, Icone, maj, Puce, Vide, type TonPuce } from '../ui.tsx';
import {
  abscisses, EnteteService, estPeriode, PERIODES, titrePas, Tuile, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type EtatBrique,
  type Periode, type Veille,
} from './Service.tsx';

const K = 'console.ecran.service';
const P = `${K}.pf`;

type Sorte = 'lecture' | 'caisse' | 'comptes' | 'dossier' | 'ecriture' | 'console';
type Dessinee = 'lecture' | 'caisse' | 'comptes';
const DESSINEES: readonly Dessinee[] = ['lecture', 'caisse', 'comptes'];
type IdBudget = 'liste' | 'caisse' | 'comptes' | 'cabinet' | 'rattrapage' | 'application' | 'saisie';
type Budget = {
  id: IdBudget; budget: number; ou: 'serveur' | 'poste'; sorte: Sorte | null; raison: 'poste' | 'pas_a_part' | 'pas_branche' | null;
  etat: EtatBrique; p95: number | null; part: number | null; lectures: number; trop: boolean;
};
type PointSorte = { debut: string; p95: number | null; p50: number | null; lectures: number };
type Temps = { lectures: number; p95: number | null; p50: number | null };
type Route = {
  route: string; methode: string; chemin: string; sorte: Sorte; n: number; pannes: number; partPannes: number | null;
  p50: number | null; p95: number | null; p99: number | null; lentes: number;
};
type Exemplaire = { nom: string; n: number; pannes: number; parMinute: number; derniere: string | null; silence: number | null; etat: EtatBrique };
type Base = {
  connexions: number; maxConnexions: number | null; enMemoire: number | null; annulations: number | null; blocages: number;
  fichiersTemporaires: number; octetsTemporaires: number; taille: number; depuis: string | null;
};
type Donnees = {
  maintenant: string; aujourdhui: string; periode: Periode; pas: number; depuis: string;
  veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[]; seuils: { pannes: number; lectures: number };
  budgets: Budget[];
  sortes: Record<Dessinee, { points: PointSorte[]; total: Temps }>;
  budgetsDesSortes: Record<Dessinee, number | null>;
  trafic: {
    points: { debut: string; n: number; pannes: number; parMinute: number }[];
    avant: { n: number; pannes: number; parMinute: number }[] | null;
    total: { n: number; pannes: number; partPannes: number | null };
    totalAvant: { n: number; pannes: number; partPannes: number | null } | null;
    recent: { parMinute: number; minutes: number };
  };
  routes: Route[]; routesDepuis: string; exemplaires: Exemplaire[]; base: Base | null;
};

const PUCE: Record<EtatBrique, TonPuce> = { bon: 'actif', attention: 'en_retard', grave: 'urgent', nonmesure: 'hors' };
// Une durée lue au 95e centile, comme la vue d'ensemble l'écrit (« 120 ms », « 1,2 s »).
const ms = (v: number | null) => (v === null ? '—' : duree(v));
// La même durée en deux morceaux, pour une tuile : le nombre en grand, l'unité à côté.
function enDeux(v: number): { valeur: string; unite: string } {
  if (!Number.isFinite(v)) return { valeur: '> 60', unite: dire(`${K}.unite.s`) };
  return v < 1000 ? { valeur: entier(v), unite: dire(`${K}.unite.ms`) } : { valeur: decimal(v / 1000, v % 1000 === 0 ? 0 : 1), unite: dire(`${K}.unite.s`) };
}
// L'échelle d'un temps de réponse : son budget en vue, sans qu'un pic isolé écrase tout le reste.
const echelleTemps = (valeurs: readonly (number | null)[], budget: number, crans = 3) =>
  echelle(Math.max(budget * 1.3, Math.min(budget * 4, ...valeurs.map((v) => v ?? 0))), crans);

// ── La période en chiffres ──────────────────────────────────────────────────────────────────────────────────────────
function Chiffres({ d, periodeTexte, pilules }: { d: Donnees; periodeTexte: string; pilules: ReactNode }) {
  const t = d.sortes.lecture.total;
  const liste = d.budgets.find((b) => b.id === 'liste');
  const budgetLecture = d.budgetsDesSortes.lecture ?? 300;
  const nonMesure = (cle: string, sous: string) => <Tuile titre={titre(cle)} etat="nonmesure" valeur={titre(`${K}.dispo.non_mesure`)} mot sous={sous} />;
  const peu = t.lectures ? selon(t.lectures, `${P}.k.p95_peu`, { n: entier(t.lectures), min: d.seuils.lectures }) : phrase(`${P}.k.p95_non`);
  const temps = t.p95 === null ? nonMesure(`${P}.k.p95`, peu)
    : <Tuile titre={titre(`${P}.k.p95`)} etat={liste?.etat ?? 'nonmesure'} {...enDeux(t.p95)} sous={dire(`${P}.k.p95_sous`, { budget: duree(budgetLecture) })} />;
  const mediane = t.p50 === null ? nonMesure(`${P}.k.p50`, peu)
    : <Tuile titre={titre(`${P}.k.p50`)} {...enDeux(t.p50)} sous={dire(`${P}.k.p50_lectures`)} />;
  const tr = d.trafic;
  const requetes = (
    <Tuile titre={titre(`${P}.k.requetes`)} valeur={tr.recent.minutes ? decimal(tr.recent.parMinute, 1) : titre(`${P}.k.requetes_aucune`)} mot={!tr.recent.minutes}
      {...(tr.recent.minutes ? { unite: dire(`${P}.k.par_minute`) } : {})} sous={selon(tr.total.n, `${P}.k.requetes_sous`, { n: entier(tr.total.n) })} />
  );
  const part = tr.total.partPannes;
  const pannes = part === null ? nonMesure(`${P}.k.pannes`, phrase(`${P}.k.pannes_non`))
    : <Tuile titre={titre(`${P}.k.pannes`)} etat={part > d.seuils.pannes ? 'grave' : 'bon'} valeur={pourCent(part, 2).replace(/\s*%$/, '')} unite="%"
        sous={selon(tr.total.pannes, `${P}.k.pannes_sous`, { n: entier(tr.total.pannes), total: entier(tr.total.n), seuil: pourCent(d.seuils.pannes, 0) })} />;
  const nRoutes = d.routes.reduce((s, r) => s + r.n, 0);
  const lentes = d.routes.reduce((s, r) => s + r.lentes, 0);
  return (
    <div className="c-sv-tuiles-zone c-sv-claires c-pf-chiffres">
      <div className="c-pf-chiffres-tete">
        <h2 className="c-tuile-titre c-sv-tuiles-titre">{maj(dire(`${P}.k.titre`, { periode: periodeTexte }))}</h2>
        {pilules}
      </div>
      <div className="c-sv-tuiles">
        {temps}
        {mediane}
        {requetes}
        {pannes}
        <Tuile titre={titre(`${P}.k.lentes`)} valeur={entier(lentes)} unite={dire(`${P}.k.lentes_unite`)}
          sous={selon(nRoutes, `${P}.k.lentes_sous`, { n: entier(nRoutes), jour: jourCourt(d.routesDepuis) })} />
      </div>
    </div>
  );
}

// ── Les budgets de la vision, en face de la mesure ──────────────────────────────────────────────────────────────────
function Budgets({ d, periodeTexte }: { d: Donnees; periodeTexte: string }) {
  return (
    <section className="c-carte c-liste-carte c-pf-budgets" aria-labelledby="pf-budgets">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-budgets">{titre(`${P}.b.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${P}.b.sous`, { periode: periodeTexte })}</p>
          <ul className="c-pf-legende" aria-label={dire(`${P}.b.legende`)}>
            {(['bon', 'attention', 'grave'] as const).map((e) => <li key={e}><i className={`c-pf-pastille c-pf-${e}`} aria-hidden="true" />{dire(`${P}.b.cle.${e}`)}</li>)}
          </ul>
        </div>
      </div>
      <div className="c-defile">
        <table className="c-table c-sg-table c-pf-table-budgets">
          <thead>
            <tr>
              <th scope="col">{titre(`${P}.b.col.quoi`)}</th>
              <th scope="col">{titre(`${P}.b.col.ou`)}</th>
              <th scope="col" className="c-droite">{titre(`${P}.b.col.budget`)}</th>
              <th scope="col" className="c-droite">{titre(`${P}.b.col.mesure`)}</th>
              <th scope="col">{titre(`${P}.b.col.part`)}</th>
              <th scope="col">{titre(`${P}.b.col.serie`)}</th>
              <th scope="col">{titre(`${P}.b.col.etat`)}</th>
            </tr>
          </thead>
          <tbody>
            {d.budgets.map((b) => {
              const serie = b.sorte === 'lecture' || b.sorte === 'caisse' || b.sorte === 'comptes' ? d.sortes[b.sorte].points.map((p) => p.p95) : null;
              return (
                <tr key={b.id} className={`c-pf-b-${b.etat}`}>
                  <th scope="row"><b>{titre(`${P}.b.id.${b.id}`)}</b><span className="c-sous">{maj(dire(`${P}.b.id.${b.id}_sous`))}</span></th>
                  <td data-col={titre(`${P}.b.col.ou`)} className="c-pf-gris">{dire(`${P}.b.ou.${b.ou}_c`)}</td>
                  <td data-col={titre(`${P}.b.col.budget`)} className="c-droite c-num">{duree(b.budget)}</td>
                  <td data-col={titre(`${P}.b.col.mesure`)} className="c-droite c-num c-pf-mesure">{b.p95 === null ? '—' : ms(b.p95)}</td>
                  <td data-col={titre(`${P}.b.col.part`)}>
                    {b.part !== null ? (
                      <div className="c-pf-part">
                        <span className="c-pf-jauge" aria-hidden="true"><span style={{ width: `${Math.min(100, b.part * 100)}%` }} /><i /></span>
                        <span className="c-num">{Number.isFinite(b.part) ? pourCent(b.part, 0) : '—'}</span>
                      </div>
                    ) : (
                      <span className="c-pf-gris">
                        {b.raison ? phrase(`${P}.b.raison.${b.raison}`) : selon(b.lectures, `${P}.b.peu`, { n: entier(b.lectures), min: d.seuils.lectures })}
                      </span>
                    )}
                  </td>
                  <td data-col={titre(`${P}.b.col.serie`)} className="c-pf-serie">
                    {serie && b.part !== null ? <Trait valeurs={serie} haut={echelleTemps(serie, b.budget).haut} seuil={b.budget} /> : null}
                  </td>
                  <td data-col={titre(`${P}.b.col.etat`)}><Puce ton={PUCE[b.etat]}>{dire(`${P}.b.etat.${b.etat}`)}</Puce></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Le temps de réponse, sorte par sorte ────────────────────────────────────────────────────────────────────────────
function UneSorte({ d, sorte, periodeTexte }: { d: Donnees; sorte: Dessinee; periodeTexte: string }) {
  const s = d.sortes[sorte];
  const budget = d.budgetsDesSortes[sorte];
  const p95 = s.points.map((p) => p.p95);
  const { haut, graduations } = echelleTemps(p95, budget ?? 300);
  const peu = s.points.map((p) => p.lectures > 0 && p.p95 === null);
  const nom = dire(`${P}.s.nom.${sorte}`);
  const bulle = (i: number): Contenu => {
    const p = s.points[i];
    if (!p) return { titre: '', lignes: [] };
    const lignes: Contenu['lignes'] = p.p95 === null
      ? p.lectures ? [{ texte: dire(`${K}.bulle.requetes`), valeur: entier(p.lectures) }, { texte: dire(`${K}.bulle.peu`, { min: d.seuils.lectures }) }]
        : [{ texte: dire(`${K}.bulle.aucune_requete`) }]
      : [
          { cle: 'p95', texte: dire(`${K}.bulle.p95`), valeur: duree(p.p95) },
          ...(p.p50 === null ? [] : [{ cle: 'p50', texte: dire(`${K}.bulle.p50`), valeur: duree(p.p50) }]),
          { texte: dire(`${K}.bulle.requetes`), valeur: entier(p.lectures) },
        ];
    return { titre: titrePas(p.debut, d.pas), lignes };
  };
  const t = s.total;
  const mesures = p95.filter((v): v is number => v !== null);
  const lent = mesures.length ? Math.max(...mesures) : null;
  const auDessus = budget ? mesures.filter((v) => v > budget).length : 0;
  return (
    <article className="c-carte c-sv-graphe c-pf-sorte" aria-label={nom}>
      <div className="c-pf-sorte-tete">
        <div>
          <h3>{maj(nom)}</h3>
          <p className="c-carte-sous">{budget ? dire(`${P}.s.budget`, { budget: duree(budget) }) : null}</p>
        </div>
        <p className="c-pf-sorte-valeur"><b>{ms(t.p95)}</b><span>{dire(`${P}.s.sur_periode`)}</span></p>
      </div>
      {t.lectures === 0 ? (
        <p className="c-sg-vide c-pf-vide">{phrase(`${P}.s.vide`)}</p>
      ) : (
        <Courbe series={[{ cle: 'p95', valeurs: p95 }, { cle: 'p50', valeurs: s.points.map((p) => p.p50) }]} haut={haut} aire hauteur={128}
          graduations={graduations.map((v) => ({ valeur: v, texte: v === 0 ? '0' : duree(v) }))}
          seuil={budget ? { valeur: budget, texte: duree(budget) } : null} peu={peu}
          abscisses={abscisses(s.points.map((p) => p.debut), d.periode)} etiquette={dire(`${P}.s.etiquette`, { sorte: nom, periode: periodeTexte })} bulle={bulle} />
      )}
      <p className="c-pf-sorte-pied">
        {t.lectures === 0 ? null : t.p95 === null
          ? phrase(`${P}.s.peu_${t.lectures === 1 ? '1' : 'n'}`, { n: entier(t.lectures), min: d.seuils.lectures })
          : [lent === null ? null : maj(dire(`${P}.s.lent`, { duree: duree(lent) })),
              budget ? dire(auDessus ? `${P}.s.au_dessus` : `${P}.s.sous_budget`, { duree: minutes((auDessus * d.pas) / 60_000) }) : null,
              selon(t.lectures, `${P}.s.requetes`, { n: entier(t.lectures) })].filter(Boolean).join(' · ')}
      </p>
    </article>
  );
}
function Sortes({ d, periodeTexte }: { d: Donnees; periodeTexte: string }) {
  return (
    <section className="c-pf-sortes-zone" aria-labelledby="pf-sortes">
      <div className="c-pf-zone-tete">
        <h2 id="pf-sortes">{titre(`${P}.s.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${P}.s.sous`, { periode: periodeTexte })}</p>
      </div>
      <div className="c-pf-sortes">
        {DESSINEES.map((s) => <UneSorte key={s} d={d} sorte={s} periodeTexte={periodeTexte} />)}
      </div>
    </section>
  );
}

// ── Le trafic et les pannes, contre la période d'avant ──────────────────────────────────────────────────────────────
function Trafic({ d, periodeTexte }: { d: Donnees; periodeTexte: string }) {
  const [comparer, setComparer] = useState(true);
  const tr = d.trafic;
  const avant = comparer && tr.avant ? tr.avant.map((p) => p.parMinute) : null;
  const valeurs = tr.points.map((p) => p.parMinute);
  const { haut, graduations } = echelle(Math.max(1, ...valeurs, ...(avant ?? [])), 2);
  const parts = tr.points.map((p) => (p.n ? (p.pannes / p.n) * 100 : null));
  const seuil = d.seuils.pannes * 100;
  const hautPannes = echelle(Math.max(seuil * 1.5, ...parts.map((v) => v ?? 0)), 1).haut;
  const bulle = (i: number): Contenu => {
    const p = tr.points[i];
    if (!p) return { titre: '', lignes: [] };
    const a = tr.avant?.[i];
    return {
      titre: titrePas(p.debut, d.pas),
      lignes: [
        { cle: 'trafic', texte: dire(`${K}.bulle.par_minute`), valeur: decimal(p.parMinute, 1) },
        ...(avant && a ? [{ cle: 'avant', texte: dire(`${P}.t.avant`), valeur: decimal(a.parMinute, 1) }] : []),
        { cle: 'pannes', texte: dire(`${K}.bulle.pannes`), valeur: p.n ? `${entier(p.pannes)} · ${pourCent(p.pannes / p.n, 2)}` : '—' },
      ],
    };
  };
  const t = tr.total, ta = tr.totalAvant;
  const ecart = ta && ta.n > 0 ? (t.n - ta.n) / ta.n : null;
  const signe = ecart === null ? '' : ecart > 0 ? '+' : ecart < 0 ? '−' : '';
  const fort = Math.max(0, ...valeurs);
  const mesurees = parts.filter((v): v is number => v !== null);
  return (
    <article className="c-carte c-sv-graphe c-pf-trafic" aria-labelledby="pf-trafic">
      <div className="c-pf-trafic-tete">
        <div>
          <h3 id="pf-trafic">{titre(`${P}.t.titre`)}</h3>
          <p className="c-carte-sous">{maj(dire(`${P}.t.sous`, { periode: periodeTexte }))}</p>
        </div>
        <div className="c-pf-trafic-outils">
          <ul className="c-pf-cles" aria-label={dire(`${K}.legende`)}>
            <li><i className="c-cle c-cle-trafic" />{maj(dire(`${P}.t.cle_trafic`))}</li>
            {avant ? <li><i className="c-cle c-cle-avant" />{maj(dire(`${P}.t.avant`))}</li> : null}
            <li><i className="c-cle c-cle-pannes" />{maj(dire(`${P}.t.cle_pannes`))}</li>
          </ul>
          {tr.avant ? (
            <button type="button" className="c-btn c-btn-petit c-pf-comparer" aria-pressed={comparer} onClick={() => setComparer(!comparer)}>
              <Icone nom="echange" taille={16} />{titre(`${P}.t.comparer_court`)}
            </button>
          ) : null}
        </div>
      </div>
      <Courbe series={[{ cle: 'trafic', valeurs }, ...(avant ? [{ cle: 'avant' as const, valeurs: avant }] : [])]} haut={haut} aire hauteur={170}
        graduations={graduations.map((v) => ({ valeur: v, texte: v === 0 ? '0' : decimal(v, v < 10 && v % 1 ? 1 : 0) }))}
        etiquette={dire(`${P}.t.etiquette`, { periode: periodeTexte })} bulle={bulle} />
      <Courbe series={[{ cle: 'pannes', valeurs: parts }]} haut={hautPannes} aire hauteur={56}
        graduations={[{ valeur: 0, texte: '0' }]} seuil={{ valeur: seuil, texte: pourCent(d.seuils.pannes, 0) }}
        abscisses={abscisses(tr.points.map((p) => p.debut), d.periode)} etiquette={dire(`${P}.t.etiquette_pannes`, { periode: periodeTexte })} bulle={bulle} />
      <div className="c-pf-trafic-pied">
        <p>
          {maj(selon(t.n, `${P}.t.resume`, { n: entier(t.n) }))}
          {ta ? <>{' · '}{ecart === null ? dire(`${P}.t.ecart_sans`) : dire(`${P}.t.ecart`, { ecart: `${signe}${pourCent(Math.abs(ecart), 0)}`, avant: entier(ta.n) })}</> : null}
          {t.n ? <>{' · '}{dire(`${P}.t.au_plus_fort`, { n: decimal(fort, fort < 10 ? 1 : 0) })}</> : null}
          {mesurees.length ? <>{' · '}{dire(`${P}.t.pannes_haut`, { part: pourCent(Math.max(...mesurees) / 100, 2) })}</> : null}
        </p>
        <p>{phrase(`${K}.pannes.note`)}</p>
      </div>
      {!tr.avant ? <p className="c-sv-note">{phrase(`${P}.t.sans_avant`)}</p> : null}
    </article>
  );
}

// ── Les requêtes lentes, route par route ────────────────────────────────────────────────────────────────────────────
function Chemin({ r }: { r: Pick<Route, 'methode' | 'chemin'> }) {
  // Un chemin long passe à la ligne après une barre, jamais au milieu d'un mot.
  const morceaux = r.chemin.split(/(?=\/)/).filter(Boolean);
  return (
    <span className="c-pf-chemin" data-donnee>
      <span className={`c-pf-methode c-pf-methode-${r.methode.toLowerCase()}`} data-donnee>{r.methode}</span>
      <code className="c-mono" data-donnee>{morceaux.map((m, k) => <Fragment key={k}>{k ? <wbr /> : null}<span className={m.startsWith('/:') ? 'c-pf-param' : undefined}>{m}</span></Fragment>)}</code>
    </span>
  );
}
function Lentes({ d }: { d: Donnees }) {
  const lentes = d.routes.filter((r) => r.lentes > 0).sort((a, b) => b.lentes - a.lentes || a.route.localeCompare(b.route)).slice(0, 7);
  const max = Math.max(1, ...lentes.map((r) => r.lentes));
  const jour = jourCourt(d.routesDepuis);
  return (
    <section className="c-carte c-pf-lentes" aria-labelledby="pf-lentes">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-lentes">{titre(`${P}.l.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${P}.l.sous`, { jour })}</p>
        </div>
      </div>
      {lentes.length === 0 ? <p className="c-sg-vide">{phrase(`${P}.l.vide`, { jour })}</p> : (
        <ul className="c-pf-lentes-liste">
          {lentes.map((r) => (
            <li key={r.route}>
              <div className="c-pf-lente-texte">
                <Chemin r={r} />
                {r.p99 !== null ? <span className="c-sous">{dire(`${P}.l.p99`, { duree: duree(r.p99) })}</span> : null}
              </div>
              <div className="c-pf-lente-n">
                <b className="c-num">{selon(r.lentes, `${P}.l.ligne`, { n: entier(r.lentes), total: entier(r.n) })}</b>
                <span className="c-pf-jauge c-pf-jauge-lente" aria-hidden="true"><span style={{ width: `${(r.lentes / max) * 100}%` }} /></span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="c-pf-non"><Icone nom="info" taille={16} /><span>{phrase(`${P}.l.trace`)}</span></p>
    </section>
  );
}

// ── Les routes du serveur ───────────────────────────────────────────────────────────────────────────────────────────
type Colonne = 'route' | 'n' | 'p50' | 'p95' | 'p99' | 'pannes' | 'lentes';
const COLONNES: readonly Colonne[] = ['route', 'n', 'p50', 'p95', 'p99', 'pannes', 'lentes'];
const PREMIERES = 12;
function trier(routes: readonly Route[], cle: Colonne, sens: 1 | -1): Route[] {
  return [...routes].sort((a, b) => {
    if (cle === 'route') return sens * a.chemin.localeCompare(b.chemin) || a.methode.localeCompare(b.methode);
    const x = a[cle], y = b[cle];
    // Un centile sur trop peu de requêtes n'a pas de rang : il va au bout, dans les deux sens.
    if (x === null || y === null) return x === y ? a.route.localeCompare(b.route) : x === null ? 1 : -1;
    return sens * (x - y) || a.route.localeCompare(b.route);
  });
}
function Routes({ d }: { d: Donnees }) {
  const [q, setQ] = useState('');
  const [sorte, setSorte] = useState<Sorte | null>(null);
  const [tri, setTri] = useState<{ cle: Colonne; sens: 1 | -1 }>({ cle: 'p95', sens: -1 });
  const [tout, setTout] = useState(false);
  const presentes = useMemo(() => {
    const n = new Map<Sorte, number>();
    for (const r of d.routes) n.set(r.sorte, (n.get(r.sorte) ?? 0) + 1);
    return (['lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console'] as const).filter((s) => n.has(s)).map((s) => ({ s, n: n.get(s) ?? 0 }));
  }, [d.routes]);
  const mot = q.trim().toLowerCase();
  const gardees = trier(d.routes.filter((r) => (!sorte || r.sorte === sorte) && (!mot || r.route.toLowerCase().includes(mot))), tri.cle, tri.sens);
  const vues = tout ? gardees : gardees.slice(0, PREMIERES);
  const jour = jourCourt(d.routesDepuis);
  const cliquer = (cle: Colonne) => setTri((t) => (t.cle === cle ? { cle, sens: t.sens === 1 ? -1 : 1 } : { cle, sens: cle === 'route' ? 1 : -1 }));
  const budget = (s: Sorte) => (s === 'lecture' || s === 'caisse' || s === 'comptes' ? d.budgetsDesSortes[s] : null);
  return (
    <section className="c-carte c-liste-carte c-pf-routes" aria-labelledby="pf-routes">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-routes">{titre(`${P}.r.titre`)}</h2>
          <p className="c-carte-sous">{maj(selon(d.routes.length, `${P}.r.sous`, { n: entier(d.routes.length), jour }))}</p>
        </div>
      </div>
      {d.routes.length === 0 ? <p className="c-sg-vide">{phrase(`${P}.r.vide`, { jour })}</p> : (
        <>
          <div className="c-liste-outils c-pf-outils">
            <label className="c-recherche">
              <span className="c-cache">{titre('console.ecran.chercher_label')}</span>
              <Icone nom="chercher" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={titre(`${P}.r.chercher`)} />
            </label>
            <div className="c-pilules" role="group" aria-label={dire(`${P}.r.sortes`)}>
              <button type="button" className="c-pilule" aria-pressed={sorte === null} onClick={() => setSorte(null)}>
                {titre(`${P}.r.toutes`)} <span className="c-pilule-n">{entier(d.routes.length)}</span>
              </button>
              {presentes.map(({ s, n }) => (
                <button key={s} type="button" className="c-pilule" aria-pressed={sorte === s} onClick={() => setSorte(sorte === s ? null : s)}>
                  {titre(`${P}.r.sorte.${s}`)} <span className="c-pilule-n">{entier(n)}</span>
                </button>
              ))}
            </div>
          </div>
          {gardees.length === 0 ? (
            <Vide icone="chercher"><span>{phrase(`${P}.r.rien`)}</span> <Bouton ton="discret" petit onClick={() => { setQ(''); setSorte(null); }}>{titre(`${P}.r.effacer`)}</Bouton></Vide>
          ) : (
            <div className="c-defile">
              <table className="c-table c-pf-table-routes">
                <thead>
                  <tr>
                    {COLONNES.map((c) => {
                      const actif = tri.cle === c;
                      const nom = titre(`${P}.r.col.${c}`);
                      return (
                        <th key={c} scope="col" className={c === 'route' ? undefined : 'c-droite'} aria-sort={actif ? (tri.sens === 1 ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="c-pf-tri" onClick={() => cliquer(c)} aria-label={dire(`${P}.r.trier`, { colonne: nom })}>
                            {nom}
                            <span className={`c-pf-fleche${actif ? ' c-pf-fleche-active' : ''}`} aria-hidden="true">{actif ? (tri.sens === 1 ? '↑' : '↓') : '↕'}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {vues.map((r) => {
                    const b = budget(r.sorte);
                    const peu = <span className="c-pf-peu" title={dire(`${P}.r.peu_titre`, { min: d.seuils.lectures })}>{dire(`${P}.r.peu`)}</span>;
                    return (
                      <tr key={r.route}>
                        <th scope="row"><Chemin r={r} /><span className="c-sous">{maj(dire(`${P}.r.sorte.${r.sorte}`))}{b ? ` · ${dire(`${P}.b.budget`, { duree: duree(b) })}` : ''}</span></th>
                        <td className="c-droite c-mono">{entier(r.n)}</td>
                        <td className="c-droite c-mono">{r.p50 === null ? peu : duree(r.p50)}</td>
                        <td className={`c-droite c-mono${b && r.p95 !== null && r.p95 > b ? ' c-pf-au-dessus' : ''}`}>{r.p95 === null ? peu : duree(r.p95)}</td>
                        <td className="c-droite c-mono">{r.p99 === null ? peu : duree(r.p99)}</td>
                        <td className={`c-droite c-mono${r.pannes ? ' c-sv-rouge' : ''}`}>{entier(r.pannes)}{r.pannes && r.partPannes !== null ? <span className="c-sous">{pourCent(r.partPannes, 2)}</span> : null}</td>
                        <td className={`c-droite c-mono${r.lentes ? ' c-pf-au-dessus' : ''}`}>{entier(r.lentes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {gardees.length > PREMIERES ? (
            <div className="c-liste-pied c-pf-plus">
              <Bouton ton="discret" petit onClick={() => setTout(!tout)}>{tout ? titre(`${P}.r.moins`, { n: PREMIERES }) : titre(`${P}.r.tout`, { n: entier(gardees.length) })}</Bouton>
            </div>
          ) : null}
          <p className="c-sv-note c-pf-routes-note">{phrase(`${P}.r.note`)}</p>
        </>
      )}
    </section>
  );
}


// ── La base PostgreSQL ──────────────────────────────────────────────────────────────────────────────────────────────
function octets(n: number): string {
  if (n < 1024 * 1024) return dire(`${P}.bd.unite.ko`, { n: entier(Math.max(1, n / 1024)) });
  if (n < 1024 ** 3) return dire(`${P}.bd.unite.mo`, { n: entier(n / 1024 ** 2) });
  return dire(`${P}.bd.unite.go`, { n: decimal(n / 1024 ** 3, 1) });
}
function LaBase({ d }: { d: Donnees }) {
  const b = d.base;
  return (
    <section className="c-carte c-pf-base" aria-labelledby="pf-base">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-base">{titre(`${P}.bd.titre`)}</h2>
          <p className="c-carte-sous">{b?.depuis ? phrase(`${P}.bd.sous`, { quand: quand(b.depuis, d.aujourdhui) }) : phrase(`${P}.bd.sous_toujours`)}</p>
        </div>
      </div>
      {!b ? <p className="c-sg-vide">{phrase(`${P}.bd.non`)}</p> : (
        <dl className="c-pf-cartes">
          <div>
            <dt>{titre(`${P}.bd.connexions`)}</dt>
            <dd><b className="c-num">{entier(b.connexions)}</b>{b.maxConnexions ? <span className="c-num">{`/\u00a0${entier(b.maxConnexions)}`}</span> : null}</dd>
            <span>{b.maxConnexions ? dire(`${P}.bd.connexions_sous`, { max: entier(b.maxConnexions) }) : null}</span>
          </div>
          <div>
            <dt>{titre(`${P}.bd.memoire`)}</dt>
            <dd><b className="c-num">{b.enMemoire === null ? '—' : pourCent(b.enMemoire, 2)}</b></dd>
            <span>{b.enMemoire === null ? dire(`${P}.bd.memoire_non`) : dire(`${P}.bd.memoire_sous`)}</span>
          </div>
          <div>
            <dt>{titre(`${P}.bd.taille`)}</dt>
            <dd><b className="c-num">{octets(b.taille)}</b></dd>
            <span>{dire(`${P}.bd.taille_sous`)}</span>
          </div>
          <div className={b.blocages ? 'c-pf-carte-attention' : undefined}>
            <dt>{titre(`${P}.bd.blocages`)}</dt>
            <dd><b className="c-num">{entier(b.blocages)}</b></dd>
            <span>{dire(`${P}.bd.blocages_sous`)}</span>
          </div>
          <div>
            <dt>{titre(`${P}.bd.temporaires`)}</dt>
            <dd><b className="c-num">{entier(b.fichiersTemporaires)}</b></dd>
            <span>{b.fichiersTemporaires ? dire(`${P}.bd.temporaires_sous`, { taille: octets(b.octetsTemporaires) }) : dire(`${P}.bd.temporaires_aucun`)}</span>
          </div>
          <div>
            <dt>{titre(`${P}.bd.annulations`)}</dt>
            <dd><b className="c-num">{b.annulations === null ? '—' : pourCent(b.annulations, 2)}</b></dd>
            <span>{dire(`${P}.bd.annulations_sous`)}</span>
          </div>
        </dl>
      )}
      <div className="c-pf-nons">
        <p className="c-pf-non"><Icone nom="info" taille={16} /><span>{phrase(`${P}.bd.occupe`)}</span></p>
        <p className="c-pf-non"><Icone nom="info" taille={16} /><span>{phrase(`${P}.bd.replique`)}</span></p>
      </div>
    </section>
  );
}

// ── Les exemplaires du programme ────────────────────────────────────────────────────────────────────────────────────
function Exemplaires({ d }: { d: Donnees }) {
  const x = d.exemplaires;
  return (
    <section className="c-carte c-pf-exemplaires" aria-labelledby="pf-exemplaires">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-exemplaires">{titre(`${P}.x.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${P}.x.sous`)}</p>
        </div>
      </div>
      {x.length === 0 ? <p className="c-sg-vide">{phrase(`${P}.x.vide`)}</p> : (
        <ul className="c-pf-ex-liste">
          {x.map((e) => (
            <li key={e.nom} className={`c-pf-ex c-pf-ex-${e.etat}`}>
              <div className="c-pf-ex-texte">
                <span className="c-pf-ex-nom"><b className="c-mono" data-donnee>{e.nom}</b><Puce ton={PUCE[e.etat]}>{dire(e.etat === 'bon' ? `${P}.x.sert` : `${P}.x.tu`)}</Puce></span>
                <span className="c-sous">{e.etat === 'bon' ? maj(dire(`${P}.x.vu`, { quand: quand(e.derniere, d.aujourdhui) })) : phrase(`${P}.x.silence`, { duree: minutes(e.silence ?? 0) })}</span>
              </div>
              <p className="c-pf-ex-chiffre"><b className="c-num">{decimal(e.parMinute, 1)}</b><span>{dire(`${P}.x.col.req`)}</span></p>
              <p className="c-pf-ex-chiffre"><b className={`c-num${e.pannes ? ' c-sv-rouge' : ''}`}>{entier(e.pannes)}</b><span>{dire(`${P}.x.col.pannes`)}</span></p>
            </li>
          ))}
        </ul>
      )}
      <div className="c-pf-nons">
        {x.length === 1 ? <p className="c-pf-non"><Icone nom="info" taille={16} /><span>{phrase(`${P}.x.un`)}</span></p> : null}
        <p className="c-pf-non"><Icone nom="info" taille={16} /><span>{phrase(`${P}.x.machine`)} <a href="#/service">{titre(`${P}.x.machine_lien`)}</a></span></p>
      </div>
    </section>
  );
}

// ── Vu de l'extérieur : pas encore mesuré ───────────────────────────────────────────────────────────────────────────
function Exterieur() {
  return (
    <section className="c-carte c-pf-exterieur" aria-labelledby="pf-exterieur">
      <div className="c-pf-tete">
        <div>
          <h2 id="pf-exterieur">{titre(`${P}.e.titre`)}</h2>
          <p className="c-carte-sous">{maj(dire(`${P}.e.sous`))}</p>
        </div>
        <Puce ton="hors">{dire(`${K}.dispo.non_mesure`)}</Puce>
      </div>
      <div className="c-pf-exterieur-corps">
        <p>{maj(dire(`${P}.e.texte`))}</p>
        <ul>
          <li>{maj(dire(`${P}.e.l1`))}</li>
          <li>{maj(dire(`${P}.e.l2`))}</li>
          <li>{maj(dire(`${P}.e.l3`))}</li>
        </ul>
        <p className="c-pf-decider">{phrase(`${P}.e.decider`)}</p>
      </div>
    </section>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Performances({ periode: demandee }: { periode: string | null }) {
  const [periode, setPeriode] = useState<Periode>(estPeriode(demandee) ? demandee : '24h');
  useEffect(() => { history.replaceState(null, '', `#/service/performances${periode === '24h' ? '' : `?periode=${periode}`}`); }, [periode]);
  const [l, relire] = useLecture<Donnees>(`/console/service/performances?periode=${periode}`, 'service-performances');
  useRelireTantQueRegarde(relire);
  const d = l.etat === 'lu' ? l.donnees : null;
  const enCours = l.etat === 'lu' && l.enCours;
  const periodeTexte = d ? dire(`${K}.periode.texte.${d.periode}`) : '';
  return (
    <>
      <EnteteService vue="performances" d={d} relire={relire} occupe={enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <div className={`c-pf${enCours && d.periode !== periode ? ' c-sv-attente' : ''}`} aria-busy={enCours || undefined}>
          <Chiffres d={d} periodeTexte={periodeTexte} pilules={(
            <div className="c-pilules c-sv-periodes" role="group" aria-label={dire(`${P}.periode`)}>
              {PERIODES.map((p) => (
                <button key={p} type="button" className="c-pilule" aria-pressed={periode === p} onClick={() => setPeriode(p)}>{dire(`${K}.periode.${p}`)}</button>
              ))}
            </div>
          )} />
          <Budgets d={d} periodeTexte={periodeTexte} />
          <Sortes d={d} periodeTexte={periodeTexte} />
          <Trafic d={d} periodeTexte={periodeTexte} />
          <Routes d={d} />
          <div className="c-pf-duo">
            <Lentes d={d} />
            <LaBase d={d} />
          </div>
          <div className="c-pf-duo">
            <Exemplaires d={d} />
            <Exterieur />
          </div>
        </div>
      ) : null}
    </>
  );
}
