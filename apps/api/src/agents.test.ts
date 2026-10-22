import { afterAll, expect, test } from 'bun:test';
import { createDb } from '@app/db';
import { APP_NAME, messages } from '@app/shared';
import { createApp } from './app';
import { publicPages } from './lib/public-pages';

const db = createDb(process.env.DATABASE_URL);
const app = createApp(db);
afterAll(() => db.$client.end());

process.env.APP_URL = 'https://app.test';

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

test('llms.txt lists every public page as Markdown', async () => {
  const res = await get('/llms.txt');
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  const text = await res.text();
  expect(text).toStartWith(`# ${APP_NAME}\n\n> ${messages.de.tagline}`);
  expect(text).toContain('https://app.test/llms-full.txt');
  expect(text).toContain('https://app.test/llms.txt?lang=en');
  expect(text).toContain(`- [${APP_NAME}](https://app.test/index.md): ${messages.de.tagline}`);
});

test('the language follows ?lang= before Accept-Language, and links keep it', async () => {
  const text = await (await get('/llms.txt?lang=en', { 'accept-language': 'de' })).text();
  expect(text).toContain(messages.en.tagline);
  expect(text).toContain('https://app.test/index.md?lang=en');
  expect(await (await get('/index.md', { 'accept-language': 'en' })).text()).toContain(messages.en.tagline);
});

test('every page is Markdown at <path>.md, and llms-full.txt holds all of them', async () => {
  const pages = await publicPages(db, messages.de);
  const full = await (await get('/llms-full.txt')).text();
  for (const page of pages) {
    const res = await get(page.path === '/' ? '/index.md' : `${page.path}.md`);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const markdown = await res.text();
    expect(markdown).toStartWith(`# ${page.title}\n\n> ${page.description}`);
    expect(full).toContain(markdown.trim());
  }
});

test('pages that are not public have no Markdown, and the API stays reachable', async () => {
  expect((await get('/dashboard.md')).status).toBe(404);
  expect((await get('/api/v1/auth/me.md')).status).toBe(404);
  expect(await (await get('/api/v1/auth/me')).json()).toEqual({ user: null });
});
