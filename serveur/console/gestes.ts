// Les gestes de la console et qui les fait (skanfact docs/cadrage/10-console.md § 1, 03 § 5 ; docs/console.md). Une
// troisième famille, à côté des gestes d'une entreprise et des gestes personnels : ils ne portent sur l'entreprise de
// personne, et se jouent dans une session de la console, jamais dans une session de l'application.
//
//   direction   tout : les clients, les abonnements, l'équipe, le journal, le service ;
//   support     « À décider », les clients, prolonger un essai (de 7 à 30 jours, une fois : la base le tient) ;
//   technique   le service seulement : aucune donnée de client.

import { texteConnu } from '../../textes/index.ts';
import './textes.ts';

export const ROLES_CONSOLE = ['direction', 'support', 'technique'] as const;
export type RoleConsole = (typeof ROLES_CONSOLE)[number];

export type GesteConsole = { code: string; roles: readonly RoleConsole[]; ecrit: boolean };

const D = 'direction', S = 'support', T = 'technique';

export const LISTE_GESTES_CONSOLE: GesteConsole[] = [
  // Qui je suis, se déconnecter : chacun.
  { code: 'console.session', roles: [D, S, T], ecrit: false },
  // L'accueil : le tableau du matin et « À décider », chacun selon son rôle (la technique n'y lit que le service).
  { code: 'console.accueil.voir', roles: [D, S, T], ecrit: false },
  { code: 'console.clients.voir', roles: [D, S], ecrit: false },
  { code: 'console.abonnement.prolonger', roles: [D, S], ecrit: true },
  { code: 'console.abonnement.gerer', roles: [D], ecrit: true },
  { code: 'console.journal.voir', roles: [D], ecrit: false },
  { code: 'console.equipe.voir', roles: [D], ecrit: false },
  { code: 'console.equipe.gerer', roles: [D], ecrit: true },
  { code: 'console.service.voir', roles: [D, T], ecrit: false },
];

export const GESTES_CONSOLE: ReadonlyMap<string, GesteConsole> = (() => {
  const m = new Map<string, GesteConsole>();
  for (const g of LISTE_GESTES_CONSOLE) {
    if (m.has(g.code)) throw new Error(`le geste ${g.code} est déclaré deux fois`);
    if (!/^console(\.[a-z_]+)+$/.test(g.code)) throw new Error(`nom de geste de la console invalide : ${g.code}`);
    if (!texteConnu(`geste.${g.code}`)) throw new Error(`le geste ${g.code} n'a pas son texte au catalogue (geste.${g.code})`);
    m.set(g.code, g);
  }
  return m;
})();

export const estRoleConsole = (r: unknown): r is RoleConsole => typeof r === 'string' && (ROLES_CONSOLE as readonly string[]).includes(r);
