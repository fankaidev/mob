import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  build: {
    minify: false,
    rollupOptions: {
      input: './src/client/index.tsx',
      output: {
        entryFileNames: 'client.js',
        chunkFileNames: 'client.js',
        assetFileNames: 'client.css',
        dir: 'public/static',
      },
    },
    emptyOutDir: true,
  },
})
