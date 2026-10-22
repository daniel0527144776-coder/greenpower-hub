// A sale's quote names the cell its pack is built on (2026-10-22).
//
//   node test/test-quote-spec.mjs
//   node test/test-quote-spec.mjs --selftest     (orderItemSpec as it was: the tier's spec for every row)
//
// orderItemSpec filled the quote's spec block from the tier word in the category alone, so the
// 18650 scooter packs (shallowCatalogRows, "סוללות קורקינטים 18650 - 48V CLASSIC") went out as
// "✅ *סדרת תאים:* EVE 21700 50E (Classic)" at 2C~3C — the CLASSIC 21700, on a 13S10P of EVE 26V;
// the 25P packs as Tenpower 50SG at 4C~10C. A wrong spec in the message the customer keeps as his
// warranty. What must hold, on the real catalogue and through the real save:
//   - every 18650 row's quote names its own 18650 and that cell's C-rate, and no 21700 at all;
//   - every C-rate a quote prints is the one the sticker prints for the same cell (getCellRates in
//     stickers.html), for the three 21700 tiers as well;
//   - an 18650 row whose cell has no figure here prints no cell line, never the tier's 21700;
//   - a 21700 row still prints its tier's cell, and a charger prints no cell line.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

// the sticker's C-rates, read from the editor itself: the function, brace-matched, run on its own
const stickers = fs.readFileSync(path.join(DIST, 'stickers.html'), 'utf8');
const gs = stickers.indexOf('function getCellRates(');
let ge = -1;
for (let i = stickers.indexOf('{', gs), depth = 0; gs >= 0 && i < stickers.length; i++) {
  if (stickers[i] === '{') depth++;
  else if (stickers[i] === '}' && --depth === 0) { ge = i + 1; break; }
}
const getCellRates = ge > 0 ? vm.runInNewContext(stickers.slice(gs, ge) + '; getCellRates') : null;
check('the sticker\'s getCellRates was read', typeof getCellRates === 'function');
const stickerCrate = (cell) => {
  const r = getCellRates(cell);
  return r.peak == null || r.peak === r.cont ? `${r.cont}C` : `${r.cont}C~${r.peak}C`;
};

// --selftest serves the page with the old orderItemSpec: the tier's spec, whatever the row's cell
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) {
  const NOW = /\n[ \t]*\/\/ A saved sale line keeps only its name and category[^\n]*\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*if \(\/18650\/\.test\(it\.cat\)\) \{\n[^\n]*\n[^\n]*\n[ \t]*\}\n/;
  const old = html.replace(NOW, '\n');
  check('[selftest] the old orderItemSpec could be put back', old !== html);
  html = old;
}

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4388, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4388/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.saveOrder === 'function' && typeof window.buildQuoteText === 'function'
  && typeof window.addShallowCatalogRows === 'function', null, { timeout: 30000 });
// the 18650 rows join the catalogue in init(), which runs after the login; this page never logs in
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; addShallowCatalogRows(); });

// ---- 1. every 18650 row, sold through the sale editor and quoted from what was saved
const R = await page.evaluate(() => {
  // a sale of one line, the way he makes one: the editor, the catalogue line, the save
  const sell = (ci) => {
    Store.set('orders', []);
    openOrderEditor();
    document.getElementById('ordName').value = 'לקוח בדיקה';
    document.getElementById('ordPhone').value = '050-765-4321';
    orderDraft.items.push({ ci, qty: 1 });
    saveOrder();
    const o = (Store.get('orders') || [])[0];
    return { item: o ? o.items[0] : null, quote: o ? buildQuoteText(o) : '' };
  };
  const out = [];
  PRICING.forEach((r, ci) => { if (r.cell18650) out.push({ cell: r.cell18650, cat: r.cat, ...sell(ci) }); });
  const ref = PRICING.findIndex((r) => r.cat === 'סוללות קורקינטים וקולנועיות - 48V CLASSIC');
  const charger = PRICING.findIndex((r) => /מטען/.test(r.cat + ' ' + r.name));
  return { rows: out, ref: ref >= 0 ? sell(ref) : null, charger: charger >= 0 ? sell(charger) : null,
    specs: { ...TIER_SPEC, ...(typeof CELL_SPEC_18650 !== 'undefined' ? CELL_SPEC_18650 : {}) } };
});
const cellLine = (q) => (q.match(/✅ \*סדרת תאים:\* ([^\n]*)/) || [])[1] || '';
const battLine = (q) => (q.match(/✅ \*דגם סוללה:\* ([^\n]*)/) || [])[1] || '';
const want = { '26V': 'EVE 18650 26V', '25P': 'EVE 18650 25P' };
check(`the catalogue has its 18650 rows, both cells (${R.rows.length})`,
  R.rows.length >= 20 && R.rows.some((r) => r.cell === '26V') && R.rows.some((r) => r.cell === '25P'), R.rows.length);
check('each was saved as a sale line of name and category, without its cell field',
  R.rows.every((r) => r.item && r.item.cat === r.cat && !('cell18650' in r.item)), R.rows.find((r) => !r.item || 'cell18650' in r.item));
const wrongCell = R.rows.filter((r) => !cellLine(r.quote).startsWith(want[r.cell] + ' '));
check('every 18650 quote names its own cell', wrongCell.length === 0,
  wrongCell.slice(0, 3).map((r) => [r.item && r.item.name, cellLine(r.quote)]));
const wrongRate = R.rows.filter((r) => !battLine(r.quote).endsWith(' ' + stickerCrate(want[r.cell])));
check('…at that cell\'s C-rate, the one its sticker prints (26V 3C~4C, 25P 12C)', wrongRate.length === 0,
  wrongRate.slice(0, 3).map((r) => battLine(r.quote)));
const named21700 = R.rows.filter((r) => /21700|50E|50SG|50PL/.test(r.quote));
check('…and no 18650 quote names a 21700', named21700.length === 0, named21700.slice(0, 2).map((r) => cellLine(r.quote)));
check('…and each still says what it fits', R.rows.every((r) => /✅ \*התאמה:\* קורקינטים 18650/.test(r.quote)));

// ---- 2. every C-rate a quote can print is the sticker's for that cell
const specs = Object.values(R.specs);
const offSticker = specs.filter((s) => s.crate !== stickerCrate(s.cell)).map((s) => [s.cell, s.crate, stickerCrate(s.cell)]);
check(`the quote's C-rates are the sticker's, cell by cell (${specs.length} cells)`, specs.length >= 5 && offSticker.length === 0, offSticker);

// ---- 3. an 18650 the spec table has no figure for
const unknown = await page.evaluate(() => {
  const o = { id: 'oX', customer: 'לקוח בדיקה', status: 'הצעה', total: 1000,
    items: [{ name: '48V 35Ah · 13S10P EVE 35V', cat: 'סוללות קורקינטים 18650 - 48V CLASSIC', qty: 1, unit: 1000 }] };
  return buildQuoteText(o);
});
check('an 18650 with no figure here prints no cell line, not the tier\'s 21700', !/סדרת תאים|21700|2C~3C/.test(unknown)
  && /✅ \*דגם סוללה:\* 48V 35Ah · 13S10P EVE 35V\n/.test(unknown), unknown.split('\n').filter((l) => /✅/.test(l)));

// ---- 4. what did not change
check('a 21700 row still names its tier\'s cell and C-rate', !!R.ref && cellLine(R.ref.quote) === 'EVE 21700 50E (Classic)'
  && battLine(R.ref.quote).endsWith(' 2C~3C'), R.ref && [battLine(R.ref.quote), cellLine(R.ref.quote)]);
check('a charger prints no cell line', !!R.charger && !/סדרת תאים/.test(R.charger.quote) && /✅ \*פריט:\*/.test(R.charger.quote),
  R.charger && R.charger.quote.split('\n').filter((l) => /✅/.test(l)));
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
if (SELFTEST) console.log('\n[selftest] the tier\'s spec on every row put back; the 18650 checks above must be red.');
process.exit(finish());
