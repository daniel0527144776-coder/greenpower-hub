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
check('16S4P block, honeycomb: 227 x 135 x 92', honey.L === 227 && honey.W === 135 && honey.H === 92, `${honey.L} x ${honey.W} x ${honey.H}`);
check('and it reports 64 cells / 1152 Wh', /64/.test(honey.text) && /1152/.test(honey.text), honey.text.slice(0, 80));

// Square at the same pitch must be WIDER across the rows and shorter along them: the stagger
// costs half a pitch in length and saves 13.4% of every row gap.
const square = await read({ ...base, holder: 'square' });
check('square is wider across rows than honeycomb', square.W > honey.W, `${square.W} vs ${honey.W}`);
check('square is shorter along the row (no half-pitch offset)', square.L < honey.L, `${square.L} vs ${honey.L}`);
check('the saving is the sin60 one, ~13%', Math.abs((square.W - 24) * 0.866 - (honey.W - 24)) <= 1.5, `${square.W} -> ${honey.W}`);

// The catalogue's four pitches must actually reach the arithmetic.
const sqSp = await read({ ...base, holder: 'square-sp' });
check('21700 square+spacer uses the 23mm pitch, not 21.4', sqSp.L > square.L, `${sqSp.L} vs ${square.L}`);
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

check('no dialog was raised', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
finish();
