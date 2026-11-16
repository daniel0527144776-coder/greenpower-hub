// PRO's cell is in every calculator (2026-11-15).
//
//   node test/test-pro-cell.mjs
//   node test/test-pro-cell.mjs --selftest     (the calculators as they were, without the cell; must go red)
//
// PRO is built on the Great Power 60Q, a 6Ah cell, since 2026-11-12. The price list, the cost and the label moved
// that day. The calculators did not: the repair calculator, the dimensions calculator and the six vehicle
// calculators (which the site runs too) went on offering only the 5Ah cell PRO was before, so a PRO pack was sized
// and judged as a different pack (72V 36Ah as 20S8P, 160 cells, where it is 20S6P, 120). What must hold:
//   - the repair calculator offers the cell, sizes by its 6Ah, costs it and quotes it;
//   - the dimensions calculator offers it and sizes by it;
//   - the vehicle calculators know it by the label's own figures (10C continuous, 25C peak), and the vehicles
//     that open on PRO open on it, at a capacity it can be built in (a multiple of 6).
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
await new Promise((r) => srv.listen(4440, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4440/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof calcConfig === 'function' && typeof calcPackDims === 'function' && typeof RANGE_CELLS !== 'undefined', null, { timeout: 30000 });

const r = await page.evaluate((SELF) => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const KEY = '21700-60q';
  if (SELF) {
    for (const t of [CELL_PRICES, CELL_PRICES_QUOTED, CELL_MAH, CELL_WEIGHTS, DIM_CELLS, RANGE_CELLS]) delete t[KEY];
    for (const id of ['cellType', 'dimCell']) { const o = [...document.getElementById(id).options].find((x) => x.value === KEY); if (o) o.remove(); }
    for (const v of Object.values(RANGE_VEHICLES)) if (v.cell === KEY) v.cell = '21700-50pl';
  }
  const out = {};
  // the repair calculator
  const ct = document.getElementById('cellType');
  out.repairOffers = [...ct.options].some((o) => o.value === KEY);
  ct.value = KEY; syncCellMah();
  document.getElementById('voltage').value = '72'; document.getElementById('capacity').value = '36';
  out.mah = document.getElementById('cellMah').value;
  out.config = ct.value === KEY ? calcConfig() : null;
  out.cost = CELL_PRICES[KEY]; out.quoted = CELL_PRICES_QUOTED[KEY]; out.g = CELL_WEIGHTS[KEY];
  // the catalogue's own cost for a PRO pack is on the same cell
  const pro = PRICING.find((x) => /PRO$/.test(x.cat) && /^72V 36Ah$/.test(x.name) && !/Sur-Ron/.test(x.cat));
  out.proRow = pro ? batteryCostParts(pro, false) : null;
  out.proRow = out.proRow ? { cells: out.proRow.cells, cellPrice: out.proRow.cellPrice } : null;
  // the dimensions calculator
  const dc = document.getElementById('dimCell');
  out.dimOffers = [...dc.options].some((o) => o.value === KEY);
  out.dim = DIM_CELLS[KEY] ? { ah: DIM_CELLS[KEY].ah, dia: DIM_CELLS[KEY].dia, len: DIM_CELLS[KEY].len } : null;
  if (out.dimOffers) {
    navigateTo('dims'); clearDimVehicle();
    dc.value = KEY; document.getElementById('dimV').value = '72'; dimAhPending = 36; calcPackDims();
    out.dimText = document.getElementById('dimResult').innerText.slice(0, 200);
    out.dimAh = [...document.getElementById('dimAh').options].slice(0, 4).map((o) => o.value).join(',');
  }
  // the vehicle calculators
  const c = RANGE_CELLS[KEY];
  out.range = c ? { ah: c.ah, cont: c.cont, peak: c.peak, label: c.label } : null;
  out.sticker = typeof TIER_SPEC !== 'undefined' && TIER_SPEC.PRO ? TIER_SPEC.PRO.crate : null;
  out.presets = Object.entries(RANGE_VEHICLES).filter(([, v]) => v.cell === KEY || v.cell === '21700-50pl').map(([k, v]) => [k, v.cell, v.ah]);
  out.model = c ? (() => { const m = rangeModel({ ...RANGE_VEHICLES.surron }); return m && m.dis ? { wh: Math.round(m.dis.wh), ok: m.dis.wh > 0 } : null; })() : null;
  return out;
}, SELFTEST);

check('the repair calculator offers PRO\'s cell', r.repairOffers === true, r.repairOffers);
check('…and sizes by its 6Ah: 72V 36Ah is 20S6P, 120 cells', r.mah === '6000' && r.config && r.config.s === 20 && r.config.p === 6 && r.config.total === 120, [r.mah, r.config]);
check('…costs it and quotes it, the quote over the cost', r.cost > 0 && r.quoted > r.cost && r.g > 0, [r.cost, r.quoted, r.g]);
check('…at the cost the price list builds a PRO pack on', !!r.proRow && r.proRow.cells === 120 && Math.abs(r.proRow.cellPrice - r.cost) < 0.005, [r.proRow, r.cost]);
check('the dimensions calculator offers it', r.dimOffers === true && !!r.dim && r.dim.ah === 6 && r.dim.dia > 21 && r.dim.len > 70, [r.dimOffers, r.dim]);
check('…and sizes by it: 72V 36Ah is 20S 6P', /20S 6P/.test(r.dimText || '') && /^6,12,18/.test(r.dimAh || ''), [r.dimText, r.dimAh]);
check('the vehicle calculators know it: 6Ah, 10C continuous, 25C peak', !!r.range && r.range.ah === 6 && r.range.cont === 10 && r.range.peak === 25 && /PRO/.test(r.range.label), r.range);
check('…the figures the quote prints for PRO', r.sticker === '10C~25C', r.sticker);
check('the vehicles that open on PRO open on it, at a capacity it is built in', r.presets.length >= 5 && r.presets.every(([, cell, ah]) => cell === '21700-60q' && ah % 6 === 0), r.presets);
check('…and the range model runs on it', !!r.model && r.model.ok, r.model);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
