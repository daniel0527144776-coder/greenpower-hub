// The worker clock, and the hub's approval queue behind it.
//
//   node test/test-worker-clock.mjs [--selftest]
//
// Two things carry real risk here and both are covered below.
//
// A punch is money. It is written at the bench where the signal is worst, so the button must
// never depend on the network: the punch goes to localStorage first and is sent whenever it
// can be. If that queue drops anything, someone works a day for free.
//
// And worker_punches is the only table in this project an anonymous stranger can write to —
// that is the whole point of a clock with no login. Its strings land in the hub's own DOM.
//
// --selftest asserts the opposite outcome so the checks can be watched failing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(DIST, u === '/index.html' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(4190, r));

const { check, finish } = checker();
const b = await chromium.launch();
const BASE = 'http://127.0.0.1:4190';

// Stand in for Supabase. `online` decides whether the insert succeeds, so the offline path
// is exercised for real rather than asserted about.
let online = false;
const posted = [];
async function clockPage(ctx) {
  const p = await ctx.newPage();
  await p.route('**/rest/v1/worker_punches*', async (route) => {
    if (!online) return route.abort();
    posted.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 201, body: '' });
  });
  return p;
}

console.log('1. the link carries the name, and the clock runs');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await clockPage(ctx);
  await p.goto(`${BASE}/clock/?w=${encodeURIComponent('יוסי כהן')}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#app:not(.hidden)');
  check('the worker is named from the link', (await p.textContent('#who')).trim() === 'יוסי כהן');
  check('it does not ask who they are', await p.locator('#setup').isHidden());
  check('the URL no longer carries the name', !(await p.evaluate(() => location.search)));

  await p.click('#punch');
  check('the button flips to clock-out', (await p.textContent('#punch')).includes('יציאה'));
  check('the name is remembered for the home screen',
    await p.evaluate(() => JSON.parse(localStorage.getItem('gpclock_worker'))) === 'יוסי כהן');

  // Two hours ago, so clocking out produces a real duration without waiting for one.
  await p.evaluate(() => localStorage.setItem('gpclock_active', JSON.stringify({ startedAt: Date.now() - 2 * 3600 * 1000 })));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#app:not(.hidden)');
  check('a running clock survives closing the app', (await p.textContent('#punch')).includes('יציאה'));
  await p.click('#punch');
  const q = await p.evaluate(() => JSON.parse(localStorage.getItem('gpclock_queue') || '[]'));
  check('one punch was recorded', q.length === (SELFTEST ? 99 : 1), q.length);
  check('for about two hours', q[0] && Math.abs(q[0].hours - 2) < 0.02, q[0] && q[0].hours);
  check('under the right name', q[0] && q[0].worker === 'יוסי כהן', q[0] && q[0].worker);
  check('with start and end times', !!(q[0] && q[0].started_at && q[0].ended_at));
  await ctx.close();
}

console.log('\n2. no network: the punch is kept, not lost');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await clockPage(ctx);
  await p.goto(`${BASE}/clock/?w=${encodeURIComponent('דנה')}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#app:not(.hidden)');
  await p.fill('#mHours', '7.5');
  await p.fill('#mNote', 'הרכבת סוללות');
  await p.click('#mSave');
  await p.waitForTimeout(400);
  let q = await p.evaluate(() => JSON.parse(localStorage.getItem('gpclock_queue') || '[]'));
  check('the manual report is stored locally', q.length === 1 && q[0].hours === 7.5, q);
  check('it is marked as not yet sent', q[0] && q[0].sent === false, q[0] && q[0].sent);
  check('and the screen says so', (await p.textContent('#list')).includes('ממתין לרשת'));

  // The network comes back. Nothing is re-entered; the queue drains by itself.
  online = true;
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem('gpclock_queue') || '[]')[0] || {}).sent === true, { timeout: 8000 });
  q = await p.evaluate(() => JSON.parse(localStorage.getItem('gpclock_queue') || '[]'));
  check('it sends itself once the signal returns', q[0].sent === true);
  check('the server got the hours and the note',
    posted.some(x => x.hours === 7.5 && x.note === 'הרכבת סוללות' && x.worker === 'דנה'), posted);
  check('it is dated, and by local day not UTC',
    /^\d{4}-\d{2}-\d{2}$/.test(posted[posted.length - 1].work_date), posted[posted.length - 1].work_date);
  check('nothing is sent twice', posted.filter(x => x.hours === 7.5).length === 1, posted.length);
  online = false;
  await ctx.close();
}

console.log('\n3. a forgotten clock-out is handed back, not guessed');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await clockPage(ctx);
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/clock/?w=${encodeURIComponent('יוסי כהן')}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(() => localStorage.setItem('gpclock_active', JSON.stringify({ startedAt: Date.now() - 30 * 3600 * 1000 })));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#app:not(.hidden)');
  await p.click('#punch');
  await p.waitForTimeout(300);
  const q = await p.evaluate(() => JSON.parse(localStorage.getItem('gpclock_queue') || '[]'));
  check('a 30-hour session does not become a punch', q.length === 0, q);
  check('the clock is cleared so they are not stuck', await p.evaluate(() => localStorage.getItem('gpclock_active')) === null);
  check('and the button is back to clock-in', (await p.textContent('#punch')).includes('כניסה'));
  await ctx.close();
}

console.log('\n4. the hub shows the queue, and cannot be injected through it');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.renderPunches === 'function', { timeout: 30000 });
  const r = await p.evaluate(() => {
    // Everything a stranger can put in that table.
    window.renderPunches([{
      id: '11111111-1111-1111-1111-111111111111',
      worker: '<img src=x onerror="window.__pwned=1">',
      note: '</div><script>window.__pwned=1<\/script>',
      hours: 5, work_date: '2026-08-19', source: 'manual', status: 'pending'
    }]);
    const list = document.getElementById('punchList');
    return {
      shown: document.getElementById('punchCard').style.display !== 'none',
      rows: list.querySelectorAll('.price-item').length,
      injectedNodes: list.querySelectorAll('img, script').length,
      pwned: !!window.__pwned,
      text: list.textContent,
    };
  });
  check('the card appears when something is pending', r.shown);
  check('the report is listed', r.rows === 1, r.rows);
  check('the hostile markup created no elements', r.injectedNodes === 0, r.injectedNodes);
  check('and executed nothing', r.pwned === false);
  check('it is shown as text instead', r.text.includes('onerror'), r.text.slice(0, 80));
  check('an unknown worker is flagged rather than paid', r.text.includes('שם לא מוכר'), r.text.slice(0, 200));

  // With nobody on the payroll there is nothing to map to. This used to be an alert()
  // saying so — and an Android WebView with the default WebChromeClient draws nothing for
  // alert(), so on the one phone this hub runs on, pressing ✓ did nothing whatsoever and
  // said nothing about why. That is the report this section now guards: not "does it
  // explain itself" but "does it explain itself somewhere a WebView can draw".
  await p.evaluate(() => window.approvePunch('11111111-1111-1111-1111-111111111111'));
  await p.waitForTimeout(300);
  check('with no workers yet, it asks for one instead of stopping',
    await p.isVisible('#punchNewRate'), await p.textContent('#modalBody'));
  check('and it does so in the page, not in a dialog the phone cannot draw',
    dialogs.length === 0, dialogs);
  // The new form puts the reported name into an input VALUE — the second place a stranger's
  // string reaches this document, and the first one that is an attribute.
  check('the hostile name does not escape the field it was put in',
    await p.evaluate(() => !window.__pwned && document.querySelectorAll('#modalBody img, #modalBody script').length === 0));
  check('and no hours were written', await p.evaluate(() => JSON.parse(localStorage.getItem('gp_worktime') || '[]').length) === 0);
  await ctx.close();
}

console.log('\n5. an unmatched name is a question, not a dead end');
{
  // A worker's phone holds the name their link carried; the hub holds what Daniel typed.
  // "יהודה כהן" and "יהודה" are one person and nothing can know that without asking.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  let patched = null;
  await p.route('**/rest/v1/worker_punches*', async (route) => {
    if (route.request().method() === 'PATCH') {
      patched = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 200, body: '[]' });
  });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.approvePunch === 'function', { timeout: 30000 });

  const PUNCH = '22222222-2222-2222-2222-222222222222';
  await p.evaluate((id) => {
    localStorage.setItem('gp_workers', JSON.stringify([
      { id: 'wk1', name: 'יהודה', rate: 40 },
      { id: 'wk2', name: 'שמואל', rate: 45 },
    ]));
    localStorage.setItem('gp_worktime', JSON.stringify([]));
    // A session, so the approve path is not stopped by the auth guard before it starts.
    Sync.session = { access_token: 'test.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
    Sync.userId = 'u1';
    // The login gate is a full-screen overlay and would swallow the modal's buttons. It is
    // not what this section is about; the approval path behind it is.
    const gate = document.getElementById('loginOverlay');
    if (gate) gate.remove();
    window.renderPunches([{ id, worker: 'יהודה כהן', hours: 6, work_date: '2026-08-20', source: 'clock', status: 'pending' }]);
  }, PUNCH);
  check('the mismatch is shown as fixable, not as an error',
    (await p.textContent('#punchList')).includes('לחץ אשר כדי לשייך'));

  await p.evaluate((id) => window.approvePunch(id), PUNCH);
  await p.waitForSelector('#punchWorkerPick', { timeout: 5000 });
  check('it asks who it is instead of refusing', await p.isVisible('#punchWorkerPick'));
  check('the choice is between the real workers',
    (await p.$$eval('#punchWorkerPick option', o => o.map(x => x.textContent.trim()))).join(' | ').includes('₪40/שעה'));

  await p.selectOption('#punchWorkerPick', { label: 'יהודה — ₪40/שעה' });
  await p.click('button:has-text("שייך ואשר")');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('gp_worktime') || '[]').length > 0, { timeout: 5000 });
  const wt = await p.evaluate(() => JSON.parse(localStorage.getItem('gp_worktime'))[0]);
  check('the hours land under the chosen worker', wt.workerName === 'יהודה', wt.workerName);
  check("at the hub's rate, not the report's", wt.rate === (SELFTEST ? 999 : 40), wt.rate);
  check('for the reported hours', wt.hours === 6, wt.hours);
  check('and it is marked unpaid', wt.paid === false);
  check('the punch is consumed on the server', patched && patched.status === 'approved', patched);

  const alias = await p.evaluate(() => JSON.parse(localStorage.getItem('gp_workers')).find(w => w.id === 'wk1').aliases);
  check('the name is remembered so it matches by itself next time',
    Array.isArray(alias) && alias.includes('יהודה כהן'), alias);
  const matched = await p.evaluate(() => { const w = window.findWorkerFor('יהודה כהן'); return w && w.name; });
  check('and it does match by itself', matched === 'יהודה', matched);
  await ctx.close();
}

console.log('\n6. an empty payroll is a form, and nothing is said through a dialog');
{
  // The whole of "it will not let me approve the hours" (2026-08-24). Every branch of this
  // path ended in alert() or confirm(), and both draw nothing in the WebView the hub runs
  // in: ✓ was silent and ✕ answered "cancel" without ever asking. So this section presses
  // the real buttons and asserts on two things at once — that the hours land, and that no
  // native dialog was involved in any of it.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const patched = [];
  // Stands in for the table rather than for one request: renderWorktime() re-reads the queue
  // after every approval, so a mock that always answers "nothing pending" wipes the card and
  // the second row can never be pressed. The rows leave when they are consumed, not before.
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const B = 'bbbbbbbb-0000-0000-0000-000000000002';
  let serverPending = [
    { id: A, worker: 'יוסי', hours: 7, work_date: '2026-08-24', source: 'clock', status: 'pending' },
    { id: B, worker: 'רפי', hours: 3, work_date: '2026-08-24', source: 'manual', status: 'pending' },
  ];
  await p.route('**/rest/v1/worker_punches*', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const id = decodeURIComponent((req.url().match(/id=eq\.([^&]+)/) || [])[1] || '');
      patched.push({ id, ...JSON.parse(req.postData() || '{}') });
      serverPending = serverPending.filter((x) => x.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverPending) });
  });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.renderPunches === 'function', { timeout: 30000 });

  await p.evaluate(() => {
    localStorage.setItem('gp_workers', JSON.stringify([]));   // nobody yet
    localStorage.setItem('gp_worktime', JSON.stringify([]));
    Sync.session = { access_token: 'test.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
    Sync.userId = 'u1';
    const gate = document.getElementById('loginOverlay'); if (gate) gate.remove();
    navigateTo('worktime');
  });
  // The queue arrives the way it does in life: fetched, not planted.
  await p.waitForSelector('#punchList .price-item', { timeout: 5000 });

  // ✓ on the first one, through the button a finger actually lands on.
  await p.click(`#punchList span[onclick="approvePunch('${A}')"]`);
  await p.waitForSelector('#punchNewRate', { timeout: 5000 });
  check('pressing ✓ with an empty payroll puts something on the screen', await p.isVisible('#punchNewRate'));
  await p.fill('#punchNewRate', SELFTEST ? '0' : '48');
  await p.click('button:has-text("הוסף ואשר")');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('gp_worktime') || '[]').length > 0, { timeout: 5000 })
    .catch(() => {});
  const wt = await p.evaluate(() => JSON.parse(localStorage.getItem('gp_worktime') || '[]')[0] || null);
  check('the hours land once a rate is given', wt && wt.hours === 7, wt);
  check('at the rate typed here, never one from the report', wt && wt.rate === 48, wt);
  check('and the worker now exists for next time',
    (await p.evaluate(() => getWorkers().map(w => w.name + '/' + w.rate))).join() === 'יוסי/48',
    await p.evaluate(() => getWorkers()));
  check('the punch is consumed on the server',
    patched.some(x => x.status === 'approved'), patched);

  // Clear anything still on screen first — under --selftest the rate above is refused and
  // its notice would swallow the click below, turning a clean red into a crash.
  await p.evaluate(() => { if (window.closeNotice) closeNotice(); if (window.closeModal) closeModal(); });
  // ✕ on the second one. confirm() answered false without drawing, so this had never worked.
  await p.click(`#punchList span[onclick="rejectPunch('${B}')"]`);
  await p.waitForSelector('#noticeBackdrop.active', { timeout: 5000 });
  check('pressing ✕ asks before discarding a report', await p.isVisible('#noticeBackdrop.active'));
  await p.click('#noticeFooter button:has-text("אישור")');
  await p.waitForTimeout(400);
  check('and it is rejected once confirmed', patched.some(x => x.status === 'rejected'), patched);
  check('the row is gone from the queue',
    (await p.$$(`#punchList span[onclick*="${B}"]`)).length === 0);

  check('and not one word of this went through a dialog the phone cannot draw',
    dialogs.length === 0, dialogs);
  await ctx.close();
}

console.log('\n7. alert() itself is drawn in the page');
{
  // 41 call sites, all of them silent in a WebView. Replacing the function is the only fix
  // that covers the next one someone writes.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.showNotice === 'function', { timeout: 30000 });
  await p.evaluate((m) => window.alert(m), SELFTEST ? '' : 'בדיקה');
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({
    visible: !!document.querySelector('#noticeBackdrop.active'),
    text: (document.getElementById('noticeBody') || {}).textContent || '',
  }));
  check('an alert is visible on the page', r.visible && r.text === 'בדיקה', r);
  check('and no native dialog was raised', dialogs.length === 0, dialogs);
  await ctx.close();
}
await b.close(); srv.close();
process.exit(finish());
