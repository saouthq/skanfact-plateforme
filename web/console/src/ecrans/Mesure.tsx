// La mesure (serveur/console/routes.ts, GET /console/mesure ; serveur/console/mesure.ts ; 0116 ; la maquette « Mesure » ;
// docs/console.md C39). Comment la plateforme sert, sans jamais lire ce qu'elle contient : tout se lit par offre, jamais
// par client nommé. Ce que la base sait déjà compter a ses chiffres (l'entonnoir, les inscriptions, les départs, les
// offres, ce qu'on promet) ; ce qui demanderait des événements envoyés par l'application (les écrans, les parcours, les
// refus, le motif d'un départ, la satisfaction) est dit « pas encore mesuré », jamais un zéro.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { useLecture } from '../contexte.ts';
import { entier } from '../nombres.ts';
import { jourCourt, moisEnMots } from '../temps.ts';
import { Alerte, Bouton, Puce } from '../ui.tsx';
import { EtatPuce } from './Service.tsx';

type Periode = 'semaine' | 'mois' | 'trente';
type Offre = 'essai' | 'essentiel' | 'complet';
type Donnees = {
  aujourdhui: string; periode: Periode;
  entonnoir: { essais: number; servi: number; pris: number; abonnees: number; parOffre: { essentiel: number; complet: number }; annuel: number; mensuel: number };
  inscriptions: { periode: number; avant: number; du: string; au: string };
  departs: { depuis: string | null; resiliations: number; nonRenouveles: number };
  parOffre: { offre: Offre; n: number; pieces: number | null; membres: number | null; modules: { paie: number | null; compta: number | null } }[];
  promesses: {
    support: { mois: string; tenues: number; dues: number }[]; heures: number;
    urgentes: { tenues: number; dues: number }; heuresUrgente: number; attendLePlus: number | null;
  };
};
const K = 'console.ecran.mesure';
const PERIODES: readonly Periode[] = ['semaine', 'mois', 'trente'];
// La liste des événements que l'application enverrait : PROPOSÉE, pas décidée (règle du projet : jamais une donnée de
// plus vers un serveur sans liste comptée et décidée). Rien n'est envoyé tant qu'elle ne l'est pas.
const EVENEMENTS = ['ecran', 'geste', 'refus', 'etape', 'affichage', 'erreur', 'inscription', 'premiere_piece', 'abonnement', 'resiliation',
  'module', 'recherche', 'aide', 'visite'] as const;

const pour = (n: number, sur: number) => (sur > 0 ? Math.round((100 * n) / sur) : 0);
const unChiffre = (x: number | null) => (x === null ? '—' : Number.isInteger(x) ? entier(x) : x.toLocaleString('fr-FR'));

function PasMesure({ children }: { children: string }) {
  return <p className="c-me-pas"><EtatPuce etat="nonmesure" texte={dire(`${K}.pas_mesure`)} /> <span className="c-sous">{children}</span></p>;
}

// Le bandeau : l'entonnoir des trente derniers jours, ses quatre étapes, et les inscriptions de la période.
function Bandeau({ e, i, periode }: { e: Donnees['entonnoir']; i: Donnees['inscriptions']; periode: Periode }) {
  const etapes = [
    { cle: 'inscrites', n: e.essais, sous: phrase(`${K}.f.inscrites_sous`) },
    { cle: 'servi', n: e.servi, sous: selon(e.essais - e.servi, `${K}.f.servi_sous`) },
    { cle: 'pris', n: e.pris, sous: phrase(`${K}.f.pris_sous`) },
    { cle: 'abonnees', n: e.abonnees, sous: selon(Math.max(e.servi - e.abonnees, 0), `${K}.f.abonnees_sous`) },
  ];
  return (
    <section className="c-me-bandeau" aria-labelledby="me-entonnoir">
      <div className="c-me-bandeau-haut">
        <div>
          <p className="c-me-surtitre" id="me-entonnoir">{titre(`${K}.f.titre`)}</p>
          {e.essais === 0 ? <h2 className="c-me-titre-vide">{phrase(`${K}.f.aucun`)}</h2> : (
            <>
              <h2>{dire(`${K}.f.titre_grand`, { part: entier(pour(e.abonnees, e.essais)) })}</h2>
              <p className="c-me-bandeau-sous">{phrase(`${K}.f.detail`, { n: entier(e.abonnees), sur: entier(e.essais), essentiel: entier(e.parOffre.essentiel),
                complet: entier(e.parOffre.complet), annuel: entier(e.annuel), mensuel: entier(e.mensuel) })}</p>
            </>
          )}
        </div>
        <div className="c-me-inscriptions">
          <p className="c-me-surtitre-clair">{titre(`${K}.i.titre`)}</p>
          <p className="c-me-inscriptions-n"><b className="c-mono">{entier(i.periode)}</b> {dire(`${K}.i.cette.${periode}`)}</p>
          <p className="c-me-bandeau-sous">{dire(`${K}.i.avant.${periode}`, { n: entier(i.avant) })}</p>
        </div>
      </div>
      {e.essais === 0 ? null : (
        <ol className="c-me-etapes">
          {etapes.map((x, n) => (
            <li key={x.cle} className="c-me-etape">
              <span className="c-me-rang">{dire(`${K}.f.rang`, { i: n + 1, nom: dire(`${K}.f.${x.cle}`) })}</span>
              <span className="c-me-n"><b className="c-mono">{entier(x.n)}</b> <span>{entier(pour(x.n, e.essais))}&nbsp;%</span></span>
              <span className="c-me-barre" aria-hidden="true"><span style={{ width: `${pour(x.n, e.essais)}%` }} /></span>
              <b className="c-me-etape-nom">{titre(`${K}.f.${x.cle}_nom`)}</b>
              <span className="c-me-etape-sous">{x.sous}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Section({ id, titreCle, sous, className = '', children }: { id: string; titreCle: string; sous?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`c-carte c-me-section ${className}`} aria-labelledby={id}>
      <h2 id={id}>{titre(titreCle)}</h2>
      {sous ? <p className="c-sous c-me-section-sous">{sous}</p> : null}
      {children}
    </section>
  );
}

export function Mesure() {
  const [periode, setPeriode] = useState<Periode>('semaine');
  const [l, relire] = useLecture<Donnees>(`/console/mesure?periode=${periode}`, '/console/mesure');
  const d = l.etat === 'lu' ? l.donnees : null;
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
        <div className="c-entete-actions">
          <div className="c-pilules c-me-periodes" role="group" aria-label={titre(`${K}.i.periode`)}>
            {PERIODES.map((p) => <button key={p} type="button" className="c-pilule" aria-pressed={periode === p} onClick={() => setPeriode(p)}>{titre(`${K}.i.p.${p}`)}</button>)}
          </div>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <div className="c-me">
          <Bandeau e={d.entonnoir} i={d.inscriptions} periode={periode} />

          <div className="c-me-deux">
            <Section id="me-ecrans" titreCle={`${K}.e.titre`} sous={phrase(`${K}.e.sous`)}><PasMesure>{phrase(`${K}.e.pas`)}</PasMesure></Section>
            <Section id="me-parcours" titreCle={`${K}.p.titre`} sous={phrase(`${K}.p.sous`)}><PasMesure>{phrase(`${K}.p.pas`)}</PasMesure></Section>
          </div>
          <Section id="me-refus" titreCle={`${K}.r.titre`} sous={phrase(`${K}.r.sous`)}><PasMesure>{phrase(`${K}.r.pas`)}</PasMesure></Section>

          <div className="c-me-deux">
            <Section id="me-departs" titreCle={`${K}.d.titre`} sous={phrase(`${K}.d.sous`)}>
              <div className="c-me-tuiles">
                <div className="c-me-tuile"><b className="c-mono">{entier(d.departs.resiliations)}</b>
                  <span>{selon(d.departs.resiliations, `${K}.d.resiliations`, { le: jourCourt(d.departs.depuis) })}</span></div>
                <div className="c-me-tuile"><b className="c-mono">{entier(d.departs.nonRenouveles)}</b>
                  <span>{selon(d.departs.nonRenouveles, `${K}.d.non_renouveles`)}</span></div>
              </div>
              <PasMesure>{phrase(`${K}.d.motifs_pas`)}</PasMesure>
            </Section>
            <Section id="me-offres" titreCle={`${K}.o.titre`} sous={phrase(`${K}.o.sous`)}>
              <ul className="c-me-offres">
                {d.parOffre.map((o) => (
                  <li key={o.offre} className="c-me-offre">
                    <b>{titre(`${K}.o.${o.offre}`)}</b>
                    <span className="c-sous">{selon(o.n, `${K}.o.combien`)}</span>
                    {o.n === 0 ? null : (
                      <>
                        <span className="c-me-offre-chiffre"><b className="c-mono">{unChiffre(o.pieces)}</b><span>{dire(`${K}.o.pieces_${(o.pieces ?? 0) < 2 ? '1' : 'n'}`)}</span></span>
                        <span className="c-me-offre-chiffre"><b className="c-mono">{unChiffre(o.membres)}</b><span>{dire(`${K}.o.membres_${(o.membres ?? 0) < 2 ? '1' : 'n'}`)}</span></span>
                        <span className="c-sous">{o.offre === 'essentiel'
                          ? phrase(`${K}.o.modules_essentiel`, { paie: entier(o.modules.paie ?? 0), compta: entier(o.modules.compta ?? 0) })
                          : phrase(`${K}.o.modules_${o.offre}`)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="c-sous">{phrase(`${K}.o.pied`)}</p>
            </Section>
          </div>

          <div className="c-me-deux">
            <Section id="me-promesses" titreCle={`${K}.g.titre`} sous={phrase(`${K}.g.sous`)}>
              <div className="c-me-promesse">
                <p className="c-me-promesse-tete"><b>{titre(`${K}.g.support`, { h: d.promesses.heures })}</b> <Puce ton="hors">{dire(`${K}.g.propose`)}</Puce></p>
                {d.promesses.support.map((m) => (m.dues === 0
                  ? <p key={m.mois} className="c-sous">{phrase(`${K}.g.mois_vide`, { mois: moisEnMots(m.mois, false) })}</p>
                  : <p key={m.mois} className="c-me-promesse-chiffre"><b>{entier(pour(m.tenues, m.dues))}&nbsp;%</b>
                    <span>{dire(`${K}.g.mois`, { mois: moisEnMots(m.mois, false), n: entier(m.tenues), sur: entier(m.dues) })}</span></p>))}
                {d.promesses.attendLePlus !== null && d.promesses.attendLePlus >= d.promesses.heures
                  ? <p className="c-me-promesse-retard">{selon(d.promesses.attendLePlus, `${K}.g.attend`, { mois: moisEnMots(d.aujourdhui.slice(0, 7), false) })}</p> : null}
              </div>
              <div className="c-me-promesse">
                <p className="c-me-promesse-tete"><b>{titre(`${K}.g.urgente`, { h: d.promesses.heuresUrgente })}</b> <Puce ton="hors">{dire(`${K}.g.propose`)}</Puce></p>
                {d.promesses.urgentes.dues === 0 ? <p className="c-sous">{phrase(`${K}.g.urgentes_vide`)}</p>
                  : <p className="c-me-promesse-chiffre"><b>{dire(`${K}.g.sur`, { n: entier(d.promesses.urgentes.tenues), sur: entier(d.promesses.urgentes.dues) })}</b>
                    <span>{dire(`${K}.g.depuis_ouverture`)}</span></p>}
              </div>
              <div className="c-me-promesse c-me-promesse-pas">
                <p className="c-me-promesse-tete"><b>{titre(`${K}.g.satisfaction`)}</b></p>
                <PasMesure>{phrase(`${K}.g.satisfaction_pas`)}</PasMesure>
              </div>
            </Section>
            <section className="c-me-liste" aria-labelledby="me-liste">
              <p className="c-me-surtitre">{titre(`${K}.l.surtitre`)}</p>
              <h2 id="me-liste">{titre(`${K}.l.titre`)}</h2>
              <p className="c-me-bandeau-sous">{phrase(`${K}.l.sous`, { n: EVENEMENTS.length })}</p>
              <ul className="c-me-evenements">{EVENEMENTS.map((v) => <li key={v}>{titre(`${K}.l.v.${v}`)}</li>)}</ul>
              <div className="c-me-jamais"><b>{titre(`${K}.l.jamais`)}</b><span>{phrase(`${K}.l.jamais_sous`)}</span></div>
              <p className="c-me-accord"><span>{titre(`${K}.l.accord`)}</span> <EtatPuce etat="nonmesure" texte={dire(`${K}.pas_mesure`)} /></p>
              <p className="c-me-bandeau-sous">{phrase(`${K}.l.accord_sous`)}</p>
              <p className="c-me-bandeau-sous c-me-liste-pied">{phrase(`${K}.l.pied`)}</p>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
