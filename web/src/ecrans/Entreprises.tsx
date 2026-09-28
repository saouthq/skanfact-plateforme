// Mes entreprises : celles où j'ai un rôle, marquées « essai » quand c'en est une. Sans aucune, le
// bouton principal crée une entreprise d'essai (déjà garnie de clients d'exemple). Quand le rôle
// exige le code du téléphone et qu'il n'est pas en place, c'est l'étape suivante, et la seule.
import { useCallback, useEffect, useRef, useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Aide } from '../composants/Aide.tsx';
import { Bouton } from '../composants/Bouton.tsx';
import { Page, Refus } from '../composants/Page.tsx';
import { dire, phrase, titre } from '../langue.ts';

type Entreprise = { id: string; raison_sociale: string; essai: boolean; roles: string[] };
type Moi = { nom: string; codeAConfigurer: boolean; entreprises: Entreprise[] };

export function Entreprises({ deconnecte }: { deconnecte: () => void }) {
  const [moi, setMoi] = useState<Moi | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [codePose, setCodePose] = useState<{ adresse: string | null; secours: string[] } | null>(null);

  // `deconnecte` change à chaque rendu du parent : on garde le dernier, sans recharger pour autant.
  const sortir = useRef(deconnecte);
  sortir.current = deconnecte;
  const charger = useCallback(async () => {
    try {
      const r = await appeler<Moi>('GET', '/moi');
      if (r.statut === 401) { session.fermer(); sortir.current(); return; }
      setMoi(r.corps);
    } catch (x) { setRefus(x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x)); }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  async function geste(f: () => Promise<void>) {
    setOccupe(true);
    setRefus(null);
    try { await f(); } catch (x) { setRefus(x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x)); } finally { setOccupe(false); }
  }
  const creerEssai = () => geste(async () => {
    const r = await appeler('POST', '/entreprises-essai');
    if (r.statut === 201) await charger(); else setRefus(r.corps.motif ?? null);
  });
  const poserCode = () => geste(async () => {
    const r = await appeler<{ codesDeSecours: string[]; adresseApplication: string | null }>('POST', '/moi/code', { methode: 'application' });
    if (r.statut === 200) setCodePose({ adresse: r.corps.adresseApplication, secours: r.corps.codesDeSecours }); else setRefus(r.corps.motif ?? null);
  });
  const deconnecter = () => geste(async () => { await appeler('POST', '/deconnexion').catch(() => undefined); session.fermer(); deconnecte(); });

  const haut = <Bouton onClick={deconnecter}>{titre('ecran.deconnexion')}</Bouton>;
  if (codePose) {
    return (
      <Page titre={titre('ecran.code_pose.titre')} haut={haut}>
        <p className="text-doux">{phrase('ecran.code_pose.application')}</p>
        {codePose.adresse ? <code className="block overflow-x-auto rounded-lg bg-fond p-3 text-sm break-all" data-donnee>{codePose.adresse}</code> : null}
        <p className="text-doux">{phrase('ecran.code_pose.secours')}</p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-donnee>{codePose.secours.map((c) => <li key={c} className="rounded bg-fond px-2 py-1">{c}</li>)}</ul>
        <Bouton principal onClick={() => { setCodePose(null); void charger(); }}>{titre('ecran.code_pose.bouton')}</Bouton>
      </Page>
    );
  }
  if (!moi) return <Page titre={titre('ecran.entreprises.titre')} haut={haut}><Refus texte={refus} /></Page>;
  if (moi.codeAConfigurer) {
    return (
      <Page titre={titre('ecran.code_requis.titre')} haut={haut}>
        <Refus texte={refus} />
        <p className="text-doux">{phrase('ecran.code_requis.aide')}</p>
        <Bouton principal occupe={occupe} onClick={poserCode}>{titre('ecran.code_requis.bouton')}</Bouton>
      </Page>
    );
  }
  return (
    <Page titre={titre('ecran.entreprises.titre')} haut={haut}>
      <Refus texte={refus} />
      {moi.entreprises.length === 0 ? (
        <>
          <p className="font-medium">{phrase('ecran.entreprises.aucune')}</p>
          <p className="text-doux">{phrase('ecran.entreprises.aucune_aide')}</p>
          <Bouton principal occupe={occupe} onClick={creerEssai}>{titre('ecran.entreprises.creer_essai')}</Bouton>
        </>
      ) : (
        <ul className="flex flex-col divide-y divide-trait">
          {moi.entreprises.map((e) => (
            <li key={e.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium break-words" data-donnee>{e.raison_sociale}</span>
                <span className="text-sm text-doux">{e.roles.map((r) => dire(`role.${r}`)).join(', ')}</span>
              </div>
              {e.essai ? (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="rounded-full bg-essai-fond px-2 py-0.5 text-xs font-semibold text-essai uppercase">{dire('ecran.entreprises.essai')}</span>
                  <Aide texte={phrase('ecran.entreprises.essai_aide')} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
