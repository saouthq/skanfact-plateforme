// La carte de l'entrée (lot entrée, 06/10/2026 ; docs/entree.md) : sur la page des étapes, un dessin, un titre et sa
// phrase, le contenu, le pied avec ses boutons (le principal d'abord), et une aide en bas si l'écran en a une. Elle sert
// au code du téléphone, au mot de passe oublié, au cabinet, à la demande d'un partenaire et à l'invitation refusée.
import type { ReactNode } from 'react';
import { Dessin, PageEtapes } from './Entree.tsx';

type Props = {
  titre: string; sous?: ReactNode; pied?: ReactNode; children?: ReactNode; onSubmit?: () => void;
  icone?: string; bandeau?: string | undefined; aide?: ReactNode; large?: boolean;
  etape?: 1 | 2 | 3 | undefined; cabinet?: boolean; droite?: ReactNode;
};

export function Carte({ titre, sous, pied, children, onSubmit, icone, bandeau, aide, large = false, etape, cabinet = false, droite }: Props) {
  const corps = (
    <>
      {children ? <div className="ent-carte-corps">{children}</div> : null}
      {pied ? <div className="ent-carte-pied">{pied}</div> : null}
      {aide ? <div className="ent-carte-aide">{aide}</div> : null}
    </>
  );
  return (
    <PageEtapes etape={etape} cabinet={cabinet} droite={droite} etroite>
      <section className={`ent-carte${large ? ' large' : ''}`}>
        {bandeau ? <span className="ent-bandeau"><Dessin id="coche" />{bandeau}</span> : null}
        {icone ? <span className="ent-carte-ico"><Dessin id={icone} /></span> : null}
        <div className="ent-entete"><h1>{titre}</h1>{sous ? <p className="ent-carte-sous">{sous}</p> : null}</div>
        {onSubmit ? <form noValidate className="ent-carte-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{corps}</form> : corps}
      </section>
    </PageEtapes>
  );
}
