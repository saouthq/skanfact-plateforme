// Le pilotage du site depuis la console (docs/pilotage-console.md ; Skander, 25/11/2026 : « avoir la main sur presque tout
// à partir de la console, mais que pour moi »). Un onglet des Réglages, réservé au titulaire de la console pour les gestes ;
// toute l'équipe lit.
// (1.388.75, point 5, base 0230) La lecture seule générale : pendant une grosse opération sur la base, les clients lisent
// tout et rien ne s'enregistre, jusqu'à l'heure dite.
// (1.388.76, point 6, base 0231) La version minimale : après une correction importante, les écrans ouverts avant elle
// rechargent avant d'enregistrer.
// (1.388.77, point 7, base 0232) Les réglages à distance : des limites et des délais du serveur, changés sans nouvelle
// version, dans des bornes que le code fixe.
// (1.388.79, point 9, base 0234) Les adresses de la console : elle ne s'ouvre que depuis les connexions que le titulaire
// choisit ; tant que la liste est vide, de partout.
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { heureDe, jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Puce, Zone, toast } from '../ui.tsx';
import { entier } from '../nombres.ts';

const K = 'console.ecran.pilotage';
type Ligne = { id: number; message: string | null; motif: string; debut: string; fin: string; poseeLe: string; par: string | null; leveeLe: string | null; levePar: string | null };
type Donnees = { maintenant: string; titulaire: boolean; nomTitulaire: string | null; lignes: Ligne[] };

const leJour = (iso: string) => `${jourCourt(jourDe(iso))} à ${heureDe(iso)}`;
// L'heure telle que les clients la liront (le serveur, serveur/fermeture.ts `finDite`) : « 14 h 30 », et le jour s'il
// n'est pas aujourd'hui (« 26/11/2026 à 9 h 00 »), à l'heure de Tunis.
const jourTunis = (t: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t));
export function commeLeClient(iso: string, maintenant: number): string {
  const [h, m] = heureDe(iso).split(':');
  const heure = `${Number(h)} h ${m ?? '00'}`;
  const t = Date.parse(iso);
  return jourTunis(t) === jourTunis(maintenant) ? heure : `${jourTunis(t)} à ${heure}`;
}
const versIso = (v: string) => { if (!v) return null; const t = new Date(v); return Number.isNaN(t.getTime()) ? null : t.toISOString(); };
// Les durées proposées (en minutes) ; douze heures au plus, comme une maintenance urgente (la base le revérifie).
const DUREES = [30, 60, 120, 240, 720] as const;

// L'état d'une ligne à l'heure du serveur : en cours, prévue, levée, annulée ou finie.
export function etatLecture(l: Ligne, a: number): 'en_cours' | 'prevue' | 'levee' | 'annulee' | 'finie' {
  const debut = Date.parse(l.debut), fin = Date.parse(l.fin);
  if (l.leveeLe) return Date.parse(l.leveeLe) < debut ? 'annulee' : 'levee';
  if (fin <= a) return 'finie';
  return debut <= a ? 'en_cours' : 'prevue';
}

function FenetrePoser({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const maintenant = Date.parse(d.maintenant) || Date.now();
  const [quand, setQuand] = useState<'maintenant' | 'date'>('maintenant');
  const [debutTexte, setDebutTexte] = useState('');
  const [duree, setDuree] = useState<number>(60);
  const [message, setMessage] = useState('');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const debutIso = quand === 'date' ? versIso(debutTexte) : null;
  const depart = debutIso ? Date.parse(debutIso) : maintenant;
  const finIso = new Date(depart + duree * 60_000).toISOString();
  const faire = () => {
    if (quand === 'date' && !debutIso) { setRefus(phrase(`${K}.ls.date_manque`)); return; }
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/lecture-seule', { motif: motif.trim(), message: message.trim() || null, debut: debutIso, fin: finIso });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(phrase(debutIso ? `${K}.ls.fait_prevue` : `${K}.ls.fait`, { fin: leJour(finIso) })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.ls.g.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(debutIso ? `${K}.ls.g.bouton_prevue` : `${K}.ls.g.bouton`)}</Bouton>
      </>}>
      <div className="c-mod-quand">
        <fieldset className="c-mod-segment">
          <legend className="c-champ-libelle">{titre(`${K}.ls.g.quand`)}</legend>
          {(['maintenant', 'date'] as const).map((q) => (
            <label key={q} className={quand === q ? 'c-mod-seg-on' : ''}><input type="radio" name="quand-lecture" checked={quand === q} onChange={() => setQuand(q)} />{titre(`${K}.ls.g.quand_${q}`)}</label>
          ))}
        </fieldset>
        {quand === 'date' ? <Champ libelle={titre(`${K}.ls.g.debut`)} type="datetime-local" valeur={debutTexte} changer={setDebutTexte} /> : null}
        <fieldset className="c-mod-segment">
          <legend className="c-champ-libelle">{titre(`${K}.ls.g.duree`)}</legend>
          {DUREES.map((m) => (
            <label key={m} className={duree === m ? 'c-mod-seg-on' : ''}><input type="radio" name="duree-lecture" checked={duree === m} onChange={() => setDuree(m)} />{titre(`${K}.ls.g.duree_${m}`)}</label>
          ))}
        </fieldset>
      </div>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li><b>{debutIso ? phrase(`${K}.ls.g.va.de_a`, { debut: leJour(debutIso), fin: leJour(finIso) }) : phrase(`${K}.ls.g.va.jusqua`, { fin: leJour(finIso) })}</b></li>
          <li>{phrase(`${K}.ls.g.va.lire`)}</li>
          <li>{phrase(`${K}.ls.g.va.refus`)}</li>
          <li>{phrase(`${K}.ls.g.va.console`)}</li>
          {debutIso ? <li>{phrase(`${K}.ls.g.va.annonce`)}</li> : null}
          <li>{phrase(`${K}.ls.g.va.retour`)}</li>
        </ul>
      </div>
      <div className="c-mod-message">
        <Zone libelle={titre(`${K}.ls.g.message`)} aide={phrase(`${K}.ls.g.message_aide`)} valeur={message} changer={setMessage} max={300} placeholder={dire(`${K}.ls.g.message_exemple`)} />
        <div className="c-mod-apercu" aria-label={titre(`${K}.ls.g.apercu`)}>
          <span className="c-champ-libelle">{titre(`${K}.ls.g.apercu`)}</span>
          <p className={`c-mod-bandeau ${debutIso ? 'c-mod-bandeau-info' : 'c-pil-bandeau-lecture'}`}>
            <b>{dire(debutIso ? `${K}.ls.g.apercu_prevue` : `${K}.ls.g.apercu_cours`)}</b> {debutIso
              ? phrase(`${K}.ls.g.apercu_texte_prevue`, { debut: commeLeClient(debutIso, maintenant), fin: commeLeClient(finIso, maintenant) })
              : phrase(`${K}.ls.g.apercu_texte`, { fin: commeLeClient(finIso, maintenant) })}{message.trim() ? ` ${message.trim()}` : ''}
          </p>
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreLever({ l, prevue, fermer, fait }: { l: Ligne; prevue: boolean; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/lecture-seule/lever', { id: l.id, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200) { toast(phrase(prevue ? `${K}.ls.annulee` : `${K}.ls.levee`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(prevue ? `${K}.ls.a.titre_annuler` : `${K}.ls.a.titre_lever`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(prevue ? `${K}.ls.a.bouton_annuler` : `${K}.ls.a.bouton_lever`)}</Bouton>
      </>}>
      <p>{prevue ? phrase(`${K}.ls.a.quoi_annuler`, { debut: leJour(l.debut), fin: leJour(l.fin) }) : phrase(`${K}.ls.a.quoi_lever`, { fin: leJour(l.fin) })}</p>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function LectureSeule() {
  const [l, relire] = useLecture<Donnees>('/console/lecture-seule', 'lecture-seule');
  const [poser, setPoser] = useState(false);
  const [lever, setLever] = useState<{ l: Ligne; prevue: boolean } | null>(null);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const a = Date.parse(d.maintenant) || Date.now();
  const peut = d.titulaire;
  const enCours = d.lignes.find((x) => etatLecture(x, a) === 'en_cours') ?? null;
  const prevues = d.lignes.filter((x) => etatLecture(x, a) === 'prevue').sort((x, y) => Date.parse(x.debut) - Date.parse(y.debut));
  const passees = d.lignes.filter((x) => !['en_cours', 'prevue'].includes(etatLecture(x, a)));
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-lecture-seule">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-lecture-seule">{titre(`${K}.ls.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.ls.sous`)}</p>
        </div>
        {peut && !enCours ? <Bouton ton="principal" onClick={() => setPoser(true)}>{titre(`${K}.ls.poser`)}</Bouton> : null}
      </div>
      {peut ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.reserve`, { nom: d.nomTitulaire ?? '—' })}</span></Alerte>}
      {enCours ? (
        <div className="c-pil-etat c-pil-en-cours" id="rg-lecture-seule-etat">
          <span className="c-mod-etat c-pil-lecture">{titre(`${K}.ls.etat.en_cours`)}</span>
          <p><b>{phrase(`${K}.ls.en_cours`, { fin: leJour(enCours.fin) })}</b>
            <span className="c-sous c-bloc">{phrase(`${K}.ls.pose_par`, { quand: leJour(enCours.poseeLe), par: enCours.par ?? '—', motif: enCours.motif })}</span>
            {enCours.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${enCours.message}\u00a0»`}</span> : null}</p>
          {peut ? <Bouton onClick={() => setLever({ l: enCours, prevue: false })}>{titre(`${K}.ls.lever`)}</Bouton> : null}
        </div>
      ) : (
        <div className="c-pil-etat c-pil-ouvert" id="rg-lecture-seule-etat">
          <span className="c-mod-etat c-mod-ouvert">{titre(`${K}.ls.etat.ouvert`)}</span>
          <p>{phrase(`${K}.ls.ouvert`)}</p>
        </div>
      )}
      {prevues.length ? (
        <ul className="c-pil-prevues" aria-label={titre(`${K}.ls.prevues`)}>
          {prevues.map((p) => (
            <li key={p.id}>
              <span className="c-mod-etat c-mod-a_venir">{titre(`${K}.ls.etat.prevue`)}</span>
              <span>{phrase(`${K}.ls.prevue`, { debut: leJour(p.debut), fin: leJour(p.fin) })}{p.message ? ` · «\u00a0${p.message}\u00a0»` : ''}</span>
              {peut ? <button type="button" className="c-lien" onClick={() => setLever({ l: p, prevue: true })}>{dire(`${K}.ls.annuler`)}</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className="c-mod-h-titre">{titre(`${K}.ls.h.section`)}</h3>
      {passees.length ? (
        <div className="c-defile">
          <table className="c-table c-pil-histo">
            <thead><tr>
              <th scope="col">{titre(`${K}.ls.h.col.quand`)}</th>
              <th scope="col">{titre(`${K}.ls.h.col.fin`)}</th>
              <th scope="col">{titre(`${K}.ls.h.col.motif`)}</th>
            </tr></thead>
            <tbody>
              {passees.map((x) => {
                const e = etatLecture(x, a);
                return (
                  <tr key={x.id}>
                    <td>{leJour(x.debut)}<span className="c-sous c-bloc">{x.par ?? '—'}</span></td>
                    <td>{e === 'finie' ? phrase(`${K}.ls.h.finie`, { quand: leJour(x.fin) })
                      : phrase(e === 'annulee' ? `${K}.ls.h.annulee` : `${K}.ls.h.levee`, { quand: leJour(x.leveeLe ?? x.fin), par: x.levePar ?? '—' })}</td>
                    <td>{x.motif}{x.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${x.message}\u00a0»`}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sous c-mod-h-vide">{phrase(`${K}.ls.h.vide`)}</p>}
      {poser ? <FenetrePoser d={d} fermer={() => setPoser(false)} fait={() => { setPoser(false); relire(); }} /> : null}
      {lever ? <FenetreLever l={lever.l} prevue={lever.prevue} fermer={() => setLever(null)} fait={() => { setLever(null); relire(); }} /> : null}
    </section>
  );
}

type LigneVm = { id: number; version: string | null; message: string | null; motif: string; le: string; par: string | null };
type DonneesVm = { titulaire: boolean; nomTitulaire: string | null; enLigne: string | null; lignes: LigneVm[] };

function FenetreImposer({ version, fermer, fait }: { version: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [message, setMessage] = useState('');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/version-minimale', { motif: motif.trim(), message: message.trim() || null });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(phrase(`${K}.vm.fait`, { version })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.vm.g.titre`, { version })} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.vm.g.bouton`, { version })}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li><b>{phrase(`${K}.vm.g.va.bandeau`, { version })}</b></li>
          <li>{phrase(`${K}.vm.g.va.refus`)}</li>
          <li>{phrase(`${K}.vm.g.va.rien`)}</li>
          <li>{phrase(`${K}.vm.g.va.retour`)}</li>
        </ul>
      </div>
      <div className="c-mod-message">
        <Zone libelle={titre(`${K}.vm.g.message`)} aide={phrase(`${K}.vm.g.message_aide`)} valeur={message} changer={setMessage} max={300} placeholder={dire(`${K}.vm.g.message_exemple`)} />
        <div className="c-mod-apercu" aria-label={titre(`${K}.vm.g.apercu`)}>
          <span className="c-champ-libelle">{titre(`${K}.vm.g.apercu`)}</span>
          <p className="c-mod-bandeau c-pil-bandeau-lecture">
            <b>{dire(`${K}.vm.g.apercu_sorte`)}</b> {dire(`${K}.vm.g.apercu_texte`)}{message.trim() ? ` ${message.trim()}` : ''}
            <span className="c-pil-apercu-bouton">{dire(`${K}.vm.g.apercu_bouton`)}</span>
          </p>
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRetirer({ version, fermer, fait }: { version: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/version-minimale', { motif: motif.trim(), retirer: true });
        if (!r) return;
        if (r.statut === 200) { toast(phrase(`${K}.vm.retire`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.vm.r.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.vm.r.bouton`)}</Bouton>
      </>}>
      <p>{phrase(`${K}.vm.r.quoi`, { version })}</p>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Le numéro le plus récent des deux (« 1.388.77 » avant « 1.388.76 ») : la version en ligne plus récente que le minimum.
const avant = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

function VersionMinimale() {
  const [l, relire] = useLecture<DonneesVm>('/console/version-minimale', 'version-minimale');
  const [imposer, setImposer] = useState(false);
  const [retirer, setRetirer] = useState(false);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const peut = d.titulaire;
  const actuelle = d.lignes[0] && d.lignes[0].version ? d.lignes[0] : null;
  const enLigne = d.enLigne;
  const aImposer = !!enLigne && (!actuelle || avant(actuelle.version as string, enLigne));
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-version-minimale">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-version-minimale">{titre(`${K}.vm.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.vm.sous`)}</p>
        </div>
        {peut && aImposer ? <Bouton ton="principal" onClick={() => setImposer(true)}>{titre(`${K}.vm.imposer`)}</Bouton> : null}
      </div>
      {peut ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.reserve`, { nom: d.nomTitulaire ?? '—' })}</span></Alerte>}
      {actuelle ? (
        <div className="c-pil-etat c-pil-en-cours" id="rg-version-minimale-etat">
          <span className="c-mod-etat c-pil-lecture">{titre(`${K}.vm.etat.imposee`)}</span>
          <p><b>{phrase(`${K}.vm.imposee`, { version: actuelle.version ?? '' })}</b>
            <span className="c-sous c-bloc">{phrase(`${K}.vm.pose_par`, { quand: leJour(actuelle.le), par: actuelle.par ?? '—', motif: actuelle.motif })}</span>
            {actuelle.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${actuelle.message}\u00a0»`}</span> : null}</p>
          {peut ? <Bouton onClick={() => setRetirer(true)}>{titre(`${K}.vm.retirer`)}</Bouton> : null}
        </div>
      ) : (
        <div className="c-pil-etat c-pil-ouvert" id="rg-version-minimale-etat">
          <span className="c-mod-etat c-mod-ouvert">{titre(`${K}.vm.etat.aucune`)}</span>
          <p>{phrase(`${K}.vm.aucune`)}</p>
        </div>
      )}
      <p className="c-sous c-pil-en-ligne">{enLigne
        ? (actuelle && aImposer ? phrase(`${K}.vm.plus_recente`, { enLigne }) : phrase(`${K}.vm.en_ligne`, { version: enLigne }))
        : phrase(`${K}.vm.en_ligne_inconnue`)}</p>
      <h3 className="c-mod-h-titre">{titre(`${K}.vm.h.section`)}</h3>
      {d.lignes.length ? (
        <div className="c-defile">
          <table className="c-table c-pil-histo">
            <thead><tr>
              <th scope="col">{titre(`${K}.vm.h.col.quand`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.quoi`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.motif`)}</th>
            </tr></thead>
            <tbody>
              {d.lignes.map((x) => (
                <tr key={x.id}>
                  <td>{leJour(x.le)}<span className="c-sous c-bloc">{x.par ?? '—'}</span></td>
                  <td>{x.version ? titre(`${K}.vm.h.imposee`, { version: x.version }) : titre(`${K}.vm.h.retiree`)}</td>
                  <td>{x.motif}{x.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${x.message}\u00a0»`}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sous c-mod-h-vide">{phrase(`${K}.vm.h.vide`)}</p>}
      {imposer && enLigne ? <FenetreImposer version={enLigne} fermer={() => setImposer(false)} fait={() => { setImposer(false); relire(); }} /> : null}
      {retirer && actuelle ? <FenetreRetirer version={actuelle.version ?? ''} fermer={() => setRetirer(false)} fait={() => { setRetirer(false); relire(); }} /> : null}
    </section>
  );
}

type ReglageD = { cle: string; famille: 'limites' | 'delais'; defaut: number; min: number; max: number; unite: string };
type ChangeD = { valeur: number; motif: string; le: string; par: string | null };
type GesteD = { id: number; le: string; geste: string; motif: string; avant: { cle: string; valeur: number | null } | null; apres: { cle: string; valeur: number | null } | null; par: string | null };
type DonneesRd = { titulaire: boolean; nomTitulaire: string | null; changes: Record<string, ChangeD>; historique: GesteD[]; reglages: ReglageD[] };
// « 60 appels », « 1 appel par seconde », « 30 minutes » : la valeur avec son unité, accordée.
const avecUnite = (r: ReglageD, n: number) => dire(`${K}.rd.unite.${r.unite}_${n > 1 ? 'n' : '1'}`, { n: entier(n) });

function FenetreReglage({ r, actuel, change, fermer, fait }: { r: ReglageD; actuel: number; change: boolean; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [quoi, setQuoi] = useState<'valeur' | 'origine'>('valeur');
  const [texte, setTexteBrut] = useState(String(actuel));
  // Un refus se lit pour la valeur qui l'a fait : changer la valeur (ou le choix) l'efface.
  const setTexte = (v: string) => { setTexteBrut(v); setRefus(null); };
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const n = Number(texte.replace(/\s/g, ''));
  const lisible = quoi === 'origine' || (/^\s*\d[\d\s]*$/.test(texte) && Number.isInteger(n));
  const dansLesBornes = quoi === 'origine' || (lisible && n >= r.min && n <= r.max);
  const nouvelle = quoi === 'origine' ? r.defaut : n;
  const faire = () => {
    if (!dansLesBornes) { setRefus(phrase(`${K}.rd.g.bornes`, { min: avecUnite(r, r.min), max: avecUnite(r, r.max) })); return; }
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', '/console/reglages-distants', { cle: r.cle, valeur: quoi === 'origine' ? null : n, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200) { toast(phrase(`${K}.rd.fait`, { reglage: dire(`${K}.rd.r.${r.cle}`), valeur: avecUnite(r, nouvelle) })); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.rd.g.titre`, { reglage: dire(`${K}.rd.r.${r.cle}`) })} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(quoi === 'origine' ? `${K}.rd.g.bouton_origine` : `${K}.rd.g.bouton`)}</Bouton>
      </>}>
      <p>{phrase(`${K}.rd.q.${r.cle}`)}</p>
      {change ? (
        <fieldset className="c-mod-segment">
          <legend className="c-champ-libelle">{titre(`${K}.rd.g.quoi`)}</legend>
          {(['valeur', 'origine'] as const).map((q) => (
            <label key={q} className={quoi === q ? 'c-mod-seg-on' : ''}><input type="radio" name="quoi-reglage" checked={quoi === q} onChange={() => { setQuoi(q); setRefus(null); }} />{q === 'origine' ? titre(`${K}.rd.g.quoi_origine`, { valeur: avecUnite(r, r.defaut) }) : titre(`${K}.rd.g.quoi_valeur`)}</label>
          ))}
        </fieldset>
      ) : null}
      {quoi === 'valeur' ? (
        <div className="c-pil-valeur">
          <Champ libelle={titre(`${K}.rd.g.valeur`)} valeur={texte} changer={setTexte} inputMode="numeric" premier faute={!dansLesBornes} />
          <span className="c-pil-unite">{dire(`${K}.rd.u.${r.unite}`)}</span>
          <p className="c-sous c-pil-bornes">{phrase(`${K}.rd.g.entre`, { min: avecUnite(r, r.min), max: avecUnite(r, r.max), origine: avecUnite(r, r.defaut) })}</p>
        </div>
      ) : null}
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li><b>{dansLesBornes ? phrase(`${K}.rd.g.va.avant_apres`, { avant: avecUnite(r, actuel), apres: avecUnite(r, nouvelle) }) : phrase(`${K}.rd.g.bornes`, { min: avecUnite(r, r.min), max: avecUnite(r, r.max) })}</b></li>
          <li>{phrase(`${K}.rd.e.${r.cle}`)}</li>
          <li>{phrase(`${K}.rd.g.va.delai`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function ReglagesDistants() {
  const [l, relire] = useLecture<DonneesRd>('/console/reglages-distants', 'reglages-distants');
  const [ouvert, setOuvert] = useState<ReglageD | null>(null);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const peut = d.titulaire;
  const parCle = new Map(d.reglages.map((r) => [r.cle, r]));
  const familles = (['limites', 'delais'] as const).map((f) => ({ f, liste: d.reglages.filter((r) => r.famille === f) })).filter((x) => x.liste.length);
  const nomDe = (cle: string | undefined) => (cle && parCle.has(cle) ? titre(`${K}.rd.r.${cle}`) : cle ?? '—');
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-reglages-distants">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-reglages-distants">{titre(`${K}.rd.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.rd.sous`)}</p>
        </div>
      </div>
      {peut ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.reserve`, { nom: d.nomTitulaire ?? '—' })}</span></Alerte>}
      {familles.map(({ f, liste }) => (
        <div key={f} className="c-pil-famille">
          <h3 className="c-mod-h-titre">{titre(`${K}.rd.f.${f}`)}</h3>
          <div className="c-defile">
            <table className="c-table c-pil-reglages">
              <thead><tr>
                <th scope="col">{titre(`${K}.rd.col.reglage`)}</th>
                <th scope="col">{titre(`${K}.rd.col.valeur`)}</th>
                {peut ? <th scope="col"><span className="c-cache">{titre(`${K}.rd.col.geste`)}</span></th> : null}
              </tr></thead>
              <tbody>
                {liste.map((r) => {
                  const c = d.changes[r.cle];
                  const actuel = c ? Number(c.valeur) : r.defaut;
                  return (
                    <tr key={r.cle} data-reglage={r.cle}>
                      <td><b>{titre(`${K}.rd.r.${r.cle}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.rd.q.${r.cle}`)}</span></td>
                      <td className="c-pil-val">
                        <b>{avecUnite(r, actuel)}</b>
                        {c ? <span className="c-sous c-bloc"><span className="c-mod-etat c-pil-lecture">{titre(`${K}.rd.change`)}</span> {dire(`${K}.rd.change_par`, { quand: leJour(c.le), par: c.par ?? '—', origine: avecUnite(r, r.defaut) })}</span>
                          : <span className="c-sous c-bloc">{dire(`${K}.rd.origine`)}</span>}
                      </td>
                      {peut ? <td className="c-pil-geste"><Bouton petit onClick={() => setOuvert(r)} etiquette={titre(`${K}.rd.changer_aria`, { reglage: dire(`${K}.rd.r.${r.cle}`) })}>{titre(`${K}.rd.changer`)}</Bouton></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="c-sous c-pil-textes">{titre(`${K}.rd.textes`)} <a href="#/reglages?onglet=messages">{dire(`${K}.rd.textes_lien`)}</a></p>
      <h3 className="c-mod-h-titre">{titre(`${K}.rd.h.section`)}</h3>
      {d.historique.length ? (
        <div className="c-defile">
          <table className="c-table c-pil-histo">
            <thead><tr>
              <th scope="col">{titre(`${K}.vm.h.col.quand`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.quoi`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.motif`)}</th>
            </tr></thead>
            <tbody>
              {d.historique.map((g) => {
                const r = parCle.get(g.apres?.cle ?? g.avant?.cle ?? '');
                const avant = g.avant?.valeur ?? r?.defaut ?? null, apres = g.apres?.valeur ?? r?.defaut ?? null;
                return (
                  <tr key={g.id}>
                    <td>{leJour(g.le)}<span className="c-sous c-bloc">{g.par ?? '—'}</span></td>
                    <td><b>{nomDe(g.apres?.cle ?? g.avant?.cle)}</b>
                      <span className="c-sous c-bloc">{r && avant !== null && apres !== null
                        ? titre(g.geste === 'reglages.distant_origine' ? `${K}.rd.h.origine` : `${K}.rd.h.change`, { avant: avecUnite(r, Number(avant)), apres: avecUnite(r, Number(apres)) })
                        : '—'}</span></td>
                    <td>{g.motif}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sous c-mod-h-vide">{phrase(`${K}.rd.h.vide`)}</p>}
      {ouvert ? <FenetreReglage r={ouvert} actuel={d.changes[ouvert.cle] ? Number(d.changes[ouvert.cle]?.valeur) : ouvert.defaut} change={!!d.changes[ouvert.cle]}
        fermer={() => setOuvert(null)} fait={() => { setOuvert(null); relire(); }} /> : null}
    </section>
  );
}

// ── Les adresses de la console (point 9 ; base 0234) ───────────────────────────────────────────────────────────────────
type Adresse = { id: number; plage: string; nom: string; motif: string; le: string; par: string | null; contientIci: boolean };
type GesteAd = { id: string; le: string; geste: string; motif: string; par: string | null; avant: { plage?: string; nom?: string; adresses?: { plage: string; nom: string }[] } | null; apres: { plage?: string; nom?: string } | null };
type DonneesAd = { titulaire: boolean; nomTitulaire: string | null; ici: string; iciPermise: boolean; adresses: Adresse[]; historique: GesteAd[] };
type GesteAdresse = { sorte: 'ajouter'; plage: string; nom: string } | { sorte: 'retirer'; a: Adresse };

function FenetreAdresse({ g, d, fermer, fait }: { g: GesteAdresse; d: DonneesAd; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const ajout = g.sorte === 'ajouter';
  const [plage, setPlageBrute] = useState(ajout ? g.plage : '');
  const [nom, setNomBrut] = useState(ajout ? g.nom : '');
  const [motif, setMotifBrut] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  // Un refus se lit pour ce qui l'a fait : changer l'adresse, le nom ou le motif l'efface.
  const setPlage = (v: string) => { setPlageBrute(v); setRefus(null); };
  const setNom = (v: string) => { setNomBrut(v); setRefus(null); };
  const setMotif = (v: string) => { setMotifBrut(v); setRefus(null); setFaute(0); };
  const premiere = ajout && d.adresses.length === 0;
  const faire = () => {
    if (ajout && !plage.trim()) { setRefus(phrase(`${K}.ad.g.plage_vide`)); return; }
    if (ajout && !nom.trim()) { setRefus(phrase(`${K}.ad.g.nom_vide`)); return; }
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = ajout ? await api('POST', '/console/adresses', { plage: plage.trim(), nom: nom.trim(), motif: motif.trim() })
          : await api('POST', '/console/adresses/retirer', { id: g.a.id, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 201 || res.statut === 200) { toast(phrase(ajout ? `${K}.ad.fait_ajout` : `${K}.ad.fait_retrait`, { plage: ajout ? plage.trim() : g.a.plage })); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(ajout ? `${K}.ad.g.titre_ajout` : `${K}.ad.g.titre_retrait`, ajout ? {} : { plage: g.a.plage })} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(ajout ? `${K}.ad.g.bouton_ajout` : `${K}.ad.g.bouton_retrait`)}</Bouton>
      </>}>
      {ajout ? (
        <div className="c-rg-dates">
          <Champ libelle={titre(`${K}.ad.g.plage`)} valeur={plage} changer={setPlage} premier autoComplete="off" faute={!!refus && !plage.trim()}
            aide={phrase(`${K}.ad.g.plage_aide`, { ici: d.ici || '—' })} />
          <Champ libelle={titre(`${K}.ad.g.nom`)} valeur={nom} changer={setNom} autoComplete="off" faute={!!refus && !nom.trim()}
            aide={phrase(`${K}.ad.g.nom_aide`)} />
        </div>
      ) : <p>{phrase(`${K}.ad.g.retrait_qui`, { nom: g.a.nom, plage: g.a.plage })}</p>}
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          {ajout ? <>
            <li><b>{phrase(premiere ? `${K}.ad.g.va.premiere` : `${K}.ad.g.va.ajout`)}</b></li>
            <li>{phrase(`${K}.ad.g.va.session`)}</li>
            <li>{phrase(`${K}.ad.g.va.change`)}</li>
          </> : <>
            <li><b>{phrase(d.adresses.length === 1 ? `${K}.ad.g.va.derniere` : `${K}.ad.g.va.retrait`)}</b></li>
            <li>{phrase(`${K}.ad.g.va.garde`)}</li>
          </>}
          <li>{phrase(`${K}.ad.g.va.secours`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.ls.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function AdressesConsole() {
  const [l, relire] = useLecture<DonneesAd>('/console/adresses', 'adresses-console');
  const [geste, setGeste] = useState<GesteAdresse | null>(null);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const peut = d.titulaire;
  const vide = d.adresses.length === 0;
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-adresses-console">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-adresses-console">{titre(`${K}.ad.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.ad.sous`)}</p>
        </div>
        {peut && !vide ? <Bouton icone="plus" onClick={() => setGeste({ sorte: 'ajouter', plage: '', nom: '' })}>{titre(`${K}.ad.ajouter`)}</Bouton> : null}
      </div>
      {peut ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.reserve`, { nom: d.nomTitulaire ?? '—' })}</span></Alerte>}
      <div className="c-pil-ici">
        <span className="c-champ-libelle">{titre(`${K}.ad.ici`)}</span>
        <b className="c-mono" data-donnee>{d.ici || '—'}</b>
        <Puce ton={vide ? 'hors' : d.iciPermise ? 'actif' : 'urgent'}>{titre(vide ? `${K}.ad.ici_libre` : d.iciPermise ? `${K}.ad.ici_permise` : `${K}.ad.ici_refusee`)}</Puce>
      </div>
      {vide ? (
        <div className="c-pil-vide">
          <p>{phrase(`${K}.ad.vide`)}</p>
          {peut ? <Bouton ton="principal" onClick={() => setGeste({ sorte: 'ajouter', plage: d.ici, nom: '' })}>{titre(`${K}.ad.limiter`)}</Bouton> : null}
        </div>
      ) : (
        <div className="c-defile">
          <table className="c-table c-pil-adresses">
            <thead><tr>
              <th scope="col">{titre(`${K}.ad.col.adresse`)}</th>
              <th scope="col">{titre(`${K}.ad.col.nom`)}</th>
              <th scope="col">{titre(`${K}.ad.col.pose`)}</th>
              {peut ? <th scope="col"><span className="c-cache">{titre(`${K}.ad.col.geste`)}</span></th> : null}
            </tr></thead>
            <tbody>
              {d.adresses.map((a) => (
                <tr key={a.id} data-adresse={a.plage}>
                  <td><b className="c-mono" data-donnee>{a.plage}</b>{a.contientIci ? <span className="c-sous c-bloc">{titre(`${K}.ad.la_tienne`)}</span> : null}</td>
                  <td><b>{a.nom}</b><span className="c-sous c-bloc" data-donnee>« {a.motif} »</span></td>
                  <td>{leJour(a.le)}<span className="c-sous c-bloc">{a.par ?? '—'}</span></td>
                  {peut ? <td className="c-pil-geste"><Bouton petit onClick={() => setGeste({ sorte: 'retirer', a })} etiquette={titre(`${K}.ad.retirer_aria`, { plage: a.plage })}>{titre(`${K}.ad.retirer`)}</Bouton></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="c-sous">{phrase(`${K}.ad.note`)}</p>
      <h3 className="c-mod-h-titre">{titre(`${K}.rd.h.section`)}</h3>
      {d.historique.length ? (
        <div className="c-defile">
          <table className="c-table c-pil-histo">
            <thead><tr>
              <th scope="col">{titre(`${K}.vm.h.col.quand`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.quoi`)}</th>
              <th scope="col">{titre(`${K}.vm.h.col.motif`)}</th>
            </tr></thead>
            <tbody>
              {d.historique.map((g) => (
                <tr key={g.id}>
                  <td>{leJour(g.le)}<span className="c-sous c-bloc">{g.par ?? titre(`${K}.ad.h.serveur`)}</span></td>
                  <td><b>{titre(`${K}.ad.h.${g.geste === 'console.adresse_ajoutee' ? 'ajoutee' : g.geste === 'console.adresse_retiree' ? 'retiree' : 'ouvertes'}`)}</b>
                    <span className="c-sous c-bloc c-mono">{g.apres?.plage ?? g.avant?.plage ?? (g.avant?.adresses ?? []).map((x) => x.plage).join(', ')}</span></td>
                  <td>{g.motif}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="c-sous c-mod-h-vide">{phrase(`${K}.ad.h.vide`)}</p>}
      {geste ? <FenetreAdresse g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </section>
  );
}

export function Pilotage() {
  return <><LectureSeule /><VersionMinimale /><ReglagesDistants /><AdressesConsole /></>;
}
