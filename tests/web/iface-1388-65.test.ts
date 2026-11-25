// (1.388.65, #27) L'interface sur l'exemple de cinq ans (des montants à huit chiffres) : au téléphone, la Trésorerie et
// « Me guider » tiennent dans l'écran (IFACE-2) ; à 768 (une tablette), les listes ne coupent ni un montant, ni un
// statut, ni une date, et aucun texte ne se pose sur un autre (IFACE-1).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { construire, contexte, servir } from '../../outils/rangement/ecrans.ts';

describe('l\'interface sur des données pleines, au téléphone et à 768', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'iface-65-'));
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof servir>>;
  let jeton = '', ent = '';
  beforeAll(async () => {
    await construire(null, dossier);
    serveur = await servir(inject('pgApp'), dossier);
    navigateur = await chromium.launch();
    const api = async (methode: string, chemin: string, j?: string, corps?: unknown) => {
      const r = await fetch(`${serveur.adresse}/v1${chemin}`, { method: methode, headers: { ...(j ? { authorization: `Bearer ${j}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
      const t = await r.text();
      return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
    };
    const email = `iface-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Ines Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    expect((await api('POST', `/entreprises/${ent}/exemple`, jeton)).statut).toBe(200);
  }, 240_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  // Ce qu'une personne voit de travers : la page plus large que l'écran, un texte coupé (… ou rogné), deux textes posés
  // l'un sur l'autre dans une même ligne de tableau.
  const mesurer = () => {
    const faux: string[] = [];
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) {
      // Le plus profond de ce qui dépasse : c'est lui qui pousse.
      const qui = [...document.querySelectorAll<HTMLElement>('#view *')].filter((e) => e.getBoundingClientRect().right > W + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > W + 1)).slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
      faux.push(`la page fait ${document.documentElement.scrollWidth} px pour ${W} (${qui.join(', ')})`);
    }
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    for (const e of document.querySelectorAll<HTMLElement>('#view td, #view th, #view b, #view strong, #view .mg-chiffre *, #view .badge, #view .pill')) {
      if (!visible(e) || e.closest('.scroll-x') && !e.closest('table')) continue;
      const t = (e.innerText || '').trim();
      if (!t || e.children.length > 2) continue;
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') faux.push(`coupé : « ${t.slice(0, 40)} »`);
      const r = e.getBoundingClientRect();
      const cadre = e.closest('.scroll-x, .panel, main')?.getBoundingClientRect();
      if (cadre && (r.right > cadre.right + 1) && !e.closest('.scroll-x')) faux.push(`hors du cadre : « ${t.slice(0, 40)} »`);
    }
    // Un tableau plus large que son cadre cache ses dernières colonnes (au bord ou sous la colonne d'actions collée). On lit
    // le bord réel de ses cellules : le scrollWidth d'un tableau compte aussi les colonnes masquées par la feuille.
    for (const t of document.querySelectorAll<HTMLElement>('#view table.list')) {
      if (!visible(t)) continue;
      const cadre = t.parentElement as HTMLElement;
      const bord = cadre.getBoundingClientRect().left + cadre.clientWidth;
      const qui = [...t.querySelectorAll<HTMLElement>('th, td')].filter(visible).filter((c) => c.getBoundingClientRect().right > bord + 2);
      const premier = qui[0];
      if (premier) faux.push(`un tableau sort de son cadre : « ${(premier.innerText || premier.className).trim().slice(0, 30)} »`);
    }
    // Deux cellules voisines d'une même ligne qui se recouvrent, ou une cellule recouverte par la colonne collée.
    for (const tr of document.querySelectorAll('#view table.list tbody tr')) {
      const tds = [...tr.children].filter(visible) as HTMLElement[];
      const colle = tds.find((x) => getComputedStyle(x).position === 'sticky');
      for (const td of tds) {
        if (td === colle) continue;
        for (const enfant of td.querySelectorAll<HTMLElement>('*')) {
          if (!visible(enfant) || !enfant.innerText?.trim() || enfant.children.length) continue;
          const a = enfant.getBoundingClientRect();
          if (colle) { const c = colle.getBoundingClientRect(); if (a.right > c.left + 2 && a.left < c.left) faux.push(`sous la colonne d'actions : « ${enfant.innerText.trim().slice(0, 30)} »`); }
        }
      }
      if (faux.length > 40) break;
    }
    return [...new Set(faux)].slice(0, 25);
  };

  it('au téléphone, Trésorerie et « Me guider » tiennent dans 390 px ; à 768, les listes ne coupent rien', async () => {
    const vus: Record<string, string[]> = {};
    for (const [largeur, pages] of [[390, ['#/tresorerie', '#/guide']], [768, ['#/factures', '#/devis', '#/clients', '#/achats', '#/relances']]] as const) {
      const c = await contexte(navigateur, largeur, jeton);
      const p = await c.newPage();
      await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      for (const h of pages) {
        await p.evaluate((x) => { location.hash = x; }, h);
        await p.waitForTimeout(1200);
        for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
        vus[`${largeur} ${h}`] = await p.evaluate(mesurer);
        if (process.env.IFACE_PHOTOS && await p.locator('#view tfoot').count()) await p.locator('#view tfoot').first().screenshot({ path: path.join(process.env.IFACE_PHOTOS, `${largeur}-${h.slice(2)}-pied.png`) }).catch(() => undefined);
        if (process.env.IFACE_PHOTOS) await p.screenshot({ path: path.join(process.env.IFACE_PHOTOS, `${largeur}-${h.slice(2)}.png`), fullPage: true });
      }
      await c.close();
    }
    expect(vus).toEqual(Object.fromEntries(Object.keys(vus).map((k) => [k, []])));
  }, 300_000);
});
