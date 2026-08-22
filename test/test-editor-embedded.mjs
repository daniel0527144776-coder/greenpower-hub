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

  // The assertion this suite shipped without, and it cost Daniel an evening. Every check
  // above passed while the editor came up on his phone as a wall of jsPDF source: a script
  // block closed 46KB in and the remaining 300KB rendered as text. "The right things are
  // present" says nothing about what ELSE is; a page can be correct and ruined at once.
  const spill = await frame.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      len: t.length,
      libSource: /pdfobjectnewwindow|splitTextToSize|Object\.defineProperty\(exports/.test(t),
      scripts: document.querySelectorAll('script').length,
      jspdf: typeof window.jspdf === 'object',
      scrollH: document.documentElement.scrollHeight,
    };
  });
  check('no library source is rendered as text', !spill.libSource, spill);

  // The label has to be VISIBLE on the phone it is edited on. The artboard is a fixed
  // 1000x500 and was painted at that size inside a 412px scroll box, so Daniel saw a vertical
  // slice of his own sticker — "n Power" and one column — and had to drag sideways to read
  // the rest. It is scaled to fit now; the DOM is still 1000x500, which is what every
  // measurement and the 300dpi capture depend on.
  const fit = await frame.evaluate(() => {
    const el = document.getElementById('sticker-to-capture');
    const r = el.getBoundingClientRect();
    return {
      vw: document.documentElement.clientWidth,
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      layoutWidth: el.offsetWidth,           // must stay 1000-ish: transform, not resize
    };
  });
  check('the whole label is on screen', fit.left >= -1 && fit.right <= fit.vw + 1, fit);
  check('and it is big enough to work with', fit.width > fit.vw * 0.8, fit);
  check('the artboard itself was NOT resized', fit.layoutWidth > 950, fit.layoutWidth);

  // No text wider than the box holding it. The scaled preview is where this went wrong once
  // already: the fitter compared getBoundingClientRect (on-screen, 121px) against clientWidth
  // (layout, 295px), decided everything fitted, and did nothing on the only device that
  // needed it. Mixing the two units is silent in both directions.
  const tooWide = await frame.evaluate(() => {
    const out = [];
    document.querySelectorAll('#sticker-to-capture *').forEach(el => {
      if (el.offsetParent === null) return;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1) out.push({ over, txt: (el.textContent || '').trim().slice(0, 30) });
    });
    return out;
  });
  check('no text is wider than its own box', tooWide.length === 0, tooWide);

  // The printer picker has to appear on the PHONE's screen, not inside the frame's box —
  // "it opens the Bluetooth page but the page does not move" was a dialog centred on a
  // viewport a few hundred pixels tall and scrolled somewhere else entirely.
  await frame.evaluate(() => {
    window.GPPrint = {
      devices: () => JSON.stringify([{ name: 'XP-TT434B', address: 'AA:BB:CC:DD:EE:FF' }]),
      print: () => 'OK',
    };
  });
  await frame.evaluate(() => document.getElementById('print-bt-btn').click());
  await page.waitForTimeout(1200);
  const dialog = await page.evaluate(() => {
    const els = [...document.body.children].filter(e => /position:fixed/.test(e.getAttribute('style') || ''));
    const el = els[els.length - 1];
    return el ? { inTopDocument: true, text: (el.textContent || '').slice(0, 200), scrolls: /overflow-y:auto/.test(el.getAttribute('style') || '') } : { inTopDocument: false };
  });
  check('the printer picker opens in the top document', dialog.inTopDocument, dialog);
  check('it lists the paired printer', !!dialog.text && dialog.text.includes('XP-TT434B'), dialog.text);
  check('and it can scroll if the list is long', dialog.scrolls === true, dialog);
  // The editor's own visible text is a few hundred characters of labels and buttons.
  check('the visible text is the editor, not a source dump', spill.len < 4000, spill.len);
  // A script that closed early splits one block into two, so the count is a direct read on it.
  check('every script block parsed whole', spill.scripts === 8, spill.scripts);
  check('jsPDF survived intact', spill.jspdf, spill.jspdf);

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
