// « Connecter ma boutique » (brique 133 ; docs/boutique.md, B0) : un partenaire déclaré (SkanEcom) a envoyé la personne
// ici. Elle lit qui demande et pour faire quoi, choisit l'entreprise (une des siennes, propriétaire ou administratrice,
// jamais une entreprise d'essai) ou la crée si elle n'en a pas, et clique « Autoriser » : elle revient chez le
// partenaire, qui finit seul (il échange le code contre la clé). « Refuser » la ramène chez lui sans rien. Une demande
// d'un inconnu, ou vers une adresse qui n'est pas déclarée, ne mène nulle part : elle se dit, et SkanFact s'ouvre.
import { useEffect, useState } from 'react';
import { appeler, ErreurReseau } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Libelle } from '../composants/Info.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

export type DemandeConnexion = { partenaire: string; retour: string; etat: string };
export type EntrepriseDeMoi = { id: string; raison_sociale: string; essai: boolean; roles: string[]; parCabinet: boolean };
// (Une entreprise vue par un mandat de cabinet n'y donne ni le rôle de propriétaire ni celui d'administrateur.)
type Info = { nom: string; gestes: { code: string; libelle: string }[] };

// Les entreprises que la personne peut relier : les siennes, où elle gère les clés de l'API, hors essai.
export const reliables = (liste: EntrepriseDeMoi[]) =>
  liste.filter((e) => !e.essai && e.roles.some((r) => r === 'proprietaire' || r === 'administrateur'));

// `partir` : quitter SkanFact pour le partenaire (la demande s'oublie, l'écran ne bouge plus) ; `fini` : rester dans SkanFact.
export function Connecter({ demande, entreprises, creee, partir, fini, deconnecte }: {
  demande: DemandeConnexion; entreprises: EntrepriseDeMoi[]; creee: () => void; partir: (adresse: string) => void; fini: () => void; deconnecte: () => void;
}) {
  const g = useGeste(deconnecte);
  const [info, setInfo] = useState<Info | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [choisie, setChoisie] = useState('');
  const [raison, setRaison] = useState('');
  const possibles = reliables(entreprises);
  const entreprise = possibles.find((e) => e.id === choisie) ?? possibles[0];

  useEffect(() => {
    void (async () => {
      try {
        const r = await appeler<Info>('GET', `/partenaires/${encodeURIComponent(demande.partenaire)}?retour=${encodeURIComponent(demande.retour)}`);
        if (r.statut === 200) setInfo(r.corps); else setRefus(refusDe(r).texte);
      } catch (x) { setRefus(phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur')); }
    })();
  }, [demande]);

  // Revenir chez le partenaire : avec le code (autorisé), ou avec le refus.
  const autoriser = () => g.geste(async () => {
    if (!entreprise) return;
    const r = await g.api<{ adresse: string }>('POST', `/entreprises/${entreprise.id}/partenaires/${encodeURIComponent(demande.partenaire)}/autoriser`,
      { retour: demande.retour, etat: demande.etat });
    if (!r) return;
    if (r.statut === 201) partir(r.corps.adresse); else g.refuser(refusDe(r));
  });
  const refuser = () => {
    const suite = new URLSearchParams({ erreur: 'refusee', etat: demande.etat });
    partir(`${demande.retour}${demande.retour.includes('?') ? '&' : '?'}${suite}`);
  };
  const creer = () => g.geste(async () => {
    const r = await g.api<{ id: string }>('POST', '/entreprises', { raisonSociale: raison.trim() });
    if (!r) return;
    if (r.statut === 201) { setChoisie(r.corps.id); creee(); } else g.refuser(refusDe(r));
  });

  if (refus !== null) {
    return (
      <Carte titre={titre('ecran.connecter.invalide_titre')} pied={<Bouton principal onClick={fini}>{titre('ecran.connecter.ouvrir_skanfact')}</Bouton>}>
        <p role="alert">{refus}</p>
      </Carte>
    );
  }
  if (!info) return null;
  // Aucune entreprise à relier : la créer d'abord (son nom suffit), puis autoriser.
  if (!entreprise) {
    return (
      <Carte titre={titre('ecran.connecter.titre', { partenaire: info.nom })} sous={phrase('ecran.connecter.creer_sous', { partenaire: info.nom })} onSubmit={() => { void creer(); }}
        pied={<>
          <Bouton onClick={refuser}>{titre('ecran.connecter.refuser')}</Bouton>
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.connecter.creer')}</Bouton>
        </>}>
        <div className="grid-2">
          <Champ classe="span-2" obligatoire libelle={titre('ecran.porte.raison')} aide={phrase('ecran.porte.raison_aide')} valeur={raison} changer={setRaison} {...g.sur('raisonSociale')} />
        </div>
      </Carte>
    );
  }
  return (
    <Carte titre={titre('ecran.connecter.titre', { partenaire: info.nom })} sous={phrase('ecran.connecter.sous', { partenaire: info.nom })}
      pied={<>
        <Bouton onClick={refuser}>{titre('ecran.connecter.refuser')}</Bouton>
        <Bouton principal occupe={g.occupe} onClick={() => { void autoriser(); }}>{titre('ecran.connecter.autoriser')}</Bouton>
      </>}>
      <p>{titre('ecran.connecter.pourra', { partenaire: info.nom })}</p>
      <ul className="connecter-gestes">{info.gestes.map((x) => <li key={x.code}>{x.libelle}</li>)}</ul>
      {possibles.length > 1
        ? <label className="field"><Libelle texte={titre('ecran.connecter.entreprise')} aide={phrase('ecran.connecter.entreprise_aide')} />
          <select value={entreprise.id} onChange={(e) => setChoisie(e.target.value)}>
            {possibles.map((e) => <option key={e.id} value={e.id}>{e.raison_sociale}</option>)}
          </select></label>
        : <p>{phrase('ecran.connecter.pour', { entreprise: entreprise.raison_sociale })}</p>}
      <p className="connecter-note">{phrase('ecran.connecter.rien_d_autre', { partenaire: info.nom })}</p>
    </Carte>
  );
}
