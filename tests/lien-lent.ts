// Une connexion lente entre le navigateur et le serveur (brique 118 ; docs/leger.md). Un relais TCP qui retarde
// chaque paquet d'un demi aller-retour dans chaque sens, et partage UN débit descendant entre toutes les connexions
// (un navigateur en ouvre six : sans partage, il aurait six fois le débit). Il compte les octets reçus par le
// navigateur : tout ce qui passe par le fil, en-têtes compris, compressé ou non.
//
// Il note aussi chaque demande qui passe (13/10/2026) : son chemin, l'instant où le navigateur l'a posée, celui où il en
// a reçu le dernier octet. C'est ce qui dit si une demande a attendu la réponse d'une autre : sur une connexion lente,
// chaque attente de ce genre coûte un aller-retour entier.
//
// Le navigateur va à l'adresse du relais comme à celle du serveur : aucun réglage de mandataire.

import net from 'node:net';

// Des instants (Date.now()) ; `recue` vaut -1 tant que rien de la réponse n'est arrivé.
export type Demande = { chemin: string; posee: number; recue: number };
export type LienLent = { adresse: string; octets: () => number; demandes: () => Demande[]; remettre: () => void; fermer: () => Promise<void> };

// Le début d'une demande : une connexion n'en porte qu'une à la fois (un navigateur n'en pose pas une seconde sur la même
// connexion avant d'avoir la réponse de la première), donc ce qui revient ensuite est sa réponse.
const DEMANDE = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\S+) HTTP\//;

export async function lienLent(cible: string, debitOctetsParSeconde: number, allerRetourMs: number): Promise<LienLent> {
  const u = new URL(cible);
  const demi = allerRetourMs / 2;
  let octets = 0;
  let demandes: Demande[] = [];
  // L'instant où le fil descendant est libre : chaque paquet attend que le précédent soit passé.
  let libre = 0;
  const prises = new Set<net.Socket>();
  const relais = net.createServer((client) => {
    const serveur = net.connect(Number(u.port), u.hostname);
    prises.add(client); prises.add(serveur);
    let dernierMontant = 0, dernierDescendant = 0;
    let courante: Demande | null = null;
    client.on('data', (b) => {
      const chemin = DEMANDE.exec(b.subarray(0, 2048).toString('latin1'))?.[1];
      if (chemin) { courante = { chemin, posee: Date.now(), recue: -1 }; demandes.push(courante); }
      dernierMontant = Math.max(Date.now() + demi, dernierMontant);
      setTimeout(() => { if (!serveur.destroyed) serveur.write(b); }, dernierMontant - Date.now());
    });
    serveur.on('data', (b) => {
      octets += b.length;
      const debut = Math.max(Date.now(), libre);
      libre = debut + (b.length / debitOctetsParSeconde) * 1000;
      dernierDescendant = Math.max(libre + demi, dernierDescendant);
      if (courante) courante.recue = dernierDescendant;
      setTimeout(() => { if (!client.destroyed) client.write(b); }, dernierDescendant - Date.now());
    });
    client.on('end', () => setTimeout(() => serveur.end(), Math.max(0, dernierMontant - Date.now())));
    serveur.on('end', () => setTimeout(() => client.end(), Math.max(0, dernierDescendant - Date.now())));
    const fin = () => { client.destroy(); serveur.destroy(); prises.delete(client); prises.delete(serveur); };
    client.on('error', fin); serveur.on('error', fin); client.on('close', fin); serveur.on('close', fin);
  });
  await new Promise<void>((ok) => relais.listen(0, '127.0.0.1', ok));
  const { port } = relais.address() as net.AddressInfo;
  return {
    adresse: `http://127.0.0.1:${port}`,
    octets: () => octets,
    // Une copie : ce que le relais note ensuite ne change pas ce qu'on a déjà lu.
    demandes: () => demandes.map((d) => ({ ...d })),
    remettre: () => { octets = 0; demandes = []; },
    fermer: async () => {
      for (const p of prises) p.destroy();
      await new Promise<void>((ok) => relais.close(() => ok()));
    },
  };
}
