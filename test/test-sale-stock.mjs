// A sold battery takes its cells and its board off the shelf (2026-09-19).
//
//   node test/test-sale-stock.mjs
//   node test/test-sale-stock.mjs --selftest
//
// Daniel asked whether every sale and repair deducts cells and BMS. Measured against the hub,
// the repair path did and the sales path did not:
//
//   full build (repair)   EVE 50E 1000 -> 880, BMS 10 -> 9      correct
//   BMS swap (repair)     cells untouched, BMS 10 -> 9          correct
//   SALE of 72V 30Ah      NOTHING — and stockTaken = true        wrong
//
// takeOrderStock looked for a shelf row named "72V 30Ah". He stocks cells and boards, not
// finished packs, so nothing matched — and stockTaken was set anyway, so cycling the status
// would never deduct it either. Same shape as the totalSpent bug: one path maintained, the
// other not, and the two answers disagree only months later.
//
// The anchor of this suite is that a SALE and the equivalent REPAIR move the shelf identically.
// Asserting the numbers separately would let the two drift again, which is the whole defect.
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
await new Promise((r) => srv.listen(4354, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4354/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // The bug: a battery that is not on the shelf under its own name consumes nothing.
  // And the old orderStockFixes (v484), which took any log line of that shelf row, that count and that
  // customer, from any day and any event, power tools included — run on the real batteryStockParts, so
  // the "left alone" checks below must go red with it.
  await page.evaluate(() => {
    const parts = window.batteryStockParts;
    window.batteryStockParts = () => null;
    window.orderStockFixes = (o) => {
      if (!o || !o.stockTaken || o.stockFixed || !Array.isArray(o.items)) return [];
      const inv = getInventory(), log = Store.get('inv_log') || [];
      const who = String(o.customer || '').slice(0, 40);
      const out = [];
      for (const it of o.items) {
        if (it.custom) continue;
        const right = parts(it);
        if (!right || !/^EVE (26V|25P)$/.test(right.cellModel)) continue;
        const m = String(it.name || '').match(/(\d+)V\s*(\d+(?:\.\d+)?)Ah/);
        if (!m) continue;
        const qty = Number(it.qty) || 1;
        const oldModel = /PRO/.test(it.cat) ? 'EVE 50PL' : /ADVANCED/.test(it.cat) ? 'Tenpower 50SG' : 'EVE 50E';
        const oldCells = seriesForV(+m[1]) * Math.ceil(+m[2] / 5) * qty;
        const oldRow = invFindCellRow(inv, oldModel);
        if (!oldRow) continue;
        const key = String(oldRow.id != null ? oldRow.id : oldRow.name);
        const line = log.find((e) => e.row === key && Number(e.qty) === oldCells && String(e.note || '') === who && !out.some((x) => x.logId === e.id));
        if (line) out.push({ logId: line.id, item: it.name, wrongName: oldRow.name, wrongCells: oldCells, rightModel: right.cellModel, rightCells: right.cells * qty });
      }
      return out;
    };
  });
}

const R = await page.evaluate(() => {
  const seed = () => Store.set('inventory', [
    { name: 'תאי EVE 21700 50E', qty: 1000 },
    { name: 'EVE 50PL', qty: 500 },
    { name: 'תאי EVE 18650 26V', qty: 350 },
    { name: 'תאי EVE 18650 25P', qty: 100 },
    { name: 'BMS 20S 100A', qty: 10 },
    { name: 'BMS 13S 60A', qty: 10 },
    { name: 'מטען 72V 5A', qty: 4 },
  ]);
  const snap = () => Object.fromEntries(getInventory().map((r) => [r.name, r.qty]));
  const sell = (pick, qty) => {
    seed();
    const o = { id: 's', customer: 'לקוח', status: 'שולם',
      items: [{ name: pick.name, cat: pick.cat, qty: qty || 1, price: pick.retail }] };
    takeOrderStock(o);
    return { after: snap(), stockTaken: o.stockTaken };
  };
  const row = (nameRe, catRe) => PRICING.find((x) => nameRe.test(x.name) && catRe.test(x.cat));

  const classic = row(/^72V 30Ah$/, /אופניים.*CLASSIC/);
  const pro = row(/^72V 30Ah$/, /אופניים.*PRO/);
  const small = row(/^48V 20Ah$/, /אופניים.*CLASSIC/);
  // The 18650 scooter rows (v479): CLASSIC and ADVANCED by category, EVE 26V / 25P by build.
  const s26 = row(/^48V 26Ah · 13S10P EVE 26V$/, /קורקינטים 18650.*CLASSIC/);
  const s25 = row(/^36V 15Ah · 10S6P EVE 25P$/, /קורקינטים 18650.*ADVANCED/);

  // The repair side, through the SHIPPING helpers with what saveJob computes for the same pack.
  seed();
  inventoryDeduct('EVE 50E', seriesForV(72) * Math.ceil(30 / 5), 'בנייה');
  inventoryTake('BMS ' + seriesForV(72) + 'S 100A', 1, 'בנייה');
  const repair = snap();

  return {
    repair,
    sale: sell(classic),
    salePro: sell(pro),
    sale48: sell(small),
    saleTwo: sell(classic, 2),
    sale26: s26 ? sell(s26) : null,
    // A sale stocked BEFORE the fix (v479): the old rule took 78 EVE 50E for this 13S10P and logged it.
    old26: s26 ? (() => {
      seed();
      const inv = getInventory();
      inv.find((r) => r.name === 'תאי EVE 21700 50E').qty = 922;
      Store.set('inventory', inv);
      Store.set('inv_log', [{ id: 'iuold', at: '2026-10-19T10:00:00.000Z', row: 'תאי EVE 21700 50E', name: 'תאי EVE 21700 50E', qty: 78, note: 'ישראל כהן' }]);
      const o = { id: 'old1', customer: 'ישראל כהן', status: 'שולם', stockTaken: true, date: '2026-10-19T10:00:00.000Z',
        items: [{ name: s26.name, cat: s26.cat, qty: 1, price: s26.retail }] };
      Store.set('orders', [o]);
      const found = orderStockFixes(o).length;
      const selfTest = (Store.get('orders') || []).filter((x) => orderStockFixes(x).length).length;
      fixOrderStock('old1');
      const after = snap();
      const again = orderStockFixes((Store.get('orders') || [])[0]).length;
      return { found, selfTest, after, again, log: (Store.get('inv_log') || []).map((e) => e.name + ':' + e.qty) };
    })() : null,
    // A sale stocked AFTER the fix has no such line, and is left alone.
    new26: s26 ? (() => {
      sell(s26);
      const o = { id: 'new1', customer: 'לקוח', status: 'שולם', stockTaken: true, items: [{ name: s26.name, cat: s26.cat, qty: 1 }] };
      return { found: orderStockFixes(o).length };
    })() : null,
    // Sales the old rule did NOT stock, beside a 50E line of the same customer and the same count from
    // something else (2026-10-22 review). Each must be left alone — the button would give back 50E cells
    // that were really used and take the pack's own cells a second time.
    falseFlags: s26 ? (() => {
      const pt = PRICING.find((x) => /כלי עבודה/.test(x.cat) && /^21V 10Ah/.test(x.name));
      const run = (label, orderDate, lines, item) => {
        seed();
        Store.set('inv_log', lines);
        const o = { id: 'fp-' + label, customer: 'סוחר', status: 'שולם', stockTaken: true, date: orderDate, items: [item] };
        Store.set('orders', [o]);
        const found = orderStockFixes(o).length;
        const before = snap();
        if (found) fixOrderStock(o.id);
        return { found, moved: JSON.stringify(before) !== JSON.stringify(snap()) };
      };
      const line50E = (id, at, qty) => ({ id, at, row: 'תאי EVE 21700 50E', name: 'תאי EVE 21700 50E', qty, note: 'סוחר' });
      const line26V = (id, at, qty) => ({ id, at, row: 'תאי EVE 18650 26V', name: 'תאי EVE 18650 26V', qty, note: 'סוחר' });
      const item26 = { name: s26.name, cat: s26.cat, qty: 1 };
      return {
        // the review's case: a CLASSIC 48V 30Ah (13S6P, 78 50E) and, after v479, the 18650 pack stocked right
        afterV479: run('after', '2026-10-23T09:00:00.000Z', [line50E('l1', '2026-10-20T09:00:00.000Z', 78), line26V('l2', '2026-10-23T09:00:01.000Z', 130)], item26),
        // an old 18650 sale whose only matching 50E line is from before the sale — another purchase
        beforeSale: run('before', '2026-10-19T10:00:00.000Z', [line50E('l3', '2026-10-10T10:00:00.000Z', 78)], item26),
        // an old sale that a device already on v479 stocked right, beside a 50E line of the same week
        stockedRight: run('right', '2026-10-21T10:00:00.000Z', [line26V('l4', '2026-10-21T10:00:00.000Z', 130), line50E('l5', '2026-10-21T15:00:00.000Z', 78)], item26),
        // a power tool: the old rule took 25P for those all along; a 10-cell 50E line is a repair's
        powerTool: pt ? run('pt', '2026-10-19T10:00:00.000Z', [line50E('l6', '2026-10-19T12:00:00.000Z', 10)], { name: pt.name, cat: pt.cat, qty: 1 }) : null,
      };
    })() : null,
    sale25: s25 ? sell(s25) : null,
    // An ACCESSORY is stocked as a unit and must keep matching by name. Taken from the real
    // catalogue rather than invented — the first version of this check used a category that
    // does not exist, found nothing, and reported null instead of testing anything.
    accessory: (() => {
      const c = PRICING.find((x) => /^מנועים/.test(x.cat));
      if (!c) return null;
      seed();
      const inv = getInventory();
      inv.push({ name: c.name, qty: 4 });          // he stocks this one as a unit
      Store.set('inventory', inv);
      const o = { id: 'a', customer: 'לקוח', status: 'שולם',
        items: [{ name: c.name, cat: c.cat, qty: 1, price: c.retail }] };
      takeOrderStock(o);
      return { name: c.name, after: snap() };
    })(),
  };
});

// ---------------------------------------------------------------- the anchor
check('a SALE moves the shelf exactly as the equivalent REPAIR does',
  JSON.stringify(R.sale.after) === JSON.stringify(R.repair), { sale: R.sale.after, repair: R.repair });

// ---------------------------------------------------------------- and the detail
check('the cells come off — 20S6P is 120 of them',
  R.sale.after['תאי EVE 21700 50E'] === 880, R.sale.after);
check('the board comes off too, named by series count and amps',
  R.sale.after['BMS 20S 100A'] === 9, R.sale.after);
check('a PRO pack takes PRO cells, not CLASSIC ones',
  R.salePro.after['EVE 50PL'] === 380 && R.salePro.after['תאי EVE 21700 50E'] === 1000, R.salePro.after);
// 48V is 13S and takes the 60A board — the amps step with voltage, as in cost-model.
check('a 48V pack takes the 13S 60A board, not the 20S 100A',
  R.sale48.after['BMS 13S 60A'] === 9 && R.sale48.after['BMS 20S 100A'] === 10, R.sale48.after);
check('selling two packs takes two packs worth',
  R.saleTwo.after['תאי EVE 21700 50E'] === 760 && R.saleTwo.after['BMS 20S 100A'] === 8, R.saleTwo.after);

// Daniel, 2026-10-18: "בחרתי תאים 18650-26V, וירד במלאי תאים של 50E". The 18650 row's category
// says CLASSIC, and the tier word alone picked the 50E shelf — at 5Ah a cell, so 78 of them.
check('an 18650 EVE 26V pack takes 26V cells — its 13S10P, 130 of them',
  !!R.sale26 && R.sale26.after['תאי EVE 18650 26V'] === 220, R.sale26);
check('…and leaves the 50E shelf alone',
  !!R.sale26 && R.sale26.after['תאי EVE 21700 50E'] === 1000, R.sale26);
check('an 18650 EVE 25P pack takes 25P cells — its 10S6P, 60 of them',
  !!R.sale25 && R.sale25.after['תאי EVE 18650 25P'] === 40 && R.sale25.after['Tenpower 50SG'] === undefined
  && R.sale25.after['תאי EVE 21700 50E'] === 1000, R.sale25);

// ישראל כהן's sale (Daniel, 2026-10-22: "תבדוק בעסקה של ישראל כהן האם הטעות תוקנה"): a sale stocked before
// the fix keeps its wrong cells until it is put right. Found by the old rule's own log line, fixed once.
check('an 18650 sale stocked before the fix is found by its log line', !!R.old26 && R.old26.found === 1 && R.old26.selfTest === 1, R.old26);
check('the fix gives the 78 50E back and takes its 130 26V',
  !!R.old26 && R.old26.after['תאי EVE 21700 50E'] === 1000 && R.old26.after['תאי EVE 18650 26V'] === 220, R.old26 && R.old26.after);
check('the wrong log line is gone, the right one is there, and it cannot run twice',
  !!R.old26 && R.old26.again === 0 && !R.old26.log.includes('תאי EVE 21700 50E:78') && R.old26.log.includes('תאי EVE 18650 26V:130'), R.old26);
check('a sale stocked after the fix is left alone', !!R.new26 && R.new26.found === 0, R.new26);
// What the button must never touch: a sale the old rule did not stock, beside a 50E line of the same
// customer and count that belongs to something else.
const FF = R.falseFlags || {};
check('an 18650 sale after v479, beside the customer\'s CLASSIC 48V 30Ah, is not flagged',
  !!FF.afterV479 && FF.afterV479.found === 0 && !FF.afterV479.moved, FF.afterV479);
check('an old 18650 sale is not matched to a 50E line from before it', !!FF.beforeSale && FF.beforeSale.found === 0 && !FF.beforeSale.moved, FF.beforeSale);
check('an old sale already stocked with its own 26V is not flagged', !!FF.stockedRight && FF.stockedRight.found === 0 && !FF.stockedRight.moved, FF.stockedRight);
check('a power-tool sale is never flagged (the old rule took 25P for it)', !!FF.powerTool && FF.powerTool.found === 0 && !FF.powerTool.moved, FF.powerTool);

// ---------------------------------------------------------------- what must NOT change
check('an accessory still matches by NAME and is not decomposed',
  !!R.accessory && R.accessory.after[R.accessory.name] === 3
  && R.accessory.after['תאי EVE 21700 50E'] === 1000, R.accessory);
check('the sale is still marked taken, so a second status lap cannot double-deduct',
  R.sale.stockTaken === true, R.sale);

if (SELFTEST) console.log('\n[selftest] batteryStockParts was forced to null — a sold pack consumes nothing;\n[selftest] the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
