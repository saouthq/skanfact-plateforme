// Fermer la coque de bureau d'un test sans l'attendre plus de 10 secondes : un programme qu'elle a lancé (le
// navigateur du poste, pour un lien vers ailleurs) peut la retenir (vu sur les machines de GitHub, le 05/10/2026).
import type { ElectronApplication } from 'playwright-core';

export async function fermerCoque(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const fermee = await Promise.race([app.close().then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 10_000))]);
  if (!fermee) app.process().kill('SIGKILL');
}
