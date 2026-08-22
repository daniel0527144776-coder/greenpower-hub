// Render the sticker editor's REAL output and hand back a PNG you can look at.
//
//   node test/render-sticker-pdf.mjs [--volt 72] [--cap 35] [--repair] [--out name]
//
// Why this exists: stickers.html exports through html2canvas + jsPDF, so the printed
// artefact is one raster image produced by a capture path that forces its own widths and
// heights (see the PDF-export fix in CLAUDE.md). A screenshot of the live preview is a
// different rendering and has been misleading before. This drives the actual download
// button at a 390px phone viewport, then pulls the image back out of the PDF.
//
// The raster is uncompressed DeviceRGB, so extraction is a straight stream->PNG repack —
// no poppler on this machine, and text extraction says nothing about a raster anyway.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeDiag } from './diag.mjs';

// CI installs playwright; locally nothing is installed for the hub, so fall back to the
// copy the retail site already carries rather than duplicating a browser download.
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
// Outside the repo on purpose: these are render artefacts, not deliverables, and they were
// accidentally committed 66 times before anyone noticed.
const OUTDIR = process.env.STICKER_OUT || path.join(HERE, '..', '..', 'verify-screenshots');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const VOLT = arg('volt', '72'), CAP = arg('cap', '35');
const NAME = arg('out', 'sticker');
const REPAIR = process.argv.includes('--repair');
// A customer name is what the label is FOR, and it used to reach the file name and not the
// sticker — so the renderer has to be able to fill it, or that bug is invisible here too.
const CLIENT = arg('client', ''), REF = arg('ref', '');

// --pdf <path> skips generation and just pulls the raster out of a PDF that already exists,
// which is how a sticker Daniel actually printed gets looked at rather than guessed about.
const FROM_PDF = (() => { const i = process.argv.indexOf('--pdf'); return i > 0 ? process.argv[i + 1] : null; })();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4193, r));

fs.mkdirSync(OUTDIR, { recursive: true });
const pdfPath = path.join(OUTDIR, `${NAME}.pdf`);
const pngPath = path.join(OUTDIR, `${NAME}.png`);

const errors = [];

if (FROM_PDF) {
  // Nothing to drive: the artefact already exists. Just point the extractor at it.
  fs.copyFileSync(FROM_PDF, pdfPath);
  console.log(`reading ${FROM_PDF}`);
  server.close();
} else {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() !== 'error') return;
  const t = m.text();
  // Network weather on a runner is not a defect in the page.
  if (/Failed to load resource|net::|ERR_|supabase|fonts.g(oogle)?/i.test(t)) return;
  errors.push(t); });
  await p.goto('http://127.0.0.1:4193/stickers.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  if (REPAIR) { await p.locator('.mode-button.repair-mode').click(); await p.waitForTimeout(600); }
  await p.evaluate(([v, c]) => {
    const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('voltage-select', v); set('capacity-select', c);
    if (typeof updateAllSpecs === 'function') updateAllSpecs();
  }, [VOLT, CAP]);
  if (CLIENT || REF) {
    await p.evaluate(([n, r]) => {
      const set = (id, val) => { const el = document.getElementById(id); if (el && val) {
        el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('client-name-input', n); set('client-ref-input', r);
    }, [CLIENT, REF]);
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(900);

  // Measure at 1:1, the way the label is printed — not the way a phone previews it.
  //
  // The artboard is painted scaled down on a narrow viewport (fitStickerToViewport), and this
  // renderer runs at 390px. Left alone it reports the SCALED numbers: the marks' clearance
  // came back as "6px clear (artboard 174px)" for a label that really has 16px of clearance
  // on a 498px artboard. Both readings pass, and the small one would send the next reader
  // hunting for a problem that is not there — 8px of slack in this column is a documented
  // coin flip, so the absolute number is the whole point. The capture path unscales too.
  await p.evaluate(() => {
    const w = document.querySelector('.sticker-wrapper');
    if (w) { w.style.transform = ''; w.style.marginLeft = ''; w.style.marginBottom = ''; }
  });

  // Every piece of text on the sticker, with the size and weight it actually rendered at.
  // One table, because "are all the sizes and weights right?" is a question that cannot be
  // answered by looking at a picture — 27 and 25 are indistinguishable by eye, and a
  // synthesised 500 looks like a real one.
  const type = await p.evaluate(() => {
    const seen = new Set();
    const rows = [];
    const add = (el, note) => {
      if (!el || seen.has(el)) return;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      // Only leaf-ish blocks: a wrapper would report its own inherited size for text it
      // does not own, which is how a "uniform" grid can look uniform and not be.
      // A true leaf: any element child that itself carries text means this node is a
      // wrapper reporting its own inherited size for text it does not own.
      if ([...el.children].some((c) => (c.textContent || '').trim())) return;
      seen.add(el);
      const cs = getComputedStyle(el);
      rows.push({ id: el.id || note || el.tagName.toLowerCase(),
                  px: Math.round(parseFloat(cs.fontSize)), w: cs.fontWeight,
                  txt: txt.length > 42 ? txt.slice(0, 42) + '…' : txt });
    };
    const sticker = document.getElementById('sticker-to-capture');
    sticker.querySelectorAll('h1, p, span, div').forEach((el) => {
      if (el.offsetParent === null && el.id !== 'main-title') return;   // skip the hidden mode
      add(el);
    });
    return rows;
  });
  console.log('\nid                        size  weight  text');
  type.forEach(r => console.log(
    `${String(r.id).padEnd(24)} ${String(r.px).padStart(4)}px ${String(r.w).padStart(6)}   ${r.txt}`));
  const weights = [...new Set(type.map(r => r.w))].sort();
  const sizes = [...new Set(type.map(r => r.px))].sort((a, b2) => a - b2);
  console.log(`\nweights in use: ${weights.join(', ')}   sizes in use: ${sizes.join(', ')}`);
  // Heebo is loaded at 300;400;500;600;700;800;900 — anything else is synthesised by the
  // browser and prints noticeably worse than a real face.
  const LOADED = ['300', '400', '500', '600', '700', '800', '900'];
  const bogus = weights.filter(w => !LOADED.includes(w));
  if (bogus.length) errors.push(`font weights with no loaded face: ${bogus.join(', ')}`);

  // The left column is height-bound and its last row is the CE/UL/IEC replacements. Anything
  // added above them pushes them off a fixed 500px artboard, and it has happened three times:
  // the longer address, the bigger type, and the tagline. Measured every run now, and a
  // negative clearance fails the render instead of being noticed in a print.
  const geom = await p.evaluate(() => {
    const st = document.getElementById('sticker-to-capture').getBoundingClientRect();
    const mk = document.getElementById('icon-placeholder-1');
    if (!mk) return null;
    const r = mk.getBoundingClientRect();
    // Top offsets too: "move it up a bit" is a request that needs a number, and every
    // ad-hoc script written to measure it has failed to load this page.
    const off = (id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().top - st.top) : null; };
    return { clearance: Math.round(st.bottom - r.bottom), mark: Math.round(r.width), h: Math.round(st.height),
             capTop: off('qr-title'), qrTop: off('qr-placeholder'), titleTop: off('main-title') };
  });
  if (geom) {
    console.log(`marks       ${geom.mark}px, ${geom.clearance}px clear of the bottom edge (artboard ${geom.h}px)`);
    console.log(`top offsets  masthead ${geom.titleTop}px · QR caption ${geom.capTop}px · QR ${geom.qrTop}px`);
    if (geom.clearance < 0) { errors.push(`safety marks overflow the artboard by ${-geom.clearance}px`); }
  }

  // The masthead's own INK against the top edge. Its box top is not the answer — the box
  // carries the font's leading, so #main-title reports -22px while the letters still have 2mm
  // of white above them, and a check on the box would fail a perfectly good label. This is the
  // top-edge twin of the marks clearance below, added when the title was raised 3mm on request
  // and the obvious next request is another 3mm.
  const topInk = await p.evaluate(() => {
    const title = document.getElementById('main-title');
    const art = document.getElementById('sticker-to-capture');
    if (!title || !art) return null;
    const ar = art.getBoundingClientRect(), tr = title.getBoundingClientRect();
    // Everything in artboard pixels; the preview may be painted scaled.
    const scale = ar.width / art.offsetWidth;
    return Math.round((tr.top - ar.top) / (scale || 1));
  });
  if (topInk !== null && topInk < -34) {
    // -34 leaves the ~2mm of leading the 60px face carries above its caps.
    errors.push(`the masthead is ${-topInk}px above the artboard — its letters will be cut off the top`);
  }

  // Horizontal overflow, which the vertical check above cannot see. Enlarging the side
  // column once pushed its text out through both edges while the marks still measured a
  // clean 16px of clearance — the render looked catastrophic and every number said fine.
  const spill = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#sticker-to-capture p, #sticker-to-capture span, #sticker-to-capture h1').forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (!txt || el.offsetParent === null) return;
      // Compare against the COLUMN, not the parent: the parent block can itself be wider
      // than the column, which is exactly how a first version of this check passed while
      // the text was visibly cut off at both edges of the sticker.
      const col = el.closest('#sticker-to-capture > div');
      if (!col) return;
      const box = col.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const over = Math.round(Math.max(box.left - r.left, r.right - box.right));
      if (over > 1) out.push({ txt: txt.length > 34 ? txt.slice(0, 34) + '…' : txt, over });
    });
    return out;
  });
  if (spill.length) {
    spill.forEach(s => console.log(`OVERFLOW    ${s.over}px past its column: ${s.txt}`));
    errors.push(`${spill.length} element(s) overflow their column horizontally`);
  }

  // Content against its OWN box, which is a different question again and the one that was
  // missing. The phone line is whitespace-nowrap on purpose, so at 24px it needed 310px in a
  // 295px box and pushed out through the left edge of the sticker — while the check above,
  // which asks whether each box sits inside its column, reported everything fine. It was the
  // box that fitted and the text that did not. A line that can wrap can never do this; only a
  // nowrap one can, which is why there is a fitter for exactly those.
  const burst = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#sticker-to-capture *').forEach((el) => {
      if (el.offsetParent === null) return;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1) {
        const txt = (el.textContent || '').trim();
        out.push({ over, txt: txt.length > 34 ? txt.slice(0, 34) + '…' : txt });
      }
    });
    return out;
  });
  if (burst.length) {
    burst.forEach(s => console.log(`TOO WIDE    text is ${s.over}px wider than its own box: ${s.txt}`));
    errors.push(`${burst.length} element(s) hold text wider than themselves`);
  }

  const dl = p.waitForEvent('download', { timeout: 120000 });
  await p.locator('.download-btn[data-format="pdf"]').click();
  await (await dl).saveAs(pdfPath);
  await b.close(); server.close();

}

// ---- pull the raster out of the PDF ----
const buf = fs.readFileSync(pdfPath);
const s = buf.toString('latin1');
const imgs = [...s.matchAll(/<<([^<>]*(?:<<[^>]*>>[^<>]*)*)>>\s*stream\r?\n/g)]
  .map(m => ({ d: m[1], start: m.index + m[0].length }))
  .filter(o => /\/Subtype\s*\/Image/.test(o.d))
  .map(o => {
    const n = k => { const m = o.d.match(new RegExp('\\/' + k + '\\s+(\\d+)')); return m ? +m[1] : null; };
    const t = k => { const m = o.d.match(new RegExp('\\/' + k + '\\s*\\/(\\w+)')); return m ? m[1] : null; };
    return { w: n('Width'), h: n('Height'), len: n('Length'), cs: t('ColorSpace'), filter: t('Filter'), start: o.start };
  })
  .filter(o => o.cs === 'DeviceRGB');
if (!imgs.length) { console.log('no DeviceRGB image in the PDF'); writeDiag(['no DeviceRGB image in the PDF']); process.exit(1); }
const im = imgs.sort((a, b2) => b2.w * b2.h - a.w * a.h)[0];
let data = buf.subarray(im.start, im.start + im.len);
if (im.filter === 'FlateDecode') data = zlib.inflateSync(data);
if (im.filter === 'DCTDecode') { fs.writeFileSync(pngPath.replace(/\.png$/, '.jpg'), data); console.log('wrote JPEG'); process.exit(0); }

const { w, h } = im, chan = 3;
const raw = Buffer.alloc((w * chan + 1) * h);
for (let y = 0; y < h; y++) data.copy(raw, y * (w * chan + 1) + 1, y * w * chan, (y + 1) * w * chan);
const tbl = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b2 => { let c = 0xFFFFFFFF; for (const x of b2) c = tbl[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type_, body) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const t = Buffer.from(type_, 'latin1'); const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, body])));
  return Buffer.concat([len, t, body, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(pngPath, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`\n${pngPath}  ${w}x${h}`);
if (errors.length) { console.log('page errors:'); errors.forEach(e => console.log('  ' + e)); writeDiag(errors); }
process.exit(errors.length ? 1 : 0);
