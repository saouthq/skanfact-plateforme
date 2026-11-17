// (1.379.3 ; Skander, 17/11/2026) Ce qui n'est pas encore branché en production ne se propose pas comme prêt : la
// caisse et la facture électronique (El Fatoora) portent une pastille « À venir », et leurs écrans ne s'ouvrent pas.
// Le code reste entier ; c'est un réglage du serveur qui les rouvre, sans nouvelle version :
//   SKANFACT_A_VENIR=""            tout est ouvert (les tests tournent ainsi) ;
//   SKANFACT_A_VENIR="efacture"    la caisse ouverte, la facture électronique encore à venir ;
//   (absent)                       les deux à venir — le choix de la production d'aujourd'hui.
export const A_VENIR_CONNUS = ['caisse', 'efacture'];

export function aVenir(env: Record<string, string | undefined> = process.env): string[] {
  const v = env.SKANFACT_A_VENIR;
  return (v === undefined ? A_VENIR_CONNUS.join(',') : v).split(',').map((x) => x.trim()).filter((x) => A_VENIR_CONNUS.includes(x));
}
