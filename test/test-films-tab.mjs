// The "סרטונים" tab (2026-09-28): the site's /films page in a frame.
//
// What can go wrong is quiet: a frame whose src is in the markup loads the whole site's
// animations every time the hub opens, and a tab with no card on the home page exists for nobody.
// So: the home page has the card, the frame is EMPTY until the tab is opened, then points at the
// site's /films, and the page raised no dialog. The frame's content is the site's, checked there
// (verify-films.mjs); the network is blocked here so nothing outside is fetched.
//
//   node test/test-films-tab.mjs
//   node test/test-films-tab.mjs --selftest   (the frame is given its src at load — must fail)
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4198, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
// Nothing leaves the machine: the site is not this suite's to load.
const outside = [];
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('http://127.0.0.1:4198/')) return route.continue();
  outside.push(u);
  return route.abort();
});
await page.goto('http://127.0.0.1:4198/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

const got = await page.evaluate(async (SELF) => {
  const fr = document.getElementById('filmsFrame');
  if (SELF && fr) fr.setAttribute('src', FILMS_URL);
  const card = [...document.querySelectorAll('#page-home .quick-card')].find((c) => /סרטונים/.test(c.textContent));
  const before = fr ? fr.getAttribute('src') : 'no frame';
  if (card) card.click(); else navigateTo('films');
  await new Promise((r) => setTimeout(r, 200));
  return { card: !!card, before, after: fr ? fr.getAttribute('src') : '',
           active: document.getElementById('page-films')?.classList.contains('active') };
}, SELFTEST);

check('the home page has a "סרטונים" card', got.card, got);
check('the frame loads nothing until the tab is opened', !got.before, got.before);
check('opening the tab shows the site\'s /films page', got.active && got.after === 'https://energylabgreen.com/films', got);
check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
