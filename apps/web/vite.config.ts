import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'API_INTERNAL_URL');
  return {
    plugins: [sveltekit()],
    // Vite finds these only when the first page runs hooks.client.ts and then reloads
    // every open page, which breaks browser tests on a cold dev server like in CI.
    optimizeDeps: { include: ['@sentry/browser'] },
    // In production hooks.server.ts forwards /api to the API service. API_INTERNAL_URL
    // moves the API in dev when another project holds port 3000.
    server: { proxy: { '/api': env.API_INTERNAL_URL || 'http://localhost:3000' } },
  };
});
