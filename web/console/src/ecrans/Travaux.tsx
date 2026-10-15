// Les travaux et les envois du service (10 § 2.8 ; serveur/console/routes.ts, GET /console/service/travaux ;
// serveur/console/travaux.ts ; docs/console.md C25). Ce que le serveur fait seul et ce qu'il envoie aux partenaires :
//   - quatre chiffres : ce qui attend la TTN, ce qui est parti aujourd'hui, ce qui reste à regarder, le dernier tour du
//     facteur ;
//   - une carte par partenaire branché, quatorze jours, et ce qui reste à regarder chez lui ; ceux qui n'ont pas de trace
//     sont nommés, jamais montrés à zéro ;
//   - la liste de ce qui reste à regarder : une clé courte, jamais une pièce ni un montant ; l'entreprise pour la direction
//     seule (la technique n'en reçoit ni le nom ni l'identifiant, 0114) ;
//   - les tâches programmées : les tours du serveur, et la nuit (sauvegarde, copie hors de la machine, copie de base) ;
//   - les gestes (0115 ; l'audit F18) : une panne se reprend tout de suite (« Reprendre maintenant… », avec son motif : le
//     facteur redemande d'abord à la TTN si elle a la pièce) ; un refus ou un compte retenu se corrige chez l'entreprise,
//     que la direction prévient d'ici (« Prévenir l'entreprise… », l'e-mail de la fiche). Jamais « réessayer » un refus.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier, minutes } from '../nombres.ts';
import { jourCourt, quand } from '../temps.ts';
import { Alerte, Bouton, Dialogue, maj, Puce, toast, Vide, Zone, type TonPuce } from '../ui.tsx';
import { EcrireAuContact } from './Echanges.tsx';
import { EnteteService, EtatPuce, Tuile, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type EtatBrique, type Nuit, type Resultat, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const T = `${K}.tr`;

type Partenaire = 'ttn' | 'signature' | 'sms' | 'paiements' | 'relances' | 'courriel';
type Jour = { jour: string; n: number; bons: number; refus: number };
type EtatTour = 'bon' | 'echec' | 'arrete' | 'jamais';
type Tour = { nom: string; pasMs: number; branche: 'ttn' | 'courriel' | null; etat: EtatTour;
  tour: { le: string; dureeMs: number; ok: boolean; compte: Record<string, number>; echecLe: string | null; echec: string | null } | null };
type ARegarder = {
  sorte: 'ttn' | 'signature' | 'paiement'; cle: string; entreprise: { id: string; nom: string } | null; statut: string;
  essais: number | null; prochain: string | null; deposeLe: string | null; depuis: string; pieces: number | null;
  attente: 'seul' | 'entreprise'; motifCle: string | null; motifTexte: string | null;
};
type Donnees = {
  maintenant: string; aujourdhui: string; role: 'direction' | 'technique'; veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[];
  tours: Tour[]; partenaires: { nom: Partenaire; jours: Jour[] }[]; sansTrace: string[]; ttn: { enFile: number; medianeS: number | null };
  aRegarder: ARegarder[]; nuit: Nuit | null; exercice: { jour: string; restauration: Resultat } | null; version: string | null;
  branches: { ttn: boolean; courriel: boolean };
};

// La sorte d'un envoi à regarder, et le partenaire dont il vient.
const DE_LA_SORTE: Record<ARegarder['sorte'], Partenaire> = { ttn: 'ttn', signature: 'signature', paiement: 'paiements' };
const somme = (j: readonly Jour[], k: 'n' | 'bons' | 'refus') => j.reduce((s, x) => s + x[k], 0);
const duJour = (j: readonly Jour[]) => j.at(-1) ?? { jour: '', n: 0, bons: 0, refus: 0 };

// ── Les quatre chiffres ─────────────────────────────────────────────────────────────────────────────────────────────
function Chiffres({ d }: { d: Donnees }) {
  const aujourdhui = d.partenaires.reduce((s, p) => s + duJour(p.jours).n, 0);
  const seuls = d.aRegarder.filter((r) => r.attente === 'seul').length;
  const facteur = d.tours.find((t) => t.nom === 'facteur');
  const etatFacteur: EtatBrique = !d.branches.ttn || !facteur || facteur.etat === 'jamais' ? 'nonmesure' : facteur.etat === 'bon' ? 'bon' : 'grave';
  return (
    <section className="c-sv-claires" aria-label={titre(`${T}.k.titre`)}>
      <div className="c-sv-tuiles c-tr-tuiles">
        <Tuile titre={titre(`${T}.k.file`)} etat={d.ttn.enFile ? 'attention' : 'bon'} valeur={entier(d.ttn.enFile)} unite={dire(`${T}.k.file_unite`)}
          sous={phrase(d.ttn.enFile ? `${T}.k.file_sous` : `${T}.k.file_vide`)} />
        <Tuile titre={titre(`${T}.k.faits`)} valeur={entier(aujourdhui)} unite={selon(aujourdhui, `${T}.k.faits_unite`)} sous={phrase(`${T}.k.faits_sous`)} />
        <Tuile titre={titre(`${T}.k.regarder`)} etat={d.aRegarder.length ? 'attention' : 'bon'} valeur={entier(d.aRegarder.length)}
          unite={selon(d.aRegarder.length, `${T}.k.regarder_unite`)}
          sous={d.aRegarder.length ? dire(`${T}.k.regarder_sous`, { seuls: entier(seuls), entreprise: entier(d.aRegarder.length - seuls) }) : phrase(`${T}.k.regarder_rien`)} />
        <Tuile titre={titre(`${T}.k.facteur`)} etat={etatFacteur} mot
          valeur={!d.branches.ttn ? titre(`${T}.k.pas_branche`) : facteur?.tour ? maj(quand(facteur.tour.le, d.aujourdhui)) : titre(`${T}.k.jamais`)}
          sous={phrase(!d.branches.ttn ? `${T}.k.facteur_sans_ttn` : facteur?.etat === 'arrete' ? `${T}.k.facteur_arrete` : `${T}.k.facteur_sous`)} />
      </div>
    </section>
  );
}

// ── Les partenaires ─────────────────────────────────────────────────────────────────────────────────────────────────
function Barres({ jours, nom }: { jours: readonly Jour[]; nom: string }) {
  const haut = Math.max(1, ...jours.map((j) => j.n));
  return (
    <div className="c-tr-barres" role="img" aria-label={dire(`${T}.p.barres`, { nom, n: entier(somme(jours, 'n')) })}>
      {jours.map((j) => (
        <span key={j.jour} className="c-tr-barre" title={`${jourCourt(j.jour)} : ${j.n}`}>
          <span className="c-tr-barre-bon" style={{ height: `${j.n ? Math.max(4, Math.round(((j.n - j.refus) / haut) * 100)) : 2}%` }} />
          {j.refus ? <span className="c-tr-barre-refus" style={{ height: `${Math.max(4, Math.round((j.refus / haut) * 100))}%` }} /> : null}
        </span>
      ))}
    </div>
  );
}

function Partenaires({ d, filtrer }: { d: Donnees; filtrer: (p: Partenaire) => void }) {
  // Un partenaire qui ne part que par un relais absent (les relances sans e-mail) se dit débranché, pas « 0 ».
  const branche = (p: Partenaire) => (p === 'relances' ? d.branches.courriel : p === 'ttn' ? d.branches.ttn : true);
  return (
    <section className="c-tr-partenaires" aria-labelledby="tr-partenaires">
      <div className="c-al-section-tete"><div>
        <h2 id="tr-partenaires">{titre(`${T}.p.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${T}.p.sous`)}</p>
      </div></div>
      <div className="c-tr-grille">
        {d.partenaires.map((p) => {
          const j = duJour(p.jours), quatorze = somme(p.jours, 'n');
          const aRegarder = d.aRegarder.filter((r) => DE_LA_SORTE[r.sorte] === p.nom).length;
          const etat: EtatBrique = !branche(p.nom) ? 'nonmesure' : aRegarder ? 'attention' : 'bon';
          return (
            <article key={p.nom} className="c-carte c-tr-partenaire">
              <header className="c-tr-partenaire-tete">
                <div><h3>{titre(`${T}.p.${p.nom}.nom`)}</h3><span className="c-sous">{phrase(`${T}.p.${p.nom}.quoi`)}</span></div>
              </header>
              <p className="c-tr-compte"><b>{entier(j.n)}</b> <span>{selon(j.n, `${T}.p.${p.nom}.unite`)}</span>
                <EtatPuce etat={etat} {...(!branche(p.nom) ? { texte: titre(`${T}.p.debranche`) } : {})} /></p>
              <Barres jours={p.jours} nom={titre(`${T}.p.${p.nom}.nom`)} />
              <dl className="c-tr-stats">
                <div><dt>{titre(`${T}.p.quatorze`)}</dt><dd>{entier(quatorze)}</dd></div>
                {p.nom === 'ttn' ? <div><dt>{titre(`${T}.p.mediane`)}</dt><dd>{d.ttn.medianeS === null ? '—' : d.ttn.medianeS < 120 ? `${entier(d.ttn.medianeS)}\u00a0s` : minutes(Math.round(d.ttn.medianeS / 60))}</dd></div>
                  : p.nom === 'sms' || p.nom === 'relances' || (p.nom === 'courriel' && !somme(p.jours, 'refus')) ? null
                    : <div><dt>{titre(`${T}.p.${p.nom}.refus`)}</dt><dd>{entier(somme(p.jours, 'refus'))}</dd></div>}
              </dl>
              {aRegarder ? <Bouton petit onClick={() => filtrer(p.nom)}>{selon(aRegarder, `${T}.p.voir`)}</Bouton> : null}
            </article>
          );
        })}
      </div>
      {d.sansTrace.length ? <p className="c-sous c-tr-sans-trace">{phrase(`${T}.p.sans_trace`, { liste: d.sansTrace.map((x) => dire(`${T}.p.st.${x}`)).join(', ') })}</p> : null}
    </section>
  );
}

// ── Ce qui reste à regarder ─────────────────────────────────────────────────────────────────────────────────────────
type Filtre = 'tous' | 'seul' | 'entreprise';
// Une facture pas encore déposée qui attend l'entreprise (son compte refusé, absent) est « retenue », pas « en attente ».
const statutVu = (r: ARegarder) => (r.sorte === 'ttn' && r.statut === 'a_envoyer' && r.attente === 'entreprise' ? 'retenue' : r.statut);
const PUCE_STATUT: Record<string, TonPuce> = { a_envoyer: 'a_regarder', deposee: 'a_regarder', refusee: 'urgent', echouee: 'urgent', echoue: 'urgent' };
// Le geste d'une ligne : reprendre une panne de la TTN (la direction et la technique), prévenir l'entreprise d'un refus ou
// d'un compte retenu (la direction, qui seule sait de qui il s'agit).
const reprenable = (r: ARegarder, maintenant: string) => r.sorte === 'ttn' && r.attente === 'seul' && !!r.prochain && Date.parse(r.prochain) > Date.parse(maintenant);
function FenetreReprendre({ r, aujourdhui, fermer, fait }: { r: ARegarder; aujourdhui: string; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', `/console/service/travaux/envois/${r.cle}/reprendre`, { motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200) { toast(phrase(`${T}.g.fait`)); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${T}.g.titre`)} sous={`${titre(`${T}.l.sorte.${r.sorte}`)} · ${r.cle}`} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${T}.g.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${T}.g.${x}`, { quand: r.prochain ? quand(r.prochain, aujourdhui) : '' })}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${T}.g.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}
function Liste({ d, partenaire, retirer, relire }: { d: Donnees; partenaire: Partenaire | null; retirer: () => void; relire: () => void }) {
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [reprendre, setReprendre] = useState<ARegarder | null>(null);
  const [prevenir, setPrevenir] = useState<ARegarder | null>(null);
  const duPartenaire = d.aRegarder.filter((r) => !partenaire || DE_LA_SORTE[r.sorte] === partenaire);
  const vus = duPartenaire.filter((r) => filtre === 'tous' || r.attente === filtre);
  const n = (f: Filtre) => duPartenaire.filter((r) => f === 'tous' || r.attente === f).length;
  return (
    <section className="c-carte c-tr-liste" aria-labelledby="tr-liste" id="tr-liste-section">
      <div className="c-al-section-tete"><div>
        <h2 id="tr-liste">{titre(`${T}.l.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${T}.l.sous`)}</p>
      </div></div>
      {d.aRegarder.length ? (
        <>
          <div className="c-pilules c-tr-pilules" role="group" aria-label={titre(`${T}.l.filtres`)}>
            {(['tous', 'seul', 'entreprise'] as const).map((f) => (
              <button key={f} type="button" className="c-pilule" aria-pressed={filtre === f} onClick={() => setFiltre(f)}>
                {titre(`${T}.l.f.${f}`)} <span className="c-pilule-n">{entier(n(f))}</span>
              </button>
            ))}
            {partenaire ? <Bouton petit ton="discret" onClick={retirer}>{titre(`${T}.l.retirer`, { nom: dire(`${T}.p.${partenaire}.nom`) })}</Bouton> : null}
          </div>
          {vus.length ? (
            <div className="c-defile">
              <table className="c-table c-tr-table">
                <thead><tr>
                  <th scope="col">{titre(`${T}.l.col.envoi`)}</th><th scope="col">{titre(`${T}.l.col.entreprise`)}</th>
                  <th scope="col">{titre(`${T}.l.col.ou`)}</th><th scope="col" className="c-droite">{titre(`${T}.l.col.essais`)}</th>
                  <th scope="col">{titre(`${T}.l.col.suite`)}</th>
                  <th scope="col"><span className="c-cache">{titre(`${T}.l.col.gestes`)}</span></th>
                </tr></thead>
                <tbody>
                  {vus.map((r, i) => (
                    <tr key={`${r.sorte}${r.cle}${i}`}>
                      <td><b>{titre(`${T}.l.sorte.${r.sorte}`)}</b><span className="c-sous c-mono" data-donnee>{r.cle}</span></td>
                      <td>{r.entreprise ? <a href={`#/clients/${r.entreprise.id}`} data-donnee>{r.entreprise.nom}</a>
                        : <span className="c-attente">{titre(`${T}.l.un_client`)}</span>}</td>
                      <td>
                        <Puce ton={PUCE_STATUT[r.statut] ?? 'a_regarder'}>{titre(`${T}.l.statut.${statutVu(r)}`)}</Puce>
                        <span className="c-sous c-tr-ou">{r.motifCle && MOTIFS.includes(r.motifCle) ? phrase(`${T}.l.m.${r.motifCle.replace('.', '_')}`)
                          : r.motifTexte ?? phrase(`${T}.l.m.${r.sorte}_${r.statut}`)}</span>
                      </td>
                      <td className="c-droite c-mono" data-libelle={titre(`${T}.l.col.essais`)}>{r.essais === null ? '—' : entier(r.essais)}</td>
                      <td>{r.attente === 'seul' && r.prochain ? phrase(`${T}.l.prochain`, { quand: quand(r.prochain, d.aujourdhui) })
                        : phrase(`${T}.l.suite.${r.sorte === 'ttn' && r.statut !== 'refusee' ? 'ttn_retenue' : r.sorte}`)}</td>
                      <td className="c-tr-geste">
                        {reprenable(r, d.maintenant) ? <Bouton petit onClick={() => setReprendre(r)}>{titre(`${T}.g.reprendre`)}</Bouton>
                          : r.attente === 'entreprise' && r.entreprise ? <Bouton petit onClick={() => setPrevenir(r)}>{titre(`${T}.g.prevenir`)}</Bouton> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="c-sous">{phrase(`${T}.l.rien_filtre`)}</p>}
        </>
      ) : <Vide>{phrase(`${T}.l.vide`)}</Vide>}
      <p className="c-liste-pied">{phrase(`${T}.l.pied`)}</p>
      {reprendre ? <FenetreReprendre r={reprendre} aujourdhui={d.aujourdhui} fermer={() => setReprendre(null)} fait={() => { setReprendre(null); relire(); }} /> : null}
      {prevenir?.entreprise ? <EcrireAuContact client={prevenir.entreprise} contexte="envoi" valeurs={{ quoi: dire(`${T}.g.quoi.${prevenir.sorte}`), cle: prevenir.cle }}
        fermer={() => setPrevenir(null)} fait={() => setPrevenir(null)} /> : null}
    </section>
  );
}
// Les motifs que la console dit avec ses mots (le motif de l'application parle à l'entreprise : « branche-le ») ; un
// motif qu'elle ne connaît pas se lit tel quel, par la direction seule.
const MOTIFS = ['ttn.sans_compte', 'ttn.compte_refuse', 'ttn.compte_illisible', 'ttn.depot_refuse', 'ttn.refusee', 'ttn.injoignable', 'ttn.panne'];

// ── Les tâches programmées ──────────────────────────────────────────────────────────────────────────────────────────
const ETAT_DU_TOUR: Record<EtatTour, EtatBrique> = { bon: 'bon', echec: 'grave', arrete: 'grave', jamais: 'nonmesure' };
function Taches({ d }: { d: Donnees }) {
  const nuit = d.nuit;
  // Une tâche de la nuit réussie il y a un mois n'est pas « bonne » : passé son rythme et sa marge (26 heures pour la
  // nuit, comme la veille ; 40 jours pour l'exercice du mois), elle s'est arrêtée.
  const resultat = (nom: string, r: Resultat | null, heure: string, margeH: number) => {
    const vieille = r !== null && Date.parse(d.maintenant) - Date.parse(r.le) > margeH * 3_600_000;
    return (
      <li key={nom} className="c-tr-tache">
        <EtatPuce etat={!r ? 'nonmesure' : r.ok && !vieille ? 'bon' : 'grave'} />
        <div><b>{titre(`${T}.t.${nom}`)}</b>
          <span className={`c-sous${r && (vieille || !r.ok) ? ' c-tr-mal' : ''}`}>
            {!r ? phrase(`${T}.t.pas_vue`) : phrase(vieille ? `${T}.t.vieille` : r.ok ? `${T}.t.reussie` : `${T}.t.ratee`, { quand: quand(r.le, d.aujourdhui) })}
          </span></div>
        <span className="c-sous c-tr-rythme">{heure}</span>
      </li>
    );
  };
  return (
    <section className="c-carte c-tr-taches" aria-labelledby="tr-taches">
      <div className="c-al-section-tete"><div>
        <h2 id="tr-taches">{titre(`${T}.t.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${T}.t.sous`)}</p>
      </div></div>
      <ul className="c-tr-taches-liste">
        {d.tours.map((t) => {
          const debranche = t.branche === 'ttn' ? !d.branches.ttn : t.branche === 'courriel' ? !d.branches.courriel : false;
          const compte = t.tour ? Object.entries(t.tour.compte).filter(([, v]) => v > 0) : [];
          return (
            <li key={t.nom} className="c-tr-tache">
              <EtatPuce etat={debranche ? 'nonmesure' : ETAT_DU_TOUR[t.etat]} />
              <div>
                <b>{titre(`${T}.t.tour.${t.nom}`)}</b>
                <span className={`c-sous${!debranche && (t.etat === 'echec' || t.etat === 'arrete') ? ' c-tr-mal' : ''}`}>
                  {debranche ? phrase(`${T}.t.debranche_${t.branche ?? 'x'}`)
                    : !t.tour ? phrase(`${T}.t.jamais`)
                      : t.etat === 'arrete' ? phrase(`${T}.t.arrete`, { quand: quand(t.tour.le, d.aujourdhui) })
                        : t.etat === 'echec' ? phrase(`${T}.t.echec`, { quand: quand(t.tour.le, d.aujourdhui), nature: t.tour.echec ?? '—' })
                          : `${maj(quand(t.tour.le, d.aujourdhui))}${compte.length ? ` · ${compte.map(([k, v]) => `${entier(v)} ${k}`).join(', ')}` : ''}`}
                </span>
              </div>
              <span className="c-sous c-tr-rythme">{titre(t.pasMs >= 3_600_000 ? `${T}.t.chaque_heure` : `${T}.t.chaque_minute`)}</span>
            </li>
          );
        })}
        {resultat('sauvegarde', nuit?.sauvegarde ?? null, titre(`${T}.t.la_nuit`), 26)}
        {resultat('hors_machine', nuit?.horsMachine ?? null, titre(`${T}.t.la_nuit`), 26)}
        {resultat('copie_de_base', nuit?.copieDeBase ?? null, titre(`${T}.t.la_nuit`), 26)}
        {resultat('exercice', d.exercice?.restauration ?? null, titre(`${T}.t.chaque_mois`), 40 * 24)}
      </ul>
    </section>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Travaux() {
  const [l, relire] = useLecture<Donnees>('/console/service/travaux', 'service-travaux');
  useRelireTantQueRegarde(relire);
  const [partenaire, setPartenaire] = useState<Partenaire | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  const filtrer = (p: Partenaire) => {
    setPartenaire(p);
    requestAnimationFrame(() => document.getElementById('tr-liste-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <>
      <EnteteService vue="travaux" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          <Chiffres d={d} />
          <Partenaires d={d} filtrer={filtrer} />
          <Liste d={d} partenaire={partenaire} retirer={() => setPartenaire(null)} relire={relire} />
          <Taches d={d} />
        </>
      ) : null}
    </>
  );
}
