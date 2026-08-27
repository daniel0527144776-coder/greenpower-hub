// The catalogue thumbnails, and the two ways they can be present and useless.
//
//   node test/test-hub-thumbs.mjs [--selftest]
//
// They are inlined as data-URIs on purpose: the phone this hub runs on is behind a filter
// that can hold a fetched image indefinitely, showing a placeholder in its place. So this
// asserts BOTH that every image decoded — `naturalWidth > 0`, not that an <img> exists — and
// that nothing on the page reaches for another origin.
//
// `complete === false` is NOT failure here. A `loading="lazy"` image parked below the fold
// reports exactly that with a perfectly good source; only `complete && naturalWidth === 0`
// means the load finished and failed. That mistake once failed 96 healthy avatars on the
// retail site, so this scrolls the image into view and waits for `decode()` instead.
//
// --selftest asserts the opposite outcome so the checks can be watched failing.
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(DIST, u === '/index.html' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4193, r));

const { check, finish } = checker();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();

// Anything the page tries to fetch from elsewhere is the bug this design exists to avoid.
const external = [];
await p.route('**/*', (route) => {
  const u = route.request().url();
  if (!/^(http:\/\/127\.0\.0\.1:4193|data:|blob:|about:)/.test(u)) external.push(u);
  return route.continue();
});
const dialogs = [];
p.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });

await p.goto('http://127.0.0.1:4193/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof window.renderCatalog === 'function' && typeof window.thumbFor === 'function');

console.log('1. every catalogue category has a picture');
{
  const r = await p.evaluate(() => {
    const cats = [...new Set(CATALOG.map((x) => x.cat))];
    const missing = cats.filter((c) => !thumbFor(c));
    return { total: cats.length, missing, distinct: new Set(cats.map((c) => thumbFor(c))).size };
  });
  check('no category is left without one', r.missing.length === (SELFTEST ? 1 : 0), r.missing);
  check('and there are many categories, so the check is not vacuous', r.total > 50, r.total);
  check('several distinct images, not one repeated', r.distinct > 15, r.distinct);
}

console.log('2. they are inlined, not fetched');
{
  const kinds = await p.evaluate(() => {
    const cats = [...new Set(CATALOG.map((x) => x.cat))];
    const srcs = cats.map((c) => thumbFor(c)).filter(Boolean);
    return { data: srcs.filter((s) => s.startsWith('data:image/')).length, total: srcs.length };
  });
  check('every source is a data: URI', kinds.data === kinds.total, `${kinds.data}/${kinds.total}`);
}

console.log('3. the bytes actually decode');
{
  await p.evaluate(() => navigateTo('catalog'));
  await p.waitForSelector('.price-cat img', { timeout: 10000 });
  const imgs = p.locator('.price-cat img');
  const n = await imgs.count();
  check('thumbnails are rendered in the category headers', n > 20, n);

  // DECODE EVERY DISTINCT IMAGE, not a sample of what happens to be on screen. A first
  // version probed the first six rendered thumbnails; corrupting a seventh left it green,
  // which is a check that examines less than it claims to — the exact failure this suite is
  // supposed to catch elsewhere. Thirty decodes cost nothing.
  const decoded = await p.evaluate(async () => {
    const srcs = [...new Set(Object.values(THUMBS))];
    const out = [];
    for (const src of srcs) {
      const img = new Image();
      img.src = src;
      try { await img.decode(); } catch { /* size check below is the verdict */ }
      out.push({ w: img.naturalWidth, h: img.naturalHeight });
    }
    return { total: srcs.length, bad: out.filter((x) => !(x.w > 0 && x.h > 0)).length, sizes: [...new Set(out.map((x) => x.w + "x" + x.h))] };
  });
  check(`all ${decoded.total} distinct thumbnails decode to real pixels`,
    decoded.bad === (SELFTEST ? 1 : 0), `${decoded.bad} bad of ${decoded.total}`);
  check('and they are the size the generator was asked for', decoded.sizes.every((z) => z === '96x96'), decoded.sizes);

  // Then confirm a few are genuinely ON the page and not merely in the constant. Lazy images
  // below the fold report complete === false with a perfectly good source, so scroll and
  // decode rather than trusting a flag — that mistake once failed 96 healthy avatars.
  const probe = Math.min(4, n);
  const shown = [];
  for (let i = 0; i < probe; i++) {
    const el = imgs.nth(i);
    await el.scrollIntoViewIfNeeded();
    shown.push(await el.evaluate(async (img) => {
      try { await img.decode(); } catch {}
      return { w: img.naturalWidth, broken: img.complete && img.naturalWidth === 0 };
    }));
  }
  check('and the rendered ones are real, not the broken signature', shown.every((x) => x.w > 0 && !x.broken), shown);
}
console.log('4. the technical spec line');
{
  // Categories are COLLAPSED by default — 788 rows in one scroll was the reason — so a
  // query has to be typed before any row exists to inspect. A first version asserted on an
  // empty list and reported "0 of 0", which is a check passing over nothing.
  await p.fill('#catalogSearch', '72V');
  await p.evaluate(() => renderCatalog());
  await p.waitForSelector('.price-item-name', { timeout: 8000 });

  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.price-item-name')];
    const cover = CATALOG.filter((x) => specOf(x)).length / CATALOG.length;
    return {
      rows: rows.length,
      withSpec: rows.filter((el) => el.querySelector('div')).length,
      cover,
      batt: specOf(CATALOG.find((x) => /סוללות אופניים/.test(x.cat))),
      ctrl: specOf(CATALOG.find((x) => x.name === 'ND72450')),
    };
  });
  check('most catalogue rows carry a spec', r.cover > (SELFTEST ? 1 : 0.9), Math.round(r.cover * 100) + '%');
  check('the specs are rendered on the page, not merely computed', r.withSpec > 5, r.withSpec + ' of ' + r.rows);

  // Assert the PARTS are present rather than matching one exact layout, so reordering the
  // line does not fail a spec that is still correct.
  const has = (t, ...bits) => bits.every((b) => (t || '').includes(b));
  check('a battery states volts, capacity, energy and cell count',
    has(r.batt, 'V', 'Ah', 'Wh', 'תאים') && /\d+S\d+P/.test(r.batt || ''), r.batt);
  check('and names the actual cell it is built from',
    /EVE|Tenpower/.test(r.batt || ''), r.batt);
  check('a controller states real current ratings, not a model code',
    has(r.ctrl, '150A', '450A'), r.ctrl);

  // PRICING includes hand-written EXTRA_SERVICES rows, so this text is not all generated.
  // An unescaped < would close the div and swallow the rest of the category.
  await p.evaluate(() => {
    const row = PRICING.find((x) => specOf(x));
    PRODUCT_SPECS[row.cat + '|' + row.name] = '<img src=x onerror="window.__pwned=1"> & 5 < 6';
    renderCatalog();
  });
  const injected = await p.evaluate(() => ({
    img: document.querySelectorAll('.price-item-name img').length,
    pwned: !!window.__pwned,
    shown: document.body.innerText.includes('onerror'),
  }));
  check('markup in a spec is escaped, not executed',
    injected.img === 0 && !injected.pwned && injected.shown, JSON.stringify(injected));

  await p.fill('#catalogSearch', '');
}
check('nothing was fetched from another origin', external.length === 0, external.slice(0, 5));
check('none of this went through a dialog the phone cannot draw', dialogs.length === 0, dialogs);

await ctx.close();
await b.close();
srv.close();
process.exit(finish());
