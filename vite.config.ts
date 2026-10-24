import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
