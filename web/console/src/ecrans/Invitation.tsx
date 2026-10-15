// Rejoindre l'équipe SkanFact par son lien (docs/console.md C41 ; serveur/console/invitations.ts ; 0118). Sans session :
// le lien dit d'abord qui invite, avec quel rôle et jusqu'à quand ; puis la personne rejoint avec son compte SkanFact (son
// mot de passe) ou le crée (son nom, un mot de passe). L'adresse est celle de l'invitation, jamais une autre. Le code du
// téléphone se pose ensuite, à sa première connexion à la console.
import { useEffect, useState, type FormEvent } from 'react';
import { LONGUEUR_MINIMALE } from '../../../../commun/compte.ts';
import { dire, phrase, titre } from '../langue.ts';
import { appeler } from '../api.ts';
import { panneDe, refusDe } from '../contexte.ts';
import { jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Champ, Icone } from '../ui.tsx';
import { Vitrine } from './Entree.tsx';

type Apercu = { valable: false } | { valable: true; email: string; role: 'direction' | 'support' | 'technique'; invitePar: string; expire: string; compte: boolean };
const K = 'console.ecran.invitation';
let n = 0;

export function Invitation({ jeton }: { jeton: string }) {
  const [a, setA] = useState<Apercu | 'lecture' | { panne: string }>('lecture');
  const [nom, setNom] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [fait, setFait] = useState<{ code: boolean } | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await appeler<Apercu>('POST', '/console/invitation/apercu', { jeton });
        setA(r.statut === 200 ? r.corps : { valable: false });
      } catch (x) { setA({ panne: panneDe(x) }); }
    })();
  }, [jeton]);

  const refuser = (texte: string, champ: string | null) => { setRefus(texte); setFaute(champ ? { champ, n: ++n } : null); };
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });
  const rejoindre = (e: FormEvent) => {
    e.preventDefault();
    if (typeof a !== 'object' || !('valable' in a) || !a.valable) return;
    if (!a.compte && !nom.trim()) { refuser(phrase(`${K}.nom_manque`), 'nom'); return; }
    if (!motDePasse) { refuser(phrase(a.compte ? `${K}.mdp_manque` : `${K}.nouveau_manque`), 'motDePasse'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await appeler<{ role: string; code: boolean }>('POST', '/console/invitation/accepter', { jeton, motDePasse, ...(a.compte ? {} : { nom: nom.trim() }) });
        if (r.statut === 200) { setFait({ code: r.corps.code }); return; }
        if (r.statut === 410) { setA({ valable: false }); return; }
        refuser(refusDe(r), r.corps.champ === 'nom' || r.corps.champ === 'motDePasse' ? r.corps.champ : null);
      } catch (x) { refuser(panneDe(x), null); } finally { setOccupe(false); }
    })();
  };

  const corps = () => {
    if (a === 'lecture') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
    if ('panne' in a) return <Alerte ton="danger">{a.panne}</Alerte>;
    if (!a.valable) {
      return (
        <div className="c-forme-corps">
          <h1>{titre(`${K}.perime_titre`)}</h1>
          <p className="c-forme-sous">{phrase(`${K}.perime`)}</p>
          <Bouton ton="principal" large fleche onClick={() => { location.hash = '#/'; }}>{titre(`${K}.vers_connexion`)}</Bouton>
        </div>
      );
    }
    if (fait) {
      return (
        <div className="c-forme-corps">
          <span className="c-inv-fait" aria-hidden="true"><Icone nom="ok" taille={22} /></span>
          <h1>{titre(`${K}.fait_titre`)}</h1>
          <p className="c-forme-sous">{phrase(fait.code ? `${K}.fait_code` : `${K}.fait_sans_code`)}</p>
          <Bouton ton="principal" large fleche onClick={() => { location.hash = `#/?adresse=${encodeURIComponent(a.email)}`; }}>{titre(`${K}.entrer`)}</Bouton>
        </div>
      );
    }
    return (
      <form className="c-forme-corps" onSubmit={rejoindre} noValidate>
        <h1>{titre(`${K}.titre`)}</h1>
        <p className="c-forme-sous">{phrase(`${K}.sous`, { qui: a.invitePar, role: dire(`console.ecran.role.${a.role}`), le: jourCourt(jourDe(a.expire)) })}</p>
        <dl className="c-inv-faits">
          <div><dt>{titre(`${K}.adresse`)}</dt><dd data-donnee>{a.email}</dd></div>
          <div><dt>{titre(`${K}.role`)}</dt><dd>{titre(`console.ecran.role.${a.role}`)}</dd></div>
        </dl>
        <div className="c-champs">
          {a.compte ? null : <Champ libelle={titre(`${K}.nom`)} aide={phrase(`${K}.nom_aide`)} autoComplete="name" valeur={nom} changer={setNom} premier {...sur('nom')} />}
          <Champ libelle={titre(a.compte ? `${K}.mdp` : `${K}.nouveau`)} aide={phrase(a.compte ? `${K}.mdp_aide` : `${K}.nouveau_aide`, { min: LONGUEUR_MINIMALE })}
            type="password" autoComplete={a.compte ? 'current-password' : 'new-password'} revelable valeur={motDePasse} changer={setMotDePasse}
            {...(a.compte ? { premier: true } : {})} {...sur('motDePasse')} />
        </div>
        {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
        <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre(a.compte ? `${K}.rejoindre` : `${K}.creer`)}</Bouton>
        <p className="c-forme-note">{phrase(`${K}.note`)}</p>
      </form>
    );
  };

  return (
    <main className="c-entree">
      <Vitrine />
      <section className="c-forme">
        <div className="c-forme-tete">
          <span className="c-etape">{titre(`${K}.etape`)}</span>
          <span className="c-hote"><Icone nom="cadenas" taille={16} /><span data-donnee>{location.host}</span></span>
        </div>
        {corps()}
      </section>
    </main>
  );
}
