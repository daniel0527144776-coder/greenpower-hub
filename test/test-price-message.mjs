// A category's prices for a customer who asked (2026-10-30).
//
//   node test/test-price-message.mjs
//   node test/test-price-message.mjs --selftest     (the message covers only the clicked series)
//
// Daniel: "אם לקוח שואל שאלה על מחירים של סוללות ... אני אוכל לשלוח לו בהודעה את המחירים ... של כל
// הקטגוריה, נגיד סוללת לאינדורו 60 וולט". What must hold: 💬 on a category's row opens the message and
// does not fold or unfold the row; the message holds every price of that family at that voltage, in
// every series, each the price the page shows (business prices in business mode), with the series'
// cells and its page on the site, the warranty that item carries and the lab's address; a series, or
// the capacities outside a range, can be left out; every line opens right to left; it goes through the bot to the number typed, as edited,
// only when he presses send; a bad number sends nothing and says so; a saved customer's number fills
// the name into the greeting.
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
await new Promise((r) => srv.listen(4367, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));

const posts = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
await page.route(/energylabgreen\.com\/api\//, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (/\/admin/.test(req.url()) && req.method() === 'POST') posts.push(JSON.parse(req.postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: CORS });
});
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4367/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openPriceMessage === 'function' && typeof PRICING !== 'undefined', null, { timeout: 30000 });
await page.evaluate((SELF) => {
  if (SELF) window.priceMsgCats = (c) => [c];
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  Store.set('customers', [{ id: 'c1', name: 'רונן דוגמה', phone: '050-777-1234' }]);
  navigateTo('catalog');
  setPriceMode('retail');
}, SELFTEST);

const CAT = 'סוללות אינדורו וטרקטורונים - 60V PRO';
const open = (cat) => page.evaluate((cat) => {
  closeModal();
  const row = [...document.querySelectorAll('#catalogList .price-cat')].find((r) => r.dataset.cat === cat);
  if (!row) return 'no row';
  row.querySelector('[data-price-msg]').click();
  return 'ok';
}, cat);
const msg = () => page.evaluate(() => (document.getElementById('waComposeMsg') || {}).value || '');
const want = (mode) => page.evaluate(({ mode }) => {
  const cats = ['CLASSIC', 'ADVANCED', 'PRO'].map((t) => 'סוללות אינדורו וטרקטורונים - 60V ' + t);
  return cats.map((c) => PRICING.filter((it) => it.cat === c).map((it) => ({ ah: it.name.replace('60V ', ''), p: priceWithBms(it, mode) })));
}, { mode });

// ---- the button ----
const before = await page.evaluate((cat) => catOpenCats.has(cat), CAT);
check('each category row has a 💬 that opens the message', (await open(CAT)) === 'ok' && !!(await msg()), await msg());
check('…without folding or unfolding the row', await page.evaluate((cat) => catOpenCats.has(cat), CAT) === before, null);

// ---- the whole family at that voltage ----
let m = await msg();
const [cl, ad, pro] = await want('retail');
const lines = m.split('\n');
const has = (ah, p) => lines.some((l) => l.includes('• ' + ah + ' — ') && l.includes(Number(p).toLocaleString('he-IL')));
check('it holds every CLASSIC, ADVANCED and PRO price of 60V, each as the page shows it',
  cl.length > 5 && ad.length > 5 && pro.length > 5 && [...cl, ...ad, ...pro].every((x) => has(x.ah, x.p))
  && lines.filter((l) => /•/.test(l)).length === cl.length + ad.length + pro.length, { cl: cl.length, ad: ad.length, pro: pro.length, bullets: lines.filter((l) => /•/.test(l)).length });
check('…cheapest series first, each named with its cells', m.indexOf('*CLASSIC*') < m.indexOf('*ADVANCED*') && m.indexOf('*ADVANCED*') < m.indexOf('*PRO*')
  && /\*CLASSIC\* · תאי EVE 50E/.test(m) && /\*PRO\* · תאי EVE 50PL/.test(m), m.slice(0, 300));
check('…with each series\' page on the site, the warranty and the address', /energylabgreen\.com\/product\/heavy-classic/.test(m) && /energylabgreen\.com\/product\/heavy-pro/.test(m)
  && /אחריות 12 חודשים/.test(m) && /ניסים גאון 8/.test(m), m.slice(-300));
check('every line opens right to left', lines.filter(Boolean).every((l) => l.startsWith('‏')), lines.find((l) => l && !l.startsWith('‏')));

// ---- a series left out ----
await page.evaluate(() => { const b = document.querySelector('[data-pm-tier="PRO"]'); b.checked = false; b.dispatchEvent(new Event('change')); });
m = await msg();
check('a series left out leaves the message', !/\*PRO\*/.test(m) && /\*CLASSIC\*/.test(m) && /\*ADVANCED\*/.test(m), m.slice(0, 200));

// ---- a capacity range ----
await page.evaluate(() => { document.getElementById('pmFrom').value = '40'; const t = document.getElementById('pmTo'); t.value = '80'; t.dispatchEvent(new Event('change')); });
m = await msg();
const ahsIn = [...m.matchAll(/• (\d+)Ah — /g)].map((x) => +x[1]);
check('a capacity range keeps only 40-80Ah, in each series left in', ahsIn.length === 2 * 9 && ahsIn.every((a) => a >= 40 && a <= 80), ahsIn);

// ---- business mode ----
await page.evaluate(() => { closeModal(); setPriceMode('b2b'); });
await open(CAT);
m = await msg();
const b2b = (await want('b2b')).flat();
check('in business mode it is the business list, at business prices', /מחירון עסקי/.test(m) && b2b.every((x) => m.includes(Number(x.p).toLocaleString('he-IL'))), m.slice(0, 120));
await page.evaluate(() => { closeModal(); setPriceMode('retail'); });

// ---- a ready pack's own warranty ----
await open('סוללות Sur-Ron Ultra Bee - DHS');
check('a DHS pack carries its own warranty (24 months)', /אחריות 24 חודשים/.test(await msg()), (await msg()).slice(-200));

// ---- sending ----
await open(CAT);
await page.evaluate(() => { document.getElementById('pmPhone').value = '050-777-1234'; pmFillName(); });
m = await msg();
check('a saved customer\'s number fills the name into the greeting', /שלום רונן דוגמה/.test(m), m.slice(0, 60));
await page.evaluate(() => { const b = document.getElementById('waComposeMsg'); b.value = b.value + '\n‏תוספת שלי'; });
posts.length = 0;
await page.evaluate(() => sendPriceMessage());
await page.waitForTimeout(500);
check('it goes through the bot to that number, as edited', posts.length === 1 && posts[0].op === 'send' && posts[0].chat === '050-777-1234'
  && /תוספת שלי/.test(posts[0].text) && /\*PRO\*/.test(posts[0].text), posts.map((p) => ({ ...p, text: (p.text || '').slice(0, 60) })));
posts.length = 0;
await open(CAT);
await page.evaluate(() => { document.getElementById('pmPhone').value = '12'; sendPriceMessage(); });
await page.waitForTimeout(300);
check('a bad number sends nothing and says so', posts.length === 0 && /מספר טלפון תקין/.test(await page.evaluate(() => document.getElementById('noticeBody').textContent)), posts.length);
check('no page errors', errs.length === 0, errs.join(' | '));

if (SELFTEST) console.log('\n[selftest] the message covers only the clicked series; the whole-family checks must have gone red.');
await browser.close();
srv.close();
process.exit(finish());
