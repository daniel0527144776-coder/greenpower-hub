// The cost window says what a product's cost is made of, when its figures are from and what the
// shipping in it comes to — for every product (2026-10-22).
//
//   node test/test-cost-window.mjs [--selftest]
//
// Daniel: "תעשה בבקשה בדיקה מקיפה שכל העלויות של המוצרים שעולים לי זה באמת נכון ... הסבר שאני לוחץ על
// המוצר ממה מורכב ... ומאיזה תאריך ... אומדן משלוח". Two things were wrong before this:
//   - only batteries had a breakdown; a charger, a motor or a display showed a bare number;
//   - an 18650 scooter pack's breakdown listed its cells at the 21700 50E's price, under a total
//     that had used the 26V's — the same tier-word mix-up as the stock bug in v479.
// The supplier quotes here are made up ($20); this repo is public.
//
// --selftest strips the 18650 row's own cell before costing it, and drops the resale breakdown.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4385, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4385/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

const R = await page.evaluate((SELF) => {
  if (SELF) window.resaleBreakdownHtml = () => '';
  Store.set('supplier_prices', [
    { who: 'ספק א', cat: 'מטענים אלומיניום', name: '72V 5A XLR', usd: 20, on: '2026-09-30' },
    { who: 'ספק א', cat: 'מטענים פלסטיק', name: '48V 3A', usd: 20 },
  ]);
  const at = (pred) => PRICING.findIndex(pred);
  const open = (i) => { openCostEditor(i); const el = document.getElementById('costBreakdown'); const out = { text: el.innerText, dates: !!el.querySelector('[data-cost-dates]') }; closeModal(); return out; };

  // 1. the 18650 row costs its own cell, part by part
  const i26 = at((x) => x.cell18650 === '26V' && /^48V 26Ah/.test(x.name));
  const row26 = SELF ? { ...PRICING[i26], cell18650: undefined } : PRICING[i26];
  const b26 = batteryCostParts(row26, false);
  const own26 = routeCellCostOn('26V', 'sea');

  // 2. a battery: dates and shipping
  const iBike = at((x) => x.cat === 'סוללות אופניים - 48V CLASSIC' && x.name === '48V 20Ah');
  const bike = open(iBike);

  // 3. a quoted charger: goods + freight = its cost (no import VAT since 2026-10-29), and the quote's date
  const iCh = at((x) => x.name === 'מטען 72V 5A');
  const ch = open(iCh);
  const chCost = productCost(PRICING[iCh]);
  const q = supplierQuoteFor('מטען 72V 5A');
  const parts = q ? supplierIlsParts(q) : null;

  // 4. a charger with no quote says so
  const none = open(at((x) => x.name === 'מטען 36V 2A'));

  // 5. every row with a cost explains it
  const silent = PRICING.filter((x) => productCost(x) != null && !costBreakdownHtml(x)).map((x) => x.cat + ' | ' + x.name);

  return {
    b26: b26 && { first: b26.parts[0].k, cellPrice: b26.cellPrice, total: Math.round(b26.total), est: Math.round(productEstimate(PRICING[i26])) },
    own26, bike, ch, chCost, parts, none, silent: silent.slice(0, 8), silentN: silent.length,
  };
}, SELFTEST);

check('an 18650 26V pack lists its cells at the 26V\'s price, not the 50E\'s', !!R.b26 && R.b26.cellPrice === R.own26 && /130 תאים/.test(R.b26.first), R.b26);
check('and its breakdown adds up to the cost the row shows', !!R.b26 && Math.abs(R.b26.total - R.b26.est) <= 1, R.b26);
check('a battery says when its figures are from', R.bike.dates && /יבוא ימי, יוני 2026/.test(R.bike.text) && /זמן עבודה/.test(R.bike.text), R.bike.text.slice(-260));
// Daniel, 2026-10-29: "אני לא משלם מע"מ ... העלות שלי כולל מע"מ, זה לא טוב, לא רלוונטי" — no VAT line anywhere
check('and what the shipping in its cells comes to, with no VAT in it', /משלוח/.test(R.bike.text) && /הובלה ועמלות/.test(R.bike.text) && !/מע"מ/.test(R.bike.text), R.bike.text.slice(-200));
check('a charger shows its quote: goods and shipping, no VAT', /סחורה/.test(R.ch.text) && /משלוח/.test(R.ch.text) && !/מע"מ/.test(R.ch.text), R.ch.text);
check('which add up to its cost', !!R.parts && Math.round(R.parts.total) === R.chCost, { parts: R.parts, cost: R.chCost });
check('and the date of the quote', /2026-09-30/.test(R.ch.text), R.ch.text);
check('a charger with no quote says it is a share of the price', /אין הצעת מחיר/.test(R.none.text), R.none.text);
check('every product with a cost explains it', R.silentN === 0, R.silent);

if (SELFTEST) console.log('\n[selftest] the 18650 row lost its cell and the resale breakdown was dropped; the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
