// Asking a customer for a Google review (2026-10-05).
//
//   node test/test-review-ask.mjs
//   node test/test-review-ask.mjs --selftest     (no offer on delivery; the message unescaped)
//
// Daniel chose it on 2026-09-01 ("ביקורות באתר — לאסוף אמיתיות?" → "כן — דרך גוגל"); it was never
// built until the old sessions were gone through. A WhatsApp link with text only shows for copying
// on his phone, so the request goes through the bot from the business number. What must hold: the
// message names the customer and carries HIS review link (or the business on Google Maps until he
// sets one); it goes out only when he presses send; marking a job or a sale נמסר offers it, once per
// customer; and when the bot cannot be reached, the message is there to copy, as before.
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

const posts = [];
let botUp = true;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
await page.route(/energylabgreen\.com\/api\/wa\//, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (/\/admin/.test(req.url()) && req.method() === 'POST') {
    posts.push(JSON.parse(req.postData() || '{}'));
    return botUp ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: CORS })
      : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"green api unreachable"}', headers: CORS });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: CORS });
});
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4363/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openReviewAsk === 'function', null, { timeout: 30000 });

const EVIL = '<img src=x onerror="window.__xss=1">';
await page.evaluate(({ SELF, EVIL }) => {
  if (SELF) { window.offerReviewAsk = () => {}; window.escPunch = (s) => String(s == null ? '' : s); }
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  const d = new Date().toISOString();
  Store.set('customers', [{ id: 'c1', name: 'רונן כהן', phone: '050-777-1234' }, { id: 'c2', name: EVIL + 'דנה כהן', phone: '052-333-4444' }, { id: 'c3', name: 'משה', phone: '054-555-6666' }]);
  Store.set('jobs', [
    { id: 'j1', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'מוכן לאיסוף', price: 500, jobs: ['full'] },
    { id: 'j2', date: d, customerName: EVIL + 'דנה כהן', customerPhone: '052-333-4444', jobStatus: 'מוכן לאיסוף', price: 300, jobs: ['full'] },
  ]);
  Store.set('orders', [{ id: 'o1', date: d, customer: 'משה', phone: '054-555-6666', status: 'שולם', items: [{ name: 'מטען', qty: 1, unit: 300 }], total: 300 }]);
  if (typeof bizDetails !== 'undefined') bizDetails.reviewUrl = '';
}, { SELF: SELFTEST, EVIL });
const modal = () => page.evaluate(() => ({ title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').innerText,
  foot: document.getElementById('modalFooter').innerText, box: (document.getElementById('reviewMsg') || {}).value || '' }));
const notice = () => page.evaluate(() => document.getElementById('noticeBackdrop').classList.contains('active') ? document.getElementById('noticeBody').textContent : '');

// from the customer's card
await page.evaluate(() => openCustomerDetails(0));
let m = await modal();
check('the customer card has the button', /ביקורת בגוגל/.test(m.foot), m.foot);
await page.evaluate(() => openReviewAskFor(0));
m = await modal();
check('the message greets him by first name and carries the business on Google Maps until a review link is set',
  /שלום רונן,/.test(m.box) && m.box.includes('https://www.google.com/maps?cid=661613135664544059'), m.box);
await page.evaluate(() => { bizDetails.reviewUrl = 'https://g.page/r/GreenPowerTest/review'; openReviewAskFor(0); });
m = await modal();
check('with his own review link set, that is the link', m.box.includes('https://g.page/r/GreenPowerTest/review') && !m.box.includes('cid='), m.box);
check('nothing is sent before he presses send', posts.length === 0, posts.length);
await page.evaluate(() => { document.getElementById('reviewMsg').value += '\nנ.ב. תודה על הסבלנות'; return sendReviewAsk(); });
await page.waitForTimeout(400);
const p1 = posts[0] || {};
check('send: one message through the bot, to that number, as he edited it', posts.length === 1 && p1.op === 'send' && p1.chat === '050-777-1234'
  && /g\.page\/r\/GreenPowerTest\/review/.test(p1.text) && /תודה על הסבלנות/.test(p1.text) && p1.name === 'רונן כהן', p1);
check('he is told it went', /נשלחה לרונן כהן/.test(await notice()), await notice());
await page.evaluate(() => { closeNotice(); openCustomerDetails(0); });
m = await modal();
check('and the customer remembers it was sent', /ביקורת \(נשלח/.test(m.foot) && !!(await page.evaluate(() => Store.get('customers')[0].reviewAskedAt)), m.foot);

// marking a job נמסר offers it — once per customer
await page.evaluate(() => { closeModal(); openJobEditor('j1'); document.getElementById('jeStatus').value = 'נמסר'; saveJobEdit('j1'); });
await page.waitForTimeout(200);
check('a customer already asked is not asked again on delivery', !/בקשה לביקורת/.test(await notice()), await notice());
await page.evaluate(() => { closeNotice(); openJobEditor('j2'); document.getElementById('jeStatus').value = 'נמסר'; saveJobEdit('j2'); });
await page.waitForTimeout(200);
const n2 = await notice();
check('marking a job נמסר offers the review request', /נמסר/.test(n2) && /בקשה לביקורת בגוגל/.test(n2) && /דנה/.test(n2), n2);
await page.evaluate(() => noticeConfirm());
m = await modal();
check('yes opens the message to that customer', m.title === '⭐ בקשת ביקורת בגוגל' && m.box.startsWith('שלום <img,'), m.box.slice(0, 80));   // her first word, as text
// (customer names are his own typing — only /clock/ punches come from strangers — but the message
// box must still show whatever a name holds as text)
check('a name with markup in it stays text in the message', await page.evaluate(() => !document.querySelector('#modalBody img, #noticeBody img')
  && document.getElementById('reviewMsg').value.includes('<img')), '');
await page.evaluate(() => closeModal());
await page.evaluate(() => { closeNotice(); cycleOrderStatus('o1'); });
await page.waitForTimeout(200);
check('a sale marked נמסר offers it too', /בקשה לביקורת בגוגל/.test(await notice()) && /משה/.test(await notice()), await notice());

// the bot out of reach: the message to copy, as before
botUp = false;
await page.evaluate(() => { closeNotice(); openReviewAsk('054-555-6666', 'משה'); return sendReviewAsk(); });
await page.waitForTimeout(400);
m = await modal();
check('when the bot cannot be reached, the message is there to copy', /הבוט לא זמין/.test(m.title)
  && await page.evaluate(() => /g\.page\/r\/GreenPowerTest\/review/.test(document.getElementById('waCopyBox').value)), m.title);
await page.evaluate(() => { closeModal(); openReviewAsk('abc', 'x'); });
check('no valid number, no message', /אין מספר טלפון תקין/.test(await notice()), await notice());
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
