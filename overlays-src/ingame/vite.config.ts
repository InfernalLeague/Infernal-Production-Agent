import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Relativní base: overlay se servíruje z Infernal Production Agenta pod
  // podcestou /overlay/ingame (a v OBS i jako file://). Bez toho by absolutní
  // /assets/... cesty pod podcestou nefungovaly. Viz docs/ROADMAP.md, Fáze 0.
  base: './',
  plugins: [
    vue(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
