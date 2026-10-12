// Les e-mails habillés du serveur (12/10/2026 ; serveur/courriel.ts, courriel.html). La version HTML dit EXACTEMENT
// le texte, paragraphe par paragraphe : le code en grand et en deux groupes, le lien en bouton qui nomme son geste.
// Elle n'ajoute que la marque et un pied fixes : aucune image ni rien de chargé à distance (on ne trace personne),
// aucune donnée de plus que le texte, et ses phrases viennent du catalogue, dans la langue du message.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocsDuTexte, habiller, messageSmtp, MODELES, type Courriel } from '../../serveur/courriel.ts';
import '../../serveur/messagerie/textes.ts';
import { factice, rendre, t, texteFrancais } from '../../textes/index.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const CONTACT = 'https://skanfact.tn/contact.html';
const LIEN = 'https://app.exemple.tn/?reinitialiser=Abc_123-x';

// Les huit e-mails du serveur, tels que les envois les rendent (les valeurs sont des exemples).
const VALEURS = { code: '482915', minutes: 30, lien: LIEN, adresse: 'https://app.exemple.tn', aide: CONTACT };
const ENVOIS: { cle: string; bouton?: string }[] = [
  { cle: 'connexion.oubli_texte', bouton: 'connexion.oubli_bouton' },
  { cle: 'connexion.courriel_inscription' },
  { cle: 'connexion.courriel_appareil' },
  { cle: 'compte.code_retire_texte', bouton: 'compte.code_retire_bouton' },
  { cle: 'compte.adresse_texte' },
  { cle: 'compte.adresse_changee_texte', bouton: 'compte.adresse_changee_bouton' },
  { cle: 'messagerie.alerte.entreprise', bouton: 'messagerie.alerte.bouton' },
  { cle: 'messagerie.alerte.cabinet', bouton: 'messagerie.alerte.bouton' },
];
const courriel = (e: (typeof ENVOIS)[number]): Courriel => ({
  a: 'karim@exemple.tn', objet: 'Objet', texte: rendre(t(e.cle, VALEURS), 'fr'),
  ...(e.bouton ? { bouton: rendre(t(e.bouton), 'fr') } : {}), langue: 'fr',
});

// Ce qu'un lecteur VOIT d'un HTML : sans le <head>, sans balises, entités et espaces rendus comme à l'écran.
const visible = (html: string) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<div style="display:none[^"]*">[\s\S]*?<\/div>/, '')
  .replace(/<br>/g, '\n').replace(/<\/?a\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const aplatir = (s: string) => s.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('les e-mails habillés', () => {
  it('chaque e-mail dit son texte paragraphe par paragraphe, dans l\'ordre ; le code en deux groupes, le lien en bouton qui nomme son geste', () => {
    for (const e of ENVOIS) {
      const c = courriel(e);
      const html = habiller(c);
      const vu = visible(html);
      let depuis = 0;
      for (const b of blocsDuTexte(c.texte)) {
        if (b.genre === 'signature') continue;
        const attendu = b.genre === 'code' ? '482 915' : b.genre === 'lien' ? (c.bouton ?? 'Ouvrir le lien') : aplatir(b.texte);
        const ou = vu.indexOf(attendu, depuis);
        expect(ou, `${e.cle} : « ${attendu} »`).toBeGreaterThanOrEqual(0);
        depuis = ou + attendu.length;
      }
      // Rien n'est resté à remplir, et le pied est là.
      expect(html, e.cle).not.toContain('{{');
      expect(vu, e.cle).toContain(rendre(t('courriel.pied_marque'), 'fr'));
    }
    const code = habiller(courriel(ENVOIS[1] ?? { cle: '' }));
    expect(code).toMatch(/<div class="sf-code"[^>]*>482&nbsp;915<\/div>/);
    // Le code n'est écrit qu'une fois : dans son bloc, jamais aussi dans un paragraphe.
    expect(code.match(/482/g)).toHaveLength(1);
    const oubli = habiller(courriel(ENVOIS[0] ?? { cle: '' }));
    expect(oubli).toMatch(/<td class="sf-bouton"[^>]*><a href="https:\/\/app\.exemple\.tn\/\?reinitialiser=Abc_123-x"[^>]*>Choisir mon nouveau mot de passe<\/a>/);
    // Le lien de secours, sous le bouton, pour qui ne peut pas cliquer.
    expect(visible(oubli)).toContain(`Le bouton ne s'ouvre pas ? Copie ce lien dans ton navigateur : ${LIEN}`);
    // Sans bouton nommé, le lien garde un libellé qui dit ce qu'il fait.
    expect(habiller({ a: 'karim@exemple.tn', objet: 'Objet', texte: rendre(t('connexion.oubli_texte', VALEURS), 'fr') })).toContain('>Ouvrir le lien</a>');
  });

  it('la signature disparaît (la marque est en tête), ce qui suit le code ou le lien passe en discret, et l\'aperçu n\'est pas « Bonjour, »', () => {
    const c = courriel(ENVOIS[0] ?? { cle: '' });
    const html = habiller(c);
    expect(visible(html).startsWith('S SkanFact Bonjour,')).toBe(true);
    expect(html).not.toMatch(/>SkanFact<\/p>/);
    expect(html).toMatch(/<p class="sf-txt sf-gris"[^>]*>Si ce n'est pas toi, ne fais rien\u202f: ton mot de passe reste le même\.<\/p>/);
    expect(html).toMatch(/<p class="sf-txt"[^>]*>Bonjour,<\/p>/);
    expect(html).toMatch(/<div style="display:none[^"]*">Quelqu'un, sans doute toi, a demandé/);
  });

  it('la ponctuation double prend l\'espace fine insécable : « ? » ou « : » ne tombe jamais seul en début de ligne', () => {
    const html = habiller(courriel(ENVOIS[1] ?? { cle: '' }));
    expect(html).toContain('Ce n\'est pas toi\u202f? Ne fais rien\u202f:');
    expect(html.replace(/<head>[\s\S]*?<\/head>/, '')).not.toMatch(/ [?:!;»]|« /);
  });

  it('rien de chargé à distance, aucune adresse de plus : seuls les liens du texte et la page de contact', () => {
    for (const e of ENVOIS) {
      const c = courriel(e);
      const html = habiller(c);
      expect(html, e.cle).not.toMatch(/<img|<link|<script|<iframe|\bsrc=|url\(|@import|background-image/i);
      const liens = new Set(blocsDuTexte(c.texte).filter((b) => b.genre === 'lien').map((b) => b.texte));
      for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(liens.has(href ?? '') || href === CONTACT, `${e.cle} : ${href}`).toBe(true);
      // L'adresse de la personne part dans l'enveloppe, jamais dans le message.
      expect(html, e.cle).not.toContain(c.a);
    }
  });

  it('ce que le texte porte est échappé : un libellé ou un objet ne devient jamais du HTML', () => {
    const html = habiller({ a: 'x@exemple.tn', objet: 'Objet <i>', texte: 'Bonjour,\n\n<b>gras</b> "><script>alert(1)</script> & co\n\nhttps://app.exemple.tn/?a="><x', bouton: '<em>Ouvrir</em>' });
    expect(html).not.toMatch(/<b>|<script|<em>|<i>|"><x/);
    expect(html).toContain('&lt;b&gt;gras&lt;/b&gt; &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).toContain('<title>Objet &lt;i&gt;</title>');
    expect(html).toContain('&lt;em&gt;Ouvrir&lt;/em&gt;');
  });

  it('le message SMTP : l\'expéditeur s\'appelle SkanFact, le texte part tel quel, et sa version habillée à côté', () => {
    const c = courriel(ENVOIS[0] ?? { cle: '' });
    const m = messageSmtp(c, 'ne-pas-repondre@send.skanfact.tn');
    expect(m).toEqual({ from: { name: 'SkanFact', address: 'ne-pas-repondre@send.skanfact.tn' }, to: c.a, subject: c.objet, text: c.texte, html: habiller(c) });
  });

  it('les phrases du pied et des boutons viennent du catalogue, dans la langue du message', () => {
    const c: Courriel = { a: 'karim@exemple.tn', objet: 'Objet', texte: rendre(t('connexion.oubli_texte', VALEURS), 'factice'), langue: 'factice' };
    const vu = visible(habiller(c));
    for (const cle of ['courriel.pied_marque', 'courriel.lien_secours', 'courriel.bouton']) expect(vu, cle).toContain(aplatir(rendre(t(cle), 'factice')));
    expect(vu).toContain(aplatir(rendre(t('courriel.pied_reponses', { site: 'skanfact.tn' }), 'factice')));
    expect(vu).not.toContain('la caisse et la comptabilité');
    expect(factice(texteFrancais('courriel.pied_marque') ?? '')).not.toBe(texteFrancais('courriel.pied_marque'));
  });

  it('la mise en page n\'a aucune phrase : courriel.html porte des sections et des valeurs, le catalogue porte le français', () => {
    expect([...MODELES.keys()].sort()).toEqual(['apres', 'code', 'lien', 'page', 'site', 'texte']);
    const source = fs.readFileSync(path.join(RACINE, 'serveur/courriel.html'), 'utf8');
    const textes = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n')
      .replace(/\{\{[a-z_]+\}\}/g, '\n').split('\n').map((s) => s.replace(/&nbsp;/g, ' ').trim()).filter(Boolean);
    expect(textes.filter((s) => /\p{L}{2,}[ ’']\p{L}{2,}/u.test(s))).toEqual([]);
    expect(textes.sort()).toEqual(['S', 'SkanFact', 'skanfact.tn']);
  });

  it('chaque envoi du serveur donne sa langue, et nomme son bouton dès que son texte porte un lien', () => {
    const appels: string[] = [];
    const lire = (dossier: string): string[] => fs.readdirSync(path.join(RACINE, dossier), { withFileTypes: true, recursive: true })
      .filter((f) => f.isFile() && f.name.endsWith('.ts')).map((f) => path.join(f.parentPath, f.name));
    for (const f of lire('serveur')) {
      const code = fs.readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\.envoi\.envoyer\(\{/g)) {
        let i = (m.index ?? 0) + m[0].length;
        let profondeur = 1;
        while (profondeur > 0 && i < code.length) { if (code[i] === '{') profondeur++; if (code[i] === '}') profondeur--; i++; }
        appels.push(`${path.relative(RACINE, f)}\n${code.slice(m.index, i)}`);
      }
    }
    expect(appels.length).toBeGreaterThanOrEqual(7);
    for (const appel of appels) {
      expect(appel, appel).toMatch(/\blangue\b/);
      const cles = [...appel.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((x) => x[1] ?? '').filter((k) => texteFrancais(k) !== undefined);
      const avecLien = cles.some((k) => /\n\n\{(?!code\})[a-z_]+\}(\n\n|$)/.test(texteFrancais(k) ?? ''));
      if (avecLien) expect(appel, appel).toMatch(/bouton: rendre\(t\('[a-z_.]+_?bouton'\)/);
    }
  });
});
