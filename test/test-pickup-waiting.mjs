// Batteries waiting to be collected (2026-11-19).
//
//   node test/test-pickup-waiting.mjs
//   node test/test-pickup-waiting.mjs --selftest     (the wait is counted from the intake date only: must go red)
//
// Daniel chose "רשימת ממתינות לאיסוף" for the policy of the same day: a notice when it is ready, a month, one more
// notice, then the battery is destroyed safely. What must hold: the sales page lists every job that is ready, the
// longest wait first, the days counted from the ready message the bot sent, or from the day it was marked ready, or
// (marked before either existed) from the job's own date, said so; after a month, and not before, a button sends the
// second notice, which names the day it has waited since and says it will be destroyed safely if not collected; once
// sent, the row says when; a job marked ready gets its day, and one that leaves the state loses it.
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
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: { 'access-control-allow-origin': '*' } }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4371/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.pickupWaiting === 'function' && typeof window.renderOrders === 'function', null, { timeout: 30000 });

const DAY = 86400000;
const r = await page.evaluate(({ SELF, DAY }) => {
  const now = Date.now(), iso = (d) => new Date(now - d * DAY).toISOString();
  // the planted fault: the wait counted from the intake date alone, never from the ready message or the ready day
  if (SELF) window.pickupWaiting = (t = Date.now()) => (Store.get('jobs') || []).filter((j) => jobStatusOf(j, t) === 'מוכן לאיסוף')
    .map((j) => ({ j, since: j.date, days: Math.floor((t - new Date(j.date).getTime()) / DAY), exact: false })).sort((a, b) => b.days - a.days);
  Store.set('jobs', [
    { id: 'j1', customerName: 'לקוח דוגמה א', customerPhone: '050-000-0001', voltage: '48', capacity: '20', date: iso(50), jobStatus: 'מוכן לאיסוף', readyToldAt: iso(40) },
    { id: 'j2', customerName: 'לקוח דוגמה ב', customerPhone: '050-000-0002', voltage: '36', capacity: '10', date: iso(9), jobStatus: 'מוכן לאיסוף', readyAt: iso(5) },
    { id: 'j3', customerName: 'לקוח דוגמה ג', customerPhone: '050-000-0003', date: iso(12), jobStatus: 'מוכן לאיסוף' },
    { id: 'j4', customerName: 'לקוח דוגמה ד', customerPhone: '050-000-0004', date: iso(3), jobStatus: 'בעבודה' },
    { id: 'j5', customerName: 'לקוח דוגמה ה', customerPhone: '050-000-0005', date: iso(70), jobStatus: 'מוכן לאיסוף', readyAt: iso(60), secondNoticeAt: iso(20) },
  ]);
  const rows = pickupWaiting(now).map((x) => ({ id: x.j.id, days: x.days, exact: x.exact }));
  navigateTo('orders'); renderOrders();
  const box = document.getElementById('pickupWaiting');
  const rowOf = (id) => box && box.querySelector('[data-pickup="' + id + '"]');
  const html = (id) => (rowOf(id) ? rowOf(id).outerHTML : '');
  const msg = secondNoticeMessage(Store.get('jobs').find((j) => j.id === 'j1'));
  // marking ready gives the day; leaving the state takes it away
  const jobs = Store.get('jobs');
  const j4 = jobs.find((j) => j.id === 'j4'); markReadyChange(Object.assign(j4, { jobStatus: 'מוכן לאיסוף' }), 'בעבודה');
  const gotDay = !!j4.readyAt;
  const j2 = jobs.find((j) => j.id === 'j2'); markReadyChange(Object.assign(j2, { jobStatus: 'נמסר' }), 'מוכן לאיסוף');
  const lostDay = !j2.readyAt;
  return {
    rows, shown: !!box && box.style.display !== 'none',
    j1btn: !!(rowOf('j1') && rowOf('j1').querySelector('[data-second-notice]')),
    j2btn: !!(rowOf('j2') && rowOf('j2').querySelector('[data-second-notice]')),
    j3text: html('j3'), j4row: !!rowOf('j4'),
    j5sent: !!(rowOf('j5') && rowOf('j5').querySelector('[data-second-sent]')), j5btn: !!(rowOf('j5') && rowOf('j5').querySelector('[data-second-notice]')),
    msg, gotDay, lostDay,
  };
}, { SELF: SELFTEST, DAY });

const ids = r.rows.map((x) => x.id).join(',');
check('every ready job is listed, the longest wait first, nothing else', ids === 'j5,j1,j3,j2', ids);
check('the days count from the bot\'s ready message (40), from the day marked ready (5), or from the job\'s date (12)',
  r.rows.find((x) => x.id === 'j1').days === 40 && r.rows.find((x) => x.id === 'j2').days === 5 && r.rows.find((x) => x.id === 'j3').days === 12, JSON.stringify(r.rows));
check('a job with no ready day says it counts from the intake', /מיום הקבלה/.test(r.j3text) && !r.rows.find((x) => x.id === 'j3').exact, r.j3text.slice(0, 200));
check('the list is on the sales page', r.shown && !r.j4row, String(r.shown));
check('after a month, and not before, the row offers the second notice', r.j1btn && !r.j2btn, `j1 ${r.j1btn} j2 ${r.j2btn}`);
check('once sent, the row says when and offers it no more', r.j5sent && !r.j5btn, `${r.j5sent} ${r.j5btn}`);
check('the second notice names the day it waits since and says it will be destroyed safely if not collected',
  /מחכה לאיסוף מאז/.test(r.msg) && /תושמד בבטיחות/.test(r.msg) && /48V 20Ah/.test(r.msg) && /לקוח דוגמה א/.test(r.msg), r.msg.slice(0, 220));
check('marking ready gives the job its day; leaving the state takes it away', r.gotDay && r.lostDay, `${r.gotDay} ${r.lostDay}`);
check('no page error', errs.length === 0, errs.join(' | '));

await browser.close(); srv.close();
process.exit(finish());
