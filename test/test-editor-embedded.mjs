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

// Located through its own element, not as "the frame that is not the main one" — the hub has
// a second iframe now (the sites page), and an iframe with no src is still a frame, so the
// loose version silently started testing an empty about:blank document instead of the editor.
const frameEl = await page.$('#stickerFrame');
const frame = frameEl ? await frameEl.contentFrame() : null;
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

// ---- a label filled in from a job, and from a sale ------------------------------------
// The point of the feature is that a battery already described once is not described again,
// so what is asserted is that the values ARRIVE — not merely that the editor opened. It fills
// and stops on purpose (Daniel's choice): the fields the hub cannot know are exactly the ones
// that would otherwise go out wrong.
if (frame) {
  await page.evaluate(() => {
    Store.set('jobs', [{
      id: 'jTEST1', date: new Date().toISOString(), customerName: 'ישראל ישראלי',
      jobs: ['full'], voltage: '72', capacity: '35', cellType: '21700-50pl',
      bmsBrand: 'daly', bmsAmps: '60', warrantyMonths: 12, price: 6000,
    }, {
      id: 'jTEST2', date: new Date().toISOString(), customerName: 'מוסך אלעד',
      jobs: ['bms'], voltage: '60', capacity: '20', cellType: '21700-50e',
      bmsBrand: 'jk', bmsAmps: '150', warrantyMonths: 6, price: 700,
    }]);
    Store.set('orders', [{
      id: 'oTEST1', date: new Date().toISOString(), customer: 'דוד כהן', phone: '0500000000',
      bmsBrand: 'ant', bmsAmps: '110', status: 'שולם', total: 4200,
      items: [{ name: 'סוללת ליתיום 48V 30Ah ADVANCED', qty: 1, unit: 4200 }],
    }]);
  });

  const read = () => frame.evaluate(() => ({
    volt: document.getElementById('voltage-select').value,
    cap: document.getElementById('capacity-select').value,
    cells: document.getElementById('cells-select').value,
    bms: document.getElementById('bms-select').value,
    client: document.getElementById('client-name-input').value,
    ref: document.getElementById('client-ref-input').value,
    repairMode: !document.getElementById('repaired-battery-specs-on-sticker').classList.contains('hidden'),
  }));

  await page.evaluate(() => openStickerFor('job', 'jTEST1'));
  await page.waitForTimeout(2500);
  const built = await read();
  check('a build fills the sticker from the job', built.volt === '72' && built.cap === '35', built);
  check('including the cell type it was built from', built.cells === 'EVE 21700 50PL', built.cells);
  check('and the BMS that went in it', built.bms === 'DALY 60A', built.bms);
  check('the customer comes across', built.client === 'ישראל ישראלי', built.client);
  check('a full build is a new battery, not a repair', built.repairMode === false, built.repairMode);

  await page.evaluate(() => openStickerFor('job', 'jTEST2'));
  await page.waitForTimeout(2000);
  const repaired = await read();
  check('a BMS job opens in repair mode', repaired.repairMode === true, repaired.repairMode);
  check('with its own voltage and cells', repaired.volt === '60' && repaired.cells === 'EVE 21700 50E', repaired);

  await page.evaluate(() => openStickerFor('order', 'oTEST1'));
  await page.waitForTimeout(2000);
  const sold = await read();
  // A sale has no voltage field at all — these are read back out of the catalogue line.
  check('a sale reads its volts and amp-hours out of the item name',
    sold.volt === '48' && sold.cap === '30', sold);
  check('and it prints as a new battery', sold.repairMode === false, sold.repairMode);
}

// ---- the public sites are no longer shown in the app -----------------------------------
// Both were framed here for a week; Daniel removed the shop and then the catalogue too
// (2026-08-23). Asserted as an ABSENCE rather than deleted, for the reason the quick pricer
// left behind: a half-removed feature keeps live onclicks calling functions that are gone,
// and that fails in the console rather than on screen. Any request to those domains would
// also mean something is still trying.
const outbound = [];
await page.route('https://energylabgreen.com/**', r => { outbound.push(r.request().url()); return r.fulfill({ body: '' }); });
await page.route('https://b2b.energylabgreen.com/**', r => { outbound.push(r.request().url()); return r.fulfill({ body: '' }); });

const gone = await page.evaluate(() => ({
  card: !!document.querySelector('[onclick*="navigateTo(\'sites\')"]'),
  section: !!document.getElementById('page-sites'),
  frame: !!document.getElementById('siteFrame'),
  loader: typeof showSite !== 'undefined',
}));
check('the sites page is gone from the app', !gone.section && !gone.frame, gone);
check('nothing links to it any more', gone.card === false, gone);
check('and its loader is gone with it', gone.loader === false, gone);
await page.waitForTimeout(600);
check('the app requested neither public site', outbound.length === 0, outbound);

// ---- a WhatsApp message is text, not a link -------------------------------------------
// Daniel copies it to the customer himself. The property worth holding is that composing one
// neither navigates nor opens anything: on his phone a wa.me link is a request for a browser
// that does not exist, and whatsapp:// either takes over the app or silently does nothing.
const wa = await page.evaluate(() => {
  const before = location.href;
  sendWhatsApp('0501234567', 'שלום, הסוללה מוכנה לאיסוף. סה"כ ₪1,400.', 'הלקוח');
  const box = document.getElementById('waCopyBox');
  return {
    stayed: location.href === before,
    text: box ? box.value : null,
    selected: box ? (box.selectionEnd - box.selectionStart) : 0,
  };
});
check('composing a message shows it as text', !!wa.text && wa.text.includes('מוכנה לאיסוף'), wa.text);
check('and it is already selected, ready to copy', wa.selected > 10, wa.selected);
check('and nothing was opened or navigated to', wa.stayed === true, wa.stayed);
await page.evaluate(() => closeModal());

check('the app still never navigated away',
  topNavigations.length === 1 && topNavigations[0].endsWith('/index.html'), topNavigations);
check('and still opened no second window', popups.length === 0, popups);

await browser.close();
server.close();
process.exit(finish());
