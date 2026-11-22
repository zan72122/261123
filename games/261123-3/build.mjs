// Build: bundle src/main.js (+ three) into ONE self-contained index.html.
//   node build.mjs                      -> ./index.html (game)
//   node build.mjs --entry src/dev/preview_x.js --out /some/where/x.html   (dev previews)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const entry = resolve(here, arg('--entry', 'src/main.js'));
const out = resolve(process.cwd(), arg('--out', resolve(here, 'index.html')));
const dev = process.argv.includes('--dev');
const res = await build({
  entryPoints: [entry], bundle: true, format: 'iife', write: false,
  minify: !dev, target: ['es2019', 'safari14'], legalComments: 'none',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' },
  define: { __DEV__: dev ? 'true' : 'false' },
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = readFileSync(resolve(here, 'src/index.template.html'), 'utf8');
const fb = resolve(here, 'src/assets/fallback.jpg');
const fbUrl = existsSync(fb) ? 'data:image/jpeg;base64,' + readFileSync(fb).toString('base64') : '';
html = html.replace('/*__FALLBACK__*/', fbUrl).replace('/*__BUNDLE__*/', () => js);
writeFileSync(out, html);
console.log('built', out, (html.length / 1024 / 1024).toFixed(2) + ' MB');
