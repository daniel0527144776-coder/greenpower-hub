// The supplier price-list import, and the fields it used to throw away.
//
//   node test/test-supplier-import.mjs [--selftest]
//
// `importSupplierPrices` rebuilt every row from four fields — who, cat, name, and one of
// usd/ils — so a `kg` in the file never reached storage. Nothing failed: the per-kilo freight
// simply fell back to a category share and produced a plausible landed cost that was wrong.
// That is the same shape as the supplierRows() whitelist one layer up, and the reason this
// suite asserts on the STORED row rather than on the screen.
//
// `on` is the quote date — the only thing that says whether a price is from 2022 or today —
// and `img` is the catalogue photo. The hub renders neither, which is exactly why a
// round-trip through it must not destroy them.
//
// --selftest asserts the opposite outcome so the checks can be watched failing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(DIST, u === '/index.html' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4192, r));

const { check, finish } = checker();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();

// A dialog the WebView cannot draw is a dead end on the only device that matters, so record
// them rather than accepting them.
const dialogs = [];
p.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });

await p.goto('http://127.0.0.1:4192/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof window.importSupplierPrices === 'function');
// The textarea lives inside the import modal, so open it the way a person would.
await p.evaluate(() => window.openSupplierImport());
await p.waitForSelector('#supJson');

// A motor with a weight, a controller with a quoted shipping price, and a row carrying only
// what the old import kept — so a pass cannot come from the file being uniform.
const FILE = [
  { who: 'QS Motor', cat: 'מנועים', name: 'QS205 3000W V3', usd: 195, kg: 16, on: '2026-08-27', img: 'https://example.com/qs205.jpg' },
  { who: 'QS Motor', cat: 'בקרים', name: 'ND72450', usd: 115, kg: 2.5, frUsd: 26, on: '2026-01-04' },
  { who: 'ספק אחר', cat: 'כללי', name: 'פריט בלי משקל', ils: 40 },
  { who: 'ספק אחר', cat: 'כללי', name: 'שורה בלי מחיר' },
];

console.log('1. every field in the file reaches storage');
{
  await p.evaluate((data) => {
    document.getElementById('supJson').value = JSON.stringify(data);
    window.importSupplierPrices(false);
  }, FILE);
  const stored = await p.evaluate(() => Store.get('supplier_prices') || []);

  check('the priced rows are imported and the nameless-price row is refused', stored.length === (SELFTEST ? 4 : 3), stored.length);

  const motor = stored.find((r) => r.name === 'QS205 3000W V3') || {};
  check('the weight survives the import', motor.kg === (SELFTEST ? 99 : 16), motor.kg);
  check('the weight is a number, not the string from JSON', typeof motor.kg === 'number', typeof motor.kg);
  check('the quote date survives', motor.on === '2026-08-27', motor.on);
  check('the photo survives a round-trip', motor.img === 'https://example.com/qs205.jpg', motor.img);

  const ctrl = stored.find((r) => r.name === 'ND72450') || {};
  check('a quoted shipping price survives', ctrl.frUsd === 26, ctrl.frUsd);

  const plain = stored.find((r) => r.name === 'פריט בלי משקל') || {};
  check('a row with no weight is still imported', plain.ils === 40, plain.ils);
  check('and gains no weight it never had', plain.kg === undefined, plain.kg);
}

console.log('2. the weight actually reaches the landed cost');
{
  // This is the half the old bug hid. kg was missing, so supplierIls fell through to the
  // category share and returned a number that looked fine. Assert the arithmetic instead.
  const r = await p.evaluate(() => {
    const row = (supplierRows() || []).find((x) => x.name === 'QS205 3000W V3');
    return { row, withFreight: supplierIls(row, true, true), noFreight: supplierIls(row, true, false) };
  });
  check('supplierRows still carries the weight through to the view', r.row && r.row.kg === 16, r.row && r.row.kg);

  // goods 195 + freight 16kg x rate, all x USD x VAT
  const rate = await p.evaluate(() => FREIGHT_USD_PER_KG);
  const usd = await p.evaluate(() => SUPPLIER_USD);
  const expect = Math.round((195 + 16 * rate) * usd * 1.18);
  check(`freight is charged by the kilo (rate $${rate}/kg)`, Math.abs(r.withFreight - expect) <= 2, `${r.withFreight} vs ${expect}`);
  check('and the freight is a real share of it, not a rounding error', r.withFreight - r.noFreight > 100, r.withFreight - r.noFreight);
}

console.log('3. the import says what it took in');
{
  const txt = await p.textContent('#noticeBackdrop').catch(() => '');
  check('it reports the row count', /3/.test(txt || ''), (txt || '').slice(0, 120));
  check('it reports how many carried a weight, so a lost weight is visible', /משקל/.test(txt || ''), (txt || '').slice(0, 120));
}

console.log('4. two rows with the same name — the newest is the cost');
{
  // One row per product is built upstream now (generate/build-supplier-list.mjs), so the
  // five-rows-for-one-display case cannot reach here any more. What still can is an APPEND
  // import run twice, or the same part re-quoted: two rows, one name, two dates. .find()
  // took whichever sat first, which is the older one, and an inflated cost is the direction
  // nobody questions — it only makes a margin look worse than it is.
  const WANT = 'צג DKD (LIN-BUS)';
  await p.evaluate((want) => {
    Store.set('supplier_prices', [
      { who: 'QS Motor', cat: 'QS Motor · צגים', name: want, usd: 55, kg: 0.5, on: '2022-09-14', src: 'ציטוט' },
      { who: 'QS Motor', cat: 'QS Motor · צגים', name: want, usd: 34, kg: 0.5, on: '2025-04-02', src: 'חשבונית' },
    ]);
  }, WANT);
  const got = await p.evaluate(() => supplierCostFor('DKD (LIN-BUS)'));
  const rate = await p.evaluate(() => FREIGHT_USD_PER_KG);
  const usd = await p.evaluate(() => SUPPLIER_USD);
  const newest = Math.round((34 + 0.5 * rate) * usd * 1.18);
  const oldest = Math.round((55 + 0.5 * rate) * usd * 1.18);
  check('the 2025 price is used, not the 2022 one', got === (SELFTEST ? oldest : newest), `${got} (new ${newest}, old ${oldest})`);
  check('which is materially cheaper, not a rounding difference', got < oldest * 0.85, `${got} vs ${oldest}`);

  // Order in the file must not decide it — reverse them and the answer must not move.
  await p.evaluate(() => Store.set('supplier_prices', (Store.get('supplier_prices') || []).slice().reverse()));
  check('and file order does not change the answer', (await p.evaluate(() => supplierCostFor('DKD (LIN-BUS)'))) === got);
}

console.log('5. every mapped catalogue name still exists');
{
  // SUPPLIER_MATCH keys are CATALOG names, and CATALOG is REGENERATED from products.ts by
  // inject-catalog. A rename there orphans the mapping — supplierCostFor returns null, the
  // margin column falls back to the flat COST_PCT guess, and nothing anywhere says so.
  const bad = await p.evaluate(() => {
    const names = new Set(CATALOG.map((r) => r.name));
    return Object.keys(SUPPLIER_MATCH).filter((k) => !names.has(k));
  });
  check('no mapping points at a catalogue name that no longer exists', bad.length === (SELFTEST ? 1 : 0), bad);

  const n = await p.evaluate(() => Object.keys(SUPPLIER_MATCH).length);
  check('and the map is not empty, which would pass the check above vacuously', n > 10, n);
}

check('none of this went through a dialog the phone cannot draw', dialogs.length === 0, dialogs);

await ctx.close();
await b.close();
srv.close();
process.exit(finish());
