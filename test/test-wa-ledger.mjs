// The WhatsApp lines for him to approve on the finances page (v445, Daniel 2026-10-16: "רשימה לאישור").
//
//   node test/test-wa-ledger.mjs
//   node test/test-wa-ledger.mjs --selftest   (✓ books nothing: the booking checks fail)
//
// The lines come from the bot with his login, never from this public file. ✓ books one as an income or
// an expense, once; ✕ drops it; both tell the bot. A name with markup stays text. Logged out, nothing.
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
await new Promise((r) => srv.listen(4234, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
const posts = [];
const ITEMS = [
  { id: 'w1', d: '2026-10-13', a: 1325, kind: 'income', who: 'יואב קליין', note: 'מקדמה 48V 20Ah' },
  { id: 'w2', d: '2026-10-08', a: 85, kind: 'expense', who: 'יעקב שליחים', note: 'אלעד - ת"א', cat: 'שילוח ומכס' },
  { id: 'w3', d: '2026-07-22', a: 100, kind: 'income', who: '<img src=x onerror="window.__xss=1">', note: 'ביט' },
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
await page.route(/energylabgreen\.com\/api\/wa\//, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const b = JSON.parse(req.postData() || '{}');
  posts.push(b);
  const body = b.op === 'waledger_get' ? { ok: true, items: ITEMS } : { ok: true };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
});
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4234/index.html');
await page.waitForFunction(() => typeof window.loadWaLedger === 'function', null, { timeout: 30000 });

const state = () => page.evaluate(() => ({
  rows: [...document.querySelectorAll('#finWaLedger [data-wa-line]')].map((r) => r.getAttribute('data-wa-line')),
  text: (document.getElementById('finWaLedger') || {}).textContent || '',
  img: !!document.querySelector('#finWaLedger img'), xss: !!window.__xss,
  inc: (Store.get('incomes') || []).filter((r) => String(r.id).startsWith('wa_')),
  exp: (Store.get('expenses') || []).filter((r) => String(r.id).startsWith('wa_')),
}));

// logged out: nothing asked, nothing shown
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  Store.set('incomes', []); Store.set('expenses', []);
  navigateTo('finances'); renderFinances();
});
await page.waitForTimeout(300);
let s = await state();
check('logged out: no list, and the bot is not asked', s.rows.length === 0 && posts.length === 0, s);

await page.evaluate((SELF) => {
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  if (SELF) window.waLedgerTake = () => {};
  loadWaLedger(true);
}, SELFTEST);
await page.waitForTimeout(500);
s = await state();
check('logged in: the lines from the bot, in one fold with their count', s.rows.join() === 'w1,w2,w3' && /מהוואטסאפ — לאישור\s*3/.test(s.text) && /1,325/.test(s.text), s);
check('a name with markup stays text', !s.img && !s.xss && s.text.includes('<img src=x'), s.text.slice(0, 200));

await page.evaluate(() => { document.querySelector('[data-wa-line="w1"] button').click(); });
await page.waitForTimeout(400);
s = await state();
check('✓ books the income once, as his own line, and tells the bot', s.inc.length === 1 && s.inc[0].amount === 1325 && s.inc[0].src === 'wa' && /יואב קליין/.test(s.inc[0].note)
  && s.inc[0].date.startsWith('2026-10-13') && posts.some((p) => p.op === 'waledger_done' && p.id === 'w1') && !s.rows.includes('w1'), s);
await page.evaluate(() => { document.querySelector('[data-wa-line="w2"] button').click(); });
await page.waitForTimeout(400);
s = await state();
check('an expense line goes into the expenses, in its category', s.exp.length === 1 && s.exp[0].amount === 85 && s.exp[0].cat === 'שילוח ומכס', s.exp);
await page.evaluate(() => { document.querySelectorAll('[data-wa-line="w3"] button')[1].click(); });
await page.waitForTimeout(400);
s = await state();
check('✕ drops a line without booking it, and tells the bot', s.rows.length === 0 && s.inc.length === 1 && posts.some((p) => p.op === 'waledger_done' && p.id === 'w3'), s);
await page.evaluate(() => loadWaLedger(true));
await page.waitForTimeout(400);
s = await state();
check('a line already booked is not offered again, even if the bot still has it', !s.rows.includes('w1') && !s.rows.includes('w2'), s.rows);
check('no JS errors', errs.length === 0, errs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
