// The finances page's twelve-month chart (v442, Daniel 2026-10-15: "גרף הכנסות חודשי").
//
//   node test/test-fin-chart.mjs
//   node test/test-fin-chart.mjs --selftest   (the chart reads no months: every check fails)
//
// It must show the same money as the table under it (finMonthly), only the last twelve months,
// right to left like the page, and open a month when a bar is tapped. Nothing in it is fetched.
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
await new Promise((r) => srv.listen(4231, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4231/index.html');
await page.waitForFunction(() => typeof window.finChartHtml === 'function', null, { timeout: 30000 });

const n = new Date();
const mk = (back) => { const d = new Date(n.getFullYear(), n.getMonth() - back, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const NOW = mk(0), THREE = mk(3), OLD = mk(14);
const r = await page.evaluate(({ NOW, THREE, OLD, SELF }) => {
  const at = (k) => new Date(k + '-10T10:00:00').toISOString();
  localStorage.setItem('gp_jobs', JSON.stringify([
    { id: 'j1', date: at(NOW), customerName: 'א', price: 650, jobs: ['bms'] },
    { id: 'j2', date: at(THREE), customerName: 'ב', price: 1000, jobs: ['bms'] },
    { id: 'j3', date: at(OLD), customerName: 'ג', price: 5000, jobs: ['bms'] },
  ]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o1', date: at(NOW), customer: 'ד', status: 'שולם', total: 1800, items: [] },
    { id: 'o2', date: at(NOW), customer: 'ה', status: 'הצעה', total: 9000, items: [] },
  ]));
  localStorage.setItem('gp_expenses', JSON.stringify([{ id: 'e1', date: at(NOW), amount: 400, cat: 'רכש תאים' }]));
  localStorage.setItem('gp_incomes', '[]');
  localStorage.setItem('gp_worktime', '[]');
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  if (SELF) window.finMonthly = () => ({});
  navigateTo('finances');
  renderFinances();
  const chart = document.querySelector('#finChart [data-fin-chart]');
  if (!chart) return { chart: false };
  const bars = [...chart.querySelectorAll('[data-fin-bar]')];
  const bar = (k) => bars.find((b) => b.getAttribute('data-fin-bar') === k);
  const hOf = (g, i) => +g.querySelectorAll('rect')[i].getAttribute('height');
  const xOf = (g) => +g.querySelector('rect').getAttribute('x');
  const now = bar(NOW), three = bar(THREE);
  const out = {
    chart: true, n: bars.length, labels: bars.map((b) => b.querySelector('text').textContent),
    old: !!bar(OLD), inc: hOf(now, 1), exp: hOf(now, 2), inc3: three ? hOf(three, 1) : -1,
    rtl: xOf(now) < xOf(bars[0]), tip: now.querySelector('title').textContent,
    fetched: chart.querySelectorAll('img, image, use').length,
  };
  now.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.opened = finOpenMonth === NOW && /א/.test(document.getElementById('finOverview').textContent);
  localStorage.setItem('gp_jobs', '[]'); localStorage.setItem('gp_orders', '[]'); localStorage.setItem('gp_expenses', '[]');
  out.empty = finChartHtml(finMonthly()) === '';
  return out;
}, { NOW, THREE, OLD, SELF: SELFTEST });

check('the finances page draws the chart, outside the folded month list', r.chart, r);
check('twelve months, each named by its number', r.n === 12 && r.labels.every((l) => /^\d{1,2}$/.test(l)) && r.labels[11] === String(+NOW.slice(5)), r.labels);
check('a month older than a year is not drawn', r.old === false, r);
check('this month: income 2,450 (the repair and the paid sale, not the quote) against 400 spent',
  r.inc > 0 && Math.abs(r.inc / r.exp - 2450 / 400) < 0.05 && /2,450/.test(r.tip) && /400/.test(r.tip), r);
check('a month three back is drawn from its own money', r.inc3 > 0 && Math.abs(r.inc3 / r.inc - 1000 / 2450) < 0.05, r);
check('right to left: this month on the left, the oldest on the right', r.rtl === true, r);
check('nothing in it is fetched', r.fetched === 0, r);
check('tapping a bar opens that month in the table', r.opened === true, r);
check('no money at all, no chart', r.empty === true, r);

await page.evaluate(() => { closeNotice && closeNotice(); closeModal && closeModal(); renderFinances(); });
await page.screenshot({ path: process.env.GP_SHOT || '/tmp/fin-chart.png', clip: { x: 0, y: 0, width: 420, height: 700 } });
check('no JS errors', errs.length === 0, errs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
