// What the WhatsApp bot may know about a customer: the hub's `bot_index`.
//
//   node test/test-bot-index.mjs
//   node test/test-bot-index.mjs --selftest
//
// Daniel, 2026-10-04: the bot tells a customer about his own repairs and orders ("כן, רק לו
// עצמו"). It reads them from bot_index, a slim copy the hub keeps beside `jobs` — because `jobs`
// carries the photos, and because a cost, a profit or a private note must never reach a model
// that is talking to a customer. So the index is checked for what it must hold and, harder, for
// what it must not. --selftest builds it from the raw jobs instead, photos and profit included.
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
await new Promise((r) => srv.listen(4361, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4361/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.botIndex === 'function', null, { timeout: 30000 });

const r = await page.evaluate(async (SELF) => {
  if (SELF) { const real = window.botIndex; window.botIndex = () => ({ ...real(), jobs: Store.get('jobs') }); }
  const now = Date.now(), day = 86400000;
  const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
  localStorage.setItem('gp_customers', JSON.stringify([{ id: 'c1', name: 'יוסי', phone: '050-123-4567', altPhones: ['052-999-8888'] }, { id: 'c2', name: 'בלי טלפון' }]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o1', date: new Date(now - 30 * day).toISOString(), customer: 'יוסי', phone: '050-123-4567', status: 'נמסר',
      items: [{ name: '72V 30Ah PRO', cat: 'סוללות אופניים - 72V PRO', qty: 1, unit: 5900 }] },
    { id: 'o2', date: new Date(now - 3 * day).toISOString(), customer: 'יוסי', phone: '050-123-4567', status: 'הצעה',
      items: [{ name: 'מטען 72V', cat: 'מטענים', qty: 2, unit: 300 }] },
  ]));
  // Store.set, the way the app saves — it must rebuild the index by itself
  Store.set('jobs', [
    { id: 'j1', date: new Date(now - 10 * day).toISOString(), customerName: 'יוסי', customerPhone: '052-999-8888', jobs: ['full'],
      voltage: '48', capacity: '20', vehicle: 'אופניים', price: 1300, cost: 700, profit: 600, customerNotes: 'חייב לי 200 מאז',
      jobStatus: 'מוכן לאיסוף', warrantyEnd: new Date(now + 355 * day).toISOString(), photoBefore: PHOTO, photoAfter: PHOTO },
    { id: 'j2', date: new Date(now - 700 * day).toISOString(), customerPhone: '050-123-4567', jobs: ['full'], price: 900 },
    { id: 'j3', date: new Date(now - 5 * day).toISOString(), customerName: 'בלי טלפון', jobs: ['full'], price: 100 },
  ]);
  await new Promise((res) => setTimeout(res, 1900));
  const idx = JSON.parse(localStorage.getItem('gp_bot_index') || 'null');
  return { idx, synced: SYNC_KEYS.includes('bot_index'), raw: (localStorage.getItem('gp_jobs') || '').length,
           size: JSON.stringify(idx || {}).length, labelFull: JOB_LABELS.full };
}, SELFTEST);

const idx = r.idx || {};
const j = (idx.jobs || [])[0] || {};
const o = (idx.orders || []).find((x) => x.s === 'נמסר') || {};
check('saving jobs rebuilds the bot\'s index by itself', !!r.idx, String(!!r.idx));
check('and it syncs, so the bot can read it', r.synced, r.synced);
check('a job carries what the customer may hear: what, status, price, warranty',
  j.p === '052-999-8888' && j.w && j.w[0] === r.labelFull && j.s === 'מוכן לאיסוף' && j.t === 1300 && /^\d{4}-\d{2}-\d{2}$/.test(j.we) && j.v === '48V 20Ah', j);
const text = JSON.stringify(idx);
check('and nothing he must not: no photo, cost, profit or note', !/data:image|"cost"|"profit"|חייב לי|customerNotes|photo/.test(text), text.slice(0, 200));
check('the index is a sliver of the jobs it comes from', r.size * 20 < r.raw, `${r.size} vs ${r.raw}`);
check('a job older than eighteen months is left out', !(idx.jobs || []).some((x) => x.t === 900), idx.jobs);
check('a job with no phone cannot be matched to anyone, so it is left out', !(idx.jobs || []).some((x) => x.t === 100), idx.jobs);
check('an order: items, status, total, and twelve months of warranty once paid', o.i && o.i[0] === '72V 30Ah PRO' && o.t === 5900 && /^\d{4}-\d{2}-\d{2}$/.test(o.we), o);
check('a quote has no warranty yet', ((idx.orders || []).find((x) => x.s === 'הצעה') || {}).we === '', idx.orders);
check('every number the hub knows for a customer is in it', (idx.customers || []).some((c) => c.p.includes('050-123-4567') && c.p.includes('052-999-8888')), idx.customers);
// His phone's storage runs close to full, and Store.set raises an error box when a write fails.
// The bot's copy is nobody's typed work: when the phone has no room, no box — the cloud copy goes.
const full = await page.evaluate(async () => {
  const pushed = [];
  const realPush = Sync.push;
  Sync.push = function (k) { pushed.push(k); return Promise.resolve(); };
  const realSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'gp_bot_index') throw new DOMException('full', 'QuotaExceededError'); return realSet.call(this, k, v); };
  const alerts = [];
  window.alert = (m) => alerts.push(m);
  Store.set('orders', (Store.get('orders') || []).concat([{ id: 'o3', date: new Date().toISOString(), phone: '050-111-2222', status: 'שולם', items: [{ name: 'מטען', qty: 1, unit: 300 }] }]));
  await new Promise((res) => setTimeout(res, 1900));
  Storage.prototype.setItem = realSet;
  Sync.push = realPush;
  return { alerts, pushed };
});
check('a full phone gets no error box for the bot\'s copy, and the cloud copy still goes', full.alerts.length === 0 && full.pushed.includes('bot_index'), full);
// The hub sends the index to the bot itself, with his login (his choice: "לבטל את הצורך במפתח
// Supabase") — and only when he is logged in. --selftest stops it sending.
const posted = [];
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 201, body: '' }));
await page.route('https://energylabgreen.com/api/wa/index', async (route) => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  posted.push({ auth: req.headers()['authorization'] || '', body: req.postData() || '' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: cors });
});
await page.evaluate(async (SELF) => {
  if (SELF) window.postBotIndex = async () => {};
  Sync.session = { access_token: 'test.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  Store.set('orders', (Store.get('orders') || []).concat([{ id: 'o4', date: new Date().toISOString(), phone: '050-333-4444', status: 'הצעה', items: [{ name: 'מטען', qty: 1, unit: 300 }] }]));
  await new Promise((res) => setTimeout(res, 2200));
}, SELFTEST);
const sent = posted[posted.length - 1] || { auth: '', body: '' };
check('logged in, the hub sends the index to the bot with his login', /^Bearer test\./.test(sent.auth) && /"v":1/.test(sent.body) && /050-333-4444/.test(sent.body), posted.map((p) => p.auth.slice(0, 20)));
check('and what it sends holds no photo or cost either', sent.body && !/data:image|"cost"|"profit"/.test(sent.body), sent.body.slice(0, 120));
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
