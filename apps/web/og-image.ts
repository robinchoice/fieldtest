// Renders the link preview that WhatsApp, Signal and co. show for shared links,
// 1200×630 per language into static/og-image-<locale>.png (see DESIGN.md,
// "Vorschaubild"). Rerun after changing APP_NAME, APP_BAND, the tagline or the
// tile in static/favicon.svg, and commit the pictures.
// Run: bun run og-image
import { readFileSync } from 'node:fs';
import { APP_BAND, APP_NAME, bandGradient, GLOW, type Locale, messages } from '@app/shared';
import { chromium } from '@playwright/test';

const STATIC = new URL('static/', import.meta.url);
const dataUrl = (file: string, type: string) =>
  `data:${type};base64,${readFileSync(new URL(file, STATIC)).toString('base64')}`;

const html = (locale: Locale) => `<!doctype html>
<style>
  @font-face {
    font-family: Display;
    font-weight: 200 800;
    font-stretch: 75% 100%;
    src: url(${dataUrl('fonts/bricolage-grotesque-latin.woff2', 'font/woff2')});
  }
  body {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 1200px;
    height: 630px;
    margin: 0;
    padding: 0 96px 64px;
    background: #0e0d12;
    color: #f2f0ea;
    font-family: system-ui, sans-serif;
  }
  main { flex: 1; display: flex; align-items: center; gap: 64px; }
  .tile { flex: none; width: 208px; height: 208px; border-radius: 24%; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.07); }
  h1 { margin: 0; font: 800 116px/1 Display; font-stretch: 80%; letter-spacing: -0.02em; }
  .line { width: 120px; height: 4px; margin: 28px 0 24px; border-radius: 2px; background: ${bandGradient(APP_BAND, GLOW)}; }
  p { margin: 0; color: #9a98a3; font-size: 36px; line-height: 1.3; }
  footer { display: flex; gap: 14px; align-items: flex-end; color: #9a98a3; font: 650 24px/1 Display; font-stretch: 80%; }
  .signature { display: flex; flex-direction: column; gap: 8px; }
  .wordmark { width: 180px; height: 20px; background: #f2f0ea; mask: url(${dataUrl('pleasance-wordmark.svg', 'image/svg+xml')}) left center / contain no-repeat; }
  .band { position: relative; height: 3px; border-radius: 2px; background: linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.55)), linear-gradient(90deg, ${GLOW.join(', ')}); }
  .marker { position: absolute; top: -2px; min-width: 10px; height: 7px; border-radius: 4px; background: ${bandGradient(APP_BAND, GLOW)};
    left: ${((APP_BAND.from - 1) / 6) * 100}%; width: ${((APP_BAND.to - APP_BAND.from) / 6) * 100}%; }
</style>
<main>
  <img class="tile" src="${dataUrl('favicon.svg', 'image/svg+xml')}" />
  <div>
    <h1>${APP_NAME}</h1>
    <div class="line"></div>
    <p>${messages[locale].tagline}</p>
  </div>
</main>
<footer>
  ${messages[locale].madeBy}
  <div class="signature"><div class="wordmark"></div><div class="band"><div class="marker"></div></div></div>
</footer>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const locale of Object.keys(messages) as Locale[]) {
    await page.setContent(html(locale));
    await page.evaluate(() => document.fonts.ready);
    const file = `og-image-${locale}.png`;
    await page.screenshot({ path: new URL(file, STATIC).pathname });
    console.log(file);
  }
} finally {
  await browser.close();
}
