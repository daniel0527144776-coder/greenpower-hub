// The range calculator (v423, Daniel 2026-10-08: "חישוב טווח מקצועי ביותר, מדויק הכי ביותר לכל סוגי
// הכלים … לכל סוגי הבטריות"), driven in a browser.
//
//   node test/test-range.mjs
//   node test/test-range.mjs --selftest     takes the air out and makes ATV tyres roll like a road
//                                           bike's: the reference vehicles must leave their bands
//
// The old calculator divided watt-hours by a fixed Wh/km. A physical model can be wrong in ways a
// table cannot: a sign, a unit, a term that never reaches the total. So this checks it four ways:
//   1. reference vehicles land where real ones do — wide bands: a model outside them is wrong by a
//      factor, not by a few percent (and the selftest proves the bands bite);
//   2. it moves the right way: heavier, faster, hillier, colder, older is shorter; bigger is longer;
//   3. energy is conserved: the breakdown it prints adds up to the Wh/km it prints, every vehicle,
//      every terrain, every battery type;
//   4. it says what a customer must hear: a cell pushed past its rating, a climb it cannot make,
//      a lead pack's usable depth — and the page itself never shows NaN.
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
await new Promise((r) => srv.listen(4231, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1100 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4231/index.html');
await page.evaluate((st) => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  if (st) { RANGE_PHYS.rho0 = 0; RANGE_TIRES.atv.crr = 0.004; }
  navigateTo('calcs');
  setCalcTab('range');
}, SELFTEST);
await page.waitForTimeout(300);

// ---- 1. reference vehicles ----
const ref = await page.evaluate(() => {
  const V = (k, o) => ({ ...RANGE_VEHICLES[k], ...o });
  const km = (inp) => rangeModel(inp).km;
  return {
    // Xiaomi M365: 280Wh (10S3P of 2.6Ah), 250W hub, 8.5" tyres. Xiaomi publishes 30km at 15km/h with
    // 75kg on the flat; riders report about 20km at its full 25km/h in town.
    m365slow: km(V('scooter', { V: 36, ah: 7.8, cell: 'nmc-18650', power: 250, top: 25, wheel: 8.5, mass: 10.5, rider: 75, speed: 15, use: 'open', style: 'eco' })) * 280 / 324,
    m365fast: km(V('scooter', { V: 36, ah: 7.8, cell: 'nmc-18650', power: 250, top: 25, wheel: 8.5, mass: 10.5, rider: 75, speed: 25, use: 'city' })) * 280 / 324,
    // a 36V 10Ah, 250W geared-hub e-bike on throttle alone at 25km/h, 80kg: 30-45km is the usual answer
    ebike: km(V('ebike', { V: 36, ah: 10, power: 250, top: 27, speed: 25 })),
    // a Sur-Ron class bike, 60V 30Ah, 45km/h on the road (knobbly tyres): about 30-35 Wh/km
    surronRoad: km(V('surron', { V: 60, ah: 30, speed: 45, use: 'open', terrain: 'flat', surface: 'asphalt' })),
    surronWh: rangeModel(V('surron', { V: 60, ah: 30, speed: 45, use: 'open', terrain: 'flat', surface: 'asphalt' })).whKm,
    // a kids' ATV, 48V 20Ah lead, dirt: around 10-15km
    atvKids: km(V('atv_kids', {})),
    // an adult ATV, 72V 50Ah, 30km/h on dirt with easy climbs: knobbly low-pressure tyres dominate
    atv: km(V('atv', {})),
    atvWh: rangeModel(V('atv', {})).whKm,
    // a 24V 50Ah lead mobility scooter at 12km/h: 25-45km
    mobility: km(V('mobility', {})),
  };
});
const inBand = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
check('M365 at 15km/h lands near Xiaomi\'s 30km', inBand(ref.m365slow, 25, 42), ref.m365slow.toFixed(1));
check('M365 at full speed in town lands near the 20km riders get', inBand(ref.m365fast, 16, 26), ref.m365fast.toFixed(1));
check('a 36V 10Ah e-bike on throttle: 28-45km', inBand(ref.ebike, 28, 45), ref.ebike.toFixed(1));
check('a Sur-Ron at 45km/h on the road: 25-40 Wh/km', inBand(ref.surronWh, 25, 40), ref.surronWh.toFixed(1));
check('and 40-65km from 60V 30Ah', inBand(ref.surronRoad, 40, 65), ref.surronRoad.toFixed(1));
check('a kids\' ATV on lead: 8-18km', inBand(ref.atvKids, 8, 18), ref.atvKids.toFixed(1));
check('an adult ATV on dirt: 45-90 Wh/km', inBand(ref.atvWh, 45, 90), ref.atvWh.toFixed(1));
check('and 40-75km from 72V 50Ah', inBand(ref.atv, 40, 75), ref.atv.toFixed(1));
check('a lead mobility scooter: 25-45km', inBand(ref.mobility, 25, 45), ref.mobility.toFixed(1));

// ---- 2. it moves the right way ----
const mono = await page.evaluate(() => {
  const base = { ...RANGE_VEHICLES.surron };
  const km = (o) => rangeModel({ ...base, ...o }).km;
  const k0 = km({});
  return {
    k0,
    heavier: km({ rider: 120 }) < k0,
    faster: km({ speed: 60 }) < km({ speed: 30 }),
    hillier: km({ terrain: 'mountain' }) < km({ terrain: 'flat' }),
    sand: km({ surface: 'sand' }) < km({ surface: 'asphalt' }),
    colder: km({ temp: -5 }) < km({ temp: 25 }),
    older: km({ soh: 70 }) < km({ soh: 100 }),
    wind: km({ wind: 20 }) < km({}),
    double: km({ ah: 80 }) / km({ ah: 40 }),
    regenHills: km({ terrain: 'hilly', regen: true }) > km({ terrain: 'hilly', regen: false }),
    foc: km({ ctrl: 'foc' }) > km({ ctrl: 'square' }),
    // the same tyre bigger rolls easier: a 23" ATV wheel against a 16" one on dirt, same top speed
    bigWheel: rangeModel({ ...RANGE_VEHICLES.atv, wheel: 25 }).km > rangeModel({ ...RANGE_VEHICLES.atv, wheel: 18 }).km,
    // with the motor's KV given, a bigger wheel is a faster vehicle
    kvTop: rangeModel({ ...base, V: 72, kv: 45, ratio: 3.5, wheel: 21 }).top > rangeModel({ ...base, V: 72, kv: 45, ratio: 3.5, wheel: 19 }).top,
    // a strong cell sags less than a weak one under the same controller: more energy delivered
    strongCell: rangeModel({ ...base, cell: '21700-50pl', ctrlA: 120 }).dis.wh > rangeModel({ ...base, cell: '21700-50e', ctrlA: 120 }).dis.wh,
    // speeds table: it falls as speed rises above walking pace
    table: rangeSpeeds(base).map((x) => x.km),
  };
});
check('the reference bike has a range at all', mono.k0 > 0, String(mono.k0));
check('a heavier rider goes less far', mono.heavier);
check('faster goes less far', mono.faster);
check('mountains go less far than flat', mono.hillier);
check('sand goes less far than asphalt', mono.sand);
check('cold goes less far', mono.colder);
check('an old pack goes less far', mono.older);
check('wind costs range', mono.wind);
check('twice the Ah is 1.8-2.05× the range (its own weight included)', mono.double >= 1.8 && mono.double <= 2.05, mono.double.toFixed(3));
check('regen pays back on hills', mono.regenHills);
check('an FOC controller beats a square wave', mono.foc);
check('a bigger wheel rolls easier', mono.bigWheel);
check('with KV given, a bigger wheel is faster', mono.kvTop);
check('a high-current cell delivers more under a big controller', mono.strongCell);
check('the speed table falls with speed', mono.table.length >= 3 && mono.table.every((x, i, a) => i === 0 || x < a[i - 1]), mono.table.map((x) => x.toFixed(0)).join(' '));

// ---- 3. energy is conserved, everywhere ----
const bal = await page.evaluate(() => {
  let worst = 0, where = '', bad = [];
  for (const [k, v] of Object.entries(RANGE_VEHICLES)) for (const t of Object.keys(RANGE_TERRAIN)) for (const c of Object.keys(RANGE_CELLS)) {
    const r = rangeModel({ ...v, terrain: t, cell: c });
    const B = r.B;
    const sum = (B.roll + B.air + B.climb - B.back - B.regen + B.launch + B.motor + B.gear + B.ctrl + B.acc) / 3600;
    if (![r.km, r.whKm, sum, r.dis.wh].every(Number.isFinite)) bad.push(`${k}/${t}/${c}`);
    const e = Math.abs(sum - r.whKm) / Math.max(1e-9, r.whKm);
    if (e > worst) { worst = e; where = `${k}/${t}/${c}`; }
    if (r.dis.wh > r.pack.wh * 1.005) bad.push(`${k}/${t}/${c} delivers ${r.dis.wh.toFixed(0)} of ${r.pack.wh.toFixed(0)}Wh`);
  }
  return { worst, where, bad };
});
check('the breakdown adds up to the Wh/km, every vehicle × terrain × battery', bal.worst < 0.001, `${(bal.worst * 100).toFixed(3)}% at ${bal.where}`);
check('no NaN, and no pack delivers more than it holds', bal.bad.length === 0, bal.bad.slice(0, 4).join(' | '));

// ---- 4. what a customer must hear ----
const warn = await page.evaluate(() => {
  const t = (inp) => rangeModel(inp).notes.map((n) => n.t).join(' | ');
  return {
    // CLASSIC cells (2C = 10A) two in parallel behind an 80A controller, on hills
    overCell: t({ ...RANGE_VEHICLES.surron, V: 72, ah: 10, cell: '21700-50e', ctrlA: 80, terrain: 'hilly' }),
    // the same on PRO cells: nothing to warn about
    proCell: t({ ...RANGE_VEHICLES.surron, V: 72, ah: 10, cell: '21700-50pl', ctrlA: 80, terrain: 'hilly' }),
    lead: t({ ...RANGE_VEHICLES.mobility }),
    // a kids' ATV up a steep off-road climb in the mud
    stall: t({ ...RANGE_VEHICLES.atv_kids, terrain: 'steep', surface: 'mud', rider: 70 }),
    tooFast: t({ ...RANGE_VEHICLES.ebike, speed: 60 }),
  };
});
check('a cell past its rating is called out', /מעל .*שהתא מדורג לו/.test(warn.overCell), warn.overCell);
check('and a cell within it is not', !/שהתא מדורג לו/.test(warn.proCell), warn.proCell);
check('lead says it is computed to its usable depth', /עופרת/.test(warn.lead), warn.lead);
check('a climb it cannot make says so', /לא מטפס/.test(warn.stall), warn.stall);
check('a speed above the top speed says so', /מעל המהירות המקסימלית/.test(warn.tooFast), warn.tooFast);

// ---- 5. the page ----
const ui = await page.evaluate(() => {
  const opts = (id) => [...document.querySelectorAll('#' + id + ' option')].map((o) => o.textContent);
  return {
    vehicles: opts('rg_veh'), tires: opts('rg_tire'), motors: opts('rg_motor'), ctrls: opts('rg_ctrl'), cells: opts('rg_cell'),
    labels: [...document.querySelectorAll('#rangeForm label')].map((l) => l.textContent).join(' | '),
    result: document.getElementById('rangeResult')?.textContent || '',
  };
});
check('the vehicle list has ATVs', ui.vehicles.some((x) => /טרקטורון/.test(x)), ui.vehicles.join(', '));
check('and golf carts, buggies, mobility scooters, wheelchairs', ['גולף', 'באגי', 'קלנועית', 'כיסא גלגלים'].every((w) => ui.vehicles.some((x) => x.includes(w))), ui.vehicles.join(', '));
check('it asks for the wheel size', /קוטר גלגל/.test(ui.labels), ui.labels);
check('the motor: type, power, count, top speed, KV', ['סוג מנוע', 'הספק נומינלי', 'מספר מנועים', 'מהירות מקסימלית', 'KV'].every((w) => ui.labels.includes(w)), ui.labels);
check('the controller: type and current', ['סוג בקר', 'זרם בקר'].every((w) => ui.labels.includes(w)) && ui.ctrls.length >= 3, ui.ctrls.join(', '));
check('every battery family is there', ['50PL', '50SG', '50E', 'LiFePO4', 'LTO', 'NiMH', 'עופרת', 'LiPo'].every((w) => ui.cells.some((x) => x.includes(w))), ui.cells.join(', '));
check('the page shows a range', /^\d+(–\d+)? ק"מ$/.test(ui.result.trim()), ui.result);

// every vehicle × every battery type through the page itself: a number, never NaN
const sweep = [];
const vehs = await page.evaluate(() => Object.keys(RANGE_VEHICLES));
const cells = await page.evaluate(() => Object.keys(RANGE_CELLS));
for (const v of vehs) {
  await page.selectOption('#rg_veh', v);
  for (const c of [cells[0], cells[2], 'lfp-prism', 'lead']) {
    await page.selectOption('#rg_cell', c);
    const res = await page.evaluate(() => document.getElementById('rangeOut').textContent);
    if (/NaN|Infinity|undefined/.test(res) || !/\d+(–\d+)? ק"מ/.test(res)) sweep.push(`${v}/${c}`);
  }
}
check('every vehicle × battery renders numbers, no NaN', sweep.length === 0, sweep.slice(0, 5).join(' | '));

// typing: a field left empty is "work it out", not NaN. Set through the page as typing would
// (a field in a closed fold cannot be filled), and passed to the same handler.
const type = (id, v) => page.evaluate(([i, x]) => { const el = document.getElementById(i); el.value = x; rangeInput(el); }, [id, v]);
await page.selectOption('#rg_veh', 'atv');
await type('rg_speed', '');
await type('rg_ah', '');
const empty = await page.evaluate(() => document.getElementById('rangeOut').textContent);
check('emptied fields fall back, not NaN', !/NaN|Infinity/.test(empty) && /\d+(–\d+)? ק"מ/.test(empty), empty.slice(0, 120));
await type('rg_speed', '30');
await type('rg_ah', '50');
await type('rg_target', '80');
const need = await page.evaluate(() => (document.querySelector('.rg-need') || {}).textContent || '');
check('"how much battery for 80km" answers in Ah and a configuration', /80 ק"מ צריך [\d,.]+Ah/.test(need) && /\d+S\d+P/.test(need), need);
// the speed table and the WhatsApp text
const speeds = await page.evaluate(() => document.querySelectorAll('.rg-table tbody tr').length);
check('the speed table has rows', speeds >= 3, String(speeds));
const wa = await page.evaluate(() => {
  let url = '';
  const keep = window.openExternal;
  window.openExternal = (u) => { url = u; };
  try { rangeWhatsApp(); } finally { window.openExternal = keep; }
  return decodeURIComponent(url.replace(/^[^?]*\?text=/, ''));
});
check('the WhatsApp text carries the range and the battery', /טווח צפוי: \d+–\d+ ק"מ/.test(wa) && /72V 50/.test(wa), wa);

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
