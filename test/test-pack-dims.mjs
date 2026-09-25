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

// 16S4P = 64 cells, 10 per row -> 7 rows, on the 21.5 diagonal (18.62 between rows).
//   L = 9*21.5 + 21.15 + 3 = 218     W = 6*18.62 + 21.15 + 3 = 136     H = 70.15 + 4 + 22 = 96
// (The two Wellgo catalogue brackets this used — square and honeycomb 21.4 — left the list on
// 2026-09-25; he does not build on them.)
const honey = await read({ ...base, holder: 'diag-b' });
check('16S4P block, 21.5 diagonal: 218 x 136 x 96', honey.L === 218 && honey.W === 136 && honey.H === 96, `${honey.L} x ${honey.W} x ${honey.H}`);
check('and it reports 64 cells / 1152 Wh', /64/.test(honey.text) && /1152/.test(honey.text), honey.text.slice(0, 80));

// A square bracket must be WIDER across the rows than a diagonal one: the diagonal nests the
// rows at pitch x sin60, which is the 13% the diagonal exists for.
const diagA = await read({ ...base, holder: 'diag-a' });
const square = await read({ ...base, holder: 'square-23' });
check('square is wider across rows than the diagonal', square.W > diagA.W, `${square.W} vs ${diagA.W}`);
check('the diagonal row spacing is the sin60 one', Math.abs((diagA.W - 24.15) - 6 * 22.5 * 0.866) <= 1.5, String(diagA.W));
check('the 22.5 diagonal is 1mm a cell longer than the 21.5 one', Math.abs((diagA.L - honey.L) - 9) <= 1, `${diagA.L} vs ${honey.L}`);
check('the 23mm square bracket is longer than the 21.5 one', square.L > honey.L, `${square.L} vs ${honey.L}`);
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
const rotated = await read({ ...base, holder: 'diag-b', models: [{ id: 3, model: 'מסובב', l: 100, w: 240, h: 150 }] });
check('a turned tray still counts as a fit', /מסובב/.test(rotated.text), rotated.text.slice(-90));

// The allowance is derived from the VOLTAGE now — 14 / 18 / 22 / 26 — and is still an input
// he can override. So this asserts the difference against what the page actually chose,
// rather than against a literal that goes stale the next time the ladder moves.
const noExtra = await read({ ...base, holder: 'diag-b', extra: SELFTEST ? 18 : 0 });
const autoAllowance = honey.H - (70 + 4);
check('the case/BMS allowance is honoured', noExtra.H === honey.H - autoAllowance, `${noExtra.H} vs ${honey.H} (allowance ${autoAllowance})`);

// Daniel measured a 72V 30Ah pack he built — 20S6P, 120 cells, twenty to a row — at 390 x
// 135mm. That is the only ground truth this page has, so it is a test: the diagonal spacing
// he uses must reproduce it. Tolerance 8mm, which is the width of a shrink wrap.
const real = await read({ ...base, v: 72, ah: 30, perRow: 6, holder: 'diag-a' });
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
  // The 21.5 nickel is the OX's tightest: 126 counted, against 136 on the 22.5 and 140 with
  // no diagonal holder at all. A 140-cell build is over on this one and fine on the square.
  set('dimHolder', 'diag-b'); set('dimAh', 35); set('dimV', 72); calcPackDims();
  const overDiag = document.getElementById('dimResult').textContent;
  set('dimHolder', 'square-23'); calcPackDims();
  const okSquare = document.getElementById('dimResult').textContent;
  return { filled, overDiag, okSquare };
});
check('the OX fills its own 20S7P build', /20S 7P/.test(ox.filled), ox.filled.slice(0, 60));
check('140 cells is over the 126 counted on the diagonal holder', /⛔|⚠/.test(ox.overDiag) && /126/.test(ox.overDiag) && /חורג/.test(ox.overDiag), ox.overDiag.slice(-70));
check('and not over the 140 counted on the square one', !/⚠/.test(ox.okSquare), ox.okSquare.slice(-70));

// The drawing is the answer to "how do I lay it out", so it has to BE the layout: one circle
// per cell, in the grid the numbers above it describe. A picture that disagrees with the
// figures is worse than no picture.
const draw = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30);
  clearDimVehicle();
  set('dimHolder', 'diag-a'); set('dimPerRow', 20); calcPackDims();
  const svg = document.getElementById('dimDraw');
  const block = document.getElementById('dimResult').innerHTML.match(/(\d+) × (\d+) × (\d+)/) || [];
  return { circles: svg.querySelectorAll('circle').length, hasSvg: !!svg.querySelector('svg'),
           txt: svg.textContent, L: block[1], W: block[2], res: document.getElementById('dimResult').innerText };
});
check('the drawing has one circle per cell (120)', draw.circles === 120, String(draw.circles));
// The drawing's labels are the block's OWN size — they once read 473 beside a block of 476,
// because the picture left the bracket walls out. Counts are said once, in the layout row.
check('the drawing is labelled with the block size itself', draw.txt.includes(draw.L + ' מ"מ') && draw.txt.includes(draw.W + ' מ"מ'), [draw.txt, draw.L, draw.W]);
check('and does not repeat the counts', !/תאים בשורה|שורות|עיגול/.test(draw.txt), draw.txt);
check('the layout is said in S and P', /לאורך 20S · לרוחב 6P/.test(draw.res), draw.res);

// A staggered layout must actually be drawn staggered, or the picture lies about the shape.
const stag = await page.evaluate(() => {
  const xs = (h) => { document.getElementById('dimHolder').value = h; calcPackDims();
    return [...document.querySelectorAll('#dimDraw circle')].map(c => +c.getAttribute('cx')); };
  const d = xs('diag-a'), s = xs('square-23');
  return { diagFirstTwoRows: d[0] !== d[20], squareFirstTwoRows: s[0] === s[20] };
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
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const run = (cell, holder) => { set('dimCell', cell); set('dimHolder', holder); set('dimV', 72); set('dimAh', 20); calcPackDims();
    return document.getElementById('dimResult').textContent; };
  clearDimVehicle();
  return { sgTight: run('21700-50sg', 'diag-b'), eOk: run('21700-50e', 'diag-b'),
           honey: run('21700-50e', 'diag-b') };
});
check('a 21.35mm 50SG is flagged in a 21.5mm bracket', /לא נכנס/.test(clear.sgTight), clear.sgTight.slice(-80));
check('a 21.15mm 50E in the same bracket is not', !/לא נכנס/.test(clear.eOk), clear.eOk.slice(-80));
check('and a honeycomb row pitch under the diameter is fine', !/לא נכנס/.test(clear.honey), clear.honey.slice(-80));

// One 21700 bracket is 10x15 holes, and a bigger block is two pieces butted together. The page
// USED to say so on screen; Daniel had that line removed on 2026-09-22. These assert it is gone
// rather than being deleted — the same rule the quick pricer left behind. A half-removed
// feature leaves a live call to something that no longer exists, and that fails in the console
// instead of on screen. BRACKET_MAX itself is deliberately kept: it is the real sheet size.
const pieces = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set('dimCell', '21700-50e'); set('dimHolder', 'square-23'); set('dimV', 72); set('dimAh', 60); set('dimPerRow', 20); calcPackDims();
  const big = document.getElementById('dimResult').textContent;
  set('dimAh', 10); set('dimPerRow', 10); calcPackDims();
  return { big, small: document.getElementById('dimResult').textContent };
});
check('the bracket-pieces line is gone on a 240-cell layout', !/חלקי תושבת/.test(pieces.big), pieces.big.slice(-70));
check('and on a small pack too', !/חלקי תושבת/.test(pieces.small), pieces.small.slice(-70));
check('but the layout itself still computes', /תצורה/.test(pieces.big), pieces.big.slice(0, 60));

const nickels = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const run = (h) => { set('dimHolder', h); set('dimCell', '21700-50e'); set('dimV', 72); set('dimAh', 30); set('dimPerRow', 6); calcPackDims();
    const m = document.getElementById('dimResult').innerHTML.match(/(\d+) × (\d+) × (\d+)/); return [+m[1], +m[2]]; };
  return { a: run('diag-a'), b: run('diag-b'), sq: run('square-23') };
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
// Corrected on 2026-08-31, so nothing should be flagged now — and the check stays, because
// its job is the NEXT row someone adds, not the four that have been fixed.
check('no row disagrees with itself any more', flagged.length === 0, flagged.join(', '));
check('and the corrected four are the ones that used to be', /10P|12P/.test(await page.evaluate(() => document.getElementById('vpList').textContent)), 'ok');

// The nickel line prices off his own stock. Every shape costs almost the same per hole, so
// the number to get right is the COUNT — two contacts per cell — and the plate name is about
// the shape of the parallel group.
const nick = await page.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set('dimCell', '21700-50e'); set('dimHolder', 'diag-a'); set('dimV', 72); set('dimAh', 30); set('dimPerRow', 6); calcPackDims();
  const six = document.getElementById('dimResult').textContent;
  set('dimAh', 15); calcPackDims();
  return { six, three: document.getElementById('dimResult').textContent };
});
check('120 cells means 240 contacts', /240 מגעים/.test(nick.six), nick.six.slice(-90));
check('and a 6P group wants the 6×5 plate', /תבנית 6×5/.test(nick.six), nick.six.slice(-60));
check('a 3P group wants the 1×3 strip', /תבנית 1×3/.test(nick.three), nick.three.slice(-60));

// The OEM capacity is the tray read backwards, so it has to reach the screen — and where it
// can be compared directly it must AGREE: Thunder 3 tops out at 72V 40Ah, which is 20S8P,
// which is the row.
const oem = await page.evaluate(() => {
  renderVehiclePacks();
  const rows = [...document.querySelectorAll('#vpList .list-item')];
  const txt = (m) => (rows.find(r => r.textContent.includes(m)) || {}).textContent || '';
  return { count: rows.filter(r => /מקורי/.test(r.textContent)).length,
           thunder: txt('Thunder'), blade: txt('Blade GT') };
});
check('twenty rows carry an OEM capacity', oem.count >= 20, String(oem.count));
check('Thunder 3: OEM 40Ah and the row is 20S8P', /מקורי 72V 40Ah/.test(oem.thunder) && /20S 8P/.test(oem.thunder), oem.thunder.slice(0,110));
check('Blade GT: OEM 35Ah and the row is 16S7P', /מקורי 60V 35Ah/.test(oem.blade) && /16S 7P/.test(oem.blade), oem.blade.slice(0,110));

// Every row gets a picture, and every picture is DRAWN. The check that matters is the last
// one: an <img> here would look perfect on this machine and arrive as the filter's grey
// placeholder on the phone the hub is actually used on — HTTP 200, valid JPEG magic bytes,
// a picture of nothing. That failure is invisible to every other check in this file.
const art = await page.evaluate(() => {
  renderVehiclePacks();
  const list = document.getElementById('vpList');
  const rows = [...list.querySelectorAll('.list-item')];
  const kinds = new Set(VEHICLE_PACKS.map((v) => vehType(v)));
  return {
    rows: rows.length,
    svgs: list.querySelectorAll('svg').length,
    imgs: list.querySelectorAll('img').length,
    kinds: [...kinds].sort().join(),
    inked: [...list.querySelectorAll('svg')].every((s) => s.querySelector('circle, path, rect')),
  };
});
check('every vehicle row carries a drawing', art.svgs === art.rows && art.rows > 25, art.svgs + '/' + art.rows);
check('and none of them is empty', art.inked, 'ok');
// A vehType that quietly answered "scooter" for everything would still pass the count above
// and give 29 identical pictures — which is worse than no picture, because it looks right.
check('all four vehicle kinds are drawn', art.kinds === 'bomber,emoto,moto,scooter', art.kinds);
check('nothing in the list fetches an image', art.imgs === 0, String(art.imgs));

// The Bomber is a frame family whose versions differ by 3.5x in what they hold, so one row
// called "Bomber" was a wrong answer wearing the shape of a right one.
const bomb = await page.evaluate(() => {
  renderVehiclePacks();
  const rows = [...document.querySelectorAll('#vpList .list-item')]
    .filter((r) => /Bomber/.test(r.textContent)).map((r) => r.textContent);
  return { n: rows.length,
           max: VEHICLE_PACKS.filter((v) => /Bomber/.test(v.m)).map((v) => v.max).sort((a, b) => a - b) };
});
check('the Bomber is listed as five frames', bomb.n === 5, String(bomb.n));
check('and they are not the same battery bay', bomb.max[0] === 84 && bomb.max[4] === 300, bomb.max.join('/'));

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
  useVehiclePack('Talaria');
  out.talaria7 = res();
  dimAhPending = 50; calcPackDims();
  out.talaria = res();
  out.hasBest = !!document.querySelector('#dimResult .dim-best');
  if (out.hasBest) applyDimBest();
  out.after = res();
  out.afterL = +((document.getElementById('dimResult').innerHTML.match(/(\d+) × (\d+) × (\d+)/) || [])[1] || 0);
  // one list: his tray on its vehicle's card, and a tray for an unknown vehicle listed first
  localStorage.setItem('gp_dims', JSON.stringify([
    { id: 'dz', model: 'Zero 10X', l: 455, w: 134, h: 58, measured: true },
    { id: 'dk', model: 'Kugoo G2', l: 400, w: 150, h: 80, measured: true }]));
  setDimTab('veh');
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
check('only his three holders and a custom one are offered', JSON.stringify(rb.opts) === JSON.stringify(['diag-a', 'diag-b', 'square-23', 'custom']), rb.opts);
check('the calculator opens on the vehicle list', rb.vehFirst, rb.vehFirst);
check('a 22.5mm vehicle gets the 22.5 diagonal', rb.enduroHolder === 'diag-a', rb.enduroHolder);
check('picking a vehicle shows its result', rb.toBuild, rb.toBuild);
// 20S7P = 140 in a 381x171 tray: 17 x 8 = 136 one way round, 7 x 20 = 140 the other. The
// one-way count said no; the pack goes in, the way his own 390x135 pack is built.
check('the bracket may be turned: Talaria takes its 140 cells', /^✅ נכנס ל-Talaria/.test(rb.talaria7.trim()) && /לרוחב 7P|לאורך 7P/.test(rb.talaria7), rb.talaria7.slice(0, 120));
check('a build that does not fit its tray says so first', /^⛔ לא נכנס ל-Talaria/.test(rb.talaria.trim()), rb.talaria.slice(0, 80));
check('and offers the biggest that does', rb.hasBest, rb.hasBest);
check('which then fits, in a block shorter than the tray', /^✅ נכנס ל-Talaria/.test(rb.after.trim()) && rb.afterL > 0 && rb.afterL <= 381, [rb.after.slice(0, 40), rb.afterL]);
check('his tray sits on its vehicle\'s card, marked measured', rb.zeroMine, rb.zeroMine);
check('a tray for a vehicle not in the table is listed first', rb.kugooFirst, rb.kugooFirst);
check('there is one list, not two', rb.oneList, rb.oneList);
check('picking his own tray judges the build against it', rb.kugooMine && /✅ נכנס ל-Kugoo G2/.test(rb.kugoo), rb.kugoo.slice(0, 60));

check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
// finish() RETURNS the code, it does not exit. Bare, every check in this file could fail and
// the run would still be green — which is precisely the failure this suite exists to catch,
// sitting in the suite itself. Ten of the eleven suites here already had it right.
process.exit(finish());
