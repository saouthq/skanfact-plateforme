// L'envoi d'un e-mail par le serveur (lot entrée, 06/10/2026 ; docs/entree.md). Le serveur parle à un relais SMTP
// (SKANFACT_SMTP, de l'environnement du serveur : jamais du dépôt) ; sans relais, rien ne part, et l'écran ne propose pas
// ce qu'il ne peut pas faire.
//
// Ce qui part chez le relais, compté et décidé (règle du projet) : l'adresse de la personne, l'objet et le texte du
// message, qui ne porte que le code ou le lien. Ni son nom, ni son entreprise, ni rien de ses données. La version
// habillée (12/10/2026) dit EXACTEMENT le même texte : elle n'y ajoute que la marque et une ligne de pied, toutes deux
// fixes — et aucune image chargée à distance (on ne trace personne). Sa mise en page vit dans courriel.html, ses
// phrases au catalogue.

import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { rendre, t, type Langue } from '../textes/index.ts';

// `bouton` nomme ce que fait le lien du message, quand il en porte un (« Choisir mon nouveau mot de passe ») : un
// bouton dit ce que le clic fera, jamais « cliquez ici ». `langue` est celle du texte : la marque et le pied la suivent.
export type Courriel = { a: string; objet: string; texte: string; bouton?: string; langue?: Langue };
export type EnvoiCourriel = { envoyer: (c: Courriel) => Promise<void> };

// Les sections de courriel.html, lues une fois au chargement.
export const MODELES: ReadonlyMap<string, string> = (() => {
  const morceaux = fs.readFileSync(new URL('./courriel.html', import.meta.url), 'utf8').split(/<!--modele:([a-z_]+)-->/);
  const m = new Map<string, string>();
  for (let i = 1; i < morceaux.length; i += 2) m.set(morceaux[i] ?? '', (morceaux[i + 1] ?? '').trim());
  return m;
})();

// Une section, ses {{valeurs}} remplies. Une valeur que la section attend et qu'on ne lui donne pas est une faute du
// code : elle se dit au lieu de partir telle quelle chez quelqu'un.
function remplir(nom: string, valeurs: Record<string, string>): string {
  const modele = MODELES.get(nom);
  if (modele === undefined) throw new Error(`courriel.html n'a pas de section ${nom}`);
  return modele.replace(/\{\{([a-z_]+)\}\}/g, (_, cle: string) => {
    const v = valeurs[cle];
    if (v === undefined) throw new Error(`la section ${nom} de courriel.html attend ${cle}`);
    return v;
  });
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Les retours à la ligne d'un paragraphe restent des retours à la ligne ; la ponctuation double et l'intérieur des
// guillemets prennent l'espace fine insécable, sinon « ? » ou « : » peut tomber seul en début de ligne.
const ligne = (s: string) => echapper(s)
  .replace(/ ([:;!?»])/g, '\u202f$1').replace(/« /g, '«\u202f').replace(/\n/g, '<br>');

// Ce qu'un paragraphe EST : un code (six chiffres seuls), un lien (une adresse seule), la signature, ou du texte. Les
// textes du catalogue sont tous écrits ainsi : « Bonjour, », ce qui se passe, la ligne du code ou du lien, ce qu'il faut
// faire si ce n'est pas soi, « SkanFact ».
export type Bloc = { genre: 'texte' | 'code' | 'lien' | 'signature'; texte: string };
export function blocsDuTexte(texte: string): Bloc[] {
  return texte.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p): Bloc => {
    if (/^\d{6}$/.test(p)) return { genre: 'code', texte: p };
    if (/^https?:\/\/\S+$/.test(p)) return { genre: 'lien', texte: p };
    if (p === 'SkanFact') return { genre: 'signature', texte: p };
    return { genre: 'texte', texte: p };
  });
}

// Une phrase du catalogue qui porte un lien ({site}) : la phrase échappée, le lien posé à sa place.
const MARQUE = '\u0000';
function avecLien(texte: string, lien: string): string {
  const [avant = '', apres] = texte.split(MARQUE);
  return apres === undefined ? ligne(avant) : ligne(avant) + lien + ligne(apres);
}

// La version habillée d'un message : la même chose que le texte, mise en page. La signature « SkanFact » du texte
// disparaît : la marque est déjà en tête. Ce qui suit le code ou le lien (« Ce n'est pas toi ? ») passe en plus discret.
export function habiller(c: Courriel): string {
  const langue = c.langue ?? 'fr';
  const blocs = blocsDuTexte(c.texte);
  const action = blocs.findIndex((b) => b.genre === 'code' || b.genre === 'lien');
  // L'aperçu de la liste des messages : le premier paragraphe qui n'est pas la salutation (« Bonjour, »).
  const apercu = blocs.find((b, i) => b.genre === 'texte' && !(i === 0 && /,$/.test(b.texte)))?.texte ?? c.objet;
  const corps = blocs.map((b, i) => {
    if (b.genre === 'signature') return '';
    if (b.genre === 'code') return remplir('code', { debut: b.texte.slice(0, 3), fin: b.texte.slice(3) });
    if (b.genre === 'lien') {
      return remplir('lien', {
        href: echapper(b.texte),
        bouton: echapper(c.bouton ?? rendre(t('courriel.bouton'), langue)),
        secours: ligne(rendre(t('courriel.lien_secours'), langue)),
      });
    }
    return remplir(action >= 0 && i > action ? 'apres' : 'texte', { texte: ligne(b.texte) });
  }).join('\n');
  return remplir('page', {
    titre: echapper(c.objet),
    apercu: ligne(apercu),
    corps,
    pied_marque: ligne(rendre(t('courriel.pied_marque'), langue)),
    pied_reponses: avecLien(rendre(t('courriel.pied_reponses', { site: MARQUE }), langue), remplir('site', {})),
  });
}

// Ce qui part chez le relais : le texte tel quel, et sa version habillée. L'expéditeur porte le nom de la marque : une
// adresse nue (« ne-pas-repondre@… ») se lit comme un envoi qu'on ne connaît pas.
export function messageSmtp(c: Courriel, de: string) {
  return { from: { name: 'SkanFact', address: de }, to: c.a, subject: c.objet, text: c.texte, html: habiller(c) };
}

// Le relais SMTP : smtp://utilisateur:mot-de-passe@hote:587 (STARTTLS exigé), ou smtps://…:465.
export function courrielSmtp(adresse: string, de: string): EnvoiCourriel {
  const u = new URL(adresse);
  const transport = nodemailer.createTransport({
    host: u.hostname, port: Number(u.port || (u.protocol === 'smtps:' ? 465 : 587)), secure: u.protocol === 'smtps:',
    requireTLS: u.protocol === 'smtp:',
    ...(u.username ? { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } } : {}),
  });
  return { envoyer: async (c) => { await transport.sendMail(messageSmtp(c, de)); } };
}
