// What the sticker prints for זרם פריקה, and what it must keep printing.
//
//   node test/test-sticker-specs.mjs [--selftest]
//
// The figure is the CELLS' — capacity × C-rate — and it deliberately ignores the BMS. It
// was capped at min(cells, BMS) on 2026-08-19 and Daniel reverted it the same day: "תחזיר
// בחזרה את התיקון... אני לא רוצה לתקן אותו". This file exists so the next person to notice
// that a 60Ah CLASSIC through a DALY 30A prints 120A/180A finds a red test instead of an
// invitation. It has been found, fixed, and undone on purpose.
//
// Section 5 is unrelated and load-bearing: the safety marks must stay on the label.
//
// --selftest asserts the opposite outcome so the check can be watched failing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(4189, r));

const { check, finish } = checker();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4189/stickers.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof window.updateAllSpecs === 'function', { timeout: 20000 });

// Drive the real dropdowns and read the real label, rather than calling the helper: the
// bug was not in the arithmetic, it was that nothing applied the BMS to it.
const build = (volt, cap, cell, bms) => p.evaluate(([volt, cap, cell, bms]) => {
  const set = (id, val) => {
    const s = document.getElementById(id);
    const o = [...s.options].find((x) => x.value === val || x.text === val);
    if (!o) throw new Error(`no option ${val} in #${id}`);
    s.value = o.value; s.selectedIndex = o.index;
  };
  set('voltage-select', volt); set('capacity-select', cap);
  set('cells-select', cell); set('bms-select', bms);
  window.updateAllSpecs();
  return {
    discharge: document.getElementById('discharge-value').innerText.trim(),
    bms: document.getElementById('bms-value').innerText.trim(),
    cRate: document.getElementById('c-rate-value').innerText.trim(),
  };
}, [volt, cap, cell, bms]);

const opts = await p.evaluate(() => ({
  caps: [...document.getElementById('capacity-select').options].map((o) => o.value),
  cells: [...document.getElementById('cells-select').options].map((o) => o.value),
  volts: [...document.getElementById('voltage-select').options].map((o) => o.value),
}));
const cap = opts.caps.includes('60') ? '60' : opts.caps[Math.floor(opts.caps.length / 2)];
const volt = opts.volts.includes('72') ? '72' : opts.volts[0];
const classic = opts.cells.find((c) => c.includes('50E'));
const extreme = opts.cells.find((c) => c.includes('50PL'));
console.log(`using ${volt}V ${cap}Ah · cells ${classic} / ${extreme}\n`);

console.log('1. the figure is capacity x C-rate');
{
  // 60Ah CLASSIC = 2C/3C.
  const r = await build(volt, cap, classic, 'DALY 30A');
  check('it is the cells figure', r.discharge === (SELFTEST ? 'never' : '120A/180A'), r);
  check('the BMS is shown in full alongside it', r.bms === 'DALY 30A/90A', r.bms);
  check('the C-rate describes the cells', r.cRate === '2C/3C', r.cRate);
}

console.log('\n2. the BMS does not change it — in either direction');
{
  // A DALY 30A passes far less than the cells give; a DALY 200A far more. The printed
  // number is the same in both cases, and that is the intended behaviour.
  const small = await build(volt, cap, classic, 'DALY 30A');
  const large = await build(volt, cap, classic, 'DALY 200A');
  check('a smaller BMS does not lower it', small.discharge === '120A/180A', small);
  check('a larger BMS does not raise it', large.discharge === '120A/180A', large);
}

console.log('\n3. a different cell moves it, and only the cell does');
{
  // 60Ah of 50PL = 25C/36C.
  const r = await build(volt, cap, extreme, 'ANT 80A');
  check('the extreme cell gives its own figure', r.discharge === '1500A/2160A', r);
  const mixed = await build(volt, cap, extreme, 'JK 150A');
  check('changing only the BMS changes nothing', mixed.discharge === r.discharge, mixed);
}

console.log('\n4. a restored record recomputes it the same way');
{
  // refreshComputedSpecDisplay() runs on restored records and has its own copy of this
  // arithmetic. The two have disagreed before, and sticker history is a record of what was
  // actually printed — a restore that quietly changes the number is a falsified record.
  const r = await p.evaluate(() => {
    const el = (id) => document.getElementById(id);
    window.refreshComputedSpecDisplay(
      ['capacity-value', 'cells-value', 'bms-value'].map((id) => ({ id, innerHTML: el(id).innerHTML })));
    return el('discharge-value').innerText.trim();
  });
  check('the restore path agrees with the build path', r === '1500A/2160A', r);
}

console.log('\n5. the safety marks cannot be pushed off the label');
{
  // The left column had 8px of slack, and the same markup that measured +16px of clearance
  // here overflowed by 4px on a Linux runner — a difference in text metrics, not in the
  // page. The marks are what falls off, and they are the part a battery label must keep.
  // Narrowing the column reproduces wider metrics on demand: same font, one more line.
  const r = await p.evaluate(() => {
    const marks = document.getElementById('icon-placeholder-1');
    const col = marks.closest('#sticker-to-capture > div');
    const sticker = document.getElementById('sticker-to-capture');
    const tag = document.querySelector('#manufacturer-info p');
    const state = () => ({
      clearance: Math.round(sticker.getBoundingClientRect().bottom - marks.getBoundingClientRect().bottom),
      size: Math.round(parseFloat(getComputedStyle(tag).fontSize)),
    });
    window.fitSideColumn();
    const normal = state();
    const orig = col.style.width;
    const squeezed = [0.94, 0.88, 0.82].map((pct) => {
      col.style.width = Math.round(col.clientWidth * pct) + 'px';
      window.fitSideColumn();
      const s = state();
      col.style.width = orig;
      return { pct, ...s };
    });
    window.fitSideColumn();
    return { normal, squeezed, restored: state() };
  });
  console.log(`     normal ${JSON.stringify(r.normal)}  squeezed ${JSON.stringify(r.squeezed)}`);
  // The literal 24 is gone from these three checks, and that is a real change rather than a
  // test being bent to fit. The manufacturer block used to be 15px WIDER than its column —
  // the phone line is whitespace-nowrap and simply hung out over the edge of the sticker —
  // and that stolen width is what let the tagline wrap in three lines at 24px. Fixing the
  // overflow (fitNoWrapLines) gave the block its real width back, the tagline needs four
  // lines in it, and the fitter gives back 3px so the safety marks stay on the label.
  //
  // What these checks protect is unchanged, and it is not a number: the fitter must keep the
  // designed size when it fits, shrink ONLY under pressure, and grow back when the pressure
  // lifts. 4bdc8ae shrank the whole label unconditionally and made it worse; that is the
  // regression being guarded against, not a particular font size.
  check('the marks stay on the label at rest', r.normal.clearance >= 0, r.normal);
  check('the marks stay on the label under wider metrics',
    r.squeezed.every((s) => s.clearance >= 0), r.squeezed);
  check('it is not shrinking to the floor for no reason',
    r.normal.size > Math.min(...r.squeezed.map((s) => s.size)) || r.normal.size >= 21, r);
  check('nothing stays shrunk once the pressure is gone',
    r.restored.size === r.normal.size && r.restored.clearance >= 0, r.restored);
}

await b.close(); srv.close();
process.exit(finish());
