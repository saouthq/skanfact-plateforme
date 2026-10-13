// Le service (10 § 2.8, première partie ; serveur/console/routes.ts, GET /console/service) : ce que la veille du serveur
// (exploitation/veiller.ts) écrit chaque minute. Rien n'est vert sans mesure (C2) : sans veille, « non mesuré » ; une
// veille qui n'écrit plus le dit ; sinon ses problèmes, les graves d'abord, avec ce qu'il faut faire. Ce que la veille
// écrit (le titre d'un problème, ce qu'il faut faire) est une donnée : il s'affiche tel qu'elle l'a écrit.
import { phrase, titre } from '../langue.ts';
import { useConsole, useLecture } from '../contexte.ts';
import { ilYA, quand } from '../temps.ts';
import { Alerte, Bouton, Icone, Puce } from '../ui.tsx';

type Probleme = { cle: string; titre: string; grave: boolean; faire: string; depuis: string };
type Veille = { etat: 'absente' } | { etat: 'silencieuse'; derniere: string } | { etat: 'ok'; derniere: string; problemes: Probleme[] };

export function Service() {
  const { moi } = useConsole();
  const [l, relire] = useLecture<{ veille: Veille }>('/console/service');
  const v = l.etat === 'lu' ? l.donnees.veille : null;
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.service.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.service.sous')}</p>
        </div>
        <div className="c-entete-actions"><Bouton icone="relire" onClick={relire}>{titre('console.ecran.relire')}</Bouton></div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {v?.etat === 'absente' ? (
        <section className="c-carte c-etat-service" aria-labelledby="service-etat">
          <span className="c-ligne-icone"><Icone nom="serveur" /></span>
          <div><h2 id="service-etat">{titre('console.ecran.service.absente_titre')}</h2><p className="c-carte-sous">{phrase('console.ecran.service.absente')}</p></div>
        </section>
      ) : null}
      {v?.etat === 'silencieuse' ? (
        <section className="c-carte c-etat-service" aria-labelledby="service-etat">
          <span className="c-ligne-icone c-urgent"><Icone nom="alerte" /></span>
          <div><h2 id="service-etat">{titre('console.ecran.service.silencieuse_titre')}</h2><p className="c-carte-sous">{phrase('console.ecran.service.silencieuse', { quand: quand(v.derniere, moi.aujourdhui) })}</p></div>
        </section>
      ) : null}
      {v?.etat === 'ok' && v.problemes.length === 0 ? (
        <section className="c-carte c-etat-service" aria-labelledby="service-etat">
          <span className="c-ligne-icone c-semaine"><Icone nom="ok" /></span>
          <div><h2 id="service-etat">{titre('console.ecran.service.ok_titre')}</h2><p className="c-carte-sous">{phrase('console.ecran.service.ok', { quand: ilYA(v.derniere) })}</p></div>
        </section>
      ) : null}
      {v?.etat === 'ok' && v.problemes.length ? (
        <section className="c-carte c-decider" aria-labelledby="service-pb">
          <div className="c-carte-tete">
            <div>
              <h2 id="service-pb">{titre('console.ecran.service.problemes_titre')} <span className="c-compte-titre">{v.problemes.length}</span></h2>
              <p className="c-carte-sous">{phrase('console.ecran.service.ok', { quand: ilYA(v.derniere) })}</p>
            </div>
          </div>
          <ul className="c-lignes">
            {v.problemes.map((p) => (
              <li key={p.cle} className="c-ligne-decision c-ligne-sans-action">
                <span className={`c-ligne-icone c-${p.grave ? 'urgent' : 'a_regarder'}`}><Icone nom={p.grave ? 'alerte' : 'serveur'} /></span>
                <div className="c-ligne-texte">
                  <span className="c-ligne-titre"><span data-donnee>{p.titre}</span>{p.grave ? <Puce ton="urgent">{titre('console.ecran.service.grave')}</Puce> : null}</span>
                  {p.faire ? <span className="c-ligne-desc"><b>{titre('console.ecran.service.a_faire')}</b> : <span data-donnee>{p.faire}</span></span> : null}
                  {p.depuis ? <span className="c-ligne-meta">{phrase('console.ecran.service.depuis', { quand: quand(p.depuis, moi.aujourdhui) })}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
