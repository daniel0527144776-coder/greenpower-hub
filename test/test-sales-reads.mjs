// A keystroke in the sales search reads each stored list once (2026-10-23).
//
//   node test/test-sales-reads.mjs
//   node test/test-sales-reads.mjs --selftest
//
// The search re-renders the list on every key. On a year of made-up sales (400 sales, 400 repairs, a
// stock log of 4,000 lines) one keystroke parsed `costs`, `settings` and `bms_pick` some 430 times each:
// saleProfit runs on every sale in the filter for the month totals, and costed each line from storage
// again. The inventory and its log were parsed once per sale row shown, for a stock check that only a
// sale from before OLD_CELL_RULE_UNTIL can need. 55-117 ms a key here, several times that on the phone,
// and growing with every sale. Since v500 a render keeps one copy of each (withRenderMemo).
//
// What must hold, per keystroke:
//   1. the inventory and its log are read at most once, and the cost lists once per distinct product;
//   2. the list is the same, to the character, with the memo and without it;
//   3. outside a render nothing is kept: a cost changed between two renders shows in the second.
// --selftest renders without the memo, so 1 goes red.
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
await new Promise((r) => srv.listen(4391, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4391/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

const R = await page.evaluate((SELFTEST) => {
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  init();
  // a year of made-up sales on 30 catalogue batteries, half from before the rule changed
  const bat = PRICING.filter((x) => /^סוללות/.test(x.cat) && /\d+V \d+Ah/.test(x.name)).slice(0, 30);
  const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 864e5).toISOString();
  const orders = [], jobs = [], log = [];
  for (let i = 0; i < 400; i++) {
    const it = bat[i % bat.length];
    orders.push({ id: 'o' + i, date: day(i % 2 ? 100 + (i % 180) : 300 + (i % 20)), customer: 'לקוח ' + i, phone: '05' + (30000000 + i),
      status: 'נמסר', total: 2000 + i, stockTaken: true, items: [{ name: it.name, cat: it.cat, qty: 1 }] });
  }
  for (let i = 0; i < 400; i++) jobs.push({ id: 'j' + i, date: day(i % 320), customerName: 'לקוח ' + i, customerPhone: '05' + (31000000 + i), price: 300, jobs: ['bms'] });
  for (let i = 0; i < 4000; i++) log.push({ id: 'l' + i, at: day(i % 290), row: 'r' + (i % 30), name: 'תאי EVE 21700 50E', qty: 10 + (i % 50), note: 'לקוח ' + (i % 400) });
  const inv = Array.from({ length: 150 }, (_, i) => ({ id: 'r' + i, name: i === 0 ? 'תאי EVE 21700 50E' : 'פריט ' + i, qty: 100, cat: 'תאים' }));
  Store.set('orders', orders); Store.set('jobs', jobs); Store.set('inv_log', log); Store.set('inventory', inv);
  navigateTo('orders');
  if (SELFTEST) window.withRenderMemo = (fn) => fn();

  // 1. what one keystroke reads
  const counts = {}, real = Store.get.bind(Store);
  Store.get = (k) => { counts[k] = (counts[k] || 0) + 1; return real(k); };
  const keys = ['ל', 'לק', 'לקו', 'לקוח', 'לקוח '];
  for (const q of keys) ordersSearch(q);
  Store.get = real;
  const per = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / keys.length]));

  // 2. the same list with the memo and without it
  ordersSearch('');
  const withMemo = document.getElementById('ordersList').innerHTML;
  const keep = window.withRenderMemo;
  window.withRenderMemo = (fn) => fn();
  renderOrders();
  const without = document.getElementById('ordersList').innerHTML;
  window.withRenderMemo = keep;

  // 3. nothing kept between renders: a typed cost shows on the next render
  const row = bat[0];
  const c = getCosts(); c[catKey(row)] = 12345; Store.set('costs', c);
  const profitAfter = saleProfit(orders.find((x) => x.items[0].name === row.name && x.items[0].cat === row.cat));
  return { per, distinct: bat.length, same: withMemo === without, len: withMemo.length, rows: (withMemo.match(/list-item-title/g) || []).length,
    profitAfter, total: orders.find((x) => x.items[0].name === row.name && x.items[0].cat === row.cat).total };
}, SELFTEST);

const p = R.per || {};
check('a keystroke reads the inventory and its log at most once', (p.inventory || 0) <= 1 && (p.inv_log || 0) <= 1, p);
check(`…and the cost lists once per product (${R.distinct} products, 400 sales)`,
  (p.costs || 0) <= R.distinct + 2 && (p.settings || 0) <= R.distinct + 4 && (p.bms_pick || 0) <= R.distinct + 2, p);
check('the list is the same, to the character, with the memo and without it', R.same && R.len > 2000 && R.rows > 20, { same: R.same, len: R.len, rows: R.rows });
check('nothing is kept between renders: a cost typed after one shows in the next', !!R.profitAfter && R.profitAfter.cost === 12345, R.profitAfter);

if (SELFTEST) console.log('\n[selftest] the list was rendered without the memo; the checks on what a keystroke reads must be red.');
check('no page errors', errs.length === 0, errs);
await browser.close(); srv.close();
process.exit(finish());
