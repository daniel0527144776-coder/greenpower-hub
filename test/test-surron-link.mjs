// The Sur-Ron page goes to a customer as a link (2026-11-06).
//
//   node test/test-surron-link.mjs
//   node test/test-surron-link.mjs --selftest     (the message carries the booklet's address instead of the page's)
//
// Daniel: "אני מעדיף לשלוח ללקוח איזה קישור דיגיטלי ... ששם יהיה את כל המידע ... במקום ה-PDF"; asked, he chose to send
// it to a customer straight from the hub. On the price-list page a button shows the message with the link to
// energylabgreen.com/surron, ready to copy into the customer's chat, as every message to a customer is shown: it
// opens nothing and calls no bot (on his phone neither would reach the customer). Read on the phone and on a computer.
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
const PAGE = 'https://energylabgreen.com/surron';

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) html = html.replace("const SURRON_PAGE = 'https://energylabgreen.com/surron';", "const SURRON_PAGE = 'https://energylabgreen.com/surron-dhs.pdf';");
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); return; }
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4437, r));
const browser = await chromium.launch();

for (const phone of [true, false]) {
  const who = phone ? 'on his phone' : 'on a computer';
  const page = await browser.newPage();
  const errs = [], calls = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.addInitScript((phone) => {
    if (phone) window.GP_NATIVE = true;
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return {}; };
  }, phone);
  await page.route(/^https?:\/\/(?!localhost)/, (route) => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('http://localhost:4437/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.copySurronLink === 'function', null, { timeout: 30000 });
  const btn = await page.evaluate(() => !!document.querySelector('#page-catalog button[onclick="copySurronLink()"]'));
  check(`${who}: the price-list page has the button`, btn, '');
  const before = calls.length;
  await page.evaluate(() => document.querySelector('#page-catalog button[onclick="copySurronLink()"]').click());
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => {
    const box = document.getElementById('waCopyBox');
    return { text: box ? box.value : '', shown: !!box && box.offsetParent !== null, opened: window.__opened.length, href: location.href };
  });
  check(`${who}: the message to copy carries the link to the page`, got.shown && got.text.split('\n').some((l) => l.trim() === PAGE) && !/\.pdf/.test(got.text), got.text);
  check(`${who}: and says what is there, from Green Power`, /שנבנות אצלנו במעבדה: הדגמים/.test(got.text) && /איזה בקר מתאים/.test(got.text) && !/DHS/.test(got.text) && /Green Power/.test(got.text), got.text);
  check(`${who}: nothing is opened and no bot is called`, got.opened === 0 && !calls.slice(before).some((u) => /\/api\/wa\//.test(u)) && /localhost/.test(got.href), { opened: got.opened, calls: calls.slice(before) });
  check(`${who}: no page errors`, !errs.length, errs);
  await page.close();
}
await browser.close(); srv.close();
if (SELFTEST) console.log('\n[selftest] the message carries the booklet\'s address instead of the page\'s; the checks above must have gone red.');
process.exit(finish());
