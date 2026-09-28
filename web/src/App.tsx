// L'enchaînement des premiers écrans : se connecter (ou créer son compte), le code du téléphone,
// puis mes entreprises.
import { useState } from 'react';
import { session } from './api.ts';
import { Code } from './ecrans/Code.tsx';
import { Connexion, type Defi } from './ecrans/Connexion.tsx';
import { Entreprises } from './ecrans/Entreprises.tsx';
import { Inscription } from './ecrans/Inscription.tsx';

type Etat = { ecran: 'connexion' } | { ecran: 'inscription' } | { ecran: 'code'; defi: Defi } | { ecran: 'entreprises' };

export function App() {
  const [etat, setEtat] = useState<Etat>(session.jeton() ? { ecran: 'entreprises' } : { ecran: 'connexion' });
  const aller = (e: Etat) => () => setEtat(e);
  switch (etat.ecran) {
    case 'inscription': return <Inscription cree={aller({ ecran: 'connexion' })} connexion={aller({ ecran: 'connexion' })} />;
    case 'code': return <Code defi={etat.defi} connecte={aller({ ecran: 'entreprises' })} />;
    case 'entreprises': return <Entreprises deconnecte={aller({ ecran: 'connexion' })} />;
    default: return <Connexion connecte={aller({ ecran: 'entreprises' })} code={(defi) => setEtat({ ecran: 'code', defi })} inscription={aller({ ecran: 'inscription' })} />;
  }
}
