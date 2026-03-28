import { defineConfig } from 'vite';

export default defineConfig({
  base: '/v-pool/',
  root: '.',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
  },
});
