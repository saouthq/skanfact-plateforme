// Les secrets et leur échéance (0130 ; docs/console.md C53 ; serveur/console/secrets.ts), dans l'écran Sécurité. Le
// registre ne montre jamais la valeur d'un secret — il ne l'a pas : son nom, à quoi il sert, où il vit, quand il a été
// renouvelé, et son échéance (le jour où il expire, ou celui où son rythme le rappelle). Le plus pressé d'abord ; en
// retard en rouge, bientôt en orange, toujours dit en mots. La direction et la technique notent un secret, son
// renouvellement, ou qu'on ne le suit plus ; chaque fois avec un motif.
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole } from '../contexte.ts';
import { jourCourt } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, maj, MenuLigne, Puce, toast, Vide, Zone, type TonPuce } from '../ui.tsx';

const S = 'console.ecran.service.se.sc';
export type EtatSecret = 'a_jour' | 'bientot' | 'en_retard' | 'sans_echeance';
export type Secret = {
  id: string; nom: string; role: string; ou: string; renouveleLe: string; expireLe: string | null; rotationJours: number | null;
  noteLe: string; notePar: string | null; echeance: string | null; jours: number | null; etat: EtatSecret;
};
const PUCE: Record<EtatSecret, TonPuce> = { en_retard: 'lecture_seule', bientot: 'en_retard', a_jour: 'actif', sans_echeance: 'hors' };

// L'échéance en mots : « dans 12 jours, le 27/10/2026 », « en retard de 3 jours », « aucune : ni date, ni rythme ».
function echeanceEnMots(s: Secret): string {
  if (s.echeance === null || s.jours === null) return dire(`${S}.ech.aucune`);
  if (s.jours < 0) return dire(`${S}.ech.retard`, { n: -s.jours, le: jourCourt(s.echeance) });
  if (s.jours === 0) return dire(`${S}.ech.aujourdhui`, { le: jourCourt(s.echeance) });
  return dire(`${S}.ech.dans`, { n: s.jours, le: jourCourt(s.echeance) });
}
// Pourquoi cette échéance : l'expiration, ou le rythme (« tous les 365 jours »), ou les deux.
const pourquoi = (s: Secret) => [s.expireLe ? dire(`${S}.expire`, { le: jourCourt(s.expireLe) }) : null,
  s.rotationJours ? dire(`${S}.rythme`, { n: s.rotationJours }) : null].filter((x): x is string => !!x).join(' · ');

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
function Qui() {
  const { moi } = useConsole();
  return <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>;
}
function Pied({ fermer, occupe, envoyer, bouton }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string }) {
  return <><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" occupe={occupe} onClick={envoyer}>{bouton}</Bouton></>;
}
const jourValide = (j: string) => /^\d{4}-\d{2}-\d{2}$/.test(j) && !Number.isNaN(new Date(`${j}T00:00:00Z`).getTime()) && new Date(`${j}T00:00:00Z`).toISOString().slice(0, 10) === j;

function FenetreNoter({ aujourdhui, fermer, fait }: { aujourdhui: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [nom, setNom] = useState('');
  const [role, setRole] = useState('');
  const [ou, setOu] = useState('');
  const [renouvele, setRenouvele] = useState(aujourdhui);
  const [expire, setExpire] = useState('');
  const [rythme, setRythme] = useState('');
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (nom.trim().length < 3) { e.refuser(phrase(`${S}.n.nom_court`), 'nom'); return; }
    if (role.trim().length < 3) { e.refuser(phrase(`${S}.n.role_court`), 'role'); return; }
    if (ou.trim().length < 3) { e.refuser(phrase(`${S}.n.ou_court`), 'ou'); return; }
    if (!jourValide(renouvele)) { e.refuser(phrase(`${S}.n.jour`), 'renouveleLe'); return; }
    if (expire && !jourValide(expire)) { e.refuser(phrase(`${S}.n.jour`), 'expireLe'); return; }
    const r = rythme.trim() ? Number(rythme.trim()) : null;
    if (r !== null && (!Number.isInteger(r) || r < 1 || r > 3650)) { e.refuser(phrase(`${S}.n.rythme_faux`), 'rotationJours'); return; }
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer('/console/service/secrets', { nom: nom.trim(), role: role.trim(), ou: ou.trim(), renouveleLe: renouvele, expireLe: expire || null, rotationJours: r, motif: motif.trim() },
      phrase(`${S}.n.fait`, { nom: nom.trim() }));
  };
  return (
    <Dialogue titre={titre(`${S}.n.titre`)} fermer={fermer} occupe={e.occupe} pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${S}.n.bouton`)} />}>
      <Alerte ton="attention">{phrase(`${S}.jamais_valeur`)}</Alerte>
      <Champ libelle={titre(`${S}.n.nom`)} aide={phrase(`${S}.n.nom_aide`)} valeur={nom} changer={setNom} premier faute={e.faute('nom')} n={e.n} />
      <Champ libelle={titre(`${S}.n.role`)} aide={phrase(`${S}.n.role_aide`)} valeur={role} changer={setRole} faute={e.faute('role')} n={e.n} />
      <Champ libelle={titre(`${S}.n.ou`)} aide={phrase(`${S}.n.ou_aide`)} valeur={ou} changer={setOu} faute={e.faute('ou')} n={e.n} />
      <Champ libelle={titre(`${S}.n.renouvele`)} type="date" valeur={renouvele} changer={setRenouvele} max={aujourdhui} faute={e.faute('renouveleLe')} n={e.n} />
      <Champ libelle={titre(`${S}.n.expire`)} aide={phrase(`${S}.n.expire_aide`)} type="date" valeur={expire} changer={setExpire} faute={e.faute('expireLe')} n={e.n} />
      <Champ libelle={titre(`${S}.n.rythme`)} aide={phrase(`${S}.n.rythme_aide`)} valeur={rythme} changer={setRythme} inputMode="numeric" faute={e.faute('rotationJours')} n={e.n} />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.motif_aide`)} valeur={motif} changer={setMotif} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRenouvele({ s, aujourdhui, fermer, fait }: { s: Secret; aujourdhui: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [le, setLe] = useState(aujourdhui);
  const [expire, setExpire] = useState('');
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (!jourValide(le)) { e.refuser(phrase(`${S}.n.jour`), 'le'); return; }
    if (expire && !jourValide(expire)) { e.refuser(phrase(`${S}.n.jour`), 'expireLe'); return; }
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/service/secrets/${s.id}/renouvele`, { le, expireLe: expire || null, motif: motif.trim() }, phrase(`${S}.r.fait`, { nom: s.nom }));
  };
  return (
    <Dialogue titre={titre(`${S}.r.titre`)} sous={s.nom} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${S}.r.bouton`)} />}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li>{phrase(`${S}.r.p1`, { le: jourCourt(s.renouveleLe) })}</li>
          <li>{phrase(s.rotationJours ? `${S}.r.p2_rythme` : `${S}.r.p2`, { n: s.rotationJours ?? 0 })}</li>
        </ul>
      </div>
      <Champ libelle={titre(`${S}.r.le`)} type="date" valeur={le} changer={setLe} max={aujourdhui} premier faute={e.faute('le')} n={e.n} />
      <Champ libelle={titre(`${S}.n.expire`)} aide={phrase(`${S}.r.expire_aide`)} type="date" valeur={expire} changer={setExpire} faute={e.faute('expireLe')} n={e.n} />
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.motif_aide`)} valeur={motif} changer={setMotif} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRetirer({ s, fermer, fait }: { s: Secret; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/service/secrets/${s.id}/retirer`, { motif: motif.trim() }, phrase(`${S}.x.fait`, { nom: s.nom }));
  };
  return (
    <Dialogue titre={titre(`${S}.x.titre`)} sous={s.nom} sousDonnee fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${S}.x.bouton`)} />}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul><li>{phrase(`${S}.x.p1`)}</li><li>{phrase(`${S}.x.p2`)}</li></ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.motif_aide`)} valeur={motif} changer={setMotif} premier faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

type Geste = { sorte: 'noter' } | { sorte: 'renouvele'; s: Secret } | { sorte: 'retirer'; s: Secret };
export function Secrets({ secrets, bientot, aujourdhui, relire }: { secrets: Secret[] | undefined; bientot: number; aujourdhui: string; relire: () => void }) {
  const [geste, setGeste] = useState<Geste | null>(null);
  const fait = () => { setGeste(null); relire(); };
  const l = secrets ?? [];
  return (
    <section className="c-carte c-se-secrets" aria-labelledby="se-secrets">
      <div className="c-carte-tete">
        <div>
          <h2 id="se-secrets">{titre(`${S}.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${S}.sous`, { n: bientot })}</p>
        </div>
        <Bouton petit icone="plus" onClick={() => setGeste({ sorte: 'noter' })}>{titre(`${S}.noter`)}</Bouton>
      </div>
      {l.length === 0 ? <Vide icone="cadenas">{phrase(`${S}.aucun`)}</Vide> : (
        <div className="c-defile">
          <table className="c-table c-se-secrets-table">
            <thead><tr>
              <th scope="col">{titre(`${S}.col.secret`)}</th>
              <th scope="col">{titre(`${S}.col.ou`)}</th>
              <th scope="col">{titre(`${S}.col.renouvele`)}</th>
              <th scope="col">{titre(`${S}.col.echeance`)}</th>
              <th scope="col"><span className="c-cache">{titre(`${S}.col.gestes`)}</span></th>
            </tr></thead>
            <tbody>
              {l.map((s) => (
                <tr key={s.id}>
                  <td><b data-donnee>{s.nom}</b><span className="c-sous c-bloc" data-donnee>{s.role}</span></td>
                  <td data-libelle={titre(`${S}.col.ou`)}><span data-donnee>{s.ou}</span></td>
                  <td data-libelle={titre(`${S}.col.renouvele`)}>{jourCourt(s.renouveleLe)}{s.notePar ? <span className="c-sous c-bloc">{dire(`${S}.note_par`, { nom: s.notePar })}</span> : null}</td>
                  <td data-libelle={titre(`${S}.col.echeance`)}>
                    <Puce ton={PUCE[s.etat]}>{titre(`${S}.etat.${s.etat}`)}</Puce>
                    <span className="c-sous c-bloc">{maj(echeanceEnMots(s))}</span>
                    {pourquoi(s) ? <span className="c-sous c-bloc">{maj(pourquoi(s))}</span> : null}
                  </td>
                  <td className="c-droite">
                    <MenuLigne etiquette={titre(`${S}.menu`, { nom: s.nom })} actions={[
                      { titre: titre(`${S}.renouvele`), sous: phrase(`${S}.renouvele_sous`), faire: () => setGeste({ sorte: 'renouvele', s }) },
                      { titre: titre(`${S}.retirer`), sous: phrase(`${S}.retirer_sous`), faire: () => setGeste({ sorte: 'retirer', s }), danger: true, trait: true },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {geste?.sorte === 'noter' ? <FenetreNoter aujourdhui={aujourdhui} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'renouvele' ? <FenetreRenouvele s={geste.s} aujourdhui={aujourdhui} fermer={() => setGeste(null)} fait={fait} /> : null}
      {geste?.sorte === 'retirer' ? <FenetreRetirer s={geste.s} fermer={() => setGeste(null)} fait={fait} /> : null}
    </section>
  );
}
