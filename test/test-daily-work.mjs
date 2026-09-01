// The four things added for how he actually works, 2026-09-01.
//
//   node test/test-daily-work.mjs
//   node test/test-daily-work.mjs --selftest
//
// Each of these replaces a manual step, and a step that silently stops happening is worse than
// one that was never automated — the stock figure keeps being trusted, the profit keeps being
// read, and neither says it has stopped.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4217, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4217/index.html');
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
});
await page.waitForTimeout(200);

// ---- 1. a price in one keystroke ----
// His most common action, and it cost four presses.
const price = await page.evaluate(() => {
  const el = document.getElementById('homePrice');
  if (!el) return null;
  el.value = '72V 30';
  homePriceSearch();
  const out = document.getElementById('homePriceOut');
  return { text: out.innerText, rows: out.querySelectorAll('.price-item').length, hasB2B: /עסקי/.test(out.innerText) };
});
check('the home page has a price box', !!price, price ? 'ok' : 'missing');
if (price) {
  check('typing a size finds packs', price.rows > 0, String(price.rows));
  check('and shows the trade price beside the retail one', price.hasB2B, price.text.slice(0, 60));
  const words = await page.evaluate(() => {
    const el = document.getElementById('homePrice');
    // Reversed: the same pack, said the other way round. (An earlier version of this check
    // used 'BMS 30', which matches nothing because no BMS row carries a 30 — the test example
    // was wrong, not the search.)
    el.value = '30 72';
    homePriceSearch();
    return document.getElementById('homePriceOut').querySelectorAll('.price-item').length;
  });
  // Word-order independence is the point: a size gets said out loud in any order.
  check('word order does not matter', words > 0, String(words));
}

// ---- 2. a build takes cells off the shelf ----
const stock = await page.evaluate(() => {
  localStorage.setItem('gp_inventory', JSON.stringify([{ id: 'i1', name: 'תאי EVE 21700 50E', qty: 500, low: 100 }]));
  // 72V = 20S, 30Ah = 6P -> 120 cells
  const hit = inventoryDeduct('EVE 50E', 120, 'בדיקה');
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  const miss = inventoryDeduct('EVE 99XX', 50, 'בדיקה');
  return { matched: hit && hit.matched, left: inv[0].qty, missMatched: miss && miss.matched };
});
check('a build deducts its cells', stock.matched && stock.left === 380, `${stock.left}`);
// Silence here would leave a stock figure that is wrong and still trusted.
check('and an unknown cell is reported, not guessed at', stock.missMatched === false, String(stock.missMatched));

// ---- 3. what to order ----
const order = await page.evaluate(() => {
  localStorage.setItem('gp_inventory', JSON.stringify([
    { id: 'a', name: 'ניקל 0.15', qty: 0, low: 5 },
    { id: 'b', name: 'תאי EVE 50E', qty: 3, low: 100 },
    { id: 'c', name: 'שרוול', qty: 40, low: 5 },
  ]));
  const txt = orderListText();
  return { txt, lines: orderList().length };
});
check('the order list covers what is out and what is low', order.lines === 2, String(order.lines));
check('and leaves what is in stock alone', !/שרוול/.test(order.txt), order.txt.replace(/\n/g, ' · ').slice(0, 70));
check('it is text ready to paste to a supplier', /נשארו/.test(order.txt), 'ok');

// ---- 4. a sale knows what it made ----
const profit = await page.evaluate(() => {
  const row = PRICING.find((r) => typeof r.retail === 'number' && productCost(r) != null);
  if (!row) return { skip: true };
  const known = saleProfit({ total: row.retail, items: [{ name: row.name, cat: row.cat, qty: 1 }] });
  // A line the catalogue does not know must produce NO figure rather than a partial one.
  const partial = saleProfit({ total: 1000, items: [{ name: row.name, cat: row.cat, qty: 1 }, { name: 'לא קיים', cat: 'לא קיים', qty: 1 }] });
  return { known, partial };
});
check('a sale reports its profit', profit.skip || (profit.known && typeof profit.known.profit === 'number'), JSON.stringify(profit.known));
// Partial knowledge reads as a fact and is a guess — the one outcome worth refusing.
check('but not from half the lines', profit.skip || profit.partial === null, JSON.stringify(profit.partial));

// ---- 5. a quote goes stale ----
const quote = await page.evaluate(() => {
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  const fresh = new Date(Date.now() - 2 * 86400000).toISOString();
  return {
    stale: quoteAge({ status: 'הצעה', date: old }),
    fresh: quoteAge({ status: 'הצעה', date: fresh }),
    paid: quoteAge({ status: 'שולם', date: old }),
    pill: quoteAgePill({ status: 'הצעה', date: old }),
  };
});
check('a 30-day quote is stale', quote.stale && quote.stale.stale === true, JSON.stringify(quote.stale));
check('a 2-day quote is not', quote.fresh && quote.fresh.stale === false, JSON.stringify(quote.fresh));
check('and a paid sale has no age at all', quote.paid === null, String(quote.paid));
check('the row says so', /פג/.test(quote.pill), quote.pill);

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
