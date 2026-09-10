// The pack estimator, run BACKWARDS from the old battery the customer brought in.
//
//   node test/test-oldpack.mjs
//   node test/test-oldpack.mjs --selftest
//
// Asked for on 2026-09-01: the calculator should take the old pack's dimensions as its input,
// and every measurement he types should be saved against the vehicle model — because he has
// no vehicles in the lab, only the old pack, and the 24-row vehicle table is AI estimates.
//
// The assertion that protects this is the ROUND TRIP. calcPackDims computes
//     L = (cols-1)*pitch + dia + 2*WALL
// and oldPackFit inverts exactly that. Feed the forward estimator's own block size back in
// and the same pack must come out. A second copy of the geometry is the shape of bug this
// repo has hit four times (Math.round(V/3.7) in four files; packCost in four files), and a
// round trip is the only check that notices.
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
await new Promise((r) => srv.listen(4343, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

await page.goto('http://localhost:4343/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });
await page.evaluate(() => navigateTo('calcs'));
await page.waitForTimeout(350);

// SELFTEST: a SECOND, wrong pitch inside the reverse — precisely what the round trip exists
// to catch. 21.4 -> 24 is a plausible-looking bracket number, which is what makes it dangerous.
if (SELFTEST) {
  await page.evaluate(() => {
    const real = window.oldPackFit;
    window.oldPackFit = function () {
      const r = real();
      if (r && r.fits) {
        r.cols = Math.floor(r.cols * 21.4 / 24);
        r.N = r.cols * r.rows * r.layers;
        r.P = Math.floor(r.N / r.S);
        r.ah = +(r.P * r.c.ah).toFixed(1);
      }
      return r;
    };
  });
}

const trip = await page.evaluate(() => {
  const out = [];
  for (const [V, Ah, perRow] of [[60, 20, 10], [72, 30, 20], [48, 15, 8], [72, 40, 16]]) {
    document.getElementById('dimV').value = String(V);
    refreshAhOptions();
    document.getElementById('dimAh').value = String(Ah);
    document.getElementById('dimPerRow').value = String(perRow);
    document.getElementById('dimLayers').value = '1';
    calcPackDims();
    const txt = document.getElementById('dimResult').innerText;
    const m = txt.match(/(\d+)\s*[×x]\s*(\d+)\s*[×x]\s*(\d+)/);
    if (!m) { out.push({ V, Ah, err: 'no block size in: ' + txt.slice(0, 80) }); continue; }
    const [L, W, H] = [+m[1], +m[2], +m[3]];
    document.getElementById('opL').value = String(L);
    document.getElementById('opW').value = String(W);
    document.getElementById('opH').value = String(H);
    document.getElementById('opV').value = String(V);
    const r = oldPackFit();
    out.push({ V, Ah, L, W, H, want: seriesForV(V) * Math.ceil(Ah / 5.0),
               got: r && r.fits ? r.N : null, gotAh: r && r.fits ? r.ah : null });
  }
  return out;
});
trip.forEach((r) => console.log(`  ${r.V}V ${r.Ah}Ah -> ${r.L}x${r.W}x${r.H}mm -> ${r.got} cells (forward built ${r.want})`));
check('the reverse fits at least the pack the forward estimator built',
  trip.every((r) => !r.err && r.got !== null && r.got >= r.want), trip);
// A tolerance that swallowed a whole extra row would pass the line above and be useless.
check('and does not invent room for a whole extra row',
  trip.every((r) => !r.err && r.got !== null && r.got < r.want * 1.6), trip.map((r) => `${r.got}/${r.want}`));
check('the capacity it reports is at least what was asked for',
  trip.every((r) => !r.err && r.gotAh !== null && r.gotAh >= r.Ah), trip.map((r) => `${r.gotAh}/${r.Ah}`));

// The one pack in this repo that was actually measured, not modelled: 72V 30Ah, 20S6P,
// twenty cells to a row, 390 x 135mm, on the no-template diagonal he measured himself
// (19 / 21.4) — NOT the 22.5mm bracket the estimator defaults to. Setting the holder is the
// difference between validating the model and failing the code for the test's own mistake.
const real = await page.evaluate(() => {
  document.getElementById('dimHolder').value = 'custom';
  document.getElementById('dimPitchAlong').value = '19';
  document.getElementById('dimPitchAcross').value = '21.4';
  calcPackDims();
  document.getElementById('opL').value = '390';
  document.getElementById('opW').value = '135';
  document.getElementById('opH').value = '100';
  document.getElementById('opV').value = '72';
  return oldPackFit();
});
console.log(`  his measured pack 390x135 -> ${real && real.fits ? `${real.cols} x ${real.rows} = ${real.N} cells, ${real.S}S${real.P}P, ${real.ah}Ah` : 'DOES NOT FIT'}`);
check('his real 390x135 pack gives twenty cells to a row', real && real.fits && real.cols >= 19 && real.cols <= 21, real && real.cols);
check('and the six rows he actually built', real && real.fits && real.rows >= 6, real && real.rows);
check('and reaches the 30Ah it really is', real && real.fits && real.ah >= 30, real && real.ah);

// It must refuse rather than guess — the rule the whole dims page is built on.
const refuse = await page.evaluate(() => {
  const set = (l, w, h, v) => {
    document.getElementById('opL').value = l; document.getElementById('opW').value = w;
    document.getElementById('opH').value = h; document.getElementById('opV').value = v;
    return oldPackFit();
  };
  return { tiny: set(30, 30, 40, 60), narrow: set(120, 40, 100, 84) };
});
check('a box too small for a single cell says so', refuse.tiny && refuse.tiny.fits === false, refuse.tiny && refuse.tiny.fits);
check('a box too small for one series string says so', refuse.narrow && refuse.narrow.fits === false && refuse.narrow.tooSmallForV === true, refuse.narrow);

// Saving the measurement against the model — the half that makes the database his.
const saved = await page.evaluate(() => {
  localStorage.setItem('gp_dims', JSON.stringify([{ id: 'd1', model: 'Kaabo Wolf King', l: 1, w: 1, h: 1, notes: '⚠ מ-AI, לא נמדד' }]));
  document.getElementById('opL').value = '390'; document.getElementById('opW').value = '135';
  document.getElementById('opH').value = '100'; document.getElementById('opV').value = '72';
  document.getElementById('opModel').value = 'Kaabo Wolf King';
  saveMeasuredPack();
  const rows = JSON.parse(localStorage.getItem('gp_dims'));
  document.getElementById('opModel').value = 'דגם חדש לגמרי';
  saveMeasuredPack();
  return { rows, after: JSON.parse(localStorage.getItem('gp_dims')), list: document.getElementById('dimsList').innerText };
});
const kaabo = saved.rows.find((d) => d.model === 'Kaabo Wolf King');
check('a measurement replaces the AI estimate for that model', kaabo && kaabo.l === 390 && kaabo.w === 135, kaabo);
check('and the row is marked measured', kaabo && kaabo.measured === true, kaabo && kaabo.measured);
check('the AI wording is gone from that row', kaabo && !/מ-AI/.test(kaabo.notes || ''), kaabo && kaabo.notes);
check('an unknown model is added, not written over an existing one', saved.after.length === 2, saved.after.length);
check('the saved list shows which rows he measured', /נמדד/.test(saved.list), saved.list.slice(0, 70));

if (SELFTEST) console.log('\n[selftest] a second, wrong pitch was injected into the reverse;\n[selftest] the round-trip checks must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
