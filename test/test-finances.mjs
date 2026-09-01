// כספים: the rebuilt page, and the accounting import that feeds it.
//
//   node test/test-finances.mjs
//   node test/test-finances.mjs --selftest
//
// The import is the reason this suite exists. It writes 144 customers and six years of income
// onto a device, over data he typed himself, and the two rules that protect him are invisible
// on screen: existing fields are FILLED and never overwritten, and re-importing REPLACES the
// books rows rather than appending them. Both fail silently — the first loses a note he wrote,
// the second doubles ₪269,845 — and neither shows up as an error.
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
await new Promise((r) => srv.listen(4200, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4200/index.html');

// LOCAL month, not toISOString().slice(0,7). At 00:30 Israel time on the 1st, UTC is still
// the previous month — this test seeded August data and asserted against a page correctly
// showing September. The hub has a todayLocalISO() with a comment about exactly this; writing
// the test is where I forgot it.
const _n = new Date();
const THIS_MONTH = _n.getFullYear() + '-' + String(_n.getMonth() + 1).padStart(2, '0');
await page.evaluate((mk) => {
  const d = (day) => new Date(mk + '-' + day + 'T10:00:00').toISOString();
  localStorage.setItem('gp_jobs', JSON.stringify([{ id: 'j1', date: d('05'), customerName: 'לקוח תיקון', customerPhone: '0501111111', price: 650, jobs: ['bms'] }]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o1', date: d('06'), customer: 'לקוח מכירה', phone: '0502222222', status: 'שולם', total: 1800, items: [{ name: 'x', cat: 'y' }] },
    { id: 'o2', date: d('07'), customer: 'הצעה', phone: '0503333333', status: 'הצעה', total: 900, items: [{ name: 'x', cat: 'y' }] },
  ]));
  localStorage.setItem('gp_expenses', JSON.stringify([{ id: 'e1', date: d('04'), amount: 400, cat: 'רכש תאים', note: 'ספק' }]));
  localStorage.setItem('gp_incomes', JSON.stringify([]));
  // A customer he typed himself, with a note the import must not touch.
  localStorage.setItem('gp_customers', JSON.stringify([
    { id: 'c1', name: 'קורקינטים ברמה', phone: '', notes: 'שילם במזומן, לא לשכוח', isBusiness: false, city: '' },
  ]));
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  navigateTo('finances');
}, THIS_MONTH);
await page.waitForTimeout(300);

// ---- 1. the month you are in, first ----
const top = await page.evaluate(() => ({
  title: (document.getElementById('finMonthTitle') || {}).textContent || '',
  income: (document.getElementById('finIncome') || {}).textContent || '',
  expense: (document.getElementById('finExpense') || {}).textContent || '',
  net: (document.getElementById('finNet') || {}).textContent || '',
  detail: (document.getElementById('finMonthDetail') || {}).textContent || '',
  buttons: [...document.querySelectorAll('#page-finances .page-header button')].map((b) => b.textContent.trim()),
  // The permanently-open forms are gone.
  forms: document.querySelectorAll('#page-finances #expAmount, #page-finances #incAmount').length,
}));
check('the page opens on the current month', /\d{4}/.test(top.title), top.title);
check('income counts the repair and the paid sale, not the quote', top.income.includes('2,450'), top.income);
check('expenses count the ledger', top.expense.includes('400'), top.expense);
check('net is the difference', top.net.includes('2,050'), top.net);
check('two coloured buttons at the top', top.buttons.some((b) => b.includes('הכנסה')) && top.buttons.some((b) => b.includes('הוצאה')), top.buttons.join(' | '));
check('and no form sitting open on the page', top.forms === 0, String(top.forms));
check('the month detail shows both a summary and the lines',
  /תיקונים/.test(top.detail) && /לקוח מכירה/.test(top.detail), top.detail.slice(0, 90));

// ---- 2. a month opens ----
const opened = await page.evaluate((mk) => {
  toggleFinMonth(mk);
  const el = document.getElementById('finOverview');
  return { open: el.textContent.includes('לקוח מכירה'), rows: el.querySelectorAll('.list-item').length };
}, THIS_MONTH);
check('clicking a month opens its detail in place', opened.open, String(opened.rows) + ' months');

// ---- 3. the import ----
const IMPORT = path.join(HERE, '..', '..', 'accounting-import.json');
const haveReal = fs.existsSync(IMPORT);
const payload = haveReal ? JSON.parse(fs.readFileSync(IMPORT, 'utf8')) : {
  customers: [{ name: 'קורקינטים ברמה', phone: '', vatId: '207322942', isBusiness: true, city: 'תל אביב', address: '', email: '', contact: '', notes: '', acctNo: '9', firstVisit: '2022-01-01T00:00:00.000Z' }],
  incomes: [{ id: 'bk1', date: '2022-03-01T00:00:00.000Z', amount: 2850, cat: 'תיקונים ומכירות', note: 'סוללה', customer: 'קורקינטים ברמה', phone: '' }],
};
console.log(`  --   ${haveReal ? 'accounting-import.json אמיתי' : 'נתוני דמה'} · ${payload.customers.length} לקוחות, ${payload.incomes.length} הכנסות`);

const after = await page.evaluate((d) => {
  openAccountingImport();
  document.getElementById('acctJson').value = JSON.stringify(d);
  importAccounting();
  const cust = JSON.parse(localStorage.getItem('gp_customers') || '[]');
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const mine = cust.find((c) => c.name === 'קורקינטים ברמה');
  return {
    customers: cust.length,
    businesses: cust.filter((c) => c.isBusiness).length,
    books: inc.filter((r) => r.src === 'books').length,
    note: mine ? mine.notes : '(missing)',
    vat: mine ? mine.vatId : '',
    biz: mine ? !!mine.isBusiness : false,
  };
}, payload);

// Against the PAYLOAD's own size, not a hardcoded `> 1`. accounting-import.json lives in the
// tools root, which has no remote, so CI always takes the dummy branch — and that payload has
// exactly one customer, so `> 1` could never pass there. The suite was red on the runner and
// green here for that reason alone.
check('customers came in', after.customers >= payload.customers.length,
  `${after.customers} < ${payload.customers.length}`);
check('and the ones with a ח.פ are marked business', after.businesses > 0, String(after.businesses));
// The whole point of "fill blanks only": his note survives, the accountant's ח.פ arrives.
check('a note he typed is NOT overwritten', after.note === 'שילם במזומן, לא לשכוח', after.note);
check('but the blank ח.פ IS filled in', /\d/.test(after.vat), after.vat || '(empty)');
check('and an existing customer is promoted to business', after.biz, String(after.biz));
check('the books rows are tagged', after.books === payload.incomes.length, `${after.books}/${payload.incomes.length}`);

// Six חשבון עסקה documents were invoiced and never receipted. They are imported as income at
// his instruction, in a category of their own — and that category IS the safeguard. They
// carry no תקבול, so if one of them was never actually paid the revenue is overstated by
// exactly its amount, and a row that looks like every other income row is one nobody will
// ever find again.
const unrec = await page.evaluate(() => {
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const u = inc.filter((r) => r.unreceipted);
  return { n: u.length, sum: Math.round(u.reduce((s, r) => s + r.amount, 0)), cats: [...new Set(u.map((r) => r.cat))] };
});
check('an unreceipted invoice keeps its own category', unrec.n === 0 || unrec.cats.every((c) => /ללא תקבול/.test(c)), unrec.cats.join(',') || 'none');
// Actually removable, not just differently coloured. A receipt is locked because editing it
// opens a gap against the books; one of these is in the ledger only because he says it was
// paid, and locking it would make the correction impossible where the mistake shows up.
const removable = await page.evaluate(() => {
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const u = inc.find((r) => r.unreceipted);
  const paid = inc.find((r) => r.src === 'books' && !r.unreceipted);
  if (!u || !paid) return { skip: true };
  const d = new Date().toISOString();
  u.date = d; paid.date = d;
  localStorage.setItem('gp_incomes', JSON.stringify(inc));
  renderFinances();
  const html = document.getElementById('finMonthDetail').innerHTML;
  return { unrecDeletable: html.includes("deleteIncome('" + u.id + "')"), paidDeletable: html.includes("deleteIncome('" + paid.id + "')") };
});
check('an unreceipted invoice CAN be deleted', removable.skip || removable.unrecDeletable, JSON.stringify(removable));
check('but a real receipt still cannot', removable.skip || !removable.paidDeletable, JSON.stringify(removable));

// ---- 4. importing twice must not double the money ----
const twice = await page.evaluate((d) => {
  const before = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const manual = before.filter((r) => r.src !== 'books').length;
  openAccountingImport();
  document.getElementById('acctJson').value = JSON.stringify(d);
  importAccounting();
  const now = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  return { before: before.length, now: now.length, manualBefore: manual, manualNow: now.filter((r) => r.src !== 'books').length };
}, payload);
check('a second import replaces the books rows, it does not append them',
  twice.now === twice.before, `${twice.before} -> ${twice.now}`);

// ---- 5. and the books cannot be edited from here ----
const locked = await page.evaluate(() => {
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const b = inc.find((r) => r.src === 'books');
  if (!b) return { found: false };
  // Put one in the visible month so its rendered row can be inspected.
  b.date = new Date().toISOString();
  localStorage.setItem('gp_incomes', JSON.stringify(inc));
  renderFinances();
  const html = document.getElementById('finMonthDetail').innerHTML;
  return { found: true, hasLock: html.includes('🔒'), deletable: html.includes(`deleteIncome('${b.id}')`) };
});
check('a books row is marked as locked', locked.found && locked.hasLock, JSON.stringify(locked));
check('and offers no delete', locked.found && !locked.deletable, String(locked.deletable));

check('no JS errors', errs.length === 0, errs.join(' | '));
if (SELFTEST) check('(selftest) this check is meant to fail', false, 'deliberate');

await browser.close();
srv.close();
process.exit(finish());
