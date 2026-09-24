// Money the app must not misstate (2026-09-14).
//
//   node test/test-money-honesty.mjs
//   node test/test-money-honesty.mjs --selftest
//
// Two reports, one fault shape: a figure that is confidently wrong rather than missing.
//
// 1. WAGES. One running account per worker (v323): what is owed, dated payments, and a
//    closing that settles it — no months to page through.
//
// 2. MONTHS WITH NO EXPENSES. After importing the accountant's books the page read
//    "רווח מצטבר ₪284,895" for 2020-2025 — five years of income against zero recorded cost,
//    shown as profit. Estimating the cost was considered and rejected on evidence: only 53% of
//    that revenue can be costed from what the rows say was sold, the packs were built on
//    Sony/Samsung/BASEN cells today's model does not price, and the estimate landed at a 67%
//    blended margin — the top of his range, i.e. leaning one way. So the app states what it
//    knows and refuses to imply the rest.
//
// 3. And the nine negative rows are CREDIT NOTES: each carries its own invoice number from his
//    outgoing series and mirrors a positive row of the same amount to the same customer days
//    earlier. Unlabelled they read as "negative income", which is not a thing.
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
await new Promise((r) => srv.listen(4349, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4349/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

// ---------------------------------------------------------------- 1. what is owed to whom
// v323: one running account per worker, no months. Daniel: "שמואל קיבל 2900 ואין לו עוד חוב —
// צריך לסמן שאין לי חוב עליו, לא רק מקדמה" and "לא רוצה לדפדף לפי חודשים".
await page.evaluate(() => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  localStorage.clear();
  localStorage.setItem('gp_workers', JSON.stringify([{ id: 'w1', name: 'יוסי', rate: 45 }, { id: 'w2', name: 'אבי', rate: 50 }]));
  localStorage.setItem('gp_worktime', JSON.stringify([
    { id: 'a', workerName: 'יוסי', rate: 45, hours: 6, date: iso(2026, 3, 4), paid: false },
    { id: 'b', workerName: 'יוסי', rate: 45, hours: 10, date: iso(2026, 3, 18), paid: false },
    { id: 'c', workerName: 'אבי', rate: 50, hours: 4, date: iso(2026, 3, 20), paid: false },
    { id: 'd', workerName: 'יוסי', rate: 45, hours: 8, date: iso(2026, 6, 2), paid: true },   // old flag — settled
    { id: 'e', workerName: 'יוסי', rate: 45, hours: 12, date: iso(2026, 7, 9), paid: false },
  ]));
});
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); navigateTo('worktime'); });
await page.waitForTimeout(500);

const acct = await page.evaluate(() => ({
  noMonthPicker: !document.getElementById('wtMonth'),
  text: document.getElementById('wageDebtList').innerText,
  yossi: workerLedger('יוסי').balance, avi: workerLedger('אבי').balance,
}));
check('the clock page has no month to page through', acct.noMonthPicker, acct);
// Derived from the seed, never typed: (6 + 10 + 12) x 45 and 4 x 50.
check('each worker\'s debt is the sum of ALL his unpaid hours', acct.yossi === 1260 && acct.avi === 200, acct);
check('an hour flagged paid the old way is not owed', acct.yossi === 1260, acct);
check('the list names every worker with what is owed and the total',
  /יוסי/.test(acct.text) && /אבי/.test(acct.text) && acct.text.replace(/\s/g, '').includes('1,460'), acct.text.slice(0, 120));

if (SELFTEST) {
  // The v318 behaviour this replaced: a payment that covers everything is still just a payment,
  // and the page calls the difference an advance instead of letting him close the account.
  await page.evaluate(() => { window.saveWagePayment = ((orig) => () => orig(false))(saveWagePayment); });
}
const paidAll = await page.evaluate(async () => {
  // He paid יוסי MORE than the hours on file (hours that were never typed in) and says: no debt.
  openPayModal('יוסי');
  const pre = Number(document.getElementById('payAmount').value);
  document.getElementById('payAmount').value = '1500';
  saveWagePayment(true);
  closeNotice();
  const L = workerLedger('יוסי');
  return { pre, balance: L.balance, closed: !!L.lastClose, text: document.getElementById('wageDebtList').innerText };
});
check('"שילמתי" prefills everything he is owed', paidAll.pre === 1260, paidAll);
check('paying and closing leaves NO debt and NO "advance", whatever the difference',
  paidAll.balance === 0 && paidAll.closed, paidAll);
check('and the list says so', /אין חוב/.test(paidAll.text), paidAll.text.slice(0, 160));

const after = await page.evaluate(async () => {
  // A new shift after the closing is owed again — the closing named the hours it settled.
  const wt = Store.get('worktime'); wt.push({ id: 'f', workerName: 'יוסי', rate: 45, hours: 2, date: new Date(2026, 2, 1).toISOString(), paid: false });
  Store.set('worktime', wt);
  const back = workerLedger('יוסי').balance;
  // A part payment leaves the rest owed; closing without paying settles what is left.
  openPayModal('אבי');
  document.getElementById('payAmount').value = '50';
  saveWagePayment(false);
  closeNotice();
  const part = workerLedger('אבי').balance;
  closeAccount('אבי');
  await new Promise((r) => setTimeout(r, 100));
  noticeConfirm();
  await new Promise((r) => setTimeout(r, 100));
  closeNotice();
  const pays = getWagePayments();
  return { back, part, closedAvi: workerLedger('אבי').balance, dated: pays.every((p) => !isNaN(new Date(p.date))), n: pays.length };
});
check('hours added after a closing are owed again — even back-dated ones', after.back === 90, after);
check('a part payment leaves the rest owed', after.part === 150, after);
check('"אין חוב" settles what is left without inventing a payment', after.closedAvi === 0, after);
check('every payment and closing is a dated record', after.dated && after.n === 3, after);

// rows the trash and phone-report sections below work on
await page.evaluate(() => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 9)).toISOString();
  Store.set('wage_payments', []);
  Store.set('worktime_trash', []);
  Store.set('workers', [{ id: 'k1', name: 'יוסי', rate: 45 }, { id: 'k2', name: 'אבי', rate: 40 }]);
  Store.set('worktime', [
    { id: 'p1', workerName: 'יוסי', rate: 45, hours: 4, date: iso(2026, 5, 3), paid: false },
    { id: 'p2', workerName: 'אבי', rate: 40, hours: 5, date: iso(2026, 5, 4), paid: false },
  ]);
});

// ---- v318: delete goes to a trash and comes back ----
const tr = await page.evaluate(async () => {
  deleteWorktime('p2');
  await new Promise((r) => setTimeout(r, 100));
  noticeConfirm();
  const gone = !(Store.get('worktime') || []).some((e) => e.id === 'p2');
  const inTrash = getWorktimeTrash().length;
  restoreFromTrash(0);
  closeNotice();
  return { gone, inTrash, back: (Store.get('worktime') || []).some((e) => e.id === 'p2'), trashAfter: getWorktimeTrash().length };
});
check('deleting hours moves them to the trash', tr.gone && tr.inTrash === 1, tr);
check('and they can be restored from it', tr.back && tr.trashAfter === 0, tr);

// ---- v318: approved phone reports can be brought back, at the hub's rate ----
const pr = await page.evaluate(async () => {
  Sync.isAuthed = () => true;
  Sync._headers = async () => ({});
  const realFetch = window.fetch;
  window.fetch = async (url) => /worker_punches/.test(String(url))
    ? new Response(JSON.stringify([
        { id: 'u-1', worker: 'אבי', work_date: '2026-05-04', hours: 5, note: '' },        // already there (same shift)
        { id: 'u-2', worker: 'אבי', work_date: '2026-05-11', hours: 3.5, note: 'שעון: 08:00–11:30' },
        { id: 'u-3', worker: 'זר', work_date: '2026-05-12', hours: 9, note: '' },          // not a known worker
      ]), { status: 200 })
    : realFetch(url);
  await restoreFromPunches();
  await new Promise((r) => setTimeout(r, 100));
  noticeConfirm();
  window.fetch = realFetch;
  const rows = (Store.get('worktime') || []).filter((e) => e.punchId);
  return { rows: rows.map((e) => [e.punchId, e.workerName, e.hours, e.rate]) };
});
check('a missing approved report comes back, once, at the rate in the workers list',
  pr.rows.length === 1 && pr.rows[0][0] === 'u-2' && pr.rows[0][3] === 40, pr);

// ---- v321: tapping a worker's name opens his own page with everything on it ----
if (SELFTEST) {
  // Break it the way it would really break: the page renders the FIRST worker, not the one tapped.
  await page.evaluate(() => { window.openWorker = () => { WT_WORKER = getWorkers()[0].name; navigateTo('worker'); }; });
}
const wp = await page.evaluate(async () => {
  navigateTo('worktime');
  const link = [...document.querySelectorAll('#wageDebtList .wt-name-link')].find((a) => a.textContent === 'אבי');
  if (!link) return { missing: true };
  link.click();
  await new Promise((r) => setTimeout(r, 100));
  const active = (document.querySelector('.page.active') || {}).id;
  const text = document.getElementById('page-worker').innerText;
  return { active, title: document.getElementById('wkTitle').textContent, owes: workerLedger('אבי').balance, text: text.slice(0, 200), has: [Math.round(workerLedger('אבי').balance).toLocaleString('he-IL'), 'תעריף עכשיו', 'כל השעות'].every((s) => text.includes(s)) };
});
check('tapping a name on the clock page opens that worker\'s own page',
  !wp.missing && wp.active === 'page-worker' && /אבי/.test(wp.title || ''), wp);
check('and it shows his balance, his rate and his hours',
  !wp.missing && wp.has, wp);

// ---- the same money counted twice: old "paid" flag + a payment for it (2026-09-24) ----
if (SELFTEST) await page.evaluate(() => { window.wtAutoFixDups = () => {}; });
const dp = await page.evaluate(async () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 9)).toISOString();
  Store.set('workers', [{ id: 's', name: 'שמואל אמירי', rate: 45 }]);
  Store.set('worktime', [
    { id: 'L1', workerName: 'שמואל אמירי', rate: 45, hours: 40, date: iso(2026, 8, 3), paid: true },
    { id: 'L2', workerName: 'שמואל אמירי', rate: 45, hours: 22.27, date: iso(2026, 8, 20), paid: true },
    { id: 'L3', workerName: 'שמואל אמירי', rate: 45, hours: 3, date: iso(2026, 9, 1), paid: false },
  ]);
  const legacy = Math.round((40 + 22.27) * 45 * 100) / 100;
  Store.set('wage_payments', [{ id: 'dupP', worker: 'שמואל אמירי', amount: legacy, date: iso(2026, 9, 23),
    closes: { rows: ['L3'], pays: ['dupP'] } }]);
  Store.set('worktime_trash', []);
  navigateTo('worktime');
  await new Promise((r) => setTimeout(r, 100));
  closeNotice();
  const L = workerLedger('שמואל אמירי');
  const received = L.paidTotal + L.legacyPaid;
  const stillClosed = L.balance === 0;
  // he says "no, that payment was real" — bring it back; it must not be removed again
  restoreFromTrash(0);
  closeNotice();
  navigateTo('worktime');
  await new Promise((r) => setTimeout(r, 100));
  closeNotice();
  const back = workerLedger('שמואל אמירי');
  return { legacy, received, stillClosed, backReceived: back.paidTotal + back.legacyPaid };
});
check('a payment that duplicates the old "paid" hours is removed on its own', Math.round(dp.received) === Math.round(dp.legacy), dp);
check('and the account stays closed — nothing is suddenly owed', dp.stillClosed, dp);
check('restored from the trash, it is his call and stays', Math.round(dp.backReceived) === Math.round(dp.legacy * 2), dp);

// ---- an import's costs from a file: added, never duplicated ----
const sh = await page.evaluate(async () => {
  Store.set('expenses', [{ id: 'x1', amount: 400, cat: 'אחר', note: 'ידני', date: new Date(2026, 8, 5).toISOString() }]);
  const file = JSON.stringify({ id: 'ship-t', expenses: [
    { amount: 27330, cat: 'רכש תאים', note: 'a', date: '2026-09-24' },
    { amount: 400, cat: 'שילוח ומכס', note: 'b', date: '2026-09-24' }] });
  const run = async () => {
    openShipmentImport();
    document.getElementById('shipJson').value = file;
    importShipment();
    await new Promise((r) => setTimeout(r, 100));
    const warn = (document.getElementById('noticeBackdrop') || {}).innerText || '';
    if (typeof _noticeYes === 'function' || /להוסיף/.test(warn)) noticeConfirm(); else closeNotice();
    await new Promise((r) => setTimeout(r, 100));
    return warn;
  };
  const w1 = await run();
  const n1 = (Store.get('expenses') || []).length;
  await run();
  const n2 = (Store.get('expenses') || []).length;
  return { n1, n2, warnedDupe: /כבר יש הוצאה באותו סכום/.test(w1) };
});
check('a shipment file adds its expenses', sh.n1 === 3, sh);
check('loading the same file again adds nothing', sh.n2 === 3, sh);
check('a same-amount expense in the same month is pointed out before saving', sh.warnedDupe, sh);

// A clock note "שעון: 09:02–15:32" read backwards in RTL until the span was isolated.
const note = await page.evaluate(() => (typeof wtNoteHtml === 'function') ? wtNoteHtml('שעון: 09:02–15:32') : '');
check('a shift\'s times are isolated left-to-right so they do not flip',
  /<bdi dir="ltr">09:02–15:32<\/bdi>/.test(note), note);

// ---------------------------------------------------------------- 2. months with no expenses
const fin = await page.evaluate(() => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  localStorage.setItem('gp_worktime', JSON.stringify([]));
  localStorage.setItem('gp_incomes', JSON.stringify([
    { id: 'o1', amount: 10000, date: iso(2021, 5, 4), src: 'books', locked: true, customer: 'היסטוריה', note: 'מכירה' },
    { id: 'o2', amount: -2500, date: iso(2021, 5, 9), src: 'books', locked: true, customer: 'היסטוריה', note: 'מכירה', invoice: '700099' },
    { id: 'n1', amount: 8000, date: iso(2026, 4, 1), note: 'יובא מוואטסאפ' },
  ]));
  localStorage.setItem('gp_expenses', JSON.stringify([{ id: 'e1', amount: 3000, date: iso(2026, 4, 5), cat: 'רכש', note: 'תאים' }]));
  navigateTo('finances');
  const t = document.getElementById('page-finances').innerText;
  const m = t.match(/סה"כ הכנסות\s*₪([\d,]+)[\s\S]*?סה"כ הוצאות\s*₪([\d,]+)[\s\S]*?רווח מצטבר\s*₪([\d,\-]+)/);
  return {
    income: m ? Number(m[1].replace(/,/g, '')) : null,
    profit: m ? Number(m[3].replace(/,/g, '')) : null,
    note: (t.match(/\d+ חודשים עם הכנסות בלבד[^\n]*/) || [''])[0],
    incomeOnly: (t.match(/הכנסות בלבד, הוצאות לא נרשמו/g) || []).length,
  };
});
// 2021-05 has 10,000 - 2,500 = 7,500 income and NO expenses; 2026-04 has 8,000 - 3,000.
check('total income still counts every month', fin.income === 15500, fin);
// The one that was wrong: 2021 must not contribute 7,500 of "profit" it never earned.
check('a month with no expense data is left OUT of the cumulative profit', fin.profit === 5000, fin);
check('and the page says how much income that leaves out', /7,?500/.test(fin.note.replace(/\s/g, '')), fin.note);
check('that month is labelled, not shown as profit', fin.incomeOnly === 1, fin.incomeOnly);

// ---------------------------------------------------------------- 3. a credit note is not income
const credit = await page.evaluate(() => {
  toggleFinMonth('2021-05');
  const t = document.getElementById('page-finances').innerText;
  return { labels: (t.match(/זיכוי/g) || []).length, text: (t.match(/[^\n]*זיכוי[^\n]*/) || [''])[0] };
});
check('a negative books row is labelled a credit note', credit.labels === 1, credit);
check('and an ordinary row is not', !/יובא מוואטסאפ.*זיכוי/.test(credit.text), credit.text.slice(0, 60));

if (SELFTEST) console.log('\n[selftest] wageDebt() was emptied;\n[selftest] the checks naming WHICH month is owed must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
