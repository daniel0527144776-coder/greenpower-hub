// What the site sells has a row in the hub's price list, and a row the supplier list names costs that row (2026-11-14).
//
//   node test/test-site-rows.mjs
//   node test/test-site-rows.mjs --selftest     (the cost found only for the two kinds of name it knew before, and the
//                                                add-on board costed whole)
//
// Found in the big check of 2026-11-14 (Daniel: "כל העלות של כל המוצרים זה באמת נכון ... כל חלק שיש בלוח הבקרה"):
//   - (the Inokim riser and the building materials, site-only until then, went in the same day at his word)
//   - eleven things the site and the business catalogue sell had no row here: the five Votol controllers, the Sabvoton
//     80A and H6-version controllers and the Bluetooth add-on, and JK's premium board, active balancer and display.
//     A sale of one could not be written from the price list, and it had no cost;
//   - the Sur-Ron charger and the board the original display reads are on the supplier list under the very names they
//     are sold under, and were costed at the cost-% of their prices: the cost was looked up by name only for a DHS
//     pack and a BMS board. Any row is looked up by its own name now;
//   - that board is an add-on to a pack whose cost already holds the standard board, so beside the pack it costs its
//     own landed price less the standard board's.
// Every supplier figure below is made up; this repo is public.
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
await new Promise((r) => srv.listen(4407, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4407/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.productEstimate === 'function' && typeof window.supplierQuoteFor === 'function', null, { timeout: 30000 });

const r = await page.evaluate((SELF) => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  if (SELF) {
    const orig = window.supplierQuoteFor;
    window.supplierQuoteFor = (n) => (SUPPLIER_MATCH[n] || /^DHS \S+ \d+V \d+Ah$/.test(n) || /^(DALY|JK|JBD|ANT) \S/.test(n) ? orig(n) : null);
    window.supplierReplacedIls = () => 0;
  }
  const row = (re, cat) => PRICING.find((x) => re.test(x.name) && (!cat || cat.test(x.cat)));
  const names = (cat) => PRICING.filter((x) => x.cat === cat).map((x) => x.name);
  const out = {};
  out.votol = names('בקרים - Votol');
  out.sab = names('בקרים - Sabvoton');
  const jkCat = (PRICING.find((x) => /^BMS - JK פרימיום/.test(x.cat)) || {}).cat;
  out.jk = jkCat ? names(jkCat) : [];
  out.jkTopic = jkCat ? topicOf(jkCat) : null;
  out.boardTopic = topicOf('BMS - DALY');
  const added = PRICING.filter((x) => x.cat === 'בקרים - Votol' || /^BMS - JK פרימיום/.test(x.cat) || /^(SVMC72-80A|SVMC72150 H6 ver|תוספת Bluetooth)/.test(x.name));
  out.priced = added.every((x) => typeof x.retail === 'number' && typeof x.b2b === 'number' && x.b2b < x.retail && Math.abs(x.b2b - x.retail * 0.85) <= 5);
  out.nAdded = added.length;
  out.riser = names('חומרי בנייה ואביזרים - הגבהה לאינוקים');
  out.materials = names('חומרי בנייה ואביזרים - חומרים ומחברים');
  out.partsTopic = ['חומרי בנייה ואביזרים - הגבהה לאינוקים', 'חומרי בנייה ואביזרים - חומרים ומחברים'].map((c) => topicOf(c));
  const xt = PRICING.find((x) => x.name === 'מחבר XT60 (זוג)');
  Store.set('supplier_prices', [{ who: 'ספק דוגמה', cat: 'מחברים', name: 'XT60 Male/Female', ils: 4 }]);
  out.xt60 = xt ? productEstimate(xt) : null;

  const charger = row(/^מטען 15A לסוללת Sur-Ron/), orig = row(/^BMS שהצג המקורי של Ultra Bee קורא.*ADVANCED$/);
  const kt = row(/^KT-LCD3$/), s80 = row(/^SVMC72-80A$/), plain = row(/^KT-LCD5$/);
  out.have = { charger: !!charger, orig: !!orig, kt: !!kt, s80: !!s80, plain: !!plain };
  if (!charger || !orig || !kt || !s80 || !plain) return out;
  const pct = (it) => Math.round(it.retail * COST_PCT / 100);
  Store.set('supplier_prices', []);
  out.chargerNoRow = [productEstimate(charger), pct(charger)];
  Store.set('supplier_prices', [
    { who: 'ספק דוגמה', cat: 'חלקים', name: charger.name, usd: 10, ils: 123 },
    { who: 'ספק דוגמה', cat: 'חלקים', name: orig.name, ils: 400 },
    { who: 'ספק דוגמה', cat: 'צגים', name: 'צג LCD3 KT', ils: 55 },
    { who: 'ספק דוגמה', cat: 'בקרים', name: 'Sabvoton SVMC7280', ils: 77 },
  ]);
  out.charger = productEstimate(charger);
  out.origAlone = productEstimate(orig);
  out.kt = productEstimate(kt);
  out.s80 = productEstimate(s80);
  out.plain = [productEstimate(plain), pct(plain)];
  Store.set('supplier_prices', (Store.get('supplier_prices') || []).concat([{ who: 'ספק דוגמה', cat: 'חלקים', name: 'ANT BMS 450A/1050A לסוללת Sur-Ron', ils: 100 }]));
  out.origBeside = productEstimate(orig);
  out.origHtml = resaleBreakdownHtml(orig).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  Store.set('supplier_prices', []);
  return out;
}, SELFTEST);

check('the five Votol controllers have rows', ['EM50-4', 'EM100s', 'EM150s', 'EM200s', 'EM260s'].every((n) => r.votol.includes(n)), r.votol);
check('the Sabvoton 80A, the H6 version and the Bluetooth add-on have rows', ['SVMC72-80A', 'SVMC72150 H6 ver', 'תוספת Bluetooth לבקר Sabvoton'].every((n) => r.sab.includes(n)), r.sab);
check('JK\'s premium board, active balancer and display have rows', r.jk.length === 3 && r.jk.some((n) => /B2A24S20P-HC/.test(n)) && r.jk.some((n) => /JK-B10A24S/.test(n)) && r.jk.some((n) => /JK-LCD43/.test(n)), r.jk);
check('…under the BMS heading of the price list, with the boards', r.jkTopic && r.jkTopic === r.boardTopic, [r.jkTopic, r.boardTopic]);
check('each of the eleven has a price and a dealer price 15% under it', r.nAdded === 11 && r.priced, r.nAdded);
check('the Inokim riser and the building materials have rows, under their own heading', r.riser.length === 2 && r.materials.length === 7 && r.partsTopic.every((x) => x === '🧱 חומרי בנייה ואביזרים'), [r.riser, r.materials, r.partsTopic]);
check('a connector the supplier list holds costs its row (XT60)', r.xt60 === 4, r.xt60);
check('the rows the cost checks need are in the price list', Object.values(r.have).every(Boolean), r.have);
check('with no row for it, the Sur-Ron charger is the cost-% estimate', r.chargerNoRow && r.chargerNoRow[0] === r.chargerNoRow[1], r.chargerNoRow);
check('listed under the name it is sold under, it costs that row: its landed shekels', r.charger === 123, r.charger);
check('a row the supplier list names otherwise is found through the map (KT-LCD3, SVMC72-80A)', r.kt === 55 && r.s80 === 77, [r.kt, r.s80]);
check('a row the list does not hold stays the cost-% estimate', r.plain && r.plain[0] === r.plain[1], r.plain);
check('the board the original display reads, with no standard board on the list: its own price', r.origAlone === 400, r.origAlone);
check('…and with it: its price less the standard board it replaces', r.origBeside === 300, r.origBeside);
check('…which the breakdown says', /פחות הלוח הרגיל שהוא מחליף/.test(r.origHtml || '') && /300/.test(r.origHtml || ''), r.origHtml);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
