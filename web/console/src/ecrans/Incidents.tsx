// Les incidents du service et la page d'état (10 § 2.8 ; 06 § 9 ; serveur/console/routes.ts, GET
// /console/service/incidents ; serveur/console/incidents.ts ; docs/console.md C24). Un incident s'ouvre quand des clients
// risquent de sentir un problème — une alerte n'en est pas un tant que personne n'en souffre. Il suit sa fiche réflexe en
// quatre temps (contenir, dire, réparer, écrire), dit ce qu'il faut sur la page d'état publique, et se clôt avec son
// compte rendu et ses suites, chacune avec une personne et une date. Trois règles :
//   - la page d'état ne passe jamais au vert à la main : ses lignes viennent de la veille, seul le message est écrit ;
//   - une gravité monte, elle ne descend pas ;
//   - un incident n'est vraiment fini que quand ses suites le sont : elles restent sous les yeux jusqu'à faites.
import { useEffect, useRef, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier, minutes, pourCent } from '../nombres.ts';
import { heureDe, jourDe, jourMois, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import { EnteteService, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const I = `${K}.in`;

type Gravite = 'mineur' | 'majeur' | 'critique';
type Point = { le: string; par: string; texte: string; public: boolean; gravite: Gravite | null };
type Suite = { id: string; titre: string; responsable: string; due: string; faiteLe: string | null; repoussee: number };
type Incident = {
  id: string; ref: string; titre: string; gravite: Gravite; fiche: string | null; ouvertLe: string; ouvertPar: string;
  public: string | null; publicLe: string | null; fin: string | null; points: Point[]; suites: Suite[];
};
type SuiteATenir = Suite & { incident: { id: string; ref: string; titre: string }; retard: number };
type Couleur = 'vert' | 'orange' | 'rouge' | 'gris';
type PageEtat = {
  le: string; tout: { couleur: Couleur; dit: string }; lignes: { nom: string; couleur: Couleur; dit: string }[];
  annonce: { incident: { gravite: Gravite; texte: string; le: string } | null; maintenance: { titre: string; texte: string; debut: string; fin: string } | null };
};
type Maintenance =
  | { sorte: 'annoncee'; le: string; id: string; titre: string; texte: string; debut: string; fin: string; par: string; etat: 'a_venir' | 'en_cours' | 'faite' | 'annulee' }
  | { sorte: 'version'; le: string; version: string; retour: boolean; coupure: number };
type Passe = {
  id: string; ref: string; titre: string; gravite: Gravite; ouvertLe: string; minutes: number; effet: string; cause: string; change: string;
  suites: { faites: number; total: number }; points: Point[]; fiche: string | null; closPar: string | null;
};
type Passes = { lignes: Passe[]; n: number; graves: number; arret: number | null; disponibilite: number | null };
type Donnees = {
  maintenant: string; aujourdhui: string; veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[];
  ouverts: Incident[]; suites: SuiteATenir[]; suitesEnRetard: number; suitesFaites: number;
  page: PageEtat | null; disponibilite30: number | null; maintenances: Maintenance[];
  passes: { trente: Passes; annee: Passes; annee_n: number };
  fiches: Record<string, { le: string; ref: string } | null>; fichesConnues: string[];
  exercice: { jour: string; restauration: { le: string; ok: boolean } } | null;
  equipe: { id: string; nom: string }[];
};

// ── Les mots ────────────────────────────────────────────────────────────────────────────────────────────────────────
const nomGravite = (g: Gravite) => dire(`${I}.gravite.${g}`);
function PuceGravite({ g }: { g: Gravite }) {
  return <span className={`c-in-gravite c-in-gravite-${g}`}>{maj(nomGravite(g))}</span>;
}
// Une date et une heure de Tunis, telles qu'un champ « datetime-local » les montre ; et l'inverse (Tunis : UTC+1 toute
// l'année).
const enChamp = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  .format(new Date(iso)).replace(' ', 'T');
const duChamp = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+01:00` : null);
// « aujourd'hui, 16:26 », « le 02/10/2026, 21:14 » : le jour et l'heure, une fois.
const jourHeure = (iso: string, aujourdhui: string) => quand(iso, aujourdhui);
const FICHES_A_DECIDER: Record<string, 'a_decider' | 'a_verifier'> = { site: 'a_decider', fuite: 'a_verifier', rancon: 'a_verifier' };
const TEMPS = ['contenir', 'dire', 'reparer', 'ecrire'] as const;

// ── Les gestes ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Geste =
  | { sorte: 'ouvrir' }
  | { sorte: 'point'; i: Incident; public: boolean }
  | { sorte: 'retirer'; i: Incident }
  | { sorte: 'clore'; i: Incident }
  | { sorte: 'faite'; s: SuiteATenir }
  | { sorte: 'repousser'; s: SuiteATenir }
  | { sorte: 'annoncer' }
  | { sorte: 'annuler'; m: Extract<Maintenance, { sorte: 'annoncee' }> }
  | { sorte: 'lire'; p: Passe }
  | { sorte: 'fiche'; f: string };

// ── L'incident ouvert, ou l'absence d'incident ──────────────────────────────────────────────────────────────────────
function AucunIncident({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  const grave = d.alertesEnCours.graves > 0;
  return (
    <section className="c-carte c-in-aucun" aria-labelledby="in-aucun">
      <span className="c-in-aucun-icone" aria-hidden="true"><Icone nom="ok" /></span>
      <div>
        <h2 id="in-aucun">{titre(`${I}.aucun.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${I}.aucun.${grave ? 'avec_alerte' : 'sans_alerte'}`)}</p>
      </div>
      <Bouton ton="principal" icone="plus" onClick={() => faire({ sorte: 'ouvrir' })}>{titre(`${I}.ouvrir`)}</Bouton>
    </section>
  );
}

function IncidentOuvert({ i, d, faire, premier }: { i: Incident; d: Donnees; faire: (g: Geste) => void; premier: boolean }) {
  const depuis = Math.max(0, Math.round((Date.parse(d.maintenant) - Date.parse(i.ouvertLe)) / 60_000));
  return (
    <section className={`c-carte c-in-ouvert c-in-ouvert-${i.gravite}`} aria-labelledby={`in-${i.id}`}>
      <div className="c-in-ouvert-tete">
        <div>
          <div className="c-in-ouvert-ligne">
            <PuceGravite g={i.gravite} />
            <span className="c-mono" data-donnee>{i.ref}</span>
          </div>
          <h2 id={`in-${i.id}`} data-donnee>{maj(i.titre)}</h2>
          <p className="c-carte-sous">{maj(dire(depuis < 1 ? `${I}.ouvert.depuis_instant` : `${I}.ouvert.depuis`, { quand: jourHeure(i.ouvertLe, d.aujourdhui), nom: i.ouvertPar, duree: minutes(depuis) }))}</p>
        </div>
        <div className="c-in-ouvert-gestes">
          <Bouton ton={premier ? 'principal' : 'secondaire'} icone="plus" onClick={() => faire({ sorte: 'point', i, public: false })}>{titre(`${I}.point.ajouter`)}</Bouton>
          <Bouton onClick={() => faire({ sorte: 'clore', i })}>{titre(`${I}.clore.ouvrir`)}</Bouton>
        </div>
      </div>
      <div className="c-in-ouvert-corps">
        <div className="c-in-public">
          <span className="c-champ-libelle">{titre(`${I}.ouvert.page`)}</span>
          {i.public ? (
            <>
              <p className="c-in-public-texte" data-donnee>{i.public}</p>
              <p className="c-sous">{maj(dire(`${I}.ouvert.public_le`, { quand: jourHeure(i.publicLe ?? i.ouvertLe, d.aujourdhui) }))}</p>
              <div className="c-in-public-gestes">
                <Bouton petit onClick={() => faire({ sorte: 'point', i, public: true })}>{titre(`${I}.ouvert.changer_public`)}</Bouton>
                <Bouton petit ton="discret" onClick={() => faire({ sorte: 'retirer', i })}>{titre(`${I}.retirer.ouvrir`)}</Bouton>
              </div>
            </>
          ) : (
            <>
              <p className="c-sous">{phrase(`${I}.ouvert.rien_public`)}</p>
              <div className="c-in-public-gestes"><Bouton petit onClick={() => faire({ sorte: 'point', i, public: true })}>{titre(`${I}.ouvert.publier`)}</Bouton></div>
            </>
          )}
        </div>
        <div className="c-in-fiche-suivie">
          <span className="c-champ-libelle">{titre(`${I}.ouvert.fiche`)}</span>
          {i.fiche ? (
            <>
              <b>{maj(dire(`${I}.fiche.${i.fiche}.nom`))}</b>
              <p className="c-sous">{phrase(`${I}.fiche.${i.fiche}.abord`)}</p>
              <button type="button" className="c-in-lien" onClick={() => faire({ sorte: 'fiche', f: i.fiche as string })}>{titre(`${I}.fiches.lire`)}</button>
            </>
          ) : <p className="c-sous">{phrase(`${I}.ouvert.sans_fiche`)}</p>}
        </div>
      </div>
      <div className="c-in-points">
        <span className="c-champ-libelle">{titre(`${I}.ouvert.points`)}</span>
        <ol>
          <li><span className="c-in-point-quand">{heureDe(i.ouvertLe)}</span><span>{maj(dire(`${I}.ouvert.ouverture`, { nom: i.ouvertPar }))}</span></li>
          {i.points.map((p) => (
            <li key={`${p.le}${p.texte}`}>
              <span className="c-in-point-quand">{jourDe(p.le) === d.aujourdhui ? heureDe(p.le) : jourHeure(p.le, d.aujourdhui)}</span>
              <span>
                <span data-donnee>{p.texte}</span>
                <span className="c-sous">
                  {[p.par, p.public ? dire(`${I}.ouvert.point_public`) : null, p.gravite ? dire(`${I}.ouvert.point_monte`, { g: nomGravite(p.gravite) }) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── Les suites à tenir ──────────────────────────────────────────────────────────────────────────────────────────────
function Suites({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  const aTenir = d.suites.length;
  return (
    <section className="c-carte c-in-suites" aria-labelledby="in-suites">
      <div className="c-al-section-tete">
        <div>
          <h2 id="in-suites">{titre(`${I}.suites.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${I}.suites.sous`)}</p>
        </div>
        <div className="c-in-comptes">
          <span className={`c-in-compte ${aTenir ? 'c-in-compte-tenir' : 'c-in-compte-nul'}`}>{maj(selon(aTenir, `${I}.suites.a_tenir`))}</span>
          {d.suitesEnRetard ? <span className="c-in-compte c-in-compte-retard">{maj(selon(d.suitesEnRetard, `${I}.suites.en_retard`))}</span> : null}
          <span className={`c-in-compte ${d.suitesFaites ? 'c-in-compte-faites' : 'c-in-compte-nul'}`}>{maj(selon(d.suitesFaites, `${I}.suites.faites`))}</span>
        </div>
      </div>
      {aTenir === 0 ? <Vide icone="ok">{phrase(`${I}.suites.vide${d.suitesFaites ? '_faites' : ''}`)}</Vide> : (
        <ul className="c-in-suites-liste">
          {d.suites.map((s) => (
            <li key={s.id}>
              <div className="c-in-suite-quoi">
                <b data-donnee>{maj(s.titre)}</b>
                <span className="c-sous">{maj(dire(`${I}.suites.promise`))} <span className="c-mono" data-donnee>{s.incident.ref}</span> · <span data-donnee>{maj(s.incident.titre)}</span></span>
              </div>
              <div className="c-in-suite-qui"><Avatar nom={s.responsable} /><span data-donnee>{s.responsable}</span></div>
              <div className="c-in-suite-quand">
                <Puce ton={s.retard ? 'urgent' : 'aujourdhui'}>{dire(`${I}.suites.${s.retard ? 'etat_retard' : 'etat_a_faire'}`)}</Puce>
                <span className={s.retard ? 'c-in-retard' : 'c-sous'}>
                  {s.retard ? dire(`${I}.suites.due_retard`, { jour: jourMois(s.due), n: s.retard }) : maj(dire(`${I}.suites.avant`, { jour: jourMois(s.due) }))}
                  {s.repoussee ? ` · ${selon(s.repoussee, `${I}.suites.repoussee`)}` : ''}
                </span>
              </div>
              <div className="c-in-suite-gestes">
                <Bouton petit onClick={() => faire({ sorte: 'repousser', s })}>{titre(`${I}.repousser.ouvrir`)}</Bouton>
                <Bouton petit onClick={() => faire({ sorte: 'faite', s })}>{titre(`${I}.faite.ouvrir`)}</Bouton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="c-liste-pied">{phrase(`${I}.suites.pied`)}</p>
    </section>
  );
}

// ── La page d'état, telle que n'importe qui la lit ──────────────────────────────────────────────────────────────────
function PageDEtat({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  const p = d.page;
  const ouvert = d.ouverts[0] ?? null;
  // La page publique ne change qu'au passage de la veille : un message qui n'a plus lieu d'être (incident clos ou
  // message retiré, maintenance annulée ou finie) y reste jusque-là. L'écran le dit, sinon on croit l'avoir oublié.
  const perime = !!p && ((!!p.annonce.incident && !d.ouverts.some((i) => i.public))
    || (!!p.annonce.maintenance && !d.maintenances.some((m) => m.sorte === 'annoncee' && (m.etat === 'a_venir' || m.etat === 'en_cours'))));
  // L'inverse : ce qu'on vient d'annoncer n'y est pas encore (un message publié après le dernier passage, une maintenance
  // qui entre dans ses quarante-huit heures).
  const attend = !!p && ((!!ouvert?.publicLe && Date.parse(ouvert.publicLe) > Date.parse(p.le))
    || (!p.annonce.maintenance && d.maintenances.some((m) => m.sorte === 'annoncee' && (m.etat === 'a_venir' || m.etat === 'en_cours')
      && Date.parse(m.debut) - Date.parse(d.maintenant) <= 48 * 3_600_000)));
  return (
    <section className="c-carte c-in-page" aria-labelledby="in-page">
      <div className="c-al-section-tete">
        <div>
          <h2 id="in-page">{titre(`${I}.page.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${I}.page.sous`)}</p>
        </div>
        <Bouton desactive={!ouvert} onClick={() => { if (ouvert) faire({ sorte: 'point', i: ouvert, public: true }); }}>{titre(`${I}.page.publier`)}</Bouton>
      </div>
      {!ouvert ? <p className="c-in-pourquoi">{phrase(`${I}.page.publier_sans`)}</p> : null}
      {p ? (
        <div className="c-in-apercu" aria-label={titre(`${I}.page.apercu`)}>
          <div className="c-in-apercu-tete">
            <span className="c-in-apercu-logo" aria-hidden="true">S</span>
            <b>{titre(`${I}.page.etat_de`)}</b>
            <span className="c-sous">{dire(`${I}.page.mis_a_jour`, { heure: heureDe(p.le) })}</span>
          </div>
          <p className={`c-in-apercu-tout c-in-c-${p.tout.couleur}`}><span className="c-in-point" aria-hidden="true" />{p.tout.dit}</p>
          {p.annonce.incident ? (
            <div className={`c-in-apercu-annonce c-in-c-${p.annonce.incident.gravite === 'mineur' ? 'orange' : 'rouge'}`}>
              <b>{titre(`${I}.page.incident_${p.annonce.incident.gravite}`)}</b>
              <p data-donnee>{p.annonce.incident.texte}</p>
            </div>
          ) : null}
          {p.annonce.maintenance ? (
            <div className="c-in-apercu-annonce c-in-c-bleu">
              <b data-donnee>{p.annonce.maintenance.titre}</b>
              <p data-donnee>{p.annonce.maintenance.texte}</p>
              <span className="c-sous">{maj(quand(p.annonce.maintenance.debut, d.aujourdhui))} → {jourDe(p.annonce.maintenance.fin) === jourDe(p.annonce.maintenance.debut) ? heureDe(p.annonce.maintenance.fin) : quand(p.annonce.maintenance.fin, d.aujourdhui)}</span>
            </div>
          ) : null}
          <ul>
            {p.lignes.map((l) => (
              <li key={l.nom} className={`c-in-c-${l.couleur}`}><span className="c-in-point" aria-hidden="true" /><b>{l.nom}</b><span>{l.dit}</span></li>
            ))}
          </ul>
        </div>
      ) : <Vide icone="serveur">{phrase(`${I}.page.absente`)}</Vide>}
      {attend ? <p className="c-in-attend">{phrase(`${I}.page.attend`)}</p> : null}
      {perime ? <p className="c-in-attend">{phrase(`${I}.page.perime`)}</p> : null}
      {d.disponibilite30 !== null ? <p className="c-in-dispo">{phrase(`${I}.page.dispo`, { taux: pourCent(d.disponibilite30) })}</p> : null}
      <p className="c-liste-pied">{phrase(`${I}.page.pied`)}</p>
    </section>
  );
}

// ── Les maintenances ────────────────────────────────────────────────────────────────────────────────────────────────
function Maintenances({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  const montrees = d.maintenances.slice(0, 6);
  return (
    <section className="c-carte c-in-maintenances" aria-labelledby="in-maint">
      <div className="c-al-section-tete">
        <div>
          <h2 id="in-maint">{titre(`${I}.maint.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${I}.maint.sous`)}</p>
        </div>
        <Bouton onClick={() => faire({ sorte: 'annoncer' })}>{titre(`${I}.annoncer.ouvrir`)}</Bouton>
      </div>
      {montrees.length === 0 ? <Vide icone="calendrier">{phrase(`${I}.maint.vide`)}</Vide> : (
        <ul className="c-in-maint-liste">
          {montrees.map((m) => {
            const j = jourDe(m.le);
            return (
              <li key={m.sorte === 'annoncee' ? m.id : `${m.version}${m.le}`}>
                <span className="c-in-jour" aria-hidden="true"><b>{j.slice(8, 10)}</b><span>{dire(`${I}.mois.${Number(j.slice(5, 7))}`)}</span></span>
                <div>
                  {m.sorte === 'annoncee' ? (
                    <>
                      <b data-donnee>{maj(m.titre)} · {heureDe(m.debut)} → {heureDe(m.fin)}</b>
                      <p className="c-sous" data-donnee>{m.texte}</p>
                      <p className={`c-in-maint-etat c-in-maint-${m.etat}`}>
                        {maj(dire(`${I}.maint.etat.${m.etat}`, { quand: quand(m.debut, d.aujourdhui), nom: m.par }))}
                        {m.etat === 'a_venir' ? <> · <button type="button" className="c-in-lien" onClick={() => faire({ sorte: 'annuler', m })}>{titre(`${I}.annuler.ouvrir`)}</button></> : null}
                      </p>
                    </>
                  ) : (
                    <>
                      <b>{maj(dire(`${I}.maint.version`, { version: m.version, heure: heureDe(m.le) }))}</b>
                      <p className="c-sous">{phrase(`${I}.maint.${m.retour ? 'version_retour' : 'version_sans_annonce'}`)}</p>
                      <p className={`c-in-maint-etat c-in-maint-${m.coupure ? 'coupure' : 'faite'}`}>
                        {m.coupure ? maj(dire(`${I}.maint.avec_coupure`, { duree: minutes(m.coupure) })) : maj(dire(`${I}.maint.sans_coupure`))}
                      </p>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {d.maintenances.length > montrees.length ? <p className="c-sous">{selon(d.maintenances.length - montrees.length, `${I}.maint.autres`)}</p> : null}
      <p className="c-liste-pied">{phrase(`${I}.maint.pied`)}</p>
    </section>
  );
}

// ── Les incidents passés ────────────────────────────────────────────────────────────────────────────────────────────
function Passes({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  const [sur, setSur] = useState<'trente' | 'annee'>('trente');
  const p = d.passes[sur];
  return (
    <section className="c-carte c-liste-carte c-in-passes" aria-labelledby="in-passes">
      <div className="c-al-section-tete">
        <div>
          <h2 id="in-passes">{titre(`${I}.passes.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${I}.passes.sous`)}</p>
        </div>
      </div>
      <div className="c-segments c-in-periodes" role="group" aria-label={dire(`${I}.passes.periode`)}>
        <button type="button" className="c-pilule" aria-pressed={sur === 'trente'} onClick={() => setSur('trente')}>{titre(`${I}.passes.trente`)}</button>
        <button type="button" className="c-pilule" aria-pressed={sur === 'annee'} onClick={() => setSur('annee')}>{titre(`${I}.passes.annee`, { annee: d.passes.annee_n })}</button>
      </div>
      <div className="c-in-chiffres">
        <div><span>{titre(`${I}.passes.n`)}</span><b>{entier(p.n)}</b></div>
        <div><span>{titre(`${I}.passes.graves`)}</span><b>{entier(p.graves)}</b></div>
        <div><span>{titre(`${I}.passes.arret`)}</span><b>{p.arret === null ? '—' : minutes(p.arret)}</b></div>
        <div><span>{titre(`${I}.passes.dispo`)}</span><b>{p.disponibilite === null ? '—' : pourCent(p.disponibilite)}</b></div>
        <p className="c-sous">{phrase(p.arret === null ? `${I}.passes.non_mesure` : `${I}.passes.explique`)}</p>
      </div>
      {p.lignes.length === 0 ? <Vide icone="ok">{phrase(`${I}.passes.vide`)}</Vide> : (
        <div className="c-defile">
          <table className="c-table c-in-table">
            <thead>
              <tr>
                <th scope="col">{titre(`${I}.passes.col.incident`)}</th>
                <th scope="col">{titre(`${I}.passes.col.quand`)}</th>
                <th scope="col" className="c-droite">{titre(`${I}.passes.col.duree`)}</th>
                <th scope="col">{titre(`${I}.passes.col.gravite`)}</th>
                <th scope="col">{titre(`${I}.passes.col.effet`)}</th>
                <th scope="col">{titre(`${I}.passes.col.suites`)}</th>
                <th scope="col"><span className="c-cache">{titre(`${I}.passes.col.lire`)}</span></th>
              </tr>
            </thead>
            <tbody>
              {p.lignes.map((l) => (
                <tr key={l.id}>
                  <td><b data-donnee>{maj(l.titre)}</b><span className="c-sous c-mono" data-donnee>{l.ref}</span></td>
                  <td className="c-al-nw">{maj(jourHeure(l.ouvertLe, d.aujourdhui))}</td>
                  <td className="c-droite c-al-nw c-num">{minutes(l.minutes)}</td>
                  <td><PuceGravite g={l.gravite} /></td>
                  <td data-donnee>{l.effet}</td>
                  <td className="c-al-nw">
                    <span className={`c-in-suites-etat c-in-suites-${l.suites.total === 0 ? 'aucune' : l.suites.faites === l.suites.total ? 'faites' : 'reste'}`}>
                      {l.suites.total === 0 ? dire(`${I}.passes.suites_aucune`) : l.suites.faites === l.suites.total ? maj(dire(`${I}.passes.suites_toutes`)) : dire(`${I}.passes.suites_sur`, { f: l.suites.faites, n: l.suites.total })}
                    </span>
                  </td>
                  <td className="c-droite"><Bouton petit onClick={() => faire({ sorte: 'lire', p: l })} etiquette={dire(`${I}.passes.lire_de`, { ref: l.ref })}>{titre(`${I}.passes.lire`)}</Bouton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Les règles d'un incident (À DÉCIDER) et les fiches réflexes ────────────────────────────────────────────────────
function Regles() {
  return (
    <section className="c-in-regles" aria-labelledby="in-regles">
      <div className="c-in-titre-badge"><h2 id="in-regles">{titre(`${I}.regles.titre`)}</h2><span className="c-in-badge">{dire(`${I}.a_decider`)}</span></div>
      <p className="c-carte-sous">{phrase(`${I}.regles.sous`)}</p>
      <div className="c-in-regles-grille">
        {(['mineur', 'majeur', 'critique'] as const).map((g) => (
          <div key={g} className={`c-carte c-in-regle c-in-regle-${g}`}>
            <PuceGravite g={g} />
            <p>{phrase(`${I}.regles.${g}.quand`)}</p>
            <ul>{[1, 2, 3].map((n) => <li key={n}>{phrase(`${I}.regles.${g}.r${n}`)}</li>)}</ul>
          </div>
        ))}
      </div>
      <p className="c-liste-pied">{phrase(`${I}.regles.pied`)}</p>
    </section>
  );
}

function Fiches({ d, faire }: { d: Donnees; faire: (g: Geste) => void }) {
  return (
    <section className="c-in-fiches" aria-labelledby="in-fiches" id="in-fiches">
      <h2 id="in-fiches">{titre(`${I}.fiches.titre`)}</h2>
      <p className="c-carte-sous">{phrase(`${I}.fiches.sous`)}</p>
      <div className="c-in-fiches-grille">
        {d.fichesConnues.map((f) => {
          const servie = d.fiches[f] ?? null;
          const badge = FICHES_A_DECIDER[f];
          const exercee = f === 'base' && d.exercice ? d.exercice : null;
          return (
            <article key={f} className="c-carte c-in-fiche">
              <div className="c-in-fiche-tete"><h3>{maj(dire(`${I}.fiche.${f}.nom`))}</h3>{badge ? <span className="c-in-badge">{dire(`${I}.${badge}`)}</span> : null}</div>
              <p className="c-sous">{phrase(`${I}.fiche.${f}.situation`)}</p>
              <p className="c-in-abord"><b>{dire(`${I}.fiches.abord`)}</b> {phrase(`${I}.fiche.${f}.abord`)}</p>
              <div className="c-in-fiche-pied">
                <button type="button" className="c-in-lien" onClick={() => faire({ sorte: 'fiche', f })}>{titre(`${I}.fiches.lire`)}</button>
                <span className="c-sous" {...(servie ? { title: servie.ref } : {})}>
                  {servie ? maj(dire(`${I}.fiches.servie`, { jour: jourMois(jourDe(servie.le)) }))
                    : exercee ? maj(dire(`${I}.fiches.exercee`, { jour: jourMois(exercee.jour) })) : maj(dire(`${I}.fiches.jamais`))}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ── Les fenêtres ────────────────────────────────────────────────────────────────────────────────────────────────────
function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [champ, setChamp] = useState<{ nom: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const envoyer = (chemin: string, corps: unknown, dit: string) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setChamp((c) => ({ nom: r.corps.champ as string, n: (c?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const refuser = (texte: string, nom: string) => { setRefus(texte); setChamp((c) => ({ nom, n: (c?.n ?? 0) + 1 })); };
  return { envoyer, refus, setRefus, faute: (nom: string) => champ?.nom === nom, n: champ?.n ?? 0, occupe, refuser };
}

function Qui() {
  const { moi } = useConsole();
  return <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>;
}
// « Annuler » à côté d'un bouton qui annule quelque chose ferait lire deux fois le même mot pour deux gestes contraires :
// la fenêtre nomme alors sa sortie (`sortie`).
function Pied({ fermer, occupe, envoyer, bouton, sortie }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string; sortie?: string }) {
  return (
    <>
      <Bouton onClick={fermer} desactive={occupe}>{sortie ?? titre('console.ecran.annuler')}</Bouton>
      <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{bouton}</Bouton>
    </>
  );
}
const motifCourt = (m: string) => m.trim().length < 3;

function FenetreOuvrir({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [t, setT] = useState('');
  const [g, setG] = useState<Gravite>('mineur');
  const [fiche, setFiche] = useState('');
  const [publier, setPublier] = useState(false);
  const [pub, setPub] = useState('');
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (t.trim().length < 3) { e.refuser(phrase(`${I}.ouvrir_f.titre_court`), 'titre'); return; }
    if (publier && pub.trim().length < 3) { e.refuser(phrase(`${I}.ouvrir_f.public_court`), 'public'); return; }
    if (motifCourt(motif)) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer('/console/service/incidents', { titre: t.trim(), gravite: g, fiche: fiche || null, public: publier ? pub.trim() : null, motif: motif.trim() },
      phrase(`${I}.ouvrir_f.fait`));
  };
  return (
    <Dialogue titre={titre(`${I}.ouvrir_f.nom`)} sous={phrase(`${I}.ouvrir_f.sous`)} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${I}.ouvrir_f.bouton`)} />}>
      <Champ libelle={titre(`${I}.ouvrir_f.titre`)} aide={phrase(`${I}.ouvrir_f.titre_aide`)} valeur={t} changer={(v) => { setT(v); e.setRefus(null); }} faute={e.faute('titre')} n={e.n} />
      <div className="c-champ">
        <span className="c-champ-libelle" id="in-grav">{titre(`${I}.ouvrir_f.gravite`)}</span>
        <div className="c-pilules c-in-pilules" role="group" aria-labelledby="in-grav">
          {(['mineur', 'majeur', 'critique'] as const).map((x) => (
            <button key={x} type="button" className="c-pilule" aria-pressed={g === x} onClick={() => setG(x)}>{maj(nomGravite(x))}</button>
          ))}
        </div>
        <span className="c-champ-aide">{phrase(`${I}.regles.${g}.quand`)}</span>
      </div>
      <Choix libelle={titre(`${I}.ouvrir_f.fiche`)} aide={phrase(`${I}.ouvrir_f.fiche_aide`)} valeur={fiche} changer={setFiche}
        options={[{ valeur: '', texte: maj(dire(`${I}.ouvrir_f.aucune_fiche`)) }, ...d.fichesConnues.map((f) => ({ valeur: f, texte: maj(dire(`${I}.fiche.${f}.nom`)) }))]} />
      <label className="c-in-case">
        <input type="checkbox" checked={publier} onChange={(x) => setPublier(x.target.checked)} />
        <span>{phrase(`${I}.ouvrir_f.publier`)}</span>
      </label>
      {publier ? <Zone libelle={titre(`${I}.ouvrir_f.public`)} aide={phrase(`${I}.ouvrir_f.public_aide`)} valeur={pub} changer={(v) => { setPub(v); e.setRefus(null); }} faute={e.faute('public')} n={e.n} /> : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${I}.ouvrir_f.motif_aide`)} valeur={motif} changer={(v) => { setMotif(v); e.setRefus(null); }} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetrePoint({ i, publicDemande, fermer, fait }: { i: Incident; publicDemande: boolean; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [texte, setTexte] = useState(publicDemande && i.public ? i.public : '');
  const [pub, setPub] = useState(publicDemande);
  const plus = (['mineur', 'majeur', 'critique'] as const).filter((x) => ['mineur', 'majeur', 'critique'].indexOf(x) > ['mineur', 'majeur', 'critique'].indexOf(i.gravite));
  const [monte, setMonte] = useState<Gravite | ''>('');
  const envoyer = () => {
    if (texte.trim().length < 3) { e.refuser(phrase(`${I}.point.court`), 'texte'); return; }
    if (pub && /[<>]/.test(texte)) { e.refuser(phrase(`${I}.point.balise`), 'texte'); return; }
    e.envoyer(`/console/service/incidents/${i.id}/points`, { texte: texte.trim(), public: pub, gravite: monte || null },
      phrase(pub ? `${I}.point.fait_public` : `${I}.point.fait`));
  };
  return (
    <Dialogue titre={titre(pub ? `${I}.point.titre_public` : `${I}.point.titre`)} sous={`${i.ref} · ${maj(i.titre)}`} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(pub ? `${I}.point.bouton_public` : `${I}.point.bouton`)} />}>
      <Zone libelle={titre(pub ? `${I}.point.texte_public` : `${I}.point.texte`)} aide={phrase(pub ? `${I}.point.aide_public` : `${I}.point.aide`)} valeur={texte}
        changer={(v) => { setTexte(v); e.setRefus(null); }} faute={e.faute('texte')} n={e.n} />
      <label className="c-in-case">
        <input type="checkbox" checked={pub} onChange={(x) => setPub(x.target.checked)} />
        <span>{phrase(`${I}.point.case_public`)}</span>
      </label>
      {plus.length ? (
        <div className="c-champ">
          <span className="c-champ-libelle" id="in-monte">{titre(`${I}.point.monte`)}</span>
          <div className="c-pilules c-in-pilules" role="group" aria-labelledby="in-monte">
            <button type="button" className="c-pilule" aria-pressed={monte === ''} onClick={() => setMonte('')}>{maj(dire(`${I}.point.reste`, { g: nomGravite(i.gravite) }))}</button>
            {plus.map((x) => <button key={x} type="button" className="c-pilule" aria-pressed={monte === x} onClick={() => setMonte(x)}>{maj(nomGravite(x))}</button>)}
          </div>
          <span className="c-champ-aide">{phrase(`${I}.point.monte_aide`)}</span>
        </div>
      ) : null}
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreMotif({ titreF, sous, points, chemin, corps, dit, bouton, sortie, fermer, fait }: {
  titreF: string; sous: string; points: string[]; chemin: string; corps: Record<string, unknown>; dit: string; bouton: string; sortie?: string; fermer: () => void; fait: () => void;
}) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motifCourt(motif)) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(chemin, { ...corps, motif: motif.trim() }, dit);
  };
  return (
    <Dialogue titre={titreF} sous={sous} fermer={fermer} occupe={e.occupe} pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={bouton} {...(sortie ? { sortie } : {})} />}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>{points.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={(v) => { setMotif(v); e.setRefus(null); }} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRepousser({ s, d, fermer, fait }: { s: SuiteATenir; d: Donnees; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [due, setDue] = useState('');
  const [motif, setMotif] = useState('');
  const plusTard = due > s.due && due >= d.aujourdhui;
  const envoyer = () => {
    if (!plusTard) { e.refuser(phrase(`${I}.repousser.date`, { jour: jourMois(s.due) }), 'due'); return; }
    if (motifCourt(motif)) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/service/suites/${s.id}/repousser`, { due, motif: motif.trim() }, phrase(`${I}.repousser.fait`, { jour: jourMois(due) }));
  };
  return (
    <Dialogue titre={titre(`${I}.repousser.titre`)} sous={maj(s.titre)} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${I}.repousser.bouton`)} />}>
      <Champ libelle={titre(`${I}.repousser.nouvelle`)} aide={phrase(`${I}.repousser.aide`, { jour: jourMois(s.due), n: s.repoussee })} type="date" valeur={due}
        changer={(v) => { setDue(v); e.setRefus(null); }} faute={e.faute('due')} n={e.n} />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${I}.repousser.motif_aide`)} valeur={motif} changer={(v) => { setMotif(v); e.setRefus(null); }} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

type SuiteSaisie = { titre: string; responsable: string; due: string };
function FenetreClore({ i, d, fermer, fait }: { i: Incident; d: Donnees; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const { moi } = useConsole();
  const [fin, setFin] = useState(() => enChamp(d.maintenant));
  const [effet, setEffet] = useState('');
  const [cause, setCause] = useState('');
  const [change, setChange] = useState('');
  const moiDansLEquipe = d.equipe.find((x) => x.nom === moi.nom)?.id ?? d.equipe[0]?.id ?? '';
  const [suitesS, setSuites] = useState<SuiteSaisie[]>([]);
  // Une suite ajoutée reçoit le curseur : on la nomme tout de suite, sans aller la chercher.
  const suitesRef = useRef<HTMLDivElement>(null);
  const ajoutee = useRef(false);
  useEffect(() => {
    if (!ajoutee.current) return;
    ajoutee.current = false;
    const toutes = suitesRef.current?.querySelectorAll('.c-in-suite-saisie');
    toutes?.[toutes.length - 1]?.querySelector<HTMLInputElement>('input')?.focus();
  }, [suitesS.length]);
  const [motif, setMotif] = useState('');
  const poser = (k: number, p: Partial<SuiteSaisie>) => setSuites((l) => l.map((x, j) => (j === k ? { ...x, ...p } : x)));
  const envoyer = () => {
    const finIso = duChamp(fin);
    if (!finIso || Date.parse(finIso) > Date.parse(d.maintenant) + 60_000) { e.refuser(phrase(`${I}.clore.fin_passee`), 'fin'); return; }
    for (const [nom, v] of [['effet', effet], ['cause', cause], ['change', change]] as const) {
      if (v.trim().length < 10) { e.refuser(phrase(`${I}.clore.${nom}_court`), nom); return; }
    }
    const k = suitesS.findIndex((s) => s.titre.trim().length < 3 || !s.responsable || !s.due || s.due < d.aujourdhui);
    if (k >= 0) { e.refuser(phrase(`${I}.clore.suite_incomplete`, { n: k + 1 }), `suite${k}`); return; }
    if (motifCourt(motif)) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/service/incidents/${i.id}/clore`, {
      fin: finIso, effet: effet.trim(), cause: cause.trim(), change: change.trim(), motif: motif.trim(),
      suites: suitesS.map((s) => ({ titre: s.titre.trim(), responsable: s.responsable, due: s.due })),
    }, phrase(`${I}.clore.fait`, { ref: i.ref }));
  };
  return (
    <Dialogue titre={titre(`${I}.clore.titre`)} sous={`${i.ref} · ${maj(i.titre)}`} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${I}.clore.bouton`)} />}>
      <p className="c-sous">{phrase(`${I}.clore.explique`)}</p>
      <Champ libelle={titre(`${I}.clore.fin`)} aide={phrase(`${I}.clore.fin_aide`)} type="datetime-local" valeur={fin} changer={(v) => { setFin(v); e.setRefus(null); }} faute={e.faute('fin')} n={e.n} />
      <Zone libelle={titre(`${I}.clore.effet`)} aide={phrase(`${I}.clore.effet_aide`)} max={2000} valeur={effet} changer={(v) => { setEffet(v); e.setRefus(null); }} faute={e.faute('effet')} n={e.n} />
      <Zone libelle={titre(`${I}.clore.cause`)} aide={phrase(`${I}.clore.cause_aide`)} max={2000} valeur={cause} changer={(v) => { setCause(v); e.setRefus(null); }} faute={e.faute('cause')} n={e.n} />
      <Zone libelle={titre(`${I}.clore.change`)} aide={phrase(`${I}.clore.change_aide`)} max={2000} valeur={change} changer={(v) => { setChange(v); e.setRefus(null); }} faute={e.faute('change')} n={e.n} />
      <div className="c-champ c-in-suites-saisie" ref={suitesRef}>
        <span className="c-champ-libelle">{titre(`${I}.clore.suites`)}</span>
        <span className="c-champ-aide">{phrase(`${I}.clore.suites_aide`)}</span>
        {suitesS.map((s, k) => (
          <fieldset key={k} className="c-in-suite-saisie">
            <legend>{maj(dire(`${I}.clore.suite_n`, { n: k + 1 }))}</legend>
            <Champ libelle={titre(`${I}.clore.suite_titre`)} valeur={s.titre} changer={(v) => { poser(k, { titre: v }); e.setRefus(null); }} faute={e.faute(`suite${k}`)} n={e.n} />
            <div className="c-in-suite-saisie-ligne">
              <Choix libelle={titre(`${I}.clore.suite_qui`)} valeur={s.responsable} changer={(v) => poser(k, { responsable: v })}
                options={d.equipe.map((x) => ({ valeur: x.id, texte: x.nom, donnee: true }))} />
              <Champ libelle={titre(`${I}.clore.suite_due`)} type="date" valeur={s.due} changer={(v) => { poser(k, { due: v }); e.setRefus(null); }} />
            </div>
            <Bouton petit ton="discret" onClick={() => setSuites((l) => l.filter((_, j) => j !== k))}>{titre(`${I}.clore.suite_retirer`)}</Bouton>
          </fieldset>
        ))}
        {suitesS.length < 20 ? <Bouton petit icone="plus" onClick={() => { ajoutee.current = true; setSuites((l) => [...l, { titre: '', responsable: moiDansLEquipe, due: '' }]); }}>{titre(`${I}.clore.suite_ajouter`)}</Bouton> : null}
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={(v) => { setMotif(v); e.setRefus(null); }} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreAnnoncer({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const demain = enChamp(new Date(Date.parse(`${d.aujourdhui}T01:00:00Z`) + 86_400_000).toISOString());
  const [t, setT] = useState('');
  const [texte, setTexte] = useState('');
  const [debut, setDebut] = useState(demain);
  const [fin, setFin] = useState(enChamp(new Date(Date.parse(`${d.aujourdhui}T02:00:00Z`) + 86_400_000).toISOString()));
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (t.trim().length < 3 || /[<>]/.test(t)) { e.refuser(phrase(`${I}.annoncer.titre_court`), 'titre'); return; }
    if (texte.trim().length < 3 || /[<>]/.test(texte)) { e.refuser(phrase(`${I}.annoncer.texte_court`), 'texte'); return; }
    const a = duChamp(debut), b = duChamp(fin);
    if (!a || Date.parse(a) <= Date.parse(d.maintenant)) { e.refuser(phrase(`${I}.annoncer.debut_futur`), 'debut'); return; }
    if (!b || Date.parse(b) <= Date.parse(a) || Date.parse(b) - Date.parse(a) > 12 * 3_600_000) { e.refuser(phrase(`${I}.annoncer.douze`), 'fin'); return; }
    if (motifCourt(motif)) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer('/console/service/maintenances', { titre: t.trim(), texte: texte.trim(), debut: a, fin: b, motif: motif.trim() }, phrase(`${I}.annoncer.fait`));
  };
  return (
    <Dialogue titre={titre(`${I}.annoncer.titre`)} sous={phrase(`${I}.annoncer.sous`)} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${I}.annoncer.bouton`)} />}>
      <Champ libelle={titre(`${I}.annoncer.quoi`)} aide={phrase(`${I}.annoncer.quoi_aide`)} valeur={t} changer={(v) => { setT(v); e.setRefus(null); }} faute={e.faute('titre')} n={e.n} />
      <Zone libelle={titre(`${I}.annoncer.texte`)} aide={phrase(`${I}.annoncer.texte_aide`)} valeur={texte} changer={(v) => { setTexte(v); e.setRefus(null); }} faute={e.faute('texte')} n={e.n} />
      <div className="c-in-suite-saisie-ligne">
        <Champ libelle={titre(`${I}.annoncer.debut`)} type="datetime-local" valeur={debut} changer={(v) => { setDebut(v); e.setRefus(null); }} faute={e.faute('debut')} n={e.n} />
        <Champ libelle={titre(`${I}.annoncer.fin`)} type="datetime-local" valeur={fin} changer={(v) => { setFin(v); e.setRefus(null); }} faute={e.faute('fin')} n={e.n} />
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={(v) => { setMotif(v); e.setRefus(null); }} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreLire({ p, d, fermer }: { p: Passe; d: Donnees; fermer: () => void }) {
  return (
    <Dialogue titre={`${p.ref} · ${maj(p.titre)}`} sous={maj(dire(`${I}.lire.sous`, { quand: jourHeure(p.ouvertLe, d.aujourdhui), duree: minutes(p.minutes), g: nomGravite(p.gravite) }))} fermer={fermer}
      pied={<Bouton onClick={fermer}>{titre('console.ecran.fermer')}</Bouton>}>
      {(['effet', 'cause', 'change'] as const).map((k) => (
        <div key={k} className="c-in-cr">
          <span className="c-champ-libelle">{titre(`${I}.clore.${k}`)}</span>
          <p data-donnee>{p[k]}</p>
        </div>
      ))}
      {p.points.length ? (
        <div className="c-in-cr">
          <span className="c-champ-libelle">{titre(`${I}.ouvert.points`)}</span>
          <ol className="c-in-cr-points">{p.points.map((x) => <li key={`${x.le}${x.texte}`}><span className="c-sous">{maj(jourHeure(x.le, d.aujourdhui))} · {x.par}</span> <span data-donnee>{x.texte}</span></li>)}</ol>
        </div>
      ) : null}
      <p className="c-sous">{p.suites.total ? phrase(`${I}.lire.suites`, { f: entier(p.suites.faites), n: entier(p.suites.total) }) : phrase(`${I}.lire.sans_suite`)}{p.closPar ? ` ${phrase(`${I}.lire.clos_par`, { nom: p.closPar })}` : ''}</p>
    </Dialogue>
  );
}

function FenetreFiche({ f, fermer }: { f: string; fermer: () => void }) {
  return (
    <Dialogue titre={maj(dire(`${I}.fiche.${f}.nom`))} sous={phrase(`${I}.fiche.${f}.situation`)} fermer={fermer} pied={<Bouton onClick={fermer}>{titre('console.ecran.fermer')}</Bouton>}>
      <ol className="c-in-temps">
        {TEMPS.map((t) => (
          <li key={t}><b>{dire(`${I}.temps.${t}`)}</b><p>{phrase(`${I}.fiche.${f}.${t}`)}</p></li>
        ))}
      </ol>
      {FICHES_A_DECIDER[f] ? <Alerte ton="attention"><span>{phrase(`${I}.fiches.${FICHES_A_DECIDER[f]}_dit`)}</span></Alerte> : null}
    </Dialogue>
  );
}

function Fenetre({ g, d, fermer, fait }: { g: Geste; d: Donnees; fermer: () => void; fait: () => void }) {
  switch (g.sorte) {
    case 'ouvrir': return <FenetreOuvrir d={d} fermer={fermer} fait={fait} />;
    case 'point': return <FenetrePoint i={g.i} publicDemande={g.public} fermer={fermer} fait={fait} />;
    case 'clore': return <FenetreClore i={g.i} d={d} fermer={fermer} fait={fait} />;
    case 'repousser': return <FenetreRepousser s={g.s} d={d} fermer={fermer} fait={fait} />;
    case 'annoncer': return <FenetreAnnoncer d={d} fermer={fermer} fait={fait} />;
    case 'lire': return <FenetreLire p={g.p} d={d} fermer={fermer} />;
    case 'fiche': return <FenetreFiche f={g.f} fermer={fermer} />;
    case 'retirer':
      return <FenetreMotif titreF={titre(`${I}.retirer.titre`)} sous={`${g.i.ref} · ${maj(g.i.titre)}`} points={[phrase(`${I}.retirer.p1`), phrase(`${I}.retirer.p2`)]}
        chemin={`/console/service/incidents/${g.i.id}/retirer`} corps={{}} dit={phrase(`${I}.retirer.fait`)} bouton={titre(`${I}.retirer.bouton`)} fermer={fermer} fait={fait} />;
    case 'faite':
      return <FenetreMotif titreF={titre(`${I}.faite.titre`)} sous={maj(g.s.titre)} points={[phrase(`${I}.faite.p1`, { ref: g.s.incident.ref }), phrase(`${I}.faite.p2`)]}
        chemin={`/console/service/suites/${g.s.id}/faite`} corps={{}} dit={phrase(`${I}.faite.fait`)} bouton={titre(`${I}.faite.bouton`)} fermer={fermer} fait={fait} />;
    case 'annuler':
      return <FenetreMotif titreF={titre(`${I}.annuler.titre`)} sous={maj(g.m.titre)} points={[phrase(`${I}.annuler.p1`), phrase(`${I}.annuler.p2`)]}
        chemin={`/console/service/maintenances/${g.m.id}/annuler`} corps={{}} dit={phrase(`${I}.annuler.fait`)} bouton={titre(`${I}.annuler.bouton`)} sortie={titre(`${I}.annuler.garder`)} fermer={fermer} fait={fait} />;
  }
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Incidents() {
  const [l, relire] = useLecture<Donnees>('/console/service/incidents', 'service-incidents');
  useRelireTantQueRegarde(relire);
  const [geste, setGeste] = useState<Geste | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  return (
    <>
      <EnteteService vue="incidents" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          {d.ouverts.length ? (
            <div className="c-in-ouverts">
              <div className="c-in-ouverts-tete">
                <span className="c-sous">{maj(selon(d.ouverts.length, `${I}.ouverts`))}</span>
                <Bouton petit icone="plus" onClick={() => setGeste({ sorte: 'ouvrir' })}>{titre(`${I}.ouvrir_autre`)}</Bouton>
              </div>
              {d.ouverts.map((i, k) => <IncidentOuvert key={i.id} i={i} d={d} faire={setGeste} premier={k === 0} />)}
            </div>
          ) : <AucunIncident d={d} faire={setGeste} />}
          <Suites d={d} faire={setGeste} />
          <div className="c-in-duo">
            <PageDEtat d={d} faire={setGeste} />
            <Maintenances d={d} faire={setGeste} />
          </div>
          <Passes d={d} faire={setGeste} />
          <Regles />
          <Fiches d={d} faire={setGeste} />
        </>
      ) : null}
      {geste && d ? <Fenetre g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
