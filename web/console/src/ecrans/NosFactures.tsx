// Nos factures (serveur/console/routes.ts, GET /console/nos-factures ; serveur/console/nosfactures.ts ; 0109 ; la maquette
// « Nos factures » ; docs/console.md C31). Celles que l'entreprise SkanFact a émises dans un mois, et les avoirs qui les
// corrigent : combien, pour quel montant, où chacune en est à la TTN (le fichier, la signature, le dépôt, acceptée ou
// refusée et pourquoi) et son paiement. Une facture refusée vient en tête : elle attend un geste dans SkanFact. La
// console ne refait rien : chaque pièce s'ouvre dans l'application de SkanFact. L'écran ne recalcule rien.
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { montant } from '../argent.ts';
import { useConsole, useLecture } from '../contexte.ts';
import { MoisNav, moisLu } from '../mois.tsx';
import { jourCourt, jourDe, moisEnMots } from '../temps.ts';
import { Alerte, Bouton, Icone, Lien, maj, Vide, type NomIcone } from '../ui.tsx';

type EtatTtn = 'sans_fichier' | 'a_signer' | 'a_envoyer' | 'deposee' | 'acceptee' | 'refusee';
type Paiement = 'payee' | 'annulee' | 'partielle' | 'en_retard' | 'a_payer' | 'avoir';
type Filtre = 'toutes' | 'refusees' | 'en_chemin' | 'non_payees';
const FILTRES: readonly Filtre[] = ['toutes', 'refusees', 'en_chemin', 'non_payees'];
const ETATS: readonly EtatTtn[] = ['acceptee', 'deposee', 'a_envoyer', 'a_signer', 'sans_fichier', 'refusee'];
type Ligne = {
  type: 'facture' | 'avoir'; numero: string; date: string; echeance: string | null; ecran: string; entreprise: { id: string; nom: string };
  offre: 'essentiel' | 'complet' | null; periodicite: 'annuel' | 'mensuel' | null; debut: string | null; fin: string | null;
  corrige: { numero: string | null; ecran: string } | null; devise: string; net: string; ttn: EtatTtn; motif: string | null;
  deposeLe: string | null; accepteLe: string | null; reference: string | null; paiement: Paiement; reste: string; avoirDeduit: boolean;
};
type Donnees = {
  aujourdhui: string; mois: string; courant: boolean; editeur: { entreprise: string; raisonSociale: string; devise: string; soumise: boolean } | null;
  resume: { factures: number; montant: string | null; avoirs: number; montantAvoirs: string | null; autresDevises: number; reste: string | null; ttn: Record<EtatTtn, number> };
  filtre: Filtre; comptes: Record<Filtre, number>; refusees: Ligne[]; total: number; lignes: Ligne[]; suite: number | null;
};
const K = 'console.ecran.nosfactures';
const PAGE = 50;
// Un montant d'une autre devise que le dinar : son code, jamais « DT ».
const enDevise = (t: string, devise: string) => (devise === 'TND' ? montant(t) : `${montant(t).replace(/\u00a0DT$/, '')}\u00a0${devise}`);
const ICONE_TTN: Record<EtatTtn, NomIcone> = { acceptee: 'ok', refusee: 'alerte', deposee: 'sablier', a_envoyer: 'sablier', a_signer: 'sablier', sans_fichier: 'info' };

// Ce que la pièce paie : l'offre, la périodicité, la période ; un avoir dit la facture qu'il corrige.
function pour(l: Ligne): string {
  if (l.type === 'avoir') return dire(`${K}.l.avoir_de`, { numero: l.corrige?.numero ?? '—' });
  const offre = l.offre && l.periodicite ? dire(`${K}.l.offre.${l.offre}_${l.periodicite}`) : '';
  return [offre, l.debut && l.fin ? dire(`${K}.l.periode`, { du: jourCourt(l.debut), au: jourCourt(l.fin) }) : ''].filter(Boolean).join(' · ');
}
function ttnEnMots(l: Ligne): string {
  if (l.ttn === 'acceptee') return l.accepteLe ? dire(`${K}.ttn.acceptee_le`, { le: jourCourt(jourDe(l.accepteLe)) }) : dire(`${K}.ttn.acceptee`);
  if (l.ttn === 'deposee' && l.deposeLe) return dire(`${K}.ttn.deposee_le`, { le: jourCourt(jourDe(l.deposeLe)) });
  return dire(`${K}.ttn.${l.ttn}`);
}
function paiementEnMots(l: Ligne, aujourdhui: string): string {
  const etat = etatEnMots(l, aujourdhui);
  // Un avoir venu en déduction, sans règlement : ce qui reste, à côté de l'état.
  return l.avoirDeduit && (l.paiement === 'a_payer' || l.paiement === 'en_retard') ? `${etat} · ${dire(`${K}.p.avoir_deduit`, { reste: enDevise(l.reste, l.devise) })}` : etat;
}
function etatEnMots(l: Ligne, aujourdhui: string): string {
  switch (l.paiement) {
    case 'avoir': return dire(`${K}.p.avoir`, { numero: l.corrige?.numero ?? '—' });
    case 'a_payer': return l.echeance ? dire(`${K}.p.a_payer_le`, { le: jourCourt(l.echeance) }) : dire(`${K}.p.a_payer`);
    case 'partielle': return dire(`${K}.p.partielle`, { reste: enDevise(l.reste, l.devise) });
    case 'en_retard': return l.echeance && l.echeance < aujourdhui ? dire(`${K}.p.en_retard_depuis`, { le: jourCourt(l.echeance) }) : dire(`${K}.p.en_retard`);
    default: return dire(`${K}.p.${l.paiement}`);
  }
}

// Ce qui attend un geste, dans l'ordre où il se fait : une refusée (sa carte), des pièces sans fichier quand la fiche de
// l'entreprise SkanFact ne la dit pas soumise (la fiche), des pièces à signer (la signature). La première porte le seul
// bouton principal de l'écran.
type Etape = 'refusee' | 'fiche' | 'signer' | null;
function etapeDe(d: Donnees): Etape {
  if (d.refusees.length) return 'refusee';
  if (d.resume.ttn.sans_fichier && d.editeur && !d.editeur.soumise) return 'fiche';
  return d.resume.ttn.a_signer ? 'signer' : null;
}

// Une facture refusée par la TTN : ce qu'elle était, ce que la TTN répond, et le geste, dans SkanFact.
function Refusee({ l, principal }: { l: Ligne; principal: boolean }) {
  return (
    <article className="c-nf-refus" aria-labelledby={`nf-refus-${l.numero}`}>
      <span className="c-nf-refus-icone" aria-hidden="true"><Icone nom="alerte" /></span>
      <div className="c-nf-refus-texte">
        <h2 id={`nf-refus-${l.numero}`}><span data-donnee>{l.numero}</span> {dire(`${K}.r.refusee`)}{l.deposeLe ? <span className="c-nf-quand">{dire(`${K}.r.deposee_le`, { le: jourCourt(jourDe(l.deposeLe)) })}</span> : null}</h2>
        <p>
          <a href={`#/clients/${l.entreprise.id}`} data-donnee>{l.entreprise.nom}</a>{' · '}{pour(l)}{' · '}<span data-donnee>{enDevise(l.net, l.devise)}</span>
          {' · '}{dire(l.paiement === 'payee' ? `${K}.r.deja_payee` : `${K}.r.pas_payee`)}
        </p>
        <p className="c-nf-refus-motif">{l.motif ? <>{dire(`${K}.r.la_ttn_repond`)} <b data-donnee>{l.motif}</b></> : dire(`${K}.r.sans_motif`)}</p>
        <p className="c-nf-verifier">{dire(`${K}.r.a_verifier`)}</p>
      </div>
      <div className="c-nf-refus-action">
        <Lien href={l.ecran} ailleurs {...(principal ? { ton: 'principal' as const } : {})} etiquette={titre(`${K}.r.ouvrir_de`, { numero: l.numero })}>{titre(`${K}.r.ouvrir`)}</Lien>
      </div>
    </article>
  );
}

export function NosFactures({ mois: moisDemande, filtre: filtreDemande }: { mois: string | null; filtre: string | null }) {
  const { moi } = useConsole();
  const courant = moi.aujourdhui.slice(0, 7);
  const lu = (f: string | null): Filtre => (FILTRES.includes(f as Filtre) ? f as Filtre : 'toutes');
  const [mois, setMois] = useState(moisLu(moisDemande, courant));
  const [filtre, setFiltre] = useState<Filtre>(lu(filtreDemande));
  const [debut, setDebut] = useState(0);
  useEffect(() => { setMois(moisLu(moisDemande, courant)); setFiltre(lu(filtreDemande)); setDebut(0); }, [moisDemande, filtreDemande]);
  useEffect(() => {
    const q = [mois === courant ? '' : `mois=${mois}`, filtre === 'toutes' ? '' : `filtre=${filtre}`].filter(Boolean).join('&');
    history.replaceState(null, '', `#/nos-factures${q ? `?${q}` : ''}`);
  }, [mois, filtre]);
  const [l, relire] = useLecture<Donnees>(`/console/nos-factures?mois=${mois}&filtre=${filtre}&limite=${PAGE}&debut=${debut}`, 'nos-factures');
  const d = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = d?.aujourdhui ?? moi.aujourdhui;
  const aller = (m: string) => { setMois(m); setDebut(0); };
  const r = d?.resume;
  const pieces = r ? r.factures + r.avoirs : 0;
  const ttnPhrase = r ? ETATS.filter((e) => r.ttn[e] > 0).map((e) => selon(r.ttn[e], `${K}.s.ttn.${e}`)).join(' · ') : '';
  const etape = d ? etapeDe(d) : null;
  const dansSkanFact = (ecran: string) => (d?.editeur ? `/v10/?e=${d.editeur.entreprise}#/${ecran}` : '#');

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
        <MoisNav mois={mois} courant={courant} aller={aller} />
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d ? (
        <>
          {d.editeur ? (
            <p className="c-nf-ouvrir"><Lien href={`/v10/?e=${d.editeur.entreprise}#/dashboard`} ailleurs icone="facture">{titre(`${K}.ouvrir_editeur`)}</Lien></p>
          ) : <Alerte ton="info"><span>{phrase(`${K}.sans_editeur`)}</span><span><Lien petit href="#/reglages?onglet=factures">{titre(`${K}.sans_editeur_lien`)}</Lien></span></Alerte>}
          {r && d.editeur && pieces ? (
            <section className="c-carte c-nf-resume" aria-label={titre(`${K}.s.titre`)}>
              <div>
                <span className="c-nf-etiquette">{titre(d.courant ? `${K}.s.mois_courant` : `${K}.s.mois`, { mois: moisEnMots(d.mois, false), jour: Number(aujourdhui.slice(8, 10)) })}</span>
                <b className="c-nf-grand">{selon(r.factures, `${K}.s.factures`)}</b>
                {r.avoirs ? <span className="c-sous">{selon(r.avoirs, `${K}.s.avoirs`)}</span> : null}
              </div>
              <div>
                <span className="c-nf-etiquette">{titre(`${K}.s.montant`)}</span>
                <b className="c-nf-grand c-mono" data-donnee>{montant(r.montant ?? '0')}</b>
                {r.avoirs && r.montantAvoirs ? <span className="c-sous">{dire(`${K}.s.montant_avoirs`, { montant: montant(r.montantAvoirs) })}</span> : null}
                {r.reste ? <span className="c-sous">{dire(`${K}.s.reste`, { montant: montant(r.reste) })}</span>
                  : r.factures && !r.autresDevises ? <span className="c-sous c-nf-encaisse"><Icone nom="ok" taille={14} />{dire(`${K}.s.tout_encaisse`)}</span> : null}
                {r.autresDevises ? <span className="c-sous">{selon(r.autresDevises, `${K}.s.autres_devises`)}</span> : null}
              </div>
              <div className="c-nf-ttn">
                <span className="c-nf-etiquette">{titre(`${K}.s.ttn_titre`)}</span>
                <div className="c-nf-barre" aria-hidden="true">
                  {ETATS.filter((e) => r.ttn[e] > 0).map((e) => <span key={e} className={`c-nf-barre-${e}`} style={{ flexGrow: r.ttn[e] }} />)}
                </div>
                <span className="c-sous">{maj(ttnPhrase)}</span>
              </div>
            </section>
          ) : null}
          {d.refusees.map((x, i) => <Refusee key={x.numero} l={x} principal={i === 0} />)}
          {r && d.editeur && r.ttn.sans_fichier ? (
            <Alerte ton="attention">
              <span>
                <b className="c-nf-alerte-titre">{maj(selon(r.ttn.sans_fichier, `${K}.a.sans_fichier`))}.</b>
                {' '}{phrase(d.editeur.soumise ? `${K}.a.soumise` : `${K}.a.non_soumise`)}
                {d.editeur.soumise ? null : <span className="c-nf-verifier">{dire(`${K}.a.qui_est_soumis`)}</span>}
              </span>
              {d.editeur.soumise ? null : (
                <span><Lien petit ailleurs href={dansSkanFact('parametres')} {...(etape === 'fiche' ? { ton: 'principal' as const } : {})}>{titre(`${K}.a.ouvrir_fiche`)}</Lien></span>
              )}
            </Alerte>
          ) : null}
          {r && d.editeur && r.ttn.a_signer ? (
            <Alerte ton="info">
              <span>{maj(selon(r.ttn.a_signer, `${K}.a.a_signer`))}</span>
              <span><Lien petit ailleurs href={dansSkanFact('factures')} {...(etape === 'signer' ? { ton: 'principal' as const } : {})}>{titre(`${K}.a.signer`)}</Lien></span>
            </Alerte>
          ) : null}
          <section className="c-carte c-liste-carte" aria-labelledby="nf-liste">
            <div className="c-carte-tete c-liste-tete c-nf-liste-tete">
              <h2 id="nf-liste">{titre(`${K}.liste`, { mois: moisEnMots(d.mois, false) })} <span className="c-compte-titre">{d.total}</span></h2>
              {d.comptes.toutes ? <p className="c-carte-sous">{titre(`${K}.liste_sous`)}</p> : null}
            </div>
            {d.comptes.toutes ? <div className="c-pilules" role="group" aria-label={titre(`${K}.filtres`)}>
              {FILTRES.map((f) => (
                <button key={f} type="button" className="c-pilule" aria-pressed={filtre === f} onClick={() => { setFiltre(f); setDebut(0); }}>
                  {titre(`${K}.f.${f}`)} <span className="c-pilule-n">{d.comptes[f]}</span>
                </button>
              ))}
            </div> : null}
            {d.total === 0 ? <Vide icone="facture">{phrase(d.comptes.toutes === 0 ? `${K}.vide_mois` : `${K}.vide_filtre`, { mois: moisEnMots(d.mois) })}</Vide> : (
              <>
              <div className="c-nf-ligne c-nf-entete" aria-hidden="true">
                <span>{dire(`${K}.col.piece`)}</span><span>{dire(`${K}.col.client`)}</span><span className="c-nf-montant">{dire(`${K}.col.montant`)}</span>
                <span>{dire(`${K}.col.ttn`)}</span><span>{dire(`${K}.col.paiement`)}</span>
              </div>
              <ol className="c-nf-lignes">
                {d.lignes.map((x) => (
                  <li key={`${x.type}-${x.numero}`} className={`c-nf-ligne${x.ttn === 'refusee' ? ' c-nf-ligne-refusee' : ''}`}>
                    <div className="c-nf-piece">
                      <a href={x.ecran} target="_blank" rel="noopener" className="c-mono" data-donnee
                        aria-label={titre(`${K}.l.ouvrir_de`, { numero: x.numero })}>{x.numero}</a>
                      <span className="c-sous">{jourCourt(x.date)}</span>
                    </div>
                    <div className="c-nf-qui">
                      <a href={`#/clients/${x.entreprise.id}`}><b data-donnee>{x.entreprise.nom}</b></a>
                      <span className="c-sous">{pour(x)}</span>
                    </div>
                    <b className="c-mono c-nf-montant" data-donnee>{x.type === 'avoir' ? `\u2212${enDevise(x.net, x.devise)}` : enDevise(x.net, x.devise)}</b>
                    <span className={`c-nf-etat c-nf-etat-ttn c-nf-ttn-${x.ttn}`}><Icone nom={ICONE_TTN[x.ttn]} taille={15} />{maj(ttnEnMots(x))}</span>
                    <span className={`c-nf-etat c-nf-etat-paie c-nf-p-${x.paiement}`}>{x.paiement === 'payee' ? <Icone nom="ok" taille={15} /> : null}{maj(paiementEnMots(x, aujourdhui))}</span>
                  </li>
                ))}
              </ol>
              </>
            )}
            {d.total > PAGE ? (
              <div className="c-liste-pied">
                <span>{phrase('console.ecran.clients.page', { debut: debut + 1, fin: debut + d.lignes.length, total: d.total })}</span>
                <span className="c-liste-pied-boutons">
                  <Bouton petit desactive={debut === 0} onClick={() => setDebut(Math.max(0, debut - PAGE))}>{titre('console.ecran.clients.precedentes')}</Bouton>
                  <Bouton petit desactive={d.suite === null} onClick={() => { if (d.suite !== null) setDebut(d.suite); }}>{titre('console.ecran.clients.suivantes')}</Bouton>
                </span>
              </div>
            ) : null}
            {d.comptes.toutes ? <p className="c-liste-pied c-nf-pied">{phrase(`${K}.pied`)}</p> : null}
          </section>
        </>
      ) : null}
    </>
  );
}
