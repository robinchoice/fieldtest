import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // In production hooks.server.ts forwards /api to the API service
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
