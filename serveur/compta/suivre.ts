// Ce qui, dans un enregistrement du dossier, change le plan comptable (docs/ecritures.md § 4, D3) :
// les comptes réglés (`chartAccounts`), les comptes auxiliaires (`auxiliaires`), un compte de
// trésorerie qui naît, disparaît ou change de nature (banque, caisse, par défaut), et, quand
// l'entreprise tient des comptes auxiliaires, un client ou un fournisseur qui naît, disparaît ou
// change de code.
// Tout le brouillard suit alors le plan ; une écriture validée garde ses comptes.

import { requetes, type Transaction } from '../base.ts';
import { aVraimentChange, estObjet, type ChangementLu } from '../v10/lecture.ts';

const champ = (o: unknown, k: string) => (estObjet(o) ? JSON.stringify(o[k] ?? null) : 'absent');
const neOuParti = (c: ChangementLu) => c.avant === null || c.apres === null;

export async function planChange(tx: Transaction, entreprise: string, changements: ChangementLu[]): Promise<boolean> {
  const vrais = changements.filter(aVraimentChange);
  if (vrais.some((c) => c.collection === '_racine' && (c.cle === 'chartAccounts' || c.cle === 'auxiliaires'))) return true;
  if (vrais.some((c) => c.collection === 'accounts' && (neOuParti(c) || champ(c.avant, 'kind') !== champ(c.apres, 'kind') || champ(c.avant, 'isDefault') !== champ(c.apres, 'isDefault')))) return true;
  const clients = vrais.filter((c) => (c.collection === 'clients' || c.collection === 'suppliers') && (neOuParti(c) || champ(c.avant, 'compteAux') !== champ(c.apres, 'compteAux')));
  if (!clients.length) return false;
  // Les comptes auxiliaires sont-ils tenus ? (un booléen à la racine du dossier)
  const aux = await requetes(tx).selectFrom('socle.dossier_v10').select('contenu')
    .where('entreprise', '=', entreprise).where('collection', '=', '_racine').where('cle', '=', 'auxiliaires').executeTakeFirst();
  return aux?.contenu === true;
}
