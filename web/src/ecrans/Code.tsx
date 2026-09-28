// Le code du téléphone, après le mot de passe.
import { useState, type FormEvent } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Page } from '../composants/Page.tsx';
import { phrase, titre } from '../langue.ts';
import type { Defi } from './Connexion.tsx';

export function Code({ defi, connecte }: { defi: Defi; connecte: () => void }) {
  const [code, setCode] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setOccupe(true);
    try {
      const r = await appeler<{ etat: string; jeton?: string }>('POST', '/connexion/code', { defi: defi.defi, code: code.replace(/\s/g, ''), posteDUnAutre: defi.posteDUnAutre });
      if (r.corps.etat === 'connecte' && r.corps.jeton) { session.ouvrir(r.corps.jeton); connecte(); } else setRefus(r.corps.motif ?? null);
    } catch (x) {
      setRefus(x instanceof ErreurReseau ? phrase('ecran.erreur_reseau') : String(x));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <Page titre={titre('ecran.code.titre')}>
      <p className="text-doux">{phrase(defi.methode === 'sms' ? 'ecran.code.sms' : 'ecran.code.application')}</p>
      <form onSubmit={envoyer} className="flex flex-col gap-3" noValidate>
        <Champ libelle={titre('ecran.code.champ')} aide={phrase('ecran.code.champ_aide')} valeur={code} changer={setCode} autoComplete="one-time-code" inputMode="numeric" refus={refus} />
        <Bouton principal type="submit" occupe={occupe}>{titre('ecran.code.bouton')}</Bouton>
      </form>
    </Page>
  );
}
