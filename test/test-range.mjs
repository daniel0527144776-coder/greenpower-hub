// The calculators (v423 range, Daniel 2026-10-08: "חישוב טווח מקצועי ביותר, מדויק הכי ביותר לכל סוגי
// הכלים … לכל סוגי הבטריות"), driven in a browser.
//
//   node test/test-range.mjs
//   node test/test-range.mjs --selftest     takes the air out, makes ATV tyres roll like a road bike's
//                                           and lets a cell take any charger: the reference vehicles
//                                           must leave their bands and the charge warning must go
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
  if (st) { RANGE_PHYS.rho0 = 0; RANGE_TIRES.atv.crr = 0.004; RANGE_CELLS['21700-50sg'].chg = [5, 10]; }
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

// ---- 5. the page: simple first (Daniel, 2026-10-08: "שלא יהיה מסובך מידי כי יש נתונים שרק
// מקצועניים בתחום יודעים") ----
const ui = await page.evaluate(() => {
  const opts = (id) => [...document.querySelectorAll('#' + id + ' option')].map((o) => o.textContent);
  const labels = (fold) => [...document.querySelectorAll('[data-fold="' + fold + '"] label')].map((l) => (l.childNodes[0] || {}).textContent || '');
  const isOpen = (fold) => !!document.querySelector('[data-fold="' + fold + '"]')?.open;
  return {
    vehicles: opts('rg_veh'), tires: opts('rg_tire'), motors: opts('rg_motor'), ctrls: opts('rg_ctrl'), cells: opts('rg_cell'),
    basic: labels('rg-basic'), known: labels('rg-known'), pro: labels('rg-pro'),
    open: { basic: isOpen('rg-basic'), known: isOpen('rg-known'), pro: isOpen('rg-pro') },
    result: document.getElementById('rangeResult')?.textContent || '',
  };
});
check('the vehicle list has ATVs', ui.vehicles.some((x) => /טרקטורון/.test(x)), ui.vehicles.join(', '));
check('and golf carts, buggies, mobility scooters, wheelchairs', ['גולף', 'באגי', 'קלנועית', 'כיסא גלגלים'].every((w) => ui.vehicles.some((x) => x.includes(w))), ui.vehicles.join(', '));
// the open part asks at most eight things, and none of them is a technician's
const PRO_WORDS = /KV|CdA|Crr|בקר|ניתוק|BMS|יחס העברה|רגנרטיב|S\)|צמיג|תנוחת/;
check('the open section asks at most eight questions', ui.basic.length >= 6 && ui.basic.length <= 8, ui.basic.join(' | '));
check('and none of them is a professional\'s', !ui.basic.some((l) => PRO_WORDS.test(l)), ui.basic.join(' | '));
check('it is the only section open', ui.open.basic && !ui.open.known && !ui.open.pro, JSON.stringify(ui.open));
check('the owner\'s section asks the motor\'s watts and the wheel', ['הספק המנוע', 'גודל גלגל'].every((w) => ui.known.some((l) => l.includes(w))), ui.known.join(' | '));
check('the professional section has the motor, the controller, KV, CdA and the tyre', ['סוג מנוע', 'סוג בקר', 'זרם בקר', 'KV', 'CdA', 'צמיג', 'ניתוק'].every((w) => ui.pro.some((l) => l.includes(w))), ui.pro.join(' | '));
check('the controller: type and current', ui.ctrls.length >= 3, ui.ctrls.join(', '));
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

// "where do you ride" is one question that sets the stops AND the surface
await page.selectOption('#rg_veh', 'atv');
await page.selectOption('#rg_where', 'sand');
const where = await page.evaluate(() => ({ use: rangeState.use, surface: rangeState.surface, shown: document.getElementById('rg_surface').value, km: rangeLast.band.mid.km }));
await page.selectOption('#rg_where', 'dirt');
const dirtKm = await page.evaluate(() => rangeLast.band.mid.km);
check('"where" sets the surface and the stops, and the professional fields follow', where.use === 'trail' && where.surface === 'sand' && where.shown === 'sand', JSON.stringify(where));
check('and sand rides shorter than a dirt road', where.km < dirtKm, `${where.km.toFixed(0)} / ${dirtKm.toFixed(0)}`);

// ---- 6. the five smaller calculators, on the same engine ----
const small = await page.evaluate(() => {
  const ch = (o) => calcChargeModel({ V: 48, cell: '21700-50e', from: 0, to: 100, ...o });
  const sp = (o) => calcSpeedModel(o);
  const presets = Object.keys(RANGE_VEHICLES).map((k) => { const s = sp({ veh: k }); return [k, s.top / RANGE_VEHICLES[k].top]; });
  const up = (o) => calcUpgradeModel(o);
  return {
    // a 15Ah pack on a 2A charger takes a night; 20Ah from 10% on 5A an afternoon
    night: ch({ ah: 15, A: 2 }).hours, afternoon: ch({ ah: 20, A: 5, from: 10 }).hours,
    to80: ch({ ah: 20, A: 5, to: 80 }).hours, to100: ch({ ah: 20, A: 5 }).hours,
    lead: ch({ ah: 50, A: 5, cell: 'lead', V: 24 }).hours, li: ch({ ah: 50, A: 5, cell: '21700-50e', V: 24 }).hours,
    tooFast: ch({ ah: 10, A: 15, cell: '21700-50sg' }).notes.map((n) => n.lvl + ':' + n.t).join(' | '),
    normal: ch({ ah: 20, A: 5 }).notes.filter((n) => n.lvl !== 'info').length,
    // the speeds: the classic questions, and every class reproducing the top speed the range page uses
    bike1000: sp({ veh: 'ebike', V: 48, power: 1000, wheel: 20 }).top,
    m365: sp({ veh: 'scooter', V: 36, power: 350, wheel: 8.5 }).top,
    heavy: sp({ veh: 'moped', rider: 140 }).top <= sp({ veh: 'moped', rider: 70 }).top,
    voltUp: sp({ veh: 'scooter', V: 60 }).top > sp({ veh: 'scooter', V: 48 }).top,
    presets,
    // a voltage upgrade: faster and further on a scooter; 36V to 72V on a 350W bike is not a plan
    scoot: up({ veh: 'scooter', fromV: 48, toV: 60, ah: 15, power: 500 }),
    wild: up({ veh: 'ebike', fromV: 36, toV: 72, ah: 15, power: 350 }),
    // running cost
    cost: calcCostModel({ veh: 'ebike', km: 20 }),
    costAtv: calcCostModel({ veh: 'atv', km: 20 }),
    // health, and a winter measurement on a healthy pack
    h1: calcHealthModel({ orig: 60, curr: 40, years: 2 }),
    hw: calcHealthModel({ orig: 60, curr: 52, years: 1, season: 'winter' }),
    hs: calcHealthModel({ orig: 60, curr: 52, years: 1 }),
  };
});
check('charge: 15Ah on a 2A charger takes 7-10 hours', inBand(small.night, 7, 10), small.night.toFixed(2));
check('charge: 20Ah from 10% on 5A takes 3.5-5.5 hours', inBand(small.afternoon, 3.5, 5.5), small.afternoon.toFixed(2));
check('charge: to 80% is well under to 100% (the slow end)', small.to80 < small.to100 * 0.85, `${small.to80.toFixed(2)} / ${small.to100.toFixed(2)}`);
check('charge: lead is slower than lithium on the same charger', small.lead > small.li * 1.2, `${small.lead.toFixed(1)} / ${small.li.toFixed(1)}`);
check('charge: a charger past the cell\'s maximum is called out', /^bad:.*מעל המקסימום/m.test(small.tooFast.split(' | ').join('\n')), small.tooFast);
check('charge: a normal charger draws no warning', small.normal === 0, String(small.normal));
check('speed: 48V 1000W on 20" wheels does 38-48 km/h', inBand(small.bike1000, 38, 48), small.bike1000.toFixed(1));
check('speed: a 36V 350W scooter on 8.5" does 20-28 km/h', inBand(small.m365, 20, 28), small.m365.toFixed(1));
check('speed: a heavier rider is not faster', small.heavy);
check('speed: more volts on the same scooter is faster', small.voltUp);
const offTop = small.presets.filter(([, r]) => Math.abs(r - 1) > 0.03);
check('speed: every vehicle class reaches the top speed the range page uses (±3%)', offTop.length === 0, offTop.map(([k, r]) => `${k} ${(r * 100).toFixed(0)}%`).join(', '));
check('upgrade: 48→60V on a scooter is faster and goes further', small.scoot.s1.top > small.scoot.s0.top * 1.05 && small.scoot.km1 > small.scoot.km0 && small.scoot.feasible, `${small.scoot.s0.top.toFixed(0)}→${small.scoot.s1.top.toFixed(0)} km/h, ${small.scoot.km0.toFixed(0)}→${small.scoot.km1.toFixed(0)} km`);
check('upgrade: 36→72V on a 350W bike is refused, with the reason', !small.wild.feasible && small.wild.notes.some((n) => n.lvl === 'bad'), small.wild.notes.map((n) => n.t).join(' | '));
check('cost: an e-bike costs ₪0.3-3 per 100km of electricity', inBand(small.cost.elec100, 0.3, 3), small.cost.elec100.toFixed(2));
check('cost: and saves against a car', small.cost.saveMonth > 0, small.cost.saveMonth.toFixed(0));
check('cost: an ATV uses more per km than an e-bike', small.costAtv.whKm > small.cost.whKm * 3, `${small.costAtv.whKm.toFixed(0)} / ${small.cost.whKm.toFixed(0)}`);
check('health: 40 of 60km is 67% — a spot repair', small.h1.pct === 67 && small.h1.key === 'spot', `${small.h1.pct} ${small.h1.key}`);
check('health: the same reading in winter is a healthier pack', small.hw.pct > small.hs.pct + 4, `${small.hw.pct} / ${small.hs.pct}`);

// the five pages themselves: picking a vehicle fills it in, the answer is a number, never NaN
const pages = {};
for (const [tab, box] of [['charge', 'chResult'], ['health', 'heResult'], ['speed', 'spResult'], ['cost', 'coResult'], ['upgrade', 'upResult']]) {
  await page.evaluate((t) => setCalcTab(t), tab);
  pages[tab] = await page.evaluate((b) => document.getElementById(b).textContent, box);
}
check('the charge page answers in hours', /\d+:\d\d שעות/.test(pages.charge) && !/NaN|undefined/.test(pages.charge), pages.charge.slice(0, 120));
check('the health page answers in %', /\d+% בריאות/.test(pages.health) && !/NaN|undefined/.test(pages.health), pages.health.slice(0, 120));
check('the speed page answers in km/h', /\d+ קמ"ש/.test(pages.speed) && !/NaN|undefined/.test(pages.speed), pages.speed.slice(0, 120));
check('the cost page answers in ₪ and dates its prices', /₪[\d,]+ לחודש/.test(pages.cost) && /2026/.test(pages.cost) && !/NaN|undefined/.test(pages.cost), pages.cost.slice(0, 160));
check('the upgrade page answers', /מהירות|לא מומלץ/.test(pages.upgrade) && !/NaN|undefined/.test(pages.upgrade), pages.upgrade.slice(0, 120));
await page.evaluate(() => setCalcTab('speed'));
await page.selectOption('#spVeh', 'surron');
const surronSp = await page.evaluate(() => ({ V: document.getElementById('spV').value, W: document.getElementById('spW').value, wheel: document.getElementById('spWheel').value, out: document.getElementById('spResult').textContent }));
check('picking a Sur-Ron fills its voltage, motor and wheel', surronSp.V === '60' && surronSp.W === '4000' && surronSp.wheel === '19', JSON.stringify(surronSp).slice(0, 160));
const sweep2 = [];
for (const v of vehs) {
  for (const [tab, sel, box] of [['speed', 'spVeh', 'spResult'], ['cost', 'coVeh', 'coResult'], ['upgrade', 'upVeh', 'upResult']]) {
    await page.evaluate((t) => setCalcTab(t), tab);
    await page.selectOption('#' + sel, v);
    const t = await page.evaluate((b) => document.getElementById(b).textContent, box);
    if (/NaN|Infinity|undefined/.test(t) || !/\d/.test(t)) sweep2.push(`${tab}/${v}`);
  }
}
check('speed, cost and upgrade render for every vehicle class', sweep2.length === 0, sweep2.slice(0, 6).join(' | '));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
