// The cost window on the route he buys cells on, and the spec line under each price (2026-10-06).
//
//   node test/test-cost-route.mjs
//   node test/test-cost-route.mjs --selftest   (the three fixes undone — must fail)
//
// Daniel sent two screenshots and "תחשוב על בעיות שיש כאן". His phone was on 🏪 מקומי, so an EVE
// 50E cost LaBatteria's ₪14.80 instead of the sea import's ₪6.43, and the 88V CLASSIC 20Ah window
// read "96 תאים ₪1,421 … עסקי −12% ⚠️ מתחת לעלות". Three things were wrong with the SCREEN, whatever
// the pricing answer turns out to be:
//   1. nothing said a cell cost ₪14.80 or that the local route was the reason;
//   2. "💾 שמור" on the untouched window stored that route's estimate as HIS cost, so the row kept
//      ₪1,748 for good — back on the sea route, after any price change, forever;
//   3. the spec line read out of order ("EVE · (96 תאים) 88V · 20Ah …") and broke "EVE 50E" in two.
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

const BREAK = [
  // 2: Save stores whatever is in the box again
  ['if (!isNaN(v) && !(costs[k] == null && v === productEstimate(it))) costs[k] = v;', 'if (!isNaN(v)) costs[k] = v;'],
  // 1: the cells line without its price per cell
  ["{ k: cells + ' תאים × ₪' + cellPrice.toFixed(2), v: cells * cellPrice },", "{ k: cells + ' תאים', v: cells * cellPrice },"],
  // 3: the spec line as one string
  ["return String(sp).split(/\\s*·\\s*/).filter(Boolean)", 'return escPunch(sp); return String(sp).split(/\\s*·\\s*/).filter(Boolean)'],
];
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) for (const [a, b] of BREAK) {
  if (!html.includes(a)) { console.error('selftest: cannot find ' + a.slice(0, 60)); process.exit(2); }
  html = html.replace(a, () => b);
}

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4380, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4380/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });

// The cell rows as the real import carries them: three routes from the importer, one local quote.
await page.evaluate(() => {
  hideLogin(); closeModal(); closeNotice();
  Store.set('supplier_prices', [
    { who: 'Vapcell', cat: 'Vapcell · 21700 · 🚢 ימי', name: 'EVE 50E — CLASSIC · 21700', ils: 6.43 },
    { who: 'Vapcell', cat: 'Vapcell · 21700 · ✈️ אווירי', name: 'EVE 50E — CLASSIC · 21700', ils: 9.65 },
    { who: 'Vapcell', cat: 'Vapcell · 21700 · ✈️ אווירי', name: 'EVE 50PL — PRO · 21700 Tabless', ils: 13.03 },
    { who: 'LaBatteria', cat: 'LaBatteria · 21700', name: 'EVE 21700 50E', ils: 14.8 },
  ]);
  Store.set('costs', {}); Store.set('bms_pick', {});
  const s = Store.get('settings') || {}; s.cellRoute = 'local'; Store.set('settings', s);
});
const idx = (catRe, name) => page.evaluate(([c, n]) => PRICING.findIndex((x) => new RegExp(c).test(x.cat) && x.name === n), [catRe, name]);
const CLASSIC = await idx('^סוללות אינדורו וטרקטורונים - 88V CLASSIC$', '88V 20Ah');
const PRO = await idx('^סוללות אינדורו וטרקטורונים - 88V PRO$', '88V 20Ah');
check('the two rows from his screenshot exist', CLASSIC >= 0 && PRO >= 0, { CLASSIC, PRO });

// ---- 1. the window says what a cell cost, and why
const w = await page.evaluate((i) => {
  openCostEditor(i);
  const r = {
    breakdown: document.getElementById('costBreakdown').textContent,
    route: document.querySelector('#costBreakdown [data-cell-route]')?.getAttribute('data-cell-route'),
    source: document.getElementById('costSource')?.textContent || '',
    field: +document.getElementById('costInput').value,
    est: productEstimate(PRICING[i]),
  };
  return r;
}, CLASSIC);
check('the cells line names the price per cell on this route', /96 תאים × ₪14\.80/.test(w.breakdown), w.breakdown.slice(0, 160));
check('…and the route it came from', w.route === 'local' && /מקומי/.test(w.breakdown), w.route);
check('the window says the number is an estimate, and on which route', /אומדן/.test(w.source) && /מקומי/.test(w.source), w.source);
check('the box opens on that estimate', w.field === w.est && w.est > 1500, w);

// ---- 2. Save on the untouched window does not freeze the estimate
const s2 = await page.evaluate(([i]) => {
  saveCost(i);
  const saved = getCosts()[catKey(PRICING[i])];
  setCellRoute('sea');
  const sea = productCost(PRICING[i]);
  setCellRoute('local');
  return { saved, sea, local: productCost(PRICING[i]) };
}, [CLASSIC]);
check('saving the untouched estimate stores no cost of his', s2.saved == null, s2);
check('…so the row follows the route: sea costs less than local', s2.sea < s2.local - 500, s2);

// A cost he TYPES is his, and the window keeps showing what the parts cost today beside it.
const s3 = await page.evaluate((i) => {
  openCostEditor(i);
  document.getElementById('costInput').value = '1500';
  saveCost(i);
  const saved = getCosts()[catKey(PRICING[i])];
  openCostEditor(i);
  const source = document.getElementById('costSource').textContent;
  clearCost(i);
  return { saved, source, after: getCosts()[catKey(PRICING[i])] };
}, CLASSIC);
check('a typed cost is saved', s3.saved === 1500, s3);
check('…and the window says it is his, with today\'s estimate beside it', /עלות שהזנת/.test(s3.source) && /לפי האומדן היום/.test(s3.source), s3.source);
check('"איפוס" removes it', s3.after == null, s3);

// A cell the local supplier does not carry falls back to sea, and the window says so.
const pro = await page.evaluate((i) => {
  openCostEditor(i);
  const r = { route: document.querySelector('#costBreakdown [data-cell-route]')?.getAttribute('data-cell-route'), text: document.getElementById('costBreakdown').textContent };
  closeModal();
  return r;
}, PRO);
check('PRO on the local route: no local 50PL, so the sea price, said in words', pro.route === 'sea' && /אין מחיר/.test(pro.text) && /× ₪10\.66/.test(pro.text), pro);

// ---- 3. the spec line: fields in reading order, none broken across lines
const spec = await page.evaluate((i) => {
  navigateTo('catalog');
  catExpandAll(true);
  const row = document.querySelector(`.price-item[onclick="openCostEditor(${i})"]`);
  if (!row) return { missing: true };
  const f = [...row.querySelectorAll('.price-item-name bdi')];
  const eve = f.find((b) => b.textContent.trim() === 'EVE 50E');
  const xs = f.map((b) => b.getBoundingClientRect());
  // right-to-left reading: the first field sits furthest right on the first line
  const firstLineTop = xs.length ? xs[0].top : 0;
  const sameLine = xs.filter((r) => Math.abs(r.top - firstLineTop) < 2);
  const ordered = sameLine.every((r, k) => k === 0 || r.right <= sameLine[k - 1].left + 1);
  return { n: f.length, first: f[0]?.textContent, eveLines: eve ? eve.getClientRects().length : -1, nowrap: eve ? getComputedStyle(eve).whiteSpace : '', ordered, lines: new Set(xs.map((r) => Math.round(r.top))).size };
}, CLASSIC);
check('the 88V 20Ah row is on the page', !spec.missing, spec);
check('each spec field is its own isolated piece, in order: 88V first', spec.n >= 6 && spec.first === '88V', spec);
check('"EVE 50E" stays on one line', spec.eveLines === 1 && spec.nowrap === 'nowrap', spec);
check('the fields of a line run right to left in the order they are written', spec.ordered, spec);

check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
if (SELFTEST) console.log('\n[selftest] Save, the per-cell price and the spec islands were undone — the checks above must be red.');
await browser.close(); srv.close();
process.exit(finish());
