// The 💬 and 🤖 on a repair or a sale (2026-10-06).
//
//   node test/test-wa-compose.mjs
//   node test/test-wa-compose.mjs --selftest   (no offer on מוכן לאיסוף; one warranty for every job; the message
//                                               unescaped; WhatsApp opened without the text)
//
// v416, the same evening: asked what the button should do, he chose "הוואטסאפ נפתח עם הטקסט". So 💬
// opens the customer's WhatsApp chat with the status message already written (whatsapp://send with
// the text), and 🤖 beside it opens the bot's window described below.
//
// Daniel: "תעשה שהכפתור הווטאספ בלוח בקרה גם יכול לשלוח הודעה ללקוח דרך הבוט אחרי תיקון ומכירה".
// The button used to open an empty chat (a repair) or show a quote to copy (a sale). What must hold
// now: it opens the message for where the job stands, editable; it goes out only when he presses
// send, as one 'send' through the bot to that customer's number, as he edited it; a repair's
// warranty line is that job's own (12 on a build, 6 on a repair, none on an inspection); a sale's
// message is its quote/summary (buildQuoteText); the warranties page's button reaches the same
// two; marking a repair מוכן לאיסוף offers the "ready" message; and when the bot cannot be reached,
// or the number is not valid, the message is there to copy, as before.
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
await page.goto('http://localhost:4371/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.jobWhatsApp === 'function', null, { timeout: 30000 });

// inside a textarea markup is already text — only a closing tag can break out of it
const EVIL = '</textarea><img src=x onerror="window.__xss=1">';
const W = await page.evaluate(({ SELF, EVIL }) => {
  if (SELF) {
    window.offerReadyMessage = () => {};
    window.escPunch = (s) => String(s == null ? '' : s);
    window.warrantyFor = () => WARRANTY_BUILD;
    window.openWhatsAppWith = (p) => launchWhatsApp(waNumber(p), '');
  }
  // the WhatsApp addresses opened, kept instead of followed
  window.__wa = [];
  window.waLaunch = (u) => window.__wa.push(u);
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  const d = new Date().toISOString(), end = (m) => new Date(Date.now() + m * 30 * 86400000).toISOString();
  Store.set('customers', [{ id: 'c1', name: 'רונן כהן', phone: '050-777-1234' }, { id: 'c2', name: 'משה', phone: '054-555-6666' }]);
  Store.set('jobs', [
    { id: 'j1', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'מוכן לאיסוף', price: 850, voltage: '48', capacity: '20', jobs: ['bms'], warrantyEnd: end(6) },
    { id: 'j2', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'נמסר', price: 3200, voltage: '52', capacity: '30', jobs: ['full'], warrantyEnd: end(12) },
    { id: 'j3', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'נמסר', price: 400, voltage: '36', capacity: '10', jobs: ['bms'], warrantyEnd: end(6) },
    { id: 'j4', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'נמסר', price: 100, voltage: '36', capacity: '10', jobs: [INSPECTION_ONLY[0]] },
    { id: 'j5', date: d, customerName: 'רונן כהן', customerPhone: '050-777-1234', jobStatus: 'בעבודה', price: 600, voltage: '60', capacity: '25', jobs: ['bms'] },
    { id: 'j6', date: d, customerName: EVIL + 'דנה', customerPhone: '052-333-4444', jobStatus: 'מוכן לאיסוף', price: 300, jobs: ['bms'] },
    { id: 'j7', date: d, customerName: 'ללא מספר', customerPhone: 'abc', jobStatus: 'מוכן לאיסוף', price: 300, jobs: ['bms'] },
  ]);
  Store.set('orders', [{ id: 'o1', date: d, customer: 'משה', phone: '054-555-6666', status: 'שולם', items: [{ name: 'מטען 54.6V 4A', qty: 1, unit: 300 }], total: 300 }]);
  return { build: WARRANTY_BUILD, repair: WARRANTY_MONTHS };
}, { SELF: SELFTEST, EVIL });
const modal = () => page.evaluate(() => ({ title: document.getElementById('modalTitle').textContent, foot: document.getElementById('modalFooter').innerText,
  box: (document.getElementById('waComposeMsg') || {}).value || '', copy: (document.getElementById('waCopyBox') || {}).value || '' }));
const notice = () => page.evaluate(() => document.getElementById('noticeBackdrop').classList.contains('active') ? document.getElementById('noticeBody').textContent : '');

// ---- a repair, ready for pickup: from the row's own button
await page.evaluate(() => { navigateTo('orders'); renderOrders(); });
const rowBtn = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.getAttribute('onclick') || '').filter((o) => /WhatsApp\(|Bot\(|callCustomer\(/.test(o)));
check('a repair row has 💬 and 🤖, not the empty chat', rowBtn.includes("jobWhatsApp('j1')") && rowBtn.includes("jobBot('j1')") && !rowBtn.some((o) => /callCustomer/.test(o)), rowBtn.join(' '));
check('a sale row has 💬 and 🤖', rowBtn.includes("orderWhatsApp('o1')") && rowBtn.includes("orderBot('o1')"), rowBtn.join(' '));

// ---- 💬: WhatsApp opens on the customer's chat, the status message already written
const opened = await page.evaluate(() => {
  window.__wa = [];
  jobWhatsApp('j1');
  orderWhatsApp('o1');
  const j1 = Store.get('jobs').find((j) => j.id === 'j1'), o1 = Store.get('orders')[0];
  return { urls: window.__wa.slice(), want: [repairMessage(j1), buildQuoteText(o1)], modal: document.getElementById('modalBackdrop').classList.contains('active') };
});
const textOf = (u) => decodeURIComponent((String(u || '').match(/[?&]text=([^&]*)/) || [])[1] || '');
check('💬 on a repair: WhatsApp opens on his number with the ready message written', /^whatsapp:\/\/send\?phone=972507771234&/.test(opened.urls[0] || '')
  && textOf(opened.urls[0]) === opened.want[0] && /מוכנה לאיסוף/.test(textOf(opened.urls[0])), opened.urls[0]);
check('💬 on a sale: WhatsApp opens with the sale\'s summary written', /phone=972545556666&/.test(opened.urls[1] || '') && textOf(opened.urls[1]) === opened.want[1], (opened.urls[1] || '').slice(0, 120));
check('💬 opens no window and sends nothing through the bot', !opened.modal && posts.length === 0, { modal: opened.modal, posts: posts.length });
await page.evaluate(() => jobBot('j1'));
let m = await modal();
check('the ready message: name, the pack, the work, the price, the address and the hours',
  /^שלום רונן כהן 👋/.test(m.box) && /\(48V 20Ah\) מוכנה לאיסוף/.test(m.box) && /לתשלום: ₪850/.test(m.box)
  && m.box.includes('ניסים גאון 8') && m.box.includes("11:00-19:00"), m.box);
check('it offers send, copy and WhatsApp with the text', /שלח דרך הבוט/.test(m.foot) && /העתק/.test(m.foot) && /פתח בוואטסאפ/.test(m.foot), m.foot);
check('nothing is sent before he presses send', posts.length === 0, posts.length);
await page.evaluate(() => { document.getElementById('waComposeMsg').value += '\nאפשר גם מחר'; return sendWaCompose(); });
await page.waitForTimeout(400);
const p1 = posts[0] || {};
check('send: one message through the bot, to that number, as he edited it', posts.length === 1 && p1.op === 'send' && p1.chat === '050-777-1234'
  && /מוכנה לאיסוף/.test(p1.text) && /אפשר גם מחר/.test(p1.text) && p1.name === 'רונן כהן', p1);
check('he is told it went', /נשלחה לרונן כהן/.test(await notice()), await notice());
await page.evaluate(() => closeNotice());

// ---- the delivered summary carries that job's own warranty
const box = async (id) => { await page.evaluate((id) => { closeModal(); jobBot(id); }, id); return (await modal()).box; };
const b2 = await box('j2'), b3 = await box('j3'), b4 = await box('j4');
check(`a build delivered: ${W.build} months`, b2.includes(`אחריות ${W.build} חודשים`) && /שמור את ההודעה/.test(b2) && b2.includes('52V 30Ah'), b2);
check(`a repair delivered: ${W.repair} months, not the build's`, b3.includes(`אחריות ${W.repair} חודשים`) && W.repair !== W.build, b3);
check('an inspection delivered: no warranty line', !/אחריות/.test(b4) && /תודה/.test(b4), b4);
const b5 = await box('j5');
check('a repair in work: "we\'ll tell you when it\'s ready"', /\(60V 25Ah\) בעבודה\. נעדכן אותך/.test(b5), b5);

// ---- a sale: its quote or summary, through the same window
await page.evaluate(() => { closeModal(); orderBot('o1'); });
m = await modal();
const quote = await page.evaluate(() => buildQuoteText(Store.get('orders')[0]));
check('a sale\'s 🤖 opens its summary, ready to send through the bot', m.box === quote.trim() && /שלח דרך הבוט/.test(m.foot), m.box.slice(0, 80));
await page.evaluate(() => sendWaCompose());
await page.waitForTimeout(400);
check('and sends it to the buyer', posts.length === 2 && posts[1].chat === '054-555-6666' && posts[1].name === 'משה', posts[1]);
await page.evaluate(() => closeNotice());

// ---- the warranties page reaches the same two
await page.evaluate(() => { navigateTo('warranties'); state.warrantyTab = 'all'; renderWarranties(); });
const war = await page.evaluate(() => [...document.querySelectorAll('#warrantiesList button')].map((b) => b.getAttribute('onclick') || '').filter((o) => /WhatsApp\(|Bot\(|callCustomer\(/.test(o)));
check('on the warranties page, a repair\'s and a sale\'s 💬 and 🤖 go to their messages', war.includes("jobWhatsApp('j2')") && war.includes("orderWhatsApp('o1')")
  && war.includes("jobBot('j2')") && war.includes("orderBot('o1')") && !war.some((o) => /callCustomer/.test(o)), war.join(' '));

// ---- marking a repair מוכן לאיסוף offers the message
await page.evaluate(() => { navigateTo('orders'); cycleJobStatus('j5'); });
await page.waitForTimeout(200);
const n5 = await notice();
check('🔁 to מוכן לאיסוף offers the ready message', /מוכן לאיסוף/.test(n5) && /הודעה שהסוללה מוכנה/.test(n5), n5);
const ready = await page.evaluate(() => { window.__wa = []; noticeConfirm(); return window.__wa.slice(); });
check('yes opens WhatsApp with it written, the pack ready', /\(60V 25Ah\) מוכנה לאיסוף/.test(textOf(ready[0])), ready[0]);
await page.evaluate(() => { closeModal(); openJobEditor('j3'); document.getElementById('jeStatus').value = 'מוכן לאיסוף'; saveJobEdit('j3'); });
await page.waitForTimeout(200);
check('the job editor set to מוכן לאיסוף offers it too', /הודעה שהסוללה מוכנה/.test(await notice()), await notice());
await page.evaluate(() => closeNotice());

// ---- a name with markup stays text
// (the order list draws names as his own typing; only the message window is under test here)
await page.evaluate(() => { closeModal(); window.__xss = 0; jobBot('j6'); });
await page.waitForTimeout(150);
const mk = await page.evaluate(() => ({ img: !!document.querySelector('#modalBody img'), val: (document.getElementById('waComposeMsg') || {}).value || '', xss: !!window.__xss }));
check('a name with markup in it stays text in the message', !mk.img && mk.val.includes('</textarea><img') && !mk.xss, JSON.stringify(mk).slice(0, 160));

// ---- the bot out of reach, and a number that is not one: the message to copy
botUp = false;
await page.evaluate(() => { closeModal(); jobBot('j1'); return sendWaCompose(); });
await page.waitForTimeout(400);
m = await modal();
check('when the bot cannot be reached, the message is there to copy', /הבוט לא זמין/.test(m.title) && /מוכנה לאיסוף/.test(m.copy), m.title);
await page.evaluate(() => { closeModal(); jobBot('j7'); });
m = await modal();
check('no valid number: the message to copy, no bot send', !m.box && /מוכנה לאיסוף/.test(m.copy), m.title);
const noNum = await page.evaluate(() => { closeModal(); window.__wa = []; jobWhatsApp('j7'); return { urls: window.__wa.length, copy: (document.getElementById('waCopyBox') || {}).value || '' }; });
check('💬 with no valid number: nothing opened, the message to copy', noNum.urls === 0 && /מוכנה לאיסוף/.test(noNum.copy), noNum);
// the bot's window can still hand the edited text to WhatsApp
const fromBox = await page.evaluate(() => { closeModal(); jobBot('j1'); document.getElementById('waComposeMsg').value += '\nנתראה'; window.__wa = []; waComposeOpenChat(); return window.__wa.slice(); });
check('🤖 window → "פתח בוואטסאפ": the edited text, in his WhatsApp', /נתראה$/.test(textOf(fromBox[0])) && /^whatsapp:\/\/send\?phone=972507771234&/.test(fromBox[0] || ''), fromBox[0]);
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
