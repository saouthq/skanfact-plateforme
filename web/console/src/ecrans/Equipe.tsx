// L'équipe SkanFact (10 § 2.10 ; serveur/console/routes.ts, /console/equipe ; 0083) : qui entre dans la console, avec
// quel rôle, son code du téléphone (sans lui, la console ne s'ouvre pas), sa dernière connexion et où sa session est
// ouverte. La direction ajoute, change un rôle, retire : chaque geste demande un motif et reste au journal. Jamais sur
// soi-même, et l'équipe garde toujours quelqu'un à la direction (la base le tient). Recalé sur sa maquette : trois
// cartes (l'équipe, le code du téléphone, qui est en ligne), « À régler dans l'équipe » quand quelqu'un n'entre pas
// encore (avec de quoi le lui rappeler), les gestes d'une ligne dans son menu (le même que les règles des alertes,
// MenuLigne), et ce que chaque rôle ouvre — lu dans la liste des gestes du serveur, jamais recopié ici.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, MenuLigne, Puce, toast, Zone, type ActionLigne } from '../ui.tsx';

type Membre = {
  utilisateur: string; nom: string; email: string; role: Role; actif: boolean; ajouteLe: string; retireLe: string | null;
  code: 'sms' | 'application' | null; moi: boolean; derniereConnexion: string | null; appareils: { nom: string; type: string }[];
};
const ROLES: readonly Role[] = ['direction', 'support', 'technique'];
type Droit = { code: string; roles: Role[] };
// Ce qu'un rôle ouvre seulement en partie : la nuance se dit à la place du « oui ».
const NUANCES: Record<string, Partial<Record<Role, string>>> = {
  'console.accueil.voir': { support: 'console.ecran.equipe.droit.console.accueil.voir.support', technique: 'console.ecran.equipe.droit.console.accueil.voir.technique' },
  'console.abonnement.prolonger': { support: 'console.ecran.equipe.droit.console.abonnement.prolonger.support' },
  'console.abonnement.offrir_mois': { support: 'console.ecran.equipe.droit.console.abonnement.offrir_mois.support' },
};
type Geste = { sorte: 'ajouter' } | { sorte: 'role'; m: Membre } | { sorte: 'retirer'; m: Membre };

function FenetreEquipe({ g, fermer, fait }: { g: Geste; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(g.sorte === 'role' ? (ROLES.find((r) => r !== g.m.role) ?? 'support') : 'support');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string | null) => { setRefus(texte); setFaute(champ ? { champ, n: (faute?.n ?? 0) + 1 } : null); };

  const faire = () => {
    if (g.sorte === 'ajouter' && !email.trim()) { refuser(phrase('console.ecran.equipe.email_aide'), 'email'); return; }
    if (motif.trim().length < 3) { refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = g.sorte === 'ajouter' ? await api('POST', '/console/equipe', { email: email.trim(), role, motif: motif.trim() })
          : g.sorte === 'role' ? await api('PUT', `/console/equipe/${g.m.utilisateur}`, { role, motif: motif.trim() })
            : await api('POST', `/console/equipe/${g.m.utilisateur}/retirer`, { motif: motif.trim() });
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) {
          toast(phrase(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajoute' : g.sorte === 'role' ? 'console.ecran.equipe.role_change' : 'console.ecran.equipe.retire'));
          fait();
          return;
        }
        refuser(refusDe(r), r.corps.champ === 'email' || r.corps.champ === 'motif' ? r.corps.champ : null);
      } catch (x) { refuser(panneDe(x), null); } finally { setOccupe(false); }
    })();
  };

  const nom = g.sorte === 'ajouter' ? titre('console.ecran.equipe.ajouter')
    : g.sorte === 'role' ? titre('console.ecran.equipe.changer_role_de', { nom: g.m.nom }) : titre('console.ecran.equipe.retirer_de', { nom: g.m.nom });
  const sous = phrase(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajouter_sous' : g.sorte === 'role' ? 'console.ecran.equipe.changer_sous' : 'console.ecran.equipe.retirer_sous');
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });
  return (
    <Dialogue titre={nom} sous={sous} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton={g.sorte === 'retirer' ? 'danger' : 'principal'} occupe={occupe} onClick={faire}>
          {titre(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajouter' : g.sorte === 'role' ? 'console.ecran.equipe.changer_role' : 'console.ecran.equipe.retirer')}
        </Bouton>
      </>}>
      {g.sorte === 'ajouter' ? <Champ libelle={titre('console.ecran.equipe.email')} aide={phrase('console.ecran.equipe.email_aide')} type="email" inputMode="email" valeur={email} changer={setEmail} {...sur('email')} /> : null}
      {g.sorte !== 'retirer' ? (
        <Choix libelle={titre('console.ecran.equipe.role')} aide={phrase(`console.ecran.role_aide.${role}`)} valeur={role} changer={(v) => setRole(v as Role)}
          options={ROLES.filter((r) => g.sorte !== 'role' || r !== g.m.role).map((r) => ({ valeur: r, texte: titre(`console.ecran.role.${r}`) }))} />
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.equipe.motif_aide')} valeur={motif} changer={setMotif} {...sur('motif')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

export function Equipe() {
  const { moi } = useConsole();
  const [l, relire] = useLecture<{ membres: Membre[]; droits: Droit[] }>('/console/equipe');
  const [geste, setGeste] = useState<Geste | null>(null);
  const membres = l.etat === 'lu' ? l.donnees.membres : [];
  const actifs = membres.filter((m) => m.actif);
  const retires = membres.filter((m) => !m.actif);
  const par = (r: Role) => actifs.filter((m) => m.role === r).length;
  const enLigne = actifs.filter((m) => m.appareils.length > 0).length;
  const sansCode = actifs.filter((m) => !m.code);
  // Les gestes d'une ligne : le journal de la personne ; et, sur un autre que soi, changer son rôle ou la retirer.
  const actions = (m: Membre): ActionLigne[] => [
    { icone: 'journal', titre: titre(m.moi ? 'console.ecran.equipe.mes_gestes' : 'console.ecran.equipe.ses_gestes'), sous: phrase('console.ecran.equipe.ses_gestes_sous'),
      faire: () => { location.hash = `#/journal?qui=${m.utilisateur}`; } },
    ...(m.moi ? [] : [
      { icone: 'echange', titre: titre('console.ecran.equipe.changer_role'), sous: phrase('console.ecran.equipe.changer_sous'), faire: () => setGeste({ sorte: 'role', m }) },
      { icone: 'sortir', titre: titre('console.ecran.equipe.retirer'), sous: phrase('console.ecran.equipe.retirer_sous'), faire: () => setGeste({ sorte: 'retirer', m }), danger: true },
    ] satisfies ActionLigne[]),
  ];

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.equipe.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.equipe.sous')}</p>
        </div>
        <div className="c-entete-actions">
          <Lien href="#/journal" icone="journal">{titre('console.ecran.equipe.journal')}</Lien>
          <Bouton ton="principal" icone="plus" onClick={() => setGeste({ sorte: 'ajouter' })}>{titre('console.ecran.equipe.ajouter')}</Bouton>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {l.etat === 'lu' ? (
        <>
          <div className="c-eq-cartes">
            <div className="c-carte c-eq-carte">
              <span className="c-eq-carte-titre">{titre('console.ecran.equipe.membres')}</span>
              <p className="c-eq-carte-n"><b>{actifs.length}</b> <small>{selon(actifs.length, 'console.ecran.equipe.personnes')}</small></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.membres_sous', { d: par('direction'), s: par('support'), t: par('technique') })}</span>
            </div>
            <div className={`c-carte c-eq-carte${sansCode.length ? ' c-eq-carte-attention' : ''}`}>
              <span className="c-eq-carte-titre">
                {titre('console.ecran.equipe.code_titre')}
                {sansCode.length ? <span className="c-eq-etat c-eq-etat-attention"><Icone nom="alerte" taille={14} />{selon(sansCode.length, 'console.ecran.equipe.code_a_mettre')}</span>
                  : actifs.length ? <span className="c-eq-etat"><Icone nom="ok" taille={14} />{dire('console.ecran.equipe.code_tous')}</span> : null}
              </span>
              <p className="c-eq-carte-n"><b>{dire('console.ecran.equipe.code_sur', { avec: actifs.length - sansCode.length, n: actifs.length })}</b></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.code_sous')}</span>
            </div>
            <div className="c-carte c-eq-carte">
              <span className="c-eq-carte-titre">{titre('console.ecran.equipe.en_ligne')}</span>
              <p className="c-eq-carte-n"><b>{enLigne}</b></p>
              <span className="c-eq-carte-sous">{phrase('console.ecran.equipe.en_ligne_sous')}</span>
            </div>
          </div>
          {sansCode.length ? (
            <section className="c-carte c-eq-regler" aria-labelledby="eq-regler">
              <div className="c-carte-tete">
                <h2 id="eq-regler">{titre('console.ecran.equipe.regler_titre')}</h2>
                <span className="c-eq-etat c-eq-etat-attention">{selon(sansCode.length, 'console.ecran.equipe.a_regler')}</span>
              </div>
              <ul className="c-eq-regler-liste">
                {sansCode.map((m) => (
                  <li key={m.utilisateur}>
                    <span className="c-eq-regler-icone" aria-hidden="true"><Icone nom="telephone" /></span>
                    <span className="c-eq-regler-texte"><b>{dire('console.ecran.equipe.regler_code', { nom: m.nom })}</b><span>{phrase('console.ecran.equipe.sans_code_sous')}</span></span>
                    <Lien href={`mailto:${m.email}?subject=${encodeURIComponent(maj(dire('console.ecran.equipe.rappeler_objet')))}`} petit>{titre('console.ecran.equipe.rappeler')}</Lien>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="c-carte c-liste-carte" aria-labelledby="eq-liste">
            <div className="c-carte-tete c-eq-liste-tete">
              <div>
                <h2 id="eq-liste">{titre('console.ecran.equipe.liste_titre')}</h2>
                <p className="c-carte-sous">{phrase('console.ecran.equipe.liste_sous')}</p>
              </div>
            </div>
            <div className="c-defile">
              <table className="c-table">
                <thead>
                  <tr>
                    <th scope="col">{titre('console.ecran.equipe.colonne.personne')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.role')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.code')}</th>
                    <th scope="col">{titre('console.ecran.equipe.colonne.connexion')}</th>
                    <th scope="col"><span className="c-cache">{titre('console.ecran.fiche.gestes')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {actifs.map((m) => (
                    <tr key={m.utilisateur}>
                      <td>
                        <div className="c-cellule-nom">
                          <Avatar nom={m.nom} nuit={m.role === 'direction'} />
                          <div><span className="c-nom-ligne"><b data-donnee>{m.nom}</b>{m.moi ? <b className="c-eq-toi">({dire('console.ecran.equipe.toi')})</b> : null}</span><span className="c-sous" data-donnee>{m.email}</span></div>
                        </div>
                      </td>
                      <td><Puce ton={m.role}>{titre(`console.ecran.role.${m.role}`)}</Puce></td>
                      <td>{m.code ? titre(`console.ecran.equipe.code.${m.code}`) : <Puce ton="en_retard">{dire('console.ecran.equipe.code.aucun')}</Puce>}</td>
                      <td>
                        {maj(m.derniereConnexion ? quand(m.derniereConnexion, moi.aujourdhui) : dire('console.ecran.temps.jamais'))}
                        {m.appareils.length ? <span className="c-sous">{titre('console.ecran.equipe.ouvert_sur', { appareils: m.appareils.map((a) => a.nom).join(', ') })}</span> : null}
                      </td>
                      <td className="c-droite"><MenuLigne etiquette={titre('console.ecran.equipe.menu', { nom: m.nom })} actions={actions(m)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="c-carte c-liste-carte" aria-labelledby="roles-titre">
            <div className="c-carte-tete c-eq-liste-tete">
              <div>
                <h2 id="roles-titre">{titre('console.ecran.equipe.roles_titre')}</h2>
                <p className="c-carte-sous">{phrase('console.ecran.equipe.roles_sous')}</p>
              </div>
            </div>
            <div className="c-defile">
              <table className="c-table c-eq-droits">
                <thead>
                  <tr>
                    <th scope="col">{titre('console.ecran.equipe.droit.colonne')}</th>
                    {ROLES.map((r) => <th key={r} scope="col" className="c-eq-droit-col">{titre(`console.ecran.role.${r}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {l.donnees.droits.map((d) => (
                    <tr key={d.code}>
                      <td className="c-eq-droit-quoi"><b>{titre(`console.ecran.equipe.droit.${d.code}`)}</b><span className="c-sous">{phrase(`console.ecran.equipe.droit.${d.code}_sous`)}</span></td>
                      {ROLES.map((r) => {
                        const nuance = NUANCES[d.code]?.[r];
                        return (
                          <td key={r}>
                            {!d.roles.includes(r) ? <span className="c-eq-droit-non" aria-label={titre('console.ecran.equipe.droit.non')}>—</span>
                              : nuance ? <span className="c-eq-droit c-eq-droit-nuance"><span aria-hidden="true">–</span>{dire(nuance)}</span>
                                : <span className="c-eq-droit"><Icone nom="ok" taille={15} />{titre('console.ecran.equipe.droit.oui')}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {retires.length ? (
            <section className="c-carte" aria-labelledby="retires-titre">
              <div className="c-carte-tete"><h2 id="retires-titre">{titre('console.ecran.equipe.retires')}</h2></div>
              <ul className="c-personnes">
                {retires.map((m) => (
                  <li key={m.utilisateur}>
                    <Avatar nom={m.nom} />
                    <div className="c-texte"><b data-donnee>{m.nom}</b><span data-donnee>{m.email}</span>
                      <span>{titre(`console.ecran.role.${m.role}`)} · {dire('console.ecran.equipe.retire_le', { le: m.retireLe ? jourCourt(jourDe(m.retireLe)) : '—' })}</span></div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {geste ? <FenetreEquipe g={geste} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
