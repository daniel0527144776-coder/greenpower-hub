// The hub's pop-up alerts (2026-10-05, Daniel: "תעשה גם שקופץ התראות בלוח הבקרה אם יש על מה
// להתריע"). He chose four: the bot's open questions, stuck work, the backup, the sync.
//
//   node test/test-alerts.mjs
//   node test/test-alerts.mjs --selftest     (the escaping undone, _u ignored, the open-modal guard gone)
//
// What must hold: each alert appears exactly when its condition does and not otherwise — a job
// whose status moved yesterday is not stuck, a row older than the status field is not stuck, a push
// in flight is not a sync alert; the list pops up only when it is new (the same list waits for the
// next day), never over a window he has open or the login; a customer's name is text, not markup;
// each button goes where it says; the phone, which cannot download, is never told to back up.
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
await new Promise((r) => srv.listen(4371, r));
const browser = await chromium.launch();
const errs = [];

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
const BOT = { settings: {}, log: [], paused: [], teach: [], stats: {}, now: Date.now(), wa: 'authorized', configured: true,
  questions: [{ id: 'q1', at: Date.now(), c: '972501234567@c.us', n: 'יוסי', q: 'יש מטען?', done: false },
              { id: 'q2', at: Date.now(), c: '972501234568@c.us', n: 'דוד', q: 'מתי פתוח?', done: false },
              { id: 'q0', at: Date.now(), c: '972501234569@c.us', n: 'משה', q: 'ישנה', done: true }] };
const gets = [];
async function open({ native = false } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  if (native) await page.addInitScript(() => { window.GP_NATIVE = true; });
  await page.route(/energylabgreen\.com\/api\/wa\/admin/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    gets.push(req.headers()['authorization'] || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOT), headers: CORS });
  });
  await page.route(/energylabgreen\.com\/api\/wa\/index/, (route) => route.fulfill({ status: 200, body: '{}', headers: CORS }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
  await page.goto('http://localhost:4371/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.checkHubAlerts === 'function', null, { timeout: 30000 });
  // A fresh browser has no session, so the login is up; the steps below are him, logged in.
  // The load's own heartbeat (4s) and the minute timer must not race the steps below: the test
  // drives checkHubAlerts itself. The real heartbeat is kept to be called on purpose.
  await page.evaluate(() => { window._realHeartbeat = alertHeartbeat; window.alertHeartbeat = () => {}; closeModal(); closeNotice(); hideLogin(); });
  return page;
}

const page = await open();
const DAY = 86400000;
const EVIL = '<img src=x onerror="window.__xss=1">';
// Rows written straight to storage: Store.set stamps every new row with _u = now, which is right
// for an edit and would make every row here "touched today".
await page.evaluate(({ DAY, EVIL }) => {
  const now = Date.now(), ago = (d) => new Date(now - d * DAY).toISOString();
  localStorage.setItem('gp_jobs', JSON.stringify([
    { id: 'j1', date: ago(10), customerName: 'אבי', jobStatus: 'בעבודה' },                       // stuck 10 days
    { id: 'j2', date: ago(10), customerName: 'בני', jobStatus: 'נמסר' },                          // delivered
    { id: 'j3', date: ago(10), customerName: 'גדי', jobStatus: 'מוכן לאיסוף', _u: now - 2 * DAY }, // moved 2 days ago
    { id: 'j4', date: ago(100), customerName: 'דני' },                                            // before the status field
    { id: 'j5', date: ago(2), customerName: 'הדר', jobStatus: 'התקבל במעבדה' },                    // new
    { id: 'j6', date: ago(20), customerName: EVIL, jobStatus: 'התקבל במעבדה' },                    // stuck 20 days
  ]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o1', date: ago(9), customer: 'ורד', status: 'שולם', items: [], total: 100 },   // paid, not delivered
    { id: 'o2', date: ago(30), customer: 'זיו', status: 'הצעה', items: [], total: 100 },  // a quote is not work
    { id: 'o3', date: ago(30), customer: 'חן', status: 'נמסר', items: [], total: 100 },
  ]));
  localStorage.setItem('gp_lastBackup', JSON.stringify(now - 2 * DAY));
  localStorage.removeItem('gp_alerts_seen');
  Sync.session = null; Sync.userId = null;
  Sync.pending = () => [];
}, { DAY, EVIL });
if (SELFTEST) await page.evaluate(() => {
  const swap = (fn, a, b) => { const s = fn.toString(); if (!s.includes(a)) throw new Error('selftest: ' + a); return (0, eval)('(' + s.replace(a, b) + ')'); };
  window.escPunch = (s) => String(s == null ? '' : s);
  window.stuckWork = swap(stuckWork, 'Number(r._u) || 0', '0');
  window.checkHubAlerts = swap(checkHubAlerts, "if (document.getElementById('modalBackdrop').classList.contains('active')) return false;", '');
});

// a test browser gets no pop-up unless the test asks for one — the guard that keeps it out of the other 40 suites
check('in a test browser nothing pops up on its own', await page.evaluate(() => checkHubAlerts() === false && !document.getElementById('modalBackdrop').classList.contains('active')), '');
await page.evaluate(() => { window.__gpAlertsUnderTest = true; });

// stuck work
const stuck = await page.evaluate(() => stuckWork().map((x) => x.name + '|' + x.what + '|' + x.days));
check('stuck: a repair untouched for a week, the oldest open one, and a sale paid but not delivered',
  stuck.length === 3 && stuck.includes('אבי|בעבודה|10') && stuck.some((s) => s.endsWith('|התקבל במעבדה|20')) && stuck.includes('ורד|שולם ולא נמסר|9'), stuck);
check('not stuck: delivered, moved two days ago, a quote', !stuck.some((s) => /^(בני|גדי|זיו|חן)\|/.test(s)), stuck);
check('not stuck: a row from before the status field (100 days, read as בעבודה forever), or a new one', !stuck.some((s) => /^(דני|הדר)\|/.test(s)), stuck);

// the bot's questions: asked only with his login
await page.evaluate(() => refreshWaAlertCount());
check('logged out, the bot is not asked', gets.length === 0 && await page.evaluate(() => _waOpenQuestions === null), gets);
await page.evaluate(async () => {
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  await refreshWaAlertCount();
});
check('logged in, it asks with his login and counts only the open questions',
  gets.length === 1 && /^Bearer tok\./.test(gets[0]) && await page.evaluate(() => _waOpenQuestions === 2), [gets, await page.evaluate(() => _waOpenQuestions)]);

let ids = await page.evaluate(() => hubAlerts().map((a) => a.id + ':' + a.n));
check('with a backup two days old and nothing waiting to sync: the bot and the stuck work only', ids.join(',') === 'wa:2,stuck:3', ids);

// the backup
await page.evaluate(({ DAY }) => localStorage.setItem('gp_lastBackup', JSON.stringify(Date.now() - 8 * DAY)), { DAY });
let a = await page.evaluate(() => hubAlerts().find((x) => x.id === 'backup'));
check('a backup eight days old is an alert, with its age', a && /8 ימים/.test(a.text), a);
await page.evaluate(() => localStorage.removeItem('gp_lastBackup'));
a = await page.evaluate(() => hubAlerts().find((x) => x.id === 'backup'));
check('no backup ever is an alert', a && /עוד לא נעשה גיבוי/.test(a.text), a);

// the sync: a push in flight is not an alert, one still owed two minutes later is
await page.evaluate(() => { Sync.pending = () => ['jobs', 'customers']; });
const t0 = Date.now();
a = await page.evaluate((t) => hubAlerts(t).find((x) => x.id === 'sync'), t0);
check('something waiting to sync for a moment is not an alert', !a, a);
a = await page.evaluate((t) => hubAlerts(t + 3 * 60000).find((x) => x.id === 'sync'), t0);
check('still waiting three minutes later is, naming what', a && a.n === 2 && /לא עלו לענן/.test(a.text) && a.sub.length > 0, a);
await page.evaluate((t) => { Sync.pending = () => []; hubAlerts(t); Sync.pending = () => ['jobs']; }, t0 + 4 * 60000);
a = await page.evaluate((t) => hubAlerts(t + 5 * 60000).find((x) => x.id === 'sync'), t0);
check('once it went up, the clock starts again', !a, a);
await page.evaluate(() => { Sync.pending = () => []; hubAlerts(); });

// the pop-up
const modalOpen = () => page.evaluate(() => document.getElementById('modalBackdrop').classList.contains('active'));
let popped = await page.evaluate(() => checkHubAlerts());
check('something new pops up', popped === true && await modalOpen()
  && await page.evaluate(() => document.getElementById('modalTitle').textContent === '🔔 התראות'), '');
const cards = await page.evaluate(() => [...document.querySelectorAll('#modalBody [data-alert]')].map((e) => e.dataset.alert));
check('one card per alert', cards.join(',') === 'wa,stuck,backup', cards);
check('a customer\'s name is shown as text, never run as markup', await page.evaluate(() => window.__xss === undefined && !document.querySelector('#modalBody img')
  && document.getElementById('modalBody').innerText.includes('<img src=x')), '');
check('the red dot is on', await page.evaluate(() => document.getElementById('alertDot').style.display === ''), '');
await page.evaluate(() => closeModal());
check('the same list does not pop up again today', await page.evaluate(() => checkHubAlerts()) === false && !(await modalOpen()), '');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gp_alerts_seen')); s.day = '2000-01-01'; localStorage.setItem('gp_alerts_seen', JSON.stringify(s)); });
check('it does the next day', await page.evaluate(() => checkHubAlerts()) === true, '');
await page.evaluate(() => closeModal());

// never over a window he has open, the login, or a hidden page
const addStuck = (id) => page.evaluate(({ id, DAY }) => {
  const j = JSON.parse(localStorage.getItem('gp_jobs')); j.push({ id, date: new Date(Date.now() - 12 * DAY).toISOString(), customerName: 'נוסף', jobStatus: 'בעבודה' });
  localStorage.setItem('gp_jobs', JSON.stringify(j));
}, { id, DAY });
await addStuck('j7');
await page.evaluate(() => openModal('לקוח', '<p id="hisWork">עבודה פתוחה</p>'));
check('nothing pops over a window he has open', await page.evaluate(() => checkHubAlerts() === false && !!document.getElementById('hisWork')), '');
await page.evaluate(() => { closeModal(); showNotice('הודעה'); });
check('or over a notice', await page.evaluate(() => checkHubAlerts() === false && document.getElementById('noticeBody').textContent === 'הודעה'), '');
await page.evaluate(() => { closeNotice(); showLogin(''); });
check('or over the login', await page.evaluate(() => checkHubAlerts() === false), '');
await page.evaluate(() => { hideLogin(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
check('or while the hub is in the background', await page.evaluate(() => checkHubAlerts() === false), '');
await page.evaluate(() => { delete document.hidden; });
check('and the new item pops up once he is free', await page.evaluate(() => checkHubAlerts()) === true
  && await page.evaluate(() => /4 עבודות/.test(document.getElementById('modalBody').innerText)), await page.evaluate(() => document.getElementById('modalBody').innerText.slice(0, 200)));

// the buttons
await page.evaluate(() => document.querySelector('#modalBody [data-alert="stuck"] button').click());
check('"לעבודות" closes the list and opens the jobs page', !(await modalOpen()) && await page.evaluate(() => document.getElementById('page-orders').classList.contains('active')), '');
await page.evaluate(() => showHubAlerts(true));
await page.evaluate(() => document.querySelector('#modalBody [data-alert="wa"] button').click());
await page.waitForTimeout(300);
check('"לשאלות" opens the bot\'s page', !(await modalOpen()) && await page.evaluate(() => document.getElementById('page-wabot').classList.contains('active')), '');

// the heartbeat: asks the bot, then checks
const g0 = gets.length;
await page.evaluate(() => { localStorage.removeItem('gp_alerts_seen'); });
await page.evaluate(() => window._realHeartbeat(true));
await page.waitForTimeout(500);
check('the heartbeat asks the bot and pops up what is new', gets.length === g0 + 1 && await modalOpen(), [gets.length - g0]);
await page.evaluate(() => closeModal());

// the 🔔 with nothing to say
await page.evaluate(() => {
  localStorage.setItem('gp_jobs', '[]'); localStorage.setItem('gp_orders', '[]'); localStorage.setItem('gp_lastBackup', JSON.stringify(Date.now()));
  _waOpenQuestions = 0;
  showHubAlerts(true);
});
check('the 🔔 with nothing on it says so, and the dot goes off', await page.evaluate(() => /אין כרגע התראות/.test(document.getElementById('noticeBody').textContent)
  && document.getElementById('noticeBackdrop').classList.contains('active') && document.getElementById('alertDot').style.display === 'none'), '');
check('the 🔔 is in the header', await page.evaluate(() => !!document.querySelector('header #alertBell, .header #alertBell, #alertBell')), '');
await page.close();

// the phone: no backup alert, since its WebView cannot save a file
const phone = await open({ native: true });
const pa = await phone.evaluate(() => { localStorage.removeItem('gp_lastBackup'); return hubAlerts().map((x) => x.id); });
check('on the phone a missing backup is not an alert — it could not act on it', !pa.includes('backup'), pa);
await phone.close();

check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
