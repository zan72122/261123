// Screenshot helper for self-checks (headless Chromium + software WebGL).
//   node tools/shot.mjs <file.html> <out.png> [--size 390x844] [--wait 1500] [--eval "js run in page"] [--tap x,y] [--full]
// Prints console errors / page errors. `window.G` is available to --eval in every build.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('/opt/node-tools/node_modules/x.js');
const { chromium } = require('playwright');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const [w, h] = opt('--size', '390x844').split('x').map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('file://' + path.resolve(a[0]));
await page.waitForTimeout(Number(opt('--wait', 1500)));
const ev = opt('--eval', null);
if (ev) { const r = await page.evaluate(ev).catch((e) => 'EVAL ERROR ' + e.message); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(Number(opt('--after', 600))); }
await page.screenshot({ path: a[1] });
await browser.close();
console.log('shot', a[1]);
