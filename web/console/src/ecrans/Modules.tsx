// Les modules pilotés depuis la console (0226 ; Skander, 25/11/2026 : « à partir de la console je dois avoir chaque module
// et je peux mettre bêta dessus ou à venir »). Un onglet des Réglages : chaque module, son état pour tout le monde, ses
// exceptions par entreprise ; un geste (la direction seule, motivé, au journal) le change, sans nouvelle version.
// Venue de la fiche d'un client (`entreprise`), la page règle les exceptions de CETTE entreprise.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Choix, Dialogue, Zone, toast } from '../ui.tsx';

const K = 'console.ecran.modules';
export const ETATS = ['ouvert', 'beta', 'a_venir', 'ferme'] as const;
type Etat = (typeof ETATS)[number];
type Module = { id: string; nom: string; quoi: string; serveur: Etat };
type Pose = { module: string; entreprise: string | null; nom: string | null; etat: Etat; motif: string; le: string; par: string | null };
type Donnees = { modules: Module[]; poses: Pose[]; entreprise: { id: string; nom: string } | null };

// L'état qui vaut : l'exception de l'entreprise, sinon le réglage général posé, sinon la variable du serveur.
export function etatQuiVaut(m: Module, poses: readonly Pose[], entreprise: string | null): { etat: Etat; source: 'entreprise' | 'general' | 'serveur' } {
  const propre = entreprise ? poses.find((p) => p.module === m.id && p.entreprise === entreprise) : undefined;
  if (propre) return { etat: propre.etat, source: 'entreprise' };
  const general = poses.find((p) => p.module === m.id && p.entreprise === null);
  return general ? { etat: general.etat, source: 'general' } : { etat: m.serveur, source: 'serveur' };
}

function Pastille({ etat }: { etat: Etat }) {
  return <span className={`c-mod-etat c-mod-${etat}`}>{titre(`${K}.etat.${etat}`)}</span>;
}

function FenetreModule({ m, d, entreprise, fermer, fait }: { m: Module; d: Donnees; entreprise: { id: string; nom: string } | null; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const ent = entreprise?.id ?? null;
  const actuel = etatQuiVaut(m, d.poses, ent);
  const [etat, setEtat] = useState<string>(actuel.source === (ent ? 'entreprise' : 'general') ? actuel.etat : 'serveur');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/modules', { module: m.id, entreprise: ent, etat, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(phrase(`${K}.fait`, { module: m.nom })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const options = [
    ...ETATS.map((e) => ({ valeur: e, texte: `${titre(`${K}.etat.${e}`)} — ${dire(`${K}.etat_quoi.${e}`)}` })),
    { valeur: 'serveur', texte: titre(ent ? `${K}.comme_tous` : `${K}.revenir_serveur`) },
  ];
  return (
    <Dialogue titre={titre(`${K}.g.titre`)} sous={ent ? `${m.nom} · ${entreprise?.nom ?? ''}` : m.nom} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.g.bouton`)}</Bouton>
      </>}>
      <p>{phrase(ent ? `${K}.g.pour_une` : `${K}.g.pour_tous`)}</p>
      <Choix libelle={titre(`${K}.g.etat`)} valeur={etat} changer={(v) => { setEtat(v); setRefus(null); }} options={options} />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

export function Modules({ entreprise: demandee, peut }: { entreprise: string | null; peut: boolean }) {
  const chemin = demandee ? `/console/modules?entreprise=${encodeURIComponent(demandee)}` : '/console/modules';
  const [l, relire] = useLecture<Donnees>(chemin, chemin);
  const [ouvert, setOuvert] = useState<Module | null>(null);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const ent = d.entreprise;
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-modules">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-modules">{ent ? titre(`${K}.titre_une`, { nom: ent.nom }) : titre(`${K}.titre`)}</h2>
          <p className="c-carte-sous">{phrase(ent ? `${K}.sous_une` : `${K}.sous`)}</p>
        </div>
        {ent ? <a className="c-lien" href="#/reglages?onglet=modules">{titre(`${K}.voir_tous`)}</a> : null}
      </div>
      <div className="c-defile">
        <table className="c-table c-mod-table">
          <thead><tr>
            <th scope="col">{titre(`${K}.col.module`)}</th>
            <th scope="col">{titre(ent ? `${K}.col.pour_elle` : `${K}.col.pour_tous`)}</th>
            {ent ? null : <th scope="col">{titre(`${K}.col.exceptions`)}</th>}
            <th scope="col"><span className="c-cache">{titre(`${K}.col.geste`)}</span></th>
          </tr></thead>
          <tbody>
            {d.modules.map((m) => {
              const v = etatQuiVaut(m, d.poses, ent?.id ?? null);
              const pose = d.poses.find((p) => p.module === m.id && p.entreprise === (v.source === 'entreprise' ? ent?.id : null));
              const exceptions = d.poses.filter((p) => p.module === m.id && p.entreprise !== null);
              return (
                <tr key={m.id}>
                  <td><b>{m.nom}</b><span className="c-sous c-bloc">{m.quoi}</span></td>
                  <td data-libelle={titre(ent ? `${K}.col.pour_elle` : `${K}.col.pour_tous`)}>
                    <Pastille etat={v.etat} />
                    <span className="c-sous c-bloc">{v.source === 'serveur' ? dire(`${K}.source.serveur`)
                      : pose ? phrase(`${K}.source.pose`, { jour: jourCourt(jourDe(pose.le)), par: pose.par ?? '—', motif: pose.motif })
                        : dire(`${K}.source.${v.source}`)}</span>
                  </td>
                  {ent ? null : (
                    <td data-libelle={titre(`${K}.col.exceptions`)}>
                      {exceptions.length ? (
                        <><span>{selon(exceptions.length, `${K}.exceptions`)}</span>
                          <ul className="c-mod-exc">{exceptions.map((x) => (
                            <li key={x.entreprise ?? ''}><a href={`#/reglages?onglet=modules&entreprise=${x.entreprise ?? ''}`}>{x.nom ?? '—'}</a> · <Pastille etat={x.etat} /></li>
                          ))}</ul></>
                      ) : <span className="c-sous">{dire(`${K}.aucune_exception`)}</span>}
                    </td>
                  )}
                  <td className="c-droite">{peut ? <Bouton petit onClick={() => setOuvert(m)}>{titre(`${K}.changer`)}</Bouton> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ouvert ? <FenetreModule m={ouvert} d={d} entreprise={ent} fermer={() => setOuvert(null)} fait={() => { setOuvert(null); relire(); }} /> : null}
    </section>
  );
}
