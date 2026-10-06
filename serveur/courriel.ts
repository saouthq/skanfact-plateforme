// L'envoi d'un e-mail par le serveur (lot entrée, 06/10/2026 ; docs/entree.md). Aujourd'hui, un seul : le lien du mot
// de passe oublié. Le serveur parle à un relais SMTP (SKANFACT_SMTP, de l'environnement du serveur : jamais du dépôt) ;
// sans relais, rien ne part, et l'écran ne propose pas ce qu'il ne peut pas faire.
//
// Ce qui part chez le relais, compté et décidé (règle du projet) : l'adresse de la personne, l'objet et le texte du
// message, qui ne porte que le lien. Ni son nom, ni son entreprise, ni rien de ses données.

import nodemailer from 'nodemailer';

export type Courriel = { a: string; objet: string; texte: string };
export type EnvoiCourriel = { envoyer: (c: Courriel) => Promise<void> };

// Le relais SMTP : smtp://utilisateur:mot-de-passe@hote:587 (STARTTLS exigé), ou smtps://…:465.
export function courrielSmtp(adresse: string, de: string): EnvoiCourriel {
  const u = new URL(adresse);
  const transport = nodemailer.createTransport({
    host: u.hostname, port: Number(u.port || (u.protocol === 'smtps:' ? 465 : 587)), secure: u.protocol === 'smtps:',
    requireTLS: u.protocol === 'smtp:',
    ...(u.username ? { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } } : {}),
  });
  return { envoyer: async (c) => { await transport.sendMail({ from: de, to: c.a, subject: c.objet, text: c.texte }); } };
}
