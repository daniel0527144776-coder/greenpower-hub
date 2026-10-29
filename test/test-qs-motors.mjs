// QS motors in the hub: costed from their supplier quote, a category per QS model (2026-10-29).
//
//   node test/test-qs-motors.mjs
//   node test/test-qs-motors.mjs --selftest     (a scooter motor loses its quote row)
//
// Until today SUPPLIER_MATCH had no row for QS165 or for the six scooter motors added on 2026-10-05, so the
// hub costed those seven at COST_PCT of their price while every other QS motor was costed from its quote.
// The same day Daniel asked for the motors by QS model ("זה מתחלק ל-212, 205, 260, 273 ... דרג את זה לפי
// מספרי דגם של ה-QS"): a category per model, the mounting in brackets, each by power; and QS makes no
// "QS165 7000W" (the quote is the 5000W V2) and no QS205 5000W.
//
// The supplier rows below are made up ("ספק דוגמה"): the real quotes are in his private list.
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

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4413, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4413/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.productEstimate === 'function' && typeof window.supplierQuoteFor === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { delete SUPPLIER_MATCH['QS212 10" 1500W']; });

const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const qs = PRICING.filter((x) => /^מנועים - QS/.test(x.cat) && typeof x.retail === 'number');
  // one made-up quote row for every supplier name the map points at
  const names = Object.values(SUPPLIER_MATCH).filter((v) => typeof v === 'string');
  Store.set('supplier_prices', names.map((n) => ({ who: 'ספק דוגמה', cat: 'דוגמה', name: n, usd: 100, kg: 10, on: '2026-10-29' })));
  const uncosted = qs.filter((x) => !supplierQuoteFor(x.name)).map((x) => x.name);
  Store.set('supplier_prices', []);
  const model = (n) => (String(n).match(/^QS(\d{2,3})\b/) || [])[1];
  const wrongCat = qs.filter((x) => !new RegExp(`^מנועים - QS${model(x.name)} \\((Hub|Hub לקורקינט|Mid Drive)\\)$`).test(x.cat)).map((x) => x.cat + ' | ' + x.name);
  const watts = (n) => +(String(n).match(/(\d+)W\b/) || [])[1] || 0;
  const order = qs.map((x) => x.name);
  const sorted = order.slice().sort((a, b) => +model(a) - +model(b) || watts(a) - watts(b));
  return { n: qs.length, uncosted, wrongCat, order, inOrder: order.join() === sorted.join(),
    has165: qs.some((x) => x.name === 'QS165 5000W V2'), old: qs.filter((x) => /QS165 7000W|QS205 5000W/.test(x.name)).map((x) => x.name),
    mid: (PRODUCT_SPECS[qs.find((x) => /^QS138/.test(x.name))?.cat + '|' + qs.find((x) => /^QS138/.test(x.name))?.name] || ''),
    hub: (PRODUCT_SPECS[qs.find((x) => /^QS273/.test(x.name))?.cat + '|' + qs.find((x) => /^QS273/.test(x.name))?.name] || '') };
});
check('the catalogue carries the QS motors', r.n >= 12, r.n);
check('every QS motor is costed from its supplier quote, not a share of its price', r.uncosted.length === 0, r.uncosted);
check('each sits under its own QS model, the mounting in brackets', r.wrongCat.length === 0, r.wrongCat);
check('in model order, then by power', r.inOrder, r.order);
check('QS165 is the quote\'s 5000W V2, and no "QS165 7000W" or QS205 5000W is sold', r.has165 && r.old.length === 0, r.old);
check('the spec line still says hub or mid motor', /מנוע מרכזי/.test(r.mid) && /מנוע גלגל/.test(r.hub), [r.mid, r.hub]);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
