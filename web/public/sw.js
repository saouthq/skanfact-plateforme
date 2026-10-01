// Le service des écrans (brique 72 ; docs/hors-ligne.md, H1 ; brique 118, docs/leger.md). Il garde une copie des
// ÉCRANS de l'application (pages, scripts, styles, icônes) pour qu'elle s'ouvre sans réseau — jamais des données :
// l'API (/v1) ne passe jamais par lui ; les données du poste, c'est le point de contact qui les garde, chiffrées
// (plateforme/poste.js).
// Réseau d'abord : en ligne, la dernière version, gardée au passage ; sans réseau, celle gardée. Sur une connexion
// lente, ce « réseau d'abord » ne coûte presque rien (brique 118) : chaque page porte l'empreinte de ses fichiers
// (« app.js?v=3f9c… »), que le navigateur garde un an sans redemander ; seule la page se revalide (une réponse vide si
// elle n'a pas changé).
'use strict';
const CACHE = 'skanfact-ecrans-2';
// À l'installation se gardent l'entrée (« / »), la page qui installe (l'entreprise, ou le Cabinet chez qui l'ouvre :
// jamais les deux, brique 118) et tout ce qu'elles chargent.
const ENTREES = ['/'];

const pasPourMoi = (u) => u.origin !== self.location.origin || u.pathname === '/v1' || u.pathname.startsWith('/v1/');

// Garder une page et ce qu'elle charge ; ce qui est déjà gardé à la même adresse ne repart pas ; l'ancienne version
// d'un fichier de la page s'efface.
async function ranger(c, page, html) {
  const base = new URL(page, self.location.origin);
  const liens = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => new URL(m[1], base)).filter((u) => !pasPourMoi(u));
  await Promise.all(liens.map(async (u) => {
    const cle = u.pathname + u.search;
    if (await c.match(cle)) return;
    try { const x = await fetch(cle); if (x.ok) await c.put(cle, x); } catch { /* gardé à la prochaine visite */ }
  }));
  const actuels = new Map(liens.map((u) => [u.pathname, u.search]));
  for (const r of await c.keys()) {
    const k = new URL(r.url);
    if (k.searchParams.has('v') && actuels.has(k.pathname) && actuels.get(k.pathname) !== k.search) await c.delete(r);
  }
}

async function garder(page) {
  const c = await caches.open(CACHE);
  const r = await fetch(page);
  if (!r.ok) return;
  const html = await r.clone().text();
  await c.put(page, r);
  await ranger(c, page, html);
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const pages = new Set(ENTREES);
    for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) {
      const u = new URL(c.url);
      if (!pasPourMoi(u)) pages.add(u.pathname);
    }
    for (const page of pages) {
      try { await garder(page); } catch { /* sans réseau à l'installation : la page se gardera à sa première visite */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || pasPourMoi(u)) return;
  const navigation = e.request.mode === 'navigate';
  // Une page se garde sous son chemin, sans ce qui suit « ? » : l'entreprise ouverte change, la page non.
  const cle = navigation ? u.pathname : u.pathname + u.search;
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok) {
        const c = await caches.open(CACHE);
        await c.put(cle, r.clone());
        // Une page reçue : ce qu'elle charge de neuf se garde, l'ancienne version s'efface (sans retarder la page).
        if (navigation) e.waitUntil(r.clone().text().then((html) => ranger(c, cle, html)).catch(() => undefined));
      }
      return r;
    } catch (err) {
      const garde = (await caches.match(cle)) || (navigation ? await caches.match('/') : undefined);
      if (garde) return garde;
      throw err;
    }
  })());
});
