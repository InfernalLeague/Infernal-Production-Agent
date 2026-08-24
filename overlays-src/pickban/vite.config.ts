import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath, URL } from 'node:url'

// Overlay se v OBS načítá jako lokální soubor (file://). Chromium/CEF v OBS
// blokuje ES moduly (<script type="module">) přes CORS policy → bílá obrazovka.
// viteSingleFile zabalí JS + CSS + assety do jednoho self-contained index.html
// s klasickým inline <script>, takže žádné moduly ani externí soubory nejsou
// potřeba a build jde otevřít přímo v OBS browser source.
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    viteSingleFile(),
  ],
  base: './',
  preview: { port: 4174, strictPort: true },
  server:  { port: 5174, strictPort: true },
  build: {
    // Zainlinuj všechny assety (vč. loga) jako data URI — nutné pro file://.
    assetsInlineLimit: 100 * 1024 * 1024,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
