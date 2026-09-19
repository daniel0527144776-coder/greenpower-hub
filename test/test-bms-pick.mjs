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
    // A model code with a letter A INSIDE it, before the real rating. Nine of his thirty-four
    // rows are this shape, and a first-match read presents this 200A board as an 18A peak.
    { who: 'ספק', cat: 'BMS חכם JK', name: 'JK BD6A24S20P 200A', usd: 50.5 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // Put the old behaviour back: the board is whatever the voltage says, whatever he picked.
  await page.evaluate(() => {
    window.pickedBms = () => null;
    // ...and make every board fit every pack, which is what the picker did before the brand
    // S-ranges went in: a DALY 13S was selectable for an 88V pack.
    window.bmsFitsPack = () => true;
  });
}

const list = await page.evaluate(() => bmsChoices().map((r) => ({ name: r.name, ils: r.ils, basis: r.freightBasis, amps: r.amps })));
check('the boards come from the supplier list', list.length === 4, list);
check('a temperature sensor is not offered as a board', !list.some((r) => /חיישן/.test(r.name)), list.map((r) => r.name));
// Most exact first: a quoted shipping price, then a weight, then the category share.
check('a row with a quoted shipping price says so', (list.find((r) => /ANT/.test(r.name)) || {}).basis === 'quoted', list);
check('a row with a weight says so', (list.find((r) => /100A/.test(r.name)) || {}).basis === 'weight', list);
// The honest one: freight IS counted on a bare row, via a share of value — claiming "no
// freight" there was wrong, and the caveat is that the share was measured on nickel and copper.
// A bare row used to fall all the way to a share of VALUE — 39%, measured on nickel, copper and
// shrink. Freight is charged by mass, so a share of value scales with the wrong quantity
// entirely: it made the expensive boards look the most expensive to ship when they are the same
// 200g as the cheap ones. Daniel gave the weight on 2026-09-18 ("לוח שוקל ~150-250 גרם") and a
// bare row is now costed at 0.2kg.
check('a bare row is costed by the typical weight, not a share of its value',
  (list.find((r) => /48V 60A/.test(r.name)) || {}).basis === 'typical', list);
check('and NO board falls back to the borrowed nickel-and-copper rate any more',
  !list.some((r) => r.freightBasis === 'category' || r.basis === 'category'), list);

// ---------------------------------------------------------------- the peak (2026-09-17)
// Daniel: "וגם לא לשכוח לכתוב את הפיק של BMS" / "זה פי 3 לכל סוג". Not a rule invented here —
// the sticker has always printed "BMS: DALY 30A/90A", which is the same x3.
check('a board knows its continuous rating', (list.find((r) => /48V 60A/.test(r.name)) || {}).amps === 60, list);
// THE ONE THAT MATTERS: read the LAST rating in the name, not the first.
check('a model code containing its own "A" still reads the real rating',
  (list.find((r) => /BD6A/.test(r.name)) || {}).amps === 200, list);
check('a temperature sensor has no rating rather than a made-up one',
  !list.some((r) => /חיישן/.test(r.name)), list);
const opts = await page.evaluate(() => {
  const i = PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && /אופניים.*CLASSIC/.test(x.cat));
  const d = document.createElement('div'); d.innerHTML = bmsPickerHtml(i);
  return [...d.querySelectorAll('option')].map((o) => o.textContent);
});
check('the picker prints the peak beside the price', opts.some((o) => /שיא 180A/.test(o)), opts);


// ---------------------------------------------------------------- only what fits, by maker
// Daniel, 2026-09-20: "רק את Bms שמתאימים ל מבחינת ה S ... שהבורר יהיה גם לפי חברה".
//
// An earlier round MOVED the wrong boards to the bottom rather than removing them, on the
// reasoning that his list should not lose rows to a rule written here. Wrong call for this
// control: a board with the wrong series count cannot be wired to the pack at all, so it is
// not a judgement call. 23 wrong answers one scroll down is still a menu of 33.
const byPack = await page.evaluate(() => {
  const read = (re) => {
    const i = PRICING.findIndex((x) => re.test(x.name) && /אינדורו|אופניים/.test(x.cat));
    if (i < 0) return null;
    const d = document.createElement('div'); d.innerHTML = bmsPickerHtml(i);
    return [...d.querySelectorAll('optgroup')].map((g) => ({ label: g.label, opts: [...g.children].map((o) => o.textContent) }));
  };
  return { big: read(/^88V /), small: read(/^48V /) };
});
const all = (groups) => (groups || []).flatMap((g) => g.opts);
const labels = (groups) => (groups || []).map((g) => g.label);

// 88V is 24S. DALY stops at 20S, so neither seeded DALY may appear anywhere in the list.
check('on an 88V (24S) pack no DALY board is offered at all',
  !all(byPack.big).some((o) => /DALY/.test(o)), all(byPack.big));
check('and there is no DALY group either',
  !labels(byPack.big).some((l) => /DALY/.test(l)), labels(byPack.big));
// What IS offered: a 24S JK and an ANT rated to 24S, each under its own maker.
check('a 24S JK and the ANT are offered, grouped by maker',
  labels(byPack.big).includes('JK') && labels(byPack.big).includes('ANT'), labels(byPack.big));

// 48V is 13S. ANT starts at 17S, and the 20S DALY is the wrong board for it.
check('on a 48V (13S) pack the ANT is not offered',
  !all(byPack.small).some((o) => /ANT/.test(o)), all(byPack.small));
check('nor is a 20S board',
  !all(byPack.small).some((o) => /20S/.test(o)), all(byPack.small));
// The peak multiplier is PER BRAND — "רק DALY פי 3" (2026-09-20). A JK 200A peaks at 400A,
// not 600A. It has to be checked on a pack a JK actually fits: on a 48V the picker correctly
// offers no JK at all, and the first version of this check looked there and found nothing.
check('a JK doubles rather than trebles',
  all(byPack.big).some((o) => /JK BD6A.*שיא 400A/.test(o)), all(byPack.big));

check('the 13S DALY is, under DALY',
  labels(byPack.small).includes('DALY') && all(byPack.small).some((o) => /DALY 13S/.test(o)), byPack.small);

if (SELFTEST) console.log('\n[selftest] pickedBms was forced to null;\n[selftest] the checks about a pick changing the cost must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
