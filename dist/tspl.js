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
  function packMono(imageData, threshold, useWidth) {
    const { width, height, data } = imageData;
    // useWidth lets the caller pack fewer columns than the raster holds — see buildLabel,
    // where a raster one dot too wide is trimmed instead of refused.
    const cols = Math.min(useWidth || width, width);
    const widthBytes = Math.ceil(cols / 8);
    const bytes = new Uint8Array(widthBytes * height).fill(0xFF);
    const cut = typeof threshold === 'number' ? threshold : 160;

    for (let y = 0; y < height; y++) {
      const row = y * widthBytes;
      for (let x = 0; x < cols; x++) {
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
   * The job header, shared by a real label and the alignment pattern — they have to agree on
   * every one of these or the pattern measures a job nobody is printing.
   *
   * DENSITY defaults to 8, taken from the Windows driver that has been printing these labels
   * correctly all along (JobDarknessLevel = 8, JobPrintSpeed = 101600 i.e. 4 in/s, offsets all
   * zero). It was 10 for one evening, on no evidence, and the first label off the phone came
   * back "too dark". When a working configuration for this exact printer is sitting on the
   * machine, read it instead of picking a number.
   *
   * REFERENCE moves the origin. It exists here because the label came out shifted and no
   * amount of reasoning from this side can say by how much — that is what the pattern is for.
   */
  function jobHeader(o, widthMm, heightMm, gapMm) {
    const refX = Math.round((o.offsetXmm || 0) * DOTS_PER_MM);
    const refY = Math.round((o.offsetYmm || 0) * DOTS_PER_MM);
    return 'SIZE ' + widthMm + ' mm,' + heightMm + ' mm\r\n' +
      (gapMm > 0 ? 'GAP ' + gapMm + ' mm,0 mm\r\n' : 'GAP 0,0\r\n') +
      'DIRECTION ' + (o.direction === undefined ? 1 : o.direction) + ',0\r\n' +
      'REFERENCE ' + refX + ',' + refY + '\r\n' +
      'DENSITY ' + (o.density === undefined ? 8 : o.density) + '\r\n' +
      // Inches per second. 2, not 4: thermal transfer is heat over time, and a slower pass
      // releases the ribbon more completely — Daniel asked for the slowest the printer will
      // take, after the first labels off the phone came back poor. The Windows driver runs 4
      // (JobPrintSpeed 101600), which is right for its own path and not a reason to match.
      'SPEED ' + (o.speed === undefined ? 2 : o.speed) + '\r\n' +
      'CLS\r\n';
  }

  /*
   * One label that says where the printer thinks the label is.
   *
   * "Cut off and shifted" cannot be diagnosed from here: the size is right (the driver agrees,
   * 100.0 x 50.0mm), the offsets are zero, and everything else is the roll and the sensor.
   * This prints a frame on the exact declared boundary with a tick at each corner and the
   * parameters in the middle. Whatever is missing from the paper is the amount to correct, and
   * it turns an unbounded conversation into one measurement.
   */
  function buildAlignmentPattern(opts) {
    const o = opts || {};
    const widthMm = o.widthMm || 100;
    const heightMm = o.heightMm || 50;
    const gapMm = o.gapMm === undefined ? 2 : o.gapMm;
    const W = Math.round(widthMm * DOTS_PER_MM);
    const H = Math.round(heightMm * DOTS_PER_MM);
    const T = 6;                       // frame thickness in dots, thick enough to see
    const TICK = Math.round(5 * DOTS_PER_MM);

    let s = jobHeader(o, widthMm, heightMm, gapMm);
    // Frame on the declared edge. Any edge missing from the label is an edge the printer
    // places outside the paper.
    s += 'BAR 0,0,' + W + ',' + T + '\r\n';
    s += 'BAR 0,' + (H - T) + ',' + W + ',' + T + '\r\n';
    s += 'BAR 0,0,' + T + ',' + H + '\r\n';
    s += 'BAR ' + (W - T) + ',0,' + T + ',' + H + '\r\n';
    // Corner ticks pointing inwards, 5mm long: they survive even when an edge is off the paper.
    s += 'BAR ' + T + ',' + T + ',' + TICK + ',' + T + '\r\n';
    s += 'BAR ' + T + ',' + T + ',' + T + ',' + TICK + '\r\n';
    s += 'BAR ' + (W - T - TICK) + ',' + (H - 2 * T) + ',' + TICK + ',' + T + '\r\n';
    s += 'BAR ' + (W - 2 * T) + ',' + (H - T - TICK) + ',' + T + ',' + TICK + '\r\n';
    // A centre cross: if the frame is off the paper entirely, this still says which way.
    s += 'BAR ' + Math.round(W / 2 - TICK) + ',' + Math.round(H / 2) + ',' + (2 * TICK) + ',3\r\n';
    s += 'BAR ' + Math.round(W / 2) + ',' + Math.round(H / 2 - TICK) + ',3,' + (2 * TICK) + '\r\n';
    // ASCII only: the built-in fonts have no Hebrew, and this is for me, not for a customer.
    s += 'TEXT 40,' + Math.round(H / 2 - 60) + ',"3",0,1,1,"' + widthMm + 'x' + heightMm + 'mm gap' + gapMm + ' d'
      + (o.density === undefined ? 8 : o.density) + ' ref' + Math.round((o.offsetXmm || 0) * 10) / 10
      + ',' + Math.round((o.offsetYmm || 0) * 10) / 10 + '"\r\n';
    s += 'PRINT 1,1\r\n';
    return ascii(s);
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

    // A raster much wider than the label is a guarantee of a clipped label. A raster ONE dot
    // wider is arithmetic.
    //
    // 100mm at 300dpi is 1181.10 dots, and the capture is 1000 CSS px times a scale that has
    // to be rounded somewhere. On this machine it lands on 1181; on Daniel's S10+ it landed on
    // 1182 and the first version of this guard refused to print at all — a correct label,
    // stopped by a rounding difference of 1/1181 of its width. Up to a millimetre of overshoot
    // is therefore trimmed rather than refused: the columns dropped are the outermost dots of
    // a label that already carries a 10px white margin for the printer. Beyond that something
    // is genuinely wrong with the capture and refusing is right.
    const maxDots = Math.round(widthMm * DOTS_PER_MM);
    const TRIM_TOLERANCE = Math.round(DOTS_PER_MM);      // 1mm, ~12 dots
    const over = imageData.width - maxDots;
    if (over > TRIM_TOLERANCE) {
      throw new Error(
        'raster is ' + imageData.width + ' dots wide but ' + widthMm + 'mm is only ' +
        maxDots + ' dots at 300dpi — the label would be cut off'
      );
    }
    const mono = packMono(imageData, o.threshold, over > 0 ? maxDots : imageData.width);

    const header = jobHeader(o, widthMm, heightMm, gapMm) +
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

  return { DOTS_PER_MM, packMono, buildLabel, buildAlignmentPattern, fromCanvas, toBase64 };
});
