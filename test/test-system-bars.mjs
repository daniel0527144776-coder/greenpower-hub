// The phone's system bars cover nothing (2026-11-05).
//
//   node test/test-system-bars.mjs
//   node test/test-system-bars.mjs --selftest     (the page never learns it runs under the bars, and the power
//                                                  sign that draws as an empty box is put back)
//
// Daniel, with a picture from his new phone: "הטקסט בכותרת העליונה ובתחתון זה נסתר ... יש כיתוב על גבי כיתוב, או
// למטה יש כזה שחור שמכסה את הכיתוב". The app there draws the page to the screen's edges: Android's status bar
// (clock, battery) sat on the header's title and buttons, and its black navigation bar on the last rows. And the
// bot page's "כבה" carried ⏻, which no font on that phone has: an empty box.
//
// Read in a browser three ways: as that app (an Android WebView whose page is as tall as the screen), as an app
// that stops at the bars (the screen 80px taller than the page), and as a computer. Only the first moves.
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

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) {
  html = html.replace("document.documentElement.classList.add('gp-edge')", 'void 0');
  html = html.replace("'⏹ כבה'", "'⏻ כבה'");
}
check('no ⏻ in the hub (no font on the phone has it)', !html.includes('⏻'));

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); return; }
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4419, r));
const browser = await chromium.launch();

const WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A156E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function open({ ua, screenH }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: screenH }, userAgent: ua, isMobile: ua === WEBVIEW_UA, hasTouch: ua === WEBVIEW_UA });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto('http://localhost:4419/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    const s = document.getElementById('syncOverlay'); if (s) s.style.display = 'none';
  });
  const m = await page.evaluate(() => {
    const px = (el, p) => parseFloat(getComputedStyle(el)[p]);
    const h1 = document.querySelector('.app-logo-text h1');
    const btn = document.querySelector('.app-header-actions .header-btn');
    const main = document.querySelector('.main');
    // A page longer than the screen, as the long ones are (the stock, the bot's contacts): its last row is what
    // the navigation bar covered.
    const fill = document.createElement('div'); fill.style.height = '2000px';
    const last = document.createElement('div'); last.style.height = '20px'; last.textContent = 'השורה האחרונה';
    main.append(fill, last);
    window.scrollTo(0, document.documentElement.scrollHeight);
    const mb = document.getElementById('modalBackdrop') || document.querySelector('.modal-backdrop');
    mb.classList.add('active');
    const modalTop = px(mb, 'paddingTop'), modalBottom = px(mb, 'paddingBottom');
    mb.classList.remove('active');
    return {
      edge: document.documentElement.classList.contains('gp-edge'),
      titleTop: h1.getBoundingClientRect().top, btnTop: btn ? btn.getBoundingClientRect().top : null,
      headerPadTop: px(document.querySelector('.app-header'), 'paddingTop'),
      mainPadBottom: px(main, 'paddingBottom'),
      lastBottom: last ? last.getBoundingClientRect().bottom : null, innerH: window.innerHeight,
      modalTop, modalBottom,
    };
  });
  await ctx.close();
  return { ...m, errs };
}

// ---- 1. the app that draws to the screen's edges (his phone)
const a = await open({ ua: WEBVIEW_UA, screenH: 844 });
check('his phone: the page knows it runs under the bars', a.edge, a);
check('his phone: the header\'s title starts below the status bar (32px)', a.titleTop >= 32, a.titleTop);
check('his phone: the header\'s buttons start below the status bar', a.btnTop !== null && a.btnTop >= 32, a.btnTop);
check('his phone: the last row ends above the navigation bar (48px)', a.lastBottom !== null && a.lastBottom <= a.innerH - 48, { lastBottom: a.lastBottom, innerH: a.innerH });
check('his phone: a window opens clear of both bars', a.modalTop >= 48 && a.modalBottom >= 64, { top: a.modalTop, bottom: a.modalBottom });
check('his phone: no script error', !a.errs.length, a.errs);

// ---- 2. an app that stops at the bars: nothing moves
const b = await open({ ua: WEBVIEW_UA, screenH: 924 });
check('an app above the bars: no room added', !b.edge && b.headerPadTop === 14 && b.mainPadBottom === 12, b);

// ---- 3. a computer: nothing moves
const c = await open({ ua: DESKTOP_UA, screenH: 844 });
check('a computer: no room added', !c.edge && c.headerPadTop === 14 && c.mainPadBottom === 12, c);

await browser.close(); srv.close();
if (SELFTEST) console.log('\n[selftest] the page never learns it runs under the bars, and ⏻ is back in "כבה"; the checks above must have gone red.');
process.exit(finish());
