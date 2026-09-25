// The pack calculator's 2026-09-01 rules, driven in a browser.
//
//   node test/test-pack-calc.mjs
//   node test/test-pack-calc.mjs --selftest
//
// Four of these are rules that hold a WRONG answer back rather than producing a right one, and
// all four fail silently: a capacity that cannot be built, a second layer in a scooter tub that
// is one layer deep, a BMS allowance that never moves off its default, and a holder chosen
// because it was first in a list instead of because the pack fits in it.
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
await new Promise((r) => srv.listen(4216, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1100 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4216/index.html');
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  navigateTo('dims');
});
await page.waitForTimeout(200);

const set = (id, v) => page.evaluate(([i, x]) => {
  const el = document.getElementById(i);
  el.value = x;
  calcPackDims();
}, [id, v]);

// ---- 1. capacity is a list, never a typed number ----
const cap = await page.evaluate(() => {
  const el = document.getElementById('dimAh');
  return { tag: el.tagName, opts: [...el.options].slice(0, 4).map((o) => o.textContent.trim()), n: el.options.length };
});
check('capacity is a dropdown, not a free field', cap.tag === 'SELECT', cap.tag);
check('in 5Ah steps, each naming its P and cell count', /^5Ah · \d+P · \d+ תאים/.test(cap.opts[0] || ''), cap.opts[0] || '');
check('and it offers a real range', cap.n >= 8, String(cap.n));

// ---- 2. the BMS allowance follows the voltage until he overrides it ----
await set('dimV', '48');
const at48 = await page.evaluate(() => document.getElementById('dimExtra').value);
await set('dimV', '72');
const at72 = await page.evaluate(() => document.getElementById('dimExtra').value);
check('the case allowance grows with the voltage', +at72 > +at48, `48V=${at48} 72V=${at72}`);
const held = await page.evaluate(() => {
  const el = document.getElementById('dimExtra');
  el.value = '40';
  dimExtraTouched = true;
  document.getElementById('dimV').value = '48';
  calcPackDims();
  return { value: el.value, note: document.getElementById('dimExtraNote').textContent };
});
// A number he typed is a measurement of the case in his hand. Nothing may overwrite it.
check('once he types his own, the voltage stops overwriting it', held.value === '40', held.value);
check('and it says so', /ידני/.test(held.note), held.note);

// ---- 3. layers are DECIDED, not typed (2026-09-25) ----
// Daniel: "תעשה מתי שצריך לקפל את הסוללה ל-2 שכבות אז שאני ידע ולא צריך מספר שכבות". One
// layer whenever one layer takes the pack; a second only on a motorcycle whose tray is too
// small in plan and tall enough for another standing cell; never in a scooter tub.
const stack = await page.evaluate((SELF) => {
  if (SELF) window.stackAllowed = () => false;  // the old behaviour: never folded unless typed
  const r = (name, ah) => { useVehiclePack(name); dimAhPending = ah; calcPackDims(); return document.getElementById('dimResult').innerText; };
  return {
    field: !!document.getElementById('dimLayers'),
    moto40: r('אופנוע שליחויות 72V', 35),    // 20S7P: seven across a 170mm tray, twenty rows along
    moto50: r('אופנוע שליחויות 72V', 50),    // 200 cells: two layers, the box is 170mm deep
    fc1: r('Bomber FC-1 48V', 50),            // 280x75 floor, 150mm deep: stacks
    scooter: r('Inokim OX', 50),              // 200 cells in a scooter tub: never stacked
  };
}, SELFTEST);
check('there is no layers field to type into', !stack.field, stack.field);
check('a pack that fits one layer is not folded', /✅/.test(stack.moto40) && !/שכבות/.test(stack.moto40), stack.moto40.slice(0, 90));
check('one that does not is folded, and the page says so', /בקיפול ל-2 שכבות/.test(stack.moto50), stack.moto50.slice(0, 90));
check('and the layout names the S per layer', /2 שכבות, בכל שכבה 10S/.test(stack.moto50), stack.moto50.slice(0, 260));
check('a tall motorcycle frame stacks as far as its height allows', /שכבות/.test(stack.fc1), stack.fc1.slice(0, 90));
check('a scooter tub is never folded', /⛔/.test(stack.scooter) && !/בקיפול/.test(stack.scooter), stack.scooter.slice(0, 90));

// ---- 4. which nickel, and it must be the densest that FITS ----
const rec = await page.evaluate(() => {
  // The OX is the one row with a measured tub, so the recommendation has something real to
  // fit into rather than an estimate.
  useVehiclePack('Inokim OX');
  calcPackDims();
  const html = document.getElementById('dimResult').innerHTML;
  const order = HOLDER_ORDER.slice();
  return { html, order };
});
check('the densest holder is tried first', rec.order[0] === 'diag-b', rec.order.join(','));
check('a recommendation is shown', /מומלץ|אף מחזיק/.test(rec.html), rec.html.slice(0, 80).replace(/<[^>]*>/g, ''));
// Densest FIRST is only right if it also has to fit: a recommendation that ignores whether the
// pack goes in is just the first item of a list.
// 140 cells in the OX: he counted 126 on the 21.5 nickel, 136 on the 22.5 and 140 on the square.
// Densest FIRST is only right if it also has to fit — so the recommendation is the square.
check('and it only recommends one that fits', /מומלץ: ריבועי 23/.test(rec.html), rec.html.replace(/<[^>]*>/g, '').slice(-120));

// ---- 4b. the tray HEIGHT, which was stored and never read until 2026-09-22 ----
// A 21700 is 70.15mm long. A tray shallower than that cannot take a standing cell, and the
// page used to recommend a holder for it anyway.
const heights = await page.evaluate(() => {
  const read = (name) => {
    useVehiclePack(name);
    calcPackDims();
    return document.getElementById('dimResult').innerHTML;
  };
  // Zero 11X at 60V: the 18650 stands in its 70mm tray and sixteen rows reach along it. At 72V
  // twenty rows are 375mm against a 360mm tray, so there it must say the LENGTH is short.
  const read60 = (name) => { useVehiclePack(name, 60); calcPackDims(); return document.getElementById('dimResult').innerHTML; };
  return { shallow: read('Zero 10X'), mid: read60('Zero 11X'), mid72: read('Zero 11X'), deep: read('Nami Klima'), compound: read('Inokim OX') };
});
check('a shallow tray refuses the cell outright', /לא נכנס לאמבטיה/.test(heights.shallow),
  heights.shallow.replace(/<[^>]*>/g, '').slice(0, 90));
// No lying arrangement exists any more — he builds with the cells standing on a terminal
// (2026-09-23). A tray too short for the cell simply cannot take it.
check('and never offers to lay them down', !/שוכב/.test(heights.shallow),
  heights.shallow.replace(/<[^>]*>/g, '').slice(0, 120));
check('a deep enough tray is left alone', !/לא נכנס לאמבטיה/.test(heights.deep) && /מומלץ|אף מחזיק/.test(heights.deep),
  heights.deep.replace(/<[^>]*>/g, '').slice(0, 90));
// '425×165 + 60×140' is two rectangles, not L×W×H. Reading a loose third number out of it
// invented a 60mm ceiling and hid this row's recommendation — it shipped that way for one run.
check('a compound tub has no height read from it', !/לא נכנס לאמבטיה/.test(heights.compound),
  heights.compound.replace(/<[^>]*>/g, '').slice(0, 90));

// ---- 4c. the 18650 offer that comes with a shallow tray ----
// An 18650 is 65mm against the 21700's 70.15, so it stands where the 21700 cannot — and where
// neither stands, the smaller diameter still fits more across and more up.
check('a 70mm tray offers the 18650 builds', /אפשרויות 18650/.test(heights.mid),
  heights.shallow.replace(/<[^>]*>/g, '').slice(-140));
check('and names both cells where one fits', /EVE 26V/.test(heights.mid) && /EVE 25P/.test(heights.mid),
  heights.shallow.replace(/<[^>]*>/g, '').slice(-140));
// The margin is read off the live price list. When that lookup fails the page says so instead
// of inventing a number — which is honest, and was also the bug: the field is retail, not
// price, so every reference row read undefined.
// The Zero 10X is 58mm: nothing stands in it, so the block says that instead of pricing.
check('where the 18650 stands but the string does not reach, it says the length', /לא נכנס לאורך המגש/.test(heights.mid72) && !/לא עומד/.test(heights.mid72),
  heights.mid72.replace(/<[^>]*>/g, '').slice(-140));
check('and says so when no cell stands at all', /גם תא 18650 לא עומד/.test(heights.shallow),
  heights.shallow.replace(/<[^>]*>/g, '').slice(-140));
check('a deep tray is not offered 18650s', !/אפשרויות 18650/.test(heights.deep),
  heights.deep.replace(/<[^>]*>/g, '').slice(-110));

// ---- 5. over capacity warns, and does not block ----
const over = await page.evaluate(() => {
  useVehiclePack('Zero 10X');
  const sel = document.getElementById('dimAh');
  sel.value = String(+sel.options[sel.options.length - 1].value);
  calcPackDims();
  const res = document.getElementById('dimResult');
  return { warn: !!res.querySelector('.dim-over'), stillComputed: /תצורה/.test(res.textContent), text: res.textContent.slice(0, 60) };
});
check('going over the ceiling warns loudly', over.warn, String(over.warn));
// Most of those ceilings are AI estimates. Refusing to compute on the strength of a guess
// would stop a build that is genuinely possible - his call, warn hard and let him through.
check('but the pack is still computed', over.stillComputed, over.text);

// ---- 6. the side view ----
const side = await page.evaluate(() => {
  useVehiclePack('Sur-Ron');
  calcPackDims();
  const d = document.getElementById('dimDraw');
  return { svgs: d.querySelectorAll('svg').length, hasSide: /מבט מהצד/.test(d.textContent),
    hasBms: /BMS/.test(d.textContent), hasSideFn: typeof window.sideElevation === 'function' };
});
// The side elevation was REMOVED on 2026-09-22 (Daniel asked for it gone). These assert its
// absence rather than being deleted: a half-removed drawing leaves a live call to a function
// that no longer exists, which fails in the console and not on screen — the same reason the
// quick-pricer test was rewritten to check the feature is gone instead of dropping its checks.
check('the drawing still shows the plan view', side.svgs >= 1, String(side.svgs));
check('the side elevation is gone', !side.hasSide, String(side.hasSide));
check('and nothing calls the function that drew it', !side.hasSideFn, String(side.hasSideFn));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
