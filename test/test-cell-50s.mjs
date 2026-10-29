// The Samsung 21700 50S, everywhere a cell is chosen (Daniel, 2026-10-29).
//
//   node test/test-cell-50s.mjs
//   node test/test-cell-50s.mjs --selftest     (the 50S taken out of the repair calculator's cost)
//
// "רק כתא במלאי ובמחשבון, בלי סדרת סוללות חדשה באתר": $2.6 EXW, ₪8.52 landed (no VAT since 2026-10-29; quoted off ₪9.39); 5,000mAh, 72 g, 5C/9C.
// What must hold: the repair calculator lays it out at 5Ah and costs it at ₪8.52, and quotes off ₪9.39
// same cost (it has no March anchor to mark up); the dims calculator measures its own body; the range
// and charging calculators offer it; the cost window finds its sea cost by its code; and the 50SG, whose
// name holds "50S", is not mistaken for it anywhere.
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
await new Promise((r) => srv.listen(4396, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4396/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.recalc === 'function' && typeof window.calcPackDims === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { delete CELL_PRICES['21700-50s']; window.routeCellCost = () => null; });

// ---- the repair calculator ----
const rc = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  Store.set('jobs', []); Store.set('orders', []);
  navigateTo('calc');
  const opts = [...document.getElementById('cellType').options].map((o) => o.value);
  document.getElementById('voltage').value = '72';
  document.getElementById('capacity').value = '30';
  if (!state.jobs.has('full')) toggleJob('full');
  const run = (cell) => {
    document.getElementById('cellType').value = cell;
    syncCellMah(); recalc();
    const n = (id) => parseFloat(document.getElementById(id).textContent.replace(/[^\d.-]/g, '')) || 0;
    return { mah: document.getElementById('cellMah').value, config: document.getElementById('configDisplay').textContent,
      weight: document.getElementById('weightDisplay').textContent, cost: n('costDisplay'), price: n('finalPrice') };
  };
  return { opts, s50: run('21700-50s'), sg: run('21700-50sg') };
});
check('the repair calculator offers the 50S', rc.opts.includes('21700-50s'), rc.opts);
check('a 72V 30Ah of it is 20S6P, 120 cells, at 5,000mAh', rc.s50.mah === '5000' && /20S 6P \(120 תאים\)/.test(rc.s50.config), rc.s50);
check('at 72 g a cell: ~9.1 kg', /9\.1/.test(rc.s50.weight), rc.s50.weight);
// The same build and the same hours; only the cells differ: 120 × (₪8.52 − ₪7.04) = ₪177.6 (no VAT since 2026-10-29).
check('"עלות לי" is its ₪8.52 a cell: ₪178 over the same build in 50SG', Math.abs(rc.s50.cost - rc.sg.cost - 177.6) <= 1, [rc.s50.cost, rc.sg.cost]);
check('and its quote costs more than the 50SG\'s, marked up from that same cost', rc.s50.price > rc.sg.price, [rc.s50.price, rc.sg.price]);

// ---- the cost window, the dims, the range and the charging calculators ----
const rest = await page.evaluate(() => {
  const out = {};
  out.sea = routeCellCostOn('50S', 'sea');
  out.unit = CELL_UNIT_COST['Samsung 50S'];
  out.sgSea = routeCellCostOn('50SG', 'sea');
  navigateTo('dims');
  const dimOpts = [...document.getElementById('dimCell').options].map((o) => o.value);
  out.dimOpt = dimOpts.includes('21700-50s');
  out.dim = DIM_CELLS['21700-50s'];
  out.range = Object.keys(RANGE_CELLS).includes('21700-50s') && RANGE_CELLS['21700-50s'];
  out.rangeOpt = Object.keys(rangeCellOptions()).includes('21700-50s');
  calcFillSelects();
  const ch = document.getElementById('chCell');
  out.chargeOpt = !!ch && [...ch.options].some((o) => o.value === '21700-50s');
  const c = calcChargeModel({ ah: 30, A: 5, V: 72, cell: '21700-50s', from: 0, to: 100 });
  out.charge = c && { h: c.h != null ? c.h : c.hours, ok: JSON.stringify(c).indexOf('NaN') < 0 && JSON.stringify(c).indexOf('null') < 0 };
  out.sheet = cellSheetKey('תאי Samsung 21700 50S');
  out.sgSheet = cellSheetKey('תאי Tenpower 21700 50SG');
  out.sticker = STICKER_CELLS['21700-50s'];
  return out;
});
check('the cost window finds its sea cost by its code, ₪8.52, and the 50SG keeps ₪7.04', rest.sea === 8.52 && rest.unit === 8.52 && rest.sgSea === 7.04, rest);
check('the dims calculator offers it, with its own body: 21.15 × 70.52 mm, 72 g, 5Ah', rest.dimOpt && rest.dim && rest.dim.dia === 21.15 && rest.dim.len === 70.52 && rest.dim.g === 72 && rest.dim.ah === 5, rest.dim);
check('the calculators\' model carries it: 5Ah, 5C/9C, 72 g', rest.range && rest.range.ah === 5 && rest.range.cont === 5 && rest.range.peak === 9 && rest.range.g === 72 && rest.rangeOpt, rest.range);
check('the charging calculator offers it, and a charge on it has no hole in it', rest.chargeOpt === true && rest.charge && rest.charge.ok, [rest.chargeOpt, rest.charge]);
check('its datasheet card is its own, and the 50SG keeps its', rest.sheet === '21700-50s' && rest.sgSheet === '21700-50sg', [rest.sheet, rest.sgSheet]);
check('a repair\'s sticker gets "Samsung 21700 50S"', rest.sticker === 'Samsung 21700 50S', rest.sticker);

// A range and a charge run on it end in numbers, not NaN.
const runs = await page.evaluate(() => {
  rangeState = rangePreset('ebike'); rangeState.cell = '21700-50s';
  const inp = rangeInputs();
  const r = rangeModel(inp);
  return { cell: inp.cell, wh: r && r.pack && r.pack.wh, km: r && r.km };
});
check('a range run on it ends in numbers, not NaN', runs.cell === '21700-50s' && Number.isFinite(runs.wh) && runs.wh > 0 && Number.isFinite(runs.km) && runs.km > 0, runs);

check('no page errors', errs.length === 0, errs);
check('no native dialogs', dialogs.length === 0, dialogs);
await browser.close();
srv.close();
process.exit(finish());
