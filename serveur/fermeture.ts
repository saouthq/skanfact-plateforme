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
import { motif } from '../textes/index.ts';
import './fermeture-textes.ts';

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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// La page que voit un client : ce que l'équipe a écrit, l'heure de la fin, et le lien vers la page d'état. Elle se
// recharge seule chaque minute : l'application revient d'elle-même.
export function pageFermee(f: NonNullable<Fermeture>, maintenant: Date): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Maintenance en cours — SkanFact</title>
<style>
  :root { color-scheme: light dark; --fond: #f6f8f7; --carte: #fff; --encre: #16302b; --doux: #5b6b67; --accent: #0f766e; }
  @media (prefers-color-scheme: dark) { :root { --fond: #0f1715; --carte: #17221f; --encre: #e6efec; --doux: #9fb3ad; --accent: #4fd1c5; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--fond); color: var(--encre);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 34rem; background: var(--carte); border-radius: 14px; padding: 28px 28px 22px; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
  h1 { margin: 0 0 6px; font-size: 1.35rem; } .fin { color: var(--accent); font-weight: 600; margin: 0 0 14px; }
  p { margin: 0 0 12px; } .doux { color: var(--doux); font-size: .9rem; } a { color: var(--accent); }
</style></head>
<body><main>
  <h1>Maintenance en cours</h1>
  <p class="fin">SkanFact revient vers ${esc(finDite(f.fin, maintenant))}.</p>
  <p data-texte>${esc(f.texte)}</p>
  <p class="doux">Tes données sont en sécurité : rien ne se perd pendant la maintenance. Cette page se recharge seule ; tu peux aussi suivre la <a href="/etat">page d'état</a>.</p>
</main></body></html>
`;
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
