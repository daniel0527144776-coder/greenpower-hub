// Choosing the BMS per product (2026-09-17).
//
//   node test/test-bms-pick.mjs
//   node test/test-bms-pick.mjs --selftest
//
// The model guessed the board from the VOLTAGE alone. That is how a 48V 20Ah pack came to be
// costed with a ₪150 board it never had, and how an 84V pack with an ANT 420A had no way to say
// so. The picker reads the real rows he buys — 33 boards from DALY 3S 12V 20A to
// JK B2A24S20P 200A — out of the synced supplier list.
//
// THE FIRST CHECK IS THE ONE THAT MATTERS MOST AND HAS NOTHING TO DO WITH PRICING: index.html
// is served to anyone with the URL, so supplier prices must never be baked into it. They live
// in the synced `supplier_prices` key for exactly that reason, and a picker is precisely the
// kind of feature that would tempt someone to inline the list.
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

// ---------------------------------------------------------------- 1. nothing confidential inline
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
// Prices that only appear on the supplier list. If any of these strings is in the served file,
// the list has been baked in.
const SECRET = ['JK B2A24S20P', 'DALY 20S 72V 200A', 'ANT BMS 220A', 'JK BD6A24S20P'];
const leaked = SECRET.filter((s) => html.includes(s));
check('no supplier BMS model name is baked into the public file', leaked.length === 0, leaked);
check('the picker reads the synced key instead', html.includes("Store.get('bms_pick')") && html.includes('supplierRows()'), 'missing');

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4350, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4350/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

// A supplier list of the shape the real import produces. Deliberately mixed: a board with a
// quoted shipping price, one with a weight, one with neither, and a sensor that is not a board.
await page.evaluate(() => {
  localStorage.setItem('gp_supplier_prices', JSON.stringify([
    { who: 'ספק', cat: 'BMS DALY', name: 'DALY 13S 48V 60A', usd: 17 },
    { who: 'ספק', cat: 'BMS DALY', name: 'DALY 20S 72V 100A', usd: 40, kg: 0.6 },
    { who: 'ספק', cat: 'BMS ANT', name: 'ANT 420A 24S', usd: 53, frUsd: 14 },
    { who: 'ספק', cat: 'BMS DALY', name: 'חיישן טמפרטורה ל-DALY', usd: 1 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // Put the old behaviour back: the board is whatever the voltage says, whatever he picked.
  await page.evaluate(() => { window.pickedBms = () => null; });
}

const list = await page.evaluate(() => bmsChoices().map((r) => ({ name: r.name, ils: r.ils, basis: r.freightBasis })));
check('the boards come from the supplier list', list.length === 3, list);
check('a temperature sensor is not offered as a board', !list.some((r) => /חיישן/.test(r.name)), list.map((r) => r.name));
// Most exact first: a quoted shipping price, then a weight, then the category share.
check('a row with a quoted shipping price says so', (list.find((r) => /ANT/.test(r.name)) || {}).basis === 'quoted', list);
check('a row with a weight says so', (list.find((r) => /100A/.test(r.name)) || {}).basis === 'weight', list);
// The honest one: freight IS counted on a bare row, via a share of value — claiming "no
// freight" there was wrong, and the caveat is that the share was measured on nickel and copper.
check('a bare row reports the borrowed category rate, not "no freight"',
  (list.find((r) => /48V 60A/.test(r.name)) || {}).basis === 'category', list);

const effect = await page.evaluate(() => {
  const i = PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && /אופניים.*CLASSIC/.test(x.cat));
  const it = PRICING[i];
  const band = productCost(it, false);
  setBmsPick(i, 'DALY 13S 48V 60A');
  const picked = productCost(it, false);
  const parts = batteryCostParts(it, false);
  const line = parts.parts.find((x) => /BMS/.test(x.k));
  setBmsPick(i, '');
  const cleared = productCost(it, false);
  return { band, picked, cleared, line, stored: Object.keys(Store.get('bms_pick') || {}).length };
});
check('picking a board changes the cost', effect.picked !== effect.band, effect);
check('and the breakdown names the board it used', /DALY 13S 48V 60A/.test((effect.line || {}).k || ''), effect.line);
check('clearing the pick returns to the voltage band', effect.cleared === effect.band, effect);
check('the pick is stored, so it survives a reload and syncs', effect.stored === 0, effect.stored);

// The case that started it: an 84V pack whose board is an ANT, which no voltage band knows about.
const ant = await page.evaluate(() => {
  const i = PRICING.findIndex((x) => /^84V 40Ah$/.test(x.name) && /אינדורו.*PRO/.test(x.cat));
  if (i < 0) return { missing: true };
  const before = productCost(PRICING[i], false);
  setBmsPick(i, 'ANT 420A 24S');
  return { before, after: productCost(PRICING[i], false), retail: PRICING[i].retail };
});
check('the 84V enduro pack exists at all', !ant.missing, ant);
check('and an ANT board moves its cost off the voltage band', !ant.missing && ant.after !== ant.before, ant);

if (SELFTEST) console.log('\n[selftest] pickedBms was forced to null;\n[selftest] the checks about a pick changing the cost must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
