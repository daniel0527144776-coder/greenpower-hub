// The one customer picker, in both places that need it.
//
//   node test/test-customer-picker.mjs
//   node test/test-customer-picker.mjs --selftest
//
// The accountant's import put 144 names into `customers`, most of them from 2019-2023. Two
// things were wrong with that and neither showed as an error:
//
//   * the sales editor had NO picker — a repeat customer was retyped, and one typo in the
//     phone made a second customer out of the same person, which is precisely the duplicate
//     the import was written to avoid creating;
//   * the calculator had one, but it never refreshed after the import, so 144 customers
//     landed in storage and appeared nowhere until the app was reloaded. An import that
//     worked looked exactly like an import that had not.
//
// The checks below lean on the two properties a screenshot cannot show: that a customer
// buried 100 rows deep by date is still reachable BY NAME, and that picking a business
// customer reprices the lines already on the order.
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4207, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
// Recorded, never accepted. alert/confirm are replaced by an in-page notice because the
// WebView shows neither, so a real dialog reaching the browser is itself the defect.
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4207/index.html');

// 3 recent customers he typed, plus 40 old ones shaped like the accountant's rows — enough
// that the oldest are well past the 20 the picker shows unsearched.
const OLD = 'אבנר קדוש';      // 40 visits ago, and one of the 27 with no phone on file
const BIZ = 'קורקינטים ברמה';  // a business, 30 visits ago
await page.evaluate(({ OLD, BIZ }) => {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const rows = [
    { id: 'c1', name: 'רון מזרחי', phone: '0501111111', lastVisit: day(1), isBusiness: false },
    { id: 'c2', name: 'שירה לוי', phone: '0502222222', lastVisit: day(2), isBusiness: false },
    { id: 'c3', name: 'דוד כהן', phone: '0503333333', lastVisit: day(3), isBusiness: false },
  ];
  for (let i = 0; i < 40; i++) {
    rows.push({ id: 'b' + i, name: 'לקוח ותיק ' + i, phone: '05' + String(40000000 + i), city: 'אלעד',
      lastVisit: day(100 + i), firstVisit: day(400 + i), isBusiness: false, src: 'books' });
  }
  rows.push({ id: 'bz', name: BIZ, businessName: BIZ, phone: '0549954395', vatId: '33660234',
    city: 'תל אביב', lastVisit: day(30), isBusiness: true, src: 'books' });
  rows.push({ id: 'np', name: OLD, phone: '', city: 'ירכא', lastVisit: day(220), isBusiness: false, src: 'books' });
  localStorage.setItem('gp_customers', JSON.stringify(rows));
  localStorage.setItem('gp_jobs', '[]');
  localStorage.setItem('gp_orders', '[]');
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
}, { OLD, BIZ });
await page.waitForTimeout(300);

// The selftest reinstates the real bug: a picker that searches only the 20 rows it is
// already showing. The box fills, scrolls and highlights exactly as it does now — and every
// imported name older than the twentieth is unreachable, which is the whole point of this
// file.
//
// The first version of this selftest capped the SEARCH result at 20 and stayed green: a
// search for one name returns one row, and slicing one row to twenty changes nothing. It
// read as proof the suite could fail while proving nothing at all — the exact shape this
// repo keeps meeting. The cap has to be applied BEFORE the filter to reproduce the defect.
if (SELFTEST) {
  const installed = await page.evaluate(() => {
    const orig = window.customerMatches;
    window.customerMatches = (q) => {
      const recent = orig('');                       // the 20 most recent, and only those
      const s = String(q || '').trim().toLowerCase();
      const rows = recent.rows.filter(({ c }) => !s || (c.name || '').toLowerCase().includes(s));
      return { rows, total: recent.total, hits: rows.length, searching: !!s };
    };
    refreshCustomerSelect();
    return window.customerMatches('אבנר').rows.length;  // must now be 0
  });
  if (installed !== 0) { console.log(`  FAIL selftest did not take hold — got ${installed} rows`); process.exit(1); }
}

// ---- 1. תיקונים: the picker exists, and the old <select> is gone ----
const calc = await page.evaluate(() => {
  navigateTo('calc');
  return {
    hasSearch: !!document.getElementById('custSearch'),
    oldSelect: !!document.getElementById('customerSelect'),
    rows: document.querySelectorAll('#custPickList .cust-pick-row').length,
    head: (document.querySelector('#custPickList .cust-pick-head') || {}).textContent || '',
    first: (document.querySelector('#custPickList .cust-pick-name') || {}).textContent || '',
  };
});
check('the calculator has a search box, not a 45-row <select>', calc.hasSearch && !calc.oldSelect,
  `search=${calc.hasSearch} select=${calc.oldSelect}`);
check('unsearched it shows 20, newest first', calc.rows === 20 && calc.first.includes('רון מזרחי'),
  `${calc.rows} rows, first "${calc.first}"`);
check('and says how many it is not showing', /45/.test(calc.head), calc.head);

// ---- 2. a customer 40 visits deep is findable by NAME ----
// The one that would go silently missing if the cap were applied to searches too.
const found = await page.evaluate((OLD) => {
  const s = document.getElementById('custSearch');
  s.value = OLD; refreshCustomerSelect();
  const names = [...document.querySelectorAll('#custPickList .cust-pick-name')].map((n) => n.textContent.trim());
  const sub = (document.querySelector('#custPickList .cust-pick-sub') || {}).textContent || '';
  return { names, sub };
}, OLD);
check('an old imported customer is findable by name', found.names.some((n) => n.includes(OLD)),
  found.names.join(' | ') || '(none)');
check('and one with no phone on file says so, rather than showing a blank line',
  found.sub.includes('ללא טלפון'), found.sub);

// ---- 3. picking fills the repair form ----
const picked = await page.evaluate(() => {
  // Guarded: under --selftest there is no row to click, and a crash names itself but buries
  // the assertion that actually diagnosed the fault.
  const row = document.querySelector('#custPickList .cust-pick-row');
  if (row) row.click();
  return {
    name: document.getElementById('custName').value,
    phone: document.getElementById('custPhone').value,
    query: document.getElementById('custSearch').value,
    rows: document.querySelectorAll('#custPickList .cust-pick-row').length,
  };
});
check('picking fills the repair form', picked.name.includes(OLD), `"${picked.name}" / "${picked.phone}"`);
// Once someone is on the form the list has nothing left to offer, and 190px of it sitting
// between לקוח קיים and every field below is the difference between a picker and an obstacle.
check('and then gets out of the way', picked.query === '' && picked.rows === 0,
  `query="${picked.query}" rows=${picked.rows}`);

// ---- 4. a phone number finds its customer ----
const byPhone = await page.evaluate(() => {
  const s = document.getElementById('custSearch');
  s.value = '050-333'; refreshCustomerSelect();
  return [...document.querySelectorAll('#custPickList .cust-pick-name')].map((n) => n.textContent.trim());
});
check('a phone typed with dashes still finds the customer', byPhone.some((n) => n.includes('דוד כהן')),
  byPhone.join(' | ') || '(none)');

// ---- 5. מכירות: the sales editor has the same picker ----
const sale = await page.evaluate((BIZ) => {
  navigateTo('orders');
  openOrderEditor();
  // A retail line first, so the B2B switch has something to reprice.
  const ci = PRICING.findIndex((p) => p.retail > 0 && p.b2b > 0 && p.b2b !== p.retail);
  orderDraft.items.push({ ci, qty: 1 });
  renderOrderModal();
  const before = document.querySelector('#modalBackdrop [style*="סה"]');
  const retail = PRICING[ci].retail, b2b = PRICING[ci].b2b;
  const s = document.getElementById('ordCustSearch');
  const had = !!s;
  if (s) { s.value = BIZ; onOrderCustSearch(); }
  const hit = document.querySelector('#ordCustList .cust-pick-row');
  if (hit) hit.click();
  const totalText = [...document.querySelectorAll('#modalBackdrop div')]
    .map((d) => d.textContent).filter((x) => x.startsWith('סה"כ')).pop() || '';
  return {
    had, retail, b2b,
    name: (document.getElementById('ordName') || {}).value || '',
    phone: (document.getElementById('ordPhone') || {}).value || '',
    biz: !!orderDraft.isBusiness,
    total: totalText,
  };
}, BIZ);
check('the sales editor has an existing-customer picker at all', sale.had, String(sale.had));
check('picking fills name and phone in the sale', sale.name.includes(BIZ) && sale.phone === '0549954395',
  `"${sale.name}" / "${sale.phone}"`);
check('a business customer switches the order to B2B', sale.biz, String(sale.biz));
// Digits only: the total renders as ₪2,510 and a naive includes('2510') fails against a
// perfectly correct page — the same thousands-separator trap as grepping a minified price.
const totalDigits = sale.total.replace(/[^0-9]/g, '');
check('and the line already added is repriced, not left at retail',
  totalDigits.includes(String(sale.b2b)) && !totalDigits.includes(String(sale.retail)),
  `${sale.total} (retail ${sale.retail}, b2b ${sale.b2b})`);

// ---- 6. a hand-marked B2B order is never quietly returned to retail ----
// A dealer not yet in the customer list is ticked by hand. Clearing that on a later pick
// would raise every line with nothing on screen saying why.
const keptB2B = await page.evaluate(() => {
  openOrderEditor();
  orderDraft.isBusiness = true;
  renderOrderModal();
  const s = document.getElementById('ordCustSearch');
  s.value = 'רון מזרחי'; onOrderCustSearch();          // a private customer
  const row = document.querySelector('#ordCustList .cust-pick-row');
  if (row) row.click();
  return { biz: !!orderDraft.isBusiness, name: document.getElementById('ordName').value };
});
check('picking a private customer does not silently undo a hand-set B2B',
  keptB2B.biz && keptB2B.name.includes('רון מזרחי'), `biz=${keptB2B.biz} name="${keptB2B.name}"`);

// ---- 7. the import reaches both pickers without a reload ----
// The bug this was written for: importAccounting() wrote 144 customers and refreshed the
// ledger only, so the calculator went on showing the list it had built at init.
const imported = await page.evaluate(() => {
  closeModal();
  navigateTo('finances');
  openAccountingImport();
  document.getElementById('acctJson').value = JSON.stringify({
    customers: [{ name: 'לקוח מהאקסל', phone: '0508887777', vatId: '', isBusiness: false,
      email: '', contact: '', city: 'פתח תקווה', address: '', notes: '', acctNo: '',
      firstVisit: new Date().toISOString() }],
    incomes: [],
  });
  importAccounting();
  navigateTo('calc');
  const s = document.getElementById('custSearch');
  s.value = 'מהאקסל'; refreshCustomerSelect();
  return [...document.querySelectorAll('#custPickList .cust-pick-name')].map((n) => n.textContent.trim());
});
check('a customer imported from the Excel is selectable without reloading the app',
  imported.some((n) => n.includes('לקוח מהאקסל')), imported.join(' | ') || '(none)');

// ---- 8. nothing broke on the way ----
check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
check('no native dialog was raised', dialogs.length === 0, dialogs.slice(0, 2).join(' | ') || 'none');

await browser.close();
srv.close();
process.exit(finish());
