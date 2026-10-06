// The hub's "בוט מסחר" page: FUSION, Daniel's trading bot, seen from the hub (2026-10-05, "אני רוצה
// שיהיה טאב של בוט המסחר שבניתי בלוח הבקרה").
//
//   node test/test-fusion.mjs
//   node test/test-fusion.mjs --selftest     (the escaping undone)
//
// The Worker is stood in for (energylabgreen.com/api/fusion/status): nothing here reaches it. What the
// page must get right: it asks only with his login; it never says the bot is trading when the bot has
// stopped reporting, is down, or has lost IBKR; and a symbol or a fault message from the bot is shown
// as text, never markup (the page is public).
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
await new Promise((r) => srv.listen(4363, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));

const EVIL = '<img src=x onerror="window.__xss=1">';
const iso = (ms) => new Date(ms).toISOString();
const SNAP = {
  v: 1, at: iso(Date.now() - 30000), host: 'fusion-cloud', mode: 'paper', inWindow: true, dashboard: true, ibkr: true,
  paused: false, profile: 'balanced', pending: 2, lastScan: iso(Date.now() - 600000),
  portfolio: 1002345.5, dailyPnl: -120.4,
  positions: [{ s: 'AMD', q: 5, avg: 150, px: 140, pnl: -50, sl: 135, tp: 180 },
              { s: 'NVDA', q: 10, avg: 120, px: 125, pnl: 50, sl: null, tp: 140 },
              { s: EVIL, q: 1, avg: 1, px: 1, pnl: 0, sl: 1 }],
  top: [{ s: 'MU', dir: 'LONG', score: 81, mom: 77.5, px: 98.2, chg: 2.1 }],
  faults: [{ sev: 'warning', msg: 'סריקה איטית ' + EVIL, since: iso(Date.now() - 3600000) }],
  unprotected: ['NVDA'], pendingFixes: 1,
  trades: [{ at: iso(Date.now() - 86400000), s: 'SLB', dir: 'LONG', act: 'BUY', q: 37, entry: 60.18, status: 'CLOSED', pnl: -2.22, pnlPct: -0.1, mode: 'AUTO' },
           { at: iso(Date.now() - 2 * 86400000), s: 'XOM', dir: 'LONG', act: 'BUY', q: 8, entry: 110, status: 'OPEN', mode: 'MANUAL' }],
  stats30: { n: 4, wins: 3, pnl: 310.5 },
  equity: [['2026-09-01', 1000000], ['2026-10-04', 1002345.5]],
};
let RESP = { status: 200, body: { snapshot: null, receivedAt: null } };
const gets = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET' };
await page.route(/energylabgreen\.com\/api\/fusion\/status/, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  gets.push(req.headers()['authorization'] || '');
  return route.fulfill({ status: RESP.status, contentType: 'application/json', body: JSON.stringify(RESP.body), headers: CORS });
});
await page.route(/energylabgreen\.com\/api\/wa\//, (route) => route.fulfill({ status: 200, body: '{}', headers: CORS }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4363/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.renderFusion === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.escPunch = (s) => String(s == null ? '' : s); });

const text = () => page.evaluate(() => document.getElementById('fusionBody').innerText);
// The sections below the state are folded (2026-10-05); the content checks open them first, and the
// folding is checked on its own (the faults open by themselves, the rest folded).
let folds = [];
const show = async (body, status = 200) => {
  RESP = { status, body };
  await page.evaluate(() => renderFusion());
  folds = await page.evaluate(() => [...document.querySelectorAll('#fusionBody details.fold')].map((d) => [d.dataset.fold, d.open]));
  await page.evaluate(() => document.querySelectorAll('#fusionBody details.fold').forEach((d) => { d.open = true; }));
  return text();
};

// logged out: nothing is asked
await page.evaluate(() => { Sync.session = null; Sync.userId = null; navigateTo('fusion'); });
await page.waitForTimeout(300);
check('logged out, the page says to log in and asks nothing', /התחבר/.test(await text()) && gets.length === 0, gets.length);

await page.evaluate(() => {
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
});
let t = await show({ snapshot: null, receivedAt: null });
check('it asks with his login', gets.length === 1 && /^Bearer tok\./.test(gets[0]), gets);
check('before the bot ever sent anything, it says so', /עוד לא שלח נתונים/.test(t), t.slice(0, 200));

// a running, connected bot inside the trading hours
t = await show({ snapshot: SNAP, receivedAt: iso(Date.now() - 60000) });
check('the bot trading now', /הבוט סוחר עכשיו/.test(t) && /חשבון דמו \(Paper\)/.test(t) && /רץ על fusion-cloud/.test(t), t.slice(0, 300));
check('the account: value, today, positions', t.includes('$1,002,346') && t.includes('−$120.4') && /פוזיציות\s*3/.test(t), t.slice(0, 600));
check('what waits for his approval in the bot', /2 עסקאות מחכות לאישור/.test(t) && /1 תיקונים מחכים לאישור/.test(t), '');
check('the sections start folded, the faults open by themselves', folds.length === 5 && folds.every(([id, open]) => open === (id === 'fu-faults')), folds);
check('the faults, and a position without a stop called out', /תקלות שהבוט מזהה\s*2/.test(t) && /פוזיציות בלי סטופ: NVDA/.test(t) && /בלי סטופ/.test(t), '');
const order = await page.evaluate(() => [...document.querySelectorAll('#fusionBody .fu-sym')].map((e) => e.textContent));
check('positions from the best to the worst', order.indexOf('NVDA') < order.indexOf('AMD'), order);
check('nothing from the bot runs as markup', await page.evaluate(() => window.__xss === undefined && !document.querySelector('#fusionBody img')), '');
check('it is shown as text instead', t.includes('סריקה איטית <img src=x'), '');
check('the strongest picks, the month, and the last trades', /MU ↑ עלייה/.test(t) && /ציון 81/.test(t) && /הצליחו\s*75%/.test(t) && t.includes('+$310.5')
  && /SLB קנייה/.test(t) && /נסגרה/.test(t) && /פתוחה/.test(t) && /ידני/.test(t), t.slice(-700));
check('the portfolio over the period', t.includes('$1,000,000') && t.includes('+$2,346'), '');

// it never says "trading" when it is not
t = await show({ snapshot: SNAP, receivedAt: iso(Date.now() - 20 * 60000) });
check('stopped reporting: says so, not "trading"', /לא מדווח מאז/.test(t) && !/הבוט סוחר עכשיו/.test(t), t.slice(0, 200));
t = await show({ snapshot: { ...SNAP, dashboard: false, ibkr: undefined, positions: undefined, portfolio: undefined }, receivedAt: iso(Date.now() - 60000) });
check('the machine up but the bot down: says so, no live numbers, the history still there', /הבוט עצמו לא רץ/.test(t) && !/שווי התיק\n/.test(t)
  && !/פוזיציות פתוחות/.test(t) && /SLB/.test(t), t.slice(0, 300));
t = await show({ snapshot: { ...SNAP, ibkr: false }, receivedAt: iso(Date.now() - 60000) });
check('no IBKR: says it cannot trade', /לא מחובר ל-IBKR/.test(t) && !/הבוט סוחר עכשיו/.test(t), t.slice(0, 200));
t = await show({ snapshot: { ...SNAP, paused: true }, receivedAt: iso(Date.now() - 60000) });
check('paused', /מושהה/.test(t), t.slice(0, 200));
t = await show({ snapshot: { ...SNAP, inWindow: false }, receivedAt: iso(Date.now() - 60000) });
check('outside the trading hours', /מחוץ לשעות המסחר/.test(t), t.slice(0, 200));

// the Worker unreachable
t = await show({ error: 'failed' }, 500);
check('an error is shown, with a way to try again', /לא הצלחתי להגיע לבוט המסחר/.test(t) && /נסה שוב/.test(t), t);

// the way in from the home page
RESP = { status: 200, body: { snapshot: SNAP, receivedAt: iso(Date.now()) } };
await page.evaluate(() => navigateTo('home'));
// one "בוטים" card since 2026-10-05 (the two bots merged); its strip's "מסחר" tab is this page
await page.evaluate(() => [...document.querySelectorAll('.quick-card')].find((c) => /בוטים/.test(c.textContent)).click());
await page.evaluate(() => [...document.querySelectorAll('#page-wabot .page-group-tabs .sub-tab')].find((t) => /מסחר/.test(t.textContent)).click());
check('the home page reaches it: the בוטים card, then its מסחר tab', await page.evaluate(() => document.getElementById('page-fusion').classList.contains('active')), '');
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
