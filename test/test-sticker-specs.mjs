// The printed discharge current must never overstate what the pack can deliver.
//
//   node test/test-sticker-specs.mjs [--selftest]
//
// It was computed from the cells alone. A 60Ah CLASSIC pack wired through a DALY 30A
// therefore printed "120A/180A" — the cells' figure, four times what the BMS lets through —
// on the label that carries the warranty. The rule is the lower of the two limits, and a
// BMS with no documented peak gets no peak printed rather than an invented one.
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

console.log('1. the BMS caps the cells');
{
  // 60Ah CLASSIC = 2C/3C = 120A/180A from the cells. A DALY 30A passes 30A/90A.
  const r = await build(volt, cap, classic, 'DALY 30A');
  check('the printed current does not exceed the BMS', r.discharge === (SELFTEST ? 'never' : '30A/90A'), r);
  check('the BMS itself is still shown in full', r.bms === 'DALY 30A/90A', r.bms);
  check('the C-rate still describes the CELLS, not the pack', r.cRate === '2C/3C', r.cRate);
}

console.log('\n2. a BMS bigger than the cells does not inflate them');
{
  // Cells give 120A/180A; a DALY 200A passes 200A/600A. The cells are the limit now.
  const r = await build(volt, cap, classic, 'DALY 200A');
  check('the cells remain the limit', r.discharge === '120A/180A', r);
}

console.log('\n3. each side can bind independently');
{
  // 60Ah of 50PL = 25C/36C = 1500A/2160A of cell. Everything in the list is smaller.
  const r = await build(volt, cap, extreme, 'ANT 80A');
  check('continuous and peak both come from the BMS', r.discharge === '80A/200A', r);
  const mixed = await build(volt, cap, extreme, 'JK 150A');
  check('a different BMS moves both numbers', mixed.discharge === '150A/300A', mixed);
}

console.log('\n4. the label and the sticker agree after a reload');
{
  // refreshComputedSpecDisplay() runs on restored records and recomputes this field. It has
  // its own copy of the logic, and a saved record is exactly where the old figure would
  // otherwise survive — the sticker history is a record of what was PRINTED.
  const r = await p.evaluate(() => {
    const el = (id) => document.getElementById(id);
    window.refreshComputedSpecDisplay(
      ['capacity-value', 'cells-value', 'bms-value'].map((id) => ({ id, innerHTML: el(id).innerHTML })));
    return el('discharge-value').innerText.trim();
  });
  check('a restored record is capped the same way', r === '150A/300A', r);
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
  check('the designed size is kept when it fits', r.normal.size === 24 && r.normal.clearance >= 0, r.normal);
  check('the marks stay on the label under wider metrics',
    r.squeezed.every((s) => s.clearance >= 0), r.squeezed);
  check('nothing stays shrunk once the pressure is gone',
    r.restored.size === 24 && r.restored.clearance >= 0, r.restored);
}

await b.close(); srv.close();
process.exit(finish());
