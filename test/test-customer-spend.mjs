// What a customer has spent, and the three screens that must agree about it.
//
//   node test/test-customer-spend.mjs
//   node test/test-customer-spend.mjs --selftest
//
// Daniel, 2026-09-10: "למה בלקוחות פרטיים יש הרבה 0₪ ולקוחות עסקים 450₪".
//
// `totalSpent` on the customer record only ever counted repairs saved through the CALCULATOR.
// saveJob adds to it; upsertCustomerFromOrder sets it to 0 for a new customer and never adds a
// sale to an existing one; the accounting import writes 0 on purpose rather than invent a
// total. So the list read ₪0 for everyone whose history came from the books or from sales, and
// the familiar repair prices for the few who came through the calculator.
//
// customerLedger already derived it correctly and said so in its own comment — that fix
// reached the customer CARD and never reached the list or the statistics page. Measured after
// importing the real books: the list showed ₪0 for all 144 while the card had the truth for
// 80 of them, one of them ₪14,600.
//
// The second half is attribution. 30 receipts carry no phone and are filed by NAME, and six
// names in his list are held by TWO records (the same person once with a phone, once without),
// so the money landed on both cards — ₪4,275 counted twice.
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
await new Promise((r) => srv.listen(4347, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4347/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

// A shop's worth of history in every shape it can be recorded in.
await page.evaluate(() => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  localStorage.setItem('gp_customers', JSON.stringify([
    // stored totals are deliberately WRONG here — nothing may read them
    { name: 'רק מהספרים', phone: '0501111111', totalSpent: 0, visitCount: 0, lastVisit: iso(2024, 1, 1), src: 'books' },
    { name: 'רק מכירה', phone: '0502222222', totalSpent: 0, visitCount: 0, lastVisit: iso(2025, 5, 1) },
    { name: 'רק תיקון', phone: '0503333333', totalSpent: 450, visitCount: 1, lastVisit: iso(2025, 6, 1) },
    { name: 'הכול ביחד', phone: '0504444444', totalSpent: 450, visitCount: 1, lastVisit: iso(2025, 7, 1) },
    // the same person twice: once with a phone, once without — six real names look like this
    { name: 'כפול', phone: '0505555555', totalSpent: 0, visitCount: 0, lastVisit: iso(2024, 3, 1) },
    { name: 'כפול', phone: '', totalSpent: 0, visitCount: 0, lastVisit: iso(2024, 3, 1) },
  ]));
  localStorage.setItem('gp_jobs', JSON.stringify([
    { id: 'j1', date: iso(2025, 6, 1), customerName: 'רק תיקון', customerPhone: '0503333333', price: 450, jobs: ['bms'] },
    { id: 'j2', date: iso(2025, 7, 1), customerName: 'הכול ביחד', customerPhone: '0504444444', price: 450, jobs: ['bms'] },
  ]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o1', date: iso(2025, 5, 1), customer: 'רק מכירה', phone: '0502222222', items: [{ name: 'x', cat: 'c', qty: 1, unit: 3000 }], total: 3000, status: 'שולם' },
    { id: 'o2', date: iso(2025, 7, 2), customer: 'הכול ביחד', phone: '0504444444', items: [{ name: 'y', cat: 'c', qty: 1, unit: 2000 }], total: 2000, status: 'נמסר' },
    // a quote is not money
    { id: 'o3', date: iso(2025, 8, 1), customer: 'הכול ביחד', phone: '0504444444', items: [{ name: 'z', cat: 'c', qty: 1, unit: 9999 }], total: 9999, status: 'הצעה' },
  ]));
  localStorage.setItem('gp_incomes', JSON.stringify([
    { id: 'b1', amount: 5000, date: iso(2024, 1, 1), customer: 'רק מהספרים', phone: '0501111111', src: 'books', locked: true },
    { id: 'b2', amount: 1000, date: iso(2024, 2, 1), customer: 'הכול ביחד', phone: '0504444444', src: 'books', locked: true },
    // filed by bare NAME, and that name belongs to two records
    { id: 'b3', amount: 700, date: iso(2024, 3, 1), customer: 'כפול', src: 'books', locked: true },
    // unreceipted books money is deliberately not attributed to a card
    { id: 'b4', amount: 15050, date: iso(2024, 4, 1), customer: 'רק מהספרים', phone: '0501111111', src: 'books', locked: true, unreceipted: true },
    // an ordinary ledger row is not a receipt and belongs to nobody
    { id: 'f1', amount: 8888, date: iso(2025, 9, 1), note: 'יובא מוואטסאפ' },
  ]));
});
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // Put the original bug back: read the STORED total instead of deriving it.
  await page.evaluate(() => { window.customerSpendIndex = () => (c) => ({ spent: c.totalSpent || 0, visits: c.visitCount || 0 }); });
}

// ---------------------------------------------------------------- what the list shows
const list = await page.evaluate(() => {
  navigateTo('customers');
  const out = {};
  for (const el of document.querySelectorAll('#customersList .list-item')) {
    const name = el.querySelector('.list-item-title').innerText.trim();
    const val = Number((el.querySelector('.list-item-value').innerText || '').replace(/[^\d]/g, '')) || 0;
    (out[name] = out[name] || []).push(val);
  }
  return out;
});
check('a customer known only from the books shows their books total', (list['רק מהספרים'] || [])[0] === 5000, list['רק מהספרים']);
check('a customer known only from a sale shows the sale', (list['רק מכירה'] || [])[0] === 3000, list['רק מכירה']);
check('a customer known only from a repair still shows the repair', (list['רק תיקון'] || [])[0] === 450, list['רק תיקון']);
// 450 repair + 2,000 delivered sale + 1,000 receipt = 3,450. The 9,999 quote is not money.
check('a customer with all three shows the sum, excluding the quote', (list['הכול ביחד'] || [])[0] === 3450, list['הכול ביחד']);

// ---------------------------------------------------------------- attribution
const dup = (list['כפול'] || []).slice().sort((a, b) => b - a);
check('a receipt filed under a shared name lands on ONE card, not both',
  dup.length === 2 && dup[0] === 700 && dup[1] === 0, dup);

// ---------------------------------------------------------------- the three screens agree
const agree = await page.evaluate(() => {
  const idx = customerSpendIndex();
  const bad = [];
  for (const c of (Store.get('customers') || [])) {
    const led = customerLedger(c);
    if (Math.round(idx(c).spent) !== Math.round(led.spent)) bad.push({ n: c.name, list: idx(c).spent, card: led.spent });
  }
  return bad;
});
check('the list and the customer card agree on every customer', agree.length === 0, agree);

const stats = await page.evaluate(() => {
  navigateTo('stats');
  const t = document.getElementById('page-stats').innerText;
  // the biggest spender here is רק מהספרים at 5,000 — invisible while ranking used totalSpent
  return { top: /רק מהספרים/.test(t), text: t.slice(0, 200).replace(/\s+/g, ' ') };
});
check('the statistics page ranks by what was really spent', stats.top, stats.text);

// ---------------------------------------------------------------- what must NOT be counted
const excluded = await page.evaluate(() => {
  const idx = customerSpendIndex();
  const all = (Store.get('customers') || []).reduce((s, c) => s + idx(c).spent, 0);
  return all;
});
// 5,000 + 3,000 + 450 + 3,450 + 700 = 12,600. The unreceipted 15,050, the 9,999 quote and the
// 8,888 WhatsApp row belong to no customer card.
check('unreceipted money, quotes and un-owned ledger rows stay off the cards',
  Math.round(excluded) === 12600, excluded);

// ---------------------------------------------------------------- merging duplicates
// The evidence is reported per group and only the provable ones are ticked: a shared ח.פ says
// a company is itself, but two towns or two phone numbers under one common name is more likely
// two people, and merging those moves one customer's history onto another with no undo.
const dupes = await page.evaluate(() => {
  const g = findCustomerDupes();
  return g.map((x) => ({ name: x.recs[0].name, safe: x.safe, why: x.why, n: x.recs.length }));
});
check('the duplicate name is found', dupes.length === 1 && dupes[0].name === 'כפול', dupes);
check('and it is offered as safe (one record is just a phone-less copy)', dupes[0] && dupes[0].safe === true, dupes);

const conflict = await page.evaluate(() => {
  const cs = Store.get('customers') || [];
  cs.push({ name: 'שם משותף', phone: '0507777777', city: 'אלעד', totalSpent: 0, visitCount: 0, lastVisit: new Date().toISOString() });
  cs.push({ name: 'שם משותף', phone: '0508888888', city: 'חיפה', totalSpent: 0, visitCount: 0, lastVisit: new Date().toISOString() });
  Store.set('customers', cs);
  const g = findCustomerDupes().find((x) => x.recs[0].name === 'שם משותף');
  return { safe: g && g.safe, why: g && g.why };
});
check('two different phone numbers are NOT offered as a safe merge', conflict.safe === false, conflict);
check('and the reason is stated', /טלפון/.test(conflict.why || ''), conflict.why);

// The one that would lose money silently: merge records holding different numbers and every
// job, sale and receipt filed under the other number stops belonging to anybody.
const merged = await page.evaluate(() => {
  const idx0 = customerSpendIndex();
  const before = (Store.get('customers') || []).reduce((s, c) => s + idx0(c).spent, 0);
  const beforeN = (Store.get('customers') || []).length;
  for (const g of findCustomerDupes()) mergeDupeGroup(g.key);
  const idx = customerSpendIndex();
  const cs = Store.get('customers') || [];
  let disagree = 0;
  for (const c of cs) if (Math.round(idx(c).spent) !== Math.round(customerLedger(c).spent)) disagree++;
  const kept = cs.find((c) => c.name === 'שם משותף');
  return {
    before, after: cs.reduce((s, c) => s + idx(c).spent, 0),
    beforeN, afterN: cs.length, left: findCustomerDupes().length, disagree,
    altPhones: kept ? custPhones(kept) : [],
  };
});
check('merging removes the extra records', merged.afterN === merged.beforeN - 2, merged);
check('and leaves no duplicates behind', merged.left === 0, merged.left);
check('NOT ONE SHEKEL moves when records are merged', Math.round(merged.before) === Math.round(merged.after), merged);
check('the merged record keeps both phone numbers', merged.altPhones.length === 2, merged.altPhones);
check('the list and the card still agree afterwards', merged.disagree === 0, merged.disagree);

if (SELFTEST) console.log('\n[selftest] the list was pointed back at the stored totalSpent;\n[selftest] the books/sale/agreement checks must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
