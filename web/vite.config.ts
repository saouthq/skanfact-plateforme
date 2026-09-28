// L'application web (12 § 4) : React, Tailwind. Construite dans dist/web, que le programme serveur
// sert à côté de l'API (même origine : pas de partage de ressources entre sites à ouvrir).
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // En développement, l'API tourne à côté (npm run serveur).
  server: { proxy: { '/v1': 'http://127.0.0.1:8080' } },
});
