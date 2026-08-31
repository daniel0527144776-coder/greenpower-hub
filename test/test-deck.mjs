// The presentation, driven in the hub where it actually lives.
//
//   node test/test-deck.mjs
//   node test/test-deck.mjs --selftest
//
// Three things this covers that reading the file cannot.
//
// It RENDERS. A deck baked into a 2.5MB page as markup + a scoped stylesheet + its own
// controller has three ways to arrive broken and look fine in a diff.
//
// Its numbers are the LIVE ones. The whole reason the deck is generated is that a slide
// quoting a cell cost is a price restated in prose, and this repo has watched those rot —
// the ChatBot said ₪4,800 against a real ₪6,100 for months. So the figures on the slides are
// compared against cost-model.mjs and product-specs.mjs, not against a copy.
//
// And it reads in the right ORDER. '280×75×150' rendered as '150×75×280' on the first build:
// '×' is a neutral character, the page is RTL, and the digits reorder into a different real
// dimension with nothing on screen to say so. That is measured here by geometry, per character,
// because it is invisible to any check on the string.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const ROOT = path.join(HERE, '..', '..');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

// cost-model.mjs and product-specs.mjs live in the TOOLS repo, and this workflow checks out
// greenpower-hub alone. So they are optional here — but never silently. When they are absent
// the live-number checks are announced as skipped rather than quietly passing, which is this
// codebase's oldest bug shape: a missing input turning every comparison vacuously true.
//
// Nothing is lost by skipping them in CI: `node tools/gen-deck.mjs --check` runs inside
// sync-prices, in the repo that HAS those modules, and it compares the whole generated deck
// byte for byte. This file's job is the half that only a browser can see.
const url = (f) => path.join(ROOT, f).replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');
let cost = null, specs = null;
try { cost = await import(url('cost-model.mjs')); specs = await import(url('product-specs.mjs')); } catch { /* tools repo not checked out */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4199, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errs = [];
const dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
// Recorded, never accepted: a dialog on this device shows nothing at all, so a test that
// clicks OK for it is a test that passes on a dead button.
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4199/index.html');

if (SELFTEST) {
  // Undo the bidi isolation on the dimension labels — the exact thing that shipped wrong —
  // and the geometry check below must go red.
  await page.evaluate(() => {
    document.querySelectorAll('#gpd-bomber svg text').forEach((t) => t.removeAttribute('style'));
  });
}

await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  navigateTo('help');
});
await page.waitForTimeout(250);

// ---- 1. it is there and it renders ----
const base = await page.evaluate(() => {
  const d = document.getElementById('gpDeck');
  if (!d) return null;
  const s = [...d.querySelectorAll('.gpd-slide')];
  return {
    n: s.length,
    visible: s.filter((x) => x.offsetParent !== null).length,
    counter: (document.getElementById('gpDeckCount') || {}).textContent || '',
    imgs: d.querySelectorAll('img').length,
    svgs: d.querySelectorAll('svg').length,
    helpCards: document.querySelectorAll('#page-help > .card').length,
  };
});
check('the deck is on the help page', !!base, base ? 'ok' : 'missing #gpDeck');
if (!base) { await browser.close(); srv.close(); process.exit(finish()); }
check('it holds all sixteen slides', base.n === 16, String(base.n));
check('exactly one is on screen', base.visible === 1, String(base.visible));
check('the counter agrees with the deck', /\/\s*16$/.test(base.counter.trim()), base.counter);
check('the figures are drawn, not fetched', base.imgs === 0 && base.svgs >= 4, `img=${base.imgs} svg=${base.svgs}`);
// The deck brings its own stylesheet into a page that already owns .card, .btn and figure.
// If it leaked, the rest of the help page is what breaks, so count it.
check('the rest of the help page survived it', base.helpCards >= 8, String(base.helpCards));

// ---- 2. the controller moves ----
const nav = await page.evaluate(() => {
  const id = () => ([...document.querySelectorAll('#gpDeck .gpd-slide')].find((s) => s.classList.contains('on')) || {}).id;
  const first = id();
  gpDeckGo(1); const second = id();
  gpDeckGo(-1); const back = id();
  for (let i = 0; i < 16; i++) gpDeckGo(1);
  return { first, second, back, wrapped: id() };
});
check('הבא advances a slide', nav.second && nav.second !== nav.first, `${nav.first} -> ${nav.second}`);
check('הקודם comes back to it', nav.back === nav.first, nav.back);
check('and a full lap returns to the start', nav.wrapped === nav.first, nav.wrapped);

// ---- 3. the numbers are the live ones ----
// Not "a number is present" — the number the module actually holds today. Change EVE 50E's
// landed cost and this fails until the deck is regenerated, which is the entire point of it
// being generated.
const text = await page.evaluate(() => document.getElementById('gpDeck').textContent.replace(/\s+/g, ' '));
if (!cost) console.log('  --   מודל העלות לא זמין (ריפו הכלים לא נבדק) — 7 בדיקות מספרים דולגו; gen-deck.mjs --check מכסה אותן');
if (cost) {
check('the CLASSIC cell cost is the one in cost-model',
  text.includes('₪' + cost.CELL_COST['EVE 50E'].toFixed(2)), '₪' + cost.CELL_COST['EVE 50E'].toFixed(2));
check('and ADVANCED and PRO too',
  text.includes('₪' + cost.CELL_COST['Tenpower 50SG'].toFixed(2)) && text.includes('₪' + cost.CELL_COST['EVE 50PL'].toFixed(2)), 'ok');
check('the BMS ladder comes from bmsFor',
  [48, 60, 72].every((v) => text.includes('₪' + cost.bmsFor(v))), [48, 60, 72].map(cost.bmsFor).join('/'));
check('the labour rate is LABOUR_HR', text.includes('₪' + cost.LABOUR_HR), String(cost.LABOUR_HR));
check('the weld time is WELD_HR_PER_CELL', text.includes(String(cost.WELD_HR_PER_CELL)), String(cost.WELD_HR_PER_CELL));
check('72V is the series table, not a divisor', text.includes(specs.SERIES[72] + 'S'), specs.SERIES[72] + 'S');
// The nickel slide is the second anchor and its whole point is the gap between ₪60 and reality.
check('the nickel figure is nickelCost, not ₪60',
  text.includes('₪' + Math.round(cost.nickelCost(120))) && Math.round(cost.nickelCost(120)) !== 60,
  '₪' + Math.round(cost.nickelCost(120)));
}

// ---- 4. the five Bomber frames match the hub's own table ----
const bomb = await page.evaluate(() => {
  const rows = VEHICLE_PACKS.filter((v) => /^Bomber/.test(v.m));
  const svg = document.querySelector('#gpd-bomber svg').textContent.replace(/\s+/g, ' ');
  return { max: rows.map((r) => r.max), allShown: rows.every((r) => svg.includes(String(r.max))) };
});
check('all five Bomber frames are on the slide', bomb.allShown, bomb.max.join('/'));
check('and they are not the same battery bay', new Set(bomb.max).size === 5, bomb.max.join('/'));

// ---- 5. the dimensions read in the order they were written ----
// Measured, not asserted about the markup. '280×75×150' in an RTL document renders as
// '150×75×280' unless the run is isolated — a different, plausible dimension. Per-character
// geometry is the only thing that sees it.
const order = await page.evaluate(() => {
  // The slide has to be ON to have geometry: a display:none element measures 0x0 and the
  // check would 'fail' on a page that is perfectly correct.
  const slides = [...document.querySelectorAll('#gpDeck .gpd-slide')];
  const target = slides.findIndex((s) => s.id === 'gpd-bomber');
  const cur = slides.findIndex((s) => s.classList.contains('on'));
  gpDeckGo(target - cur);
  const t = [...document.querySelectorAll('#gpd-bomber svg text')]
    .find((e) => /^\d+×\d+×\d+$/.test(e.textContent.trim()));
  if (!t) return { found: false };
  const node = t.firstChild;
  const rect = (i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); };
  const s = t.textContent.trim();
  return { found: true, text: s, firstX: rect(0).left, lastX: rect(s.length - 1).left };
});
check('a dimension label was found to measure', order.found, order.found ? order.text : 'none');
if (order.found) {
  check('280×75×150 reads left-to-right on screen', order.lastX > order.firstX,
    `${order.text}: first@${Math.round(order.firstX)} last@${Math.round(order.lastX)}`);
}

check('no JS errors', errs.length === 0, errs.join(' | '));
check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
