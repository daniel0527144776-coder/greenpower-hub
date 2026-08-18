// Does producing a sticker actually record it?
//
//   node test/test-sticker-history.mjs [--selftest]
//
// This existed as a feature, was removed on 2026-07-09 with the editor's cloud sync, and
// nothing noticed for six weeks — the hub kept a stickerlog page, a home card for it and a
// "מדבקות שהונפקו" block on every customer card, all of them permanently empty because
// nothing wrote the key any more. A page that can only ever show an empty state looks
// exactly like a page with no data yet. Hence this test.
//
// It drives the real download button and then reads the record back the way the hub reads
// it, including through the hub's own renderStickerLog(), since the two halves live in
// different files and only agree by convention.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// CI installs playwright; locally nothing is installed for the hub, so fall back to the
// copy the retail site already carries rather than duplicating a browser download.
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(4182, r));

let fails = 0;
const check = (label, ok, got) => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${got !== undefined ? ` — ${JSON.stringify(got)}` : ''}`); fails++; } };

const b = await chromium.launch();
// One context throughout: the editor and the hub are the same origin in production, and
// that is the entire reason the editor can write a key the hub reads.
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
const errors = [];

async function makeSticker(page, { repair, client, ref, volt, cap }) {
  if (repair) { await page.locator('.mode-button.repair-mode').click(); await page.waitForTimeout(500); }
  await page.evaluate(([c, r, v, cp]) => {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) {
      el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('client-name-input', c); set('client-ref-input', r);
    set('voltage-select', v); set('capacity-select', cp);
    if (typeof updateAllSpecs === 'function') updateAllSpecs();
  }, [client, ref, volt, cap]);
  await page.waitForTimeout(600);
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('.download-btn[data-format="pdf"]').click();
  await (await dl).saveAs(path.join(os.tmpdir(), 'gp-history-probe.pdf'));
  await page.waitForTimeout(400);
}

console.log('\n1. producing a sticker records it');
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() !== 'error') return;
  const t = m.text();
  // Network weather on a runner is not a defect in the page.
  if (/Failed to load resource|net::|ERR_|supabase|fonts.g(oogle)?/i.test(t)) return;
  errors.push(t); });
await page.goto('http://127.0.0.1:4182/stickers.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.resetStickerDesign === 'function', { timeout: 30000 });
await page.waitForTimeout(800);
await page.evaluate(() => localStorage.removeItem('gp_sticker_history'));

await makeSticker(page, { client: 'אוראל פיימן', ref: '1042', volt: '72', cap: '60' });
let hist = await page.evaluate(() => JSON.parse(localStorage.getItem('gp_sticker_history') || '[]'));
check('one record was written', hist.length === (SELFTEST ? 99 : 1), hist.length);
if (hist[0]) {
  check('it carries the customer', hist[0].client === 'אוראל פיימן', hist[0].client);
  check('it carries the order number', hist[0].ref === '1042', hist[0].ref);
  check('it carries the SKU', /^GP-72V-60A/.test(hist[0].sku || ''), hist[0].sku);
  check('it carries the spec', hist[0].voltage === '72V' && hist[0].capacity === '60Ah', [hist[0].voltage, hist[0].capacity]);
  check('it is typed as a build', hist[0].type === 'new', hist[0].type);
  check('it is dated', !isNaN(new Date(hist[0].date)), hist[0].date);
}

console.log('\n2. a second sticker appends rather than replaces');
await makeSticker(page, { repair: true, client: 'מוסך אלעד', ref: '77' });
hist = await page.evaluate(() => JSON.parse(localStorage.getItem('gp_sticker_history') || '[]'));
check('two records now', hist.length === 2, hist.length);
check('newest first', hist[0].client === 'מוסך אלעד', hist[0].client);
check('the repair is typed as one', hist[0].type === 'repair', hist[0].type);
check('the first one survived', hist[1] && hist[1].client === 'אוראל פיימן', hist[1] && hist[1].client);
await page.close();

console.log('\n3. the hub shows them');
const hub = await ctx.newPage();
hub.on('pageerror', e => errors.push(String(e)));
await hub.goto('http://127.0.0.1:4182/index.html', { waitUntil: 'domcontentloaded' });
await hub.waitForFunction(() => typeof window.renderStickerLog === 'function', { timeout: 30000 });
const shown = await hub.evaluate(() => {
  renderStickerLog();
  const list = document.getElementById('stickerlogList');
  // Count the rendered ROWS, not a counter element: the page's item counts were removed
  // on 2026-08-18 and asserting on one of them is how a test rots into a false alarm.
  return { rows: list.querySelectorAll('.list-item').length, html: list.innerHTML };
});
check('the hub lists both', shown.rows === 2, shown.rows);
check('the customer names are listed', shown.html.includes('אוראל פיימן') && shown.html.includes('מוסך אלעד'));
check('it is not the empty state', !shown.html.includes('אין מדבקות'), shown.html.slice(0, 60));

check('no page errors', errors.length === 0, errors);
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
