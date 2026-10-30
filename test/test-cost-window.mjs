// The cost window says what a product's cost is made of, for every product (2026-10-22), and since
// 2026-10-30 only the bottom line: the cost, each price with what is left of it, and the parts folded shut.
//
//   node test/test-cost-window.mjs [--selftest]
//
// Daniel: "תעשה בבקשה בדיקה מקיפה שכל העלויות של המוצרים שעולים לי זה באמת נכון ... הסבר שאני לוחץ על
// המוצר ממה מורכב ... ומאיזה תאריך ... אומדן משלוח". Two things were wrong before this:
//   - only batteries had a breakdown; a charger, a motor or a display showed a bare number;
//   - an 18650 scooter pack's breakdown listed its cells at the 21700 50E's price, under a total
//     that had used the 26V's — the same tier-word mix-up as the stock bug in v479.
// Then, 2026-10-30: "רק שורה תחתונה ... לא פירוט לדעת כמו איזה תאריך ... יש גם דברים כפולים". The dates,
// the shipping line and the explanations went; the two prices are said once, in the profit lines; the
// parts are under "פירוט", closed until tapped. A warning (a board that fits nothing) is not an explanation.
// The supplier quotes here are made up ($20); this repo is public.
//
// --selftest strips the 18650 row's own cell before costing it, drops the resale breakdown, and puts the
// dates back into a battery's window, open.
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
  if (SELF) {
    window.resaleBreakdownHtml = () => '';
    const orig = window.costBreakdownHtml;
    window.costBreakdownHtml = (it) => orig(it).replace('<details', '<details open') + '<div>📅 מאיזה תאריך · הובלה ועמלות</div>';
  }
  Store.set('supplier_prices', [
    { who: 'ספק א', cat: 'מטענים אלומיניום', name: '72V 5A XLR', usd: 20, on: '2026-09-30' },
    { who: 'ספק א', cat: 'מטענים פלסטיק', name: '48V 3A', usd: 20 },
  ]);
  const at = (pred) => PRICING.findIndex(pred);
  // text: everything in the breakdown, folded or not; seen: what he sees without tapping, the whole window.
  const open = (i) => {
    openCostEditor(i);
    const el = document.getElementById('costBreakdown');
    const win = document.getElementById('costBreakdown').closest('.modal, .modal-content, [role="dialog"]') || document.body;
    const out = { text: el.textContent, seen: win.innerText, folds: el.querySelectorAll('details').length, open: el.querySelectorAll('details[open]').length };
    closeModal();
    return out;
  };

  // 1. the 18650 row costs its own cell, part by part
  const i26 = at((x) => x.cell18650 === '26V' && /^48V 26Ah/.test(x.name));
  const row26 = SELF ? { ...PRICING[i26], cell18650: undefined } : PRICING[i26];
  const b26 = batteryCostParts(row26, false);
  const own26 = routeCellCostOn('26V', 'sea');

  // 2. a battery: the bottom line, the parts folded
  const iBike = at((x) => x.cat === 'סוללות אופניים - 48V CLASSIC' && x.name === '48V 20Ah');
  const bike = open(iBike);
  openCostEditor(iBike);
  const win = (document.getElementById('costBreakdown').closest('.modal, .modal-content, [role="dialog"]') || document.body).innerText;
  const cnt = (n) => win.split(shek(n)).length - 1;
  bike.prices = { retail: cnt(priceWithBms(PRICING[iBike], 'retail')), b2b: cnt(priceWithBms(PRICING[iBike], 'b2b')) };
  closeModal();

  // 3. a quoted charger: goods + freight = its cost (no import VAT since 2026-10-29)
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
check('a battery\'s parts and hours are there, folded shut', R.bike.folds === 1 && R.bike.open === 0 && /תאים/.test(R.bike.text) && /עבודה/.test(R.bike.text), R.bike);
const NOISE = /מאיזה תאריך|יבוא ימי|הובלה ועמלות|נשמר כעלות|לוחות מתאימים|הזמן שלך|תאים לפי מסלול|ממה מורכב|כמו באתר|"איפוס" חוזר/;
check('no dates, no shipping line, no explanations in the window', !NOISE.test(R.bike.seen) && !NOISE.test(R.bike.text), (R.bike.seen.match(NOISE) || R.bike.text.match(NOISE) || [])[0]);
// Daniel, 2026-10-29: "אני לא משלם מע"מ ... העלות שלי כולל מע"מ, זה לא טוב, לא רלוונטי" — no VAT line anywhere
check('no VAT line', !/מע"מ/.test(R.bike.text), R.bike.text.slice(-200));
check('each price is said once: the private and the trade price, each beside its profit', R.bike.prices.retail === 1 && R.bike.prices.b2b === 1, R.bike.prices);
check('a charger shows its quote: goods and shipping, no VAT', /סחורה/.test(R.ch.text) && /משלוח/.test(R.ch.text) && !/מע"מ/.test(R.ch.text), R.ch.text);
check('which add up to its cost', !!R.parts && Math.round(R.parts.total) === R.chCost, { parts: R.parts, cost: R.chCost });
check('with no date and no supplier line', !/2026-09-30/.test(R.ch.text) && !/ספק א/.test(R.ch.text) && !/2026-09-30/.test(R.ch.seen), R.ch.text);
check('a charger with no quote says it is a share of the price', /אין הצעת מחיר/.test(R.none.text), R.none.text);
check('every product with a cost explains it', R.silentN === 0, R.silent);

// The price list: the toggle on top says which list is shown, so a row does not say it again beside its price.
const rows = await page.evaluate((SELF) => {
  navigateTo('catalog'); catExpandAll(true);
  const rs = [...document.querySelectorAll('.price-item[onclick^="openCostEditor"]')];
  if (SELF && rs[0]) rs[0].children[1].textContent = 'פרטי';
  return { n: rs.length, said: rs.filter((r) => /^(פרטי|עסקי)$/.test(((r.children[1] || {}).textContent || '').trim())).length };
}, SELFTEST);
check('a price-list row does not repeat "פרטי" / "עסקי" beside its price', rows.n > 100 && rows.said === 0, rows);

if (SELFTEST) console.log('\n[selftest] the 18650 row lost its cell and the resale breakdown was dropped; the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
