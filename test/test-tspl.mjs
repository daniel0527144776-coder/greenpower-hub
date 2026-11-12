// The label the phone will actually send — checked as bytes, and optionally against ribbon.
//
//   node test/test-tspl.mjs               drive the real editor, validate the byte stream
//   node test/test-tspl.mjs --print       ...and send it to the USB printer on this PC
//   node test/test-tspl.mjs --selftest    prove these checks can go red
//
// Why bytes and not a screenshot: TSPL has no error channel worth the name. A bitmap sent
// with its polarity inverted prints a solid black label and eats a metre of ribbon; one sent
// with the wrong row width prints a diagonal smear. Both look like a hardware fault and
// neither raises anything anywhere. The properties that prevent them — 148 bytes per row,
// 590 rows, and ink covering a plausible fraction of the label — are all checkable here,
// before the printer is involved at all.
//
// The conversion runs IN THE PAGE, through the same captureStickerCanvas() the print button
// uses, so this exercises the shipping implementation rather than a Node-side copy of it.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const DO_PRINT = process.argv.includes('--print');
const PRINTER = (() => { const i = process.argv.indexOf('--printer'); return i > 0 ? process.argv[i + 1] : 'Xprinter XP-TT434B'; })();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4194, r));

const { check, finish } = checker();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
await page.goto('http://127.0.0.1:4194/stickers.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// ---- 1. the bit-level contract, on an image small enough to reason about ------------
// One black pixel at x=0 must clear the TOP bit of the first byte, and nothing else. This is
// the whole polarity-and-bit-order question in a single number, and it is the one that costs
// ribbon to get wrong.
const mono = await page.evaluate(() => {
  const w = 12, h = 2;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const black = (x, y) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; };
  black(0, 0); black(8, 1);
  const r = TSPL.packMono({ width: w, height: h, data }, 160);
  return { widthBytes: r.widthBytes, bytes: Array.from(r.bytes) };
});
check('a 12-dot row packs into 2 bytes', mono.widthBytes === 2, mono.widthBytes);
check('black at x=0 clears the high bit of byte 0 (TSPL: 0 prints)', mono.bytes[0] === 0x7f, mono.bytes[0]);
check('the rest of row 0 stays blank', mono.bytes[1] === 0xff, mono.bytes[1]);
check('black at x=8 lands in the second byte of row 1', mono.bytes[3] === 0x7f, mono.bytes[3]);
check('row 1 first byte untouched', mono.bytes[2] === 0xff, mono.bytes[2]);

// ---- 1b. rounding is not a reason to refuse a label -----------------------------------
// Daniel's S10+ captured 1182 dots where this machine captures 1181, and the first version of
// the width guard refused to print — a correct label stopped by 1/1181 of its own width, with
// "the label would be cut off" on the screen of someone standing at the printer. One dot is
// trimmed now; a raster that is genuinely the wrong size still has to fail, so both directions
// are asserted here.
const widthGuard = await page.evaluate(() => {
  const make = (w) => ({ width: w, height: 4, data: new Uint8ClampedArray(w * 4 * 4).fill(255) });
  const out = {};
  try {
    const bytes = TSPL.buildLabel(make(1182), { widthMm: 100, heightMm: 50 });
    let head = '';
    for (let i = 0; i < 120; i++) head += String.fromCharCode(bytes[i]);
    out.oneOver = { ok: true, head };
  } catch (e) { out.oneOver = { ok: false, err: String(e.message) }; }
  try { TSPL.buildLabel(make(1400), { widthMm: 100, heightMm: 50 }); out.wayOver = { ok: true }; }
  catch (e) { out.wayOver = { ok: false, err: String(e.message) }; }
  return out;
});
check('a one-dot overshoot still prints', widthGuard.oneOver.ok, widthGuard.oneOver);
check('and it is packed to the label width, not the raster width',
  widthGuard.oneOver.ok && widthGuard.oneOver.head.includes('BITMAP 0,0,148,4,0,'),
  widthGuard.oneOver.head && widthGuard.oneOver.head.split('BITMAP')[1]);
check('a raster that is genuinely too wide is still refused', widthGuard.wayOver.ok === false, widthGuard.wayOver);

// ---- 1c. the printer's offset moves the picture, both ways (2026-11-12) ----------------
// The label Daniel photographed off his new phone sat 2.8mm to the RIGHT of the paper, the right-hand
// titles cut. REFERENCE takes no negative, so the offset is applied to the raster: a pixel moves by the
// offset in dots, REFERENCE stays 0,0, and a phone with nothing stored prints at -2.8. --selftest moves
// the probe by the opposite sign, which must turn these red.
const offset = await page.evaluate((selftest) => {
  const W = 1181, H = 4;
  const img = () => { const d = new Uint8ClampedArray(W * H * 4).fill(255); const i = (1 * W + 100) * 4; d[i] = d[i + 1] = d[i + 2] = 0; return { width: W, height: H, data: d }; };
  const inkAt = (bytes, x, y) => {
    const head = 'BITMAP 0,0,148,' + H + ',0,';
    let txt = ''; for (let i = 0; i < 400; i++) txt += String.fromCharCode(bytes[i]);
    const start = txt.indexOf(head) + head.length;
    return ((bytes[start + y * 148 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
  };
  const left = TSPL.buildLabel(img(), { widthMm: 100, heightMm: 50, offsetXmm: selftest ? 2.8 : -2.8 });
  const right = TSPL.buildLabel(img(), { widthMm: 100, heightMm: 50, offsetXmm: 2.8 });
  let head = ''; for (let i = 0; i < 160; i++) head += String.fromCharCode(left[i]);
  const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const empty = TSPL.optsFromStorage(store({}));
  // the account's copy: taken by a phone with nothing, refused by a phone changed later, taken over undated values
  const K = TSPL.PRINTER_KEYS;
  const fresh = {}; const tookFresh = TSPL.calFromAccount(store(fresh), { offx: -3.1, offy: 0.5, gap: 2, density: 8, speed: 2, at: 1000 });
  const newer = { [K.offx]: '-2', [TSPL.CAL_AT_KEY]: '2000' }; const tookNewer = TSPL.calFromAccount(store(newer), { offx: -3.1, at: 1000 });
  const undated = { [K.offx]: '0' }; const tookUndated = TSPL.calFromAccount(store(undated), { offx: -3.1, at: 1000 });
  const back = TSPL.calToAccount(store({ [K.offx]: '-2.5', [TSPL.CAL_AT_KEY]: '3000' }));
  const pattern = String.fromCharCode.apply(null, TSPL.buildAlignmentPattern({ offsetXmm: -2.8 }));
  return {
    shift: TSPL.offsetDots({ offsetXmm: -2.8 }).dx,
    leftMoved: inkAt(left, 100 - 33, 1), leftOld: inkAt(left, 100, 1), rightMoved: inkAt(right, 133, 1),
    reference: (head.match(/REFERENCE [^\r]*/) || [''])[0], emptyOffx: empty.offsetXmm,
    tookFresh, freshOffx: fresh[K.offx], freshOffy: fresh[K.offy], tookNewer, newerOffx: newer[K.offx], tookUndated, undatedOffx: undated[K.offx],
    back, patternFirstBar: (pattern.match(/BAR [^\r]*/) || [''])[0], patternRef: (pattern.match(/REFERENCE [^\r]*/) || [''])[0],
  };
}, SELFTEST);
check('-2.8mm is 33 dots', offset.shift === -33, offset.shift);
check('a negative offset moves the picture LEFT by that many dots', offset.leftMoved && !offset.leftOld, offset);
check('a positive offset moves it right', offset.rightMoved, offset.rightMoved);
check('REFERENCE stays 0,0 (it takes no negative)', offset.reference === 'REFERENCE 0,0', offset.reference);
check('a phone with nothing stored prints at -2.8mm', offset.emptyOffx === -2.8, offset.emptyOffx);
check('a phone with nothing takes the account\'s calibration', offset.tookFresh && offset.freshOffx === '-3.1' && offset.freshOffy === '0.5', offset);
check('a phone changed after the account\'s copy keeps its own', !offset.tookNewer && offset.newerOffx === '-2', offset);
check('undated values on the phone give way to the account\'s dated copy', offset.tookUndated && offset.undatedOffx === '-3.1', offset);
check('the phone\'s values go to the account with their date', offset.back && offset.back.offx === -2.5 && offset.back.at === 3000, offset.back);
check('the alignment pattern moves with the label and is clipped to it', offset.patternFirstBar === 'BAR 0,0,1148,6' && offset.patternRef === 'REFERENCE 0,0', [offset.patternFirstBar, offset.patternRef]);

// ---- 2. the real label ---------------------------------------------------------------
const label = await page.evaluate(async (selftest) => {
  const canvas = await captureStickerCanvas();
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // --selftest asks for a threshold above white, which paints every dot black. That is the
  // exact catastrophe these checks exist to catch, so it must turn them red.
  const bytes = TSPL.buildLabel(img, { widthMm: 100, heightMm: 50, gapMm: 2, threshold: selftest ? 999 : undefined });
  let head = '';
  for (let i = 0; i < 200; i++) head += String.fromCharCode(bytes[i]);
  return {
    canvasW: canvas.width, canvasH: canvas.height,
    total: bytes.length,
    head,
    b64: TSPL.toBase64(bytes),
  };
}, SELFTEST);

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2));
// Within a dot or two of 1181, not exactly it. 100mm at 300dpi is 1181.10 dots and the
// capture is 1000 CSS px times a rounded scale, so the last digit belongs to the device:
// this machine gives 1181 and Daniel's S10+ gives 1182. Demanding one of them is demanding
// a particular phone.
check('the capture is ~1181 dots wide (100mm at 300dpi)', Math.abs(label.canvasW - 1181) <= 2, label.canvasW);
check('the capture is 589-590 dots tall (50mm at 300dpi)', Math.abs(label.canvasH - 590) <= 1, label.canvasH);

const widthBytes = Math.ceil(label.canvasW / 8);
check('SIZE names the physical label', label.head.includes('SIZE 100 mm,50 mm'), label.head.slice(0, 24));
check('GAP is declared for die-cut stock', label.head.includes('GAP 2 mm,0 mm'), true);
check('BITMAP declares the packed row width and height',
  label.head.includes(`BITMAP 0,0,${widthBytes},${label.canvasH},0,`), label.head.split('BITMAP')[1]);

const bytes = Buffer.from(label.b64, 'base64');
const headerLen = label.head.indexOf('BITMAP');
const bitmapStart = bytes.indexOf(Buffer.from(`BITMAP 0,0,${widthBytes},${label.canvasH},0,`)) + `BITMAP 0,0,${widthBytes},${label.canvasH},0,`.length;
const raster = bytes.subarray(bitmapStart, bitmapStart + widthBytes * label.canvasH);
check('the raster is exactly rows x row-width bytes', raster.length === widthBytes * label.canvasH, raster.length);
check('the job ends with PRINT', bytes.subarray(-14).toString('latin1').includes('PRINT 1,1'), bytes.subarray(-14).toString('latin1'));
check('header comes before the raster', headerLen > 0 && bitmapStart > headerLen, { headerLen, bitmapStart });

// Ink coverage. A correct label is mostly blank; inverted polarity is ~100%, and a capture
// that silently produced an empty canvas is 0%.
let inkBits = 0;
for (const b of raster) { let v = b ^ 0xff; while (v) { inkBits += v & 1; v >>= 1; } }
const inkPct = (inkBits / (raster.length * 8)) * 100;
check('ink covers a plausible share of the label (2-40%)', inkPct >= 2 && inkPct <= 40, +inkPct.toFixed(2));

// ---- 3. optionally, ribbon --------------------------------------------------------
if (DO_PRINT) {
  const tmp = path.join(os.tmpdir(), 'gp-label.bin');
  fs.writeFileSync(tmp, bytes);
  console.log(`\nsending ${bytes.length} bytes to "${PRINTER}"`);
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(HERE, '..', 'tools', 'print-raw.ps1'),
    '-PrinterName', PRINTER, '-Path', tmp,
  ], { encoding: 'utf8' });
  console.log(out.trim());
}

await browser.close();
server.close();
process.exit(finish());
