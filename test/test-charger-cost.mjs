// A charger is costed from the supplier's quote, not as a share of its price (2026-10-22).
//
//   node test/test-charger-cost.mjs [--selftest]
//
// Daniel: "יש שם טעויות בתמחור ללקוח וגם כמה שזה עולה לי". No charger was in SUPPLIER_MATCH,
// so productCost fell through to COST_PCT (60% of retail) for every one of them — ₪282 for a
// 72V 5A that lands at ₪123 — and the margin column he reads was a guess presented as a cost.
//
// The quotes here are MADE UP ($10 each). This repo is public and supplier prices never go in
// it; what is under test is that each shelf charger reaches a quote row, by the names his
// imported supplier list uses, and that the hub sells only the eight on the shelf.
//
// --selftest drops the charger entries from SUPPLIER_MATCH again; the cost checks must go red.
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

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4383, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4383/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

const R = await page.evaluate((SELF) => {
  if (SELF) for (const k of Object.keys(SUPPLIER_MATCH)) if (/^מטען/.test(k)) delete SUPPLIER_MATCH[k];
  // The names as his supplier list carries them; the adjustable one under a stand-in maker.
  const quote = (cat, name) => ({ who: 'ספק', cat, name, usd: 10 });
  Store.set('supplier_prices', [
    quote('מטענים פלסטיק', '48V 3A'), quote('מטענים פלסטיק', '60V 3A'),
    quote('מטענים אלומיניום', '60V 5A XLR'), quote('מטענים אלומיניום', '72V 5A XLR'),
    quote('מטענים אלומיניום', '60V 8A XLR'), quote('מטענים אלומיניום', '72V 8A XLR'),
    quote('מטענים מתכווננים', 'ABC 72V 0-15A (מתכוונן)'),
    // A decoy: the aluminium 48V 3A must not be what costs the plastic one.
    { who: 'ספק', cat: 'מטענים אלומיניום', name: '48V 3A XLR', usd: 99 },
  ]);
  const landed = Math.round(supplierIls({ usd: 10, cat: 'מטענים' }, true, true));
  const rows = PRICING.filter((x) => /^מטענים/.test(x.cat));
  return {
    landed,
    names: rows.map((x) => x.name),
    costs: Object.fromEntries(rows.map((x) => [x.name, productCost(x, false)])),
    pct: Object.fromEntries(rows.map((x) => [x.name, Math.round(x.retail * COST_PCT / 100)])),
  };
}, SELFTEST);

const SHELF = ['מטען 36V 2A', 'מטען 48V 3A', 'מטען 60V 3A', 'מטען 60V 5A', 'מטען 72V 5A', 'מטען 60V 8A', 'מטען 72V 8A', 'מטען 72V 0-15A'];
check('the hub sells the eight chargers on the shelf, and only those',
  R.names.length === 8 && SHELF.every((n) => R.names.includes(n)), R.names);
for (const n of SHELF.slice(1)) {
  check(`${n} is costed from its quote, not ${'COST_PCT'}`, R.costs[n] === R.landed, { cost: R.costs[n], quote: R.landed, pct: R.pct[n] });
}
// The one with no quote on file says so by falling back, rather than borrowing another's.
check('the 36V 2A, with no quote yet, keeps the share-of-price estimate', R.costs['מטען 36V 2A'] === R.pct['מטען 36V 2A'], R.costs['מטען 36V 2A']);

if (SELFTEST) console.log('\n[selftest] the charger entries were taken out of SUPPLIER_MATCH; the cost checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
