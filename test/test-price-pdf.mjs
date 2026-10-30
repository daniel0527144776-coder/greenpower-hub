// The two price lists as PDF from the price-list page (2026-10-30).
//
//   node test/test-price-pdf.mjs
//   node test/test-price-pdf.mjs --selftest     (the phone handled like a computer: it opens the address)
//
// Daniel: "תן לי אפשרות להוריד את PDF גם מלוח הבקרה". His phone runs the hub in a WebView with no PDF
// viewer and no download, so opening the address there shows nothing. What must hold: on the phone each
// button asks the bot to send that one PDF to his own WhatsApp (op 'sendfile', the exact address the
// bot's allowlist takes) and says so; when the bot cannot be reached it says that instead of "sent"; on
// a computer the button opens the PDF and calls no bot.
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
const RETAIL = 'https://energylabgreen.com/greenpower-retail-pricelist.pdf';
const B2B = 'https://b2b.energylabgreen.com/greenpower-b2b-pricelist.pdf';

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4364, r));
const browser = await chromium.launch();
const errs = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };

// One page as the phone (the APK sets GP_NATIVE) or as a computer; window.open is recorded, not followed.
async function open(phone, bot) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.addInitScript((phone) => {
    if (phone) window.GP_NATIVE = true;
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return {}; };
  }, phone && !SELFTEST);
  await page.route(/energylabgreen\.com\/api\/wa\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (/\/admin/.test(req.url()) && req.method() === 'POST') {
      bot.posts.push(JSON.parse(req.postData() || '{}'));
      return bot.up ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: CORS })
        : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"green api unreachable"}', headers: CORS });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: CORS });
  });
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
  await page.route(/greenpower-(retail|b2b)-pricelist\.pdf/, (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' }));
  await page.goto('http://localhost:4364/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.sendPricePdf === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
    Sync.userId = 'u1';
  });
  return page;
}
const notice = (page) => page.evaluate(() => { const n = document.getElementById('noticeBackdrop'); return n && getComputedStyle(n).display !== 'none' ? n.innerText : ''; });
const press = async (page, kind) => {
  await page.evaluate(() => { try { closeNotice(); } catch (e) {} });
  await page.evaluate((k) => document.querySelector(`#page-catalog button[onclick="sendPricePdf('${k}')"]`).click(), kind);
  await page.waitForTimeout(400);
};

// ---- the buttons are on the price-list page ----
const bot = { posts: [], up: true };
const phone = await open(true, bot);
check('the price-list page has a button for each PDF', await phone.evaluate(() => ['retail', 'b2b'].every((k) =>
  !!document.querySelector(`#page-catalog button[onclick="sendPricePdf('${k}')"]`))), '');

// ---- on the phone: the bot sends it to his WhatsApp ----
await press(phone, 'retail');
check('on the phone, the private price list goes to his WhatsApp through the bot', bot.posts.length === 1
  && bot.posts[0].op === 'sendfile' && bot.posts[0].url === RETAIL && /המחירון הפרטי/.test(bot.posts[0].caption || ''), bot.posts);
check('and the page says it was sent to his WhatsApp', /נשלח לוואטסאפ שלך/.test(await notice(phone)), await notice(phone));
await press(phone, 'b2b');
check('the business price list goes the same way, at its own address', bot.posts.length === 2 && bot.posts[1].url === B2B, bot.posts.slice(1));
check('and nothing is opened in place on the phone (it would show an empty page)', (await phone.evaluate(() => window.__opened.length)) === 0
  && !/\.pdf$/.test(phone.url()), phone.url());
bot.up = false;
await press(phone, 'retail');
check('when the bot cannot be reached, the page says it was not sent', /לא נשלח/.test(await notice(phone)) && !/נשלח לוואטסאפ/.test(await notice(phone)), await notice(phone));

// ---- on a computer: it opens the PDF ----
const pcBot = { posts: [], up: true };
const pc = await open(false, pcBot);
await press(pc, 'b2b');
await press(pc, 'retail');
check('on a computer the button opens the PDF and calls no bot', pcBot.posts.length === 0
  && JSON.stringify(await pc.evaluate(() => window.__opened)) === JSON.stringify([B2B, RETAIL]), await pc.evaluate(() => window.__opened));
check('no page errors', errs.length === 0, errs.join(' | '));

if (SELFTEST) console.log('\n[selftest] the phone treated as a computer; the phone checks must have gone red.');
await browser.close();
srv.close();
process.exit(finish());
