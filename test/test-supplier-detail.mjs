// A supplier row opens what its cost is made of, and the list shows each item's newest price (2026-11-16).
//
//   node test/test-supplier-detail.mjs [--selftest]
//
// Daniel: "שאני אלחץ על כל דבר, על כל מוצר ... פירוט כאילו של כמה זה עלה לי וחישוב של איך זה עלה לי ... מאיפה לקחת את
// המידע ... אני רוצה שיש את העלות המעודכנת האחרונה, שזה לא העלות שלפני שנתיים". What must hold, on made-up rows:
//   - an item quoted twice (an old invoice from one supplier, a newer one from another) is ONE line, at the newer price,
//     the price the price list is costed at too;
//   - tapping it opens the cost, a sum whose lines add up to that cost, the source and its day, the older quote under
//     "מחירים קודמים", and the price-list item it costs;
//   - a price with no day, or over a year old, says so;
//   - a row he adds by hand carries the day he added it.
// --selftest drops the freight line from the sum and turns the newest-first order around, and must fail.
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(DIST, u === '/index.html' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4442, r));

const { check, finish } = checker();
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
p.on('dialog', async (d) => { await d.dismiss().catch(() => {}); });
await p.goto('http://127.0.0.1:4442/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof window.openSupDetail === 'function' && typeof window.renderSupplier === 'function');

const r = await p.evaluate((SELF) => {
  if (SELF) {
    const keep = window.supCalcLines;
    window.supCalcLines = (row) => keep(row).filter(([t]) => !/^משלוח/.test(t));
    window.supNewestFirst = (a, b) => String(a.on || '').localeCompare(String(b.on || ''));
  }
  // Made up: two suppliers "ספק א" / "ספק ב", one display quoted by both; a landed cell; an undated board; an old part.
  Store.set('supplier_prices', [
    { who: 'ספק א', cat: 'ספק א · צגים', name: 'צג DKD (LIN-BUS)', usd: 34, kg: 0.5, src: 'חשבונית', on: '2025-04-02' },
    { who: 'ספק ב', cat: 'ספק ב · צגים', name: 'צג DKD (LIN-BUS)', usd: 22.97, kg: 0.5, src: 'חשבונית דוגמה', on: '2026-10-29' },
    { who: 'ספק תאים', cat: 'ספק תאים · 21700 · 🚢 ימי', name: 'תא דוגמה 50E', ils: 5.83, on: '2026-09-24', src: 'יבוא ימי דוגמה' },
    { who: 'ספק רכיבים', cat: 'BMS DALY', name: 'לוח דוגמה 13S 40A', usd: 12 },
    { who: 'ספק רכיבים', cat: 'כלי עבודה', name: 'פריט ישן דוגמה', usd: 10, on: '2022-03-10', src: 'ציטוט' },
  ]);
  Store.set('supplier_costs', []);
  navigateTo('supplier');
  setSupWho(-1);
  supExpandAll(true);
  const lines = [...document.querySelectorAll('#supplierList .sup-line')];
  const dkd = lines.filter((l) => /צג DKD/.test(l.textContent));
  const dkdPrice = dkd.length ? dkd[0].querySelector('.sup-price').textContent.replace(/[^\d₪.]/g, '') : '';
  const newestCost = fmtIls(supplierIls({ who: 'ספק ב', cat: 'ספק ב · צגים', usd: 22.97, kg: 0.5 }, true, true));
  const costed = supplierCostFor('DKD (LIN-BUS)');
  // open the display's detail as a person would
  if (dkd[0]) dkd[0].click();
  const modal = () => document.querySelector('.modal-overlay.active, .modal.active, #modal, .modal-backdrop') || document.body;
  const body = (document.getElementById('modalBody') || modal()).innerText;
  const rows = [...document.querySelectorAll('.supd-row:not(.supd-sum):not(.supd-old) b')].map((e) => e.textContent).filter((t) => /^₪/.test(t));
  const sum = (document.querySelector('.supd-sum b') || {}).textContent || '';
  const add = rows.reduce((s, t) => s + parseFloat(t.slice(1)), 0);
  closeModal();
  const openByName = (re) => { const l = [...document.querySelectorAll('#supplierList .sup-line')].find((x) => re.test(x.textContent)); if (!l) return ''; l.click(); const t = (document.getElementById('modalBody') || document.body).innerText; closeModal(); return t; };
  const undated = openByName(/לוח דוגמה 13S/);
  const old = openByName(/פריט ישן דוגמה/);
  const cell = openByName(/תא דוגמה 50E/);
  // a row added by hand carries its day
  openSupplierAdd();
  document.getElementById('scWho').value = 'ספק דוגמה';
  document.getElementById('scName').value = 'פריט שלי דוגמה';
  document.getElementById('scIls').value = '12';
  saveSupplierRow();
  const mine = (Store.get('supplier_costs') || [])[0] || {};
  return { lines: lines.length, dkdLines: dkd.length, dkdPrice, newestCost, costed, body, rows, sum, add, undated, old, cell, mine, today: new Date().toISOString().slice(0, 10) };
}, SELFTEST);

check('an item quoted by two suppliers is one line', r.dkdLines === 1, r.dkdLines);
check('…at the newer price, the price it is costed at', r.dkdPrice === r.newestCost && '₪' + r.costed === r.newestCost, { shown: r.dkdPrice, newest: r.newestCost, costed: r.costed });
check('its detail shows the cost, and a sum whose lines add up to it', r.sum === r.newestCost && Math.abs(r.add - parseFloat(r.sum.slice(1))) <= 1 && r.rows.length >= 2, { rows: r.rows, sum: r.sum });
check('…how it was reckoned: the dollar price at the rate, the freight by weight', /מחיר הספק: \$22\.97 × 3/.test(r.body) && /משלוח: 0\.5 ק"ג/.test(r.body), r.body.slice(0, 300));
check('…where the price came from and on what day', /חשבונית דוגמה/.test(r.body) && /29\.10\.2026/.test(r.body) && /ספק ב/.test(r.body), r.body.slice(0, 400));
check('…the older quote under "מחירים קודמים", not in use', /מחירים קודמים/.test(r.body) && /ספק א · 2\.4\.2025/.test(r.body), r.body);
check('…and the price-list item it costs', /העלות של/.test(r.body) && /DKD \(LIN-BUS\)/.test(r.body.slice(r.body.lastIndexOf('העלות של\n'))), r.body.slice(-200));
check('a price with no day says so', /אין תאריך/.test(r.undated) && /משלוח: 0\.2 ק"ג \(משקל משוער\)/.test(r.undated), r.undated);
check('a price over a year old says how old, and to ask again', /מלפני 4 שנים/.test(r.old) && /משלוח: \d+% ממחיר הסחורה/.test(r.old), r.old);
check('a landed price is its own line, with its source', /כפי שנרשמה/.test(r.cell) && /יבוא ימי דוגמה/.test(r.cell) && /24\.9\.2026/.test(r.cell), r.cell);
check('a row added by hand carries the day it was added', r.mine.on === r.today && r.mine.src === 'הוספת בעצמך', r.mine);
check('no page errors', errs.length === 0, errs);

await b.close(); srv.close();
if (SELFTEST) console.log('\n[selftest] the freight line dropped from the sum and the order turned oldest first: the checks above must have gone red.');
const code = finish();
process.exit(SELFTEST ? (code ? 0 : 1) : code);
