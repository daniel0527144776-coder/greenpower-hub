// Folded sections (2026-10-05, Daniel: "שכל הקטגוריות יהיו מקופלות … שלא יעשה עומס על העין").
//
// The settings page is all folded; on the work-hours page the history folds and the live cards stay
// as they were — they carry ids that code hides and shows (the approvals card hides itself when
// nothing waits), and wrapped they would leave an empty section header behind. Opening a section
// shows what is in it, and folding twice changes nothing (boot runs it; a second run must not nest).
// The bot and trading pages fold through fold() and are checked in their own suites.
//
// Every tab (2026-10-05, Daniel: "תעשה שבכל הטאבים אז יהיה הכל מקופל"): the jobs, customers,
// warranties and saved stickers by month; the vehicle sizes by group; the price list by topic;
// "כל החודשים", the workers' debts and "חסר להזמנה". Each starts folded; a search (or a chosen
// filter) opens them; a section he opened stays open when the page re-draws; a month's title carries
// its money, and no title carries a count of rows (counts left this app on purpose, 2026-08-18).
//
//   node test/test-folds.mjs
//   node test/test-folds.mjs --selftest   (foldStatic does nothing, fold() returns its body bare — must fail)
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(f);
  // --selftest: the folding itself switched off, before the page's own boot can run it
  if (SELFTEST && rel === 'index.html') body = Buffer.from(String(body).replace('function foldStatic(pageId, keepOpen = []) {', 'function foldStatic(pageId, keepOpen = []) { return;')
    .replace("function fold(id, title, body, { count = null, hot = false, open = false, sum = '', sub = false } = {}) {", "function fold(id, title, body, { count = null, hot = false, open = false, sum = '', sub = false } = {}) { return body;"));
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(body);
});
await new Promise((r) => srv.listen(4199, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1:4199/') ? route.continue() : route.abort()));
await page.goto('http://127.0.0.1:4199/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

const folds = (pg) => page.evaluate((pg) => [...document.querySelectorAll('#page-' + pg + ' details.fold')]
  .map((d) => ({ t: d.querySelector('.fold-title').textContent, open: d.open })), pg);
const settings = await folds('settings');
check('settings: every titled card is a folded section', settings.length === 4 && settings.every((f) => !f.open)
  && settings.map((f) => f.t).join('|') === '🏢 פרטי העסק (לחשבונית)|💵 הגדרות תמחור|💾 ניהול נתונים|🛠️ תחזוקה', settings);
const work = await folds('worktime');
check('work hours: the debts and the history fold', work.length === 2 && work[0].t === '👷 עובדים — מי חייב כמה' && work[1].t === '📝 שעות אחרונות' && work.every((f) => !f.open), work);
check('…and the live cards stay as they were, ids and all', await page.evaluate(() => ['shiftCard', 'punchCard']
  .every((id) => { const c = document.getElementById(id); return c && c.parentElement.id === 'page-worktime' && !c.closest('details'); })
  && document.getElementById('wageDebtCard').tagName === 'DETAILS' && document.getElementById('wageDebtCard').parentElement.id === 'page-worktime'), '');
const fin = await folds('finances');
check('finances: "כל החודשים" folds, the month in front stays', fin.length === 1 && /כל החודשים/.test(fin[0].t) && !fin[0].open
  && await page.evaluate(() => !document.getElementById('finIncome').closest('details')), fin);

const shown = await page.evaluate(async () => {
  const g = document.getElementById('loginOverlay'); if (g) g.style.display = 'none';
  navigateTo('settings');
  const input = document.getElementById('bizName');
  const before = !!(input && input.checkVisibility());
  const d = input && input.closest('details.fold');
  if (d) d.open = true;
  await new Promise((r) => setTimeout(r, 50));
  return { before, after: !!(input && input.checkVisibility()), title: d ? d.querySelector('summary').textContent : '' };
});
check('a folded section hides its fields until it is opened, and shows them after', !shown.before && shown.after && /פרטי העסק/.test(shown.title), shown);

// ---- the list pages, with rows in them
await page.evaluate(() => {
  const D = 86400000, now = Date.now(), iso = (d) => new Date(now - d * D).toISOString();
  const set = (k, v) => localStorage.setItem('gp_' + k, JSON.stringify(v));
  set('customers', [0, 1, 2].map((i) => ({ id: 'c' + i, name: 'לקוח ' + i, phone: '05000000' + i, lastVisit: iso(i * 40) })));
  set('jobs', [0, 1, 2].map((i) => ({ id: 'j' + i, date: iso(i * 40), customerName: 'לקוח ' + i, customerPhone: '05000000' + i, voltage: '48', capacity: '20', price: 900, jobStatus: 'נמסר', warrantyEnd: iso(i === 2 ? -10 : -200) })));
  set('orders', [{ id: 'o1', date: iso(3), customer: 'לקוח 0', phone: '050000000', items: [{ name: 'סוללה', price: 1300, qty: 1 }], total: 1300, status: 'שולם' }]);
  set('sticker_history', [0, 1].map((i) => ({ client: 'לקוח ' + i, ref: 'R' + i, sku: 'S' + i, model: 'GP', voltage: '48V', capacity: '20Ah', cells: '13S4P', type: 'build', date: iso(i * 40) })));
});
const lists = await page.evaluate(() => {
  const st = (sel) => { const d = [...document.querySelectorAll(sel + ' details.fold')]; return { n: d.length, closed: d.every((x) => !x.open), counts: d.filter((x) => x.querySelector(':scope > summary .fold-count')).length }; };
  const out = {};
  navigateTo('orders'); out.orders = st('#ordersList'); out.ordersSum = (document.querySelector('#ordersList details.fold .fold-sum') || {}).textContent || '';
  navigateTo('customers'); out.customers = st('#customersList');
  navigateTo('warranties'); setWarrantyTab('all'); out.warranties = st('#warrantiesList');
  navigateTo('stickerlog'); out.stickers = st('#stickerlogList');
  navigateTo('dims'); out.dims = st('#vpList');
  navigateTo('catalog'); out.catalog = st('#catalogList');
  navigateTo('inventory'); out.need = !document.getElementById('needCard').open && document.getElementById('needCard').tagName === 'DETAILS';
  return out;
});
for (const [k, label] of [['orders', 'jobs, by month'], ['customers', 'customers, by the month of the last visit'], ['warranties', 'warranties, by the month they end'], ['stickers', 'saved stickers, by month'], ['dims', 'vehicle sizes, by group'], ['catalog', 'the price list, by topic']]) {
  check(label + ': folded, with no row count on a title', lists[k] && lists[k].n >= 1 && lists[k].closed && lists[k].counts === 0, lists[k]);
}
check('a month\'s title carries its money', /₪/.test(lists.ordersSum), lists.ordersSum);
check('"חסר להזמנה" folds, and the home card opens it', lists.need && await page.evaluate(() => { openNeedList(); return document.getElementById('needCard').open; }), lists.need);
const opened = await page.evaluate(async () => {
  const out = {};
  navigateTo('orders');
  setSalesFilter('sale');
  out.search = [...document.querySelectorAll('#ordersList details.fold')].every((d) => d.open);
  setSalesFilter('all');
  out.cleared = [...document.querySelectorAll('#ordersList details.fold')].every((d) => !d.open);
  const d = document.querySelector('#ordersList details.fold'); d.open = true;
  await new Promise((r) => setTimeout(r, 30));
  renderOrders();
  out.kept = document.querySelector('#ordersList details.fold').open;
  out.rowShown = document.querySelector('#ordersList .list-item').checkVisibility();
  navigateTo('warranties'); setWarrantyTab('expiring');
  const ex = [...document.querySelectorAll('#warrantiesList details.fold')];
  out.expiring = ex.length > 0 && ex.every((x) => x.open);
  navigateTo('catalog'); document.getElementById('catalogCat').value = PRICING.find((p) => /72V/.test(p.name)).cat; renderCatalog();
  out.catSearch = [...document.querySelectorAll('#catalogList details.fold')].length > 0 && [...document.querySelectorAll('#catalogList details.fold')].every((x) => x.open);
  document.getElementById('catalogCat').value = ''; renderCatalog();
  catExpandAll(true); out.catAll = [...document.querySelectorAll('#catalogList details.fold')].every((x) => x.open);
  catExpandAll(false); out.catNone = [...document.querySelectorAll('#catalogList details.fold')].every((x) => !x.open);
  return out;
});
check('a filter opens the months it shows, and "הכל" folds them again', opened.search && opened.cleared, opened);
check('a month he opened stays open when the page re-draws, its rows shown', opened.kept && opened.rowShown, opened);
check('"פגות בקרוב" (the home banner\'s target) opens', opened.expiring === true, opened);
check('the price list: a chosen category opens its topics; פתח הכל / סגור הכל open and close them', opened.catSearch && opened.catAll && opened.catNone, opened);

const twice = await page.evaluate(() => { foldStatic('settings'); foldStatic('worktime'); return document.querySelectorAll('details.fold details.fold').length; });
check('folding again changes nothing — no section inside a section', twice === 0 && (await folds('settings')).length === 4, twice);
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
