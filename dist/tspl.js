/*
 * TSPL — turning the sticker's own canvas into bytes an XP-TT434B will print.
 *
 * Why this exists at all: the label leaves the editor today as a PDF, which is a file, and a
 * file needs something that can print a file. On the phone there is no such thing — no
 * browser, no PDF viewer, no print dialog, and in the WebView not even a download. TSPL goes
 * the other way: it is the printer's own language, so the phone can hand the finished bytes
 * to the printer over Bluetooth and nothing in between has to understand a page.
 *
 * The geometry is a gift, not a coincidence. The artboard is a fixed 1000x500 captured at
 * get300DpiScale(), so the raster is 1181x590 — and the TT434B is a 300dpi printer, on which
 * 100mm x 50mm is 1181 x 590 dots. One canvas pixel is one printer dot. Nothing is resampled,
 * which is why hairlines and the QR survive; resampling a 1-bit image is where label printing
 * usually goes wrong.
 *
 * Loaded as a plain script (window.TSPL) rather than a module: stickers.html is classic
 * scripts throughout and its service worker precaches by URL. test/test-tspl.mjs evaluates
 * this same file in the page, so there is one implementation and the test exercises it in
 * the environment it actually runs in.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TSPL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 300 dots per inch, and 25.4mm per inch.
  const DOTS_PER_MM = 300 / 25.4;

  /*
   * In TSPL's BITMAP data a bit that is ZERO prints a dot and a bit that is ONE leaves the
   * label blank — the opposite of every image format, and the single easiest thing to get
   * backwards here. Getting it backwards does not error: it prints a solid black label and
   * eats a metre of ribbon. So the buffer starts as 0xFF (all white) and bits are cleared.
   */
  function packMono(imageData, threshold) {
    const { width, height, data } = imageData;
    const widthBytes = Math.ceil(width / 8);
    const bytes = new Uint8Array(widthBytes * height).fill(0xFF);
    const cut = typeof threshold === 'number' ? threshold : 160;

    for (let y = 0; y < height; y++) {
      const row = y * widthBytes;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // A fully transparent pixel is white here: html2canvas is given a white
        // backgroundColor, but an un-composited corner would otherwise read as luminance 0
        // and print as a black block.
        const lum = data[i + 3] === 0
          ? 255
          : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < cut) bytes[row + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }
    // The padding dots at the end of each row (1181 dots occupy 148 bytes = 1184) stay 1,
    // i.e. blank, because the buffer was filled with 0xFF and never touched there.
    return { widthBytes, height, bytes };
  }

  function ascii(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /*
   * opts.gapMm is the one value that depends on the roll in the machine rather than on us:
   * die-cut labels have a 2-3mm gap, continuous stock has none (pass 0), and black-mark
   * stock needs BLINE instead of GAP. Wrong here means the printer feeds looking for a gap
   * it will never find and stops with an error — annoying, not destructive.
   */
  function buildLabel(imageData, opts) {
    const o = opts || {};
    const widthMm = o.widthMm || 100;
    const heightMm = o.heightMm || 50;
    const gapMm = o.gapMm === undefined ? 2 : o.gapMm;
    const copies = o.copies || 1;
    const mono = packMono(imageData, o.threshold);

    // A raster wider than the label is not a warning, it is a guarantee of a clipped label,
    // and at 300dpi the numbers are big enough that nobody notices 40 dots by eye.
    const maxDots = Math.round(widthMm * DOTS_PER_MM);
    if (imageData.width > maxDots) {
      throw new Error(
        'raster is ' + imageData.width + ' dots wide but ' + widthMm + 'mm is only ' +
        maxDots + ' dots at 300dpi — the label would be cut off'
      );
    }

    const header =
      'SIZE ' + widthMm + ' mm,' + heightMm + ' mm\r\n' +
      (gapMm > 0 ? 'GAP ' + gapMm + ' mm,0 mm\r\n' : 'GAP 0,0\r\n') +
      'DIRECTION ' + (o.direction === undefined ? 1 : o.direction) + ',0\r\n' +
      'REFERENCE 0,0\r\n' +
      'DENSITY ' + (o.density === undefined ? 10 : o.density) + '\r\n' +
      'SPEED ' + (o.speed === undefined ? 4 : o.speed) + '\r\n' +
      'CLS\r\n' +
      'BITMAP 0,0,' + mono.widthBytes + ',' + mono.height + ',0,';

    return concat([
      ascii(header),
      mono.bytes,
      ascii('\r\nPRINT ' + copies + ',1\r\n'),
    ]);
  }

  function fromCanvas(canvas, opts) {
    const ctx = canvas.getContext('2d');
    return buildLabel(ctx.getImageData(0, 0, canvas.width, canvas.height), opts);
  }

  // The bridge to the APK carries a string, so the bytes travel as base64. Chunked because
  // String.fromCharCode.apply on a 90KB array overflows the argument list on some engines.
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  return { DOTS_PER_MM, packMono, buildLabel, fromCanvas, toBase64 };
});
