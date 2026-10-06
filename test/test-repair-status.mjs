// A repair's status on its row in עבודות (2026-10-06).
//
//   node test/test-repair-status.mjs
//   node test/test-repair-status.mjs --selftest   (the pill taken off the repair row — must fail)
//
// Daniel: "למה בעבודות לא כתוב נמסר/שולם?". A sale has always carried its pill (הצעה/שולם/נמסר); a
// repair carried none, so its status — התקבל במעבדה / בעבודה / מוכן לאיסוף / נמסר — could only be
// read by opening ✏️ ערוך. Now the row shows it and 🔁 moves it on, like a sale.
// A repair older than the stuck-work window with no status predates the field, and says nothing
// rather than "בעבודה" about a battery that went home long ago.
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

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) {
  const a = '<div style="margin-top:3px;">${jobStatusPill(jobStatusOf(j))}</div>';
  if (!html.includes(a)) { console.error('selftest: the pill is not where it was'); process.exit(2); }
  html = html.replace(a, () => '');
}
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4381, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4381/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

const DAY = 86400000;
await page.evaluate((DAY) => {
  hideLogin(); closeModal(); closeNotice();
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  Store.set('jobs', [
    { id: 'r1', date: ago(2), customerName: 'חדש בלי סטטוס', customerPhone: '0500000001', price: 300 },
    { id: 'r2', date: ago(3), customerName: 'מוכן', customerPhone: '0500000002', price: 400, jobStatus: 'מוכן לאיסוף' },
    { id: 'r3', date: ago(4), customerName: 'נמסר כבר', customerPhone: '0500000003', price: 500, jobStatus: 'נמסר' },
    { id: 'r4', date: ago(100), customerName: 'ישן בלי סטטוס', customerPhone: '0500000004', price: 600 },
  ]);
  Store.set('orders', [{ id: 's1', date: ago(1), customer: 'קונה', phone: '0500000009', total: 1000, status: 'שולם', items: [] }]);
  navigateTo('orders');
  setSalesFilter('all');
}, DAY);

// open every month: a closed <details> has no layout, and the rows inside are what is checked
const rows = () => page.evaluate(() => {
  document.querySelectorAll('#ordersList details').forEach((d) => { d.open = true; });
  return [...document.querySelectorAll('#ordersList .list-item')].map((el) => ({
    name: el.querySelector('.list-item-title')?.textContent.trim() || '',
    status: el.querySelector('[data-job-status]')?.textContent.trim() || '',
    sale: [...el.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^(הצעה|שולם|נמסר)$/.test(t)) || '',
    cycle: [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /^🔁/.test(t)) || '',
  }));
});
const byName = (list, n) => list.find((r) => r.name.includes(n)) || {};
let list = await rows();
check('a new repair with no status reads בעבודה', byName(list, 'חדש בלי סטטוס').status === 'בעבודה', byName(list, 'חדש בלי סטטוס'));
check('a repair ready for pickup says so', byName(list, 'מוכן').status === 'מוכן לאיסוף', byName(list, 'מוכן'));
check('a delivered repair says נמסר', byName(list, 'נמסר כבר').status === 'נמסר', byName(list, 'נמסר כבר'));
check('an old repair with no status claims nothing', byName(list, 'ישן בלי סטטוס').status === '', byName(list, 'ישן בלי סטטוס'));
check('the sale keeps its own pill', byName(list, 'קונה').sale === 'שולם' && !byName(list, 'קונה').status, byName(list, 'קונה'));
check('🔁 on a repair names the NEXT status', byName(list, 'מוכן').cycle === '🔁 סמן נמסר' && byName(list, 'חדש בלי סטטוס').cycle === '🔁 סמן מוכן לאיסוף', list.map((r) => r.cycle));
check('…and on an old one goes straight to נמסר', byName(list, 'ישן בלי סטטוס').cycle === '🔁 סמן נמסר', byName(list, 'ישן בלי סטטוס'));

// pressing it moves the status, keeps it, and redraws the row
const moved = await page.evaluate(() => {
  cycleJobStatus('r2');
  try { closeModal(); } catch (e) { /* the review ask, if it opened */ }
  return (Store.get('jobs') || []).find((j) => j.id === 'r2').jobStatus;
});
list = await rows();
check('🔁 stores the next status', moved === 'נמסר', moved);
check('…and the row shows it', byName(list, 'מוכן').status === 'נמסר', byName(list, 'מוכן'));

check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
if (SELFTEST) console.log('\n[selftest] the pill was taken off the repair row — the status checks above must be red.');
await browser.close(); srv.close();
process.exit(finish());
