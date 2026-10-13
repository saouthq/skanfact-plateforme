// Les montants de la console. Le serveur les rend en texte exact (« 1158.000 », moteur/argent.ts) : ils s'écrivent ici
// « 1 158,000 DT », trois décimales toujours (une colonne de montants s'aligne au millime), une espace fine entre les
// milliers, une insécable avant la devise. Jamais un calcul : un montant se dit, il ne se refait pas.
export function montant(t: string): string {
  const [e = '0', d = ''] = t.trim().split('.');
  const signe = e.startsWith('-') ? '\u2212' : '';
  const entier = e.replace(/^-/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${signe}${entier},${d.padEnd(3, '0').slice(0, 3)}\u00a0DT`;
}
