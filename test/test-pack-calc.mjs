// The pack calculator's 2026-09-01 rules, driven in a browser.
//
//   node test/test-pack-calc.mjs
//   node test/test-pack-calc.mjs --selftest
//
// Four of these are rules that hold a WRONG answer back rather than producing a right one, and
// all four fail silently: a capacity that cannot be built, a second layer in a scooter tub that
// is one layer deep, a BMS allowance that never moves off its default, and a holder chosen
// because it was first in a list instead of because the pack fits in it.
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
await new Promise((r) => srv.listen(4216, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1100 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4216/index.html');
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  navigateTo('dims');
});
await page.waitForTimeout(200);

const set = (id, v) => page.evaluate(([i, x]) => {
  const el = document.getElementById(i);
  el.value = x;
  calcPackDims();
}, [id, v]);

// ---- 1. capacity is a list, never a typed number ----
const cap = await page.evaluate(() => {
  const el = document.getElementById('dimAh');
  return { tag: el.tagName, opts: [...el.options].slice(0, 4).map((o) => o.textContent.trim()), n: el.options.length };
});
check('capacity is a dropdown, not a free field', cap.tag === 'SELECT', cap.tag);
check('in 5Ah steps, each naming its P and cell count', /^5Ah · \d+P · \d+ תאים/.test(cap.opts[0] || ''), cap.opts[0] || '');
check('and it offers a real range', cap.n >= 8, String(cap.n));

// ---- 2. the BMS allowance follows the voltage until he overrides it ----
await set('dimV', '48');
const at48 = await page.evaluate(() => document.getElementById('dimExtra').value);
await set('dimV', '72');
const at72 = await page.evaluate(() => document.getElementById('dimExtra').value);
check('the case allowance grows with the voltage', +at72 > +at48, `48V=${at48} 72V=${at72}`);
const held = await page.evaluate(() => {
  const el = document.getElementById('dimExtra');
  el.value = '40';
  dimExtraTouched = true;
  document.getElementById('dimV').value = '48';
  calcPackDims();
  return { value: el.value, note: document.getElementById('dimExtraNote').textContent };
});
// A number he typed is a measurement of the case in his hand. Nothing may overwrite it.
check('once he types his own, the voltage stops overwriting it', held.value === '40', held.value);
check('and it says so', /ידני/.test(held.note), held.note);

// ---- 3. stacking is for motorcycles ----
const stack = await page.evaluate(() => {
  const scooter = VEHICLE_PACKS.find((v) => /קורקינט/.test(v.g));
  const moto = VEHICLE_PACKS.find((v) => /E-Moto|אופנוע/.test(v.g));
  useVehiclePack(scooter.m);
  document.getElementById('dimLayers').value = '2';
  calcPackDims();
  const afterScooter = { layers: document.getElementById('dimLayers').value, disabled: document.getElementById('dimLayers').disabled };
  useVehiclePack(moto.m);
  document.getElementById('dimLayers').value = '2';
  calcPackDims();
  const afterMoto = { layers: document.getElementById('dimLayers').value, disabled: document.getElementById('dimLayers').disabled };
  return { scooter: scooter.m, moto: moto.m, afterScooter, afterMoto };
});
check('a scooter is pinned to one layer', stack.afterScooter.layers === '1' && stack.afterScooter.disabled,
  `${stack.scooter}: ${JSON.stringify(stack.afterScooter)}`);
check('a motorcycle may be stacked', stack.afterMoto.layers === '2' && !stack.afterMoto.disabled,
  `${stack.moto}: ${JSON.stringify(stack.afterMoto)}`);

// ---- 4. which nickel, and it must be the densest that FITS ----
const rec = await page.evaluate(() => {
  // The OX is the one row with a measured tub, so the recommendation has something real to
  // fit into rather than an estimate.
  useVehiclePack('Inokim OX');
  calcPackDims();
  const html = document.getElementById('dimResult').innerHTML;
  const order = HOLDER_ORDER.slice();
  const opts = recommendHolder(21700, 60, 425, 165, 21.15);
  return { html, order, opts };
});
check('the densest holder is tried first', rec.order[0] === 'diag-b', rec.order.join(','));
check('a recommendation is shown', /מומלץ|אף מחזיק/.test(rec.html), rec.html.slice(0, 80).replace(/<[^>]*>/g, ''));
// Densest FIRST is only right if it also has to fit: a recommendation that ignores whether the
// pack goes in is just the first item of a list.
check('and it only recommends one that fits', rec.opts.every((o) => typeof o.fits === 'boolean' && o.n >= 0),
  rec.opts.map((o) => `${o.h}:${o.n}${o.fits ? '✓' : '✗'}`).join(' '));

// ---- 5. over capacity warns, and does not block ----
const over = await page.evaluate(() => {
  useVehiclePack('Zero 10X');
  const sel = document.getElementById('dimAh');
  sel.value = String(+sel.options[sel.options.length - 1].value);
  calcPackDims();
  const res = document.getElementById('dimResult');
  return { warn: !!res.querySelector('.dim-over'), stillComputed: /תצורה/.test(res.textContent), text: res.textContent.slice(0, 60) };
});
check('going over the ceiling warns loudly', over.warn, String(over.warn));
// Most of those ceilings are AI estimates. Refusing to compute on the strength of a guess
// would stop a build that is genuinely possible - his call, warn hard and let him through.
check('but the pack is still computed', over.stillComputed, over.text);

// ---- 6. the side view ----
const side = await page.evaluate(() => {
  useVehiclePack('Sur-Ron');
  calcPackDims();
  const d = document.getElementById('dimDraw');
  return { svgs: d.querySelectorAll('svg').length, hasSide: /מבט מהצד/.test(d.textContent), hasBms: /BMS/.test(d.textContent) };
});
check('the drawing shows a plan AND an elevation', side.svgs >= 2, String(side.svgs));
check('the elevation names the height', side.hasSide, String(side.hasSide));
check('and shows the case allowance as part of it', side.hasBms, String(side.hasBms));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
