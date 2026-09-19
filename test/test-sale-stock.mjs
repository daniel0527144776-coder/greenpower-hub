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
  await page.evaluate(() => { window.batteryStockParts = () => null; });
}

const R = await page.evaluate(() => {
  const seed = () => Store.set('inventory', [
    { name: 'תאי EVE 21700 50E', qty: 1000 },
    { name: 'EVE 50PL', qty: 500 },
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
