// La documentation interne du support (0133 ; docs/console.md C57 ; serveur/console/docsupport.ts), dans l'écran Support :
//   - « Notre documentation » : les réponses (un texte prêt à envoyer ; « {prenom} » y devient le prénom de la personne)
//     et les procédures (comment on fait). Chacun les écrit ; une réponse ne s'offre dans le champ de réponse qu'une fois
//     validée par la direction, et une reprise la renvoie à valider (l'écran le dit AVANT le geste). La direction valide
//     après avoir relu le texte, et retire ce qui ne vaut plus, avec son motif ;
//   - les notes privées d'une demande : ce que l'équipe se passe, jamais montré au client ; elles ne se modifient pas.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, maj, MenuLigne, Puce, toast, Vide, Zone } from '../ui.tsx';

const D = 'console.ecran.support.doc';
const N = 'console.ecran.support.np';
export type SorteDoc = 'reponse' | 'procedure';
export type FicheDoc = { id: string; sorte: SorteDoc; titre: string; texte: string; ecriteLe: string; ecritePar: string | null; validee: { le: string; par: string | null } | null };
export type NotePrivee = { id: string; texte: string; le: string; auteur: string | null };

// Une réponse validée posée pour une personne : « {prenom} » devient son prénom (la règle du serveur, poserReponse).
export const poserReponse = (t: string, prenom: string): string => t.split('{prenom}').join(prenom);

function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  // `apresRefus` : ce que la fenêtre fait d'un refus de la base (403), après l'avoir dit (relire la fiche, A03).
  const envoyer = (chemin: string, corps: unknown, dit: string, apresRefus?: () => Promise<void>) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
        if (r.statut === 403 && apresRefus) await apresRefus();
        if (typeof r.corps.champ === 'string') setFaute((f) => ({ champ: r.corps.champ as string, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return { envoyer, refuser, refus, occupe, faute: (c: string) => faute?.champ === c, n: faute?.n ?? 0 };
}
function Pied({ fermer, occupe, envoyer, bouton }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string }) {
  return <><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" occupe={occupe} onClick={envoyer}>{bouton}</Bouton></>;
}

// Écrire une fiche, ou la reprendre.
function FenetreEcrire({ sorte, fiche, fermer, fait }: { sorte: SorteDoc; fiche: FicheDoc | null; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [t, setT] = useState(fiche?.titre ?? '');
  const [texte, setTexte] = useState(fiche?.texte ?? '');
  const envoyer = () => {
    if (t.trim().length < 3) { e.refuser(phrase(`${D}.e.titre_court`), 'titre'); return; }
    if (texte.trim().length < 10) { e.refuser(phrase(`${D}.e.texte_court`), 'texte'); return; }
    e.envoyer('/console/support/documentation', { id: fiche?.id ?? null, sorte, titre: t.trim(), texte: texte.trim(), lue: fiche?.ecriteLe ?? null },
      phrase(fiche ? `${D}.e.reprise` : `${D}.e.ecrite_${sorte}`, { titre: t.trim() }));
  };
  return (
    <Dialogue titre={titre(fiche ? `${D}.e.titre_reprendre` : `${D}.e.titre_${sorte}`)} sous={fiche?.titre} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(fiche ? `${D}.e.bouton_reprendre` : `${D}.e.bouton`)} />}>
      {sorte === 'reponse' ? <Alerte ton={fiche?.validee ? 'attention' : 'info'}>{phrase(fiche?.validee ? `${D}.e.revalider` : `${D}.e.a_valider`)}</Alerte> : null}
      <Champ libelle={titre(`${D}.e.titre`)} aide={phrase(`${D}.e.titre_aide_${sorte}`)} valeur={t} changer={setT} premier faute={e.faute('titre')} n={e.n} />
      <Zone libelle={titre(`${D}.e.texte`)} aide={phrase(`${D}.e.texte_aide_${sorte}`, { prenom: '{prenom}' })} valeur={texte} changer={setTexte} max={8000} faute={e.faute('texte')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

// Valider : la direction relit le texte tel qu'il partira, puis valide. La version relue part avec (l'audit 1.42.0, A03) :
// reprise depuis par quelqu'un d'autre, la base refuse et rien n'est validé ; la fenêtre relit alors la fiche et montre
// le nouveau texte à sa place — le relire, puis valider, valide celui-là.
function FenetreValider({ fiche, fermer, fait }: { fiche: FicheDoc; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const api = useApi();
  const [vue, setVue] = useState(fiche);
  const [nouvelle, setNouvelle] = useState(false);
  const relire = async () => {
    const r = await api<{ fiches: FicheDoc[] }>('GET', '/console/support/documentation');
    const f = r?.statut === 200 ? r.corps.fiches.find((x) => x.id === vue.id) : undefined;
    if (f && f.ecriteLe !== vue.ecriteLe) { setVue(f); setNouvelle(true); }
  };
  const envoyer = () => { setNouvelle(false); e.envoyer(`/console/support/documentation/${vue.id}/valider`, { lue: vue.ecriteLe }, phrase(`${D}.v.fait`, { titre: vue.titre }), relire); };
  return (
    <Dialogue titre={titre(`${D}.v.titre`)} sous={vue.titre} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${D}.v.bouton`)} />}>
      <p>{phrase(vue.sorte === 'reponse' ? `${D}.v.p_reponse` : `${D}.v.p_procedure`)}</p>
      <div className="c-sd-texte c-sd-relire" data-donnee>{vue.texte}</div>
      {nouvelle ? <Alerte ton="attention">{phrase(`${D}.v.nouvelle`, { qui: vue.ecritePar ?? '—' })}</Alerte> : e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRetirer({ fiche, fermer, fait }: { fiche: FicheDoc; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/support/documentation/${fiche.id}/retirer`, { motif: motif.trim() }, phrase(`${D}.x.fait`, { titre: fiche.titre }));
  };
  return (
    <Dialogue titre={titre(`${D}.x.titre`)} sous={fiche.titre} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${D}.x.bouton`)} />}>
      <p>{phrase(`${D}.x.p`)}</p>
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={setMotif} premier faute={e.faute('motif')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

type Geste = { sorte: 'ecrire'; s: SorteDoc; fiche: FicheDoc | null } | { sorte: 'valider'; fiche: FicheDoc } | { sorte: 'retirer'; fiche: FicheDoc };
export function Documentation({ aujourdhui }: { aujourdhui: string }) {
  const { moi } = useConsole();
  const direction = moi.role === 'direction';
  const [l, relire] = useLecture<{ fiches: FicheDoc[] }>('/console/support/documentation', 'support-doc');
  const [sorte, setSorte] = useState<SorteDoc>('reponse');
  const [geste, setGeste] = useState<Geste | null>(null);
  const fait = () => { setGeste(null); relire(); };
  const fiches = l.etat === 'lu' ? l.donnees.fiches : [];
  const deLaSorte = fiches.filter((f) => f.sorte === sorte);
  const aValider = fiches.filter((f) => f.sorte === 'reponse' && !f.validee).length;
  return (
    <section className="c-carte c-sd" aria-labelledby="sd-titre">
      <div className="c-carte-tete">
        <div>
          <h2 id="sd-titre">{titre(`${D}.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${D}.sous`)}</p>
        </div>
        <Bouton petit icone="plus" onClick={() => setGeste({ sorte: 'ecrire', s: sorte, fiche: null })}>{titre(`${D}.ecrire_${sorte}`)}</Bouton>
      </div>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      <div className="c-pilules c-sd-pilules" role="group" aria-label={titre(`${D}.sortes`)}>
        {(['reponse', 'procedure'] as const).map((s) => (
          <button key={s} type="button" className="c-pilule" aria-pressed={sorte === s} onClick={() => setSorte(s)}>
            {titre(`${D}.sorte.${s}`)} <span className="c-pilule-n">{fiches.filter((f) => f.sorte === s).length}</span>
          </button>
        ))}
      </div>
      {sorte === 'reponse' && aValider ? <p className="c-sd-a-valider">{maj(selon(aValider, direction ? `${D}.a_valider_direction` : `${D}.a_valider`))}</p> : null}
      {l.etat === 'lu' && deLaSorte.length === 0 ? <Vide icone="courriel">{phrase(`${D}.vide_${sorte}`)}</Vide> : (
        <ul className="c-sd-fiches">
          {deLaSorte.map((f) => (
            <li key={f.id} className="c-sd-fiche">
              <div className="c-sd-fiche-tete">
                <b data-donnee>{f.titre}</b>
                {f.sorte === 'reponse' ? <Puce ton={f.validee ? 'actif' : 'en_retard'}>{titre(f.validee ? `${D}.validee` : `${D}.a_valider_puce`)}</Puce> : null}
                <MenuLigne etiquette={titre(`${D}.menu`, { titre: f.titre })} actions={[
                  { titre: titre(`${D}.reprendre`), sous: phrase(f.sorte === 'reponse' && f.validee ? `${D}.reprendre_sous_validee` : `${D}.reprendre_sous`), faire: () => setGeste({ sorte: 'ecrire', s: f.sorte, fiche: f }) },
                  ...(direction && !f.validee ? [{ titre: titre(`${D}.valider`), sous: phrase(`${D}.valider_sous_${f.sorte}`), faire: () => setGeste({ sorte: 'valider', fiche: f }) }] : []),
                  ...(direction ? [{ titre: titre(`${D}.retirer`), sous: phrase(`${D}.retirer_sous`), faire: () => setGeste({ sorte: 'retirer', fiche: f }), danger: true, trait: true }] : []),
                ]} />
              </div>
              <div className="c-sd-texte" data-donnee>{f.texte}</div>
              <span className="c-sous">{maj(f.validee
                ? dire(`${D}.qui_validee`, { par: f.ecritePar ?? '—', quand: quand(f.ecriteLe, aujourdhui), valideur: f.validee.par ?? '—' })
                : dire(`${D}.qui`, { par: f.ecritePar ?? '—', quand: quand(f.ecriteLe, aujourdhui) }))}</span>
            </li>
          ))}
        </ul>
      )}
      {geste?.sorte === 'ecrire' ? <FenetreEcrire sorte={geste.s} fiche={geste.fiche} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'valider' ? <FenetreValider fiche={geste.fiche} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'retirer' ? <FenetreRetirer fiche={geste.fiche} fermer={() => setGeste(null)} fait={fait} /> : null}
    </section>
  );
}

// Les notes privées d'une demande : la plus ancienne d'abord ; une note se pose, elle ne se modifie pas.
export function NotesPrivees({ demande, notes, aujourdhui, relire }: { demande: string; notes: NotePrivee[]; aujourdhui: string; relire: () => void }) {
  const api = useApi();
  const [texte, setTexte] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const poser = async () => {
    if (occupe) return;
    if (texte.trim().length < 3) { setRefus(phrase(`${N}.courte`)); setFaute((n) => n + 1); return; }
    setOccupe(true);
    try {
      const r = await api('POST', `/console/support/demandes/${demande}/notes`, { texte: texte.trim() });
      if (!r) return;
      if (r.statut !== 201) { setRefus(refusDe(r)); setFaute((n) => n + 1); return; }
      setTexte(''); setRefus(null);
      toast(phrase(`${N}.posee`));
      relire();
    } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
  };
  return (
    <section className="c-sp-notes" aria-labelledby="sp-notes">
      <h3 id="sp-notes" className="c-surtitre">{titre(`${N}.titre`)}</h3>
      <p className="c-sous">{phrase(`${N}.jamais_client`)}</p>
      {notes.length ? (
        <ol className="c-sp-notes-liste">
          {notes.map((n) => (
            <li key={n.id}><span className="c-sd-texte" data-donnee>{n.texte}</span><span className="c-sous">{maj(dire(`${N}.qui`, { par: n.auteur ?? '—', quand: quand(n.le, aujourdhui) }))}</span></li>
          ))}
        </ol>
      ) : null}
      <Zone libelle={titre(`${N}.nouvelle`)} libelleCache placeholder={titre(`${N}.nouvelle_place`)} valeur={texte} changer={setTexte} max={2000} faute={faute > 0} n={faute} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
      <span className="c-sp-notes-pied"><Bouton petit occupe={occupe} onClick={() => void poser()}>{titre(`${N}.poser`)}</Bouton></span>
    </section>
  );
}
