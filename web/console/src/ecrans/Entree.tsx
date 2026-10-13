// L'entrée de la console (docs/console.md ; serveur/console/connexion.ts) : le compte SkanFact, puis le code du téléphone
// à CHAQUE connexion (SMS ou application ; un code de secours le remplace, une fois). La vitrine sombre à gauche dit ce
// qu'est la console et ce qu'elle ne voit pas ; le formulaire, à droite, dit l'étape. Un refus se dit sous le formulaire,
// et montre son champ.
import { useEffect, useState, type FormEvent } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { appeler, nomDeCetAppareil, session } from '../api.ts';
import { panneDe, refusDe } from '../contexte.ts';
import { Alerte, Bouton, Champ, Icone, toast } from '../ui.tsx';

type Defi = { etat: 'code'; defi: string; appareil: string } & ({ methode: 'application' } | { methode: 'sms'; telephone: string; envoi: 'parti' | 'rate' | 'limite' });
type Faute = { champ: string; n: number } | null;
let n = 0;

function Vitrine() {
  const points = [
    { icone: 'personne', titre: 'console.ecran.entree.point_compte_titre', texte: 'console.ecran.entree.point_compte' },
    { icone: 'telephone', titre: 'console.ecran.entree.point_code_titre', texte: 'console.ecran.entree.point_code' },
    { icone: 'cache', titre: 'console.ecran.entree.point_dossiers_titre', texte: 'console.ecran.entree.point_dossiers' },
  ] as const;
  return (
    <section className="c-vitrine">
      <div className="c-marque">
        <span className="c-marque-s" aria-hidden="true">S</span>
        <span className="c-marque-nom"><b data-donnee>SkanFact</b><span className="c-marque-pilule">{dire('console.ecran.marque')}</span></span>
      </div>
      <h2>{titre('console.ecran.entree.vitrine_titre')}</h2>
      <p className="c-vitrine-sous">{phrase('console.ecran.entree.vitrine_sous')}</p>
      <ul className="c-points">
        {points.map((p) => (
          <li key={p.titre}>
            <span className="c-points-icone"><Icone nom={p.icone} /></span>
            <div><b>{titre(p.titre)}</b><span>{phrase(p.texte)}</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Entree({ message, entre }: { message: string | null; entre: () => void }) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [defi, setDefi] = useState<Defi | null>(null);
  const [code, setCode] = useState('');
  const [secours, setSecours] = useState(false);
  const [refus, setRefus] = useState<string | null>(message);
  const [faute, setFaute] = useState<Faute>(null);
  const [occupe, setOccupe] = useState(false);
  const [renvoi, setRenvoi] = useState(0);

  // Le SMS se renvoie au plus toutes les 30 secondes (la base le tient aussi).
  useEffect(() => {
    if (renvoi <= 0) return;
    const t = setTimeout(() => setRenvoi((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoi]);

  const refuser = (texte: string, champ: string | null = null) => { setRefus(texte); setFaute(champ ? { champ, n: ++n } : null); };
  const geste = async (f: () => Promise<void>) => {
    setOccupe(true);
    setRefus(null);
    try { await f(); } catch (x) { refuser(panneDe(x)); } finally { setOccupe(false); }
  };

  const seConnecter = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !motDePasse) { refuser(phrase('console.ecran.entree.manque'), email.trim() ? 'motDePasse' : 'email'); return; }
    void geste(async () => {
      const appareil = session.appareil();
      const r = await appeler<Defi | { etat: 'connecte'; jeton: string; appareil: string }>('POST', '/console/connexion',
        { email: email.trim(), motDePasse, appareil: { nom: nomDeCetAppareil(), type: 'navigateur', ...(appareil ? { id: appareil } : {}) } });
      // Le serveur nomme le champ quand c'est lui (le mot de passe) ; sans code du téléphone en place, aucun champ n'est faux.
      if (r.statut !== 200) { refuser(refusDe(r), r.corps.champ === 'motDePasse' ? 'motDePasse' : null); return; }
      session.retenirAppareil(r.corps.appareil);
      if (r.corps.etat === 'connecte') { session.ouvrir(r.corps.jeton); entre(); return; }
      setDefi(r.corps);
      setCode('');
      setSecours(false);
      if (r.corps.methode === 'sms') setRenvoi(30);
    });
  };

  const valider = (e: FormEvent) => {
    e.preventDefault();
    if (!defi) return;
    if (!code.trim()) { refuser(phrase('console.ecran.code.manque'), 'code'); return; }
    void geste(async () => {
      const r = await appeler<{ etat: string; jeton: string; appareil: string }>('POST', '/console/connexion/code', { defi: defi.defi, code: code.replace(/\s+/g, '') });
      if (r.statut !== 200 || r.corps.etat !== 'connecte') { refuser(refusDe(r), 'code'); return; }
      session.retenirAppareil(r.corps.appareil);
      session.ouvrir(r.corps.jeton);
      entre();
    });
  };

  const renvoyer = () => void geste(async () => {
    if (!defi) return;
    const r = await appeler('POST', '/console/connexion/code/renvoyer', { defi: defi.defi });
    if (r.statut === 202) { toast(phrase('console.ecran.code.renvoye')); setRenvoi(30); } else refuser(refusDe(r));
  });

  const recommencer = () => { setDefi(null); setCode(''); setRefus(null); setFaute(null); setMotDePasse(''); };
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });

  return (
    <main className="c-entree">
      <Vitrine />
      <section className="c-forme">
        <div className="c-forme-tete">
          <span className="c-etape">{titre('console.ecran.entree.etape', { n: defi ? 2 : 1 })}</span>
          <span className="c-hote"><Icone nom="cadenas" taille={16} /><span data-donnee>{location.host}</span></span>
        </div>
        {defi ? (
          <form className="c-forme-corps" onSubmit={valider} noValidate>
            <h1>{titre(secours ? 'console.ecran.code.champ_secours' : 'console.ecran.code.titre')}</h1>
            <p className="c-forme-sous">
              {secours ? phrase('console.ecran.code.secours_sous')
                : defi.methode === 'sms' ? <>{phrase('console.ecran.code.sous_sms', { telephone: defi.telephone })}</>
                  : phrase('console.ecran.code.sous_application')}
            </p>
            {defi.methode === 'sms' && !secours && defi.envoi !== 'parti'
              ? <Alerte ton="attention">{phrase(defi.envoi === 'limite' ? 'console.ecran.code.sms_limite' : 'console.ecran.code.sms_rate')}</Alerte> : null}
            <Champ classe={secours ? '' : 'c-code'} libelle={titre(secours ? 'console.ecran.code.champ_secours' : 'console.ecran.code.champ')} valeur={code} changer={setCode}
              autoComplete="one-time-code" inputMode={secours ? 'text' : 'numeric'} premier {...sur('code')} />
            {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
            <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre('console.ecran.code.valider')}</Bouton>
            <div className="c-forme-liens">
              {defi.methode === 'sms' && !secours
                ? <Bouton ton="discret" petit desactive={renvoi > 0} onClick={renvoyer}>{renvoi > 0 ? titre('console.ecran.code.renvoyer_dans', { n: renvoi }) : titre('console.ecran.code.renvoyer')}</Bouton>
                : null}
              <Bouton ton="discret" petit onClick={() => { setSecours(!secours); setCode(''); setRefus(null); }}>
                {titre(secours ? 'console.ecran.code.retour_code' : 'console.ecran.code.secours')}
              </Bouton>
              <Bouton ton="discret" petit onClick={recommencer}>{titre('console.ecran.code.recommencer')}</Bouton>
            </div>
          </form>
        ) : (
          <form className="c-forme-corps" onSubmit={seConnecter} noValidate>
            <h1>{titre('console.ecran.entree.titre')}</h1>
            <p className="c-forme-sous">{phrase('console.ecran.entree.sous')}</p>
            <div className="c-champs">
              <Champ libelle={titre('console.ecran.entree.email')} type="email" autoComplete="username" inputMode="email" valeur={email} changer={setEmail} premier {...sur('email')} />
              <Champ libelle={titre('console.ecran.entree.mot_de_passe')} type="password" autoComplete="current-password" revelable valeur={motDePasse} changer={setMotDePasse} {...sur('motDePasse')} />
            </div>
            {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
            <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre('console.ecran.entree.continuer')}</Bouton>
            <p className="c-forme-note">{phrase('console.ecran.entree.note')}</p>
          </form>
        )}
      </section>
    </main>
  );
}
