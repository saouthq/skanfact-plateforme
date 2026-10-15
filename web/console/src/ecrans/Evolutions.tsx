// Les retours des clients et les demandes d'évolution (0134 ; docs/console.md C58 ; serveur/console/evolutions.ts), dans
// l'écran Support :
//   - « Les évolutions » : les idées que des clients réclament, les plus demandées d'abord (le nombre de CLIENTS, pas de
//     messages) ; chacune dit son état (à étudier, prévue, faite avec sa version, écartée avec sa raison) et les demandes
//     qui la réclament, qui s'ouvrent d'un clic. La direction décide de l'état ;
//   - sur une demande : la rattacher à une évolution (une qui existe, ou une nouvelle), ou l'en détacher.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Choix, Dialogue, maj, MenuLigne, Puce, toast, Vide, Zone, type TonPuce } from '../ui.tsx';

const E = 'console.ecran.support.ev';
export const ETATS_EVOLUTION = ['a_etudier', 'prevue', 'faite', 'ecartee'] as const;
export type EtatEvolution = typeof ETATS_EVOLUTION[number];
export type Evolution = {
  id: string; titre: string; description: string | null; etat: EtatEvolution; version: string | null; raison: string | null;
  noteeLe: string; noteePar: string | null; decideeLe: string | null; decideePar: string | null;
  clients: number; demandes: number; derniere: string | null;
  liste: { id: string; numero: number; sujet: string; ouverteLe: string; entreprise: { id: string; nom: string } }[];
};
export type EvolutionDe = { id: string; titre: string; etat: EtatEvolution; version: string | null };
const PUCE: Record<EtatEvolution, TonPuce> = { a_etudier: 'en_retard', prevue: 'essai', faite: 'actif', ecartee: 'hors' };
const numero = (n: number) => `S-${String(n).padStart(4, '0')}`;
export const etatEnMots = (e: Pick<Evolution, 'etat' | 'version'>) => (e.etat === 'faite' && e.version ? dire(`${E}.etat.faite_en`, { version: e.version }) : dire(`${E}.etat.${e.etat}`));
export const PuceEvolution = ({ e }: { e: Pick<Evolution, 'etat' | 'version'> }) => <Puce ton={PUCE[e.etat]}>{maj(etatEnMots(e))}</Puce>;

function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = (chemin: string, corps: unknown, dit: string) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setFaute((f) => ({ champ: r.corps.champ as string, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return { envoyer, refuser, refus, occupe, faute: (c: string) => faute?.champ === c, n: faute?.n ?? 0 };
}
function Pied({ fermer, occupe, envoyer, bouton }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string }) {
  return <><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" occupe={occupe} onClick={envoyer}>{bouton}</Bouton></>;
}

// Rattacher une demande : à une évolution qui existe (la liste, les plus demandées d'abord), ou à une nouvelle.
export function FenetreRattacher({ demande, sujet, fermer, fait }: { demande: string; sujet: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [l] = useLecture<{ evolutions: Evolution[] }>('/console/support/evolutions', 'support-evolutions');
  const evolutions = l.etat === 'lu' ? l.donnees.evolutions.filter((x) => x.etat !== 'ecartee' && x.etat !== 'faite') : [];
  const [choix, setChoix] = useState<string>('');
  const [nouvelle, setNouvelle] = useState(false);
  const [t, setT] = useState('');
  const [description, setDescription] = useState('');
  const neuve = nouvelle || (l.etat === 'lu' && evolutions.length === 0);
  const envoyer = () => {
    if (neuve) {
      if (t.trim().length < 3) { e.refuser(phrase(`${E}.r.titre_court`), 'titre'); return; }
      e.envoyer('/console/support/evolutions', { titre: t.trim(), description: description.trim() || null, demande }, phrase(`${E}.r.notee`, { titre: t.trim() }));
      return;
    }
    const x = evolutions.find((v) => v.id === choix);
    if (!x) { e.refuser(phrase(`${E}.r.choisir_une`), 'evolution'); return; }
    e.envoyer(`/console/support/demandes/${demande}/evolution`, { evolution: x.id }, phrase(`${E}.r.rattachee`, { titre: x.titre }));
  };
  return (
    <Dialogue titre={titre(`${E}.r.titre`)} sous={sujet} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(neuve ? `${E}.r.bouton_noter` : `${E}.r.bouton`)} />}>
      <p>{phrase(`${E}.r.p`)}</p>
      {/* La liste d'abord : sans elle, on ne sait pas encore s'il faut choisir ou noter (rien ne bascule sous le doigt). */}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : !neuve ? (
        <>
          <Choix libelle={titre(`${E}.r.evolution`)} valeur={choix} changer={setChoix} faute={e.faute('evolution')} n={e.n}
            options={[{ valeur: '', texte: titre(`${E}.r.choisir`) }, ...evolutions.map((x) => ({ valeur: x.id, texte: `${x.titre} · ${selon(x.clients, `${E}.clients`)}`, donnee: true }))]} />
          <Bouton ton="discret" petit onClick={() => setNouvelle(true)}>{titre(`${E}.r.une_nouvelle`)}</Bouton>
        </>
      ) : (
        <>
          <Champ libelle={titre(`${E}.r.titre_champ`)} aide={phrase(`${E}.r.titre_aide`)} valeur={t} changer={setT} premier faute={e.faute('titre')} n={e.n} />
          <Zone libelle={titre(`${E}.r.description`)} aide={phrase(`${E}.r.description_aide`)} valeur={description} changer={setDescription} max={2000} faute={e.faute('description')} n={e.n} />
          {evolutions.length ? <Bouton ton="discret" petit onClick={() => setNouvelle(false)}>{titre(`${E}.r.une_existante`)}</Bouton> : null}
        </>
      )}
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

// Décider de l'état d'une évolution : la direction seule. « Faite » demande sa version, « écartée » sa raison.
function FenetreDecider({ ev, fermer, fait }: { ev: Evolution; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [etat, setEtat] = useState<EtatEvolution>(ev.etat);
  const [version, setVersion] = useState(ev.version ?? '');
  const [raison, setRaison] = useState(ev.raison ?? '');
  const envoyer = () => {
    if (etat === 'faite' && !/^\d+\.\d+\.\d+$/.test(version.trim())) { e.refuser(phrase(`${E}.d.version_faux`), 'version'); return; }
    if (etat === 'ecartee' && raison.trim().length < 3) { e.refuser(phrase(`${E}.d.raison_courte`), 'raison'); return; }
    e.envoyer(`/console/support/evolutions/${ev.id}/decider`, { etat, version: etat === 'faite' ? version.trim() : null, raison: etat === 'ecartee' ? raison.trim() : null },
      phrase(`${E}.d.fait`, { titre: ev.titre, etat: etatEnMots({ etat, version: version.trim() || null }) }));
  };
  return (
    <Dialogue titre={titre(`${E}.d.titre`)} sous={ev.titre} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${E}.d.bouton`)} />}>
      <p>{phrase(`${E}.d.p`, { clients: selon(ev.clients, `${E}.clients`) })}</p>
      <Choix libelle={titre(`${E}.d.etat`)} valeur={etat} changer={(v) => setEtat(v as EtatEvolution)}
        options={ETATS_EVOLUTION.map((s) => ({ valeur: s, texte: titre(`${E}.etat.${s}`) }))} />
      {etat === 'faite' ? <Champ libelle={titre(`${E}.d.version`)} aide={phrase(`${E}.d.version_aide`)} valeur={version} changer={setVersion} faute={e.faute('version')} n={e.n} /> : null}
      {etat === 'ecartee' ? <Zone libelle={titre(`${E}.d.raison`)} aide={phrase(`${E}.d.raison_aide`)} valeur={raison} changer={setRaison} max={400} faute={e.faute('raison')} n={e.n} /> : null}
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

export function Evolutions({ aujourdhui, ouvrirDemande }: { aujourdhui: string; ouvrirDemande: (id: string) => void }) {
  const { moi } = useConsole();
  const direction = moi.role === 'direction';
  const [l, relire] = useLecture<{ evolutions: Evolution[] }>('/console/support/evolutions', 'support-evolutions');
  const [etat, setEtat] = useState<EtatEvolution | null>(null);
  const [decider, setDecider] = useState<Evolution | null>(null);
  const tout = l.etat === 'lu' ? l.donnees.evolutions : [];
  const liste = etat ? tout.filter((x) => x.etat === etat) : tout;
  return (
    <section className="c-carte c-ev" aria-labelledby="ev-titre">
      <div className="c-carte-tete">
        <div>
          <h2 id="ev-titre">{titre(`${E}.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${E}.sous`)}</p>
        </div>
      </div>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      <div className="c-pilules c-ev-pilules" role="group" aria-label={titre(`${E}.etats`)}>
        <button type="button" className="c-pilule" aria-pressed={etat === null} onClick={() => setEtat(null)}>{titre(`${E}.toutes`)} <span className="c-pilule-n">{tout.length}</span></button>
        {ETATS_EVOLUTION.map((s) => (
          <button key={s} type="button" className="c-pilule" aria-pressed={etat === s} onClick={() => setEtat(s)}>
            {titre(`${E}.etats_court.${s}`)} <span className="c-pilule-n">{tout.filter((x) => x.etat === s).length}</span>
          </button>
        ))}
      </div>
      {l.etat === 'lu' && liste.length === 0 ? <Vide icone="courriel">{phrase(etat ? `${E}.vide_etat` : `${E}.vide`)}</Vide> : (
        <ol className="c-ev-liste">
          {liste.map((x) => (
            <li key={x.id} className="c-ev-item">
              <div className="c-ev-tete">
                <span className="c-ev-clients"><b>{x.clients}</b><span>{dire(x.clients === 1 ? `${E}.client_court` : `${E}.clients_court`)}</span></span>
                <span className="c-ev-quoi">
                  <b data-donnee>{x.titre}</b>
                  <span className="c-sous">{maj(dire(`${E}.compte`, { demandes: selon(x.demandes, `${E}.demandes`), quand: x.derniere ? quand(x.derniere, aujourdhui) : '—' }))}</span>
                </span>
                <PuceEvolution e={x} />
                {direction ? <MenuLigne etiquette={titre(`${E}.menu`, { titre: x.titre })} actions={[{ titre: titre(`${E}.decider`), sous: phrase(`${E}.decider_sous`), faire: () => setDecider(x) }]} /> : null}
              </div>
              {x.description ? <p className="c-ev-description" data-donnee>{x.description}</p> : null}
              {x.etat === 'ecartee' && x.raison ? <p className="c-sous" data-donnee>{maj(dire(`${E}.raison`, { raison: x.raison }))}</p> : null}
              {x.liste.length ? (
                <ul className="c-ev-demandes">
                  {x.liste.map((d) => (
                    <li key={d.id}><button type="button" className="c-lien-bouton" onClick={() => ouvrirDemande(d.id)}>
                      <span className="c-mono">{numero(d.numero)}</span>{' · '}<span data-donnee>{d.entreprise.nom}</span>{' · '}<span data-donnee>{d.sujet}</span>
                    </button></li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {decider ? <FenetreDecider ev={decider} fermer={() => setDecider(null)} fait={() => { setDecider(null); relire(); }} /> : null}
    </section>
  );
}
