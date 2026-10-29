// Renders the app icons (icons/*.png) from the SVG drawing below, using the
// Playwright Chromium. Run after changing the drawing: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// A map pin holding a small family tree. All of it lies inside the maskable
// safe zone (a circle of radius 0.4 × size around the centre).
const motif = `
  <path d="M256 424C256 424 134 292 134 214a122 122 0 0 1 244 0c0 78-122 210-122 210Z" fill="#f7f4ed"/>
  <path d="M256 300v-62M256 238l-50-50M256 238l50-50" stroke="#24392d" stroke-width="20" stroke-linecap="round" fill="none"/>
  <circle cx="206" cy="176" r="24" fill="#24392d"/>
  <circle cx="306" cy="176" r="24" fill="#24392d"/>
  <circle cx="256" cy="306" r="26" fill="#b5541c"/>`;

/** @param {boolean} maskable */
const svg = (maskable) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${maskable ? '<rect width="512" height="512" fill="#24392d"/>' : '<rect width="512" height="512" rx="112" fill="#24392d"/>'}${motif}
</svg>
`;

await writeFile(join(iconsDir, 'icon.svg'), svg(false));
const browser = await chromium.launch();
try {
  /** @type {[string, number, boolean][]} */
  const targets = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]];
  for (const [file, size, maskable] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(maskable).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: join(iconsDir, file), omitBackground: true });
    await page.close();
    console.log(`icons/${file}`);
  }
} finally {
  await browser.close();
}
