// Money the app must not misstate (2026-09-14).
//
//   node test/test-money-honesty.mjs
//   node test/test-money-honesty.mjs --selftest
//
// Two reports, one fault shape: a figure that is confidently wrong rather than missing.
//
// 1. WAGES. Daniel: "אני לא יודע איזה חודשים אחורה יש חוב לעובדים." The page warned that money
//    was owed but only as ONE TOTAL, so finding WHICH month meant stepping back through the
//    picker. Now: a card broken down by month and by worker, each openable and payable.
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

// ---------------------------------------------------------------- 1. where the wages are owed
await page.evaluate(() => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  localStorage.clear();
  localStorage.setItem('gp_workers', JSON.stringify([{ id: 'w1', name: 'יוסי', rate: 45 }, { id: 'w2', name: 'אבי', rate: 50 }]));
  localStorage.setItem('gp_worktime', JSON.stringify([
    { id: 'a', workerName: 'יוסי', rate: 45, hours: 6, date: iso(2026, 3, 4), paid: false },
    { id: 'b', workerName: 'יוסי', rate: 45, hours: 10, date: iso(2026, 3, 18), paid: false },
    { id: 'c', workerName: 'אבי', rate: 50, hours: 4, date: iso(2026, 3, 20), paid: false },
    { id: 'd', workerName: 'יוסי', rate: 45, hours: 8, date: iso(2026, 6, 2), paid: true },   // paid — must not appear
    { id: 'e', workerName: 'יוסי', rate: 45, hours: 12, date: iso(2026, 7, 9), paid: false },
  ]));
});
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); navigateTo('worktime'); });
await page.waitForTimeout(500);

if (SELFTEST) {
  // Put the old behaviour back: one total, no breakdown. The "which month" checks must go red.
  await page.evaluate(() => { window.wageDebt = () => []; renderWageDebt(); });
}

const debt = await page.evaluate(() => {
  const card = document.getElementById('wageDebtCard');
  const d = (typeof wageDebt === 'function') ? wageDebt() : [];
  return {
    shown: !!card && getComputedStyle(card).display !== 'none',
    months: d.map((x) => x.key),
    totals: d.map((x) => Math.round(x.total)),
    text: (document.getElementById('wageDebtList') || {}).innerText || '',
  };
});
check('the debt card appears when money is owed', debt.shown, debt.shown);
// The whole point: WHICH months, not just how much.
check('it names every month with an unpaid record', debt.months.join(',') === '2026-07,2026-03', debt.months);
check('newest month first', debt.months[0] === '2026-07', debt.months);
check('a month totals all its workers', debt.totals.includes(920), debt.totals);   // 720 + 200
check('a PAID month is not listed', !debt.months.includes('2026-06'), debt.months);
check('each worker is named inside the month', /יוסי/.test(debt.text) && /אבי/.test(debt.text), debt.text.slice(0, 80));
// Derived from the seeded rows, never typed: a first version asserted 1,640 against a real
// 1,460 and failed the CODE for the test's own arithmetic.
const owed = await page.evaluate(() => (Store.get('worktime') || [])
  .filter((e) => !e.paid).reduce((s, e) => s + e.hours * e.rate, 0));
check('the total owed is shown, and it is the sum of the unpaid rows',
  debt.text.replace(/\s/g, '').includes(owed.toLocaleString('he-IL')), `expected ${owed}: ${debt.text.slice(0, 40)}`);

// "How much do I owe יוסי" was three months of mental arithmetic off the per-month breakdown.
const per = await page.evaluate(() => {
  const w = (typeof wageDebtByWorker === 'function') ? wageDebtByWorker() : [];
  // the same rows totalled independently, so the check is not the code repeating itself
  const want = {};
  for (const e of (Store.get('worktime') || [])) {
    if (e.paid) continue;
    want[e.workerName] = (want[e.workerName] || 0) + e.hours * e.rate;
  }
  return { shown: w.map((x) => ({ name: x.name, wage: Math.round(x.wage), hours: x.hours, months: x.months.size })), want };
});
check('every worker owed money is listed on his own',
  per.shown.length === Object.keys(per.want).length && per.shown.length > 1, per.shown);
check('and his total is the sum of his unpaid hours across all months',
  per.shown.every((x) => Math.round(per.want[x.name]) === x.wage), { shown: per.shown, want: per.want });
check('with the hours and how many months they span',
  per.shown.every((x) => x.hours > 0 && x.months >= 1), per.shown);
// יוסי is owed for March and July; a per-month figure alone would never show the 28 hours.
check('a worker owed across several months is totalled across them',
  per.shown.some((x) => x.months >= 2), per.shown);

const paid = await page.evaluate(async () => {
  if (typeof payWageMonth !== 'function') return { skipped: true };
  const before = (Store.get('worktime') || []).filter((e) => !e.paid).length;
  payWageMonth('2026-03');
  await new Promise((r) => setTimeout(r, 150));
  noticeConfirm();                       // offsetParent is null on a fixed element; call it
  await new Promise((r) => setTimeout(r, 300));
  return {
    left: wageDebt().map((x) => x.key),
    pays: getWagePayments().map((p) => p.forMonth),
    rowsUntouched: (Store.get('worktime') || []).filter((e) => !e.paid).length === before,
  };
});
check('paying a month clears exactly that month',
  !paid.skipped && paid.left.join(',') === '2026-07', paid);
check('and it is recorded as dated payments for that month, not by rewriting the hours',
  paid.pays && paid.pays.length > 0 && paid.pays.every((m) => m === '2026-03') && paid.rowsUntouched, paid);

// ---- v318: payments are records — amount + date — and the balance is derived ----
if (SELFTEST) {
  // A real way to get this wrong: save the payment without the month it was made for, so it
  // lands on the oldest debt instead of the month the button was pressed on.
  await page.evaluate(() => {
    const orig = saveWagePayment;
    window.saveWagePayment = () => { if (WT_PAY_CTX) WT_PAY_CTX.forMonth = null; orig(); };
  });
}
const led = await page.evaluate(async () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 9)).toISOString();
  Store.set('wage_payments', []);
  Store.set('worktime_trash', []);
  Store.set('workers', [{ id: 'k1', name: 'יוסי', rate: 45 }, { id: 'k2', name: 'אבי', rate: 40 }]);
  Store.set('worktime', [
    { id: 'p1', workerName: 'יוסי', rate: 45, hours: 4, date: iso(2026, 5, 3), paid: false },
    { id: 'p2', workerName: 'אבי', rate: 40, hours: 5, date: iso(2026, 5, 4), paid: false },
    { id: 'p3', workerName: 'יוסי', rate: 45, hours: 6, date: iso(2026, 4, 9), paid: false },
  ]);
  openWageMonth('2026-05');
  const i = WT_MONTH_WORKERS.findIndex((w) => w.name === 'יוסי');
  if (i < 0) return { missing: true };
  payWorkerMonth(i);                                   // opens the form, prefilled
  const pre = Number(document.getElementById('payAmount').value);
  saveWagePayment();
  closeNotice();
  const L1 = workerLedger('יוסי');
  const may = L1.months.find((m) => m.key === '2026-05'), apr = L1.months.find((m) => m.key === '2026-04');
  const avi = workerLedger('אבי');
  // an advance beyond what is owed
  openPayModal('יוסי');
  document.getElementById('payAmount').value = '500';
  saveWagePayment();
  closeNotice();
  const L2 = workerLedger('יוסי');
  return { pre, mayLeft: may.left, aprLeft: apr.left, avi: avi.balance, balAfterAdvance: L2.balance,
    payCount: getWagePayments().length, dated: getWagePayments().every((p) => !isNaN(new Date(p.date))) };
});
check('the month button prefills what that worker is owed for that month', led.pre === 180, led);
check('and the payment settles THAT month, not the oldest one', led.mayLeft === 0 && led.aprLeft === 270, led);
check('another worker is untouched', led.avi === 200, led);
check('an advance beyond the debt shows as a credit, not a negative debt hidden away', led.balAfterAdvance === -230, led);
check('every payment is a dated record', led.payCount === 2 && led.dated, led);

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

// ---- merging two spellings of one worker ----
if (SELFTEST) {
  // The realistic slip: move the hours but forget the payments.
  await page.evaluate(() => {
    window.mergeWorker = (from, into) => {
      const wt = Store.get('worktime') || [];
      wt.forEach((e) => { if (e.workerName === from) e.workerName = into; });
      Store.set('worktime', wt);
      return { rows: 0, pays: 0 };
    };
  });
}
const mg = await page.evaluate(async () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 9)).toISOString();
  Store.set('workers', [{ id: 'a', name: 'שמואל אמירי', rate: 45 }, { id: 'b', name: 'שמואל', rate: 40 }]);
  Store.set('worktime', [
    { id: 'm1', workerName: 'שמואל אמירי', rate: 45, hours: 10, date: iso(2026, 8, 3), paid: false },
    { id: 'm2', workerName: 'שמואל', rate: 40, hours: 5, date: iso(2026, 8, 4), paid: false },
  ]);
  Store.set('wage_payments', [{ id: 'q1', worker: 'שמואל', amount: 100, date: iso(2026, 8, 10) }]);
  const before = workerLedger('שמואל אמירי').balance + workerLedger('שמואל').balance;
  openWorker('שמואל אמירי');
  openMergeWorker();
  const btn = [...document.querySelectorAll('#modalBody button, .modal button')].find((b) => /^שמואל(?! אמירי)/.test(b.textContent.trim()));
  if (!btn) return { missing: true };
  btn.click();
  await new Promise((r) => setTimeout(r, 100));
  noticeConfirm();
  await new Promise((r) => setTimeout(r, 100));
  const L = workerLedger('שמואל אמירי');
  const ws = getWorkers();
  return {
    before, after: L.balance, gone: workerLedger('שמואל').earned === 0 && workerLedger('שמואל').paidTotal === 0,
    rates: (Store.get('worktime') || []).map((e) => e.rate).join(','),
    workers: ws.map((w) => w.name).join(','), alias: (ws[0].aliases || []).join(','),
    punchMatch: (findWorkerFor('שמואל') || {}).name,
  };
});
check('merging puts both spellings\' hours AND payments on one worker, balance unchanged',
  !mg.missing && mg.gone && Math.round(mg.after) === Math.round(mg.before), mg);
check('each hour keeps the rate it was recorded at', mg.rates === '45,40', mg);
check('one entry is left in the workers list, and the old spelling still finds him',
  mg.workers === 'שמואל אמירי' && mg.alias === 'שמואל' && mg.punchMatch === 'שמואל אמירי', mg);

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
