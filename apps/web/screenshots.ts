// Photographs the live site into docs/screenshots after each deploy (see ci.yml),
// pleasance.org shows them. Only public pages: the CI has no login, so the
// pictures never show real user data. Add the prototype's core screens to PAGES.
// Run: bun run screenshots <url>, default the local dev server.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { type BrowserContextOptions, chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = new URL('../../docs/screenshots/', import.meta.url);

const PAGES: Record<string, string> = { home: '/', login: '/login' };
// Add 'en' when the English pictures show more than the same screens in another language
const LOCALES = ['de'];
const DEVICES: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  // Playwright only writes PNG and JPEG, Chromium's canvas encodes WebP
  const converter = await browser.newPage();
  const webp = async (png: Buffer) =>
    Buffer.from(
      await converter.evaluate(
        async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          return canvas.toDataURL('image/webp', 0.85).split(',')[1];
        },
        `data:image/png;base64,${png.toString('base64')}`,
      ),
      'base64',
    );

  for (const locale of LOCALES) {
    for (const [device, options] of Object.entries(DEVICES)) {
      const context = await browser.newContext({ ...options, locale, colorScheme: 'light' });
      // Screenshot visits don't count in PostHog
      await context.route('**/ingest/**', (route) => route.fulfill({ status: 204 }));
      const page = await context.newPage();
      for (const [name, path] of Object.entries(PAGES)) {
        await page.goto(new URL(path, BASE).href, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const file = `${name}-${device}-${locale}.webp`;
        writeFileSync(new URL(file, OUT), await webp(await page.screenshot()));
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
