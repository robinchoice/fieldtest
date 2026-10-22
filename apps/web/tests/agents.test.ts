import { expect, test } from '@playwright/test';

// What other people's agents read, through the web server like in production
test('llms.txt links Markdown for pages that exist', async ({ request }) => {
  const text = await (await request.get('/llms.txt')).text();
  const links = [...text.matchAll(/\]\((http[^)]+\.md)\)/g)].flatMap((match) => match[1] ?? []);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const markdown = await request.get(link);
    expect(markdown.headers()['content-type']).toBe('text/markdown; charset=utf-8');
    const page = await request.get(link.replace(/\/index\.md$/, '/').replace(/\.md$/, ''));
    expect(page.status()).toBe(200);
  }
});

test('a page answers Accept: text/markdown with Markdown, else with HTML', async ({ request }) => {
  const markdown = await request.get('/', { headers: { accept: 'text/markdown, text/html;q=0.9' } });
  expect(markdown.headers()['content-type']).toBe('text/markdown; charset=utf-8');
  expect(await markdown.text()).toMatch(/^# /);
  const html = await request.get('/', { headers: { accept: 'text/html' } });
  expect(html.headers()['content-type']).toContain('text/html');
  // Pages without Markdown stay HTML for agents too
  const login = await request.get('/login', { headers: { accept: 'text/markdown, text/html;q=0.9' } });
  expect(login.headers()['content-type']).toContain('text/html');
});
