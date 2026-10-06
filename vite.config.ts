import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    // `npm run dev:web` + `npm run dev:api`: Vite serves the UI, wrangler dev serves /api.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
