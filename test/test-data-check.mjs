// The data check — the sweep that runs on HIS records (2026-09-19).
//
//   node test/test-data-check.mjs
//   node test/test-data-check.mjs --selftest
//
// Daniel: "יש אפשרות לעשות סריקה איטית על כל המערכת כדי למצוא בעיות?"
//
// Every suite here drives the hub with records this repo invents, so they find defects in the
// CODE. None of them can find a sale marked paid with no items, stock that has gone negative,
// or a month with work and no expenses — those live in his database, which nobody here can see.
//
// So this suite plants each of those faults and checks the sweep NAMES them. Counting them is
// not enough: a report that says "3 problems" sends him looking through a year of records, and
// one that says "שרה · 7.9.2026" sends him to the row.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4355, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4355/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

// Records with one of each fault planted, plus clean ones so a sweep that flags everything
// cannot pass either.
const report = await page.evaluate((selftest) => {
  const d = (n) => new Date(2026, 8, n, 12).toISOString();
  Store.set('customers', [{ name: 'דוד לוי', phone: '0501111111' }]);
  Store.set('jobs', [
    { id: 'a', customerName: 'דוד לוי', customerPhone: '0501111111', date: d(3), price: 1200, cost: 700 },
    { id: 'b', customerName: 'יוסי', customerPhone: '0509999999', date: d(4), price: 800, cost: 0 },
    { id: 'c', customerName: 'ללא', customerPhone: '0501111111', date: d(5), price: 0, cost: 0 },
  ]);
  Store.set('orders', [
    { id: 'o1', customer: 'דוד לוי', date: d(6), status: 'נמסר', items: [], total: 1400 },
    { id: 'o2', customer: 'שרה', date: d(7), status: 'שולם', items: [{ name: 'x', qty: 1, price: 0 }], total: 0 },
    { id: 'o3', customer: 'מיכאל אבוטבול', date: d(8), status: 'הצעה', items: [], total: 0 },
  ]);
  Store.set('inventory', [{ name: 'EVE 50E', qty: -15 }, { name: 'BMS 13S 60A', qty: 0 }, { name: 'ניקל', qty: 200 }]);
  Store.set('expenses', []);
  if (selftest) {
    // The sweep this replaced: count the problems instead of naming them. A number sends him
    // through a year of records; a name sends him to the row.
    window.runDataCheck = function () {
      openModal('בדיקת נתונים', '<div>נמצאו 8 בעיות.</div>',
        '<button class="btn btn-secondary" onclick="closeModal()">סגור</button>');
    };
  }
  runDataCheck();
  // Read the MODAL, not document.body.innerText — the overlay is not always picked up by
  // it, which is how an earlier suite reported a perfectly healthy hub as broken.
  const m = document.getElementById('modalBackdrop') || document.querySelector('.modal');
  return (m ? m.innerText : '') + '\n' + document.body.innerText;
}, SELFTEST);

// ---------------------------------------------------------------- each fault, NAMED
const named = (label, needle) => check(label, report.includes(needle), needle);
named('a job with no price is named by customer and date', 'ללא · 5.9.2026');
named('a delivered sale with no items is named', 'דוד לוי · 6.9.2026');
named('a paid sale of ₪0 is named', 'שרה · 7.9.2026');
named('a job with a price and no cost is named, with the inflated figure', 'יוסי · 4.9.2026 · ₪800');
named('a job whose customer is not in the list is named, with the phone', '0509999999');
named('stock that has gone negative is named, with the number', 'EVE 50E · -15');
named('an item that has run out is named', 'BMS 13S 60A');
named('a month with work and no expenses is named', '2026-09');

// ---------------------------------------------------------------- and what it must NOT say
check('a healthy job is not flagged', !report.includes('דוד לוי · 3.9.2026'), report.slice(0, 200));
// A quote is not money, so a quote with no items is not a fault.
check('an unpaid quote with no items is not flagged', !report.includes('מיכאל אבוטבול'), report.slice(0, 200));
check('stock that is simply in hand is not flagged', !report.includes('ניקל'), report.slice(0, 200));

// ---------------------------------------------------------------- it says what it looked at
// Three of each: the quote counts as a sale it looked at, even though it is not a fault.
check('it says how much it went through', /3 תיקונים/.test(report) && /3 מכירות/.test(report), null);
check('and that it changes nothing', /לא משנה כלום/.test(report), null);

if (SELFTEST) console.log('\n[selftest] the sweep was replaced by one that COUNTS instead of naming;\n[selftest] every "is named" check above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
