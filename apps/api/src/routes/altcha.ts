import { Hono } from 'hono';
import { altchaChallenge } from '../lib/altcha';
import type { AppEnv } from '../types';

// Challenges for the ALTCHA widget in the web and the solver in the app
export const altchaRoutes = new Hono<AppEnv>().get('/', async (c) => {
  c.header('cache-control', 'no-store');
  return c.json(await altchaChallenge(c.get('db')));
});
