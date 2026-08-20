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
  check('an unknown worker is flagged rather than paid', r.text.includes('אין עובד בשם הזה'), r.text.slice(0, 200));

  // Approving an unknown name must refuse: the rate comes from the hub, never the report.
  await p.evaluate(() => window.approvePunch('11111111-1111-1111-1111-111111111111'));
  await p.waitForTimeout(300);
  check('approving an unknown worker is refused', dialogs.some(m => m.includes('אין עובד בשם')), dialogs);
  check('and no hours were written', await p.evaluate(() => JSON.parse(localStorage.getItem('gp_worktime') || '[]').length) === 0);
  await ctx.close();
}

await b.close(); srv.close();
process.exit(finish());
