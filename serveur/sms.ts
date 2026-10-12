// L'envoi d'un SMS par le serveur (le code de connexion au choix, décision de Skander du 12/10/2026 ; docs/entree.md) :
// WinSMS, fournisseur tunisien. La clé de l'API vient de l'environnement du serveur (SKANFACT_SMS_CLE), JAMAIS du dépôt ;
// `exploitation/sms.sh` la demande sans l'afficher.
//
// Ce qui part chez le fournisseur, compté et décidé (03 § 6) : le numéro et le texte du message, qui ne porte que le
// code. Ni le nom de la personne, ni son adresse, ni rien de ses données.
//
// À VÉRIFIER avec le compte réel : la forme exacte de la réponse de WinSMS n'est pas publiée. Un statut HTTP d'erreur, ou
// une réponse qui dit une erreur, compte comme un envoi raté ; le reste comme un envoi parti. `exploitation/sms.sh`
// envoie un SMS d'essai et montre la réponse brute à l'exploitant.

import type { EnvoiSms } from './connexion.ts';

export const WINSMS_PAR_DEFAUT = 'https://www.winsmspro.com/sms/sms/api';

// Un numéro de mobile tunisien, tapé comme on le tape : « 22 123 456 », « +216 22 123 456 », « 0021622123456 ».
// Rendu « +216XXXXXXXX », ou null. Les mobiles commencent par 2, 4, 5 ou 9 (À VÉRIFIER : les plans de numérotation
// changent ; un numéro étranger n'est pas encore accepté).
export function numeroTunisien(saisi: string): string | null {
  let chiffres = saisi.replace(/[\s.\-()]/g, '');
  if (chiffres.startsWith('+216')) chiffres = chiffres.slice(4);
  else if (chiffres.startsWith('00216')) chiffres = chiffres.slice(5);
  else if (chiffres.length === 11 && chiffres.startsWith('216')) chiffres = chiffres.slice(3);
  if (!/^[2459][0-9]{7}$/.test(chiffres)) return null;
  return `+216${chiffres}`;
}

// Le numéro tel qu'un écran le montre, sans le dire en entier : « +216 •• ••• 456 ».
export function numeroMasque(numero: string | null | undefined): string {
  const chiffres = String(numero ?? '').replace(/\D/g, '');
  const fin = chiffres.slice(-3);
  return fin.length === 3 ? `+216 \u2022\u2022 \u2022\u2022\u2022 ${fin}` : '';
}

// La réponse de WinSMS dit-elle une erreur ? (forme non publiée : À VÉRIFIER.)
export function reponseEnErreur(corps: string): boolean {
  const texte = corps.trim();
  try {
    const j = JSON.parse(texte) as Record<string, unknown>;
    if (j && typeof j === 'object') {
      const code = String(j.code ?? j.status ?? j.statut ?? '').toLowerCase();
      if (code && !['ok', '200', 'success', 'succes', 'sent'].includes(code)) return true;
      if (j.error || j.erreur) return true;
      return false;
    }
  } catch { /* pas du JSON : on lit le texte */ }
  return /error|erreur|invalid|insufficient|insuffisant|echec|échec|fail|refus/i.test(texte);
}

export function smsWinsms(options: { cle: string; expediteur?: string | null; adresse?: string; delaiMs?: number }): EnvoiSms {
  const adresse = options.adresse ?? WINSMS_PAR_DEFAUT;
  return {
    envoyer: async (telephone, texte) => {
      const numero = numeroTunisien(telephone);
      if (!numero) throw new Error(`numéro inutilisable pour un SMS (${numeroMasque(telephone) || 'vide'})`);
      // En POST et non dans l'adresse : la clé ne s'écrit dans aucun journal de proxy.
      const corps = new URLSearchParams({ action: 'send-sms', api_key: options.cle, to: numero.slice(1), sms: texte });
      if (options.expediteur) corps.set('from', options.expediteur);
      const r = await fetch(adresse, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps,
        signal: AbortSignal.timeout(options.delaiMs ?? 10_000),
      });
      const reponse = await r.text();
      // Le journal du serveur garde la réponse (raccourcie), jamais la clé ni le code.
      if (!r.ok || reponseEnErreur(reponse)) throw new Error(`WinSMS a refusé l'envoi (${r.status}) : ${reponse.slice(0, 200).replace(/\d{6}/g, '\u00b7'.repeat(6))}`);
    },
  };
}
