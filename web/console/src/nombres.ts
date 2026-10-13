// Les nombres de la console : une espace fine entre les milliers (« 12 480 »), une virgule pour les décimales (« 0,03 »),
// une espace fine insécable avant le signe pour cent (« 99,91 % »). Un nombre se dit, il ne se recalcule pas : les parts
// et les centiles arrivent du serveur ; l'écran ne fait que les écrire.
import { dire } from './langue.ts';

const FINE = ' ';
const milliers = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, FINE);

export const entier = (n: number) => `${n < 0 ? '−' : ''}${milliers(String(Math.round(Math.abs(n))))}`;

export function decimal(x: number, chiffres: number): string {
  const [e = '0', d = ''] = Math.abs(x).toFixed(chiffres).split('.');
  return `${x < 0 ? '−' : ''}${milliers(e)}${d ? `,${d}` : ''}`;
}

// Une part (0,0003) en pour cent, sans jamais l'arrondir vers ce qu'elle n'est pas : une part non nulle ne se dit pas
// « 0 % », une part qui n'est pas entière ne se dit pas « 100 % » (une disponibilité de 99,996 % a connu une coupure).
export function pourCent(part: number, chiffres = 2): string {
  const p = part * 100;
  const pas = 10 ** -chiffres;
  if (p <= 0) return `0${FINE}%`;
  if (p >= 100) return `100${FINE}%`;
  if (p < pas) return `<${FINE}${decimal(pas, chiffres)}${FINE}%`;
  if (p > 100 - pas) return `>${FINE}${decimal(100 - pas, chiffres)}${FINE}%`;
  return `${decimal(p, chiffres)}${FINE}%`;
}

// Une durée mesurée, en millisecondes : « 120 ms », « 1,2 s ». Un temps de réponse se dit par la borne de son seau : au-delà
// de la dernière (une minute), il n'a pas de borne.
export function duree(ms: number): string {
  if (!Number.isFinite(ms)) return dire('console.ecran.service.duree.plus');
  if (ms < 1000) return dire('console.ecran.service.duree.ms', { n: entier(ms) });
  return dire('console.ecran.service.duree.s', { n: decimal(ms / 1000, ms % 1000 === 0 ? 0 : 1) });
}

// Une durée en minutes, pour une coupure ou un temps passé au-dessus d'un budget : « 38 min », « 2 h 15 », « 3 j 4 h ».
export function minutes(n: number): string {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return dire('console.ecran.service.duree.min', { n: m });
  const h = Math.floor(m / 60), reste = m % 60;
  if (h < 24) return reste ? dire('console.ecran.service.duree.h_min', { h, m: String(reste).padStart(2, '0') }) : dire('console.ecran.service.duree.h', { h });
  const j = Math.floor(h / 24), hj = h % 24;
  return hj ? dire('console.ecran.service.duree.j_h', { j, h: hj }) : dire('console.ecran.service.duree.j', { j });
}
