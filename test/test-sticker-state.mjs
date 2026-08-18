// Proves a template change actually REACHES a device that already has a saved layout.
// The editor persists each editable element's innerHTML along with its geometry and writes
// it back over the markup on load, so before versioning, an edit to the sticker was
// invisible forever on any device that had ever saved — deployed, verified live, and still
// showing the old text on the owner's phone.
//
//   node test/test-sticker-state.mjs [--selftest]
//
// --selftest asserts the opposite outcome so the check can be watched failing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// CI installs playwright; locally nothing is installed for the hub, so fall back to the
// copy the retail site already carries rather than duplicating a browser download.
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const VERSION = (fs.readFileSync(path.join(DIST, 'stickers.html'), 'utf8')
  .match(/STICKER_TEMPLATE_VERSION = '([^']+)'/) || [])[1];
if (!VERSION) { console.log('could not read STICKER_TEMPLATE_VERSION from the template'); process.exit(1); }
// What #manufacturer-info says in the markup, normalised the way textContent would give it.
// Read from the template rather than typed here: this block has changed on almost every
// round (address, sizes, tagline), and a hardcoded copy would fail on each one while the
// mechanism under test was fine.
const TEMPLATE_MFG = (() => {
  const html = fs.readFileSync(path.join(DIST, 'stickers.html'), 'utf8');
  const m = html.match(/<div id="manufacturer-info"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
})();
if (!TEMPLATE_MFG) { console.log('could not read #manufacturer-info from the template'); process.exit(1); }
console.log('template version:', VERSION);
console.log('manufacturer    :', TEMPLATE_MFG);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(4188, r));

let fails = 0;
const check = (label, ok, got) => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${got !== undefined ? ` — ${JSON.stringify(got)}` : ''}`); fails++; } };

const b = await chromium.launch();

// A device carrying the PRE-versioning format (a bare array), holding the old address,
// the old 10px labels and the old standards line.
const stale = [
  { id: 'manufacturer-info', transform: '', width: '', height: '', fontSize: '', fontWeight: '', textAlign: '',
    innerHTML: '<p class="font-black text-2xl mb-1">מעבדת Green Power</p><p class="text-xl">עובדיה מברטנורא 12, אלעד, ישראל</p><p class="text-xl">053-3224879 | Made in Israel</p>' },
  { id: 'standard-info', transform: '', width: '', height: '', fontSize: '', fontWeight: '', textAlign: '',
    innerHTML: 'מיוצר בהתאם לתקן IEC 62133, תקן הבטיחות המחמיר בעולם לסוללות ליתיום.' },
  { id: 'label-capacity', transform: '', width: '', height: '', fontSize: '10px', fontWeight: '900', textAlign: '', manualFontSize: true, innerHTML: 'קיבולת:' },
];

console.log('\n1. a device with the OLD saved format opens the editor');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript((s) => localStorage.setItem('stickerElementStates', s), JSON.stringify(stale));
  await p.goto('http://127.0.0.1:4188/stickers.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#sticker-to-capture');
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => ({
    mfg: document.getElementById('manufacturer-info').textContent.replace(/\s+/g, ' ').trim(),
    labelPx: Math.round(parseFloat(getComputedStyle(document.getElementById('label-capacity')).fontSize)),
    stored: localStorage.getItem('stickerElementStates'),
  }));
  check('the new address is shown, not the saved old one', r.mfg.includes('ניסים גאון 6') && !r.mfg.includes('מברטנורא'), r.mfg);
  check("the template's manufacturer block wins over the save", r.mfg === TEMPLATE_MFG, { rendered: r.mfg, template: TEMPLATE_MFG });
  check('the saved 10px label did not come back', r.labelPx > (SELFTEST ? 999 : 12), r.labelPx);
  check('the stale entry was dropped from storage', r.stored === null, r.stored && r.stored.slice(0, 40));
  await ctx.close();
}

console.log('\n2. a save made by THIS version is still restored');
{
  // Written in the current format rather than by calling saveElementStates(), which lives
  // inside the page's DOMContentLoaded scope and is not reachable from here. The load path
  // is what this asserts, and it is the half that decides whether an edit survives.
  const mine = { v: VERSION, elements: [{
    id: 'qr-title', transform: '', width: '', height: '', fontSize: '', fontWeight: '', textAlign: '',
    innerHTML: 'טקסט שהמשתמש ערך' }] };
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript((s) => localStorage.setItem('stickerElementStates', s), JSON.stringify(mine));
  await p.goto('http://127.0.0.1:4188/stickers.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#sticker-to-capture');
  await p.waitForTimeout(1800);
  const after = await p.evaluate(() => ({
    edited: document.getElementById('qr-title').textContent.trim(),
    kept: localStorage.getItem('stickerElementStates') !== null,
  }));
  check("the user's own edit survives a reload", after.edited === 'טקסט שהמשתמש ערך', after.edited);
  check('and its storage entry is kept', after.kept);
  await ctx.close();
}

await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
