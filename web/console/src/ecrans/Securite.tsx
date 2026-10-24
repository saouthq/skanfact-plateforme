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
// trente jours, et chaque chaîne cassée avec son point de rupture. Depuis 0142 (docs/console.md C66), le contenu de chaque
// pièce aussi, recomparé à son empreinte ; une relecture se demande d'ici (toutes, ou une entreprise pour la direction), et
// une chaîne cassée ouvre son incident sur la fiche réflexe « une chaîne d'empreintes cassée ».
// Les adresses internet de l'entrée (0143, C67) : celles qui ont été refusées ou freinées ces vingt-quatre heures, et le
// geste qui leur ferme l'entrée une heure ou un jour (les personnes déjà connectées continuent).
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier } from '../nombres.ts';
import { heureDe, jourCourt, jourDe, jourMois, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Lien, maj, Puce, toast, Vide, Zone } from '../ui.tsx';
import { Secrets, type Secret } from './Secrets.tsx';
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
  adresses?: Adresses; dureesBlocage?: number[];
  // Les secrets et leur échéance (0130), le plus pressé d'abord ; et le délai de « bientôt ».
  secrets?: Secret[]; secretBientot?: number;
};
type Nommee = { id: string; nom: string; numero: string | null };
type Adresses = {
  vues: { adresse: string; echecs: number; freins: number; derniere: string | null; bloquee: { id: string; jusquAu: string } | null }[];
  bloquees: { id: string; adresse: string; le: string; jusquAu: string; motif: string; par: string }[];
  finies: { adresse: string; le: string; fin: string; levee: boolean }[];
};
type Demande = {
  id: string; demandeeLe: string; par: string; toutes: boolean; entreprise: Nommee | null; total: number | null; faites: number; pieces: number;
  cassees: number; commencee: boolean; nouvelleLe: string | null; finieLe: string | null; arretee: boolean;
};
type Chaines = {
  etat: 'casse' | 'arretee' | 'jamais' | 'bonne'; pasMs: number; parLot: number; contenusParLot: number;
  dernier: { le: string; chaines: number; maillons: number; cassees: number; dureeMs: number } | null;
  total: number; maillons: number; jamais: number; plusAncien: string | null; nCassees: number;
  cassees: { sorte: string; quoi: 'liens' | 'contenu'; rang: number | null; motif: string | null; le: string | null; entreprise: Nommee | null }[];
  jours: { jour: string; etat: 'bon' | 'casse' | 'rien' }[];
  contenu: { dernier: { le: string; chaines: number; pieces: number; cassees: number; dureeMs: number } | null; jamais: number; plusAncien: string | null;
    nCassees: number; nonRelues: number; enAttente: number };
  demande: Demande | null; incident: { id: string; ref: string } | null;
};

const somme = (h: readonly Heure[], k: 'reussies' | 'codesFaux') => h.reduce((s, x) => s + x[k], 0);

// ── Les quatre chiffres ─────────────────────────────────────────────────────────────────────────────────────────────
function Chiffres({ d }: { d: Donnees }) {
  const reussies = somme(d.heures, 'reussies'), codes = somme(d.heures, 'codesFaux');
  // La tuile se regarde quand la liste a de quoi : trois codes faux de suite après un mot de passe bon (0091). Un code
  // faux isolé se compte sans demander de regard (recette du 19/10/2026 : « à regarder », et rien dessous).
  const aRegarder = d.aRegarder.filter((r) => r.sorte === 'code').length;
  const c = d.certificat;
  const etatCertificat: EtatBrique = !c || c.jours === null ? 'nonmesure' : c.jours <= 7 ? 'grave' : c.jours <= 30 ? 'attention' : 'bon';
  return (
    <section className="c-sv-claires" aria-label={titre(`${S}.k.titre`)}>
      <div className="c-sv-tuiles c-tr-tuiles">
        <Tuile titre={titre(`${S}.k.reussies`)} valeur={entier(reussies)} unite={selon(reussies, `${S}.k.reussies_unite`)} sous={phrase(`${S}.k.reussies_sous`)} />
        <Tuile titre={titre(`${S}.k.codes`)} etat={aRegarder ? 'attention' : 'bon'} valeur={entier(codes)} unite={selon(codes, `${S}.k.codes_unite`)}
          sous={phrase(aRegarder ? `${S}.k.codes_sous` : codes ? `${S}.k.codes_seuls` : `${S}.k.codes_rien`)} />
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

// ── Les adresses à l'entrée ─────────────────────────────────────────────────────────────────────────────────────────
type GesteAdresse = { sorte: 'bloquer'; adresse: string | null } | { sorte: 'debloquer'; b: Adresses['bloquees'][number] };
// La fin d'un blocage : « jusqu'à 15:34 » aujourd'hui, « jusqu'au 20/10 à 15:34 » un autre jour.
const jusqua = (iso: string, aujourdhui: string) => (jourDe(iso) === aujourdhui
  ? dire(`${S}.ad.jusqua_heure`, { heure: heureDe(iso) }) : dire(`${S}.ad.jusqua_jour`, { jour: jourMois(jourDe(iso)), heure: heureDe(iso) }));
function LesAdresses({ a, aujourdhui, faire }: { a: Adresses | undefined; aujourdhui: string; faire: (g: GesteAdresse) => void }) {
  if (!a) return null;
  return (
    <section className="c-carte c-se-adresses" aria-labelledby="se-adresses">
      <div className="c-al-section-tete">
        <div>
          <h2 id="se-adresses">{titre(`${S}.ad.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${S}.ad.sous`)}</p>
        </div>
        <Bouton petit icone="plus" onClick={() => faire({ sorte: 'bloquer', adresse: null })}>{titre(`${S}.ad.bloquer_une`)}</Bouton>
      </div>
      {a.bloquees.length ? (
        <ul className="c-se-bloquees">
          {a.bloquees.map((b) => (
            <li key={b.id} className="c-se-bloquee">
              <div>
                <b className="c-mono" data-donnee>{b.adresse}</b>{' '}
                <Puce ton="urgent">{dire(`${S}.ad.bloquee`, { jusqua: jusqua(b.jusquAu, aujourdhui) })}</Puce>
                <p className="c-sous">{maj(dire(`${S}.ad.par`, { par: b.par, quand: quand(b.le, aujourdhui) }))} · <span data-donnee>« {b.motif} »</span></p>
              </div>
              <Bouton petit onClick={() => faire({ sorte: 'debloquer', b })} etiquette={titre(`${S}.ad.debloquer_aria`, { adresse: b.adresse })}>{titre(`${S}.ad.debloquer`)}</Bouton>
            </li>
          ))}
        </ul>
      ) : null}
      {a.vues.length ? (
        <div className="c-defile">
          <table className="c-table c-se-adresses-table">
            <thead><tr>
              <th>{titre(`${S}.ad.c.adresse`)}</th><th className="c-num">{titre(`${S}.ad.c.echecs`)}</th><th className="c-num">{titre(`${S}.ad.c.freins`)}</th>
              <th>{titre(`${S}.ad.c.derniere`)}</th><th><span className="c-cache">{titre(`${S}.ad.c.geste`)}</span></th>
            </tr></thead>
            <tbody>
              {a.vues.map((v) => (
                <tr key={v.adresse}>
                  <td className="c-mono" data-donnee>{v.adresse}</td>
                  <td className="c-num">{entier(v.echecs)}</td>
                  <td className="c-num">{entier(v.freins)}</td>
                  <td>{v.derniere ? maj(quand(v.derniere, aujourdhui)) : '—'}</td>
                  <td>{v.bloquee ? <span className="c-sous">{maj(dire(`${S}.ad.bloquee`, { jusqua: jusqua(v.bloquee.jusquAu, aujourdhui) }))}</span>
                    : <Bouton petit onClick={() => faire({ sorte: 'bloquer', adresse: v.adresse })} etiquette={titre(`${S}.ad.bloquer_aria`, { adresse: v.adresse })}>{titre(`${S}.ad.bloquer`)}</Bouton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Vide>{phrase(`${S}.ad.vide`)}</Vide>}
      {a.finies.length ? (
        <p className="c-sous">{phrase(`${S}.ad.finies`, { liste: a.finies.map((f) => `${f.adresse} (${dire(f.levee ? `${S}.ad.levee` : `${S}.ad.finie`, { quand: quand(f.fin, aujourdhui) })})`).join(', ') })}</p>
      ) : null}
    </section>
  );
}

// Une adresse qui a la forme d'une adresse : quatre nombres de 0 à 255 (IPv4), ou des groupes hexadécimaux séparés par des
// deux-points (IPv6). La base, elle, la lit en entier ; ceci ne fait que refuser tôt ce qui n'en est clairement pas une.
function adresseLisible(a: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) return v4.slice(1).every((n) => Number(n) <= 255);
  return a.includes(':') && /^[0-9a-f:.]+$/i.test(a);
}

function FenetreBloquer({ adresse, durees, fermer, fait }: { adresse: string | null; durees: number[]; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [ip, setIp] = useState(adresse ?? '');
  const [heures, setHeures] = useState(durees[0] ?? 1);
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: 'adresse' | 'motif'; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const fauter = (champ: 'adresse' | 'motif', texte: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (ip.trim().length < 2) { fauter('adresse', phrase(`${S}.ad.f.adresse_vide`)); return; }
    // Les champs se refusent dans leur ordre : une adresse illisible avant le motif, sans attendre le serveur (recette du
    // 22/10/2026 : « 999.1.2.3 » passait le premier essai, refusé pour son motif seul). Le serveur relit l'adresse en entier.
    if (!adresseLisible(ip.trim())) { fauter('adresse', phrase(`${S}.ad.f.adresse_illisible`)); return; }
    if (motif.trim().length < 3) { fauter('motif', phrase('console.ecran.geste.motif_court')); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', '/console/service/securite/adresses', { adresse: ip.trim(), heures, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 201) { toast(phrase(`${S}.ad.f.fait`, { adresse: ip.trim() })); fait(); return; }
        setRefus(refusDe(res));
        setFaute((f) => ({ champ: res.corps.champ === 'motif' ? 'motif' : 'adresse', n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${S}.ad.f.titre`)} sous={adresse ?? undefined} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${S}.ad.f.bouton`)}</Bouton>
      </>}>
      {adresse ? null : (
        <Champ libelle={titre(`${S}.ad.f.adresse`)} aide={phrase(`${S}.ad.f.adresse_aide`)} valeur={ip} changer={setIp} placeholder="196.203.12.34"
          autoComplete="off" faute={faute?.champ === 'adresse'} n={faute?.n ?? 0} />
      )}
      <div className="c-champ">
        <span className="c-champ-libelle" id="se-bloquer-duree">{titre(`${S}.ad.f.duree`)}</span>
        <div className="c-pilules c-in-pilules" role="group" aria-labelledby="se-bloquer-duree">
          {durees.map((h) => (
            <button key={h} type="button" className="c-pilule" aria-pressed={heures === h} onClick={() => setHeures(h)}>{maj(dire(`${S}.ad.f.heures_${h === 1 ? '1' : 'n'}`, { n: h }))}</button>
          ))}
        </div>
      </div>
      <Alerte ton="attention"><span>{phrase(`${S}.ad.f.partagee`)}</span></Alerte>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>
          <li>{phrase(`${S}.ad.f.p1`)}</li>
          <li>{phrase(`${S}.ad.f.p2`)}</li>
          <li>{phrase(`${S}.ad.f.p3`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.ad.f.motif_aide`)} valeur={motif} changer={setMotif} faute={faute?.champ === 'motif'} n={faute?.n ?? 0} />
      <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreDebloquer({ b, aujourdhui, fermer, fait }: { b: Adresses['bloquees'][number]; aujourdhui: string; fermer: () => void; fait: () => void }) {
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
        const res = await api('POST', `/console/service/securite/adresses/${b.id}/debloquer`, { motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200) { toast(phrase(`${S}.ad.d.fait`, { adresse: b.adresse })); fait(); return; }
        setRefus(refusDe(res));
        setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${S}.ad.d.titre`)} sous={b.adresse} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre(`${S}.ad.d.garder`)}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${S}.ad.d.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>
          <li>{phrase(`${S}.ad.d.p1`, { jusqua: jusqua(b.jusquAu, aujourdhui) })}</li>
          <li>{phrase(`${S}.ad.d.p2`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.ad.d.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Les chaînes d'empreintes ────────────────────────────────────────────────────────────────────────────────────────
const ETAT_CHAINES: Record<Chaines['etat'], EtatBrique> = { bonne: 'bon', arretee: 'attention', casse: 'grave', jamais: 'nonmesure' };
const SORTES_CHAINE = new Set(['serie', 'livres', 'caisse']);
const TON_JOUR: Record<Chaines['jours'][number]['etat'], 'bon' | 'grave' | 'nonmesure'> = { bon: 'bon', casse: 'grave', rien: 'nonmesure' };
// Ce que la ligne « le contenu de chaque pièce » dit : cassé, une sorte que la relecture ne lit pas encore, relu, ou pas encore.
function etatContenu(c: Chaines['contenu']): { etat: EtatBrique; texte: string; sous: string } {
  if (c.nCassees > 0) return { etat: 'grave', texte: maj(selon(c.nCassees, `${S}.ch.p.contenu_casse_etat`)), sous: phrase(`${S}.ch.p.contenu_casse`) };
  if (!c.dernier) return { etat: 'nonmesure', texte: titre(`${S}.ch.p.contenu_jamais`), sous: '' };
  if (c.nonRelues > 0) return { etat: 'attention', texte: titre(`${S}.ch.p.contenu_inconnu`), sous: phrase(`${S}.ch.p.contenu_inconnu_sous`, { n: selon(c.nonRelues, `${S}.ch.chaines`) }) };
  return { etat: 'bon', texte: titre(`${S}.ch.p.contenu`), sous: '' };
}
const nomNumero = (e: Nommee) => (e.numero ? `${e.numero} · ${e.nom}` : e.nom);
// Où une chaîne casse : ses liens disent leur phrase (la base l'écrit) ; son contenu, un code que l'écran dit en mots.
const MOTIFS_CONTENU = new Set(['modifiee', 'disparue']);
const motifDe = (x: Chaines['cassees'][number]) => (x.quoi === 'contenu' && x.motif && MOTIFS_CONTENU.has(x.motif) ? dire(`${S}.ch.c.motif.${x.motif}`) : x.motif ?? '');

// La relecture demandée : où elle en est (le serveur la prend dans la minute), ou ce qu'elle a trouvé.
function DemandeEnCours({ d, aujourdhui }: { d: Demande; aujourdhui: string }) {
  const sur = d.toutes ? dire(`${S}.ch.r.toutes`) : d.entreprise ? nomNumero(d.entreprise) : dire(`${S}.ch.r.une`);
  const qui = phrase(`${S}.ch.r.qui`, { par: d.par, quand: quand(d.demandeeLe, aujourdhui), sur });
  if (d.finieLe) {
    return (
      <p className="c-sous c-se-relue" data-relecture="finie">
        {qui} {phrase(d.cassees ? `${S}.ch.r.finie_casse` : `${S}.ch.r.finie`, {
          quand: quand(d.finieLe, aujourdhui), chaines: selon(d.faites, `${S}.ch.chaines`), pieces: selon(d.pieces, `${S}.ch.pieces`), cassees: selon(d.cassees, `${S}.ch.cassees`),
        })}
      </p>
    );
  }
  const total = d.total ?? 0;
  return (
    <div className="c-se-relecture" data-relecture="en-cours">
      <p>{qui}</p>
      {d.commencee && d.total !== null ? (
        <>
          <div className="c-se-jauge" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={d.faites} aria-label={titre(`${S}.ch.r.jauge`)}>
            <span style={{ width: `${total ? Math.round((100 * d.faites) / total) : 100}%` }} />
          </div>
          <p className="c-sous">{phrase(`${S}.ch.r.avance`, { faites: entier(d.faites), total: selon(total, `${S}.ch.chaines`), pieces: selon(d.pieces, `${S}.ch.pieces`) })}</p>
        </>
      ) : <p className="c-sous">{phrase(`${S}.ch.r.attend`)}</p>}
      {d.arretee ? <Alerte ton="attention"><span>{phrase(`${S}.ch.r.arretee`, { quand: quand(d.nouvelleLe ?? d.demandeeLe, aujourdhui) })}</span></Alerte> : null}
    </div>
  );
}

function Chaine({ c, aujourdhui, role, relire }: { c: Chaines | undefined; aujourdhui: string; role: Donnees['role']; relire: (client: Nommee | null) => void }) {
  const etat = c ? ETAT_CHAINES[c.etat] : 'nonmesure';
  const enCours = !!c?.demande && !c.demande.finieLe;
  const contenu = c ? etatContenu(c.contenu) : null;
  return (
    <section className="c-carte c-se-chaine" aria-labelledby="se-chaine">
      <div className="c-se-chaine-tete">
        <h2 id="se-chaine">{titre(`${S}.ch.titre`)}</h2>
        <EtatPuce etat={etat} texte={c ? maj(c.etat === 'casse' ? selon(c.nCassees, `${S}.ch.etat_casse`) : dire(`${S}.ch.etat_${c.etat}`)) : titre(`${S}.ch.etat_jamais`)} />
      </div>
      <p className="c-carte-sous">{phrase(`${S}.ch.sous`)}</p>
      {c && c.nCassees > 0 ? (
        // Une chaîne cassée : l'étape suivante est l'incident, jamais une réparation.
        <Alerte ton="danger">
          <span>{phrase(c.incident ? `${S}.ch.i.suivre_dit` : `${S}.ch.i.ouvrir_dit`, { ref: c.incident?.ref ?? '' })}</span>
          <span>{c.incident
            ? <Lien petit href="#/service/incidents">{titre(`${S}.ch.i.suivre`, { ref: c.incident.ref })}</Lien>
            : <Lien petit ton="principal" href="#/service/incidents?ouvrir=empreinte">{titre(`${S}.ch.i.ouvrir`)}</Lien>}</span>
        </Alerte>
      ) : null}
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
                <thead><tr>
                  <th>{titre(`${S}.ch.c.sorte`)}</th><th>{titre(`${S}.ch.c.entreprise`)}</th><th>{titre(`${S}.ch.c.quoi`)}</th><th>{titre(`${S}.ch.c.rupture`)}</th><th>{titre(`${S}.ch.c.vue`)}</th>
                  {role === 'direction' ? <th><span className="c-cache">{titre(`${S}.ch.c.geste`)}</span></th> : null}
                </tr></thead>
                <tbody>
                  {c.cassees.map((x, i) => (
                    <tr key={`${x.sorte}-${x.quoi}-${x.le ?? ''}-${i}`}>
                      <td>{titre(SORTES_CHAINE.has(x.sorte) ? `${S}.ch.sorte.${x.sorte}` : `${S}.ch.sorte.autre`)}</td>
                      <td>{x.entreprise ? <a href={`#/clients/${x.entreprise.id}`} data-donnee>{nomNumero(x.entreprise)}</a> : <span className="c-attente">{dire(`${S}.ch.c.cachee`)}</span>}</td>
                      <td>{titre(`${S}.ch.c.quoi_${x.quoi}`)}</td>
                      <td>{x.rang !== null ? maj(dire(`${S}.ch.c.au_rang`, { rang: entier(x.rang), motif: motifDe(x) })) : '—'}</td>
                      <td>{x.le ? maj(quand(x.le, aujourdhui)) : '—'}</td>
                      {role === 'direction' ? (
                        <td>{x.entreprise
                          ? <Bouton petit desactive={enCours} onClick={() => relire(x.entreprise)} etiquette={titre(`${S}.ch.c.relire_aria`, { nom: x.entreprise.nom })}>{titre(`${S}.ch.c.relire`)}</Bouton>
                          : null}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {c.demande ? <DemandeEnCours d={c.demande} aujourdhui={aujourdhui} /> : null}
          <div className="c-se-relire">
            <Bouton icone="relire" desactive={enCours} onClick={() => relire(null)}>{titre(`${S}.ch.r.bouton`)}</Bouton>
            <span className="c-sous">{enCours ? phrase(`${S}.ch.r.une_a_la_fois`) : phrase(`${S}.ch.r.bouton_sous`)}</span>
          </div>
        </>
      ) : null}
      <ul className="c-se-chaine-perimetre">
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.liens`)} /> <span className="c-sous">{phrase(`${S}.ch.p.liens_sous`)}</span></li>
        <li>
          <EtatPuce etat={contenu?.etat ?? 'nonmesure'} texte={contenu?.texte ?? titre(`${S}.ch.p.contenu_jamais`)} />{' '}
          <span className="c-sous">
            {c?.contenu.dernier
              ? phrase(`${S}.ch.p.contenu_sous`, {
                quand: quand(c.contenu.dernier.le, aujourdhui), chaines: selon(c.contenu.dernier.chaines, `${S}.ch.chaines`), pieces: selon(c.contenu.dernier.pieces, `${S}.ch.pieces`),
                lot: entier(c.contenusParLot),
              })
              : phrase(`${S}.ch.p.contenu_avant`, { lot: entier(c?.contenusParLot ?? 0) })}
            {c && c.contenu.dernier && c.contenu.jamais ? ` ${maj(selon(c.contenu.jamais, `${S}.ch.p.contenu_jamais_n`))}.` : ''}
            {c && c.contenu.enAttente ? ` ${maj(selon(c.contenu.enAttente, `${S}.ch.p.contenu_attente`))}.` : ''}
            {contenu?.sous ? ` ${contenu.sous}` : ''}
          </span>
        </li>
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.caisse`)} /> <span className="c-sous">{phrase(`${S}.ch.p.caisse_sous`)}</span></li>
        <li><EtatPuce etat="bon" texte={titre(`${S}.ch.p.journal`)} /> <span className="c-sous">{phrase(`${S}.ch.p.journal_sous`)}</span></li>
      </ul>
      <p className="c-sous">{phrase(`${S}.ch.jamais_reparer`)}</p>
    </section>
  );
}

// ── Le geste : relire maintenant ────────────────────────────────────────────────────────────────────────────────────
// Toutes les chaînes (la direction et la technique), ou celles d'une entreprise nommée par son numéro de client (la
// direction seule : la technique ne reçoit aucun identifiant de client).
function FenetreRelire({ role, client, fermer, fait }: { role: Donnees['role']; client: Nommee | null; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [une, setUne] = useState(client !== null);
  const [numero, setNumero] = useState(client?.numero ?? '');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: 'numero' | 'motif'; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const fauter = (champ: 'numero' | 'motif', texte: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    const cible = une ? (client && !client.numero ? client.id : numero.trim()) : null;
    if (une && !cible) { fauter('numero', phrase(`${S}.ch.r.f.numero_vide`)); return; }
    if (motif.trim().length < 3) { fauter('motif', phrase('console.ecran.geste.motif_court')); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', '/console/service/securite/relire', { client: cible, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 201) { toast(phrase(`${S}.ch.r.f.fait`)); fait(); return; }
        setRefus(refusDe(res));
        if (res.corps.champ === 'motif') setFaute((f) => ({ champ: 'motif', n: (f?.n ?? 0) + 1 }));
        else if (une) setFaute((f) => ({ champ: 'numero', n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${S}.ch.r.f.titre`)} sous={client ? nomNumero(client) : undefined} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${S}.ch.r.f.bouton`)}</Bouton>
      </>}>
      {role === 'direction' && !client ? (
        <div className="c-champ">
          <span className="c-champ-libelle" id="se-relire-quoi">{titre(`${S}.ch.r.f.quoi`)}</span>
          <div className="c-pilules c-in-pilules" role="group" aria-labelledby="se-relire-quoi">
            <button type="button" className="c-pilule" aria-pressed={!une} onClick={() => setUne(false)}>{maj(dire(`${S}.ch.r.toutes`))}</button>
            <button type="button" className="c-pilule" aria-pressed={une} onClick={() => setUne(true)}>{maj(dire(`${S}.ch.r.f.une`))}</button>
          </div>
        </div>
      ) : null}
      {/* Le champ se garde en place (caché, jamais retiré) : choisir « une entreprise » ne pousse pas le motif sous le curseur. */}
      {role === 'direction' && !client ? (
        <div className={une ? undefined : 'c-invisible'} aria-hidden={!une || undefined}>
          <Champ libelle={titre(`${S}.ch.r.f.numero`)} aide={phrase(`${S}.ch.r.f.numero_aide`)} valeur={numero} changer={setNumero}
            placeholder="E-0012" autoComplete="off" faute={faute?.champ === 'numero'} n={faute?.n ?? 0} />
        </div>
      ) : null}
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${K}.al.geste.ce_qui_va`)}</span>
        <ul>
          <li>{phrase(`${S}.ch.r.f.p1`)}</li>
          <li>{phrase(`${S}.ch.r.f.p2`)}</li>
          <li>{phrase(`${S}.ch.r.f.p3`)}</li>
        </ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${S}.ch.r.f.motif_aide`)} valeur={motif} changer={setMotif} faute={faute?.champ === 'motif'} n={faute?.n ?? 0} />
      <p className="c-al-qui">{phrase(`${K}.al.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
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
  const d = l.etat === 'lu' ? l.donnees : null;
  // Une relecture en cours se suit de près (toutes les cinq secondes) ; sinon, chaque minute.
  useRelireTantQueRegarde(relire, d?.chaines?.demande && !d.chaines.demande.finieLe ? 5_000 : undefined);
  const [lever, setLever] = useState<ARegarder | null>(null);
  const [relecture, setRelecture] = useState<{ client: Nommee | null } | null>(null);
  const [gesteAdresse, setGesteAdresse] = useState<GesteAdresse | null>(null);
  return (
    <>
      <EnteteService vue="securite" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <Chiffres d={d} />
          <Regards d={d} lever={setLever} />
          <LesAdresses a={d.adresses} aujourdhui={d.aujourdhui} faire={setGesteAdresse} />
          <div className="c-se-duo">
            <Connexions d={d} />
            <Regles d={d} />
          </div>
          <Equipe d={d} />
          <Cles d={d} />
          <Secrets secrets={d.secrets} bientot={d.secretBientot ?? 30} aujourdhui={d.aujourdhui} relire={relire} />
          <Chaine c={d.chaines} aujourdhui={d.aujourdhui} role={d.role} relire={(client) => setRelecture({ client })} />
        </>
      ) : null}
      {lever ? <FenetreLever r={lever} fermer={() => setLever(null)} fait={() => { setLever(null); relire(); }} /> : null}
      {gesteAdresse?.sorte === 'bloquer' && d ? <FenetreBloquer adresse={gesteAdresse.adresse} durees={d.dureesBlocage ?? [1, 24]} fermer={() => setGesteAdresse(null)} fait={() => { setGesteAdresse(null); relire(); }} /> : null}
      {gesteAdresse?.sorte === 'debloquer' && d ? <FenetreDebloquer b={gesteAdresse.b} aujourdhui={d.aujourdhui} fermer={() => setGesteAdresse(null)} fait={() => { setGesteAdresse(null); relire(); }} /> : null}
      {relecture && d ? <FenetreRelire role={d.role} client={relecture.client} fermer={() => setRelecture(null)} fait={() => { setRelecture(null); relire(); }} /> : null}
    </>
  );
}
