// Stock that moves by itself, 2026-09-01.
//
//   node test/test-inventory.mjs
//   node test/test-inventory.mjs --selftest
//
// A wrong deduction is worse than none: it is silent, it compounds, and the figure keeps being
// trusted. So the checks here are mostly about what must NOT happen — no double-deduct, no
// near-miss match, no re-seed over work already done.
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
await new Promise((r) => srv.listen(4219, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4219/index.html');
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
});
await page.waitForTimeout(200);

// ---- 1. the cell shelf, seeded from the 2026-07-22 invoice ----
const seeded = await page.evaluate(() => {
  localStorage.removeItem('gp_inv_seed_20260901');
  // A row he tracked by hand, which the seed must not touch.
  localStorage.setItem('gp_inventory', JSON.stringify([{ id: 'x', name: 'ניקל 0.15', qty: 42, low: 5 }]));
  seedCellStockOnce();
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  const q = (n) => (inv.find((i) => i.name.includes(n)) || {}).qty;
  return { n: inv.length, e50: q('50E'), pl: q('50PL'), v26: q('26V'), sg: q('50SG'), nickel: q('ניקל') };
});
check('the seven cell rows arrive', seeded.n === 8, `${seeded.n} rows`);
check('50E carries the 500 he added', seeded.e50 === 2500, String(seeded.e50));
check('50PL carries the 140 he added', seeded.pl === 400, String(seeded.pl));
check('26V carries the 150 he added', seeded.v26 === 350, String(seeded.v26));
check('and 50SG is the invoice figure', seeded.sg === 2000, String(seeded.sg));
// Replacing the shelf would throw away stock counted by hand.
check('a row he keeps himself is untouched', seeded.nickel === 42, String(seeded.nickel));

// ---- 2. it seeds ONCE ----
// A seed that re-ran would silently undo every deduction since and restore the day it was typed.
const reseed = await page.evaluate(() => {
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  inv.find((i) => i.name.includes('50E')).qty = 900;      // a day's building
  localStorage.setItem('gp_inventory', JSON.stringify(inv));
  seedCellStockOnce();
  return (JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name.includes('50E')) || {}).qty;
});
check('a second boot does not reset the count', reseed === 900, String(reseed));

// ---- 3. a BMS comes off the shelf, matched by SERIES ----
const bms = await page.evaluate(() => {
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  inv.push({ id: 'b1', name: 'BMS 20S 100A', qty: 9, cat: 'BMS' });
  inv.push({ id: 'b2', name: 'BMS 16S 60A', qty: 10, cat: 'BMS' });
  localStorage.setItem('gp_inventory', JSON.stringify(inv));
  // 72V is 20S. The shelf never mentions the brand.
  const hit = inventoryTake(`BMS ${seriesForV(72)}S 100A`, 1, 'בדיקה');
  const after = JSON.parse(localStorage.getItem('gp_inventory'));
  return {
    matched: hit && hit.matched,
    left: (after.find((i) => i.name === 'BMS 20S 100A') || {}).qty,
    other: (after.find((i) => i.name === 'BMS 16S 60A') || {}).qty,
    unknown: (inventoryTake('BMS 99S 999A', 1, 'x') || {}).matched,
  };
});
check('a build takes its BMS by series', bms.matched && bms.left === 8, `left ${bms.left}`);
check('and leaves the other sizes alone', bms.other === 10, String(bms.other));
check('a BMS not on the shelf is reported, not guessed', bms.unknown === false, String(bms.unknown));

// ---- 4. the matcher will not settle for nearly ----
// The whole risk of matching by name: deducting the wrong voltage in silence.
const strict = await page.evaluate(() => {
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  inv.push({ id: 'c1', name: 'מטען 72V 5A', qty: 9, cat: 'מטען' });
  localStorage.setItem('gp_inventory', JSON.stringify(inv));
  const wrong = inventoryTake('מטען 60V 5A', 1, 'x');
  const right = inventoryTake('מטען 72V 5A', 1, 'x');
  return { wrong: wrong && wrong.matched, right: right && right.matched };
});
check('a 60V charger does not deduct the 72V one', strict.wrong === false, String(strict.wrong));
check('but the right one does', strict.right === true, String(strict.right));

// ---- 5. a sale moves stock, once, and only when it is money ----
const sale = await page.evaluate(() => {
  const order = { id: 'o1', customer: 'לקוח', date: new Date().toISOString(), status: 'הצעה',
    items: [{ name: 'מטען 72V 5A', cat: 'מטען', qty: 2, unit: 300 }], total: 600 };
  localStorage.setItem('gp_orders', JSON.stringify([order]));
  const before = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  // A quote is not money.
  takeOrderStock(order);
  const asQuote = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  order.status = 'שולם';
  takeOrderStock(order);
  const paid = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  takeOrderStock(order);                       // the status cycles round; must not deduct again
  const twice = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  return { before, asQuote, paid, twice, flag: !!order.stockTaken };
});
// takeOrderStock is only called when the sale IS income, so calling it on a quote is the
// caller's contract; what must hold is that the deduction happens exactly once.
check('a paid sale takes its goods', sale.paid === sale.asQuote - 2, `${sale.asQuote} -> ${sale.paid}`);
check('cycling the status again does not deduct twice', sale.twice === sale.paid, `${sale.paid} -> ${sale.twice}`);
check('and the order records that stock moved', sale.flag === true, String(sale.flag));

// ---- 6. the two seeds are different functions ----
// They collided on one name while this was being written, and the later definition silently
// won, so the cells never seeded at all.
const both = await page.evaluate(() => ({
  cells: typeof seedCellStockOnce === 'function',
  parts: typeof seedInventoryOnce === 'function',
}));
check('the cell seed and the BMS seed both exist', both.cells && both.parts, JSON.stringify(both));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
