import { APP_NAME, messages, pickLocale } from '@app/shared';
import { type Context, Hono } from 'hono';
import { type PublicPage, publicPages } from '../lib/public-pages';
import type { AppEnv } from '../types';

// Public content for other people's agents, after llms.txt (https://llmstxt.org):
// /llms.txt lists the pages, /llms-full.txt holds all of them, every page is
// <path>.md as well. The web server forwards these paths here and answers
// Accept: text/markdown with the .md (hooks.server.ts). ?lang= picks the
// language, since agents rarely send Accept-Language.

const markdownPath = (path: string) => (path === '/' ? '/index.md' : `${path}.md`);

function language(c: Context<AppEnv>) {
  const lang = c.req.query('lang');
  const locale = pickLocale(lang ?? c.req.header('accept-language'));
  // Links keep an explicit ?lang= so an agent stays in its language
  return { locale, m: messages[locale], query: lang ? `?lang=${locale}` : '' };
}

const markdown = (page: PublicPage) =>
  [`# ${page.title}`, `> ${page.description}`, page.body].filter(Boolean).join('\n\n');

function text(c: Context<AppEnv>, body: string, type: string) {
  c.header('content-type', `${type}; charset=utf-8`);
  c.header('vary', 'accept, accept-language');
  return c.body(`${body}\n`);
}

export const agentRoutes = new Hono<AppEnv>()
  .get('/llms.txt', async (c) => {
    const { locale, m, query } = language(c);
    const url = process.env.APP_URL;
    const other = locale === 'de' ? 'en' : 'de';
    const pages = await publicPages(c.get('db'), m);
    return text(
      c,
      [
        `# ${APP_NAME}`,
        `> ${m.tagline}`,
        `${m.agentsIntro(`${url}/llms-full.txt${query}`)}\n\n${m.otherLanguage}: ${url}/llms.txt?lang=${other}`,
        `## ${m.agentsPages}`,
        pages
          .map((page) => `- [${page.title}](${url}${markdownPath(page.path)}${query}): ${page.description}`)
          .join('\n'),
      ].join('\n\n'),
      'text/plain',
    );
  })
  .get('/llms-full.txt', async (c) => {
    const { m } = language(c);
    const pages = await publicPages(c.get('db'), m);
    return text(c, pages.map(markdown).join('\n\n---\n\n'), 'text/plain');
  })
  .get('/:path{.+\\.md}', async (c) => {
    const { m } = language(c);
    const page = (await publicPages(c.get('db'), m)).find((p) => markdownPath(p.path) === c.req.path);
    if (!page) return c.json({ error: m.notFound }, 404);
    return text(c, markdown(page), 'text/markdown');
  });
