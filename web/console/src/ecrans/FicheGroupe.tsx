// La fiche d'un groupe (serveur/console/routes.ts, GET /console/groupes/:id ; 0110 ; la maquette Fiche, « Groupe … ») :
// ses sociétés comme la liste les dit, la plus urgente d'abord, chacune avec son numéro, sa ville, son abonnement et ce
// qui va se passer ; ce que le groupe rapporte par an et son usage du mois ; à qui parler. Chaque société garde SA fiche
// (son abonnement, sa facture, son journal) : la fiche du groupe y mène, elle ne la remplace pas. Le menu « … » porte les
// gestes de chaque société, nommée.
import { useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { puceDe } from '../abonnement.ts';
import { useConsole, useLecture, useRelireQuandOnRegarde } from '../contexte.ts';
import { montant } from '../argent.ts';
import { jourCourt, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Icone, Lien, maj, MenuLigne, Puce, Vide } from '../ui.tsx';
import { actionsDe, ligneEnMots, type Ligne } from './Clients.tsx';
import { GesteDuMenu, type Geste } from './Fiche.tsx';
import { Demander } from './AccesDossier.tsx';
import { contexteDe, EcrireAuContact, NoterAppel, resultatEnMots, type Contexte, type ResultatAppel } from './Echanges.tsx';

type Societe = Ligne & { telephone: string | null; dernierAppel: { le: string; resultat: ResultatAppel; qui: string | null } | null };
type Groupe = {
  aujourdhui: string; id: string; numero: string | null; nom: string; ville: string | null;
  parAnHt: string | null; attenduHt: string | null; usage: number; vu: string | null; societes: Societe[];
};
const K = 'console.ecran.groupe';

export function FicheGroupe({ id }: { id: string }) {
  const { moi, relireDecisions } = useConsole();
  const [l, relire] = useLecture<Groupe>(`/console/groupes/${encodeURIComponent(id)}`, `groupe:${id}`);
  const [geste, setGeste] = useState<{ id: string; geste: Geste } | null>(null);
  const [acces, setAcces] = useState<{ id: string; nom: string } | null>(null);
  const [appel, setAppel] = useState<{ id: string; nom: string } | null>(null);
  const [ecrire, setEcrire] = useState<{ client: { id: string; nom: string }; contexte: Contexte } | null>(null);
  useRelireQuandOnRegarde(relire, { attendre: () => geste !== null || acces !== null || appel !== null || ecrire !== null });
  if (l.etat === 'lecture') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  if (l.etat === 'panne') {
    return (
      <>
        <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}><a href="#/clients">{titre('console.ecran.fiche.retour')}</a></nav>
        {l.statut === 404 ? (
          <section className="c-carte c-liste-carte">
            <Vide icone="chercher"><span>{phrase(`${K}.introuvable`)}</span> <Lien href="#/clients" petit>{titre('console.ecran.fiche.vers_liste')}</Lien></Vide>
          </section>
        ) : <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>}
      </>
    );
  }
  const g = l.donnees;
  const premiere = g.societes[0] ?? null;
  // La puce du groupe : l'état de sa société la plus urgente, et combien la partagent (« 1 sur 2 : en retard »).
  const puce = premiere ? puceDe(premiere.etat) : null;
  const memeEtat = premiere ? g.societes.filter((s) => s.etat.etat === premiere.etat.etat).length : 0;
  const textePuce = puce ? (memeEtat === g.societes.length ? puce.texte : dire(`${K}.puce`, { n: memeEtat, total: g.societes.length, etat: puce.texte })) : '';
  // À qui parler : la propriétaire de la société la plus urgente (la même personne, le plus souvent, pour tout le groupe).
  const contact = g.societes.find((s) => s.proprietaire) ?? null;
  const dernier = g.societes.map((s) => s.dernierAppel).filter((x): x is NonNullable<Societe['dernierAppel']> => !!x).sort((a, b) => b.le.localeCompare(a.le))[0] ?? null;
  const faireDuMenu = (x: Societe) => ({
    geste: (ge: Geste) => setGeste({ id: x.id, geste: ge }), acces: () => setAcces({ id: x.id, nom: x.raisonSociale }),
    appel: () => setAppel({ id: x.id, nom: x.raisonSociale }), ecrire: () => setEcrire({ client: { id: x.id, nom: x.raisonSociale }, contexte: contexteDe(x.etat.etat, x.etat.etat === 'lecture_seule' ? x.etat.raison : undefined) }),
  });
  // Le menu porte les gestes de chaque société, sous son nom (une section par société).
  const actions = g.societes.flatMap((x) => actionsDe(x, moi.role, faireDuMenu(x)).map((a) => ({ ...a, section: x.raisonSociale })));
  const reserve = moi.role === 'direction' ? null : phrase('console.ecran.clients.m.reserve');
  const membres = g.societes.reduce((n, s) => n + s.membres, 0);

  return (
    <>
      <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}>
        <a href="#/clients">{titre('console.ecran.fiche.retour')}</a><Icone nom="droite" taille={14} /><span data-donnee>{g.nom}</span>
      </nav>
      <header className="c-entete">
        <div className="c-entete-texte">
          <div className="c-titre-ligne"><h1 data-donnee>{g.nom}</h1>{puce ? <Puce ton={puce.ton}>{textePuce}</Puce> : null}</div>
          <p className="c-entete-sous">
            {maj(dire('console.ecran.clients.sorte.groupe', { n: g.societes.length }))}
            {g.ville ? <> · <span data-donnee>{g.ville}</span></> : null}
            {g.numero ? <> · <span className="c-mono" data-donnee>{g.numero}</span></> : null}
          </p>
        </div>
        <div className="c-entete-actions">
          {contact ? <Bouton onClick={() => faireDuMenu(contact).ecrire()}>{titre('console.ecran.fiche.ecrire_court')}</Bouton> : null}
          {actions.length ? <MenuLigne etiquette={titre('console.ecran.clients.menu', { nom: g.nom })} libelle={titre('console.ecran.fiche.gestes')} note={reserve} actions={actions} /> : null}
        </div>
      </header>

      <div className="c-grille-2">
        <div className="c-colonne">
          <section className="c-carte" aria-labelledby="groupe-societes">
            <div className="c-carte-tete">
              <div>
                <h2 id="groupe-societes">{titre(`${K}.ses_entreprises`)}</h2>
                <p className="c-carte-sous">{phrase(`${K}.ses_entreprises_sous`)}</p>
              </div>
            </div>
            <div className="c-groupe-societes">
              {g.societes.map((s) => {
                const p = puceDe(s.etat);
                const m = ligneEnMots(s, g.aujourdhui);
                return (
                  <div key={s.id} className={`c-fiche-ent c-fiche-ent-${s.etat.etat}`}>
                    <div className="c-fiche-ent-tete"><a href={`#/clients/${s.id}`}><b data-donnee>{s.raisonSociale}</b></a><Puce ton={p.ton}>{p.texte}</Puce></div>
                    <span className="c-fiche-ent-ids c-mono" data-donnee>
                      {[s.numero, s.matricule ? `MF ${s.matricule}` : null].filter(Boolean).join(' · ') || titre('console.ecran.fiche.sans_matricule')}
                    </span>
                    <span className="c-fiche-ent-offre" data-donnee>{maj(m.offre)}{m.precise ? ` · ${m.precise}` : ''}</span>
                    {m.remise ? <span className="c-cl-remise" data-donnee>{m.remise}</span> : null}
                    {s.echeance || m.phrase ? <span className={`c-fiche-ent-quand${m.alerte ? ' c-cl-proche' : ''}`} data-donnee>
                      {[s.echeance ? jourCourt(s.echeance) : null, m.phrase].filter(Boolean).join(' · ')}</span> : null}
                    <span className="c-fiche-puces">
                      {s.ville ? <span className="c-fiche-puce" data-donnee>{s.ville}</span> : null}
                      <span className="c-fiche-puce">{maj(selon(s.enPlus.piecesMois, `${K}.pieces_mois`))}</span>
                      <span className="c-fiche-puce">{maj(selon(s.membres, `${K}.membres`))}</span>
                    </span>
                    <a href={`#/clients/${s.id}`} className="c-fiche-vers">{titre(`${K}.ouvrir_fiche`)}</a>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="c-carte" aria-labelledby="groupe-comptes">
            <div className="c-carte-tete"><h2 id="groupe-comptes">{titre(`${K}.comptes`)}</h2></div>
            <div className="c-chiffres c-fiche-chiffres">
              <div className="c-chiffre"><span>{titre(g.parAnHt || !g.attenduHt ? `${K}.c.par_an` : `${K}.c.attendu`)}</span>
                {g.parAnHt || g.attenduHt ? <b className="c-mono" data-donnee>{montant(g.parAnHt ?? g.attenduHt ?? '0')}</b> : <b className="c-cl-rien">—</b>}
                <small>{dire(g.parAnHt ? `${K}.c.par_an_sous` : g.attenduHt ? `${K}.c.attendu_sous` : `${K}.c.rien_sous`)}</small></div>
              <div className="c-chiffre"><span>{titre(`${K}.c.pieces`)}</span><b>{g.usage}</b><small>{dire(`${K}.c.pieces_sous`)}</small></div>
              <div className="c-chiffre"><span>{titre(`${K}.c.membres`)}</span><b>{membres}</b><small>{dire(`${K}.c.membres_sous`)}</small></div>
              <div className="c-chiffre"><span>{titre(`${K}.c.vu`)}</span><b className="c-chiffre-texte">{g.vu ? maj(quand(g.vu, g.aujourdhui)) : maj(dire('console.ecran.temps.jamais'))}</b>
                <small>{dire(`${K}.c.vu_sous`)}</small></div>
            </div>
          </section>
        </div>

        <div className="c-colonne">
          <section className="c-carte" aria-labelledby="groupe-parler">
            <div className="c-carte-tete"><h2 id="groupe-parler">{titre('console.ecran.fiche.a_qui_parler')}</h2></div>
            {contact?.proprietaire ? (
              <ul className="c-personnes">
                <li className="c-fiche-parler">
                  <Avatar nom={contact.proprietaire.nom} />
                  <div className="c-texte">
                    <b data-donnee>{contact.proprietaire.nom}</b>
                    <span>{titre(`${K}.proprietaire`, { nom: contact.raisonSociale })}</span>
                    {contact.telephone ? <span className="c-mono c-fiche-tel" data-donnee>{contact.telephone}</span> : null}
                    <a href={`mailto:${contact.proprietaire.email}`} data-donnee>{contact.proprietaire.email}</a>
                  </div>
                </li>
              </ul>
            ) : <p className="c-attente">{phrase('console.ecran.fiche.sans_proprietaire')}</p>}
            {contact ? (
              <div className="c-fiche-parler-gestes">
                <Bouton petit onClick={() => faireDuMenu(contact).appel()}>{titre('console.ecran.echanges.appel.ouvrir')}</Bouton>
                {contact.membres > 0 ? <Bouton petit onClick={() => faireDuMenu(contact).ecrire()}>{titre('console.ecran.fiche.ecrire_court')}</Bouton> : null}
              </div>
            ) : null}
            <p className="c-fiche-dernier">{dernier
              ? phrase('console.ecran.echanges.dernier', { quand: quand(dernier.le, g.aujourdhui), qui: dernier.qui ?? '—', resultat: resultatEnMots(dernier.resultat) })
              : phrase('console.ecran.echanges.aucun')}</p>
          </section>
        </div>
      </div>

      {geste ? <GesteDuMenu id={geste.id} geste={geste.geste} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); relireDecisions(); }} /> : null}
      {acces ? <Demander client={acces} demande={null} fermer={() => setAcces(null)} fait={() => setAcces(null)} /> : null}
      {appel ? <NoterAppel client={appel} fermer={() => setAppel(null)} fait={() => { setAppel(null); relire(); }} /> : null}
      {ecrire ? <EcrireAuContact client={ecrire.client} contexte={ecrire.contexte} fermer={() => setEcrire(null)} fait={() => setEcrire(null)} /> : null}
    </>
  );
}
