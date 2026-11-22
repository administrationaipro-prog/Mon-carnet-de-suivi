// Génère les icônes PNG de la PWA à partir de client/public/icon.svg
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../client/public/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
for (const s of [192, 512]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: new URL(`../client/public/icon-${s}.png`, import.meta.url).pathname, omitBackground: true });
}
await b.close();
