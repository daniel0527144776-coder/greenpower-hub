// The supplier price list arrives by itself after login (2026-10-30).
//
//   node test/test-supplier-pull.mjs
//   node test/test-supplier-pull.mjs --selftest     (the rows taken as they come, unchecked)
//
// Daniel: "עלויות הספקים נכנסות ללוח הבקרה לבד". sync-prices sends the list to the lab's server, and the
// hub reads it there with his login. What must hold: a list with a stamp not yet applied becomes
// 'supplier_prices', through the same row check as the import (a row with no price is dropped); the
// stamp goes into the synced settings, so the same list is never applied twice and a list he imported
// by hand after it stays; his hand-added rows ('supplier_costs') are never touched; a server that
// refuses, fails or has nothing yet, or a list with no valid row, changes nothing; startApp asks for it.
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
await new Promise((r) => srv.listen(4365, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT' };
const server = { status: 200, body: { rows: null, at: null }, auth: [] };
await page.route(/energylabgreen\.com\/api\/supplier-prices/, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  server.auth.push(req.headers().authorization || '');
  return route.fulfill({ status: server.status, contentType: 'application/json', body: JSON.stringify(server.body), headers: CORS });
});
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4365/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.pullSupplierPrices === 'function', null, { timeout: 30000 });
await page.evaluate((SELF) => {
  if (SELF) window.cleanSupplierRows = (d) => d;
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  Store.set('supplier_prices', [{ who: 'ספק ישן', cat: 'כללי', name: 'פריט ישן', usd: 1 }]);
  Store.set('supplier_costs', [{ who: 'ספק דוגמה', cat: 'ידני', name: 'פריט שהוספתי', ils: 50 }]);
  const s = Store.get('settings') || {}; delete s.supplierPricesAt; Store.set('settings', s);
}, SELFTEST);
const state = () => page.evaluate(() => ({ list: Store.get('supplier_prices') || [], hand: Store.get('supplier_costs') || [], at: (Store.get('settings') || {}).supplierPricesAt }));
const pull = () => page.evaluate(() => pullSupplierPrices().catch((e) => 'threw ' + e.message));

// ---- a new list ----
const LIST = [{ who: 'ספק דוגמה', cat: 'BMS', name: 'BMS דוגמה 16S', usd: 21.5, kg: 0.4, on: '2026-10-29' }, { who: 'ספק דוגמה', cat: 'מארזים', name: 'מארז דוגמה', ils: 240 },
  { who: 'ספק דוגמה', cat: 'BMS', name: 'בלי מחיר' }];
server.body = { rows: LIST, at: '2026-10-30T05:00:00.000Z' };
let r = await pull(), s = await state();
check('a list with a new stamp becomes the supplier list', r === true && s.list.length === 2 && s.list[0].name === 'BMS דוגמה 16S' && s.list[0].kg === 0.4 && s.list[0].on === '2026-10-29' && s.list[1].ils === 240, { r, list: s.list });
check('…through the import\'s own row check: a row with no price is dropped', !s.list.some((x) => x.name === 'בלי מחיר'), s.list.map((x) => x.name));
check('…asked for with his login', /^Bearer tok\./.test(server.auth[server.auth.length - 1]), server.auth.slice(-1));
check('…and its stamp is kept in the synced settings', s.at === '2026-10-30T05:00:00.000Z', s.at);
check('his hand-added rows are not touched', s.hand.length === 1 && s.hand[0].name === 'פריט שהוספתי', s.hand);

// ---- the same list again, after a hand import ----
await page.evaluate(() => Store.set('supplier_prices', [{ who: 'ספק דוגמה', cat: 'כללי', name: 'ייבוא ידני', usd: 3 }]));
r = await pull(); s = await state();
check('the same stamp is not applied again: a list he imported by hand after it stays', r === false && s.list.length === 1 && s.list[0].name === 'ייבוא ידני', { r, list: s.list });

// ---- a newer list ----
server.body = { rows: LIST.slice(0, 1), at: '2026-11-01T08:30:00.000Z' };
r = await pull(); s = await state();
check('a newer list replaces it', r === true && s.list.length === 1 && s.list[0].name === 'BMS דוגמה 16S' && s.at === '2026-11-01T08:30:00.000Z', { r, at: s.at });

// ---- nothing to apply ----
const before = JSON.stringify(await state());
for (const [st, body] of [[401, { error: 'unauthorized' }], [500, { error: 'failed' }], [200, { rows: null, at: null }],
  [200, { rows: [{ who: 'ספק דוגמה', name: 'בלי מחיר' }], at: '2026-12-01T08:30:00.000Z' }]]) {
  server.status = st; server.body = body;
  r = await pull();
  check(`nothing changes when the server answers ${st}${body.rows === null ? ' with no list yet' : body.rows ? ' with no valid row' : ''}`, r === false && JSON.stringify(await state()) === before, r);
}
server.status = 200;

// ---- boot ----
const boot = await page.evaluate(() => String(startApp));
check('startApp asks for it after init, without waiting on it', /init\(\);[\s\S]*pullSupplierPrices\(\)\.catch/.test(boot) && !/await pullSupplierPrices/.test(boot), boot.slice(0, 200));
check('no page errors', errs.length === 0, errs.join(' | '));

if (SELFTEST) console.log('\n[selftest] rows taken unchecked; the row checks must have gone red.');
await browser.close();
srv.close();
process.exit(finish());
