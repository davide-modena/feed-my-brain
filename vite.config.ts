import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'app',
  // Su GitHub Pages il sito vive in /feed-my-brain/ (impostato dal workflow).
  base: process.env.BASE_PATH || '/',
  envDir: '..',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // Le edizioni (api/*.json) sono gestite a runtime dal service worker, non precaricate.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
      manifest: {
        name: 'Feed My Brain',
        short_name: 'Feed My Brain',
        description: 'La tua dose quotidiana di attualità, storia e curiosità, con quiz per fissarla.',
        lang: 'it',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f6f1e6',
        theme_color: '#f6f1e6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
});
