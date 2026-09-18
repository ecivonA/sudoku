import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/sudoku/',

  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',

      includeAssets: ['icons/icon.svg', 'icons/icon-maskable.svg', 'icons/apple-touch-icon-180x180.png'],

      manifest: {
        name: 'Sudoku Helper',
        short_name: 'Sudoku',
        description: 'Sudoku-Eingabe- und Lösungs-Helfer mit Kandidaten, Hints und Merkern',
        start_url: '/sudoku/',
        scope: '/sudoku/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d1b2a',
        theme_color: '#0d1b2a',
        share_target: {
          action: '/sudoku/share-target/',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'image', accept: ['image/*'] }] },
        },
        screenshots: [
          { src: 'icons/screenshot.png', sizes: '540x720', type: 'image/png', form_factor: 'narrow' },
        ],
        icons: [
          { src: 'icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },

      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})