// The same money twice in the finances (2026-10-23).
//
//   node test/test-income-dupes.mjs
//   node test/test-income-dupes.mjs --selftest
//
// Daniel asked whether July's income was counted twice. A month adds every repair, every paid sale and
// every income line (finMonthly), and the WhatsApp import brought in his payments from the chats. Some
// of them were the same money as a sale already on the sales page: one line was the sale itself,
// another was the deposit on a sale. Nothing looked for them. Since v499 the finances page shows each
// such line (⚠️ אולי נספר פעמיים) with מחק and לא כפול, and a line still waiting in 📲 מהוואטסאפ says
// what it may already be. Every value below is made up.
//
// What must hold:
//   1. a chat payment equal to a paid sale's total, to its deposit, or to a repair's price, up to three
//      days apart, is on the card. Four days apart, another amount, a quote's, a line typed by hand,
//      one from the books, or one marked לא כפול: not on it.
//   2. מחק removes that line only, and the month drops by its amount. לא כפול keeps the line and its
//      money and takes it off the card, also after a reload.
//   3. a write the storage refuses changes nothing, and the line stays offered. That includes the
//      tombstone a removed row leaves, which is written first and would delete the line at the next sync.
//   4. a line waiting in 📲 מהוואטסאפ that matches an income, a sale's deposit or an expense says so; a
//      line that matches nothing says nothing.
//   5. the deposit the check looks for is the one the quote asks for.
// --selftest puts back the hub before v499 (no card, no mark), so 1, 2 and 4 go red.
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
await new Promise((r) => srv.listen(4390, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4390/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // The hub before v499: the month adds everything and nothing looks for the same money twice.
  await page.evaluate(() => { window.incomeDupes = () => []; window.waLedgerBooked = () => ''; });
}

// One month of made-up money: what the sales page holds, and the chat lines beside it.
const SEED = {
  orders: [
    { id: 'o1', date: '2026-03-10T15:00:00.000Z', status: 'נמסר', total: 1900, customer: 'לקוח א', items: [] },
    { id: 'o2', date: '2026-03-14T11:00:00.000Z', status: 'שולם', total: 3000, customer: 'לקוח ב', items: [] },
    { id: 'o3', date: '2026-03-20T11:00:00.000Z', status: 'הצעה', total: 2600, customer: 'לקוח ג', items: [] },
    { id: 'o4', date: '2026-03-25T09:00:00.000Z', status: 'נמסר', total: 2200, customer: 'לקוח ד', items: [] },
    { id: 'o5', date: '2026-03-25T09:00:00.000Z', status: 'נמסר', total: 2300, customer: 'לקוח ה', items: [] },
    { id: 'o6', date: '2026-03-18T09:00:00.000Z', status: 'נמסר', total: 4000, customer: 'לקוח ו', items: [] },
  ],
  jobs: [{ id: 'j1', date: '2026-03-05T10:00:00.000Z', price: 350, customerName: 'לקוח ז', jobs: [] }],
  incomes: [
    { id: 'i1', amount: 1900, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 10.3.2026', date: '2026-03-10T00:00:00.000Z' },
    { id: 'i2', amount: 1500, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 14.3.2026', date: '2026-03-14T00:00:00.000Z' },
    { id: 'wa_t9', amount: 350, cat: 'תיקונים ומכירות', note: 'לקוח ז — ביט', date: '2026-03-06T10:00:00.000Z', src: 'wa' },
    { id: 'i4', amount: 2600, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 20.3.2026', date: '2026-03-20T00:00:00.000Z' },
    { id: 'i5', amount: 2200, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 28.3.2026', date: '2026-03-28T00:00:00.000Z' },
    { id: 'i6', amount: 2300, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 29.3.2026', date: '2026-03-29T00:00:00.000Z' },
    { id: 'i7', amount: 1900, cat: 'תיקונים ומכירות', note: 'לקוח א', date: '2026-03-10T00:00:00.000Z' },
    { id: 'i8', amount: 1900, cat: 'תיקונים ומכירות', note: 'לקוח א', date: '2026-03-10T00:00:00.000Z', src: 'books', locked: true },
    { id: 'i9', amount: 1900, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 11.3.2026', date: '2026-03-11T00:00:00.000Z', notDup: true },
    { id: 'i10', amount: 1950, cat: 'תיקונים ומכירות', note: 'יובא מוואטסאפ · Green Power · 10.3.2026', date: '2026-03-10T00:00:00.000Z' },
  ],
  expenses: [{ id: 'e1', amount: 120, cat: 'אחר', note: 'נסיעה', date: '2026-03-07T10:00:00.000Z' }],
};
const FLAGGED = ['i1', 'i2', 'i5', 'wa_t9'];

const seed = (s) => page.evaluate((s) => {
  bizDetails.depositPct = 50;
  for (const k of ['orders', 'jobs', 'incomes', 'expenses']) Store.set(k, JSON.parse(JSON.stringify(s[k])));
  Store.set('tomb_incomes', {});
  navigateTo('finances');
  renderFinances();
}, s);
const cardState = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#finDupes [data-dup]')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
  return { ids: incomeDupes().map((x) => x.line.id).sort(), rows, title: (document.getElementById('finDupes') || {}).textContent || '' };
});
const monthIncome = () => page.evaluate(() => (finMonthly()['2026-03'] || {}).inc || 0);
const income = () => page.evaluate(() => Object.fromEntries((Store.get('incomes') || []).map((r) => [r.id, r])));

// ---------------------------------------------------------------- 1. what is on the card
await seed(SEED);
const C1 = await cardState();
check('the card holds the chat lines that are a sale, a deposit, a repair, three days apart',
  C1.ids.join() === FLAGGED.slice().sort().join() && C1.rows.length === 4 && /אולי נספר פעמיים/.test(C1.title), C1);
const row = (re) => C1.rows.find((t) => re.test(t)) || '';
check('the sale itself: "מכירה של ₪1,900"', /₪1,900 מהוואטסאפ/.test(row(/1,900/)) && /מכירה של ₪1,900/.test(row(/1,900/)) && /לקוח א/.test(row(/1,900/)), row(/1,900/));
check('the deposit: "מקדמה על מכירה של ₪3,000"', /₪1,500 מהוואטסאפ/.test(row(/1,500/)) && /מקדמה על מכירה של ₪3,000/.test(row(/1,500/)), row(/1,500/));
check('a repair: "תיקון של ₪350"', /תיקון של ₪350/.test(row(/₪350 מהוואטסאפ/)), row(/₪350/));
check('not on it: four days apart, a quote, typed by hand, the books, לא כפול, another amount',
  !['i4', 'i6', 'i7', 'i8', 'i9', 'i10'].some((id) => C1.ids.includes(id)), C1.ids);

// ---------------------------------------------------------------- 2. מחק and לא כפול
const before = await monthIncome();
const D = await page.evaluate(() => {
  const i = incDupes.findIndex((x) => x.line.id === 'i1');
  dropDupIncome(i);
  const asked = document.getElementById('noticeBody').textContent;
  noticeConfirm();
  return { i, asked };
});
const afterDrop = await income();
const C2 = await cardState();
check('מחק asks first, and says the sale stays', D.i >= 0 && /למחוק את ₪1,900 מהוואטסאפ/.test(D.asked) && /המכירה נשארת/.test(D.asked), D);
check('…and removes that line only', !afterDrop.i1 && afterDrop.i7 && afterDrop.i8 && afterDrop.i9 && afterDrop.i2 && Object.keys(afterDrop).length === SEED.incomes.length - 1, Object.keys(afterDrop));
check('…the month drops by ₪1,900, and the line is off the card', before - (await monthIncome()) === 1900 && !C2.ids.includes('i1') && C2.rows.length === 3, { before, C2 });
await page.evaluate(() => keepDupIncome(incDupes.findIndex((x) => x.line.id === 'i5')));
const afterKeep = await income();
const C3 = await cardState();
check('לא כפול keeps the line and its money, and takes it off the card',
  afterKeep.i5 && afterKeep.i5.notDup === true && afterKeep.i5.amount === 2200 && !C3.ids.includes('i5') && C3.rows.length === 2
  && before - (await monthIncome()) === 1900, { i5: afterKeep.i5, C3 });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); navigateTo('finances'); renderFinances(); });
if (SELFTEST) await page.evaluate(() => { window.incomeDupes = () => []; window.waLedgerBooked = () => ''; });
const C4 = await cardState();
check('…for good: after a reload the card holds the deposit and the repair only', C4.ids.join() === 'i2,wa_t9' && C4.rows.length === 2, C4);

// ---------------------------------------------------------------- 3. a write the storage refuses
const R = await page.evaluate(() => {
  const real = Storage.prototype.setItem;
  let refused = 0;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'gp_incomes') { refused++; throw new DOMException('full', 'QuotaExceededError'); }
    return real.call(this, k, v);
  };
  const said = [];
  try {
    dropDupIncome(incDupes.findIndex((x) => x.line.id === 'i2'));
    noticeConfirm();
    said.push(document.getElementById('noticeBody').textContent);
    closeNotice();
    keepDupIncome(incDupes.findIndex((x) => x.line.id === 'wa_t9'));
    said.push(document.getElementById('noticeBody').textContent);
    closeNotice();
  } finally { Storage.prototype.setItem = real; }
  renderFinances();
  const inc = Object.fromEntries((Store.get('incomes') || []).map((r) => [r.id, r]));
  return { refused, said, i2: !!inc.i2, keptFlag: !!(inc.wa_t9 && inc.wa_t9.notDup), offered: incomeDupes().map((x) => x.line.id).sort().join(),
    tombs: Object.keys(Store.get('tomb_incomes') || {}) };
});
check('a refused write deletes nothing and marks nothing, and both lines stay offered',
  R.refused === 2 && R.i2 && !R.keptFlag && R.offered === 'i2,wa_t9', R);
// a removed row's tombstone is written before the list: left there, it deletes the line at the next sync
check('…and the refused מחק leaves no tombstone for the line', R.tombs && !R.tombs.includes('i2'), R.tombs);
check('…and the notice is the storage\'s', R.said.length === 2 && R.said.every((t) => /האחסון/.test(t)), R.said);

// ---------------------------------------------------------------- 4. the lines still waiting in 📲 מהוואטסאפ
await seed(SEED);
if (SELFTEST) await page.evaluate(() => { window.incomeDupes = () => []; window.waLedgerBooked = () => ''; });
const W = await page.evaluate(() => {
  waLedger = [
    { id: 't1', d: '2026-03-15', a: 1500, kind: 'income', who: 'לקוח ב', note: 'ביט' },
    { id: 't2', d: '2026-03-19', a: 2000, kind: 'income', who: 'לקוח ו', note: 'מקדמה' },
    { id: 't3', d: '2026-03-08', a: 120, kind: 'expense', who: 'נסיעה', note: '' },
    { id: 't4', d: '2026-03-01', a: 777, kind: 'income', who: 'לקוח ח', note: '' },
    { id: 't5', d: '2026-03-10', a: 1900, kind: 'expense', who: 'ספק', note: '' },
  ];
  waLedgerAt = Date.now();
  renderWaLedger();
  const mark = (id) => { const el = document.querySelector(`[data-wa-line="${id}"] [data-wa-booked]`); return el ? el.textContent.trim() : ''; };
  return { t1: mark('t1'), t2: mark('t2'), t3: mark('t3'), t4: mark('t4'), t5: mark('t5'),
    lines: document.querySelectorAll('#finWaLedger [data-wa-line]').length };
});
check('a waiting line that is an income already says so', /אולי כבר רשום: הכנסה של ₪1,500/.test(W.t1), W);
check('…one that is a sale\'s deposit says which sale', /אולי כבר רשום: מקדמה על מכירה של ₪4,000/.test(W.t2) && /לקוח ו/.test(W.t2), W);
check('…an expense already booked says so', /אולי כבר רשום: הוצאה של ₪120/.test(W.t3), W);
check('…and one that matches nothing, or an expense the size of a sale, says nothing', W.lines === 5 && !W.t4 && !W.t5, W);

// ---------------------------------------------------------------- 5. the deposit is the quote's
const Q = await page.evaluate(() => {
  const o = { id: 'q1', date: '2026-03-02T09:00:00.000Z', status: 'הצעה', total: 3000, customer: 'לקוח ט', items: [] };
  const at = (pct) => {
    bizDetails.depositPct = pct;
    const text = buildQuoteText(o);
    const m = text.match(/מקדמה לתחילת עבודה:\*\s*(₪[\d,]+)/), b = text.match(/יתרה לתשלום במסירה:\*\s*(₪[\d,]+)/);
    const s = saleDeposit(3000);
    return { quoted: m && m[1], balance: b && b[1], check: shek(s.deposit), checkBal: shek(s.balance) };
  };
  const r = { p50: at(50), p30: at(30) };
  bizDetails.depositPct = 50;
  return r;
});
check('the quote and the check agree on the deposit and the balance (50% and 30%)',
  Q.p50.quoted === '₪1,500' && Q.p50.check === '₪1,500' && Q.p30.quoted === '₪900' && Q.p30.check === '₪900'
  && Q.p30.balance === '₪2,100' && Q.p30.checkBal === '₪2,100', Q);

if (SELFTEST) console.log('\n[selftest] the hub before v499 — nothing looks for the same money twice;\n[selftest] the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
