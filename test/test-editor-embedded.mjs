// The sticker editor must open WITHOUT leaving the hub's page.
//
//   node test/test-editor-embedded.mjs [--selftest]
//
// Daniel's phone has no browser. Opening the editor as its own page therefore did not open a
// page — it asked the device for a browser and got a block screen, which is what he saw and
// reported three times before it was heard. Nothing in the editor was broken; leaving the app
// was the bug.
//
// So the property under test is not "the editor works" but "the top-level document never
// changed". That is the one thing a screenshot of a working editor on a desktop can never
// tell you, and it is the whole reason this file exists.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';

const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4195, r));

const { check, finish } = checker();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();

// Every navigation of the TOP-LEVEL frame, recorded. A second entry means the app left.
const topNavigations = [];
page.on('framenavigated', f => { if (f === page.mainFrame()) topNavigations.push(f.url()); });
// A popup is the other way out of the app, and on that phone it is the fatal one.
const popups = [];
page.on('popup', p => popups.push(p.url()));

await page.goto('http://127.0.0.1:4195/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', { timeout: 30000 });

// --selftest restores the old behaviour — a real navigation to the editor — which is exactly
// what breaks on a phone with no browser, and must therefore turn this suite red.
await page.evaluate((selftest) => {
  if (selftest) { location.href = 'stickers.html'; return; }
  navigateTo('stickers');
}, SELFTEST);
await page.waitForTimeout(4000);

check('the top-level document never navigated away',
  topNavigations.length === 1 && topNavigations[0].endsWith('/index.html'), topNavigations);
check('nothing tried to open a second window', popups.length === 0, popups);

// The frame has no URL any more — it is srcdoc — so it is found by being the only frame
// that is not the main one. That is itself the thing under test: a frame WITH a url would
// mean a second request had been made.
const frame = page.frames().find(f => f !== page.mainFrame());
check('the editor is loaded in a frame', !!frame, page.frames().map(f => f.url()));
check('the frame fetched no second URL', !!frame && !/stickers\.html/.test(frame.url()), frame && frame.url());

if (frame) {
  const inside = await frame.evaluate(() => ({
    artboard: !!document.getElementById('sticker-to-capture'),
    printBtn: !!document.getElementById('print-bt-btn'),
    tspl: typeof window.TSPL === 'object',
    title: document.getElementById('main-title') ? document.getElementById('main-title').innerText.trim() : '',
  }));
  check('the artboard rendered inside it', inside.artboard, inside);
  check('the print button is there', inside.printBtn, inside);
  check('tspl.js loaded in the frame', inside.tspl, inside);
  check('it really is the sticker', inside.title.includes('Green Power'), inside.title);

  // Same origin is not decoration: it is why the editor can write a key the hub reads, and
  // why the APK's window.GPPrint is reachable from inside the frame.
  const sameOrigin = await page.evaluate(() => {
    try { return !!document.getElementById('stickerFrame').contentDocument; } catch (e) { return false; }
  });
  check('the frame is same-origin with the hub', sameOrigin, sameOrigin);

  // The whole point of the frame is that a label can be printed FROM it. Asserting the DOM
  // exists would pass on a page whose fonts never loaded and whose html2canvas throws — and
  // this is the one context where the fonts arrive as data-URIs rather than as files, which
  // is exactly the kind of difference that only shows up in the finished raster.
  const label = await frame.evaluate(async () => {
    try {
      const canvas = await captureStickerCanvas();
      const ctx = canvas.getContext('2d');
      const bytes = TSPL.buildLabel(ctx.getImageData(0, 0, canvas.width, canvas.height),
        { widthMm: 100, heightMm: 50, gapMm: 2 });
      let ink = 0;
      for (let i = 300; i < bytes.length - 20; i++) { let v = bytes[i] ^ 0xff; while (v) { ink += v & 1; v >>= 1; } }
      return { w: canvas.width, h: canvas.height, total: bytes.length, ink };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  });
  check('a label can be built inside the frame', !label.error, label.error);
  check('captured at the printer\'s own resolution', label.w === 1181, label.w);
  check('and it has ink on it', label.ink > 20000, label.ink);
}

await browser.close();
server.close();
process.exit(finish());
