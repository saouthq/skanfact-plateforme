// L'équipe SkanFact (10 § 2.10 ; serveur/console/routes.ts, /console/equipe ; 0083) : qui entre dans la console, avec
// quel rôle, son code du téléphone (sans lui, la console ne s'ouvre pas), sa dernière connexion et où sa session est
// ouverte. La direction ajoute, change un rôle, retire : chaque geste demande un motif et reste au journal. Jamais sur
// soi-même, et l'équipe garde toujours quelqu'un à la direction (la base le tient).
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, maj, Puce, toast, Zone } from '../ui.tsx';

type Membre = {
  utilisateur: string; nom: string; email: string; role: Role; actif: boolean; ajouteLe: string; retireLe: string | null;
  code: 'sms' | 'application' | null; moi: boolean; derniereConnexion: string | null; appareils: { nom: string; type: string }[];
};
const ROLES: readonly Role[] = ['direction', 'support', 'technique'];
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
        <Bouton onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton={g.sorte === 'retirer' ? 'danger' : 'principal'} occupe={occupe} onClick={faire}>
          {titre(g.sorte === 'ajouter' ? 'console.ecran.equipe.ajouter' : g.sorte === 'role' ? 'console.ecran.equipe.changer_role' : 'console.ecran.equipe.retirer')}
        </Bouton>
      </>}>
      {g.sorte === 'ajouter' ? <Champ libelle={titre('console.ecran.equipe.email')} aide={phrase('console.ecran.equipe.email_aide')} type="email" inputMode="email" valeur={email} changer={(v) => { setEmail(v); setRefus(null); }} {...sur('email')} /> : null}
      {g.sorte !== 'retirer' ? (
        <Choix libelle={titre('console.ecran.equipe.role')} aide={phrase(`console.ecran.role_aide.${role}`)} valeur={role} changer={(v) => setRole(v as Role)}
          options={ROLES.filter((r) => g.sorte !== 'role' || r !== g.m.role).map((r) => ({ valeur: r, texte: titre(`console.ecran.role.${r}`) }))} />
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.equipe.motif_aide')} valeur={motif} changer={(v) => { setMotif(v); setRefus(null); }} {...sur('motif')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

export function Equipe() {
  const { moi } = useConsole();
  const [l, relire] = useLecture<{ membres: Membre[] }>('/console/equipe');
  const [geste, setGeste] = useState<Geste | null>(null);
  const membres = l.etat === 'lu' ? l.donnees.membres : [];
  const actifs = membres.filter((m) => m.actif);
  const retires = membres.filter((m) => !m.actif);
  const par = (r: Role) => actifs.filter((m) => m.role === r).length;
  const enLigne = actifs.filter((m) => m.appareils.length > 0).length;
  const sansCode = actifs.filter((m) => !m.code).length;

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.equipe.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.equipe.sous')}</p>
        </div>
        <div className="c-entete-actions"><Bouton ton="principal" icone="plus" onClick={() => setGeste({ sorte: 'ajouter' })}>{titre('console.ecran.equipe.ajouter')}</Bouton></div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {l.etat === 'lu' ? (
        <>
          <div className="c-chiffres c-chiffres-cartes">
            <div className="c-carte c-chiffre"><span>{titre('console.ecran.equipe.membres')}</span><b>{actifs.length}</b>
              <span>{phrase('console.ecran.equipe.membres_sous', { d: par('direction'), s: par('support'), t: par('technique') })}</span></div>
            <div className="c-carte c-chiffre"><span>{titre('console.ecran.equipe.en_ligne')}</span><b>{enLigne}</b><span>{phrase('console.ecran.equipe.en_ligne_sous')}</span></div>
            <div className={`c-carte c-chiffre${sansCode ? ' c-chiffre-attention' : ''}`}><span>{titre('console.ecran.equipe.sans_code')}</span><b>{sansCode}</b><span>{phrase('console.ecran.equipe.sans_code_sous')}</span></div>
          </div>
          <section className="c-carte c-liste-carte" aria-label={titre('console.ecran.equipe.titre')}>
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
                          <div><span className="c-nom-ligne"><b data-donnee>{m.nom}</b>{m.moi ? <Puce ton="semaine">{dire('console.ecran.equipe.toi')}</Puce> : null}</span><span className="c-sous" data-donnee>{m.email}</span></div>
                        </div>
                      </td>
                      <td><Puce ton={m.role}>{titre(`console.ecran.role.${m.role}`)}</Puce></td>
                      <td>{m.code ? titre(`console.ecran.equipe.code.${m.code}`) : <Puce ton="en_retard">{dire('console.ecran.equipe.code.aucun')}</Puce>}</td>
                      <td>
                        {maj(m.derniereConnexion ? quand(m.derniereConnexion, moi.aujourdhui) : dire('console.ecran.temps.jamais'))}
                        {m.appareils.length ? <span className="c-sous">{titre('console.ecran.equipe.ouvert_sur', { appareils: m.appareils.map((a) => a.nom).join(', ') })}</span> : null}
                      </td>
                      <td className="c-droite">
                        {m.moi ? null : (
                          <span className="c-boutons-ligne">
                            <Bouton petit onClick={() => setGeste({ sorte: 'role', m })} etiquette={titre('console.ecran.equipe.changer_role_de', { nom: m.nom })}>{titre('console.ecran.equipe.changer_role')}</Bouton>
                            <Bouton petit ton="danger" onClick={() => setGeste({ sorte: 'retirer', m })} etiquette={titre('console.ecran.equipe.retirer_de', { nom: m.nom })}>{titre('console.ecran.equipe.retirer')}</Bouton>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="c-grille-2">
            <section className="c-carte" aria-labelledby="roles-titre">
              <div className="c-carte-tete"><h2 id="roles-titre">{titre('console.ecran.equipe.roles_titre')}</h2></div>
              <ul className="c-personnes c-roles">
                {ROLES.map((r) => (
                  <li key={r}><Puce ton={r}>{titre(`console.ecran.role.${r}`)}</Puce><span className="c-texte"><span>{phrase(`console.ecran.role_aide.${r}`)}</span></span></li>
                ))}
              </ul>
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
          </div>
        </>
      ) : null}
      {geste ? <FenetreEquipe g={geste} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
