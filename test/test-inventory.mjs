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

// ---- 7. missing rows come back from a backup, and nothing on the shelf is touched ----
// 2026-09-25: four of seven cell models had gone from the shelf list; the 10.9 backup held them.
await page.evaluate(() => {
  Store.set('inventory', [
    { id: 'c1', name: 'תאי EVE 21700 50E', qty: 1500, low: 300, cat: 'תאים' },
    { id: 'c2', name: 'תאי Tenpower 21700 50SG', qty: 1800, low: 300, cat: 'תאים' },
    { id: 'c3', name: 'תאי EVE 21700 50PL', qty: 220, low: 120, cat: 'תא' },
  ]);
  navigateTo('inventory');
});
const backup = JSON.stringify({ lastBackup: Date.UTC(2026, 8, 10), inventory: [
  { id: 'c1', name: 'תאי EVE 21700 50E', qty: 2500, cat: 'תאים' },
  { id: 'c2', name: 'תאי Tenpower 21700 50SG', qty: 2000, cat: 'תאים' },
  { id: 'c3', name: 'תאי EVE 21700 50PL', qty: 400, cat: 'תאים' },
  { id: 'c4', name: 'תאי EVE 21700 40P', qty: 50, cat: 'תאים' },
  { id: 'c5', name: 'תאי EVE 18650 35V', qty: 200, cat: 'תאים' },
  { id: 'c6', name: 'תאי EVE 18650 26V', qty: 350, cat: 'תאים' },
  { id: 'c7', name: 'תאי EVE 18650 25P', qty: 100, cat: 'תאים' }] });
const restoreOnce = async () => {
  await page.setInputFiles('#invRestoreFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (typeof _noticeYes === 'function') noticeConfirm(); closeNotice(); });
  await page.waitForTimeout(150);
  return page.evaluate(() => (Store.get('inventory') || []).map((r) => [r.name.split(' ').pop(), r.qty]));
};
// The restore reads the shelf blind — as if it were empty — so it re-adds every row on top.
if (SELFTEST) await page.evaluate(() => { window.getInventory = () => []; });
const r1 = await restoreOnce();
const r2 = await restoreOnce();
const q = (rows, m) => (rows.find(([n]) => n === m) || [])[1];
check('the four missing cell models come back', r1.length === 7, JSON.stringify(r1));
check('a model already on the shelf keeps its own count', q(r1, '50E') === 1500 && q(r1, '50PL') === 220, JSON.stringify(r1));
check('running it again adds nothing', r2.length === 7, JSON.stringify(r2));
const cats = await page.evaluate(() => [...new Set((Store.get('inventory') || []).map(invCatOf))]);
check('"תאים" and "תא" are one category, not two', cats.length === 1 && cats[0] === 'תא', JSON.stringify(cats));

// ---- 8. the missing cell models come back on their own; only "out of stock" is an alert ----
const auto = await page.evaluate(() => {
  const s = Store.get('settings') || {}; delete s.cellModelsRestored20260925; Store.set('settings', s);
  Store.set('inventory', [
    { id: 'x1', name: 'EVE 50E', qty: 900, low: 300, cat: 'תא' },           // named differently
    { id: 'x2', name: 'תאי Tenpower 21700 50SG', qty: 100, low: 300, cat: 'תאים' },   // LOW, not out
    { id: 'x3', name: 'תאי EVE 21700 50PL', qty: 0, low: 120, cat: 'תאים' },          // OUT
  ]);
  restoreMissingCellModels();
  closeNotice();
  const once = getInventory().length;
  restoreMissingCellModels();
  const twice = getInventory().length;
  navigateTo('inventory');
  const alert = document.getElementById('inventoryLowAlert').innerText;
  return { once, twice, fifty: getInventory().filter((r) => /50e/i.test(r.name)).length, alert };
});
check('the four missing cell models are added back', auto.once === 7, auto);
check('a model already there under another name is not duplicated', auto.fifty === 1, auto);
check('and it happens once — a second run adds nothing', auto.twice === 7, auto);
check('"out of stock" is still announced', /אזל/.test(auto.alert), auto.alert);
check('"low stock" is not', !/מלאי נמוך/.test(auto.alert), auto.alert);

// ---- 9. inside a category: chargers by voltage, cells by format, BMS by series ----
const grouped = await page.evaluate(() => {
  Store.set('inventory', [
    { id: 'g1', name: 'תאי EVE 21700 50E', qty: 10, cat: 'תאים' }, { id: 'g2', name: 'תאי EVE 18650 25P', qty: 5, cat: 'תאים' },
    { id: 'g3', name: 'BMS DALY 13S 60A', qty: 2, cat: 'BMS' }, { id: 'g4', name: 'BMS JK B2A24S20P 200A', qty: 1, cat: 'BMS' },
    { id: 'g5', name: 'מטען 60V 5A', qty: 3, cat: 'מטען' }, { id: 'g6', name: 'מטען 72V 5A', qty: 1, cat: 'מטען' },
  ]);
  navigateTo('inventory');
  ['תא', 'BMS', 'מטען'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  return [...document.querySelectorAll('.inv-sub span:first-child')].map((x) => x.textContent.trim()).join(',');
});
check('BMS by series, chargers by voltage, cells by format', grouped === '13S,24S,60V,72V,18650,21700', grouped);

// ---- 10. adding an item: a sub-category can be chosen, and editing keeps the category ----
const sub = await page.evaluate(() => {
  Store.set('inventory', [{ id: 'k1', name: 'תאי EVE 21700 50E', qty: 10, cat: 'תאים' }]);
  // a new BMS whose name carries no S count — filed by the chosen sub-category
  openInventoryEditor('');
  document.getElementById('invCat').value = 'BMS'; invCatChanged();
  document.getElementById('invName').value = 'DALY חדש';
  document.getElementById('invQty').value = '4';
  document.getElementById('invSub').value = '16S';
  saveInventory('');
  // editing the old cell row must not move it into BMS
  openInventoryEditor('k1');
  const catShown = document.getElementById('invCat').value;
  saveInventory('k1');
  navigateTo('inventory');
  ['תא', 'BMS'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  return { catShown, cellCat: invCatOf(getInventory().find((x) => x.id === 'k1')),
    heads: [...document.querySelectorAll('.inv-sub span:first-child')].map((x) => x.textContent.trim()).join(',') };
});
check('a new item can be filed under a sub-category its name does not show', /16S/.test(sub.heads), sub);
check('editing a cell saved as "תאים" keeps it a cell', sub.catShown === 'תא' && sub.cellCat === 'תא', sub);

// ---- 10b. a repair's cell finds its shelf row (bug found 2026-10-04) ----
// The repair calculator names its cell "21700-50pl"; the shelf says "תאי EVE 21700 50PL". Split on
// spaces only, the whole "21700-50pl" was the tail and matched nothing, so no full build saved
// from a repair ever took a cell off the shelf. "18650-6" must still match nothing.
const rep = await page.evaluate(() => {
  Store.set('inventory', [{ id: 'r1', name: 'תאי EVE 21700 50PL', qty: 400, cat: 'תאים' },
    { id: 'r2', name: 'תאי EVE 21700 50E', qty: 2500, cat: 'תאים' }, { id: 'r3', name: 'תאי EVE 18650 25P', qty: 100, cat: 'תאים' }]);
  const pl = inventoryDeduct('21700-50pl', 64, 'בדיקה');
  const p25 = inventoryDeduct('18650-25p', 10, 'בדיקה');
  const six = inventoryDeduct('18650-6', 10, 'בדיקה');
  const inv = getInventory();
  return { pl: pl && pl.matched, p25: p25 && p25.matched, six: six && six.matched, q: inv.map((r) => r.qty) };
});
check('a repair\'s "21700-50pl" comes off "תאי EVE 21700 50PL"', rep.pl === true && rep.q[0] === 336, JSON.stringify(rep));
check('and "18650-25p" off the 18650 25P row', rep.p25 === true && rep.q[2] === 90, JSON.stringify(rep));
check('"18650-6" matches no row rather than a near one', rep.six === false && rep.q[1] === 2500, JSON.stringify(rep));

// ---- 11. ordering by pace (2026-10-04, "הזמנת מלאי לפי קצב") ----
// Every automatic deduction leaves a dated line; before the log, sales and repairs are read back
// with the same decomposition that deducted them; a hand recount is not usage; and what to order
// covers the delivery time plus three months. --selftest: the deductions stop logging.
const pace = await page.evaluate((SELF) => {
  if (SELF) window.invLogUse = () => {};
  const day = 864e5, now = Date.now(), iso = (d) => new Date(now - d * day).toISOString();
  // a) a deduction is logged; a hand recount is not
  Store.set('inv_log', []);
  Store.set('inventory', [{ id: 'p1', name: 'תאי EVE 21700 50E', qty: 1000, cat: 'תאים' }, { id: 'p2', name: 'BMS 20S 100A', qty: 5, cat: 'BMS' }]);
  inventoryDeduct('EVE 50E', 120, 'בדיקה');
  inventoryTake('BMS 20S 100A', 1, 'בדיקה');
  adjustInventory('p1', -1);
  const logged = (Store.get('inv_log') || []).map((e) => [e.row, e.qty]);
  // b) before any log line, the records say what was used: a delivered 72V sale and a full build
  Store.set('inv_log', []);
  Store.set('orders', [{ id: 'o1', date: iso(20), status: 'נמסר', customer: 'x', total: 1,
    items: [{ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1, unit: 1 }] },
    { id: 'o2', date: iso(10), status: 'הצעה', customer: 'y', total: 1, items: [{ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1, unit: 1 }] }]);
  Store.set('jobs', [{ id: 'j1', date: iso(5), jobs: ['full'], voltage: '60', capacity: '20', cellType: '21700-50e', bmsBrand: 'daly', bmsAmps: '60' }]);
  const back = invUsage();
  const sale = batteryStockParts({ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1 });
  const job = jobStockParts(Store.get('jobs')[0]);
  // c) the forecast: 900 cells over 80 days on a shelf of 500, cells arriving in 60 days
  Store.set('orders', []); Store.set('jobs', []);
  Store.set('inventory', [{ id: 'p1', name: 'תאי EVE 21700 50E', qty: 500, cat: 'תאים' },
    { id: 'p3', name: 'מטען 72V 5A', qty: 0, cat: 'מטען' }]);
  Store.set('inv_log', [{ id: 'l1', at: iso(80), row: 'p1', name: 'תאי EVE 21700 50E', qty: 600 },
    { id: 'l2', at: iso(10), row: 'p1', name: 'תאי EVE 21700 50E', qty: 300 }]);
  const fc = invForecast(getInventory()[0]);
  const text = orderListText();
  navigateTo('inventory');
  if (!INV_OPEN.has('תא')) toggleInvCat(encodeURIComponent('תא'));
  const pageText = document.getElementById('page-inventory').innerText;
  Store.set('inv_log', []); Store.set('orders', []); Store.set('jobs', []);
  return { logged, back, saleCells: sale && sale.cells, jobCells: job.cells, fc, text, pageText };
}, SELFTEST);
check('a deduction leaves a dated usage line, a hand recount does not', JSON.stringify(pace.logged) === JSON.stringify([['p1', 120], ['p2', 1]]), JSON.stringify(pace.logged));
check('before the log, a delivered sale and a full build count as used — a quote does not',
  pace.back.used.p1 === pace.saleCells + pace.jobCells && pace.saleCells > 0 && pace.jobCells === 64, JSON.stringify(pace.back));
check('the BMS of the sale and of the build are counted on their own rows', pace.back.used.p2 === 1, JSON.stringify(pace.back.used));
check('900 cells in 80 days is ~338 a month, and 500 lasts 44 days', pace.fc && Math.abs(pace.fc.perMonth - 337.5) <= 1 && pace.fc.daysLeft === 44, JSON.stringify(pace.fc));
check('cells that will not outlast a 60-day delivery are to be ordered now', pace.fc && pace.fc.orderNow === true, JSON.stringify(pace.fc));
check('enough for the delivery plus three months, by the box of 50', pace.fc && pace.fc.want === 1200, JSON.stringify(pace.fc));
check('the order message carries the pace', /תאי EVE 21700 50E — 1200 יח׳ \(נשארו 500, יוצאים כ-33[78] בחודש\)/.test(pace.text), pace.text);
check('a row with no pace still goes on the order by the old rule', /מטען 72V 5A — 4 יח׳ \(נשארו 0\)/.test(pace.text), pace.text);
check('the shelf row says its pace and to order now', /~33[78] בחודש · מספיק לכ-6 שבועות · ⏰ להזמין עכשיו \(1200\)/.test(pace.pageText), pace.pageText.slice(0, 300));

// ---- 12. one order message per supplier (2026-10-04, "הזמנה לפי ספק") ----
// No supplier name is in the hub's code: they come from his synced price list, his per-category
// choice, or a row's own field. Chargers sit with two suppliers, so they wait for his choice.
// --selftest: every row loses its supplier.
const sup = await page.evaluate((SELF) => {
  if (SELF) window.invSupplierOf = () => '';
  Store.set('inv_log', []); Store.set('orders', []); Store.set('jobs', []);
  const st = Store.get('settings') || {}; delete st.invSupplierByCat; Store.set('settings', st);
  Store.set('supplier_prices', [
    { who: 'ספק-תאים', cat: 'ספק-תאים · 21700 · ימי', name: 'EVE 50E', ils: 7 },
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · BMS DALY', name: 'DALY 60A', ils: 50 },
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · מטענים', name: 'מטען 72V', ils: 90 },
    { who: 'ספק-אחר', cat: 'ספק-אחר · מחירון · מטענים', name: 'מטען 60V', ils: 80 },
    // a parts supplier naming the cell size without selling cells must not make cells ambiguous
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · מאזני סוללות', name: 'מחזיק 21700', ils: 3 }]);
  Store.set('inventory', [
    { id: 's1', name: 'תאי EVE 21700 50E', qty: 0, low: 100, cat: 'תאים' },
    { id: 's2', name: 'BMS 20S 100A', qty: 0, cat: 'BMS' },
    { id: 's3', name: 'מטען 72V 5A', qty: 0, cat: 'מטען' },
    { id: 's4', name: 'BMS 13S 60A', qty: 0, cat: 'BMS', supplier: 'ספק-מיוחד' },
    { id: 's5', name: 'BMS 20S 60A (יד 2)', qty: 0, cat: 'BMS' }]);
  const g1 = orderGroups().map((g) => [g.supplier, g.lines.map((l) => l.name).join('+')]);
  copyOrderList();
  const modal1 = { boxes: document.querySelectorAll('[id^="orderTxt"]').length, pick: !!document.querySelector('#modalBody select, .modal select') };
  setInvCatSupplier('מטען', 'ספק-אחר');
  const g2 = orderGroups().map((g) => [g.supplier, g.lines.map((l) => l.name).join('+')]);
  const text = orderListText();
  closeModal();
  // nothing to order: a notice, not a dialog
  Store.set('inventory', [{ id: 'z', name: 'תאי EVE 21700 50E', qty: 5000, low: 10, cat: 'תאים' }]);
  copyOrderList();
  const emptyNotice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  closeNotice();
  // a nameless item: a notice too
  openInventoryEditor(''); document.getElementById('invName').value = ''; saveInventory('');
  const nameNotice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  closeNotice(); closeModal();
  // the editor stores a row's own supplier
  openInventoryEditor('z'); document.getElementById('invSupplier').value = 'ספק-מיוחד'; saveInventory('z');
  const saved = (getInventory().find((r) => r.id === 'z') || {}).supplier;
  const st2 = Store.get('settings') || {}; delete st2.invSupplierByCat; Store.set('settings', st2);
  Store.set('supplier_prices', []);
  return { g1, modal1, g2, text, emptyNotice, nameNotice, saved };
}, SELFTEST);
check('cells and BMS go to the one supplier whose list carries them; a row may name its own',
  JSON.stringify(pace && sup.g1) === JSON.stringify([['ספק-חלקים', 'BMS 20S 100A'], ['ספק-מיוחד', 'BMS 13S 60A'], ['ספק-תאים', 'תאי EVE 21700 50E'], ['', 'מטען 72V 5A']]), JSON.stringify(sup.g1));
check('second-hand stock ("יד 2") is never on an order', !JSON.stringify(sup.g1).includes('יד 2'), JSON.stringify(sup.g1));
check('chargers, carried by two suppliers, wait for his choice — one message box per supplier', sup.modal1.boxes === 4 && sup.modal1.pick, JSON.stringify(sup.modal1));
check('choosing a supplier for a category moves its rows there', JSON.stringify(sup.g2.find(([w]) => w === 'ספק-אחר')) === JSON.stringify(['ספק-אחר', 'מטען 72V 5A']) && !sup.g2.some(([w]) => w === ''), JSON.stringify(sup.g2));
check('each supplier gets its own message', /הזמנה מ-ספק-תאים:\n• תאי EVE 21700 50E/.test(sup.text) && /הזמנה מ-ספק-אחר:\n• מטען 72V 5A/.test(sup.text), sup.text);
check('"nothing to order" is said in a notice', /אין מה להזמין/.test(sup.emptyNotice), sup.emptyNotice);
check('saving an item with no name says so in a notice', /הזן שם פריט/.test(sup.nameNotice), sup.nameNotice);
check('the item editor stores a row\'s own supplier', sup.saved === 'ספק-מיוחד', String(sup.saved));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
