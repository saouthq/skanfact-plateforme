// Les réglages de la plateforme (docs/console.md C28 ; skanfact docs/cadrage/10-console.md § 2.9 ; maquette
// Reglages.dc.html) : ce qui vaut pour tous les clients, au même endroit, en trois onglets — les offres et leurs prix
// (la grille datée, les abonnés de chaque offre, ce qui se passe autour d'une échéance, tiré du code du serveur), les
// règles fiscales communes (le registre, chaque règle avec sa source et qui l'a relue) et le message affiché en haut de
// l'application des clients. La direction change ; le support lit, pour répondre à un client. Rien n'est inventé : ce que
// la console ne sait pas encore faire (préparer un prix, allumer une nouveauté) se dit avec la façon dont il se fait.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { montant } from '../argent.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier } from '../nombres.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Choix, Dialogue, maj, Puce, toast, Vide, Zone } from '../ui.tsx';

const K = 'console.ecran.reglages';

export type OngletReglages = 'prix' | 'regles' | 'formats' | 'messages';
export const ONGLETS_REGLAGES: readonly OngletReglages[] = ['prix', 'regles', 'formats', 'messages'];

type Offre = 'essentiel' | 'complet';
type Periodicite = 'annuel' | 'mensuel';
type Case = { ht: string; depuis: string } | null;
type LigneGrille = { offre: Offre; annuel: Case; mensuel: Case; aVenir: { periodicite: Periodicite; ht: string; aPartirDu: string }[]; abonnes: { annuel: number; mensuel: number } };
// Ce qui s'ajoute à l'offre (14c) : ses prix datés, et pour un module, les abonnés d'aujourd'hui qui l'ont acheté.
type Ajout = 'utilisateur' | 'caisse' | 'etablissement' | 'salarie' | 'module_paie' | 'module_compta';
type LigneAjout = { option: Ajout; annuel: Case; mensuel: Case; aVenir: { periodicite: Periodicite; ht: string; aPartirDu: string }[]; achetes: number | null };
type Relecture = { reluePar: string; avis: 'juste' | 'a_corriger'; dit: string | null; motif: string; par: string; le: string };
type Regle = {
  id: string; code: string; debut: string; fin: string | null; source: string; poseeLe: string; relectures: Relecture[];
  enVigueur: boolean; valeurLue: { connue: boolean; texte: string }; aRelire: boolean;
};
type Message = {
  id: string; sorte: 'nouveaute' | 'maintenance'; texte: string; du: string; au: string; motif: string; par: string; le: string;
  enCours: boolean; retireLe: string | null; retirePar: string | null; retireMotif: string | null; remplace: boolean;
};
type Donnees = {
  aujourdhui: string; role: 'direction' | 'support' | 'technique';
  grille: LigneGrille[]; ajouts: LigneAjout[]; essai: { jours: number; enCours: number }; echeance: { relances: number[]; grace: number };
  registre: Regle[]; message: Message | null; passes: Message[]; formats: Format[];
  factures: NosFactures;
};
// Nos factures (docs/abonnement.md B1) : l'entreprise de la plateforme où elles naissent, et celles que je pourrais désigner.
type Possible = { entreprise: string; raisonSociale: string; matricule: string | null };
type NosFactures = {
  editeur: (Possible & { poseLe: string; posePar: string | null; proprietaire: boolean; factures: number }) | null;
  possibles: Possible[];
};
type EtatFormat = 'en_place' | 'simule' | 'calcule' | 'pas_encore' | 'non_homologue';
type Format = {
  code: 'teif' | 'signature' | 'ttn' | 'tej' | 'cnss' | 'liasse' | 'ecritures' | 'caisse'; etat: EtatFormat; aVerifier: boolean; version: string | null;
  chiffres: Record<string, number | string | null> | null; branche: boolean | null; alerte: boolean;
};
type Geste = { sorte: 'relire'; regle: Regle } | { sorte: 'ecrire' } | { sorte: 'retirer'; message: Message } | { sorte: 'editeur' };

// Un jour de calendrier lu par une personne : 19/11/2026 (le serveur rend « 2026-11-19 »).
const jour = (j: string) => jourCourt(j);
const plusJours = (j: string, n: number) => {
  const d = new Date(Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
};
// Le nom d'une règle, quand la console la connaît ; sinon son code, tel quel (jamais un nom deviné).
const nomDeRegle = (r: Regle) => (r.valeurLue.connue ? titre(`${K}.r.nom.${r.code.replace('.', '_')}`) : r.code);
// Sous le titre d'une fenêtre : le nom de la règle ET son code (le code seul, pour une règle qu'on ne sait pas nommer).
const nomEtCode = (r: Regle) => (r.valeurLue.connue ? `${nomDeRegle(r)} · ${r.code}` : r.code);

// La case d'un prix dans une grille : le montant en dinars, ou « — » quand aucun n'est posé (jamais un prix deviné).
function CasePrix({ c }: { c: Case }) {
  return c ? <span data-donnee>{montant(c.ht)}</span> : <>—</>;
}

// ── Offres et prix ──────────────────────────────────────────────────────────────────────────────────────────────────
function Prix({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const r = d.echeance.relances.slice().sort((a, b) => b - a);
  const etapes = [
    ...r.map((n, i) => ({ quand: n === 1 ? dire(`${K}.p.f.veille`) : dire(`${K}.p.f.avant`, { n }),
      quoi: phrase(i === 0 ? `${K}.p.f.annonce` : i === r.length - 1 ? `${K}.p.f.dernier` : `${K}.p.f.rappel`), ton: 'calme' })),
    { quand: dire(`${K}.p.f.echeance`), quoi: phrase(`${K}.p.f.echeance_quoi`), ton: 'jour' },
    { quand: selon(d.echeance.grace, `${K}.p.f.grace`), quoi: phrase(`${K}.p.f.grace_quoi`), ton: 'grace' },
    { quand: dire(`${K}.p.f.lecture_seule`), quoi: phrase(`${K}.p.f.lecture_seule_quoi`), ton: 'fin' },
  ];
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-grille">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-grille">{titre(`${K}.p.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.p.sous`)}</p>
        </div></div>
        <div className="c-defile">
          <table className="c-table c-rg-grille">
            <thead><tr>
              <th scope="col">{titre(`${K}.p.col.offre`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.an`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.mois`)}</th>
              <th scope="col">{titre(`${K}.p.col.depuis`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.abonnes`)}</th>
            </tr></thead>
            <tbody>
              <tr>
                <td><b>{titre(`${K}.p.essai`)}</b><span className="c-sous c-bloc">{phrase(`${K}.p.essai_sous`, { jours: d.essai.jours })}</span></td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.an`)}>{titre(`${K}.p.gratuit`)}</td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.mois`)}>—</td>
                <td data-libelle={titre(`${K}.p.col.depuis`)}>—</td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.abonnes`)}>{selon(d.essai.enCours, `${K}.p.essais`)}</td>
              </tr>
              {d.grille.map((l) => {
                const depuis = [l.annuel?.depuis, l.mensuel?.depuis].filter((x): x is string => !!x).sort()[0] ?? null;
                const n = l.abonnes.annuel + l.abonnes.mensuel;
                return (
                  <tr key={l.offre}>
                    <td>
                      <b>{titre(`${K}.p.offre.${l.offre}`)}</b>
                      {l.aVenir.map((v) => (
                        <span key={`${v.periodicite}${v.aPartirDu}`} className="c-rg-avenir">
                          {phrase(`${K}.p.a_venir`, { prix: montant(v.ht), periode: dire(`${K}.p.periode.${v.periodicite}`), jour: jour(v.aPartirDu) })}
                        </span>
                      ))}
                    </td>
                    <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.an`)}><CasePrix c={l.annuel} /></td>
                    <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.mois`)}><CasePrix c={l.mensuel} /></td>
                    <td data-libelle={titre(`${K}.p.col.depuis`)}>{depuis ? dire(`${K}.p.depuis_le`, { jour: jour(depuis) }) : '—'}</td>
                    <td className="c-droite" data-libelle={titre(`${K}.p.col.abonnes`)}>
                      {selon(n, `${K}.p.entreprises`)}
                      {/* Le détail ne dit que ce qui existe : « 1 au mois », jamais « 0 à l'année · 1 au mois ». */}
                      {n ? <span className="c-sous c-bloc">{(['annuel', 'mensuel'] as const).filter((p) => l.abonnes[p] > 0)
                        .map((p) => dire(`${K}.p.detail_${p}`, { n: entier(l.abonnes[p]) })).join(' · ')}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="c-sous">{phrase(`${K}.p.note`)}</p>
        <p className="c-sous">{phrase(`${K}.p.changer`)}</p>
      </section>
      <Ajouts d={d} />
      <section className="c-carte c-rg" aria-labelledby="rg-echeance">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-echeance">{titre(`${K}.p.f.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.p.f.sous`)}</p>
        </div></div>
        <ol className="c-rg-frise">
          {etapes.map((e) => (
            <li key={e.quand} className={`c-rg-etape c-rg-etape-${e.ton}`}>
              <span className="c-rg-etape-quand">{maj(e.quand)}</span>
              <span className="c-rg-etape-quoi">{e.quoi}</span>
            </li>
          ))}
        </ol>
      </section>
      <NosFacturesCarte f={d.factures} aujourdhui={d.aujourdhui} geste={geste} peut={peut} />
    </>
  );
}

// Ce qui s'ajoute à l'offre (14c ; docs/abonnement.md C7) : la grille que l'application montre sous les offres et que la
// facture compte, datée comme celle des offres ; pour un module acheté seul, combien d'abonnés l'ont aujourd'hui.
function Ajouts({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-rg c-rg-ajouts-carte" aria-labelledby="rg-ajouts">
      <div className="c-al-section-tete"><div>
        <h2 id="rg-ajouts">{titre(`${K}.a.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${K}.a.sous`)}</p>
      </div></div>
      <div className="c-defile">
        <table className="c-table c-rg-grille c-rg-ajouts">
          <thead><tr>
            <th scope="col">{titre(`${K}.a.col.ajout`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.p.col.an`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.p.col.mois`)}</th>
            <th scope="col">{titre(`${K}.p.col.depuis`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.a.col.achetes`)}</th>
          </tr></thead>
          <tbody>
            {d.ajouts.map((l) => {
              const depuis = [l.annuel?.depuis, l.mensuel?.depuis].filter((x): x is string => !!x).sort()[0] ?? null;
              return (
                <tr key={l.option} data-option={l.option}>
                  <td>
                    <b>{titre(`${K}.a.nom.${l.option}`)}</b>
                    <span className="c-sous c-bloc">{phrase(`${K}.a.compris.${l.option}`)}</span>
                    {l.aVenir.map((v) => (
                      <span key={`${v.periodicite}${v.aPartirDu}`} className="c-rg-avenir">
                        {phrase(`${K}.p.a_venir`, { prix: montant(v.ht), periode: dire(`${K}.p.periode.${v.periodicite}`), jour: jour(v.aPartirDu) })}
                      </span>
                    ))}
                  </td>
                  <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.an`)}><CasePrix c={l.annuel} /></td>
                  <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.mois`)}><CasePrix c={l.mensuel} /></td>
                  <td className="c-rg-nowrap" data-libelle={titre(`${K}.p.col.depuis`)}>{depuis ? dire(`${K}.p.depuis_le`, { jour: jour(depuis) }) : '—'}</td>
                  <td className="c-droite" data-libelle={titre(`${K}.a.col.achetes`)}>{l.achetes === null ? '—' : selon(l.achetes, `${K}.p.entreprises`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="c-sous">{phrase(`${K}.a.note`)}</p>
    </section>
  );
}

// Nos factures : où elles naissent. Désignée, l'entreprise se nomme, avec qui l'a désignée ; tant qu'aucune facture n'y est
// préparée, elle se change encore. Sans elle, la carte dit ce qui ne se fait pas, et le geste qui le rend possible.
function NosFacturesCarte({ f, aujourdhui, geste, peut }: { f: NosFactures; aujourdhui: string; geste: (g: Geste) => void; peut: boolean }) {
  const e = f.editeur;
  const autre = f.possibles.some((p) => p.entreprise !== e?.entreprise);
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-factures">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-factures">{titre(`${K}.nf.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.nf.sous`)}</p>
        </div>
        {peut && !e && autre ? <Bouton ton="principal" onClick={() => geste({ sorte: 'editeur' })}>{titre(`${K}.nf.designer`)}</Bouton> : null}
        {peut && e && e.factures === 0 && autre ? <Bouton petit onClick={() => geste({ sorte: 'editeur' })}>{titre(`${K}.nf.changer`)}</Bouton> : null}
      </div>
      {e ? (
        <div className="c-rg-actuel">
          <div className="c-rg-actuel-tete">
            <div>
              <b data-donnee>{e.raisonSociale}</b>{e.matricule ? <span className="c-sous" data-donnee> · {e.matricule}</span> : null}
              <span className="c-sous c-bloc">{phrase(`${K}.nf.designee`, { nom: e.posePar ?? '—', quand: quand(e.poseLe, aujourdhui) })}</span>
            </div>
            <Puce ton="actif">{selon(e.factures, `${K}.nf.preparees`)}</Puce>
          </div>
          <p className="c-sous">{phrase(`${K}.nf.offert`)}</p>
          {e.proprietaire ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.nf.pas_proprietaire`)}</span></Alerte>}
          {e.factures ? <p className="c-sous">{phrase(`${K}.nf.fixe`)}</p> : null}
        </div>
      ) : <Vide icone="info">{phrase(autre ? `${K}.nf.aucune` : `${K}.nf.aucune_possible`)}</Vide>}
    </section>
  );
}

// ── Règles fiscales ─────────────────────────────────────────────────────────────────────────────────────────────────
function etatDeRegle(r: Regle, aujourdhui: string): { texte: string; ton: 'a_regarder' | 'actif' | 'hors' } {
  if (r.fin && r.fin < aujourdhui) return { texte: dire(`${K}.r.etat.finie`, { jour: jour(r.fin) }), ton: 'hors' };
  if (r.debut > aujourdhui) return { texte: dire(`${K}.r.etat.a_venir`, { jour: jour(r.debut) }), ton: 'hors' };
  const l = r.relectures[0];
  if (!l) return { texte: dire(`${K}.r.etat.a_relire`), ton: 'a_regarder' };
  if (l.avis === 'a_corriger') return { texte: dire(`${K}.r.etat.a_corriger`), ton: 'a_regarder' };
  return { texte: dire(`${K}.r.etat.relue`, { jour: jour(jourDe(l.le)) }), ton: 'actif' };
}
function Regles({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-registre">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-registre">{titre(`${K}.r.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.r.sous`)}</p>
        </div></div>
        {d.registre.length ? (
          <ul className="c-rg-registre">
            {d.registre.map((r) => {
              const e = etatDeRegle(r, d.aujourdhui);
              const [derniere, ...avant] = r.relectures;
              return (
                <li key={r.id} className={r.aRelire ? 'c-rg-regle c-rg-regle-a-relire' : 'c-rg-regle'}>
                  <div className="c-rg-regle-tete">
                    <div><b {...(r.valeurLue.connue ? {} : { 'data-donnee': '' })}>{nomDeRegle(r)}</b> <code className="c-rg-code" data-donnee>{r.code}</code></div>
                    <Puce ton={e.ton}>{e.texte}</Puce>
                  </div>
                  <dl className="c-rg-chiffres">
                    <div><dt>{titre(`${K}.r.valeur`)}</dt><dd>{r.valeurLue.connue ? dire(`${K}.r.valeur.${r.code.replace('.', '_')}`, { valeur: montant(r.valeurLue.texte) }) : <span data-donnee>{r.valeurLue.texte}</span>}</dd></div>
                    <div><dt>{titre(`${K}.r.vigueur`)}</dt><dd>{r.fin ? dire(`${K}.r.du_au`, { du: jour(r.debut), au: jour(r.fin) }) : dire(`${K}.r.depuis_sans_fin`, { du: jour(r.debut) })}</dd></div>
                    <div><dt>{titre(`${K}.r.posee`)}</dt><dd>{dire(`${K}.r.posee_le`, { jour: jour(jourDe(r.poseeLe)) })}</dd></div>
                  </dl>
                  <p className="c-rg-source"><span className="c-champ-libelle">{titre(`${K}.r.source`)}</span> <span>« <span data-donnee>{r.source}</span> »</span></p>
                  <p className={derniere ? 'c-rg-relue' : 'c-rg-relue c-rg-pas-relue'}>
                    {derniere ? phrase(derniere.avis === 'juste' ? `${K}.r.relue_juste` : `${K}.r.relue_corriger`,
                      { jour: jour(jourDe(derniere.le)), qui: derniere.reluePar, par: derniere.par })
                      : phrase(`${K}.r.jamais_relue`)}
                    {derniere?.dit ? <span className="c-bloc">« <span data-donnee>{derniere.dit}</span> »</span> : null}
                  </p>
                  {avant.length ? (
                    <details className="c-rg-avant">
                      <summary>{selon(avant.length, `${K}.r.relectures_avant`)}</summary>
                      <ul>
                        {avant.map((l) => (
                          <li key={l.le}>{phrase(l.avis === 'juste' ? `${K}.r.relue_juste` : `${K}.r.relue_corriger`, { jour: jour(jourDe(l.le)), qui: l.reluePar, par: l.par })}
                            {l.dit ? <> « <span data-donnee>{l.dit}</span> »</> : null}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {peut ? <div className="c-rg-geste"><Bouton petit onClick={() => geste({ sorte: 'relire', regle: r })}>{titre(`${K}.r.relire`)}</Bouton></div> : null}
                </li>
              );
            })}
          </ul>
        ) : <Vide icone="info">{phrase(`${K}.r.vide`)}</Vide>}
      </section>
      <div className="c-rg-duo">
        <section className="c-carte c-rg" aria-labelledby="rg-hors">
          <div className="c-al-section-tete"><div>
            <h2 id="rg-hors">{titre(`${K}.r.hors.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.r.hors.sous`)}</p>
          </div></div>
          <ul className="c-rg-liste">
            {['paie', 'tva', 'retenue', 'echeances'].map((h) => (
              <li key={h}><b>{titre(`${K}.r.hors.${h}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.r.hors.${h}_ou`)}</span></li>
            ))}
          </ul>
        </section>
        <section className="c-carte c-rg" aria-labelledby="rg-lf">
          <div className="c-al-section-tete"><div>
            <h2 id="rg-lf">{titre(`${K}.r.lf.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.r.lf.sous`)}</p>
          </div></div>
          <ol className="c-rg-etapes">
            {['lire', 'ecrire', 'relire', 'publier'].map((e) => (
              <li key={e}><b>{titre(`${K}.r.lf.${e}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.r.lf.${e}_quoi`)}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

// ── Formats officiels ───────────────────────────────────────────────────────────────────────────────────────────────
// Le registre que le code déclare (serveur/console/formats.ts) et ce que la plateforme en a fait : des comptes, toutes
// entreprises ensemble. Ce qui demande un geste chez un client (une pièce retenue ou refusée par la TTN) se dit en
// couleur ; un service dont ce serveur n'a pas l'adresse le dit, ses pièces attendent.
const TON_FORMAT: Record<EtatFormat, 'actif' | 'a_regarder' | 'hors'> = {
  en_place: 'actif', calcule: 'actif', simule: 'a_regarder', pas_encore: 'hors', non_homologue: 'hors',
};
// Ce que le format a fait, en phrases courtes ; seulement ce qui existe (« 3 acceptées », jamais « 0 refusée »).
function chiffresDuFormat(f: Format, aujourdhui: string): { texte: string; alerte?: boolean }[] {
  const c = f.chiffres ?? {};
  const n = (k: string) => (typeof c[k] === 'number' ? c[k] as number : 0);
  const compte = (k: string, cle: string) => selon(n(k), `${K}.f.${cle}`, { n: entier(n(k)) });
  // Le dernier, accordé à ce qu'il date : un fichier écrit, une pièce signée, une pièce acceptée.
  const dernier = (k: string) => (typeof c[k] === 'string' ? [{ texte: dire(`${K}.f.${f.code}.dernier`, { quand: quand(c[k] as string, aujourdhui) }) }] : []);
  if (f.code === 'teif') {
    return [{ texte: [compte('fichiers', 'teif.fichiers'), n('entreprises') ? compte('entreprises', 'teif.chez') : ''].filter(Boolean).join(' ') },
      ...(n('autres') ? [{ texte: compte('autres', 'teif.autres') }] : []), ...dernier('dernier'), { texte: compte('soumises', 'teif.soumises') }];
  }
  if (f.code === 'signature') {
    return [{ texte: compte('signees', 'signature.signees') }, ...(n('aSigner') ? [{ texte: compte('aSigner', 'signature.a_signer') }] : []), ...dernier('dernier')];
  }
  if (f.code === 'ttn') {
    const lignes = ([['acceptees', 'acceptees', false], ['deposees', 'deposees', false], ['enRoute', 'en_route', false], ['sansEnvoi', 'sans_envoi', false],
      ['retenues', 'retenues', true], ['refusees', 'refusees', true]] as const)
      .filter(([k]) => n(k) > 0).map(([k, cle, alerte]) => ({ texte: compte(k, `ttn.${cle}`), alerte }));
    return lignes.length ? [...lignes, ...dernier('derniereAcceptee')] : [{ texte: dire(`${K}.f.ttn.rien`) }];
  }
  return [];
}
function Formats({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-rg c-rg-formats-carte" aria-labelledby="rg-formats">
      <div className="c-al-section-tete"><div>
        <h2 id="rg-formats">{titre(`${K}.f.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${K}.f.sous`)}</p>
      </div></div>
      <div className="c-defile">
        <table className="c-table c-rg-formats">
          <thead><tr>
            <th scope="col">{titre(`${K}.f.col.format`)}</th><th scope="col">{titre(`${K}.f.col.version`)}</th>
            <th scope="col">{titre(`${K}.f.col.fait`)}</th><th scope="col">{titre(`${K}.f.col.contre`)}</th><th scope="col">{titre(`${K}.f.col.etat`)}</th>
          </tr></thead>
          <tbody>
            {d.formats.map((f) => {
              const v = { version: f.version ?? '—' };
              return (
                <tr key={f.code} className={f.alerte ? 'c-rg-format-alerte' : undefined}>
                  <td><b>{titre(`${K}.f.${f.code}.nom`)}</b><span className="c-sous c-bloc">{dire(`${K}.f.${f.code}.pour`)}</span></td>
                  <td className="c-rg-nowrap" data-libelle={titre(`${K}.f.col.version`)}>{f.code === 'teif' ? dire(`${K}.f.teif.version`, v) : f.version ? <span data-donnee>{f.version}</span> : '—'}</td>
                  <td data-libelle={titre(`${K}.f.col.fait`)}>{phrase(`${K}.f.${f.code}.fait`, v)}</td>
                  <td data-libelle={titre(`${K}.f.col.contre`)}>{phrase(`${K}.f.${f.code}.contre`, v)}</td>
                  <td data-libelle={titre(`${K}.f.col.etat`)}>
                    <Puce ton={TON_FORMAT[f.etat]}>{dire(`${K}.f.etat.${f.etat}`)}</Puce>
                    {chiffresDuFormat(f, d.aujourdhui).map((c) => (
                      <span key={c.texte} className={c.alerte ? 'c-sous c-bloc c-rg-format-geste' : 'c-sous c-bloc'}>{maj(c.texte)}</span>
                    ))}
                    {f.branche !== null ? (
                      <span className={f.branche ? 'c-sous c-bloc' : 'c-sous c-bloc c-rg-format-attend'}>
                        {phrase(`${K}.f.branche.${f.code === 'ttn' ? 'ttn' : 'digigo'}_${f.branche ? 'oui' : 'non'}`)}
                      </span>
                    ) : null}
                    {f.aVerifier ? <span className="c-sous c-bloc c-rg-verifier">{dire(`${K}.f.a_verifier`, { quoi: dire(`${K}.f.${f.code}.verifier`) })}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="c-sous">{phrase(`${K}.f.note`)}</p>
    </section>
  );
}

// ── Messages aux clients ────────────────────────────────────────────────────────────────────────────────────────────
// Ce que voient les clients : la même forme que le bandeau de leur application (web/public/plateforme/message.js).
function Apercu({ sorte, texte }: { sorte: Message['sorte']; texte: string }) {
  return (
    <div className={`c-rg-apercu c-rg-apercu-${sorte}`} role="note">
      <span className="c-rg-apercu-sorte">{titre(`${K}.m.sorte.${sorte}`)}</span>
      <span className="c-rg-apercu-texte" data-donnee>{texte || '…'}</span>
      <span className="c-rg-apercu-fermer" aria-hidden="true">{titre(`${K}.m.plus_tard`)}</span>
    </div>
  );
}
function Messages({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const m = d.message;
  const futur = m ? m.du > d.aujourdhui : false;
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-message">
        <div className="c-al-section-tete">
          <div>
            <h2 id="rg-message">{titre(`${K}.m.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.m.sous`)}</p>
          </div>
          {peut ? <Bouton ton={m ? 'secondaire' : 'principal'} icone="plus" onClick={() => geste({ sorte: 'ecrire' })}>{titre(`${K}.m.ecrire`)}</Bouton> : null}
        </div>
        {m ? (
          <div className="c-rg-actuel">
            <div className="c-rg-actuel-tete">
              <div>
                <Puce ton={futur ? 'semaine' : 'actif'}>{titre(`${K}.m.sorte.${m.sorte}`)}</Puce>{' '}
                <span className="c-sous">{phrase(futur ? `${K}.m.paraitra` : `${K}.m.affiche`, { du: jour(m.du), au: jour(m.au) })}</span>
              </div>
              {peut ? <Bouton petit onClick={() => geste({ sorte: 'retirer', message: m })}>{titre(`${K}.m.retirer`)}</Bouton> : null}
            </div>
            <span className="c-champ-libelle">{titre(`${K}.m.ce_que_voient`)}</span>
            <Apercu sorte={m.sorte} texte={m.texte} />
            <p className="c-sous">{titre(`${K}.m.ecrit_par`, { nom: m.par, quand: quand(m.le, d.aujourdhui) })} <span data-donnee>« {m.motif} »</span></p>
          </div>
        ) : <Vide icone="info">{phrase(`${K}.m.aucun`)}</Vide>}
      </section>
      <section className="c-carte c-rg" aria-labelledby="rg-passes">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-passes">{titre(`${K}.m.passes`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.m.passes_sous`)}</p>
        </div></div>
        {d.passes.length ? (
          <div className="c-defile">
            <table className="c-table">
              <thead><tr>
                <th scope="col">{titre(`${K}.m.col.sorte`)}</th><th scope="col">{titre(`${K}.m.col.texte`)}</th>
                <th scope="col">{titre(`${K}.m.col.quand`)}</th><th scope="col">{titre(`${K}.m.col.fin`)}</th>
              </tr></thead>
              <tbody>
                {d.passes.map((p) => (
                  <tr key={p.id}>
                    <td><Puce ton="hors">{titre(`${K}.m.sorte.${p.sorte}`)}</Puce></td>
                    <td data-libelle={titre(`${K}.m.col.texte`)}><span data-donnee>{p.texte}</span></td>
                    <td className="c-rg-nowrap" data-libelle={titre(`${K}.m.col.quand`)}>{dire(`${K}.m.du_au`, { du: jour(p.du), au: jour(p.au) })}
                      <span className="c-sous c-bloc">{dire(`${K}.m.par`, { nom: p.par })}</span></td>
                    <td data-libelle={titre(`${K}.m.col.fin`)}>
                      {p.remplace ? maj(dire(`${K}.m.fin.remplace`, { jour: jour(jourDe(p.retireLe ?? p.le)) }))
                        : p.retireLe ? <>{maj(dire(`${K}.m.fin.retire`, { jour: jour(jourDe(p.retireLe)), nom: p.retirePar ?? '—' }))}{p.retireMotif ? <span className="c-sous c-bloc" data-donnee>« {p.retireMotif} »</span> : null}</>
                          : maj(dire(`${K}.m.fin.fini`, { jour: jour(p.au) }))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vide icone="info">{phrase(d.message ? `${K}.m.passes_vide_premier` : `${K}.m.passes_vide`)}</Vide>}
      </section>
    </>
  );
}

// ── Les gestes : chacun dit ce qui va se passer, demande son motif, et entre au journal ─────────────────────────────
function FenetreGeste({ g, d, fermer, fait }: { g: Geste; d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [reluePar, setReluePar] = useState('');
  const [avis, setAvis] = useState<'juste' | 'a_corriger'>('juste');
  const [dit, setDit] = useState('');
  const [sorte, setSorte] = useState<Message['sorte']>('nouveaute');
  const [texte, setTexte] = useState('');
  const [du, setDu] = useState(d.aujourdhui);
  const [au, setAu] = useState(plusJours(d.aujourdhui, 7));
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const choisissables = d.factures.possibles.filter((p) => p.entreprise !== d.factures.editeur?.entreprise);
  const [entreprise, setEntreprise] = useState(choisissables[0]?.entreprise ?? '');
  const refuser = (champ: string, cle: string) => { setRefus(phrase(cle)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (g.sorte === 'relire' && reluePar.trim().length < 3) { refuser('qui', `${K}.g.relire.qui_court`); return; }
    if (g.sorte === 'ecrire') {
      const t = texte.trim();
      if (t.length < 10 || t.length > 240) { refuser('texte', `${K}.g.ecrire.texte_longueur`); return; }
      if (/[<>]/.test(t)) { refuser('texte', `${K}.g.ecrire.sans_balise`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || du < d.aujourdhui) { refuser('du', `${K}.g.ecrire.du_passe`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(au) || au < du) { refuser('au', `${K}.g.ecrire.au_avant`); return; }
      if (au > plusJours(du, 30)) { refuser('au', `${K}.g.ecrire.trente_jours`); return; }
    }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = g.sorte === 'relire' ? await api('POST', `/console/reglages/regles/${g.regle.id}/relire`, { reluePar: reluePar.trim(), avis, dit: dit.trim() || null, motif: motif.trim() })
          : g.sorte === 'ecrire' ? await api('POST', '/console/reglages/messages', { sorte, texte: texte.trim(), du, au, motif: motif.trim() })
            : g.sorte === 'editeur' ? await api('POST', '/console/reglages/factures/editeur', { entreprise, motif: motif.trim() })
              : await api('POST', `/console/reglages/messages/${g.message.id}/retirer`, { motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200 || res.statut === 201) { toast(phrase(`${K}.g.${g.sorte}.fait`)); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const choisie = choisissables.find((p) => p.entreprise === entreprise);
  const valeurs = g.sorte === 'relire' ? { regle: nomDeRegle(g.regle) } : g.sorte === 'retirer' ? { du: jour(g.message.du), au: jour(g.message.au) }
    : g.sorte === 'editeur' ? { nom: choisie?.raisonSociale ?? '—' } : {};
  const remplace = g.sorte === 'ecrire' && d.message;
  return (
    <Dialogue titre={titre(`${K}.g.${g.sorte}.titre`, valeurs)} sous={g.sorte === 'relire' ? nomEtCode(g.regle) : g.sorte === 'retirer' ? g.message.texte : undefined}
      sousDonnee={g.sorte === 'retirer' || (g.sorte === 'relire' && !g.regle.valeurLue.connue)}
      fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${K}.g.${g.sorte}.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          {g.sorte === 'ecrire'
            ? [remplace ? 'p1_remplace' : 'p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.ecrire.${p}`)}</li>)
            : ['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.${g.sorte}.${p}`, valeurs)}</li>)}
        </ul>
      </div>
      {g.sorte === 'relire' ? (
        <>
          <Champ libelle={titre(`${K}.g.relire.qui`)} aide={phrase(`${K}.g.relire.qui_aide`)} valeur={reluePar} changer={setReluePar} premier {...fauteDe('qui')} />
          <Choix libelle={titre(`${K}.g.relire.avis`)} valeur={avis} changer={(v) => setAvis(v === 'a_corriger' ? 'a_corriger' : 'juste')}
            options={[{ valeur: 'juste', texte: titre(`${K}.g.relire.avis_juste`) }, { valeur: 'a_corriger', texte: titre(`${K}.g.relire.avis_corriger`) }]} />
          <Zone libelle={titre(`${K}.g.relire.dit`)} aide={phrase(`${K}.g.relire.dit_aide`)} valeur={dit} changer={setDit} max={1000} />
        </>
      ) : null}
      {g.sorte === 'editeur' ? (
        <Choix libelle={titre(`${K}.g.editeur.laquelle`)} aide={phrase(`${K}.g.editeur.laquelle_aide`)} valeur={entreprise} changer={setEntreprise}
          options={choisissables.map((p) => ({ valeur: p.entreprise, texte: p.matricule ? `${p.raisonSociale} · ${p.matricule}` : p.raisonSociale, donnee: true }))} />
      ) : null}
      {g.sorte === 'ecrire' ? (
        <>
          <Choix libelle={titre(`${K}.g.ecrire.sorte`)} valeur={sorte} changer={(v) => setSorte(v === 'maintenance' ? 'maintenance' : 'nouveaute')}
            options={[{ valeur: 'nouveaute', texte: titre(`${K}.m.sorte.nouveaute`) }, { valeur: 'maintenance', texte: titre(`${K}.m.sorte.maintenance`) }]} />
          <Zone libelle={titre(`${K}.g.ecrire.texte`)} aide={phrase(`${K}.g.ecrire.texte_aide`, { n: entier(texte.trim().length) })} valeur={texte} changer={setTexte} max={240} premier {...fauteDe('texte')} />
          <div className="c-rg-dates">
            <Champ libelle={titre(`${K}.g.ecrire.du`)} type="date" valeur={du} changer={setDu} {...fauteDe('du')} />
            <Champ libelle={titre(`${K}.g.ecrire.au`)} type="date" valeur={au} changer={setAu} {...fauteDe('au')} />
          </div>
          <span className="c-champ-libelle">{titre(`${K}.m.ce_que_verront`)}</span>
          <Apercu sorte={sorte} texte={texte.trim()} />
        </>
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.${g.sorte}.motif_aide`, valeurs)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Reglages({ onglet: demande }: { onglet: string | null }) {
  const [l, relire] = useLecture<Donnees>('/console/reglages', 'reglages');
  const [geste, setGeste] = useState<Geste | null>(null);
  const onglet: OngletReglages = ONGLETS_REGLAGES.includes(demande as OngletReglages) ? demande as OngletReglages : 'prix';
  const d = l.etat === 'lu' ? l.donnees : null;
  const peut = d?.role === 'direction';
  const aRelire = d ? d.registre.filter((r) => r.aRelire).length : 0;
  // Les pièces qui demandent un geste chez un client : retenues ou refusées par la TTN.
  const ttn = d?.formats.find((f) => f.code === 'ttn')?.chiffres;
  const aRegarder = ttn ? Number(ttn.retenues ?? 0) + Number(ttn.refusees ?? 0) : 0;
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
      </header>
      {d && !peut ? <Alerte ton="info" icone="cadenas"><span><b>{titre(`${K}.reserve`)}</b> {phrase(`${K}.reserve_texte`)}</span></Alerte> : null}
      <nav className="c-onglets" aria-label={titre(`${K}.onglets`)}>
        {ONGLETS_REGLAGES.map((o) => (
          <a key={o} href={o === 'prix' ? '#/reglages' : `#/reglages?onglet=${o}`} aria-current={onglet === o ? 'page' : undefined}>
            {titre(`${K}.onglet.${o}`)}
            {o === 'regles' && aRelire ? (
              <><span className="c-onglet-n" aria-hidden="true">{entier(aRelire)}</span><span className="c-cache">{selon(aRelire, `${K}.onglet.a_relire`)}</span></>
            ) : null}
            {o === 'formats' && aRegarder ? (
              <><span className="c-onglet-n" aria-hidden="true">{entier(aRegarder)}</span><span className="c-cache">{selon(aRegarder, `${K}.onglet.a_regarder`, { n: entier(aRegarder) })}</span></>
            ) : null}
            {o === 'messages' && d?.message ? <span className="c-onglet-n" aria-hidden="true">1</span> : null}
          </a>
        ))}
      </nav>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d && onglet === 'prix' ? <Prix d={d} geste={setGeste} peut={peut} /> : null}
      {d && onglet === 'regles' ? <Regles d={d} geste={setGeste} peut={peut} /> : null}
      {d && onglet === 'formats' ? <Formats d={d} /> : null}
      {d && onglet === 'messages' ? <Messages d={d} geste={setGeste} peut={peut} /> : null}
      {geste && d ? <FenetreGeste g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
