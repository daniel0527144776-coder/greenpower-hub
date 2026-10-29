// DHS's ready Sur-Ron packs in the hub (2026-10-29).
//
//   node test/test-dhs-packs.mjs
//   node test/test-dhs-packs.mjs --selftest     (the hub treats a DHS pack as a Sur-Ron build again)
//
// Daniel: "אני מעדיף להזמין ישירות מחו"ל מאשר לבנות לבד", "להוריד, רק DHS". The catalogue's only Sur-Ron
// packs are DHS's since that day, bought ready. So the hub must not cost one as the lab's build (cells,
// an ANT board, copper, a day's work): its cost is its supplier row, under the pack's own name. A sale
// of one leaves no cells or board on the shelf. It carries DHS's 24 months, not the lab's 12. Its sticker
// names its cells only where the editor knows them (the Samsung 50S), and never the 50PL of the old build.
//
// The supplier row below is made up (a fixture, "דוגמה"): DHS's real prices live in the private list.
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
await new Promise((r) => srv.listen(4397, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4397/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.productEstimate === 'function' && typeof window.warrantyForItem === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.dhsPack = () => false; });

const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const rows = PRICING.filter((x) => /^DHS \S+ \d+V \d+Ah$/.test(x.name));
  const light = rows.find((x) => /^DHS 7250-9C /.test(x.name)), ultra = rows.find((x) => /^DHS GR80 /.test(x.name));
  const out = { n: rows.length, cats: [...new Set(rows.map((x) => x.cat))] };
  // the price list: the Light Bee and then the Ultra Bee, each by voltage and then capacity, lowest first
  const va = (n) => { const m = String(n).match(/(\d+)V (\d+)Ah/); return m ? +m[1] * 1000 + +m[2] : 0; };
  out.order = rows.map((x) => x.name);
  out.ascending = out.cats.every((c) => { const v = rows.filter((x) => x.cat === c).map((x) => va(x.name)); return v.every((x, i) => !i || x > v[i - 1]); });
  navigateTo('catalog');
  const topic = [...document.querySelectorAll('#catalogList details')].find((d) => /סוללות Sur-Ron/.test(d.querySelector('summary')?.textContent || ''));
  out.titles = topic ? [...topic.querySelectorAll('details summary, [onclick*=toggleCatCat]')].map((e) => e.textContent.trim()).filter((s) => /Bee/.test(s)) : [];
  // the cost: no build of ours, and the supplier row under its own name when the list has one
  out.est = rows.map((x) => estimateBatteryCost(x));
  out.parts = batteryCostParts(light);
  Store.set('supplier_prices', [{ who: 'ספק דוגמה', cat: 'דוגמה', name: light.name, ils: 1234 }]);
  out.withRow = productEstimate(light);
  out.ultraNoRow = productEstimate(ultra);
  out.ultraPct = Math.round(ultra.retail * COST_PCT / 100);
  Store.set('supplier_prices', []);
  // a sale: no cells off the shelf, DHS's months
  out.stock = batteryStockParts(light);
  const sale = { items: [{ cat: light.cat, name: light.name, unit: light.retail, qty: 1 }] };
  out.months = saleWarrantyMonths(sale);
  out.itemMonths = warrantyForItem({ cat: ultra.cat, name: ultra.name });
  // an old sale of the lab's own Sur-Ron build keeps the build's 12 and its 50PL
  out.oldMonths = warrantyForItem({ cat: 'סוללות Sur-Ron Light Bee - 72V PRO', name: 'Light Bee 72V 45Ah' });
  out.oldCell = stickerCellFromText('סוללות Sur-Ron Light Bee - 72V PRO Light Bee 72V 45Ah');
  // the sticker: the 50S where the pack is one, nothing where the editor does not know the cell
  out.cellLight = stickerCellFromText(light.cat + ' ' + light.name);
  out.cellUltra = stickerCellFromText(ultra.cat + ' ' + ultra.name);
  return out;
});
// one category per bike since 2026-10-29 ("הבדל בין הלייט בי לאולטרה בי"), each by voltage and then capacity
check('the catalogue holds the eight DHS packs, one category per bike', r.n === 8 && r.cats.every((c) => /^סוללות Sur-Ron (Light|Ultra) Bee - DHS$/.test(c))
  && new Set(r.cats).size === 2, r);
check('…each from the lowest voltage up, then by capacity', r.ascending, r.order);
check('…and the price list shows the Light Bee and then the Ultra Bee, not one voltage heading over both',
  r.titles.length === 2 && /^\W*Light Bee/.test(r.titles[0]) && /^\W*Ultra Bee/.test(r.titles[1]), r.titles);
check('no DHS pack is costed as a build of ours', r.est.every((x) => x == null) && r.parts == null, [r.est, r.parts]);
check('its cost is its supplier row, by the pack\'s own name', r.withRow === 1234, r.withRow);
check('with no row yet, the cost-% estimate like any resold item, not a build', r.ultraNoRow === r.ultraPct, [r.ultraNoRow, r.ultraPct]);
check('a sale of one takes no cells or board off the shelf', r.stock == null, r.stock);
check('it carries 24 months, not the build\'s 12', r.months === 24 && r.itemMonths === 24, [r.months, r.itemMonths]);
check('an old sale of the lab\'s Sur-Ron build keeps 12 months and its 50PL', r.oldMonths === 12 && r.oldCell === 'EVE 21700 50PL', [r.oldMonths, r.oldCell]);
check('the sticker names the Samsung 50S on a 50S pack, and no cell of ours on the others', r.cellLight === 'Samsung 21700 50S' && r.cellUltra === '', [r.cellLight, r.cellUltra]);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
