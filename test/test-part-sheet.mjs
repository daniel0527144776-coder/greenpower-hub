// The maker's spec card of each motor and controller in stock (2026-10-30).
//
//   node test/test-part-sheet.mjs
//   node test/test-part-sheet.mjs --selftest     (no part is matched to a sheet — must fail)
//
// Daniel: "לוחצים במלאי, על כל מוצר, מפרט טכני מלא מדויק של כל מוצר". What must hold: every QS motor
// and every Far Driver controller the price list sells, and the two Sabvoton boards QS publishes,
// resolves to its own card, under any of the names it goes by (the price list's, the shelf's, the
// supplier list's); a family sold in more than one size gets a card only when the name says which size,
// and a size the cards do not hold gets none, rather than its sibling's; what has no maker page in hand
// gets no button; the card carries the maker's figures, both of them where the page contradicts itself,
// and no price; a cell keeps its own datasheet; and no native dialog is raised.
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
await new Promise((r) => srv.listen(4368, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4368/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openPartSheet === 'function' && typeof CATALOG !== 'undefined', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.partSheetFor = () => null; window.partSheetKey = () => null; });

// ---- 1. names → cards ----
const N = await page.evaluate(() => {
  const qsMotors = CATALOG.filter((x) => /^מנועים - QS/.test(x.cat)).map((x) => x.name);
  const farDriver = CATALOG.filter((x) => x.cat === 'בקרים - Far Driver').map((x) => x.name);
  const key = (n) => partSheetKey(n);
  return {
    qsMotors: qsMotors.map((n) => [n, key(n)]),
    farDriver: farDriver.map((n) => [n, key(n)]),
    sab: ['SVMC72150', 'SVMC72200', 'SVMC7245', 'SVMC72100'].map((n) => [n, key(n)]),
    // the same models as the shelf and the supplier list write them
    other: ['מנוע QS 273 8000W', 'QS205 3000W V3 + חישוק 18" שזור', 'QS138 70H', 'QS138 4000W 90H', 'QS260 12" 1500W 72V 55KPH', 'QS180 8000W (100H)',
      'Far Driver ND72450 + BT', 'בקר Far Driver ND72450', 'ND72450 | 72V | 150A/450A', 'Sabvoton SVMC72150 + BT', 'QS120 2kW'].map((n) => [n, key(n)]),
    // a name that does not say which, or a size the cards do not hold
    none: ['QS212', 'QS138', 'QS260 13"', 'QS260 12" 2000W', 'QS205 1500W V3', 'QS165 7000W', 'ND724500', 'ND7245',
      'FAT 3000W 48-72V', 'מגנזיום 1000W', '12 Mosfet', 'בקר KT 35A', 'צג DKD (LIN-BUS)', 'QS8 זוג', 'תא 21700 EVE 50E', 'DALY 20S 72V 60A'].map((n) => [n, key(n)]),
    keys: Object.keys(PART_SHEETS),
  };
});
check('every QS motor the price list sells has its card', N.qsMotors.length >= 13 && N.qsMotors.every(([, k]) => k), N.qsMotors);
check('…each its own size: 12" and 13", 1500W to 5000W, 70H and 90H', new Set(N.qsMotors.map(([, k]) => k)).size === N.qsMotors.length - 1
  && N.qsMotors.find(([n]) => n === 'QS260 13" 2000W')[1] === 'qs260-13-2000' && N.qsMotors.find(([n]) => n === 'QS138 4000W (90H)')[1] === 'qs138-90', N.qsMotors);
check('every Far Driver controller the price list sells has its card', N.farDriver.length === 8 && N.farDriver.every(([n, k]) => k === n.toLowerCase()), N.farDriver);
check('the two Sabvoton boards QS publishes have one; SVMC7245 and SVMC72100 none', N.sab.map(([, k]) => k).join() === 'svmc72150,svmc72200,,', N.sab);
check('the same models under the shelf\'s and the supplier list\'s names', N.other.every(([, k]) => k), N.other);
check('a name that does not say which size, or a size without a card, gets none', N.none.every(([, k]) => !k), N.none.filter(([, k]) => k));
check('no card is left unreachable', N.keys.every((k) => [...N.qsMotors, ...N.farDriver, ...N.sab].some(([, x]) => x === k)), N.keys);

// ---- 2. the cards ----
const C = await page.evaluate(() => Object.entries(PART_SHEETS).map(([k, s]) => ({ k, model: s.model, src: s.src, n: s.rows.length, text: s.rows.flat().join(' | ') })));
check('every card has a model, its source and at least seven rows', C.every((c) => c.model && /באתר של QS/.test(c.src) && /2026-10-30/.test(c.src) && c.n >= 7), C.filter((c) => !(c.n >= 7)));
check('no card carries a price', C.every((c) => !/[$₪]|USD|דולר|מחיר/.test(c.text + c.src)), C.filter((c) => /[$₪]|USD|דולר|מחיר/.test(c.text)).map((c) => c.k));
const motorW = await page.evaluate(() => CATALOG.filter((x) => /^מנועים - QS/.test(x.cat)).map((x) => {
  const w = +(x.name.match(/(\d+)W/) || [])[1]; const s = partSheetFor(x.name);
  return { n: x.name, w, ok: !!s && s.rows.some(([k, v]) => /הספק/.test(k) && (v.includes(w.toLocaleString('en-US') + 'W') || v.includes(w + 'W'))) };
}));
check('each motor\'s card states the watts its name sells it at', motorW.every((m) => m.ok), motorW.filter((m) => !m.ok));

// ---- 3. on the stock page ----
const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  Store.set('inventory', [
    { id: 'p1', name: 'QS273 8000W', qty: 1 },
    { id: 'p2', name: 'QS138 3000W (70H)', qty: 1 },
    { id: 'p3', name: 'Far Driver ND72450 + BT', qty: 3 },
    { id: 'p4', name: 'בקר KT 35A', qty: 2 },
    { id: 'p5', name: 'QS212 10"', qty: 1 },
    { id: 'c1', name: 'תא 21700 EVE 50PL', cat: 'תא', qty: 100 },
  ]);
  navigateTo('inventory');
  INV_OPEN.add('הנעה'); INV_OPEN.add('תא'); renderInventory();
  for (let k = 0; k < 400; k++) { const f = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!f) break; f.click(); }
  const btns = [...document.querySelectorAll('#inventoryList [data-part-sheet]')].map((b) => b.getAttribute('onclick'));
  const cells = [...document.querySelectorAll('#inventoryList [data-cell-sheet]')].map((b) => b.getAttribute('onclick'));
  const card = (id) => {
    openPartSheet(id);
    const body = document.getElementById('modalBody');
    const tds = [...body.querySelectorAll('[data-part-row]')];
    const rows = Object.fromEntries(tds.map((td) => [td.dataset.partRow, td.textContent.replace(/[\u2066-\u2069]/g, '')]));
    const raw = Object.fromEntries(tds.map((td) => [td.dataset.partRow, td.textContent]));
    const out = { title: document.getElementById('modalTitle').textContent, rows, raw, text: body.textContent };
    closeModal();
    return out;
  };
  openInvItem('p3');
  const foot = [...document.querySelectorAll('#modalFooter button')].map((b) => b.textContent.trim());
  closeModal();
  openInvItem('p4');
  const footKt = [...document.querySelectorAll('#modalFooter button')].map((b) => b.textContent.trim());
  closeModal();
  return { btns, cells, foot, footKt, q273: card('p1'), q138: card('p2'), nd: card('p3') };
});
check('a motor or controller with a card gets a 📄 on its line; the KT board and the size-less QS212 none',
  r.btns.length === 3 && r.btns.every((b) => /^openPartSheet\('p[123]'\)$/.test(b)), r.btns);
check('…and a 📄 מפרט in its window', r.foot.some((b) => /מפרט/.test(b)) && !r.footKt.some((b) => /מפרט/.test(b)), { nd: r.foot, kt: r.footKt });
check('a cell keeps its own datasheet button', r.cells.length === 1 && /openCellSheet\('c1'\)/.test(r.cells[0]), r.cells);
check('the QS273 card: 8,000W at 72V, ≥203 N·m, 250A in and 600A phase, IP65, 25.5 kg',
  /QS273 8000W V3/.test(r.q273.title) && r.q273.rows['הספק'] === '8,000W נומינלי' && r.q273.rows['מומנט מקסימלי'] === '≥203 N·m'
  && r.q273.rows['זרם שיא'] === '250A כניסה · 600A פאזה' && r.q273.rows['אטימות'] === 'IP65' && /25\.5 ק״ג/.test(r.q273.rows['משקל'] || ''), r.q273);
// A range inside a right-to-left cell came out backwards ("120°C–70") until each run of figures was isolated.
check('a run of figures reads left to right inside the Hebrew: 70–120°C, 182 N·m stays whole, "ב-72V" keeps its hyphen outside',
  r.q273.raw['טמפ׳ עבודה'] === '\u206670–120°C\u2069, שיא \u2066150°C\u2069' && r.q273.raw['מומנט מקסימלי'] === '\u2066≥203 N·m\u2069'
  && r.q138.raw['זרם סוללה'] === '\u206667A\u2069 רציף · \u2066140A\u2069 שיא (ב-\u206672V\u2069)', { t: r.q273.raw['טמפ׳ עבודה'], z: r.q138.raw['זרם סוללה'] });
check('where the page contradicts itself, both figures stay (QS138 70H: 6,000W in its table, 3000W in its name)',
  /6,000W/.test(r.q138.rows['הספק'] || '') && /3000W/.test(r.q138.rows['הספק'] || ''), r.q138.rows['הספק']);
check('the ND72450 card: 72V, 88V peak, 200A DC and 450A phase, 1.94 kg, 189×121×59.7, and its source',
  /ND72450/.test(r.nd.title) && r.nd.rows['מתח'] === '72V נומינלי · 88V שיא' && r.nd.rows['זרם'] === 'DC עד 200A · הגנת פאזה 450A'
  && r.nd.rows['משקל'] === '1.94 ק״ג נטו' && /189×121×59\.7/.test(r.nd.rows['מידות'] || '') && /מקור: דף המוצר באתר של QS/.test(r.nd.text), r.nd);
check('no page errors', errs.length === 0, errs);
check('no native dialogs', dialogs.length === 0, dialogs);

if (SELFTEST) console.log('\n[selftest] no part matched to a card; the checks above must have gone red.');
await browser.close();
srv.close();
process.exit(finish());
