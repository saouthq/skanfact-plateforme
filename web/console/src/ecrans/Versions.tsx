// Les versions du service (10 § 2.8 ; serveur/console/routes.ts, GET /console/service/versions ;
// serveur/console/versions.ts ; docs/console.md C27). Le suiveur installe seul la dernière version vérifiée ; l'écran
// dit ce qu'il a fait et ce qu'il va faire :
//   - quatre chiffres : la version en service, le suiveur (son dernier regard), la prochaine, la base ;
//   - la version en service et celle d'avant (on peut y revenir), la prochaine et où elle en est, les consignes données
//     au suiveur (geler, retenir, revenir — chacune avec son motif, au journal), l'historique des installations, les
//     tâches d'entretien et la machine.
// Rien n'est inventé : ni pré-production, ni deux exemplaires, ni les versions des postes de nos clients — le serveur
// ne les connaît pas, et l'écran ne les montre pas.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { duree as dureeMs, entier, pourCent } from '../nombres.ts';
import { heureDe, jourCourt, jourDe, quand } from '../temps.ts';
import { nomDeVersion } from '../version.ts';
import { Alerte, Bouton, Choix, Dialogue, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import { EnteteService, EtatPuce, Tuile, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type EtatBrique, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const V = `${K}.ve`;

type Verdict = 'vert' | 'rouge' | 'en_cours';
type Ligne = {
  version: string; le: string; dureeS: number | null; ok: boolean; etape: string | null; retour: boolean; migrations: number[];
  sansReponse: number | null; statut: 'en_service' | 'remplacee' | 'echouee'; remplaceePar: string | null; source: 'suiveur' | 'veille';
};
type Consigne = {
  id: string; sorte: 'gel' | 'retenue' | 'retour'; version: string | null; quitte: string | null; jusquAu: string | null; motif: string; par: string; le: string;
  enVigueur: boolean; faiteLe: string | null; faiteOk: boolean | null; faiteRaison: string | null; leveeLe: string | null; leveePar: string | null; leveeMotif: string | null;
};
// L'effet de chaque version (0140, C64) : ce que la base sait de la période où elle a tourné, et ce qui est pire qu'avant.
type Incident = { id: string; annee: number; numero: number; titre: string; gravite: 'mineur' | 'majeur' | 'critique'; ouvertLe: string };
type Effet = {
  version: string; debut: string; fin: string; jours: number; requetes: number; pannes: number; part: number | null; p95: number | null;
  incidents: Incident[]; demandes: number | null; clients: number | null; pire: ('pannes' | 'lenteur' | 'incidents' | 'demandes')[];
};
type Prochaine = { version: string; titre: string; le: string; verification: Verdict | null; preuves: Verdict | null; etat: string; nombre: number };
type Donnees = {
  maintenant: string; aujourdhui: string; role: 'direction' | 'technique'; veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[];
  suiveur: {
    version: string | null; installeeLe: string | null; regardeLe: string | null; derniere: string | null; verification: 'aucune' | 'github' | 'toutes' | null;
    echec: { version: string; etape: string; message: string; le: string } | null; consignesLues: string | null; consignesIllisibles: string | null; plan: string | null;
  } | null;
  titres: Record<string, string>; numeros: Record<string, string>; dansLeDepot: string[]; historique: Ligne[]; avant: { version: string; le: string; possible: boolean } | null;
  prochaine: Prochaine | null; consignes: Consigne[]; migrations: { numero: number; nom: string; le: string }[]; effets: Effet[];
  taches: { numero: string; nom: string; titre: string | null; etat: 'passee' | 'echouee' | 'pas_encore'; le: string | null; sortie: string | null }[];
  machine: { systeme: string | null; node: string; postgres: string | null; correctifs: string | null; redemarrage: { depuis: string; paquets: number | null } | null };
};
type Geste = { sorte: 'geler' } | { sorte: 'retenir' | 'revenir'; version: string } | { sorte: 'lever'; consigne: Consigne };

// Le suiveur passe toutes les deux minutes : sans regard depuis six, il s'est arrêté.
const SUIVEUR_ARRETE_MS = 6 * 60_000;
const duree = (s: number) => (s < 60 ? dire(`${V}.s`, { n: s }) : dire(`${V}.min_s`, { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }));
const gelEnCours = (d: Donnees) => d.consignes.find((c) => c.enVigueur && c.sorte === 'gel') ?? null;
// Les versions retenues (une retenue, ou la version quittée par un retour qui tient) : elles ne se proposent pas.
const retenuesDe = (d: Donnees) => new Set(d.consignes.filter((c) => c.enVigueur && c.sorte !== 'gel').map((c) => (c.sorte === 'retour' ? c.quitte : c.version)));
const retourOuvert = (d: Donnees) => d.consignes.find((c) => c.enVigueur && c.sorte === 'retour' && !c.faiteLe) ?? null;

function Version({ v, d }: { v: string; d: Donnees }) {
  const t = d.titres[v];
  return <span className="c-ve-version"><b className="c-mono" data-donnee title={v}>{nomDeVersion(v, d.numeros)}</b>{t ? <span data-donnee>{t}</span> : null}</span>;
}

// ── Les quatre chiffres ─────────────────────────────────────────────────────────────────────────────────────────────
function Chiffres({ d }: { d: Donnees }) {
  const s = d.suiveur;
  const silence = s?.regardeLe ? Date.parse(d.maintenant) - Date.parse(s.regardeLe) : null;
  const etatSuiveur: EtatBrique = silence === null ? 'nonmesure' : silence > SUIVEUR_ARRETE_MS ? 'grave' : 'bon';
  const p = d.prochaine;
  const etatProchaine: EtatBrique | undefined = p && (p.etat === 'rouge' || p.etat === 'echouee') ? 'attention' : undefined;
  const m = d.migrations[0];
  const enService = d.historique.find((l) => l.statut === 'en_service');
  return (
    <section className="c-sv-claires" aria-label={titre(`${V}.k.titre`)}>
      <div className="c-sv-tuiles c-tr-tuiles">
        <Tuile titre={titre(`${V}.k.en_service`)} etat={s?.echec ? 'attention' : s?.version ? 'bon' : 'nonmesure'} donnee
          {...(s?.version ? { valeur: nomDeVersion(s.version, d.numeros) } : { mot: true, valeur: titre(`${V}.k.pas_lu`) })}
          sous={s?.version ? maj(dire(s.installeeLe ? `${V}.k.depuis` : `${V}.k.depuis_inconnu`, { quand: s.installeeLe ? quand(s.installeeLe, d.aujourdhui) : '' }))
            + (enService?.dureeS !== null && enService?.dureeS !== undefined ? ` · ${dire(`${V}.k.en`, { duree: duree(enService.dureeS) })}` : '') : phrase(`${V}.k.suiveur_muet`)} />
        <Tuile titre={titre(`${V}.k.suiveur`)} etat={etatSuiveur} mot
          valeur={s?.regardeLe ? maj(quand(s.regardeLe, d.aujourdhui)) : titre(`${V}.k.pas_lu`)}
          sous={silence !== null && silence > SUIVEUR_ARRETE_MS ? phrase(`${V}.k.suiveur_arrete`)
            : phrase(`${V}.k.suiveur_sous`, { attend: dire(`${V}.verif.${s?.verification ?? 'toutes'}`) })} />
        <Tuile titre={titre(`${V}.k.prochaine`)} {...(etatProchaine ? { etat: etatProchaine } : {})} mot={!p} donnee={Boolean(p)}
          valeur={p ? nomDeVersion(p.version, d.numeros) : titre(`${V}.k.a_jour`)}
          sous={p ? maj(dire(`${V}.etat.${p.etat}`)) : phrase(`${V}.k.a_jour_sous`)} />
        <Tuile titre={titre(`${V}.k.base`)} {...(m ? { valeur: String(m.numero).padStart(4, '0'), donnee: true } : { mot: true, valeur: titre(`${V}.k.pas_lu`) })}
          sous={m ? phrase(`${V}.k.base_sous`, { nom: m.nom, jour: jourCourt(m.le) }) : phrase(`${V}.k.base_rien`)} />
      </div>
    </section>
  );
}

// ── Ce qui demande un regard tout de suite : un échec, un gel, un retour en cours ───────────────────────────────────
function Bandeaux({ d, geste }: { d: Donnees; geste: (g: Geste) => void }) {
  const s = d.suiveur;
  const gel = gelEnCours(d);
  const retour = retourOuvert(d);
  return (
    <>
      {!s ? <Alerte ton="attention">{phrase(`${V}.b.illisible`)}</Alerte> : null}
      {s?.echec ? (
        <Alerte ton="danger">
          <span><b>{phrase(`${V}.b.echec`, { version: nomDeVersion(s.echec.version, d.numeros), etape: s.echec.etape, quand: quand(s.echec.le, d.aujourdhui) })}</b>
            {s.echec.message ? <span className="c-sous c-mono" data-donnee> {s.echec.message}</span> : null}</span>
        </Alerte>
      ) : null}
      {gel ? (
        <Alerte ton="attention">
          <span>{phrase(`${V}.b.gel`, { jusquAu: gel.jusquAu ? `${jourCourt(gel.jusquAu)} ${heureDe(gel.jusquAu)}` : '—', par: gel.par, motif: gel.motif })}</span>
          <span><Bouton petit onClick={() => geste({ sorte: 'lever', consigne: gel })}>{titre(`${V}.b.lever_gel`)}</Bouton></span>
        </Alerte>
      ) : null}
      {retour?.version ? (
        <Alerte ton="info">
          <span>{phrase(s?.consignesLues ? `${V}.b.retour` : `${V}.b.retour_pas_lu`, { version: nomDeVersion(retour.version, d.numeros), par: retour.par })}</span>
          <span><Bouton petit onClick={() => geste({ sorte: 'lever', consigne: retour })}>{titre(`${V}.b.annuler_retour`)}</Bouton></span>
        </Alerte>
      ) : null}
    </>
  );
}

// ── La version en service, et celle d'avant ─────────────────────────────────────────────────────────────────────────
function EnService({ d, geste }: { d: Donnees; geste: (g: Geste) => void }) {
  const s = d.suiveur;
  const l = d.historique.find((x) => x.statut === 'en_service');
  if (!s?.version) return null;
  const retour = retourOuvert(d);
  const avantRetenue = Boolean(d.avant && retenuesDe(d).has(d.avant.version));
  return (
    <section className="c-carte c-ve-service" aria-labelledby="ve-service">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-service">{titre(`${V}.s.titre`)}</h2>
        <p className="c-ve-titre-version"><Version v={s.version} d={d} /> <EtatPuce etat="bon" texte={titre(`${V}.s.en_service`)} /></p>
      </div></div>
      <dl className="c-ve-faits">
        <div><dt>{titre(`${V}.s.installee`)}</dt><dd>{s.installeeLe ? maj(quand(s.installeeLe, d.aujourdhui)) : phrase(`${V}.s.avant_le_suivi`)}
          {l?.dureeS !== null && l?.dureeS !== undefined ? ` · ${duree(l.dureeS)}` : ''}
          {l?.sansReponse ? ` · ${selon(l.sansReponse, `${V}.s.sans_reponse`)}` : l && l.sansReponse === 0 ? ` · ${dire(`${V}.s.sans_coupure`)}` : ''}</dd></div>
        <div><dt>{titre(`${V}.s.par`)}</dt><dd>{phrase(l?.retour ? `${V}.s.par_retour` : `${V}.s.par_suiveur`)}</dd></div>
        <div><dt>{titre(`${V}.s.verifiee`)}</dt><dd>{phrase(`${V}.verif_long.${s.verification ?? 'toutes'}`)}</dd></div>
        <div><dt>{titre(`${V}.s.base`)}</dt><dd>{l?.migrations.length ? phrase(`${V}.s.migrations`, { liste: l.migrations.map((n) => String(n).padStart(4, '0')).join(', ') }) : phrase(`${V}.s.aucune_migration`)}</dd></div>
        <div><dt>{titre(`${V}.s.avant`)}</dt><dd>{d.avant ? <>
          <Version v={d.avant.version} d={d} />
          <span className="c-sous c-ve-ligne">{maj(dire(`${V}.s.installee_le`, { quand: quand(d.avant.le, d.aujourdhui) }))} · {dire(avantRetenue ? `${V}.s.retenue` : d.avant.possible ? `${V}.s.possible` : `${V}.s.trop_vieille`)}</span>
        </> : phrase(`${V}.s.pas_d_avant`)}</dd></div>
      </dl>
      {d.avant?.possible && !retour && !avantRetenue ? (
        <div className="c-ve-geste">
          <Bouton icone="retour" onClick={() => geste({ sorte: 'revenir', version: (d.avant as { version: string }).version })}>{titre(`${V}.s.revenir`, { version: nomDeVersion(d.avant.version, d.numeros) })}</Bouton>
          <p className="c-sous">{phrase(`${V}.s.revenir_dit`)}</p>
        </div>
      ) : null}
    </section>
  );
}

// ── La prochaine version ────────────────────────────────────────────────────────────────────────────────────────────
function Etape({ nom, etat, texte, sous }: { nom: string; etat: EtatBrique; texte: string; sous: string }) {
  return (
    <li className={`c-ve-etape c-ve-etape-${etat}`}>
      <span className="c-ve-point" aria-hidden="true" />
      <div><b>{nom}</b> <EtatPuce etat={etat} texte={texte} /><span className="c-sous">{sous}</span></div>
    </li>
  );
}
const etatDuVerdict = (v: Verdict | null): EtatBrique => (v === 'vert' ? 'bon' : v === 'rouge' ? 'grave' : v === 'en_cours' ? 'attention' : 'nonmesure');
function LaProchaine({ d, geste }: { d: Donnees; geste: (g: Geste) => void }) {
  const p = d.prochaine;
  const s = d.suiveur;
  const gel = gelEnCours(d);
  return (
    <section className="c-carte c-ve-prochaine" aria-labelledby="ve-prochaine">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-prochaine">{titre(`${V}.p.titre`)}</h2>
        {p ? <p className="c-ve-titre-version"><Version v={p.version} d={d} /></p> : null}
      </div></div>
      {!s ? <Vide icone="info">{phrase(`${V}.p.sans_suiveur`)}</Vide> : !p ? <Vide>{phrase(`${V}.p.vide`)}</Vide> : (
        <>
          {p.nombre > 1 ? <p className="c-sous">{maj(selon(p.nombre - 1, `${V}.p.plusieurs`, { n: entier(p.nombre - 1) }))}</p> : null}
          <ol className="c-ve-etapes">
            <Etape nom={titre(`${V}.p.envoyee`)} etat="bon" texte={titre(`${V}.p.faite`)} sous={maj(quand(p.le, d.aujourdhui))} />
            <Etape nom={titre(`${V}.p.verification`)} etat={s.verification === 'aucune' ? 'nonmesure' : etatDuVerdict(p.verification)}
              texte={s.verification === 'aucune' ? titre(`${V}.p.pas_attendue`) : titre(`${V}.verdict.${p.verification ?? 'en_cours'}`)} sous={phrase(`${V}.p.verification_dit`)} />
            <Etape nom={titre(`${V}.p.preuves`)} etat={s.verification !== 'toutes' ? 'nonmesure' : etatDuVerdict(p.preuves)}
              texte={s.verification !== 'toutes' ? titre(`${V}.p.pas_attendues`) : titre(`${V}.verdict.${p.preuves ?? 'en_cours'}`)} sous={phrase(`${V}.p.preuves_dit`)} />
            <Etape nom={titre(`${V}.p.production`)} etat={p.etat === 'prete' ? 'bon' : p.etat === 'rouge' || p.etat === 'echouee' ? 'grave' : 'attention'}
              texte={titre(`${V}.etat.${p.etat}`)} sous={phrase(`${V}.p.production_dit.${p.etat}`)} />
          </ol>
          <div className="c-ve-geste">
            {p.etat !== 'retenue' ? <Bouton onClick={() => geste({ sorte: 'retenir', version: p.version })}>{titre(`${V}.p.retenir`)}</Bouton> : null}
            {!gel ? <Bouton onClick={() => geste({ sorte: 'geler' })}>{titre(`${V}.p.geler`)}</Bouton> : null}
          </div>
        </>
      )}
      {s && !p && !gel ? <div className="c-ve-geste"><Bouton onClick={() => geste({ sorte: 'geler' })}>{titre(`${V}.p.geler`)}</Bouton></div> : null}
      <p className="c-liste-pied">{phrase(`${V}.p.pied`)}</p>
    </section>
  );
}

// ── Les consignes données au suiveur ────────────────────────────────────────────────────────────────────────────────
function Consignes({ d, geste }: { d: Donnees; geste: (g: Geste) => void }) {
  const lues = d.suiveur?.consignesLues;
  // 1.29.0 (l'audit C04) : le dernier tour n'a pas pu les lire ; il n'a rien installé.
  const illisibles = d.suiveur?.consignesIllisibles;
  const etatDe = (c: Consigne) => (c.leveeLe ? 'levee' : c.sorte === 'retour' && c.faiteLe ? (c.faiteOk ? 'faite' : 'pas_faite') : c.enVigueur ? 'en_vigueur' : 'finie');
  return (
    <section className="c-carte c-ve-consignes" aria-labelledby="ve-consignes">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-consignes">{titre(`${V}.c.titre`)}</h2>
        {illisibles ? <Alerte ton="attention"><span>{phrase(lues ? `${V}.c.illisibles` : `${V}.c.illisibles_jamais`, { heure: heureDe(illisibles), lues: lues ? heureDe(lues) : '' })}</span></Alerte>
          : <p className="c-carte-sous">{phrase(lues ? `${V}.c.lues` : `${V}.c.pas_lues`, { heure: lues ? heureDe(lues) : '' })}</p>}
      </div></div>
      {d.consignes.length ? (
        <ul className="c-ve-consignes-liste">
          {d.consignes.map((c) => {
            const e = etatDe(c);
            return (
              <li key={c.id} className={c.enVigueur ? 'c-ve-consigne-vive' : undefined}>
                <div className="c-ve-consigne-tete">
                  <b>{maj(dire(`${V}.c.sorte.${c.sorte}`, { version: c.version ? nomDeVersion(c.version, d.numeros) : '', quitte: c.quitte ? nomDeVersion(c.quitte, d.numeros) : '',
                    jusquAu: c.jusquAu ? `${jourCourt(c.jusquAu)} ${heureDe(c.jusquAu)}` : '' }))}</b>
                  <Puce ton={e === 'en_vigueur' ? 'a_regarder' : e === 'pas_faite' ? 'en_retard' : 'hors'}>{dire(`${V}.c.etat.${e}`)}</Puce>
                </div>
                <p className="c-sous"><span data-donnee>« {c.motif} »</span> · {dire(`${V}.c.par`, { nom: c.par, quand: quand(c.le, d.aujourdhui) })}
                  {c.leveeLe ? ` · ${dire(`${V}.c.levee_par`, { nom: c.leveePar ?? '—', quand: quand(c.leveeLe, d.aujourdhui) })}` : ''}
                  {c.faiteLe ? ` · ${dire(c.faiteOk ? `${V}.c.faite_le` : `${V}.c.raison.${c.faiteRaison ?? 'installation'}`, { quand: quand(c.faiteLe, d.aujourdhui) })}` : ''}</p>
                {c.enVigueur ? <div className="c-ve-geste"><Bouton petit onClick={() => geste({ sorte: 'lever', consigne: c })}>{titre(`${V}.c.lever`)}</Bouton></div> : null}
              </li>
            );
          })}
        </ul>
      ) : <Vide icone="info">{phrase(`${V}.c.vide`)}</Vide>}
    </section>
  );
}

// ── L'historique ────────────────────────────────────────────────────────────────────────────────────────────────────
function Historique({ d, geste }: { d: Donnees; geste: (g: Geste) => void }) {
  const retour = retourOuvert(d);
  // Une version retenue (ou quittée par un retour) ne se propose pas : on la lève d'abord, dans les consignes.
  const retenues = retenuesDe(d);
  const reussies = d.historique.filter((l) => l.ok).length, echouees = d.historique.length - reussies;
  return (
    <section className="c-carte c-ve-historique" aria-labelledby="ve-historique">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-historique">{titre(`${V}.h.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${V}.h.sous`)}</p>
      </div></div>
      {d.historique.length ? (
        <>
          <p className="c-sous">{maj(selon(reussies, `${V}.h.reussies`))}{echouees ? ` · ${selon(echouees, `${V}.h.echouees`)}` : ''}</p>
          <div className="c-defile">
            <table className="c-table c-ve-table">
              <thead><tr>
                <th scope="col">{titre(`${V}.h.col.version`)}</th><th scope="col">{titre(`${V}.h.col.installee`)}</th>
                <th scope="col" className="c-droite">{titre(`${V}.h.col.duree`)}</th><th scope="col">{titre(`${V}.h.col.base`)}</th>
                <th scope="col">{titre(`${V}.h.col.passe`)}</th><th scope="col"><span className="c-cache">{titre(`${V}.h.col.revenir`)}</span></th>
              </tr></thead>
              <tbody>
                {d.historique.map((l, i) => {
                  const peut = l.statut === 'remplacee' && d.dansLeDepot.includes(l.version) && l.version !== d.suiveur?.version && !retour && !retenues.has(l.version);
                  return (
                    <tr key={`${l.version}${l.le}${i}`}>
                      <td><Version v={l.version} d={d} /></td>
                      <td className="c-ve-nowrap" data-libelle={titre(`${V}.h.col.installee`)}>{maj(quand(l.le, d.aujourdhui))}</td>
                      <td className="c-droite c-ve-nowrap" data-libelle={titre(`${V}.h.col.duree`)}>{l.dureeS === null ? '—' : duree(l.dureeS)}</td>
                      <td data-libelle={titre(`${V}.h.col.base`)}>{l.migrations.length ? l.migrations.map((n) => String(n).padStart(4, '0')).join(', ') : '—'}</td>
                      <td data-libelle={titre(`${V}.h.col.passe`)}>
                        <Puce ton={l.statut === 'en_service' ? 'actif' : l.statut === 'echouee' ? 'en_retard' : 'hors'}>{dire(`${V}.h.statut.${l.statut}`)}</Puce>
                        <span className="c-sous"> {l.statut === 'echouee' ? phrase(`${V}.h.echec`, { etape: l.etape ?? 'installation' })
                          : l.remplaceePar ? maj(dire(`${V}.h.remplacee_par`, { version: nomDeVersion(l.remplaceePar, d.numeros) })) : ''}
                        {l.retour ? ` ${dire(`${V}.h.retour`)}` : ''}{l.source === 'veille' ? ` ${dire(`${V}.h.vue_veille`)}` : ''}
                        {l.sansReponse ? ` ${selon(l.sansReponse, `${V}.s.sans_reponse`)}` : ''}</span>
                      </td>
                      <td className="c-droite">{peut ? <Bouton petit onClick={() => geste({ sorte: 'revenir', version: l.version })}>{titre(`${V}.h.y_revenir`)}</Bouton> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : <Vide icone="info">{phrase(`${V}.h.vide`)}</Vide>}
    </section>
  );
}

// ── L'effet de chaque version (0140, C64) : ses requêtes, ses pannes, sa lenteur, ses incidents et, pour la direction, les
// demandes au support, pendant qu'elle tournait ; ce qui est pire qu'avec la version d'avant se dit en orange ────────────
function Effets({ d }: { d: Donnees }) {
  const direction = d.role === 'direction';
  const enService = (e: Effet) => e.version === d.suiveur?.version && d.effets[0] === e;
  return (
    <section className="c-carte c-ve-effets" aria-labelledby="ve-effets">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-effets">{titre(`${V}.e.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${V}.e.sous`)}</p>
      </div></div>
      {d.effets.length ? (
        <div className="c-defile">
          <table className="c-table c-ve-table">
            <thead><tr>
              <th scope="col">{titre(`${V}.e.col.version`)}</th><th scope="col" className="c-droite">{titre(`${V}.e.col.requetes`)}</th>
              <th scope="col" className="c-droite">{titre(`${V}.e.col.pannes`)}</th><th scope="col" className="c-droite">{titre(`${V}.e.col.p95`)}</th>
              <th scope="col">{titre(`${V}.e.col.incidents`)}</th>
              {direction ? <th scope="col">{titre(`${V}.e.col.demandes`)}</th> : null}
              <th scope="col">{titre(`${V}.e.col.pire`)}</th>
            </tr></thead>
            <tbody>
              {d.effets.map((e) => (
                <tr key={`${e.version}${e.debut}`} data-version={e.version}>
                  <td><Version v={e.version} d={d} />
                    <span className="c-sous c-bloc">{maj(enService(e) ? dire(`${V}.e.depuis`, { du: jourCourt(jourDe(e.debut)) }) : dire(`${V}.e.du_au`, { du: jourCourt(jourDe(e.debut)), au: jourCourt(jourDe(e.fin)) }))}</span></td>
                  <td className="c-droite c-num" data-libelle={titre(`${V}.e.col.requetes`)}>{entier(e.requetes)}</td>
                  <td className="c-droite c-num c-ve-nowrap" data-libelle={titre(`${V}.e.col.pannes`)}>{e.part === null ? '—' : <>{pourCent(e.part)}<span className="c-sous c-bloc">{selon(e.pannes, `${V}.e.pannes`)}</span></>}</td>
                  <td className="c-droite c-num c-ve-nowrap" data-libelle={titre(`${V}.e.col.p95`)}>{e.p95 === null ? <span className="c-sous">{maj(dire(`${V}.e.peu`))}</span> : dureeMs(e.p95)}</td>
                  <td className="c-ve-incidents" data-libelle={titre(`${V}.e.col.incidents`)}>{e.incidents.length
                    ? e.incidents.map((i) => <span key={i.id} className="c-bloc"><Puce ton={i.gravite === 'mineur' ? 'hors' : 'en_retard'}>{dire(`${V}.e.gravite.${i.gravite}`)}</Puce>{' '}
                      <span data-donnee>{`${i.annee}-${String(i.numero).padStart(3, '0')} · ${i.titre}`}</span></span>)
                    : <span className="c-sous">{maj(dire(`${V}.e.aucun`))}</span>}</td>
                  {direction ? <td data-libelle={titre(`${V}.e.col.demandes`)}>{e.demandes === null ? '—'
                    : e.demandes ? maj(`${selon(e.demandes, `${V}.e.demandes`)} · ${selon(e.clients ?? 0, `${V}.e.clients`)}`) : <span className="c-sous">{maj(dire(`${V}.e.aucune`))}</span>}</td> : null}
                  <td data-libelle={titre(`${V}.e.col.pire`)}>{e.pire.length
                    ? e.pire.map((x) => <span key={x} className="c-ve-pire"><Puce ton="en_retard">{dire(`${V}.e.pire.${x}`)}</Puce> </span>)
                    : <span className="c-sous">{maj(dire(d.effets.indexOf(e) === d.effets.length - 1 ? `${V}.e.rien_avant` : `${V}.e.comme_avant`))}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Vide icone="info">{phrase(`${V}.e.vide`)}</Vide>}
    </section>
  );
}

// ── Les tâches d'entretien ──────────────────────────────────────────────────────────────────────────────────────────
function Taches({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-ve-taches" aria-labelledby="ve-taches">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-taches">{titre(`${V}.t.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${V}.t.sous`)}</p>
      </div></div>
      {d.taches.length ? (
        <ul className="c-ve-taches-liste">
          {d.taches.map((t) => (
            <li key={t.nom}>
              <span className="c-mono c-ve-numero">{t.numero}</span>
              <div><b data-donnee>{t.titre ? maj(t.titre) : t.nom}</b>{t.sortie ? <span className="c-sous c-mono" data-donnee>{t.sortie}</span> : null}</div>
              <span className="c-ve-tache-etat">
                <EtatPuce etat={t.etat === 'passee' ? 'bon' : t.etat === 'echouee' ? 'grave' : 'nonmesure'} texte={titre(`${V}.t.etat.${t.etat}`)} />
                {t.le ? <span className="c-sous">{jourCourt(t.le)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <Vide icone="info">{phrase(`${V}.t.vide`)}</Vide>}
    </section>
  );
}

// ── La machine ──────────────────────────────────────────────────────────────────────────────────────────────────────
function Machine({ d }: { d: Donnees }) {
  const m = d.machine;
  return (
    <section className="c-carte c-ve-machine" aria-labelledby="ve-machine">
      <div className="c-al-section-tete"><div>
        <h2 id="ve-machine">{titre(`${V}.m.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${V}.m.sous`)}</p>
      </div></div>
      <dl className="c-ve-faits">
        <div><dt>{titre(`${V}.m.systeme`)}</dt><dd data-donnee>{m.systeme ?? '—'}</dd></div>
        <div><dt>{titre(`${V}.m.node`)}</dt><dd className="c-mono">{m.node}</dd></div>
        <div><dt>{titre(`${V}.m.postgres`)}</dt><dd className="c-mono">{m.postgres ?? '—'}</dd></div>
        <div><dt>{titre(`${V}.m.correctifs`)}</dt><dd>{m.correctifs ? phrase(`${V}.m.correctifs_le`, { quand: quand(m.correctifs, d.aujourdhui) }) : phrase(`${V}.m.correctifs_pas_lu`)}</dd></div>
        <div><dt>{titre(`${V}.m.redemarrage`)}</dt><dd>{m.redemarrage
          ? <span className="c-tr-mal">{phrase(m.redemarrage.paquets ? `${V}.m.redemarrage_demande_n` : `${V}.m.redemarrage_demande`, { quand: quand(m.redemarrage.depuis, d.aujourdhui), n: m.redemarrage.paquets ?? 0 })}</span>
          : phrase(`${V}.m.redemarrage_non`)}</dd></div>
      </dl>
      <p className="c-liste-pied">{phrase(`${V}.m.pied`)}</p>
    </section>
  );
}

// ── Les gestes ──────────────────────────────────────────────────────────────────────────────────────────────────────
const DUREES_GEL = ['2', '12', '24', '48', '72', '168', '336'] as const;
function FenetreGeste({ g, d, fermer, fait }: { g: Geste; d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [heures, setHeures] = useState<string>('24');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const cle = g.sorte === 'lever' ? `lever_${g.consigne.sorte}` : g.sorte;
  const version = g.sorte === 'retenir' || g.sorte === 'revenir' ? g.version : g.sorte === 'lever' ? g.consigne.version : null;
  const jusquAu = new Date(Date.parse(d.maintenant) + Number(heures) * 3_600_000).toISOString();
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = g.sorte === 'geler' ? await api('POST', '/console/service/versions/geler', { jusquAu, motif: motif.trim() })
          : g.sorte === 'lever' ? await api('POST', `/console/service/versions/consignes/${g.consigne.id}/lever`, { motif: motif.trim() })
            : await api('POST', `/console/service/versions/${g.sorte}`, { version: g.version, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200 || res.statut === 201) { toast(phrase(`${V}.g.${cle}.fait`)); fait(); return; }
        setRefus(refusDe(res));
        if (res.corps.champ === 'motif') setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const valeurs = { version: version ? nomDeVersion(version, d.numeros) : '', en_service: d.suiveur?.version ? nomDeVersion(d.suiveur.version, d.numeros) : '—',
    jusquAu: `${jourCourt(jusquAu)} ${heureDe(jusquAu)}` };
  return (
    <Dialogue titre={titre(`${V}.g.${cle}.titre`, valeurs)} sous={version ? d.titres[version] ?? nomDeVersion(version, d.numeros) : undefined} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre(`${V}.g.${cle}.garder`, valeurs)}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${V}.g.${cle}.bouton`, valeurs)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>
          {['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${V}.g.${cle}.${p}`, valeurs)}</li>)}
        </ul>
      </div>
      {g.sorte === 'geler' ? <Choix libelle={titre(`${V}.g.geler.duree`)} valeur={heures} changer={setHeures}
        options={DUREES_GEL.map((h) => ({ valeur: h, texte: dire(`${V}.g.geler.h${h}`) }))} /> : null}
      {/* Le refus reste jusqu'au clic suivant : effacé à la frappe, il ferait remonter le bouton sous le curseur. */}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${V}.g.${cle}.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Versions() {
  const [l, relire] = useLecture<Donnees>('/console/service/versions', 'service-versions');
  useRelireTantQueRegarde(relire);
  const [geste, setGeste] = useState<Geste | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  return (
    <>
      <EnteteService vue="versions" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <Chiffres d={d} />
          <Bandeaux d={d} geste={setGeste} />
          <div className="c-ve-duo">
            <EnService d={d} geste={setGeste} />
            <LaProchaine d={d} geste={setGeste} />
          </div>
          <Consignes d={d} geste={setGeste} />
          <Historique d={d} geste={setGeste} />
          <Effets d={d} />
          <div className="c-ve-duo">
            <Taches d={d} />
            <Machine d={d} />
          </div>
        </>
      ) : null}
      {geste && d ? <FenetreGeste g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
