// BMS boards sold on their own, in the hub (2026-10-29).
//
//   node test/test-bms-sale.mjs
//   node test/test-bms-sale.mjs --selftest     (the hub stops finding a board's cost by its name)
//
// Daniel: "תעשה מכירת BMS לעסקים ופרטי". The catalogue carries every branded board the site sells, under a
// category per maker ("BMS - DALY", "BMS - JK חכם", …), at the site's price and 15% off for a dealer. A board
// is sold under the name the supplier list gives it, so its cost is that row's (supplierQuoteFor finds it by
// name, as it finds a DHS pack), not 60% of its price. Its spec line names its maker, series and current.
//
// The supplier row below is made up (a fixture, "דוגמה"): his real prices live in the private list.
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
await new Promise((r) => srv.listen(4398, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4398/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.productEstimate === 'function' && typeof window.supplierQuoteFor === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { const orig = window.supplierQuoteFor; window.supplierQuoteFor = (n) => (SUPPLIER_MATCH[n] ? orig(n) : null); });

const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const rows = PRICING.filter((x) => /^BMS - /.test(x.cat));
  const daly = rows.find((x) => x.name === 'DALY 13S 48V 60A'), jk = rows.find((x) => /^JK /.test(x.name));
  const out = { n: rows.length, cats: [...new Set(rows.map((x) => x.cat))].sort(), daly, jk };
  Store.set('supplier_prices', [{ who: 'ספק דוגמה', cat: 'BMS DALY', name: daly.name, ils: 77 }]);
  out.withRow = productEstimate(daly);
  out.jkNoRow = productEstimate(jk);
  out.jkPct = Math.round(jk.retail * COST_PCT / 100);
  Store.set('supplier_prices', []);
  out.spec = PRODUCT_SPECS[daly.cat + '|' + daly.name];
  out.b2bOk = rows.every((x) => typeof x.retail === 'number' && typeof x.b2b === 'number' && x.b2b < x.retail && Math.abs(x.b2b - x.retail * 0.85) <= (x.retail < 100 ? 1 : 5));
  return out;
});
check('the catalogue sells the boards, a category per maker', r.n >= 25 && r.cats.join() === ['BMS - ANT', 'BMS - DALY', 'BMS - JBD', 'BMS - JK חכם'].sort().join(), r.cats);
check('a board\'s cost is its supplier row, found by the name it is sold under', r.withRow === 77, r.withRow);
check('with no row for it, the cost-% estimate', r.jkNoRow === r.jkPct, [r.jkNoRow, r.jkPct]);
check('its spec line: maker, cells in series, current', r.spec === 'DALY · 13 תאים בטור · 60A רציף', r.spec);
check('every board: a price and a dealer price 15% under it', r.b2bOk, [r.daly, r.jk]);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
