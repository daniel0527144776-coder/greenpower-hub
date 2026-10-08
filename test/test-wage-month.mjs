// Wages paid on the 1st, and a worker's report changed by hand (2026-10-06).
//
//   node test/test-wage-month.mjs
//   node test/test-wage-month.mjs --selftest     (no month boundary; edits are thrown away)
//
// Daniel: "שים לב שבשעון עובדים אני משלם ב 1 לחודש וגם שאני יוכל לשנות דיווח של עובד". He chose, asked,
// "what is due on the 1st, and this month apart": still one running account per worker and no month
// to page through, but the balance is split — the open hours of past months, less the payments, are
// due now; this month's are paid on the coming 1st — and from the 1st an alert says what is due
// until the payment is written down. A report can be changed before it is approved (hours, day,
// note) and after (hours, day, rate, note); the row keeps what the worker reported.
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
await new Promise((r) => srv.listen(4373, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
const patched = [];
// The table, not one answer: renderWorktime() re-reads the queue after every change, and an answer of
// 'nothing pending' would empty the card under the report being corrected.
let serverPending = [];
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
// the general stand-in first: a route registered later is matched first
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.route('**/rest/v1/worker_punches*', (route) => {
  const req = route.request();
  if (req.method() === 'PATCH') {
    const id = decodeURIComponent((req.url().match(/id=eq\.([^&]+)/) || [])[1] || '');
    patched.push(JSON.parse(req.postData() || '{}'));
    serverPending = serverPending.filter((x) => x.id !== id);
    return route.fulfill({ status: 204, body: '' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverPending) });
});
await page.goto('http://localhost:4373/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.workerLedger === 'function' && typeof window.wtDueHtml === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => {
  window.wtMonthStart = () => 0;
  window.saveWorktimeEdit = () => closeModal();
  window.approveEditedPunch = (id) => { closeModal(); approvePunch(id); };
});
const hideNotice = () => page.evaluate(() => { if (typeof closeNotice === 'function') closeNotice(); });

// ---- the split: last month's hours due now, this month's on the 1st
// Dates relative to today, so the suite means the same thing on any day it runs.
const split = await page.evaluate(() => {
  const gate = document.getElementById('loginOverlay'); if (gate) gate.remove();
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const iso = (d) => d.toISOString();
  Store.set('workers', [{ id: 'wk1', name: 'יוסי', rate: 40 }]);
  Store.set('wage_payments', []);
  Store.set('worktime', [
    { id: 'w1', workerName: 'יוסי', rate: 40, hours: 10, note: '', date: iso(new Date(y, m - 1, 15, 12)), paid: false },   // ₪400, last month
    { id: 'w2', workerName: 'יוסי', rate: 40, hours: 5, note: '', date: iso(new Date(y, m, 1, 12)), paid: false },        // ₪200, this month
  ]);
  const read = () => { const L = workerLedger('יוסי'); const h = wtDueHtml(L); const d = document.createElement('div'); d.innerHTML = h;
    const el = d.querySelector('[data-wt-due]'); return { due: +el.dataset.wtDue, month: +el.dataset.wtMonth, text: d.textContent, balance: L.balance,
      alert: (hubAlerts().find((a) => a.id === 'wages') || null) }; };
  const none = read();
  Store.set('wage_payments', [{ id: 'p1', worker: 'יוסי', amount: 300, date: iso(new Date(y, m, 1, 13)), note: '' }]);
  const part = read();
  Store.set('wage_payments', [{ id: 'p1', worker: 'יוסי', amount: 500, date: iso(new Date(y, m, 1, 13)), note: '' }]);
  const ahead = read();
  Store.set('wage_payments', []);
  navigateTo('worktime');
  const card = document.getElementById('wageDebtList');
  const all = card.querySelector('[data-wt-due-all]');
  const pd = wtPayDates();
  return { none, part, ahead, pd, cardText: card.textContent, dueAll: all ? +all.dataset.wtDueAll : null,
    pencils: document.querySelectorAll('#worktimeList [onclick^="editWorktime("]').length };
});
check('unpaid: last month\'s ₪400 is due now, this month\'s ₪200 waits for the 1st',
  split.none.due === 400 && split.none.month === 200 && split.none.balance === 600, split.none);
check('it says until when and when this month is paid', split.none.text.includes('לתשלום עכשיו') && split.none.text.includes('שעות עד ' + split.pd.prevEnd)
  && split.none.text.includes('ישולם ב-' + split.pd.nextFirst), split.none.text);
check('from the 1st an alert says what is due', !!split.none.alert && split.none.alert.n === 400 && /לתשלום לעובדים/.test(split.none.alert.text), split.none.alert);
check('₪300 paid: ₪100 still due, this month unchanged', split.part.due === 100 && split.part.month === 200, split.part);
check('₪500 paid: nothing due, the extra ₪100 comes off this month, and no alert',
  split.ahead.due === 0 && split.ahead.month === 100 && split.ahead.balance === 100 && !split.ahead.alert && /✓ עד/.test(split.ahead.text), split.ahead);
check('the workers card carries the total due now', split.dueAll === 400 && split.cardText.includes('לתשלום עכשיו'), [split.dueAll, split.cardText.slice(0, 160)]);
check('every row of hours has a ✏️', split.pencils === 2, split.pencils);

// ---- changing a row already in the hours
const edit = await page.evaluate(() => {
  editWorktime('w2');
  const opened = { h: document.getElementById('wteHours').value, r: document.getElementById('wteRate').value };
  document.getElementById('wteHours').value = '6.30';   // hours.minutes: six and a half
  document.getElementById('wteRate').value = '42';
  document.getElementById('wteNote').value = 'תוקן בטלפון';
  saveWorktimeEdit('w2');
  const row = Store.get('worktime').find((x) => x.id === 'w2');
  const L = workerLedger('יוסי');
  const listed = document.getElementById('worktimeList').textContent;
  return { opened, row: { hours: row.hours, rate: row.rate, reported: row.reported, note: row.note }, month: L.thisMonth, listed };
});
check('the editor opens on the row as it is', edit.opened.h === '5:00' && edit.opened.r === '40', edit.opened);
check('saved: the new hours and rate, and what was reported kept beside them',
  edit.row.hours === 6.5 && edit.row.rate === 42 && edit.row.reported === 5 && edit.row.note === 'תוקן בטלפון', edit.row);
check('this month follows: 6.5 × ₪42', edit.month === 273, edit.month);
check('the row says what was reported', edit.listed.includes('דווח 5:00 שע׳'), edit.listed.slice(0, 200));

// a row a closing already settled: the change is kept, the balance does not move, and it says so
const closed = await page.evaluate(() => {
  Store.set('wage_payments', [{ id: 'c1', worker: 'יוסי', amount: 0, date: new Date().toISOString(), note: '', closes: { rows: ['w1'], pays: [] } }]);
  const before = workerLedger('יוסי').balance;
  editWorktime('w1');
  document.getElementById('wteHours').value = '12';
  saveWorktimeEdit('w1');
  const after = workerLedger('יוסי').balance;
  const notice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  return { before, after, hours: Store.get('worktime').find((x) => x.id === 'w1').hours, notice };
});
await hideNotice();
check('a settled row can still be corrected, and the balance stays put, with a word why',
  closed.hours === 12 && closed.before === closed.after && /כבר סגורה בתשלום/.test(closed.notice), closed);

// ---- changing a report before it is approved
const PUNCH = '33333333-3333-3333-3333-333333333333';
serverPending = [{ id: PUNCH, worker: 'יוסי', hours: 6, work_date: '2026-10-05', note: '', source: 'clock', status: 'pending' }];
const punch = await page.evaluate((id) => {
  Sync.session = { access_token: 'test.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  Store.set('worktime', []);
  renderPunches([{ id, worker: 'יוסי', hours: 6, work_date: '2026-10-05', note: '', source: 'clock', status: 'pending' }]);
  const pencil = !!document.querySelector(`#punchList [onclick="editPunch('${id}')"]`);
  editPunch(id);
  const opened = document.getElementById('peHours').value;
  document.getElementById('peHours').value = '5';
  document.getElementById('peDate').value = '2026-10-04';
  document.getElementById('peNote').value = 'יצא מוקדם';
  approveEditedPunch(id);
  return { pencil, opened };
}, PUNCH);
await page.waitForFunction(() => (Store.get('worktime') || []).length > 0, null, { timeout: 5000 }).catch(() => {});
const landed = await page.evaluate(() => (Store.get('worktime') || [])[0] || null);
check('a waiting report has a ✏️ beside ✓', punch.pencil && punch.opened === '6:00', punch);
check('approved as corrected: 5 hours on the 4th, at the hub\'s rate, the reported 6 kept',
  landed && landed.hours === 5 && landed.reported === 6 && landed.rate === 40 && landed.note === 'יצא מוקדם'
  && new Date(landed.date).getDate() === 4, landed);
check('the report is consumed on the server, as sent', patched.some((x) => x.status === 'approved') && !patched.some((x) => 'hours' in x), patched);

check('no page errors', errs.length === 0, errs.join(' | '));
check('nothing went through a dialog the phone cannot draw', dialogs.length === 0, dialogs);

await browser.close();
srv.close();
process.exit(finish());
