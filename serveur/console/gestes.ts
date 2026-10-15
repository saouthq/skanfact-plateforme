// Les gestes de la console et qui les fait (skanfact docs/cadrage/10-console.md § 1, 03 § 5 ; docs/console.md). Une
// troisième famille, à côté des gestes d'une entreprise et des gestes personnels : ils ne portent sur l'entreprise de
// personne, et se jouent dans une session de la console, jamais dans une session de l'application.
//
//   direction   tout : les clients, les abonnements, les paiements, l'équipe, le journal, le service, les réglages ;
//   support     « À décider », les clients, prolonger un essai (de 7 à 30 jours, une fois : la base le tient), lire les
//               réglages, répondre aux demandes de support, lire ses propres gestes au journal ;
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
  // Offrir un mois (0113) : le support aussi, un par entreprise sur douze mois ; il va sur la prochaine facture.
  { code: 'console.abonnement.offrir_mois', roles: [D, S], ecrit: true },
  { code: 'console.abonnement.gerer', roles: [D], ecrit: true },
  // Le journal (0114) : la direction lit tout ; le support, ses propres gestes et ses accès aux dossiers (la base le tient).
  { code: 'console.journal.voir', roles: [D, S], ecrit: false },
  // Exporter la sélection du journal : la direction seule, avec son motif, au journal.
  { code: 'console.journal.exporter', roles: [D], ecrit: true },
  { code: 'console.equipe.voir', roles: [D], ecrit: false },
  { code: 'console.equipe.gerer', roles: [D], ecrit: true },
  { code: 'console.service.voir', roles: [D, T], ecrit: false },
  // Les alertes du service (les prendre en charge, les mettre en sourdine, demander une alerte d'essai à la veille) et ses
  // incidents (les ouvrir, les suivre, les clore avec leurs suites ; annoncer une maintenance).
  { code: 'console.service.gerer', roles: [D, T], ecrit: true },
  // Préparer la remise d'une entreprise (docs/console.md C14) : la direction seule, parce que l'écran nomme le client ; la
  // console compose les commandes, elle ne les exécute jamais.
  { code: 'console.service.remise', roles: [D], ecrit: true },
  // Les réglages de la plateforme (docs/console.md C28) : la grille des prix, le registre des règles communes, le message
  // aux clients. Le support les lit (pour répondre à un client sur un prix) ; la direction seule les change.
  { code: 'console.reglages.voir', roles: [D, S], ecrit: false },
  { code: 'console.reglages.gerer', roles: [D], ecrit: true },
  // Le support (docs/support.md) : lire les demandes des clients ; y répondre, noter une demande reçue ailleurs (un
  // e-mail, un message WhatsApp, un appel), clore et rouvrir. La technique ne lit aucune donnée de client.
  { code: 'console.support.voir', roles: [D, S], ecrit: false },
  { code: 'console.support.repondre', roles: [D, S], ecrit: true },
  // L'accès au dossier d'un client (Support S2, docs/support.md ; 0096) : le DEMANDER avec son motif, le rendre (« J'ai
  // fini »), et lire le dossier pendant qu'il court — en lecture seulement, ce que lit un membre « Lecture », chaque page
  // tracée. C'est l'entreprise qui l'accorde ; la console ne fait que le demander.
  { code: 'console.support.acces', roles: [D, S], ecrit: true },
  // Nos factures (docs/abonnement.md B2) : préparer la facture d'un abonnement dans le dossier de l'entreprise SkanFact. La
  // direction seule, et au nom d'une personne propriétaire de cette entreprise (la base le revérifie).
  { code: 'console.factures.preparer', roles: [D], ecrit: true },
  // Les paiements de nos factures et les coûts du mois (docs/console.md C30 ; 0108) : les comptes de SkanFact, la
  // direction seule. Un règlement se note dans l'application de SkanFact, sur sa facture ; ici, les coûts.
  { code: 'console.paiements.voir', roles: [D], ecrit: false },
  // La mesure (docs/console.md C39 ; 0116) : l'entonnoir, les départs, ce qu'on promet. Les comptes de SkanFact, comme
  // les paiements : la direction seule. Rien n'y est nommé.
  { code: 'console.mesure.voir', roles: [D], ecrit: false },
  // Nos factures (docs/console.md C31 ; 0109) : celles que l'entreprise SkanFact a émises, leur dépôt à la TTN, leur
  // paiement ; la direction seule. Elles s'émettent et se corrigent dans l'application de SkanFact.
  { code: 'console.factures.voir', roles: [D], ecrit: false },
  { code: 'console.paiements.couts', roles: [D], ecrit: true },
  // Exporter la sélection de la liste des clients (docs/console.md C32 ; 0110) : des données de personnes qui quittent la
  // console ; la direction seule, avec son motif, au journal.
  { code: 'console.clients.exporter', roles: [D], ecrit: true },
  { code: 'console.clients.appeler', roles: [D, S], ecrit: true },
  { code: 'console.clients.ecrire', roles: [D, S], ecrit: true },
  // La procédure de reprise d'une entreprise (docs/console.md C34 ; 0112) : changer de propriétaire sur pièces ; la
  // direction seule, et l'autre membre de la direction confirme.
  { code: 'console.clients.reprise', roles: [D], ecrit: true },
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
