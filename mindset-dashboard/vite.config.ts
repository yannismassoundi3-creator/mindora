import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate : le nouveau service worker prend la main dès qu'il est prêt, sans
      // attendre que tous les onglets soient fermés. Sans ça, un correctif pouvait rester
      // invisible pendant plusieurs sessions.
      registerType: 'autoUpdate',
      // Le manifeste est maintenu à la main dans public/manifest.json (déjà lié depuis
      // index.html). En laisser générer un second ici produisait deux <link rel="manifest">
      // concurrents, avec un nom différent et des icônes qui n'existaient pas.
      manifest: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        importScripts: ['/custom-sw.js'], // Script for handling Push notifications
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        // landing.html et legal.html sont des pages statiques hors de l'app React : le
        // toast de mise à jour n'y tourne pas, donc les précacher y figeait
        // indéfiniment l'ancienne version. Pour une page de CGU, servir une version
        // périmée n'est pas seulement gênant : ce n'est plus le bon contrat.
        globIgnores: ['**/landing.html', '**/legal.html'],
        // `/api/` n'est pas une route de l'application mais le chemin de l'API,
        // renvoyée vers Render par une réécriture Vercel. Les appels partent en
        // `fetch` et échappent donc déjà à ce repli, qui ne vise que les
        // navigations — mais une adresse d'API ouverte à la main répondrait 200
        // avec la coquille React, ce qui ne ressemble à rien.
        navigateFallbackDenylist: [/^\/landing\.html/, /^\/legal\.html/, /^\/api\//]
      }
    })
  ],
  server: {
    // Le port reste 3001 par défaut ; PORT permet d'en lancer une seconde instance
    // sans toucher au fichier (une copie du projet ouverte à côté, un outil externe).
    port: Number(process.env.PORT) || 3001
  }
});
