import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'public',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
