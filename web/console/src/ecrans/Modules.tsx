// Les modules pilotés depuis la console (0226 ; Skander, 25/11/2026 : « à partir de la console je dois avoir chaque module
// et je peux mettre bêta dessus ou à venir »). Un onglet des Réglages : chaque module, son état pour tout le monde, ses
// exceptions par entreprise ; un geste (la direction seule, motivé, au journal) le change, sans nouvelle version.
// Venue de la fiche d'un client (`entreprise`), la page règle les exceptions de CETTE entreprise.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { heureDe, jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Zone, toast } from '../ui.tsx';

const K = 'console.ecran.modules';
// (1.388.73) « volontaires » : bêta chez les entreprises qui se sont déclarées volontaires, à venir chez les autres.
export const ETATS = ['ouvert', 'beta', 'volontaires', 'progressif', 'a_venir', 'ferme'] as const;
// (1.388.74) Les parts proposées pour une ouverture progressive (le rang de chaque entreprise est stable).
const PARTS = [10, 25, 50, 75] as const;
type Etat = (typeof ETATS)[number];
type Module = { id: string; nom: string; quoi: string; serveur: Etat; avecDonnees: number | null };
type Pose = { id: number; module: string; entreprise: string | null; nom: string | null; etat: Etat; motif: string; message: string | null; le: string; par: string | null; debut: string | null; fin: string | null; part?: number | null };
type Trace = { id: string; le: string; geste?: string; motif: string; par: string | null; entreprise: string | null; nom: string | null;
  avant: { module: string; etat: Etat | 'serveur'; message?: string | null } | null; apres: { module: string; etat: Etat | 'serveur'; message?: string | null; debut?: string | null; fin?: string | null; part?: number | null } | null };
type Donnees = { maintenant: string; modules: Module[]; poses: Pose[]; entreprise: { id: string; nom: string } | null; titulaire: boolean; nomTitulaire: string | null; historique: Trace[]; volontaires?: { n: number; noms: { id: string; nom: string; depuis: string }[] }; progressif?: Record<string, { total: number; p10: number; p25: number; p50: number; p75: number }> };

// (1.388.72) Un état posé vaut entre son début (vide : tout de suite) et sa fin (vide : sans fin) ; parmi ceux qui valent,
// le plus récemment commencé. La même règle que la base (plateforme.module_en_vigueur), à l'heure du serveur.
const instant = (iso: string | null | undefined, defaut: number) => (iso ? Date.parse(iso) : defaut);
export function enVigueur(poses: readonly Pose[], module: string, entreprise: string | null, a: number): Pose | undefined {
  return poses.filter((p) => p.module === module && p.entreprise === entreprise && instant(p.debut, -Infinity) <= a && instant(p.fin, Infinity) > a)
    .sort((x, y) => instant(y.debut, -Infinity) - instant(x.debut, -Infinity))[0];
}
// L'état qui vaut : l'exception de l'entreprise, sinon le réglage général posé, sinon la variable du serveur.
export function etatQuiVaut(m: Module, poses: readonly Pose[], entreprise: string | null, a = Date.now()): { etat: Etat; source: 'entreprise' | 'general' | 'serveur'; pose?: Pose } {
  const propre = entreprise ? enVigueur(poses, m.id, entreprise, a) : undefined;
  if (propre) return { etat: propre.etat, source: 'entreprise', pose: propre };
  const general = enVigueur(poses, m.id, null, a);
  return general ? { etat: general.etat, source: 'general', pose: general } : { etat: m.serveur, source: 'serveur' };
}
// Une date et son heure, comme ailleurs dans la console.
const leJour = (iso: string) => `${jourCourt(jourDe(iso))} à ${heureDe(iso)}`;
// Les durées proposées pour un retour automatique (en heures), puis « à une date ».
const DUREES = [{ v: '', h: 0 }, { v: '1h', h: 1 }, { v: '1j', h: 24 }, { v: '7j', h: 168 }, { v: '30j', h: 720 }, { v: 'date', h: 0 }];
// La valeur d'un champ datetime-local (heure de l'ordinateur) en instant ISO, ou null.
const versIso = (v: string) => { if (!v) return null; const t = new Date(v); return Number.isNaN(t.getTime()) ? null : t.toISOString(); };

function Pastille({ etat, part }: { etat: Etat; part?: number | null | undefined }) {
  return <span className={`c-mod-etat c-mod-${etat}`}>{titre(`${K}.etat.${etat}`)}{etat === 'progressif' && part ? ` · ${part} %` : ''}</span>;
}

function FenetreModule({ m, d, entreprise, fermer, fait }: { m: Module; d: Donnees; entreprise: { id: string; nom: string } | null; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const ent = entreprise?.id ?? null;
  const maintenant = Date.parse(d.maintenant) || Date.now();
  const actuel = etatQuiVaut(m, d.poses, ent, maintenant);
  const [etat, setEtat] = useState<string>(actuel.source === (ent ? 'entreprise' : 'general') ? actuel.etat : 'serveur');
  const [motif, setMotif] = useState('');
  // Le message aux clients de ce module : celui déjà posé ici se reprend, pour le corriger ou l'effacer.
  const posee = d.poses.find((p) => p.module === m.id && p.entreprise === ent && !p.debut);
  // (1.388.72) Quand ? Tout de suite, ou à une date. Jusqu'à quand ? Sans fin, une durée, ou une date.
  const [quand, setQuand] = useState<'maintenant' | 'date'>('maintenant');
  const [debutTexte, setDebutTexte] = useState('');
  const [duree, setDuree] = useState('');
  const [finTexte, setFinTexte] = useState('');
  const debutIso = quand === 'date' ? versIso(debutTexte) : null;
  const depart = debutIso ? Date.parse(debutIso) : maintenant;
  const dureeH = DUREES.find((x) => x.v === duree)?.h ?? 0;
  const finIso = duree === 'date' ? versIso(finTexte) : dureeH ? new Date(depart + dureeH * 3_600_000).toISOString() : null;
  const [message, setMessage] = useState(posee?.message ?? '');
  // (1.388.74) La part d'une ouverture progressive : celle déjà posée, sinon 10 %.
  const [part, setPart] = useState<number>(posee?.part ?? 10);
  const compteProg = d.progressif?.[m.id];
  const nProg = (p: number) => (compteProg ? Number((compteProg as Record<string, number>)[`p${p}`] ?? 0) : null);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        if (quand === 'date' && !debutIso) { setRefus(phrase(`${K}.g.date_manque`)); return; }
    if (duree === 'date' && !finIso) { setRefus(phrase(`${K}.g.date_manque`)); return; }
    const r = await api('POST', '/console/modules', { module: m.id, entreprise: ent, etat, motif: motif.trim(), message: etat === 'serveur' ? null : message.trim() || null,
      debut: etat === 'serveur' ? null : debutIso, fin: etat === 'serveur' ? null : finIso, part: etat === 'progressif' ? part : null });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(phrase(`${K}.fait`, { module: m.nom })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  // Les choix, en cartes : chacun dit ce qu'il fait, l'état d'aujourd'hui est marqué, et « Enregistrer » ne s'allume
  // que si l'on change quelque chose.
  // Une ouverture progressive porte sur l'ensemble des entreprises : elle ne se pose pas pour une seule.
  const choix: { valeur: string; etat: Etat | null }[] = [...ETATS.filter((e) => !(ent && e === 'progressif')).map((e) => ({ valeur: e, etat: e as Etat })), { valeur: 'serveur', etat: null }];
  const aujourdhui = actuel.source === (ent ? 'entreprise' : 'general') ? actuel.etat : 'serveur';
  const apres: Etat = etat === 'serveur' ? (ent ? etatQuiVaut(m, d.poses.filter((p) => p.entreprise !== ent), null).etat : m.serveur) : etat as Etat;
  const change = etat !== aujourdhui || quand === 'date' || !!duree || (etat !== 'serveur' && message.trim() !== (posee?.message ?? '')) || (etat === 'progressif' && part !== (posee?.part ?? null));
  return (
    <Dialogue titre={titre(`${K}.g.titre`)} sous={ent ? `${m.nom} · ${entreprise?.nom ?? ''}` : m.nom} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={!change} onClick={faire}>{titre(`${K}.g.bouton`)}</Bouton>
      </>}>
      <fieldset className="c-mod-choix">
        <legend className="c-champ-libelle">{titre(`${K}.g.etat`)}</legend>
        {choix.map((c) => (
          <label key={c.valeur} className={`c-mod-carte${etat === c.valeur ? ' c-mod-carte-on' : ''}`}>
            <input type="radio" name="etat-module" value={c.valeur} checked={etat === c.valeur} onChange={() => { setEtat(c.valeur); setRefus(null); }} />
            <span className="c-mod-carte-tete">
              {c.etat ? <Pastille etat={c.etat} /> : <b>{titre(ent ? `${K}.comme_tous` : `${K}.revenir_serveur`)}</b>}
              {c.valeur === aujourdhui ? <span className="c-mod-actuel">{dire(`${K}.g.actuel`)}</span> : null}
            </span>
            <span className="c-sous">{c.etat ? dire(`${K}.etat_quoi.${c.etat}`, { n: d.volontaires?.n ?? 0 }) : dire(ent ? `${K}.g.comme_tous_quoi` : `${K}.g.serveur_quoi`, { etat: dire(`${K}.etat.${apres}`) })}</span>
          </label>
        ))}
      </fieldset>
      {etat === 'progressif' ? (
        <fieldset className="c-mod-segment c-mod-parts">
          <legend className="c-champ-libelle">{titre(`${K}.g.part`)}</legend>
          {PARTS.map((p) => (
            <label key={p} className={part === p ? 'c-mod-seg-on' : ''}><input type="radio" name="part-module" checked={part === p} onChange={() => setPart(p)} />{p} %
              {nProg(p) !== null ? <span className="c-sous"> · {selon(nProg(p) ?? 0, `${K}.g.part_n`)}</span> : null}</label>
          ))}
        </fieldset>
      ) : null}
      {change ? (
        <div className="c-al-ce-qui-va">
          <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
          <ul>
            <li>{phrase(`${K}.g.va.etat`, { module: m.nom, avant: dire(`${K}.etat.${actuel.etat}`), apres: dire(`${K}.etat.${apres}`) })}</li>
            <li>{phrase(ent ? `${K}.g.va.qui_une` : `${K}.g.va.qui_tous`, { nom: entreprise?.nom ?? '' })}</li>
            {etat !== 'serveur' && debutIso ? <li><b>{phrase(`${K}.g.va.a_partir`, { quand: leJour(debutIso), avant: dire(`${K}.etat.${actuel.etat}`) })}</b></li> : null}
            {etat !== 'serveur' && finIso ? <li><b>{phrase(`${K}.g.va.jusqua`, { quand: leJour(finIso), retour: dire(`${K}.etat.${ent ? etatQuiVaut(m, d.poses.filter((p) => p.entreprise !== ent), null, Date.parse(finIso)).etat : m.serveur}`) })}</b></li> : null}
            <li>{phrase(`${K}.g.va.effet.${apres}`)}</li>
            {apres === 'progressif' ? <li><b>{phrase(`${K}.g.va.prog_${(nProg(part) ?? 0) === 0 ? '0' : nProg(part) === 1 ? '1' : 'n'}`, { n: nProg(part) ?? 0, total: compteProg?.total ?? 0, part })}</b></li> : null}
            {apres === 'volontaires' ? <li><b>{ent ? phrase(`${K}.g.va.vol_${d.volontaires?.noms.some((v) => v.id === ent) ? 'elle' : 'pas_elle'}`, { nom: entreprise?.nom ?? '' })
              : phrase(`${K}.g.va.vol_${(d.volontaires?.n ?? 0) === 0 ? '0' : d.volontaires?.n === 1 ? '1' : 'n'}`, { n: d.volontaires?.n ?? 0 })}</b></li> : null}
            {(apres === 'ferme' || apres === 'a_venir') && m.avecDonnees !== null && !ent ? <li><b>{phrase(`${K}.g.va.donnees_${m.avecDonnees === 0 ? '0' : m.avecDonnees === 1 ? '1' : 'n'}`, { n: m.avecDonnees })}</b></li> : null}
          </ul>
        </div>
      ) : null}
      {etat === 'serveur' ? null : (
        <div className="c-mod-quand">
          <fieldset className="c-mod-segment">
            <legend className="c-champ-libelle">{titre(`${K}.g.quand`)}</legend>
            {(['maintenant', 'date'] as const).map((q) => (
              <label key={q} className={quand === q ? 'c-mod-seg-on' : ''}><input type="radio" name="quand-module" checked={quand === q} onChange={() => setQuand(q)} />{titre(`${K}.g.quand_${q}`)}</label>
            ))}
          </fieldset>
          {quand === 'date' ? <Champ libelle={titre(`${K}.g.debut`)} type="datetime-local" valeur={debutTexte} changer={setDebutTexte} /> : null}
          <fieldset className="c-mod-segment">
            <legend className="c-champ-libelle">{titre(`${K}.g.jusqua`)}</legend>
            {DUREES.map((x) => (
              <label key={x.v || 'sans'} className={duree === x.v ? 'c-mod-seg-on' : ''}><input type="radio" name="duree-module" checked={duree === x.v} onChange={() => setDuree(x.v)} />{titre(`${K}.g.duree_${x.v || 'sans'}`)}</label>
            ))}
          </fieldset>
          {duree === 'date' ? <Champ libelle={titre(`${K}.g.fin`)} type="datetime-local" valeur={finTexte} changer={setFinTexte} /> : null}
        </div>
      )}
      {etat === 'serveur' ? null : (
        <div className="c-mod-message">
          <Zone libelle={titre(`${K}.g.message`)} aide={phrase(`${K}.g.message_aide`)} valeur={message} changer={setMessage} max={300} placeholder={dire(`${K}.g.message_exemple`)} />
          {message.trim() ? (
            <div className="c-mod-apercu" aria-label={titre(`${K}.g.apercu`)}>
              <span className="c-champ-libelle">{titre(`${K}.g.apercu`)}</span>
              <p className={`c-mod-bandeau c-mod-bandeau-${apres === 'ferme' || apres === 'a_venir' ? 'pause' : 'info'}`}>
                <b>{apres === 'ferme' || apres === 'a_venir' ? dire(`${K}.g.apercu_pause`) : dire(`${K}.g.apercu_info`)}</b> — {message.trim()}
              </p>
            </div>
          ) : null}
        </div>
      )}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}


// (1.388.71) Revenir à l'état d'avant un changement : la même porte que « Changer… », avec l'état et le message d'avant,
// un motif, et ce qui va se passer. Seul le dernier changement d'un module (pour tous ou pour une entreprise) se reprend,
// tant que rien n'est passé par-dessus : sinon on reprendrait un état que quelqu'un a déjà remplacé.
function FenetreRetour({ t, m, fermer, fait }: { t: Trace; m: Module; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const avant = t.avant?.etat ?? 'serveur';
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/modules', { module: m.id, entreprise: t.entreprise, etat: avant, motif: motif.trim(), message: avant === 'serveur' ? null : t.avant?.message ?? null });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(phrase(`${K}.h.fait`, { module: m.nom })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const nomEtat = (e: string) => e === 'serveur' ? dire(`${K}.h.serveur`) : dire(`${K}.etat.${e}`);
  return (
    <Dialogue titre={titre(`${K}.h.titre`)} sous={t.entreprise ? `${m.nom} · ${t.nom ?? ''}` : m.nom} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.h.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li>{phrase(`${K}.g.va.etat`, { module: m.nom, avant: nomEtat(t.apres?.etat ?? 'serveur'), apres: nomEtat(avant) })}</li>
          <li>{phrase(t.entreprise ? `${K}.g.va.qui_une` : `${K}.g.va.qui_tous`, { nom: t.nom ?? '' })}</li>
          <li>{t.avant?.message ? phrase(`${K}.h.message_revient`, { message: t.avant.message }) : phrase(`${K}.h.sans_message`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// (1.388.72) Annuler un changement programmé avant qu'il commence : motivé, au journal.
function FenetreAnnuler({ p, m, fermer, fait }: { p: Pose; m: Module | undefined; fermer: () => void; fait: () => void }) {
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
        const r = await api('POST', '/console/modules/annuler', { id: p.id, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200) { toast(phrase(`${K}.prog.annule`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.prog.titre`)} sous={`${m?.nom ?? p.module}${p.entreprise ? ` · ${p.nom ?? ''}` : ''}`} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.prog.bouton`)}</Bouton>
      </>}>
      <p>{phrase(`${K}.prog.quoi`, { etat: dire(`${K}.etat.${p.etat}`), quand: leJour(p.debut ?? '') })}</p>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function Historique({ d, peut, reprendre }: { d: Donnees; peut: boolean; reprendre: (t: Trace, m: Module) => void }) {
  const nomEtat = (e: string, part?: number | null) => e === 'serveur' ? <span className="c-mod-etat c-mod-serveur">{titre(`${K}.h.serveur`)}</span> : <Pastille etat={e as Etat} part={part} />;
  // Le dernier changement de chaque couple (module, entreprise) : c'est le seul qui se reprend. Un changement programmé
  // s'annule dans le tableau, il ne se « reprend » pas.
  const derniers = new Set<string>();
  const vus = new Set<string>();
  for (const t of d.historique) { if (t.geste === 'modules.annuler' || t.apres?.debut) continue; const k = `${t.apres?.module ?? ''}|${t.entreprise ?? ''}`; if (!vus.has(k)) { vus.add(k); derniers.add(t.id); } }
  if (!d.historique.length) return <p className="c-sous c-mod-h-vide">{phrase(`${K}.h.vide`)}</p>;
  return (
    <div className="c-defile">
      <table className="c-table c-mod-histo">
        <thead><tr>
          <th scope="col">{titre(`${K}.h.col.quand`)}</th>
          <th scope="col">{titre(`${K}.col.module`)}</th>
          <th scope="col">{titre(`${K}.h.col.changement`)}</th>
          <th scope="col">{titre(`${K}.h.col.motif`)}</th>
          <th scope="col"><span className="c-cache">{titre(`${K}.col.geste`)}</span></th>
        </tr></thead>
        <tbody>
          {d.historique.map((t) => {
            const m = d.modules.find((x) => x.id === (t.apres ?? t.avant)?.module);
            if (!m) return null;
            const annulation = t.geste === 'modules.annuler';
            return (
              <tr key={t.id}>
                <td className="c-mod-h-quand">{jourCourt(jourDe(t.le))} · {heureDe(t.le)}<span className="c-sous c-bloc">{t.par ?? '—'}</span></td>
                <td><b>{m.nom}</b><span className="c-sous c-bloc">{t.entreprise ? t.nom ?? '—' : dire(`${K}.h.tous`)}</span></td>
                <td>{annulation ? <span className="c-mod-h-chg">{dire(`${K}.h.annule`)} {nomEtat(t.avant?.etat ?? 'serveur')}</span> : <><span className="c-mod-h-chg">{nomEtat(t.avant?.etat ?? 'serveur')}<span aria-hidden="true">→</span><span className="c-cache">{dire(`${K}.h.vers`)}</span>{nomEtat(t.apres?.etat ?? 'serveur', t.apres?.part)}</span>
                  {t.apres?.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${t.apres.message}\u00a0»`}</span> : null}
                  {t.apres?.debut ? <span className="c-mod-prog c-bloc">{dire(`${K}.prog.a_partir`, { quand: leJour(t.apres.debut) })}</span> : null}
                  {t.apres?.fin ? <span className="c-mod-prog c-bloc">{dire(`${K}.prog.jusqua`, { quand: leJour(t.apres.fin) })}</span> : null}</>}</td>
                <td>{t.motif}</td>
                <td className="c-droite">{peut && derniers.has(t.id) ? <Bouton petit onClick={() => reprendre(t, m)}>{titre(`${K}.h.revenir`)}</Bouton> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Modules({ entreprise: demandee }: { entreprise: string | null }) {
  const chemin = demandee ? `/console/modules?entreprise=${encodeURIComponent(demandee)}` : '/console/modules';
  const [l, relire] = useLecture<Donnees>(chemin, chemin);
  const [ouvert, setOuvert] = useState<Module | null>(null);
  const [retour, setRetour] = useState<{ t: Trace; m: Module } | null>(null);
  const [annule, setAnnule] = useState<Pose | null>(null);
  if (l.etat === 'panne') return <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>;
  if (l.etat !== 'lu') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  const d = l.donnees;
  const ent = d.entreprise;
  const peut = d.titulaire;
  const maintenant = Date.parse(d.maintenant) || Date.now();
  // Les changements programmés d'un module (pas encore commencés) : pour cette entreprise, ou tous quand on regarde tout le monde.
  const programmes = (m: Module) => d.poses.filter((p) => p.module === m.id && p.debut && Date.parse(p.debut) > maintenant && (ent ? p.entreprise === ent.id : true));
  // Le résumé : combien de modules dans chaque état, pour qui regarde (tout le monde, ou cette entreprise).
  const compte = Object.fromEntries(ETATS.map((e) => [e, d.modules.filter((m) => etatQuiVaut(m, d.poses, ent?.id ?? null, maintenant).etat === e).length])) as Record<Etat, number>;
  const exceptionsEnTout = d.poses.filter((p) => p.entreprise !== null).length;
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-modules">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-modules">{ent ? titre(`${K}.titre_une`, { nom: ent.nom }) : titre(`${K}.titre`)}</h2>
          <p className="c-carte-sous">{phrase(ent ? `${K}.sous_une` : `${K}.sous`)}</p>
        </div>
        {ent ? <a className="c-lien" href="#/reglages?onglet=modules">{titre(`${K}.voir_tous`)}</a> : null}
      </div>
      <ul className="c-mod-resume" aria-label={titre(`${K}.resume`)}>
        {ETATS.map((e) => <li key={e} className={compte[e] ? '' : 'c-mod-zero'}><Pastille etat={e} /><b>{compte[e]}</b></li>)}
        {ent ? null : <li className={exceptionsEnTout ? '' : 'c-mod-zero'}><span className="c-sous">{selon(exceptionsEnTout, `${K}.exceptions_en_tout`)}</span></li>}
      </ul>
      {ent ? null : <p className="c-sous c-mod-vol" id="rg-modules-vol">{d.volontaires && d.volontaires.n ? <>{dire(`${K}.vol.liste_${d.volontaires.n === 1 ? '1' : 'n'}`, { n: d.volontaires.n })} {d.volontaires.noms.slice(0, 8).map((v, i) => <span key={v.id}>{i ? ', ' : ''}<a href={`#/clients/${v.id}`}>{v.nom}</a></span>)}{d.volontaires.n > 8 ? dire(`${K}.vol.et_autres`, { n: d.volontaires.n - 8 }) : ''}.</> : phrase(`${K}.vol.liste_0`)}</p>}
      {peut ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.lecture_seule`, { nom: d.nomTitulaire ?? '—' })}</span></Alerte>}
      {ent || !peut ? null : <p className="c-sous c-mod-astuce">{phrase(`${K}.astuce_exception`)}</p>}
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
              const v = etatQuiVaut(m, d.poses, ent?.id ?? null, maintenant);
              const pose = v.pose;
              const exceptions = d.poses.filter((p) => p.module === m.id && p.entreprise !== null);
              return (
                <tr key={m.id} className={v.etat === 'ouvert' ? undefined : `c-mod-ligne-${v.etat}`}>
                  <td><b>{m.nom}</b><span className="c-sous c-bloc">{m.quoi}{m.avecDonnees ? ` · ${selon(m.avecDonnees, `${K}.donnees`)}` : ''}</span></td>
                  <td data-libelle={titre(ent ? `${K}.col.pour_elle` : `${K}.col.pour_tous`)}>
                    <Pastille etat={v.etat} part={v.pose?.part} />
                    <span className="c-sous c-bloc">{v.source === 'serveur' ? dire(`${K}.source.serveur`)
                      : pose ? phrase(`${K}.source.pose`, { jour: jourCourt(jourDe(pose.le)), par: pose.par ?? '—', motif: pose.motif })
                        : dire(`${K}.source.${v.source}`)}</span>
                    {pose?.message ? <span className="c-mod-msg c-bloc">{`«\u00a0${pose.message}\u00a0»`}</span> : null}
                    {v.pose?.fin ? <span className="c-mod-prog c-bloc">{phrase(`${K}.prog.jusqua`, { quand: leJour(v.pose.fin) })}</span> : null}
                    {programmes(m).map((p) => (
                      <span key={p.id} className="c-mod-prog c-bloc">
                        {dire(`${K}.prog.a_partir`, { quand: leJour(p.debut ?? '') })} <Pastille etat={p.etat} part={p.part} />{p.fin ? ` ${dire(`${K}.prog.puis_jusqua`, { quand: leJour(p.fin) })}` : ''}
                        {p.entreprise && !ent ? ` · ${p.nom ?? ''}` : ''}
                        {peut ? <> · <button type="button" className="c-lien c-mod-annuler" onClick={() => setAnnule(p)}>{dire(`${K}.prog.annuler`)}</button></> : null}
                      </span>
                    ))}
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
      <h3 className="c-mod-h-titre" id="rg-modules-histo">{titre(`${K}.h.section`)}</h3>
      <p className="c-sous c-mod-h-sous">{phrase(`${K}.h.sous`)}</p>
      <Historique d={d} peut={peut} reprendre={(t, m) => setRetour({ t, m })} />
      {annule ? <FenetreAnnuler p={annule} m={d.modules.find((x) => x.id === annule.module)} fermer={() => setAnnule(null)} fait={() => { setAnnule(null); relire(); }} /> : null}
      {retour ? <FenetreRetour t={retour.t} m={retour.m} fermer={() => setRetour(null)} fait={() => { setRetour(null); relire(); }} /> : null}
      {ouvert ? <FenetreModule m={ouvert} d={d} entreprise={ent} fermer={() => setOuvert(null)} fait={() => { setOuvert(null); relire(); }} /> : null}
    </section>
  );
}
