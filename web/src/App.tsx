// L'entrée de SkanFact. Sans session : se connecter (ou créer son compte), puis le code du téléphone.
// Avec une session : le code à mettre en place si le rôle l'exige, la porte de la première fois si
// aucune entreprise n'existe, sinon l'application v10 de l'entreprise (celle ouverte la dernière fois
// sur ce navigateur, sinon la première) : /v10/?e=<entreprise>.
import { useCallback, useEffect, useState } from 'react';
import { appeler, ErreurReseau, session } from './api.ts';
import { toast, Toast } from './composants/Toast.tsx';
import { Code } from './ecrans/Code.tsx';
import { CodeRequis } from './ecrans/CodeRequis.tsx';
import { Connexion, type Defi } from './ecrans/Connexion.tsx';
import { Inscription } from './ecrans/Inscription.tsx';
import { Porte } from './ecrans/Porte.tsx';
import { phrase } from './langue.ts';

type Accueil = { ecran: 'connexion' } | { ecran: 'inscription' } | { ecran: 'code'; defi: Defi } | { ecran: 'dedans' };
type Moi = { codeAConfigurer: boolean; entreprises: { id: string }[] };

const RETENUE = 'skanfact.entreprise';
// L'entreprise à ouvrir la prochaine fois (sur ce navigateur).
function retenir(id: string) {
  try { localStorage.setItem(RETENUE, id); } catch { /* sans stockage : la première entreprise la prochaine fois */ }
}
// Ouvrir l'application v10 d'une entreprise, et s'en souvenir.
export function ouvrirEntreprise(id: string) {
  retenir(id);
  location.assign(`/v10/?e=${encodeURIComponent(id)}`);
}

export function App() {
  const [accueil, setAccueil] = useState<Accueil>(session.jeton() ? { ecran: 'dedans' } : { ecran: 'connexion' });
  const [moi, setMoi] = useState<Moi | null>(null);

  const sortir = useCallback(async () => {
    await appeler('POST', '/deconnexion').catch(() => undefined);
    session.fermer();
    setMoi(null);
    setAccueil({ ecran: 'connexion' });
  }, []);

  const charger = useCallback(async () => {
    try {
      const r = await appeler<Moi>('GET', '/moi');
      if (r.statut === 401) { session.fermer(); setAccueil({ ecran: 'connexion' }); return; }
      setMoi(r.corps);
    } catch (x) {
      toast(phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), true);
    }
  }, []);
  useEffect(() => { if (accueil.ecran === 'dedans') void charger(); }, [accueil, charger]);

  // Une entreprise existe et le code est en place : l'application v10 s'ouvre.
  useEffect(() => {
    if (!moi || moi.codeAConfigurer || moi.entreprises.length === 0) return;
    let retenue: string | null = null;
    try { retenue = localStorage.getItem(RETENUE); } catch { /* pas de mémoire : la première */ }
    const e = moi.entreprises.find((x) => x.id === retenue) ?? moi.entreprises[0];
    if (e) ouvrirEntreprise(e.id);
  }, [moi]);

  const vers = (e: Accueil) => () => setAccueil(e);
  let ecran = null;
  switch (accueil.ecran) {
    case 'inscription': ecran = <Inscription cree={vers({ ecran: 'connexion' })} connexion={vers({ ecran: 'connexion' })} />; break;
    case 'code': ecran = <Code defi={accueil.defi} connecte={vers({ ecran: 'dedans' })} retour={vers({ ecran: 'connexion' })} />; break;
    case 'connexion': ecran = <Connexion connecte={vers({ ecran: 'dedans' })} code={(defi) => setAccueil({ ecran: 'code', defi })} inscription={vers({ ecran: 'inscription' })} />; break;
    default:
      if (moi?.codeAConfigurer) ecran = <CodeRequis pose={() => { void charger(); }} deconnecte={() => { void sortir(); }} />;
      // L'entreprise créée, on relit le compte : son rôle peut exiger le code du téléphone d'abord.
      else if (moi && moi.entreprises.length === 0) ecran = <Porte creee={(id) => { retenir(id); void charger(); }} deconnecte={() => { void sortir(); }} />;
  }
  return <>{ecran}<Toast /></>;
}
