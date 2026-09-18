// Asking for a Google review (2026-09-18) — the last item from DECISIONS-2026-09-01.
//
//   node test/test-review-request.mjs
//   node test/test-review-request.mjs --selftest
//
// It was written down as "automatic WhatsApp after a job", and it is deliberately NEITHER
// automatic NOR a link:
//
//   * automatic is impossible without risking the number the business runs on. The official
//     API needs a Meta Business account (checked 2026-09-18, still true), the BSPs resell that
//     same API, and the Facebook-free route is an unofficial library that violates the terms
//     and gets numbers banned.
//   * a wa.me link is wrong for a different reason, settled on 2026-08-23: "שיהיה רק טקסט ואני
//     יעתיק לבד ללקוח". On that phone a link is a request for a browser that does not exist.
//
// So the test asserts the SHAPE — text he copies — and the one thing that could genuinely harm
// him: a message going out with no review link, or with somebody else's.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4353, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
// A NATIVE dialog is invisible in the WebView, so raising one is itself the bug.
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4353/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

// A delivered repair, of the shape saveJob actually writes.
await page.evaluate(() => {
  window.jobs = [{
    id: 'j1', customerName: 'אבי כהן', customerPhone: '0501234567',
    date: new Date().toISOString(), price: 1400, voltage: 48, capacity: 20, status: 'נמסר',
  }];
});

if (SELFTEST) {
  // The bug worth protecting against: compose and show the message even with no link
  // configured, so a customer gets an invitation to review nothing.
  await page.evaluate(() => {
    window.askForReview = function (id) {
      const j = (window.jobs || []).find((x) => String(x.id) === String(id));
      showMessageToCopy('תודה! חוות דעת בגוגל: ' + (bizDetails.review || '') + '\n' + (j ? j.customerName : ''));
    };
  });
}

// ---------------------------------------------------------------- 1. no link configured
const noLink = await page.evaluate(() => {
  bizDetails.review = '';
  askForReview('j1');
  const box = document.getElementById('waCopyBox');
  // Read the NOTICE element, not document.body.innerText — the replaced alert draws its own
  // overlay at z-index 10001 and body.innerText does not pick it up, which made this check fail
  // against a hub that was behaving perfectly.
  const notice = document.getElementById('noticeBackdrop');
  return {
    shown: !!box,
    text: box ? box.value : null,
    notice: notice ? notice.innerText.slice(0, 300) : null,
  };
});
check('with no review link it does NOT compose a message', noLink.shown === false, noLink.text);
check('and it says where the link comes from',
  /Google Business Profile|בקשת ביקורות/.test(noLink.notice || ''), noLink.notice);
await page.evaluate(() => { closeModal && closeModal(); const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none'; });

// ---------------------------------------------------------------- 2. with a link
const withLink = await page.evaluate(() => {
  bizDetails.review = 'https://g.page/r/TESTPLACEID/review';
  bizDetails.name = 'Green Power';
  bizDetails.phone = '055-7292481';
  askForReview('j1');
  const box = document.getElementById('waCopyBox');
  return { shown: !!box, text: box ? box.value : '' };
});
check('with a link it shows the message as TEXT to copy', withLink.shown === true, withLink);
check('the link is in it', withLink.text.includes('https://g.page/r/TESTPLACEID/review'), withLink.text);
check('it greets the customer by name', /אבי/.test(withLink.text), withLink.text);
check('it names the battery, so the customer knows which job',
  /48V 20Ah/.test(withLink.text), withLink.text);
check('and it signs off as the business', /Green Power/.test(withLink.text), withLink.text);
// The whole point of the 2026-08-23 decision: no link that asks for a browser.
check('it is NOT a wa.me link — that phone has no browser',
  !/wa\.me|whatsapp:\/\//.test(withLink.text), withLink.text);

// ---------------------------------------------------------------- 3. never a hardcoded link
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const region = html.replace(/<!-- sticker-doc: generated[\s\S]*?<!-- \/sticker-doc -->/, '');
check('no review URL is baked into the public file — it is a setting',
  !/g\.page\/r\/[A-Za-z0-9_-]{6,}|writereview\?placeid=/.test(region), 'a real place id is present');

if (SELFTEST) console.log('\n[selftest] askForReview was replaced by one that composes regardless;\n[selftest] the "no link" checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
