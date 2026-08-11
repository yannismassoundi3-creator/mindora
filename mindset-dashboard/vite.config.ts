import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // Le manifeste est maintenu à la main dans public/manifest.json (déjà lié depuis
      // index.html). En laisser générer un second ici produisait deux <link rel="manifest">
      // concurrents, avec un nom différent et des icônes qui n'existaient pas.
      manifest: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        importScripts: ['/custom-sw.js'], // Script for handling Push notifications
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        // landing.html est une page statique hors de l'app React : le toast de mise à jour
        // n'y tourne pas, donc la précacher y figeait indéfiniment l'ancienne version.
        globIgnores: ['**/landing.html'],
        navigateFallbackDenylist: [/^\/landing\.html/]
      }
    })
  ],
  server: {
    port: 3001
  }
});
