// La sécurité du service (10 § 2.8, 03 § 6 ; serveur/console/routes.ts, GET /console/service/securite ;
// serveur/console/securite.ts ; docs/console.md C26). Ce que les règles de connexion ont fait, lu dans ce qu'elles
// écrivent déjà :
//   - quatre chiffres : les connexions abouties, les codes faux après un mot de passe bon, les comptes freinés, le
//     certificat ;
//   - ce qui demande un regard : un mot de passe connu de quelqu'un (des codes faux après lui), un compte freiné — et le
//     geste qui répond à l'appel de la personne (lever son attente, avec son motif) ;
//   - les connexions heure par heure, les règles qui freinent (leurs chiffres viennent du code), qui peut commander le
//     serveur, et l'équipe avec ses appareils et ses sessions.
// Les chaînes d'empreintes, relues par le serveur chaque heure (0115) : la dernière relecture, ce qui n'a jamais été relu,
// trente jours, et chaque chaîne cassée avec son point de rupture. Rien n'est inventé : le contenu des pièces, lui, n'est
// pas encore recomparé à son empreinte, et l'écran le dit.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier } from '../nombres.ts';
import { heureDe, jourCourt, quand } from '../temps.ts';
import { Alerte, Bouton, Dialogue, Lien, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import { EnteteService, EtatPuce, Tuile, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type EtatBrique, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const S = `${K}.se`;

type Heure = { heure: string; reussies: number; codesFaux: number };
type ARegarder = {
  sorte: 'code' | 'attente'; id: string; le: string; erreurs: number; qui: string | null; adresse: string | null; role: string | null;
  resolu: boolean | null; console: boolean; jusquAu: string | null; connu: boolean | null; appareil: { type: string; nouveau: boolean } | null;
};
type Membre = { id: string; nom: string; role: string; methode: 'sms' | 'application' | null; appareils: { nom: string; type: string }[];
  sessions: number; derniere: string | null; secours: number; codesFaux: number };
type Regle = { nom: string; valeurs: Record<string, number>; compte: number | null };
type Donnees = {
  maintenant: string; aujourdhui: string; role: 'direction' | 'technique'; veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[];
  heures: Heure[]; motsDePasseFaux: number; freines: number; aRegarder: ARegarder[]; equipe: Membre[]; regles: Regle[];
  cles: { id: string; retiree: boolean }[] | null; certificat: { expire: string; jours: number | null } | null;
  chaines?: Chaines;
};
type Chaines = {
  etat: 'casse' | 'arretee' | 'jamais' | 'bonne'; pasMs: number; parLot: number;
  dernier: { le: string; chaines: number; maillons: number; cassees: number; dureeMs: number } | null;
  total: number; maillons: number; jamais: number; plusAncien: string | null; nCassees: number;
  cassees: { sorte: string; rang: number | null; motif: string | null; le: string | null; entreprise: { id: string; nom: string } | null }[];
  jours: { jour: string; etat: 'bon' | 'casse' | 'rien' }[];
};

const somme = (h: readonly Heure[], k: 'reussies' | 'codesFaux') => h.reduce((s, x) => s + x[k], 0);

// ── Les quatre chiffres ─────────────────────────────────────────────────────────────────────────────────────────────
function Chiffres({ d }: { d: Donnees }) {
  const reussies = somme(d.heures, 'reussies'), codes = somme(d.heures, 'codesFaux');
  const c = d.certificat;
  const etatCertificat: EtatBrique = !c || c.jours === null ? 'nonmesure' : c.jours <= 7 ? 'grave' : c.jours <= 30 ? 'attention' : 'bon';
  return (
    <section className="c-sv-claires" aria-label={titre(`${S}.k.titre`)}>
      <div className="c-sv-tuiles c-tr-tuiles">
        <Tuile titre={titre(`${S}.k.reussies`)} valeur={entier(reussies)} unite={selon(reussies, `${S}.k.reussies_unite`)} sous={phrase(`${S}.k.reussies_sous`)} />
        <Tuile titre={titre(`${S}.k.codes`)} etat={codes ? 'attention' : 'bon'} valeur={entier(codes)} unite={selon(codes, `${S}.k.codes_unite`)}
          sous={phrase(codes ? `${S}.k.codes_sous` : `${S}.k.codes_rien`)} />
        <Tuile titre={titre(`${S}.k.freines`)} etat={d.freines ? 'attention' : 'bon'} valeur={entier(d.freines)} unite={selon(d.freines, `${S}.k.freines_unite`)}
          sous={maj(selon(d.motsDePasseFaux, `${S}.k.freines_sous`, { n: entier(d.motsDePasseFaux) }))} />
        <Tuile titre={titre(`${S}.k.certificat`)} etat={etatCertificat} {...(c && c.jours !== null ? { valeur: entier(c.jours), unite: selon(c.jours, `${S}.k.jours`) } : { mot: true, valeur: titre(`${S}.k.pas_lu`) })}
          sous={c ? phrase(`${S}.k.certificat_sous`, { jour: jourCourt(c.expire) }) : phrase(`${S}.k.certificat_rien`)} />
      </div>
    </section>
  );
}

// ── Ce qui demande un regard ────────────────────────────────────────────────────────────────────────────────────────
function Regards({ d, lever }: { d: Donnees; lever: (r: ARegarder) => void }) {
  const qui = (r: ARegarder) => r.qui ?? r.adresse ?? '—';
  return (
    <section className="c-carte c-se-regards" aria-labelledby="se-regards">
      <div className="c-al-section-tete"><div>
        <h2 id="se-regards">{titre(`${S}.r.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${S}.r.sous`)}</p>
      </div></div>
      {d.aRegarder.length ? (
        <ul className="c-se-regards-liste">
          {d.aRegarder.map((r) => {
            const urgent = r.sorte === 'code' && !r.resolu;
            return (
              <li key={`${r.sorte}${r.id}`} className={`c-se-regard${urgent ? ' c-se-regard-urgent' : ''}`}>
                <div className="c-se-regard-tete">
                  <b data-donnee>{qui(r)}</b>
                  {r.role ? <span className="c-sous">{titre(`console.ecran.role.${r.role}`)}{r.console ? ` · ${dire(`${S}.r.console`)}` : ''}</span> : null}
                  {r.qui && r.adresse && r.qui !== r.adresse ? <span className="c-sous c-mono" data-donnee>{r.adresse}</span> : null}
                  <Puce ton={urgent ? 'urgent' : 'a_regarder'}>{dire(urgent ? `${S}.r.d_abord` : `${S}.r.a_regarder`)}</Puce>
                </div>
                <p className="c-se-regard-titre">{phrase(r.sorte === 'code' ? `${S}.r.code_titre` : `${S}.r.attente_titre`, { n: entier(r.erreurs) })}</p>
                <p className="c-sous">{phrase(r.sorte === 'code' ? (r.resolu ? `${S}.r.code_resolu` : `${S}.r.code_pas_resolu`)
                  : r.connu === false ? `${S}.r.attente_inconnu` : `${S}.r.attente_sous`, { heure: r.jusquAu ? heureDe(r.jusquAu) : '—' })}</p>
                <div className="c-se-regard-pied">
                  <span className="c-sous">{maj(quand(r.le, d.aujourdhui))}{r.appareil ? ` · ${dire(`${S}.r.appareil.${r.appareil.type}`)}${r.appareil.nouveau ? ` · ${dire(`${S}.r.jamais_vu`)}` : ''}` : ''}</span>
                  {r.sorte === 'attente' && r.connu !== false ? <Bouton petit icone="personne" onClick={() => lever(r)}>{titre(`${S}.r.lever`)}</Bouton>
                    : r.sorte === 'code' && r.role ? <Lien petit href="#/equipe" fleche>{titre(`${S}.r.voir_equipe`)}</Lien> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <Vide>{phrase(`${S}.r.vide`)}</Vide>}
    </section>
  );
}

// ── Les connexions, heure par heure ─────────────────────────────────────────────────────────────────────────────────
function Connexions({ d }: { d: Donnees }) {
  const haut = Math.max(1, ...d.heures.map((h) => h.reussies));
  const hautFaux = Math.max(1, ...d.heures.map((h) => h.codesFaux));
  const reussies = somme(d.heures, 'reussies'), codes = somme(d.heures, 'codesFaux');
  return (
    <section className="c-carte c-se-connexions" aria-labelledby="se-connexions">
      <div className="c-al-section-tete"><div>
        <h2 id="se-connexions">{titre(`${S}.c.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${S}.c.sous`)}</p>
      </div></div>
      <div className="c-se-heures" role="img" aria-label={dire(`${S}.c.lecture`, { r: entier(reussies), c: entier(codes) })}>
        {d.heures.map((h) => (
          <span key={h.heure} className="c-se-heure" title={`${heureDe(h.heure)} : ${dire(`${S}.c.bulle`, { r: h.reussies, c: h.codesFaux })}`}>
            <span className="c-se-heure-bon" style={{ height: `${h.reussies ? Math.max(4, Math.round((h.reussies / haut) * 100)) : 2}%` }} />
            <span className="c-se-heure-faux" style={{ height: `${h.codesFaux ? Math.max(6, Math.round((h.codesFaux / hautFaux) * 100)) : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="c-se-axe" aria-hidden="true">
        <span>{d.heures[0] ? heureDe(d.heures[0].heure) : ''}</span><span>{d.heures[12] ? heureDe(d.heures[12].heure) : ''}</span><span>{titre(`${S}.c.maintenant`)}</span>
      </div>
      <dl className="c-tr-stats c-se-totaux">
        <div><dt><span className="c-se-cle c-se-cle-bon" />{titre(`${S}.c.reussies`)}</dt><dd>{entier(reussies)}</dd></div>
        <div><dt><span className="c-se-cle c-se-cle-faux" />{titre(`${S}.c.codes`)}</dt><dd>{entier(codes)}</dd></div>
        <div><dt>{titre(`${S}.c.mots`)}</dt><dd>{entier(d.motsDePasseFaux)}</dd></div>
      </dl>
    </section>
  );
}

// ── Les règles qui freinent ─────────────────────────────────────────────────────────────────────────────────────────
function Regles({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-se-regles" aria-labelledby="se-regles">
      <div className="c-al-section-tete"><div>
        <h2 id="se-regles">{titre(`${S}.g.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${S}.g.sous`)}</p>
      </div></div>
      <ul className="c-se-regles-liste">
        {d.regles.map((r) => (
          <li key={r.nom}>
            <div><b>{titre(`${S}.g.${r.nom}.nom`)}</b><span className="c-sous">{phrase(`${S}.g.${r.nom}.dit`, r.valeurs)}</span></div>
            <span className="c-se-regle-compte">{r.compte === null ? <span className="c-sous">{dire(`${S}.g.pas_compte`)}</span>
              : <><b>{entier(r.compte)}</b> <span className="c-sous">{selon(r.compte, `${S}.g.comptes`)}</span></>}</span>
          </li>
        ))}
      </ul>
      <p className="c-liste-pied">{phrase(`${S}.g.pied`)}</p>
    </section>
  );
}

// ── Qui peut commander le serveur ───────────────────────────────────────────────────────────────────────────────────
function Cles({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-se-cles" aria-labelledby="se-cles">
      <div className="c-al-section-tete"><div>
        <h2 id="se-cles">{titre(`${S}.cl.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${S}.cl.sous`)}</p>
      </div></div>
      {d.cles === null ? <Alerte ton="attention">{phrase(`${S}.cl.illisible`)}</Alerte>
        : d.cles.length === 0 ? <Vide>{phrase(`${S}.cl.aucune`)}</Vide> : (
          <ul className="c-se-cles-liste">
            {d.cles.map((c) => (
              <li key={c.id}><span className="c-mono" data-donnee>{c.id}</span><Puce ton={c.retiree ? 'hors' : 'actif'}>{dire(c.retiree ? `${S}.cl.retiree` : `${S}.cl.active`)}</Puce></li>
            ))}
          </ul>
        )}
      <p className="c-liste-pied">{phrase(`${S}.cl.pied`)}</p>
    </section>
  );
}

// ── L'équipe ────────────────────────────────────────────────────────────────────────────────────────────────────────
function Equipe({ d }: { d: Donnees }) {
  const { moi } = useConsole();
  return (
    <section className="c-carte c-se-equipe" aria-labelledby="se-equipe">
      <div className="c-al-section-tete">
        <div>
          <h2 id="se-equipe">{titre(`${S}.e.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${S}.e.sous`)}</p>
        </div>
        {d.role === 'direction' ? <Lien petit href="#/equipe" fleche>{titre(`${S}.e.gerer`)}</Lien> : null}
      </div>
      <div className="c-defile">
        <table className="c-table c-se-table">
          <thead><tr>
            <th scope="col">{titre(`${S}.e.col.personne`)}</th><th scope="col">{titre(`${S}.e.col.code`)}</th>
            <th scope="col">{titre(`${S}.e.col.appareils`)}</th><th scope="col" className="c-droite">{titre(`${S}.e.col.sessions`)}</th>
            <th scope="col">{titre(`${S}.e.col.derniere`)}</th><th scope="col" className="c-droite">{titre(`${S}.e.col.secours`)}</th>
          </tr></thead>
          <tbody>
            {d.equipe.map((m) => (
              <tr key={m.id}>
                <td><b data-donnee>{m.nom}{m.id === moi.utilisateur ? ` ${dire(`${S}.e.toi`)}` : ''}</b><span className="c-sous">{titre(`console.ecran.role.${m.role}`)}</span></td>
                <td>{m.methode ? titre(`${S}.e.methode.${m.methode}`) : <span className="c-tr-mal">{phrase(`${S}.e.sans_code`)}</span>}
                  {m.codesFaux ? <span className="c-sous c-tr-mal">{maj(selon(m.codesFaux, `${S}.e.codes_faux`))}</span> : null}</td>
                <td>{m.appareils.length ? <><b>{entier(m.appareils.length)}</b> <span className="c-sous" data-donnee>{m.appareils.map((a) => a.nom).join(', ')}</span></> : <span className="c-sous">{titre(`${S}.e.aucun_appareil`)}</span>}</td>
                <td className="c-droite c-mono" data-libelle={titre(`${S}.e.col.sessions`)}>{entier(m.sessions)}</td>
                <td>{m.derniere ? maj(quand(m.derniere, d.aujourdhui)) : <span className="c-sous">{titre(`${S}.e.jamais`)}</span>}</td>
                <td className={`c-droite c-mono${m.secours <= 2 ? ' c-tr-mal' : ''}`} data-libelle={titre(`${S}.e.col.secours`)}>{dire(`${S}.e.sur_dix`, { n: m.secours })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Les chaînes d'empreintes ────────────────────────────────────────────────────────────────────────────────────────
const ETAT_CHAINES: Record<Chaines['etat'], EtatBrique> = { bonne: 'bon', arretee: 'attention', casse: 'grave', jamais: 'nonmesure' };
const SORTES_CHAINE = new Set(['serie', 'livres', 'caisse']);
const TON_JOUR: Record<Chaines['jours'][number]['etat'], 'bon' | 'grave' | 'nonmesure'> = { bon: 'bon', casse: 'grave', rien: 'nonmesure' };
function Chaine({ c, aujourdhui }: { c: Chaines | undefined; aujourdhui: string }) {
  const etat = c ? ETAT_CHAINES[c.etat] : 'nonmesure';
  return (
    <section className="c-carte c-se-chaine" aria-labelledby="se-chaine">
      <div className="c-se-chaine-tete">
        <h2 id="se-chaine">{titre(`${S}.ch.titre`)}</h2>
        <EtatPuce etat={etat} texte={c ? maj(c.etat === 'casse' ? selon(c.nCassees, `${S}.ch.etat_casse`) : dire(`${S}.ch.etat_${c.etat}`)) : titre(`${S}.ch.etat_jamais`)} />
      </div>
      <p className="c-carte-sous">{phrase(`${S}.ch.sous`)}</p>
      {c ? (
        <>
          <dl className="c-se-chaine-chiffres">
            <div><dt>{titre(`${S}.ch.k.chaines`)}</dt><dd className="c-chiffre">{entier(c.total)}</dd></div>
            <div><dt>{titre(`${S}.ch.k.maillons`)}</dt><dd className="c-chiffre">{entier(c.maillons)}</dd></div>
            <div><dt>{titre(`${S}.ch.k.jamais`)}</dt><dd className="c-chiffre">{entier(c.jamais)}</dd></div>
            <div><dt>{titre(`${S}.ch.k.derniere`)}</dt><dd>{c.dernier ? maj(quand(c.dernier.le, aujourdhui)) : titre(`${S}.ch.jamais_relue`)}</dd></div>
          </dl>
          <p className="c-sous">{c.dernier
            ? phrase(`${S}.ch.rythme`, { lot: entier(c.parLot), chaines: selon(c.dernier.chaines, `${S}.ch.chaines`), maillons: selon(c.dernier.maillons, `${S}.ch.maillons`) })
            : phrase(`${S}.ch.rythme_avant`, { lot: entier(c.parLot) })}</p>
          <div className="c-se-frise" role="img" aria-label={phrase(`${S}.ch.frise_aria`)}>
            {c.jours.map((j) => <span key={j.jour} className={`c-case c-se-jour c-ton-${TON_JOUR[j.etat]}`} title={`${jourCourt(j.jour)} · ${dire(`${S}.ch.jour.${j.etat}`)}`} />)}
          </div>
          <p className="c-sous c-se-frise-legende">{phrase(`${S}.ch.frise`)}</p>
          {c.cassees.length ? (
            <div className="c-defile">
              <table className="c-table">
                <thead><tr><th>{titre(`${S}.ch.c.sorte`)}</th><th>{titre(`${S}.ch.c.entreprise`)}</th><th>{titre(`${S}.ch.c.rupture`)}</th><th>{titre(`${S}.ch.c.vue`)}</th></tr></thead>
                <tbody>
                  {c.cassees.map((x, i) => (
                    <tr key={`${x.sorte}-${x.le ?? ''}-${i}`}>
                      <td>{titre(SORTES_CHAINE.has(x.sorte) ? `${S}.ch.sorte.${x.sorte}` : `${S}.ch.sorte.autre`)}</td>
                      <td>{x.entreprise ? <a href={`#/clients/${x.entreprise.id}`} data-donnee>{x.entreprise.nom}</a> : <span className="c-attente">{dire(`${S}.ch.c.cachee`)}</span>}</td>
                      <td>{x.rang !== null ? dire(`${S}.ch.c.au_rang`, { rang: entier(x.rang), motif: x.motif ?? '' }) : '—'}</td>
                      <td>{x.le ? quand(x.le, aujourdhui) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
      <ul className="c-se-chaine-perimetre">
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.liens`)} /> <span className="c-sous">{phrase(`${S}.ch.p.liens_sous`)}</span></li>
        <li><EtatPuce etat="nonmesure" texte={titre(`${S}.ch.p.contenu`)} /> <span className="c-sous">{phrase(`${S}.ch.p.contenu_sous`)}</span></li>
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.caisse`)} /> <span className="c-sous">{phrase(`${S}.ch.p.caisse_sous`)}</span></li>
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.journal`)} /> <span className="c-sous">{phrase(`${S}.ch.p.journal_sous`)}</span></li>
      </ul>
      <p className="c-sous">{phrase(`${S}.ch.jamais_reparer`)}</p>
    </section>
  );
}

// ── Le geste : lever l'attente d'un compte ──────────────────────────────────────────────────────────────────────────
function FenetreLever({ r, fermer, fait }: { r: ARegarder; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', `/console/service/securite/attentes/${r.id}/lever`, { motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200) { toast(phrase(`${S}.l.fait`)); fait(); return; }
        setRefus(refusDe(res));
        if (res.corps.champ === 'motif') setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${S}.l.titre`)} sous={r.qui ?? r.adresse ?? undefined} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre(`${S}.l.garder`)}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${S}.l.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>
          <li>{phrase(`${S}.l.p1`, { n: entier(r.erreurs) })}</li>
          <li>{phrase(`${S}.l.p2`)}</li>
          <li>{phrase(`${S}.l.p3`)}</li>
        </ul>
      </div>
      {/* Le refus reste jusqu'au clic suivant : effacé à la frappe, il ferait remonter le bouton sous le curseur. */}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.l.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Securite() {
  const [l, relire] = useLecture<Donnees>('/console/service/securite', 'service-securite');
  useRelireTantQueRegarde(relire);
  const [lever, setLever] = useState<ARegarder | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  return (
    <>
      <EnteteService vue="securite" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <Chiffres d={d} />
          <Regards d={d} lever={setLever} />
          <div className="c-se-duo">
            <Connexions d={d} />
            <Regles d={d} />
          </div>
          <Equipe d={d} />
          <Cles d={d} />
          <Chaine c={d.chaines} aujourdhui={d.aujourdhui} />
        </>
      ) : null}
      {lever ? <FenetreLever r={lever} fermer={() => setLever(null)} fait={() => { setLever(null); relire(); }} /> : null}
    </>
  );
}
