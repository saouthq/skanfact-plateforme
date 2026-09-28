// La carte d'accueil de la v10 (`#setup`, `.setup-card`) : la marque, un titre et sa phrase, le
// contenu, et le pied avec ses boutons. La v10 s'en sert pour la bienvenue et les premières
// questions ; la plateforme, en plus, pour se connecter, créer son compte et le code du téléphone.
import type { ReactNode } from 'react';

type Props = { titre: string; sous?: string; porte?: boolean; pied?: ReactNode; children: ReactNode; onSubmit?: () => void };

export function Carte({ titre, sous, porte = false, pied, children, onSubmit }: Props) {
  const corps = (
    <>
      <div className="setup-body">{children}</div>
      {pied ? <div className="setup-foot">{pied}</div> : null}
    </>
  );
  return (
    <div id="setup">
      <div className={`setup-card${porte ? ' porte' : ''}`}>
        <div className="setup-head">
          <div className="brand-mark" aria-hidden="true"><span data-donnee>SF</span></div>
          <div><h1 className="setup-t">{titre}</h1>{sous ? <div className="setup-s">{sous}</div> : null}</div>
        </div>
        {onSubmit ? <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{corps}</form> : corps}
      </div>
    </div>
  );
}
