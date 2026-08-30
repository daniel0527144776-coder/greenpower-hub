// The pack-size estimator, driven in a real browser.
//
// It answers "will this pack go in that scooter", which is a question with a wrong answer
// available: the previous version spaced cells at diameter + 1mm, i.e. 22mm for a 21700,
// when every bracket in the Wellgo catalogue is 21.4-23mm. A 20-cell row therefore came out
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
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
  set('dimCell', o.cell); set('dimV', o.v); set('dimAh', o.ah);
  set('dimHolder', o.holder); set('dimPerRow', o.perRow);
  set('dimLayers', o.layers || 1); set('dimExtra', o.extra == null ? 18 : o.extra);
  calcPackDims();
  const html = document.getElementById('dimResult').innerHTML;
  const mm = html.match(/(\d+) × (\d+) × (\d+)/);
  return { html, L: +mm[1], W: +mm[2], H: +mm[3], text: document.getElementById('dimResult').textContent };
}, opts);

const TRAY = [{ id: 1, model: 'מבחן-גדול', l: 400, w: 200, h: 120 }, { id: 2, model: 'מבחן-קטן', l: 150, w: 90, h: 80 }];
const base = { cell: '21700-50e', v: 60, ah: 20, perRow: 10, models: TRAY };

// 16S4P = 64 cells, 10 per row -> 7 rows, honeycomb 21.4mm pitch.
//   L = 9*21.4 + 21 + 2*1.5 + 21.4/2 = 227
//   W = 6*(21.4*0.866) + 21 + 3 = 135      H = 70 + 4 + 18 = 92
const honey = await read({ ...base, holder: 'honeycomb' });
check('16S4P block, honeycomb: 217 x 135 x 92', honey.L === 217 && honey.W === 135 && honey.H === 92, `${honey.L} x ${honey.W} x ${honey.H}`);
check('and it reports 64 cells / 1152 Wh', /64/.test(honey.text) && /1152/.test(honey.text), honey.text.slice(0, 80));

// Square at the same pitch must be WIDER across the rows and shorter along them: the stagger
// costs half a pitch in length and saves 13.4% of every row gap.
const square = await read({ ...base, holder: 'square' });
check('square is wider across rows than honeycomb', square.W > honey.W, `${square.W} vs ${honey.W}`);
check('square and honeycomb share the along-row pitch, so the same length', square.L === honey.L, `${square.L} vs ${honey.L}`);
check('the saving is the sin60 one, ~13%', Math.abs((square.W - 24) * 0.866 - (honey.W - 24)) <= 1.5, `${square.W} -> ${honey.W}`);

// The catalogue's four pitches must actually reach the arithmetic.
const sqSp = await read({ ...base, holder: 'square-23' });
check('the 23mm square bracket is wider than the 21.4 one', sqSp.L > square.L, `${sqSp.L} vs ${square.L}`);
const cell18 = await read({ ...base, cell: '18650-25p', holder: 'honeycomb' });
check('18650 is a different pitch and a shorter cell', cell18.L < honey.L && cell18.H < honey.H, `${cell18.L}x${cell18.H} vs ${honey.L}x${honey.H}`);

// Two layers: half the footprint, double the height.
const two = await read({ ...base, holder: 'honeycomb', layers: 2 });
check('two layers halve the rows and stack the height', two.W < honey.W && two.H > honey.H, `${two.W}/${two.H} vs ${honey.W}/${honey.H}`);

// The fit check is the point of the page. 227x135x92 goes in the 400x200x120 tray and not in
// the 150x90x80 one — and it must survive being turned, which is why it sorts both triples.
check('fits the big tray', /נכנס ל: .*מבחן-גדול/.test(honey.text), honey.text.slice(-90));
check('does not claim the small tray', !/מבחן-קטן/.test(honey.text), honey.text.slice(-90));
// Through read(), not a bare evaluate: the form still held the two-layer config from the
// check above, so the first version of this measured a 166mm-tall block against a 150mm tray
// and failed on its own leftover state. A test that carries state between cases is testing
// the order it was written in.
const rotated = await read({ ...base, holder: 'honeycomb', models: [{ id: 3, model: 'מסובב', l: 100, w: 240, h: 150 }] });
check('a turned tray still counts as a fit', /מסובב/.test(rotated.text), rotated.text.slice(-90));

// The extra allowance is an input, not a constant baked at 18.
const noExtra = await read({ ...base, holder: 'honeycomb', extra: SELFTEST ? 18 : 0 });
check('the case/BMS allowance is honoured', noExtra.H === honey.H - 18, `${noExtra.H} vs ${honey.H}`);

// Daniel measured a 72V 30Ah pack he built — 20S6P, 120 cells, twenty to a row — at 390 x
// 135mm. That is the only ground truth this page has, so it is a test: the diagonal spacing
// he uses must reproduce it. Tolerance 8mm, which is the width of a shrink wrap.
const real = await read({ ...base, v: 72, ah: 30, perRow: 6, holder: 'diag-224' });
// Compared as a SET: a block is the same block whichever way round it is reported, and
// pinning the order would be testing which axis I happened to call the length.
const got = [real.L, real.W].sort((a, b) => a - b);
check('his measured 72V 30Ah pack: 390 x 135', Math.abs(got[1] - 390) <= 8 && Math.abs(got[0] - 135) <= 8, `${real.L} x ${real.W}`);

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
  document.getElementById('dimAh').value = '80'; calcPackDims();
  useVehiclePack('Blade GT');
  return { atMax: ok, blade: document.getElementById('dimResult').textContent };
});
check('no warning when the build equals the ceiling', !/⚠/.test(over.atMax), over.atMax.slice(-60));

// The Inokim OX is counted per bracket, not computed: Daniel took 140 cells out of its tub
// with no diagonal holder, 136 on one and 126 on the other. A build of 136 is therefore fine
// on the square holder and over on the 21.6/24.6 one, which a single ceiling cannot express.
const ox = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  useVehiclePack('Inokim OX');
  const filled = document.getElementById('dimResult').textContent;
  set('dimHolder', 'diag-225'); set('dimAh', 35); set('dimV', 72); calcPackDims();
  const overDiag = document.getElementById('dimResult').textContent;
  set('dimHolder', 'square-23'); calcPackDims();
  const okSquare = document.getElementById('dimResult').textContent;
  return { filled, overDiag, okSquare };
});
check('the OX fills its own 20S7P build', /20S 7P/.test(ox.filled), ox.filled.slice(0, 60));
check('140 cells is over the 126 counted on the diagonal holder', /⚠/.test(ox.overDiag) && /126/.test(ox.overDiag), ox.overDiag.slice(-70));
check('and not over the 140 counted on the square one', !/⚠/.test(ox.okSquare), ox.okSquare.slice(-70));

// The drawing is the answer to "how do I lay it out", so it has to BE the layout: one circle
// per cell, in the grid the numbers above it describe. A picture that disagrees with the
// figures is worse than no picture.
const draw = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30);
  set('dimHolder', 'diag'); set('dimPerRow', 20); set('dimLayers', 1); calcPackDims();
  const svg = document.getElementById('dimDraw');
  return { circles: svg.querySelectorAll('circle').length, hasSvg: !!svg.querySelector('svg'),
           txt: svg.textContent };
});
check('the drawing has one circle per cell (120)', draw.circles === 120, String(draw.circles));
check('and labels the row length and the row count', /20 תאים בשורה/.test(draw.txt) && /6 שורות/.test(draw.txt), draw.txt.slice(0, 80));
check('and names the parallel group so it reads as a weld', /6P/.test(draw.txt), draw.txt.slice(0, 80));

// A staggered layout must actually be drawn staggered, or the picture lies about the shape.
const stag = await page.evaluate(() => {
  const xs = (h) => { document.getElementById('dimHolder').value = h; calcPackDims();
    return [...document.querySelectorAll('#dimDraw circle')].map(c => +c.getAttribute('cx')); };
  const d = xs('diag-225'), s = xs('square-23');
  return { diagFirstTwoRows: d[0] !== d[20], squareFirstTwoRows: s[0] === s[20] };
});
check('diagonal rows are offset from each other', stag.diagFirstTwoRows, JSON.stringify(stag));
check('square rows are not', stag.squareFirstTwoRows, JSON.stringify(stag));

// The OX tub is seeded once and never re-seeded — a default that comes back after you delete
// it is the DEFAULT_REPLIES trap.
const seeded = await page.evaluate(() => {
  localStorage.removeItem('gp_dims_seed_ox'); localStorage.setItem('gp_dims', '[]');
  seedOxTub(); const first = (JSON.parse(localStorage.getItem('gp_dims')) || []).length;
  localStorage.setItem('gp_dims', '[]'); seedOxTub();
  const second = (JSON.parse(localStorage.getItem('gp_dims')) || []).length;
  return { first, second };
});
check('the OX tub seeds once', seeded.first === 1, JSON.stringify(seeded));
check('and does not come back after deletion', seeded.second === 0, JSON.stringify(seeded));

// Real datasheet dimensions, not the format name. The 50SG is 21.35mm across against the 50E
// and 50PL at 21.15, and in a 21.4mm no-spacer bracket that is 0.05mm of clearance — it does
// not go in. A staggered layout is the opposite case: 19.5mm between rows holds 21.15mm cells
// because the nearest neighbour sits half a pitch sideways, and the first version of this
// check condemned every honeycomb pack in the table.
const clear = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const run = (cell, holder) => { set('dimCell', cell); set('dimHolder', holder); set('dimV', 72); set('dimAh', 20); calcPackDims();
    return document.getElementById('dimResult').textContent; };
  return { sgTight: run('21700-50sg', 'square'), eOk: run('21700-50e', 'square'),
           honey: run('21700-50e', 'diag-225') };
});
check('a 21.35mm 50SG is flagged in a 21.4mm bracket', /לא נכנס/.test(clear.sgTight), clear.sgTight.slice(-80));
check('a 21.15mm 50E in the same bracket is not', !/לא נכנס/.test(clear.eOk), clear.eOk.slice(-80));
check('and a honeycomb row pitch under the diameter is fine', !/לא נכנס/.test(clear.honey), clear.honey.slice(-80));

// One 21700 bracket is 10x15 holes. Anything bigger is two pieces butted together, which is a
// thing to order and a seam in the build.
const pieces = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set('dimCell', '21700-50e'); set('dimHolder', 'square'); set('dimV', 72); set('dimAh', 60); set('dimPerRow', 20); calcPackDims();
  const big = document.getElementById('dimResult').textContent;
  set('dimAh', 10); set('dimPerRow', 10); calcPackDims();
  return { big, small: document.getElementById('dimResult').textContent };
});
check('a 240-cell layout says it needs more than one bracket', /חלקי תושבת/.test(pieces.big), pieces.big.slice(-70));
check('a small pack does not', !/חלקי תושבת/.test(pieces.small), pieces.small.slice(-70));

const nickels = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const run = (h) => { set('dimHolder', h); set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30); set('dimPerRow', 6); calcPackDims();
    const m = document.getElementById('dimResult').innerHTML.match(/(\d+) × (\d+) × (\d+)/); return [+m[1], +m[2]]; };
  return { a: run('diag-225'), b: run('diag-224'), sq: run('square-23') };
});
check('the two diagonal nickels give different blocks', nickels.a[0] !== nickels.b[0] || nickels.a[1] !== nickels.b[1], JSON.stringify(nickels));
check('and the 23mm square block is larger in area than either diagonal', nickels.sq[0]*nickels.sq[1] > nickels.a[0]*nickels.a[1] && nickels.sq[0]*nickels.sq[1] > nickels.b[0]*nickels.b[1], JSON.stringify(nickels));

// The table checks itself: 16S and 20S in one tray should want roughly the same number of
// cells, and every consistent row drops P by one or two going up in voltage. Four rows carry
// the SAME P for both, which makes the 60V build 25% smaller in the same box — the shape of a
// number copied across rather than recalculated. They are flagged on the row, not corrected.
const flagged = await page.evaluate(() => {
  renderVehiclePacks();
  const rows = [...document.querySelectorAll('#vpList .list-item')];
  return rows.filter(r => /חלוקים על גודל/.test(r.textContent)).map(r => r.querySelector('strong').textContent.replace(/s*⚠s*/, '').trim());
});
check('the four disagreeing rows are flagged', flagged.length === 4, flagged.join(', '));
check('and they are the expected four', ['Nami Blast','Nami Klima','Mantis King','Teverun'].every(m => flagged.includes(m)), flagged.join(', '));

check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
finish();
