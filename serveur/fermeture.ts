// L'application fermée aux clients pendant une maintenance (1.107.0 ; base 0164 ; docs/console.md, C24 bis ;
// docs/mise-en-ligne.md, M). Quand la console ferme l'application, le serveur répond aux clients « Maintenance en cours »,
// avec l'heure de la fin : une page pour qui ouvre l'application, une réponse 503 pour chaque appel de l'API (rien n'est
// fait). Ce qui reste ouvert : la console de l'équipe (ses pages et son API), la documentation de l'API (la veille la
// demande chaque minute pour savoir si le programme répond), et les fichiers des écrans (scripts, styles, images : ils
// ne lisent ni n'écrivent rien ; la page de maintenance n'en a pas besoin).
//
// La fermeture se relit au plus toutes les cinq secondes (une requête par seconde ne coûte pas une lecture de la base) ;
// les gestes de la console l'oublient tout de suite. La base illisible : l'application reste ouverte (une panne de la
// lecture ne ferme personne dehors).

import type { FastifyInstance } from 'fastify';
import { enTantQue } from './base.ts';
import type { Contexte } from './connexion.ts';
import { motif, rendre, t, type Valeurs } from '../textes/index.ts';
import './fermeture/textes.ts';
import { assurance, assurances, basDeCarte, chiffres, encartHeure, encartMessage, pageAPart } from '../commun/page-a-part.ts';

export type Fermeture = { texte: string; fin: string } | null;
const RELIRE_MS = 5_000;
let gardee: { le: number; valeur: Fermeture } | null = null;
// Les gestes de la console (fermer, rouvrir) : la prochaine requête relit la base.
export const oublierLaFermeture = () => { gardee = null; };

// Ce qui reste ouvert pendant la fermeture.
export function resteOuvert(chemin: string): boolean {
  if (chemin === '/v1/console' || chemin.startsWith('/v1/console/') || chemin === '/v1/documentation') return true;
  if (chemin === '/console' || chemin.startsWith('/console/')) return true;
  if (chemin === '/v1' || chemin.startsWith('/v1/')) return false;
  // Un fichier des écrans (une extension autre que .html) ; une page (sans extension, ou .html) est fermée.
  const dernier = chemin.split('/').pop() ?? '';
  return /\.[a-z0-9]+$/i.test(dernier) && !/\.html?$/i.test(dernier);
}

// L'heure de la fin, à Tunis (« 14 h 30 »), et le jour s'il n'est pas aujourd'hui.
export function finDite(fin: string, maintenant: Date): string {
  const f = new Date(fin);
  const jour = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' });
  const [h, m] = f.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit', hour12: false }).split(':');
  const heure = `${Number(h)} h ${m}`;
  return jour(f) === jour(maintenant) ? heure : `${jour(f)} à ${heure}`;
}

// La page que voit un client (1.108.0, l'habit des pages à part : commun/page-a-part.ts) : l'heure du retour, ce que
// l'équipe a écrit, ce qui est sûr, et le lien vers la page d'état. Elle se recharge seule chaque minute : l'application
// revient d'elle-même. Aucun script (le programme n'en permet pas hors des écrans) ; les polices sont celles des écrans.
export function pageFermee(f: NonNullable<Fermeture>, maintenant: Date): string {
  const fin = finDite(f.fin, maintenant);
  const affichee = maintenant.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit', hour12: false });
  // Les phrases du catalogue (fermeture/textes.ts) sont les nôtres : sans balise ; ce qui vient d'ailleurs est échappé.
  const d = (cle: string, valeurs: Valeurs = {}) => rendre(t(`fermeture.page.${cle}`, valeurs), 'fr');
  return pageAPart({
    onglet: d('onglet'),
    polices: '/plateforme/polices/',
    rafraichir: 60,
    pastille: { texte: d('pastille'), ton: 'bleu', anime: true },
    titre: d('titre', { fin: chiffres(fin) }),
    chapo: d('chapo'),
    corps: [
      encartHeure(d('retour'), fin, d('tunis')),
      encartMessage(d('mot'), f.texte),
      assurances([assurance('bouclier', d('donnees'), d('donnees_dit')), assurance('refaire', d('envoi'), d('envoi_dit')), assurance('horloge', d('revient'), d('revient_dit'))]),
      basDeCarte(d('affichee', { heure: chiffres(affichee) }), { href: '/etat', texte: d('etat') }),
    ].join('\n'),
    vitrineBas: d('vitrine'),
  });
}

// Le branchement : à chaque requête, la fermeture en cours (gardée cinq secondes), et la réponse des clients s'il y en a une.
export function brancherFermeture(app: FastifyInstance, ctx: Contexte): void {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const lire = async (): Promise<Fermeture> => {
    const t = Date.now();
    if (gardee && t - gardee.le < RELIRE_MS) return gardee.valeur;
    let valeur: Fermeture;
    try {
      const v = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.application_fermee($1) v', [maintenant().toISOString()])).rows[0]?.v);
      valeur = v && typeof v.texte === 'string' && typeof v.fin === 'string' ? { texte: v.texte, fin: v.fin } : null;
    } catch { valeur = null; }
    gardee = { le: t, valeur };
    return valeur;
  };
  app.addHook('onRequest', async (requete, reponse) => {
    const chemin = new URL(requete.url, 'http://x').pathname;
    if (resteOuvert(chemin)) return;
    const f = await lire();
    if (!f) return;
    const t = maintenant();
    const attendre = Math.max(60, Math.round((Date.parse(f.fin) - t.getTime()) / 1000));
    reponse.code(503).header('retry-after', String(attendre)).header('cache-control', 'no-store');
    if (chemin === '/v1' || chemin.startsWith('/v1/')) {
      return reponse.send({ motif: motif('fermeture.motif', { fin: finDite(f.fin, t), texte: f.texte }), maintenance: { texte: f.texte, fin: f.fin } });
    }
    return reponse.header('content-type', 'text/html; charset=utf-8').send(pageFermee(f, t));
  });
}
