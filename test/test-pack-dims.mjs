// The pack-size estimator, driven in a real browser.
//
// It answers "will this pack go in that scooter", which is a question with a wrong answer
// available: the previous version spaced cells at diameter + 1mm, i.e. 22mm for a 21700,
// when every bracket in the Wellgo catalogue is 21.5-23mm. A 20-cell row therefore came out
// up to 12mm short — small enough to look right and big enough to not fit.
//
//   node test/test-pack-dims.mjs
//   node test/test-pack-dims.mjs --selftest
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4196, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// A dialog here would mean an alert nobody can see on the phone; record, never accept.
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
await page.goto('http://127.0.0.1:4196/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

// Seed a saved scooter tray so the fit check has something to answer against, then read the
// estimator by calling the SHIPPING function — not a copy of its arithmetic.
const read = async (opts) => page.evaluate((o) => {
  localStorage.setItem('gp_dims', JSON.stringify(o.models));
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  set('dimCell', o.cell); set('dimV', o.v); set('dimAh', o.ah);
  set('dimHolder', o.holder); set('dimPerRow', o.perRow);
  if (o.extra != null) { set('dimExtra', o.extra); dimExtraTouched = true; }
  calcPackDims();
  const html = document.getElementById('dimResult').innerHTML;
  // The block is the chosen nickel's card since 2026-10-04 (one card per nickel).
  const mm = ((document.querySelector('#dimResult .dim-nk.sel .dim-size') || {}).textContent || '').match(/(\d+) × (\d+) × (\d+)/);
  return { html, L: +mm[1], W: +mm[2], H: +mm[3], text: document.getElementById('dimResult').textContent };
}, opts);

const TRAY = [{ id: 1, model: 'מבחן-גדול', l: 400, w: 200, h: 120 }, { id: 2, model: 'מבחן-קטן', l: 150, w: 90, h: 80 }];
const base = { cell: '21700-50e', v: 60, ah: 20, perRow: 10, models: TRAY };

// 16S4P = 64 cells, HIS way (2026-09-25): each 4P group across, sixteen rows along, on ניקל ב׳ —
// the 22.5 diagonal since his re-measure of 2026-10-04 (19.49 between rows; it was 21.5 / 18.62).
//   L = 15*19.49 + 21.15 + 3 + 22 (BMS at 60V) = 338     W = 3*22.5 + 21.15 + 3 + 11.25 = 103     H = 70.15 + 4 = 74
// The 11.25 is the HALF CELL (Daniel, 2026-10-04: "לתקן — להוסיף חצי תא"): rows 19.49 apart nest
// only by sitting half a pitch over, so every other row sticks out by half a cell. It said 92.
// The BMS allowance goes on the LENGTH since 2026-09-25; the height is the standing cells alone.
// (The two Wellgo catalogue brackets this used — square and honeycomb 21.4 — left the list on
// 2026-09-25; he does not build on them.)
const honey = await read({ ...base, holder: 'diag-b' });
check('16S4P block, ניקל ב׳ 22.5: 338 x 103 x 74 (with the half cell)', honey.L === 338 && honey.W === 103 && honey.H === 74, `${honey.L} x ${honey.W} x ${honey.H}`);
check('and it reports 64 cells', /64 תאים/.test(honey.text), honey.text.slice(0, 80));
// Energy and weight were taken off the result on 2026-09-26 at his word; asserted absent.
check('no energy or weight line', !/Wh|ק"ג|אנרגיה/.test(honey.text), honey.text.slice(0, 120));

// A square bracket must be LONGER than a diagonal one: the diagonal nests the rows at
// pitch x sin60 along the length, which is the 13% the diagonal exists for.
const diagA = await read({ ...base, holder: 'diag-a' });
const square = await read({ ...base, holder: 'square-23' });
check('square is longer along the rows than the diagonal', square.L > diagA.L, `${square.L} vs ${diagA.L}`);
check('the diagonal row spacing is the sin60 one', Math.abs((diagA.L - 22 - 24.15) - 15 * 22.7 * 0.866) <= 1.5, String(diagA.L));
check('ניקל א׳ (W 22.7) is a little longer than ניקל ב׳ (22.5)', diagA.L - honey.L === 3, `${diagA.L} vs ${honey.L}`);
check('the 23mm square bracket is longer than ניקל ב׳', square.L > honey.L, `${square.L} vs ${honey.L}`);
const cell18 = await read({ ...base, cell: '18650-25p', holder: 'diag-b' });
check('18650 is a shorter cell', cell18.H < honey.H, `${cell18.H} vs ${honey.H}`);

// (Two layers are decided by the tray now, never typed — test-pack-calc covers when.)

// The fit check is the point of the page. 227x135x92 goes in the 400x200x120 tray and not in
// the 150x90x80 one — and it must survive being turned, which is why it sorts both triples.
check('fits the big tray', /נכנס ל: .*מבחן-גדול/.test(honey.text), honey.text.slice(-90));
check('does not claim the small tray', !/מבחן-קטן/.test(honey.text), honey.text.slice(-90));
// Through read(), not a bare evaluate: the form still held the two-layer config from the
// check above, so the first version of this measured a 166mm-tall block against a 150mm tray
// and failed on its own leftover state. A test that carries state between cases is testing
// the order it was written in.
const rotated = await read({ ...base, holder: 'diag-b', models: [{ id: 3, model: 'מסובב', l: 100, w: 360, h: 150 }] });
check('a turned tray still counts as a fit', /מסובב/.test(rotated.text), rotated.text.slice(-90));

// The allowance is derived from the VOLTAGE now — 14 / 18 / 22 / 26 — and is still an input
// he can override. So this asserts the difference against what the page actually chose,
// rather than against a literal that goes stale the next time the ladder moves.
const noExtra = await read({ ...base, holder: 'diag-b', extra: SELFTEST ? 18 : 0 });
check('the BMS allowance goes on the length, not the height', honey.L - noExtra.L === 22 && noExtra.H === honey.H,
  `L ${honey.L} -> ${noExtra.L}, H ${honey.H} -> ${noExtra.H}`);

// 20S6P on ניקל א׳ (22.7), no tray: six across with the half cell, twenty groups along.
//   W = 5*22.7 + 11.35 + 21.15 + 3 = 149     L = 19*19.66 + 21.15 + 3 = 398 (no BMS allowance here)
// This was "his measured 72V 30Ah pack: 390 x 135" until 2026-10-04, when the half cell went in at
// his word — a block that came out 138 wide only because the half cell was missing. His 390 x 135
// pack is reproduced where it is modelled right: on the no-template diagonal (19 / 21.4) in
// test-oldpack, which reads it back as twenty to a row and six rows.
const real = await read({ ...base, v: 72, ah: 30, perRow: 6, holder: 'diag-a' });
check('20S6P on ניקל א׳: 398 x 149, the half cell included', real.L === 398 && real.W === 149, `${real.L} x ${real.W}`);

// The vehicle table is the answer to "what goes in this scooter", and clicking one has to
// leave the estimator holding that build rather than merely scrolling to it.
const picked = await page.evaluate(() => {
  useVehiclePack('Nami Burn-E');
  return { v: document.getElementById('dimV').value, ah: document.getElementById('dimAh').value,
           holder: document.getElementById('dimHolder').value, txt: document.getElementById('dimResult').textContent };
});
check('picking a vehicle fills its 72V build', picked.v === '72' && picked.ah === '50', JSON.stringify(picked).slice(0, 90));
check('and matches the holder to the pitch it was measured at', picked.holder === 'square-23', picked.holder);
check('the build it fills is the one it lists', /20S 10P/.test(picked.txt), picked.txt.slice(0, 70));

// Over the tray ceiling must SAY so. Wolf King GTR is 20S12P = 240 against a max of 240, so
// the warning must NOT fire there — a check that always warns is the same as one that never does.
const over = await page.evaluate(() => {
  useVehiclePack('Wolf King GTR');
  const ok = document.getElementById('dimResult').textContent;
  dimAhPending = 80; calcPackDims();
  useVehiclePack('Blade GT');
  return { atMax: ok, blade: document.getElementById('dimResult').textContent };
});
check('no warning when the build equals the ceiling', !/⚠/.test(over.atMax), over.atMax.slice(-60));

// The Inokim OX is counted per bracket, not computed: Daniel took 140 cells out of its tub
// with no diagonal holder, 136 on one and 126 on the other. A build of 136 is therefore fine
// on the square holder and over on the 21.6/24.6 one, which a single ceiling cannot express.
const ox = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  useVehiclePack('Inokim OX');
  const filled = document.getElementById('dimResult').textContent;
  // The 21.5 nickel is the OX's tightest: 126 counted, against 136 on the 22.5 and 140 with
  // no diagonal holder at all. A 140-cell build is over on this one and fine on the square.
  set('dimHolder', 'diag-b'); set('dimAh', 35); set('dimV', 72); calcPackDims();
  const overDiag = document.getElementById('dimResult').textContent;
  const zc = document.querySelector('#dimResult .dim-nk[data-holder="diag-b"]'), bareZ = zc ? +zc.dataset.bare : 0;
  // his count is cells alone: with no BMS allowance the square takes the 140 he counted
  set('dimExtra', 0); dimExtraTouched = true;
  set('dimHolder', 'square-23'); calcPackDims();
  const okSquare = document.getElementById('dimResult').textContent;
  return { filled, overDiag, okSquare, bareZ };
});
// Tapping it opens on a build that goes in: 20S6P at 72V, the BMS at the end (2026-10-09; it opened on
// the table's 20S7P and "⛔ לא נכנס" for a day after the BMS moved to the end).
check('tapping the OX opens on 20S6P at 72V, and it goes in', /20S 6P/.test(ox.filled) && /✅ נכנס ל-Inokim OX/.test(ox.filled) && !/⛔/.test(ox.filled), ox.filled.slice(0, 120));
// Since 2026-10-17 a tray the holder cannot fill takes its last rows without it ("כמה שורות בסוף לבנות בלי
// תבנית"): 140 on ניקל Z is his 126 in the holder and the rest bare at the end.
check('140 cells on the diagonal holder he counted 126: the holder\'s 126, and the last rows without it', /✅/.test(ox.overDiag) && ox.bareZ > 0 && !/חורג/.test(ox.overDiag), [ox.bareZ, ox.overDiag.slice(-120)]);
// It used to test only for ⚠, and passed for two weeks over "⛔ לא נכנס ל-Inokim OX — 17S מתוך 20S".
// The answer itself is asserted now — for the cells alone, which is what he counted. With the BMS at
// the end it does not go in (the narrow-part section below).
check('and with no BMS allowance the square takes his 140, with no ⛔ and no ⚠', /✅ נכנס ל-Inokim OX/.test(ox.okSquare) && !/⛔|⚠/.test(ox.okSquare), ox.okSquare.slice(0, 120));

// ---- what a tap opens on (2026-10-09) ----
// The table's 60V/72V builds are estimates; a tray that is known decides. Every vehicle whose tray
// takes something at a voltage must open on a build that goes in, at 72V and at 60V. --selftest
// takes tubBest away, and the table's estimates come back.
const taps = await page.evaluate((SELF) => {
  const real = window.tubBest;
  if (SELF) window.tubBest = () => null;
  document.getElementById('dimCell').value = '21700-50e';
  document.getElementById('dimExtra').value = ''; dimExtraTouched = false; dimExtraAuto = null;
  const bad = [];
  let n = 0;
  for (const v of VEHICLE_PACKS) {
    if (!v.tub || isBomber(v) || v.case) continue;
    for (const V of [72, 60]) {
      if (!(V === 72 ? v.p72 : v.p60)) continue;
      const tb = cellTub(tubOf(v), V >= 72 ? 26 : 22), c = DIM_CELLS['21700-50e'];
      if (!tb || !holdersFor(21700).some((h) => maxPFor(v, tb, 21700, h, V, c))) continue;
      useVehiclePack(v.m, V);
      n++;
      const head = (document.querySelector('#dimResult .dim-ok, #dimResult .dim-over') || {}).textContent || '';
      if (!/✅/.test(head)) bad.push(`${v.m} ${V}V: ${head.slice(0, 70)}`);
    }
  }
  clearDimVehicle();
  window.tubBest = real;
  return { n, bad };
}, SELFTEST);
check('every vehicle whose tray takes a build opens on one that goes in (72V and 60V)', taps.n >= 8 && taps.bad.length === 0, `${taps.n} opened · ${taps.bad.slice(0, 4).join(' | ')}`);

// ---- 18650 opens on the biggest the tray takes (2026-10-09) ----
// Daniel: "OX ב-18650: לפתוח על הכי גדול". The table's P is a 21700 count, so with 18650 it was a
// number from another cell: the OX at 60V opened on 16S9P though 16S11P goes in. Now an 18650 build on
// a known tray opens on the most P any of his nickels takes (maxPFor, worked out here independently of
// the code that chooses). --selftest takes tubBest away.
const big = await page.evaluate((SELF) => {
  const real = window.tubBest;
  if (SELF) window.tubBest = () => null;
  document.getElementById('dimCell').value = '18650-35v';
  document.getElementById('dimExtra').value = ''; dimExtraTouched = false; dimExtraAuto = null;
  const v = vehicleByName('Inokim OX'), c = DIM_CELLS['18650-35v'];
  const out = [];
  for (const V of [60, 72]) {
    const tb = cellTub(tubOf(v), V >= 72 ? 26 : 22);
    const most = Math.max(...holdersFor(18650).map((h) => maxPFor(v, tb, 18650, h, V, c) || 0));
    useVehiclePack('Inokim OX', V);
    const shown = (document.getElementById('dimResult').innerText.match(/(\d+)S (\d+)P/) || []);
    out.push({ V, most, shown: shown[0] || '', P: +shown[2] || 0, ok: /✅/.test(document.getElementById('dimResult').innerText) });
  }
  document.getElementById('dimCell').value = '21700-50e';
  clearDimVehicle();
  window.tubBest = real;
  return out;
}, SELFTEST);
check('tapping the OX with 18650 opens on the biggest build its tray takes (60V 16S11P, and at 72V too)',
  big.length === 2 && big.every((b) => b.P === b.most && b.ok) && big[0].most === 11, big);

// ---- the OX's tub is drawn as it is: wide, then narrow (2026-10-09) ----
// Daniel: "אמרתי לך שזה יהיה לא מלבן אחיד. זה אמור להיות רחב וזה מתקטן, נהיה צר". The tray was drawn
// only when groups ran into the narrow part, so 20S6P — the build the OX opens on at 72V, all of it in
// the wide part — came out as a plain block of cells. Now the tub is drawn round every OX plan, the
// narrow part narrower than the wide one and centred, and the BMS at its far end. --selftest takes
// the outline away.
const tub = await page.evaluate((SELF) => {
  if (SELF) window.trayOutline = () => null;
  const one = (V, cell) => {
    document.getElementById('dimCell').value = cell;
    useVehiclePack('Inokim OX', V); calcPackDims();
    const svg = document.querySelector('#dimResult .dim-nk.sel svg.pack-svg');
    const poly = svg && svg.querySelector('polygon.pack-outline');
    const pl = dimLast && dimLast.plan;
    return { V, cell, filled: (document.getElementById('dimResult').innerText.match(/\d+S \d+P/) || [''])[0],
      pts: poly ? poly.getAttribute('points').trim().split(/\s+/).length : 0,
      outline: pl && pl.outline, bms: pl && pl.bms };
  };
  const r = [one(72, '21700-50e'), one(60, '21700-50e'), one(60, '18650-35v')];
  document.getElementById('dimCell').value = '21700-50e';
  clearDimVehicle();
  return r;
}, SELFTEST);
const tubOk = (t) => {
  const o = t.outline;
  if (!o || o.length !== 8 || t.pts !== 8) return false;
  const wide = o[6][1] - o[0][1], narrow = o[4][1] - o[3][1];          // 165 and 140
  const mid = (o[0][1] + o[6][1]) / 2, nmid = (o[3][1] + o[4][1]) / 2;
  const end = o[3][0];                                                   // the far end of the narrow part
  return Math.abs(wide - 165) < 0.01 && Math.abs(narrow - 140) < 0.01 && Math.abs(mid - nmid) < 0.01
    && t.bms && t.bms.x > o[1][0] && t.bms.x + t.bms.w <= end + 0.01 && t.bms.x + t.bms.w > end - 5;
};
check('the OX tub is drawn wide then narrow, round 20S6P at 72V, 16S8P at 60V and the 18650 build, the BMS at its far end',
  tub.every(tubOk), tub.map((t) => `${t.V}V ${t.cell} ${t.filled}: ${t.pts} pts ${JSON.stringify(t.bms)}`));

// ---- the OX's narrow part (2026-10-08) ----
// Daniel: "תבדוק איך להכניס לאינוקים 20S7P 21700 חלק רחב 42.5×16.5 חלק צר 6×14". The calculator saw
// only the 425×165. With the narrow part, 60 along and 140 across, centred, the groups the main part
// has no rows for go on into it. And the BMS sits AT THE END, never on top of the cells (his word the
// same evening: "ה-BMS יושב בסוף לא מעל התאים") — v421 put it on top and said 20S7P went in. With the
// 26mm allowance at the end, 20S7P does not go in on any nickel; the best offered is 20S6P on ניקל ב׳,
// in the wide part, and the square 23 takes only 20S2P at 72V. With a 15mm BMS the square takes 20S5P,
// groups 19 and 20 in two rows of five in the narrow part, the BMS drawn after them.
// --selftest takes the narrow part away.
const oxn = await page.evaluate((SELF) => {
  const real = window.tailFit;
  if (SELF) window.tailFit = () => null;
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  document.getElementById('dimCell').value = '21700-50e';
  document.getElementById('dimExtra').value = '26'; dimExtraTouched = true;   // the allowance he opens it on at 72V
  useVehiclePack('Inokim OX');
  set('dimHolder', 'square-23'); set('dimAh', 35); calcPackDims();
  const res = document.getElementById('dimResult').innerText;
  const v = vehicleByName('Inokim OX'), c = DIM_CELLS['21700-50e'], tb = tubOf(v);
  const max = (h, V, e) => maxPFor(v, cellTub(tb, e), 21700, h, V, c);
  // a 15mm BMS: 20S5P on the square, two groups in the narrow part
  document.getElementById('dimExtra').value = '15';
  set('dimAh', 25); calcPackDims();
  const res15 = document.getElementById('dimResult').innerText;
  const card = document.querySelector('#dimResult .dim-nk.sel');
  const whole15 = !!(card && card.dataset.snake === '1' && card.dataset.across === '7');
  const svg = card && card.querySelector('svg.pack-svg');
  const bms = dimLast && dimLast.plan.bms;
  const out = { res, res15, whole15, tb, cells: svg ? svg.querySelectorAll('circle').length : 0, outline: !!(svg && svg.querySelector('.pack-outline')),
    bmsDrawn: !!(svg && svg.querySelector('.pack-bms')), bmsInNarrow: !!(bms && bms.y > 5 && bms.x > 400),
    label: dimLast ? { n: dimLast.plan.cells.length, foot: dimLast.foot } : null,
    m72: max('square-23', 72, 26), m60: max('square-23', 60, 22), a72: max('diag-a', 72, 26), b72: max('diag-b', 72, 26), s15: max('square-23', 72, 15),
    list: (() => { renderVehiclePacks(); const r = [...document.querySelectorAll('#vpList .list-item')].find((x) => ((x.querySelector('.list-item-title') || {}).textContent || '').trim() === 'Inokim OX'); return r ? r.textContent.replace(/\s+/g, ' ') : ''; })() };
  document.getElementById('dimExtra').value = '26';
  clearDimVehicle();
  window.tailFit = real;
  return out;
}, SELFTEST);
check('the OX tub is read with its narrow part, 60 along and 140 across',
  oxn.tb && oxn.tb.L === 425 && oxn.tb.W === 165 && oxn.tb.H === 65 && oxn.tb.nx && oxn.tb.nx.L === 60 && oxn.tb.nx.W === 140, JSON.stringify(oxn.tb));
// Rows the whole width in every tray, the OX too (Daniel, 2026-10-17, night, over his list of questions:
// "נחש בכל הכלים, גם OX"). With the 26mm BMS, 20S7P does not go in on the square; on W it does.
check('72V 20S7P with a 26mm BMS: ⛔ on the square, and the best offered is 20S7P on ניקל W',
  /⛔ לא נכנס ל-Inokim OX/.test(oxn.res) && /הכי גדול: 20S 7P · 35Ah · ניקל W \(/.test(oxn.res), oxn.res.slice(0, 160));
check('nothing puts the BMS on top of the cells', !/מעל התאים|עובי ה-BMS|BMS מעל/.test(oxn.res + oxn.res15 + ((oxn.label || {}).foot || '')), oxn.res.slice(0, 260));
check('the tray row names the narrow part and the riser',
  /425 × 165 × 65 מ"מ \+ חלק צר 60 × 140 · מגביה 10 מ"מ/.test(oxn.res), oxn.res.slice(0, 260));
// The whole width: with a 26mm BMS 72V takes 20S6P on the square and Z, 20S7P on W; 60V (22mm) 16S8P on
// the square.
check('maxima with a 26mm BMS at the end: 72V 20S6P on the square and Z, 20S7P on W; 60V 16S8P on the square',
  oxn.m72 === 6 && oxn.m60 === 8 && oxn.a72 === 7 && oxn.b72 === 6, [oxn.m72, oxn.m60, oxn.a72, oxn.b72]);
// 20S5P with a 15mm BMS: rows of seven across the wide part, the groups running on from row to row.
check('a 15mm BMS: 20S5P on the square goes in, rows the whole width', oxn.s15 === 6
  && /✅ נכנס ל-Inokim OX/.test(oxn.res15) && oxn.whole15, [oxn.s15, oxn.whole15, oxn.res15.slice(0, 200)]);
check('its drawing: 100 cells, the tray round them, the BMS at the end of the narrow part',
  oxn.cells === 100 && oxn.outline && oxn.bmsDrawn && oxn.bmsInNarrow && oxn.label && oxn.label.n === 100,
  [oxn.cells, oxn.outline, oxn.bmsDrawn, oxn.bmsInNarrow, JSON.stringify(oxn.label)]);
check('the vehicle list shows both parts of the tub', /425×165×65 \+ 60×140/.test(oxn.list), oxn.list);

// The OX as he measured it (2026-10-15): the BMS takes 14mm at the end of the narrow part, and the
// block sits centred across the tray, the narrow part narrowing it on both sides, each group in the
// same columns in both parts. --selftest puts the block back against one wall.
const oxc = await page.evaluate((SELF) => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  dimExtraTouched = false; dimExtraAuto = null;
  document.getElementById('dimCell').value = '21700-50e';
  useVehiclePack('Inokim OX', 72);
  const extra = document.getElementById('dimExtra').value;
  set('dimHolder', 'square-23'); set('dimAh', 30); calcPackDims();
  const pl = dimLast && dimLast.plan, tb = tubOf(vehicleByName('Inokim OX'));
  const cells = pl ? pl.cells : [];
  if (SELF) cells.forEach((c) => { c.y -= 20; });
  const ys = cells.map((c) => c.y), lo = Math.min(...ys) - pl.dia / 2, hi = Math.max(...ys) + pl.dia / 2;
  // the drawing's 0 is one wall in from the tray's side: the tray's middle across is W/2 - wall
  const mid = tb.W / 2 - DIM_WALL;
  // the whole width: the first row is seven on the square, group 1's six and the first of group 2
  const first = cells.filter((c) => Math.abs(c.x - cells[0].x) < 0.01);
  const sameCols = first.length === 7 && first.filter((c) => c.g === 0).length === 6 && first.filter((c) => c.g === 1).length === 1;
  const out = { extra, res: document.getElementById('dimResult').innerText.slice(0, 160), n: cells.length,
    off: Math.abs((lo + hi) / 2 - mid), sameCols, max: maxPFor(vehicleByName('Inokim OX'), cellTub(tb, 14), 21700, 'square-23', 72, DIM_CELLS['21700-50e']) };
  dimExtraTouched = false;
  clearDimVehicle();
  return out;
}, SELFTEST);
check('the OX\'s own BMS allowance is his 14mm, and with it the square takes 20S6P', oxc.extra === '14' && oxc.max === 6 && /✅ נכנס ל-Inokim OX/.test(oxc.res) && oxc.n === 120, oxc);
check('the block is centred across the tray, its rows the whole width', oxc.off < 0.5 && oxc.sameCols, oxc);

// The drawing is the answer to "how do I lay it out", so it has to BE the layout: one circle
// per cell, in the grid the numbers above it describe. A picture that disagrees with the
// figures is worse than no picture.
//
// One card per nickel since 2026-10-04 (Daniel: "יראה לי ציור בכל אחד מ-3 הניקלים"): each of his
// three nickels gets its block, its layout and its drawing, and the chosen one is outlined.
const draw = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30);
  clearDimVehicle();
  set('dimHolder', 'diag-a'); calcPackDims();
  const cards = [...document.querySelectorAll('#dimResult .dim-nk')];
  const sel = document.querySelector('#dimResult .dim-nk.sel');
  const svg = sel && sel.querySelector('svg.pack-svg');
  const block = ((sel && sel.querySelector('.dim-size')) || {}).textContent.match(/(\d+) × (\d+) × (\d+)/) || [];
  const fills = svg ? [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('fill')) : [];
  return { circles: svg ? svg.querySelectorAll('circle').length : 0, hasSvg: !!svg,
           cards: cards.map((k) => k.dataset.holder + ':' + k.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) circle').length).join(' '),
           selHolder: sel ? sel.dataset.holder : '',
           groups: svg ? [...svg.querySelectorAll('text.pack-group')].map((t) => t.textContent) : [],
           ends: svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent).filter((s) => /^B[−+]$/.test(s)).join(',') : '',
           // the first group and the second are shaded differently, the first and third alike
           bands: fills.length >= 18 && fills[0] !== fills[6] && fills[0] === fills[12],
           txt: svg ? svg.textContent : '', L: block[1], W: block[2], res: document.getElementById('dimResult').innerText };
});
// Four since 2026-10-17: an H at 22.5 beside the 23 ("וגם יש H אם 22.5M").
check('four cards, one per nickel, each drawing the whole pack', draw.cards === 'diag-a:120 diag-b:120 square-225:120 square-23:120', draw.cards);
check('the chosen nickel is the outlined card', draw.selHolder === 'diag-a', draw.selHolder);
check('the drawing has one circle per cell (120)', draw.circles === 120, String(draw.circles));
// "צבע לסירוגין + מספר" (2026-10-04): the groups alternate in shade and are numbered B− to B+.
check('the groups alternate in shade', draw.bands, String(draw.bands));
check('and are numbered from the first to the last, 1 to 20', draw.groups[0] === '1' && draw.groups[draw.groups.length - 1] === '20' && draw.groups.length >= 10, draw.groups.join(' '));
check('with B− and B+ at the two ends', draw.ends === 'B−,B+', draw.ends);
// The drawing's labels are the block's OWN size — they once read 473 beside a block of 476,
// because the picture left the bracket walls out. Counts are said once, in the layout row.
// The sizes are said once, in the rows above; the drawing carries none (2026-09-27, Daniel:
// "למה המידות כתובות כפול?").
check('the drawing does not repeat the sizes', !/מ"מ/.test(draw.txt), draw.txt);
const bmsDraw = await page.evaluate((SELF) => {
  const run = (x) => { document.getElementById('dimExtra').value = String(x); dimExtraTouched = true; calcPackDims();
    const sel = document.querySelector('#dimResult .dim-nk.sel');
    const m = (sel.querySelector('.dim-size').textContent || '').match(/(\d+) × (\d+) × (\d+)/) || [];
    return { txt: sel.querySelector('svg.pack-svg').textContent, box: !!sel.querySelector('svg .pack-bms'), L: m[1] }; };
  if (SELF) window.standPlan = ((f) => (o) => f({ ...o, extra: 0 }))(window.standPlan);
  return { with26: run(26), with0: run(0) };
}, SELFTEST);
check('and draws the BMS at the end of the block', /BMS/.test(bmsDraw.with26.txt) && bmsDraw.with26.box, bmsDraw.with26);
check('and no BMS box when there is no allowance', !/BMS/.test(bmsDraw.with0.txt) && !bmsDraw.with0.box, bmsDraw.with0.txt);
check('and does not repeat the counts', !/תאים בשורה|שורות|עיגול/.test(draw.txt), draw.txt);
// No layout row (Daniel, 2026-10-17: "תמחוק את ההסבר של הפריסה זה לא מעניין"): the drawing is the layout.
check('no layout row: the drawing is the layout', !/פריסה|רוחב 6P · אורך 20S/.test(draw.res), draw.res);

// Tapping a card chooses that nickel: the selector follows, and the outline moves with it.
const tap = await page.evaluate(() => {
  document.querySelector('#dimResult .dim-nk[data-holder="square-23"]').click();
  return { holder: document.getElementById('dimHolder').value,
           sel: (document.querySelector('#dimResult .dim-nk.sel') || {}).dataset.holder };
});
check('tapping a nickel card chooses that nickel', tap.holder === 'square-23' && tap.sel === 'square-23', tap);

// A staggered layout must actually be drawn staggered, or the picture lies about the shape.
const stag = await page.evaluate(() => {
  // Drawn along the length now: a group is a column, and the stagger shows as a vertical
  // offset between the first cell of one group and the first of the next.
  const ys = (h) => { document.getElementById('dimHolder').value = h; calcPackDims();
    return [...document.querySelectorAll('#dimResult .dim-nk.sel svg.pack-svg:not(.pack-side-bottom) circle')].map(c => +c.getAttribute('cy')); };
  const d = ys('diag-a'), s = ys('square-23');
  return { diagFirstTwoRows: d[0] !== d[6], squareFirstTwoRows: s[0] === s[6] };
});
check('diagonal rows are offset from each other', stag.diagFirstTwoRows, JSON.stringify(stag));
check('square rows are not', stag.squareFirstTwoRows, JSON.stringify(stag));

// The OX is in the vehicle list already, so the saved-trays list no longer gets a copy
// (Daniel, 2026-09-25), and the copy seeded earlier is removed — but ONLY that one: a tray he
// measured and saved himself, even under the same model name, is never touched.
const seeded = await page.evaluate((SELF) => {
  const aiOx = { id: 'dox', model: 'Inokim OX', l: 425, w: 165, h: 0, notes: 'אמבטיה בשני חלקים: רחב 425×165 + צר 60×140 מ"מ. גובה טרם נמדד.' };
  const mine = { id: 'dmine', model: 'Inokim OX', l: 420, w: 160, h: 70, notes: 'מדדתי', measured: true };
  const other = { id: 'dz', model: 'Zero 10X', l: 300, w: 150, h: 60 };
  localStorage.removeItem('gp_dims_seed_ox'); localStorage.setItem('gp_dims', '[]');
  if (SELF) window.seedOxTub = () => {};           // the old seeded row stays
  seedOxTub(); const fresh = (JSON.parse(localStorage.getItem('gp_dims')) || []).length;
  localStorage.setItem('gp_dims', JSON.stringify([aiOx, mine, other])); seedOxTub();
  const after = (JSON.parse(localStorage.getItem('gp_dims')) || []).map((d) => d.id);
  return { fresh, after };
}, SELFTEST);
check('a fresh hub gets no OX copy in the saved trays', seeded.fresh === 0, JSON.stringify(seeded));
check('the seeded AI OX row is removed, his own rows are kept',
  JSON.stringify(seeded.after) === JSON.stringify(['dmine', 'dz']), JSON.stringify(seeded));

// The fit line judges only trays with all three measurements. A saved tray with no height
// used to produce "doesn't fit any saved model" for every pack — a verdict nothing measured.
const fitMsg = await page.evaluate((SELF) => {
  clearDimVehicle();   // with a vehicle chosen the verdict is about that vehicle instead
  const say = (dims) => {
    localStorage.setItem('gp_dims', JSON.stringify(dims));
    const r = document.getElementById('dimResult');
    calcPackDims();
    return r ? r.innerText : '';
  };
  const noH = say([{ id: 'a', model: 'X', l: 400, w: 200, h: SELF ? 5 : 0 }]);
  const full = say([{ id: 'b', model: 'Y', l: 1, w: 1, h: 1 }]);
  localStorage.setItem('gp_dims', '[]');   // later cases read the fit line too
  return { noH, full };
}, SELFTEST);
check('a tray with no height is not judged as "does not fit"',
  !/לא נכנס לאף דגם שמור/.test(fitMsg.noH) && /אין דגם שמור עם מידות מלאות/.test(fitMsg.noH), fitMsg.noH.slice(-120));
check('a tray with full dims still gets a verdict', /לא נכנס לאף דגם שמור|נכנס ל:/.test(fitMsg.full), fitMsg.full.slice(-120));

// The vehicle cards carry no "minimum area" line any more (approved 2026-09-25).
const cards = await page.evaluate(() => { renderVehiclePacks(); return (document.getElementById('calctab-dims') || document.body).innerText; });
check('no "minimum area" line on the vehicle cards', !/שטח מינימלי/.test(cards), '');

// Real datasheet dimensions, not the format name. The 50SG is 21.35mm across against the 50E
// and 50PL at 21.15, and in a 21.5mm no-spacer bracket that is 0.05mm of clearance — it does
// not go in. A staggered layout is the opposite case: 19.5mm between rows holds 21.15mm cells
// because the nearest neighbour sits half a pitch sideways, and the first version of this
// check condemned every honeycomb pack in the table.
const clear = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  const run = (cell, holder) => { set('dimCell', cell); set('dimHolder', holder); set('dimV', 72); set('dimAh', 20); calcPackDims();
    return document.getElementById('dimResult').textContent; };
  clearDimVehicle();
  // a 21.4 bracket (custom — the no-spacer one): 0.05mm for the 50SG, 0.25 for the 50E
  const c214 = (cell) => { set('dimPitchAlong', 21.4); set('dimPitchAcross', 21.4); return run(cell, 'custom'); };
  const out = { sgTight: c214('21700-50sg'), eOk: c214('21700-50e'), honey: run('21700-50e', 'diag-b'),
    sg215: run('21700-50sg', 'diag-b'), c185: run('18650-25p', 'diag-185') };
  set('dimCell', '21700-50e');
  return out;
});
check('a 21.35mm 50SG is flagged in a 21.4mm bracket', /לא נכנס/.test(clear.sgTight), clear.sgTight.slice(-80));
check('a 21.15mm 50E in the same bracket is not', !/לא נכנס/.test(clear.eOk), clear.eOk.slice(-80));
// 0.15mm of clearance is a bracket that is built, not a warning: the 50SG in the 21.5 nickel,
// and an 18.35mm 18650 in his 18.5 diagonal.
check('0.15mm of clearance is not flagged (50SG on 21.5, 18650 on 18.5)', !/לא נכנס/.test(clear.sg215) && !/לא נכנס/.test(clear.c185), [clear.sg215.slice(-60), clear.c185.slice(-60)]);
check('and a honeycomb row pitch under the diameter is fine', !/לא נכנס/.test(clear.honey), clear.honey.slice(-80));

// One 21700 bracket is 10x15 holes, and a bigger block is two pieces butted together. The page
// USED to say so on screen; Daniel had that line removed on 2026-09-22. These assert it is gone
// rather than being deleted — the same rule the quick pricer left behind. A half-removed
// feature leaves a live call to something that no longer exists, and that fails in the console
// instead of on screen. BRACKET_MAX itself is deliberately kept: it is the real sheet size.
const pieces = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  set('dimCell', '21700-50e'); set('dimHolder', 'square-23'); set('dimV', 72); set('dimAh', 60); set('dimPerRow', 20); calcPackDims();
  const big = document.getElementById('dimResult').textContent;
  set('dimAh', 10); set('dimPerRow', 10); calcPackDims();
  return { big, small: document.getElementById('dimResult').textContent };
});
check('the bracket-pieces line is gone on a 240-cell layout', !/חלקי תושבת/.test(pieces.big), pieces.big.slice(-70));
check('and on a small pack too', !/חלקי תושבת/.test(pieces.small), pieces.small.slice(-70));
check('but the layout itself still computes', /תצורה/.test(pieces.big), pieces.big.slice(0, 60));

const nickels = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  const run = (h) => { set('dimHolder', h); set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30); set('dimPerRow', 6); calcPackDims();
    const m = document.querySelector('#dimResult .dim-nk.sel .dim-size').textContent.match(/(\d+) × (\d+) × (\d+)/); return [+m[1], +m[2]]; };
  return { a: run('diag-a'), b: run('diag-b'), sq: run('square-23') };
});
check('the two diagonal nickels give different blocks', nickels.a[0] !== nickels.b[0] || nickels.a[1] !== nickels.b[1], JSON.stringify(nickels));
check('and the 23mm square block is larger in area than either diagonal', nickels.sq[0]*nickels.sq[1] > nickels.a[0]*nickels.a[1] && nickels.sq[0]*nickels.sq[1] > nickels.b[0]*nickels.b[1], JSON.stringify(nickels));

// The table checks itself: 16S and 20S in one tray should want roughly the same number of
// cells, and every consistent row drops P by one or two going up in voltage. Four rows carry
// the SAME P for both, which makes the 60V build 25% smaller in the same box — the shape of a
// number copied across rather than recalculated. They are flagged on the row, not corrected.
// (Read off the table itself since 2026-09-27 — the cards no longer print the builds.)
// A row whose builds ARE the calculator's answer for its own measured tray is exempt: nothing was
// copied, and the gap is geometry. The ATV tub (2026-10-05) takes 20S11P at 72V, a group to a row,
// and 16S18P at 60V, a group to two rows — 220 against 288 cells, in the same box, both his way.
const flagged = await page.evaluate(() => VEHICLE_PACKS.filter((v) => {
  const c60 = v.s60 * v.p60, c72 = v.s72 * v.p72;
  const own = (V, P) => { const b = tubMeasured(v) && tubBest(v, V, DIM_CELLS['21700-50e'], 21700); return !!b && b.P === P; };
  return c60 && c72 && Math.max(c60, c72) / Math.min(c60, c72) > 1.15 && !(own(60, v.p60) && own(72, v.p72));
}).map((v) => v.m));
// Corrected on 2026-08-31, so nothing should be flagged now — and the check stays, because
// its job is the NEXT row someone adds, not the four that have been fixed.
check('no row disagrees with itself any more', flagged.length === 0, flagged.join(', '));
check('and the corrected four are the ones that used to be', await page.evaluate(() => ['Nami Blast', 'Teverun'].every((m) => { const v = VEHICLE_PACKS.find((x) => x.m === m); return v && v.p60 > v.p72; })), 'ok');

// The nickel line used to price off his stock.
const nick = await page.evaluate(() => {
  const set = (id, v) => { if (id === 'dimAh') { dimAhPending = +v; return; } const el = document.getElementById(id); if (el) el.value = String(v); };
  set('dimCell', '21700-50e'); set('dimHolder', 'diag-a'); set('dimV', 72); set('dimAh', 30); set('dimPerRow', 6); calcPackDims();
  const six = document.getElementById('dimResult').textContent;
  set('dimAh', 15); calcPackDims();
  return { six, three: document.getElementById('dimResult').textContent };
});
// Removed 2026-09-25 at his word ("כל זה לא מעניין"); asserted absent so it does not creep back.
check('no nickel line in the result', !/ניקל\s*\d|מגעים|תבנית/.test(nick.six) && !/מגעים|תבנית/.test(nick.three), nick.six.slice(-90));
check('the battery size has its own row', /גודל סוללה\s*\d+ × \d+ × \d+/.test(nick.six), nick.six.slice(0, 120));

// The OEM capacity is the tray read backwards, so it has to reach the screen — and where it
// can be compared directly it must AGREE: Thunder 3 tops out at 72V 40Ah, which is 20S8P,
// which is the row.
// It is shown after the tap now, on the vehicle bar, beside the build it corroborates.
const oem = await page.evaluate(() => {
  const read = (m, V) => { useVehiclePack(m, V); return document.getElementById('dimVehChip').innerText + ' ' + document.getElementById('dimResult').innerText; };
  const out = { count: VEHICLE_PACKS.filter((v) => v.oem).length, thunder: read('Thunder 2/3', 72), blade: read('Blade GT', 60) };
  clearDimVehicle();
  return out;
});
check('twenty rows carry an OEM capacity', oem.count >= 20, String(oem.count));
check('Thunder 3: OEM 40Ah and the row is 20S8P', /מקורי 72V 40Ah/.test(oem.thunder) && /20S 8P/.test(oem.thunder), oem.thunder.slice(0,110));
check('Blade GT: OEM 35Ah and the row is 16S7P', /מקורי 60V 35Ah/.test(oem.blade) && /16S 7P/.test(oem.blade), oem.blade.slice(0,110));

// Every row gets a picture, and every picture is DRAWN. The check that matters is the last
// one: an <img> here would look perfect on this machine and arrive as the filter's grey
// placeholder on the phone the hub is actually used on — HTTP 200, valid JPEG magic bytes,
// a picture of nothing. That failure is invisible to every other check in this file.
const art = await page.evaluate((SELF) => {
  // --selftest empties the baked photos: the page with no bake behind it
  if (SELF && typeof VEH_PHOTOS !== 'undefined') for (const k of Object.keys(VEH_PHOTOS)) delete VEH_PHOTOS[k];
  renderVehiclePacks();
  const list = document.getElementById('vpList');
  const rows = [...list.querySelectorAll('.list-item')];
  const kinds = new Set(VEHICLE_PACKS.map((v) => vehType(v)));
  const imgs = [...list.querySelectorAll('img')];
  return {
    rows: rows.length,
    // Rows without any size are hidden from the bare list (2026-10-04), so the list is the sized ones.
    sized: VEHICLE_PACKS.filter((v) => tubOf(v) || v.side).length,
    svgs: list.querySelectorAll('svg').length + imgs.length,
    imgs: imgs.filter((i) => !/^data:image\//.test(i.getAttribute('src') || '')).length,
    photos: imgs.length,
    photoOnOx: !!rows.find((r) => ((r.querySelector('.list-item-title') || {}).textContent || '').trim() === 'Inokim OX' && r.querySelector('img')),
    kinds: [...kinds].sort().join(),
    inked: [...list.querySelectorAll('svg')].every((s) => s.querySelector('circle, path, rect')),
  };
}, SELFTEST);
check('every vehicle row carries a photo or a drawing', art.svgs === art.rows && art.rows >= art.sized && art.sized > 10, art.svgs + '/' + art.rows + '/' + art.sized);

// 2026-10-04 (Daniel): every vehicle is listed — hidden for an hour, then "למה אני לא רואה את כל
// הכלים" — with the ones that have no sizes at the end of their group; his measured trays carry
// ✓ נמדד and the table's guesses do not; the Plus shows the side he built to.
const lst = await page.evaluate(() => {
  const rowText = (name) => { const r = [...document.querySelectorAll('#vpList .list-item')].find((x) => ((x.querySelector('.list-item-title') || {}).textContent || '').trim() === name); return r ? r.textContent : null; };
  renderVehiclePacks();
  // Each group is a fold since 2026-10-05; per group: once an "אין מידות" card appears, no card
  // with sizes may follow it.
  let late = false, count = 0;
  for (const g of document.querySelectorAll('#vpList details.fold')) {
    let seenNone = false;
    for (const el of g.querySelectorAll('.fold-body > .list-item')) {
      count++;
      const none = /אין מידות/.test(el.textContent);
      if (none) seenNone = true; else if (seenNone) late = true;
    }
  }
  const out = { late, count, groupsFolded: [...document.querySelectorAll('#vpList details.fold')].every((d) => !d.open), total: VEHICLE_PACKS.length, zero: rowText('Zero 10X'), talaria: rowText('Talaria'), plus: rowText('Bomber Plus 15kW'), wolfBare: rowText('Wolf Warrior') };
  out.noSearch = !document.getElementById('vpSearch');
  return out;
});
check('every vehicle is listed, a vehicle with no sizes too', lst.count === lst.total && lst.wolfBare != null, [lst.count, lst.total]);
check('each vehicle group starts folded (2026-10-05, every tab folded)', lst.groupsFolded === true, lst.groupsFolded);
check('and in each group the ones with sizes come first', !lst.late, lst.late);
check('the vehicles page has no search box (his call, 2026-10-06)', lst.noSearch, lst.noSearch);
check('a measured tray says ✓ נמדד, a table guess does not', /✓ נמדד/.test(lst.zero || '') && !/✓ נמדד/.test(lst.talaria || ''), [lst.zero, lst.talaria]);
check('the Plus shows the side he built to, measured', /393×\d+×152/.test(lst.plus || '') && /✓ נמדד/.test(lst.plus || ''), String(lst.plus));
// The photos he chose (2026-09-27) are baked in; a model with none keeps its drawing.
check('the baked vehicle photos reach the list', art.photos >= 6 && art.photoOnOx, [art.photos, art.photoOnOx]);
check('and none of them is empty', art.inked, 'ok');
// A vehType that quietly answered "scooter" for everything would still pass the count above
// and give 29 identical pictures — which is worse than no picture, because it looks right.
// Five since the Silver Fish (2026-10-04): an e-bike is drawn as a bicycle, not a scooter.
// Six since the ATV tub (2026-10-05): a quad is drawn as a quad.
check('all six vehicle kinds are drawn', art.kinds === 'atv,bomber,ebike,emoto,moto,scooter', art.kinds);
check('nothing in the list fetches an image — every photo is inline', art.imgs === 0, String(art.imgs));

// The Bomber is a frame family whose versions differ by 3.5x in what they hold, so one row
// called "Bomber" was a wrong answer wearing the shape of a right one.
const bomb = await page.evaluate(() => {
  renderVehiclePacks();
  const rows = [...document.querySelectorAll('#vpList .list-item')]
    .filter((r) => /Bomber/.test(r.textContent)).map((r) => r.textContent);
  return { n: rows.length,
           max: VEHICLE_PACKS.filter((v) => /Bomber/.test(v.m)).map((v) => v.max).sort((a, b) => a - b) };
});
// THREE models (Daniel, 2026-09-28: "יש בסך הכל 3 דגמים") — the regular, the FC-1 and the Plus.
check('the Bomber is listed as its three models', bomb.n === 3, String(bomb.n));
check('and they are not the same battery bay', bomb.max[0] === 144 && bomb.max[2] === 330, bomb.max.join('/'));

// The provenance warning is the most important thing on this page. The table reads like
// measurements and is not — it came from another model — so the page has to say so where the
// numbers are used, not only in a comment nobody opens.
const prov = await page.evaluate(() => {
  renderVehiclePacks();
  const card = [...document.querySelectorAll('#calctab-dims p')].map(e => e.textContent).join(' ');
  return { card };
});
check('the page says the vehicle data is AI, not measured', /מ-AI, לא נמדדו/.test(prov.card), prov.card.slice(0, 90));

// ---- shallow trays: the 18650 option is costed on the CURRENT cell cost ----
// Until 2026-09-25 these carried the March figures typed in by hand, while the margin they
// borrow was measured against the June cost — so every shallow-tray quote came out too high.
const shallow = await page.evaluate(() => ({
  prices: SHALLOW_CELLS.map((s) => [s.label, s.price]),
  want: [['EVE 26V', CELL_UNIT_COST['EVE 26V']], ['EVE 25P', CELL_UNIT_COST['EVE 25P']]],
  html: shallowCellOptions(300, 150, 69, 48, 13),
}));
check('the 18650 builds read the current cell cost, not a typed one',
  JSON.stringify(shallow.prices) === JSON.stringify(shallow.want) && shallow.want.every(([, v]) => v > 0), shallow);
check('and a shallow tray still gets a priced 18650 option', /EVE 26V[\s\S]*מחיר ₪/.test(shallow.html), shallow.html.slice(0, 160));

// ---- 18650 scooter packs in the hub catalogue (hub only) ----
const cat18 = await page.evaluate(() => {
  addShallowCatalogRows();
  const rows = PRICING.filter((x) => /^סוללות קורקינטים 18650/.test(x.cat));
  return { n: rows.length, ok: rows.every((x) => x.retail > 0 && x.b2b > 0 && x.b2b < x.retail && productCost(x) > 0 && productCost(x) < x.b2b),
    sample: rows.slice(0, 2).map((x) => x.cat + ' ' + x.name + ' ₪' + x.retail) };
});
check('the catalogue carries 18650 scooter packs', cat18.n >= 20, cat18);
check('each priced above its cost, with a trade price between', cat18.ok, cat18);

// ---- his method: the group across the narrow side, the series along the length ----
const hw = await page.evaluate((SELF) => {
  if (SELF) window.trayFill = () => null;
  document.getElementById('dimExtra').value = '0'; dimExtraTouched = true;
  // a 10P group in a 170mm-wide tray: since 2026-10-17 the tray is filled across its whole width and a
  // group runs on into the next column (his photo, "אני בונה בצורה הזאת גם ב H z w")
  useVehiclePack('אופנוע שליחויות 72V'); dimAhPending = 50; calcPackDims();
  const txt = document.getElementById('dimResult').innerText, k = document.querySelector('#dimResult .dim-nk.sel');
  const circles = [...document.querySelectorAll('#dimResult .dim-nk.sel svg.pack-svg:not(.pack-side-bottom) circle')].map((c) => [+c.getAttribute('cx'), +c.getAttribute('cy')]);
  clearDimVehicle();
  return { txt, n: circles.length, across: k ? +k.dataset.across : 0 };
}, SELFTEST);
check('a group wider than the tray: a row the tray\'s width, the group going on into the next', /20S 10P/.test(hw.txt) && hw.across > 0 && hw.across < 10 && hw.n === 100, [hw.n, hw.across, hw.txt.slice(0, 260)]);

// ...and is DRAWN in the order the series runs (2026-10-17): the groups follow each other column after
// column, each group's cells in one piece — no group lies past the next one, and none is split by
// another. --selftest shuffles the groups.
const own = await page.evaluate((SELF) => {
  if (SELF) window.standPlan = ((f) => (o) => {
    const p = f(o);
    p.cells.forEach((c, i) => { c.g = (i * 7) % Math.ceil(o.N / o.P); });
    return p;
  })(window.standPlan);
  useVehiclePack('Talaria', 72);
  document.getElementById('dimHolder').value = 'diag-a'; dimAhPending = 30; calcPackDims();
  const cells = dimLast.plan.cells, n = cells.length, G = Math.max(...cells.map((c) => c.g)) + 1;
  // each column (cells at one x) holds a run of consecutive groups, and the columns climb in group order
  const cols = new Map();
  // a column of ניקל W is a zigzag: its cells sit 0 or half a pitch along, so it is found by its pitch
  const dia = dimLast.plan.dia;
  for (const c of cells) { const k = Math.floor((c.x - dia / 2 + 1) / 22.7); (cols.get(k) || cols.set(k, []).get(k)).push(c.g); }
  const ranges = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, gs]) => [Math.min(...gs), Math.max(...gs)]);
  const ordered = ranges.every((r, i) => i === 0 || r[0] >= ranges[i - 1][1]) && ranges.every((r) => r[1] - r[0] <= 1);
  const txt = document.querySelector('#dimResult .dim-nk.sel').innerText;
  clearDimVehicle();
  return { n, G, ordered, txt };
}, SELFTEST);
check('the drawing follows the series: 20 groups of 6, column after column, no group split by another', own.n === 120 && own.G === 20 && own.ordered, own);

// ---- the build on a label for the worker (2026-09-25) ----
// 100 x 50mm at 300dpi is 1181 x 590 dots: one canvas pixel per printer dot, like the battery
// sticker. The phone path must reach the Bluetooth bridge with real TSPL, and the PC path must
// open a print page sized to the label. --selftest hands back a blank label.
const lbl = await page.evaluate(async (SELF) => {
  if (SELF) window.packLabelCanvas = () => { const c = document.createElement('canvas'); c.width = 1181; c.height = 590; return c; };
  useVehiclePack('Sur-Ron');
  const cv = packLabelCanvas();
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 128) ink++;
  // phone: a stand-in bridge records what would go over Bluetooth
  let sent = null;
  window.GPPrint = { ensure: () => 'OK', print: (mac, b64) => { sent = { mac, head: atob(b64).slice(0, 160) }; return 'OK'; } };
  localStorage.setItem(TSPL.PRINTER_KEYS.mac, 'AA:BB:CC:DD:EE:FF');
  await printPackLabel();
  // no printer chosen yet: says so, sends nothing
  localStorage.removeItem(TSPL.PRINTER_KEYS.mac);
  let sentNoMac = null;
  window.GPPrint.print = () => { sentNoMac = true; return 'OK'; };
  await printPackLabel();
  const notice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  // PC: no bridge — a print page the size of the label
  delete window.GPPrint;
  await printPackLabel();
  const fr = document.getElementById('packLabelFrame');
  return { w: cv.width, h: cv.height, ink: ink / (cv.width * cv.height), sent, sentNoMac, notice,
    pc: fr ? fr.srcdoc.slice(0, 200) : '' };
}, SELFTEST);
check('the label is the printer\'s own size, 1181 x 590 dots', lbl.w === 1181 && lbl.h === 590, [lbl.w, lbl.h]);
check('and carries a drawing, not a blank label', lbl.ink > 0.03 && lbl.ink < 0.45, lbl.ink.toFixed(3));
check('on the phone it goes to the Bluetooth printer as TSPL', !!lbl.sent && lbl.sent.mac === 'AA:BB:CC:DD:EE:FF'
  && /SIZE 100 mm,50 mm/.test(lbl.sent.head) && /BITMAP/.test(lbl.sent.head), lbl.sent);
check('with no printer chosen it says so and sends nothing', !lbl.sentNoMac && /לא נבחרה מדפסת/.test(lbl.notice), lbl.notice.slice(0, 80));
check('on the PC it opens a print page the size of the label', /@page\{size:100mm 50mm/.test(lbl.pc) && /data:image\/png/.test(lbl.pc), lbl.pc.slice(0, 90));

// ---- one voltage control, and lists wide enough to read (2026-09-26) ----
// Daniel: "יש כאן פעמיים את המתח" — the 60V/72V buttons beside the vehicle duplicated the voltage
// field. The field is the control now, and changing it refills the vehicle's build at that
// voltage. And "תרחיב את השורה של הקיבולת" — the 150px list cut its own text mid-word.
const one = await page.evaluate((SELF) => {
  if (SELF) window.onDimVoltage = () => calcPackDims();   // the field that only recomputed
  navigateTo('calcs'); setCalcTab('dims'); setDimTab('build');   // measured on screen, so it must be on screen
  useVehiclePack('Nami Burn-E');                          // 72V: 20S10P = 50Ah
  const chipVolts = [...document.querySelectorAll('#dimVehChip button')].filter((b) => /V$/.test(b.textContent.trim())).length;
  const v = document.getElementById('dimV'); v.value = '60'; v.dispatchEvent(new Event('change'));
  const ah60 = document.getElementById('dimAh').value;    // 60V: 16S12P = 60Ah
  const sel = document.getElementById('dimAh');
  clearDimVehicle();
  return { chipVolts, ah60, w: sel.clientWidth };
}, SELFTEST);
check('the voltage is not offered twice', one.chipVolts === 0, one.chipVolts);
check('changing the voltage refills the vehicle\'s build at that voltage', one.ah60 === '60', one.ah60);
// It says "40Ah" and nothing else now, so an ordinary width reads it whole — the full-row width
// it had for one release was, in his words, just very wide.
check('the capacity list is an ordinary width again', one.w > 60 && one.w <= 200, one.w);

// ---- the tray height is said, not only used (2026-09-26) ----
const th = await page.evaluate((SELF) => {
  const res = () => document.getElementById('dimResult').innerText;
  useVehiclePack('Nami Klima');   // 463x139x75, measured: a one-layer pack of 74 stands in it
  if (SELF) document.querySelectorAll('#dimResult .dim-kv').forEach((r) => { if (/גודל אמבטיה/.test(r.innerText)) r.remove(); });
  const known = res();
  // A tray of his saved with no height (the OX has one since 2026-09-27: 65mm).
  localStorage.setItem('gp_dims', JSON.stringify([{ id: 'dnh', model: 'בלי גובה', l: 400, w: 150, h: 0, measured: true }]));
  useVehiclePack('בלי גובה');
  const unknown = res();
  const chip = document.getElementById('dimVehChip').innerText;
  localStorage.setItem('gp_dims', '[]');
  clearDimVehicle();
  return { known, unknown, chip, none: res() };
}, SELFTEST);
check('the tray has its own size row, height included', /גודל אמבטיה\s*463 × 139 × 75 מ"מ/.test(th.known) && /גודל סוללה/.test(th.known), th.known.slice(0, 200));
check('an unknown height is written ? and said to be unchecked', /גודל אמבטיה\s*400 × 150 × \? מ"מ · גובה לא ידוע/.test(th.unknown) && !/400/.test(th.chip), [th.unknown.slice(0, 160), th.chip]);
check('and with no vehicle there is no tray row', !/גודל אמבטיה/.test(th.none), th.none.slice(0, 120));

// ---- each nickel one way round, on every tray (2026-10-17: "הזיגזג חל על הכל ב W. Z, כל הכלים") ----
// A stand-in 500 x 145 tray. ניקל W is a zigzag across, seven in 145mm, and takes 20S7P; ניקל Z nests,
// straight across, five in 145mm, and does not (it used to be turned round to take seven). The Nami Klima
// (463 x 139 x 75) takes his 16S6P on the square 23. --selftest turns Z round again.
const turn = await page.evaluate((SELF) => {
  if (SELF) FILL_WAY['diag-b'] = 'B';
  VEHICLE_PACKS.push({ g: 'בדיקה', m: 'מגש מבחן', src: 'AI', p: 21.5, s60: 16, p60: 7, s72: 20, p72: 7, max: 140, tub: '500×145×75 מ"מ' });
  useVehiclePack('מגש מבחן', 72); document.getElementById('dimHolder').value = 'diag-b'; dimAhPending = 35; calcPackDims();
  const r = document.getElementById('dimResult').innerText;
  const w = document.querySelector('#dimResult .dim-nk[data-holder="diag-a"]');
  const circles = w.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) circle').length, wTxt = w.innerText, wAcross = +w.dataset.across;
  FILL_WAY['diag-b'] = 'A';
  clearDimVehicle(); VEHICLE_PACKS.pop();
  useVehiclePack('Nami Klima', 60); document.getElementById('dimHolder').value = 'square-23'; dimAhPending = 30; calcPackDims();
  const klima = document.getElementById('dimResult').innerText;
  clearDimVehicle();
  return { r, circles, klima, wTxt, wAcross };
}, SELFTEST);
check('a 145mm tray: on ניקל Z, nesting, 20S7P does not go in, and W is offered', /^⛔ לא נכנס ל-מגש מבחן/.test(turn.r.trim()) && /הכי גדול: 20S 7P · 35Ah · ניקל W/.test(turn.r), turn.r.slice(0, 160));
check('on ניקל W, the zigzag, seven across take 20S7P', /✓ נכנס/.test(turn.wTxt) && turn.wAcross === 7, [turn.wAcross, turn.wTxt.slice(0, 200)]);
check('the Nami Klima takes his 16S6P on the square 23', /^✅ נכנס ל-Nami Klima/.test(turn.klima.trim()) && /16S 6P/.test(turn.klima), turn.klima.slice(0, 160));
check('and the drawing still has one circle per cell', turn.circles === 140, turn.circles);

// ---- the most a tray takes, per voltage and per nickel (2026-09-27) ----
const mx = await page.evaluate((SELF) => {
  if (SELF) {
    window.maxPFor = () => 0;
    // the old page: the cell and nickel card showed above the list too
    const orig = window.setDimTab; window.setDimTab = (tab) => { orig(tab); document.getElementById('dimShared').hidden = false; };
  }
  document.getElementById('dimExtra').value = '0'; dimExtraTouched = true;
  navigateTo('calcs'); setCalcTab('dims');
  setDimTab('veh');
  const sharedOnList = !document.getElementById('dimShared').hidden;
  document.querySelectorAll('#vpList details.fold').forEach((d) => { d.open = true; });   // as he taps a group open
  const card = [...document.querySelectorAll('#vpList .list-item')].find((c) => /Talaria/.test(c.innerText));
  const cardTxt = card ? card.innerText : '';
  useVehiclePack('Talaria', 72);
  const res = document.querySelector('#dimResult .dim-nk.sel').innerText;
  // every nickel's card says what it takes, under its own name
  const cards = [...document.querySelectorAll('#dimResult .dim-nk')].map((k) => k.innerText);
  const sharedAfter = !document.getElementById('dimShared').hidden;
  clearDimVehicle();
  return { res, cards, cardTxt, sharedOnList, sharedAfter };
}, SELFTEST);
// Talaria 385 x 171, no BMS allowance: since 2026-10-17, filled across its width, it has a maximum at both.
check('the result says the most the tray takes with this nickel, per voltage', /מקסימום\s*60V: 16S\d+P · \d+Ah\s*72V: 20S\d+P · \d+Ah/.test(mx.res), mx.res.slice(0, 400));
check('and each nickel\'s card says how much it takes', mx.cards.length === 4 && /^ניקל W — 22\.7/.test(mx.cards[0]) && /^ניקל Z — 22\.5/.test(mx.cards[1]) && /^ניקל H — 22\.5/.test(mx.cards[2]) && /^ניקל H — 23/.test(mx.cards[3])
  && mx.cards.every((k) => /מקסימום\s*60V: (16S\d+P · \d+Ah|—)\s*72V: (20S\d+P · \d+Ah|—)/.test(k)), mx.cards.map((k) => k.slice(0, 120)));
// The list is uncluttered (2026-09-27): the vehicle and its tray; cell and nickel come after the tap.
check('a vehicle card is the vehicle and its tray, nothing more', /Talaria/.test(mx.cardTxt) && /385×171×140/.test(mx.cardTxt) && !/60V|72V|מקסימום|מקורי/.test(mx.cardTxt), mx.cardTxt);
check('the cell and nickel are chosen after the tap, not above the list', !mx.sharedOnList && mx.sharedAfter, [mx.sharedOnList, mx.sharedAfter]);

// ---- the 18650 has its own nickels, both square: 19 and 20.25 (2026-09-27) ----
// They carried the 21700 pitches until then, so every 18650 build came out a size too big.
const n18 = await page.evaluate((SELF) => {
  if (SELF) window.refreshHolderOptions = () => {};    // the list that never followed the cell
  clearDimVehicle();
  const cell = document.getElementById('dimCell'), hold = document.getElementById('dimHolder');
  cell.value = '18650-25p'; calcPackDims();
  const opts18 = [...hold.options].map((o) => o.value);
  document.getElementById('dimExtra').value = '22'; dimExtraTouched = true;
  document.getElementById('dimV').value = '60'; dimAhPending = 10; calcPackDims();   // 16S4P
  const res = document.getElementById('dimResult').innerText;
  cell.value = '21700-50e'; calcPackDims();
  const opts21 = [...hold.options].map((o) => o.value);
  return { opts18, opts21, res };
}, SELFTEST);
check('choosing 18650 offers his three 18650 nickels', JSON.stringify(n18.opts18) === JSON.stringify(['diag-185', 'sq-19', 'sq-2025', 'custom']), n18.opts18);
check('and 21700 gets its own four back', JSON.stringify(n18.opts21) === JSON.stringify(['diag-a', 'diag-b', 'square-225', 'square-23', 'custom']), n18.opts21);
// 16S4P on the 18.5 diagonal: four across = 3 x 18.5 + 9.25 (the half cell) + 18.35 + 3 = 86;
// sixteen rows along at 16.02 = 15 x 16.02 + 21.35 + 22 (BMS at 60V) = 284. It is the first card.
check('an 18650 block is measured on the 18650 nickel', /^[\s\S]*?אלכסוני 18\.5[\s\S]*?גודל סוללה\s*284 × 86 × 69/.test(n18.res) && !/משוער/.test(n18.res), n18.res.slice(0, 260));

// ---- the tray size sits at the top, right under the configuration (2026-10-04) ----
// It sat under the battery size until the blocks moved into one card per nickel; now it is the
// one tray all three cards below are read against.
const order = await page.evaluate(() => {
  useVehiclePack('Nami Klima', 72);
  const keys = [...document.querySelectorAll('#dimResult > .dim-kv span')].map((s) => s.textContent.trim());
  clearDimVehicle();
  return keys;
});
check('the tray size is the row right under the configuration', order.indexOf('תצורה') >= 0 && order.indexOf('גודל אמבטיה') === order.indexOf('תצורה') + 1, order);

// ---- the Bomber Plus carries its BMS on top (2026-09-27; it is 22S15P, 2026-09-28) ----
const top = await page.evaluate((SELF) => {
  document.getElementById('dimExtra').value = '26'; dimExtraTouched = true;
  if (SELF) VEHICLE_PACKS.find((v) => v.m === 'Bomber Plus 15kW').bmsTop = false;
  useVehiclePack('Bomber Plus 15kW', 72);
  const res = document.getElementById('dimResult').innerText;
  const chip = document.getElementById('dimVehChip').innerText;
  const box = !!document.querySelector('#dimResult svg .pack-bms');
  const label = document.getElementById('dimExtraLabel').textContent;
  clearDimVehicle();
  return { res, chip, box, label };
}, SELFTEST);
// 2026-10-04: "זה לא מעניין שתכתוב מה בניתי" — no build history on the bar or on the page.
check('the Plus page carries no build history', !/נבנה במעבדה|22S15P|הסוללות שבנית/.test(top.chip + top.res), [top.chip, top.res.slice(0, 160)]);
// At 72V the frame is filled with the build he named for next time: 20S16P, 320 of its 330 places.
check('and at 72V the build filled in is his next one, 20S16P', /נכנסת — 20S16P[^,]*, 320 תאים/.test(top.res), top.res.slice(0, 120));
// The BMS on top still decides where the allowance goes (the label and the drawing say so), though
// a Bomber's page no longer prints the standing block's size.
check('the BMS allowance goes on the height there, not the length', !top.box && /מעל/.test(top.label), [top.box, top.label]);

// ---- tapping a vehicle photo opens it large (2026-09-27) ----
const zoom = await page.evaluate(async (SELF) => {
  if (SELF && typeof VEH_PHOTOS_LG !== 'undefined') for (const k of Object.keys(VEH_PHOTOS_LG)) delete VEH_PHOTOS_LG[k];
  navigateTo('dims'); setDimTab('veh');
  const img = [...document.querySelectorAll('#vpList img.veh-photo')].find((i) => i.dataset.model === 'Inokim OX');
  if (!img) return { none: true };
  img.click();
  const o = document.getElementById('vehPhotoView');
  const big = o && o.querySelector('img');
  await new Promise((r) => (big && !big.complete ? big.addEventListener('load', r, { once: true }) : r()));
  // What is ON SCREEN, not the hidden attribute: an inline display:flex beats [hidden], and a
  // check of `o.hidden` passed while the photo stayed up (2026-09-28).
  const shown = (el) => !!el && el.checkVisibility();
  const out = { open: shown(o), w: big ? big.naturalWidth : 0, name: o ? o.innerText.trim() : '',
    stayed: !document.getElementById('dimPane-veh').hidden };
  if (SELF) o.hidden = true; else o.click();   // --selftest closes it the old way, which leaves it up
  out.closed = !shown(o);
  return out;
}, SELFTEST);
check('tapping a vehicle photo opens it large', zoom.open && zoom.w >= 400 && zoom.name === 'Inokim OX', zoom);
check('and does not also pick the vehicle', zoom.stayed === true, zoom);
check('and a tap closes it', zoom.closed === true, zoom);

// ---- the rebuild of 2026-09-25: three tabs, one list, the answer first ----
const rb = await page.evaluate((SELF) => {
  if (SELF) {
    // the bugs this replaced: a holder key that does not exist, no way out of a build that
    // does not fit, and a count that never turns the bracket round
    window.holderForPitch = () => 'diag-224';
    window.tubBest = () => null;
    const one = window.fitCount;
    window.fitCount = (L, W, p, rp, d) => { const c = Math.floor((L - d - 3) / p) + 1, r = Math.floor((W - d - 3) / rp) + 1; return c > 0 && r > 0 ? c * r : 0; };
  }
  const out = {};
  const hv = (id) => !!document.getElementById(id).hidden;
  const res = () => document.getElementById('dimResult').innerText;
  out.opts = [...document.getElementById('dimHolder').options].map((o) => o.value);
  setDimTab('veh');
  out.vehFirst = !hv('dimPane-veh') && hv('dimPane-build');
  // Enduro: 22.5mm, no tray size — the holder must be the 22.5 diagonal, not left as it was
  document.getElementById('dimHolder').value = 'square-23';
  useVehiclePack('Enduro');
  out.enduroHolder = document.getElementById('dimHolder').value;
  out.toBuild = hv('dimPane-veh') && !hv('dimPane-build');
  // Talaria: the table's 20S7P does not fit its 381x171 tray. It must say so and offer the
  // biggest that does — which then fits, in a block shorter than the tray.
  // The rotation is a property of the BRACKET, so it is checked with no BMS at the end of the
  // tray; with his 26mm allowance on the length the same tray takes 105 (see the next case).
  document.getElementById('dimExtra').value = '0'; dimExtraTouched = true;
  useVehiclePack('Talaria', 60);
  out.talaria7 = res();
  dimAhPending = 50; calcPackDims();
  out.talaria = res();
  out.hasBest = !!document.querySelector('#dimResult .dim-best');
  if (out.hasBest) applyDimBest();
  out.after = res();
  out.afterL = +((((document.querySelector('#dimResult .dim-nk.sel .dim-size') || {}).textContent || '').match(/(\d+) × (\d+) × (\d+)/) || [])[1] || 0);
  // one list: his tray on its vehicle's card, and a tray for an unknown vehicle listed first
  localStorage.setItem('gp_dims', JSON.stringify([
    { id: 'dz', model: 'Zero 10X', l: 455, w: 134, h: 58, measured: true },
    { id: 'dk', model: 'Kugoo G2', l: 400, w: 150, h: 80, measured: true }]));
  setDimTab('veh');
  document.querySelectorAll('#vpList details.fold').forEach((d) => { d.open = true; });
  const cards = [...document.querySelectorAll('#vpList .list-item')];
  out.zeroMine = cards.some((c) => /Zero 10X/.test(c.innerText) && /נמדד/.test(c.innerText) && /455/.test(c.innerText));
  out.kugooFirst = /Kugoo G2/.test((cards[0] || {}).innerText || '');
  out.oneList = !document.getElementById('dimsList');
  useVehiclePack('Kugoo G2');
  out.kugoo = res();
  out.kugooMine = !!(dimVehicle && dimVehicle.mine);
  clearDimVehicle();
  localStorage.setItem('gp_dims', '[]');
  return out;
}, SELFTEST);
check('only his four holders and a custom one are offered', JSON.stringify(rb.opts) === JSON.stringify(['diag-a', 'diag-b', 'square-225', 'square-23', 'custom']), rb.opts);
check('the calculator opens on the vehicle list', rb.vehFirst, rb.vehFirst);
check('a 22.5mm vehicle gets the 22.5 diagonal', rb.enduroHolder === 'diag-a', rb.enduroHolder);
check('picking a vehicle shows its result', rb.toBuild, rb.toBuild);
// 16S8P = 128 in a 385x171 tray: eight across straight need 182mm, eight nested across 161 — so
// it goes in only with the bracket turned, the way his own 390x135 pack is built.
check('the bracket may be turned: Talaria takes 16S8P', /^✅ נכנס ל-Talaria/.test(rb.talaria7.trim()), rb.talaria7.slice(0, 120));
check('a build that does not fit its tray says so first', /^⛔ לא נכנס ל-Talaria/.test(rb.talaria.trim()), rb.talaria.slice(0, 80));
check('and offers the biggest that does', rb.hasBest, rb.hasBest);
check('which then fits, in a block shorter than the tray', /^✅ נכנס ל-Talaria/.test(rb.after.trim()) && rb.afterL > 0 && rb.afterL <= 385, [rb.after.slice(0, 40), rb.afterL]);
check('his tray sits on its vehicle\'s card, marked measured', rb.zeroMine, rb.zeroMine);
check('a tray for a vehicle not in the table is listed first', rb.kugooFirst, rb.kugooFirst);
check('there is one list, not two', rb.oneList, rb.oneList);
check('picking his own tray judges the build against it', rb.kugooMine && /✅ נכנס ל-Kugoo G2/.test(rb.kugoo), rb.kugoo.slice(0, 60));

// ---- cells lying, for the Bombers: one card per nickel (2026-10-04) ----
// The frame's side is his biggest build's outline, filled on each nickel ("צורת השלדה, ממולאת לפי
// כל ניקל"). On the build's own nickel the fill must give his build back cell for cell: the Plus is
// 165 a side on the 23 square, two stacks = 330 = 20S16P at 72V; the regular Bomber is his blue
// 20S17P, 170 a side on the 19 square in 18650. If the outline or the fill drifts, those stop
// coming back. --selftest narrows the Plus to one stack and drops a row from the regular's build.
const lying = await page.evaluate((SELF) => {
  const res = (m, V, h) => {
    useVehiclePack(m, V);
    if (h) { document.getElementById('dimHolder').value = h; calcPackDims(); }
    return document.getElementById('dimResult').textContent;
  };
  const svgOf = (h) => document.querySelector(`#dimResult .dim-nk[data-holder="${h}"] svg.pack-svg`);
  // the drawing as data: cells per row, bottom up, read off the SVG itself
  const shape = (svg) => {
    if (!svg) return { cells: 0, rows: '' };
    const ys = [...svg.querySelectorAll('circle')].map((e) => Math.round(+e.getAttribute('cy')));
    const rows = [...new Set(ys)].sort((a, b) => b - a);
    return { cells: ys.length, rows: rows.map((y) => ys.filter((yy) => yy === y).length).join(',') };
  };
  const C = DIM_CELLS['21700-50e'];
  const fr = bomberFrame(vehicleByName('Bomber Plus 15kW'));
  const across = SELF ? 100 : fr.across;
  const stacks = Math.floor((across - 2 * DIM_WALL) / (C.len + DIM_CAP));
  const sq = bomberFill(fr, C, 23, 23).cells.length;
  // --selftest: read the maker's table instead of his measurement, which the check must catch.
  const regName = 'Bomber רגיל 3-12kW';
  const regTub = SELF ? tubOf({ tub: '355×120×185' }) : tubOf(vehicleByName(regName));
  // A frame too narrow for a lying 21700 (no row is, since the FC-1 was measured at 90): a stand-in.
  const narrow = bomberHtml({ m: 'Bomber test', tub: '280×75×150 מ"מ' }, C, 21700, 'diag-b', 72, 100, () => [22.5, 19.49]).html;
  const plus = res('Bomber Plus 15kW', 72, 'square-23');
  const plusShape = shape(svgOf('square-23'));
  const plusCards = [...document.querySelectorAll('#dimResult .dim-nk')]
    .map((k) => k.dataset.holder + ':' + k.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) circle').length + ':' + k.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) polygon.pack-outline').length).join(' ');
  const plusChip = document.getElementById('dimVehChip').textContent;
  const plusHtml = document.getElementById('dimResult').innerHTML;
  // the regular Bomber in 18650, on the 19 square his builds are on
  document.getElementById('dimCell').value = '18650-25p';
  if (SELF) VEHICLE_PACKS.find((v) => v.m === regName).builds[0].stacks[0].rows.pop();
  const reg18 = res(regName, 72, 'sq-19');
  const regShape = shape(svgOf('sq-19'));
  document.getElementById('dimCell').value = '21700-50e';
  return { sq, stacks, plus, plusShape, plusCards, plusChip, plusHtml, narrow, reg18, regShape,
           fc1: res('Bomber FC-1', 72, 'diag-b'), surron: res('Sur-Ron', 72), regular: res(regName, 72), regTub,
           plusTub: tubOf(vehicleByName('Bomber Plus 15kW')) };
}, SELFTEST);
check('his Bomber Plus comes back as 2 stacks of 165 = 330 cells', lying.stacks === 2 && lying.sq === 165, [lying.stacks, lying.sq]);
check('which at 72V is 20S16P, 80Ah (his next build)', /20S16P · 80Ah/.test(lying.plus), lying.plus.slice(0, 260));
// The 23-square card fills the outline of his own Plus: his rows, bottom to top, cell for cell.
check('on its own nickel the Plus card is his 165 a side, row for row', lying.plusShape.rows === '16,16,17,17,17,17,17,16,13,11,8' && lying.plusShape.cells === 165, lying.plusShape);
check('the Plus has a card per nickel, each drawn inside the frame\'s outline', /^diag-a:\d+:1 diag-b:\d+:1 square-225:\d+:1 square-23:165:1$/.test(lying.plusCards), lying.plusCards);
check('the regular Bomber in 18650 on the 19 square is his blue 20S17P: 170 a side, 340', lying.regShape.cells === 170 && /170 תאים × 2 ערימות = 340/.test(lying.reg18) && /20S17P/.test(lying.reg18), [lying.regShape, lying.reg18.slice(0, 160)]);
check('a Bomber frame too narrow for a lying cell says so', /צר מדי לתא שוכב/.test(lying.narrow), lying.narrow.slice(-160));
check('the FC-1 (90 across, his tape) fits a 72V build lying on ניקל ב׳', /נכנס עד: 72V 20S8P · 40Ah|נכנסת — 20S8P · 40Ah, 160 תאים · המקסימום/.test(lying.fc1) && !/צר מדי/.test(lying.fc1), lying.fc1.slice(0, 200));
// 2026-10-04: "זה לא מעניין שתכתוב מה בניתי" — his builds are the frame's shape, not a list.
check('no Bomber page lists his builds', !/הסוללות שבנית|הסוללה הכחולה|הסוללה הזהובה|הסוללה הירוקה|bomber-build/.test(lying.plusHtml + lying.regular + lying.fc1), lying.regular.slice(0, 120));
check('the lying answer is for Bombers only', /נכנס עד:|· המקסימום/.test(lying.plus) && !/נכנס עד:|· המקסימום/.test(lying.surron), lying.surron.slice(-80));
// 2026-10-04 ("יש כאן תוכן כפול"): the chip names the vehicle and the result does not again; the
// chosen pack that IS the most it takes is one line, not two; and the Plus, his own confirmed side,
// is not called an AI estimate.
check('the Bomber result does not repeat the vehicle name', !/🏍️ Bomber Plus/.test(lying.plus), lying.plus.slice(0, 80));
check('the chip does not repeat a build', !/נבנה במעבדה/.test(lying.plusChip), lying.plusChip);
check('the Plus chip says measured, not AI', /✓ נמדד/.test(lying.plusChip) && !/הערכת AI/.test(lying.plusChip), lying.plusChip);
check('the most it takes and the chosen pack are one line when they are the same pack', /✅ נכנסת — 20S16P · 80Ah, 320 תאים · המקסימום/.test(lying.plus) && !/נכנס עד:/.test(lying.plus), lying.plus.slice(0, 160));
// What he asked for (2026-09-28: "מה זה הסיבוך הזה ... תמחק תוכן מיותר"): a Bomber's page is the
// answer and the drawings — no standing verdict, no tray table, no holder list, no notes.
check('a Bomber page has none of the standing clutter', !/לא נכנס ל-|גודל אמבטיה|מקסימום באמבטיה|מחזיק|הערכה:|⚠ מידות הצד/.test(lying.regular), lying.regular.slice(0, 200));
// 360×125×190 was the 2021 tape; the builds that went in prove 364 × 192 (19 columns and 10 rows
// of 19, with the bracket). The maker's 355×120×185 is under both.
check('the regular Bomber reads what his builds prove (364×125×192), not the maker\'s table',
  lying.regTub && lying.regTub.L === 364 && lying.regTub.W === 125 && lying.regTub.H === 192, lying.regTub);
// The frame is NOT a tub: judged standing, 370×200×150 said his own build does not fit the frame
// it is in. So no tub, and no verdict against his build.
check('the Plus is not judged against its frame standing (no "does not fit" on his own build)',
  !lying.plusTub && !/לא נכנס ל-Bomber Plus/.test(lying.plus), [lying.plusTub, lying.plus.slice(0, 80)]);

// ---- the 18650 laid along the tray (C), and its rated capacity (2026-10-07) ----
// Daniel, on the Inokim OX in EVE 26V at 60V 30Ah: "יש כאן טעות הוא לא מחשב נכון גם הקיבולת לא נכונה עבור
// 18650". With the group only across the tray, 8 go across its 165mm and from 9P a group took two rows,
// so the most was 16S9P / 22.9Ah — while Inokim's own OX Super pack is 16S10P of 18650 in that tray,
// 60V 26Ah. With the group along the tray, ten in a line, eight lines across, two bands, it is 16S10P,
// 26Ah at the cell's rated 2.6Ah. 16S12P still does not go in. The 21700 is left on his method.
// --selftest takes the layout away.
const ox18 = await page.evaluate((SELF) => {
  if (SELF) window.fitAlong = () => null;
  navigateTo('dims');
  document.getElementById('dimExtra').value = '22'; dimExtraTouched = true;   // the allowance he opens it on at 60V
  document.getElementById('dimCell').value = '18650-26v';
  useVehiclePack('Inokim OX', 60);
  document.getElementById('dimHolder').value = 'sq-19'; calcPackDims();
  const v = vehicleByName('Inokim OX'), c = DIM_CELLS['18650-26v'];
  const tub = cellTub(tubOf(v), 22);
  const max19 = maxPFor(v, tub, 18650, 'sq-19', 60, c), max185 = maxPFor(v, tub, 18650, 'diag-185', 60, c);
  const fits12 = holderTakes(v, tub, 18650, 'sq-19', 16, 12, c, 1) > 0;
  const lay10 = hisFit(tub, 16, 10, 1, 19, 19, c.dia);
  // his own numbers: 60V 30Ah (16S12P) does not go in, and the best offered is 16S10P
  dimAhPending = 30; calcPackDims();
  const best = dimBest ? dimBest.S + 'S' + dimBest.P + 'P' : '';
  // 25Ah is 10P of 2.6Ah: it goes in, laid along
  dimAhPending = 25; calcPackDims();
  const res = document.getElementById('dimResult').innerText;
  const nums = [...document.querySelectorAll('#dimResult .dim-nk.sel svg .pack-group')].map((e) => e.textContent);
  const label = dimLast && dimLast.line;
  // and the 21700 in the same tray is unchanged: no group laid along
  document.getElementById('dimCell').value = '21700-50e'; calcPackDims();
  const r21 = document.getElementById('dimResult').innerText;
  clearDimVehicle();
  return { best, ah: c.ah, max19, max185, fits12, orient: lay10.orient, bands: lay10.bands, res, nums: nums.length, label, r21along: /קבוצה לאורך/.test(r21) };
}, SELFTEST);
check('the EVE 26V is counted at its rated 2.6Ah', ox18.ah === 2.6, ox18.ah);
// 16S11P since 2026-10-08: the BMS sits in the OX's narrow part now (cellTub takes it off there
// first), so the main part's whole 425mm is the cells' — eleven in a line, two bands, 420mm. It
// was 16S10P on the 403 the BMS used to leave, which is also Inokim's own OX Super pack.
check('the OX takes 16S11P of 18650 on the square 19 and the 18.5 diagonal, the BMS in the narrow part', ox18.max19 === 11 && ox18.max185 === 11, [ox18.max19, ox18.max185]);
check('laid along the tray: ten in a line, two bands', ox18.orient === 'C' && ox18.bands === 2, [ox18.orient, ox18.bands]);
check('16S12P still does not go in, and the best offered for it is 16S11P', !ox18.fits12 && ox18.best === '16S11P', [ox18.fits12, ox18.best]);
check('the card says 16S10P fits and the most is 16S11P; each group numbered once; the label says how it is laid',
  /✅ נכנס ל-Inokim OX/.test(ox18.res) && /16S 10P · 160 תאים/.test(ox18.res) && /60V: 16S11P · 28.6Ah/.test(ox18.res)
  && ox18.nums === 16 && /קבוצה לאורך 10P/.test(ox18.label || ''), [ox18.res.slice(0, 300), ox18.nums, ox18.label]);
check('the 21700 in the same tray is still laid his way', !ox18.r21along, ox18.r21along);

// ---- the worker's plate for a lying build (2026-10-06) ----
// Daniel, holding the first plate: a number on every row, how many go in it, which cells are in
// parallel and in series — and, asked, "כל שורה = קבוצה". The Plus at 72V on the 23 square, in his
// PRO cell: 20S16P, 10 groups a stack. Rows 1-8 are groups 1-8, each of 16, the five rows of 17 one
// place short at the end (✕), and 13 + 11 + 8 at the top are groups 9 and 10. His 22S15P (330 of 330,
// no place to spare) runs its groups across rows instead, every cell used. The head names the
// voltage, the Ah, the cell and the nickel. --selftest hands back a map with no empty places.
const plate = await page.evaluate((SELF) => {
  if (SELF) { const real = bomberGroups; window.bomberGroups = (cells, P, G) => real(cells, P, G + 100) || real(cells, 1, cells.length); }
  document.getElementById('dimCell').value = '21700-50pl';
  useVehiclePack('Bomber Plus 15kW', 72);
  document.getElementById('dimHolder').value = 'square-23'; calcPackDims();
  const d = dimLast || {};
  const cells = (d.plan && d.plan.cells) || [];
  const rows = [...new Set(cells.map((c) => Math.round(c.y)))].sort((a, b) => b - a)
    .map((y) => cells.filter((c) => Math.round(c.y) === y).sort((a, b) => a.x - b.x));
  const desc = rows.map((r) => r.map((c) => (c.empty ? 'x' : c.g + 1)).join(' '));
  const sizes = {};
  cells.forEach((c) => { if (!c.empty) sizes[c.g] = (sizes[c.g] || 0) + 1; });
  const cv = packLabelCanvas();
  // his 22S15P: 11 groups of 15 in 165, nothing to spare
  const fr = bomberFrame(vehicleByName('Bomber Plus 15kW'));
  const old = bomberGroups(bomberFill(fr, DIM_CELLS['21700-50e'], 23, 23).cells, 15, 11) || [];
  const oldCells = old.flatMap((r) => r.cells);
  clearDimVehicle();
  return { head: d.head || '', line: d.line || '', foot: d.foot || '', desc, counts: (d.plan && d.plan.rowsLab || []).map((r) => r.n).join(','),
    sizes: Object.values(sizes), empties: cells.filter((c) => c.empty).length, canvas: !!cv,
    old: { empties: oldCells.filter((c) => c.empty).length, groups: new Set(oldCells.map((c) => c.g)).size, n: oldCells.length } };
}, SELFTEST);
check('the plate counts every row, bottom up: 16,16,17,17,17,17,17,16,13,11,8', plate.counts === '16,16,17,17,17,17,17,16,13,11,8', plate.counts);
check('each of the first eight rows is one group of 16, the rows of 17 one place short at the end',
  plate.desc.slice(0, 8).every((r, i) => { const c = r.split(' '); return c.slice(0, 16).every((g) => g === String(i + 1)) && (c.length === 16 || (c.length === 17 && c[16] === 'x')); })
  && plate.empties === 5, plate.desc.slice(0, 8));
check('the three short rows at the top are groups 9 and 10, and every group is 16', /^9( 9){12}$/.test(plate.desc[8] || '') && /^9 9 9( 10){8}$/.test(plate.desc[9] || '') && /^10( 10){7}$/.test(plate.desc[10] || '')
  && plate.sizes.length === 10 && plate.sizes.every((n) => n === 16), [plate.desc.slice(8), plate.sizes]);
check('the plate says what to build: 20S16P, 72V 80Ah, the cell, the nickel, both stacks', /20S16P/.test(plate.head) && /72V 80Ah/.test(plate.head)
  && /320 תאי 21700 EVE 50PL/.test(plate.line) && /· ניקל H \(23\)/.test(plate.line) && !/ניקל ניקל/.test(plate.line) && /ערימה 1: 1–10/.test(plate.foot) && /ערימה 2: 11–20/.test(plate.foot) && /16 במקביל/.test(plate.foot) && plate.canvas,
  [plate.head, plate.line, plate.foot]);
check('his 22S15P has no place to spare: 11 groups across the rows, all 165 used', plate.old.n === 165 && plate.old.empties === 0 && plate.old.groups === 11, plate.old);

// ---- every vehicle, one sweep (2026-10-04) ----
// A card per nickel with its drawing (one, the 23 square, for the Silver Fish), the worker's label
// drawing exactly the chosen card, and no "what I built" anywhere. --selftest puts the old build
// list back on one page.
const sweep = await page.evaluate((SELF) => {
  const bad = [];
  // each vehicle as it opens: a case allowance typed by an earlier check (the OX's 26mm) is not its own
  dimExtraTouched = false; dimExtraAuto = null;
  document.getElementById('dimCell').value = '21700-50e';
  for (const v of VEHICLE_PACKS) {
    useVehiclePack(v.m);
    const r = document.getElementById('dimResult');
    if (SELF && v.m === 'Bomber Plus 15kW') r.insertAdjacentHTML('beforeend', '<div>הסוללות שבנית</div>');
    const cards = [...r.querySelectorAll('.dim-nk')];
    const want = v.case ? 1 : 4;
    if (cards.length !== want || !cards.every((k) => k.querySelector('svg.pack-svg circle')) || /הסוללות שבנית/.test(r.textContent)) bad.push(v.m + ':' + cards.length + (cards.length === want ? ' ' + document.getElementById('dimV').value + 'V ' + (dimLast ? dimLast.S + 'S' + dimLast.P + 'P' : '') + ' extra ' + document.getElementById('dimExtra').value + ' ' + cards.filter((k) => !k.querySelector('svg.pack-svg circle')).map((k) => k.dataset.holder).join('/') : ''));
    const sel = r.querySelector('.dim-nk.sel');
    if (!sel || !dimLast || dimLast.plan.cells.length !== sel.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) circle').length) bad.push(v.m + ' label');
  }
  clearDimVehicle();
  return bad;
}, SELFTEST);
check('every vehicle: its nickel cards and drawings, the label = the chosen card, no build list', sweep.length === 0, sweep.join(', '));

// ---- the Silver Fish (Daniel, 2026-10-04) ----
// His e-bike case, 850 × 95 × 70, and his 72V layout: "24 שורות כל שורה 4 תאים ואז עוד 8 שורות 3
// בשורה כדי שיהיה מקום ל-BMS" = 120 = 20S6P, 30Ah. Square only ("אין אלכסון בסילבר פיש"), its height
// not judged ("המארז מתגמש"), and no build history on the page. --selftest takes the case away,
// which sends the row down the scooter path: three cards, no case line, "הערכת AI" on the chip.
// 132 cells of 21700 is the case's limit (Daniel, 2026-10-05): a 48V 13S10P (130) goes in, laid out in
// his rows within the 850, and 13S11P (143) does not. --selftest puts the old 120 back.
const fishMax = await page.evaluate((SELF) => {
  const v = { ...VEHICLE_PACKS.find((x) => x.m === 'סילבר פיש 72V') };
  if (SELF) v.max = 120;
  const c = DIM_CELLS['21700-50e'];
  const t = (S, P) => { const d = document.createElement('div'); d.innerHTML = caseHtml(v, c, 21700, 48, S, P, S * P).html; return d.textContent; };
  return { max: v.max, ten: t(13, 10), eleven: t(13, 11) };
}, SELFTEST);
check('the case takes 132: 48V 50Ah (13S10P, 130 cells) goes in, 13S11P does not',
  fishMax.max === 132 && /✅ נכנסת — 13S10P · 50Ah, 130 תאים/.test(fishMax.ten) && /מקסימום במארז\s*48V: 13S10P · 50Ah/.test(fishMax.ten)
  && /⛔ גדולה מדי — 13S11P · 55Ah, 143 תאים · במארז נכנסים 132/.test(fishMax.eleven), [fishMax.ten.slice(0, 120), fishMax.eleven.slice(0, 120)]);
// ---- the ATV plastic tub (Daniel, 2026-10-05) ----
// "מידות אמבטיה טרקטורון מארז פלסטיק גובה 13 אורך 34.5 רוחב 23 — תעדכן שהגובה 17cm" = 345 × 230 × 170,
// measured. 170 takes two standing 21700, and an ATV may be folded into two layers, so it opens on
// 72V 20S11P (220 cells, 55Ah) in two layers, and takes 60V 16S18P (90Ah) at most. hubOnly, since "a
// plastic ATV tub" was no model a customer could check; it is the Tiger 2 (his answer, same day), and
// stays hub-only — his decision ("ב", the same day). The name carries טרקטורון so a search for the word finds it.
// The stacking rule matched 'טרקטורון' (final nun) and so never the group 'טרקטורונים' (plain nun):
// the row passed only because its model name happens to say טרקטורון. Any other ATV in the group
// was held to one layer. --selftest puts that pattern back, and swaps length and height (the 170
// read as the length), the mistake a "גובה … אורך …" order invites.
const atv = await page.evaluate((SELF) => {
  const v = VEHICLE_PACKS.find((x) => x.m === 'טייגר 2 — טרקטורון');
  if (!v) return { missing: true };
  if (SELF) {
    v.m = 'טייגר 2';
    v.tub = v.tub.replace('345×230×170', '170×230×345');
    window.stackAllowed = (x) => !x || /אופנוע|ריקשה|E-Moto|טרקטורון/i.test((x.g || '') + ' ' + (x.m || ''));
  }
  const tb = tubOf(v);
  const name = v.m;
  const groupStacks = stackAllowed({ g: 'טרקטורונים', m: 'Can-Am Outlander' });
  // its name carries both the word he uses and the model (the search that found it by them is gone)
  renderVehiclePacks();
  const listed = [...document.querySelectorAll('#vpList .list-item-title')].some((t) => t.textContent.trim() === name);
  const byWord = listed && /טרקטורון/.test(name), byModel = listed && /טייגר/.test(name);
  document.getElementById('dimCell').value = '21700-50e';
  useVehiclePack(name);
  const r72 = document.getElementById('dimResult').innerText;
  const V = document.getElementById('dimV').value;
  clearDimVehicle();
  return { tb, type: vehType(v), hubOnly: v.hubOnly === true, measured: tubMeasured(v), groupStacks, byWord, byModel, V, r72 };
}, SELFTEST);
check('the ATV tub is in the table, 345 × 230 × 170 measured, hub-only, drawn as a quad',
  !atv.missing && atv.tb && atv.tb.L === 345 && atv.tb.W === 230 && atv.tb.H === 170 && atv.type === 'atv' && atv.hubOnly && atv.measured,
  JSON.stringify(atv.missing ? atv : { tb: atv.tb, type: atv.type, hubOnly: atv.hubOnly, measured: atv.measured }));
check('the Tiger 2 is listed, named with טייגר and with טרקטורון',
  !atv.missing && atv.byWord && atv.byModel, atv.missing ? 'missing' : [atv.byWord, atv.byModel]);
check('any vehicle in the ATV group may be folded into two layers, not only one named טרקטורון',
  !atv.missing && atv.groupStacks === true, String(atv.groupStacks));
check('it opens on 72V 20S14P (280 cells) in two layers, and 60V takes 16S18P at most',
  !atv.missing && atv.V === '72' && /✅ נכנס/.test(atv.r72) && /20S 14P · 280 תאים/.test(atv.r72) && /2 שכבות/.test(atv.r72)
  && /60V: 16S18P · 90Ah/.test(atv.r72) && /72V: 20S14P · 70Ah/.test(atv.r72),
  atv.missing ? 'missing' : [atv.V, atv.r72.slice(0, 200)]);
const fish = await page.evaluate((SELF) => {
  const name = 'סילבר פיש 72V';
  const v = VEHICLE_PACKS.find((x) => x.m === name);
  if (SELF && v) delete v.case;
  document.getElementById('dimCell').value = '21700-50e';
  useVehiclePack(name);
  const out = document.getElementById('dimResult');
  const cards = [...out.querySelectorAll('.dim-nk')];
  const svg = cards[0] && cards[0].querySelector('svg.pack-svg');
  const cs = svg ? [...svg.querySelectorAll('circle')].map((e) => Math.round(+e.getAttribute('cx'))) : [];
  const xs = [...new Set(cs)].sort((a, b) => a - b);
  const label = dimLast ? dimLast.plan.cells.length : 0;
  renderVehiclePacks();
  const card = [...document.querySelectorAll('#vpList .list-item')].find((r) => ((r.querySelector('.list-item-title') || {}).textContent || '').trim() === name);
  return { text: out.textContent, cards: cards.map((k) => k.dataset.holder).join(' '), cells: cs.length,
           cols: xs.map((x) => cs.filter((xx) => xx === x).length).join(','),
           bms: !!(svg && svg.querySelector('.pack-bms') && /BMS/.test(svg.textContent)),
           groups: svg ? [...svg.querySelectorAll('text.pack-group')].map((t) => t.textContent) : [],
           size: ((cards[0] && cards[0].querySelector('.dim-size')) || {}).textContent || '', label,
           chip: document.getElementById('dimVehChip').textContent,
           card: card ? card.textContent.replace(/\s+/g, ' ') : null, kind: v ? vehType(v) : '' };
}, SELFTEST);
check('the Silver Fish opens on its 72V pack: 20S6P, 30Ah, 120 cells — the most 72V takes in it',
  /✅ נכנסת — 20S6P · 30Ah, 120 תאים/.test(fish.text) && /מקסימום במארז\s*72V: 20S6P · 30Ah/.test(fish.text), fish.text.slice(0, 260));
check('with the case he measured, its height not judged, and no ⛔',
  /גודל מארז\s*850 × 95 × 70 מ"מ · הגובה לא נבדק/.test(fish.text) && !/לא נכנס|⛔/.test(fish.text), fish.text.slice(0, 220));
check('one card only, the 23 square: no diagonal in a Silver Fish', fish.cards === 'square-23', fish.cards);
// Drawn the long way: each column is one of his rows across the 95.
check('24 rows of 4, then 8 rows of 3, cell by cell: a 737 x 93 block',
  fish.cells === 120 && fish.cols === Array(24).fill(4).concat(Array(8).fill(3)).join(',') && /737 × 93/.test(fish.size),
  [fish.cells, fish.cols, fish.size]);
check('the BMS sits in the free strip beside the short rows', fish.bms, String(fish.bms));
check('its twenty groups are numbered', fish.groups[0] === '1' && fish.groups[fish.groups.length - 1] === '20', fish.groups.join(' '));
check('no build history on the page', !/שבנית|24 שורות של 4|נבנה במעבדה/.test(fish.text + fish.chip), fish.text.slice(0, 200));
check('the worker\'s label draws the same 120 cells', fish.label === 120, fish.label);
check('the chip and the card say measured, with the case size', /✓ נמדד/.test(fish.chip) && !/הערכת AI/.test(fish.chip)
  && /✓ נמדד/.test(fish.card || '') && /850×95×70/.test(fish.card || ''), [fish.chip, fish.card]);
check('an e-bike is drawn as a bicycle', fish.kind === 'ebike', fish.kind);

check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

// Sur-Ron Ultra Bee, measured inside by Daniel (2026-10-15): 312 × 220 × 170. On ניקל Z, folded in two,
// 72V takes 20S11P — 55Ah, the bike's own 74V 55Ah. --selftest reads the tray 20mm shorter.
const ub = await page.evaluate((SELF) => {
  const v = vehicleByName('Sur-Ron Ultra Bee'), tb = tubOf(v);
  const t = SELF ? { ...tb, L: tb.L - 20 } : tb;
  return { tb, allow: bmsAllowance(72, v), z72: maxPFor(v, cellTub(t, dimExtraFor(72, v)), 21700, 'diag-b', 72, DIM_CELLS['21700-50e']) };
}, SELFTEST);
// The OX takes a riser of up to 12mm (2026-10-15): a cell standing 9mm over its 65 goes in on one; with
// room for 5mm only it would not. --selftest drops the limit.
const rz = await page.evaluate((SELF) => {
  const v = vehicleByName('Inokim OX'), tb = cellTub(tubOf(v), 14), c = DIM_CELLS['21700-50e'];
  const tight = SELF ? { ...v, riserMax: 0 } : { ...v, riserMax: 5 };
  return { ok: maxPFor(v, tb, 21700, 'diag-b', 72, c), tight: maxPFor(tight, tb, 21700, 'diag-b', 72, c), rm: v.riserMax };
}, SELFTEST);
check('a riser only as high as the vehicle has room for: the OX\'s 12mm takes the 21700, 5mm would not', rz.rm === 12 && rz.ok === 6 && rz.tight === 0, rz);
// Every scooter in one group (2026-10-15: "תאחד את כל הקורקינטים"), the riser kept per row.
const sc = await page.evaluate(() => ({ groups: [...new Set(VEHICLE_PACKS.filter((v) => /קורקינט/.test(v.g)).map((v) => v.g))],
  ox: needsRiser(vehicleByName('Inokim OX')), plain: VEHICLE_PACKS.filter((v) => v.g === 'קורקינטים' && !v.riser).every((v) => !needsRiser(v)) }));
check('the scooters are one group, and the riser is still each row\'s own', sc.groups.join('|') === 'קורקינטים' && sc.ox && sc.plain, sc);
// Its BMS sits over the cells, in the height (Daniel, 2026-10-17, of his 72V 75Ah in it), so no length goes
// to it: 20S13P on Z with the holder (20S12P while 26mm of the length was kept for it). His own 75Ah is
// built without a holder; the calculator counts the holder only, his choice the same night.
check('Sur-Ron Ultra Bee: his 312 × 220 × 170, the BMS on top, and 72V 20S13P on ניקל Z', ub.tb && ub.tb.L === 312 && ub.tb.W === 220 && ub.tb.H === 170 && ub.z72 === 13 && ub.allow === 0, ub);

// ---- the OX, filled wide then narrow, each nickel its own way (2026-10-17) ----
// Daniel: "ה-W זה בזיגזג, זה יותר צר ברוחב ויותר ארוך באורך. ב-Z ... משתלב אחד בתוך השני, אבל זה יותר
// רחב", and "בצורה רחבה, ומתקטן לתוך החלק הצר עד הסוף" — with his photo of an 8-across pack, "אני בונה
// בצורה הזאת גם ב H z w". W is laid B (zigzag across: 8 in the wide part, 6 in the narrow one), Z is A
// (nesting: 6 and 5), the square 7 and 5. Every cell of every maximum lies inside the tray; the holder's
// cells are capped by his counts, and past them up to three rows at the end go in without it ("כמה שורות
// בסוף לבנות בלי תבנית"); a build that still does not go in has no drawing. --selftest lays W the way of Z.
const oxw = await page.evaluate((SELF) => {
  if (SELF) FILL_WAY['diag-a'] = 'A';
  // his own 14mm BMS, not an allowance an earlier check typed into the field
  document.getElementById('dimExtra').value = '14'; dimExtraTouched = true;
  document.getElementById('dimCell').value = '21700-50e';
  const v = vehicleByName('Inokim OX'), c = DIM_CELLS['21700-50e'], tb = tubOf(v), out = { orient: [], max: [], outside: [], across: [] };
  for (const V of [36, 48, 52, 60, 72]) {
    const tub = cellTub(tb, dimExtraFor(V, v)), S = seriesForV(V);
    for (const h of ['diag-a', 'diag-b', 'square-23']) {
      const mp = maxPFor(v, tub, 21700, h, V, c), [p, rp] = DIM_PITCH[21700][h];
      const lay = hisFit(tub, S, mp, 1, p, rp, c.dia);
      out.orient.push(V + h + ':' + lay.orient); out.max.push(V + h + ':' + mp);
      if (V === 60) out.across.push(h + ':' + (lay.tail ? lay.tail.across + '/' + lay.tail.acrossNarrow : '-'));
      if (!mp || !lay.tail) { out.outside.push(V + h + ':none'); continue; }
      // every cell inside the wide part or the narrow one, in the drawing's own coordinates
      const pl = standPlan({ cols: lay.inRow, rows: lay.rowsAlong, pitch: p, rowPitch: rp, dia: c.dia, N: S * mp, P: mp, layers: 1, extra: 14, orient: lay.orient, tail: lay.tail, tray: tb });
      const W0 = DIM_WALL, r = c.dia / 2, y0 = (tb.W - tb.nx.W) / 2;
      const inWide = (q) => q.x - r >= -W0 - 0.5 && q.x + r <= tb.L - W0 + 0.5 && q.y - r >= -W0 - 0.5 && q.y + r <= tb.W - W0 + 0.5;
      const inNarrow = (q) => q.x + r <= tb.L + tb.nx.L - 14 - W0 + 0.6 && q.y - r >= y0 - W0 - 0.5 && q.y + r <= y0 + tb.nx.W - W0 + 0.5;
      const bad = pl.cells.filter((q) => !inWide(q) && !inNarrow(q)).length;
      if (bad || pl.cells.length !== S * mp) out.outside.push(V + h + ':' + bad + '/' + pl.cells.length);
    }
  }
  useVehiclePack('Inokim OX', 60); document.getElementById('dimHolder').value = 'square-23'; dimAhPending = 40; calcPackDims();
  const h60 = document.querySelector('#dimResult .dim-nk[data-holder="square-23"]');
  out.h60 = { svg: !!h60.querySelector('svg.pack-svg'), narrow: h60.dataset.narrow === '16', ok: /✓ נכנס/.test(h60.textContent) };
  useVehiclePack('Inokim OX', 72); document.getElementById('dimHolder').value = 'diag-a'; dimAhPending = 35; calcPackDims();
  const w72 = document.querySelector('#dimResult .dim-nk[data-holder="diag-a"]');
  out.w72 = { ok: /✓ נכנס/.test(w72.textContent), bareTxt: w72.dataset.bare === '1',
    bare: w72.querySelectorAll('svg.pack-side-top circle.pack-bare').length, cells: w72.querySelectorAll('svg.pack-svg:not(.pack-side-bottom) circle').length };
  out.w72.snake = w72.dataset.snake === '1';
  // 60V 16S8P on W: eight across, a group to a row, every row one group
  useVehiclePack('Inokim OX', 60); document.getElementById('dimHolder').value = 'diag-a'; dimAhPending = 40; calcPackDims();
  const w60 = document.querySelector('#dimResult .dim-nk[data-holder="diag-a"]'), cs = dimLast.plan.cells, cols = new Map();
  for (const q of cs) { const k = Math.floor((q.x - dimLast.plan.dia / 2 + 1) / 22.7); (cols.get(k) || cols.set(k, new Set()).get(k)).add(q.g); }
  out.w60 = { txt: w60.dataset.across === '8' && w60.dataset.snake === '0', oneEach: [...cols.values()].every((g) => g.size === 1), cols: cols.size };
  useVehiclePack('Inokim OX', 72); document.getElementById('dimHolder').value = 'diag-a';
  dimAhPending = 40; calcPackDims();
  const w80 = document.querySelector('#dimResult .dim-nk[data-holder="diag-a"]');
  out.w80 = { svg: !!w80.querySelector('svg.pack-svg'), note: !/אין ציור/.test(w80.textContent), no: /✗ לא נכנס/.test(w80.textContent) };
  FILL_WAY['diag-a'] = 'B';
  dimExtraTouched = false;
  clearDimVehicle();
  return out;
}, SELFTEST);
check('the OX: W laid zigzag across (B), Z nesting (A), at every voltage', oxw.orient.every((x) => /diag-a:B$|diag-b:A$|square-23:A$/.test(x)), oxw.orient.join(' '));
check('the OX: across the wide and the narrow part, W 8/6, Z 6/5, the square 7/5', oxw.across.join(' ') === 'diag-a:8/6 diag-b:6/5 square-23:7/5', oxw.across.join(' '));
check('the OX: the maxima — the holder up to his counts (136 W, 126 Z, 140 H), then at most three bare rows',
  oxw.max.join(' ') === '36diag-a:15 36diag-b:13 36square-23:13 48diag-a:11 48diag-b:10 48square-23:10 52diag-a:10 52diag-b:9 52square-23:9 60diag-a:9 60diag-b:8 60square-23:8 72diag-a:7 72diag-b:6 72square-23:6', oxw.max.join(' '));
check('the OX: every cell of every maximum lies inside the tray, wide part or narrow', oxw.outside.length === 0, oxw.outside.join(' '));
check('the OX at 60V 16S8P on ניקל H: it goes in, group 16 in the narrow part, drawn', oxw.h60.ok && oxw.h60.svg && oxw.h60.narrow, oxw.h60);
// Rows the whole width again, the OX too (his list of questions, the same night): his 136 in the holder and
// four bare cells in one row at the end.
check('the OX at 72V 20S7P on ניקל W: his 136 in the holder and four bare cells, one row at the end, drawn dashed, the whole width',
  oxw.w72.ok && oxw.w72.bareTxt && oxw.w72.bare === 4 && oxw.w72.cells === 140 && oxw.w72.snake, oxw.w72);
check('the OX at 72V 20S8P on ניקל W: ✗ and no drawing', oxw.w80.no && !oxw.w80.svg && oxw.w80.note, oxw.w80);
check('the OX at 60V 16S8P on ניקל W: a row of eight per group, sixteen rows, no row shared', oxw.w60.txt && oxw.w60.oneEach && oxw.w60.cols === 16, oxw.w60);

// THE NICKEL AS IT SITS (Daniel, 2026-10-17, night, over his list of questions with example drawings): two
// drawings, the top side and the bottom; on the top a strip joins 1+2, 3+4 …, on the bottom 1 alone (B−),
// then 2+3, 4+5 …, and 16 alone (B+). The rows are numbered over the top, and no number sits in the cells
// ("תמחוק את מספר התאים שכתוב בשחור באמצע הציור"). The Zero 11X at 60V, 16S8P on W, the whole width.
// --selftest gives every group a strip of its own.
const tidy = await page.evaluate((SELF) => {
  const real = nickelPieces;
  if (SELF) nickelPieces = (G) => Array.from({ length: G }, (_, k) => [k]);
  dimExtraTouched = false; dimExtraAuto = null;
  useVehiclePack('Zero 11X', 60); document.getElementById('dimHolder').value = 'diag-a'; dimAhPending = 40; calcPackDims();
  const card = document.querySelector('#dimResult .dim-nk[data-holder="diag-a"]');
  const top = card.querySelector('svg.pack-side-top'), bot = card.querySelector('svg.pack-side-bottom');
  const pieces = (svg) => (svg ? [...svg.querySelectorAll('g.pack-nickel')].map((e) => e.dataset.groups).join(',') : '');
  const rows = top ? [...top.querySelectorAll('text.pack-row')].map((t) => +t.textContent) : [];
  const out = { top: pieces(top), bottom: pieces(bot), cells: top ? top.querySelectorAll('circle').length : 0, bottomCells: bot ? bot.querySelectorAll('circle').length : 0,
    inCells: card.querySelectorAll('svg text.pack-group').length, rowsFirst: rows[0], rowsLast: rows[rows.length - 1], lastRow: dimLast ? Math.max(...dimLast.plan.cells.map((c) => c.row)) + 1 : 0,
    sides: [...card.querySelectorAll('.dim-nk-side')].map((e) => e.textContent).join(','),
    ends: top ? [...top.querySelectorAll('text')].map((t) => t.textContent).filter((x) => /^B[−+]$/.test(x)).join(',') : '' };
  nickelPieces = real; clearDimVehicle();
  return out;
}, SELFTEST);
const pairs = (from, G) => { const o = from ? ['1'] : []; for (let k = from + 1; k <= G; k += 2) o.push(k + 1 <= G ? k + '+' + (k + 1) : String(k)); return o.join(','); };
check('the Zero 11X 16S8P on W: two drawings, the top side and the bottom, each cell once in each', tidy.sides === 'צד עליון,צד תחתון' && tidy.cells === 128 && tidy.bottomCells === 128, tidy);
check('the top side\'s strips join 1+2, 3+4 … 15+16', tidy.top === pairs(0, 16), tidy);
check('the bottom side\'s: 1 alone, 2+3 … 14+15, 16 alone', tidy.bottom === pairs(1, 16), tidy);
check('the rows numbered over the top, first to last, no number in the cells, B− and B+',
  tidy.rowsFirst === 1 && tidy.rowsLast === tidy.lastRow && tidy.inCells === 0 && tidy.ends === 'B−,B+', tidy);

await browser.close();
srv.close();
// finish() RETURNS the code, it does not exit. Bare, every check in this file could fail and
// the run would still be green — which is precisely the failure this suite exists to catch,
// sitting in the suite itself. Ten of the eleven suites here already had it right.
process.exit(finish());
