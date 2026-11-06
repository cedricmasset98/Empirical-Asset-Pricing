import { defineConfig } from 'vite';

// base relative : le site fonctionne sous n'importe quel sous-chemin
// (username.github.io/Empirical-Asset-Pricing/, domaine personnalisé, preview locale).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
  },
});
