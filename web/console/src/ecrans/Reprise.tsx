// La procédure de reprise d'une entreprise (docs/console.md C34 ; 0112 ; la maquette Fiche, « Plus rare : la procédure
// de reprise »). Quand la propriétaire n'est plus joignable, l'entreprise change de propriétaire SUR PIÈCES, jamais sur
// un simple appel ; la direction seule :
//   - ouvrir : la cause, le repreneur, le motif ; la propriétaire est prévenue dans son application et a quinze jours
//     pour s'y opposer ;
//   - noter les trois pièces vues (jamais les fichiers) ; une opposition reçue se note et clôt la procédure ;
//   - confirmer : l'AUTRE membre de la direction, une fois les pièces vues et le délai passé.
// La carte dit à chaque instant ce qui manque encore, et le bouton qui débloque.
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole } from '../contexte.ts';
import { dans, jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Icone, maj, Pilules, Puce, toast, Zone } from '../ui.tsx';
import { refDemande } from './Support.tsx';

export type CauseReprise = 'deces' | 'cession' | 'depart' | 'conflit';
const CAUSES: readonly CauseReprise[] = ['deces', 'cession', 'depart', 'conflit'];
export type PieceReprise = 'acte' | 'registre' | 'identite';
const PIECES: readonly PieceReprise[] = ['acte', 'registre', 'identite'];
export type Reprise = {
  id: string; cause: CauseReprise; repreneur: { nom: string; email: string; aUnCompte: boolean }; motif: string;
  ouverteLe: string; ouvertePar: { id: string; nom: string | null }; prevenue: string | null; demande: string | null; demandeNumero: number | null;
  oppositionJusquAu: string; delaiPasse: boolean; pieces: Partial<Record<PieceReprise, { le: string; par: string | null }>>;
  opposeeLe: string | null; appliqueeLe: string | null; appliqueePar: string | null; closeLe: string | null; closePar: string | null; closeMotif: string | null;
};
const K = 'console.ecran.reprise';

// Avant de confirmer, dans l'ordre où on le règle : chaque condition cochée quand elle est remplie (la carte la montre
// telle quelle, et le bouton ne s'allume qu'une fois toutes cochées).
export type Condition = { ok: boolean; texte: string };
export function avantDeConfirmer(r: Reprise, moi: string): Condition[] {
  const vues = PIECES.filter((p) => r.pieces[p]).length;
  return [
    { ok: vues === PIECES.length, texte: phrase(`${K}.cond.pieces`, { n: vues, total: PIECES.length }) },
    { ok: r.delaiPasse, texte: phrase(r.delaiPasse ? `${K}.cond.delai_ok` : `${K}.cond.delai`) },
    { ok: r.repreneur.aUnCompte, texte: phrase(r.repreneur.aUnCompte ? `${K}.cond.compte_ok` : `${K}.cond.compte`) },
    { ok: r.ouvertePar.id !== moi, texte: phrase(r.ouvertePar.id !== moi ? `${K}.cond.autre_ok` : `${K}.cond.autre`) },
  ];
}
export const repriseEnCours = (r: Reprise | null | undefined): boolean => !!r && !r.appliqueeLe && !r.closeLe;

export function CarteReprise({ id, nom, reprise, aujourdhui, relire }: { id: string; nom: string; reprise: Reprise | null | undefined; aujourdhui: string; relire: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [fenetre, setFenetre] = useState<'ouvrir' | 'opposition' | 'clore' | 'confirmer' | null>(null);
  const [occupe, setOccupe] = useState<PieceReprise | null>(null);
  const fait = () => { setFenetre(null); relire(); };
  const noterPiece = (r: Reprise, piece: PieceReprise) => {
    void (async () => {
      setOccupe(piece);
      try {
        const x = await api('POST', `/console/reprises/${r.id}/pieces`, { piece });
        if (!x) return;
        if (x.statut === 200) { toast(phrase(`${K}.piece_notee`, { piece: dire(`${K}.piece.${piece}`) })); relire(); return; }
        toast(refusDe(x), true);
      } catch (e) { toast(panneDe(e), true); } finally { setOccupe(null); }
    })();
  };

  if (!repriseEnCours(reprise)) {
    return (
      <section className="c-carte c-reprise" aria-labelledby="fiche-reprise">
        <b id="fiche-reprise" className="c-reprise-titre">{titre(`${K}.rare`)}</b>
        <span className="c-reprise-texte">{phrase(`${K}.rare_texte`)}</span>
        {reprise?.appliqueeLe ? <span className="c-reprise-texte">{phrase(`${K}.derniere_appliquee`, { le: jourCourt(jourDe(reprise.appliqueeLe)), nom: reprise.repreneur.nom })}</span> : null}
        {reprise?.closeLe ? <span className="c-reprise-texte">{phrase(reprise.opposeeLe ? `${K}.derniere_opposee` : `${K}.derniere_close`, { le: jourCourt(jourDe(reprise.closeLe)), motif: reprise.closeMotif ?? '' })}</span> : null}
        <span><Bouton petit onClick={() => setFenetre('ouvrir')}>{titre(`${K}.ouvrir_court`)}</Bouton></span>
        {fenetre === 'ouvrir' ? <OuvrirReprise id={id} nom={nom} fermer={() => setFenetre(null)} fait={fait} /> : null}
      </section>
    );
  }

  const r = reprise as Reprise;
  const conditions = avantDeConfirmer(r, moi.utilisateur);
  const prete = conditions.every((c) => c.ok);
  return (
    <section className="c-carte c-reprise c-reprise-en-cours" aria-labelledby="fiche-reprise">
      <div className="c-carte-tete">
        <div>
          <h2 id="fiche-reprise">{titre(`${K}.en_cours`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.ouverte`, { le: jourCourt(jourDe(r.ouverteLe)), qui: r.ouvertePar.nom ?? '—', cause: dire(`${K}.cause.${r.cause}`) })}</p>
        </div>
        <Puce ton={r.delaiPasse ? 'actif' : 'aujourdhui'}>{titre(r.delaiPasse ? `${K}.delai_passe_court` : `${K}.opposition_court`)}</Puce>
      </div>
      <dl className="c-faits c-reprise-faits">
        <div><dt>{titre(`${K}.repreneur`)}</dt><dd><span data-donnee>{r.repreneur.nom}</span> · <span data-donnee>{r.repreneur.email}</span></dd></div>
        <div><dt>{titre(`${K}.prevenue`)}</dt><dd>{r.prevenue
          ? <><span data-donnee>{r.prevenue}</span>{r.demande && r.demandeNumero ? <> · <a href={`#/support?demande=${r.demande}`} className="c-mono">{refDemande(r.demandeNumero)}</a></> : null}</>
          : dire(`${K}.personne_a_prevenir`)}</dd></div>
        <div><dt>{titre(`${K}.opposition`)}</dt><dd>{r.delaiPasse ? dire(`${K}.delai_passe`, { le: jourCourt(r.oppositionJusquAu) })
          : dire(`${K}.delai_court`, { le: jourCourt(r.oppositionJusquAu), dans: dans(r.oppositionJusquAu, aujourdhui) })}</dd></div>
        <div><dt>{titre(`${K}.motif`)}</dt><dd data-donnee>{r.motif}</dd></div>
      </dl>
      <div className="c-reprise-pieces">
        <span className="c-champ-libelle">{titre(`${K}.pieces`)}</span>
        <ul>
          {PIECES.map((p) => {
            const vue = r.pieces[p];
            return (
              <li key={p} className={vue ? 'c-reprise-vue' : ''}>
                <span className={`c-ligne-icone ${vue ? 'c-ok' : 'c-semaine'}`}><Icone nom={vue ? 'ok' : 'facture'} taille={16} /></span>
                <span className="c-reprise-piece"><b>{maj(dire(`${K}.piece.${p}`))}</b>
                  <small>{vue ? phrase(`${K}.vue_par`, { quand: quand(vue.le, aujourdhui), qui: vue.par ?? '—' }) : phrase(`${K}.pas_vue`)}</small></span>
                {vue ? null : <Bouton petit occupe={occupe === p} desactive={occupe !== null && occupe !== p} onClick={() => noterPiece(r, p)}>{titre(`${K}.noter_vue`)}</Bouton>}
              </li>
            );
          })}
        </ul>
        <small className="c-reprise-note">{phrase(`${K}.jamais_fichier`)}</small>
      </div>
      {/* Avant de confirmer : la liste cochée, lue avant le geste ; le bouton principal ne s'allume qu'une fois tout coché. */}
      <div className="c-reprise-avant">
        <span className="c-champ-libelle">{titre(`${K}.avant`)}</span>
        <ul>
          {conditions.map((c) => (
            <li key={c.texte} className={c.ok ? 'c-reprise-ok' : ''}>
              <span className="c-reprise-coche" aria-hidden="true">{c.ok ? <Icone nom="ok" taille={14} /> : null}</span>
              <span>{c.texte}</span><span className="c-cache">{titre(c.ok ? `${K}.fait` : `${K}.a_faire`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="c-boutons-ligne c-reprise-gestes">
        <Bouton {...(prete ? { ton: 'principal' as const } : {})} desactive={!prete} onClick={() => setFenetre('confirmer')}>{titre(`${K}.confirmer_court`)}</Bouton>
        <Bouton onClick={() => setFenetre('opposition')}>{titre(`${K}.opposition_noter`)}</Bouton>
        <Bouton onClick={() => setFenetre('clore')}>{titre(`${K}.clore_court`)}</Bouton>
      </div>
      {fenetre === 'opposition' || fenetre === 'clore' ? <CloreReprise r={r} nom={nom} opposition={fenetre === 'opposition'} fermer={() => setFenetre(null)} fait={fait} /> : null}
      {fenetre === 'confirmer' ? <ConfirmerReprise r={r} nom={nom} fermer={() => setFenetre(null)} fait={fait} /> : null}
    </section>
  );
}

function OuvrirReprise({ id, nom, fermer, fait }: { id: string; nom: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [cause, setCause] = useState<CauseReprise | null>(null);
  const [repreneur, setRepreneur] = useState('');
  const [email, setEmail] = useState('');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (champ: string, t: string) => { setRefus(t); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const ouvrir = () => {
    if (!cause) { refuser('cause', phrase(`${K}.sans_cause`)); return; }
    if (repreneur.trim().length < 3) { refuser('nom', phrase(`${K}.nom_court`)); return; }
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email.trim())) { refuser('email', phrase(`${K}.email_faux`)); return; }
    if (motif.trim().length < 3) { refuser('motif', phrase('console.ecran.geste.motif_court')); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', `/console/entreprises/${id}/reprises`, { cause, nom: repreneur.trim(), email: email.trim(), motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.ouverte_toast`)); fait(); return; }
        refuser(typeof r.corps.champ === 'string' ? r.corps.champ : '', refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.ouvrir_titre`)} pour={nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="danger" occupe={occupe} onClick={ouvrir}>{titre(`${K}.ouvrir_bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${K}.ouvrir_${x}`)}</li>)}</ul>
      </div>
      <Pilules libelle={titre(`${K}.cause_titre`)} valeur={cause} changer={setCause} faute={faute?.champ === 'cause'}
        choix={CAUSES.map((x) => ({ valeur: x, texte: maj(dire(`${K}.cause.${x}`)) }))} />
      <div className="c-champs-2">
        <Champ libelle={titre(`${K}.repreneur_nom`)} aide={phrase(`${K}.repreneur_nom_aide`)} valeur={repreneur} changer={setRepreneur} premier {...fauteDe('nom')} />
        <Champ libelle={titre(`${K}.repreneur_email`)} aide={phrase(`${K}.repreneur_email_aide`)} type="email" inputMode="email" valeur={email} changer={setEmail} {...fauteDe('email')} />
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.motif_aide`)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function CloreReprise({ r, nom, opposition, fermer, fait }: { r: Reprise; nom: string; opposition: boolean; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const c = opposition ? 'opposition' : 'clore';
  const clore = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const x = await api('POST', `/console/reprises/${r.id}/clore`, { opposition, motif: motif.trim() });
        if (!x) return;
        if (x.statut === 200) { toast(phrase(`${K}.${c}_toast`)); fait(); return; }
        setRefus(refusDe(x));
      } catch (e) { setRefus(panneDe(e)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.${c}_titre`)} pour={nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={clore}>{titre(`${K}.${c}_bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2'].map((x) => <li key={x}>{phrase(`${K}.${c}_${x}`, { nom: r.repreneur.nom })}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.${c}_aide`)} valeur={motif} changer={setMotif} premier faute={faute > 0} n={faute} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function ConfirmerReprise({ r, nom, fermer, fait }: { r: Reprise; nom: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const confirmer = () => {
    void (async () => {
      setOccupe(true);
      try {
        const x = await api('POST', `/console/reprises/${r.id}/confirmer`, {});
        if (!x) return;
        if (x.statut === 200) { toast(phrase(`${K}.confirmee_toast`, { nom: r.repreneur.nom })); fait(); return; }
        setRefus(refusDe(x));
      } catch (e) { setRefus(panneDe(e)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.confirmer_titre`)} pour={nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="danger" occupe={occupe} onClick={confirmer}>{titre(`${K}.confirmer_bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li>{phrase(`${K}.confirmer_p1`, { nom: r.repreneur.nom, entreprise: nom })}</li>
          <li>{r.prevenue ? phrase(`${K}.confirmer_p2`, { nom: r.prevenue }) : phrase(`${K}.confirmer_p2_personne`)}</li>
          <li>{phrase(`${K}.confirmer_p3`)}</li>
        </ul>
      </div>
      <p className="c-al-qui">{phrase(`${K}.confirmer_qui`, { qui: r.ouvertePar.nom ?? '—', le: jourCourt(jourDe(r.ouverteLe)) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}
