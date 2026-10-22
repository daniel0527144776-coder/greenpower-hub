// A repair saved is kept, however many came before it (2026-10-22).
//
//   node test/test-job-history.mjs
//   node test/test-job-history.mjs --selftest     (saveJob's write as it was: the cap of 500, the result unread)
//
// saveJob dropped the oldest repair once there were 500 (`if (jobs.length > 500) jobs.pop()`, since
// 2026-10-05). jobs is a merged key, so a row missing from a write is a deletion: the 501st repair
// wrote a tombstone for the first, and the next sync took it off every device, with the income it
// brought in its month. And saveJob went on when the write itself was refused: the shelf lost the
// cells and the BMS, the customer's card gained a visit, and "✅ נשמר" replaced the notice that said
// nothing was saved. What must hold:
//   - with 500 repairs on file, the 501st is saved beside them: all 501 kept, no tombstone written,
//     and the oldest one's month still holds its income;
//   - a repair the storage refuses leaves the shelf and the customers as they were, and the notice on
//     the screen is the one that says it was not saved;
//   - once there is room, the same form saves, and the shelf loses the build once.
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

// --selftest serves the page with the old write put back in saveJob
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) {
  const NOW = /(\n[ \t]*jobs\.unshift\(entry\);\n)(?:[ \t]*\/\/[^\n]*\n)*[ \t]*if \(!Store\.set\('jobs', jobs\)\) return;\n/;
  const old = html.replace(NOW, (m, head) => head + "  if (jobs.length > 500) jobs.pop();\n  Store.set('jobs', jobs);\n");
  check('[selftest] the old write could be put back', old !== html);
  html = old;
}

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4387, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4387/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.saveJob === 'function' && typeof window.recalc === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });

// ---- 1. the 501st repair
const R1 = await page.evaluate(async () => {
  const DAY = 864e5;
  // 500 on file, newest first as saveJob keeps them. The oldest is the only one in March 2025.
  const old = [];
  for (let i = 0; i < 499; i++) {
    const d = new Date(Date.UTC(2026, 8, 30, 10) - i * DAY);
    old.push({ id: 'jh' + i, date: d.toISOString(), customerName: 'לקוח ' + i, customerPhone: '0500' + String(i).padStart(6, '0'),
      jobs: ['bms'], voltage: '48', capacity: '20', price: 300, cost: 150, profit: 150,
      warrantyMonths: 6, warrantyEnd: new Date(d.getTime() + 182 * DAY).toISOString() });
  }
  old.push({ id: 'jhFirst', date: '2025-03-02T10:00:00.000Z', customerName: 'הלקוח הראשון', customerPhone: '0501111111',
    jobs: ['full'], voltage: '48', capacity: '20', price: 1250, cost: 700, profit: 550, warrantyMonths: 12, warrantyEnd: '2026-02-25T10:00:00.000Z' });
  Store.set('orders', []); Store.set('incomes', []); Store.set('expenses', []); Store.set('customers', []);
  Store.set('jobs', old);
  Store.set('tomb_jobs', {});
  Store.set('inventory', [
    { id: 'invCells', name: 'תאי EVE 21700 50E', qty: 400 },
    { id: 'invBms', name: 'BMS 13S 60A', qty: 5 },
  ]);
  const before = { n: (Store.get('jobs') || []).length, inc: (finMonthly()['2025-03'] || {}).inc };

  navigateTo('calc');
  document.getElementById('custName').value = 'לקוח 501';
  document.getElementById('custPhone').value = '050-123-4567';
  document.getElementById('voltage').value = '48';
  document.getElementById('capacity').value = '20';
  for (const k of [...state.jobs]) if (k !== 'bms') toggleJob(k);
  if (!state.jobs.has('bms')) toggleJob('bms');
  recalc();
  saveJob();
  await new Promise((r) => setTimeout(r, 50));
  const jobs = Store.get('jobs') || [];
  return {
    before, n: jobs.length, newest: (jobs[0] || {}).customerName || '',
    first: jobs.some((j) => j.id === 'jhFirst'), lost: old.filter((o) => !jobs.some((j) => j.id === o.id)).map((o) => o.id),
    tombs: Object.keys(Store.get('tomb_jobs') || {}), inc: (finMonthly()['2025-03'] || {}).inc,
  };
});
check('500 repairs on file before the save', R1.before.n === 500 && R1.before.inc === 1250, R1.before);
check('the 501st is saved, at the top', R1.newest === 'לקוח 501', R1.newest);
check('…beside all 500: none of them is dropped', R1.n === 501 && R1.first && R1.lost.length === 0, { n: R1.n, lost: R1.lost });
check('…and none is written off as deleted, so no sync takes it off another device', R1.tombs.length === 0, R1.tombs);
check('the oldest one\'s month still holds its income', R1.inc === 1250, R1.inc);

// ---- 2. a save the storage refuses, then the same save with room
await page.evaluate(() => closeNotice());
const R2 = await page.evaluate(async () => {
  const qty = (id) => (Store.get('inventory') || []).find((r) => r.id === id).qty;
  const snap = () => ({ n: (Store.get('jobs') || []).length, cells: qty('invCells'), bms: qty('invBms'),
    customers: JSON.stringify((Store.get('customers') || []).map(({ _u, ...c }) => c)) });
  // a full build, with a photo the size loadPhoto leaves after its downscale
  document.getElementById('custName').value = 'לקוח באחסון מלא';
  document.getElementById('custPhone').value = '050-765-4321';
  document.getElementById('voltage').value = '48';
  document.getElementById('capacity').value = '20';
  document.getElementById('cellType').value = '21700-50e'; syncCellMah();
  for (const k of [...state.jobs]) if (k !== 'full') toggleJob(k);
  if (!state.jobs.has('full')) toggleJob('full');
  recalc();
  state.photoBefore = 'data:image/jpeg;base64,' + 'A'.repeat(80000);
  // Fill the storage to all but ~4,000 characters: room for what the shelf and the customer's card
  // write, none for a repair that carries a photo.
  const fits = (n) => { try { localStorage.setItem('zz_fill', 'x'.repeat(n)); return true; } catch (e) { return false; } };
  let lo = 0, hi = 12e6;
  while (hi - lo > 500) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
  const filled = fits(Math.max(0, lo - 4000));
  const before = snap();
  saveJob();
  const notice = document.getElementById('noticeBody').textContent;
  const refused = snap();
  // room again: the form as he left it, saved again
  localStorage.removeItem('zz_fill');
  closeNotice();
  saveJob();
  const notice2 = document.getElementById('noticeBody').textContent;
  await new Promise((r) => setTimeout(r, 50));
  const saved = (Store.get('jobs') || [])[0] || {};
  const card = (Store.get('customers') || []).filter((c) => c.phone === '050-765-4321');
  return { filled, roomLeft: lo, before, notice, refused, notice2, after: snap(), saved: { name: saved.customerName, cells: saved.cells, photo: (saved.photoBefore || '').length },
    visits: card.map((c) => c.visitCount) };
});
check('the storage could be filled for the test', R2.filled && R2.roomLeft > 100000, { filled: R2.filled, roomLeft: R2.roomLeft });
check('a repair the storage refuses is not on file', R2.refused.n === R2.before.n, [R2.before.n, R2.refused.n]);
check('…and the shelf keeps its cells and its BMS', R2.refused.cells === R2.before.cells && R2.refused.bms === R2.before.bms,
  { before: [R2.before.cells, R2.before.bms], after: [R2.refused.cells, R2.refused.bms] });
check('…and no customer\'s card changed', R2.refused.customers === R2.before.customers);
check('…and the notice says it was not saved, not "✅ נשמר"', /לא נשמר/.test(R2.notice) && !R2.notice.includes('✅'), R2.notice);
check('with room again, the same form saves the repair, photo and all',
  R2.after.n === R2.before.n + 1 && R2.saved.name === 'לקוח באחסון מלא' && R2.saved.photo > 80000 && R2.notice2.includes('✅'), { n: [R2.before.n, R2.after.n], saved: R2.saved, notice: R2.notice2 });
check('…and the shelf loses the build once', R2.saved.cells > 0 && R2.after.cells === R2.before.cells - R2.saved.cells && R2.after.bms === R2.before.bms - 1,
  { cells: [R2.before.cells, R2.after.cells, R2.saved.cells], bms: [R2.before.bms, R2.after.bms] });
check('…and the customer has one visit, not two', R2.visits.length === 1 && R2.visits[0] === 1, R2.visits);
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
if (SELFTEST) console.log('\n[selftest] the cap of 500 and the unread write put back; the checks above must be red.');
process.exit(finish());
