import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The engine lives outside the renderer root.
      ignored: ['**/src/engine/**', '**/src-tauri/**']
    }
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  }
})
