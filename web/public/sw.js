// Le service des écrans (brique 72 ; docs/hors-ligne.md, H1). Il garde une copie des ÉCRANS de
// l'application (pages, scripts, styles, icônes) pour qu'elle s'ouvre sans réseau — jamais des
// données : l'API (/v1) ne passe jamais par lui ; les données du poste, c'est le point de contact
// qui les garde, chiffrées (plateforme/poste.js).
// Réseau d'abord : en ligne, la dernière version, gardée au passage ; sans réseau, celle gardée.
'use strict';
const CACHE = 'skanfact-ecrans-1';
// Les pages d'entrée, et tout ce qu'elles chargent, se gardent dès l'installation.
const ENTREES = ['/', '/v10/', '/v10/cabinet/'];

const pasPourMoi = (u) => u.origin !== self.location.origin || u.pathname === '/v1' || u.pathname.startsWith('/v1/');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const page of ENTREES) {
      try {
        const r = await fetch(page, { cache: 'no-cache' });
        if (!r.ok) continue;
        const html = await r.clone().text();
        await c.put(page, r);
        const base = new URL(page, self.location.origin);
        const liens = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => new URL(m[1], base)).filter((u) => !pasPourMoi(u));
        await Promise.all(liens.map(async (u) => {
          try { const x = await fetch(u.pathname, { cache: 'no-cache' }); if (x.ok) await c.put(u.pathname, x); } catch { /* gardé à la prochaine visite */ }
        }));
      } catch { /* sans réseau à l'installation : la page se gardera à sa première visite */ }
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
  // Une page se garde sous son chemin, sans ce qui suit « ? » : l'entreprise ouverte change, la page non.
  const cle = e.request.mode === 'navigate' ? u.pathname : u.pathname + u.search;
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok) await (await caches.open(CACHE)).put(cle, r.clone());
      return r;
    } catch (err) {
      const garde = (await caches.match(cle)) || (e.request.mode === 'navigate' ? await caches.match('/') : undefined);
      if (garde) return garde;
      throw err;
    }
  })());
});
